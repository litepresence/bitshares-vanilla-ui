/* app-shell-test.js — unit vectors for header shell purity (app.js).
 * Stdlib only: `node tooling/app-shell-test.js` (exit 0 = green). Covers
 * App._test.validPoolMarket (pool->Exchange context validation). No DOM,
 * no network, no deps.
 */
"use strict";
var assert = require("assert");
var App = require("../vanilla/js/app.js");
var T = App._test;
assert.ok(T && typeof T.validPoolMarket === "function", "_test.validPoolMarket exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

eq(T.validPoolMarket("BTS_CNY"), true, "canonical pair");
eq(T.validPoolMarket("bts_cny"), true, "lowercase accepted (uppercased at set)");
eq(T.validPoolMarket("HONEST.BTC_BTS"), true, "dotted symbols accepted");
eq(T.validPoolMarket("1.3.113"), false, "bare object id rejected");
eq(T.validPoolMarket("1.3.113_1.3.0"), false, "object-id pair rejected (would misroute desk)");
eq(T.validPoolMarket("BTS"), false, "no underscore rejected");
eq(T.validPoolMarket("A_B_C"), false, "three parts rejected");
eq(T.validPoolMarket(""), false, "empty rejected");
eq(T.validPoolMarket(null), false, "null rejected");
eq(T.validPoolMarket(undefined), false, "undefined rejected");
eq(T.validPoolMarket("TOOLONGTOKENNAME_X"), false, "overlong leg rejected");

console.log("app-shell-test: " + passed + " passed, 0 failed");

/* Pulldown panel shape (nav-pulldown Task 1): buildDirectory renders the
 * 7 primary bar links (via buildNavLink, icons intact) + a textless
 * separator + 6 section links + All pages, as a fixed overlay.
 * Fake-DOM, no browser, stdlib only. */
(function pulldownShape() {
  var fs = require("fs");
  var path = require("path");
  function matchPart(node, part) {
    var tag = null, attr = null, val = null, cls = null;
    var rest = String(part);
    var dot = rest.indexOf(".");
    if (dot !== -1) { cls = rest.slice(dot + 1); rest = rest.slice(0, dot); }
    var br = rest.indexOf("[");
    if (br !== -1) {
      tag = rest.slice(0, br) || null;
      var inner = rest.slice(br + 1).replace(/\]$/, "");
      var eqIdx = inner.indexOf("=");
      if (eqIdx !== -1) {
        attr = inner.slice(0, eqIdx);
        val = inner.slice(eqIdx + 1).replace(/^['"]|['"]$/g, "");
      }
    } else if (rest) { tag = rest; }
    if (tag && node.tag !== tag) return false;
    if (attr && String(node.attributes[attr]) !== val) return false;
    if (cls) {
      var classes = String(node.attributes["class"] || node.className || "").split(/\s+/);
      if (classes.indexOf(cls) === -1) return false;
    }
    return true;
  }
  function queryAll(root, sel) {
    var parts = String(sel).split(/\s+/);
    var out = [];
    function walk(node, ancestors) {
      (node.children || []).forEach(function (c) {
        var anc = ancestors.concat([node]);
        if (parts.length === 1) {
          if (matchPart(c, parts[0])) out.push(c);
        } else if (parts.length === 2) {
          if (matchPart(c, parts[1]) && anc.some(function (a) { return matchPart(a, parts[0]); })) out.push(c);
        }
        walk(c, anc);
      });
    }
    walk(root, []);
    return out;
  }
  function fakeEl(tag) {
    var el = {
      tag: String(tag).toLowerCase(),
      children: [],
      attributes: {},
      textContent: "",
      className: "",
      style: {},
      __handlers: {}
    };
    el.setAttribute = function (k, v) { el.attributes[String(k)] = String(v); };
    el.getAttribute = function (k) { return el.attributes[String(k)]; };
    el.appendChild = function (c) { el.children.push(c); return c; };
    el.addEventListener = function (t, fn) { el.__handlers[t] = fn; };
    el.removeEventListener = function (t, fn) { if (el.__handlers[t] === fn) delete el.__handlers[t]; };
    el.querySelectorAll = function (sel) { return queryAll(el, sel); };
    el.querySelector = function (sel) { var r = queryAll(el, sel); return r.length ? r[0] : null; };
    return el;
  }
  global.document = {
    createElement: function (tag) { return fakeEl(tag); },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  global.Icon = { img: function (name, cls) {
    var img = fakeEl("img");
    img.setAttribute("class", cls || "");
    img.setAttribute("src", "assets/icons/" + name + ".svg");
    img.setAttribute("alt", "");
    return img;
  } };
  global.I18n = { t: function (k, d) { return d; } };
  function section(slug, n) {
    var links = [];
    for (var i = 0; i < n; i++) links.push({ href: "#/" + slug + "-" + i });
    return { slug: slug, icon: "wallet", titleKey: "menu.t_" + slug, titleDefault: slug, links: links };
  }
  global.MenuUI = { SECTIONS: [
    section("wallet", 2), section("trade", 2), section("earn", 2),
    section("govern", 2), section("explore", 2), section("labs", 2)
  ] };
  var panel = App._test.buildDirectory(true);
  // pulldown contents: 7 primary + 6 sections + All pages, icons on primary links
  var links = panel.querySelectorAll("a");
  assert.ok(links.length >= 14, "pulldown holds bar links + sections + all-pages");
  assert.ok(panel.querySelector("a[href='#/pools'] img.nav-icon"), "pools link keeps its icon");
  assert.ok(panel.querySelector("div[role='separator']"), "textless separator between bar links and sections");
  var css = fs.readFileSync(path.join(__dirname, "..", "vanilla", "css", "app.css"), "utf8");
  assert.ok(/#nav-directory\s*\{[^}]*position:\s*fixed/.test(css), "directory is a fixed overlay, not in-flow");
  console.log("pulldown-shape: 4 passed, 0 failed");
})();

/* Phone scroll-row bar + sheet pulldown (nav-pulldown Task 2): under 719px
 * the bar stays visible as a horizontal scroll-row (flex-wrap nowrap +
 * overflow-x auto) instead of the old display:none collapse; the open panel
 * becomes a sheet with 8px gutters (left/right 8px, min-width 0). CSS-shape
 * asserts following the button-test.js precedent (read app.css text). */
(function phoneScrollRow() {
  var fs = require("fs");
  var path = require("path");
  var css = fs.readFileSync(path.join(__dirname, "..", "vanilla", "css", "app.css"), "utf8");
  assert.ok(/#nav\s*\{[^}]*flex-wrap:\s*nowrap/.test(css), "bar keeps one row instead of wrapping");
  assert.ok(/#nav\s*\{[^}]*overflow-x:\s*auto/.test(css), "bar scrolls instead of wrapping");
  assert.ok(/#nav\.open\s+#nav-directory\s*\{[^}]*left:\s*8px/.test(css), "sheet keeps a left gutter");
  assert.ok(/#nav\.open\s+#nav-directory\s*\{[^}]*right:\s*8px/.test(css), "sheet keeps a right gutter");
  assert.ok(/#nav\.open\s+#nav-directory\s*\{[^}]*min-width:\s*0/.test(css), "sheet can shrink to phone width");
  assert.ok(!/#nav\s*\{\s*display:\s*none/.test(css), "phone hide reconciled (scroll-row replaces display:none)");
  console.log("phone-scroll-row: 6 passed, 0 failed");
})();
