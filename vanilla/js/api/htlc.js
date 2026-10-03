/* Htlc: HTLC (1.16.x) + withdraw-permission (1.12.x) reads + op-data builders.
 * Owns: read joins (htlc/mine/permissions), the seven slice-11
 *   builders returning [opId, opData] with zero-placeholder fee for live
 *   fee-fill (ops 49/50/52 + 25/26/27/28), preimage hashing (UTF-8 bytes,
 *   sha256 via WebCrypto), claim/hash gates, live fee via Tx.fee,
 *   sign+send+prove (vote-pattern shape), and the ONLY duration/date
 *   formatters. No DOM, no signing, no broadcast strings (htlc-ui.js owns
 *   views). Party NAMES are not joined here (plan marks them optional) —
 *   views resolve via Account.resolve. Amounts stay RAW strings, never floats.
 * Consumes: Chain.db/.call/.net, Tx.fee/.sign, Format.parseAmount,
 *   Account.resolve (name-or-id inputs). Side effects: global Htlc only.
 * Created by: building-vanilla-slices skill, slice-11-htlc plan Task 2.
 * CHAIN TRUTH (#4 wins): ops 25-28 + 49-53 <- operations.hpp:81-84/:105-109
 *   (51/53 VIRTUAL — never built/dispatched); op-49 <- htlc.hpp:45-88; op-50
 *   <- :90-122; op-52 <- :153-185; ops 25/26/27/28 <-
 *   withdraw_permission.hpp:50-70/:83-105/:120-143/:153-167 (op-26 TRAP:
 *   period_start_time BEFORE periods_until_expiration); hash variant 0/1/2/3
 *   <- htlc.hpp:33-43; objects <- htlc_object.hpp:40-68 +
 *   withdraw_permission_object.hpp:45-89 (cached start/claimed go stale until
 *   next claim — re-read after claim); reads <- database_api.hpp:1349-1367 /
 *   :1381-1414 (list_htlcs unused); limits <- chain_parameters.hpp:32-36 /
 *   :82-90 (extensions.updatable_htlc_options). Keys mirror #3
 *   bitshares-api.js :2711-2772 + :3094-3151/:3171-3179 (preimage_hash JSON
 *   [typeId, hex], STRICT 32-iff-2-else-20); times are tx.js
 *   "YYYY-MM-DDTHH:MM:SS" (serializer appends Z, UTC). FEES: op-25/26/27
 *   observed 100 raw (core) each on testnet — the chain-header 1 BTS (op-25)
 *   and 20 BTS (op-27) figures are stale; op 27 paid by CLAIMANT, op 28 fee 0
 *   observed on testnet, ops 49/52 scale fee_per_day — observed via Htlc.fee.
 *   RIPMD-160 GAP (ambiguity A): vendor/ has NO ripemd160 (probed 2026-09-28)
 *   — preimage hashing is sha256-only; ripemd160 travels explicit-hash-only.
 * NAMED ERRORS: not-connected / unknown-htlc / unknown-permission /
 *   unknown-account / bad-preimage / hash-mismatch / period-not-started /
 *   limit-exceeded / limits-unavailable. Builder misuse throws plain Errors
 *   (programmer bugs — asset-ops.js precedent).
 */
var Htlc = (function () {
  "use strict";
  /**
   * @typedef {import('./types.js').OpTuple} OpTuple
   * @typedef {import('./types.js').ChainObjectId} ChainObjectId
   * @typedef {import('./types.js').FeeAssetId} FeeAssetId
   * @typedef {import('./types.js').RawInt} RawInt
   */
  var CORE_ASSET = "1.3.0";
  var HTLC_START = "1.16.0", PERM_START = "1.12.0", PAGE_MAX = 100;
  var PROVE_TIMEOUT_MS = 60000, PROVE_INTERVAL_MS = 2500;
  var ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var HTLC_RE = /^1\.16\.\d+$/, PERM_RE = /^1\.12\.\d+$/;
  var DIGITS_RE = /^\d+$/, HEX_RE = /^[0-9a-fA-F]+$/;
  var ALGO_IDS = { ripemd160: 0, sha256: 2 };
  var ALGO_NAMES = { 0: "ripemd160", 2: "sha256" };
  /* Millisecond sleep (sendAndProve prove-poll interval). Params: ms int. Returns: Promise. */
  function _sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  /* One database-API round trip; socket failures -> "not-connected". */
  async function _dbCall(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); } catch (e) {
      if (String((e && e.message) || e || "").indexOf("not connected") === -1) throw e;
      throw new Error("not-connected");
    }
  }
  function _assertId(id, re, name) { if (typeof id !== "string" || !re.test(id)) throw new Error(name + " must match " + re + ", got: " + JSON.stringify(id)); }
  function _assertDigits(raw, name) { if (typeof raw !== "string" || !DIGITS_RE.test(raw)) throw new Error(name + " must be a digit string, got: " + JSON.stringify(raw)); }
  function _assertU16(n, name) { if (!Number.isInteger(n) || n < 0 || n > 0xFFFF) throw new Error(name + " must be u16, got: " + JSON.stringify(n)); }
  function _assertU32(n, name) { if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) throw new Error(name + " must be u32, got: " + JSON.stringify(n)); }
  function _assertPrecision(p) { if (!Number.isInteger(p) || p < 0 || p > 12) throw new Error("precision must be 0-12, got: " + JSON.stringify(p)); }
  /* Guard: Format.parseAmount must be loaded (builders take human amounts). Fails "format-unavailable". */
  function _needFormat() { if (typeof Format === "undefined" || !Format.parseAmount) throw new Error("format-unavailable (format.js first)"); }
  /* Name-or-id -> 1.2.N id via Account.resolve (id-only when unloaded). Fails "unknown-account". */
  async function _resolveAccountId(input) {
    if (typeof input === "string" && ACCOUNT_RE.test(input)) return input;
    if (typeof Account !== "undefined" && Account.resolve) {
      try { return (await Account.resolve(input)).id; } catch (e) { throw new Error("unknown-account"); }
    }
    throw new Error("unknown-account");
  }
  /* Chain "YYYY-MM-DDTHH:MM:SS" -> unix seconds, or null when garbage (chain data never throws). */
  function _toSecs(iso) {
    if (typeof iso !== "string" || !iso) return null;
    var t = Math.floor(new Date(iso.charAt(iso.length - 1) === "Z" ? iso : iso + "Z").getTime() / 1000);
    return Number.isFinite(t) ? t : null;
  }
  /* User start time -> canonical "YYYY-MM-DDTHH:MM:SS" (Task-1 serializer appends Z, UTC). */
  function _normTime(s, name) {
    var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(Z)?$/.exec(String(s || "").trim());
    if (!m) throw new Error(name + " must be YYYY-MM-DDTHH:MM[:SS], got: " + JSON.stringify(s));
    var out = m[1] + "T" + m[2] + ":" + (m[3] || "00");
    if (_toSecs(out) === null) throw new Error(name + " is not a real date-time: " + JSON.stringify(s));
    return out;
  }
  /* String -> UTF-8 bytes (preimage hashing + memo hex payloads). */
  function _utf8(s) { return new TextEncoder().encode(String(s)); }
  /* Bytes -> lowercase hex (hashes, memo payloads). Params: u8 Uint8Array. Returns: hex string. */
  function _hexOfBytes(u8) {
    var s = "", i;
    for (i = 0; i < u8.length; i++) s += (u8[i] < 16 ? "0" : "") + u8[i].toString(16);
    return s;
  }
  /* Chain static_variant [typeId, hex-or-obj] (or {type, hash|data}) -> {typeId, hex}.
   * (Redeem hex passes through as-is; the Task-1 serializer hex-decodes it.) */
  function _parseHash(v) {
    var t, h;
    if (Array.isArray(v)) { t = v[0]; h = v[1]; }
    else if (v && typeof v === "object") { t = v.type; h = v.hash || v.data; }
    else throw new Error("unknown-htlc (bad preimage_hash shape)");
    t = parseInt(t, 10);
    if (typeof h === "object" && h !== null) h = h.hash || h.data || "";
    if (!Number.isInteger(t) || t < 0 || t > 3 || typeof h !== "string" || !HEX_RE.test(h)) throw new Error("unknown-htlc (bad preimage_hash shape)");
    return { typeId: t, hex: h.toLowerCase() };
  }
  /* Distinct asset ids -> {id: precision-or-null} in ONE get_objects call. */
  async function _precisions(assetIds) {
    var seen = {}, ids = [], i;
    for (i = 0; i < (assetIds || []).length; i++) {
      if (typeof assetIds[i] === "string" && ASSET_RE.test(assetIds[i]) && !seen[assetIds[i]]) {
        seen[assetIds[i]] = 1; ids.push(assetIds[i]);
      }
    }
    if (!ids.length) return {};
    var rows = await _dbCall("get_objects", [ids]), map = {};
    for (i = 0; i < rows.length; i++) map[ids[i]] = (rows[i] && typeof rows[i].precision === "number") ? rows[i].precision : null;
    return map;
  }
  /* Raw 1.16.x object -> row (amount raw string; hash = algo-name + hex only, never plaintext). */
  function _htlcRow(o, precMap, nowSecs) {
    var t = o.transfer || {}, hl = (o.conditions || {}).hash_lock || {}, tl = (o.conditions || {}).time_lock || {};
    var parsed = _parseHash(hl.preimage_hash), expSecs = _toSecs(tl.expiration);
    return { id: o.id, from_id: t.from, to_id: t.to, amount_raw: String(t.amount), asset_id: t.asset_id,
      precision: (precMap[t.asset_id] !== undefined) ? precMap[t.asset_id] : null,
      algo: ALGO_NAMES[parsed.typeId] || ("unknown(" + parsed.typeId + ")"),
      hash_hex: parsed.hex, preimage_size: hl.preimage_size, expiration_iso: tl.expiration || null,
      expired: expSecs !== null && nowSecs >= expSecs };
  }
  /* Raw 1.12.x object -> row. available_raw ports available_this_period (:81-88): new period
   * started -> full limit, else limit - claimed floored at 0 (BigInt on raw strings). */
  function _permRow(o, precMap, nowSecs) {
    var lim = o.withdrawal_limit || {}, period = parseInt(o.withdrawal_period_sec, 10) || 0;
    var startSecs = _toSecs(o.period_start_time), expSecs = _toSecs(o.expiration);
    var limitRaw = String(lim.amount), claimedRaw = String(o.claimed_this_period);
    var avail;
    if (startSecs === null || nowSecs >= startSecs + period) avail = limitRaw;
    else { var d = BigInt(limitRaw) - BigInt(claimedRaw); avail = (d < 0n ? 0n : d).toString(); }
    return { id: o.id, from_id: o.withdraw_from_account, to_id: o.authorized_account,
      limit_raw: limitRaw, asset_id: lim.asset_id,
      precision: (precMap[lim.asset_id] !== undefined) ? precMap[lim.asset_id] : null,
      period_sec: period,
      periods_left: (period > 0 && expSecs !== null) ? Math.max(0, Math.ceil((expSecs - nowSecs) / period)) : null,
      start_iso: o.period_start_time || null, expiration_iso: o.expiration || null,
      claimed_raw: claimedRaw, available_raw: avail,
      started: startSecs !== null && nowSecs >= startSecs };
  }
  /* Single HTLC + precision join. Fails "unknown-htlc" (bad shape OR null read) / "not-connected". */
  async function htlc(id) {
    if (typeof id !== "string" || !HTLC_RE.test(id)) throw new Error("unknown-htlc");
    var o = await _dbCall("get_htlc", [id]);
    if (!o) throw new Error("unknown-htlc");
    var precMap = await _precisions([(o.transfer || {}).asset_id]);
    return _htlcRow(o, precMap, Math.floor(Date.now() / 1000));
  }
  /* Sent + received HTLCs (start "1.16.0", limit 100 — #1 DirectDebit.jsx:44-61 convention).
   * Returns {sent[], received[]}; empty lists OK. Fails "unknown-account" / "not-connected". */
  async function mine(accountId) {
    var id = await _resolveAccountId(accountId);
    var res = await Promise.all([_dbCall("get_htlc_by_from", [id, HTLC_START, PAGE_MAX]), _dbCall("get_htlc_by_to", [id, HTLC_START, PAGE_MAX])]);
    var all = (res[0] || []).concat(res[1] || []), aids = [], i;
    for (i = 0; i < all.length; i++) aids.push((all[i].transfer || {}).asset_id);
    var precMap = await _precisions(aids), nowSecs = Math.floor(Date.now() / 1000);
    /* Raw 1.16.x rows -> display rows (closed over precMap + nowSecs). */
    function mapHtlcRows(rows) { return rows.map(function (o) { return _htlcRow(o, precMap, nowSecs); }); }
    return { sent: mapHtlcRows(res[0] || []), received: mapHtlcRows(res[1] || []) };
  }
  /* Permissions as giver + recipient (start "1.12.0", limit 100). Returns {asGiver[], asRecipient[]}.
   * Fails "unknown-account" / "not-connected". */
  async function permissions(accountId) {
    var id = await _resolveAccountId(accountId);
    var res = await Promise.all([_dbCall("get_withdraw_permissions_by_giver", [id, PERM_START, PAGE_MAX]), _dbCall("get_withdraw_permissions_by_recipient", [id, PERM_START, PAGE_MAX])]);
    var all = (res[0] || []).concat(res[1] || []), aids = [], i;
    for (i = 0; i < all.length; i++) aids.push((all[i].withdrawal_limit || {}).asset_id);
    var precMap = await _precisions(aids), nowSecs = Math.floor(Date.now() / 1000);
    /* Raw 1.12.x rows -> display rows (closed over precMap + nowSecs). */
    function mapPermRows(rows) { return rows.map(function (o) { return _permRow(o, precMap, nowSecs); }); }
    return { asGiver: mapPermRows(res[0] || []), asRecipient: mapPermRows(res[1] || []) };
  }
  /* Typed preimage -> {typeId, hex, size} over UTF-8 BYTES (ambiguity B: size = byte length).
   * sha256 via WebCrypto (Tx.sha256Bytes precedent); ripemd160 unvendored -> explicit-hash-only.
   * Fails "bad-preimage" (empty input). */
  async function hashPreimage(algo, preimage) {
    if (algo !== "sha256") {
      if (algo === "ripemd160") throw new Error("ripemd160-unavailable (not vendored — sha256-only; explicit [0, hex] still accepted)");
      throw new Error("unknown hash algo (want sha256): " + JSON.stringify(algo));
    }
    if (typeof preimage !== "string" || !preimage) throw new Error("bad-preimage");
    if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("sha256-unavailable (needs a secure context)");
    var bytes = _utf8(preimage);
    _assertU16(bytes.length, "preimage byte size");
    var digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return { typeId: 2, hex: _hexOfBytes(digest), size: bytes.length };
  }
  /* Redeem-form live hash-match check (#2 HTLC.jsx:261-303): green match or "hash-mismatch"
   * (confirm stays disabled; the node would reject anyway). Returns {match:true, size}. */
  async function checkPreimage(algo, preimage, typeId, hashHex) {
    var h = await hashPreimage(algo, preimage);
    if (h.typeId !== parseInt(typeId, 10) || h.hex !== String(hashHex || "").toLowerCase()) throw new Error("hash-mismatch");
    return { match: true, size: h.size };
  }
  /* Op-49 htlc_create (ASYNC: hashes the preimage when given — the buildFeed precedent).
   * EITHER preimageOrNull (hashed here, size auto = UTF-8 bytes) OR hashHexOrNull + sizeOrNull
   * (STRICT length: 64 hex iff sha256 else 40 — a padded hash locks funds till timeout, #3
   * :3121-3130). Variant ids 0/2 only (ambiguity A — never 1/3). Returns Promise of [49, opData]. */
  async function buildCreate(args) {
    args = args || {};
    _assertId(args.fromId, ACCOUNT_RE, "fromId");
    _assertId(args.toId, ACCOUNT_RE, "toId");
    _assertId(args.assetId, ASSET_RE, "assetId");
    _assertPrecision(args.precision);
    _needFormat();
    var raw = Format.parseAmount(args.amountHuman, args.precision);
    if (ALGO_IDS[args.algo] === undefined) throw new Error("unknown hash algo (want sha256|ripemd160): " + JSON.stringify(args.algo));
    var typeId = ALGO_IDS[args.algo], hex, size;
    if (args.preimageOrNull !== null && args.preimageOrNull !== undefined) {
      if (args.hashHexOrNull !== null && args.hashHexOrNull !== undefined) throw new Error("give preimage or hash, not both");
      var h = await hashPreimage(args.algo, args.preimageOrNull);
      hex = h.hex; size = h.size; typeId = h.typeId;
    } else {
      hex = String(args.hashHexOrNull || "").toLowerCase();
      var want = (typeId === 2) ? 64 : 40;
      if (!HEX_RE.test(hex) || hex.length !== want) throw new Error("hash hex must be " + want + " hex chars for " + args.algo);
      if (args.sizeOrNull === null || args.sizeOrNull === undefined) throw new Error("sizeOrNull is required with an explicit hash");
      _assertU16(args.sizeOrNull, "sizeOrNull");
      size = args.sizeOrNull;
    }
    _assertU32(args.claimSeconds, "claimSeconds");
    if (args.claimSeconds < 1) throw new Error("claimSeconds must be >= 1");
    return [49, { fee: { amount: "0", asset_id: CORE_ASSET }, from: args.fromId, to: args.toId,
      amount: { amount: raw, asset_id: args.assetId }, preimage_hash: [typeId, hex],
      preimage_size: size, claim_period_seconds: args.claimSeconds, extensions: [] }];
  }
  /* Op-50 htlc_redeem. preimageHex = UTF-8 preimage as hex (#1 Buffer->hex->bytes round trip);
   * Task-1 serializer hex-decodes it. No memo field on op 50. Fails "bad-preimage" on malformed hex. */
  function buildRedeem(args) {
    args = args || {};
    if (typeof args.htlcId !== "string" || !HTLC_RE.test(args.htlcId)) throw new Error("htlcId must be 1.16.N");
    _assertId(args.redeemerId, ACCOUNT_RE, "redeemerId");
    var hex = String(args.preimageHex || "");
    if (!HEX_RE.test(hex) || hex.length % 2 !== 0 || hex.length === 0) throw new Error("bad-preimage");
    return [50, { fee: { amount: "0", asset_id: CORE_ASSET }, htlc_id: args.htlcId,
      redeemer: args.redeemerId, preimage: hex.toLowerCase(), extensions: [] }];
  }
  /* Op-52 htlc_extend (secondsToAdd u32 >= 1; new expiry = old + delta, previewed in views). */
  function buildExtend(args) {
    args = args || {};
    if (typeof args.htlcId !== "string" || !HTLC_RE.test(args.htlcId)) throw new Error("htlcId must be 1.16.N");
    _assertId(args.issuerId, ACCOUNT_RE, "issuerId");
    _assertU32(args.secondsToAdd, "secondsToAdd");
    if (args.secondsToAdd < 1) throw new Error("secondsToAdd must be >= 1");
    return [52, { fee: { amount: "0", asset_id: CORE_ASSET }, htlc_id: args.htlcId,
      update_issuer: args.issuerId, seconds_to_add: args.secondsToAdd, extensions: [] }];
  }
  /* Shared op-25/26 gates: party/asset ids, precision, limit raw, period/count
   * u32 >= 1 (chain rejects zero periods; fail here, not after a fee). Returns the limit raw string. */
  function _debitCommon(args) {
    _assertId(args.fromId, ACCOUNT_RE, "fromId");
    _assertId(args.toId, ACCOUNT_RE, "toId");
    _assertId(args.assetId, ASSET_RE, "assetId");
    _assertPrecision(args.precision);
    _needFormat();
    var raw = Format.parseAmount(args.limitHuman, args.precision);
    _assertU32(args.periodSec, "periodSec");
    if (args.periodSec < 1) throw new Error("periodSec must be >= 1");
    _assertU32(args.periodsCount, "periodsCount");
    if (args.periodsCount < 1) throw new Error("periodsCount must be >= 1");
    return raw;
  }
  /* Op-25 withdraw_permission_create. limitHuman -> raw; startIso -> time_point_sec string.
   * No extensions key (the struct has none). Returns [25, opData]. */
  function buildDebitCreate(args) {
    args = args || {};
    var raw = _debitCommon(args);
    return [25, { fee: { amount: "0", asset_id: CORE_ASSET },
      withdraw_from_account: args.fromId, authorized_account: args.toId,
      withdrawal_limit: { amount: raw, asset_id: args.assetId },
      withdrawal_period_sec: args.periodSec, periods_until_expiration: args.periodsCount,
      period_start_time: _normTime(args.startIso, "startIso") }];
  }
  /* Op-26 withdraw_permission_update. ORDER TRAP (plan Reference #7): period_start_time
   * serializes BEFORE periods_until_expiration (unlike op 25) — headers :83-105, #2
   * :1029-1038, #3 :2728-2739; testnet update broadcast is the proof (ambiguity D). */
  function buildDebitUpdate(args) {
    args = args || {};
    if (typeof args.permId !== "string" || !PERM_RE.test(args.permId)) throw new Error("permId must be 1.12.N");
    var raw = _debitCommon(args);
    return [26, { fee: { amount: "0", asset_id: CORE_ASSET },
      withdraw_from_account: args.fromId, authorized_account: args.toId,
      permission_to_update: args.permId,
      withdrawal_limit: { amount: raw, asset_id: args.assetId },
      withdrawal_period_sec: args.periodSec,
      period_start_time: _normTime(args.startIso, "startIso"),
      periods_until_expiration: args.periodsCount }];
  }
  /* Claim-form client gate (saves a fee; the chain re-enforces). Throws "period-not-started"
   * (first period not begun — #1 DirectDebit.jsx:206) / "limit-exceeded" (> available or <= 0). */
  function checkClaim(row, amountRaw) {
    if (!row || typeof row !== "object") throw new Error("row must be a permission row");
    _assertDigits(String(amountRaw), "amountRaw");
    var amt = BigInt(String(amountRaw));
    if (amt <= 0n) throw new Error("limit-exceeded (claim amount must be > 0)");
    if (!row.started) throw new Error("period-not-started");
    if (amt > BigInt(String(row.available_raw))) throw new Error("limit-exceeded");
    return { ok: true };
  }
  /* Op-27 withdraw_permission_claim (payer = CLAIMANT withdraw_to_account — label it in confirms).
   * ASYNC (the buildFeed precedent): with a memo it resolves BOTH parties' memo_key
   * pubkeys in ONE get_objects read — serializeMemo (tx.js) needs pubkeys, and the old
   * account-id memo died at sign time with "invalid base58 character". Missing memo
   * keys fail with a clear-the-memo message (transfer-ui.js fullAccount precedent);
   * memoOrNull empty -> the plain [27, opData] pair, no chain read. With a memo returns
   * {pair, memoWarning:true} so the view MUST warn (memo stays PLAINTEXT v1 on-chain). */
  async function buildDebitClaim(args) {
    args = args || {};
    if (typeof args.permId !== "string" || !PERM_RE.test(args.permId)) throw new Error("permId must be 1.12.N");
    _assertId(args.fromId, ACCOUNT_RE, "fromId");
    _assertId(args.toId, ACCOUNT_RE, "toId");
    _assertId(args.assetId, ASSET_RE, "assetId");
    _assertPrecision(args.precision);
    _needFormat();
    var raw = Format.parseAmount(args.amountHuman, args.precision);
    var opData = { fee: { amount: "0", asset_id: CORE_ASSET }, withdraw_permission: args.permId,
      withdraw_from_account: args.fromId, withdraw_to_account: args.toId,
      amount_to_withdraw: { amount: raw, asset_id: args.assetId }, memo: null };
    if (args.memoOrNull === null || args.memoOrNull === undefined || String(args.memoOrNull) === "") return [27, opData];
    var rows = await _dbCall("get_objects", [[args.fromId, args.toId]]);
    var fromKey = rows && rows[0] && rows[0].options ? rows[0].options.memo_key : null;
    var toKey = rows && rows[1] && rows[1].options ? rows[1].options.memo_key : null;
    if (!fromKey) throw new Error("Giver " + args.fromId + " has no memo key; clear the memo to continue.");
    if (!toKey) throw new Error("Claimant " + args.toId + " has no memo key; clear the memo to continue.");
    opData.memo = { from: fromKey, to: toKey, nonce: "0", message: _hexOfBytes(_utf8(String(args.memoOrNull))) };
    return { pair: [27, opData], memoWarning: true };
  }
  /* Op-28 withdraw_permission_delete (free cancel — fee 0 observed live; confirm shows it). */
  function buildDebitDelete(args) {
    args = args || {};
    if (typeof args.permId !== "string" || !PERM_RE.test(args.permId)) throw new Error("permId must be 1.12.N");
    _assertId(args.fromId, ACCOUNT_RE, "fromId");
    _assertId(args.toId, ACCOUNT_RE, "toId");
    return [28, { fee: { amount: "0", asset_id: CORE_ASSET },
      withdraw_from_account: args.fromId, authorized_account: args.toId, withdrawal_permission: args.permId }];
  }
  /* Live fee for one op pair via Tx.fee (fee_per_day / fee_per_kb scaling answered by chain).
   * Fills opPair[1].fee IN PLACE with the chain answer (transfer-ui.js:411
   * driver-side pattern, centralized here so every view broadcasts the answered
   * fee, never the builders' fee-0 placeholder). Returns Promise of {amount (raw string), asset_id}. */
  async function fee(opPair, feeAssetId) {
    if (!Array.isArray(opPair) || !Number.isInteger(opPair[0]) || !opPair[1]) throw new Error("opPair must be [opId, opData]");
    if (typeof Tx === "undefined" || !Tx.fee) throw new Error("tx-unavailable");
    var ans = await Tx.fee(opPair[0], opPair[1], feeAssetId || CORE_ASSET);
    opPair[1].fee = { amount: String(ans.amount), asset_id: ans.asset_id };
    return { amount: String(ans.amount), asset_id: ans.asset_id };
  }
  /* Sign + send + prove (vote-pattern shape). proveFn: async () -> truthy match or falsy
   * (htlc(id)/permissions/balance re-read). Rejections throw sendRejected:true (safe retry);
   * ACCEPTED-but-unproven throws WITHOUT it — check state, never blindly rebroadcast. */
  async function sendAndProve(signedTx, wif, proveFn) {
    if (!signedTx || !Array.isArray(signedTx.operations) || !signedTx.operations.length) throw new Error("signedTx has no operations");
    if (!Tx.wifOk(wif)) throw new Error("wallet-locked");
    if (typeof proveFn !== "function") throw new Error("proveFn must be a function");
    if (typeof Tx === "undefined" || !Tx.signRouted) throw new Error("tx-unavailable");
    var routed = await Tx.signRouted(signedTx, wif, {});
    var txSigned = routed.signed;
    var via;
    if (routed.delegated) {
      /* Extension mode: the SW signed + broadcast behind approval — skip
       * the local broadcast; the prove loop below runs unchanged. */
      via = ((routed.proof && routed.proof.via) ? routed.proof.via : "extension") + "+extension";
    } else {
    var netId;
    try { netId = await Chain.net(); } catch (e) { throw new Error("not-connected"); }
    via = "broadcast_transaction_with_callback";
    var callbackId = (Math.random() * 4294967296) >>> 0;
    try { await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, txSigned]); }
    catch (e) {
      via = "broadcast_transaction";
      try { await Chain.call(netId, "broadcast_transaction", [txSigned]); } catch (e2) { e2.sendRejected = true; throw e2; }
    }
    }
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    for (;;) {
      var ok = null;
      try { ok = await proveFn(); } catch (e) { ok = null; }
      if (ok) return { via: via + "+re-read", proof: ok };
      if (Date.now() >= deadline) throw new Error("Sent (" + via + ") but unproven within " +
        (PROVE_TIMEOUT_MS / 1000) + "s; check state before retrying (do NOT blindly rebroadcast).");
      await _sleep(PROVE_INTERVAL_MS);
    }
  }
  /** Seconds -> human duration ("86400" -> "1 day"; 90000 -> "1 day 1 hour"). Integer math only.
   * Views show this AND raw seconds in confirms (both, never raw-only — principle #6).
   * @param {any} sec
   * @returns {string} */
  function formatDuration(sec) {
    var n = (typeof sec === "string") ? parseInt(sec, 10) : sec;
    if (!Number.isInteger(n) || n < 0) throw new Error("bad duration seconds: " + JSON.stringify(sec));
    var parts = [], u = [[86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]], i, q;
    for (i = 0; i < u.length; i++) {
      q = Math.floor(n / /** @type {number} */ (u[i][0])); n = n % /** @type {number} */ (u[i][0]);
      if (q) parts.push(q + " " + u[i][1] + (q === 1 ? "" : "s"));
    }
    return parts.length ? parts.join(" ") : "0 seconds";
  }
  /* Chain UTC "YYYY-MM-DDTHH:MM:SS" -> locale date-time via I18n.date
   * (slice-17 Task 2: the single Intl precedent migrates to the prefs-locale
   * tag; same medium date+time options, same Z-normalized UTC instant — the
   * only change vs the old undefined-locale call is which locale formats it.
   * Falls back to the old inline Intl call when i18n.js failed to load.) */
  function formatDateTime(iso) {
    if (typeof iso !== "string" || _toSecs(iso) === null) throw new Error("bad-date: " + JSON.stringify(iso));
    var stamped = iso.charAt(iso.length - 1) === "Z" ? iso : iso + "Z";
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.date === "function") return I18n.date(stamped);
    } catch (e) { /* inline fallback below */ }
    var d = new Date(stamped);
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(d);
  }
  return { htlc: htlc, mine: mine, permissions: permissions, hashPreimage: hashPreimage,
    checkPreimage: checkPreimage, buildCreate: buildCreate, buildRedeem: buildRedeem, buildExtend: buildExtend,
    buildDebitCreate: buildDebitCreate, buildDebitUpdate: buildDebitUpdate, checkClaim: checkClaim,
    buildDebitClaim: buildDebitClaim, buildDebitDelete: buildDebitDelete,
    fee: fee, sendAndProve: sendAndProve, formatDuration: formatDuration, formatDateTime: formatDateTime };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.Htlc === "undefined") { globalThis.Htlc = Htlc; }
if (typeof module !== "undefined") { module.exports = Htlc; }
