/* bitshares-uri-test.js — unit vectors for the BSIP-0060 bitshares: URI
 * adapter (vanilla/js/api/bitshares-uri.js parse/open/transferHash + the
 * routing-only Router.query helper in vanilla/js/router.js).
 * Stdlib only: `node tooling/bitshares-uri-test.js` (exit 0 = green).
 * No network (Explorer stubbed on globalThis), no DOM, no deps.
 *
 * Provenance (verified, not assumed):
 * - Grammar: BSIP-0060 (https://raw.githubusercontent.com/bitshares/bsips/master/bsip-0060.md,
 *   fetched 2026-10-03): Specifications Protocol/Paths/Params BNF
 *   (account 1.2.x|name, asset 1.3.x|symbol, market A/B or A_B, operation/<name>
 *   with transfer shortening asset/amount/memo/fee_asset, block/N[/T], 40-hex
 *   transaction) + Discussion shortening table (ob/operation->op/bl/trx,
 *   op/<id> numeric, op/0 = transfer).
 * - Route targets: router.js route table (#/account/:name, #/asset/:symbol,
 *   #/market/:marketID QUOTE_BASE via Market.parseId, #/block/:height[/txIndex],
 *   #/invoice?… owned view-side by the invoice worker); txhash submit branch
 *   reuses Explorer.resolveTxHash (explorer-ui.js:399-439) — stubbed here with
 *   its exact {status:"block"|"tx"|"not-found"|"offline"} shapes.
 */
"use strict";
var assert = require("assert");
var BitsharesURI = require("../vanilla/js/api/bitshares-uri.js");
var Router = require("../vanilla/js/router.js");
assert.ok(BitsharesURI && typeof BitsharesURI.parse === "function", "parse exported");
assert.ok(typeof BitsharesURI.open === "function", "open exported");
assert.ok(Router && typeof Router.query === "function", "Router.query exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function isErr(r, code, name) {
  assert.ok(r && r.error === code && typeof r.message === "string" && r.message,
    name + " (got " + JSON.stringify(r) + ")");
  passed++;
}

var H = "393704b7d1e84fa54f5e983c5e980f22edb31dd4"; /* real mainnet tx hash */

/* 1-7: all six kinds parse (happy paths). */
eq(BitsharesURI.parse("bitshares:account/alice"), { kind: "account", name: "alice" }, "parse account name");
eq(BitsharesURI.parse("bitshares:account/1.2.0"), { kind: "account", name: "1.2.0" }, "parse account id");
eq(BitsharesURI.parse("bitshares:asset/BTS"), { kind: "asset", symbol: "BTS" }, "parse asset symbol");
eq(BitsharesURI.parse("bitshares:market/BTS/USD"), { kind: "market", base: "BTS", quote: "USD" }, "parse market slash");
eq(BitsharesURI.parse("bitshares:block/123"), { kind: "block", height: 123, txIndex: null }, "parse block");
eq(BitsharesURI.parse("bitshares:block/123/6"), { kind: "block", height: 123, txIndex: 6 }, "parse block+tx");
eq(BitsharesURI.parse("bitshares:transaction/" + H), { kind: "transaction", hash: H }, "parse transaction");

/* 8-10: transfer query shapes. */
eq(BitsharesURI.parse("bitshares:operation/transfer?to=alice&asset=BTS&amount=1.5&memo=hi"),
  { kind: "transfer", to: "alice", asset: "BTS", amount: "1.5", memo: "hi", fee_asset: undefined },
  "parse transfer full");
eq(BitsharesURI.parse("bitshares:operation/transfer"),
  { kind: "transfer", to: "", asset: "", amount: "", memo: "", fee_asset: undefined },
  "parse transfer bare");
eq(BitsharesURI.parse("bitshares:operation/transfer?to=alice&asset=BTS&amount=1&fee_asset=CNY").fee_asset,
  "CNY", "parse transfer fee_asset");

/* 11-17: shortening table (BSIP Discussion). */
eq(BitsharesURI.parse("bitshares:op/transfer?to=alice"),
  { kind: "transfer", to: "alice", asset: "", amount: "", memo: "", fee_asset: undefined },
  "short op/transfer");
eq(BitsharesURI.parse("bitshares:op/0?to=alice&asset=BTS&amount=2").amount, "2", "short op/0 numeric transfer");
isErr(BitsharesURI.parse("bitshares:op/1"), "unknown-operation", "short op/1 unsupported");
eq(BitsharesURI.parse("bitshares:bl/123"), { kind: "block", height: 123, txIndex: null }, "short bl/block");
eq(BitsharesURI.parse("bitshares:trx/" + H), { kind: "transaction", hash: H }, "short trx/transaction");
isErr(BitsharesURI.parse("bitshares:ob/1.2.0"), "unsupported-type", "short ob/object recognized-unsupported");
eq(BitsharesURI.parse("bitshares:market/BTS_USD"), { kind: "market", base: "BTS", quote: "USD" }, "market underscore form");

/* 18-23: scheme tolerance (decided + logged). */
eq(BitsharesURI.parse("BITshares:account/alice"), { kind: "account", name: "alice" }, "scheme case-insensitive");
eq(BitsharesURI.parse("bitshares://account/alice"), { kind: "account", name: "alice" }, "scheme double-slash forgiven");
eq(BitsharesURI.parse("bitshares:account/alice/"), { kind: "account", name: "alice" }, "trailing slash forgiven");
eq(BitsharesURI.parse("  bitshares:asset/BTS  "), { kind: "asset", symbol: "BTS" }, "outer whitespace trimmed");
isErr(BitsharesURI.parse(""), "empty-uri", "empty string errors");
isErr(BitsharesURI.parse("https://example.com"), "bad-scheme", "https rejected");

/* 24-30: bad inputs never throw, honest codes. */
isErr(BitsharesURI.parse(null), "empty-uri", "null errors");
isErr(BitsharesURI.parse(undefined), "empty-uri", "undefined errors");
isErr(BitsharesURI.parse(42), "empty-uri", "number errors");
isErr(BitsharesURI.parse({}), "empty-uri", "object errors");
isErr(BitsharesURI.parse("bitshares:"), "unknown-type", "bare scheme errors");
isErr(BitsharesURI.parse("bitshares:foo/bar"), "unknown-type", "unknown type errors");
isErr(BitsharesURI.parse("bitshares:operation/issue"), "unknown-operation", "non-transfer op errors");

/* 31-40: value validation. */
isErr(BitsharesURI.parse("bitshares:account/Alice"), "bad-account", "uppercase account rejected");
isErr(BitsharesURI.parse("bitshares:account/has space"), "bad-account", "spaced account rejected");
isErr(BitsharesURI.parse("bitshares:account/"), "unsupported-path", "missing account ref errors");
isErr(BitsharesURI.parse("bitshares:asset/bts"), "bad-asset", "lowercase asset rejected");
isErr(BitsharesURI.parse("bitshares:asset/1.2.3"), "bad-asset", "account id as asset rejected");
isErr(BitsharesURI.parse("bitshares:market/BTS/BTS"), "bad-market", "same-asset market rejected");
isErr(BitsharesURI.parse("bitshares:market/BTS"), "bad-market", "single market asset rejected");
isErr(BitsharesURI.parse("bitshares:block/0"), "bad-block", "block 0 rejected");
isErr(BitsharesURI.parse("bitshares:block/abc"), "bad-block", "block alpha rejected");
isErr(BitsharesURI.parse("bitshares:block/1/2/0"), "unsupported-path", "block op depth rejected");

/* 41-45: hash + param strictness. */
isErr(BitsharesURI.parse("bitshares:transaction/" + H.slice(0, 39)), "bad-hash", "39-hex rejected");
isErr(BitsharesURI.parse("bitshares:transaction/" + H + H.slice(0, 24)), "bad-hash", "64-hex rejected");
isErr(BitsharesURI.parse("bitshares:operation/transfer?from=fox&to=alice"), "unknown-param", "extra from rejected");
isErr(BitsharesURI.parse("bitshares:operation/transfer?amount[amount]=1"), "unknown-param", "extended syntax rejected");
isErr(BitsharesURI.parse("bitshares:operation/transfer?to=ali ce&asset=BTS"), "bad-account", "bad to rejected");

/* 46-49: amount passes through HUMAN (never normalized/converted). */
eq(BitsharesURI.parse("bitshares:operation/transfer?amount=1.500&asset=BTS").amount, "1.500",
  "amount keeps trailing zeros");
eq(BitsharesURI.parse("bitshares:operation/transfer?to=alice&asset=BTS&amount=1.5&memo=x").memo, "x",
  "memo passes through");
isErr(BitsharesURI.parse("bitshares:operation/transfer?fee_asset=bts"), "bad-asset", "lowercase fee_asset rejected");
eq(BitsharesURI.parse("bitshares:object/1.2.0").error, "unsupported-type", "object recognized-unsupported");

/* 50-54: injection-ish strings safely encoded in the invoice hash. */
var evil = BitsharesURI.parse("bitshares:operation/transfer?to=alice&asset=BTS&amount=1&memo=" +
  encodeURIComponent("<script>alert(\"x\")</scr" + "ipt>&more"));
var evilHash = BitsharesURI.transferHash(evil);
assert.ok(evilHash.indexOf("<") === -1 && evilHash.indexOf(">") === -1 && evilHash.indexOf("\"") === -1,
  "invoice hash has no raw <>\" (got " + evilHash + ")");
passed++;
assert.ok(evilHash.indexOf("%3Cscript%3E") !== -1 && evilHash.indexOf("%26more") !== -1,
  "memo encoded (%3C…%26more) (got " + evilHash + ")");
passed++;
isErr(BitsharesURI.parse("bitshares:account/a\"b"), "bad-account", "quoted account rejected");
isErr(BitsharesURI.parse("bitshares:asset/B<T>S"), "bad-asset", "angled asset rejected");
eq(BitsharesURI.transferHash({ to: "a&b", asset: "BTS", amount: "1", memo: "x?y" }).indexOf("&b="), -1,
  "ampersand in values encoded");

/* 55-60: open() sync kinds navigate via hash (no location under Node: returned). */
async function main() {
  var r = await BitsharesURI.open("bitshares:account/alice");
  eq(r, { kind: "account", name: "alice", hash: "#/account/alice" }, "open account hash");
  r = await BitsharesURI.open("bitshares:asset/BTS");
  eq(r, { kind: "asset", symbol: "BTS", hash: "#/asset/BTS" }, "open asset hash");
  r = await BitsharesURI.open("bitshares:market/BTS/USD");
  eq(r.hash, "#/market/USD_BTS", "open market flips to QUOTE_BASE");
  r = await BitsharesURI.open("bitshares:block/123/6");
  eq(r.hash, "#/block/123/6", "open block+tx hash");
  r = await BitsharesURI.open("bitshares:operation/transfer?to=alice&asset=BTS&amount=1.5&memo=tea");
  eq(r.hash, "#/invoice?to=alice&asset=BTS&amount=1.5&memo=tea", "open transfer invoice hash");
  r = await BitsharesURI.open("bitshares:operation/transfer?to=alice&asset=BTS&amount=1&fee_asset=CNY");
  eq(r.hash, "#/invoice?to=alice&asset=BTS&amount=1&memo=&fee_asset=CNY", "open transfer fee_asset appended");

  /* 61-62: open() errors never navigate (no hash key on the outcome). */
  r = await BitsharesURI.open("bitshares:foo/bar");
  isErr(r, "unknown-type", "open unknown-type errors");
  assert.ok(!r.hash, "error outcome carries no hash");
  passed++;
  r = await BitsharesURI.open("garbage");
  isErr(r, "bad-scheme", "open bad-scheme errors");
  passed++;

  /* 63-67: transaction branch reuses resolveTxHash (stubbed exact shapes). */
  var g = globalThis;
  var saved = g.Explorer;
  g.Explorer = { resolveTxHash: function () { return Promise.resolve({ status: "block", block: 99, index: 2 }); } };
  r = await BitsharesURI.open("bitshares:transaction/" + H);
  eq(r.hash, "#/block/99/2", "tx block-context deep link");
  eq(r.via, "block", "tx block via");
  g.Explorer = { resolveTxHash: function () { return Promise.resolve({ status: "tx", hash: H, tx: { ops: [] } }); } };
  r = await BitsharesURI.open("bitshares:trx/" + H);
  eq(r.hash, "#/explorer", "tx location-less goes explorer");
  var pend = BitsharesURI.takePendingTx();
  eq(pend.hash, H, "pendingTx stashed");
  eq(BitsharesURI.takePendingTx(), null, "pendingTx consume-once");
  g.Explorer = { resolveTxHash: function () { return Promise.resolve({ status: "not-found", hash: H }); } };
  r = await BitsharesURI.open("bitshares:transaction/" + H);
  isErr(r, "not-found", "tx miss errors without nav");
  assert.ok(!r.hash, "miss carries no hash");
  passed++;
  g.Explorer = { resolveTxHash: function () { return Promise.resolve({ status: "offline", hash: H }); } };
  r = await BitsharesURI.open("bitshares:transaction/" + H);
  isErr(r, "offline", "tx offline errors");
  g.Explorer = { resolveTxHash: function () { return Promise.reject(new Error("boom")); } };
  r = await BitsharesURI.open("bitshares:transaction/" + H);
  isErr(r, "unavailable", "tx resolver throw errors");
  delete g.Explorer;
  r = await BitsharesURI.open("bitshares:transaction/" + H);
  isErr(r, "unavailable", "tx missing Explorer errors");
  if (saved !== undefined) g.Explorer = saved;

  /* 68-70: Router.query routing-only helper. */
  eq(Router.query(), {}, "Router.query empty under Node");
  g.window = { location: { hash: "#/invoice?to=alice&asset=BTS&amount=1.5&memo=a%20b" } };
  eq(Router.query(), { to: "alice", asset: "BTS", amount: "1.5", memo: "a b" }, "Router.query decodes");
  g.window.location.hash = "#/market/USD_BTS";
  eq(Router.query(), {}, "Router.query no-query path");
  delete g.window;

  console.log("bitshares-uri-test: PASS " + passed);
}

main().then(function () {}, function (e) {
  console.error("bitshares-uri-test: FAIL " + (e && e.stack || e));
  process.exit(1);
});
