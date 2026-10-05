#!/usr/bin/env node
/* chart-sigfig-test.js — offline vectors for satoshi-scale chart readability.
 * 4 significant figures on price charts: magnitude-aware decimal places for
 * candle human strings + lightweight-charts custom axis formatter (per-tick
 * Format.priceSig: plain <= 9 digits, else sci).
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
eq(tiny8, "0.00000012", "tiny price survives at 8 places (dust-zero only below 5e-9)");
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

/* LWC axis tick formatter (charts-lwc.js priceTick): per-tick global 4-sf
 * rule via Format.priceSig — plain fixed-point when <= 9 digits, else sci.
 * The vendored build supports type:"custom" (verified: the standalone
 * production bundle's series-formatter switch has a `case"custom"` branch
 * reading priceFormat.formatter, with a tickmarksFormatter ?? map fallback).
 * Oscillator panes never take a priceFormat (untouched by design). */
var ChartsLwc = require("../vanilla/js/api/charts-lwc.js");
assert.ok(typeof ChartsLwc._test.priceTick === "function", "priceTick exported for vectors");
passed++;
assert.ok(typeof ChartsLwc._test.priceFormatCustom === "function", "priceFormatCustom exported");
passed++;
var PT = ChartsLwc._test.priceTick;
eq(PT(1.2345), "1.234", "unit tick -> plain 4sf (toPrecision display rounding)");
eq(PT(1234.5), "1235", "large tick -> plain 4sf, no decimals");
eq(PT(0.0000001234), "1.234e-7", "dust tick -> sci (sub-1e-9 cap retired for the axis)");
eq(PT("0.0000001234"), "1.234e-7", "dust string tick -> sci");
eq(PT(0), "0", "zero tick -> 0 (safe)");
eq(PT(null), "", "null tick -> empty (safe)");
eq(PT(undefined), "", "undefined tick -> empty (safe)");
eq(PT(""), "", "empty string tick -> empty (safe)");
var PF = ChartsLwc._test.priceFormatCustom();
eq(PF.type, "custom", "price pane format type custom");
assert.ok(typeof PF.formatter === "function", "custom formatter is a function");
passed++;
assert.ok(typeof PF.tickmarksFormatter === "function", "tickmarks formatter is a function");
passed++;
var mapped = PF.tickmarksFormatter([1.2345, 0.0000001234]);
assert.deepStrictEqual(mapped, ["1.234", "1.234e-7"], "axis array maps exactly like crosshair labels");
passed++;
assert.deepStrictEqual(PF.tickmarksFormatter("not-an-array"), [], "non-array tickmarks -> [] (never throws)");
passed++;

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
  assert.ok(!("precision" in seen[0].opts), "candle series carries no fixed precision (custom per-tick)");
  passed++;
  eq(seen[0].opts.priceFormat.type, "custom", "candle series priceFormat type custom");
  assert.ok(typeof seen[0].opts.priceFormat.formatter === "function", "candle formatter is a function");
  passed++;
  eq(seen[0].opts.priceFormat.formatter(0.0000001234), "1.234e-7", "candle formatter dust -> sci");
  eq(seen[0].opts.priceFormat.formatter(1.2345), "1.234", "candle formatter unit -> plain 4sf");
  assert.deepStrictEqual(
    seen[0].opts.priceFormat.tickmarksFormatter([1.2345, 0.0000001234]),
    ["1.234", "1.234e-7"], "axis tickmarks map exactly like crosshair labels");
  passed++;
  /* Overlay lines on the price scale share the custom format ... */
  seen = [];
  var host2 = {};
  ChartsLwc.drawPricePane(null, host2, {
    candles: candles, precision: 10,
    overlays: [{ name: "SMA", color: "#fff", values: [0.0000001234, 0.0000001267] }]
  });
  assert.ok(seen.length === 2, "candle + one overlay series (got " + seen.length + ")");
  passed++;
  eq(seen[1].opts.priceFormat.type, "custom", "overlay line shares custom format");
  eq(seen[1].opts.priceFormat.formatter(0.0000001267), "1.267e-7", "overlay formatter dust -> sci");
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
