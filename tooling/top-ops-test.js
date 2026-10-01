/* top-ops-test.js — unit vectors for the R1c ranked-ops math (donut arcs +
 * 1-decimal percents). Stdlib only: `node tooling/top-ops-test.js` (exit 0 =
 * green). Covers Format.pct1 (the single percent formatter #/top-ops uses)
 * plus TopOpsUI._test pure helpers (polar/ringWedge/sliceSpans/opLabel/
 * shortHost). No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var Format = require("../vanilla/js/format.js");
var TopOpsUI = require("../vanilla/js/top-ops-ui.js");
var T = TopOpsUI._test;

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
}

/* Format.pct1 — 1-decimal integer-math shares (truncation, never float). */
eq(Format.pct1(1, 5), "20.0%", "pct1 1/5");
eq(Format.pct1(1, 2), "50.0%", "pct1 1/2");
eq(Format.pct1(1, 3), "33.3%", "pct1 1/3 truncates");
eq(Format.pct1(2, 3), "66.6%", "pct1 2/3 truncates");
eq(Format.pct1(0, 5), "0.0%", "pct1 zero count");
eq(Format.pct1(5, 0), "0.0%", "pct1 zero total never divides");
eq(Format.pct1(1, 200), "0.5%", "pct1 1/200 sample floor");
eq(Format.pct1(1, 1000), "0.1%", "pct1 1/1000 tenth");
eq(Format.pct1(200, 200), "100.0%", "pct1 full");
eq(Format.pct1(199, 200), "99.5%", "pct1 199/200");
assert.throws(function () { Format.pct1(-1, 5); }, /bad amount/, "pct1 negative throws");
passed++;
assert.throws(function () { Format.pct1(1.5, 5); }, /bad amount/, "pct1 float throws");
passed++;

/* polar — 0° is top, clockwise. */
eq(T.polar(100, 100, 90, 0).x, 100, "polar top x");
eq(T.polar(100, 100, 90, 0).y, 10, "polar top y");
eq(T.polar(100, 100, 90, 90).x, 190, "polar right x");
eq(T.polar(100, 100, 90, 90).y, 100, "polar right y");
eq(T.polar(100, 100, 90, 180).y, 190, "polar bottom y");

/* ringWedge — shape flags. */
eq(T.ringWedge(100, 100, 90, 55, 10, 10), "", "wedge zero span empty");
eq(T.ringWedge(100, 100, 90, 55, 20, 10), "", "wedge negative span empty");
var quarter = T.ringWedge(100, 100, 90, 55, 0, 90);
ok(quarter.indexOf("M100 10") === 0, "wedge quarter starts at top");
ok(quarter.indexOf(" 0 0 1 ") !== -1, "wedge quarter small-arc flag");
ok(quarter.charAt(quarter.length - 1) === "Z", "wedge quarter closes");
var big = T.ringWedge(100, 100, 90, 55, 0, 270);
ok(big.indexOf(" 0 1 1 ") !== -1, "wedge 270deg large-arc flag");
var ring = T.ringWedge(100, 100, 90, 55, 0, 360);
ok((ring.match(/A/g) || []).length === 4, "wedge full ring four arcs");
ok(ring.charAt(ring.length - 1) === "Z", "wedge full ring closes");

/* sliceSpans — angular coverage + Other folding. */
eq(JSON.stringify(T.sliceSpans([], 0)), "[]", "spans empty on zero total");
var spans = T.sliceSpans([{ idx: 0, count: 150 }, { idx: 1, count: 50 }], 200);
eq(spans.length, 2, "spans two rows");
eq(spans[0].startDeg, 0, "spans start at 0");
eq(spans[1].endDeg, 360, "spans cover full circle");
var many = [];
for (var i = 0; i < 12; i++) many.push({ idx: i, count: 10 });
var folded = T.sliceSpans(many, 120);
eq(folded.length, T.MAX_SLICES + 1, "spans fold tail into Other");
eq(folded[folded.length - 1].idx, -1, "spans Other marker");
eq(folded[folded.length - 1].count, 40, "spans Other count (12-8 rows x10)");
eq(folded[folded.length - 1].endDeg, 360, "spans folded cover full circle");

/* opLabel — names + virtual flags + unknown honesty. */
eq(T.opLabel(0).name, "transfer", "op 0 transfer");
eq(T.opLabel(4).name, "fill_order", "op 4 fill_order");
eq(T.opLabel(4).virtual, true, "op 4 virtual flagged");
eq(T.opLabel(1).virtual, false, "op 1 not virtual");
eq(T.opLabel(999).name, "unknown", "op 999 unknown never throws");

/* shortHost — footer-parity host label. */
eq(T.shortHost("wss://testnet.xbts.io/ws"), "testnet.xbts.io", "host testnet");
eq(T.shortHost("wss://api.bitshares.dev/ws"), "api.bitshares.dev", "host mainnet");
eq(T.shortHost(""), "", "host empty");

console.log("top-ops-test: " + passed + "/" + passed + " green");
