/* credit-detail-ui.js — #/credit-offer/:id desk (split OUT of credit-ui.js on the cap).
 * Owns: offer detail (named fields human + collateral/borrower tables) + op-72
 *   accept form (borrow leg asset ALWAYS from Credit.offer(asset_id) — never
 *   typed) + deals-by-offer table + op-73 repay / op-76 auto-repay forms +
 *   owner-only op-71 update (changed fields only in confirm) + op-70 delete
 *   (fee-0 explicit). Unknown id -> empty state, never blank. No money math
 *   (Credit builders + Format do it); no serializers (tx.js owns bytes).
 * Consumes: CreditUI._ui (route gate, confirm+publish flow, tables, human
 *   formatters), Credit (offer/deal/dealsByOffer reads, builders, rate/duration
 *   helpers, fee/sendAndProve), Tx.buildTx, Format, Account, Asset.describe.
 *   Own gen + two-counter live() (pool-detail-ui.js / debit-ui precedent):
 *   async work must be live on BOTH this file's gen and CreditUI's uiGen.
  * Created by: building-vanilla-slices skill, slice-13-credit plan Task 3.
  * PUBLIC-FIRST (gate repair): the shared CreditUI routeReady no longer gates
  *   on unlock — the detail/accept/deals render locked (borrower inputs default
  *   to committee-account 1.2.0 with a viewing notice). Password is asked only
  *   at Sign & Send (shared sendConfirm sign-time gate).
 * CHAIN TRUTH (#4 wins): accept spawns the deal (NO deal_create op); op-73
 *   repay_amount + credit_fee BOTH explicit; op-76 wire field is `account`
 *   (NOT borrower — #3's committee-account trap); fee_rate denom 1M.
 */
var CreditDetailUI = (function () {
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
  /* Shared-_ui accessor: CreditUI._ui (credit-ui.js loads first); throws credit-ui-missing otherwise. */
  function U() {
    if (typeof CreditUI === "undefined" || !CreditUI._ui) throw new Error(t("credit.credit_ui_missing_credit_ui_js_first", "credit-ui-missing (credit-ui.js first)"));
    return CreditUI._ui;
  }
  /* Two-counter liveness: own gen (this route) + CreditUI uiGen (shared gate). */
  function live(myGen, uiGen) {
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  /* cleanId: the router strips ? but NOT a second-# fragment before matching,
   * so params.id can arrive as "1.21.5#update" — strip fragment + query so the
   * object read sees a bare id. Never throws (non-strings yield "").
   * @param {any} id route param (maybe fragment-suffixed)
   * @returns {string} bare object id */
  function cleanId(id) {
    try { return String(id || "").split("#")[0].split("?")[0]; }
    catch (e) { return ""; }
  }
  /* pendingFrag: "#/credit-offer/<id>#update|#delete" fragment (router keeps
   * the second-# suffix inside :id, so the view reads location.hash itself —
   * asset-ui.js hashSubParent precedent). Returns "update"/"delete"/null.
   * Never throws (node smoke tests have no location).
   * @returns {string|null} requested owner form, if any */
  function pendingFrag() {
    try {
      var h = (typeof location !== "undefined" && location.hash) || "";
      var parts = String(h).split("#");
      if (parts.length < 3) return null;
      var f = parts[parts.length - 1].split("?")[0].trim().toLowerCase();
      if (f === "update" || f === "delete") return f;
      return null;
    } catch (e) { return null; }
  }
  /* Route entry: #/credit-offer/:id — detail + accept + deals + owner forms. */
  function renderOfferDetail(root, id) {
    if (!root) return;
    id = cleanId(id);
    var ui;
    try { ui = U(); } catch (e) {
      root.innerHTML = "";
      var d0 = root.ownerDocument || document, w0 = d0.createElement("div");
      w0.className = "wrap"; root.appendChild(w0);
      w0.appendChild(d0.createTextNode(t("credit.credit_detail_backend_missing_credit_ui_js_fa", "Credit detail backend missing: credit-ui.js failed to load.")));
      return;
    }
    var ctx = ui.routeReady(root, t("credit.credit_offer", "Credit Offer"), function () { renderOfferDetail(root, id); });
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    var lockedD = false;
    try { lockedD = !ui.isUnlockedNow(); } catch (e) { lockedD = false; }
    ui.showStatus(doc, ctx.wrap, "Loading offer " + id + "…");
    if (lockedD) ctx.wrap.appendChild(ui.viewingAsNotice(doc));
    Promise.resolve().then(async function () {
      var o = await Credit.offer(String(id));
      var a = await Asset.describe(o.asset_id);
      var me = null;
      try { me = await Account.resolve(await Account.myAccountId()); } catch (e) { me = null; }
      /* Owner + collateral/borrower legs render as names/symbols (raw ids in
       * title) — the list join in Credit._offerRows covers tables; the
       * single-read detail resolves here with honest-id fallbacks. */
      var ownerName = o.owner;
      try { ownerName = (await Account.resolve(o.owner)).name; } catch (e) { ownerName = o.owner; }
      var collSyms = [];
      try {
        collSyms = await Promise.all((o.collateral_raw || []).map(async function (c) {
          var cid = c && c[0];
          try { return (await Asset.describe(String(cid))).symbol; } catch (e) { return String(cid); }
        }));
      } catch (e) { collSyms = []; }
      var borNames = [];
      try {
        borNames = await Promise.all((o.borrowers_raw || []).map(async function (b) {
          var bid = b && b[0];
          try { return (await Account.resolve(String(bid))).name; } catch (e) { return String(bid); }
        }));
      } catch (e) { borNames = []; }
      return { o: o, a: a, me: me, ownerName: ownerName, collSyms: collSyms, borNames: borNames };
    }).then(function (R) {
      if (!live(myGen, uiGen)) return;
      ui.clearBox(ctx.wrap);
      var o = R.o, a = R.a;
      ctx.wrap.appendChild(DOM.pageHead(doc, "Offer " + o.id, "merchant"));
      if (lockedD) ctx.wrap.appendChild(ui.viewingAsNotice(doc));
      var back = ui.el(doc, "a", t("credit.all_offers", "← All offers")); back.setAttribute("href", "#/credit-offer");
      ctx.wrap.appendChild(back);
      var cur = ui.amt(o.current_raw, a.precision, a.symbol, o.asset_id);
      var tot = ui.amt(o.total_raw, a.precision, a.symbol, o.asset_id);
      var rt = ui.rateText(o.rate_units);
      ctx.wrap.appendChild(ui.confirmList(doc, [[t("credit.offer", "Offer"), o.id], [t("credit.owner", "Owner"), R.ownerName, "raw " + o.owner],
        [t("credit.asset", "Asset"), a.symbol + " (" + o.asset_id + ")"],
        [t("credit.current_balance", "Current balance"), cur.text, "raw " + cur.raw], [t("credit.total_balance", "Total balance"), tot.text, "raw " + tot.raw],
        [t("credit.fee_rate", "Fee rate"), rt.text + " (denom 1,000,000)", "raw " + rt.raw],
        [t("credit.max_duration", "Max duration"), Credit.durToHuman(o.max_dur_sec)], [t("credit.enabled", "Enabled"), o.enabled ? t("credit.yes", "yes") : t("credit.no", "no")],
        [t("credit.auto_disable", "Auto-disable"), o.auto_disable_time || "—"]]));
      ctx.wrap.appendChild(ui.el(doc, "h2", t("credit.acceptable_collateral", "Acceptable collateral")));
      ctx.wrap.appendChild(ui.el(doc, "p", (o.collateral_raw.length ? (R.collSyms.length ? R.collSyms : o.collateral_raw.map(function (c) { return c[0]; })).join(", ") : "Any collateral accepted."), "muted"));
      ctx.wrap.appendChild(ui.el(doc, "h2", t("credit.acceptable_borrowers", "Acceptable borrowers")));
      ctx.wrap.appendChild(ui.el(doc, "p", (o.borrowers_raw.length ? (R.borNames.length ? R.borNames : o.borrowers_raw.map(function (b) { return b[0]; })).join(", ") : "Any borrower accepted."), "muted"));
      ctx.wrap.appendChild(ui.el(doc, "h2", t("credit.accept_borrow", "Accept (borrow)")));
      if (lockedD) ctx.wrap.appendChild(ui.signNotice(doc));
      acceptBox(doc, ctx.wrap, uiGen, o, a);
      ctx.wrap.appendChild(ui.el(doc, "h2", t("credit.deals_on_this_offer", "Deals on this offer")));
      var dealsBox = ui.el(doc, "div"); ctx.wrap.appendChild(dealsBox);
      dealTables(doc, dealsBox, myGen, uiGen, o, a);
      if (R.me && R.me.id === o.owner) {
        ctx.wrap.appendChild(ui.el(doc, "h2", t("credit.owner_update_delete", "Owner: update / delete")));
        /* Owner forms mount in anchors so #update/#delete deep links from the
         * desk have a scroll target. Confirm+fee logic inside updateBox /
         * deleteBox is untouched — honoring the fragment scrolls + focuses
         * only (no auto-Review: destructive actions still need an explicit
         * click + confirm). Non-owners never reach here (forms hidden). */
        var frag = pendingFrag();
        var updAnchor = ui.el(doc, "div"); ctx.wrap.appendChild(updAnchor);
        updateBox(doc, updAnchor, uiGen, o, a, R.me);
        var delAnchor = ui.el(doc, "div"); ctx.wrap.appendChild(delAnchor);
        deleteBox(doc, delAnchor, uiGen, o, R.me);
        try {
          var target = (frag === "delete") ? delAnchor : (frag === "update" ? updAnchor : null);
          if (target && live(myGen, uiGen)) {
            if (target.scrollIntoView) target.scrollIntoView();
            var ctl = (typeof target.querySelector === "function") ? target.querySelector("input, select, button") : null;
            if (ctl && typeof ctl.focus === "function") ctl.focus();
          }
        } catch (e) { /* paint stands */ }
      }
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return; ui.clearBox(ctx.wrap);
      ctx.wrap.appendChild(DOM.pageHead(doc, "Offer " + String(id), "merchant"));
      ui.showError(doc, ctx.wrap, e, t("credit.unknown_offer", "Unknown offer."));
      var back = ui.el(doc, "a", t("credit.all_offers", "← All offers")); back.setAttribute("href", "#/credit-offer");
      ctx.wrap.appendChild(back);
    });
  }
  /* Route entry: #/deal/:id — one credit deal (1.22.x) with its repay /
   * auto-repay forms preselected. Resolves the deal for its offer id, then
   * renders the deal summary plus the shared dealTables (repay + auto-repay
   * reviewSections) with the select preselected to this deal; the select
   * stays as the ephemeral fallback for sibling deals. Never auto-Reviews:
   * repay spends money, so it still needs an explicit click + confirm
   * (pendingFrag precedent above). Unknown id -> empty state with the
   * all-offers way out, never blank. No money math (ui.amt + Format do
   * it); no serializers.
   * @param {HTMLElement} root router mount element
   * @param {string} dealId deal object id (1.22.x) */
  function renderDealDetail(root, dealId) {
    if (!root) return;
    dealId = cleanId(dealId);
    var ui;
    try { ui = U(); } catch (e) {
      root.innerHTML = "";
      var d0 = root.ownerDocument || document, w0 = d0.createElement("div");
      w0.className = "wrap"; root.appendChild(w0);
      w0.appendChild(d0.createTextNode(t("credit.credit_detail_backend_missing_credit_ui_js_fa", "Credit detail backend missing: credit-ui.js failed to load.")));
      return;
    }
    var ctx = ui.routeReady(root, t("credit.deal", "Deal"), function () { renderDealDetail(root, dealId); });
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    var lockedD = false;
    try { lockedD = !ui.isUnlockedNow(); } catch (e) { lockedD = false; }
    ui.showStatus(doc, ctx.wrap, "Loading deal " + dealId + "…");
    if (lockedD) ctx.wrap.appendChild(ui.viewingAsNotice(doc));
    Promise.resolve().then(async function () {
      var d = await Credit.deal(String(dealId));
      var o = await Credit.offer(d.offer_id);
      var a = await Asset.describe(o.asset_id);
      /* Debt/collateral legs render as symbols (raw ids in title — the
       * offer-detail join precedent); misses degrade to bare ids. */
      var debtA = null, collA = null, borName = d.borrower;
      try { debtA = await Asset.describe(d.debt_id); } catch (e) { debtA = null; }
      try { collA = await Asset.describe(d.coll_id); } catch (e) { collA = null; }
      try { borName = (await Account.resolve(d.borrower)).name; } catch (e) { borName = d.borrower; }
      return { d: d, o: o, a: a, debtA: debtA, collA: collA, borName: borName };
    }).then(function (R) {
      if (!live(myGen, uiGen)) return;
      ui.clearBox(ctx.wrap);
      var d = R.d, o = R.o, a = R.a;
      ctx.wrap.appendChild(DOM.pageHead(doc, "Deal " + d.id, "merchant"));
      if (lockedD) ctx.wrap.appendChild(ui.viewingAsNotice(doc));
      var backO = ui.el(doc, "a", "← " + t("credit.offer", "Offer") + " " + o.id);
      backO.setAttribute("href", "#/credit-offer/" + o.id);
      ctx.wrap.appendChild(backO);
      ctx.wrap.appendChild(doc.createTextNode(" · "));
      var backAll = ui.el(doc, "a", t("credit.all_offers", "← All offers"));
      backAll.setAttribute("href", "#/credit-offer");
      ctx.wrap.appendChild(backAll);
      var debt = ui.amt(d.debt_raw, R.debtA ? R.debtA.precision : null, R.debtA ? R.debtA.symbol : d.debt_id, d.debt_id);
      var coll = ui.amt(d.coll_raw, R.collA ? R.collA.precision : null, R.collA ? R.collA.symbol : d.coll_id, d.coll_id);
      var arWord = (d.auto_repay === null || d.auto_repay === undefined) ? "—" : Credit.autoRepayWord(d.auto_repay);
      ctx.wrap.appendChild(ui.confirmList(doc, [[t("credit.deal", "Deal"), d.id], [t("credit.offer", "Offer"), o.id],
        [t("credit.borrower", "Borrower"), R.borName, "raw " + d.borrower],
        [t("credit.debt", "Debt"), debt.text, "raw " + debt.raw],
        [t("credit.collateral", "Collateral"), coll.text, "raw " + coll.raw],
        [t("credit.rate", "Rate"), Credit.rateUnitsToHuman(d.rate_units) + "%", "raw " + String(d.rate_units)],
        [t("credit.auto_repay", "Auto-repay"), arWord]]));
      ctx.wrap.appendChild(ui.el(doc, "h2", t("credit.repay", "Repay") + " / " + t("credit.auto_repay", "Auto-repay")));
      if (lockedD) ctx.wrap.appendChild(ui.signNotice(doc));
      var dealsBox = ui.el(doc, "div"); ctx.wrap.appendChild(dealsBox);
      dealTables(doc, dealsBox, myGen, uiGen, o, a, d.id);
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return; ui.clearBox(ctx.wrap);
      ctx.wrap.appendChild(DOM.pageHead(doc, "Deal " + String(dealId), "merchant"));
      ui.showError(doc, ctx.wrap, e, t("credit.unknown_credit_deal", "Unknown credit deal."));
      var back = ui.el(doc, "a", t("credit.all_offers", "← All offers")); back.setAttribute("href", "#/credit-offer");
      ctx.wrap.appendChild(back);
    });
  }
  /* Op-72 accept: borrow leg asset comes from the offer (never typed). */
  function acceptBox(doc, box, uiGen, o, a) {
    var ui = U(), lockedA = false;
    try { lockedA = !ui.isUnlockedNow(); } catch (e) { lockedA = false; }
    var fBor = ui.field(doc, t("credit.borrower", "Borrower"), lockedA
      ? { placeholder: t("credit.blank_wallet_account", "blank = wallet account"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" }
      : { placeholder: t("credit.blank_wallet_account", "blank = wallet account") });
    var fAmt = ui.field(doc, t("credit.accept_borrow_amt_tpl", "Borrow amount (%(sym)s)", { sym: a.symbol }), { placeholder: "0.0", inputmode: "decimal" });
    var fCollA = ui.field(doc, t("credit.collateral_asset", "Collateral asset"), { placeholder: t("common.symbol_or_id_hint", "symbol or 1.3.x") });
    var fColl = ui.field(doc, t("credit.collateral_amount", "Collateral amount"), { placeholder: "0.0", inputmode: "decimal" });
    var fRate = ui.field(doc, t("credit.max_fee_rate_2", "Max fee rate %"), { value: Credit.rateUnitsToHuman(o.rate_units), inputmode: "decimal" });
    var fDur = ui.field(doc, t("credit.min_duration", "Min duration"), { value: "1 day", placeholder: t("credit.e_g_3_days", "e.g. 3 days") });
    [fBor, fAmt, fCollA, fColl, fRate, fDur].forEach(function (f) { box.appendChild(f.row); });
    /* Component-wisdom Rec 2: non-blocking registry pre-checks. The review
     * build still resolves both via Account.resolve/Asset.describe at
     * submit; these blur hints only surface typos early. */
    (function () {
      function inlineErr(field) {
        var err = doc.createElement("div");
        err.className = "error"; err.setAttribute("aria-live", "polite"); err.style.display = "none";
        field.row.appendChild(err);
        return err;
      }
      var borErr = inlineErr(fBor), collErr = inlineErr(fCollA);
      fBor.input.addEventListener("blur", function () {
        var v = fBor.input.value.trim();
        if (!v) { borErr.style.display = "none"; borErr.textContent = ""; return; }
        if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") return;
        Account.resolve(v).then(function () {
          if (typeof document === "undefined" || document.activeElement !== fBor.input) { borErr.style.display = "none"; borErr.textContent = ""; }
        }).catch(function () {
          borErr.textContent = t("common.unknown_account", "Unknown account."); borErr.style.display = "";
        });
      });
      fCollA.input.addEventListener("blur", function () {
        var v = fCollA.input.value.trim();
        if (!v) { collErr.style.display = "none"; collErr.textContent = ""; return; }
        if (typeof Asset === "undefined" || !Asset || typeof Asset.describe !== "function") return;
        Asset.describe(v).then(function () {
          if (typeof document === "undefined" || document.activeElement !== fCollA.input) { collErr.style.display = "none"; collErr.textContent = ""; }
        }).catch(function () {
          collErr.textContent = t("common.unknown_asset", "Unknown asset."); collErr.style.display = "";
        });
      });
    })();
    var arRow = ui.el(doc, "div", null, "xfer-field");
    arRow.appendChild(ui.el(doc, "span", t("credit.auto_repay_2", "Auto-repay: ")));
    var arNames = [["", t("credit.omit_chain_default", "omit (chain default)")], ["0", t("credit.0_none", "0 — none")], ["1", t("credit.1_full_only", "1 — full only")], ["2", t("credit.2_partial_ok", "2 — partial ok")]];
    var arInputs = arNames.map(function (n, i) {
      var lab = ui.el(doc, "label", " " + n[1] + " ");
      var r = doc.createElement("input"); r.type = "radio"; r.name = "ar-" + o.id; r.value = n[0];
      if (i === 0) r.checked = true; ui.touchable(r); lab.insertBefore(r, lab.firstChild);
      arRow.appendChild(lab); return r;
    });
    box.appendChild(arRow);
    ui.reviewSection(doc, box, uiGen, t("credit.review_accept", "Review accept"), {
      build: async function () {
        var bor = fBor.input.value.trim() ? await Account.resolve(fBor.input.value.trim())
          : await Account.resolve(await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }));
        var borrowRaw = Format.parseAmount(fAmt.input.value.trim(), a.precision);
        var ca = await Asset.describe(fCollA.input.value.trim());
        var collRaw = Format.parseAmount(fColl.input.value.trim(), ca.precision);
        var arVal = null;
        arInputs.forEach(function (r) { if (r.checked && r.value !== "") arVal = parseInt(r.value, 10); });
        var pair = Credit.buildAccept({ borrowerId: bor.id, offerId: o.id, borrowRaw: borrowRaw,
          borrowAssetId: o.asset_id, collRaw: collRaw, collId: ca.id,
          maxRateHuman: fRate.input.value.trim(), minDurSec: fDur.input.value.trim(), autoRepayOrNull: arVal });
        var quote = Credit.creditFee(borrowRaw, pair[1].max_fee_rate);
        return { pair: pair, fee: await Credit.fee(pair, "1.3.0"), bor: bor, ca: ca, quote: quote,
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
        return [[t("credit.borrower", "Borrower"), ui.who(R.bor)], [t("credit.offer", "Offer"), o.id],
          [t("credit.borrow", "Borrow"), Format.formatAmount(op.borrow_amount.amount, a.precision) + " " + a.symbol, "raw " + op.borrow_amount.amount],
          [t("credit.collateral", "Collateral"), Format.formatAmount(op.collateral.amount, R.ca.precision) + " " + R.ca.symbol, "raw " + op.collateral.amount],
          [t("credit.max_fee_rate", "Max fee rate"), Credit.rateUnitsToHuman(op.max_fee_rate) + "%", "raw " + op.max_fee_rate],
          [t("credit.min_duration", "Min duration"), Credit.durToHuman(op.min_duration_seconds)],
          [t("credit.auto_repay", "Auto-repay"), arWord],
          [t("credit.quoted_credit_fee", "Quoted credit fee"), Format.formatAmount(R.quote, a.precision) + " " + a.symbol, "ceil(amount*rate/1M)"],
          [t("credit.fee", "Fee"), fee.text, "raw " + fee.raw], [t("credit.network", "Network"), "testnet"]];
      },
      title: t("credit.confirm_accept", "Confirm accept"), ok: function () { return t("credit.deal_opened_accept_broadcast", "Deal opened (accept broadcast)."); }, fail: t("credit.could_not_prepare_the_accept", "Could not prepare the accept.") });
  }
  /* Deals-by-offer table + repay / auto-repay forms for a picked deal.
   * preselectId (optional 1.22.x): preselects the deal select (per-deal
   * route below) — the select stays as the ephemeral fallback, switching
   * it just repoints the repay forms below. Never auto-Reviews: repay
   * spends money, so it still needs an explicit click + confirm.
   * @param {string} [preselectId] deal id to preselect, if listed. */
  function dealTables(doc, box, myGen, uiGen, o, a, preselectId) {
    var ui = U();
    ui.showStatus(doc, box, t("credit.loading_deals", "Loading deals…"));
    Credit.dealsByOffer(o.id, {}).then(function (deals) {
      if (!live(myGen, uiGen)) return; ui.clearBox(box);
      var rows = deals.map(function (d) {
        var debt = ui.amt(d.debt_raw, d.debt_prec, d.debt_sym, d.debt_id);
        var coll = ui.amt(d.coll_raw, d.coll_prec, d.coll_sym, d.coll_id);
        return { d: d, href: "#/deal/" + d.id, cells: [{ text: d.id }, { text: (d.borrower_name || d.borrower), raw: d.borrower }, { text: debt.text, raw: debt.raw },
          { text: coll.text, raw: coll.raw },
          { text: Credit.rateUnitsToHuman(d.rate_units) + "%", raw: String(d.rate_units) },
          { text: (d.auto_repay === null || d.auto_repay === undefined) ? "—" : Credit.autoRepayWord(d.auto_repay) }] };
      });
      box.appendChild(ui.deskTable(doc, [t("credit.deal", "Deal"), t("credit.borrower", "Borrower"), t("credit.debt", "Debt"), t("credit.collateral", "Collateral"), t("credit.rate", "Rate"), t("credit.auto_repay", "Auto-repay"), ""], rows,
        function (r) { return [r.d.id + " · borrower " + (r.d.borrower_name || r.d.borrower), "Debt " + r.cells[2].text, "Collateral " + r.cells[3].text, "Rate " + r.cells[4].text]; }));
      if (!deals.length) { box.appendChild(ui.el(doc, "p", t("credit.no_deals_on_this_offer_yet", "No deals on this offer yet.") + t("credit.deals_hint", " Deals appear after someone borrows against this offer."), "muted")); return; }
      var sel = doc.createElement("select"); ui.touchable(sel);
      deals.forEach(function (d) {
        var op = doc.createElement("option"); op.value = d.id; op.textContent = d.id; sel.appendChild(op); });
      /* Preselected deal (per-deal route): point the select at it when
       * listed; otherwise the first deal stands. */
      if (preselectId) {
        var listed = false;
        deals.forEach(function (d) { if (d.id === preselectId) listed = true; });
        if (listed) { try { sel.value = preselectId; } catch (e) { /* first stands */ } }
      }
      /* Forms seam (Task 2.2): single-select row — div.xfer-field > label > select. */
      var selRow = Forms.fieldRow(doc, t("credit.deal_2", "Deal "), sel);
      box.appendChild(selRow);
      var fRepay = ui.field(doc, t("credit.repay_amount", "Repay amount"), { placeholder: "0.0", inputmode: "decimal" });
      box.appendChild(fRepay.row);
      ui.reviewSection(doc, box, uiGen, t("credit.review_repay", "Review repay"), {
        build: async function () {
          var deal = null;
          deals.forEach(function (d) { if (d.id === sel.value) deal = d; });
          if (!deal) throw new Error("unknown-deal");
          var me = await Account.resolve(await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }));
          var prec = (deal.debt_prec === null || deal.debt_prec === undefined) ? a.precision : deal.debt_prec;
          var repayRaw = Format.parseAmount(fRepay.input.value.trim(), prec);
          var feeRaw = Credit.creditFee(repayRaw, deal.rate_units);
          var pair = Credit.buildDealRepay({ accountId: me.id, dealId: deal.id,
            repayRaw: repayRaw, feeRaw: feeRaw, assetId: deal.debt_id });
          return { pair: pair, fee: await Credit.fee(pair, "1.3.0"), me: me, deal: deal, prec: prec,
            prove: async function () {
              try { return await Credit.deal(deal.id); } catch (e) { return null; } } };
        },
        rows: function (R, fee) {
          var op = R.pair[1];
          return [[t("credit.account", "Account"), ui.who(R.me)], [t("credit.deal", "Deal"), R.deal.id],
            [t("credit.repay", "Repay"), Format.formatAmount(op.repay_amount.amount, R.prec), "raw " + op.repay_amount.amount],
            [t("credit.credit_fee", "Credit fee"), Format.formatAmount(op.credit_fee.amount, R.prec), "ceil(amount*rate/1M), raw " + op.credit_fee.amount],
            [t("credit.fee", "Fee"), fee.text, "raw " + fee.raw], [t("credit.network", "Network"), "testnet"]];
        },
        title: t("credit.confirm_deal_repay", "Confirm deal repay"), ok: function () { return t("credit.repay_broadcast", "Repay broadcast."); }, fail: t("credit.could_not_prepare_the_repay", "Could not prepare the repay.") });
      var arRow = ui.el(doc, "div", null, "xfer-field");
      arRow.appendChild(ui.el(doc, "span", t("credit.new_auto_repay", "New auto-repay: ")));
      var arInputs = [0, 1, 2].map(function (n, i) {
        var lab = ui.el(doc, "label", " " + n + " ");
        var r = doc.createElement("input"); r.type = "radio"; r.name = "dar-" + o.id; r.value = String(n);
        if (i === 0) r.checked = true; ui.touchable(r); lab.insertBefore(r, lab.firstChild);
        arRow.appendChild(lab); return r;
      });
      box.appendChild(arRow);
      ui.reviewSection(doc, box, uiGen, t("credit.review_auto_repay_change", "Review auto-repay change"), {
        build: async function () {
          var deal = null;
          deals.forEach(function (d) { if (d.id === sel.value) deal = d; });
          if (!deal) throw new Error("unknown-deal");
          var me = await Account.resolve(await Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; }));
          var n = 0; arInputs.forEach(function (r) { if (r.checked) n = parseInt(r.value, 10); });
          var pair = Credit.buildDealUpdate({ accountId: me.id, dealId: deal.id, autoRepay: n });
          return { pair: pair, fee: await Credit.fee(pair, "1.3.0"), me: me, deal: deal, n: n,
            prove: async function () {
              try { var d = await Credit.deal(deal.id); return (d.auto_repay === n) ? d : null; }
              catch (e) { return null; } } };
        },
        rows: function (R, fee) {
          var oldW = (R.deal.auto_repay === null || R.deal.auto_repay === undefined) ? "—" : Credit.autoRepayWord(R.deal.auto_repay);
          return [[t("credit.account", "Account"), ui.who(R.me)], [t("credit.deal", "Deal"), R.deal.id],
            [t("credit.auto_repay", "Auto-repay"), oldW + " → " + Credit.autoRepayWord(R.n)],
            [t("credit.fee", "Fee"), fee.text, "raw " + fee.raw], [t("credit.network", "Network"), "testnet"]];
        },
        title: t("credit.confirm_deal_update", "Confirm deal update"), ok: function () { return t("credit.deal_updated", "Deal updated."); }, fail: t("credit.could_not_prepare_the_update", "Could not prepare the update.") });
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return; ui.clearBox(box); ui.showError(doc, box, e, t("credit.could_not_load_deals", "Could not load deals."));
    });
  }
  /* Op-71 owner update: only non-blank inputs enter the confirm (old→new rows). */
  function updateBox(doc, box, uiGen, o, a, me) {
    var ui = U();
    var fDelta = ui.field(doc, t("credit.update_delta_tpl", "Delta amount (%(sym)s, signed)", { sym: a.symbol }), { placeholder: t("credit.blank_unchanged", "blank = unchanged"), inputmode: "decimal" });
    var fRate = ui.field(doc, t("credit.new_fee_rate", "New fee rate %"), { placeholder: t("credit.blank_unchanged", "blank = unchanged"), inputmode: "decimal" });
    var fEn = doc.createElement("select"); ui.touchable(fEn);
    [["", t("credit.unchanged", "unchanged")], ["1", t("credit.enabled_2", "enabled")], ["0", t("credit.disabled", "disabled")]].forEach(function (x) {
      var op = doc.createElement("option"); op.value = x[0]; op.textContent = x[1]; fEn.appendChild(op); });
    [fDelta, fRate].forEach(function (f) { box.appendChild(f.row); });
    /* Forms seam (Task 2.2): single-select row — div.xfer-field > label > select. */
    var enRow = Forms.fieldRow(doc, t("credit.enabled_3", "Enabled "), fEn);
    box.appendChild(enRow);
    ui.reviewSection(doc, box, uiGen, t("credit.review_update", "Review update"), {
      build: async function () {
        var dv = fDelta.input.value.trim(), rv = fRate.input.value.trim();
        var deltaRaw = null;
        if (dv) {
          var neg = dv.charAt(0) === "-";
          deltaRaw = (neg ? "-" : "") + Format.parseAmount(neg ? dv.slice(1) : dv, a.precision);
        }
        var pair = Credit.buildOfferUpdate({ accountId: me.id, offerId: o.id,
          deltaRawOrNull: deltaRaw, deltaAssetId: o.asset_id,
          rateHumanOrNull: rv || null, maxDurSecOrNull: null, minDealRawOrNull: null,
          enabledOrNull: (fEn.value === "" ? null : fEn.value === "1"),
          autoDisableIsoOrNull: null, collateralOrNull: undefined, borrowersOrNull: undefined });
        return { pair: pair, fee: await Credit.fee(pair, "1.3.0"), dv: dv, rv: rv,
          prove: async function () {
            try { return await Credit.offer(o.id); } catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1], out = [[t("credit.owner", "Owner"), ui.who(me)], [t("credit.offer", "Offer"), o.id]];
        if (op.delta_amount) out.push([t("credit.delta", "Delta"), R.dv + " " + a.symbol, "raw " + op.delta_amount.amount]);
        if (op.fee_rate !== null && op.fee_rate !== undefined)
          out.push([t("credit.fee_rate", "Fee rate"), Credit.rateUnitsToHuman(o.rate_units) + "% → " + R.rv + "%", "raw " + op.fee_rate]);
        if (op.enabled !== null && op.enabled !== undefined) out.push([t("credit.enabled", "Enabled"), String(op.enabled)]);
        out.push([t("credit.fee", "Fee"), fee.text, "raw " + fee.raw]); out.push([t("credit.network", "Network"), "testnet"]);
        return out;
      },
      title: t("credit.confirm_offer_update", "Confirm offer update"), ok: function () { return t("credit.offer_updated", "Offer updated."); }, fail: t("credit.could_not_prepare_the_update_change_1_field", "Could not prepare the update (change ≥1 field).") });
  }
  /* Op-70 owner delete: fee 0 shown explicitly. */
  function deleteBox(doc, box, uiGen, o, me) {
    var ui = U();
    ui.reviewSection(doc, box, uiGen, t("credit.review_delete", "Review delete"), {
      build: async function () {
        var pair = Credit.buildOfferDelete({ accountId: me.id, offerId: o.id });
        return { pair: pair, fee: await Credit.fee(pair, "1.3.0"),
          prove: async function () {
            try { await Credit.offer(o.id); return null; }
            catch (e) { return (String((e && e.message) || e).indexOf("unknown-offer") !== -1) ? { gone: true } : null; } } };
      },
      rows: function (R, fee) {
        return [[t("credit.owner", "Owner"), ui.who(me)], [t("credit.offer", "Offer"), o.id], [t("credit.fee", "Fee"), fee.text + " (expected 0)", "raw " + fee.raw], [t("credit.network", "Network"), "testnet"]];
      },
      title: t("credit.confirm_offer_delete", "Confirm offer delete"), ok: function () { return t("credit.offer_deleted", "Offer deleted."); }, fail: t("credit.could_not_prepare_the_delete", "Could not prepare the delete.") });
  }

  return { renderOfferDetail: renderOfferDetail, renderDealDetail: renderDealDetail };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.CreditDetailUI === "undefined") { globalThis.CreditDetailUI = CreditDetailUI; }
if (typeof module !== "undefined") { module.exports = CreditDetailUI; }
