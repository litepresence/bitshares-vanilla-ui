/* prediction-prob-test.js — unit vectors for the prediction implied-probability
 * math (mid-price/last fallback -> 0..1 -> Implied/Decimal/Fractional/American).
 * Stdlib only: `node tooling/prediction-prob-test.js` (exit 0 = green).
 * Covers PredictionUI._test pure helpers (clamp01/probabilityFromPrice/
 * probabilityFromBook/formatImplied/formatDecimal/gcd/formatFractional/
 * formatAmerican). No network, no DOM, no deps. Display math only (plain
 * Number on HUMAN prices — never raw integers, so integer/string-money rules
 * do not apply; Format still owns all raw↔human).
 */
"use strict";
var assert = require("assert");
var PredictionUI = require("../vanilla/js/views/prediction-ui.js");
var T = PredictionUI._test;

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function deep(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
}

/* probabilityFromPrice — edges + clamp + no-price empty (never 50% default). */
eq(T.probabilityFromPrice("0"), 0, "price 0 -> 0");
eq(T.probabilityFromPrice("0.5"), 0.5, "price 0.5 -> 0.5");
eq(T.probabilityFromPrice("1"), 1, "price 1 -> 1");
eq(T.probabilityFromPrice("1.5"), 1, "price >1 clamps to 1");
eq(T.probabilityFromPrice("-0.2"), 0, "price <0 clamps to 0");
eq(T.probabilityFromPrice(null), null, "no price null -> null (never 50%)");
eq(T.probabilityFromPrice(undefined), null, "undefined -> null");
eq(T.probabilityFromPrice(""), null, "empty -> null");
eq(T.probabilityFromPrice("abc"), null, "non-numeric -> null");
eq(T.probabilityFromPrice("NaN"), null, "NaN string -> null");

/* probabilityFromBook — mid preferred, last fallback, empty null. */
deep(T.probabilityFromBook("0.6", "0.8", "0.1"), { p: 0.7, source: "mid", price: 0.7 }, "mid (0.6+0.8)/2 beats last");
eq(T.probabilityFromBook("0.6", "0.8", "0.1").source, "mid", "mid source label");
deep(T.probabilityFromBook(null, null, "0.75"), { p: 0.75, source: "last", price: 0.75 }, "last fallback when book missing");
eq(T.probabilityFromBook(null, null, null), null, "no bid/ask/last -> null (empty)");
eq(T.probabilityFromBook("0", "0", null), null, "zero-sum book with no last -> null (no fake mid)");
deep(T.probabilityFromBook("0", "1", null), { p: 0.5, source: "mid", price: 0.5 }, "mid 0/1 -> 0.5");
deep(T.probabilityFromBook("2", "4", null), { p: 1, source: "mid", price: 3 }, "mid >1 clamps to 1");

/* formatImplied — 1 decimal. */
eq(T.formatImplied(0), "0.0%", "implied 0");
eq(T.formatImplied(0.5), "50.0%", "implied 0.5");
eq(T.formatImplied(1), "100.0%", "implied 1");
eq(T.formatImplied(0.75), "75.0%", "implied 0.75");
eq(T.formatImplied(2 / 3), "66.7%", "implied 2/3 rounds to 1dp");

/* formatDecimal — 2dp = 1/p, null at 0. */
eq(T.formatDecimal(0), null, "decimal 0 -> null (no finite odds)");
eq(T.formatDecimal(1), "1.00", "decimal 1 -> 1.00");
eq(T.formatDecimal(0.5), "2.00", "decimal 0.5 -> 2.00");
eq(T.formatDecimal(0.75), "1.33", "decimal 0.75 -> 1.33");
eq(T.formatDecimal(0.25), "4.00", "decimal 0.25 -> 4.00");

/* gcd — reduction primitive. */
eq(T.gcd(2, 4), 2, "gcd 2/4");
eq(T.gcd(3, 3), 3, "gcd 3/3");
eq(T.gcd(17, 5), 1, "gcd coprime");

/* formatFractional — (1-p)/p reduced, capped den, null at edges. */
eq(T.formatFractional(0), null, "fractional 0 -> null");
eq(T.formatFractional(1), null, "fractional 1 -> null");
eq(T.formatFractional(2 / 3), "1/2", "fractional 2/3 -> 1/2");
eq(T.formatFractional(1 / 3), "2/1", "fractional 1/3 -> 2/1");
eq(T.formatFractional(0.75), "1/3", "fractional 0.75 -> 1/3");
eq(T.formatFractional(0.25), "3/1", "fractional 0.25 -> 3/1");
eq(T.formatFractional(0.5), "1/1", "fractional 0.5 -> 1/1");
ok(/^\d+\/\d+$/.test(T.formatFractional(0.33)), "fractional 0.33 is N/D shape");
(function capped() {
  var fr = T.formatFractional(0.123456789);
  var den = parseInt(fr.split("/")[1], 10);
  ok(den <= T.PROB_MAX_DEN, "fractional denominator capped at " + T.PROB_MAX_DEN + " (got " + fr + ")");
})();

/* formatAmerican — sign both sides, Even at 50%, null at edges. */
eq(T.formatAmerican(0, "Even"), null, "american 0 -> null");
eq(T.formatAmerican(1, "Even"), null, "american 1 -> null");
eq(T.formatAmerican(0.5, "Even"), "Even", "american 0.5 -> Even (never +-100)");
eq(T.formatAmerican(0.75, "Even"), "-300", "american favorite 0.75 -> -300");
eq(T.formatAmerican(0.25, "Even"), "+300", "american underdog 0.25 -> +300");
ok(T.formatAmerican(0.6, "Even").charAt(0) === "-", "american >0.5 negative sign");
ok(T.formatAmerican(0.4, "Even").charAt(0) === "+", "american <0.5 positive sign");
eq(T.formatAmerican(2 / 3, "Even"), "-200", "american 2/3 -> -200");
eq(T.formatAmerican(1 / 3, "Even"), "+200", "american 1/3 -> +200");

console.log("prediction-prob-test: " + passed + "/" + passed + " green");
