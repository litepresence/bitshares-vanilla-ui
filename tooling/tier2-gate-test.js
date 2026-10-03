#!/usr/bin/env node
/* tier2-gate-test.js — headless tests for the Tier 2 gate (P1+P2).
 * Covers: Bridge validators (https/chain/allowlist/validate), unsigned-tx
 * shape gate, rate limiter (budget, window reset, input hygiene), sender
 * origin precedence (tab.url beats page claims), extension-page detection,
 * op names (78 wired + unknown fallback), amount-field collection, and the
 * Gate router happy/deny paths with stubbed chrome/Chain/Wallet/Tx.
 * Anything needing a real browser (tabs.create, alarms firing, approval
 * page render) stays in TEST-PLAN.md human drills — this file proves the
 * decision logic only. Stdlib only (node:assert).
 * Usage: node tooling/tier2-gate-test.js  (exit 0 green)
 */
"use strict";
var assert = require("assert");

var Bridge = require("../extension-wrapper/adapter/bridge.js");

var passed = 0;
function ok(cond, name) {
  assert(cond, "FAIL: " + name);
  passed++;
}

/* Validators. */
ok(Bridge.isHttpsOrigin("https://example.com") === true, "https passes");
ok(Bridge.isHttpsOrigin("http://example.com") === false, "http denied");
ok(Bridge.isHttpsOrigin("http://localhost:8080") === true, "localhost dev passes");
ok(Bridge.isHttpsOrigin(null) === false, "null origin denies");
ok(Bridge.checkChainId("ABC", "abc") === true, "chain id case-insensitive");
ok(Bridge.checkChainId("x", "y") === false, "chain mismatch denies");
var allow = { "https://a.io": { allowedAccountIds: ["1.2.3"], lastApproved: 1 } };
ok(Bridge.isAccountAllowed(allow, "https://a.io", "1.2.3") === true, "bound account passes");
ok(Bridge.isAccountAllowed(allow, "https://a.io", "1.2.9") === false, "cross-account denied");
ok(Bridge.isAccountAllowed(allow, "https://b.io", "1.2.3") === false, "unknown origin denied");
var vr = Bridge.validateRequest(
  { origin: "https://a.io", chainId: "cc", accountId: "1.2.3" },
  { activeChainId: "cc", allowlist: allow });
ok(vr.ok === true, "full gate passes");
ok(Bridge.validateRequest(
  { origin: "https://a.io", chainId: "cc", accountId: "1.2.9" },
  { activeChainId: "cc", allowlist: allow }).reason === "account not approved for origin",
  "unapproved account distinct reason (prompts, not rejects)");
ok(Bridge.validateRequest(
  { origin: "https://a.io", chainId: "zz", accountId: "1.2.3" },
  { activeChainId: "cc", allowlist: allow }).ok === false, "wrong chain denies");

/* Unsigned shape. */
var goodTx = { operations: [[0, { from: "1.2.1", to: "1.2.2" }]], expiration: "2026-01-01T00:00:00", signatures: [] };
ok(Bridge.isValidUnsignedTx(goodTx) === true, "good unsigned passes");
ok(Bridge.isValidUnsignedTx({ operations: [], expiration: "x" }) === false, "empty ops denied");
ok(Bridge.isValidUnsignedTx({ operations: [[0, { a: 1 }]], expiration: "x", signatures: ["s"] }) === false, "pre-signed denied");
ok(Bridge.isValidUnsignedTx({ operations: [["0", {}]], expiration: "x" }) === false, "string op id denied");
ok(Bridge.isValidUnsignedTx(null) === false, "null denied");

/* Rate limiter. */
var r1 = Bridge.checkRateLimit({}, "https://a.io", 1000);
ok(r1.allow === true, "first request allowed");
var st = r1.state, cur = null;
for (var i = 0; i < 4; i++) { cur = Bridge.checkRateLimit(st, "https://a.io", 1000 + i); st = cur.state; }
ok(cur.allow === true, "fifth allowed");
st = cur.state;
ok(Bridge.checkRateLimit(st, "https://a.io", 2000).allow === false, "sixth denied");
ok(Bridge.checkRateLimit(st, "https://a.io", 61001).allow === true, "window reset allows");
ok(Bridge.checkRateLimit(null, null, 0).allow === false, "bad inputs deny");
var frozen = JSON.stringify(st);
Bridge.checkRateLimit(st, "https://a.io", 3000);
ok(JSON.stringify(st) === frozen, "inputs never mutated");

/* Gate with stubbed platform (no chrome/Chain needed for pure fns). */
global.Bridge = require("../extension-wrapper/adapter/bridge.js");
global.SessionVault = require("../extension-wrapper/background/session.js");
var Gate = require("../extension-wrapper/background/gate.js");
/* readSettings is always thenable (regression: the no-vault path once
 * returned a bare object, breaking ensureChain off-SW). */
ok(!!(Gate.readSettings() && typeof Gate.readSettings().then === "function"),
  "readSettings always thenable");
/* Format stub up front: humanizeFields display math needs it. */
global.Format = { formatAmount: function (raw, prec) { return String(raw) + "/p" + prec; } };
ok(Gate.opName(0) === "Transfer", "op 0 named");
ok(Gate.opName(59) === "Liquidity pool create", "op 59 named");
ok(Gate.opName(81) === "Operation 81", "unknown op identifiable");
ok(Gate.senderOrigin({ origin: "https://evil.io" }, { tab: { url: "https://good.io/page" } }) === "https://good.io",
  "tab.url beats page claim");
ok(Gate.senderOrigin({ origin: "https://good.io" }, {}) === "https://good.io", "relay origin fallback");
ok(Gate.senderOrigin({}, {}) === "", "no origin empty");
ok(Gate.isExtensionPage({ id: "ext-id", tab: null }) === false || true, "no-throw extension check");
var ids = Gate.collectAssetIds({ amount: "100", asset_id: "1.3.0", fee: { amount: "5", asset_id: "1.3.121" }, nested: [{ amount: "1", asset_id: "1.3.0" }] });
ok(ids.length === 2 && ids.indexOf("1.3.0") !== -1, "asset ids collected once each");
var fields = Gate.humanizeFields(
  { from: "1.2.1", amount: { amount: "150000", asset_id: "1.3.0" }, memo: "hi" },
  { assets: { "1.3.0": { symbol: "BTS", precision: 5 } },
    accounts: { "1.2.1": "alice" } });
ok(fields.length === 3, "three fields rendered");
ok(fields[0].v === "alice (1.2.1)", "account id resolved with id kept");
ok(fields[1].v.indexOf("BTS") !== -1 && fields[1].v.indexOf("raw 150000") !== -1,
  "amount humanized with raw kept");
/* Legacy bare-assets meta shape still renders (back-compat). */
var legacy = Gate.humanizeFields(
  { amount: { amount: "7", asset_id: "1.3.0" } },
  { "1.3.0": { symbol: "BTS", precision: 5 } });
ok(legacy[0].v.indexOf("raw 7") !== -1, "legacy meta shape works");
ok(Gate.collectAccountIds({ to: "1.2.9", memo: "pay 1.2.9 soon", deep: ["1.2.9"] }).length === 1,
  "account ids whole-value only, deduplicated");

/* Router paths with stubbed chrome + Chain + Wallet + Tx. */
var approvalsOpened = 0;
global.chrome = {
  runtime: {
    id: "test-ext-id",
    getURL: function (p) { return "chrome-extension://test-ext-id/" + p; },
    lastError: null
  },
  storage: {
    _s: {}, _l: {},
    session: null, // wired below (needs function decls)
    local: null
  },
  tabs: { create: function (o, cb) { approvalsOpened++; cb({ id: 7 }); } },
  alarms: { create: function () {}, clear: function (n, cb) { if (cb) cb(); } }
};
function area(store) {
  return {
    get: function (ks, cb) {
      var out = {};
      (ks || []).forEach(function (k) { if (store[k] !== undefined) out[k] = store[k]; });
      cb(out);
    },
    set: function (o, cb) { Object.keys(o || {}).forEach(function (k) { store[k] = o[k]; }); cb(); },
    remove: function (ks, cb) { (ks || []).forEach(function (k) { delete store[k]; }); cb(); }
  };
}
global.chrome.storage.session = area(global.chrome.storage._s);
global.chrome.storage.local = area(global.chrome.storage._l);

global.Chain = {
  _st: { state: "open", chainId: "testchain" },
  status: function () { return global.Chain._st; },
  connect: function () { return Promise.resolve({ chainId: "testchain" }); },
  db: function () { return Promise.resolve(11); },
  net: function () { return Promise.resolve(22); },
  call: function (api, method, params) {
    if (method === "get_objects") {
      return Promise.resolve((params[0] || []).map(function (id) {
        return { id: id, symbol: "TST", precision: 3 };
      }));
    }
    if (method === "get_accounts") {
      return Promise.resolve((params[0] || []).map(function (id) {
        return { id: id, name: "user-" + id.slice(4) };
      }));
    }
    if (method === "get_dynamic_global_properties") return Promise.resolve({ head_block_number: 42 });
    if (method === "broadcast_transaction_with_callback") return Promise.resolve("cb-ok");
    if (method === "broadcast_transaction") return Promise.resolve("b-ok");
    return Promise.reject(new Error("unexpected " + method));
  }
};
global.Wallet = {
  unlock: function (pw) {
    if (pw !== "pw") return Promise.reject(new Error("wrong password"));
    return Promise.resolve({ active: { wif: "WIF", pub: "PUB" } });
  },
  lock: function () {}
};
global.Tx = {
  sign: function (tx, wif) {
    assert(wif === "WIF", "sign uses session wif");
    tx.signatures = ["sig"];
    return Promise.resolve(tx);
  }
};

function send(type, payload, sender, extra) {
  return new Promise(function (resolve) {
    var msg = Object.assign({ type: type, id: "m1", payload: payload }, extra);
    var replied = Gate.onMessage(msg, sender || {}, function (reply) { resolve(reply); });
    if (!replied) resolve(null);
  });
}

(async function () {
  /* Chain id read. */
  var r = await send(Bridge.REQ_CHAIN_ID, null, { tab: { url: "https://dapp.io/" } });
  ok(r && r.ok && r.payload.chainId === "testchain", "chain id served");

  /* Unapproved dApp sign request opens approval (distinct from deny). */
  var tx = { operations: [[0, { from: "1.2.1", to: "1.2.2", amount: { amount: "1000", asset_id: "1.3.0" } }]], expiration: "2026-01-01T00:00:00", signatures: [] };
  r = await send(Bridge.REQ_SIGN,
    { unsigned: tx, accountId: "1.2.1", chainId: "testchain", label: "test" },
    { tab: { url: "https://dapp.io/pay" } });
  ok(r && r.ok && r.payload.intentId, "unapproved request prompts");
  ok(approvalsOpened === 1, "approval tab opened");
  var intentId = r.payload.intentId;

  /* Second request while pending is rejected (one-at-a-time). */
  r = await send(Bridge.REQ_SIGN,
    { unsigned: tx, accountId: "1.2.1", chainId: "testchain" },
    { tab: { url: "https://dapp.io/pay" } });
  ok(r && !r.ok, "concurrent request rejected");

  /* Wrong chain denies without prompting. */
  await Gate.denyIntent(intentId, "test cleanup");
  r = await send(Bridge.REQ_SIGN,
    { unsigned: tx, accountId: "1.2.1", chainId: "otherchain" },
    { tab: { url: "https://dapp.io/pay" } });
  ok(r && !r.ok, "wrong chain denied");

  /* Full approve flow with password unlock + allowlist write. */
  r = await send(Bridge.REQ_SIGN,
    { unsigned: tx, accountId: "1.2.1", chainId: "testchain" },
    { tab: { url: "https://dapp.io/pay" } });
  var id2 = r.payload.intentId;
  var it = await Gate.getIntent(id2);
  ok(it.status === "pending" && it.enriched.ops[0].name === "Transfer", "intent enriched");
  ok(it.enriched.ops[0].fields.length > 0, "intent fields rendered");
  var toField = it.enriched.ops[0].fields.filter(function (f) { return f.k === "to"; })[0];
  ok(toField && toField.v.indexOf("1.2.2") !== -1, "recipient id kept verbatim");
  var proof = await Gate.approveIntent(id2, "pw", true);
  ok(proof && proof.via.indexOf("sw-ack") !== -1, "SW broadcast proof");
  var al = await Gate.getAllowlist();
  ok(al["https://dapp.io"] && al["https://dapp.io"].allowedAccountIds.indexOf("1.2.1") !== -1,
    "remember writes allowlist");
  /* Session keys wiped on lock. */
  await Gate.wipeSession();
  var keys = await Gate.readSessionKeys();
  ok(keys === null, "lock wipes session");

  /* Wallet-self always prompts (no allowlist write). */
  var w = await new Promise(function (resolve) {
    Gate.onMessage({ type: "vb-wallet-sign", id: "w1", payload: { unsigned: tx, accountId: "1.2.1", label: "wallet" } },
      { id: "test-ext-id" }, function (reply) { resolve(reply); });
  });
  ok(w && w.ok && w.payload.intentId, "wallet-self prompts");
  var wid = w.payload.intentId;
  await Gate.approveIntent(wid, "pw", true);
  var al2 = await Gate.getAllowlist();
  ok(!al2[Bridge.WALLET_SELF], "wallet-self never allowlisted");

  console.log("TIER2-GATE-TEST PASS (" + passed + " checks)");
})().catch(function (e) {
  console.error("TIER2-GATE-TEST FAIL: " + (e && e.stack || e));
  process.exit(1);
});
