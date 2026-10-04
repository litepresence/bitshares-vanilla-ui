"use strict";
var path = require("path");
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
var assert = require("assert");

function fakeDoc() {
  return {
    createElement: function(tag) {
      return { tag: tag, children: [], textContent: "", setAttribute: function(k,v){ this[k]=v; }, appendChild: function(c){ this.children.push(c); return c; }, className: "", style: {} };
    },
    createTextNode: function(text) {
      return { tag: "#text", children: [], textContent: text == null ? "" : String(text), nodeValue: text == null ? "" : String(text), className: "", style: {} };
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
assert.strictEqual(p.hasAttribute("aria-live"), true, "status sets aria-live (actual=" + p.hasAttribute("aria-live") + " expected=true)");
assert.strictEqual(p.getAttribute("aria-live"), "polite");

var err = DOM.error(wrap, "oops");
assert.strictEqual(err.className, "error");
assert.strictEqual(err.hasAttribute("aria-live"), true, "error sets aria-live (actual=" + err.hasAttribute("aria-live") + " expected=true)");

// pageHead vectors (uniform heading-icons plan, Phase 1)
assert.strictEqual(typeof DOM.pageHead, "function", "DOM.pageHead exists");

// vector 1: icon present -> h1 with title text + img child class h-title-icon
global.Icon = {
  img: function(name, cls, alt) {
    return { tag: "img", iconName: name, className: cls, alt: alt, children: [], textContent: "" };
  }
};
var headed = DOM.pageHead(doc, "Markets", "candles");
assert.strictEqual(headed.tag, "h1");
assert.strictEqual(headed.textContent, "Markets");
assert.strictEqual(headed.children.length, 2);
assert.strictEqual(headed.children[0].textContent, " ");
assert.strictEqual(headed.children[1].tag, "img");
assert.strictEqual(headed.children[1].className, "h-title-icon");
delete global.Icon;

// vector 2: null icon -> text-only h1, no children
var plainNull = DOM.pageHead(doc, "Markets", null);
assert.strictEqual(plainNull.tag, "h1");
assert.strictEqual(plainNull.textContent, "Markets");
assert.strictEqual(plainNull.children.length, 0);

// vector 3: Icon missing -> text-only h1, no throw
var plainNoIcon = DOM.pageHead(doc, "Markets", "candles");
assert.strictEqual(plainNoIcon.tag, "h1");
assert.strictEqual(plainNoIcon.textContent, "Markets");
assert.strictEqual(plainNoIcon.children.length, 0);

// vector 4: undefined / "" icon -> text-only h1
var plainUndef = DOM.pageHead(doc, "Markets");
assert.strictEqual(plainUndef.textContent, "Markets");
assert.strictEqual(plainUndef.children.length, 0);
var plainEmpty = DOM.pageHead(doc, "Markets", "");
assert.strictEqual(plainEmpty.textContent, "Markets");
assert.strictEqual(plainEmpty.children.length, 0);

// vector 5: title set textContent-only (no HTML parsing)
var evil = DOM.pageHead(doc, "<b>x</b>", null);
assert.strictEqual(evil.textContent, "<b>x</b>");
assert.strictEqual(evil.children.length, 0);

// vector 6: full-color PNG art is marked icon-state (theme invert skips it);
// monochrome SVGs keep h-title-icon alone (follow --icon-filter)
global.Icon = {
  url: function(name) { return "assets/icons/" + name + (/lock-blue/.test(name) ? ".png" : ".svg"); },
  img: function(name, cls, alt) {
    return { tag: "img", iconName: name, className: cls, alt: alt, children: [], textContent: "" };
  }
};
var headedPng = DOM.pageHead(doc, "Login", "lock-blue");
assert.strictEqual(headedPng.children[1].className, "h-title-icon icon-state", "png marked icon-state");
var headedSvg = DOM.pageHead(doc, "Explore (9)", "server");
assert.strictEqual(headedSvg.children[1].className, "h-title-icon", "svg keeps theme filter");
delete global.Icon;

console.log("DOM utils: 7 passed, 0 failed");
console.log("DOM pageHead: 6 passed, 0 failed");