/* borrow-ui.js — #/borrow margin positions + op-3 adjust form + op-45
 * settlement bids (split OUT of credit-ui.js).
 * Owns: margin positions table for an account (collateral/debt human both legs,
 *   call price, TCR at the proven divisor 1000) + op-3 call_order_update adjust
 *   form (signed delta-collateral / delta-debt, optional TCR, live fee, named-row
 *   confirm) + op-45 bid_collateral section (asset-driven: settlement-fund
 *   gate, existing-bids table, bid form with live fee + named-row confirm +
 *   bid-list re-read proof) + short margin explainer (port the WORDS of #1
 *   Showcases/Borrow.jsx steps, not its stepper chrome). No safe position ->
 *   adjust form client-gated with an honest note (ambiguity H): positions READ
 *   is always offered, the broadcast only against an existing position.
 *   No settlement fund -> bid form client-gated the same way (C27): the READ
 *   (fund + bids) is always offered, the broadcast only against a live fund.
 *   No money math here (Credit builders + Format do it); no serializers
 *   (tx.js owns bytes).
 * Consumes: Credit (positions/positionsMethod reads, buildCallUpdate, tcr/fee
 *   helpers, fee/sendAndProve), Tx.buildTx, Format, Account, Asset.describe,
 *   Wallet, Chain/Store. Created by: building-vanilla-slices skill,
 *   slice-13-credit plan Task 3 (pre-authorized split — credit-ui.js cap);
 *   op-45 section appended by the C27/C29 deferred-matrix closeout.
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
    settleSection(doc, ctx.wrap, myGen);
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
        /* Signed decimal input -> signed raw int string ("-1.5" -> "-" + parseAmount("1.5")). Params: v (input), prec. */
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

  /* C27 settlement-bid section (op 45 bid_collateral, BSIP-0018). ASSET-driven,
   * not position-driven: borrow-ui positions carry no RSQ/call-ratio field, so
   * there is no per-position bid gate to read — the chain gate is the 2.4.x
   * bitasset's settlement_fund (> 0 means globally settled, fund exists).
   * Layout: asset input + Check button, then fund line + existing-bids table
   * (get_collateral_bids) always, bid form only while a fund exists. */
  function settleSection(doc, wrap, myGen) {
    wrap.appendChild(el(doc, "h2", "Settlement bids (op 45)"));
    wrap.appendChild(el(doc, "p", "After a bitasset globally settles, anyone can bid collateral to take over part of the debt and the settlement fund (BSIP-0018). Enter the settled asset: the fund and existing bids always read; the bid form appears only while a settlement fund exists.", "muted"));
    var fAsset = field(doc, "Settled asset (symbol or 1.3.x)", { placeholder: "e.g. bitUSD" });
    wrap.appendChild(fAsset.row);
    var chk = touchable(el(doc, "button", "Check settlement fund")); chk.type = "button";
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
    if (!input) { showError(doc, box, new Error("unknown-asset"), "Enter a bitasset symbol or id first."); return; }
    showStatus(doc, box, "Resolving asset and settlement fund…");
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
      fundLine.title = "raw " + R.fundRaw;
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
        box.appendChild(el(doc, "p", "Unexpected asset data from the node; stopped instead of guessing.", "muted"));
        return;
      }
      bidBox(doc, box, myGen, R);
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearBox(box);
      showError(doc, box, e, "Could not load the settlement fund.");
    });
  }
  /* Existing-bids table (desktop) + phone cards; legs human via the joined
   * precisions, raw integers in title (never shown bare). Empty -> honest note. */
  function bidsTable(doc, bids, R) {
    var box = el(doc, "div");
    if (!bids || !bids.length) {
      box.appendChild(el(doc, "p", "No collateral bids on " + R.asset.symbol + " yet.", "muted"));
      return box;
    }
    var table = doc.createElement("table"); table.className = "node-table";
    var hr = doc.createElement("tr");
    ["Bidder", "Collateral", "Debt covered"].forEach(function (t) {
      var th = doc.createElement("th"); th.textContent = t; hr.appendChild(th); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    bids.forEach(function (b) {
      var tr = doc.createElement("tr");
      var bidder = doc.createElement("td"); bidder.textContent = b.bidder || "—"; tr.appendChild(bidder);
      var inv = b.additional_collateral || {}, debt = b.debt_covered || {};
      var c = doc.createElement("td");
      c.textContent = Format.formatAmount(String(inv.amount), R.backingPrec);
      c.title = "raw " + String(inv.amount);
      tr.appendChild(c);
      var d = doc.createElement("td");
      d.textContent = Format.formatAmount(String(debt.amount), R.debtPrec);
      d.title = "raw " + String(debt.amount);
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
    box.appendChild(el(doc, "h3", "Place a bid"));
    var fBidder = field(doc, "Bidder (blank = wallet account)", { placeholder: "blank = wallet account" });
    var fColl = field(doc, "Collateral (" + R.backingId + " units)", { placeholder: "e.g. 10.0", inputmode: "decimal" });
    var fDebt = field(doc, "Debt to cover (" + R.asset.symbol + " units)", { placeholder: "e.g. 5.0", inputmode: "decimal" });
    [fBidder, fColl, fDebt].forEach(function (f) { box.appendChild(f.row); });
    box.appendChild(el(doc, "p", "A bid locks your collateral against the settlement fund; the chain matches it while reviving the asset. Both legs must be above zero.", "muted"));
    var btn = touchable(el(doc, "button", "Review bid")); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    Account.myAccountId().then(function (id) {
      if (myGen === gen && !fBidder.input.value) fBidder.input.value = id;
    }).catch(function () { /* manual bidder entry remains */ });
    btn.addEventListener("click", function () {
      if (myGen !== gen) return;
      clearBox(out); btn.disabled = true;
      showStatus(doc, out, "Resolving and estimating fee…");
      Promise.resolve().then(async function () {
        var bidderId = fBidder.input.value.trim() ? (await Account.resolve(fBidder.input.value.trim())).id
          : await Account.myAccountId();
        var collRaw = Format.parseAmount(fColl.input.value, R.backingPrec);
        var debtRaw = Format.parseAmount(fDebt.input.value, R.debtPrec);
        if (BigInt(collRaw) <= 0n || BigInt(debtRaw) <= 0n) {
          throw new Error("Both legs must be above zero (nonzero debt needs nonzero collateral).");
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
          out.appendChild(el(doc, "h3", "Confirm settlement bid"));
          out.appendChild(confirmList(doc, [
            ["Bidder", S.bidderId],
            ["Collateral", Format.formatAmount(S.collRaw, R.backingPrec) + " (" + R.backingId + ")", "raw " + S.collRaw],
            ["Debt covered", Format.formatAmount(S.debtRaw, R.debtPrec) + " " + R.asset.symbol, "raw " + S.debtRaw],
            ["Fund", Format.formatAmount(R.fundRaw, R.backingPrec), "raw " + R.fundRaw],
            ["Fee", feeHuman, "raw " + String(S.fee.amount)], ["Network", "testnet"]]));
          var back = touchable(el(doc, "button", "Back")); back.type = "button";
          var send = touchable(el(doc, "button", "Sign & Send")); send.type = "button";
          out.appendChild(back); out.appendChild(send);
          back.addEventListener("click", function () { clearBox(out); btn.disabled = false; });
          send.addEventListener("click", function () {
            if (myGen !== gen) return; send.disabled = true; back.disabled = true;
            var status = showStatus(doc, out, "Broadcasting…");
            var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
            if (!wif) { out.removeChild(status); showError(doc, out, new Error("wallet-locked")); send.disabled = false; back.disabled = false; return; }
            Tx.buildTx([S.pair]).then(function (unsigned) {
              return Credit.sendAndProve(unsigned, wif, async function () {
                try {
                  var dbId = await Chain.db();
                  return await Chain.call(dbId, "get_collateral_bids", [R.asset.id, 100, 0]);
                } catch (e) { return null; } return null;
              });
            }).then(async function (res) {
              if (myGen !== gen) return; clearBox(out);
              out.appendChild(el(doc, "p", "Bid broadcast.", "xfer-ok"));
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
        showError(doc, out, e, "Could not prepare the bid."); btn.disabled = false;
      });
    });
  }

  return { renderBorrow: renderBorrow };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.BorrowUI === "undefined") { globalThis.BorrowUI = BorrowUI; }
if (typeof module !== "undefined") { module.exports = BorrowUI; }
