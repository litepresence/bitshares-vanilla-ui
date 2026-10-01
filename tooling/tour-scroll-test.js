/* tour-scroll-test.js — unit vectors for the jerky-scroll fix (tour-ui.js).
 * Stdlib only: `node tooling/tour-scroll-test.js` (exit 0 = green). Covers
 * TourUI._test pure gates (scrollChanged, needsRerender) with sentinel
 * objects — no DOM, no network, no deps.
 */
"use strict";
var assert = require("assert");
var TourUI = require("../vanilla/js/views/tour-ui.js");
var T = TourUI._test;

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var A = { node: "A" }, B = { node: "B" };

/* scrollChanged — smooth-scroll runs exactly once per step/target change. */
eq(T.scrollChanged(0, A, -1, null), true, "first paint scrolls");
eq(T.scrollChanged(0, A, 0, A), false, "same step+target never re-scrolls");
eq(T.scrollChanged(1, A, 0, A), true, "step change scrolls");
eq(T.scrollChanged(0, B, 0, A), true, "target change scrolls");
eq(T.scrollChanged(0, null, 0, null), false, "centered re-render never scrolls");
eq(T.scrollChanged(2, null, 1, B), true, "finale arrival scrolls");

/* needsRerender — observer refires rebuild only on real target change. */
eq(T.needsRerender({ centerOk: false }, A, null, false), true, "newly materialized target upgrades");
eq(T.needsRerender({ centerOk: false }, A, A, true), false, "routine fill with same target skips");
eq(T.needsRerender({ centerOk: false }, null, A, true), true, "vanished target on required step re-resolves");
eq(T.needsRerender({ centerOk: true }, null, null, true), false, "centered card on null target skips");
eq(T.needsRerender({ centerOk: true }, null, null, false), true, "missing centered card renders");
eq(T.needsRerender({ centerOk: true }, A, null, false), true, "target appearing on centerOk renders");
eq(T.needsRerender(null, A, null, false), true, "null step def renders safe");
eq(T.needsRerender(null, null, null, true), true, "null step without target re-resolves");

console.log("tour-scroll-test: " + passed + " passed, 0 failed");
