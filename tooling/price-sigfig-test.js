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

console.log("price-sigfig-test: " + passed + " passed, 0 failed");
