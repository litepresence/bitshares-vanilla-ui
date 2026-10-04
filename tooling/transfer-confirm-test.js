#!/usr/bin/env node
/* transfer-confirm-test.js — seam tests for vanilla/js/builders/transfer-confirm.js
 *   + vanilla/js/builders/trade-cancel.js (fee-ack refusal, result shaping).
 *
 * What it owns: TransferConfirm.review() vectors with stubbed chain/wallet
 *   globals (validation refusals, happy-path confirm-shape, fee-suspicious
 *   ride-through as a blocking feeWarning, foreign fee errors rethrown,
 *   locked-wallet encrypted-memo refusal, plain-memo hex path),
 *   TransferConfirm.showConfirm() fee-ack refusal (unchecked box signs
 *   nothing; acked-but-locked wallet still refuses), and TradeCancel vectors
 *   (orderCancelBox invalid-id + backend-missing refusals, cancelAllBox
 *   <2 no-op + >=2 button shaping, paintResult title/lines/Back shaping).
 *   No network (all chain/wallet globals stubbed), deterministic,
 *   stdlib `assert` only.
 * Seam gap (WITHOUT modifying app code): neither module exports its private
 *   helpers, so utf8Hex/showError/showResult (transfer-confirm) and
 *   cancelView/proveGone/sendTx/humanFee (trade-cancel) are NOT importably
 *   pure. They are exercised only indirectly through the exported seams
 *   above; cancelView pair/details strings and proveGone polling have no
 *   direct vector here — a future export (app-code change) would be needed.
 * Consumes: both builders via require + the real Format module (pure).
 * Side effects: temporary globals (Account/Chain/Tx/Store/Wallet/Crypto/
 *   ConfirmDialog/touchable), all restored; one summary line, exit 0/1.
 * Created by: R-B-T1 new-unit-suites round.
 */
"use strict";
var assert = require("assert");
var Format = require("../vanilla/js/api/format.js");
var TransferConfirm = require("../vanilla/js/builders/transfer-confirm.js");
var TradeCancel = require("../vanilla/js/builders/trade-cancel.js");

var passed = 0;
var failures = [];
async function t(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failures.push("FAIL " + name + " :: " + ((e && e.message) || e)); }
}

/* ---- fake DOM (textContent-only, no HTML parsing) ---- */
function fakeEl(tag) {
  var el = {
    tag: tag, children: [], textContent: "", className: "", style: {},
    type: "", disabled: false, checked: false, __handlers: {}
  };
  el.setAttribute = function (k, v) { this[k] = v; };
  el.appendChild = function (c) { this.children.push(c); return c; };
  el.removeChild = function (c) {
    var i = this.children.indexOf(c);
    if (i !== -1) this.children.splice(i, 1);
    return c;
  };
  el.addEventListener = function (type, fn) { this.__handlers[type] = fn; };
  el.classList = { add: function () {} };
  el.querySelector = function () { return null; };
  el.getElementsByTagName = function () { return []; };
  return el;
}
function fakeDoc() {
  return {
    created: [],
    createElement: function (tag) {
      var el = fakeEl(tag);
      this.created.push(el);
      return el;
    },
    createTextNode: function (text) { return { tag: "#text", textContent: String(text) }; }
  };
}
function fakeBox() {
  var b = fakeEl("div");
  Object.defineProperty(b, "firstChild", { get: function () { return this.children[0] || null; } });
  return b;
}
/* ---- stubbed chain/wallet world ---- */
var FEE_MODE = "ok";
var NORMAL_FEE = { amount: "30000", asset_id: "1.3.0" };
var BIG_FEE = { amount: "3000000", asset_id: "1.3.0" };
var lastBuildArg = null;
var signRoutedCalls = 0;

global.Format = Format;
global.Account = {
  resolve: function (name) {
    var map = { alice: { id: "1.2.1", name: "alice" }, bob: { id: "1.2.2", name: "bob" } };
    return Promise.resolve(map[String(name).toLowerCase()] || null).then(function (a) {
      if (!a) throw new Error("unknown-account");
      return a;
    });
  },
  myAccountId: function () { return Promise.resolve("alice"); }
};
global.Chain = {
  db: function () { return Promise.resolve(1); },
  status: function () { return { chainId: "abcdef1234567890" }; },
  call: function (dbId, method, params) {
    if (method === "lookup_asset_symbols") {
      var sym = params[0][0];
      if (sym === "BTS") return Promise.resolve([{ id: "1.3.0", symbol: "BTS", precision: 5 }]);
      return Promise.resolve([null]);
    }
    if (method === "get_accounts") {
      return Promise.resolve([{ id: "1.2.2", name: "bob", options: { memo_key: "TEST6fakememokeyforunittests" } }]);
    }
    return Promise.reject(new Error("unexpected call " + method));
  }
};
global.Tx = {
  buildTransfer: function (arg) {
    lastBuildArg = arg;
    return Promise.resolve({ operations: [[0, {
      from: arg.fromId, to: arg.toId,
      amount: { amount: arg.amountInt, asset_id: arg.assetId },
      memo: arg.memoObj || undefined
    }]] });
  },
  fee: function () {
    if (FEE_MODE === "ok") return Promise.resolve(NORMAL_FEE);
    if (FEE_MODE === "suspicious") {
      var e = new Error("fee-suspicious: 30 BTS fee on a 1 BTS transfer");
      e.detail = { fee: BIG_FEE };
      return Promise.reject(e);
    }
    return Promise.reject(new Error("fee-service-down"));
  },
  wifOk: function (wif) { return !!wif; },
  signRouted: function () { signRoutedCalls++; return Promise.resolve({ signed: {} }); }
};
global.Store = { loadSettings: function () { return { network: "testnet" }; } };
global.Wallet = { keys: {} };
global.Crypto = { encryptMemo: function () { return Promise.resolve({}); } };
global.touchable = require("../vanilla/js/utils/touchable.js");

/* ConfirmDialog stub: captures onBack/onSend, returns a button-bearing dlg. */
var capturedSend = null;
var capturedBack = null;
var backBtn = { disabled: false };
var sendBtn = { disabled: false };
global.ConfirmDialog = {
  show: function (opts) {
    capturedSend = opts.onSend;
    capturedBack = opts.onBack;
    var dlg = fakeEl("div");
    dlg.getElementsByTagName = function (tag) {
      return tag === "button" ? [backBtn, sendBtn] : [];
    };
    return dlg;
  }
};

function baseVals(over) {
  var v = { to: "bob", asset: "BTS", amount: "1", memo: "", encrypted: false };
  if (over) Object.keys(over).forEach(function (k) { v[k] = over[k]; });
  return v;
}

(async function main() {
  /* 1: missing recipient refuses. */
  await t("review rejects missing recipient", async function () {
    await assert.rejects(TransferConfirm.review(baseVals({ to: "" })), /Recipient is required/);
  });

  /* 2: unknown asset refuses. */
  await t("review rejects unknown asset", async function () {
    await assert.rejects(TransferConfirm.review(baseVals({ asset: "NOPE" })), /Unknown asset/);
  });

  /* 3: zero amount refuses (integer-only, no float dust). */
  await t("review rejects zero amount", async function () {
    await assert.rejects(TransferConfirm.review(baseVals({ amount: "0.00000" })), /greater than zero/);
  });

  /* 4: happy path shapes the confirm context (result shaping). */
  await t("review happy path shapes confirm ctx", async function () {
    FEE_MODE = "ok";
    var ctx = await TransferConfirm.review(baseVals());
    assert.strictEqual(ctx.amountInt, "100000", "1 BTS prec-5 -> raw");
    assert.deepStrictEqual(ctx.fee, NORMAL_FEE, "live fee rides ctx");
    assert.strictEqual(ctx.feeWarning, null, "no warning on normal fee");
    assert.strictEqual(ctx.unsigned.operations[0][1].fee.amount, "30000", "fee written onto opData");
    assert.strictEqual(ctx.memoKind, "none", "empty memo kind");
    assert.strictEqual(ctx.network, "testnet", "network from settings");
    assert.strictEqual(ctx.chainPrefix, "ABCDEF12", "chain prefix pinned at review");
  });

  /* 5: suspicious fee rides to confirm as a blocking warning (fee-ack path). */
  await t("review carries suspicious fee as feeWarning", async function () {
    FEE_MODE = "suspicious";
    var ctx = await TransferConfirm.review(baseVals());
    assert.deepStrictEqual(ctx.fee, BIG_FEE, "suspicious fee still resolves");
    assert.ok(ctx.feeWarning && ctx.feeWarning.indexOf("fee-suspicious") === 0, "warning rides ctx");
    FEE_MODE = "ok";
  });

  /* 6: foreign fee errors still throw (only fee-suspicious is carried). */
  await t("review rethrows non-suspicious fee errors", async function () {
    FEE_MODE = "down";
    await assert.rejects(TransferConfirm.review(baseVals()), /fee-service-down/);
    FEE_MODE = "ok";
  });

  /* 7: encrypted memo with a locked wallet refuses (keys never touched). */
  await t("review refuses encrypted memo while locked", async function () {
    await assert.rejects(
      TransferConfirm.review(baseVals({ memo: "hi", encrypted: true })), /wallet-locked/);
  });

  /* 8: plain memo encodes UTF-8 hex without touching crypto. */
  await t("review plain memo hex path", async function () {
    global.Wallet = { keys: { memo: { pub: "TEST6fakememokeyforunittests" } } };
    var ctx = await TransferConfirm.review(baseVals({ memo: "hello" }));
    assert.strictEqual(ctx.memoKind, "plain", "plain kind");
    assert.strictEqual(lastBuildArg.memoObj.message, "68656c6c6f", "utf8 hex message");
    global.Wallet = { keys: {} };
  });

  /* 9: showConfirm refuses to sign until the fee box is acked. */
  await t("showConfirm fee-ack refusal signs nothing", async function () {
    FEE_MODE = "suspicious";
    var ctx = await TransferConfirm.review(baseVals({ amount: "1" }));
    FEE_MODE = "ok";
    var doc = fakeDoc();
    var wrap = fakeBox();
    signRoutedCalls = 0;
    backBtn = { disabled: false };
    sendBtn = { disabled: false };
    TransferConfirm.showConfirm(doc, wrap, fakeBox(),
      { name: "alice", id: "1.2.1" }, ctx, function () {});
    assert.ok(typeof capturedSend === "function", "onSend captured");
    capturedSend();
    var errs = wrap.children.filter(function (c) { return c.className === "error"; });
    assert.ok(errs.length >= 1, "blocking error shown");
    assert.ok(/acknowledgement/.test(errs[errs.length - 1].textContent), "error names the ack gate");
    assert.strictEqual(signRoutedCalls, 0, "nothing signed on refused click");
    var boxes = doc.created.filter(function (e) { return e.tag === "input"; });
    assert.ok(boxes.length >= 1, "ack checkbox rendered");
    boxes[0].checked = true;
    capturedSend();
    errs = wrap.children.filter(function (c) { return c.className === "error"; });
    assert.ok(/Wallet is locked/.test(errs[errs.length - 1].textContent), "acked but locked still refuses");
    assert.strictEqual(signRoutedCalls, 0, "locked wallet signs nothing either");
  });

  /* 10: TradeCancel invalid order id refuses with a shaped error. */
  await t("orderCancelBox rejects non-1.7 id", async function () {
    var doc = fakeDoc();
    var box = fakeBox();
    TradeCancel.orderCancelBox(doc, box, { id: "1.3.0" }, {}, function () {});
    var errs = box.children.filter(function (c) { return c.className === "error"; });
    assert.strictEqual(errs.length, 1, "one error panel");
    assert.ok(/Not a limit order id/.test(errs[0].textContent), "names the id shape");
  });

  /* 11: TradeCancel backend-missing refusal (Tx/Chain absent). */
  await t("orderCancelBox refuses without backend", async function () {
    var savedTx = global.Tx, savedChain = global.Chain;
    delete global.Tx;
    delete global.Chain;
    try {
      var doc = fakeDoc();
      var box = fakeBox();
      TradeCancel.orderCancelBox(doc, box, { id: "1.7.9" }, {}, function () {});
      var errs = box.children.filter(function (c) { return c.className === "error"; });
      assert.strictEqual(errs.length, 1, "one error panel");
      assert.ok(/backend missing/.test(errs[0].textContent), "names the missing backend");
    } finally {
      global.Tx = savedTx;
      global.Chain = savedChain;
    }
  });

  /* 12: cancelAllBox with <2 valid ids is a silent no-op. */
  await t("cancelAllBox no-op under two orders", async function () {
    var doc = fakeDoc();
    var box = fakeBox();
    TradeCancel.cancelAllBox(doc, box, [{ id: "1.7.1" }, { id: "junk" }], {}, function () {});
    assert.strictEqual(box.children.length, 0, "nothing rendered");
  });

  /* 13: cancelAllBox with >=2 orders shapes the entry button. */
  await t("cancelAllBox renders cancel-all button", async function () {
    var doc = fakeDoc();
    var box = fakeBox();
    var assets = { quote: { symbol: "BTS" }, base: { symbol: "USD" } };
    TradeCancel.cancelAllBox(doc, box,
      [{ id: "1.7.1" }, { id: "1.7.2" }], assets, function () {});
    var btns = box.children.filter(function (c) { return c.tag === "button"; });
    assert.strictEqual(btns.length, 1, "one entry button");
    assert.strictEqual(btns[0].id, "trade-cancel-all", "stable hook id");
    assert.ok(/2 orders/.test(btns[0].textContent), "count in label");
  });

  /* 14: paintResult shapes title + lines + working Back. */
  await t("paintResult shapes result screen", async function () {
    var doc = fakeDoc();
    var mount = fakeBox();
    var backCalls = 0;
    TradeCancel.paintResult(doc, mount,
      { title: "Order placed", lines: ["line one", "line two"], backLabel: "Back",
        onBack: function () { backCalls++; } });
    var heads = mount.children.filter(function (c) { return c.tag === "h3"; });
    assert.strictEqual(heads.length, 1, "one title");
    assert.strictEqual(heads[0].textContent, "Order placed", "title verbatim");
    var lines = mount.children.filter(function (c) { return c.tag === "p"; });
    assert.strictEqual(lines.length, 2, "both lines rendered");
    var btns = mount.children.filter(function (c) { return c.tag === "button"; });
    assert.strictEqual(btns.length, 1, "one Back button");
    btns[0].__handlers.click();
    assert.strictEqual(backCalls, 1, "Back fires onBack");
  });

  delete global.Account;
  delete global.Chain;
  delete global.Tx;
  delete global.Store;
  delete global.Wallet;
  delete global.Crypto;
  delete global.ConfirmDialog;
  delete global.touchable;
  delete global.Format;

  if (failures.length) {
    failures.forEach(function (f) { console.log(f); });
    console.log("transfer-confirm+trade-cancel: " + passed + " passed, " + failures.length + " failed");
    process.exit(1);
  }
  console.log("transfer-confirm+trade-cancel: " + passed + " passed, 0 failed");
})().catch(function (e) {
  console.log("FAIL harness :: " + ((e && e.stack) || e));
  process.exit(1);
});
