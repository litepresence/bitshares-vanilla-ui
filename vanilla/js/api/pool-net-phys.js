/* PoolNetPhys: live-then-settle rAF physics for the pool-network band.
 * Owns: PHYS preset table (calm = v1 shipped constants, lively =
 *   pyvis-barnesHut character), persisted preset reader (readPhys),
 *   one-step integrator (stepFrame), headless-safe rAF helpers
 *   (_raf/_cancel), wake + loop with the ~3s (180-frame) run cap.
 * Consumes: nothing (pure math + timers only). loop(S) paints via the
 *   S.paint hook the composer (PoolNetUI.mount) injects — guarded, so
 *   headless states without a painter still step + sleep + terminate.
 * Shared `S` shape (documented ONCE here; paint/gestures/chrome/ui
 *   reference this typedef in prose):
 * @typedef {Object} PoolNetState
 * @property {Object} geom assetId -> {x, y} world coords (mutated in place).
 * @property {Object} vel assetId -> {x, y} velocity (mutated in place).
 * @property {Object} [deg] assetId -> edge count (lively repulsion mass).
 * @property {{nodes: Array, edges: Array}} [view] Filtered graph (springs).
 * @property {number} W World width. @property {number} H World height.
 * @property {number} temp Current temperature (velocity cap).
 * @property {number} still Consecutive sub-tol frames. @property {number} frames Frames this run.
 * @property {string} phys "calm"|"lively" preset key.
 * @property {boolean} [running] Loop live. @property {boolean} [settled] Parked.
 * @property {boolean} [forced] Explicit-gesture run (reduced-motion consent).
 * @property {boolean} [reduced] prefers-reduced-motion. @property {boolean} [visible] On-screen.
 * @property {boolean} [dead] Destroyed. @property {number} [raf] rAF id.
 * @property {Function} [paint] Injected painter (S)->void (ui render).
 *   Absent/null headless (loop skips paint, physics still runs).
 * No signing, no storage beyond the phys preset key, no display strings.
 * Created by: pool-net-ui split (mechanical move from pool-net-ui.js,
 *   zero behavior change; calm constants byte-identical to v1 shipped).
 * CHAIN TRUTH: none here (pixels only). MONEY DISCIPLINE: Number() is
 *   canvas pixels (positions/velocities), never money.
 * Exposes global PoolNetPhys.
 */
var PoolNetPhys = (function () {
  "use strict";

  /* BTS core id: consensus literal (1.3.0 on both chains), not a lookup —
   * the hub gets extra gravity + hub damping. Mirrored in paint/gestures
   * (circle seed, Enter target); same literal, never a lookup. */
  var CORE_ID = "1.3.0";
  var PHYS_KEY = "poolNetPhys";

  /* PHYS presets: calm (v1 shipped constants, plus a 3s pause cap) vs
   * lively (pyvis-barnesHut character: inverse-square degree-mass
   * repulsion, long springs, higher carryover, weaker pull). Run rule
   * (owner call): at most ~3s (180 frames) of motion after load/flip/
   * filter/drag, then the map pauses until the next interaction — no
   * endless tail, no stuck jitter. Wake-ups re-seed and run another 3s.
   * stepFrame/drawScene/loop/wake read S.phys; nothing else branches. */
  var PHYS = {
    calm:   { repPow: 1, repK: 1.0, repCap: 5, carry: 0.8, temp0: 6, cool: 0.98, tempMin: 1,
              springRest: 1.1, springK: 0.015, pull: 0.008, btsPullX: 3,
              stillTol: 0.35, stillFrames: 25, minFrames: 0, maxFrames: 180, curved: false },
    lively: { repPow: 2, repK: 2.6, repCap: 20, carry: 0.98, hubCarry: 0.90, temp0: 7, cool: 0.984, tempMin: 0.2,
              springRest: 2.2, springK: 0.010, pull: 0.003, btsPullX: 3,
              stillTol: 0.25, stillFrames: 120, minFrames: 60, maxFrames: 180, curved: true }
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

  /* One physics step (preset-driven): repulsion + Hooke springs + center
   * gravity (x3 for BTS prominence); velocity damping keeps it overdamped
   * so the sleep gate always terminates the loop. The world is UNBOUNDED
   * (no wall clamp — pan/zoom explores freely; linear center pull grows
   * with distance so nothing escapes). Calm reads the v1 shipped constants
   * verbatim; lively reads inverse-square degree-mass repulsion, longer
   * springs, higher carryover, weaker pull. Positions are world coords;
   * Number() here is pixels only, never money. */
  function stepFrame(S) {
    var P = PHYS[S.phys] || PHYS.calm;
    var ids = Object.keys(S.geom);
    var n = ids.length;
    if (n < 2) return 0;
    var k = 0.5 * Math.sqrt((S.W * S.H) / n);
    if (!(k >= 24)) k = 24;
    if (!(k <= 60)) k = 60;
    var cx = S.W / 2, cy = S.H / 2;
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
      /* Hub damping: the BTS center wobbles longest (every leaf tugs it),
       * so it carries less velocity than leaves — the middle settles in
       * ~1s while the rim keeps drifting. Calm sets no hubCarry and is
       * unaffected. */
      var carr = (id2 === CORE_ID && P.hubCarry) ? P.hubCarry : P.carry;
      v.x = (v.x + ax[id2]) * carr;
      v.y = (v.y + ay[id2]) * carr;
      var step = Math.sqrt(v.x * v.x + v.y * v.y);
      if (step > S.temp && step > 0) { v.x = v.x / step * S.temp; v.y = v.y / step * S.temp; }
      S.vel[id2] = v;
      /* Unbounded world (no wall clamp — pan/zoom explores freely): the
       * linear center pull grows with distance, so nothing escapes. */
      S.geom[id2].x = S.geom[id2].x + v.x;
      S.geom[id2].y = S.geom[id2].y + v.y;
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

  /* Injected paint hook: the composer's S.paint(S), guarded so headless
   * states without a painter still step + sleep + terminate. */
  function paintHook(S) {
    try {
      if (S && typeof S.paint === "function") S.paint(S);
    } catch (e) { /* next frame */ }
  }

  /* Wake the settle loop. ALWAYS re-seeds temp/still/frames — even when the
   * loop is already running: an early return here starves every later
   * re-energize (phys-flip, drag-release, filter pages all no-op while the
   * loop spins at floor temp on a parked layout — user-reported "switch
   * does nothing"). The running loop picks up fresh temp + preset next
   * frame, so no restart dance is needed; a stopped loop is (re)started.
   * Reduced-motion: AUTO wakes (load/filter/scroll/resize) stay frozen, but
   * an EXPLICIT user gesture (Physics flip, drag-release throw) runs a
   * bounded settle anyway — flipping the switch on IS informed consent to
   * motion, and every run self-terminates via the sleep gate + maxFrames.
   * @param {Object} S band state (see PoolNetState above).
   * @param {boolean} [explicit] true when the wake comes straight from a
   *   user gesture (flip/release), never from timers/observers/loads. */
  function wake(S, explicit) {
    if (!S || S.dead) return;
    if ((S.reduced && !explicit) || S.dead) return;
    if (!S.visible) return;
    if (Object.keys(S.geom).length < 2) return;
    S.still = 0;
    S.frames = 0;
    S.temp = (PHYS[S.phys] || PHYS.calm).temp0;
    if (explicit) S.forced = true;
    if (S.running) return;
    S.running = true;
    loop(S);
  }

  function loop(S) {
    if (!S || S.dead || !S.visible || (S.reduced && !S.forced)) {
      if (S) { S.running = false; S.forced = false; }
      return;
    }
    var P = PHYS[S.phys] || PHYS.calm;
    S.frames = (S.frames || 0) + 1;
    var moved = 0;
    try { moved = stepFrame(S); } catch (e) { moved = 0; }
    paintHook(S);
    if (moved < P.stillTol) S.still++;
    else S.still = 0;
    /* maxFrames is the run cap (owner call: ~3s of motion, then pause
     * until the next interaction). Whatever hasn't settled by 180 frames
     * freezes in place — the next wake re-seeds and runs again. */
    if ((P.maxFrames && (S.frames || 0) >= P.maxFrames) ||
        (S.still >= P.stillFrames && (S.frames || 0) >= (P.minFrames || 0))) {
      S.running = false;
      S.settled = true;
      S.forced = false;
      paintHook(S);
      return;
    }
    S.settled = false;
    _raf(function () {
      S.raf = 0;
      if (!S.dead && S.running) loop(S);
      else { S.running = false; S.forced = false; }
    });
  }

  return {
    readPhys: readPhys,
    loop: loop,
    cancel: _cancel,
    PHYS_KEY: PHYS_KEY,
    _physForTest: _physForTest,
    _defaultPhysForTest: _defaultPhysForTest,
    _stepForTest: stepFrame,
    _wakeForTest: wake
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolNetPhys === "undefined") { globalThis.PoolNetPhys = PoolNetPhys; }
if (typeof module !== "undefined") { module.exports = PoolNetPhys; }
