/* gov-analytics-test.js — unit vectors for GovAnalytics pure helpers + bounded
 * caps. Stdlib only: `node tooling/gov-analytics-test.js` (exit 0 = green).
 * Covers fundingShare (exact BigInt %, "—" on missing denominator), fundingRows
 * sort, fundingTotal sum, splitCounts, sampleLabel honesty (always "sample,
 * not all-time"), biggestBlocks/biggestTxs ranking, buildMatrix cells. No
 * network, no DOM, no deps. Format + GovAnalytics load as globals (same seam
 * as top-ops-test.js).
 */
"use strict";
var assert = require("assert");
var Format = require("../vanilla/js/api/format.js");
var Gov = require("../vanilla/js/api/gov-analytics.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
}

/* fundingShare — pay/budget -> "X.XX%" exact, missing denominator dashes. */
eq(Gov.fundingShare("5000", "100000"), "5.00%", "share 5%");
eq(Gov.fundingShare("1", "3"), "33.33%", "share 1/3 half-up");
eq(Gov.fundingShare("2", "3"), "66.67%", "share 2/3 half-up");
eq(Gov.fundingShare("0", "100000"), "0.00%", "share zero pay");
eq(Gov.fundingShare("5000", null), "—", "share missing budget dashes");
eq(Gov.fundingShare("5000", "0"), "—", "share zero budget dashes");
eq(Gov.fundingShare("5000", ""), "—", "share empty budget dashes");
eq(Gov.fundingShare("abc", "100000"), "—", "share bad pay dashes");
eq(typeof Format.formatRatioPct2dp, "function", "ratio helper is Format-owned");

/* fundingRows — desc by daily pay, input untouched; fundingTotal exact sum. */
function w(id, pay) {
  return { id: id, name: id, extra: { daily_pay_raw: String(pay) } };
}
var rows = Gov.fundingRows([w("1.14.1", "100"), w("1.14.2", "900"), w("1.14.3", "500")]);
eq(rows.map(function (r) { return r.id; }).join(","), "1.14.2,1.14.3,1.14.1", "rows sort desc");
eq(Gov.fundingTotal([w("a", "100"), w("b", "900")]), "1000", "total sums");
eq(Gov.fundingTotal([]), "0", "total empty zero");
eq(Gov.fundingTotal([{ id: "x", extra: { daily_pay_raw: "junk" } }]), "0", "total junk zero");

/* splitCounts — active/standby/total plain ints. */
var sp = Gov.splitCounts([{ active: true }, { active: false }, { active: true }, {}]);
eq(sp.active, 2, "splits active");
eq(sp.standby, 2, "splits standby");
eq(sp.total, 4, "splits total");
var spEmpty = Gov.splitCounts([]);
eq(spEmpty.total, 0, "splits empty total");

/* sampleLabel — ALWAYS sample, never all-time. */
var lab = Gov.sampleLabel(30, 128);
ok(lab.indexOf("30") !== -1, "label carries N");
ok(lab.indexOf("sample, not all-time") !== -1, "label honest sample");
ok(lab.toLowerCase().indexOf("all-time biggest") === -1, "label never claims all-time");
ok(Gov.sampleLabel(0, null).indexOf("sample, not all-time") !== -1, "label fallback honest");

/* biggestBlocks — tx_count desc, null counts last, capped. */
var bb = Gov.biggestBlocks([
  { height: 1, tx_count: 0 },
  { height: 2, tx_count: null },
  { height: 3, tx_count: 7 },
  { height: 4, tx_count: 3 }
], 2);
eq(bb.length, 2, "biggest blocks capped");
eq(bb[0].height, 3, "biggest block first");
eq(bb[1].height, 4, "biggest block second");

/* biggestTxs — op-count desc from bodies, malformed txs count 0. */
var bt = Gov.biggestTxs([
  { height: 10, body: { transactions: [{ operations: [[0, {}]] }, { operations: [[0, {}], [0, {}], [0, {}]] }] } },
  { height: 11, body: null },
  { height: 12, body: { transactions: "junk" } }
], 5);
eq(bt[0].height, 10, "biggest tx height");
eq(bt[0].txIndex, 1, "biggest tx index");
eq(bt[0].opCount, 3, "biggest tx op count");

/* buildMatrix — voter x candidate booleans, order stable. */
var mx = Gov.buildMatrix({ "1.2.1": ["1:0", "0:5"], "1.2.2": [] }, ["1:0", "0:5", "2:3"]);
eq(mx.length, 2, "matrix rows");
eq(mx[0].cells["1:0"], true, "matrix hit");
eq(mx[0].cells["2:3"], false, "matrix miss");
eq(mx[1].cells["1:0"], false, "matrix empty voter false");

/* Caps — bounded by construction. */
eq(Gov.TOP_VOTERS_MAX, 20, "top voters cap 20");
eq(Gov.SAMPLE_MAX, 50, "sample cap 50");

console.log("gov-analytics-test: " + passed + "/" + passed + " green");
