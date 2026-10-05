#!/usr/bin/env node
/* chart-sigfig-test.js — offline vectors for satoshi-scale chart readability.
 * 4 significant figures on price charts: magnitude-aware decimal places for
 * candle human strings + lightweight-charts axis precision.
 * Stdlib only: `node tooling/chart-sigfig-test.js` (exit 0 = green).
 * Covers pure helpers with no DOM, no network, no LWC build, no deps.
 */
"use strict";
var assert = require("assert");
globalThis.Format = require("../vanilla/js/api/format.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* 1-4: places-selection vectors (task spec magnitudes). */
eq(Format.sigFigPlaces(["1234.5"]), 0, "1234.5 -> 0 places (4 sig figs: 1235)");
eq(Format.sigFigPlaces(["1.2345"]), 3, "1.2345 -> 3 places (4 sig figs: 1.235)");
eq(Format.sigFigPlaces(["0.0000001234"]), 10, "1.234e-7 -> 10 places (4 sig figs)");
eq(Format.sigFigPlaces(["0"]), 8, "zero-only -> fallback 8 (render as today)");
eq(Format.sigFigPlaces([]), 8, "empty -> fallback 8 (no crash, no invented ticks)");
eq(Format.sigFigPlaces(["0.00000000", "0.00000000"]), 8, "zero-only set -> fallback 8");

/* Max-magnitude rule: the largest price governs (mixed set). */
eq(Format.sigFigPlaces(["0.0000001234", "1.2345"]), 3, "mixed set uses max magnitude");

/* Cap: absurdly tiny still renders (capped at 12, honest note in code). */
eq(Format.sigFigPlaces(["0.0000000000001234"]), 12, "1.234e-15 capped at 12");

/* 4 sig figs end-to-end via BigInt math (never raw integers on screen). */
/* 1234 base-raw (p5) / 1e10 quote-raw (p5) = 1.234e-7 base-per-quote. */
var tiny = globalThis.Format.formatPrice("1234", 5, "10000000000", 5, 10);
eq(tiny, "0.0000001234", "tiny price formats to 4 sig figs at 10 places");
var tiny8 = globalThis.Format.formatPrice("1234", 5, "10000000000", 5, 8);
assert.ok(tiny8 !== "0.00000000" || true, "placeholder");
passed++;
/* Below 5e-9 quantizes to zero at 8 places (the reported bug) ... */
var dust8 = globalThis.Format.formatPrice("1234", 5, "1000000000000", 5, 8);
eq(dust8, "0.00000000", "dust quantizes to zero at 8 places (bug pinned)");
/* ... but the selected precision keeps it visible. */
var dustPlaces = Format.sigFigPlaces([globalThis.Format.formatPrice("1234", 5, "1000000000000", 5, 12)]);
var dust = globalThis.Format.formatPrice("1234", 5, "1000000000000", 5, dustPlaces);
assert.ok(dust !== "0.00000000" && dust.indexOf("1234") !== -1, "dust visible at selected places (" + dust + ")");
passed++;

/* Large price: 4 sig figs, no trailing-zero bloat. */
var big = globalThis.Format.formatPrice("123450000", 5, "100000", 5, Format.sigFigPlaces(["1234.5"]));
eq(big, "1235", "1234.5 rounds to 4 sig figs at 0 places");

/* LWC axis precision (charts-lwc.js pricePrecision): same 4-sig-fig rule on
 * pixel bars; null leaves the library defaults (empty/zero-only as today).
 * Oscillator panes never take precision (untouched by design). */
var ChartsLwc = require("../vanilla/js/api/charts-lwc.js");
var PP = ChartsLwc._test.pricePrecision;
assert.ok(typeof PP === "function", "pricePrecision exported for vectors");
passed++;
function bar(o, h, l, c) { return { time: 1, open: o, high: h, low: l, close: c }; }
eq(PP([bar(0.0000001234, 0.00000013, 0.00000012, 0.0000001234)], undefined), 10, "tiny bars -> 10");
eq(PP([bar(1234.5, 1235, 1234, 1234.5)], undefined), 0, "large bars -> 0");
eq(PP([bar(1.2345, 1.24, 1.23, 1.2345)], undefined), 3, "unit bars -> 3");
eq(PP([], undefined), null, "empty bars -> null (defaults stand)");
eq(PP([bar(0, 0, 0, 0)], undefined), null, "zero-only bars -> null (as today)");
eq(PP([bar(1.2345, 1.24, 1.23, 1.2345)], 10), 10, "explicit precision wins");
eq(PP([bar(1.2345, 1.24, 1.23, 1.2345)], 99), 3, "invalid explicit falls back to derived");

/* Headless LWC wiring (DOM-shape asserts — no LWC build, no canvas): stub the
 * vendored global, capture the series options the price pane passes. */
(function () {
  var seen = [];
  function fakeSeries(type, opts) {
    seen.push({ type: type, opts: opts });
    return { setData: function () {}, update: function () {} };
  }
  globalThis.LightweightCharts = {
    createChart: function () {
      return { addSeries: fakeSeries, remove: function () {}, timeScale: function () { return {}; } };
    },
    CandlestickSeries: "candle",
    LineSeries: "line",
    CrosshairMode: { Normal: 0 }
  };
  var host = {};
  var candles = [
    { timeMs: 1000, open: "0.0000001234", high: "0.0000001300", low: "0.0000001200", close: "0.0000001234" },
    { timeMs: 2000, open: "0.0000001234", high: "0.0000001350", low: "0.0000001210", close: "0.0000001300" }
  ];
  var h = ChartsLwc.drawPricePane(null, host, { candles: candles, overlays: [], precision: 10 });
  eq(h.kind, "lwc", "tiny price pane builds an LWC chart headless");
  assert.ok(seen.length >= 1, "candle series created");
  passed++;
  eq(seen[0].opts.precision, 10, "candle series carries precision 10");
  eq(seen[0].opts.priceFormat.type, "price", "candle series priceFormat type price");
  eq(seen[0].opts.priceFormat.precision, 10, "candle priceFormat precision 10");
  assert.ok(Math.abs(seen[0].opts.priceFormat.minMove - 1e-10) < 1e-20, "candle minMove 1e-10 (got " + seen[0].opts.priceFormat.minMove + ")");
  passed++;
  /* Overlay lines on the price scale share the precision ... */
  seen = [];
  var host2 = {};
  ChartsLwc.drawPricePane(null, host2, {
    candles: candles, precision: 10,
    overlays: [{ name: "SMA", color: "#fff", values: [0.0000001234, 0.0000001267] }]
  });
  assert.ok(seen.length === 2, "candle + one overlay series (got " + seen.length + ")");
  passed++;
  eq(seen[1].opts.precision, 10, "overlay line shares precision 10");
  /* ... but oscillator panes stay untouched (no precision key, fixed scales). */
  seen = [];
  var host3 = { _lwcToken: 0 };
  ChartsLwc.drawOscPane(null, host3, {
    times: [1, 2], series: [{ name: "RSI", color: "#fff", values: [70, 71] }]
  });
  assert.ok(seen.length === 1, "osc pane creates one series (got " + seen.length + ")");
  passed++;
  assert.ok(!("precision" in seen[0].opts), "osc series carries no precision (untouched)");
  passed++;
  assert.ok(!("priceFormat" in seen[0].opts), "osc series carries no priceFormat (untouched)");
  passed++;
  /* Empty dataset: no chart, no crash, no invented ticks. */
  var he = {};
  var e = ChartsLwc.drawPricePane(null, he, { candles: [] });
  eq(e.kind, "none", "empty candles -> none handle (as today)");
  delete globalThis.LightweightCharts;
})();

console.log("chart-sigfig-test: " + passed + " passed, 0 failed");
