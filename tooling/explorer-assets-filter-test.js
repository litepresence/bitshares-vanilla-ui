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

/* 1. First paint defaults to all (non-selective — owner 2026-10-08). */
ok(SRC.indexOf('var assetState = { mode: "all"') !== -1,
  "assetState defaults to all on first paint");

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
ok(SRC.indexOf('assetState.mode = "market"') === -1 &&
   SRC.indexOf('assetState.mode = "all"') === -1,
  "no reset-to-a-mode on entry (mode survives page turns)");

/* 4. Unknown stored values clamp to all (pure helper, extracted like _parseHolders). */
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
eq(normalizeAssetMode("all"), "all", "all stays all");
eq(normalizeAssetMode("bogus"), "all", "unknown string clamps to all");
eq(normalizeAssetMode(undefined), "all", "undefined clamps to all");
eq(normalizeAssetMode(null), "all", "null clamps to all");
eq(normalizeAssetMode(""), "all", "empty clamps to all");
eq(normalizeAssetMode("MARKET"), "all", "wrong-case clamps to all");

/* 5. Honest Showing line above the table (keyed, never raw integers on screen). */
ok(SRC.indexOf('t("explorer.assets_showing", "Showing")') !== -1,
  "showing line uses explorer.assets_showing");
ok(SRC.indexOf('t("explorer.assets_of", "of")') !== -1,
  "showing line uses explorer.assets_of");
ok(SRC.indexOf('t("explorer.assets_mode_all", "All")') !== -1,
  "all mode label keyed");
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
  assets_mode_all: "All",
  assets_mode_market: "SmartCoins",
  assets_mode_user: "User-Issued",
  assets_mode_prediction: "Prediction",
  feeds_showing: "Showing",
  feeds_of: "of",
  feeds_scanned_suffix: "scanned (first 100 assets)"
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

/* 7. Feeds-tab honest count line (backlog-A): "Showing X of Y scanned
 * (first 100 assets)" above the feeds table — actual scanned rows vs shown
 * smartcoins (FEED_SCAN_PAGES=4 x 25 = first 100 list_assets), keyed
 * explorer.feeds_* in source + all 12 locale dicts, aria-live. */
var feedsAt = SRC.indexOf("function feedsTab(");
ok(feedsAt !== -1, "source contains feedsTab");
ok(SRC.indexOf('t("explorer.feeds_showing", "Showing")') > feedsAt,
  "feeds count line uses explorer.feeds_showing");
ok(SRC.indexOf('t("explorer.feeds_of", "of")') > feedsAt,
  "feeds count line uses explorer.feeds_of");
ok(SRC.indexOf('t("explorer.feeds_scanned_suffix", "scanned (first 100 assets)")') > feedsAt,
  "feeds count line uses explorer.feeds_scanned_suffix");
ok(/scanned\s*\+=/.test(SRC.slice(feedsAt)),
  "feeds scan accumulates the actual scanned row count");
ok(SRC.slice(feedsAt).indexOf("found.length") !== -1,
  "feeds count line uses the actual shown count");
ok(SRC.slice(feedsAt).indexOf("aria-live") !== -1,
  "feeds count line is aria-live");

console.log("explorer-assets-filter-test: PASS (" + passed + " checks)");
