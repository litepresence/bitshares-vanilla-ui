#!/usr/bin/env node
/* transfer-share-test.js — unit vectors for pre-filled transfer links
 * (vanilla/js/views/transfer-ui.js shareHash/shareAmount). Stdlib only:
 * `node tooling/transfer-share-test.js` (exit 0 = green). transfer-ui.js
 * touches document at load, so the harness shims a minimal document
 * (no DOM behavior asserted — pure helpers only via the _test seam).
 * No network, no deps.
 */
"use strict";
var assert = require("assert");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

// Minimal document shim: only module-scope evaluation needs it.
global.document = undefined;
var fs = require("fs");
var vm = require("vm");
var src = fs.readFileSync("/workspace/vanilla/js/views/transfer-ui.js", "utf8");
var sandbox = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  module: { exports: {} },
};
sandbox.globalThis = sandbox;
sandbox.window = undefined;
sandbox.document = undefined;
sandbox.location = { hash: "" };
sandbox.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "views/transfer-ui.js" });
var T = sandbox.TransferUI._test;
assert.ok(T && typeof T.shareHash === "function", "_test.shareHash exported");
assert.ok(typeof T.shareAmount === "function", "_test.shareAmount exported");

/* shareAmount — query amount gate (shape only, precision is review-time). */
eq(T.shareAmount("1.5"), "1.5", "decimal passes");
eq(T.shareAmount("100"), "100", "integer passes");
eq(T.shareAmount("0"), "", "zero rejected");
eq(T.shareAmount("0.00"), "", "zero decimal rejected");
eq(T.shareAmount("-5"), "", "negative rejected");
eq(T.shareAmount("1,5"), "", "comma rejected");
eq(T.shareAmount("1e3"), "", "exponent rejected");
eq(T.shareAmount("abc"), "", "garbage rejected");
eq(T.shareAmount(""), "", "empty rejected");
eq(T.shareAmount(null), "", "null rejected, never throws");
eq(T.shareAmount(undefined), "", "undefined rejected");

/* shareHash — pre-filled transfer deep link, sparse params only. */
eq(T.shareHash("alice", "BTS", "1.5", ""), "#/transfer?to=alice&asset=BTS&amount=1.5", "full minus memo");
eq(T.shareHash("alice", "BTS", "1.5", "hi"), "#/transfer?to=alice&asset=BTS&amount=1.5&memo=hi", "full");
eq(T.shareHash("bob", "", "", ""), "#/transfer?to=bob", "to only");
eq(T.shareHash("", "", "", ""), "#/transfer", "empty -> bare route");
eq(T.shareHash("a b", "BTS", "1", "x&y"), "#/transfer?to=a%20b&asset=BTS&amount=1&memo=x%26y", "encoded");

console.log("transfer-share-test: " + passed + " passed, 0 failed");
