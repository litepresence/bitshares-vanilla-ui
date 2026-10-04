"use strict";
var path = require("path");
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