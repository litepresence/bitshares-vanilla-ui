/* tx-primitives.js — shared serializer primitives for the Tx registry.
 *
 * What it owns: byte writers (concatBytes, writeUint16LE, writeUint32LE,
 * writeInt64LE, varintUint32), base codecs (string/optional/bytesHex,
 * object-id/asset/pubkey/memo), and the shared composite helpers every
 * op serializer builds on (price, asset/bitasset options, price_feed,
 * authority, address, timestamps, vesting policy, pubkey/u16/id sets,
 * restrictions, samet collateral/borrower maps, gov asserts).
 * Consumes: nothing (leaf module — no Tx._ser calls at load).
 * Side effects: attaches its functions to the shared `Tx._ser` object
 * (created here if absent); sets globalThis.Tx. Load order in
 * index.html: this file first, then tx-ops-*.js, then tx.js, then
 * tx-send.js. Created by: tx.js responsibility split (slice-18
 * readability pass) — code moved byte-verbatim out of tx.js, internal
 * calls unchanged (same scope), cross-module calls go via Tx._ser.
 * Provenance: HAND-PORTED from wallet-extension/src/lib/bitshares-api.js
 * (#3), cross-checked against bitshares-core (#4) — full per-function
 * credits lived in the tx.js header at split time (see git history).
 */
var Tx = (typeof globalThis !== "undefined" && globalThis.Tx) ? globalThis.Tx : ((typeof Tx !== "undefined") ? Tx : {});
Tx.OP = Tx.OP || {};
Tx._ser = Tx._ser || {};
(function () {
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

  /* uint32 little-endian (ref_block_prefix, timestamps). H4: loud
   * integer + range check — the old >>>0 fold silently wrapped floats,
   * strings, and negatives into a different transaction than intended. */

  function writeUint32LE(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) throw new Error("uint32 out of range: " + value);
    var v = value >>> 0;
    var buf = new Uint8Array(4);
    buf[0] = v & 0xFF;
    buf[1] = (v >>> 8) & 0xFF;
    buf[2] = (v >>> 16) & 0xFF;
    buf[3] = (v >>> 24) & 0xFF;
    return buf;
  }

  /* int64/uint64 little-endian (amounts, nonce). BigInt only — binary float
   * can not represent 64-bit money values, so Number input is rejected
   * unless it is a safe integer; digit strings are the normal path.
   * H4 hardening: negatives and >2^64-1 throw loudly (never fold to bytes). */

  function writeInt64LE(value) {
    var big;
    if (typeof value === "bigint") big = value;
    else if (typeof value === "string") {
      if (!/^\d+$/.test(value)) throw new Error("int64 bad digit string: " + value);
      try { big = BigInt(value); } catch (e) { throw new Error("int64 bad digit string: " + value); }
    } else if (Number.isSafeInteger(value) && value >= 0) big = BigInt(value);
    else throw new Error("int64 needs a digit string or safe integer, got: " + value);
    if (big < 0n) throw new Error("int64 out of range (negative): " + String(value).slice(0, 32));
    if (big > 0xFFFFFFFFFFFFFFFFn) throw new Error("int64 out of range (overflow): " + String(value).slice(0, 32));
    var buf = new Uint8Array(8);
    for (var i = 0; i < 8; i++) buf[i] = Number((big >> BigInt(i * 8)) & 0xFFn);
    return buf;
  }

  /* Base-128 varint for op ids, counts, object instances. BigInt loop so
   * large instance numbers can not lose precision. H4: wraps BigInt()
   * conversion so NaN/floats/strings throw NAMED (never raw TypeError). */

  function varintUint32(value) {
    var v;
    try {
      if (typeof value === "bigint") v = value;
      else if (typeof value === "number") {
        if (!Number.isInteger(value)) throw new Error("varint needs a non-negative integer, got: " + value);
        v = BigInt(value);
      } else if (typeof value === "string" && /^\d+$/.test(value)) v = BigInt(value);
      else throw new Error("varint needs a non-negative integer, got: " + String(value).slice(0, 32));
    } catch (e) {
      if (/^varint needs/.test(e.message)) throw e;
      throw new Error("varint needs a non-negative integer, got: " + String(value).slice(0, 32));
    }
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

  function serializeAuthority(auth) {
    if (auth === null || auth === undefined) {
      return concatBytes([writeUint32LE(0), varintUint32(0), varintUint32(0), varintUint32(0)]);
    }
    if (typeof auth !== "object") throw new Error("authority must be an object");
    var threshold = auth.weight_threshold;
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 0xFFFFFFFF) {
      throw new Error("authority.weight_threshold must be a u32, got: " + JSON.stringify(threshold));
    }
    var parts = [writeUint32LE(threshold)];
    var acc = Array.isArray(auth.account_auths) ? auth.account_auths.slice() : [];
    acc.sort(function (a, b) {
      var pa = String(a[0]).split("."), pb = String(b[0]).split(".");
      for (var i = 0; i < 3; i++) {
        var d = parseInt(pa[i], 10) - parseInt(pb[i], 10);
        if (d !== 0) return d;
      }
      return 0;
    });
    parts.push(varintUint32(acc.length));
    for (var i = 0; i < acc.length; i++) {
      parts.push(serializeObjectId(acc[i][0]));
      parts.push(writeUint16LE(acc[i][1]));
    }
    var keys = Array.isArray(auth.key_auths) ? auth.key_auths.slice() : [];
    keys.sort(function (a, b) {
      var ha = bytesToHex(serializePublicKey(a[0])), hb = bytesToHex(serializePublicKey(b[0]));
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    parts.push(varintUint32(keys.length));
    for (var k = 0; k < keys.length; k++) {
      parts.push(serializePublicKey(keys[k][0]));
      parts.push(writeUint16LE(keys[k][1]));
    }
    var addrs = Array.isArray(auth.address_auths) ? auth.address_auths : [];
    parts.push(varintUint32(addrs.length));
    for (var m = 0; m < addrs.length; m++) {
      parts.push(serializeAddressHex(addrs[m][0]));
      parts.push(writeUint16LE(addrs[m][1]));
    }
    return concatBytes(parts);
  }

  /* ripemd160 address hex (40 chars) -> 20 raw bytes. #4 address.hpp wraps a
   * single fc::ripemd160; BJS Types.address appends the same 20 bytes — the
   * 33-byte pubkey-style write #3 uses for address_auths is not ported. */

  function serializeAddressHex(hex) {
    var bytes = hexToBytes(hex);
    if (bytes.length !== 20) {
      throw new Error("address must be 20 bytes (40 hex chars), got " + bytes.length + " bytes");
    }
    return bytes;
  }

  /* Timestamp to unix seconds without writing: accepts ISO strings (UTC, Z
   * appended when missing — same convention as serializeTimestamp) or
   * unix-seconds numbers. Throws on anything else (never defaults 0). */

  function timestampToSecs(ts) {
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
    return secs;
  }

  /* vesting_policy_initializer static_variant in ARRAY FORM ONLY [type, data]
   * (see header: object form is rejected because the node rejects it too).
   * Type 0 linear = (begin_timestamp, u32 cliff, u32 duration); type 1 cdd =
   * (start_claim, u32 vesting_seconds); type 2 instant = no payload (#4
   * FC_REFLECT_EMPTY — #3/BJS have no correct instant encoding). */

  function serializeVestingPolicy(policy) {
    if (!Array.isArray(policy) || policy.length !== 2) {
      throw new Error("vesting policy must be the array form [type, data] " +
        "(e.g. [0, {begin_timestamp, vesting_cliff_seconds, vesting_duration_seconds}])");
    }
    var type = policy[0], d = policy[1] || {};
    if (type === 0) {
      assertUint32(d.vesting_cliff_seconds, "vesting_cliff_seconds");
      assertUint32(d.vesting_duration_seconds, "vesting_duration_seconds");
      return concatBytes([
        varintUint32(0),
        serializeTimestamp(d.begin_timestamp),
        writeUint32LE(d.vesting_cliff_seconds),
        writeUint32LE(d.vesting_duration_seconds)
      ]);
    } else if (type === 1) {
      assertUint32(d.vesting_seconds, "vesting_seconds");
      return concatBytes([
        varintUint32(1),
        serializeTimestamp(d.start_claim),
        writeUint32LE(d.vesting_seconds)
      ]);
    } else if (type === 2) {
      return varintUint32(2);
    }
    throw new Error("vesting policy type must be 0 (linear), 1 (cdd) or 2 (instant), got: " +
      JSON.stringify(type));
  }

  /* Sorted public-key set: varint count + raw 33-byte keys ordered by decoded
   * bytes (fc flat_set<public_key_type> order). Used by op-23 key approvals
   * and restriction argument type 24. #3 emits caller order (see header). */

  function serializePubkeySet(keys) {
    var arr = (keys === null || keys === undefined) ? [] : keys;
    if (!Array.isArray(arr)) throw new Error("pubkey set must be an array");
    var decoded = arr.map(function (k) { return serializePublicKey(k); });
    decoded.sort(function (a, b) {
      var ha = bytesToHex(a), hb = bytesToHex(b);
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    var parts = [varintUint32(decoded.length)];
    for (var i = 0; i < decoded.length; i++) parts.push(decoded[i]);
    return concatBytes(parts);
  }

  /* Sorted u16 set: varint count + u16 LE each, ascending. Used by op-55
   * restrictions_to_remove (flat_set<uint16>). writeUint16LE rejects
   * out-of-range entries loudly. */

  function serializeU16Set(values) {
    var arr = (values === null || values === undefined) ? [] : values;
    if (!Array.isArray(arr)) throw new Error("u16 set must be an array");
    var copy = arr.slice().sort(function (a, b) { return a - b; });
    var parts = [varintUint32(copy.length)];
    for (var i = 0; i < copy.length; i++) parts.push(writeUint16LE(copy[i]));
    return concatBytes(parts);
  }

  /* Sorted object-id set with a caller-supplied item writer. Same numeric
   * (space, type, instance) order as serializeIdSet; covers restriction set
   * argument types 26-38 (account/asset/force_settlement/.../balance ids). */

  function serializeSortedIdSet(ids, writer) {
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
    for (var i = 0; i < copy.length; i++) parts.push(writer(copy[i]));
    return concatBytes(parts);
  }

  /* restriction argument static_variant payload for types 0-41 (member order
   * per #4 restriction.hpp:55-97, BJS operations.js restriction table).
   * argType selects the writer; vectors keep caller order, sets sort.
   * Shape: {argument_type: N, argument: value}; type 0 (void) carries no
   * payload, type 41 (variant_assert_argument) takes [tagInt64, [restrs...]]
   * per #4's pair<int64_t, vector<restriction>> (a BJS upstream gap — implemented
   * here, not punted). */

  function serializeRestrictionArgument(argType, arg) {
    if (!Number.isInteger(argType) || argType < 0 || argType > 41) {
      throw new Error("restriction argument_type must be 0..41, got: " + JSON.stringify(argType));
    }
    if (argType === 0) return new Uint8Array(0);
    if (argType === 1) return new Uint8Array([(arg ? 1 : 0)]);
    if (argType === 2) return writeInt64LE(arg === undefined || arg === null ? "0" : arg);
    if (argType === 3) return serializeString(arg || "");
    if (argType === 4) return writeUint32LE(timestampToSecs(arg === undefined || arg === null ? 0 : arg));
    if (argType === 5) return serializePublicKey(arg);
    if (argType === 6) {
      var h32 = hexToBytes(arg);
      if (h32.length !== 32) throw new Error("restriction sha256 argument must be 32 bytes, got " + h32.length);
      return h32;
    }
    if (argType >= 7 && argType <= 19) return serializeObjectId(arg);
    if (argType === 20) {
      var bools = ((arg === null || arg === undefined) ? [] : arg).slice().sort();
      var bp = [varintUint32(bools.length)];
      for (var i0 = 0; i0 < bools.length; i0++) bp.push(new Uint8Array([bools[i0] ? 1 : 0]));
      return concatBytes(bp);
    }
    if (argType === 21) {
      var ints = ((arg === null || arg === undefined) ? [] : arg).slice();
      ints.sort(function (a, b) {
        var ba = BigInt(a), bb = BigInt(b);
        return ba < bb ? -1 : ba > bb ? 1 : 0;
      });
      var ip = [varintUint32(ints.length)];
      for (var i1 = 0; i1 < ints.length; i1++) ip.push(writeInt64LE(ints[i1]));
      return concatBytes(ip);
    }
    if (argType === 22) {
      var strs = ((arg === null || arg === undefined) ? [] : arg).slice().sort();
      var sp = [varintUint32(strs.length)];
      for (var i2 = 0; i2 < strs.length; i2++) sp.push(serializeString(strs[i2]));
      return concatBytes(sp);
    }
    if (argType === 23) {
      var times = ((arg === null || arg === undefined) ? [] : arg).map(timestampToSecs).sort(function (a, b) { return a - b; });
      var tp = [varintUint32(times.length)];
      for (var i3 = 0; i3 < times.length; i3++) tp.push(writeUint32LE(times[i3]));
      return concatBytes(tp);
    }
    if (argType === 24) return serializePubkeySet(arg);
    if (argType === 25) {
      var raws = ((arg === null || arg === undefined) ? [] : arg).slice();
      var hexes = raws.map(function (h) {
        var b = hexToBytes(h);
        if (b.length !== 32) throw new Error("restriction sha256-set entry must be 32 bytes");
        return bytesToHex(b);
      }).sort();
      var rp = [varintUint32(hexes.length)];
      for (var i4 = 0; i4 < hexes.length; i4++) rp.push(hexToBytes(hexes[i4]));
      return concatBytes(rp);
    }
    if (argType >= 26 && argType <= 38) return serializeSortedIdSet(arg, serializeObjectId);
    if (argType === 39) {
      var vec = (arg === null || arg === undefined) ? [] : arg;
      if (!Array.isArray(vec)) throw new Error("restriction vector argument must be an array");
      var vp = [varintUint32(vec.length)];
      for (var i5 = 0; i5 < vec.length; i5++) vp.push(serializeRestriction(vec[i5]));
      return concatBytes(vp);
    }
    /* argType === 40: vector<vector<restriction>> — outer + inner counts,
     * caller order at both levels (vectors, never sorted). */
    var outer = (arg === null || arg === undefined) ? [] : arg;
    if (!Array.isArray(outer)) throw new Error("restriction nested-vector argument must be an array");
    if (argType === 40) {
      var op = [varintUint32(outer.length)];
      for (var i6 = 0; i6 < outer.length; i6++) {
        var inner = outer[i6] || [];
        if (!Array.isArray(inner)) throw new Error("restriction nested-vector row must be an array");
        op.push(varintUint32(inner.length));
        for (var j6 = 0; j6 < inner.length; j6++) op.push(serializeRestriction(inner[j6]));
      }
      return concatBytes(op);
    }
    /* argType === 41: variant_assert_argument pair<int64_t,
     * vector<restriction>> — [tag, [restrictions]]. writeInt64LE takes digit
     * strings / safe ints / BigInts (negative tags need BigInt form). */
    if (!Array.isArray(arg) || arg.length !== 2 || !Array.isArray(arg[1])) {
      throw new Error("restriction variant_assert argument must be [tagInt64, [restrictions]]");
    }
    var ap = [writeInt64LE(arg[0]), varintUint32(arg[1].length)];
    for (var i7 = 0; i7 < arg[1].length; i7++) ap.push(serializeRestriction(arg[1][i7]));
    return concatBytes(ap);
  }

  /* restriction {member_index varint, restriction_type varint, argument
   * static_variant (type varint + payload), empty extensions} in #4 FC
   * order. member_index/restriction_type/argument_type are REQUIRED integers
   * (#3's `|| 0` would silently file a forgotten restriction under member 0
   * / func_eq — vanilla throws). */

  function serializeRestriction(r) {
    if (!r || typeof r !== "object") throw new Error("restriction must be an object");
    if (!Number.isInteger(r.member_index) || r.member_index < 0) {
      throw new Error("restriction.member_index must be a non-negative integer, got: " +
        JSON.stringify(r.member_index));
    }
    if (!Number.isInteger(r.restriction_type) || r.restriction_type < 0 || r.restriction_type > 13) {
      throw new Error("restriction.restriction_type must be 0..13, got: " +
        JSON.stringify(r.restriction_type));
    }
    return concatBytes([
      varintUint32(r.member_index),
      varintUint32(r.restriction_type),
      varintUint32(r.argument_type === undefined || r.argument_type === null ? 0 : r.argument_type),
      serializeRestrictionArgument(
        r.argument_type === undefined || r.argument_type === null ? 0 : r.argument_type, r.argument),
      varintUint32(0)
    ]);
  }

  /* restriction vector: varint count + items in caller order (fc vector —
   * order is semantic, never sorted). Shared by op-54 restrictions and
   * op-55 restrictions_to_add. */

  function serializeRestrictionArray(list) {
    var arr = (list === null || list === undefined) ? [] : list;
    if (!Array.isArray(arr)) throw new Error("restrictions must be an array");
    var parts = [varintUint32(arr.length)];
    for (var i = 0; i < arr.length; i++) parts.push(serializeRestriction(arr[i]));
    return concatBytes(parts);
  }

  /* account_whitelist (op 7) in #4 FC order: fee, authorizing_account,
   * account_to_list, new_listing u8 (bitfield 0-3: none/white/black/both),
   * extensions. */

  function sortedMapEntries(map) {
    var entries;
    if (Array.isArray(map)) {
      entries = map.slice();
    } else {
      entries = Object.keys(map || {}).map(function (k) { return [k, map[k]]; });
    }
    entries.sort(function (a, b) {
      var pa = String(a[0]).split("."), pb = String(b[0]).split(".");
      for (var i = 0; i < 3; i++) {
        var d = parseInt(pa[i], 10) - parseInt(pb[i], 10);
        if (d !== 0) return d;
      }
      return 0;
    });
    return entries;
  }

  /* flat_map<asset_id, price>: varint count + entries SORTED by asset id
   * (determinism — #4 flat_map is ordered; #3 emits caller order, so bytes
   * are identical for already-sorted input). */

  function serializeCollateralMap(map) {
    var entries = sortedMapEntries(map === undefined || map === null ? {} : map);
    var parts = [varintUint32(entries.length)];
    for (var i = 0; i < entries.length; i++) {
      parts.push(serializeObjectId(entries[i][0]));
      parts.push(serializePrice(entries[i][1]));
    }
    return concatBytes(parts);
  }

  /* flat_map<account_id, share_type>: varint count + entries SORTED by
   * account id. Share values stay digit strings until writeInt64LE
   * (integer-only, same rule as every asset path above). */

  function serializeBorrowerMap(map) {
    var entries = sortedMapEntries(map === undefined || map === null ? {} : map);
    var parts = [varintUint32(entries.length)];
    for (var i = 0; i < entries.length; i++) {
      parts.push(serializeObjectId(entries[i][0]));
      parts.push(writeInt64LE(entries[i][1]));
    }
    return concatBytes(parts);
  }

  /* Optional flat_map: 0x00 when absent, 0x01 + map bytes when present.
   * Present-but-empty encodes 0x01 + count 0 — distinct from absent, so an
   * explicit "clear the map" survives the round trip (matches #3). */

  function serializeOptionalCollateralMap(map) {
    if (map === null || map === undefined) return new Uint8Array([0]);
    return concatBytes([new Uint8Array([1]), serializeCollateralMap(map)]);
  }

  /* Optional flat_map<account_id, share_type>: same absent/present rule. */
  function serializeOptionalBorrowerMap(map) {
    if (map === null || map === undefined) return new Uint8Array([0]);
    return concatBytes([new Uint8Array([1]), serializeBorrowerMap(map)]);
  }

  /* credit_offer_create (op 69) in #4 FC order: fee, owner_account,
   * asset_type, balance int64, fee_rate u32 (1M denom), max_duration_seconds
   * u32, min_deal_amount int64, enabled byte, auto_disable_time
   * (time_point_sec), acceptable_collateral map(asset_id -> price),
   * acceptable_borrowers map(account_id -> int64), empty extensions. */

  function assertGovUrl(url, opName) {
    if (typeof url !== "string") {
      throw new Error(opName + " url must be a string, got: " + JSON.stringify(url));
    }
    if (new TextEncoder().encode(url).length >= 127) {
      throw new Error(opName + " url must be under 127 bytes (GRAPHENE_MAX_URL_LENGTH)");
    }
  }

  /* witness_create (op 20) in #4 FC order: fee, witness_account (1.2.x),
   * url, block_signing_key. NO extensions field exists (witness.hpp:81
   * lists exactly four fields — no trailing set to write, unlike most
   * ops; BJS witness_create agrees). Fee payer is the witness account. */

  function assertAutoRepay(value) {
    if (!Number.isInteger(value) || value < 0 || value > 2) {
      throw new Error("auto_repay must be 0, 1 or 2 " +
        "(0=no_auto_repayment, 1=only_full_repayment, 2=allow_partial_repayment), got: " +
        JSON.stringify(value));
    }
  }

  /* credit_deal_update (op 76) in #4 FC order: fee, account, deal_id,
   * auto_repay u8, empty extensions. The wire field is `account` (as in deal
   * repay); op.borrower is kept ONLY as a fallback per #3's documented trap
   * (:3568-3572), where a canonical dApp op leaves `account` unset and the
   * node defaults it to 1.2.0 (committee) — missing both still throws loudly
   * in serializeObjectId instead of silently targeting the committee
   * account. auto_repay is REQUIRED explicit (see header). */

  function serializeWorkerInitializer(init) {
    if (!Array.isArray(init) || init.length !== 2) {
      throw new Error("worker initializer must be the array form [type, data] " +
        "(0=refund, 1=vesting {pay_vesting_period_days}, 2=burn)");
    }
    var type = init[0], d = init[1] || {};
    if (type === 0 || type === 2) return varintUint32(type);
    if (type === 1) {
      return concatBytes([varintUint32(1), writeUint16LE(d.pay_vesting_period_days)]);
    }
    throw new Error("worker initializer type must be 0 (refund), 1 (vesting) or 2 (burn), got: " +
      JSON.stringify(type));
  }

  /* worker_create (op 34) in #4 FC order: fee, owner, work_begin_date,
   * work_end_date, daily_pay int64, name, url, initializer (static_variant).
   * Timestamps accept the shared ISO/unix-seconds shapes via the helpers
   * above (timestamps, not money, so Date parsing is allowed). Ordering and
   * pay bounds mirror the node's validate() (worker.cpp:30-38: end > begin,
   * 0 < pay < GRAPHENE_MAX_SHARE_SUPPLY = 1e15): violations throw here
   * loudly instead of producing always-rejected bytes. Name/url length
   * guards (name < 63 bytes, url < 127 bytes — config.hpp:40-41) use
   * TextEncoder byte lengths because size() counts bytes, not chars.
   * daily_pay stays a digit string until writeInt64LE (integer-only, same
   * rule as every asset path above). */

  Tx._ser.concatBytes = concatBytes;
  Tx._ser.writeUint16LE = writeUint16LE;
  Tx._ser.writeUint32LE = writeUint32LE;
  Tx._ser.writeInt64LE = writeInt64LE;
  Tx._ser.varintUint32 = varintUint32;
  Tx._ser.serializeString = serializeString;
  Tx._ser.serializeOptional = serializeOptional;
  Tx._ser.serializeBytesHex = serializeBytesHex;
  Tx._ser.hexToBytes = hexToBytes;
  Tx._ser.bytesToHex = bytesToHex;
  Tx._ser.base58Decode = base58Decode;
  Tx._ser.serializeObjectId = serializeObjectId;
  Tx._ser.serializeAsset = serializeAsset;
  Tx._ser.serializePublicKey = serializePublicKey;
  Tx._ser.serializeMemo = serializeMemo;
  Tx._ser.voteIdToUint32 = voteIdToUint32;
  Tx._ser.serializeAccountOptions = serializeAccountOptions;
  Tx._ser.writeUint8 = writeUint8;
  Tx._ser.serializeIdSet = serializeIdSet;
  Tx._ser.serializePrice = serializePrice;
  Tx._ser.serializeAssetOptions = serializeAssetOptions;
  Tx._ser.serializeBitassetOptions = serializeBitassetOptions;
  Tx._ser.assertRatioU16 = assertRatioU16;
  Tx._ser.serializePriceFeed = serializePriceFeed;
  Tx._ser.serializeTimestamp = serializeTimestamp;
  Tx._ser.assertUint32 = assertUint32;
  Tx._ser.serializeHtlcHash = serializeHtlcHash;
  Tx._ser.serializeAuthority = serializeAuthority;
  Tx._ser.serializeAddressHex = serializeAddressHex;
  Tx._ser.timestampToSecs = timestampToSecs;
  Tx._ser.serializeVestingPolicy = serializeVestingPolicy;
  Tx._ser.serializePubkeySet = serializePubkeySet;
  Tx._ser.serializeU16Set = serializeU16Set;
  Tx._ser.serializeSortedIdSet = serializeSortedIdSet;
  Tx._ser.serializeRestrictionArgument = serializeRestrictionArgument;
  Tx._ser.serializeRestriction = serializeRestriction;
  Tx._ser.serializeRestrictionArray = serializeRestrictionArray;
  Tx._ser.sortedMapEntries = sortedMapEntries;
  Tx._ser.serializeCollateralMap = serializeCollateralMap;
  Tx._ser.serializeBorrowerMap = serializeBorrowerMap;
  Tx._ser.serializeOptionalCollateralMap = serializeOptionalCollateralMap;
  Tx._ser.serializeOptionalBorrowerMap = serializeOptionalBorrowerMap;
  Tx._ser.assertGovUrl = assertGovUrl;
  Tx._ser.assertAutoRepay = assertAutoRepay;
  Tx._ser.serializeWorkerInitializer = serializeWorkerInitializer;
  if (typeof globalThis !== "undefined") { globalThis.Tx = Tx; }
})();

if (typeof module !== "undefined") { module.exports = Tx; }
