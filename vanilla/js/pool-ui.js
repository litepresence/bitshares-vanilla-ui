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

  /* Batch-2d i18n (slice-17 precedent): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. Dynamic sentences keep
   * their code structure (batch-2b precedent): only complete static literals and
   * word-bearing segments are wrapped, values and punctuation glue stay raw, so
   * every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }
  var gen = 0;
  var openSubs = [];
  /* Page-sort (honest scope): the chain offers no sorted pool endpoint, so
   * sortable headers reorder the LOADED page only, never the chain. */
  var sortKey = "id", sortDir = 1;
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text; return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(box) { while (box.firstChild) box.removeChild(box.firstChild); }
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || t("fees.unexpected_error", "Unexpected error"));
    if (m.indexOf("not-connected") !== -1) m = t("fees.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    if (m.indexOf("wallet-locked") !== -1) m = t("debit.s2", "Wallet is locked.");
    if (m.indexOf("unknown-pool") !== -1) m = t("pool.unknown_pool", "Unknown pool.");
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function offlineBox(doc, wrap, retryFn) { /* Retry panel: copy depends on
    * actual connection (unknown-id failures while connected must not claim
    * the network is down). */
    var open = (typeof Chain !== "undefined" && Chain && Chain.status && Chain.status().state === "open");
    wrap.appendChild(el(doc, "p", open
      ? t("pool.retry_load", "Retry loading.")
      : t("fees.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
    var b = touchable(el(doc, "button", t("fees.retry", "Retry"))); b.type = "button";
    b.addEventListener("click", retryFn); wrap.appendChild(b);
  }
  function unlockBox(doc, wrap, retry) {
    wrap.appendChild(el(doc, "p", t("barter.wallet_is_locked_enter_your_password_to_conti", "Wallet is locked. Enter your password to continue."), "muted"));
    var inp = doc.createElement("input"); inp.type = "password"; touchable(inp); wrap.appendChild(inp);
    var b = touchable(el(doc, "button", t("account.s6", "Unlock"))); b.type = "button"; wrap.appendChild(b);
    b.addEventListener("click", function () { b.disabled = true;
      /* H2: wipe the password local + input on either outcome. */
      var pw = inp.value;
      Wallet.unlock(pw).then(function () { inp.value = ""; pw = null; retry(); }).catch(function (e) { inp.value = ""; pw = null; b.disabled = false; showError(doc, wrap,e,t("barter.unlock_failed", "Unlock failed.")); });
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
    showError(doc, box,e,t("pool.load_failed", "Could not load pools.")); offlineBox(doc, box, retry);
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
    var back = touchable(el(doc, "button", t("barter.back", "Back"))); back.type = "button";
    var send = touchable(el(doc, "button", t("barter.sign_send", "Sign & Send"))); send.type = "button";
    out.appendChild(back); out.appendChild(send);
    back.addEventListener("click", function () { clearBox(out); });
    send.addEventListener("click", function () {
      if (myGen !== gen) return; send.disabled = true; back.disabled = true;
      var status = showStatus(doc, out, "Signing…");
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) { out.removeChild(status); showError(doc, out, new Error("wallet-locked")); send.disabled = false; back.disabled = false; return; }
      Promise.resolve().then(cfg.makeUnsigned).then(function (unsigned) {
        status.textContent = t("htlc.s2", "Broadcasting…");
        return Pool.sendAndProve(unsigned, wif, cfg.prove);
      }).then(async function (res) {
        if (myGen !== gen) return; clearBox(out);
        out.appendChild(el(doc, "p", cfg.okText, "xfer-ok"));
        out.appendChild(el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
      }).catch(function (e) {
        if (myGen !== gen) return; out.removeChild(status);
        showError(doc, out,e,t("account.upgrade_failed_hint", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
        send.disabled = false; back.disabled = false;
      });
    });
  }
  function reviewPaid(doc, out, myGen, cfg) { /* build {pair,fee,prove} + live fee -> rows -> sendConfirm */
    clearBox(out); if (cfg.btn) cfg.btn.disabled = true;
    showStatus(doc, out,t("account.resolving_fee", "Resolving and estimating fee…"));
    function done() { if (cfg.btn) cfg.btn.disabled = false; }
    Promise.resolve().then(cfg.build).then(function (built) {
      if (myGen !== gen) return done();
      feeText(built.fee).then(function (f) {
        if (myGen !== gen) return done();
        sendConfirm(doc, out, { title: cfg.title, rows: cfg.rows(built, f),
          makeUnsigned: function () { return Tx.buildTx([built.pair]); },
          prove: built.prove, okText: cfg.ok(built) }, myGen);
        done();
      }).catch(function (e) { if (myGen === gen) { clearBox(out); showError(doc, out,e,t("barter.fee_lookup_failed", "Fee lookup failed.")); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      clearBox(out); showError(doc, out, e, cfg.fail || t("credit.could_not_prepare_the_transaction", "Could not prepare the transaction.")); done();
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
        out.appendChild(el(doc, "p", t("pool.unlock_notice", "Unlock to act — signing needs your wallet password."), "muted"));
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
  function poolTable(doc, rows) { /* dexux-ref density: POOL ID / EXCHANGE /
    *   SHARE / A / A QTY / B / B QTY / TAKER / WITHDRAWAL. EXCHANGE opens the
    *   detail desk (#/pools/:id), which owns the inline swap and stake panels
    *   — the list stays a list (no separate STAKE column: same destination).
    *   Sort: Pool ID / Taker / Withdrawal headers toggle page-sort. */
    if (!rows.length) return el(doc, "p", t("pool.no_pools", "No pools found.") + " Create one from the Stake form on this desk — it needs a zero-supply share asset from #/assets/create first.", "muted");
    var view = rows.slice();
    function sortVal(r) {
      if (sortKey === "taker") return Number(r.taker_units) || 0;
      if (sortKey === "withdrawal") return Number(r.withdrawal_units) || 0;
      return String(r.id || "");
    }
    view.sort(function (a, b) {
      var x = sortVal(a), y = sortVal(b);
      if (x < y) return -1 * sortDir;
      if (x > y) return 1 * sortDir;
      return 0;
    });
    var table = doc.createElement("table"); table.className = "node-table pools-table";
    var hr = doc.createElement("tr");
    var cols = [
      { key: "id", label: t("pool.id_col", "Pool ID"), sortable: true },
      { key: null, label: t("pool.swap_stake_col", "Swap/Stake") },
      { key: null, label: t("pool.share_asset_field", "Share asset") },
      { key: null, label: t("pool.asset_a_field", "Asset A") },
      { key: null, label: t("pool.asset_a_qty_col", "Asset A qty") },
      { key: null, label: t("pool.asset_b_field", "Asset B") },
      { key: null, label: t("pool.asset_b_qty_col", "Asset B qty") },
      { key: "taker", label: t("pool.taker_row", "Taker fee"), sortable: true },
      { key: "withdrawal", label: t("pool.withdrawal_row", "Withdrawal fee"), sortable: true }
    ];
    cols.forEach(function (c) {
      var th = doc.createElement("th");
      if (c.sortable) {
        var b = doc.createElement("button");
        b.type = "button";
        b.className = "th-sort";
        b.textContent = c.label + (sortKey === c.key ? (sortDir === 1 ? " ▲" : " ▼") : "");
        b.setAttribute("aria-label", t("pool.sort_by", "Sort by ") + c.label);
        if (sortKey === c.key) th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
        touchable(b);
        b.addEventListener("click", function () {
          if (sortKey === c.key) sortDir = -1 * sortDir;
          else { sortKey = c.key; sortDir = 1; }
          var box = th;
          while (box && box.tagName !== "TABLE") box = box.parentElement;
          if (box && box.parentElement) {
            var fresh = poolTable(doc, rows);
            box.parentElement.replaceChild(fresh, box);
          }
        });
        th.appendChild(b);
      } else {
        th.textContent = c.label;
      }
      hr.appendChild(th);
    });
    var thead = doc.createElement("thead"); thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    view.forEach(function (r) {
      var tr = doc.createElement("tr");
      /* Qty cells are bare numbers (the A/B columns already name the
       * assets — dexux-ref density); raw integers stay in title. */
      var aA = amtText(r.balance_a_raw, r.asset_a_id, r.prec_a, null);
      var aB = amtText(r.balance_b_raw, r.asset_b_id, r.prec_b, null);
      tr.appendChild(el(doc, "td", r.id));
      /* EXCHANGE second: ⇄ text link in link blue (#1 shows ⇄ here; the
       * vendored swap.svg <img> cannot inherit link color, so text keeps
       * the column blue like every other link). href, aria-label, title
       * unchanged — skin only. */
      var tdX = doc.createElement("td");
      var xl = el(doc, "a", "⇄", "pools-xlink");
      xl.setAttribute("href", "#/pools/" + r.id);
      xl.setAttribute("aria-label", "Swap in pool " + r.id);
      xl.title = t("pool.swap_title_attr", "Swap in this pool");
      tdX.appendChild(xl); tr.appendChild(tdX);
      var tdS = doc.createElement("td"); tdS.appendChild(assetLink(doc, r.sym_share)); tr.appendChild(tdS);
      var tdA = doc.createElement("td"); tdA.appendChild(assetLink(doc, r.sym_a)); tr.appendChild(tdA);
      var cA = el(doc, "td", aA.text, "num"); cA.title = "raw " + aA.raw; tr.appendChild(cA);
      var tdB = doc.createElement("td"); tdB.appendChild(assetLink(doc, r.sym_b)); tr.appendChild(tdB);
      var cB = el(doc, "td", aB.text, "num"); cB.title = "raw " + aB.raw; tr.appendChild(cB);
      tr.appendChild(el(doc, "td", pctText(r.taker_units), "num"));
      tr.appendChild(el(doc, "td", pctText(r.withdrawal_units), "num"));
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
    var ctx = routeReady(root, t("pools.title", "Liquidity Pools"), function () { renderPools(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    /* Wide (viewport-gaps fix 2026-09-28): the 10-col dense table
     * needs full-bleed room; replaces mkt-wrap. Children span full width
     * via the app.css .wide contract; the table keeps its scroll region. */
    ctx.wrap.className = "wrap wide";
    ctx.wrap.appendChild(el(doc, "p", t("pool.list_sub", "CPMM pools (x*y=k). Stake is a deposit of both legs for LP shares."), "muted"));
    var pager = { page: 0, size: 10, starts: ["1.19.0"] };
    var filters = el(doc, "div", null, "pools-filters");
    var fA = field(doc, t("pool.asset_a_field", "Asset A"), { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    var fB = field(doc, t("pool.asset_b_field", "Asset B"), { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    var fS = field(doc, t("pool.share_asset_field", "Share asset"), { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    [fA, fB, fS].forEach(function (f) { filters.appendChild(f.row); });
    var sizeLab = el(doc, "label", t("pool.per_page", "Per page "));
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
    var go = touchable(el(doc, "button", t("pool.list_btn", "List pools"))); go.type = "button";
    filters.appendChild(go);
    ctx.wrap.appendChild(filters);
    var listBox = el(doc, "div"); ctx.wrap.appendChild(listBox);
    var mineBox = el(doc, "div");
    ctx.wrap.appendChild(el(doc, "h2", t("pool.mine_title", "My pools")));
    ctx.wrap.appendChild(mineBox);
    ctx.wrap.appendChild(el(doc, "h2", t("pool.create_title", "Create pool")));
    ctx.wrap.appendChild(el(doc, "p", t("pool.share_help", "Needs a zero-supply non-smartcoin share asset. Create one at #/assets/create first."), "muted"));
    createBox(doc, ctx.wrap, myGen);
    async function resolveOpt(v) {
      v = String(v || "").trim(); if (!v) return null;
      return Asset.describe(v);
    }
    /* pagerBar: Prev / "Page N" / Next. Next stores the page's last id as
     * the following page's startId (list_* paging has no offsets). */
    function pagerBar(pageRows, hasNext) {
      var bar = el(doc, "div", null, "pools-pager");
      var prev = touchable(el(doc, "button", t("pool.prev_btn", "‹ Prev"))); prev.type = "button";
      prev.disabled = pager.page === 0;
      var note = el(doc, "span", "Page " + (pager.page + 1), "pools-page");
      var next = touchable(el(doc, "button", t("pool.next_btn", "Next ›"))); next.type = "button";
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
      showStatus(doc, listBox,t("pool.loading", "Loading pools…"));
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
        if (myGen !== gen) return; clearBox(listBox); showError(doc, listBox,e,t("pool.load_failed", "Could not load pools."));
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
        }).catch(function () { if (myGen === gen) { mineBox.appendChild(el(doc, "p", t("pool.no_mine", "No owned pools.") + " Stake both legs in any pool above — owned pools list here.", "muted")); } });
      }).catch(function (e) { if (myGen === gen) showError(doc, ctx.wrap,e,t("trade.fail_account", "Could not load your account.")); });
    })();
  }
  function createBox(doc, box, myGen) { /* op-59 create: a/b/share resolves, human percents, orientation preview */
    var fA = field(doc, t("pool.asset_a_field", "Asset A"), { placeholder: "BTS" });
    var fB = field(doc, t("pool.asset_b_field", "Asset B"), { placeholder: "CNY" });
    var fSh = field(doc, t("pool.share_asset_field", "Share asset"), { placeholder: t("pool.share_ph", "fresh UIA symbol") });
    var fT = field(doc, t("pool.taker_pct_field", "Taker fee %"), { value: "0.5", inputmode: "decimal" });
    var fW = field(doc, t("pool.withdrawal_pct_field", "Withdrawal fee %"), { value: "0", inputmode: "decimal" });
    [fA, fB, fSh, fT, fW].forEach(function (f) { box.appendChild(f.row); });
    /* Virgin-mint rule (slice-12 proven: max(raw)): first deposit into an
     * empty pool mints the larger leg — inline so nobody learns it by failing. */
    box.appendChild(el(doc, "p", t("pool.virgin_note", "First deposit into an empty pool mints shares equal to the larger leg — fund both legs accordingly."), "muted"));
    reviewSection(doc, box, myGen, t("credit.review_create", "Review create"), {
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
        return [[t("account.card_account", "Account"),  whoText(R.me)], [t("pool.asset_a_field", "Asset A"),  R.a.symbol + " (" + R.a.id + ")"],
          [t("pool.asset_b_field", "Asset B"),  R.b.symbol + " (" + R.b.id + ")"], [t("pool.share_asset_field", "Share asset"),  R.sh.symbol + " (" + R.sh.id + ")"],
          [t("pool.orientation_row", "Orientation"),  "A < B by id: " + op.asset_a + " / " + op.asset_b],
          [t("pool.taker_row", "Taker fee"),  pctText(op.taker_fee_percent), "raw " + op.taker_fee_percent],
          [t("pool.withdrawal_row", "Withdrawal fee"),  pctText(op.withdrawal_fee_percent), "raw " + op.withdrawal_fee_percent],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_create", "Confirm pool create"), ok: function () { return "Pool created."; }, fail: t("credit.could_not_prepare_the_create", "Could not prepare the create.") });
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
