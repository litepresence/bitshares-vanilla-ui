#!/usr/bin/env node
/* history-notice-test.js — stdlib unit test for vanilla/js/api/history-notice.js.
 * Owns: fake-doc vectors proving the builder is pure DOM (no fetch/Chain/Store),
 *   settings + help hrefs, link classes, unknown-kind null, and that the builder
 *   never sets message text (returns an <a> only).
 * Consumes: ../vanilla/js/api/history-notice.js via require (module.exports).
 *   Side effects: process.exitCode only. No network, no deps.
 * Created by: building-vanilla-slices skill, history-notice round.
 */
"use strict";
var path = require("path");
var HistoryNotice = require(path.join(__dirname, "..", "vanilla", "js", "api", "history-notice.js"));

/* Fake-doc pattern (stdlib only): minimal createElement surface. */
function fakeDoc() {
  return {
    createElement: function (tag) {
      return {
        tag: tag,
        children: [],
        textContent: "",
        setAttribute: function (k, v) { this[k] = v; },
        appendChild: function (c) { this.children.push(c); return c; }
      };
    }
  };
}
function tEcho(key, dflt) { return dflt; }
function tProbe(seen) {
  return function (key, dflt) { seen.key = key; seen.dflt = dflt; return dflt; };
}

var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("ok - " + name); }
  else { fail++; console.log("FAIL - " + name + (extra ? " :: " + extra : "")); }
}

/* 1. settings link href. */
(function () {
  var a = HistoryNotice.actionLink(fakeDoc(), tEcho, "settings");
  ok(a && a.tag === "a", "settings returns <a>");
  ok(a && a.href === "#/settings", "settings href is #/settings", a && a.href);
})();

/* 2. settings link class tokens. */
(function () {
  var a = HistoryNotice.actionLink(fakeDoc(), tEcho, "settings");
  var cls = (a && (a.className || a["class"])) || "";
  ok(cls.indexOf("hist-notice-link") !== -1, "settings has hist-notice-link class", cls);
  ok(cls.indexOf("touchable") !== -1, "settings has touchable class", cls);
})();

/* 3. settings link uses the notice.open_settings key (message keys untouched). */
(function () {
  var seen = {};
  HistoryNotice.actionLink(fakeDoc(), tProbe(seen), "settings");
  ok(seen.key === "notice.open_settings", "settings uses notice.open_settings", seen.key);
  ok(seen.dflt === "Open Settings", "settings default is Open Settings", seen.dflt);
})();

/* 4. help link href (real route #/help index hosting the ES directory). */
(function () {
  var a = HistoryNotice.actionLink(fakeDoc(), tEcho, "help-es");
  ok(a && a.tag === "a", "help-es returns <a>");
  ok(a && a.href === "#/help", "help-es href is #/help", a && a.href);
})();

/* 5. help link uses its own minted key, never a message key. */
(function () {
  var seen = {};
  HistoryNotice.actionLink(fakeDoc(), tProbe(seen), "help-es");
  ok(seen.key === "notice.open_help", "help-es uses notice.open_help", seen.key);
  var msgKeys = ["account.err_history", "market.err_history", "explorer.history_down",
    "pool.history_failed", "pool.my_history_failed"];
  ok(msgKeys.indexOf(seen.key) === -1, "help-es key is not a message key", seen.key);
})();

/* 6. unknown kind returns null (documented fail-soft; never throws into views). */
(function () {
  var threw = false, out = "unset";
  try { out = HistoryNotice.actionLink(fakeDoc(), tEcho, "bogus-kind"); }
  catch (e) { threw = true; }
  ok(!threw && out === null, "unknown kind returns null (no throw)", String(out));
})();

/* 7. builder never sets message text — returned node is an <a> only. */
(function () {
  var host = fakeDoc().createElement("div");
  var a = HistoryNotice.actionLink(fakeDoc(), tEcho, "settings");
  host.appendChild(a);
  ok(host.children.length === 1 && host.children[0].tag === "a",
    "builder appends an <a> only (no message div/p)", JSON.stringify(host.children.length));
  ok(a.textContent === "Open Settings", "link label is the action only", a && a.textContent);
})();

/* 8. bad doc returns null instead of throwing. */
(function () {
  var threw = false, out = "unset";
  try { out = HistoryNotice.actionLink(null, tEcho, "settings"); }
  catch (e) { threw = true; }
  ok(!threw && out === null, "null doc returns null (no throw)", String(out));
})();

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exitCode = fail ? 1 : 0;
