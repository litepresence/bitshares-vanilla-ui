#!/usr/bin/env node
/* market-candles-orient-test: bucket-orientation vectors for MarketCandles.
 * get_market_history returns legs in chain-canonical order, NOT necessarily
 * the requested (baseId, quoteId) order (#1 MarketsStore._priceChart proves
 * it: the `quoteAsset.id === key.quote` branch swaps legs back, crosses
 * high/low, and swaps the volume legs). candles() must do the same, or an
 * inverted market prices swapped raws at unswapped precisions (reciprocal
 * times 10^2Δp) while the book/ticker stay correct: the plot/book mismatch.
 * Base 1.3.0 prec 5, quote 1.3.113 prec 4 throughout.
 * Stdlib only. Exit 0 = all pass, 1 = any failure. */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
var MC = require("/workspace/vanilla/js/api/market-candles.js");
var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}

var baseId = "1.3.0", quoteId = "1.3.113";
var slotISO = new Date(Math.floor(Date.now() / 1000 / 3600) * 3600 * 1000).toISOString().slice(0, -5);
/* Wire open 0.5 / high 0.6 / low 0.4 / close 0.55 in wire quoted terms, so
 * oriented base-per-quote reads open 2.0 / high 2.5 / low 1.667 / close 1.818
 * (places probe over {2.0, 2.5, 1.667, 1.818} picks 3). Volumes: 1.0 base. */
function swappedRow() {
  return {
    key: { open: slotISO, base: quoteId, quote: baseId },
    open_base: "5000", open_quote: "100000",
    high_base: "6000", high_quote: "100000",
    low_base: "4000", low_quote: "100000",
    close_base: "5500", close_quote: "100000",
    base_volume: "5500", quote_volume: "100000"
  };
}
function matchedRow() {
  return {
    key: { open: slotISO, base: baseId, quote: quoteId },
    open_base: "100000", open_quote: "5000",
    high_base: "100000", high_quote: "4000",
    low_base: "100000", low_quote: "6000",
    close_base: "100000", close_quote: "5500",
    base_volume: "100000", quote_volume: "5500"
  };
}
var nextRow = swappedRow;
globalThis.Chain = {
  db: function () { return Promise.resolve(1); },
  history: function () { return Promise.resolve(2); },
  call: function (id, method) {
    if (method === "get_market_history_buckets") return Promise.resolve([3600]);
    if (method === "get_assets") return Promise.resolve([{ id: baseId, precision: 5 }, { id: quoteId, precision: 4 }]);
    if (method === "get_market_history") return Promise.resolve([nextRow()]);
    return Promise.reject(new Error("unexpected " + method));
  }
};

(async function () {
  /* 1-6: swapped legs orient to base-per-quote (the reported bug). */
  var b = (await MC.candles(baseId, quoteId, 3600, 5)).buckets.pop();
  eq([b.open, b.high, b.low, b.close], ["2.000", "2.500", "1.667", "1.818"], "swapped OHLC oriented");
  eq([b.baseVolume, b.quoteVolume], ["1.00000", "0.5500"], "swapped volumes oriented");
  eq([b.highBase, b.highQuote], ["100000", "4000"], "swapped high raws are oriented base-first");
  /* 7-8: matched legs render identically (no regression). */
  nextRow = matchedRow;
  var m = (await MC.candles(baseId, quoteId, 3600, 5)).buckets.pop();
  eq([m.open, m.high, m.low, m.close], ["2.000", "2.500", "1.667", "1.818"], "matched OHLC unchanged");
  eq([m.baseVolume, m.quoteVolume], ["1.00000", "0.5500"], "matched volumes unchanged");
  /* 9: missing key legs assume matched (backward compat, never blank). */
  nextRow = function () {
    var r = matchedRow();
    r.key = { open: slotISO };
    return r;
  };
  var k = (await MC.candles(baseId, quoteId, 3600, 5)).buckets.pop();
  eq(k ? k.close : null, "1.818", "missing key legs assume matched");
  /* 10: foreign pair legs are a gap, never wrong money. */
  nextRow = function () {
    var r = matchedRow();
    r.key = { open: slotISO, base: "1.3.999", quote: "1.3.998" };
    return r;
  };
  var f = await MC.candles(baseId, quoteId, 3600, 5);
  eq(f.buckets.length, 0, "foreign pair legs are a gap");
  console.log("market-candles-orient-test: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log("ERR " + (e && e.message)); process.exit(1); });
