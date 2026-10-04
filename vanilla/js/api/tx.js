/* tx.js — Tx registry FACADE (thin) after the responsibility split.
 *
 * What it owns: the op dispatch hubs serializeOperationData (single-op
 * bytes for proposals/envelopes) and serializeTransaction (signed-bytes
 * framing) plus the Tx.OP id map. The ~100 serializer functions moved
 * to tx-primitives.js (shared writers/helpers), tx-ops-trade.js
 * (money-movement ops) and tx-ops-gov.js (identity/governance ops) —
 * this file calls them via Tx._ser.* at call time (same late binding
 * tx-send.js already uses), so load order is the only contract.
 * Consumes: Tx._ser.* (defined by the split modules; browser: classic
 * <script> order in index.html; node: module.require()d below).
 * Side effects: defines Tx.OP + Tx._ser.serializeOperationData +
 * Tx._ser.serializeTransaction on the shared `Tx` global.
 * Created by: building-vanilla-slices skill, slice-04-transfer plan
 * Task 2; split by the slice-18 readability pass. Serializer coverage
 * unchanged: ops 0-3, 6-8, 10-17, 19-24, 25-30, 32-35 (35 chat
 * 9198/9199 only), 37, 43, 45, 47, 48, 49, 50, 52, 54-58, 59-73,
 * 75, 76. Full provenance record: git history of this file.
 */
var Tx = (typeof globalThis !== "undefined" && globalThis.Tx) ? globalThis.Tx : ((typeof Tx !== "undefined") ? Tx : {});
Tx.OP = Tx.OP || {};
Tx._ser = Tx._ser || {};
/* Node suites require() this file directly (tooling/*-test.js) while the
 * browser loads tx-primitives/tx-ops-* via <script> order. Pull the
 * split modules through the module loader WITHOUT naming `require`
 * (checkJs runs browser libs — a bare require() call is TS2591 there;
 * seam-cast keeps the node path working). module.require resolves
 * relative to THIS file, like require(). */
var __txRequire = null;
try {
  if (typeof module !== "undefined" && module && /** @type {any} */ (module).require && /** @type {any} */ (module).require.bind) __txRequire = /** @type {any} */ (module).require.bind(module);
} catch (e) { __txRequire = null; }
if (__txRequire && (typeof globalThis === "undefined" || !globalThis.Tx || !globalThis.Tx._ser || !globalThis.Tx._ser.serializeTransferOp)) {
  __txRequire("./tx-primitives.js");
  __txRequire("./tx-ops-trade.js");
  __txRequire("./tx-ops-gov.js");
  if (typeof globalThis !== "undefined" && globalThis.Tx) Tx = globalThis.Tx;
}
(function () {
  "use strict";

  function serializeOperationData(opType, opData) {
    if (opType === 0) return Tx._ser.serializeTransferOp(opData);
    if (opType === 1) return Tx._ser.serializeLimitOrderCreateOp(opData);
    if (opType === 2) return Tx._ser.serializeLimitOrderCancelOp(opData);
    if (opType === 3) return Tx._ser.serializeCallOrderUpdateOp(opData);
    if (opType === 6) return Tx._ser.serializeAccountUpdateOp(opData);
    if (opType === 7) return Tx._ser.serializeAccountWhitelistOp(opData);
    if (opType === 8) return Tx._ser.serializeAccountUpgradeOp(opData);
    if (opType === 10) return Tx._ser.serializeAssetCreateOp(opData);
    if (opType === 11) return Tx._ser.serializeAssetUpdateOp(opData);
    if (opType === 12) return Tx._ser.serializeAssetUpdateBitassetOp(opData);
    if (opType === 13) return Tx._ser.serializeAssetUpdateFeedProducersOp(opData);
    if (opType === 14) return Tx._ser.serializeAssetIssueOp(opData);
    if (opType === 15) return Tx._ser.serializeAssetReserveOp(opData);
    if (opType === 16) return Tx._ser.serializeAssetFundFeePoolOp(opData);
    if (opType === 17) return Tx._ser.serializeAssetSettleOp(opData);
    if (opType === 19) return Tx._ser.serializeAssetPublishFeedOp(opData);
    if (opType === 20) return Tx._ser.serializeWitnessCreateOp(opData);
    if (opType === 21) return Tx._ser.serializeWitnessUpdateOp(opData);
    if (opType === 22) return Tx._ser.serializeProposalCreateOp(opData);
    if (opType === 23) return Tx._ser.serializeProposalUpdateOp(opData);
    if (opType === 24) return Tx._ser.serializeProposalDeleteOp(opData);
    if (opType === 25) return Tx._ser.serializeWithdrawPermissionCreateOp(opData);
    if (opType === 26) return Tx._ser.serializeWithdrawPermissionUpdateOp(opData);
    if (opType === 27) return Tx._ser.serializeWithdrawPermissionClaimOp(opData);
    if (opType === 28) return Tx._ser.serializeWithdrawPermissionDeleteOp(opData);
    if (opType === 29) return Tx._ser.serializeCommitteeMemberCreateOp(opData);
    if (opType === 30) return Tx._ser.serializeCommitteeMemberUpdateOp(opData);
    if (opType === 32) return Tx._ser.serializeVestingBalanceCreateOp(opData);
    if (opType === 33) return Tx._ser.serializeVestingBalanceWithdrawOp(opData);
    if (opType === 34) return Tx._ser.serializeWorkerCreateOp(opData);
    if (opType === 35) return Tx._ser.serializeCustomTrollboxOp(opData);
    if (opType === 37) return Tx._ser.serializeBalanceClaimOp(opData);
    if (opType === 43) return Tx._ser.serializeAssetClaimFeesOp(opData);
    if (opType === 45) return Tx._ser.serializeBidCollateralOp(opData);
    if (opType === 47) return Tx._ser.serializeAssetClaimPoolOp(opData);
    if (opType === 48) return Tx._ser.serializeAssetUpdateIssuerOp(opData);
    if (opType === 49) return Tx._ser.serializeHtlcCreateOp(opData);
    if (opType === 50) return Tx._ser.serializeHtlcRedeemOp(opData);
    if (opType === 52) return Tx._ser.serializeHtlcExtendOp(opData);
    if (opType === 54) return Tx._ser.serializeCustomAuthorityCreateOp(opData);
    if (opType === 55) return Tx._ser.serializeCustomAuthorityUpdateOp(opData);
    if (opType === 56) return Tx._ser.serializeCustomAuthorityDeleteOp(opData);
    if (opType === 57) return Tx._ser.serializeTicketCreateOp(opData);
    if (opType === 58) return Tx._ser.serializeTicketUpdateOp(opData);
    if (opType === 59) return Tx._ser.serializeLiquidityPoolCreateOp(opData);
    if (opType === 60) return Tx._ser.serializeLiquidityPoolDeleteOp(opData);
    if (opType === 61) return Tx._ser.serializeLiquidityPoolDepositOp(opData);
    if (opType === 62) return Tx._ser.serializeLiquidityPoolWithdrawOp(opData);
    if (opType === 63) return Tx._ser.serializeLiquidityPoolExchangeOp(opData);
    if (opType === 64) return Tx._ser.serializeSametFundCreateOp(opData);
    if (opType === 65) return Tx._ser.serializeSametFundDeleteOp(opData);
    if (opType === 66) return Tx._ser.serializeSametFundUpdateOp(opData);
    if (opType === 67) return Tx._ser.serializeSametFundBorrowOp(opData);
    if (opType === 68) return Tx._ser.serializeSametFundRepayOp(opData);
    if (opType === 69) return Tx._ser.serializeCreditOfferCreateOp(opData);
    if (opType === 70) return Tx._ser.serializeCreditOfferDeleteOp(opData);
    if (opType === 71) return Tx._ser.serializeCreditOfferUpdateOp(opData);
    if (opType === 72) return Tx._ser.serializeCreditOfferAcceptOp(opData);
    if (opType === 73) return Tx._ser.serializeCreditDealRepayOp(opData);
    if (opType === 75) return Tx._ser.serializeLiquidityPoolUpdateOp(opData);
    if (opType === 76) return Tx._ser.serializeCreditDealUpdateOp(opData);
    throw new Error("tx.js supports ops 0-3, 6, 7, 8, 10-17, 19-24, 25-28, 29, 30, 32-35(chat 9198/9199 only), 37, " +
      "43, 45, 47, 48, 49, 50, 52, 54-58, 59-73, 75 and 76, got op " + opType);
  }

  /* Signing serialization: ref_block_num + ref_block_prefix + expiration +
   * op count + (op id varint + op bytes)* + extension count. Signatures are
   * NOT part of the signed bytes. Expiration "YYYY-MM-DDTHH:MM:SS" parses as
   * UTC via the appended Z (matches #3). */

  function serializeTransaction(tx) {
    if (!tx || typeof tx !== "object") throw new Error("tx must be an object");
    var parts = [];
    parts.push(Tx._ser.writeUint16LE(tx.ref_block_num));
    parts.push(Tx._ser.writeUint32LE(tx.ref_block_prefix));
    parts.push(Tx._ser.writeUint32LE(Math.floor(new Date(tx.expiration + "Z").getTime() / 1000)));
    var ops = tx.operations || [];
    parts.push(Tx._ser.varintUint32(ops.length));
    for (var i = 0; i < ops.length; i++) {
      var opType = ops[i][0], opData = ops[i][1];
      parts.push(Tx._ser.varintUint32(opType));
      if (opType === 0) parts.push(Tx._ser.serializeTransferOp(opData));
      else if (opType === 1) parts.push(Tx._ser.serializeLimitOrderCreateOp(opData));
      else if (opType === 2) parts.push(Tx._ser.serializeLimitOrderCancelOp(opData));
      else if (opType === 3) parts.push(Tx._ser.serializeCallOrderUpdateOp(opData));
      else if (opType === 6) parts.push(Tx._ser.serializeAccountUpdateOp(opData));
      else if (opType === 7) parts.push(Tx._ser.serializeAccountWhitelistOp(opData));
      else if (opType === 8) parts.push(Tx._ser.serializeAccountUpgradeOp(opData));
      else if (opType === 10) parts.push(Tx._ser.serializeAssetCreateOp(opData));
      else if (opType === 11) parts.push(Tx._ser.serializeAssetUpdateOp(opData));
      else if (opType === 12) parts.push(Tx._ser.serializeAssetUpdateBitassetOp(opData));
      else if (opType === 13) parts.push(Tx._ser.serializeAssetUpdateFeedProducersOp(opData));
      else if (opType === 14) parts.push(Tx._ser.serializeAssetIssueOp(opData));
      else if (opType === 15) parts.push(Tx._ser.serializeAssetReserveOp(opData));
      else if (opType === 16) parts.push(Tx._ser.serializeAssetFundFeePoolOp(opData));
      else if (opType === 17) parts.push(Tx._ser.serializeAssetSettleOp(opData));
      else if (opType === 19) parts.push(Tx._ser.serializeAssetPublishFeedOp(opData));
      else if (opType === 20) parts.push(Tx._ser.serializeWitnessCreateOp(opData));
      else if (opType === 21) parts.push(Tx._ser.serializeWitnessUpdateOp(opData));
      else if (opType === 22) parts.push(Tx._ser.serializeProposalCreateOp(opData));
      else if (opType === 23) parts.push(Tx._ser.serializeProposalUpdateOp(opData));
      else if (opType === 24) parts.push(Tx._ser.serializeProposalDeleteOp(opData));
      else if (opType === 25) parts.push(Tx._ser.serializeWithdrawPermissionCreateOp(opData));
      else if (opType === 26) parts.push(Tx._ser.serializeWithdrawPermissionUpdateOp(opData));
      else if (opType === 27) parts.push(Tx._ser.serializeWithdrawPermissionClaimOp(opData));
      else if (opType === 28) parts.push(Tx._ser.serializeWithdrawPermissionDeleteOp(opData));
      else if (opType === 29) parts.push(Tx._ser.serializeCommitteeMemberCreateOp(opData));
      else if (opType === 30) parts.push(Tx._ser.serializeCommitteeMemberUpdateOp(opData));
      else if (opType === 32) parts.push(Tx._ser.serializeVestingBalanceCreateOp(opData));
      else if (opType === 33) parts.push(Tx._ser.serializeVestingBalanceWithdrawOp(opData));
      else if (opType === 34) parts.push(Tx._ser.serializeWorkerCreateOp(opData));
      /* Op-35 SINGLE EXCEPTION (R1c trollbox): chat sub-ids 9198/9199 only —
       * the serializer itself rejects any other sub-id. Generic custom ops
       * stay deferred (see the ASSESSED note below). */
      else if (opType === 35) parts.push(Tx._ser.serializeCustomTrollboxOp(opData));
      else if (opType === 37) parts.push(Tx._ser.serializeBalanceClaimOp(opData));
      else if (opType === 43) parts.push(Tx._ser.serializeAssetClaimFeesOp(opData));
      else if (opType === 45) parts.push(Tx._ser.serializeBidCollateralOp(opData));
      else if (opType === 47) parts.push(Tx._ser.serializeAssetClaimPoolOp(opData));
      else if (opType === 48) parts.push(Tx._ser.serializeAssetUpdateIssuerOp(opData));
      // Op 38 (override_transfer) is ISSUER-ONLY (#4 balance/asset issuer
      // path; no vanilla wallet UI signs it) — deliberately NOT serialized.
      // Do not "complete" this list with it.
      // Ops 39/40/41 (transfer_to_blind / blind_transfer /
      // transfer_from_blind) are DOWNSCOPED by the slice-14 blind-transfer
      // scoping decision: blind outputs need Pedersen commitments (33B) +
      // bulletproof range_proofs + blinding-factor ECDH mint that no static
      // page can create (#3 serializes but never mints; #2 mints only behind
      // Electron-host IPC). No serializer lands until that crypto ships as
      // its own audited slice. Do not "complete" this list with them.
      // Op 46 (execute_bid) is VIRTUAL (#4 operations.hpp:102, same rule as
      // ops 51/53/74) — never signed, never dispatched.
      // ASSESSED, NOT dispatched (verdicts this task — see the header block):
      // 5 account_create (faucet covers registration; local signing needs an
      // LTM registrar + tiers no UI path needs), 9 account_transfer (rare /
      // dangerous ownership move, no UI path builds it), 18
      // asset_global_settle (issuer-only — committee multisig/proposal for
      // committee bitassets; no vanilla form, proposal-nesting is the future
      // path), 31 committee_member_update_global_parameters (chain_parameters
      // needs its own audited slice; #3's JSON blob is not the wire bytes),
      // 35 custom_operation GENERIC (any sub-id except the 9198/9199 chat
      // exception above — stays deferred; the dispatch line rejects others),
      // 36 assert_operation (predicates are not approvals — multisig approve
      // flows sign op 23 via Proposal.buildApprove; no UI builds predicates).
      // Do not "complete" this list with them.
      else if (opType === 49) parts.push(Tx._ser.serializeHtlcCreateOp(opData));
      else if (opType === 50) parts.push(Tx._ser.serializeHtlcRedeemOp(opData));
      else if (opType === 52) parts.push(Tx._ser.serializeHtlcExtendOp(opData));
      else if (opType === 54) parts.push(Tx._ser.serializeCustomAuthorityCreateOp(opData));
      else if (opType === 55) parts.push(Tx._ser.serializeCustomAuthorityUpdateOp(opData));
      else if (opType === 56) parts.push(Tx._ser.serializeCustomAuthorityDeleteOp(opData));
      else if (opType === 57) parts.push(Tx._ser.serializeTicketCreateOp(opData));
      else if (opType === 58) parts.push(Tx._ser.serializeTicketUpdateOp(opData));
      else if (opType === 59) parts.push(Tx._ser.serializeLiquidityPoolCreateOp(opData));
      else if (opType === 60) parts.push(Tx._ser.serializeLiquidityPoolDeleteOp(opData));
      else if (opType === 61) parts.push(Tx._ser.serializeLiquidityPoolDepositOp(opData));
      else if (opType === 62) parts.push(Tx._ser.serializeLiquidityPoolWithdrawOp(opData));
      else if (opType === 63) parts.push(Tx._ser.serializeLiquidityPoolExchangeOp(opData));
      else if (opType === 64) parts.push(Tx._ser.serializeSametFundCreateOp(opData));
      else if (opType === 65) parts.push(Tx._ser.serializeSametFundDeleteOp(opData));
      else if (opType === 66) parts.push(Tx._ser.serializeSametFundUpdateOp(opData));
      else if (opType === 67) parts.push(Tx._ser.serializeSametFundBorrowOp(opData));
      else if (opType === 68) parts.push(Tx._ser.serializeSametFundRepayOp(opData));
      else if (opType === 69) parts.push(Tx._ser.serializeCreditOfferCreateOp(opData));
      else if (opType === 70) parts.push(Tx._ser.serializeCreditOfferDeleteOp(opData));
      else if (opType === 71) parts.push(Tx._ser.serializeCreditOfferUpdateOp(opData));
      else if (opType === 72) parts.push(Tx._ser.serializeCreditOfferAcceptOp(opData));
      else if (opType === 73) parts.push(Tx._ser.serializeCreditDealRepayOp(opData));
      // Op 74 (credit_deal_expired) is VIRTUAL — never dispatched (see the
      // no-serializer note above). Do not "complete" this list.
      else if (opType === 75) parts.push(Tx._ser.serializeLiquidityPoolUpdateOp(opData));
      else if (opType === 76) parts.push(Tx._ser.serializeCreditDealUpdateOp(opData));
      // Ops 51 (htlc_redeemed) and 53 (htlc_refund) are VIRTUAL (#4
      // operations.hpp:107,109; validate() asserts !"virtual operation" in
      // htlc.hpp:139,199-202) — they can never appear in a signed tx, so
      // they are NEVER dispatched here. Do not "complete" this list.
      else throw new Error("tx.js supports ops 0-3, 6, 7, 8, 10-17, 19-24, 25-28, 29, 30, 32-35(chat 9198/9199 only), 37, 43, 45, 47, 48, 49, 50, 52, 54-58, 59-73, 75 and 76 (5 faucet-covered; 9 no UI path; 18 issuer-only; 31 chain-parameters; 35 generic except chat; 36 predicates-not-approvals; 38 issuer-only; 39/40/41 blind-downscoped; 77 adjust-via-cancel+recreate; 4/42/44/46/51/53/74 virtual), got op " + opType);
    }
    parts.push(Tx._ser.varintUint32((tx.extensions || []).length));
    return Tx._ser.concatBytes(parts);
  }

  Tx.OP = {
      transfer: 0, limit_order_create: 1, limit_order_cancel: 2,
      call_order_update: 3, account_update: 6, account_whitelist: 7,
      account_upgrade: 8,
      asset_create: 10, asset_update: 11, asset_update_bitasset: 12,
      asset_update_feed_producers: 13, asset_issue: 14, asset_reserve: 15,
      asset_fund_fee_pool: 16, asset_settle: 17,
      asset_publish_feed: 19,
      witness_create: 20, witness_update: 21,
      proposal_create: 22, proposal_update: 23, proposal_delete: 24,
      withdraw_permission_create: 25, withdraw_permission_update: 26,
      withdraw_permission_claim: 27, withdraw_permission_delete: 28,
      committee_member_create: 29, committee_member_update: 30,
      vesting_balance_create: 32, vesting_balance_withdraw: 33,
      worker_create: 34,
      custom_operation: 35,
      balance_claim: 37,
      asset_claim_fees: 43,
      bid_collateral: 45,
      asset_claim_pool: 47, asset_update_issuer: 48,
      htlc_create: 49, htlc_redeem: 50, htlc_extend: 52,
      custom_authority_create: 54, custom_authority_update: 55,
      custom_authority_delete: 56, ticket_create: 57, ticket_update: 58,
      liquidity_pool_create: 59, liquidity_pool_delete: 60,
      liquidity_pool_deposit: 61, liquidity_pool_withdraw: 62,
      liquidity_pool_exchange: 63, liquidity_pool_update: 75,
      samet_fund_create: 64, samet_fund_delete: 65, samet_fund_update: 66,
      samet_fund_borrow: 67, samet_fund_repay: 68,
      credit_offer_create: 69, credit_offer_delete: 70,
      credit_offer_update: 71, credit_offer_accept: 72,
      credit_deal_repay: 73, credit_deal_update: 76
  };
  Tx._ser.serializeOperationData = serializeOperationData;
  Tx._ser.serializeTransaction = serializeTransaction;
  if (typeof globalThis !== "undefined") { globalThis.Tx = Tx; }
})();

if (typeof module !== "undefined") { module.exports = Tx; }
