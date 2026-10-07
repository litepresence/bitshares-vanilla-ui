/* market-ind-panes.js — DEX chart PANES + controls (DOM rendering).
 *
 * What it owns: timeframe bucket constants + bucketLabel + reconcileBuckets,
 * candle-count state (COUNT_* + loadCount/validCount/CANDLE_COUNT — the
 * single source all three fetch sites read), pane order (OSC_ORDER) and
 * overlay defs/labels (OVERLAY_DEFS + overlayLabel), theme chart colors
 * (readVar/themeChartColors), canvas fit (fitCanvas), the session-VWAP strip
 * (drawVwap), the header stats strip (renderStrip + trim6), the timeframe
 * radios + count input/note (paintTimeframes/paintCountInput/paintCountNote),
 * the draw orchestrators (maybeDraw with the _seriesCache fast path +
 * drawCharts for price + stacked sub-panes) and the indicator menu
 * (overlaysGroup + renderIndMenu). No fetching, no timers, no signing.
 * Consumes: MarketInd._series (ind/priceOverlays/oscOne/readSlot/specs —
 *   late-bound at draw time), MarketCharts.drawPricePane/drawOscPane/
 *   drawDepth/removePane, MarketCandles.vwap, MarketDesk.syncUrl (guarded),
 *   DOM, Store, Indicators only via _series. CANDLE_COUNT snapshot on
 *   MarketInd._panes is refreshed next to the public MarketInd.CANDLE_COUNT
 *   sync (same guarded shape — the facade assembles from the snapshot).
 * Globals/side effects: DOM under caller-provided hosts only (plus the lazy
 *   #mkt-vwap-wrap sibling tracked on state.vwapWrap); attaches
 *   MarketInd._panes and republishes globalThis.MarketInd.
 * Created by: task-res-split2 (market-ind.js responsibility split — overlays
 *   half; bodies moved verbatim, only MarketInd._series call sites
 *   rewritten). Facade: market-ind.js.
 * Pre-split market-ind.js header: preserved verbatim in git history.
 */
var MarketInd = (typeof globalThis !== "undefined" && globalThis.MarketInd) ? globalThis.MarketInd : ((typeof MarketInd !== "undefined") ? MarketInd : {});
MarketInd._panes = MarketInd._panes || {};
(function () {
  "use strict";

  /* Timeframe choices intersect the live bucket list (slice-07 Task 4).
   * Labels mirror the common trading shorthand. */
  var PREF_BUCKETS = [300, 900, 1800, 3600, 14400, 86400];

  /* Candle window (shared by exchange + pools — one input, one source).
   * Persisted per profile; validated 1..5000; default 2000. All three
   * fetch sites (initial fill, live tip, deepen re-query) read this var —
   * never a literal — so the input moves every path at once. */
  var COUNT_KEY = "bts-vanilla-candle-count-v1";

  var COUNT_MIN = 1, COUNT_MAX = 5000, COUNT_DEFAULT = 2000;

  function loadCount() {
    try {
      if (typeof localStorage === "undefined") return COUNT_DEFAULT;
      var v = parseInt(localStorage.getItem(COUNT_KEY), 10);
      if (v >= COUNT_MIN && v <= COUNT_MAX) return v;
    } catch (e) { /* default stands */ }
    return COUNT_DEFAULT;
  }

  var CANDLE_COUNT = loadCount();

  /* Validated candle count (pure, unit-tested): integer 1..5000 or null.
   * Params: v (anything). The change handler and the tests share this. */
  function validCount(v) {
    var n = parseInt(v, 10);
    if (n >= COUNT_MIN && n <= COUNT_MAX) return n;
    return null;
  }

  /* Stacked sub-pane order (Task 4b + parity round): checkbox order IS pane
   * order. Base six first (legacy default checks preserved), then Tulip
   * momentum, Tulip volume/volatility, QX add-ons, all default-off. Single
   * source for the picker menu, the pane reconciliation in drawCharts, and
   * teardown. Labels are indicator SYMBOLS (identifiers, never localized —
   * same class as theme ids; avoids ~40 dict entries per locale). */
  var OSC_ORDER = [
    ["volume", "Volume"],
    ["rsi", "RSI"], ["macd", "MACD"], ["stoch", "Stoch"],
    ["atr", "ATR"], ["fisher", "Fisher"],
    ["stochrsi", "StochRSI"], ["adxr", "ADXR"], ["cci", "CCI"],
    ["cmo", "CMO"], ["dx", "DX"], ["mom", "MOM"], ["roc", "ROC"],
    ["trix", "TRIX"], ["ultosc", "UltOsc"], ["willr", "WillR"],
    ["apo", "APO"], ["ppo", "PPO"], ["bop", "BOP"], ["qstick", "QStick"],
    ["obv", "OBV"], ["emv", "EMV"], ["vosc", "VOSC"], ["nvi", "NVI"],
    ["pvi", "PVI"], ["wad", "WAD"], ["ad", "AD"], ["cvi", "CVI"],
    ["natr", "NATR"], ["mass", "Mass"], ["kvo", "KVO"], ["adosc", "ADOSC"],
    ["dpo", "DPO"], ["vhf", "VHF"], ["volatility", "Volatility"],
    ["aroon", "Aroon"], ["di", "DMI+/-"], ["vortex", "Vortex"],
    ["kst", "KST"], ["ravi", "RAVI"], ["tsi", "TSI"], ["smi", "SMI"],
    ["eri", "ElderRay"], ["awesome", "Awesome"], ["arsi", "ARSI"],
    ["ulcer", "Ulcer"], ["earsi", "EARSI"]
  ];

  /* Price-pane overlay defs (key, label). First four keep their localized
   * labels (slice-17 keys); the rest are symbols (see OSC_ORDER note). */
  var OVERLAY_DEFS = [
    ["sma", null], ["ema", null], ["bb", null], ["psar", null],
    ["dema", "DEMA"], ["tema", "TEMA"], ["wma", "WMA"], ["kama", "KAMA"],
    ["vidya", "VIDYA"], ["vwma", "VWMA"], ["linreg", "LINREG"],
    ["tsf", "TSF"], ["aema", "AEMA"], ["holtwinters", "HOLT"],
    ["supertrend", "SUPERTREND"], ["keltner", "KELTNER"],
    ["donchian", "DONCHIAN"], ["zigzag", "ZIGZAG"], ["kagi", "KAGI"]
  ];

  /* overlayLabel: i18n display label for a price-overlay key (SMA/EMA/BB/
   * PSAR have dict entries; anything else keeps its table fallback). */
  function overlayLabel(key, fallback) {
    if (key === "sma") return t("market.ov_sma", "SMA");
    if (key === "ema") return t("market.ov_ema", "EMA");
    if (key === "bb") return t("market.ov_bb", "BB");
    if (key === "psar") return t("market.ov_psar", "PSAR");
    return fallback;
  }

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

  /* No local el — use DOM.el */

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
/* Short label for a bucket size in seconds (label text only, not money). */

  function bucketLabel(b) {
    /* Discrete mode is a raw-fill view, not a bucket size (dex-ux
     * order_book.html Discrete radio parity) — label text only, not money. */
    if (b === "discrete") return "Discrete";
    var known = { 60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h", 86400: "1D", 604800: "1W" };
    if (known[b]) return known[b];
    if (b >= 3600 && b % 3600 === 0) return (b / 3600) + "h";
    if (b >= 60 && b % 60 === 0) return (b / 60) + "m";
    return b + "s";
  }

  /* reconcileBuckets: live bucket list -> picker order (pure, unit-tested).
   * Preferred shortlist first (trader-familiar order), then any live extras
   * the node offers beyond PREF (60s, weekly 604800 — dropped before, never
   * again) appended ascending. Params: live (array-ish of seconds).
   * Returns a fresh array (possibly empty — caller falls back to raw live).
   * Never throws; non-numeric entries ignored. */
  function reconcileBuckets(live) {
    try {
      var nums = (Array.isArray(live) ? live : []).filter(function (b) {
        return typeof b === "number" && isFinite(b) && b > 0;
      });
      var out = PREF_BUCKETS.filter(function (x) { return nums.indexOf(x) !== -1; });
      nums.sort(function (a, b) { return a - b; }).forEach(function (x) {
        if (out.indexOf(x) === -1) out.push(x);
      });
      return out;
    } catch (e) { return []; }
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
      paneBg: readVar("--plot-bg", readVar("--panel", "#131722")),
      grid: readVar("--border", "#2a2e39"),
      text: readVar("--text", "#c5cbce"),
      accent: readVar("--accent", "#007bff"),
      buy: readVar("--buy", "#26de81"),
      sell: readVar("--sell", "#ff231f"),
      warn: readVar("--warn", "#fcab53"),
      muted: readVar("--muted", "#758696")
    };
  }

  /* DPR-aware canvas fit (plain duplicate of the market-book.js helper —
   * doctrine prefers duplication over a shared chart abstraction). Returns
   * {ctx, w, h} CSS pixels, or null when unusable. */
  function fitCanvas(canvas, cssH) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    var w = canvas.clientWidth;
    if (!w && canvas.parentNode && canvas.parentNode.clientWidth) {
      w = canvas.parentNode.clientWidth;
    }
    if (!w || w <= 0) w = 300;
    var dpr = 1;
    try {
      if (typeof window !== "undefined" && window.devicePixelRatio) {
        dpr = window.devicePixelRatio;
      }
    } catch (e) { dpr = 1; }
    canvas.style.width = "100%";
    canvas.style.height = cssH + "px";
    /* Pixel sizing below is Number() on layout pixels only — never money. */
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, cssH);
    return { ctx: ctx, w: w, h: cssH };
  }

  /* Session VWAP + spread band strip (dex-ux proposal 3). Data: the cached
   * candle buckets (history get_market_history via MarketCandles.candles —
   * chain-history ONLY, ES refused) plus the desk's asset precisions; math
   * lives in MarketCandles.vwap (BigInt accumulation, humans via Format).
   * Renders a collapsible <details open> canvas 2D strip as a SIBLING after
   * the price host — still INSIDE the mkt-charts grid area (no grid
   * restructure, LWC price pane untouched): per-bucket VWAP line (accent),
   * high/low spread band (accent fill, alpha 0.15), session VWAP dashed
   * line with the exact human string as label. Honest empties: no buckets
   * -> "No bucket history"; missing math/precisions -> "unavailable".
   * Rebuilt on every drawCharts call (same redraw path as theme/resize). */
  function drawVwap(state, C) {
    var doc = state.doc;
    var host = state.priceHost;
    if (!doc || !host || !host.parentNode) return;
    var parent = host.parentNode;
    var wrap = state.vwapWrap || null;
    /* Toggleable like every non-price plot: off removes the strip. */
    if (state.showVwap === false) {
      try {
        if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      } catch (e) { /* gone */ }
      state.vwapWrap = null;
      return;
    }
    if (!wrap || wrap.parentNode !== parent ||
        (typeof wrap.isConnected === "boolean" && !wrap.isConnected)) {
      wrap = doc.createElement("div");
      wrap.id = "mkt-vwap-wrap";
      try {
        if (host.nextSibling) parent.insertBefore(wrap, host.nextSibling);
        else parent.appendChild(wrap);
      } catch (e) { return; }
      state.vwapWrap = wrap;
    }
    DOM.clear(wrap);
    var det = doc.createElement("details");
    det.className = "plot mkt-vwap";
    det.setAttribute("open", "");
    var sum = doc.createElement("summary");
    sum.setAttribute("aria-label", t("market_ind.vwap_label", "Session VWAP and spread band plot"));
    touchable(sum);
    sum.textContent = t("market_ind.vwap", "Session VWAP + spread");
    det.appendChild(sum);
    wrap.appendChild(det);
    var buckets = (state.chartData && Array.isArray(state.chartData.buckets))
      ? state.chartData.buckets : [];
    var assets = state.assets || null;
    if (buckets.length === 0) {
      det.appendChild(DOM.el(doc, "p",
        t("market_ind.vwap_no_history", "No bucket history — VWAP unavailable on this market."), "muted"));
      return;
    }
    if (typeof MarketCandles === "undefined" || !MarketCandles ||
        typeof MarketCandles.vwap !== "function" ||
        !assets || !assets.base || !assets.quote ||
        typeof assets.base.precision !== "number" ||
        typeof assets.quote.precision !== "number") {
      det.appendChild(DOM.el(doc, "p",
        t("market_ind.vwap_unavailable", "VWAP unavailable (bucket math or asset precisions missing)."), "muted"));
      return;
    }
    var v;
    try {
      v = MarketCandles.vwap(buckets, assets.base.precision, assets.quote.precision);
    } catch (e) {
      det.appendChild(DOM.el(doc, "p",
        t("market_ind.vwap_unavailable", "VWAP unavailable (bucket math or asset precisions missing)."), "muted"));
      return;
    }
    if (!v || !Array.isArray(v.per) || v.per.length === 0 || v.human === null) {
      det.appendChild(DOM.el(doc, "p",
        t("market_ind.vwap_no_volume", "No bucket volume — VWAP needs fills in this session."), "muted"));
      return;
    }
    var note = DOM.el(doc, "p",
      t("market_ind.vwap_session", "Session VWAP") + ": " + String(v.human) +
      " " + assets.base.symbol + "/" + assets.quote.symbol +
      (v.skipped > 0 ? " · " + String(v.skipped) + " " +
        t("market_ind.vwap_skipped", "empty slots skipped") : ""),
      "muted");
    det.appendChild(note);
    var canvas = doc.createElement("canvas");
    canvas.className = "mkt-canvas";
    det.appendChild(canvas);
    var g = fitCanvas(canvas, 140);
    if (!g) return;
    var n = v.per.length;
    /* Pixel series below are Number() on human-string coordinates only
     * (chart positions, never money — integer math already settled in
     * MarketCandles.vwap). */
    var vs = [], hs = [], ls = [], i;
    for (i = 0; i < n; i++) {
      vs.push(Number(v.per[i].vwap));
      hs.push(Number(v.per[i].high));
      ls.push(Number(v.per[i].low));
    }
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < n; i++) {
      if (isFinite(ls[i]) && ls[i] < lo) lo = ls[i];
      if (isFinite(hs[i]) && hs[i] > hi) hi = hs[i];
    }
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    var sess = Number(v.human);
    if (isFinite(sess)) {
      if (sess < lo) lo = sess;
      if (sess > hi) hi = sess;
    }
    var padL = 8, padR = 8, padT = 24, padB = 18;
    var plotW = g.w - padL - padR;
    var plotH = g.h - padT - padB;
    function x(i) { return padL + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1)); }
    function y(val) { return padT + (1 - (val - lo) / (hi - lo)) * plotH; }
    var ctx = g.ctx;
    /* Spread band: high edge forward, low edge back, accent at 0.15. */
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      if (!isFinite(hs[i])) continue;
      if (i === 0) ctx.moveTo(x(i), y(hs[i]));
      else ctx.lineTo(x(i), y(hs[i]));
    }
    for (i = n - 1; i >= 0; i--) {
      if (isFinite(ls[i])) ctx.lineTo(x(i), y(ls[i]));
    }
    ctx.closePath();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = C.accent;
    ctx.fill();
    ctx.globalAlpha = 1;
    /* VWAP line, breaking across non-finite slots (never dives to zero). */
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    var started = false, drew = false;
    for (i = 0; i < n; i++) {
      if (!isFinite(vs[i])) { started = false; continue; }
      if (!started) { ctx.moveTo(x(i), y(vs[i])); started = true; }
      else ctx.lineTo(x(i), y(vs[i]));
      drew = true;
    }
    if (drew) ctx.stroke();
    /* Session line (dashed muted) + verbatim human label. */
    if (isFinite(sess)) {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1;
      try { ctx.setLineDash([5, 4]); } catch (e) { /* solid stands */ }
      ctx.beginPath();
      ctx.moveTo(padL, y(sess));
      ctx.lineTo(padL + plotW, y(sess));
      ctx.stroke();
      try { ctx.setLineDash([]); } catch (e) { /* no-op */ }
      ctx.fillStyle = C.muted;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("VWAP " + String(v.human), g.w - 6, y(sess) - 4);
      ctx.textAlign = "left";
    }
  }

  /* Display-only 6-decimal trim (retro round 2 D1): the chain's human price
   * strings can carry 16 decimals (get_ticker latest/bid/ask); the original
   * shows 6. Pure string truncation at RENDER — Format math untouched, and
   * the full-precision string stays on the value's title attr. Non-numeric
   * strings (percents, volumes with symbols, "—") pass through unchanged. */
  function trim6(s) {
    s = String(s);
    var m = /^(-?\d+)\.(\d+)$/.exec(s);
    if (m && m[2].length > 6) return m[1] + "." + m[2].slice(0, 6);
    return s;
  }

  /* 4-sig-fig price display (global price rule, Format.priceSig): PRICE
   * cells (Latest, Bid-Ask, Feed, Settlement) render ps(); change/volume
   * cells are NOT prices (percent_change, base_volume amounts) and stay on
   * the trim6/verbatim path. cell() still applies trim6 after ps — safe:
   * 4-sf outputs carry <= 4 decimals (trim6 no-op) and sci notation has no
   * plain-decimal shape (trim6 pass-through). Falls back to trim6 when
   * format.js is absent. Full chain strings stay on titles (cell() below). */
  function ps(s) {
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.priceSig === "function") return Format.priceSig(s);
    } catch (e) { /* fallback below */ }
    return trim6(s);
  }

  /* stripKey: fingerprint of everything renderStrip paints (pure, never throws).
   * WHY cry-wolf guard: the 15s fill() (market-desk-fill.js:147,151) rebuilt
   *   the strip on every tick, replaying the candy-tick flash on identical
   *   values until the flash meant nothing. Same unchanged-triple guard as the
   *   live-tip ticker-bail (market-desk.js:1000-1008 latest|highestBid|
   *   lowestAsk), extended to the change/volume + feed/settle cells
   *   renderStrip also paints — triple-only would strand the once-per-desk
   *   feed paint (fetchFeed lands after stats under the same triple). Equal
   *   key means identical chips, so renderStrip skips DOM.clear+rebuild: no
   *   churn, no flash; the flash fires only on real moves.
   * @param {any} st - state.ticker (or null while loading).
   * @param {any} assets - state.assets (base symbol suffixes the volume cell).
   * @param {any} feed - state.feed ({feed, settle{value,global,offset}} or null).
   * @returns {string|null} Short comparable key; null on failure (null never
   *   bails — paint when in doubt). */
  function stripKey(st, assets, feed) {
    try {
      if (!st) return "__loading__";
      var raw = (st && st.raw) || {};
      var sym = "";
      try { sym = (assets && assets.base && assets.base.symbol) || ""; } catch (e) { sym = ""; }
      var fFeed = "", sVal = "", sGlob = "", sOff = "";
      try {
        if (feed) {
          if (feed.feed !== null && feed.feed !== undefined) fFeed = String(feed.feed);
          if (feed.settle) {
            if (feed.settle.value !== null && feed.settle.value !== undefined) sVal = String(feed.settle.value);
            sGlob = feed.settle.global ? "1" : "0";
            if (feed.settle.offset !== undefined && feed.settle.offset !== null) sOff = String(feed.settle.offset);
          }
        }
      } catch (e) { /* feed parts stand empty */ }
      return String(st.latest) + "|" + String(st.highestBid) + "|" + String(st.lowestAsk) + "|" +
        String(raw.percent_change) + "|" + String(raw.base_volume) + "|" + sym + "|" +
        fFeed + "|" + sVal + "|" + sGlob + "|" + sOff;
    } catch (e) { return null; }
  }

  /* Compact header stats strip: Latest / 24h change / 24h volume / Best
   * bid-ask, plus Feed Price + Settlement for bitasset markets (state.feed,
   * filled once per desk by market-desk.js fetchFeed — absent on non-MPA
   * pairs, exactly like #1 which hides both columns there). Price-like
   * values render ps (4-sf) with the full chain string on title; ticker/volume
   * fields pass through verbatim (same fields as the side panel, no money
   * math). Moved verbatim out of fill; state carries {ticker, strip, assets,
   * feed} exactly as before.
   * @param {Document} doc - owner document for node creation.
   * @param {object} state - desk state ({ticker, strip, assets, feed, _stripTick}).
   * @returns {void} Renders in place; returns early (no DOM churn) when the
   *   stripKey is unchanged — the candy-tick flash then fires only on real moves. */
  function renderStrip(doc, state) {
    var st = state.ticker;
    /* Cry-wolf bail (stripKey above): unchanged strip paints identical chips,
     * so skip DOM.clear+rebuild. Separate key from the live-tip _tickHash in
     * market-desk.js (which pre-bails before calling here) — sharing one key
     * would let the pre-set mark render done before this path paints. */
    var key = stripKey(st, state.assets, state.feed);
    if (key !== null && state._stripTick === key) return;
    state._stripTick = key;
    DOM.clear(state.strip);
    if (!st) {
      state.strip.appendChild(DOM.el(doc, "span", t("market.loading_stats", "Loading stats…"), "muted"));
      return;
    }
    /* One label/value chip appended to the strip (missing values show —).
     * Display is trim6; the full-precision chain string stays on title. */
    function cell(label, value, full) {
      var s = doc.createElement("span");
      s.className = "mkt-stat";
      s.appendChild(DOM.el(doc, "span", label + " ", "muted"));
      var shown = (value === null || value === undefined)
        ? t("market.stat_empty", "—") : trim6(String(value));
      var v = DOM.el(doc, "strong", shown);
      if (value !== null && value !== undefined) {
        try { v.title = (full !== undefined && full !== null) ? String(full) : String(value); } catch (e) { /* text stands */ }
      }
      s.appendChild(v);
      state.strip.appendChild(s);
    }
    cell(t("market.stat_latest", "Latest"), st.latest !== null && st.latest !== undefined ? ps(String(st.latest)) : null, st.latest);
    var chg = (st.raw && st.raw.percent_change !== undefined && st.raw.percent_change !== null)
      ? String(st.raw.percent_change) : null;
    cell(t("market.stat_chg", "24h Δ"), chg);
    var bv = (st.raw && st.raw.base_volume !== undefined && st.raw.base_volume !== null)
      ? String(st.raw.base_volume) + " " + state.assets.base.symbol : null;
    cell(t("market.stat_vol", "24h Vol"), bv);
    var bidFull = [st.highestBid, st.lowestAsk].filter(function (x) { return x !== null; });
    var bidShown = bidFull.map(function (x) { return ps(String(x)); });
    cell(t("market.stat_bidask", "Bid–Ask"), bidShown.length ? bidShown.join(" / ") : null,
      bidFull.length ? bidFull.join(" / ") : null);
    /* Feed + settlement (D1): state.feed is filled once per desk by
     * market-desk.js fetchFeed ({feed, settle} human base-per-quote strings
     * from the bitasset_data object, or null). No feed state -> no cells
     * (non-MPA pairs, pending/failed fetch) — the strip stands on ticker. */
    var feed = state.feed || null;
    if (feed && feed.feed !== null && feed.feed !== undefined) {
      cell(t("market.stat_feed", "Feed Price"), ps(String(feed.feed)), feed.feed);
    }
    if (feed && feed.settle && feed.settle.value !== null && feed.settle.value !== undefined) {
      var isGlobal = !!feed.settle.global;
      var settleFull = String(feed.settle.value);
      if (!isGlobal && feed.settle.offset !== undefined && feed.settle.offset !== null) {
        settleFull += " (offset " + String(feed.settle.offset) + "/10000)";
      }
      /* WHY: the non-global cell renders the offset-adjusted settleEstimate
       * (Format.settleEstimate), not a chain settlement_price — tag it
       * "(est.)" via plain glue on the existing key (no new locale key) so
       * the strip never passes an estimate off as a settlement. Global stays
       * bare; the offset title above stands untouched. */
      cell(isGlobal
        ? t("market.stat_global_settle", "Global Settlement")
        : t("market.stat_settle", "Settlement Price") + " (est.)", ps(String(feed.settle.value)), settleFull);
    }
  }

  /* Refresh the "N × timeframe candles" note under the timeframe radios.
   * Discrete mode instead names the ACTUAL plotted point count ("N fills" —
   * the tape may hold fewer than the requested count on thin markets). */
  function paintCountNote(state) {
    if (state.countNote) {
      if (state.discrete) {
        var n = 0;
        try {
          if (state.points && Array.isArray(state.points)) n = state.points.length;
          else if (state.chartData && Array.isArray(state.chartData.buckets)) n = state.chartData.buckets.length;
        } catch (e) { n = 0; }
        state.countNote.textContent =
          String(n) + " " + t("market.discrete_fills", "fills");
      } else {
        state.countNote.textContent =
          CANDLE_COUNT + " × " + bucketLabel(state.bucket) + " candles";
      }
    }
  }

  /* Candle-count input beside the timeframe radios (shared by exchange +
   * pools — both desks call this next to paintTimeframes). Number input
   * 1..5000, persisted; a valid change updates CANDLE_COUNT + the note and
   * fires onCount (the desk's refill); an invalid entry reverts with an
   * honest inline note. Params: doc, state, onCount. Never throws. */
  function paintCountInput(doc, state, onCount) {
    try {
      var host = state.countNote && state.countNote.parentNode ? state.countNote.parentNode : null;
      if (!host || !state.countNote) return;
      if (host.querySelector && host.querySelector(".mkt-count-input")) return; // idempotent
      var lab = doc.createElement("label");
      lab.className = "mkt-count-lab";
      lab.textContent = t("market_ind.candle_count", "Candles") + " ";
      var inp = doc.createElement("input");
      inp.type = "number";
      inp.className = "mkt-count-input";
      inp.min = String(COUNT_MIN);
      inp.max = String(COUNT_MAX);
      inp.value = String(CANDLE_COUNT);
      inp.setAttribute("inputmode", "numeric");
      inp.setAttribute("aria-label", t("market_ind.candle_count", "Candles"));
      touchable(inp);
      lab.appendChild(inp);
      try {
        host.insertBefore(lab, state.countNote.nextSibling);
      } catch (e) { host.appendChild(lab); }
      inp.addEventListener("change", function () {
        var v = validCount(inp.value);
        if (v === null) {
          inp.value = String(CANDLE_COUNT);
          try {
            state.countNote.textContent = t("market_ind.count_range", "Enter 1–5000 candles.");
          } catch (e) { /* note stands */ }
          return;
        }
        CANDLE_COUNT = v;
        /* The exported CANDLE_COUNT is a load-time primitive copy (see the
         * return block) — refresh it too, or the three desk readers keep
         * the stale value while this var moves on. Guarded: headless/test
         * globals may lack MarketInd. */
        try { if (typeof MarketInd !== "undefined" && MarketInd) MarketInd.CANDLE_COUNT = v; } catch (e) { /* module var stands */ }
        try { if (typeof MarketInd !== "undefined" && MarketInd && MarketInd._panes) MarketInd._panes.CANDLE_COUNT = v; } catch (e) { /* snapshot stands */ }
        try {
          if (typeof localStorage !== "undefined") localStorage.setItem(COUNT_KEY, String(v));
        } catch (e) { /* session-only count */ }
        paintCountNote(state);
        try { if (typeof onCount === "function") onCount(); } catch (e) { /* refill carries errors */ }
      });
    } catch (e) { /* radios + note stand without the input */ }
  }

  /* Rebuild the timeframe radios from the reconciled live bucket list. */
  function paintTimeframes(doc, state, onBucket) {
    DOM.clear(state.tfBox);
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
        state.discrete = false;
        paintCountNote(state);
        onBucket();
        try {
          if (typeof MarketDesk !== "undefined" && MarketDesk && typeof MarketDesk.syncUrl === "function") MarketDesk.syncUrl(state);
        } catch (e) { /* URL stays */ }
      });
      lab.appendChild(radio);
      lab.appendChild(DOM.el(doc, "span", bucketLabel(b)));
      state.tfBox.appendChild(lab);
    });
    /* Discrete mode (raw fills, no buckets): always offered last (dex-ux
     * order_book.html radio order). Selecting it sets state.discrete and
     * keeps state.bucket as the return target; numeric radios above clear
     * the flag. The count input beside the radios caps the points. */
    (function () {
      var dlab = doc.createElement("label");
      dlab.className = "mkt-tf";
      var dradio = doc.createElement("input");
      dradio.type = "radio";
      dradio.name = "mkt-tf";
      dradio.value = "discrete";
      dradio.checked = !!state.discrete;
      dradio.setAttribute("aria-label", t("market.tf_discrete", "Discrete") + " fills");
      touchable(dradio);
      dradio.addEventListener("change", function () {
        state.discrete = true;
        paintCountNote(state);
        onBucket();
        try {
          if (typeof MarketDesk !== "undefined" && MarketDesk && typeof MarketDesk.syncUrl === "function") MarketDesk.syncUrl(state);
        } catch (e) { /* URL stays */ }
      });
      dlab.appendChild(dradio);
      dlab.appendChild(DOM.el(doc, "span", t("market.tf_discrete", "Discrete")));
      state.tfBox.appendChild(dlab);
    })();
    paintCountNote(state);
  }

  /* Draw all three panes once book/candle data has arrived (either may come
   * first; cached so resize/theme/log redraws never re-hit the chain).
   * PERF (output-identical): the pixel-ready closes/highs/lows/opens/times/
   * vols arrays live on state._seriesCache and are rebuilt ONLY when the
   * candle identity changes. A tip poll that merely extends the live bucket
   * updates the cached arrays in place (rewrite the last slot; push one new
   * slot when the tip rolled a fresh bucket). Full recompute happens ONLY
   * when one of these invalidation conditions holds:
   *   (a) no cache yet (first paint, or a fresh state object),
   *   (b) state.bucket changed (timeframe switch),
   *   (c) CANDLE_COUNT changed (count input),
   *   (d) buckets.length shrank, or grew by more than 1 (a same-window poll
   *       can only touch the live last slot — history slots are immutable
   *       aggregates, so anything else is a deepen re-query/new window),
   *   (e) first-bucket timeMs changed (deepen re-query shifted the window).
   * Overlays and osc panes still recompute every draw from the cached arrays
   * (indicator toggles must reflect instantly); the cache saves only the
   * per-candle Number()/string reads plus array allocs. Rendered charts are
   * identical: same arrays, same order, same values. */
  /* syncIndMenu: reflect state.discrete on the rendered Indicators menu
   * (one .mkt-indmenu-panel per desk — exchange and pool never coexist).
   * Discrete disables every control with the unavailable title + an
   * explanatory note; buckets restore. Construction-time disabled boxes
   * (missing indicator fns) carry no marker and are never touched, so they
   * stay disabled with their own reasons. Marker-guarded + idempotent:
   * controls this function disabled get data-dd="1" and only those are ever
   * re-enabled. Called from the draw paths so EVERY mode switch lands
   * correctly no matter how it was entered (deep link, radio click).
   * Params: doc, state. Never throws. */
  function syncIndMenu(doc, state) {
    try {
      if (!doc || typeof doc.querySelector !== "function") return;
      var panel = doc.querySelector(".mkt-indmenu-panel");
      if (!panel) return;
      var msg = t("market.discrete_unavailable", "Indicators unavailable in Discrete.");
      var note = null;
      try { note = panel.querySelector("[data-discrete-note]"); } catch (e) { note = null; }
      var ctrls = [];
      try { ctrls = panel.querySelectorAll ? panel.querySelectorAll("input, button") : []; } catch (e) { ctrls = []; }
      var i;
      if (state.discrete) {
        if (!note) {
          try {
            note = doc.createElement("p");
            note.className = "muted";
            try { note.setAttribute("data-discrete-note", "1"); } catch (e) { /* marker below still stands */ }
            note.textContent = msg;
            if (panel.firstChild) panel.insertBefore(note, panel.firstChild);
            else panel.appendChild(note);
          } catch (e) { /* controls still disable below */ }
        }
        for (i = 0; i < ctrls.length; i++) {
          try {
            ctrls[i].disabled = true;
            ctrls[i].title = msg;
            try { ctrls[i].setAttribute("data-dd", "1"); } catch (e2) { /* disabled stands */ }
          } catch (e2) { /* next control */ }
        }
      } else {
        if (note && note.parentNode) {
          try { note.parentNode.removeChild(note); } catch (e) { /* gone */ }
        }
        for (i = 0; i < ctrls.length; i++) {
          try {
            var marked = false;
            try { marked = ctrls[i].getAttribute && ctrls[i].getAttribute("data-dd") === "1"; } catch (e2) { marked = false; }
            if (!marked) continue;
            ctrls[i].disabled = false;
            ctrls[i].title = "";
            try { ctrls[i].removeAttribute("data-dd"); } catch (e2) { /* enabled stands */ }
          } catch (e2) { /* next control */ }
        }
      }
    } catch (e) { /* menu sync must never break the desk */ }
  }

  /* drawDiscrete: Discrete-mode paint (one caller: maybeDraw's flag branch;
   * drawCharts re-dispatches here via the chartData.discrete marker so
   * resize/theme/invert redraws stay live). Tears down LWC + osc + VWAP +
   * depth + pool-map artefacts, then paints price dots + the auto volume
   * pane on canvas (DiscreteCharts — no LWC in Discrete). Pool desks share
   * this path (P carries priceHost/oscHost/panes like the exchange state).
   * Params: state (needs .doc/.priceHost/.oscHost/.points). Never throws. */
  function drawDiscrete(state) {
    try {
      var sdoc = state.doc;
      if (!sdoc || !state.priceHost || !state.oscHost) return;      var pts = Array.isArray(state.points) ? state.points : [];
      var C = themeChartColors();
      var frame = { paneBg: C.paneBg, grid: C.grid, text: C.text, accent: C.accent, muted: C.muted };
      var emptyText = state.discreteEmptyText ||
        t("market.discrete_no_fills", "No fills yet — place an order or try another pair.");
      /* Shared zoom window (one object for price + volume panes so wheel /
       * drag / dblclick on either moves both; a filter/pair change resets
       * it by replacing the object — stale windows never follow new data). */
      if (!state.discreteView || typeof state.discreteView !== "object") state.discreteView = { t0: null, t1: null };
      var dview = state.discreteView;
      /* Stale-window guard: a new dataset (pair/filter/count change) resets
       * the zoom — a persisted window must never follow new data. Fingerprint
       * is length + endpoints (cheap, collision-harmless: worst case a reset). */
      try {
        var dsig = pts.length + ":" + (pts.length ? (pts[0].timeMs + "-" + pts[pts.length - 1].timeMs) : "");
        if (state.discreteSig !== dsig) {
          state.discreteSig = dsig;
          dview.t0 = null; dview.t1 = null;
          try { delete dview.sel; } catch (e) {}
          try { delete dview.selPrice; } catch (e) {}
          try { delete dview.selVol; } catch (e) {}
        }
      } catch (e) { /* window stands */ }
      function repaintDiscrete() {
        try { drawDiscrete(state); } catch (e) { /* panes stand */ }
      }
      /* Release LWC handles (stale canvases/listeners retire via removePane). */
      try {
        if (!state.panes) state.panes = {};
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
      /* Detach osc panes, VWAP strip, depth + pool-map slices (owned wraps
       * are re-mounted by their owners on return to buckets — detach only,
       * never destroy). */
      try {
        if (!state.paneEls) state.paneEls = {};
        Object.keys(state.paneEls).forEach(function (k) {
          var slot = state.paneEls[k];
          if (slot && slot.wrap && slot.wrap.parentNode) {
            try { slot.wrap.parentNode.removeChild(slot.wrap); } catch (e2) { /* gone */ }
          }
        });
      } catch (e) { /* panes stand */ }
      state.paneEls = {};
      try {
        if (state.depthWrap && state.depthWrap.parentNode) state.depthWrap.parentNode.removeChild(state.depthWrap);
      } catch (e) { /* slice order is chrome */ }
      try {
        if (state.graphWrap && state.graphWrap.parentNode) state.graphWrap.parentNode.removeChild(state.graphWrap);
      } catch (e) { /* slice order is chrome */ }
      if (state.vwapWrap && state.vwapWrap.parentNode) {
        try { state.vwapWrap.parentNode.removeChild(state.vwapWrap); } catch (e) { /* gone */ }
        state.vwapWrap = null;
      }
      /* Discrete volume pane: auto-mounted below price, owned here so the
       * bucketed path never sees it (removed on return below). */
      var dvBody = state.discreteVolBody || null;
      if (!state.discreteVolWrap || state.discreteVolWrap.parentNode !== state.oscHost) {
        var dvWrap = sdoc.createElement("div");
        dvWrap.className = "mkt-osc-pane";
        var dvHead = sdoc.createElement("div");
        dvHead.className = "mkt-osc-head";
        dvHead.appendChild(DOM.el(sdoc, "span", t("market.discrete_volume", "Discrete volume"), "mkt-osc-title"));
        dvWrap.appendChild(dvHead);
        dvBody = sdoc.createElement("div");
        dvBody.className = "mkt-osc-body";
        dvWrap.appendChild(dvBody);
        state.discreteVolWrap = dvWrap;
        state.discreteVolBody = dvBody;
        try { state.oscHost.appendChild(dvWrap); } catch (e) { /* host gone */ }
      }
      try {
        if (typeof DiscreteCharts !== "undefined" && DiscreteCharts) {
          DiscreteCharts.drawDiscretePrice(sdoc, state.priceHost, pts, {
            log: !!state.logScale, colors: frame, emptyText: emptyText,
            view: dview, selKey: "selPrice", onViewChange: repaintDiscrete
          });
          DiscreteCharts.drawDiscreteVolume(sdoc, dvBody, pts, {
            colors: frame, emptyText: emptyText,
            view: dview, selKey: "selVol", onViewChange: repaintDiscrete
          });
        }
      } catch (e) { /* panes stand on honest empties */ }
      state.chartData = { buckets: [], discrete: true, points: pts };
      try { paintCountNote(state); } catch (e) { /* note best-effort */ }
      /* Menu follows the mode (covers mid-session switches — the
       * construction-time pass only handles deep-link entry). */
      try { syncIndMenu(sdoc, state); } catch (e) { /* menu best-effort */ }
    } catch (e) { /* discrete paint must never break the desk */ }
  }

  function maybeDraw(state) {
    /* Discrete mode (raw fills, no buckets): dots + auto volume stems on
     * dependency-free canvas, everything else closed. Indicator selections
     * stay retained in state.over/state.osc (menu only disables controls)
     * for the return to buckets. VWAP/depth/pool-map slices detach here;
     * the bucketed path re-appends its owned wraps on return. Never throws. */
    if (state.discrete) {
      drawDiscrete(state);
      return;
    }
    /* Leaving Discrete: retire the auto volume pane (owned by drawDiscrete;
     * recreated on re-entry). Depth/pool-map/VWAP wraps re-mount through
     * their own pin blocks below. */
    try {
      if (state.discreteVolWrap && state.discreteVolWrap.parentNode) {
        state.discreteVolWrap.parentNode.removeChild(state.discreteVolWrap);
      }
    } catch (e) { /* pane stands */ }
    state.discreteVolWrap = null;
    state.discreteVolBody = null;
    /* Menu follows the mode back (re-enables what the discrete pass marked). */
    try { syncIndMenu(state.doc, state); } catch (e) { /* menu best-effort */ }
    var buckets = (state.candles && Array.isArray(state.candles.buckets))
      ? state.candles.buckets : [];
    var firstMs = buckets.length > 0 ? ((buckets[0] && buckets[0].timeMs) || 0) : 0;
    var c = state._seriesCache || null;
    var hit = !!c &&
      c.bucket === state.bucket && c.count === CANDLE_COUNT &&
      buckets.length > 0 && buckets.length >= c.len && buckets.length <= c.len + 1 &&
      c.firstMs === firstMs && Array.isArray(c.closes) && c.closes.length === c.len &&
      Array.isArray(c.highs) && Array.isArray(c.lows) &&
      Array.isArray(c.opens) && Array.isArray(c.times) && Array.isArray(c.vols);
    var closes, highs, lows, opens, times, vols;
    if (hit) {
      /* Tip-poll fast path: slots 0..len-1 stand untouched; the live last
       * slot is rewritten, and a rolled-over tip extends the arrays by one
       * indexed store (assignment past the end lengthens them). */
      closes = c.closes; highs = c.highs; lows = c.lows;
      opens = c.opens; times = c.times; vols = c.vols;
      MarketInd._series.readSlot(buckets, buckets.length - 1,
        { closes: closes, highs: highs, lows: lows, opens: opens, times: times, vols: vols });
      if (buckets.length === c.len + 1) c.len = buckets.length;
    } else {
      closes = []; highs = []; lows = []; opens = []; times = []; vols = [];
      var fresh = { closes: closes, highs: highs, lows: lows, opens: opens, times: times, vols: vols };
      var i;
      for (i = 0; i < buckets.length; i++) {
        MarketInd._series.readSlot(buckets, i, fresh);
      }
      state._seriesCache = {
        bucket: state.bucket, count: CANDLE_COUNT, len: buckets.length, firstMs: firstMs,
        closes: closes, highs: highs, lows: lows, opens: opens, times: times, vols: vols
      };
    }
    var any = closes.some(function (v) { return v !== null; });
    var C = themeChartColors();
    var overlays = [];
    if (any) {
      overlays = MarketInd._series.priceOverlays(state,
        closes.map(MarketInd._series.numOrNaN), highs.map(MarketInd._series.numOrNaN), lows.map(MarketInd._series.numOrNaN), vols, C);
    }
    var depth = state.bookDepth || { bids: [], asks: [] };
    /* Candle places ride along for the LWC axis (candles() magnitude-aware
     * precision — the price pane prints the same 4 sig figs; absent means
     * the pane derives it from the bars, same rule). */
    var places = null;
    try {
      if (state.candles && Number.isInteger(state.candles.places)) places = state.candles.places;
    } catch (e) { places = null; }
    /* Per-pane osc series are computed live in drawCharts (checkbox toggles
     * never refetch); only the pixel-ready raw arrays are cached here. */
    state.chartData = {
      buckets: buckets, overlays: overlays,
      closes: closes, highs: highs, lows: lows, opens: opens, vols: vols, oscTimes: times,
      depth: depth, places: places
    };
    drawCharts(state);
  }

  /* Draw price + ALL live stacked sub-panes (Task 4b — the SAME redraw path
   * serves checkbox toggles, x removes, theme switches and resizes: callers
   * never fork it). Volume is its own histogram sub-pane on an independent
   * scale when checked, never overlaid on price (one scale per pane). Every
   * checked key in OSC_ORDER owns one wrapper (.mkt-osc-pane: title +
   * x button + chart body). Defaults are all-off (price + pool map only) —
   * the container may hold just the pool-map slice, or nothing at all when
   * every plot is off — never a blank box. */
  function drawCharts(state) {
    /* Discrete re-dispatch: resize/theme/log redraws enter here but the
     * discrete paint lives in drawDiscrete (via maybeDraw) — repaint from
     * cached state.points, never refetch. */
    if (state.chartData && state.chartData.discrete) {
      maybeDraw(state);
      return;
    }
    if (!state.chartData) return;
    var d = state.chartData;
    var doc = state.doc;
    /* No forced panes: every oscillator (incl. Volume) is opt-in via the
     * Indicators pulldown. Missing state.osc still normalizes to {}. */
    if (!state.osc) state.osc = {};
    var C = themeChartColors();
    var frame = { paneBg: C.paneBg, grid: C.grid, text: C.text };
    try {
      state.panes.price = MarketCharts.drawPricePane(doc, state.priceHost, {
        candles: d.buckets, overlays: d.overlays, logScale: state.logScale,
        precision: (typeof d.places === "number" ? d.places : undefined),
        colors: frame, emptyText: t("market.no_price_history", "No price history on this market."),
        previous: state.panes.price
      });
    } catch (e) { /* pane failure must not break the desk */ }
    /* VWAP + spread strip (proposal 3): same redraw path, own canvas, the
     * LWC price pane above is untouched. Pane failure must not break it
     * either — drawVwap guards internally and fails to honest text. */
    try {
      drawVwap(state, C);
    } catch (e) { /* strip failure must not break the desk */ }
    try {
      if (!state.panes.oscs) state.panes.oscs = {};
      if (!state.paneEls) state.paneEls = {};
      var closesNaN = (d.closes || []).map(MarketInd._series.numOrNaN);
      var highsNaN = (d.highs || []).map(MarketInd._series.numOrNaN);
      var lowsNaN = (d.lows || []).map(MarketInd._series.numOrNaN);
      var opensNaN = (d.opens || []).map(MarketInd._series.numOrNaN);
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
          one = MarketInd._series.oscOne(key, state, closesNaN, highsNaN, lowsNaN, d.vols, C, opensNaN);
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
          head.appendChild(DOM.el(doc, "span", label, "mkt-osc-title"));
          /* Every pane (incl. Volume) gets an x that unchecks its menu box. */
          var x = DOM.el(doc, "button", "✕", "mkt-osc-x subtle-btn");
          x.classList.add("touchable");
          x.type = "button";
          x.setAttribute("aria-label", t("settings.remove", "Remove") + " " + label + " pane");
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
    /* Depth slice: toggleable like every non-price plot. Off detaches the
     * wrap (draw skipped); on draws + pins at stack index 1 (after Volume
     * when it is on). Desks without a depth slice skip this. */
    try {
      if (state.showDepth === false) {
        if (state.depthWrap && state.depthWrap.parentNode) {
          state.depthWrap.parentNode.removeChild(state.depthWrap);
        }
      } else {
        MarketCharts.drawDepth(state.depthCanvas, d.depth.bids, d.depth.asks,
          { low: null, high: null, logX: !!state.depthLogX, logY: !!state.depthLogY }, "No depth data.");
      }
      /* Pool map off detaches the wrap (same pattern as depth; the desk owns drawing). */
      if (state.showPoolMap === false) {
        if (state.graphWrap && state.graphWrap.parentNode) {
          state.graphWrap.parentNode.removeChild(state.graphWrap);
        }
      }
    } catch (e) { /* canvas failure must not break the desk */ }
    /* Depth slice position: the depth canvas lives in the charts stack as an
     * osc-sized slice (state.depthWrap, owned by the desk) and must sit
     * second — after Volume when it is on, before any oscillator panes.
     * The osc loop above re-appends panes in OSC_ORDER, so pin the wrap at
     * index 1 here (index 0 is Volume when present; a missing Volume just
     * puts depth first, never lost). Desks without a depth slice skip this. */
    try {
      if (state.depthWrap && state.showDepth !== false && state.oscHost) {
        if (state.depthWrap.parentNode !== state.oscHost) {
          state.oscHost.appendChild(state.depthWrap);
        }
        var at = state.oscHost.children.length > 1 ? state.oscHost.children[1] : null;
        if (at !== state.depthWrap) state.oscHost.insertBefore(state.depthWrap, at);
      }
      /* Pool-map slice position: pinned right after depthWrap (index 2-ish).
       * Depth present -> insert before depth-next; depth absent -> index 1
       * (after Volume). Desks without a pool slice skip this. */
      if (state.graphWrap && state.showPoolMap !== false && state.oscHost) {
        if (state.graphWrap.parentNode !== state.oscHost) {
          state.oscHost.appendChild(state.graphWrap);
        }
        var gref = null, gidx = -1, gi;
        try {
          var gkids = state.oscHost.children;
          for (gi = 0; gi < gkids.length; gi++) {
            if (gkids[gi] === state.depthWrap && state.showDepth !== false) { gidx = gi; break; }
          }
          if (gidx !== -1) gref = gkids[gidx + 1] || null;
          else gref = gkids.length > 1 ? gkids[1] : null;
        } catch (e) { gref = null; }
        if (gref !== state.graphWrap) {
          try {
            if (gref) state.oscHost.insertBefore(state.graphWrap, gref);
            else state.oscHost.appendChild(state.graphWrap);
          } catch (e) { /* slice order is chrome */ }
        }
      }
    } catch (e) { /* slice order is chrome — panes stand as appended */ }
    /* Time-scale sync: scrolling/zooming the price pane moves every
     * oscillator sub-pane with it (and vice versa). Charts are rebuilt on
     * each drawCharts, so the previous link is dropped first; canvas
     * fallbacks have no scrollable scale and are skipped by kind. */
    try {
      if (typeof state.timeUnlink === "function") state.timeUnlink();
      state.timeUnlink = null;
      var lwcCharts = [];
      if (state.panes && state.panes.price && state.panes.price.kind === "lwc" &&
          state.panes.price.chart) lwcCharts.push(state.panes.price.chart);
      Object.keys((state.panes && state.panes.oscs) || {}).forEach(function (k) {
        var h = state.panes.oscs[k];
        if (h && h.kind === "lwc" && h.chart) lwcCharts.push(h.chart);
      });
      if (lwcCharts.length > 1 && typeof ChartsLwc !== "undefined" && ChartsLwc &&
          typeof ChartsLwc.linkTimeScales === "function") {
        state.timeUnlink = ChartsLwc.linkTimeScales(lwcCharts);
      }
    } catch (e) { /* sync is chrome — panes stand unlinked */ }
  }

  /* Overlays menu section: meshable indicators get one row each (label +
   * Add button) plus per-instance chips ([name] [period input] [x]) so a
   * 5/10/50 SMA mesh is three Adds and two period edits — live preview on
   * every change, no modal. Fixed-param overlays keep one legacy checkbox
   * row. Period inputs validate + clamp to the spec range (invalid reverts,
   * never reaches the math). All targets 44px. */
  function overlaysGroup(doc, panel, state) {
    var sec = doc.createElement("div");
    sec.className = "mkt-indmenu-group";
    var head = doc.createElement("div");
    head.className = "mkt-indmenu-head";
    head.textContent = t("market.overlays_group", "Overlays");
    sec.appendChild(head);
    if (!state.over || typeof state.over !== "object") state.over = {};
    OVERLAY_DEFS.forEach(function (def) {
      var key = def[0], label = overlayLabel(key, def[1]);
      var spec = MarketInd._series.OVERLAY_SPECS[key];
      if (!spec) {
        /* Legacy single-checkbox row (fixed-param overlay). */
        var lab = doc.createElement("label");
        lab.className = "mkt-indmenu-item";
        var box = doc.createElement("input");
        box.type = "checkbox";
        box.checked = !!(state.over[key] && state.over[key].length);
        box.setAttribute("aria-label", label + " overlay");
        if (!MarketInd._series.ind(key)) {
          box.disabled = true;
          lab.title = label + " unavailable in this build";
        }
        touchable(box);
        box.addEventListener("change", function () {
          state.over[key] = box.checked ? [{}] : [];
          drawCharts(state);
        });
        lab.appendChild(box);
        lab.appendChild(DOM.el(doc, "span", label));
        sec.appendChild(lab);
        return;
      }
      if (!MarketInd._series.ind(spec.fn)) {
        var off = doc.createElement("div");
        off.className = "mkt-indmenu-item";
        off.textContent = label + " unavailable in this build";
        sec.appendChild(off);
        return;
      }
      if (!Array.isArray(state.over[key])) {
        state.over[key] = state.over[key] === true ? [{}] : [];
      }
      var row = doc.createElement("div");
      row.className = "mkt-indmenu-item";
      row.appendChild(DOM.el(doc, "span", label));
      var add = DOM.el(doc, "button", "＋", "subtle-btn");
      add.classList.add("touchable");
      add.type = "button";
      add.setAttribute("aria-label", t("settings.add", "Add") + " " + label + " overlay");
      add.addEventListener("click", function () {
        state.over[key].push({ p: spec.param.def });
        paintChips();
        drawCharts(state);
      });
      row.appendChild(add);
      sec.appendChild(row);
      var chips = doc.createElement("div");
      chips.className = "mkt-indmenu-chips";
      sec.appendChild(chips);
      var step = (spec.param.min >= 1) ? 1 : (spec.param.def < 1 ? 0.005 : 0.5);
      /* paintChips: per-instance period chips (editable number + remove)
       * for this indicator; edits clamp into range and redraw the charts. */
      function paintChips() {
        DOM.clear(chips);
        state.over[key].forEach(function (inst, i) {
          var chip = doc.createElement("div");
          chip.className = "mkt-indmenu-chip";
          chip.appendChild(DOM.el(doc, "span", label));
          var num = doc.createElement("input");
          num.type = "number";
          num.value = String((inst && typeof inst.p === "number") ? inst.p : spec.param.def);
          num.min = String(spec.param.min);
          num.max = String(spec.param.max);
          num.step = String(step);
          num.setAttribute("inputmode", "numeric");
          num.setAttribute("aria-label", label + " " + spec.param.name);
          num.style.minHeight = "44px";
          num.addEventListener("change", function () {
            var v = parseFloat(num.value);
            if (!isFinite(v)) { num.value = String(inst.p !== undefined ? inst.p : spec.param.def); return; }
            if (v < spec.param.min) v = spec.param.min;
            if (v > spec.param.max) v = spec.param.max;
            inst.p = v;
            num.value = String(v);
            drawCharts(state);
          });
          chip.appendChild(num);
          var x = DOM.el(doc, "button", "✕", "mkt-osc-x subtle-btn");
          x.classList.add("touchable");
          x.type = "button";
          x.setAttribute("aria-label", t("settings.remove", "Remove") + " " + label + " " + num.value);
          x.addEventListener("click", function () {
            state.over[key].splice(i, 1);
            paintChips();
            drawCharts(state);
          });
          chip.appendChild(x);
          chips.appendChild(chip);
        });
      }
      paintChips();
    });
    panel.appendChild(sec);
  }

  /* Indicator dropdown menu (parity round, shared by market + pool desks):
   * one "Indicators" button + grouped checkbox panel (Overlays on the price
   * pane / Oscillator sub-panes), replacing the two sprawling checkbox rows.
   * Same state contract as the old rows (state.over/state.osc +
   * state.oscBoxes for pane-x sync), same redraw path (drawCharts) — only
   * the control UI changes. Button toggles on click; Esc closes and
   * refocuses the button; outside pointerdown closes; checkbox toggles never
   * close the panel. All targets 44px; keyboard-native controls throughout. */
  function renderIndMenu(doc, host, state) {
    var wrap = doc.createElement("div");
    wrap.className = "mkt-indmenu";
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "mkt-indmenu-btn";
    btn.textContent = t("market.indicators_menu", "Indicators");
    try { btn.appendChild(doc.createTextNode(" ▾")); } catch (e) { /* label stands */ }
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    touchable(btn);
    var panel = doc.createElement("div");
    panel.className = "mkt-indmenu-panel";
    panel.style.display = "none";
    /* setOpen: show/hide the indicator menu panel (ARIA expanded follows;
     * opening moves focus to the first input, falling back to the button). */
    function setOpen(open) {
      panel.style.display = open ? "" : "none";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        try {
          var first = panel.querySelector("input");
          if (first && typeof first.focus === "function") first.focus();
        } catch (e) { /* button keeps focus */ }
      }
    }
    function isOpen() { return panel.style.display !== "none"; }
    btn.addEventListener("click", function () { setOpen(!isOpen()); });
    /* group: one menu section (title + checkbox items bound to the
     * overlay/oscillator state store). Params: title, [key,label] items,
     * state store object, "over"|"osc" kind. */
    function group(title, items, store, kind) {
      var sec = doc.createElement("div");
      sec.className = "mkt-indmenu-group";
      var head = doc.createElement("div");
      head.className = "mkt-indmenu-head";
      head.textContent = title;
      sec.appendChild(head);
      items.forEach(function (def) {
        var key = def[0], label = def[1];
        var lab = doc.createElement("label");
        lab.className = "mkt-indmenu-item";
        var box = doc.createElement("input");
        box.type = "checkbox";
        box.checked = !!store[key];
        box.setAttribute("aria-label", label + (kind === "over" ? " overlay" : " pane"));
        /* Volume needs no indicator fn (raw baseVolume bars) — never gated
         * on MarketInd._series.ind(). Every other oscillator disables when its fn is missing. */
        if (kind === "osc" && key !== "volume" && !MarketInd._series.ind(key)) {
          box.disabled = true;
          lab.title = label + " unavailable in this build";
        }
        touchable(box);
        box.addEventListener("change", function () {
          store[key] = box.checked;
          drawCharts(state);
          try {
            if (typeof MarketDesk !== "undefined" && MarketDesk && typeof MarketDesk.syncUrl === "function") MarketDesk.syncUrl(state);
          } catch (e) { /* URL stays */ }
        });
        lab.appendChild(box);
        lab.appendChild(DOM.el(doc, "span", label));
        sec.appendChild(lab);
        if (kind === "osc") state.oscBoxes[key] = box;
      });
      panel.appendChild(sec);
    }
    overlaysGroup(doc, panel, state);
    /* Toggleable plots (everything but price): VWAP strip + depth slice + pool map.
     * Labels are plain symbols (OSC_ORDER precedent — no dict entries). */
    group(t("market.plots_group", "Plots"),
      [["showVwap", "Session VWAP"], ["showDepth", "Depth"], ["showPoolMap", "Pool map"]], state, "plot");
    group(t("market.oscillators_group", "Oscillators"), OSC_ORDER, state.osc, "osc");
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    host.appendChild(wrap);
    try {
      doc.addEventListener("pointerdown", function (ev) {
        if (!isOpen()) return;
        var node = ev && ev.target;
        while (node) {
          if (node === wrap) return;
          node = node.parentNode;
        }
        setOpen(false);
      });
      doc.addEventListener("keydown", function (ev) {
        if (!isOpen()) return;
        if ((ev && ev.key === "Escape") || (ev && ev.keyCode === 27)) {
          setOpen(false);
          try { btn.focus(); } catch (e) { /* focus stays */ }
        }
      });
    } catch (e) { /* button toggle still works */ }
    /* Discrete mode: everything but price is closed, so the whole menu is
     * inspectable but non-functional (greyed). Selections are RETAINED in
     * state.over/state.osc for the return to buckets — only the controls
     * are disabled, never the state (pool P shares this path via P.discrete). */
    if (state.discrete) {
      try {
        var dnote = doc.createElement("p");
        dnote.className = "muted";
        dnote.textContent = t("market.discrete_unavailable", "Indicators unavailable in Discrete.");
        try {
          if (panel.firstChild) panel.insertBefore(dnote, panel.firstChild);
          else panel.appendChild(dnote);
        } catch (e) { panel.appendChild(dnote); }
      } catch (e) { /* menu still disables below */ }
      try {
        var ctrls = panel.querySelectorAll ? panel.querySelectorAll("input, button") : [];
        for (var di = 0; di < ctrls.length; di++) {
          try {
            ctrls[di].disabled = true;
            ctrls[di].title = t("market.discrete_unavailable", "Indicators unavailable in Discrete.");
          } catch (e2) { /* next control */ }
        }
      } catch (e) { /* menu stands enabled rather than broken */ }
    }
    return { button: btn, panel: panel, close: function () { setOpen(false); } };
  }
  MarketInd._panes.drawCharts = drawCharts;
  MarketInd._panes.maybeDraw = maybeDraw;
  MarketInd._panes.renderStrip = renderStrip;
  MarketInd._panes.paintCountNote = paintCountNote;
  MarketInd._panes.paintTimeframes = paintTimeframes;
  MarketInd._panes.paintCountInput = paintCountInput;
  MarketInd._panes.renderIndMenu = renderIndMenu;
  MarketInd._panes.PREF_BUCKETS = PREF_BUCKETS;
  MarketInd._panes.CANDLE_COUNT = CANDLE_COUNT;
  MarketInd._panes.reconcileBuckets = reconcileBuckets;
  MarketInd._panes.bucketLabel = bucketLabel;
  MarketInd._panes._test = { validCount: validCount, bucketLabel: bucketLabel, reconcileBuckets: reconcileBuckets };
  MarketInd._panes.OSC_ORDER = OSC_ORDER;
  MarketInd._panes.OVERLAY_DEFS = OVERLAY_DEFS;
  MarketInd._panes.overlayLabel = overlayLabel;
  if (typeof globalThis !== "undefined") { globalThis.MarketInd = MarketInd; }
})();

if (typeof module !== "undefined") { module.exports = MarketInd; }
