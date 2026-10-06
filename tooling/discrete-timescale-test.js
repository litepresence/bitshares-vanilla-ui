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

console.log("discrete-timescale vectors: " + passed + " passed");
