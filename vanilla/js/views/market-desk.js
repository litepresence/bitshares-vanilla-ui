/* market-desk.js — /market/:marketID THIN FACADE (identical public surface).
 *
 * What it owns: route entry renderMarket (+ connect wait), the showDesk
 *   skeleton (header, chart hosts, book/trades/orders/trade/depth/stats
 *   cells, picker rail, control wiring, refresh + 15s timer with cleanup),
 *   timer/listener cleanup. Data-fill + panel + deep-link bodies live in
 *   market-desk-query.js (MarketDesk._query: persistence + URL state),
 *   market-desk-panels.js (MarketDesk._panels: book + trades panes),
 *   market-desk-fill.js (MarketDesk._fill: chain fill + pool-map/feed) and
 *   are called via the registry at call time. _test + syncUrl re-export
 *   the query module (market-deeplink-test.js pins the facade path).
 * Consumes: MarketDesk._query/_fill/_panels (late-bound), Market/
 *   MarketPicker/MarketInd/Chain/Store/Offline/DOM/Forms + touchable.
 * Globals/side effects: publishes globalThis.MarketDesk; module.exports
 *   for node suites. Load order in index.html: market-desk-query.js,
 *   market-desk-panels.js, market-desk-fill.js, market-desk.js (facade LAST).
 * Created by: split_responsibility.py account/market frontier (facade
 *   assembly — skeleton + entries kept, bodies moved verbatim).
 */
var MarketDesk = (typeof globalThis !== "undefined" && globalThis.MarketDesk) ? globalThis.MarketDesk : ((typeof MarketDesk !== "undefined") ? MarketDesk : {});
/* Node suites require() the facade directly while the browser loads
 * the parts via <script> order. Pull the parts through the module loader
 * WITHOUT naming `require` (checkJs runs browser libs — a bare require()
 * call is TS2591 there; tx.js precedent). module.require resolves relative
 * to THIS file, like require(). */
var __partRequire = null;
try {
  if (typeof module !== "undefined" && module && /** @type {any} */ (module).require && /** @type {any} */ (module).require.bind) __partRequire = /** @type {any} */ (module).require.bind(module);
} catch (e) { __partRequire = null; }
if (__partRequire && (!MarketDesk._query || !MarketDesk._panels || !MarketDesk._fill)) {
  try { __partRequire("./market-desk-query.js"); } catch (e) {}
  try { __partRequire("./market-desk-panels.js"); } catch (e) {}
  try { __partRequire("./market-desk-fill.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.MarketDesk) MarketDesk = globalThis.MarketDesk;
}
(function () {
  "use strict";

  /* Verbatim copy of market-desk.js network (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
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

  /* Verbatim copy of market-desk.js defaultMarket (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Canonical default market per bitshares-ui/app/branding.js:98-108. */
  function defaultMarket() {
    return network() === "testnet" ? "USD_TEST" : "BTS_CNY";
  }

  var REFRESH_MS = 15000;

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
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("bad-market") !== -1) {
      msg = "Unknown market. Check the QUOTE_BASE pair (e.g. " + defaultMarket() + ").";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("market.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("market.err_history", "History unavailable on this node (fills and charts need the history plugin).");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
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
    MarketDesk._query.saveLast(id);

    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(DOM.el(doc, "p", t("common.status_connecting", "Connecting to network…"), "muted"));
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
        showError(doc, failed, new Error("not connected"), t("common.network_unavailable_short", "Network unavailable."));
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
          return MarketDesk._query.readDeskQuery(Router.query());
        }
      } catch (e) { /* defaults below */ }
      return MarketDesk._query.readDeskQuery(null);
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
        MarketDesk._panels.paintBook(doc, state);
        try {
          if (typeof MarketInd !== "undefined" && MarketInd &&
              typeof MarketInd.maybeDraw === "function") MarketInd.maybeDraw(state);
        } catch (e) { /* book stands without the chart */ }
        try { MarketDesk._query.syncUrl(state); } catch (e) { /* URL stays */ }
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
      try { MarketDesk._query.syncUrl(state); } catch (e) { /* URL stays */ }
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
      try { MarketDesk._query.syncUrl(state); } catch (e) { /* URL stays */ }
    });
    tabMy.addEventListener("click", function () {
      state.tradesTab = "my";
      paintTradesTab();
      MarketDesk._panels.renderMyTrades(doc, state);
      try { MarketDesk._query.syncUrl(state); } catch (e) { /* URL stays */ }
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
        if (redrawBars) MarketDesk._fill.fill(state);
        else MarketInd.drawCharts(state);
        try { MarketDesk._query.syncUrl(state); } catch (e) { /* URL stays */ }
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
    refreshBtn.addEventListener("click", function () { MarketDesk._fill.fill(state); });

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
      try { MarketDesk._fill.redrawPoolMap(doc, state); } catch (e) { /* graph best-effort */ }
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
      MarketDesk._fill.fill(state);
    }, REFRESH_MS);

    Market.assets(pair.quote, pair.base).then(function (assets) {
      state.assets = assets;
      sub.textContent = assets.quote.symbol + " (" + assets.quote.id + ") / " +
        assets.base.symbol + " (" + assets.base.id + ")";
      MarketDesk._fill.fill(state);
      /* Pool-map provenance (lazy, never blocks desk; stale-route guarded). */
      try { MarketDesk._fill.fetchPoolMap(doc, state); } catch (e) { /* graph best-effort */ }
      /* Strip feed + settlement (retro round 2 D1: one lookup + one object
       * fetch per desk; fail-open, never blocks desk). */
      try { MarketDesk._fill.fetchFeed(doc, state); } catch (e) { /* feed best-effort */ }
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
            refresh: function () { MarketDesk._fill.fill(state); }
          });
        }
      } catch (e) { /* TradeUI paints its own errors inline */ }
    }).catch(function (e) {
      sub.textContent = pair.quote + " / " + pair.base;
      showError(doc, head, e, "Unknown market.");
    });
  }
  MarketDesk.renderMarket = renderMarket;
  MarketDesk.syncUrl = MarketDesk._query.syncUrl;
  MarketDesk._test = { readDeskQuery: MarketDesk._query.readDeskQuery, buildDeskQuery: MarketDesk._query.buildDeskQuery };
  if (typeof globalThis !== "undefined") { globalThis.MarketDesk = MarketDesk; }
})();

if (typeof globalThis !== "undefined" && typeof globalThis.MarketDesk === "undefined") { globalThis.MarketDesk = MarketDesk; }
if (typeof module !== "undefined") { module.exports = MarketDesk; }
