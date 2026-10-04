/* footer-build-test.js — unit vectors for footer build-info pure helpers (app.js).
 * Stdlib only: `node tooling/footer-build-test.js` (exit 0 = green). Covers
 * parseBuildInfo/parseCompare/compareUrl/relationText/netHostText. No DOM,
 * no network, no deps (I18n absent under node, so t() uses English defaults).
 */
"use strict";
var assert = require("assert");
var App = require("../vanilla/js/app.js");
var T = App._test;
["parseBuildInfo", "parseCompare", "compareUrl", "relationText", "netHostText", "currentNetwork"].forEach(function (k) {
  assert.ok(T && typeof T[k] === "function", "_test." + k + " exported");
});

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function deq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var SHA40 = "0123456789abcdef0123456789abcdef01234567";
deq(T.parseBuildInfo({ repo: "litepresence/bitshares-vanilla-ui", branch: "master", commit: SHA40, short: "0123456", generated_at: "2026-10-04T00:00:00Z" }),
  { repo: "litepresence/bitshares-vanilla-ui", branch: "master", commit: SHA40, short: "0123456" }, "valid build info");
eq(T.parseBuildInfo(null), null, "null build info");
eq(T.parseBuildInfo({}), null, "empty build info");
eq(T.parseBuildInfo({ repo: "a/b", branch: "master", commit: "xyz" }), null, "short commit rejected");
eq(T.parseBuildInfo({ repo: "no-slash", branch: "master", commit: SHA40 }), null, "bad repo rejected");
eq(T.parseBuildInfo({ repo: "a/b", branch: "", commit: SHA40 }), null, "empty branch rejected");

deq(T.parseCompare({ ahead_by: 0, behind_by: 0, status: "identical" }), { ahead: 0, behind: 0, status: "identical" }, "identical");
deq(T.parseCompare({ ahead_by: 2, behind_by: 0, status: "ahead" }), { ahead: 2, behind: 0, status: "ahead" }, "ahead");
deq(T.parseCompare({ ahead_by: 0, behind_by: 3, status: "behind" }), { ahead: 0, behind: 3, status: "behind" }, "behind");
deq(T.parseCompare({ ahead_by: 1, behind_by: 1, status: "diverged" }), { ahead: 1, behind: 1, status: "diverged" }, "diverged");
eq(T.parseCompare(null), null, "null compare");
eq(T.parseCompare({ ahead_by: "2", behind_by: 0 }), null, "string count rejected");
eq(T.parseCompare({ ahead_by: -1, behind_by: 0 }), null, "negative rejected");

eq(T.compareUrl("litepresence/bitshares-vanilla-ui", "master", SHA40),
  "https://api.github.com/repos/litepresence/bitshares-vanilla-ui/compare/master..." + SHA40, "compare URL shape");

eq(T.relationText({ ahead: 0, behind: 0 }), "in sync with", "sync");
eq(T.relationText({ ahead: 1, behind: 0 }), "1 commit ahead of", "ahead singular");
eq(T.relationText({ ahead: 3, behind: 0 }), "3 commits ahead of", "ahead plural");
eq(T.relationText({ ahead: 0, behind: 1 }), "1 commit behind", "behind singular");
eq(T.relationText({ ahead: 0, behind: 4 }), "4 commits behind", "behind plural");
eq(T.relationText({ ahead: 2, behind: 1 }), "diverged from (2 ahead, 1 behind)", "diverged");

eq(T.netHostText("mainnet", "dex.iobanker.com"), "mainnet - dex.iobanker.com", "mainnet prefix");
eq(T.netHostText("testnet", "h"), "testnet - h", "testnet prefix");
eq(T.netHostText("bogus", "h"), "mainnet - h", "unknown network defaults mainnet");
eq(T.currentNetwork(), "mainnet", "no Store under node defaults mainnet");

console.log("footer-build-test: " + passed + " passed, 0 failed");
