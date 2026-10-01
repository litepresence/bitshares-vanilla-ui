#!/usr/bin/env node
/* Pool-graph vectors: BFS shortest + widest tiebreak, orphan null, cap respected,
 * layout deterministic. Pure (no chain except the mocked cap probe). Exit 0 green, 1 red. */
"use strict";
globalThis.Chain = { db: () => Promise.reject(new Error("no chain in vectors")), call: () => Promise.reject(new Error("no chain")) };
const PG = require("/workspace/vanilla/js/pool-graph.js");

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
  eq(c, pos, "re-layout equality (no drift, no physics)");
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
