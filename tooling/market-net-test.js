#!/usr/bin/env node
/* Market-net vectors: rank (volume-desc BigInt), candidates (pool
 * counterparties + seeds + cache + typed, capped 20), cache (localStorage
 * marketNetSeen, chain merges, stale dropped).
 * Pure (no chain, no DOM). Exit 0 green, 1 red. */
"use strict";
const MN = require("../vanilla/js/api/market-net.js");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}

// 0. Surface: pure fns only, no DOM, no chain calls in this module.
(function () {
  ok(typeof MN.candidates === "function", "surface candidates fn");
  ok(typeof MN.rank === "function", "surface rank fn");
  ok(typeof MN.readCache === "function", "surface readCache fn");
  ok(typeof MN.writeCache === "function", "surface writeCache fn");
})();

// 1. Rank volume-desc, zero-volume kept with nulls (brief verbatim rows).
(function () {
  const rows = [
    { a: "1.3.0", b: "1.3.1", symA: "BTS", symB: "USD", baseVol: "5000", latest: "0.05", change: "1.2" },
    { a: "1.3.0", b: "1.3.2", symA: "BTS", symB: "BTC", baseVol: "9000", latest: "0.001", change: "-0.4" },
    { a: "1.3.0", b: "1.3.3", symA: "BTS", symB: "DOGE", baseVol: "0", latest: null, change: null }
  ];
  const ranked = MN.rank(rows);
  ok(ranked[0].symB === "BTC" && ranked.length === 3, "rank volume-desc, zero-volume kept with nulls");
  ok(rows[0].symB === "USD", "rank does not mutate input order");
})();

// 2. Rank tie-break (equal vols -> symB alpha) + BigInt + malformed fail-open.
(function () {
  const huge = "90071992547409931234567890"; // beyond float-safe range: BigInt only
  const rows = [
    { a: "1.3.0", b: "1.3.9", symA: "BTS", symB: "ZZZ", baseVol: "100", latest: null, change: null },
    { a: "1.3.0", b: "1.3.8", symA: "BTS", symB: "AAA", baseVol: "100", latest: null, change: null },
    { a: "1.3.0", b: "1.3.7", symA: "BTS", symB: "BIG", baseVol: huge, latest: null, change: null },
    { a: "1.3.0", b: "1.3.6", symA: "BTS", symB: "BAD", baseVol: "not-a-number", latest: null, change: null }
  ];
  const ranked = MN.rank(rows);
  ok(ranked[0].symB === "BIG", "rank BigInt huge volume first (no float)");
  ok(ranked[1].symB === "AAA" && ranked[2].symB === "ZZZ", "rank tie-break symB alpha");
  ok(ranked[3].symB === "BAD", "rank malformed volume sorts as zero, kept");
})();

// 5. Candidates: pool counterparties of X first (Y_X orientation), then
// seeds + cached + typed, deduped.
(function () {
  const poolGraph = {
    nodes: [
      { assetId: "1.3.0", sym: "BTS" },
      { assetId: "1.3.1", sym: "USD" },
      { assetId: "1.3.2", sym: "BTC" }
    ],
    edges: [
      { poolId: "1.19.1", a: "1.3.0", b: "1.3.1" },
      { poolId: "1.19.2", a: "1.3.2", b: "1.3.0" }
    ]
  };
  const out = MN.candidates(poolGraph, "1.3.0", ["BTS_USD"], ["ETH_BTS"], "FOO_BTS");
  ok(out[0] === "USD_BTS" && out[1] === "BTC_BTS", "candidates pool counterparties first, Y_X oriented");
  ok(out.indexOf("BTS_USD") !== -1, "candidates keeps curated seed verbatim");
  ok(out.indexOf("ETH_BTS") !== -1, "candidates keeps cached market");
  ok(out.indexOf("FOO_BTS") !== -1, "candidates keeps typed pair");
  ok(out.length === 5, "candidates dedupes overlap (BTS_USD vs USD_BTS stay distinct desks, got " + out.length + ")");
})();

// 6. Candidates cap 20 + legacy 4-arg shape (stub compat, no X).
(function () {
  const many = [];
  for (let i = 0; i < 30; i++) many.push("SYM" + i + "_BTS");
  const out = MN.candidates({ nodes: [], edges: [] }, "1.3.0", many, [], null);
  ok(out.length === 20, "candidates capped at 20 (got " + out.length + ")");
  const legacy = MN.candidates(null, ["A_BTS"], ["B_BTS"], "C_BTS");
  ok(legacy.length === 3 && legacy[2] === "C_BTS", "candidates legacy 4-arg shape works");
})();

// 7. Cache: node-safe empty, round-trip, corrupt fail-open, reconcile.
(function () {
  ok(JSON.stringify(MN.readCache()) === "[]", "cache reads empty without localStorage");
  const keep = {};
  globalThis.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(keep, k) ? keep[k] : null; },
    setItem: function (k, v) { keep[k] = String(v); },
    removeItem: function (k) { delete keep[k]; }
  };
  MN.writeCache(["BTC_BTS", "USD_BTS"]);
  ok(JSON.stringify(MN.readCache()) === JSON.stringify(["BTC_BTS", "USD_BTS"]), "cache round-trips market ids");
  keep[MN.CACHE_KEY] = "not-json{{{";
  ok(JSON.stringify(MN.readCache()) === "[]", "cache corrupt JSON reads empty, never throws");
  keep[MN.CACHE_KEY] = JSON.stringify(["BTC_BTS", "STALE_X", 42, "no-underscore"]);
  const read = MN.readCache();
  ok(read.length === 2 && read[0] === "BTC_BTS" && read[1] === "STALE_X", "cache keeps shape-valid ids, drops non-QUOTE_BASE entries (staleness is reconcile's job)");
  keep[MN.CACHE_KEY] = JSON.stringify([]);
  let r = MN.reconcileCache(["BTS_USD"], ["BTS_USD", "BTC_BTS", "ETH_BTS"]);
  ok(r.added.length === 2 && MN.readCache().length === 2, "cache learns live-minus-seeds");
  r = MN.reconcileCache(["BTS_USD"], ["BTS_USD"]);
  ok(r.dropped.length === 2 && MN.readCache().length === 0, "stale ids dropped on re-validate");
  delete globalThis.localStorage;
})();

// 8. Graph: volume-gated edges, desk-id edge ids, orientation dedupe.
(function () {
  const rows = [
    { a: "1.3.0", b: "1.3.1", symA: "BTS", symB: "USD", baseVol: "5000", quoteVol: "250", latest: "0.05", change: "1.2" },
    { a: "1.3.1", b: "1.3.0", symA: "USD", symB: "BTS", baseVol: "999999", quoteVol: "1", latest: "20.0", change: "0.1" },
    { a: "1.3.0", b: "1.3.2", symA: "BTS", symB: "BTC", baseVol: "0", latest: null, change: null },
    { a: "1.3.0", b: "1.3.3", symA: "BTS", symB: "BAD", baseVol: "not-a-number", latest: null, change: null }
  ];
  const g = MN.graph(rows, "1.3.0");
  ok(g.edges.length === 1, "only the nonzero-volume pair survives");
  ok(g.edges[0].id === "USD_BTS", "focus-base orientation wins (QUOTE_BASE desk id)");
  ok(g.nodes.length === 2, "nodes are the kept edge's assets");
  ok(g.meta["USD_BTS"].volBaseRaw === "5000", "meta carries raw volume + labels");
  ok(rows.length === 4, "input untouched");
  const g2 = MN.graph([rows[1], rows[0], rows[2], rows[3]], "1.3.0");
  ok(g2.edges.length === 1 && g2.edges[0].id === "USD_BTS", "focus-base wins regardless of input order");
})();

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
