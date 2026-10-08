/* market-hops-test.js — headless tests for the market-hops pure core + query shape.
 * No network, no DOM: merge + BFS + route + graph shaping. Run: node tooling/market-hops-test.js */
var ok = 0, bad = 0;
function assert(cond, msg) { if (cond) { ok++; } else { bad++; console.log("FAIL: " + msg); } }

var MarketHops = require("../vanilla/js/api/market-hops.js");

/* ---- mergePairs ---- */
var buckets = [
  { key: { pays: "1.3.0", receives: "1.3.121" }, doc_count: 5 },
  { key: { pays: "1.3.121", receives: "1.3.0" }, doc_count: 3 },
  { key: { pays: "1.3.0", receives: "1.3.5" }, doc_count: 2 },
  { key: { pays: "bad", receives: "1.3.0" }, doc_count: 9 },
  { doc_count: 7 }
];
var merged = MarketHops.mergePairs(buckets);
assert(merged.length === 2, "merge: two valid pairs survive (malformed dropped)");
assert(merged[0].a === "1.3.0" && merged[0].b === "1.3.121" && merged[0].fills === 8, "merge: unordered orientations sum to 8");
assert(merged[1].a === "1.3.0" && merged[1].b === "1.3.5" && merged[1].fills === 2, "merge: second pair = 2");
assert(merged[0].fills === 8, "merge: sorted by fills desc");
assert(MarketHops.mergePairs(buckets).length === 2, "merge: pure (repeatable, no mutation)");
assert(MarketHops.mergePairs([]).length === 0, "merge: empty in, empty out");
var selfPair = MarketHops.mergePairs([{ key: { pays: "1.3.0", receives: "1.3.0" }, doc_count: 4 }]);
assert(selfPair.length === 0, "merge: self-pair is not a market");

/* ---- hopsFrom ---- */
var chain = [
  { a: "1.3.1", b: "1.3.2", fills: 100 },
  { a: "1.3.2", b: "1.3.3", fills: 90 },
  { a: "1.3.3", b: "1.3.4", fills: 80 },
  { a: "1.3.4", b: "1.3.5", fills: 70 },
  { a: "1.3.5", b: "1.3.6", fills: 60 }
];
var h3 = MarketHops.hopsFrom(chain, ["1.3.1"], 3);
var ids3 = h3.nodes.map(function (n) { return n.assetId; });
assert(ids3.indexOf("1.3.4") !== -1, "hops3: 3 hops reached");
assert(ids3.indexOf("1.3.5") === -1, "hops3: 4 hops NOT reached (depth bound held)");
assert(h3.edges.length === 3, "hops3: exactly the 3 in-range edges");
var h2 = MarketHops.hopsFrom(chain, ["1.3.1"], 2);
var ids2 = h2.nodes.map(function (n) { return n.assetId; });
assert(ids2.indexOf("1.3.3") !== -1, "hops2: 2 hops reached");
assert(ids2.indexOf("1.3.4") === -1, "hops2: 3 hops NOT reached");

/* no caps: a wide ring around one seed must keep every in-range edge */
var star = [];
for (var i = 1; i <= 120; i++) star.push({ a: "1.3.0", b: "1.3." + (1000 + i), fills: 300 - i });
var hStar = MarketHops.hopsFrom(star, ["1.3.0"], 3);
assert(hStar.edges.length === 120, "nocaps: 120 one-hop edges all kept (no display cap)");
assert(hStar.nodes.length === 121, "nocaps: 121 nodes");

/* seeds always present even when isolated */
var hIso = MarketHops.hopsFrom([], ["1.3.0", "1.3.999"], 2);
assert(hIso.nodes.length === 2, "hops: isolated seeds kept as nodes");
assert(hIso.edges.length === 0, "hops: no pairs, no edges");
assert(hIso.nodes[0].layer === 0, "hops: seeds sit at layer 0");

/* deterministic node order regardless of input order */
var orderA = MarketHops.hopsFrom(chain, ["1.3.1"], 3).nodes.map(function (n) { return n.assetId; }).join(",");
var orderB = MarketHops.hopsFrom(chain.slice().reverse(), ["1.3.1"], 3).nodes.map(function (n) { return n.assetId; }).join(",");
assert(orderA === orderB, "hops: node order deterministic under input reorder");

/* malformed pair rows are dropped, never invented */
var hBad = MarketHops.hopsFrom([{ a: "x", b: "1.3.5", fills: 9 }, { a: "1.3.1", b: "1.3.2", fills: 0 }], ["1.3.1"], 2);
assert(hBad.edges.length === 0, "hops: malformed/zero-fill pairs never become edges");

/* ---- routeToCore ---- */
/* S - X (10), S - Y (5), Y - CORE (5), X - CORE (1): two hops either way,
 * widest bottleneck wins -> SY-CORE. */
var rEdges = [
  { poolId: "SX", a: "1.3.10", b: "1.3.11", fills: 10 },
  { poolId: "SY", a: "1.3.10", b: "1.3.12", fills: 5 },
  { poolId: "YC", a: "1.3.12", b: "1.3.0", fills: 5 },
  { poolId: "XC", a: "1.3.11", b: "1.3.0", fills: 1 }
];
var route = MarketHops.routeToCore(rEdges, ["1.3.10"], "1.3.0");
assert(route !== null, "route: found");
assert(route.hops === 2, "route: 2 hops");
assert(route.assetPath.join(",") === "1.3.10,1.3.12,1.3.0", "route: widest bottleneck path S-Y-CORE chosen");
assert(route.assetPath.indexOf("1.3.11") === -1, "route: thin route rejected");
/* deskIdsFor maps that asset path onto RENDERED edges (which carry desk ids) */
var routeIds = MarketHops.deskIdsFor(route, rEdges);
assert(routeIds.length === 2, "deskIdsFor: 2 edges on the path");
assert(routeIds.indexOf("SY") !== -1 && routeIds.indexOf("YC") !== -1, "deskIdsFor: SY + YC");
assert(routeIds.indexOf("XC") === -1, "deskIdsFor: thin edge not highlighted");
assert(MarketHops.deskIdsFor(route, [{ poolId: "SY", a: "1.3.10", b: "1.3.12" }]).length === 1, "deskIdsFor: partial graph keeps the reachable prefix");
assert(MarketHops.deskIdsFor(null, rEdges).length === 0, "deskIdsFor: null route = no highlight");
assert(MarketHops.deskIdsFor(route, []).length === 0, "deskIdsFor: no edges = no highlight");
var noRoute = MarketHops.routeToCore([{ poolId: "AB", a: "1.3.20", b: "1.3.21", fills: 3 }], ["1.3.20"], "1.3.0");
assert(noRoute === null, "route: null when core unreachable (never fabricated)");
var seedIsCore = MarketHops.routeToCore([], ["1.3.0"], "1.3.0");
assert(seedIsCore !== null && seedIsCore.hops === 0, "route: a leg that IS BTS is already there (0 hops)");

/* ---- query body shape (pinned against es-lab.js:286 top-markets) ---- */
var body = MarketHops._test.queryBody(1, null);
assert(body.size === 0, "query: size 0 (aggregation only)");
assert(body.query.bool.filter[0].term.operation_type === 4, "query: operation_type 4 (fill_order)");
assert(body.query.bool.filter[1].range["block_data.block_time"].gte === "now-24h", "query: 24h window");
assert(body.query.bool.filter[1].range["block_data.block_time"].lte === "now", "query: window ends now");
assert(body.aggs.by_pair.composite.size === 1000, "query: composite page size 1000");
assert(body.aggs.by_pair.composite.sources.length === 2, "query: composite on both legs");
assert(body.aggs.by_pair.composite.sources[0].pays.terms.field === "operation_history.op_object.pays.asset_id.keyword", "query: pays field");
assert(body.aggs.by_pair.composite.sources[1].receives.terms.field === "operation_history.op_object.receives.asset_id.keyword", "query: receives field");
assert(body.after_key === undefined, "query: no after_key on page 1");
assert(MarketHops._test.queryBody(1, { pays: "1.3.0" }).after_key.pays === "1.3.0", "query: after_key carried on page 2");
assert(MarketHops._test.queryBody(2, null).query.bool.filter[1].range["block_data.block_time"].gte === "now-48h", "query: days scales the window");

/* ---- deskId orientation (QUOTE_BASE — market-picker.js:382 / market-net.js:25) ---- */
assert(MarketHops.deskId("BTS", "BTC") === "BTC_BTS", "deskId: quote is the head");

/* ---- toGraph ---- */
var syms = { "1.3.0": "BTS", "1.3.1": "USD", "1.3.2": "BTC" };
var provenance = {
  "BTC_BTS": { latest: "0.00010000", volBaseRaw: "12345678", volQuoteRaw: "1234", volBasePrec: 5, volQuotePrec: 2 }
};
var hops2 = MarketHops.hopsFrom([
  { a: "1.3.0", b: "1.3.2", fills: 30 },
  { a: "1.3.0", b: "1.3.1", fills: 12 }
], ["1.3.0"], 2);
var built = MarketHops.toGraph(hops2, { syms: syms, provenance: provenance, quoteAsset: "1.3.2", baseAsset: "1.3.0" });
assert(built.graph.nodes.length === 3, "toGraph: 3 nodes");
assert(built.graph.nodes[0].sym === "BTS", "toGraph: symbols joined from the sym map");
var btsEdge = null;
built.graph.edges.forEach(function (e) { if (e.id === "BTC_BTS") btsEdge = e; });
assert(btsEdge !== null, "toGraph: the desk BASE leg stays base (BTC_BTS, not BTS_BTC)");
assert(btsEdge.poolId === btsEdge.id, "toGraph: id === poolId (one identity, two names)");
assert(built.meta[btsEdge.id].fills === 30, "toGraph: meta carries the fill count");
assert(built.meta[btsEdge.id].latest === "0.00010000", "toGraph: meta carries provenance latest");
assert(built.meta[btsEdge.id].volBaseRaw === "12345678", "toGraph: meta carries provenance volume");
assert(built.meta[btsEdge.id].volBasePrec === 5, "toGraph: meta carries provenance precision");
var usdEdge = null;
built.graph.edges.forEach(function (e) { if (e.id.indexOf("USD") === 0 || e.id.indexOf("_USD") !== -1) usdEdge = e; });
assert(usdEdge !== null, "toGraph: non-desk-leg edge gets its own desk id");
assert(built.graph.edges.every(function (e) { return /^[A-Za-z0-9.]+_[A-Za-z0-9.]+$/.test(e.id); }), "toGraph: every id is a bare QUOTE_BASE desk id (no object ids — nav works)");
var noSyms = MarketHops.toGraph(MarketHops.hopsFrom([{ a: "1.3.7", b: "1.3.8", fills: 3 }], ["1.3.7"], 1), {});
assert(noSyms.graph.edges.length === 0, "toGraph: unknown symbols drop the edge rather than build a broken desk id");
assert(MarketHops.toGraph(null, {}) !== null && MarketHops.toGraph(null, {}).graph.edges.length === 0, "toGraph: null hops is an honest empty, never a throw");

/* ---- pruneGraph: the desk declutter (owner 2026-10-08) ---- */
var pg = {
  nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "USD" },
    { assetId: "1.3.2", sym: "BTC" }, { assetId: "1.3.3", sym: "CNY" }],
  edges: [
    { id: "USD_BTS", poolId: "USD_BTS", a: "1.3.0", b: "1.3.1", fills: 900, sizeRaw: "900" },
    { id: "BTC_BTS", poolId: "BTC_BTS", a: "1.3.0", b: "1.3.2", fills: 3, sizeRaw: "3" },
    { id: "CNY_BTC", poolId: "CNY_BTC", a: "1.3.2", b: "1.3.3", fills: 2, sizeRaw: "2" }
  ]
};
var pr1 = MarketHops.pruneGraph(pg, 1, [], ["1.3.0", "1.3.3"]);
assert(pr1.edges.length === 3 && pr1.nodes.length === 4, "prune: min 1 keeps everything");
var pr5 = MarketHops.pruneGraph(pg, 5, [], ["1.3.0", "1.3.3"]);
assert(pr5.edges.length === 1, "prune: thin pairs hide below the floor");
assert(pr5.nodes.length === 3, "prune: CNY leg kept as anchor, orphan BTC drops (legs + endpoints only)");
assert(pr5.nodes.some(function (n) { return n.assetId === "1.3.3"; }), "prune: edgeless desk leg stays as anchor");
assert(!pr5.nodes.some(function (n) { return n.assetId === "1.3.2"; }), "prune: isolated BTC drops out");
var prRoute = MarketHops.pruneGraph(pg, 5, ["BTC_BTS"], ["1.3.0", "1.3.3"]);
assert(prRoute.edges.length === 2, "prune: the BTS route is exempt, always paints");
assert(prRoute.edges.some(function (e) { return e.id === "BTC_BTS"; }), "prune: exempt route edge present");
var prNone = MarketHops.pruneGraph(pg, 1000, [], ["1.3.0", "1.3.3"]);
assert(prNone.edges.length === 0 && prNone.nodes.length === 0, "prune: nothing passes -> honest empty, not lonely dots");
assert(pg.edges.length === 3, "prune: input untouched (no mutation)");
assert(MarketHops.pruneGraph(null, 5, [], []).edges.length === 0, "prune: null graph is an honest empty");
assert(MarketHops.readMinFills() === 10, "readMinFills: shipped default is 10");
assert(MarketHops.writeMinFills(0) === true, "writeMinFills accepts zero (show everything)");
assert(MarketHops.writeMinFills(-1) === false, "writeMinFills rejects negatives");
/* Zero round-trips through a stub store (node has no localStorage). */
(function () {
  var had = (typeof global.localStorage !== "undefined") ? global.localStorage : undefined;
  try {
    var box = {};
    global.localStorage = { getItem: function (k) { return (k in box) ? box[k] : null; },
      setItem: function (k, v) { box[k] = String(v); } };
    assert(MarketHops.writeMinFills(0) === true, "writeMinFills persists zero");
    assert(MarketHops.readMinFills() === 0, "readMinFills returns the persisted zero");
    assert(MarketHops.writeMinFills(7) === true, "writeMinFills persists seven");
    assert(MarketHops.readMinFills() === 7, "readMinFills returns seven");
  } finally {
    if (had === undefined) { try { delete global.localStorage; } catch (e) {} }
    else { global.localStorage = had; }
  }
})();
var pz = MarketHops.pruneGraph({
  nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "USD" }],
  edges: [{ id: "USD_BTS", poolId: "USD_BTS", a: "1.3.0", b: "1.3.1", fills: 2, sizeRaw: "2" }]
}, 0, [], ["1.3.0", "1.3.1"]);
assert(pz.edges.length === 1, "prune: min 0 keeps thin pairs too");

console.log("market-hops: " + ok + " passed, " + bad + " failed");
if (bad > 0) process.exit(1);