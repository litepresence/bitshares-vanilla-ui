#!/usr/bin/env node
/* tx-primitives-test.js — byte-vector unit tests for vanilla/js/api/tx-primitives.js.
 *
 * What it owns: asserts for the shared serializer primitives every op writer
 *   builds on (writeUint32LE + writeUint16LE/writeInt64LE/varintUint32,
 *   serializeString incl. empty + multi-byte-prefix lengths, serializeObjectId,
 *   serializeHtlcHash incl. type/length guards, serializePrice /
 *   serializePriceFeed (core_exchange_rate shape), serializeAsset, and the
 *   timestamp/vesting/ratio guards). Pure-logic vectors only: no network,
 *   no keys, deterministic. Stdlib `assert` only.
 * Consumes: vanilla/js/api/tx-primitives.js via require (module.exports = Tx,
 *   writers live on Tx._ser). No globals needed.
 * Side effects: none (prints one summary line, exit 0 = green / 1 = red).
 * Created by: R-B-T1 new-unit-suites round.
 */
"use strict";
var assert = require("assert");
var Tx = require("../vanilla/js/api/tx-primitives.js");
var S = Tx._ser;

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function hex(u8) { return S.bytesToHex(u8); }
function throws(fn, name) {
  assert.throws(fn, Error, name);
  passed++;
}

/* 1-6: writeUint32LE boundary values + little-endian order. */
eq(hex(S.writeUint32LE(0)), "00000000", "u32 zero");
eq(hex(S.writeUint32LE(1)), "01000000", "u32 one LE");
eq(hex(S.writeUint32LE(0xFFFFFFFF)), "ffffffff", "u32 max-u32");
eq(hex(S.writeUint32LE(0x12345678)), "78563412", "u32 byte order LE");
eq(hex(S.writeUint32LE(0x80000000)), "00000080", "u32 high bit");
eq(hex(S.writeUint32LE(4294967295)), "ffffffff", "u32 max as decimal");

/* 7-12: writeUint32LE loud guards (never silent >>>0 folds). */
throws(function () { S.writeUint32LE(-1); }, "u32 rejects negative");
throws(function () { S.writeUint32LE(0x100000000); }, "u32 rejects overflow");
throws(function () { S.writeUint32LE(1.5); }, "u32 rejects float");
throws(function () { S.writeUint32LE("3600"); }, "u32 rejects digit string");
throws(function () { S.writeUint32LE(NaN); }, "u32 rejects NaN");
throws(function () { S.writeUint32LE(undefined); }, "u32 rejects undefined");

/* 13-17: writeUint16LE boundaries + guards. */
eq(hex(S.writeUint16LE(0)), "0000", "u16 zero");
eq(hex(S.writeUint16LE(0xFFFF)), "ffff", "u16 max");
eq(hex(S.writeUint16LE(0x1234)), "3412", "u16 LE order");
throws(function () { S.writeUint16LE(-1); }, "u16 rejects negative");
throws(function () { S.writeUint16LE(65536); }, "u16 rejects overflow");

/* 18-23: writeInt64LE money path (BigInt/integer-only, 8 bytes LE). */
eq(hex(S.writeInt64LE("0")), "0000000000000000", "i64 zero string");
eq(hex(S.writeInt64LE("1")), "0100000000000000", "i64 one LE");
eq(hex(S.writeInt64LE("18446744073709551615")), "ffffffffffffffff", "i64 max-u64");
eq(hex(S.writeInt64LE(0)), "0000000000000000", "i64 safe-int zero");
throws(function () { S.writeInt64LE("-1"); }, "i64 rejects negative string");
throws(function () { S.writeInt64LE("18446744073709551616"); }, "i64 rejects 2^64 overflow");

/* 24-28: varintUint32 base-128 framing. */
eq(hex(S.varintUint32(0)), "00", "varint zero");
eq(hex(S.varintUint32(127)), "7f", "varint single-byte max");
eq(hex(S.varintUint32(128)), "8001", "varint two-byte min");
eq(hex(S.varintUint32(300)), "ac02", "varint 300");
throws(function () { S.varintUint32(-1); }, "varint rejects negative");

/* 29-32: serializeString empty + multi-byte-prefix (max-len shape). */
eq(hex(S.serializeString("")), "00", "string empty -> bare count 0");
eq(hex(S.serializeString("a")), "0161", "string one char");
var long128 = new Array(129).join("x");
eq(hex(S.serializeString(long128)).slice(0, 4), "8001", "string len-128 uses two-byte varint prefix");
eq(S.serializeString(long128).length, 130, "string len-128 total bytes = 2 + 128");

/* 33-37: serializeObjectId strict N.N.N + instance varint. */
eq(hex(S.serializeObjectId("1.2.0")), "00", "object id instance 0");
eq(hex(S.serializeObjectId("1.3.0")), "00", "object id BTS asset instance 0");
eq(hex(S.serializeObjectId("1.7.300")), "ac02", "object id instance 300 varint");
throws(function () { S.serializeObjectId("1.2"); }, "object id rejects short shape");
throws(function () { S.serializeObjectId(123); }, "object id rejects non-string");

/* 38-43: serializeHtlcHash [typeId, hex] static_variant (no length prefix). */
var sha256hex = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
var h1 = S.serializeHtlcHash([2, sha256hex]);
eq(hex(h1).slice(0, 2), "02", "htlc sha256 type varint 2");
eq(h1.length, 33, "htlc sha256 total 1 + 32 raw bytes");
eq(hex(h1).slice(2), sha256hex, "htlc sha256 raw bytes verbatim, no length prefix");
var ripemdhex = "0102030405060708091011121314151617181920";
var h0 = S.serializeHtlcHash([0, ripemdhex]);
eq(h0.length, 21, "htlc ripemd160 total 1 + 20 raw bytes");
throws(function () { S.serializeHtlcHash([4, sha256hex]); }, "htlc rejects type id 4");
throws(function () { S.serializeHtlcHash([2, ripemdhex]); }, "htlc rejects sha256 with 20 bytes");

/* 44-47: serializeAsset + serializePrice field order (base)(quote). */
var asset = S.serializeAsset({ amount: "100000", asset_id: "1.3.0" });
eq(asset.length, 9, "asset = 8 amount bytes + 1 id byte");
eq(hex(asset).slice(0, 16), hex(S.writeInt64LE("100000")), "asset amount first");
var price = S.serializePrice({
  base: { amount: "100000", asset_id: "1.3.0" },
  quote: { amount: "200000", asset_id: "1.3.1" }
});
eq(price.length, 18, "price = two assets back to back");
eq(hex(price).slice(0, 18), hex(S.serializeAsset({ amount: "100000", asset_id: "1.3.0" })), "price base first");

/* 48-51: serializePriceFeed (settlement + MCR/MSSR ratios + CER). */
function feed(mcr, mssr) {
  return {
    settlement_price: { base: { amount: "1000", asset_id: "1.3.0" }, quote: { amount: "1", asset_id: "1.3.1" } },
    maintenance_collateral_ratio: mcr,
    maximum_short_squeeze_ratio: mssr,
    core_exchange_rate: { base: { amount: "1000", asset_id: "1.3.0" }, quote: { amount: "1", asset_id: "1.3.1" } }
  };
}
var pf = S.serializePriceFeed(feed(1750, 1500));
eq(pf.length, 40, "price_feed = 9 + 2 + 2 + 9 + 18 bytes");
eq(hex(pf).slice(36, 40), "d606", "price_feed MCR 1750 LE after settlement");
throws(function () { S.serializePriceFeed(feed(undefined, 1500)); }, "price_feed rejects missing MCR (no silent default)");
throws(function () { S.serializePriceFeed(feed(0, 1500)); }, "price_feed rejects MCR 0");

/* 52-55: serializeTimestamp + vesting policy + guards. */
eq(hex(S.serializeTimestamp(0)), "00000000", "timestamp epoch number");
eq(hex(S.serializeTimestamp("1970-01-01T00:00:01Z")), "01000000", "timestamp ISO string");
eq(S.serializeVestingPolicy([2, {}]).length, 1, "vesting instant = bare type varint");
throws(function () { S.serializeVestingPolicy([9, {}]); }, "vesting rejects unknown type");

/* 56-57: bitasset options shape + asset options CER requirement. */
var bo = S.serializeBitassetOptions({ feed_lifetime_sec: 86400, minimum_feeds: 7,
  force_settlement_delay_sec: 86400, force_settlement_offset_percent: 100,
  maximum_force_settlement_volume: 2000, short_backing_asset: "1.3.0" });
eq(bo.length, 15, "bitasset options fixed 4+1+4+2+2+1+1 bytes");
throws(function () {
  S.serializeAssetOptions({ max_supply: "1000", core_exchange_rate: null });
}, "asset options rejects missing CER");

console.log("tx-primitives: " + passed + " passed, 0 failed");
