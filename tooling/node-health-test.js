/* node-health-test.js — unit vectors for the node-health upgrade
 * (latencyTEST.py signals, chain-native). Stdlib only:
 * `node tooling/node-health-test.js` (exit 0 = green). Covers Chain
 * participation/classify/enrich shaping (sdk/chain.js) + SettingsNodes
 * history helpers (settings-nodes.js, in-memory localStorage stub).
 * No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var Chain = require("../vanilla/js/sdk/chain.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* participationPct — uint128 recent_slots_filled bitcount /128*100. */
eq(Chain.participationPct("340282366920938463463374607431768211455"), 100, "all-ones u128 -> 100");
eq(Chain.participationPct("0"), 0, "zero -> 0");
eq(Chain.participationPct(255), 6.25, "0xFF number -> 8/128");
eq(Chain.participationPct("abc"), null, "garbage -> null");
eq(Chain.participationPct(null), null, "null -> null");
eq(Chain.participationPct(-5), null, "negative -> null");
eq(Chain.participationPct(1.5), null, "float -> null");
eq(Chain.participationPct("340282366920938463463374607431768211454"), 99.21875, "one-missing -> 127/128");

/* classifyHealth — latencyTEST buckets, documented bands. */
function st(h) { return Chain.classifyHealth(h).status; }
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1.2, participation: 99, irrevLag: 2 }), "GOOD", "healthy");
eq(st({ latencyMs: 300, chainOk: false }), "WRONG-CHAIN", "mismatch");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 45, participation: 99, irrevLag: 2 }), "STALE", "old head");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: null, participation: null, irrevLag: null }), "GOOD", "unknown enrichment still GOOD");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 60, irrevLag: 2 }), "FORKED", "low participation");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 99, irrevLag: 12 }), "GOOD", "observed healthy mainnet shape");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 99, irrevLag: 30 }), "GOOD", "lag 30 still normal");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 99, irrevLag: 31 }), "SUSPECT", "lag past 30 watches");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 90, irrevLag: 31 }), "SUSPECT", "soft part + lag watches");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 90, irrevLag: 101 }), "FORKED", "deep lag + soft part forks");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 99, irrevLag: 101 }), "SUSPECT", "deep lag but high part is contradictory");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 90, irrevLag: 2 }), "SUSPECT", "wobble band");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 95, irrevLag: 2 }), "GOOD", "boundary 95 good");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 80, irrevLag: 2 }), "SUSPECT", "boundary 80 suspect");
eq(st({ latencyMs: 300, chainOk: true, headAgeS: 1, participation: 79.9, irrevLag: 2 }), "FORKED", "below 80 forked");
eq(st(null), "WRONG-CHAIN", "null input fails closed on chain");
eq(st({}), "WRONG-CHAIN", "empty input fails closed on chain");

/* enrichProbe — shaping only (Date.now stubbed by construction tolerance). */
var e = Chain.enrichProbe("abc123", null, 250);
eq(e.chainId, "abc123", "chain id passes");
eq(e.latencyMs, 250, "latency passes");
eq(e.headBlock, null, "null props -> null head");
eq(e.participation, null, "null props -> null part");
var e2 = Chain.enrichProbe("abc", { head_block_number: 100, time: "2026-10-01T00:00:00", recent_slots_filled: "340282366920938463463374607431768211455", last_irreversible_block_num: 95 }, 100);
eq(e2.headBlock, 100, "head parsed");
eq(e2.participation, 100, "part parsed");
eq(e2.irrevLag, 5, "lag = head - irreversible");
eq(typeof e2.headAgeS === "number" && e2.headAgeS >= 0, true, "age non-negative number");

/* enrichProbe hasHistory (Phase 1): optional 4th param, old 3-arg shape false. */
eq(e.hasHistory, false, "omitted extra -> hasHistory false (backward compat)");
eq(e2.hasHistory, false, "omitted extra -> false on full props too");
var e3 = Chain.enrichProbe("abc", null, 10, {hasHistory: true});
eq(e3.hasHistory, true, "extra.hasHistory true passes");
var e4 = Chain.enrichProbe("abc", null, 10, {hasHistory: false});
eq(e4.hasHistory, false, "extra.hasHistory false passes");
var e5 = Chain.enrichProbe("abc", null, 10, {});
eq(e5.hasHistory, false, "empty extra -> false, never guessed");

/* SettingsNodes history — in-memory localStorage stub. */
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
var SN = require("../vanilla/js/settings-nodes.js");
var T = SN._test;
assert.ok(T && typeof T.pushSample === "function", "_test seam exported");
T.pushSample("wss://a", { ms: 100, age: 1, part: 99, status: "GOOD" });
T.pushSample("wss://a", { ms: 120, age: 2, part: 98, status: "GOOD" });
T.pushSample("wss://b", { ms: null, status: "DOWN" });
var lg = T.lastGood("wss://a");
eq(typeof lg.t === "number" && lg.ms, 120, "lastGood newest GOOD");
eq(T.lastGood("wss://b"), null, "no GOOD -> null");
eq(T.lastGood("wss://nope"), null, "unknown url -> null");
eq(T.agoMinutes(Date.now()), "just now", "fresh -> just now");
eq(typeof T.agoMinutes(Date.now() - 5 * 60000), "string", "5m ago string");
eq(T.agoMinutes(null), null, "null -> null");
for (var i = 0; i < 20; i++) T.pushSample("wss://c", { ms: i, status: "GOOD" });
eq(T.readHist()["wss://c"].length, 12, "history capped at 12");
delete global.localStorage;

console.log("node-health-test: " + passed + " passed, 0 failed");
