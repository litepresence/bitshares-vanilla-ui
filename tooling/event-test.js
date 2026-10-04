"use strict";
// event-test.js — TDD test for vanilla/js/utils/event.js (Task 3.5).
// Fake parent/target with minimal addEventListener/removeEventListener/
// contains/closest stubs: delegation match calls handler, non-match ignored,
// unbind stops calls; fallback covered when closest is absent.
var path = require("path");
var assert = require("assert");
var target = path.join(__dirname, "..", "vanilla", "js", "utils", "event.js");
var EventDelegate = require(target);

function fakeParent() {
  var listeners = {};
  return {
    _listeners: listeners,
    addEventListener: function (type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: function (type, fn) {
      var arr = listeners[type] || [];
      var i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    contains: function (el) { return el !== null && el !== undefined; },
    fire: function (type, evt) {
      (listeners[type] || []).slice().forEach(function (fn) { fn(evt); });
    }
  };
}

function fakeTarget(matched) {
  return {
    closest: function () { return matched; }
  };
}

var passed = 0;

// 1. Delegation match: handler called with (event, matchedElement).
var matched = { tagName: "BUTTON", className: "btn" };
var calls = [];
var parent2 = fakeParent();
var unbind2 = EventDelegate.delegate(parent2, ".btn", "click", function (evt, el) {
  calls.push(el);
});
parent2.fire("click", { target: fakeTarget(matched) });
assert.strictEqual(typeof unbind2, "function", "delegate returns unbind fn");
assert.strictEqual(calls.length, 1, "match calls handler once");
assert.strictEqual(calls[0], matched, "handler receives matched element");
passed += 3;

// 2. Non-match ignored: closest returns null -> handler not called.
calls = [];
parent2.fire("click", { target: fakeTarget(null) });
assert.strictEqual(calls.length, 0, "non-match ignored");
passed += 1;

// 3. Unbind stops calls.
unbind2();
parent2.fire("click", { target: fakeTarget(matched) });
assert.strictEqual(calls.length, 0, "unbind removes listener");
passed += 1;

// 4. Fallback when closest is unavailable: exact-tag / .class / #id walk.
function link(tag, cls, id, parentNode) {
  return { tagName: tag, className: cls || "", id: id || "", parentNode: parentNode || null };
}
var root = fakeParent();
var btn = link("BUTTON", "btn primary", "go");
var span = { tagName: "SPAN", className: "", id: "", parentNode: btn };
root.contains = function (el) { return el === btn || el === span; };
var tagCalls = [];
EventDelegate.delegate(root, "button", "click", function (evt, el) { tagCalls.push(el); });
root.fire("click", { target: span });
assert.strictEqual(tagCalls.length, 1, "tag fallback matches case-insensitively");
assert.strictEqual(tagCalls[0], btn, "tag fallback resolves ancestor");
passed += 2;

var root2 = fakeParent();
var item = link("LI", "row active", "");
var inner2 = { tagName: "B", className: "", id: "", parentNode: item };
root2.contains = function (el) { return el === item || el === inner2; };
var classCalls = [];
EventDelegate.delegate(root2, ".active", "click", function (evt, el) { classCalls.push(el); });
root2.fire("click", { target: inner2 });
assert.strictEqual(classCalls.length, 1, "single-class fallback matches");
assert.strictEqual(classCalls[0], item, "class fallback resolves ancestor");
passed += 2;

var root3 = fakeParent();
var panel = link("DIV", "", "panel");
var em = { tagName: "EM", className: "", id: "", parentNode: panel };
root3.contains = function (el) { return el === panel || el === em; };
var idCalls = [];
EventDelegate.delegate(root3, "#panel", "click", function (evt, el) { idCalls.push(el); });
root3.fire("click", { target: em });
assert.strictEqual(idCalls.length, 1, "single-id fallback matches");
passed += 1;

// 5. Never throws: handler errors / bad targets are swallowed.
var root4 = fakeParent();
EventDelegate.delegate(root4, ".x", "click", function () { throw new Error("boom"); });
assert.doesNotThrow(function () {
  root4.fire("click", { target: fakeTarget({ tagName: "DIV" }) });
}, "handler throw is swallowed");
assert.doesNotThrow(function () {
  root4.fire("click", { target: null });
}, "null target never throws");
passed += 2;

console.log("Event utils: " + passed + " passed, 0 failed");
