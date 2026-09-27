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
 * Memo, plus Fee and Network.
 * Fee is looked up IN THE TRANSFER ASSET (feeAssetId = assetId): one asset
 * lookup, fee displays in the same symbol the user typed. Tx.fee supports
 * any fee asset; the node answers the equivalent fee.
 * Tx.broadcast returns {blockNum, trxInBlock, via} — NO txid (history rows
 * carry none, see tx.js pollHistoryForTransfer). The result screen shows
 * block # + position and does not fabricate a txid.
 */
var TransferConfirm = (function () {
  "use strict";

  /* Create an element with optional text + class (textContent only — user
   * and chain strings never reach innerHTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch target floor (principle #7): every interactive element is ≥44px
   * in at least one dimension. Inline style keeps this view self-contained. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
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
      : String(e || fallback || "Unexpected error");
    if (msg.indexOf("unknown-account") !== -1) {
      msg = fallback || "Unknown account.";
    } else if (msg.indexOf("no-account") !== -1) {
      msg = "No on-chain account found for the wallet's active key.";
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = "Wallet is locked.";
    } else if (msg.indexOf("not connected") !== -1) {
      msg = "Network unavailable. Check Settings → Nodes and retry.";
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
    if (!sym) throw new Error("Asset symbol is required.");
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "lookup_asset_symbols", [[sym]]);
    if (!rows || !rows[0]) throw new Error("Unknown asset: " + sym + ".");
    if (typeof rows[0].precision !== "number") throw new Error("bad-asset-shape");
    return { id: rows[0].id, symbol: rows[0].symbol, precision: rows[0].precision };
  }

  /* Validate everything and build the unsigned tx + live fee. Resolves a
   * confirm context; rejects with a human-readable Error. Amounts stay
   * integer strings throughout — Format.parseAmount is the only parser. */
  async function review(vals) {
    if (!vals.to) throw new Error("Recipient is required.");
    var to = await Account.resolve(vals.to);
    var asset = await lookupAsset(vals.asset);
    var amountInt;
    try {
      amountInt = Format.parseAmount(vals.amount, asset.precision);
    } catch (e) {
      throw new Error(e && e.message ? e.message : "bad amount");
    }
    if (!/[1-9]/.test(amountInt)) throw new Error("Amount must be greater than zero.");

    var memoText = String(vals.memo || "");
    var memoObj = null;
    var memoKind = "none";
    if (memoText) {
      var toFull = await fullAccount(to.id);
      var toMemoKey = toFull && toFull.options ? toFull.options.memo_key : null;
      if (!toMemoKey) {
        throw new Error("Recipient " + to.name + " has no memo key; clear the memo to continue.");
      }
      if (vals.encrypted) {
        if (!Wallet.keys || !Wallet.keys.memo || !Wallet.keys.memo.wif) {
          throw new Error("wallet-locked");
        }
        memoObj = await Crypto.encryptMemo(memoText, Wallet.keys.memo.wif, toMemoKey);
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
    var fee = await Tx.fee(0, opData, asset.id);
    opData.fee = { amount: fee.amount, asset_id: fee.asset_id };

    var network = "mainnet";
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        network = Store.loadSettings().network;
      }
    } catch (e) { /* default stands */ }

    return {
      to: to,
      asset: asset,
      amountInt: amountInt,
      memoText: memoText,
      memoKind: memoKind,
      unsigned: unsigned,
      fee: fee,
      network: network
    };
  }

  /* Confirm screen. Row order follows #3's op-0 table (popup.js:5717-5722):
   * From / To / Amount / Memo, plus Fee and Network. Fee shows the human
   * amount with the raw integer in title (same convention as balances).
   * Back leaves via onBack (the form file's re-render closure) — this file
   * never reaches back into transfer-ui.js. */
  function showConfirm(doc, wrap, root, from, ctx, onBack) {
    wrap.appendChild(el(doc, "h1", "Confirm transfer"));
    var list = el(doc, "dl", null, "xfer-confirm");

    function row(term, text, title) {
      var dt = el(doc, "dt", term);
      var dd = el(doc, "dd", text);
      if (title) dd.title = title;
      list.appendChild(dt);
      list.appendChild(dd);
    }

    row("From", from.name + " (" + from.id + ")");
    row("To", ctx.to.name + " (" + ctx.to.id + ")");
    var amountHuman = Format.formatAmount(ctx.amountInt, ctx.asset.precision) + " " + ctx.asset.symbol;
    row("Amount", amountHuman, ctx.amountInt);
    if (ctx.memoKind === "encrypted") row("Memo", "Encrypted");
    else if (ctx.memoKind === "plain") row("Memo", "Plain: " + ctx.memoText);
    else row("Memo", "(none)");
    var feeHuman = Format.formatAmount(String(ctx.fee.amount), ctx.asset.precision) + " " + ctx.asset.symbol;
    row("Fee", feeHuman, String(ctx.fee.amount));
    row("Network", ctx.network);

    wrap.appendChild(list);

    /* The exact operation about to be signed (no secrets: unsigned, fee
     * filled). Review bytes before Sign & Send. */
    var detOp = doc.createElement("details");
    detOp.className = "raw";
    var sumOp = doc.createElement("summary");
    sumOp.setAttribute("aria-label", "Show unsigned operation JSON");
    detOp.appendChild(sumOp);
    var preOp = doc.createElement("pre");
    try { preOp.textContent = JSON.stringify(ctx.unsigned.operations, null, 2); }
    catch (e) { preOp.textContent = String(ctx.unsigned && ctx.unsigned.operations); }
    detOp.appendChild(preOp);
    wrap.appendChild(detOp);

    var backBtn = touchable(el(doc, "button", "Back"));
    backBtn.id = "xfer-back";
    backBtn.type = "button";
    wrap.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", "Sign & Send"));
    sendBtn.id = "xfer-send";
    sendBtn.type = "button";
    wrap.appendChild(sendBtn);

    backBtn.addEventListener("click", function () {
      if (typeof onBack === "function") onBack();
    });

    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, wrap, "Signing…");
      var activeWIF = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!activeWIF) {
        wrap.removeChild(status);
        showError(doc, wrap, new Error("wallet-locked"), "Wallet is locked.");
        backBtn.disabled = false;
        return;
      }
      Promise.resolve()
        .then(function () { return Tx.sign(ctx.unsigned, activeWIF); })
        .then(function (signed) {
          status.textContent = "Broadcasting…";
          return Tx.broadcast(signed);
        })
        .then(function (proof) {
          clearRoot(root);
          showResult(doc, makeWrap(doc, root), from, ctx, null, proof);
        })
        .catch(function (e) {
          var msg = (e && e.message) ? e.message : String(e || "Broadcast failed");
          wrap.removeChild(status);
          showError(doc, wrap, msg, "Transfer failed.");
          backBtn.disabled = false;
        });
    });
  }

  /* Result screen: inclusion proof (block # + position) or the node error
   * text inline — never blank. Links back to the sender account page. */
  function showResult(doc, wrap, from, ctx, errText, proof) {
    wrap.appendChild(el(doc, "h1", errText ? "Transfer failed" : "Transfer sent"));
    if (errText) {
      showError(doc, wrap, errText, "Transfer failed.");
    } else {
      var ok = el(doc, "p", "Included in block #" + String(proof.blockNum) +
        " (position " + String(proof.trxInBlock) + ").", "xfer-ok");
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
    var link = el(doc, "a", "View account " + from.name);
    link.setAttribute("href", "#/account/" + from.name);
    touchable(link);
    wrap.appendChild(link);
  }

  return {
    review: review,
    showConfirm: showConfirm
  };
})();

if (typeof module !== "undefined") { module.exports = TransferConfirm; }
