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

  /* Op index -> short snake name, FC_REFLECT order <- #4
   *   libraries/protocol/include/graphene/protocol/operations.hpp:56-133.
   * PROVENANCE: value-copy of the OP_NAMES table in vanilla/js/explorer.js
   *   :27-47 (same order, same source). Copied, not imported: explorer.js
   *   does not export the table (ops-ui.js precedent). Unknown future
   *   indexes fall back to "op_<id>" — never throw, a future op must not
   *   break reads. */
  var OP_NAMES = ["transfer", "limit_order_create", "limit_order_cancel", "call_order_update",
    "fill_order", "account_create", "account_update", "account_whitelist", "account_upgrade",
    "account_transfer", "asset_create", "asset_update", "asset_update_bitasset",
    "asset_update_feed_producers", "asset_issue", "asset_reserve", "asset_fund_fee_pool",
    "asset_settle", "asset_global_settle", "asset_publish_feed", "witness_create",
    "witness_update", "proposal_create", "proposal_update", "proposal_delete",
    "withdraw_permission_create", "withdraw_permission_update", "withdraw_permission_claim",
    "withdraw_permission_delete", "committee_member_create", "committee_member_update",
    "committee_member_update_global_parameters", "vesting_balance_create",
    "vesting_balance_withdraw", "worker_create", "custom", "assert", "balance_claim",
    "override_transfer", "transfer_to_blind", "blind_transfer", "transfer_from_blind",
    "asset_settle_cancel", "asset_claim_fees", "fba_distribute", "bid_collateral",
    "execute_bid", "asset_claim_pool", "asset_update_issuer", "htlc_create", "htlc_redeem",
    "htlc_redeemed", "htlc_extend", "htlc_refund", "custom_authority_create",
    "custom_authority_update", "custom_authority_delete", "ticket_create", "ticket_update",
    "liquidity_pool_create", "liquidity_pool_delete", "liquidity_pool_deposit",
    "liquidity_pool_withdraw", "liquidity_pool_exchange", "samet_fund_create",
    "samet_fund_delete", "samet_fund_update", "samet_fund_borrow", "samet_fund_repay",
    "credit_offer_create", "credit_offer_delete", "credit_offer_update",
    "credit_offer_accept", "credit_deal_repay", "credit_deal_expired",
    "liquidity_pool_update", "credit_deal_update", "limit_order_update"];
  /* Virtual execution events (never signed, shown with a marker only) <-
   *   operations.hpp "// VIRTUAL" marks; same set as explorer.js VIRTUAL. */
  var VIRTUAL = { 4: 1, 42: 1, 44: 1, 46: 1, 51: 1, 53: 1, 74: 1 };
  /* Fee-group membership. CONCEPTS from #1 Blockchain/Fees.jsx:18-42 (same
   *   five groups, same members for the ops #1 knew: 0-43 minus gaps, plus
   *   49/50/52, 59-63, 69-73). #1 predates the newer ids, so those are
   *   assigned here to the closest group (documented, not chain-derived):
   *   blind/virtual leftovers join by family (40 general, 42/44 asset,
   *   46 market, 51/53 general with the other HTLCs); custom-authority
   *   54-56 joins business (with custom/assert); tickets 57-58, samet
   *   64-68 and credit extras 74/76 join general (with vesting/htlc/credit);
   *   pool-update 75 and limit-update 77 join market (with pools/orders). */
  var FEE_GROUPS = {
    general: [0, 25, 26, 27, 28, 32, 33, 37, 39, 40, 41, 49, 50, 51, 52, 53,
      57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 76],
    asset: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 38, 42, 43, 44, 47, 48],
    market: [1, 2, 3, 4, 45, 46, 59, 60, 61, 62, 63, 75, 77],
    account: [5, 6, 7, 8, 9],
    business: [20, 21, 22, 23, 24, 29, 30, 31, 34, 35, 36, 54, 55, 56]
  };

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

  /* In-flight describe memo (perf: per-row symbol joins fire same-tick
   *   bursts for repeat ids — one join per id per tick, never two. Pending
   *   only: entries clear on settle, so no completed data is cached
   *   (issuer/supply legs stay fresh). Same promise shared, identical. */
  var _describePending = {};

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
    /* Chain truth: asset symbols are always UPPERCASE — user input is
     * uppercased here (centrally, so every asset field is case-forgiving);
     * object ids match ASSET_RE either way and pass through unchanged. */
    if (!ASSET_RE.test(symbolOrId)) symbolOrId = symbolOrId.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(_describePending, symbolOrId)) {
      return _describePending[symbolOrId];
    }
    var p = _describeInner(symbolOrId);
    _describePending[symbolOrId] = p;
    p.then(function () { delete _describePending[symbolOrId]; },
      function () { delete _describePending[symbolOrId]; });
    return p;
  }

  /* Inner describe body (unchanged contract — see describe above). */
  async function _describeInner(symbolOrId) {
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

  /* Fee schedule grouped by op id (slice-9 Fees-tab scope, punchlist-hardened).
   * Returns {fee_asset_id ("1.3.0"), fee_asset_precision, scale
   * (current_fees.scale, default 10000), network_percent_of_fee (or null
   * when the node omits it), groups (fresh id-array copy per group),
   * ltm_required ([5,7,20,21,34] <- #1 Fees.jsx:45: registrar-paid ops whose
   * standard fee is unavailable), fees: [{opId, name (OP_NAMES above, else
   * "op_<id>"), virtual, group (group key or null), raw ({fee-param key ->
   * UNSCALED raw string, every key the schedule carries}), scaled ({same
   * keys -> raw * scale / 10000, BigInt floor <- #1 Fees.jsx:106, never
   * float}), fee_raw (LEGACY for asset-feed-ui.js feeSection: scaled "fee"
   * string, null when the op carries no flat fee), price_per_kbyte (LEGACY
   * scaled number, absent when the schedule carries none)}]}. Only
   * additive fields were added — issuedBy/describe/feeSchedule shapes that
   * older callers use are unchanged (fee_raw stays null-for-no-flat-fee so
   * the embedded section keeps its dash rows; its values are now correctly
   * scaled). Fails "not-connected" / "bad-fee-shape". */
  async function feeSchedule() {
    var g = await _dbCall("get_global_properties", []);
    var gp = g && g.parameters;
    var cf = gp && gp.current_fees;
    var params = cf && cf.parameters;
    if (!Array.isArray(params)) throw new Error("bad-fee-shape");
    var scale = (cf && cf.scale !== undefined && cf.scale !== null) ? cf.scale : 10000;
    var netPct = (gp && gp.network_percent_of_fee !== undefined && gp.network_percent_of_fee !== null)
      ? gp.network_percent_of_fee : null;
    var core = await _dbCall("get_assets", [[CORE_ASSET]]);
    var prec = (core && core[0] && core[0].precision !== undefined) ? core[0].precision : 5;
    function groupOf(id) {
      for (var name in FEE_GROUPS) if (FEE_GROUPS[name].indexOf(id) !== -1) return name;
      return null;
    }
    /* scaledOf: raw chain int string × scale / 10000, floored BigInt money
     * math (fee_schedule.hpp:221; #1 Fees.jsx:106 does the same in float —
     * we keep integers per principle #6). Non-integer input falls back to
     * the raw string (never throws — one odd param must not blank fees). */
    function scaledOf(raw) {
      try { return (BigInt(String(raw)) * BigInt(scale) / 10000n).toString(); }
      catch (e) { return String(raw); }
    }
    return { fee_asset_id: CORE_ASSET, fee_asset_precision: prec, scale: scale,
      network_percent_of_fee: netPct,
      groups: { general: FEE_GROUPS.general.slice(), asset: FEE_GROUPS.asset.slice(),
        market: FEE_GROUPS.market.slice(), account: FEE_GROUPS.account.slice(),
        business: FEE_GROUPS.business.slice() },
      ltm_required: [5, 7, 20, 21, 34],
      fees: params.map(function (entry) {
        var id = entry[0], fp = entry[1] || {}, raw = {}, scaled = {}, k;
        for (k in fp) {
          if (fp[k] === undefined || fp[k] === null) continue;
          raw[k] = String(fp[k]);
          scaled[k] = scaledOf(fp[k]);
        }
        var row = { opId: id,
          name: (id >= 0 && id < OP_NAMES.length) ? OP_NAMES[id] : ("op_" + id),
          virtual: !!VIRTUAL[id], group: groupOf(id), raw: raw, scaled: scaled,
          fee_raw: (scaled.fee !== undefined) ? scaled.fee : null };
        if (scaled.price_per_kbyte !== undefined) row.price_per_kbyte = Number(scaled.price_per_kbyte);
        return row;
      }) };
  }

  return { issuedBy: issuedBy, describe: describe, feeSchedule: feeSchedule };
})();

if (typeof module !== "undefined") { module.exports = Asset; }
