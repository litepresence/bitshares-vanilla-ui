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