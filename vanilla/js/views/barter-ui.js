/* barter-ui.js — #/barter two-sided barter form + atomic preview (split OUT of credit-ui.js).
 * Owns: peer A / peer B account inputs + N asset rows per side (mirrors #1
 *   Showcases/Barter.jsx add-asset pattern) + optional escrow leg + per-side
 *   balance warnings (integer math, port the SHAPE of Barter.jsx
 *   checkAmountsTotal) + human-readable atomic preview ("A gives X → B; B
 *   gives Y → A") + live leg-fee hints (each leg fee-estimated as a transfer)
 *   + PROPOSE button wired to Proposal.buildCreate (op 22, slice 14): the two
 *   sides' legs become enclosed transfer ops, fee-payer = Peer A, live op-22
 *   fee, standard confirm, prove by proposalsFor re-read. ZERO new serializers
 *   for barter — ever: #1 builds a transfer_list handed to op-22 create, and
 *   this form calls Proposal.buildCreate with the same shape. Escrow stays
 *   preview-only (verified: no escrow party in tx.js nor proposal.js
 *   serializers — toggle + display upgrade only, gap noted in-preview). This form
 *   broadcasts ONLY via the PROPOSE path after preview. Offline shows Retry
 *   plus auto-resubscribe on reconnect (htlc-ui pattern).
 * PUBLIC-FIRST (gate repair): no wallet gate — the two-sided form + atomic
 *   preview render locked; peer inputs default to committee-account 1.2.0
 *   while locked with a viewing notice. Password is asked only at Sign &
 *   Send (confirmPropose sign-time gate + inline unlock).
 * Consumes: Format (parse/format, string math only), Account (resolve/balances),
 *   Asset.describe, Tx.fee (leg hints only — never broadcast), Chain/Store,
 *   Wallet (unlock gate only). Created by: building-vanilla-slices skill,
 *   slice-13-credit plan Task 3 (pre-authorized split — credit-ui.js cap).
 * CHAIN TRUTH (#4 wins): barter = op-22 UI over transfer lists
 *   (bitshares-ui Showcases/Barter.jsx:335-450, App.jsx:159-162 route). No
 *   chain call is made here except reads (resolve/describe/balances/fee hints).
 */
var BarterUI = (function () {
  "use strict";

  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. vars supports
   * %(name)s templates at a few asset/named-count labels. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  var gen = 0;
  var openSubs = []; /* pending connect watchers; drained on every entry so none leak */
  function dropOpenSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }
  /* Re-run the entry when the socket opens (htlc-ui autoRetryOnOpen pattern).
   * Barter owns its gen, so the isLive gate is passed spotlight-style
   * (debit-ui precedent): a closure over this entry's gen. */
  function autoRetryOnOpen(myGen, retryFn, isLive) {
    try {
      var live = isLive || function () { return myGen === gen; };
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (!live()) { settled = true; try { off(); } catch (e) {} return; }
        if (st && st.state === "open") {
          settled = true; try { off(); } catch (e) {}
          if (typeof location === "undefined" || location.hash === hashAtEntry) retryFn();
        }
      });
      openSubs.push(off);
    } catch (e) { /* subscribe unavailable: manual Retry remains */ }
  }

  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || t("barter.unexpected_error", "Unexpected error"));
    if (m.indexOf("not-connected") !== -1) m = t("barter.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    else if (m.indexOf("wallet-locked") !== -1) m = t("barter.wallet_is_locked", "Wallet is locked.");
    else if (m.indexOf("unknown-account") !== -1) m = t("barter.unknown_account", "Unknown account.");
    else if (m.indexOf("unknown-asset") !== -1) m = t("barter.unknown_asset", "Unknown asset.");
    var err = DOM.error(wrap, m);
    return err;
  }
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text);
    return p;
  }
  /* No local field builder — use Forms.labeledInput (row + input). */
  /* Default viewing account while locked: committee-account 1.2.0 (a public
   * chain object on testnet+mainnet, verified live 2026-09-28). The preview
   * resolves peer names/leg balances publicly; PROPOSE gates at Sign & Send. */
  var VIEWING_AS_ID = "1.2.0", VIEWING_AS_NAME = "committee-account";
  function isUnlockedNow() {
    try {
      if (typeof Wallet !== "undefined" && typeof Wallet.isUnlocked === "function") return !!Wallet.isUnlocked();
      return !!(typeof Wallet !== "undefined" && Wallet.keys);
    } catch (e) { return false; }
  }
  function viewingAsNotice(doc) {
    var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
    return DOM.el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: v.name, id: v.id }), "muted");
  }
  function signNotice(doc) {
    return DOM.el(doc, "p", t("barter.locked_preview_note", "Wallet locked — preview only. Password is asked at Sign & Send, never to view."), "muted");
  }
  function unlockInline(doc, parent, onUnlock) { /* in-place password row (no route re-render, so previews survive) */
    if (parent.querySelector && parent.querySelector(".xfer-unlock-row")) return;
    var row = DOM.el(doc, "div", null, "xfer-field xfer-unlock-row");
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("autocomplete", "current-password");
    inp.setAttribute("placeholder", t("barter.password", "password")); inp.setAttribute("aria-label", t("barter.password", "password"));
    touchable(inp); DOM.append(row, inp);
    var b = touchable(DOM.el(doc, "button", t("barter.unlock", "Unlock"))); b.type = "button"; DOM.append(row, b);
    DOM.append(parent, row);
    b.addEventListener("click", function () { b.disabled = true;
      /* H2: wipe the password local + input on either outcome. */
      var pw = inp.value;
      Wallet.unlock(pw).then(function () { inp.value = ""; pw = null; if (onUnlock) onUnlock(); })
        .catch(function (e) { inp.value = ""; pw = null; b.disabled = false; showError(doc, parent, e, t("barter.unlock_failed", "Unlock failed.")); });
    });
  }
  /* One barter leg row: asset + human amount (empty asset rows are skipped). */
  function legRow(doc, box) {
    var r = DOM.el(doc, "div", null, "xfer-field");
    var fa = doc.createElement("input"); fa.setAttribute("placeholder", t("barter.asset_symbol_or_1_3_x", "asset (symbol or 1.3.x)")); touchable(fa);
    var fq = doc.createElement("input"); fq.setAttribute("placeholder", t("barter.amount", "amount")); fq.setAttribute("inputmode", "decimal"); touchable(fq);
    DOM.append(r, fa); DOM.append(r, fq); DOM.append(box, r);
    return { asset: fa, amount: fq };
  }
  /* Route entry: #/barter — two-sided form + escrow + preview; PROPOSE enabled
   * (op-22 via Proposal.buildCreate, slice 14: fee-payer = Peer A, live fee,
   * standard confirm, prove by proposalsFor re-read). */
  function renderBarter(root) {
    if (!root) return;
    var doc = root.ownerDocument || document, myGen = ++gen;
    dropOpenSubs();
    DOM.clear(root);
    ["Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store", "Proposal"].forEach(function () { /* checked below */ });
    var wrap = DOM.append(root, DOM.el(doc, "div", null, "wrap"));
    DOM.append(wrap, DOM.el(doc, "h1", t("barter.barter", "Barter")));
    var miss = ["Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store", "Proposal"].filter(function (g) {
      return typeof globalThis[g] === "undefined"; });
    if (miss.length) { showError(doc, wrap, "Barter backend missing: " + miss.join(", ") + " failed to load."); return; }
    if (Chain.status().state !== "open") {
      DOM.append(wrap, DOM.el(doc, "p", t("barter.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
      var bastat = DOM.el(doc, "p", "", "muted");
      try { bastat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      DOM.append(wrap, bastat);
      var barow = DOM.el(doc, "div", null, "pools-offline-row");
      DOM.append(wrap, barow);
      var retry = touchable(DOM.el(doc, "button", t("barter.retry", "Retry"))); retry.type = "button"; retry.classList.add("btn-ghost");
      DOM.append(barow, retry);
      var baoff = null;
      try { baoff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { baoff = null; }
      var barender = function () { if (myGen === gen) renderBarter(root); };
      if (baoff && typeof baoff.wire === "function") {
        try { baoff.wire(retry, bastat, barender, t); } catch (e) { retry.addEventListener("click", barender); }
      } else {
        retry.addEventListener("click", barender);
      }
      var balink = null;
      if (baoff && typeof baoff.settingsLink === "function") {
        try { balink = baoff.settingsLink(doc, t); } catch (e) { balink = null; }
      }
      if (!balink) {
        balink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
        try { balink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
        touchable(balink);
        balink.classList.add("subtle-btn");
      }
      DOM.append(barow, balink);
      autoRetryOnOpen(myGen, barender, function () { return myGen === gen; });
      try { if (baoff && typeof baoff.ensure === "function") baoff.ensure(); } catch (e) { /* manual Retry remains */ }
      return;
    }
    /* PUBLIC-FIRST: no wallet gate — form + preview render locked. */
    var lockedBar = !isUnlockedNow();
    if (lockedBar) DOM.append(wrap, viewingAsNotice(doc));
    DOM.append(wrap, DOM.el(doc, "p", t("barter.two_sided_atomic_swap_preview_preview_first_t", "Two-sided atomic swap preview. Preview first, then PROPOSE encloses both sides' transfers in one proposal (op 22, fee-payer = Peer A)."), "muted"));
    var fA = Forms.labeledInput(doc, t("barter.peer_a_account", "Peer A account") + " ", lockedBar
      ? { placeholder: t("barter.name_or_1_2_n", "name or 1.2.N"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("barter.name_or_1_2_n", "name or 1.2.N") });
    DOM.append(wrap, fA.row);
    DOM.append(wrap, DOM.el(doc, "h2", t("barter.a_gives", "A gives")));
    var boxA = DOM.el(doc, "div"); DOM.append(wrap, boxA);
    var legsA = [legRow(doc, boxA)];
    var addA = touchable(DOM.el(doc, "button", t("barter.add_asset_row_a", "Add asset row (A)"))); addA.type = "button"; addA.classList.add("subtle-btn"); DOM.append(wrap, addA);
    addA.addEventListener("click", function () { legsA.push(legRow(doc, boxA)); });
    var fB = Forms.labeledInput(doc, t("barter.peer_b_account", "Peer B account") + " ", lockedBar
      ? { placeholder: t("barter.name_or_1_2_n", "name or 1.2.N"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("barter.name_or_1_2_n", "name or 1.2.N") });
    DOM.append(wrap, fB.row);
    DOM.append(wrap, DOM.el(doc, "h2", t("barter.b_gives", "B gives")));
    var boxB = DOM.el(doc, "div"); DOM.append(wrap, boxB);
    var legsB = [legRow(doc, boxB)];
    var addB = touchable(DOM.el(doc, "button", t("barter.add_asset_row_b", "Add asset row (B)"))); addB.type = "button"; addB.classList.add("subtle-btn"); DOM.append(wrap, addB);
    addB.addEventListener("click", function () { legsB.push(legRow(doc, boxB)); });
    /* MED escrow toggle (#1 Barter.jsx:75 showEscrow=false default,
     * :1159-1179 add/remove button): escrow hidden until added. WHY a toggle:
     * the chain serializes no escrow party on op-22 (verified: no "escrow"
     * in tx.js nor proposal.js), so escrow stays preview-only; the toggle
     * makes that explicit instead of an always-visible field implying
     * broadcast. Batch-3 i18n: literals below keyed via t(). */
    var escState = { on: false };
    var escrowBtn = touchable(DOM.el(doc, "button", t("barter.add_escrow", "Add escrow"))); escrowBtn.type = "button"; escrowBtn.classList.add("btn-ghost");
    DOM.append(wrap, escrowBtn);
    var escBox = DOM.el(doc, "div"); escBox.style.display = "none"; DOM.append(wrap, escBox);
    var fEsc = Forms.labeledInput(doc, t("barter.escrow_account_optional", "Escrow account (optional)") + " ", { placeholder: t("barter.blank_none", "blank = none") });
    DOM.append(escBox, fEsc.row);
    escrowBtn.addEventListener("click", function () {
      escState.on = !escState.on;
      escBox.style.display = escState.on ? "" : "none";
      escrowBtn.textContent = escState.on ? t("barter.remove_escrow", "Remove escrow") : t("barter.add_escrow", "Add escrow");
      if (!escState.on) fEsc.input.value = "";
    });
    /* MED fee assets (#1 Barter.jsx:1226-1283 per-side FeeAssetSelector +
     * proposal fee + total): batch-3-keyed inputs; every
     * fee sum below is BigInt via Format, never float. Defaults 1.3.0. */
    var fFeeA = Forms.labeledInput(doc, t("barter.side_a_fee_asset_1_3_x", "Side A fee asset (1.3.x)") + " ", { placeholder: "1.3.0", value: "1.3.0" });
    var fFeeB = Forms.labeledInput(doc, t("barter.side_b_fee_asset_1_3_x", "Side B fee asset (1.3.x)") + " ", { placeholder: "1.3.0", value: "1.3.0" });
    var fPropFee = Forms.labeledInput(doc, t("barter.proposal_fee_asset_1_3_x_due_now", "Proposal fee asset (1.3.x, due now)") + " ", { placeholder: "1.3.0", value: "1.3.0" });
    DOM.append(wrap, fFeeA.row); DOM.append(wrap, fFeeB.row); DOM.append(wrap, fPropFee.row);
    var check = touchable(DOM.el(doc, "button", t("barter.preview_barter", "Preview barter"))); check.type = "button";
    if (lockedBar) DOM.append(wrap, signNotice(doc));
    DOM.append(wrap, check);
    var out = DOM.el(doc, "div", null, "xfer-out"); DOM.append(wrap, out);
    var fExp = Forms.labeledInput(doc, t("barter.proposal_expiration", "Proposal expiration") + " ", { type: "datetime-local", value: defaultExpiration() });
    var fRev = Forms.labeledInput(doc, t("barter.review_period_seconds_optional", "Review period seconds (optional)") + " ", { placeholder: t("barter.blank_none", "blank = none"), inputmode: "numeric" });
    DOM.append(wrap, fExp.row); DOM.append(wrap, fRev.row);
    var propose = touchable(DOM.el(doc, "button", t("barter.propose_barter_op_22", "Propose barter (op 22)")));
    propose.type = "button"; propose.disabled = true;
    propose.title = t("barter.preview_the_barter_first_proposing_needs_reso", "Preview the barter first — proposing needs resolved legs.");
    DOM.append(wrap, propose);
    var proposeOut = DOM.el(doc, "div", null, "xfer-out"); DOM.append(wrap, proposeOut);
    var lastPreview = null;
    check.addEventListener("click", function () {
      if (myGen !== gen) return;
      DOM.clear(out); check.disabled = true; propose.disabled = true; lastPreview = null;
      showStatus(doc, out, t("barter.resolving_and_checking_balances", "Resolving and checking balances…"));
      preview(doc, out, myGen, fA.input.value.trim(), legsA, fB.input.value.trim(), legsB,
        escState.on ? fEsc.input.value.trim() : "", fFeeA.input.value.trim() || "1.3.0",
        fFeeB.input.value.trim() || "1.3.0", fPropFee.input.value.trim() || "1.3.0", escState.on)
        .then(function (res) {
          check.disabled = false;
          if (res && myGen === gen) {
            lastPreview = res; propose.disabled = false;
            propose.title = t("barter.propose_encloses_both", "Enclose both sides as transfer ops in one proposal (fee-payer = %(name)s).", { name: res.A.acct.name });
          }
        })
        .catch(function (e) {
          if (myGen !== gen) return; DOM.clear(out);
          showError(doc, out, e, t("barter.could_not_preview_the_barter", "Could not preview the barter.")); check.disabled = false;
        });
    });
    propose.addEventListener("click", function () {
      if (myGen !== gen || !lastPreview) return;
      proposeBarter(doc, proposeOut, myGen, lastPreview, fExp.input.value.trim(), fRev.input.value.trim(), propose);
    });
  }
  /* Default expiration: now + 24h as a datetime-local value. Date only, never money. */
  function defaultExpiration() {
    var t = new Date(Date.now() + 86400000);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return t.getFullYear() + "-" + p(t.getMonth() + 1) + "-" + p(t.getDate()) + "T" + p(t.getHours()) + ":" + p(t.getMinutes());
  }
  /* PROPOSE (slice-13 deferred proof): two sides' legs -> op-0 pairs ->
   * Proposal.buildCreate (fee-payer = Peer A) -> live op-22 fee -> confirm ->
   * broadcast -> prove by proposalsFor re-read. Escrow stays preview-only. */
  function proposeBarter(doc, out, myGen, prev, expV, revV, btn) {
    DOM.clear(out); btn.disabled = true;
    showStatus(doc, out, t("barter.building_the_proposal", "Building the proposal…"));
    function done() { btn.disabled = false; }
    Promise.resolve().then(async function () {
      if (!expV) throw new Error(t("barter.proposal_expiration_must_be_set", "Proposal expiration must be set."));
      var expIso = expV.length === 16 ? expV + ":00" : expV;
      var rev = (revV === "") ? null : parseInt(revV, 10);
      if (rev !== null && (!Number.isInteger(rev) || rev < 0)) throw new Error(t("barter.review_period_must_be_a_non_negative_integer", "Review period must be a non-negative integer."));
      /* One barter leg -> [0, opData] with NO memo key (null-memo objects die at fee time — key absent, never present-but-null). */
      function leg(fromId, toId, it) {
        // No memo key: the null-memo object shape is rejected by the node at
        // fee time (types.cpp:49 base58 assert), so legs omit memo entirely
        // (the slice-4 proven shape — key absent, never present-but-null).
        return [0, { fee: { amount: "0", asset_id: "1.3.0" }, from: fromId, to: toId,
          amount: { amount: it.raw, asset_id: it.id },
          extensions: [] }];
      }
      var pairs = [];
      prev.A.items.forEach(function (it) { pairs.push(leg(prev.A.acct.id, prev.B.acct.id, it)); });
      prev.B.items.forEach(function (it) { pairs.push(leg(prev.B.acct.id, prev.A.acct.id, it)); });
      var pair = Proposal.buildCreate({ feePayerId: prev.A.acct.id, expirationIso: expIso,
        reviewPeriodSecOrNull: rev, innerOps: pairs.map(function (p) { return { op: p }; }) });
      var before = (await Proposal.proposalsFor(prev.A.acct.name || prev.A.acct.id)).length;
      await Proposal.fee(pair, (prev.propFeeId || "1.3.0"));
      return { pair: pair, before: before };
    }).then(function (built) {
      if (myGen !== gen) return done();
      feeText(built.pair[1].fee).then(function (f) {
        if (myGen !== gen) return done();
        confirmPropose(doc, out, myGen, prev, built, f, btn);
        done();
      }).catch(function (e) { if (myGen === gen) { DOM.clear(out); showError(doc, out, e, t("barter.fee_lookup_failed", "Fee lookup failed.")); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      DOM.clear(out); showError(doc, out, e, t("barter.could_not_build_the_proposal", "Could not build the proposal.")); done();
    });
  }
  /* Fee object -> human + symbol (Asset.describe; raw + id fallback). Returns: Promise of string. */
  async function feeText(fee) {
    try {
      var a = await Asset.describe(fee.asset_id);
      return Format.formatAmount(String(fee.amount), a.precision) + " " + a.symbol;
    } catch (e) { return String(fee.amount) + " (" + fee.asset_id + ")"; }
  }
  /* Nested confirm rows for the barter legs (self-contained: no ProposalUI coupling).
   * Shared ConfirmDialog owns title/rows/fee/Back/Send; leg lines + fee recap
   * ride inside the dialog above its actions; unlock-gating + broadcast stay here. */
  function confirmPropose(doc, out, myGen, prev, built, feeHuman, btn) {
    DOM.clear(out);
    var rows = [[t("barter.fee_payer", "Fee payer"), prev.A.acct.name + " (" + prev.A.acct.id + ")"],
     [t("barter.expiration", "Expiration"), built.pair[1].expiration_time],
     [t("barter.review_period", "Review period"), (built.pair[1].review_period_seconds === null ? t("barter.none", "none") : Proposal.durToHuman(built.pair[1].review_period_seconds))],
     [t("barter.enclosed_transfers", "Enclosed transfers"), String(built.pair[1].proposed_ops.length)]];
    var dlg = ConfirmDialog.show({ title: t("barter.confirm_barter_proposal_op_22", "Confirm barter proposal (op 22)"),
      rows: rows, feeHuman: feeHuman,
      backLabel: t("barter.back", "Back"), sendLabel: t("barter.sign_send", "Sign & Send"),
      onBack: function () { DOM.clear(out); },
      onSend: function () { doSend(); } });
    /* MED fee recap (batch-3 keyed): timing + assets +
     * proposal estimate + BigInt total ride along from preview so the confirm
     * shows what signing pays. Inserted above the dialog actions to keep the
     * old rows-then-notes-then-buttons order. */
    function insertNote(node) {
      try {
        var acts = dlg.querySelector ? dlg.querySelector(".confirm-actions") : null;
        if (acts && acts.parentNode) { acts.parentNode.insertBefore(node, acts); return; }
      } catch (e) { /* fallback below */ }
      DOM.append(dlg, node);
    }
    if (prev.timing) insertNote(DOM.el(doc, "p", prev.timing, "muted"));
    insertNote(DOM.el(doc, "p", t("barter.side_a_fee_asset_prefix", "Side A fee asset: ") + (prev.feeAId || "1.3.0") +
      t("barter.side_b_fee_asset_mid", "; Side B fee asset: ") + (prev.feeBId || "1.3.0") +
      t("barter.proposal_fee_asset_mid", "; proposal fee asset: ") + (prev.propFeeId || "1.3.0") + t("barter.due_now_suffix", " (due now)."), "muted"));
    if (prev.propHuman) insertNote(DOM.el(doc, "p", t("barter.proposal_fee_estimate_prefix", "Proposal fee estimate: ") + prev.propHuman, "muted"));
    if (prev.totalText) insertNote(DOM.el(doc, "p", t("barter.total_fees_prefix", "Total fees: ") + prev.totalText, "muted"));
    prev.A.items.forEach(function (it) {
      insertNote(DOM.el(doc, "p", prev.A.acct.name + " gives " + Format.formatAmount(it.raw, it.prec) +
        " " + it.symbol + " → " + prev.B.acct.name, ""));
    });
    prev.B.items.forEach(function (it) {
      insertNote(DOM.el(doc, "p", prev.B.acct.name + " gives " + Format.formatAmount(it.raw, it.prec) +
        " " + it.symbol + " → " + prev.A.acct.name, ""));
    });
    if (prev.esc) insertNote(DOM.el(doc, "p", "Escrow " + prev.esc.name + " is preview-only — the proposed ops carry the two sides' transfers.", "muted"));
    DOM.append(out, dlg);
    function doSend() {
      if (myGen !== gen) return;
      var btns = dlg.getElementsByTagName("button");
      var back = btns[0], send = btns[1];
      send.disabled = true; back.disabled = true;
      var status = showStatus(doc, out, t("barter.signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) { /* SIGN-TIME GATE: password asked only here — preview stays visible */
        out.removeChild(status);
        if (!out.querySelector || !out.querySelector(".xfer-sign-note")) {
          var note = DOM.el(doc, "p", t("barter.locked_sign_note", "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."), "muted");
          note.className = "muted xfer-sign-note"; DOM.append(out, note);
        }
        unlockInline(doc, out, function () {
          DOM.append(out, DOM.el(doc, "p", t("barter.unlocked_repreview_note", "Unlocked — preview again so the proposal uses your account, then propose."), "muted"));
        });
        send.disabled = false; back.disabled = false; return; }
      Tx.buildTx([built.pair]).then(function (unsigned) {
        status.textContent = t("barter.broadcasting", "Broadcasting…");
        return Proposal.sendAndProve(unsigned, wif, async function () {
          var now = await Proposal.proposalsFor(prev.A.acct.name || prev.A.acct.id);
          return now.length > built.before ? now[now.length - 1] : null;
        });
      }).then(async function (res) {
        if (myGen !== gen) return; DOM.clear(out);
        DOM.append(out, DOM.el(doc, "p", t("barter.barter_proposed_and_re_read_on_chain", "Barter proposed and re-read on chain."), "xfer-ok"));
        var head = (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
        DOM.append(out, DOM.el(doc, "p", "Observed at head block #" + String(head) + " (" + res.via + ").", "muted"));
      }).catch(function (e) {
        if (myGen !== gen) return; out.removeChild(status);
        showError(doc, out, e, t("barter.failed_check_state_before_retrying_do_not_bli", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
        send.disabled = false; back.disabled = false;
      });
    }
  }
  /* Resolve one side: account + per-leg asset/precision + raw amounts + balance warnings. */
  async function readSide(acctV, legs, sideName) {
    if (!acctV) throw new Error(sideName + ": set the account.");
    var acct = await Account.resolve(acctV);
    var bals = [];
    try { bals = await Account.balances(acct.id); } catch (e) { bals = []; }
    var byId = {};
    bals.forEach(function (b) { byId[b.asset_id] = b.raw; });
    var items = [], warnings = [];
    for (var i = 0; i < legs.length; i++) {
      var av = legs[i].asset.value.trim(), qv = legs[i].amount.value.trim();
      if (!av && !qv) continue;
      if (!av || !qv) throw new Error(sideName + " row " + (i + 1) + ": asset and amount are both required.");
      var info = await Asset.describe(av);
      var raw = Format.parseAmount(qv, info.precision);
      if (BigInt(raw) <= 0n) throw new Error(sideName + " row " + (i + 1) + ": amount must be > 0.");
      var have = byId[info.id];
      if (have === undefined) warnings.push(sideName + " has no " + info.symbol + " balance.");
      else if (BigInt(raw) > BigInt(have))
        warnings.push(sideName + " wants " + Format.formatAmount(raw, info.precision) + " " + info.symbol +
          " but holds " + Format.formatAmount(have, info.precision) + ".");
      items.push({ symbol: info.symbol, id: info.id, prec: info.precision, raw: raw });
    }
    if (!items.length) throw new Error(sideName + ": add at least one asset row.");
    return { acct: acct, items: items, warnings: warnings };
  }
  /* Draft expiration ISO for the proposal-fee estimate (same shape the real
   * PROPOSE builds: datetime-local + ":00"). Date only, never money. */
  function draftExpirationIso() {
    var v = defaultExpiration();
    return v.length === 16 ? v + ":00" : v;
  }
  /* Fee-bucket totals -> human line. Groups raw fees by asset id, sums each
   * with BigInt only, formats via Format.formatAmount (precision lookup per
   * asset, raw fallback). Never throws: unknown assets degrade honestly. */
  async function totalFeesText(buckets, propRaw, propAsset) {
    var sums = {};
    (buckets || []).forEach(function (b) {
      if (!b || !/^\d+$/.test(String(b.raw))) return;
      var id = String(b.asset_id);
      sums[id] = (sums[id] === undefined ? 0n : sums[id]) + BigInt(String(b.raw));
    });
    if (propRaw !== null && propRaw !== undefined && /^\d+$/.test(String(propRaw))) {
      var pid = String(propAsset);
      sums[pid] = (sums[pid] === undefined ? 0n : sums[pid]) + BigInt(String(propRaw));
    }
    var ids = Object.keys(sums);
    if (!ids.length) return t("barter.fee_hints_unavailable", "fee hints unavailable");
    var parts = [];
    for (var i = 0; i < ids.length; i++) {
      try {
        var d = await Asset.describe(ids[i]);
        parts.push(Format.formatAmount(String(sums[ids[i]]), d.precision) + " " + d.symbol);
      } catch (e) { parts.push(String(sums[ids[i]]) + " (" + ids[i] + ")"); }
    }
    return parts.join(" + ");
  }
  /* Preview: per-side lines + warnings + atomic sentence + per-side live
   * leg-fee hints (each side's own fee asset) + fee-timing indicator +
   * proposal-fee estimate (due now) + TOTAL FEES (BigInt only) + escrow
   * preview-only upgrade. Escrow resolves only when the toggle is on and a
   * name is set; the broadcast gap is stated, not implied. */
  async function preview(doc, out, myGen, acctA, legsA, acctB, legsB, escV, feeAId, feeBId, propFeeId, escrowOn) {
    feeAId = feeAId || "1.3.0"; feeBId = feeBId || "1.3.0"; propFeeId = propFeeId || "1.3.0";
    var A = await readSide(acctA, legsA, "Side A");
    if (myGen !== gen) return;
    var B = await readSide(acctB, legsB, "Side B");
    if (myGen !== gen) return;
    var esc = null;
    if (escrowOn && escV) { esc = await Account.resolve(escV); if (myGen !== gen) return; }
    DOM.clear(out);
    DOM.append(out, DOM.el(doc, "h3", t("barter.atomic_preview", "Atomic preview")));
    /* Append "X gives N SYM → Y" preview lines for one side. Params: side (readSide shape), givesTo (name). */
    function sideLines(side, givesTo) {
      side.items.forEach(function (it) {
        DOM.append(out, DOM.el(doc, "p", side.acct.name + " gives " + Format.formatAmount(it.raw, it.prec) +
          " " + it.symbol + " → " + givesTo, ""));
      });
    }
    sideLines(A, B.acct.name); sideLines(B, A.acct.name);
    /* Escrow display upgrade (preview-only): no escrow party is serialized
     * by tx.js/proposal.js (grep "escrow" hits this file only), so the
     * proposal below encloses just the two sides' A↔B transfers. */
    if (esc) DOM.append(out, DOM.el(doc, "p", t("barter.escrow_prefix", "Escrow ") + esc.name + " (" + esc.id + t("barter.escrow_holds_off_proposal_suffix", ") holds off-proposal — preview-only: the proposal below encloses only A↔B transfers (no escrow party serialized)."), "muted"));
    else if (escrowOn) DOM.append(out, DOM.el(doc, "p", t("barter.escrow_enabled_but_no_account_set_legs_", "Escrow enabled but no account set — legs settle peer-to-peer."), "muted"));
    var warns = A.warnings.concat(B.warnings);
    if (warns.length) warns.forEach(function (w) { DOM.append(out, DOM.el(doc, "p", "Warning: " + w, "error")); });
    else DOM.append(out, DOM.el(doc, "p", t("barter.both_sides_hold_every_leg_amount_integer_chec", "Both sides hold every leg amount (integer check)."), "muted"));
    /* Fee-timing indicator (#1 Barter.jsx fee_due_now vs
     * fee_when_proposal_executes): escrow custodian path pays now, the plain
     * proposal path pays when the proposal executes. */
    var timing = (escrowOn && esc)
      ? t("barter.side_fees_due_now_escrow_custodian_path", "Side fees: due now (escrow custodian path — legs route via escrow).")
      : t("barter.side_fees_when_proposal_executes_no_escr", "Side fees: when proposal executes (no escrow — enclosed transfers pay on execution).");
    DOM.append(out, DOM.el(doc, "p", timing, "muted"));
    var status = showStatus(doc, out, t("barter.estimating_leg_fees", "Estimating leg fees…"));
    var hintsA = [], hintsB = [], rawA = [], rawB = [];
    /* One leg's live op-0 fee hint in the side's fee asset (human display;
     * failures degrade to "fee hint unavailable", never a throw). */
    async function legFee(fromId, toId, it, feeId, hints, raws) {
      var op = { fee: { amount: "0", asset_id: feeId }, from: fromId, to: toId,
        amount: { amount: it.raw, asset_id: it.id }, extensions: [] };
      try {
        var f = await Tx.fee(0, op, feeId);
        var human = null;
        try {
          var fa = await Asset.describe(String(f.asset_id));
          human = Format.formatAmount(String(f.amount), fa.precision) + " " + fa.symbol;
        } catch (e2) { human = String(f.amount) + " (" + String(f.asset_id) + ")"; }
        hints.push(it.symbol + ": " + human);
        raws.push({ raw: String(f.amount), asset_id: String(f.asset_id) });
      } catch (e) { hints.push(it.symbol + ": " + t("barter.fee_hint_unavailable", "fee hint unavailable")); }
    }
    for (var i = 0; i < A.items.length; i++) { await legFee(A.acct.id, B.acct.id, A.items[i], feeAId, hintsA, rawA); if (myGen !== gen) return; }
    for (var k = 0; k < B.items.length; k++) { await legFee(B.acct.id, A.acct.id, B.items[k], feeBId, hintsB, rawB); if (myGen !== gen) return; }
    /* Per-side fee-asset display (human, never raw). */
    async function feeAssetLine(sideName, feeId, hints) {
      var sym = feeId;
      try { var d = await Asset.describe(feeId); sym = d.symbol + " (" + feeId + ")"; } catch (e) { /* id stands */ }
      return sideName + t("barter.fee_asset_mid", " fee asset: ") + sym + " — " + (hints.length ? hints.join("; ") : t("barter.no_legs", "no legs"));
    }
    out.removeChild(status);
    DOM.append(out, DOM.el(doc, "p", await feeAssetLine(t("barter.side_a", "Side A"), feeAId, hintsA), "muted"));
    DOM.append(out, DOM.el(doc, "p", await feeAssetLine(t("barter.side_b", "Side B"), feeBId, hintsB), "muted"));
    if (myGen !== gen) return;
    /* Proposal-fee estimate (due now, paid by Peer A at PROPOSE): draft the
     * same pairs proposeBarter builds and ask the chain once. Degrades
     * honestly to "proposal fee hint unavailable". */
    var propHuman = t("barter.proposal_fee_hint_unavailable", "proposal fee hint unavailable"), propRaw = null, propAsset = propFeeId;
    try {
      var pairs = [];
      A.items.forEach(function (it) { pairs.push([0, { fee: { amount: "0", asset_id: propFeeId }, from: A.acct.id, to: B.acct.id, amount: { amount: it.raw, asset_id: it.id }, extensions: [] }]); });
      B.items.forEach(function (it) { pairs.push([0, { fee: { amount: "0", asset_id: propFeeId }, from: B.acct.id, to: A.acct.id, amount: { amount: it.raw, asset_id: it.id }, extensions: [] }]); });
      var draft = Proposal.buildCreate({ feePayerId: A.acct.id, expirationIso: draftExpirationIso(),
        reviewPeriodSecOrNull: null, innerOps: pairs.map(function (p) { return { op: p }; }) });
      var pf = await Proposal.fee(draft, propFeeId);
      propAsset = String(pf.asset_id); propRaw = String(pf.amount);
      try {
        var pa = await Asset.describe(propAsset);
        propHuman = Format.formatAmount(propRaw, pa.precision) + " " + pa.symbol;
      } catch (e3) { propHuman = propRaw + " (" + propAsset + ")"; }
    } catch (e) { /* hint unavailable stands */ }
    DOM.append(out, DOM.el(doc, "p", t("barter.proposal_fee_due_now_paid_by_prefix", "Proposal fee (due now, paid by ") + A.acct.name + t("barter.paid_by_suffix", "): ") + propHuman, "muted"));
    /* TOTAL FEES line (BigInt only): leg raws + proposal raw grouped by fee
     * asset, formatted human per asset. */
    var totalText = await totalFeesText(rawA.concat(rawB), propRaw, propAsset);
    if (myGen !== gen) return;
    DOM.append(out, DOM.el(doc, "p", t("barter.total_fees_prefix", "Total fees: ") + totalText, "muted"));
    return { A: A, B: B, esc: esc, feeAId: feeAId, feeBId: feeBId, propFeeId: propFeeId,
      timing: timing, totalText: totalText, propHuman: propHuman };
  }

  return { renderBarter: renderBarter };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.BarterUI === "undefined") { globalThis.BarterUI = BarterUI; }
if (typeof module !== "undefined") { module.exports = BarterUI; }