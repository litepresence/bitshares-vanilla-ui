/* MarketNet: top-markets discovery data for the #/markets landing.
 * Owns: candidates (pool counterparties of X + curated seeds + cached
 *   markets + user-typed pair, deduped, capped 20), rank (ticker rows
 *   volume-desc on BigInt base_volume, zero-volume kept), readCache /
 *   writeCache / reconcileCache (localStorage cache of discovered market
 *   ids; chain re-validates every load, stale ids dropped — spec §2).
 * Consumes: Market.stats(baseId, quoteId) ticker shape
 *   (market.js:452-462: {raw, latest, highestBid, lowestAsk} with
 *   raw.base_volume in base units) plus row labels {a, b, symA, symB};
 *   PoolNet graph shape {nodes: [{assetId, sym}], edges: [{poolId, a, b}]}
 *   (pool-net.js — table rows carry {a, b} asset ids directly).
 *   No DOM, no signing. Makes no chain calls itself: the view probes
 *   get_ticker per candidate (X-as-base via Market.stats) and passes rows
 *   in — same injection shape as PoolNet.loadAllBatched (chain only at the
 *   edge, view-owned listFn).
 * Created by: markets landing Task 1
 *   (plan docs/superpowers/plans/2026-10-07-market-net.md;
 *   spec docs/superpowers/specs/2026-10-07-market-net-design.md §1-§2).
 * DESK-ID RULE (verified against market-picker.js:382 + :590): desk ids are
 *   QUOTE_BASE (quote = URL head, base = URL tail — Market.parseId,
 *   market.js:145-151; id built as q + "_" + b; href "#/market/" + id).
 *   Rows here carry a=X-as-base, b=counter-as-quote (the Market.stats
 *   probe order: stats(baseId=X, quoteId=Y) -> get_ticker[X, Y]), so the
 *   desk id is symB(sym of b = QUOTE) + "_" + symA(sym of a = BASE).
 * MONEY DISCIPLINE (#6): this module carries ids + symbols + raw digit
 *   strings only — volumes stay BigInt-parseable digit strings, latest /
 *   change pass through as display strings for Format at render. No
 *   Number() on money, no floats, nothing to misplace a decimal in.
 */
var MarketNet = (function () {
  "use strict";

  /* Discovery cap (spec §2: cap 20 pairs; same bound as the picker
   * DISCOVER_N=20 top-markets sample — one get_ticker per pair stays
   * bounded, table needs no pager). */
  var CAP = 20;

  /* localStorage key for discovered market ids (QUOTE_BASE strings).
   * The shipped curated list is immutable truth for structure; markets
   * discovered live are remembered here so the next first paint already
   * knows them — but the chain re-validates every load and stale ids are
   * dropped (reconcileCache rewrites the cache to exactly
   * live-minus-seeds). */
  var CACHE_KEY = "marketNetSeen";

  /* Ticker row as passed in by the view (one Market.stats probe per
   * candidate pair, X-as-base so base_volume values compare in X units).
   * @typedef {Object} MarketTickerRow
   * @property {string} a Focus asset id ("1.3.x", the X-as-base leg).
   * @property {string} b Counter asset id ("1.3.x", the quote leg).
   * @property {string} symA Focus asset symbol (BASE side label).
   * @property {string} symB Counter asset symbol (QUOTE side label).
   * @property {string} baseVol Raw base_volume digit string (BigInt-safe).
   * @property {string|null} latest Human latest-price string (or null).
   * @property {string|null} change Human 24h percent_change string (or null).
   */

  /* candidates: union of discovery sources for asset X, deduped, capped.
   * Pool counterparties of X come first (free — already-loaded PoolNet
   * graph, oriented Y_X per the desk-id rule), then curated seeds, cached
   * markets, and the user-typed pair, each verbatim. Opposite orientations
   * of one pair (USD_BTS vs BTS_USD) stay distinct entries: they are
   * distinct desks, and the view probes both orientations order-free.
   * @param {{nodes?: Array<any>, edges?: Array<any>}|null} poolGraph Loaded
   *   PoolNet graph (edges {poolId, a, b} with asset ids; nodes carry syms).
   * @param {string|Array<string>} xId Focus asset id ("1.3.x") — or, in the
   *   legacy 4-arg shape candidates(poolGraph, seeds, cached, typed), the
   *   seeds array (detected, X treated as null).
   * @param {Array<string>} [seeds] Curated QUOTE_BASE ids (picker list).
   * @param {Array<string>} [cached] Cached QUOTE_BASE ids (readCache).
   * @param {string|null} [typed] User-typed QUOTE_BASE id (or null).
   * @returns {string[]} QUOTE_BASE ids, deduped, capped at CAP.
   */
  function candidates(poolGraph, xId, seeds, cached, typed) {
    if (Array.isArray(xId)) {
      typed = cached;
      cached = seeds;
      seeds = xId;
      xId = null;
    }
    var out = [], seen = {};
    function add(id) {
      if (typeof id !== "string" || !id) return;
      if (!seen[id]) { seen[id] = 1; out.push(id); }
    }
    try {
      var bySym = {};
      ((poolGraph && poolGraph.nodes) || []).forEach(function (n) {
        if (n && n.assetId) bySym[n.assetId] = n.sym;
      });
      var xSym = (typeof xId === "string" && xId) ? bySym[xId] : null;
      ((poolGraph && poolGraph.edges) || []).forEach(function (e) {
        if (!e || typeof xId !== "string" || !xId) return;
        var other = null;
        if (e.a === xId) other = e.b;
        else if (e.b === xId) other = e.a;
        else return;
        var ySym = bySym[other];
        if (xSym && ySym && ySym !== xSym) add(ySym + "_" + xSym);
      });
    } catch (e) { /* fail-open: seeds below still stand */ }
    (seeds || []).forEach(add);
    (cached || []).forEach(add);
    if (typed) add(typed);
    return out.slice(0, CAP);
  }

  /* rank: ticker rows volume-desc on raw base_volume digit strings.
   * BigInt compare (volumes exceed float-safe range); malformed volumes
   * sort as zero but are KEPT (zero-volume rows render honest empty cells,
   * never vanish). Ties break symB alpha (stable, deterministic).
   * @param {MarketTickerRow[]} rows Probed ticker rows.
   * @returns {MarketTickerRow[]} New array, sorted (input untouched).
   */
  function rank(rows) {
    return (rows || []).slice().sort(function (x, y) {
      var bx = 0n, by = 0n;
      try { bx = BigInt(String(x.baseVol || "0")); } catch (e) { bx = 0n; }
      try { by = BigInt(String(y.baseVol || "0")); } catch (e) { by = 0n; }
      if (bx !== by) return bx > by ? -1 : 1;
      var sx = String(x.symB), sy = String(y.symB);
      if (sx < sy) return -1;
      if (sx > sy) return 1;
      return 0;
    });
  }

  /* readCache: cached discovered market ids, or [] when no cache
   * (first run, private mode, or node test harness without localStorage).
   * Corrupt JSON or non-QUOTE_BASE entries read as dropped, never throws.
   * @returns {string[]} Cached QUOTE_BASE ids.
   */
  function readCache() {
    try {
      if (typeof localStorage === "undefined") return [];
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return [];
      var ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return [];
      return ids.filter(function (x) {
        return typeof x === "string" && x.indexOf("_") !== -1;
      });
    } catch (e) { return []; }
  }

  /* writeCache: persist discovered market ids (best-effort:
   * quota/private-mode failures are swallowed — the cache is a speedup,
   * never load-bearing; the next load re-derives it from chain).
   * @param {string[]} ids QUOTE_BASE ids to cache.
   * @returns {void}
   */
  function writeCache(ids) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(CACHE_KEY, JSON.stringify(ids || []));
    } catch (e) { /* best-effort only */ }
  }

  /* reconcileCache: re-validate the cache against a fresh live id set.
   * extra = live ids absent from the curated seeds; the cache is rewritten
   * to exactly that set, so markets dead on chain drop out. Mirrors
   * PoolNet.reconcileExtraIds (seeds play the skeleton role — markets have
   * no immutable skeleton, pairs live/die with activity per spec §1).
   * @param {string[]} seedIds Curated QUOTE_BASE ids (picker list).
   * @param {string[]} liveIds Fresh live QUOTE_BASE ids (probed this load).
   * @returns {{added: string[], dropped: string[], extra: string[]}}
   *   added = newly cached, dropped = stale (no longer live), extra = full set.
   */
  function reconcileCache(seedIds, liveIds) {
    var known = {}, live = {}, before = {};
    (seedIds || []).forEach(function (id) { known[String(id)] = 1; });
    (liveIds || []).forEach(function (id) { live[String(id)] = 1; });
    readCache().forEach(function (id) { before[id] = 1; });
    var extra = Object.keys(live).filter(function (id) { return !known[id]; });
    var added = extra.filter(function (id) { return !before[id]; });
    var dropped = Object.keys(before).filter(function (id) { return !live[id]; });
    writeCache(extra);
    return { added: added, dropped: dropped, extra: extra };
  }

  return {
    candidates: candidates,
    rank: rank,
    readCache: readCache,
    writeCache: writeCache,
    reconcileCache: reconcileCache,
    CAP: CAP,
    CACHE_KEY: CACHE_KEY
  };
})();
if (typeof module !== "undefined") { module.exports = MarketNet; }
if (typeof globalThis !== "undefined" && typeof globalThis.MarketNet === "undefined") { globalThis.MarketNet = MarketNet; }
