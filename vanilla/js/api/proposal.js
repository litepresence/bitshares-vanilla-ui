/* Proposal: proposals (1.10.x) reads + builders + shared chain/math core.
 * Owns: single-proposal + proposalsFor reads (nested ops kept RAW), the op-22
 *   /23/24 builders ([opId, opData], zero fee for live fee-fill), an airdrop
 *   op-14 batch helper (NO new serializer — slice-10 keys), invoice
 *   pack/unpack (base58 of UTF-8 JSON — platform only), THE ONLY duration
 *   converter, blinded-balance read-only lookup + blindSend guard, fee via
 *   Tx.fee (filled IN PLACE), sendAndProve (vote-pattern). Ticket reads +
 *   lock map + builders 57/58 live in proposal-ticket.js; vesting + whitelist
 *   + authority + claim reads + builders 7/32/33/37/54/55/56 live in
 *   proposal-misc.js (both split OUT on the ~380-line cap — pre-authorized).
 *   No DOM, no signing (WIF passes opaquely to Tx.sign) — views live in
 *   proposal-ui.js. Consumes: Chain.db/.call/.net, Tx.fee/.sign; exposes
 *   global Proposal only.
 *   Created by: building-vanilla-slices skill, slice-14-proposals plan Task 2.
 * CHAIN TRUTH (#4 wins): op ids <- operations.hpp:63/:78-80 (38 issuer-only
 *   OUT, 39/40/41 blind OUT, 46 VIRTUAL — never built, no builder exists);
 *   op-22 fields <- proposal.hpp:70-82 (fee-payer = proposer, proposed_ops =
 *   vector<op_wrapper>, review_period optional); op-23/24 <- :119-135/:156-165;
 *   spaces <- types.hpp:373 (1.10.x); reads <- database_api.hpp:92
 *   (get_objects) / :1326 (proposed) / :1337 (blinded). Inner-op shapes accept
 *   bare [type, data] AND {op: [type, data]} (ambiguity B) -> canonical
 *   {op: [t, d]}. Invoice: #1 InvoiceRequest.jsx:53-60 packs LZW-compress+bs58
 *   — NO compress lib is vendored (§4.5 boring rule), so vanilla URLs are
 *   base58(utf8 JSON); foreign (#1) URLs surface invoice-unparseable, never a
 *   crash. Airdrop rows mirror AssetOps.buildIssue keys (issuer + raw amounts,
 *   memo null default); chunking per ambiguity J is Task-3's job.
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings. Number() NEVER
 *   touches money. NAMED ERRORS: not-connected / unknown-proposal /
 *   method-missing / blind-disabled / invoice-unparseable.
 */
var Proposal = (function () {
  "use strict";
  var CORE_ASSET = "1.3.0";
  var PROPOSAL_RE = /^1\.10\.\d+$/, ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var DIGITS_RE = /^\d+$/, COMMIT_RE = /^[0-9a-fA-F]{66}$/;
  var PROVE_TIMEOUT_MS = 60000, PROVE_INTERVAL_MS = 2500;
  var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  function _sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
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
  function _zeroFee() { return { amount: "0", asset_id: CORE_ASSET }; }
  /* Raw proposal by 1.10.x id (proposed_ops kept RAW for the nested renderer). Unknown -> unknown-proposal. */
  async function proposal(id) { return _getOne(id, PROPOSAL_RE, "unknown-proposal"); }
  /* Proposals requiring an account's approval -> slim rows (counts, never full nested ops).
   * FEE-PAYER FIELD: get_proposed_transactions returns proposal_objects whose
   * payer field is `proposer` (#4 chain/proposal_object.hpp:51) — NOT
   * fee_paying_account (that name lives only on the op-22 OPERATION,
   * protocol/proposal.hpp:78). Rows expose `proposer` canonically and keep
   * `fee_paying_account` as the same-value alias so existing readers work. */
  async function proposalsFor(nameOrId) {
    var rows = (await _dbCall("get_proposed_transactions", [String(nameOrId)])) || [];
    return rows.map(function (o) {
      var tx = o.proposed_transaction || {}, ops = tx.operations || o.proposed_ops || [];
      var payer = String(o.proposer || o.fee_paying_account || "");
      return { id: String(o.id), expiration_time: (o.expiration_time || null),
        review_period: (o.review_period_time || o.review_period_seconds || null),
        proposer: payer, fee_paying_account: payer, proposed_ops_count: ops.length };
    });
  }
  /* Seconds -> largest whole unit word ("86400" -> "1 day"). No moment. THE ONLY duration converter. */
  function durToHuman(seconds) {
    var s = typeof seconds === "string" ? parseInt(seconds, 10) : seconds;
    if (!Number.isInteger(s) || s < 0) throw new Error("seconds must be a non-negative integer");
    var units = [[604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
    for (var i = 0; i < units.length; i++) {
      if (s >= units[i][0] && s % units[i][0] === 0) { var n = s / units[i][0]; return n + " " + units[i][1] + (n === 1 ? "" : "s"); } }
    return s + " second" + (s === 1 ? "" : "s");
  }
  /* Inner-op pairs: accept bare [type, data] AND {op: [type, data]} (ambiguity B) -> canonical {op: [t, d]}. */
  function _normInnerOps(innerOps) {
    if (!Array.isArray(innerOps) || !innerOps.length) throw new Error("innerOps must be a non-empty array");
    return innerOps.map(function (e, i) {
      var pair = (e && e.op !== undefined) ? e.op : e;
      if (!Array.isArray(pair) || !Number.isInteger(pair[0]) || !pair[1] || typeof pair[1] !== "object") throw new Error("innerOps[" + i + "] must be [opId, opData]");
      return { op: [pair[0], pair[1]] };
    });
  }
  /* Op-22 proposal create (fee-payer = proposer; SMALL enclosed ops only — Task-4 proves transfer first). */
  function buildCreate(args) {
    args = args || {};
    _assertId(args.feePayerId, ACCOUNT_RE, "feePayerId"); _assertIso(args.expirationIso, "expirationIso");
    var review = (args.reviewPeriodSecOrNull === null || args.reviewPeriodSecOrNull === undefined || String(args.reviewPeriodSecOrNull) === "") ? null : args.reviewPeriodSecOrNull;
    if (review !== null) _assertU32(review, "reviewPeriodSecOrNull");
    return [22, { fee: _zeroFee(), fee_paying_account: args.feePayerId, expiration_time: args.expirationIso,
      proposed_ops: _normInnerOps(args.innerOps), review_period_seconds: review, extensions: [] }];
  }
  /* Op-23 approve/unapprove share: single-bit add/remove sets, all other sets empty. */
  function _buildUpdate(dir, args) {
    args = args || {};
    _assertId(args.feePayerId, ACCOUNT_RE, "feePayerId"); _assertId(args.proposalId, PROPOSAL_RE, "proposalId"); _assertId(args.accountId, ACCOUNT_RE, "accountId");
    var out = { fee: _zeroFee(), fee_paying_account: args.feePayerId, proposal: args.proposalId,
      active_approvals_to_add: [], active_approvals_to_remove: [], owner_approvals_to_add: [], owner_approvals_to_remove: [],
      key_approvals_to_add: [], key_approvals_to_remove: [], extensions: [] };
    out[dir === "add" ? "active_approvals_to_add" : "active_approvals_to_remove"] = args.ownerNotActive ? [] : [args.accountId];
    out[dir === "add" ? "owner_approvals_to_add" : "owner_approvals_to_remove"] = args.ownerNotActive ? [args.accountId] : [];
    return [23, out];
  }
  /* Op-23 approval: single-bit add set for accountId (owner-vs-active via ownerNotActive). Returns [23, opData]. */
  function buildApprove(args) { return _buildUpdate("add", args); }
  /* Op-23 unapproval: mirror of buildApprove (single-bit remove set). Returns [23, opData]. */
  function buildUnapprove(args) { return _buildUpdate("remove", args); }
  /* Op-24 proposal delete/veto. */
  function buildDelete(args) {
    args = args || {};
    _assertId(args.feePayerId, ACCOUNT_RE, "feePayerId"); _assertId(args.proposalId, PROPOSAL_RE, "proposalId");
    return [24, { fee: _zeroFee(), fee_paying_account: args.feePayerId,
      using_owner_authority: !!args.usingOwner, proposal: args.proposalId, extensions: [] }];
  }
  /* Airdrop batch: N x op-14 asset_issue pairs (slice-10 keys, raw amounts, memo null default).
   * issuerId is REQUIRED (chain: issuer must equal the asset issuer). Chunking per ambiguity J is Task-3's job. */
  function buildAirdropBatch(issuerId, rows) {
    _assertId(issuerId, ACCOUNT_RE, "issuerId");
    if (!Array.isArray(rows) || !rows.length) throw new Error("rows must be a non-empty array");
    return rows.map(function (r, i) {
      if (!r || typeof r !== "object") throw new Error("rows[" + i + "] must be an object");
      _assertId(r.toId, ACCOUNT_RE, "rows[" + i + "].toId"); _assertDigits(String(r.amountRaw), "rows[" + i + "].amountRaw");
      _assertId(r.assetId, ASSET_RE, "rows[" + i + "].assetId");
      return [14, { fee: _zeroFee(), issuer: issuerId, asset_to_issue: { amount: String(r.amountRaw), asset_id: r.assetId },
        issue_to_account: r.toId, memo: (r.memoOrNull === undefined ? null : r.memoOrNull), extensions: [] }];
    });
  }
  /* Read-only blinded-balance lookup (commitments validated as 33B hex, never broadcast). */
  async function blindedLookup(commitments) {
    if (!Array.isArray(commitments) || !commitments.length) throw new Error("commitments must be a non-empty array");
    commitments.forEach(function (c) { if (typeof c !== "string" || !COMMIT_RE.test(c)) throw new Error("commitment must be 33B hex, got: " + JSON.stringify(c)); });
    return (await _dbCall("get_blinded_balances", [commitments])) || [];
  }
  /* Any blind SIGNING attempt ends here (39/40/41 downscoped — no serializers, no builders). */
  function blindSend() { throw new Error("blind-disabled (blind transfers need vendored commitment/range-proof crypto — read-only lookup only)"); }
  /* Base58 (bitcoin alphabet) over raw bytes; shape ports #3 crypto-utils base58
   * (crypto.js base58Encode is NOT exported, tx.js exports decode only — symmetric local pair, zero coupling). */
  function _b58enc(bytes) {
    var zeroes = 0;
    while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes++;
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i], j = 0;
      for (j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    var out = "";
    for (var z = 0; z < zeroes; z++) out += "1";
    for (var k = digits.length - 1; k >= 0; k--) out += B58[digits[k]];
    return out === "" ? "1" : out;
  }
  function _b58dec(str) {
    var zeroes = 0;
    while (zeroes < str.length && str[zeroes] === "1") zeroes++;
    var bytes = [0];
    for (var i = 0; i < str.length; i++) {
      var v = B58.indexOf(str[i]);
      if (v === -1) throw new Error("invalid base58 character: " + str[i]);
      var carry = v, j = 0;
      for (j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 255; carry >>= 8; }
      while (carry > 0) { bytes.push(carry & 255); carry >>= 8; }
    }
    var out = [];
    for (var z = 0; z < zeroes; z++) out.push(0);
    for (var k = bytes.length - 1; k >= 0; k--) out.push(bytes[k]);
    while (out.length > 1 && out[0] === 0 && zeroes === 0) out.shift();
    return new Uint8Array(out);
  }
  /* Invoice pack: object -> base58(utf8 JSON). Uncompressed by design (see header). */
  function packInvoice(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("invoice must be an object");
    return _b58enc(new TextEncoder().encode(JSON.stringify(obj)));
  }
  /* Invoice unpack: base58 -> utf8 -> JSON object. Anything foreign -> invoice-unparseable (never a crash). */
  function unpackInvoice(str) {
    try {
      if (typeof str !== "string" || !str) throw new Error("empty invoice data");
      var obj = JSON.parse(new TextDecoder().decode(_b58dec(str)));
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("not a JSON object");
      return obj;
    } catch (e) { throw new Error("invoice-unparseable (" + String((e && e.message) || e) + ")"); }
  }
  /* Live fee via Tx.fee (chain answers); opPair fee-filled IN PLACE. Returns {amount, asset_id}. */
  async function fee(opPair, feeAssetId) {
    if (!Array.isArray(opPair) || !Number.isInteger(opPair[0]) || !opPair[1]) throw new Error("opPair must be [opId, opData]");
    if (typeof Tx === "undefined" || !Tx.fee) throw new Error("tx-unavailable");
    var ans = await Tx.fee(opPair[0], opPair[1], feeAssetId || CORE_ASSET);
    opPair[1].fee = { amount: String(ans.amount), asset_id: ans.asset_id };
    return { amount: String(ans.amount), asset_id: ans.asset_id };
  }
  /* Sign + send + prove (vote-pattern). Rejections carry sendRejected (safe retry); accepted-but-unproven does NOT. */
  async function sendAndProve(signedTx, wif, proveFn) {
    if (!signedTx || !Array.isArray(signedTx.operations) || !signedTx.operations.length) throw new Error("signedTx has no operations");
    if (typeof wif !== "string" || !wif) throw new Error("wallet-locked");
    if (typeof proveFn !== "function") throw new Error("proveFn must be a function");
    if (typeof Tx === "undefined" || !Tx.sign) throw new Error("tx-unavailable");
    var txSigned = await Tx.sign(signedTx, wif);
    var netId; try { netId = await Chain.net(); } catch (e) { throw new Error("not-connected"); }
    var via = "broadcast_transaction_with_callback";
    var callbackId = (Math.random() * 4294967296) >>> 0;
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, txSigned]);
    } catch (e) {
      via = "broadcast_transaction";
      try { await Chain.call(netId, "broadcast_transaction", [txSigned]); } catch (e2) {
        e2.sendRejected = true;
        throw e2;
      }
    }
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    for (;;) {
      var ok = null;
      try { ok = await proveFn(); } catch (e) { ok = null; }
      if (ok) return { via: via + "+re-read", proof: ok };
      if (Date.now() >= deadline) throw new Error("Sent (" + via + ") but the re-read proof was not observed within " +
        (PROVE_TIMEOUT_MS / 1000) + "s; check state before retrying (do NOT blindly rebroadcast).");
      await _sleep(PROVE_INTERVAL_MS);
    }
  }

  return { proposal: proposal, proposalsFor: proposalsFor, durToHuman: durToHuman,
    buildCreate: buildCreate, buildApprove: buildApprove, buildUnapprove: buildUnapprove, buildDelete: buildDelete,
    buildAirdropBatch: buildAirdropBatch, blindedLookup: blindedLookup, blindSend: blindSend,
    packInvoice: packInvoice, unpackInvoice: unpackInvoice, fee: fee, sendAndProve: sendAndProve };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.Proposal === "undefined") { globalThis.Proposal = Proposal; }
if (typeof module !== "undefined") { module.exports = Proposal; }
