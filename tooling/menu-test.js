/* menu-test.js — sitemap single-home invariant + MenuUI pure helpers.
 * Stdlib only: `node tooling/menu-test.js` (exit 0 = green). No DOM, no network.
 */
"use strict";
var assert = require("assert");
global.Icon = undefined;
global.I18n = { t: function (k, d) { return d; } };
var MenuUI = require("../vanilla/js/views/menu-ui.js");
var passed = 0;
function eq(a, e, n) { assert.strictEqual(a, e, n + " (got " + JSON.stringify(a) + ")"); passed++; }
function ok(c, n) { assert.ok(c, n); passed++; }
eq(MenuUI.SECTIONS.length, 7, "seven sections");
eq(MenuUI._test.sectionSlugs().join(","), "wallet,trade,earn,govern,explore,labs,personal", "slug order");
var all = [];
MenuUI.SECTIONS.forEach(function (s) { s.links.forEach(function (l) { all.push(l.href); }); });
eq(all.length, 53, "53 listed pages");
eq(new Set(all).size, all.length, "no href listed twice (single-home)");
/* Trade lands on the selector ladder, not a desk (pair-context 2026-10-07:
 * both categories run category -> selector -> desk). #/market/:marketID stays
 * routable, it is simply no longer a navbar destination. */
["#/", "#/transfer", "#/markets", "#/samet", "#/barter", "#/spotlight",
 "#/direct-debit", "#/api-lab", "#/es-lab", "#/txbuilder", "#/ops", "#/top-ops",
 "#/registration", "#/voting", "#/explorer/fees", "#/news", "#/community", "#/about"].forEach(function (h) {
  ok(all.indexOf(h) !== -1, h + " listed");
});
eq(MenuUI._test.findSection("earn").links.length, 7, "earn has 7 links");
eq(MenuUI._test.findSection("trade").links.length, 8, "trade has 8 links (standalone Swap deleted)");
eq(MenuUI._test.findSection("labs").links.length, 4, "labs holds api-lab, es-lab, txbuilder + account-network");
eq(MenuUI._test.findSection("personal").links.length, 7, "personal holds the 7 chat/setup pages");
ok(all.indexOf("#/account-network") !== -1, "#/account-network listed");
eq(MenuUI._test.findSection("nope"), null, "unknown slug is null");
console.log("menu-test: " + passed + " passed");
