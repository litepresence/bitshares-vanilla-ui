#!/usr/bin/env node
/* Pool-graph vectors: BFS shortest + widest tiebreak, orphan null, cap respected,
 * layout deterministic. Pure (no chain except the mocked cap probe). Exit 0 green, 1 red. */
"use strict";
globalThis.Chain = { db: () => Promise.reject(new Error("no chain in vectors")), call: () => Promise.reject(new Error("no chain")) };
const PG = require("../vanilla/js/api/pool-graph.js");

let pass = 0, fail = 0;
function eq(got, want, name) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}

// 1. Shortest wins over wider-longer: A direct to core (1 hop, size 10) vs A-X-core (2 hops, size 1000 each).
(function () {
  const g = {
    nodes: [{ assetId: "1.3.1", sym: "A" }, { assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.9", sym: "X" }],
    edges: [
      { poolId: "1.19.1", a: "1.3.1", b: "1.3.0", sizeRaw: "10" },
      { poolId: "1.19.2", a: "1.3.1", b: "1.3.9", sizeRaw: "1000" },
      { poolId: "1.19.3", a: "1.3.9", b: "1.3.0", sizeRaw: "1000" }
    ]
  };
  const p = PG.findCorePath(g, "1.3.1");
  eq(p, { hops: ["1.3.1", "1.3.0"], via: ["1.19.1"] }, "shortest beats wider-longer");
})();

// 2. Widest tiebreak: two 2-hop paths, bottlenecks 1000 vs 10 -> picks 1000.
(function () {
  const g = {
    nodes: [{ assetId: "1.3.1", sym: "A" }, { assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.8", sym: "X" }, { assetId: "1.3.9", sym: "Y" }],
    edges: [
      { poolId: "1.19.10", a: "1.3.1", b: "1.3.8", sizeRaw: "1000" },
      { poolId: "1.19.11", a: "1.3.8", b: "1.3.0", sizeRaw: "1000" },
      { poolId: "1.19.20", a: "1.3.1", b: "1.3.9", sizeRaw: "10" },
      { poolId: "1.19.21", a: "1.3.9", b: "1.3.0", sizeRaw: "10" }
    ]
  };
  const p = PG.findCorePath(g, "1.3.1");
  eq(p, { hops: ["1.3.1", "1.3.8", "1.3.0"], via: ["1.19.10", "1.19.11"] }, "widest bottleneck wins ties");
})();

// 3. Orphan null (no BTS path, never guessed).
(function () {
  const g = {
    nodes: [{ assetId: "1.3.5", sym: "SCAM" }, { assetId: "1.3.6", sym: "SCAM2" }],
    edges: [{ poolId: "1.19.99", a: "1.3.5", b: "1.3.6", sizeRaw: "500" }]
  };
  eq(PG.findCorePath(g, "1.3.5"), null, "orphan null");
  eq(PG.findCorePath(g, "1.3.0"), { hops: ["1.3.0"], via: [] }, "core zero-hop");
})();

// 4. Cap respected: L1 select caps 8 biggest-first (stable by id).
(function () {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ id: "1.19." + i, asset_a_id: "1.3.1", asset_b_id: "1.3." + (10 + i), balance_a_raw: String(100 + i), balance_b_raw: "0" });
  const sel = PG._test.selectL1(rows, 8);
  ok(sel.length === 8, "L1 cap 8 length");
  ok(sel[0].id === "1.19.9", "L1 biggest first");
  const l1 = [{ id: "1.19.1", asset_a_id: "1.3.1", asset_b_id: "1.3.2", balance_a_raw: "10", balance_b_raw: "10" }];
  ok(PG._test.pickL2(l1, "1.3.1", "1.3.2", 6).length <= 6, "L2 pick cap 6");
})();

// 5. Layout deterministic: same input -> byte-identical positions (no physics/random).
(function () {
  const g = {
    nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "A" }, { assetId: "1.3.2", sym: "B" }, { assetId: "1.3.9", sym: "X" }],
    edges: [
      { poolId: "1.19.1", a: "1.3.1", b: "1.3.2", sizeRaw: "50" },
      { poolId: "1.19.2", a: "1.3.1", b: "1.3.9", sizeRaw: "60" }
    ]
  };
  const a = PG.layout(g, "1.3.1", "1.3.2", 300, 180);
  const b = PG.layout(g, "1.3.1", "1.3.2", 300, 180);
  eq(a, b, "layout deterministic");
  ok(typeof a["1.3.1"].x === "number" && typeof a["1.3.0"].x === "number", "layout covers L0+L2");
})();

// 5b. Node radii small + bounded (readability fix: ~40% down from 9+2*deg).
(function () {
  for (let d = 0; d <= 10; d++) {
    const r = PG._test.nodeRadius(d);
    ok(r >= 4 && r <= 12, "nodeRadius bounds deg " + d + " (got " + r + ")");
  }
  eq(PG._test.nodeRadius(0), 5, "nodeRadius base 5");
  eq(PG._test.nodeRadius(99), 11, "nodeRadius capped 11");
})();

// 5c. Ring radii padded: outer ring + biggest node + label clears the canvas edge.
(function () {
  const sizes = [[300, 180], [800, 180], [390, 220], [1440, 900]];
  sizes.forEach(function (wh) {
    const rr = PG._test.ringRadii(wh[0], wh[1]);
    ok(rr.outer + rr.maxNodeR + 12 <= rr.min / 2, "rings padded " + wh[0] + "x" + wh[1] + " (outer " + rr.outer + ")");
    ok(rr.inner < rr.outer && rr.center < rr.inner, "rings ordered " + wh[0] + "x" + wh[1]);
  });
  // Layout honors the padding: every node within the outer ring of center.
  const g = {
    nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "A" }, { assetId: "1.3.2", sym: "B" }, { assetId: "1.3.9", sym: "X" }],
    edges: [
      { poolId: "1.19.1", a: "1.3.1", b: "1.3.2", sizeRaw: "50" },
      { poolId: "1.19.2", a: "1.3.1", b: "1.3.9", sizeRaw: "60" }
    ]
  };
  const pos = PG.layout(g, "1.3.1", "1.3.2", 300, 180);
  const rr = PG._test.ringRadii(300, 180);
  Object.keys(pos).forEach(function (id) {
    const dx = pos[id].x - 150, dy = pos[id].y - 90;
    ok(Math.sqrt(dx * dx + dy * dy) <= rr.outer + 1e-9, "layout inside outer ring " + id);
  });
  const c = PG.layout(g, "1.3.1", "1.3.2", 300, 180);
  eq(c, pos, "re-layout equality (no drift, rings stay the seed)");
})();

// 5d. Deterministic relaxation (networkx IDEA ONLY — same input, same pixels).
(function () {
  const R = PG._test.relax;
  assertR(typeof R === "function", "relax exported");
  function demo() {
    return {
      nodes: [
        { assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "A" },
        { assetId: "1.3.2", sym: "B" }, { assetId: "1.3.9", sym: "X" },
        { assetId: "1.3.7", sym: "Y" }
      ],
      edges: [
        { poolId: "1.19.1", a: "1.3.1", b: "1.3.2", sizeRaw: "50" },
        { poolId: "1.19.2", a: "1.3.1", b: "1.3.9", sizeRaw: "60" },
        { poolId: "1.19.3", a: "1.3.2", b: "1.3.0", sizeRaw: "700000000000000000000" },
        { poolId: "1.19.4", a: "1.3.9", b: "1.3.7", sizeRaw: "5" }
      ]
    };
  }
  function assertR(cond, name) { ok(cond, name); }
  const W = 600, H = 180, OPTS = { assetA: "1.3.1", assetB: "1.3.2" };
  const g1 = demo();
  const seed = PG.layout(g1, "1.3.1", "1.3.2", W, H);
  const p1 = R(g1, seed, W, H, OPTS);
  const p2 = R(g1, seed, W, H, OPTS);
  eq(p1, p2, "relax deterministic (same input twice)");
  // Seed untouched (relax returns a NEW map).
  ok(seed["1.3.1"].x !== undefined && typeof p1["1.3.1"].x === "number", "seed intact, output numeric");
  // Coverage: every node placed, finite, no NaN.
  const ids = Object.keys(p1).sort();
  eq(ids, ["1.3.0", "1.3.1", "1.3.2", "1.3.7", "1.3.9"], "all nodes placed");
  ids.forEach(function (id) {
    ok(isFinite(p1[id].x) && isFinite(p1[id].y), "finite coords " + id);
  });
  // Containment: wall-clamped inside the canvas (pad 30).
  ids.forEach(function (id) {
    ok(p1[id].x >= 30 && p1[id].x <= W - 30 && p1[id].y >= 30 && p1[id].y <= H - 30,
      "contained " + id + " (" + Math.round(p1[id].x) + "," + Math.round(p1[id].y) + ")");
  });
  // Separation: repulsion opened the coincident seed (rings stack L2 on few slots).
  function minSep(pos) {
    const ks = Object.keys(pos);
    let m = Infinity;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const dx = pos[ks[i]].x - pos[ks[j]].x, dy = pos[ks[i]].y - pos[ks[j]].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < m) m = d;
    }
    return m;
  }
  function seedSep() {
    const ks = Object.keys(seed);
    let m = Infinity;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const dx = seed[ks[i]].x - seed[ks[j]].x, dy = seed[ks[i]].y - seed[ks[j]].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < m) m = d;
    }
    return m;
  }
  ok(minSep(p1) >= 1, "no coincident nodes after relax (min " + minSep(p1).toFixed(1) + "px)");
  // L0 anchor: the pair stays near center (provenance meaning preserved).
  [["1.3.1"], ["1.3.2"]].forEach(function ([id]) {
    const dx = p1[id].x - W / 2, dy = p1[id].y - H / 2;
    ok(Math.sqrt(dx * dx + dy * dy) <= Math.min(W, H) / 2, "L0 near center " + id);
  });
  // Center of mass near canvas center (gravity worked, nothing drifted off).
  let sx = 0, sy = 0;
  ids.forEach(function (id) { sx += p1[id].x; sy += p1[id].y; });
  ok(Math.abs(sx / ids.length - W / 2) < W * 0.25, "center of mass x near middle");
  ok(Math.abs(sy / ids.length - H / 2) < H * 0.25, "center of mass y near middle");
  // Degenerate inputs never throw, never NaN.
  eq(R({ nodes: [], edges: [] }, {}, 600, 180, OPTS), {}, "empty graph -> {}");
  const solo = R({ nodes: [{ assetId: "1.3.5", sym: "S" }], edges: [] },
    { "1.3.5": { x: 1, y: 2 } }, 600, 180, OPTS);
  eq(solo, { "1.3.5": { x: 1, y: 2 } }, "single node passes through");
  const bad = R({ nodes: [{ assetId: "1.3.5", sym: "S" }], edges: [] }, null, 0, -5, null);
  ok(bad && typeof bad === "object", "garbage dims fail soft");
  // Edge weight is log-scaled by digit length (money never touches float).
  eq(PG._test.edgeWeight("10"), PG._test.edgeWeight("99"), "same magnitude, same weight");
  ok(PG._test.edgeWeight("700000000000000000000") > PG._test.edgeWeight("5"), "bigger pool pulls harder");
  ok(PG._test.edgeWeight(null) > 0 && PG._test.edgeWeight("abc") > 0, "malformed size fails soft positive");
})();
// 5e+5f. mapTheme (owner spec, supersedes banner verdicts + role helpers —
// removed with their vectors, coverage folded here).
(function () {
  const MT = PG._test.mapTheme;
  function assertR(cond, name) { ok(cond, name); }
  assertR(typeof MT === "function", "mapTheme exported");
  function demo() {
    return {
      nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "A" },
        { assetId: "1.3.2", sym: "B" }, { assetId: "1.3.9", sym: "X" },
        { assetId: "1.3.7", sym: "Y" }],
      edges: [
        { poolId: "1.19.1", a: "1.3.1", b: "1.3.2", sizeRaw: "10" },
        { poolId: "1.19.2", a: "1.3.2", b: "1.3.9", sizeRaw: "10" },
        { poolId: "1.19.3", a: "1.3.9", b: "1.3.0", sizeRaw: "10" }
      ]
    };
  }
  // Mixed pair: A indirect (3 hops), B indirect (2 hops), direct A-B pool.
  var m = MT(demo(), "1.3.1", "1.3.2");
  eq(m.a.level, "indirect", "leg A indirect");
  eq(m.a.hops, 3, "leg A 3 hops");
  eq(m.b, { level: "indirect", hops: 2, via: ["1.19.2", "1.19.3"] }, "leg B indirect 2");
  eq(m.nodeColors, { "1.3.0": "bts", "1.3.1": "pair-warn", "1.3.2": "pair-warn", "1.3.9": "other", "1.3.7": "other" }, "node colors");
  eq(m.legEdge, "1.19.1", "direct leg-leg pool found");
  eq(m.pathPools.sort(), ["1.19.1", "1.19.2", "1.19.3"], "BTS path pools collected");
  eq(m.left, { text: "A 3 hops to BTS", color: "warn", bold: false }, "upper-left yellow");
  eq(m.right, { text: "B 2 hops to BTS", color: "warn", bold: false }, "upper-right yellow");
  eq(m.bottom, { text: "A connects to B", color: "live", bold: false }, "lower-center green direct");
  eq(m.takeover, false, "no takeover with edges");
  // Direct leg case: pair A against BTS itself.
  var d = MT(demo(), "1.3.1", "1.3.0");
  eq(d.b, { level: "direct", hops: 0, via: [] }, "BTS leg direct 0");
  eq(d.nodeColors["1.3.0"], "bts", "BTS node blue even as a leg");
  // Green corner: leg paired straight with BTS.
  var g = MT(demo(), "1.3.9", "1.3.7");
  eq(g.left, { text: "X connects to BTS", color: "live", bold: false }, "upper-left green direct");
  // Orphan pair over a disjoint map: three reds + visible map.
  var g2 = {
    nodes: [{ assetId: "1.3.7", sym: "Y" }, { assetId: "1.3.8", sym: "Z" },
      { assetId: "1.3.9", sym: "X" }],
    edges: [{ poolId: "1.19.9", a: "1.3.9", b: "1.3.8", sizeRaw: "10" }]
  };
  var o = MT(g2, "1.3.7", "1.3.8");
  eq(o.a.level, "orphan", "disjoint leg A orphan");
  eq(o.nodeColors["1.3.7"], "pair-bad", "orphan leg red");
  eq(o.left.bold, true, "orphan corner bold");
  ok(o.left.text.indexOf("WARNING") === 0, "orphan corner warning text");
  eq(o.bottom.color, "danger", "bottom red without leg path");
  eq(o.takeover, false, "disjoint edges suppress takeover");
  // Truly empty legs: takeover.
  var e = MT({ nodes: [], edges: [] }, "1.3.1", "1.3.2");
  eq(e.takeover, true, "empty graph takes over");
  ok(e.takeoverText.indexOf("orphaned from the liquidity pool network") !== -1, "takeover wording");
  var n = MT(null, "1.3.1", "1.3.2");
  eq(n.takeover, true, "null graph takes over");
  eq(n.left.color, "danger", "null graph red corners");
  // Same-asset view collapses the pair verdict.
  var s = MT(demo(), "1.3.1", "1.3.1");
  eq(s.bottom, null, "same asset skips pair line");
  // Indirect leg-leg reach (no direct pool): yellow middle.
  var g3 = {
    nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "A" },
      { assetId: "1.3.2", sym: "B" }, { assetId: "1.3.9", sym: "X" }],
    edges: [
      { poolId: "1.19.1", a: "1.3.1", b: "1.3.9", sizeRaw: "10" },
      { poolId: "1.19.2", a: "1.3.9", b: "1.3.2", sizeRaw: "10" }
    ]
  };
  var r = MT(g3, "1.3.1", "1.3.2");
  eq(r.legEdge, null, "no direct pool");
  eq(r.bottom.color, "warn", "indirect reach is yellow");
  ok(r.bottom.text.indexOf("2 hops") !== -1, "reach names hop count");
})();
// Task 2 (link audit, plot B: desk provenance slices — every node hit ->
// #/asset/:symbol, every edge-mid hit -> #/pools/:id). Pure resolver vectors.
(function () {
  function eqNav(got, want, name) { ok(got === want, name + " (got " + JSON.stringify(got) + ", want " + JSON.stringify(want) + ")"); }
  const nav = (typeof PG._navForTest === "function") ? PG._navForTest : null;
  ok(typeof PG._navForTest === "function", "_navForTest exported (pure hit -> hash)");
  if (!nav) return;
  eqNav(nav({ x: 10, y: 10, assetId: "1.3.0", sym: "BTS" }), "#/asset/BTS", "node tap -> asset page");
  eqNav(nav({ edgeMid: true, x: 50, y: 50, poolId: "1.19.66" }), "#/pools/1.19.66", "edge-mid tap -> swap desk");
  eqNav(nav({ x: 1, y: 1, assetId: "1.3.999", sym: "XBTSX.BTC" }), "#/asset/XBTSX.BTC", "dotted symbol verbatim (encodeURIComponent, slash-safe)");
  eqNav(nav({ x: 1, y: 1, assetId: "1.3.999", sym: "A/B" }), "#/asset/A%2FB", "slash in symbol escaped (route-safe)");
  eqNav(nav(null), null, "null hit -> null (no navigation)");
  eqNav(nav({ x: 1, y: 1, assetId: "1.3.0", sym: "BTS" }), "#/asset/BTS", "keyboard Enter target (core-or-first) resolves to asset page");
})();
// Desk physics (2026-10-07 gesture-reaction model): ONE physics — the same
// relax math with a temp/cool/sleep schedule and a 180-frame cap — and a
// shared poolNetReact GESTURE flag. The retired "calm" preset (which ran
// ZERO live frames) is why "Off" froze these desk maps while still animating
// on the selector bands: same On/Off label, two different meanings.
(function () {
  ok(typeof PG.setReact === "function", "setReact exported (pane switches share poolNetReact)");
  ok(typeof PG.readReact === "function", "readReact exported (shared poolNetReact key)");
  ok(typeof PG.PHYS_KEY === "string" && PG.PHYS_KEY === "poolNetReact", "the shared key is poolNetReact");
  ok(typeof PG.setPhys === "undefined" && typeof PG.readPhys === "undefined",
    "the preset reader/writer seams are gone with the preset");
  ok(typeof PG._physForTest === "function", "_physForTest exported (preset table)");
  ok(typeof PG._defaultReactForTest === "function" && PG._defaultReactForTest() === true,
    "default gesture reaction is ON");
  if (typeof PG._physForTest !== "function") return;
  var phys = PG._physForTest();
  ok(!!(phys && phys.lively), "the one preset is present standalone (no PoolNetUI loaded)");
  ok(!phys.calm, "the calm preset is GONE (one physics only)");
  ok(Object.keys(phys).length === 1, "exactly one preset in the table");
  ok(phys.lively.maxFrames === 180, "180-frame cap on the one preset");
  // Guarded read-through: a loaded PoolNetUI table wins over the fallback.
  var hadPNUI = Object.prototype.hasOwnProperty.call(globalThis, "PoolNetUI");
  var savedPNUI = globalThis.PoolNetUI;
  try {
    globalThis.PoolNetUI = { _physForTest: function () { return { lively: { maxFrames: 12 } }; } };
    var thru = PG._physForTest();
    ok(thru && thru.lively.maxFrames === 12, "preset read from PoolNetUI._physForTest when loaded");
  } catch (e) { ok(false, "preset read-through throws: " + e); }
  try { if (hadPNUI) globalThis.PoolNetUI = savedPNUI; else delete globalThis.PoolNetUI; } catch (e) {}
  function demo3() {
    return {
      nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "A" }, { assetId: "1.3.2", sym: "B" }],
      edges: [
        { poolId: "1.19.1", a: "1.3.1", b: "1.3.2", sizeRaw: "50" },
        { poolId: "1.19.2", a: "1.3.1", b: "1.3.0", sizeRaw: "60" }
      ]
    };
  }
  var OPTS3 = { assetA: "1.3.1", assetB: "1.3.2" };
  if (typeof PG._runLiveForTest !== "function") { ok(false, "_runLiveForTest exported (headless loop smoke)"); }
  else {
    var g3 = demo3();
    var seed3 = PG.layout(g3, "1.3.1", "1.3.2", 300, 180);
    var lv = PG._runLiveForTest(g3, seed3, 300, 180, OPTS3);
    ok(lv && typeof lv.frames === "number" && lv.frames >= 1 && lv.frames <= 180,
      "loop on 3-node graph terminates 1..180 frames (got " + (lv && lv.frames) + ")");
    var ids3 = Object.keys((lv && lv.pos) || {}).sort();
    eq(ids3, ["1.3.0", "1.3.1", "1.3.2"], "loop places all 3 nodes");
    ids3.forEach(function (id) {
      ok(isFinite(lv.pos[id].x) && isFinite(lv.pos[id].y), "finite coords " + id);
      ok(lv.pos[id].x >= 30 && lv.pos[id].x <= 270 && lv.pos[id].y >= 30 && lv.pos[id].y <= 150,
        "contained " + id);
    });
    var lv2 = PG._runLiveForTest(g3, seed3, 300, 180, OPTS3);
    eq(lv2, lv, "loop deterministic (same seed twice)");
    /* The retired mode argument must change nothing: a render always settles. */
    var lvStale = PG._runLiveForTest(g3, seed3, 300, 180, OPTS3, "calm");
    eq(lvStale, lv, "a stale mode argument is ignored (no zero-frame calm path)");
  }
  if (typeof PG._wakeForTest !== "function") { ok(false, "_wakeForTest exported (re-seed seam)"); }
  else {
    var W = 300, H = 180;
    var Sg = demo3();
    var seedW = PG.layout(Sg, "1.3.1", "1.3.2", W, H);
    var S = { graph: Sg, geom: JSON.parse(JSON.stringify(seedW)), w: W, h: H, opts: OPTS3,
      react: true, temp: 0.5, still: 77, frames: 999,
      running: true, settled: false, dead: false, reduced: false };
    try { PG._wakeForTest(S); } catch (e) { ok(false, "wake on running loop throws: " + e); S = null; }
    if (S) {
      var t0 = PG._physForTest().lively.temp0;
      ok(S.temp === t0 && S.still === 0 && S.frames === 0, "wake re-seeds temp/still/frames on a running loop (temp=" + S.temp + ")");
      ok(S.running === true, "running loop stays running (no double-start)");
    }
    /* THE flag gates GESTURES only: OFF refuses a release wake outright
     * (the map stays exactly where you dropped it), while an automatic wake
     * still settles so a pair change or resize re-arranges the map. */
    function flagState(react) {
      return { graph: Sg, geom: JSON.parse(JSON.stringify(seedW)), w: W, h: H, opts: OPTS3,
        react: react, temp: 1, still: 25, frames: 900,
        running: false, settled: true, dead: false, reduced: false };
    }
    var offGesture = flagState(false);
    var geomBefore = JSON.stringify(offGesture.geom);
    try { PG._wakeForTest(offGesture, true); } catch (e) { ok(false, "gesture wake with react off throws: " + e); }
    ok(offGesture.running === false, "react OFF: a gesture wake starts nothing");
    ok(offGesture.temp === 1, "react OFF: no energy seeded (temp=" + offGesture.temp + ")");
    ok(JSON.stringify(offGesture.geom) === geomBefore, "react OFF: geometry untouched by the release");
    var offAuto = flagState(false);
    try { PG._wakeForTest(offAuto); } catch (e) { ok(false, "auto wake with react off throws: " + e); }
    ok(offAuto.frames > 0 || offAuto.settled === true, "react OFF: an AUTOMATIC wake still settles");
    var onGesture = flagState(true);
    try { PG._wakeForTest(onGesture, true); } catch (e) { ok(false, "gesture wake with react on throws: " + e); }
    ok(onGesture.frames > 0 || onGesture.settled === true, "react ON: a gesture wake re-runs the settle");
  }
  /* Persistence: OFF survives a reload, and the retired preset key is inert. */
  if (typeof PG.readReact === "function" && typeof PG.setReact === "function") {
    var mem = {};
    global.localStorage = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); }
    };
    ok(PG.readReact() === true, "no stored value reads ON");
    PG.setReact(false);
    ok(mem[PG.PHYS_KEY] === "0", "setReact(false) stores \"0\" under poolNetReact");
    ok(PG.readReact() === false, "a stored OFF reads back OFF (survives reload)");
    PG.setReact(true);
    ok(PG.readReact() === true, "setReact(true) flips it back ON");
    mem.poolNetPhys = "calm";
    delete mem[PG.PHYS_KEY];
    ok(PG.readReact() === true, "the retired poolNetPhys key is ignored");
    delete global.localStorage;
  } else {
    ok(false, "readReact/setReact exported for the persistence vectors");
  }
})();
(async function () {
  let calls = 0;
  const poolsByAsset = {};
  function mkPool(id, a, b, sz) { return { id: id, asset_a: a, asset_b: b, balance_a: String(sz), balance_b: String(sz), share_asset: "1.3.999", taker_fee_percent: 0, withdrawal_fee_percent: 0 }; }
  // L1 for 1.3.1: 8 pools to distinct counters; each counter fans to 3 more (would explode without caps).
  const l1 = [];
  for (let i = 0; i < 8; i++) l1.push(mkPool("1.19." + (100 + i), "1.3.1", "1.3." + (50 + i), 1000 - i));
  poolsByAsset["1.3.1"] = l1;
  poolsByAsset["1.3.2"] = [mkPool("1.19.200", "1.3.2", "1.3.1", 500)];
  for (let i = 0; i < 8; i++) {
    const c = "1.3." + (50 + i), arr = [];
    for (let j = 0; j < 3; j++) arr.push(mkPool("1.19." + (300 + i * 3 + j), c, "1.3." + (90 + j), 100));
    poolsByAsset[c] = arr;
  }
  globalThis.Chain = {
    db: async () => 1,
    call: async (dbId, method, params) => {
      calls++;
      if (method === "get_liquidity_pools_by_one_asset") return poolsByAsset[params[0]] || [];
      if (method === "lookup_asset_symbols") return (params[0] || []).map((id) => ({ id: id, symbol: id === "1.3.0" ? "BTS" : id, precision: 5 }));
      return [];
    }
  };
  // Re-require to bind the mocked Chain (module captured global lookup at call time, so same instance works).
  const g = await PG.buildGraph("1.3.1", "1.3.2", { cap: 25 });
  ok(g.nodes.length <= 25, "buildGraph node cap 25 (got " + g.nodes.length + ")");
  ok(calls <= 15, "buildGraph RPC budget <=15 (got " + calls + ")");

  // 6. Concurrency-order: shuffled resolve order still yields identical graph + layout.
  // Same calls, different delay patterns (ascending vs descending) -> byte-identical result.
  // Also proves batching: peak in-flight >1 (sequential would stay at 1).
  async function buildWithDelays(delayFn, failAsset) {
    let inFlight = 0, maxInFlight = 0;
    globalThis.Chain = {
      db: async () => 1,
      call: async (dbId, method, params) => {
        if (method === "lookup_asset_symbols") return (params[0] || []).map((id) => ({ id: id, symbol: id === "1.3.0" ? "BTS" : id, precision: 5 }));
        if (method !== "get_liquidity_pools_by_one_asset") return [];
        const asset = params[0];
        if (asset === failAsset) throw new Error("boom leg-fail");
        inFlight++; if (inFlight > maxInFlight) maxInFlight = inFlight;
        try {
          const d = delayFn(asset) || 0;
          if (d) await new Promise((r) => setTimeout(r, d));
          return poolsByAsset[asset] || [];
        } finally { inFlight--; }
      }
    };
    const t0 = Date.now();
    const graph = await PG.buildGraph("1.3.1", "1.3.2", { cap: 25 });
    const ms = Date.now() - t0;
    return { graph, ms, maxInFlight };
  }
  function delayAsc(asset) {
    const m = { "1.3.1": 5, "1.3.2": 30, "1.3.50": 0, "1.3.51": 10, "1.3.52": 20, "1.3.53": 30, "1.3.54": 40, "1.3.55": 50 };
    return m[asset] || 0;
  }
  function delayDesc(asset) {
    const m = { "1.3.1": 30, "1.3.2": 5, "1.3.50": 50, "1.3.51": 40, "1.3.52": 30, "1.3.53": 20, "1.3.54": 10, "1.3.55": 0 };
    return m[asset] || 0;
  }
  const rA = await buildWithDelays(delayAsc, null);
  const rB = await buildWithDelays(delayDesc, null);
  eq(rA.graph, rB.graph, "concurrent resolve order identical graph");
  const layA = PG.layout(rA.graph, "1.3.1", "1.3.2", 800, 180);
  const layB = PG.layout(rB.graph, "1.3.1", "1.3.2", 800, 180);
  eq(layA, layB, "concurrent resolve order identical layout");
  ok(rA.maxInFlight > 1 && rB.maxInFlight > 1, "L1/L2 batched (peak in-flight " + rA.maxInFlight + "/" + rB.maxInFlight + " >1)");
  console.log("  timing concurrent asc " + rA.ms + "ms desc " + rB.ms + "ms (sequential floor would be ~sum of legs)");

  // 6b. Leg guard: one L2 asset failing resolves [] for that leg, never rejects the batch.
  const rFail = await buildWithDelays(delayAsc, "1.3.52");
  ok(Array.isArray(rFail.graph.edges), "failing leg still resolves graph");
  ok(!JSON.stringify(rFail.graph.edges).includes("1.19." + (300 + 2 * 3)), "failing leg pools absent, other legs present");
  ok(rFail.graph.edges.length > 0, "partial graph non-empty despite one leg failing");
  console.log("Pool-graph vectors: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL buildGraph threw " + e); process.exit(1); });
