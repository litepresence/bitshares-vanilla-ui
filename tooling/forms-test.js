"use strict";
// forms-test.js — TDD test for vanilla/js/forms/field.js (Task 2.1).
// Fake-doc asserts: fieldRow structure/grid class, labeledInput
// placeholder passthrough, labeledSelect preselect.
var path = require("path");
var assert = require("assert");

// field.js consumes the DOM + touchable globals (script-tag order in
// index.html: dom.js, touchable.js, then forms/field.js). Mirror that here.
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
global.DOM = DOM;
try {
  global.touchable = require(path.join(__dirname, "..", "vanilla", "js", "utils", "touchable.js"));
} catch (e) { /* touchable optional in Node; fieldRow guards with typeof */ }

var Forms = require(path.join(__dirname, "..", "vanilla", "js", "forms", "field.js"));

function fakeDoc() {
  return {
    createElement: function (tag) {
      var el = {
        tag: tag,
        children: [],
        textContent: "",
        className: "",
        style: {},
        value: "",
        type: ""
      };
      el.setAttribute = function (k, v) { this[k] = v; };
      el.getAttribute = function (k) { return this[k]; };
      el.hasAttribute = function (k) {
        return Object.prototype.hasOwnProperty.call(this, k);
      };
      el.removeAttribute = function (k) { delete this[k]; };
      el.appendChild = function (c) { this.children.push(c); return c; };
      return el;
    }
  };
}

var passed = 0;

var doc = fakeDoc();

// 1. fieldRow: div.xfer-field > label wrapping label text + input element.
var input = doc.createElement("input");
var row = Forms.fieldRow(doc, "Amount ", input);
assert.strictEqual(row.tag, "div");
assert.ok(
  String(row.className).split(" ").indexOf("xfer-field") !== -1,
  "fieldRow row carries xfer-field grid class"
);
passed += 2;
assert.strictEqual(row.children.length, 1, "fieldRow row holds one label");
var label = row.children[0];
assert.strictEqual(label.tag, "label");
assert.ok(
  String(label.textContent).indexOf("Amount") !== -1,
  "fieldRow label keeps label text"
);
passed += 3;
assert.strictEqual(
  label.children[label.children.length - 1],
  input,
  "fieldRow label nests the input element"
);
passed += 1;

// 2. labeledInput: builds input with placeholder/inputmode passthrough.
var li = Forms.labeledInput(doc, "Name ", {
  id: "x-name",
  placeholder: "your-name",
  inputmode: "text"
});
assert.ok(
  String(li.row.className).split(" ").indexOf("xfer-field") !== -1,
  "labeledInput row carries xfer-field grid class"
);
assert.strictEqual(li.input.tag, "input");
assert.strictEqual(li.input.id, "x-name");
assert.strictEqual(li.input.placeholder, "your-name");
assert.strictEqual(li.input.inputmode, "text");
passed += 5;

// 3. labeledSelect: options as [value,label] pairs, preselected value.
var ls = Forms.labeledSelect(doc, "Coin ", [["a", "A"], ["b", "B"]], "b");
assert.ok(
  String(ls.row.className).split(" ").indexOf("xfer-field") !== -1,
  "labeledSelect row carries xfer-field grid class"
);
assert.strictEqual(ls.select.tag, "select");
assert.strictEqual(ls.select.children.length, 2);
assert.strictEqual(ls.select.children[0].value, "a");
assert.strictEqual(ls.select.children[0].textContent, "A");
assert.ok(
  ls.select.children[1].selected === true ||
    ls.select.children[1].selected === "selected",
  "labeledSelect preselects the given value"
);
assert.ok(
  !ls.select.children[0].selected,
  "labeledSelect leaves other options unselected"
);
passed += 6;

// 4. labeledTextarea: builds textarea wrapped in fieldRow.
var ta = Forms.labeledTextarea(doc, "Memo ", { id: "x-memo", placeholder: "hi" });
assert.ok(
  String(ta.row.className).split(" ").indexOf("xfer-field") !== -1,
  "labeledTextarea row carries xfer-field grid class"
);
assert.strictEqual(ta.input.tag, "textarea");
assert.strictEqual(ta.input.id, "x-memo");
passed += 3;

console.log("Forms utils: " + passed + " passed, 0 failed");
