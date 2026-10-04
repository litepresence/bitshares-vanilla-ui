#!/usr/bin/env node
/* signmode-test.js — mode-matrix unit tests for vanilla/js/api/signmode.js.
 *
 * What it owns: asserts for capable() (extension-page / provider / none via
 *   minimal location/chrome/browser/window fakes), signingPin() (stored
 *   override incl. unknown-value and throwing-store fallbacks), effectiveMode()
 *   (pin x capability matrix), and firstAccountId() (first 1.2.x display
 *   extraction incl. nesting, non-matches, and hostile input). Pure-logic
 *   vectors only: no network, no keys, deterministic. Stdlib `assert` only.
 * Consumes: vanilla/js/api/signmode.js via require (module.exports = SignMode).
 *   Globals (location/chrome/browser/window/Store) are set per-vector and
 *   restored afterwards — the module reads them lazily, so require needs none.
 * Side effects: none beyond temporary globals (all restored; prints one
 *   summary line, exit 0 = green / 1 = red).
 * Created by: R-B-T1 new-unit-suites round.
 */
"use strict";
var assert = require("assert");
var SignMode = require("../vanilla/js/api/signmode.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* Reset every global the module may read to a known-absent baseline. */
function cleanGlobals() {
  delete global.location;
  delete global.chrome;
  delete global.browser;
  delete global.window;
  delete global.Store;
  delete global.Chain;
}

/* 1-3: capable() with nothing present reads "none", never throws. */
cleanGlobals();
eq(SignMode.capable(), "none", "capable none when no globals");
eq(typeof SignMode.capable(), "string", "capable always returns a string");
cleanGlobals();
global.window = {};
eq(SignMode.capable(), "none", "capable none when window has no provider");

/* 4-6: provider channel via the injected wallet object. */
cleanGlobals();
global.window = { bitsharesWallet: { isBitsharesWallet: true } };
eq(SignMode.capable(), "provider", "capable provider with flagged wallet object");
cleanGlobals();
global.window = { bitsharesWallet: { isBitsharesWallet: false } };
eq(SignMode.capable(), "none", "capable none when provider flag false");
cleanGlobals();
global.window = { bitsharesWallet: null };
eq(SignMode.capable(), "none", "capable none when provider null");

/* 7-10: extension-page channel (protocol + runtime), incl. missing halves. */
cleanGlobals();
global.location = { protocol: "chrome-extension:" };
global.chrome = { runtime: { sendMessage: function () {} } };
eq(SignMode.capable(), "extension-page", "capable extension-page on chrome-extension + runtime");
cleanGlobals();
global.location = { protocol: "chrome-extension:" };
eq(SignMode.capable(), "none", "capable none when extension protocol but runtime missing");
cleanGlobals();
global.location = { protocol: "https:" };
global.chrome = { runtime: { sendMessage: function () {} } };
eq(SignMode.capable(), "none", "capable none when runtime present but page is https");
cleanGlobals();
global.location = { protocol: "moz-extension:" };
global.browser = { runtime: { sendMessage: function () {} } };
eq(SignMode.capable(), "extension-page", "capable extension-page on moz-extension + browser runtime");

/* 11-16: signingPin() stored override + fallbacks. */
cleanGlobals();
eq(SignMode.signingPin(), "auto", "signingPin auto when Store missing");
global.Store = { loadSettings: function () { return { signing: "extension" }; } };
eq(SignMode.signingPin(), "extension", "signingPin honors stored extension");
global.Store = { loadSettings: function () { return { signing: "browser" }; } };
eq(SignMode.signingPin(), "browser", "signingPin honors stored browser");
global.Store = { loadSettings: function () { return { signing: "carrier-pigeon" }; } };
eq(SignMode.signingPin(), "auto", "signingPin unknown value reads as auto");
global.Store = { loadSettings: function () { throw new Error("locked"); } };
eq(SignMode.signingPin(), "auto", "signingPin throwing store reads as auto");
global.Store = { loadSettings: function () { return {}; } };
eq(SignMode.signingPin(), "auto", "signingPin missing key reads as auto");

/* 17-22: effectiveMode() pin x capability matrix. */
function setCap(kind) {
  cleanGlobals();
  if (kind === "provider") global.window = { bitsharesWallet: { isBitsharesWallet: true } };
  if (kind === "extension-page") {
    global.location = { protocol: "chrome-extension:" };
    global.chrome = { runtime: { sendMessage: function () {} } };
  }
}
setCap("provider");
global.Store = { loadSettings: function () { return { signing: "browser" }; } };
eq(SignMode.effectiveMode(), "browser", "effectiveMode pinned browser wins over provider channel");
setCap("provider");
global.Store = { loadSettings: function () { return { signing: "extension" }; } };
eq(SignMode.effectiveMode(), "extension", "effectiveMode pinned extension + channel = extension");
setCap("none");
global.Store = { loadSettings: function () { return { signing: "extension" }; } };
eq(SignMode.effectiveMode(), "browser", "effectiveMode pinned extension but channel missing = browser");
setCap("provider");
global.Store = { loadSettings: function () { return { signing: "auto" }; } };
eq(SignMode.effectiveMode(), "extension", "effectiveMode auto + channel present = extension");
setCap("none");
global.Store = { loadSettings: function () { return { signing: "auto" }; } };
eq(SignMode.effectiveMode(), "browser", "effectiveMode auto + no channel = browser");
setCap("provider");
delete global.Store;
eq(SignMode.effectiveMode(), "extension", "effectiveMode missing store (auto) + channel = extension");

/* 23-30: firstAccountId() display extraction. */
cleanGlobals();
function unsignedWith(ops) { return { operations: ops }; }
eq(SignMode.firstAccountId(unsignedWith([[0, { from: "1.2.33", to: "1.2.44" }]])),
  "1.2.33", "firstAccountId finds first 1.2.x in op order");
eq(SignMode.firstAccountId(unsignedWith([[0, { from: "1.3.0", to: "1.2.9" }]])),
  "1.2.9", "firstAccountId skips asset ids, takes the account");
eq(SignMode.firstAccountId(unsignedWith([[1, { nested: { deep: ["x", "1.2.77"] } }]])),
  "1.2.77", "firstAccountId walks nested arrays/objects");
eq(SignMode.firstAccountId(unsignedWith([[0, { from: "1.7.5" }]])),
  "", "firstAccountId ignores order ids, empty when no account");
eq(SignMode.firstAccountId(unsignedWith([])), "", "firstAccountId empty ops = empty");
eq(SignMode.firstAccountId(null), "", "firstAccountId null input = empty, never throws");
eq(SignMode.firstAccountId(undefined), "", "firstAccountId undefined input = empty");
eq(SignMode.firstAccountId({}), "", "firstAccountId missing operations = empty");

cleanGlobals();
console.log("signmode: " + passed + " passed, 0 failed");
