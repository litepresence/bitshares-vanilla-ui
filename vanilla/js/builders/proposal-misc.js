/* ProposalMisc: vesting (1.13.x) + whitelist + custom-authority (1.17.x) + balance-claim reads + builders.
 * Split OUT of proposal.js on the ~380-line cap (pre-authorized by the
 * slice-14 plan — one purpose: vesting/lists/authorities/claims, no proposal/
 * ticket code). Owns: get_vesting_balances reads (policy words joined, amounts
 *   raw), single-authority + account-validated authority reads (no chain list
 *   method exists — explicit 1.17.x ids only), requireClaimable (empty-set
 *   gate for claim views),
 *   THE ONLY whitelist converters (0 none / 1 whitelisted / 2 blacklisted /
 *   3 both + OR/subtract bit helpers), the op-7/32/33/37/54/55/56 builders
 *   ([opId, opData], zero fee for live fee-fill via Proposal.fee). No DOM, no
 *   signing — views live in proposal-ui.js. Consumes: Chain.db/.call,
 *   Account.resolve (authority account inputs, optional); exposes global
 *   ProposalMisc only.
 *   Created by: building-vanilla-slices skill, slice-14-proposals plan Task 2.
 * CHAIN TRUTH (#4 wins): op-7 enum <- account.hpp:197-220; op-32/33 policies
 *   <- vesting.hpp:74-117 + FC :124-130 (policy static_variant ARRAY form
 *   [t,d]: 0 linear(begin_timestamp, vesting_cliff_seconds,
 *   vesting_duration_seconds) / 1 cdd(start_claim, vesting_seconds) / 2
 *   instant-empty — object form REJECTED by the node, ambiguity F); op-33 and
 *   op-37 carry NO extensions field; op-37 fee 0 + owner-KEY auth <-
 *   balance.hpp:40-57 (signature must come from balance_owner_key, never
 *   account auth — ambiguity H); op-54/55/56 <- custom_authority.hpp:36-122
 *   (55 nulls stay null -> absent optionals, never zero-filled); spaces <-
 *   types.hpp:376/:378/:380 (1.13/1.15/1.17); reads <- database_api.hpp:92
 *   (get_objects) / :397 (vesting). Restriction rows are BSIP-40 shape-checked
 *   only (ranges, not semantics — zero-restriction proven first, ambiguity G;
 *   nested 39/40/41 payloads travel unchecked by design).
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings. Number() NEVER
 *   touches money. NAMED ERRORS: not-connected / unknown-vesting /
 *   unknown-authority / unknown-account / method-missing / no-claimables.
 *   restrictions-unproven is a VIEW gate (Task 3, ambiguity G) — builders stay
 *   ungated per plan, so that name never throws here by design.
 */
var ProposalMisc = (function () {
  "use strict";
  var CORE_ASSET = "1.3.0";
  var VESTING_RE = /^1\.13\.\d+$/, BALANCE_RE = /^1\.15\.\d+$/, AUTH_RE = /^1\.17\.\d+$/;
  var ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var DIGITS_RE = /^\d+$/;
  var LISTING_WORDS = ["none", "whitelisted", "blacklisted", "both"];

  function _assertId(id, re, name) { if (typeof id !== "string" || !re.test(id)) throw new Error(name + " must match " + re + ", got: " + JSON.stringify(id)); }
  function _assertDigits(raw, name) { if (typeof raw !== "string" || !DIGITS_RE.test(raw)) throw new Error(name + " must be a digit string, got: " + JSON.stringify(raw)); }
  function _assertU32(n, name) { if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) throw new Error(name + " must be u32, got: " + JSON.stringify(n)); }
  function _assertIso(s, name) { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) || isNaN(Date.parse(s))) throw new Error(name + " must be ISO datetime"); return s; }
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
  /* Single get_objects read; empty slot -> the caller's named error. */
  async function _getOne(id, re, notFound) {
    _assertId(id, re, "id");
    var rows = await _dbCall("get_objects", [[id]]);
    if (!rows || !rows[0]) throw new Error(notFound + " (" + id + ")");
    return rows[0];
  }
  /* lookup_asset_symbols join -> {id: {sym, prec}}; misses degrade to bare ids (never a crash). */
  async function _joinSyms(ids) {
    var out = {}, uniq = [];
    (ids || []).forEach(function (id) { if (typeof id === "string" && !out[id]) { out[id] = null; uniq.push(id); } });
    if (uniq.length) {
      var objs = await _dbCall("lookup_asset_symbols", [uniq]);
      (objs || []).forEach(function (a) { if (a && a.id) out[a.id] = { sym: a.symbol, prec: a.precision }; });
    }
    uniq.forEach(function (id) { if (!out[id]) out[id] = { sym: String(id), prec: null }; });
    return out;
  }
  function _zeroFee() { return { amount: "0", asset_id: CORE_ASSET }; }
  /* Vesting policy [type, data] -> {kind + raw date/seconds legs} (amounts stay out — caller joins). */
  function _policyKind(policy) {
    if (!Array.isArray(policy) || !Number.isInteger(policy[0])) throw new Error("policy must be [type, data] array form");
    var d = policy[1] || {};
    if (policy[0] === 0) return { kind: "linear", type: 0, begin: (d.begin_timestamp || null), cliff_sec: (d.vesting_cliff_seconds || 0), duration_sec: (d.vesting_duration_seconds || 0) };
    if (policy[0] === 1) return { kind: "cdd", type: 1, begin: (d.start_claim || null), cliff_sec: null, duration_sec: (d.vesting_seconds || 0) };
    if (policy[0] === 2) return { kind: "instant", type: 2, begin: null, cliff_sec: null, duration_sec: 0 };
    throw new Error("unknown vesting policy type: " + JSON.stringify(policy[0]));
  }
  /* Vesting balances for an account -> rows {id/owner/raw balance/policy words}. Amounts raw, never formatted. */
  async function vestings(nameOrId) {
    var rows = (await _dbCall("get_vesting_balances", [String(nameOrId)])) || [];
    var normed = rows.map(function (v) {
      if (!v || !v.id) throw new Error("unknown-vesting");
      var b = (v.balance && typeof v.balance === "object") ? v.balance : {};
      return { id: String(v.id), owner: String(v.owner || ""), balance_raw: String(b.amount !== undefined ? b.amount : ""),
        asset_id: String(b.asset_id || ""), policy: _policyKind(v.policy) };
    });
    var join = await _joinSyms(normed.map(function (r) { return r.asset_id; }));
    return normed.map(function (r) { r.sym = join[r.asset_id].sym; r.prec = join[r.asset_id].prec; return r; });
  }
  /* Raw custom authority by 1.17.x id (restrictions kept RAW for the detail view). */
  async function authority(id) { return _getOne(id, AUTH_RE, "unknown-authority"); }
  /* Authorities "for" an account-or-id. No chain list method exists, so an
   * account input validates the account then yields [] (never a crash); views
   * resolve explicit 1.17.x ids via authority(). Unknown account -> unknown-account. */
  async function authorities(nameOrId) {
    if (AUTH_RE.test(String(nameOrId))) return [await authority(String(nameOrId))];
    var id = String(nameOrId);
    if (typeof Account !== "undefined" && Account.resolve) { var a = await Account.resolve(id); id = (a && a.id) || id; }
    else { var got = await _dbCall("get_account_by_name", [id]); if (!got) throw new Error("unknown-account (" + nameOrId + ")"); id = got.id || id; }
    _assertId(id, ACCOUNT_RE, "accountId");
    return [];
  }
  /* Empty claimable set -> no-claimables (views call before enabling claim). */
  function requireClaimable(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("no-claimables");
    return rows;
  }
  /* Whitelist u8 <-> words. THE ONLY listing converters (bit math via helpers — add ORs, remove clears). */
  function listingLabel(n) {
    if (!Number.isInteger(n) || n < 0 || n > 3) throw new Error("listing must be 0-3, got: " + JSON.stringify(n));
    return LISTING_WORDS[n];
  }
  function listingFromHuman(h) {
    var k = String(h).toLowerCase().replace(/[\s_\-]+/g, "");
    var map = { none: 0, nolist: 0, whitelisted: 1, white: 1, blacklisted: 2, black: 2,
      both: 3, whiteandblacklisted: 3, "0": 0, "1": 1, "2": 2, "3": 3 };
    if (!(k in map)) throw new Error("listing must be 0-3, got: " + JSON.stringify(h));
    return map[k];
  }
  /* Listing bitfield add: ORs the white(1)/black(2) bit (0-3 range asserted on both args). */
  function listingAdd(cur, bit) {
    if (cur !== 0 && cur !== 1 && cur !== 2 && cur !== 3) throw new Error("listing must be 0-3");
    if (bit !== 1 && bit !== 2) throw new Error("bit must be 1 (white) or 2 (black)");
    return cur | bit;
  }
  /* Listing bitfield remove: clears the white(1)/black(2) bit (range asserted; removing an absent bit is a no-op). */
  function listingRemove(cur, bit) {
    if (cur !== 0 && cur !== 1 && cur !== 2 && cur !== 3) throw new Error("listing must be 0-3");
    if (bit !== 1 && bit !== 2) throw new Error("bit must be 1 (white) or 2 (black)");
    return cur & ~bit;
  }
  /* Vesting policy: ARRAY form [type, data] only (node JSON parser rejects object form — ambiguity F). */
  function _assertPolicy(policy) {
    if (!Array.isArray(policy) || !Number.isInteger(policy[0]) || policy[0] < 0 || policy[0] > 2) throw new Error("policy must be [0|1|2, data] array form");
    var d = policy[1] || {};
    if (policy[0] === 0) { _assertIso(d.begin_timestamp || "", "policy begin_timestamp"); _assertU32(d.vesting_cliff_seconds || 0, "cliff"); _assertU32(d.vesting_duration_seconds || 0, "duration"); }
    else if (policy[0] === 1) { _assertIso(d.start_claim || "", "policy start_claim"); _assertU32(d.vesting_seconds || 0, "vesting_seconds"); }
    return policy;
  }
  /* Restriction rows: BSIP-40 shape check only (member/restriction/argument-tag ranges; nested
   * 39/40/41 payloads travel unchecked — zero-restriction proven first, ambiguity G). */
  function _assertRestrictions(rows) {
    if (!Array.isArray(rows)) throw new Error("restrictions must be an array");
    rows.forEach(function (r, i) {
      if (!r || typeof r !== "object") throw new Error("restrictions[" + i + "] must be an object");
      if (!Number.isInteger(r.member_index) || r.member_index < 0) throw new Error("restrictions[" + i + "].member_index must be u16");
      if (!Number.isInteger(r.restriction_type) || r.restriction_type < 0 || r.restriction_type > 12) throw new Error("restrictions[" + i + "].restriction_type must be 0-12");
      if (!Array.isArray(r.argument) || r.argument.length !== 2 || !Number.isInteger(r.argument[0]) || r.argument[0] < 0 || r.argument[0] > 41) throw new Error("restrictions[" + i + "].argument must be [tag 0-41, value]");
      if (r.extensions !== undefined && !Array.isArray(r.extensions)) throw new Error("restrictions[" + i + "].extensions must be an array");
    });
    return rows;
  }
  /* Custom-authority auth object: threshold + auth arrays (account/key id shapes checked at sign time). */
  function _assertAuth(auth) {
    if (!auth || typeof auth !== "object") throw new Error("auth must be an authority object");
    _assertU32(auth.weight_threshold, "auth.weight_threshold");
    ["account_auths", "key_auths", "address_auths"].forEach(function (k) { if (auth[k] !== undefined && !Array.isArray(auth[k])) throw new Error("auth." + k + " must be an array"); });
    return auth;
  }
  /* Op-7 whitelist (u8 0-3 asserted; bit math lives in listingAdd/listingRemove — ambiguity K). */
  function buildWhitelist(args) {
    args = args || {};
    _assertId(args.authorizerId, ACCOUNT_RE, "authorizerId"); _assertId(args.listeeId, ACCOUNT_RE, "listeeId");
    if (!Number.isInteger(args.newListing) || args.newListing < 0 || args.newListing > 3) throw new Error("newListing must be 0-3");
    return [7, { fee: _zeroFee(), authorizing_account: args.authorizerId, account_to_list: args.listeeId, new_listing: args.newListing, extensions: [] }];
  }
  /* Op-32 vesting create (policy array-form asserted) / op-33 withdraw (NO extensions field). */
  function buildVestingCreate(args) {
    args = args || {};
    _assertId(args.creatorId, ACCOUNT_RE, "creatorId"); _assertId(args.ownerId, ACCOUNT_RE, "ownerId");
    _assertDigits(args.amountRaw, "amountRaw"); _assertId(args.assetId, ASSET_RE, "assetId");
    return [32, { fee: _zeroFee(), creator: args.creatorId, owner: args.ownerId,
      amount: { amount: args.amountRaw, asset_id: args.assetId }, policy: _assertPolicy(args.policy) }];
  }
  /* Op-33 vesting withdraw (NO extensions field on op 33). Returns [33, opData]. */
  function buildVestingWithdraw(args) {
    args = args || {};
    _assertId(args.ownerId, ACCOUNT_RE, "ownerId"); _assertId(args.vestingId, VESTING_RE, "vestingId");
    _assertDigits(args.amountRaw, "amountRaw"); _assertId(args.assetId, ASSET_RE, "assetId");
    return [33, { fee: _zeroFee(), vesting_balance: args.vestingId, owner: args.ownerId, amount: { amount: args.amountRaw, asset_id: args.assetId } }];
  }
  /* Op-37 balance claim (fee ZERO explicit; owner-KEY authority gated: ownerKey must be a
   * non-empty pubkey string — the signature has to come from that key, never account auth). */
  function buildBalanceClaim(args) {
    args = args || {};
    _assertId(args.depositId, ACCOUNT_RE, "depositId"); _assertId(args.balanceId, BALANCE_RE, "balanceId");
    _assertDigits(args.amountRaw, "amountRaw"); _assertId(args.assetId, ASSET_RE, "assetId");
    if (typeof args.ownerKey !== "string" || !args.ownerKey) throw new Error("ownerKey must be the balance-owner public key");
    return [37, { fee: { amount: "0", asset_id: CORE_ASSET }, deposit_to_account: args.depositId,
      balance_to_claim: args.balanceId, balance_owner_key: args.ownerKey,
      total_claimed: { amount: args.amountRaw, asset_id: args.assetId } }];
  }
  /* Op-54 custom authority create (zero-restriction default proven first — ambiguity G). */
  function buildAuthorityCreate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertIso(args.validFromIso, "validFromIso"); _assertIso(args.validToIso, "validToIso");
    _assertU32(args.opType, "opType");
    return [54, { fee: _zeroFee(), account: args.accountId, enabled: !!args.enabled, valid_from: args.validFromIso,
      valid_to: args.validToIso, operation_type: args.opType, auth: _assertAuth(args.auth),
      restrictions: _assertRestrictions(args.restrictions === undefined ? [] : args.restrictions), extensions: [] }];
  }
  /* Op-55 custom authority update (nulls stay null -> absent optionals, never zero-filled). */
  function buildAuthorityUpdate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.authorityId, AUTH_RE, "authorityId");
    function isoOrNull(v, n) { return (v === null || v === undefined || String(v) === "") ? null : _assertIso(v, n); }
    var rem = (args.restrictionsToRemove === undefined || args.restrictionsToRemove === null) ? [] : args.restrictionsToRemove;
    rem.forEach(function (u) { _assertU32(u, "restrictionsToRemove[]"); });
    var add = (args.restrictionsToAdd === undefined || args.restrictionsToAdd === null) ? [] : _assertRestrictions(args.restrictionsToAdd);
    return [55, { fee: _zeroFee(), account: args.accountId, authority_to_update: args.authorityId,
      new_enabled: (args.newEnabledOrNull === true || args.newEnabledOrNull === false) ? args.newEnabledOrNull : null,
      new_valid_from: isoOrNull(args.newValidFromOrNull, "newValidFromOrNull"),
      new_valid_to: isoOrNull(args.newValidToOrNull, "newValidToOrNull"),
      new_auth: (args.newAuthOrNull === null || args.newAuthOrNull === undefined) ? null : _assertAuth(args.newAuthOrNull),
      restrictions_to_remove: rem.slice().sort(function (a, b) { return a - b; }), restrictions_to_add: add, extensions: [] }];
  }
  /* Op-56 custom authority delete. */
  function buildAuthorityDelete(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.authorityId, AUTH_RE, "authorityId");
    return [56, { fee: _zeroFee(), account: args.accountId, authority_to_delete: args.authorityId, extensions: [] }];
  }

  return { vestings: vestings, authority: authority, authorities: authorities,
    requireClaimable: requireClaimable, listingLabel: listingLabel, listingFromHuman: listingFromHuman,
    listingAdd: listingAdd, listingRemove: listingRemove,
    buildWhitelist: buildWhitelist, buildVestingCreate: buildVestingCreate, buildVestingWithdraw: buildVestingWithdraw,
    buildBalanceClaim: buildBalanceClaim, buildAuthorityCreate: buildAuthorityCreate,
    buildAuthorityUpdate: buildAuthorityUpdate, buildAuthorityDelete: buildAuthorityDelete };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.ProposalMisc === "undefined") { globalThis.ProposalMisc = ProposalMisc; }
if (typeof module !== "undefined") { module.exports = ProposalMisc; }
