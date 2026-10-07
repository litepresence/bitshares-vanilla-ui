"use strict";
// unlock-confirm-test.js — TDD test for vanilla/js/ui/unlock-confirm.js.
// Fake-doc asserts (real ConfirmDialog + Overlay + DOM + touchable):
// locked render (rows + fee + password), empty submit (no unlock attempt),
// bad password (in-modal error, wiped, stays open, re-enabled), good
// password (onUnlocked once, closed, onCancel silent), confirm-only mode
// (no password field), Esc (onCancel exactly once), double submit (one
// unlock call), honest throws (no doc / no Wallet / no onUnlocked).
var path = require("path");
var assert = require("assert");

var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
global.DOM = DOM;
global.touchable = require(path.join(__dirname, "..", "vanilla", "js", "utils", "touchable.js"));
var ConfirmDialog = require(path.join(__dirname, "..", "vanilla", "js", "ui", "confirm.js"));
global.ConfirmDialog = ConfirmDialog;
var Overlay = require(path.join(__dirname, "..", "vanilla", "js", "ui", "overlay.js"));
global.Overlay = Overlay;
var UnlockConfirm = require(path.join(__dirname, "..", "vanilla", "js", "ui", "unlock-confirm.js"));

function makeEl(tag, doc) {
  var el = {
    tag: tag,
    tagName: String(tag).toUpperCase(),
    children: [],
    textContent: "",
    className: "",
    style: {},
    type: "",
    value: "",
    disabled: false,
    parentElement: null,
    ownerDocument: doc,
    _listeners: {}
  };
  Object.defineProperty(el, "lastChild", {
    get: function () { return this.children.length ? this.children[this.children.length - 1] : null; }
  });
  el.setAttribute = function (k, v) { this[k] = v; };
  el.appendChild = function (c) { c.parentElement = el; this.children.push(c); return c; };
  el.insertBefore = function (c, ref) {
    c.parentElement = el;
    var i = this.children.indexOf(ref);
    if (i === -1) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  };
  el.removeChild = function (c) {
    var i = this.children.indexOf(c);
    if (i !== -1) this.children.splice(i, 1);
    c.parentElement = null;
    return c;
  };
  el.contains = function (n) {
    if (n === el) return true;
    for (var i = 0; i < el.children.length; i++) {
      if (el.children[i] === n) return true;
      if (el.children[i].contains && el.children[i].contains(n)) return true;
    }
    return false;
  };
  el.addEventListener = function (t, fn) {
    this._listeners[t] = this._listeners[t] || [];
    this._listeners[t].push(fn);
  };
  el.removeEventListener = function (t, fn) {
    var l = this._listeners[t];
    if (!l) return;
    var i = l.indexOf(fn);
    if (i !== -1) l.splice(i, 1);
  };
  el._dispatch = function (t, evt) {
    evt = evt || {};
    if (evt.target === undefined) evt.target = el;
    var l = (this._listeners[t] || []).slice();
    for (var i = 0; i < l.length; i++) l[i](evt);
  };
  el.focus = function () { if (doc) doc.activeElement = el; };
  el.click = function () { this._dispatch("click", { target: this }); };
  return el;
}

function fakeDoc() {
  var handlers = {};
  var doc = {
    activeElement: null,
    body: null,
    createElement: function (tag) { return makeEl(tag, doc); },
    addEventListener: function (t, fn) {
      handlers[t] = handlers[t] || [];
      handlers[t].push(fn);
    },
    removeEventListener: function (t, fn) {
      var l = handlers[t];
      if (!l) return;
      var i = l.indexOf(fn);
      if (i !== -1) l.splice(i, 1);
    },
    _dispatch: function (t, evt) {
      var l = (handlers[t] || []).slice();
      for (var i = 0; i < l.length; i++) l[i](evt || {});
    }
  };
  doc.body = makeEl("body", doc);
  return doc;
}

function walk(root, pred, out) {
  out = out || [];
  if (pred(root)) out.push(root);
  (root.children || []).forEach(function (c) { walk(c, pred, out); });
  return out;
}

function buttons(doc) {
  var found = [];
  walk(doc.body, function (n) { return n.tagName === "BUTTON"; }, found);
  return found;
}

function passwordInput(doc) {
  var found = walk(doc.body, function (n) { return n.tagName === "INPUT" && n.type === "password"; });
  return found[0] || null;
}

function flush() {
  return new Promise(function (res) { setTimeout(res, 10); });
}

function baseCfg(doc, over) {
  return Object.assign({
    doc: doc,
    title: "Review message",
    rows: [["Channel", "#general"], ["Message", "hello"]],
    feeHuman: "0.01000 BTS",
    needPassword: true,
    onUnlocked: function () {},
    onCancel: function () {}
  }, over || {});
}

async function main() {
  var passed = 0;

  // 1. Locked render: rows + fee + password input, focus on password.
  var doc1 = fakeDoc();
  global.Wallet = { unlock: function () { return Promise.resolve(); } };
  var h1 = UnlockConfirm.open(baseCfg(doc1));
  assert.ok(passwordInput(doc1), "locked mode renders a password input");
  passed += 1;
  assert.strictEqual(doc1.activeElement, passwordInput(doc1), "focus goes to the password input");
  passed += 1;
  h1.close();

  // 2. Empty submit: inline error, unlock NOT attempted.
  var doc2 = fakeDoc();
  var calls2 = [];
  global.Wallet = { unlock: function (pw) { calls2.push(pw); return Promise.resolve(); } };
  var unlocked2 = 0;
  UnlockConfirm.open(baseCfg(doc2, { onUnlocked: function () { unlocked2++; } }));
  var send2 = buttons(doc2).filter(function (b) { return b.textContent === "Unlock & post"; })[0];
  assert.ok(send2, "submit button renders with default label");
  passed += 1;
  send2.click();
  await flush();
  assert.strictEqual(calls2.length, 0, "empty password never reaches Wallet.unlock");
  assert.strictEqual(unlocked2, 0, "empty password never unlocks");
  passed += 2;

  // 3. Bad password: error in-modal, input wiped, stays open, re-enabled.
  var doc3 = fakeDoc();
  global.Wallet = { unlock: function () { return Promise.reject(new Error("bad password")); } };
  var unlocked3 = 0;
  var cancelled3 = 0;
  UnlockConfirm.open(baseCfg(doc3, {
    onUnlocked: function () { unlocked3++; },
    onCancel: function () { cancelled3++; }
  }));
  var pw3 = passwordInput(doc3);
  pw3.value = "wrong";
  var send3 = buttons(doc3).filter(function (b) { return b.textContent === "Unlock & post"; })[0];
  send3.click();
  assert.strictEqual(send3.disabled, true, "submit disables while pending");
  passed += 1;
  await flush();
  await flush();
  assert.strictEqual(unlocked3, 0, "bad password does not unlock");
  assert.strictEqual(pw3.value, "", "password wiped on failure");
  assert.strictEqual(send3.disabled, false, "submit re-enables after failure");
  assert.ok(doc3.body.children.length > 0, "modal stays open after failure");
  assert.strictEqual(cancelled3, 0, "failure is not a cancel");
  passed += 5;

  // 4. Good password: onUnlocked once, closed, onCancel silent.
  var doc4 = fakeDoc();
  var seen4 = [];
  global.Wallet = { unlock: function (pw) { seen4.push(pw); return Promise.resolve(); } };
  var unlocked4 = 0;
  var cancelled4 = 0;
  UnlockConfirm.open(baseCfg(doc4, {
    onUnlocked: function () { unlocked4++; },
    onCancel: function () { cancelled4++; }
  }));
  var pw4 = passwordInput(doc4);
  pw4.value = "correct horse";
  var send4 = buttons(doc4).filter(function (b) { return b.textContent === "Unlock & post"; })[0];
  send4.click();
  await flush();
  await flush();
  assert.deepStrictEqual(seen4, ["correct horse"], "password reaches unlock exactly once");
  assert.strictEqual(unlocked4, 1, "onUnlocked fires once");
  assert.strictEqual(cancelled4, 0, "success never fires onCancel");
  assert.strictEqual(doc4.body.children.length, 0, "overlay detaches on success");
  passed += 4;

  // 5. Confirm-only: no password field, submit goes straight through.
  var doc5 = fakeDoc();
  var calls5 = [];
  global.Wallet = { unlock: function (pw) { calls5.push(pw); return Promise.resolve(); } };
  var unlocked5 = 0;
  UnlockConfirm.open(baseCfg(doc5, {
    needPassword: false,
    onUnlocked: function () { unlocked5++; }
  }));
  assert.strictEqual(passwordInput(doc5), null, "confirm-only renders no password input");
  passed += 1;
  var send5 = buttons(doc5).filter(function (b) { return b.textContent === "Unlock & post"; })[0];
  send5.click();
  await flush();
  assert.strictEqual(unlocked5, 1, "confirm-only submits to onUnlocked");
  assert.strictEqual(calls5.length, 0, "confirm-only never touches unlock");
  passed += 2;

  // 6. Esc: onCancel exactly once across both Esc listeners + close().
  var doc6 = fakeDoc();
  global.Wallet = { unlock: function () { return Promise.resolve(); } };
  var cancelled6 = 0;
  var h6 = UnlockConfirm.open(baseCfg(doc6, { onCancel: function () { cancelled6++; } }));
  doc6._dispatch("keydown", { key: "Escape" });
  h6.close();
  assert.strictEqual(cancelled6, 1, "dismiss converges to a single onCancel");
  passed += 1;

  // 7. Double submit while pending: single unlock call.
  var doc7 = fakeDoc();
  var calls7 = [];
  global.Wallet = { unlock: function (pw) { calls7.push(pw); return new Promise(function () {}); } };
  UnlockConfirm.open(baseCfg(doc7));
  var pw7 = passwordInput(doc7);
  pw7.value = "x";
  var send7 = buttons(doc7).filter(function (b) { return b.textContent === "Unlock & post"; })[0];
  send7.click();
  send7.click();
  await flush();
  assert.strictEqual(calls7.length, 1, "pending submit blocks doubles");
  passed += 1;

  // 8. Honest throws: no onUnlocked / no Wallet / no document.
  assert.throws(function () {
    UnlockConfirm.open(baseCfg(fakeDoc(), { onUnlocked: null }));
  }, /onUnlocked/, "missing onUnlocked throws");
  passed += 1;
  var savedWallet = global.Wallet;
  global.Wallet = null;
  assert.throws(function () {
    UnlockConfirm.open(baseCfg(fakeDoc()));
  }, /wallet backend missing/, "missing Wallet throws");
  passed += 1;
  global.Wallet = savedWallet;
  assert.throws(function () {
    var cfg = baseCfg(fakeDoc());
    cfg.doc = null;
    var realDoc = global.document;
    try {
      UnlockConfirm.open(cfg);
    } finally {
      global.document = realDoc;
    }
  }, /no document/, "missing document throws");
  passed += 1;

  // 9. Raw forwarding: rawJson/rawLabel ride into the modal's confirm;
  // omitted rawJson renders no drill-down.
  var doc9 = fakeDoc();
  global.Wallet = { unlock: function () { return Promise.resolve(); } };
  var h9 = UnlockConfirm.open(baseCfg(doc9, {
    rawJson: '{"op":[35,{}]}',
    rawLabel: "Show unsigned operation JSON"
  }));
  var pres9 = walk(doc9.body, function (n) { return n.tagName === "PRE"; });
  assert.strictEqual(pres9.length, 1, "modal forwards the raw drill-down");
  assert.strictEqual(pres9[0].textContent, '{"op":[35,{}]}', "raw JSON arrives verbatim");
  passed += 2;
  h9.close();
  var doc9b = fakeDoc();
  var h9b = UnlockConfirm.open(baseCfg(doc9b));
  assert.strictEqual(walk(doc9b.body, function (n) { return n.tagName === "PRE"; }).length, 0, "omitted rawJson renders no drill-down");
  passed += 1;
  h9b.close();

  delete global.Wallet;
  console.log("unlock-confirm-test: PASS (" + passed + " asserts)");
}

main().catch(function (e) {
  console.error("unlock-confirm-test: FAIL");
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
