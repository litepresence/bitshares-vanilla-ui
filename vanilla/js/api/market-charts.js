/* MarketCharts: Canvas2D price + depth renderers for the read-only DEX desk
 *   (canonical core) + stable LWC pane entry points (delegated, slice-18).
 * Owns: devicePixelRatio-aware line/area drawing, min/max labels, legends,
 *   empty-state text (drawPrice/drawDepth, kept byte-identical). The LWC
 *   price pane (candles + volume + overlays) and STACKED oscillator
 *   sub-panes (Task 4b) live canonically in charts-lwc.js (ChartsLwc) —
 *   drawPricePane/drawOscPane/removePane/hasLightweight below delegate with
 *   identical signatures and handle contracts.
 * Consumes: nothing but CSS custom properties (theme colors read at draw
 *   time, so a theme switch only needs a redraw, never new code). No chain,
 *   no storage, no signing (the LWC global is consumed by charts-lwc.js).
 * Globals/side effects: global MarketCharts only; draws into caller canvases.
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
      g.ctx.fillText(emptyText || "No price history — fills draw this line; place an order or try another pair.", g.w / 2, g.h / 2);
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
    /* Log scales (desk toggles, default log/log): compress far-spam prices
     * and dust-to-whale volumes into readable room. Pure coordinate mapping
     * (Number domain, never money); linear path below is untouched. */
    var useLogX = !!labels.logX, useLogY = !!labels.logY;
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
      if (useLogX && p <= 0) continue;
      if (useLogY && t < 0) continue;
      px.push(all[i]);
      if (p < pmin) pmin = p;
      if (p > pmax) pmax = p;
      if (t > tmax) tmax = t;
    }
    if (px.length === 0) {
      g.ctx.fillStyle = muted;
      g.ctx.font = "13px system-ui, sans-serif";
      g.ctx.textAlign = "center";
      g.ctx.fillText(emptyText || "No depth data — resting orders draw this curve; place one from the Buy/Sell panels.", g.w / 2, g.h / 2);
      g.ctx.textAlign = "left";
      return;
    }
    /* Log floors: x needs pmin>0 (guarded above); y floors at the smallest
     * positive total so zero-dust rows clamp instead of vanishing. */
    var yFloor = Infinity, j;
    for (j = 0; j < px.length; j++) {
      var tv = px[j].totalBase;
      if (tv > 0 && tv < yFloor) yFloor = tv;
    }
    if (!isFinite(yFloor)) yFloor = 1;
    function tx(v) { return useLogX ? Math.log(v) : v; }
    function ty(v) { return useLogY ? Math.log(Math.max(v, yFloor)) : v; }
    var dmin = tx(pmin), dmax = tx(pmax);
    if (!(dmax > dmin)) { dmax = dmin + 1; dmin = dmin - 1; }
    var tTop = ty(tmax), tBot = ty(useLogY ? yFloor : 0);
    if (!(tTop > tBot)) tTop = tBot + 1;
    var padL = 8, padR = 8, padT = 24, padB = 18;
    var plotW = g.w - padL - padR;
    var plotH = g.h - padT - padB;
    function x(val) {
      return padL + ((tx(val) - dmin) / (dmax - dmin)) * plotW;
    }
    function y(val) {
      return padT + (1 - (ty(val) - tBot) / (tTop - tBot)) * plotH;
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

  /* --- Slice-07 Task 4: LightweightCharts panes (slice-18 split: canonical
   * implementation in charts-lwc.js — ChartsLwc. Delegated so the
   * MarketCharts.* API stays byte-identical; Canvas2D core above unchanged.
   * Missing-backend contracts: hasLightweight false (callers take canvas
   * paths), panes return {kind: "none", chart: null} (same as empty data),
   * removePane stays a no-throw no-op. */

  /* True when the vendored UMD build is loaded and usable (v5 API:
   * createChart + addSeries). Test seam: hiding window/globalThis.
   * LightweightCharts forces the canvas fallback path below. */
  function hasLightweight() {
    if (typeof ChartsLwc !== "undefined" && ChartsLwc &&
        typeof ChartsLwc.hasLightweight === "function") {
      return ChartsLwc.hasLightweight();
    }
    return false;
  }

  /* Price pane: candles + volume + overlay lines (canonical implementation
   * in charts-lwc.js). Same signature, same handle contract ({kind, chart});
   * missing backend -> "none" handle (same as the empty-data path, never
   * blank, never throws). */
  function drawPricePane(doc, hostEl, opts) {
    if (typeof ChartsLwc !== "undefined" && ChartsLwc &&
        typeof ChartsLwc.drawPricePane === "function") {
      return ChartsLwc.drawPricePane(doc, hostEl, opts);
    }
    return { kind: "none", chart: null };
  }

  /* ONE oscillator sub-pane of a stack (canonical implementation in
   * charts-lwc.js). Same signature, same handle contract; missing backend
   * -> "none" handle (same as the no-data path, never blank, never throws). */
  function drawOscPane(doc, hostEl, opts) {
    if (typeof ChartsLwc !== "undefined" && ChartsLwc &&
        typeof ChartsLwc.drawOscPane === "function") {
      return ChartsLwc.drawOscPane(doc, hostEl, opts);
    }
    return { kind: "none", chart: null };
  }

  /* Release a pane handle (canonical implementation in charts-lwc.js).
   * Missing backend -> no-op. Never throws (teardown paths rely on it). */
  function removePane(handle) {
    if (typeof ChartsLwc !== "undefined" && ChartsLwc &&
        typeof ChartsLwc.removePane === "function") {
      ChartsLwc.removePane(handle);
    }
  }

  /* (drawPricePane/drawOscPane/removePane bodies moved verbatim to
   * charts-lwc.js — delegating shells above keep the MarketCharts API.) */

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
