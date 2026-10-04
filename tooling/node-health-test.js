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

/* enrichProbe pingMs (Handshake/Ping columns): optional extra field,
 * omitted/garbage -> null, never guessed. */
eq(Chain.enrichProbe("abc", null, 10).pingMs, null, "omitted extra -> pingMs null");
eq(e2.pingMs, null, "omitted extra -> null on full props too");
eq(Chain.enrichProbe("abc", null, 10, {pingMs: 42}).pingMs, 42, "extra.pingMs passes");
eq(Chain.enrichProbe("abc", null, 10, {pingMs: 0}).pingMs, 0, "zero ping passes");
eq(Chain.enrichProbe("abc", null, 10, {pingMs: -1}).pingMs, null, "negative ping -> null");
eq(Chain.enrichProbe("abc", null, 10, {pingMs: "42"}).pingMs, null, "string ping -> null, never guessed");
eq(Chain.enrichProbe("abc", null, 10, {hasHistory: true, pingMs: 7}).hasHistory, true, "pingMs rides alongside hasHistory");

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

/* histInfo — pure cell content (own History column: bare YES / NO). */
function tk(k, d) { return d; }
eq(SN._test.histInfo(tk, true).text, "YES", "true -> 'YES'");
eq(SN._test.histInfo(tk, false).text, "NO", "false -> 'NO'");
eq(SN._test.histInfo(tk, null).text, "", "null -> empty, never '?'");
eq(SN._test.histInfo(tk, undefined).text, "", "undefined -> empty");
eq(SN._test.histInfo(tk, true).cls, "node-history yes", "yes class");
eq(SN._test.histInfo(tk, false).cls, "node-history no", "no class");
eq(SN._test.histInfo(null, true).text, "", "throwing t -> empty, never throws");

/* latencyText — pure latency-cell content (age appended in the cell).
 * Unit lives in the keyed settings.age_s template ("%(n)ss"), substituted
 * by split/join (the injected settings t drops vars); the " · " separator
 * is layout-owned, so a missing age leaves latency bare, never dangling. */
function tl(k, d) { return d; }
eq(SN._test.latencyText(tl, 123, 1.2), "123ms · 1.2s", "ms + age");
eq(SN._test.latencyText(tl, 123, undefined), "123ms", "missing age -> latency only");
eq(SN._test.latencyText(tl, 123, null), "123ms", "null age -> latency only");
eq(SN._test.latencyText(tl, 123, NaN), "123ms", "NaN age -> latency only, no dangling separator");
eq(SN._test.latencyText(tl, 123, "1.2"), "123ms", "string age -> latency only");
eq(SN._test.latencyText(tl, 87, 1.26), "87ms · 1.3s", "age toFixed(1) rounding");
eq(SN._test.latencyText(tl, 87, 0), "87ms · 0.0s", "zero age still shown");
eq(SN._test.latencyText(function () { return "%(n)s sec"; }, 50, 2), "50ms · 2.0 sec", "translated template owns the unit");
eq(SN._test.latencyText(null, 50, 2), "50ms", "throwing t -> latency only, never throws");

/* pingText / partText — pure Ping + Participation cell content. */
function tp(k, d) { return d; }
eq(SN._test.pingText(tp, 45), "45ms", "ping number");
eq(SN._test.pingText(tp, 45.6), "46ms", "ping rounds");
eq(SN._test.pingText(tp, 0), "0ms", "zero ping stands");
eq(SN._test.pingText(tp, null), "—", "null ping -> dash");
eq(SN._test.pingText(tp, -1), "—", "negative ping -> dash");
eq(SN._test.pingText(tp, "45"), "—", "string ping -> dash, never guessed");
eq(SN._test.pingText(null, null), "—", "throwing t -> dash, never throws");
eq(SN._test.partText(tp, 99.21875), "99.2%", "participation one decimal");
eq(SN._test.partText(tp, 100), "100.0%", "participation 100");
eq(SN._test.partText(tp, 0), "0.0%", "zero participation stands");
eq(SN._test.partText(tp, null), "—", "null part -> dash");
eq(SN._test.partText(tp, NaN), "—", "NaN part -> dash");
eq(SN._test.partText(tp, "99"), "—", "string part -> dash, never guessed");
eq(SN._test.partText(null, 50), "50.0%", "value stands without t");

/* headText — pure head-age cell content (split from the handshake cell). */
function th(k, d) {
  return String(d).split("%(n)s").join("1.0");
}
eq(SN._test.headText(tl, 1.26), "1.3s", "age rounds to 0.1s");
eq(SN._test.headText(tl, 0), "0.0s", "zero age stands");
eq(SN._test.headText(tl, null), "—", "null age -> dash");
eq(SN._test.headText(tl, NaN), "—", "NaN age -> dash");
eq(SN._test.headText(tl, "1.2"), "—", "string age -> dash, never guessed");
eq(SN._test.headText(null, null), "—", "throwing t -> dash, never throws");
eq(SN._test.headText(th, 5), "1.0s", "translated template owns the unit");

/* geoText / provText — pure Location + Provider cell content. */
eq(SN._test.geoText(tl, "Frankfurt, Hesse"), "Frankfurt, Hesse", "label verbatim");
eq(SN._test.geoText(tl, null), "—", "null label -> dash");
eq(SN._test.geoText(tl, ""), "—", "empty label -> dash");
eq(SN._test.geoText(null, null), "—", "throwing t -> dash, never throws");
eq(SN._test.provText(tl, "Hetzner Online GmbH"), "Hetzner Online GmbH", "name verbatim, never prettified");
eq(SN._test.provText(tl, null), "—", "null provider -> dash");
eq(SN._test.provText(tl, ""), "—", "empty provider -> dash");
eq(SN._test.provText(null, null), "—", "throwing t -> dash, never throws");

/* healthFor — per-cell signal bands (good/warn/bad/""). */
var hf = SN._test.healthFor;
eq(hf("ping", 45), "good", "ping <100 green");
eq(hf("ping", 100), "warn", "ping boundary 100 yellow");
eq(hf("ping", 400), "warn", "ping boundary 400 yellow");
eq(hf("ping", 401), "bad", "ping slow red");
eq(hf("ping", null), "", "null ping uncolored");
eq(hf("hs", 800), "good", "handshake <1s green");
eq(hf("hs", 3000), "warn", "handshake 3s yellow");
eq(hf("hs", 3001), "bad", "handshake over 3s red");
eq(hf("part", 99), "good", "participation high green");
eq(hf("part", 80), "warn", "participation 80 yellow");
eq(hf("part", 79.9), "bad", "participation low red");
eq(hf("head", 5), "good", "fresh head green");
eq(hf("head", 30), "warn", "head 30s yellow");
eq(hf("head", 31), "bad", "stale head red");
eq(hf("chain", null, { network: "mainnet", match: true }), "good", "mainnet match green");
eq(hf("chain", null, { network: "testnet", match: true }), "warn", "testnet match always yellow");
eq(hf("chain", null, { network: "mainnet", match: false }), "bad", "mismatch red");
eq(hf("chain", null, {}), "bad", "no match red");
eq(hf("hist", true), "good", "YES green");
eq(hf("hist", false), "warn", "NO yellow");
eq(hf("hist", null), "", "unknown history uncolored");
eq(hf("nope", 1), "", "unknown kind uncolored, never throws");

/* histInfo carries its signal verdict for the data-h paint. */
eq(SN._test.histInfo(tk, true).h, "good", "YES verdict good");
eq(SN._test.histInfo(tk, false).h, "warn", "NO verdict warn");
eq(SN._test.histInfo(tk, null).h, "", "unknown verdict empty");

console.log("node-health-test: " + passed + " passed, 0 failed");
