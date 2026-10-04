/* history-summary.js — one-line human summaries for account-history rows.
 * Owns: enrich() (collect ids -> 2 batch joins over a chain-keyed
 *   asset-meta cache boot-seeded from PoolAssets on matching chain_id ->
 *   per-family summarizers -> row._summary), shared amount()/name()
 *   helpers. Label-only fallback for anything unrecognized; enrich never
 *   rejects (degraded rows render as today). No DOM, no signing.
 * Consumes: Chain.db/.call/.status, Format.formatAmount, PoolAssets (optional),
 *   I18n.t (guarded local copy). Exposes global HistorySummary.
 * Created by: history one-liners plan (spec docs/superpowers/specs/2026-10-04-history-one-liners-design.md). */
var HistorySummary = (function () {
  "use strict";
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }
  var ID_RE = /\b1\.(2|3|19)\.\d+\b/g;
  var _assetCache = {}; // "chainId|assetId" -> { sym, prec }
  var _chainId = null;

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
  /* Op tag number from a history row (same shapes as opTypeOf). */
  function tagOf(row) {
    if (!row || typeof row !== "object") return null;
    if (Array.isArray(row.op) && typeof row.op[0] === "number") return row.op[0];
    if (typeof row.op_type === "number") return row.op_type;
    if (typeof row.type === "number") return row.type;
    return null;
  }
  /* Family dispatch table is filled by Tasks 3-5; unknown -> no summary. */
  var SUMMARIZERS = {};
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
  return { enrich: enrich, _test: { collect: collect, amount: amount, name: name, tagOf: tagOf, SUMMARIZERS: SUMMARIZERS } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.HistorySummary === "undefined") { globalThis.HistorySummary = HistorySummary; }
if (typeof module !== "undefined") { module.exports = HistorySummary; }
