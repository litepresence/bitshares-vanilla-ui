/* explorer-assets-filter-test.js — state vectors for the explorer assets
 * filter memory + honesty label (Polish Task 7).
 * Stdlib only: `node tooling/explorer-assets-filter-test.js` (exit 0 = green).
 * Covers: default mode market (first paint, today's behavior); session-memory
 * (module-level assetState, never localStorage — view state, not settings);
 * unknown stored values clamp to market; honest Showing line above the table
 * (keyed explorer.assets_* in source + all 12 locale dicts, en byte-identical).
 * explorer-assets.js cannot be required in node (module body touches
 * ExplorerRender at load), so pure helpers are extracted by brace-matching
 * (asset-holders-test.js precedent) and source/locale contracts are asserted
 * as strings. No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
}

var SRC = fs.readFileSync(
  path.join(__dirname, "..", "vanilla", "js", "views", "explorer-assets.js"), "utf8");

/* 1. First paint defaults to market (today's behavior — keep). */
ok(SRC.indexOf('var assetState = { mode: "market"') !== -1,
  "assetState defaults to market on first paint");

/* 2. Session-memory: module-level, never localStorage (view state, not settings). */
ok(SRC.indexOf("var assetState") !== -1, "assetState is module-level (session memory)");
ok(SRC.indexOf("localStorage.getItem") === -1 &&
   SRC.indexOf("localStorage.setItem") === -1 &&
   SRC.indexOf("localStorage.removeItem") === -1 &&
   SRC.indexOf("localStorage[") === -1,
  "filter mode never touches localStorage (view state, not settings)");

/* 3. Radio change persists the mode across re-renders (no reset on entry). */
ok(SRC.indexOf("assetState.mode = m[0]") !== -1 ||
   SRC.indexOf("assetState.mode = normalizeAssetMode") !== -1,
  "radio change writes assetState.mode (persists across re-renders)");
ok(SRC.indexOf('assetState.mode = "market"') === -1,
  "no reset-to-market on entry (mode survives page turns)");

/* 4. Unknown stored values clamp to market (pure helper, extracted like _parseHolders). */
var MARKER = "function normalizeAssetMode(m) {";
var start = SRC.indexOf(MARKER);
ok(start !== -1, "source contains normalizeAssetMode (clamps unknown modes)");
var depth = 0;
var end = -1;
for (var j = start; j < SRC.length; j++) {
  var ch = SRC.charAt(j);
  if (ch === "{") depth++;
  else if (ch === "}") {
    depth--;
    if (depth === 0) { end = j + 1; break; }
  }
}
ok(end !== -1, "normalizeAssetMode brace-match closes");
/* eslint-disable no-eval */
var normalizeAssetMode = eval("(" + SRC.slice(start, end) + ")");
/* eslint-enable no-eval */
ok(typeof normalizeAssetMode === "function", "extracted normalizeAssetMode is a function");
eq(normalizeAssetMode("market"), "market", "market stays market");
eq(normalizeAssetMode("user"), "user", "user stays user");
eq(normalizeAssetMode("prediction"), "prediction", "prediction stays prediction");
eq(normalizeAssetMode("bogus"), "market", "unknown string clamps to market");
eq(normalizeAssetMode(undefined), "market", "undefined clamps to market");
eq(normalizeAssetMode(null), "market", "null clamps to market");
eq(normalizeAssetMode(""), "market", "empty clamps to market");
eq(normalizeAssetMode("MARKET"), "market", "wrong-case clamps to market");

/* 5. Honest Showing line above the table (keyed, never raw integers on screen). */
ok(SRC.indexOf('t("explorer.assets_showing", "Showing")') !== -1,
  "showing line uses explorer.assets_showing");
ok(SRC.indexOf('t("explorer.assets_of", "of")') !== -1,
  "showing line uses explorer.assets_of");
ok(SRC.indexOf('t("explorer.assets_mode_market", "SmartCoins")') !== -1,
  "market mode label keyed");
ok(SRC.indexOf('t("explorer.assets_mode_user", "User-Issued")') !== -1,
  "user mode label keyed");
ok(SRC.indexOf('t("explorer.assets_mode_prediction", "Prediction")') !== -1,
  "prediction mode label keyed");
ok(SRC.indexOf("aria-live") !== -1, "showing line is aria-live");

/* 6. Locale contracts: all 12 dicts carry the 5 keys; en byte-identical. */
var NEW_KEYS = {
  assets_showing: "Showing",
  assets_of: "of",
  assets_mode_market: "SmartCoins",
  assets_mode_user: "User-Issued",
  assets_mode_prediction: "Prediction"
};
["en", "es", "de", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"].forEach(function (code) {
  var d = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "vanilla", "locales", code + ".json"), "utf8"));
  Object.keys(NEW_KEYS).forEach(function (k) {
    ok(typeof d.explorer[k] === "string" && d.explorer[k], code + ".json explorer." + k + " present");
    if (code === "en") eq(d.explorer[k], NEW_KEYS[k], "en.json explorer." + k + " byte-identical");
  });
});
var en = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "vanilla", "locales", "en.json"), "utf8"));
Object.keys(NEW_KEYS).forEach(function (k) {
  ok(en._meta.translated.indexOf("explorer." + k) !== -1, "en _meta.translated lists explorer." + k);
});

console.log("explorer-assets-filter-test: PASS (" + passed + " checks)");
