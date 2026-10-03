"use strict";
var path = require("path");
var assert = require("assert");
var D = require(path.join(__dirname, "..", "vanilla", "assets", "build-dialog.js"));
assert.ok(Array.isArray(D), "asset exports an array");
assert.strictEqual(D.length, 413, "413 exchanges (got " + D.length + ")");
assert.deepStrictEqual(
  Object.keys(D[0]).sort(), ["n", "reply", "session", "time", "user"], "entry keys");
assert.strictEqual(D[0].n, 1, "numbering starts at 1");
assert.strictEqual(D[D.length - 1].n, 413, "numbering ends at 413");
assert.ok(D[0].user.indexOf("acquire bitshares-ui") !== -1, "first prompt is the founding prompt");
assert.ok(D[D.length - 1].user.indexOf("issues/1") !== -1, "last prompt is the issue-1 prompt");
console.log("build-dialog asset shape: 7 passed, 0 failed");
