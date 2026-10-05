/* history-summary.js — THIN FACADE: enrich/collect/join/cache/helpers.
 * Owns: enrich() (collect ids -> 2 batch joins over a chain-keyed
 *   asset-meta cache boot-seeded from PoolAssets on matching chain_id ->
 *   per-family summarizers -> row._summary), shared amount()/name()/sym()/
 *   bare()/isSide()/signed() helpers (verbatim copies live in the family
 *   files so moved bodies stay byte-identical — market-desk split precedent).
 *   Per-family summarizers live in vanilla/js/api/history-families-*.js
 *   (trade = Task 3 daily-eight, pools = Task 4 pool/asset/credit/samet/debit,
 *   gov = Task 5 governance/HTLC/tickets/vesting/proposals/misc/blind), tagged
 *   BEFORE this file in index.html; this facade keeps their SUMMARIZERS
 *   registry by reference and reads it at call time. Label-only fallback for
 *   anything unrecognized; enrich never rejects (degraded rows render as
 *   today). No DOM, no signing.
 * Consumes: Chain.db/.call/.status, Format.formatAmount, PoolAssets (optional),
 *   I18n.t (guarded local copy). Exposes global HistorySummary.
 * Created by: history one-liners plan (spec docs/superpowers/specs/2026-10-04-history-one-liners-design.md);
 *   split by tooling/split_history_summary.py (facade + registry assembly). */
var HistorySummary = (typeof globalThis !== "undefined" && globalThis.HistorySummary) ? globalThis.HistorySummary : ((typeof HistorySummary !== "undefined") ? HistorySummary : {});
/* Node suites require() the facade directly while the browser loads
 * the parts via <script> order. Pull the parts through the module loader
 * WITHOUT naming `require` (checkJs runs browser libs — a bare require()
 * call is TS2591 there; tx.js precedent). module.require resolves relative
 * to THIS file, like require(). */
var __partRequire = null;
try {
  if (typeof module !== "undefined" && module && /** @type {any} */ (module).require && /** @type {any} */ (module).require.bind) __partRequire = /** @type {any} */ (module).require.bind(module);
} catch (e) { __partRequire = null; }
if (__partRequire && (!HistorySummary.SUMMARIZERS || !HistorySummary.SUMMARIZERS[0])) {
  try { __partRequire("./history-families-trade.js"); } catch (e) {}
  try { __partRequire("./history-families-pools.js"); } catch (e) {}
  try { __partRequire("./history-families-gov.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.HistorySummary) HistorySummary = globalThis.HistorySummary;
}
(function () {
  "use strict";

  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  var ID_RE = /\b1\.(2|3|19)\.\d+\b/g;

  var _assetCache = {}; // "chainId|assetId" -> { sym, prec }

  /* Current chain id string, or null when unreadable (cache stays empty).
   * Accessor is Chain.status().chainId (cf. vanilla/js/sdk/chain.js
   * lastStatus + vanilla/js/api/signmode.js precedent); Chain or
   * Chain.status may be absent, hence the guards. Null falls back to a
   * "|id" cache key, still correct within a session. */
  function chainId() {
    try {
      if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
        var st = Chain.status();
        if (st && typeof st.chainId === "string") return st.chainId;
      }
    } catch (e) { /* null below */ }
    return null;
  }

  /* Seed the cache from the generated table on matching chain only. */
  function seedFromTable(id) {
    try {
      if (typeof PoolAssets === "undefined" || !PoolAssets || !PoolAssets.assets) return;
      if (!id || PoolAssets.chain_id !== id) return;
      var table = PoolAssets.assets, k;
      for (k in table) {
        if (Object.prototype.hasOwnProperty.call(table, k) && table[k]) {
          _assetCache[id + "|" + k] = { sym: String(table[k].sym), prec: table[k].prec };
        }
      }
    } catch (e) { /* live joins cover */ }
  }

  /* Collect every 1.2.x/1.3.x/1.19.x id in the page payloads (generic pass). */
  function collect(rows) {
    var out = { acc: [], asset: [], pool: [] }, seen = {};
    (rows || []).forEach(function (r) {
      var s = "";
      try { s = JSON.stringify(r.op); } catch (e) { s = ""; }
      var m = s.match(ID_RE) || [];
      m.forEach(function (id) {
        if (seen[id]) return; seen[id] = 1;
        if (id.indexOf("1.2.") === 0) out.acc.push(id);
        else if (id.indexOf("1.3.") === 0) out.asset.push(id);
        else out.pool.push(id);
      });
    });
    return out;
  }

  /* Two batch joins; misses stay missing; never throws. */
  async function join(ids, id) {
    var assets = {}, names = {};
    try {
      if (ids.asset.length) {
        var uncached = ids.asset.filter(function (a) { return !(_assetCache[(id || "") + "|" + a]); });
        if (uncached.length) {
          var dbId = await Chain.db();
          var objs = await Chain.call(dbId, "lookup_asset_symbols", [uncached]);
          (objs || []).forEach(function (a) {
            if (a && a.id && typeof a.precision === "number") {
              _assetCache[(id || "") + "|" + a.id] = { sym: a.symbol || a.id, prec: a.precision };
            }
          });
        }
        ids.asset.forEach(function (a) {
          var hit = _assetCache[(id || "") + "|" + a];
          if (hit) assets[a] = hit;
        });
      }
    } catch (e) { /* assets stay missing */ }
    try {
      if (ids.acc.length) {
        var dbId2 = await Chain.db();
        var rows = await Chain.call(dbId2, "get_accounts", [ids.acc]);
        (rows || []).forEach(function (a) { if (a && a.id) names[a.id] = a.name || a.id; });
      }
    } catch (e) { /* names stay missing */ }
    return { assets: assets, names: names };
  }

  /* {amount, asset_id} -> human string or em dash (never raw). */
  function amount(leg, assets) {
    if (!leg || leg.amount === undefined || leg.amount === null || !leg.asset_id) return t("settings.dash", "—");
    var meta = (assets || {})[String(leg.asset_id)];
    if (!meta || typeof meta.prec !== "number" || !/^-?\d+$/.test(String(leg.amount))) return t("settings.dash", "—");
    try { return Format.formatAmount(String(leg.amount), meta.prec) + " " + meta.sym; }
    catch (e) { return t("settings.dash", "—"); }
  }

  /* Account id -> name or raw id (identifiers may show raw; money may not). */
  function name(id, names) { return (names && names[id]) || String(id); }

  /* Asset id -> symbol or raw id (symbols come from the asset join;
   * identifiers may show raw; money may not). @param {any} id asset id.
   * @param {Object} assets asset join. @returns {string} Symbol or raw id. */
  function sym(id, assets) {
    var meta = (assets || {})[String(id)];
    return meta ? meta.sym : String(id);
  }

  /* Bare integer + separate asset id -> human string or em dash (never raw).
   * For fee-pool funding and SameT balances the chain stores a bare share_type
   * plus an asset id in another field; pair them explicitly here instead of
   * guessing. @param {any} raw bare integer (string or number).
   * @param {any} id asset id. @param {Object} assets asset join.
   * @returns {string} Human amount or em dash. */
  function bare(raw, id, assets) {
    if (raw === undefined || raw === null || id === undefined || id === null) {
      return t("settings.dash", "—");
    }
    return amount({ amount: String(raw), asset_id: String(id) }, assets);
  }

  /* Viewer-side test for tag 0: raw id match OR resolved-name match (the
   * viewed account may arrive in name form, so compare String(viewed)
   * against both p.from and J.names[p.from]). Identifier compare only.
   * @param {any} sideId payload account id. @param {any} viewed enrich's
   *   viewer (id or name form). @param {Object} names id->name join.
   * @returns {boolean} True when the side is the viewer. */
  function isSide(sideId, viewed, names) {
    if (sideId === undefined || sideId === null || viewed === undefined || viewed === null) return false;
    var v = String(viewed), s = String(sideId);
    if (v === s) return true;
    if (names && names[s] && v === String(names[s])) return true;
    return false;
  }

  /* Signed {amount, asset_id} -> "+1.00000 BTS" / "-5.0000 USD" for tag 3
   * deltas (share_type is signed int64; delta_debt may be negative to issue
   * new debt — market.hpp:190). Minus is U+2212 per brief. Em dash on any
   * miss, never raw. @param {any} leg payload asset object.
   * @param {Object} assets asset join. @returns {string} Signed display. */
  function signed(leg, assets) {
    var dash = t("settings.dash", "—");
    if (!leg || leg.amount === undefined || leg.amount === null || !leg.asset_id) return dash;
    var raw = String(leg.amount);
    var neg = raw.charAt(0) === "-";
    var mag = neg ? raw.slice(1) : raw;
    var meta = (assets || {})[String(leg.asset_id)];
    if (!meta || typeof meta.prec !== "number" || !/^\d+$/.test(mag)) return dash;
    try { return (neg ? "−" : "+") + Format.formatAmount(mag, meta.prec) + " " + meta.sym; }
    catch (e) { return dash; }
  }

  /* Op tag number from a history row (same shapes as opTypeOf). */
  function tagOf(row) {
    if (!row || typeof row !== "object") return null;
    if (Array.isArray(row.op) && typeof row.op[0] === "number") return row.op[0];
    if (typeof row.op_type === "number") return row.op_type;
    if (typeof row.type === "number") return row.type;
    return null;
  }

  /* Family dispatch registry: populated by vanilla/js/api/history-families-*.js
   * (trade/pools/gov, tagged BEFORE this facade in index.html — market-desk.js
   * facade + fill files precedent). Preserved by reference — enrich reads it
   * at call time, so late-attached families resolve without re-wiring.
   * Unknown -> no summary. */
  var SUMMARIZERS = (typeof globalThis !== "undefined" && globalThis.HistorySummary &&
    globalThis.HistorySummary.SUMMARIZERS) ? globalThis.HistorySummary.SUMMARIZERS : {};

  /* Enrich rows in place (adds _summary); never rejects. */
  async function enrich(rows, viewedAcctId) {
    try {
      var id = chainId();
      seedFromTable(id);
      var ids = collect(rows);
      var J = await join(ids, id);
      (rows || []).forEach(function (r) {
        try {
          var tag = tagOf(r);
          var fn = (tag !== null && SUMMARIZERS[tag]) || null;
          if (fn) {
            var s = fn(r.op && r.op[1], J, viewedAcctId);
            if (typeof s === "string" && s) r._summary = s;
          }
        } catch (e) { /* label-only fallback stands */ }
      });
    } catch (e) { /* rows render as today */ }
    return rows;
  }
  HistorySummary.enrich = enrich;
  HistorySummary._test = { collect: collect, amount: amount, name: name, tagOf: tagOf, SUMMARIZERS: SUMMARIZERS };
  if (typeof globalThis !== "undefined") { globalThis.HistorySummary = HistorySummary; }
})();

if (typeof globalThis !== "undefined" && typeof globalThis.HistorySummary === "undefined") { globalThis.HistorySummary = HistorySummary; }
if (typeof module !== "undefined") { module.exports = HistorySummary; }
