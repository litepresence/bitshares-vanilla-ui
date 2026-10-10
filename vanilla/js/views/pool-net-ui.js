/* PoolNetUI: full-pool-network canvas band for #/pools (COMPOSER).
 * Owns: mount orchestration (S state, selection/filter/data-load flow,
 *   hover dispatcher, resize/observer/redraw/destroy) + the injected
 *   render (S.paint for the physics loop + gestures) + all existing
 *   exports (delegating to the split modules below). The band furniture
 *   (status/verdict/legend/twin/switch) lives in NetChrome, painting in
 *   NetPaint, gestures/nav in NetGestures, physics in PoolNetPhys.
 * Consumes: PoolNet (graph/filter/path/brand/load/cache), Pool.list (live
 *   pages), Format (human balances at render only, via NetChrome), I18n.t
 *   (all strings), DOM shared helpers (never reimplemented here),
 *   Chain.status (offline signal only). No signing, no storage of its own
 *   (PoolNet owns the extra-id cache). Exposes global PoolNetUI.
 * Created by: pool-net Task 6 (plan docs/superpowers/plans/2026-10-06-pool-net-map.md;
 *   spec docs/superpowers/specs/2026-10-06-pool-net-map-design.md §3/§4/§6);
 *   split mechanically into pool-net-{phys,paint,gestures,chrome} with
 *   zero behavior change (same vectors, same gates).
 * CHAIN TRUTH (#4 wins): pool legs/balances <- liquidity_pool_object.hpp via
 *   Pool.list rows; BTS core = 1.3.0 literal (consensus, not a lookup).
 * MONEY DISCIPLINE (#6): balances stay raw digit strings until
 *   Format.formatAmount at render; Number() only for canvas pixels
 *   (radii/widths/positions), never money.
 * PROVENANCE (idea-only, never a dependency): squidKid-deluxe/bitshares-networks
 *   pools/pool_mapper.py (pyvis full-pool network, BFS pricing to BTS 1.3.0,
 *   drag-to-untangle) proposed the full-network map idea; the physics
 *   (now in PoolNetPhys) is a from-scratch Fruchterman-Reingold port to
 *   Canvas2D (same doctrine as PoolGraph.relax: math ported, never imported).
 */
var PoolNetUI = (function () {
  "use strict";

  var POOL_RE = /^1\.19\.\d+$/;

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

  function _dom() {
    if (typeof DOM !== "undefined" && DOM) return DOM;
    return null;
  }

  /* Sibling-module seams (browser: classic <script> order in index.html;
   * node: preloaded below via module.require — tx.js precedent). Bare refs
   * are safe: siblings are load-contract, never optional (PoolNet/Format/
   * TableRenderer stay typeof-guarded: those files may genuinely be absent). */
  function phys() {
    try {
      if (typeof PoolNetPhys !== "undefined" && PoolNetPhys) return PoolNetPhys;
    } catch (e) { /* calm fallback at use */ }
    return null;
  }

  function paint() {
    try {
      if (typeof NetPaint !== "undefined" && NetPaint) return NetPaint;
    } catch (e) { /* no-paint fallback at use */ }
    return null;
  }

  function gestures() {
    try {
      if (typeof NetGestures !== "undefined" && NetGestures) return NetGestures;
    } catch (e) { /* null fallback at use */ }
    return null;
  }

  function chrome() {
    try {
      if (typeof NetChrome !== "undefined" && NetChrome) return NetChrome;
    } catch (e) { /* null fallback at use */ }
    return null;
  }

  /* Render current state to the canvas; stores screen-space hits for nav.
   * Injected as S.paint (the physics loop + gestures repaint through it). */
  function render(S) {
    var NP = paint();
    if (!NP) return;
    var g = NP.fitCanvas(S.canvas, 300, 320);
    if (!g) return;
    S.W = g.W;
    S.H = g.H;
    /* paintState carries the two OPT-IN display fields the account network
     * uses (arrowheads, per-class edge colour). Absent here means absent in
     * the painter, so the pool/market frames are unchanged. */
    var paintState = {
      scale: S.scale, ox: S.ox, oy: S.oy, pathSet: S.pathSet,
      selPool: S.selPool, meta: S.meta,
      hoverNode: S.hoverNode, hoverEdge: S.hoverEdge, phys: "lively"
    };
    if (S.arrows) paintState.arrows = true;
    if (S.labelPx) paintState.labelPx = S.labelPx;
    if (typeof S.edgeClassOf === "function") paintState.edgeClassOf = S.edgeClassOf;
    if (typeof S.nodeFillOf === "function") paintState.nodeFillOf = S.nodeFillOf;
    var out = NP.drawScene(g.ctx, g.W, g.H, S.view, S.geom, paintState);
    S.hits = out.hits;
    S.mids = out.mids;
  }

  /* Selection getter shape (PoolUI.getSelection bridge: trimmed raw inputs
   * plus last resolved asset ids, null when unresolved/cleared).
   * @typedef {Object} NetSelection
   * @property {(string|null)} aId First-leg asset id.
   * @property {(string|null)} bId Second-leg asset id.
   * @property {string} s Raw share/pool input (a 1.19.x id glows when visible).
   */

  /**
   * Mount the pool-network band into a container.
   * @param {Document} doc Owner document.
   * @param {HTMLElement} wrap Band body element (pool-ui.js #pool-net-body).
   * @param {Function} [getSelection] Live filter getter (PoolUI.getSelection bridge).
   * @param {Object} [opts] Nav overrides for second-master reuse:
   *   {navEdge(edgeHit) -> hash|null, navNode(nodeHit) -> hash|null}.
   *   Absent opts = pool behavior byte-identical (edges -> #/pools/:id,
   *   nodes -> #/asset/:symbol). Physics, layout, palette, pool visuals
   *   untouched by opts (nav only).
   * @returns {{redraw: function, destroy: function}} redraw re-reads the
   *   selection (star/union follows the inputs); destroy stops the loop,
   *   observer, and listeners (route-leave cleanup). Injected-graph market
 *   mode (desk volume map): opts {mode: "market", graph, meta} skips the
 *   skeleton fetch + live backfill — S.full/S.meta come from the caller
 *   (volume-gated markets); physics, gestures, selection, paint run
 *   unchanged while pool-only chrome (brands, BTS path) branches inside
 *   NetChrome on S.navOpts.mode.
   * Failure: never throws (loading note stands); async loads degrade to
   *   skeleton-only, then to an honest offline note + retry.
   */
  function mount(doc, wrap, getSelection, opts) {
    var navOpts = opts || null;
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

      var PP = phys();
      /* react = does a GESTURE wake the physics? (owner 2026-07-07 rework:
       * one physics, so this is a flag, not a preset — readReact owns the
       * persisted value and defaults to ON.) */
      var react0 = true;
      try { if (PP && typeof PP.readReact === "function") react0 = PP.readReact(); } catch (e) { /* ON stands */ }
      var temp0 = 7;
      try {
        if (PP && typeof PP._physForTest === "function") temp0 = (PP._physForTest().lively || {}).temp0 || temp0;
      } catch (e) { /* shipped default stands */ }
      var S = {
        canvas: null, doc: doc, W: 300, H: 320,
        full: { nodes: [], edges: [] }, view: { nodes: [], edges: [] },
        geom: {}, vel: {}, deg: {}, meta: {}, hide: {}, pathSet: {}, pathFull: null,
        sel: { aId: null, bId: null, s: "" }, selPool: null, sig: "",
        scale: 1, ox: 0, oy: 0, hits: [], mids: [],
        hoverNode: null, hoverEdge: null, react: react0,
        running: false, settled: true, still: 0, frames: 0,
        temp: temp0, visible: true,
        dead: false, reduced: reduced, loaded: false, raf: 0, observer: null,
        drag: null, pinch: null, hover: null, wake: null, onResize: null,
        /* Opt-in display fields (2026-10-09, account network): arrowheads +
         * per-class edge colour. Absent for the pool/market maps. */
        arrows: !!(navOpts && navOpts.arrows),
        edgeClassOf: (navOpts && typeof navOpts.edgeClassOf === "function") ? navOpts.edgeClassOf : null,
        nodeFillOf: (navOpts && typeof navOpts.nodeFillOf === "function") ? navOpts.nodeFillOf : null,
        /* labelPx: opt-in node-label size (account maps). Absent here means
         * absent in the painter, so pool/market frames stay byte-identical. */
        labelPx: (navOpts && typeof navOpts.labelPx === "number" && navOpts.labelPx > 0) ? navOpts.labelPx : 0,
        navOpts: navOpts
      };
      S.paint = render;

      var NC = chrome();
      if (!NC) return api;
      var touchFn = null;
      try { touchFn = (typeof touchable === "function") ? touchable : null; } catch (e) { touchFn = null; }
      var els = NC.build(doc, mk, t, touchFn, S, wrap);
      if (!els || !els.canvas) return api;
      /* The account network brings its OWN status line (scanned ops, caps,
       * skips — facts this strip cannot know), so the pool chrome's strip is
       * hidden rather than left showing "Loading network…". Pool/market maps
       * never reach this branch. */
      if (accountMode()) {
        try {
          if (els.statusEl) {
            els.statusEl.textContent = "";
            els.statusEl.style.display = "none";
          }
        } catch (eSt) { /* the strip just stays empty */ }
      }
      S.canvas = els.canvas;
      var canvas = els.canvas;

      /* marketMode: injected volume graph (desk map) — pool-only stages
       * (brand filter, BTS path-find) stand down; selection, geometry,
       * physics and paint run unchanged. */
      function marketMode() {
        try { return !!(navOpts && navOpts.mode === "market"); }
        catch (e) { return false; }
      }

      /* accountMode: the 2026-10-09 account network. It reuses this engine
       * but brings its OWN status/detail lines (which state scanned ops,
       * caps and skips — facts this strip cannot know), so the pool/market
       * wording below must not paint over them. */
      function accountMode() {
        try { return !!(navOpts && navOpts.mode === "account"); }
        catch (e) { return false; }
      }
      function setStatusMode(text) {
        if (accountMode()) return;
        setStatus(text);
      }

      function getSel() {        var sel = { aId: null, bId: null, s: "" };
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

      function setStatus(text) {
        try { NC.status(els, text); } catch (e) { /* stands */ }
      }

      /* Hover dispatcher (wired into _wire via S.hover): updates the tap-card
       * line + cursor + hover ring, then repaints (no physics wake — hover
       * is display-only). Screen-space hit lists come from the last render. */
      S.hover = function (p) {
        var HT = 22;
        try {
          var G = gestures();
          if (G && G.HIT_TOL) HT = G.HIT_TOL;
        } catch (e) { /* literal stands */ }
        var found = null, foundD = 1e9, i, dx, dy, d;
        var tol = HT / (S.scale || 1);
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
            els.hoverEl.textContent = found
              ? (found.kind === "node" ? NC.nodeCard(S, t, found.hit.assetId, found.hit.sym) : NC.edgeCard(S, t, found.hit.poolId))
              : "";
            canvas.style.cursor = found ? "pointer" : "default";
          } catch (e) { /* line stands */ }
          try { render(S); } catch (e) { /* next frame */ }
          try {
            if (S) { canvas._netHits = S.hits; canvas._netMids = S.mids; }
          } catch (e) { /* hits stand */ }
        }
      };
      S.wake = function () {
        try {
          var P2 = phys();
          if (P2) P2._wakeForTest(S, true);
        } catch (e) { /* loop stands */ }
      };

      /* onBrandToggle: a legend chip was switched. Re-run the whole filter
       * (selection + hidden brands) so the survivors keep their positions and
       * the returning nodes are seeded to spring in, then wake the loop — the
       * mesh re-settles instead of popping. The verdict and the table twin are
       * rebuilt too, so "off" means off everywhere, not just on the canvas. */
      function onBrandToggle() {
        try {
          if (S.dead) return;
          applySelection();
          var st = paint();
          if (st && typeof st.nodeRadius === "function") { /* painter loaded */ }
          try { var PP = phys(); if (PP && typeof PP._wakeForTest === "function") PP._wakeForTest(S); } catch (eW) { /* loop stands */ }
        } catch (e) { /* legend stands */ }
      }

      /* Re-filter from the live selection: full/star/union (PoolNet owns the
       * set math) + full-graph BFS highlight (visible pools glow; the verdict
       * tells the truth even when the route leaves the union). Geometry is
       * spring-preserving (see reseedGeom); the loop is woken after. */
      function applySelection() {
        var sel = getSel();
        S.sel = sel;
        S.sig = String(sel.aId || "") + "|" + String(sel.bId || "") + "|" + String(sel.s || "");
        var g = S.full;
        /* Fill-web exception (market selector, owner 2026-10-07): the graph
         * is ALREADY grown from the typed asset(s) — 3 hops, no caps — so a
         * band-side star filter would amputate hops 2-3 and the "3-hop web"
         * would paint as a 1-hop star. With 0-1 legs selected the full web
         * stands (the status line already reports full counts, so view and
         * status agree); with BOTH legs the pair union still focuses the
         * comparison. The ticker fallback (no route channel) keeps the old
         * star behavior — it is a 1-hop graph and the star is all it has. */
        var fillWeb = false;
        try {
          fillWeb = marketMode() && !!(navOpts && navOpts.route && navOpts.route.assetPath);
        } catch (eF) { fillWeb = false; }
        var oneLeg = !(sel.aId && sel.bId && String(sel.aId) !== String(sel.bId));
        try {
          if (typeof PoolNet !== "undefined" && PoolNet.filterGraph) {
            if (fillWeb && oneLeg) g = S.full;
            else g = PoolNet.filterGraph(S.full, { aId: sel.aId, bId: sel.bId }) || S.full;
          }
        } catch (e) { g = S.full; }
        /* Brand toggles FILTER, they do not dim: a hidden group's nodes and
         * every edge touching them leave the plot entirely (a dimmed node was
         * still in the physics, in the hit list and in the twin). */
        var hiding = false;
        try { for (var hk in S.hide) if (Object.prototype.hasOwnProperty.call(S.hide, hk) && S.hide[hk]) { hiding = true; break; } } catch (eH) { hiding = false; }
        if (hiding) {
          try {
            if (typeof PoolNet !== "undefined" && PoolNet.filterBrands) g = PoolNet.filterBrands(g, S.hide) || g;
          } catch (eB) { /* full graph stands */ }
        }
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
        /* Pool-only route highlight (BTS hops over pool edges): market
         * graphs carry no pool path data, so the stage stays unlit rather
         * than drawing a fiction. */
        if (!marketMode() && sel.aId && sel.bId && String(sel.aId) !== String(sel.bId)) {
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
        /* Geometry: survivors keep their position and newcomers are seeded on
         * a ring, so a brand toggle SPRINGS (the loop then pulls them into the
         * mesh) instead of the whole map jumping to a fresh circle. */
        var NP = paint();
        var seeded = null;
        try {
          if (typeof PoolNet !== "undefined" && PoolNet.reseedGeom) {
            seeded = PoolNet.reseedGeom(S.geom, S.view.nodes, S.W, S.H);
          }
        } catch (eR) { seeded = null; }
        if (seeded && seeded.geom) S.geom = seeded.geom;
        else S.geom = NP ? NP.circleLayout(S.view.nodes, S.W, S.H) : {};
        S.vel = {};
        S.hoverNode = null;
        S.hoverEdge = null;
        try { els.hoverEl.textContent = ""; } catch (e) { /* stands */ }
        /* Account mode brings its own status/detail lines and table twin:
         * the pool verdict, brand legend and pool twin paint calls stand
         * down here (their containers are not even mounted — see
         * buildChrome). Pool/market frames are untouched. */
        if (!accountMode()) {
          NC.verdict(S, els, t);
          NC.legend(doc, mk, t, S, els, render, onBrandToggle);
          NC.twin(doc, mk, t, S, els, navOpts);
        }
        try { render(S); } catch (e) { /* loop paints */ }
        try {
          canvas._netHits = S.hits;
          canvas._netMids = S.mids;
          canvas._netState = S;
        } catch (e) { /* hits stand */ }
        try {
          var P3 = phys();
          if (P3) P3._wakeForTest(S);
        } catch (e) { /* loop stands */ }
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

      /* Injected market graph (desk volume map): caller-owned {nodes,
       * edges} + edge meta — no skeleton fetch, no live backfill, no pool
       * cache touch. Selection, geometry, physics and paint run the same
       * path below (applySelection reads S.full/S.meta whatever filled
       * them); pool-only chrome branches on S.navOpts.mode inside
       * NetChrome. Honest empty stands (a filter with no volume is a
       * normal state, not an error). */
      function mountMarketGraph() {
        if (S.dead) return;
        var g = { nodes: [], edges: [] };
        try {
          var ig = navOpts.graph || {};
          if (ig && Array.isArray(ig.nodes) && Array.isArray(ig.edges)) g = ig;
        } catch (e) { /* empty stands */ }
        try {
          S.meta = (navOpts.meta && typeof navOpts.meta === "object") ? navOpts.meta : {};
        } catch (e) { S.meta = {}; }
        /* BTS route from the caller's fills-weighted route (MarketHops). The
         * band pathSet is exactly the pool band\'s own-line+BTS-route glow,
         * so the market world gets the same affordance for the same reason:
         * it is the structure the user came to read. Absent/failed route =
         * nothing glows, which is honest (a thin web is normal). */
        S.pathSet = {};
        try {
          var rt = (navOpts.route && Array.isArray(navOpts.route.assetPath)) ? navOpts.route.assetPath : null;
          var MH = (typeof MarketHops !== "undefined" && MarketHops) ? MarketHops : null;
          if (rt && MH && typeof MH.deskIdsFor === "function") {
            MH.deskIdsFor({ assetPath: rt }, (S.full.edges || [])).forEach(function (id) { S.pathSet[String(id)] = 1; });
          }
        } catch (eRt) { /* no route highlight */ }
        S.full = g;
        S.loaded = true;
        /* applySelection recomputes pathSet from the pool-only BTS path stage,
         * which does not apply to a market graph, so restore ours after. */
        applySelection();
        try {
          var rt2 = (navOpts.route && Array.isArray(navOpts.route.assetPath)) ? navOpts.route.assetPath : null;
          var MH2 = (typeof MarketHops !== "undefined" && MarketHops) ? MarketHops : null;
          if (rt2 && MH2 && typeof MH2.deskIdsFor === "function") {
            S.pathSet = {};
            MH2.deskIdsFor({ assetPath: rt2 }, (S.full.edges || [])).forEach(function (id) { S.pathSet[String(id)] = 1; });
          }
        } catch (eRt2) { /* no route highlight */ }
        try { render(S); } catch (eRr) { /* loop paints */ }
        var nE = (S.full.edges || []).length, nN = (S.full.nodes || []).length;
        /* Status states which world is on screen: the full 24h fill web, or
         * the 1-hop ticker fallback (index unavailable). Never both claims. */
        if (!nE) setStatusMode(t("market_net.map_empty", "No markets with recent volume."));
        else if (navOpts.fallback) setStatusMode(t("market_net.map_fallback", "%(pairs)s pairs \u00b7 %(assets)s assets \u00b7 24h fills unconfirmed", {
          pairs: String(nE), assets: String(nN)
        }));
        else setStatusMode(t("market_net.map_hops_ready", "%(pairs)s pairs \u00b7 %(assets)s assets \u00b7 24h fills", {
          pairs: String(nE), assets: String(nN)
        }));
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

      var G = gestures();
      if (G) {
        try { G.wire(canvas, S); } catch (e) { /* taps stand down */ }
      }
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
              if (!vis) {
                S.running = false;
                try {
                  var P4 = phys();
                  if (P4) P4.cancel(S.raf);
                } catch (e2) { /* stopped anyway */ }
                S.raf = 0;
              }
              else if (!S.settled && !S.reduced) {
                try {
                  var P5 = phys();
                  if (P5) P5._wakeForTest(S);
                } catch (e2) { /* visibility stands */ }
              }
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
        try {
          var P6 = phys();
          if (P6) P6.cancel(S.raf);
        } catch (e) { /* stopped */ }
        try { if (S.observer) S.observer.disconnect(); } catch (e) { /* down */ }
        try {
          if (typeof window !== "undefined" && S.onResize && typeof window.removeEventListener === "function") {
            window.removeEventListener("resize", S.onResize);
          }
        } catch (e) { /* down */ }
      };

      /* An injected graph is an injected graph: any mode that hands one over
       * gets it mounted (market map + the 2026-10-09 account network). The
       * gate used to test mode === "market", so the account page silently
       * fell through to skeletonFirst() and drew the POOL skeleton over the
       * account graph it had just built. Pool mode passes no graph, so the
       * skeleton path is still exactly the pool path. */
      if (navOpts && navOpts.graph && Array.isArray(navOpts.graph.nodes)) mountMarketGraph();
      else skeletonFirst();
      return api;
    } catch (e) {
      return api;
    }
  }

  /* One-shot paint seam: delegates to NetPaint (same return contract). */
  function paintGraph(canvas, graph, opts) {
    try {
      var NP = paint();
      if (NP && typeof NP.paintGraph === "function") return NP.paintGraph(canvas, graph, opts);
    } catch (e) { /* null below */ }
    return null;
  }

  /* Nav composition seam: delegates to NetGestures (pool-default when
   * present, null when the gestures module is somehow unloaded). */
  function resolveNav(hit, opts) {
    try {
      var G = gestures();
      if (G && typeof G.resolveNav === "function") return G.resolveNav(hit, opts);
    } catch (e) { return null; }
    return null;
  }

  function _physForTest() {
    var P = phys();
    if (P && typeof P._physForTest === "function") return P._physForTest();
    return null;
  }

  function _defaultReactForTest() {
    var P = phys();
    if (P && typeof P._defaultReactForTest === "function") return P._defaultReactForTest();
    return "calm";
  }

  function _navForTest(h) {
    var G = gestures();
    if (G && typeof G.navForHit === "function") return G.navForHit(h);
    return null;
  }

  function _stepForTest(S) {
    var P = phys();
    if (P && typeof P._stepForTest === "function") return P._stepForTest(S);
    return NaN;
  }

  function _layoutForTest(nodes, W, H) {
    var NP = paint();
    if (NP && typeof NP.circleLayout === "function") return NP.circleLayout(nodes, W, H);
    return {};
  }

  function _drawForTest(ctx, W, H, view, geom, p) {
    var NP = paint();
    if (NP && typeof NP.drawScene === "function") return NP.drawScene(ctx, W, H, view, geom, p);
    return { hits: [], mids: [] };
  }

  function _wakeForTest(S, explicit) {
    var P = phys();
    if (P && typeof P._wakeForTest === "function") return P._wakeForTest(S, explicit);
    return undefined;
  }

  return {
    mount: mount,
    paintGraph: paintGraph,
    resolveNav: resolveNav,
    _physForTest: _physForTest,
    _defaultReactForTest: _defaultReactForTest,
    _navForTest: _navForTest,
    _stepForTest: _stepForTest,
    _layoutForTest: _layoutForTest,
    _drawForTest: _drawForTest,
    _wakeForTest: _wakeForTest
  };
})();

/* Node suites require() this file directly (tooling/*-test.js) while the
 * browser loads the split siblings via <script> order. Pull the split
 * modules through the module loader WITHOUT naming `require` (checkJs runs
 * browser libs — a bare require() call is TS2591 there; seam-cast keeps the
 * node path working — tx.js precedent). module.require resolves relative to
 * THIS file, like require(). */
var __netRequire = null;
try {
  if (typeof module !== "undefined" && module && /** @type {any} */ (module).require && /** @type {any} */ (module).require.bind) __netRequire = /** @type {any} */ (module).require.bind(module);
} catch (e) { __netRequire = null; }
if (__netRequire && typeof globalThis !== "undefined") {
  try { if (typeof globalThis.PoolNetPhys === "undefined") __netRequire("../api/pool-net-phys.js"); } catch (e) { /* browser tags */ }
  try { if (typeof globalThis.NetPaint === "undefined") __netRequire("./pool-net-paint.js"); } catch (e) { /* browser tags */ }
  try { if (typeof globalThis.NetGestures === "undefined") __netRequire("./pool-net-gestures.js"); } catch (e) { /* browser tags */ }
  try { if (typeof globalThis.NetChrome === "undefined") __netRequire("./pool-net-chrome.js"); } catch (e) { /* browser tags */ }
}

if (typeof globalThis !== "undefined" && typeof globalThis.PoolNetUI === "undefined") { globalThis.PoolNetUI = PoolNetUI; }
if (typeof module !== "undefined") { module.exports = PoolNetUI; }
