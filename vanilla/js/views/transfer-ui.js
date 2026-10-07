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
  * Split (2026-10-04): lockedPreview + its local lookups moved verbatim
  * to transfer-preview.js (TransferPreview.lockedPreview); the propose
  * block moved verbatim to transfer-propose.js
  * (TransferPropose.proposeReviewUnlocked/lockedProposePreview). Both
  * receive facade helpers via a trailing env ({showForm, makeWrap,
  * showError, showStatus} — same function objects, zero behavior
  * change). Share/deep-link helpers stay here: the
  * tooling/transfer-share-test.js harness loads this file standalone.
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
  * precision/symbol — owned here). The unlocked Review passes the choice
  * as feeAsset into TransferConfirm.review, which settles feeAssetId in
  * the chosen asset and returns its display meta for the confirm — the
  * quote note below names the settling asset, and a fee is never charged
  * in a mislabeled asset.
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

  /* formEnv: the facade-owned helpers the split modules need
   * (preview + propose onBack paths). Same function objects the
   * pre-split file called directly — threaded as a trailing env so
   * the modules never read the TransferUI global. Never null. */
  function formEnv() {
    return { showForm: showForm, makeWrap: makeWrap, showError: showError, showStatus: showStatus };
  }

  /* hashQuery(): ?to= (via path :to) ?asset= ?amount= ?memo= prefill —
   * parsed from location.hash, plain decode, no deps. A query memo forces
   * plaintext (gateways cannot read encrypted memos). Amount is gated by
   * AMOUNT_RE below (same shape as the invoice worker) — precision is
   * enforced later at review via Format.parseAmount, never here. */
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
  /* AMOUNT_RE: share-link/invoice amount shape (digits, optional decimals).
   * Gate only — precision is enforced at review (Format.parseAmount). */
  var AMOUNT_RE = /^\d+(\.\d+)?$/;
  /* shareAmount: query amount string or "" (unit-tested). Params: raw
   * (anything). Returns the string when it matches AMOUNT_RE and is
   * nonzero, else "". Never throws. */
  function shareAmount(raw) {
    try {
      if (typeof raw === "string" && AMOUNT_RE.test(raw) && Number(raw) > 0) return raw;
    } catch (e) { /* "" below */ }
    return "";
  }
  /* contactNames: local contacts + favourite accounts for the To datalist.
   * WHY read-only reuse: account-ui.js owns CONTACTS_KEY
   * ("bts-vanilla-contacts-v1", plain-name watch-list) and favourites-ui.js
   * owns ACCOUNTS_KEY ("bts-vanilla-fav-accounts-v1", {name,id} pairs) —
   * this form only SUGGESTS from both (same keys proposal-ui.js localTrust
   * reads), never writes, so no new storage and no ownership split. The
   * blur-check below stays the validator; the list is a hint only, and
   * empty/broken storage yields no datalist with the form unchanged.
   * @returns {string[]} deduped names/ids, possibly empty. Never throws. */
  function contactNames() {
    var out = [], seen = {};
    function push(v) {
      var s = String(v || "").trim();
      if (!s || seen[s.toLowerCase()]) return;
      seen[s.toLowerCase()] = 1;
      out.push(s);
    }
    try {
      if (typeof localStorage !== "undefined") {
        var c = JSON.parse(localStorage.getItem("bts-vanilla-contacts-v1") || "[]");
        (Array.isArray(c) ? c : []).forEach(function (x) { if (typeof x === "string") push(x); });
        var f = JSON.parse(localStorage.getItem("bts-vanilla-fav-accounts-v1") || "[]");
        (Array.isArray(f) ? f : []).forEach(function (x) {
          if (x && typeof x === "object") { push(x.name); push(x.id); }
          else if (typeof x === "string") push(x);
        });
      }
    } catch (e) { /* empty stands */ }
    return out;
  }
  /* shareHash: pre-filled transfer deep link (unit-tested). Params: to,
   * asset, amount, memo strings (any may be ""). Returns "#/transfer?..."
   * with only non-empty params, encodeURIComponent-encoded. Pure. */
  function shareHash(to, asset, amount, memo) {    var parts = [];
    try {
      if (to) parts.push("to=" + encodeURIComponent(to));
      if (asset) parts.push("asset=" + encodeURIComponent(asset));
      if (amount) parts.push("amount=" + encodeURIComponent(amount));
      if (memo) parts.push("memo=" + encodeURIComponent(memo));
    } catch (e) { /* partial stands */ }
    return "#/transfer" + (parts.length ? ("?" + parts.join("&")) : "");
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
      wrap.appendChild(DOM.el(doc, "p", t("common.status_connecting", "Connecting to network…"), "muted"));
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
        showError(doc, failWrap, new Error("not connected"), t("common.network_unavailable_short", "Network unavailable."));
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
        amount: shareAmount(q.amount),
        memo: q.memo || "",
        encrypted: !q.memo,
        feeAsset: null,
        error: null
      });
    }).catch(function (e) {
      DOM.clear(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(DOM.pageHead(doc, t("transfer.title", "Transfer"), "transfer"));
      showError(doc, failed, e, t("transfer.load_account_failed", "Could not load your account."));
    });
  }

  /* Verbatim copies of transfer-propose.js locals (same per-file convention
   * as the market-ui split): the facade's send path kept these call sites,
   * so they live here too — doctrine prefers duplication over a shared
   * chain-lookup abstraction. */
  function utf8HexLocal(str) {
    var bytes = new TextEncoder().encode(str);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }
  async function lookupAssetLocal(symbol) {
    var sym = String(symbol || "").trim().toUpperCase();
    if (!sym) throw new Error(t("transfer.asset_required", "Asset symbol is required."));
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "lookup_asset_symbols", [[sym]]);
    if (!rows || !rows[0]) throw new Error(t("transfer.unknown_asset_prefix", "Unknown asset: ") + sym + ".");
    if (typeof rows[0].precision !== "number") throw new Error("bad-asset-shape");
    return { id: rows[0].id, symbol: rows[0].symbol, precision: rows[0].precision };
  }
  async function fullAccountLocal(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_accounts", [[id]]);
    if (!rows || !rows[0]) throw new Error("unknown-account");
    return rows[0];
  }

  /* Transfer form. From is an EDITABLE account input (defaults to the wallet
   * account, else committee-account 1.2.0 while locked); To / Asset / Amount
   * / Memo are inputs; Encrypted defaults ON. Unlocked reviews require From
   * to equal the wallet account (review signs as the wallet). Locked reviews
   * preview read-only below the form; password is asked only at Sign & Send.
   * Errors stay inline above a preserved form — input is never wiped. */
  function showForm(doc, wrap, root, from, state) {
    var locked = (typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked());
    wrap.appendChild(DOM.pageHead(doc, t("transfer.title", "Transfer"), "transfer"));
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
    /* To autocomplete (read-only reuse, no new storage): a datalist of
     * contactNames() (contacts + favourite accounts). WHY a datalist, not a
     * select: the field stays free text (any account remains typable) with
     * suggestions only; the blur-check + review gating above stay the
     * validators. No strings, no new keys, no touch work (native options). */
    try {
      var _names = contactNames();
      if (_names.length && toF.input && typeof toF.input.setAttribute === "function") {
        var _dl = doc.createElement("datalist");
        _dl.id = "xfer-to-list";
        _names.forEach(function (n) {
          var _o = doc.createElement("option");
          _o.value = n;
          _dl.appendChild(_o);
        });
        wrap.appendChild(_dl);
        toF.input.setAttribute("list", "xfer-to-list");
      }
    } catch (e) { /* free text stands */ }

    /* Asset field (component-wisdom Rec 1): a stable INPUT with a
     * datalist combobox of the sender's non-zero balance symbols once they
     * load (free-text fallback when locked or when the load fails, so the
     * form never blocks). WHY never a swapped <select>: replacing the
     * control type under the user breaks focus, native keyboards, and the
     * already-bound events; the To field above (:467-485) is the precedent.
     * Every reader below uses assetF.input at event time, never a cached
     * node. */
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
      placeholder: t("common.name_or_id_hint", "name or 1.2.N"), autocomplete: "off"
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
    var _pv = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
    var proposeNotice = DOM.el(doc, "p",
      t("transfer.propose_notice_locked", "Proposer defaults to %(name)s (%(id)s) while locked — unlock to act as yourself.", { name: _pv.name, id: _pv.id }) + " " + t("transfer.propose_notice_fee", "Proposal fee is quoted live in the core asset at review."), "muted");
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

    /* Shareable link (invoice share-row precedent, misc-ui.js:512-579 —
     * copy-link only, no QR by decision). Reads the LIVE inputs at tap
     * time so the link reflects the form, not the entry query. Requires
     * recipient + amount; precision stays a review-time check. */
    wrap.appendChild(DOM.el(doc, "h2", t("misc.shareable_link", "Shareable link")));
    var shareTa = doc.createElement("textarea");
    shareTa.value = "";
    shareTa.setAttribute("rows", "2"); shareTa.readOnly = true;
    try { shareTa.style.width = "100%"; } catch (e) { /* unstyled stands */ }
    touchable(shareTa);
    wrap.appendChild(shareTa);
    var shareCopy = touchable(DOM.el(doc, "button", t("misc.copy_link", "Copy link")));
    shareCopy.type = "button";
    wrap.appendChild(shareCopy);
    wrap.appendChild(doc.createTextNode(" "));
    var shareNote = DOM.el(doc, "span", "", "muted");
    try { shareNote.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    wrap.appendChild(shareNote);
    shareCopy.addEventListener("click", function () {
      var to = "", asset = "", amt = "", memo = "";
      try {
        to = toF.input.value.trim();
        asset = assetF.input.value.trim() || coreSymbol();
        amt = amountF.input.value.trim();
        memo = memoF.input.value.trim();
      } catch (e) { /* empties stand */ }
      if (!to || !shareAmount(amt)) {
        shareNote.textContent = t("transfer.share_needs_to_amount", "A shareable link needs a recipient and an amount.");
        return;
      }
      var hash = shareHash(to, asset, amt, memo), url = hash;
      try {
        if (typeof location !== "undefined" && location.href) url = location.href.split("#")[0] + hash;
      } catch (e) { url = hash; }
      shareTa.value = url;
      shareCopy.disabled = true;
      shareNote.textContent = t("misc.copying", "Copying…");
      function done(ok) {
        try { shareCopy.disabled = false; } catch (e) { /* stands */ }
        shareNote.textContent = ok ? t("misc.copied", "Copied")
          : t("misc.copy_failed_select_manually", "Copy failed — select the link manually");
      }
      function fallback() {
        try {
          var ta = doc.createElement("textarea");
          ta.value = url; doc.body.appendChild(ta); ta.select();
          var ok = false;
          try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
          try { ta.parentNode.removeChild(ta); } catch (e2) { /* gone */ }
          done(!!ok);
        } catch (e) { done(false); }
      }
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(url).then(function () { done(true); }, function () { fallback(); });
        } else fallback();
      } catch (e) { fallback(); }
    });

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

    /* Live asset value, read at event time (never cached). */
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
     * the confirm settles the exact fee in the CHOSEN fee asset (named in
     * the note — TransferConfirm.review threads the same choice into its
     * Tx.fee call). Hidden on any failure. */
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
        feeQuote.appendChild(doc.createTextNode(t("transfer.confirm_settles_the_fee_in", " — Confirm settles the fee in ") + stampSym + "."));
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

    /* Asset input events, bound once: the input element is stable for the
     * life of the form (datalist suggestions only, never a control swap). */
    function bindAssetEvents() {
      assetF.input.addEventListener("input", function () {
        refreshFeeOpts(); refreshAvail(); updateGate();
      });
      assetF.input.addEventListener("change", function () {
        refreshFeeOpts(); refreshAvail(); updateGate();
      });
    }

    /* Unlocked asset combobox: resolve the sender, load non-zero balances,
     * and offer their symbols as datalist suggestions on the stable text
     * input (current/prefill value survives: it is never replaced, and the
     * union appends it when absent from balances). Any failure keeps the
     * plain free-text input — the form never blocks, and the unknown-asset
     * review catch still guards every path. */
    function refreshAssetList() {
      if (!assetF.input || assetF.input.tagName !== "INPUT") return;
      var cur = assetVal().toUpperCase();
      var seen = {};
      var opts = [];
      var i;
      for (i = 0; i < bals.length; i++) {
        seen[String(bals[i].symbol).toUpperCase()] = 1;
        opts.push(bals[i].symbol);
      }
      if (cur && !seen[cur]) opts.push(cur);
      if (!opts.length) return;
      var dl = doc.getElementById("xfer-asset-list");
      if (!dl) {
        dl = doc.createElement("datalist");
        dl.id = "xfer-asset-list";
        assetF.row.appendChild(dl);
        assetF.input.setAttribute("list", "xfer-asset-list");
      } else {
        while (dl.firstChild) dl.removeChild(dl.firstChild);
      }
      for (i = 0; i < opts.length; i++) {
        var o = doc.createElement("option");
        o.value = opts[i];
        dl.appendChild(o);
      }
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
        refreshAssetList();
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
          TransferPropose.proposeReviewUnlocked(doc, wrap, root, from, snap, reviewBtn, formEnv());
        } else {
          TransferPropose.lockedProposePreview(doc, previewBox, root, snap, reviewBtn, formEnv());
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
            feeAsset: feeSym /* the chosen fee asset; review settles +
              displays it, see header */
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
            setFieldError(toF, t("common.unknown_account", "Unknown account."));
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
        TransferPreview.lockedPreview(doc, previewBox, root, {
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
        }, reviewBtn, formEnv());
      }
    });
  }

  /* lockedPreview + its local lookups (utf8HexLocal, lookupAssetLocal,
   * fullAccountLocal, networkNameLocal) live in transfer-preview.js
   * (TransferPreview.lockedPreview, verbatim + env) — called from
   * showForm above. */

  /* Propose block (normaliseExpiration … lockedProposePreview) lives in
   * transfer-propose.js (TransferPropose.*, verbatim + env) — called
   * from showForm above. */

  /* review/showConfirm/showResult moved verbatim to transfer-confirm.js
   * (confirm side) — called above as TransferConfirm.*. */

  return {
    renderTransfer: renderTransfer,
    _test: { shareHash: shareHash, shareAmount: shareAmount }
  };
})();

if (typeof module !== "undefined") { module.exports = TransferUI; }
