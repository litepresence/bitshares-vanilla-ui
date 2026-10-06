#!/usr/bin/env node
/* op77-update-test.js — offline byte proofs for op-77 limit_order_update.
 *
 * What it owns: byte-exact checks that vanilla/js/api/tx.js serializes
 *   limit_order_update (op 77) in #4 FC_REFLECT field order
 *   (fee)(seller)(order)(new_price?)(delta?)(new_expiration?)(on_fill?)(ext),
 *   plus the signed-delta writer, the absent-on_fill 0x00 subtlety, loud
 *   guards, and the UI price-scale formula. No socket, no keys.
 * Consumes: vanilla/js/api/tx.js + vanilla/js/api/format.js
 *   (require — offline; the account/asset ids below are public chain data).
 * Side effects: none (prints PASS lines, exit 0 green / 1 red).
 * Created by: op-77 limit_order_update task, deferred-verdicts Q1 build order
 *   (docs/parity/deferred-verdicts.md:16-89, mapping-chain-calls procedure).
 *
 * Chain truth (#4 wins):
 * - op 77 = limit_order_update_operation <- operations.hpp:133 (NOT virtual)
 * - fields (fee)(seller)(order)(new_price)(delta_amount_to_sell)
 *   (new_expiration)(on_fill)(extensions)
 *   <- market.hpp:117-136 struct + FC_REFLECT :299-300
 * - #2 src/bts/serializer/operations.js:1667-1675 (same order) +
 *   ChainTypes.js:141 (id 77)
 * - #3 src/lib/bitshares-api.js:1840-1889 (same order, incl. the :1870-1883
 *   absent-on_fill-must-be-0x00 subtlety — present-but-empty 0x01 0x00
 *   recovers the wrong signer, "Missing Active Authority")
 * - delta_amount_to_sell is share_type (SIGNED int64, asset.hpp) — negative
 *   removes funds; #3's BigInt writer covers it, vanilla's shared
 *   writeInt64LE rejects negatives by design, so the op-77 delta uses the
 *   local two's-complement writer in tx-ops-trade.js
 */
"use strict";
const Tx = require("/workspace/vanilla/js/api/tx.js");
const Format = require("/workspace/vanilla/js/api/format.js");
const S = Tx._ser;

/* Public ids (chain data, not secrets). The 1.7.x order is a well-formed
 * placeholder for offline bytes only — never broadcast. */
const SELLER = "1.2.26833"; /* lite-test-1 (fixture, public id) */
const ORDER = "1.7.12345";
const FEE = { amount: "37500", asset_id: "1.3.0" }; /* 3/8 PRECISION placeholder */
const PRICE = {
  base: { amount: "150000", asset_id: "1.3.0" },
  quote: { amount: "10000", asset_id: "1.3.121" }
};
const DELTA_POS = { amount: "50000", asset_id: "1.3.0" };
const DELTA_NEG = { amount: "-25000", asset_id: "1.3.0" };
const EXPIRY = "2026-06-01T00:00:00";

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}
function hex(u8) { return S.bytesToHex(u8); }
function eq(a, b) { return hex(a) === hex(b); }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

(function main() {
  // 1. OP id + name.
  ok(Tx.OP.limit_order_update === 77, "op id limit_order_update=77");

  // 2. Exact bytes == manual parts in #4 order (all optionals set except
  // on_fill, which stays absent -> 0x00 per the #3 subtlety).
  const op = {
    fee: FEE, seller: SELLER, order: ORDER,
    new_price: PRICE, delta_amount_to_sell: DELTA_POS,
    new_expiration: EXPIRY, on_fill: null, extensions: []
  };
  const got = S.serializeLimitOrderUpdateOp(op);
  const want = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(SELLER),
    S.serializeObjectId(ORDER),
    S.concatBytes([new Uint8Array([1]), S.serializePrice(PRICE)]),
    S.concatBytes([new Uint8Array([1]), S.serializeAsset(DELTA_POS)]),
    S.concatBytes([new Uint8Array([1]), S.serializeTimestamp(EXPIRY)]),
    new Uint8Array([0]),
    S.varintUint32(0)
  ]);
  ok(eq(got, want), "op77 exact bytes in #4 order (price+delta+expiry, on_fill absent)",
    "got " + hex(got) + " want " + hex(want));

  // 3. Positive delta is byte-identical to the shared unsigned asset path
  // (the local signed writer changes nothing for non-negative amounts).
  ok(eq(S.serializeAsset(DELTA_POS),
    S.concatBytes([S.writeInt64LE("50000"), S.serializeObjectId("1.3.0")])),
    "positive delta == shared serializeAsset bytes");

  // 4. Negative delta two's complement: -25000 = 0xFFFFFFFFFFFF9E58 LE.
  const negOp = {
    fee: FEE, seller: SELLER, order: ORDER,
    new_price: null, delta_amount_to_sell: DELTA_NEG,
    new_expiration: null, on_fill: null, extensions: []
  };
  const negBytes = S.serializeLimitOrderUpdateOp(negOp);
  const negWant = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(SELLER),
    S.serializeObjectId(ORDER),
    new Uint8Array([0]),
    S.concatBytes([new Uint8Array([1]),
      S.concatBytes([S.concatBytes([new Uint8Array([0x58, 0x9e, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
        S.serializeObjectId("1.3.0")])])]),
    new Uint8Array([0]),
    new Uint8Array([0]),
    S.varintUint32(0)
  ]);
  ok(eq(negBytes, negWant), "op77 negative delta two's complement (-25000 -> 589effffffffffff)",
    "got " + hex(negBytes) + " want " + hex(negWant));

  // 5. All-null shape (documents the wire form the UI never sends — the
  // spec open point asks whether the node rejects it; the UI requires >=1
  // changed field instead of finding out with real fees).
  const nullOp = {
    fee: FEE, seller: SELLER, order: ORDER,
    new_price: null, delta_amount_to_sell: null,
    new_expiration: null, on_fill: null, extensions: []
  };
  const nullBytes = S.serializeLimitOrderUpdateOp(nullOp);
  const nullWant = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(SELLER),
    S.serializeObjectId(ORDER),
    new Uint8Array([0, 0, 0, 0]),
    S.varintUint32(0)
  ]);
  ok(eq(nullBytes, nullWant), "op77 all-null optionals shape (four 0x00 + ext 0x00)");

  // 6. on_fill present-but-empty [] encodes 0x01 0x00 (explicit opt-in only —
  // absent null above stays 0x00; this is the #3 subtlety pinned both ways).
  const emptyFill = {
    fee: FEE, seller: SELLER, order: ORDER,
    new_price: null, delta_amount_to_sell: null,
    new_expiration: null, on_fill: [], extensions: []
  };
  const emptyBytes = S.serializeLimitOrderUpdateOp(emptyFill);
  const emptyWant = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(SELLER),
    S.serializeObjectId(ORDER),
    new Uint8Array([0, 0, 0]),
    S.concatBytes([new Uint8Array([1]), S.varintUint32(0)]),
    S.varintUint32(0)
  ]);
  ok(eq(emptyBytes, emptyWant), "op77 on_fill [] encodes present-but-empty (0x01 0x00)");

  // 7. on_fill with one type-0 action == manual vector concat.
  const action = {
    type: 0, fee_asset_id: "1.3.0", spread_percent: 100,
    size_percent: 50, expiration_seconds: 3600, repeat: false
  };
  const fillOp = {
    fee: FEE, seller: SELLER, order: ORDER,
    new_price: null, delta_amount_to_sell: null,
    new_expiration: null, on_fill: [action], extensions: []
  };
  const fillBytes = S.serializeLimitOrderUpdateOp(fillOp);
  const fillWant = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(SELLER),
    S.serializeObjectId(ORDER),
    new Uint8Array([0, 0, 0]),
    S.concatBytes([new Uint8Array([1]), S.varintUint32(1),
      S.serializeLimitOrderAutoAction(action)]),
    S.varintUint32(0)
  ]);
  ok(eq(fillBytes, fillWant), "op77 on_fill [action] exact bytes vs manual vector");

  // 8. Loud guards (never silent defaults on money/ids).
  ok(throws(() => S.serializeLimitOrderUpdateOp(null)), "op77 null op throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({ seller: SELLER, order: ORDER })), "op77 missing fee throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({ fee: FEE, order: ORDER })), "op77 missing seller throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({ fee: FEE, seller: SELLER })), "op77 missing order throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({
    fee: FEE, seller: "bad-id", order: ORDER })), "op77 bad seller throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({
    fee: FEE, seller: SELLER, order: "1.7.bad" })), "op77 bad order id throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({
    fee: FEE, seller: SELLER, order: ORDER,
    delta_amount_to_sell: { amount: "12x", asset_id: "1.3.0" } })), "op77 bad delta digits throw");
  ok(throws(() => S.serializeLimitOrderUpdateOp({
    fee: FEE, seller: SELLER, order: ORDER,
    delta_amount_to_sell: { amount: "18446744073709551616", asset_id: "1.3.0" } })), "op77 delta 2^64 overflow throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({
    fee: FEE, seller: SELLER, order: ORDER,
    delta_amount_to_sell: { amount: "-9223372036854775809", asset_id: "1.3.0" } })), "op77 delta below -2^63 throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({
    fee: FEE, seller: SELLER, order: ORDER, on_fill: { type: 0 } })), "op77 non-array on_fill throws");
  ok(throws(() => S.serializeLimitOrderUpdateOp({
    fee: FEE, seller: SELLER, order: ORDER, new_price: { base: FEE } })), "op77 malformed price throws");

  // 9. Dispatch paths: nested-op recursion + top-level framing agree.
  const viaNested = S.serializeOperationData(77, op);
  ok(eq(viaNested, got), "op77 nested recursion == direct");
  const tx = { ref_block_num: 1, ref_block_prefix: 2, expiration: "2026-01-01T00:00:00", operations: [[77, op]], extensions: [] };
  const gotTx = S.serializeTransaction(tx);
  const expSecs = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000) >>> 0;
  const wantTx = S.concatBytes([
    S.writeUint16LE(1), S.writeUint32LE(2), S.writeUint32LE(expSecs),
    S.varintUint32(1), S.varintUint32(77), S.serializeOperationData(77, op),
    S.varintUint32(0)
  ]);
  ok(eq(gotTx, wantTx), "op77 tx framing (varint id + data, ext 0)");

  // 10. Neighbours: 76 still dispatched, 78 (past the last op) rejected.
  ok(throws(() => S.serializeOperationData(78, {})), "op78 still undispatched");
  ok(eq(S.serializeOperationData(76, {
    fee: FEE, account: SELLER, deal_id: "1.22.1", auto_repay: 0, extensions: []
  }), S.serializeCreditDealUpdateOp({
    fee: FEE, account: SELLER, deal_id: "1.22.1", auto_repay: 0, extensions: []
  })), "op76 still dispatched");

  // 11. UI price-scale formula (market-orders.js orderUpdateBox): the new base
  // leg is cur_base * new_ratio / cur_ratio in exact BigInt (orientation and
  // quote leg preserved, floor like quoteToBaseRaw). Equal values spelled
  // differently ("2.50" vs "2.5") scale to the identical leg (no phantom
  // change); a doubled price doubles the leg exactly.
  (function priceScale() {
    function scale(curBase, curP, newP) {
      const c = Format.parsePriceRatio(curP), n = Format.parsePriceRatio(newP);
      return (BigInt(curBase) * n.num * c.den / (n.den * c.num)).toString();
    }
    ok(scale("100000", "2.5", "2.50") === "100000", "price scale equal-value respelling is a no-op");
    ok(scale("100000", "2.5", "5") === "200000", "price scale doubled price doubles base leg");
    ok(scale("150000", "15", "7.5") === "75000", "price scale halved price halves base leg");
    let threw = false;
    try { Format.parsePriceRatio("abc"); } catch (e) { threw = true; }
    ok(threw, "price scale bad input parses loudly (inline error path)");
  })();

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
