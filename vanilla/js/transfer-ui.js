/* transfer-ui.js — transfer form + unlock gate (op 0 route entry).
 *
 * What it owns: DOM for the /transfer and /transfer/:to routes (locked gate,
 * form). Review + confirm + result live in transfer-confirm.js
 * (slice-18 split — showForm calls TransferConfirm.review/showConfirm with
 * an onBack closure that rebuilds this form with preserved input).
 * No balances, no history, no other ops.
 * Consumes: Wallet.isUnlocked/unlock/keys (in-memory keys only),
 * Account.resolve/myAccountId, Tx.fee/buildTransfer/sign/broadcast,
 * Crypto.encryptMemo, Format.parseAmount/formatAmount, Chain.db/call/status,
 * Store.loadSettings (network → core-asset default) + Store.subscribe
 * (connect wait, same pattern as account-ui.js).
 * Globals/side effects: DOM under the router root, global TransferUI only.
 * WIFs pass as JS values into Tx.sign/Crypto.encryptMemo — never into the
 * DOM (no key material in textContent, value, title, or href, ever).
 * Created by: building-vanilla-slices skill, slice-04-transfer plan Task 4.
 *
 * Plain-memo encoding: #1's SendModal passes memo as raw UTF-8 bytes
 * (bitshares-ui/app/components/Modal/SendModal.jsx:151-153) and #3
 * normalises plain-text memo.message to UTF-8 hex
 * (wallet-extension/src/lib/bitshares-api.js:1105-1110); vanilla sends
 * {from, to, nonce:"0", message:utf8hex} so Tx.serializeMemo (hex-message
 * path, tx.js) is satisfied without inventing a new wire shape.
 * Confirm rows follow #3's op-0 table
 * (wallet-extension/src/popup/popup.js:5717-5722): From / To / Amount /
 * Memo, plus Fee and Network (plan Task 4 spec).
 * Fee is looked up IN THE TRANSFER ASSET (feeAssetId = assetId): one asset
 * lookup, fee displays in the same symbol the user typed. Tx.fee supports
 * any fee asset; the node answers the equivalent fee.
 * Tx.broadcast returns {blockNum, trxInBlock, via} — NO txid (history rows
 * carry none, see tx.js pollHistoryForTransfer). The result screen shows
 * block # + position and does not fabricate a txid.
 */
var TransferUI = (function () {
  "use strict";

  /* Core symbol default by network (Store is the sole settings owner). */
  function coreSymbol() {
    try {
      if (typeof Store !== "undefined" && Store &&
          typeof Store.loadSettings === "function" &&
          Store.loadSettings().network === "testnet") {
        return "TEST";
      }
    } catch (e) { /* fall through to BTS */ }
    return "BTS";
  }

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

  /* UTF-8 memo hex + account/asset lookups moved verbatim to
   * transfer-confirm.js (review side) — private copies there. */

  /* Labeled text input row. Returns {row, input}. */
  function fieldRow(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field");
    var label = el(doc, "label", labelText + " ");
    var input;
    if (opts.textarea) {
      input = doc.createElement("textarea");
      input.rows = 2;
    } else {
      input = doc.createElement("input");
      input.type = opts.type || "text";
      if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
      if (opts.autocomplete) input.setAttribute("autocomplete", opts.autocomplete);
    }
    if (opts.id) input.id = opts.id;
    if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
    if (opts.readonly) input.setAttribute("readonly", "readonly");
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    touchable(input);
    label.appendChild(input);
    row.appendChild(label);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite");
    err.style.display = "none";
    row.appendChild(err);
    return { row: row, input: input, err: err };
  }

  function setFieldError(f, msg) {
    if (!msg) {
      f.err.textContent = "";
      f.err.style.display = "none";
      return;
    }
    f.err.textContent = msg;
    f.err.style.display = "";
  }

  /* Unlock gate with return path: after a successful unlock the caller
   * re-renders this same route (same pattern as /account/me). */
  function renderUnlockPrompt(doc, wrap, root, prefillTo) {
    wrap.appendChild(el(doc, "h1", "Transfer"));
    wrap.appendChild(el(doc, "p",
      "Wallet is locked. Enter your password to send a transfer.", "muted"));
    var f = fieldRow(doc, "Password ", { id: "xfer-unlock-password", type: "password", autocomplete: "current-password" });
    wrap.appendChild(f.row);
    var btn = touchable(el(doc, "button", "Unlock"));
    btn.id = "xfer-unlock-do";
    btn.type = "button";
    wrap.appendChild(btn);
    var errBox = el(doc, "div", null, "error");
    errBox.setAttribute("aria-live", "polite");
    wrap.appendChild(errBox);
    btn.addEventListener("click", function () {
      errBox.textContent = "";
      btn.disabled = true;
      Promise.resolve()
        .then(function () { return Wallet.unlock(f.input.value); })
        .then(function () { renderTransfer(root, prefillTo); })
        .catch(function (e) {
          btn.disabled = false;
          errBox.textContent = (e && e.message) ? e.message : String(e || "Unlock failed");
        });
    });
  }

  /* hashQuery(): ?asset= / ?memo= prefill for gateway withdraw delegation
   * (slice-15) — parsed from location.hash, plain decode, no deps. A query
   * memo forces plaintext (gateways cannot read encrypted memos). */
  function hashQuery() {
    var out = {};
    try {
      var h = (typeof location !== "undefined" && location.hash) || "";
      var q = h.indexOf("?");
      if (q === -1) return out;
      h.slice(q + 1).split("&").forEach(function (kv) {
        var i = kv.indexOf("="); if (i === -1) return;
        out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
    } catch (e) { /* malformed query: prefill empty */ }
    return out;
  }
  function renderTransfer(root, prefillTo) {
    /* Shared-socket wait (deep links land before boot connects), then gates on
     * unlock, resolves the sender, and shows the form. */
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Tx === "undefined" || !Tx ||
        typeof Account === "undefined" || !Account ||
        typeof Wallet === "undefined" || !Wallet ||
        typeof Format === "undefined" || !Format ||
        typeof TransferConfirm === "undefined" || !TransferConfirm) {
      showError(doc, wrap, "Transfer backend missing: js/tx.js, js/account.js, js/wallet.js, js/format.js or js/transfer-confirm.js failed to load.");
      return;
    }

    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", "Connecting to network…", "muted"));
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) {
            renderTransfer(root, prefillTo);
          }
        }
      });
      var timer = setTimeout(function () {
        if (settled) return; settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        clearRoot(root);
        showError(doc, makeWrap(doc, root), new Error("not connected"), "Network unavailable.");
      }, 15000);
      return;
    }

    if (typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked()) {
      renderUnlockPrompt(doc, wrap, root, prefillTo);
      return;
    }

    wrap.appendChild(el(doc, "p", "Loading…", "muted"));
    Account.myAccountId().then(function (id) {
      return Account.resolve(id);
    }).then(function (from) {
      clearRoot(root);
      var q = hashQuery();
      showForm(doc, makeWrap(doc, root), root, from, {
        to: typeof prefillTo === "string" ? prefillTo : "",
        asset: q.asset || coreSymbol(),
        amount: "",
        memo: q.memo || "",
        encrypted: !q.memo,
        error: null
      });
    }).catch(function (e) {
      clearRoot(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(el(doc, "h1", "Transfer"));
      showError(doc, failed, e, "Could not load your account.");
    });
  }

  /* Transfer form. From is read-only text (name + id); To / Asset / Amount
   * / Memo are inputs; Encrypted defaults ON. Errors stay inline above a
   * preserved form — input is never wiped by a failed review. */
  function showForm(doc, wrap, root, from, state) {
    wrap.appendChild(el(doc, "h1", "Transfer"));
    var fromLine = el(doc, "p", null, "muted");
    fromLine.textContent = "From: " + from.name + " (" + from.id + ")";
    wrap.appendChild(fromLine);

    if (state.error) showError(doc, wrap, state.error, "Could not prepare the transfer.");

    var toF = fieldRow(doc, "To (name or 1.2.N) ", {
      id: "xfer-to", value: state.to, placeholder: "recipient", autocomplete: "off"
    });
    wrap.appendChild(toF.row);
    /* Non-blocking blur check: warns early, submit still decides. */
    toF.input.addEventListener("blur", function () {
      var v = toF.input.value.trim();
      if (!v) { setFieldError(toF, ""); return; }
      Account.resolve(v).then(function () {
        if (document.activeElement !== toF.input) setFieldError(toF, "");
      }).catch(function () {
        setFieldError(toF, "Unknown account: " + v + ".");
      });
    });

    var assetF = fieldRow(doc, "Asset ", {
      id: "xfer-asset", value: state.asset, placeholder: coreSymbol(), autocomplete: "off"
    });
    wrap.appendChild(assetF.row);

    var amountF = fieldRow(doc, "Amount ", {
      id: "xfer-amount", value: state.amount, placeholder: "0.00", inputmode: "decimal", autocomplete: "off"
    });
    wrap.appendChild(amountF.row);

    var memoF = fieldRow(doc, "Memo (optional) ", {
      id: "xfer-memo", value: state.memo, textarea: true
    });
    wrap.appendChild(memoF.row);

    var encRow = el(doc, "div", null, "xfer-field");
    var encLabel = el(doc, "label", "Encrypted memo ");
    var encBox = doc.createElement("input");
    encBox.type = "checkbox";
    encBox.id = "xfer-encrypted";
    encBox.checked = !!state.encrypted;
    touchable(encBox);
    encLabel.appendChild(encBox);
    encRow.appendChild(encLabel);
    wrap.appendChild(encRow);

    var reviewBtn = touchable(el(doc, "button", "Review transfer"));
    reviewBtn.id = "xfer-review";
    reviewBtn.type = "button";
    wrap.appendChild(reviewBtn);

    reviewBtn.addEventListener("click", function () {
      setFieldError(toF, "");
      setFieldError(assetF, "");
      setFieldError(amountF, "");
      reviewBtn.disabled = true;
      var status = showStatus(doc, wrap, "Checking recipient, asset, and fee…");
      TransferConfirm.review({
        to: toF.input.value.trim(),
        asset: assetF.input.value,
        amount: amountF.input.value,
        memo: memoF.input.value,
        encrypted: encBox.checked
      }).then(function (ctx) {
        clearRoot(root);
        TransferConfirm.showConfirm(doc, makeWrap(doc, root), root, from, ctx, function () {
          clearRoot(root);
          showForm(doc, makeWrap(doc, root), root, from, {
            to: ctx.to.name,
            asset: ctx.asset.symbol,
            amount: Format.formatAmount(ctx.amountInt, ctx.asset.precision),
            memo: ctx.memoText,
            encrypted: ctx.memoKind !== "plain",
            error: null
          });
        });
      }).catch(function (e) {
        var msg = (e && e.message) ? e.message : String(e || "Could not prepare the transfer.");
        if (msg.indexOf("unknown-account") !== -1) {
          setFieldError(toF, "Unknown account.");
        } else if (msg.indexOf("Unknown asset") === 0 || msg.indexOf("bad-asset-shape") !== -1) {
          setFieldError(assetF, msg);
        } else if (msg.indexOf("bad amount") === 0 || msg.indexOf("too many decimals") === 0 ||
                   msg.indexOf("Amount must be") === 0) {
          setFieldError(amountF, msg);
        }
        wrap.removeChild(status);
        clearRoot(root);
        showForm(doc, makeWrap(doc, root), root, from, {
          to: toF.input.value,
          asset: assetF.input.value,
          amount: amountF.input.value,
          memo: memoF.input.value,
          encrypted: encBox.checked,
          error: msg
        });
      });
    });
  }

  /* review/showConfirm/showResult moved verbatim to transfer-confirm.js
   * (confirm side) — called above as TransferConfirm.*. */

  return {
    renderTransfer: renderTransfer
  };
})();

if (typeof module !== "undefined") { module.exports = TransferUI; }
