/* pool-detail-ui.js — #/pools/:id detail desk (stats + chart + actions + depth + history).
 * Owns: detail desk mirroring the market-ui.js skeleton (stats strip, LWC chart
 *   pane from bucketed chain history, action panels below the chart, CPMM depth
 *   + pool-history tabs), stake (op-61) / unstake (op-62) / inline swap (op-63)
 *   / update (op-75, withdrawal 0-only) / delete (op-60, fee 0) panels with
 *   NAMED-row confirms. DOM scaffolding comes from PoolUI._ui (pool-ui.js loads
 *   first); reads/builders stay in pool.js. WIFs are JS values, never DOM.
 *   Unknown id -> empty state, never blank. No ops-57/58 code (slice 14 owns them).
 * Consumes: PoolUI._ui (routeReady/reviewSection/tableHead/amtText/pctText),
 *   Pool (get/list/history/quote/minReceive/buildDeposit/buildWithdraw/
 *   buildExchange/buildUpdate/buildDelete), Format (parseAmount only), Account,
 *   Wallet (via _ui gates). Side effects: DOM under the router root; global
 *   PoolDetailUI only. Own gen + PoolUI-live check drop stale async work.
 * Created by: building-vanilla-slices skill, slice-12-pools plan Task 3
 *   (split from pool-ui.js so every file stays <=400 lines).
 * MIRROR SPEC (Reference #27): same skeleton as the orderbook desk — picker
 *   (list page) + stats strip + chart pane + action panels + depth/history tabs;
 *   book -> CPMM curve, trades -> pool-history rows, buy/sell -> swap form.
 */
var PoolDetailUI = (function () {
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
  var OP_NAMES = { 59: "create", 60: "delete", 61: "deposit", 62: "withdraw", 63: "exchange" };
  /* Shared-_ui accessor: PoolUI._ui (pool-ui.js loads first); throws when the backend is missing. */
  function U() {
    if (typeof PoolUI === "undefined" || !PoolUI._ui) throw new Error(t("pool.backend_missing", "Pool backend missing: pool-ui.js failed to load."));
    return PoolUI._ui;
  }
  function live(myGen, uiGen) { /* both counters live (debit-ui two-counter precedent) */
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  function whoText(me) { return me.name + " (" + me.id + ")"; }
  function precOr5(p) { return (p === null || p === undefined) ? 5 : p; }
  /* Route entry: #/pools/:id — detail desk mirroring the orderbook desk grid. */
  function renderPoolDetail(root, poolId) {
    if (!root) return;
    var u = U(), retry = function () { renderPoolDetail(root, poolId); };
    var ctx = u.routeReady(root, "Pool " + poolId, retry);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.className = "wrap mkt-wrap";
    u.showStatus(doc, ctx.wrap,t("pool.loading_detail", "Loading pool…"));
    Pool.get(String(poolId)).then(function (row) {
      if (!live(myGen, uiGen)) return;
      root.innerHTML = "";
      var wrap = u.el(doc, "div", null, "wrap mkt-wrap"); root.appendChild(wrap);
      var desk = u.el(doc, "div", null, "mkt"); wrap.appendChild(desk);
      var head = doc.createElement("section"); head.className = "mkt-head"; desk.appendChild(head);
      head.appendChild(u.el(doc, "h1", "Pool " + row.id));
      var strip = doc.createElement("div"); strip.className = "mkt-statstrip"; strip.setAttribute("aria-live", "polite");
      head.appendChild(strip);
      detailFill(doc, desk, head, strip, row, myGen, uiGen);
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return;
      u.routeFail(root, "Pool " + poolId, e, function () { renderPoolDetail(root, poolId); }); });
  }
  async function detailFill(doc, desk, head, strip, row, myGen, uiGen) {
    var u = U(), joined = null;
    try { joined = (await Pool.list({ share: row.share_id }))[0] || null; } catch (e) { joined = null; }
    if (!live(myGen, uiGen)) return;
    var r = joined || row;
    var aA = u.amtText(r.balance_a_raw, r.asset_a_id, r.prec_a === undefined ? null : r.prec_a, r.sym_a);
    var aB = u.amtText(r.balance_b_raw, r.asset_b_id, r.prec_b === undefined ? null : r.prec_b, r.sym_b);
    strip.appendChild(u.el(doc, "span", "Balance A: " + aA.text)); strip.lastChild.title = "raw " + aA.raw;
    strip.appendChild(u.el(doc, "span", "Balance B: " + aB.text)); strip.lastChild.title = "raw " + aB.raw;
    strip.appendChild(u.el(doc, "span", "Taker: " + u.pctText(r.taker_units)));
    strip.appendChild(u.el(doc, "span", "Withdrawal: " + u.pctText(r.withdrawal_units)));
    strip.appendChild(u.el(doc, "span", "Share: " + (r.sym_share || r.share_id)));
    var charts = doc.createElement("section"); charts.className = "mkt-charts"; desk.appendChild(charts);
    charts.appendChild(u.el(doc, "h2", t("pool.history_title", "Price history")));
    chartPane(doc, charts, r, myGen, uiGen);
    var acts = doc.createElement("section"); acts.className = "mkt-side"; desk.appendChild(acts);
    acts.appendChild(u.el(doc, "h2", t("pool.stake_title", "Stake / unstake")));
    stakeBoxes(doc, acts, r, uiGen);
    acts.appendChild(u.el(doc, "h2", t("pool.swap_title", "Swap in pool")));
    swapInlineBox(doc, acts, r, uiGen);
    acts.appendChild(u.el(doc, "h2", t("pool.manage_title", "Update / delete")));
    manageBoxes(doc, acts, r, uiGen);
    var book = doc.createElement("section"); book.className = "mkt-book"; desk.appendChild(book);
    book.appendChild(u.el(doc, "h2", t("pool.depth_title", "Depth (CPMM curve)")));
    depthPane(doc, book, r);
    var hist = doc.createElement("section"); hist.className = "mkt-trades"; desk.appendChild(hist);
    hist.appendChild(u.el(doc, "h2", t("pool.pool_history_title", "Pool history")));
    historyPane(doc, hist, r, myGen, uiGen);
  }
  function chartPane(doc, charts, r, myGen, uiGen) { /* LWC line from bucketed chain history; honest gap when unavailable */
    var u = U(), note = u.el(doc, "p", t("pool.loading_history", "Loading price history…"), "muted"); charts.appendChild(note);
    Pool.history(r.id, 100).then(function (rows) {
      if (!live(myGen, uiGen)) return;
      note.textContent = rows.length ? rows.length + " pool events." : t("pool_detail.s1", "No pool history yet.");
      if (!rows.length) return;
      try {
        if (typeof LightweightCharts === "undefined") { note.textContent += " (chart library unavailable)"; return; }
        var box = doc.createElement("div"); box.style.height = "220px"; charts.appendChild(box);
        var chart = LightweightCharts.createChart(box, { height: 220 });
        var series = chart.addLineSeries();
        var buckets = {}, k;
        rows.forEach(function (h) {
          if (!h.block_time) return;
          k = String(h.block_time).slice(0, 13);
          buckets[k] = (buckets[k] || 0) + 1;
        });
        series.setData(Object.keys(buckets).sort().map(function (t) { return { time: t, value: buckets[t] }; }));
      } catch (e) { note.textContent = t("pool_detail.s1", "No pool history yet."); }
    }).catch(function () {
      if (live(myGen, uiGen)) note.textContent = t("pool_detail.s2", "Pool history unavailable (chain-only; no external index).");
    });
  }
  function depthPane(doc, book, r) { /* CPMM curve points -> compact table (first 8 steps per side) */
    var u = U();
    try {
      var pts = Pool.depthPoints({ balanceA_raw: r.balance_a_raw, balanceB_raw: r.balance_b_raw });
      var table = doc.createElement("table"); table.className = "node-table";
      table.appendChild(u.tableHead(doc, [t("pool.sell_pct_col", "Sell %"),  t("pool.a_to_b_col", "A→B out (raw)"), t("pool.b_to_a_col", "B→A out (raw)")]));
      var tbody = doc.createElement("tbody");
      for (var i = 0; i < 8; i++) {
        var tr = doc.createElement("tr");
        tr.appendChild(u.el(doc, "td", String(pts.aToB[i].pct) + "%"));
        tr.appendChild(u.el(doc, "td", pts.aToB[i].out_raw));
        tr.appendChild(u.el(doc, "td", pts.bToA[i].out_raw));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody); book.appendChild(table);
    } catch (e) { book.appendChild(u.el(doc, "p", t("pool.depth_unavailable", "Depth unavailable (empty pool)."), "muted")); }
  }
  function historyPane(doc, hist, r, myGen, uiGen) { /* pool-history rows coded 59-63 + My-exchanges toggle; honest gap when unavailable */
    var u = U();
    /* Toggle mirrors #1 MarketHistory group-1 tabs (Exchange.jsx:2551-2616):
     * Pool history (all events) vs My exchanges (wallet op-63 for this pool).
     * My needs unlock: locked wallets get the Wallet-link hint (#9). */
    var tabs = doc.createElement("div");
    tabs.className = "mkt-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("pool.exchanges_toggle_label", "Pool or my exchanges"));
    var tabPool = u.touchable(u.el(doc, "button", t("pool.tab_pool", "Pool history")));
    tabPool.type = "button"; tabPool.id = "pool-hist-tab-pool"; tabPool.setAttribute("role", "tab");
    var tabMy = u.touchable(u.el(doc, "button", t("pool.tab_my", "My exchanges")));
    tabMy.type = "button"; tabMy.id = "pool-hist-tab-my"; tabMy.setAttribute("role", "tab");
    tabs.appendChild(tabPool); tabs.appendChild(tabMy);
    hist.appendChild(tabs);
    var poolBody = u.el(doc, "div"); poolBody.id = "pool-hist-pool"; poolBody.setAttribute("role", "tabpanel");
    var myBody = u.el(doc, "div"); myBody.id = "pool-hist-my"; myBody.setAttribute("role", "tabpanel");
    hist.appendChild(poolBody); hist.appendChild(myBody);
    var cur = "pool";
    function paint() {
      var isMy = cur === "my";
      tabPool.setAttribute("aria-selected", isMy ? "false" : "true");
      tabMy.setAttribute("aria-selected", isMy ? "true" : "false");
      tabPool.setAttribute("aria-pressed", isMy ? "false" : "true");
      tabMy.setAttribute("aria-pressed", isMy ? "true" : "false");
      poolBody.style.display = isMy ? "none" : "";
      myBody.style.display = isMy ? "" : "none";
    }
    tabPool.addEventListener("click", function () { cur = "pool"; paint(); });
    tabMy.addEventListener("click", function () { cur = "my"; paint(); loadMy(poolBody, myBody, r, myGen, uiGen); });
    paint();
    var note = u.el(doc, "p", t("account.loading_history", "Loading history…"), "muted"); poolBody.appendChild(note);
    Pool.history(r.id, 50).then(function (rows) {
      if (!live(myGen, uiGen)) return; poolBody.removeChild(note);
      if (!rows.length) { poolBody.appendChild(u.el(doc, "p", t("pool.no_events", "No pool events yet."), "muted")); return; }
      var table = doc.createElement("table"); table.className = "node-table";
      table.appendChild(u.tableHead(doc, [t("pool.time_col", "Time (UTC)"),  t("pool.event_col", "Event")]));
      var tbody = doc.createElement("tbody");
      rows.forEach(function (h) {
        var tr = doc.createElement("tr");
        tr.appendChild(u.el(doc, "td", h.block_time || "unknown"));
        tr.appendChild(u.el(doc, "td", OP_NAMES[h.op_type] || ("op " + String(h.op_type))));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody); poolBody.appendChild(table);
    }).catch(function () {
      if (live(myGen, uiGen)) note.textContent = t("pool_detail.s2", "Pool history unavailable (chain-only; no external index).");
    });
    myBody.appendChild(u.el(doc, "p", t("pool.my_hist_hint", "Open My exchanges to see your fills in this pool."), "muted"));
    function loadMy(poolBodyEl, myBodyEl, row, g1, g2) {
      void poolBodyEl;
      u.clearBox(myBodyEl);
      var unlocked = false;
      try {
        unlocked = typeof Wallet !== "undefined" && Wallet &&
          (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
      } catch (e) { unlocked = false; }
      if (!unlocked) {
        var hint = u.el(doc, "p", t("pool.my_locked", "Unlock your wallet to see your exchanges in this pool. "), "muted");
        var a = doc.createElement("a");
        a.textContent = t("market.go_wallet", "Go to Wallet");
        a.setAttribute("href", "#/wallet");
        u.touchable(a);
        hint.appendChild(a);
        myBodyEl.appendChild(hint);
        return;
      }
      u.showStatus(doc, myBodyEl, t("account.loading_history", "Loading history…"));
      Account.myAccountId().then(function (myId) { return Account.history(myId, 100); }).then(function (rows) {
        if (!live(g1, g2)) return;
        u.clearBox(myBodyEl);
        var mine = (rows || []).filter(function (h) {
          var tup = h ? h.op : null;
          if (!Array.isArray(tup) || tup[0] !== 63) return false;
          return ((tup[1] || {}).pool === row.id);
        });
        if (!mine.length) { myBodyEl.appendChild(u.el(doc, "p", t("pool.no_my_exchanges", "No exchanges for your account in this pool."), "muted")); return; }
        var table = doc.createElement("table"); table.className = "node-table";
        table.appendChild(u.tableHead(doc, [t("pool.block_col", "Block"), t("pool.sell_col", "Sell"), t("pool.min_recv_row", "Min to receive")]));
        var tbody = doc.createElement("tbody");
        mine.slice(0, 20).forEach(function (h) {
          var d = (h.op && h.op[1]) || {};
          var tr = doc.createElement("tr");
          tr.appendChild(u.el(doc, "td", h.block_num !== undefined && h.block_num !== null ? String(h.block_num) : "—"));
          tr.appendChild(u.el(doc, "td", d.amount_to_sell ? String(d.amount_to_sell.amount) + " " + String(d.amount_to_sell.asset_id) : "—"));
          tr.appendChild(u.el(doc, "td", d.min_to_receive ? String(d.min_to_receive.amount) + " " + String(d.min_to_receive.asset_id) : "—"));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); myBodyEl.appendChild(table);
      }).catch(function (e) {
        if (!live(g1, g2)) return;
        u.clearBox(myBodyEl); u.showError(doc, myBodyEl, e, t("pool.my_history_failed", "Could not load your exchanges."));
      });
    }
  }
  function stakeBoxes(doc, box, r, uiGen) { /* op-61 deposit + op-62 withdraw with share previews */
    var u = U();
    var fA = u.field(doc, t("pool.amount_a_field", "Amount A"), { inputmode: "decimal", placeholder: "1.0" });
    var fB = u.field(doc, t("pool.amount_b_field", "Amount B"), { inputmode: "decimal", placeholder: "1.0" });
    box.appendChild(fA.row); box.appendChild(fB.row);
    u.reviewSection(doc, box, uiGen, t("pool.review_stake", "Review stake"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildDeposit({ accountId: me.id, poolId: r.id, assetAId: r.asset_a_id, assetBId: r.asset_b_id,
          aHuman: fA.input.value.trim(), precA: precOr5(r.prec_a),
          bHuman: fB.input.value.trim(), precB: precOr5(r.prec_b) });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var lA = u.amtText(op.amount_a.amount, op.amount_a.asset_id, precOr5(r.prec_a), r.sym_a);
        var lB = u.amtText(op.amount_b.amount, op.amount_b.asset_id, precOr5(r.prec_b), r.sym_b);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.amount_a_field", "Amount A"),  lA.text, "raw " + lA.raw], [t("pool.amount_b_field", "Amount B"),  lB.text, "raw " + lB.raw],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_stake", "Confirm stake"), ok: function () { return t("pool.staked", "Staked (deposit broadcast)."); }, fail: t("pool.stake_failed", "Could not prepare the stake.") });
    var fS = u.field(doc, t("pool.shares_field", "LP shares"), { inputmode: "decimal", placeholder: "1.0" });
    box.appendChild(fS.row);
    u.reviewSection(doc, box, uiGen, t("pool.review_unstake", "Review unstake"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildWithdraw({ accountId: me.id, poolId: r.id, shareId: r.share_id,
          shareHuman: fS.input.value.trim(), precShare: precOr5(r.prec_share) });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var sh = u.amtText(op.share_amount.amount, op.share_amount.asset_id, precOr5(r.prec_share), r.sym_share);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.shares_field", "LP shares"),  sh.text, "raw " + sh.raw],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_unstake", "Confirm unstake"), ok: function () { return t("pool.unstaked", "Unstaked (withdraw broadcast)."); }, fail: t("pool.unstake_failed", "Could not prepare the unstake.") });
  }
  function swapInlineBox(doc, box, r, uiGen) { /* op-63 mini-form: quote + impact + slippage preview */
    var u = U();
    var fSell = u.field(doc, t("pool.sell_amount_field", "Sell amount"), { inputmode: "decimal", placeholder: "1.0" });
    box.appendChild(fSell.row);
    var dir = doc.createElement("select"); u.touchable(dir);
    var oA = doc.createElement("option"); oA.value = "A"; oA.textContent = t("account.sell_prefix", "Sell ") + (r.sym_a || r.asset_a_id);
    var oB = doc.createElement("option"); oB.value = "B"; oB.textContent = t("account.sell_prefix", "Sell ") + (r.sym_b || r.asset_b_id);
    dir.appendChild(oA); dir.appendChild(oB); box.appendChild(dir);
    var fSlip = u.field(doc, t("pool.slippage_field", "Slippage %"), { value: Pool.DEFAULT_SLIPPAGE_PCT, inputmode: "decimal" });
    box.appendChild(fSlip.row);
    u.reviewSection(doc, box, uiGen, t("pool.review_swap", "Review swap"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var sellIsA = dir.value === "A";
        var precSell = precOr5(sellIsA ? r.prec_a : r.prec_b);
        var sellRaw = Format.parseAmount(fSell.input.value.trim(), precSell);
        var q = Pool.quote({ balanceA_raw: r.balance_a_raw, balanceB_raw: r.balance_b_raw, sell_raw: sellRaw, sellIsA: sellIsA });
        var minRaw = Pool.minReceive(q.out_raw, fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT);
        var pair = Pool.buildExchange({ accountId: me.id, poolId: r.id,
          sellHuman: fSell.input.value.trim(), precSell: precSell,
          sellAssetId: sellIsA ? r.asset_a_id : r.asset_b_id,
          minRaw: minRaw, recvAssetId: sellIsA ? r.asset_b_id : r.asset_a_id });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me, q: q, minRaw: minRaw, sellIsA: sellIsA,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var precSell = precOr5(R.sellIsA ? r.prec_a : r.prec_b);
        var precRecv = precOr5(R.sellIsA ? r.prec_b : r.prec_a);
        var sell = u.amtText(op.amount_to_sell.amount, op.amount_to_sell.asset_id, precSell, R.sellIsA ? r.sym_a : r.sym_b);
        var min = u.amtText(R.minRaw, op.min_to_receive.asset_id, precRecv, R.sellIsA ? r.sym_b : r.sym_a);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("account.sell_th", "Sell"),  sell.text, "raw " + sell.raw],
          [t("pool.quote_row", "Quote out (raw)"),  R.q.out_raw], [t("pool.min_recv_row", "Min to receive"),  min.text, "raw " + min.raw],
          [t("pool.slippage_row", "Slippage"),  String(fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT) + "%"],
          [t("pool.impact_row", "Price impact"),  (R.q.impact_bp / 100) + "%"],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_swap", "Confirm swap"), ok: function () { return t("pool.swapped", "Swapped."); }, fail: t("pool.swap_failed", "Could not prepare the swap.") });
  }
  function manageBoxes(doc, box, r, uiGen) { /* op-75 fee edit (withdrawal 0-only) + op-60 owner delete (fee 0) */
    var u = U();
    var fT = u.field(doc, t("pool.taker_field", "New taker fee % (blank = keep)"), { inputmode: "decimal", placeholder: Pool.pctUnitsToHuman(r.taker_units) });
    box.appendChild(fT.row);
    var wSel = doc.createElement("select"); u.touchable(wSel);
    var wKeep = doc.createElement("option"); wKeep.value = ""; wKeep.textContent = t("pool_detail.s3", "Withdrawal fee: keep");
    var wZero = doc.createElement("option"); wZero.value = "0"; wZero.textContent = t("pool_detail.s4", "Withdrawal fee: set 0 (only allowed change)");
    wSel.appendChild(wKeep); wSel.appendChild(wZero); box.appendChild(wSel);
    u.reviewSection(doc, box, uiGen, t("credit.review_update", "Review update"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var t = String(fT.input.value).trim();
        var pair = Pool.buildUpdate({ accountId: me.id, poolId: r.id,
          takerHumanOrNull: t === "" ? null : t, withdrawalZeroOrNull: wSel.value === "" ? null : "0" });
        var op = pair[1];
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try {
              var cur = await Pool.get(r.id);
              if (op.taker_fee_percent !== null && op.taker_fee_percent !== undefined &&
                cur.taker_units !== op.taker_fee_percent) return null;
              if (op.withdrawal_fee_percent !== null && op.withdrawal_fee_percent !== undefined &&
                cur.withdrawal_units !== op.withdrawal_fee_percent) return null;
              return cur;
            } catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1], rows = [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)]];
        if (op.taker_fee_percent !== null && op.taker_fee_percent !== undefined)
          rows.push([t("pool.taker_row", "Taker fee"),  u.pctText(r.taker_units) + " → " + u.pctText(op.taker_fee_percent)]);
        if (op.withdrawal_fee_percent !== null && op.withdrawal_fee_percent !== undefined)
          rows.push([t("pool.withdrawal_row", "Withdrawal fee"),  u.pctText(r.withdrawal_units) + " → 0%"]);
        rows.push([t("misc.note", "Note"),  t("pool.withdrawal_zero_note", "Withdrawal fee can only be set to 0.")]);
        rows.push([t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw]); rows.push([t("borrow.network", "Network"),  "testnet"]);
        return rows;
      },
      title: t("pool.confirm_update", "Confirm pool update"), ok: function () { return t("pool.updated", "Pool updated."); }, fail: t("credit.could_not_prepare_the_update", "Could not prepare the update.") });
    u.reviewSection(doc, box, uiGen, t("credit.review_delete", "Review delete"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildDelete({ accountId: me.id, poolId: r.id });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { await Pool.get(r.id); return null; } catch (e) { return { gone: true }; } } };
      },
      rows: function (R, fee) {
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.warning_row", "Warning"),  t("pool.delete_warning", "Delete is owner-only cleanup. Withdraw all liquidity first.")],
          [t("borrow.fee", "Fee"),  fee.text + " (expected 0)", "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_delete", "Confirm pool delete"), ok: function () { return t("pool.deleted", "Pool deleted."); }, fail: t("credit.could_not_prepare_the_delete", "Could not prepare the delete.") });
  }
  return { renderPoolDetail: renderPoolDetail };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolDetailUI === "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
if (typeof module !== "undefined") { module.exports = PoolDetailUI; }
