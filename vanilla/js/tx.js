/* tx.js — graphene serializer subset + tx build/sign/broadcast (ops 0-2).
 *
 * What it owns: binary serialization of transfer (op 0), limit_order_create
 * (op 1) and limit_order_cancel (op 2) transactions, unsigned-tx
 * construction (single- and multi-op), fee lookup, local signing dispatch,
 * and broadcast with inclusion proof. Later slices extend this file with
 * further ops — new code appends here, never forks a second serializer.
 * Consumes: Chain (db/net/call/status — read-only, never owns the socket),
 * Crypto.signHash (Task 3: 65-byte compact sig; secret-scalar ops stay inside
 * crypto.js — this file NEVER touches private key bytes, it passes the WIF
 * string through opaquely), crypto.subtle (SHA-256 digest only).
 * Side effects: none beyond the single `Tx` global. Created by:
 * building-vanilla-slices skill, slice-04-transfer plan Task 2.
 *
 * Provenance / credits — every serializer below is HAND-PORTED (no import)
 * from wallet-extension/src/lib/bitshares-api.js (#3), cross-checked against
 * bitshares-core (#4) field order. Per-function source lines:
 * - concatBytes            <- #3 bitshares-api.js:1420-1429
 * - writeUint16LE          <- #3 bitshares-api.js:1434-1439
 * - writeUint32LE          <- #3 bitshares-api.js:1444-1453
 * - writeInt64LE           <- #3 bitshares-api.js:1458-1465
 * - varintUint32           <- #3 bitshares-api.js:1479-1488 (writeVarint,
 *                             BigInt loop) + :3723-3731 (encodeVarint)
 * - serializeString        <- #3 bitshares-api.js:1950-1953
 * - serializeOptional      <- #3 bitshares-api.js:1976-1981
 * - serializeBytesHex      <- #3 bitshares-api.js:2031-2041 (serializeBytes)
 * - serializeAsset         <- #3 bitshares-api.js:3599-3604 (serializeAssetAmount)
 * - serializeObjectId      <- #3 bitshares-api.js:3609-3627
 * - serializeMemo          <- #3 bitshares-api.js:3632-3667
 * - serializePublicKey     <- #3 bitshares-api.js:3672-3684
 * - base58Decode           <- #3 bitshares-api.js:3689-3718
 * - serializeTransferOp    <- #3 bitshares-api.js:1701-1728
 * - serializeLimitOrderCreateOp
 *                          <- #3 bitshares-api.js:1760-1807 (fee, seller,
 *                             amount_to_sell, min_to_receive, expiration as
 *                             uint32 seconds via new Date(op.expiration+'Z'),
 *                             fill_or_kill byte, extensions-set collapse)
 * - serializeLimitOrderCancelOp
 *                          <- #3 bitshares-api.js:1812-1828 (fee,
 *                             fee_paying_account, order, extensions)
 * - serializeLimitOrderAutoAction (on_fill path only, best-effort)
 *                          <- #3 bitshares-api.js:1898-1912
 * - serializeTransaction   <- #3 bitshares-api.js:1663-1696
 * - fee placeholder + get_required_fees shape [[[opId, opData]], assetId]
 *                          <- #3 bitshares-api.js:761-788 (getRequiredFee)
 *                             + :795-805 (broadcastTransaction fee fill)
 * - buildTransfer ref-block/expiration logic
 *                          <- #3 bitshares-api.js:885-920 (buildTransaction,
 *                             incl. :895-906 prefix parse, :908-911 expiry)
 * - sign message layout (chainId + packed tx, SHA-256, compact sig hex)
 *                          <- #3 bitshares-api.js:1392-1415 (signTransaction)
 * - hexToBytes/bytesToHex  <- #3 crypto-utils.js:231-243
 * - broadcast callback wire shape [callbackId, signedTx]
 *                          <- #3 bitshares-api.js:855-880
 *                             (broadcastWithConfirmation) + :208-225 (notice
 *                             branch of handleMessage)
 * Field-order truth (#4, wins on any conflict):
 * - transfer op order (fee)(from)(to)(amount)(memo)(extensions)
 *   <- bitshares-core .../protocol/transfer.hpp:108 (FC_REFLECT)
 * - limit_order_create order
 *   (fee)(seller)(amount_to_sell)(min_to_receive)(expiration)(fill_or_kill)(extensions)
 *   <- bitshares-core .../protocol/include/graphene/protocol/market.hpp:297-298
 * - limit_order_cancel order (fee)(fee_paying_account)(order)(extensions)
 *   <- bitshares-core .../protocol/include/graphene/protocol/market.hpp:301-302
 *   (struct declaration lists order before fee_paying_account at :150-153,
 *   but FC_REFLECT order governs the bytes — matches #3's serializer)
 * - memo fields (from)(to)(nonce)(message)
 *   <- bitshares-core .../protocol/memo.hpp:37-61
 * - get_required_fees <- .../app/database_api.hpp:1313
 * - broadcast_transaction_with_callback
 *   <- .../app/api.hpp:360
 * BJS cross-check: NOT consulted (no ambiguity found: #3 is explicit and
 * commented, #4 FC_REFLECT confirms field order; testnet acceptance is the
 * slice-06 Task 3 gate).
 * KNOWN NUANCE (recorded, not guessed): #4 gives
 * create_take_profit_order_action an `extensions` field (market.hpp:46,
 * "Unused. Reserved for future use") which #3's auto-action serializer does
 * not emit. The on_fill path is unused by slice-06 trade flows (extensions
 * always serialize as the empty set, so the auto-action bytes never run);
 * Task 3 cross-checks the empty-extensions bytes only. If on_fill actions
 * are ever built, re-check this byte against the node before signing.
 * DEVIATIONS from #3 (deliberate, narrower — never looser):
 * - serializeObjectId has NO doubled-prefix repair and NO bare-number
 *   acceptance: our ids come from our own account resolution, so a malformed
 *   id throws loudly instead of being silently re-pointed at another object.
 * - Confirmation is callback-send + history-poll, not notice-push (see
 *   broadcast() description: vanilla Chain has no notice dispatcher and
 *   chain.js is append-only in this task; #3 itself documents that some
 *   nodes never push the notice — :846-853).
 */

var Tx = (function () {
  "use strict";

  /* Concatenate Uint8Array parts into one buffer. */
  function concatBytes(arrays) {
    var total = 0, i;
    for (i = 0; i < arrays.length; i++) total += arrays[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < arrays.length; i++) { out.set(arrays[i], off); off += arrays[i].length; }
    return out;
  }

  /* uint16 little-endian (ref_block_num). Throws on out-of-range input. */
  function writeUint16LE(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) throw new Error("uint16 out of range: " + value);
    var buf = new Uint8Array(2);
    buf[0] = value & 0xFF;
    buf[1] = (value >> 8) & 0xFF;
    return buf;
  }

  /* uint32 little-endian (ref_block_prefix, timestamps). Unsigned via >>>. */
  function writeUint32LE(value) {
    var v = Number(value) >>> 0;
    if (!Number.isFinite(v)) throw new Error("uint32 out of range: " + value);
    var buf = new Uint8Array(4);
    buf[0] = v & 0xFF;
    buf[1] = (v >>> 8) & 0xFF;
    buf[2] = (v >>> 16) & 0xFF;
    buf[3] = (v >>> 24) & 0xFF;
    return buf;
  }

  /* int64/uint64 little-endian (amounts, nonce). BigInt only — binary float
   * can not represent 64-bit money values, so Number input is rejected
   * unless it is a safe integer; digit strings are the normal path. */
  function writeInt64LE(value) {
    var big;
    if (typeof value === "bigint") big = value;
    else if (typeof value === "string") {
      if (!/^\d+$/.test(value)) throw new Error("int64 bad digit string: " + value);
      big = BigInt(value);
    } else if (Number.isSafeInteger(value) && value >= 0) big = BigInt(value);
    else throw new Error("int64 needs a digit string or safe integer, got: " + value);
    var buf = new Uint8Array(8);
    for (var i = 0; i < 8; i++) buf[i] = Number((big >> BigInt(i * 8)) & 0xFFn);
    return buf;
  }

  /* Base-128 varint for op ids, counts, object instances. BigInt loop so
   * large instance numbers can not lose precision. */
  function varintUint32(value) {
    var v = typeof value === "bigint" ? value : BigInt(value);
    if (v < 0n) throw new Error("varint needs a non-negative integer, got: " + value);
    var out = [];
    while (v >= 0x80n) { out.push(Number((v & 0x7Fn) | 0x80n)); v >>= 7n; }
    out.push(Number(v));
    return new Uint8Array(out);
  }

  /* UTF-8 string with varint length prefix. */
  function serializeString(str) {
    var bytes = new TextEncoder().encode(str || "");
    return concatBytes([varintUint32(bytes.length), bytes]);
  }

  /* Optional field: 0x00 when absent, 0x01 + payload when present. */
  function serializeOptional(value, fn) {
    if (value === null || value === undefined) return new Uint8Array([0]);
    return concatBytes([new Uint8Array([1]), fn(value)]);
  }

  /* Hex-string bytes with varint length prefix (memo message path). */
  function serializeBytesHex(hex) {
    if (!hex) return varintUint32(0);
    var bytes = hexToBytes(hex);
    return concatBytes([varintUint32(bytes.length), bytes]);
  }

  /* Even-length hex string to bytes; throws on bad input. */
  function hexToBytes(hex) {
    if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error("bad hex string");
    }
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  /* Bytes to lowercase hex string. */
  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }

  /* Bitcoin-alphabet base58 decode (for prefixed public keys). */
  function base58Decode(str) {
    var ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if (str.length === 0) return new Uint8Array(0);
    var bytes = [0], i, j;
    for (i = 0; i < str.length; i++) {
      var value = ALPHABET.indexOf(str[i]);
      if (value === -1) throw new Error("invalid base58 character");
      var carry = value;
      for (j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xFF; carry >>= 8; }
      while (carry > 0) { bytes.push(carry & 0xFF); carry >>= 8; }
    }
    for (i = 0; i < str.length && str[i] === ALPHABET[0]; i++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  /* Strict "space.type.instance" object id -> instance varint. Throws on any
   * other shape (deliberate: no silent repair, see header). */
  function serializeObjectId(id) {
    if (typeof id !== "string" || !/^\d+\.\d+\.\d+$/.test(id)) {
      throw new Error("invalid object id (want N.N.N): " + JSON.stringify(id));
    }
    return varintUint32(parseInt(id.split(".")[2], 10));
  }

  /* Asset amount {amount: int64 digit string, asset_id: object id}. */
  function serializeAsset(a) {
    if (!a || typeof a !== "object") throw new Error("asset needs {amount, asset_id}");
    return concatBytes([writeInt64LE(a.amount), serializeObjectId(a.asset_id)]);
  }

  /* Prefixed public key (BTS/TEST/GPH) -> raw 33 bytes (checksum stripped). */
  function serializePublicKey(pub) {
    if (typeof pub !== "string") throw new Error("public key must be a string");
    var body = pub;
    var prefixes = ["TEST", "BTS", "GPH"];
    for (var i = 0; i < prefixes.length; i++) {
      if (body.indexOf(prefixes[i]) === 0) { body = body.slice(prefixes[i].length); break; }
    }
    var decoded = base58Decode(body);
    if (decoded.length < 33) throw new Error("public key decodes short");
    return decoded.slice(0, 33);
  }

  /* Memo {from, to, nonce, message(hex)} — full structure always (the node's
   * deserializer fills missing fields with defaults, so bytes must match). */
  function serializeMemo(memo) {
    if (!memo || typeof memo !== "object") throw new Error("memo must be an object");
    var parts = [];
    parts.push(memo.from ? serializePublicKey(memo.from) : new Uint8Array(33));
    parts.push(memo.to ? serializePublicKey(memo.to) : new Uint8Array(33));
    parts.push(writeInt64LE(memo.nonce || "0"));
    parts.push(serializeBytesHex(memo.message || ""));
    return concatBytes(parts);
  }

  /* Transfer op data in #4 order: fee, from, to, amount, memo?, extensions. */
  function serializeTransferOp(op) {
    if (!op || typeof op !== "object") throw new Error("transfer op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.from),
      serializeObjectId(op.to),
      serializeAsset(op.amount),
      serializeOptional(op.memo === undefined ? null : op.memo, serializeMemo),
      varintUint32(0)
    ]);
  }

  /* One limit_order_auto_action (static_variant; only type 0 =
   * create_take_profit_order_action is defined). Port of #3: type varint,
   * then fee_asset_id, spread/size percents (uint16), expiration_seconds
   * (uint32), repeat byte. Unknown future types emit the type varint only.
   * Runs ONLY when an order carries on_fill actions (slice-06 never does —
   * see the header nuance note before relying on these bytes). */
  function serializeLimitOrderAutoAction(action) {
    var typeIdx, d;
    if (Array.isArray(action)) { typeIdx = action[0]; d = action[1]; }
    else {
      d = action || {};
      typeIdx = (d.type === undefined || d.type === null) ? 0 : d.type;
    }
    var parts = [varintUint32(typeIdx)];
    if (typeIdx === 0) {
      parts.push(serializeObjectId(d.fee_asset_id || "1.3.0"));
      parts.push(writeUint16LE(d.spread_percent === undefined ? 0 : d.spread_percent));
      parts.push(writeUint16LE(d.size_percent === undefined ? 0 : d.size_percent));
      parts.push(writeUint32LE(d.expiration_seconds === undefined ? 0 : d.expiration_seconds));
      parts.push(new Uint8Array([d.repeat ? 1 : 0]));
    }
    return concatBytes(parts);
  }

  /* Limit-order-create op data in #4 FC_REFLECT order: fee, seller,
   * amount_to_sell, min_to_receive, expiration (uint32 seconds), fill_or_kill
   * byte, extensions. Expiration parses "YYYY-MM-DDTHH:MM:SS" as UTC via the
   * appended Z (same convention as serializeTransaction — timestamps, not
   * money, so Date is allowed). Extensions collapse per #3: empty set
   * varint(0) unless on_fill actions are present, in which case one
   * static_variant entry of type 0 holding the action vector. */
  function serializeLimitOrderCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("limit_order_create op must be an object");
    if (typeof op.expiration !== "string") throw new Error("limit_order_create expiration must be a string");
    var expSecs = Math.floor(new Date(op.expiration + "Z").getTime() / 1000);
    if (!Number.isFinite(expSecs)) throw new Error("limit_order_create bad expiration: " + op.expiration);
    var parts = [
      serializeAsset(op.fee),
      serializeObjectId(op.seller),
      serializeAsset(op.amount_to_sell),
      serializeAsset(op.min_to_receive),
      writeUint32LE(expSecs >>> 0),
      new Uint8Array([op.fill_or_kill ? 1 : 0])
    ];
    var extArr = Array.isArray(op.extensions) ? op.extensions : [];
    var onFill = [];
    for (var i = 0; i < extArr.length; i++) {
      var item = extArr[i];
      var typeIdx = Array.isArray(item) ? item[0] : 0;
      var data = Array.isArray(item) ? item[1] : item;
      if (typeIdx === 0 && data && Array.isArray(data.on_fill)) {
        for (var j = 0; j < data.on_fill.length; j++) onFill.push(data.on_fill[j]);
      }
    }
    if (onFill.length > 0) {
      parts.push(varintUint32(1));
      parts.push(varintUint32(0));
      parts.push(varintUint32(onFill.length));
      for (var k = 0; k < onFill.length; k++) parts.push(serializeLimitOrderAutoAction(onFill[k]));
    } else {
      parts.push(varintUint32(0));
    }
    return concatBytes(parts);
  }

  /* Limit-order-cancel op data in #4 FC_REFLECT order: fee,
   * fee_paying_account (= order seller), order (1.7.x), extensions. */
  function serializeLimitOrderCancelOp(op) {
    if (!op || typeof op !== "object") throw new Error("limit_order_cancel op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.fee_paying_account),
      serializeObjectId(op.order),
      varintUint32(0)
    ]);
  }

  /* Signing serialization: ref_block_num + ref_block_prefix + expiration +
   * op count + (op id varint + op bytes)* + extension count. Signatures are
   * NOT part of the signed bytes. Expiration "YYYY-MM-DDTHH:MM:SS" parses as
   * UTC via the appended Z (matches #3). */
  function serializeTransaction(tx) {
    if (!tx || typeof tx !== "object") throw new Error("tx must be an object");
    var parts = [];
    parts.push(writeUint16LE(tx.ref_block_num));
    parts.push(writeUint32LE(tx.ref_block_prefix));
    parts.push(writeUint32LE(Math.floor(new Date(tx.expiration + "Z").getTime() / 1000)));
    var ops = tx.operations || [];
    parts.push(varintUint32(ops.length));
    for (var i = 0; i < ops.length; i++) {
      var opType = ops[i][0], opData = ops[i][1];
      parts.push(varintUint32(opType));
      if (opType === 0) parts.push(serializeTransferOp(opData));
      else if (opType === 1) parts.push(serializeLimitOrderCreateOp(opData));
      else if (opType === 2) parts.push(serializeLimitOrderCancelOp(opData));
      else throw new Error("tx.js supports ops 0-2, got op " + opType);
    }
    parts.push(varintUint32((tx.extensions || []).length));
    return concatBytes(parts);
  }

  /* SHA-256 digest bytes via platform WebCrypto (no dependency). */
  async function sha256Bytes(u8) {
    var buf = await crypto.subtle.digest("SHA-256", u8);
    return new Uint8Array(buf);
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* Assert strict object-id shape, naming the field on failure. */
  function assertObjectId(id, name) {
    if (typeof id !== "string" || !/^\d+\.\d+\.\d+$/.test(id)) {
      throw new Error(name + " must be an object id (N.N.N), got: " + JSON.stringify(id));
    }
  }

  /* Fee lookup: pre-fills opData.fee with a zero placeholder (the node
   * requires the fee field present), then returns the chain's answered
   * {amount, asset_id}. Amount stays raw (caller formats via Format). */
  async function fee(opId, opData, feeAssetId) {
    feeAssetId = feeAssetId || "1.3.0";
    if (!Number.isInteger(opId) || opId < 0) throw new Error("opId must be a non-negative integer");
    if (!opData || typeof opData !== "object") throw new Error("opData must be an object");
    if (!opData.fee || typeof opData.fee !== "object") opData.fee = { amount: 0, asset_id: feeAssetId };
    var dbId = await Chain.db();
    var fees = await Chain.call(dbId, "get_required_fees", [[[opId, opData]], feeAssetId]);
    if (!fees || !fees[0]) throw new Error("get_required_fees returned no fee");
    return { amount: fees[0].amount, asset_id: fees[0].asset_id };
  }

  /* Multi-op fee lookup: ONE get_required_fees call with the FULL op list
   * (never one call per op). Fills each opsArray[i][1].fee in place with
   * its {amount, asset_id} answer. Returns {fees, totalRaw, totalDisplay}:
   * fees is the per-op [{amount, asset_id}] list, totalRaw is the BigInt
   * sum as a digit string (no float), totalDisplay is totalRaw formatted
   * via Format.formatAmount in the charged fee asset's precision (resolved
   * with one get_assets read of the answered asset id — the display call,
   * not a second fee call). Mixed-asset fee answers sum raw regardless;
   * callers in this slice always pay one asset, so the display precision
   * comes from fees[0]. Fails: empty ops array, length-mismatched answer,
   * non-digit fee amounts, unknown fee asset, missing Format global. */
  async function feeMulti(opsArray, feeAssetId) {
    feeAssetId = feeAssetId || "1.3.0";
    if (!Array.isArray(opsArray) || !opsArray.length) {
      throw new Error("feeMulti needs a non-empty ops array");
    }
    for (var i = 0; i < opsArray.length; i++) {
      var e = opsArray[i];
      if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < 0 ||
          !e[1] || typeof e[1] !== "object") {
        throw new Error("feeMulti ops[" + i + "] must be [opId, opData]");
      }
      if (!e[1].fee || typeof e[1].fee !== "object") e[1].fee = { amount: 0, asset_id: feeAssetId };
    }
    var dbId = await Chain.db();
    var fees = await Chain.call(dbId, "get_required_fees", [opsArray, feeAssetId]);
    if (!Array.isArray(fees) || fees.length !== opsArray.length) {
      throw new Error("get_required_fees returned " +
        (Array.isArray(fees) ? fees.length : "no") + " fees for " + opsArray.length + " ops");
    }
    var total = 0n;
    for (var k = 0; k < fees.length; k++) {
      if (!fees[k] || typeof fees[k] !== "object") throw new Error("get_required_fees fee " + k + " is not an object");
      var raw = String(fees[k].amount);
      if (!/^\d+$/.test(raw)) throw new Error("get_required_fees fee " + k + " is not a digit string: " + raw);
      total += BigInt(raw);
      opsArray[k][1].fee = { amount: fees[k].amount, asset_id: fees[k].asset_id };
    }
    var displayFeeId = (fees[0] && fees[0].asset_id) || feeAssetId;
    var rows = await Chain.call(dbId, "get_assets", [[displayFeeId]]);
    if (!rows || !rows[0] || typeof rows[0].precision !== "number") {
      throw new Error("bad-asset-shape for fee asset " + displayFeeId);
    }
    var F = (typeof globalThis !== "undefined" && globalThis.Format) ? globalThis.Format : null;
    if (!F || typeof F.formatAmount !== "function") {
      throw new Error("Format.formatAmount is not loaded (format.js)");
    }
    var totalRaw = total.toString();
    return {
      fees: opsArray.map(function (entry) { return entry[1].fee; }),
      totalRaw: totalRaw,
      totalDisplay: F.formatAmount(totalRaw, rows[0].precision)
    };
  }

  /* Unsigned transaction envelope for ANY op list. opsArray is
   * [[opId, opData], ...] (same shape serializeTransaction consumes).
   * ref_block_num is head & 0xFFFF; ref prefix is head_block_id bytes 4-7
   * as LE uint32 (hex chars 8-15); expiration is head time + 30s in
   * "YYYY-MM-DDTHH:MM:SS" form. The ops array is used by reference — fees
   * must already be filled (fee()/feeMulti()) before sign(). */
  async function buildTx(opsArray) {
    if (!Array.isArray(opsArray) || !opsArray.length) {
      throw new Error("buildTx needs a non-empty ops array");
    }
    for (var i = 0; i < opsArray.length; i++) {
      var e = opsArray[i];
      if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] < 0 ||
          !e[1] || typeof e[1] !== "object") {
        throw new Error("buildTx ops[" + i + "] must be [opId, opData]");
      }
    }
    var dbId = await Chain.db();
    var props = await Chain.call(dbId, "get_dynamic_global_properties", []);
    var refBlockNum = props.head_block_number & 0xFFFF;
    var hexBytes = props.head_block_id.substring(8, 16);
    var b0 = parseInt(hexBytes.substring(0, 2), 16);
    var b1 = parseInt(hexBytes.substring(2, 4), 16);
    var b2 = parseInt(hexBytes.substring(4, 6), 16);
    var b3 = parseInt(hexBytes.substring(6, 8), 16);
    var refBlockPrefix = ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0);
    var expiration = new Date(new Date(props.time + "Z").getTime() + 30000).toISOString().slice(0, -5);
    return {
      ref_block_num: refBlockNum,
      ref_block_prefix: refBlockPrefix,
      expiration: expiration,
      operations: opsArray,
      extensions: []
    };
  }

  /* Unsigned transfer envelope, built ON TOP of buildTx (no duplicated
   * envelope logic). Fee is a zero placeholder — the caller MUST run fee()
   * at confirm time and assign the answer into
   * tx.operations[0][1].fee before sign(). amountInt is a digit string and
   * is never converted through float. Envelope bytes are identical to the
   * pre-slice-06 builder for the same head block (same derivation, moved
   * verbatim into buildTx). */
  async function buildTransfer(args) {
    args = args || {};
    assertObjectId(args.fromId, "fromId");
    assertObjectId(args.toId, "toId");
    assertObjectId(args.assetId, "assetId");
    if (typeof args.amountInt !== "string" || !/^\d+$/.test(args.amountInt) || /^0+$/.test(args.amountInt)) {
      throw new Error("amountInt must be a positive integer string");
    }
    if (args.memoObj !== null && args.memoObj !== undefined && typeof args.memoObj !== "object") {
      throw new Error("memoObj must be null or {from, to, nonce, message}");
    }
    var op = {
      fee: { amount: 0, asset_id: "1.3.0" },
      from: args.fromId,
      to: args.toId,
      amount: { amount: args.amountInt, asset_id: args.assetId },
      extensions: []
    };
    if (args.memoObj) op.memo = args.memoObj;
    return buildTx([[0, op]]);
  }

  /* Sign: digest = SHA-256(chainId + packed tx), compact sig via
   * Crypto.signHash (Task 3 interface: (hashU8, wif) -> Promise 65 bytes).
   * The WIF string passes through opaquely — never decoded here. */
  async function sign(txObj, activeWIF) {
    if (!txObj || !Array.isArray(txObj.operations) || !txObj.operations.length) {
      throw new Error("txObj has no operations");
    }
    if (typeof activeWIF !== "string" || !activeWIF) throw new Error("activeWIF must be a non-empty string");
    var st = (typeof Chain !== "undefined" && Chain.status) ? Chain.status() : null;
    if (!st || !st.chainId) throw new Error("chain id unknown: connect first");
    if (typeof Crypto === "undefined" || typeof Crypto.signHash !== "function") {
      throw new Error("Crypto.signHash is not loaded (Task 3)");
    }
    var packed = serializeTransaction(txObj);
    var chainBytes = hexToBytes(st.chainId);
    var msg = new Uint8Array(chainBytes.length + packed.length);
    msg.set(chainBytes);
    msg.set(packed, chainBytes.length);
    var digest = await sha256Bytes(msg);
    var sig = await Crypto.signHash(digest, activeWIF);
    if (!(sig instanceof Uint8Array) || sig.length !== 65) throw new Error("Crypto.signHash must return 65 bytes");
    txObj.signatures = [bytesToHex(sig)];
    return txObj;
  }

  /* Scan the sender's recent history for our transfer at/after minBlock.
   * Matches on op id + from/to + raw amount; returns block position or null
   * after the deadline. History entries carry no txid in this API version,
   * so content match IS the inclusion proof. */
  async function pollHistoryForTransfer(fromId, toId, amountRaw, minBlock, deadlineMs, intervalMs) {
    var histId = await Chain.history();
    while (Date.now() < deadlineMs) {
      var h = null;
      try {
        h = await Chain.call(histId, "get_account_history", [fromId, "1.11.0", 20, "1.11.0"]);
      } catch (e) { h = null; }
      if (Array.isArray(h)) {
        for (var i = 0; i < h.length; i++) {
          var entry = h[i][1] || h[i];
          if (!entry || entry.block_num < minBlock) continue;
          var op = entry.op;
          if (!Array.isArray(op) || op[0] !== 0) continue;
          var d = op[1] || {};
          if (d.from === fromId && d.to === toId &&
              String((d.amount || {}).amount) === String(amountRaw)) {
            return { blockNum: entry.block_num, trxInBlock: entry.trx_in_block };
          }
        }
      }
      await sleep(intervalMs);
    }
    return null;
  }

  /* Broadcast with inclusion proof. Sends via broadcast_transaction_with_callback
   * FIRST (same wire shape as #3: [callbackId, signedTx]); if the node rejects
   * the method itself, falls back to plain broadcast_transaction once. Either
   * way, inclusion is confirmed by polling the sender's history — never by
   * trusting the send ack. WHY (recorded per task): (1) vanilla Chain has no
   * unsolicited-notice ("method":"notice") dispatcher and chain.js is
   * append-only in this task, so the push #3 waits on has nowhere to land;
   * (2) #3's own comment (:846-853) documents that some public nodes never
   * push the notice, so polling is the reliable path on those nodes too.
   * Resolves {blockNum, trxInBlock, via}. Rejects with the node's error text
   * on broadcast failure, or a do-NOT-rebroadcast timeout error when the send
   * was accepted but inclusion was not observed (rebroadcasting blindly could
   * double-spend the transfer). */
  async function broadcast(signedTx, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || 30000;
    if (!signedTx || !Array.isArray(signedTx.operations) || !signedTx.operations.length) {
      throw new Error("signedTx has no operations");
    }
    var opData = signedTx.operations[0][1] || {};
    var netId = await Chain.net();
    var headBefore = 0;
    try {
      var dbId = await Chain.db();
      var props = await Chain.call(dbId, "get_dynamic_global_properties", []);
      headBefore = props.head_block_number || 0;
    } catch (e) { headBefore = 0; }
    var callbackId = (Math.random() * 4294967296) >>> 0;
    var via = "broadcast_transaction_with_callback";
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, signedTx]);
    } catch (e) {
      via = "broadcast_transaction";
      await Chain.call(netId, "broadcast_transaction", [signedTx]);
    }
    var found = await pollHistoryForTransfer(
      opData.from, opData.to, (opData.amount || {}).amount,
      headBefore, Date.now() + timeoutMs, 2500
    );
    if (!found) {
      throw new Error("broadcast accepted but inclusion not observed within " + timeoutMs +
        "ms; check history before retrying (do NOT blindly rebroadcast)");
    }
    return { blockNum: found.blockNum, trxInBlock: found.trxInBlock, via: via + "+history-poll" };
  }

  return {
    OP: { transfer: 0, limit_order_create: 1, limit_order_cancel: 2 },
    fee: fee,
    feeMulti: feeMulti,
    buildTx: buildTx,
    buildTransfer: buildTransfer,
    sign: sign,
    broadcast: broadcast,
    _ser: {
      concatBytes: concatBytes,
      writeUint16LE: writeUint16LE,
      writeUint32LE: writeUint32LE,
      writeInt64LE: writeInt64LE,
      varintUint32: varintUint32,
      serializeString: serializeString,
      serializeOptional: serializeOptional,
      serializeBytesHex: serializeBytesHex,
      hexToBytes: hexToBytes,
      bytesToHex: bytesToHex,
      base58Decode: base58Decode,
      serializeObjectId: serializeObjectId,
      serializeAsset: serializeAsset,
      serializePublicKey: serializePublicKey,
      serializeMemo: serializeMemo,
      serializeTransferOp: serializeTransferOp,
      serializeLimitOrderCreateOp: serializeLimitOrderCreateOp,
      serializeLimitOrderCancelOp: serializeLimitOrderCancelOp,
      serializeLimitOrderAutoAction: serializeLimitOrderAutoAction,
      serializeTransaction: serializeTransaction
    }
  };
})();

if (typeof module !== "undefined") { module.exports = Tx; }
