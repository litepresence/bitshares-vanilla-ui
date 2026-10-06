#!/usr/bin/env node
/* Pool-net vectors: skeleton graph, star/union filters, brand groups.
 * Pure (no chain, no DOM). Exit 0 green, 1 red. */
"use strict";
const PN = require("/workspace/vanilla/js/api/pool-net.js");

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

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
