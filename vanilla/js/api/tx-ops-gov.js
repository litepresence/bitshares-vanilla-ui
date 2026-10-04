/* tx-ops-gov.js — identity/governance op serializers for the Tx registry.
 *
 * What it owns: account_update/whitelist/upgrade (ops 6/7/8), witnesses
 * (20/21), committee members (29/30), proposals (22/23/24), vesting
 * balances (32/33), worker_create (34), custom trollbox chat (op 35,
 * 9198/9199 only), balance_claim (37), custom authorities (54/55/56)
 * and tickets (57/58).
 * Consumes: Tx._ser primitives from tx-primitives.js (late-bound at call
 * time — never owned here) plus Tx._ser.serializeOperationData for the
 * op-22 nested-proposal recursion (defined in tx.js, call-time lookup).
 * Side effects: attaches its functions to the shared `Tx._ser` object;
 * sets globalThis.Tx. Load order in index.html: after tx-primitives.js,
 * before tx.js. Created by: tx.js responsibility split (slice-18
 * readability pass) — code moved byte-verbatim out of tx.js except
 * shared calls now spell Tx._ser.* (same functions, same bytes).
 * Provenance: HAND-PORTED from wallet-extension/src/lib/bitshares-api.js
 * (#3), cross-checked against bitshares-core (#4) — full per-function
 * credits lived in the tx.js header at split time (see git history).
 */
var Tx = (typeof globalThis !== "undefined" && globalThis.Tx) ? globalThis.Tx : ((typeof Tx !== "undefined") ? Tx : {});
Tx.OP = Tx.OP || {};
Tx._ser = Tx._ser || {};
(function () {
  "use strict";

  function serializeAccountUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("account_update op must be an object");
    if (op.owner !== null && op.owner !== undefined) {
      throw new Error("account_update owner authority serialization is not supported (voting sets new_options only)");
    }
    if (op.active !== null && op.active !== undefined) {
      throw new Error("account_update active authority serialization is not supported (voting sets new_options only)");
    }
    var ABSENT = new Uint8Array([0]);
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      ABSENT,
      ABSENT,
      Tx._ser.serializeOptional(op.new_options === undefined ? null : op.new_options, Tx._ser.serializeAccountOptions),
      Tx._ser.varintUint32(0)
    ]);
  }

  function serializeAccountWhitelistOp(op) {
    if (!op || typeof op !== "object") throw new Error("account_whitelist op must be an object");
    if (!Number.isInteger(op.new_listing) || op.new_listing < 0 || op.new_listing > 3) {
      throw new Error("new_listing must be 0..3 " +
        "(0=none, 1=whitelisted, 2=blacklisted, 3=both), got: " + JSON.stringify(op.new_listing));
    }
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.authorizing_account),
      Tx._ser.serializeObjectId(op.account_to_list),
      Tx._ser.writeUint8(op.new_listing),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* proposal_create (op 22) in #4 FC order: fee, fee_paying_account,
   * expiration_time, proposed_ops (varint count + op_wrapper entries),
   * review_period_seconds?, extensions. Each entry accepts the #3 dual
   * shape — {op: [type, data]} or bare [type, data] — and emits the
   * canonical wrapper (varint type + data bytes, #4 operations.hpp:153-157).
   * RECURSION runs through serializeOperationData below: nested ops use the
   * same bytes as top-level ops, never a fork. */

  function serializeAccountUpgradeOp(op) {
    if (!op || typeof op !== "object") throw new Error("account_upgrade op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account_to_upgrade),
      new Uint8Array([op.upgrade_to_lifetime_member ? 1 : 0]),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* bid_collateral op data (op 45) in #4 FC_REFLECT order: fee, bidder
   * (1.2.x), additional_collateral (backing asset), debt_covered (settled
   * bitasset), empty extensions. validate() (#4 market.cpp:99-103):
   * debt_covered 0 is allowed, but nonzero debt REQUIRES nonzero
   * collateral — views require both legs > 0 and fail loudly otherwise. */

  function serializeWitnessCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("witness_create op must be an object");
    Tx._ser.assertGovUrl(op.url, "witness_create");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.witness_account),
      Tx._ser.serializeString(op.url),
      Tx._ser.serializePublicKey(op.block_signing_key)
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
    if (op.new_url !== null && op.new_url !== undefined) Tx._ser.assertGovUrl(op.new_url, "witness_update");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.witness),
      Tx._ser.serializeObjectId(op.witness_account),
      Tx._ser.serializeOptional(op.new_url === undefined ? null : op.new_url, Tx._ser.serializeString),
      Tx._ser.serializeOptional(op.new_signing_key === undefined ? null : op.new_signing_key, Tx._ser.serializePublicKey)
    ]);
  }

  /* committee_member_create (op 29) in #4 FC order: fee,
   * committee_member_account (1.2.x), url. NO extensions field
   * (committee_member.hpp:103-104). Same url rule as witness_create.
   * Fee payer is the committee member account. */

  function serializeCommitteeMemberCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("committee_member_create op must be an object");
    Tx._ser.assertGovUrl(op.url, "committee_member_create");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.committee_member_account),
      Tx._ser.serializeString(op.url)
    ]);
  }

  /* committee_member_update (op 30) in #4 FC order: fee, committee_member
   * (1.5.x), committee_member_account (1.2.x), new_url?. NO extensions
   * field (committee_member.hpp:105-106). No vote-ui form builds this op
   * (the reference has no committee-update flow) — it ships so the pair
   * is complete and op-22 proposal nesting can carry it. */

  function serializeCommitteeMemberUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("committee_member_update op must be an object");
    if (op.new_url !== null && op.new_url !== undefined) Tx._ser.assertGovUrl(op.new_url, "committee_member_update");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.committee_member),
      Tx._ser.serializeObjectId(op.committee_member_account),
      Tx._ser.serializeOptional(op.new_url === undefined ? null : op.new_url, Tx._ser.serializeString)
    ]);
  }

  /* custom_operation chat exception (op 35, sub-ids 9198/9199 ONLY — R1c
   * trollbox single exception). Wire order per #4 custom.hpp FC_REFLECT:
   * (fee)(payer)(required_auths:flat_set)(id:u16)(data:bytes). Hand-ported:
   * serializeCustomOp <- #3 bitshares-api.js:2867-2875 (fee, payer, set,
   * u16 id, bytes) + #4 custom.hpp (field order) + operations.hpp:91
   * (op 35). STRICT guards: op.id must be exactly 9198 (forum) or 9199
   * (trollbox) — any other sub-id throws (generic custom ops stay deferred);
   * payer must be 1.2.N; required_auths must be a non-empty 1.2.N array
   * containing the payer (flat_set canonical sort via serializeIdSet);
   * data must be non-empty even-length hex (the Trollbox.packAccountStorageMap
   * hex — empty data throws, never a silent empty post). */

  function serializeProposalCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("proposal_create op must be an object");
    var list = op.proposed_ops;
    if (!Array.isArray(list)) throw new Error("proposal_create proposed_ops must be an array");
    var parts = [
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.fee_paying_account),
      Tx._ser.serializeTimestamp(op.expiration_time),
      Tx._ser.varintUint32(list.length)
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
      parts.push(Tx._ser.varintUint32(inner[0]));
      parts.push(Tx._ser.serializeOperationData(inner[0], inner[1]));
    }
    parts.push(Tx._ser.serializeOptional(
      op.review_period_seconds === undefined ? null : op.review_period_seconds,
      function (v) {
        Tx._ser.assertUint32(v, "review_period_seconds");
        return Tx._ser.writeUint32LE(v);
      }));
    parts.push(Tx._ser.varintUint32(0));
    return Tx._ser.concatBytes(parts);
  }

  /* proposal_update (op 23) in #4 FC order: fee, fee_paying_account, proposal
   * (1.10.x), four sorted account-id sets, two sorted pubkey sets,
   * extensions. */

  function serializeProposalUpdateOp(op) {
    if (!op || typeof op !== "object") throw new Error("proposal_update op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.fee_paying_account),
      Tx._ser.serializeObjectId(op.proposal),
      Tx._ser.serializeIdSet(op.active_approvals_to_add),
      Tx._ser.serializeIdSet(op.active_approvals_to_remove),
      Tx._ser.serializeIdSet(op.owner_approvals_to_add),
      Tx._ser.serializeIdSet(op.owner_approvals_to_remove),
      Tx._ser.serializePubkeySet(op.key_approvals_to_add),
      Tx._ser.serializePubkeySet(op.key_approvals_to_remove),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* proposal_delete (op 24) in #4 FC order: fee, fee_paying_account,
   * using_owner_authority byte, proposal (1.10.x), extensions. */

  function serializeProposalDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("proposal_delete op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.fee_paying_account),
      new Uint8Array([op.using_owner_authority ? 1 : 0]),
      Tx._ser.serializeObjectId(op.proposal),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* vesting_balance_create (op 32) in #4 FC order: fee, creator, owner,
   * amount, policy (static_variant, array form only). NO extensions field. */

  function serializeVestingBalanceCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("vesting_balance_create op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.creator),
      Tx._ser.serializeObjectId(op.owner),
      Tx._ser.serializeAsset(op.amount),
      Tx._ser.serializeVestingPolicy(op.policy)
    ]);
  }

  /* vesting_balance_withdraw (op 33) in #4 FC order: fee, vesting_balance
   * (1.13.x), owner, amount. NO extensions field exists. */

  function serializeVestingBalanceWithdrawOp(op) {
    if (!op || typeof op !== "object") throw new Error("vesting_balance_withdraw op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.vesting_balance),
      Tx._ser.serializeObjectId(op.owner),
      Tx._ser.serializeAsset(op.amount)
    ]);
  }

  /* balance_claim (op 37) in #4 FC order: fee (ALWAYS 0 — calculate_fee
   * returns 0, balance.hpp:51; the fee asset field still serializes, so a
   * zero placeholder is the honest value), deposit_to_account,
   * balance_to_claim, balance_owner_key, total_claimed. NO extensions field
   * exists. Authority comes from the owner KEY signature, not account auth. */

  function serializeBalanceClaimOp(op) {
    if (!op || typeof op !== "object") throw new Error("balance_claim op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.deposit_to_account),
      Tx._ser.serializeObjectId(op.balance_to_claim),
      Tx._ser.serializePublicKey(op.balance_owner_key),
      Tx._ser.serializeAsset(op.total_claimed)
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
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      new Uint8Array([op.enabled ? 1 : 0]),
      Tx._ser.serializeTimestamp(op.valid_from),
      Tx._ser.serializeTimestamp(op.valid_to),
      Tx._ser.varintUint32(op.operation_type),
      Tx._ser.serializeAuthority(op.auth),
      Tx._ser.serializeRestrictionArray(op.restrictions),
      Tx._ser.varintUint32(0)
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
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.authority_to_update),
      Tx._ser.serializeOptional(op.new_enabled === undefined ? null : op.new_enabled,
        function (v) { return new Uint8Array([v ? 1 : 0]); }),
      Tx._ser.serializeOptional(op.new_valid_from === undefined ? null : op.new_valid_from, Tx._ser.serializeTimestamp),
      Tx._ser.serializeOptional(op.new_valid_to === undefined ? null : op.new_valid_to, Tx._ser.serializeTimestamp),
      Tx._ser.serializeOptional(op.new_auth === undefined ? null : op.new_auth, Tx._ser.serializeAuthority),
      Tx._ser.serializeU16Set(op.restrictions_to_remove),
      Tx._ser.serializeRestrictionArray(op.restrictions_to_add),
      Tx._ser.varintUint32(0)
    ]);
  }

  /* custom_authority_delete (op 56) in #4 FC order: fee, account,
   * authority_to_delete (1.17.x), extensions. */

  function serializeCustomAuthorityDeleteOp(op) {
    if (!op || typeof op !== "object") throw new Error("custom_authority_delete op must be an object");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.serializeObjectId(op.authority_to_delete),
      Tx._ser.varintUint32(0)
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
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.varintUint32(op.target_type),
      Tx._ser.serializeAsset(op.amount),
      Tx._ser.varintUint32(0)
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
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.ticket),
      Tx._ser.serializeObjectId(op.account),
      Tx._ser.varintUint32(op.target_type),
      Tx._ser.serializeOptional(op.amount_for_new_target === undefined ? null : op.amount_for_new_target, Tx._ser.serializeAsset),
      Tx._ser.varintUint32(0)
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

  function serializeWorkerCreateOp(op) {
    if (!op || typeof op !== "object") throw new Error("worker_create op must be an object");
    if (typeof op.name !== "string" || !op.name) {
      throw new Error("worker_create name must be a non-empty string");
    }
    if (typeof op.url !== "string") {
      throw new Error("worker_create url must be a string (empty allowed)");
    }
    var beginSecs = Tx._ser.timestampToSecs(op.work_begin_date);
    var endSecs = Tx._ser.timestampToSecs(op.work_end_date);
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
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.owner),
      Tx._ser.serializeTimestamp(op.work_begin_date),
      Tx._ser.serializeTimestamp(op.work_end_date),
      Tx._ser.writeInt64LE(payStr),
      Tx._ser.serializeString(op.name),
      Tx._ser.serializeString(op.url),
      Tx._ser.serializeWorkerInitializer(op.initializer)
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

  function serializeCustomTrollboxOp(op) {
    if (!op || typeof op !== "object") throw new Error("custom_operation op must be an object");
    if (op.id !== 9198 && op.id !== 9199) {
      throw new Error("custom_operation id not allowed (trollbox 9199 / forum 9198 only), got: " + JSON.stringify(op.id));
    }
    if (typeof op.payer !== "string" || !/^1\.2\.\d+$/.test(op.payer)) {
      throw new Error("custom_operation payer must be an account id (1.2.N), got: " + JSON.stringify(op.payer));
    }
    if (!Array.isArray(op.required_auths) || op.required_auths.length === 0) {
      throw new Error("custom_operation required_auths must be a non-empty array");
    }
    for (var i = 0; i < op.required_auths.length; i++) {
      if (typeof op.required_auths[i] !== "string" || !/^1\.2\.\d+$/.test(op.required_auths[i])) {
        throw new Error("custom_operation required_auths[" + i + "] must be an account id (1.2.N)");
      }
    }
    if (op.required_auths.indexOf(op.payer) === -1) {
      throw new Error("custom_operation required_auths must contain the payer");
    }
    if (typeof op.data !== "string" || op.data.length === 0) {
      throw new Error("custom_operation data must be a non-empty hex string");
    }
    var dataBytes = Tx._ser.hexToBytes(op.data);
    if (dataBytes.length === 0) throw new Error("custom_operation data must be a non-empty hex string");
    return Tx._ser.concatBytes([
      Tx._ser.serializeAsset(op.fee),
      Tx._ser.serializeObjectId(op.payer),
      Tx._ser.serializeIdSet(op.required_auths),
      Tx._ser.writeUint16LE(op.id),
      Tx._ser.concatBytes([Tx._ser.varintUint32(dataBytes.length), dataBytes])
    ]);
  }

  /* Nested-op data dispatch for op-22 recursion: delegates to the SAME
   * per-op functions the outer serializeTransaction path uses, so enclosed
   * bytes can never drift from top-level bytes. Covers every op this file
   * serializes (a nested op 22 inside an op 22 writes what it is given —
   * chain validity of deep nesting is the node's call, not the serializer's).
   * Kept as a separate function (rather than refactoring the proven
   * serializeTransaction chain) so no existing dispatch line changes. */

  Tx._ser.serializeAccountUpdateOp = serializeAccountUpdateOp;
  Tx._ser.serializeAccountWhitelistOp = serializeAccountWhitelistOp;
  Tx._ser.serializeAccountUpgradeOp = serializeAccountUpgradeOp;
  Tx._ser.serializeWitnessCreateOp = serializeWitnessCreateOp;
  Tx._ser.serializeWitnessUpdateOp = serializeWitnessUpdateOp;
  Tx._ser.serializeCommitteeMemberCreateOp = serializeCommitteeMemberCreateOp;
  Tx._ser.serializeCommitteeMemberUpdateOp = serializeCommitteeMemberUpdateOp;
  Tx._ser.serializeProposalCreateOp = serializeProposalCreateOp;
  Tx._ser.serializeProposalUpdateOp = serializeProposalUpdateOp;
  Tx._ser.serializeProposalDeleteOp = serializeProposalDeleteOp;
  Tx._ser.serializeVestingBalanceCreateOp = serializeVestingBalanceCreateOp;
  Tx._ser.serializeVestingBalanceWithdrawOp = serializeVestingBalanceWithdrawOp;
  Tx._ser.serializeBalanceClaimOp = serializeBalanceClaimOp;
  Tx._ser.serializeCustomAuthorityCreateOp = serializeCustomAuthorityCreateOp;
  Tx._ser.serializeCustomAuthorityUpdateOp = serializeCustomAuthorityUpdateOp;
  Tx._ser.serializeCustomAuthorityDeleteOp = serializeCustomAuthorityDeleteOp;
  Tx._ser.serializeTicketCreateOp = serializeTicketCreateOp;
  Tx._ser.serializeTicketUpdateOp = serializeTicketUpdateOp;
  Tx._ser.serializeWorkerCreateOp = serializeWorkerCreateOp;
  Tx._ser.serializeCustomTrollboxOp = serializeCustomTrollboxOp;
  if (typeof globalThis !== "undefined") { globalThis.Tx = Tx; }
})();

if (typeof module !== "undefined") { module.exports = Tx; }
