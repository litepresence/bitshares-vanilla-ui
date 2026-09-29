/* MarketDesk: DEX desk shell for /market/:marketID (skeleton, fill, refresh).
 * Owns: route entry renderMarket(root, marketID), desk skeleton showDesk
 *   (header, charts hosts, book/trades-toggle/orders/trade/depth/stats cells,
 *   side picker rail, refresh + 15s timer with cleanup), data fill
 *   (book/stats/trades/my-trades/timeframes/candles — each section fails
 *   inline), last-visited market persistence (saveLast under LAST_KEY),
 *   timer/listener cleanup.
 *   LAYOUT (retro equal 2x3 grid + right rail — reference
 *   vanilla/notes/original-buy-sell-2x3-2026-09-28.png): chart stack on top
 *   (mkt-charts: price pane + volume pane + depth slice + oscillator panes
 *   + timeframe), then row 1 Buy panel | Sell panel | trades toggle, then
 *   row 2 BUY ORDERS (bids) | SELL ORDERS (asks) | my open orders — six
 *   equal thirds on desktop (grid-template-columns 1fr 1fr 1fr + 320px
  *   rail), single-column stack on phones <1200px. GAP FIX: the six cells
  *   are grouped in three column stacks (buy+bids | sell+asks |
  *   trades+orders, .mkt-col-* in desk-grid.css) so row heights no longer
  *   couple — the tall trades cell used to strand a ~400px void under the
  *   forms. Same six cells, same desktop thirds, same phone order. The 24h stats strip lives
 *   in the head (MarketInd.renderStrip); there is no stats grid cell. Grid
 *   areas live in desk-grid.css (.mkt-exchange scope; the pool desk keeps
 *   the legacy .mkt areas).
 *   TRADES TOGGLE (mirrors #1 MarketHistory tabs): one trades cell holds
 *   Recent (activeMarketHistory, Exchange.jsx:2551-2581 activeTab "history")
 *   and My (myMarketHistory, Exchange.jsx:2583-2616 activeTab "my_history")
 *   panes behind Recent/My buttons (MarketHistory.jsx:21 historyTab default
 *   "history", :127-139 changeTab persists to viewSettings; vanilla keeps the
 *   tab in desk state only). My pane needs unlock: locked wallets get the
 *   honest Wallet-link hint (same contract as MarketOrders locked hint).
 *   Picker rendering delegates to MarketPicker, strip/timeframes/charts to
 *   MarketInd, book/recent-trades to MarketBook, my-orders to MarketOrders,
 *   panels to TradeUI (all via lazy globals — same convention as before).
 * Consumes: Market (book/stats/trades/timeframes/candles/assets/parseId),
 *   Format (via book/orders views, never directly), Store (network for
 *   defaults + connection wait), Chain.status. No signing, no cancel path.
 * Globals/side effects: DOM under the router root, localStorage last-market
 *   key (read half lives in market-ui.js homeTarget — same key string, single
 *   reader + single writer), one refresh timer + resize/theme listeners (all
 *   cleared on route change); global MarketDesk only.
 * Created by: building-vanilla-slices skill, slice-18 audit (market-ui split —
 *   renderMarket/showDesk/fill/cleanup moved verbatim from market-ui.js;
 *   fill-nested strip/timeframe/chart bodies now live in market-ind.js and are
 *   called here as MarketInd.* with (doc, state); call sites unchanged).
 *
 * PRICE DISPLAY: book levels, ticker fields and trade prices render the
 *   chain-human strings verbatim (proven base-per-quote, market.js header).
 *   Spread/midpoint use exact decimal-string math in MarketBook — binary
 *   float never touches money. Number() appears ONLY for depth-bar widths
 *   and time trimming (pixels).
 *
 * DEFAULT MARKET (no guessing): bitshares-ui/app/branding.js:98-108
 *   getDefaultMarket() returns "USD_TEST" on testnet, "BTS_CNY" on mainnet.
 *   "/" redirects to the last-visited market when stored and valid, else that
 *   network default (homeTarget lives in market-ui.js, the stable entry).
 * Side wording (bid/ask) follows Exchange.jsx:265-296 (bid sells the market
 *   base, ask sells the market quote); for_sale denomination is
 *   sell_price.base.asset_id per market_object.hpp:50.
 */
var MarketDesk = (function () {
  "use strict";

  var REFRESH_MS = 15000;
  var LAST_KEY = "bts-vanilla-last-market-v1";

  var _timer = null;
  var _cleanups = [];

  /* Batch-2b i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Element helper: textContent only, user/chain strings never reach HTML. */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);
    return wrap;
  }

  /* Run every registered cleanup (timer, resize/theme listeners). Called on
   * each entry so no cross-page timers or listeners ever leak. */
  function cleanup() {
    if (_timer !== null) {
      try { clearInterval(_timer); } catch (e) { /* already gone */ }
      _timer = null;
    }
    var fns = _cleanups;
    _cleanups = [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](); } catch (e) { /* cleanup must not throw */ }
    }
  }

  /* Network from Store (sole settings owner); mainnet when unreadable. */
  function network() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* Canonical default market per bitshares-ui/app/branding.js:98-108. */
  function defaultMarket() {
    return network() === "testnet" ? "USD_TEST" : "BTS_CNY";
  }

  /* Last-visited market id (own key: Store.saveSettings drops unknown keys,
   * so view state lives here, never in settings). */
  function saveLast(id) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(LAST_KEY, id);
    } catch (e) { /* private mode: desk still works, just not remembered */ }
  }

  /* Inline error panel (aria-live); chain error shapes map to sentences. */
  function showError(doc, wrap, e, fallback) {
    var err = el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("market.err_unexpected", "Unexpected error"));
    if (msg.indexOf("bad-market") !== -1) {
      msg = "Unknown market. Check the QUOTE_BASE pair (e.g. " + defaultMarket() + ").";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("market.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("market.err_history", "History unavailable on this node (fills and charts need the history plugin).");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("market.err_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("market.err_offline", "Network unavailable. Check Settings → Nodes and retry.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
    return err;
  }

  /* Raw-JSON <details> block for a section ( P R O O F, not decoration).
   * Triangle-only summary per the shared details.raw contract in app.css. */
  function rawDetails(doc, section, label, value) {
    var d = doc.createElement("details");
    d.className = "raw";
    var s = doc.createElement("summary");
    s.setAttribute("aria-label", label || t("market.raw_fallback", "Show raw JSON"));
    touchable(s);
    d.appendChild(s);
    var pre = doc.createElement("pre");
    try {
      pre.textContent = JSON.stringify(value, null, 2);
    } catch (e) {
      pre.textContent = String(value);
    }
    d.appendChild(pre);
    section.appendChild(d);
  }

  /* Route entry: renderMarket(root, marketID). Empty ids show the picker with
   * an empty state; malformed ids render a 404-style panel; everything else
   * waits for the shared connection, then builds the desk. */
  function renderMarket(root, marketID) {
    cleanup();
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    /* Dense desk earns wide screens (§3.6): plain .wrap caps at 720px, so the
     * desk gets .mkt-wrap (1400px cap) and the ≥1200px 3-column grid breathes.
     * (NOT .wrap.wide — that turns the wrapper itself into a 12-col grid.) */
    wrap.className = "wrap mkt-wrap";
    if (typeof Market === "undefined" || !Market ||
        typeof Format === "undefined" || !Format ||
        typeof Indicators === "undefined" || !Indicators ||
        typeof MarketCharts === "undefined" || !MarketCharts ||
        typeof MarketPicker === "undefined" || !MarketPicker ||
        typeof MarketInd === "undefined" || !MarketInd) {
      showError(doc, wrap, t("market.backend_missing", "Market backend missing: js/market.js, js/format.js, js/indicators.js, js/market-charts.js, js/market-picker.js or js/market-ind.js failed to load."));
      return;
    }
    if (typeof marketID !== "string" || !marketID) {
      wrap.appendChild(el(doc, "h1", t("market.title", "Exchange")));
      wrap.appendChild(el(doc, "p", t("market.pick_to_start", "Pick a market to start."), "muted"));
      var emptySec = doc.createElement("section");
      emptySec.className = "mkt-side";
      wrap.appendChild(emptySec);
      MarketPicker.renderPicker(doc, emptySec, "", root);
      return;
    }
    var pair;
    try {
      pair = Market.parseId(marketID);
    } catch (e) {
      wrap.appendChild(el(doc, "h1", t("market.not_found", "Market not found")));
      showError(doc, wrap, e, t("market.err_unknown", "Unknown market."));
      return;
    }
    var id = (pair.quote + "_" + pair.base).toUpperCase();
    saveLast(id);

    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", t("market.connecting", "Connecting to network…"), "muted"));
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderMarket(root, id);
        }
      });
      var timer = setTimeout(function () {
        if (settled) return; settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        clearRoot(root);
        var failed = makeWrap(doc, root);
        failed.appendChild(el(doc, "h1", t("market.title", "Exchange")));
        showError(doc, failed, new Error("not connected"), t("market.err_offline_short", "Network unavailable."));
        var retry = touchable(el(doc, "button", t("market.retry", "Retry")));
        retry.id = "mkt-retry";
        retry.type = "button";
        retry.addEventListener("click", function () { renderMarket(root, id); });
        failed.appendChild(retry);
      }, 15000);
      return;
    }
    showDesk(doc, wrap, root, pair, id, hashAtEntry);
  }

  /* Desk skeleton: header, charts, book, trades, side (picker+stats), orders.
   * Each section fills independently and fails inline; Refresh + 15s timer
   * re-run the fill; the timer self-clears when the hash moves away. */
  function showDesk(doc, wrap, root, pair, id, hashAtEntry) {
    var state = {
      id: id, pair: pair, root: root, doc: doc, wrap: wrap,
      assets: null, loading: false, redraw: null,
      /* Slice-07 Task 4 chart state: bucket default 3600 reconciled with the
       * live list on first fill; logScale is a pure priceScale mode switch
       * (no refetch); overlays default to the pre-slice look (SMA10+EMA50). */
      bucket: 3600, tfInit: false, logScale: false,
      /* Toggleable plots (menu "Plots" group): VWAP strip + depth slice + pool map.
       * Only the price pane is always on; depth + pool map default on, VWAP off. */
      showVwap: false, showDepth: true, showPoolMap: true,
      /* Depth scales ship log/log (far-spam prices + dust volumes stay
       * legible); toggles in the depth cell flip either axis. */
      depthLogX: true, depthLogY: true,
      over: { sma: [{ p: 10 }], ema: [{ p: 50 }] },
      /* Task 4b stacked panes: one checkbox per key below; MACD stays on by
       * default to preserve the Task-4 look. panes.oscs maps key -> pane
       * handle from drawOscPane; paneEls maps key -> {wrap, body} DOM nodes.
       * oscBoxes maps key -> checkbox input (x buttons uncheck through it). */
      osc: { volume: true, rsi: false, macd: true, stoch: false, atr: false, fisher: false },
      panes: { price: null, oscs: {} },
      paneEls: {}, oscBoxes: {},
      ticker: null, countNote: null, tfBox: null, oscNote: null,
      /* Pool-map provenance slice (2-layer BTS-core map, own canvas — never blocks desk). */
      graphWrap: null, graphCanvas: null, graphNote: null, graphData: null
    };

    var desk = el(doc, "div", null, "mkt mkt-exchange");
    wrap.appendChild(desk);

    var head = doc.createElement("section");
    head.className = "mkt-head";
    desk.appendChild(head);
    head.appendChild(el(doc, "h1", pair.quote + " / " + pair.base));
    var sub = el(doc, "p", t("market.loading", "Loading market…"), "muted");
    head.appendChild(sub);
    /* Slice-16 bell: price-alert entry point (ExchangeHeader.jsx:210-232
     * shape, link flavour — opens #/alerts, never a modal). Optional: the
     * desk works fully when notify-ui.js is absent. */
    try {
      if (typeof NotifyHost !== "undefined" && NotifyHost &&
          typeof NotifyHost.bellFor === "function") {
        var bell = NotifyHost.bellFor(pair.quote, pair.base);
        if (bell) head.appendChild(bell);
      }
    } catch (e) { /* alerts optional, desk unaffected */ }
    /* Header stats strip (toward #1): Latest / 24h change / 24h volume /
     * Best bid-ask — compact row above the charts, theme-aware via CSS. */
    var strip = doc.createElement("div");
    strip.className = "mkt-statstrip";
    strip.setAttribute("aria-live", "polite");
    head.appendChild(strip);
    state.strip = strip;
    var spreadLine = el(doc, "p", "", "muted");
    head.appendChild(spreadLine);
    /* Raw-ticker proof host (triangle-only details, refilled per stats
     * fetch — the 24h dl panel is gone with the stats grid cell). */
    var tickerRaw = doc.createElement("div");
    head.appendChild(tickerRaw);

    var chartsSec = doc.createElement("section");
    chartsSec.className = "mkt-charts";
    desk.appendChild(chartsSec);
    chartsSec.appendChild(el(doc, "h2", t("market.charts", "Charts")));

    /* Charts restyle: controls-left rail + zero-gap plots column.
     * div.mkt-chartgrid > div.mkt-controls + div.mkt-plots (shared with the
     * pool desk chartPane — one CSS block serves both). Controls hold the
     * timeframe radios, count note, indicator menu + Log/Invert, and the
     * depth scale toggles; plots hold priceHost + VWAP wrap (drawVwap
     * inserts it as priceHost.nextSibling, so it lands in plots) + oscHost
     * + oscNote. Ids, listeners, and state fields are unchanged — only DOM
     * parenting moves. */
    var chartGrid = doc.createElement("div");
    chartGrid.className = "mkt-chartgrid";
    chartsSec.appendChild(chartGrid);
    var controls = doc.createElement("div");
    controls.className = "mkt-controls";
    chartGrid.appendChild(controls);
    var plots = doc.createElement("div");
    plots.className = "mkt-plots";
    chartGrid.appendChild(plots);

    /* Timeframe radios (from the live bucket list) + candle count note. */
    var tfBox = doc.createElement("div");
    tfBox.className = "mkt-tfrow";
    tfBox.setAttribute("role", "radiogroup");
    tfBox.setAttribute("aria-label", t("market.timeframe_label", "Candle timeframe"));
    controls.appendChild(tfBox);
    state.tfBox = tfBox;
    var countNote = el(doc, "p", "", "muted mkt-count-note");
    countNote.setAttribute("aria-live", "polite");
    controls.appendChild(countNote);
    state.countNote = countNote;

    /* Chart options row: shared indicator dropdown menu (overlays +
     * oscillators in grouped checkboxes) + Log/Invert. The menu binds the
     * same state.over/state.osc/state.oscBoxes contract the old sprawling
     * rows used — only the control UI changed. */
    var indRow = doc.createElement("div");
    indRow.className = "mkt-indrow";
    controls.appendChild(indRow);
    if (typeof MarketInd !== "undefined" && MarketInd && typeof MarketInd.renderIndMenu === "function") {
      MarketInd.renderIndMenu(doc, indRow, state);
    }
    var logLab = doc.createElement("label");
    logLab.className = "mkt-ind";
    var logBox = doc.createElement("input");
    logBox.type = "checkbox";
    logBox.checked = false;
    logBox.setAttribute("aria-label", t("market.log_scale_label", "Logarithmic price scale"));
    touchable(logBox);
    logBox.addEventListener("change", function () {
      state.logScale = logBox.checked;
      MarketInd.drawCharts(state);
    });
    logLab.appendChild(logBox);
    logLab.appendChild(el(doc, "span", t("market.log_label", "Log")));
    indRow.appendChild(logLab);
    /* Invert toggle (ported from DEX-UX): re-render the swapped QUOTE_BASE
     * pair via the hash router — cheap, no state to keep in sync. */
    var invBtn = touchable(el(doc, "button", t("market.invert", "Invert")));
    invBtn.type = "button";
    invBtn.id = "mkt-invert";
    invBtn.setAttribute("aria-label", t("market.invert_label", "Invert market pair"));
    invBtn.addEventListener("click", function () {
      try {
        var p = Market.parseId(state.id);
        if (typeof window !== "undefined" && window.location) {
          window.location.hash = "#/market/" + p.base + "_" + p.quote;
        }
      } catch (e) { /* malformed id: router already shows 404 */ }
    });
    indRow.appendChild(invBtn);

    /* Price pane host (LightweightCharts candles, canvas fallback inside). */
    var priceHost = doc.createElement("div");
    priceHost.id = "mkt-price-host";
    priceHost.className = "mkt-price-host";
    plots.appendChild(priceHost);

    /* Stacked pane container: drawCharts reconciles one child wrapper per
     * checked key (in OSC_ORDER); nothing checked -> no children at all,
     * never a blank box. (Picker menu above owns the checkboxes.) */
    var oscHost = doc.createElement("div");
    oscHost.id = "mkt-osc-host";
    oscHost.className = "mkt-osc-host";
    plots.appendChild(oscHost);
    var oscNote = el(doc, "p", "", "muted");
    oscNote.setAttribute("aria-live", "polite");
    plots.appendChild(oscNote);
    state.oscNote = oscNote;

    /* ROW 1 col 1+2: Buy + Sell panels (BuySell bid/ask pair,
     * Exchange.jsx:2089-2210 — two panels side by side, always visible).
     * TradeUI owns the panels; the desk only hosts the mounts. Headings
     * name the side + QUOTE symbol (reference 2x3 shot: BUY BTS/SELL BTS);
     * the Scaled swap lives on the buy panel's own tab row.
     * GAP FIX (desk columns): the six desk cells live in three column
     * stacks (buy+bids | sell+asks | trades+orders) so a tall trades cell
     * can no longer stretch the buy/sell row and strand a void under the
     * forms (measured 340-397px at 1440px: trades 931px vs buy 591px).
     * Below 1200px the columns dissolve (display:contents) and the six
     * cells stack by their own grid areas in the original order — phones
     * keep the established sequence; ids/listeners/fill paths untouched. */
    var colBuy = doc.createElement("div");
    colBuy.className = "mkt-col-buy";
    var colSell = doc.createElement("div");
    colSell.className = "mkt-col-sell";
    var colTrade = doc.createElement("div");
    colTrade.className = "mkt-col-trades";
    desk.appendChild(colBuy);
    desk.appendChild(colSell);
    desk.appendChild(colTrade);
    var buySec = doc.createElement("section");
    buySec.className = "mkt-buy";
    colBuy.appendChild(buySec);
    buySec.appendChild(el(doc, "h2", "Buy " + pair.quote));
    var buyMount = doc.createElement("div");
    buySec.appendChild(buyMount);

    var sellSec = doc.createElement("section");
    sellSec.className = "mkt-sell";
    colSell.appendChild(sellSec);
    sellSec.appendChild(el(doc, "h2", "Sell " + pair.quote));
    var sellMount = doc.createElement("div");
    sellSec.appendChild(sellMount);

    /* ROW 1 col 2: trades toggle — Recent vs My (ONE cell, two panes).
     * Mirrors #1's tab group 1: marketHistory (Exchange.jsx:2551-2581,
     * activeTab "history") + myMarketHistory (Exchange.jsx:2583-2616,
     * activeTab "my_history"), default active my_history per
     * Exchange.jsx:362-371 panelTabs {my_history:1, history:1} +
     * panelTabsActive {1:"my_history"}. Vanilla defaults to Recent (public
     * chain data renders with NO login per principle #9); My needs unlock
     * with the honest Wallet-link hint. Buttons keep >=44px touch targets. */
    var tradesSec = doc.createElement("section");
    tradesSec.className = "mkt-trades";
    colTrade.appendChild(tradesSec);
    tradesSec.appendChild(el(doc, "h2", t("market.trades_title", "Trades")));
    var tradesTabs = doc.createElement("div");
    tradesTabs.className = "mkt-tabs";
    tradesTabs.setAttribute("role", "tablist");
    tradesTabs.setAttribute("aria-label", t("market.trades_toggle_label", "Recent or my trades"));
    var tabRecent = touchable(el(doc, "button", t("market.tab_recent", "Recent trades")));
    tabRecent.type = "button";
    tabRecent.id = "mkt-trades-tab-recent";
    tabRecent.setAttribute("role", "tab");
    var tabMy = touchable(el(doc, "button", t("market.tab_my", "My trades")));
    tabMy.type = "button";
    tabMy.id = "mkt-trades-tab-my";
    tabMy.setAttribute("role", "tab");
    tradesTabs.appendChild(tabRecent);
    tradesTabs.appendChild(tabMy);
    tradesSec.appendChild(tradesTabs);
    var recentBody = doc.createElement("div");
    recentBody.id = "mkt-trades-recent";
    recentBody.setAttribute("role", "tabpanel");
    tradesSec.appendChild(recentBody);
    var myBody = doc.createElement("div");
    myBody.id = "mkt-trades-my";
    myBody.setAttribute("role", "tabpanel");
    tradesSec.appendChild(myBody);
    state.tradesTab = "recent";
    state.tabRecent = tabRecent;
    state.tabMy = tabMy;
    state.recentBody = recentBody;
    state.myBody = myBody;
    /* paintTradesTab: show the recent-fills or my-fills pane per
     * state.tradesTab (ARIA pressed/selected follow). Pure DOM, never throws. */
    function paintTradesTab() {
      var isMy = state.tradesTab === "my";
      tabRecent.setAttribute("aria-selected", isMy ? "false" : "true");
      tabMy.setAttribute("aria-selected", isMy ? "true" : "false");
      tabRecent.setAttribute("aria-pressed", isMy ? "false" : "true");
      tabMy.setAttribute("aria-pressed", isMy ? "true" : "false");
      recentBody.style.display = isMy ? "none" : "";
      myBody.style.display = isMy ? "" : "none";
    }
    tabRecent.addEventListener("click", function () {
      state.tradesTab = "recent";
      paintTradesTab();
    });
    tabMy.addEventListener("click", function () {
      state.tradesTab = "my";
      paintTradesTab();
      renderMyTrades(doc, state);
    });
    paintTradesTab();

    /* ROW 2 col 1+2: split book (OrderBook Exchange.jsx:2466-2537, same
     * sides): BUY ORDERS (bids) | SELL ORDERS (asks) as two equal cells.
     * MarketBook.renderSplit fills both through the shared row builder;
     * each cell owns a fixed-height scroll region like the old book. */
    var bidsSec = doc.createElement("section");
    bidsSec.className = "mkt-bids";
    colBuy.appendChild(bidsSec);
    bidsSec.appendChild(el(doc, "h2", "Buy orders"));
    var bidsBody = doc.createElement("div");
    bidsSec.appendChild(bidsBody);

    var asksSec = doc.createElement("section");
    asksSec.className = "mkt-asks";
    colSell.appendChild(asksSec);
    asksSec.appendChild(el(doc, "h2", "Sell orders"));
    var asksBody = doc.createElement("div");
    asksSec.appendChild(asksBody);

    /* ROW 2 col 3: my open orders (MarketOrders Exchange.jsx:2618-2654,
     * activeTab "my_orders"; settlement Exchange.jsx:2656-2693 activeTab
     * "open_settlement" stays a future tab — vanilla shows my_orders only,
     * honest scope, no silent stub). */
    var ordersSec = doc.createElement("section");
    ordersSec.className = "mkt-orders";
    colTrade.appendChild(ordersSec);
    ordersSec.appendChild(el(doc, "h2", t("market.my_orders", "My open orders")));
    var ordersBody = doc.createElement("div");
    ordersSec.appendChild(ordersBody);

    /* Depth slice: the cumulative-depth canvas lives in the charts stack as
     * an osc-sized slice (under Volume, above oscillators — drawCharts pins
     * state.depthWrap at stack index 1), not a grid cell. DepthHighChart
     * Exchange.jsx:2716-2751 is the #1 counterpart; vanilla draws from the
     * same book via MarketInd. Same canvas, same log/log toggles. */
    var depthWrap = doc.createElement("div");
    depthWrap.className = "mkt-osc-pane";
    var depthHead = doc.createElement("div");
    depthHead.className = "mkt-osc-head";
    depthHead.appendChild(el(doc, "span", t("market.depth_title", "Depth"), "mkt-osc-title"));
    depthWrap.appendChild(depthHead);
    /* Scale toggles (ship log/log: far-spam prices and dust-to-whale
     * volumes both stay legible; linear stays one tap away). Session-only,
     * same pattern as the price-pane Log toggle. Charts restyle: the toggles
     * live in the controls rail (same buttons, same state keys, same redraw
     * path) — the depth pane keeps head + canvas only so the plots column
     * stays a zero-gap stack. */
    var scaleRow = doc.createElement("div");
    scaleRow.className = "mkt-scalerow";
    controls.appendChild(scaleRow);
    function scaleBtn(key, logKey, linKey, redrawBars) {
      var b = touchable(el(doc, "button", ""));
      b.type = "button";
      /* paint: relabel this scale toggle from state (log/lin pair). */
      function paint() {
        var on = !!state[key];
        b.textContent = on ? t(logKey[0], logKey[1]) : t(linKey[0], linKey[1]);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
      paint();
      b.addEventListener("click", function () {
        state[key] = !state[key];
        paint();
        /* Volume scale also re-shades the book rows (bars share the chart
         * scale); price scale only redraws the chart. */
        if (redrawBars) fill(state);
        else MarketInd.drawCharts(state);
      });
      scaleRow.appendChild(b);
      return { repaint: paint };
    }
    state._scalePainters = [
      scaleBtn("depthLogX", ["market.px_log", "Price: Log"], ["market.px_lin", "Price: Linear"], false),
      scaleBtn("depthLogY", ["market.vol_log", "Vol: Log"], ["market.vol_lin", "Vol: Linear"], true)
    ];
    var depthCanvas = doc.createElement("canvas");
    depthCanvas.id = "mkt-depth-canvas";
    depthCanvas.className = "mkt-canvas";
    depthWrap.appendChild(depthCanvas);
    oscHost.appendChild(depthWrap);
    state.depthWrap = depthWrap;
    /* Pool-map provenance slice: .mkt-osc-pane titled "Pool map" in oscHost.
     * Own canvas + loading note; drawCharts pins graphWrap right after
     * depthWrap (index 2-ish). Lazy async fetch never blocks the desk. */
    var graphWrap = doc.createElement("div");
    graphWrap.className = "mkt-osc-pane";
    var graphHead = doc.createElement("div");
    graphHead.className = "mkt-osc-head";
    graphHead.appendChild(el(doc, "span", "Pool map", "mkt-osc-title"));
    graphWrap.appendChild(graphHead);
    var graphCanvas = doc.createElement("canvas");
    graphCanvas.className = "mkt-canvas";
    graphWrap.appendChild(graphCanvas);
    var graphNote = el(doc, "p", "Loading pool map…", "muted");
    graphNote.setAttribute("aria-live", "polite");
    graphWrap.appendChild(graphNote);
    oscHost.appendChild(graphWrap);
    state.graphWrap = graphWrap;
    state.graphCanvas = graphCanvas;
    state.graphNote = graphNote;

    /* SIDE RAIL full-height: market picker only (MyMarkets Exchange.jsx:2428
     * right rail; vanilla MarketPicker renders the curated+search list).
     * (No stats cell: the 24h strip lives in the head via renderStrip.) */
    var sideSec = doc.createElement("section");
    sideSec.className = "mkt-side";
    desk.appendChild(sideSec);
    MarketPicker.renderPicker(doc, sideSec, id, root);

    var foot = doc.createElement("div");
    foot.className = "mkt-foot";
    var refreshBtn = touchable(el(doc, "button", t("market.refresh", "Refresh")));
    refreshBtn.id = "mkt-refresh";
    refreshBtn.type = "button";
    foot.appendChild(refreshBtn);
    var updated = el(doc, "span", "", "muted");
    foot.appendChild(updated);
    desk.appendChild(foot);
    refreshBtn.addEventListener("click", function () { fill(state); });

    state.head = head;
    state.sub = sub;
    state.spreadLine = spreadLine;
    state.tickerRaw = tickerRaw;
    state.priceHost = priceHost;
    state.oscHost = oscHost;
    state.depthCanvas = depthCanvas;
    state.bidsBody = bidsBody;
    state.asksBody = asksBody;
    state.tradesBody = recentBody;
    state.recentBody = recentBody;
    state.myBody = myBody;
    state.buyMount = buyMount;
    state.sellMount = sellMount;
    state.ordersBody = ordersBody;
    state.updated = updated;
    state.chartData = null;
    /* Deep-candles Task 4: live-tip mode + depth flag for the count note.
     * paintNote() reuses MarketInd.paintCountNote (no market-ind.js edit)
     * then appends " · deep|chain-only · live|poll|off". Fill's own
     * paintCountNote calls stay untouched; live/poll handlers call this. */
    state.liveMode = "off";
    state.deep = false;
    function paintNote() {
      try {
        if (typeof MarketInd !== "undefined" && MarketInd &&
            typeof MarketInd.paintCountNote === "function") {
          MarketInd.paintCountNote(state);
        }
      } catch (e) { /* note best-effort */ }
      try {
        if (state.countNote) {
          state.countNote.textContent += " · " + (state.deep ? "deep" : "chain-only") +
            " · " + (state.liveMode || "off");
        }
      } catch (e) { /* DOM gone */ }
    }

    /* LWC panes hold canvases + listeners outside the canvas 2D path, so
     * route change must removePane them (clearRoot alone leaks listeners).
     * Stacked state: price handle plus one handle per live sub-pane key. */
    _cleanups.push(function () {
      try {
        if (typeof MarketCharts !== "undefined" && MarketCharts &&
            typeof MarketCharts.removePane === "function") {
          MarketCharts.removePane(state.panes.price);
          Object.keys(state.panes.oscs || {}).forEach(function (k) {
            MarketCharts.removePane(state.panes.oscs[k]);
          });
        }
      } catch (e) { /* teardown must not throw */ }
      state.panes.price = null;
      state.panes.oscs = {};
      state.paneEls = {};
    });

    state.redraw = function () {
      MarketInd.drawCharts(state);
      try { redrawPoolMap(doc, state); } catch (e) { /* graph best-effort */ }
    };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      var onResize = function () { state.redraw(); };
      window.addEventListener("resize", onResize);
      _cleanups.push(function () {
        try { window.removeEventListener("resize", onResize); } catch (e) { /* gone */ }
      });
    }
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
        var offTheme = Store.subscribe("settings", function () { state.redraw(); });
        _cleanups.push(offTheme);
      }
    } catch (e) { /* theme redraw is best-effort */ }

    _timer = setInterval(function () {
      try {
        if (typeof location !== "undefined" &&
            String(location.hash || "").toUpperCase().indexOf(state.id) === -1) {
          cleanup();
          return;
        }
      } catch (e) { /* headless: keep polling off */ }
      fill(state);
    }, REFRESH_MS);

    Market.assets(pair.quote, pair.base).then(function (assets) {
      state.assets = assets;
      sub.textContent = assets.quote.symbol + " (" + assets.quote.id + ") / " +
        assets.base.symbol + " (" + assets.base.id + ")";
      fill(state);
      /* Pool-map provenance (lazy, never blocks desk; stale-route guarded). */
      try { fetchPoolMap(doc, state); } catch (e) { /* graph best-effort */ }
      /* Strip feed + settlement (retro round 2 D1: one lookup + one object
       * fetch per desk; fail-open, never blocks desk). */
      try { fetchFeed(doc, state); } catch (e) { /* feed best-effort */ }
      /* Deep-candles Task 4: live tip with poll fallback (exactness-first:
       * re-fetch the tip window via Market.candles + Market.stats — no
       * hand-rolled money math. Push path is Chain.subscribeMarket with a
       * 500ms debounce; failure or a missing slot falls back to a 3.5s poll.
       * The 15s fill(state) timer above stays the floor; this only patches
       * the tip between full fills. Route-gen guarded: every continuation
       * checks deskAlive() so a dead desk never paints or resubscribes. */
      (function startLiveTip() {
        var b = assets.base, q = assets.quote;
        /* deskAlive: true while this desk's hash is still the live route.
         * Params: none. Returns boolean. Never throws. */
        function deskAlive() {
          try {
            return String((typeof location !== "undefined" && location.hash) || "")
              .toUpperCase().indexOf(state.id) !== -1;
          } catch (e) { return true; }
        }
        /* refreshTip: re-fetch tip candles + ticker, repaint chart + strip.
         * Skips while a full fill is in flight. Failures silent (poll/live
         * retry covers). */
        function refreshTip() {
          if (!deskAlive()) return;
          if (state.loading) return;
          var count = 200;
          try {
            if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) {
              count = MarketInd.CANDLE_COUNT;
            }
          } catch (e) { /* default stands */ }
          try {
            Market.candles(b.id, q.id, state.bucket, count).then(function (c) {
              if (!deskAlive()) return;
              state.candles = c;
              try { state.deep = !!(c && c.deep); } catch (e) { state.deep = false; }
              try {
                if (typeof MarketInd !== "undefined" && MarketInd &&
                    typeof MarketInd.maybeDraw === "function") MarketInd.maybeDraw(state);
              } catch (e) { /* chart best-effort */ }
              paintNote();
            }).catch(function () { /* tip best-effort; live/poll retries */ });
          } catch (e) { /* Market missing: live/poll retries */ }
          try {
            Market.stats(b.id, q.id).then(function (st) {
              if (!deskAlive()) return;
              state.ticker = st;
              try {
                if (typeof MarketInd !== "undefined" && MarketInd &&
                    typeof MarketInd.renderStrip === "function") MarketInd.renderStrip(doc, state);
              } catch (e) { /* strip best-effort */ }
            }).catch(function () { /* stats best-effort */ });
          } catch (e) { /* stats best-effort */ }
        }
        var pushTimer = null;
        _cleanups.push(function () {
          try { if (pushTimer !== null) clearTimeout(pushTimer); } catch (e) { /* gone */ }
          pushTimer = null;
        });
        /* onPush: market-notice handler — 500ms debounce, then refreshTip.
         * Payload ignored (exactness-first: re-fetch the window). */
        function onPush() {
          if (!deskAlive()) return;
          try { if (pushTimer !== null) clearTimeout(pushTimer); } catch (e) { /* gone */ }
          try {
            pushTimer = setTimeout(function () {
              pushTimer = null;
              refreshTip();
            }, 500);
          } catch (e) { /* timers unavailable */ }
        }
        /* startPoll: 3.5s light-poll fallback (skips when tab hidden).
         * Registered in _cleanups so route change stops it. */
        function startPoll() {
          state.liveMode = "poll";
          paintNote();
          try {
            var pollTimer = setInterval(function () {
              if (!deskAlive()) return;
              try {
                if (typeof document !== "undefined" && document.hidden) return;
              } catch (e) { /* headless: keep polling */ }
              refreshTip();
            }, 3500);
            _cleanups.push(function () {
              try { clearInterval(pollTimer); } catch (e) { /* gone */ }
            });
          } catch (e) { /* timers unavailable: live tip stays off */ }
        }
        try {
          if (typeof Chain !== "undefined" && Chain &&
              typeof Chain.subscribeMarket === "function") {
            Chain.subscribeMarket(b.id, q.id, onPush).then(function (unsub) {
              if (!deskAlive()) {
                try { if (typeof unsub === "function") unsub(); } catch (e) { /* gone */ }
                return;
              }
              state.liveMode = "live";
              paintNote();
              if (typeof unsub === "function") _cleanups.push(unsub);
            }).catch(function () { startPoll(); });
          } else {
            startPoll();
          }
        } catch (e) { startPoll(); }
      })();
      /* Slice-06 hook: one renderDual call with the ctx the desk holds
       * (Buy + Sell panels). TradeUI gates on unlock itself. */
      try {
        if (typeof TradeUI !== "undefined" && TradeUI &&
            typeof TradeUI.renderDual === "function") {
          TradeUI.renderDual(doc, buyMount, sellMount, {
            base: assets.base.id,
            quote: assets.quote.id,
            basePrec: assets.base.precision,
            quotePrec: assets.quote.precision,
            baseSym: assets.base.symbol,
            quoteSym: assets.quote.symbol,
            myId: null,
            refresh: function () { fill(state); }
          });
        }
      } catch (e) { /* TradeUI paints its own errors inline */ }
    }).catch(function (e) {
      sub.textContent = pair.quote + " / " + pair.base;
      showError(doc, head, e, "Unknown market.");
    });
  }

  /* My-trades pane (mirrors #1 myMarketHistory, Exchange.jsx:2583-2616 +
   * MarketHistory.jsx:159-204): the wallet account's fill_order ops (op 4,
   * protocol/operations.hpp:60) filtered to this QUOTE_BASE pair
   * (pays/receives touch both legs, MarketHistory.jsx:176-184). Anyone can
   * type an account (name or 1.2.N) + Look up to preview ITS fills via
   * public Account.history; blank + locked keeps the Wallet-link hint
   * (principle #9: reads never gate on unlock, but MY fills need a key).
   * Unlocked prefills the wallet account; the wallet auto-load is unchanged.
   * Amounts/prices go through Format (BigInt, 8 places like Market.trades)
   * — never raw integers (#6). */
  function renderMyTrades(doc, state) {
    var host = state.myBody || state.tradesBody;
    var assets = state.assets;
    if (!host || !assets) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    var tok = (state._myGen = (state._myGen || 0) + 1);
    /* live: this my-trades render is still current (generation token
     * matches and the desk hash is still on this market). Stale async
     * fills must not paint. */
    function live() {
      if (tok !== state._myGen) return false;
      try {
        if (String((typeof location !== "undefined" && location.hash) || "").toUpperCase().indexOf(state.id) === -1) return false;
      } catch (e) { /* headless: hash guard skipped */ }
      return true;
    }
    var unlocked = false;
    try {
      unlocked = typeof Wallet !== "undefined" && Wallet &&
        (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
    } catch (e) { unlocked = false; }
    /* Typed-account preview row (public reads only). */
    var acctRow = doc.createElement("div");
    var lab = el(doc, "span", t("account.card_account", "Account") + " ");
    var acctInput = doc.createElement("input");
    acctInput.type = "text";
    acctInput.setAttribute("placeholder", t("ticket.name_or_1_2_n", "name or 1.2.N"));
    acctInput.setAttribute("aria-label", t("account.card_account", "Account"));
    acctInput.style.minHeight = "44px";
    acctInput.style.width = "12em";
    var viewBtn = touchable(el(doc, "button", t("referrals.look_up", "Look up")));
    viewBtn.type = "button";
    acctRow.appendChild(lab);
    acctRow.appendChild(acctInput);
    acctRow.appendChild(doc.createTextNode(" "));
    acctRow.appendChild(viewBtn);
    host.appendChild(acctRow);
    var myBody = doc.createElement("div");
    host.appendChild(myBody);
    /* lockedHint: locked-wallet empty state with a Wallet link. */
    function lockedHint() {
      while (myBody.firstChild) myBody.removeChild(myBody.firstChild);
      var hint = el(doc, "p", t("market.my_trades_locked", "Unlock your wallet to see your fills on this market. "), "muted");
      var a = el(doc, "a", t("market.go_wallet", "Go to Wallet"));
      a.setAttribute("href", "#/wallet");
      touchable(a);
      hint.appendChild(a);
      myBody.appendChild(hint);
    }
    var q = assets.quote, b = assets.base;
    /* Same op-4 pair filter as the old auto-load below
     * (MarketHistory.jsx:176-184): fill ops whose pays/receives legs touch
     * both market assets. */
    function pairFills(rows) {
      var fills = [];
      (rows || []).forEach(function (r) {
        var tup = r ? r.op : null;
        var opId = null, op = null;
        if (Array.isArray(tup)) { opId = tup[0]; op = tup[1]; }
        else if (r && r.operation_type !== undefined) { opId = r.operation_type; op = r; }
        else if (r && r.op_type !== undefined) { opId = r.op_type; op = r; }
        if (opId !== 4 || !op) return;
        var pays = op.pays || null, recv = op.receives || null;
        if (!pays || !recv || !pays.asset_id || !recv.asset_id) return;
        var hasQ = pays.asset_id === q.id || recv.asset_id === q.id;
        var hasB = pays.asset_id === b.id || recv.asset_id === b.id;
        if (!hasQ || !hasB) return;
        fills.push({ row: r, op: op });
      });
      return fills;
    }
    /* paintFills: op-4 pair fills for the typed/unlocked account as a
     * table (empty -> honest hint). No-ops when live() is false. */
    function paintFills(fills) {
      if (!live()) return;
      while (myBody.firstChild) myBody.removeChild(myBody.firstChild);
      if (fills.length === 0) {
        myBody.appendChild(el(doc, "p", t("market.no_my_trades", "No fills for your account on this market."), "muted"));
        return;
      }
      var table = doc.createElement("table");
      table.className = "node-table";
      var thead = doc.createElement("thead");
      var hr = doc.createElement("tr");
      [t("market.th_block", "Block"), t("market.th_price", "Price"), t("market.th_amount", "Amount")].forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = doc.createElement("tbody");
      var cards = doc.createElement("div");
      cards.className = "node-cards trades-cards";
      fills.slice(0, 30).forEach(function (f) {
        var blk = f.row.block_num !== undefined && f.row.block_num !== null ? String(f.row.block_num) : (f.row.block_time || f.row.time || "—");
        var price = "—", amt = "—";
        try {
          var fp = f.op.fill_price || null;
          if (fp && fp.base && fp.quote && /^-?\d+$/.test(String(fp.base.amount)) && /^-?\d+$/.test(String(fp.quote.amount))) {
            var rawB = fp.base.asset_id === b.id ? String(fp.base.amount) : (fp.quote.asset_id === b.id ? String(fp.quote.amount) : null);
            var rawQ = fp.base.asset_id === q.id ? String(fp.base.amount) : (fp.quote.asset_id === q.id ? String(fp.quote.amount) : null);
            if (rawB !== null && rawQ !== null) {
              price = Format.formatPrice(rawB, b.precision, rawQ, q.precision, 8);
            }
          }
          var qLeg = f.op.pays && f.op.pays.asset_id === q.id ? f.op.pays : (f.op.receives && f.op.receives.asset_id === q.id ? f.op.receives : null);
          if (qLeg && /^-?\d+$/.test(String(qLeg.amount))) {
            amt = Format.formatAmount(String(qLeg.amount), q.precision) + " " + q.symbol;
          }
        } catch (e) { /* honest dashes stand */ }
        var tr = doc.createElement("tr");
        tr.appendChild(el(doc, "td", String(blk)));
        tr.appendChild(el(doc, "td", String(price)));
        tr.appendChild(el(doc, "td", String(amt)));
        tbody.appendChild(tr);
        var card = doc.createElement("div");
        card.className = "node-card";
        card.appendChild(el(doc, "div", "#" + String(blk)));
        card.appendChild(el(doc, "div", String(price)));
        card.appendChild(el(doc, "div", String(amt)));
        cards.appendChild(card);
      });
      table.appendChild(tbody);
      var scroller = doc.createElement("div");
      scroller.className = "trades-scroll";
      scroller.appendChild(table);
      myBody.appendChild(scroller);
      myBody.appendChild(cards);
      rawDetails(doc, myBody, t("market.raw_my_fills", "Raw my fills"), fills.slice(0, 30).map(function (f) { return f.row; }));
    }
    /* Typed-account lookup: resolve the input, then paint that account's
     * fills for this pair via public Account.history. Blank + locked keeps
     * the hint; blank + unlocked reloads the wallet auto-load. */
    function loadTyped() {
      if (!live()) return;
      var v = acctInput.value.trim();
      if (!v) {
        if (tok !== state._myGen) return;
        if (!unlocked) lockedHint();
        else renderMyTrades(doc, state);
        return;
      }
      while (myBody.firstChild) myBody.removeChild(myBody.firstChild);
      myBody.appendChild(el(doc, "p", t("market.loading_my_trades", "Loading your fills…"), "muted"));
      Promise.resolve().then(function () {
        if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
          throw new Error("account backend missing");
        }
        return Account.resolve(v);
      }).then(function (acct) {
        return Account.history(acct.id, 100);
      }).then(function (rows) {
        if (!live()) return;
        paintFills(pairFills(rows || []));
      }).catch(function (e) {
        if (!live()) return;
        while (myBody.firstChild) myBody.removeChild(myBody.firstChild);
        showError(doc, myBody, e, t("market.fail_my_trades", "Could not load your fills."));
      });
    }
    viewBtn.addEventListener("click", loadTyped);
    if (!unlocked) {
      lockedHint();
      return;
    }
    /* Unlocked: prefill the wallet account id (convenience only); the
     * auto-load below is the unchanged wallet path. */
    try {
      if (typeof Account !== "undefined" && Account && typeof Account.myAccountId === "function") {
        Account.myAccountId().then(function (id) {
          if (tok !== state._myGen) return;
          if (!acctInput.value && id) acctInput.value = String(id);
        }).catch(function () { /* auto-load below stands */ });
      }
    } catch (e) { /* auto-load below stands */ }
    myBody.appendChild(el(doc, "p", t("market.loading_my_trades", "Loading your fills…"), "muted"));
    Account.myAccountId().then(function (myId) {
      return Account.history(myId, 100).then(function (rows) {
        return { myId: myId, rows: rows || [] };
      });
    }).then(function (found) {
      if (!live()) return;
      paintFills(pairFills(found.rows));
    }).catch(function (e) {
      if (!live()) return;
      while (myBody.firstChild) myBody.removeChild(myBody.firstChild);
      showError(doc, myBody, e, t("market.fail_my_trades", "Could not load your fills."));
    });
  }

  /* Fill every section from the chain; sections fail inline, never blank.
   * Strip/timeframe/chart bodies live in market-ind.js (MarketInd.*) — the
   * chain calls and section wiring stay here, exactly as before. */
  function fill(state) {
    if (state.loading) return;
    if (!state.assets) return;
    state.loading = true;
    var doc = state.doc;
    var q = state.assets.quote, b = state.assets.base;
    var done = function () {
      state.loading = false;
      try {
        state.updated.textContent = "Updated " + new Date().toLocaleTimeString();
      } catch (e) { state.updated.textContent = ""; }
    };

    /* Click-to-fill lives in the book rows (market-book.js fillTradePrice):
     * a row sets BOTH panels' price inputs and focuses the taking side's
     * amount. The book cells stay display-only otherwise. */
    Market.book(b.id, q.id, 50).then(function (book) {
      state.bookDepth = MarketBook.renderSplit(doc, state.bidsBody, state.asksBody, {
        book: book, basePrec: b.precision, quotePrec: q.precision,
        baseSymbol: b.symbol, quoteSymbol: q.symbol, spreadLine: state.spreadLine,
        logVol: !!state.depthLogY
      });
      MarketInd.maybeDraw(state);
    }).catch(function (e) {
      while (state.bidsBody.firstChild) state.bidsBody.removeChild(state.bidsBody.firstChild);
      while (state.asksBody.firstChild) state.asksBody.removeChild(state.asksBody.firstChild);
      showError(doc, state.bidsBody, e, t("market.fail_book", "Could not load the order book."));
      var retry = touchable(el(doc, "button", t("market.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () { fill(state); });
      state.bidsBody.appendChild(retry);
      state.asksBody.appendChild(el(doc, "p", t("market.fail_book", "Could not load the order book."), "muted"));
    });

    MarketInd.renderStrip(doc, state);

    Market.stats(b.id, q.id).then(function (st) {
      state.ticker = st;
      MarketInd.renderStrip(doc, state);
      /* Slice-16 (F1a): pulled alert engine on the existing ticker refresh.
       * Pair key QUOTE_BASE + human latest; a notify fault never breaks the
       * desk (guarded; missing feed simply never fires downstream). */
      try {
        if (typeof NotifyHost !== "undefined" && NotifyHost &&
            typeof NotifyHost.mountToasts === "function") {
          try { NotifyHost.mountToasts(); } catch (e) { /* host best-effort */ }
        }
        if (typeof NotifyRules !== "undefined" && NotifyRules &&
            typeof NotifyRules.checkAlerts === "function") {
          try { NotifyRules.checkAlerts(state.id, st ? st.latest : null); } catch (e) { /* never break desk */ }
        }
      } catch (e) { /* notify optional here */ }
      /* Raw-ticker proof (triangle-only, refilled per fetch — the 24h dl
       * panel left with the stats grid cell; the strip above carries the
       * human fields). */
      while (state.tickerRaw.firstChild) state.tickerRaw.removeChild(state.tickerRaw.firstChild);
      rawDetails(doc, state.tickerRaw, "Raw ticker", st.raw);
    }).catch(function (e) {
      while (state.tickerRaw.firstChild) state.tickerRaw.removeChild(state.tickerRaw.firstChild);
      showError(doc, state.tickerRaw, e, t("market.fail_stats", "Could not load market stats."));
    });

    Market.trades(b.id, q.id, 30).then(function (rows) {
      MarketBook.renderTrades(doc, state.recentBody || state.tradesBody, { rows: rows, quoteSymbol: q.symbol });
      renderMyTrades(doc, state);
      MarketInd.maybeDraw(state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    }).catch(function (e) {
      var rb = state.recentBody || state.tradesBody;
      while (rb.firstChild) rb.removeChild(rb.firstChild);
      showError(doc, rb, e, t("market.fail_trades", "Could not load recent trades."));
      renderMyTrades(doc, state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    });

    /* Timeframe radios (once per desk): intersect the preferred buckets with
     * the live list; reconcile the default 3600 when the node lacks it. */
    if (!state.tfInit) {
      state.tfInit = true;
      Market.timeframes().then(function (live) {
        var avail = MarketInd.PREF_BUCKETS.filter(function (x) { return live.indexOf(x) !== -1; });
        if (avail.length === 0) avail = (live || []).slice();
        if (avail.indexOf(state.bucket) === -1 && avail.length > 0) {
          state.bucket = avail[0];
        }
        state.liveBuckets = avail;
        MarketInd.paintTimeframes(doc, state, function () { fill(state); });
      }).catch(function () {
        while (state.tfBox.firstChild) state.tfBox.removeChild(state.tfBox.firstChild);
        state.tfBox.appendChild(el(doc, "span", t("market.fail_timeframes", "Timeframes unavailable on this node."), "muted"));
        MarketInd.paintCountNote(state);
      });
    }

    MarketInd.paintCountNote(state);

    Market.candles(b.id, q.id, state.bucket, MarketInd.CANDLE_COUNT).then(function (c) {
      state.candles = c;
      MarketInd.maybeDraw(state);
    }).catch(function () {
      state.candles = { buckets: [], closes: [] };
      MarketInd.maybeDraw(state);
    });
  }

  /* Pool-map lazy loader (index.html frozen — dynamic script like router.js
   * dashboard precedent; relative URL only, never CDN). Params: cb(bool).
   * Returns nothing. Never throws. */
  var _graphLoading = false, _graphWaiters = [];
  function graphSrc() {
    try {
      if (typeof document !== "undefined" && document.baseURI) {
        return new URL("js/pool-graph.js", document.baseURI).toString();
      }
    } catch (e) { /* relative fallback below */ }
    return "js/pool-graph.js";
  }
  function ensurePoolGraph(cb) {
    try {
      if (typeof PoolGraph !== "undefined" && PoolGraph) { cb(true); return; }
    } catch (e) { /* load below */ }
    if (typeof document === "undefined") { try { cb(false); } catch (e) {} return; }
    _graphWaiters.push(cb);
    if (_graphLoading) return;
    _graphLoading = true;
    try {
      var s = document.createElement("script");
      s.src = graphSrc(); s.async = true;
      s.onload = function () {
        _graphLoading = false;
        var w = _graphWaiters; _graphWaiters = [];
        w.forEach(function (f) { try { f(true); } catch (e) {} });
      };
      s.onerror = function () {
        _graphLoading = false;
        var w = _graphWaiters; _graphWaiters = [];
        w.forEach(function (f) { try { f(false); } catch (e) {} });
      };
      (document.head || document.getElementsByTagName("head")[0] || document.documentElement).appendChild(s);
    } catch (e) {
      _graphLoading = false;
      var w = _graphWaiters; _graphWaiters = [];
      w.forEach(function (f) { try { f(false); } catch (e2) {} });
    }
  }

  /* Desk alive guard (stale-route: dead desk never paints). Params: state.
   * Returns boolean. Never throws. */
  function deskAlive(state) {
    try {
      return String((typeof location !== "undefined" && location.hash) || "")
        .toUpperCase().indexOf(state.id) !== -1;
    } catch (e) { return true; }
  }

  /* Fetch 2-layer pool graph for quote/base ids (lazy async, <=9 RPCs).
   * Loading note -> render. Failures -> honest partial/empty note. */
  function fetchPoolMap(doc, state) {
    if (!state.graphWrap || !state.graphCanvas || !state.graphNote) return;
    if (!state.assets) return;
    var q = state.assets.quote, b = state.assets.base, myId = state.id;
    try { state.graphNote.textContent = "Loading pool map…"; } catch (e) {}
    ensurePoolGraph(function (ok) {
      if (!deskAlive(state) || state.id !== myId) return;
      if (!ok) {
        try { state.graphNote.textContent = "Pool map unavailable (script load failed)."; } catch (e) {}
        return;
      }
      var pA, pB;
      try {
        if (typeof PoolGraph === "undefined" || !PoolGraph) throw new Error("missing");
        pA = q.id; pB = b.id;
      } catch (e) { return; }
      try {
        PoolGraph.buildGraph(pA, pB, { depth: 2, cap: 25 }).then(function (g) {
          if (!deskAlive(state) || state.id !== myId) return;
          var pa = null, pb = null;
          try { pa = PoolGraph.findCorePath(g, pA); } catch (e) { pa = null; }
          try { pb = PoolGraph.findCorePath(g, pB); } catch (e) { pb = null; }
          state.graphData = { graph: g, assetA: pA, assetB: pB, pathA: pa, pathB: pb };
          redrawPoolMap(doc, state);
          try { MarketInd.drawCharts(state); } catch (e) { /* pin best-effort */ }
        }).catch(function (e) {
          if (!deskAlive(state) || state.id !== myId) return;
          var m = String((e && e.message) || e || "");
          try {
            if (m.indexOf("not-connected") !== -1) state.graphNote.textContent = "Pool map unavailable (offline).";
            else state.graphNote.textContent = "No pools touch these assets.";
          } catch (x) {}
        });
      } catch (e) { /* graph best-effort */ }
    });
  }

  /* Repaint the pool-map canvas from cached graphData (theme/resize path).
   * Skips when toggled off or stale. Never throws outward. */
  /* Feed + settlement for the strip (retro round 2 D1 — read path mirrors
   * asset-feed-ui.js loadFeed: lookup_asset_symbols -> bitasset_data_id ->
   * get_objects -> current_feed.settlement_price, formatted with BOTH
   * precisions via Format.formatPrice). Runs ONCE per desk (not per stats
   * refresh): exactly 2 RPCs, stale-route guarded. Orientation is market
   * base-per-quote: the settlement amounts map by asset_id onto the market
   * legs (precisions already known from state.assets); legs that don't match
   * the pair skip the feed (backing differs from the market quote) instead
   * of guessing. Settlement follows #1 ExchangeHeader.jsx:160-198 halfway:
   * globally-settled assets (settlement_fund > 0) show the on-chain
   * settlement_price as "Global Settlement" (same object, zero extra calls);
   * the offset-adjusted estimate for live assets needs exact
   * reciprocal-percent math that #1 does in float — out of display-only
   * scope, so no Settlement cell there (recorded in retro-round-1.md).
   * Non-MPA pairs and every failure fail OPEN (state.feed null, no cells,
   * the ticker strip stands). Params: (doc, state) with state.assets set.
   * Never throws outward. */
  function fetchFeed(doc, state) {
    var myId = state.id;
    function alive() {
      try { return deskAlive(state) && state.id === myId; } catch (e) { return false; }
    }
    /* novalue: feed fetch failed/absent — clear state.feed and repaint
     * the strip (which shows the missing-feed hint). Never throws. */
    function novalue() {
      if (!alive()) return;
      state.feed = null;
      try { MarketInd.renderStrip(doc, state); } catch (e) { /* strip stands */ }
    }
    try {
      if (typeof Chain === "undefined" || !Chain ||
          typeof Format === "undefined" || !Format ||
          typeof MarketInd === "undefined" || !MarketInd) return;
      var q = state.assets.quote, b = state.assets.base;
      var dbId;
      Chain.db().then(function (id) {
        dbId = id;
        return Chain.call(dbId, "lookup_asset_symbols", [[q.symbol, b.symbol]]);
      }).then(function (rows) {
        if (!alive()) return null;
        var bid = null;
        (rows || []).forEach(function (r) {
          if (r && r.bitasset_data_id && !bid) bid = r.bitasset_data_id;
        });
        if (!bid) { novalue(); return null; }
        return Chain.call(dbId, "get_objects", [[bid]]);
      }).then(function (objs) {
        if (!objs || !alive()) return;
        var bit = objs[0] || null;
        var cur = bit && bit.current_feed;
        var pair = cur && cur.settlement_price;
        if (!pair || !pair.base || !pair.quote) { novalue(); return; }
        var rawB = null, rawQ = null;
        [pair.base, pair.quote].forEach(function (leg) {
          if (leg.asset_id === b.id) rawB = String(leg.amount);
          else if (leg.asset_id === q.id) rawQ = String(leg.amount);
        });
        if (rawB === null || rawQ === null) { novalue(); return; }
        var feed;
        try {
          feed = Format.formatPrice(rawB, b.precision, rawQ, q.precision, 8);
        } catch (e) { novalue(); return; }
        var out = { feed: feed, settle: null };
        try {
          var fund = bit && bit.settlement_fund;
          /* Round-3 verified: globally-settled flag is exact BigInt (the fund
           * is a raw chain integer; Number() would still zero-test correctly
           * but BigInt keeps the integer discipline of this read path). */
          var fundStr = (fund === null || fund === undefined) ? "0" : String(fund).trim();
          var isSettled = false;
          try {
            if (/^-?\d+$/.test(fundStr)) isSettled = BigInt(fundStr) > 0n;
            else isSettled = Number(fund) > 0;
          } catch (e) { isSettled = Number(fund) > 0; }
          var sp = bit && bit.settlement_price;
          if (isSettled && sp && sp.base && sp.quote) {
            var sB = null, sQ = null;
            [sp.base, sp.quote].forEach(function (leg) {
              if (leg.asset_id === b.id) sB = String(leg.amount);
              else if (leg.asset_id === q.id) sQ = String(leg.amount);
            });
            if (sB !== null && sQ !== null) {
              out.settle = {
                global: true,
                value: Format.formatPrice(sB, b.precision, sQ, q.precision, 8)
              };
            }
          }
        } catch (e) { out.settle = null; }
        if (!alive()) return;
        state.feed = out;
        try { MarketInd.renderStrip(doc, state); } catch (e) { /* strip stands */ }
      }).catch(function () { novalue(); });
    } catch (e) { /* feed optional, strip stands */ }
  }

  function redrawPoolMap(doc, state) {
    if (!state.graphData || !state.graphCanvas) return;
    if (state.showPoolMap === false) return;
    if (!deskAlive(state)) return;
    try {
      if (typeof PoolGraph === "undefined" || !PoolGraph) return;
      var gd = state.graphData, hi = [], seen = {};
      [(gd.pathA && gd.pathA.via) || [], (gd.pathB && gd.pathB.via) || []].forEach(function (list) {
        (list || []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; hi.push(id); } });
      });
      PoolGraph.drawGraph(doc, state.graphCanvas, gd.graph,
        { assetA: gd.assetA, assetB: gd.assetB, highlightPools: hi });
      var n = (gd.graph.edges || []).length;
      if (!n) state.graphNote.textContent = "No pools touch these assets.";
      else if (!gd.pathA && !gd.pathB) state.graphNote.textContent = "No BTS path — treat pair as unverified.";
      else {
        var bits = [];
        if (gd.pathA) bits.push("pool→BTS " + gd.pathA.hops.length + " hops");
        if (gd.pathB) bits.push("pool→BTS " + gd.pathB.hops.length + " hops");
        state.graphNote.textContent = "BTS provenance: " + bits.join(" · ") + ".";
      }
    } catch (e) { /* canvas best-effort */ }
  }

  return {
    renderMarket: renderMarket
  };
})();

if (typeof module !== "undefined") { module.exports = MarketDesk; }
