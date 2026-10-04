"use strict";
// confirm-test.js — TDD test for vanilla/js/ui/confirm.js (Task 3.1).
// Fake-doc asserts the common confirm subset: heading + dl.confirm with
// dt/dd pairs (textContent-only), fee line, Back (ghost) + Send buttons,
// Esc→onBack, click Back→onBack, click Send→onSend.
var path = require("path");
var assert = require("assert");

// confirm.js consumes the DOM + touchable globals (script-tag order in
// index.html: dom.js, touchable.js, then ui/confirm.js). Mirror that here.
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
global.DOM = DOM;
global.touchable = require(path.join(__dirname, "..", "vanilla", "js", "utils", "touchable.js"));

var ConfirmDialog = require(path.join(__dirname, "..", "vanilla", "js", "ui", "confirm.js"));

function fakeEl(tag) {
  var el = {
    tag: tag,
    children: [],
    textContent: "",
    className: "",
    style: {},
    type: "",
    disabled: false,
    __handlers: {}
  };
  el.setAttribute = function (k, v) { this[k] = v; };
  el.getAttribute = function (k) { return this[k]; };
  el.hasAttribute = function (k) {
    return Object.prototype.hasOwnProperty.call(this, k);
  };
  el.removeAttribute = function (k) { delete this[k]; };
  el.appendChild = function (c) { this.children.push(c); return c; };
  el.addEventListener = function (t, fn) { this.__handlers[t] = fn; };
  el.removeEventListener = function (t, fn) {
    if (this.__handlers[t] === fn) delete this.__handlers[t];
  };
  return el;
}

function fakeDoc() {
  var handlers = {};
  return {
    __handlers: handlers,
    createElement: function (tag) { return fakeEl(tag); },
    addEventListener: function (t, fn) { handlers[t] = fn; },
    removeEventListener: function (t, fn) {
      if (handlers[t] === fn) delete handlers[t];
    }
  };
}

function findAll(root, tag) {
  var out = [];
  (function walk(n) {
    if (n.tag === tag) out.push(n);
    (n.children || []).forEach(walk);
  })(root);
  return out;
}

var passed = 0;
var doc = fakeDoc();
var backCalled = 0;
var sendCalled = 0;
var rows = [["From", "alice (1.2.1)"], ["To", "bob (1.2.2)"]];
var feeHuman = "0.12345 BTS";

var box = ConfirmDialog.show({
  doc: doc,
  title: "Confirm transfer",
  rows: rows,
  feeHuman: feeHuman,
  onBack: function () { backCalled += 1; },
  onSend: function () { sendCalled += 1; }
});

// 1. Returns the container element holding a heading with the title.
assert.ok(box && box.children, "show returns the container element");
var heads = findAll(box, "h3");
assert.strictEqual(heads.length, 1, "one h3 heading");
assert.strictEqual(heads[0].textContent, "Confirm transfer");
passed += 3;

// 2. Rows render as dl.confirm with dt/dd pairs, textContent-only.
var dls = findAll(box, "dl");
assert.strictEqual(dls.length, 1, "one dl");
assert.ok(
  String(dls[0].className).split(" ").indexOf("confirm") !== -1,
  "dl carries the confirm class"
);
passed += 2;
var dts = findAll(dls[0], "dt");
var dds = findAll(dls[0], "dd");
assert.strictEqual(dts.length, rows.length + 1, "dt per row plus the fee line");
assert.strictEqual(dds.length, rows.length + 1, "dd per row plus the fee line");
passed += 2;
assert.strictEqual(dts[0].textContent, "From");
assert.strictEqual(dds[0].textContent, "alice (1.2.1)");
assert.strictEqual(dts[1].textContent, "To");
assert.strictEqual(dds[1].textContent, "bob (1.2.2)");
passed += 4;
assert.ok(!("innerHTML" in dds[0]), "dd uses textContent, never innerHTML");
passed += 1;

// 3. Fee line carries the human fee text.
var feeHit = dds.filter(function (dd) {
  return dd.textContent === feeHuman;
});
assert.strictEqual(feeHit.length, 1, "fee line shows the human fee text");
passed += 1;

// 4. Two buttons: Back (ghost) + primary Send action.
var btns = findAll(box, "button");
assert.strictEqual(btns.length, 2, "Back + Send buttons");
var back = btns.filter(function (b) {
  return String(b.className).split(" ").indexOf("btn-ghost") !== -1;
})[0];
assert.ok(back, "Back carries the btn-ghost class");
assert.ok(back.textContent.indexOf("Back") !== -1, "Back keeps its label");
var send = btns.filter(function (b) { return b !== back; })[0];
assert.ok(send.textContent.indexOf("Send") !== -1, "action keeps its Send label");
assert.strictEqual(back.type, "button");
assert.strictEqual(send.type, "button");
passed += 5;

// 5. Esc key routes to onBack.
assert.ok(typeof doc.__handlers.keydown === "function", "Esc listener wired");
doc.__handlers.keydown({ key: "Escape" });
assert.strictEqual(backCalled, 1, "Esc fires onBack");
passed += 2;

// 6. Clicks route: Back→onBack, Send→onSend.
back.__handlers.click();
assert.strictEqual(backCalled, 2, "Back click fires onBack");
send.__handlers.click();
assert.strictEqual(sendCalled, 1, "Send click fires onSend");
passed += 2;

console.log("ConfirmDialog: " + passed + " passed, 0 failed");
