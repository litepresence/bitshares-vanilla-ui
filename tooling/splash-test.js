/* splash-test.js — unit vectors for the Option-B landing rule + pulse
 * shaping (dashboard-ui.js). Stdlib only: `node tooling/splash-test.js`
 * (exit 0 = green). Covers DashboardUI._test pure helpers (landingFor,
 * fmtCount, asCount, topVolText). No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var DashboardUI = require("../vanilla/js/dashboard-ui.js");
var T = DashboardUI._test;

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
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
eq(T.topVolText(null), "Top market 24h vol: unavailable on this node.", "null row");
eq(T.topVolText({}), "Top market 24h vol: unavailable on this node.", "empty row");
eq(T.topVolText({ base: "BTS", quote: "CNY", quote_volume: "123.45" }),
  "Top market 24h vol (single market): BTS/CNY 123.45", "full row");
eq(T.topVolText({ base: "BTS", quote: "CNY" }),
  "Top market 24h vol (single market): BTS/CNY —", "missing volume -> dash");

console.log("splash-test: " + passed + " passed, 0 failed");
