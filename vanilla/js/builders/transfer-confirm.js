/* TransferConfirm: transfer review + confirm + result (op 0 only).
 * Owns: review(vals) (validate everything, build unsigned tx + live fee),
 *   showConfirm (confirm screen, Back + Sign & Send), showResult (inclusion
 *   proof or node error text). The form, unlock gate, and route entry stay
 *   in transfer-ui.js — showForm calls TransferConfirm.review/showConfirm
 *   and passes an onBack closure (confirm never calls back into the form
 *   file: one-way dependency, form → confirm).
 * Consumes: Account.resolve/myAccountId, Chain.db/call, Tx.buildTransfer/
 *   fee/sign/broadcast, Crypto.encryptMemo, Format.parseAmount/formatAmount,
 *   Store.loadSettings (network), Wallet.keys (in-memory keys only).
 *   lookupAsset/fullAccount/utf8Hex are private verbatim copies of the
 *   transfer-ui.js originals (same per-file convention as the market-ui
 *   split) so moved bodies stay byte-identical.
 * Globals/side effects: DOM under the given wrap only; global
 *   TransferConfirm only. WIFs pass as JS values into Tx.sign/
 *   Crypto.encryptMemo — never into the DOM (no key material in
 *   textContent, value, title, or href, ever).
 * I18n.t (display strings with verbatim en defaults — batch-2a i18n;
 *   thrown codes double as indexOf routing keys, see review()).
 * Created by: building-vanilla-slices skill, slice-18 audit (transfer-ui
 *   split — review/showConfirm/row/showResult moved verbatim here;
 *   transfer-ui.js keeps form/unlock and the stable renderTransfer entry).
 *
 * Plain-memo encoding: #1's SendModal passes memo as raw UTF-8 bytes
 * (bitshares-ui/app/components/Modal/SendModal.jsx:151-153) and #3
 * normalises plain-text memo.message to UTF-8 hex
 * (wallet-extension/src/lib/bitshares-api.js:1105-1110); vanilla sends
 * {from, to, nonce:"0", message:utf8hex} so Tx.serializeMemo (hex-message
 * path, tx.js) is satisfied without inventing a new wire shape.
 * Confirm rows follow #3's op-0 table
 * (wallet-extension/src/popup/popup.js:5717-5722): From / To / Amount /
 * Memo, plus Fee and Network. Layout follows the Beet confirm-dialog survey
 * verdict (ADOPT org-survey-2026-10-03 §ADOPT-2): header context line
 * (wallet account + chain prefix + network) + one card per op (title +
 * human rows + per-card raw drill-down). No receipt-toggle (out of scope);
 * no sign-only button (follow-up — needs export UI, not trivially safe).
 * Close is fail-closed: Back never signs (see showConfirm).
 * Fee is looked up IN THE TRANSFER ASSET (feeAssetId = assetId): one asset
 * lookup, fee displays in the same symbol the user typed. Tx.fee supports
 * any fee asset; the node answers the equivalent fee.
 * Tx.broadcast returns {blockNum, trxInBlock, via} — NO txid (history rows
 * carry none, see tx.js pollHistoryForTransfer). The result screen shows
 * block # + position and does not fabricate a txid.
 */
var TransferConfirm = (function () {
  "use strict";

  /**
   * @typedef {import('../api/types.js').TFunction} TFunction
   * @typedef {import('../api/types.js').HumanAmount} HumanAmount
   * @typedef {import('../api/types.js').RawInt} RawInt
   * @typedef {import('../api/types.js').OpTuple} OpTuple
   */

  /* Batch-2a i18n: display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back
   * to the default when i18n.js failed to load: never blank, never throws.
   * vars fills %(name)s placeholders (Reference #6 shape); without I18n
   * the raw default returns unfilled — i18n.js is a local script tag,
   * absent only when the file itself is missing. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Create an element with optional text + class (textContent only — user
   * and chain strings never reach innerHTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  /* Inline error panel that is never blank: any thrown value maps to a
   * human sentence; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var err = el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) {
      msg = fallback || t("common.unknown_account", "Unknown account.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("transfer.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
    return err;
  }

  /* Status line for multi-step sends (signing → broadcasting). */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted");
    p.setAttribute("aria-live", "polite");
    wrap.appendChild(p);
    return p;
  }

  /* UTF-8 string to lowercase hex (plain-memo message path). Byte loop,
   * not money — no precision involved. */
  function utf8Hex(str) {
    var bytes = new TextEncoder().encode(str);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }

  /* Full account row (needed for the recipient memo key, which
   * Account.resolve intentionally does not return). */
  async function fullAccount(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_accounts", [[id]]);
    if (!rows || !rows[0]) throw new Error("unknown-account");
    return rows[0];
  }

  /* Symbol (trimmed, uppercased — symbols are canonical uppercase) to
   * {id, symbol, precision}. Throws "Unknown asset: X." when absent. */
  async function lookupAsset(symbol) {
    var sym = String(symbol || "").trim().toUpperCase();
    if (!sym) throw new Error(t("transfer.asset_required", "Asset symbol is required."));
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "lookup_asset_symbols", [[sym]]);
    if (!rows || !rows[0]) throw new Error(t("transfer.unknown_asset", "Unknown asset: %(sym)s.", {sym: sym}));
    if (typeof rows[0].precision !== "number") throw new Error(t("transfer.bad_asset_shape", "bad-asset-shape"));
    return { id: rows[0].id, symbol: rows[0].symbol, precision: rows[0].precision };
  }

  /** Validate everything and build the unsigned tx + live fee. Resolves a
   * confirm context; rejects with a human-readable Error. Amounts stay
   * integer strings throughout — Format.parseAmount is the only parser.
   * Thrown messages below are DISPLAY strings (they reach setFieldError /
   * showError verbatim), so each carries its t() call site — EXCEPT the
   * bare routing codes ("unknown-account", "wallet-locked"): those never
   * render raw (every showError maps them first) and transfer-ui.js routes
   * on them via msg.indexOf, so they stay byte-stable codes. When batch-2a
   * keys gain real translations, that indexOf routing must move to codes.
   * @param {any} vals
   * @returns {Promise<any>} */
  async function review(vals) {
    if (!vals.to) throw new Error(t("transfer.recipient_required", "Recipient is required."));
    var to = await Account.resolve(vals.to);
    var asset = await lookupAsset(vals.asset);
    var amountInt;
    try {
      amountInt = Format.parseAmount(vals.amount, asset.precision);
    } catch (e) {
      throw new Error(e && e.message ? e.message : t("transfer.bad_amount", "bad amount"));
    }
    if (!/[1-9]/.test(amountInt)) throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));

    var memoText = String(vals.memo || "");
    var memoObj = null;
    var memoKind = "none";
    if (memoText) {
      var toFull = await fullAccount(to.id);
      var toMemoKey = toFull && toFull.options ? toFull.options.memo_key : null;
      if (!toMemoKey) {
        throw new Error(t("transfer.no_memo_key", "Recipient %(name)s has no memo key; clear the memo to continue.", {name: to.name}));
      }
      if (vals.encrypted) {
        if (!Wallet.keys || !Wallet.keys.memo || !Wallet.keys.memo.wif) {
          throw new Error("wallet-locked");
        }
        memoObj = await /** @type {any} */ (Crypto).encryptMemo(memoText, Wallet.keys.memo.wif, toMemoKey);
        memoKind = "encrypted";
      } else {
        var fromPub = (Wallet.keys && Wallet.keys.memo && Wallet.keys.memo.pub) || "";
        memoObj = { from: fromPub, to: toMemoKey, nonce: "0", message: utf8Hex(memoText) };
        memoKind = "plain";
      }
    }

    var from = await Account.resolve(await Account.myAccountId());
    var unsigned = await Tx.buildTransfer({
      fromId: from.id,
      toId: to.id,
      amountInt: amountInt,
      assetId: asset.id,
      memoObj: memoObj
    });
    var opData = unsigned.operations[0][1];
    /* H3: a suspicious fee never auto-proceeds — it rides to the confirm
     * screen as a blocking warning behind an explicit ack gate (see
     * showConfirm). Anything else still throws here. */
    var fee = null, feeWarning = null;
    try {
      fee = await Tx.fee(0, opData, asset.id);
    } catch (feeErr) {
      if (feeErr && feeErr.message && feeErr.message.indexOf("fee-suspicious") === 0 &&
          feeErr.detail && feeErr.detail.fee) {
        fee = feeErr.detail.fee;
        feeWarning = feeErr.message;
      } else throw feeErr;
    }
    opData.fee = { amount: fee.amount, asset_id: fee.asset_id };

    var network = "mainnet";
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        network = Store.loadSettings().network;
      }
    } catch (e) { /* default stands */ }

    /* H1: chain-id prefix pinned at review time (re-checked at sign). */
    var chainPrefix = "";
    try {
      if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
        var cst = Chain.status() || {};
        if (cst.chainId) chainPrefix = String(cst.chainId).slice(0, 8).toUpperCase();
      }
    } catch (chainErr) { /* row shows unknown */ }

    return {
      to: to,
      asset: asset,
      amountInt: amountInt,
      memoText: memoText,
      memoKind: memoKind,
      unsigned: unsigned,
      fee: fee,
      feeWarning: feeWarning,
      chainPrefix: chainPrefix,
      network: network
    };
  }

  /* Confirm screen via the shared ConfirmDialog (ui/confirm.js): title +
   * named rows render as div.confirm-dialog (h3 + dl.confirm with Back
   * carrying btn-ghost + Sign & Send in div.confirm-actions). Row order
   * follows #3's op-0 table (popup.js:5717-5722): From / To / Amount /
   * Memo, plus Fee and Network. Fee rides feeHuman with the raw integer
   * in feeRawTitle (principle #6: human terms with raw in title, same
   * convention as balances); Amount keeps its raw in r[2]. The header
   * context line (wallet account + chain prefix + network), the op title +
   * pager slot (this file builds op 0 only, so 1/1), the per-card raw
   * drill-down, the H3 suspicious-fee ack gate, and the TxBuilder outlet
   * ride inside the dialog above its actions (old rows-then-notes-then-
   * buttons order, textContent-only). Back is the fail-closed close: it
   * never signs and never leaves anything pending — it only re-renders
   * the form via onBack (form-route fallback when no closure was given).
   * Back leaves via onBack (the form file's re-render closure) — this
   * file never reaches back into transfer-ui.js. */
  function showConfirm(doc, wrap, root, from, ctx, onBack) {
    var ops = (ctx.unsigned && ctx.unsigned.operations) || [];
    var pair = ops[0] || [0, {}];
    var opId = pair[0];
    var amountHuman = Format.formatAmount(ctx.amountInt, ctx.asset.precision) + " " + ctx.asset.symbol;
    var memoText;
    if (ctx.memoKind === "encrypted") memoText = t("confirm.memo_encrypted", "Encrypted");
    else if (ctx.memoKind === "plain") memoText = t("confirm.memo_plain", "Plain: %(text)s", {text: ctx.memoText});
    else memoText = t("confirm.memo_none", "(none)");
    var feeHuman = Format.formatAmount(String(ctx.fee.amount), ctx.asset.precision) + " " + ctx.asset.symbol;
    /* Fee term stays the caller's keyed string (was the Fee row term);
     * Chain row term reuses txbuilder.chain_prefix (the old literal
     * "Chain ID" is gone, same value shown) and keeps the visible prefix
     * the sign-time re-pin checks against. */
    var rows = [
      [t("confirm.from", "From"), from.name + " (" + from.id + ")"],
      [t("confirm.to", "To"), ctx.to.name + " (" + ctx.to.id + ")"],
      [t("confirm.amount", "Amount"), amountHuman, ctx.amountInt],
      [t("confirm.memo", "Memo"), memoText],
      [t("confirm.network", "Network"), ctx.network],
      [t("txbuilder.chain_prefix", "Chain: "), ctx.chainPrefix || "unknown"]
    ];
    var feeAckBox = null;
    var dlg = null;
    /* Fail-closed close: the ONLY thing Back does — it never touches
     * Tx.sign/broadcast, never resolves anything, leaves no promise
     * behind (review already settled before showConfirm ran). Closing =
     * reject: the unsigned ctx is dropped with the DOM. The form-route
     * fallback covers a missing onBack closure (previously a dead button
     * with no way out). */
    function doBack() {
      if (typeof onBack === "function") { onBack(); return; }
      try { location.hash = "#/transfer"; } catch (e) { /* no nav */ }
    }
    function doSend() {
      var btns = dlg.getElementsByTagName("button");
      var backBtn = btns[0], sendBtn = btns[1];
      /* H3: suspicious-fee transfers need the explicit acked second click. */
      if (ctx.feeWarning && !(feeAckBox && feeAckBox.checked)) {
        showError(doc, wrap,
          new Error("This fee looks unusually high — tick the acknowledgement above, then click Sign & Send again. Nothing was signed."),
          t("confirm.transfer_failed", "Transfer failed."));
        return;
      }
      /* H1: re-pin the chain at sign time — refuse if the node changed
       * under the confirm screen. */
      try {
        if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
          var nowChain = Chain.status() || {};
          var nowPrefix = nowChain.chainId ? String(nowChain.chainId).slice(0, 8).toUpperCase() : "";
          if (ctx.chainPrefix && nowPrefix && nowPrefix !== ctx.chainPrefix) {
            showError(doc, wrap,
              new Error("Chain changed while reviewing (was " + ctx.chainPrefix + ", now " + nowPrefix + "). Go back and review again."),
              t("confirm.transfer_failed", "Transfer failed."));
            return;
          }
        }
      } catch (pinErr) { /* pin best-effort; signing continues */ }
      /* Mid-sign both buttons stay disabled so the user cannot abandon
       * the promise chain into an ambiguous state from here
       * (browser-chrome navigation away still drops only the result
       * screen — a broadcast already sent cannot be unsent, same as
       * before, and nothing here auto-signs on close). */
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, wrap, t("confirm.signing", "Signing…"));
      var activeWIF = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (typeof Tx !== "undefined" && Tx && typeof Tx.wifOk === "function" ? !Tx.wifOk(activeWIF) : !activeWIF) {
        wrap.removeChild(status);
        showError(doc, wrap, new Error("wallet-locked"), t("common.wallet_locked", "Wallet is locked."));
        backBtn.disabled = false;
        return;
      }
      Promise.resolve()
        .then(function () { return Tx.signRouted(ctx.unsigned, activeWIF, {}); })
        .then(function (r) {
          status.textContent = t("common.status_broadcasting", "Broadcasting…");
          /* Extension mode: the SW already broadcast behind approval. */
          if (r.delegated) return { proof: r.proof, viaDelegated: true, signed: r.signed };
          return Tx.broadcast(r.signed).then(function (proof) {
            return { proof: proof, viaDelegated: false, signed: r.signed };
          });
        })
        .then(function (out) {
          clearRoot(root);
          showResult(doc, makeWrap(doc, root), from, ctx, null, out.proof);
        })
        .catch(function (e) {
          var msg = (e && e.message) ? e.message : t("confirm.broadcast_failed", "Broadcast failed");
          wrap.removeChild(status);
          showError(doc, wrap, msg, t("confirm.transfer_failed", "Transfer failed."));
          backBtn.disabled = false;
        });
    }
    dlg = ConfirmDialog.show({ title: t("confirm.title", "Confirm transfer"),
      rows: rows, feeHuman: feeHuman, feeTerm: t("confirm.fee", "Fee"),
      feeRawTitle: String(ctx.fee.amount),
      backLabel: t("confirm.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
      doc: doc, onBack: doBack, onSend: doSend });
    /* Stable hooks: the shared dialog owns the buttons — keep the old ids
     * so automation/tests keep finding Back + Send. The outlet appended
     * below lands third, so btns[0]/btns[1] stay Back/Send (pool-ui note). */
    try {
      var dlgBtns = dlg.getElementsByTagName("button");
      if (dlgBtns[0]) dlgBtns[0].id = "xfer-back";
      if (dlgBtns[1]) dlgBtns[1].id = "xfer-send";
    } catch (idErr) { /* ids are hooks-only */ }
    /* Slot notes above the actions (old rows-then-notes-then-buttons
     * order, textContent-only; falls back to plain append when the
     * actions row is unreachable). */
    function beforeActions(node) {
      var acts = null;
      try { acts = (dlg.querySelector) ? dlg.querySelector(".confirm-actions") : null; } catch (e) { acts = null; }
      try {
        if (acts && acts.parentNode) { acts.parentNode.insertBefore(node, acts); return; }
      } catch (e2) { /* fallback below */ }
      try { dlg.appendChild(node); } catch (e3) { /* display-only */ }
    }
    /* (1) header context line — existing keys only: confirm.from names the
     * wallet account, txbuilder.chain_prefix the chain, confirm.network
     * the network (" · " is punctuation, not a label). */
    beforeActions(el(doc, "p",
      t("confirm.from", "From") + " " + from.name + " (" + from.id + ") · " +
      t("txbuilder.chain_prefix", "Chain: ") + (ctx.chainPrefix || "unknown") + " · " +
      t("confirm.network", "Network") + " " + ctx.network, "muted"));
    /* (2) op title + pager slot: title reuses the existing op-name key,
     * the (op N) index is chain data (same "(op …)" shape as
     * txbuilder.added_body_tpl), not a new label. Pure position data
     * (multi-op pagination is a follow-up — this file builds op 0 only,
     * so this reads 1/1). */
    beforeActions(el(doc, "p",
      t("proposal.op_0", "transfer") + " (op " + opId + ") · 1/" + ops.length, "muted"));
    /* (3) per-card raw drill-down (existing .raw family; shows this
     * card's op pair — equivalent info to the old whole-operations
     * dump). */
    var detOp = doc.createElement("details");
    detOp.className = "raw";
    var sumOp = doc.createElement("summary");
    /* A11y delta 2026-10-01: empty summary showed only a triangle to sighted
     * keyboard users — visible text mirrors the aria-label (proposal-ui
     * rawJson precedent), reusing the same key so check_i18n stays green. */
    sumOp.textContent = t("confirm.op_json_label", "Show unsigned operation JSON");
    sumOp.setAttribute("aria-label", t("confirm.op_json_label", "Show unsigned operation JSON"));
    detOp.appendChild(sumOp);
    var preOp = doc.createElement("pre");
    try { preOp.textContent = JSON.stringify(pair, null, 2); }
    catch (e) { preOp.textContent = String(pair); }
    detOp.appendChild(preOp);
    beforeActions(detOp);
    /* H3: blocking suspicious-fee warning + explicit ack checkbox. The
     * Sign & Send handler above refuses to sign until the box is ticked —
     * a second, deliberate click — and nothing here ever auto-proceeds. */
    if (ctx.feeWarning) {
      var feeWarn = el(doc, "div", null, "error");
      feeWarn.setAttribute("aria-live", "assertive");
      feeWarn.textContent = ctx.feeWarning + t("confirm.fee_hint", " Check the fee before signing — tick the box and click Sign & Send again to proceed.");
      beforeActions(feeWarn);
      var ackRow = el(doc, "label", null, "xfer-field");
      feeAckBox = doc.createElement("input");
      feeAckBox.type = "checkbox";
      feeAckBox.id = "xfer-fee-ack";
      touchable(feeAckBox);
      ackRow.appendChild(feeAckBox);
      ackRow.appendChild(doc.createTextNode(t("confirm.fee_ack", " I understand this fee is unusually high.")));
      beforeActions(ackRow);
    }
    /* TxBuilder outlet (additive): queue this unsigned transfer without
     * broadcasting. One-shot Sign & Send above is untouched — this block
     * only reads ctx.unsigned.operations[0] as JS values (never into the
     * DOM) and navigates to the desk. Rides the dialog's action row so
     * Back + Sign & Send + Add to TxBuilder stay one row. */
    try {
      if (typeof TxBuilder !== "undefined" && TxBuilder && typeof TxBuilder.addOp === "function" &&
          ctx && ctx.unsigned && ctx.unsigned.operations && ctx.unsigned.operations[0]) {
        var tbAdd = touchable(el(doc, "button", t("txbuilder.add_transfer", "Add to TxBuilder")));
        tbAdd.type = "button";
        tbAdd.id = "xfer-tb-add";
        var tbPair = ctx.unsigned.operations[0];
        /* Locked-memo rule: when the encrypted-memo preview state excludes
         * the memo (locked), the queued op would silently drop the memo —
         * disable with the reason shown (same gating idiom as the form's
         * gate box), never queue a memo-less op quietly. */
        var tbLockedMemo = (ctx.memoKind === "locked-encrypted") || (ctx.lockedEnc === true) ||
          (!!ctx.memoText && !(tbPair[1] && tbPair[1].memo));
        if (tbLockedMemo) {
          tbAdd.disabled = true;
          tbAdd.title = t("txbuilder.unlock_memo_hint", "Unlock to include the encrypted memo");
        } else {
          tbAdd.addEventListener("click", function () {
            var tbFrom = (from && from.name) || String((tbPair[1] && tbPair[1].from) || "?");
            var tbTo = (ctx.to && ctx.to.name) || String((tbPair[1] && tbPair[1].to) || "?");
            var tbSrc = "transfer:" + tbFrom + "->" + tbTo;
            TxBuilder.addOp(tbPair[0], tbPair[1], tbSrc);
            try {
              if (typeof Notify !== "undefined" && Notify && typeof Notify.push === "function") {
                Notify.push("info", t("txbuilder.added_title", "Added to TxBuilder"), t("txbuilder.added_body_tpl", "%(src)s (op %(op)s) — %(n)s in queue", { src: tbSrc, op: tbPair[0], n: TxBuilder.count() }), {});
              }
            } catch (e2) { /* toast optional; the desk badge is the record */ }
            location.hash = "#/txbuilder";
          });
        }
        (function () {
          var acts = null;
          try { acts = (dlg.querySelector) ? dlg.querySelector(".confirm-actions") : null; } catch (e) { acts = null; }
          try {
            if (acts) { acts.appendChild(tbAdd); return; }
          } catch (e2) { /* fallback below */ }
          try { dlg.appendChild(tbAdd); } catch (e3) { /* outlet optional */ }
        })();
      }
    } catch (e) { /* outlet never breaks the one-shot path */ }
    wrap.appendChild(dlg);
  }

  /* Result screen: inclusion proof (block # + position) or the node error
   * text inline — never blank. Links back to the sender account page. */
  function showResult(doc, wrap, from, ctx, errText, proof) {
    wrap.appendChild(el(doc, "h1", errText ? t("confirm.failed_title", "Transfer failed") : t("confirm.sent_title", "Transfer sent")));
    if (errText) {
      showError(doc, wrap, errText, t("confirm.transfer_failed", "Transfer failed."));
    } else {
      var ok = el(doc, "p", t("confirm.included", "Included in block #%(block)s (position %(pos)s).", {block: String(proof.blockNum), pos: String(proof.trxInBlock)}), "xfer-ok");
      ok.setAttribute("aria-live", "polite");
      wrap.appendChild(ok);
      /* Slice-16 (F1d): tx-confirmed toast supplement (inline panel stays
       * primary). Guarded so a notify fault never breaks the result. */
      try {
        if (typeof NotifyHost !== "undefined" && NotifyHost &&
            typeof NotifyHost.mountToasts === "function") {
          try { NotifyHost.mountToasts(); } catch (e) { /* host best-effort */ }
        }
        if (typeof Notify !== "undefined" && Notify &&
            typeof Notify.txConfirmed === "function") {
          try { Notify.txConfirmed("block #" + String(proof.blockNum)); } catch (e) { /* silent */ }
        }
      } catch (e) { /* notify optional here */ }
      var sent = el(doc, "p",
        Format.formatAmount(ctx.amountInt, ctx.asset.precision) + " " +
        ctx.asset.symbol + " → " + ctx.to.name, "muted");
      wrap.appendChild(sent);
    }
    var link = el(doc, "a", t("confirm.view_account", "View account ") + from.name);
    link.setAttribute("href", "#/account/" + from.name);
    touchable(link);
    link.classList.add("subtle-btn");
    wrap.appendChild(link);
  }

  return {
    review: review,
    showConfirm: showConfirm
  };
})();

if (typeof module !== "undefined") { module.exports = TransferConfirm; }
