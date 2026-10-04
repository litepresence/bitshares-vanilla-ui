"use strict";
var path = require("path");
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
var assert = require("assert");

function fakeDoc() {
  return {
    createElement: function(tag) {
      return { tag: tag, children: [], textContent: "", setAttribute: function(k,v){ this[k]=v; }, appendChild: function(c){ this.children.push(c); return c; }, className: "", style: {} };
    }
  };
}

var doc = fakeDoc();
var el = DOM.el(doc, "div", "hello", "cls");
assert.strictEqual(el.tag, "div");
assert.strictEqual(el.textContent, "hello");
assert.strictEqual(el.className, "cls");
assert.strictEqual(el.children.length, 0);

var wrap = doc.createElement("div");
wrap.children = [];
DOM.clear(wrap);
assert.strictEqual(wrap.children.length, 0);

var p = DOM.status(wrap, "test");
assert.strictEqual(p.textContent, "test");
assert.ok(p.hasAttribute("aria-live"));
assert.strictEqual(p.getAttribute("aria-live"), "polite");

var err = DOM.error(wrap, "oops");
assert.strictEqual(err.className, "error");
assert.ok(err.hasAttribute("aria-live"));

console.log("DOM utils: 7 passed, 0 failed");