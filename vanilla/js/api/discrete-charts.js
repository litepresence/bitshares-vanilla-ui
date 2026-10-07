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

  /* Nice linear ticks (pure, testable). Scale labels only — tick positions
   * are pixel math on the data range (depth-label precedent); labels are
   * display strings, never money amounts. Params: lo/hi numbers, maxTicks.
   * Returns [{v, label}]. Never throws (bad range -> []). */
  function niceTicks(lo, hi, maxTicks) {
    var out = [];
    try {
      lo = Number(lo); hi = Number(hi);
      if (!isFinite(lo) || !isFinite(hi) || !(hi > lo)) return out;
      maxTicks = (maxTicks | 0) || 5;
      if (maxTicks < 2) maxTicks = 2;
      var span = hi - lo, mag = Math.pow(10, Math.floor(Math.log10(span)));
      var steps = [1, 2, 2.5, 5, 10], step = mag * 10, dec = 0, i;
      for (i = 0; i < steps.length; i++) {
        var cand = mag * steps[i];
        if (span / cand <= maxTicks) { step = cand; break; }
      }
      dec = Math.max(0, -Math.floor(Math.log10(step)));
      if (dec > 8) dec = 8;
      var start = Math.ceil(lo / step) * step;
      for (var v = start; v <= hi + step / 2; v += step) {
        var vv = Number(v.toFixed(dec + 1));
        out.push({ y: vv, label: vv.toFixed(dec) });
        if (out.length > 12) break;
      }
    } catch (e) { return []; }
    return out;
  }

  /* Log-decade ticks (pure). Params: lo/hi positive numbers. Returns
   * [{v, label}] at 10^k within range. Never throws. */
  function logTicks(lo, hi) {
    var out = [];
    try {
      lo = Number(lo); hi = Number(hi);
      if (!isFinite(lo) || !isFinite(hi) || !(hi > lo) || !(lo > 0)) return out;
      for (var k = Math.ceil(Math.log10(lo)); Math.pow(10, k) <= hi; k++) {
        var v = Math.pow(10, k);
        out.push({ v: v, label: "1e" + k });
        if (out.length > 12) break;
      }
    } catch (e) { return []; }
    return out;
  }

  /* UTC time ticks (pure). Times are not money — Date math is free.
   * Params: t0/t1 ms numbers, maxTicks. Returns [{ms, label}] ("HH:MM"
   * intraday, "MM-DD" multi-day, "MM-DD HH:MM" mixed). Never throws. */
  function timeTicks(t0, t1, maxTicks) {
    var out = [];
    try {
      t0 = Number(t0); t1 = Number(t1);
      if (!isFinite(t0) || !isFinite(t1) || !(t1 > t0)) return out;
      maxTicks = (maxTicks | 0) || 5;
      if (maxTicks < 2) maxTicks = 2;
      var steps = [1000, 5000, 15000, 30000, 60000, 300000, 900000, 3600000, 14400000, 43200000, 86400000, 604800000, 2592000000, 7776000000, 31536000000];
      var step = steps[steps.length - 1], i;
      for (i = 0; i < steps.length; i++) {
        if ((t1 - t0) / steps[i] <= maxTicks) { step = steps[i]; break; }
      }
      var multi = (t1 - t0) >= 86400000, yearly = (t1 - t0) >= 300 * 86400000;
      function pad(n) { return (n < 10 ? "0" : "") + n; }
      var start = Math.ceil(t0 / step) * step;
      for (var ms = start; ms <= t1; ms += step) {
        var d = new Date(ms), label;
        if (yearly) label = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
        else if (!multi && step >= 60000) label = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
        else if (!multi) label = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
        else if (step >= 86400000) label = pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
        else label = pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
        out.push({ ms: ms, label: label });
        if (out.length > 12) break;
      }
    } catch (e) { return []; }
    return out;
  }

  /* i18n helper (pool-file t() shape): I18n.t when loaded, verbatim
   * English default otherwise (file:// where dict fetch fails). */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* UTC clock for tooltip times (times are not money — Date is free). */
  function utcClock(ms) {
    try {
      var d = new Date(Number(ms));
      if (!isFinite(d.getTime())) return "";
      function pad(n) { return (n < 10 ? "0" : "") + n; }
      return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) +
        " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + "Z";
    } catch (e) { return ""; }
  }

  /* Tooltip card lines for one point (pure, testable). Shows only carried
   * fields — account/order/block rows render when present, never guessed. */
  function tipLines(p) {
    var lines = [];
    try {
      if (!p) return lines;
      lines.push(t("market.discrete_tip_time", "Time") + ": " + utcClock(p.timeMs));
      if (p.price !== undefined && p.price !== null && p.price !== "") lines.push(t("market.discrete_tip_price", "Price") + ": " + String(p.price));
      if (p.volume !== undefined && p.volume !== null && p.volume !== "") lines.push(t("market.discrete_tip_volume", "Volume") + ": " + String(p.volume));
      if (p.volumeQuote !== undefined && p.volumeQuote !== null && p.volumeQuote !== "") lines.push(t("market.discrete_tip_volume_quote", "Volume (quote)") + ": " + String(p.volumeQuote));
      if (p.accountId !== undefined && p.accountId !== null && p.accountId !== "") lines.push(t("market.discrete_tip_account", "Account") + ": " + String(p.accountId));
      if (p.orderId !== undefined && p.orderId !== null && p.orderId !== "") lines.push(t("market.discrete_tip_order", "Order") + ": " + String(p.orderId));
      if (p.blockNum !== undefined && p.blockNum !== null && p.blockNum !== "") lines.push(t("market.discrete_tip_block", "Block") + ": " + String(p.blockNum));
    } catch (e) { /* partial card stands */ }
    return lines;
  }

  /* Nearest-point hit test (pure, testable). Params: hits [{x, y}],
   * qx/qy CSS px, tol px. Returns index or -1. Never throws. */
  function nearestIdx(hits, qx, qy, tol) {
    try {
      if (!Array.isArray(hits) || !hits.length) return -1;
      tol = (typeof tol === "number" && tol > 0) ? tol : 14;
      var best = -1, bestD = tol * tol, i, dx, dy, d;
      for (i = 0; i < hits.length; i++) {
        if (!hits[i]) continue;
        dx = hits[i].x - qx; dy = hits[i].y - qy; d = dx * dx + dy * dy;
        if (d <= bestD) { bestD = d; best = i; }
      }
      return best;
    } catch (e) { return -1; }
  }

  /* Shared time-window zoom math (pure, testable). view {t0,t1} ms (nulls =
   * full range); zoomView returns the clamped window after factor f (>1 zooms
   * in) around centerMs within bounds {lo, hi}; panView shifts by deltaMs;
   * fullView resets. Never throws (bad input -> bounds). */
  function zoomView(view, centerMs, f, bounds) {
    try {
      var lo = bounds.lo, hi = bounds.hi;
      if (!(hi > lo) || !(f > 0)) return { t0: lo, t1: hi };
      var c = Number(centerMs);
      if (!isFinite(c)) c = (lo + hi) / 2;
      var span = (hi - lo) / f;
      if (!(span > 0)) span = hi - lo;
      var n0 = c - span / 2, n1 = c + span / 2;
      if (n1 - n0 >= hi - lo) return { t0: lo, t1: hi };
      if (n0 < lo) { n1 += lo - n0; n0 = lo; }
      if (n1 > hi) { n0 -= n1 - hi; n1 = hi; }
      if (n0 < lo) n0 = lo;
      return { t0: n0, t1: n1 };
    } catch (e) { return { t0: bounds.lo, t1: bounds.hi }; }
  }
  function panView(view, deltaMs, bounds) {
    try {
      var lo = bounds.lo, hi = bounds.hi;
      var w0 = (view && view.t0 !== undefined && view.t0 !== null) ? Number(view.t0) : lo;
      var w1 = (view && view.t1 !== undefined && view.t1 !== null) ? Number(view.t1) : hi;
      if (!isFinite(w0) || !isFinite(w1) || !(w1 > w0)) return { t0: lo, t1: hi };
      var span = w1 - w0, d = Number(deltaMs) || 0;
      var n0 = w0 + d, n1 = w1 + d;
      if (n0 < lo - span || n1 > hi + span) return { t0: w0, t1: w1 };
      if (n0 < lo) { n1 += lo - n0; n0 = lo; }
      if (n1 > hi) { n0 -= n1 - hi; n1 = hi; }
      return { t0: n0, t1: n1 };
    } catch (e) { return { t0: bounds.lo, t1: bounds.hi }; }
  }

  /* Tooltip + gesture wiring (dex-ux "advanced" hover parity — Plotly did
   * this free; canvas wires it by hand). One-time listeners per canvas
   * (flag-guarded; repaints only refresh the geometry record). Tooltip div
   * lives in the host (survives repaints); host forced position:relative
   * only when statically positioned (guarded inline style, minimal
   * intrusion). params: doc, hostEl, canvas, rec {pts, xs, ys, lo, hi,
   * view, repaint, kind}, opts (onViewChange). Never throws. */
  function wireDiscrete(doc, hostEl, canvas, rec, opts) {
    opts = opts || {};
    try {
      if (!canvas || !rec || !rec.pts || !rec.pts.length) return;
      canvas._discreteRec = rec;
      if (canvas._discreteWired) return;
      canvas._discreteWired = true;
    } catch (e) { return; }
    function cur() {
      try { return canvas._discreteRec || rec; } catch (e) { return rec; }
    }
    function tipEl() {
      var tip = null;
      try {
        if (hostEl && hostEl.querySelector) tip = hostEl.querySelector("[data-discrete-tip]");
        if (!tip && doc && typeof doc.createElement === "function") {
          tip = doc.createElement("div");
          tip.setAttribute("data-discrete-tip", "1");
          tip.style.position = "absolute";
          tip.style.display = "none";
          tip.style.zIndex = "5";
          tip.style.maxWidth = "240px";
          tip.style.pointerEvents = "none";
          tip.style.fontSize = "12px";
          tip.style.padding = "6px 8px";
          tip.style.borderRadius = "8px";
          if (hostEl) {
            try {
              var pos = "";
              if (typeof window !== "undefined" && window.getComputedStyle) pos = window.getComputedStyle(hostEl).position;
              if (pos !== "relative" && pos !== "absolute" && pos !== "fixed") hostEl.style.position = "relative";
            } catch (e) { /* overlay still stands */ }
            hostEl.appendChild(tip);
          }
        }
      } catch (e) { tip = null; }
      return tip;
    }
    function paintTip(r, idx) {
      var tip = tipEl();
      if (!tip) return;
      try {
        var lines = tipLines(r.pts[idx]);
        if (!lines.length) { tip.style.display = "none"; return; }
        var C = colorsOf({});
        tip.style.display = "block";
        tip.style.background = C.paneBg;
        tip.style.border = "1px solid " + C.grid;
        tip.style.color = C.text;
        while (tip.firstChild) tip.removeChild(tip.firstChild);
        lines.forEach(function (ln, li) {
          var row = doc.createElement("div");
          row.textContent = ln;
          if (li === 0) { try { row.style.fontWeight = "bold"; } catch (e) {} }
          tip.appendChild(row);
        });
        var hw = 0, hh = 0;
        try { hw = hostEl.clientWidth || 300; hh = hostEl.clientHeight || 200; } catch (e) { hw = 300; hh = 200; }
        var tx = Math.min(Math.max(r.xs[idx] + 12, 4), hw - 120);
        var ty = Math.min(Math.max(r.ys[idx] - 10, 4), hh - 40);
        tip.style.left = tx + "px";
        tip.style.top = ty + "px";
      } catch (e) { /* tooltip best-effort */ }
    }
    function hideTip() {
      try {
        var tip = hostEl && hostEl.querySelector ? hostEl.querySelector("[data-discrete-tip]") : null;
        if (tip) tip.style.display = "none";
      } catch (e) { /* stands */ }
    }
    function ptr(ev) {
      try {
        var box = canvas.getBoundingClientRect();
        return { x: ev.clientX - box.left, y: ev.clientY - box.top };
      } catch (e) { return null; }
    }
    function viewChanged() {
      try {
        if (opts && typeof opts.onViewChange === "function") opts.onViewChange();
        else if (cur().repaint) cur().repaint();
      } catch (e) { /* paint stands */ }
    }
    var rafId = 0;
    function repaintSoon() {
      try {
        if (rafId) return;
        if (typeof requestAnimationFrame !== "undefined") {
          rafId = requestAnimationFrame(function () { rafId = 0; viewChanged(); });
        } else viewChanged();
      } catch (e) { viewChanged(); }
    }
    try {
      if (typeof canvas.addEventListener !== "function") return;
      canvas.addEventListener("mousemove", function (ev) {
        var r = cur(), p = ptr(ev);
        if (!p) return;
        var idx = nearestIdx(r.xs.map(function (x, i) { return { x: x, y: r.ys[i] }; }), p.x, p.y, 14);
        if (idx < 0) { hideTip(); return; }
        paintTip(r, idx);
      });
      canvas.addEventListener("mouseleave", hideTip);
      /* Touch tap = tooltip (click without drag). Desktop click on empty space clears. */
      canvas.addEventListener("click", function (ev) {
        var r = cur(), p = ptr(ev);
        if (!p) return;
        var idx = nearestIdx(r.xs.map(function (x, i) { return { x: x, y: r.ys[i] }; }), p.x, p.y, 16);
        if (idx < 0) { hideTip(); return; }
        paintTip(r, idx);
      });
      /* Wheel zooms the shared time window at the cursor; drag pans time;
       * double-click resets. Price refits the visible window on repaint. */
      canvas.addEventListener("wheel", function (ev) {
        var r = cur(), p = ptr(ev);
        if (!p || !r.view) return;
        try { if (ev.preventDefault) ev.preventDefault(); } catch (e) {}
        try {
          var span = (r.hi - r.lo) || 1;
          var msPerPx = span / Math.max(1, ((r.plotW) || span));
          var center = r.lo + (p.x - (r.padL || 0)) * msPerPx;
          var f = (ev.deltaY || 0) > 0 ? 1 / 1.25 : 1.25;
          var w = zoomView(r.view, center, f, { lo: r.lo, hi: r.hi });
          r.view.t0 = w.t0; r.view.t1 = w.t1;
          repaintSoon();
        } catch (e) { /* zoom stands down */ }
      }, { passive: false });
      var dragSt = null;
      canvas.addEventListener("pointerdown", function (ev) {
        var p = ptr(ev);
        if (!p) return;
        dragSt = { sx: p.x, moved: false };
        try { canvas.style.touchAction = "pan-y"; } catch (e) { /* scroll stands */ }
      });
      canvas.addEventListener("pointermove", function (ev) {
        if (!dragSt) return;
        var r = cur(), p = ptr(ev);
        if (!p || !r.view) return;
        if (Math.abs(p.x - dragSt.sx) > 4) dragSt.moved = true;
        if (!dragSt.moved) return;
        try {
          var span = (r.hi - r.lo) || 1;
          var msPerPx = span / Math.max(1, (r.plotW || span));
          var w = panView(r.view, (dragSt.sx - p.x) * msPerPx, { lo: r.lo, hi: r.hi });
          dragSt.sx = p.x;
          r.view.t0 = w.t0; r.view.t1 = w.t1;
          repaintSoon();
        } catch (e) { /* pan stands down */ }
      });
      function endPan() {
        try { canvas.style.touchAction = ""; } catch (e) {}
        dragSt = null;
      }
      canvas.addEventListener("pointerup", endPan);
      canvas.addEventListener("pointercancel", endPan);
      canvas.addEventListener("dblclick", function () {
        var r = cur();
        if (!r.view) return;
        try { r.view.t0 = null; r.view.t1 = null; if (r.view) delete r.view.sel; } catch (e) {}
        viewChanged();
      });
      /* Keyboard inspection: arrows step the selection, Escape clears. */
      try { canvas.setAttribute("tabindex", "0"); } catch (e) {}
      try { canvas.setAttribute("role", "img"); } catch (e) {}
      canvas.addEventListener("keydown", function (ev) {
        if (!ev) return;
        var key = ev.key || "";
        if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Escape" && ev.keyCode !== 37 && ev.keyCode !== 39 && ev.keyCode !== 27) return;
        var r = cur();
        if (!r.pts || !r.pts.length) return;
        try {
          if (key === "Escape" || ev.keyCode === 27) {
            if (r.view) delete r.view.sel;
            hideTip();
            if (r.repaint) r.repaint();
            ev.preventDefault();
            return;
          }
          var d = (key === "ArrowLeft" || ev.keyCode === 37) ? -1 : 1;
          var n = r.pts.length;
          var curSel = (r.view && typeof r.view.sel === "number") ? r.view.sel : (d > 0 ? -1 : n);
          var nx = Math.min(n - 1, Math.max(0, curSel + d));
          if (r.view) r.view.sel = nx;
          if (r.repaint) r.repaint();
          var r2 = cur();
          paintTip(r2, nx);
          drawSelRing(r2, nx);
          ev.preventDefault();
        } catch (e) { /* selection stands down */ }
      });
    } catch (e) { /* headless stubs stand down */ }
    function drawSelRing(r, idx) {
      try {
        var cvs = null;
        if (hostEl && hostEl.querySelector) cvs = hostEl.querySelector("canvas.mkt-canvas");
        if (!cvs || typeof cvs.getContext !== "function") return;
        var ctx = cvs.getContext("2d");
        if (!ctx || !r.xs || r.xs[idx] === undefined) return;
        var C = colorsOf({});
        var dpr = 1;
        try { if (typeof window !== "undefined" && window.devicePixelRatio) dpr = window.devicePixelRatio; } catch (e) {}
        if (!(dpr > 0)) dpr = 1;
        ctx.save();
        try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) {}
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.xs[idx], r.ys[idx], 6, 0, 6.283185307179586);
        ctx.stroke();
        ctx.restore();
      } catch (e) { /* ring best-effort */ }
    }
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
    /* Rows keep their source point (hover card identity survives filtering). */
    var i, rows = [];
    for (i = 0; i < list.length; i++) {
      var ms = list[i] && list[i].timeMs;
      var px = list[i] ? Number(list[i].price) : NaN;
      if (typeof ms !== "number" || !isFinite(px)) continue;
      if (opts.log && !(px > 0)) continue;
      rows.push({ ms: ms, val: opts.log ? Math.log10(px) : px, src: list[i] });
    }
    if (rows.length === 0) {
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var t = rows.map(function (r) { return r.ms; });
    var lo = Math.min.apply(null, t), hi = Math.max.apply(null, t);
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    /* Shared time window (zoom/pan/dblclick mutate opts.view in place; both
     * panes receive the SAME object from the caller so they stay in sync).
     * Null bounds = full data range. */
    var view = (opts && opts.view && typeof opts.view === "object") ? opts.view : null;
    var wlo = (view && isFinite(Number(view.t0))) ? Number(view.t0) : lo;
    var whi = (view && isFinite(Number(view.t1))) ? Number(view.t1) : hi;
    if (!(whi > wlo)) { wlo = lo; whi = hi; }
    var kept = rows.filter(function (r) { return r.ms >= wlo && r.ms <= whi; });
    /* Y refits the visible window (zooming into flat history still spreads).
     * Falls back to full-range when the window holds nothing visible. */
    var yrows = kept.length ? kept : rows;
    var vlo = yrows[0].val, vhi = yrows[0].val, yi;
    for (yi = 1; yi < yrows.length; yi++) {
      if (yrows[yi].val < vlo) vlo = yrows[yi].val;
      if (yrows[yi].val > vhi) vhi = yrows[yi].val;
    }
    if (!(vhi > vlo)) { vhi = vlo + 1; vlo = vlo - 1; }
    /* Axes (dex-ux Plotly parity — Plotly drew scales for free; canvas must
     * draw its own): y price ticks (nice linear, decades when log) + x UTC
     * time ticks over the visible window, gridlines in theme tokens. */
    var yTicks = [];
    try {
      if (opts.log) {
        var pxs = [];
        for (i = 0; i < yrows.length; i++) {
          var rawPx = null;
          try { rawPx = yrows[i].src ? Number(yrows[i].src.price) : NaN; } catch (e) { rawPx = NaN; }
          if (rawPx > 0) pxs.push(rawPx);
        }
        var plo = Math.min.apply(null, pxs.length ? pxs : [1]), phi = Math.max.apply(null, pxs.length ? pxs : [1]);
        var lts = logTicks(plo, phi), li;
        for (li = 0; li < lts.length; li++) yTicks.push({ y: Math.log10(lts[li].v), label: lts[li].label });
      } else {
        yTicks = niceTicks(vlo, vhi, 5);
      }
    } catch (e) { yTicks = []; }
    var xTicks = [];
    try { xTicks = timeTicks(wlo, whi, 6); } catch (e) { xTicks = []; }
    var padL = 54, padR = 8, padT = 12, padB = 20;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    if (plotW < 40 || plotH < 40) { padL = 8; padB = 14; plotW = g.w - padL - padR; plotH = g.h - padT - padB; }
    var ctx = g.ctx;
    function Xof(ms) { return padL + ((ms - wlo) / (whi - wlo)) * plotW; }
    function Yof(val) { return padT + (1 - (val - vlo) / (vhi - vlo)) * plotH; }
    try {
      var ti;
      ctx.lineWidth = 1;
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillStyle = C.muted;
      ctx.strokeStyle = C.grid;
      for (ti = 0; ti < yTicks.length; ti++) {
        var yy = Yof(yTicks[ti].y);
        if (yy < padT - 1 || yy > padT + plotH + 1) continue;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.textAlign = "right";
        ctx.fillText(String(yTicks[ti].label).slice(0, 12), padL - 4, yy + 3);
      }
      ctx.textAlign = "center";
      for (ti = 0; ti < xTicks.length; ti++) {
        var xx = Xof(xTicks[ti].ms);
        if (xx < padL - 1 || xx > padL + plotW + 1) continue;
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(xTicks[ti].label, xx, padT + plotH + 12);
      }
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    } catch (e) { /* dots below still stand */ }
    var kxs = [], kys = [], ksrc = [];
    try {
      ctx.fillStyle = C.accent;
      for (i = 0; i < kept.length; i++) {
        var x = Xof(kept[i].ms);
        var y = Yof(kept[i].val);
        kxs.push(x); kys.push(y); ksrc.push(kept[i].src);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, 6.283185307179586);
        ctx.fill();
      }
    } catch (e) { /* partial dots stand */ }
    /* Geometry record + gestures + persisted keyboard selection ring. */
    try {
      var cvs = null;
      if (hostEl && hostEl.querySelector) cvs = hostEl.querySelector("canvas.mkt-canvas");
      if (cvs) {
        var rec = { pts: ksrc, xs: kxs, ys: kys, lo: lo, hi: hi, view: view,
          plotW: plotW, padL: padL,
          repaint: function () { drawDiscretePrice(doc, hostEl, points, opts); } };
        wireDiscrete(doc, hostEl, cvs, rec, opts);
        var sel = view && typeof view.sel === "number" ? view.sel : -1;
        if (sel >= 0 && sel < kxs.length) {
          ctx.save();
          try { ctx.strokeStyle = C.accent; } catch (e) {}
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(kxs[sel], kys[sel], 6, 0, 6.283185307179586);
          ctx.stroke();
          ctx.restore();
        }
      }
    } catch (e) { /* paint stands without inspection */ }
    return { kind: "discrete", n: kept.length };
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
    var i, rows = [];
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
      rows.push({ ms: ms, val: amt, src: list[i] });
    }
    if (rows.length === 0) {
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var t = rows.map(function (r) { return r.ms; });
    var lo = Math.min.apply(null, t), hi = Math.max.apply(null, t);
    var vmax = 0, vi;
    for (vi = 0; vi < rows.length; vi++) { if (rows[vi].val > vmax) vmax = rows[vi].val; }
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    if (!(vmax > 0)) vmax = 1;
    var view = (opts && opts.view && typeof opts.view === "object") ? opts.view : null;
    var wlo = (view && isFinite(Number(view.t0))) ? Number(view.t0) : lo;
    var whi = (view && isFinite(Number(view.t1))) ? Number(view.t1) : hi;
    if (!(whi > wlo)) { wlo = lo; whi = hi; }
    var kept = rows.filter(function (r) { return r.ms >= wlo && r.ms <= whi; });
    /* Volume y-scale: exact labels only (max point's human string + zero —
     * fractional humans would need decimal math on money, refused). Same
     * left gutter as the price pane so the shared time axis aligns. Max
     * found by exact digit-string compare (floats lose big raws). */
    var maxLabel = "0", mi, maxRaw = "";
    for (mi = 0; mi < list.length; mi++) {
      try {
        var mraw = list[mi] ? list[mi].volumeBaseRaw : null;
        if (typeof mraw !== "string" || !/^\d+$/.test(mraw)) continue;
        var longer = mraw.length > maxRaw.length;
        var sameLenBigger = mraw.length === maxRaw.length && mraw > maxRaw;
        if (maxRaw === "" || longer || sameLenBigger) {
          maxRaw = mraw;
          if (list[mi].volume) maxLabel = String(list[mi].volume);
        }
      } catch (e) { /* next point */ }
    }
    var xTicks = [];
    try { xTicks = timeTicks(wlo, whi, 6); } catch (e) { xTicks = []; }
    var padL = 54, padR = 8, padT = 8, padB = 20;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    if (plotW < 40 || plotH < 30) { padL = 8; padB = 12; plotW = g.w - padL - padR; plotH = g.h - padT - padB; }
    var ctx = g.ctx;
    function VXof(ms) { return padL + ((ms - wlo) / (whi - wlo)) * plotW; }
    try {
      var ti;
      ctx.lineWidth = 1;
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillStyle = C.muted;
      ctx.strokeStyle = C.grid;
      ctx.textAlign = "right";
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(String(maxLabel).slice(0, 14), padL - 4, padT + 9);
      ctx.fillText("0", padL - 4, padT + plotH + 1);
      ctx.textAlign = "center";
      for (ti = 0; ti < xTicks.length; ti++) {
        var xx = VXof(xTicks[ti].ms);
        if (xx < padL - 1 || xx > padL + plotW + 1) continue;
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(xTicks[ti].label, xx, padT + plotH + 12);
      }
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    } catch (e) { /* stems below still stand */ }
    try {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 2;
      ctx.beginPath();
      var kxs = [], kys = [], ksrc = [];
      for (i = 0; i < kept.length; i++) {
        var x = VXof(kept[i].ms);
        var y = padT + (1 - kept[i].val / vmax) * plotH;
        kxs.push(x); kys.push(y); ksrc.push(kept[i].src);
        ctx.moveTo(x, padT + plotH);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    } catch (e) { /* partial stems stand */ }
    try {
      var cvs = null;
      if (hostEl && hostEl.querySelector) cvs = hostEl.querySelector("canvas.mkt-canvas");
      if (cvs) {
        var rec = { pts: ksrc, xs: kxs, ys: kys, lo: lo, hi: hi, view: view,
          plotW: plotW, padL: padL,
          repaint: function () { drawDiscreteVolume(doc, hostEl, points, opts); } };
        wireDiscrete(doc, hostEl, cvs, rec, opts);
        var sel = view && typeof view.sel === "number" ? view.sel : -1;
        if (sel >= 0 && sel < kxs.length) {
          ctx.save();
          try { ctx.strokeStyle = C.accent; } catch (e) {}
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(kxs[sel], kys[sel], 6, 0, 6.283185307179586);
          ctx.stroke();
          ctx.restore();
        }
      }
    } catch (e) { /* paint stands without inspection */ }
    return { kind: "discrete", n: kept.length };
  }

  return {
    drawDiscretePrice: drawDiscretePrice,
    drawDiscreteVolume: drawDiscreteVolume,
    _ticksForTest: { linear: niceTicks, log: logTicks, time: timeTicks,
      tip: tipLines, nearest: nearestIdx, zoom: zoomView, pan: panView }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.DiscreteCharts === "undefined") { globalThis.DiscreteCharts = DiscreteCharts; }
if (typeof module !== "undefined") { module.exports = DiscreteCharts; }
