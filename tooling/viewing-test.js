/* viewing-test.js — unit vectors for ViewingAs section + picker dedupe.
 * Stdlib only: `node tooling/viewing-test.js` (exit 0 = green). Covers
 * renderSection shape (section#viewing-as, heading, no close button) and
 * openPicker dedupe (second call while one is open adds nothing).
 * Created by: systematic-debugging, view-as-duplication bug (header click
 * appended unstyled overlays to body endlessly; fix = settings section +
 * nav-and-scroll + guarded picker).
 */
"use strict";
var assert = require("assert");
var ViewingAs = require("../vanilla/js/api/viewing-as.js");

/* Fake-doc with element registry (getElementById) + body append tracking. */
function fakeDoc() {
  var byId = {};
  var appended = [];
  function mk(tag) {
    var el = {
      tag: tag, children: [], textContent: "", className: "", style: {},
      id: "", disabled: false, type: "", _attrs: {}, _listeners: {},
      setAttribute: function (k, v) { this._attrs[k] = String(v); if (k === "id") { this.id = String(v); byId[String(v)] = this; } },
      getAttribute: function (k) { return this._attrs[k]; },
      appendChild: function (c) { this.children.push(c); return c; },
      removeChild: function (c) { var i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); return c; },
      addEventListener: function (t, f) { this._listeners[t] = f; },
      focus: function () {},
      querySelector: function () { return null; }
    };
    Object.defineProperty(el, "parentNode", { get: function () { return null; }, configurable: true });
    return el;
  }
  var body = mk("body");
  var origAppend = body.appendChild;
  body.appendChild = function (c) { appended.push(c); return origAppend.call(body, c); };
  return {
    createElement: mk, body: body, appended: appended,
    getElementById: function (id) { return byId[id] || null; },
    _register: function (el) { if (el.id) byId[el.id] = el; }
  };
}

var pass = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  pass++;
}

/* 1. renderSection exists and returns section#viewing-as. */
(function () {
  assert.strictEqual(typeof ViewingAs.renderSection, "function", "renderSection exported");
  var doc = fakeDoc();
  var sec = ViewingAs.renderSection(doc);
  assert.strictEqual(sec.tag, "section", "section element");
  assert.strictEqual(sec.id || sec.getAttribute("id"), "viewing-as", "id viewing-as");
  pass += 3;
})();

/* 2. Section carries heading + input + Go/Reset, but NO close button. */
(function () {
  var doc = fakeDoc();
  var sec = ViewingAs.renderSection(doc);
  var html = JSON.stringify(sec);
  assert.ok(/View as account/.test(html), "heading text present");
  assert.ok(/View as this account/.test(html), "Go button present");
  assert.ok(/Reset to committee-account/.test(html), "Reset button present");
  assert.ok(html.indexOf('"×"') === -1, "no × close button in section mode");
  pass += 4;
})();

/* 3. openPicker dedupes: second call while one is open appends nothing. */
(function () {
  var doc = fakeDoc();
  var first = ViewingAs.openPicker(doc);
  doc.body.appendChild(first);
  var before = doc.appended.length;
  var second = ViewingAs.openPicker(doc);
  assert.strictEqual(doc.appended.length, before, "no second append while picker open");
  assert.ok(second === first || second === null, "returns existing or null, never a fresh duplicate");
  pass += 2;
})();

console.log("viewing-test: " + pass + " passed, 0 failed");
