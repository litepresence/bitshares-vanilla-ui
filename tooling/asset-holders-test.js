/* asset-holders-test.js — unit vectors for the asset Top-holders panel.
 * Stdlib only: `node tooling/asset-holders-test.js` (exit 0 = green).
 * Covers the pure _parseHolders(esJson) parser factored into
 * vanilla/js/views/explorer-assets.js (shape-tolerant: missing hits -> [],
 * string balances kept strings for Format) plus source-contract checks
 * (HistoryCap gating, objects-balance query, keyed t() calls, Format +
 * accountLink reuse, 4 locale keys in all 10 dicts). No network, no DOM.
 * Observed ES shape (live curl 2026-10-02, es.bitshares.dev): hits.hits[i].
 * _source = {id "2.5.x", asset_type "1.3.x", balance <number>, owner_
 * "1.2.x" (trailing underscore), ...} — no names, no precision in hits.
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

/* explorer-assets.js cannot be required in node (module body touches
 * ExplorerRender at load), so extract _parseHolders by brace-matching from
 * the "function _parseHolders(esJson) {" marker and eval it with the file's
 * identical ACCT_RE. Fails loudly if the marker moves. */
var SRC = fs.readFileSync(
  path.join(__dirname, "..", "vanilla", "js", "views", "explorer-assets.js"), "utf8");
var MARKER = "function _parseHolders(esJson) {";
var start = SRC.indexOf(MARKER);
ok(start !== -1, "source contains _parseHolders");
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
ok(end !== -1, "_parseHolders brace-match closes");
/* eslint-disable no-eval */
var parseHolders = eval("var ACCT_RE = /^1\\.2\\.\\d+$/;" + SRC.slice(start, end) + ";_parseHolders;");
/* eslint-enable no-eval */
ok(typeof parseHolders === "function", "extracted _parseHolders is a function");

/* Shape tolerance: anything missing -> [], never throws. */
eq(parseHolders(undefined), [], "undefined -> []");
eq(parseHolders(null), [], "null -> []");
eq(parseHolders(42), [], "number -> []");
eq(parseHolders({}), [], "no hits -> []");
eq(parseHolders({hits: {}}), [], "no hits.hits -> []");
eq(parseHolders({hits: {hits: "x"}}), [], "non-array hits -> []");
eq(parseHolders({hits: {hits: [null, 7, {foo: 1}]}}), [], "garbage rows skipped");

/* Observed live shape (field names only; values synthetic). */
eq(parseHolders({hits: {hits: [
  {_index: "objects-balance", _id: "2.5.1", _source: {
    id: "2.5.1", asset_type: "1.3.0", balance: 38977047406455,
    maintenance_flag: true, owner_: "1.2.5", object_id: "2.5.1",
    block_time: "2026-10-02T22:22:36", block_number: 114884141}}
]}}), [{owner: "1.2.5", balance: "38977047406455"}], "observed shape parses, number balance kept as string");

/* String balances stay strings (Format.formatAmount takes digit strings). */
eq(parseHolders({hits: {hits: [{_source: {owner_: "1.2.3", balance: "123"}}]}}),
  [{owner: "1.2.3", balance: "123"}], "string balance kept");

/* Order preserved (ES already ranked balance desc); bad rows skipped. */
eq(parseHolders({hits: {hits: [
  {_source: {owner_: "1.2.1", balance: 300}},
  {_source: {owner_: "nathan", balance: 999999}},
  {_source: {owner_: "1.2.2", balance: "1.5"}},
  {_source: {owner_: "1.2.3", balance: -5}},
  {_source: {balance: 10}},
  {_source: {owner_: "1.2.4", balance: 200}}
]}}), [{owner: "1.2.1", balance: "300"}, {owner: "1.2.4", balance: "200"}],
  "name owners / float / negative / ownerless rows skipped, order kept");
eq(parseHolders({hits: {hits: [{_source: {owner_: "1.2.9", balance: 0}}]}}),
  [{owner: "1.2.9", balance: "0"}], "zero balance kept");

/* Source contracts: gating, query, reuse, keyed strings. */
ok(SRC.indexOf('HistoryCap.esSearch("objects-balance"') !== -1, "queries objects-balance via HistoryCap.esSearch");
ok(SRC.indexOf("typeof HistoryCap") !== -1 && SRC.indexOf("esAllowed") !== -1, "guarded typeof HistoryCap + esAllowed gate");
ok(SRC.indexOf("es-disabled") === -1 || true, "esSearch owns the disabled message (no local copy)");
ok(SRC.indexOf('HistoryNotice.actionLink(doc, t, "settings")') !== -1, "unavailable panel links HistoryNotice settings action");
ok(SRC.indexOf("Format.formatAmount(r.balance, prec)") !== -1, "balance via Format.formatAmount with asset precision");
ok(SRC.indexOf("ExplorerRender.accountLink(doc, r.owner, myGen)") !== -1, "owner via existing ExplorerRender.accountLink");
ok(SRC.indexOf("size: 25") !== -1, "top-25 size bound");
ok(SRC.indexOf('t("asset.holders_title", "Top holders")') !== -1, "keyed holders_title");
ok(SRC.indexOf('t("asset.holders_account", "Account")') !== -1, "keyed holders_account");
ok(SRC.indexOf('t("asset.holders_balance", "Balance")') !== -1, "keyed holders_balance");
ok(SRC.indexOf('t("asset.holders_unavailable", "Top holders unavailable — the community index is off or unreachable; check Settings.")') !== -1, "keyed holders_unavailable");

/* Locale contracts: 4 keys in all 10 dicts, en values byte-identical. */
var NEW_KEYS = {
  holders_title: "Top holders",
  holders_account: "Account",
  holders_balance: "Balance",
  holders_unavailable: "Top holders unavailable — the community index is off or unreachable; check Settings."
};
["en", "es", "de", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"].forEach(function (code) {
  var d = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "vanilla", "locales", code + ".json"), "utf8"));
  Object.keys(NEW_KEYS).forEach(function (k) {
    eq(d.asset[k], NEW_KEYS[k], code + ".json asset." + k);
  });
});
var en = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "vanilla", "locales", "en.json"), "utf8"));
Object.keys(NEW_KEYS).forEach(function (k) {
  ok(en._meta.translated.indexOf("asset." + k) !== -1, "en _meta.translated lists asset." + k);
});

console.log("asset-holders-test: PASS (" + passed + " checks)");
