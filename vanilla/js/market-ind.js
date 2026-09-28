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
  var CANDLE_COUNT = 200;

  /* Stacked sub-pane order (Task 4b): checkbox order IS pane order — RSI,
   * MACD, Stoch, ATR, Fisher, then Volume. Single source for the picker,
   * the pane reconciliation in drawCharts, and teardown. */
  var OSC_ORDER = [
    ["rsi", "RSI"], ["macd", "MACD"], ["stoch", "Stoch"],
    ["atr", "ATR"], ["fisher", "Fisher"], ["volume", "Volume"]
  ];

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
    while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
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
      det.appendChild(el(doc, "p",
        t("market_ind.vwap_no_history", "No bucket history — VWAP unavailable on this market."), "muted"));
      return;
    }
    if (typeof MarketCandles === "undefined" || !MarketCandles ||
        typeof MarketCandles.vwap !== "function" ||
        !assets || !assets.base || !assets.quote ||
        typeof assets.base.precision !== "number" ||
        typeof assets.quote.precision !== "number") {
      det.appendChild(el(doc, "p",
        t("market_ind.vwap_unavailable", "VWAP unavailable (bucket math or asset precisions missing)."), "muted"));
      return;
    }
    var v;
    try {
      v = MarketCandles.vwap(buckets, assets.base.precision, assets.quote.precision);
    } catch (e) {
      det.appendChild(el(doc, "p",
        t("market_ind.vwap_unavailable", "VWAP unavailable (bucket math or asset precisions missing)."), "muted"));
      return;
    }
    if (!v || !Array.isArray(v.per) || v.per.length === 0 || v.human === null) {
      det.appendChild(el(doc, "p",
        t("market_ind.vwap_no_volume", "No bucket volume — VWAP needs fills in this session."), "muted"));
      return;
    }
    var note = el(doc, "p",
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

  /* Compact header stats strip: Latest / 24h change / 24h volume / Best
   * bid-ask. Renders the chain's human strings verbatim (ticker
   * latest/highest_bid/lowest_ask are already base-per-quote strings —
   * same fields as the side panel, no money math). Moved verbatim out of
   * fill; state carries {ticker, strip, assets} exactly as before. */
  function renderStrip(doc, state) {
    var st = state.ticker;
    while (state.strip.firstChild) state.strip.removeChild(state.strip.firstChild);
    if (!st) {
      state.strip.appendChild(el(doc, "span", t("market.loading_stats", "Loading stats…"), "muted"));
      return;
    }
    /* One label/value chip appended to the strip (missing values show —). */
    function cell(label, value) {
      var s = doc.createElement("span");
      s.className = "mkt-stat";
      s.appendChild(el(doc, "span", label + " ", "muted"));
      s.appendChild(el(doc, "strong", value === null || value === undefined ? t("market.stat_empty", "—") : String(value)));
      state.strip.appendChild(s);
    }
    cell(t("market.stat_latest", "Latest"), st.latest);
    var chg = (st.raw && st.raw.percent_change !== undefined && st.raw.percent_change !== null)
      ? String(st.raw.percent_change) : null;
    cell(t("market.stat_chg", "24h Δ"), chg);
    var bv = (st.raw && st.raw.base_volume !== undefined && st.raw.base_volume !== null)
      ? String(st.raw.base_volume) + " " + state.assets.base.symbol : null;
    cell(t("market.stat_vol", "24h Vol"), bv);
    var bb = [st.highestBid, st.lowestAsk].filter(function (x) { return x !== null; }).join(" / ");
    cell(t("market.stat_bidask", "Bid–Ask"), bb || null);
  }

  /* Refresh the "N × timeframe candles" note under the timeframe radios. */
  function paintCountNote(state) {
    if (state.countNote) {
      state.countNote.textContent =
        CANDLE_COUNT + " × " + bucketLabel(state.bucket) + " candles";
    }
  }

  /* Rebuild the timeframe radios from the reconciled live bucket list. */
  function paintTimeframes(doc, state, onBucket) {
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
        paintCountNote(state);
        onBucket();
      });
      lab.appendChild(radio);
      lab.appendChild(el(doc, "span", bucketLabel(b)));
      state.tfBox.appendChild(lab);
    });
    paintCountNote(state);
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
    drawCharts: drawCharts,
    maybeDraw: maybeDraw,
    renderStrip: renderStrip,
    paintCountNote: paintCountNote,
    paintTimeframes: paintTimeframes,
    /* Shared read-only constants for the desk: bucket shortlist + candle
     * count (fill reconciliation) and pane order + indicator lookup (desk
     * checkbox wiring must match drawCharts pane order — single source). */
    PREF_BUCKETS: PREF_BUCKETS,
    CANDLE_COUNT: CANDLE_COUNT,
    OSC_ORDER: OSC_ORDER,
    ind: ind
  };
})();

if (typeof module !== "undefined") { module.exports = MarketInd; }
