/* MarketDesk: DEX desk shell for /market/:marketID (skeleton, fill, refresh).
 * Owns: route entry renderMarket(root, marketID), desk skeleton showDesk
 *   (header, stats, charts hosts, book/trades/side/orders/trade sections,
 *   refresh + 15s timer with cleanup), data fill (book/stats/trades/
 *   timeframes/candles — each section fails inline), last-visited market
 *   persistence (saveLast under LAST_KEY), timer/listener cleanup.
 *   Picker rendering delegates to MarketPicker, strip/timeframes/charts to
 *   MarketInd, book/trades to MarketBook, my-orders to MarketOrders, panels
 *   to TradeUI (all via lazy globals — same convention as before the split).
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
      : String(e || fallback || "Unexpected error");
    if (msg.indexOf("bad-market") !== -1) {
      msg = "Unknown market. Check the QUOTE_BASE pair (e.g. " + defaultMarket() + ").";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = "Unexpected asset data from the node; stopped instead of guessing.";
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = "History unavailable on this node (fills and charts need the history plugin).";
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = "Wallet is locked.";
    } else if (msg.indexOf("no-account") !== -1) {
      msg = "No on-chain account found for the wallet's active key.";
    } else if (msg.indexOf("not connected") !== -1) {
      msg = "Network unavailable. Check Settings → Nodes and retry.";
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
    s.setAttribute("aria-label", label || "Show raw JSON");
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
      showError(doc, wrap, "Market backend missing: js/market.js, js/format.js, js/indicators.js, js/market-charts.js, js/market-picker.js or js/market-ind.js failed to load.");
      return;
    }
    if (typeof marketID !== "string" || !marketID) {
      wrap.appendChild(el(doc, "h1", "Exchange"));
      wrap.appendChild(el(doc, "p", "Pick a market to start.", "muted"));
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
      wrap.appendChild(el(doc, "h1", "Market not found"));
      showError(doc, wrap, e, "Unknown market.");
      return;
    }
    var id = (pair.quote + "_" + pair.base).toUpperCase();
    saveLast(id);

    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", "Connecting to network…", "muted"));
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
        failed.appendChild(el(doc, "h1", "Exchange"));
        showError(doc, failed, new Error("not connected"), "Network unavailable.");
        var retry = touchable(el(doc, "button", "Retry"));
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
      over: { sma: true, ema: true, bb: false, psar: false },
      /* Task 4b stacked panes: one checkbox per key below; MACD stays on by
       * default to preserve the Task-4 look. panes.oscs maps key -> pane
       * handle from drawOscPane; paneEls maps key -> {wrap, body} DOM nodes.
       * oscBoxes maps key -> checkbox input (x buttons uncheck through it). */
      osc: { rsi: false, macd: true, stoch: false, atr: false, fisher: false, volume: false },
      panes: { price: null, oscs: {} },
      paneEls: {}, oscBoxes: {},
      ticker: null, countNote: null, tfBox: null, oscNote: null
    };

    var desk = el(doc, "div", null, "mkt");
    wrap.appendChild(desk);

    var head = doc.createElement("section");
    head.className = "mkt-head";
    desk.appendChild(head);
    head.appendChild(el(doc, "h1", pair.quote + " / " + pair.base));
    var sub = el(doc, "p", "Loading market…", "muted");
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

    var chartsSec = doc.createElement("section");
    chartsSec.className = "mkt-charts";
    desk.appendChild(chartsSec);
    chartsSec.appendChild(el(doc, "h2", "Charts"));

    /* Timeframe radios (from the live bucket list) + candle count note. */
    var tfBox = doc.createElement("div");
    tfBox.className = "mkt-tfrow";
    tfBox.setAttribute("role", "radiogroup");
    tfBox.setAttribute("aria-label", "Candle timeframe");
    chartsSec.appendChild(tfBox);
    state.tfBox = tfBox;
    var countNote = el(doc, "p", "", "muted mkt-count-note");
    countNote.setAttribute("aria-live", "polite");
    chartsSec.appendChild(countNote);
    state.countNote = countNote;

    /* Indicator picker: overlay checkboxes on the price pane + Log/Invert. */
    var indRow = doc.createElement("div");
    indRow.className = "mkt-indrow";
    chartsSec.appendChild(indRow);
    [["sma", "SMA"], ["ema", "EMA"], ["bb", "BB"], ["psar", "PSAR"]].forEach(function (def) {
      var lab = doc.createElement("label");
      lab.className = "mkt-ind";
      var box = doc.createElement("input");
      box.type = "checkbox";
      box.checked = !!state.over[def[0]];
      box.setAttribute("aria-label", def[1] + " overlay");
      touchable(box);
      box.addEventListener("change", function () {
        state.over[def[0]] = box.checked;
        MarketInd.drawCharts(state);
      });
      lab.appendChild(box);
      lab.appendChild(el(doc, "span", def[1]));
      indRow.appendChild(lab);
    });
    var logLab = doc.createElement("label");
    logLab.className = "mkt-ind";
    var logBox = doc.createElement("input");
    logBox.type = "checkbox";
    logBox.checked = false;
    logBox.setAttribute("aria-label", "Logarithmic price scale");
    touchable(logBox);
    logBox.addEventListener("change", function () {
      state.logScale = logBox.checked;
      MarketInd.drawCharts(state);
    });
    logLab.appendChild(logBox);
    logLab.appendChild(el(doc, "span", "Log"));
    indRow.appendChild(logLab);
    /* Invert toggle (ported from DEX-UX): re-render the swapped QUOTE_BASE
     * pair via the hash router — cheap, no state to keep in sync. */
    var invBtn = touchable(el(doc, "button", "Invert"));
    invBtn.type = "button";
    invBtn.id = "mkt-invert";
    invBtn.setAttribute("aria-label", "Invert market pair");
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
    chartsSec.appendChild(priceHost);

    /* STACKED oscillator sub-panes + volume (Task 4b): multi-checkboxes —
     * one INDEPENDENT pane per checked item (one LightweightCharts chart per
     * pane — RSI 0-100 and ATR price-scale ranges are incompatible, so panes
     * are never shared). Unchecking removes just that pane via removePane.
     * Unavailable indicator fns (osc module not wired — see ind()) render
     * disabled with a note, never throw; Volume needs no fn (always on). */
    var oscRow = doc.createElement("div");
    oscRow.className = "mkt-oscrow";
    oscRow.setAttribute("role", "group");
    oscRow.setAttribute("aria-label", "Oscillators and volume");
    chartsSec.appendChild(oscRow);
    MarketInd.OSC_ORDER.forEach(function (def) {
      var key = def[0], label = def[1];
      var lab = doc.createElement("label");
      lab.className = "mkt-ind";
      var box = doc.createElement("input");
      box.type = "checkbox";
      box.value = key;
      box.checked = !!state.osc[key];
      box.setAttribute("aria-label", label + " pane");
      /* Only indicator keys need the osc module; Volume is raw bucket data. */
      if (key !== "volume" && !MarketInd.ind(key)) {
        box.disabled = true;
        lab.title = label + " unavailable in this build";
      }
      touchable(box);
      box.addEventListener("change", function () {
        state.osc[key] = box.checked;
        MarketInd.drawCharts(state);
      });
      lab.appendChild(box);
      lab.appendChild(el(doc, "span", label));
      oscRow.appendChild(lab);
      state.oscBoxes[key] = box;
    });
    /* Stacked pane container: drawCharts reconciles one child wrapper per
     * checked key (in OSC_ORDER); nothing checked -> no children at all,
     * never a blank box. */
    var oscHost = doc.createElement("div");
    oscHost.id = "mkt-osc-host";
    oscHost.className = "mkt-osc-host";
    chartsSec.appendChild(oscHost);
    var oscNote = el(doc, "p", "", "muted");
    oscNote.setAttribute("aria-live", "polite");
    chartsSec.appendChild(oscNote);
    state.oscNote = oscNote;

    var depthCanvas = doc.createElement("canvas");
    depthCanvas.id = "mkt-depth-canvas";
    depthCanvas.className = "mkt-canvas";
    chartsSec.appendChild(depthCanvas);

    var bookSec = doc.createElement("section");
    bookSec.className = "mkt-book";
    desk.appendChild(bookSec);
    bookSec.appendChild(el(doc, "h2", "Order book"));
    var bookBody = doc.createElement("div");
    bookSec.appendChild(bookBody);

    var tradesSec = doc.createElement("section");
    tradesSec.className = "mkt-trades";
    desk.appendChild(tradesSec);
    tradesSec.appendChild(el(doc, "h2", "Recent trades"));
    var tradesBody = doc.createElement("div");
    tradesSec.appendChild(tradesBody);

    var sideSec = doc.createElement("section");
    sideSec.className = "mkt-side";
    desk.appendChild(sideSec);
    var statsBox = doc.createElement("div");
    sideSec.appendChild(statsBox);
    MarketPicker.renderPicker(doc, sideSec, id, root);

    var ordersSec = doc.createElement("section");
    ordersSec.className = "mkt-orders";
    desk.appendChild(ordersSec);
    ordersSec.appendChild(el(doc, "h2", "My open orders"));
    var ordersBody = doc.createElement("div");
    ordersSec.appendChild(ordersBody);

    /* Slice-06 mount point: TradeUI owns everything under tradeMount
     * (panels + cancel boxes); the desk only provides the section. */
    var tradeSec = doc.createElement("section");
    tradeSec.className = "trade";
    desk.appendChild(tradeSec);
    tradeSec.appendChild(el(doc, "h2", "Trade"));
    var tradeMount = doc.createElement("div");
    tradeSec.appendChild(tradeMount);

    var foot = doc.createElement("div");
    foot.className = "mkt-foot";
    var refreshBtn = touchable(el(doc, "button", "Refresh"));
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
    state.priceHost = priceHost;
    state.oscHost = oscHost;
    state.depthCanvas = depthCanvas;
    state.bookBody = bookBody;
    state.tradesBody = tradesBody;
    state.statsBox = statsBox;
    state.ordersBody = ordersBody;
    state.updated = updated;
    state.chartData = null;

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
      /* Slice-06 hook: one renderPanels call with the ctx the desk holds.
       * TradeUI gates on unlock itself and re-renders after unlock. */
      try {
        if (typeof TradeUI !== "undefined" && TradeUI &&
            typeof TradeUI.renderPanels === "function") {
          TradeUI.renderPanels(doc, tradeMount, {
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

    /* SLICE-6 FOLLOW-UP (not this slice): bookClick-to-fill — the DEX-UX
     * pattern where clicking an order-book row fills the trade form — is NOT
     * implemented here. The book stays read-only until slice 6 owns the
     * trade-form wiring. */
    Market.book(b.id, q.id, 50).then(function (book) {
      state.bookDepth = MarketBook.renderBook(doc, state.bookBody, {
        book: book, basePrec: b.precision, quotePrec: q.precision,
        baseSymbol: b.symbol, quoteSymbol: q.symbol, spreadLine: state.spreadLine
      });
      MarketInd.maybeDraw(state);
    }).catch(function (e) {
      while (state.bookBody.firstChild) state.bookBody.removeChild(state.bookBody.firstChild);
      showError(doc, state.bookBody, e, "Could not load the order book.");
      var retry = touchable(el(doc, "button", "Retry"));
      retry.type = "button";
      retry.addEventListener("click", function () { fill(state); });
      state.bookBody.appendChild(retry);
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
      while (state.statsBox.firstChild) state.statsBox.removeChild(state.statsBox.firstChild);
      state.statsBox.appendChild(el(doc, "h2", "24h stats"));
      var dl = el(doc, "dl", null, "mkt-stats");
      function row(term, text) {
        if (text === null || text === undefined || text === "") return;
        dl.appendChild(el(doc, "dt", term));
        dl.appendChild(el(doc, "dd", String(text)));
      }
      row("Latest", st.latest);
      row("Best bid", st.highestBid);
      row("Best ask", st.lowestAsk);
      if (st.raw) {
        if (st.raw.percent_change !== undefined && st.raw.percent_change !== null) {
          row("24h change %", st.raw.percent_change);
        }
        if (st.raw.base_volume !== undefined && st.raw.base_volume !== null) {
          row("24h volume (" + b.symbol + ")", st.raw.base_volume);
        }
        if (st.raw.quote_volume !== undefined && st.raw.quote_volume !== null) {
          row("24h volume (" + q.symbol + ")", st.raw.quote_volume);
        }
      }
      state.statsBox.appendChild(dl);
      rawDetails(doc, state.statsBox, "Raw ticker", st.raw);
    }).catch(function (e) {
      while (state.statsBox.firstChild) state.statsBox.removeChild(state.statsBox.firstChild);
      showError(doc, state.statsBox, e, "Could not load market stats.");
    });

    Market.trades(b.id, q.id, 30).then(function (rows) {
      MarketBook.renderTrades(doc, state.tradesBody, { rows: rows, quoteSymbol: q.symbol });
      MarketInd.maybeDraw(state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    }).catch(function (e) {
      while (state.tradesBody.firstChild) state.tradesBody.removeChild(state.tradesBody.firstChild);
      showError(doc, state.tradesBody, e, "Could not load recent trades.");
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
        state.tfBox.appendChild(el(doc, "span", "Timeframes unavailable on this node.", "muted"));
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

  return {
    renderMarket: renderMarket
  };
})();

if (typeof module !== "undefined") { module.exports = MarketDesk; }
