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

/* savedRange — captures {from,to,len} or null, never throws.
 * `len` is the bar count the range was captured AGAINST (2026-10-08: a
 * range is only meaningful for the dataset it was zoomed on — see
 * restoreRange below). Handles without a recorded bar count (canvas
 * fallback / hand-made fixtures) report len undefined. */
var T = ChartsLwc._test;
assert.ok(T && typeof T.savedRange === "function", "savedRange exported");
assert.ok(typeof T.restoreRange === "function", "restoreRange exported");
eqDeep(T.savedRange({ chart: { timeScale: function () {
  return { getVisibleLogicalRange: function () { return { from: 10, to: 50 }; } };
} } }), { from: 10, to: 50, len: undefined }, "captures zoomed range");
eq(T.savedRange({ chart: null }), null, "null chart -> null");
eq(T.savedRange(null), null, "null handle -> null");
eq(T.savedRange({ chart: { timeScale: function () {
  return { getVisibleLogicalRange: function () { return null; } };
} } }), null, "null range -> null");
eq(T.savedRange({ chart: { timeScale: function () {
  return { getVisibleLogicalRange: function () { return { from: 5, to: 5 }; } };
} } }), null, "degenerate range -> null");
eq(T.savedRange({ chart: { timeScale: function () { throw new Error("x"); } } }), null, "throwing chart -> null");
eqDeep(T.savedRange({ key: { n: 1930 }, chart: { timeScale: function () {
  return { getVisibleLogicalRange: function () { return { from: 10, to: 50 }; } };
} } }), { from: 10, to: 50, len: 1930 }, "captures the bar count the zoom belongs to");

/* restoreRange — replays onto fresh chart, silent otherwise. */
var seen = null;
T.restoreRange({ timeScale: function () {
  return { setVisibleLogicalRange: function (r) { seen = r; } };
} }, { from: 10, to: 50 }, 1930);
eqDeep(seen, { from: 10, to: 50 }, "restores captured range");
seen = "untouched";
T.restoreRange({ timeScale: function () { return {}; } }, { from: 1, to: 2 }, 10);
eq(seen, "untouched", "missing setter is silent");
T.restoreRange(null, { from: 1, to: 2 }, 10);
T.restoreRange({ chart: 1 }, null);
passed += 2; // no-throw paths

/* Dataset-change guard (2026-10-08 — "the deep candles are off-screen"):
 * a captured range is replayed ONLY against the same-size dataset. When the
 * bars changed (the ES deepen landed, a timeframe/count switch, a wider
 * window) the old range would pin the view to a slice of the NEW data —
 * 1930 freshly loaded daily candles rendered behind a 150-bar window, i.e.
 * invisible history. On a size change the restore is skipped and the
 * chart's own fit-content stands. */
var seen2 = "untouched";
var fakeChart = { timeScale: function () { return { setVisibleLogicalRange: function (r) { seen2 = r; } }; } };
T.restoreRange(fakeChart, { from: 0, to: 150, len: 150 }, 1930);
eq(seen2, "untouched", "range is NOT replayed onto a different-size dataset (deepen landed)");
T.restoreRange(fakeChart, { from: 0, to: 150, len: 150 }, 149);
eqDeep(seen2, { from: 0, to: 150 }, "a one-bar difference (live tip rollover) still restores");
T.restoreRange(fakeChart, { from: 0, to: 150, len: 150 }, 150);
eqDeep(seen2, { from: 0, to: 150 }, "same size restores (theme toggle / resize keep the zoom)");
T.restoreRange(fakeChart, { from: 0, to: 150 }, 1930);
eqDeep(seen2, { from: 0, to: 150 }, "unknown previous size (no handle.key) keeps the legacy restore");
T.restoreRange(fakeChart, { from: 0, to: 150, len: 150 }, null);
eqDeep(seen2, { from: 0, to: 150 }, "unknown new size (canvas fallback pane) keeps the legacy restore");

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

/* reconcileBuckets — preferred shortlist first, live extras appended (A3:
 * sweep proved nodes differ: 60s + weekly 604800 must survive, never drop). */
eqDeep(MarketInd.reconcileBuckets([60, 300, 900, 1800, 3600, 14400, 86400, 604800]),
  [300, 900, 1800, 3600, 14400, 86400, 60, 604800], "full weekly list: PREF order, extras appended");
eqDeep(MarketInd.reconcileBuckets([60, 300, 900, 1800, 3600, 14400, 86400]),
  [300, 900, 1800, 3600, 14400, 86400, 60], "testnet-shaped list keeps 60s");
eqDeep(MarketInd.reconcileBuckets([900, 3600]), [900, 3600], "sparse subset passes through");
eqDeep(MarketInd.reconcileBuckets([]), [], "empty stays empty (caller falls back to raw live)");
eqDeep(MarketInd.reconcileBuckets(null), [], "null never throws");
eqDeep(MarketInd.reconcileBuckets(["x", -5, 300]), [300], "garbage entries ignored");

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
  /* Deterministic epoch (R-B-H2): freeze Date.now to a fixed epoch so the
   * candles() window and the freshness assertion share one clock — no
   * wall-clock flake. Restored in finally. No sleeps: stub Chain drives. */
  var FIXED_EPOCH_MS = Date.parse("2026-09-01T12:00:00Z");
  var _realDateNow = Date.now;
  Date.now = function () { return FIXED_EPOCH_MS; };
  try {
  var r = await MC.candles("1.3.0", "1.3.113", 3600, 500);
  eq(r.buckets.length, 500, "500-slot window fully covered despite 200 cap");
  var t0 = r.buckets[0].timeMs, t1 = r.buckets[r.buckets.length - 1].timeMs;
  eq(t0 < t1, true, "ascending");
  eq(Date.now() - t1 < 2 * 3600 * 1000, true, "newest slot is fresh (was 2022 before the fix)");
  eq(__calls <= 4, true, "bounded chunk fetches (got " + __calls + ")");
  eq(r.deep, false, "no ES in stub (chain-only flag honest)");
  } finally { Date.now = _realDateNow; }
})().catch(function (e) {
  console.error("chart-zoom-test FAILED: " + (e && e.message));
  process.exit(1);
});

/* tryPriceUpdate — the in-place fast path must ONLY handle same-size repaints
 * and the live tip rolling over by one bar. A materially different dataset
 * (the ES deepen landing: 150 daily candles -> 1930) must return FALSE so the
 * caller rebuilds: an in-place setData keeps the OLD visible range, which is
 * exactly how years of freshly-loaded history stayed hidden off-screen
 * (2026-10-08). Rebuilt charts then hit restoreRange's size guard and fit the
 * new window. */
var TT = ChartsLwc._test;
assert.ok(typeof TT.tryPriceUpdate === "function", "tryPriceUpdate exported");
var frame = "pb|gr|txt|lin|custom";
function bar(t) { return { time: t, open: "1", high: "2", low: "0.5", close: "1.5" }; }
function fakePrev(n, first, last) {
  var calls = { update: 0, setData: 0 };
  return {
    calls: calls,
    handle: {
      kind: "lwc", host: "H",
      chart: { timeScale: function () { return {}; } },
      candle: { update: function () { calls.update++; }, setData: function () { calls.setData++; } },
      lines: [],
      key: { n: n, first: first, last: last, lastOhlc: "x", frame: frame, ovShape: "0" }
    }
  };
}
var hostEl = "H", colors = { paneBg: "pb", grid: "gr", text: "txt" };
var optsOv = { overlays: [], logScale: false };
var timesOv = { times: [1, 2, 3] };

/* same size, last bar moved: in-place update (no rebuild, zoom preserved) */
var a = fakePrev(3, 100, 300);
var barsA = [bar(100), bar(200), bar(300)];
eq(TT.tryPriceUpdate(hostEl, a.handle, barsA, optsOv, colors, timesOv), true, "same-size repaint stays on the fast path");
eq(a.calls.setData, 0, "same-size repaint does not setData");

/* +1 rollover (a new candle appeared): still the fast path */
var b = fakePrev(3, 100, 300);
var barsB = [bar(100), bar(200), bar(300), bar(400)];
eq(TT.tryPriceUpdate(hostEl, b.handle, barsB, optsOv, colors, timesOv), true, "tip rollover (+1) stays on the fast path");
eq(b.calls.update, 1, "tip rollover updates the live bar only");

/* materially wider dataset (the deep walk landing): MUST rebuild */
var c = fakePrev(3, 100, 300);
var barsC = []; for (var ci = 0; ci < 1930; ci++) barsC.push(bar(100 + ci));
eq(TT.tryPriceUpdate(hostEl, c.handle, barsC, optsOv, colors, timesOv), false, "a materially wider dataset rebuilds (deepen landing)");
eq(c.calls.setData, 0, "the rebuild path owns the data swap, not the fast path");

/* narrower dataset (window shrink / shorter range): also rebuilds */
var d = fakePrev(1930, 100, 300);
eq(TT.tryPriceUpdate(hostEl, d.handle, [bar(100), bar(200), bar(300)], optsOv, colors, timesOv), false, "a narrower dataset rebuilds");

/* the guard is about size, not direction: -1 bar is still a rebuild */
var e2 = fakePrev(4, 100, 400);
eq(TT.tryPriceUpdate(hostEl, e2.handle, [bar(100), bar(200), bar(300)], optsOv, colors, timesOv), false, "shrinking by one bar still rebuilds");

/* unrelated guards still hold: wrong frame / no previous / wrong host */
var f2 = fakePrev(3, 100, 300);
eq(TT.tryPriceUpdate(hostEl, f2.handle, barsA, { overlays: [], logScale: true }, colors, timesOv), false, "a log/linear switch rebuilds");
eq(TT.tryPriceUpdate(hostEl, null, barsA, optsOv, colors, timesOv), false, "no previous handle rebuilds");
eq(TT.tryPriceUpdate("OTHER", f2.handle, barsA, optsOv, colors, timesOv), false, "a different host rebuilds");

console.log("chart-zoom-test: " + passed + " passed, 0 failed");
