/* app-shell-test.js — unit vectors for header shell purity (app.js).
 * Stdlib only: `node tooling/app-shell-test.js` (exit 0 = green). Covers
 * App._test.validPoolMarket (pool->Exchange context validation). No DOM,
 * no network, no deps.
 */
"use strict";
var assert = require("assert");
var App = require("../vanilla/js/app.js");
var T = App._test;
assert.ok(T && typeof T.validPoolMarket === "function", "_test.validPoolMarket exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

eq(T.validPoolMarket("BTS_CNY"), true, "canonical pair");
eq(T.validPoolMarket("bts_cny"), true, "lowercase accepted (uppercased at set)");
eq(T.validPoolMarket("HONEST.BTC_BTS"), true, "dotted symbols accepted");
eq(T.validPoolMarket("1.3.113"), false, "bare object id rejected");
eq(T.validPoolMarket("1.3.113_1.3.0"), false, "object-id pair rejected (would misroute desk)");
eq(T.validPoolMarket("BTS"), false, "no underscore rejected");
eq(T.validPoolMarket("A_B_C"), false, "three parts rejected");
eq(T.validPoolMarket(""), false, "empty rejected");
eq(T.validPoolMarket(null), false, "null rejected");
eq(T.validPoolMarket(undefined), false, "undefined rejected");
eq(T.validPoolMarket("TOOLONGTOKENNAME_X"), false, "overlong leg rejected");

console.log("app-shell-test: " + passed + " passed, 0 failed");
