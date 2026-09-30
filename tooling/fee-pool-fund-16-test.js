#!/usr/bin/env node
/* fee-pool-fund-16-test.js — offline byte proofs for op-16 asset_fund_fee_pool.
 *
 * What it owns: byte-exact checks that vanilla/js/tx.js serializes
 *   asset_fund_fee_pool (op 16) in #4 FC_REFLECT field order
 *   (fee)(from_account)(asset_id)(amount:int64 core)(extensions), plus the
 *   AssetOps.buildFundFeePool builder (human CORE amount -> raw) and loud
 *   guards. No socket, no keys.
 * Consumes: vanilla/js/tx.js + vanilla/js/asset-ops.js + vanilla/js/format.js
 *   (require — offline; the account/asset ids below are public chain data).
 * Side effects: none (prints PASS lines, exit 0 green / 1 red).
 * Created by: op-16 fee-pool funding task, mapping-chain-calls procedure
 *   (core ground truth, BJS + #3 on-demand fetch).
 *
 * Chain truth (#4 wins):
 * - op 16 = asset_fund_fee_pool_operation <- operations.hpp:72
 * - fields (fee)(from_account)(asset_id)(amount)(extensions)
 *   <- asset_ops.hpp:322-334 + FC :728; amount is share_type (core units)
 * - BJS asset_fund_fee_pool = {fee:asset, from_account:account,
 *   asset_id:asset, amount:int64, extensions} (order match, fetched 2026-09-30)
 * - #3 serializeAssetFundFeePoolOp :2566-2576 (same order; vanilla drops the
 *   `|| 0` fallback — missing amount throws loudly)
 */
"use strict";
const Tx = require("/workspace/vanilla/js/tx.js");
const Format = require("/workspace/vanilla/js/format.js");
const AssetOps = require("/workspace/vanilla/js/asset-ops.js");
const S = Tx._ser;

/* Public testnet ids (chain data, not secrets). */
const FROM = "1.2.26833"; /* lite-test-1 */
const ASSET = "1.3.1849"; /* AFKTEST10 (fixture-issued UIA, p4) */
const FEE = { amount: "100000", asset_id: "1.3.0" }; /* 1.00000 TEST placeholder */
const AMOUNT_RAW = "10000"; /* 0.10000 TEST at core p5 (dust) */

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
  ok(Tx.OP.asset_fund_fee_pool === 16, "op id asset_fund_fee_pool=16");

  // 2. Exact bytes == manual parts in #4 order.
  const op = { fee: FEE, from_account: FROM, asset_id: ASSET, amount: AMOUNT_RAW, extensions: [] };
  const got = S.serializeAssetFundFeePoolOp(op);
  const want = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(FROM),
    S.serializeObjectId(ASSET),
    S.writeInt64LE(AMOUNT_RAW),
    S.varintUint32(0)
  ]);
  ok(eq(got, want), "op16 exact bytes in (fee)(from)(asset)(amount)(ext) order",
    "got " + hex(got) + " want " + hex(want));

  // 3. Amount is a BARE int64, not an asset pair (op-15 trap): the tail after
  // the two object ids must be 8 LE bytes + 1 ext byte, with no asset_id varint.
  const tail = got.slice(got.length - 9);
  const wantTail = S.concatBytes([S.writeInt64LE(AMOUNT_RAW), S.varintUint32(0)]);
  ok(eq(tail, wantTail), "op16 amount tail is bare int64 + ext 0 (no asset pair)");

  // 4. Human vector: 0.1 TEST at core p5 -> "10000" (Format, never float).
  ok(Format.parseAmount("0.1", 5) === "10000", "format vector 0.1@5 -> 10000");
  ok(Format.formatAmount("10000", 5) === "0.10000", "format vector 10000@5 -> 0.10000");

  // 5. Builder: human CORE amount -> [16, opData] with zero-placeholder fee.
  const pair = AssetOps.buildFundFeePool({
    fromAccountId: FROM, assetId: ASSET, amountHuman: "0.1", corePrecision: 5
  });
  ok(pair[0] === 16, "builder op id 16");
  ok(pair[1].from_account === FROM && pair[1].asset_id === ASSET, "builder ids pass through");
  ok(pair[1].amount === "10000", "builder amount 0.1@5 -> 10000, got " + pair[1].amount);
  ok(pair[1].fee && pair[1].fee.amount === "0", "builder zero-placeholder fee");
  ok(Array.isArray(pair[1].extensions) && pair[1].extensions.length === 0, "builder empty extensions");
  // Builder bytes == direct serializer bytes once fee-filled.
  const filled = { fee: FEE, from_account: pair[1].from_account, asset_id: pair[1].asset_id, amount: pair[1].amount, extensions: [] };
  ok(eq(S.serializeAssetFundFeePoolOp(filled), S.serializeOperationData(16, filled)), "builder-filled bytes via nested dispatch");

  // 6. Loud guards (never silent defaults like #3's `|| 0`).
  ok(throws(() => S.serializeAssetFundFeePoolOp({ fee: FEE, from_account: FROM, asset_id: ASSET })), "op16 missing amount throws");
  ok(throws(() => S.serializeAssetFundFeePoolOp({ fee: FEE, from_account: "bad-id", asset_id: ASSET, amount: AMOUNT_RAW })), "op16 bad from_account throws");
  ok(throws(() => S.serializeAssetFundFeePoolOp({ fee: FEE, from_account: FROM, asset_id: "bad", amount: AMOUNT_RAW })), "op16 bad asset_id throws");
  ok(throws(() => AssetOps.buildFundFeePool({ fromAccountId: FROM, assetId: ASSET, amountHuman: "0", corePrecision: 5 })), "builder zero amount throws");
  ok(throws(() => AssetOps.buildFundFeePool({ fromAccountId: FROM, assetId: ASSET, amountHuman: "0.000001", corePrecision: 5 })), "builder excess decimals throws");

  // 7. Dispatch paths: nested-op recursion + top-level framing agree.
  const viaNested = S.serializeOperationData(16, op);
  ok(eq(viaNested, got), "op16 nested recursion == direct");
  const tx = { ref_block_num: 1, ref_block_prefix: 2, expiration: "2026-01-01T00:00:00", operations: [[16, op]], extensions: [] };
  const gotTx = S.serializeTransaction(tx);
  const expSecs = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000) >>> 0;
  const wantTx = S.concatBytes([
    S.writeUint16LE(1), S.writeUint32LE(2), S.writeUint32LE(expSecs),
    S.varintUint32(1), S.varintUint32(16), S.serializeOperationData(16, op),
    S.varintUint32(0)
  ]);
  ok(eq(gotTx, wantTx), "op16 tx framing (varint id + data, ext 0)");

  // 8. Neighbour ids: 17 now dispatched (settle serializer task); 18 still
  // undispatched (global-settle stays deferred — issuer-only, no form).
  ok(eq(S.serializeOperationData(17, { fee: FEE, account: FROM,
    amount: { amount: "1", asset_id: ASSET }, extensions: [] }),
    S.serializeAssetSettleOp({ fee: FEE, account: FROM,
      amount: { amount: "1", asset_id: ASSET }, extensions: [] })), "op17 now dispatched");
  ok(throws(() => S.serializeOperationData(18, {})), "op18 still undispatched");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
