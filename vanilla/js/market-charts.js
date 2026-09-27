/* MarketCharts: Canvas2D price + depth renderers for the read-only DEX desk,
 *   plus LightweightCharts candle/oscillator panes (slice-07 Task 4).
 * Owns: devicePixelRatio-aware line/area drawing, min/max labels, legends,
 *   empty-state text; LWC price pane (candles + volume + overlays) and
 *   STACKED oscillator sub-panes (Task 4b: one chart per active indicator,
 *   each with an independent scale — never shared), with canvas fallback
 *   when the vendored global is absent. No chain, no storage, no signing.
 * Consumes: nothing but CSS custom properties (theme colors read at draw
 *   time, so a theme switch only needs a redraw, never new code) plus the
 *   optional window.LightweightCharts UMD global (vendored, loaded BEFORE
 *   this file in index.html). Callers pass frame colors in; candle up/down
 *   are the task-spec'd constants, not theme tokens.
 * Globals/side effects: global MarketCharts only; draws into caller canvases
 *   and host divs (LWC charts removed via removePane before re-render).
 * Created by: building-vanilla-slices skill, slice-05-exchange-read plan Task 3.
 * Extended by: slice-07 Task 4 (drawPricePane/drawOscPane/removePane/
 *   hasLightweight; drawPrice/drawDepth kept byte-identical as fallback).
 * Extended by: slice-07 Task 4b (stacked sub-panes: drawOscPane is one pane
 *   of a stack — caller renders one per checked indicator with its own chart
 *   for an independent scale; opts.histogram selects the HistogramSeries LWC
 *   path for the Volume pane, canvas fallback stays a line chart).
 *
 * PIXEL-MATH NOTE: every Math.* / Number() call below positions chart pixels
 * only. Inputs (closes, indicator arrays, depth points, OHLC human strings)
 * are Numbers/strings prepared by market-ui.js from chain-human strings; raw
 * integer money never enters. Gaps need no special casing: market.js emits a
 * uniform interpolated slot grid, so LWC bars are evenly spaced by
 * construction (whitespace only where slots genuinely carry forward).
 */
var MarketCharts = (function () {
  "use strict";

  var PRICE_H = 220;
  var DEPTH_H = 180;

  /* Read a CSS custom property off <html> (theme-aware); fall back when the
   * property is missing (headless use, unknown theme). */
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
   * Returns {ctx, w, h} in CSS pixels, or null when canvas is unusable. */
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

  /* Indices of finite values; indicator warmup nulls never reach pixel math. */
  function finiteIdx(arr) {
    var out = [];
    var i;
    for (i = 0; i < arr.length; i++) {
      if (typeof arr[i] === "number" && isFinite(arr[i])) out.push(i);
    }
    return out;
  }

  /* Stroke one series, breaking the path across null/NaN gaps (warmup bars).
   * Params: g fit object, arr number[]|nulls, n total x-count, x/y mappers. */
  function strokeSeries(g, arr, n, x, y, color, width) {
    if (!arr) return false;
    var drew = false;
    var started = false;
    g.ctx.strokeStyle = color;
    g.ctx.lineWidth = width;
    g.ctx.beginPath();
    var i;
    for (i = 0; i < n; i++) {
      var v = arr[i];
      if (typeof v !== "number" || !isFinite(v)) {
        started = false;
        continue;
      }
      if (!started) {
        g.ctx.moveTo(x(i), y(v));
        started = true;
      } else {
        g.ctx.lineTo(x(i), y(v));
      }
      drew = true;
    }
    if (drew) g.ctx.stroke();
    return drew;
  }

  /* Legend swatches + min/max labels (human strings from the caller, drawn
   * verbatim — never recomputed here). */
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

  /* Price panel: closes line + SMA/EMA overlays + legend.
   * Params: canvas element; closes/sma/ema number arrays (nulls allowed);
   *   labels {max, min} exact human price strings; emptyText fallback.
   * Empty closes render centered muted text, never a blank canvas. */
  function drawPrice(canvas, closes, sma, ema, labels, emptyText) {
    var g = fit(canvas, PRICE_H);
    if (!g) return;
    labels = labels || {};
    var muted = cssVar("--muted", "#777777");
    var idx = Array.isArray(closes) ? finiteIdx(closes) : [];
    if (idx.length === 0) {
      g.ctx.fillStyle = muted;
      g.ctx.font = "13px system-ui, sans-serif";
      g.ctx.textAlign = "center";
      g.ctx.fillText(emptyText || "No price history.", g.w / 2, g.h / 2);
      g.ctx.textAlign = "left";
      return;
    }
    var n = closes.length;
    var min = Infinity, max = -Infinity, k;
    for (k = 0; k < idx.length; k++) {
      var v = closes[idx[k]];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!(max > min)) {
      /* Flat book: widen the pixel range so the line stays visible. */
      max = min + 1;
      min = min - 1;
    }
    var padL = 8, padR = 8, padT = 24, padB = 18;
    var plotW = g.w - padL - padR;
    var plotH = g.h - padT - padB;
    function x(i) {
      return padL + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
    }
    function y(val) {
      return padT + (1 - (val - min) / (max - min)) * plotH;
    }
    var accent = cssVar("--accent", "#337ab7");
    var buy = cssVar("--buy", "#22d173");
    var sell = cssVar("--sell", "#e3745b");
    strokeSeries(g, closes, n, x, y, accent, 2);
    var entries = [["Close", accent]];
    if (strokeSeries(g, sma, n, x, y, buy, 1.5)) entries.push(["SMA10", buy]);
    if (strokeSeries(g, ema, n, x, y, sell, 1.5)) entries.push(["EMA50", sell]);
    legend(g, entries, labels.max || null, labels.min || null, muted);
  }

  /* Depth panel: cumulative bid/ask areas over price.
   * Params: canvas; bids/asks arrays of {priceFloat, totalBase} (Numbers for
   *   pixels, prepared by Market.depth); labels {low, high} exact strings.
   * Empty sides render centered muted text, never a blank canvas. */
  function drawDepth(canvas, bids, asks, labels, emptyText) {
    var g = fit(canvas, DEPTH_H);
    if (!g) return;
    labels = labels || {};
    var muted = cssVar("--muted", "#777777");
    bids = Array.isArray(bids) ? bids : [];
    asks = Array.isArray(asks) ? asks : [];
    var all = bids.concat(asks);
    var px = [];
    var pmax = -Infinity, tmax = -Infinity, pmin = Infinity;
    var i;
    for (i = 0; i < all.length; i++) {
      var p = all[i] ? all[i].priceFloat : NaN;
      var t = all[i] ? all[i].totalBase : NaN;
      if (typeof p !== "number" || !isFinite(p)) continue;
      if (typeof t !== "number" || !isFinite(t)) continue;
      px.push(all[i]);
      if (p < pmin) pmin = p;
      if (p > pmax) pmax = p;
      if (t > tmax) tmax = t;
    }
    if (px.length === 0) {
      g.ctx.fillStyle = muted;
      g.ctx.font = "13px system-ui, sans-serif";
      g.ctx.textAlign = "center";
      g.ctx.fillText(emptyText || "No depth data.", g.w / 2, g.h / 2);
      g.ctx.textAlign = "left";
      return;
    }
    if (!(pmax > pmin)) {
      pmax = pmin + 1;
      pmin = pmin - 1;
    }
    if (!(tmax > 0)) tmax = 1;
    var padL = 8, padR = 8, padT = 24, padB = 18;
    var plotW = g.w - padL - padR;
    var plotH = g.h - padT - padB;
    function x(val) {
      return padL + ((val - pmin) / (pmax - pmin)) * plotW;
    }
    function y(val) {
      return padT + (1 - val / tmax) * plotH;
    }
    var buy = cssVar("--buy", "#22d173");
    var sell = cssVar("--sell", "#e3745b");
    var ctx = g.ctx;
    function area(side, color) {
      var pts = [];
      var j;
      for (j = 0; j < side.length; j++) {
        var q = side[j] ? side[j].priceFloat : NaN;
        var t = side[j] ? side[j].totalBase : NaN;
        if (typeof q !== "number" || !isFinite(q)) continue;
        if (typeof t !== "number" || !isFinite(t)) continue;
        pts.push(side[j]);
      }
      if (pts.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(x(pts[0].priceFloat), y(0));
      for (j = 0; j < pts.length; j++) ctx.lineTo(x(pts[j].priceFloat), y(pts[j].totalBase));
      ctx.lineTo(x(pts[pts.length - 1].priceFloat), y(0));
      ctx.closePath();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (j = 0; j < pts.length; j++) {
        if (j === 0) ctx.moveTo(x(pts[j].priceFloat), y(pts[j].totalBase));
        else ctx.lineTo(x(pts[j].priceFloat), y(pts[j].totalBase));
      }
      ctx.stroke();
    }
    area(bids, buy);
    area(asks, sell);
    legend(g, [["Bid", buy], ["Ask", sell]], labels.high || null, labels.low || null, muted);
  }

  /* --- Slice-07 Task 4: LightweightCharts panes (canvas fallback retained) --- */

  /* Spec'd candle colors (task interface — up #26de81 / down #ff231f).
   * Deliberately NOT theme tokens: the task pins these hues in every theme. */
  var CANDLE_UP = "#26de81";
  var CANDLE_DOWN = "#ff231f";
  var PANE_H = 320;
  var OSC_H = 170;

  /* True when the vendored UMD build is loaded and usable (v5 API:
   * createChart + addSeries). Test seam: hiding window/globalThis.
   * LightweightCharts forces the canvas fallback path below. */
  function hasLightweight() {
    try {
      if (typeof window !== "undefined" && window && window.LightweightCharts &&
          typeof window.LightweightCharts.createChart === "function") return true;
      if (typeof globalThis !== "undefined" && globalThis.LightweightCharts &&
          typeof globalThis.LightweightCharts.createChart === "function") return true;
    } catch (e) { /* absent: fall back */ }
    return false;
  }

  /* The vendored global, or null when absent (same guards as above). */
  function lw() {
    try {
      if (typeof window !== "undefined" && window && window.LightweightCharts) {
        return window.LightweightCharts;
      }
      if (typeof globalThis !== "undefined" && globalThis.LightweightCharts) {
        return globalThis.LightweightCharts;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* Chart frame colors. The caller passes colors read from CSS vars (theme-
   * aware); fallbacks are the DEX-UX dark triple, used only headless (no CSS).
   * Params: passed {paneBg, grid, text} (any subset). Returns full triple. */
  function paneColors(passed) {
    passed = passed || {};
    return {
      paneBg: passed.paneBg || cssVar("--panel", "#131722"),
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

  /* "#rrggbb" + alpha -> "rgba(r,g,b,a)" for volume bars (pixel styling). */
  function hexA(hex, alpha) {
    var m = typeof hex === "string" ? /^#([0-9a-fA-F]{6})$/.exec(hex) : null;
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," +
      (n & 255) + "," + alpha + ")";
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

  /* Muted centered empty-state div; panes never render blank. */
  function emptyPane(doc, hostEl, text) {
    var d = doc.createElement("div");
    d.className = "mkt-chart-empty muted";
    d.textContent = text || "No data.";
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
      var v = Number(b.baseVolume);
      out.push({
        time: t, open: o, high: h, low: l, close: c,
        red: !!b.red, vol: (isFinite(v) && v > 0) ? v : 0
      });
    }
    return out;
  }

  /* Aligned values[] -> LWC line points, skipping warmup nulls/NaNs so the
   * overlay breaks across gaps instead of diving to zero. Pixel math only. */
  function lineData(times, values) {
    var out = [];
    var i;
    for (i = 0; i < times.length && i < values.length; i++) {
      var v = values[i];
      if (typeof v !== "number" || !isFinite(v)) continue;
      out.push({ time: times[i], value: v });
    }
    return out;
  }

  /* Price pane: candles + volume + overlay lines.
   * Params: doc; hostEl (emptied first — pass the previous handle in
   *   opts.previous for LWC teardown); opts {candles: market.js buckets,
   *   overlays: [{name, color, values}] aligned to candles, logScale: bool,
   *   colors: {paneBg, grid, text}, emptyText}.
   * Returns a pane handle ({kind: "lwc"|"canvas"|"none", chart?}) for
   * removePane. Without the vendored global, falls back to the legacy canvas
   * line renderer (closes + first two overlays as SMA/EMA legs) — that path
   * is what the hidden-global headless check exercises. */
  function drawPricePane(doc, hostEl, opts) {
    opts = opts || {};
    var handle = { kind: "none", chart: null };
    if (!hostEl) return handle;
    clearHost(hostEl, opts.previous);
    var colors = paneColors(opts.colors);
    var bars = toLwcCandles(opts.candles);
    if (bars.length === 0) {
      if (doc) emptyPane(doc, hostEl, opts.emptyText || "No price history on this market.");
      return handle;
    }
    var LW = hasLightweight() ? lw() : null;
    if (!LW) {
      var canvas = doc ? doc.createElement("canvas") : null;
      if (!canvas) return handle;
      canvas.className = "mkt-canvas";
      hostEl.appendChild(canvas);
      var closes = bars.map(function (b) { return b.close; });
      var ovs = Array.isArray(opts.overlays) ? opts.overlays : [];
      var sma = (ovs.length > 0 && Array.isArray(ovs[0].values)) ? ovs[0].values : null;
      var ema = (ovs.length > 1 && Array.isArray(ovs[1].values)) ? ovs[1].values : null;
      drawPrice(canvas, closes, sma, ema,
        { max: null, min: null }, opts.emptyText);
      handle.kind = "canvas";
      return handle;
    }
    var times = bars.map(function (b) { return b.time; });
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
    var series = chart.addSeries(LW.CandlestickSeries, {
      upColor: CANDLE_UP, downColor: CANDLE_DOWN,
      wickUpColor: CANDLE_UP, wickDownColor: CANDLE_DOWN,
      borderVisible: false
    });
    series.setData(bars.map(function (b) {
      return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };
    }));
    var vols = chart.addSeries(LW.HistogramSeries, {
      priceScaleId: "", priceFormat: { type: "volume" }
    });
    vols.setData(bars.map(function (b) {
      return {
        time: b.time, value: b.vol,
        color: b.red ? hexA(CANDLE_DOWN, 0.5) : hexA(CANDLE_UP, 0.5)
      };
    }));
    var ovs2 = Array.isArray(opts.overlays) ? opts.overlays : [];
    var i;
    for (i = 0; i < ovs2.length; i++) {
      var ov = ovs2[i] || {};
      if (!Array.isArray(ov.values)) continue;
      var line = chart.addSeries(LW.LineSeries, {
        color: (typeof ov.color === "string" && ov.color) ? ov.color : colors.text,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
      line.setData(lineData(times, ov.values));
    }
    handle.kind = "lwc";
    handle.chart = chart;
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
        if (typeof vals[k] === "number" && isFinite(vals[k])) { anyPts = true; break; }
      }
      if (anyPts) break;
    }
    if (!anyPts) {
      if (doc) emptyPane(doc, hostEl, opts.emptyText || "No oscillator data.");
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
          if (typeof arr[k] === "number" && isFinite(arr[k])) {
            if (arr[k] < min) min = arr[k];
            if (arr[k] > max) max = arr[k];
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
      return handle;
    }
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

  return {
    drawPrice: drawPrice,
    drawDepth: drawDepth,
    drawPricePane: drawPricePane,
    drawOscPane: drawOscPane,
    removePane: removePane,
    hasLightweight: hasLightweight
  };
})();

if (typeof module !== "undefined") { module.exports = MarketCharts; }
