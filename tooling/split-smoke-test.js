#!/usr/bin/env node
/* split-smoke-test.js — render smoke for the account/market splits.
 * Loads the real split modules in dependency order with stub chain/DOM
 * and asserts (1) both route entries render without throwing, (2) the
 * registry spies fire (facade -> module wiring is live, not just parsed).
 * Stdlib only: `node tooling/split-smoke-test.js` (exit 0 = green).
 */
"use strict";
const fs = require("fs");
const vm = require("vm");

/* --- fake DOM (probe-geo-wiring-test.js pattern, extended: canvas
 * contexts via Proxy-noop, classList, style sets) --- */
function makeDoc() {
  function ctx2d() {
    return new Proxy({}, {
      get: (t, k) => (k === "canvas" ? null : function () { return {}; }),
      set: () => true,
    });
  }
  function el(tag) {
    const e = {
      tagName: String(tag).toUpperCase(),
      children: [],
      className: "",
      textContent: "",
      disabled: false,
      checked: false,
      value: "",
      type: "",
      style: {},
      attrs: {},
      ownerDocument: null,
      parentNode: null,
      isConnected: true,
      width: 300,
      height: 150,
      appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
      removeChild(c) {
        const i = e.children.indexOf(c);
        if (i !== -1) e.children.splice(i, 1);
        c.parentNode = null;
        return c;
      },
      insertBefore(c, ref) {
        c.parentNode = e;
        const i = ref ? e.children.indexOf(ref) : -1;
        if (i === -1) e.children.push(c);
        else e.children.splice(i, 0, c);
        return c;
      },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null;
      },
      removeAttribute(k) { delete e.attrs[k]; },
      addEventListener() {},
      select() {},
      getContext: () => ctx2d(),
      getBoundingClientRect: () => ({ width: 300, height: 150 }),
      querySelector(sel) {
        const cls = sel[0] === "." ? sel.slice(1) : null;
        const id = sel[0] === "#" ? sel.slice(1) : null;
        const tag = (sel[0] !== "." && sel[0] !== "#") ? sel.toUpperCase() : null;
        let found = null;
        (function walk(n) {
          if (found) return;
          if (cls && n.className && n.className.split(" ").indexOf(cls) !== -1) { found = n; return; }
          if (id && n.attrs && n.attrs.id === id) { found = n; return; }
          if (tag && n.tagName === tag) { found = n; return; }
          (n.children || []).forEach(walk);
        })(e);
        return found;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          if (sel === "tr" || sel === "tbody tr") {
            if (n.tagName === "TR") out.push(n);
          } else if (sel === "input[name=\"node\"]") {
            if (n.tagName === "INPUT") out.push(n);
          } else if (sel[0] === ".") {
            const cls = sel.slice(1).split(/[:\s]/)[0];
            if (n.className && n.className.split(" ").indexOf(cls) !== -1) out.push(n);
          } else if (sel === "button") {
            if (n.tagName === "BUTTON") out.push(n);
          }
          (n.children || []).forEach(walk);
        };
        walk(e);
        return out;
      },
    };
    e.ownerDocument = doc;
    return e;
  }
  const doc = {
    createElement: (t) => el(t),
    createTextNode: (tx) => { const n = el("#text"); n.textContent = String(tx); return n; },
    querySelectorAll: () => [],
    querySelector: () => null,
    body: null,
  };
  doc.body = el("body");
  doc.body.ownerDocument = doc;
  return doc;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
function check(cond, name) {
  if (!cond) fails.push(name);
  else console.log("PASS " + name);
}

async function accountSmoke() {
  const doc = makeDoc();
  const store = {};
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (f) => 0,
    document: doc,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    location: { href: "http://localhost/#/account/alice", hash: "#/account/alice" },
    history: { replaceState: () => {} },
    navigator: {},
    fetch: () => Promise.reject(new Error("no net")),
    Store: {
      loadSettings: () => ({ network: "mainnet", activeNode: "wss://x", customNodes: [] }),
      saveSettings: () => {},
      subscribe: () => function () {},
      emitConnection: () => {},
      DEFAULT_NODES: { mainnet: [], testnet: [] },
      CHAIN_IDS: {},
    },
    Chain: { status: () => ({ state: "open" }), db: async () => 1, call: async () => null },
    Account: {
      resolve: async (n) => ({ id: "1.2.10", name: String(n).toLowerCase() }),
      myAccountId: async () => { throw new Error("locked"); },
      balances: async () => [],
      history: async () => [],
      opsFiltered: async () => [],
      openOrders: async () => [],
      equity: async () => ({}),
    },
    Wallet: { isUnlocked: () => false },
    ViewingAs: { id: () => "1.2.0", get: () => ({ id: "1.2.0", name: "committee-account" }) },
    Offline: { ensure: () => {}, wire: () => {}, settingsLink: () => null },
    HistoryNotice: { actionLink: () => null },
    HistoryCap: { update: () => {}, nodeHistory: () => null },
    Explorer: { currentShareUrl: (h) => h },
    NotifyHost: { mountToasts: () => {} },
    NotifyRules: { checkHistory: () => ({}) },
    Format: { formatAmount: () => "", parseAmount: () => "" },
    Icon: { img: () => doc.createElement("span") },
    Router: { query: () => ({}) },
    DOM: undefined, // filled below (real shared DOM util)
    Forms: undefined,
    touchable: (e) => e,
    module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // Real shared DOM/Forms utils (dependency-free, load clean in node).
  vm.runInContext(fs.readFileSync("/workspace/vanilla/js/utils/dom.js", "utf8"), sandbox);
  vm.runInContext(fs.readFileSync("/workspace/vanilla/js/forms/field.js", "utf8"), sandbox);
  for (const f of ["account-history.js",
                   "account-membership.js", "account-ui.js"]) {
    vm.runInContext(fs.readFileSync("/workspace/vanilla/js/views/" + f, "utf8"),
      sandbox, { filename: f });
  }
  const UI = sandbox.AccountUI;
  check(UI && typeof UI.renderAccount === "function", "account facade exposes renderAccount");
  check(UI && UI._history && typeof UI._history.renderHistory === "function", "history registry attached");
  check(UI && UI._membership && typeof UI._membership.renderMembership === "function", "membership registry attached");

  // Spy the registry (late-bound lookups hit these wrappers).
  const seen = {};
  for (const [reg, fn] of [["_history", "renderOpenOrders"], ["_history", "renderHistory"],
                            ["_membership", "renderMargin"], ["_membership", "renderCredit"],
                            ["_membership", "renderMembership"]]) {
    const orig = UI[reg][fn];
    seen[fn] = 0;
    UI[reg][fn] = function () { seen[fn]++; return orig.apply(this, arguments); };
  }
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  UI.renderAccount(root, "alice");
  await sleep(300);
  const h1 = root.querySelector("h1");
  check(h1 && /alice/i.test(h1.textContent), "account h1 painted");
  const tabs = root.querySelectorAll("button").filter((b) =>
    /balances|orders|history|membership|equity|margin|credit/i.test(b.textContent || ""));
  check(tabs.length >= 5, "tab row painted (" + tabs.length + " tabs)");
  for (const [fn, want] of [["renderOpenOrders", 1], ["renderHistory", 1], ["renderMargin", 1],
                             ["renderCredit", 1], ["renderMembership", 1]]) {
    check(seen[fn] >= want, "registry wired: " + fn + " called (" + seen[fn] + "x)");
  }
}

/* Lifetime gold-star badge (backlog-A): the Lifetime branch of
 * renderMembership paints a ★ badge span (theme token color) + the existing
 * account.lifetime text with an early return; the non-LTM path is untouched
 * (status text + upgrade button, no star). Loads the real module in a fresh
 * sandbox with a stub Chain serving lifetime/basic fixtures. */
async function lifetimeBadge() {
  const doc = makeDoc();
  const LTM = { id: "1.2.7", lifetime_referrer: "1.2.7", membership_expiration_date: "2019-01-01T00:00:00" };
  const BASIC = { id: "1.2.8", lifetime_referrer: "1.2.1", membership_expiration_date: "2000-01-01T00:00:00" };
  let fixture = LTM;
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    document: doc,
    location: { href: "http://localhost/#/account/n1", hash: "#/account/n1" },
    navigator: {},
    fetch: () => Promise.reject(new Error("no net")),
    Chain: { db: async () => 1, call: async () => [fixture] },
    Tx: {},
    Credit: {},
    Format: { formatAmount: (s) => String(s) },
    Asset: { describe: async () => null },
    Wallet: { isUnlocked: () => false },
    Account: { myAccountId: async () => "1.2.7" },
    HistoryNotice: { actionLink: () => null },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("/workspace/vanilla/js/utils/dom.js", "utf8"), sandbox);
  vm.runInContext(fs.readFileSync("/workspace/vanilla/js/views/account-membership.js", "utf8"),
    sandbox, { filename: "account-membership.js" });
  const M = sandbox.AccountUI && sandbox.AccountUI._membership;
  check(M && typeof M.renderMembership === "function", "membership module loads standalone");

  // Lifetime fixture: star badge span + lifetime text, early return (no button).
  const boxL = doc.createElement("div");
  doc.body.appendChild(boxL);
  M.renderMembership(doc, boxL, { id: "1.2.7", name: "n1" });
  await sleep(300);
  const star = boxL.querySelector(".ltm-star");
  check(!!star, "lifetime renders a star badge span");
  check(!!star && /★/.test(star.textContent || ""), "star badge carries a ★ text node");
  const pL = boxL.querySelector("p");
  check(!!pL && (pL.children || []).some((c) => c.tagName === "#TEXT" && /Lifetime member/.test(c.textContent || "")),
    "star badge reuses the account.lifetime text (separate text node)");
  check(!boxL.querySelector("button"), "lifetime early-returns (no upgrade button)");

  // Basic fixture: untouched path — status text + upgrade button, no star.
  fixture = BASIC;
  const boxB = doc.createElement("div");
  doc.body.appendChild(boxB);
  M.renderMembership(doc, boxB, { id: "1.2.8", name: "n2" });
  await sleep(300);
  check(!boxB.querySelector(".ltm-star"), "non-LTM renders no star");
  const pB = boxB.querySelector("p");
  check(!!pB && /Basic account/.test(pB.textContent || ""), "non-LTM status text intact");
  check(!!boxB.querySelector("button"), "non-LTM keeps the upgrade button");

  // CSS: badge color comes from a theme token only (no literal palette).
  const css = fs.readFileSync("/workspace/vanilla/css/app.css", "utf8");
  check(/\.ltm-star\s*\{[^}]*color:\s*var\(--warn\)/.test(css), "ltm-star colors via var(--warn) token");
}

async function marketSmoke() {
  const doc = makeDoc();
  const store = {};
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (f) => 0,
    document: doc,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    location: { href: "http://localhost/#/market/BTS_USD", hash: "#/market/BTS_USD" },
    history: { replaceState: () => {} },
    navigator: {},
    fetch: () => Promise.reject(new Error("no net")),
    innerWidth: 1600,
    Store: {
      loadSettings: () => ({ network: "mainnet", activeNode: "wss://x", customNodes: [] }),
      saveSettings: () => {},
      subscribe: () => function () {},
      emitConnection: () => {},
      DEFAULT_NODES: { mainnet: [], testnet: [] },
      CHAIN_IDS: {},
    },
    Chain: { status: () => ({ state: "open", headBlock: 100 }), db: async () => 1, call: async () => null },
    Market: {
      parseId: (id) => { const p = String(id).split("_"); return { quote: p[0], base: p[1] }; },
      assets: async (q, b) => ({
        quote: { id: "1.3.0", symbol: String(q), precision: 5 },
        base: { id: "1.3.1", symbol: String(b), precision: 5 },
      }),
      timeframes: async () => [300, 900, 3600],
      candles: async () => ({ buckets: [], closes: [] }),
      depth: async () => ({}),
      book: async () => ({ bids: [], asks: [] }),
      stats: async () => ({}),
      trades: async () => [],
      tradesDeep: async () => [],
      deepen: async () => ({}),
    },
    Format: { formatAmount: () => "", parseAmount: () => "" },
    Indicators: {},
    MarketCharts: { drawPricePane: () => {}, drawOscPane: () => {}, drawDepth: () => {}, removePane: () => {} },
    MarketPicker: { renderPicker: () => {} },
    MarketBook: { renderSplit: () => ({}), groupBook: (b) => b },
    MarketOrders: { render: () => {} },
    MarketCandles: { vwap: () => [] },
    MarketFills: {},
    PoolGraph: null,
    PoolHistory: { chainSwaps: async () => ({ swaps: [] }) },
    Wallet: { isUnlocked: () => false },
    Account: { resolve: async (n) => ({ id: "1.2.1", name: n }), myAccountId: async () => { throw new Error("x"); } },
    Offline: { ensure: () => {}, wire: () => {}, settingsLink: () => null },
    Router: { query: () => ({}) },
    DOM: undefined,
    Forms: undefined,
    touchable: (e) => e,
    module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("/workspace/vanilla/js/utils/dom.js", "utf8"), sandbox);
  vm.runInContext(fs.readFileSync("/workspace/vanilla/js/forms/field.js", "utf8"), sandbox);
  for (const f of ["market-ind-series.js", "market-ind-panes.js", "market-ind.js",
                   "market-desk-query.js", "market-desk-panels.js",
                   "market-desk-fill.js", "market-desk.js"]) {
    try {
      vm.runInContext(fs.readFileSync("/workspace/vanilla/js/views/" + f, "utf8"),
        sandbox, { filename: f });
    } catch (e) {
      fails.push("load " + f + ": " + (e && e.message));
      return;
    }
  }
  const Desk = sandbox.MarketDesk;
  check(Desk && typeof Desk.renderMarket === "function", "desk facade exposes renderMarket");
  check(Desk && Desk._query && typeof Desk._query.readDeskQuery === "function", "query registry attached");
  check(Desk && Desk._fill && typeof Desk._fill.fill === "function", "fill registry attached");
  check(Desk && Desk._panels && typeof Desk._panels.paintBook === "function", "panels registry attached");

  const seen = {};
  for (const [reg, fn] of [["_fill", "fill"], ["_panels", "paintBook"],
                            ["_panels", "renderMyTrades"], ["_query", "saveLast"]]) {
    const orig = Desk[reg][fn];
    seen[fn] = 0;
    Desk[reg][fn] = function () { seen[fn]++; return orig.apply(this, arguments); };
  }
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  Desk.renderMarket(root, "BTS_USD");
  await sleep(400);
  const h1 = root.querySelector("h1");
  check(h1 && /BTS/.test(h1.textContent), "desk h1 painted (" + (h1 && h1.textContent) + ")");
  for (const [fn, want] of [["fill", 1], ["paintBook", 1], ["renderMyTrades", 1], ["saveLast", 1]]) {
    check(seen[fn] >= want, "registry wired: " + fn + " called (" + seen[fn] + "x)");
  }
}

(async function main() {
  try { await accountSmoke(); } catch (e) {
    fails.push("account smoke threw: " + (e && e.stack || e));
  }
  try { await lifetimeBadge(); } catch (e) {
    fails.push("lifetime badge threw: " + (e && e.stack || e));
  }
  try { await marketSmoke(); } catch (e) {
    fails.push("market smoke threw: " + (e && e.stack || e));
  }
  if (fails.length) {
    fails.forEach((f) => console.log("FAIL " + f));
    process.exit(1);
  }
  console.log("SPLIT-SMOKE GREEN");
})().catch((e) => { console.log("FAIL harness: " + (e && e.stack || e)); process.exit(1); });
