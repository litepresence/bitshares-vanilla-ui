"use strict";
// overlay-test.js — TDD test for vanilla/js/ui/overlay.js (Task 3.3).
// Fake-doc asserts: shape (overlay/panel CSS contract classes, content
// placement, body attach, focus to panel), backdrop-click closes + onClose
// once, content-click does not close, Esc closes, non-Esc does not,
// close() idempotent.
var path = require("path");
var assert = require("assert");

// overlay.js consumes the DOM global (script-tag order in index.html:
// utils/dom.js before ui/overlay.js). Mirror that here.
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
global.DOM = DOM;

var Overlay = require(path.join(__dirname, "..", "vanilla", "js", "ui", "overlay.js"));

// Minimal fake element: addEventListener/remove + dispatch, target stub
// (events default target to the dispatching el), contains stub, focus stub,
// parentElement linkage, ownerDocument back-pointer.
function makeEl(tag, doc) {
  var el = {
    tag: tag,
    children: [],
    textContent: "",
    className: "",
    style: {},
    parentElement: null,
    ownerDocument: doc,
    _listeners: {}
  };
  el.setAttribute = function (k, v) { this[k] = v; };
  el.getAttribute = function (k) { return this[k]; };
  el.hasAttribute = function (k) {
    return Object.prototype.hasOwnProperty.call(this, k);
  };
  el.removeAttribute = function (k) { delete this[k]; };
  el.appendChild = function (c) {
    c.parentElement = el;
    this.children.push(c);
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
  el.querySelectorAll = function () { return []; };
  return el;
}

// Minimal fake doc: createElement, doc-level keydown add/remove + dispatch,
// body host, activeElement for the focus assertion.
function fakeDoc() {
  var keyHandlers = [];
  var doc = {
    _keyHandlers: keyHandlers,
    activeElement: null,
    body: null,
    createElement: function (tag) { return makeEl(tag, doc); },
    addEventListener: function (type, fn) { keyHandlers.push({ type: type, fn: fn }); },
    removeEventListener: function (type, fn) {
      for (var i = keyHandlers.length - 1; i >= 0; i--) {
        if (keyHandlers[i].type === type && keyHandlers[i].fn === fn) {
          keyHandlers.splice(i, 1);
        }
      }
    },
    _dispatchKey: function (evt) {
      var list = keyHandlers.slice();
      for (var i = 0; i < list.length; i++) {
        if (list[i].type === "keydown") list[i].fn(evt);
      }
    }
  };
  doc.body = makeEl("body", doc);
  return doc;
}

var passed = 0;

function hasClass(el, name) {
  return String(el.className).split(" ").indexOf(name) !== -1;
}

// 1. Shape: returns { overlay, close }; overlay reuses the app.css contract
// classes; content sits inside the panel; overlay attaches to body; focus
// goes to the panel.
var doc1 = fakeDoc();
var content1 = doc1.createElement("div");
var calls1 = 0;
var r1 = Overlay.open({ content: content1, onClose: function () { calls1++; } });
assert.ok(r1 && r1.overlay, "open returns { overlay, close }");
assert.strictEqual(typeof r1.close, "function", "open returns a close function");
passed += 2;
assert.ok(hasClass(r1.overlay, "credit-loan-overlay"), "overlay reuses .credit-loan-overlay");
passed += 1;
var panel1 = r1.overlay.children[0];
assert.ok(panel1 && hasClass(panel1, "credit-loan-panel"), "panel reuses .credit-loan-panel");
assert.strictEqual(panel1.children[0], content1, "content is placed inside the panel");
passed += 2;
assert.ok(doc1.body.contains(r1.overlay), "overlay attaches to doc body");
assert.strictEqual(doc1.activeElement, panel1, "focus goes to the panel");
passed += 2;

// 2. Backdrop click closes, onClose fires exactly once; content click does
// not close; a second backdrop click after close stays at one call.
var doc2 = fakeDoc();
var content2 = doc2.createElement("div");
var calls2 = 0;
var r2 = Overlay.open({ content: content2, onClose: function () { calls2++; } });
var panel2 = r2.overlay.children[0];
r2.overlay._dispatch("click", { target: content2 });
assert.strictEqual(calls2, 0, "click on content does not close");
passed += 1;
r2.overlay._dispatch("click", { target: r2.overlay });
assert.strictEqual(calls2, 1, "backdrop click closes with onClose once");
passed += 1;
assert.ok(!doc2.body.contains(r2.overlay), "closed overlay leaves the body");
passed += 1;
r2.overlay._dispatch("click", { target: r2.overlay });
assert.strictEqual(calls2, 1, "backdrop click after close does not refire onClose");
passed += 1;
void panel2;

// 3. Esc closes; non-Esc keys do not.
var doc3 = fakeDoc();
var content3 = doc3.createElement("div");
var calls3 = 0;
var r3 = Overlay.open({ content: content3, onClose: function () { calls3++; } });
doc3._dispatchKey({ key: "Enter" });
assert.strictEqual(calls3, 0, "non-Esc key does not close");
passed += 1;
doc3._dispatchKey({ key: "Escape" });
assert.strictEqual(calls3, 1, "Esc closes with onClose once");
passed += 1;
doc3._dispatchKey({ key: "Escape" });
assert.strictEqual(calls3, 1, "Esc after close does not refire onClose");
passed += 1;

// 4. close() is idempotent: two calls, one onClose, overlay detached.
var doc4 = fakeDoc();
var content4 = doc4.createElement("div");
var calls4 = 0;
var r4 = Overlay.open({ content: content4, onClose: function () { calls4++; } });
r4.close();
r4.close();
assert.strictEqual(calls4, 1, "close() twice fires onClose once");
passed += 1;
assert.ok(!doc4.body.contains(r4.overlay), "close() detaches the overlay");
passed += 1;

// 5. className passthrough: extra hook appended, contract classes kept.
var doc5 = fakeDoc();
var content5 = doc5.createElement("div");
var r5 = Overlay.open({ content: content5, className: "my-hook" });
assert.ok(hasClass(r5.overlay, "credit-loan-overlay"), "className keeps contract class");
assert.ok(hasClass(r5.overlay, "my-hook"), "className appends the extra hook");
passed += 2;
r5.close();

console.log("Overlay: " + passed + " passed, 0 failed");
