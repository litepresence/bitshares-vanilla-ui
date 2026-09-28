/* pool-ui.js — #/pools pools list + create form + shared _ui helpers.
 * Owns: pool table + filters + my-pools, op-59 create form with orientation
 *   preview, and the shared DOM/confirm helpers (PoolUI._ui) reused by
 *   pool-detail-ui.js (#/pools/:id desk) and pool-swap-ui.js (#/swap). No money
 *   math here (Pool builders do it); no serializers (tx.js owns bytes). WIFs
 *   are JS values, never DOM. Unknown ids -> empty state, never blank.
 *   PUBLIC-FIRST: routeReady never gates on unlock (list/detail/quote render
 *   locked); reviewSection gates write reviews at click with an unlock notice;
 *   locked account reads default to committee-account 1.2.0 with a notice.
 * Consumes: Pool (list/mine/buildCreate/fee/sendAndProve/percent helpers),
 *   Tx.buildTx, Format (human strings only), Account (resolve/myAccountId),
 *   Asset.describe (symbols + precisions), Wallet (unlock + memory WIF),
 *   Chain/Store (status). Created by: building-vanilla-slices skill,
 *   slice-12-pools plan Task 3 (split: detail desk lives in pool-detail-ui.js
 *   so every file stays <=400 lines).
 * CHAIN TRUTH (#4 wins): op fields <- protocol/liquidity_pool.hpp; validate traps
 *   (a<b id order, withdrawal->0-only) enforced by builders client-side; percents
 *   u16 hundredths (150 -> 1.5%) via Pool.pctUnitsToHuman; fees live via Tx.fee.
 */
var PoolUI = (function () {
  "use strict";
  var gen = 0;
  var openSubs = [];
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text; return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(box) { while (box.firstChild) box.removeChild(box.firstChild); }
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (m.indexOf("not-connected") !== -1) m = "Network unavailable. Check Settings → Nodes and retry.";
    if (m.indexOf("wallet-locked") !== -1) m = "Wallet is locked.";
    if (m.indexOf("unknown-pool") !== -1) m = "Unknown pool.";
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function offlineBox(doc, wrap, retryFn) {
    wrap.appendChild(el(doc, "p", "Network unavailable. Check Settings → Nodes and retry.", "muted"));
    var b = touchable(el(doc, "button", "Retry")); b.type = "button";
    b.addEventListener("click", retryFn); wrap.appendChild(b);
  }
  function unlockBox(doc, wrap, retry) {
    wrap.appendChild(el(doc, "p", "Wallet is locked. Enter your password to continue.", "muted"));
    var inp = doc.createElement("input"); inp.type = "password"; touchable(inp); wrap.appendChild(inp);
    var b = touchable(el(doc, "button", "Unlock")); b.type = "button"; wrap.appendChild(b);
    b.addEventListener("click", function () { b.disabled = true;
      Wallet.unlock(inp.value).then(retry).catch(function (e) { b.disabled = false; showError(doc, wrap, e, "Unlock failed."); });
    });
  }
  /* Default viewing account while locked: committee-account 1.2.0 (a public
   * chain object on testnet+mainnet). Reads stay public under it; writes gate
   * at review click (reviewSection). Never throws — locked render is normal. */
  var VIEWING_AS_ID = "1.2.0", VIEWING_AS_NAME = "committee-account";
  function isUnlockedNow() {
    try {
      if (typeof Wallet !== "undefined" && typeof Wallet.isUnlocked === "function") return !!Wallet.isUnlocked();
      return !!(typeof Wallet !== "undefined" && Wallet.keys);
    } catch (e) { return false; }
  }
  function viewingAsNotice(doc) {
    return el(doc, "p", "Viewing as " + VIEWING_AS_NAME + " (" + VIEWING_AS_ID + ") — unlock to act as your account.", "muted");
  }
  function dropSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }
  function autoRetry(myGen, retryFn) {
    try {
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) { settled = true; try { off(); } catch (e) {} return; }
        if (st && st.state === "open") { settled = true; try { off(); } catch (e) {}
          if (typeof location === "undefined" || location.hash === hashAtEntry) retryFn(); }
      });
      openSubs.push(off);
    } catch (e) { /* manual Retry remains */ }
  }
  function routeReady(root, title, retry) {
    var doc = root.ownerDocument || document, myGen = ++gen, miss = null;
    dropSubs(); root.innerHTML = "";
    ["Pool", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"].forEach(function (g) {
      if (typeof globalThis[g] === "undefined") miss = g; });
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", title));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") { offlineBox(doc, wrap, retry); autoRetry(myGen, retry); return null; }
    /* PUBLIC-FIRST: no wallet gate here — list/detail/quote render locked.
     * Write paths gate at review click (reviewSection) with an unlock notice. */
    return { doc: doc, wrap: wrap, myGen: myGen };
  }
  function routeFail(root, title, e, retry) {
    root.innerHTML = "";
    var doc = root.ownerDocument || document, box = el(doc, "div", null, "wrap");
    root.appendChild(box); box.appendChild(el(doc, "h1", title));
    showError(doc, box, e, "Could not load pools."); offlineBox(doc, box, retry);
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
    touchable(input);
    var suffix = null;
    if (opts.unit) {
      var wrap = doc.createElement("span"); wrap.className = "unit-wrap";
      wrap.appendChild(input);
      suffix = el(doc, "span", opts.unit, "unit-suffix");
      wrap.appendChild(suffix);
      label.appendChild(wrap);
    } else {
      label.appendChild(input);
    }
    row.appendChild(label); return { row: row, input: input, suffix: suffix };
  }
  function tableHead(doc, titles) {
    var hr = doc.createElement("tr");
    titles.forEach(function (t) { hr.appendChild(el(doc, "th", t)); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); return thead;
  }
  async function feeText(fee) { /* live fee -> human + raw title (lookup miss stays honest) */
    try {
      var a = await Asset.describe(fee.asset_id);
      return { text: Format.formatAmount(fee.amount, a.precision) + " " + a.symbol, raw: String(fee.amount) };
    } catch (e) { return { text: String(fee.amount) + " (" + fee.asset_id + ")", raw: String(fee.amount) }; }
  }
  async function headBlock() {
    return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
  }
  function amtText(raw, assetId, prec, sym) { /* raw int -> human + raw title; unknown prec stays honest */
    if (typeof prec === "number" && /^\d+$/.test(String(raw)))
      return { text: Format.formatAmount(String(raw), prec) + (sym ? " " + sym : ""), raw: String(raw) };
    return { text: String(raw) + " (" + assetId + ")", raw: String(raw) };
  }
  function pctText(u) { return Pool.pctUnitsToHuman(u) + "%"; } /* u16 hundredths -> "1.5%" */
  function whoText(me) { return me.name + " (" + me.id + ")"; }
  function sendConfirm(doc, out, cfg, myGen) { /* confirm + publish: fresh-WIF sign, re-read proof, result */
    clearBox(out);
    out.appendChild(el(doc, "h3", cfg.title)); out.appendChild(confirmList(doc, cfg.rows));
    var back = touchable(el(doc, "button", "Back")); back.type = "button";
    var send = touchable(el(doc, "button", "Sign & Send")); send.type = "button";
    out.appendChild(back); out.appendChild(send);
    back.addEventListener("click", function () { clearBox(out); });
    send.addEventListener("click", function () {
      if (myGen !== gen) return; send.disabled = true; back.disabled = true;
      var status = showStatus(doc, out, "Signing…");
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) { out.removeChild(status); showError(doc, out, new Error("wallet-locked")); send.disabled = false; back.disabled = false; return; }
      Promise.resolve().then(cfg.makeUnsigned).then(function (unsigned) {
        status.textContent = "Broadcasting…";
        return Pool.sendAndProve(unsigned, wif, cfg.prove);
      }).then(async function (res) {
        if (myGen !== gen) return; clearBox(out);
        out.appendChild(el(doc, "p", cfg.okText, "xfer-ok"));
        out.appendChild(el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
      }).catch(function (e) {
        if (myGen !== gen) return; out.removeChild(status);
        showError(doc, out, e, "Failed. Check state before retrying (do NOT blindly rebroadcast).");
        send.disabled = false; back.disabled = false;
      });
    });
  }
  function reviewPaid(doc, out, myGen, cfg) { /* build {pair,fee,prove} + live fee -> rows -> sendConfirm */
    clearBox(out); if (cfg.btn) cfg.btn.disabled = true;
    showStatus(doc, out, "Resolving and estimating fee…");
    function done() { if (cfg.btn) cfg.btn.disabled = false; }
    Promise.resolve().then(cfg.build).then(function (built) {
      if (myGen !== gen) return done();
      feeText(built.fee).then(function (f) {
        if (myGen !== gen) return done();
        sendConfirm(doc, out, { title: cfg.title, rows: cfg.rows(built, f),
          makeUnsigned: function () { return Tx.buildTx([built.pair]); },
          prove: built.prove, okText: cfg.ok(built) }, myGen);
        done();
      }).catch(function (e) { if (myGen === gen) { clearBox(out); showError(doc, out, e, "Fee lookup failed."); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      clearBox(out); showError(doc, out, e, cfg.fail || "Could not prepare the transaction."); done();
    });
  }
  function reviewSection(doc, box, myGen, label, cfg) {
    var btn = touchable(el(doc, "button", label)); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    cfg.btn = btn;
    /* SIGN-TIME GATE: password asked only here, never at render. A locked
     * click shows an honest notice + inline unlock; success flows into review
     * (read-only until the user presses Sign & Send). */
    btn.addEventListener("click", function () {
      if (myGen !== gen) return;
      if (!isUnlockedNow()) {
        clearBox(out);
        out.appendChild(el(doc, "p", "Unlock to act — signing needs your wallet password.", "muted"));
        unlockBox(doc, out, function () { if (myGen === gen) reviewPaid(doc, out, myGen, cfg); });
        return;
      }
      reviewPaid(doc, out, myGen, cfg);
    });
    return btn;
  }
  /* assetLink: symbol -> #/asset/:symbol anchor (existing route; join misses
   * link by bare id, which the asset view also resolves). textContent only. */
  function assetLink(doc, sym) {
    var a = el(doc, "a", sym);
    a.setAttribute("href", "#/asset/" + sym);
    return a;
  }
  function poolTable(doc, rows) { /* dexux-ref density: POOL ID / SHARE / A /
    *   A QTY / B / B QTY / TAKER / WITHDRAWAL / EXCHANGE (swap) / STAKE.
    *   EXCHANGE + STAKE both open the detail desk (#/pools/:id), which owns
    *   the inline swap and stake panels — the list stays a list. */
    if (!rows.length) return el(doc, "p", "No pools found.", "muted");
    var table = doc.createElement("table"); table.className = "node-table pools-table";
    table.appendChild(tableHead(doc, ["Pool ID", "Share asset", "Asset A", "Asset A qty",
      "Asset B", "Asset B qty", "Taker fee", "Withdrawal fee", "Exchange", "Stake/Unstake"]));
    var tbody = doc.createElement("tbody");
    rows.forEach(function (r) {
      var tr = doc.createElement("tr");
      /* Qty cells are bare numbers (the A/B columns already name the
       * assets — dexux-ref density); raw integers stay in title. */
      var aA = amtText(r.balance_a_raw, r.asset_a_id, r.prec_a, null);
      var aB = amtText(r.balance_b_raw, r.asset_b_id, r.prec_b, null);
      tr.appendChild(el(doc, "td", r.id));
      var tdS = doc.createElement("td"); tdS.appendChild(assetLink(doc, r.sym_share)); tr.appendChild(tdS);
      var tdA = doc.createElement("td"); tdA.appendChild(assetLink(doc, r.sym_a)); tr.appendChild(tdA);
      var cA = el(doc, "td", aA.text, "num"); cA.title = "raw " + aA.raw; tr.appendChild(cA);
      var tdB = doc.createElement("td"); tdB.appendChild(assetLink(doc, r.sym_b)); tr.appendChild(tdB);
      var cB = el(doc, "td", aB.text, "num"); cB.title = "raw " + aB.raw; tr.appendChild(cB);
      tr.appendChild(el(doc, "td", pctText(r.taker_units), "num"));
      tr.appendChild(el(doc, "td", pctText(r.withdrawal_units), "num"));
      var tdX = doc.createElement("td");
      /* Icon wiring (swap.svg; #1 pools table shows ⇄ in EXCHANGE). href,
       * aria-label, and title unchanged — skin only; without Icon the ⇄
       * text renders so the link is never blank. */
      var xl = doc.createElement("a");
      try {
        if (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function") {
          xl.appendChild(Icon.img("swap", "cell-icon", ""));
        } else {
          xl.textContent = "⇄";
        }
      } catch (e) {
        xl.textContent = "⇄";
      }
      xl.setAttribute("href", "#/pools/" + r.id);
      xl.setAttribute("aria-label", "Swap in pool " + r.id);
      xl.title = "Swap in this pool";
      tdX.appendChild(xl); tr.appendChild(tdX);
      var tdSt = doc.createElement("td");
      var sl = el(doc, "a", "Stake"); sl.setAttribute("href", "#/pools/" + r.id);
      sl.setAttribute("aria-label", "Stake or unstake in pool " + r.id);
      tdSt.appendChild(sl); tr.appendChild(tdSt);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); return table;
  }
  /* Route entry: #/pools — filters + pool table + my-pools + create form.
   * Pager: page-size select (10/25/50, default 10 like the ref) + Prev/Next +
   * "Page N". No numbered pages: the chain exposes no pool count, so totals
   * are not invented — hasNext comes from fetching one row over the page.
   * startId paging is inclusive on most nodes, so a leading duplicate of the
   * previous page's last row is dropped (over-fetch of 2 covers it). */
  function renderPools(root) {
    if (!root) return;
    var ctx = routeReady(root, "Liquidity Pools", function () { renderPools(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    /* Wide wrap (mkt-wrap, detail-desk precedent): the 10-col dense table
     * needs room; the plain 720px wrap would force scrolling at desktop. */
    ctx.wrap.className = "wrap mkt-wrap";
    ctx.wrap.appendChild(el(doc, "p", "CPMM pools (x*y=k). Stake is a deposit of both legs for LP shares.", "muted"));
    var pager = { page: 0, size: 10, starts: ["1.19.0"] };
    var filters = el(doc, "div", null, "pools-filters");
    var fA = field(doc, "Asset A", { placeholder: "symbol or 1.3.x" });
    var fB = field(doc, "Asset B", { placeholder: "symbol or 1.3.x" });
    var fS = field(doc, "Share asset", { placeholder: "symbol or 1.3.x" });
    [fA, fB, fS].forEach(function (f) { filters.appendChild(f.row); });
    var sizeLab = el(doc, "label", "Per page ");
    var sizeSel = doc.createElement("select");
    ["10", "25", "50"].forEach(function (n) {
      var o = doc.createElement("option");
      o.value = n; o.textContent = n;
      if (n === "10") o.selected = true;
      sizeSel.appendChild(o);
    });
    touchable(sizeSel);
    sizeLab.appendChild(sizeSel);
    var sizeWrap = el(doc, "div", null, "xfer-field");
    sizeWrap.appendChild(sizeLab);
    filters.appendChild(sizeWrap);
    var go = touchable(el(doc, "button", "List pools")); go.type = "button";
    filters.appendChild(go);
    ctx.wrap.appendChild(filters);
    var listBox = el(doc, "div"); ctx.wrap.appendChild(listBox);
    var mineBox = el(doc, "div");
    ctx.wrap.appendChild(el(doc, "h2", "My pools"));
    ctx.wrap.appendChild(mineBox);
    ctx.wrap.appendChild(el(doc, "h2", "Create pool"));
    ctx.wrap.appendChild(el(doc, "p", "Needs a zero-supply non-smartcoin share asset. Create one at #/assets/create first.", "muted"));
    createBox(doc, ctx.wrap, myGen);
    async function resolveOpt(v) {
      v = String(v || "").trim(); if (!v) return null;
      return Asset.describe(v);
    }
    /* pagerBar: Prev / "Page N" / Next. Next stores the page's last id as
     * the following page's startId (list_* paging has no offsets). */
    function pagerBar(pageRows, hasNext) {
      var bar = el(doc, "div", null, "pools-pager");
      var prev = touchable(el(doc, "button", "‹ Prev")); prev.type = "button";
      prev.disabled = pager.page === 0;
      var note = el(doc, "span", "Page " + (pager.page + 1), "pools-page");
      var next = touchable(el(doc, "button", "Next ›")); next.type = "button";
      next.disabled = !hasNext;
      prev.addEventListener("click", function () {
        if (myGen !== gen || pager.page === 0) return;
        pager.page -= 1;
        loadPage();
      });
      next.addEventListener("click", function () {
        if (myGen !== gen || !hasNext || !pageRows.length) return;
        pager.page += 1;
        pager.starts[pager.page] = pageRows[pageRows.length - 1].id;
        loadPage();
      });
      bar.appendChild(prev); bar.appendChild(note); bar.appendChild(next);
      return bar;
    }
    function loadPage() {
      if (myGen !== gen) return; go.disabled = true; clearBox(listBox);
      showStatus(doc, listBox, "Loading pools…");
      Promise.resolve().then(async function () {
        var a = await resolveOpt(fA.input.value), b = await resolveOpt(fB.input.value), s = await resolveOpt(fS.input.value);
        var rows = await Pool.list({ assetA: a ? a.id : null, assetB: b ? b.id : null,
          share: s ? s.id : null, limit: pager.size + 2, startId: pager.starts[pager.page] });
        return rows || [];
      }).then(function (rows) {
        if (myGen !== gen) return; clearBox(listBox);
        /* Drop the inclusive-start duplicate of the previous page's tail. */
        if (pager.page > 0 && rows.length && rows[0].id === pager.starts[pager.page]) rows.shift();
        var hasNext = rows.length > pager.size;
        var pageRows = hasNext ? rows.slice(0, pager.size) : rows;
        var scroller = el(doc, "div", null, "pools-scroll");
        scroller.appendChild(poolTable(doc, pageRows));
        listBox.appendChild(scroller);
        listBox.appendChild(pagerBar(pageRows, hasNext));
      }).catch(function (e) {
        if (myGen !== gen) return; clearBox(listBox); showError(doc, listBox, e, "Could not load pools.");
      }).then(function () { go.disabled = false; });
    }
    function resetAndLoad() {
      if (myGen !== gen) return;
      pager.page = 0; pager.starts = ["1.19.0"];
      loadPage();
    }
    go.addEventListener("click", resetAndLoad);
    sizeSel.addEventListener("change", function () {
      var n = parseInt(sizeSel.value, 10);
      pager.size = (n === 25 || n === 50) ? n : 10;
      resetAndLoad();
    });
    /* Public list loads locked or not. Mine resolves the wallet account when
     * unlocked, else defaults to committee-account 1.2.0 with an honest
     * notice — both are public get_liquidity_pools_by_owner reads, never throws. */
    loadPage();
    (function () {
      var locked = !isUnlockedNow();
      var idP = locked ? Promise.resolve(VIEWING_AS_ID) : Account.myAccountId();
      idP.then(function (id) { return Account.resolve(id); }).then(function (me) {
        if (myGen !== gen) return;
        if (locked) mineBox.appendChild(viewingAsNotice(doc));
        Pool.mine(me.id).then(function (rows) {
          if (myGen !== gen) return; mineBox.appendChild(poolTable(doc, rows));
        }).catch(function () { if (myGen === gen) { mineBox.appendChild(el(doc, "p", "No owned pools.", "muted")); } });
      }).catch(function (e) { if (myGen === gen) showError(doc, ctx.wrap, e, "Could not load your account."); });
    })();
  }
  function createBox(doc, box, myGen) { /* op-59 create: a/b/share resolves, human percents, orientation preview */
    var fA = field(doc, "Asset A", { placeholder: "BTS" });
    var fB = field(doc, "Asset B", { placeholder: "CNY" });
    var fSh = field(doc, "Share asset", { placeholder: "fresh UIA symbol" });
    var fT = field(doc, "Taker fee %", { value: "0.5", inputmode: "decimal" });
    var fW = field(doc, "Withdrawal fee %", { value: "0", inputmode: "decimal" });
    [fA, fB, fSh, fT, fW].forEach(function (f) { box.appendChild(f.row); });
    reviewSection(doc, box, myGen, "Review create", {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var a = await Asset.describe(fA.input.value.trim()), b = await Asset.describe(fB.input.value.trim());
        var sh = await Asset.describe(fSh.input.value.trim());
        var pair = Pool.buildCreate({ accountId: me.id, assetAId: a.id, assetBId: b.id,
          shareId: sh.id, takerHuman: fT.input.value.trim(), withdrawalHuman: fW.input.value.trim() });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me, a: a, b: b, sh: sh,
          prove: async function () {
            try {
              var rows = await Pool.list({ share: sh.id });
              return rows.length ? rows[0] : null;
            } catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        return [["Account", whoText(R.me)], ["Asset A", R.a.symbol + " (" + R.a.id + ")"],
          ["Asset B", R.b.symbol + " (" + R.b.id + ")"], ["Share asset", R.sh.symbol + " (" + R.sh.id + ")"],
          ["Orientation", "A < B by id: " + op.asset_a + " / " + op.asset_b],
          ["Taker fee", pctText(op.taker_fee_percent), "raw " + op.taker_fee_percent],
          ["Withdrawal fee", pctText(op.withdrawal_fee_percent), "raw " + op.withdrawal_fee_percent],
          ["Fee", fee.text, "raw " + fee.raw], ["Network", "testnet"]];
      },
      title: "Confirm pool create", ok: function () { return "Pool created."; }, fail: "Could not prepare the create." });
  }
  return { renderPools: renderPools,
    _ui: { el: el, touchable: touchable, clearBox: clearBox, showError: showError, showStatus: showStatus,
      offlineBox: offlineBox, unlockBox: unlockBox, confirmList: confirmList, field: field, tableHead: tableHead,
      feeText: feeText, headBlock: headBlock, amtText: amtText, pctText: pctText,
      sendConfirm: sendConfirm, reviewPaid: reviewPaid, reviewSection: reviewSection,
      routeReady: routeReady, routeFail: routeFail, autoRetry: autoRetry, dropSubs: dropSubs,
      isUnlockedNow: isUnlockedNow, viewingAsNotice: viewingAsNotice, viewingAsId: VIEWING_AS_ID,
      live: function (g) { return g === gen; } } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolUI === "undefined") { globalThis.PoolUI = PoolUI; }
if (typeof module !== "undefined") { module.exports = PoolUI; }
