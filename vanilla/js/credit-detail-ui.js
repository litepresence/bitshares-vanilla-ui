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
 * CHAIN TRUTH (#4 wins): accept spawns the deal (NO deal_create op); op-73
 *   repay_amount + credit_fee BOTH explicit; op-76 wire field is `account`
 *   (NOT borrower — #3's committee-account trap); fee_rate denom 1M.
 */
var CreditDetailUI = (function () {
  "use strict";
  var gen = 0;
  function U() {
    if (typeof CreditUI === "undefined" || !CreditUI._ui) throw new Error("credit-ui-missing (credit-ui.js first)");
    return CreditUI._ui;
  }
  /* Two-counter liveness: own gen (this route) + CreditUI uiGen (shared gate). */
  function live(myGen, uiGen) {
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  /* Route entry: #/credit-offer/:id — detail + accept + deals + owner forms. */
  function renderOfferDetail(root, id) {
    if (!root) return;
    var ui;
    try { ui = U(); } catch (e) {
      root.innerHTML = "";
      var d0 = root.ownerDocument || document, w0 = d0.createElement("div");
      w0.className = "wrap"; root.appendChild(w0);
      w0.appendChild(d0.createTextNode("Credit detail backend missing: credit-ui.js failed to load."));
      return;
    }
    var ctx = ui.routeReady(root, "Credit Offer", function () { renderOfferDetail(root, id); });
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ui.showStatus(doc, ctx.wrap, "Loading offer " + id + "…");
    Promise.resolve().then(async function () {
      var o = await Credit.offer(String(id));
      var a = await Asset.describe(o.asset_id);
      var me = null;
      try { me = await Account.resolve(await Account.myAccountId()); } catch (e) { me = null; }
      return { o: o, a: a, me: me };
    }).then(function (R) {
      if (!live(myGen, uiGen)) return;
      ui.clearBox(ctx.wrap);
      var o = R.o, a = R.a;
      ctx.wrap.appendChild(ui.el(doc, "h1", "Offer " + o.id));
      var back = ui.el(doc, "a", "← All offers"); back.setAttribute("href", "#/credit-offer");
      ctx.wrap.appendChild(back);
      var cur = ui.amt(o.current_raw, a.precision, a.symbol, o.asset_id);
      var tot = ui.amt(o.total_raw, a.precision, a.symbol, o.asset_id);
      var rt = ui.rateText(o.rate_units);
      ctx.wrap.appendChild(ui.confirmList(doc, [["Offer", o.id], ["Owner", o.owner],
        ["Asset", a.symbol + " (" + o.asset_id + ")"],
        ["Current balance", cur.text, "raw " + cur.raw], ["Total balance", tot.text, "raw " + tot.raw],
        ["Fee rate", rt.text + " (denom 1,000,000)", "raw " + rt.raw],
        ["Max duration", Credit.durToHuman(o.max_dur_sec)], ["Enabled", o.enabled ? "yes" : "no"],
        ["Auto-disable", o.auto_disable_time || "—"]]));
      ctx.wrap.appendChild(ui.el(doc, "h2", "Acceptable collateral"));
      ctx.wrap.appendChild(ui.el(doc, "p", o.collateral_raw.length ? o.collateral_raw.map(function (c) { return c[0]; }).join(", ") : "Any collateral accepted.", "muted"));
      ctx.wrap.appendChild(ui.el(doc, "h2", "Acceptable borrowers"));
      ctx.wrap.appendChild(ui.el(doc, "p", o.borrowers_raw.length ? o.borrowers_raw.map(function (b) { return b[0]; }).join(", ") : "Any borrower accepted.", "muted"));
      ctx.wrap.appendChild(ui.el(doc, "h2", "Accept (borrow)"));
      acceptBox(doc, ctx.wrap, uiGen, o, a);
      ctx.wrap.appendChild(ui.el(doc, "h2", "Deals on this offer"));
      var dealsBox = ui.el(doc, "div"); ctx.wrap.appendChild(dealsBox);
      dealTables(doc, dealsBox, myGen, uiGen, o, a);
      if (R.me && R.me.id === o.owner) {
        ctx.wrap.appendChild(ui.el(doc, "h2", "Owner: update / delete"));
        updateBox(doc, ctx.wrap, uiGen, o, a, R.me);
        deleteBox(doc, ctx.wrap, uiGen, o, R.me);
      }
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return; ui.clearBox(ctx.wrap);
      ctx.wrap.appendChild(ui.el(doc, "h1", "Offer " + String(id)));
      ui.showError(doc, ctx.wrap, e, "Unknown offer.");
      var back = ui.el(doc, "a", "← All offers"); back.setAttribute("href", "#/credit-offer");
      ctx.wrap.appendChild(back);
    });
  }
  /* Op-72 accept: borrow leg asset comes from the offer (never typed). */
  function acceptBox(doc, box, uiGen, o, a) {
    var ui = U();
    var fBor = ui.field(doc, "Borrower", { placeholder: "blank = wallet account" });
    var fAmt = ui.field(doc, "Borrow amount (" + a.symbol + ")", { placeholder: "0.0", inputmode: "decimal" });
    var fCollA = ui.field(doc, "Collateral asset", { placeholder: "symbol or 1.3.x" });
    var fColl = ui.field(doc, "Collateral amount", { placeholder: "0.0", inputmode: "decimal" });
    var fRate = ui.field(doc, "Max fee rate %", { value: Credit.rateUnitsToHuman(o.rate_units), inputmode: "decimal" });
    var fDur = ui.field(doc, "Min duration", { value: "1 day", placeholder: "e.g. 3 days" });
    [fBor, fAmt, fCollA, fColl, fRate, fDur].forEach(function (f) { box.appendChild(f.row); });
    var arRow = ui.el(doc, "div", null, "xfer-field");
    arRow.appendChild(ui.el(doc, "span", "Auto-repay: "));
    var arNames = [["", "omit (chain default)"], ["0", "0 — none"], ["1", "1 — full only"], ["2", "2 — partial ok"]];
    var arInputs = arNames.map(function (n, i) {
      var lab = ui.el(doc, "label", " " + n[1] + " ");
      var r = doc.createElement("input"); r.type = "radio"; r.name = "ar-" + o.id; r.value = n[0];
      if (i === 0) r.checked = true; ui.touchable(r); lab.insertBefore(r, lab.firstChild);
      arRow.appendChild(lab); return r;
    });
    box.appendChild(arRow);
    ui.reviewSection(doc, box, uiGen, "Review accept", {
      build: async function () {
        var bor = fBor.input.value.trim() ? await Account.resolve(fBor.input.value.trim())
          : await Account.resolve(await Account.myAccountId());
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
        return [["Borrower", ui.who(R.bor)], ["Offer", o.id],
          ["Borrow", Format.formatAmount(op.borrow_amount.amount, a.precision) + " " + a.symbol, "raw " + op.borrow_amount.amount],
          ["Collateral", Format.formatAmount(op.collateral.amount, R.ca.precision) + " " + R.ca.symbol, "raw " + op.collateral.amount],
          ["Max fee rate", Credit.rateUnitsToHuman(op.max_fee_rate) + "%", "raw " + op.max_fee_rate],
          ["Min duration", Credit.durToHuman(op.min_duration_seconds)],
          ["Auto-repay", arWord],
          ["Quoted credit fee", Format.formatAmount(R.quote, a.precision) + " " + a.symbol, "ceil(amount*rate/1M)"],
          ["Fee", fee.text, "raw " + fee.raw], ["Network", "testnet"]];
      },
      title: "Confirm accept", ok: function () { return "Deal opened (accept broadcast)."; }, fail: "Could not prepare the accept." });
  }
  /* Deals-by-offer table + repay / auto-repay forms for a picked deal. */
  function dealTables(doc, box, myGen, uiGen, o, a) {
    var ui = U();
    ui.showStatus(doc, box, "Loading deals…");
    Credit.dealsByOffer(o.id, {}).then(function (deals) {
      if (!live(myGen, uiGen)) return; ui.clearBox(box);
      var rows = deals.map(function (d) {
        var debt = ui.amt(d.debt_raw, d.debt_prec, d.debt_sym, d.debt_id);
        var coll = ui.amt(d.coll_raw, d.coll_prec, d.coll_sym, d.coll_id);
        return { d: d, cells: [{ text: d.id }, { text: d.borrower }, { text: debt.text, raw: debt.raw },
          { text: coll.text, raw: coll.raw },
          { text: Credit.rateUnitsToHuman(d.rate_units) + "%", raw: String(d.rate_units) },
          { text: (d.auto_repay === null || d.auto_repay === undefined) ? "—" : Credit.autoRepayWord(d.auto_repay) }] };
      });
      box.appendChild(ui.deskTable(doc, ["Deal", "Borrower", "Debt", "Collateral", "Rate", "Auto-repay"], rows,
        function (r) { return [r.d.id + " · borrower " + r.d.borrower, "Debt " + r.cells[2].text, "Collateral " + r.cells[3].text, "Rate " + r.cells[4].text]; }));
      if (!deals.length) { box.appendChild(ui.el(doc, "p", "No deals on this offer yet.", "muted")); return; }
      var sel = doc.createElement("select"); ui.touchable(sel);
      deals.forEach(function (d) {
        var op = doc.createElement("option"); op.value = d.id; op.textContent = d.id; sel.appendChild(op); });
      var selRow = ui.el(doc, "div", null, "xfer-field"), selLab = ui.el(doc, "label", "Deal ");
      selLab.appendChild(sel); selRow.appendChild(selLab); box.appendChild(selRow);
      var fRepay = ui.field(doc, "Repay amount", { placeholder: "0.0", inputmode: "decimal" });
      box.appendChild(fRepay.row);
      ui.reviewSection(doc, box, uiGen, "Review repay", {
        build: async function () {
          var deal = null;
          deals.forEach(function (d) { if (d.id === sel.value) deal = d; });
          if (!deal) throw new Error("unknown-deal");
          var me = await Account.resolve(await Account.myAccountId());
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
          return [["Account", ui.who(R.me)], ["Deal", R.deal.id],
            ["Repay", Format.formatAmount(op.repay_amount.amount, R.prec), "raw " + op.repay_amount.amount],
            ["Credit fee", Format.formatAmount(op.credit_fee.amount, R.prec), "ceil(amount*rate/1M), raw " + op.credit_fee.amount],
            ["Fee", fee.text, "raw " + fee.raw], ["Network", "testnet"]];
        },
        title: "Confirm deal repay", ok: function () { return "Repay broadcast."; }, fail: "Could not prepare the repay." });
      var arRow = ui.el(doc, "div", null, "xfer-field");
      arRow.appendChild(ui.el(doc, "span", "New auto-repay: "));
      var arInputs = [0, 1, 2].map(function (n, i) {
        var lab = ui.el(doc, "label", " " + n + " ");
        var r = doc.createElement("input"); r.type = "radio"; r.name = "dar-" + o.id; r.value = String(n);
        if (i === 0) r.checked = true; ui.touchable(r); lab.insertBefore(r, lab.firstChild);
        arRow.appendChild(lab); return r;
      });
      box.appendChild(arRow);
      ui.reviewSection(doc, box, uiGen, "Review auto-repay change", {
        build: async function () {
          var deal = null;
          deals.forEach(function (d) { if (d.id === sel.value) deal = d; });
          if (!deal) throw new Error("unknown-deal");
          var me = await Account.resolve(await Account.myAccountId());
          var n = 0; arInputs.forEach(function (r) { if (r.checked) n = parseInt(r.value, 10); });
          var pair = Credit.buildDealUpdate({ accountId: me.id, dealId: deal.id, autoRepay: n });
          return { pair: pair, fee: await Credit.fee(pair, "1.3.0"), me: me, deal: deal, n: n,
            prove: async function () {
              try { var d = await Credit.deal(deal.id); return (d.auto_repay === n) ? d : null; }
              catch (e) { return null; } } };
        },
        rows: function (R, fee) {
          var oldW = (R.deal.auto_repay === null || R.deal.auto_repay === undefined) ? "—" : Credit.autoRepayWord(R.deal.auto_repay);
          return [["Account", ui.who(R.me)], ["Deal", R.deal.id],
            ["Auto-repay", oldW + " → " + Credit.autoRepayWord(R.n)],
            ["Fee", fee.text, "raw " + fee.raw], ["Network", "testnet"]];
        },
        title: "Confirm deal update", ok: function () { return "Deal updated."; }, fail: "Could not prepare the update." });
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return; ui.clearBox(box); ui.showError(doc, box, e, "Could not load deals.");
    });
  }
  /* Op-71 owner update: only non-blank inputs enter the confirm (old→new rows). */
  function updateBox(doc, box, uiGen, o, a, me) {
    var ui = U();
    var fDelta = ui.field(doc, "Delta amount (" + a.symbol + ", signed)", { placeholder: "blank = unchanged", inputmode: "decimal" });
    var fRate = ui.field(doc, "New fee rate %", { placeholder: "blank = unchanged", inputmode: "decimal" });
    var fEn = doc.createElement("select"); ui.touchable(fEn);
    [["", "unchanged"], ["1", "enabled"], ["0", "disabled"]].forEach(function (x) {
      var op = doc.createElement("option"); op.value = x[0]; op.textContent = x[1]; fEn.appendChild(op); });
    [fDelta, fRate].forEach(function (f) { box.appendChild(f.row); });
    var enRow = ui.el(doc, "div", null, "xfer-field"), enLab = ui.el(doc, "label", "Enabled ");
    enLab.appendChild(fEn); enRow.appendChild(enLab); box.appendChild(enRow);
    ui.reviewSection(doc, box, uiGen, "Review update", {
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
        var op = R.pair[1], out = [["Owner", ui.who(me)], ["Offer", o.id]];
        if (op.delta_amount) out.push(["Delta", R.dv + " " + a.symbol, "raw " + op.delta_amount.amount]);
        if (op.fee_rate !== null && op.fee_rate !== undefined)
          out.push(["Fee rate", Credit.rateUnitsToHuman(o.rate_units) + "% → " + R.rv + "%", "raw " + op.fee_rate]);
        if (op.enabled !== null && op.enabled !== undefined) out.push(["Enabled", String(op.enabled)]);
        out.push(["Fee", fee.text, "raw " + fee.raw]); out.push(["Network", "testnet"]);
        return out;
      },
      title: "Confirm offer update", ok: function () { return "Offer updated."; }, fail: "Could not prepare the update (change ≥1 field)." });
  }
  /* Op-70 owner delete: fee 0 shown explicitly. */
  function deleteBox(doc, box, uiGen, o, me) {
    var ui = U();
    ui.reviewSection(doc, box, uiGen, "Review delete", {
      build: async function () {
        var pair = Credit.buildOfferDelete({ accountId: me.id, offerId: o.id });
        return { pair: pair, fee: await Credit.fee(pair, "1.3.0"),
          prove: async function () {
            try { await Credit.offer(o.id); return null; }
            catch (e) { return (String((e && e.message) || e).indexOf("unknown-offer") !== -1) ? { gone: true } : null; } } };
      },
      rows: function (R, fee) {
        return [["Owner", ui.who(me)], ["Offer", o.id], ["Fee", fee.text + " (expected 0)", "raw " + fee.raw], ["Network", "testnet"]];
      },
      title: "Confirm offer delete", ok: function () { return "Offer deleted."; }, fail: "Could not prepare the delete." });
  }

  return { renderOfferDetail: renderOfferDetail };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.CreditDetailUI === "undefined") { globalThis.CreditDetailUI = CreditDetailUI; }
if (typeof module !== "undefined") { module.exports = CreditDetailUI; }
