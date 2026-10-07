/* splash-test.js — unit vectors for the Option-B landing rule + pulse
 * shaping (dashboard-ui.js). Stdlib only: `node tooling/splash-test.js`
 * (exit 0 = green). Covers DashboardUI._test pure helpers (landingFor,
 * fmtCount, asCount, topVolText, shapePulse) plus the ticker-miss rule
 * (tickRow never caches null; clearTickMisses drops legacy nulls so a
 * reconnect refill refetches). No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var DashboardUI = require("../vanilla/js/views/dashboard-ui.js");
var T = DashboardUI._test;

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function deepEq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* landingFor — locked (anything falsy) sees the splash. */
eq(T.landingFor(false), true, "locked -> splash");
eq(T.landingFor(undefined), true, "undefined -> splash");
eq(T.landingFor(null), true, "null -> splash");
eq(T.landingFor(0), true, "0 -> splash");
eq(T.landingFor(true), false, "unlocked -> dashboard");
eq(T.landingFor(1), false, "truthy -> dashboard");

/* fmtCount — verbatim, null-safe (grouping stays deferred). */
eq(T.fmtCount(null), "—", "null -> dash");
eq(T.fmtCount(undefined), "—", "undefined -> dash");
eq(T.fmtCount(0), "0", "zero stays zero");
eq(T.fmtCount(26838), "26838", "registrar count verbatim");
eq(T.fmtCount(114787912), "114787912", "head block verbatim");

/* asCount — only safe non-negative ints pass. */
eq(T.asCount(5), 5, "small int passes");
eq(T.asCount(0), 0, "zero passes");
eq(T.asCount(-1), null, "negative -> null");
eq(T.asCount(1.5), null, "float -> null");
eq(T.asCount("5"), null, "string -> null");
eq(T.asCount(NaN), null, "NaN -> null");
eq(T.asCount(Number.MAX_SAFE_INTEGER + 1), null, "unsafe -> null");

/* topVolText — single-market row, verbatim volume, honest label. */
/* Unavailable copy is the honest one from 96c1ce3 (marketing audit): it
 * names the fix (Settings -> Nodes) instead of blaming the node. */
eq(T.topVolText(null), "Top-market volume is offline — check Settings → Nodes.", "null row");
eq(T.topVolText({}), "Top-market volume is offline — check Settings → Nodes.", "empty row");
eq(T.topVolText({ base: "BTS", quote: "CNY", quote_volume: "123.45" }),
  "Top market 24h vol (single market): BTS/CNY 123.45", "full row");
eq(T.topVolText({ base: "BTS", quote: "CNY" }),
  "Top market 24h vol (single market): BTS/CNY —", "missing volume -> dash");

/* shapePulse — pure refill shaping (fetchPulse wave -> display object). */
(function shapePulseVectors() {
  var full = T.shapePulse([
    { head_block_number: 114787912, time: "2026-10-01T00:00:00" },
    26838, 412, 21, 11,
    [{ base: "BTS", quote: "CNY", quote_volume: "123.45" }]
  ]);
  eq(full.head, 114787912, "shapePulse head passes");
  eq(full.time, "2026-10-01T00:00:00", "shapePulse time passes");
  eq(full.accounts, 26838, "shapePulse accounts passes");
  eq(full.assets, 412, "shapePulse assets passes");
  deepEq(full.topVol, { base: "BTS", quote: "CNY", quote_volume: "123.45" }, "shapePulse topVol passes");
  var badHead = T.shapePulse([{ head_block_number: 0, time: "2026-10-01T00:00:00" }, 1, 2, 3, 4, []]);
  eq(badHead.head, null, "shapePulse zero head -> null");
  eq(badHead.topVol, null, "shapePulse empty topMarkets -> null");
  var badTime = T.shapePulse([{ head_block_number: 5, time: "" }, 1, 2, 3, 4, null]);
  eq(badTime.time, null, "shapePulse empty time -> null");
  eq(badTime.head, 5, "shapePulse head still passes when time bad");
  var badCounts = T.shapePulse([{ head_block_number: 5, time: "t" }, "5", -1, 1.5, NaN, "x"]);
  eq(badCounts.accounts, null, "shapePulse string count -> null");
  eq(badCounts.witnesses, null, "shapePulse float count -> null");
  eq(badCounts.topVol, null, "shapePulse non-array topMarkets -> null");
  deepEq(T.shapePulse(null), { head: null, time: null, accounts: null, assets: null, witnesses: null, committee: null, topVol: null }, "shapePulse null input -> blank");
  deepEq(T.shapePulse("x"), { head: null, time: null, accounts: null, assets: null, witnesses: null, committee: null, topVol: null }, "shapePulse non-array -> blank");
})();

/* tickRow miss-not-cached + clearTickMisses (async: offline paint must not
 * poison the refill — a rejected fetch returns null WITHOUT caching, so the
 * next call refetches; legacy nulls drop via clearTickMisses). */
async function tickVectors() {
  function has(id) {
    return Object.prototype.hasOwnProperty.call(T._tickCache, id);
  }
  /* 1. Rejected fetch -> null, not cached, pending cleared (retry refetches). */
  var missCalls = 0;
  global.Market = {
    parseId: function (id) {
      var parts = String(id).toUpperCase().split("_");
      if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("bad-market");
      return { quote: parts[0], base: parts[1] };
    },
    assets: function () { missCalls++; return Promise.reject(new Error("not connected")); },
    stats: function () { return Promise.resolve({ latest: "x", raw: {} }); }
  };
  var missId = "TSTMSA_TSTMSB";
  delete T._tickCache[missId];
  var r1 = await T.tickRow(missId);
  eq(r1, null, "tickRow miss -> null");
  eq(has(missId), false, "tickRow miss not cached");
  var r2 = await T.tickRow(missId);
  eq(r2, null, "tickRow miss retry -> null");
  eq(missCalls, 2, "tickRow miss retry refetches (pending cleared)");
  eq(has(missId), false, "tickRow second miss still not cached");
  /* 2. Parse throw -> null, not cached. */
  global.Market.parseId = function () { throw new Error("bad-market"); };
  var badId = "TST_BAD_PARSE_XYZ";
  delete T._tickCache[badId];
  var rBad = await T.tickRow(badId);
  eq(rBad, null, "tickRow parse failure -> null");
  eq(has(badId), false, "tickRow parse failure not cached");
  /* 3. Success caches; second call serves cache without refetch. */
  var okCalls = 0;
  global.Market = {
    parseId: function (id) {
      var parts = String(id).toUpperCase().split("_");
      if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("bad-market");
      return { quote: parts[0], base: parts[1] };
    },
    assets: function () { okCalls++; return Promise.resolve({ base: { id: "1.3.0" }, quote: { id: "1.3.1" } }); },
    stats: function () { return Promise.resolve({ latest: "12.5", raw: { percent_change: "3.2" } }); }
  };
  var okId = "TSTOKA_TSTOKB";
  delete T._tickCache[okId];
  var ok1 = await T.tickRow(okId);
  deepEq(ok1, { latest: "12.5", chg: "3.2" }, "tickRow success shapes row");
  eq(has(okId), true, "tickRow success cached");
  var ok2 = await T.tickRow(okId);
  deepEq(ok2, { latest: "12.5", chg: "3.2" }, "tickRow cached row re-served");
  eq(okCalls, 1, "tickRow cached row skips refetch");
  delete T._tickCache[okId];
  /* 4. clearTickMisses drops legacy nulls, keeps rows. */
  T._tickCache.__legacy_null_probe__ = null;
  T._tickCache.__keep_probe__ = { latest: "1", chg: "2" };
  var dropped = T.clearTickMisses();
  eq(dropped >= 1, true, "clearTickMisses drops at least the legacy null");
  eq(has("__legacy_null_probe__"), false, "clearTickMisses removes null miss");
  eq(has("__keep_probe__"), true, "clearTickMisses keeps real rows");
  delete T._tickCache.__keep_probe__;
  delete global.Market;
}

tickVectors().then(function () {
  console.log("splash-test: " + passed + " passed, 0 failed");
}, function (e) {
  console.error("splash-test FAIL: " + (e && e.message ? e.message : e));
  process.exit(1);
});
