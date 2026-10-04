/* node-network-test.js — unit vectors for merged-table network helpers
 * (settings-nodes.js listNetwork/netFromChain/networkLabel/networkHealth/groupOf).
 * Stdlib only: `node tooling/node-network-test.js` (exit 0 = green). Covers
 * list-vs-chain derivation, display labels, and the yellow-unless-4018
 * color rule. No DOM, no network, no deps (Store stubbed globally).
 */
"use strict";
var assert = require("assert");
global.Store = {
  DEFAULT_NODES: { mainnet: ["wss://m1", "wss://m2"], testnet: ["wss://t1"] },
  CHAIN_IDS: {
    mainnet: "4018d7844c78f6a6c41c6a552b898022310fc5dec06da467ee7905a8dad512c8",
    testnet: "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447"
  }
};
var SN = require("../vanilla/js/settings-nodes.js");
var T = SN._test;
["listNetwork", "netFromChain", "networkLabel", "networkHealth", "groupOf", "hideNode", "unhideNode"].forEach(function (k) {
  assert.ok(T && typeof T[k] === "function", "_test." + k + " exported");
});
function t(k, d) { return d; }
var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
var MID = "4018d7844c78f6a6c41c6a552b898022310fc5dec06da467ee7905a8dad512c8";
var TID = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
eq(T.listNetwork("wss://m1"), "mainnet", "mainnet default");
eq(T.listNetwork("wss://m2"), "mainnet", "second mainnet default");
eq(T.listNetwork("wss://t1"), "testnet", "testnet default");
eq(T.listNetwork("wss://x"), "", "custom unknown");
eq(T.listNetwork(null), "", "null url");
eq(T.listNetwork(""), "", "empty url");
eq(T.netFromChain(MID), "mainnet", "mainnet chain");
eq(T.netFromChain(MID.toUpperCase()), "mainnet", "case-insensitive");
eq(T.netFromChain(TID), "testnet", "testnet chain");
eq(T.netFromChain("abcd"), "", "unknown chain");
eq(T.netFromChain(null), "", "null chain");
eq(T.netFromChain(""), "", "empty chain");
eq(T.networkLabel(t, "mainnet", null), "mainnet", "label mainnet");
eq(T.networkLabel(t, "testnet", null), "testnet", "label testnet");
eq(T.networkLabel(t, "", "abcd1234"), "abcd", "label chain prefix");
eq(T.networkLabel(t, "", null), "—", "label dash");
eq(T.networkHealth("mainnet", MID), "good", "mainnet chain green");
eq(T.networkHealth("testnet", TID), "warn", "testnet chain yellow");
eq(T.networkHealth("mainnet", TID), "bad", "default answering foreign chain red");
eq(T.networkHealth("", TID), "warn", "custom testnet yellow");
eq(T.networkHealth("", "ffff"), "warn", "custom unknown chain yellow");
eq(T.networkHealth("", MID), "good", "custom mainnet green");
eq(T.networkHealth("mainnet", null), "", "unprobed uncolored");
eq(T.networkHealth("", null), "", "unknown uncolored");
eq(T.groupOf("wss://m1"), "mainnet", "group mainnet");
eq(T.groupOf("wss://t1"), "testnet", "group testnet");
eq(T.groupOf("wss://x"), "custom", "group custom");
eq(T.hideNode([], "wss://a").join(","), "wss://a", "hide appends");
eq(T.hideNode(["wss://a"], "wss://a").length, 1, "hide dedupes");
eq(T.hideNode(null, "wss://a").join(","), "wss://a", "hide null list");
eq(T.unhideNode(["wss://a", "wss://b"], "wss://a").join(","), "wss://b", "unhide drops");
eq(T.unhideNode(null, "wss://a").length, 0, "unhide null list");
eq(T.hideNode(["wss://a"], null).join(","), "wss://a", "hide null url no-op");
var big = []; for (var i = 0; i < 65; i++) big.push("wss://n" + i);
eq(T.hideNode(big, "wss://z").length, 60, "hide caps at 60");
delete global.Store;
console.log("node-network-test: " + passed + " passed, 0 failed");
