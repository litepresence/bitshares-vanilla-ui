#!/usr/bin/env node
/* market-intel-test: unit vectors for the market-intelligence task
 * (most-active-markets sort/filter + grouped order-book bucketing).
 * Stdlib only. Exit 0 = all pass, 1 = any failure.
 *
 * Money rule: expectations pin exact decimal strings (never floats);
 * the implementation under test uses Format.parsePriceRatio /
 * parseAmount/formatAmount only (see vanilla/js/api/market-book.js
 * grouping header + vanilla/js/api/explorer-tabs.js cmpDec header).
 */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
var MB = require("/workspace/vanilla/js/api/market-book.js");
var XT = require("/workspace/vanilla/js/api/explorer-tabs.js")._test;

var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL " + name); }
}

/* --- bucketKey boundaries --- */
eq(MB.bucketKey("1.099", 1), "1.0", "bucketKey floor 1.099@1 -> 1.0");
eq(MB.bucketKey("1.5", 2), "1.50", "bucketKey pads 1.5@2 -> 1.50");
eq(MB.bucketKey("123", 0), "123", "bucketKey int@0");
eq(MB.bucketKey("1.056", 2), "1.05", "bucketKey floor 1.056@2 -> 1.05");
var threw = false;
try { MB.bucketKey("1.5", 99); } catch (e) { threw = /bad-group/.test(e.message); }
ok(threw, "bucketKey rejects decimals 99");
threw = false;
try { MB.bucketKey("abc", 2); } catch (e) { threw = true; }
ok(threw, "bucketKey rejects junk price");

/* --- groupLevels: same-bucket merge, exact sums, count --- */
var lv = [
  { displayPrice: "1.056", base: "10", quote: "5" },
  { displayPrice: "1.051", base: "20", quote: "10" }
];
var g = MB.groupLevels(lv, 2, false);
eq(g.length, 1, "same bucket merges to one row");
eq(g[0].price, "1.05", "bucket price is the floor");
eq(g[0].base, "30", "base legs summed exactly");
eq(g[0].quote, "15", "quote legs summed exactly");
eq(g[0]._count, 2, "bucket count tracks legs");

/* --- groupLevels: boundary cross stays split --- */
var g2 = MB.groupLevels([
  { displayPrice: "1.049", base: "1", quote: "1" },
  { displayPrice: "1.050", base: "2", quote: "2" }
], 2, false);
eq(g2.map(function (r) { return r.price; }), ["1.04", "1.05"], "1.049/1.050 split at 2dp");

/* --- groupLevels: side ordering --- */
var asks = MB.groupLevels([
  { displayPrice: "1.15", base: "1", quote: "1" },
  { displayPrice: "1.05", base: "1", quote: "1" }
], 1, false);
eq(asks.map(function (r) { return r.price; }), ["1.0", "1.1"], "asks ascend");
var bids = MB.groupLevels([
  { displayPrice: "1.05", base: "1", quote: "1" },
  { displayPrice: "1.15", base: "1", quote: "1" }
], 1, true);
eq(bids.map(function (r) { return r.price; }), ["1.1", "1.0"], "bids descend");

/* --- groupLevels: dust preserved, empty sides, exact copy, junk rows --- */
var dust = MB.groupLevels([
  { displayPrice: "1.000000001", base: "0.00000001", quote: "0.00000001" },
  { displayPrice: "1.000000009", base: "0.00000002", quote: "0.00000002" }
], 8, false);
eq(dust.length, 1, "dust shares one bucket");
eq(dust[0].base, "0.00000003", "dust base summed, none dropped");
eq(MB.groupLevels([], 2, true), [], "empty bids stay empty");
eq(MB.groupLevels([], 2, false), [], "empty asks stay empty");
var exact = MB.groupLevels(lv, null, false);
eq(exact.length, 2, "null decimals keeps every level");
ok(exact !== lv, "null decimals returns a copy");
var junk = MB.groupLevels([
  { displayPrice: "abc", base: "5", quote: "5" },
  { displayPrice: "1.05", base: "7", quote: "7" }
], 2, false);
eq(junk.length, 1, "junk price row dropped, rest stand");
eq(junk[0].base, "7", "survivor totals honest");
threw = false;
try { MB.groupLevels(lv, 99, false); } catch (e) { threw = /bad-group/.test(e.message); }
ok(threw, "groupLevels rejects decimals 99");

/* --- groupBook: both sides at once --- */
var both = MB.groupBook({
  bids: [{ displayPrice: "2.05", base: "1", quote: "1" }],
  asks: []
}, 1);
eq(both.bids.map(function (r) { return r.price; }), ["2.0"], "groupBook bids bucketed");
eq(both.asks, [], "groupBook empty asks stay empty");

/* --- sortMarkets / filterMarkets / cmpDec --- */
function mkrow(id, latest, baseVol, change) {
  return { id: id, latest: latest, bid: null, ask: null, baseVol: baseVol, quoteVol: null, change: change };
}
var mrows = [mkrow("X_Y", "1", "30", "1"), mkrow("A_B", "1", "100", "2"), mkrow("M_N", "1", "5", "3")];
eq(XT.sortMarkets(mrows, "vol_desc").map(function (r) { return r.id; }), ["A_B", "X_Y", "M_N"], "vol_desc is chain order");
eq(XT.sortMarkets(mrows, "vol_asc").map(function (r) { return r.id; }), ["M_N", "X_Y", "A_B"], "vol_asc flips");
var prows = [mkrow("A", "10.5", "1", "0"), mkrow("B", "9.75", "1", "0"), mkrow("C", "100", "1", "0")];
eq(XT.sortMarkets(prows, "price_asc").map(function (r) { return r.id; }), ["B", "A", "C"], "price_asc exact (no float)");
var urows = [mkrow("A", "1", "junk", "0"), mkrow("B", "1", "50", "0"), mkrow("C", "1", null, "0")];
eq(XT.sortMarkets(urows, "vol_desc").map(function (r) { return r.id; }), ["B", "A", "C"], "unparseable volumes sink last, stable");
var crows = [mkrow("A", "1", "1", "2.5"), mkrow("B", "1", "1", "10"), mkrow("C", "1", "1", "junk")];
eq(XT.sortMarkets(crows, "change_desc").map(function (r) { return r.id; }), ["B", "A", "C"], "change_desc exact, junk last");
var arows = [mkrow("USD_BTS", "1", "1", "0"), mkrow("BTS_CNY", "1", "1", "0"), mkrow("AAA_BBB", "1", "1", "0")];
eq(XT.sortMarkets(arows, "market_az").map(function (r) { return r.id; }), ["AAA_BBB", "BTS_CNY", "USD_BTS"], "market A-Z");
eq(XT.filterMarkets(arows, "cny").map(function (r) { return r.id; }), ["BTS_CNY"], "filter matches substring, case-blind");
eq(XT.filterMarkets(arows, "").length, 3, "blank filter keeps all");
eq(XT.filterMarkets(arows, "zzz"), [], "no-match filter is empty, never null");
ok(XT.cmpDec("9.75", "10.5") < 0, "cmpDec 9.75 < 10.5");
ok(XT.cmpDec(null, "1") > 0, "cmpDec null sinks");
eq(XT.cmpDec("abc", "def"), 0, "cmpDec junk-vs-junk is 0");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
