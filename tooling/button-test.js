"use strict";
var path = require("path");
var fs = require("fs");
var assert = require("assert");

global.window = { touchable: undefined };

var touchable = require(path.join(__dirname, "..", "vanilla", "js", "utils", "touchable.js"));

function fakeEl() {
  return { style: {} };
}

var el = fakeEl();
var out = touchable(el);
assert.strictEqual(out, el, "returns same element");
assert.strictEqual(el.style.minHeight, "44px", "minHeight set");
assert.strictEqual(el.style.minWidth, "44px", "minWidth set");
assert.ok(window.touchable === touchable, "window.touchable exported");

// Native check/radio inputs: skipped (the app.css 18px reset owns their
// size; the wrapping label carries the 44px target). Inline 44px here
// rendered giant boxes (tester report).
var box = { tagName: "INPUT", type: "checkbox", style: {} };
assert.strictEqual(touchable(box), box, "returns same checkbox");
assert.strictEqual(box.style.minHeight, undefined, "checkbox minHeight untouched");
assert.strictEqual(box.style.minWidth, undefined, "checkbox minWidth untouched");
var radio = { tagName: "input", type: "radio", style: {} };
assert.strictEqual(touchable(radio), radio, "returns same radio");
assert.strictEqual(radio.style.minHeight, undefined, "radio minHeight untouched");

console.log("touchable utility: 4 passed, 0 failed");

// ===== CSS shape probe (Task 2) =====
var cssPath = path.join(__dirname, "..", "vanilla", "css", "app.css");
var css = fs.readFileSync(cssPath, "utf8");

function has(rule) {
  if (!css.includes(rule)) {
    throw new Error("Missing CSS rule: " + rule);
  }
}

// Variant classes exist
has(".btn-ghost");
has(".subtle-btn");

// Ghost hover uses accent bg + accent-text (contrast fix)
has(".btn-ghost:hover");
assert.ok(css.includes("background: var(--accent)") || css.includes("background-color: var(--accent)"), "ghost hover uses --accent");
assert.ok(css.includes("color: var(--accent-text)"), "ghost hover uses --accent-text");

// Primary hover uses button-bg-deep (not generic --panel)
assert.ok(css.includes("var(--button-bg-deep)"), "primary hover uses --button-bg-deep");

// Subtle variant class
has(".subtle-btn");

// Touch floor class
has(".touchable { min-height: 44px; min-width: 44px; }");

console.log("CSS variant shape: 7 passed, 0 failed");

// ===== Migration smoke test (Task 3) =====
var files = [
  "vanilla/js/api/explorer-tabs.js",
  "vanilla/js/api/market-book.js",
  "vanilla/js/builders/trade-cancel.js",
  "vanilla/js/builders/transfer-confirm.js",
  "vanilla/js/views/accounts-ui.js",
  "vanilla/js/views/barter-ui.js",
  "vanilla/js/views/tour-ui.js"
];
files.forEach(function(f) {
  var code = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  assert.strictEqual(code.includes("function touchable"), false, f + " still has local touchable (actual=has-local expected=migrated)");
  assert.ok(code.includes("touchable("), f + " uses touchable but may not have migrated (actual=" + code.includes("touchable(") + " expected=true)");
});
console.log("Migration smoke: " + files.length + " files clean");