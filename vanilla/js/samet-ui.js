/* samet-ui.js — #/samet Same-T funds desk (split OUT of credit-ui.js on the cap).
 * Owns: fund list + my-funds (row Borrow+Repay/Repay/Update/Delete actions
 *   inline — NO :id route) + op-64 create form. Borrowing is the COMBINED
 *   [67 borrow + 68 repay] single-tx order with named-row confirm (both legs
 *   + both op fees human, fee filled on EVERY op via Tx.feeMulti); the chain
 *   REJECTS a lone op-67 (`Unpaid SameT Fund debt detected`, proven block
 *   100930730), so no separate borrow flow is offered. A Repay-ONLY single-op
 *   path stays for existing unpaid debt (unpaid read first; zero unpaid ->
 *   honest redirect, never a doomed broadcast). Delete shows fee-0
 *   explicitly; every action ends in re-read proof. No money math
 *   (CreditSamet + Credit.rate + Format do it); no serializers (tx.js owns
 *   bytes). Unknown fund -> empty state via the named unknown-fund error,
 *   never blank.
 * Consumes: CreditUI._ui (route gate, confirm+publish flow, tables, human
 *   formatters), CreditSamet (fund/funds/fundsByOwner reads, op 64/66/65/67/68
 *   builders), Credit (rateUnitsToHuman/creditFee hint, sendAndProve — generic:
 *   Tx.sign + Chain broadcast + caller proveFn), Tx.fee (samet fee-fill, answer
 *   assigned back onto opData.fee), Tx.buildTx, Format, Account, Asset.describe.
 *   Own gen + two-counter live() (pool-detail-ui.js / debit-ui precedent).
  * Created by: building-vanilla-slices skill, slice-13-credit plan Task 3.
  * PUBLIC-FIRST (gate repair): the shared CreditUI routeReady no longer gates
  *   on unlock — fund list/my-funds/create-preview render locked under
  *   committee-account 1.2.0 with a viewing notice. Same-T actions have no
  *   actor input, so locked builds preview as 1.2.0; password is asked only
  *   at Sign & Send (shared sendConfirm sign-time gate).
 * CHAIN TRUTH (#4 wins): fund space 1.20.x <- types.hpp:383; op-66 canonical
 *   name new_fee_rate (stale aliases NOT ported); op-65/70 fee 0; fee_rate
 *   denom 1M (1000 units = 0.1%) <- config.hpp:121.
 */
var SametUI = (function () {
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
    if (typeof CreditUI === "undefined" || !CreditUI._ui) throw new Error(t("samet.credit_ui_missing_credit_ui_js_first", "credit-ui-missing (credit-ui.js first)"));
    return CreditUI._ui;
  }
  /* Two-counter liveness: own gen (this route) + CreditUI uiGen (shared gate). */
  function live(myGen, uiGen) {
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  function fundRows(ui, list) {
    return list.map(function (f) {
      var bal = ui.amt(f.balance_raw, f.prec, f.sym, f.asset_id);
      var unp = ui.amt(f.unpaid_raw, f.prec, f.sym, f.asset_id);
      var rt = ui.rateText(f.rate_units);
      return { f: f, cells: [{ text: f.id }, { text: f.owner }, { text: f.sym || f.asset_id },
        { text: bal.text, raw: bal.raw }, { text: rt.text, raw: rt.raw }, { text: unp.text, raw: unp.raw }] };
    });
  }
  function fundCards(r) {
    return [r.f.id + " · " + (r.f.sym || r.f.asset_id), "Owner " + r.f.owner,
      "Balance " + r.cells[3].text + " · rate " + r.cells[4].text, "Unpaid " + r.cells[5].text];
  }
  /* Route entry: #/samet — list + my-funds with row actions + create. */
  function renderSamet(root) {
    if (!root) return;
    var ui;
    try { ui = U(); } catch (e) {
      root.innerHTML = "";
      var d0 = root.ownerDocument || document, w0 = d0.createElement("div");
      w0.className = "wrap"; root.appendChild(w0);
      w0.appendChild(d0.createTextNode(t("samet.same_t_backend_missing_credit_ui_js_failed_to", "Same-T backend missing: credit-ui.js failed to load.")));
      return;
    }
    var ctx = ui.routeReady(root, t("samet.same_t_funds", "Same-T Funds"), function () { renderSamet(root); });
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    var lockedS = false;
    try { lockedS = !ui.isUnlockedNow(); } catch (e) { lockedS = false; }
    if (lockedS) ctx.wrap.appendChild(ui.viewingAsNotice(doc));
    ctx.wrap.appendChild(ui.el(doc, "p", t("samet.same_asset_same_t_funds_borrowing_and_repayin", "Same-asset (Same-T) funds: borrowing and repaying happen in ONE transaction [67 borrow + 68 repay] — the chain rejects a lone borrow. Rates are percent at denom 1,000,000."), "muted"));
    var go = ui.touchable(ui.el(doc, "button", t("samet.list_funds", "List funds"))); go.type = "button"; ctx.wrap.appendChild(go);
    var listBox = ui.el(doc, "div"); ctx.wrap.appendChild(listBox);
    ctx.wrap.appendChild(ui.el(doc, "h2", t("samet.my_funds", "My funds")));
    var mineBox = ui.el(doc, "div"); ctx.wrap.appendChild(mineBox);
    ctx.wrap.appendChild(ui.el(doc, "h2", t("samet.create_fund", "Create fund")));
    if (lockedS) ctx.wrap.appendChild(ui.signNotice(doc));
    sametCreateBox(doc, ctx.wrap, uiGen);
    function draw(box, rows, mine) {
      ui.clearBox(box);
      var rs = fundRows(ui, rows);
      box.appendChild(ui.deskTable(doc, [t("samet.fund", "Fund"), t("samet.owner", "Owner"), t("samet.asset", "Asset"), t("samet.balance", "Balance"), t("samet.fee_rate", "Fee rate"), t("samet.unpaid", "Unpaid")], rs, fundCards));
      if (mine) rs.forEach(function (r) { rowActions(doc, box, myGen, uiGen, r.f); });
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(listBox);
      ui.showStatus(doc, listBox, t("samet.loading_funds", "Loading funds…"));
      CreditSamet.funds({}).then(function (rows) {
        if (!live(myGen, uiGen)) return; draw(listBox, rows, false);
      }).catch(function (e) {
        if (!live(myGen, uiGen)) return; ui.clearBox(listBox); ui.showError(doc, listBox, e, t("samet.could_not_load_funds", "Could not load funds."));
      }).then(function () { go.disabled = false; });
    });
    Account.myAccountId().catch(function () { return ui.viewingAsId; }).then(function (id) { return Account.resolve(id); }).then(function (me) {
      if (!live(myGen, uiGen)) return;
      if (lockedS) mineBox.appendChild(ui.el(doc, "p", t("samet.viewing_as_committee_account_1_2_0", "Viewing as committee-account (1.2.0)."), "muted"));
      CreditSamet.fundsByOwner(me.id, {}).then(function (rows) {
        if (!live(myGen, uiGen)) return; draw(mineBox, rows, true);
      }).catch(function () {
        if (live(myGen, uiGen)) { ui.clearBox(mineBox); mineBox.appendChild(ui.el(doc, "p", t("samet.no_owned_funds", "No owned funds."), "muted")); }
      });
      go.click();
    }).catch(function () { if (live(myGen, uiGen)) go.click(); });
  }
  /* Per-fund Borrow / Repay / Update / Delete buttons open the form below. */
  function rowActions(doc, box, myGen, uiGen, f) {
    var ui = U();
    var line = ui.el(doc, "div", null, "xfer-field");
    line.appendChild(ui.el(doc, "span", f.id + " "));
    [[t("samet.borrow_repay", "Borrow+Repay"), "borrow"], [t("samet.repay", "Repay"), "repay"], [t("samet.update", "Update"), "update"], [t("samet.delete", "Delete"), "delete"]].forEach(function (k) {
      var b = ui.touchable(ui.el(doc, "button", k[0])); b.type = "button";
      b.addEventListener("click", function () {
        if (live(myGen, uiGen)) openAction(doc, box, uiGen, f, k[1]);
      });
      line.appendChild(b);
    });
    box.appendChild(line);
  }
  /* Fee-fill helpers: Tx.fee answers {amount, asset_id} — assigned back onto
   * opData. Single-op form for lone ops; feeMulti fills EVERY op in a
   * multi-op order (an unfilled op-68 fee broadcasts as `insufficient fee`). */
  async function withFee(pair) {
    var ans = await Tx.fee(pair[0], pair[1], "1.3.0");
    pair[1].fee = { amount: String(ans.amount), asset_id: ans.asset_id };
    return pair[1].fee;
  }
  async function withFeeMulti(ops) {
    var r = await Tx.feeMulti(ops, "1.3.0");
    return r.fees;
  }
  /* Fund precision: joined at read time, else one describe (display + parse). */
  async function fundPrec(f) {
    if (f.prec === null || f.prec === undefined) return (await Asset.describe(f.asset_id)).precision;
    return f.prec;
  }
  /* Raw unpaid -> safe digit string (null/missing reads as zero, never a throw). */
  function unpaidOf(fund) {
    var u = fund && fund.unpaid_raw;
    return (typeof u === "string" && /^\d+$/.test(u)) ? u : "0";
  }
  /* Single-op action form for a fund (borrow+repay combo / repay-only / update / delete). */
  function openAction(doc, box, uiGen, f, kind) {
    var ui = U();
    var out = ui.el(doc, "div", null, "xfer-out"); box.appendChild(out);
    out.appendChild(ui.el(doc, "h3", kind.charAt(0).toUpperCase() + kind.slice(1) + " " + f.id));
    try { if (!ui.isUnlockedNow()) out.appendChild(ui.signNotice(doc)); } catch (e) { /* notice optional */ }
    if (kind === "borrow") {
      /* COMBINED [67 borrow + 68 repay] single-tx order (finding D): a lone
       * op-67 is rejected verbatim `Unpaid SameT Fund debt detected`; only
       * the combined tx is accepted (proven block 100930730). Blank repay =
       * repay exactly what was borrowed (unpaid returns to its prior level). */
      var fB = ui.field(doc, t("samet.borrow_amt_tpl", "Borrow amount (%(s)s)", { s: f.sym || f.asset_id }), { placeholder: "0.0", inputmode: "decimal" });
      var fRP = ui.field(doc, t("samet.repay_amount_blank_same_as_borrow", "Repay amount (blank = same as borrow)"), { placeholder: "0.0", inputmode: "decimal" });
      var fFF = ui.field(doc, t("samet.fund_fee", "Fund fee"), { placeholder: "0.0", inputmode: "decimal" });
      out.appendChild(fB.row); out.appendChild(fRP.row); out.appendChild(fFF.row);
      out.appendChild(ui.el(doc, "p", "Hint: quoted fund fee = ceil(repay × " + Credit.rateUnitsToHuman(f.rate_units) + "%). One transaction carries BOTH legs; each leg pays its own fee.", "muted"));
      var goBtn = ui.touchable(ui.el(doc, "button", t("samet.review_borrow_repay", "Review borrow+repay"))); goBtn.type = "button"; out.appendChild(goBtn);
      var comboOut = ui.el(doc, "div", null, "xfer-out"); out.appendChild(comboOut);
      goBtn.addEventListener("click", function () {
        if (!live(myGen, uiGen)) return;
        ui.clearBox(comboOut); goBtn.disabled = true;
        ui.showStatus(doc, comboOut, t("samet.resolving_and_estimating_fees", "Resolving and estimating fees…"));
        (async function () {
          var me = await Account.resolve(await Account.myAccountId().catch(function () { return ui.viewingAsId; }));
          var prec = await fundPrec(f), sym = f.sym || f.asset_id;
          var borrowRaw = Format.parseAmount(fB.input.value.trim(), prec);
          var rpV = fRP.input.value.trim();
          var repayRaw = rpV ? Format.parseAmount(rpV, prec) : borrowRaw;
          var feeRaw = Format.parseAmount(fFF.input.value.trim(), prec);
          var preUnpaid = "0";
          try { preUnpaid = unpaidOf(await CreditSamet.fund(f.id)); } catch (e) { preUnpaid = "0"; }
          var b = CreditSamet.buildSametBorrow({ borrowerId: me.id, fundId: f.id, borrowRaw: borrowRaw, borrowAssetId: f.asset_id });
          var r = CreditSamet.buildSametRepay({ accountId: me.id, fundId: f.id,
            repayRaw: repayRaw, feeRaw: feeRaw, assetId: f.asset_id });
          var ops = [[b[0], b[1]], [r[0], r[1]]];
          await withFeeMulti(ops);
          var fee67 = await ui.feeText(ops[0][1].fee), fee68 = await ui.feeText(ops[1][1].fee);
          if (!live(myGen, uiGen)) return;
          var bAmt = ui.amt(borrowRaw, prec, sym, f.asset_id);
          var rAmt = ui.amt(repayRaw, prec, sym, f.asset_id);
          var ffAmt = ui.amt(feeRaw, prec, sym, f.asset_id);
          var expUnpaid = (BigInt(preUnpaid) + BigInt(borrowRaw) - BigInt(repayRaw)).toString();
          ui.sendConfirm(doc, comboOut, {
            title: t("samet.confirm_fund_borrow_repay", "Confirm fund borrow+repay"),
            rows: [[t("samet.borrower", "Borrower"), ui.who(me)], [t("samet.fund", "Fund"), f.id],
              [t("samet.borrow_op_67", "Borrow (op 67)"), bAmt.text, "raw " + bAmt.raw],
              [t("samet.repay_op_68", "Repay (op 68)"), rAmt.text, "raw " + rAmt.raw],
              [t("samet.fund_fee_op_68", "Fund fee (op 68)"), ffAmt.text, "raw " + ffAmt.raw],
              [t("samet.fee_borrow_leg_op_67", "Fee: borrow leg (op 67)"), fee67.text, "raw " + fee67.raw],
              [t("samet.fee_repay_leg_op_68", "Fee: repay leg (op 68)"), fee68.text, "raw " + fee68.raw],
              [t("samet.network", "Network"), "testnet"]],
            makeUnsigned: function () { return Tx.buildTx(ops); },
            prove: async function () {
              try {
                var cur = await CreditSamet.fund(f.id);
                return (unpaidOf(cur) === expUnpaid) ? cur : null;
              } catch (e) { return null; }
            },
            okText: "Borrow+repay broadcast."
          }, uiGen);
        })().catch(function (e) {
          if (!live(myGen, uiGen)) return;
          ui.clearBox(comboOut); ui.showError(doc, comboOut, e, t("samet.could_not_prepare_the_borrow_repay", "Could not prepare the borrow+repay."));
        }).then(function () { goBtn.disabled = false; });
      });
    } else if (kind === "repay") {
      /* Repay-ONLY single-op path: meaningful only against existing unpaid
       * debt. Unpaid is read first; zero unpaid redirects to Borrow+Repay
       * instead of firing a doomed broadcast. */
      var gate = ui.el(doc, "div"); out.appendChild(gate);
      ui.showStatus(doc, gate, t("samet.reading_unpaid", "Reading unpaid…"));
      (async function () {
        var cur = await CreditSamet.fund(f.id);
        var prec = await fundPrec(f), sym = f.sym || f.asset_id;
        if (!live(myGen, uiGen)) return;
        ui.clearBox(gate);
        var now = ui.amt(unpaidOf(cur), prec, sym, f.asset_id);
        if (BigInt(unpaidOf(cur)) <= 0n) {
          gate.appendChild(ui.el(doc, "p", "No unpaid debt on " + f.id + " — nothing to repay alone. Use Borrow+Repay to borrow and repay in one transaction.", "muted"));
          return;
        }
        var fR = ui.field(doc, t("samet.repay_amount", "Repay amount"), { placeholder: "0.0", inputmode: "decimal" });
        var fF = ui.field(doc, t("samet.fund_fee", "Fund fee"), { placeholder: "0.0", inputmode: "decimal" });
        gate.appendChild(fR.row); gate.appendChild(fF.row);
        gate.appendChild(ui.el(doc, "p", "Unpaid now: " + now.text + ". Hint: quoted fee = ceil(amount × " + Credit.rateUnitsToHuman(f.rate_units) + "%).", "muted"));
        ui.reviewSection(doc, gate, uiGen, t("samet.review_repay", "Review repay"), {
          build: async function () {
            var me = await Account.resolve(await Account.myAccountId().catch(function () { return ui.viewingAsId; }));
            var repayRaw = Format.parseAmount(fR.input.value.trim(), prec);
            var feeRaw = Format.parseAmount(fF.input.value.trim(), prec);
            var pair = CreditSamet.buildSametRepay({ accountId: me.id, fundId: f.id,
              repayRaw: repayRaw, feeRaw: feeRaw, assetId: f.asset_id });
            return { pair: pair, fee: await withFee(pair), me: me, prec: prec, sym: sym,
              prove: async function () {
                try { return await CreditSamet.fund(f.id); } catch (e) { return null; } } };
          },
          rows: function (R, fee) {
            var op = R.pair[1];
            var rAmt = ui.amt(op.repay_amount.amount, R.prec, R.sym, f.asset_id);
            var ffAmt = ui.amt(op.fund_fee.amount, R.prec, R.sym, f.asset_id);
            return [[t("samet.account", "Account"), ui.who(R.me)], [t("samet.fund", "Fund"), f.id],
              [t("samet.repay", "Repay"), rAmt.text, "raw " + rAmt.raw],
              [t("samet.fund_fee", "Fund fee"), ffAmt.text, "raw " + ffAmt.raw],
              [t("samet.fee", "Fee"), fee.text, "raw " + fee.raw], [t("samet.network", "Network"), "testnet"]];
          },
          title: t("samet.confirm_fund_repay", "Confirm fund repay"), ok: function () { return t("samet.repay_broadcast", "Repay broadcast."); }, fail: t("samet.could_not_prepare_the_repay", "Could not prepare the repay.") });
      })().catch(function (e) {
        if (!live(myGen, uiGen)) return;
        ui.clearBox(gate); ui.showError(doc, gate, e, t("samet.could_not_read_the_fund", "Could not read the fund."));
      });
    } else if (kind === "update") {
      var fD = ui.field(doc, t("samet.delta_amount_signed", "Delta amount (signed)"), { placeholder: t("samet.blank_unchanged", "blank = unchanged"), inputmode: "decimal" });
      var fN = ui.field(doc, t("samet.new_fee_rate", "New fee rate %"), { placeholder: t("samet.blank_unchanged", "blank = unchanged"), inputmode: "decimal" });
      out.appendChild(fD.row); out.appendChild(fN.row);
      ui.reviewSection(doc, out, uiGen, t("samet.review_update", "Review update"), {
        build: async function () {
          var me = await Account.resolve(await Account.myAccountId().catch(function () { return ui.viewingAsId; }));
          var prec = await fundPrec(f);
          var dv = fD.input.value.trim(), deltaRaw = null;
          if (dv) {
            var neg = dv.charAt(0) === "-";
            deltaRaw = (neg ? "-" : "") + Format.parseAmount(neg ? dv.slice(1) : dv, prec);
          }
          var nv = fN.input.value.trim();
          var pair = CreditSamet.buildSametUpdate({ accountId: me.id, fundId: f.id,
            deltaRawOrNull: deltaRaw, deltaAssetId: f.asset_id, rateHumanOrNull: nv || null });
          return { pair: pair, fee: await withFee(pair), me: me, dv: dv, nv: nv,
            prove: async function () {
              try { return await CreditSamet.fund(f.id); } catch (e) { return null; } } };
        },
        rows: function (R, fee) {
          var op = R.pair[1], rowsOut = [[t("samet.owner", "Owner"), ui.who(R.me)], [t("samet.fund", "Fund"), f.id]];
          if (op.delta_amount) rowsOut.push([t("samet.delta", "Delta"), R.dv, "raw " + op.delta_amount.amount]);
          if (op.new_fee_rate !== null && op.new_fee_rate !== undefined)
            rowsOut.push([t("samet.fee_rate", "Fee rate"), Credit.rateUnitsToHuman(f.rate_units) + "% → " + R.nv + "%", "raw " + op.new_fee_rate]);
          rowsOut.push([t("samet.fee", "Fee"), fee.text, "raw " + fee.raw]); rowsOut.push([t("samet.network", "Network"), "testnet"]);
          return rowsOut;
        },
        title: t("samet.confirm_fund_update", "Confirm fund update"), ok: function () { return t("samet.fund_updated", "Fund updated."); }, fail: t("samet.could_not_prepare_the_update_change_1_field", "Could not prepare the update (change ≥1 field).") });
    } else {
      ui.reviewSection(doc, out, uiGen, t("samet.review_delete", "Review delete"), {
        build: async function () {
          var me = await Account.resolve(await Account.myAccountId().catch(function () { return ui.viewingAsId; }));
          var pair = CreditSamet.buildSametDelete({ accountId: me.id, fundId: f.id });
          return { pair: pair, fee: await withFee(pair), me: me,
            prove: async function () {
              try { await CreditSamet.fund(f.id); return null; }
              catch (e) { return (String((e && e.message) || e).indexOf("unknown-fund") !== -1) ? { gone: true } : null; } } };
        },
        rows: function (R, fee) {
          return [[t("samet.owner", "Owner"), ui.who(R.me)], [t("samet.fund", "Fund"), f.id], [t("samet.fee", "Fee"), fee.text + " (expected 0)", "raw " + fee.raw], [t("samet.network", "Network"), "testnet"]];
        },
        title: t("samet.confirm_fund_delete", "Confirm fund delete"), ok: function () { return t("samet.fund_deleted", "Fund deleted."); }, fail: t("samet.could_not_prepare_the_delete", "Could not prepare the delete.") });
    }
  }
  /* Op-64 Same-T create form. */
  function sametCreateBox(doc, box, uiGen) {
    var ui = U();
    var fAsset = ui.field(doc, t("samet.asset", "Asset"), { placeholder: t("samet.symbol_or_1_3_x", "symbol or 1.3.x") });
    var fBal = ui.field(doc, t("samet.balance", "Balance"), { placeholder: "0.0", inputmode: "decimal" });
    var fRate = ui.field(doc, t("samet.fee_rate_2", "Fee rate %"), { placeholder: "0.1", inputmode: "decimal" });
    [fAsset, fBal, fRate].forEach(function (f) { box.appendChild(f.row); });
    ui.reviewSection(doc, box, uiGen, t("samet.review_create", "Review create"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId().catch(function () { return ui.viewingAsId; }));
        var a = await Asset.describe(fAsset.input.value.trim());
        var balRaw = Format.parseAmount(fBal.input.value.trim(), a.precision);
        var pair = CreditSamet.buildSametCreate({ accountId: me.id, assetId: a.id,
          balanceRaw: balRaw, rateHuman: fRate.input.value.trim() });
        return { pair: pair, fee: await withFee(pair), me: me, a: a, balRaw: balRaw,
          prove: async function () {
            try {
              var rows = await CreditSamet.fundsByOwner(me.id, {});
              for (var k = 0; k < rows.length; k++)
                if (rows[k].asset_id === a.id && rows[k].balance_raw === balRaw) return rows[k];
            } catch (e) { return null; } return null; } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        return [[t("samet.owner", "Owner"), ui.who(R.me)], [t("samet.asset", "Asset"), R.a.symbol + " (" + R.a.id + ")"],
          [t("samet.balance", "Balance"), Format.formatAmount(op.balance, R.a.precision) + " " + R.a.symbol, "raw " + op.balance],
          [t("samet.fee_rate", "Fee rate"), Credit.rateUnitsToHuman(op.fee_rate) + "% (denom 1,000,000)", "raw " + op.fee_rate],
          [t("samet.fee", "Fee"), fee.text, "raw " + fee.raw], [t("samet.network", "Network"), "testnet"]];
      },
      title: t("samet.confirm_fund_create", "Confirm fund create"), ok: function () { return t("samet.fund_created", "Fund created."); }, fail: t("samet.could_not_prepare_the_create", "Could not prepare the create.") });
  }

  return { renderSamet: renderSamet };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.SametUI === "undefined") { globalThis.SametUI = SametUI; }
if (typeof module !== "undefined") { module.exports = SametUI; }
