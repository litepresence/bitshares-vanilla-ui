/* explorer-blocks-ago-test.js — offline vectors for the decimal block-age
 * label (slice-09 delta, 2026-10-01). Stdlib only:
 * `node tooling/explorer-blocks-ago-test.js` (exit 0 = green).
 * Covers ExplorerBlocks._test.agoTextAt (pure shaping, no DOM, no network):
 * durations, not money — toFixed(1) display rounding is fine. Also guards
 * the no-new-polling rule: exactly one setInterval (the ~150ms cLast label
 * repaint), stall branch intact, teardown intact.
 */
"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var ExplorerBlocks = require("../vanilla/js/views/explorer-blocks.js");

var T = ExplorerBlocks._test;
assert.ok(T && typeof T.agoTextAt === "function", "_test.agoTextAt exported");
assert.ok(T && typeof T.parseChainTime === "function", "_test.parseChainTime exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var NOW = 1000000000000;
eq(T.agoTextAt(NOW, NOW), "0.0 seconds ago", "fresh head 0ms");
eq(T.agoTextAt(NOW, NOW - 400), "0.4 seconds ago", "400ms tenths");
eq(T.agoTextAt(NOW, NOW - 1000), "1.0 seconds ago", "1s decimal (old UI said '1 second ago')");
eq(T.agoTextAt(NOW, NOW - 1500), "1.5 seconds ago", "1.5s");
eq(T.agoTextAt(NOW, NOW - 1234), "1.2 seconds ago", "1234ms truncates/rounds to 1.2");
eq(T.agoTextAt(NOW, NOW - 3200), "3.2 seconds ago", "3.2s");
eq(T.agoTextAt(NOW, NOW - 16000), "16.0 seconds ago", "stall-region 16s (branch trips >15s)");
eq(T.agoTextAt(NOW, NOW + 500), "0.0 seconds ago", "future ts clamps to 0.0");
eq(T.agoTextAt(NOW, NaN), "0.0 seconds ago", "NaN ts clamps to 0.0");
eq(T.agoTextAt(NaN, NOW - 1000), "0.0 seconds ago", "NaN now clamps to 0.0");

/* parseChainTime — naive chain stamps parse as UTC (the stuck-stopwatch fix). */
eq(T.parseChainTime("2026-10-01T21:30:00"), Date.UTC(2026, 9, 1, 21, 30, 0), "naive stamp reads as UTC");
eq(T.parseChainTime("2026-10-01T21:30:00Z"), Date.UTC(2026, 9, 1, 21, 30, 0), "Z stamp unchanged");
eq(T.parseChainTime("2026-10-01T21:30:00+00:00"), Date.UTC(2026, 9, 1, 21, 30, 0), "offset stamp unchanged");
eq(T.parseChainTime("2026-10-01 21:30:00"), null, "space format unparseable -> null (never guessed)");
eq(T.parseChainTime(""), null, "empty -> null");
eq(T.parseChainTime(null), null, "null -> null");
eq(T.parseChainTime("not-a-time"), null, "garbage -> null");

/* freshState — 4-state live line (pure, no DOM). */
eq(T.freshState(0, true), "live", "fresh head");
eq(T.freshState(2999, true), "live", "normal gap");
eq(T.freshState(6000, true), "live", "boundary 6.0s stays live");
eq(T.freshState(6001, true), "stale", "past one missed slot -> stale amber");
eq(T.freshState(12000, true), "stale", "12s stale");
eq(T.freshState(15000, true), "stale", "boundary 15s stays stale");
eq(T.freshState(15001, true), "stalled", "past stall line -> stalled red");
eq(T.freshState(60000, true), "stalled", "60s stalled");
eq(T.freshState(0, false), "paused", "closed socket pauses even when fresh");
eq(T.freshState(99999, false), "paused", "closed socket pauses even when old");
eq(T.freshState(NaN, true), "live", "NaN age fails open to live");
eq(T.freshState(-5, true), "live", "negative age fails open to live");

/* No-new-polling guard: one setInterval at ~150ms, stall + teardown intact. */
var src = fs.readFileSync(path.join(__dirname, "..", "vanilla", "js", "views/explorer-blocks.js"), "utf8");
var intervals = src.match(/setInterval\s*\(/g) || [];
assert.strictEqual(intervals.length, 1, "exactly one setInterval (got " + intervals.length + ")");
passed++;
assert.ok(/},\s*150\s*\)/.test(src), "ticker interval is ~150ms");
passed++;
assert.ok(src.indexOf("STALL_MS = 15000") !== -1, "stall line 15s intact (STALL_MS)");
passed++;
assert.ok(src.indexOf("STALE_MS = 6000") !== -1, "stale line 6s intact (STALE_MS)");
passed++;
assert.ok(src.indexOf("stopLive") !== -1 && src.indexOf("clearStatTick") !== -1, "gen guards + teardown intact");
passed++;
assert.ok(src.indexOf("set_block_applied_callback") !== -1 || src.indexOf("connection") !== -1, "push-feed comment present");
passed++;

console.log("explorer-blocks-ago: " + passed + "/" + passed + " green");
