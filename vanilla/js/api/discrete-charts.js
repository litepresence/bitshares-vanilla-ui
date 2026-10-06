/* DiscreteCharts: Discrete-timescale canvas painters (dots + volume stems).
 * Owns: drawDiscretePrice (one dot per fill/swap at its exact timeMs, no
 *   connecting line, no aggregation) and drawDiscreteVolume (one vertical
 *   stem per point on a zero-based linear scale). No fetching, no LWC,
 *   no signing.
 * Consumes: DOM.clear (guarded), getComputedStyle theme vars (guarded
 *   fallbacks), devicePixelRatio (guarded). Numbers from human strings are
 *   pixel coordinates only — money math already settled upstream in
 *   MarketFills.fillsToPoints / PoolHistory.swapsToPoints via Format.
 * Globals/side effects: publishes globalThis.DiscreteCharts; module.exports
 *   for node suites. Created by: discrete-timescale plan Task 4 (dex-ux
 *   plotlyChart scatter parity — markers for irregular timestamps, multiple
 *   points per second preserved; reference/bitshares-dex-ux/main.js
 *   chartHandler routes discrete away from candle renderers).
 */
var DiscreteCharts = (function () {
  "use strict";

  /* Read a theme token with fallback (same pattern as the market-ind-panes
   * readVar — duplicated plain code keeps this file self-contained, the
   * documented split-seam convention). Params: name (CSS var), fallback
   * string. Returns string, never throws. */
  function readVar(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }

  /* Frame colors (theme-aware, never hardcoded hex outside themes.css).
   * Params: over (optional override colors). Returns object, never throws. */
  function colorsOf(over) {
    over = over || {};
    return {
      paneBg: over.paneBg || readVar("--plot-bg", "#131722"),
      grid: over.grid || readVar("--border", "#2a2e39"),
      text: over.text || readVar("--text", "#c5cbce"),
      accent: over.accent || readVar("--accent", "#007bff"),
      muted: over.muted || readVar("--muted", "#758696")
    };
  }

  /* DPR-aware canvas under a host (clears the host first when DOM.clear is
   * present). Params: doc, hostEl, cssH (CSS pixel height). Returns
   * {ctx, w, h} in CSS pixels, or null when unusable. Never throws. */
  function fitHost(doc, hostEl, cssH) {
    try {
      if (!doc || !hostEl || typeof doc.createElement !== "function") return null;
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.clear === "function") DOM.clear(hostEl);
      } catch (e) { /* paint over whatever stands */ }
      var canvas = doc.createElement("canvas");
      if (!canvas || typeof canvas.getContext !== "function") return null;
      canvas.className = "mkt-canvas";
      var w = hostEl.clientWidth || 300;
      var dpr = 1;
      try {
        if (typeof window !== "undefined" && window.devicePixelRatio) dpr = window.devicePixelRatio;
      } catch (e) { dpr = 1; }
      try {
        canvas.style.width = "100%";
        canvas.style.height = cssH + "px";
      } catch (e) { /* size attrs below still apply */ }
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(cssH * dpr);
      var ctx = canvas.getContext("2d");
      if (!ctx) return null;
      try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) { /* unscaled stands */ }
      try { ctx.clearRect(0, 0, w, cssH); } catch (e) { /* blank stands */ }
      try { hostEl.appendChild(canvas); } catch (e) { return null; }
      return { ctx: ctx, w: w, h: cssH };
    } catch (e) { return null; }
  }

  /* Honest empty note in the host (never a blank pane).
   * Params: doc, hostEl, text (fallback "No fills yet."). Never throws. */
  function emptyNote(doc, hostEl, text) {
    try {
      if (!doc || !hostEl) return;
      var p = doc.createElement("p");
      p.className = "muted";
      try { p.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      var label = (typeof text === "string" && text) ? text : "No fills yet.";
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.text === "function") DOM.text(p, label);
        else p.textContent = label;
      } catch (e) { p.textContent = label; }
      try { hostEl.appendChild(p); } catch (e) { /* host gone */ }
    } catch (e) { /* empty state is best-effort */ }
  }

  /* Price dots. Params: doc, hostEl, points ([{timeMs, price}]), opts
   * {log (price y-scale only), colors, emptyText}. Log skips non-positive
   * prices (never dives to zero). Returns {kind: "discrete", n}. Never throws. */
  function drawDiscretePrice(doc, hostEl, points, opts) {
    opts = opts || {};
    var list = Array.isArray(points) ? points : [];
    var C = colorsOf(opts.colors);
    if (list.length === 0) {
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.clear === "function") DOM.clear(hostEl);
      } catch (e) { /* note below covers */ }
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var g = fitHost(doc, hostEl, 260);
    if (!g) return { kind: "discrete", n: list.length };
    var i, t = [], v = [];
    for (i = 0; i < list.length; i++) {
      var ms = list[i] && list[i].timeMs;
      var px = list[i] ? Number(list[i].price) : NaN;
      if (typeof ms !== "number" || !isFinite(px)) continue;
      if (opts.log && !(px > 0)) continue;
      t.push(ms);
      v.push(opts.log ? Math.log10(px) : px);
    }
    if (v.length === 0) {
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var lo = Math.min.apply(null, t), hi = Math.max.apply(null, t);
    var vlo = Math.min.apply(null, v), vhi = Math.max.apply(null, v);
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    if (!(vhi > vlo)) { vhi = vlo + 1; vlo = vlo - 1; }
    var padL = 8, padR = 8, padT = 12, padB = 18;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    var ctx = g.ctx;
    try {
      ctx.fillStyle = C.accent;
      for (i = 0; i < t.length; i++) {
        var x = padL + ((t[i] - lo) / (hi - lo)) * plotW;
        var y = padT + (1 - (v[i] - vlo) / (vhi - vlo)) * plotH;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, 6.283185307179586);
        ctx.fill();
      }
    } catch (e) { /* partial dots stand */ }
    return { kind: "discrete", n: v.length };
  }

  /* Volume stems (zero-based, always linear — log never applies to volume).
   * Magnitude reads volumeBaseRaw digit strings first (exact integer
   * magnitude, pixels only — the same class as closes[] in MarketCandles);
   * human volume strings are display text, never parsed. Params: doc,
   * hostEl, points ([{timeMs, volumeBaseRaw, volume}]), opts
   * {colors, emptyText}. Returns {kind: "discrete", n}. Never throws. */
  function drawDiscreteVolume(doc, hostEl, points, opts) {
    opts = opts || {};
    var list = Array.isArray(points) ? points : [];
    var C = colorsOf(opts.colors);
    if (list.length === 0) {
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.clear === "function") DOM.clear(hostEl);
      } catch (e) { /* note below covers */ }
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var g = fitHost(doc, hostEl, 120);
    if (!g) return { kind: "discrete", n: list.length };
    var i, t = [], v = [];
    for (i = 0; i < list.length; i++) {
      var ms = list[i] && list[i].timeMs;
      var amt = NaN;
      try {
        var raw = list[i] ? list[i].volumeBaseRaw : null;
        /* Digit-string magnitude for pixel height only (never money —
         * money already settled upstream; huge raws just saturate the axis). */
        amt = (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : NaN;
      } catch (e) { amt = NaN; }
      if (typeof ms !== "number" || !isFinite(amt) || amt < 0) continue;
      t.push(ms);
      v.push(amt);
    }
    if (v.length === 0) {
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var lo = Math.min.apply(null, t), hi = Math.max.apply(null, t);
    var vmax = Math.max.apply(null, v);
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    if (!(vmax > 0)) vmax = 1;
    var padL = 8, padR = 8, padT = 8, padB = 14;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    var ctx = g.ctx;
    try {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (i = 0; i < t.length; i++) {
        var x = padL + ((t[i] - lo) / (hi - lo)) * plotW;
        var y = padT + (1 - v[i] / vmax) * plotH;
        ctx.moveTo(x, padT + plotH);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    } catch (e) { /* partial stems stand */ }
    return { kind: "discrete", n: v.length };
  }

  return {
    drawDiscretePrice: drawDiscretePrice,
    drawDiscreteVolume: drawDiscreteVolume
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.DiscreteCharts === "undefined") { globalThis.DiscreteCharts = DiscreteCharts; }
if (typeof module !== "undefined") { module.exports = DiscreteCharts; }
