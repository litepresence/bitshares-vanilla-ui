#!/usr/bin/env node
/* probe-geo-wiring-test.js — end-to-end wiring: buildNodeTable + probeAll +
 * paintGeo against stub Chain/fetch/DOM (no network — the fetch stub
 * answers ipaddress.to-shaped JSON). Proves the Location/Provider cells
 * actually paint. Exit 0 green, 1 red.
 * Stdlib only: `node tooling/probe-geo-wiring-test.js`.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");

/* Minimal fake DOM: elements with class search, textContent, dataset-free
 * attributes, isConnected, ownerDocument. Enough for the table + cards +
 * setRow/paintGeo querySelector paths. */
function makeDoc() {
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
      appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
      removeChild(c) {
        const i = e.children.indexOf(c);
        if (i !== -1) e.children.splice(i, 1);
        c.parentNode = null;
        return c;
      },
      setAttribute(k, v) { e.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
      removeAttribute(k) { delete e.attrs[k]; },
      addEventListener() {},
      select() {},
      querySelector(sel) {
        const cls = sel[0] === "." ? sel.slice(1) : null;
        let found = null;
        (function walk(n) {
          if (found) return;
          if (cls && n.className && n.className.split(" ").indexOf(cls) !== -1) { found = n; return; }
          (n.children || []).forEach(walk);
        })(e);
        return found;
      },
      querySelectorAll(sel) {
        const out = [];
        if (sel === "tr") {
          (function walk(n) {
            if (n.tagName === "TR") out.push(n);
            (n.children || []).forEach(walk);
          })(e);
          return out;
        }
        const cls = sel[0] === "." ? sel.slice(1) : null;
        (function walk(n) {
          if (cls && n.className && n.className.split(" ").indexOf(cls) !== -1) out.push(n);
          (n.children || []).forEach(walk);
        })(e);
        return out;
      },
    };
    e.ownerDocument = doc;
    return e;
  }
  const doc = {
    createElement: (t) => el(t),
    createTextNode: (tx) => { const n = el("#text"); n.textContent = String(tx); return n; },
    querySelectorAll: (sel) => doc.body.querySelectorAll(sel),
    querySelector: (sel) => doc.body.querySelector(sel),
    body: null,
  };
  doc.body = el("body");
  doc.body.ownerDocument = doc;
  return doc;
}

const doc = makeDoc();
const store = {};
const sandbox = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  document: doc,
  localStorage: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  location: { href: "http://localhost:8000/#/settings", hash: "#/settings" },
  history: { replaceState: () => {} },
  navigator: {},
  fetch: (url) => Promise.resolve({
    json: () => Promise.resolve({
      success: true,
      location: { city: "Ashburn", state: "Virginia" },
      asn: { org: "Amazon.com, Inc." },
      company: { name: "Amazon" },
    }),
  }),
  Store: {
    loadSettings: () => ({ network: "mainnet", activeNode: "wss://node.geo.test/ws", customNodes: [] }),
    saveSettings: () => {},
    subscribe: () => function () {},
    emitConnection: () => {},
    DEFAULT_NODES: { mainnet: ["wss://node.geo.test/ws"], testnet: [] },
    CHAIN_IDS: { mainnet: "abc", testnet: "def" },
  },
  Chain: {
    probe: () => Promise.resolve({ chainId: "abc", latencyMs: 800, headBlock: 100, headAgeS: 1.2, participation: 99, irrevLag: 5, hasHistory: true, pingMs: 100 }),
    classifyHealth: () => ({ status: "GOOD", detail: "ok" }),
  },
  HistoryCap: { update: () => {}, nodeHistory: () => null },
  module: { exports: {} },
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("/workspace/vanilla/js/api/geo.js", "utf8"), sandbox, { filename: "api/geo.js" });
vm.runInContext(fs.readFileSync("/workspace/vanilla/js/settings-nodes.js", "utf8"), sandbox, { filename: "settings-nodes.js" });
const SettingsNodes = sandbox.SettingsNodes;
const t = (k, d) => d;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const fails = [];
  const settings = sandbox.Store.loadSettings();
  const nodes = SettingsNodes.allNodes(settings);
  const built = SettingsNodes.buildNodeTable(doc, settings, nodes, t);
  const cards = SettingsNodes.buildNodeCards(doc, settings, nodes, t);
  doc.body.appendChild(built.table);
  doc.body.appendChild(cards);
  const offline = doc.createElement("div");

  function cellText(root, cls) {
    const n = root.querySelector(cls);
    return n ? n.textContent : "<MISSING>";
  }

  SettingsNodes.probeAll(nodes, built.tbody, offline, t);
  await sleep(300);

  const row = built.tbody.querySelectorAll("tr")[0];
  const lat = cellText(row, ".latency");
  const geo = cellText(row, ".node-geo");
  const prov = cellText(row, ".node-provider");
  console.log("row latency : " + JSON.stringify(lat));
  console.log("row geo     : " + JSON.stringify(geo));
  console.log("row provider: " + JSON.stringify(prov));
  const cardGeo = cellText(cards, ".node-geo");
  console.log("card geo    : " + JSON.stringify(cardGeo));

  if (geo === "<MISSING>" || prov === "<MISSING>") fails.push("geo cells were never built");
  else {
    if (geo !== "Ashburn, Virginia") fails.push("geo cell wrong (got " + JSON.stringify(geo) + ")");
    if (prov !== "Amazon") fails.push("provider cell wrong (got " + JSON.stringify(prov) + ")");
    if (cardGeo !== "Ashburn, Virginia") fails.push("card geo wrong (got " + JSON.stringify(cardGeo) + ")");
  }

  /* Health signals ride data-h (stub probe: hs 800 good, ping 100 warn,
   * part 99 good, age 1.2 good, mainnet match good, history null uncolored). */
  function healthOf(root, cls) {
    const n = root.querySelector(cls);
    if (!n) return "<MISSING>";
    const h = n.getAttribute("data-h");
    return h === null ? "<CLEARED>" : h;
  }
  const hChecks = [
    [".latency", "good"], [".ping", "warn"], [".part", "good"],
    [".node-head", "good"], [".node-chain", "good"], [".node-history", "<CLEARED>"],
  ];
  hChecks.forEach(([cls, want]) => {
    const got = healthOf(row, cls);
    if (got !== want) fails.push(cls + " data-h want " + want + " (got " + JSON.stringify(got) + ")");
    else console.log("PASS " + cls + " -> " + got);
  });

  if (fails.length) {
    fails.forEach((f) => console.log("FAIL " + f));
    process.exit(1);
  }
  console.log("PROBE-GEO-WIRING GREEN");
})().catch((e) => { console.log("FAIL harness: " + (e && e.stack || e)); process.exit(1); });
