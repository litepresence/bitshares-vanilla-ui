/* tour-scroll-test.js — unit vectors for the jerky-scroll fix (tour-ui.js)
 * plus issue #1 (welcome Next/dots must never skip to the finale).
 * Stdlib only: `node tooling/tour-scroll-test.js` (exit 0 = green). Covers
 * TourUI._test pure gates (scrollChanged, needsRerender, resolveIndex)
 * with sentinel objects — no DOM, no network, no deps.
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
eq(T.needsRerender({ centerOk: true }, null, A, true), true, "vanished target on centerOk drops to centered (issue #1)");

/* resolveIndex — issue #1: dots/Next/Back land exactly, never skip. */
eq(T.resolveIndex(0, 5), 0, "dot 1 stays on step 1");
eq(T.resolveIndex(1, 5), 1, "next to step 2 stays (issue #1)");
eq(T.resolveIndex(2, 5), 2, "dot 3 stays on step 3 (issue #1)");
eq(T.resolveIndex(3, 5), 3, "dot 4 stays on step 4 (issue #1)");
eq(T.resolveIndex(4, 5), 4, "dot 5 stays on finale");
eq(T.resolveIndex(5, 5), 5, "past-the-end finishes");
eq(T.resolveIndex(-1, 5), 0, "negative clamps to first");

console.log("tour-scroll-test: " + passed + " passed, 0 failed");
