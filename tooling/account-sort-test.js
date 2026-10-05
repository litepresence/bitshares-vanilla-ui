#!/usr/bin/env node
/* account-sort-test.js — unit + fake-doc vectors for the portfolio sort
 * (vanilla/js/views/account-ui.js renderPortfolio/sortPortfolioRows,
 * Task 5 polish batch).
 * Contract mirrors explorer-assets.js:582-600 sortTh exactly: default
 * sortKey null = chain order; header click sorts ascending, click again
 * reverses; th carries aria-sort (ascending/descending/none).
 * Sortable keys: asset (symbol alpha), qty (numeric on raw), price and
 * value (numeric, dashed/missing rows pinned last in BOTH directions).
 * Stdlib only: `node tooling/account-sort-test.js` (exit 0 = green).
 * No network, no deps.
 */
"use strict";
var assert = require("assert");
var AccountUI = require("../vanilla/js/views/account-ui.js");

var passed = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
}
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* sortPortfolioRows + renderPortfolio seams must exist (Task 5). */
var T = AccountUI._test || {};
assert.ok(typeof T.sortPortfolioRows === "function", "sortPortfolioRows exported (portfolio has a sorter)");
assert.ok(typeof T.renderPortfolio === "function", "renderPortfolio exported (fake-doc check needs the seam)");
var sortRows = T.sortPortfolioRows;

/* Small enriched-row fixture (rowFor shape): b.{symbol, raw}, priceFull
 * ("" = missing/dashed), valueRaw (null = missing/dashed). */
function R(sym, raw, priceFull, valueRaw) {
  return { b: { symbol: sym, raw: raw }, priceFull: priceFull, valueRaw: valueRaw };
}
function syms(rows) {
  return rows.map(function (r) { return r.b.symbol; });
}
var chain = [
  R("ZEBRA", "10", "2.5", "25"),
  R("BTS", "9", "1", "9"),
  R("AAA", "200", "10.25", "2050000"),
  R("NODATA", "50", "", null)
];

/* 1: default null = chain order (a copy, input untouched). */
eq(syms(sortRows(chain, null, 1)), ["ZEBRA", "BTS", "AAA", "NODATA"], "null sortKey keeps chain order");
eq(syms(chain), ["ZEBRA", "BTS", "AAA", "NODATA"], "sorter does not mutate the input");
eq(syms(sortRows(chain, "nope", 1)), ["ZEBRA", "BTS", "AAA", "NODATA"], "unknown key keeps chain order");

/* 2: asset alpha + reverse. */
eq(syms(sortRows(chain, "asset", 1)), ["AAA", "BTS", "NODATA", "ZEBRA"], "asset ascending alpha");
eq(syms(sortRows(chain, "asset", -1)), ["ZEBRA", "NODATA", "BTS", "AAA"], "asset descending reverses");

/* 3: qty numeric on raw (9 < 10 < 50 < 200 — lexicographic would differ). */
eq(syms(sortRows(chain, "qty", 1)), ["BTS", "ZEBRA", "NODATA", "AAA"], "qty ascending numeric on raw");
eq(syms(sortRows(chain, "qty", -1)), ["AAA", "NODATA", "ZEBRA", "BTS"], "qty descending numeric on raw");

/* 4: price numeric via exact decimals (1 < 2.5 < 10.25), missing last both ways. */
eq(syms(sortRows(chain, "price", 1)), ["BTS", "ZEBRA", "AAA", "NODATA"], "price ascending numeric");
eq(syms(sortRows(chain, "price", -1)), ["AAA", "ZEBRA", "BTS", "NODATA"], "price descending keeps dashed-last");

/* 5: value numeric on valueRaw (9 < 25 < 2050000), missing last both ways. */
eq(syms(sortRows(chain, "value", 1)), ["BTS", "ZEBRA", "AAA", "NODATA"], "value ascending numeric");
eq(syms(sortRows(chain, "value", -1)), ["AAA", "ZEBRA", "BTS", "NODATA"], "value descending keeps dashed-last");

/* ---- Fake-doc DOM check: real renderPortfolio, click real headers. ---- */
function fakeEl(tag) {
  var el = {
    tag: tag,
    tagName: String(tag).toUpperCase(),
    children: [],
    textContent: "",
    className: "",
    title: "",
    type: "",
    value: "",
    placeholder: "",
    style: {},
    _attrs: {},
    _listeners: {}
  };
  Object.defineProperty(el, "firstChild", {
    get: function () { return this.children.length ? this.children[0] : null; }
  });
  el.setAttribute = function (k, v) { this._attrs[k] = String(v); };
  el.getAttribute = function (k) {
    return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null;
  };
  el.appendChild = function (c) { this.children.push(c); return c; };
  el.removeChild = function (c) {
    var i = this.children.indexOf(c);
    if (i !== -1) this.children.splice(i, 1);
    return c;
  };
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
    createElement: function (tag) { return fakeEl(tag); },
    createTextNode: function (text) { return { tag: "#text", textContent: String(text), children: [] }; }
  };
}
function walk(node, pred, out) {
  out = out || [];
  if (!node || !node.children) return out;
  node.children.forEach(function (c) {
    if (pred(c)) out.push(c);
    walk(c, pred, out);
  });
  return out;
}
function theadThs(section) {
  var theads = walk(section, function (n) { return n.tag === "thead"; });
  assert.ok(theads.length === 1, "one thead rendered");
  var trs = (theads[0].children || []).filter(function (c) { return c.tag === "tr"; });
  assert.ok(trs.length === 1, "one header row rendered");
  return trs[0].children;
}
function headerButtonFor(section, labelPrefix) {
  var ths = theadThs(section);
  var hit = null;
  ths.forEach(function (th) {
    (th.children || []).forEach(function (c) {
      if (c.tag === "button" && String(c.textContent).indexOf(labelPrefix) === 0) hit = { th: th, btn: c };
    });
  });
  assert.ok(hit, "sortable header button for " + labelPrefix);
  return hit;
}
function bodySyms(section) {
  var tbodies = walk(section, function (n) { return n.tag === "tbody"; });
  assert.ok(tbodies.length === 1, "one tbody rendered");
  return tbodies[0].children.map(function (tr) {
    var first = tr.children[0];
    var anchor = (first.children || []).filter(function (c) { return c.tag === "a"; })[0];
    return anchor ? anchor.textContent : first.textContent;
  });
}
function ariaSorts(section) {
  return theadThs(section).map(function (th) { return th.getAttribute("aria-sort"); });
}

var doc = fakeDoc();
var section = fakeEl("section");
var balances = [
  { asset_id: "1.3.5", symbol: "ZEBRA", raw: "10", display: "0.00010", precision: 5 },
  { asset_id: "1.3.0", symbol: "BTS", raw: "9", display: "0.00009", precision: 5 },
  { asset_id: "1.3.7", symbol: "AAA", raw: "200", display: "2.00", precision: 2 },
  { asset_id: "1.3.9", symbol: "NODATA", raw: "50", display: "0.50", precision: 2 }
];
var enrich = {
  inOrders: {}, vesting: {}, collateral: {},
  prices: {
    "1.3.5": { latest: "2.5", change: "1.0" },
    "1.3.7": { latest: "10.25", change: "-0.5" }
  },
  bts: { id: "1.3.0", prec: 5, symbol: "BTS" },
  capped: false, notes: []
};
T.renderPortfolio(doc, section, { id: "1.2.5", name: "tester" }, balances, enrich);

/* 6: default paint = chain order, all sortable ths aria-sort none. */
eq(bodySyms(section), ["ZEBRA", "BTS", "AAA", "NODATA"], "default paint keeps chain order");
ok(ariaSorts(section).indexOf("ascending") === -1 && ariaSorts(section).indexOf("descending") === -1,
  "no aria-sort set before any click");

/* 7: click Asset -> alpha; click again -> reverse; aria-sort tracks. */
headerButtonFor(section, "Asset").btn.fire("click");
eq(bodySyms(section), ["AAA", "BTS", "NODATA", "ZEBRA"], "asset click sorts alpha");
eq(headerButtonFor(section, "Asset").th.getAttribute("aria-sort"), "ascending", "asset aria-sort ascending");
headerButtonFor(section, "Asset").btn.fire("click");
eq(bodySyms(section), ["ZEBRA", "NODATA", "BTS", "AAA"], "asset click again reverses");
eq(headerButtonFor(section, "Asset").th.getAttribute("aria-sort"), "descending", "asset aria-sort descending");

/* 8: click QTY -> numeric on raw; PRICE/VALUE keep dashed-last. */
headerButtonFor(section, "QTY").btn.fire("click");
eq(bodySyms(section), ["BTS", "ZEBRA", "NODATA", "AAA"], "qty click sorts numeric on raw");
headerButtonFor(section, "PRICE(BTS)").btn.fire("click");
eq(bodySyms(section), ["BTS", "ZEBRA", "AAA", "NODATA"], "price click sorts numeric, missing last");
headerButtonFor(section, "VALUE(BTS)").btn.fire("click");
eq(bodySyms(section), ["BTS", "ZEBRA", "AAA", "NODATA"], "value click sorts numeric, missing last");
headerButtonFor(section, "VALUE(BTS)").btn.fire("click");
eq(bodySyms(section), ["AAA", "ZEBRA", "BTS", "NODATA"], "value click again reverses, missing stays last");

/* ---- Polish Task 6: portfolio price paging (25/page replaces first-20 cap).
 * Pure-function vectors (no Chain needed): page size 25,
 * pageCount = ceil(n/25), out-of-range page clamps, priced set = current
 * page's ids only (BTS excluded — it prices at 1 with no call). ---- */
var PAGE = AccountUI._test || {};
assert.ok(typeof PAGE.portfolioPageCount === "function", "portfolioPageCount exported (pager math is pure)");
assert.ok(typeof PAGE.clampPortfolioPage === "function", "clampPortfolioPage exported (out-of-range clamps)");
assert.ok(typeof PAGE.portfolioPageIds === "function", "portfolioPageIds exported (priced set is the page slice)");
assert.ok(PAGE.PORTFOLIO_PAGE_SIZE === 25, "portfolio page size is 25");
var pageCount = PAGE.portfolioPageCount;
var clampPage = PAGE.clampPortfolioPage;
var pageIds = PAGE.portfolioPageIds;

/* 9: pageCount = ceil(n/25). */
eq(pageCount(0), 0, "pageCount empty is 0");
eq(pageCount(1), 1, "pageCount single row is 1");
eq(pageCount(25), 1, "pageCount full page is 1");
eq(pageCount(26), 2, "pageCount 26 spills to 2");
eq(pageCount(50), 2, "pageCount two full pages is 2");
eq(pageCount(51), 3, "pageCount partial last page rounds up");

/* 10: out-of-range page clamps. */
eq(clampPage(0, 0), 0, "clamp with no pages is 0");
eq(clampPage(1, 3), 1, "clamp in-range page stands");
eq(clampPage(5, 3), 2, "clamp high page pins to last");
eq(clampPage(-1, 3), 0, "clamp negative page pins to first");

/* 11: priced set = current page's ids only (BTS excluded). 30 balances with
 * BTS at index 10: page 0 prices indices 0..24 minus BTS (24 ids), page 1
 * prices the partial tail (5 ids), page 7 clamps to the tail. */
function bal30() {
  var out = [], i;
  for (i = 0; i < 30; i++) {
    if (i === 10) out.push({ asset_id: "1.3.0", symbol: "BTS" });
    else out.push({ asset_id: "1.3." + (100 + i), symbol: "SYM" + i });
  }
  return out;
}
var ids0 = pageIds(bal30(), "1.3.0", 0);
eq(ids0.length, 24, "page 0 prices 24 non-BTS ids");
ok(ids0.indexOf("1.3.0") === -1, "page 0 priced set excludes BTS");
eq(ids0[0], "1.3.100", "page 0 priced set starts at the first balance");
var ids1 = pageIds(bal30(), "1.3.0", 1);
eq(ids1.length, 5, "page 1 prices the partial tail (5 ids)");
eq(ids1[ids1.length - 1], "1.3.129", "page 1 priced set ends at the last balance");
eq(pageIds(bal30(), "1.3.0", 7), ids1, "out-of-range page clamps to the tail set");

/* 12: fake-doc pager — 30 balances render 25 rows + Prev/Next pager; page
 * turn shows the tail. Chain is absent in node so the tail prices stay
 * dashed, but the rows still render (missing legs dash, never blank). */
function pagerBar(sec) {
  var bars = walk(sec, function (n) { return n.className === "pools-pager"; });
  assert.ok(bars.length === 1, "one pager bar rendered");
  return bars[0];
}
function pageLabelText(sec) {
  var spans = walk(sec, function (n) { return n.className === "pools-page"; });
  assert.ok(spans.length === 1, "one page label rendered");
  return spans[0].textContent;
}
function pagerButtons(sec) {
  return pagerBar(sec).children.filter(function (c) { return c.tag === "button"; });
}
var doc2 = fakeDoc();
var section2 = fakeEl("section");
var balances30 = bal30().map(function (b, i) {
  return { asset_id: b.asset_id, symbol: b.symbol, raw: String(1000 + i), display: "1.000", precision: 5 };
});
var prices0 = {};
ids0.forEach(function (aid) { prices0[aid] = { latest: "2.0", change: "0.5" }; });
var enrich30 = {
  inOrders: {}, vesting: {}, collateral: {},
  prices: prices0,
  bts: { id: "1.3.0", prec: 5, symbol: "BTS" },
  capped: true, notes: [],
  paging: { page: 0, pageSize: 25, pageCount: 2, total: 30 }
};
T.renderPortfolio(doc2, section2, { id: "1.2.5", name: "tester" }, balances30, enrich30);
eq(bodySyms(section2).length, 25, "page 0 shows 25 rows");
eq(pageLabelText(section2), "Page 1 of 2", "pager label starts at page 1 of 2");
var btns0 = pagerButtons(section2);
eq(btns0.length, 2, "pager has Prev + Next");
ok(btns0[0].disabled === true, "Prev disabled on the first page");
ok(btns0[1].disabled !== true, "Next enabled with more pages");
btns0[1].fire("click");
eq(bodySyms(section2).length, 5, "Next shows the partial tail page");
eq(pageLabelText(section2), "Page 2 of 2", "pager label tracks the page turn");
var btns1 = pagerButtons(section2);
ok(btns1[0].disabled !== true, "Prev enabled past the first page");
ok(btns1[1].disabled === true, "Next disabled on the last page");
btns1[0].fire("click");
eq(bodySyms(section2).length, 25, "Prev returns to the first page");
eq(pageLabelText(section2), "Page 1 of 2", "pager label tracks the way back");

console.log("account-sort-test: " + passed + " passed, 0 failed");
