/* node-discover-test.js — unit vectors for opt-in discovery shaping
 * (api/node-discover.js). Stdlib only:
 * `node tooling/node-discover-test.js` (exit 0 = green). Covers pure
 * helpers (repoScore, extractWss, dedupeKnown) — network paths (search,
 * fetch, probe) are fail-open by construction and covered headless.
 * No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var ND = require("../vanilla/js/api/node-discover.js");
assert.ok(ND && typeof ND.run === "function", "run exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function eqArr(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* repoScore — wallet-ish names rank up. */
eq(ND.repoScore("foo/bitshares-ui") > ND.repoScore("foo/airdrop-allocator"), true, "wallet beats allocator");
eq(ND.repoScore("a/b"), 0, "no keywords -> 0");
eq(ND.repoScore(null), 0, "null -> 0");

/* extractWss — token shape only. */
eqArr(ND.extractWss('urls: ["wss://a.io/ws", "https://x"]'), ["wss://a.io/ws"], "picks wss only");
eqArr(ND.extractWss("wss://a.io/ws/"), ["wss://a.io/ws"], "trailing slash trimmed");
eqArr(ND.extractWss("wss://a.io/ws wss://a.io/ws"), ["wss://a.io/ws"], "deduped");
eqArr(ND.extractWss("wss://x"), [], "no dot rejected");
eqArr(ND.extractWss(""), [], "empty -> []");
eqArr(ND.extractWss(null), [], "null -> []");

/* dedupeKnown — known lists win. */
var known = { mainnet: ["wss://a/io"], testnet: [], customs: ["wss://c/io"] };
eqArr(ND.dedupeKnown(["wss://a/io", "wss://b/io", "wss://c/io"], known), ["wss://b/io"], "fresh only");
eqArr(ND.dedupeKnown([], known), [], "empty -> empty");

/* Bounds exported. */
eq(typeof ND.MAX_REPOS === "number" && typeof ND.MAX_FETCHES === "number", true, "budgets exported");

console.log("node-discover-test: " + passed + " passed, 0 failed");
