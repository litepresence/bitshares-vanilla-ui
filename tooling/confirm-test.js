"use strict";
// confirm-test.js — TDD test for vanilla/js/ui/confirm.js (Task 3.1).
// Fake-doc asserts the common confirm subset: heading + dl.confirm with
// dt/dd pairs (textContent-only), fee line, Back (ghost) + Send buttons,
// Esc→onBack, click Back→onBack, click Send→onSend.
var path = require("path");
var assert = require("assert");

// confirm.js consumes the DOM + touchable globals (script-tag order in
// index.html: dom.js, touchable.js, then ui/confirm.js). Mirror that here.
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
global.DOM = DOM;
global.touchable = require(path.join(__dirname, "..", "vanilla", "js", "utils", "touchable.js"));

var ConfirmDialog = require(path.join(__dirname, "..", "vanilla", "js", "ui", "confirm.js"));

function fakeEl(tag) {
  var el = {
    tag: tag,
    children: [],
    textContent: "",
    className: "",
    style: {},
    type: "",
    disabled: false,
    __handlers: {}
  };
  el.setAttribute = function (k, v) { this[k] = v; };
  el.getAttribute = function (k) { return this[k]; };
  el.hasAttribute = function (k) {
    return Object.prototype.hasOwnProperty.call(this, k);
  };
  el.removeAttribute = function (k) { delete this[k]; };
  el.appendChild = function (c) { this.children.push(c); return c; };
  el.insertBefore = function (c, ref) {
    var i = this.children.indexOf(ref);
    if (i === -1) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  };
  el.addEventListener = function (t, fn) { this.__handlers[t] = fn; };
  el.removeEventListener = function (t, fn) {
    if (this.__handlers[t] === fn) delete this.__handlers[t];
  };
  return el;
}

function fakeDoc() {
  var handlers = {};
  return {
    __handlers: handlers,
    createElement: function (tag) { return fakeEl(tag); },
    addEventListener: function (t, fn) { handlers[t] = fn; },
    removeEventListener: function (t, fn) {
      if (handlers[t] === fn) delete handlers[t];
    }
  };
}

function findAll(root, tag) {
  var out = [];
  (function walk(n) {
    if (n.tag === tag) out.push(n);
    (n.children || []).forEach(walk);
  })(root);
  return out;
}

var passed = 0;
var doc = fakeDoc();
var backCalled = 0;
var sendCalled = 0;
var rows = [["From", "alice (1.2.1)"], ["To", "bob (1.2.2)"]];
var feeHuman = "0.12345 BTS";

var box = ConfirmDialog.show({
  doc: doc,
  title: "Confirm transfer",
  rows: rows,
  feeHuman: feeHuman,
  onBack: function () { backCalled += 1; },
  onSend: function () { sendCalled += 1; }
});

// 1. Returns the container element holding a heading with the title.
assert.ok(box && box.children, "show returns the container element");
var heads = findAll(box, "h3");
assert.strictEqual(heads.length, 1, "one h3 heading");
assert.strictEqual(heads[0].textContent, "Confirm transfer");
passed += 3;

// 2. Rows render as dl.confirm with dt/dd pairs, textContent-only.
var dls = findAll(box, "dl");
assert.strictEqual(dls.length, 1, "one dl");
assert.ok(
  String(dls[0].className).split(" ").indexOf("confirm") !== -1,
  "dl carries the confirm class"
);
passed += 2;
var dts = findAll(dls[0], "dt");
var dds = findAll(dls[0], "dd");
assert.strictEqual(dts.length, rows.length + 1, "dt per row plus the fee line");
assert.strictEqual(dds.length, rows.length + 1, "dd per row plus the fee line");
passed += 2;
assert.strictEqual(dts[0].textContent, "From");
assert.strictEqual(dds[0].textContent, "alice (1.2.1)");
assert.strictEqual(dts[1].textContent, "To");
assert.strictEqual(dds[1].textContent, "bob (1.2.2)");
passed += 4;
assert.ok(!("innerHTML" in dds[0]), "dd uses textContent, never innerHTML");
passed += 1;

// 3. Fee line carries the human fee text.
var feeHit = dds.filter(function (dd) {
  return dd.textContent === feeHuman;
});
assert.strictEqual(feeHit.length, 1, "fee line shows the human fee text");
passed += 1;

// 4. Two buttons: Back (ghost) + primary Send action.
var btns = findAll(box, "button");
assert.strictEqual(btns.length, 2, "Back + Send buttons");
var back = btns.filter(function (b) {
  return String(b.className).split(" ").indexOf("btn-ghost") !== -1;
})[0];
assert.ok(back, "Back carries the btn-ghost class");
assert.ok(back.textContent.indexOf("Back") !== -1, "Back keeps its label");
var send = btns.filter(function (b) { return b !== back; })[0];
assert.ok(send.textContent.indexOf("Send") !== -1, "action keeps its Send label");
assert.strictEqual(back.type, "button");
assert.strictEqual(send.type, "button");
passed += 5;

// 5. Esc key routes to onBack.
assert.ok(typeof doc.__handlers.keydown === "function", "Esc listener wired");
doc.__handlers.keydown({ key: "Escape" });
assert.strictEqual(backCalled, 1, "Esc fires onBack");
passed += 2;

// 6. Clicks route: Back→onBack, Send→onSend.
back.__handlers.click();
assert.strictEqual(backCalled, 2, "Back click fires onBack");
send.__handlers.click();
assert.strictEqual(sendCalled, 1, "Send click fires onSend");
passed += 2;

// 7. Fee term fallback: absent feeTerm renders dt "Fee" (legacy output).
assert.strictEqual(dts[dts.length - 1].textContent, "Fee", "absent feeTerm falls back to Fee");
passed += 1;

// 8. Fee term passed: caller's keyed string renders as the fee dt.
var doc2 = fakeDoc();
var feeTermBox = ConfirmDialog.show({
  doc: doc2,
  title: "Confirm",
  rows: [],
  feeHuman: feeHuman,
  feeTerm: "Fee (live)",
  onBack: function () {},
  onSend: function () {}
});
var feeDts = findAll(feeTermBox, "dt");
assert.strictEqual(feeDts[feeDts.length - 1].textContent, "Fee (live)", "passed feeTerm renders");
passed += 1;

// 9. Raw titles: [term, text, raw] sets dd.title; [term, text] sets none.
var doc3 = fakeDoc();
var rawBox = ConfirmDialog.show({
  doc: doc3,
  title: "Confirm",
  rows: [["Amount", "1.0 BTS", "100000"], ["Memo", "(none)"]],
  feeHuman: feeHuman,
  onBack: function () {},
  onSend: function () {}
});
var rawDds = findAll(rawBox, "dd");
assert.strictEqual(rawDds[0].title, "100000", "third element sets dd.title");
assert.ok(!rawDds[1].title, "two-element row sets no title");
passed += 2;

// 10. Fee raw title: feeRawTitle present sets the fee dd.title (principle #6).
var doc4 = fakeDoc();
var feeRawBox = ConfirmDialog.show({
  doc: doc4,
  title: "Confirm",
  rows: [],
  feeHuman: feeHuman,
  feeTerm: "Fee",
  feeRawTitle: "12345",
  onBack: function () {},
  onSend: function () {}
});
var feeRawDds = findAll(feeRawBox, "dd");
assert.strictEqual(feeRawDds[feeRawDds.length - 1].title, "12345", "feeRawTitle sets fee dd.title");
passed += 1;

// 11. Fee raw title absent: no title attr on the fee dd (feeTerm fallback unchanged).
var doc5 = fakeDoc();
var noRawBox = ConfirmDialog.show({
  doc: doc5,
  title: "Confirm",
  rows: [],
  feeHuman: feeHuman,
  onBack: function () {},
  onSend: function () {}
});
var noRawDds = findAll(noRawBox, "dd");
assert.ok(!noRawDds[noRawDds.length - 1].title, "absent feeRawTitle sets no title");
passed += 1;

// 12. Raw drill-down: rawJson renders details.raw (summary + pre) BEFORE
// the actions (review -> raw -> buttons order).
var doc6 = fakeDoc();
var rawJsonBox = ConfirmDialog.show({
  doc: doc6,
  title: "Confirm",
  rows: [["Amount", "1.0 BTS"]],
  rawJson: '{"op":[0,{"amount":"100000"}]}',
  rawLabel: "Show unsigned operation JSON",
  onBack: function () {},
  onSend: function () {}
});
var dets = findAll(rawJsonBox, "details");
assert.strictEqual(dets.length, 1, "one raw details renders");
assert.strictEqual(dets[0].className, "raw", "details carries the raw contract class");
var sums = findAll(rawJsonBox, "summary");
assert.strictEqual(sums[0].textContent, "Show unsigned operation JSON", "caller rawLabel renders");
assert.strictEqual(sums[0]["aria-label"], "Show unsigned operation JSON", "summary mirrors aria-label");
passed += 3;
var pres = findAll(rawJsonBox, "pre");
assert.strictEqual(pres[0].textContent, '{"op":[0,{"amount":"100000"}]}', "pre carries the raw JSON verbatim");
passed += 1;
var kidTags = rawJsonBox.children.map(function (c) { return c.tag; });
assert.deepStrictEqual(kidTags, ["h3", "dl", "details", "div"], "raw sits between list and actions");
passed += 1;

// 13. Raw label fallback + absence: omitted rawLabel falls back to the
// literal; omitted/non-string rawJson renders no details.
var doc7 = fakeDoc();
var rawFbBox = ConfirmDialog.show({
  doc: doc7,
  title: "Confirm",
  rows: [],
  rawJson: "{}",
  onBack: function () {},
  onSend: function () {}
});
assert.strictEqual(findAll(rawFbBox, "summary")[0].textContent, "Raw JSON", "rawLabel falls back to Raw JSON");
passed += 1;
var doc8 = fakeDoc();
var noJsonBox = ConfirmDialog.show({
  doc: doc8,
  title: "Confirm",
  rows: [],
  onBack: function () {},
  onSend: function () {}
});
assert.strictEqual(findAll(noJsonBox, "details").length, 0, "absent rawJson renders no details");
passed += 1;
var doc9 = fakeDoc();
var badJsonBox = ConfirmDialog.show({
  doc: doc9,
  title: "Confirm",
  rows: [],
  rawJson: { op: 0 },
  onBack: function () {},
  onSend: function () {}
});
assert.strictEqual(findAll(badJsonBox, "details").length, 0, "non-string rawJson renders no details");
passed += 1;

// 14. rawObj: plain objects stringify here; unstringifiable fails closed.
var doc10 = fakeDoc();
var rawObjBox = ConfirmDialog.show({
  doc: doc10,
  title: "Confirm",
  rows: [],
  rawObj: { op: [0, { amount: "100000" }] },
  rawLabel: "Show unsigned operation JSON",
  onBack: function () {},
  onSend: function () {}
});
var objPres = findAll(rawObjBox, "pre");
assert.strictEqual(objPres.length, 1, "rawObj renders the drill-down");
assert.ok(objPres[0].textContent.indexOf('"amount": "100000"') !== -1, "rawObj stringifies with indent");
passed += 2;
var doc11 = fakeDoc();
var bigBox = ConfirmDialog.show({
  doc: doc11,
  title: "Confirm",
  rows: [],
  rawObj: { amount: BigInt(100000) },
  onBack: function () {},
  onSend: function () {}
});
assert.strictEqual(findAll(bigBox, "details").length, 0, "unstringifiable rawObj fails closed");
passed += 1;

console.log("ConfirmDialog: " + passed + " passed, 0 failed");
