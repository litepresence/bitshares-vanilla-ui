#!/usr/bin/env node
/* Pool-net-ui paint vectors: 3-node graph paints arcs + labels on a stub ctx.
 * Headless (no DOM, no chain, no browser). Exit 0 green, 1 red. */
"use strict";
globalThis.PoolNet = require("../vanilla/js/api/pool-net.js");
var PoolNetUI = require("../vanilla/js/views/pool-net-ui.js");

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

/* The one physics (2026-10-07 toggle rework): the former "calm" preset is
 * GONE — an On/Off label over two fidelities is what made "Off" look like
 * "a different lively physics" instead of "stopped". The switch is now a
 * gesture-reaction FLAG (default ON), and gestures are what it gates. */
(function () {
  var phys = (typeof PoolNetUI._physForTest === "function") ? PoolNetUI._physForTest() : null;
  ok(!!phys && !!phys.lively, "phys preset: lively exists");
  ok(!!phys && !phys.calm, "phys preset: calm is GONE (one physics only)");
  ok(Object.keys(phys || {}).length === 1, "exactly one preset in the table");
  ok(typeof PoolNetUI._defaultReactForTest === "function" && PoolNetUI._defaultReactForTest() === true,
    "default gesture reaction is ON");
  if (!phys || !phys.lively) return;
  ok(phys.lively.curved === true, "edges are curved (the one preset)");
  ok(phys.lively.repPow === 2 && phys.lively.minFrames === 60 &&
    phys.lively.carry === 0.98 && phys.lively.hubCarry === 0.90 && phys.lively.cool === 0.984 && phys.lively.tempMin === 0.2 &&
    phys.lively.temp0 === 7 && phys.lively.repCap === 20 &&
    phys.lively.springK === 0.010 && phys.lively.springRest === 2.2 && phys.lively.maxFrames === 180,
    "lively constants pinned + 3s pause cap at 180 frames");
  function simState(mode) {
    return {
      phys: mode, W: 300, H: 320, temp: 6, still: 0, frames: 0,
      geom: { "1.3.0": { x: 150, y: 160 }, "1.3.1": { x: 60, y: 60 }, "1.3.99": { x: 250, y: 260 } },
      vel: {}, deg: { "1.3.0": 2, "1.3.1": 1 },
      view: { edges: [{ a: "1.3.0", b: "1.3.1", poolId: "1.19.1" }] }
    };
  }
  if (typeof PoolNetUI._stepForTest === "function") {
    var S0 = simState("lively"), moved0 = -1, threw0 = false;
    try { moved0 = PoolNetUI._stepForTest(S0); } catch (e) { threw0 = true; }
    ok(!threw0 && isFinite(moved0), "stepFrame finite (isolated node, no NaN deg)");
  } else {
    ok(false, "_stepForTest exported for headless physics smoke");
  }
  var stub = stubCtx();
  var graph = globalThis.PoolNet.fromSkeleton(skel);
  var laid = PoolNetUI._layoutForTest ? PoolNetUI._layoutForTest(graph.nodes, 300, 320) : null;
  if (laid) {
    var threw1 = false, out1 = null;
    try {
      out1 = PoolNetUI._drawForTest(stub.ctx, 300, 320, graph, laid, {
        scale: 1, ox: 0, oy: 0, pathSet: {}, selPool: null, dim: {}, meta: {},
        hoverNode: null, hoverEdge: null, phys: "lively"
      });
    } catch (e) { threw1 = true; }
    ok(!threw1 && out1 && out1.mids.length === 2, "drawScene paints 2 edges headless (curves need no quadraticCurveTo)");
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

/* Physics-alive regression (user report: the switch "does nothing" / a
 * frozen map): from a spread start, 300 steps must travel a real distance.
 * The old version compared lively against calm (two presets); there is ONE
 * physics now, so the guard is "the simulation actually moves and then
 * parks" — a 1/d^3 repulsion typo would freeze it and fail here. */
(function () {
  function ringState() {
    var geom = { hub: { x: 400, y: 300 } }, deg = { hub: 8 }, edges = [];
    for (var i = 0; i < 8; i++) {
      var id = "n" + i, a = (i / 8) * Math.PI * 2;
      geom[id] = { x: 400 + 120 * Math.cos(a), y: 300 + 120 * Math.sin(a) };
      deg[id] = 1; edges.push({ a: "hub", b: id, poolId: "1.19." + i });
    }
    var nodes = [{ assetId: "hub" }].concat(Object.keys(geom).filter(function (k) { return k !== "hub"; }).map(function (k) { return { assetId: k }; }));
    var P = PoolNetUI._physForTest().lively;
    return { W: 800, H: 600, temp: P.temp0, still: 0, frames: 0,
      geom: geom, vel: {}, deg: deg, view: { nodes: nodes, edges: edges } };
  }
  function pathFor(steps) {
    var S = ringState(), path = 0, i, id, px = {}, first = true;
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
  var travel = pathFor(300);
  var late = pathFor(60);
  ok(travel > 0, "the one physics travels from a spread (300 steps: " + Math.round(travel) + "px)");
  ok(late < travel, "and settles — the last 60 steps cover less ground than the first 300 (" +
    Math.round(late) + " vs " + Math.round(travel) + ")");
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
    W: 300, H: 320, temp: 0.5, still: 77, frames: 999,
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
    W: 300, H: 320, temp: 1, still: 25, frames: 900,
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
      W: 300, H: 320, temp: 1, still: 25, frames: 900,
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
  /* Floor is the ONE preset's tempMin (0.2 for lively — the retired calm
   * preset had 1), so this bounds against the table, never a literal. */
  var floorT = PoolNetUI._physForTest().lively.tempMin;
  ok(exp.temp < 7 && exp.temp >= floorT, "explicit wake re-seeded temp0 then cooled to the preset floor (temp=" + exp.temp + ")");
})();

/* Persistence contract for the switch: OFF must survive a reload, and the
 * RETIRED preset key (poolNetPhys) must never resurrect anything — it is
 * read by nothing, so a stale "calm" in someone's storage is inert. */
(function () {
  var P = (typeof PoolNetPhys !== "undefined") ? PoolNetPhys : null;
  if (!P || typeof P.readReact !== "function" || typeof P.writeReact !== "function") {
    ok(false, "readReact/writeReact exported"); return;
  }
  var mem = {};
  global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); }
  };
  ok(P._defaultReactForTest() === true, "shipped default is ON (a touch reacts)");
  ok(P.readReact() === true, "no stored value reads ON");
  P.writeReact(false);
  ok(mem[P.REACT_KEY] === "0", "writeReact(false) stores \"0\" under poolNetReact");
  ok(P.readReact() === false, "a stored OFF reads back OFF (survives reload)");
  P.writeReact(true);
  ok(P.readReact() === true, "writeReact(true) flips it back ON");
  mem[P.REACT_KEY] = "nonsense";
  ok(P.readReact() === true, "a corrupt stored value reads ON, never OFF");
  mem.poolNetPhys = "calm";
  delete mem[P.REACT_KEY];
  ok(P.readReact() === true, "the retired poolNetPhys key is ignored (no preset resurrection)");
  ok(P.PHYS_KEY === undefined, "the old PHYS_KEY seam is gone with the preset");
  delete global.localStorage;
})();

/* The switch's DOM contract (2026-10-07): the button is the 44x44 HIT AREA
 * and the visible pill is a child track, so the control can read half-size
 * without dropping below the platform touch floor (principle #7). No tooltip
 * element and no hint line — the On/Off word beside it is the whole label. */
(function () {
  var css = require("fs").readFileSync(require("path").join(__dirname, "..", "vanilla", "css", "app.css"), "utf8");
  ok(/\.pool-net-physwitch\s*\{[^}]*min-height:\s*44px/.test(css), "switch button keeps a 44px touch floor");
  ok(/\.pool-net-physwitch\s*\{[^}]*min-width:\s*44px/.test(css), "switch button keeps a 44px touch width");
  ok(/\.pool-net-phystrack\s*\{[^}]*width:\s*30px/.test(css), "the visible track is the half-size pill (30px)");
  ok(/\.pool-net-phystrack\s*\{[^}]*height:\s*16px/.test(css), "track height 16px (half of the old 44px pill)");
  ok(/\.pool-net-physhint/.test(css) === false, "no hint line styled");
  ok(/\.pool-net-physwitch[^}]*title:/.test(css) === false, "no tooltip styling on the switch");
  ok(/\.pool-net-physstate/.test(css) === false, "no On/Off word styled");
  var src = require("fs").readFileSync(require("path").join(__dirname, "..", "vanilla", "js", "views", "pool-net-chrome.js"), "utf8");
  ok(src.indexOf("pool-net-physhint") === -1, "chrome builds no hint element");
  ok(src.indexOf("phys_hint") === -1, "chrome references no hint key");
  ok(src.indexOf("physTrack") !== -1, "chrome builds the track child");
  ok(src.indexOf("physState") === -1 && src.indexOf("phys_on") === -1 && src.indexOf("phys_off") === -1,
    "chrome builds no On/Off word and references no phys_on/phys_off key");
  ["market-desk-fill.js", "pool-detail-view.js"].forEach(function (f) {
    var t = require("fs").readFileSync(require("path").join(__dirname, "..", "vanilla", "js", "views", f), "utf8");
    ok(t.indexOf("physhint") === -1 && t.indexOf("phys_hint") === -1, f + ": no hint element or key");
    ok(t.indexOf("physState") === -1 && t.indexOf("phys_on") === -1 && t.indexOf("phys_off") === -1 &&
       t.indexOf("physstate") === -1 && t.indexOf("data-phys-state") === -1,
      f + ": no On/Off word element, key, or lookup");
    ok(t.indexOf("pool-net-phystrack") !== -1, f + ": builds the track child");
  });
})();

/* THE switch semantics (2026-10-07): the flag gates GESTURES only.
 * OFF = a drag release must not start a simulation (the mesh stays exactly
 * where it was dropped) while an automatic wake (load/filter/resize) still
 * settles, so the map is never left unarranged for a new filter. */
(function () {
  if (typeof PoolNetUI._wakeForTest !== "function") { ok(false, "_wakeForTest still exported"); return; }
  var wake = PoolNetUI._wakeForTest;
  function state(react) {
    return {
      react: react, W: 300, H: 320, temp: 1, still: 25, frames: 900,
      running: false, settled: true, dead: false, reduced: false, visible: true,
      geom: { "1.3.0": { x: 150, y: 160 }, "1.3.1": { x: 60, y: 60 }, "1.3.99": { x: 250, y: 260 } },
      vel: {}, deg: { "1.3.0": 2, "1.3.1": 1 },
      view: { edges: [{ a: "1.3.0", b: "1.3.1", poolId: "1.19.1" }] }
    };
  }
  var offGesture = state(false);
  var before = JSON.stringify(offGesture.geom);
  try { wake(offGesture, true); } catch (e) { ok(false, "explicit wake with react off throws: " + e); return; }
  ok(offGesture.running === false && offGesture.settled === true,
    "react OFF: a gesture wake starts nothing (running=" + offGesture.running + ")");
  ok(offGesture.temp === 1, "react OFF: no energy seeded at all (temp=" + offGesture.temp + ")");
  ok(JSON.stringify(offGesture.geom) === before, "react OFF: geometry untouched by the release");
  var offAuto = state(false);
  try { wake(offAuto); } catch (e) { ok(false, "auto wake with react off throws: " + e); return; }
  ok(offAuto.settled === true && offAuto.running === false && offAuto.frames > 0,
    "react OFF: an AUTOMATIC wake still settles (frames=" + offAuto.frames + ")");
  var onGesture = state(true);
  try { wake(onGesture, true); } catch (e) { ok(false, "explicit wake with react on throws: " + e); return; }
  ok(onGesture.frames > 0, "react ON: a gesture wake re-runs the settle (frames=" + onGesture.frames + ")");
})();

/* Unbounded world (user call: no wall binding now that pan/zoom explores):
 * a node far outside the old rectangle is drawn inward by center pull, never
 * snapped back inside. */
(function () {
  function farState() {
    return {
      W: 800, H: 600, temp: 7, still: 0, frames: 500,
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
    W: 800, H: 600, temp: 7, still: 0, frames: 0,
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

/* Task 2 (PoolNetUI nav-opts passthrough): resolveNav composition seam.
 * Absent opts = pool-default byte-identical; opts.navEdge/navNode override. */
(function () {
  function eqNav(got, want, name) {
    ok(got === want, name + " (got " + JSON.stringify(got) + ", want " + JSON.stringify(want) + ")");
  }
  var resolveNav = PoolNetUI.resolveNav;
  ok(typeof resolveNav === "function", "resolveNav exported (opts composition seam)");
  if (typeof resolveNav !== "function") return;
  eqNav(resolveNav({ edgeMid: true, x: 50, y: 50, poolId: "1.19.1" }), "#/pools/1.19.1", "resolveNav pool-default edge -> swap desk");
  eqNav(resolveNav({ x: 10, y: 10, assetId: "1.3.0", sym: "BTS" }), "#/asset/BTS", "resolveNav pool-default node -> asset page");
  eqNav(resolveNav(null), null, "resolveNav null hit -> null");
  eqNav(resolveNav({ x: 1, y: 1, assetId: "1.3.999", sym: "A/B" }), "#/asset/A%2FB", "resolveNav pool-default slash escaped");
  eqNav(resolveNav({ edgeMid: true, poolId: "1.19.1" }, { navEdge: function () { return "#/market/BTS_USD"; } }), "#/market/BTS_USD", "resolveNav market override edge -> desk");
  eqNav(resolveNav({ assetId: "1.3.0", sym: "BTS" }, { navNode: function () { return "#/market/BTS_BTS"; } }), "#/market/BTS_BTS", "resolveNav market override node -> desk");
  eqNav(resolveNav({ edgeMid: true, poolId: "1.19.1" }, { navEdge: function () { throw new Error("boom"); } }), null, "resolveNav throwing edge override -> null");
  eqNav(resolveNav({ assetId: "1.3.0", sym: "BTS" }, { navNode: function () { throw new Error("boom"); } }), null, "resolveNav throwing node override -> null");
  eqNav(resolveNav({ edgeMid: true, poolId: "1.19.1" }, { navEdge: function () { return null; } }), null, "resolveNav null-returning edge override -> null");
  eqNav(resolveNav({ edgeMid: true, poolId: "1.19.1" }, {}), "#/pools/1.19.1", "resolveNav empty opts = pool default");
})();

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
