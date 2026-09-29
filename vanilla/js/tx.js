/* tx.js — graphene serializer registry + dispatch (ops 0-3, 6-8,
 * 10-15, 19-24, 25-30, 32-34, 37, 45, 49, 50, 52, 54-58, 59-73, 75, 76).
 * Envelope/fee/sign/send live in tx-send.js (slice-18 cap split).
 *
 * What it owns: binary serialization of transfer (op 0), limit_order_create
 * (op 1), limit_order_cancel (op 2), call_order_update (op 3), account_update
 * (op 6), account_whitelist (op 7), account_upgrade (op 8),
 * asset_create (op 10), asset_update (op 11), asset_update_bitasset (op 12),
 * asset_update_feed_producers (op 13), asset_issue (op 14), asset_reserve
 * (op 15), asset_publish_feed (op 19), witness_create (op 20),
 * witness_update (op 21), proposal_create/update/delete (ops
 * 22/23/24), withdraw_permission_create (op 25),
 * withdraw_permission_update (op 26), withdraw_permission_claim (op 27),
 * withdraw_permission_delete (op 28), committee_member_create (op 29),
 * committee_member_update (op 30), htlc_create (op 49), htlc_redeem
 * (op 50), htlc_extend (op 52), vesting_balance_create/withdraw (ops 32/33),
 * worker_create (op 34), balance_claim (op 37, fee always 0), custom_authority_create/update/delete
 * (ops 54/55/56), ticket_create/update (ops 57/58), liquidity_pool_create (op 59),
 * liquidity_pool_delete (op 60), liquidity_pool_deposit (op 61),
 * liquidity_pool_withdraw (op 62), liquidity_pool_exchange (op 63) and
  * liquidity_pool_update (op 75), samet_fund ops (64-68), credit ops (69-73, 76).
 * Later slices extend this file with
 * further ops — new code appends here, never forks a second serializer.
 * Consumes: nothing at load (Chain/Crypto/Format are consumed by tx-send.js,
 * read-only, never owned here).
 * Side effects: defines the single `Tx` global (OP + _ser; tx-send.js augments
 * it with fee/feeMulti/buildTx/buildTransfer/sign/broadcast). Created by:
 * building-vanilla-slices skill, slice-04-transfer plan Task 2; split by the
 * slice-18 readability pass.
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
 * - serializeLiquidityPoolCreateOp
  *                          <- #3 bitshares-api.js:3277-3288
  *                             + #4 .../protocol/liquidity_pool.hpp:163-165 (FC)
  * - serializeLiquidityPoolDeleteOp
  *                          <- #3 bitshares-api.js:3294-3301
  *                             + #4 .../protocol/liquidity_pool.hpp:166-167
  * - serializeLiquidityPoolDepositOp
  *                          <- #3 bitshares-api.js:3307-3316
  *                             + #4 .../protocol/liquidity_pool.hpp:170-171
  * - serializeLiquidityPoolWithdrawOp
  *                          <- #3 bitshares-api.js:3322-3330
  *                             + #4 .../protocol/liquidity_pool.hpp:172-173
  * - serializeLiquidityPoolExchangeOp
  *                          <- #3 bitshares-api.js:1733-1755
  *                             + #4 .../protocol/liquidity_pool.hpp:174-175
  * - serializeLiquidityPoolUpdateOp (CANONICAL names only — #3's new_*
  *   fallback at :3346-3353 deliberately NOT ported: a dApp op using only
  *   new_* names would serialize both fields absent and the node rejects
  *   it ("at least one must be set"), so vanilla callers use
  *   taker_fee_percent / withdrawal_fee_percent or fail loudly here)
  *                          <- #3 bitshares-api.js:3337-3356
  *                             + #4 .../protocol/liquidity_pool.hpp:168-169
  * - ops 59-63, 75 ids       <- #4 .../protocol/operations.hpp:115-119
  *                              (59-63), :131 (75)
  * - serializeCallOrderUpdateOp <- #3 bitshares-api.js:2355-2382
  *                              (object-form ext + array static_variant
  *                              fallback, empty -> 0x00)
  *                              + #4 .../protocol/market.hpp:171-197 (struct;
  *                              NO expiration field — #1 MarketsActions'
  *                              expiration-inside-op-3 is stale, not ported)
  *                              + FC :303-304
  * - serializeSametFund{Create,Delete,Update,Borrow,Repay}Op
  *                           <- #3 bitshares-api.js:3362-3428
  *                              + #4 .../protocol/samet_fund.hpp FC lines
  *                              (create/delete/update/borrow/repay orders);
  *                              fee_rate denom GRAPHENE_FEE_RATE_DENOM =
  *                              1000000 <- #4 .../protocol/config.hpp:121;
  *                              update uses the CANONICAL new_fee_rate name
  * - serializeCreditOffer{Create,Delete,Update,Accept}Op
  *                           <- #3 bitshares-api.js:3436-3544
  *                              + #4 .../protocol/credit_offer.hpp FC lines
  *                              (create/delete/update/accept orders)
  * - serializeCreditDealRepayOp
  *                           <- #3 bitshares-api.js:3550-3559
  *                              + #4 .../protocol/credit_offer.hpp FC lines
  * - serializeCreditDealUpdateOp
  *                           <- #3 bitshares-api.js:3565-3577 (account-first
  *                              with borrower fallback — documents #3's
  *                              committee-account trap comment)
  *                              + #4 .../protocol/credit_offer.hpp FC lines
  *                              (wire field is `account`, NOT `borrower`)
  * - op 74 (credit_deal_expired) VIRTUAL — deliberately NOT serialized
  *   (#4 operations.hpp:130 + credit_offer.hpp "virtual operation" assert;
  *   #3's :3580-3594 serializer exists only for history display, never tx)
  * - op-72 ext<ext{optional u8 auto_repay}> packing <- #4 ext.hpp (count of
  *   set optionals + index + value) + credit_offer.hpp:118-129 (0/1/2 enum),
  *   :137-141 (ext decl); #3 always writes EMPTY (:3542) — the SET form is
  *   vanilla's ambiguity-C addition, same count+index+value shape as op 3
  * - op-69/71 flat_map ordering: #4 stores flat_map (ordered); vanilla sorts
  *   entries by id before writing (same numeric rule as serializeIdSet) —
  *   #3 emits caller order, so bytes are identical for sorted input
  * - ops 3, 64-73, 76 ids <- #4 .../protocol/operations.hpp:59 (3),
  *   :120-130 (64-73, incl. 74 VIRTUAL), :132 (76)
  * - serializeAccountWhitelistOp
  *                          <- #3 bitshares-api.js:2435-2443
  *                             + #4 .../protocol/account.hpp:197-220 (struct;
  *                             new_listing bitfield 0-3) + FC :303 (wire order)
  * - serializeProposalCreateOp (op_wrapper dual-shape + recursion)
  *                          <- #3 bitshares-api.js:2651-2669 (op_wrapper
  *                             normalise {op:[type,data]} vs bare + id-shape
  *                             note) + #4 .../protocol/proposal.hpp:70-82
  *                             (struct) + FC :177-178 (wire order) + #4
  *                             .../protocol/operations.hpp:153-157 (op_wrapper
  *                             holds one `operation` static_variant — wire is
  *                             varint type + data, no extra framing)
  *                             + BJS operations.js proposal_create/op_wrapper
  *                             (field order match, fetched 2026-09-28)
  * - serializeProposalUpdateOp <- #3 bitshares-api.js:2677-2690
  *                             + #4 .../protocol/proposal.hpp:119-135 + FC
  *                             :179-181 + BJS proposal_update (order match)
  * - serializeProposalDeleteOp <- #3 bitshares-api.js:2696-2704
  *                             + #4 .../protocol/proposal.hpp:156-165 + FC
  *                             :182 + BJS proposal_delete (order match)
  * - serializeVestingPolicy (static_variant ARRAY FORM ONLY)
  *                          <- #3 bitshares-api.js:2211-2232 (array-vs-object
  *                             comment: node's JSON parser rejects object form)
  *                             + #4 .../protocol/vesting.hpp:50-54 (variant
  *                             order linear/cdd/instant) + FC :124-130
  * - serializeVestingBalanceCreateOp / WithdrawOp
  *                          <- #3 bitshares-api.js:2823-2831 / :2837-2844
  *                             + #4 .../protocol/vesting.hpp:74-90 / :101-117
  *                             + FC :124-125 + BJS vesting_balance_create /
  *                             vesting_balance_withdraw (order match)
 * - serializeBalanceClaimOp <- #3 bitshares-api.js:2916-2924
 *                             + #4 .../protocol/balance.hpp:40-57 (fee 0 at
 *                             :42 + :51) + FC :62-63 + BJS balance_claim
 *                             (order match, no extensions field)
 * - serializeWorkerInitializer <- #3 bitshares-api.js:2240-2253 (variant
 *                             varint + u16 vesting days for type 1 only)
 *                             + #4 .../protocol/worker.hpp:69-72 (variant
 *                             order refund/vesting/burn)
 * - serializeWorkerCreateOp <- #3 bitshares-api.js:2850-2861
 *                             + #4 .../protocol/worker.hpp:79-93 (struct)
 *                             + FC :106-107 (wire order)
  * - serializeAuthority      <- #3 bitshares-api.js:2076-2110
  *                             + #4 .../protocol/authority.hpp:136
  *                             (weight_threshold, account/key/address maps)
  *                             + BJS operations.js authority (map order match)
  * - serializeRestriction (+Argument, types 0-41)
  *                          <- #3 bitshares-api.js:2304-2336 (simple types;
  *                             complex punted) + #4 .../protocol/
  *                             restriction.hpp:99-137 (variant list + FC order)
  *                             + BJS operations.js restriction (42-member
  *                             variant incl. set/vector forms; the pair tag
  *                             member is an upstream gap there — vanilla implements
  *                             it per #4 as int64 + vector<restriction>)
  * - serializeCustomAuthority{Create,Update,Delete}Op
  *                          <- #3 bitshares-api.js:3197-3242
  *                             + #4 .../protocol/custom_authority.hpp:36-122
  *                             + FC :130-136 + BJS custom_authority_create /
  *                             update / delete (order match)
  * - serializeTicket{Create,Update}Op
  *                          <- #3 bitshares-api.js:3248-3271
  *                             + #4 .../protocol/ticket.hpp:33-41 (lock enum
  *                             0-4) + :47-80 + FC :90-93 + BJS ticket_create /
  *                             ticket_update (order match)
  * - serializeOperationData (nested-op recursion for op 22)
  *                          <- #3 bitshares-api.js:1495-... (operation switch;
  *                             vanilla's copy delegates to the same per-op
  *                             functions the outer tx path uses — never a fork)
  * - ops 7, 22-24, 32/33, 37, 54-58 ids
  *                          <- #4 .../protocol/operations.hpp:63 (7), :78-80
  *                             (22-24), :88-90 (32/33), :93 (37), :110-114
  *                             (54-58)
  * - NOT serialized (WHY comments at the dispatch site, slice-14 scope
  *   decision): 38 override_transfer (issuer-only — no vanilla UI path),
  *   39/40/41 blind trio (needs Pedersen commitments + bulletproof
  *   range_proofs + blinding-factor ECDH mint: #3 serializes the bytes but
  *   can not CREATE them, #2 mints them only behind Electron-host IPC —
  *   vendoring that crypto is its own audited slice, never smuggled in),
  *   46 execute_bid (VIRTUAL per #4 operations.hpp:102, never signed)
  * - op dispatch 25-28, 49/50/52
 *                            <- #3 bitshares-api.js:1547-1554, :1595-1604
 *                              (51/53 VIRTUAL — never dispatched, see the
 *                              dispatch-site comment)
  * - fee placeholder + get_required_fees shape [[[opId, opData]], assetId]
  *                          <- #3 bitshares-api.js:761-788 (getRequiredFee)
  *                             + :795-805 (broadcastTransaction fee fill)
  *                             + :1339-1341 (op-22 nested [flat, [inners]] —
  *                             flat first, inners informational)
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
 * - witness_create order (fee)(witness_account)(url)(block_signing_key),
 *   NO extensions field <- .../protocol/witness.hpp:81 (FC_REFLECT lists
 *   exactly these four); url < GRAPHENE_MAX_URL_LENGTH (127,
 *   config.hpp:41) enforced by validate() in witness.cpp:30-34 — vanilla
 *   throws on missing/non-string/oversize url instead of #3's `|| ''`
 *   silent default. Byte-identical whenever url is supplied.
 * - witness_update order (fee)(witness)(witness_account)(new_url?)
 *   (new_signing_key?), NO extensions field <- witness.hpp:84; both
 *   optionals encode absent <-> 0x00 via serializeOptional (same convention
 *   as the transfer-memo path). Both-absent is a chain-valid no-op update
 *   and encodes as such here (no at-least-one gate — unlike op 75, the
 *   node does not reject it).
 * - committee_member_create order (fee)(committee_member_account)(url),
 *   NO extensions field <- .../protocol/committee_member.hpp:103-104;
 *   same url rule as witness_create above.
 * - committee_member_update order (fee)(committee_member)
 *   (committee_member_account)(new_url?), NO extensions field
 *   <- committee_member.hpp:105-106 (currently the only updatable field
 *   is the url, :54-56). No vote-ui form builds op 30 (the reference has
 *   no committee-update flow) — the serializer ships so the pair is
 *   complete and proposal-nesting (op 22) can carry it.
 * - ops 20/21 ids <- .../protocol/operations.hpp:76-77;
 *   ops 29/30 ids <- :85-86
 * - worker_create order (fee)(owner)(work_begin_date)(work_end_date)
 *   (daily_pay)(name)(url)(initializer)
 *   <- .../protocol/worker.hpp:106-107 (FC_REFLECT); initializer variant
 *   order refund(0)/vesting(1)/burn(2) <- :69-72; validate() (end > begin,
 *   0 < pay < MAX_SHARE_SUPPLY, name < 63, url < 127)
 *   <- .../protocol/worker.cpp:30-38 + config.hpp:38-41
  * - liquidity_pool_create order (fee)(account)(asset_a)(asset_b)
  *   (share_asset)(taker_fee_percent)(withdrawal_fee_percent)(extensions)
  *   <- .../protocol/liquidity_pool.hpp:163-165
  * - liquidity_pool_delete order (fee)(account)(pool)(extensions) <- :166-167
  * - liquidity_pool_update order (fee)(account)(pool)(taker_fee_percent?)
  *   (withdrawal_fee_percent?)(extensions) <- :168-169; at-least-one-set is
  *   enforced by validate() in .../protocol/liquidity_pool.cpp (vanilla
  *   throws in the serializer too — silent absent-absent bytes are always
  *   rejected); withdrawal-to-zero-only is gated by the Task-2 builder, not
  *   here (serializer writes what it is given)
  * - liquidity_pool_deposit order (fee)(account)(pool)(amount_a)(amount_b)
  *   (extensions) <- :170-171
  * - liquidity_pool_withdraw order (fee)(account)(pool)(share_amount)
  *   (extensions) <- :172-173
  * - liquidity_pool_exchange order (fee)(account)(pool)(amount_to_sell)
  *   (min_to_receive)(extensions) <- :174-175; result is
  *   generic_exchange_operation_result holding 3 fees in order: maker market
  *   fee, taker market fee, liquidity-pool taker fee (liquidity_pool.hpp:132-137)
  * - ops 59-63, 75 ids <- .../protocol/operations.hpp:115-119 (59-63), :131 (75)
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
  *   that forgot the ratio fails loudly instead of publishing a default feed).
  * - u32 rate/duration fields (fee_rate, new_fee_rate, max_duration_seconds,
  *   max_fee_rate, min_duration_seconds) go through assertUint32 instead of
  *   #3's `|| 0`: a forgotten rate must fail loudly, not serialize as 0
  *   (silent 0% fee rate or 0-second duration). Same for int64
  *   balance/min_deal_amount (writeInt64LE throws on missing input).
  * - op-76 auto_repay is REQUIRED explicit (0/1/2): #3's `?? 0` would
  *   silently write no_auto_repayment for a caller that forgot the field.
  * - serializeAccountWhitelistOp REQUIRES new_listing 0-3: #3's `|| 0`
  *   silently remaps a forgotten listing to no_listing — vanilla throws.
  * - serializeVestingPolicy accepts the ARRAY form [type,data] ONLY: #3 also
  *   accepts a {type,...} object, but #4's node JSON parser rejects object
  *   form, so bytes built from one would never match a broadcastable op.
  *   Type 2 (instant) emits NO payload: #3's else-branch would write cdd
  *   bytes for type 2, and BJS has no third variant member at all — #4's
  *   FC_REFLECT_EMPTY (vesting.hpp:129) wins over both.
  * - serializeAuthority SORTS both maps (account ids numerically, key
  *   strings by decoded bytes): #3 emits caller order, but #4 stores
  *   flat_maps (ordered) — identical bytes for sorted input, canonical
  *   otherwise (same rule as serializeIdSet). address_auths entries are
  *   40-char ripemd160 hex -> 20 raw bytes per #4 address.hpp (addr field)
  *   and BJS Types.address — #3's 33-byte pubkey-style write is NOT ported.
  *   In practice address_auths is always empty (#4: backward-compat only).
  * - serializeRestriction implements the FULL BJS 0-41 argument table
  *   (incl. set/vector forms #3 punts on by writing an empty varint, and
  *   the pair<int64,vector<restriction>> member BJS leaves as an upstream gap):
  *   silent empty bytes for a caller-supplied restriction are always
  *   rejected or fully encoded — never half-written. Sets sort (fc set
  *   order); vectors keep caller order.
  * - op-23 key-approval sets sort by decoded pubkey bytes (flat_set order);
  *   #3 emits caller order. op-55 restrictions_to_remove sorts numerically
  *   (flat_set<u16>); restrictions_to_add keeps caller order (vector).
 * - op-57/58 target_type is REQUIRED 0-4: #3's `|| 0` silently remaps a
 *   forgotten lock type to liquid — vanilla throws (same rule as op-76).
 * - serializeWorkerInitializer accepts the ARRAY form [type,data] ONLY
 *   (same rule as serializeVestingPolicy: the node JSON parser rejects
 *   object form, so bytes built from one would never match a broadcastable
 *   op). #3's legacy {type,...} object shape is NOT accepted, and its
 *   `|| 0` fallbacks (daily_pay, pay_vesting_period_days) are NOT ported:
 *   a forgotten pay would create a 0-pay worker the node always rejects,
 *   a forgotten vesting period a 0-day vest — both fail loudly here.
 *   Name/url byte-length guards (63/127 per worker.cpp) mirror the node's
 *   validate() so always-rejected bytes are never built.
  * - op-54 operation_type is REQUIRED non-negative integer: #3's `|| 0`
  *   silently targets op 0 (transfer) for a caller that forgot the field.
  * - stale #3 field names (offer_to_update / new_* on op 71,
  *   repay_period_seconds, offer_expiry_time) are deliberately NOT accepted:
  *   canonical #4 names only — anything else fails loudly on the missing
  *   canonical field instead of serializing absent-absent bytes.
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

  /* liquidity_pool_create (op 59) in #4 FC order: fee, account, asset_a,
   * asset_b, share_asset, taker_fee_percent u16, withdrawal_fee_percent u16,
   * extensions. Percents are HUNDREDTHS (150 = 1.5%) — integer units only;
   * writeUint16LE rejects floats/strings loudly. No hidden a/b sort here:
   * the Task-2 builder sorts upstream and the serializer writes what it is
   * given (byte determinism). Missing percents default to 0 (the #4 struct
   * default), matching #3's `|| 0`. */
  function serializeLiquidityPoolCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_create op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.asset_a),
      serializeObjectId(op.asset_b),
      serializeObjectId(op.share_asset),
      writeUint16LE(op.taker_fee_percent || 0),
      writeUint16LE(op.withdrawal_fee_percent || 0),
      varintUint32(0)
    ]);
  }

  /* liquidity_pool_delete (op 60) in #4 FC order: fee, account, pool
   * (1.19.x), extensions. Fee is 0 (free owner cleanup, #4 fee_params_t) —
   * enforced read-side at confirm time, not here. */
  function serializeLiquidityPoolDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_delete op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.pool),
      varintUint32(0)
    ]);
  }

  /* liquidity_pool_deposit (op 61) in #4 FC order: fee, account, pool,
   * amount_a, amount_b, extensions. Amounts stay digit strings until
   * writeInt64LE (integer-only, same rule as every asset path above). */
  function serializeLiquidityPoolDepositOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_deposit op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.pool),
      serializeAsset(op.amount_a),
      serializeAsset(op.amount_b),
      varintUint32(0)
    ]);
  }

  /* liquidity_pool_withdraw (op 62) in #4 FC order: fee, account, pool,
   * share_amount, extensions. */
  function serializeLiquidityPoolWithdrawOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_withdraw op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.pool),
      serializeAsset(op.share_amount),
      varintUint32(0)
    ]);
  }

  /* liquidity_pool_exchange (op 63) in #4 FC order: fee, account, pool,
   * amount_to_sell, min_to_receive, extensions. Executes immediately against
   * the pool (CPMM) — not an orderbook fill; slippage math lives in the
   * Task-2 builder, this function writes the resulting RAW min verbatim. */
  function serializeLiquidityPoolExchangeOp(op) {
    if (!op || typeof op !== "object") throw new Error("liquidity_pool_exchange op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.pool),
      serializeAsset(op.amount_to_sell),
      serializeAsset(op.min_to_receive),
      varintUint32(0)
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
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.pool),
      serializeOptional(taker, writeUint16LE),
      serializeOptional(withdrawal, writeUint16LE),
      varintUint32(0)
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
      ? varintUint32(0)
      : concatBytes([varintUint32(1), varintUint32(0), writeUint16LE(tcr)]);
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.funding_account),
      serializeAsset(op.delta_collateral),
      serializeAsset(op.delta_debt),
      ext
    ]);
  }

  /* samet_fund_create (op 64) in #4 FC order: fee, owner_account, asset_type
   * (asset id), balance int64, fee_rate u32 (denom GRAPHENE_FEE_RATE_DENOM =
   * 1000000, so 1000 units = 0.1% — integer units only, never a ratio),
   * empty extensions. */
  function serializeSametFundCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_create op must be an object");
    assertUint32(op.fee_rate, "fee_rate");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.owner_account),
      serializeObjectId(op.asset_type),
      writeInt64LE(op.balance),
      writeUint32LE(op.fee_rate),
      varintUint32(0)
    ]);
  }

  /* samet_fund_delete (op 65) in #4 FC order: fee, owner_account, fund_id
   * (1.20.x), empty extensions. Fee is 0 (free owner cleanup, #4
   * fee_params_t) — enforced read-side at confirm time, not here. */
  function serializeSametFundDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_delete op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.owner_account),
      serializeObjectId(op.fund_id),
      varintUint32(0)
    ]);
  }

  /* samet_fund_update (op 66) in #4 FC order: fee, owner_account, fund_id,
   * delta_amount?, new_fee_rate? (CANONICAL name), empty extensions.
   * Absent optionals encode 0x00 via serializeOptional, same convention as
   * the transfer-memo path. */
  function serializeSametFundUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_update op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.owner_account),
      serializeObjectId(op.fund_id),
      serializeOptional(op.delta_amount, serializeAsset),
      serializeOptional(op.new_fee_rate, function (v) {
        assertUint32(v, "new_fee_rate");
        return writeUint32LE(v);
      }),
      varintUint32(0)
    ]);
  }

  /* samet_fund_borrow (op 67) in #4 FC order: fee, borrower, fund_id,
   * borrow_amount, empty extensions. Fee payer is the borrower. */
  function serializeSametFundBorrowOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_borrow op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.borrower),
      serializeObjectId(op.fund_id),
      serializeAsset(op.borrow_amount),
      varintUint32(0)
    ]);
  }

  /* samet_fund_repay (op 68) in #4 FC order: fee, account, fund_id,
   * repay_amount, fund_fee, empty extensions. repay_amount AND fund_fee are
   * both explicit assets (the fee for using the fund is not the op fee). */
  function serializeSametFundRepayOp(op) {
    if (!op || typeof op !== "object") throw new Error("samet_fund_repay op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.fund_id),
      serializeAsset(op.repay_amount),
      serializeAsset(op.fund_fee),
      varintUint32(0)
    ]);
  }

  /* Numeric id-string comparator for flat_map entry sorting: "S.T.I" keys
   * compared part-wise as integers (string sort would misorder 1.3.10 before
   * 1.3.9 — same rule as serializeIdSet). Accepts a {id: value} object or an
   * [[id, value], ...] array; returns a sorted [[id, value], ...] copy. A
   * malformed key sorts arbitrarily but still throws loudly in
   * serializeObjectId below — never silently repaired. */
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
  function serializeCreditOfferCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_offer_create op must be an object");
    assertUint32(op.fee_rate, "fee_rate");
    assertUint32(op.max_duration_seconds, "max_duration_seconds");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.owner_account),
      serializeObjectId(op.asset_type),
      writeInt64LE(op.balance),
      writeUint32LE(op.fee_rate),
      writeUint32LE(op.max_duration_seconds),
      writeInt64LE(op.min_deal_amount),
      new Uint8Array([op.enabled ? 1 : 0]),
      serializeTimestamp(op.auto_disable_time),
      serializeCollateralMap(op.acceptable_collateral),
      serializeBorrowerMap(op.acceptable_borrowers),
      varintUint32(0)
    ]);
  }

  /* credit_offer_delete (op 70) in #4 FC order: fee, owner_account, offer_id
   * (1.21.x), empty extensions. Fee is 0 — enforced read-side at confirm
   * time, not here. */
  function serializeCreditOfferDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_offer_delete op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.owner_account),
      serializeObjectId(op.offer_id),
      varintUint32(0)
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
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.owner_account),
      serializeObjectId(op.offer_id),
      serializeOptional(op.delta_amount, serializeAsset),
      serializeOptional(op.fee_rate, function (v) {
        assertUint32(v, "fee_rate");
        return writeUint32LE(v);
      }),
      serializeOptional(op.max_duration_seconds, function (v) {
        assertUint32(v, "max_duration_seconds");
        return writeUint32LE(v);
      }),
      serializeOptional(op.min_deal_amount, writeInt64LE),
      serializeOptional(op.enabled, function (v) { return new Uint8Array([v ? 1 : 0]); }),
      serializeOptional(op.auto_disable_time, serializeTimestamp),
      serializeOptionalCollateralMap(op.acceptable_collateral),
      serializeOptionalBorrowerMap(op.acceptable_borrowers),
      varintUint32(0)
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
    assertUint32(op.max_fee_rate, "max_fee_rate");
    assertUint32(op.min_duration_seconds, "min_duration_seconds");
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
      ext = varintUint32(0);
    } else {
      assertAutoRepay(autoRepay);
      ext = concatBytes([varintUint32(1), varintUint32(0), new Uint8Array([autoRepay])]);
    }
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.borrower),
      serializeObjectId(op.offer_id),
      serializeAsset(op.borrow_amount),
      serializeAsset(op.collateral),
      writeUint32LE(op.max_fee_rate),
      writeUint32LE(op.min_duration_seconds),
      ext
    ]);
  }

  /* credit_deal_repay (op 73) in #4 FC order: fee, account, deal_id
   * (1.22.x), repay_amount, credit_fee, empty extensions. repay_amount AND
   * credit_fee are both explicit assets. */
  function serializeCreditDealRepayOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_deal_repay op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.deal_id),
      serializeAsset(op.repay_amount),
      serializeAsset(op.credit_fee),
      varintUint32(0)
    ]);
  }

  /* auto_repay enum guard (credit_offer.hpp:118-129): 0 no_auto_repayment,
   * 1 only_full_repayment, 2 allow_partial_repayment. Loud failure — a
   * forgotten or out-of-range value must never become silent bytes. */
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
  function serializeCreditDealUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("credit_deal_update op must be an object");
    var account = (op.account !== undefined && op.account !== null) ? op.account : op.borrower;
    assertAutoRepay(op.auto_repay);
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(account),
      serializeObjectId(op.deal_id),
      writeUint8(op.auto_repay),
      varintUint32(0)
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
  function serializeAccountWhitelistOp(op) {
    if (!op || typeof op !== "object") throw new Error("account_whitelist op must be an object");
    if (!Number.isInteger(op.new_listing) || op.new_listing < 0 || op.new_listing > 3) {
      throw new Error("new_listing must be 0..3 " +
        "(0=none, 1=whitelisted, 2=blacklisted, 3=both), got: " + JSON.stringify(op.new_listing));
    }
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.authorizing_account),
      serializeObjectId(op.account_to_list),
      writeUint8(op.new_listing),
      varintUint32(0)
    ]);
  }

  /* proposal_create (op 22) in #4 FC order: fee, fee_paying_account,
   * expiration_time, proposed_ops (varint count + op_wrapper entries),
   * review_period_seconds?, extensions. Each entry accepts the #3 dual
   * shape — {op: [type, data]} or bare [type, data] — and emits the
   * canonical wrapper (varint type + data bytes, #4 operations.hpp:153-157).
   * RECURSION runs through serializeOperationData below: nested ops use the
   * same bytes as top-level ops, never a fork. */
  function serializeProposalCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("proposal_create op must be an object");
    var list = op.proposed_ops;
    if (!Array.isArray(list)) throw new Error("proposal_create proposed_ops must be an array");
    var parts = [
      serializeAsset(op.fee),
      serializeObjectId(op.fee_paying_account),
      serializeTimestamp(op.expiration_time),
      varintUint32(list.length)
    ];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      var inner = Array.isArray(entry) ? entry : entry.op;
      if (!Array.isArray(inner) || inner.length !== 2) {
        throw new Error("proposal_create proposed_ops[" + i + "] must be [opType, opData] or {op: [opType, opData]}");
      }
      if (!Number.isInteger(inner[0]) || inner[0] < 0) {
        throw new Error("proposal_create proposed_ops[" + i + "] type must be a non-negative integer");
      }
      parts.push(varintUint32(inner[0]));
      parts.push(serializeOperationData(inner[0], inner[1]));
    }
    parts.push(serializeOptional(
      op.review_period_seconds === undefined ? null : op.review_period_seconds,
      function (v) {
        assertUint32(v, "review_period_seconds");
        return writeUint32LE(v);
      }));
    parts.push(varintUint32(0));
    return concatBytes(parts);
  }

  /* proposal_update (op 23) in #4 FC order: fee, fee_paying_account, proposal
   * (1.10.x), four sorted account-id sets, two sorted pubkey sets,
   * extensions. */
  function serializeProposalUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("proposal_update op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.fee_paying_account),
      serializeObjectId(op.proposal),
      serializeIdSet(op.active_approvals_to_add),
      serializeIdSet(op.active_approvals_to_remove),
      serializeIdSet(op.owner_approvals_to_add),
      serializeIdSet(op.owner_approvals_to_remove),
      serializePubkeySet(op.key_approvals_to_add),
      serializePubkeySet(op.key_approvals_to_remove),
      varintUint32(0)
    ]);
  }

  /* proposal_delete (op 24) in #4 FC order: fee, fee_paying_account,
   * using_owner_authority byte, proposal (1.10.x), extensions. */
  function serializeProposalDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("proposal_delete op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.fee_paying_account),
      new Uint8Array([op.using_owner_authority ? 1 : 0]),
      serializeObjectId(op.proposal),
      varintUint32(0)
    ]);
  }

  /* vesting_balance_create (op 32) in #4 FC order: fee, creator, owner,
   * amount, policy (static_variant, array form only). NO extensions field. */
  function serializeVestingBalanceCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("vesting_balance_create op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.creator),
      serializeObjectId(op.owner),
      serializeAsset(op.amount),
      serializeVestingPolicy(op.policy)
    ]);
  }

  /* vesting_balance_withdraw (op 33) in #4 FC order: fee, vesting_balance
   * (1.13.x), owner, amount. NO extensions field exists. */
  function serializeVestingBalanceWithdrawOp(op) {
    if (!op || typeof op !== "object") throw new Error("vesting_balance_withdraw op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.vesting_balance),
      serializeObjectId(op.owner),
      serializeAsset(op.amount)
    ]);
  }

  /* balance_claim (op 37) in #4 FC order: fee (ALWAYS 0 — calculate_fee
   * returns 0, balance.hpp:51; the fee asset field still serializes, so a
   * zero placeholder is the honest value), deposit_to_account,
   * balance_to_claim, balance_owner_key, total_claimed. NO extensions field
   * exists. Authority comes from the owner KEY signature, not account auth. */
  function serializeBalanceClaimOp(op) {
    if (!op || typeof op !== "object") throw new Error("balance_claim op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.deposit_to_account),
      serializeObjectId(op.balance_to_claim),
      serializePublicKey(op.balance_owner_key),
      serializeAsset(op.total_claimed)
    ]);
  }

  /* custom_authority_create (op 54) in #4 FC order: fee, account, enabled
   * byte, valid_from, valid_to, operation_type varint, auth, restrictions
   * vector, extensions. */
  function serializeCustomAuthorityCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("custom_authority_create op must be an object");
    if (!Number.isInteger(op.operation_type) || op.operation_type < 0) {
      throw new Error("operation_type must be a non-negative integer (op id this authority can sign), got: " +
        JSON.stringify(op.operation_type));
    }
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      new Uint8Array([op.enabled ? 1 : 0]),
      serializeTimestamp(op.valid_from),
      serializeTimestamp(op.valid_to),
      varintUint32(op.operation_type),
      serializeAuthority(op.auth),
      serializeRestrictionArray(op.restrictions),
      varintUint32(0)
    ]);
  }

  /* custom_authority_update (op 55) in #4 FC order: fee, account,
   * authority_to_update (1.17.x), new_enabled?, new_valid_from?,
   * new_valid_to?, new_auth?, restrictions_to_remove (sorted u16 set),
   * restrictions_to_add (vector, caller order), extensions. Unchanged fields
   * stay null/undefined and encode absent — never zero-filled, so an update
   * touches only what it sets (same convention as op-71). */
  function serializeCustomAuthorityUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("custom_authority_update op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.authority_to_update),
      serializeOptional(op.new_enabled === undefined ? null : op.new_enabled,
        function (v) { return new Uint8Array([v ? 1 : 0]); }),
      serializeOptional(op.new_valid_from === undefined ? null : op.new_valid_from, serializeTimestamp),
      serializeOptional(op.new_valid_to === undefined ? null : op.new_valid_to, serializeTimestamp),
      serializeOptional(op.new_auth === undefined ? null : op.new_auth, serializeAuthority),
      serializeU16Set(op.restrictions_to_remove),
      serializeRestrictionArray(op.restrictions_to_add),
      varintUint32(0)
    ]);
  }

  /* custom_authority_delete (op 56) in #4 FC order: fee, account,
   * authority_to_delete (1.17.x), extensions. */
  function serializeCustomAuthorityDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("custom_authority_delete op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      serializeObjectId(op.authority_to_delete),
      varintUint32(0)
    ]);
  }

  /* ticket_create (op 57) in #4 FC order: fee, account, target_type varint
   * (0 liquid / 1 180-day / 2 360-day / 3 720-day / 4 forever — 5 COUNT is
   * not a valid target), amount, extensions. */
  function serializeTicketCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("ticket_create op must be an object");
    if (!Number.isInteger(op.target_type) || op.target_type < 0 || op.target_type > 4) {
      throw new Error("target_type must be 0..4 " +
        "(0=liquid, 1=lock_180_days, 2=lock_360_days, 3=lock_720_days, 4=lock_forever), got: " +
        JSON.stringify(op.target_type));
    }
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account),
      varintUint32(op.target_type),
      serializeAsset(op.amount),
      varintUint32(0)
    ]);
  }

  /* ticket_update (op 58) in #4 FC order: fee, ticket (1.18.x), account,
   * target_type varint (same 0-4 gate as create), amount_for_new_target?,
   * extensions. */
  function serializeTicketUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("ticket_update op must be an object");
    if (!Number.isInteger(op.target_type) || op.target_type < 0 || op.target_type > 4) {
      throw new Error("target_type must be 0..4 " +
        "(0=liquid, 1=lock_180_days, 2=lock_360_days, 3=lock_720_days, 4=lock_forever), got: " +
        JSON.stringify(op.target_type));
    }
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.ticket),
      serializeObjectId(op.account),
      varintUint32(op.target_type),
      serializeOptional(op.amount_for_new_target === undefined ? null : op.amount_for_new_target, serializeAsset),
      varintUint32(0)
    ]);
  }

  /* worker_initializer static_variant in ARRAY FORM ONLY [type, data]
   * (same rule as serializeVestingPolicy: the node's JSON parser rejects
   * object form, so bytes built from one would never match a broadcastable
   * op). Wire ids per #4 worker.hpp:69-72: 0 refund_worker_initializer (no
   * payload), 1 vesting_balance_worker_initializer (pay_vesting_period_days
   * u16), 2 burn_worker_initializer (no payload). Type-1 days are REQUIRED
   * explicit — #3's `|| 0` would silently write a 0-day vest for a caller
   * that forgot the field (writeUint16LE throws loudly on missing input). */
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
  function serializeWorkerCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("worker_create op must be an object");
    if (typeof op.name !== "string" || !op.name) {
      throw new Error("worker_create name must be a non-empty string");
    }
    if (typeof op.url !== "string") {
      throw new Error("worker_create url must be a string (empty allowed)");
    }
    var beginSecs = timestampToSecs(op.work_begin_date);
    var endSecs = timestampToSecs(op.work_end_date);
    if (endSecs <= beginSecs) {
      throw new Error("worker_create work_end_date must be after work_begin_date");
    }
    var payStr = String(op.daily_pay);
    if (!/^\d+$/.test(payStr)) {
      throw new Error("worker_create daily_pay must be a digit string, got: " + JSON.stringify(op.daily_pay));
    }
    var payBig = BigInt(payStr);
    if (payBig <= 0n) throw new Error("worker_create daily_pay must be greater than zero");
    if (payBig >= 1000000000000000n) {
      throw new Error("worker_create daily_pay exceeds GRAPHENE_MAX_SHARE_SUPPLY (1e15)");
    }
    if (new TextEncoder().encode(op.name).length >= 63) {
      throw new Error("worker_create name must be under 63 bytes (GRAPHENE_MAX_WORKER_NAME_LENGTH)");
    }
    if (new TextEncoder().encode(op.url).length >= 127) {
      throw new Error("worker_create url must be under 127 bytes (GRAPHENE_MAX_URL_LENGTH)");
    }
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.owner),
      serializeTimestamp(op.work_begin_date),
      serializeTimestamp(op.work_end_date),
      writeInt64LE(payStr),
      serializeString(op.name),
      serializeString(op.url),
      serializeWorkerInitializer(op.initializer)
    ]);
  }

  /* C27/C29 append (deferred-matrix closeout): account_upgrade (op 8) and
   * bid_collateral (op 45) serializers. Hand-ported, no import:
   * - serializeAccountUpgradeOp <- #3 bitshares-api.js:2449-2456
   *   + #4 .../protocol/account.hpp:300-301 (FC_REFLECT wire order)
 * - serializeBidCollateralOp <- #3 bitshares-api.js:3039-3047
 *                              + #4 .../protocol/market.hpp:307-308 (FC_REFLECT wire order)
 * - serializeWitnessCreateOp <- #3 bitshares-api.js:2624-2631
 *                              + #4 .../protocol/witness.hpp:81 (FC_REFLECT)
 *                              + BJS lib/serializer/src/operations.js
 *                              witness_create (field order match, fetched
 *                              2026-09-29)
 * - serializeWitnessUpdateOp <- #3 bitshares-api.js:2637-2645
 *                              + #4 .../protocol/witness.hpp:84 (FC_REFLECT)
 *                              + BJS witness_update (order match)
 * - serializeCommitteeMemberCreateOp
 *                            <- #3 bitshares-api.js:2778-2784
 *                              + #4 .../protocol/committee_member.hpp:103-104
 *                              (FC_REFLECT) + BJS committee_member_create
 *                              (order match)
 * - serializeCommitteeMemberUpdateOp
 *                            <- #3 bitshares-api.js:2790-2797
 *                              + #4 .../protocol/committee_member.hpp:105-106
 *                              (FC_REFLECT) + BJS committee_member_update
 *                              (order match)
 * - ops 20/21/29/30 ids      <- #4 .../protocol/operations.hpp:76-77
 *                              (20/21), :85-86 (29/30)
   * VARIANT NOTE (task said "op-46 bid_collateral" — off by one): #4
   * operations.hpp:101-102 numbers bid_collateral 45 and execute_bid 46
   * (VIRTUAL, never signed); #3 agrees (op table :3783, dispatch :1587).
   * Vanilla serializes 45 and never 46. */

  /* account_upgrade op data (op 8) in #4 FC_REFLECT order: fee,
   * account_to_upgrade (1.2.x), upgrade_to_lifetime_member as a single
   * 0x00/0x01 byte (FC bool; any truthy value writes 0x01 — callers pass
   * an explicit boolean), empty extensions. Fee tier is flag-driven
   * (#4 account.cpp:263-268: true -> membership_lifetime_fee, false ->
   * membership_annual_fee); vanilla always upgrades to LTM (true) and lets
   * get_required_fees answer the fee. validate() (#4 account.cpp:270-273)
   * only asserts fee >= 0 — LTM-reuse rejection happens node-side. */
  function serializeAccountUpgradeOp(op) {
    if (!op || typeof op !== "object") throw new Error("account_upgrade op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.account_to_upgrade),
      new Uint8Array([op.upgrade_to_lifetime_member ? 1 : 0]),
      varintUint32(0)
    ]);
  }

  /* bid_collateral op data (op 45) in #4 FC_REFLECT order: fee, bidder
   * (1.2.x), additional_collateral (backing asset), debt_covered (settled
   * bitasset), empty extensions. validate() (#4 market.cpp:99-103):
   * debt_covered 0 is allowed, but nonzero debt REQUIRES nonzero
   * collateral — views require both legs > 0 and fail loudly otherwise. */
  function serializeBidCollateralOp(op) {
    if (!op || typeof op !== "object") throw new Error("bid_collateral op must be an object");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.bidder),
      serializeAsset(op.additional_collateral),
      serializeAsset(op.debt_covered),
      varintUint32(0)
    ]);
  }

  /* Governance-url guard (shared by ops 20/21/29/30): the node's validate()
   * (witness.cpp:30-41; committee_member.cpp mirrors it) rejects
   * url.size() >= GRAPHENE_MAX_URL_LENGTH (127, #4 config.hpp:41), so
   * always-rejected bytes are never built. size() counts BYTES, hence the
   * TextEncoder length (same rule as serializeWorkerCreateOp name/url).
   * Empty string is chain-valid (#3's `|| ''` emits the same bytes);
   * missing/non-string input throws loudly instead of defaulting. */
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
  function serializeWitnessCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("witness_create op must be an object");
    assertGovUrl(op.url, "witness_create");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.witness_account),
      serializeString(op.url),
      serializePublicKey(op.block_signing_key)
    ]);
  }

  /* witness_update (op 21) in #4 FC order: fee, witness (1.6.x),
   * witness_account (1.2.x), new_url?, new_signing_key?. NO extensions
   * field (witness.hpp:84). Optionals encode absent <-> 0x00 via
   * serializeOptional (absent = null/undefined, same convention as the
   * transfer-memo path); a present empty-string url encodes as present
   * (chain-valid, mirrors #3). Fee payer is the witness account. */
  function serializeWitnessUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("witness_update op must be an object");
    if (op.new_url !== null && op.new_url !== undefined) assertGovUrl(op.new_url, "witness_update");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.witness),
      serializeObjectId(op.witness_account),
      serializeOptional(op.new_url === undefined ? null : op.new_url, serializeString),
      serializeOptional(op.new_signing_key === undefined ? null : op.new_signing_key, serializePublicKey)
    ]);
  }

  /* committee_member_create (op 29) in #4 FC order: fee,
   * committee_member_account (1.2.x), url. NO extensions field
   * (committee_member.hpp:103-104). Same url rule as witness_create.
   * Fee payer is the committee member account. */
  function serializeCommitteeMemberCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("committee_member_create op must be an object");
    assertGovUrl(op.url, "committee_member_create");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.committee_member_account),
      serializeString(op.url)
    ]);
  }

  /* committee_member_update (op 30) in #4 FC order: fee, committee_member
   * (1.5.x), committee_member_account (1.2.x), new_url?. NO extensions
   * field (committee_member.hpp:105-106). No vote-ui form builds this op
   * (the reference has no committee-update flow) — it ships so the pair
   * is complete and op-22 proposal nesting can carry it. */
  function serializeCommitteeMemberUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("committee_member_update op must be an object");
    if (op.new_url !== null && op.new_url !== undefined) assertGovUrl(op.new_url, "committee_member_update");
    return concatBytes([
      serializeAsset(op.fee),
      serializeObjectId(op.committee_member),
      serializeObjectId(op.committee_member_account),
      serializeOptional(op.new_url === undefined ? null : op.new_url, serializeString)
    ]);
  }

  /* Nested-op data dispatch for op-22 recursion: delegates to the SAME
   * per-op functions the outer serializeTransaction path uses, so enclosed
   * bytes can never drift from top-level bytes. Covers every op this file
   * serializes (a nested op 22 inside an op 22 writes what it is given —
   * chain validity of deep nesting is the node's call, not the serializer's).
   * Kept as a separate function (rather than refactoring the proven
   * serializeTransaction chain) so no existing dispatch line changes. */
  function serializeOperationData(opType, opData) {
    if (opType === 0) return serializeTransferOp(opData);
    if (opType === 1) return serializeLimitOrderCreateOp(opData);
    if (opType === 2) return serializeLimitOrderCancelOp(opData);
    if (opType === 3) return serializeCallOrderUpdateOp(opData);
    if (opType === 6) return serializeAccountUpdateOp(opData);
    if (opType === 7) return serializeAccountWhitelistOp(opData);
    if (opType === 8) return serializeAccountUpgradeOp(opData);
    if (opType === 10) return serializeAssetCreateOp(opData);
    if (opType === 11) return serializeAssetUpdateOp(opData);
    if (opType === 12) return serializeAssetUpdateBitassetOp(opData);
    if (opType === 13) return serializeAssetUpdateFeedProducersOp(opData);
    if (opType === 14) return serializeAssetIssueOp(opData);
    if (opType === 15) return serializeAssetReserveOp(opData);
    if (opType === 19) return serializeAssetPublishFeedOp(opData);
    if (opType === 20) return serializeWitnessCreateOp(opData);
    if (opType === 21) return serializeWitnessUpdateOp(opData);
    if (opType === 22) return serializeProposalCreateOp(opData);
    if (opType === 23) return serializeProposalUpdateOp(opData);
    if (opType === 24) return serializeProposalDeleteOp(opData);
    if (opType === 25) return serializeWithdrawPermissionCreateOp(opData);
    if (opType === 26) return serializeWithdrawPermissionUpdateOp(opData);
    if (opType === 27) return serializeWithdrawPermissionClaimOp(opData);
    if (opType === 28) return serializeWithdrawPermissionDeleteOp(opData);
    if (opType === 29) return serializeCommitteeMemberCreateOp(opData);
    if (opType === 30) return serializeCommitteeMemberUpdateOp(opData);
    if (opType === 32) return serializeVestingBalanceCreateOp(opData);
    if (opType === 33) return serializeVestingBalanceWithdrawOp(opData);
    if (opType === 34) return serializeWorkerCreateOp(opData);
    if (opType === 37) return serializeBalanceClaimOp(opData);
    if (opType === 45) return serializeBidCollateralOp(opData);
    if (opType === 49) return serializeHtlcCreateOp(opData);
    if (opType === 50) return serializeHtlcRedeemOp(opData);
    if (opType === 52) return serializeHtlcExtendOp(opData);
    if (opType === 54) return serializeCustomAuthorityCreateOp(opData);
    if (opType === 55) return serializeCustomAuthorityUpdateOp(opData);
    if (opType === 56) return serializeCustomAuthorityDeleteOp(opData);
    if (opType === 57) return serializeTicketCreateOp(opData);
    if (opType === 58) return serializeTicketUpdateOp(opData);
    if (opType === 59) return serializeLiquidityPoolCreateOp(opData);
    if (opType === 60) return serializeLiquidityPoolDeleteOp(opData);
    if (opType === 61) return serializeLiquidityPoolDepositOp(opData);
    if (opType === 62) return serializeLiquidityPoolWithdrawOp(opData);
    if (opType === 63) return serializeLiquidityPoolExchangeOp(opData);
    if (opType === 64) return serializeSametFundCreateOp(opData);
    if (opType === 65) return serializeSametFundDeleteOp(opData);
    if (opType === 66) return serializeSametFundUpdateOp(opData);
    if (opType === 67) return serializeSametFundBorrowOp(opData);
    if (opType === 68) return serializeSametFundRepayOp(opData);
    if (opType === 69) return serializeCreditOfferCreateOp(opData);
    if (opType === 70) return serializeCreditOfferDeleteOp(opData);
    if (opType === 71) return serializeCreditOfferUpdateOp(opData);
    if (opType === 72) return serializeCreditOfferAcceptOp(opData);
    if (opType === 73) return serializeCreditDealRepayOp(opData);
    if (opType === 75) return serializeLiquidityPoolUpdateOp(opData);
    if (opType === 76) return serializeCreditDealUpdateOp(opData);
    throw new Error("tx.js supports ops 0-3, 6, 7, 8, 10-15, 19-24, 25-28, 29, 30, 32-34, 37, " +
      "45, 49, 50, 52, 54-58, 59-73, 75 and 76, got op " + opType);
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
      else if (opType === 3) parts.push(serializeCallOrderUpdateOp(opData));
      else if (opType === 6) parts.push(serializeAccountUpdateOp(opData));
      else if (opType === 7) parts.push(serializeAccountWhitelistOp(opData));
      else if (opType === 8) parts.push(serializeAccountUpgradeOp(opData));
      else if (opType === 10) parts.push(serializeAssetCreateOp(opData));
      else if (opType === 11) parts.push(serializeAssetUpdateOp(opData));
      else if (opType === 12) parts.push(serializeAssetUpdateBitassetOp(opData));
      else if (opType === 13) parts.push(serializeAssetUpdateFeedProducersOp(opData));
      else if (opType === 14) parts.push(serializeAssetIssueOp(opData));
      else if (opType === 15) parts.push(serializeAssetReserveOp(opData));
      else if (opType === 19) parts.push(serializeAssetPublishFeedOp(opData));
      else if (opType === 20) parts.push(serializeWitnessCreateOp(opData));
      else if (opType === 21) parts.push(serializeWitnessUpdateOp(opData));
      else if (opType === 22) parts.push(serializeProposalCreateOp(opData));
      else if (opType === 23) parts.push(serializeProposalUpdateOp(opData));
      else if (opType === 24) parts.push(serializeProposalDeleteOp(opData));
      else if (opType === 25) parts.push(serializeWithdrawPermissionCreateOp(opData));
      else if (opType === 26) parts.push(serializeWithdrawPermissionUpdateOp(opData));
      else if (opType === 27) parts.push(serializeWithdrawPermissionClaimOp(opData));
      else if (opType === 28) parts.push(serializeWithdrawPermissionDeleteOp(opData));
      else if (opType === 29) parts.push(serializeCommitteeMemberCreateOp(opData));
      else if (opType === 30) parts.push(serializeCommitteeMemberUpdateOp(opData));
      else if (opType === 32) parts.push(serializeVestingBalanceCreateOp(opData));
      else if (opType === 33) parts.push(serializeVestingBalanceWithdrawOp(opData));
      else if (opType === 34) parts.push(serializeWorkerCreateOp(opData));
      else if (opType === 37) parts.push(serializeBalanceClaimOp(opData));
      else if (opType === 45) parts.push(serializeBidCollateralOp(opData));
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
      else if (opType === 49) parts.push(serializeHtlcCreateOp(opData));
      else if (opType === 50) parts.push(serializeHtlcRedeemOp(opData));
      else if (opType === 52) parts.push(serializeHtlcExtendOp(opData));
      else if (opType === 54) parts.push(serializeCustomAuthorityCreateOp(opData));
      else if (opType === 55) parts.push(serializeCustomAuthorityUpdateOp(opData));
      else if (opType === 56) parts.push(serializeCustomAuthorityDeleteOp(opData));
      else if (opType === 57) parts.push(serializeTicketCreateOp(opData));
      else if (opType === 58) parts.push(serializeTicketUpdateOp(opData));
      else if (opType === 59) parts.push(serializeLiquidityPoolCreateOp(opData));
      else if (opType === 60) parts.push(serializeLiquidityPoolDeleteOp(opData));
      else if (opType === 61) parts.push(serializeLiquidityPoolDepositOp(opData));
      else if (opType === 62) parts.push(serializeLiquidityPoolWithdrawOp(opData));
      else if (opType === 63) parts.push(serializeLiquidityPoolExchangeOp(opData));
      else if (opType === 64) parts.push(serializeSametFundCreateOp(opData));
      else if (opType === 65) parts.push(serializeSametFundDeleteOp(opData));
      else if (opType === 66) parts.push(serializeSametFundUpdateOp(opData));
      else if (opType === 67) parts.push(serializeSametFundBorrowOp(opData));
      else if (opType === 68) parts.push(serializeSametFundRepayOp(opData));
      else if (opType === 69) parts.push(serializeCreditOfferCreateOp(opData));
      else if (opType === 70) parts.push(serializeCreditOfferDeleteOp(opData));
      else if (opType === 71) parts.push(serializeCreditOfferUpdateOp(opData));
      else if (opType === 72) parts.push(serializeCreditOfferAcceptOp(opData));
      else if (opType === 73) parts.push(serializeCreditDealRepayOp(opData));
      // Op 74 (credit_deal_expired) is VIRTUAL — never dispatched (see the
      // no-serializer note above). Do not "complete" this list.
      else if (opType === 75) parts.push(serializeLiquidityPoolUpdateOp(opData));
      else if (opType === 76) parts.push(serializeCreditDealUpdateOp(opData));
      // Ops 51 (htlc_redeemed) and 53 (htlc_refund) are VIRTUAL (#4
      // operations.hpp:107,109; validate() asserts !"virtual operation" in
      // htlc.hpp:139,199-202) — they can never appear in a signed tx, so
      // they are NEVER dispatched here. Do not "complete" this list.
      else throw new Error("tx.js supports ops 0-3, 6, 7, 8, 10-15, 19-24, 25-28, 29, 30, 32-34, 37, 45, 49, 50, 52, 54-58, 59-73, 75 and 76 (38 issuer-only; 39/40/41 blind-downscoped; 46/51/53/74 virtual), got op " + opType);
    }
    parts.push(varintUint32((tx.extensions || []).length));
    return concatBytes(parts);
  }

  /* Envelope/fee/sign/send moved to tx-send.js (slice-18 cap split) — see
   * Tx.fee/feeMulti/buildTx/buildTransfer/sign/broadcast there. Serializer
   * registry ends here. */

  return {
    OP: {
      transfer: 0, limit_order_create: 1, limit_order_cancel: 2,
      call_order_update: 3, account_update: 6, account_whitelist: 7,
      account_upgrade: 8,
      asset_create: 10, asset_update: 11, asset_update_bitasset: 12,
      asset_update_feed_producers: 13, asset_issue: 14, asset_reserve: 15,
      asset_publish_feed: 19,
      witness_create: 20, witness_update: 21,
      proposal_create: 22, proposal_update: 23, proposal_delete: 24,
      withdraw_permission_create: 25, withdraw_permission_update: 26,
      withdraw_permission_claim: 27, withdraw_permission_delete: 28,
      committee_member_create: 29, committee_member_update: 30,
      vesting_balance_create: 32, vesting_balance_withdraw: 33,
      worker_create: 34,
      balance_claim: 37,
      bid_collateral: 45,
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
    },
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
      assertGovUrl: assertGovUrl,
      serializeWitnessCreateOp: serializeWitnessCreateOp,
      serializeWitnessUpdateOp: serializeWitnessUpdateOp,
      serializeCommitteeMemberCreateOp: serializeCommitteeMemberCreateOp,
      serializeCommitteeMemberUpdateOp: serializeCommitteeMemberUpdateOp,
      serializeTimestamp: serializeTimestamp,
      assertUint32: assertUint32,
      serializeAuthority: serializeAuthority,
      serializeAddressHex: serializeAddressHex,
      timestampToSecs: timestampToSecs,
      serializeVestingPolicy: serializeVestingPolicy,
      serializePubkeySet: serializePubkeySet,
      serializeU16Set: serializeU16Set,
      serializeSortedIdSet: serializeSortedIdSet,
      serializeRestrictionArgument: serializeRestrictionArgument,
      serializeRestriction: serializeRestriction,
      serializeRestrictionArray: serializeRestrictionArray,
      serializeAccountWhitelistOp: serializeAccountWhitelistOp,
      serializeAccountUpgradeOp: serializeAccountUpgradeOp,
      serializeBidCollateralOp: serializeBidCollateralOp,
      serializeProposalCreateOp: serializeProposalCreateOp,
      serializeProposalUpdateOp: serializeProposalUpdateOp,
      serializeProposalDeleteOp: serializeProposalDeleteOp,
      serializeVestingBalanceCreateOp: serializeVestingBalanceCreateOp,
      serializeVestingBalanceWithdrawOp: serializeVestingBalanceWithdrawOp,
      serializeWorkerInitializer: serializeWorkerInitializer,
      serializeWorkerCreateOp: serializeWorkerCreateOp,
      serializeBalanceClaimOp: serializeBalanceClaimOp,
      serializeCustomAuthorityCreateOp: serializeCustomAuthorityCreateOp,
      serializeCustomAuthorityUpdateOp: serializeCustomAuthorityUpdateOp,
      serializeCustomAuthorityDeleteOp: serializeCustomAuthorityDeleteOp,
      serializeTicketCreateOp: serializeTicketCreateOp,
      serializeTicketUpdateOp: serializeTicketUpdateOp,
      serializeOperationData: serializeOperationData,
      serializeHtlcHash: serializeHtlcHash,
      serializeHtlcCreateOp: serializeHtlcCreateOp,
      serializeHtlcRedeemOp: serializeHtlcRedeemOp,
      serializeHtlcExtendOp: serializeHtlcExtendOp,
      serializeWithdrawPermissionCreateOp: serializeWithdrawPermissionCreateOp,
      serializeWithdrawPermissionUpdateOp: serializeWithdrawPermissionUpdateOp,
      serializeWithdrawPermissionClaimOp: serializeWithdrawPermissionClaimOp,
      serializeWithdrawPermissionDeleteOp: serializeWithdrawPermissionDeleteOp,
      serializeLiquidityPoolCreateOp: serializeLiquidityPoolCreateOp,
      serializeLiquidityPoolDeleteOp: serializeLiquidityPoolDeleteOp,
      serializeLiquidityPoolDepositOp: serializeLiquidityPoolDepositOp,
      serializeLiquidityPoolWithdrawOp: serializeLiquidityPoolWithdrawOp,
      serializeLiquidityPoolExchangeOp: serializeLiquidityPoolExchangeOp,
      serializeLiquidityPoolUpdateOp: serializeLiquidityPoolUpdateOp,
      serializeCallOrderUpdateOp: serializeCallOrderUpdateOp,
      serializeSametFundCreateOp: serializeSametFundCreateOp,
      serializeSametFundDeleteOp: serializeSametFundDeleteOp,
      serializeSametFundUpdateOp: serializeSametFundUpdateOp,
      serializeSametFundBorrowOp: serializeSametFundBorrowOp,
      serializeSametFundRepayOp: serializeSametFundRepayOp,
      sortedMapEntries: sortedMapEntries,
      serializeCollateralMap: serializeCollateralMap,
      serializeBorrowerMap: serializeBorrowerMap,
      serializeOptionalCollateralMap: serializeOptionalCollateralMap,
      serializeOptionalBorrowerMap: serializeOptionalBorrowerMap,
      serializeCreditOfferCreateOp: serializeCreditOfferCreateOp,
      serializeCreditOfferDeleteOp: serializeCreditOfferDeleteOp,
      serializeCreditOfferUpdateOp: serializeCreditOfferUpdateOp,
      serializeCreditOfferAcceptOp: serializeCreditOfferAcceptOp,
      serializeCreditDealRepayOp: serializeCreditDealRepayOp,
      assertAutoRepay: assertAutoRepay,
      serializeCreditDealUpdateOp: serializeCreditDealUpdateOp,
      serializeTransaction: serializeTransaction
    }
  };
})();

if (typeof module !== "undefined") { module.exports = Tx; }
