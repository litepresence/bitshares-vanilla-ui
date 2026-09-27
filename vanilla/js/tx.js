/* tx.js — graphene serializer subset + tx build/sign/broadcast (ops 0-2, 6, 10-15, 19, 25-28, 49, 50, 52).
 *
 * What it owns: binary serialization of transfer (op 0), limit_order_create
 * (op 1), limit_order_cancel (op 2), account_update (op 6, voting only),
 * asset_create (op 10), asset_update (op 11), asset_update_bitasset (op 12),
 * asset_update_feed_producers (op 13), asset_issue (op 14), asset_reserve
 * (op 15), asset_publish_feed (op 19), withdraw_permission_create (op 25),
 * withdraw_permission_update (op 26), withdraw_permission_claim (op 27),
 * withdraw_permission_delete (op 28), htlc_create (op 49), htlc_redeem
 * (op 50) and htlc_extend (op 52) transactions, unsigned-tx
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
 * - voteIdToUint32         <- #3 bitshares-api.js:2126-2134 ("type:instance"
 *                             string -> (type&0xff)|((instance&0xffffff)<<8))
 *                             + #4 .../protocol/vote.hpp:42-49 (wire u32 =
 *                             instance<<8|type), :68-70 (ctor content)
 * - serializeAccountOptions
 *                          <- #3 bitshares-api.js:2116-2140 (pubkey,
 *                             voting_account default '1.2.5', u16 counts,
 *                             varint-counted vote u32s, empty extensions)
 *                             + #4 .../protocol/account.hpp:39-59 (FC field
 *                             order) + sorted-before-publish #1
 *                             AccountVoting.jsx:354-361
 * - serializeAccountUpdateOp
 *                          <- #3 bitshares-api.js:2420-2429 (fee, account,
 *                             owner?, active?, new_options?, extensions)
 *                             + #4 .../protocol/account.hpp:151-162
 * - op 6 = account_update_operation <- #4 .../protocol/operations.hpp:62
 * - writeUint8              <- #3 bitshares-api.js:1931-1933
 * - serializeIdSet (sorted) <- #3 bitshares-api.js:1998-2000 (varint count +
 *                              items; vanilla sorts a COPY numerically because
 *                              #4 stores these fields as flat_set — identical
 *                              bytes for already-sorted input, canonical bytes
 *                              otherwise; string sort would misorder 1.2.10
 *                              before 1.2.9)
 * - serializePrice          <- #3 bitshares-api.js:2145-2150
 *                              + #4 .../protocol/asset.hpp:310 (base)(quote)
 * - serializeAssetOptions   <- #3 bitshares-api.js:2155-2176
 *                              + #4 .../protocol/asset_ops.hpp:47-102 (struct)
 *                              + FC :626-639
 * - serializeBitassetOptions<- #3 bitshares-api.js:2181-2192
 *                              + #4 .../protocol/asset_ops.hpp:109-186 (struct)
 *                              + FC :650-658
 * - serializePriceFeed      <- #3 bitshares-api.js:2197-2204
 *                              + #4 .../protocol/asset.hpp:160-189 (struct)
 *                              + FC .../protocol/asset.hpp:312-313
 * - serializeAssetCreateOp  <- #3 bitshares-api.js:2475-2486
 *                              + #4 .../protocol/asset_ops.hpp:192-226 (struct)
 *                              + FC :682-691
 * - serializeAssetUpdateOp  <- #3 bitshares-api.js:2492-2501
 *                              + #4 .../protocol/asset_ops.hpp:351-382 (struct)
 *                              + FC :692-699
 * - serializeAssetUpdateBitassetOp
 *                           <- #3 bitshares-api.js:2507-2515
 *                              + #4 .../protocol/asset_ops.hpp:398-411 (struct)
 * - serializeAssetUpdateFeedProducersOp
 *                           <- #3 bitshares-api.js:2521-2529
 *                              + #4 .../protocol/asset_ops.hpp:430-439 (struct)
 * - serializeAssetIssueOp   <- #3 bitshares-api.js:2535-2550
 *                              + #4 .../protocol/asset_ops.hpp:485-505 (struct)
 * - serializeAssetReserveOp <- #3 bitshares-api.js:2556-2563
 *                              + #4 .../protocol/asset_ops.hpp:513-524 (struct)
 * - serializeAssetPublishFeedOp
 *                           <- #3 bitshares-api.js:2610-2618
 *                              + #4 .../protocol/asset_ops.hpp:462-480 (struct)
 * - ops 10-15, 19 ids       <- #4 .../protocol/operations.hpp:66-75
 *                              (/* 10 *\/ … /* 19 *\/)
 * - serializeTimestamp       <- #3 bitshares-api.js:1959-1973 (ISO-with-Z /
 *                              unix-seconds -> u32 LE; vanilla throws on
 *                              missing/unparseable input instead of defaulting
 *                              0 — loud failure, same rule as precision/MCR)
 * - assertUint32             <- local guard (writeUint32LE folds via >>> 0,
 *                              so it can not reject floats/strings; the seven
 *                              ops below need loud integer checks)
 * - serializeHtlcHash        <- #3 bitshares-api.js:3104-3132 (variant varint
 *                              + STRICT length check, 32 iff type 2 else 20)
 *                              + #4 .../protocol/htlc.hpp:33-43 (variant order
 *                              ripemd160/sha1/sha256/hash160)
 * - serializeHtlcCreateOp    <- #3 bitshares-api.js:3094-3137
 *                              + #4 .../protocol/htlc.hpp:226-227 (FC order)
 * - serializeHtlcRedeemOp    <- #3 bitshares-api.js:3143-3151
 *                              + #4 .../protocol/htlc.hpp:228
 * - serializeHtlcExtendOp    <- #3 bitshares-api.js:3171-3179
 *                              + #4 .../protocol/htlc.hpp:231
 * - serializeWithdrawPermissionCreateOp
 *                            <- #3 bitshares-api.js:2711-2721
 *                              + #4 .../protocol/withdraw_permission.hpp:176-178
 * - serializeWithdrawPermissionUpdateOp (TRAP: period_start_time BEFORE
 *   periods_until_expiration — unlike op 25)
 *                            <- #3 bitshares-api.js:2728-2739
 *                              + #4 .../protocol/withdraw_permission.hpp:179-182
 * - serializeWithdrawPermissionClaimOp
 *                            <- #3 bitshares-api.js:2745-2759
 *                              + #4 .../protocol/withdraw_permission.hpp:183-184
 * - serializeWithdrawPermissionDeleteOp
 *                            <- #3 bitshares-api.js:2765-2772
 *                              + #4 .../protocol/withdraw_permission.hpp:185-187
 * - op dispatch 25-28, 49/50/52
 *                            <- #3 bitshares-api.js:1547-1554, :1595-1604
 *                              (51/53 VIRTUAL — never dispatched, see the
 *                              dispatch-site comment)
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
 * - asset_create order (fee)(issuer)(symbol)(precision)(common_options)
 *   (bitasset_opts)(is_prediction_market)(extensions)
 *   <- bitshares-core .../protocol/asset_ops.hpp:682-691 (FC_REFLECT)
 * - asset_update order (fee)(issuer)(asset_to_update)(new_issuer)
 *   (new_options)(extensions) <- .../protocol/asset_ops.hpp:692-699
 * - asset_update_bitasset order (fee)(issuer)(asset_to_update)(new_options)
 *   (extensions) <- struct .../protocol/asset_ops.hpp:398-411
 * - asset_update_feed_producers order (fee)(issuer)(asset_to_update)
 *   (new_feed_producers)(extensions) <- struct .../protocol/asset_ops.hpp:430-439
 * - asset_issue order (fee)(issuer)(asset_to_issue)(issue_to_account)(memo)
 *   (extensions) <- struct .../protocol/asset_ops.hpp:485-505
 * - asset_reserve order (fee)(payer)(amount_to_reserve)(extensions)
 *   <- struct .../protocol/asset_ops.hpp:513-524
 * - asset_publish_feed order (fee)(publisher)(asset_id)(feed)(extensions)
 *   <- struct .../protocol/asset_ops.hpp:462-480
 * - asset_options order (max_supply)(market_fee_percent)(max_market_fee)
 *   (issuer_permissions)(flags)(core_exchange_rate)(whitelist_authorities)
 *   (blacklist_authorities)(whitelist_markets)(blacklist_markets)
 *   (description)(extensions) <- .../protocol/asset_ops.hpp:626-639
 * - bitasset_options order (feed_lifetime_sec)(minimum_feeds)
 *   (force_settlement_delay_sec)(force_settlement_offset_percent)
 *   (maximum_force_settlement_volume)(short_backing_asset)(extensions)
 *   <- .../protocol/asset_ops.hpp:650-658
 * - price_feed order (settlement_price)(maintenance_collateral_ratio)
 *   (maximum_short_squeeze_ratio)(core_exchange_rate)
 *   <- .../protocol/asset.hpp:312-313 (note: struct declaration lists
 *   core_exchange_rate second at asset.hpp:160-189, but FC_REFLECT order
 *   governs the bytes — matches #3's serializer)
 * - price order (base)(quote), asset order (amount)(asset_id)
 *   <- .../protocol/asset.hpp:309-310
 * - ops 10-19 ids <- .../protocol/operations.hpp:66-75
 * - htlc_create order (fee)(from)(to)(amount)(preimage_hash)
 *   (preimage_size)(claim_period_seconds)(extensions)
 *   <- .../protocol/htlc.hpp:226-227
 * - htlc_redeem order (fee)(htlc_id)(redeemer)(preimage)(extensions)
 *   <- .../protocol/htlc.hpp:228
 * - htlc_extend order (fee)(htlc_id)(update_issuer)(seconds_to_add)(extensions)
 *   <- .../protocol/htlc.hpp:231
 * - withdraw_permission_create order (fee)(withdraw_from_account)
 *   (authorized_account)(withdrawal_limit)(withdrawal_period_sec)
 *   (periods_until_expiration)(period_start_time)
 *   <- .../protocol/withdraw_permission.hpp:176-178
 * - withdraw_permission_update order (fee)(withdraw_from_account)
 *   (authorized_account)(permission_to_update)(withdrawal_limit)
 *   (withdrawal_period_sec)(period_start_time)(periods_until_expiration)
 *   <- .../protocol/withdraw_permission.hpp:179-182 (NOTE the trap:
 *   period_start_time comes BEFORE periods_until_expiration, unlike op 25)
 * - withdraw_permission_claim order (fee)(withdraw_permission)
 *   (withdraw_from_account)(withdraw_to_account)(amount_to_withdraw)(memo)
 *   <- .../protocol/withdraw_permission.hpp:183-184
 * - withdraw_permission_delete order (fee)(withdraw_from_account)
 *   (authorized_account)(withdrawal_permission)
 *   <- .../protocol/withdraw_permission.hpp:185-187
 * - ops 25-28, 49-53 ids <- .../protocol/operations.hpp:81-84, :105-109
 *   (51/53 VIRTUAL — never signed, never dispatched)
 * - get_required_fees <- .../app/database_api.hpp:1313
 * - broadcast_transaction_with_callback
 *   <- .../app/api.hpp:360
 * BJS cross-check: slice-10 Task 1 fetched the single upstream serializer
 * file (https://raw.githubusercontent.com/bitshares/bitsharesjs/master/lib/serializer/src/operations.js,
 * fetched 2026-09-27) and confirmed ops 10/11/12/13/14/15/19, asset_options,
 * bitasset_options, price_feed and price field orders match #3/#4 exactly —
 * no conflict, so #4's order stands unchallenged. (Pre-slice-10 ops 0-2, 6:
 * NOT re-checked — no ambiguity found: #3 is explicit and commented, #4
 * FC_REFLECT confirms field order; testnet acceptance is the gate.)
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
 * - serializeIdSet sorts a copy numerically (flat_set wire order). #3 emits
 *   caller order; bytes are identical for already-sorted input.
 * - serializeAssetCreateOp REQUIRES an explicit precision byte (0..12): #3's
 *   `precision || 5` silently remaps an explicit 0 to 5 — vanilla throws
 *   instead. Byte-identical whenever precision is supplied.
 * - serializePriceFeed has NO ||1750/||1500 fallback: #3 silently applies
 *   MCR/MSSR defaults, vanilla throws on missing/non-ratio values (a caller
 *   that forgot the ratio must fail loudly, not publish a default feed).
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

  /* vote_id "type:instance" string (or raw u32 number) -> u32 wire value
   * (instance<<8 | type). #4 vote.hpp:42-49; #3 bitshares-api.js:2126-2134.
   * Instance must fit 24 bits, type 8 bits — anything else throws. No float:
   * the shift/mask path is integer-only (writeUint32LE re-applies >>> 0). */
  function voteIdToUint32(vote) {
    var type, instance;
    if (typeof vote === "string") {
      if (!/^\d+:\d+$/.test(vote)) throw new Error("bad vote id (want \"type:instance\"): " + JSON.stringify(vote));
      var parts = vote.split(":");
      type = parseInt(parts[0], 10);
      instance = parseInt(parts[1], 10);
    } else if (typeof vote === "number" && Number.isInteger(vote) && vote >= 0 && vote <= 0xFFFFFFFF) {
      type = vote & 0xFF;
      instance = vote >>> 8;
    } else {
      throw new Error("bad vote id (want \"type:instance\" or u32): " + JSON.stringify(vote));
    }
    if (type < 0 || type > 0xFF) throw new Error("vote type out of range: " + JSON.stringify(vote));
    if (instance < 0 || instance > 0xFFFFFF) throw new Error("vote instance out of range: " + JSON.stringify(vote));
    return (((instance << 8) | type) >>> 0);
  }

  /* account_options in #4 order: memo_key, voting_account (defaults to the
   * proxy-to-self sentinel "1.2.5" per #4 account.hpp:48 + #3 default),
   * num_witness u16, num_committee u16, votes (varint count + u32 LE each),
   * extensions. Votes sort ascending by (type, instance) before serializing
   * (#1 AccountVoting.jsx:354-361 sorts before publish; #4 account.hpp:58
   * holds a flat_set<vote_id_type>). Counts are plain u16s, not percents. */
  function serializeAccountOptions(opts) {
    if (!opts || typeof opts !== "object") throw new Error("account_options must be an object");
    if (typeof opts.memo_key !== "string" || !opts.memo_key) {
      throw new Error("account_options.memo_key must be a public key string");
    }
    var votingAccount = opts.voting_account || "1.2.5";
    var numWitness = opts.num_witness || 0;
    var numCommittee = opts.num_committee || 0;
    if (!Number.isInteger(numWitness) || numWitness < 0 || numWitness > 0xFFFF) {
      throw new Error("num_witness out of range: " + numWitness);
    }
    if (!Number.isInteger(numCommittee) || numCommittee < 0 || numCommittee > 0xFFFF) {
      throw new Error("num_committee out of range: " + numCommittee);
    }
    var votes = opts.votes || [];
    if (!Array.isArray(votes)) throw new Error("account_options.votes must be an array");
    var u32s = votes.map(voteIdToUint32);
    u32s.sort(function (a, b) {
      var ta = a & 0xFF, tb = b & 0xFF;
      if (ta !== tb) return ta - tb;
      return (a >>> 8) - (b >>> 8);
    });
    var parts = [
      serializePublicKey(opts.memo_key),
      serializeObjectId(votingAccount),
      writeUint16LE(numWitness),
      writeUint16LE(numCommittee),
      varintUint32(u32s.length)
    ];
    for (var i = 0; i < u32s.length; i++) parts.push(writeUint32LE(u32s[i]));
    parts.push(varintUint32(0));
    return concatBytes(parts);
  }

  /* account_update op data (op 6) in #4 order: fee, account, owner?, active?,
   * new_options?, extensions. #3 bitshares-api.js:2420-2429; #4
   * account.hpp:151-162 (fee_payer = account). Voting sets ONLY new_options:
   * a non-null owner/active throws loudly — authority bytes have no
   * serializer in this file (a separate slice owns that, never a silent
   * best-effort here). Undefined optionals encode absent, same convention
   * as the transfer memo path. */
  function serializeAccountUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("account_update op must be an object");
    if (op.owner !== null && op.owner !== undefined) {
      throw new Error("account_update owner authority serialization is not supported (voting sets new_options only)");
    }
    if (op.active !== null && op.active !== undefined) {
      throw new Error("account_update active authority serialization is not supported (voting sets new_options only)");
    }
    var ABSENT = new Uint8Array([0]);
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      ABSENT,
      ABSENT,
      serializeOptional(op.new_options === undefined ? null : op.new_options, serializeAccountOptions),
      varintUint32(0)
    ]);
  }

  /* uint8 single byte (precision, minimum_feeds). Throws on out-of-range. */
  function writeUint8(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xFF) throw new Error("uint8 out of range: " + value);
    return new Uint8Array([value & 0xFF]);
  }

  /* Sorted object-id set: varint count + instance varints. #4 stores these
   * fields as flat_set (sorted); #3 emits caller order, so vanilla sorts a
   * copy numerically by (space, type, instance) — identical bytes for
   * already-sorted input, canonical bytes otherwise. Throws on any
   * non-N.N.N entry (no silent repair, same rule as serializeObjectId). */
  function serializeIdSet(ids) {
    var arr = (ids === null || ids === undefined) ? [] : ids;
    if (!Array.isArray(arr)) throw new Error("id set must be an array");
    var copy = arr.slice();
    copy.sort(function (a, b) {
      var pa = String(a).split("."), pb = String(b).split(".");
      for (var i = 0; i < 3; i++) {
        var d = parseInt(pa[i], 10) - parseInt(pb[i], 10);
        if (d !== 0) return d;
      }
      return 0;
    });
    var parts = [varintUint32(copy.length)];
    for (var i = 0; i < copy.length; i++) parts.push(serializeObjectId(copy[i]));
    return concatBytes(parts);
  }

  /* price {base: asset, quote: asset} in #4 FC order (base)(quote).
   * Integer-only: amounts stay digit strings until writeInt64LE. */
  function serializePrice(price) {
    if (!price || typeof price !== "object") throw new Error("price must be {base, quote}");
    return concatBytes([serializeAsset(price.base), serializeAsset(price.quote)]);
  }

  /* asset_options in #4 FC order: max_supply i64, market_fee_percent u16
   * (HUNDREDTHS: 200 = 2% — never a ratio), max_market_fee i64,
   * issuer_permissions u16, flags u16, core_exchange_rate price, four id
   * sets, description string, empty extensions. Scalar fallbacks mirror #3;
   * the CER is structural and must be present. Extensions always encode
   * empty (ambiguity C: populated only on proven testnet need, Task 4). */
  function serializeAssetOptions(o) {
    if (!o || typeof o !== "object") throw new Error("asset_options must be an object");
    return concatBytes([
      writeInt64LE(o.max_supply || 0),
      writeUint16LE(o.market_fee_percent || 0),
      writeInt64LE(o.max_market_fee || 0),
      writeUint16LE(o.issuer_permissions || 0),
      writeUint16LE(o.flags || 0),
      serializePrice(o.core_exchange_rate),
      serializeIdSet(o.whitelist_authorities),
      serializeIdSet(o.blacklist_authorities),
      serializeIdSet(o.whitelist_markets),
      serializeIdSet(o.blacklist_markets),
      serializeString(o.description || ""),
      varintUint32(0)
    ]);
  }

  /* bitasset_options in #4 FC order: feed_lifetime_sec u32, minimum_feeds u8,
   * force_settlement_delay_sec u32, force_settlement_offset_percent u16
   * (hundredths), maximum_force_settlement_volume u16 (hundredths),
   * short_backing_asset id, EMPTY extensions (ambiguity B: BSIP74/75/77 ext
   * populated only on proven testnet need, Task 4). */
  function serializeBitassetOptions(o) {
    if (!o || typeof o !== "object") throw new Error("bitasset_options must be an object");
    return concatBytes([
      writeUint32LE(o.feed_lifetime_sec || 0),
      writeUint8(o.minimum_feeds || 0),
      writeUint32LE(o.force_settlement_delay_sec || 0),
      writeUint16LE(o.force_settlement_offset_percent || 0),
      writeUint16LE(o.maximum_force_settlement_volume || 0),
      serializeObjectId(o.short_backing_asset || "1.3.0"),
      varintUint32(0)
    ]);
  }

  /* Collateral-ratio field check: integer in [1, 10000] (fixed point over
   * GRAPHENE_COLLATERAL_RATIO_DENOM = 1000, #4 asset.hpp:165-189 — e.g.
   * 1750 = 175% MCR). NOT hundredths: this formatter must never be reused
   * for percent fields and vice versa. */
  function assertRatioU16(value, name) {
    if (!Number.isInteger(value) || value < 1 || value > 10000) {
      throw new Error(name + " must be an integer ratio 1..10000 (1750 = 175%), got: " + JSON.stringify(value));
    }
  }

  /* price_feed in #4 FC order: settlement_price, MCR u16, MSSR u16,
   * core_exchange_rate. MCR/MSSR are REQUIRED explicit ratio ints — #3's
   * ||1750/||1500 silent fallback is deliberately NOT ported (see header):
   * a caller that forgot the ratio fails loudly instead of publishing a
   * default-looking feed. */
  function serializePriceFeed(f) {
    if (!f || typeof f !== "object") throw new Error("price_feed must be an object");
    assertRatioU16(f.maintenance_collateral_ratio, "maintenance_collateral_ratio");
    assertRatioU16(f.maximum_short_squeeze_ratio, "maximum_short_squeeze_ratio");
    return concatBytes([
      serializePrice(f.settlement_price),
      writeUint16LE(f.maintenance_collateral_ratio),
      writeUint16LE(f.maximum_short_squeeze_ratio),
      serializePrice(f.core_exchange_rate)
    ]);
  }

  /* asset_create (op 10) in #4 FC order: fee, issuer, symbol, precision u8,
   * common_options, bitasset_opts?, is_prediction_market byte, extensions.
   * Precision is REQUIRED (integer 0..12): #3's `precision || 5` silently
   * remaps an explicit 0 to 5 — vanilla throws instead (see header). */
  function serializeAssetCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_create op must be an object");
    if (typeof op.symbol !== "string" || !op.symbol) throw new Error("asset_create symbol must be a non-empty string");
    if (!Number.isInteger(op.precision) || op.precision < 0 || op.precision > 12) {
      throw new Error("asset_create precision must be an integer 0..12, got: " + JSON.stringify(op.precision));
    }
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.issuer),
      serializeString(op.symbol),
      writeUint8(op.precision),
      serializeAssetOptions(op.common_options),
      serializeOptional(op.bitasset_opts === undefined ? null : op.bitasset_opts, serializeBitassetOptions),
      new Uint8Array([op.is_prediction_market ? 1 : 0]),
      varintUint32(0)
    ]);
  }

  /* asset_update (op 11) in #4 FC order: fee, issuer, asset_to_update,
   * new_issuer?, new_options, extensions (empty per ambiguity C). */
  function serializeAssetUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_update op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.issuer),
      serializeObjectId(op.asset_to_update),
      serializeOptional(op.new_issuer === undefined ? null : op.new_issuer, serializeObjectId),
      serializeAssetOptions(op.new_options),
      varintUint32(0)
    ]);
  }

  /* asset_update_bitasset (op 12) in #4 FC order: fee, issuer,
   * asset_to_update, new_options (bitasset_options), extensions (empty per
   * ambiguity B). Target must be market-issued — enforced read-side by
   * asset.js (Task 2), not here: bytes carry no such check. */
  function serializeAssetUpdateBitassetOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_update_bitasset op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.issuer),
      serializeObjectId(op.asset_to_update),
      serializeBitassetOptions(op.new_options),
      varintUint32(0)
    ]);
  }

  /* asset_update_feed_producers (op 13) in #4 FC order: fee, issuer,
   * asset_to_update, new_feed_producers (sorted account-id set),
   * extensions. */
  function serializeAssetUpdateFeedProducersOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_update_feed_producers op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.issuer),
      serializeObjectId(op.asset_to_update),
      serializeIdSet(op.new_feed_producers),
      varintUint32(0)
    ]);
  }

  /* asset_issue (op 14) in #4 FC order: fee, issuer, asset_to_issue,
   * issue_to_account, memo?, extensions. Memo uses the shared full-structure
   * memo serializer via serializeOptional (absent <-> 0x00, same convention
   * as the transfer path; byte-identical to #3's if/else branch). */
  function serializeAssetIssueOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_issue op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.issuer),
      serializeAsset(op.asset_to_issue),
      serializeObjectId(op.issue_to_account),
      serializeOptional(op.memo === undefined ? null : op.memo, serializeMemo),
      varintUint32(0)
    ]);
  }

  /* asset_reserve (op 15) in #4 FC order: fee, payer, amount_to_reserve,
   * extensions. NOT usable on market-issued assets — enforced read-side by
   * asset.js (Task 2) with a `not-market-issued` error, not here. */
  function serializeAssetReserveOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_reserve op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.payer),
      serializeAsset(op.amount_to_reserve),
      varintUint32(0)
    ]);
  }

  /* asset_publish_feed (op 19) in #4 FC order: fee, publisher, asset_id,
   * feed (price_feed), extensions (empty; BSIP77 initial_collateral_ratio
   * ext populated only on proven testnet need, Task 4). */
  function serializeAssetPublishFeedOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_publish_feed op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.publisher),
      serializeObjectId(op.asset_id),
      serializePriceFeed(op.feed),
      varintUint32(0)
    ]);
  }

  /* time_point_sec (uint32 unix seconds). Accepts an ISO "YYYY-MM-DDTHH:MM:SS"
   * string (parsed as UTC, trailing Z added when missing — same convention as
   * serializeTransaction) or a unix-seconds number. Integer-only; throws on
   * missing/unparseable/out-of-range input (deliberate: #3 defaults those to
   * 0, vanilla fails loudly — same rule as precision/MCR). */
  function serializeTimestamp(ts) {
    var secs;
    if (typeof ts === "number") {
      secs = Math.floor(ts);
    } else if (typeof ts === "string") {
      var iso = /[Zz]$/.test(ts) ? ts : ts + "Z";
      secs = Math.floor(new Date(iso).getTime() / 1000);
    } else {
      throw new Error("timestamp must be an ISO string or unix seconds, got: " + JSON.stringify(ts));
    }
    assertUint32(secs, "timestamp");
    return writeUint32LE(secs);
  }

  /* Loud u32 guard for the HTLC/withdraw fields below. writeUint32LE folds
   * via >>> 0 and can not reject floats or digit strings (1.5 -> 1, "3600"
   * -> 3600); these ops fail loudly instead so a caller bug never becomes
   * silently-wrong lock/period bytes. */
  function assertUint32(value, name) {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) {
      throw new Error(name + " must be an integer 0..4294967295, got: " + JSON.stringify(value));
    }
  }

  /* HTLC hash static_variant [typeId, hexStr]: varint typeId + fixed raw
   * bytes with NO length prefix (fc static_variant + fixed-size hash). Wire
   * ids per #4 htlc.hpp:33-43: 0 = ripemd160, 1 = sha1, 2 = sha256,
   * 3 = hash160; 32 bytes iff type 2, else 20. STRICT length check — a
   * padded/truncated hash locks funds until timeout (#3 :3121-3130). Accepts
   * ids 0-3; the Task-2 builder allow-lists sha256 + ripemd160 only
   * (sha1/hash160 unsupported by design — no vendored RIPEMD-160, no
   * trusted sha1; see slice-11 plan ambiguity A). */
  function serializeHtlcHash(pair) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error("htlc preimage_hash must be [typeId, hex] (e.g. [2, \"<64-char sha256 hex>\"])");
    }
    var typeId = pair[0];
    if (!Number.isInteger(typeId) || typeId < 0 || typeId > 3) {
      throw new Error("htlc preimage_hash type must be 0..3 " +
        "(0=ripemd160, 1=sha1, 2=sha256, 3=hash160), got: " + JSON.stringify(typeId));
    }
    var want = (typeId === 2) ? 32 : 20;
    var bytes = hexToBytes(pair[1]);
    if (bytes.length !== want) {
      throw new Error("htlc preimage_hash length " + bytes.length +
        " bytes does not match hash type " + typeId + " (expected " + want + " bytes)");
    }
    return concatBytes([varintUint32(typeId), bytes]);
  }

  /* htlc_create (op 49) in #4 FC order: fee, from, to, amount,
   * preimage_hash (static_variant), preimage_size u16 (UTF-8 BYTE length of
   * the preimage, not char length — set by the Task-2 builder),
   * claim_period_seconds u32, empty extensions (memo-in-HTLC deferred per
   * slice-11 plan ambiguity C). */
  function serializeHtlcCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("htlc_create op must be an object");
    assertUint32(op.claim_period_seconds, "claim_period_seconds");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.from),
      serializeObjectId(op.to),
      serializeAsset(op.amount),
      serializeHtlcHash(op.preimage_hash),
      writeUint16LE(op.preimage_size),
      writeUint32LE(op.claim_period_seconds),
      varintUint32(0)
    ]);
  }

  /* htlc_redeem (op 50) in #4 FC order: fee, htlc_id (1.16.x), redeemer,
   * preimage bytes (caller passes hex — hex-decoded here with a varint
   * length prefix, matching #1's Buffer->hex->bytes round trip), empty
   * extensions. */
  function serializeHtlcRedeemOp(op) {
    if (!op || typeof op !== "object") throw new Error("htlc_redeem op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.htlc_id),
      serializeObjectId(op.redeemer),
      serializeBytesHex(op.preimage),
      varintUint32(0)
    ]);
  }

  /* htlc_extend (op 52) in #4 FC order: fee, htlc_id (1.16.x),
   * update_issuer, seconds_to_add u32, empty extensions. */
  function serializeHtlcExtendOp(op) {
    if (!op || typeof op !== "object") throw new Error("htlc_extend op must be an object");
    assertUint32(op.seconds_to_add, "seconds_to_add");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.htlc_id),
      serializeObjectId(op.update_issuer),
      writeUint32LE(op.seconds_to_add),
      varintUint32(0)
    ]);
  }

  /* withdraw_permission_create (op 25) in #4 FC order: fee,
   * withdraw_from_account, authorized_account, withdrawal_limit,
   * withdrawal_period_sec u32, periods_until_expiration u32,
   * period_start_time (time_point_sec). No extensions field exists. */
  function serializeWithdrawPermissionCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("withdraw_permission_create op must be an object");
    assertUint32(op.withdrawal_period_sec, "withdrawal_period_sec");
    assertUint32(op.periods_until_expiration, "periods_until_expiration");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.withdraw_from_account),
      serializeObjectId(op.authorized_account),
      serializeAsset(op.withdrawal_limit),
      writeUint32LE(op.withdrawal_period_sec),
      writeUint32LE(op.periods_until_expiration),
      serializeTimestamp(op.period_start_time)
    ]);
  }

  /* withdraw_permission_update (op 26) in #4 FC order: fee,
   * withdraw_from_account, authorized_account, permission_to_update (1.12.x),
   * withdrawal_limit, withdrawal_period_sec u32, period_start_time,
   * periods_until_expiration u32. ORDER TRAP (Reference #7): period_start_time
   * comes BEFORE periods_until_expiration here — the reverse of op 25.
   * Swapping them builds validly-signed bytes the node rejects (or worse,
   * misreads), so the order below mirrors the FC_REFLECT line exactly. */
  function serializeWithdrawPermissionUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("withdraw_permission_update op must be an object");
    assertUint32(op.withdrawal_period_sec, "withdrawal_period_sec");
    assertUint32(op.periods_until_expiration, "periods_until_expiration");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.withdraw_from_account),
      serializeObjectId(op.authorized_account),
      serializeObjectId(op.permission_to_update),
      serializeAsset(op.withdrawal_limit),
      writeUint32LE(op.withdrawal_period_sec),
      serializeTimestamp(op.period_start_time),
      writeUint32LE(op.periods_until_expiration)
    ]);
  }

  /* withdraw_permission_claim (op 27) in #4 FC order: fee,
   * withdraw_permission (1.12.x), withdraw_from_account, withdraw_to_account,
   * amount_to_withdraw, memo?. Fee payer is the CLAIMANT
   * (withdraw_to_account). Memo is optional (0x00 when absent — byte-identical
   * to #3's if/else branch); v1 sends it plaintext with a UI warning (see
   * slice-11 plan scope decision). */
  function serializeWithdrawPermissionClaimOp(op) {
    if (!op || typeof op !== "object") throw new Error("withdraw_permission_claim op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.withdraw_permission),
      serializeObjectId(op.withdraw_from_account),
      serializeObjectId(op.withdraw_to_account),
      serializeAsset(op.amount_to_withdraw),
      serializeOptional(op.memo === undefined ? null : op.memo, serializeMemo)
    ]);
  }

  /* withdraw_permission_delete (op 28) in #4 FC order: fee,
   * withdraw_from_account, authorized_account, withdrawal_permission
   * (1.12.x). Fee is 0 (free cancel) — enforced read-side at confirm time,
   * not here. No extensions field exists. */
  function serializeWithdrawPermissionDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("withdraw_permission_delete op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.withdraw_from_account),
      serializeObjectId(op.authorized_account),
      serializeObjectId(op.withdrawal_permission)
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
      else if (opType === 6) parts.push(serializeAccountUpdateOp(opData));
      else if (opType === 10) parts.push(serializeAssetCreateOp(opData));
      else if (opType === 11) parts.push(serializeAssetUpdateOp(opData));
      else if (opType === 12) parts.push(serializeAssetUpdateBitassetOp(opData));
      else if (opType === 13) parts.push(serializeAssetUpdateFeedProducersOp(opData));
      else if (opType === 14) parts.push(serializeAssetIssueOp(opData));
      else if (opType === 15) parts.push(serializeAssetReserveOp(opData));
      else if (opType === 19) parts.push(serializeAssetPublishFeedOp(opData));
      else if (opType === 25) parts.push(serializeWithdrawPermissionCreateOp(opData));
      else if (opType === 26) parts.push(serializeWithdrawPermissionUpdateOp(opData));
      else if (opType === 27) parts.push(serializeWithdrawPermissionClaimOp(opData));
      else if (opType === 28) parts.push(serializeWithdrawPermissionDeleteOp(opData));
      else if (opType === 49) parts.push(serializeHtlcCreateOp(opData));
      else if (opType === 50) parts.push(serializeHtlcRedeemOp(opData));
      else if (opType === 52) parts.push(serializeHtlcExtendOp(opData));
      // Ops 51 (htlc_redeemed) and 53 (htlc_refund) are VIRTUAL (#4
      // operations.hpp:107,109; validate() asserts !"virtual operation" in
      // htlc.hpp:139,199-202) — they can never appear in a signed tx, so
      // they are NEVER dispatched here. Do not "complete" this list.
      else throw new Error("tx.js supports ops 0-2, 6, 10-15, 19, 25-28, 49, 50 and 52, got op " + opType);
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
    OP: {
      transfer: 0, limit_order_create: 1, limit_order_cancel: 2, account_update: 6,
      asset_create: 10, asset_update: 11, asset_update_bitasset: 12,
      asset_update_feed_producers: 13, asset_issue: 14, asset_reserve: 15,
      asset_publish_feed: 19,
      withdraw_permission_create: 25, withdraw_permission_update: 26,
      withdraw_permission_claim: 27, withdraw_permission_delete: 28,
      htlc_create: 49, htlc_redeem: 50, htlc_extend: 52
    },
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
      voteIdToUint32: voteIdToUint32,
      serializeAccountOptions: serializeAccountOptions,
      serializeAccountUpdateOp: serializeAccountUpdateOp,
      writeUint8: writeUint8,
      serializeIdSet: serializeIdSet,
      serializePrice: serializePrice,
      serializeAssetOptions: serializeAssetOptions,
      serializeBitassetOptions: serializeBitassetOptions,
      assertRatioU16: assertRatioU16,
      serializePriceFeed: serializePriceFeed,
      serializeAssetCreateOp: serializeAssetCreateOp,
      serializeAssetUpdateOp: serializeAssetUpdateOp,
      serializeAssetUpdateBitassetOp: serializeAssetUpdateBitassetOp,
      serializeAssetUpdateFeedProducersOp: serializeAssetUpdateFeedProducersOp,
      serializeAssetIssueOp: serializeAssetIssueOp,
      serializeAssetReserveOp: serializeAssetReserveOp,
      serializeAssetPublishFeedOp: serializeAssetPublishFeedOp,
      serializeTimestamp: serializeTimestamp,
      assertUint32: assertUint32,
      serializeHtlcHash: serializeHtlcHash,
      serializeHtlcCreateOp: serializeHtlcCreateOp,
      serializeHtlcRedeemOp: serializeHtlcRedeemOp,
      serializeHtlcExtendOp: serializeHtlcExtendOp,
      serializeWithdrawPermissionCreateOp: serializeWithdrawPermissionCreateOp,
      serializeWithdrawPermissionUpdateOp: serializeWithdrawPermissionUpdateOp,
      serializeWithdrawPermissionClaimOp: serializeWithdrawPermissionClaimOp,
      serializeWithdrawPermissionDeleteOp: serializeWithdrawPermissionDeleteOp,
      serializeTransaction: serializeTransaction
    }
  };
})();

if (typeof module !== "undefined") { module.exports = Tx; }
