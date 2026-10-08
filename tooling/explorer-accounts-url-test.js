/* explorer-accounts-url-test.js — the explorer accounts tab must link each
 * lookup_accounts row to #/account/<name>.
 *
 * Regression: lookup_accounts answers [name, id] PAIRS (#4
 * database_api.hpp:357; live-proven 2026-10-08), but accountsTab
 * stringified the whole pair — href "#/account/committee%2C1.2.599999"
 * (404) and label "committee,1.2.599999".
 * Stdlib only: `node tooling/explorer-accounts-url-test.js` (exit 0 = green).
 */
"use strict";
var assert = require("assert");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var Tabs = require("../vanilla/js/api/explorer-tabs.js");
var fn = Tabs && Tabs._test && Tabs._test.accountLinkTarget;
assert(typeof fn === "function", "accountLinkTarget exported on _test");

/* Chain pair shape: name wins, id never leaks into the URL. */
eq(fn(["committee", "1.2.599999"]), { href: "#/account/committee", label: "committee" },
  "pair row links the bare name");
/* Plain-string rows (defensive): unchanged behavior. */
eq(fn("alice"), { href: "#/account/alice", label: "alice" },
  "string row links as before");
/* Object rows (some nodes answer maps): name wins. */
eq(fn({ name: "bob", id: "1.2.7" }), { href: "#/account/bob", label: "bob" },
  "object row links the bare name");
/* Names needing encoding still encode (dots survive, slashes encode). */
eq(fn(["a/b", "1.2.9"]), { href: "#/account/a%2Fb", label: "a/b" },
  "unsafe chars encode, id still excluded");
/* Garbage rows never produce a link target (caller skips them). */
eq(fn(null), null, "null -> null");
eq(fn([]), null, "empty pair -> null");
eq(fn(["", "1.2.1"]), null, "empty name -> null");
eq(fn(42), null, "non-row -> null");

console.log("explorer-accounts-url: " + passed + " passed");
