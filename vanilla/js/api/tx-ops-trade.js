/* tx-ops-trade.js — money-movement op serializers for the Tx registry.
 *
 * What it owns: transfer (op 0), limit orders (ops 1/2 + on-fill helper),
 * call_order_update (op 3), ALL asset ops (10-17, 19, 43, 47, 48),
 * HTLC (49/50/52), withdraw-permission (25-28), liquidity pools
 * (59-63, 75), samet_fund (64-68), credit offers/deals (69-73, 76)
 * and bid_collateral (op 45).
 * Consumes: Tx._ser primitives from tx-primitives.js (late-bound at call
 * time — never owned here).
 * Side effects: attaches its functions to the shared `Tx._ser` object;
 * sets globalThis.Tx. Load order in index.html: after tx-primitives.js,
 * before tx.js. Created by: tx.js responsibility split (slice-18
 * readability pass) — code moved byte-verbatim out of tx.js except
 * primitive calls now spell Tx._ser.* (same functions, same bytes).
 * Provenance: HAND-PORTED from wallet-extension/src/lib/bitshares-api.js
 * (#3), cross-checked against bitshares-core (#4) — full per-function
 * credits lived in the tx.js header at split time (see git history).
 */
var Tx = (typeof globalThis !== "undefined" && globalThis.Tx) ? globalThis.Tx : ((typeof Tx !== "undefined") ? Tx : {});
Tx.OP = Tx.OP || {};
Tx._ser = Tx._ser || {};
(function () {
  "use strict";

  /* Transfer op data in #4 order: fee, from, to, amount, memo?, extensions. */
  function serializeTransferOp(op) {
    if (!op || typeof op !== "object") throw new Error("transfer op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.from),
      Tx._ser.serializeObjectId(op.to),
      Tx._ser.serializeAsset(op.amount),
      Tx._ser.serializeOptional(op.memo === undefined ? null : op.memo, Tx._ser.serializeMemo),
      Tx._ser.varintUint32(0)
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
    var parts = [Tx._ser.varintUint32(typeIdx)];
    if (typeIdx === 0) {
      parts.push(Tx._ser.serializeObjectId(d.fee_asset_id || "1.3.0"));
      parts.push(Tx._ser.writeUint16LE(d.spread_percent === undefined ? 0 : d.spread_percent));
      parts.push(Tx._ser.writeUint16LE(d.size_percent === undefined ? 0 : d.size_percent));
      parts.push(Tx._ser.writeUint32LE(d.expiration_seconds === undefined ? 0 : d.expiration_seconds));
      parts.push(new Uint8Array([d.repeat ? 1 : 0]));
    }
    return Tx._ser.concatBytes(parts);
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
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.seller),
      Tx._ser.serializeAsset(op.amount_to_sell),
      Tx._ser.serializeAsset(op.min_to_receive),
      Tx._ser.writeUint32LE(expSecs >>> 0),
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
      parts.push(Tx._ser.varintUint32(1));
      parts.push(Tx._ser.varintUint32(0));
      parts.push(Tx._ser.varintUint32(onFill.length));
      for (var k = 0; k < onFill.length; k++) parts.push(serializeLimitOrderAutoAction(onFill[k]));
    } else {
      parts.push(Tx._ser.varintUint32(0));
    }
    return Tx._ser.concatBytes(parts);
  }

  /* Limit-order-cancel op data in #4 FC_REFLECT order: fee,
   * fee_paying_account (= order seller), order (1.7.x), extensions. */

  function serializeLimitOrderCancelOp(op) {
    if (!op || typeof op !== "object") throw new Error("limit_order_cancel op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.fee_paying_account),
      Tx._ser.serializeObjectId(op.order),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* vote_id "type:instance" string (or raw u32 number) -> u32 wire value
   * (instance<<8 | type). #4 vote.hpp:42-49; #3 bitshares-api.js:2126-2134.
   * Instance must fit 24 bits, type 8 bits — anything else throws. No float:
   * the shift/mask path is integer-only (writeUint32LE re-applies >>> 0). */

  function serializeCallOrderUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("call_order_update op must be an object");
    var tcr;
    if (Array.isArray(op.extensions)) {
      for (var i = 0; i < op.extensions.length; i++) {
        var item = op.extensions[i];
        var data = Array.isArray(item) ? item[1] : item;
        if (data && data.target_collateral_ratio !== undefined && data.target_collateral_ratio !== null) {
          tcr = data.target_collateral_ratio;
          break;
        }
      }
    } else if (op.extensions && typeof op.extensions === "object") {
      tcr = op.extensions.target_collateral_ratio;
    }
    var ext = (tcr === undefined || tcr === null)
      ? Tx._ser.varintUint32(0)
      : Tx._ser.concatBytes([Tx._ser.varintUint32(1), Tx._ser.varintUint32(0), Tx._ser.writeUint16LE(tcr)]);
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.funding_account),
      Tx._ser.serializeAsset(op.delta_collateral),
      Tx._ser.serializeAsset(op.delta_debt),
      ext
    ]);
  }

  /* samet_fund_create (op 64) in #4 FC order: fee, owner_account, asset_type
   * (asset id), balance int64, fee_rate u32 (denom GRAPHENE_FEE_RATE_DENOM =
   * 1000000, so 1000 units = 0.1% — integer units only, never a ratio),
   * empty extensions. */

  function serializeAssetCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_create op must be an object");
    if (typeof op.symbol !== "string" || !op.symbol) throw new Error("asset_create symbol must be a non-empty string");
    if (!Number.isInteger(op.precision) || op.precision < 0 || op.precision > 12) {
      throw new Error("asset_create precision must be an integer 0..12, got: " + JSON.stringify(op.precision));
    }
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.issuer),
      Tx._ser.serializeString(op.symbol),
      Tx._ser.writeUint8(op.precision),
      Tx._ser.serializeAssetOptions(op.common_options),
      Tx._ser.serializeOptional(op.bitasset_opts === undefined ? null : op.bitasset_opts, Tx._ser.serializeBitassetOptions),
      new Uint8Array([op.is_prediction_market ? 1 : 0]),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_update (op 11) in #4 FC order: fee, issuer, asset_to_update,
   * new_issuer?, new_options, extensions (empty per ambiguity C). */

  function serializeAssetUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_update op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.issuer),
      Tx._ser.serializeObjectId(op.asset_to_update),
      Tx._ser.serializeOptional(op.new_issuer === undefined ? null : op.new_issuer, Tx._ser.serializeObjectId),
      Tx._ser.serializeAssetOptions(op.new_options),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_update_bitasset (op 12) in #4 FC order: fee, issuer,
   * asset_to_update, new_options (bitasset_options), extensions (empty per
   * ambiguity B). Target must be market-issued — enforced read-side by
   * asset.js (Task 2), not here: bytes carry no such check. */

  function serializeAssetUpdateBitassetOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_update_bitasset op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.issuer),
      Tx._ser.serializeObjectId(op.asset_to_update),
      Tx._ser.serializeBitassetOptions(op.new_options),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_update_feed_producers (op 13) in #4 FC order: fee, issuer,
   * asset_to_update, new_feed_producers (sorted account-id set),
   * extensions. */

  function serializeAssetUpdateFeedProducersOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_update_feed_producers op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.issuer),
      Tx._ser.serializeObjectId(op.asset_to_update),
      Tx._ser.serializeIdSet(op.new_feed_producers),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_issue (op 14) in #4 FC order: fee, issuer, asset_to_issue,
   * issue_to_account, memo?, extensions. Memo uses the shared full-structure
   * memo serializer via serializeOptional (absent <-> 0x00, same convention
   * as the transfer path; byte-identical to #3's if/else branch). */

  function serializeAssetIssueOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_issue op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.issuer),
      Tx._ser.serializeAsset(op.asset_to_issue),
      Tx._ser.serializeObjectId(op.issue_to_account),
      Tx._ser.serializeOptional(op.memo === undefined ? null : op.memo, Tx._ser.serializeMemo),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_reserve (op 15) in #4 FC order: fee, payer, amount_to_reserve,
   * extensions. NOT usable on market-issued assets — enforced read-side by
   * asset.js (Task 2) with a `not-market-issued` error, not here. */

  function serializeAssetReserveOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_reserve op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.payer),
      Tx._ser.serializeAsset(op.amount_to_reserve),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_fund_fee_pool (op 16) in #4 FC order: fee, from_account, asset_id,
   * amount (bare int64 in CORE units), extensions. The amount is NOT an
   * asset pair (unlike op 15) — #4 asset_ops.hpp:329 marks it `share_type`
   * (core asset), BJS asset_fund_fee_pool + #3 :2572-2573 agree (int64).
   * writeInt64LE throws loudly on missing/non-digit input — no `|| 0`
   * fallback (a forgotten amount must fail, not fund zero). */

  function serializeAssetFundFeePoolOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_fund_fee_pool op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.from_account),
      Tx._ser.serializeObjectId(op.asset_id),
      Tx._ser.writeInt64LE(op.amount),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_settle (op 17) in #4 FC order: fee, account, amount (the bitasset
   * to force-settle), extensions (empty). Fee payer is the settler. The
   * amount MUST be a market-issued asset and the account must hold it —
   * chain-enforced at broadcast (validate() in asset_evaluator), never
   * checked here: bytes carry no position lookup. */

  function serializeAssetSettleOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_settle op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeAsset(op.amount),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_claim_fees (op 43) in #4 FC order: fee, issuer, amount_to_claim,
   * extensions=extension<additional_options_type>. The ext packs per ext.hpp:
   * varint count of SET optionals + (index + value) each — so an unset
   * claim_from_asset_id is a single 0x00 (the #3 always-empty path when no
   * object is passed), while a set one encodes 0x01 0x00 <asset id> (index 0
   * per additional_options_type field order, #4 :535-543; #3 :3012-3021
   * agrees). Accepts the object form {claim_from_asset_id} and the empty
   * array [] (builders emit [] when unset); any other non-empty shape throws
   * loudly instead of producing always-rejected bytes. Fee payer is the
   * issuer, which must match the claimed asset's issuer. */

  function serializeAssetClaimFeesOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_claim_fees op must be an object");
    var claimFrom = null;
    var ext = op.extensions;
    if (ext === null || ext === undefined) {
      claimFrom = null;
    } else if (Array.isArray(ext)) {
      if (ext.length === 0) {
        claimFrom = null;
      } else if (ext.length === 1 && ext[0] && typeof ext[0] === "object" &&
          !Array.isArray(ext[0]) && ext[0].claim_from_asset_id !== undefined &&
          ext[0].claim_from_asset_id !== null) {
        claimFrom = ext[0].claim_from_asset_id;
      } else if (ext.length === 2 && ext[0] === 0) {
        claimFrom = ext[1];
      } else {
        throw new Error("asset_claim_fees extensions must be [] or {claim_from_asset_id} " +
          "(or [0, asset_id]), got: " + JSON.stringify(ext));
      }
    } else if (typeof ext === "object") {
      if (ext.claim_from_asset_id === undefined || ext.claim_from_asset_id === null) {
        claimFrom = null;
      } else {
        claimFrom = ext.claim_from_asset_id;
      }
    } else {
      throw new Error("asset_claim_fees extensions must be [] or {claim_from_asset_id}, got: " +
        JSON.stringify(ext));
    }
    var extBytes = (claimFrom === null || claimFrom === undefined)
      ? Tx._ser.varintUint32(0)
      : Tx._ser.concatBytes([Tx._ser.varintUint32(1), Tx._ser.varintUint32(0), Tx._ser.serializeObjectId(claimFrom)]);
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.issuer),
      Tx._ser.serializeAsset(op.amount_to_claim),
      extBytes
    ]);
  }

  /* asset_claim_pool (op 47) in #4 FC order: fee, issuer, asset_id (the
   * asset whose CORE fee pool is drained), amount_to_claim (CORE asset),
   * extensions (empty). Fee payer is the issuer; fee.asset_id must differ
   * from asset_id (chain-enforced, not checked here). */

  function serializeAssetClaimPoolOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_claim_pool op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.issuer),
      Tx._ser.serializeObjectId(op.asset_id),
      Tx._ser.serializeAsset(op.amount_to_claim),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_update_issuer (op 48) in #4 FC order: fee, issuer (current),
   * asset_to_update, new_issuer, extensions (empty). OWNER authority is
   * required (get_required_owner_authorities inserts issuer, active set is
   * empty — #4 :580-584): the caller signs with the owner WIF (see the
   * Task-2 builder comment); the bytes themselves carry no authority flag,
   * so this function writes what it is given. */

  function serializeAssetUpdateIssuerOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_update_issuer op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.issuer),
      Tx._ser.serializeObjectId(op.asset_to_update),
      Tx._ser.serializeObjectId(op.new_issuer),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* asset_publish_feed (op 19) in #4 FC order: fee, publisher, asset_id,
   * feed (price_feed), extensions (empty; BSIP77 initial_collateral_ratio
   * ext populated only on proven testnet need, Task 4). */

  function serializeAssetPublishFeedOp(op) {
    if (!op || typeof op !== "object") throw new Error("asset_publish_feed op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.publisher),
      Tx._ser.serializeObjectId(op.asset_id),
      Tx._ser.serializePriceFeed(op.feed),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* time_point_sec (uint32 unix seconds). Accepts an ISO "YYYY-MM-DDTHH:MM:SS"
   * string (parsed as UTC, trailing Z added when missing — same convention as
   * serializeTransaction) or a unix-seconds number. Integer-only; throws on
   * missing/unparseable/out-of-range input (deliberate: #3 defaults those to
   * 0, vanilla fails loudly — same rule as precision/MCR). */

  function serializeHtlcCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("htlc_create op must be an object");
    Tx._ser.assertUint32(op.claim_period_seconds, "claim_period_seconds");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.from),
      Tx._ser.serializeObjectId(op.to),
      Tx._ser.serializeAsset(op.amount),
      Tx._ser.serializeHtlcHash(op.preimage_hash),
      Tx._ser.writeUint16LE(op.preimage_size),
      Tx._ser.writeUint32LE(op.claim_period_seconds),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* htlc_redeem (op 50) in #4 FC order: fee, htlc_id (1.16.x), redeemer,
   * preimage bytes (caller passes hex — hex-decoded here with a varint
   * length prefix, matching #1's Buffer->hex->bytes round trip), empty
   * extensions. */

  function serializeHtlcRedeemOp(op) {
    if (!op || typeof op !== "object") throw new Error("htlc_redeem op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.htlc_id),
      Tx._ser.serializeObjectId(op.redeemer),
      Tx._ser.serializeBytesHex(op.preimage),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* htlc_extend (op 52) in #4 FC order: fee, htlc_id (1.16.x),
   * update_issuer, seconds_to_add u32, empty extensions. */

  function serializeHtlcExtendOp(op) {
    if (!op || typeof op !== "object") throw new Error("htlc_extend op must be an object");
    Tx._ser.assertUint32(op.seconds_to_add, "seconds_to_add");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.htlc_id),
      Tx._ser.serializeObjectId(op.update_issuer),
      Tx._ser.writeUint32LE(op.seconds_to_add),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* withdraw_permission_create (op 25) in #4 FC order: fee,
   * withdraw_from_account, authorized_account, withdrawal_limit,
   * withdrawal_period_sec u32, periods_until_expiration u32,
   * period_start_time (time_point_sec). No extensions field exists. */

  function serializeWithdrawPermissionCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("withdraw_permission_create op must be an object");
    Tx._ser.assertUint32(op.withdrawal_period_sec, "withdrawal_period_sec");
    Tx._ser.assertUint32(op.periods_until_expiration, "periods_until_expiration");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.withdraw_from_account),
      Tx._ser.serializeObjectId(op.authorized_account),
      Tx._ser.serializeAsset(op.withdrawal_limit),
      Tx._ser.writeUint32LE(op.withdrawal_period_sec),
      Tx._ser.writeUint32LE(op.periods_until_expiration),
      Tx._ser.serializeTimestamp(op.period_start_time)
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
    Tx._ser.assertUint32(op.withdrawal_period_sec, "withdrawal_period_sec");
    Tx._ser.assertUint32(op.periods_until_expiration, "periods_until_expiration");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.withdraw_from_account),
      Tx._ser.serializeObjectId(op.authorized_account),
      Tx._ser.serializeObjectId(op.permission_to_update),
      Tx._ser.serializeAsset(op.withdrawal_limit),
      Tx._ser.writeUint32LE(op.withdrawal_period_sec),
      Tx._ser.serializeTimestamp(op.period_start_time),
      Tx._ser.writeUint32LE(op.periods_until_expiration)
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
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.withdraw_permission),
      Tx._ser.serializeObjectId(op.withdraw_from_account),
      Tx._ser.serializeObjectId(op.withdraw_to_account),
      Tx._ser.serializeAsset(op.amount_to_withdraw),
      Tx._ser.serializeOptional(op.memo === undefined ? null : op.memo, Tx._ser.serializeMemo)
    ]);
  }

  /* withdraw_permission_delete (op 28) in #4 FC order: fee,
   * withdraw_from_account, authorized_account, withdrawal_permission
   * (1.12.x). Fee is 0 (free cancel) — enforced read-side at confirm time,
   * not here. No extensions field exists. */

  function serializeWithdrawPermissionDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("withdraw_permission_delete op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.withdraw_from_account),
      Tx._ser.serializeObjectId(op.authorized_account),
      Tx._ser.serializeObjectId(op.withdrawal_permission)
    ]);
  }

  /* liquidity_pool_create (op 59) in #4 FC order: fee, account, asset_a,
   * asset_b, share_asset, taker_fee_percent u16, withdrawal_fee_percent u16,
   * extensions. Percents are HUNDREDTHS (150 = 1.5%) — integer units only;
   * writeUint16LE rejects floats/strings loudly. No hidden a/b sort here:
   * the Task-2 builder sorts upstream and the serializer writes what it is
   * given (byte determinism). Missing percents default to 0 (the #4 struct
   * default), matching #3's `|| 0`. */

  function serializeLiquidityPoolCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_create op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.asset_a),
      Tx._ser.serializeObjectId(op.asset_b),
      Tx._ser.serializeObjectId(op.share_asset),
      Tx._ser.writeUint16LE(op.taker_fee_percent || 0),
      Tx._ser.writeUint16LE(op.withdrawal_fee_percent || 0),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* liquidity_pool_delete (op 60) in #4 FC order: fee, account, pool
   * (1.19.x), extensions. Fee is 0 (free owner cleanup, #4 fee_params_t) —
   * enforced read-side at confirm time, not here. */

  function serializeLiquidityPoolDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_delete op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.pool),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* liquidity_pool_deposit (op 61) in #4 FC order: fee, account, pool,
   * amount_a, amount_b, extensions. Amounts stay digit strings until
   * writeInt64LE (integer-only, same rule as every asset path above). */

  function serializeLiquidityPoolDepositOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_deposit op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.pool),
      Tx._ser.serializeAsset(op.amount_a),
      Tx._ser.serializeAsset(op.amount_b),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* liquidity_pool_withdraw (op 62) in #4 FC order: fee, account, pool,
   * share_amount, extensions. */

  function serializeLiquidityPoolWithdrawOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_withdraw op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.pool),
      Tx._ser.serializeAsset(op.share_amount),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* liquidity_pool_exchange (op 63) in #4 FC order: fee, account, pool,
   * amount_to_sell, min_to_receive, extensions. Executes immediately against
   * the pool (CPMM) — not an orderbook fill; slippage math lives in the
   * Task-2 builder, this function writes the resulting RAW min verbatim. */

  function serializeLiquidityPoolExchangeOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_exchange op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.pool),
      Tx._ser.serializeAsset(op.amount_to_sell),
      Tx._ser.serializeAsset(op.min_to_receive),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* liquidity_pool_update (op 75) in #4 FC order: fee, account, pool,
   * taker_fee_percent?, withdrawal_fee_percent?, extensions. Both fee fields
   * are OPTIONAL (absent <-> 0x00 via serializeOptional, same convention as
   * the transfer-memo path); at least one must be set or the node's
   * validate() rejects — so both-absent throws loudly here instead of
   * producing always-rejected bytes. CANONICAL names only (see header). */

  function serializeLiquidityPoolUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_update op must be an object");
    var taker = (op.taker_fee_percent === undefined || op.taker_fee_percent === null) ? null : op.taker_fee_percent;
    var withdrawal = (op.withdrawal_fee_percent === undefined || op.withdrawal_fee_percent === null) ? null : op.withdrawal_fee_percent;
    if (taker === null && withdrawal === null) {
      throw new Error("liquidity_pool_update needs at least one of taker_fee_percent / withdrawal_fee_percent");
    }
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.pool),
      Tx._ser.serializeOptional(taker, Tx._ser.writeUint16LE),
      Tx._ser.serializeOptional(withdrawal, Tx._ser.writeUint16LE),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* call_order_update (op 3) in #4 FC order: fee, funding_account,
   * delta_collateral, delta_debt, extensions=extension<options_type>. The ext
   * holds ONE optional u16 target_collateral_ratio: absent/empty extensions
   * encode a single 0x00 (count 0); set encodes count 1 + variant index 0 +
   * u16 LE (matches #3's pack path). Accepts the object form
   * {target_collateral_ratio} and the static_variant array form
   * [[0, {target_collateral_ratio}]] (same dual-shape convention as the
   * limit_order_create on_fill collapse above). NO expiration field — #1's
   * MarketsActions passes one inside op 3 but #4's FC_REFLECT has no such
   * field, so vanilla never writes it. */

  function serializeSametFundCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_create op must be an object");
    Tx._ser.assertUint32(op.fee_rate, "fee_rate");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.owner_account),
      Tx._ser.serializeObjectId(op.asset_type),
      Tx._ser.writeInt64LE(op.balance),
      Tx._ser.writeUint32LE(op.fee_rate),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* samet_fund_delete (op 65) in #4 FC order: fee, owner_account, fund_id
   * (1.20.x), empty extensions. Fee is 0 (free owner cleanup, #4
   * fee_params_t) — enforced read-side at confirm time, not here. */

  function serializeSametFundDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_delete op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.owner_account),
      Tx._ser.serializeObjectId(op.fund_id),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* samet_fund_update (op 66) in #4 FC order: fee, owner_account, fund_id,
   * delta_amount?, new_fee_rate? (CANONICAL name), empty extensions.
   * Absent optionals encode 0x00 via serializeOptional, same convention as
   * the transfer-memo path. */

  function serializeSametFundUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_update op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.owner_account),
      Tx._ser.serializeObjectId(op.fund_id),
      Tx._ser.serializeOptional(op.delta_amount, Tx._ser.serializeAsset),
      Tx._ser.serializeOptional(op.new_fee_rate, function (v) {
        Tx._ser.assertUint32(v, "new_fee_rate");
        return Tx._ser.writeUint32LE(v);
      }),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* samet_fund_borrow (op 67) in #4 FC order: fee, borrower, fund_id,
   * borrow_amount, empty extensions. Fee payer is the borrower. */

  function serializeSametFundBorrowOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_borrow op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.borrower),
      Tx._ser.serializeObjectId(op.fund_id),
      Tx._ser.serializeAsset(op.borrow_amount),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* samet_fund_repay (op 68) in #4 FC order: fee, account, fund_id,
   * repay_amount, fund_fee, empty extensions. repay_amount AND fund_fee are
   * both explicit assets (the fee for using the fund is not the op fee). */

  function serializeSametFundRepayOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_repay op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.fund_id),
      Tx._ser.serializeAsset(op.repay_amount),
      Tx._ser.serializeAsset(op.fund_fee),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* Numeric id-string comparator for flat_map entry sorting: "S.T.I" keys
   * compared part-wise as integers (string sort would misorder 1.3.10 before
   * 1.3.9 — same rule as serializeIdSet). Accepts a {id: value} object or an
   * [[id, value], ...] array; returns a sorted [[id, value], ...] copy. A
   * malformed key sorts arbitrarily but still throws loudly in
   * serializeObjectId below — never silently repaired. */

  function serializeCreditOfferCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_offer_create op must be an object");
    Tx._ser.assertUint32(op.fee_rate, "fee_rate");
    Tx._ser.assertUint32(op.max_duration_seconds, "max_duration_seconds");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.owner_account),
      Tx._ser.serializeObjectId(op.asset_type),
      Tx._ser.writeInt64LE(op.balance),
      Tx._ser.writeUint32LE(op.fee_rate),
      Tx._ser.writeUint32LE(op.max_duration_seconds),
      Tx._ser.writeInt64LE(op.min_deal_amount),
      new Uint8Array([op.enabled ? 1 : 0]),
      Tx._ser.serializeTimestamp(op.auto_disable_time),
      Tx._ser.serializeCollateralMap(op.acceptable_collateral),
      Tx._ser.serializeBorrowerMap(op.acceptable_borrowers),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* credit_offer_delete (op 70) in #4 FC order: fee, owner_account, offer_id
   * (1.21.x), empty extensions. Fee is 0 — enforced read-side at confirm
   * time, not here. */

  function serializeCreditOfferDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_offer_delete op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.owner_account),
      Tx._ser.serializeObjectId(op.offer_id),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* credit_offer_update (op 71) in #4 FC order: fee, owner_account, offer_id,
   * delta_amount?, fee_rate?, max_duration_seconds?, min_deal_amount?,
   * enabled?, auto_disable_time?, acceptable_collateral?,
   * acceptable_borrowers?, empty extensions. CANONICAL names only (see
   * header): unchanged fields stay null/undefined and encode absent — never
   * zero-filled, so an update touches only what it sets. */

  function serializeCreditOfferUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_offer_update op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.owner_account),
      Tx._ser.serializeObjectId(op.offer_id),
      Tx._ser.serializeOptional(op.delta_amount, Tx._ser.serializeAsset),
      Tx._ser.serializeOptional(op.fee_rate, function (v) {
        Tx._ser.assertUint32(v, "fee_rate");
        return Tx._ser.writeUint32LE(v);
      }),
      Tx._ser.serializeOptional(op.max_duration_seconds, function (v) {
        Tx._ser.assertUint32(v, "max_duration_seconds");
        return Tx._ser.writeUint32LE(v);
      }),
      Tx._ser.serializeOptional(op.min_deal_amount, Tx._ser.writeInt64LE),
      Tx._ser.serializeOptional(op.enabled, function (v) { return new Uint8Array([v ? 1 : 0]); }),
      Tx._ser.serializeOptional(op.auto_disable_time, Tx._ser.serializeTimestamp),
      Tx._ser.serializeOptionalCollateralMap(op.acceptable_collateral),
      Tx._ser.serializeOptionalBorrowerMap(op.acceptable_borrowers),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* credit_offer_accept (op 72) in #4 FC order: fee, borrower, offer_id,
   * borrow_amount, collateral, max_fee_rate u32 (same 1M denom as fee_rate),
   * min_duration_seconds u32, extensions=extension<ext{optional u8
   * auto_repay}>. The ext packs per ext.hpp: varint count of SET optionals +
   * (index + value) each — so omitted auto_repay is a single 0x00 (the #3
   * always-empty form, proven path first), while a set auto_repay (0/1/2)
   * encodes 0x01 0x00 <u8>. Accepts the object form {auto_repay} and the
   * static_variant array form [[0, {auto_repay}]], mirroring op 3 above.
   * Accepting SPAWNS the deal (1.22.x) — there is no credit_deal_create op. */

  function serializeCreditOfferAcceptOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_offer_accept op must be an object");
    Tx._ser.assertUint32(op.max_fee_rate, "max_fee_rate");
    Tx._ser.assertUint32(op.min_duration_seconds, "min_duration_seconds");
    var autoRepay;
    if (Array.isArray(op.extensions)) {
      for (var i = 0; i < op.extensions.length; i++) {
        var item = op.extensions[i];
        var data = Array.isArray(item) ? item[1] : item;
        if (data && data.auto_repay !== undefined && data.auto_repay !== null) {
          autoRepay = data.auto_repay;
          break;
        }
      }
    } else if (op.extensions && typeof op.extensions === "object") {
      autoRepay = op.extensions.auto_repay;
    }
    var ext;
    if (autoRepay === undefined || autoRepay === null) {
      ext = Tx._ser.varintUint32(0);
    } else {
      Tx._ser.assertAutoRepay(autoRepay);
      ext = Tx._ser.concatBytes([Tx._ser.varintUint32(1), Tx._ser.varintUint32(0), new Uint8Array([autoRepay])]);
    }
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.borrower),
      Tx._ser.serializeObjectId(op.offer_id),
      Tx._ser.serializeAsset(op.borrow_amount),
      Tx._ser.serializeAsset(op.collateral),
      Tx._ser.writeUint32LE(op.max_fee_rate),
      Tx._ser.writeUint32LE(op.min_duration_seconds),
      ext
    ]);
  }

  /* credit_deal_repay (op 73) in #4 FC order: fee, account, deal_id
   * (1.22.x), repay_amount, credit_fee, empty extensions. repay_amount AND
   * credit_fee are both explicit assets. */

  function serializeCreditDealRepayOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_deal_repay op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.deal_id),
      Tx._ser.serializeAsset(op.repay_amount),
      Tx._ser.serializeAsset(op.credit_fee),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* auto_repay enum guard (credit_offer.hpp:118-129): 0 no_auto_repayment,
   * 1 only_full_repayment, 2 allow_partial_repayment. Loud failure — a
   * forgotten or out-of-range value must never become silent bytes. */

  function serializeCreditDealUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_deal_update op must be an object");
    var account = (op.account !== undefined && op.account !== null) ? op.account : op.borrower;
    Tx._ser.assertAutoRepay(op.auto_repay);
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(account),
      Tx._ser.serializeObjectId(op.deal_id),
      Tx._ser.writeUint8(op.auto_repay),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* Op 74 (credit_deal_expired) is VIRTUAL (#4 operations.hpp:130;
   * validate() asserts !"virtual operation" in credit_offer.hpp) — it can
   * never appear in a signed tx, so no serializer exists for it here (same
   * rule as ops 51/53 below). #3's serializeCreditDealExpiredOp (:3580-3594)
   * serves history display only. */

  /* authority {weight_threshold u32, account_auths [[id, u16]...],
   * key_auths [[pubkey, u16]...], address_auths [[ripemd160hex, u16]...]} in
   * #4 FC order (weight_threshold)(account_auths)(key_auths)(address_auths).
   * Null/undefined encodes the empty authority (threshold 0, three empty
   * counts — matches #3's empty branch). Maps sort (see header deviations);
   * weights go through writeUint16LE so an out-of-range weight throws. */

  function serializeBidCollateralOp(op) {
    if (!op || typeof op !== "object") throw new Error("bid_collateral op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.bidder),
      Tx._ser.serializeAsset(op.additional_collateral),
      Tx._ser.serializeAsset(op.debt_covered),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* Governance-url guard (shared by ops 20/21/29/30): the node's validate()
   * (witness.cpp:30-41; committee_member.cpp mirrors it) rejects
   * url.size() >= GRAPHENE_MAX_URL_LENGTH (127, #4 config.hpp:41), so
   * always-rejected bytes are never built. size() counts BYTES, hence the
   * TextEncoder length (same rule as serializeWorkerCreateOp name/url).
   * Empty string is chain-valid (#3's `|| ''` emits the same bytes);
   * missing/non-string input throws loudly instead of defaulting. */

  Tx._ser.serializeTransferOp = serializeTransferOp;
  Tx._ser.serializeLimitOrderAutoAction = serializeLimitOrderAutoAction;
  Tx._ser.serializeLimitOrderCreateOp = serializeLimitOrderCreateOp;
  Tx._ser.serializeLimitOrderCancelOp = serializeLimitOrderCancelOp;
  Tx._ser.serializeCallOrderUpdateOp = serializeCallOrderUpdateOp;
  Tx._ser.serializeAssetCreateOp = serializeAssetCreateOp;
  Tx._ser.serializeAssetUpdateOp = serializeAssetUpdateOp;
  Tx._ser.serializeAssetUpdateBitassetOp = serializeAssetUpdateBitassetOp;
  Tx._ser.serializeAssetUpdateFeedProducersOp = serializeAssetUpdateFeedProducersOp;
  Tx._ser.serializeAssetIssueOp = serializeAssetIssueOp;
  Tx._ser.serializeAssetReserveOp = serializeAssetReserveOp;
  Tx._ser.serializeAssetFundFeePoolOp = serializeAssetFundFeePoolOp;
  Tx._ser.serializeAssetSettleOp = serializeAssetSettleOp;
  Tx._ser.serializeAssetClaimFeesOp = serializeAssetClaimFeesOp;
  Tx._ser.serializeAssetClaimPoolOp = serializeAssetClaimPoolOp;
  Tx._ser.serializeAssetUpdateIssuerOp = serializeAssetUpdateIssuerOp;
  Tx._ser.serializeAssetPublishFeedOp = serializeAssetPublishFeedOp;
  Tx._ser.serializeHtlcCreateOp = serializeHtlcCreateOp;
  Tx._ser.serializeHtlcRedeemOp = serializeHtlcRedeemOp;
  Tx._ser.serializeHtlcExtendOp = serializeHtlcExtendOp;
  Tx._ser.serializeWithdrawPermissionCreateOp = serializeWithdrawPermissionCreateOp;
  Tx._ser.serializeWithdrawPermissionUpdateOp = serializeWithdrawPermissionUpdateOp;
  Tx._ser.serializeWithdrawPermissionClaimOp = serializeWithdrawPermissionClaimOp;
  Tx._ser.serializeWithdrawPermissionDeleteOp = serializeWithdrawPermissionDeleteOp;
  Tx._ser.serializeLiquidityPoolCreateOp = serializeLiquidityPoolCreateOp;
  Tx._ser.serializeLiquidityPoolDeleteOp = serializeLiquidityPoolDeleteOp;
  Tx._ser.serializeLiquidityPoolDepositOp = serializeLiquidityPoolDepositOp;
  Tx._ser.serializeLiquidityPoolWithdrawOp = serializeLiquidityPoolWithdrawOp;
  Tx._ser.serializeLiquidityPoolExchangeOp = serializeLiquidityPoolExchangeOp;
  Tx._ser.serializeLiquidityPoolUpdateOp = serializeLiquidityPoolUpdateOp;
  Tx._ser.serializeSametFundCreateOp = serializeSametFundCreateOp;
  Tx._ser.serializeSametFundDeleteOp = serializeSametFundDeleteOp;
  Tx._ser.serializeSametFundUpdateOp = serializeSametFundUpdateOp;
  Tx._ser.serializeSametFundBorrowOp = serializeSametFundBorrowOp;
  Tx._ser.serializeSametFundRepayOp = serializeSametFundRepayOp;
  Tx._ser.serializeCreditOfferCreateOp = serializeCreditOfferCreateOp;
  Tx._ser.serializeCreditOfferDeleteOp = serializeCreditOfferDeleteOp;
  Tx._ser.serializeCreditOfferUpdateOp = serializeCreditOfferUpdateOp;
  Tx._ser.serializeCreditOfferAcceptOp = serializeCreditOfferAcceptOp;
  Tx._ser.serializeCreditDealRepayOp = serializeCreditDealRepayOp;
  Tx._ser.serializeCreditDealUpdateOp = serializeCreditDealUpdateOp;
  Tx._ser.serializeBidCollateralOp = serializeBidCollateralOp;
  if (typeof globalThis !== "undefined") { globalThis.Tx = Tx; }
})();

if (typeof module !== "undefined") { module.exports = Tx; }
