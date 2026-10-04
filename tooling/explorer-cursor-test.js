#!/usr/bin/env node
/* explorer-cursor-test.js — unit vectors for the blocks-table ?from= cursor
 * (vanilla/js/views/explorer-blocks.js parseFromHeight). Stdlib only:
 * `node tooling/explorer-cursor-test.js` (exit 0 = green).
 * No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var ExplorerBlocks = require("../vanilla/js/views/explorer-blocks.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var T = ExplorerBlocks._test;
assert.ok(T && typeof T.parseFromHeight === "function", "parseFromHeight exported");

eq(T.parseFromHeight("101000000"), 101000000, "height parses");
eq(T.parseFromHeight("1"), 1, "genesis-adjacent parses");
eq(T.parseFromHeight("0"), null, "zero rejected");
eq(T.parseFromHeight("-5"), null, "negative rejected");
eq(T.parseFromHeight("12.5"), 12, "parseInt truncation (matches rowsFor math)");
eq(T.parseFromHeight("abc"), null, "garbage rejected");
eq(T.parseFromHeight(""), null, "empty rejected");
eq(T.parseFromHeight(null), null, "null rejected, never throws");
eq(T.parseFromHeight(undefined), null, "undefined rejected");

console.log("explorer-cursor-test: " + passed + " passed, 0 failed");
