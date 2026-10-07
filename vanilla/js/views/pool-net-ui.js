/* PoolNetUI: full-pool-network canvas band for #/pools.
 * Owns: canvas element + hover/verdict/status lines + brand legend chips +
 *   <details> table twin, live-then-settle rAF physics (repulsion + springs +
 *   gravity + walls, cooling schedule, velocity sleep), transform-only
 *   wheel/pinch zoom, node drag (pointer capture), background pan, tap
 *   navigation (node -> #/asset/:symbol, edge-mid -> #/pools/:id), keyboard
 *   Enter, IntersectionObserver pause, prefers-reduced-motion freeze.
 * Consumes: PoolNet (graph/filter/path/brand/load/cache), Pool.list (live
 *   pages), Format (human balances at render only), I18n.t (all strings),
 *   DOM shared helpers (never reimplemented here), Chain.status (offline
 *   signal only). No signing, no storage of its own (PoolNet owns the
 *   extra-id cache). Exposes global PoolNetUI.
 * Created by: pool-net Task 6 (plan docs/superpowers/plans/2026-10-06-pool-net-map.md;
 *   spec docs/superpowers/specs/2026-10-06-pool-net-map-design.md §3/§4/§6).
 * CHAIN TRUTH (#4 wins): pool legs/balances <- liquidity_pool_object.hpp via
 *   Pool.list rows; BTS core = 1.3.0 literal (consensus, not a lookup).
 * MONEY DISCIPLINE (#6): balances stay raw digit strings until
 *   Format.formatAmount at render; Number() only for canvas pixels
 *   (radii/widths/positions), never money.
 * PROVENANCE (idea-only, never a dependency): squidKid-deluxe/bitshares-networks
 *   pools/pool_mapper.py (pyvis full-pool network, BFS pricing to BTS 1.3.0,
 *   drag-to-untangle) proposed the full-network map idea; the physics below
 *   is a from-scratch Fruchterman-Reingold port to Canvas2D (same doctrine as
 *   PoolGraph.relax: math ported, never imported).
 */
var PoolNetUI = (function () {
  "use strict";

  var CORE_ID = "1.3.0";
  var POOL_RE = /^1\.19\.\d+$/;
  var EDGE_PAD = 30, HIT_TOL = 22, TAP_SLOP = 5;
  var NODE_BASE_R = 5, NODE_DEG_STEP = 1.2, NODE_MAX_DEG = 5, NODE_MAX_R = 11;
  var TWIN_CAP = 200;
  var BTS_BLUE = "#1E9ED7";
  var PHYS_KEY = "poolNetPhys";

  /* PHYS presets: calm (v1 shipped constants) vs lively (pyvis-barnesHut
   * character: inverse-square degree-mass repulsion, long springs, high
   * carryover for underdamped oscillation, weak center pull, late sleep
   * gate + maxFrames stabilization budget, curved edges).
   * Lively is deliberately UNDERDAMPED (carry 0.99 + springK 0.025): the
   * graph overshoots and oscillates visibly for ~10-15s before the sleep
   * gate catches it — an overdamped lively parks into static equilibrium
   * in ~2s and looks identical to calm (user-reported "does nothing").
   * stepFrame/drawScene/loop/wake read S.phys; nothing else branches. */
  var PHYS = {
    calm:   { repPow: 1, repK: 1.0, repCap: 5, carry: 0.8, temp0: 6, cool: 0.98, tempMin: 1,
              springRest: 1.1, springK: 0.015, pull: 0.008, btsPullX: 3,
              stillTol: 0.35, stillFrames: 25, minFrames: 0, maxFrames: 900, curved: false },
    lively: { repPow: 2, repK: 2.6, repCap: 40, carry: 0.99, temp0: 10, cool: 0.9995, tempMin: 1.5,
              springRest: 2.0, springK: 0.025, pull: 0.003, btsPullX: 3,
              stillTol: 0.25, stillFrames: 120, minFrames: 400, maxFrames: 1500, curved: true }
  };

  /* Headless test seams (no DOM, no chain): preset table + default reader. */
  function _physForTest() { return PHYS; }
  function _defaultPhysForTest() { return "calm"; }

  /* Persisted preset reader: "lively" -> lively, anything else (or no
   * storage at all) -> calm. Default is calm, storage failure keeps calm. */
  function readPhys() {
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(PHYS_KEY) === "lively") return "lively";
    } catch (e) { /* calm stands */ }
    return "calm";
  }

  /* Selection getter shape (PoolUI.getSelection bridge: trimmed raw inputs
   * plus last resolved asset ids, null when unresolved/cleared).
   * @typedef {Object} NetSelection
   * @property {(string|null)} aId First-leg asset id.
   * @property {(string|null)} bId Second-leg asset id.
   * @property {string} s Raw share/pool input (a 1.19.x id glows when visible).
   */

  /* Brand fills (spec §4 groups): BTS + committee smartcoins always
   * BitShares blue — read from --accent (BitShares blue in all three themes)
   * so the core tracks the theme instead of a frozen hex; the remaining
   * groups are fixed data hues (no theme tokens exist for them), dimmed by
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

  function _dom() {
    if (typeof DOM !== "undefined" && DOM) return DOM;
    return null;
  }

  /* brandOf: PoolNet group for a symbol (bare guard when unloaded). */
  function brandOf(sym) {
    try {
      if (typeof PoolNet !== "undefined" && PoolNet && typeof PoolNet.brandOf === "function") return PoolNet.brandOf(sym);
    } catch (e) { /* other below */ }
    return "other";
  }

  /* Fill for a brand group: bts-blue tracks --accent (BitShares blue in all
   * three themes), the rest are the fixed §4 data hues. */
  function brandFill(group) {
    if (group === "bts-blue") return _cssTok("--accent", BTS_BLUE);
    return BRAND_FILLS[group] || BRAND_FILLS.other;
  }

  /* Node radius, pixels only: 5 + degree step, capped at 11 (PoolGraph scale —
   * labels breathe; the 44px touch floor comes from hit tolerance, not ink). */
  function _nodeRadius(deg) {
    var d = Number(deg) || 0;
    if (!(d > 0)) d = 0;
    if (d > NODE_MAX_DEG) d = NODE_MAX_DEG;
    return NODE_BASE_R + d * NODE_DEG_STEP;
  }

  /* Edge width, pixels only: log-weight from raw-digit balance lengths
   * (big pools pull thicker lines); skeleton-only edges (no balances yet)
   * render thin. Never Number(balance) — lengths only. */
  function _edgeWidth(meta, poolId) {
    try {
      var m = meta ? meta[poolId] : null;
      var a = m && m.balance_a_raw, b = m && m.balance_b_raw;
      if (typeof a === "string" && /^\d+$/.test(a) && typeof b === "string" && /^\d+$/.test(b)) {
        var digits = a.replace(/^0+/, "").length + b.replace(/^0+/, "").length;
        return 0.8 + Math.min(digits / 14, 1.6);
      }
    } catch (e) { /* thin below */ }
    return 1.0;
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
   * @param {Object} paint {scale, ox, oy, pathSet, selPool, dim, meta,
   *   hoverNode, hoverEdge, phys} display-only state (phys selects the
   *   PHYS preset for edge curvature; positions are preset-independent).
   * @returns {{hits: Array, mids: Array}} Screen-space hit lists.
   * Failure: never throws (a broken frame must not kill the loop).
   */
  function drawScene(ctx, W, H, view, geom, paint) {
    var hits = [], mids = [];
    try {
      var P = PHYS[(paint && paint.phys) || "calm"] || PHYS.calm;
      var border = _cssTok("--border", "#5a5a5a"), text = _cssTok("--text", "#c5cbce"),
        muted = _cssTok("--muted", "#758696"),
        buy = _cssTok("--buy", "#26de81");
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
      function dimmed(id) { return !!(paint.dim && paint.dim[brandById[id]]); }
      edges.forEach(function (e, ei) {
        var p = geom[e.a], q = geom[e.b];
        if (!p || !q) return;
        var hot = paint.selPool && String(e.poolId) === String(paint.selPool);
        var onPath = paint.pathSet && paint.pathSet[e.poolId];
        var hov = paint.hoverEdge && String(e.poolId) === String(paint.hoverEdge);
        var faint = dimmed(e.a) || dimmed(e.b);
        try {
          ctx.strokeStyle = hot ? buy : ((onPath || hov) ? PATH_WARM : border);
          ctx.lineWidth = (hot || onPath || hov) ? 2.5 : _edgeWidth(paint.meta, e.poolId);
          ctx.globalAlpha = faint ? 0.12 : 1;
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
          ctx.globalAlpha = 1;
        } catch (e2) { try { ctx.globalAlpha = 1; } catch (x) { /* next edge */ } }
        mids.push({ x: (SX(p.x) + SX(q.x)) / 2, y: (SY(p.y) + SY(q.y)) / 2, poolId: e.poolId });
      });
      nodes.forEach(function (n) {
        var g = geom[n.assetId];
        if (!g) return;
        var r = _nodeRadius(deg[n.assetId]);
        var brand = brandById[n.assetId] || "other";
        var hovN = paint.hoverNode && String(n.assetId) === String(paint.hoverNode);
        try {
          ctx.globalAlpha = (paint.dim && paint.dim[brand]) ? 0.15 : 1;
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
   * @param {Object} [opts] {pathPools, selPool, dim, meta} display-only.
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
      meta: opts.meta || {}, hoverNode: null, hoverEdge: null, phys: opts.phys || "calm"
    });
    try {
      canvas.setAttribute("tabindex", "0");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", t("pool_net.canvas_label", "Pool network map. Press Enter to open BTS."));
    } catch (e) { /* stub canvas */ }
    _wire(canvas, { geom: {}, hits: out.hits, mids: out.mids, paint: { scale: 1, ox: 0, oy: 0 } });
    return { empty: out.hits.length === 0 && out.mids.length === 0, nodes: out.hits.length, edges: out.mids.length };
  }

  /* One physics step (preset-driven): repulsion + Hooke springs + center
   * gravity (x3 for BTS prominence) + wall clamp; velocity damping keeps it
   * overdamped so the sleep gate always terminates the loop. Calm reads the
   * v1 shipped constants verbatim; lively reads inverse-square degree-mass
   * repulsion, longer springs, higher carryover, weaker pull. Positions are
   * world coords; Number() here is pixels only, never money. */
  function stepFrame(S) {
    var P = PHYS[S.phys] || PHYS.calm;
    var ids = Object.keys(S.geom);
    var n = ids.length;
    if (n < 2) return 0;
    var k = 0.5 * Math.sqrt((S.W * S.H) / n);
    if (!(k >= 24)) k = 24;
    if (!(k <= 60)) k = 60;
    var cx = S.W / 2, cy = S.H / 2, PAD = EDGE_PAD;
    var i, j, maxStep = 0;
    var ax = {}, ay = {};
    for (i = 0; i < n; i++) { ax[ids[i]] = 0; ay[ids[i]] = 0; }
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        var a = ids[i], b = ids[j];
        var dx = S.geom[a].x - S.geom[b].x, dy = S.geom[a].y - S.geom[b].y;
        var d = Math.sqrt(dx * dx + dy * dy), ux, uy;
        if (d > 0.01) { ux = dx / d; uy = dy / d; }
        else { var ang = ((i * 7 + j) * 2.399963); ux = Math.cos(ang); uy = Math.sin(ang); d = 0.01; }
        /* Lively weights repulsion by endpoint degree mass (hubs push
         * harder, pyvis-barnesHut character: inverse-square with a 400px^2
         * softening so close-range stays finite); calm keeps the v1 formula.
         * Missing deg entries count 0 (isolated nodes) — never NaN. */
        var da = (S.deg && S.deg[a]) || 0, db = (S.deg && S.deg[b]) || 0;
        var deg = 1 + da + db;
        var f = P.repPow === 2
          ? Math.min(P.repK * k * k * deg / (d * d + 400), P.repCap)
          : Math.min((k * k) / (d * d + 1) * 2, P.repCap);
        ax[a] += ux * f; ay[a] += uy * f;
        ax[b] -= ux * f; ay[b] -= uy * f;
      }
    }
    (S.view.edges || []).forEach(function (e) {
      if (!e || !S.geom[e.a] || !S.geom[e.b] || e.a === e.b) return;
      var ex = S.geom[e.a].x - S.geom[e.b].x, ey = S.geom[e.a].y - S.geom[e.b].y;
      var ed = Math.sqrt(ex * ex + ey * ey) || 0.01;
      var f2 = (ed - k * P.springRest) * P.springK;
      ax[e.a] -= (ex / ed) * f2 * ed * 0.1; ay[e.a] -= (ey / ed) * f2 * ed * 0.1;
      ax[e.b] += (ex / ed) * f2 * ed * 0.1; ay[e.b] += (ey / ed) * f2 * ed * 0.1;
    });
    for (i = 0; i < n; i++) {
      var id = ids[i];
      var pull = P.pull * (id === CORE_ID ? P.btsPullX : 1);
      ax[id] += (cx - S.geom[id].x) * pull;
      ay[id] += (cy - S.geom[id].y) * pull;
    }
    for (i = 0; i < n; i++) {
      var id2 = ids[i];
      var v = S.vel[id2] || { x: 0, y: 0 };
      v.x = (v.x + ax[id2]) * P.carry;
      v.y = (v.y + ay[id2]) * P.carry;
      var step = Math.sqrt(v.x * v.x + v.y * v.y);
      if (step > S.temp && step > 0) { v.x = v.x / step * S.temp; v.y = v.y / step * S.temp; }
      S.vel[id2] = v;
      var nx = S.geom[id2].x + v.x, ny = S.geom[id2].y + v.y;
      /* Wall clamp kills the inward velocity component (a node pressed
       * against the wall must not retain full-temp velocity into it —
       * retained velocity fakes maxStep at the temp cap forever, so the
       * sleep gate never fires and the loop spins on a frozen map). */
      if (nx < PAD) { nx = PAD; v.x = 0; }
      else if (nx > S.W - PAD) { nx = S.W - PAD; v.x = 0; }
      if (ny < PAD) { ny = PAD; v.y = 0; }
      else if (ny > S.H - PAD) { ny = S.H - PAD; v.y = 0; }
      S.geom[id2].x = nx;
      S.geom[id2].y = ny;
      step = Math.sqrt(v.x * v.x + v.y * v.y);
      if (step > maxStep) maxStep = step;
    }
    S.temp = Math.max(S.temp * P.cool, P.tempMin);
    return maxStep;
  }

  /* Headless-safe rAF (pool-graph.js precedent: sync fallback, no timers ever). */
  function _raf(fn) {
    try {
      if (typeof requestAnimationFrame !== "undefined") { requestAnimationFrame(fn); return true; }
    } catch (e) { /* sync below */ }
    try { fn(); } catch (e) { /* loop survives */ }
    return false;
  }

  function _cancel(id) {
    try {
      if (id && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(id);
    } catch (e) { /* stopped anyway */ }
  }

  /* Wake the settle loop (drag/zoom/filter/resize/phys-flip wake; sleep
   * cancels it). ALWAYS re-seeds temp/still/frames — even when the loop is
   * already running: an early return here starves every later re-energize
   * (phys-flip, drag-release, filter pages all no-op while the loop spins
   * at floor temp on a parked layout — user-reported "switch does nothing").
   * The running loop picks up fresh temp + preset next frame, so no restart
   * dance is needed; a stopped loop is (re)started below. */
  function wake(S) {
    if (!S || S.dead) return;
    if (S.reduced || S.dead) return;
    if (!S.visible) return;
    if (Object.keys(S.geom).length < 2) return;
    S.still = 0;
    S.frames = 0;
    S.temp = (PHYS[S.phys] || PHYS.calm).temp0;
    if (S.running) return;
    S.running = true;
    loop(S);
  }

  function loop(S) {
    if (!S || S.dead || !S.visible || S.reduced) { if (S) S.running = false; return; }
    var P = PHYS[S.phys] || PHYS.calm;
    S.frames = (S.frames || 0) + 1;
    var moved = 0;
    try { moved = stepFrame(S); } catch (e) { moved = 0; }
    try { render(S); } catch (e) { /* next frame */ }
    if (moved < P.stillTol) S.still++;
    else S.still = 0;
    /* maxFrames is the pyvis-style stabilization budget: even a perfect
     * orbit (or a wall-pinned straggler the clamp missed) terminates.
     * Calm's 900 is pure backstop (it sleeps via the gate long before). */
    if ((P.maxFrames && (S.frames || 0) >= P.maxFrames) ||
        (S.still >= P.stillFrames && (S.frames || 0) >= (P.minFrames || 0))) {
      S.running = false;
      S.settled = true;
      try { render(S); } catch (e) { /* final paint stands */ }
      return;
    }
    S.settled = false;
    _raf(function () {
      S.raf = 0;
      if (!S.dead && S.running) loop(S);
      else S.running = false;
    });
  }

  /* Render current state to the canvas; stores screen-space hits for nav. */
  function render(S) {
    var g = fitCanvas(S.canvas, 300, 320);
    if (!g) return;
    S.W = g.W;
    S.H = g.H;
    var out = drawScene(g.ctx, g.W, g.H, S.view, S.geom, {
      scale: S.scale, ox: S.ox, oy: S.oy, pathSet: S.pathSet,
      selPool: S.selPool, dim: S.dim, meta: S.meta,
      hoverNode: S.hoverNode, hoverEdge: S.hoverEdge, phys: S.phys
    });
    S.hits = out.hits;
    S.mids = out.mids;
  }

  /* CSS-pixel pointer position (null when unavailable). */
  function ptr(canvas, ev) {
    try {
      var box = canvas.getBoundingClientRect();
      return { x: ev.clientX - box.left, y: ev.clientY - box.top };
    } catch (e) { return null; }
  }

  function navigate(hash) {
    try {
      if (typeof window !== "undefined" && window.location) window.location.hash = hash;
    } catch (e) { /* navigation best-effort */ }
  }

  /* navForHit: pure hit record -> hash string (no location write, so the
   * headless audit vectors can prove every edge/node target without a DOM).
   * Edge-mid hits (poolId, no sym) route to the swap desk #/pools/:id (raw
   * 1.19.x, router.js:272); node hits route to #/asset/:symbol
   * (encodeURIComponent so dots stay verbatim and slashes stay route-safe,
   * router.js:243). Null hit -> null (no navigation). Behavior of every
   * handler below is byte-identical to the inline strings it replaces.
   * @param {Object|null} h Hit record ({sym} or {edgeMid, poolId}).
   * @returns {string|null} Hash target, or null for a null hit. */
  function navForHit(h) {
    if (!h) return null;
    if (h.edgeMid) return "#/pools/" + String(h.poolId);
    return "#/asset/" + encodeURIComponent(String(h.sym));
  }

  /* One-time canvas wiring: tap nav + node drag + pan + pinch + wheel zoom +
   * Enter key (pool-graph.js _wire precedent: touch-action none only mid-gesture
   * so page scroll is untouched otherwise; moved drags suppress the click). */
  function _wire(canvas, S) {
    if (!canvas || typeof canvas.addEventListener !== "function") {
      try { canvas._netHits = (S && S.hits) || []; } catch (e) { /* stub */ }
      return;
    }
    try {
      if (canvas._netWired) {
        if (S && S.hits) canvas._netHits = S.hits;
        if (S && S.mids) canvas._netMids = S.mids;
        if (S) canvas._netState = S;
        return;
      }
      canvas._netWired = true;
      canvas._netHits = (S && S.hits) || [];
      canvas._netMids = (S && S.mids) || [];
      canvas._netState = S || null;
    } catch (e) { return; }

    function state() {
      try { return canvas._netState; } catch (e) { return S; }
      return S;
    }
    function toWorld(st, p) {
      var s = (st && st.scale) || 1;
      return { x: (p.x - ((st && st.ox) || 0)) / s, y: (p.y - ((st && st.oy) || 0)) / s };
    }
    function bestAt(st, p) {
      var hits = [], mids = [];
      try { hits = canvas._netHits || []; mids = canvas._netMids || []; } catch (e) { /* none */ }
      var tolN = HIT_TOL / ((st && st.scale) || 1), tolE = tolN, best = null, bestD = 1e9, i, dx, dy, d;
      for (i = 0; i < hits.length; i++) {
        var h = hits[i];
        dx = h.x - p.x; dy = h.y - p.y; d = Math.sqrt(dx * dx + dy * dy);
        var tolh = Math.max(h.r + 5, tolN);
        if (d <= tolh && d < bestD) { bestD = d; best = { kind: "node", hit: h }; }
      }
      for (i = 0; i < mids.length; i++) {
        var m = mids[i];
        dx = m.x - p.x; dy = m.y - p.y; d = Math.sqrt(dx * dx + dy * dy);
        if (d <= tolE && d < bestD) { bestD = d; best = { kind: "edge", hit: m }; }
      }
      return best;
    }

    canvas.addEventListener("click", function (ev) {
      try {
        if (canvas._netSuppress) { canvas._netSuppress = false; return; }
      } catch (e) { /* fall through */ }
      var st = state();
      var p = ptr(canvas, ev);
      if (!p) return;
      var found = bestAt(st, p);
      if (!found) return;
      if (found.kind === "edge") navigate(navForHit({ edgeMid: true, poolId: found.hit.poolId }));
      else navigate(navForHit(found.hit));
    });

    var pointers = {};
    function pointersCount() { return Object.keys(pointers).length; }
    canvas.addEventListener("pointerdown", function (ev) {
      var st = state();
      var p = ptr(canvas, ev);
      if (!p) return;
      try { pointers[ev.pointerId] = p; } catch (e) { /* single-touch path */ }
      if (pointersCount() === 2) {
        var ks = Object.keys(pointers);
        var q1 = pointers[ks[0]], q2 = pointers[ks[1]];
        try {
          st.pinch = { d: Math.hypot(q1.x - q2.x, q1.y - q2.y) || 1, scale: st.scale || 1,
            mx: (q1.x + q2.x) / 2, my: (q1.y + q2.y) / 2, ox: st.ox || 0, oy: st.oy || 0 };
          st.drag = null;
          canvas.style.touchAction = "none";
        } catch (e) { /* pinch stands down */ }
        return;
      }
      if (!st || !st.geom) return;
      var w = toWorld(st, p);
      var tolN = HIT_TOL / (st.scale || 1), hit = null, hitD = 1e9;
      Object.keys(st.geom).forEach(function (id) {
        var gpos = st.geom[id];
        var r = 11;
        try {
          var hs = canvas._netHits || [];
          for (var i = 0; i < hs.length; i++) {
            if (String(hs[i].assetId) === String(id)) { r = (hs[i].r / (st.scale || 1)) || 11; break; }
          }
        } catch (e) { /* default radius */ }
        var ddx = gpos.x - w.x, ddy = gpos.y - w.y, dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd <= Math.max(r + 5, tolN) && dd < hitD) { hitD = dd; hit = id; }
      });
      try {
        if (hit) {
          st.drag = { kind: "node", id: hit, moved: false, sx: p.x, sy: p.y };
          canvas.style.cursor = "grabbing";
        } else {
          st.drag = { kind: "pan", moved: false, sx: p.x, sy: p.y, ox: st.ox || 0, oy: st.oy || 0 };
          canvas.style.cursor = "grabbing";
        }
        if (typeof canvas.setPointerCapture === "function") {
          try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* mouse path */ }
        }
        canvas.style.touchAction = "none";
      } catch (e) { try { st.drag = null; } catch (x) { /* stands */ } }
    });

    canvas.addEventListener("pointermove", function (ev) {
      var st = state();
      var p = ptr(canvas, ev);
      if (!p) return;
      try {
        if (pointers[ev.pointerId]) pointers[ev.pointerId] = p;
      } catch (e) { /* hover path */ }
      if (st && st.pinch && pointersCount() === 2) {
        var ks = Object.keys(pointers);
        var q1 = pointers[ks[0]], q2 = pointers[ks[1]];
        try {
          var dNow = Math.hypot(q1.x - q2.x, q1.y - q2.y) || 1;
          var ns = st.pinch.scale * dNow / st.pinch.d;
          if (!(ns >= 0.3)) ns = 0.3;
          if (!(ns <= 4)) ns = 4;
          var mx = (q1.x + q2.x) / 2, my = (q1.y + q2.y) / 2;
          st.scale = ns;
          st.ox = mx - (st.pinch.mx - st.pinch.ox) * (ns / st.pinch.scale);
          st.oy = my - (st.pinch.my - st.pinch.oy) * (ns / st.pinch.scale);
          try { render(st); } catch (e) { /* loop paints */ }
          if (st.hover) st.hover(p);
        } catch (e) { /* gesture stands */ }
        return;
      }
      if (st && st.drag) {
        if (Math.abs(p.x - st.drag.sx) + Math.abs(p.y - st.drag.sy) > TAP_SLOP) st.drag.moved = true;
        try {
          if (st.drag.kind === "node" && st.geom[st.drag.id]) {
            var w = toWorld(st, p);
            /* Throw tracking: keep the last two world samples + times so
             * release can fling the node (headless-safe clock fallback). */
            var nowMs = 0;
            try { nowMs = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
            catch (e) { try { nowMs = Date.now(); } catch (x) { nowMs = 0; } }
            if (st.drag.px !== undefined) { st.drag.ppx = st.drag.px; st.drag.ppy = st.drag.py; st.drag.pt = st.drag.pt0; }
            st.drag.px = w.x; st.drag.py = w.y; st.drag.pt0 = nowMs;
            st.geom[st.drag.id].x = w.x;
            st.geom[st.drag.id].y = w.y;
            if (st.vel) st.vel[st.drag.id] = { x: 0, y: 0 };
          } else if (st.drag.kind === "pan") {
            st.ox = st.drag.ox + (p.x - st.drag.sx);
            st.oy = st.drag.oy + (p.y - st.drag.sy);
          }
          /* Direct repaint: the gesture must stay visible even when the
           * settle loop is asleep or frozen (reduced-motion) — previously
           * drags only painted via a live loop, so dead-loop drags were
           * invisible until release. */
          try { render(st); } catch (e) { /* loop paints */ }
          if (st.hover) st.hover(p);
        } catch (e) { /* position stands */ }
        return;
      }
      try {
        if (st && st.hover) st.hover(p);
      } catch (e) { /* cursor stands */ }
    });

    function endGesture(ev) {
      var st = state();
      try { delete pointers[ev.pointerId]; } catch (e) { /* single path */ }
      try {
        if (st) {
          if (st.pinch && pointersCount() < 2) st.pinch = null;
          var moved = !!(st.drag && st.drag.moved);
          /* Release throw: a flung node keeps its pointer velocity
           * (clamped to a sane throw) so neighbors visibly react on drop —
           * previously vel stayed zeroed and the drop landed dead. */
          try {
            if (moved && st.drag && st.drag.kind === "node" && st.geom[st.drag.id] &&
                st.drag.ppx !== undefined && st.drag.pt0 !== undefined && st.drag.pt !== undefined &&
                st.drag.pt0 > st.drag.pt) {
              var dt = (st.drag.pt0 - st.drag.pt) / 16.7;
              if (!(dt > 0)) dt = 1;
              var tx = (st.drag.px - st.drag.ppx) / dt, ty = (st.drag.py - st.drag.ppy) / dt;
              var ts = Math.sqrt(tx * tx + ty * ty), TCAP = 12;
              if (ts > TCAP && ts > 0) { tx = tx / ts * TCAP; ty = ty / ts * TCAP; }
              if (isFinite(tx) && isFinite(ty) && st.vel) st.vel[st.drag.id] = { x: tx, y: ty };
            }
          } catch (e) { /* dead drop stands */ }
          st.drag = null;
          canvas.style.touchAction = "";
          canvas.style.cursor = "pointer";
          if (moved) canvas._netSuppress = true;
          if (st.wake) st.wake();
        }
      } catch (e) { /* released anyway */ }
    }
    canvas.addEventListener("pointerup", endGesture);
    canvas.addEventListener("pointercancel", endGesture);

    canvas.addEventListener("wheel", function (ev) {
      var st = state();
      var p = ptr(canvas, ev);
      if (!st || !p) return;
      try {
        if (ev.preventDefault) ev.preventDefault();
        var ns = (st.scale || 1) * Math.exp(-(ev.deltaY || 0) * 0.001);
        if (!(ns >= 0.3)) ns = 0.3;
        if (!(ns <= 4)) ns = 4;
        st.ox = p.x - (p.x - (st.ox || 0)) * (ns / (st.scale || 1));
        st.oy = p.y - (p.y - (st.oy || 0)) * (ns / (st.scale || 1));
        st.scale = ns;
        try { render(st); } catch (e) { /* loop paints */ }
        if (st.hover) st.hover(p);
        if (st.wake) st.wake();
      } catch (e) { /* zoom stands down */ }
    }, { passive: false });

    canvas.addEventListener("keydown", function (ev) {
      if (!ev || (ev.key !== "Enter" && ev.keyCode !== 13)) return;
      var st = state();
      try {
        var hs = [];
        try { hs = canvas._netHits || []; } catch (e) { hs = []; }
        var tgt = null, first = null, i;
        for (i = 0; i < hs.length; i++) {
          if (!first) first = hs[i];
          if (String(hs[i].assetId) === CORE_ID) { tgt = hs[i]; break; }
        }
        tgt = tgt || first;
        if (tgt) {
          if (ev.preventDefault) ev.preventDefault();
          navigate(/** @type {string} */ (navForHit(tgt)));
        }
      } catch (e) { /* navigation best-effort */ }
    });
  }

  /**
   * Mount the pool-network band into a container.
   * @param {Document} doc Owner document.
   * @param {HTMLElement} wrap Band body element (pool-ui.js #pool-net-body).
   * @param {Function} [getSelection] Live filter getter (PoolUI.getSelection bridge).
   * @returns {{redraw: function, destroy: function}} redraw re-reads the
   *   selection (star/union follows the inputs); destroy stops the loop,
   *   observer, and listeners (route-leave cleanup).
   * Failure: never throws (loading note stands); async loads degrade to
   *   skeleton-only, then to an honest offline note + retry.
   */
  function mount(doc, wrap, getSelection) {
    var api = { redraw: function () {}, destroy: function () {} };
    try {
      if (!doc || !wrap) return api;
      var D = _dom();
      function mk(tag, text, cls) {
        var el = D ? D.el(doc, tag, text, cls) : doc.createElement(tag);
        if (!D) {
          if (text !== undefined && text !== null) el.textContent = text;
          if (cls) el.className = cls;
        }
        return el;
      }
      try {
        if (D) D.clear(wrap);
        else { while (wrap.firstChild) wrap.removeChild(wrap.firstChild); }
      } catch (e) { /* children stand */ }

      var reduced = false;
      try {
        if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
          reduced = !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        }
      } catch (e) { reduced = false; }

      var phys0 = readPhys();
      var S = {
        canvas: null, doc: doc, W: 300, H: 320,
        full: { nodes: [], edges: [] }, view: { nodes: [], edges: [] },
        geom: {}, vel: {}, deg: {}, meta: {}, dim: {}, pathSet: {}, pathFull: null,
        sel: { aId: null, bId: null, s: "" }, selPool: null, sig: "",
        scale: 1, ox: 0, oy: 0, hits: [], mids: [],
        hoverNode: null, hoverEdge: null, phys: phys0,
        running: false, settled: true, still: 0, frames: 0,
        temp: (PHYS[phys0] || PHYS.calm).temp0, visible: true,
        dead: false, reduced: reduced, loaded: false, raf: 0, observer: null,
        drag: null, pinch: null, hover: null, wake: null, onResize: null
      };

      var statusEl = mk("p", t("pool_net.loading", "Loading network…"), "muted");
      try { statusEl.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      var canvas = null;
      try { canvas = doc.createElement("canvas"); } catch (e) { canvas = null; }
      if (!canvas) {
        try { wrap.appendChild(statusEl); } catch (e2) { /* stands */ }
        return api;
      }
      S.canvas = canvas;
      try {
        canvas.className = "pool-net-canvas";
        canvas.setAttribute("tabindex", "0");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", t("pool_net.canvas_label", "Pool network map. Press Enter to open BTS."));
      } catch (e) { /* stub canvas */ }
      var hoverEl = mk("div", "", "pool-net-hover");
      try { hoverEl.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      var verdictEl = mk("p", "", "pool-net-verdict");
      var legendEl = mk("div", null, "pool-net-legend");
      var twin = null;
      try {
        twin = doc.createElement("details");
        twin.className = "pool-net-twin";
      } catch (e) { twin = null; }
      var twinSummary = mk("summary", t("pool_net.twin", "Pool rows (%(n)s)", { n: "0" }));
      var twinBox = mk("div", null, "pool-net-twinbox");
      /* Calm/Lively switch (v2): segmented control at the top of the band
       * body. Flipping persists poolNetPhys, re-spreads the layout from the
       * circle seed (a preset flip from a parked equilibrium has ~zero
       * forces to work with — temp alone cannot move it, so the flip
       * re-runs the fresh-load spread instead), then re-energizes via
       * wake(S); reduced-motion freeze in wake/loop covers both presets,
       * so there is no branch here. Pan/zoom (scale/ox/oy) are untouched. */
      var physBar = mk("div", null, "pool-net-phys");
      var calmBtn = mk("button", t("pool_net.phys_calm", "Calm"));
      var livelyBtn = mk("button", t("pool_net.phys_lively", "Lively"));
      try {
        calmBtn.type = "button";
        livelyBtn.type = "button";
        calmBtn.className = "pool-net-physbtn";
        livelyBtn.className = "pool-net-physbtn";
        calmBtn.setAttribute("aria-pressed", S.phys === "calm" ? "true" : "false");
        livelyBtn.setAttribute("aria-pressed", S.phys === "lively" ? "true" : "false");
        if (typeof touchable === "function") { touchable(calmBtn); touchable(livelyBtn); }
      } catch (e) { /* labels stand */ }
      var D2 = _dom();
      try {
        if (D2 && D2.attrs) {
          D2.attrs(physBar, { role: "group", "aria-label": t("pool_net.phys_label", "Network motion") });
        } else {
          physBar.setAttribute("role", "group");
        }
      } catch (e) { /* buttons stand unlabeled */ }
      function setPhys(mode) {
        S.phys = (mode === "lively") ? "lively" : "calm";
        try {
          if (typeof localStorage !== "undefined") localStorage.setItem(PHYS_KEY, S.phys);
        } catch (e) { /* memory-only session */ }
        try {
          calmBtn.setAttribute("aria-pressed", S.phys === "calm" ? "true" : "false");
          livelyBtn.setAttribute("aria-pressed", S.phys === "lively" ? "true" : "false");
        } catch (e) { /* state stands */ }
        /* Fresh spread on flip (see header note): temp alone cannot move a
         * parked equilibrium, so re-seed positions like a fresh load. */
        try {
          if (S.view && S.view.nodes && S.view.nodes.length > 1) {
            S.geom = circleLayout(S.view.nodes, S.W, S.H);
            S.vel = {};
          }
        } catch (e) { /* positions stand */ }
        wake(S);
      }
      try {
        calmBtn.addEventListener("click", function () { setPhys("calm"); });
        livelyBtn.addEventListener("click", function () { setPhys("lively"); });
      } catch (e) { /* static preset stands */ }
      try {
        physBar.appendChild(calmBtn);
        physBar.appendChild(livelyBtn);
        wrap.appendChild(physBar);
        wrap.appendChild(statusEl);
        wrap.appendChild(canvas);
        wrap.appendChild(hoverEl);
        wrap.appendChild(verdictEl);
        wrap.appendChild(legendEl);
        if (twin) { twin.appendChild(twinSummary); twin.appendChild(twinBox); wrap.appendChild(twin); }
      } catch (e) { return api; }

      function getSel() {
        var sel = { aId: null, bId: null, s: "" };
        try {
          if (typeof getSelection === "function") {
            var got = getSelection() || {};
            if (got.aId) sel.aId = String(got.aId);
            if (got.bId) sel.bId = String(got.bId);
            if (got.s) sel.s = String(got.s);
          }
        } catch (e) { /* BTS-empty default stands */ }
        return sel;
      }

      /* Human balance at render (Format only; raw digit string when the
       * precision join missed — never a float, never blank). */
      function humanBal(raw, prec) {
        try {
          if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function" &&
            typeof prec === "number" && prec >= 0 && prec <= 12) return Format.formatAmount(raw, prec);
        } catch (e) { /* raw below */ }
        return String(raw);
      }

      function setStatus(text) {
        try { statusEl.textContent = text; } catch (e) { /* stands */ }
      }

      function poolCount(assetId) {
        var n = 0;
        (S.view.edges || []).forEach(function (e) { if (e.a === assetId || e.b === assetId) n++; });
        return n;
      }

      function hopsText(assetId) {
        if (String(assetId) === CORE_ID) return t("pool_net.direct", "paired with BTS");
        var p = null;
        try {
          if (typeof PoolNet !== "undefined" && PoolNet.findPath) p = PoolNet.findPath(S.full, assetId, CORE_ID);
        } catch (e) { p = null; }
        if (p && p.hops && p.hops.length >= 2) {
          var hops = p.hops.length - 1;
          return hops <= 1 ? t("pool_net.direct", "paired with BTS")
            : t("pool_net.hops", "%(n)s hops to BTS", { n: String(hops) });
        }
        return t("pool_net.orphan", "orphaned from BTS");
      }

      function nodeCard(assetId, sym) {
        return t("pool_net.node_card", "%(sym)s (%(id)s) · %(n)s pools · %(hops)s", {
          sym: String(sym), id: String(assetId), n: String(poolCount(assetId)), hops: hopsText(assetId)
        });
      }

      function edgeCard(poolId) {
        var m = S.meta[poolId] || {};
        var a = m.sym_a || "?", b = m.sym_b || "?";
        if (m.balance_a_raw !== undefined && m.balance_b_raw !== undefined) {
          return t("pool_net.edge_card", "%(pool)s · %(a)s–%(b)s · %(ba)s %(sa)s + %(bb)s %(sb)s", {
            pool: String(poolId), a: String(a), b: String(b),
            ba: humanBal(m.balance_a_raw, m.prec_a), sa: String(a),
            bb: humanBal(m.balance_b_raw, m.prec_b), sb: String(b)
          });
        }
        return t("pool_net.edge_nobal", "%(pool)s · %(a)s–%(b)s", { pool: String(poolId), a: String(a), b: String(b) });
      }

      /* Hover dispatcher (wired into _wire via S.hover): updates the tap-card
       * line + cursor + hover ring, then repaints (no physics wake — hover
       * is display-only). Screen-space hit lists come from the last render. */
      S.hover = function (p) {
        var found = null, foundD = 1e9, i, dx, dy, d;
        var tol = HIT_TOL / (S.scale || 1);
        for (i = 0; i < S.hits.length; i++) {
          var h = S.hits[i];
          dx = h.x - p.x; dy = h.y - p.y; d = Math.sqrt(dx * dx + dy * dy);
          if (d <= Math.max(h.r + 5, tol) && d < foundD) { foundD = d; found = { kind: "node", hit: h }; }
        }
        for (i = 0; i < S.mids.length; i++) {
          var m = S.mids[i];
          dx = m.x - p.x; dy = m.y - p.y; d = Math.sqrt(dx * dx + dy * dy);
          if (d <= tol && d < foundD) { foundD = d; found = { kind: "edge", hit: m }; }
        }
        var nn = found && found.kind === "node" ? String(found.hit.assetId) : null;
        var ne = found && found.kind === "edge" ? String(found.hit.poolId) : null;
        if (nn !== S.hoverNode || ne !== S.hoverEdge) {
          S.hoverNode = nn;
          S.hoverEdge = ne;
          try {
            hoverEl.textContent = found
              ? (found.kind === "node" ? nodeCard(found.hit.assetId, found.hit.sym) : edgeCard(found.hit.poolId))
              : "";
            canvas.style.cursor = found ? "pointer" : "default";
          } catch (e) { /* line stands */ }
          try { render(S); } catch (e) { /* next frame */ }
          try {
            if (S) { canvas._netHits = S.hits; canvas._netMids = S.mids; }
          } catch (e) { /* hits stand */ }
        }
      };
      S.wake = function () { wake(S); };

      function symOf(id) {
        var nodes = (S.full.nodes || []);
        for (var i = 0; i < nodes.length; i++) {
          if (String(nodes[i].assetId) === String(id)) return nodes[i].sym || String(id);
        }
        return String(id);
      }

      /* Re-filter from the live selection: full/star/union (PoolNet owns the
       * set math) + full-graph BFS highlight (visible pools glow; the verdict
       * tells the truth even when the route leaves the union). Fresh circle
       * seed per filter change, transform kept, loop woken. */
      function applySelection() {
        var sel = getSel();
        S.sel = sel;
        S.sig = String(sel.aId || "") + "|" + String(sel.bId || "") + "|" + String(sel.s || "");
        var g = S.full;
        try {
          if (typeof PoolNet !== "undefined" && PoolNet.filterGraph) {
            g = PoolNet.filterGraph(S.full, { aId: sel.aId, bId: sel.bId }) || S.full;
          }
        } catch (e) { g = S.full; }
        S.view = g;
        /* Degree map for lively repulsion mass: {assetId: edgeCount},
         * rebuilt wherever geometry is rebuilt (here — the only such
         * place: mount seeds empty, every paint flows through this). */
        S.deg = {};
        try {
          (S.view.edges || []).forEach(function (e) {
            if (!e) return;
            S.deg[e.a] = (S.deg[e.a] || 0) + 1;
            S.deg[e.b] = (S.deg[e.b] || 0) + 1;
          });
        } catch (e) { /* unweighted repulsion stands */ }
        S.pathSet = {};
        S.pathFull = null;
        if (sel.aId && sel.bId && String(sel.aId) !== String(sel.bId)) {
          try {
            if (typeof PoolNet !== "undefined" && PoolNet.findPath) {
              S.pathFull = PoolNet.findPath(S.full, sel.aId, sel.bId);
            }
          } catch (e) { S.pathFull = null; }
          if (S.pathFull && S.pathFull.pools) {
            var inView = {};
            (S.view.edges || []).forEach(function (e) { inView[String(e.poolId)] = 1; });
            S.pathFull.pools.forEach(function (pid) {
              if (inView[String(pid)]) S.pathSet[String(pid)] = 1;
            });
          }
        }
        S.selPool = (sel.s && POOL_RE.test(sel.s)) ? sel.s : null;
        S.geom = circleLayout(S.view.nodes, S.W, S.H);
        S.vel = {};
        S.hoverNode = null;
        S.hoverEdge = null;
        try { hoverEl.textContent = ""; } catch (e) { /* stands */ }
        paintVerdict();
        rebuildLegend();
        rebuildTwin();
        try { render(S); } catch (e) { /* loop paints */ }
        try {
          canvas._netHits = S.hits;
          canvas._netMids = S.mids;
          canvas._netState = S;
        } catch (e) { /* hits stand */ }
        wake(S);
      }

      function paintVerdict() {
        var sel = S.sel, text = "";
        var nPools = (S.view.edges || []).length, nAssets = (S.view.nodes || []).length;
        if (!sel.aId && !sel.bId) {
          text = t("pool_net.verdict_full", "%(pools)s pools · %(assets)s assets", {
            pools: String(nPools), assets: String(nAssets)
          });
        } else if (sel.aId && sel.bId && String(sel.aId) !== String(sel.bId)) {
          if (S.pathFull && S.pathFull.hops) {
            var hops = S.pathFull.hops.length - 1;
            text = t("pool_net.verdict_path", "%(a)s reaches %(b)s in %(n)s hops", {
              a: symOf(sel.aId), b: symOf(sel.bId), n: String(hops)
            });
          } else {
            text = t("pool_net.verdict_orphan", "No route between %(a)s and %(b)s", {
              a: symOf(sel.aId), b: symOf(sel.bId)
            });
          }
        } else {
          var only = sel.aId || sel.bId;
          text = t("pool_net.verdict_star", "Pools touching %(s)s: %(n)s", {
            s: symOf(only), n: String(nPools)
          });
        }
        try {
          verdictEl.textContent = text;
          canvas.setAttribute("aria-label", text + " " +
            t("pool_net.prompt", "Tap a node for the asset, a line for the pool."));
        } catch (e) { /* text stands */ }
      }

      function rebuildLegend() {
        try {
          if (D) D.clear(legendEl);
          else { while (legendEl.firstChild) legendEl.removeChild(legendEl.firstChild); }
        } catch (e) { return; }
        var seen = {};
        (S.view.nodes || []).forEach(function (n) { seen[brandOf(n.sym)] = 1; });
        var groups = Object.keys(seen).sort();
        if (!groups.length) return;
        try { legendEl.appendChild(mk("span", t("pool_net.legend", "Brands") + " ", "muted")); } catch (e) { /* chips stand */ }
        groups.forEach(function (gr) {
          var chip = null;
          try {
            chip = doc.createElement("button");
            chip.type = "button";
            chip.className = "pool-net-chip" + (S.dim[gr] ? " pool-net-dim" : "");
            chip.setAttribute("aria-pressed", S.dim[gr] ? "false" : "true");
            var sw = doc.createElement("span");
            sw.className = "pool-net-sw";
            sw.style.background = brandFill(gr);
            chip.appendChild(sw);
            chip.appendChild(doc.createTextNode(gr));
          } catch (e) { chip = null; }
          if (!chip) return;
          (function (group, el) {
            el.addEventListener("click", function () {
              try {
                if (S.dim[group]) delete S.dim[group];
                else S.dim[group] = 1;
                el.setAttribute("aria-pressed", S.dim[group] ? "false" : "true");
                try {
                  if (el.className !== undefined) {
                    el.className = "pool-net-chip" + (S.dim[group] ? " pool-net-dim" : "");
                  }
                } catch (e2) { /* state stands */ }
                render(S);
              } catch (e2) { /* legend stands */ }
            });
          })(gr, chip);
          try { legendEl.appendChild(chip); } catch (e) { /* next chip */ }
        });
      }

      /* Screen-reader table twin (spec §6): the same pool rows as the canvas
       * in a collapsed <details> — the canvas is never the only source. Rows
       * navigate to #/pools/:id on tap/Enter via TableRenderer when present,
       * else plain linked rows. Capped with an honest count note. */
      function rebuildTwin() {
        try {
          if (D) D.clear(twinBox);
          else { while (twinBox.firstChild) twinBox.removeChild(twinBox.firstChild); }
        } catch (e) { return; }
        var edges = (S.view.edges || []).slice().sort(function (a, b) {
          return String(a.poolId) < String(b.poolId) ? -1 : 1;
        });
        try {
          twinSummary.textContent = t("pool_net.twin", "Pool rows (%(n)s)", { n: String(edges.length) });
        } catch (e) { /* summary stands */ }
        if (!edges.length) return;
        var shown = edges.slice(0, TWIN_CAP);
        function goPool(pid) { navigate(/** @type {string} */ (navForHit({ edgeMid: true, poolId: pid }))); }
        var TR = null;
        try { TR = (typeof TableRenderer !== "undefined" && TableRenderer) ? TableRenderer : null; } catch (e) { TR = null; }
        var built = false;
        if (TR && typeof TR.render === "function") {
          try {
            var rows = shown.map(function (e) {
              var m = S.meta[e.poolId] || {};
              return { pool: e.poolId, a: m.sym_a || e.a, b: m.sym_b || e.b };
            });
            var table = TR.render({
              columns: [
                { key: "pool", title: t("pool_net.col_pool", "Pool") },
                { key: "a", title: t("pool_net.col_a", "Asset 1") },
                { key: "b", title: t("pool_net.col_b", "Asset 2") }
              ],
              rows: rows,
              keyExtractor: function (r) { return r.pool; },
              onRowClick: function (r) { goPool(r.pool); }
            });
            twinBox.appendChild(table);
            built = true;
          } catch (e) { built = false; }
        }
        if (!built) {
          try {
            var tableF = doc.createElement("table");
            tableF.className = "node-table";
            var thead = doc.createElement("thead");
            var hr = doc.createElement("tr");
            [t("pool_net.col_pool", "Pool"), t("pool_net.col_a", "Asset 1"), t("pool_net.col_b", "Asset 2")].forEach(function (h) {
              var th = doc.createElement("th");
              th.textContent = h;
              try { th.setAttribute("scope", "col"); } catch (e2) { /* stands */ }
              hr.appendChild(th);
            });
            thead.appendChild(hr);
            tableF.appendChild(thead);
            var tbody = doc.createElement("tbody");
            shown.forEach(function (e) {
              var m = S.meta[e.poolId] || {};
              var tr = doc.createElement("tr");
              var tdP = doc.createElement("td");
              var link = doc.createElement("a");
              try { link.setAttribute("href", /** @type {string} */ (navForHit({ edgeMid: true, poolId: e.poolId }))); } catch (e2) { /* text stands */ }
              link.textContent = e.poolId;
              tdP.appendChild(link);
              var tdA = doc.createElement("td");
              tdA.textContent = m.sym_a || e.a;
              var tdB = doc.createElement("td");
              tdB.textContent = m.sym_b || e.b;
              tr.appendChild(tdP);
              tr.appendChild(tdA);
              tr.appendChild(tdB);
              tbody.appendChild(tr);
            });
            tableF.appendChild(tbody);
            twinBox.appendChild(tableF);
          } catch (e) { /* twin stands empty */ }
        }
        if (edges.length > shown.length) {
          try {
            twinBox.appendChild(mk("p",
              t("pool_net.twin_more", "Showing %(shown)s of %(n)s pools — narrow the filter to see fewer.", {
                shown: String(shown.length), n: String(edges.length)
              }), "muted"));
          } catch (e) { /* table stands */ }
        }
      }

      function noteMetaFromSkeleton(skel) {
        try {
          (skel.pools || []).forEach(function (p) {
            if (!S.meta[p.id]) {
              S.meta[p.id] = { sym_a: p.symA, sym_b: p.symB, sym_share: p.symShare, prec_a: p.precA, prec_b: p.precB };
            }
          });
        } catch (e) { /* labels stand */ }
      }

      function noteMetaFromLive(rows) {
        try {
          (rows || []).forEach(function (r) {
            if (!r || !r.id) return;
            S.meta[String(r.id)] = {
              sym_a: r.sym_a || String(r.asset_a_id || "?"), sym_b: r.sym_b || String(r.asset_b_id || "?"),
              sym_share: r.sym_share, prec_a: (typeof r.prec_a === "number" ? r.prec_a : null),
              prec_b: (typeof r.prec_b === "number" ? r.prec_b : null),
              balance_a_raw: r.balance_a_raw, balance_b_raw: r.balance_b_raw
            };
          });
        } catch (e) { /* cards degrade to ids */ }
      }

      function skeletonFirst() {
        function done(skel) {
          if (S.dead) return;
          var g = { nodes: [], edges: [] };
          try {
            if (typeof PoolNet !== "undefined" && PoolNet.fromSkeleton) g = PoolNet.fromSkeleton(skel) || g;
          } catch (e) { /* empty stands */ }
          noteMetaFromSkeleton(skel);
          S.full = g;
          S.loaded = true;
          applySelection();
          setStatus(t("pool_net.ready", "%(pools)s pools · %(assets)s assets", {
            pools: String((S.full.edges || []).length), assets: String((S.full.nodes || []).length)
          }));
          liveBackfill(skel);
        }
        try {
          if (typeof fetch === "function") {
            Promise.resolve().then(function () { return fetch("data/pools.json"); }).then(function (r) { return r.json(); }).then(done, function () { done({ pools: [] }); });
          } else {
            done({ pools: [] });
          }
        } catch (e) { done({ pools: [] }); }
      }

      /* Background live overlay (spec §2): paginate-all list_liquidity_pools
       * via PoolNet.loadAllBatched (single merge at the end; idle yield per
       * page keeps the table interactive), chain legs win over the skeleton,
       * the extra-id cache re-validates, then the band repaints. Partial
       * graphs stand with an honest note; all-offline keeps the skeleton. */
      function liveBackfill(skel) {
        var hasPool = false;
        try { hasPool = (typeof Pool !== "undefined" && Pool && typeof Pool.list === "function"); } catch (e) { hasPool = false; }
        if (!hasPool) {
          if (!(S.full.edges || []).length) setStatus(t("pool_net.offline_empty", "Network unavailable — no skeleton pools cached."));
          return;
        }
        function pageFn(startId) {
          return Pool.list({ limit: 100, startId: startId || "1.19.0" }).then(function (rows) {
            return new Promise(function (res) {
              try {
                setTimeout(function () { res(rows || []); }, 0);
              } catch (e) { res(rows || []); }
            });
          });
        }
        function onLive(all) {
          if (S.dead) return;
          try {
            var merged = S.full;
            if (typeof PoolNet !== "undefined" && PoolNet.mergeLive) merged = PoolNet.mergeLive(S.full, all || []);
            S.full = merged;
            noteMetaFromLive(all);
            try {
              if (PoolNet.reconcileExtraIds) {
                var skelIds = ((skel && skel.pools) || []).map(function (p) { return String(p.id); });
                var liveIds = (all || []).map(function (r) { return String(r.id); });
                PoolNet.reconcileExtraIds(skelIds, liveIds);
              }
            } catch (e) { /* cache best-effort */ }
            applySelection();
            setStatus(t("pool_net.ready", "%(pools)s pools · %(assets)s assets", {
              pools: String((S.full.edges || []).length), assets: String((S.full.nodes || []).length)
            }));
          } catch (e) { /* skeleton stands */ }
        }
        function onFail(e) {
          if (S.dead) return;
          var offline = /not-connected|network/i.test(String((e && e.message) || e || ""));
          try {
            if ((S.full.edges || []).length) {
              setStatus(offline
                ? t("pool_net.offline", "Network unavailable — showing shipped skeleton. Retry when connected.")
                : t("pool_net.partial", "Live update incomplete — showing shipped pools."));
            } else {
              setStatus(t("pool_net.offline", "Network unavailable — showing shipped skeleton. Retry when connected."));
            }
            var retry = mk("button", t("fees.retry", "Retry"));
            retry.type = "button";
            retry.addEventListener("click", function () {
              try { wrap.removeChild(retry); } catch (e2) { /* stands */ }
              setStatus(t("pool_net.loading", "Loading network…"));
              liveBackfill(skel);
            });
            wrap.appendChild(retry);
          } catch (e2) { /* note stands */ }
        }
        try {
          if (typeof PoolNet !== "undefined" && PoolNet.loadAllBatched) {
            PoolNet.loadAllBatched(pageFn, 100).then(onLive, onFail);
          } else {
            pageFn(null).then(function (rows) { onLive(rows || []); }, onFail);
          }
        } catch (e) { onFail(e); }
      }

      _wire(canvas, S);
      try {
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
          S.onResize = function () { if (!S.dead) { try { render(S); } catch (e) { /* stands */ } } };
          window.addEventListener("resize", S.onResize);
        }
      } catch (e) { /* fixed size stands */ }
      try {
        if (typeof IntersectionObserver !== "undefined") {
          S.observer = new IntersectionObserver(function (entries) {
            try {
              var vis = entries && entries[0] ? entries[0].isIntersecting : true;
              S.visible = !!vis;
              if (!vis) { S.running = false; _cancel(S.raf); S.raf = 0; }
              else if (!S.settled && !S.reduced) wake(S);
            } catch (e) { /* visibility stands */ }
          });
          S.observer.observe(canvas);
        }
      } catch (e) { S.observer = null; }

      api.redraw = function () {
        if (S.dead || !S.loaded) return;
        var sig = "";
        try {
          var sel = getSel();
          sig = String(sel.aId || "") + "|" + String(sel.bId || "") + "|" + String(sel.s || "");
        } catch (e) { /* keep sick */ }
        if (sig !== S.sig) {
          try { applySelection(); } catch (e) { /* view stands */ }
        }
      };
      api.destroy = function () {
        S.dead = true;
        S.running = false;
        try { _cancel(S.raf); } catch (e) { /* stopped */ }
        try { if (S.observer) S.observer.disconnect(); } catch (e) { /* down */ }
        try {
          if (typeof window !== "undefined" && S.onResize && typeof window.removeEventListener === "function") {
            window.removeEventListener("resize", S.onResize);
          }
        } catch (e) { /* down */ }
      };

      skeletonFirst();
      return api;
    } catch (e) {
      return api;
    }
  }

  return {
    mount: mount,
    paintGraph: paintGraph,
    _physForTest: _physForTest,
    _defaultPhysForTest: _defaultPhysForTest,
    _navForTest: navForHit,
    _stepForTest: stepFrame,
    _layoutForTest: circleLayout,
    _drawForTest: drawScene,
    _wakeForTest: wake
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolNetUI === "undefined") { globalThis.PoolNetUI = PoolNetUI; }
if (typeof module !== "undefined") { module.exports = PoolNetUI; }
