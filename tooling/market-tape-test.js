#!/usr/bin/env node
/* market-tape-test.js — offline vectors for the backlog-B tape batch.
 * Covers pure helpers with no DOM, no network, no deps:
 *  (a) Market._fillRow displayPrice routes through Format.priceSig
 *      (4-sf display; dust reads "0"/sci, never "0.00000000") while
 *      priceExact/time/amounts/raw stay exact;
 *  (b) AccountUI._history._test.chainRow strips the derived _summary
 *      label so the raw-JSON fold shows chain truth only;
 *  (c) ChartsLwc._test.lineData plots numeric-string bars (all-string
 *      overlays yield points, never a blanked pane; junk stays gaps).
 * Stdlib only: `node tooling/market-tape-test.js` (exit 0 = green).
 */
"use strict";
var assert = require("assert");
globalThis.Format = require("../vanilla/js/api/format.js");
var Market = require("../vanilla/js/api/market.js");
var ChartsLwc = require("../vanilla/js/api/charts-lwc.js");
var AccountHistory = require("../vanilla/js/views/account-history.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function deq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* (a) Tape fill rows: base 1.3.0 (p5), quote 1.3.1 (p5). */
var PRECS = { "1.3.0": 5, "1.3.1": 5 };
function fillRow(baseAmt, baseId, quoteAmt, quoteId, time) {
  return Market._test.fillRow({
    time: time || "2026-01-01T00:00:00",
    op: { fill_price: { base: { amount: baseAmt, asset_id: baseId }, quote: { amount: quoteAmt, asset_id: quoteId } } }
  }, "1.3.0", "1.3.1", PRECS);
}

var normal = fillRow("123450000", "1.3.0", "100000", "1.3.1");
eq(normal.displayPrice, "1235", "normal price displays 4-sf (1234.5 -> 1235)");
eq(normal.priceExact, "1234.50000000", "normal priceExact keeps exact 8 places");
eq(normal.baseAmount, "1234.50000", "normal baseAmount exact (math key untouched)");
eq(normal.quoteAmount, "1.00000", "normal quoteAmount exact (math key untouched)");
eq(normal.time, "2026-01-01T00:00:00", "normal time passes through (sort key untouched)");

var tiny = fillRow("1234", "1.3.0", "10000000000", "1.3.1");
eq(tiny.priceExact, "0.00000012", "tiny priceExact keeps exact 8 places");
eq(tiny.displayPrice, "1.200e-7", "tiny price displays sci (never dust-zero)");

var dust = fillRow("1234", "1.3.0", "1000000000000", "1.3.1");
eq(dust.priceExact, "0.00000000", "dust priceExact keeps exact 8-place zero");
eq(dust.displayPrice, "0", "dust displays 0 (never 0.00000000)");

var swapped = fillRow("100000", "1.3.1", "123450000", "1.3.0");
eq(swapped.displayPrice, "1235", "swapped legs orient to the same 4-sf price");
eq(swapped.priceExact, "1234.50000000", "swapped legs orient to the same exact price");

var bad = Market._test.fillRow({}, "1.3.0", "1.3.1", PRECS);
eq(bad.displayPrice, null, "unmappable row -> null display (dash, never a reject)");
eq(bad.priceExact, null, "unmappable row -> null exact");
eq(bad.time, null, "unmappable row -> null time");

var zeroQ = fillRow("1234", "1.3.0", "0", "1.3.1");
eq(zeroQ.displayPrice, null, "zero quote -> null display (dash, never a whole-history reject)");
eq(zeroQ.priceExact, null, "zero quote -> null exact");

/* (b) _summary strip: head line keeps the label, the fold loses it. */
var chainRow = AccountHistory._history._test.chainRow;
var enriched = { id: "1.11.7", block_num: 1, op: [0, { from: "1.2.1" }], _summary: "Sent 1 BTS to bob" };
var stripped = chainRow(enriched);
assert.ok(!Object.prototype.hasOwnProperty.call(stripped, "_summary"), "stripped row has no _summary key");
passed++;
assert.ok(JSON.stringify(stripped).indexOf("_summary") === -1, "stripped JSON has no _summary key");
passed++;
eq(stripped.id, "1.11.7", "strip keeps chain fields (id)");
deq(stripped.op, [0, { from: "1.2.1" }], "strip keeps chain fields (op)");
eq(enriched._summary, "Sent 1 BTS to bob", "strip does not mutate the row (head line still reads it)");
eq(chainRow("x"), "x", "non-object passes through untouched");
eq(chainRow(null), null, "null passes through untouched");
var arrOut = chainRow([1, 2]);
assert.ok(Array.isArray(arrOut), "array stays an array");
passed++;
deq(arrOut, [1, 2], "array contents preserved");

/* (c) String bars plot: numbers unchanged, numeric strings coerce, junk gaps. */
var lineData = ChartsLwc._test.lineData;
deq(lineData([1, 2], [10, 20]), [{ time: 1, value: 10 }, { time: 2, value: 20 }], "number bars pass through");
deq(lineData([1, 2], ["0.0000001234", "1.5"]),
  [{ time: 1, value: Number("0.0000001234") }, { time: 2, value: 1.5 }],
  "all-string bars yield points (never a blanked pane)");
deq(lineData([1, 2, 3, 4], ["", null, "abc", "2"]), [{ time: 4, value: 2 }], "blank/null/junk stay gaps, never zero");
deq(lineData([1], [true]), [], "booleans are gaps (Number(true) would invent 1)");

console.log("market-tape-test: " + passed + " passed, 0 failed");
