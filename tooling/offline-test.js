#!/usr/bin/env node
/* offline-test.js — connectivity-transition unit tests for vanilla/js/api/offline.js.
 *
 * What it owns: asserts for state() (chain-state peek incl. unreadable ->
 *   "unknown"), nodeUrl() (active-node read incl. missing/throwing store ->
 *   null), and ensure()/reconnect() online<->offline transitions driven by a
 *   fake socket (Chain.status states + Chain.connect thenable), covering the
 *   open/connecting no-attempt exits, the throttle window, consecutive-failure
 *   counting (failsFor), success clearing, and the never-throw/never-promise
 *   ensure() contract. Pure-logic vectors only: no network, deterministic
 *   (Date.now stubbed). Stdlib `assert` only.
 * Consumes: vanilla/js/api/offline.js via require (module.exports = Offline).
 *   Globals Chain/Store are minimal fakes set per-vector and restored after.
 * Side effects: none beyond temporary globals + Date.now stub (both restored;
 *   prints one summary line, exit 0 = green / 1 = red).
 * Created by: R-B-T1 new-unit-suites round.
 */
"use strict";
var assert = require("assert");
var Offline = require("../vanilla/js/api/offline.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* Controllable clock: reconnect() throttles within 3000 ms of the last try. */
var realNow = Date.now;
var nowMs = 1000000000000;
Date.now = function () { return nowMs; };
function advance(ms) { nowMs += ms; }

/* Fake socket: state string + connect thenable with captured callbacks. */
var chainState = "closed";
var connectCalls = [];
var captured = [];
function fakeConnect(url) {
  connectCalls.push(url);
  var th = { then: function (a, b) { captured.push({ ok: a, bad: b }); } };
  return th;
}
function setChain(state) {
  chainState = state;
  global.Chain = {
    status: function () { return { state: chainState }; },
    connect: fakeConnect
  };
}
function setStore(node) {
  global.Store = {
    loadSettings: function () { return { activeNode: node }; },
    subscribe: function () {}
  };
}
function cleanGlobals() {
  delete global.Chain;
  delete global.Store;
}

/* 1-5: state() peek incl. hostile shapes. */
cleanGlobals();
setChain("open");
eq(Offline.state(), "open", "state open when socket open");
setChain("connecting");
eq(Offline.state(), "connecting", "state connecting mid-handshake");
cleanGlobals();
eq(Offline.state(), "unknown", "state unknown when Chain missing");
global.Chain = { status: function () { throw new Error("dead"); } };
eq(Offline.state(), "unknown", "state unknown when status throws");
global.Chain = { status: function () { return {}; } };
eq(Offline.state(), "unknown", "state unknown when status has no state");

/* 6-9: nodeUrl() active-node read. */
cleanGlobals();
setChain("closed");
setStore("wss://node.example/ws");
eq(Offline.nodeUrl(), "wss://node.example/ws", "nodeUrl returns active node");
setStore("");
eq(Offline.nodeUrl(), null, "nodeUrl null on empty activeNode");
cleanGlobals();
setChain("closed");
eq(Offline.nodeUrl(), null, "nodeUrl null when Store missing");
global.Store = { loadSettings: function () { throw new Error("locked"); } };
eq(Offline.nodeUrl(), null, "nodeUrl null when settings throw");

/* 10-13: online states never attempt (null), offline attempts. */
cleanGlobals();
setChain("open");
setStore("wss://node.example/ws");
connectCalls = [];
eq(Offline.reconnect(), null, "reconnect null while open (online exit)");
eq(connectCalls.length, 0, "no connect call while open");
setChain("connecting");
eq(Offline.reconnect(), null, "reconnect null while connecting");
setChain("closed");
var attempt = Offline.reconnect();
assert.ok(attempt && typeof attempt.then === "function", "reconnect returns the connect promise while offline");
passed++;
eq(connectCalls.length, 1, "one connect call against the active node");
eq(connectCalls[0], "wss://node.example/ws", "connect targets the active node URL");

/* 14-15: throttle window suppresses a second immediate attempt. */
eq(Offline.reconnect(), null, "reconnect throttled within 3000ms");
advance(3001);
var attempt2 = Offline.reconnect();
assert.ok(attempt2 && typeof attempt2.then === "function", "reconnect attempts again past the throttle window");
passed++;
eq(connectCalls.length, 2, "second connect call after throttle expiry");

/* 16-18: failure counting (failsFor) + success clearing. */
eq(Offline.failsFor("wss://node.example/ws"), 0, "failsFor zero before any outcome");
captured[captured.length - 1].bad();
eq(Offline.failsFor("wss://node.example/ws"), 1, "failsFor one after rejected handshake");
advance(4000);
Offline.reconnect();
captured[captured.length - 1].ok();
eq(Offline.failsFor("wss://node.example/ws"), 0, "failsFor cleared after successful handshake");

/* 19-21: no-URL / no-connect / ensure() contract. */
cleanGlobals();
setChain("closed");
setStore("");
connectCalls = [];
advance(4000);
eq(Offline.reconnect(), null, "reconnect null with no node URL");
cleanGlobals();
setChain("closed");
global.Chain = { status: function () { return { state: "closed" }; } };
global.Store = { loadSettings: function () { return { activeNode: "wss://x/ws" }; }, subscribe: function () {} };
eq(Offline.reconnect(), null, "reconnect null when Chain.connect missing");
var ensured = Offline.ensure();
eq(ensured, undefined, "ensure returns undefined (fire-and-forget, no promise to handle)");

/* 22: ensure() never throws even with every global hostile. */
cleanGlobals();
var threw = false;
try { Offline.ensure(); } catch (e) { threw = true; }
eq(threw, false, "ensure never throws with no globals at all");

cleanGlobals();
Date.now = realNow;
console.log("offline: " + passed + " passed, 0 failed");
