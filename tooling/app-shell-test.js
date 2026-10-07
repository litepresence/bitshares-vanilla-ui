/* app-shell-test.js — unit vectors for header shell purity (app.js).
 * Stdlib only: `node tooling/app-shell-test.js` (exit 0 = green). Covers
 * nav-six 6-link bar shape after the 2026-10-07 selector ladder
 * (ORIGINAL_NAV order, NAV_ICONS, navText labels, section-aware
 * navIsCurrent highlight, static fallback anchors, buy-panel borrow-link
 * gone). The pool->Exchange one-way context validation moved to
 * tooling/pair-context-test.js (same vectors, same expectations).
 * No DOM, no network, no deps.
 */
"use strict";
var assert = require("assert");
var App = require("../vanilla/js/app.js");
var T = App._test;
assert.ok(T && typeof T.navIsCurrent === "function", "_test.navIsCurrent exported");
assert.strictEqual(T.setPoolMarket, undefined, "pool->Exchange swap retired (lives in PairContext now)");
assert.strictEqual(T.validPoolMarket, undefined, "pool->Exchange swap retired (lives in PairContext now)");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* nav-six after the selector ladder: Markets + Pools are CATEGORY tabs that
 * land on the selector pages, never straight on a desk. 6 links, unchanged
 * count and order. */
eq(T.ORIGINAL_NAV.length, 6, "nav-six still 6 links");
eq(T.ORIGINAL_NAV[0], "#/", "Dashboard first");
eq(T.ORIGINAL_NAV[1], "#/markets", "second slot is the market selector");
eq(T.ORIGINAL_NAV[2], "#/pools", "third slot is the pool selector");
eq(T.NAV_ICONS["#/markets"], "trade", "Markets tab keeps the trade glyph");
eq(T.NAV_ICONS["#/pools"], "poolmart", "Pools tab keeps the poolmart glyph");
eq(T.NAV_ICONS["#/market/BTS_USD"], undefined, "no desk href in the icon map any more");
assert.strictEqual(T.navText("#/markets"), "Markets", "Markets label");
assert.strictEqual(T.navText("#/pools"), "Pools", "Pools label");

/* Section-aware current-tab highlight: one rung down still belongs to the
 * tab, a sibling never does. */
eq(T.navIsCurrent("#/markets", "#/markets"), true, "selector highlights itself");
eq(T.navIsCurrent("#/market/BTS_USD", "#/markets"), true, "market desk highlights Markets");
eq(T.navIsCurrent("#/market/ETH_BTS", "#/markets"), true, "any market desk highlights Markets");
eq(T.navIsCurrent("#/pools", "#/pools"), true, "pools selector highlights itself");
eq(T.navIsCurrent("#/pools/1.19.0", "#/pools"), true, "pool desk highlights Pools");
eq(T.navIsCurrent("#/market/BTS_USD", "#/pools"), false, "market desk does not highlight Pools");
eq(T.navIsCurrent("#/pools/1.19.0", "#/markets"), false, "pool desk does not highlight Markets");
eq(T.navIsCurrent("#/explorer", "#/explorer"), true, "exact match still highlights");
eq(T.navIsCurrent("#/explorer/blocks", "#/explorer"), false, "explorer tabs stay exact-match only");
eq(T.navIsCurrent("#/", "#/"), true, "dashboard highlights itself");
eq(T.navIsCurrent("#/market/BTS_USD", "#/"), false, "desk does not highlight Dashboard");
eq(T.navIsCurrent("#/markets?a=DOGE&b=USD", "#/markets"), true, "query-in-hash selector still highlights");
eq(T.navIsCurrent("#/pools?a=BTS&b=ETH&size=25", "#/pools"), true, "pools query-in-hash still highlights");
eq(T.navIsCurrent("#/market/ETH_BTS?tf=discrete", "#/markets"), true, "query on a desk still highlights its selector");

console.log("app-shell-test: " + passed + " passed, 0 failed");

/* Pulldown panel shape (nav-pulldown Task 3 owner rework, nav-six 2026-10-05):
 * buildDirectory renders section links ONLY — the 7 sitemap headings + All
 * pages, stacked vertically (flex column) — never the bar links (no
 * duplication), with no separator. API Lab + ES Lab are in neither menu
 * (they live on the Labs TOC page). Liquidity Pools is in neither menu
 * either (Trade sitemap page only). Fake-DOM, no browser, stdlib only. */
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
    section("govern", 2), section("explore", 2), section("labs", 2),
    section("personal", 2)
  ] };
  var panel = App._test.buildDirectory(true);
  // pulldown contents: 7 section links + All pages, sections-only, vertical
  var links = panel.querySelectorAll("a");
  assert.strictEqual(links.length, 8, "pulldown holds 7 sections + all-pages (got " + links.length + ")");
  links.forEach(function (a) {
    var href = a.attributes.href || "";
    assert.ok(href.indexOf("#/menu") === 0, "sections-only: " + href + " lives under #/menu");
  });
  assert.ok(!panel.querySelector("a[href='#/']"), "no dashboard duplication");
  assert.ok(!panel.querySelector("a[href='#/market/BTS_USD']"), "no Exchange duplication");
  assert.ok(!panel.querySelector("a[href='#/credit-offer']"), "no Credit duplication");
  assert.ok(!panel.querySelector("a[href='#/borrow']"), "no Margin duplication");
  assert.ok(!panel.querySelector("a[href='#/explorer']"), "no Explore duplication");
  assert.ok(!panel.querySelector("a[href='#/pools']"), "pools in neither menu (Trade sitemap only)");
  assert.ok(panel.querySelector("a[href='#/menu/wallet'] img.nav-icon"), "section link keeps its icon");
  assert.ok(panel.querySelector("a[href='#/menu']"), "All pages overview link present");
  assert.ok(!panel.querySelector("div[role='separator']"), "separator gone with the bar links");
  var css = fs.readFileSync(path.join(__dirname, "..", "vanilla", "css", "app.css"), "utf8");
  assert.ok(/#nav-directory\s*\{[^}]*position:\s*fixed/.test(css), "directory is a fixed overlay, not in-flow");
  assert.ok(/#nav\.open\s+#nav-directory\s*\{[^}]*display:\s*flex/.test(css), "pulldown lays out as flex");
  assert.ok(/#nav\.open\s+#nav-directory\s*\{[^}]*flex-direction:\s*column/.test(css), "pulldown stacks vertically (one per row)");
  console.log("pulldown-shape: 21 passed, 0 failed");
})();

/* Six-link bar (nav-six 2026-10-05 owner ruling + 2026-10-07 selector
 * ladder): Dashboard, Markets (the selector), Pools (the selector), Credit,
 * Margin, Explore. Standalone Swap is deleted (pools desk owns swapping
 * now); Credit Offer shortens to Credit. Fake-DOM globals come from the
 * pulldown block above (document/Icon/I18n already stubbed); file-text
 * covers the static fallback + buy-panel removal. Runs after pulldownShape
 * so buildNavLink has a document. */
(function barSix() {
  var fs = require("fs");
  var path = require("path");
  var wantNav = ["#/", "#/markets", "#/pools", "#/credit-offer",
    "#/borrow", "#/explorer"];
  assert.deepStrictEqual(App._test.ORIGINAL_NAV, wantNav, "bar holds 6 links in owner order");
  assert.deepStrictEqual(App._test.NAV_ICONS, {
    "#/": "dashboard",
    "#/markets": "trade",
    "#/pools": "poolmart",
    "#/credit-offer": "borrow",
    "#/borrow": "borrow",
    "#/explorer": "server"
  }, "bar icons wired (pools=poolmart, margin=borrow)");
  assert.strictEqual(App._test.navText("#/"), "Dashboard", "Dashboard label");
  assert.strictEqual(App._test.navText("#/markets"), "Markets", "Markets label (nav.markets)");
  assert.strictEqual(App._test.navText("#/pools"), "Pools", "Pools label (nav.pools)");
  assert.strictEqual(App._test.navText("#/credit-offer"), "Credit", "Credit label (nav.credit)");
  assert.strictEqual(App._test.navText("#/borrow"), "Margin", "Margin label (nav.margin)");
  assert.strictEqual(App._test.navText("#/explorer"), "Explore", "Explore label");
  // Static fallback anchors in index.html mirror the bar (no-JS first paint).
  var html = fs.readFileSync(path.join(__dirname, "..", "vanilla", "index.html"), "utf8");
  var navBlock = /<nav id="nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(navBlock, "index.html holds #nav");
  var anchors = [];
  var re = /<a\s+href="([^"]+)">([^<]+)<\/a>/g, m;
  while ((m = re.exec(navBlock[1]))) anchors.push([m[1], m[2]]);
  assert.deepStrictEqual(anchors, [
    ["#/", "Dashboard"], ["#/market/BTS_USD", "Exchange"], ["#/pools", "Liquidity Pools"],
    ["#/credit-offer", "Credit"], ["#/borrow", "Margin"], ["#/explorer", "Explore"]
  ], "static fallback anchors match the 6-link bar");
  // buildNavLink: every bar href renders an icon + labeled span.
  wantNav.forEach(function (href) {
    var a = App._test.buildNavLink(href, true);
    assert.strictEqual(a.attributes.href, href, href + " keeps its href");
    var img = (a.children || []).filter(function (c) { return c.tag === "img"; })[0];
    var span = (a.children || []).filter(function (c) { return c.tag === "span"; })[0];
    assert.ok(img, href + " renders its icon");
    assert.ok(span && span.textContent, href + " renders its label span");
  });
  // Selector tab (2026-10-07): the Markets tab is a static category link —
  // no pool-context swap survives, so no desk href can reach the bar.
  var marketsA = App._test.buildNavLink("#/markets", true);
  assert.strictEqual(marketsA.attributes.href, "#/markets", "Markets tab keeps the selector href");
  assert.ok((marketsA.children || []).some(function (c) { return c.tag === "span" && c.textContent === "Markets"; }),
    "Markets tab keeps its label");
  assert.ok(marketsA.getAttribute("data-nav-exchange") === undefined, "no desk-swap hook on the tab");
  // Buy panel: borrow (margin) entry is gone; Margin lives in the bar now.
  var panels = fs.readFileSync(path.join(__dirname, "..", "vanilla", "js", "views", "trade-panels.js"), "utf8");
  assert.ok(panels.indexOf("trade.borrow_margin_link") === -1, "buy panel drops trade.borrow_margin_link");
  assert.ok(panels.indexOf("trade.borrow_margin_title") === -1, "buy panel drops trade.borrow_margin_title");
  assert.ok(panels.indexOf("#/borrow") === -1, "buy panel holds no #/borrow link");
  console.log("bar-six: passed, 0 failed");
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
