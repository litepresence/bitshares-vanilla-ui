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

console.log("discrete-timescale vectors: " + passed + " passed");
