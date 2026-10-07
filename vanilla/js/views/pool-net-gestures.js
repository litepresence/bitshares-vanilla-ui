/* NetGestures: pool-network canvas gestures + pure navigation mapping.
 * Owns: CSS-pixel pointer reader (ptr), location writer (navigate), pure
 *   hit-record -> hash mapping (navForHit, resolveNav opts seam), one-time
 *   canvas wiring (_wire: tap nav + node drag + pan + pinch + wheel zoom +
 *   Enter key). Repaints go through the state's injected S.paint hook
 *   (guarded — a state without a painter simply doesn't repaint mid-gesture;
 *   the loop still paints); wake-ups read S.wake where present.
 * Consumes: nothing global (nav hashes are strings; S shape: see
 *   PoolNetState in pool-net-phys.js — _wire reads st.scale/ox/oy/geom/
 *   vel/drag/pinch/hover/wake/paint/navOpts off S, same as before).
 * No display strings, no money, no chain. Created by: pool-net-ui split
 * (mechanical move from pool-net-ui.js, zero behavior change).
 * Exposes global NetGestures.
 */
var NetGestures = (function () {
  "use strict";

  /* BTS core id: consensus literal (1.3.0 on both chains) — the Enter-key
   * target prefers the BTS node. Same literal as PoolNetPhys/NetPaint. */
  var CORE_ID = "1.3.0";
  /* Hit tolerance + tap slop, CSS pixels (the 44px touch floor comes from
   * hit tolerance, not ink). Canonical owner of these two literals. */
  var HIT_TOL = 22, TAP_SLOP = 5;

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

  /* resolveNav: nav-opts composition seam (Task 2 second-master reuse).
   * Absent opts (or empty/non-function fields) = navForHit pool behavior
   * byte-identical. opts.navEdge(edgeHit) and opts.navNode(nodeHit) each
   * return a hash string or null; a throwing override degrades to null (no
   * navigation), never to the pool default. Pure (no location write).
   * @param {Object|null} hit Hit record ({edgeMid, poolId} or {sym, assetId}).
   * @param {Object} [opts] {navEdge, navNode} override fns.
   * @returns {string|null} Hash target, or null for null hit / null override.
   * Failure: never throws (override exceptions become null). */
  function resolveNav(hit, opts) {
    if (!hit) return null;
    try {
      if (hit.edgeMid) {
        if (opts && typeof opts.navEdge === "function") {
          try { return opts.navEdge(hit); } catch (e) { return null; }
        }
        return navForHit(hit);
      }
      if (opts && typeof opts.navNode === "function") {
        try { return opts.navNode(hit); } catch (e) { return null; }
      }
      return navForHit(hit);
    } catch (e) { return null; }
  }

  /* segDist: distance from a point to a segment, in CSS px. Pure math so the
   * line hit test is unit-testable without a canvas. */
  function segDist(x, y, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return Math.sqrt((x - ax) * (x - ax) + (y - ay) * (y - ay));
    var t = ((x - ax) * dx + (y - ay) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var px = ax + t * dx, py = ay + t * dy;
    return Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
  }

  /* Injected repaint: the state's S.paint(S), guarded (a painter-less
   * state — e.g. the paintGraph one-shot stub — simply skips mid-gesture
   * repaints; the loop still paints live states). */
  function repaint(st) {
    try {
      if (st && typeof st.paint === "function") st.paint(st);
    } catch (e) { /* loop paints */ }
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
      /* Edges: the whole LINE is the target (distance to the segment), not a
       * dot at its midpoint — people aim at the line they can see. Node wins
       * above because a line ends at its nodes and dragging starts there.
       * Records without a segment (older/headless shapes) still fall back to
       * midpoint distance, so nothing that used to hit stops hitting. */
      for (i = 0; i < mids.length; i++) {
        var m = mids[i];
        if (m && (m.ax !== undefined || m.bx !== undefined)) {
          d = segDist(p.x, p.y, m.ax, m.ay, m.bx, m.by);
        } else {
          dx = m.x - p.x; dy = m.y - p.y; d = Math.sqrt(dx * dx + dy * dy);
        }
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
      var navOpts = (st && st.navOpts) || null;
      var dest = null;
      /* Pass the WHOLE edge record, not a {poolId}-only copy: a nav override
       * derives the market from the line's two legs, and stripping them made
       * every edge fall back to the pool desk (or to nothing). */
      if (found.kind === "edge") dest = resolveNav(found.hit, navOpts);
      else dest = resolveNav(found.hit, navOpts);
      if (typeof dest === "string" && dest) navigate(dest);
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
          repaint(st);
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
          repaint(st);
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
           * previously vel stayed zeroed and the drop landed dead.
           * WITH PHYSICS OFF the mesh must stay where it was dropped, so no
           * throw is stored: leftover velocity would drift the graph on the
           * next automatic wake (filter change, resize), which is exactly
           * the "something happens after release" the switch promises not
           * to do. */
          try {
            if (moved && st.react !== false && st.drag && st.drag.kind === "node" && st.geom[st.drag.id] &&
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
        repaint(st);
        if (st.hover) st.hover(p);
        /* No wake: zoom is camera-only (owner call) — only moving nodes
         * (drag-release throw, flip re-spread, filter change) re-energizes. */
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
          var dest = resolveNav(tgt, (st && st.navOpts) || null);
          if (typeof dest === "string" && dest) navigate(/** @type {string} */ (dest));
        }
      } catch (e) { /* navigation best-effort */ }
    });
  }

  return {
    wire: _wire,
    ptr: ptr,
    navigate: navigate,
    navForHit: navForHit,
    resolveNav: resolveNav,
    segDist: segDist,
    HIT_TOL: HIT_TOL,
    TAP_SLOP: TAP_SLOP
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.NetGestures === "undefined") { globalThis.NetGestures = NetGestures; }
if (typeof module !== "undefined") { module.exports = NetGestures; }
