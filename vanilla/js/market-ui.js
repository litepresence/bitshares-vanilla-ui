/* MarketUI: read-only DEX desk shell (picker, stats, charts, refresh).
 * Owns: DOM for /market/:marketID only — picker with search + typed entry,
 *   stats row, chart wiring, 15s refresh with cleanup, offline panel.
 *   Book/trades rendering delegates to MarketBook, my-orders to
 *   MarketOrders (behavior-preserving §3.7 split — call sites only).
 * Consumes: Market (book/depth/trades/stats/candles/myOrders), Format
 *   (human strings only — no money math here), Indicators (SMA/EMA over
 *   chart-pixel closes), MarketCharts (canvas drawing), Wallet.isUnlocked
 *   (read-only gate for my orders), Account.myAccountId (never modified),
 *   Store (network for curated list + connection wait), Chain.status.
 * Globals/side effects: DOM under the router root, localStorage last-market
 *   key, one refresh timer + resize/theme listeners (all cleared on route
 *   change); global MarketUI only. No signing, no cancel path (slice 6).
 * Created by: building-vanilla-slices skill, slice-05-exchange-read plan Task 3.
 * Extended by: slice-07 Task 4 (timeframe radios + count note, indicator
 *   checkboxes, ONE shared oscillator sub-pane, Log/Invert toggles, picker
 *   asset-type radios + favorites star, header stats strip; candles + volume
 *   + overlays render through MarketCharts.drawPricePane/drawOscPane).
 * Extended by: slice-07 Task 4b (stacked oscillator sub-panes + volume:
 *   multi-checkboxes RSI/MACD/Stoch/ATR/Fisher/Volume, one independent-scale
 *   pane per checked item with x remove, volume histogram from human
 *   baseVolume strings — Numbers are pixels-only).
 *
 * bookClick-to-fill (DEX-UX pattern: clicking an order-book row fills the
 *   trade form) is NOT implemented here — recorded as a slice-06 follow-up
 *   (see the note at the book fill site below), per the Task-4 scope.
 *
 * PRICE DISPLAY: book levels, ticker fields and trade prices render the
 *   chain-human strings verbatim (proven base-per-quote, market.js header).
 *   Only my-orders rows need computed prices: Format.formatPrice (BigInt,
 *   8 places like Market) on sell_price legs mapped by asset id, both
 *   orientations. Spread/midpoint use exact decimal-string math in
 *   MarketBook (add/sub/half) — binary float never touches money.
 *   Number() appears ONLY for depth-bar widths and time trimming (pixels).
 *
 * DEFAULT MARKET (no guessing): bitshares-ui/app/branding.js:98-108
 *   getDefaultMarket() returns "USD_TEST" on testnet, "BTS_CNY" on mainnet
 *   (wired at Header.jsx:415). "/" redirects to the last-visited market when
 *   stored and valid, else that network default. The picker curated list is
 *   plan-specified for mainnet; testnet starts at the default plus a typed
 *   QUOTE_BASE entry (live pair discovery is Task-4 work, recorded there).
 * Side wording (bid/ask) follows Exchange.jsx:265-296 (bid sells the market
 *   base, ask sells the market quote); for_sale denomination is
 *   sell_price.base.asset_id per market_object.hpp:50.
 */
var MarketUI = (function () {
  "use strict";

  var REFRESH_MS = 15000;
  var LAST_KEY = "bts-vanilla-last-market-v1";
  /* Favorites star: own localStorage key (view state, never settings — same
   * rule as LAST_KEY above). Value: JSON array of "QUOTE_BASE" ids. */
  var FAV_KEY = "bts-vanilla-fav-markets-v1";
  var CURATED = {
    mainnet: ["BTS_USD", "BTS_CNY", "BTS_BTC", "BTS_ETH"],
    testnet: ["USD_TEST"]
  };

  /* Timeframe choices intersect the live bucket list (slice-07 Task 4).
   * Labels mirror the common trading shorthand. */
  var PREF_BUCKETS = [300, 900, 1800, 3600, 14400, 86400];
  var CANDLE_COUNT = 200;

  /* Stacked sub-pane order (Task 4b): checkbox order IS pane order — RSI,
   * MACD, Stoch, ATR, Fisher, then Volume. Single source for the picker,
   * the pane reconciliation in drawCharts, and teardown. */
  var OSC_ORDER = [
    ["rsi", "RSI"], ["macd", "MACD"], ["stoch", "Stoch"],
    ["atr", "ATR"], ["fisher", "Fisher"], ["volume", "Volume"]
  ];

  /* Short label for a bucket size in seconds (label text only, not money). */
  function bucketLabel(b) {
    var known = { 60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h", 86400: "1D", 604800: "1W" };
    if (known[b]) return known[b];
    if (b >= 3600 && b % 3600 === 0) return (b / 3600) + "h";
    if (b >= 60 && b % 60 === 0) return (b / 60) + "m";
    return b + "s";
  }

  /* Read a theme token for chart frames (theme-aware: callers pass these into
   * MarketCharts; never hardcode theme colors here). Headless -> fallback. */
  function readVar(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }

  /* Frame colors for both chart panes, read live from CSS vars. */
  function themeChartColors() {
    return {
      paneBg: readVar("--panel", "#131722"),
      grid: readVar("--border", "#2a2e39"),
      text: readVar("--text", "#c5cbce"),
      accent: readVar("--accent", "#007bff"),
      buy: readVar("--buy", "#26de81"),
      sell: readVar("--sell", "#ff231f"),
      warn: readVar("--warn", "#fcab53"),
      muted: readVar("--muted", "#758696")
    };
  }

  /* Indicator lookup with availability guard. indicators.js (SMA/EMA/BB/PSAR)
   * and indicators-osc.js (RSI/MACD/Stoch/ATR/Fisher/...) are both wired in
   * index.html, so every picker key resolves in the browser — the null path
   * below is a robustness guard only (callers treat null as "unavailable",
   * never throw). */
  function ind(name) {
    try {
      if (typeof Indicators !== "undefined" && Indicators &&
          typeof Indicators[name] === "function") return Indicators[name];
    } catch (e) { /* unavailable */ }
    return null;
  }

  /* Favorites: string array under FAV_KEY ([] when absent/broken). */
  function loadFavs() {
    try {
      if (typeof localStorage === "undefined") return [];
      var raw = localStorage.getItem(FAV_KEY);
      var arr = JSON.parse(raw || "[]");
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === "string"; }) : [];
    } catch (e) {
      return [];
    }
  }

  function saveFavs(list) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(FAV_KEY, JSON.stringify(list));
      }
    } catch (e) { /* private mode: stars work for the session only */ }
  }

  function isFav(list, id) {
    return list.indexOf(id) !== -1;
  }

  function toggleFav(list, id) {
    var i = list.indexOf(id);
    if (i === -1) list.push(id);
    else list.splice(i, 1);
    saveFavs(list);
    return list;
  }

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
   * so view state lives here, never in settings). Null when absent. */
  function loadLast() {
    try {
      if (typeof localStorage === "undefined") return null;
      var v = localStorage.getItem(LAST_KEY);
      return (typeof v === "string" && v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function saveLast(id) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(LAST_KEY, id);
    } catch (e) { /* private mode: desk still works, just not remembered */ }
  }

  /* Resolve the "/" redirect target: stored id when it still parses, else
   * the network default. Exposed for the router (single purpose). */
  function homeTarget() {
    var last = loadLast();
    if (typeof last === "string" && last &&
        typeof Market !== "undefined" && Market && typeof Market.parseId === "function") {
      try {
        Market.parseId(last);
        return last.toUpperCase();
      } catch (e) { /* fall through to default */ }
    }
    return defaultMarket();
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

  /* Asset kind for one picker symbol, from a full lookup_asset_symbols record:
   * BTS when the symbol is the core asset; MPA when the record carries a
   * bitasset_data_id (prediction/bitasset family); else UIA. Null when the
   * record is missing (callers fail OPEN: unknown kinds stay visible). */
  function kindOf(symbol, record) {
    if (String(symbol || "").toUpperCase() === "BTS") return "BTS";
    if (!record || typeof record !== "object") return null;
    if (record.bitasset_data_id) return "MPA";
    return "UIA";
  }

  /* LPT/POOL verdict (slice-07 Task 4 — recorded deferral, not implemented):
   * POOL is not an asset type at all: pools are liquidity_pool_objects, not
   * assets (bitshares-core .../protocol/liquidity_pool.hpp — the create op
   * takes asset_a/asset_b plus a share_asset LP token). LPT (that share_asset)
   * IS live-matchable by enumerating pools, but pool enumeration for a
   * curated-pair picker is market-discovery scope, not this slice. So the
   * radios below are MPA/UIA/BTS only; revisit LPT with live pair discovery.
   *
   * Picker: search-filtered curated links + asset-type radios + favorites
   * star + typed QUOTE_BASE entry validated via lookup_asset_symbols
   * (unknown symbols fail inline, never navigate). Kind classification comes
   * from ONE batched lookup_asset_symbols call over the picker's unique
   * symbols (via Chain, the single chain-facing module — cached per desk in
   * _kindCache); when the lookup fails the filter fails OPEN (all rows stay
   * visible) instead of hiding markets on missing data. */
  var _kindCache = {};
  var _kindFilter = "ALL";

  function ensureKinds(symbols) {
    var missing = [];
    var i;
    for (i = 0; i < symbols.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(_kindCache, symbols[i])) {
        missing.push(symbols[i]);
      }
    }
    if (missing.length === 0) return Promise.resolve(_kindCache);
    if (typeof Chain === "undefined" || !Chain ||
        typeof Chain.db !== "function" || typeof Chain.call !== "function") {
      return Promise.resolve(_kindCache);
    }
    return Chain.db().then(function (dbId) {
      return Chain.call(dbId, "lookup_asset_symbols", [missing]);
    }).then(function (rows) {
      for (var j = 0; j < missing.length; j++) {
        _kindCache[missing[j]] = (rows && rows[j]) || null;
      }
      return _kindCache;
    }).catch(function () {
      return _kindCache;
    });
  }

  function renderPicker(doc, section, currentID, root) {
    section.appendChild(el(doc, "h2", "Markets"));
    var list = (CURATED[network()] || CURATED.mainnet).slice();
    if (list.indexOf(currentID) === -1 && currentID) list.unshift(currentID);
    var favs = loadFavs();

    var kinds = doc.createElement("div");
    kinds.className = "mkt-kinds";
    kinds.setAttribute("role", "radiogroup");
    kinds.setAttribute("aria-label", "Asset type filter");
    var kindDefs = [["ALL", "All"], ["BTS", "BTS"], ["MPA", "MPA"], ["UIA", "UIA"]];
    kindDefs.forEach(function (def) {
      var lab = doc.createElement("label");
      lab.className = "mkt-kind";
      var radio = doc.createElement("input");
      radio.type = "radio";
      radio.name = "mkt-kind";
      radio.value = def[0];
      radio.checked = (_kindFilter === def[0]);
      touchable(radio);
      lab.appendChild(radio);
      lab.appendChild(el(doc, "span", def[1]));
      kinds.appendChild(lab);
    });
    section.appendChild(kinds);

    var search = doc.createElement("input");
    search.id = "mkt-search";
    search.type = "search";
    search.setAttribute("placeholder", "Search markets…");
    search.setAttribute("aria-label", "Search markets");
    touchable(search);
    section.appendChild(search);
    var ul = doc.createElement("ul");
    ul.className = "mkt-picker-list";
    section.appendChild(ul);

    /* Unique symbols across the picker list for the batched kind lookup. */
    function pickerSymbols() {
      var seen = {}, out = [];
      list.forEach(function (id) {
        try {
          var p = Market.parseId(id);
          [p.quote, p.base].forEach(function (s) {
            if (!seen[s]) { seen[s] = true; out.push(s); }
          });
        } catch (e) { /* malformed curated id: kind unknown, still listed */ }
      });
      return out;
    }

    function rowKind(id) {
      var rec = null, sym = null;
      try {
        var p = Market.parseId(id);
        sym = p.quote;
        rec = Object.prototype.hasOwnProperty.call(_kindCache, sym)
          ? _kindCache[sym] : null;
      } catch (e) { return null; }
      /* No record (lookup pending/failed) or null row (unknown symbol):
       * kind unknown — shown always (fail OPEN). Only a present record
       * classifies (BTS by symbol, MPA by bitasset_data_id, else UIA). */
      if (rec === null || rec === undefined) return null;
      return kindOf(sym, rec);
    }

    function paint(filter) {
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      var f = String(filter || "").trim().toUpperCase();
      var rows = [];
      list.forEach(function (id) {
        if (f && id.toUpperCase().indexOf(f) === -1) return;
        var k = rowKind(id);
        /* Fail OPEN: unknown kinds ignore the kind filter, never vanish. */
        if (_kindFilter !== "ALL" && k !== null && k !== _kindFilter) return;
        rows.push(id);
      });
      rows.sort(function (a, b) {
        var fa = isFav(favs, a) ? 0 : 1, fb = isFav(favs, b) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return a < b ? -1 : (a > b ? 1 : 0);
      });
      if (rows.length === 0) {
        ul.appendChild(el(doc, "li", "No markets match.", "muted"));
        return;
      }
      rows.forEach(function (id) {
        var li = doc.createElement("li");
        li.className = "mkt-picker-row";
        var a = el(doc, "a", (isFav(favs, id) ? "★ " : "") + id);
        a.setAttribute("href", "#/market/" + id);
        touchable(a);
        if (id === currentID) a.setAttribute("aria-current", "page");
        li.appendChild(a);
        var star = touchable(el(doc, "button",
          isFav(favs, id) ? "★" : "☆", "mkt-star"));
        star.type = "button";
        star.setAttribute("aria-pressed", isFav(favs, id) ? "true" : "false");
        star.setAttribute("aria-label", "Favorite " + id);
        star.addEventListener("click", function () {
          favs = toggleFav(loadFavs(), id);
          paint(search.value);
        });
        li.appendChild(star);
        ul.appendChild(li);
      });
    }
    kinds.addEventListener("change", function (ev) {
      var t = ev && ev.target;
      if (t && t.value) { _kindFilter = t.value; paint(search.value); }
    });
    search.addEventListener("input", function () { paint(search.value); });
    paint("");
    ensureKinds(pickerSymbols()).then(function () { paint(search.value); });

    var form = doc.createElement("form");
    form.className = "mkt-direct";
    var go = doc.createElement("input");
    go.id = "mkt-direct-input";
    go.type = "text";
    go.setAttribute("placeholder", "QUOTE_BASE, e.g. " + defaultMarket());
    go.setAttribute("aria-label", "Open market QUOTE_BASE directly");
    go.setAttribute("autocapitalize", "characters");
    go.setAttribute("spellcheck", "false");
    touchable(go);
    form.appendChild(go);
    var btn = touchable(el(doc, "button", "Open market"));
    btn.type = "submit";
    btn.id = "mkt-direct-go";
    form.appendChild(btn);
    var ferr = el(doc, "div", null, "error");
    ferr.setAttribute("aria-live", "polite");
    ferr.style.display = "none";
    section.appendChild(form);
    section.appendChild(ferr);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      ferr.style.display = "none";
      ferr.textContent = "";
      var typed = String(go.value || "").trim().toUpperCase();
      var pair;
      try {
        pair = Market.parseId(typed);
      } catch (e) {
        ferr.textContent = "Use QUOTE_BASE with two different symbols (e.g. " + defaultMarket() + ").";
        ferr.style.display = "";
        return;
      }
      btn.disabled = true;
      Market.assets(pair.quote, pair.base).then(function () {
        btn.disabled = false;
        if (typeof window !== "undefined" && window.location) {
          window.location.hash = "#/market/" + typed;
        }
      }).catch(function () {
        btn.disabled = false;
        ferr.textContent = "Unknown market: " + typed + ".";
        ferr.style.display = "";
      });
    });
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
        typeof MarketCharts === "undefined" || !MarketCharts) {
      showError(doc, wrap, "Market backend missing: js/market.js, js/format.js, js/indicators.js or js/market-charts.js failed to load.");
      return;
    }
    if (typeof marketID !== "string" || !marketID) {
      wrap.appendChild(el(doc, "h1", "Exchange"));
      wrap.appendChild(el(doc, "p", "Pick a market to start.", "muted"));
      var emptySec = doc.createElement("section");
      emptySec.className = "mkt-side";
      wrap.appendChild(emptySec);
      renderPicker(doc, emptySec, "", root);
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
        drawCharts(state);
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
      drawCharts(state);
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
    OSC_ORDER.forEach(function (def) {
      var key = def[0], label = def[1];
      var lab = doc.createElement("label");
      lab.className = "mkt-ind";
      var box = doc.createElement("input");
      box.type = "checkbox";
      box.value = key;
      box.checked = !!state.osc[key];
      box.setAttribute("aria-label", label + " pane");
      /* Only indicator keys need the osc module; Volume is raw bucket data. */
      if (key !== "volume" && !ind(key)) {
        box.disabled = true;
        lab.title = label + " unavailable in this build";
      }
      touchable(box);
      box.addEventListener("change", function () {
        state.osc[key] = box.checked;
        drawCharts(state);
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
    renderPicker(doc, sideSec, id, root);

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
      if (!state.chartData) return;
      drawCharts(state);
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

  /* Fill every section from the chain; sections fail inline, never blank. */
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
      maybeDraw(state);
    }).catch(function (e) {
      while (state.bookBody.firstChild) state.bookBody.removeChild(state.bookBody.firstChild);
      showError(doc, state.bookBody, e, "Could not load the order book.");
      var retry = touchable(el(doc, "button", "Retry"));
      retry.type = "button";
      retry.addEventListener("click", function () { fill(state); });
      state.bookBody.appendChild(retry);
    });

    /* Compact header stats strip: Latest / 24h change / 24h volume /
     * Best bid-ask. Renders the chain's human strings verbatim (ticker
     * latest/highest_bid/lowest_ask are already base-per-quote strings —
     * same fields as the side panel, no money math). */
    function renderStrip() {
      var st = state.ticker;
      while (state.strip.firstChild) state.strip.removeChild(state.strip.firstChild);
      if (!st) {
        state.strip.appendChild(el(doc, "span", "Loading stats…", "muted"));
        return;
      }
      function cell(label, value) {
        var s = doc.createElement("span");
        s.className = "mkt-stat";
        s.appendChild(el(doc, "span", label + " ", "muted"));
        s.appendChild(el(doc, "strong", value === null || value === undefined ? "—" : String(value)));
        state.strip.appendChild(s);
      }
      cell("Latest", st.latest);
      var chg = (st.raw && st.raw.percent_change !== undefined && st.raw.percent_change !== null)
        ? String(st.raw.percent_change) : null;
      cell("24h Δ", chg);
      var bv = (st.raw && st.raw.base_volume !== undefined && st.raw.base_volume !== null)
        ? String(st.raw.base_volume) + " " + state.assets.base.symbol : null;
      cell("24h Vol", bv);
      var bb = [st.highestBid, st.lowestAsk].filter(function (x) { return x !== null; }).join(" / ");
      cell("Bid–Ask", bb || null);
    }
    renderStrip();

    Market.stats(b.id, q.id).then(function (st) {
      state.ticker = st;
      renderStrip();
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
      maybeDraw(state);
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
        var avail = PREF_BUCKETS.filter(function (x) { return live.indexOf(x) !== -1; });
        if (avail.length === 0) avail = (live || []).slice();
        if (avail.indexOf(state.bucket) === -1 && avail.length > 0) {
          state.bucket = avail[0];
        }
        state.liveBuckets = avail;
        paintTimeframes();
      }).catch(function () {
        while (state.tfBox.firstChild) state.tfBox.removeChild(state.tfBox.firstChild);
        state.tfBox.appendChild(el(doc, "span", "Timeframes unavailable on this node.", "muted"));
        paintCountNote();
      });
    }

    function paintCountNote() {
      if (state.countNote) {
        state.countNote.textContent =
          CANDLE_COUNT + " × " + bucketLabel(state.bucket) + " candles";
      }
    }

    function paintTimeframes() {
      while (state.tfBox.firstChild) state.tfBox.removeChild(state.tfBox.firstChild);
      /* Live list only (reconciled above); the current bucket is always a
       * member, so the checked radio never dangles off-list. */
      var avail = Array.isArray(state.liveBuckets) && state.liveBuckets.length > 0
        ? state.liveBuckets.slice() : [state.bucket];
      avail.forEach(function (b) {
        var lab = doc.createElement("label");
        lab.className = "mkt-tf";
        var radio = doc.createElement("input");
        radio.type = "radio";
        radio.name = "mkt-tf";
        radio.value = String(b);
        radio.checked = (state.bucket === b);
        radio.setAttribute("aria-label", bucketLabel(b) + " candles");
        touchable(radio);
        radio.addEventListener("change", function () {
          state.bucket = b;
          paintCountNote();
          fill(state);
        });
        lab.appendChild(radio);
        lab.appendChild(el(doc, "span", bucketLabel(b)));
        state.tfBox.appendChild(lab);
      });
      paintCountNote();
    }
    paintCountNote();

    Market.candles(b.id, q.id, state.bucket, CANDLE_COUNT).then(function (c) {
      state.candles = c;
      maybeDraw(state);
    }).catch(function () {
      state.candles = { buckets: [], closes: [] };
      maybeDraw(state);
    });
  }

  /* Finite Number or null (chart-pixel inputs only — OHLC human strings become
   * coordinates here; raw integer money never enters). */
  function numOrNull(v) {
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }

  /* Null/non-finite -> NaN (Indicators warmup convention). */
  function numOrNaN(v) {
    return (typeof v === "number" && isFinite(v)) ? v : NaN;
  }

  /* Price-pane overlay lines from the picker checkboxes. Each entry is
   * {name, color, values} aligned to the candle slots (warmup nulls break
   * the line, never dive to zero). Colors are live theme tokens. Unavailable
   * indicator functions are skipped (see ind()), never throw. */
  function priceOverlays(state, closes, highs, lows, C) {
    var out = [];
    var f;
    try {
      if (state.over.sma && (f = ind("sma"))) {
        out.push({ name: "SMA 10", color: C.buy, values: f(closes, 10) });
      }
      if (state.over.ema && (f = ind("ema"))) {
        out.push({ name: "EMA 50", color: C.sell, values: f(closes, 50) });
      }
      if (state.over.bb && (f = ind("bbands"))) {
        var bb = f(closes, { period: 20, stddev: 2 });
        out.push({ name: "BB upper", color: C.muted, values: bb.upper });
        out.push({ name: "BB mid", color: C.accent, values: bb.middle });
        out.push({ name: "BB lower", color: C.muted, values: bb.lower });
      }
      if (state.over.psar && (f = ind("psar"))) {
        out.push({ name: "PSAR", color: C.warn, values: f(highs, lows, { step: 0.02, max: 0.2 }) });
      }
    } catch (e) { /* one bad overlay must not kill the pane */ }
    return out;
  }

  /* ONE stacked sub-pane's series for a single key (Task 4b) -> line entries
   * for drawOscPane, or {missing: key} when the indicator fn is unavailable
   * in this build (drawCharts renders the note; see ind()). MACD/Stoch/
   * Fisher emit two lines each. Volume needs no indicator fn: its values are
   * the cached human baseVolume Numbers (pixels-only, prepared in maybeDraw
   * from market.js human strings) and histogram:true selects the
   * HistogramSeries LWC path (canvas fallback stays a line chart). */
  function oscOne(key, state, closesNaN, highsNaN, lowsNaN, vols, C) {
    if (key === "volume") {
      return {
        series: [{ name: "Volume", color: C.accent, values: vols || [] }],
        missing: null, histogram: true
      };
    }
    var f = ind(key);
    if (!f) return { series: [], missing: key, histogram: false };
    try {
      if (key === "rsi") {
        return {
          series: [{ name: "RSI 14", color: C.accent, values: f(closesNaN, { period: 14 }) }],
          missing: null, histogram: false
        };
      }
      if (key === "macd") {
        var m = f(closesNaN, { short: 12, long: 26, signal: 9 });
        return {
          series: [
            { name: "MACD", color: C.accent, values: m.macd },
            { name: "Signal", color: C.muted, values: m.signal }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "stoch") {
        var s = f(highsNaN, lowsNaN, closesNaN, { kPeriod: 5, kSlowing: 3, dPeriod: 3 });
        return {
          series: [
            { name: "%K", color: C.accent, values: s.k },
            { name: "%D", color: C.muted, values: s.d }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "atr") {
        return {
          series: [{ name: "ATR 14", color: C.accent, values: f(highsNaN, lowsNaN, closesNaN, { period: 14 }) }],
          missing: null, histogram: false
        };
      }
      if (key === "fisher") {
        var fi = f(highsNaN, lowsNaN, { period: 9 });
        return {
          series: [
            { name: "Fisher", color: C.accent, values: fi.fisher },
            { name: "Trigger", color: C.muted, values: fi.signal }
          ],
          missing: null, histogram: false
        };
      }
    } catch (e) {
      return { series: [], missing: key, histogram: false };
    }
    return { series: [], missing: null, histogram: false };
  }

  /* Draw all three panes once book/candle data has arrived (either may come
   * first; cached so resize/theme/log redraws never re-hit the chain). */
  function maybeDraw(state) {
    var buckets = (state.candles && Array.isArray(state.candles.buckets))
      ? state.candles.buckets : [];
    var closes = [], highs = [], lows = [], times = [], vols = [];
    var i;
    for (i = 0; i < buckets.length; i++) {
      closes.push(numOrNull(Number(buckets[i] ? buckets[i].close : NaN)));
      highs.push(numOrNull(Number(buckets[i] ? buckets[i].high : NaN)));
      lows.push(numOrNull(Number(buckets[i] ? buckets[i].low : NaN)));
      times.push(Math.floor(((buckets[i] && buckets[i].timeMs) || 0) / 1000));
      /* Volume -> Number is PIXELS-ONLY (chart coordinate, not money): the
       * source is market.js buckets[].baseVolume, a human string already
       * scaled by Format.formatAmount — never a raw int, never float math. */
      var bv = buckets[i] ? buckets[i].baseVolume : null;
      vols.push(bv === null || bv === undefined ? null : numOrNull(Number(bv)));
    }
    var any = closes.some(function (v) { return v !== null; });
    var C = themeChartColors();
    var overlays = [];
    if (any) {
      overlays = priceOverlays(state,
        closes.map(numOrNaN), highs.map(numOrNaN), lows.map(numOrNaN), C);
    }
    var depth = state.bookDepth || { bids: [], asks: [] };
    /* Per-pane osc series are computed live in drawCharts (checkbox toggles
     * never refetch); only the pixel-ready raw arrays are cached here. */
    state.chartData = {
      buckets: buckets, overlays: overlays,
      closes: closes, highs: highs, lows: lows, vols: vols, oscTimes: times,
      depth: depth
    };
    drawCharts(state);
  }

  /* Draw price + ALL live stacked sub-panes (Task 4b — the SAME redraw path
   * serves checkbox toggles, x removes, theme switches and resizes: callers
   * never fork it). Each checked key in OSC_ORDER owns one wrapper
   * (.mkt-osc-pane: title + x button + chart body) appended in checkbox
   * order; unchecking removes just that wrapper via removePane. Nothing
   * checked -> the container stays childless (no blank box, no empty text).
   * Every sub-pane gets its OWN chart inside drawOscPane, hence an
   * independent scale — ranges are never shared across panes. */
  function drawCharts(state) {
    if (!state.chartData) return;
    var d = state.chartData;
    var doc = state.doc;
    var C = themeChartColors();
    var frame = { paneBg: C.paneBg, grid: C.grid, text: C.text };
    try {
      state.panes.price = MarketCharts.drawPricePane(doc, state.priceHost, {
        candles: d.buckets, overlays: d.overlays, logScale: state.logScale,
        colors: frame, emptyText: "No price history on this market.",
        previous: state.panes.price
      });
    } catch (e) { /* pane failure must not break the desk */ }
    try {
      if (!state.panes.oscs) state.panes.oscs = {};
      if (!state.paneEls) state.paneEls = {};
      var closesNaN = (d.closes || []).map(numOrNaN);
      var highsNaN = (d.highs || []).map(numOrNaN);
      var lowsNaN = (d.lows || []).map(numOrNaN);
      var missing = [];
      OSC_ORDER.forEach(function (def) {
        var key = def[0], label = def[1];
        /* Unchecked -> tear down just this pane (handle + wrapper). */
        if (!state.osc[key]) {
          try {
            MarketCharts.removePane(state.panes.oscs[key]);
          } catch (e) { /* teardown must not throw */ }
          delete state.panes.oscs[key];
          var stale = state.paneEls[key];
          if (stale && stale.wrap && stale.wrap.parentNode) {
            try { stale.wrap.parentNode.removeChild(stale.wrap); } catch (e) { /* gone */ }
          }
          delete state.paneEls[key];
          return;
        }
        var one;
        try {
          one = oscOne(key, state, closesNaN, highsNaN, lowsNaN, d.vols, C);
        } catch (e) {
          one = { series: [], missing: key, histogram: false };
        }
        if (one.missing) {
          try {
            MarketCharts.removePane(state.panes.oscs[key]);
          } catch (e) { /* teardown must not throw */ }
          delete state.panes.oscs[key];
          var gone = state.paneEls[key];
          if (gone && gone.wrap && gone.wrap.parentNode) {
            try { gone.wrap.parentNode.removeChild(gone.wrap); } catch (e) { /* gone */ }
          }
          delete state.paneEls[key];
          missing.push(label);
          return;
        }
        /* Ensure the wrapper (title + x + body), in checkbox order. */
        var slot = state.paneEls[key];
        if (!slot || !slot.wrap || !slot.body ||
            slot.wrap.parentNode !== state.oscHost) {
          var wrap = doc.createElement("div");
          wrap.className = "mkt-osc-pane";
          wrap.setAttribute("data-osc", key);
          var head = doc.createElement("div");
          head.className = "mkt-osc-head";
          head.appendChild(el(doc, "span", label, "mkt-osc-title"));
          var x = touchable(el(doc, "button", "✕", "mkt-osc-x"));
          x.type = "button";
          x.setAttribute("aria-label", "Remove " + label + " pane");
          /* forEach scope gives each closure its own key — no IIFE needed. */
          x.addEventListener("click", function () {
            state.osc[key] = false;
            var cb = state.oscBoxes && state.oscBoxes[key];
            if (cb) cb.checked = false;
            drawCharts(state);
          });
          head.appendChild(x);
          wrap.appendChild(head);
          var body = doc.createElement("div");
          body.className = "mkt-osc-body";
          wrap.appendChild(body);
          slot = { wrap: wrap, body: body };
          state.paneEls[key] = slot;
        }
        /* Re-append in OSC_ORDER so DOM order always matches checkbox order
         * (appendChild moves an existing node to the end). */
        try { state.oscHost.appendChild(slot.wrap); } catch (e) { /* headless */ }
        try {
          state.panes.oscs[key] = MarketCharts.drawOscPane(doc, slot.body, {
            times: d.oscTimes, series: one.series, colors: frame,
            histogram: !!one.histogram,
            emptyText: "No " + label + " data.",
            previous: state.panes.oscs[key]
          });
        } catch (e) { /* one bad pane must not kill the stack */ }
      });
      if (state.oscNote) {
        state.oscNote.textContent = missing.length > 0
          ? missing.join(", ") + " unavailable in this build."
          : "";
      }
    } catch (e) { /* pane failure must not break the desk */ }
    try {
      MarketCharts.drawDepth(state.depthCanvas, d.depth.bids, d.depth.asks,
        { low: null, high: null }, "No depth data.");
    } catch (e) { /* canvas failure must not break the desk */ }
  }

  return {
    renderMarket: renderMarket,
    homeTarget: homeTarget,
    defaultMarket: defaultMarket
  };
})();

if (typeof module !== "undefined") { module.exports = MarketUI; }
