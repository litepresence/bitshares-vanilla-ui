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
eq(MenuUI.SECTIONS.length, 6, "six sections");
eq(MenuUI._test.sectionSlugs().join(","), "wallet,trade,earn,govern,explore,labs", "slug order");
var all = [];
MenuUI.SECTIONS.forEach(function (s) { s.links.forEach(function (l) { all.push(l.href); }); });
eq(all.length, 53, "53 listed pages");
eq(new Set(all).size, all.length, "no href listed twice (single-home)");
["#/", "#/transfer", "#/market/BTS_USD", "#/samet", "#/barter", "#/spotlight",
 "#/direct-debit", "#/api-lab", "#/es-lab", "#/txbuilder", "#/ops", "#/top-ops",
 "#/registration", "#/voting", "#/fees", "#/news", "#/community", "#/about"].forEach(function (h) {
  ok(all.indexOf(h) !== -1, h + " listed");
});
eq(MenuUI._test.findSection("earn").links.length, 7, "earn has 7 links");
eq(MenuUI._test.findSection("nope"), null, "unknown slug is null");
console.log("menu-test: " + passed + " passed");
