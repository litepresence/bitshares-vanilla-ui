#!/usr/bin/env node
/* asset-settle-claims-174748-test.js — offline byte proofs for ops 17/43/47/48.
 *
 * What it owns: byte-exact checks that vanilla/js/api/tx.js serializes
 *   asset_settle (op 17) in #4 FC_REFLECT field order
 *   (fee)(account)(amount:asset)(extensions),
 *   asset_claim_fees (op 43) in (fee)(issuer)(amount_to_claim:asset)
 *   (extensions=extension<additional_options{claim_from_asset_id}>),
 *   asset_claim_pool (op 47) in (fee)(issuer)(asset_id)
 *   (amount_to_claim:core asset)(extensions), and
 *   asset_update_issuer (op 48) in (fee)(issuer)(asset_to_update)
 *   (new_issuer)(extensions), plus the AssetOps builders (human amounts ->
 *   raw, loud guards) and the assessed-but-deferred verdicts (ops
 *   5/9/18/31/35/36 stay undispatched). No socket, no keys.
 * Consumes: vanilla/js/api/tx.js + vanilla/js/builders/asset-ops.js + vanilla/js/api/format.js
 *   (require — offline; the account/asset ids below are public chain data).
 * Side effects: none (prints PASS lines, exit 0 green / 1 red).
 * Created by: ops 17/43/47/48 serializer task, mapping-chain-calls procedure
 *   (core ground truth, BJS + #3 on-demand fetch).
 *
 * Chain truth (#4 wins):
 * - op ids <- operations.hpp:73 (17), :99 (43), :103 (47), :104 (48)
 * - op 17 fields (fee)(account)(amount)(extensions)
 *   <- asset_ops.hpp:267-288 + FC :719; amount is an ASSET pair (unlike
 *   op-16's bare int64)
 * - op 43 fields (fee)(issuer)(amount_to_claim)(extensions)
 *   <- asset_ops.hpp:529-553 + FC :619; extensions is
 *   extension<additional_options_type> (:621) with one optional
 *   claim_from_asset_id (index 0): empty -> count 0, set -> count 1 +
 *   index 0 + asset id (ext.hpp count+index+value rule)
 * - op 47 fields (fee)(issuer)(asset_id)(amount_to_claim)(extensions)
 *   <- asset_ops.hpp:601-615 + FC :623; amount_to_claim is CORE-denominated
 * - op 48 fields (fee)(issuer)(asset_to_update)(new_issuer)(extensions)
 *   <- asset_ops.hpp:565-586 + FC :700-706; OWNER authority required
 *   (:580-584 — signing-time rule, no serializer branch)
 * - BJS operations.js asset_settle / asset_claim_fees / asset_claim_pool /
 *   asset_update_issuer (order match, fetched 2026-09-30)
 * - #3 serializeAssetSettleOp :2583-2590, serializeAssetClaimFeesOp
 *   :3005-3023, serializeAssetClaimPoolOp :3066-3075,
 *   serializeAssetUpdateIssuerOp :3080-3089 (same orders; vanilla drops the
 *   `|| 0` / `|| ''` fallbacks — missing fields throw loudly)
 * - Assessed, NOT serialized: 5 (faucet covers registration), 9 (no UI
 *   path), 18 (issuer-only, no form), 31 (chain_parameters needs its own
 *   slice), 35 (generic, no UI path), 36 (predicates are not approvals —
 *   multisig approve signs op 23)
 */
"use strict";
const Tx = require("/workspace/vanilla/js/api/tx.js");
const Format = require("/workspace/vanilla/js/api/format.js");
const AssetOps = require("/workspace/vanilla/js/builders/asset-ops.js");
const S = Tx._ser;

/* Public testnet ids (chain data, not secrets). */
const FROM = "1.2.26833"; /* lite-test-1 (fixture; issuer of AFKTEST10/M11) */
const UIA = "1.3.1849"; /* AFKTEST10 (fixture-issued UIA, p4) */
const MPA = "1.3.1850"; /* AFKTESTM11 (fixture-issued MPA, p4) */
const CORE = "1.3.0"; /* TEST (core, p5) */
const FEE = { amount: "100000", asset_id: "1.3.0" }; /* 1.00000 TEST placeholder */

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}
function hex(u8) { return S.bytesToHex(u8); }
function eq(a, b) { return hex(a) === hex(b); }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

(function main() {
  // 1. OP ids + names.
  ok(Tx.OP.asset_settle === 17, "op id asset_settle=17");
  ok(Tx.OP.asset_claim_fees === 43, "op id asset_claim_fees=43");
  ok(Tx.OP.asset_claim_pool === 47, "op id asset_claim_pool=47");
  ok(Tx.OP.asset_update_issuer === 48, "op id asset_update_issuer=48");

  // 2. Op-17 exact bytes == manual parts in #4 order.
  const s17 = { fee: FEE, account: FROM, amount: { amount: "25", asset_id: MPA }, extensions: [] };
  const got17 = S.serializeAssetSettleOp(s17);
  const want17 = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(FROM),
    S.serializeAsset({ amount: "25", asset_id: MPA }),
    S.varintUint32(0)
  ]);
  ok(eq(got17, want17), "op17 exact bytes in (fee)(account)(amount)(ext) order",
    "got " + hex(got17) + " want " + hex(want17));

  // 3. Op-17 amount is an ASSET pair (op-16 trap inverted): the tail after
  // the account id must be int64 + asset varint + ext byte (1850 encodes as
  // 2 varint bytes, so the tail is 8+2+1 = 11 bytes).
  const tail17 = got17.slice(got17.length - 11);
  const wantTail17 = S.concatBytes([
    S.writeInt64LE("25"), S.serializeObjectId(MPA), S.varintUint32(0)
  ]);
  ok(eq(tail17, wantTail17), "op17 amount tail is int64 + asset id + ext 0 (asset pair)");

  // 4. Op-43 empty-ext exact bytes.
  const c43 = { fee: FEE, issuer: FROM, amount_to_claim: { amount: "7", asset_id: UIA }, extensions: [] };
  const got43 = S.serializeAssetClaimFeesOp(c43);
  const want43 = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(FROM),
    S.serializeAsset({ amount: "7", asset_id: UIA }),
    S.varintUint32(0)
  ]);
  ok(eq(got43, want43), "op43 empty-ext bytes in (fee)(issuer)(amount)(ext 0) order",
    "got " + hex(got43) + " want " + hex(want43));
  // Null/undefined/missing extensions agree with [] (builders emit []).
  ok(eq(S.serializeAssetClaimFeesOp({ fee: FEE, issuer: FROM,
    amount_to_claim: { amount: "7", asset_id: UIA } }), want43), "op43 missing extensions == []");
  ok(eq(S.serializeAssetClaimFeesOp({ fee: FEE, issuer: FROM,
    amount_to_claim: { amount: "7", asset_id: UIA }, extensions: null }), want43), "op43 null extensions == []");
  ok(eq(S.serializeAssetClaimFeesOp({ fee: FEE, issuer: FROM,
    amount_to_claim: { amount: "7", asset_id: UIA }, extensions: {} }), want43), "op43 {} extensions == []");

  // 5. Op-43 set-ext: object, [0, id] pair, and [{claim_from...}] agree;
  // bytes are count 1 + index 0 + asset id (ext.hpp rule, #4 :621).
  const setManual = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(FROM),
    S.serializeAsset({ amount: "7", asset_id: MPA }),
    S.varintUint32(1), S.varintUint32(0), S.serializeObjectId(CORE)
  ]);
  const base43 = { fee: FEE, issuer: FROM, amount_to_claim: { amount: "7", asset_id: MPA } };
  ok(eq(S.serializeAssetClaimFeesOp(Object.assign({ extensions: { claim_from_asset_id: CORE } }, base43)),
    setManual), "op43 {claim_from_asset_id} set bytes");
  ok(eq(S.serializeAssetClaimFeesOp(Object.assign({ extensions: [0, CORE] }, base43)),
    setManual), "op43 [0, id] pair agrees with object form");
  ok(eq(S.serializeAssetClaimFeesOp(Object.assign({ extensions: [{ claim_from_asset_id: CORE }] }, base43)),
    setManual), "op43 [{claim_from...}] agrees with object form");

  // 6. Op-47 exact bytes == manual parts in #4 order (claim is CORE).
  const c47 = { fee: FEE, issuer: FROM, asset_id: UIA,
    amount_to_claim: { amount: "1", asset_id: CORE }, extensions: [] };
  const got47 = S.serializeAssetClaimPoolOp(c47);
  const want47 = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(FROM),
    S.serializeObjectId(UIA),
    S.serializeAsset({ amount: "1", asset_id: CORE }),
    S.varintUint32(0)
  ]);
  ok(eq(got47, want47), "op47 exact bytes in (fee)(issuer)(asset)(claim-core)(ext) order",
    "got " + hex(got47) + " want " + hex(want47));

  // 7. Op-48 exact bytes == manual parts in #4 order.
  const c48 = { fee: FEE, issuer: FROM, asset_to_update: UIA, new_issuer: "1.2.0", extensions: [] };
  const got48 = S.serializeAssetUpdateIssuerOp(c48);
  const want48 = S.concatBytes([
    S.serializeAsset(FEE),
    S.serializeObjectId(FROM),
    S.serializeObjectId(UIA),
    S.serializeObjectId("1.2.0"),
    S.varintUint32(0)
  ]);
  ok(eq(got48, want48), "op48 exact bytes in (fee)(issuer)(asset)(new_issuer)(ext) order",
    "got " + hex(got48) + " want " + hex(want48));

  // 8. Human vectors (Format, never float): p4 UIA + p5 core.
  ok(Format.parseAmount("0.0025", 4) === "25", "format vector 0.0025@4 -> 25");
  ok(Format.formatAmount("25", 4) === "0.0025", "format vector 25@4 -> 0.0025");
  ok(Format.parseAmount("0.00001", 5) === "1", "format vector 0.00001@5 -> 1");
  ok(Format.formatAmount("1", 5) === "0.00001", "format vector 1@5 -> 0.00001");

  // 9. Builders: ids pass through, raws parsed, zero-placeholder fees.
  const p17 = AssetOps.buildSettle({ accountId: FROM, assetId: MPA, amountHuman: "0.0025", precision: 4 });
  ok(p17[0] === 17, "builder op id 17");
  ok(p17[1].account === FROM && p17[1].amount.asset_id === MPA, "builder 17 ids pass through");
  ok(p17[1].amount.amount === "25", "builder 17 amount 0.0025@4 -> 25, got " + p17[1].amount.amount);
  ok(p17[1].fee && p17[1].fee.amount === "0", "builder 17 zero-placeholder fee");
  const p43 = AssetOps.buildClaimFees({ issuerId: FROM, assetId: UIA, amountHuman: "0.0007", precision: 4 });
  ok(p43[0] === 43, "builder op id 43");
  ok(p43[1].amount_to_claim.amount === "7", "builder 43 amount 0.0007@4 -> 7, got " + p43[1].amount_to_claim.amount);
  ok(Array.isArray(p43[1].extensions) && p43[1].extensions.length === 0, "builder 43 empty extensions []");
  const p43s = AssetOps.buildClaimFees({ issuerId: FROM, assetId: MPA,
    amountHuman: "0.0007", precision: 4, claimFromAssetIdOrNull: CORE });
  ok(p43s[1].extensions && p43s[1].extensions.claim_from_asset_id === CORE, "builder 43 set ext object");
  ok(eq(S.serializeAssetClaimFeesOp(Object.assign({}, p43s[1], { fee: FEE })), setManual),
    "builder 43 set-ext bytes match manual set bytes");
  const p47 = AssetOps.buildClaimPool({ issuerId: FROM, assetId: UIA, amountHuman: "0.00001", corePrecision: 5 });
  ok(p47[0] === 47, "builder op id 47");
  ok(p47[1].asset_id === UIA && p47[1].amount_to_claim.asset_id === CORE, "builder 47 pool asset + core claim");
  ok(p47[1].amount_to_claim.amount === "1", "builder 47 amount 0.00001@5 -> 1, got " + p47[1].amount_to_claim.amount);
  const p48 = AssetOps.buildUpdateIssuer({ issuerId: FROM, assetId: UIA, newIssuerId: FROM });
  ok(p48[0] === 48, "builder op id 48");
  ok(p48[1].issuer === FROM && p48[1].asset_to_update === UIA && p48[1].new_issuer === FROM,
    "builder 48 ids pass through (self-update shape)");
  ok(p48[1].fee && p48[1].fee.amount === "0", "builder 48 zero-placeholder fee");

  // 10. Builder-filled bytes == direct serializer bytes once fee-filled.
  const f17 = { fee: FEE, account: p17[1].account, amount: p17[1].amount, extensions: [] };
  ok(eq(S.serializeAssetSettleOp(f17), S.serializeOperationData(17, f17)), "builder-filled 17 via nested dispatch");
  const f47 = { fee: FEE, issuer: p47[1].issuer, asset_id: p47[1].asset_id,
    amount_to_claim: p47[1].amount_to_claim, extensions: [] };
  ok(eq(S.serializeAssetClaimPoolOp(f47), S.serializeOperationData(47, f47)), "builder-filled 47 via nested dispatch");
  const f48 = { fee: FEE, issuer: p48[1].issuer, asset_to_update: p48[1].asset_to_update,
    new_issuer: p48[1].new_issuer, extensions: [] };
  ok(eq(S.serializeAssetUpdateIssuerOp(f48), S.serializeOperationData(48, f48)), "builder-filled 48 via nested dispatch");

  // 11. Loud guards (never silent defaults like #3's `|| 0` / `|| ''`).
  ok(throws(() => S.serializeAssetSettleOp({ fee: FEE, account: FROM })), "op17 missing amount throws");
  ok(throws(() => S.serializeAssetSettleOp({ fee: FEE, account: "bad-id",
    amount: { amount: "25", asset_id: MPA } })), "op17 bad account throws");
  ok(throws(() => S.serializeAssetClaimFeesOp({ fee: FEE, issuer: FROM,
    amount_to_claim: { amount: "7", asset_id: UIA }, extensions: { claim_from_asset_id: "bad" } })),
    "op43 bad claim_from_asset_id throws");
  ok(throws(() => S.serializeAssetClaimFeesOp({ fee: FEE, issuer: FROM,
    amount_to_claim: { amount: "7", asset_id: UIA }, extensions: [1, 2] })), "op43 junk extensions throws");
  ok(throws(() => S.serializeAssetClaimPoolOp({ fee: FEE, issuer: FROM, asset_id: UIA })),
    "op47 missing amount_to_claim throws");
  ok(throws(() => S.serializeAssetUpdateIssuerOp({ fee: FEE, issuer: FROM, asset_to_update: UIA })),
    "op48 missing new_issuer throws");
  ok(throws(() => AssetOps.buildSettle({ accountId: FROM, assetId: MPA, amountHuman: "0", precision: 4 })),
    "builder 17 zero amount throws");
  ok(throws(() => AssetOps.buildClaimFees({ issuerId: FROM, assetId: UIA, amountHuman: "0.00001", precision: 4,
    claimFromAssetIdOrNull: UIA })), "builder 43 same-asset claim_from throws");
  ok(throws(() => AssetOps.buildClaimPool({ issuerId: FROM, assetId: UIA, amountHuman: "0", corePrecision: 5 })),
    "builder 47 zero amount throws");
  ok(throws(() => AssetOps.buildUpdateIssuer({ issuerId: FROM, assetId: UIA, newIssuerId: "bad" })),
    "builder 48 bad new_issuer throws");

  // 12. Dispatch paths: nested-op recursion + top-level framing agree.
  for (const [id, op] of [[17, s17], [43, c43], [47, c47], [48, c48]]) {
    const direct = S.serializeOperationData(id, op);
    const tx = { ref_block_num: 1, ref_block_prefix: 2, expiration: "2026-01-01T00:00:00",
      operations: [[id, op]], extensions: [] };
    const gotTx = S.serializeTransaction(tx);
    const expSecs = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000) >>> 0;
    const wantTx = S.concatBytes([
      S.writeUint16LE(1), S.writeUint32LE(2), S.writeUint32LE(expSecs),
      S.varintUint32(1), S.varintUint32(id), direct,
      S.varintUint32(0)
    ]);
    ok(eq(gotTx, wantTx), "op" + id + " tx framing (varint id + data, ext 0)");
  }

  // 13. Assessed-but-deferred stay undispatched; 18 stays deferred.
  for (const id of [5, 9, 18, 31, 35, 36]) {
    ok(throws(() => S.serializeOperationData(id, {})), "op" + id + " still undispatched (assessed, deferred)");
  }

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
