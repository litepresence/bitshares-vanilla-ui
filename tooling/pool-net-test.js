#!/usr/bin/env node
/* Pool-net vectors: skeleton graph, star/union filters, brand groups.
 * Pure (no chain, no DOM). Exit 0 green, 1 red. */
"use strict";
const PN = require("../vanilla/js/api/pool-net.js");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}

const skel = { pools: [
  { id: "1.19.1", a: "1.3.0", b: "1.3.1", share: "1.3.10", symA: "BTS", symB: "USD", symShare: "LP1", precA: 5, precB: 4, precShare: 4 },
  { id: "1.19.2", a: "1.3.0", b: "1.3.2", share: "1.3.11", symA: "BTS", symB: "BTC", symShare: "LP2", precA: 5, precB: 8, precShare: 4 }
]};

// 1. Skeleton graph: 3 assets, 2 pools.
(function () {
  const g = PN.fromSkeleton(skel);
  ok(g.nodes.length === 3 && g.edges.length === 2, "skeleton graph");
})();

// 2. Star: single hub keeps hub + spokes.
(function () {
  const g = PN.fromSkeleton(skel);
  const star = PN.filterGraph(g, { aId: "1.3.0", bId: null });
  ok(star.nodes.length === 3, "star keeps hub");
  ok(star.edges.length === 2, "star keeps both pools");
})();

// 3. Union: two leaves each pull their own star.
(function () {
  const g = PN.fromSkeleton(skel);
  const union = PN.filterGraph(g, { aId: "1.3.1", bId: "1.3.2" });
  ok(union.edges.length === 2, "union both stars");
  ok(union.nodes.length === 3, "union keeps hub + leaves");
})();

// 4b. Induced edges: a pool between two visible counters joins the star
// even though neither leg is the selected asset (no new nodes appear).
(function () {
  const g2 = PN.fromSkeleton({ pools: skel.pools.concat([
    { id: "1.19.3", a: "1.3.1", b: "1.3.2", share: "1.3.12", symA: "USD", symB: "BTC", symShare: "LP3", precA: 4, precB: 8, precShare: 4 }
  ])});
  const star = PN.filterGraph(g2, { aId: "1.3.0", bId: null });
  ok(star.nodes.length === 3, "induced star adds no nodes");
  ok(star.edges.length === 3, "induced star adds the counter-counter pool");
  ok(star.edges.some(function (e) { return e.poolId === "1.19.3"; }), "induced edge is the 1.19.3 swap");
})();

// 4. No selection returns the full graph.
(function () {
  const g = PN.fromSkeleton(skel);
  const full = PN.filterGraph(g, { aId: null, bId: null });
  ok(full.nodes.length === 3 && full.edges.length === 2, "empty selection is full graph");
})();

// 5. Brand groups: BTS + committee smartcoins are bts-blue.
(function () {
  ok(PN.brandOf("BTS") === "bts-blue", "brand BTS bts-blue");
  ok(PN.brandOf("USD") === "bts-blue", "brand USD bts-blue");
  ok(PN.brandOf("CNY") === "bts-blue", "brand CNY bts-blue");
  ok(PN.brandOf("BTC") === "bts-blue", "brand BTC bts-blue");
  ok(PN.brandOf("HONEST.USD") === "honest", "brand group honest");
  ok(PN.brandOf("GDEX.BTC") === "gdex", "brand group gdex");
})();

// 6. Merge: live rows overlay skeleton (new added, known deduped).
(function () {
  const live = [{ id: "1.19.2", asset_a_id: "1.3.0", asset_b_id: "1.3.2", sym_a: "BTS", sym_b: "BTC" },
                { id: "1.19.9", asset_a_id: "1.3.1", asset_b_id: "1.3.2", sym_a: "USD", sym_b: "BTC" }];
  const g0 = PN.fromSkeleton(skel);
  const g1 = PN.mergeLive(g0, live);
  ok(g1.edges.length === 3, "merge adds new, dedups known");
  ok(g1.nodes.length === 3, "merge adds no phantom assets");
})();

// 7. BFS path + orphan null.
(function () {
  const live = [{ id: "1.19.2", asset_a_id: "1.3.0", asset_b_id: "1.3.2", sym_a: "BTS", sym_b: "BTC" },
                { id: "1.19.9", asset_a_id: "1.3.1", asset_b_id: "1.3.2", sym_a: "USD", sym_b: "BTC" }];
  const g1 = PN.mergeLive(PN.fromSkeleton(skel), live);
  const p = PN.findPath(g1, "1.3.1", "1.3.0");
  ok(p && p.hops.length >= 2, "path exists via union");
  ok(PN.findPath({ nodes: [], edges: [] }, "1.3.1", "1.3.0") === null, "orphan null");
  ok(PN.findPath(g1, "1.3.0", "1.3.0").hops.length === 1, "self path is one hop");
})();

// 8. Batched load: paginates 100-per-page until a short page.
(function () {
  const pages = [
    Array.from({ length: 100 }, (_, i) => ({ id: "1.19." + (i + 1) })),
    [{ id: "1.19.101" }, { id: "1.19.102" }]
  ];
  let calls = 0;
  function listFn(startId) {
    calls++;
    return Promise.resolve(pages[calls - 1] || []);
  }
  PN.loadAllBatched(listFn, 100).then(function (all) {
    ok(all.length === 102, "batched load concatenates pages");
    ok(calls === 2, "batched load stops after short page");
    // Empty first page resolves empty (offline/empty chain, honest []).
    PN.loadAllBatched(function () { return Promise.resolve([]); }, 100).then(function (none) {
      ok(none.length === 0, "batched load empty first page");
      finish();
    }).catch(function () { ok(false, "batched load empty first page"); finish(); });
  }).catch(function () { ok(false, "batched load concatenates pages"); finish(); });
  return; // async tail finishes below; sync tests already counted above.
  async function finish() {
    // 9. Cache: chain re-validates, stale ids drop (node stub for localStorage).
    (function () {
      const keep = {};
      globalThis.localStorage = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(keep, k) ? keep[k] : null; },
        setItem: function (k, v) { keep[k] = String(v); },
        removeItem: function (k) { delete keep[k]; }
      };
      const skelIds = ["1.19.1", "1.19.2"];
      let r = PN.reconcileExtraIds(skelIds, ["1.19.1", "1.19.2", "1.19.9"]);
      ok(r.added.length === 1 && r.added[0] === "1.19.9", "cache learns new live id");
      ok(PN.readExtraIds().length === 1, "cache persists new live id");
      r = PN.reconcileExtraIds(skelIds, ["1.19.1", "1.19.2"]);
      ok(r.dropped.length === 1 && r.dropped[0] === "1.19.9", "stale id dropped on re-validate");
      ok(PN.readExtraIds().length === 0, "cache empty after pool deleted");
      delete globalThis.localStorage;
    })();
    // 10. Order-free Pool.list params (Task 4, no chain: stub Chain records method+params).
    await (async function () {
      const Pool = require("../vanilla/js/api/pool.js");
      let calls;
      function stub(handler) {
        calls = [];
        globalThis.Chain = {
          db: () => Promise.resolve(1),
          call: (id, m, p) => { calls.push([m, p]); if (handler) return handler(m, p); return Promise.resolve([]); }
        };
      }
      function hasCall(method, params) {
        return calls.some(function (c) { return c[0] === method && JSON.stringify(c[1]) === JSON.stringify(params); });
      }
      // 10a. Single assetA -> by_one (BTS-safe: any single leg, no legacy by_asset_a).
      stub();
      await Pool.list({ assetA: "1.3.0", limit: 10, startId: "1.19.0" });
      ok(hasCall("get_liquidity_pools_by_one_asset", ["1.3.0", 10, "1.19.0"]), "single A -> by_one [asset,limit,start]");
      ok(!calls.some(function (c) { return c[0] === "get_liquidity_pools_by_asset_a"; }), "single A never calls legacy by_asset_a");
      // 10b. Single assetB -> by_one with the B leg.
      stub();
      await Pool.list({ assetB: "1.3.121", limit: 5, startId: "1.19.0" });
      ok(hasCall("get_liquidity_pools_by_one_asset", ["1.3.121", 5, "1.19.0"]), "single B -> by_one [asset,limit,start]");
      ok(!calls.some(function (c) { return c[0] === "get_liquidity_pools_by_asset_b"; }), "single B never calls legacy by_asset_b");
      // 10c. Both -> both by_both orders concurrently (each catch []).
      stub();
      await Pool.list({ assetA: "1.3.0", assetB: "1.3.1", limit: 10, startId: "1.19.0" });
      ok(calls.filter(function (c) { return c[0] === "get_liquidity_pools_by_both_assets"; }).length === 2, "both -> two by_both calls");
      ok(hasCall("get_liquidity_pools_by_both_assets", ["1.3.0", "1.3.1", 10, "1.19.0"]), "both order A,B queried");
      ok(hasCall("get_liquidity_pools_by_both_assets", ["1.3.1", "1.3.0", 10, "1.19.0"]), "both order B,A queried");
      // 10d. Merge-dedup by 1.19.x (overlap collapses, symbols joined via stub [] -> bare ids).
      function rawPool(id, a, b) {
        return { id: id, asset_a: a, asset_b: b, share_asset: "1.3.999", balance_a: "100", balance_b: "100", taker_fee_percent: 0, withdrawal_fee_percent: 0 };
      }
      stub(function (m, p) {
        if (m === "get_liquidity_pools_by_both_assets") {
          if (p[0] === "1.3.0") return Promise.resolve([rawPool("1.19.1", "1.3.0", "1.3.1"), rawPool("1.19.2", "1.3.0", "1.3.2")]);
          return Promise.resolve([rawPool("1.19.2", "1.3.0", "1.3.2"), rawPool("1.19.3", "1.3.1", "1.3.2")]);
        }
        if (m === "lookup_asset_symbols") return Promise.resolve([]);
        return Promise.resolve([]);
      });
      const merged = await Pool.list({ assetA: "1.3.0", assetB: "1.3.1", limit: 10, startId: "1.19.0" });
      ok(merged.length === 3, "both merge dedups 1.19.2 (got " + merged.length + ")");
      ok(JSON.stringify(merged.map(function (r) { return r.id; }).sort()) === JSON.stringify(["1.19.1", "1.19.2", "1.19.3"]), "merged ids exact set");
      // 10e. One leg failing resolves [] for that leg, never rejects the merge.
      stub(function (m, p) {
        if (m === "get_liquidity_pools_by_both_assets") {
          if (p[0] === "1.3.0") return Promise.reject(new Error("boom leg-fail"));
          return Promise.resolve([rawPool("1.19.9", "1.3.1", "1.3.0")]);
        }
        if (m === "lookup_asset_symbols") return Promise.resolve([]);
        return Promise.resolve([]);
      });
      const partial = await Pool.list({ assetA: "1.3.0", assetB: "1.3.1", limit: 10, startId: "1.19.0" });
      ok(partial.length === 1 && partial[0].id === "1.19.9", "failing leg degrades to surviving leg");
      // 10f. Limit/start validation kept (signature unchanged).
      let threw = false;
      try { await Pool.list({ limit: 0 }); } catch (e) { threw = true; }
      ok(threw, "limit 0 still rejected");
      threw = false;
      try { await Pool.list({ startId: "1.2.3" }); } catch (e) { threw = true; }
      ok(threw, "bad startId still rejected");
      delete globalThis.Chain;
    })();
    /* BRAND TOGGLES FILTER, NOT DIM (owner 2026-10-07). Turning a brand off used
 * to paint it at 15% opacity: the nodes stayed in the plot, in the hit list,
 * in the table twin and — worst — in the simulation, so the map kept
 * breathing around things the user had switched off. Now the group is removed
 * from the graph, and turning it back on seeds the returning nodes so the
 * physics springs them into the mesh. */
(function () {
  var G = {
    nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "USD" },
            { assetId: "1.3.2", sym: "HONEST.BTC" }, { assetId: "1.3.3", sym: "GDEX.USDT" }],
    edges: [{ poolId: "1.19.1", a: "1.3.0", b: "1.3.1" }, { poolId: "1.19.2", a: "1.3.1", b: "1.3.2" },
            { poolId: "1.19.3", a: "1.3.0", b: "1.3.3" }]
  };
  function ids(g) { return (g.nodes || []).map(function (n) { return n.assetId; }).join(","); }
  function pools(g) { return (g.edges || []).map(function (e) { return e.poolId; }).join(","); }

  ok(G === PoolNet.filterBrands(G, null), "no hidden groups -> the same graph (no copy)");
  ok(G === PoolNet.filterBrands(G, {}), "empty hidden set -> the same graph");
  var btcBrand = PoolNet.brandOf("HONEST.BTC");
  var out = PoolNet.filterBrands(G, (function () { var h = {}; h[btcBrand] = 1; return h; })());
  ok(ids(out) === "1.3.0,1.3.1,1.3.3", "the hidden brand's node is gone (" + ids(out) + ")");
  ok(pools(out) === "1.19.1,1.19.3", "edges touching it are gone too (" + pools(out) + ")");
  ok(ids(G) === "1.3.0,1.3.1,1.3.2,1.3.3", "the input graph is untouched");
  var bts = PoolNet.brandOf("BTS");
  var out2 = PoolNet.filterBrands(G, (function () { var h = {}; h[bts] = 1; return h; })());
  ok(pools(out2) === "", "hiding BTS removes every pool touching it");
  var all = {};
  all[bts] = 1; all[btcBrand] = 1; all[PoolNet.brandOf("GDEX.USDT")] = 1;
  var out3 = PoolNet.filterBrands(G, all);
  ok(ids(out3) === "" && (out3.edges || []).length === 0, "hiding everything yields an empty graph (honest, not a crash)");
  ok(PoolNet.filterBrands(null, all) && PoolNet.filterBrands(null, all).nodes.length === 0, "null graph -> empty, never throws");
  ok(PoolNet.filterBrands({ nodes: [{ assetId: "1.3.0", sym: "BTS" }], edges: [] }, all).nodes.length === 0,
    "a lone node of a hidden brand is dropped");

  /* reseedGeom: survivors hold still, newcomers get seeded positions. */
  var prev = { "1.3.0": { x: 11, y: 12 }, "1.3.1": { x: 13, y: 14 } };
  var r1 = PoolNet.reseedGeom(prev, [{ assetId: "1.3.0" }, { assetId: "1.3.1" }, { assetId: "1.3.2" }], 800, 600);
  ok(r1.geom["1.3.0"].x === 11 && r1.geom["1.3.0"].y === 12, "a survivor keeps its exact position");
  ok(r1.geom["1.3.1"].x === 13 && r1.geom["1.3.1"].y === 14, "a second survivor keeps its position too");
  ok(!!r1.geom["1.3.2"], "a returning node is seeded with a position");
  ok(r1.fresh.join(",") === "1.3.2", "the returning node is reported as freshly seeded");
  ok(isFinite(r1.geom["1.3.2"].x) && isFinite(r1.geom["1.3.2"].y), "the seed is finite (never NaN)");
  ok(Object.keys(r1.geom).length === 3, "the geom holds exactly the current node set");
  var r2 = PoolNet.reseedGeom(prev, [{ assetId: "1.3.1" }], 800, 600);
  ok(Object.keys(r2.geom).join(",") === "1.3.1", "a node that left is dropped from the geom");
  var r3 = PoolNet.reseedGeom(null, [{ assetId: "1.3.0" }, { assetId: "1.3.1" }], 800, 600);
  ok(r3.fresh.length === 2, "with no previous layout every node is fresh");
  ok(Object.keys(r3.geom).length === 2, "and every node still gets a position");
  var r4 = PoolNet.reseedGeom(prev, [{ assetId: "1.3.0" }, { assetId: "1.3.1" }], 0, 0);
  ok(isFinite(r4.geom["1.3.0"].x), "zero-size canvas still yields finite coordinates");
  var r5 = PoolNet.reseedGeom(prev, null, 800, 600);
  ok(Object.keys(r5.geom).length === 0, "null node list -> empty geom, never throws");
  ok(Object.keys(prev).length === 2, "reseedGeom never mutates the previous layout");

  /* Two newcomers must not start stacked (a spring needs something to pull). */
  var r6 = PoolNet.reseedGeom({}, [{ assetId: "a" }, { assetId: "b" }], 800, 600);
  var same = r6.geom.a.x === r6.geom.b.x && r6.geom.a.y === r6.geom.b.y;
  ok(!same, "two newcomers start at different points (no visual pop)");

  /* The painter must not reintroduce a dim path: hidden brands are filtered
   * out upstream, so a 15%-opacity branch would be dead code that suggests
   * "off" is still drawn. */
  var paintSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "vanilla", "js", "views", "pool-net-paint.js"), "utf8");
  ok(paintSrc.indexOf("paint.dim") === -1, "the painter has no dim branch");
  ok(/0\.15/.test(paintSrc) === false, "no 15% opacity branch left behind");
  var uiSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "vanilla", "js", "views", "pool-net-ui.js"), "utf8");
  ok(uiSrc.indexOf("filterBrands") !== -1, "the composer applies the brand filter");
  ok(uiSrc.indexOf("onBrandToggle") !== -1, "the composer handles the chip toggle");
  ok(/hide: \{\}/.test(uiSrc), "state carries a hidden-brand set");
})();

console.log(pass + " passed, " + fail + " failed");
    process.exit(fail ? 1 : 0);
  }
})();
