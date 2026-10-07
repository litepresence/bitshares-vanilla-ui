#!/usr/bin/env node
/* Pool-net-ui paint vectors: 3-node graph paints arcs + labels on a stub ctx.
 * Headless (no DOM, no chain, no browser). Exit 0 green, 1 red. */
"use strict";
globalThis.PoolNet = require("/workspace/vanilla/js/api/pool-net.js");
var PoolNetUI = require("/workspace/vanilla/js/views/pool-net-ui.js");

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}

function stubCtx() {
  var counts = { arc: 0, fillText: 0 };
  var ctx = {
    setTransform: function () {}, clearRect: function () {},
    save: function () {}, restore: function () {},
    beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
    stroke: function () {}, closePath: function () {},
    arc: function () { counts.arc++; },
    fill: function () {},
    fillText: function () { counts.fillText++; },
    strokeText: function () {},
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "",
    textAlign: "", globalAlpha: 1, shadowColor: "", shadowBlur: 0
  };
  return { ctx: ctx, counts: counts };
}

function fakeEl(tag) {
  var el = { tag: tag, children: [], style: {}, textContent: "", className: "" };
  el.setAttribute = function () {};
  el.getAttribute = function () { return null; };
  el.appendChild = function (c) { el.children.push(c); return c; };
  el.addEventListener = function () {};
  el.removeEventListener = function () {};
  return el;
}

var skel = { pools: [
  { id: "1.19.1", a: "1.3.0", b: "1.3.1", share: "1.3.10", symA: "BTS", symB: "USD", symShare: "LP1", precA: 5, precB: 4, precShare: 4 },
  { id: "1.19.2", a: "1.3.0", b: "1.3.2", share: "1.3.11", symA: "BTS", symB: "BTC", symShare: "LP2", precA: 5, precB: 8, precShare: 4 }
]};

(function () {
  var graph = globalThis.PoolNet.fromSkeleton(skel);
  ok(graph.nodes.length === 3 && graph.edges.length === 2, "3-node fixture graph");
  var stub = stubCtx();
  var canvas = fakeEl("canvas");
  canvas.clientWidth = 300;
  canvas.clientHeight = 320;
  canvas.getContext = function () { return stub.ctx; };
  canvas.getBoundingClientRect = function () { return { left: 0, top: 0 }; };
  var res = PoolNetUI.paintGraph(canvas, graph, {});
  ok(res && res.nodes === 3, "paintGraph reports 3 nodes");
  ok(res && res.edges === 2, "paintGraph reports 2 edges");
  ok(stub.counts.arc >= 3, "stub ctx records >=3 arcs (got " + stub.counts.arc + ")");
  ok(stub.counts.fillText >= 3, "stub ctx records >=3 labels (got " + stub.counts.fillText + ")");
})();

(function () {
  var doc = { createElement: function (tag) { return fakeEl(tag); } };
  var wrap = fakeEl("div");
  var handle = PoolNetUI.mount(doc, wrap, function () { return { aId: null, bId: null, s: "" }; });
  ok(handle && typeof handle.redraw === "function" && typeof handle.destroy === "function", "mount returns {redraw, destroy}");
  try { handle.destroy(); ok(true, "destroy runs headless"); }
  catch (e) { ok(false, "destroy runs headless"); }
})();

/* Task 1 (pool-net v2: lively preset + Calm/Lively switch) — preset table,
 * calm default, material lively/calm deltas, curves only on lively,
 * byte-identical calm constants, headless step/draw smoke on both presets. */
(function () {
  var phys = (typeof PoolNetUI._physForTest === "function") ? PoolNetUI._physForTest() : null;
  ok(phys && phys.calm && phys.lively, "phys presets: calm + lively exist");
  ok(typeof PoolNetUI._defaultPhysForTest === "function" && PoolNetUI._defaultPhysForTest() === "calm", "default phys is calm");
  if (!phys || !phys.calm || !phys.lively) return;
  ok(phys.lively.carry > phys.calm.carry, "lively carryover higher");
  ok(phys.lively.stillFrames > phys.calm.stillFrames, "lively sleeps later");
  ok(phys.lively.curved === true && phys.calm.curved !== true, "curves only lively");
  ok(phys.calm.carry === 0.8 && phys.calm.stillFrames === 25 && phys.calm.temp0 === 6 &&
    phys.calm.cool === 0.98 && phys.calm.tempMin === 1 && phys.calm.pull === 0.008 &&
    phys.calm.springRest === 1.1 && phys.calm.springK === 0.015 && phys.calm.repCap === 5,
    "calm constants byte-identical to v1 shipped behavior");
  ok(phys.lively.repPow === 2 && phys.lively.minFrames === 60 &&
    phys.lively.carry === 0.98 && phys.lively.hubCarry === 0.90 && phys.lively.cool === 0.984 && phys.lively.tempMin === 0.2 &&
    phys.lively.temp0 === 7 && phys.lively.repCap === 20 &&
    phys.lively.springK === 0.010 && phys.lively.springRest === 2.2 && phys.lively.maxFrames === 180 &&
    phys.calm.maxFrames === 180,
    "3s pause rule: both presets cap at 180 frames (lively softened tune + hub damping pinned)");
  function simState(mode) {
    return {
      phys: mode, W: 300, H: 320, temp: 6, still: 0, frames: 0,
      geom: { "1.3.0": { x: 150, y: 160 }, "1.3.1": { x: 60, y: 60 }, "1.3.99": { x: 250, y: 260 } },
      vel: {}, deg: { "1.3.0": 2, "1.3.1": 1 },
      view: { edges: [{ a: "1.3.0", b: "1.3.1", poolId: "1.19.1" }] }
    };
  }
  if (typeof PoolNetUI._stepForTest === "function") {
    ["calm", "lively"].forEach(function (mode) {
      var S = simState(mode), moved = -1, threw = false;
      try { moved = PoolNetUI._stepForTest(S); } catch (e) { threw = true; }
      ok(!threw && isFinite(moved), mode + " stepFrame finite (isolated node, no NaN deg)");
    });
  } else {
    ok(false, "_stepForTest exported for headless physics smoke");
  }
  var stub = stubCtx();
  var graph = globalThis.PoolNet.fromSkeleton(skel);
  var laid = PoolNetUI._layoutForTest ? PoolNetUI._layoutForTest(graph.nodes, 300, 320) : null;
  if (laid) {
    ["calm", "lively"].forEach(function (mode) {
      var threw = false, out = null;
      try {
        out = PoolNetUI._drawForTest(stub.ctx, 300, 320, graph, laid, {
          scale: 1, ox: 0, oy: 0, pathSet: {}, selPool: null, dim: {}, meta: {},
          hoverNode: null, hoverEdge: null, phys: mode
        });
      } catch (e) { threw = true; }
      ok(!threw && out && out.mids.length === 2, mode + " drawScene paints 2 edges headless (curves need no quadraticCurveTo)");
    });
  } else {
    ok(false, "_layoutForTest/_drawForTest exported for headless draw smoke");
  }
})();

/* Task 2 (link audit: every node -> #/asset/:symbol, every edge-mid ->
 * #/pools/:id). Pure resolver vectors against stub hit records (plot A:
 * full-network band, incl. the Task-1 switch — nav is preset-independent).
 * Twin rows + keyboard Enter resolve through the same mapping. */
(function () {
  function eqNav(got, want, name) {
    ok(got === want, name + " (got " + JSON.stringify(got) + ", want " + JSON.stringify(want) + ")");
  }
  var nav = (typeof PoolNetUI._navForTest === "function") ? PoolNetUI._navForTest : null;
  ok(typeof PoolNetUI._navForTest === "function", "_navForTest exported (pure hit -> hash)");
  if (!nav) return;
  eqNav(nav({ x: 10, y: 10, assetId: "1.3.0", sym: "BTS" }), "#/asset/BTS", "node tap -> asset page");
  eqNav(nav({ edgeMid: true, x: 50, y: 50, poolId: "1.19.66" }), "#/pools/1.19.66", "edge-mid tap -> swap desk");
  eqNav(nav({ x: 1, y: 1, assetId: "1.3.999", sym: "XBTSX.BTC" }), "#/asset/XBTSX.BTC", "dotted symbol verbatim (encodeURIComponent, slash-safe)");
  eqNav(nav({ x: 1, y: 1, assetId: "1.3.999", sym: "A/B" }), "#/asset/A%2FB", "slash in symbol escaped (route-safe)");
  eqNav(nav(null), null, "null hit -> null (no navigation)");
  eqNav(nav({ x: 1, y: 1, assetId: "1.3.0", sym: "BTS" }), "#/asset/BTS", "keyboard Enter target (BTS-or-first) resolves to asset page");
})();

/* v2 lively-frozen regression (user report: switch "does nothing"): from an
 * identical spread start, 300 lively steps must travel FARTHER than 300 calm
 * steps (overshoot + longer run). A 1/d^3 repulsion typo once made lively
 * weaker than calm at all working distances (frozen map) — this locks it. */
(function () {
  function ringState(mode) {
    var geom = { hub: { x: 400, y: 300 } }, deg = { hub: 8 }, edges = [];
    for (var i = 0; i < 8; i++) {
      var id = "n" + i, a = (i / 8) * Math.PI * 2;
      geom[id] = { x: 400 + 120 * Math.cos(a), y: 300 + 120 * Math.sin(a) };
      deg[id] = 1; edges.push({ a: "hub", b: id, poolId: "1.19." + i });
    }
    var nodes = [{ assetId: "hub" }].concat(Object.keys(geom).filter(function (k) { return k !== "hub"; }).map(function (k) { return { assetId: k }; }));
    var P = PoolNetUI._physForTest()[mode] || PoolNetUI._physForTest().calm;
    return { phys: mode, W: 800, H: 600, temp: P.temp0, still: 0, frames: 0,
      geom: geom, vel: {}, deg: deg, view: { nodes: nodes, edges: edges } };
  }
  function pathFor(mode, steps) {
    var S = ringState(mode), path = 0, i, id, px = {}, first = true;
    for (var s = 0; s < steps; s++) {
      if (!first) {
        for (id in S.geom) path += Math.hypot(S.geom[id].x - px[id][0], S.geom[id].y - px[id][1]);
      }
      for (id in S.geom) px[id] = [S.geom[id].x, S.geom[id].y];
      first = false;
      try { PoolNetUI._stepForTest(S); } catch (e) { return -1; }
    }
    return path;
  }
  var calm = pathFor("calm", 300), lively = pathFor("lively", 300);
  ok(calm > 0 && lively > 0, "both presets travel (calm=" + Math.round(calm) + " lively=" + Math.round(lively) + ")");
  ok(lively > calm * 1.5, "lively out-travels calm 1.5x (got " + (calm > 0 ? (lively / calm).toFixed(2) : "?") + "x)");
})();

/* wake re-energize regression (user report: flip + drag-release "do nothing"
 * while the loop spins at floor temp on a parked layout). wake() must reset
 * temp/still/frames even when the loop is already running — the old
 * early-return skipped the reset, so nothing ever re-energized. */
(function () {
  ok(typeof PoolNetUI._wakeForTest === "function", "_wakeForTest exported");
  if (typeof PoolNetUI._wakeForTest !== "function") return;
  var wake = PoolNetUI._wakeForTest;
  // running loop at floor temp: wake must re-seed energy without restarting
  var S = {
    phys: "lively", W: 300, H: 320, temp: 0.5, still: 77, frames: 999,
    running: true, settled: false, dead: false, reduced: false, visible: true,
    geom: { "1.3.0": { x: 150, y: 160 }, "1.3.1": { x: 60, y: 60 } },
    vel: {}, deg: { "1.3.0": 1, "1.3.1": 1 },
    view: { edges: [{ a: "1.3.0", b: "1.3.1", poolId: "1.19.1" }] }
  };
  try { wake(S); } catch (e) { ok(false, "wake on running loop throws: " + e); return; }
  var livelyT0 = PoolNetUI._physForTest().lively.temp0;
  ok(S.temp === livelyT0 && S.still === 0 && S.frames === 0, "wake re-seeds temp/still/frames on a running loop (temp=" + S.temp + ")");
  ok(S.running === true, "running loop stays running (no double-start)");
  // stopped loop: wake restarts and runs to sleep synchronously headless
  var S2 = {
    phys: "calm", W: 300, H: 320, temp: 1, still: 25, frames: 900,
    running: false, settled: true, dead: false, reduced: false, visible: true,
    geom: { "1.3.0": { x: 150, y: 160 }, "1.3.1": { x: 60, y: 60 }, "1.3.99": { x: 250, y: 260 } },
    vel: {}, deg: { "1.3.0": 2, "1.3.1": 1 },
    view: { edges: [{ a: "1.3.0", b: "1.3.1", poolId: "1.19.1" }] }
  };
  try { wake(S2); } catch (e) { ok(false, "wake on stopped loop throws: " + e); return; }
  ok(S2.settled === true && S2.running === false, "stopped loop restarts and settles (temp re-seeded to " + S2.temp + ")");
})();

/* Reduced-motion policy (user env repro: frozen map, dead switch, dead
 * release): AUTO wakes stay frozen, but an EXPLICIT gesture (Physics flip,
 * drag-release throw) runs a bounded settle — the flip itself is consent. */
(function () {
  if (typeof PoolNetUI._wakeForTest !== "function") { ok(false, "_wakeForTest still exported"); return; }
  var wake = PoolNetUI._wakeForTest;
  function rmState(explicit) {
    return {
      phys: "calm", W: 300, H: 320, temp: 1, still: 25, frames: 900,
      running: false, settled: true, dead: false, reduced: true, visible: true,
      geom: { "1.3.0": { x: 150, y: 160 }, "1.3.1": { x: 60, y: 60 }, "1.3.99": { x: 250, y: 260 } },
      vel: {}, deg: { "1.3.0": 2, "1.3.1": 1 },
      view: { edges: [{ a: "1.3.0", b: "1.3.1", poolId: "1.19.1" }] },
      _explicit: explicit
    };
  }
  var auto = rmState(false);
  try { wake(auto); } catch (e) { ok(false, "auto wake reduced throws: " + e); return; }
  ok(auto.running === false, "auto wake stays frozen under reduced-motion");
  var exp = rmState(true);
  try { wake(exp, true); } catch (e) { ok(false, "explicit wake reduced throws: " + e); return; }
  ok(exp.settled === true && exp.running === false, "explicit wake runs bounded and settles under reduced-motion");
  ok(exp.temp < 6 && exp.temp >= 1, "explicit wake re-seeded temp0 then cooled while settling (temp=" + exp.temp + ")");
})();

/* Unbounded world (user call: no wall binding now that pan/zoom explores):
 * a node far outside the old rectangle is drawn inward by center pull, never
 * snapped back inside. */
(function () {
  function farState() {
    return {
      phys: "lively", W: 800, H: 600, temp: 7, still: 0, frames: 500,
      geom: { "1.3.0": { x: 400, y: 300 }, "1.3.99": { x: 1400, y: 300 } },
      vel: {}, deg: { "1.3.0": 1, "1.3.99": 1 },
      view: { edges: [] }
    };
  }
  var S = farState(), x0 = S.geom["1.3.99"].x, threw = false, moved = -1;
  try { moved = PoolNetUI._stepForTest(S); } catch (e) { threw = true; }
  var x1 = S.geom["1.3.99"].x;
  ok(!threw && isFinite(moved), "unbound step finite");
  ok(x1 < x0 && x1 > S.W, "far node drawn inward, never clamped (x " + Math.round(x0) + " -> " + Math.round(x1) + ")");
})();

/* 3s pause rule (owner call): a lively run from a fresh spread terminates
 * at or before 180 frames via wake+loop headlessly — no endless tail. */
(function () {
  if (typeof PoolNetUI._wakeForTest !== "function") { ok(false, "_wakeForTest still exported"); return; }
  var S = {
    phys: "lively", W: 800, H: 600, temp: 7, still: 0, frames: 0,
    running: false, settled: true, dead: false, reduced: false, visible: true,
    geom: { hub: { x: 400, y: 300 } }, vel: {}, deg: { hub: 0 }, view: { nodes: [], edges: [] }
  };
  for (var i = 0; i < 8; i++) {
    var id = "n" + i, a = (i / 8) * Math.PI * 2;
    S.geom[id] = { x: 400 + 120 * Math.cos(a), y: 300 + 120 * Math.sin(a) };
    S.deg[id] = 1;
    S.view.nodes.push({ assetId: id });
    S.view.edges.push({ a: "hub", b: id, poolId: "1.19." + i });
  }
  S.view.nodes.push({ assetId: "hub" });
  S.deg.hub = 8;
  try { PoolNetUI._wakeForTest(S, true); } catch (e) { ok(false, "pause-rule wake throws: " + e); return; }
  ok(S.settled === true && S.running === false, "lively run terminates headlessly");
  ok((S.frames || 0) <= 180, "run pauses at/below 180 frames (got " + S.frames + ")");
})();

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
