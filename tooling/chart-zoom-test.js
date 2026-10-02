/* chart-zoom-test.js — unit vectors for zoom preservation + candle window
 * (charts-lwc.js range memory, market-ind.js count validation). Stdlib only:
 * `node tooling/chart-zoom-test.js` (exit 0 = green). Covers pure helpers
 * with stub chart objects — no DOM, no network, no LWC build, no deps.
 */
"use strict";
var assert = require("assert");
var ChartsLwc = require("../vanilla/js/api/charts-lwc.js");
var MarketInd = require("../vanilla/js/views/market-ind.js");
var MarketCandles = require("../vanilla/js/api/market-candles.js");
assert.ok(MarketCandles && typeof MarketCandles.mergeWindows === "function", "mergeWindows exported");

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

/* mergeWindows — tip-sized fresh into painted window (fresh wins, cap kept). */
(function () {
  function bar(ms, close) { return { timeMs: ms, close: close }; }
  var MW = MarketCandles.mergeWindows;
  var m = MW([bar(1, "a"), bar(2, "b")], [bar(2, "B"), bar(3, "c")], 10);
  eq(m.length, 3, "union size");
  eq(m[1].close, "B", "fresh wins overlap");
  eq(m[0].timeMs, 1, "ascending");
  eq(m[2].timeMs, 3, "tip appended");
  eq(MW([bar(1, "a"), bar(2, "b"), bar(3, "c")], [], 2).length, 2, "cap slices tail");
  eq(MW([bar(1, "a")], [bar(2, "b")], 1)[0].timeMs, 2, "cap keeps newest");
  eq(MW(null, [bar(1, "a")], 10).length, 1, "null old tolerated");
  eq(MW([bar(1, "a")], null, 10).length, 1, "null fresh keeps old");
  eq(MW(null, null, 10).length, 0, "both null -> []");
  eq(MW([bar(1, "a")], [bar(2, "b")], 0).length, 0, "bad cap -> []");
})();

/* candles() pagination (node 200-bucket oldest-first cap): a 500-candle
 * window over a faithful capped node must come back newest-covered.
 * Async block runs last; stdlib only. */
globalThis.Format = require("../vanilla/js/api/format.js");
var MC = require("../vanilla/js/api/market-candles.js");
var __calls = 0;
globalThis.Chain = {
  history: async function () { return 7; },
  db: async function () { return 2; },
  call: async function (id, method, params) {
    if (method === "get_market_history_buckets") return [300, 3600];
    if (method === "get_assets") return [{ precision: 5 }, { precision: 2 }];
    if (method === "get_market_history") {
      __calls++;
      var start = Date.parse(params[3] + "Z") / 1000, end = Date.parse(params[4] + "Z") / 1000;
      var bucket = params[2], rows = [];
      for (var s = start; s < end && rows.length < 200; s += bucket) {
        rows.push({ key: { open: new Date(s * 1000).toISOString().slice(0, -5) },
          open_base: "1000", open_quote: "100", close_base: "1000", close_quote: "100",
          high_base: "1000", high_quote: "100", low_base: "1000", low_quote: "100",
          base_volume: "1000", quote_volume: "100" });
      }
      return rows;
    }
    throw new Error("unexpected " + method);
  }
};

(async function () {
  var r = await MC.candles("1.3.0", "1.3.113", 3600, 500);
  eq(r.buckets.length, 500, "500-slot window fully covered despite 200 cap");
  var t0 = r.buckets[0].timeMs, t1 = r.buckets[r.buckets.length - 1].timeMs;
  eq(t0 < t1, true, "ascending");
  eq(Date.now() - t1 < 2 * 3600 * 1000, true, "newest slot is fresh (was 2022 before the fix)");
  eq(__calls <= 4, true, "bounded chunk fetches (got " + __calls + ")");
  eq(r.deep, false, "no ES in stub (chain-only flag honest)");
  console.log("chart-zoom-test: " + passed + " passed, 0 failed");
})().catch(function (e) {
  console.error("chart-zoom-test FAILED: " + (e && e.message));
  process.exit(1);
});
