/* transfer-ui.js — transfer form → confirm → result (op 0 only).
 *
 * What it owns: DOM for the /transfer and /transfer/:to routes (locked gate,
 * form, confirm, result). No balances, no history, no other ops.
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
        typeof Format === "undefined" || !Format) {
      showError(doc, wrap, "Transfer backend missing: js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load.");
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
      review({
        to: toF.input.value.trim(),
        asset: assetF.input.value,
        amount: amountF.input.value,
        memo: memoF.input.value,
        encrypted: encBox.checked
      }).then(function (ctx) {
        clearRoot(root);
        showConfirm(doc, makeWrap(doc, root), root, from, ctx);
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
   * amount with the raw integer in title (same convention as balances). */
  function showConfirm(doc, wrap, root, from, ctx) {
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
    renderTransfer: renderTransfer
  };
})();

if (typeof module !== "undefined") { module.exports = TransferUI; }
