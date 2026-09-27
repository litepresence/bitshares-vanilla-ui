/* Credit-samet: Same-T fund (1.20.x) reads + op-data builders.
 * Owns: fund/funds/fundsByOwner/fundsByAsset reads (symbols joined via
 *   lookup_asset_symbols) + five builders for ops 64/66/65/67/68 ([opId,
 *   opData], zero-placeholder fee for live fee-fill). Split OUT of credit.js
 *   on the ~380-line cap (slice-13 plan, pre-authorized — no new plan needed).
 *   Rate conversion reuses Credit.rateHumanToUnits (the ONLY fee-rate
 *   converter); chain I/O goes through Chain directly with a local _dbCall
 *   (small deliberate duplication per AGENTS.md §4.5 rule 5 — no clever
 *   shared-abstraction layer). No DOM, no signing. Consumes: Chain.db/.call,
 *   Credit.rateHumanToUnits; exposes global CreditSamet only.
 *   Created by: building-vanilla-slices skill, slice-13-credit plan Task 2.
 * CHAIN TRUTH (#4 wins): op ids 64-68 <- operations.hpp:120-124; fields <-
 *   samet_fund.hpp:38 (64 fee 1 BTS)/:58 (65 fee 0)/:76 (66, CANONICAL
 *   new_fee_rate)/:96 (67)/:115 (68); reads <- database_api.hpp:881-925
 *   ((limit?, start_id?) pageable); same-tx borrow/repay ORDER left to
 *   ambiguity-D outcome — builders take both, views gate.
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings. Number() NEVER here.
 * NAMED ERRORS: not-connected / unknown-fund / unknown-account / method-missing.
 */
var CreditSamet = (function () {
  "use strict";
  var CORE_ASSET = "1.3.0";
  var FUND_RE = /^1\.20\.\d+$/, ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var DIGITS_RE = /^\d+$/, SIGNED_RE = /^-?\d+$/;
  var PAGE_DEFAULT = 101; /* api_limit_get_samet_funds */

  function _assertId(id, re, name) { if (typeof id !== "string" || !re.test(id)) throw new Error(name + " must match " + re + ", got: " + JSON.stringify(id)); }
  function _assertDigits(raw, name) { if (typeof raw !== "string" || !DIGITS_RE.test(raw)) throw new Error(name + " must be a digit string, got: " + JSON.stringify(raw)); }
  function _assertSigned(raw, name) { if (typeof raw !== "string" || !SIGNED_RE.test(raw)) throw new Error(name + " must be an integer string, got: " + JSON.stringify(raw)); }
  function _isSocketError(e) { return /not connected|socket closed|connect timeout/i.test(String((e && e.message) || e || "")); }
  function _isMissingMethod(e) { return /unknown method|method not found|no method|bad method/i.test(String((e && e.message) || e || "")); }
  function _isUnknownAccount(e) { return /tied to an account|unknown account|no such account/i.test(String((e && e.message) || e || "")); }
  /* One database-API round trip; socket failures -> "not-connected", else verbatim. */
  async function _dbCall(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); }
    catch (e) {
      if (_isSocketError(e)) throw new Error("not-connected");
      if (_isMissingMethod(e)) throw new Error("method-missing (" + method + ")");
      if (_isUnknownAccount(e)) throw new Error("unknown-account");
      throw e;
    }
  }
  function _rateHumanToUnits(human) {
    if (typeof Credit === "undefined" || !Credit.rateHumanToUnits) throw new Error("credit-unavailable (credit.js first)");
    return Credit.rateHumanToUnits(human);
  }
  /* Raw fund -> plain row (amounts raw strings). */
  function _normFund(f) {
    if (!f || typeof f !== "object" || !f.id) throw new Error("unknown-fund");
    return { id: String(f.id), owner: String(f.owner_account), asset_id: String(f.asset_type),
      balance_raw: String(f.balance), rate_units: f.fee_rate, unpaid_raw: String(f.unpaid_amount) };
  }
  /* lookup_asset_symbols join: {sym, prec} for the fund asset; misses degrade to bare ids. */
  async function _withSyms(normed) {
    var ids = [], seen = {};
    normed.forEach(function (r) { if (!seen[r.asset_id]) { seen[r.asset_id] = 1; ids.push(r.asset_id); } });
    var byId = {};
    if (ids.length) {
      var objs = await _dbCall("lookup_asset_symbols", [ids]);
      (objs || []).forEach(function (a) { if (a && a.id) byId[a.id] = a; });
    }
    return normed.map(function (r) {
      var a = byId[r.asset_id] || {};
      r.sym = a.symbol || r.asset_id; r.prec = (typeof a.precision === "number" ? a.precision : null); return r;
    });
  }
  /* Single fund by 1.20.x id. Unknown -> "unknown-fund". */
  async function fund(id) {
    _assertId(id, FUND_RE, "id");
    var rows = await _dbCall("get_objects", [[id]]);
    if (!rows || !rows[0]) throw new Error("unknown-fund (" + id + ")");
    return _normFund(rows[0]);
  }
  /* Fund list + by-owner/by-asset with symbol join. */
  async function funds(opts) {
    opts = opts || {};
    var limit = (opts.limit === undefined || opts.limit === null) ? PAGE_DEFAULT : opts.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_DEFAULT) throw new Error("limit must be 1-" + PAGE_DEFAULT);
    return _withSyms((await _dbCall("list_samet_funds", [limit, opts.startId || null]) || []).map(_normFund));
  }
  async function fundsByOwner(nameOrId, opts) {
    opts = opts || {};
    return _withSyms((await _dbCall("get_samet_funds_by_owner", [String(nameOrId), opts.limit || null, opts.startId || null]) || []).map(_normFund));
  }
  async function fundsByAsset(symOrId, opts) {
    opts = opts || {};
    return _withSyms((await _dbCall("get_samet_funds_by_asset", [String(symOrId), opts.limit || null, opts.startId || null]) || []).map(_normFund));
  }

  /* Op-64 Same-T create (rate human -> units at denom 1M). */
  function buildSametCreate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.assetId, ASSET_RE, "assetId");
    _assertDigits(args.balanceRaw, "balanceRaw");
    if (BigInt(args.balanceRaw) <= 0n) throw new Error("balance must be > 0");
    return [64, { fee: { amount: "0", asset_id: CORE_ASSET }, owner_account: args.accountId,
      asset_type: args.assetId, balance: args.balanceRaw, fee_rate: _rateHumanToUnits(args.rateHuman), extensions: [] }];
  }
  /* Op-66 Same-T update (CANONICAL new_fee_rate; nulls stay null -> absent optionals). */
  function buildSametUpdate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.fundId, FUND_RE, "fundId");
    var delta = null, rate = null, changed = 0;
    if (args.deltaRawOrNull !== null && args.deltaRawOrNull !== undefined && String(args.deltaRawOrNull) !== "") {
      _assertSigned(args.deltaRawOrNull, "deltaRawOrNull"); _assertId(args.deltaAssetId, ASSET_RE, "deltaAssetId");
      delta = { amount: String(args.deltaRawOrNull), asset_id: args.deltaAssetId }; changed++;
    }
    if (args.rateHumanOrNull !== null && args.rateHumanOrNull !== undefined && String(args.rateHumanOrNull) !== "") {
      rate = _rateHumanToUnits(args.rateHumanOrNull); changed++;
    }
    if (!changed) throw new Error("update needs >= 1 field (delta and/or new rate)");
    return [66, { fee: { amount: "0", asset_id: CORE_ASSET }, owner_account: args.accountId, fund_id: args.fundId,
      delta_amount: delta, new_fee_rate: rate, extensions: [] }];
  }
  /* Op-65 Same-T delete (fee 0 observed live — the zero fee row is shown explicitly in the confirm). */
  function buildSametDelete(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.fundId, FUND_RE, "fundId");
    return [65, { fee: { amount: "0", asset_id: CORE_ASSET }, owner_account: args.accountId, fund_id: args.fundId, extensions: [] }];
  }
  /* Op-67 Same-T borrow (+ op-68 repay below). ORDER follows ambiguity-D outcome — builders take both, views gate. */
  function buildSametBorrow(args) {
    args = args || {};
    _assertId(args.borrowerId, ACCOUNT_RE, "borrowerId"); _assertId(args.fundId, FUND_RE, "fundId");
    _assertId(args.borrowAssetId, ASSET_RE, "borrowAssetId"); _assertDigits(args.borrowRaw, "borrowRaw");
    if (BigInt(args.borrowRaw) <= 0n) throw new Error("borrow amount must be > 0");
    return [67, { fee: { amount: "0", asset_id: CORE_ASSET }, borrower: args.borrowerId, fund_id: args.fundId,
      borrow_amount: { amount: args.borrowRaw, asset_id: args.borrowAssetId }, extensions: [] }];
  }
  function buildSametRepay(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.fundId, FUND_RE, "fundId");
    _assertId(args.assetId, ASSET_RE, "assetId"); _assertDigits(args.repayRaw, "repayRaw"); _assertDigits(args.feeRaw, "feeRaw");
    if (BigInt(args.repayRaw) <= 0n) throw new Error("repay amount must be > 0");
    return [68, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, fund_id: args.fundId,
      repay_amount: { amount: args.repayRaw, asset_id: args.assetId },
      fund_fee: { amount: args.feeRaw, asset_id: args.assetId }, extensions: [] }];
  }

  return { fund: fund, funds: funds, fundsByOwner: fundsByOwner, fundsByAsset: fundsByAsset,
    buildSametCreate: buildSametCreate, buildSametUpdate: buildSametUpdate, buildSametDelete: buildSametDelete,
    buildSametBorrow: buildSametBorrow, buildSametRepay: buildSametRepay };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.CreditSamet === "undefined") { globalThis.CreditSamet = CreditSamet; }
if (typeof module !== "undefined") { module.exports = CreditSamet; }
