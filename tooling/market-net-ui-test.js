#!/usr/bin/env node
/* market-net-ui headless vectors: #/markets landing (search default BTS,
 * volume-desc table, #/market/ desk links, honest empty state, band nav).
 * Headless (node, stub Chain + fake DOM, real Market/MarketNet/Asset/Format).
 * Exit 0 green, 1 red. TDD RED first: fails on missing market-net-ui.js. */
"use strict";

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}

var MarketNetUI = null;
try {
  MarketNetUI = require("../vanilla/js/views/market-net-ui.js"); // eslint-disable-line
} catch (e) {
  MarketNetUI = null;
}

ok(MarketNetUI && typeof MarketNetUI.renderMarkets === "function", "MarketNetUI.renderMarkets exported");
if (!MarketNetUI) {
  console.log(pass + " passed, " + fail + " failed");
  process.exit(1);
}

/* Real data-module + chain-math globals (view consumes these live). */
globalThis.MarketNet = require("../vanilla/js/api/market-net.js");
globalThis.Market = require("../vanilla/js/api/market.js");
globalThis.Asset = require("../vanilla/js/api/asset.js");
globalThis.Format = require("../vanilla/js/api/format.js");

/* ---- stub Chain: asset catalog + scenario-controlled tickers ---- */
var ASSETS = {
  BTS: { id: "1.3.0", symbol: "BTS", precision: 5 },
  USD: { id: "1.3.1", symbol: "USD", precision: 4 },
  BTC: { id: "1.3.2", symbol: "BTC", precision: 8 },
  CNY: { id: "1.3.3", symbol: "CNY", precision: 4 },
  ETH: { id: "1.3.4", symbol: "ETH", precision: 8 }
};
function bySym(sym) {
  var a = ASSETS[String(sym).toUpperCase()];
  return a ? { id: a.id, symbol: a.symbol, precision: a.precision } : null;
}
function byId(id) {
  var keys = Object.keys(ASSETS);
  for (var i = 0; i < keys.length; i++) {
    if (ASSETS[keys[i]].id === String(id)) return bySym(keys[i]);
  }
  return null;
}
var tickerMode = "volumes";
function tickerFor(base, quote) {
  function row(latest, chg, baseVol, quoteVol) {
    return { latest: latest, percent_change: chg, base_volume: baseVol,
      quote_volume: quoteVol, highest_bid: latest, lowest_ask: latest };
  }
  if (tickerMode === "volumes") {
    if (base === "1.3.0" && quote === "1.3.1") return row("0.05", "1.2", "5000", "250");
    if (base === "1.3.0" && quote === "1.3.2") return row("0.001", "-0.4", "9000", "9");
  }
  return row(null, null, "0", "0");
}
globalThis.Chain = {
  db: function () { return Promise.resolve(1); },
  history: function () { return Promise.reject(new Error("history-unavailable")); },
  status: function () { return { state: "open" }; },
  call: function (api, method, params) {
    if (method === "lookup_asset_symbols") {
      return Promise.resolve((params[0] || []).map(function (s) {
        if (/^1\.3\.\d+$/.test(String(s))) return byId(s);
        return bySym(s);
      }));
    }
    if (method === "get_objects") {
      return Promise.resolve((params[0] || []).map(function (id) { return byId(id); }));
    }
    if (method === "get_ticker") return Promise.resolve(tickerFor(params[0], params[1]));
    if (method && method.indexOf("get_liquidity_pools") === 0) return Promise.resolve([]);
    return Promise.reject(new Error("unknown-method " + method));
  }
};

/* ---- stub mapper deps: canned 7d closes + capturing band mount ---- */
globalThis.MarketCandles = {
  candles: function () {
    return Promise.resolve({ bucket: 86400, buckets: [], closes: [1.1, 1.2, 1.15, 1.3], deep: false, places: 8 });
  }
};
var bandMounts = [];
globalThis.PoolNetUI = {
  mount: function (doc, wrap, getSel, opts) {
    bandMounts.push({ getSel: getSel, opts: opts || null });
    return { redraw: function () {}, destroy: function () {} };
  }
};

/* ---- fake DOM (view falls back to raw doc.createElement when DOM/Forms absent) ---- */
function stubCtx() {
  return {
    setTransform: function () {}, clearRect: function () {},
    beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
    stroke: function () {}, fillText: function () {},
    strokeStyle: "", lineWidth: 1
  };
}
function fakeEl(tag) {
  var el = { tag: tag, children: [], style: {}, attrs: {}, textContent: "",
    className: "", value: "", type: "", disabled: false, title: "" };
  el.setAttribute = function (k, v) { el.attrs[k] = String(v); };
  el.getAttribute = function (k) {
    return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null;
  };
  el.appendChild = function (c) { el.children.push(c); return c; };
  el.removeChild = function (c) {
    var i = el.children.indexOf(c);
    if (i !== -1) el.children.splice(i, 1);
    return c;
  };
  el.addEventListener = function () {};
  el.removeEventListener = function () {};
  if (tag === "canvas") {
    el.width = 0;
    el.height = 0;
    el.getContext = function () { return stubCtx(); };
  }
  return el;
}
var fakeDoc = {
  createElement: function (tag) { return fakeEl(tag); },
  createTextNode: function (text) { return { tag: "#text", textContent: String(text) }; }
};
function walk(root, fn) {
  fn(root);
  (root.children || []).forEach(function (c) {
    if (c && c.children) walk(c, fn);
  });
  if (root.textNodeChildren) return;
}
function collectTags(root, tag) {
  var out = [];
  walk(root, function (n) { if (n.tag === tag) out.push(n); });
  return out;
}
function textOf(root) {
  var parts = [];
  walk(root, function (n) {
    if (typeof n.textContent === "string" && n.textContent) parts.push(n.textContent);
  });
  return parts.join(" ");
}

/* ---- band: volume graph + direct desk nav (no pool lookups) ---- */
ok(typeof MarketNetUI._deskForTest === "function", "_deskForTest seam exported");
if (typeof MarketNetUI._deskForTest === "function") {
  ok(MarketNetUI._deskForTest("BTS", "BTC") === "BTC_BTS",
    "_deskForTest X-as-base BTS/BTC yields BTC_BTS (Task 1 orientation rule)");
}

async function scenarioVolumes() {
  tickerMode = "volumes";
  bandMounts = [];
  var root = fakeEl("div");
  root.ownerDocument = fakeDoc;
  await MarketNetUI.renderMarkets(root);
  var hrefs = collectTags(root, "a")
    .map(function (a) { return a.attrs.href || ""; })
    .filter(function (h) { return h.indexOf("#/market/") === 0; });
  ok(hrefs.length === 2, "BTS search renders 2 market rows (got " + JSON.stringify(hrefs) + ")");
  ok(hrefs[0] === "#/market/BTC_BTS" && hrefs[1] === "#/market/USD_BTS",
    "rows volume-desc BTC_BTS(9000) before USD_BTS(5000), desk ids QUOTE_BASE (got " + JSON.stringify(hrefs) + ")");
  var ths = collectTags(root, "th").map(function (t) { return t.textContent; });
  ["Market", "Last", "24h \u0394", "24h vol", "7d"].forEach(function (h) {
    ok(ths.indexOf(h) !== -1, "header " + h + " present (got " + JSON.stringify(ths) + ")");
  });
  ok(textOf(root).indexOf("Top 2 of 4 probed") !== -1, "honest scope note Top 2 of 4 probed");
  var sparks = collectTags(root, "canvas");
  ok(sparks.length === 2, "top-8 lazy sparklines paint 2 canvases (got " + sparks.length + ")");
  var vols = [];
  walk(root, function (n) {
    if (n.tag === "td" && n.title === "raw 9000 / 9") vols.push(n);
  });
  ok(vols.length === 1 && vols[0].textContent.indexOf("BTS") !== -1,
    "BTC vol human 0.09000 BTS with raw title (got " + JSON.stringify(vols.map(function (v) { return v.textContent; })) + ")");
  ok(textOf(root).indexOf("-0.4%") !== -1, "24h change -0.4% shown");
  ok(textOf(root).indexOf("No markets found") === -1, "no empty note when rows exist");
  ok(bandMounts.length === 1, "band mounts PoolNetUI once");
  ok(bandMounts[0] && bandMounts[0].opts && bandMounts[0].opts.mode === "market",
    "band mounts in market mode (volume graph, not pools)");
  var bgraph = bandMounts[0] && bandMounts[0].opts && bandMounts[0].opts.graph;
  ok(bgraph && bgraph.edges.length === 2, "band graph holds the 2 volume markets (got " + JSON.stringify(bgraph && bgraph.edges.map(function (e) { return e.id; })) + ")");
  var bmeta = bandMounts[0] && bandMounts[0].opts && bandMounts[0].opts.meta;
  ok(bmeta && bmeta.BTC_BTS && bmeta.BTC_BTS.volBaseRaw === "9000" && bmeta.BTC_BTS.volBasePrec === 5 && bmeta.BTC_BTS.volQuotePrec === 8,
    "band meta carries raw volume + joined precisions (base BTS/5, quote BTC/8)");
  ok(bandMounts[0] && bandMounts[0].opts && typeof bandMounts[0].opts.navEdge === "function",
    "band passes navEdge override");
  if (bandMounts[0] && bandMounts[0].opts && typeof bandMounts[0].opts.navEdge === "function") {
    var navEdge = bandMounts[0].opts.navEdge;
    /* Volume edges carry their desk id — navigation is direct, no pool
     * lookup, no symbol derivation, no dead lines. Pool-shaped ids stay
     * pool desks (defensive); object-id pairs (would 404) go nowhere. */
    ok(navEdge({ edgeMid: true, poolId: "USD_BTS", a: "1.3.0", b: "1.3.1" }) === "#/market/USD_BTS",
      "volume edge by poolId key -> its desk");
    ok(navEdge({ edgeMid: true, id: "BTC_BTS", a: "1.3.0", b: "1.3.2" }) === "#/market/BTC_BTS",
      "volume edge by id key -> its desk");
    ok(navEdge({ edgeMid: true, poolId: "1.19.9" }) === "#/pools/1.19.9",
      "pool-shaped id -> the pool desk (defensive)");
    ok(navEdge({ edgeMid: true, poolId: "1.3.5_1.3.6" }) === null,
      "object ids are not symbols -> null (a '1.3.5_1.3.6' desk would 404)");
    ok(navEdge({ edgeMid: true }) === null, "no edge id at all -> null (nothing honest to open)");
    ok(navEdge(null) === null, "null hit -> null");
  }
  ok(textOf(root).indexOf("Collapse") !== -1, "band collapsible (Collapse label, open default)");
}

async function scenarioEmpty() {
  tickerMode = "empty";
  bandMounts = [];
  var root = fakeEl("div");
  root.ownerDocument = fakeDoc;
  await MarketNetUI.renderMarkets(root);
  var hrefs = collectTags(root, "a")
    .map(function (a) { return a.attrs.href || ""; })
    .filter(function (h) { return h.indexOf("#/market/") === 0; });
  ok(hrefs.length === 0, "all-zero volumes render no market rows");
  ok(textOf(root).indexOf("No markets found for this filter.") !== -1,
    "honest empty note when nothing has volume");
}

(async function () {
  try {
    await scenarioVolumes();
    await scenarioEmpty();
  } catch (e) {
    fail++;
    console.log("FAIL threw: " + ((e && e.stack) || e));
  }
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
