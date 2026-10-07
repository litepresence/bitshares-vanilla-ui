/* pair-context-test.js — unit vectors for the global selected pair
 * (vanilla/js/api/pair-context.js). Stdlib only:
 *   node tooling/pair-context-test.js   (exit 0 = green)
 * Covers normalization (case/blanks/dupes/length/object ids/empty),
 * QUOTE_BASE derivation, the round trip, the pool->market string the pool
 * desk builds today, and the pub/sub. Ported from App._test.validPoolMarket
 * (same cases, same expectations — the rule moved to this module).
 * No DOM, no chain, no deps.
 */
"use strict";
var assert = require("assert");
var PairContext = require("../vanilla/js/api/pair-context.js");
var T = PairContext._t;
assert.ok(T && typeof T.normalize === "function", "_t.normalize exported");
assert.ok(T && typeof T.marketId === "function", "_t.marketId exported");
assert.ok(T && typeof T.fromMarketId === "function", "_t.fromMarketId exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function deep(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* --- normalize: the ported validPoolMarket cases, per-leg now --- */
deep(T.normalize(["bts_cny"]), ["BTS_CNY"], "legacy underscore id reaches normalize");
deep(T.normalize(["bts", "cny"]), ["BTS", "CNY"], "lowercase accepted (uppercased)");
deep(T.normalize(["HONEST.BTC", "bts"]), ["HONEST.BTC", "BTS"], "dotted symbols accepted");
deep(T.normalize(["1.3.113"]), ["BTS"], "bare object id dropped -> default");
deep(T.normalize(["1.3.113", "1.3.0"]), ["BTS"], "object-id pair dropped -> default");
deep(T.normalize(["BTS", "1.3.0"]), ["BTS"], "object-id leg dropped, real leg kept");
deep(T.normalize(["A", "B", "C"]), ["A", "B"], "three legs truncated to two");
deep(T.normalize(["BTS", "BTS"]), ["BTS"], "duplicates collapse");
deep(T.normalize(["  bts  ", "", "  ", null, undefined]), ["BTS"], "blanks/nulls dropped, real leg kept");
deep(T.normalize([]), ["BTS"], "empty array resets to default");
deep(T.normalize(["   "]), ["BTS"], "whitespace-only resets to default");
deep(T.normalize(null), ["BTS"], "null resets to default");
deep(T.normalize("bts"), ["BTS"], "a string is ONE leg (id -> pair is fromMarketId's job)");
deep(T.normalize("ETH_BTS"), ["ETH_BTS"], "normalize never splits a string on the separator");
deep(T.normalize("TOOLONGSYMBOLNAME"), ["BTS"], "over-12-char symbol dropped");
deep(T.normalize(["BTS", "ABCDEFGHIJKL"]), ["BTS", "ABCDEFGHIJKL"], "exactly-12-char symbol kept");
deep(T.DEFAULT, ["BTS"], "DEFAULT is [BTS]");

/* --- marketId: QUOTE_BASE is the ONLY place this rule lives --- */
eq(T.marketId(["BTS", "ETH"]), "ETH_BTS", "pair [BTS,ETH] -> desk ETH_BTS");
eq(T.marketId(["BTS", "BTC"]), "BTC_BTS", "spec's BTS/BTC -> BTC_BTS case");
eq(T.marketId(["BTS"]), null, "one-item pair has no desk id");
eq(T.marketId([]), null, "empty pair has no desk id");

/* --- round trip --- */
deep(T.fromMarketId("ETH_BTS"), ["BTS", "ETH"], "desk id -> human pair");
deep(T.fromMarketId("eth_bts"), ["BTS", "ETH"], "lowercase desk id uppercased");
deep(T.fromMarketId("BTC_BTS"), ["BTS", "BTC"], "BTC_BTS -> [BTS,BTC]");
deep(T.fromMarketId("BTS"), ["BTS"], "bare id -> single-leg pair");
deep(T.fromMarketId("1.3.113"), ["BTS"], "object id -> default");
deep(T.fromMarketId(""), ["BTS"], "empty id -> default");
deep(T.fromMarketId(null), ["BTS"], "null id -> default");
deep(T.fromMarketId("A_B_C"), ["BTS"], "three-part id rejected (validPoolMarket rule) -> default");

/* --- pool -> pair -> desk id: reproduces today's pool string --- */
deep(PairContext.fromPool({ base: { symbol: "BTS" }, quote: { symbol: "USDT" } }), ["BTS", "USDT"],
  "pool pair is the pool's own (base, quote) order");
PairContext.reset();
PairContext.set(["BTS", "USDT"]);
eq(PairContext.marketId(), "USDT_BTS", "pool pair -> USDT_BTS (what pool-detail-view built)");
deep(PairContext.fromPool({ base: {}, quote: {} }), ["BTS"], "pool with no symbols -> default");
PairContext.reset();
PairContext.set(["BTS", "1.3.0"]);
deep(PairContext.fromPool({ base: { symbol: "USDT" }, quote: {} }), ["USDT"], "missing pool leg -> one leg");

/* --- live state: default, set, copy-on-get, change notification --- */
PairContext.reset();
deep(PairContext.get(), ["BTS"], "reset -> default pair");
PairContext.set(["bts", " eth "]);
deep(PairContext.get(), ["BTS", "ETH"], "set normalizes");
deep(PairContext.set("ETH_BTS"), ["BTS", "ETH"], "set accepts a QUOTE_BASE id string");
PairContext.set(["", "   "]);
deep(PairContext.get(), ["BTS"], "unusable set resets to default");
PairContext.reset();
var copy = PairContext.get();
copy.push("ETH");
deep(PairContext.get(), ["BTS"], "get() returns a copy (caller cannot mutate state)");

var seen = [];
var off = PairContext.on(function (p) { seen.push(p.join(",")); });
PairContext.set(["BTS", "ETH"]);
PairContext.set(["BTS", "ETH"]);
PairContext.set(["bts", "eth"]);
deep(seen, ["BTS,ETH"], "subscriber notified once, only on a real change");
off();
PairContext.set(["BTS", "DOGE"]);
deep(seen, ["BTS,ETH"], "unsubscribe stops notifications");
PairContext.on(function () { throw new Error("throwing subscriber must not break set"); });
PairContext.set(["BTS", "ETH"]); /* must not throw */
PairContext.reset();

/* --- subscriber removal mid-notify is safe --- */
var order = [];
var offA = PairContext.on(function () { order.push("a"); });
PairContext.on(function () { order.push("b"); offA(); });
PairContext.set(["BTS", "XRP"]);
deep(order, ["a", "b"], "unsubscribing during notify does not throw");

console.log("pair-context vectors: " + passed + " passed");
