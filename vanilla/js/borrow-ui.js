/* borrow-ui.js — #/borrow margin positions + op-3 adjust form (split OUT of credit-ui.js).
 * Owns: margin positions table for an account (collateral/debt human both legs,
 *   call price, TCR at the proven divisor 1000) + op-3 call_order_update adjust
 *   form (signed delta-collateral / delta-debt, optional TCR, live fee, named-row
 *   confirm) + short margin explainer (port the WORDS of #1 Showcases/Borrow.jsx
 *   steps, not its stepper chrome). No safe position -> adjust form client-gated
 *   with an honest note (ambiguity H): positions READ is always offered, the
 *   broadcast only against an existing position. No money math here (Credit
 *   builders + Format do it); no serializers (tx.js owns bytes).
 * Consumes: Credit (positions/positionsMethod reads, buildCallUpdate, tcr/fee
 *   helpers, fee/sendAndProve), Tx.buildTx, Format, Account, Asset.describe,
 *   Wallet, Chain/Store. Created by: building-vanilla-slices skill,
 *   slice-13-credit plan Task 3 (pre-authorized split — credit-ui.js cap).
 * CHAIN TRUTH (#4 wins): op 3 = (fee)(funding_account)(delta_collateral)
 *   (delta_debt)(extensions{optional u16 target_collateral_ratio}) <-
 *   market.hpp:171-197 — NO expiration field (#1 MarketsActions' is stale, NOT
 *   ported); TCR divisor 1000 <- BorrowModal.jsx:57-60/:478-481 (ambiguity G
 *   proven); negative delta_debt = borrow-more (WARNED in the form + confirm).
 */
var BorrowUI = (function () {
  "use strict";
  var gen = 0, subs = [];
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text; return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(b) { while (b.firstChild) b.removeChild(b.firstChild); }
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (m.indexOf("not-connected") !== -1) m = "Network unavailable. Check Settings → Nodes and retry.";
    else if (m.indexOf("wallet-locked") !== -1) m = "Wallet is locked.";
    else if (m.indexOf("unknown-account") !== -1) m = "Unknown account.";
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite");
    wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function routeReady(root, title, retry) {
    var doc = root.ownerDocument || document, myGen = ++gen, miss = null;
    subs.forEach(function (off) { try { off(); } catch (e) {} }); subs = [];
    root.innerHTML = "";
    ["Credit", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"].forEach(function (g) {
      if (typeof globalThis[g] === "undefined") miss = g; });
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", title));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", "Network unavailable. Check Settings → Nodes and retry.", "muted"));
      var b = touchable(el(doc, "button", "Retry")); b.type = "button";
      b.addEventListener("click", retry); wrap.appendChild(b);
      try {
        var h = (typeof location !== "undefined" && location.hash) || "", done = false;
        subs.push(Store.subscribe("connection", function (st) {
          if (done || myGen !== gen) { done = true; return; }
          if (st && st.state === "open") { done = true;
            if (typeof location === "undefined" || location.hash === h) retry(); }
        }));
      } catch (e) { /* manual Retry remains */ }
      return null;
    }
    if (!Wallet.isUnlocked()) {
      wrap.appendChild(el(doc, "p", "Wallet is locked. Enter your password to continue.", "muted"));
      var inp = doc.createElement("input"); inp.type = "password"; touchable(inp); wrap.appendChild(inp);
      var u = touchable(el(doc, "button", "Unlock")); u.type = "button"; wrap.appendChild(u);
      u.addEventListener("click", function () { u.disabled = true;
        Wallet.unlock(inp.value).then(retry).catch(function (e) { u.disabled = false; showError(doc, wrap, e, "Unlock failed."); });
      });
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
  function amt(raw, prec, sym, id) {
    if (typeof prec === "number" && /^-?\d+$/.test(String(raw)))
      return { text: Format.formatAmount(String(raw), prec) + (sym ? " " + sym : ""), raw: String(raw) };
    return { text: String(raw) + " (" + id + ")", raw: String(raw) };
  }
  async function headBlock() {
    return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
  }
  /* Route entry: #/borrow — positions for the account + op-3 adjust + explainer. */
  function renderBorrow(root) {
    if (!root) return;
    var ctx = routeReady(root, "Borrow (Margin)", function () { renderBorrow(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    ctx.wrap.appendChild(el(doc, "p", "Margin positions borrow a bitasset against collateral. Topping up collateral or repaying debt adjusts op 3 (call_order_update) on your call order.", "muted"));
    var fAcct = field(doc, "Account", { placeholder: "blank = wallet account" });
    ctx.wrap.appendChild(fAcct.row);
    var go = touchable(el(doc, "button", "Load positions")); go.type = "button"; ctx.wrap.appendChild(go);
    var listBox = el(doc, "div"); ctx.wrap.appendChild(listBox);
    ctx.wrap.appendChild(el(doc, "h2", "Adjust position (op 3)"));
    var formBox = el(doc, "div"); ctx.wrap.appendChild(formBox);
    ctx.wrap.appendChild(el(doc, "h2", "How borrowing works"));
    ["1. Lock collateral (e.g. BTS) to open a call order against a bitasset (e.g. bitUSD).",
     "2. The chain must see a live price feed; falling below the maintenance ratio triggers a margin call.",
     "3. Top up collateral or repay debt any time with the adjust form — small steps only.",
     "4. Negative debt delta means borrowing MORE — it raises your liquidation risk."
    ].forEach(function (s) { ctx.wrap.appendChild(el(doc, "p", s, "muted")); });
    go.addEventListener("click", function () {
      if (myGen !== gen) return; go.disabled = true; clearBox(listBox); clearBox(formBox);
      showStatus(doc, listBox, "Loading positions…");
      Promise.resolve().then(async function () {
        var me = fAcct.input.value.trim() ? await Account.resolve(fAcct.input.value.trim())
          : await Account.resolve(await Account.myAccountId());
        var rows = await Credit.positions(me.id);
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
        if (myGen !== gen) return; clearBox(listBox); showError(doc, listBox, e, "Could not load positions.");
      }).then(function () { go.disabled = false; });
    });
    Account.myAccountId().then(function (id) {
      if (myGen === gen) { fAcct.input.value = id; go.click(); }
    }).catch(function () { /* manual account entry remains */ });
  }
  /* Positions table (desktop) + cards (phone); TCR at divisor 1000. */
  function posTable(doc, rows) {
    var box = el(doc, "div");
    var table = doc.createElement("table"); table.className = "node-table";
    var hr = doc.createElement("tr");
    ["Order", "Collateral", "Debt", "Target ratio", ""].forEach(function (t) {
      var th = doc.createElement("th"); th.textContent = t; hr.appendChild(th); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    rows.forEach(function (p) {
      var tr = doc.createElement("tr");
      var c = amt(p.coll_raw, p.coll_prec, p.coll_sym, p.coll_id);
      var d = amt(p.debt_raw, p.debt_prec, p.debt_sym, p.debt_id);
      var tcr = (p.tcr_units === null || p.tcr_units === undefined) ? "—" : Credit.tcrUnitsToHuman(p.tcr_units) + "%";
      [[p.call_id], [c.text, c.raw], [d.text, d.raw], [tcr]].forEach(function (x) {
        var td = el(doc, "td", x[0]); if (x[1]) td.title = "raw " + x[1]; tr.appendChild(td); });
      var link = doc.createElement("td");
      var a = el(doc, "a", "Market"); a.setAttribute("href", "#/market/" + p.coll_sym + "_" + p.debt_sym);
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
    var selRow = el(doc, "div", null, "xfer-field"), selLab = el(doc, "label", "Position ");
    selLab.appendChild(sel); selRow.appendChild(selLab); box.appendChild(selRow);
    var fColl = field(doc, "Delta collateral (signed, collateral asset)", { placeholder: "+1.0 adds, -1.0 removes", inputmode: "decimal" });
    var fDebt = field(doc, "Delta debt (signed, debt asset)", { placeholder: "-1.0 borrows MORE (risk!)", inputmode: "decimal" });
    var fTcr = field(doc, "Target ratio % (blank = unchanged)", { placeholder: "e.g. 175", inputmode: "decimal" });
    [fColl, fDebt, fTcr].forEach(function (f) { box.appendChild(f.row); });
    box.appendChild(el(doc, "p", "Warning: a negative debt delta borrows more against the same collateral and moves the position closer to margin call.", "muted"));
    var btn = touchable(el(doc, "button", "Review adjust")); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    btn.addEventListener("click", function () {
      if (myGen !== gen) return;
      clearBox(out); btn.disabled = true;
      showStatus(doc, out, "Resolving and estimating fee…");
      Promise.resolve().then(async function () {
        var pos = null;
        positions.forEach(function (p) { if (p.call_id === sel.value) pos = p; });
        if (!pos) throw new Error("unknown-position");
        var cPrec = (pos.coll_prec === null || pos.coll_prec === undefined) ? (await Asset.describe(pos.coll_id)).precision : pos.coll_prec;
        var dPrec = (pos.debt_prec === null || pos.debt_prec === undefined) ? (await Asset.describe(pos.debt_id)).precision : pos.debt_prec;
        function signed(v, prec) {
          v = String(v || "0").trim() || "0";
          var neg = v.charAt(0) === "-";
          return (neg ? "-" : "") + Format.parseAmount(neg ? v.slice(1) : v, prec);
        }
        var collRaw = signed(fColl.input.value, cPrec), debtRaw = signed(fDebt.input.value, dPrec);
        if (collRaw === "0" && debtRaw === "0" && !fTcr.input.value.trim()) throw new Error("adjust needs ≥1 change.");
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
          out.appendChild(el(doc, "h3", "Confirm margin adjust"));
          out.appendChild(confirmList(doc, [
            ["Account", me.name + " (" + me.id + ")"], ["Order", R.pos.call_id],
            ["Delta collateral", (op.delta_collateral.amount.charAt(0) === "-" ? "" : "+") + Format.formatAmount(op.delta_collateral.amount, R.cPrec), "raw " + op.delta_collateral.amount],
            ["Delta debt", (op.delta_debt.amount.charAt(0) === "-" ? "" : "+") + Format.formatAmount(op.delta_debt.amount, R.dPrec) + (op.delta_debt.amount.charAt(0) === "-" ? " — NEW DEBT, warned" : ""), "raw " + op.delta_debt.amount],
            ["Target ratio", tcrRow], ["Fee", feeHuman, "raw " + String(R.fee.amount)], ["Network", "testnet"]]));
          var back = touchable(el(doc, "button", "Back")); back.type = "button";
          var send = touchable(el(doc, "button", "Sign & Send")); send.type = "button";
          out.appendChild(back); out.appendChild(send);
          back.addEventListener("click", function () { clearBox(out); btn.disabled = false; });
          send.addEventListener("click", function () {
            if (myGen !== gen) return; send.disabled = true; back.disabled = true;
            var status = showStatus(doc, out, "Broadcasting…");
            var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
            if (!wif) { out.removeChild(status); showError(doc, out, new Error("wallet-locked")); send.disabled = false; back.disabled = false; return; }
            Tx.buildTx([R.pair]).then(function (unsigned) {
              return Credit.sendAndProve(unsigned, wif, async function () {
                try {
                  var rows = await Credit.positions(me.id);
                  for (var i = 0; i < rows.length; i++) if (rows[i].call_id === R.pos.call_id) return rows[i];
                } catch (e) { return null; } return null;
              });
            }).then(async function (res) {
              if (myGen !== gen) return; clearBox(out);
              out.appendChild(el(doc, "p", "Adjust broadcast.", "xfer-ok"));
              out.appendChild(el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
              btn.disabled = false;
            }).catch(function (e) {
              if (myGen !== gen) return; out.removeChild(status);
              showError(doc, out, e, "Failed. Check state before retrying (do NOT blindly rebroadcast).");
              send.disabled = false; back.disabled = false;
            });
          });
          btn.disabled = false;
        });
      }).catch(function (e) {
        if (myGen !== gen) return; clearBox(out);
        showError(doc, out, e, "Could not prepare the adjust."); btn.disabled = false;
      });
    });
  }

  return { renderBorrow: renderBorrow };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.BorrowUI === "undefined") { globalThis.BorrowUI = BorrowUI; }
if (typeof module !== "undefined") { module.exports = BorrowUI; }
