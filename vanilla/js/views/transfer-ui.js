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
 * Send/Propose toggle (SendModal.jsx:551-564 concept): Send vs Propose
 *   buttons above Review; Propose adds proposer + expiration + review-period
 *   inputs, wraps the op-0 transfer in op-22 via Proposal.buildCreate (the
 *   barter-ui.js:269-270 nesting path — {op: [0, opData]} — never reinvented),
 *   quotes the WRAPPER fee live (get_required_fees on op-22, tx-send.js
 *   nested-shape unwrap), confirms with named rows (proposer + inner op),
 *   signs at Sign & Send only, broadcasts via Proposal.sendAndProve with a
 *   proposalsFor + get_objects re-read (proposal id observed). Locked preview
 *   works (proposer defaults 1.2.0 + notice). Propose-as-another-account is
 *   INCLUDED: unlocked requires proposer == wallet (fee-payer signs), From
 *   may differ (inner authorizes later).
 *   CHAIN TRUTH (#4 wins): op-22 fields <- proposal.hpp:70-82
 *   (fee_paying_account = proposer, proposed_ops = vector<op_wrapper>,
 *   review_period_seconds optional); serializer Tx._ser.
 *   serializeProposalCreateOp (tx.js:1983, dispatch :2425/:2499, recursion
 *   through serializeOperationData — nested op-0 bytes identical to top-level);
 *   builder Proposal.buildCreate (proposal.js:104-111); fee Proposal.fee ->
 *   Tx.fee (tx-send.js:48-59); prove Proposal.proposalsFor (get_proposed_
 *   transactions) + Proposal.proposal (get_objects).
 * DEFERRED (same punchlist page): the known-scammer recipient flag
 * (AccountSelector.jsx:592,709 concept — lands with the auth/contacts
 * slice). Recorded here so it is not lost.
 * Pending-i18n plain strings (the next locales batch moves them to
 * transfer.* with matching defaults; check_i18n scans t() calls only, so
 * it stays green meanwhile — NO new t() calls were added for propose, all
 * new labels below are literals): "Sender is required.",
 * "Sender and recipient must be different.",
 * "Confirm settles the fee in " + SYM + ".", "Send", "Propose",
 * "Proposer is required.", "Proposal expiration is required.",
 * "Proposal expiration is invalid.",
 * "Review period must be a non-negative integer.",
 * "Proposer defaults to committee-account (1.2.0) while locked — unlock to act as yourself.",
 * "Proposal fee is quoted live in the core asset at review.",
 * "Review proposal", "Proposal backend missing: js/proposal.js failed to load.",
 * "Proposer must match the unlocked wallet account (fee-payer signs)" (+ ids),
 * "Proposal preview (locked)", "Proposer", "Expiration", "Review period",
 * "none", "Enclosed op: transfer (op 0) — executes only after approvals.",
 * "Fee (live)", "Confirm proposal (op 22)", "Encrypted", "Plain: " + text,
 * "(none)", "Recipient " + name + " has no memo key; clear the memo to continue.",
 * "Proposal sent", "Proposal " + id + " observed at head block #…",
 * amount + symbol + " → " + name + " enclosed; fee …", "View proposals",
 * "Unlocked — proposal rebuilt with you" (+ name + "as proposer"),
 * "Could not build the proposal.".
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
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
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

  /* No local el — use DOM.el */

  /* Touch target floor (principle #7): every interactive element is ≥44px
   * in at least one dimension. Inline style keeps this view self-contained. */
/* clearRoot removed — use DOM.clear */

  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  /* Inline error panel that is never blank: any thrown value maps to a
   * human sentence; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var err = null; /* created via DOM.error below */
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
    err = DOM.error(wrap, msg);
    return err;
  }

  /* Status line for multi-step sends (signing → broadcasting). */
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text); return p;
  }

  /* UTF-8 memo hex + account/asset lookups moved verbatim to
   * transfer-confirm.js (review side) — private copies there. */

  /* Inline error slots live on each Forms-built field object as .err
   * (created at the call site right after Forms.labeledInput/
   * labeledTextarea, same div.error + aria-live + display:none contract
   * as the old fieldRow). */

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
  /** Route entry: #/transfer (form + confirm + propose wiring).
   * @param {HTMLElement} root router mount element
   * @param {any} prefillTo optional prefilled recipient (query param) */
  function renderTransfer(root, prefillTo) {
    /* Shared-socket wait (deep links land before boot connects), then show
     * the form immediately — PUBLIC-FIRST, no unlock gate. The sender
     * resolves to the wallet account when unlocked, else committee-account
     * 1.2.0 (public chain object, verified live 2026-09-28). */
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    DOM.clear(root);
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
      wrap.appendChild(DOM.el(doc, "p", t("transfer.connecting", "Connecting to network…"), "muted"));
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
        DOM.clear(root);
        var failWrap = makeWrap(doc, root);
        showError(doc, failWrap, new Error("not connected"), t("transfer.network_unavailable_short", "Network unavailable."));
        var tstat = DOM.el(doc, "p", "", "muted");
        try { tstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        failWrap.appendChild(tstat);
        var trow = DOM.el(doc, "div", null, "pools-offline-row");
        failWrap.appendChild(trow);
        var tryBtn = touchable(DOM.el(doc, "button", t("fees.retry", "Retry")));
        tryBtn.type = "button";
        trow.appendChild(tryBtn);
        var toff = null;
        try { toff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { toff = null; }
        if (toff && typeof toff.wire === "function") {
          try { toff.wire(tryBtn, tstat, function () { renderTransfer(root, prefillTo); }, t); } catch (e) { tryBtn.addEventListener("click", function () { renderTransfer(root, prefillTo); }); }
        } else {
          tryBtn.addEventListener("click", function () { renderTransfer(root, prefillTo); });
        }
        var tlink = null;
        if (toff && typeof toff.settingsLink === "function") {
          try { tlink = toff.settingsLink(doc, t); } catch (e) { tlink = null; }
        }
        if (!tlink) {
          tlink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
          try { tlink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          touchable(tlink);
        }
        trow.appendChild(tlink);
      }, 15000);
      /* Automated handshake on entry (shared Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
      return;
    }

    wrap.appendChild(DOM.el(doc, "p", t("transfer.loading", "Loading…"), "muted"));
    Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }).then(function (id) {
      return Account.resolve(id).catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" }; });
    }).then(function (from) {
      DOM.clear(root);
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
      DOM.clear(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(DOM.el(doc, "h1", t("transfer.title", "Transfer")));
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
    wrap.appendChild(DOM.el(doc, "h1", t("transfer.title", "Transfer")));
    if (locked) {
      wrap.appendChild(DOM.el(doc, "p",
        t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: from.name, id: from.id }), "muted"));
    }

    if (state.error) showError(doc, wrap, state.error, t("transfer.prepare_failed", "Could not prepare the transfer."));

    var fromF = Forms.labeledInput(doc, t("transfer.from_label", "From (name or 1.2.N) ") + " ", {
      id: "xfer-from", value: state.from || from.name, placeholder: t("transfer.from_placeholder", "sender"), autocomplete: "off"
    });
    fromF.err = DOM.el(doc, "div", "", "error");
    fromF.err.setAttribute("aria-live", "polite");
    fromF.err.style.display = "none";
    fromF.row.appendChild(fromF.err);
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

    var toF = Forms.labeledInput(doc, t("transfer.to_label", "To (name or 1.2.N) ") + " ", {
      id: "xfer-to", value: state.to, placeholder: t("transfer.to_placeholder", "recipient"), autocomplete: "off"
    });
    toF.err = DOM.el(doc, "div", "", "error");
    toF.err.setAttribute("aria-live", "polite");
    toF.err.style.display = "none";
    toF.row.appendChild(toF.err);
    wrap.appendChild(toF.row);
    /* LOW punchlist: known-scammer flag (AccountSelector concept). No scam
     * registry is vendored, so this stays an honest hint, not a verdict. */
    wrap.appendChild(DOM.el(doc, "p", t("transfer.no_scam_list_is_loaded_here_double_che", "No scam list is loaded here — double-check the recipient name before reviewing."), "muted"));
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
    var assetF = Forms.labeledInput(doc, t("transfer.asset_label", "Asset ") + " ", {
      id: "xfer-asset", value: state.asset, placeholder: coreSymbol(), autocomplete: "off"
    });
    assetF.err = DOM.el(doc, "div", "", "error");
    assetF.err.setAttribute("aria-live", "polite");
    assetF.err.style.display = "none";
    assetF.row.appendChild(assetF.err);
    wrap.appendChild(assetF.row);

    /* Available balance (punchlist MED): a click-to-fill button when the
     * selected asset has a known sender balance (unlocked only), a status
     * line while loading or when the load failed, empty otherwise. */
    var availBox = DOM.el(doc, "div", null, "xfer-avail");
    wrap.appendChild(availBox);

    var amountF = Forms.labeledInput(doc, t("transfer.amount_label", "Amount ") + " ", {
      id: "xfer-amount", value: state.amount, placeholder: "0.00", inputmode: "decimal", autocomplete: "off"
    });
    amountF.err = DOM.el(doc, "div", "", "error");
    amountF.err.setAttribute("aria-live", "polite");
    amountF.err.style.display = "none";
    amountF.row.appendChild(amountF.err);
    wrap.appendChild(amountF.row);

    var memoF = Forms.labeledTextarea(doc, t("transfer.memo_label", "Memo (optional) ") + " ", {
      id: "xfer-memo", value: state.memo, rows: 2
    });
    memoF.err = DOM.el(doc, "div", "", "error");
    memoF.err.setAttribute("aria-live", "polite");
    memoF.err.style.display = "none";
    memoF.row.appendChild(memoF.err);
    wrap.appendChild(memoF.row);

    var encBox = doc.createElement("input");
    encBox.type = "checkbox";
    encBox.id = "xfer-encrypted";
    encBox.checked = !!state.encrypted;
    var encRow = Forms.fieldRow(doc, t("transfer.encrypted_label", "Encrypted memo "), encBox);
    wrap.appendChild(encRow);

    /* Fee asset (punchlist MED): the transfer asset plus the sender's
     * non-zero balances when unlocked, the transfer asset alone when
     * locked. The choice follows the transfer asset until touched. */
    var feeSel = doc.createElement("select");
    feeSel.id = "xfer-fee-asset";
    var feeRow = Forms.fieldRow(doc, t("confirm.fee", "Fee") + " ", feeSel);
    wrap.appendChild(feeRow);
    /* Equivalent-fee quote in an alternate fee asset (unlocked only, hidden
     * otherwise and on any lookup failure — the confirm stays the source
     * of truth; a missing quote is never a wrong number). */
    var feeQuote = DOM.el(doc, "div", "", "muted");
    feeQuote.setAttribute("aria-live", "polite");
    wrap.appendChild(feeQuote);

    /* Send/Propose toggle (SendModal.jsx:551-564 concept — EqualWidthContainer
     * with Send vs Propose, primary/ghost by flag). Plain labels (pending-i18n,
     * see header); active button is bold + aria-pressed, both stay clickable
     * and keyboard-focusable. Propose reveals proposer + expiration +
     * review-period below; Review re-labels accordingly. */
    var mode = (state && state.mode === "propose") ? "propose" : "send";
    var modeRow = DOM.el(doc, "div", null, "xfer-field xfer-mode");
    var sendModeBtn = touchable(DOM.el(doc, "button", t("transfer.mode_send", "Send")));
    sendModeBtn.type = "button";
    sendModeBtn.id = "xfer-mode-send";
    var proposeModeBtn = touchable(DOM.el(doc, "button", t("transfer.mode_propose", "Propose")));
    proposeModeBtn.type = "button";
    proposeModeBtn.id = "xfer-mode-propose";
    modeRow.appendChild(sendModeBtn);
    modeRow.appendChild(proposeModeBtn);
    wrap.appendChild(modeRow);

    /* Default proposal expiration: now + 24h as datetime-local. Date only. */
    function defaultExpirationLocal() {
      var dt = new Date(Date.now() + 86400000);
      function p2(n) { return (n < 10 ? "0" : "") + n; }
      return dt.getFullYear() + "-" + p2(dt.getMonth() + 1) + "-" + p2(dt.getDate()) +
        "T" + p2(dt.getHours()) + ":" + p2(dt.getMinutes());
    }

    /* Proposer (fee-payer) defaults to 1.2.0 while locked (public viewing
     * object) else the wallet sender; expiry defaults +24h; review blank. */
    var proposerF = Forms.labeledInput(doc, t("proposal.fee_payer_proposer", "Fee payer (proposer)") + " ", {
      id: "xfer-proposer",
      value: (state && state.proposer) || (locked ? (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" : (state.from || from.name)),
      placeholder: t("proposal.name_or_1_2_n", "name or 1.2.N"), autocomplete: "off"
    });
    proposerF.err = DOM.el(doc, "div", "", "error");
    proposerF.err.setAttribute("aria-live", "polite");
    proposerF.err.style.display = "none";
    proposerF.row.appendChild(proposerF.err);
    var expiryF = Forms.labeledInput(doc, t("barter.proposal_expiration", "Proposal expiration") + " ", {
      id: "xfer-expiry", type: "datetime-local",
      value: (state && state.expiration) || defaultExpirationLocal()
    });
    expiryF.err = DOM.el(doc, "div", "", "error");
    expiryF.err.setAttribute("aria-live", "polite");
    expiryF.err.style.display = "none";
    expiryF.row.appendChild(expiryF.err);
    var reviewPeriodF = Forms.labeledInput(doc, t("barter.review_period_seconds_optional", "Review period seconds (optional)") + " ", {
      id: "xfer-review-period",
      value: (state && state.reviewPeriod) || "",
      placeholder: t("barter.blank_none", "blank = none"), inputmode: "numeric", autocomplete: "off"
    });
    reviewPeriodF.err = DOM.el(doc, "div", "", "error");
    reviewPeriodF.err.setAttribute("aria-live", "polite");
    reviewPeriodF.err.style.display = "none";
    reviewPeriodF.row.appendChild(reviewPeriodF.err);
    wrap.appendChild(proposerF.row);
    wrap.appendChild(expiryF.row);
    wrap.appendChild(reviewPeriodF.row);
    var proposeNotice = DOM.el(doc, "p",
      t("transfer.propose_notice_locked", "Proposer defaults to committee-account (1.2.0) while locked — unlock to act as yourself.") + " " + t("transfer.propose_notice_fee", "Proposal fee is quoted live in the core asset at review."), "muted");
    wrap.appendChild(proposeNotice);

    /* Toggle refresh: button emphasis + propose-field visibility + Review
     * label. Never throws; gating owns the disabled state. */
    var reviewBtn = touchable(DOM.el(doc, "button", t("transfer.review", "Review transfer")));
    reviewBtn.id = "xfer-review";
    reviewBtn.type = "button";
    reviewBtn.disabled = true; /* gating owns this from here on */
    wrap.appendChild(reviewBtn);
    /* Gating reasons: every disabled state names its reasons inline
     * (honest, never silent). Empty when the form is submittable. */
    var gateBox = DOM.el(doc, "div", null, "xfer-gate");
    gateBox.setAttribute("aria-live", "polite");
    wrap.appendChild(gateBox);
    var previewBox = DOM.el(doc, "div", null, "xfer-out");
    wrap.appendChild(previewBox);

    /* Toggle refresh: button emphasis (bold + aria-pressed, SendModal
     * primary/ghost concept) + propose-field visibility + Review label.
     * Propose hides the op-0 fee row: inner op fees are informational on
     * op-22 (the WRAPPER fee is quoted live at review in the core asset),
     * so offering an op-0 fee asset there would promise what signing
     * cannot settle. Never throws; gating owns the disabled state. */
    function refreshMode() {
      var isPropose = (mode === "propose");
      sendModeBtn.setAttribute("aria-pressed", isPropose ? "false" : "true");
      proposeModeBtn.setAttribute("aria-pressed", isPropose ? "true" : "false");
      sendModeBtn.style.fontWeight = isPropose ? "normal" : "bold";
      proposeModeBtn.style.fontWeight = isPropose ? "bold" : "normal";
      proposerF.row.style.display = isPropose ? "" : "none";
      expiryF.row.style.display = isPropose ? "" : "none";
      reviewPeriodF.row.style.display = isPropose ? "" : "none";
      proposeNotice.style.display = isPropose ? "" : "none";
      feeRow.style.display = isPropose ? "none" : "";
      feeQuote.style.display = isPropose ? "none" : "";
      if (isPropose) {
        DOM.clear(feeQuote);
      }
      if (isPropose) reviewBtn.textContent = t("transfer.review_proposal", "Review proposal");
      else reviewBtn.textContent = t("transfer.review", "Review transfer");
      updateGate();
    }

    sendModeBtn.addEventListener("click", function () {
      if (mode === "send") return;
      mode = "send";
      DOM.clear(previewBox);
      refreshMode();
    });
    proposeModeBtn.addEventListener("click", function () {
      if (mode === "propose") return;
      mode = "propose";
      DOM.clear(previewBox);
      refreshMode();
    });
    proposerF.input.addEventListener("input", updateGate);
    expiryF.input.addEventListener("input", updateGate);
    expiryF.input.addEventListener("change", updateGate);
    reviewPeriodF.input.addEventListener("input", updateGate);

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
      DOM.clear(feeSel);
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
      DOM.clear(availBox);
      if (locked) return;
      if (balsState === "loading") {
        availBox.appendChild(DOM.el(doc, "span", t("account.loading_balances", "Loading balances…"), "muted"));
        return;
      }
      if (balsState === "failed") {
        availBox.appendChild(DOM.el(doc, "span", t("account.load_balances_failed", "Could not load balances."), "muted"));
        return;
      }
      var b = findBal(assetVal());
      if (!b) return;
      var btn = DOM.el(doc, "button", t("credit.current_balance", "Current balance") + ": " + b.display + " " + b.symbol);
      btn.type = "button";
      btn.id = "xfer-max";
      btn.style.borderBottom = "var(--border, #A09F9F) 1px dotted"; /* SendModal affordance (themed token + classic fallback) */
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
            /* TYPE NOTE: the global Crypto object collides with DOM lib's
             * Crypto interface (constructor type), so its wallet methods
             * read back missing; the cast pins it to any. Local cast only. */
            if (typeof Crypto === "undefined" || !(/** @type {any} */ (Crypto).encryptMemo)) throw new Error("no-crypto");
            memoObj = await (/** @type {any} */ (Crypto).encryptMemo)(memoText, Wallet.keys.memo.wif, memoKey);
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
      DOM.clear(feeQuote);
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
      /* Propose mode adds proposer + expiry + review-period gating. The
       * expiry parses as datetime-local (16 chars, needs ":00") or full
       * ISO; the review period is blank (= none) or a u32 digit string. */
      if (mode === "propose") {
        var propV = proposerF.input.value.trim();
        var expV = expiryF.input.value.trim();
        var revV = reviewPeriodF.input.value.trim();
        if (!propV) reasons.push(t("transfer.proposer_required", "Proposer is required."));
        if (!expV) {
          reasons.push(t("transfer.proposal_expiration_required", "Proposal expiration is required."));
        } else if (isNaN(Date.parse(expV.length === 16 ? expV + ":00" : expV))) {
          reasons.push(t("transfer.proposal_expiration_invalid", "Proposal expiration is invalid."));
        }
        if (revV !== "" && !/^\d+$/.test(revV)) {
          reasons.push(t("transfer.review_period_integer", "Review period must be a non-negative integer."));
        }
      }
      DOM.clear(gateBox);
      for (var i = 0; i < reasons.length; i++) {
        gateBox.appendChild(DOM.el(doc, "div", reasons[i], "xfer-gate-reason"));
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

    /* loadBalancesForSender: reload sender balances + fee options on sender change.
     * WHY stale-guarded: slow resolves must not overwrite a newer sender (balWho check).
     * No params; async via Account.resolve/balances; failed state dashes availability. */
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
    refreshMode();
    if (!locked) loadBalancesForSender();

    reviewBtn.addEventListener("click", function () {
      setFieldError(fromF, "");
      setFieldError(toF, "");
      setFieldError(assetF, "");
      setFieldError(amountF, "");
      DOM.clear(previewBox);
      /* Propose mode never touches the op-0 confirm file: the transfer
       * becomes the single enclosed op of an op-22 proposal (From may
       * differ from the wallet — only the proposer must sign now). */
      if (mode === "propose") {
        setFieldError(proposerF, "");
        setFieldError(expiryF, "");
        setFieldError(reviewPeriodF, "");
        var snap = {
          from: fromF.input.value,
          to: toF.input.value,
          asset: assetF.input.value,
          amount: amountF.input.value,
          memo: memoF.input.value,
          encrypted: encBox.checked,
          feeAsset: String(feeSel.value || feeSym),
          proposer: proposerF.input.value,
          expiration: expiryF.input.value,
          reviewPeriod: reviewPeriodF.input.value
        };
        if (typeof Wallet.isUnlocked === "function" && Wallet.isUnlocked()) {
          proposeReviewUnlocked(doc, wrap, root, from, snap, reviewBtn);
        } else {
          lockedProposePreview(doc, previewBox, root, snap, reviewBtn);
        }
        return;
      }
      if (typeof Wallet.isUnlocked === "function" && Wallet.isUnlocked()) {
        reviewBtn.disabled = true;
        var status = showStatus(doc, wrap, t("transfer.checking", "Checking recipient, asset, and fee…"));
        Promise.resolve().then(async function () {
          var typed = fromF.input.value.trim() || from.id;
          var rf = await Account.resolve(typed);
          var wid = await Account.myAccountId();
          if (rf.id !== wid) {
            var err = new Error("from-mismatch");
            /* TYPE NOTE: named mismatch fields ride on the Error for the
             * catch below; casts pin the ad-hoc shape. Local only. */
            (/** @type {any} */ (err).fromName = rf.name);
            (/** @type {any} */ (err).fromId = rf.id);
            (/** @type {any} */ (err).walletId = wid);
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
          DOM.clear(root);
          TransferConfirm.showConfirm(doc, makeWrap(doc, root), root, from, ctx, function () {
            DOM.clear(root);
            showForm(doc, makeWrap(doc, root), root, from, {
              from: from.name,
              to: ctx.to.name,
              asset: ctx.asset.symbol,
              amount: Format.formatAmount(ctx.amountInt, ctx.asset.precision),
              memo: ctx.memoText,
              encrypted: ctx.memoKind !== "plain",
              feeAsset: feeSym,
              mode: mode,
              proposer: proposerF.input.value,
              expiration: expiryF.input.value,
              reviewPeriod: reviewPeriodF.input.value,
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
          DOM.clear(root);
          showForm(doc, makeWrap(doc, root), root, from, {
            from: fromF.input.value,
            to: toF.input.value,
            asset: assetF.input.value,
            amount: amountF.input.value,
            memo: memoF.input.value,
            encrypted: encBox.checked,
            feeAsset: String(feeSel.value || feeSym),
            mode: mode,
            proposer: proposerF.input.value,
            expiration: expiryF.input.value,
            reviewPeriod: reviewPeriodF.input.value,
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
          feeAsset: feeSym,
          mode: mode,
          proposer: proposerF.input.value,
          expiration: expiryF.input.value,
          reviewPeriod: reviewPeriodF.input.value
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
    DOM.clear(box);
    reviewBtn.disabled = true;
    showStatus(doc, box, t("transfer.checking", "Checking recipient, asset, and fee…"));
    function done() { reviewBtn.disabled = false; }
    Promise.resolve().then(async function () {
      if (!vals.to || !String(vals.to).trim()) throw new Error(t("transfer.recipient_required", "Recipient is required."));
      var fromAcc = await Account.resolve(String(vals.from || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
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
      DOM.clear(box);
      box.appendChild(DOM.el(doc, "h3", t("transfer.preview_title", "Transfer preview (locked)")));
      var list = DOM.el(doc, "dl", null, "xfer-confirm");
      function row(term, text, title) {
        list.appendChild(DOM.el(doc, "dt", term));
        var dd = DOM.el(doc, "dd", text);
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
      box.appendChild(DOM.el(doc, "p",
        t("transfer.locked_sign_hint", "Unlock to sign — the password is asked only here, at signing."), "muted"));
      var pwRow = DOM.el(doc, "div", null, "xfer-field");
      var pw = doc.createElement("input");
      pw.type = "password"; pw.setAttribute("autocomplete", "current-password");
      pw.setAttribute("aria-label", t("wallet.password", "Password")); touchable(pw); pwRow.appendChild(pw);
      var ub = touchable(DOM.el(doc, "button", t("transfer.unlock_sign", "Unlock & Sign")));
      ub.type = "button"; pwRow.appendChild(ub);
      box.appendChild(pwRow);
      ub.addEventListener("click", function () {
        ub.disabled = true;
        showStatus(doc, box, t("transfer.unlocking", "Unlocking…"));
        /* H2: wipe the password local + input on either outcome. */
        var pwStr = pw.value;
        Promise.resolve().then(function () { return Wallet.unlock(pwStr); })
          .then(function (r) { try { pw.value = ""; } catch (wipeErr) { /* input gone */ } pwStr = null; return r; })
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
            DOM.clear(root);
            TransferConfirm.showConfirm(doc, makeWrap(doc, root), root, P.fromAcc, ctx, function () {
              DOM.clear(root);
              showForm(doc, makeWrap(doc, root), root, P.fromAcc, {
                from: P.fromAcc.name, to: ctx.to.name, asset: ctx.asset.symbol,
                amount: Format.formatAmount(ctx.amountInt, ctx.asset.precision),
                memo: ctx.memoText, encrypted: ctx.memoKind !== "plain",
                feeAsset: P.feeSym, mode: (vals.mode || "send"),
                proposer: vals.proposer, expiration: vals.expiration,
                reviewPeriod: vals.reviewPeriod, error: null
              });
            });
          })
          .catch(function (e2) {
            try { pw.value = ""; } catch (wipeErr2) { /* input gone */ }
            pwStr = null;
            ub.disabled = false;
            showError(doc, box, e2, t("transfer.unlock_failed", "Unlock failed"));
          });
      });
      done();
    }).catch(function (e) {
      DOM.clear(box);
      showError(doc, box, (e && e.message) ? e.message : String(e || "Could not prepare the transfer."),
        t("transfer.prepare_failed", "Could not prepare the transfer."));
      done();
    });
  }

  /* datetime-local (16 chars, no seconds) or full ISO -> chain ISO with
   * seconds. Throws plain "required"/"invalid" (gating shows them first,
   * so a throw here means a race, never a surprise). */
  function normaliseExpiration(v) {
    var s = String(v || "").trim();
    if (!s) throw new Error(t("transfer.proposal_expiration_required", "Proposal expiration is required."));
    var iso = (s.length === 16) ? s + ":00" : s;
    if (isNaN(Date.parse(iso))) throw new Error(t("transfer.proposal_expiration_invalid", "Proposal expiration is invalid."));
    return iso;
  }

  /* Blank (= none) or a non-negative integer. Returns null or the number. */
  function parseReviewPeriod(v) {
    var s = String(v === undefined || v === null ? "" : v).trim();
    if (s === "") return null;
    if (!/^\d+$/.test(s)) throw new Error(t("transfer.review_period_integer", "Review period must be a non-negative integer."));
    return parseInt(s, 10);
  }

  /* Resolve a propose leg (the enclosed op-0) from a form snapshot. Same
   * node calls + wire shapes as the locked send preview (plain-memo hex
   * path, encrypted via wallet keys when unlocked, locked-encrypted memos
   * excluded from the envelope with a hint row). Returns the human fields
   * plus opData for the {op: [0, opData]} nesting (the barter-ui.js
   * proposeBarter path — never reinvented). Amounts stay integer strings. */
  async function resolveProposeLeg(snap, isLocked) {
    if (!snap.to || !String(snap.to).trim()) {
      throw new Error(t("transfer.recipient_required", "Recipient is required."));
    }
    var fromAcc = await Account.resolve(String(snap.from || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
    var to = await Account.resolve(String(snap.to).trim());
    if (fromAcc.id === to.id) throw new Error(t("transfer.sender_recipient_different", "Sender and recipient must be different."));
    var asset = await lookupAssetLocal(snap.asset);
    var amountInt;
    try {
      amountInt = Format.parseAmount(snap.amount, asset.precision);
    } catch (e) {
      throw new Error(e && e.message ? e.message : "bad amount");
    }
    if (!/[1-9]/.test(amountInt)) {
      throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));
    }
    var memoText = String(snap.memo || ""), memoObj = null, memoKind = "none", lockedEnc = false;
    if (memoText) {
      var toFull = await fullAccountLocal(to.id);
      var toMemoKey = toFull && toFull.options ? toFull.options.memo_key : null;
      if (!toMemoKey) throw new Error(t("transfer.recipient_prefix", "Recipient ") + to.name + t("transfer.no_memo_key_suffix", " has no memo key; clear the memo to continue."));
      if (snap.encrypted) {
        if (isLocked) {
          lockedEnc = true;
          memoKind = "locked-encrypted";
        } else {
          if (!Wallet.keys || !Wallet.keys.memo || !Wallet.keys.memo.wif) throw new Error("wallet-locked");
          memoObj = await (/** @type {any} */ (Crypto).encryptMemo)(memoText, Wallet.keys.memo.wif, toMemoKey);
          memoKind = "encrypted";
        }
      } else {
        var fromPub = "";
        if (!isLocked && Wallet.keys && Wallet.keys.memo && Wallet.keys.memo.pub) {
          fromPub = Wallet.keys.memo.pub;
        }
        memoObj = { from: fromPub, to: toMemoKey, nonce: "0", message: utf8HexLocal(memoText) };
        memoKind = "plain";
      }
    }
    var unsigned0 = await Tx.buildTransfer({
      fromId: fromAcc.id, toId: to.id, amountInt: amountInt, assetId: asset.id, memoObj: memoObj
    });
    return { fromAcc: fromAcc, to: to, asset: asset, amountInt: amountInt,
      memoText: memoText, memoKind: memoKind, lockedEnc: lockedEnc,
      encrypted: !!snap.encrypted, opData: unsigned0.operations[0][1] };
  }

  /* Wrapper fee -> human text. Prefers Asset.describe (the barter feeText
   * pattern) with a Chain get_assets fallback; raw + id when both fail —
   * never a wrong number. Returns {text, sym}. */
  async function feeHumanFor(fee) {
    var id = String(fee.asset_id), raw = String(fee.amount);
    try {
      if (typeof Asset !== "undefined" && Asset && typeof Asset.describe === "function") {
        var d = await Asset.describe(id);
        return { text: Format.formatAmount(raw, d.precision) + " " + d.symbol, sym: d.symbol };
      }
    } catch (e) { /* fallback below */ }
    try {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_assets", [[id]]);
      if (rows && rows[0] && typeof rows[0].precision === "number") {
        return { text: Format.formatAmount(raw, rows[0].precision) + " " + rows[0].symbol, sym: rows[0].symbol };
      }
    } catch (e2) { /* raw fallback stands */ }
    return { text: raw + " (" + id + ")", sym: id };
  }

  /* Propose confirm: named rows (proposer + enclosed transfer + live
   * WRAPPER fee), raw op-22 JSON, Back + Sign & Send. Keys must already be
   * in memory here (the locked path unlocks first in lockedProposePreview,
   * so the password is asked only at signing, never to view). Broadcasts
   * via Proposal.sendAndProve with a proposalsFor + get_objects re-read
   * proof (the new proposal id observed on chain — the barter
   * confirmPropose pattern). built = {proposer, leg, pair, before, snap}. */
  function showProposeConfirm(doc, wrap, root, built, fh, onBack) {
    var leg = built.leg;
    var memoText;
    if (leg.memoKind === "encrypted") memoText = t("transfer.memo_encrypted", "Encrypted");
    else if (leg.memoKind === "plain") memoText = t("transfer.memo_plain_prefix", "Plain: ") + leg.memoText;
    else if (leg.lockedEnc) memoText =
      t("transfer.locked_encrypted_hint", "Encrypted memos need the wallet keys — unlock first, or switch the memo to plain.");
    else memoText = t("transfer.memo_none", "(none)");
    var rev = built.pair[1].review_period_seconds;
    var rows = [
      [t("transfer.proposer_label", "Proposer"), built.proposer.name + " (" + built.proposer.id + ")"],
      [t("transfer.expiration_label", "Expiration"), built.pair[1].expiration_time],
      [t("transfer.review_period_label", "Review period"), (rev === null || rev === undefined) ? t("transfer.review_period_none", "none") : Proposal.durToHuman(rev)],
      [t("confirm.from", "From"), leg.fromAcc.name + " (" + leg.fromAcc.id + ")"],
      [t("confirm.to", "To"), leg.to.name + " (" + leg.to.id + ")"],
      [t("confirm.amount", "Amount"),
        Format.formatAmount(leg.amountInt, leg.asset.precision) + " " + leg.asset.symbol, leg.amountInt],
      [t("confirm.memo", "Memo"), memoText],
      [t("confirm.network", "Network"), networkNameLocal()]];
    var dlg = ConfirmDialog.show({ title: t("transfer.confirm_proposal_title", "Confirm proposal (op 22)"),
      rows: rows, feeHuman: fh.text,
      backLabel: t("confirm.back", "Back"), sendLabel: t("confirm.sign_send", "Sign & Send"),
      onBack: function () { if (typeof onBack === "function") onBack(); },
      onSend: function () { doPropSend(); } });
    /* Enclosed-op note + raw op JSON ride inside the dialog above its
     * actions (old rows-then-notes-then-buttons order, textContent-only). */
    var noteEl = DOM.el(doc, "p", t("transfer.enclosed_op_note", "Enclosed op: transfer (op 0) — executes only after approvals."), "muted");
    var detOp = doc.createElement("details");
    detOp.className = "raw";
    var sumOp = doc.createElement("summary");
    sumOp.setAttribute("aria-label", t("confirm.op_json_label", "Show unsigned operation JSON"));
    detOp.appendChild(sumOp);
    var preOp = doc.createElement("pre");
    try { preOp.textContent = JSON.stringify(built.pair, null, 2); }
    catch (e) { preOp.textContent = String(built.pair); }
    detOp.appendChild(preOp);
    /* Mount first so insertBefore has a parent, then slot notes above actions. */
    wrap.appendChild(dlg);
    (function () {
      try {
        var acts = dlg.querySelector ? dlg.querySelector(".confirm-actions") : null;
        if (acts && acts.parentNode) {
          acts.parentNode.insertBefore(noteEl, acts);
          acts.parentNode.insertBefore(detOp, acts);
          return;
        }
      } catch (e2) { /* fall through */ }
      wrap.appendChild(noteEl);
      wrap.appendChild(detOp);
    })();
    function doPropSend() {
      var btns = dlg.getElementsByTagName("button");
      var backBtn = btns[0], sendBtn = btns[1];
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, wrap, t("confirm.signing", "Signing…"));
      var activeWIF = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!activeWIF) {
        wrap.removeChild(status);
        showError(doc, wrap, new Error("wallet-locked"), t("transfer.err_locked", "Wallet is locked."));
        backBtn.disabled = false;
        sendBtn.disabled = false;
        return;
      }
      Promise.resolve().then(async function () {
        var wid = await Account.myAccountId();
        if (built.proposer.id !== wid) {
          throw new Error(t("transfer.proposer_mismatch_prefix", "Proposer must match the unlocked wallet account (fee-payer signs) — got ") +
            built.proposer.name + " (" + built.proposer.id + t("transfer.proposer_mismatch_wallet_mid", "), wallet is ") + wid + ".");
        }
        var unsigned = await Tx.buildTx([built.pair]);
        status.textContent = t("transfer.s1", "Broadcasting…");
        return Proposal.sendAndProve(unsigned, activeWIF, async function () {
          var now = await Proposal.proposalsFor(built.proposer.name || built.proposer.id);
          if (!now || now.length <= built.before) return null;
          var cand = now[now.length - 1];
          try {
            var full = await Proposal.proposal(cand.id);
            return { slim: cand, full: full };
          } catch (e) {
            return { slim: cand, full: null };
          }
        });
      }).then(async function (res) {
        var head = 0;
        try {
          head = (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
        } catch (e) { /* head stays 0 — never blocks the proof */ }
        DOM.clear(root);
        showProposeResult(doc, makeWrap(doc, root), root, built, fh, res, head);
      }).catch(function (e) {
        var msg = (e && e.message) ? e.message : t("transfer.could_not_build_proposal", "Could not build the proposal.");
        if (wrap.contains(status)) wrap.removeChild(status);
        showError(doc, wrap, msg, t("transfer.prepare_failed", "Could not prepare the transfer."));
        backBtn.disabled = false;
        sendBtn.disabled = false;
      });
    }
  }

  /* Proposal result: the re-read proposal id + head block + channel.
   * Links to the proposals page. Never blank. */
  function showProposeResult(doc, wrap, root, built, fh, res, head) {
    wrap.appendChild(DOM.el(doc, "h1", t("transfer.proposal_sent_title", "Proposal sent")));
    var pid = "?";
    try {
      if (res && res.proof) {
        if (res.proof.slim && res.proof.slim.id) pid = res.proof.slim.id;
        else if (res.proof.id) pid = res.proof.id;
      }
    } catch (e) { /* "?" stands */ }
    var via = (res && res.via) ? res.via : "?";
    var ok = DOM.el(doc, "p", t("transfer.proposal_observed_prefix", "Proposal ") + pid + t("transfer.proposal_observed_mid", " observed at head block #") + String(head) + " (" + via + ").", "xfer-ok");
    ok.setAttribute("aria-live", "polite");
    wrap.appendChild(ok);
    wrap.appendChild(DOM.el(doc, "p",
      Format.formatAmount(built.leg.amountInt, built.leg.asset.precision) + " " +
      built.leg.asset.symbol + " → " + built.leg.to.name + t("transfer.enclosed_fee_mid", " enclosed; fee ") + fh.text + ".", "muted"));
    var link = DOM.el(doc, "a", t("transfer.view_proposals", "View proposals"));
    link.setAttribute("href", "#/proposals");
    touchable(link);
    wrap.appendChild(link);
  }

  /* Unlocked propose review: resolve the proposer (must EQUAL the wallet —
   * the fee-payer signs now) + the leg (From may differ: the inner
   * transfer authorizes later), wrap the [0, opData] pair via
   * Proposal.buildCreate, quote the WRAPPER fee live, then confirm.
   * Failures rebuild the form with every input preserved. */
  function proposeReviewUnlocked(doc, wrap, root, from, snap, reviewBtn) {
    reviewBtn.disabled = true;
    var status = showStatus(doc, wrap, t("transfer.checking", "Checking recipient, asset, and fee…"));
    function fail(msg) {
      if (wrap.contains(status)) wrap.removeChild(status);
      DOM.clear(root);
      showForm(doc, makeWrap(doc, root), root, from, {
        from: snap.from, to: snap.to, asset: snap.asset, amount: snap.amount,
        memo: snap.memo, encrypted: snap.encrypted, feeAsset: snap.feeAsset,
        mode: "propose", proposer: snap.proposer, expiration: snap.expiration,
        reviewPeriod: snap.reviewPeriod, error: msg
      });
    }
    Promise.resolve().then(async function () {
      if (typeof Proposal === "undefined" || !Proposal || typeof Proposal.buildCreate !== "function") {
        throw new Error(t("transfer.proposal_backend_missing", "Proposal backend missing: js/proposal.js failed to load."));
      }
      var wid = await Account.myAccountId();
      var proposer = await Account.resolve(String(snap.proposer || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
      if (proposer.id !== wid) {
        throw new Error(t("transfer.proposer_mismatch_prefix", "Proposer must match the unlocked wallet account (fee-payer signs) — got ") +
          proposer.name + " (" + proposer.id + t("transfer.proposer_mismatch_wallet_mid", "), wallet is ") + wid + ".");
      }
      var leg = await resolveProposeLeg(snap, false);
      var expIso = normaliseExpiration(snap.expiration);
      var rev = parseReviewPeriod(snap.reviewPeriod);
      var pair = Proposal.buildCreate({ feePayerId: proposer.id, expirationIso: expIso,
        reviewPeriodSecOrNull: rev, innerOps: [{ op: [0, leg.opData] }] });
      var before = (await Proposal.proposalsFor(proposer.name || proposer.id)).length;
      await Proposal.fee(pair, "1.3.0");
      return { proposer: proposer, leg: leg, pair: pair, before: before, snap: snap };
    }).then(function (built) {
      feeHumanFor(built.pair[1].fee).then(function (fh) {
        if (wrap.contains(status)) wrap.removeChild(status);
        DOM.clear(root);
        var w2 = makeWrap(doc, root);
        showProposeConfirm(doc, w2, root, built, fh, function () {
          DOM.clear(root);
          showForm(doc, makeWrap(doc, root), root, from, {
            from: built.snap.from, to: built.snap.to, asset: built.snap.asset,
            amount: built.snap.amount, memo: built.snap.memo, encrypted: built.snap.encrypted,
            feeAsset: built.snap.feeAsset, mode: "propose",
            proposer: built.snap.proposer, expiration: built.snap.expiration,
            reviewPeriod: built.snap.reviewPeriod, error: null
          });
        });
      }).catch(function (e) {
        fail((e && e.message) ? e.message : t("transfer.could_not_build_proposal", "Could not build the proposal."));
      });
    }).catch(function (e) {
      fail((e && e.message) ? e.message : t("transfer.could_not_build_proposal", "Could not build the proposal."));
    });
  }

  /* Locked propose preview: read-only named rows + LIVE wrapper fee under
   * the form (proposer input defaults to 1.2.0 with the notice above);
   * the password is asked only at Unlock & Sign. After unlock the proposal
   * is REBUILT with the wallet as proposer (the fee-payer must sign) and
   * quoted again — a switch note names the change, so the preview never
   * signs something it did not show. */
  function lockedProposePreview(doc, box, root, vals, reviewBtn) {
    DOM.clear(box);
    reviewBtn.disabled = true;
    showStatus(doc, box, t("transfer.checking", "Checking recipient, asset, and fee…"));
    function done() { reviewBtn.disabled = false; }
    Promise.resolve().then(async function () {
      if (typeof Proposal === "undefined" || !Proposal || typeof Proposal.buildCreate !== "function") {
        throw new Error(t("transfer.proposal_backend_missing", "Proposal backend missing: js/proposal.js failed to load."));
      }
      var proposer = await Account.resolve(String(vals.proposer || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
      var leg = await resolveProposeLeg(vals, true);
      var expIso = normaliseExpiration(vals.expiration);
      var rev = parseReviewPeriod(vals.reviewPeriod);
      var pair = Proposal.buildCreate({ feePayerId: proposer.id, expirationIso: expIso,
        reviewPeriodSecOrNull: rev, innerOps: [{ op: [0, leg.opData] }] });
      await Proposal.fee(pair, "1.3.0");
      var fh = await feeHumanFor(pair[1].fee);
      return { proposer: proposer, leg: leg, pair: pair, fh: fh };
    }).then(function (P) {
      DOM.clear(box);
      box.appendChild(DOM.el(doc, "h3", t("transfer.propose_preview_title", "Proposal preview (locked)")));
      var list = DOM.el(doc, "dl", null, "xfer-confirm");
      function row(term, text, title) {
        list.appendChild(DOM.el(doc, "dt", term));
        var dd = DOM.el(doc, "dd", text);
        if (title) dd.title = title;
        list.appendChild(dd);
      }
      row(t("transfer.proposer_label", "Proposer"), P.proposer.name + " (" + P.proposer.id + ")");
      row(t("transfer.expiration_label", "Expiration"), P.pair[1].expiration_time);
      var rev = P.pair[1].review_period_seconds;
      row(t("transfer.review_period_label", "Review period"), (rev === null || rev === undefined) ? t("transfer.review_period_none", "none") : Proposal.durToHuman(rev));
      row(t("confirm.from", "From"), P.leg.fromAcc.name + " (" + P.leg.fromAcc.id + ")");
      row(t("confirm.to", "To"), P.leg.to.name + " (" + P.leg.to.id + ")");
      row(t("confirm.amount", "Amount"),
        Format.formatAmount(P.leg.amountInt, P.leg.asset.precision) + " " + P.leg.asset.symbol, P.leg.amountInt);
      row(t("confirm.memo", "Memo"), P.leg.memoKind === "plain" ? t("transfer.memo_plain_prefix", "Plain: ") + P.leg.memoText :
        (P.leg.lockedEnc ? t("transfer.locked_encrypted_hint", "Encrypted memos need the wallet keys — unlock first, or switch the memo to plain.") : t("transfer.memo_none", "(none)")));
      row(t("transfer.fee_live_label", "Fee (live)"), P.fh.text, String(P.pair[1].fee.amount));
      row(t("confirm.network", "Network"), networkNameLocal());
      box.appendChild(list);
      box.appendChild(DOM.el(doc, "p",
        t("transfer.locked_sign_hint", "Unlock to sign — the password is asked only here, at signing."), "muted"));
      var pwRow = DOM.el(doc, "div", null, "xfer-field");
      var pw = doc.createElement("input");
      pw.type = "password"; pw.setAttribute("autocomplete", "current-password");
      pw.setAttribute("aria-label", t("wallet.password", "Password")); touchable(pw); pwRow.appendChild(pw);
      var ub = touchable(DOM.el(doc, "button", t("transfer.unlock_sign", "Unlock & Sign")));
      ub.type = "button"; pwRow.appendChild(ub);
      box.appendChild(pwRow);
      ub.addEventListener("click", function () {
        ub.disabled = true;
        showStatus(doc, box, t("transfer.unlocking", "Unlocking…"));
        /* H2: wipe the password local + input on either outcome. */
        var pwStr = pw.value;
        Promise.resolve().then(function () { return Wallet.unlock(pwStr); })
          .then(function (r) { try { pw.value = ""; } catch (wipeErr) { /* input gone */ } pwStr = null; return r; })
          .then(function () { return Account.myAccountId(); })
          .then(async function (wid) {
            var proposer = await Account.resolve(wid);
            var snap2 = {
              from: vals.from, to: vals.to, asset: vals.asset, amount: vals.amount,
              memo: vals.memo, encrypted: vals.encrypted, feeAsset: vals.feeAsset,
              proposer: wid, expiration: vals.expiration, reviewPeriod: vals.reviewPeriod
            };
            var leg = await resolveProposeLeg(snap2, false);
            var pair = Proposal.buildCreate({ feePayerId: wid,
              expirationIso: normaliseExpiration(snap2.expiration),
              reviewPeriodSecOrNull: parseReviewPeriod(snap2.reviewPeriod),
              innerOps: [{ op: [0, leg.opData] }] });
            var before = (await Proposal.proposalsFor(proposer.name || wid)).length;
            await Proposal.fee(pair, "1.3.0");
            var fh = await feeHumanFor(pair[1].fee);
            var typed = String(vals.proposer || "").trim();
            var switched = typed !== "" && typed !== wid && typed !== proposer.name;
            return { proposer: proposer, leg: leg, pair: pair, before: before,
              snap: snap2, fh: fh, switched: switched };
          })
          .then(function (built) {
            DOM.clear(root);
            var w2 = makeWrap(doc, root);
            if (built.switched) {
              w2.appendChild(DOM.el(doc, "p",
                t("transfer.unlocked_rebuilt_prefix", "Unlocked — proposal rebuilt with you (") + built.proposer.name + t("transfer.unlocked_rebuilt_suffix", ") as proposer."), "muted"));
            }
            showProposeConfirm(doc, w2, root, built, built.fh, function () {
              DOM.clear(root);
              showForm(doc, makeWrap(doc, root), root, built.proposer, {
                from: built.snap.from, to: built.snap.to, asset: built.snap.asset,
                amount: built.snap.amount, memo: built.snap.memo, encrypted: built.snap.encrypted,
                feeAsset: built.snap.feeAsset, mode: "propose",
                proposer: built.snap.proposer, expiration: built.snap.expiration,
                reviewPeriod: built.snap.reviewPeriod, error: null
              });
            });
          })
          .catch(function (e2) {
            try { pw.value = ""; } catch (wipeErr2) { /* input gone */ }
            pwStr = null;
            ub.disabled = false;
            showError(doc, box, e2, t("transfer.unlock_failed", "Unlock failed"));
          });
      });
      done();
    }).catch(function (e) {
      DOM.clear(box);
      showError(doc, box, (e && e.message) ? e.message : t("transfer.could_not_build_proposal", "Could not build the proposal."),
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
