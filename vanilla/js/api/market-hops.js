/* MarketHops: 24h-active market network for the two market charts.
 * Owns: fetchActivePairs (ONE paginated ES composite aggregation over
 *   fill_order ops -> unordered pairs with summed fill counts) + the
 *   in-session pair cache; mergePairs (ES buckets -> unordered pairs);
 *   hopsFrom (unbounded BFS from seed assets to a hop depth — NO display
 *   caps, owner ruling); routeToCore (fewest-hops, widest-bottleneck route
 *   to BTS weighted by fills); lookupSyms (one symbol join); toGraph (emit
 *   the graph shape BOTH network painters already speak); deskId (the
 *   shared QUOTE_BASE id rule).
 * Consumes: HistoryCap.esSearch (the ONLY raw-ES seam), Chain.db/call for
 *   lookup_asset_symbols, Store (network pref), Format (human provenance
 *   at render, via the callers). I18n via the local t wrapper.
 * Side effects: one HTTPS POST per ES page (pref-gated, mainnet-gated,
 *   capped pages, one 15s total budget) + in-session memo of the pair set
 *   (never persisted). No DOM, no signing.
 * CHAIN TRUTH (#4 wins): fill_order is operation_type 4 (market.hpp) —
 *   its pays/receives legs are the 24h fill signal. BTS core = 1.3.0
 *   literal (consensus, not a lookup).
 * MONEY DISCIPLINE (#6): fills are integer COUNTS, never money; they feed
 *   canvas pixels only. Any price/volume shown beside a line is passed in
 *   by the view from its OWN chain ticker probe — chain owns price, ES owns
 *   activity. Never a Number() on an amount anywhere in this file.
 * QUERY SHAPE: the proven `top-markets` template (es-lab.js:286, astro-ui
 *   TopActiveMarkets.ts:77-93) — term op-4 + block_time range + composite
 *   over both asset-id legs, with after_key pagination added.
 * Created by: market-hops design 2026-10-07
 *   (spec docs/superpowers/specs/2026-10-07-market-hops-design.md,
 *    plan docs/superpowers/plans/2026-10-07-market-hops.md Task 1-2).
 */
var MarketHops = (function () {
  "use strict";

  var CORE_ID = "1.3.0";
  var ASSET_RE = /^1\.3\.\d+$/;
  var ES_INDEX = "bitshares-*";
  var ES_SIZE = 1000;            /* composite page size (astro TopActiveMarkets.ts:85) */
  var ES_MAX_PAGES = 3;          /* TRANSPORT page cap — never a display cap */
  var ES_TIMEOUT_MS = 15000;     /* TOTAL budget across pages */

  /* Batch-2d i18n (market-net-ui.js precedent): verbatim English default so
   * file:// renders identically; raw default returns unfilled without I18n. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }

  /* Batch-2d i18n helper for this file's callers: exported so views can render
   * the fills/price provenance sentence without re-declaring a wrapper. */
  function tr(key, dflt, vars) { return t(key, dflt, vars); }

  /* HistoryCap seam (the single ES gateway): classic-script global in the
   * browser (call-time lookup, load-order agnostic), globalThis in node
   * suites. No require() here — checkJs runs browser libs (TS2591) and
   * shipped code must not know about module loaders. Null => ES unusable. */
  function _historyCap() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.esSearch === "function") return HistoryCap;
    } catch (e) { /* node preload below */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.HistoryCap && typeof globalThis.HistoryCap.esSearch === "function") return globalThis.HistoryCap;
    } catch (e) { /* null below */ }
    return null;
  }

  /* _dbCall: one database_api round trip (symbols). Socket failures surface
   * as "not-connected" so callers can decide partial vs offline. */
  async function _dbCall(method, params) {
    var dbId;
    try {
      if (typeof Chain === "undefined" || !Chain) throw new Error("no chain");
      dbId = await Chain.db();
    } catch (e) { throw new Error("not-connected"); }
    try {
      return await Chain.call(dbId, method, params || []);
    } catch (e) {
      if (/not connected|socket closed|connect timeout|call timeout/i.test(String((e && e.message) || e || ""))) {
        throw new Error("not-connected");
      }
      throw e;
    }
  }

  /* ---- mergePairs ---- */

  /* mergePairs: ES composite buckets -> unordered {a,b,fills}, summed.
   * A market between A and B is the same regardless of which side paid, so
   * the two ids sort and join; both orientations sum into ONE entry (astro
   * TopActiveMarkets.ts pairKey + merge). Malformed buckets (missing legs,
   * non 1.3.x ids, self-pairs, missing/zero doc_count) are DROPPED, never
   * coerced — an invented pair is a lie about activity.
   * Pure: input untouched, repeat calls identical.
   * @param {Array<Object>} buckets ES by_pair composite buckets.
   * @returns {Array<{a: string, b: string, fills: number}>} fills desc, then a asc.
   */
  function mergePairs(buckets) {
    var byKey = {}, order = [];
    (buckets || []).forEach(function (bk) {
      if (!bk || !bk.key) return;
      var pays = bk.key.pays, receives = bk.key.receives;
      if (!ASSET_RE.test(String(pays)) || !ASSET_RE.test(String(receives))) return;
      var n = Number(bk.doc_count);
      if (!isFinite(n) || n <= 0) return;
      var ids = [String(pays), String(receives)].sort();
      if (ids[0] === ids[1]) return;
      var key = ids[0] + "|" + ids[1];
      if (!byKey[key]) { byKey[key] = { a: ids[0], b: ids[1], fills: 0 }; order.push(key); }
      byKey[key].fills += Math.floor(n);
    });
    return order.map(function (k) { return byKey[k]; }).sort(function (x, y) {
      if (x.fills !== y.fills) return y.fills - x.fills;
      return x.a < y.a ? -1 : (x.a > y.a ? 1 : 0);
    });
  }

  /* ---- hopsFrom ---- */

  /* hopsFrom: unbounded BFS from seed assets over the 24h-active pair set,
   * out to `depth` hops (3 on the market selector, 2 on the exchange desk).
   * NO CAPS — the full reachable web is shown; ES page size is the only
   * bound upstream (owner ruling). Seeds are kept as nodes even when
   * isolated. Node order is deterministic (fills desc, then id asc) so
   * rings never jump between renders.
   * Pure: input untouched.
   * @param {Array<{a:string,b:string,fills:number}>} pairs 24h-active pairs.
   * @param {Array<string>} seeds asset ids to grow from.
   * @param {number} depth max hops.
   * @returns {{nodes: Array<{assetId:string,fills:number,layer:number}>,
   *            edges: Array<{a,b,fills,sizeRaw,layer}>}} nodes carry the
   *   summed fills touching that asset; edges carry sizeRaw = fills as a
   *   digit string so the shared ramp pipelines keep working unchanged.
   */
  function hopsFrom(pairs, seeds, depth) {
    var d = (typeof depth === "number" && depth >= 1) ? Math.floor(depth) : 2;
    var adj = {}, nodeFills = {}, layer = {}, seen = {}, keepEdge = {}, outEdges = [];
    var i, e;
    for (i = 0; i < (pairs || []).length; i++) {
      e = pairs[i];
      if (!e || !ASSET_RE.test(String(e.a)) || !ASSET_RE.test(String(e.b))) continue;
      var f = Number(e.fills);
      if (!isFinite(f) || f <= 0) continue;
      (adj[e.a] = adj[e.a] || []).push({ to: e.b, fills: f });
      (adj[e.b] = adj[e.b] || []).push({ to: e.a, fills: f });
      nodeFills[e.a] = (nodeFills[e.a] || 0) + f;
      nodeFills[e.b] = (nodeFills[e.b] || 0) + f;
    }
    var seedList = (seeds || []).filter(function (s) { return ASSET_RE.test(String(s)); }).map(String);
    var frontier = seedList.slice();
    seedList.forEach(function (s) { seen[s] = 1; layer[s] = 0; });
    for (var hop = 1; hop <= d && frontier.length; hop++) {
      var next = [];
      frontier.forEach(function (cur) {
        (adj[cur] || []).forEach(function (link) {
          var to = link.to;
          var k = cur < to ? cur + "|" + to : to + "|" + cur;
          if (!keepEdge[k]) {
            keepEdge[k] = { a: cur, b: to, fills: link.fills, sizeRaw: String(link.fills), layer: hop };
            outEdges.push(keepEdge[k]);
          }
          if (!seen[to]) { seen[to] = 1; layer[to] = hop; next.push(to); }
        });
      });
      frontier = next;
    }
    var nodes = Object.keys(seen).map(function (id) {
      return { assetId: id, fills: nodeFills[id] || 0, layer: layer[id] };
    });
    nodes.sort(function (x, y) {
      if (x.fills !== y.fills) return y.fills - x.fills;
      return x.assetId < y.assetId ? -1 : (x.assetId > y.assetId ? 1 : 0);
    });
    return { nodes: nodes, edges: outEdges };
  }

  /* ---- routeToCore ---- */

  /* routeToCore: the fills-weighted route from the seeds to BTS. Fewest hops
   * first; ties break on the WIDEST bottleneck (the smallest fill count along
   * the route) — "most-filled route", the market analogue of
   * PoolGraph.findCorePath's widest-min-edge tiebreak. Returns null when BTS
   * is unreachable: a thin market web is NORMAL, not an orphan warning, so
   * nothing is ever fabricated. A seed that IS BTS yields 0 hops.
   * Runs over HOP edges (a/b/fills), which carry NO desk id yet — a desk id
   * needs symbols, and symbols arrive after this call — so the result is the
   * ASSET path; `deskIdsFor` maps it onto the rendered edges afterwards.
   * Pure (unit-tested, no DOM).
   * @param {Array<Object>} edges hops edges (needs a/b, uses fills).
   * @param {Array<string>} seeds starting assets.
   * @param {string} [coreId] defaults to the 1.3.0 literal.
   * @returns {{assetPath: Array<string>, hops: number}|null} assetPath runs
   *   seed -> ... -> BTS inclusive.
   */
  function routeToCore(edges, seeds, coreId) {
    var core = String(coreId || CORE_ID);
    var adj = {}, i, e;
    for (i = 0; i < (edges || []).length; i++) {
      e = edges[i];
      if (!e || !ASSET_RE.test(String(e.a)) || !ASSET_RE.test(String(e.b))) continue;
      var f = Number(e.fills);
      if (!isFinite(f)) f = 0;
      (adj[e.a] = adj[e.a] || []).push({ to: e.b, fills: f });
      (adj[e.b] = adj[e.b] || []).push({ to: e.a, fills: f });
    }
    var seedList = (seeds || []).filter(function (s) { return ASSET_RE.test(String(s)); }).map(String);
    if (!seedList.length) return null;
    if (seedList.indexOf(core) !== -1) return { assetPath: [core], hops: 0 };
    var best = {}, queue = [];
    seedList.forEach(function (s) {
      best[s] = { hops: 0, bottle: -1, prev: null, via: null };
      queue.push({ id: s, hops: 0, bottle: -1 });
    });
    var guard = 0;
    while (queue.length && guard++ < 50000) {
      var cur = queue.shift();
      var links = adj[cur.id] || [];
      for (i = 0; i < links.length; i++) {
        var l = links[i];
        var nb = (cur.bottle < 0) ? l.fills : (l.fills < cur.bottle ? l.fills : cur.bottle);
        var have = best[l.to];
        var better = !have || cur.hops + 1 < have.hops || (cur.hops + 1 === have.hops && nb > have.bottle);
        if (!better) continue;
        best[l.to] = { hops: cur.hops + 1, bottle: nb, prev: cur.id };
        queue.push({ id: l.to, hops: cur.hops + 1, bottle: nb });
      }
    }
    var hit = best[core];
    if (!hit || hit.hops === undefined || hit.hops === 0) return null;
    var path = [core], at = core, g = 0;
    while (at && g++ < 200) {
      var b = best[at];
      if (!b) return null;
      if (!b.prev) break;
      at = b.prev;
      path.unshift(at);
    }
    if (path.length !== hit.hops + 1) return null;
    return { assetPath: path, hops: hit.hops };
  }

  /* deskIdsFor: map a routeToCore ASSET path onto the rendered edges, so the
   * painter can glow exactly those lines. Walks consecutive path legs and
   * keeps the edge joining them; a leg whose edge is absent from the painted
   * graph stops the highlight there (better a partial honest route than a
   * glow on a line the user cannot see). Pure.
   * @param {{assetPath: Array<string>}|null} route routeToCore result.
   * @param {Array<Object>} edges RENDERED edges (id/poolId + a/b).
   * @returns {Array<string>} desk/edge ids in travel order (may be empty).
   */
  function deskIdsFor(route, edges) {
    var out = [];
    try {
      if (!route || !Array.isArray(route.assetPath) || route.assetPath.length < 2) return out;
      var byPair = {};
      (edges || []).forEach(function (e) {
        if (!e || !e.a || !e.b) return;
        var id = String(e.id || e.poolId || "");
        if (!id) return;
        var k = String(e.a) + "|" + String(e.b);
        var rk = String(e.b) + "|" + String(e.a);
        if (!byPair[k]) byPair[k] = id;
        if (!byPair[rk]) byPair[rk] = id;
      });
      for (var i = 0; i < route.assetPath.length - 1; i++) {
        var id2 = byPair[route.assetPath[i] + "|" + route.assetPath[i + 1]];
        if (!id2) break;
        out.push(id2);
      }
    } catch (e) { /* no highlight over a broken path */ }
    return out;
  }

  /* ---- ES fetch ---- */

  /* queryBody: the 24h fill-pair aggregation. Shape mirrors the proven
   * `top-markets` template (es-lab.js:286 / astro TopActiveMarkets.ts) —
   * term op-4 + block_time range + composite over both asset-id legs.
   * `after` is the previous page's after_key (undefined on page 1).
   * Pure (unit-tested against the es-lab shape).
   * @param {number} days lookback window in days (>=1).
   * @param {Object|null} after previous page's after_key.
   * @returns {Object} ES request body.
   */
  function queryBody(days, after) {
    var hours = Math.max(1, Math.floor(days || 1) * 24);
    var b = {
      track_total_hits: false,
      size: 0,
      query: { bool: { filter: [
        { term: { operation_type: 4 } },
        { range: { "block_data.block_time": { gte: "now-" + hours + "h", lte: "now" } } }
      ] } },
      aggs: { by_pair: { composite: { size: ES_SIZE, sources: [
        { pays: { terms: { field: "operation_history.op_object.pays.asset_id.keyword" } } },
        { receives: { terms: { field: "operation_history.op_object.receives.asset_id.keyword" } } }
      ] } } }
    };
    if (after) b.after_key = after;
    return b;
  }

  /* session cache keyed by window: NEVER persisted (capability is re-probed
   * each load — the cache is a speedup, never load-bearing). */
  var _cache = {};

  /* _esOn: community-index pref gate (HistoryCap owns the setting). Missing
   * HistoryCap reads as ON here — the fetch then rejects and callers fall
   * back, which is the honest outcome either way. */
  function _esOn() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.esAllowed === "function") return HistoryCap.esAllowed() !== false;
    } catch (e) { /* ON stands */ }
    return true;
  }

  /* _mainnet: the community index is mainnet-only and market ids collide
   * across chains, so testnet NEVER probes (pool-history.js:330 records the
   * same rule for pools). Reads Store (sole settings owner); mainnet when
   * unreadable. */
  function _mainnet() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && s.network === "testnet") return false;
      }
    } catch (e) { /* mainnet default */ }
    return true;
  }

  /* fetchActivePairs: the 24h-active market pair set from the community
   * index — ONE composite aggregation per page, after_key pagination up to
   * ES_MAX_PAGES, ONE 15s total deadline (each page gets the remainder via
   * esSearch opts.timeoutMs). Transport is HistoryCap.esSearch, the only
   * raw-ES seam; a pref-disabled, testnet, or unreachable index REJECTS
   * (es-disabled / es-testnet / es-unavailable) so callers fall back
   * honestly. Resolves {pairs, partial}: partial when the last allowed page
   * came back full, because then the window holds more than we read and a
   * truncated web would be a silent lie.
   * @param {{days?: number, force?: boolean}} [opts] force bypasses the cache.
   * @returns {Promise<{pairs: Array<{a,b,fills}>, partial: boolean}>}
   */
  function fetchActivePairs(opts) {
    opts = opts || {};
    var days = (typeof opts.days === "number" && opts.days >= 1) ? Math.floor(opts.days) : 1;
    var key = String(days);
    if (!opts.force && _cache[key]) return Promise.resolve(_cache[key]);
    var HC = _historyCap();
    if (!HC) return Promise.reject(new Error("es-unavailable"));
    if (!_esOn()) return Promise.reject(new Error("es-disabled"));
    if (!_mainnet()) return Promise.reject(new Error("es-testnet"));
    var all = [], after = null, pages = 0, partial = false;
    var deadline = Date.now() + ES_TIMEOUT_MS;
    function page() {
      var left = Math.max(1000, deadline - Date.now());
      return HC.esSearch(ES_INDEX, queryBody(days, after), { timeoutMs: left }).then(function (json) {
        pages++;
        var cp = ((json && json.aggregations) || {}).by_pair || {};
        var buckets = Array.isArray(cp.buckets) ? cp.buckets : [];
        all = all.concat(buckets);
        var full = buckets.length >= ES_SIZE;
        if (full && pages < ES_MAX_PAGES && cp.after_key) {
          after = cp.after_key;
          return page();
        }
        /* A full last allowed page means the window holds more than we read. */
        if (full) partial = true;
        return null;
      });
    }
    return page().then(function () {
      var out = { pairs: mergePairs(all), partial: partial };
      _cache[key] = out;
      return out;
    });
  }

  /* ---- symbol join ---- */

  /* lookupSyms: ONE lookup_asset_symbols for every id in the graph (misses
   * degrade to bare ids, never throws, never blocks the map). Rejects only
   * "not-connected" so a caller can distinguish offline from unreadable.
   * @param {Array<string>} ids asset ids.
   * @returns {Promise<Object<string,string>>} id -> symbol.
   */
  function lookupSyms(ids) {
    var map = {}, uniq = [];
    (ids || []).forEach(function (id) {
      var s = String(id || "");
      if (ASSET_RE.test(s) && !map[s]) { map[s] = s; uniq.push(s); }
    });
    if (!uniq.length) return Promise.resolve(map);
    try { map[CORE_ID] = "BTS"; } catch (e) { /* map stands */ }
    return _dbCall("lookup_asset_symbols", [uniq]).then(function (rows) {
      (rows || []).forEach(function (a) {
        if (a && a.id && a.symbol) map[String(a.id)] = String(a.symbol);
      });
      return map;
    }).catch(function (e) {
      if (e && e.message === "not-connected") throw e;
      return map;   /* partial join is still useful: bare ids read honestly */
    });
  }

  /* ---- graph shaping ---- */

  /* deskId: the shared QUOTE_BASE desk id — quote is the URL head
   * (market-picker.js:382, market-net.js:25, Market.parseId).
   * @param {string} symA first leg symbol. @param {string} symB second leg symbol.
   * @returns {string} e.g. deskId("BTS","BTC") === "BTC_BTS".
   */
  function deskId(symA, symB) { return String(symB) + "_" + String(symA); }

  /* toGraph: hops -> the graph shape BOTH painters already speak, so no
   * structural painter change is needed. Edge `id` === `poolId` === the
   * QUOTE_BASE desk id (one identity, two names — market-net.js:226
   * precedent, because the shared paint/hit/twin pipeline keys on poolId).
   * Orientation, in order: an edge touching the desk BASE keeps it as base
   * (reads like the desk you are on); else the desk's quote leg stays
   * quote; else the hop's own sorted order. Provenance (latest / volume /
   * precisions) is passed in per desk id from the view's own chain ticker
   * probe — chain owns price, ES owns activity. An edge whose symbols are
   * unknown (no symbol join) is DROPPED rather than turned into a broken
   * desk id that would navigate nowhere.
   * Pure (unit-tested). Never throws.
   * @param {{nodes: Array, edges: Array}} hops hopsFrom output.
   * @param {{syms?: Object, provenance?: Object, quoteAsset?: string, baseAsset?: string}} opts
   * @returns {{graph: {nodes: Array<{assetId, sym}>, edges: Array}, meta: Object}}
   */
  function toGraph(hops, opts) {
    opts = opts || {};
    var syms = opts.syms || {}, prov = opts.provenance || {};
    var quoteAsset = (opts.quoteAsset == null) ? null : String(opts.quoteAsset);
    var baseAsset = (opts.baseAsset == null) ? null : String(opts.baseAsset);
    var nodes = [], seen = {}, i;
    var hn = (hops && hops.nodes) || [];
    for (i = 0; i < hn.length; i++) {
      var n = hn[i];
      if (!n || !ASSET_RE.test(String(n.assetId))) continue;
      var id = String(n.assetId);
      if (seen[id]) continue;
      seen[id] = 1;
      nodes.push({ assetId: id, sym: syms[id] || id });
    }
    nodes.sort(function (x, y) { return x.assetId < y.assetId ? -1 : (x.assetId > y.assetId ? 1 : 0); });
    var meta = {}, edges = [];
    var he = (hops && hops.edges) || [];
    for (i = 0; i < he.length; i++) {
      var e = he[i];
      if (!e || !e.a || !e.b || String(e.a) === String(e.b)) continue;
      var a = String(e.a), b = String(e.b);
      var symA = syms[a], symB = syms[b];
      /* Both legs must be named: a desk id is symbol-based, so an unnamed
       * leg cannot produce a navigable target. */
      if (!symA || !symB || String(symA) === String(symB)) continue;
      var quote = symA, base = symB;
      if (baseAsset && (a === baseAsset || b === baseAsset)) {
        base = (a === baseAsset) ? symA : symB;
        quote = (a === baseAsset) ? symB : symA;
      } else if (quoteAsset && (a === quoteAsset || b === quoteAsset)) {
        quote = (a === quoteAsset) ? symA : symB;
        base = (a === quoteAsset) ? symB : symA;
      }
      var id2 = deskId(base, quote);
      var fills = Number(e.fills);
      if (!isFinite(fills) || fills <= 0) fills = 0;
      edges.push({ id: id2, poolId: id2, a: a, b: b, fills: fills, sizeRaw: String(fills), layer: e.layer });
      var m = { symA: base, symB: quote, fills: fills };
      var p = prov[id2];
      if (p) {
        m.latest = p.latest; m.volBaseRaw = p.volBaseRaw; m.volQuoteRaw = p.volQuoteRaw;
        m.volBasePrec = p.volBasePrec; m.volQuotePrec = p.volQuotePrec;
      }
      meta[id2] = m;
    }
    return { graph: { nodes: nodes, edges: edges }, meta: meta };
  }

  /* clearCache: drop the session pair memo (a settings/theme re-probe or a
   * test harness calls this). Never throws. */
  function clearCache() {
    try { _cache = {}; } catch (e) { /* cache stands */ }
  }

  return {
    fetchActivePairs: fetchActivePairs,
    lookupSyms: lookupSyms,
    mergePairs: mergePairs,
    hopsFrom: hopsFrom,
    routeToCore: routeToCore,
    deskIdsFor: deskIdsFor,
    toGraph: toGraph,
    deskId: deskId,
    clearCache: clearCache,
    tr: tr,
    CORE_ID: CORE_ID,
    _test: {
      ASSET_RE: ASSET_RE, ES_SIZE: ES_SIZE, ES_MAX_PAGES: ES_MAX_PAGES,
      ES_TIMEOUT_MS: ES_TIMEOUT_MS, queryBody: queryBody, t: t,
      _mainnet: _mainnet, _esOn: _esOn
    }
  };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.MarketHops === "undefined") { globalThis.MarketHops = MarketHops; }
if (typeof module !== "undefined") { module.exports = MarketHops; }