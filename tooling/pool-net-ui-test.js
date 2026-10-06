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
    phys.calm.springRest === 1.1 && phys.calm.repCap === 5,
    "calm constants byte-identical to v1 shipped behavior");
  ok(phys.lively.repPow === 2 && phys.lively.minFrames === 180, "lively degree-mass repulsion + min-run gate");
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

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
