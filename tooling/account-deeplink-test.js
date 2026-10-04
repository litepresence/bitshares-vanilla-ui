#!/usr/bin/env node
/* account-deeplink-test.js — unit vectors for account tab/filter deep links
 * (vanilla/js/views/account-ui.js parseAcctQuery/buildAcctQuery).
 * Stdlib only: `node tooling/account-deeplink-test.js` (exit 0 = green).
 * No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var AccountUI = require("../vanilla/js/views/account-ui.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var T = AccountUI._test;
assert.ok(T && typeof T.parseAcctQuery === "function", "parseAcctQuery exported");
assert.ok(typeof T.buildAcctQuery === "function", "buildAcctQuery exported");

/* parseAcctQuery — validated slugs, defaults on garbage. */
eq(T.parseAcctQuery(null), { tab: null, hist: "all" }, "null -> defaults");
eq(T.parseAcctQuery({}), { tab: null, hist: "all" }, "empty -> defaults");
eq(T.parseAcctQuery({ tab: "history", hist: "0" }), { tab: "history", hist: "0" }, "full seed");
eq(T.parseAcctQuery({ tab: "balances", hist: "all" }), { tab: null, hist: "all" }, "defaults collapse to null/all");
eq(T.parseAcctQuery({ tab: "nope", hist: "7" }), { tab: null, hist: "all" }, "garbage -> defaults");
eq(T.parseAcctQuery({ tab: "HISTORY" }), { tab: null, hist: "all" }, "case-sensitive, never guessed");
eq(T.parseAcctQuery("x"), { tab: null, hist: "all" }, "non-object -> defaults, never throws");

/* buildAcctQuery — sparse output, defaults vanish. */
eq(T.buildAcctQuery("balances", "all"), "", "defaults -> bare path");
eq(T.buildAcctQuery(null, "all"), "", "null tab -> bare path");
eq(T.buildAcctQuery("history", "all"), "?tab=history", "tab only");
eq(T.buildAcctQuery("balances", "0"), "?hist=0", "hist only");
eq(T.buildAcctQuery("orders", "4"), "?tab=orders&hist=4", "both");
eq(T.buildAcctQuery("nope", "7"), "", "garbage -> bare path");

/* Round-trip. */
eq(T.buildAcctQuery("margin", "0"), "?tab=margin&hist=0", "margin round-trip builds");
var rt = T.parseAcctQuery({ tab: "margin", hist: "0" });
eq(rt, { tab: "margin", hist: "0" }, "margin round-trip parses");

console.log("account-deeplink-test: " + passed + " passed, 0 failed");
