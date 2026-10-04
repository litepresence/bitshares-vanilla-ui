/* MarketInd: chart data prep + pane rendering for the DEX desk (timeframes,
 *   stats strip, overlays, stacked oscillator panes, depth, VWAP strip).
 * Owns: timeframe bucket constants + bucketLabel, theme chart colors
 *   (readVar/themeChartColors), indicator lookup (ind), pixel converters
 *   (numOrNull/numOrNaN — chart-pixel inputs only, kept next to the fill path
 *   they serve), price overlays (priceOverlays), one-pane series builder
 *   (oscOne), header stats strip (renderStrip), candle-count note
 *   (paintCountNote), timeframe radios (paintTimeframes), session VWAP +
 *   spread-band canvas strip (drawVwap, dex-ux proposal 3 — collapsible,
 *   inside the mkt-charts grid area), chart cache + redraw
 *   (maybeDraw/drawCharts). No fetching, no timers, no signing.
 * Consumes: MarketCharts.drawPricePane/drawOscPane/drawDepth/removePane (via
 *   global), MarketCandles.vwap (session math, guarded — missing means the
 *   strip renders "unavailable"), Indicators.* (via ind(), guarded — null
 *   means unavailable).
 * Globals/side effects: DOM under caller-provided hosts only (price/osc hosts
 *   owned by the desk's state object, never stored here — plus one lazy
 *   #mkt-vwap-wrap sibling of the price host, tracked on state.vwapWrap);
 *   global MarketInd only. bucketLabel/paintTimeframes take an onBucket
 *   callback for refetch so this file never calls the desk's fill (one-way
 *   dependency: desk → ind).
 * Created by: building-vanilla-slices skill, slice-18 audit (market-ui split —
 *   moved verbatim from market-ui.js strip/cell/timeframe/overlay/draw bodies;
 *   fill-nested helpers re-parameterized to (doc, state), bodies unchanged).
 * Extended by: dex-ux plots task (AFK round — proposal 3 VWAP strip,
 *   chain-history only, ES refused).
 */
var MarketInd = (function () {
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

  /* Finite Number or null (chart-pixel inputs only — OHLC human strings become
   * coordinates here; raw integer money never enters). Merged here with the
   * fill→chart path they serve (maybeDraw/priceOverlays below). */
  function numOrNull(v) {
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }

  /* Null/non-finite -> NaN (Indicators warmup convention). */
  function numOrNaN(v) {
    return (typeof v === "number" && isFinite(v)) ? v : NaN;
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

  /* Overlay specs (meshable price plots): exactly ONE adjustable number each
   * (period, deviation %, or PSAR step) — validated + clamped in the menu,
   * never trusted raw. kind selects the data legs; run() calls the indicator
   * fn and returns either one values array or [upper, mid, lower] when
   * lines: 3 (bands share the muted/accent/muted convention; single lines
   * rotate the theme palette so a 5/10/50 mesh reads apart). Fixed-param
   * overlays (vidya/aema/holtwinters — multi-knob fns) keep legacy single
   * checkbox rows in the menu (OVERLAY_FIXED). Defaults equal today's
   * hardcoded values, so the default desk (SMA 10 + EMA 50) is unchanged. */
  var OVERLAY_SPECS = {
    sma: { label: "SMA", fn: "sma", param: { name: "period", def: 10, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    ema: { label: "EMA", fn: "ema", param: { name: "period", def: 50, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    dema: { label: "DEMA", fn: "dema", param: { name: "period", def: 21, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    tema: { label: "TEMA", fn: "tema", param: { name: "period", def: 21, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    wma: { label: "WMA", fn: "wma", param: { name: "period", def: 9, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    kama: { label: "KAMA", fn: "kama", param: { name: "period", def: 10, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    linreg: { label: "LINREG", fn: "linreg", param: { name: "period", def: 14, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    tsf: { label: "TSF", fn: "tsf", param: { name: "period", def: 14, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    vwma: { label: "VWMA", fn: "vwma", param: { name: "period", def: 20, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, a.vols, Math.round(p)); } },
    bb: { label: "BB", fn: "bbands", lines: 3, param: { name: "period", def: 20, min: 2, max: 500 },
      run: function (f, a, p) { var r = f(a.closes, { period: Math.round(p), stddev: 2 }); return [r.upper, r.middle, r.lower]; } },
    psar: { label: "PSAR", fn: "psar", param: { name: "step", def: 0.02, min: 0.005, max: 0.5 },
      run: function (f, a, p) { return f(a.highs, a.lows, { step: p, max: 0.2 }); } },
    keltner: { label: "Keltner", fn: "keltner", lines: 3, param: { name: "period", def: 20, min: 2, max: 500 },
      run: function (f, a, p) { var r = f(a.highs, a.lows, a.closes, { atr: Math.round(p), ema: Math.round(p) }); return [r.upper, r.middle, r.lower]; } },
    donchian: { label: "Donchian", fn: "donchian", lines: 3, param: { name: "period", def: 20, min: 2, max: 500 },
      run: function (f, a, p) { var r = f(a.highs, a.lows, Math.round(p)); return [r.upper, r.middle, r.lower]; } },
    supertrend: { label: "Supertrend", fn: "supertrend", param: { name: "period", def: 14, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.highs, a.lows, a.closes, { period: Math.round(p) }).trend; } },
    zigzag: { label: "ZigZag", fn: "zigzag", param: { name: "deviation %", def: 5, min: 0.5, max: 20 },
      run: function (f, a, p) { return f(a.closes, p).line; } },
    kagi: { label: "KAGI", fn: "kagi", param: { name: "deviation %", def: 2, min: 0.5, max: 20 },
      run: function (f, a, p) { return f(a.closes, p); } }
  };
  /* Fixed-param overlays: legacy single-checkbox rows (no mesh UI). */
  var OVERLAY_FIXED = ["vidya", "aema", "holtwinters"];

  /* Price-pane overlay lines from instance lists. state.over maps key ->
   * [{p: number}, ...] (mesh: several periods of one indicator); legacy
   * booleans (true = one default instance) are normalized, never thrown on.
   * Each entry is {name, color, values} aligned to the candle slots (warmup
   * nulls break the line, never dive to zero). Unavailable fns are skipped
   * (see ind()), never throw. */
  function priceOverlays(state, closes, highs, lows, vols, C) {
    var out = [];
    var over = (state && state.over) || {};
    /* Legacy booleans -> instance lists (pool/exchange inits already ship
     * lists; this only guards foreign states). */
    Object.keys(over).forEach(function (k) {
      if (over[k] === true) over[k] = [{}];
      else if (!Array.isArray(over[k])) over[k] = [];
    });
    var palette = [C.buy, C.sell, C.accent, C.warn, C.muted];
    var ci = 0;
    var legs = { closes: closes, highs: highs, lows: lows, vols: vols };
    /* nextColor: round-robin overlay leg color from the theme palette. */
    function nextColor() { var c = palette[ci % palette.length]; ci++; return c; }
    /* clampP: user period into the spec's [min,max] (non-numbers take the
     * spec default). Returns a finite number, never throws. */
    function clampP(spec, p) {
      var v = (typeof p === "number" && isFinite(p)) ? p : spec.param.def;
      if (v < spec.param.min) return spec.param.min;
      if (v > spec.param.max) return spec.param.max;
      return v;
    }
    try {
      Object.keys(OVERLAY_SPECS).forEach(function (key) {
        var spec = OVERLAY_SPECS[key];
        var list = over[key] || [];
        if (!list.length) return;
        var f = ind(spec.fn);
        if (!f) return;
        list.forEach(function (inst) {
          var p = clampP(spec, inst ? inst.p : null);
          var tag = spec.label + " " + p;
          try {
            if (spec.lines === 3) {
              var r3 = spec.run(f, legs, p);
              out.push({ name: tag + " upper", color: C.muted, values: r3[0] });
              out.push({ name: tag + " mid", color: C.accent, values: r3[1] });
              out.push({ name: tag + " lower", color: C.muted, values: r3[2] });
            } else {
              out.push({ name: tag, color: nextColor(), values: spec.run(f, legs, p) });
            }
          } catch (e) { /* one bad instance never kills the pane */ }
        });
      });
      var f;
      if (over.vidya && over.vidya.length && (f = ind("vidya"))) {
        out.push({ name: "VIDYA", color: C.muted, values: f(closes, {}) });
      }
      if (over.aema && over.aema.length && (f = ind("aema"))) {
        out.push({ name: "AEMA 14", color: C.muted, values: f(closes, {}) });
      }
      if (over.holtwinters && over.holtwinters.length && (f = ind("holtwinters"))) {
        out.push({ name: "HOLT", color: C.accent, values: f(closes, {}).smooth });
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
  function oscOne(key, state, closesNaN, highsNaN, lowsNaN, vols, C, opensNaN) {
    if (key === "volume") {
      return {
        series: [{ name: "Volume", color: C.accent, values: vols || [] }],
        missing: null, histogram: true
      };
    }
    var f = ind(key);
    if (!f) return { series: [], missing: key, histogram: false };
    /* Single-line helper: one named series, no options. */
    function one(name, color, values) {
      return { series: [{ name: name, color: color, values: values }], missing: null, histogram: false };
    }
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
      /* Parity-round panes (defaults = each fn's own defaults; multi-line
       * where the indicator is natively multi-line). */
      if (key === "stochrsi") return one("StochRSI 14", C.accent, f(closesNaN, 14));
      if (key === "adxr") return one("ADXR 14", C.accent, f(highsNaN, lowsNaN, 14));
      if (key === "cci") return one("CCI 20", C.accent, f(highsNaN, lowsNaN, closesNaN, 20));
      if (key === "cmo") return one("CMO 14", C.accent, f(closesNaN, 14));
      if (key === "dx") return one("DX 14", C.accent, f(highsNaN, lowsNaN, 14));
      if (key === "mom") return one("MOM 12", C.accent, f(closesNaN, 12));
      if (key === "roc") return one("ROC 12", C.accent, f(closesNaN, 12));
      if (key === "trix") return one("TRIX 15", C.accent, f(closesNaN, 15));
      if (key === "ultosc") {
        return one("UltOsc", C.accent, f(highsNaN, lowsNaN, closesNaN, {}));
      }
      if (key === "willr") return one("WillR 14", C.accent, f(highsNaN, lowsNaN, closesNaN, 14));
      if (key === "apo") return one("APO", C.accent, f(closesNaN, {}));
      if (key === "ppo") return one("PPO", C.accent, f(closesNaN, {}));
      if (key === "bop") {
        return one("BOP", C.accent, f(opensNaN || closesNaN, highsNaN, lowsNaN, closesNaN));
      }
      if (key === "qstick") {
        return one("QStick 8", C.accent, f(opensNaN || closesNaN, closesNaN, 8));
      }
      if (key === "obv") return one("OBV", C.accent, f(closesNaN, vols));
      if (key === "emv") return one("EMV", C.accent, f(highsNaN, lowsNaN, vols));
      if (key === "vosc") return one("VOSC", C.accent, f(vols, {}));
      if (key === "nvi") return one("NVI", C.accent, f(closesNaN, vols));
      if (key === "pvi") return one("PVI", C.accent, f(closesNaN, vols));
      if (key === "wad") return one("WAD", C.accent, f(highsNaN, lowsNaN, closesNaN));
      if (key === "ad") return one("AD", C.accent, f(highsNaN, lowsNaN, closesNaN, vols));
      if (key === "cvi") return one("CVI 10", C.accent, f(highsNaN, lowsNaN, 10));
      if (key === "natr") return one("NATR 14", C.accent, f(highsNaN, lowsNaN, closesNaN, 14));
      if (key === "mass") return one("Mass", C.accent, f(highsNaN, lowsNaN));
      if (key === "kvo") return one("KVO", C.accent, f(highsNaN, lowsNaN, closesNaN, vols, {}));
      if (key === "adosc") return one("ADOSC", C.accent, f(highsNaN, lowsNaN, closesNaN, vols, {}));
      if (key === "dpo") return one("DPO 21", C.accent, f(closesNaN, 21));
      if (key === "vhf") return one("VHF 28", C.accent, f(closesNaN, 28));
      if (key === "volatility") return one("Volatility 14", C.accent, f(closesNaN, 14));
      if (key === "aroon") {
        var ar = f(highsNaN, lowsNaN, 25);
        return {
          series: [
            { name: "Aroon Up", color: C.accent, values: ar.up },
            { name: "Aroon Down", color: C.muted, values: ar.down }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "di") {
        var dd = f(highsNaN, lowsNaN, 14);
        return {
          series: [
            { name: "+DI", color: C.accent, values: dd.plus },
            { name: "-DI", color: C.muted, values: dd.minus }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "vortex") {
        var vx = f(highsNaN, lowsNaN, closesNaN, 14);
        return {
          series: [
            { name: "+VI", color: C.accent, values: vx.plus },
            { name: "-VI", color: C.muted, values: vx.minus }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "kst") {
        var ks = f(closesNaN, {});
        return {
          series: [
            { name: "KST", color: C.accent, values: ks.kst },
            { name: "Signal", color: C.muted, values: ks.signal }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "ravi") return one("RAVI", C.accent, f(highsNaN, lowsNaN, closesNaN, {}));
      if (key === "tsi") return one("TSI", C.accent, f(closesNaN, {}));
      if (key === "smi") {
        var sm = f(highsNaN, lowsNaN, closesNaN, {});
        return {
          series: [
            { name: "SMI", color: C.accent, values: sm.smi },
            { name: "Signal", color: C.muted, values: sm.signal }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "eri") {
        var er = f(highsNaN, lowsNaN, closesNaN, 13);
        return {
          series: [
            { name: "Bull", color: C.accent, values: er.bull },
            { name: "Bear", color: C.muted, values: er.bear }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "awesome") return one("Awesome", C.accent, f(highsNaN, lowsNaN, {}));
      if (key === "arsi") return one("ARSI 14", C.accent, f(closesNaN, 14));
      if (key === "ulcer") return one("Ulcer 14", C.accent, f(closesNaN, 14));
      if (key === "earsi") return one("EARSI", C.accent, f(closesNaN, {}));
    } catch (e) {
      return { series: [], missing: key, histogram: false };
    }
    return { series: [], missing: null, histogram: false };
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

  /* Compact header stats strip: Latest / 24h change / 24h volume / Best
   * bid-ask, plus Feed Price + Settlement for bitasset markets (state.feed,
   * filled once per desk by market-desk.js fetchFeed — absent on non-MPA
   * pairs, exactly like #1 which hides both columns there). Price-like
   * values render trim6 with the full chain string on title; ticker/volume
   * fields pass through verbatim (same fields as the side panel, no money
   * math). Moved verbatim out of fill; state carries {ticker, strip, assets,
   * feed} exactly as before. */
  function renderStrip(doc, state) {
    var st = state.ticker;
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
    cell(t("market.stat_latest", "Latest"), st.latest);
    var chg = (st.raw && st.raw.percent_change !== undefined && st.raw.percent_change !== null)
      ? String(st.raw.percent_change) : null;
    cell(t("market.stat_chg", "24h Δ"), chg);
    var bv = (st.raw && st.raw.base_volume !== undefined && st.raw.base_volume !== null)
      ? String(st.raw.base_volume) + " " + state.assets.base.symbol : null;
    cell(t("market.stat_vol", "24h Vol"), bv);
    var bidFull = [st.highestBid, st.lowestAsk].filter(function (x) { return x !== null; });
    var bidTrim = bidFull.map(function (x) { return trim6(String(x)); });
    cell(t("market.stat_bidask", "Bid–Ask"), bidTrim.length ? bidTrim.join(" / ") : null,
      bidFull.length ? bidFull.join(" / ") : null);
    /* Feed + settlement (D1): state.feed is filled once per desk by
     * market-desk.js fetchFeed ({feed, settle} human base-per-quote strings
     * from the bitasset_data object, or null). No feed state -> no cells
     * (non-MPA pairs, pending/failed fetch) — the strip stands on ticker. */
    var feed = state.feed || null;
    if (feed && feed.feed !== null && feed.feed !== undefined) {
      cell(t("market.stat_feed", "Feed Price"), feed.feed);
    }
    if (feed && feed.settle && feed.settle.value !== null && feed.settle.value !== undefined) {
      var isGlobal = !!feed.settle.global;
      var settleFull = String(feed.settle.value);
      if (!isGlobal && feed.settle.offset !== undefined && feed.settle.offset !== null) {
        settleFull += " (offset " + String(feed.settle.offset) + "/10000)";
      }
      cell(isGlobal
        ? t("market.stat_global_settle", "Global Settlement")
        : t("market.stat_settle", "Settlement Price"), feed.settle.value, settleFull);
    }
  }

  /* Refresh the "N × timeframe candles" note under the timeframe radios. */
  function paintCountNote(state) {
    if (state.countNote) {
      state.countNote.textContent =
        CANDLE_COUNT + " × " + bucketLabel(state.bucket) + " candles";
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
        paintCountNote(state);
        onBucket();
      });
      lab.appendChild(radio);
      lab.appendChild(DOM.el(doc, "span", bucketLabel(b)));
      state.tfBox.appendChild(lab);
    });
    paintCountNote(state);
  }

  /* Draw all three panes once book/candle data has arrived (either may come
   * first; cached so resize/theme/log redraws never re-hit the chain). */
  function maybeDraw(state) {
    var buckets = (state.candles && Array.isArray(state.candles.buckets))
      ? state.candles.buckets : [];
    var closes = [], highs = [], lows = [], opens = [], times = [], vols = [];
    var i;
    for (i = 0; i < buckets.length; i++) {
      closes.push(numOrNull(Number(buckets[i] ? buckets[i].close : NaN)));
      highs.push(numOrNull(Number(buckets[i] ? buckets[i].high : NaN)));
      lows.push(numOrNull(Number(buckets[i] ? buckets[i].low : NaN)));
      opens.push(numOrNull(Number(buckets[i] ? buckets[i].open : NaN)));
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
        closes.map(numOrNaN), highs.map(numOrNaN), lows.map(numOrNaN), vols, C);
    }
    var depth = state.bookDepth || { bids: [], asks: [] };
    /* Per-pane osc series are computed live in drawCharts (checkbox toggles
     * never refetch); only the pixel-ready raw arrays are cached here. */
    state.chartData = {
      buckets: buckets, overlays: overlays,
      closes: closes, highs: highs, lows: lows, opens: opens, vols: vols, oscTimes: times,
      depth: depth
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
      var closesNaN = (d.closes || []).map(numOrNaN);
      var highsNaN = (d.highs || []).map(numOrNaN);
      var lowsNaN = (d.lows || []).map(numOrNaN);
      var opensNaN = (d.opens || []).map(numOrNaN);
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
          one = oscOne(key, state, closesNaN, highsNaN, lowsNaN, d.vols, C, opensNaN);
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
      var spec = OVERLAY_SPECS[key];
      if (!spec) {
        /* Legacy single-checkbox row (fixed-param overlay). */
        var lab = doc.createElement("label");
        lab.className = "mkt-indmenu-item";
        var box = doc.createElement("input");
        box.type = "checkbox";
        box.checked = !!(state.over[key] && state.over[key].length);
        box.setAttribute("aria-label", label + " overlay");
        if (!ind(key)) {
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
      if (!ind(spec.fn)) {
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
         * on ind(). Every other oscillator disables when its fn is missing. */
        if (kind === "osc" && key !== "volume" && !ind(key)) {
          box.disabled = true;
          lab.title = label + " unavailable in this build";
        }
        touchable(box);
        box.addEventListener("change", function () {
          store[key] = box.checked;
          drawCharts(state);
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
    return { button: btn, panel: panel, close: function () { setOpen(false); } };
  }

  return {
    drawCharts: drawCharts,
    maybeDraw: maybeDraw,
    renderStrip: renderStrip,
    paintCountNote: paintCountNote,
    paintTimeframes: paintTimeframes,
    paintCountInput: paintCountInput,
    renderIndMenu: renderIndMenu,
    /* Shared read-only constants for the desk: bucket shortlist + candle
     * count (fill reconciliation) and pane order + indicator lookup (desk
     * checkbox wiring must match drawCharts pane order — single source). */
    PREF_BUCKETS: PREF_BUCKETS,
    CANDLE_COUNT: CANDLE_COUNT,
    reconcileBuckets: reconcileBuckets,
    bucketLabel: bucketLabel,
    _test: { validCount: validCount },
    OSC_ORDER: OSC_ORDER,
    OVERLAY_DEFS: OVERLAY_DEFS,
    OVERLAY_SPECS: OVERLAY_SPECS,
    priceOverlays: priceOverlays,
    overlayLabel: overlayLabel,
    ind: ind
  };
})();

if (typeof module !== "undefined") { module.exports = MarketInd; }
