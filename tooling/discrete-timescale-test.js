#!/usr/bin/env node
/* discrete-timescale-test.js — unit vectors for the Discrete timescale mode.
 * Owns: tf=discrete query round-trip, Discrete label, fillsToPoints and
 *   swapsToPoints mapping vectors, DiscreteCharts stub-canvas smoke.
 * Consumes: vanilla/js/views/market-desk-query.js, market-ind.js (facade),
 *   api/market-fills-history.js, api/pool-history.js, api/discrete-charts.js.
 * Globals/side effects: stubs globalThis.Format where noted, restored after.
 * Stdlib only: `node tooling/discrete-timescale-test.js` (exit 0 = green).
 * No network, no DOM, no deps.
 * Created by: discrete-timescale plan Task 1 (brainstormed design 2026-10-06).
 */
"use strict";
var assert = require("assert");
var MarketDeskQ = require("../vanilla/js/views/market-desk-query.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var IND = {
  OVERLAY_DEFS: [["sma", null], ["ema", null]],
  OSC_ORDER: [["volume", "Volume"], ["rsi", "RSI"]]
};

/* tf=discrete seeds the mode flag and keeps a sane numeric bucket. */
var d = MarketDeskQ._query.readDeskQuery({ tf: "discrete" }, IND);
eq(d.discrete, true, "tf=discrete sets the flag");
eq(d.bucket, 3600, "tf=discrete keeps the default numeric bucket");

/* Plain queries stay non-discrete (backward compatible). */
d = MarketDeskQ._query.readDeskQuery(null, IND);
eq(d.discrete, false, "null query is not discrete");
d = MarketDeskQ._query.readDeskQuery({ tf: "900" }, IND);
eq(d.discrete, false, "numeric tf is not discrete");
eq(d.bucket, 900, "numeric tf still parses");

/* Build: discrete writes tf=discrete and suppresses indicator/plot params. */
var q = MarketDeskQ._query.buildDeskQuery({ bucket: 3600, discrete: true, over: { sma: [{}] }, osc: { rsi: true }, logScale: true, showVwap: true, showDepth: true, showPoolMap: false });
eq(q.indexOf("tf=discrete") !== -1, true, "discrete serializes tf=discrete");
eq(q.indexOf("over="), -1, "discrete suppresses over");
eq(q.indexOf("osc="), -1, "discrete suppresses osc");
eq(q.indexOf("vwap="), -1, "discrete suppresses vwap");
eq(q.indexOf("depth="), -1, "discrete suppresses depth");
eq(q.indexOf("pmap="), -1, "discrete suppresses pmap");
eq(q.indexOf("log=1") !== -1, true, "discrete keeps log");

/* Build: non-discrete output is byte-identical to before (no tf when default). */
q = MarketDeskQ._query.buildDeskQuery({ bucket: 3600, over: {}, osc: {}, logScale: false, showVwap: false, showDepth: false, showPoolMap: true });
eq(q, "", "default desk still serializes empty");

/* Leaving Discrete restores the retained numeric bucket (no refetch surprise). */
(function () {
  var IND2 = { OVERLAY_DEFS: [["sma", null]], OSC_ORDER: [["rsi", "RSI"]] };
  var seed = MarketDeskQ._query.readDeskQuery({ tf: "discrete" }, IND2);
  eq(seed.bucket, 3600, "discrete seed retains numeric bucket");
  var back = MarketDeskQ._query.buildDeskQuery({ bucket: seed.bucket, discrete: false, over: {}, osc: {}, logScale: false, showVwap: false, showDepth: false, showPoolMap: true });
  eq(back, "", "leaving discrete restores clean default URL");
})();

/* bucketLabel: discrete short label (needs the panes registry _test). */
try {
  var MarketInd = require("../vanilla/js/views/market-ind.js");
  var api = MarketInd._panes || MarketInd;
  if (api && api._test && typeof api._test.bucketLabel === "function") {
    eq(api._test.bucketLabel("discrete"), "Discrete", "discrete label");
    eq(api._test.bucketLabel(3600), "1h", "numeric labels unchanged");
  }
} catch (e) { /* registry without _test: label covered manually */ }

/* fillsToPoints: newest-first fills in, oldest-first points out. */
(function () {
  var MarketFills = require("../vanilla/js/api/market-fills-history.js");
  var G = (typeof globalThis !== "undefined") ? globalThis : global;
  var savedFormat = G.Format;
  /* Deterministic Format stub: price names its legs, volume echoes raw. */
  G.Format = {
    formatPrice: function (bRaw, bP, qRaw, qP, pl) { return "P(" + bRaw + "/" + qRaw + ":" + bP + "," + qP + "," + pl + ")"; },
    formatAmount: function (raw, prec) { return "A(" + raw + ":" + prec + ")"; }
  };
  try {
    var fills = [
      { time: "2026-10-05T02:00:00", paid: { amount: "300", asset: "1.3.0" }, received: { amount: "30", asset: "1.3.1" } },
      { time: "2026-10-05T01:00:00", paid: { amount: "100", asset: "1.3.0" }, received: { amount: "10", asset: "1.3.1" } },
      { time: "2026-10-05T01:00:00", paid: { amount: "200", asset: "1.3.0" }, received: { amount: "25", asset: "1.3.1" } },
      { time: "bogus", paid: { amount: "1", asset: "1.3.0" }, received: { amount: "1", asset: "1.3.1" } },
      { time: "2026-10-05T03:00:00", paid: { amount: "5", asset: "1.3.999" }, received: { amount: "5", asset: "1.3.1" } }
    ];
    /* baseId 1.3.0, precB 5, precQ 4, quoteId 1.3.1, cap 10. */
    var pts = MarketFills.fillsToPoints(fills, "1.3.0", 5, 4, "1.3.1", 10);
    eq(pts.length, 3, "two bad rows skipped, three points kept");
    eq(pts[0].volumeBaseRaw, "200", "tie slot: older of the pair first");
    eq(pts[1].volumeBaseRaw, "100", "tie slot: newer of the pair second");
    eq(pts[0].timeMs === pts[1].timeMs, true, "same slot is two points");
    eq(pts[2].timeMs > pts[1].timeMs, true, "newest fill last");
    eq(pts[0].volume, "A(200:5)", "base-leg human volume");
    /* Same-second fills stay SEPARATE points (the point of Discrete). */
    var same = [
      { time: "2026-10-05T01:00:00", paid: { amount: "100", asset: "1.3.0" }, received: { amount: "10", asset: "1.3.1" } },
      { time: "2026-10-05T01:00:00.500", paid: { amount: "200", asset: "1.3.0" }, received: { amount: "25", asset: "1.3.1" } }
    ];
    var pts2 = MarketFills.fillsToPoints(same, "1.3.0", 5, 4, "1.3.1", 10);
    eq(pts2.length, 2, "same-second fills are two points, never merged");
    /* Cap slices newest-first BEFORE oldest-first paint order. */
    var pts3 = MarketFills.fillsToPoints(fills.slice(0, 3), "1.3.0", 5, 4, "1.3.1", 2);
    eq(pts3.length, 2, "cap slices to newest 2");
    eq(pts3[1].volumeBaseRaw, "300", "newest fill survives the cap");
    /* Inverted orientation: baseId on the received leg still maps. */
    var inv = [{ time: "2026-10-05T04:00:00", paid: { amount: "10", asset: "1.3.1" }, received: { amount: "100", asset: "1.3.0" } }];
    var pts4 = MarketFills.fillsToPoints(inv, "1.3.0", 5, 4, "1.3.1", 10);
    eq(pts4.length, 1, "inverted legs map");
    eq(pts4[0].volumeBaseRaw, "100", "inverted base raw is the received leg");
    /* Bad cap throws named, empty fills are valid. */
    assert.throws(function () { MarketFills.fillsToPoints(fills, "1.3.0", 5, 4, "1.3.1", 0); }, /bad-count/, "cap 0 throws bad-count");
    eq(MarketFills.fillsToPoints([], "1.3.0", 5, 4, "1.3.1", 10).length, 0, "empty fills valid");
  } finally {
    if (savedFormat === undefined) delete G.Format; else G.Format = savedFormat;
  }
})();

/* swapsToPoints: newest-first tape in, oldest-first points out. */
(function () {
  var PoolHistory = require("../vanilla/js/api/pool-history.js");
  var G = (typeof globalThis !== "undefined") ? globalThis : global;
  var savedFormat = G.Format;
  G.Format = { formatAmount: function (raw, prec) { return "A(" + raw + ":" + prec + ")"; } };
  try {
    var swaps = [
      { time: "2026-10-05T02:00:00", price: "2.0", paid: { amount: "20", asset: "1.3.1" }, received: { amount: "40", asset: "1.3.2" } },
      { time: "2026-10-05T01:00:00", price: "1.0", paid: { amount: "10", asset: "1.3.1" }, received: { amount: "10", asset: "1.3.2" } },
      { time: "2026-10-05T01:00:00", price: "1.5", paid: { amount: "30", asset: "1.3.2" }, received: { amount: "20", asset: "1.3.1" } },
      { time: "2026-10-05T00:00:00", price: null, paid: { amount: "1", asset: "1.3.1" }, received: { amount: "1", asset: "1.3.2" } }
    ];
    /* assetB 1.3.2, precB 5, cap 10. */
    var pts = PoolHistory.swapsToPoints(swaps, "1.3.2", 5, 10);
    eq(pts.length, 3, "null-price swap skipped");
    eq(pts[0].price, "1.5", "tie slot: older of the pair first");
    eq(pts[1].price, "1.0", "tie slot: newer of the pair second");
    eq(pts[0].volumeBaseRaw, "30", "paid-B leg is the base volume");
    eq(pts[1].volumeBaseRaw, "10", "received-B leg is the base volume");
    eq(pts[1].volume, "A(10:5)", "B-leg human volume");
    eq(pts[2].price, "2.0", "newest swap last");
    var capped = PoolHistory.swapsToPoints(swaps.slice(0, 3), "1.3.2", 5, 2);
    eq(capped.length, 2, "cap slices newest 2");
    eq(capped[1].price, "2.0", "newest swap survives the cap");
    assert.throws(function () { PoolHistory.swapsToPoints(swaps, "1.3.2", 5, 0); }, /bad-count/, "cap 0 throws bad-count");
    eq(PoolHistory.swapsToPoints([], "1.3.2", 5, 10).length, 0, "empty tape valid");
  } finally {
    if (savedFormat === undefined) delete G.Format; else G.Format = savedFormat;
  }
})();

/* DiscreteCharts smoke: stub canvas 2D, no DOM, no network. */
(function () {
  var DiscreteCharts = require("../vanilla/js/api/discrete-charts.js");
  function stubCtx() {
    return { calls: [], setTransform: function () {}, clearRect: function () {}, beginPath: function () { this.calls.push("begin"); }, arc: function () { this.calls.push("dot"); }, fill: function () { this.calls.push("fill"); }, moveTo: function () { this.calls.push("move"); }, lineTo: function () { this.calls.push("line"); }, stroke: function () { this.calls.push("stroke"); }, fillText: function () {}, setLineDash: function () {} };
  }
  function stubDoc(ctx) {
    return { createElement: function () { return { className: "", style: {}, clientWidth: 300, width: 0, height: 0, getContext: function () { return ctx; }, setAttribute: function () {}, appendChild: function () {} }; } };
  }
  function stubHost() {
    var kids = [];
    return { clientWidth: 300, appendChild: function (k) { kids.push(k); }, removeChild: function () {}, get children() { return kids; } };
  }
  var pts = [
    { timeMs: 1000, price: "1.0", volume: "A(10:5)", volumeBaseRaw: "10", volumeQuoteRaw: "5" },
    { timeMs: 1000, price: "1.5", volume: "A(30:5)", volumeBaseRaw: "30", volumeQuoteRaw: "20" },
    { timeMs: 2000, price: "2.0", volume: "A(40:5)", volumeBaseRaw: "40", volumeQuoteRaw: "20" }
  ];
  var ctx = stubCtx();
  var r = DiscreteCharts.drawDiscretePrice(stubDoc(ctx), stubHost(), pts, { log: false, colors: {} });
  eq(r.n, 3, "price paints 3 dots");
  eq(ctx.calls.indexOf("dot") !== -1, true, "dots drawn as arcs");
  var ctxLog = stubCtx();
  var rLog = DiscreteCharts.drawDiscretePrice(stubDoc(ctxLog), stubHost(), pts, { log: true, colors: {} });
  eq(rLog.n, 3, "log price keeps positive dots");
  var ctx2 = stubCtx();
  var r2 = DiscreteCharts.drawDiscreteVolume(stubDoc(ctx2), stubHost(), pts, { colors: {} });
  eq(r2.n, 3, "volume paints 3 stems");
  var ctx3 = stubCtx();
  var r3 = DiscreteCharts.drawDiscretePrice(stubDoc(ctx3), stubHost(), [], { colors: {} });
  eq(r3.n, 0, "empty points valid, honest empty (no throw)");
})();

/* Point identity passthrough (hover card): account/order/block ride along
 * when the row carries them, null otherwise; quote-leg human volume added. */
(function () {
  var MarketFills = require("../vanilla/js/api/market-fills-history.js");
  var G = (typeof globalThis !== "undefined") ? globalThis : global;
  var savedFormat = G.Format;
  G.Format = {
    formatPrice: function (bRaw, bP, qRaw, qP, pl) { return "P"; },
    formatAmount: function (raw, prec) { return "A(" + raw + ":" + prec + ")"; }
  };
  try {
    var fills = [{
      time: "2026-10-05T02:00:00", account: "1.2.33", order: "1.7.44",
      paid: { amount: "300", asset: "1.3.0" }, received: { amount: "30", asset: "1.3.1" }
    }];
    var pts = MarketFills.fillsToPoints(fills, "1.3.0", 5, 4, "1.3.1", 10);
    eq(pts.length, 1, "enriched fill maps");
    eq(pts[0].accountId, "1.2.33", "filler account passes through");
    eq(pts[0].orderId, "1.7.44", "order id passes through");
    eq(pts[0].blockNum, null, "chain fill has no block (honest null)");
    eq(pts[0].volumeQuote, "A(30:4)", "quote-leg human volume");
    var bare = [{
      time: "2026-10-05T02:00:00",
      paid: { amount: "300", asset: "1.3.0" }, received: { amount: "30", asset: "1.3.1" }
    }];
    var pts2 = MarketFills.fillsToPoints(bare, "1.3.0", 5, 4, "1.3.1", 10);
    eq(pts2[0].accountId, null, "missing account is null, never guessed");
    eq(pts2[0].orderId, null, "missing order is null");
  } finally {
    if (savedFormat === undefined) delete G.Format; else G.Format = savedFormat;
  }
})();

/* Swap identity passthrough (tape rows already carry account + block). */
(function () {
  var PoolHistory = require("../vanilla/js/api/pool-history.js");
  var G = (typeof globalThis !== "undefined") ? globalThis : global;
  var savedFormat = G.Format;
  G.Format = { formatAmount: function (raw, prec) { return "A(" + raw + ":" + prec + ")"; } };
  try {
    var swaps = [{
      time: "2026-10-05T02:00:00", price: "2.0", account: "1.2.77", block: 101,
      paid: { amount: "20", asset: "1.3.1" }, received: { amount: "40", asset: "1.3.2" }
    }];
    var pts = PoolHistory.swapsToPoints(swaps, "1.3.2", 5, 10);
    eq(pts.length, 1, "enriched swap maps");
    eq(pts[0].accountId, "1.2.77", "swapper passes through");
    eq(pts[0].blockNum, 101, "block passes through");
  } finally {
    if (savedFormat === undefined) delete G.Format; else G.Format = savedFormat;
  }
})();

/* Tick math vectors (pure scale helpers — pixels only, never money). */
(function () {
  var DC = require("../vanilla/js/api/discrete-charts.js");
  var T = DC._ticksForTest;
  eq(!!(T && typeof T.linear === "function"), true, "_ticksForTest seam exported");
  if (!T) return;
  var lt = T.linear(0.0151, 0.0152, 5);
  eq(lt.length >= 2 && lt.length <= 6, true, "linear ticks bounded (" + lt.length + ")");
  eq(lt.every(function (t) { return t.y >= 0.0151 && t.y <= 0.0152; }), true, "linear ticks inside range");
  eq(T.linear(5, 5, 5).length, 0, "degenerate range is empty, never throws");
  eq(T.linear(NaN, 1, 5).length, 0, "NaN range is empty");
  var gt = T.log(0.009, 2.5);
  eq(gt.length >= 2 && gt[0].label === "1e-2", true, "log decades labeled (" + gt.map(function (t) { return t.label; }).join(",") + ")");
  eq(T.log(-1, 5).length, 0, "non-positive log range empty");
  var day = Date.UTC(2026, 9, 5), tt = T.time(day, day + 6 * 3600000, 6);
  eq(tt.length >= 2 && tt.length <= 8, true, "intraday ticks bounded");
  eq(/^\d\d:\d\d$/.test(tt[0].label), true, "intraday label is HH:MM (" + tt[0].label + ")");
  var wk = T.time(day, day + 3 * 86400000, 5);
  eq(wk.some(function (t) { return t.label.indexOf("-") !== -1; }), true, "multi-day labels carry dates");
  eq(T.time(day, day, 5).length, 0, "zero span empty");
  var yr2 = T.time(day, day + 400 * 86400000, 6);
  eq(yr2.length >= 2 && yr2.length <= 8, true, "multi-month span thins without capped clusters");
  eq(yr2.every(function (t) { return /^\d{4}-\d\d-\d\d$/.test(t.label); }), true, "year spans carry years (" + yr2[0].label + ")");
  var yr = T.time(day, day + 400 * 86400000, 6);
  eq(yr.length >= 2 && yr.length <= 8, true, "multi-month span thins to months, never a capped cluster (" + yr.length + ")");
})();

/* Axes emission vectors (stub ctx records text): price paints y tick + time
 * labels, volume paints max + zero labels. Catches silent axes failure. */
(function () {
  var DC = require("../vanilla/js/api/discrete-charts.js");
  function recCtx() {
    var texts = [];
    return { texts: texts,
      setTransform: function () {}, clearRect: function () {},
      save: function () {}, restore: function () {},
      beginPath: function () {}, arc: function () {}, fill: function () {},
      moveTo: function () {}, lineTo: function () {}, stroke: function () {},
      fillText: function (s) { texts.push(String(s)); } };
  }
  function recDoc(ctx) {
    return { createElement: function () { return { className: "", style: {}, clientWidth: 300, width: 0, height: 0, getContext: function () { return ctx; }, setAttribute: function () {}, appendChild: function () {} }; } };
  }
  function recHost() {
    var kids = [];
    return { clientWidth: 300, appendChild: function (k) { kids.push(k); }, removeChild: function () {}, get children() { return kids; } };
  }
  var pts = [
    { timeMs: 1000, price: "1.0", volume: "10", volumeBaseRaw: "10", volumeQuoteRaw: "5" },
    { timeMs: 2000, price: "2.0", volume: "40", volumeBaseRaw: "40", volumeQuoteRaw: "20" }
  ];
  var c1 = recCtx();
  DC.drawDiscretePrice(recDoc(c1), recHost(), pts, { log: false, colors: {} });
  eq(c1.texts.some(function (s) { return s.indexOf(":") !== -1; }), true, "price pane emits a time label");
  eq(c1.texts.length >= 3, true, "price pane emits y + x labels (" + c1.texts.length + ")");
  var c2 = recCtx();
  DC.drawDiscreteVolume(recDoc(c2), recHost(), pts, { colors: {} });
  eq(c2.texts.indexOf("40") !== -1, true, "volume pane emits exact max label");
  eq(c2.texts.indexOf("0") !== -1, true, "volume pane emits zero label");
})();

/* Hover + zoom math vectors (pure helpers behind the tooltip/gestures). */
(function () {
  var DC = require("../vanilla/js/api/discrete-charts.js");
  var T = DC._ticksForTest;
  eq(!!(T && typeof T.tip === "function"), true, "tip seam exported");
  if (!T || typeof T.tip !== "function") return;
  var lines = T.tip({ timeMs: Date.UTC(2026, 9, 5, 12, 0, 0), price: "0.0152",
    volume: "100.5", volumeQuote: "2.5", accountId: "1.2.33", orderId: "1.7.44", blockNum: 101 });
  eq(lines.length, 7, "full card has 7 rows");
  eq(lines[0].indexOf("2026-10-05 12:00:00Z") !== -1, true, "UTC clock row (" + lines[0] + ")");
  eq(T.tip({ timeMs: 0, price: "1.0" }).length, 2, "missing fields omitted, never guessed");
  eq(T.tip(null).length, 0, "null point is empty card");
  var hits = [{ x: 10, y: 10 }, { x: 100, y: 50 }];
  eq(T.nearest(hits, 12, 11, 14), 0, "nearest hit within tol");
  eq(T.nearest(hits, 500, 500, 14), -1, "far query misses");
  eq(T.nearest([], 0, 0, 14), -1, "empty hits miss");
  var zw = T.zoom({ t0: null, t1: null }, 500, 2, { lo: 0, hi: 1000 });
  eq(zw.t0 === 250 && zw.t1 === 750, true, "zoom halves around cursor (" + zw.t0 + "," + zw.t1 + ")");
  var zw2 = T.zoom({ t0: 250, t1: 750 }, 0, 0.1, { lo: 0, hi: 1000 });
  eq(zw2.t0 === 0 && zw2.t1 === 1000, true, "zoom out past full restores bounds");
  var pw = T.pan({ t0: 200, t1: 400 }, 100, { lo: 0, hi: 1000 });
  eq(pw.t0 === 300 && pw.t1 === 500, true, "pan shifts window");
  var pw2 = T.pan({ t0: 800, t1: 1000 }, 500, { lo: 0, hi: 1000 });
  eq(pw2.t1 === 1000, true, "pan clamps at bounds");
})();

console.log("discrete-timescale vectors: " + passed + " passed");
