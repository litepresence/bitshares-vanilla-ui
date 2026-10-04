"use strict";
// table-test.js — TDD test for vanilla/js/ui/table.js (Task 3.4).
// Fake-doc asserts: thead titles/align (+ scope="col"), td count per row
// with data-k attrs, data-rowkey values from keyExtractor, rowClass applied,
// click -> onRowClick with the row object, keyboard Enter/Space -> same,
// tabindex="0" only when onRowClick is present.
var path = require("path");
var assert = require("assert");

// table.js consumes the DOM global (script-tag order in index.html: dom.js
// first, ui/table.js later). Mirror that here with the real shared module.
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
global.DOM = DOM;

var TableRenderer = require(path.join(__dirname, "..", "vanilla", "js", "ui", "table.js"));

function fakeEl(tag) {
  var el = {
    tag: tag,
    tagName: String(tag).toUpperCase(),
    children: [],
    textContent: "",
    className: "",
    style: {},
    _attrs: {},
    _listeners: {}
  };
  el.setAttribute = function (k, v) { this._attrs[k] = String(v); };
  el.getAttribute = function (k) {
    return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null;
  };
  el.hasAttribute = function (k) {
    return Object.prototype.hasOwnProperty.call(this._attrs, k);
  };
  el.removeAttribute = function (k) { delete this._attrs[k]; };
  el.appendChild = function (c) { this.children.push(c); return c; };
  el.addEventListener = function (type, fn) {
    this._listeners[type] = this._listeners[type] || [];
    this._listeners[type].push(fn);
  };
  el.fire = function (type, evt) {
    (this._listeners[type] || []).slice().forEach(function (fn) { fn(evt || {}); });
  };
  return el;
}

function fakeDoc() {
  return {
    createElement: function (tag) { return fakeEl(tag); }
  };
}

global.document = fakeDoc();

function find(tag, root) {
  var out = [];
  (function walk(node) {
    if (!node || !node.children) return;
    node.children.forEach(function (c) {
      if (c.tag === tag) out.push(c);
      walk(c);
    });
  })(root);
  return out;
}

var passed = 0;

var columns = [
  { key: "name", title: "Name" },
  { key: "qty", title: "Qty", align: "right" },
  { key: "note", title: "Note", align: "left" }
];
var rows = [
  { id: "1.2.1", name: "alice", qty: "10.5", note: "hi" },
  { id: "1.2.2", name: "bob", qty: "0", note: "" }
];

var seen = [];
var table = TableRenderer.render({
  columns: columns,
  rows: rows,
  keyExtractor: function (r) { return r.id; },
  rowClass: function (r) { return r.name === "alice" ? "picked" : ""; },
  onRowClick: function (row, evt) { seen.push({ row: row, evt: evt }); },
  stickyFirstCol: true
});

// 1. table shell: <table class="node-table"> (the existing sticky-first-
// column + striping + uppercase-header contract lives in app.css on this
// class — no new CSS), with thead + tbody.
assert.strictEqual(table.tag, "table");
assert.ok(
  String(table.className).split(" ").indexOf("node-table") !== -1,
  "table carries the node-table class contract"
);
passed += 2;
assert.strictEqual(find("thead", table).length, 1, "one thead");
assert.strictEqual(find("tbody", table).length, 1, "one tbody");
passed += 2;

// 2. thead: one th per column, titles via textContent, scope="col",
// right align on the Qty column only, left default elsewhere.
var ths = find("th", table);
assert.strictEqual(ths.length, 3, "th count matches columns");
assert.strictEqual(ths[0].textContent, "Name");
assert.strictEqual(ths[1].textContent, "Qty");
assert.strictEqual(ths[2].textContent, "Note");
passed += 4;
ths.forEach(function (th) {
  assert.strictEqual(th.getAttribute("scope"), "col", "th scope=col");
});
passed += 3;
assert.strictEqual(ths[1].style.textAlign, "right", "align:right column right-aligns");
assert.ok(
  ths[0].style.textAlign !== "right" && ths[2].style.textAlign !== "right",
  "default/left columns do not right-align"
);
passed += 2;

// 3. tbody: one td per column per row, data-k = column key, textContent-only
// cell text, data-rowkey from keyExtractor.
var tbodies = find("tbody", table);
var trs = tbodies[0].children;
assert.strictEqual(trs.length, 2, "row count matches rows");
passed += 1;
trs.forEach(function (tr, i) {
  assert.strictEqual(tr.children.length, 3, "td count matches columns (row " + i + ")");
  assert.strictEqual(tr.children[0].getAttribute("data-k"), "name");
  assert.strictEqual(tr.children[1].getAttribute("data-k"), "qty");
  assert.strictEqual(tr.children[2].getAttribute("data-k"), "note");
  assert.strictEqual(tr.children[0].textContent, rows[i].name);
  assert.strictEqual(tr.children[1].textContent, rows[i].qty);
  assert.strictEqual(tr.children[1].style.textAlign, "right", "right-align carries to td");
});
passed += 2 + 6 * 2;

// 4. data-rowkey values come from keyExtractor.
assert.strictEqual(trs[0].getAttribute("data-rowkey"), "1.2.1");
assert.strictEqual(trs[1].getAttribute("data-rowkey"), "1.2.2");
passed += 2;

// 5. rowClass(row) string lands on the row.
assert.ok(
  String(trs[0].className).split(" ").indexOf("picked") !== -1,
  "rowClass applied to matching row"
);
assert.ok(
  String(trs[1].className).split(" ").indexOf("picked") === -1,
  "rowClass absent on non-matching row"
);
passed += 2;

// 6. click -> onRowClick with the row object (no hover-only UI: a real
// listener, not mouseenter).
assert.strictEqual(trs[0].getAttribute("tabindex"), "0", "clickable row is keyboard-focusable");
trs[1].fire("click", { type: "click" });
assert.strictEqual(seen.length, 1, "click fires onRowClick once");
assert.strictEqual(seen[0].row, rows[1], "onRowClick receives the row object");
passed += 3;

// 7. keyboard Enter/Space -> same handler (tap/click parity, no hover-only).
trs[0].fire("keydown", { key: "Enter", preventDefault: function () {} });
assert.strictEqual(seen.length, 2, "Enter fires onRowClick");
assert.strictEqual(seen[1].row, rows[0], "Enter passes the row object");
trs[0].fire("keydown", { key: " ", preventDefault: function () {} });
assert.strictEqual(seen.length, 3, "Space fires onRowClick");
assert.strictEqual(seen[2].row, rows[0], "Space passes the row object");
passed += 4;

// 8. without onRowClick: no tabindex, no listeners, no crash.
var plain = TableRenderer.render({ columns: columns, rows: rows });
var plainTrs = find("tbody", plain)[0].children;
assert.strictEqual(plainTrs.length, 2, "plain render keeps rows");
assert.ok(!plainTrs[0].hasAttribute("tabindex"), "non-clickable row has no tabindex");
assert.strictEqual(find("th", plain).length, 3, "plain render keeps headers");
passed += 3;

console.log("Table renderer: " + passed + " passed, 0 failed");
