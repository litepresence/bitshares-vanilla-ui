/* Asset: asset read joins + fee-schedule grouping (no DOM, no signing).
 * Owns: issuedBy (get_assets_by_issuer pages), describe (asset+bitasset/
 *   dynamic join via Explorer.asset when loaded, else direct
 *   lookup_asset_symbols + get_objects), feeSchedule (get_global_properties
 *   grouped by op id). All amount/ratio/percent leaves stay RAW strings/ints
 *   (formatting happens in views, never here).
 * Consumes: Chain.db/.call (sole socket owner), Explorer.asset when loaded,
 *   Account.resolve (issuer-name fallback in issuedBy/describe).
 * Globals/side effects: exposes global Asset only; no DOM, storage, or key
 *   material. Builders + percent/ratio helpers live in asset-ops.js
 *   (global AssetOps, loaded after this file); buildFeed reuses
 *   Asset.describe from there.
 * Created by: building-vanilla-slices skill, slice-10-assets plan Task 2.
 * Repaired by: slice-10 audit fix B2 (reads/builders split, behavior-identical;
 *   builders + sendAndProve + pct/ratio helpers moved to asset-ops.js).
 * CHAIN TRUTH (#4 wins): get_assets_by_issuer(name_or_id, start, limit) <-
 *   database_api.hpp:460-461; lookup_asset_symbols <- :444;
 *   get_global_properties <- :214; MCR/MSSR ratio ints over 1000
 *   (MCR 1750 = 175%, MSSR 1500 = 150%) <- config.hpp:102-117 +
 *   asset.hpp:165-189. Op-data keys mirror #3 bitshares-api.js :2145-2204
 *   (builders in asset-ops.js produce the JSON; serializers in tx.js).
 * NAMED-ERROR HOMES: not-connected (socket failures); unknown-asset
 *   (describe null answer); unknown-account (issuedBy unresolvable input).
 */
var Asset = (function () {
  "use strict";

  var CORE_ASSET = "1.3.0";
  var ISSUED_PAGE_MAX = 100;
  var ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var OP_NAMES = { 10: "asset_create", 11: "asset_update",
    12: "asset_update_bitasset", 13: "asset_update_feed_producers",
    14: "asset_issue", 15: "asset_reserve", 19: "asset_publish_feed" };

  /* One database-API round trip; "not-connected" when no socket is open. */
  async function _dbCall(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); } catch (e) {
      var m = (e && e.message) ? e.message : String(e || "");
      if (m.indexOf("not connected") !== -1) throw new Error("not-connected");
      throw e;
    }
  }

  /* On-chain description -> nft_object or null (plain text / missing key /
   * bad JSON all yield null — never throws). */
  function _parseNft(description) {
    if (typeof description !== "string" || description.indexOf("{") === -1) return null;
    try {
      var nft = JSON.parse(description).nft_object;
      return (nft && typeof nft === "object" && !Array.isArray(nft)) ? nft : null;
    } catch (e) { return null; }
  }

  /* Issued-by-account page: [{id, symbol, precision, issuer_id, is_smartcoin,
   * is_prediction_market, supply_raw}] with supply raw-string-or-null (views
   * use describe() for full joins). Params: accountId (1.2.N, or a name
   * resolved via Account.resolve); start asset-id bound (default "1.3.0");
   * limit 1..100 (default 100). Empty issuer yields []. Fails
   * "unknown-account" / "not-connected". */
  async function issuedBy(accountId, start, limit) {
    var id = accountId;
    if (typeof id !== "string" || !id) throw new Error("unknown-account");
    if (!ACCOUNT_RE.test(id)) {
      if (typeof Account === "undefined" || !Account.resolve) throw new Error("unknown-account");
      try { id = (await Account.resolve(id)).id; } catch (e) { throw new Error("unknown-account"); }
    }
    var from = (typeof start === "string" && ASSET_RE.test(start)) ? start : "1.3.0";
    var lim = parseInt(limit, 10);
    if (!(lim >= 1)) lim = ISSUED_PAGE_MAX;
    var rows = await _dbCall("get_assets_by_issuer", [id, from, Math.min(lim, ISSUED_PAGE_MAX)]);
    return (rows || []).map(function (r) {
      var dyn = r.dynamic || null, supply = null;
      if (dyn && dyn.current_supply !== undefined && dyn.current_supply !== null) supply = String(dyn.current_supply);
      else if (r.current_supply !== undefined && r.current_supply !== null) supply = String(r.current_supply);
      return { id: r.id, symbol: r.symbol, precision: r.precision, issuer_id: r.issuer,
        is_smartcoin: !!r.bitasset_data_id, is_prediction_market: r.is_prediction_market === true, supply_raw: supply };
    });
  }

  /* Full asset join for a symbol or 1.3.x id (Explorer.asset when loaded,
   * else direct lookup + get_objects join). Returns {id, symbol, precision,
   * issuer_id, issuer_name ("" when unresolvable — display-only),
   * max_supply_raw, supply_raw (null without dynamic join),
   * market_fee_hundredths (raw int), permissions, flags, description, nft
   * (parsed object or null), is_smartcoin, is_prediction_market, bitasset
   * (null for UIAs; else {feed_lifetime_sec, minimum_feeds, mcr, mssr,
   * short_backing_asset} with mcr/mssr from current_feed when present else
   * null)}. Non-MPA yields is_smartcoin:false, never an error. Fails
   * "unknown-asset" / "not-connected". */
  async function describe(symbolOrId) {
    if (typeof symbolOrId !== "string" || !symbolOrId) throw new Error("unknown-asset");
    var join = null;
    if (typeof Explorer !== "undefined" && Explorer.asset) {
      try { join = await Explorer.asset(symbolOrId); } catch (e) {
        if (e && e.message === "not-connected") throw e;
        throw new Error("unknown-asset");
      }
    } else {
      var found = null;
      if (ASSET_RE.test(symbolOrId)) {
        var byId = await _dbCall("get_objects", [[symbolOrId]]);
        found = byId && byId[0];
      } else {
        var rows = await _dbCall("lookup_asset_symbols", [[symbolOrId]]);
        found = rows && rows[0];
      }
      if (!found) throw new Error("unknown-asset");
      var want = [];
      if (found.bitasset_data_id) want.push(found.bitasset_data_id);
      if (found.dynamic_asset_data_id) want.push(found.dynamic_asset_data_id);
      var objs = want.length ? await _dbCall("get_objects", [want]) : [];
      var k = 0;
      join = { asset: found, bitasset: found.bitasset_data_id ? (objs[k++] || null) : null,
        dynamic: found.dynamic_asset_data_id ? (objs[k++] || null) : null, is_smartcoin: !!found.bitasset_data_id };
    }
    var a = join.asset;
    if (!a) throw new Error("unknown-asset");
    var opts = a.options || {}, dynObj = join.dynamic || {}, bitObj = join.bitasset || null;
    var issuerName = "";
    if (a.issuer) {
      try {
        var accRows = await _dbCall("get_accounts", [[a.issuer]]);
        if (accRows && accRows[0]) issuerName = accRows[0].name || "";
      } catch (e) { if (e && e.message === "not-connected") throw e; }
    }
    var description = (typeof opts.description === "string") ? opts.description : "";
    var bitasset = null;
    if (join.is_smartcoin && bitObj) {
      var bOpts = bitObj.options || {}, feed = bitObj.current_feed || null;
      bitasset = { feed_lifetime_sec: bOpts.feed_lifetime_sec !== undefined ? bOpts.feed_lifetime_sec : null,
        minimum_feeds: bOpts.minimum_feeds !== undefined ? bOpts.minimum_feeds : null,
        mcr: feed && feed.maintenance_collateral_ratio !== undefined ? feed.maintenance_collateral_ratio : null,
        mssr: feed && feed.maximum_short_squeeze_ratio !== undefined ? feed.maximum_short_squeeze_ratio : null,
        short_backing_asset: bOpts.short_backing_asset || null };
    }
    return { id: a.id, symbol: a.symbol, precision: a.precision, issuer_id: a.issuer, issuer_name: issuerName,
      max_supply_raw: (opts.max_supply !== undefined && opts.max_supply !== null) ? String(opts.max_supply) : "0",
      supply_raw: (dynObj.current_supply !== undefined && dynObj.current_supply !== null) ? String(dynObj.current_supply) : null,
      market_fee_hundredths: opts.market_fee_percent !== undefined ? opts.market_fee_percent : 0,
      permissions: opts.issuer_permissions !== undefined ? opts.issuer_permissions : 0,
      flags: opts.flags !== undefined ? opts.flags : 0, description: description, nft: _parseNft(description),
      is_smartcoin: !!join.is_smartcoin, is_prediction_market: bitObj ? !!bitObj.is_prediction_market : false, bitasset: bitasset };
  }

  /* Fee schedule grouped by op id (slice-9 Fees-tab scope). Returns
   * {fee_asset_id ("1.3.0"), fee_asset_precision, fees: [{opId, name,
   * fee_raw (raw string, null when the op has no flat fee), price_per_kbyte
   * (only when the op charges per kbyte)}]}. Fails "not-connected". */
  async function feeSchedule() {
    var g = await _dbCall("get_global_properties", []);
    var params = g && g.parameters && g.parameters.current_fees && g.parameters.current_fees.parameters;
    if (!Array.isArray(params)) throw new Error("bad-fee-shape");
    var core = await _dbCall("get_assets", [[CORE_ASSET]]);
    var prec = (core && core[0] && core[0].precision !== undefined) ? core[0].precision : 5;
    return { fee_asset_id: CORE_ASSET, fee_asset_precision: prec,
      fees: params.map(function (entry) {
        var p = entry[1] || {};
        var row = { opId: entry[0], name: OP_NAMES[entry[0]] || ("op_" + entry[0]),
          fee_raw: (p.fee !== undefined && p.fee !== null) ? String(p.fee) : null };
        if (p.price_per_kbyte !== undefined && p.price_per_kbyte !== null) row.price_per_kbyte = p.price_per_kbyte;
        return row;
      }) };
  }

  return { issuedBy: issuedBy, describe: describe, feeSchedule: feeSchedule };
})();

if (typeof module !== "undefined") { module.exports = Asset; }
