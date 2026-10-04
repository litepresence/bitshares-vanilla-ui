/* MarketDesk: DEX desk shell for /market/:marketID (skeleton, fill, refresh).
 * Owns: route entry renderMarket(root, marketID), desk skeleton showDesk
 *   (header, charts hosts, book/trades-toggle/orders/trade/depth/stats cells,
 *   side picker rail, refresh + 15s timer with cleanup), data fill
 *   (book/stats/trades/my-trades/timeframes/candles — each section fails
 *   inline), last-visited market persistence (saveLast under LAST_KEY),
 *   timer/listener cleanup.
 *   LAYOUT (retro equal 2x3 grid + right rail — reference
 *   docs/parity/original-buy-sell-2x3-2026-09-28.png): chart stack on top
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
 *   defaults + connection wait), Chain.status, TableRenderer (my-fills table
 *   shell — script-tag global, index.html order). No signing, no cancel path.
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

  /* No local el/clearRoot — use DOM.el, DOM.clear */

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */

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

  /* Desk deep-link state (?tf=&over=&osc=&log=&vwap=&depth=&pmap=&dx=&dy=&
   * trades=&group= — shareable links, back-button-safe). Indicator keys are
   * stable identifiers (OSC_ORDER/OVERLAY_DEFS symbols); only non-default
   * values serialize so plain pairs stay clean (#/market/BTS_USD). Unknown
   * or malformed values fall back to current defaults — never throw, never
   * blank. Overlay instances serialize as bare keys (default params on
   * open — documented limitation, same class as the invoice worker). */
  var GROUP_CHOICES = [8, 6, 4, 2];
  var KEY_RE = /^[a-z0-9]+$/;
  /* indKeys: valid indicator keys from the MarketInd def tables (guarded —
   * tests inject fakes; absent MarketInd drops both lists, never throws). */
  function indKeys(indApi) {
    var over = {}, osc = {};
    try {
      var api = indApi || ((typeof MarketInd !== "undefined" && MarketInd) ? MarketInd : null);
      if (api) {
        (api.OVERLAY_DEFS || []).forEach(function (def) {
          if (def && KEY_RE.test(def[0])) over[def[0]] = true;
        });
        (api.OSC_ORDER || []).forEach(function (def) {
          if (def && KEY_RE.test(def[0])) osc[def[0]] = true;
        });
      }
    } catch (e) { /* empty sets below */ }
    return { over: over, osc: osc };
  }
  function flag01(v, dflt) {
    if (v === "1") return true;
    if (v === "0") return false;
    return dflt;
  }
  function keyList(raw, valid) {
    var out = [];
    try {
      String(raw || "").split(",").forEach(function (k) {
        k = k.trim().toLowerCase();
        if (k && KEY_RE.test(k) && valid[k] && out.indexOf(k) === -1) out.push(k);
      });
    } catch (e) { /* out stands */ }
    return out;
  }
  /* readDeskQuery: URL -> desk seed (unit-tested). Params: raw (query object
   * from Router.query(), or null), indApi (optional MarketInd override for
   * tests). Returns a full seed with defaults filled. Bucket bounds are
   * advisory (live reconcile corrects against the node list); indicator
   * keys outside the def tables are dropped. Never throws. */
  function readDeskQuery(raw, indApi) {
    var q = (raw && typeof raw === "object") ? raw : {};
    var keys = indKeys(indApi);
    var seed = {
      bucket: 3600, over: {}, osc: {},
      logScale: false, showVwap: false, showDepth: false, showPoolMap: true,
      depthLogX: true, depthLogY: true, tradesTab: "recent", groupDec: null
    };
    try {
      var tf = parseInt(q.tf, 10);
      if (Number.isInteger(tf) && tf > 0 && tf <= 86400 * 30) seed.bucket = tf;
      keyList(q.over, keys.over).forEach(function (k) { seed.over[k] = [{}]; });
      keyList(q.osc, keys.osc).forEach(function (k) { seed.osc[k] = true; });
      seed.logScale = flag01(q.log, false);
      seed.showVwap = flag01(q.vwap, false);
      seed.showDepth = flag01(q.depth, false);
      seed.showPoolMap = flag01(q.pmap, true);
      seed.depthLogX = flag01(q.dx, true);
      seed.depthLogY = flag01(q.dy, true);
      if (q.trades === "my" || q.trades === "recent") seed.tradesTab = q.trades;
      var g = parseInt(q.group, 10);
      if (GROUP_CHOICES.indexOf(g) !== -1) seed.groupDec = g;
    } catch (e) { /* defaults stand */ }
    return seed;
  }
  /* buildDeskQuery: desk state -> "?k=v" (unit-tested). Params: state (desk
   * state object). Returns "" when everything is default, else the query
   * string with leading "?". Pure, never throws. */
  function buildDeskQuery(state) {
    var parts = [];
    try {
      var s = state || {};
      if (Number.isInteger(s.bucket) && s.bucket > 0 && s.bucket !== 3600) parts.push("tf=" + s.bucket);
      var ol = Object.keys(s.over || {}).filter(function (k) {
        return KEY_RE.test(k) && s.over[k] && s.over[k].length;
      });
      if (ol.length) parts.push("over=" + ol.join(","));
      var sl = Object.keys(s.osc || {}).filter(function (k) {
        return KEY_RE.test(k) && !!s.osc[k];
      });
      if (sl.length) parts.push("osc=" + sl.join(","));
      if (s.logScale) parts.push("log=1");
      if (s.showVwap) parts.push("vwap=1");
      if (s.showDepth) parts.push("depth=1");
      if (s.showPoolMap === false) parts.push("pmap=0");
      if (s.depthLogX === false) parts.push("dx=0");
      if (s.depthLogY === false) parts.push("dy=0");
      if (s.tradesTab === "my") parts.push("trades=my");
      if (GROUP_CHOICES.indexOf(s.groupDec) !== -1) parts.push("group=" + s.groupDec);
    } catch (e) { /* parts stand */ }
    return parts.length ? ("?" + parts.join("&")) : "";
  }
  /* syncUrl: write current desk state into the hash without re-rendering
   * (api-lab deepLink precedent — replaceState never fires hashchange, so
   * no render loop). Params: state (desk state, needs .id). Returns
   * nothing. Fails: never (every DOM/history touch guarded — the desk
   * works identically with the URL untouched). */
  function syncUrl(state) {
    try {
      if (!state || typeof state.id !== "string" || !state.id) return;
      if (typeof location === "undefined" || !location.href) return;
      if (typeof history === "undefined" || typeof history.replaceState !== "function") return;
      history.replaceState(null, "", location.href.split("#")[0] + "#/market/" + state.id + buildDeskQuery(state));
    } catch (e) { /* URL stays; view unaffected */ }
  }

  /* Inline error panel (aria-live); chain error shapes map to sentences.
   * History fallback keeps its byte-identical message key and gains a linked
   * "Open Settings" action (HistoryNotice.actionLink, pure DOM). */
  function showError(doc, wrap, e, fallback) {
    var raw = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || "");
    var isHist = raw.indexOf("history-unavailable") !== -1;
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
    var err = DOM.error(wrap, msg);
    if (isHist) {
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          var link = HistoryNotice.actionLink(doc, t, "settings");
          if (link) wrap.appendChild(link);
        }
      } catch (e2) { /* error panel stands without the link */ }
    }
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
    DOM.clear(root);
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
      wrap.appendChild(DOM.pageHead(doc, t("market.title", "Exchange"), "trade"));
      wrap.appendChild(DOM.el(doc, "p", t("market.pick_to_start", "Pick a market to start."), "muted"));
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
      wrap.appendChild(DOM.pageHead(doc, t("market.not_found", "Market not found"), "trade"));
      showError(doc, wrap, e, t("market.err_unknown", "Unknown market."));
      return;
    }
    var id = (pair.quote + "_" + pair.base).toUpperCase();
    saveLast(id);

    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(DOM.el(doc, "p", t("market.connecting", "Connecting to network…"), "muted"));
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderMarket(root, id);
        }
      });
      /* Automated handshake on entry (shared Offline helper owns the
       * throttle — a dropped socket heals without waiting for the 15s
       * timeout or Chain's 30s background tick). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait below covers */ }
      var timer = setTimeout(function () {
        if (settled) return; settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        DOM.clear(root);
        var failed = makeWrap(doc, root);
        failed.appendChild(DOM.pageHead(doc, t("market.title", "Exchange"), "trade"));
        showError(doc, failed, new Error("not connected"), t("market.err_offline_short", "Network unavailable."));
        var mstat = DOM.el(doc, "p", "", "muted");
        try { mstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        failed.appendChild(mstat);
        var mrow = DOM.el(doc, "div", null, "pools-offline-row");
        failed.appendChild(mrow);
        var retry = touchable(DOM.el(doc, "button", t("market.retry", "Retry")));
        retry.id = "mkt-retry";
        retry.type = "button";
        mrow.appendChild(retry);
        var moff = null;
        try { moff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { moff = null; }
        if (moff && typeof moff.wire === "function") {
          try { moff.wire(retry, mstat, function () { renderMarket(root, id); }, t); } catch (e) { retry.addEventListener("click", function () { renderMarket(root, id); }); }
        } else {
          retry.addEventListener("click", function () { renderMarket(root, id); });
        }
        var mlink = null;
        if (moff && typeof moff.settingsLink === "function") {
          try { mlink = moff.settingsLink(doc, t); } catch (e) { mlink = null; }
        }
        if (!mlink) {
          mlink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
          try { mlink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          touchable(mlink);
        }
        mrow.appendChild(mlink);
      }, 15000);
      return;
    }
    showDesk(doc, wrap, root, pair, id, hashAtEntry);
  }

  /* Desk skeleton: header, charts, book, trades, side (picker+stats), orders.
   * Each section fills independently and fails inline; Refresh + 15s timer
   * re-run the fill; the timer self-clears when the hash moves away. */
  function showDesk(doc, wrap, root, pair, id, hashAtEntry) {
    /* Deep-link seed (?tf=&over=&osc=&…): unknown values already fell back
     * to defaults in readDeskQuery; bucket bounds re-reconcile against the
     * live node list at first fill (existing behavior, unchanged). */
    var seed = (function () {
      try {
        if (typeof Router !== "undefined" && Router && typeof Router.query === "function") {
          return readDeskQuery(Router.query());
        }
      } catch (e) { /* defaults below */ }
      return readDeskQuery(null);
    })();
    var state = {
      id: id, pair: pair, root: root, doc: doc, wrap: wrap,
      assets: null, loading: false, redraw: null,
      /* Slice-07 Task 4 chart state: bucket default 3600 reconciled with the
       * live list on first fill; logScale is a pure priceScale mode switch
       * (no refetch); overlays default OFF (price + pool map only — every
       * overlay stays available in the Indicators pulldown). */
      bucket: seed.bucket, tfInit: false, logScale: seed.logScale,
      /* Toggleable plots (menu "Plots" group): VWAP strip + depth slice + pool map.
       * Only the price pane is always on; pool map defaults on, depth + VWAP
       * default off (all three stay toggleable in the Indicators pulldown). */
      showVwap: seed.showVwap, showDepth: seed.showDepth, showPoolMap: seed.showPoolMap,
      /* Depth scales ship log/log (far-spam prices + dust volumes stay
       * legible); toggles in the depth cell flip either axis. */
      depthLogX: seed.depthLogX, depthLogY: seed.depthLogY,
      over: seed.over,
      /* Stacked panes: every oscillator defaults OFF (price + pool map only).
       * Each key in MarketInd.OSC_ORDER stays available via the Indicators
       * pulldown; panes.oscs maps key -> pane handle from drawOscPane;
       * paneEls maps key -> {wrap, body} DOM nodes; oscBoxes maps key ->
       * checkbox input (x buttons uncheck through it). */
      osc: seed.osc,
      panes: { price: null, oscs: {} },
      paneEls: {}, oscBoxes: {},
      ticker: null, countNote: null, tfBox: null, oscNote: null,
      /* Grouped book (client-side bucketing, no refetch): groupDec null =
       * exact levels; else 8/6/4/2 decimals floor via MarketBook.groupBook.
       * bookRaw caches the last fetched get_order_book pair for repaints. */
      groupDec: seed.groupDec, bookRaw: null,
      /* Pool-map provenance slice (2-layer BTS-core map, own canvas — never blocks desk). */
      graphWrap: null, graphCanvas: null, graphNote: null, graphData: null
    };

    var desk = DOM.el(doc, "div", null, "mkt mkt-exchange");
    wrap.appendChild(desk);

    var head = doc.createElement("section");
    head.className = "mkt-head";
    desk.appendChild(head);
    head.appendChild(DOM.pageHead(doc, pair.quote + " / " + pair.base, "trade"));
    var sub = DOM.el(doc, "p", t("market.loading", "Loading market…"), "muted");
    head.appendChild(sub);
    /* LOW punchlist: header star favourite next to the pair (same FAV_KEY the
     * picker owns) + disabled column-chooser gear (columns are fixed; the
     * reference Personalize dialog is not rebuilt). Batch-3 i18n: keyed. */
    try {
      var favKey = "bts-vanilla-fav-markets-v1";
      var starBtn = doc.createElement("button");
      starBtn.type = "button";
      starBtn.id = "mkt-head-star";
      starBtn.setAttribute("aria-label", t("market.favourite_prefix", "Favourite ") + id);
      touchable(starBtn);
      /* paintStar: repaint the favourite star from localStorage (aria-pressed + title).
       * WHY helper: toggle and initial paint share this read; storage gaps show ☆.
       * No params, no return; never throws. */
      function paintStar() {
        var fav = false;
        try {
          var arr = JSON.parse(localStorage.getItem(favKey) || "[]");
          fav = Array.isArray(arr) && arr.indexOf(id) !== -1;
        } catch (e) { fav = false; }
        starBtn.textContent = fav ? "★" : "☆";
        starBtn.setAttribute("aria-pressed", fav ? "true" : "false");
        starBtn.title = fav ? t("market.starred_click_to_unstar", "Starred — click to unstar") : t("market.star_this_market", "Star this market");
      }
      paintStar();
      starBtn.addEventListener("click", function () {
        try {
          var arr2 = [];
          try { arr2 = JSON.parse(localStorage.getItem(favKey) || "[]"); } catch (e) { arr2 = []; }
          if (!Array.isArray(arr2)) arr2 = [];
          var ix = arr2.indexOf(id);
          if (ix === -1) arr2.push(id);
          else arr2.splice(ix, 1);
          try { localStorage.setItem(favKey, JSON.stringify(arr2)); } catch (e) { /* session-only */ }
        } catch (e) { /* star stays visual */ }
        paintStar();
      });
      head.appendChild(starBtn);
    } catch (e) { /* header works without the star */ }
    /* Punchlist LOW: header pair-flip (invert) control next to the star
     * (original header flip concept). Re-renders the swapped QUOTE_BASE
     * pair via the hash router — cheap, no state to keep in sync (same
     * pattern as the charts Invert toggle below). Plain literals only. */
    try {
      var flipBtn = doc.createElement("button");
      flipBtn.type = "button";
      flipBtn.id = "mkt-head-flip";
      flipBtn.textContent = "⇄";
      flipBtn.title = t("market.invert_label", "Invert market pair");
      flipBtn.setAttribute("aria-label", t("market.invert_label", "Invert market pair"));
      touchable(flipBtn);
      flipBtn.addEventListener("click", function () {
        try {
          var p = Market.parseId(id);
          if (typeof window !== "undefined" && window.location) {
            window.location.hash = "#/market/" + p.base + "_" + p.quote;
          }
        } catch (e) { /* malformed id: router already shows 404 */ }
      });
      head.appendChild(flipBtn);
    } catch (e) { /* header works without the flip */ }
    /* Copy-link share (account shareRow precedent — copy-link only, no QR
     * by decision). Reads the LIVE hash at tap time: desk state rides
     * replaceState, so the link preserves pair + indicators + bucket. */
    try {
      var shareBtn = doc.createElement("button");
      shareBtn.type = "button";
      shareBtn.id = "mkt-head-share";
      shareBtn.textContent = t("misc.copy_link", "Copy link");
      shareBtn.title = t("misc.shareable_link", "Shareable link");
      shareBtn.setAttribute("aria-label", t("misc.shareable_link", "Shareable link"));
      touchable(shareBtn);
      var shareNote = DOM.el(doc, "span", "", "muted");
      try { shareNote.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      shareBtn.addEventListener("click", function () {
        shareBtn.disabled = true;
        shareNote.textContent = t("misc.copying", "Copying…");
        var hash = "#/market/" + id, url = hash;
        try {
          if (typeof location !== "undefined" && typeof location.hash === "string" && location.hash) {
            hash = location.hash;
          }
          if (typeof Explorer !== "undefined" && Explorer && typeof Explorer.currentShareUrl === "function") {
            url = Explorer.currentShareUrl(hash);
          } else if (typeof location !== "undefined" && location.href) {
            url = location.href.split("#")[0] + hash;
          }
        } catch (e) { url = hash; }
        function done(ok) {
          try { shareBtn.disabled = false; } catch (e2) { /* stands */ }
          shareNote.textContent = ok ? t("misc.copied", "Copied")
            : t("misc.copy_failed_select_manually", "Copy failed — select the link manually");
        }
        function fallback() {
          try {
            var ta = doc.createElement("textarea");
            ta.value = url; doc.body.appendChild(ta); ta.select();
            var ok = false;
            try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
            try { ta.parentNode.removeChild(ta); } catch (e2) { /* gone */ }
            done(!!ok);
          } catch (e) { done(false); }
        }
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard &&
              typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(url).then(function () { done(true); }, function () { fallback(); });
          } else fallback();
        } catch (e) { fallback(); }
      });
      head.appendChild(shareBtn);
      head.appendChild(shareNote);
    } catch (e) { /* header works without share */ }
    try {
      var gearBtn = doc.createElement("button");
      gearBtn.type = "button";
      gearBtn.disabled = true;
      gearBtn.textContent = t("market.columns_fixed", "⚙ Columns (fixed)");
      gearBtn.title = t("market.column_chooser_is_not_offered_the_book_h", "Column chooser is not offered — the book, history and orders tables have fixed columns.");
      gearBtn.setAttribute("aria-disabled", "true");
      touchable(gearBtn);
      head.appendChild(gearBtn);
    } catch (e) { /* header works without the gear */ }
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
    var spreadLine = DOM.el(doc, "p", "", "muted");
    head.appendChild(spreadLine);
    /* Grouped-book toggle (client-side bucketing of the fetched levels — no
     * refetch, no new WS method, no ES): Exact or floor to 8/6/4/2 decimals
     * via MarketBook.groupBook (Format-validated, exact sums). One control in
     * the head governs BOTH order lists below; the depth bars follow the
     * grouped rows (renderSplit recomputes depth from them). */
    try {
      var groupRow = doc.createElement("div");
      groupRow.className = "mkt-grouprow";
      var groupLab = DOM.el(doc, "span", t("market.group_label", "Grouping") + " ");
      groupRow.appendChild(groupLab);
      var groupSel = doc.createElement("select");
      groupSel.id = "mkt-book-group";
      groupSel.setAttribute("aria-label", t("market.group_label", "Grouping"));
      touchable(groupSel);
      var offOpt = doc.createElement("option");
      offOpt.value = "";
      offOpt.textContent = t("market.group_off", "Exact prices");
      groupSel.appendChild(offOpt);
      ["8", "6", "4", "2"].forEach(function (d) {
        var o = doc.createElement("option");
        o.value = d;
        o.textContent = d + " " + t("market.group_decimals", "decimals");
        groupSel.appendChild(o);
      });
      groupSel.addEventListener("change", function () {
        var v = groupSel.value;
        state.groupDec = (v === "" || v === null) ? null : parseInt(v, 10);
        if (!Number.isInteger(state.groupDec)) state.groupDec = null;
        paintBook(doc, state);
        try {
          if (typeof MarketInd !== "undefined" && MarketInd &&
              typeof MarketInd.maybeDraw === "function") MarketInd.maybeDraw(state);
        } catch (e) { /* book stands without the chart */ }
        try { syncUrl(state); } catch (e) { /* URL stays */ }
      });
      groupRow.appendChild(groupSel);
      head.appendChild(groupRow);
      head.appendChild(DOM.el(doc, "p", t("market.group_note", "Grouped rows sum base/quote exactly; bucket price is the floor."), "muted"));
    } catch (e) { /* head works without the grouping toggle */ }
    /* Raw-ticker proof host (triangle-only details, refilled per stats
     * fetch — the 24h dl panel is gone with the stats grid cell). */
    var tickerRaw = doc.createElement("div");
    head.appendChild(tickerRaw);

    var chartsSec = doc.createElement("section");
    chartsSec.className = "mkt-charts";
    desk.appendChild(chartsSec);
    chartsSec.appendChild(DOM.el(doc, "h2", t("market.charts", "Charts")));

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
    var countNote = DOM.el(doc, "p", "", "muted mkt-count-note");
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
      try { syncUrl(state); } catch (e) { /* URL stays */ }
    });
    logLab.appendChild(logBox);
    logLab.appendChild(DOM.el(doc, "span", t("market.log_label", "Log")));
    indRow.appendChild(logLab);
    /* Invert toggle (ported from DEX-UX): re-render the swapped QUOTE_BASE
     * pair via the hash router — cheap, no state to keep in sync. */
    var invBtn = touchable(DOM.el(doc, "button", t("market.invert", "Invert")));
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
    var oscNote = DOM.el(doc, "p", "", "muted");
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
    buySec.appendChild(DOM.el(doc, "h2", "Buy " + pair.quote));
    var buyMount = doc.createElement("div");
    buySec.appendChild(buyMount);

    var sellSec = doc.createElement("section");
    sellSec.className = "mkt-sell";
    colSell.appendChild(sellSec);
    sellSec.appendChild(DOM.el(doc, "h2", "Sell " + pair.quote));
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
    tradesSec.appendChild(DOM.el(doc, "h2", t("market.trades_title", "Trades")));
    var tradesTabs = doc.createElement("div");
    tradesTabs.className = "mkt-tabs";
    tradesTabs.setAttribute("role", "tablist");
    tradesTabs.setAttribute("aria-label", t("market.trades_toggle_label", "Recent or my trades"));
    var tabRecent = touchable(DOM.el(doc, "button", t("market.tab_recent", "Recent trades")));
    tabRecent.type = "button";
    tabRecent.id = "mkt-trades-tab-recent";
    tabRecent.setAttribute("role", "tab");
    var tabMy = touchable(DOM.el(doc, "button", t("market.tab_my", "My trades")));
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
    state.tradesTab = seed.tradesTab || "recent";
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
      try { syncUrl(state); } catch (e) { /* URL stays */ }
    });
    tabMy.addEventListener("click", function () {
      state.tradesTab = "my";
      paintTradesTab();
      renderMyTrades(doc, state);
      try { syncUrl(state); } catch (e) { /* URL stays */ }
    });
    paintTradesTab();

    /* ROW 2 col 1+2: split book (OrderBook Exchange.jsx:2466-2537, same
     * sides): BUY ORDERS (bids) | SELL ORDERS (asks) as two equal cells.
     * MarketBook.renderSplit fills both through the shared row builder;
     * each cell owns a fixed-height scroll region like the old book. */
    var bidsSec = doc.createElement("section");
    bidsSec.className = "mkt-bids";
    colBuy.appendChild(bidsSec);
    bidsSec.appendChild(DOM.el(doc, "h2", "Buy orders"));
    var bidsBody = doc.createElement("div");
    bidsSec.appendChild(bidsBody);

    var asksSec = doc.createElement("section");
    asksSec.className = "mkt-asks";
    colSell.appendChild(asksSec);
    asksSec.appendChild(DOM.el(doc, "h2", "Sell orders"));
    var asksBody = doc.createElement("div");
    asksSec.appendChild(asksBody);

    /* ROW 2 col 3: my open orders (MarketOrders Exchange.jsx:2618-2654,
     * activeTab "my_orders"; settlement Exchange.jsx:2656-2693 activeTab
     * "open_settlement" stays a future tab — vanilla shows my_orders only,
     * honest scope, no silent stub). */
    var ordersSec = doc.createElement("section");
    ordersSec.className = "mkt-orders";
    colTrade.appendChild(ordersSec);
    ordersSec.appendChild(DOM.el(doc, "h2", t("market.my_orders", "My open orders")));
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
    depthHead.appendChild(DOM.el(doc, "span", t("market.depth_title", "Depth"), "mkt-osc-title"));
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
      var b = touchable(DOM.el(doc, "button", "", "subtle-btn"));
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
        try { syncUrl(state); } catch (e) { /* URL stays */ }
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
    graphHead.appendChild(DOM.el(doc, "span", "Pool map", "mkt-osc-title"));
    graphWrap.appendChild(graphHead);
    var graphCanvas = doc.createElement("canvas");
    graphCanvas.className = "mkt-canvas";
    graphWrap.appendChild(graphCanvas);
    var graphNote = DOM.el(doc, "p", "Loading pool map…", "muted");
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
    var refreshBtn = touchable(DOM.el(doc, "button", t("market.refresh", "Refresh")));
    refreshBtn.id = "mkt-refresh";
    refreshBtn.type = "button";
    foot.appendChild(refreshBtn);
    var updated = DOM.el(doc, "span", "", "muted");
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
    /* Exposed for the module-level deepenOnce below (lazy-deep): fill() and
     * deepenOnce live outside this closure, so the nested paintNote rides
     * the state bag like state.redraw above. Never reassigned. */
    state.paintNote = paintNote;

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
         * retry covers). Generation guard on state.tipSeq (shared with
         * full-fill and deepen paints below): overlapping poll/push/full
         * responses paint only when still latest — a slow older fetch must
         * never overwrite a newer paint (the flaky-chart fix). */
        function refreshTip() {
          if (!deskAlive()) return;
          if (state.loading) return;
          state.tipSeq = (state.tipSeq || 0) + 1;
          var seq = state.tipSeq;
          /* Tip window is small by design (2026-10-02 fix): the full count
           * now paginates server-side (up to 25 RPCs at count 5000), which
           * a 3.5s poll must never pay. 60 fresh slots merged into the
           * painted window carry the tip; full fills repaint whole windows. */
          var count = 2000;
          var TIP_COUNT = 60;
          try {
            if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) {
              count = MarketInd.CANDLE_COUNT;
            }
          } catch (e) { /* default stands */ }
          try {
            Market.candles(b.id, q.id, state.bucket, TIP_COUNT).then(function (c) {
              if (!deskAlive() || seq !== state.tipSeq) return;
              var merged = (c && c.buckets) || [];
              try {
                if (typeof MarketCandles !== "undefined" && MarketCandles &&
                    typeof MarketCandles.mergeWindows === "function") {
                  merged = MarketCandles.mergeWindows(
                    state.candles && state.candles.buckets, c.buckets, count);
                }
              } catch (e) { /* fresh tip stands alone */ }
              state.candles = { bucket: state.bucket, start: null, end: null,
                buckets: merged, closes: [], deep: state.deep };
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
  /* paintDeepButton: "Load deeper history" under the recent-trades list
   * (Phase 7 B1 UI). One-shot 7-day window via Market.tradesDeep (same
   * envelope as trades(), so renderTrades is reused verbatim). Success
   * stores state.deepRows and paints the deep view, which SURVIVES the 15s
   * refill loop (fill() re-renders deepRows instead of refetching — without
   * this the loop clobbers deep rows within seconds and in-flight fetches
   * resolve into a stale host). "Back to live" clears the flag and
   * refills. Failure appends the mapped error with the Round-1 Settings
   * link and re-arms for retry. Gen-guarded by market id like live() below.
   * Params: doc, state, b/q (asset {id, symbol}). Fails: never (fetch
   * errors render inline). */
  function paintDeepButton(doc, state, b, q) {
    var host = state.recentBody || state.tradesBody;
    if (!host) return;
    try { if (state.deepBtn && state.deepBtn.parentNode) state.deepBtn.parentNode.removeChild(state.deepBtn); } catch (e) { /* refetch stands */ }
    state.deepBtn = null;
    if (state.deepRows) { paintBackButton(doc, state); return; }
    if (typeof Market === "undefined" || !Market || typeof Market.tradesDeep !== "function") return;
    var btn = touchable(DOM.el(doc, "button", t("market.load_deeper", "Load deeper history")));
    btn.type = "button";
    state.deepBtn = btn;
    host.appendChild(btn);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      Market.tradesDeep(b.id, q.id, { days: 7, limit: 100 }).then(function (deep) {
        try {
          if (String((typeof location !== "undefined" && location.hash) || "").toUpperCase().indexOf(state.id) === -1) return;
        } catch (e) { /* headless: hash guard skipped */ }
        state.deepRows = deep;
        MarketBook.renderTrades(doc, host, { rows: deep, quoteSymbol: q.symbol });
        paintBackButton(doc, state);
        renderMyTrades(doc, state);
        MarketInd.maybeDraw(state);
      }).catch(function (e) {
        showError(doc, host, e, t("market.fail_trades", "Could not load recent trades."));
        try { host.appendChild(btn); } catch (e2) { /* error stands */ }
        btn.disabled = false;
        renderMyTrades(doc, state);
      });
    });
  }
  /* paintBackButton: leaves the deep view ("Back to live trades" clears
   * state.deepRows and refills the live 30). Params: doc, state. The desk
   * re-renders deep rows on every refill while the flag stands, so this is
   * the only exit — no auto-expiry, no surprise reverts. Never throws. */
  function paintBackButton(doc, state) {
    var host = state.recentBody || state.tradesBody;
    if (!host) return;
    try { if (state.deepBtn && state.deepBtn.parentNode) state.deepBtn.parentNode.removeChild(state.deepBtn); } catch (e) { /* refetch stands */ }
    state.deepBtn = null;
    var back = touchable(DOM.el(doc, "button", t("market.back_to_live", "Back to live trades")));
    back.type = "button";
    state.deepBtn = back;
    host.appendChild(back);
    back.addEventListener("click", function () {
      state.deepRows = null;
      state.deepBtn = null;
      try { fill(state); } catch (e) { /* refill carries errors */ }
    });
  }
  function renderMyTrades(doc, state) {
    var host = state.myBody || state.tradesBody;
    var assets = state.assets;
    if (!host || !assets) return;
    DOM.clear(host);
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
    var lab = DOM.el(doc, "span", t("account.card_account", "Account") + " ");
    var acctInput = doc.createElement("input");
    acctInput.type = "text";
    acctInput.setAttribute("placeholder", t("ticket.name_or_1_2_n", "name or 1.2.N"));
    acctInput.setAttribute("aria-label", t("account.card_account", "Account"));
    acctInput.style.minHeight = "44px";
    acctInput.style.width = "12em";
    var viewBtn = touchable(DOM.el(doc, "button", t("referrals.look_up", "Look up")));
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
      DOM.clear(myBody);
      var hint = DOM.el(doc, "p", t("market.my_trades_locked", "Unlock your wallet to see your fills on this market. "), "muted");
      var a = DOM.el(doc, "a", t("market.go_wallet", "Go to Wallet"));
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
    /* fillCells: one pair-fill -> plain display-string row {block, price,
     * amount} (TableRenderer pilot: the cell math moved verbatim from the
     * paintFills row builder below — Format math untouched, honest dashes
     * stand; the phone cards reuse the same triple). Params: f ({row, op}).
     * Returns {block, price, amount} strings. Never throws. */
    function fillCells(f) {
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
      return { block: String(blk), price: String(price), amount: String(amt) };
    }
    /* paintFills: op-4 pair fills for the typed/unlocked account as a
     * table (empty -> honest hint). No-ops when live() is false. */
    function paintFills(fills) {
      if (!live()) return;
      DOM.clear(myBody);
      if (fills.length === 0) {
        myBody.appendChild(DOM.el(doc, "p", t("market.no_my_trades", "No fills for your account on this market.") + t("market.my_trades_hint", " Place an order from the Buy/Sell panels — unlock the wallet to see your fills."), "muted"));
        return;
      }
      var shown = fills.slice(0, 30);
      var rows = shown.map(fillCells);
      /* TableRenderer pilot: the table shell comes from the shared renderer
       * (same Block/Price/Amount titles, order, and left alignment as the
       * hand-built table it replaces — no keys, classes, or clicks before,
       * none added). Cards + scroller + raw details below are unchanged. */
      var table = TableRenderer.render({
        columns: [
          { key: "block", title: t("market.th_block", "Block") },
          { key: "price", title: t("market.th_price", "Price") },
          { key: "amount", title: t("market.th_amount", "Amount") }
        ],
        rows: rows,
        stickyFirstCol: true
      });
      var cards = doc.createElement("div");
      cards.className = "node-cards trades-cards";
      shown.forEach(function (f, i) {
        var card = doc.createElement("div");
        card.className = "node-card";
        card.appendChild(DOM.el(doc, "div", "#" + rows[i].block));
        card.appendChild(DOM.el(doc, "div", rows[i].price));
        card.appendChild(DOM.el(doc, "div", rows[i].amount));
        cards.appendChild(card);
      });
      var scroller = doc.createElement("div");
      scroller.className = "trades-scroll";
      scroller.appendChild(table);
      myBody.appendChild(scroller);
      myBody.appendChild(cards);
      rawDetails(doc, myBody, t("market.raw_my_fills", "Raw my fills"), shown.map(function (f) { return f.row; }));
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
      DOM.clear(myBody);
      myBody.appendChild(DOM.el(doc, "p", t("market.loading_my_trades", "Loading your fills…"), "muted"));
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
        DOM.clear(myBody);
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
    myBody.appendChild(DOM.el(doc, "p", t("market.loading_my_trades", "Loading your fills…"), "muted"));
    Account.myAccountId().then(function (myId) {
      return Account.history(myId, 100).then(function (rows) {
        return { myId: myId, rows: rows || [] };
      });
    }).then(function (found) {
      if (!live()) return;
      paintFills(pairFills(found.rows));
    }).catch(function (e) {
      if (!live()) return;
      DOM.clear(myBody);
      showError(doc, myBody, e, t("market.fail_my_trades", "Could not load your fills."));
    });
  }

  /* Lazy-deep backfill (2026-10-01 audit): after the chain-first candle
   * paint, fetch the background ES buckets ONCE per pair+bucket, then re-run
   * the chain candles (which merge the cache under fresh authority) and
   * repaint with the "deep" note. Interval refreshes and live-tip polls never
   * call this — they stay chain-only, so an idle desk costs ~0 ES bytes
   * after the first deepen. Params: state (desk), b/q asset rows. Returns
   * nothing. Never throws outward. */
  function deepenOnce(state, b, q) {
    try {
      /* Count-aware key: changing the candle window must re-deepen (the old
       * pair+bucket key reused a stale-window ES merge after count edits). */
      var deepCount = 2000;
      try { if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) deepCount = MarketInd.CANDLE_COUNT; } catch (e) { /* default stands */ }
      var key = b.id + "|" + q.id + "|" + state.bucket + "|" + deepCount;
      if (state.deepKey === key || state._deepFlight === key) return;
      if (typeof Market === "undefined" || !Market || typeof Market.deepen !== "function") return;
      state._deepFlight = key;
      Market.deepen(b.id, q.id, state.bucket).then(function (d) {
        if (state._deepFlight === key) state._deepFlight = null;
        if (!d) return;
        var nowKey = b.id + "|" + q.id + "|" + state.bucket + "|" + deepCount;
        if (nowKey !== key) return; // bucket/pair/count moved on mid-flight
        try {
          if (String((typeof location !== "undefined" && location.hash) || "").toUpperCase().indexOf(state.id) === -1) return;
        } catch (e) { /* headless: keep going */ }
        state.deepKey = key;
        var count = 2000;
        try { if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) count = MarketInd.CANDLE_COUNT; } catch (e) { /* default stands */ }
        Market.candles(b.id, q.id, state.bucket, count).then(function (c2) {
          var k2 = b.id + "|" + q.id + "|" + state.bucket + "|" + count;
          if (k2 !== key) return;
          try {
            if (String((typeof location !== "undefined" && location.hash) || "").toUpperCase().indexOf(state.id) === -1) return;
          } catch (e) { /* headless: keep going */ }
          /* Newest paint wins (see refreshTip): deepen completion invalidates
           * older in-flight tips before its own synchronous paint. */
          try { state.tipSeq = (state.tipSeq || 0) + 1; } catch (e) { /* seq best-effort */ }
          state.candles = c2;
          try { state.deep = !!(c2 && c2.deep); } catch (err) { state.deep = false; }
          try { MarketInd.maybeDraw(state); } catch (err) { /* chart best-effort */ }
          /* paintNote rides state (module scope cannot see the nested
           * closure); missing means a torn-down desk — never throws. */
          try { if (typeof state.paintNote === "function") state.paintNote(); } catch (err) { /* note best-effort */ }
        }).catch(function () { /* chain paint stands */ });
      }).catch(function () {
        if (state._deepFlight === key) state._deepFlight = null;
      });
    } catch (e) { /* deep is best-effort */ }
  }

  /* paintBook: render bids/asks from the cached get_order_book pair.
   * Applies state.groupDec (null = exact) via MarketBook.groupBook
   * (client-side floor bucketing — no refetch, no new WS method, no ES) and
   * paints through MarketBook.renderSplit (depth bars follow the grouped
   * rows; the returned depth is cached for charts). Grouping faults fall
   * back to the exact book — the lists never blank. No-op without a cached
   * pair or assets. Params: (doc, state). Never throws outward. */
  function paintBook(doc, state) {
    try {
      if (!state || !state.bookRaw || !state.assets) return;
      if (!state.bidsBody || !state.asksBody || !state.spreadLine) return;
      if (typeof MarketBook === "undefined" || !MarketBook ||
          typeof MarketBook.renderSplit !== "function") return;
      var grouped = state.bookRaw;
      try {
        if (state.groupDec !== null && state.groupDec !== undefined &&
            typeof MarketBook.groupBook === "function") {
          grouped = MarketBook.groupBook(state.bookRaw, state.groupDec);
        }
      } catch (e) { grouped = state.bookRaw; /* exact book stands */ }
      state.bookDepth = MarketBook.renderSplit(doc, state.bidsBody, state.asksBody, {
        book: grouped, basePrec: state.assets.base.precision, quotePrec: state.assets.quote.precision,
        baseSymbol: state.assets.base.symbol, quoteSymbol: state.assets.quote.symbol,
        spreadLine: state.spreadLine, logVol: !!state.depthLogY
      });
    } catch (e) { /* book cells keep their previous paint */ }
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
        state.updated.textContent = t("market.updated_prefix", "Updated ") + new Date().toLocaleTimeString();
      } catch (e) { state.updated.textContent = ""; }
    };

    /* Click-to-fill lives in the book rows (market-book.js fillTradePrice):
     * a row sets BOTH panels' price inputs and focuses the taking side's
     * amount. The book cells stay display-only otherwise. */
    Market.book(b.id, q.id, 50).then(function (book) {
      state.bookRaw = book;
      paintBook(doc, state);
      MarketInd.maybeDraw(state);
    }).catch(function (e) {
      DOM.clear(state.bidsBody);
      DOM.clear(state.asksBody);
      showError(doc, state.bidsBody, e, t("market.fail_book", "Could not load the order book."));
      var retry = touchable(DOM.el(doc, "button", t("market.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () { fill(state); });
      state.bidsBody.appendChild(retry);
      state.asksBody.appendChild(DOM.el(doc, "p", t("market.fail_book", "Could not load the order book."), "muted"));
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
      DOM.clear(state.tickerRaw);
      rawDetails(doc, state.tickerRaw, "Raw ticker", st.raw);
    }).catch(function (e) {
      DOM.clear(state.tickerRaw);
      showError(doc, state.tickerRaw, e, t("market.fail_stats", "Could not load market stats."));
    });

    /* Deep view wins refills: while state.deepRows stands, the loop
     * re-renders it (no refetch, no wipe) — the Back button is the exit. */
    if (state.deepRows) {
      MarketBook.renderTrades(doc, state.recentBody || state.tradesBody, { rows: state.deepRows, quoteSymbol: q.symbol });
      paintDeepButton(doc, state, b, q);
      renderMyTrades(doc, state);
      MarketInd.maybeDraw(state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    } else {
    Market.trades(b.id, q.id, 30).then(function (rows) {
      MarketBook.renderTrades(doc, state.recentBody || state.tradesBody, { rows: rows, quoteSymbol: q.symbol });
      paintDeepButton(doc, state, b, q);
      renderMyTrades(doc, state);
      MarketInd.maybeDraw(state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    }).catch(function (e) {
      var rb = state.recentBody || state.tradesBody;
      DOM.clear(rb);
      showError(doc, rb, e, t("market.fail_trades", "Could not load recent trades."));
      /* Deep path stays offered: it reads the database api (time-windowed),
       * independent of the history plugin the fills above needed. */
      paintDeepButton(doc, state, b, q);
      renderMyTrades(doc, state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    });
    }

    /* Timeframe radios (once per desk): preferred shortlist first, then any
     * live extras the node offers (60s, weekly — reconcileBuckets, never a
     * silent drop); reconcile the default 3600 when the node lacks it. */
    if (!state.tfInit) {
      state.tfInit = true;
      Market.timeframes().then(function (live) {
        var avail = (typeof MarketInd.reconcileBuckets === "function")
          ? MarketInd.reconcileBuckets(live)
          : MarketInd.PREF_BUCKETS.filter(function (x) { return live.indexOf(x) !== -1; });
        if (avail.length === 0) avail = (live || []).slice();
        if (avail.indexOf(state.bucket) === -1 && avail.length > 0) {
          state.bucket = avail[0];
        }
        state.liveBuckets = avail;
        MarketInd.paintTimeframes(doc, state, function () { fill(state); });
        try {
          if (typeof MarketInd.paintCountInput === "function") {
            MarketInd.paintCountInput(doc, state, function () { fill(state); });
          }
        } catch (e) { /* radios + note stand without the input */ }
      }).catch(function () {
        DOM.clear(state.tfBox);
        state.tfBox.appendChild(DOM.el(doc, "span", t("market.fail_timeframes", "Timeframes unavailable on this node."), "muted"));
        MarketInd.paintCountNote(state);
      });
    }

    MarketInd.paintCountNote(state);

    Market.candles(b.id, q.id, state.bucket, MarketInd.CANDLE_COUNT).then(function (c) {
      /* Newest paint wins: invalidate older in-flight tips before painting. */
      try { state.tipSeq = (state.tipSeq || 0) + 1; } catch (e) { /* seq best-effort */ }
      state.candles = c;
      try { state.deep = !!(c && c.deep); } catch (e) { state.deep = false; }
      MarketInd.maybeDraw(state);
      /* Re-paint the deep/live suffix fill() itself reset above: the note
       * stays honest across 15s refreshes even with no live-push traffic. */
      try { if (typeof state.paintNote === "function") state.paintNote(); } catch (e) { /* note best-effort */ }
      deepenOnce(state, b, q);
    }).catch(function () {
      state.candles = { buckets: [], closes: [] };
      try { state.deep = false; } catch (e) { /* flag best-effort */ }
      MarketInd.maybeDraw(state);
      try { if (typeof state.paintNote === "function") state.paintNote(); } catch (e) { /* note best-effort */ }
    });
  }

  /* Pool-map lazy loader (index.html frozen — dynamic script like router.js
   * dashboard precedent; relative URL only, never CDN). Params: cb(bool).
   * Returns nothing. Never throws. */
  var _graphLoading = false, _graphWaiters = [];
  function graphSrc() {
    try {
      if (typeof document !== "undefined" && document.baseURI) {
        return new URL("js/api/pool-graph.js", document.baseURI).toString();
      }
    } catch (e) { /* relative fallback below */ }
    return "js/api/pool-graph.js";
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
    try { state.graphNote.textContent = t("market.loading_pool_map", "Loading pool map…"); } catch (e) {}
    ensurePoolGraph(function (ok) {
      if (!deskAlive(state) || state.id !== myId) return;
      if (!ok) {
        try { state.graphNote.textContent = t("market.pool_map_unavailable_script", "Pool map unavailable (script load failed)."); } catch (e) {}
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
            if (m.indexOf("not-connected") !== -1) state.graphNote.textContent = t("market.pool_map_unavailable_offline", "Pool map unavailable (offline).");
            else state.graphNote.textContent = t("pool.touch_hint", "No pools touch these assets — pick a pair with a pool, or create one at #/pools.");
          } catch (x) {}
        });
      } catch (e) { /* graph best-effort */ }
    });
  }

  /* Repaint the pool-map canvas from cached graphData (theme/resize path).
   * Skips when toggled off or stale. Never throws outward. */
  /* Feed + settlement estimate for the strip (R1d — read path mirrors
   * asset-feed-ui.js loadFeed: lookup_asset_symbols -> bitasset_data_id ->
   * get_objects -> current_feed.settlement_price, formatted with BOTH
   * precisions via Format.formatPrice). Runs ONCE per desk (not per stats
   * refresh): exactly 2 RPCs, stale-route guarded. Orientation is market
   * base-per-quote: the settlement amounts map by asset_id onto the market
   * legs (precisions already known from state.assets); legs that don't match
   * the pair skip the feed (backing differs from the market quote) instead
   * of guessing. Settlement ports #1 ExchangeHeader.jsx:190-198 (wins over
   * astro's offset-less dialog per #4 asset_ops force-settlement comment):
   * offset=bit.options.force_settlement_offset_percent; base CORE(1.3.0) ?
   * feed/(1+off/10000) : feed*(1+off/10000) via Format.settleEstimate (exact
   * BigInt, never float); globally-settled (settlement_fund>0) uses
   * bitasset.settlement_price directly, same object, zero extra calls.
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
      /* Perf: Market.assets already resolved this pair (its rows carry
       * bitasset_data_id) — reuse the feed leg instead of re-looking-up the
       * same symbols. Falls back to the lookup when the legs lack it. */
      var directBid = (q && q.bitasset_data_id) || (b && b.bitasset_data_id) || null;
      Chain.db().then(function (id) {
        dbId = id;
        if (directBid) return Chain.call(dbId, "get_objects", [[directBid]]);
        return Chain.call(dbId, "lookup_asset_symbols", [[q.symbol, b.symbol]]);
      }).then(function (rows) {
        if (!alive()) return null;
        if (directBid) return rows;
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
          } else {
            /* Live asset: offset-adjusted estimate (R1d). Offset lives on the
             * bitasset_data options; missing/invalid fails OPEN (feed stands,
             * no settle cell) instead of guessing. baseIsCore follows #1
             * baseId=="1.3.0" branch. */
            var offRaw = bit && bit.options && bit.options.force_settlement_offset_percent;
            var off = (Number.isInteger(offRaw) && offRaw >= 0 && offRaw <= 0xFFFF) ? offRaw : null;
            if (off === null && offRaw !== undefined && offRaw !== null) {
              var parsed = Number(offRaw);
              off = (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFF) ? parsed : null;
            }
            if (off === null && (offRaw === undefined || offRaw === null)) off = 0;
            if (off !== null && typeof Format.settleEstimate === "function") {
              var baseIsCore = String(b.id) === "1.3.0";
              out.settle = {
                global: false,
                offset: off,
                value: Format.settleEstimate(rawB, b.precision, rawQ, q.precision, off, baseIsCore, 8)
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
      if (!n) state.graphNote.textContent = t("pool.touch_hint", "No pools touch these assets — pick a pair with a pool, or create one at #/pools.");
      else if (!gd.pathA && !gd.pathB) state.graphNote.textContent = t("market.no_bts_path", "No BTS path — treat pair as unverified.");
      else {
        var bits = [];
        if (gd.pathA) bits.push("pool→BTS " + gd.pathA.hops.length + " hops");
        if (gd.pathB) bits.push("pool→BTS " + gd.pathB.hops.length + " hops");
        state.graphNote.textContent = t("market.bts_provenance_prefix", "BTS provenance: ") + bits.join(" · ") + ".";
      }
    } catch (e) { /* canvas best-effort */ }
  }

  return {
    renderMarket: renderMarket,
    syncUrl: syncUrl,
    _test: { readDeskQuery: readDeskQuery, buildDeskQuery: buildDeskQuery }
  };
})();

if (typeof module !== "undefined") { module.exports = MarketDesk; }
