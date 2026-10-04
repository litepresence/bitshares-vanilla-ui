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
   * every default below is byte-verbatim in the HEAD blob. vars fills %(name)s
   * placeholders; without I18n the raw default returns unfilled. */
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
  var openSubs = [];
  /* Page-sort (honest scope): the chain offers no sorted pool endpoint, so
   * sortable headers reorder the LOADED page only, never the chain. */
  var sortKey = "id", sortDir = 1;
  /* No local el — use DOM.el */
  /* clearBox removed — use DOM.clear */
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || t("fees.unexpected_error", "Unexpected error"));
    if (m.indexOf("not-connected") !== -1) m = t("fees.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    if (m.indexOf("wallet-locked") !== -1) m = t("debit.s2", "Wallet is locked.");
    if (m.indexOf("unknown-pool") !== -1) m = t("pool.unknown_pool", "Unknown pool.");
    var err = DOM.error(wrap, m); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text); return p;
  }
  /* Offline backend: the shared Offline helper (js/api/offline.js) owns the
   * handshake, failure counts, and Settings link. Present when loaded;
   * absent (script load failure) falls back to the plain re-render below so
   * the panel never goes dead. */
  function offlineBackend() {
    try {
      if (typeof Offline !== "undefined" && Offline) return Offline;
    } catch (e) { /* fallback below */ }
    return null;
  }
  function offlineState() {
    var off = offlineBackend();
    if (off && typeof off.state === "function") {
      try { return off.state(); } catch (e) { /* unknown below */ }
    }
    try {
      if (typeof Chain !== "undefined" && Chain && Chain.status) return Chain.status().state || "unknown";
    } catch (e) { /* unknown below */ }
    return "unknown";
  }
  function offlineEnsure() {
    var off = offlineBackend();
    if (off && typeof off.ensure === "function") {
      try { off.ensure(); } catch (e) { /* manual Retry remains */ }
      return;
    }
  }
  function offlineBox(doc, wrap, retryFn) { /* Offline panel: copy depends on
    * actual connection (unknown-id failures while connected must not claim
    * the network is down). Retry handshakes via the shared Offline helper
    * (old behavior only re-rendered, so a dropped socket left the button
    * dead); Open Settings links to #/settings for node failover. A
    * background autoRetry subscription (routeReady) still re-renders on any
    * "open" event, so a successful handshake paints via both paths
    * harmlessly. */
    var open = offlineState() === "open";
    wrap.appendChild(DOM.el(doc, "p", open
      ? t("pool.retry_load", "Retry loading.")
      : t("fees.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
    var status = DOM.el(doc, "p", "", "muted");
    try { status.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    wrap.appendChild(status);
    var row = DOM.el(doc, "div", null, "pools-offline-row");
    wrap.appendChild(row);
    var b = touchable(DOM.el(doc, "button", t("fees.retry", "Retry"))); b.type = "button"; b.className = "btn-ghost";
    row.appendChild(b);
    var off = offlineBackend();
    if (off && typeof off.wire === "function") {
      try { off.wire(b, status, retryFn, t); } catch (e) { b.addEventListener("click", retryFn); }
    } else {
      b.addEventListener("click", retryFn);
    }
    var settingsLink = null;
    if (off && typeof off.settingsLink === "function") {
      try { settingsLink = off.settingsLink(doc, t); } catch (e) { settingsLink = null; }
    }
    if (!settingsLink) {
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          settingsLink = HistoryNotice.actionLink(doc, t, "settings");
        }
      } catch (e) { settingsLink = null; }
    }
    if (!settingsLink) {
      settingsLink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
      try { settingsLink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
      settingsLink.className = "subtle-btn";
    }
    row.appendChild(settingsLink);
  }
  function unlockBox(doc, wrap, retry) {
    wrap.appendChild(DOM.el(doc, "p", t("barter.wallet_is_locked_enter_your_password_to_conti", "Wallet is locked. Enter your password to continue."), "muted"));
    var inp = doc.createElement("input"); inp.type = "password"; touchable(inp); wrap.appendChild(inp);
    var b = touchable(DOM.el(doc, "button", t("account.s6", "Unlock"))); b.type = "button"; wrap.appendChild(b);
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
    var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
    return DOM.el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: v.name, id: v.id }), "muted");
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
    var wrap = DOM.el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(DOM.el(doc, "h1", title));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") {
      offlineBox(doc, wrap, retry);
      autoRetry(myGen, retry);
      /* Automated handshake: a dropped socket almost always just needs a
       * fresh login->database handshake against the active node. Fire one
       * attempt on entry (no-op when already connecting); success re-renders
       * via the autoRetry "open" subscription above. Manual Retry covers
       * further attempts; Open Settings covers node failover. */
      offlineEnsure();
      return null;
    }
    /* PUBLIC-FIRST: no wallet gate here — list/detail/quote render locked.
     * Write paths gate at review click (reviewSection) with an unlock notice. */
    return { doc: doc, wrap: wrap, myGen: myGen };
  }
  function routeFail(root, title, e, retry) {
    root.innerHTML = "";
    var doc = root.ownerDocument || document, box = DOM.el(doc, "div", null, "wrap");
    root.appendChild(box); box.appendChild(DOM.el(doc, "h1", title));
    showError(doc, box,e,t("pool.load_failed", "Could not load pools.")); offlineBox(doc, box, retry);
  }
  /* No local confirm builder — use ConfirmDialog.show (title/rows/feeHuman/
   * Back/Sign&Send). Fee rows ride inside rows (embedded by rows-builder
   * closures); unlock gates + status + sendAndProve stay in onSend below. */
  /* field: labeled touch-sized input row (Forms-delegating _ui export).
   * The row shell comes from Forms.labeledInput (no local DOM duplication);
   * retained under this name/signature because PoolUI._ui.field is consumed
   * by pool-detail-ui.js + pool-swap-ui.js (sibling-batch files). Returns
   * {row, input, suffix} — suffix stays null (no unit-wrap site remains). */
  function field(doc, labelText, opts) {
    opts = opts || {};
    var built = Forms.labeledInput(doc, labelText + " ", {
      type: opts.type, value: opts.value,
      placeholder: opts.placeholder || undefined, inputmode: opts.inputmode || undefined
    });
    return { row: built.row, input: built.input, suffix: null };
  }
  function tableHead(doc, titles) {
    var hr = doc.createElement("tr");
    titles.forEach(function (t) { hr.appendChild(DOM.el(doc, "th", t)); });
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
    DOM.clear(out);
    var dlg = ConfirmDialog.show({ title: cfg.title, rows: cfg.rows || [],
      backLabel: t("barter.back", "Back"), sendLabel: t("barter.sign_send", "Sign & Send"),
      onBack: function () { DOM.clear(out); },
      onSend: function () {
        if (myGen !== gen) return;
        var btns = dlg.getElementsByTagName("button");
        var backB = btns[0], sendB = btns[1];
        sendB.disabled = true; backB.disabled = true;
        var status = showStatus(doc, out, "Signing…");
        var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
        if (!wif) { out.removeChild(status); showError(doc, out, new Error("wallet-locked")); sendB.disabled = false; backB.disabled = false; return; }
        Promise.resolve().then(cfg.makeUnsigned).then(function (unsigned) {
          status.textContent = t("htlc.s2", "Broadcasting…");
          return Pool.sendAndProve(unsigned, wif, cfg.prove);
        }).then(async function (res) {
          if (myGen !== gen) return; DOM.clear(out);
          out.appendChild(DOM.el(doc, "p", cfg.okText, "xfer-ok"));
          out.appendChild(DOM.el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
        }).catch(function (e) {
          if (myGen !== gen) return; out.removeChild(status);
          showError(doc, out,e,t("account.upgrade_failed_hint", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
          sendB.disabled = false; backB.disabled = false;
        });
      } });
    /* Principle #6 (raw in title): ConfirmDialog's [term, text] row shape
     * carries no raw-title slot (native r[2] support is owned by the
     * sibling batch — see the Task 3.2 Batch B report). Restore r[2]
     * titles post-show so human terms keep their raw chain values;
     * mapping is 1:1 because no feeHuman is passed. Display-only. */
    try {
      var dds = dlg.querySelectorAll ? dlg.querySelectorAll("dd") : [];
      (cfg.rows || []).forEach(function (r, i) {
        if (r && r[2] && dds[i]) { try { dds[i].title = r[2]; } catch (e0) {} }
      });
    } catch (e) { /* titles are display-only */ }
    /* TxBuilder outlet (additive): stake only ([61, opData]) — queue the
     * deposit without broadcasting. Create/unstake/swap confirms render no
     * outlet. The pair passes as JS values only (never into the DOM); the
     * one-shot Sign & Send below is untouched. */
    try {
      if (cfg && cfg.pair && cfg.pair[0] === 61 && cfg.pair[1] &&
          typeof TxBuilder !== "undefined" && TxBuilder && typeof TxBuilder.addOp === "function") {
        var tbDep = touchable(DOM.el(doc, "button", t("txbuilder.add_deposit", "Add deposit to TxBuilder")));
        tbDep.type = "button";
        tbDep.addEventListener("click", function () {
          var tbSrc = "pool:deposit " + String(cfg.pair[1].pool || "");
          TxBuilder.addOp(cfg.pair[0], cfg.pair[1], tbSrc);
          try {
            if (typeof Notify !== "undefined" && Notify && typeof Notify.push === "function") {
              Notify.push("info", t("txbuilder.added_title", "Added to TxBuilder"), t("txbuilder.added_body_tpl", "%(src)s (op %(op)s) — %(n)s in queue", { src: tbSrc, op: 61, n: TxBuilder.count() }), {});
            }
          } catch (e2) { /* toast optional; the desk badge is the record */ }
          location.hash = "#/txbuilder";
        });
        dlg.appendChild(tbDep);
      }
    } catch (e) { /* outlet never breaks the one-shot path */ }
    out.appendChild(dlg);
  }
  /** build {pair,fee,prove} + live fee -> rows -> sendConfirm.
   * TYPE NOTE: the cfg.build promise resolves {pair, fee, prove} but tsc
   * reads the chain as Promise<void>; member casts pin each field to any.
   * No shared types.js yet (group 1 owns it); local casts only.
   * @param {Document} doc owner document
   * @param {HTMLElement} out output box (cleared + rebuilt)
   * @param {number} myGen route generation (liveness token)
   * @param {any} cfg {build, rows, title, ok, fail, btn?}
   * @returns {void} */
  function reviewPaid(doc, out, myGen, cfg) {
    DOM.clear(out); if (cfg.btn) cfg.btn.disabled = true;
    showStatus(doc, out,t("account.resolving_fee", "Resolving and estimating fee…"));
    function done() { if (cfg.btn) cfg.btn.disabled = false; }
    Promise.resolve().then(cfg.build).then(function (built) {
      if (myGen !== gen) return done();
      feeText((/** @type {any} */ (built).fee)).then(function (f) {
        if (myGen !== gen) return done();
        sendConfirm(doc, out, { title: cfg.title, rows: cfg.rows(built, f), pair: (/** @type {any} */ (built).pair),
          makeUnsigned: function () { return Tx.buildTx([(/** @type {any} */ (built).pair)]); },
          prove: (/** @type {any} */ (built).prove), okText: cfg.ok(built) }, myGen);
        done();
      }).catch(function (e) { if (myGen === gen) { DOM.clear(out); showError(doc, out,e,t("barter.fee_lookup_failed", "Fee lookup failed.")); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      DOM.clear(out); showError(doc, out, e, cfg.fail || t("credit.could_not_prepare_the_transaction", "Could not prepare the transaction.")); done();
    });
  }
  function reviewSection(doc, box, myGen, label, cfg) {
    var btn = touchable(DOM.el(doc, "button", label)); btn.type = "button"; box.appendChild(btn);
    var out = DOM.el(doc, "div", null, "xfer-out"); box.appendChild(out);
    cfg.btn = btn;
    /* SIGN-TIME GATE: password asked only here, never at render. A locked
     * click shows an honest notice + inline unlock; success flows into review
     * (read-only until the user presses Sign & Send). */
    btn.addEventListener("click", function () {
      if (myGen !== gen) return;
      if (!isUnlockedNow()) {
        DOM.clear(out);
        out.appendChild(DOM.el(doc, "p", t("pool.unlock_notice", "Unlock to act — signing needs your wallet password."), "muted"));
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
    var a = DOM.el(doc, "a", sym);
    a.setAttribute("href", "#/asset/" + sym);
    return a;
  }
  function poolTable(doc, rows) { /* dexux-ref density: POOL ID / EXCHANGE /
    *   SHARE / A / A QTY / B / B QTY / TAKER / WITHDRAWAL. EXCHANGE opens the
    *   detail desk (#/pools/:id), which owns the inline swap and stake panels
    *   — the list stays a list (no separate STAKE column: same destination).
    *   Sort: Pool ID / Taker / Withdrawal headers toggle page-sort. */
    if (!rows.length) return DOM.el(doc, "p", t("pool.no_pools", "No pools found.") + t("pool.zero_supply_hint", " Create one from the Stake form on this desk — it needs a zero-supply share asset from #/assets/create first."), "muted");
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
        touchable(b); b.className = "th-sort subtle-btn";
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
      tr.appendChild(DOM.el(doc, "td", r.id));
      /* EXCHANGE second: ⇄ text link in link blue (#1 shows ⇄ here; the
       * vendored swap.svg <img> cannot inherit link color, so text keeps
       * the column blue like every other link). href, aria-label, title
       * unchanged — skin only. */
      var tdX = doc.createElement("td");
      var xl = DOM.el(doc, "a", "⇄", "pools-xlink");
      xl.setAttribute("href", "#/pools/" + r.id);
      xl.setAttribute("aria-label", t("pool.swap_title", "Swap in pool") + " " + r.id);
      xl.title = t("pool.swap_title_attr", "Swap in this pool");
      tdX.appendChild(xl); tr.appendChild(tdX);
      var tdS = doc.createElement("td"); tdS.appendChild(assetLink(doc, r.sym_share)); tr.appendChild(tdS);
      var tdA = doc.createElement("td"); tdA.appendChild(assetLink(doc, r.sym_a)); tr.appendChild(tdA);
      var cA = DOM.el(doc, "td", aA.text, "num"); cA.title = t("account.raw_prefix", "raw ") + aA.raw; tr.appendChild(cA);
      var tdB = doc.createElement("td"); tdB.appendChild(assetLink(doc, r.sym_b)); tr.appendChild(tdB);
      var cB = DOM.el(doc, "td", aB.text, "num"); cB.title = t("account.raw_prefix", "raw ") + aB.raw; tr.appendChild(cB);
      tr.appendChild(DOM.el(doc, "td", pctText(r.taker_units), "num"));
      tr.appendChild(DOM.el(doc, "td", pctText(r.withdrawal_units), "num"));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); return table;
  }
  /** Route entry: #/pools — filters + pool table + my-pools + create form.
   * Pager: page-size select (10/25/50, default 10 like the ref) + Prev/Next +
   * "Page N". No numbered pages: the chain exposes no pool count, so totals
   * are not invented — hasNext comes from fetching one row over the page.
   * startId paging is inclusive on most nodes, so a leading duplicate of the
   * previous page's last row is dropped (over-fetch of 2 covers it).
   * @param {HTMLElement} root router mount element */
  function renderPools(root) {
    if (!root) return;
    var ctx = routeReady(root, t("pools.title", "Liquidity Pools"), function () { renderPools(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    /* Wide (viewport-gaps fix 2026-09-28): the 10-col dense table
     * needs full-bleed room; replaces mkt-wrap. Children span full width
     * via the app.css .wide contract; the table keeps its scroll region. */
    ctx.wrap.className = "wrap wide";
    ctx.wrap.appendChild(DOM.el(doc, "p", t("pool.list_sub", "CPMM pools (x*y=k). Stake is a deposit of both legs for LP shares."), "muted"));
    var pager = { page: 0, size: 10, starts: ["1.19.0"] };
    var filters = DOM.el(doc, "div", null, "pools-filters");
    var fA = Forms.labeledInput(doc, t("pool.asset_a_field", "Asset A") + " ", { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    var fB = Forms.labeledInput(doc, t("pool.asset_b_field", "Asset B") + " ", { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    var fS = Forms.labeledInput(doc, t("pool.share_asset_field", "Share asset") + " ", { placeholder: t("credit.symbol_or_1_3_x", "symbol or 1.3.x") });
    [fA, fB, fS].forEach(function (f) { filters.appendChild(f.row); });
    var sizeLab = DOM.el(doc, "label", t("pool.per_page", "Per page "));
    var sizeSel = doc.createElement("select");
    ["10", "25", "50"].forEach(function (n) {
      var o = doc.createElement("option");
      o.value = n; o.textContent = n;
      if (n === "10") o.selected = true;
      sizeSel.appendChild(o);
    });
    touchable(sizeSel);
    sizeLab.appendChild(sizeSel);
    var sizeWrap = DOM.el(doc, "div", null, "xfer-field");
    sizeWrap.appendChild(sizeLab);
    filters.appendChild(sizeWrap);
    var go = touchable(DOM.el(doc, "button", t("pool.list_btn", "List pools"))); go.type = "button";
    filters.appendChild(go);
    ctx.wrap.appendChild(filters);
    var listBox = DOM.el(doc, "div"); ctx.wrap.appendChild(listBox);
    var mineBox = DOM.el(doc, "div");
    ctx.wrap.appendChild(DOM.el(doc, "h2", t("pool.mine_title", "My pools")));
    ctx.wrap.appendChild(mineBox);
    ctx.wrap.appendChild(DOM.el(doc, "h2", t("pool.create_title", "Create pool")));
    ctx.wrap.appendChild(DOM.el(doc, "p", t("pool.share_help", "Needs a zero-supply non-smartcoin share asset. Create one at #/assets/create first."), "muted"));
    createBox(doc, ctx.wrap, myGen);
    async function resolveOpt(v) {
      v = String(v || "").trim(); if (!v) return null;
      return Asset.describe(v);
    }
    /* pagerBar: Prev / "Page N" / Next. Next stores the page's last id as
     * the following page's startId (list_* paging has no offsets). */
    function pagerBar(pageRows, hasNext) {
      var bar = DOM.el(doc, "div", null, "pools-pager");
      var prev = touchable(DOM.el(doc, "button", t("pool.prev_btn", "‹ Prev"))); prev.type = "button"; prev.className = "subtle-btn";
      prev.disabled = pager.page === 0;
      var note = DOM.el(doc, "span", "Page " + (pager.page + 1), "pools-page");
      var next = touchable(DOM.el(doc, "button", t("pool.next_btn", "Next ›"))); next.type = "button"; next.className = "subtle-btn";
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
      if (myGen !== gen) return; go.disabled = true; DOM.clear(listBox);
      showStatus(doc, listBox,t("pool.loading", "Loading pools…"));
      Promise.resolve().then(async function () {
        var a = await resolveOpt(fA.input.value), b = await resolveOpt(fB.input.value), s = await resolveOpt(fS.input.value);
        var rows = await Pool.list({ assetA: a ? a.id : null, assetB: b ? b.id : null,
          share: s ? s.id : null, limit: pager.size + 2, startId: pager.starts[pager.page] });
        return rows || [];
      }).then(function (rows) {
        if (myGen !== gen) return; DOM.clear(listBox);
        /* Drop the inclusive-start duplicate of the previous page's tail. */
        if (pager.page > 0 && rows.length && rows[0].id === pager.starts[pager.page]) rows.shift();
        var hasNext = rows.length > pager.size;
        var pageRows = hasNext ? rows.slice(0, pager.size) : rows;
        var scroller = DOM.el(doc, "div", null, "pools-scroll");
        scroller.appendChild(poolTable(doc, pageRows));
        listBox.appendChild(scroller);
        listBox.appendChild(pagerBar(pageRows, hasNext));
      }).catch(function (e) {
        if (myGen !== gen) return; DOM.clear(listBox); showError(doc, listBox,e,t("pool.load_failed", "Could not load pools."));
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
      var idP = locked ? Promise.resolve((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0") : Account.myAccountId();
      idP.then(function (id) { return Account.resolve(id); }).then(function (me) {
        if (myGen !== gen) return;
        if (locked) mineBox.appendChild(viewingAsNotice(doc));
        Pool.mine(me.id).then(function (rows) {
          if (myGen !== gen) return; mineBox.appendChild(poolTable(doc, rows));
        }).catch(function () { if (myGen === gen) { mineBox.appendChild(DOM.el(doc, "p", t("pool.no_mine", "No owned pools.") + t("pool.owned_hint", " Stake both legs in any pool above — owned pools list here."), "muted")); } });
      }).catch(function (e) { if (myGen === gen) showError(doc, ctx.wrap,e,t("trade.fail_account", "Could not load your account.")); });
    })();
  }
  function createBox(doc, box, myGen) { /* op-59 create: a/b/share resolves, human percents, orientation preview */
    var fA = Forms.labeledInput(doc, t("pool.asset_a_field", "Asset A") + " ", { placeholder: "BTS" });
    var fB = Forms.labeledInput(doc, t("pool.asset_b_field", "Asset B") + " ", { placeholder: "CNY" });
    var fSh = Forms.labeledInput(doc, t("pool.share_asset_field", "Share asset") + " ", { placeholder: t("pool.share_ph", "fresh UIA symbol") });
    var fT = Forms.labeledInput(doc, t("pool.taker_pct_field", "Taker fee %") + " ", { value: "0.5", inputmode: "decimal" });
    var fW = Forms.labeledInput(doc, t("pool.withdrawal_pct_field", "Withdrawal fee %") + " ", { value: "0", inputmode: "decimal" });
    [fA, fB, fSh, fT, fW].forEach(function (f) { box.appendChild(f.row); });
    /* Virgin-mint rule (slice-12 proven: max(raw)): first deposit into an
     * empty pool mints the larger leg — inline so nobody learns it by failing. */
    box.appendChild(DOM.el(doc, "p", t("pool.virgin_note", "First deposit into an empty pool mints shares equal to the larger leg — fund both legs accordingly."), "muted"));
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
    _ui: { el: DOM.el, clearBox: DOM.clear, showError: showError, showStatus: showStatus,
      offlineBox: offlineBox, unlockBox: unlockBox, field: field, tableHead: tableHead,
      feeText: feeText, headBlock: headBlock, amtText: amtText, pctText: pctText,
      sendConfirm: sendConfirm, reviewPaid: reviewPaid, reviewSection: reviewSection,
      routeReady: routeReady, routeFail: routeFail, autoRetry: autoRetry, dropSubs: dropSubs,
      isUnlockedNow: isUnlockedNow, viewingAsNotice: viewingAsNotice, viewingAsId: VIEWING_AS_ID,
      live: function (g) { return g === gen; } } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolUI === "undefined") { globalThis.PoolUI = PoolUI; }
if (typeof module !== "undefined") { module.exports = PoolUI; }
