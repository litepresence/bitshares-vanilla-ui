/* explorer-assets-search-test.js — the assets-tab search must reach the chain.
 *
 * Regression: the symbol filter ran client-side over the single loaded page
 * (25 rows from ""), so any symbol past page 1 — e.g. BTS — matched nothing
 * ("No assets on this page" for searches that should show up). With a query
 * present the tab must fetch a chain prefix page via list_assets (the #4
 * prefix-paging primitive, database_api.hpp:435) instead of filtering the
 * cached browse page.
 * Stdlib only: `node tooling/explorer-assets-search-test.js` (exit 0 = green).
 * explorer-assets.js cannot be required in node (module body touches
 * ExplorerRender at load), so the pure helper is extracted by
 * brace-matching (explorer-assets-filter-test.js precedent) and the wiring
 * is asserted as source contracts. No network, no DOM, no deps.
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

/* 1. Pure prefix-bound helper, extracted like normalizeAssetMode. */
var MARKER = "function searchLowerBound(q) {";
var start = SRC.indexOf(MARKER);
ok(start !== -1, "source contains searchLowerBound (chain prefix bound)");
var depth = 0, end = -1;
for (var j = start; j < SRC.length; j++) {
  var ch = SRC.charAt(j);
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
}
ok(end !== -1, "searchLowerBound brace-match closes");
/* eslint-disable no-eval */
var searchLowerBound = eval("(" + SRC.slice(start, end) + ")");
/* eslint-enable no-eval */
ok(typeof searchLowerBound === "function", "extracted searchLowerBound is a function");

/* Symbols are UPPERCASE on chain: the bound uppercases so a lowercase
 * query sorts onto its prefix instead of past every symbol (suggestAssets
 * in explorer.js documents the same ASCII rule). Blank stays blank. */
eq(searchLowerBound("bts"), "BTS", "lowercase query uppercases to its prefix");
eq(searchLowerBound("  BTS.X  "), "BTS.X", "trims before bounding");
eq(searchLowerBound(""), "", "blank query means browse (no bound)");
eq(searchLowerBound("   "), "", "whitespace-only means browse");
eq(searchLowerBound(null), "", "null means browse");
eq(searchLowerBound(undefined), "", "undefined means browse");

/* 2. Wiring contracts: a non-empty query fetches from the chain bound,
 * never the stale browse page. */
ok(SRC.indexOf("searchLowerBound(assetState.q)") !== -1,
  "assetsTab derives the fetch bound from the live query");
ok(/assetsPage\(\s*fetchLower|assetsPage\(\s*bound/.test(SRC),
  "assetsPage fetches from the derived bound (prefix page on search)");

/* 3. Pager honesty: browse paging continues from browse lowers only — the
 * search page is one honest prefix page (accounts-tab precedent), so Next
 * must not continue from a search page into unrelated alphabet. */
ok(/searching\s*\?\s*[^:]*:\s*[^;]*|if\s*\(\s*!searching/.test(SRC),
  "pager branches on search mode (no browse-continuation from a search page)");

/* 4. The empty state names the query in search mode (never the browse hint). */
ok(SRC.indexOf("explorer.no_assets_match") !== -1,
  "search-mode empty names the query (keyed explorer.no_assets_match)");

console.log("explorer-assets-search: " + passed + " passed");
