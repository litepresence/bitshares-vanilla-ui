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

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
