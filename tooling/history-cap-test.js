/* history-cap-test.js — unit vectors for HistoryCap gates (Phase 1).
 * Stdlib only: `node tooling/history-cap-test.js` (exit 0 = green).
 * Covers ES_BASE canonical host, snapshot shape, nodeHistory fallback
 * (live > snapshot > null), historyHere/esAllowed gating with stubbed
 * globals, esSearch allowlist/disabled paths + recordEs outcomes.
 * No network (fetch stubbed), no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var Cap = require("../vanilla/js/api/history-cap.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* Canonical host + allowlist (must match help-ui.js link help.link_es_api). */
eq(Cap.ES_BASE, "https://es.bitshares.dev", "ES_BASE is the help-listed host");
eq(Cap.ES_INDEXES.indexOf("bitshares-*") !== -1, true, "ops index allowlisted");
eq(Cap.ES_INDEXES.indexOf("objects-balance") !== -1, true, "balance index allowlisted");
eq(Cap.ES_INDEXES.indexOf("kibana") === -1, true, "no kibana-shaped index");

/* Snapshot: dated, 9 sweep URLs, all true. */
eq(Cap.HIST_SNAPSHOT.date, "2026-10-02", "snapshot dated to sweep");
eq(Object.keys(Cap.HIST_SNAPSHOT.urls).length, 9, "snapshot covers 9 probed nodes");
eq(Cap.HIST_SNAPSHOT.urls["wss://api.bitshares.dev/ws"], true, "mainnet snapshot true");
eq(Cap.HIST_SNAPSHOT.urls["wss://testnet.xbts.io/ws"], true, "testnet snapshot true");

/* nodeHistory: snapshot hit, unknown null, live wins. */
eq(Cap.nodeHistory("wss://api.bitshares.dev/ws"), true, "snapshot hit");
eq(Cap.nodeHistory("wss://unknown.example/ws"), null, "unknown url is null, never guessed");
eq(Cap.nodeHistory(""), null, "empty url is null");
Cap.update("wss://unknown.example/ws", true);
eq(Cap.nodeHistory("wss://unknown.example/ws"), true, "live update recorded");
Cap.update("wss://api.bitshares.dev/ws", false);
eq(Cap.nodeHistory("wss://api.bitshares.dev/ws"), false, "live overrides snapshot");
Cap.update("wss://api.bitshares.dev/ws", true);
Cap.update("wss://unknown.example/ws", false);
eq(Cap.nodeHistory("wss://unknown.example/ws"), false, "live false recorded");

/* historyHere: Chain stub true/false, missing Chain fails closed. */
global.Chain = {hasHistory: function () { return true; }};
eq(Cap.historyHere(), true, "active history reads true");
global.Chain = {hasHistory: function () { return false; }};
eq(Cap.historyHere(), false, "missing history reads false");
delete global.Chain;
eq(Cap.historyHere(), false, "missing Chain fails closed");

/* esAllowed: default ON (missing Store fails open), explicit false opts out. */
delete global.Store;
eq(Cap.esAllowed(), true, "missing Store defaults ON");
global.Store = {loadSettings: function () { return {}; }};
eq(Cap.esAllowed(), true, "missing key defaults ON");
global.Store = {loadSettings: function () { return {esEnabled: false}; }};
eq(Cap.esAllowed(), false, "explicit false opts out");
global.Store = {loadSettings: function () { return {esEnabled: true}; }};
eq(Cap.esAllowed(), true, "explicit true stays on");

/* esSearch gating: disabled fires no fetch; bad index fires no fetch.
 * (fetch fires synchronously inside esSearch, so the counter asserts inline —
 * a bypass would already have incremented before the promise settles.) */
var fetchCalls = 0;
global.fetch = function () { fetchCalls++; return Promise.reject(new Error("must not fire")); };
global.Store = {loadSettings: function () { return {esEnabled: false}; }};
var asyncTests = [];
var pDisabled = Cap.esSearch("bitshares-*", {size: 1});
eq(fetchCalls, 0, "disabled ES fires no fetch");
asyncTests.push(pDisabled.then(function () {
  throw new Error("disabled search resolved");
}, function (e) {
  eq(e.message, "es-disabled", "disabled ES rejects before fetch");
}));
global.Store = {loadSettings: function () { return {esEnabled: true}; }};
var pBadIdx = Cap.esSearch("evil-index", {size: 1});
eq(fetchCalls, 0, "bad index fires no fetch");
asyncTests.push(pBadIdx.then(function () {
  throw new Error("bad index resolved");
}, function (e) {
  eq(e.message, "es-bad-index", "non-allowlisted index rejected");
}));

/* esSearch paths: success records true, then failure records false.
 * Sequenced (not parallel): both record into one cache, so the failure leg
 * runs only after the success leg settles — deterministic order. */
global.fetch = function () {
  fetchCalls++;
  return Promise.resolve({ok: true, json: function () { return Promise.resolve({hits: {hits: []}}); }});
};
asyncTests.push(Cap.esSearch("objects-balance", {size: 5}).then(function (j) {
  eq(Array.isArray(j.hits.hits), true, "success returns parsed JSON");
  eq(Cap.esLastOk(), true, "success recorded");
  global.fetch = function () { fetchCalls++; return Promise.reject(new Error("down")); };
  return Cap.esSearch("bitshares-*", {size: 1}).then(function () {
    throw new Error("failed fetch resolved");
  }, function (e) {
    eq(e.message, "es-unavailable", "failed fetch maps to es-unavailable");
    eq(Cap.esLastOk(), false, "failure recorded");
  });
}));
delete global.fetch;
delete global.Store;

Promise.all(asyncTests).then(function () {
  eq(Cap.esLastOk() !== null, true, "availability recorded after attempts");
  console.log("history-cap-test: " + passed + " passed, 0 failed");
}, function (e) {
  console.error("history-cap-test FAILED: " + (e && e.message));
  process.exit(1);
});
