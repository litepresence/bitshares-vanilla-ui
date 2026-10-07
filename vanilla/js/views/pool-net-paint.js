/* NetPaint: pure pool-network canvas painting (no state, no timers).
 * Owns: brand palette (brandOf/brandFill), node radius + edge width
 *   (pixels only), deterministic circle seed (circleLayout), DPR-aware
 *   canvas fit (fitCanvas), one-frame renderer (drawScene), one-shot
 *   paint seam (paintGraph). Edge curvature reads the live PHYS table
 *   (PoolNetPhys — single source of truth, guarded fallback); canvas
 *   wiring delegates to NetGestures at call time (guarded stub fallback).
 * Consumes: PoolNet.brandOf (group per symbol), I18n.t via the local t
 *   wrapper below (identical to PoolNetUI's — duplicated, not shared, so
 *   this file has no init-order dependency on the composer), PoolNetPhys
 *   (curvature flag only), NetGestures (wire only). S shape: see
 *   PoolNetState in pool-net-phys.js (drawScene takes view/geom/paint
 *   slices, never the whole S).
 * MONEY DISCIPLINE (#6): balances stay raw digit strings until render;
 *   edgeT reads balance/volume LENGTHS only — never Number() on money.
 * Created by: pool-net-ui split (mechanical move from pool-net-ui.js,
 *   zero behavior change). Exposes global NetPaint.
 */
var NetPaint = (function () {
  "use strict";

  /* BTS core id: consensus literal (1.3.0 on both chains), not a lookup —
   * the core seeds centered (provenance-map meaning). Same literal as
   * PoolNetPhys; never a lookup. */
  var CORE_ID = "1.3.0";
  var EDGE_PAD = 30;
  var NODE_BASE_R = 5, NODE_DEG_STEP = 1.2, NODE_MAX_DEG = 5, NODE_MAX_R = 11;
  var BTS_BLUE = "#1E9ED7";

  /* Brand fills (spec §4 groups): BTS + committee smartcoins always
   * BitShares blue — read from --accent (BitShares blue in all three themes)
   * so the core tracks the theme instead of a frozen hex; the remaining
   * groups are fixed data hues (no theme tokens exist for them), drawn by
   * legend toggle (display only, never chain). */
  var BRAND_FILLS = {
    honest: "#2E9E5B", gdex: "#14A8A8", xbtsx: "#8E5BD6", btwty: "#E5639E",
    crude: "#D9A400", iob: "#E07B2A", grey: "#8A8A8A", goldback: "#C8961E",
    blue3: "#4A90D9", other: "#D35A41"
  };
  var PATH_WARM = "#F5B301";

  /* Batch-2d i18n (pool-ui.js precedent): I18n.t with the verbatim English
   * default (file://-safe); raw default returns unfilled without I18n. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }

  /* Theme token value or the fallback (headless-safe; pool-graph.js precedent). */
  function _cssTok(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }

  /* brandOf: PoolNet group for a symbol (bare guard when unloaded). */
  function brandOf(sym) {
    try {
      if (typeof PoolNet !== "undefined" && PoolNet && typeof PoolNet.brandOf === "function") return PoolNet.brandOf(sym);
    } catch (e) { /* other below */ }
    return "other";
  }

  /* Volume ramp: t in [0,1] -> grey-to-blue ink (owner 2026-10-07: color
   * replaces the old digit-length thickness — same t metric, same /14
   * scale, so a given blue means the same thing on every map/filter.
   * Pure: parse failures fail closed to grey. Verbatim twin lives in
   * pool-graph.js — doctrine prefers the duplication over a shared import
   * for two files. */
  function _ramp(t, greyHex, blueHex) {
    function chan(h, i) { return parseInt(h.substr(i, 2), 16); }
    function rgb(h) {
      try {
        var s = String(h).trim();
        var m = /^#([0-9a-fA-F]{6})$/.exec(s);
        if (m) return [chan(m[1], 0), chan(m[1], 2), chan(m[1], 4)];
        var m3 = /^#([0-9a-fA-F]{3})$/.exec(s);
        if (m3) return [chan(m3[1].charAt(0) + m3[1].charAt(0), 0), chan(m3[1].charAt(1) + m3[1].charAt(1), 0), chan(m3[1].charAt(2) + m3[1].charAt(2), 0)];
        var mg = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
        if (mg) return [Number(mg[1]), Number(mg[2]), Number(mg[3])];
      } catch (e) { /* grey below */ }
      return null;
    }
    var g = rgb(greyHex), b = rgb(blueHex);
    if (!g || !b) return "rgb(117, 134, 150)";
    var k = Number(t);
    if (!(k > 0)) k = 0;
    if (k > 1) k = 1;
    function mix(i) { return Math.round(g[i] + (b[i] - g[i]) * k); }
    return "rgb(" + mix(0) + ", " + mix(1) + ", " + mix(2) + ")";
  }
  /* Fill for a brand group: bts-blue tracks --accent (BitShares blue in all
   * three themes), the rest are the fixed §4 data hues. */
  function brandFill(group) {
    if (group === "bts-blue") return _cssTok("--accent", BTS_BLUE);
    return BRAND_FILLS[group] || BRAND_FILLS.other;
  }

  /* edgeT: volume/size parameter for the ramp — stripped digit length
   * over 14 (the old width formula's scale, kept so a given blue means the
   * same thing on every map). Pool meta reads both balance legs, market
   * meta reads volBaseRaw; missing/malformed data reads 0 (thin grey).
   * Counts only, never values — no floats on money.
   * @param {Object|null} meta edge meta map. @param {string} id edge id.
   * @returns {number} t in [0,1]. Never throws. */
  function edgeT(meta, id) {
    try {
      var m = meta ? meta[id] : null;
      var digits = 0;
      if (m) {
        var a = m.balance_a_raw, b = m.balance_b_raw;
        if (typeof a === "string" && /^\d+$/.test(a) && typeof b === "string" && /^\d+$/.test(b)) {
          digits = a.replace(/^0+/, "").length + b.replace(/^0+/, "").length;
        } else if (typeof m.volBaseRaw === "string" && /^\d+$/.test(m.volBaseRaw)) {
          digits = m.volBaseRaw.replace(/^0+/, "").length;
        }
      }
      if (!(digits > 0)) return 0;
      return Math.min(digits / 14, 1);
    } catch (e) { return 0; }
  }

  /* Node radius, pixels only: 5 + degree step, capped at 11 (PoolGraph scale —
   * labels breathe; the 44px touch floor comes from hit tolerance, not ink). */
  function _nodeRadius(deg) {
    var d = Number(deg) || 0;
    if (!(d > 0)) d = 0;
    if (d > NODE_MAX_DEG) d = NODE_MAX_DEG;
    return NODE_BASE_R + d * NODE_DEG_STEP;
  }

  /* Live PHYS table (single source of truth in PoolNetPhys); guarded
   * fallback carries the curvature flag only (drawScene needs nothing
   * else from a preset, and there is only ONE preset since 2026-10-07). */
  function physTable() {
    try {
      if (typeof PoolNetPhys !== "undefined" && PoolNetPhys && typeof PoolNetPhys._physForTest === "function") {
        var p = PoolNetPhys._physForTest();
        if (p && p.lively) return p;
      }
    } catch (e) { /* fallback below */ }
    return { lively: { curved: true } };
  }

  /* Deterministic circle seed: sorted ids around the ring, BTS centered when
   * present (the provenance-map meaning — the core stays prominent). Pure. */
  function circleLayout(nodes, W, H) {
    var pos = {};
    var ids = (nodes || []).map(function (n) { return n.assetId; }).sort();
    if (!ids.length) return pos;
    var cx = W / 2, cy = H / 2;
    var ring = ids.filter(function (id) { return id !== CORE_ID; });
    var R = Math.max(Math.min(W, H) / 2 - EDGE_PAD, 20);
    if (ids.indexOf(CORE_ID) !== -1) pos[CORE_ID] = { x: cx, y: cy };
    for (var i = 0; i < ring.length; i++) {
      var ang = -Math.PI / 2 + (i * 2 * Math.PI) / (ring.length || 1);
      pos[ring[i]] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
    }
    return pos;
  }

  /* DPR-aware canvas fit (pool-graph.js _fit contract): CSS-pixel W/H out,
   * DPR capped at 2. Null when headless-broken (no 2d context). */
  function fitCanvas(canvas, fbW, fbH) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    var W = canvas.clientWidth || fbW || 300;
    var H = canvas.clientHeight || fbH || 320;
    if (!(W > 0)) W = 300;
    if (!(H > 0)) H = 320;
    var dpr = 1;
    try {
      if (typeof window !== "undefined" && window.devicePixelRatio) dpr = window.devicePixelRatio;
    } catch (e) { dpr = 1; }
    if (!(dpr > 0)) dpr = 1;
    if (dpr > 2) dpr = 2;
    try {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    } catch (e) { /* stub ignores size */ }
    var ctx = null;
    try { ctx = canvas.getContext("2d"); } catch (e) { ctx = null; }
    if (!ctx) return null;
    try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); } catch (e) { /* stub */ }
    return { ctx: ctx, W: W, H: H };
  }

  /**
   * Paint one frame. Transform-only zoom/pan (positions untouched).
   * @param {CanvasRenderingContext2D} ctx 2d context (fit already applied).
   * @param {number} W CSS-pixel width. @param {number} H CSS-pixel height.
   * @param {{nodes: Array, edges: Array}} view Filtered graph.
   * @param {Object} geom assetId -> {x, y} world coords.
   * @param {Object} paint {scale, ox, oy, pathSet, selPool, hoverNode,
   *   hoverNode, hoverEdge, phys} display-only state (the legacy `phys`
   *   hint is ignored now that one physics exists; positions are
   *   preset-independent).
   * @returns {{hits: Array, mids: Array}} Screen-space hit lists.
   * Failure: never throws (a broken frame must not kill the loop).
   */
  function drawScene(ctx, W, H, view, geom, paint) {
    var hits = [], mids = [];
    try {
      /* One physics since the 2026-10-07 toggle rework: the curved-edge
       * character is THE preset, so there is nothing to select. A legacy
       * `paint.phys` hint is accepted and ignored. */
      var P = physTable().lively;
      var border = _cssTok("--border", "#5a5a5a"), text = _cssTok("--text", "#c5cbce"),
        muted = _cssTok("--muted", "#758696"),
        buy = _cssTok("--buy", "#26de81");
      /* Ramp endpoints, resolved once per scene (never per edge): muted
       * grey = low, theme accent (BitShares blue) = high. Follows the
       * same token block so a theme flip re-resolves instead of sticking. */
      var rampLo = _cssTok("--muted", "#758696"), rampHi = _cssTok("--accent", "#1E9ED7");
      var nodes = (view && view.nodes) || [], edges = (view && view.edges) || [];
      var scale = paint.scale || 1, ox = paint.ox || 0, oy = paint.oy || 0;
      function SX(x) { return x * scale + ox; }
      function SY(y) { return y * scale + oy; }
      if (!edges.length && !nodes.length) {
        ctx.fillStyle = muted;
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        try { ctx.fillText(t("pool_net.empty", "No pools touch this filter."), W / 2, H / 2); } catch (e) { /* stands */ }
        ctx.textAlign = "left";
        return { hits: hits, mids: mids };
      }
      var deg = {};
      edges.forEach(function (e) {
        if (!e) return;
        deg[e.a] = (deg[e.a] || 0) + 1;
        deg[e.b] = (deg[e.b] || 0) + 1;
      });
      var symById = {}, brandById = {};
      nodes.forEach(function (n) {
        symById[n.assetId] = n.sym || n.assetId;
        brandById[n.assetId] = brandOf(n.sym);
      });
      edges.forEach(function (e, ei) {
        var p = geom[e.a], q = geom[e.b];
        if (!p || !q) return;
        var hot = paint.selPool && String(e.poolId) === String(paint.selPool);
        var onPath = paint.pathSet && paint.pathSet[e.poolId];
        var hov = paint.hoverEdge && String(e.poolId) === String(paint.hoverEdge);
        try {
          /* Data ink is color-only (owner 2026-10-07): the ramp carries
           * size/volume, every base edge shares one constant width.
           * Interaction states keep overriding both. */
          ctx.strokeStyle = hot ? buy : ((onPath || hov) ? PATH_WARM : _ramp(edgeT(paint.meta, e.poolId), rampLo, rampHi));
          ctx.lineWidth = (hot || onPath || hov) ? 2.5 : 1.25;
          if (hot) {
            try { ctx.save(); ctx.shadowColor = buy; ctx.shadowBlur = 12; } catch (x) { /* glow best-effort */ }
          }
          ctx.beginPath();
          ctx.moveTo(SX(p.x), SY(p.y));
          if (P.curved && typeof ctx.quadraticCurveTo === "function") {
            var mx = (SX(p.x) + SX(q.x)) / 2, my = (SY(p.y) + SY(q.y)) / 2;
            var vx = SX(q.x) - SX(p.x), vy = SY(q.y) - SY(p.y);
            var vlen = Math.sqrt(vx * vx + vy * vy) || 1;
            var off = ((((ei || 0) % 5) + 5) % 5 - 2) * 6;
            ctx.quadraticCurveTo(mx - (vy / vlen) * off, my + (vx / vlen) * off, SX(q.x), SY(q.y));
          } else {
            ctx.lineTo(SX(q.x), SY(q.y));
          }
          ctx.stroke();
          if (hot) { try { ctx.restore(); } catch (x) { /* state stands */ } }
        } catch (e2) { /* next edge */ }
        /* An edge record carries its SEGMENT and both legs (id + symbol):
         * the whole line is the click target, and the market selector derives
         * the desk id for the pair from those symbols — a midpoint-only record
         * with no legs could only ever be a dot you had to guess the position
         * of, and could not name the market it opens. */
        mids.push({ edgeMid: true, x: (SX(p.x) + SX(q.x)) / 2, y: (SY(p.y) + SY(q.y)) / 2, poolId: e.poolId,
          ax: SX(p.x), ay: SY(p.y), bx: SX(q.x), by: SY(q.y),
          a: e.a, b: e.b, aSym: symById[e.a] || String(e.a), bSym: symById[e.b] || String(e.b) });
      });
      nodes.forEach(function (n) {
        var g = geom[n.assetId];
        if (!g) return;
        var r = _nodeRadius(deg[n.assetId]);
        var brand = brandById[n.assetId] || "other";
        var hovN = paint.hoverNode && String(n.assetId) === String(paint.hoverNode);
        try {
          ctx.fillStyle = brandFill(brand);
          ctx.beginPath();
          ctx.arc(SX(g.x), SY(g.y), r, 0, 2 * Math.PI);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = hovN ? text : border;
          ctx.lineWidth = hovN ? 2 : 1;
          ctx.stroke();
          var label = String(symById[n.assetId]).slice(0, 12);
          ctx.font = "10px system-ui, sans-serif";
          ctx.textAlign = "center";
          try {
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(0,0,0,0.85)";
            ctx.strokeText(label, SX(g.x), SY(g.y) - r - 4);
          } catch (x) { /* halo best-effort */ }
          ctx.fillStyle = text;
          ctx.fillText(label, SX(g.x), SY(g.y) - r - 4);
          ctx.textAlign = "left";
        } catch (e2) { try { ctx.globalAlpha = 1; ctx.textAlign = "left"; } catch (x) { /* next node */ } }
        hits.push({ x: SX(g.x), y: SY(g.y), r: r * scale, assetId: n.assetId, sym: symById[n.assetId] });
      });
    } catch (e) { /* a broken frame paints nothing — the loop survives */ }
    return { hits: hits, mids: mids };
  }

  /**
   * One-shot paint seam (headless-testable): fit + circle layout + draw.
   * @param {HTMLCanvasElement} canvas Target canvas.
   * @param {{nodes: Array, edges: Array}} graph Graph to paint.
   * @param {Object} [opts] {pathPools, selPool, meta} display-only (no dim:
   *   hidden brands are filtered out of the graph upstream).
   * @returns {{empty: boolean, nodes: number, edges: number}|null}
   * Failure: null when the canvas has no 2d context.
   */
  function paintGraph(canvas, graph, opts) {
    opts = opts || {};
    var g = fitCanvas(canvas, 300, 320);
    if (!g) return null;
    var pathSet = {};
    (opts.pathPools || []).forEach(function (id) { pathSet[String(id)] = 1; });
    var out = drawScene(g.ctx, g.W, g.H, graph, circleLayout((graph && graph.nodes) || [], g.W, g.H), {
      scale: 1, ox: 0, oy: 0, pathSet: pathSet,
      selPool: opts.selPool || null, dim: opts.dimBrands || {},
      meta: opts.meta || {}, hoverNode: null, hoverEdge: null, phys: "lively"
    });
    try {
      canvas.setAttribute("tabindex", "0");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", t("pool_net.canvas_label", "Pool network map. Press Enter to open BTS."));
    } catch (e) { /* stub canvas */ }
    var wireState = { geom: {}, hits: out.hits, mids: out.mids, paint: { scale: 1, ox: 0, oy: 0 } };
    try {
      if (typeof NetGestures !== "undefined" && NetGestures && typeof NetGestures.wire === "function") {
        NetGestures.wire(canvas, wireState);
      } else if (canvas) {
        try { /** @type {any} */ (canvas)._netHits = wireState.hits; } catch (e) { /* stub */ }
        try { /** @type {any} */ (canvas)._netMids = wireState.mids; } catch (e2) { /* stub */ }
      }
    } catch (e) { /* hits stand */ }
    return { empty: out.hits.length === 0 && out.mids.length === 0, nodes: out.hits.length, edges: out.mids.length };
  }

  return {
    paintGraph: paintGraph,
    drawScene: drawScene,
    circleLayout: circleLayout,
    fitCanvas: fitCanvas,
    brandOf: brandOf,
    brandFill: brandFill,
    _rampForTest: _ramp
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.NetPaint === "undefined") { globalThis.NetPaint = NetPaint; }
if (typeof module !== "undefined") { module.exports = NetPaint; }
