/* tx-send.js — tx envelope/fee/sign/send (split OUT of tx.js on the cap).
 *
 * What it owns: unsigned-tx construction (buildTx/buildTransfer), fee lookup
 * (fee/feeMulti), local signing dispatch (sign), and broadcast with inclusion
 * proof (broadcast/pollHistoryForTransfer) plus its private helpers
 * (sha256Bytes/sleep/assertObjectId). Serializer registry + dispatch
 * (serializeTransaction + all serialize*Op) + Tx.OP stay in tx.js; this file
 * only consumes them via Tx._ser.
 * Consumes: Chain (db/history/net/call/status — read-only, never owns the
 * socket), Crypto.signHash (65-byte compact sig; the WIF string passes
 * through opaquely — this file NEVER touches private key bytes),
 * crypto.subtle (SHA-256 digest only), Format.formatAmount (fee display only),
 * Tx._ser.serializeTransaction/hexToBytes/bytesToHex (moved-call boundary).
 * Side effects: none beyond augmenting the single `Tx` global (fee,
 * feeMulti, buildTx, buildTransfer, sign, broadcast). Load order in
 * index.html: tx.js, then this file. Created by: building-vanilla-slices
 * skill, slice-18 readability pass (INFRA+TX+SMALL-GAPS worker).
 */
var Tx = (typeof globalThis !== "undefined" && globalThis.Tx) ? globalThis.Tx : ((typeof Tx !== "undefined") ? Tx : {});
(function () {
  "use strict";

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

  /* H4: head-block validation — a malformed or hostile node reply must fail
   * loudly (bad-head-block) instead of building a tx on garbage refs. */
  function assertHeadProps(props) {
    if (!props || typeof props !== "object") throw new Error("bad-head-block: dynamic props missing");
    if (!Number.isSafeInteger(props.head_block_number) || props.head_block_number <= 0) {
      throw new Error("bad-head-block: head_block_number must be a positive safe integer");
    }
    if (typeof props.head_block_id !== "string" || !/^[0-9a-fA-F]{40}$/.test(props.head_block_id)) {
      throw new Error("bad-head-block: head_block_id must be 40 hex chars");
    }
    if (typeof props.time !== "string") throw new Error("bad-head-block: props.time does not parse");
    var t = /[Zz]$/.test(props.time) ? props.time : props.time + "Z"; // with or without Z — never double it
    if (!Number.isFinite(Date.parse(t))) {
      throw new Error("bad-head-block: props.time does not parse");
    }
  }

  /* Exact 10^n as BigInt (fee math never touches float). */
  function pow10(n) {
    var s = "1";
    for (var i = 0; i < n; i++) s += "0";
    return BigInt(s);
  }

  /* Fee-asset precision via one get_assets read. Throws bad-asset-shape. */
  async function feeAssetPrecision(dbId, assetId) {
    var rows = await Chain.call(dbId, "get_assets", [[assetId]]);
    if (!rows || !rows[0] || typeof rows[0].precision !== "number") {
      throw new Error("bad-asset-shape for fee asset " + assetId);
    }
    return rows[0].precision;
  }

  /* H3 fee rail: refuse to auto-proceed on a suspicious fee. Throws an
   * Error starting "fee-suspicious" (with the answered fee on .detail so
   * the transfer confirm screen can show it behind an explicit ack gate).
   * Rules: fee above 5 units of the fee asset (the sketch's 5-BTS-equiv
   * proxy — exact for BTS-quoted fees, conservative otherwise), or an op-0
   * fee above 50% of the transferred amount in the same asset. */
  async function assertFeeSane(opId, opData, fee, dbId) {
    var raw = String(fee.amount);
    if (!/^\d+$/.test(raw)) throw new Error("get_required_fees fee is not a digit string: " + raw);
    var feeAsset = fee.asset_id;
    var prec = await feeAssetPrecision(dbId, feeAsset);
    var ceiling = BigInt(5) * pow10(prec);
    if (BigInt(raw) > ceiling) {
      var err = new Error("fee-suspicious: fee " + raw + " " + feeAsset +
        " exceeds the 5-unit ceiling (" + ceiling.toString() + " raw). Refusing to auto-proceed — verify the fee asset and amount.");
      err.detail = { fee: { amount: fee.amount, asset_id: feeAsset }, feeRaw: raw, feeAssetId: feeAsset, precision: prec, ceilingRaw: ceiling.toString() };
      throw err;
    }
    if (opId === 0 && opData && opData.amount && typeof opData.amount === "object") {
      var amtRaw = String(opData.amount.amount);
      var amtAsset = opData.amount.asset_id;
      if (/^\d+$/.test(amtRaw) && amtAsset === feeAsset && BigInt(raw) * 2n > BigInt(amtRaw)) {
        var err2 = new Error("fee-suspicious: fee " + raw + " exceeds 50% of the transfer amount " +
          amtRaw + " (" + feeAsset + "). Refusing to auto-proceed — lower the fee asset cost or the amount.");
        err2.detail = { fee: { amount: fee.amount, asset_id: feeAsset }, feeRaw: raw, feeAssetId: feeAsset, precision: prec, amountRaw: amtRaw };
        throw err2;
      }
    }
  }

  /* Fee lookup: pre-fills opData.fee with a zero placeholder (the node
   * requires the fee field present), then returns the chain's answered
   * {amount, asset_id}. Amount stays raw (caller formats via Format).
   * NESTED-SHAPE TRAP (op 22 proposal_create): get_required_fees answers
   * [flat_fee, [inner_fees]] for a proposal — #3 bitshares-api.js:1339-1341
   * ("Only the first element is the proposal's own fee; inner fees are
   * informational"). Reading fees[0].amount directly yields undefined, so
   * the flat (first element) is unwrapped here; inners are informational. */
  async function fee(opId, opData, feeAssetId) {
    feeAssetId = feeAssetId || "1.3.0";
    if (!Number.isInteger(opId) || opId < 0) throw new Error("opId must be a non-negative integer");
    if (!opData || typeof opData !== "object") throw new Error("opData must be an object");
    if (!opData.fee || typeof opData.fee !== "object") opData.fee = { amount: 0, asset_id: feeAssetId };
    var dbId = await Chain.db();
    var fees = await Chain.call(dbId, "get_required_fees", [[[opId, opData]], feeAssetId]);
    if (!fees || !fees[0]) throw new Error("get_required_fees returned no fee");
    var flat = Array.isArray(fees[0]) ? fees[0][0] : fees[0];
    if (!flat || typeof flat !== "object") throw new Error("get_required_fees returned no fee");
    var answered = { amount: flat.amount, asset_id: flat.asset_id };
    await assertFeeSane(opId, opData, answered, dbId);
    return answered;
  }

  /* Multi-op fee lookup: ONE get_required_fees call with the FULL op list
   * (never one call per op). Fills each opsArray[i][1].fee in place with
   * its {amount, asset_id} answer (op-22 entries unwrap the nested
   * [flat, [inners]] shape first — same rule as fee()). Returns {fees, totalRaw, totalDisplay}:
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
      var feeK = Array.isArray(fees[k]) ? fees[k][0] : fees[k];
      if (!feeK || typeof feeK !== "object") throw new Error("get_required_fees fee " + k + " is not an object");
      var raw = String(feeK.amount);
      if (!/^\d+$/.test(raw)) throw new Error("get_required_fees fee " + k + " is not a digit string: " + raw);
      total += BigInt(raw);
      opsArray[k][1].fee = { amount: feeK.amount, asset_id: feeK.asset_id };
    }
    var firstFee = (opsArray[0] && opsArray[0][1] && opsArray[0][1].fee) || null;
    var displayFeeId = (firstFee && firstFee.asset_id) || feeAssetId;
    var rows = await Chain.call(dbId, "get_assets", [[displayFeeId]]);
    if (!rows || !rows[0] || typeof rows[0].precision !== "number") {
      throw new Error("bad-asset-shape for fee asset " + displayFeeId);
    }
    /* H3 fee rail on the multi-op total (same 5-unit rule as fee(); the
     * single-op-0 50% rule applies when the batch is one transfer). */
    var railPrec = rows[0].precision;
    var railCeiling = BigInt(5) * pow10(railPrec);
    if (total > railCeiling) {
      var rerr = new Error("fee-suspicious: total fee " + total.toString() + " " + displayFeeId +
        " exceeds the 5-unit ceiling (" + railCeiling.toString() + " raw). Refusing to auto-proceed.");
      rerr.detail = { fees: opsArray.map(function (entry) { return entry[1].fee; }), totalRaw: total.toString(), feeAssetId: displayFeeId };
      throw rerr;
    }
    if (opsArray.length === 1 && opsArray[0][0] === 0) {
      var a0 = opsArray[0][1] && opsArray[0][1].amount;
      var aRaw = a0 ? String(a0.amount) : "";
      if (/^\d+$/.test(aRaw) && (a0.asset_id || feeAssetId) === displayFeeId && total * 2n > BigInt(aRaw)) {
        var rerr2 = new Error("fee-suspicious: total fee " + total.toString() + " exceeds 50% of the transfer amount " +
          aRaw + " (" + displayFeeId + "). Refusing to auto-proceed.");
        rerr2.detail = { fees: opsArray.map(function (entry) { return entry[1].fee; }), totalRaw: total.toString(), feeAssetId: displayFeeId, amountRaw: aRaw };
        throw rerr2;
      }
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
    assertHeadProps(props);
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
   * The WIF string passes through opaquely — never decoded here. Serializer
   * bytes come from Tx._ser (moved-call boundary with tx.js — identical
   * bytes, see vector proof in the slice-18 worker report). */
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
    var packed = Tx._ser.serializeTransaction(txObj);
    var chainBytes = Tx._ser.hexToBytes(st.chainId);
    var msg = new Uint8Array(chainBytes.length + packed.length);
    msg.set(chainBytes);
    msg.set(packed, chainBytes.length);
    var digest = await sha256Bytes(msg);
    var sig = await Crypto.signHash(digest, activeWIF);
    if (!(sig instanceof Uint8Array) || sig.length !== 65) throw new Error("Crypto.signHash must return 65 bytes");
    txObj.signatures = [Tx._ser.bytesToHex(sig)];
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

  Tx.fee = fee;
  Tx.feeMulti = feeMulti;
  Tx.buildTx = buildTx;
  Tx.buildTransfer = buildTransfer;
  Tx.sign = sign;
  Tx.broadcast = broadcast;
  if (typeof globalThis !== "undefined") { globalThis.Tx = Tx; }
})();

if (typeof module !== "undefined") { module.exports = Tx; }
