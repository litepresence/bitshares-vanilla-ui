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
  /* Family summarizers (Tasks 3-5 table): payload + joins + viewer ->
   * human one-liner, or null when the payload is unusable (caller keeps the
   * op label). Field paths verified against reference #4
   * (bitshares-core/libraries/protocol); #4 wins conflicts — notably tag 77
   * limit_order_update carries seller/order + optional new_price/delta, NOT
   * tag 1's sell/buy legs, so it summarizes the order id only. */
  /* Tag 0 transfer (transfer.hpp:45): direction vs the viewer, id or name
   * form; strangers see the generic three-party line. */
  function sumTransfer(p, J, viewed) {
    if (!p || !p.amount || p.from === undefined || p.to === undefined) return null;
    var amt = amount(p.amount, J.assets);
    var fromIs = isSide(p.from, viewed, J.names);
    var toIs = isSide(p.to, viewed, J.names);
    if (fromIs && !toIs) {
      return t("account.sum_transfer_send", "Sent %(amount)s to %(to)s",
        { amount: amt, to: name(p.to, J.names) });
    }
    if (toIs && !fromIs) {
      return t("account.sum_transfer_recv", "Received %(amount)s from %(from)s",
        { amount: amt, from: name(p.from, J.names) });
    }
    return t("account.sum_transfer", "Transfer %(amount)s from %(from)s to %(to)s",
      { amount: amt, from: name(p.from, J.names), to: name(p.to, J.names) });
  }
  /* Tag 1 limit_order_create (market.hpp:72): sell leg + minimum buy leg. */
  function sumOrderCreate(p, J) {
    if (!p || !p.amount_to_sell || !p.min_to_receive) return null;
    return t("account.sum_order_create", "Offered %(sell)s for at least %(buy)s",
      { sell: amount(p.amount_to_sell, J.assets), buy: amount(p.min_to_receive, J.assets) });
  }
  /* Tag 2 limit_order_cancel (market.hpp:145): order id stays raw (1.7.x
   * ids are identifiers, and the id join only covers 1.2/1.3/1.19). */
  function sumOrderCancel(p) {
    if (!p || !p.order) return null;
    return t("account.sum_order_cancel", "Cancelled order %(order)s", { order: String(p.order) });
  }
  /* Tag 77 limit_order_update (market.hpp:117): order id only (see note). */
  function sumOrderUpdate(p) {
    if (!p || !p.order) return null;
    return t("account.sum_order_update", "Updated order %(order)s", { order: String(p.order) });
  }
  /* Tag 3 call_order_update (market.hpp:171): SIGNED collateral/debt legs. */
  function sumCallUpdate(p, J) {
    if (!p || !p.delta_collateral || !p.delta_debt) return null;
    return t("account.sum_call_update", "Adjusted position: %(coll)s collateral, %(debt)s debt",
      { coll: signed(p.delta_collateral, J.assets), debt: signed(p.delta_debt, J.assets) });
  }
  /* Tag 4 fill_order, virtual (market.hpp:206): pays/receives legs. */
  function sumFill(p, J) {
    if (!p || !p.pays || !p.receives) return null;
    return t("account.sum_fill", "Filled: paid %(pays)s, received %(receives)s",
      { pays: amount(p.pays, J.assets), receives: amount(p.receives, J.assets) });
  }
  /* Tag 19 asset_publish_feed (asset_ops.hpp:462): symbol from the asset
   * join (payload carries the bare asset_id), publisher named. */
  function sumFeed(p, J) {
    if (!p || !p.publisher || !p.asset_id) return null;
    var meta = (J.assets || {})[String(p.asset_id)];
    return t("account.sum_feed", "Feed published for %(asset)s by %(publisher)s",
      { asset: meta ? meta.sym : String(p.asset_id), publisher: name(p.publisher, J.names) });
  }
  /* Tag 6 account_update (account.hpp:136): account only; no field claims
   * beyond it (options/authorities changes render in raw JSON). */
  function sumAccountUpdate(p, J) {
    if (!p || !p.account) return null;
    return t("account.sum_account_update", "Account updated: %(account)s",
      { account: name(p.account, J.names) });
  }
  /* Family dispatch table is filled by Tasks 3-5; unknown -> no summary. */
  var SUMMARIZERS = {
    0: sumTransfer,
    1: sumOrderCreate,
    2: sumOrderCancel,
    77: sumOrderUpdate,
    3: sumCallUpdate,
    4: sumFill,
    19: sumFeed,
    6: sumAccountUpdate
  };
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
