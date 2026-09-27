/* MarketInd: chart data prep + pane rendering for the DEX desk (timeframes,
 *   stats strip, overlays, stacked oscillator panes, depth).
 * Owns: timeframe bucket constants + bucketLabel, theme chart colors
 *   (readVar/themeChartColors), indicator lookup (ind), pixel converters
 *   (numOrNull/numOrNaN — chart-pixel inputs only, kept next to the fill path
 *   they serve), price overlays (priceOverlays), one-pane series builder
 *   (oscOne), header stats strip (renderStrip), candle-count note
 *   (paintCountNote), timeframe radios (paintTimeframes), chart cache +
 *   redraw (maybeDraw/drawCharts). No fetching, no timers, no signing.
 * Consumes: MarketCharts.drawPricePane/drawOscPane/drawDepth/removePane (via
 *   global), Indicators.* (via ind(), guarded — null means unavailable).
 * Globals/side effects: DOM under caller-provided hosts only (price/osc hosts
 *   owned by the desk's state object, never stored here); global MarketInd
 *   only. bucketLabel/paintTimeframes take an onBucket callback for refetch so
 *   this file never calls the desk's fill (one-way dependency: desk → ind).
 * Created by: building-vanilla-slices skill, slice-18 audit (market-ui split —
 *   moved verbatim from market-ui.js strip/cell/timeframe/overlay/draw bodies;
 *   fill-nested helpers re-parameterized to (doc, state), bodies unchanged).
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
      state.strip.appendChild(el(doc, "span", "Loading stats…", "muted"));
      return;
    }
    /* One label/value chip appended to the strip (missing values show —). */
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
