/* chart-zoom-test.js — unit vectors for zoom preservation + candle window
 * (charts-lwc.js range memory, market-ind.js count validation). Stdlib only:
 * `node tooling/chart-zoom-test.js` (exit 0 = green). Covers pure helpers
 * with stub chart objects — no DOM, no network, no LWC build, no deps.
 */
"use strict";
var assert = require("assert");
var ChartsLwc = require("../vanilla/js/api/charts-lwc.js");
var MarketInd = require("../vanilla/js/views/market-ind.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function eqDeep(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* savedRange — captures {from,to} or null, never throws. */
var T = ChartsLwc._test;
assert.ok(T && typeof T.savedRange === "function", "savedRange exported");
assert.ok(typeof T.restoreRange === "function", "restoreRange exported");
eqDeep(T.savedRange({ chart: { timeScale: function () {
  return { getVisibleLogicalRange: function () { return { from: 10, to: 50 }; } };
} } }), { from: 10, to: 50 }, "captures zoomed range");
eq(T.savedRange({ chart: null }), null, "null chart -> null");
eq(T.savedRange(null), null, "null handle -> null");
eq(T.savedRange({ chart: { timeScale: function () {
  return { getVisibleLogicalRange: function () { return null; } };
} } }), null, "null range -> null");
eq(T.savedRange({ chart: { timeScale: function () {
  return { getVisibleLogicalRange: function () { return { from: 5, to: 5 }; } };
} } }), null, "degenerate range -> null");
eq(T.savedRange({ chart: { timeScale: function () { throw new Error("x"); } } }), null, "throwing chart -> null");

/* restoreRange — replays onto fresh chart, silent otherwise. */
var seen = null;
T.restoreRange({ timeScale: function () {
  return { setVisibleLogicalRange: function (r) { seen = r; } };
} }, { from: 10, to: 50 });
eqDeep(seen, { from: 10, to: 50 }, "restores captured range");
seen = "untouched";
T.restoreRange({ timeScale: function () { return {}; } }, { from: 1, to: 2 });
eq(seen, "untouched", "missing setter is silent");
T.restoreRange(null, { from: 1, to: 2 });
T.restoreRange({ chart: 1 }, null);
passed += 2; // no-throw paths

/* validCount — 1..5000 ints, default boundary behavior. */
var M = MarketInd._test;
assert.ok(M && typeof M.validCount === "function", "validCount exported");
eq(M.validCount(2000), 2000, "default passes");
eq(M.validCount("500"), 500, "string int passes");
eq(M.validCount(1), 1, "floor passes");
eq(M.validCount(5000), 5000, "ceiling passes");
eq(M.validCount(0), null, "zero rejected");
eq(M.validCount(5001), null, "ceiling+1 rejected");
eq(M.validCount(-3), null, "negative rejected");
eq(M.validCount("abc"), null, "text rejected");
eq(M.validCount(""), null, "empty rejected");
eq(M.validCount(null), null, "null rejected");
eq(M.validCount(2.5), 2, "parseInt truncation (matches input behavior)");

console.log("chart-zoom-test: " + passed + " passed, 0 failed");
