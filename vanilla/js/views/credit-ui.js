/* credit-ui.js — #/credit-offer desk + op-69 create form + open-offers loan modal + shared CreditUI._ui helpers.
 * Owns: OPEN OFFERS list (all chain offers, reference CreditOfferPage column
 *   language) + loan modal (op-72 borrow against the row's offer, borrow leg
 *   from the offer, password only at Sign & Send) + filters + my-offers +
 *   op-69 create form (asset resolve, human rate/duration/min-deal,
 *   collateral/borrower rows, live fee, named-row confirm). Offer detail
 *   (#/credit-offer/:id) lives in credit-detail-ui.js and the Same-T desk (#/samet) in samet-ui.js (cap splits — pool-detail-ui.js
 *   precedent: detail files keep their own gen + check BOTH counters); Borrow
 *   (#/borrow) lives in borrow-ui.js and barter (#/barter) in barter-ui.js
 *   (pre-authorized). All four reuse the _ui helpers below (route gate,
 *   confirm+publish flow, deskTable cards, human formatters) via CreditUI._ui.
 *   No money math here (Credit builders + Format do it); no serializers (tx.js
 *   owns bytes). WIFs are JS values, never DOM. Unknown ids -> empty state.
 * Consumes: Credit (offers/offersByOwner/offersByAsset reads, rate + duration
 *   helpers, op-69 builder, fee/sendAndProve), Tx.buildTx, Format (human
  *   strings only), Account (resolve/myAccountId), Asset.describe, Wallet,
  *   Chain/Store. Created by: building-vanilla-slices skill, slice-13 plan Task 3.
  * PUBLIC-FIRST (gate repair): routeReady never gates on unlock — filters/list/
  *   create-preview render locked under committee-account 1.2.0 with a viewing
  *   notice (pool-ui.js precedent). Password is asked only at Sign & Send
  *   (sendConfirm sign-time gate + inline unlock); reviews stay read-only.
 * CHAIN TRUTH (#4 wins): spaces 1.21/1.22/1.20 <- types.hpp:384-385/:383;
 *   FEE_RATE_DENOM=1000000 (1000 units = 0.1%) <- config.hpp:121 (#2's /10000
 *   rejected); auto_repay 0/1/2 words <- credit_offer.hpp:118-129; there is NO
 *   deal_create op (deals spawn from op-72 accept). Layout mirrors #1
 *   CreditOfferPage/CreditOfferList columns + CreateModal fields (retro #2).
 */
var CreditUI = (function () {
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
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(b) { while (b.firstChild) b.removeChild(b.firstChild); }
  /* Thrown values -> human sentences; unknown shapes fall back generic. */
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || t("credit.unexpected_error", "Unexpected error"));
    if (m.indexOf("not-connected") !== -1) m = t("credit.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    else if (m.indexOf("wallet-locked") !== -1) m = t("credit.wallet_is_locked", "Wallet is locked.");
    else if (m.indexOf("unknown-offer") !== -1) m = t("credit.unknown_credit_offer", "Unknown credit offer.");
    else if (m.indexOf("unknown-fund") !== -1) m = t("credit.unknown_same_t_fund", "Unknown Same-T fund.");
    else if (m.indexOf("unknown-deal") !== -1) m = t("credit.unknown_credit_deal", "Unknown credit deal.");
    else if (m.indexOf("unknown-account") !== -1) m = t("credit.unknown_account", "Unknown account.");
    else if (m.indexOf("unknown-asset") !== -1) m = t("credit.unknown_asset", "Unknown asset.");
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite");
    wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function offlineBox(doc, wrap, retryFn) { /* Offline panel: copy depends on
    * actual connection (unknown-id failures while connected must not claim
    * the network is down). Retry handshakes via the shared Offline helper
    * (js/api/offline.js — re-render only left dead buttons); Open Settings
    * links to #/settings for node failover. Falls back to plain re-render
    * when the helper script failed to load. */
    var open = (typeof Chain !== "undefined" && Chain && Chain.status && Chain.status().state === "open");
    wrap.appendChild(el(doc, "p", open
      ? t("credit.retry_load", "Retry loading.")
      : t("credit.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
    var status = el(doc, "p", "", "muted");
    try { status.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    wrap.appendChild(status);
    var row = el(doc, "div", null, "pools-offline-row");
    wrap.appendChild(row);
    var b = touchable(el(doc, "button", t("credit.retry", "Retry"))); b.type = "button";
    row.appendChild(b);
    var off = null;
    try { off = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { off = null; }
    if (off && typeof off.wire === "function") {
      try { off.wire(b, status, retryFn, t); } catch (e) { b.addEventListener("click", retryFn); }
    } else {
      b.addEventListener("click", retryFn);
    }
    var link = null;
    if (off && typeof off.settingsLink === "function") {
      try { link = off.settingsLink(doc, t); } catch (e) { link = null; }
    }
    if (!link) {
      link = el(doc, "a", t("notice.open_settings", "Open Settings"));
      try { link.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
      touchable(link);
    }
    row.appendChild(link);
  }
  /* Default viewing account while locked: committee-account 1.2.0 (a public
   * chain object on testnet+mainnet, verified live 2026-09-28). Reads stay
   * public under it; writes gate at Sign & Send (sendConfirm). Never throws
   * — locked render is normal. */
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
    return el(doc, "p", t("credit.locked_preview_note", "Wallet locked — preview only. Password is asked at Sign & Send, never to view."), "muted");
  }
  function unlockInline(doc, parent, onUnlock) { /* in-place password row (no route re-render, so previews survive) */
    if (parent.querySelector && parent.querySelector(".xfer-unlock-row")) return;
    var row = el(doc, "div", null, "xfer-field xfer-unlock-row");
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("autocomplete", "current-password");
    inp.setAttribute("placeholder", t("credit.password", "password")); inp.setAttribute("aria-label", t("credit.password", "password"));
    touchable(inp); row.appendChild(inp);
    var b = touchable(el(doc, "button", t("credit.unlock", "Unlock"))); b.type = "button"; row.appendChild(b);
    parent.appendChild(row);
    b.addEventListener("click", function () { b.disabled = true;
      /* H2: wipe the password local + input on either outcome. */
      var pw = inp.value;
      Wallet.unlock(pw).then(function () { inp.value = ""; pw = null; if (onUnlock) onUnlock(); })
        .catch(function (e) { inp.value = ""; pw = null; b.disabled = false; showError(doc, parent, e, t("credit.unlock_failed", "Unlock failed.")); });
    });
  }
  function dropSubs() { subs.forEach(function (off) { try { off(); } catch (e) {} }); subs = []; }
  /* Gate a route: backend globals + online (offline -> panel+Retry).
   * PUBLIC-FIRST: no wallet gate here — lists/details/previews render locked. */
  function routeReady(root, title, retry) {
    var doc = root.ownerDocument || document, myGen = ++gen, miss = null;
    dropSubs(); root.innerHTML = "";
    ["Credit", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"].forEach(function (g) {
      if (typeof globalThis[g] === "undefined") miss = g; });
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", title));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") {
      offlineBox(doc, wrap, retry);
      try {
        var h = (typeof location !== "undefined" && location.hash) || "", done = false;
        subs.push(Store.subscribe("connection", function (st) {
          if (done || myGen !== gen) { done = true; return; }
          if (st && st.state === "open") { done = true;
            if (typeof location === "undefined" || location.hash === h) retry(); }
        }));
      } catch (e) { /* manual Retry remains */ }
      /* Automated handshake on entry (Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* manual Retry remains */ }
      return null;
    }
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
  function tableHead(doc, titles) {
    var hr = doc.createElement("tr");
    titles.forEach(function (t) { hr.appendChild(el(doc, "th", t)); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); return thead;
  }
  /* Table (desktop, sticky first col via .node-table) + cards (phone <560px). */
  function deskTable(doc, headers, rows, cardLines) {
    var box = el(doc, "div");
    if (!rows.length) { box.appendChild(el(doc, "p", t("credit.nothing_here_yet", "Nothing here yet.") + t("credit.offers_hint", " Offers appear once anyone creates one — draft yours in the Create offer form on this desk."), "muted")); return box; }
    var table = doc.createElement("table"); table.className = "node-table";
    table.appendChild(tableHead(doc, headers));
    var tbody = doc.createElement("tbody");
    rows.forEach(function (r) {
      var tr = doc.createElement("tr");
      r.cells.forEach(function (c) {
        var td = el(doc, "td", c.text); if (c.raw) td.title = t("account.raw_prefix", "raw ") + c.raw; tr.appendChild(td); });
      if (r.href) { var td = doc.createElement("td");
        var a = el(doc, "a", t("credit.open", "Open")); a.setAttribute("href", r.href); td.appendChild(a); tr.appendChild(td); }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); box.appendChild(table);
    var cards = el(doc, "div", null, "node-cards");
    rows.forEach(function (r) {
      var c = el(doc, "div", null, "node-card");
      cardLines(r).forEach(function (ln) { c.appendChild(el(doc, "div", ln)); });
      if (r.href) { var a = el(doc, "a", t("credit.open", "Open")); a.setAttribute("href", r.href); c.appendChild(a); }
      cards.appendChild(c);
    });
    box.appendChild(cards); return box;
  }
  async function feeText(fee) { /* live fee -> human + raw title */
    try {
      var a = await Asset.describe(fee.asset_id);
      return { text: Format.formatAmount(String(fee.amount), a.precision) + " " + a.symbol, raw: String(fee.amount) };
    } catch (e) { return { text: String(fee.amount) + " (" + fee.asset_id + ")", raw: String(fee.amount) }; }
  }
  async function headBlock() {
    return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
  }
  function amt(raw, prec, sym, id) { /* raw int -> {text human, raw} */
    if (typeof prec === "number" && /^\d+$/.test(String(raw)))
      return { text: Format.formatAmount(String(raw), prec) + (sym ? " " + sym : ""), raw: String(raw) };
    return { text: String(raw) + " (" + id + ")", raw: String(raw) };
  }
  function rateText(u) { return { text: Credit.rateUnitsToHuman(u) + "%", raw: String(u) }; }
  function who(me) { return me.name + " (" + me.id + ")"; }
  /** Confirm + publish: fresh-WIF sign inside sendAndProve, re-read proof, result.
   * TYPE NOTE: the cfg.build promise resolves {pair, fee, prove} but tsc
   * reads the chain as Promise<void>; member casts pin each field to any.
   * No shared types.js yet (group 1 owns it); local casts only.
   * @param {Document} doc owner document
   * @param {HTMLElement} out output box (cleared + rebuilt)
   * @param {any} cfg {title, rows, makeUnsigned, prove, okText}
   * @param {number} myGen route generation (liveness token)
   * @returns {void} */
  function sendConfirm(doc, out, cfg, myGen) {
    clearBox(out);
    out.appendChild(el(doc, "h3", cfg.title)); out.appendChild(confirmList(doc, cfg.rows));
    var back = touchable(el(doc, "button", t("credit.back", "Back"))); back.type = "button";
    var send = touchable(el(doc, "button", t("credit.sign_send", "Sign & Send"))); send.type = "button";
    out.appendChild(back); out.appendChild(send);
    back.addEventListener("click", function () { clearBox(out); });
    send.addEventListener("click", function () {
      if (myGen !== gen) return; send.disabled = true; back.disabled = true;
      var status = showStatus(doc, out, t("credit.signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) { /* SIGN-TIME GATE: password asked only here — preview stays visible */
        out.removeChild(status);
        if (!out.querySelector || !out.querySelector(".xfer-sign-note")) {
          var note = el(doc, "p", t("credit.locked_sign_note", "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."), "muted");
          note.className = "muted xfer-sign-note"; out.appendChild(note);
        }
        unlockInline(doc, out, function () {
          out.appendChild(el(doc, "p", t("credit.unlocked_rereview_note", "Unlocked — press Back and re-run Review so the transaction uses your account."), "muted"));
        });
        send.disabled = false; back.disabled = false; return; }
      Promise.resolve().then(cfg.makeUnsigned).then(function (unsigned) {
        status.textContent = t("credit.broadcasting", "Broadcasting…");
        return Credit.sendAndProve(unsigned, wif, cfg.prove);
      }).then(async function (res) {
        if (myGen !== gen) return; clearBox(out);
        out.appendChild(el(doc, "p", cfg.okText, "xfer-ok"));
        out.appendChild(el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
      }).catch(function (e) {
        if (myGen !== gen) return; out.removeChild(status);
        showError(doc, out, e, t("credit.failed_check_state_before_retrying_do_not_bli", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
        send.disabled = false; back.disabled = false;
      });
    });
  }
  /** build {pair,fee,prove,extra} + live fee -> named rows -> sendConfirm.
   * @param {Document} doc owner document
   * @param {HTMLElement} out output box (cleared + rebuilt)
   * @param {number} myGen route generation (liveness token)
   * @param {any} cfg {build, rows, title, ok, fail, btn?}
   * @returns {void} */
  function reviewPaid(doc, out, myGen, cfg) {
    clearBox(out); if (cfg.btn) cfg.btn.disabled = true;
    showStatus(doc, out, t("credit.resolving_and_estimating_fee", "Resolving and estimating fee…"));
    function done() { if (cfg.btn) cfg.btn.disabled = false; }
    Promise.resolve().then(cfg.build).then(function (built) {
      if (myGen !== gen) return done();
      feeText((/** @type {any} */ (built).fee)).then(function (f) {
        if (myGen !== gen) return done();
        sendConfirm(doc, out, { title: cfg.title, rows: cfg.rows(built, f),
          makeUnsigned: function () { return Tx.buildTx([(/** @type {any} */ (built).pair)]); },
          prove: (/** @type {any} */ (built).prove), okText: cfg.ok(built) }, myGen);
        done();
      }).catch(function (e) { if (myGen === gen) { clearBox(out); showError(doc, out, e, t("credit.fee_lookup_failed", "Fee lookup failed.")); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      clearBox(out); showError(doc, out, e, cfg.fail || t("credit.could_not_prepare_the_transaction", "Could not prepare the transaction.")); done();
    });
  }
  function reviewSection(doc, box, myGen, label, cfg) {
    var btn = touchable(el(doc, "button", label)); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    cfg.btn = btn;
    btn.addEventListener("click", function () { if (myGen === gen) reviewPaid(doc, out, myGen, cfg); });
    return btn;
  }
  /* ---- offer rows: table cells + phone card lines (all amounts/rates human) */
  function offerRows(list) {
    return list.map(function (o) {
      var cur = amt(o.current_raw, o.prec, o.sym, o.asset_id), tot = amt(o.total_raw, o.prec, o.sym, o.asset_id);
      var rt = rateText(o.rate_units);
      return { o: o, href: "#/credit-offer/" + o.id,
        cells: [{ text: o.id }, { text: o.owner }, { text: o.sym || o.asset_id },
          { text: cur.text, raw: cur.raw }, { text: tot.text, raw: tot.raw },
          { text: rt.text, raw: rt.raw }, { text: Credit.durToHuman(o.max_dur_sec) }, { text: o.enabled ? t("credit.yes", "yes") : t("credit.no", "no") }] };
    });
  }
  function offerCards(r) {
    var o = r.o;
    return [o.id + " · " + (o.sym || o.asset_id), "Owner " + o.owner,
      "Current " + r.cells[3].text + " / total " + r.cells[4].text,
      "Rate " + r.cells[5].text + " · " + r.cells[6].text + " · " + (o.enabled ? t("credit.enabled_2", "enabled") : t("credit.disabled", "disabled"))];
  }
  /* Rate display that never kills the list: live chain data carries fee_rate
   * units above FEE_RATE_DENOM (mainnet 25000000 observed 2026-09-29 — the
   * u32 denom holds, the chain simply allows >100% offers). Human percent when
   * in range, honest raw-units fallback otherwise (amt() precedent). */
  function safeRate(u) {
    try { return { text: Credit.rateUnitsToHuman(u) + "%", raw: String(u) }; }
    catch (e) { return { text: String(u) + " (raw units)", raw: String(u) }; }
  }
  function safeRateHuman(u) { try { return Credit.rateUnitsToHuman(u); } catch (e) { return ""; } }
  /* Open-offers table: reference CreditOfferPage._getColumns language (ID /
   * Asset / Account / Total / Available / Min borrow / Fee rate / Repay period
   * / Validity / Mortgage + Borrow action). TOTAL = total_balance;
   * AVAILABLE = current_balance (the chain-maintained total-minus-active-deals;
   * a per-row deal-sum recompute from dealsByOffer rows is recorded here as
   * deferred — N+1 reads for a list, chain value is ground truth).
   * EXPIRATION = auto_disable_time (validity_period in #1; the offer object
   * carries no other expiry field per credit_offer.hpp:36-64 — blank shows
   * a dash, never blank). LOAN = Borrow button per row. Row click (never on
   * links/buttons) and the Borrow button both open the loan modal
   * (openLoanModal — name verified from commit 123f034); Enter on a focused
   * row too. hostBox owns the modal overlay so a list reload clears a stale
   * modal. Header words Available/Expiration/Loan are batch-3-keyed. */
  function openOffersTable(doc, hostBox, myGen, rows) {
    var box = el(doc, "div");
    if (!rows.length) { box.appendChild(el(doc, "p", t("credit.nothing_here_yet", "Nothing here yet.") + t("credit.offers_hint", " Offers appear once anyone creates one — draft yours in the Create offer form on this desk."), "muted")); return box; }
    var table = doc.createElement("table"); table.className = "node-table offers-table";
    table.appendChild(tableHead(doc, [t("credit.offer", "Offer"), t("credit.asset", "Asset"), t("credit.owner", "Owner"),
      t("credit.total", "Total"), t("credit.available", "Available"), t("credit.min_deal_amount", "Min deal amount"),
      t("credit.fee_rate", "Fee rate"), t("credit.max_duration", "Max duration"),
      t("credit.expiration", "Expiration"), t("credit.collateral", "Collateral"),
      t("credit.loan", "Loan"), ""]));
    var tbody = doc.createElement("tbody");
    rows.forEach(function (o) {
      var cur = amt(o.current_raw, o.prec, o.sym, o.asset_id), tot = amt(o.total_raw, o.prec, o.sym, o.asset_id);
      var avail = (o.current_raw === null || o.current_raw === undefined || String(o.current_raw) === "") ? { text: "—", raw: "" } : cur;
      var exp = (o.auto_disable_time && String(o.auto_disable_time).trim()) ? String(o.auto_disable_time).trim() : "—";
      var min = amt(o.min_deal_raw, o.prec, o.sym, o.asset_id), rt = safeRate(o.rate_units);
      var tr = doc.createElement("tr"); tr.setAttribute("data-offer", o.id); tr.tabIndex = 0;
      tr.appendChild(el(doc, "td", o.id));
      tr.appendChild(el(doc, "td", o.sym || o.asset_id));
      tr.appendChild(el(doc, "td", o.owner));
      var c1 = el(doc, "td", tot.text); if (tot.raw) c1.title = t("account.raw_prefix", "raw ") + tot.raw; tr.appendChild(c1);
      var c2 = el(doc, "td", avail.text); if (avail.raw) c2.title = t("account.raw_prefix", "raw ") + avail.raw; tr.appendChild(c2);
      var c3 = el(doc, "td", min.text); if (min.raw) c3.title = t("account.raw_prefix", "raw ") + min.raw; tr.appendChild(c3);
      var c4 = el(doc, "td", rt.text); if (rt.raw) c4.title = t("account.raw_prefix", "raw ") + rt.raw; tr.appendChild(c4);
      tr.appendChild(el(doc, "td", Credit.durToHuman(o.max_dur_sec)));
      tr.appendChild(el(doc, "td", exp));
      tr.appendChild(el(doc, "td", o.collateral_raw.length ? o.collateral_raw.map(function (c) { return c[0]; }).join(", ") : "—"));
      var tdB = doc.createElement("td");
      var bb = touchable(el(doc, "button", t("credit.borrow", "Borrow"))); bb.type = "button";
      bb.addEventListener("click", function (e) { e.stopPropagation(); openLoanModal(doc, hostBox, myGen, o); });
      tdB.appendChild(bb); tr.appendChild(tdB);
      var tdO = doc.createElement("td");
      var a = el(doc, "a", t("credit.open", "Open")); a.setAttribute("href", "#/credit-offer/" + o.id); tdO.appendChild(a); tr.appendChild(tdO);
      tr.addEventListener("click", function (e) {
        var n = e.target;
        while (n && n !== tr) { if (n.tagName === "A" || n.tagName === "BUTTON") return; n = n.parentElement; }
        openLoanModal(doc, hostBox, myGen, o);
      });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && myGen === gen) openLoanModal(doc, hostBox, myGen, o);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var scroller = el(doc, "div", null, "offers-scroll");
    scroller.appendChild(table); box.appendChild(scroller);
    var cards = el(doc, "div", null, "node-cards");
    rows.forEach(function (o) {
      var cur = amt(o.current_raw, o.prec, o.sym, o.asset_id), tot = amt(o.total_raw, o.prec, o.sym, o.asset_id);
      var availC = (o.current_raw === null || o.current_raw === undefined || String(o.current_raw) === "") ? "—" : cur.text;
      var expC = (o.auto_disable_time && String(o.auto_disable_time).trim()) ? String(o.auto_disable_time).trim() : "—";
      var c = el(doc, "div", null, "node-card"); c.setAttribute("data-offer", o.id);
      c.appendChild(el(doc, "div", o.id + " · " + (o.sym || o.asset_id)));
      c.appendChild(el(doc, "div", t("credit.owner", "Owner") + " " + o.owner));
      c.appendChild(el(doc, "div", t("credit.total_prefix", "Total ") + tot.text + t("credit.available_mid", " / Available ") + availC));
      c.appendChild(el(doc, "div", t("credit.fee_rate", "Fee rate") + " " + safeRate(o.rate_units).text + " · " + t("credit.max_duration", "Max duration") + " " + Credit.durToHuman(o.max_dur_sec) + t("credit.expiration_mid", " · Expiration ") + expC));
      var cb = touchable(el(doc, "button", t("credit.borrow", "Borrow") + " " + o.id)); cb.type = "button";
      cb.addEventListener("click", function () { openLoanModal(doc, hostBox, myGen, o); });
      c.appendChild(cb);
      var ca = el(doc, "a", t("credit.open", "Open")); ca.setAttribute("href", "#/credit-offer/" + o.id); c.appendChild(ca);
      cards.appendChild(c);
    });
    box.appendChild(cards); return box;
  }
  /* Loan modal: borrow against one offer (op-72 accept, detail acceptBox shape).
   * Borrow-leg asset ALWAYS comes from the offer (never typed). Password is
   * asked only at Sign & Send (shared sendConfirm gate + inline unlock). */
  function openLoanModal(doc, hostBox, myGen, o) {
    if (myGen !== gen) return;
    var locked = !isUnlockedNow();
    var overlay = el(doc, "div", null, "credit-loan-overlay");
    var panel = el(doc, "div", null, "credit-loan-panel");
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", t("credit.accept_borrow", "Accept (borrow)") + " " + o.id);
    overlay.appendChild(panel); hostBox.appendChild(overlay);
    /* A11y 2026-09-30: focus return + trap + listener cleanup. Previously
     * only the Escape path removed onKey (overlay-click/Cancel leaked it)
     * and focus never returned to the invoking row. */
    var returnFocus = null;
    try { returnFocus = doc.activeElement || null; } catch (e) { returnFocus = null; }
    function close() {
      if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      try { doc.removeEventListener("keydown", onKey); } catch (e) { /* once */ }
      try { if (returnFocus && typeof returnFocus.focus === "function") returnFocus.focus(); } catch (e) { /* tab order stands */ }
    }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    function onKey(e) {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      try {
        var f = panel.querySelectorAll("button, input, select, textarea, a[href], [tabindex]");
        var vis = [];
        for (var i = 0; i < f.length; i++) { if (!f[i].disabled && f[i].tabIndex >= 0) vis.push(f[i]); }
        if (!vis.length) return;
        var first = vis[0], last = vis[vis.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      } catch (x) { /* tab order stands */ }
    }
    doc.addEventListener("keydown", onKey);
    panel.appendChild(el(doc, "h2", t("credit.accept_borrow", "Accept (borrow)") + " " + o.id));
    var cur = amt(o.current_raw, o.prec, o.sym, o.asset_id), tot = amt(o.total_raw, o.prec, o.sym, o.asset_id);
    var rt = safeRate(o.rate_units);
    panel.appendChild(confirmList(doc, [[t("credit.offer", "Offer"), o.id], [t("credit.owner", "Owner"), o.owner],
      [t("credit.asset", "Asset"), (o.sym || o.asset_id)],
      [t("credit.current", "Current"), cur.text, "raw " + cur.raw], [t("credit.total", "Total"), tot.text, "raw " + tot.raw],
      [t("credit.fee_rate", "Fee rate"), rt.text + " (denom 1,000,000)", "raw " + rt.raw],
      [t("credit.max_duration", "Max duration"), Credit.durToHuman(o.max_dur_sec)]]));
    if (locked) panel.appendChild(signNotice(doc));
    var fBor = field(doc, t("credit.borrower", "Borrower"), locked
      ? { placeholder: t("credit.blank_wallet_account", "blank = wallet account"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("credit.blank_wallet_account", "blank = wallet account") });
    var fAmt = field(doc, t("credit.accept_borrow_amt_tpl", "Borrow amount (%(sym)s)", { sym: (o.sym || o.asset_id) }), { placeholder: "0.0", inputmode: "decimal" });
    var fCollA = field(doc, t("credit.collateral_asset", "Collateral asset"), { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    var fColl = field(doc, t("credit.collateral_amount", "Collateral amount"), { placeholder: "0.0", inputmode: "decimal" });
    var fRate = field(doc, t("credit.max_fee_rate_2", "Max fee rate %"), { value: safeRateHuman(o.rate_units), inputmode: "decimal" });
    var fDur = field(doc, t("credit.min_duration", "Min duration"), { value: "1 day", placeholder: t("credit.e_g_3_days", "e.g. 3 days") });
    [fBor, fAmt, fCollA, fColl, fRate, fDur].forEach(function (f) { panel.appendChild(f.row); });
    var arRow = el(doc, "div", null, "xfer-field");
    arRow.appendChild(el(doc, "span", t("credit.auto_repay_2", "Auto-repay: ")));
    var arNames = [["", t("credit.omit_chain_default", "omit (chain default)")], ["0", t("credit.0_none", "0 — none")], ["1", t("credit.1_full_only", "1 — full only")], ["2", t("credit.2_partial_ok", "2 — partial ok")]];
    var arInputs = arNames.map(function (n, i) {
      var lab = el(doc, "label", " " + n[1] + " ");
      var r = doc.createElement("input"); r.type = "radio"; r.name = "ar-loan-" + o.id; r.value = n[0];
      if (i === 0) r.checked = true; touchable(r); lab.insertBefore(r, lab.firstChild);
      arRow.appendChild(lab); return r;
    });
    panel.appendChild(arRow);
    reviewSection(doc, panel, myGen, t("credit.review_accept", "Review accept"), {
      build: async function () {
        var bor = fBor.input.value.trim() ? await Account.resolve(fBor.input.value.trim())
          : await Account.resolve(await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }));
        var a = await Asset.describe(o.asset_id);
        var borrowRaw = Format.parseAmount(fAmt.input.value.trim(), a.precision);
        var ca = await Asset.describe(fCollA.input.value.trim());
        var collRaw = Format.parseAmount(fColl.input.value.trim(), ca.precision);
        var arVal = null;
        arInputs.forEach(function (r) { if (r.checked && r.value !== "") arVal = parseInt(r.value, 10); });
        var pair = Credit.buildAccept({ borrowerId: bor.id, offerId: o.id, borrowRaw: borrowRaw,
          borrowAssetId: o.asset_id, collRaw: collRaw, collId: ca.id,
          maxRateHuman: fRate.input.value.trim(), minDurSec: fDur.input.value.trim(), autoRepayOrNull: arVal });
        var quote = Credit.creditFee(borrowRaw, pair[1].max_fee_rate);
        return { pair: pair, fee: await Credit.fee(pair, "1.3.0"), bor: bor, ca: ca, a: a, quote: quote,
          prove: async function () {
            try {
              var rows = await Credit.dealsByOffer(o.id, {});
              return rows.length ? rows[rows.length - 1] : null;
            } catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var arWord = (op.extensions && op.extensions.auto_repay !== undefined)
          ? Credit.autoRepayWord(op.extensions.auto_repay) : "omitted (chain default)";
        return [[t("credit.borrower", "Borrower"), who(R.bor)], [t("credit.offer", "Offer"), o.id],
          [t("credit.borrow", "Borrow"), Format.formatAmount(op.borrow_amount.amount, R.a.precision) + " " + R.a.symbol, "raw " + op.borrow_amount.amount],
          [t("credit.collateral", "Collateral"), Format.formatAmount(op.collateral.amount, R.ca.precision) + " " + R.ca.symbol, "raw " + op.collateral.amount],
          [t("credit.max_fee_rate", "Max fee rate"), Credit.rateUnitsToHuman(op.max_fee_rate) + "%", "raw " + op.max_fee_rate],
          [t("credit.min_duration", "Min duration"), Credit.durToHuman(op.min_duration_seconds)],
          [t("credit.auto_repay", "Auto-repay"), arWord],
          [t("credit.quoted_credit_fee", "Quoted credit fee"), Format.formatAmount(R.quote, R.a.precision) + " " + R.a.symbol, "ceil(amount*rate/1M)"],
          [t("credit.fee", "Fee"), fee.text, "raw " + fee.raw], [t("credit.network", "Network"), "testnet"]];
      },
      title: t("credit.confirm_accept", "Confirm accept"), ok: function () { return t("credit.deal_opened_accept_broadcast", "Deal opened (accept broadcast)."); }, fail: t("credit.could_not_prepare_the_accept", "Could not prepare the accept.") });
    var closeBtn = touchable(el(doc, "button", t("trade.cancel_button", "Cancel"))); closeBtn.type = "button";
    closeBtn.addEventListener("click", close);
    panel.appendChild(closeBtn);
    try { fBor.input.focus(); } catch (e) { /* keyboard path stays via tab order */ }
  }
  /** Route entry: #/credit-offer — filters + offer table + my-offers + create.
   * @param {HTMLElement} root router mount element */
  function renderOffers(root) {
    if (!root) return;
    var ctx = routeReady(root, t("credit.credit_offers", "Credit Offers"), function () { renderOffers(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    var locked0 = !isUnlockedNow();
    if (locked0) ctx.wrap.appendChild(viewingAsNotice(doc));
    ctx.wrap.appendChild(el(doc, "p", t("credit.lend_assets_at_a_fee_rate_a_borrower_accepts", "Lend assets at a fee rate. A borrower accepts an offer and a credit deal appears. Rates are percent at denom 1,000,000 — 0.1% stores 1000 units."), "muted"));
    var fO = field(doc, t("credit.owner", "Owner"), locked0
      ? { placeholder: t("credit.name_or_1_2_n", "name or 1.2.N"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("credit.name_or_1_2_n", "name or 1.2.N") });
    var fA = field(doc, t("credit.asset", "Asset"), { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    ctx.wrap.appendChild(fO.row); ctx.wrap.appendChild(fA.row);
    var go = touchable(el(doc, "button", t("credit.list_offers", "List offers"))); go.type = "button"; ctx.wrap.appendChild(go);
    var listBox = el(doc, "div"); ctx.wrap.appendChild(listBox);
    ctx.wrap.appendChild(el(doc, "h2", t("credit.my_offers", "My offers")));
    var mineBox = el(doc, "div"); ctx.wrap.appendChild(mineBox);
    ctx.wrap.appendChild(el(doc, "h2", t("credit.create_offer", "Create offer")));
    if (locked0) ctx.wrap.appendChild(signNotice(doc));
    createBox(doc, ctx.wrap, myGen);
    /* Open-offers list: auto-loads ALL chain offers (list_credit_offers);
     * the Owner/Asset filter row + List button refine the SAME table
     * (owner-first, then asset, else all). My-offers + create form below stay
     * as they were. Empty/error states never blank (note / retry sentence). */
    function showOpenOffers(rowsPromise) {
      if (myGen !== gen) return; go.disabled = true; clearBox(listBox);
      showStatus(doc, listBox, t("credit.loading_offers", "Loading offers…"));
      Promise.resolve(rowsPromise).then(function (rows) {
        if (myGen !== gen) return; clearBox(listBox);
        listBox.appendChild(el(doc, "h2", t("credit.all_offers", "← All offers")));
        listBox.appendChild(openOffersTable(doc, listBox, myGen, rows));
      }).catch(function (e) {
        if (myGen !== gen) return; clearBox(listBox); showError(doc, listBox, e, t("credit.could_not_load_offers", "Could not load offers."));
      }).then(function () { go.disabled = false; });
    }
    go.addEventListener("click", function () {
      if (myGen !== gen) return;
      var ow = fO.input.value.trim(), av = fA.input.value.trim();
      showOpenOffers(Promise.resolve().then(async function () {
        if (ow) return Credit.offersByOwner(ow, {});
        if (av) return Credit.offersByAsset(av, {});
        return Credit.offers({});
      }));
    });
    Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }).then(function (id) { return Account.resolve(id); }).then(function (me) {
      if (myGen !== gen) return;
      if (!isUnlockedNow()) mineBox.appendChild(viewingAsNotice(doc));
      Credit.offersByOwner(me.id, {}).then(function (rows) {
        if (myGen !== gen) return; clearBox(mineBox);
        mineBox.appendChild(deskTable(doc, [t("credit.offer", "Offer"), t("credit.owner", "Owner"), t("credit.asset", "Asset"), t("credit.current", "Current"), t("credit.total", "Total"), t("credit.fee_rate", "Fee rate"), t("credit.max_duration", "Max duration"), t("credit.enabled", "Enabled"), ""], offerRows(rows), offerCards));
      }).catch(function () { if (myGen === gen) { clearBox(mineBox); mineBox.appendChild(el(doc, "p", t("credit.no_owned_offers", "No owned offers.") + t("credit.owned_hint", " Create one in the Create offer form below — owned offers list here."), "muted")); } });
      showOpenOffers(Credit.offers({}));
    }).catch(function () { if (myGen === gen) showOpenOffers(Credit.offers({})); });
  }
  /* Collateral price-leg inputs (asset + base amt/asset + quote amt/asset); empty rows skipped. */
  function collRow(doc, box) {
    var r = el(doc, "div", null, "xfer-field");
    [t("credit.ph_coll_asset", "coll asset"), t("credit.ph_base_amt", "base amt"), t("credit.ph_base_asset", "base asset"), t("credit.ph_quote_amt", "quote amt"), t("credit.ph_quote_asset", "quote asset")].forEach(function (ph, i) {
      var inp = doc.createElement("input");
      inp.setAttribute("placeholder", ph);
      if (i === 1 || i === 3) inp.setAttribute("inputmode", "decimal");
      touchable(inp); r.appendChild(inp);
    });
    box.appendChild(r); return r;
  }
  function borrowerRow(doc, box) {
    var r = el(doc, "div", null, "xfer-field");
    [t("credit.ph_borrower_account", "borrower account"), t("credit.ph_max_amount", "max amount")].forEach(function (ph, i) {
      var inp = doc.createElement("input"); inp.setAttribute("placeholder", ph);
      if (i === 1) inp.setAttribute("inputmode", "decimal");
      touchable(inp); r.appendChild(inp);
    });
    box.appendChild(r); return r;
  }
  async function readCollateral(box) {
    var out = [];
    var divs = box.querySelectorAll("div.xfer-field");
    for (var i = 0; i < divs.length; i++) {
      var inps = divs[i].querySelectorAll("input");
      if (inps.length < 5 || !inps[0].value.trim()) continue;
      var ba = await Asset.describe(inps[2].value.trim()), qa = await Asset.describe(inps[4].value.trim());
      var col = await Asset.describe(inps[0].value.trim());
      out.push({ assetId: col.id, price: {
        base: { amount: Format.parseAmount(inps[1].value.trim(), ba.precision), asset_id: ba.id },
        quote: { amount: Format.parseAmount(inps[3].value.trim(), qa.precision), asset_id: qa.id } } });
    }
    return out;
  }
  /* Op-69 create form: human balance/rate/duration/min-deal + collateral/borrower rows. */
  function createBox(doc, box, myGen) {
    var lockedC = !isUnlockedNow();
    var fAcct = field(doc, t("credit.owner_account", "Owner account"), lockedC
      ? { placeholder: t("credit.blank_wallet_account", "blank = wallet account"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("credit.blank_wallet_account", "blank = wallet account") });
    var fAsset = field(doc, t("credit.asset", "Asset"), { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    var fBal = field(doc, t("credit.balance", "Balance"), { placeholder: "0.0", inputmode: "decimal" });
    var fRate = field(doc, t("credit.fee_rate_2", "Fee rate %"), { placeholder: "0.1", inputmode: "decimal" });
    var fMin = field(doc, t("credit.min_deal_amount", "Min deal amount"), { placeholder: "0.0", inputmode: "decimal" });
    var fAuto = field(doc, t("credit.auto_disable_date", "Auto-disable (date)"), { type: "datetime-local" });
    [fAcct, fAsset, fBal, fRate, fMin, fAuto].forEach(function (f) { box.appendChild(f.row); });
    var durSel = doc.createElement("select"); touchable(durSel);
    [["86400", t("credit.1_day", "1 day")], ["259200", t("credit.3_days", "3 days")], ["604800", t("credit.1_week", "1 week")], ["2592000", t("credit.30_days", "30 days")], ["", t("credit.custom", "custom…")]].forEach(function (o) {
      var op = doc.createElement("option"); op.value = o[0]; op.textContent = o[1]; durSel.appendChild(op); });
    var durRow = el(doc, "div", null, "xfer-field"), durLab = el(doc, "label", t("credit.max_duration_2", "Max duration "));
    var fDurCustom = doc.createElement("input"); fDurCustom.setAttribute("placeholder", t("credit.e_g_3_days", "e.g. 3 days"));
    touchable(fDurCustom); durLab.appendChild(durSel); durLab.appendChild(fDurCustom); durRow.appendChild(durLab);
    box.appendChild(durRow);
    var enLab = doc.createElement("input"); enLab.type = "checkbox"; enLab.checked = true; touchable(enLab);
    var enRow = el(doc, "div", null, "xfer-field"), enL = el(doc, "label", t("credit.enabled_3", "Enabled "));
    enL.appendChild(enLab); enRow.appendChild(enL); box.appendChild(enRow);
    box.appendChild(el(doc, "h3", t("credit.acceptable_collateral_asset_price_legs", "Acceptable collateral (asset + price legs)")));
    var collBox = el(doc, "div"); box.appendChild(collBox); collRow(doc, collBox);
    var addC = touchable(el(doc, "button", t("credit.add_collateral_row", "Add collateral row"))); addC.type = "button"; box.appendChild(addC);
    addC.addEventListener("click", function () { collRow(doc, collBox); });
    box.appendChild(el(doc, "h3", t("credit.acceptable_borrowers_account_max", "Acceptable borrowers (account + max)")));
    var borBox = el(doc, "div"); box.appendChild(borBox); borrowerRow(doc, borBox);
    var addB = touchable(el(doc, "button", t("credit.add_borrower_row", "Add borrower row"))); addB.type = "button"; box.appendChild(addB);
    addB.addEventListener("click", function () { borrowerRow(doc, borBox); });
    reviewSection(doc, box, myGen, t("credit.review_create", "Review create"), {
      build: async function () {
        var me = fAcct.input.value.trim() ? await Account.resolve(fAcct.input.value.trim())
          : await Account.resolve(await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }));
        var a = await Asset.describe(fAsset.input.value.trim());
        var balRaw = Format.parseAmount(fBal.input.value.trim(), a.precision);
        var minRaw = Format.parseAmount(fMin.input.value.trim(), a.precision);
        var durSec = durSel.value ? Credit.durToSeconds(durSel.value) : Credit.durToSeconds(fDurCustom.value.trim());
        if (!fAuto.input.value) throw new Error(t("credit.auto_disable_time_must_be_set_validity", "auto-disable time must be set (validity)."));
        var autoIso = new Date(fAuto.input.value).toISOString().slice(0, 19);
        if (!(new Date(autoIso).getTime() > Date.now())) throw new Error(t("credit.auto_disable_time_must_be_in_the_future", "auto-disable time must be in the future."));
        var coll = await readCollateral(collBox);
        var borDivs = borBox.querySelectorAll("div.xfer-field"), bor = [];
        for (var i = 0; i < borDivs.length; i++) {
          var inps = borDivs[i].querySelectorAll("input");
          if (!inps[0].value.trim()) continue;
          var acct = await Account.resolve(inps[0].value.trim());
          bor.push({ accountId: acct.id, maxRaw: Format.parseAmount(inps[1].value.trim(), a.precision) });
        }
        var pair = Credit.buildOfferCreate({ accountId: me.id, assetId: a.id, balanceRaw: balRaw,
          rateHuman: fRate.input.value.trim(), maxDurSec: durSec, minDealRaw: minRaw,
          enabled: enLab.checked, autoDisableIso: autoIso, collateral: coll, borrowers: bor });
        return { pair: pair, fee: await Credit.fee(pair, "1.3.0"), me: me, a: a,
          prove: async function () {
            try {
              var rows = await Credit.offersByOwner(me.id, {});
              for (var k = 0; k < rows.length; k++)
                if (rows[k].asset_id === a.id && rows[k].total_raw === balRaw) return rows[k];
            } catch (e) { return null; } return null; } };
      },
      rows: function (R, fee) {
        var op = R.pair[1], out = [[t("credit.owner", "Owner"), who(R.me)], [t("credit.asset", "Asset"), R.a.symbol + " (" + R.a.id + ")"],
          [t("credit.balance", "Balance"), Format.formatAmount(op.balance, R.a.precision) + " " + R.a.symbol, "raw " + op.balance],
          [t("credit.fee_rate", "Fee rate"), Credit.rateUnitsToHuman(op.fee_rate) + "% (denom 1,000,000)", "raw " + op.fee_rate],
          [t("credit.max_duration", "Max duration"), Credit.durToHuman(op.max_duration_seconds)],
          [t("credit.min_deal", "Min deal"), Format.formatAmount(op.min_deal_amount, R.a.precision) + " " + R.a.symbol, "raw " + op.min_deal_amount],
          [t("credit.enabled", "Enabled"), op.enabled ? t("credit.yes", "yes") : t("credit.no", "no")], [t("credit.auto_disable", "Auto-disable"), op.auto_disable_time],
          [t("credit.collateral_legs", "Collateral legs"), String(op.acceptable_collateral.length)], [t("credit.borrowers", "Borrowers"), String(op.acceptable_borrowers.length)],
          [t("credit.fee", "Fee"), fee.text, "raw " + fee.raw], [t("credit.network", "Network"), "testnet"]];
        return out;
      },
      title: t("credit.confirm_offer_create", "Confirm offer create"), ok: function () { return t("credit.offer_created", "Offer created."); }, fail: t("credit.could_not_prepare_the_create", "Could not prepare the create.") });
  }

  return { renderOffers: renderOffers,
    _ui: { el: el, touchable: touchable, clearBox: clearBox, showError: showError, showStatus: showStatus,
      confirmList: confirmList, field: field, tableHead: tableHead, deskTable: deskTable,
      feeText: feeText, headBlock: headBlock, amt: amt, rateText: rateText, who: who,
      sendConfirm: sendConfirm, reviewPaid: reviewPaid, reviewSection: reviewSection,
      routeReady: routeReady,
      isUnlockedNow: isUnlockedNow, viewingAsNotice: viewingAsNotice, signNotice: signNotice,
      unlockInline: unlockInline, viewingAsId: VIEWING_AS_ID,
      live: function (g) { return g === gen; } } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.CreditUI === "undefined") { globalThis.CreditUI = CreditUI; }
if (typeof module !== "undefined") { module.exports = CreditUI; }
