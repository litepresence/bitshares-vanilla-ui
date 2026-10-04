#!/usr/bin/env node
/* market-deeplink-test.js — unit vectors for desk deep-link state
 * (vanilla/js/views/market-desk.js readDeskQuery/buildDeskQuery/syncUrl).
 * Stdlib only: `node tooling/market-deeplink-test.js` (exit 0 = green).
 * No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var MarketDesk = require("../vanilla/js/views/market-desk.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var T = MarketDesk._test;
assert.ok(T && typeof T.readDeskQuery === "function", "readDeskQuery exported");
assert.ok(typeof T.buildDeskQuery === "function", "buildDeskQuery exported");
assert.ok(typeof MarketDesk.syncUrl === "function", "syncUrl exported");

var IND = {
  OVERLAY_DEFS: [["sma", null], ["ema", null], ["bb", null]],
  OSC_ORDER: [["rsi", "RSI"], ["macd", "MACD"]]
};

/* readDeskQuery — defaults on empty/garbage, validated seeds otherwise. */
var d = T.readDeskQuery(null, IND);
eq(d.bucket, 3600, "null query -> default bucket");
eq(d.over, {}, "null query -> no overlays");
eq(d.showPoolMap, true, "pool map defaults on");
eq(d.tradesTab, "recent", "trades default recent");
eq(d.groupDec, null, "group default null");

d = T.readDeskQuery({ tf: "900", over: "sma,ema", osc: "rsi,macd,bogus", log: "1", vwap: "1", pmap: "0", dx: "0", trades: "my", group: "8" }, IND);
eq(d.bucket, 900, "tf parses");
eq(Object.keys(d.over).sort(), ["ema", "sma"], "over keys kept");
eq(Object.keys(d.osc).sort(), ["macd", "rsi"], "osc kept, bogus dropped");
eq(d.logScale, true, "log flag");
eq(d.showVwap, true, "vwap flag");
eq(d.showPoolMap, false, "pmap=0 disables");
eq(d.depthLogX, false, "dx=0 disables");
eq(d.depthLogY, true, "dy default stands");
eq(d.tradesTab, "my", "trades my");
eq(d.groupDec, 8, "group 8");

d = T.readDeskQuery({ tf: "abc", over: "sma,!!!,sma", osc: "", log: "yes", trades: "all", group: "3" }, IND);
eq(d.bucket, 3600, "bad tf -> default");
eq(Object.keys(d.over), ["sma"], "bad keys dropped, dupes collapsed");
eq(d.logScale, false, "bad flag -> default");
eq(d.tradesTab, "recent", "bad trades -> default");
eq(d.groupDec, null, "bad group -> default");

d = T.readDeskQuery({ over: "sma" }, null);
eq(d.over, {}, "no MarketInd -> lists dropped, never throws");

/* buildDeskQuery — sparse output, defaults vanish. */
eq(T.buildDeskQuery({}), "", "empty state -> empty query");
eq(T.buildDeskQuery({ bucket: 3600, over: {}, osc: {}, showPoolMap: true, depthLogX: true, depthLogY: true }), "", "all-default -> empty");
var q = T.buildDeskQuery({ bucket: 900, over: { sma: [{}], bogus: [] }, osc: { rsi: true, nope: false }, logScale: true, showVwap: true, showPoolMap: false, depthLogX: false, tradesTab: "my", groupDec: 6 });
eq(q, "?tf=900&over=sma&osc=rsi&log=1&vwap=1&pmap=0&dx=0&trades=my&group=6", "non-defaults serialize");

/* Round-trip: build -> read restores the desk. */
var rt = T.readDeskQuery({ tf: "300", over: "bb", osc: "macd", depth: "1" }, IND);
eq(T.buildDeskQuery({ bucket: rt.bucket, over: rt.over, osc: rt.osc, showDepth: rt.showDepth, showPoolMap: rt.showPoolMap, depthLogX: rt.depthLogX, depthLogY: rt.depthLogY }), "?tf=300&over=bb&osc=macd&depth=1", "round-trip stable");

/* syncUrl — replaceState only, never throws without DOM/history. */
MarketDesk.syncUrl(null);
MarketDesk.syncUrl({});
console.log("PASS syncUrl no-DOM no-throw");

console.log("market-deeplink-test: " + passed + " passed, 0 failed");
