/* ChartsLwc: LightweightCharts candle/oscillator panes for the DEX desk.
 * Owns: hasLightweight/lw detection, pane colors/width/hex/scale helpers,
 *   LWC row builders (toLwcCandles/lineData), price pane (drawPricePane:
 *   candles + overlay lines; volume is always its own histogram sub-pane),
 *   (drawOscPane: lines, or histogram for the Volume pane), and teardown
 *   (removePane/clearHost) plus time-scale linking across panes
 *   (linkTimeScales: scrolling one pane scrolls them all).
 *   global is absent. No chain, no storage, no signing.
 * Consumes: window.LightweightCharts UMD global (vendored, loaded BEFORE
 *   this file in index.html) plus CSS custom properties (theme colors read
 *   at draw time). The price-pane canvas fallback delegates to
 *   MarketCharts.drawPrice (lazy — the Canvas2D core stays canonical in
 *   market-charts.js); the osc-pane fallback carries private verbatim copies
 *   of the canvas helpers (fit/strokeSeries/legend/cssVar: same per-file
 *   convention as the market-ui split) so moved bodies stay byte-identical.
 * Globals/side effects: global ChartsLwc only; draws into caller host divs
 *   (LWC charts removed via removePane before re-render).
 * Created by: building-vanilla-slices skill, slice-18 audit (market-charts
 *   split — moved verbatim from market-charts.js hasLightweight→removePane;
 *   MarketCharts delegates its LWC panes here, Canvas2D core unchanged).
 *
 * PIXEL-MATH NOTE: every Math.* / Number() call below positions chart pixels
 * only. Inputs (market.js buckets, indicator arrays, OHLC human strings) are
 * Numbers/strings prepared by market-ind.js from chain-human strings; raw
 * integer money never enters. Gaps need no special casing: market.js emits a
 * uniform interpolated slot grid, so LWC bars are evenly spaced by
 * construction (whitespace only where slots genuinely carry forward).
 */
var ChartsLwc = (function () {
  "use strict";

  /* Spec'd candle colors (task interface — up #26de81 / down #ff231f).
   * Deliberately NOT theme tokens: the task pins these hues in every theme. */
  var CANDLE_UP = "#26de81";
  var CANDLE_DOWN = "#ff231f";
  var PANE_H = 320;
  var OSC_H = 170;

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

  /* Read a CSS custom property off <html> (theme-aware); fall back when the
   * property is missing (headless use, unknown theme). Private copy of the
   * market-charts.js helper for the canvas fallback below. */
  function cssVar(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fall through to fallback */ }
    return fallback;
  }

  /* Size a canvas to its layout width (300px fallback when hidden) at a fixed
   * CSS height and scale the context by devicePixelRatio for crisp lines.
   * Returns {ctx, w, h} in CSS pixels, or null when canvas is unusable.
   * Private copy of the market-charts.js helper (canvas fallback only). */
  function fit(canvas, cssH) {
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
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, cssH);
    return { ctx: ctx, w: w, h: cssH };
  }

  /* Number coercion for chart-pixel inputs (LWC points, canvas strokes):
   * plain numbers pass through; numeric STRINGS (VWAP/indicator human
   * strings, headless string bars) coerce via Number() — the String()/
   * sigFigPlaces paths upstream already traffic in strings, so refusing
   * them here would blank an all-string series even though every value is
   * plottable. Anything else (null, booleans, blank/ junk strings) is NaN:
   * a gap, never a zero — a plotted zero would invent a price. Callers
   * still gate on isFinite. Pixel coordinates only, never money. Pure. */
  function _num(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      if (v.trim() === "") return NaN;
      return Number(v);
    }
    return NaN;
  }

  /* Stroke one series, breaking the path across null/NaN gaps (warmup bars).
   * Params: g fit object, arr number[]|nulls, n total x-count, x/y mappers.
   * Private copy of the market-charts.js helper (canvas fallback only). */
  function strokeSeries(g, arr, n, x, y, color, width) {
    if (!arr) return false;
    var drew = false;
    var started = false;
    g.ctx.strokeStyle = color;
    g.ctx.lineWidth = width;
    g.ctx.beginPath();
    var i;
    for (i = 0; i < n; i++) {
      var nv = _num(arr[i]);
      if (!isFinite(nv)) {
        started = false;
        continue;
      }
      if (!started) {
        g.ctx.moveTo(x(i), y(nv));
        started = true;
      } else {
        g.ctx.lineTo(x(i), y(nv));
      }
      drew = true;
    }
    if (drew) g.ctx.stroke();
    return drew;
  }

  /* Legend swatches (no min/max labels on sub-panes). Private copy of the
   * market-charts.js helper (canvas fallback only). */
  function legend(g, entries, maxLabel, minLabel, muted) {
    var ctx = g.ctx;
    ctx.font = "11px system-ui, sans-serif";
    var x = 8;
    var i;
    for (i = 0; i < entries.length; i++) {
      ctx.fillStyle = entries[i][1];
      ctx.fillRect(x, 6, 10, 10);
      ctx.fillStyle = muted;
      ctx.fillText(entries[i][0], x + 14, 15);
      x += ctx.measureText(entries[i][0]).width + 30;
    }
    ctx.fillStyle = muted;
    ctx.textAlign = "right";
    if (maxLabel) ctx.fillText(maxLabel, g.w - 6, 15);
    if (minLabel) ctx.fillText(minLabel, g.w - 6, g.h - 6);
    ctx.textAlign = "left";
  }

  /* True when the vendored UMD build is loaded and usable (v5 API:
   * createChart + addSeries). Test seam: hiding window/globalThis.
   * LightweightCharts forces the canvas fallback path below. */
  function hasLightweight() {
    try {
      if (typeof window !== "undefined" && window && /** @type {any} */ (window).LightweightCharts &&
          typeof /** @type {any} */ (window).LightweightCharts.createChart === "function") return true;
      if (typeof globalThis !== "undefined" && /** @type {any} */ (globalThis).LightweightCharts &&
          typeof /** @type {any} */ (globalThis).LightweightCharts.createChart === "function") return true;
    } catch (e) { /* absent: fall back */ }
    return false;
  }

  /* The vendored global, or null when absent (same guards as above). */
  function lw() {
    try {
      if (typeof window !== "undefined" && window && /** @type {any} */ (window).LightweightCharts) {
        return /** @type {any} */ (window).LightweightCharts;
      }
      if (typeof globalThis !== "undefined" && /** @type {any} */ (globalThis).LightweightCharts) {
        return /** @type {any} */ (globalThis).LightweightCharts;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* Chart frame colors. The caller passes colors read from CSS vars (theme-
   * aware); fallbacks are the DEX-UX dark triple, used only headless (no CSS).
   * paneBg reads --plot-bg: plots sit on the darker content ground (#1's
   * $main-content-margin-block-bg-color #1e1e1e in ref-ui-theme), not --panel.
   * Params: passed {paneBg, grid, text} (any subset). Returns full triple. */
  function paneColors(passed) {
    passed = passed || {};
    return {
      paneBg: passed.paneBg || cssVar("--plot-bg", cssVar("--panel", "#131722")),
      grid: passed.grid || cssVar("--border", "#2a2e39"),
      text: passed.text || cssVar("--text", "#c5cbce")
    };
  }

  /* Host layout width in CSS px (300px fallback when hidden/headless). */
  function hostW(hostEl) {
    try {
      if (hostEl && hostEl.clientWidth) return hostEl.clientWidth;
      if (hostEl && hostEl.parentNode && hostEl.parentNode.clientWidth) {
        return hostEl.parentNode.clientWidth;
      }
    } catch (e) { /* fallback stands */ }
    return 300;
  }

  /* Price-scale mode: Logarithmic when logScale, else Normal. Uses the v5
   * enum when present, numeric fallback (Normal 0 / Logarithmic 1) otherwise.
   * Params: LW global, logScale bool. Returns the mode value. */
  function scaleMode(LW, logScale) {
    try {
      if (LW && LW.PriceScaleMode) {
        return logScale ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal;
      }
    } catch (e) { /* numeric fallback */ }
    return logScale ? 1 : 0;
  }

  /* Lightweight-Charts lazy loader (index.html no longer carries the 193K
   * vendor tag — dynamic script like the build-dialog ensureBuildDialog
   * precedent in about-ui.js; relative URL only, never CDN; works on
   * file:// AND http). The first chart draw paints the canvas fallback
   * immediately, then upgrades to LWC in place once loaded (per-host
   * token-guarded: only the latest draw per host upgrades). A failed load
   * goes quiet (canvas stands) — never a retry storm. Params: cb(bool).
   * Never throws. */
  var _lwLoading = false, _lwDead = false, _lwWaiters = [];
  function _lwSrc() {
    try {
      if (typeof document !== "undefined" && document.baseURI) {
        return new URL("js/sdk/vendor/lightweight-charts.standalone.production.js", document.baseURI).toString();
      }
    } catch (e) { /* relative fallback below */ }
    return "js/sdk/vendor/lightweight-charts.standalone.production.js";
  }
  function ensureLightweight(cb) {
    try {
      if (hasLightweight()) { cb(true); return; }
    } catch (e) { /* load below */ }
    if (typeof document === "undefined" || _lwDead) { try { cb(false); } catch (e2) {} return; }
    _lwWaiters.push(cb);
    if (_lwLoading) return;
    _lwLoading = true;
    try {
      var s = document.createElement("script");
      s.src = _lwSrc();
      s.async = true;
      s.onload = function () {
        _lwLoading = false;
        var ok = hasLightweight();
        var w = _lwWaiters; _lwWaiters = [];
        w.forEach(function (f) { try { f(ok); } catch (e) {} });
      };
      s.onerror = function () {
        _lwLoading = false; _lwDead = true;
        var w = _lwWaiters; _lwWaiters = [];
        w.forEach(function (f) { try { f(false); } catch (e) {} });
      };
      (document.head || document.getElementsByTagName("head")[0] || document.documentElement).appendChild(s);
    } catch (e) {
      _lwLoading = false; _lwDead = true;
      var w = _lwWaiters; _lwWaiters = [];
      w.forEach(function (f) { try { f(false); } catch (x) {} });
    }
  }

  /* Per-host draw token: each drawPricePane/drawOscPane call bumps it; the
   * lazy-upgrade redraw fires only when its token is still latest AND the
   * host is still mounted — a stale load never repaints a reused host. */
  function drawToken(hostEl) {
    try {
      hostEl._lwcToken = (hostEl._lwcToken || 0) + 1;
      return hostEl._lwcToken;
    } catch (e) { return 0; }
  }
  /* Kick the lazy LWC load after a canvas-fallback paint. Params: hostEl,
   * token (drawToken above), redraw (re-invokes the same draw). Never throws. */
  function kickUpgrade(hostEl, token, redraw) {
    try {
      ensureLightweight(function (ok) {
        if (!ok) return;
        try {
          if (hostEl._lwcToken !== token) return;
          if (typeof hostEl.isConnected === "boolean" && !hostEl.isConnected) return;
        } catch (e) { return; }
        try { redraw(); } catch (e) { /* canvas stands */ }
      });
    } catch (e) { /* canvas stands */ }
  }

  /* ohlcKey: identity of one LWC bar (tip-move detection, pixels never see
   * it). ovShape: overlay structural identity (names+colors+count — value
   * changes ride the tail update below, shape changes rebuild). mkBar: LWC
   * candle row from a toLwcCandles row. All pure, never throw. */
  function ohlcKey(b) {
    try { return b.time + "|" + b.open + "|" + b.high + "|" + b.low + "|" + b.close; }
    catch (e) { return ""; }
  }
  function ovShape(ovs) {
    try {
      var parts = [(ovs || []).length];
      for (var i = 0; i < (ovs || []).length; i++) {
        var o = ovs[i] || {};
        parts.push(o.name || ("#" + i), (typeof o.color === "string" && o.color) ? o.color : "");
      }
      return parts.join("|");
    } catch (e) { return "?"; }
  }
  function mkBar(b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }

  /* Tail-update one overlay line entry ({series, tail:{n, lv}}): skip when
   * the raw values are untouched; series.update(last point) when the tail
   * only moved/appended; full setData otherwise. Same pixels as a rebuild
   * for identical data. Never throws. */
  function updateLineTail(entry, times, values) {
    if (!entry || !entry.series) return;
    var vals = Array.isArray(values) ? values : [];
    var lv = vals.length ? vals[vals.length - 1] : null;
    var t = entry.tail;
    if (t && t.n === vals.length && t.lv === lv) return;
    var pts = lineData(times, vals);
    try {
      if (t && typeof entry.series.update === "function" &&
          (t.n === vals.length || t.n + 1 === vals.length) && pts.length) {
        entry.series.update(pts[pts.length - 1]);
      } else if (typeof entry.series.setData === "function") {
        entry.series.setData(pts);
      } else {
        return;
      }
      entry.tail = { n: vals.length, lv: lv };
    } catch (e) { /* line keeps its prior paint */ }
  }

  /* Price-axis tick formatter (global 4-sig-fig rule, Format.priceSig): the
   * axis + crosshair/last-value labels print per-tick 4-sf strings — plain
   * fixed-point when <= 9 digits, else sci (e.g. 1.234e-7). Vendored-build
   * support VERIFIED in-repo: vanilla/js/sdk/vendor/
   * lightweight-charts.standalone.production.js `case"custom"` branch reads
   * priceFormat.formatter for `format` and maps it for `formatTickmarks`
   * when tickmarksFormatter is absent (supplied explicitly anyway, so no
   * reliance on the fallback). Sub-1e-9 markets now read sci instead of
   * capping at 12 fixed decimals (the 6a18aeb 12-cap is retired for the
   * axis; candle DATA resolution still comes from candles() places, so bars
   * stay non-zero). opts.precision is accepted-but-ignored (callers still
   * thread it; harmless). Oscillator panes (drawOscPane below: RSI/MACD
   * fixed scales, volume histogram) are untouched by design.
   * Params: v (number|string tick value from LWC). Returns the label
   *   string; null/undefined -> "" (LWC never passes these; guards headless
   *   callers). Format absent -> String(v) fallback. Never throws.
   * Number()/priceSig here format chart pixels only, never money. */
  function priceTick(v) {
    try {
      if (v === null || v === undefined) return "";
      if (typeof Format !== "undefined" && Format &&
          typeof Format.priceSig === "function") {
        return Format.priceSig(String(v));
      }
    } catch (e) { /* String fallback below */ }
    try { return String(v); } catch (e2) { return ""; }
  }

  /* Tickmarks-array mapper for the custom priceFormat below (LWC calls it
   * with the axis tick array; each entry formats exactly like a single
   * crosshair label, so axis and crosshair can never disagree). Params:
   * arr (array of tick values). Returns array of label strings. Never
   * throws (non-array -> []). */
  function priceTicks(arr) {
    try {
      if (!Array.isArray(arr)) return [];
      var out = [];
      for (var i = 0; i < arr.length; i++) out.push(priceTick(arr[i]));
      return out;
    } catch (e) { return []; }
  }

  /* LWC custom price-format for the price pane (axis + last-value labels
   * follow the per-tick formatter above; no precision/minMove keys — the
   * vendored custom branch ignores them). Returns a fresh object per call
   * (LWC holds the reference; callers must not mutate the shared one). */
  function priceFormatCustom() {
    return { type: "custom", formatter: priceTick, tickmarksFormatter: priceTicks };
  }

  /* In-place price update on the previous handle's LIVE chart (the tip
   * path): same window -> series.update(lastBar); one appended bar ->
   * update appends; shifted window/bucket/count -> full setData on the
   * existing series (chart object — and its zoom — survive; only data
   * swaps). Returns true when painted in place (caller returns prev),
   * false when the caller must rebuild (dead chart, other host, theme/
   * logScale/overlay-shape change, overlay series mismatch). The axis
   * format is per-tick custom (magnitude-independent), so precision never
   * keys the frame. Never throws. */
  function tryPriceUpdate(hostEl, prev, bars, opts, colors, times) {
    try {
      if (!prev || prev.kind !== "lwc" || !prev.chart || prev.host !== hostEl) return false;
      if (!prev.candle || typeof prev.candle.setData !== "function") return false;
      try {
        if (!prev.chart.timeScale || typeof prev.chart.timeScale !== "function") return false;
        prev.chart.timeScale();
      } catch (e) { return false; }
      var ck = prev.key;
      if (!ck) return false;
      var ovs = Array.isArray(opts.overlays) ? opts.overlays : [];
      var frame = (colors.paneBg || "") + "|" + (colors.grid || "") + "|" +
        (colors.text || "") + "|" + (!!opts.logScale ? "log" : "lin") + "|custom";
      if (ck.frame !== frame || ck.ovShape !== ovShape(ovs)) return false;
      /* Overlay/series alignment: an overlay that gained (or lost) array
       * values needs a real rebuild (series set differs). */
      var c;
      for (c = 0; c < ovs.length; c++) {
        var hasVals = Array.isArray((ovs[c] || {}).values);
        var hasSeries = !!(prev.lines && prev.lines[c] && prev.lines[c].series);
        if (hasVals !== hasSeries) return false;
      }
      var last = bars[bars.length - 1];
      if (typeof prev.candle.update !== "function") return false;
      if (ck.n === bars.length && ck.first === bars[0].time && ck.last === last.time) {
        if (ck.lastOhlc !== ohlcKey(last)) {
          prev.candle.update(mkBar(last));
          ck.lastOhlc = ohlcKey(last);
        }
        for (c = 0; c < ovs.length; c++) {
          updateLineTail(prev.lines[c], times, (ovs[c] || {}).values);
        }
        return true;
      }
      if (ck.n + 1 === bars.length && ck.first === bars[0].time &&
          ck.last === bars[bars.length - 2].time) {
        prev.candle.update(mkBar(last));
        ck.n = bars.length; ck.last = last.time; ck.lastOhlc = ohlcKey(last);
        for (c = 0; c < ovs.length; c++) {
          updateLineTail(prev.lines[c], times, (ovs[c] || {}).values);
        }
        return true;
      }
      prev.candle.setData(bars.map(mkBar));
      for (c = 0; c < ovs.length; c++) {
        var e2 = prev.lines[c];
        try {
          if (e2 && e2.series && typeof e2.series.setData === "function") {
            var vv = (ovs[c] || {}).values;
            e2.series.setData(lineData(times, vv));
            e2.tail = { n: Array.isArray(vv) ? vv.length : 0,
              lv: (Array.isArray(vv) && vv.length) ? vv[vv.length - 1] : null };
          }
        } catch (e3) { /* line keeps its prior paint */ }
      }
      prev.key = { n: bars.length, first: bars[0].time, last: last.time,
        lastOhlc: ohlcKey(last), frame: frame, ovShape: ovShape(ovs) };
      return true;
    } catch (e) { return false; }
  }
  /* Muted centered empty-state div; panes never render blank. */
  function emptyPane(doc, hostEl, text) {
    var d = doc.createElement("div");
    d.className = "mkt-chart-empty muted";
    d.textContent = text || (t("market.empty_pane", "No data.") + t("market.buckets_hint", " Buckets appear once this market has fills — try another pair from the market picker."));
    hostEl.appendChild(d);
  }

  /* Tear down a previous pane in a host: LWC chart.remove() first (frees its
   * canvas + listeners), then empty the host. Params: hostEl, previous handle
   * (may be null). Never throws (redraw must survive teardown races). */
  function clearHost(hostEl, previous) {
    try {
      if (previous && previous.chart &&
          typeof previous.chart.remove === "function") {
        previous.chart.remove();
      }
    } catch (e) { /* already gone */ }
    try {
      while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
    } catch (e) { /* headless host */ }
  }

  /* Zoom memory: capture the visible logical range of a live handle's
   * chart before a rebuild destroys it. Params: handle (previous draw
   * handle). Returns {from, to} or null. Never throws. */
  function savedRange(handle) {
    try {
      if (handle && handle.chart && handle.chart.timeScale &&
          typeof handle.chart.timeScale().getVisibleLogicalRange === "function") {
        var r = handle.chart.timeScale().getVisibleLogicalRange();
        if (r && isFinite(r.from) && isFinite(r.to) && r.to > r.from) {
          return { from: r.from, to: r.to };
        }
      }
    } catch (e) { /* no memory */ }
    return null;
  }

  /* Restore a captured range onto a fresh chart after setData (zoom stops
   * resetting on every repaint: toggles, theme, resize, live-tip refresh).
   * No-op when nothing was captured or the chart rejects it (fresh
   * fit-content stands). Never throws. */
  function restoreRange(chart, range) {
    if (!range) return;
    try {
      if (chart && chart.timeScale &&
          typeof chart.timeScale().setVisibleLogicalRange === "function") {
        chart.timeScale().setVisibleLogicalRange(range);
      }
    } catch (e) { /* fresh fit stands */ }
  }

  /* market.js buckets -> LWC candle rows. Number()/Math.floor here are
   * CHART-PIXEL inputs only (Global Constraints): OHLC human strings become
   * coordinates; epoch slot math is time, not money. Malformed bars are
   * skipped (never plotted as zero-candles). Returns ascending-time rows. */
  function toLwcCandles(buckets) {
    var out = [];
    var i;
    for (i = 0; i < (buckets || []).length; i++) {
      var b = buckets[i] || {};
      var t = Math.floor((b.timeMs || 0) / 1000);
      var o = Number(b.open), h = Number(b.high);
      var l = Number(b.low), c = Number(b.close);
      if (!(t > 0)) continue;
      if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
      out.push({ time: t, open: o, high: h, low: l, close: c });
    }
    return out;
  }

  /* Aligned values[] -> LWC line points, skipping warmup nulls/NaNs so the
   * overlay breaks across gaps instead of diving to zero. Numeric strings
   * coerce via _num above (all-string overlay bars plot, they never blank
   * the pane). Pixel math only. */
  function lineData(times, values) {
    var out = [];
    var i;
    for (i = 0; i < times.length && i < values.length; i++) {
      var nv = _num(values[i]);
      if (!isFinite(nv)) continue;
      out.push({ time: times[i], value: nv });
    }
    return out;
  }

  /* Price pane: candles + overlay lines. Volume lives in its OWN sub-pane
   * (drawOscPane with histogram:true), never overlaid here — one scale per
   * pane, always.
   * Params: doc; hostEl (emptied first — pass the previous handle in
   *   opts.previous for LWC teardown); opts {candles: market.js buckets,
   *   overlays: [{name, color, values}] aligned to candles, logScale: bool,
   *   precision: candles() places (accepted-but-ignored: DATA resolution
   *   lives upstream; the axis is per-tick custom 4-sf/sci), colors: {paneBg,
   *   grid, text}, emptyText}.
   * Returns a pane handle ({kind: "lwc"|"canvas"|"none", chart?}) for
   * removePane. Without the vendored global, falls back to the legacy canvas
   * line renderer (MarketCharts.drawPrice: closes + first two overlays as
   * SMA/EMA legs) — that path is what the hidden-global headless check
   * exercises. */
  function drawPricePane(doc, hostEl, opts) {
    opts = opts || {};
    var handle = { kind: "none", chart: null };
    if (!hostEl) return handle;
    var colors = paneColors(opts.colors);
    var bars = toLwcCandles(opts.candles);
    if (bars.length === 0) {
      clearHost(hostEl, opts.previous);
      drawToken(hostEl); /* retire any pending lazy upgrade from an older draw */
      if (doc) emptyPane(doc, hostEl, opts.emptyText || (t("market.no_price_history", "No price history on this market.") + t("market.fills_line_hint", " Fills draw this line — place an order or try another pair.")));
      return handle;
    }
    var times = bars.map(function (b) { return b.time; });
    var LW = hasLightweight() ? lw() : null;
    if (!LW) {
      clearHost(hostEl, opts.previous);
      var token0 = drawToken(hostEl);
      var canvas = doc ? doc.createElement("canvas") : null;
      if (!canvas) return handle;
      canvas.className = "mkt-canvas";
      hostEl.appendChild(canvas);
      var closes = bars.map(function (b) { return b.close; });
      var ovs = Array.isArray(opts.overlays) ? opts.overlays : [];
      var sma = (ovs.length > 0 && Array.isArray(ovs[0].values)) ? ovs[0].values : null;
      var ema = (ovs.length > 1 && Array.isArray(ovs[1].values)) ? ovs[1].values : null;
      if (typeof MarketCharts !== "undefined" && MarketCharts &&
          typeof MarketCharts.drawPrice === "function") {
        MarketCharts.drawPrice(canvas, closes, sma, ema,
          { max: null, min: null }, opts.emptyText);
      }
      handle.kind = "canvas";
      /* Lazy upgrade: the vendor script loads behind first chart use; when
       * it lands, this same draw re-runs in place (token-guarded). */
      kickUpgrade(hostEl, token0, function () { drawPricePane(doc, hostEl, opts); });
      return handle;
    }
    /* Tip path: keep the chart instance across redraws — series.update on
     * the live last bar, full setData only on bucket/count/window change
     * (tryPriceUpdate decides; false falls through to the rebuild below). */
    if (tryPriceUpdate(hostEl, opts.previous, bars, opts, colors, times)) {
      return opts.previous;
    }
    var keep = savedRange(opts.previous);
    clearHost(hostEl, opts.previous);
    drawToken(hostEl);
    var crossMode = 0;
    try {
      if (LW.CrosshairMode) crossMode = LW.CrosshairMode.Normal;
    } catch (e) { /* default stands */ }
    var chart = LW.createChart(hostEl, {
      width: hostW(hostEl),
      height: PANE_H,
      layout: { background: { color: colors.paneBg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      crosshair: { mode: crossMode },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 2 },
      rightPriceScale: { mode: scaleMode(LW, !!opts.logScale) }
    });
    /* Axis format: per-tick custom 4-sf/sci via Format.priceSig (priceTick
     * above) on the candlestick AND every overlay line sharing the price
     * scale — axis ticks, last-value and crosshair labels all read the same
     * strings. opts.precision (candles() places) is accepted-but-ignored:
     * it still governs candle DATA resolution upstream, never the axis.
     * Oscillator panes (drawOscPane below: RSI/MACD fixed scales) are
     * untouched by design. */
    var candleOpts = {
      upColor: CANDLE_UP, downColor: CANDLE_DOWN,
      wickUpColor: CANDLE_UP, wickDownColor: CANDLE_DOWN,
      borderVisible: false,
      priceFormat: priceFormatCustom()
    };
    var series = chart.addSeries(LW.CandlestickSeries, candleOpts);
    series.setData(bars.map(function (b) {
      return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };
    }));
    var ovs2 = Array.isArray(opts.overlays) ? opts.overlays : [];
    var i;
    var lines = [];
    for (i = 0; i < ovs2.length; i++) {
      var ov = ovs2[i] || {};
      if (!Array.isArray(ov.values)) { lines.push({ series: null, tail: null }); continue; }
      var lineOpts = {
        color: (typeof ov.color === "string" && ov.color) ? ov.color : colors.text,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: priceFormatCustom()
      };
      var line = chart.addSeries(LW.LineSeries, lineOpts);
      line.setData(lineData(times, ov.values));
      lines.push({ series: line,
        tail: { n: ov.values.length, lv: ov.values.length ? ov.values[ov.values.length - 1] : null } });
    }
    restoreRange(chart, keep);
    handle.kind = "lwc";
    handle.chart = chart;
    /* Tip-update cache (tryPriceUpdate above): host identity, live candle
     * series, per-overlay line entries, and the data/frame key. Plain
     * fields on the caller-held handle — removePane/linkTimeScales only
     * read kind/chart, so they are unaffected. */
    handle.host = hostEl;
    handle.candle = series;
    handle.lines = lines;
    handle.key = { n: bars.length, first: bars[0].time, last: times[times.length - 1],
      lastOhlc: ohlcKey(bars[bars.length - 1]),
      frame: (colors.paneBg || "") + "|" + (colors.grid || "") + "|" +
        (colors.text || "") + "|" + (!!opts.logScale ? "log" : "lin") + "|custom",
      ovShape: ovShape(ovs2) };
    return handle;
  }

  /* ONE oscillator sub-pane of a stack (Task 4b: the caller renders one pane
   * per checked indicator, each with its OWN chart — never shared, because
   * RSI (0-100) and ATR (price-scale) ranges are incompatible).
   * Params: doc; hostEl; opts {times: unix seconds aligned to series values,
   *   series: [{name, color, values}], colors, emptyText, histogram: bool}.
   * LWC path renders one LineSeries per entry, or (histogram:true, the Volume
   *   pane) one HistogramSeries per entry; the canvas fallback always strokes
   *   line charts over the pane's own pixel range with a legend (same visual
   *   language for every pane, volume included). */
  function drawOscPane(doc, hostEl, opts) {
    opts = opts || {};
    var handle = { kind: "none", chart: null };
    if (!hostEl) return handle;
    var keep = savedRange(opts.previous);
    clearHost(hostEl, opts.previous);
    var colors = paneColors(opts.colors);
    var times = Array.isArray(opts.times) ? opts.times : [];
    var entries = Array.isArray(opts.series) ? opts.series : [];
    var i, k;
    var anyPts = false;
    for (i = 0; i < entries.length; i++) {
      var vals = entries[i] ? entries[i].values : null;
      if (!Array.isArray(vals)) continue;
      for (k = 0; k < vals.length && k < times.length; k++) {
        if (isFinite(_num(vals[k]))) { anyPts = true; break; }
      }
      if (anyPts) break;
    }
    if (!anyPts) {
      drawToken(hostEl); /* retire any pending lazy upgrade from an older draw */
      if (doc) emptyPane(doc, hostEl, opts.emptyText || (t("market.no_osc_data", "No oscillator data.") + t("market.osc_hint", " Values compute once this market has price history.")));
      return handle;
    }
    var LW = hasLightweight() ? lw() : null;
    if (!LW) {
      var canvas = doc ? doc.createElement("canvas") : null;
      if (!canvas) return handle;
      canvas.className = "mkt-canvas";
      hostEl.appendChild(canvas);
      var g = fit(canvas, OSC_H);
      if (!g) return handle;
      var min = Infinity, max = -Infinity, n = 0;
      for (i = 0; i < entries.length; i++) {
        var arr = entries[i] ? entries[i].values : null;
        if (!Array.isArray(arr)) continue;
        if (arr.length > n) n = arr.length;
        for (k = 0; k < arr.length; k++) {
          var av = _num(arr[k]);
          if (isFinite(av)) {
            if (av < min) min = av;
            if (av > max) max = av;
          }
        }
      }
      if (!(max > min)) { max = min + 1; min = min - 1; }
      var padL = 8, padR = 8, padT = 24, padB = 18;
      var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
      function ox(j) { return padL + (n <= 1 ? plotW / 2 : (j * plotW) / (n - 1)); }
      function oy(v) { return padT + (1 - (v - min) / (max - min)) * plotH; }
      var names = [];
      for (i = 0; i < entries.length; i++) {
        var e = entries[i] || {};
        var col = (typeof e.color === "string" && e.color) ? e.color : colors.text;
        if (strokeSeries(g, e.values, n, ox, oy, col, 1.5)) {
          names.push([e.name || ("Series " + (i + 1)), col]);
        }
      }
      legend(g, names, null, null, colors.text);
      handle.kind = "canvas";
      /* Lazy upgrade (price-pane contract): reload the vendor build behind
       * first use, then redraw this same pane in place when it is still
       * the host's latest draw. */
      (function () {
        var tok = drawToken(hostEl);
        kickUpgrade(hostEl, tok, function () { drawOscPane(doc, hostEl, opts); });
      })();
      return handle;
    }
    drawToken(hostEl); /* a live LWC paint retires any pending canvas-era upgrade */
    var crossMode = 0;
    try {
      if (LW.CrosshairMode) crossMode = LW.CrosshairMode.Normal;
    } catch (e) { /* default stands */ }
    var chart = LW.createChart(hostEl, {
      width: hostW(hostEl),
      height: OSC_H,
      layout: { background: { color: colors.paneBg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      crosshair: { mode: crossMode },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 2 }
    });
    /* Volume pane (histogram:true): one HistogramSeries per entry — base
     * volume bars on the pane's OWN scale, never the price scale. Every
     * other pane takes the line path below. Falls back to lines when the
     * vendored build lacks HistogramSeries (never throws the desk away). */
    if (opts.histogram) {
      for (i = 0; i < entries.length; i++) {
        var h = entries[i] || {};
        if (!Array.isArray(h.values)) continue;
        var hcol = (typeof h.color === "string" && h.color) ? h.color : colors.text;
        var hist;
        if (LW.HistogramSeries) {
          hist = chart.addSeries(LW.HistogramSeries, {
            color: hcol,
            priceLineVisible: false,
            lastValueVisible: false
          });
        } else {
          hist = chart.addSeries(LW.LineSeries, {
            color: hcol,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false
          });
        }
        hist.setData(lineData(times, h.values));
      }
    } else {
      for (i = 0; i < entries.length; i++) {
        var s = entries[i] || {};
        if (!Array.isArray(s.values)) continue;
        var ls = chart.addSeries(LW.LineSeries, {
          color: (typeof s.color === "string" && s.color) ? s.color : colors.text,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        ls.setData(lineData(times, s.values));
      }
    }
    restoreRange(chart, keep);
    handle.kind = "lwc";
    handle.chart = chart;
    return handle;
  }

  /* Release a pane handle from drawPricePane/drawOscPane (LWC remove + DOM
   * clear is done by the next draw via opts.previous; this is for teardown
   * paths like route change). Params: handle (may be null). Never throws. */
  function removePane(handle) {
    try {
      if (handle && handle.chart &&
          typeof handle.chart.remove === "function") {
        handle.chart.remove();
      }
    } catch (e) { /* already gone */ }
  }

  /* Link several LWC charts' time scales so scrolling/zooming one scrolls
   * them all (price pane + oscillator sub-panes share bar indices — every
   * pane is fed the same times array — so a LOGICAL range {from, to} means
   * the same bars on each chart; price scales stay independent per pane).
   * Params: charts (array of LWC chart objects; nulls and non-LWC entries
   *   are skipped). Returns an unlink function (no-op when <2 linkable).
   *   Reentrancy: setVisibleLogicalRange fires the target's own subscriber,
   *   so a shared flag swallows the echo (else A→B→A loops). A null range
   *   (chart with no data) never propagates. Never throws — sync is
   *   best-effort chrome, the panes draw fine unlinked. */
  function linkTimeScales(charts) {
    var noop = function () { /* unlinked */ };
    try {
      var live = (Array.isArray(charts) ? charts : []).filter(function (c) {
        try {
          return !!c && c.timeScale &&
            typeof c.timeScale === "function" &&
            typeof c.timeScale().subscribeVisibleLogicalRangeChange === "function" &&
            typeof c.timeScale().setVisibleLogicalRange === "function";
        } catch (e) { return false; }
      });
      if (live.length < 2) return noop;
      var syncing = false;
      var subs = live.map(function (src) {
        /* handler: fan one pane's visible range to the other linked panes
         * (re-entrancy guarded by syncing; one stuck pane never blocks). */
        var handler = function (range) {
          if (syncing || !range) return;
          syncing = true;
          try {
            live.forEach(function (dst) {
              if (dst === src) return;
              try { dst.timeScale().setVisibleLogicalRange(range); }
              catch (e) { /* one stuck pane never blocks the rest */ }
            });
          } finally {
            syncing = false;
          }
        };
        try { src.timeScale().subscribeVisibleLogicalRangeChange(handler); }
        catch (e) { handler = null; }
        return { chart: src, handler: handler };
      });
      return function unlink() {
        subs.forEach(function (s) {
          try {
            if (s.handler) s.chart.timeScale().unsubscribeVisibleLogicalRangeChange(s.handler);
          } catch (e) { /* already gone */ }
        });
      };
    } catch (e) { return noop; }
  }

  return {
    drawPricePane: drawPricePane,
    drawOscPane: drawOscPane,
    removePane: removePane,
    linkTimeScales: linkTimeScales,
    hasLightweight: hasLightweight,
    _test: { savedRange: savedRange, restoreRange: restoreRange, priceTick: priceTick, priceFormatCustom: priceFormatCustom, lineData: lineData }
  };
})();

if (typeof module !== "undefined") { module.exports = ChartsLwc; }
