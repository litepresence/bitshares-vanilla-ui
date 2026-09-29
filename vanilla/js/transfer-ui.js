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
 * I18n.t (display strings with verbatim en defaults — batch-2a i18n).
 * Globals/side effects: DOM under the router root, global TransferUI only.
 * WIFs pass as JS values into Tx.sign/Crypto.encryptMemo — never into the
 * DOM (no key material in textContent, value, title, or href, ever).
  * Created by: building-vanilla-slices skill, slice-04-transfer plan Task 4.
  *
  * PUBLIC-FIRST (gate repair): no wallet gate — the whole form renders locked
  *   with From editable (defaults to the wallet account, else committee-account
  *   1.2.0 with a viewing notice). Locked reviews preview read-only via a local
  *   builder (transfer-confirm.js is out of scope, so lookup/fee steps are
  *   replicated here verbatim); password is asked only at Sign & Send.
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
 * Fee asset selector (punchlist-2026-09-29 HIGH+MEDs): the form offers the
 * transfer asset plus the sender's non-zero balance assets when unlocked
 * (transfer asset alone when locked) and quotes get_required_fees in the
 * chosen asset — Tx.fee answers any asset the chain allows. The default
 * stays the transfer asset, so the default path is unchanged. The locked
 * preview looks the fee up AND displays it in the chosen asset (correct
 * precision/symbol — owned here). The unlocked Review delegates charging
 * to TransferConfirm.review, which settles feeAssetId = transfer asset id
 * today: the choice travels in the review vals as feeAsset (forward-compat
 * hook) with an inline note naming the settling asset, and full
 * pay-threading is the confirm-file follow-up below — a fee is never
 * charged in a mislabeled asset.
 * Asset dropdown (HIGH): unlocked restricts the asset to the sender's
 * non-zero balances (SendModal.jsx:288-304 concept); locked keeps the
 * free-text input, balances-load failure keeps it too (the form never
 * blocks), the ?asset= prefill survives via union, and the unknown-asset
 * review catch is kept for every path.
 * Available balance (MED): "Current balance: X SYM" click-fills the max
 * amount (SendModal.jsx:458-484 concept, same dotted-underline affordance).
 * Same-asset fees subtract best-effort (exact op shape with memo when the
 * recipient and memo key resolve, memo-less shape otherwise; the fill
 * itself never fails — the confirm always shows the exact fee).
 * Review gating (SendModal.jsx:496-509 concept): the button stays disabled
 * until from+to+amount+asset are present and syntactically valid with
 * from != to (case-insensitive; id-level equality re-checks at review).
 * Every disabled state lists its reasons inline — honest, never silent.
 * DEFERRED (same punchlist page): Send/Propose toggle (SendModal.jsx:551-564
 * concept — propose-as-another-account lands with the proposal slice) and
 * the known-scammer recipient flag (AccountSelector.jsx:592,709 concept —
 * lands with the auth/contacts slice). Recorded here so neither is lost.
 * Pending-i18n plain strings (3 — the next locales batch moves them to
 * transfer.* with matching defaults; check_i18n scans t() calls only, so
 * it stays green meanwhile): "Sender is required.",
 * "Sender and recipient must be different.",
 * "Confirm settles the fee in " + SYM + ".".
 * Tx.fee supports any fee asset; the node answers the equivalent fee.
 * Tx.broadcast returns {blockNum, trxInBlock, via} — NO txid (history rows
 * carry none, see tx.js pollHistoryForTransfer). The result screen shows
 * block # + position and does not fabricate a txid.
 */
var TransferUI = (function () {
  "use strict";

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
      : String(e || fallback || t("transfer.err_unexpected", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) {
      msg = fallback || t("transfer.unknown_account", "Unknown account.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("transfer.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("transfer.err_locked", "Wallet is locked.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("transfer.err_network", "Network unavailable. Check Settings → Nodes and retry.");
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
    /* Shared-socket wait (deep links land before boot connects), then show
     * the form immediately — PUBLIC-FIRST, no unlock gate. The sender
     * resolves to the wallet account when unlocked, else committee-account
     * 1.2.0 (public chain object, verified live 2026-09-28). */
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
      showError(doc, wrap, t("transfer.backend_missing", "Transfer backend missing: js/tx.js, js/account.js, js/wallet.js, js/format.js or js/transfer-confirm.js failed to load."));
      return;
    }

    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", t("transfer.connecting", "Connecting to network…"), "muted"));
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
        showError(doc, makeWrap(doc, root), new Error("not connected"), t("transfer.network_unavailable_short", "Network unavailable."));
      }, 15000);
      return;
    }

    wrap.appendChild(el(doc, "p", t("transfer.loading", "Loading…"), "muted"));
    Account.myAccountId().catch(function () { return "1.2.0"; }).then(function (id) {
      return Account.resolve(id).catch(function () { return { id: "1.2.0", name: "committee-account" }; });
    }).then(function (from) {
      clearRoot(root);
      var q = hashQuery();
      showForm(doc, makeWrap(doc, root), root, from, {
        from: from.name,
        to: typeof prefillTo === "string" ? prefillTo : "",
        asset: q.asset || coreSymbol(),
        amount: "",
        memo: q.memo || "",
        encrypted: !q.memo,
        feeAsset: null,
        error: null
      });
    }).catch(function (e) {
      clearRoot(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(el(doc, "h1", t("transfer.title", "Transfer")));
      showError(doc, failed, e, t("transfer.load_account_failed", "Could not load your account."));
    });
  }

  /* Transfer form. From is an EDITABLE account input (defaults to the wallet
   * account, else committee-account 1.2.0 while locked); To / Asset / Amount
   * / Memo are inputs; Encrypted defaults ON. Unlocked reviews require From
   * to equal the wallet account (review signs as the wallet). Locked reviews
   * preview read-only below the form; password is asked only at Sign & Send.
   * Errors stay inline above a preserved form — input is never wiped. */
  function showForm(doc, wrap, root, from, state) {
    var locked = (typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked());
    wrap.appendChild(el(doc, "h1", t("transfer.title", "Transfer")));
    if (locked) {
      wrap.appendChild(el(doc, "p",
        t("transfer.viewing_as_committee", "Viewing as committee-account (1.2.0) — public data visible while locked; password is asked only at signing."), "muted"));
    }

    if (state.error) showError(doc, wrap, state.error, t("transfer.prepare_failed", "Could not prepare the transfer."));

    var fromF = fieldRow(doc, t("transfer.from_label", "From (name or 1.2.N) "), {
      id: "xfer-from", value: state.from || from.name, placeholder: t("transfer.from_placeholder", "sender"), autocomplete: "off"
    });
    wrap.appendChild(fromF.row);
    /* Non-blocking blur check: warns early, submit still decides. */
    fromF.input.addEventListener("blur", function () {
      var v = fromF.input.value.trim();
      if (!v) { setFieldError(fromF, ""); return; }
      Account.resolve(v).then(function () {
        if (document.activeElement !== fromF.input) setFieldError(fromF, "");
      }).catch(function () {
        setFieldError(fromF, t("transfer.unknown_account_name", "Unknown account: %(name)s.", {name: v}));
      });
      /* Sender changed while unlocked: reload their balances so the asset
       * dropdown, fee options, and available line follow the new sender. */
      if (!locked && v !== balWho) loadBalancesForSender();
    });

    var toF = fieldRow(doc, t("transfer.to_label", "To (name or 1.2.N) "), {
      id: "xfer-to", value: state.to, placeholder: t("transfer.to_placeholder", "recipient"), autocomplete: "off"
    });
    wrap.appendChild(toF.row);
    /* LOW punchlist: known-scammer flag (AccountSelector concept). No scam
     * registry is vendored, so this stays an honest hint, not a verdict. */
    wrap.appendChild(el(doc, "p", "No scam list is loaded here — double-check the recipient name before reviewing.", "muted"));
    /* Non-blocking blur check: warns early, submit still decides. */
    toF.input.addEventListener("blur", function () {
      var v = toF.input.value.trim();
      if (!v) { setFieldError(toF, ""); return; }
      Account.resolve(v).then(function () {
        if (document.activeElement !== toF.input) setFieldError(toF, "");
      }).catch(function () {
        setFieldError(toF, t("transfer.unknown_account_name", "Unknown account: %(name)s.", {name: v}));
      });
    });

    /* Asset field (punchlist HIGH). assetF.input is SWAPPABLE: unlocked it
     * becomes a <select> restricted to the sender's non-zero balances once
     * they load (free-text fallback when locked or when the load fails, so
     * the form never blocks). Every reader below uses assetF.input at event
     * time, never a cached node. */
    var assetF = fieldRow(doc, t("transfer.asset_label", "Asset "), {
      id: "xfer-asset", value: state.asset, placeholder: coreSymbol(), autocomplete: "off"
    });
    wrap.appendChild(assetF.row);

    /* Available balance (punchlist MED): a click-to-fill button when the
     * selected asset has a known sender balance (unlocked only), a status
     * line while loading or when the load failed, empty otherwise. */
    var availBox = el(doc, "div", null, "xfer-avail");
    wrap.appendChild(availBox);

    var amountF = fieldRow(doc, t("transfer.amount_label", "Amount "), {
      id: "xfer-amount", value: state.amount, placeholder: "0.00", inputmode: "decimal", autocomplete: "off"
    });
    wrap.appendChild(amountF.row);

    var memoF = fieldRow(doc, t("transfer.memo_label", "Memo (optional) "), {
      id: "xfer-memo", value: state.memo, textarea: true
    });
    wrap.appendChild(memoF.row);

    var encRow = el(doc, "div", null, "xfer-field");
    var encLabel = el(doc, "label", t("transfer.encrypted_label", "Encrypted memo "));
    var encBox = doc.createElement("input");
    encBox.type = "checkbox";
    encBox.id = "xfer-encrypted";
    encBox.checked = !!state.encrypted;
    touchable(encBox);
    encLabel.appendChild(encBox);
    encRow.appendChild(encLabel);
    wrap.appendChild(encRow);

    /* Fee asset (punchlist MED): the transfer asset plus the sender's
     * non-zero balances when unlocked, the transfer asset alone when
     * locked. The choice follows the transfer asset until touched. */
    var feeRow = el(doc, "div", null, "xfer-field");
    var feeLabel = el(doc, "label", t("confirm.fee", "Fee") + " ");
    var feeSel = doc.createElement("select");
    feeSel.id = "xfer-fee-asset";
    touchable(feeSel);
    feeLabel.appendChild(feeSel);
    feeRow.appendChild(feeLabel);
    wrap.appendChild(feeRow);
    /* Equivalent-fee quote in an alternate fee asset (unlocked only, hidden
     * otherwise and on any lookup failure — the confirm stays the source
     * of truth; a missing quote is never a wrong number). */
    var feeQuote = el(doc, "div", "", "muted");
    feeQuote.setAttribute("aria-live", "polite");
    wrap.appendChild(feeQuote);

    var reviewBtn = touchable(el(doc, "button", t("transfer.review", "Review transfer")));
    reviewBtn.id = "xfer-review";
    reviewBtn.type = "button";
    reviewBtn.disabled = true; /* gating owns this from here on */
    wrap.appendChild(reviewBtn);
    /* Gating reasons: every disabled state names its reasons inline
     * (honest, never silent). Empty when the form is submittable. */
    var gateBox = el(doc, "div", null, "xfer-gate");
    gateBox.setAttribute("aria-live", "polite");
    wrap.appendChild(gateBox);
    var previewBox = el(doc, "div", null, "xfer-out");
    wrap.appendChild(previewBox);

    /* Sender balances cache (unlocked only) in Account.balances shape,
     * non-zero raw amounts only. bySym maps uppercased symbol to entry.
     * feeSym is the fee selector choice; feeTouched stops the transfer
     * asset from clobbering a deliberate pick on rebuilds. */
    var bals = [];
    var bySym = {};
    var feeSym = String(state.feeAsset || state.asset || coreSymbol()).trim().toUpperCase();
    var feeTouched = !!state.feeAsset;
    var balWho = null;
    var balsState = locked ? "locked" : "loading"; /* loading|ready|failed|locked */

    /* Live asset value across the input/select swap (never cached). */
    function assetVal() {
      return String((assetF.input && assetF.input.value) || "").trim();
    }

    function findBal(sym) {
      var s = String(sym || "").trim().toUpperCase();
      if (!s) return null;
      return bySym[s] || null;
    }

    /* Rebuild the fee selector: transfer asset first (the kept default),
     * then sender balances. Preserves a deliberate choice, otherwise
     * follows the transfer asset. */
    function refreshFeeOpts() {
      var tSym = assetVal().toUpperCase() || feeSym;
      if (!feeTouched) feeSym = tSym;
      var seen = {};
      var opts = [];
      function push(sym) {
        var s = String(sym || "").trim().toUpperCase();
        if (!s || seen[s]) return;
        seen[s] = 1;
        opts.push(s);
      }
      push(tSym);
      push(feeSym);
      for (var i = 0; i < bals.length; i++) push(bals[i].symbol);
      while (feeSel.firstChild) feeSel.removeChild(feeSel.firstChild);
      for (var k = 0; k < opts.length; k++) {
        var o = doc.createElement("option");
        o.value = opts[k];
        o.textContent = opts[k];
        if (opts[k] === feeSym) o.selected = true;
        feeSel.appendChild(o);
      }
      refreshFeeQuote();
    }

    /* Available-balance line: click-to-fill button on a balance hit,
     * loading/failed text while unresolved, empty when locked or when the
     * selected asset is not a sender balance. */
    function refreshAvail() {
      while (availBox.firstChild) availBox.removeChild(availBox.firstChild);
      if (locked) return;
      if (balsState === "loading") {
        availBox.appendChild(el(doc, "span", t("account.loading_balances", "Loading balances…"), "muted"));
        return;
      }
      if (balsState === "failed") {
        availBox.appendChild(el(doc, "span", t("account.load_balances_failed", "Could not load balances."), "muted"));
        return;
      }
      var b = findBal(assetVal());
      if (!b) return;
      var btn = el(doc, "button", t("credit.current_balance", "Current balance") + ": " + b.display + " " + b.symbol);
      btn.type = "button";
      btn.id = "xfer-max";
      btn.style.borderBottom = "#A09F9F 1px dotted"; /* SendModal affordance */
      btn.style.cursor = "pointer";
      touchable(btn);
      btn.addEventListener("click", function () { fillMax(b); });
      availBox.appendChild(btn);
    }

    /* Click-to-fill the max amount (SendModal._setTotal concept): the full
     * balance lands immediately; when the fee is paid in the same asset the
     * quoted fee subtracts best-effort (exact op shape with memo when the
     * recipient and memo key resolve, memo-less shape otherwise). Any
     * lookup failure keeps the full balance — the confirm always shows the
     * exact fee, so a quote never blocks the fill. Integer strings only. */
    function fillMax(b) {
      amountF.input.value = b.display;
      updateGate();
      if (locked) return;
      if (feeSym !== String(b.symbol).toUpperCase()) return;
      var stamp = b.display;
      Promise.resolve().then(async function () {
        var wid = await Account.myAccountId();
        var toId = wid;
        try { toId = (await Account.resolve(toF.input.value.trim())).id; } catch (e) { /* self shape */ }
        var amountInt = Format.parseAmount(b.display, b.precision);
        var memoObj = null;
        var memoText = String(memoF.input.value || "");
        if (memoText) {
          var toFull = await fullAccountLocal(toId);
          var memoKey = toFull && toFull.options ? toFull.options.memo_key : null;
          if (!memoKey) throw new Error("no-memo-key");
          if (encBox.checked) {
            if (!Wallet.keys || !Wallet.keys.memo || !Wallet.keys.memo.wif) throw new Error("wallet-locked");
            if (typeof Crypto === "undefined" || !Crypto.encryptMemo) throw new Error("no-crypto");
            memoObj = await Crypto.encryptMemo(memoText, Wallet.keys.memo.wif, memoKey);
          } else {
            memoObj = { from: "", to: memoKey, nonce: "0", message: utf8HexLocal(memoText) };
          }
        }
        var unsigned = await Tx.buildTransfer({
          fromId: wid, toId: toId, amountInt: amountInt, assetId: b.asset_id, memoObj: memoObj
        });
        var fee = await Tx.fee(0, unsigned.operations[0][1], b.asset_id);
        var diff = BigInt(amountInt) - BigInt(String(fee.amount));
        if (diff <= 0n) return;
        if (amountF.input.value !== stamp) return; /* user typed meanwhile */
        amountF.input.value = Format.formatAmount(diff.toString(), b.precision);
        updateGate();
      }).catch(function () { /* best-effort: the full balance stands */ });
    }

    /* Equivalent-fee quote in an alternate fee asset (unlocked, alternate
     * only — the default path shows nothing new). Memo-less shape: the
     * recipient and memo keys may not resolve yet, so this is a QUOTE and
     * the confirm settles the exact fee in the transfer asset (named in
     * the note). Hidden on any failure. */
    function refreshFeeQuote() {
      while (feeQuote.firstChild) feeQuote.removeChild(feeQuote.firstChild);
      if (locked) return;
      var tSym = assetVal().toUpperCase();
      if (!feeSym || feeSym === tSym) return;
      var b = findBal(feeSym);
      if (!b) return;
      var stampSym = feeSym, stampT = tSym;
      Promise.resolve().then(async function () {
        var tBal = findBal(assetVal());
        var tAsset = tBal
          ? { id: tBal.asset_id, symbol: tBal.symbol, precision: tBal.precision }
          : await lookupAssetLocal(assetVal());
        var wid = await Account.myAccountId();
        var toId = wid;
        try { toId = (await Account.resolve(toF.input.value.trim())).id; } catch (e) { /* self shape */ }
        var amountInt;
        try {
          amountInt = Format.parseAmount(amountF.input.value, tAsset.precision);
          if (!/[1-9]/.test(amountInt)) amountInt = Format.parseAmount("1", tAsset.precision);
        } catch (e) {
          amountInt = Format.parseAmount("1", tAsset.precision);
        }
        var unsigned = await Tx.buildTransfer({
          fromId: wid, toId: toId, amountInt: amountInt, assetId: tAsset.id, memoObj: null
        });
        var fee = await Tx.fee(0, unsigned.operations[0][1], b.asset_id);
        if (feeSym !== stampSym || assetVal().toUpperCase() !== stampT) return; /* stale */
        feeQuote.textContent = t("confirm.fee", "Fee") + " (" + b.symbol + "): " +
          Format.formatAmount(String(fee.amount), b.precision);
        feeQuote.appendChild(doc.createTextNode(t("transfer.confirm_settles_the_fee_in", " — Confirm settles the fee in ") + stampT + "."));
      }).catch(function () { /* quote hidden; confirm stays source of truth */ });
    }

    /* Review gating (SendModal isSubmitNotValid concept): disabled until
     * from+to+amount+asset are present and syntactically valid with
     * from != to (case-insensitive; id-level equality re-checks at
     * review). Every disabled state lists its reasons — never silent. */
    function updateGate() {
      var reasons = [];
      var fromV = fromF.input.value.trim();
      var toV = toF.input.value.trim();
      var assetV = assetVal();
      var amountV = amountF.input.value.trim();
      if (!fromV) reasons.push("Sender is required.");
      if (!toV) reasons.push(t("transfer.recipient_required", "Recipient is required."));
      if (!assetV) reasons.push(t("transfer.asset_required", "Asset symbol is required."));
      if (!amountV) {
        reasons.push(t("transfer.amount_positive", "Amount must be greater than zero."));
      } else if (!/^\d+(\.\d+)?$/.test(amountV)) {
        reasons.push(t("transfer.bad_amount", "bad amount"));
      } else if (!/[1-9]/.test(amountV.replace(".", ""))) {
        reasons.push(t("transfer.amount_positive", "Amount must be greater than zero."));
      }
      if (fromV && toV && fromV.toLowerCase() === toV.toLowerCase()) {
        reasons.push("Sender and recipient must be different.");
      }
      while (gateBox.firstChild) gateBox.removeChild(gateBox.firstChild);
      for (var i = 0; i < reasons.length; i++) {
        gateBox.appendChild(el(doc, "div", reasons[i], "xfer-gate-reason"));
      }
      reviewBtn.disabled = reasons.length > 0;
    }

    /* Asset input events, rebound after the input/select swap. */
    function bindAssetEvents() {
      assetF.input.addEventListener("input", function () {
        refreshFeeOpts(); refreshAvail(); updateGate();
      });
      assetF.input.addEventListener("change", function () {
        refreshFeeOpts(); refreshAvail(); updateGate();
      });
    }

    /* Unlocked asset dropdown: resolve the sender, load non-zero balances,
     * swap the text input for a restricted <select> (the current/prefill
     * value survives via union). Any failure keeps the free-text input —
     * the form never blocks, and the unknown-asset review catch still
     * guards every path. */
    function swapAssetToSelect() {
      if (!assetF.input || assetF.input.tagName !== "INPUT") return;
      var cur = assetVal().toUpperCase();
      var seen = {};
      var opts = [];
      var i, k;
      for (i = 0; i < bals.length; i++) {
        seen[String(bals[i].symbol).toUpperCase()] = 1;
        opts.push(bals[i].symbol);
      }
      if (cur && !seen[cur]) opts.push(cur);
      if (!opts.length) return;
      var sel = doc.createElement("select");
      sel.id = "xfer-asset";
      touchable(sel);
      for (k = 0; k < opts.length; k++) {
        var o = doc.createElement("option");
        o.value = opts[k];
        o.textContent = opts[k];
        if (opts[k].toUpperCase() === cur) o.selected = true;
        sel.appendChild(o);
      }
      assetF.input.parentNode.replaceChild(sel, assetF.input);
      assetF.input = sel;
      bindAssetEvents();
    }

    function loadBalancesForSender() {
      var who = fromF.input.value.trim() || from.id;
      balWho = who;
      balsState = "loading";
      refreshAvail();
      Promise.resolve().then(async function () {
        var acc = await Account.resolve(who);
        var rows = await Account.balances(acc.id);
        if (balWho !== who || (fromF.input.value.trim() || from.id) !== who) return; /* stale */
        bals = (rows || []).filter(function (e) {
          return e && /[1-9]/.test(String(e.raw));
        });
        bySym = {};
        bals.forEach(function (e) {
          bySym[String(e.symbol).toUpperCase()] = e;
        });
        balsState = "ready";
        /* A fee choice the new sender does not hold falls back openly to
         * the transfer asset — never a quote for an asset they lack. */
        if (feeTouched && feeSym !== assetVal().toUpperCase() && !bySym[feeSym]) {
          feeSym = assetVal().toUpperCase() || feeSym;
          feeTouched = false;
        }
        swapAssetToSelect();
        refreshFeeOpts();
        refreshAvail();
        updateGate();
      }).catch(function () {
        if (balWho !== who) return; /* stale */
        bals = [];
        bySym = {};
        balsState = "failed";
        refreshFeeOpts();
        refreshAvail();
        updateGate();
      });
    }

    fromF.input.addEventListener("input", updateGate);
    toF.input.addEventListener("input", updateGate);
    amountF.input.addEventListener("input", updateGate);
    memoF.input.addEventListener("input", function () { refreshFeeQuote(); });
    feeSel.addEventListener("change", function () {
      feeSym = String(feeSel.value || "").trim().toUpperCase() || feeSym;
      feeTouched = true;
      refreshFeeQuote();
    });
    bindAssetEvents();
    refreshFeeOpts();
    refreshAvail();
    updateGate();
    if (!locked) loadBalancesForSender();

    reviewBtn.addEventListener("click", function () {
      setFieldError(fromF, "");
      setFieldError(toF, "");
      setFieldError(assetF, "");
      setFieldError(amountF, "");
      while (previewBox.firstChild) previewBox.removeChild(previewBox.firstChild);
      if (typeof Wallet.isUnlocked === "function" && Wallet.isUnlocked()) {
        reviewBtn.disabled = true;
        var status = showStatus(doc, wrap, t("transfer.checking", "Checking recipient, asset, and fee…"));
        Promise.resolve().then(async function () {
          var typed = fromF.input.value.trim() || from.id;
          var rf = await Account.resolve(typed);
          var wid = await Account.myAccountId();
          if (rf.id !== wid) {
            var err = new Error("from-mismatch");
            err.fromName = rf.name; err.fromId = rf.id; err.walletId = wid;
            throw err;
          }
        }).then(function () {
          return TransferConfirm.review({
            to: toF.input.value.trim(),
            asset: assetF.input.value,
            amount: amountF.input.value,
            memo: memoF.input.value,
            encrypted: encBox.checked,
            feeAsset: feeSym /* forward-compat hook; review settles the
              transfer asset today, see header */
          });
        }).then(function (ctx) {
          clearRoot(root);
          TransferConfirm.showConfirm(doc, makeWrap(doc, root), root, from, ctx, function () {
            clearRoot(root);
            showForm(doc, makeWrap(doc, root), root, from, {
              from: from.name,
              to: ctx.to.name,
              asset: ctx.asset.symbol,
              amount: Format.formatAmount(ctx.amountInt, ctx.asset.precision),
              memo: ctx.memoText,
              encrypted: ctx.memoKind !== "plain",
              feeAsset: feeSym,
              error: null
            });
          });
        }).catch(function (e) {
          var msg = (e && e.message) ? e.message : String(e || "Could not prepare the transfer.");
          if (msg.indexOf("from-mismatch") === 0) {
            msg = t("transfer.from_mismatch", "From must match the unlocked wallet account.") +
              " " + (e.fromName + " (" + e.fromId + ")") + " / wallet " + e.walletId + ".";
          } else if (msg.indexOf("unknown-account") !== -1) {
            setFieldError(toF, t("transfer.unknown_account", "Unknown account."));
          } else if (msg.indexOf("Unknown asset") === 0 || msg.indexOf("bad-asset-shape") !== -1) {
            setFieldError(assetF, msg);
          } else if (msg.indexOf("bad amount") === 0 || msg.indexOf("too many decimals") === 0 ||
                     msg.indexOf("Amount must be") === 0) {
            setFieldError(amountF, msg);
          }
          wrap.removeChild(status);
          clearRoot(root);
          showForm(doc, makeWrap(doc, root), root, from, {
            from: fromF.input.value,
            to: toF.input.value,
            asset: assetF.input.value,
            amount: amountF.input.value,
            memo: memoF.input.value,
            encrypted: encBox.checked,
            feeAsset: String(feeSel.value || feeSym),
            error: msg
          });
        });
      } else {
        /* Locked: read-only preview under the form; password only at Sign & Send. */
        lockedPreview(doc, previewBox, root, {
          from: fromF.input.value,
          to: toF.input.value,
          asset: assetF.input.value,
          amount: amountF.input.value,
          memo: memoF.input.value,
          encrypted: encBox.checked,
          feeAsset: feeSym
        }, reviewBtn);
      }
    });
  }

  /* Locked read-only preview. transfer-confirm.js is out of scope for this
   * repair, so its lookup/fee steps are replicated here verbatim (same node
   * calls, same wire shapes — plain-memo path only). Locked + encrypted
   * memos need wallet keys, so the memo stays OUT of the locked unsigned
   * envelope while From/To/Asset/Amount/Fee still preview (memo row shows
   * the locked-encrypted hint). After unlock the flow hands back to
   * TransferConfirm.review/showConfirm, which re-validates everything
   * (including the encrypted memo, via the passthrough below) against the
   * wallet account. */
  function utf8HexLocal(str) {
    var bytes = new TextEncoder().encode(str);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }

  /* Symbol (trimmed, uppercased) to {id, symbol, precision} — verbatim copy
   * of the transfer-confirm.js lookup (same per-file convention as the
   * market-ui split) so the locked preview resolves assets identically. */
  async function lookupAssetLocal(symbol) {
    var sym = String(symbol || "").trim().toUpperCase();
    if (!sym) throw new Error(t("transfer.asset_required", "Asset symbol is required."));
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "lookup_asset_symbols", [[sym]]);
    if (!rows || !rows[0]) throw new Error(t("transfer.unknown_asset_prefix", "Unknown asset: ") + sym + ".");
    if (typeof rows[0].precision !== "number") throw new Error("bad-asset-shape");
    return { id: rows[0].id, symbol: rows[0].symbol, precision: rows[0].precision };
  }

  /* Full account row for the recipient memo key — verbatim copy of the
   * transfer-confirm.js original (Account.resolve returns id+name only). */
  async function fullAccountLocal(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_accounts", [[id]]);
    if (!rows || !rows[0]) throw new Error("unknown-account");
    return rows[0];
  }

  /* networkNameLocal: settings network for the core-asset default
   * ("mainnet" when settings are unreadable). Never throws. */
  function networkNameLocal() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        return Store.loadSettings().network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* Locked preview: resolve From/To/asset, parse the amount, build the
   * unsigned op-0 envelope + live fee, render human rows, then offer
   * Unlock & Sign (password asked only here). Amounts stay integer strings. */
  function lockedPreview(doc, box, root, vals, reviewBtn) {
    while (box.firstChild) box.removeChild(box.firstChild);
    reviewBtn.disabled = true;
    showStatus(doc, box, t("transfer.checking", "Checking recipient, asset, and fee…"));
    function done() { reviewBtn.disabled = false; }
    Promise.resolve().then(async function () {
      if (!vals.to || !String(vals.to).trim()) throw new Error(t("transfer.recipient_required", "Recipient is required."));
      var fromAcc = await Account.resolve(String(vals.from || "").trim() || "1.2.0");
      var to = await Account.resolve(String(vals.to).trim());
      var asset = await lookupAssetLocal(vals.asset);
      var amountInt;
      try {
        amountInt = Format.parseAmount(vals.amount, asset.precision);
      } catch (e) {
        throw new Error(e && e.message ? e.message : "bad amount");
      }
      if (!/[1-9]/.test(amountInt)) throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));
      var memoText = String(vals.memo || ""), memoObj = null, memoKind = "none", lockedEnc = false;
      if (memoText) {
        var toFull = await fullAccountLocal(to.id);
        var toMemoKey = toFull && toFull.options ? toFull.options.memo_key : null;
        if (!toMemoKey) throw new Error("Recipient " + to.name + " has no memo key; clear the memo to continue.");
        if (vals.encrypted) {
          /* G7: locked keys cannot encrypt — exclude the memo from the
           * locked envelope, preview everything else with a placeholder row. */
          lockedEnc = true;
          memoKind = "locked-encrypted";
        } else {
          memoObj = { from: "", to: toMemoKey, nonce: "0", message: utf8HexLocal(memoText) };
          memoKind = "plain";
        }
      }
      /* Fee in the chosen asset (transfer asset by default): resolved to
       * id + precision here so the preview displays the right symbol at
       * the right decimals. An unresolvable choice fails loudly below —
       * never a wrong number. */
      var wantFeeSym = String(vals.feeAsset || asset.symbol).trim().toUpperCase() || asset.symbol;
      var feeId = asset.id, feePrec = asset.precision, feeSym = asset.symbol;
      if (wantFeeSym !== asset.symbol) {
        var feeAsset = await lookupAssetLocal(wantFeeSym);
        feeId = feeAsset.id;
        feePrec = feeAsset.precision;
        feeSym = feeAsset.symbol;
      }
      var unsigned = await Tx.buildTransfer({
        fromId: fromAcc.id, toId: to.id, amountInt: amountInt, assetId: asset.id, memoObj: memoObj
      });
      var fee = await Tx.fee(0, unsigned.operations[0][1], feeId);
      return { fromAcc: fromAcc, to: to, asset: asset, amountInt: amountInt,
        memoText: memoText, memoKind: memoKind, lockedEnc: lockedEnc,
        encrypted: !!vals.encrypted, fee: fee,
        feeSym: feeSym, feePrec: feePrec };
    }).then(function (P) {
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(el(doc, "h3", t("transfer.preview_title", "Transfer preview (locked)")));
      var list = el(doc, "dl", null, "xfer-confirm");
      function row(term, text, title) {
        list.appendChild(el(doc, "dt", term));
        var dd = el(doc, "dd", text);
        if (title) dd.title = title;
        list.appendChild(dd);
      }
      row(t("confirm.from", "From"), P.fromAcc.name + " (" + P.fromAcc.id + ")");
      row(t("confirm.to", "To"), P.to.name + " (" + P.to.id + ")");
      row(t("confirm.amount", "Amount"),
        Format.formatAmount(P.amountInt, P.asset.precision) + " " + P.asset.symbol, P.amountInt);
      row(t("confirm.memo", "Memo"), P.memoKind === "plain" ? "Plain: " + P.memoText :
        (P.lockedEnc ? t("transfer.locked_encrypted_hint", "Encrypted memos need the wallet keys — unlock first, or switch the memo to plain.") : "(none)"));
      var feeHuman;
      try {
        feeHuman = Format.formatAmount(String(P.fee.amount), P.feePrec) + " " + P.feeSym;
      } catch (e) { feeHuman = String(P.fee.amount) + " " + P.feeSym; }
      row(t("confirm.fee", "Fee") + " (" + P.feeSym + ")", feeHuman, String(P.fee.amount));
      row(t("confirm.network", "Network"), networkNameLocal());
      box.appendChild(list);
      box.appendChild(el(doc, "p",
        t("transfer.locked_sign_hint", "Unlock to sign — the password is asked only here, at signing."), "muted"));
      var pwRow = el(doc, "div", null, "xfer-field");
      var pw = doc.createElement("input");
      pw.type = "password"; pw.setAttribute("autocomplete", "current-password");
      pw.setAttribute("aria-label", "Password"); touchable(pw); pwRow.appendChild(pw);
      var ub = touchable(el(doc, "button", t("transfer.unlock_sign", "Unlock & Sign")));
      ub.type = "button"; pwRow.appendChild(ub);
      box.appendChild(pwRow);
      ub.addEventListener("click", function () {
        ub.disabled = true;
        showStatus(doc, box, t("transfer.unlocking", "Unlocking…"));
        Promise.resolve().then(function () { return Wallet.unlock(pw.value); })
          .then(function () { return Account.myAccountId(); })
          .then(function (wid) {
            if (wid !== P.fromAcc.id) {
              throw new Error("Unlocked as " + wid + " but From is " +
                P.fromAcc.name + " (" + P.fromAcc.id + ") — switch From or unlock with that account's key.");
            }
            return TransferConfirm.review({
              to: P.to.name, asset: P.asset.symbol,
              amount: Format.formatAmount(P.amountInt, P.asset.precision),
              memo: P.memoText, encrypted: !!(P.encrypted && P.memoText),
              feeAsset: P.feeSym
            });
          })
          .then(function (ctx) {
            clearRoot(root);
            TransferConfirm.showConfirm(doc, makeWrap(doc, root), root, P.fromAcc, ctx, function () {
              clearRoot(root);
              showForm(doc, makeWrap(doc, root), root, P.fromAcc, {
                from: P.fromAcc.name, to: ctx.to.name, asset: ctx.asset.symbol,
                amount: Format.formatAmount(ctx.amountInt, ctx.asset.precision),
                memo: ctx.memoText, encrypted: ctx.memoKind !== "plain",
                feeAsset: P.feeSym, error: null
              });
            });
          })
          .catch(function (e2) {
            ub.disabled = false;
            showError(doc, box, e2, t("transfer.unlock_failed", "Unlock failed"));
          });
      });
      done();
    }).catch(function (e) {
      while (box.firstChild) box.removeChild(box.firstChild);
      showError(doc, box, (e && e.message) ? e.message : String(e || "Could not prepare the transfer."),
        t("transfer.prepare_failed", "Could not prepare the transfer."));
      done();
    });
  }

  /* review/showConfirm/showResult moved verbatim to transfer-confirm.js
   * (confirm side) — called above as TransferConfirm.*. */

  return {
    renderTransfer: renderTransfer
  };
})();

if (typeof module !== "undefined") { module.exports = TransferUI; }
