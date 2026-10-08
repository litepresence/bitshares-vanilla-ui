/* market-desk-map-test.js — headless: the exchange desk's network map.
 * Proves the CLEAN SPLIT (market world paints market semantics, pool world
 * is byte-identical) and the honest empty states. No network, no DOM layout.
 *
 * Run: node tooling/market-desk-map-test.js */
var ok = 0, bad = 0;
function assert(cond, msg) { if (cond) { ok++; } else { bad++; console.log("FAIL: " + msg); } }

var PoolGraph = require("../vanilla/js/api/pool-graph.js");
var MarketHops = require("../vanilla/js/api/market-hops.js");

/* Minimal canvas stub: records the draw calls we assert on. */
function stubCanvas() {
  var calls = { stroke: [], fill: [], text: [], lineWidth: [] };
  var ctx = {
    setTransform: function () {}, clearRect: function () {}, save: function () {}, restore: function () {},
    beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
    stroke: function () { calls.stroke.push(ctx.strokeStyle); },
    arc: function () {}, fill: function () { calls.fill.push(ctx.fillStyle); },
    fillText: function (s) { calls.text.push(String(s)); },
    strokeText: function () {},
    quadraticCurveTo: function () {},
    get strokeStyle() { return ctx._stroke || ""; }, set strokeStyle(v) { ctx._stroke = v; },
    get fillStyle() { return ctx._fill || ""; }, set fillStyle(v) { ctx._fill = v; },
    get lineWidth() { return ctx._lw || 0; }, set lineWidth(v) { ctx._lw = v; calls.lineWidth.push(v); },
    set font(v) {}, set textAlign(v) {}, set shadowColor(v) {}, set shadowBlur(v) {}
  };
  return {
    width: 0, height: 0, style: {}, clientWidth: 400, clientHeight: 180,
    getContext: function () { return ctx; },
    addEventListener: function () {}, setAttribute: function () {},
    getAttribute: function (a) { return a === "aria-label" ? null : null; },
    getBoundingClientRect: function () { return { left: 0, top: 0 }; },
    _calls: calls
  };
}

/* A market graph with a real BTS route through the most-filled path. */
var hops = MarketHops.hopsFrom([
  { a: "1.3.0", b: "1.3.1", fills: 900 },   /* BTS-USD  (fat)      */
  { a: "1.3.0", b: "1.3.2", fills: 40 },    /* BTS-BTC  (thin)     */
  { a: "1.3.1", b: "1.3.2", fills: 60 }      /* USD-BTC              */
], ["1.3.0"], 2);
var built = MarketHops.toGraph(hops, { syms: { "1.3.0": "BTS", "1.3.1": "USD", "1.3.2": "BTC" } });
assert(built.graph.edges.length === 3, "fixtures: 3 market edges emitted");
assert(built.graph.edges.every(function (e) { return e.id === e.poolId; }), "fixtures: id === poolId on every edge");

/* ---- market kind paints through the shared painter ---- */
var cv = stubCanvas();
var res = PoolGraph.drawGraph(null, cv, built.graph, {
  assetA: "1.3.0", assetB: "1.3.1", kind: "market", nav: { mode: "market" }
});
assert(res !== null && res.empty === false, "market: graph paints (nodes + edges reported)");
assert(res.edges === 3, "market: 3 edge hit records");

/* ---- the market world speaks MARKETS, not pools ---- */
var allText = cv._calls.text.join(" | ");
assert(allText.indexOf("orphaned") === -1, "market: no pool orphan verdict text");
assert(allText.indexOf("WARNING") === -1, "market: no pool takeover warning");
assert(allText.indexOf("connects to BTS") === -1, "market: no pool per-leg hop verdict");
assert(allText.indexOf("reaches") === -1, "market: no pool pair-distance verdict");

/* ---- pool kind still speaks POOLS (clean split, zero drift) ---- */
var poolEdges = [
  { poolId: "1.19.1", a: "1.3.1", b: "1.3.2", sizeRaw: "123456789012345678" },
  { poolId: "1.19.2", a: "1.3.0", b: "1.3.1", sizeRaw: "99999999999999999999" }
];
var cvPool = stubCanvas();
var resPool = PoolGraph.drawGraph(null, cvPool, { nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "USD" }], edges: poolEdges }, {
  assetA: "1.3.0", assetB: "1.3.1", highlightPools: []
});
var poolText = cvPool._calls.text.join(" | ");
assert(resPool !== null, "pool: graph paints");
assert(poolText.indexOf("connects to BTS") !== -1, "pool: BTS verdict text still present (unchanged)");

/* ---- fills ramp: a fat market line is inked differently from a thin one ---- */
function strokeFor(fills) {
  var c = stubCanvas();
  var h1 = MarketHops.hopsFrom([{ a: "1.3.0", b: "1.3.1", fills: fills }], ["1.3.0"], 1);
  var g1 = MarketHops.toGraph(h1, { syms: { "1.3.0": "BTS", "1.3.1": "USD" } });
  PoolGraph.drawGraph(null, c, g1.graph, { assetA: "1.3.0", assetB: "1.3.1", kind: "market" });
  return c._calls.stroke.join(",");
}
assert(strokeFor(1) !== strokeFor(9000), "market: fills ramp distinguishes thin from fat lines");

/* ---- honest empty: markets never cry wolf ---- */
var cvEmpty = stubCanvas();
PoolGraph.drawGraph(null, cvEmpty, { nodes: [{ assetId: "1.3.0", sym: "BTS" }], edges: [] }, {
  assetA: "1.3.0", assetB: "1.3.1", kind: "market"
});
var emptyText = cvEmpty._calls.text.join(" | ");
assert(emptyText.indexOf("No market filled") !== -1, "market empty: honest 'no 24h fills' sentence");
assert(emptyText.indexOf("WARNING") === -1, "market empty: never the pool takeover banner");
var cvPoolEmpty = stubCanvas();
PoolGraph.drawGraph(null, cvPoolEmpty, { nodes: [], edges: [] }, { assetA: "1.3.0", assetB: "1.3.1" });
assert(cvPoolEmpty._calls.text.join(" ").indexOf("WARNING") !== -1, "pool empty: takeover banner unchanged");

/* ---- aria names the world that is painted ---- */
var cvAria = stubCanvas();
var setAttrs = {};
cvAria.setAttribute = function (k, v) { setAttrs[k] = v; };
PoolGraph.drawGraph(null, cvAria, built.graph, { assetA: "1.3.0", assetB: "1.3.1", kind: "market" });
assert(String(setAttrs["aria-label"] || "").indexOf("filled in the past 24 hours") !== -1, "market: aria label names 24h fills");
/* Pool aria: the generic label seeds first, then the verdict block REPLACES
 * it with the map's own verdicts (so a screen reader hears the story). Assert
 * the pool path still produces pool words, not the market sentence. */
var cvAriaP = stubCanvas();
var attrsP = {}; cvAriaP.setAttribute = function (k, v) { attrsP[k] = v; };
PoolGraph.drawGraph(null, cvAriaP, { nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "USD" }], edges: poolEdges }, { assetA: "1.3.0", assetB: "1.3.1" });
var poolAria = String(attrsP["aria-label"] || "");
assert(poolAria.indexOf("filled in the past 24 hours") === -1, "pool: aria never claims market fills");
assert(poolAria.indexOf("BTS") !== -1 || poolAria.indexOf("Pool map") !== -1, "pool: aria names BTS / the pool map");

/* ---- drawLive forwards kind/meta/route so the live loop keeps the world ---- */
var cvLive = stubCanvas();
var S = PoolGraph.drawLive(null, cvLive, built.graph, {
  assetA: "1.3.0", assetB: "1.3.1", kind: "market", nav: { mode: "market" },
  routeDeskIds: [], reduced: true
});
assert(S !== null, "market: drawLive returns the loop state");
assert(S.drawOpts.kind === "market", "market: drawLive records kind=market for every frame");
var S2 = PoolGraph.drawLive(null, stubCanvas(), { nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "USD" }], edges: poolEdges }, {
  assetA: "1.3.0", assetB: "1.3.1"
});
assert(S2.drawOpts.kind === "pool", "pool: drawLive defaults to kind=pool");

/* ---- route highlight reaches the painter as the path set ---- */
/* BTS-USD-... -> BTC has no route to BTS (BTS is the seed), so use the desk
 * legs at BTC and check the BTS-USD-BTC route exists via USD. */
/* No direct BTC-BTS line, so the only route to BTS is BTC-USD-BTS: two hops.
 * With a direct line present the router correctly prefers the 1-hop route
 * regardless of fills (fewest hops wins; asserted separately below). */
var deskHops = MarketHops.hopsFrom([
  { a: "1.3.0", b: "1.3.1", fills: 900 },
  { a: "1.3.1", b: "1.3.2", fills: 60 },
  { a: "1.3.0", b: "1.3.3", fills: 800 }
], ["1.3.2"], 3);
var route = MarketHops.routeToCore(deskHops.edges, ["1.3.2"], "1.3.0");
assert(route !== null, "route: BTC reaches BTS in 2 hops");
assert(route.assetPath.join(",") === "1.3.2,1.3.1,1.3.0", "route: BTC-USD-BTS chosen over the dead-end");
var deskBuilt = MarketHops.toGraph(deskHops, { syms: { "1.3.0": "BTS", "1.3.1": "USD", "1.3.2": "BTC", "1.3.3": "CNY" }, quoteAsset: "1.3.1", baseAsset: "1.3.2" });
var routeDeskIds = MarketHops.deskIdsFor(route, deskBuilt.graph.edges);
assert(routeDeskIds.length === 2, "route: 2 rendered edges on the BTC->BTS route");

/* Fewest hops beats fills: with a direct thin line present, the 1-hop route
 * wins over the fat 2-hop one (the tiebreak only applies WITHIN equal hops). */
var direct = MarketHops.hopsFrom([
  { a: "1.3.0", b: "1.3.1", fills: 900 },
  { a: "1.3.1", b: "1.3.2", fills: 60 },
  { a: "1.3.0", b: "1.3.2", fills: 5 }
], ["1.3.2"], 3);
assert(MarketHops.routeToCore(direct.edges, ["1.3.2"], "1.3.0").hops === 1, "route: fewest hops wins over wider routes");
var cvRoute = stubCanvas();
PoolGraph.drawGraph(null, cvRoute, deskBuilt.graph, {
  assetA: "1.3.1", assetB: "1.3.2", kind: "market", routeDeskIds: routeDeskIds
});
assert(cvRoute._calls.lineWidth.indexOf(2.5) !== -1, "market: the BTS route line glows at path width");
var cvNoRoute = stubCanvas();
PoolGraph.drawGraph(null, cvNoRoute, deskBuilt.graph, {
  assetA: "1.3.1", assetB: "1.3.2", kind: "market", routeDeskIds: []
});
assert(cvNoRoute._calls.lineWidth.indexOf(2.5) === -1, "market: no route -> nothing glows (honest, not a warning)");

/* ---- market node ink: legs green, BTS blue, rest grey (owner 2026-10-08) ---- */
var cvInk = stubCanvas();
PoolGraph.drawGraph(null, cvInk, deskBuilt.graph, {
  assetA: "1.3.1", assetB: "1.3.2", kind: "market", routeDeskIds: routeDeskIds
});
var fills = cvInk._calls.fill;
assert(fills.indexOf("#007bff") !== -1, "market: BTS node painted core blue");
assert(fills.indexOf("#7bd500") !== -1, "market: desk legs painted green");
assert(fills.indexOf("#f74745") === -1, "market: no red anywhere (thin markets are normal, never warnings)");
/* Pool ink unchanged: legs keep their trust verdicts. */
var cvPoolInk = stubCanvas();
PoolGraph.drawGraph(null, cvPoolInk, { nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "USD" }], edges: poolEdges }, {
  assetA: "1.3.0", assetB: "1.3.1"
});
assert(cvPoolInk._calls.fill.indexOf("#007bff") !== -1, "pool: BTS node still core blue");

/* ---- market route ink: the BTS triangle reads solid blue ---- */
var routeStrokes = cvRoute._calls.stroke.filter(function (c) { return c === "#007bff"; });
assert(routeStrokes.length > 0, "market: the BTS route line is core blue");
/* ---- hover: yellow, exactly like the pool desk ---- */
var cvHov = stubCanvas();
var hovEdge = deskBuilt.graph.edges[0].poolId;
PoolGraph.drawGraph(null, cvHov, deskBuilt.graph, {
  assetA: "1.3.1", assetB: "1.3.2", kind: "market", routeDeskIds: routeDeskIds, hoverEdge: hovEdge
});
assert(cvHov._calls.stroke.indexOf("#fbbc06") !== -1, "market: hovered line is yellow (pool-desk parity)");
var cvPoolHov = stubCanvas();
PoolGraph.drawGraph(null, cvPoolHov, { nodes: [{ assetId: "1.3.0", sym: "BTS" }, { assetId: "1.3.1", sym: "USD" }], edges: poolEdges }, {
  assetA: "1.3.0", assetB: "1.3.1", hoverEdge: "1.19.1"
});
assert(cvPoolHov._calls.stroke.indexOf("#fbbc06") !== -1, "pool: hovered line still yellow");

console.log("market-desk-map: " + ok + " passed, " + bad + " failed");
if (bad > 0) process.exit(1);