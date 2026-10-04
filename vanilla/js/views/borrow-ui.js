/* borrow-ui.js — #/borrow margin positions + op-3 open/adjust forms + op-45
 * settlement bids (split OUT of credit-ui.js).
 * Owns: margin positions table for an account (collateral/debt human both legs,
 *   call price, TCR at the proven divisor 1000) + op-3 OPEN-new-position form
 *   (borrow-to-create: collateral asset+amount, debt bitasset+amount,
 *   feed-valued backing-ratio preview with an MCR abort gate, live fee,
 *   named-row confirm, unlock-at-sign broadcast with positions re-read proof)
 *   + op-3 call_order_update adjust form (signed delta-collateral / delta-debt,
 *   optional TCR, live fee, named-row confirm) + op-45 bid_collateral section
 *   (asset-driven: settlement-fund gate, existing-bids table, bid form with
 *   live fee + named-row confirm + bid-list re-read proof) + Get-started
 *   stepper cycling the WORDS of #1 Showcases/Borrow.jsx steps (chrome only —
 *   same four strings, same keys). Open needs no position and is always
 *   offered; no safe position -> adjust form client-gated with an honest note
 *   (ambiguity H): positions READ is always offered, the adjust broadcast only
 *   against an existing position.
 *   No settlement fund -> bid form client-gated the same way (C27): the READ
 *   (fund + bids) is always offered, the broadcast only against a live fund.
 *   No money math here (Credit builders + Format do it); no serializers
 *   (tx.js owns bytes).
 * Consumes: Credit (positions/positionsMethod reads, buildCallUpdate, tcr/fee
 *   helpers, fee/sendAndProve), Tx.buildTx, Format, Account, Asset.describe,
 *   Wallet, Chain/Store. Created by: building-vanilla-slices skill,
  *   slice-13-credit plan Task 3 (pre-authorized split — credit-ui.js cap);
  *   op-45 section appended by the C27/C29 deferred-matrix closeout.
  * PUBLIC-FIRST (gate repair): routeReady never gates on unlock — positions/
  *   fund/bids read locked; the account input defaults to committee-account
  *   1.2.0 while locked with a viewing notice. Password is asked only at
  *   Sign & Send (bespoke confirms below carry a sign-time gate + inline
  *   unlock); previews stay read-only.
 * CHAIN TRUTH (#4 wins): op 3 = (fee)(funding_account)(delta_collateral)
 *   (delta_debt)(extensions{optional u16 target_collateral_ratio}) <-
 *   market.hpp:171-197 — NO expiration field (#1 MarketsActions' is stale, NOT
 *   ported); TCR divisor 1000 <- BorrowModal.jsx:57-60/:478-481 (ambiguity G
 *   proven); negative delta_debt = borrow-more (WARNED in the form + confirm).
 *   op 45 = (fee)(bidder)(additional_collateral)(debt_covered)(extensions) <-
 *   market.hpp:307-308 (NOT op 46: operations.hpp:101-102 numbers
 *   bid_collateral 45, execute_bid 46 VIRTUAL); bids exist only after a
 *   global settlement leaves settlement_fund > 0 on the 2.4.x bitasset
 *   (BSIP-0018; fund gate mirrors #2 SettlementBids.jsx hasSettlementFund).
 */
var BorrowUI = (function () {
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
  var gen = 0, subs = [];
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text; return n;
  }
function clearBox(b) { while (b.firstChild) b.removeChild(b.firstChild); }
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || t("borrow.unexpected_error", "Unexpected error"));
    if (m.indexOf("not-connected") !== -1) m = t("borrow.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    else if (m.indexOf("wallet-locked") !== -1) m = t("borrow.wallet_is_locked", "Wallet is locked.");
    else if (m.indexOf("unknown-account") !== -1) m = t("borrow.unknown_account", "Unknown account.");
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite");
    wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  /* Default viewing account while locked: committee-account 1.2.0 (a public
   * chain object on testnet+mainnet, verified live 2026-09-28). Reads stay
   * public under it; writes gate at Sign & Send. Never throws. */
  var VIEWING_AS_ID = "1.2.0", VIEWING_AS_NAME = "committee-account";
  function isUnlockedNow() {
    try {
      if (typeof Wallet !== "undefined" && typeof Wallet.isUnlocked === "function") return !!Wallet.isUnlocked();
      return !!(typeof Wallet !== "undefined" && Wallet.keys);
    } catch (e) { return false; }
  }
  function viewingAsNotice(doc) {
    var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
    return el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: v.name, id: v.id }), "muted");
  }
  function signNotice(doc) {
    return el(doc, "p", t("borrow.locked_preview_note", "Wallet locked — preview only. Password is asked at Sign & Send, never to view."), "muted");
  }
  function unlockInline(doc, parent, onUnlock) { /* in-place password row (no route re-render, so previews survive) */
    if (parent.querySelector && parent.querySelector(".xfer-unlock-row")) return;
    var row = el(doc, "div", null, "xfer-field xfer-unlock-row");
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("autocomplete", "current-password");
    inp.setAttribute("placeholder", t("borrow.password", "password")); inp.setAttribute("aria-label", t("borrow.password", "password"));
    touchable(inp); row.appendChild(inp);
    var b = touchable(el(doc, "button", t("borrow.unlock", "Unlock"))); b.type = "button"; row.appendChild(b);
    parent.appendChild(row);
    b.addEventListener("click", function () { b.disabled = true;
      /* H2: wipe the password local + input on either outcome. */
      var pw = inp.value;
      Wallet.unlock(pw).then(function () { inp.value = ""; pw = null; if (onUnlock) onUnlock(); })
        .catch(function (e) { inp.value = ""; pw = null; b.disabled = false; showError(doc, parent, e, t("borrow.unlock_failed", "Unlock failed.")); });
    });
  }
  /* Sign-time gate for the bespoke confirms below: locked clicks get a notice
   * + inline unlock instead of a bare error; success asks for a re-review so
   * the rebuilt transaction uses the wallet account, never a stale 1.2.0. */
  function signGateLocked(doc, out, sendBtn, backBtn) {
    if (!out.querySelector || !out.querySelector(".xfer-sign-note")) {
      var note = el(doc, "p", t("borrow.locked_sign_note", "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."), "muted");
      note.className = "muted xfer-sign-note"; out.appendChild(note);
    }
    unlockInline(doc, out, function () {
      out.appendChild(el(doc, "p", t("borrow.unlocked_rereview_note", "Unlocked — press Back and re-run Review so the transaction uses your account."), "muted"));
    });
    sendBtn.disabled = false; backBtn.disabled = false;
  }
  function routeReady(root, title, retry) {
    var doc = root.ownerDocument || document, myGen = ++gen, miss = null;
    subs.forEach(function (off) { try { off(); } catch (e) {} }); subs = [];
    root.innerHTML = "";
    ["Credit", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"].forEach(function (g) {
      if (typeof globalThis[g] === "undefined") miss = g; });
    /* borrow-prose hook (app.css): direct-child explainer paragraphs cap at
     * ~75ch like help articles. Display-only class; forms/tables untouched. */
    var wrap = el(doc, "div", null, "wrap borrow-prose"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", title));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", t("borrow.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
      var bstat = el(doc, "p", "", "muted");
      try { bstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      wrap.appendChild(bstat);
      var brow = el(doc, "div", null, "pools-offline-row");
      wrap.appendChild(brow);
      var b = touchable(el(doc, "button", t("borrow.retry", "Retry"))); b.type = "button";
      brow.appendChild(b);
      var boff = null;
      try { boff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { boff = null; }
      if (boff && typeof boff.wire === "function") {
        try { boff.wire(b, bstat, retry, t); } catch (e) { b.addEventListener("click", retry); }
      } else {
        b.addEventListener("click", retry);
      }
      var blink = null;
      if (boff && typeof boff.settingsLink === "function") {
        try { blink = boff.settingsLink(doc, t); } catch (e) { blink = null; }
      }
      if (!blink) {
        blink = el(doc, "a", t("notice.open_settings", "Open Settings"));
        try { blink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
        touchable(blink);
      }
      brow.appendChild(blink);
      try {
        var h = (typeof location !== "undefined" && location.hash) || "", done = false;
        subs.push(Store.subscribe("connection", function (st) {
          if (done || myGen !== gen) { done = true; return; }
          if (st && st.state === "open") { done = true;
            if (typeof location === "undefined" || location.hash === h) retry(); }
        }));
      } catch (e) { /* manual Retry remains */ }
      try { if (boff && typeof boff.ensure === "function") boff.ensure(); } catch (e) { /* manual Retry remains */ }
      return null;
    }
    /* PUBLIC-FIRST: no wallet gate here — positions/fund/bids render locked. */
    return { doc: doc, wrap: wrap, myGen: myGen };
  }
  function confirmList(doc, rows) {
    var list = el(doc, "dl", null, "xfer-confirm");
    rows.forEach(function (r) {
      list.appendChild(el(doc, "dt", r[0]));
      var dd = el(doc, "dd", r[1]); if (r[2]) dd.title = r[2]; list.appendChild(dd);
    });
    return list;
  }
  function field(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input");
    if (opts.type) input.type = opts.type; if (opts.value !== undefined) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    touchable(input); label.appendChild(input); row.appendChild(label); return { row: row, input: input };
  }
  /* Raw amount -> {text (human + sym, or raw + id fallback), raw}. Params: raw, prec (number|null), sym, id. */
  function amt(raw, prec, sym, id) {
    if (typeof prec === "number" && /^-?\d+$/.test(String(raw)))
      return { text: Format.formatAmount(String(raw), prec) + (sym ? " " + sym : ""), raw: String(raw) };
    return { text: String(raw) + " (" + id + ")", raw: String(raw) };
  }
  /* Chain head block number (observation marker for result panels, never a txid). Returns: Promise of int. */
  async function headBlock() {
    return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
  }
  /* Route entry: #/borrow — positions for the account + op-3 adjust + explainer. */
  function renderBorrow(root) {
    if (!root) return;
    var ctx = routeReady(root, t("borrow.borrow_margin", "Borrow (Margin)"), function () { renderBorrow(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    var lockedB = !isUnlockedNow();
    if (lockedB) ctx.wrap.appendChild(viewingAsNotice(doc));
    ctx.wrap.appendChild(el(doc, "p", t("borrow.margin_positions_borrow_a_bitasset_against_co", "Margin positions borrow a bitasset against collateral. Topping up collateral or repaying debt adjusts op 3 (call_order_update) on your call order."), "muted"));
    var fAcct = field(doc, t("borrow.account", "Account"), lockedB
      ? { placeholder: t("borrow.blank_wallet_account", "blank = wallet account"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("borrow.blank_wallet_account", "blank = wallet account") });
    ctx.wrap.appendChild(fAcct.row);
    var go = touchable(el(doc, "button", t("borrow.load_positions", "Load positions"))); go.type = "button"; ctx.wrap.appendChild(go);
    var listBox = el(doc, "div"); ctx.wrap.appendChild(listBox);
    ctx.wrap.appendChild(el(doc, "h2", t("borrow.adjust_position_op_3", "Adjust position (op 3)")));
    if (lockedB) ctx.wrap.appendChild(signNotice(doc));
    var formBox = el(doc, "div"); ctx.wrap.appendChild(formBox);
    /* Punchlist HIGH: borrow-to-create lives here — always offered, needs no
     * position (the gap was adjust-only). New-form words are literals until
     * the next locale batch mints borrow.* keys; dicts untouched, check_i18n
     * stays green. */
    ctx.wrap.appendChild(el(doc, "h2", t("borrow.open_a_new_position_op_3", "Open a new position (op 3)")));
    ctx.wrap.appendChild(el(doc, "p", t("borrow.no_position_yet_lock_collateral_to_borrow_a_b", "No position yet? Lock collateral to borrow a bitasset in one op-3 call_order_update: collateral locks first, the new debt is issued against it. A pair you already hold keeps using Adjust above."), "muted"));
    var openBoxEl = el(doc, "div"); ctx.wrap.appendChild(openBoxEl);
    openBox(doc, openBoxEl, myGen);
    ctx.wrap.appendChild(el(doc, "h2", t("borrow.how_borrowing_works", "How borrowing works")));
    howStepper(doc, ctx.wrap);
    settleSection(doc, ctx.wrap, myGen);
    mySettleSection(doc, ctx.wrap, myGen);
    go.addEventListener("click", function () {
      if (myGen !== gen) return; go.disabled = true; clearBox(listBox); clearBox(formBox);
      showStatus(doc, listBox, t("borrow.loading_positions", "Loading positions…"));
      Promise.resolve().then(async function () {
        var me = fAcct.input.value.trim() ? await Account.resolve(fAcct.input.value.trim())
          : await Account.resolve(await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }));
        var rows = await Credit.positions(me.id);
        /* R1e CR enrichment: one bitasset_data read per unique debt leg, then
         * previewRatio (Format-only math) per position. Fail-open: a feed miss
         * leaves _cr null and the table shows "—" with MCR title when known. */
        try {
          var byDebt = {}, need = [];
          rows.forEach(function (p) {
            if (!byDebt[p.debt_id]) { byDebt[p.debt_id] = true; need.push(p.debt_id); }
          });
          var dbId = await Chain.db();
          var metas = need.length ? await Chain.call(dbId, "get_assets", [need]) : [];
          var bidByDebt = {};
          (metas || []).forEach(function (a, i) {
            if (a && a.bitasset_data_id) bidByDebt[need[i]] = a.bitasset_data_id;
          });
          var bids = Object.keys(bidByDebt).map(function (k) { return bidByDebt[k]; });
          var bobjs = bids.length ? await Chain.call(dbId, "get_objects", [bids]) : [];
          var bitByDebt = {};
          Object.keys(bidByDebt).forEach(function (debtId) {
            var bid = bidByDebt[debtId];
            var ix = bids.indexOf(bid);
            if (ix !== -1 && bobjs && bobjs[ix]) bitByDebt[debtId] = bobjs[ix];
          });
          rows.forEach(function (p) {
            try {
              var b = bitByDebt[p.debt_id] || null;
              if (b) {
                p._cr = previewRatio(p.coll_raw, p.coll_prec, p.debt_raw, p.debt_prec, b, p.coll_id, p.debt_id);
                try {
                  if (b.current_feed && Number.isInteger(b.current_feed.maintenance_collateral_ratio)) p._mcr = b.current_feed.maintenance_collateral_ratio;
                } catch (e) { /* title stays blank */ }
              }
            } catch (e) { p._cr = null; }
          });
        } catch (e) { /* enrichment best-effort; table still renders balances */ }
        return { me: me, rows: rows };
      }).then(function (R) {
        if (myGen !== gen) return; clearBox(listBox);
        if (!R.rows.length) {
          listBox.appendChild(el(doc, "p", "No margin positions for " + R.me.name + ". The adjust form stays disabled until a position exists (no safe target, no broadcast).", "muted"));
          return;
        }
        listBox.appendChild(posTable(doc, R.rows));
        adjustBox(doc, formBox, myGen, R.me, R.rows);
      }).catch(function (e) {
        if (myGen !== gen) return; clearBox(listBox); showError(doc, listBox, e, t("borrow.could_not_load_positions", "Could not load positions."));
      }).then(function () { go.disabled = false; });
    });
    Account.myAccountId().then(function (id) {
      if (myGen === gen && !fAcct.input.value) fAcct.input.value = id;
      if (myGen === gen) go.click();
    }).catch(function () { if (myGen === gen && fAcct.input.value) go.click(); /* locked: the 1.2.0 default still loads */ });
  }
  /* Positions table (desktop) + cards (phone); TCR at divisor 1000 + R1e CR.
   * CR cell comes from p._cr (enriched by the loader: previewRatio via Format,
   * feed-valued with danger/warning/safe suffix, nominal honestly labelled).
   * Missing feed -> "—" with MCR title when known. No float here — Format owns
   * integers; this only paints strings. */
  function posTable(doc, rows) {
    var box = el(doc, "div");
    var table = doc.createElement("table"); table.className = "node-table";
    var hr = doc.createElement("tr");
    [t("borrow.hdr_order", "Order"), t("borrow.hdr_collateral", "Collateral"), t("borrow.hdr_debt", "Debt"), t("borrow.hdr_target_ratio", "Target ratio"), t("borrow.hdr_cr", "Collateral ratio"), ""].forEach(function (h) {
      var th = doc.createElement("th"); th.textContent = h; hr.appendChild(th); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    rows.forEach(function (p) {
      var tr = doc.createElement("tr");
      var c = amt(p.coll_raw, p.coll_prec, p.coll_sym, p.coll_id);
      var d = amt(p.debt_raw, p.debt_prec, p.debt_sym, p.debt_id);
      var tcr = (p.tcr_units === null || p.tcr_units === undefined) ? "—" : Credit.tcrUnitsToHuman(p.tcr_units) + "%";
      var cr = "—", crTitle = null;
      if (p._cr && p._cr.x) {
        cr = p._cr.x;
        try {
          crTitle = (p._cr.mcr !== null && p._cr.mcr !== undefined)
            ? "MCR " + Format.mcrUnitsToHuman(p._cr.mcr) + "%" : null;
        } catch (e) { crTitle = null; }
      } else if (p._mcr !== null && p._mcr !== undefined) {
        try { crTitle = "MCR " + Format.mcrUnitsToHuman(p._mcr) + "%"; } catch (e) { crTitle = null; }
      }
      [[p.call_id], [c.text, c.raw], [d.text, d.raw], [tcr]].forEach(function (x) {
        var td = el(doc, "td", x[0]); if (x[1]) td.title = t("account.raw_prefix", "raw ") + x[1]; tr.appendChild(td); });
      var tdCr = el(doc, "td", cr);
      if (crTitle) tdCr.title = crTitle;
      if (p._cr && p._cr.belowMcr) tdCr.className = "cr-danger";
      else if (p._cr && p._cr.warn) tdCr.className = "cr-warn";
      tr.appendChild(tdCr);
      var link = doc.createElement("td");
      var a = el(doc, "a", t("borrow.market", "Market")); a.setAttribute("href", "#/market/" + p.coll_sym + "_" + p.debt_sym);
      link.appendChild(a); tr.appendChild(link); tbody.appendChild(tr);
    });
    table.appendChild(tbody); box.appendChild(table);
    var cards = el(doc, "div", null, "node-cards");
    rows.forEach(function (p) {
      var c = el(doc, "div", null, "node-card");
      var col = amt(p.coll_raw, p.coll_prec, p.coll_sym, p.coll_id);
      var debt = amt(p.debt_raw, p.debt_prec, p.debt_sym, p.debt_id);
      c.appendChild(el(doc, "div", p.call_id));
      c.appendChild(el(doc, "div", "Collateral " + col.text));
      c.appendChild(el(doc, "div", "Debt " + debt.text));
      var crLine = (p._cr && p._cr.x) ? p._cr.x : t("borrow.hdr_cr", "Collateral ratio") + " —";
      c.appendChild(el(doc, "div", crLine));
      box.appendChild(cards); cards.appendChild(c);
    });
    return box;
  }
  /* Op-3 adjust: signed deltas + optional TCR; negative debt warns explicitly. */
  function adjustBox(doc, box, myGen, me, positions) {
    var sel = doc.createElement("select"); touchable(sel);
    positions.forEach(function (p) {
      var op = doc.createElement("option"); op.value = p.call_id;
      op.textContent = p.call_id + " (" + (p.coll_sym || p.coll_id) + "/" + (p.debt_sym || p.debt_id) + ")";
      sel.appendChild(op); });
    var selRow = el(doc, "div", null, "xfer-field"), selLab = el(doc, "label", t("borrow.position", "Position "));
    selLab.appendChild(sel); selRow.appendChild(selLab); box.appendChild(selRow);
    var fColl = field(doc, t("borrow.delta_collateral_signed_collateral_asset", "Delta collateral (signed, collateral asset)"), { placeholder: t("borrow.1_0_adds_1_0_removes", "+1.0 adds, -1.0 removes"), inputmode: "decimal" });
    var fDebt = field(doc, t("borrow.delta_debt_signed_debt_asset", "Delta debt (signed, debt asset)"), { placeholder: t("borrow.1_0_borrows_more_risk", "-1.0 borrows MORE (risk!)"), inputmode: "decimal" });
    var fTcr = field(doc, t("borrow.target_ratio_blank_unchanged", "Target ratio % (blank = unchanged)"), { placeholder: t("borrow.e_g_175", "e.g. 175"), inputmode: "decimal" });
    [fColl, fDebt, fTcr].forEach(function (f) { box.appendChild(f.row); });
    box.appendChild(el(doc, "p", t("borrow.warning_a_negative_debt_delta_borrows_more_ag", "Warning: a negative debt delta borrows more against the same collateral and moves the position closer to margin call."), "muted"));
    if (!isUnlockedNow()) box.appendChild(signNotice(doc));
    var btn = touchable(el(doc, "button", t("borrow.review_adjust", "Review adjust"))); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    btn.addEventListener("click", function () {
      if (myGen !== gen) return;
      clearBox(out); btn.disabled = true;
      showStatus(doc, out, t("borrow.resolving_and_estimating_fee", "Resolving and estimating fee…"));
      Promise.resolve().then(async function () {
        var pos = null;
        positions.forEach(function (p) { if (p.call_id === sel.value) pos = p; });
        if (!pos) throw new Error("unknown-position");
        var cPrec = (pos.coll_prec === null || pos.coll_prec === undefined) ? (await Asset.describe(pos.coll_id)).precision : pos.coll_prec;
        var dPrec = (pos.debt_prec === null || pos.debt_prec === undefined) ? (await Asset.describe(pos.debt_id)).precision : pos.debt_prec;
        /* Signed decimal input -> signed raw int string ("-1.5" -> "-" + parseAmount("1.5")). Params: v (input), prec. */
        function signed(v, prec) {
          v = String(v || "0").trim() || "0";
          var neg = v.charAt(0) === "-";
          return (neg ? "-" : "") + Format.parseAmount(neg ? v.slice(1) : v, prec);
        }
        var collRaw = signed(fColl.input.value, cPrec), debtRaw = signed(fDebt.input.value, dPrec);
        if (collRaw === "0" && debtRaw === "0" && !fTcr.input.value.trim()) throw new Error(t("borrow.adjust_needs_1_change", "adjust needs ≥1 change."));
        var tcr = (fTcr.input.value.trim() === "") ? null : Credit.tcrHumanToUnits(fTcr.input.value.trim());
        var pair = Credit.buildCallUpdate({ accountId: me.id, collRaw: collRaw, collId: pos.coll_id,
          debtRaw: debtRaw, debtId: pos.debt_id, tcrUnitsOrNull: tcr });
        var fee = await Credit.fee(pair, "1.3.0");
        return { pair: pair, fee: fee, pos: pos, cPrec: cPrec, dPrec: dPrec, tcr: tcr };
      }).then(function (R) {
        if (myGen !== gen) return;
        var fa;
        Asset.describe(R.fee.asset_id).then(function (a) { fa = a; }).catch(function () { fa = null; }).then(function () {
          if (myGen !== gen) return;
          var feeHuman = fa ? Format.formatAmount(String(R.fee.amount), fa.precision) + " " + fa.symbol : String(R.fee.amount);
          var op = R.pair[1];
          var tcrRow = (R.tcr === null) ? "unchanged"
            : ((R.pos.tcr_units === null || R.pos.tcr_units === undefined ? "—" : Credit.tcrUnitsToHuman(R.pos.tcr_units) + "%") + " → " + Credit.tcrUnitsToHuman(R.tcr) + "%");
          clearBox(out);
          out.appendChild(el(doc, "h3", t("borrow.confirm_margin_adjust", "Confirm margin adjust")));
          var crRow = "—";
          try {
            if (R.pos._cr && R.pos._cr.x) {
              crRow = R.pos._cr.x;
              if (R.pos._cr.mcr !== null && R.pos._cr.mcr !== undefined) {
                try { crRow += " (MCR " + Format.mcrUnitsToHuman(R.pos._cr.mcr) + "%)"; } catch (e) { /* display stands */ }
              }
            }
          } catch (e) { crRow = "—"; }
          out.appendChild(confirmList(doc, [
            [t("borrow.account", "Account"), me.name + " (" + me.id + ")"], [t("borrow.order", "Order"), R.pos.call_id],
            [t("borrow.hdr_cr", "Collateral ratio"), crRow],
            [t("borrow.delta_collateral", "Delta collateral"), (op.delta_collateral.amount.charAt(0) === "-" ? "" : "+") + Format.formatAmount(op.delta_collateral.amount, R.cPrec), "raw " + op.delta_collateral.amount],
            [t("borrow.delta_debt", "Delta debt"), (op.delta_debt.amount.charAt(0) === "-" ? "" : "+") + Format.formatAmount(op.delta_debt.amount, R.dPrec) + (op.delta_debt.amount.charAt(0) === "-" ? " — NEW DEBT, warned" : ""), "raw " + op.delta_debt.amount],
            [t("borrow.target_ratio", "Target ratio"), tcrRow], [t("borrow.fee", "Fee"), feeHuman, "raw " + String(R.fee.amount)], [t("borrow.network", "Network"), "testnet"]]));
          out.appendChild(el(doc, "p", t("borrow.fee_asset_note", "Fee asset 1.3.0 (switching deferred)."), "muted"));
          var back = touchable(el(doc, "button", t("borrow.back", "Back"))); back.type = "button";
          var send = touchable(el(doc, "button", t("borrow.sign_send", "Sign & Send"))); send.type = "button";
          out.appendChild(back); out.appendChild(send);
          back.addEventListener("click", function () { clearBox(out); btn.disabled = false; });
          send.addEventListener("click", function () {
            if (myGen !== gen) return; send.disabled = true; back.disabled = true;
            var status = showStatus(doc, out, t("borrow.broadcasting", "Broadcasting…"));
            var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
            if (!wif) { out.removeChild(status); signGateLocked(doc, out, send, back); return; }
            Tx.buildTx([R.pair]).then(function (unsigned) {
              return Credit.sendAndProve(unsigned, wif, async function () {
                try {
                  var rows = await Credit.positions(me.id);
                  for (var i = 0; i < rows.length; i++) if (rows[i].call_id === R.pos.call_id) return rows[i];
                } catch (e) { return null; } return null;
              });
            }).then(async function (res) {
              if (myGen !== gen) return; clearBox(out);
              out.appendChild(el(doc, "p", t("borrow.adjust_broadcast", "Adjust broadcast."), "xfer-ok"));
              out.appendChild(el(doc, "p", t("borrow.observed_at_head_block", "Observed at head block #") + String(await headBlock()) + " (" + res.via + ").", "muted"));
              btn.disabled = false;
            }).catch(function (e) {
              if (myGen !== gen) return; out.removeChild(status);
              showError(doc, out, e, t("borrow.failed_check_state_before_retrying_do_not_bli", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
              send.disabled = false; back.disabled = false;
            });
          });
          btn.disabled = false;
        });
      }).catch(function (e) {
        if (myGen !== gen) return; clearBox(out);
        showError(doc, out, e, t("borrow.could_not_prepare_the_adjust", "Could not prepare the adjust.")); btn.disabled = false;
      });
    });
  }

  /* Get-started stepper: Borrow.jsx STEPS chrome only (introduction/concept/
   * setup/benefits/risks walk-through concept) over the same four words and
   * keys — one step visible plus Previous/Next. Button/counter words are
   * literals until the next locale batch mints borrow.* keys. */
  function howStepper(doc, wrap) {
    var steps = [
      t("borrow.how_1", "1. Lock collateral (e.g. BTS) to open a call order against a bitasset (e.g. bitUSD)."),
      t("borrow.how_2", "2. The chain must see a live price feed; falling below the maintenance ratio triggers a margin call."),
      t("borrow.how_3", "3. Top up collateral or repay debt any time with the adjust form — small steps only."),
      t("borrow.how_4", "4. Negative debt delta means borrowing MORE — it raises your liquidation risk.")
    ];
    var idx = 0;
    var p = el(doc, "p", steps[0], "muted"); wrap.appendChild(p);
    /* borrow-stepnav hook (app.css): flex + gap so the "Step N of 4" counter
     * never jams against the Previous/Next buttons. Display-only class. */
    var nav = el(doc, "div", null, "xfer-field borrow-stepnav");
    var prev = touchable(el(doc, "button", t("borrow.previous", "Previous"))); prev.type = "button";
    var count = el(doc, "span", "", "muted");
    var next = touchable(el(doc, "button", t("borrow.next", "Next"))); next.type = "button";
    nav.appendChild(prev); nav.appendChild(count); nav.appendChild(next); wrap.appendChild(nav);
    /* draw: repaint the how-it-works stepper text + counter + prev/next disabled.
     * WHY helper: both nav buttons share this state flip; display-only, never throws.
     * No params, no return. */
    function draw() {
      p.textContent = steps[idx];
      count.textContent = t("borrow.step", "Step ") + (idx + 1) + " of " + steps.length;
      prev.disabled = idx === 0; next.disabled = idx === steps.length - 1;
    }
    prev.addEventListener("click", function () { if (idx > 0) { idx--; draw(); } });
    next.addEventListener("click", function () { if (idx < steps.length - 1) { idx++; draw(); } });
    draw();
  }
  /* Feed-valued backing-ratio preview (R1e — all money math via Format).
   * Ports #1 BorrowModal.jsx:572-604 = MarginPosition.jsx:79-97:
   * feedPrice=1/get_asset_price(quoteRaw,backing,baseRaw,debt);
   * CR=humanCollateral/(humanDebt/feedPrice); MCR=current_feed
   * .maintenance_collateral_ratio/1000; status cr<mcr danger, cr<mcr+0.5
   * warning. With precisions cancelled CR = collRaw*baseRaw/(quoteRaw*debtRaw)
   * via Format.collateralNumDen; display via Format.formatRatio2dp/pct2dp;
   * bands via Format.ratioBelowMcr/PlusHalf (exact, boundary-exclusive).
   * Orientation VERIFIED at runtime (quote leg must be the collateral asset,
   * base leg the debt asset). Anything unverifiable (prediction market,
   * missing/inverted/zero feed leg) falls back to an honestly-labelled
   * nominal unit ratio via Format.nominalNumDen — never a guessed CR.
   * Returns {kind ("feed"|"nominal"), x (display), mcr (raw u16|null),
   * belowMcr, warn}. No BigInt/Math.pow here — Format owns integers. */
  function previewRatio(collRaw, collPrec, debtRaw, debtPrec, bit, collId, debtId) {
    var mcr = null;
    try {
      var fd = bit && bit.current_feed;
      if (fd && Number.isInteger(fd.maintenance_collateral_ratio)) mcr = fd.maintenance_collateral_ratio;
    } catch (e) { mcr = null; }
    function bandSuffix(num, den) {
      if (mcr === null) return "";
      try {
        if (Format.ratioBelowMcr(num, den, mcr)) return " · " + t("borrow.cr_danger", "Below maintenance — danger");
        if (Format.ratioBelowMcrPlusHalf(num, den, mcr)) return " · " + t("borrow.cr_warning", "Near maintenance — warning");
        return " · " + t("borrow.cr_safe", "Above maintenance");
      } catch (e) { return ""; }
    }
    if (!(bit && bit.is_prediction_market)) {
      try {
        var sp = bit.current_feed && bit.current_feed.settlement_price;
        var base = sp && sp.base, quote = sp && sp.quote;
        if (base && quote && String(base.asset_id) === String(debtId) && String(quote.asset_id) === String(collId) &&
            /^\d+$/.test(String(base.amount)) && /^\d+$/.test(String(quote.amount))) {
          var nd = Format.collateralNumDen(String(collRaw), String(base.amount), String(quote.amount), String(debtRaw));
          var r2 = Format.formatRatio2dp(nd.num, nd.den), p2 = Format.formatRatioPct2dp(nd.num, nd.den);
          var below = (mcr !== null) ? Format.ratioBelowMcr(nd.num, nd.den, mcr) : false;
          var warn = (mcr !== null) ? (!below && Format.ratioBelowMcrPlusHalf(nd.num, nd.den, mcr)) : false;
          return { kind: "feed", x: "≈ " + r2 + "× (" + p2 + "%) · feed-valued" + bandSuffix(nd.num, nd.den),
            mcr: mcr, belowMcr: below, warn: warn, num: nd.num, den: nd.den };
        }
      } catch (e) { /* fall through to nominal */ }
    }
    var nn = Format.nominalNumDen(String(collRaw), collPrec, String(debtRaw), debtPrec);
    var why = (bit && bit.is_prediction_market) ? "prediction market settles 1:1 — feed ratio not applied"
      : "no verifiable feed read — not the margin ratio";
    var nx = Format.formatRatio2dp(nn.num, nn.den);
    return { kind: "nominal", x: "≈ " + nx + " collateral units per debt unit (nominal — " + why + ")",
      mcr: mcr, belowMcr: false, warn: false, num: nn.num, den: nn.den };
  }
  /* Op-3 OPEN: borrow-to-create (the punchlist HIGH gap was adjust-only).
   * One call_order_update with delta_collateral POSITIVE (locks) + delta_debt
   * POSITIVE (new debt issued — #4 wallet.hpp borrow_asset "positive borrows,
   * negative repays"; #1 BorrowModal + #2 Smartcoin agree live, so the
   * market.hpp field comment's inverted reading loses). Guards: debt leg must
   * be a bitasset whose short_backing_asset equals the collateral leg; an
   * already-held pair redirects to Adjust (open would only top it up);
   * feed-valued CR under maintenance aborts pre-fee (the chain would reject).
   * Proof = the pair's call order re-read after send (fresh id preferred). */
  function openBox(doc, box, myGen) {
    var lockedOpen = !isUnlockedNow();
    if (lockedOpen) box.appendChild(signNotice(doc));
    var fAcct = field(doc, t("borrow.account", "Account"), lockedOpen
      ? { placeholder: t("borrow.blank_wallet_account", "blank = wallet account"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("borrow.blank_wallet_account", "blank = wallet account") });
    var fCollA = field(doc, t("borrow.collateral_asset_symbol_or_1_3_x", "Collateral asset (symbol or 1.3.x)"), { placeholder: t("borrow.e_g_bts", "e.g. BTS") });
    var fDebtA = field(doc, t("borrow.debt_bitasset_symbol_or_1_3_x", "Debt bitasset (symbol or 1.3.x)"), { placeholder: t("borrow.e_g_bitusd", "e.g. bitUSD") });
    var fColl = field(doc, t("borrow.collateral_amount_collateral_units", "Collateral amount (collateral units)"), { placeholder: t("borrow.e_g_10_0", "e.g. 10.0"), inputmode: "decimal" });
    var fDebt = field(doc, t("borrow.amount_to_borrow_debt_units", "Amount to borrow (debt units)"), { placeholder: t("borrow.e_g_5_0", "e.g. 5.0"), inputmode: "decimal" });
    var fTcr = field(doc, t("borrow.target_ratio_blank_unchanged", "Target ratio % (blank = unchanged)"), { placeholder: t("borrow.e_g_175", "e.g. 175"), inputmode: "decimal" });
    [fAcct, fCollA, fDebtA, fColl, fDebt, fTcr].forEach(function (f) { box.appendChild(f.row); });
    box.appendChild(el(doc, "p", t("borrow.new_debt_is_issued_against_the_locked_collate", "New debt is issued against the locked collateral in the same operation. The chain margin-calls the position when the feed-valued ratio falls below maintenance — borrow well above it."), "muted"));
    var btn = touchable(el(doc, "button", t("borrow.review_borrow", "Review borrow"))); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    Account.myAccountId().then(function (id) {
      if (myGen === gen && !fAcct.input.value) fAcct.input.value = id;
    }).catch(function () { /* manual account entry remains */ });
    btn.addEventListener("click", function () {
      if (myGen !== gen) return;
      clearBox(out); btn.disabled = true;
      showStatus(doc, out, t("borrow.resolving_and_estimating_fee", "Resolving and estimating fee…"));
      Promise.resolve().then(async function () {
        if (!fCollA.input.value.trim() || !fDebtA.input.value.trim())
          throw new Error(t("borrow.enter_a_collateral_asset_and_a_debt_bitasset", "Enter a collateral asset and a debt bitasset first."));
        if (!fColl.input.value.trim() || !fDebt.input.value.trim())
          throw new Error(t("borrow.enter_both_amounts_first", "Enter both amounts first."));
        var acct = fAcct.input.value.trim() ? await Account.resolve(fAcct.input.value.trim())
          : await Account.resolve(await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }));
        var coll = await Asset.describe(fCollA.input.value.trim());
        var debt = await Asset.describe(fDebtA.input.value.trim());
        if (!debt.is_smartcoin) throw new Error("not-bitasset (" + debt.symbol + t("borrow.is_not_a_bitasset_no_margin", " is not a bitasset — no margin)"));
        var collRaw = Format.parseAmount(fColl.input.value, coll.precision);
        var debtRaw = Format.parseAmount(fDebt.input.value, debt.precision);
        if (BigInt(collRaw) <= 0n || BigInt(debtRaw) <= 0n)
          throw new Error(t("borrow.both_legs_must_be_above_zero_nonzero_debt_nee", "Both legs must be above zero (nonzero debt needs nonzero collateral)."));
        var tcr = (fTcr.input.value.trim() === "") ? null : Credit.tcrHumanToUnits(fTcr.input.value.trim());
        var dbId = await Chain.db();
        var debtRows = await Chain.call(dbId, "get_assets", [[debt.id]]);
        var debtFull = debtRows && debtRows[0];
        if (!debtFull || !debtFull.bitasset_data_id) throw new Error("not-bitasset (" + debt.symbol + ")");
        var objs = await Chain.call(dbId, "get_objects", [[debtFull.bitasset_data_id]]);
        var bit = (objs && objs[0]) || null;
        if (!bit) throw new Error(t("borrow.unexpected_asset_data_from_the_node_stopped_i", "Unexpected asset data from the node; stopped instead of guessing."));
        var backingId = (bit.options && bit.options.short_backing_asset) || "1.3.0";
        if (coll.id !== backingId)
          throw new Error("wrong-collateral (" + coll.symbol + t("borrow.is_not_the_backing_asset", " is not the backing asset; ") + debt.symbol + t("borrow.is_backed_by", " is backed by ") + backingId + ")");
        var prior = [];
        try { prior = await Credit.positions(acct.id); } catch (e) { prior = []; }
        var preIds = {}, dup = null;
        prior.forEach(function (p) { preIds[p.call_id] = true;
          if (p.coll_id === coll.id && p.debt_id === debt.id) dup = p; });
        if (dup) throw new Error("have-position (" + dup.call_id + t("borrow.already_covers", " already covers ") + coll.symbol + "/" + debt.symbol + t("borrow.use_adjust_above", " — use Adjust above)"));
        var ratio = previewRatio(collRaw, coll.precision, debtRaw, debt.precision, bit, coll.id, debt.id);
        var mcrRow = (ratio.mcr === null) ? "unknown (no feed read)"
          : Format.mcrUnitsToHuman(ratio.mcr) + "%";
        /* Chain-state gate removed (owner directive): below-MCR is NOT blocked
         * client-side — the ratio rows below stay as the honest hint and the
         * chain validates on broadcast, its exact error via showError. */
        var pair = Credit.buildCallUpdate({ accountId: acct.id, collRaw: collRaw, collId: coll.id,
          debtRaw: debtRaw, debtId: debt.id, tcrUnitsOrNull: tcr });
        var fee = await Credit.fee(pair, "1.3.0");
        return { acct: acct, coll: coll, debt: debt, collRaw: collRaw, debtRaw: debtRaw,
          tcr: tcr, pair: pair, fee: fee, ratio: ratio, mcrRow: mcrRow, preIds: preIds };
      }).then(function (R) {
        if (myGen !== gen) return;
        Asset.describe(R.fee.asset_id).then(function (a) { return a; }).catch(function () { return null; })
        .then(function (fa) {
          if (myGen !== gen) return;
          var feeHuman = fa ? Format.formatAmount(String(R.fee.amount), fa.precision) + " " + fa.symbol : String(R.fee.amount);
          var tcrRow = (R.tcr === null) ? "unchanged" : Credit.tcrUnitsToHuman(R.tcr) + "%";
          clearBox(out);
          out.appendChild(el(doc, "h3", t("borrow.confirm_new_borrow", "Confirm new borrow")));
          out.appendChild(confirmList(doc, [
            [t("borrow.account", "Account"), R.acct.name + " (" + R.acct.id + ")"],
            [t("borrow.collateral", "Collateral"), Format.formatAmount(R.collRaw, R.coll.precision) + " " + R.coll.symbol, "raw " + R.collRaw],
            [t("borrow.hdr_debt", "Debt"), Format.formatAmount(R.debtRaw, R.debt.precision) + " " + R.debt.symbol, "raw " + R.debtRaw],
            [t("borrow.backing_ratio", "Backing ratio"), R.ratio.x],
            [t("borrow.maintenance_ratio", "Maintenance ratio"), R.mcrRow + (R.ratio.kind === "nominal" ? " (target only — preview is nominal)" : "")],
            [t("borrow.target_ratio", "Target ratio"), tcrRow],
            [t("borrow.fee", "Fee"), feeHuman, "raw " + String(R.fee.amount)],
            [t("borrow.network", "Network"), "testnet"]]));
          out.appendChild(el(doc, "p", t("borrow.fee_asset_note", "Fee asset 1.3.0 (switching deferred)."), "muted"));
          var back = touchable(el(doc, "button", t("borrow.back", "Back"))); back.type = "button";
          var send = touchable(el(doc, "button", t("borrow.sign_send", "Sign & Send"))); send.type = "button";
          out.appendChild(back); out.appendChild(send);
          back.addEventListener("click", function () { clearBox(out); btn.disabled = false; });
          send.addEventListener("click", function () {
            if (myGen !== gen) return; send.disabled = true; back.disabled = true;
            var status = showStatus(doc, out, t("borrow.broadcasting", "Broadcasting…"));
            var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
            if (!wif) { out.removeChild(status); signGateLocked(doc, out, send, back); return; }
            Tx.buildTx([R.pair]).then(function (unsigned) {
              return Credit.sendAndProve(unsigned, wif, async function () {
                try {
                  var rows = await Credit.positions(R.acct.id);
                  var fresh = null, any = null;
                  for (var i = 0; i < rows.length; i++) {
                    if (rows[i].coll_id === R.coll.id && rows[i].debt_id === R.debt.id) {
                      any = rows[i];
                      if (!R.preIds[rows[i].call_id]) { fresh = rows[i]; break; }
                    }
                  }
                  return fresh || any;
                } catch (e) { return null; } return null;
              });
            }).then(async function (res) {
              if (myGen !== gen) return; clearBox(out);
              out.appendChild(el(doc, "p", t("borrow.borrow_broadcast", "Borrow broadcast."), "xfer-ok"));
              out.appendChild(el(doc, "p", t("borrow.observed_at_head_block", "Observed at head block #") + String(await headBlock()) + " (" + res.via + ").", "muted"));
              btn.disabled = false;
            }).catch(function (e) {
              if (myGen !== gen) return; out.removeChild(status);
              showError(doc, out, e, t("borrow.failed_check_state_before_retrying_do_not_bli", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
              send.disabled = false; back.disabled = false;
            });
          });
          btn.disabled = false;
        });
      }).catch(function (e) {
        if (myGen !== gen) return; clearBox(out);
        showError(doc, out, e, t("borrow.could_not_prepare_the_borrow", "Could not prepare the borrow.")); btn.disabled = false;
      });
    });
  }

  /* My settlements (Phase 7 B4 UI): force-settlement orders for a typed
   * account (blank = wallet, resolved like fAcct above; reads are public).
   * Market.mySettlements first page (cursor unverifiable while no open
   * settlements exist chain-wide — afk-round-06). Table reuses
   * account.asset_th / market.th_amount / market.th_settle_date headers;
   * amounts via Format with per-asset precision from one batched get_assets
   * (raw fallback with title, never bare); dates via I18n.date with raw
   * fallback (market-orders settle-tab precedent). history-unavailable is
   * handled HERE with a keyed notice + Settings link (borrow showError has
   * no history mapping — never delegated). Never throws outward. */
  function mySettleSection(doc, wrap, myGen) {
    wrap.appendChild(el(doc, "h2", t("borrow.my_settlements", "My settlements")));
    wrap.appendChild(el(doc, "p", t("borrow.my_settlements_hint", "Force-settlement orders waiting at the feed price — yours or any account's, reads are public."), "muted"));
    var f = field(doc, t("borrow.account", "Account"), { placeholder: t("borrow.blank_wallet_account", "blank = wallet account") });
    wrap.appendChild(f.row);
    var go = touchable(el(doc, "button", t("referrals.look_up", "Look up"))); go.type = "button";
    wrap.appendChild(go);
    var box = el(doc, "div"); wrap.appendChild(box);
    go.addEventListener("click", function () {
      if (myGen !== gen) return;
      clearBox(box);
      showStatus(doc, box, t("market.loading_settle", "Loading settlement orders…"));
      Promise.resolve().then(async function () {
        var input = f.input.value.trim(), id = null;
        if (typeof Account === "undefined" || !Account) throw new Error("account backend missing");
        if (input) {
          if (typeof Account.resolve !== "function") throw new Error("account backend missing");
          var acct = await Account.resolve(input);
          id = acct && acct.id;
        } else if (typeof Account.myAccountId === "function") {
          id = await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; });
        } else {
          id = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0";
        }
        if (!/^1\.2\.\d+$/.test(id || "")) throw new Error("unknown-account");
        if (typeof Market === "undefined" || !Market || typeof Market.mySettlements !== "function") throw new Error("settle backend missing");
        var rows = await Market.mySettlements(id, 100);
        if (!rows || !rows.length) return { empty: true };
        var need = {};
        rows.forEach(function (r) { var aid = r && r.balance && r.balance.asset_id; if (aid) need[aid] = true; });
        var ids = Object.keys(need), precById = {}, symById = {};
        if (ids.length && typeof Chain !== "undefined" && Chain && typeof Chain.db === "function") {
          var dbId = await Chain.db();
          var metas = await Chain.call(dbId, "get_assets", [ids]);
          (metas || []).forEach(function (a, i) {
            if (a && typeof a.precision === "number") precById[ids[i]] = a.precision;
            if (a && a.symbol) symById[ids[i]] = a.symbol;
          });
        }
        var sorted = (typeof Market.sortSettles === "function") ? Market.sortSettles(rows) : rows.slice();
        return { rows: sorted, precById: precById, symById: symById };
      }).then(function (R) {
        if (myGen !== gen) return;
        clearBox(box);
        if (!R || R.empty) {
          box.appendChild(el(doc, "p", t("borrow.my_settlements_empty", "No open settlements for this account."), "muted"));
          return;
        }
        var table = doc.createElement("table"); table.className = "node-table";
        var hr = doc.createElement("tr");
        hr.appendChild(el(doc, "th", t("account.asset_th", "Asset")));
        hr.appendChild(el(doc, "th", t("market.th_amount", "Amount")));
        hr.appendChild(el(doc, "th", t("market.th_settle_date", "Settlement date")));
        table.appendChild(hr);
        R.rows.forEach(function (r) {
          var tr = doc.createElement("tr");
          var aid = (r && r.balance && r.balance.asset_id) || "";
          var sym = R.symById[aid] || aid;
          tr.appendChild(el(doc, "td", sym));
          var raw = (r && r.balance && r.balance.amount !== undefined && r.balance.amount !== null) ? String(r.balance.amount) : null;
          var prec = R.precById[aid];
          var td = null;
          if (raw !== null && typeof prec === "number") {
            try {
              td = el(doc, "td", Format.formatAmount(raw, prec));
              td.title = raw;
            } catch (e) { td = el(doc, "td", raw); }
          } else {
            td = el(doc, "td", raw === null ? "—" : raw);
          }
          tr.appendChild(td);
          var dt = (r && r.settlement_date) || "";
          var dHuman = dt;
          try {
            if (dt && typeof I18n !== "undefined" && I18n && typeof I18n.date === "function") dHuman = I18n.date(dt);
          } catch (e) { dHuman = dt; }
          tr.appendChild(el(doc, "td", dHuman || "—"));
          table.appendChild(tr);
        });
        box.appendChild(table);
      }).catch(function (e) {
        if (myGen !== gen) return;
        clearBox(box);
        var m = (e && e.message) ? e.message : "";
        if (m.indexOf("history-unavailable") !== -1) {
          box.appendChild(el(doc, "p", t("borrow.settlements_unavailable", "Settlements unavailable on this node — switch nodes in Settings."), "muted"));
          try {
            if (typeof HistoryNotice !== "undefined" && HistoryNotice &&
                typeof HistoryNotice.actionLink === "function") {
              var link = HistoryNotice.actionLink(doc, t, "settings");
              if (link) box.appendChild(link);
            }
          } catch (e2) { /* notice stands without the link */ }
          return;
        }
        showError(doc, box, e, t("market.fail_settle", "Could not load settlement orders."));
      });
    });
  }

  /* C27 settlement-bid section (op 45 bid_collateral, BSIP-0018). ASSET-driven,
   * not position-driven: borrow-ui positions carry no RSQ/call-ratio field, so
   * there is no per-position bid gate to read — the chain gate is the 2.4.x
   * bitasset's settlement_fund (> 0 means globally settled, fund exists).
   * Layout: asset input + Check button, then fund line + existing-bids table
   * (get_collateral_bids) always, bid form only while a fund exists. */
  function settleSection(doc, wrap, myGen) {
    wrap.appendChild(el(doc, "h2", t("borrow.settlement_bids_op_45", "Settlement bids (op 45)")));
    wrap.appendChild(el(doc, "p", t("borrow.after_a_bitasset_globally_settles_anyone_can", "After a bitasset globally settles, anyone can bid collateral to take over part of the debt and the settlement fund (BSIP-0018). Enter the settled asset: the fund and existing bids always read; the bid form appears only while a settlement fund exists."), "muted"));
    var fAsset = field(doc, t("borrow.settled_asset_symbol_or_1_3_x", "Settled asset (symbol or 1.3.x)"), { placeholder: t("borrow.e_g_bitusd", "e.g. bitUSD") });
    wrap.appendChild(fAsset.row);
    var chk = touchable(el(doc, "button", t("borrow.check_settlement_fund", "Check settlement fund"))); chk.type = "button";
    wrap.appendChild(chk);
    var box = el(doc, "div"); wrap.appendChild(box);
    chk.addEventListener("click", function () {
      if (myGen !== gen) return;
      settleCheck(doc, box, myGen, fAsset.input.value.trim());
    });
  }
  /* Resolve the asset, read its bitasset fund, list bids, gate the form.
   * Params: input (symbol or 1.3.x). Fund raw stays a digit string until
   * Format renders it; precisions come from get_assets, never assumed. */
  function settleCheck(doc, box, myGen, input) {
    clearBox(box);
    if (!input) { showError(doc, box, new Error("unknown-asset"), t("borrow.enter_a_bitasset_symbol_or_id_first", "Enter a bitasset symbol or id first.")); return; }
    showStatus(doc, box, t("borrow.resolving_asset_and_settlement_fund", "Resolving asset and settlement fund…"));
    Promise.resolve().then(async function () {
      var dbId = await Chain.db();
      var asset = null;
      if (/^1\.3\.\d+$/.test(input)) {
        var byId = await Chain.call(dbId, "get_assets", [[input]]);
        asset = byId && byId[0];
      } else {
        var bySym = await Chain.call(dbId, "lookup_asset_symbols", [[input]]);
        asset = bySym && bySym[0];
      }
      if (!asset) throw new Error("unknown-asset");
      if (!asset.bitasset_data_id) {
        return { asset: asset, fundRaw: null, note: String(asset.symbol || input) +
          " is not a bitasset (no settlement fund). Bids apply only to globally settled bitassets." };
      }
      var objs = await Chain.call(dbId, "get_objects", [[asset.bitasset_data_id]]);
      var bit = (objs && objs[0]) || null;
      if (!bit) throw new Error("unknown-asset");
      var fundRaw = String(bit.settlement_fund !== undefined && bit.settlement_fund !== null ? bit.settlement_fund : "0");
      if (!/^\d+$/.test(fundRaw)) fundRaw = "0";
      var backingId = (bit.options && bit.options.short_backing_asset) || "1.3.0";
      var metas = await Chain.call(dbId, "get_assets", [[backingId, asset.id]]);
      var backingPrec = (metas && metas[0] && typeof metas[0].precision === "number") ? metas[0].precision : null;
      var debtPrec = (metas && metas[1] && typeof metas[1].precision === "number") ? metas[1].precision : asset.precision;
      var bids = await Chain.call(dbId, "get_collateral_bids", [asset.id, 100, 0]);
      return { asset: asset, bit: bit, fundRaw: fundRaw, backingId: backingId,
        backingPrec: backingPrec, debtPrec: debtPrec, bids: bids || [] };
    }).then(function (R) {
      if (myGen !== gen) return;
      clearBox(box);
      if (R.fundRaw === null) {
        box.appendChild(el(doc, "p", R.note, "muted"));
        return;
      }
      var fundHuman = (typeof R.backingPrec === "number")
        ? Format.formatAmount(R.fundRaw, R.backingPrec) : R.fundRaw;
      var fundLine = el(doc, "p", "Settlement fund for " + R.asset.symbol + ": " + fundHuman +
        ((typeof R.backingPrec === "number") ? " (backing " + R.backingId + ")" : " (raw " + R.fundRaw + ")"));
      fundLine.title = t("account.raw_prefix", "raw ") + R.fundRaw;
      box.appendChild(fundLine);
      box.appendChild(bidsTable(doc, R.bids, R));
      if (R.fundRaw === "0") {
        box.appendChild(el(doc, "p", "No settlement fund for " + R.asset.symbol + " (not globally settled). The bid form stays disabled until a fund exists — no broadcast without a target.", "muted"));
        return;
      }
      var flags = Number(R.asset.options && R.asset.options.flags);
      if (Number.isFinite(flags) && (flags & 0x8000)) {
        box.appendChild(el(doc, "p", R.asset.symbol + " has collateral bidding disabled by issuer flag (0x8000). Bids would be rejected — no form offered.", "muted"));
        return;
      }
      if (typeof R.backingPrec !== "number" || typeof R.debtPrec !== "number") {
        box.appendChild(el(doc, "p", t("borrow.unexpected_asset_data_from_the_node_stopped_i", "Unexpected asset data from the node; stopped instead of guessing."), "muted"));
        return;
      }
      bidBox(doc, box, myGen, R);
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearBox(box);
      showError(doc, box, e, t("borrow.could_not_load_the_settlement_fund", "Could not load the settlement fund."));
    });
  }
  /* Existing-bids table (desktop) + phone cards; legs human via the joined
   * precisions, raw integers in title (never shown bare). Empty -> honest note. */
  function bidsTable(doc, bids, R) {
    var box = el(doc, "div");
    if (!bids || !bids.length) {
      box.appendChild(el(doc, "p", "No collateral bids on " + R.asset.symbol + t("borrow.bids_suffix", " yet. Place one from the bid form below — bids list here."), "muted"));
      return box;
    }
    var table = doc.createElement("table"); table.className = "node-table";
    var hr = doc.createElement("tr");
    [t("borrow.hdr_bidder", "Bidder"), t("borrow.hdr_collateral", "Collateral"), t("borrow.hdr_debt_covered", "Debt covered")].forEach(function (t) {
      var th = doc.createElement("th"); th.textContent = t; hr.appendChild(th); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    bids.forEach(function (b) {
      var tr = doc.createElement("tr");
      var bidder = doc.createElement("td"); bidder.textContent = b.bidder || "—"; tr.appendChild(bidder);
      var inv = b.additional_collateral || {}, debt = b.debt_covered || {};
      var c = doc.createElement("td");
      c.textContent = Format.formatAmount(String(inv.amount), R.backingPrec);
      c.title = t("account.raw_prefix", "raw ") + String(inv.amount);
      tr.appendChild(c);
      var d = doc.createElement("td");
      d.textContent = Format.formatAmount(String(debt.amount), R.debtPrec);
      d.title = t("account.raw_prefix", "raw ") + String(debt.amount);
      tr.appendChild(d);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); box.appendChild(table);
    var cards = el(doc, "div", null, "node-cards");
    bids.forEach(function (b) {
      var c = el(doc, "div", null, "node-card");
      var inv = b.additional_collateral || {}, debt = b.debt_covered || {};
      c.appendChild(el(doc, "div", "Bidder " + (b.bidder || "—")));
      c.appendChild(el(doc, "div", "Collateral " + Format.formatAmount(String(inv.amount), R.backingPrec)));
      c.appendChild(el(doc, "div", "Debt " + Format.formatAmount(String(debt.amount), R.debtPrec)));
      cards.appendChild(c);
    });
    box.appendChild(cards);
    return box;
  }
  /* Op-45 bid form: bidder (defaults to the wallet account) + collateral/debt
   * legs in display units; both legs REQUIRED > 0 (#4 market.cpp validate:
   * nonzero debt needs nonzero collateral). Live fee, named-row confirm,
   * re-read proof = the bid list observed again at a new head block. */
  function bidBox(doc, box, myGen, R) {
    box.appendChild(el(doc, "h3", t("borrow.place_a_bid", "Place a bid")));
    var lockedBid = !isUnlockedNow();
    var fBidder = field(doc, t("borrow.bidder_blank_wallet_account", "Bidder (blank = wallet account)"), lockedBid
      ? { placeholder: t("borrow.blank_wallet_account", "blank = wallet account"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("borrow.blank_wallet_account", "blank = wallet account") });
    var fColl = field(doc, t("borrow.coll_units_tpl", "Collateral (%(id)s units)", { id: R.backingId }), { placeholder: t("borrow.e_g_10_0", "e.g. 10.0"), inputmode: "decimal" });
    var fDebt = field(doc, t("borrow.debt_units_tpl", "Debt to cover (%(sym)s units)", { sym: R.asset.symbol }), { placeholder: t("borrow.e_g_5_0", "e.g. 5.0"), inputmode: "decimal" });
    [fBidder, fColl, fDebt].forEach(function (f) { box.appendChild(f.row); });
    box.appendChild(el(doc, "p", t("borrow.a_bid_locks_your_collateral_against_the_settl", "A bid locks your collateral against the settlement fund; the chain matches it while reviving the asset. Both legs must be above zero."), "muted"));
    var btn = touchable(el(doc, "button", t("borrow.review_bid", "Review bid"))); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    Account.myAccountId().then(function (id) {
      if (myGen === gen && !fBidder.input.value) fBidder.input.value = id;
    }).catch(function () { /* manual bidder entry remains */ });
    btn.addEventListener("click", function () {
      if (myGen !== gen) return;
      clearBox(out); btn.disabled = true;
      showStatus(doc, out, t("borrow.resolving_and_estimating_fee", "Resolving and estimating fee…"));
      Promise.resolve().then(async function () {
        var bidderId = fBidder.input.value.trim() ? (await Account.resolve(fBidder.input.value.trim())).id
          : await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; });
        var collRaw = Format.parseAmount(fColl.input.value, R.backingPrec);
        var debtRaw = Format.parseAmount(fDebt.input.value, R.debtPrec);
        if (BigInt(collRaw) <= 0n || BigInt(debtRaw) <= 0n) {
          throw new Error(t("borrow.both_legs_must_be_above_zero_nonzero_debt_nee", "Both legs must be above zero (nonzero debt needs nonzero collateral)."));
        }
        var pair = [45, { fee: { amount: "0", asset_id: "1.3.0" }, bidder: bidderId,
          additional_collateral: { amount: collRaw, asset_id: R.backingId },
          debt_covered: { amount: debtRaw, asset_id: R.asset.id }, extensions: [] }];
        var fee = await Credit.fee(pair, "1.3.0");
        return { pair: pair, fee: fee, bidderId: bidderId, collRaw: collRaw, debtRaw: debtRaw };
      }).then(function (S) {
        if (myGen !== gen) return;
        Asset.describe(S.fee.asset_id).then(function (a) { return a; }).catch(function () { return null; })
        .then(function (fa) {
          if (myGen !== gen) return;
          var feeHuman = fa ? Format.formatAmount(String(S.fee.amount), fa.precision) + " " + fa.symbol : String(S.fee.amount);
          clearBox(out);
          out.appendChild(el(doc, "h3", t("borrow.confirm_settlement_bid", "Confirm settlement bid")));
          out.appendChild(confirmList(doc, [
            [t("borrow.bidder", "Bidder"), S.bidderId],
            [t("borrow.collateral", "Collateral"), Format.formatAmount(S.collRaw, R.backingPrec) + " (" + R.backingId + ")", "raw " + S.collRaw],
            [t("borrow.debt_covered", "Debt covered"), Format.formatAmount(S.debtRaw, R.debtPrec) + " " + R.asset.symbol, "raw " + S.debtRaw],
            [t("borrow.fund", "Fund"), Format.formatAmount(R.fundRaw, R.backingPrec), "raw " + R.fundRaw],
            [t("borrow.fee", "Fee"), feeHuman, "raw " + String(S.fee.amount)], [t("borrow.network", "Network"), "testnet"]]));
          out.appendChild(el(doc, "p", t("borrow.fee_asset_note", "Fee asset 1.3.0 (switching deferred)."), "muted"));
          var back = touchable(el(doc, "button", t("borrow.back", "Back"))); back.type = "button";
          var send = touchable(el(doc, "button", t("borrow.sign_send", "Sign & Send"))); send.type = "button";
          out.appendChild(back); out.appendChild(send);
          back.addEventListener("click", function () { clearBox(out); btn.disabled = false; });
          send.addEventListener("click", function () {
            if (myGen !== gen) return; send.disabled = true; back.disabled = true;
            var status = showStatus(doc, out, t("borrow.broadcasting", "Broadcasting…"));
            var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
            if (!wif) { out.removeChild(status); signGateLocked(doc, out, send, back); return; }
            Tx.buildTx([S.pair]).then(function (unsigned) {
              return Credit.sendAndProve(unsigned, wif, async function () {
                try {
                  var dbId = await Chain.db();
                  return await Chain.call(dbId, "get_collateral_bids", [R.asset.id, 100, 0]);
                } catch (e) { return null; } return null;
              });
            }).then(async function (res) {
              if (myGen !== gen) return; clearBox(out);
              out.appendChild(el(doc, "p", t("borrow.bid_broadcast", "Bid broadcast."), "xfer-ok"));
              out.appendChild(el(doc, "p", t("borrow.observed_at_head_block", "Observed at head block #") + String(await headBlock()) + " (" + res.via + ").", "muted"));
              btn.disabled = false;
            }).catch(function (e) {
              if (myGen !== gen) return; out.removeChild(status);
              showError(doc, out, e, t("borrow.failed_check_state_before_retrying_do_not_bli", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
              send.disabled = false; back.disabled = false;
            });
          });
          btn.disabled = false;
        });
      }).catch(function (e) {
        if (myGen !== gen) return; clearBox(out);
        showError(doc, out, e, t("borrow.could_not_prepare_the_bid", "Could not prepare the bid.")); btn.disabled = false;
      });
    });
  }

  return { renderBorrow: renderBorrow };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.BorrowUI === "undefined") { globalThis.BorrowUI = BorrowUI; }
if (typeof module !== "undefined") { module.exports = BorrowUI; }
