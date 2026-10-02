/* explorer-ops-test.js — offline vectors for live activity shaping
 * (api/explorer.js opsFromBody). Stdlib only:
 * `node tooling/explorer-ops-test.js` (exit 0 = green). Covers the pure
 * per-head extraction the tip uses to refresh Recent activity with ZERO new
 * RPCs (body already fetched for the table). No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var Explorer = require("../vanilla/js/api/explorer.js");
assert.ok(Explorer && typeof Explorer.opsFromBody === "function", "opsFromBody exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var T0 = [[0, { amount: { amount: "100", asset_id: "1.3.0" } }]];
var BODY = [{ operations: T0 }, { operations: [[1, {}], [2, {}]] }];

var rows = Explorer.opsFromBody(99, BODY);
eq(rows.length, 3, "3 ops extracted");
eq(rows[0].block, 99, "block stamped");
eq(rows[0].tx, 0, "tx index");
eq(rows[0].op, 0, "op index");
eq(rows[0].type_idx, 0, "transfer idx");
eq(rows[1].type_idx, 1, "second op idx");
eq(rows[2].tx, 1, "second tx");
eq(typeof rows[0].fields, "object", "fields intact (amounts render)");

eq(Explorer.opsFromBody(99, []).length, 0, "empty body -> []");
eq(Explorer.opsFromBody(99, null).length, 0, "null body -> []");
eq(Explorer.opsFromBody(99, undefined).length, 0, "undefined body -> []");
eq(Explorer.opsFromBody(99, [{ operations: null }]).length, 0, "null ops -> []");
eq(Explorer.opsFromBody(99, [{}]).length, 0, "missing ops -> []");

var big = [];
for (var i = 0; i < 30; i++) big.push({ operations: [[0, {}]] });
eq(Explorer.opsFromBody(1, big).length, 20, "capped at 20");

var objForm = [{ operations: [{ type: 0 }] }];
var r2 = Explorer.opsFromBody(5, objForm);
eq(r2.length, 1, "object-form op accepted");
eq(r2[0].type_idx, 0, "object-form idx");

console.log("explorer-ops-test: " + passed + " passed, 0 failed");
