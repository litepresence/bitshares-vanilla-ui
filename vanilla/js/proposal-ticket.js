/* ProposalTicket: tickets (1.18.x) reads + lock-type math + op builders.
 * Split OUT of proposal.js on the ~380-line cap (pre-authorized by the
 * slice-14 plan — one purpose: tickets, no proposals/vesting/authority code).
 * Owns: list_tickets / get_tickets_by_account reads (symbols joined via
 *   lookup_asset_symbols), THE ONLY lock-type converters (0 liquid / 1 180-day
 *   lock / 2 360-day lock / 3 720-day lock / 4 forever — rejects 5+), the
 *   op-57/58 builders ([opId, opData], zero fee for live fee-fill via
 *   Proposal.fee). No DOM, no signing, no fee code (views call Proposal.fee +
 *   Proposal.sendAndProve) — views live in proposal-ui.js. Consumes:
 *   Chain.db/.call; exposes global ProposalTicket only.
 *   Created by: building-vanilla-slices skill, slice-14-proposals plan Task 2.
 * CHAIN TRUTH (#4 wins): lock enum + op-57/58 fields <- ticket.hpp:33-80;
 *   space 1.18.x <- types.hpp:381; reads <- database_api.hpp:1422-1458
 *   (limit/start_id pageable, chain resolves owner names itself). Lock WORDS
 *   <- plan §61 + #2 CreateTicket.jsx enum names (lock_180_days etc.).
 *   Downgrade-vs-upgrade validity lives in ticket.cpp validation (outside the
 *   sparse checkout) — direction is gated by VIEWS (ambiguity D), builders
 *   stay ungated per plan, so no downgrade rule is encoded here. Tickets have
 *   NO delete op — there is deliberately no delete builder.
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings. Number() NEVER
 *   touches money. NAMED ERRORS: not-connected / unknown-ticket /
 *   unknown-account / method-missing / bad-lock-type.
 */
var ProposalTicket = (function () {
  "use strict";
  var CORE_ASSET = "1.3.0";
  var TICKET_RE = /^1\.18\.\d+$/, ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var DIGITS_RE = /^\d+$/;
  var LOCK_WORDS = ["liquid", "180-day lock", "360-day lock", "720-day lock", "forever"];
  var TICKET_PAGE = 100;

  function _assertId(id, re, name) { if (typeof id !== "string" || !re.test(id)) throw new Error(name + " must match " + re + ", got: " + JSON.stringify(id)); }
  function _assertDigits(raw, name) { if (typeof raw !== "string" || !DIGITS_RE.test(raw)) throw new Error(name + " must be a digit string, got: " + JSON.stringify(raw)); }
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
  /* Raw ticket -> plain row (amount raw; lock word joined; symbol joined). */
  function _normTicket(t, join) {
    if (!t || typeof t !== "object" || !t.id) throw new Error("unknown-ticket");
    var amt = (t.amount && typeof t.amount === "object") ? t.amount : {};
    var aid = String(amt.asset_id || t.asset_id || ""), j = (join && join[aid]) || { sym: aid, prec: null };
    return { id: String(t.id), owner: String(t.account || t.owner || ""), amount_raw: String(amt.amount !== undefined ? amt.amount : t.amount_raw || ""),
      asset_id: aid, sym: j.sym, prec: j.prec, target_type: (typeof t.target_type === "string" ? lockFromHuman(t.target_type) : t.target_type), lock_word: lockLabel(t.target_type) };
  }
  /* Shared ticket list path: one read + one symbol join. */
  async function _ticketRows(rows) {
    var aids = rows.map(function (t) { var a = (t.amount && t.amount.asset_id) || t.asset_id || ""; return String(a); });
    var join = await _joinSyms(aids);
    return rows.map(function (t) { return _normTicket(t, join); });
  }
  /* First page of all tickets (leaderboard source). Limit 1-100. */
  async function tickets(opts) {
    opts = opts || {};
    var limit = (opts.limit === undefined || opts.limit === null) ? TICKET_PAGE : opts.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > TICKET_PAGE) throw new Error("limit must be 1-" + TICKET_PAGE);
    return _ticketRows((await _dbCall("list_tickets", [limit, opts.startId || null])) || []);
  }
  /* Tickets by owner name-or-id (chain resolves names itself). */
  async function ticketsByAccount(nameOrId, opts) {
    opts = opts || {};
    return _ticketRows((await _dbCall("get_tickets_by_account", [String(nameOrId), opts.limit || null, opts.startId || null])) || []);
  }
  /* Lock-type u8 <-> human words. THE ONLY lock converters (rejects 5+).
   * Chain reads return enum-name STRINGS ("lock_360_days" seen live on 1.18.0);
   * writes stay ints 0-4. lockLabel accepts both, _normTicket canonicalizes. */
  function lockLabel(t) {
    if (typeof t === "string") { try { t = lockFromHuman(t); } catch (e) { throw new Error("bad-lock-type, got: " + JSON.stringify(t)); } }
    if (!Number.isInteger(t) || t < 0 || t > 4) throw new Error("bad-lock-type, got: " + JSON.stringify(t));
    return LOCK_WORDS[t];
  }
  function lockFromHuman(h) {
    var k = String(h).toLowerCase().replace(/[\s_\-]+/g, "");
    var map = { liquid: 0, lock180days: 1, "180daylock": 1, "180days": 1, "180d": 1, "180": 1,
      lock360days: 2, "360daylock": 2, "360days": 2, "360d": 2, "360": 2,
      lock720days: 3, "720daylock": 3, "720days": 3, "720d": 3, "720": 3,
      lockforever: 4, forever: 4, "0": 0, "1": 1, "2": 2, "3": 3, "4": 4 };
    if (!(k in map)) throw new Error("bad-lock-type, got: " + JSON.stringify(h));
    return map[k];
  }
  function _assertTarget(t) { if (!Number.isInteger(t) || t < 0 || t > 4) throw new Error("targetType must be 0-4, got: " + JSON.stringify(t)); return t; }
  /* Op-57 ticket create (lock 0-4 asserted; SMALL amounts — Task-4 proves lock_180_days first). */
  function buildTicketCreate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertDigits(args.amountRaw, "amountRaw"); _assertId(args.assetId, ASSET_RE, "assetId");
    return [57, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, target_type: _assertTarget(args.targetType),
      amount: { amount: args.amountRaw, asset_id: args.assetId }, extensions: [] }];
  }
  /* Op-58 ticket update (amount null -> absent optional; direction gated by views, ambiguity D). */
  function buildTicketUpdate(args) {
    args = args || {};
    _assertId(args.ticketId, TICKET_RE, "ticketId"); _assertId(args.accountId, ACCOUNT_RE, "accountId");
    var amt = (args.amountRawOrNull === null || args.amountRawOrNull === undefined || String(args.amountRawOrNull) === "") ? null : args.amountRawOrNull;
    if (amt !== null) { _assertDigits(amt, "amountRawOrNull"); _assertId(args.assetIdOrNull, ASSET_RE, "assetIdOrNull"); }
    return [58, { fee: { amount: "0", asset_id: CORE_ASSET }, ticket: args.ticketId, account: args.accountId, target_type: _assertTarget(args.targetType),
      amount_for_new_target: amt === null ? null : { amount: amt, asset_id: args.assetIdOrNull }, extensions: [] }];
  }

  return { tickets: tickets, ticketsByAccount: ticketsByAccount,
    lockLabel: lockLabel, lockFromHuman: lockFromHuman,
    buildTicketCreate: buildTicketCreate, buildTicketUpdate: buildTicketUpdate };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.ProposalTicket === "undefined") { globalThis.ProposalTicket = ProposalTicket; }
if (typeof module !== "undefined") { module.exports = ProposalTicket; }
