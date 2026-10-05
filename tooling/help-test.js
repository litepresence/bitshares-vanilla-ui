/* help-test.js — help index invariants (menu-sitemap slice).
 * Stdlib only: `node tooling/help-test.js` (exit 0 = green). No DOM, no network.
 */
"use strict";
var assert = require("assert");
global.I18n = { t: function (k, d) { return d; } };
var HelpUI = require("../vanilla/js/views/help-ui.js");
var passed = 0;
function eq(a, e, n) { assert.strictEqual(a, e, n + " (got " + JSON.stringify(a) + ")"); passed++; }
function ok(c, n) { assert.ok(c, n); passed++; }
var T = HelpUI.TOPICS;
eq(T.length, 67, "67 topics");
var keys = T.map(function (r) { return r[0]; });
eq(new Set(keys).size, keys.length, "topic keys unique");
keys.forEach(function (k) {
  ok(HelpUI._test.topicBody(k).length > 0, "body for " + k);
});
var grouped = [];
HelpUI._test.GROUPS.forEach(function (g) {
  g[2].forEach(function (k) { grouped.push(k); });
});
eq(grouped.length, keys.length, "groups cover every topic exactly once");
eq(new Set(grouped).size, grouped.length, "no topic in two groups");
keys.forEach(function (k) {
  ok(grouped.indexOf(k) !== -1, k + " grouped");
});
["samet", "barter", "spotlight", "direct-debit", "api-lab", "es-lab",
  "charts", "dashboard", "register", "password", "news", "uris", "browser"].forEach(function (k) {
  ok(keys.indexOf(k) !== -1, "new topic " + k);
});
console.log("help-test: " + passed + " passed");
