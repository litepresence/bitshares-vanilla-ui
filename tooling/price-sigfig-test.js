#!/usr/bin/env node
/* price-sigfig-test.js — core global price rule: EVERY displayed price shows
 * 4 significant figures; when 4 sig figs need more than 9 digits, display
 * scientific notation with 4 sig figs (e.g. 1.234e-7).
 * Stdlib only: `node tooling/price-sigfig-test.js` (exit 0 = green).
 * Covers Format.priceSig (pure display-only helper, vanilla/js/api/format.js).
 */
"use strict";
var assert = require("assert");
var Format = require("../vanilla/js/api/format.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* Core vectors (task spec). */
eq(Format.priceSig("1234.5678"), "1235", "1234.5678 -> 1235 (4sf)");
eq(Format.priceSig("1.23456"), "1.235", "1.23456 -> 1.235");
eq(Format.priceSig("0.0000001230"), "1.230e-7", "0.0000001230 -> 1.230e-7 (keep trailing zero)");
eq(Format.priceSig("1234567890"), "1.235e+9", "1234567890 -> 1.235e+9 (10 digits, sci)");
eq(Format.priceSig("123456789"), "123500000", "123456789 -> 123500000 (9 digits, plain)");
eq(Format.priceSig("0"), "0", "zero -> 0");
eq(Format.priceSig("0.00"), "0", "zero decimals -> 0");

/* Rounding check: 0.00000012345 to 4sf half-up is 1.235e-7 (spec draft said
 * 1.234e-7; JS toPrecision(4) + exact half-up both give 1.235 — spec typo). */
eq(Format.priceSig("0.00000012345"), "1.235e-7", "0.00000012345 -> 1.235e-7 (rounded, 10 digits sci)");

/* Negative handling (sign preserved, same rule). */
eq(Format.priceSig("-1.23456"), "-1.235", "negative unit -> -1.235");
eq(Format.priceSig("-0.0000001230"), "-1.230e-7", "negative tiny -> -1.230e-7");

/* Malformed passthrough (never throw, never blank). */
eq(Format.priceSig("abc"), "abc", "malformed passthrough");
eq(Format.priceSig(""), "", "empty passthrough (not zero)");
eq(Format.priceSig("1.2.3"), "1.2.3", "double-dot passthrough");

/* Plain stays plain under the 9-digit cap. */
eq(Format.priceSig("0.000012345"), Format.priceSig("0.000012345"), "small plain smoke (no crash)");
assert.ok(typeof Format.priceSig("1.00") === "string", "string out");
passed++;

/* Sigfig sweep (2026-10-05): per-area before/after for normal + dust
 * magnitudes. "Before" = the string the view painted prior to the sweep
 * (8-place formatPrice, trim6, or verbatim chain string); "after" = what
 * the sweep paints via priceSig. Documents the intended 4sf normalization
 * (trailing zeros significant: "1.230" stays "1.230") and the dust fix
 * (trim6 rendered dust as "0.000000"; priceSig renders sci). */
eq(Format.priceSig("1.23456789"), "1.235", "sweep/book: chain 8-dec latest -> 4sf (was trim6 1.234567)");
eq(Format.priceSig("1.23000000"), "1.230", "sweep/feed: 8-place 1.23 -> 1.230 (zeros significant, was trim 1.23)");
eq(Format.priceSig("0.0000001235"), "1.235e-7", "sweep/dust: trim6 showed 0.000000, now sci");
eq(Format.priceSig("0.000000123456789012"), "1.235e-7", "sweep/dust: 18-dec chain latest -> sci");
eq(Format.priceSig("1547.987600"), "1548", "sweep/portfolio: 8-place silver -> 1548");
eq(Format.priceSig("1"), "1.000", "sweep/portfolio: BTS unit price 1 -> 1.000 (4sf)");
eq(Format.priceSig("1.235"), "1.235", "sweep/chart: 4sf-places candle string is identity");
eq(Format.priceSig("1235"), "1235", "sweep/chart: 0-place 4sf string is identity");
eq(Format.priceSig("2.50000000"), "2.500", "sweep/spot: pool spot 2.5 -> 2.500");
eq(Format.priceSig("100.00000000"), "100.0", "sweep/settle: estimate 100 -> 100.0");
eq(Format.priceSig("0.000012345"), "0.00001234", "sweep/small: 9-digit plain stays plain, 4sf");

console.log("price-sigfig-test: " + passed + " passed, 0 failed");
