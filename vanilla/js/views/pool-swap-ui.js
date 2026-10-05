/* pool-swap-ui.js — #/swap simple single-pool swap page (slippage + quote wiring).
 * Owns: sell/buy asset pickers (pool-aware: only pairs with a pool list; single
 *   pool auto-selected, multi-pool pairs disambiguated explicitly), sell amount,
 *   live CPMM quote + impact + per-leg fee note, slippage % input (default 0.5%,
 *   editable 0.1-5%), min_to_receive preview, live Tx.fee, NAMED-row confirm,
 *   broadcast + prove by pool-balance delta + history row. Single pool only —
 *   NO multi-hop routing (recorded boundary). Quote/slippage math lives in
 *   pool.js (Pool.quote/minReceive); this file only wires inputs to it.
  *   HISTORY TOGGLE (mirrors #1 MarketHistory group-1 toggle,
  *   Exchange.jsx:2551-2616 + MarketHistory.jsx:21-139): one swaps cell
  *   holds Pool history (get_liquidity_pool_history for the selected pool)
  *   and My swaps (wallet account's op-63 rows for that pool) behind
  *   Pool/My buttons. My needs unlock: locked wallets get the honest
  *   Wallet-link hint (principle #9). Long tapes scroll in place inside
  *   .pool-hist-scroll (same 15-row metrics as .trades-scroll). Numbers via
  *   Format/amtText only (#6).
 * Consumes: PoolUI._ui (shared DOM/confirm helpers — pool-ui.js loads first),
 *   Pool (quote/minReceive/buildExchange/fee/sendAndProve/list/get/history),
 *   Format (parseAmount/formatAmount only), Account, Asset.describe, Wallet,
 *   Chain/Store (via _ui routeReady). WIFs are JS values, never DOM.
 * Globals/side effects: DOM under the router root; global PoolSwapUI only; own
 *   gen counter (stale continuations bail; teardown on every entry).
 * Created by: building-vanilla-slices skill, slice-12-pools plan Task 3
 *   (pre-authorized split: pool-ui.js would breach ~380 lines otherwise).
 * CHAIN TRUTH (#4 wins): op 63 liquidity_pool_exchange <- protocol/
 *   liquidity_pool.hpp:138-152; min_to_receive = floor(quote * (1 - slippage))
 *   in integer math (ambiguity F); #2 SimpleSwap has NO slippage control —
 *   vanilla adds it (both quote and min shown in the confirm).
 */
var PoolSwapUI = (function () {
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
  /* Route entry: #/swap — pick a pair, pick its pool, quote, confirm, send. */
  function renderSwap(root) {
    if (!root) return;
    var u = U(), retry = function () { renderSwap(root); };
    var ctx = u.routeReady(root, t("swap.title", "Swap"), retry);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen, wrap = ctx.wrap;
    wrap.appendChild(u.el(doc, "p", t("pool.swap_sub", "Single-pool swap (one op-63). No multi-hop routing."), "muted"));
    var fSell = u.field(doc, t("pool.sell_asset_field", "Sell asset"), { value: "BTS" });
    var fBuy = u.field(doc, t("pool.buy_asset_field", "Buy asset"), { placeholder: "CNY" });
    /* Swap-direction button (pool-desk FIX 1): sits between the two asset
     * inputs; swaps their values and re-runs the Find-pools lookup below
     * (same handler, no flow fork). Labeled for AT + touch-sized. */
    var flipBtn = u.touchable(u.el(doc, "button", "⇄"));
    flipBtn.type = "button"; flipBtn.id = "swap-flip";
    flipBtn.setAttribute("aria-label", t("pool.swap_direction_label", "Swap sell and buy assets"));
    flipBtn.title = t("pool.swap_direction_label", "Swap sell and buy assets");
    var fAmt = u.field(doc, t("pool.sell_amount_field", "Sell amount"), { inputmode: "decimal", placeholder: "1.0",
      unit: String(fSell.input.value || "").trim() || "BTS" });
    var fSlip = u.field(doc, t("pool.slippage_field", "Slippage %"), { value: Pool.DEFAULT_SLIPPAGE_PCT, inputmode: "decimal", unit: "%" });
    wrap.appendChild(fSell.row); wrap.appendChild(flipBtn); wrap.appendChild(fBuy.row);
    wrap.appendChild(fAmt.row); wrap.appendChild(fSlip.row);
    /* LOW punchlist: sell/buy balance display. Balances are account-scoped
     * (no new chain read here) — the honest pointer is the account page. */
    (function balanceHint() {
      var p = u.el(doc, "p", t("pool.balances_for_the_sell_and_buy_assets_live_", "Balances for the sell and buy assets live on the account page — open it to check before swapping."), "muted");
      var a = doc.createElement("a");
      a.setAttribute("href", "#/account/committee-account");
      a.textContent = t("pool.open_account_balances", "Open account balances");
      try { u.touchable(a); } catch (e) { /* link stands */ }
      p.appendChild(doc.createTextNode(" · "));
      p.appendChild(a);
      wrap.appendChild(p);
    })();
    var find = u.touchable(u.el(doc, "button", t("pool.find_pools", "Find pools"))); find.type = "button"; wrap.appendChild(find);
    /* Flip wiring (declared after Find exists): swap the asset values, then
     * re-run the lookup through the same button (disabled mid-flight, so a
     * flip during a lookup is a safe no-op). */
    flipBtn.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return;
      var s = fSell.input.value;
      fSell.input.value = fBuy.input.value;
      fBuy.input.value = s;
      try { find.click(); } catch (e) { /* values stand without a lookup */ }
    });
    var pickBox = u.el(doc, "div"); wrap.appendChild(pickBox);
    var quoteBox = u.el(doc, "div"); wrap.appendChild(quoteBox);
    var actionBox = u.el(doc, "div"); wrap.appendChild(actionBox);
    /* Swaps toggle cell: Pool history vs My swaps for the selected
     * pool (mirrors the market desk Recent/My toggle; #1 counterpart is the
     * MarketHistory group-1 tabs, Exchange.jsx:2551-2616). */
    var histSec = u.el(doc, "div", null, "swap-hist");
    wrap.appendChild(histSec);
    histSec.appendChild(u.el(doc, "h2", t("pool.exchanges_title", "Pool swaps")));
    var histTabs = doc.createElement("div");
    histTabs.className = "mkt-tabs";
    histTabs.setAttribute("role", "tablist");
    histTabs.setAttribute("aria-label", t("pool.exchanges_toggle_label", "Pool or my swaps"));
    var histTabPool = u.touchable(u.el(doc, "button", t("pool.tab_pool", "Pool history")));
    histTabPool.type = "button"; histTabPool.id = "swap-hist-tab-pool"; histTabPool.setAttribute("role", "tab");
    var histTabMy = u.touchable(u.el(doc, "button", t("pool.tab_my", "My swaps")));
    histTabMy.type = "button"; histTabMy.id = "swap-hist-tab-my"; histTabMy.setAttribute("role", "tab");
    histTabs.appendChild(histTabPool); histTabs.appendChild(histTabMy);
    histSec.appendChild(histTabs);
    var poolBody = u.el(doc, "div"); poolBody.id = "swap-hist-pool"; poolBody.setAttribute("role", "tabpanel");
    var myPoolBody = u.el(doc, "div"); myPoolBody.id = "swap-hist-my"; myPoolBody.setAttribute("role", "tabpanel");
    histSec.appendChild(poolBody); histSec.appendChild(myPoolBody);
    var histTab = "pool", curPoolId = null;
    /* paintHistTab: pool-history vs my-swaps tab visibility + ARIA. */
    function paintHistTab() {
      var isMy = histTab === "my";
      histTabPool.setAttribute("aria-selected", isMy ? "false" : "true");
      histTabMy.setAttribute("aria-selected", isMy ? "true" : "false");
      histTabPool.setAttribute("aria-pressed", isMy ? "false" : "true");
      histTabMy.setAttribute("aria-pressed", isMy ? "true" : "false");
      poolBody.style.display = isMy ? "none" : "";
      myPoolBody.style.display = isMy ? "" : "none";
    }
    histTabPool.addEventListener("click", function () { histTab = "pool"; paintHistTab(); });
    histTabMy.addEventListener("click", function () { histTab = "my"; paintHistTab(); if (curPoolId) loadMyPoolHist(doc, u, myGen, uiGen, myPoolBody, curPoolId); });
    paintHistTab();
    poolBody.appendChild(u.el(doc, "p", t("pool.hist_hint", "Find a pool to see its swaps."), "muted"));
    myPoolBody.appendChild(u.el(doc, "p", t("pool.find_pool_hint", "Find a pool to see your swaps."), "muted"));
    /* loadPoolHist: fetch + paint the pool event tape (op names, never raw
     * ids); failures paint inline. Also refreshes the My tab when active. */
    function loadPoolHist(poolId) {
      curPoolId = poolId;
      u.clearBox(poolBody);
      u.showStatus(doc, poolBody, t("pool.loading_history", "Loading price history…"));
      Pool.history(poolId, 20).then(function (rows) {
        if (!live(myGen, uiGen)) return;
        u.clearBox(poolBody);
        if (!rows || !rows.length) { poolBody.appendChild(u.el(doc, "p", t("pool.no_events", "No pool events yet.") + t("pool.events_hint", " Deposits, withdrawals, and exchanges in this pool list here once they happen."), "muted")); return; }
        var table = doc.createElement("table"); table.className = "node-table";
        table.appendChild(u.tableHead(doc, [t("pool.time_col", "Time (UTC)"), t("pool.event_col", "Event")]));
        var tbody = doc.createElement("tbody");
        rows.forEach(function (h) {
          var tr = doc.createElement("tr");
          tr.appendChild(u.el(doc, "td", h.block_time || "unknown"));
          var names = { 59: "create", 60: "delete", 61: "deposit", 62: "withdraw", 63: "exchange" };
          tr.appendChild(u.el(doc, "td", names[h.op_type] || ("op " + String(h.op_type))));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        var scroller = doc.createElement("div");
        scroller.className = "pool-hist-scroll";
        scroller.appendChild(table);
        poolBody.appendChild(scroller);
      }).catch(function (e) {
        if (!live(myGen, uiGen)) return;
        u.clearBox(poolBody); u.showError(doc, poolBody, e, t("pool.history_failed", "Could not load pool history."));
        try {
          if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
            var histLink = HistoryNotice.actionLink(doc, t, "settings");
            if (histLink) poolBody.appendChild(histLink);
          }
        } catch (e2) { /* error panel stands without the link */ }
      });
      if (histTab === "my") loadMyPoolHist(doc, u, myGen, uiGen, myPoolBody, poolId);
      else { u.clearBox(myPoolBody); myPoolBody.appendChild(u.el(doc, "p", t("pool.find_pool_hint", "Find a pool to see your swaps."), "muted")); }
    }
    find.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; find.disabled = true;
      u.clearBox(pickBox); u.clearBox(quoteBox); u.clearBox(actionBox);
      u.showStatus(doc, pickBox,t("pool.resolving", "Resolving assets and pools…"));
      Promise.resolve().then(async function () {
        var s = await Asset.describe(fSell.input.value.trim() || "BTS");
        var b = await Asset.describe(fBuy.input.value.trim());
        if (s.id === b.id) throw new Error(t("pool.err_same_asset", "order-trap (sell asset must differ from receive asset)"));
        var a = s.id < b.id ? s : b, c = s.id < b.id ? b : s;
        var rows = await Pool.list({ assetA: a.id, assetB: c.id, limit: 10 });
        return { sell: s, buy: b, rows: rows };
      }).then(function (found) {
        if (!live(myGen, uiGen)) return; u.clearBox(pickBox);
        /* Suffix tracks the resolved sell asset (input keeps its id/value). */
        if (fAmt.suffix) fAmt.suffix.textContent = found.sell.symbol;
        if (!found.rows.length) {
          pickBox.appendChild(u.el(doc, "p", "No pool exists for " + found.sell.symbol + "/" + found.buy.symbol + t("pool.create_stake_hint", ". Create one from the Pools desk (#/pools) Stake form."), "muted"));
          return;
        }
        var sel = doc.createElement("select"); u.touchable(sel);
        found.rows.forEach(function (r, i) {
          var o = doc.createElement("option"); o.value = r.id;
          o.textContent = r.id + " (" + r.sym_a + "/" + r.sym_b + ")";
          sel.appendChild(o);
        });
        var row = u.el(doc, "div", null, "xfer-field");
        row.appendChild(u.el(doc, "span", found.rows.length > 1 ? t("pool.pick_multi", "Pool (several exist — pick one): ") : t("pool.pick_single", "Pool: ")));
        row.appendChild(sel); pickBox.appendChild(row);
        /* Pool->Exchange context (owner): header Exchange tab follows the
         * selected pool's pair. Reads the already-resolved row symbols —
         * no extra fetch. Guarded: id fallbacks fail validation upstairs. */
        var pushMarketHint = function () {
          try {
            if (typeof App === "undefined" || !App || typeof App.setPoolMarket !== "function") return;
            var picked = null, k;
            for (k = 0; k < found.rows.length; k++) {
              if (String(found.rows[k].id) === String(sel.value)) { picked = found.rows[k]; break; }
            }
            if (picked) App.setPoolMarket(picked.sym_a + "_" + picked.sym_b);
          } catch (e) { /* default market stands */ }
        };
        pushMarketHint();
        var quoteBtn = u.touchable(u.el(doc, "button", t("notify.quote_label", "Quote"))); quoteBtn.type = "button"; pickBox.appendChild(quoteBtn);
        loadPoolHist(sel.value);
        sel.addEventListener("change", function () { loadPoolHist(sel.value); pushMarketHint(); });
        quoteBtn.addEventListener("click", function () {
          if (!live(myGen, uiGen)) return;
          quoteFor(doc, u, myGen, uiGen, quoteBox, actionBox, found, sel.value,
            fAmt.input.value.trim(), fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT);
        });
      }).catch(function (e) {
        if (!live(myGen, uiGen)) return; u.clearBox(pickBox); u.showError(doc, pickBox,e,t("pool.find_failed", "Could not find pools."));
      }).then(function () { find.disabled = false; });
    });
  }
  /* My-swaps pane for the selected pool: wallet account's op-63 rows
   * (liquidity_pool_exchange, protocol/liquidity_pool.hpp:138-152) filtered
   * to this pool id. Anyone can type an account (name or 1.2.N) + Look up to
   * preview ITS swaps via public Account.history; blank + locked keeps
   * the honest Wallet-link hint, never a password field here. Unlocked
   * prefills the wallet account; the wallet auto-load is unchanged.
   * Failures render inline, never blank. Long lists scroll in place inside
   * .pool-hist-scroll (same metrics as .trades-scroll). */
  function loadMyPoolHist(doc, u, myGen, uiGen, box, poolId) {
    u.clearBox(box);
    var unlocked = false;
    try {
      unlocked = typeof Wallet !== "undefined" && Wallet &&
        (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
    } catch (e) { unlocked = false; }
    /* Typed-account preview row (principle #9: reads never gate on unlock). */
    var fAcct = u.field(doc, t("account.card_account", "Account"),
      { placeholder: t("common.name_or_id_hint", "name or 1.2.N") });
    box.appendChild(fAcct.row);
    var viewBtn = u.touchable(u.el(doc, "button", t("referrals.look_up", "Look up")));
    viewBtn.type = "button";
    box.appendChild(viewBtn);
    var listBox = u.el(doc, "div");
    box.appendChild(listBox);
    /* Same op-63 pool filter as the auto-load below. */
    function poolMine(rows) {
      return (rows || []).filter(function (r) {
        var tup = r ? r.op : null;
        if (!Array.isArray(tup) || tup[0] !== 63) return false;
        var d = tup[1] || {};
        return d.pool === poolId;
      });
    }
    /* drawMine: paint this pool's op-63 rows for the account (empty ->
     * hint). No-ops when the route generation moved on. */
    function drawMine(mine) {
      if (!live(myGen, uiGen)) return;
      u.clearBox(listBox);
      if (!mine.length) { listBox.appendChild(u.el(doc, "p", t("pool.no_my_exchanges", "No swaps for your account in this pool.") + t("pool.my_swaps_hint", " Run one from #/swap — your swaps in this pool list here."), "muted")); return; }
      var table = doc.createElement("table"); table.className = "node-table";
      table.appendChild(u.tableHead(doc, [t("pool.block_col", "Block"), t("pool.sell_col", "Sell"), t("pool.min_recv_row", "Min to receive")]));
      var tbody = doc.createElement("tbody");
      mine.slice(0, 20).forEach(function (r) {
        var d = (r.op && r.op[1]) || {};
        var tr = doc.createElement("tr");
        tr.appendChild(u.el(doc, "td", r.block_num !== undefined && r.block_num !== null ? String(r.block_num) : "—"));
        tr.appendChild(u.el(doc, "td", d.amount_to_sell ? String(d.amount_to_sell.amount) + " " + String(d.amount_to_sell.asset_id) : "—"));
        tr.appendChild(u.el(doc, "td", d.min_to_receive ? String(d.min_to_receive.amount) + " " + String(d.min_to_receive.asset_id) : "—"));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      var scroller = doc.createElement("div");
      scroller.className = "pool-hist-scroll";
      scroller.appendChild(table);
      listBox.appendChild(scroller);
    }
    /* lockedHint: locked-wallet empty state with a Wallet link. */
    function lockedHint() {
      if (!live(myGen, uiGen)) return;
      u.clearBox(listBox);
      var hint = u.el(doc, "p", t("pool.my_locked", "Unlock your wallet to see your swaps in this pool. "), "muted");
      var a = doc.createElement("a");
      a.textContent = t("market.go_wallet", "Go to Wallet");
      a.setAttribute("href", "#/wallet");
      u.touchable(a);
      hint.appendChild(a);
      listBox.appendChild(hint);
    }
    /* Typed-account lookup: resolve the input, then paint that account's
     * op-63 rows for this pool via public Account.history. */
    function loadTyped() {
      if (!live(myGen, uiGen)) return;
      var v = fAcct.input.value.trim();
      if (!v) {
        if (!unlocked) lockedHint();
        else loadMyPoolHist(doc, u, myGen, uiGen, box, poolId);
        return;
      }
      u.clearBox(listBox);
      u.showStatus(doc, listBox, t("account.loading_history", "Loading history…"));
      Promise.resolve().then(function () {
        if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
          throw new Error("account backend missing");
        }
        return Account.resolve(v);
      }).then(function (acct) {
        return Account.history(acct.id, 100);
      }).then(function (rows) {
        if (!live(myGen, uiGen)) return;
        drawMine(poolMine(rows));
      }).catch(function (e) {
        if (!live(myGen, uiGen)) return;
        u.clearBox(listBox); u.showError(doc, listBox, e, t("pool.my_history_failed", "Could not load your swaps."));
        try {
          if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
            var typedHistLink = HistoryNotice.actionLink(doc, t, "settings");
            if (typedHistLink) listBox.appendChild(typedHistLink);
          }
        } catch (e2) { /* error panel stands without the link */ }
      });
    }
    viewBtn.addEventListener("click", loadTyped);
    if (!unlocked) {
      lockedHint();
      return;
    }
    /* Unlocked: prefill the wallet account id (convenience only). */
    try {
      if (typeof Account !== "undefined" && Account && typeof Account.myAccountId === "function") {
        Account.myAccountId().then(function (id) {
          if (!live(myGen, uiGen)) return;
          if (!fAcct.input.value && id) fAcct.input.value = String(id);
        }).catch(function () { /* auto-load below stands */ });
      }
    } catch (e) { /* auto-load below stands */ }
    u.showStatus(doc, listBox, t("account.loading_history", "Loading history…"));
    Account.myAccountId().then(function (myId) {
      return Account.history(myId, 100);
    }).then(function (rows) {
      if (!live(myGen, uiGen)) return;
      drawMine(poolMine(rows));
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return;
      u.clearBox(listBox); u.showError(doc, listBox, e, t("pool.my_history_failed", "Could not load your swaps."));
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          var myHistLink = HistoryNotice.actionLink(doc, t, "settings");
          if (myHistLink) listBox.appendChild(myHistLink);
        }
      } catch (e2) { /* error panel stands without the link */ }
    });
  }
  function slipOk(s) { /* slippage gate: 0.1-5% human, string math only */
    var m = /^(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
    if (!m) return false;
    var whole = parseInt(m[1], 10), frac = m[2] || "";
    if (whole > 5 || (whole === 5 && frac.replace(/0+$/, "") !== "")) return false;
    if (whole === 0 && frac.replace(/0+$/, "") === "") return false;
    if (whole === 0 && frac.length && parseInt((frac + "00").slice(0, 2), 10) < 10) return false;
    return frac.length <= 2;
  }
  /* quoteFor: CPMM quote + min-to-receive + confirm wiring for one pool.
   * Params: doc, ui helpers, generations, output boxes, resolved assets,
   * pool id, human sell amount + slippage %. Chain failures paint inline. */
  function quoteFor(doc, u, myGen, uiGen, quoteBox, actionBox, found, poolId, amtHuman, slipHuman) {
    u.clearBox(quoteBox); u.clearBox(actionBox);
    u.showStatus(doc, quoteBox, "Quoting…");
    Promise.resolve().then(async function () {
      if (!slipOk(slipHuman)) throw new Error("bad slippage (0.1-5%, <=2 decimals): " + slipHuman);
      var pool = await Pool.get(poolId);
      var joined = (await Pool.list({ share: pool.share_id }))[0] || null;
      var r = joined || pool;
      var sellIsA = (found.sell.id === r.asset_a_id);
      if (found.sell.id !== r.asset_a_id && found.sell.id !== r.asset_b_id)
        throw new Error(t("pool.err_not_in_pool", "order-trap (sell asset is not in this pool)"));
      var precSell = sellIsA ? r.prec_a : r.prec_b;
      var precRecv = sellIsA ? r.prec_b : r.prec_a;
      if (precSell === null || precSell === undefined) precSell = 5;
      if (precRecv === null || precRecv === undefined) precRecv = 5;
      var sellRaw = Format.parseAmount(amtHuman, precSell);
      var q = Pool.quote({ balanceA_raw: r.balance_a_raw, balanceB_raw: r.balance_b_raw, sell_raw: sellRaw, sellIsA: sellIsA });
      var minRaw = Pool.minReceive(q.out_raw, slipHuman);
      return { r: r, sellIsA: sellIsA, precSell: precSell, precRecv: precRecv, sellRaw: sellRaw, q: q, minRaw: minRaw };
    }).then(function (Q) {
      if (!live(myGen, uiGen)) return; u.clearBox(quoteBox);
      var recvHuman = Format.formatAmount(Q.minRaw, Q.precRecv);
      var sellHuman = Format.formatAmount(Q.sellRaw, Q.precSell);
      quoteBox.appendChild(u.el(doc, "p",
        "Quote: " + sellHuman + " " + found.sell.symbol + " → ~" + recvHuman + " " + found.buy.symbol +
        " (min, " + slipHuman + "% slip). Impact " + (Q.q.impact_bp / 100) + "%.", "muted"));
      quoteBox.lastChild.title = t("swap.quote_raw_prefix", "quote raw ") + Q.q.out_raw + t("swap.min_raw_suffix", "; min raw ") + Q.minRaw;
      var perLeg = u.el(doc, "p", "Pool legs: " + (Q.r.sym_a || Q.r.asset_a_id) + " / " + (Q.r.sym_b || Q.r.asset_b_id) +
        " — market fees apply per asset settings; pool taker " + Pool.pctUnitsToHuman(Q.r.taker_units) + "%.", "muted");
      quoteBox.appendChild(perLeg);
      u.reviewSection(doc, actionBox, uiGen, t("pool.review_swap", "Review swap"), {
        build: async function () {
          var me = await Account.resolve(await Account.myAccountId());
          var pair = Pool.buildExchange({ accountId: me.id, poolId: Q.r.id,
            sellHuman: amtHuman, precSell: Q.precSell, sellAssetId: found.sell.id,
            minRaw: Q.minRaw, recvAssetId: found.buy.id });
          return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
            prove: async function () {
              try {
                var cur = await Pool.get(Q.r.id);
                if (cur.balance_a_raw !== Q.r.balance_a_raw || cur.balance_b_raw !== Q.r.balance_b_raw) return cur;
              } catch (e) { return null; }
              try {
                var rows = await Pool.history(Q.r.id, 5);
                if (rows.some(function (h) { return h.op_type === 63; })) return { historyRow: true };
              } catch (e) { /* balance delta above is the proof */ }
              return null; } };
        },
        rows: function (R, fee) {
          var op = R.pair[1];
          return [[ t("pool.pool_row", "Pool"), Q.r.id + " (" + (Q.r.sym_a || Q.r.asset_a_id) + "/" + (Q.r.sym_b || Q.r.asset_b_id) + ")"],
            [t("account.card_account", "Account"),  whoText(R.me)],
            [t("account.sell_th", "Sell"),  sellHuman + " " + found.sell.symbol, "raw " + op.amount_to_sell.amount],
            [t("pool.quote_row", "Quote out (raw)"),  Q.q.out_raw],
            [t("pool.min_recv_row", "Min to receive"),  recvHuman + " " + found.buy.symbol, "raw " + Q.minRaw],
            [t("pool.slippage_row", "Slippage"),  slipHuman + "%"], [t("pool.impact_row", "Price impact"),  (Q.q.impact_bp / 100) + "%"],
            [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
        },
        title: t("pool.confirm_swap", "Confirm swap"), ok: function () { return t("pool.swapped", "Swapped."); }, fail: t("pool.swap_failed", "Could not prepare the swap.") });
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return; u.clearBox(quoteBox); u.showError(doc, quoteBox,e,t("pool.quote_failed", "Could not quote the swap."));
    });
  }
  return { renderSwap: renderSwap };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolSwapUI === "undefined") { globalThis.PoolSwapUI = PoolSwapUI; }
if (typeof module !== "undefined") { module.exports = PoolSwapUI; }
