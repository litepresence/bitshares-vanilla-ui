#!/usr/bin/env node
/* eval-once.mjs — DEV ONLY headless eval helper (never shipped).
 * Loads a vanilla URL, runs one JS snippet in-page, prints the result.
 * Usage: node tooling/visual/eval-once.mjs "http://localhost:8081/#/assets" "expression.js" [waitMs]
 * Requires: PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers (this dir).
 */
import { chromium } from "playwright-core";

const url = process.argv[2];
const expr = process.argv[3] || "document.title";
const waitMs = Number(process.argv[4] || 8000);
/* 4th arg: "mainnet" keeps the default network (no testnet override). */
const forceTestnet = process.argv[5] !== "mainnet";

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
await page.addInitScript((wantTestnet) => {
  try {
    if (!wantTestnet) return;
    const raw = localStorage.getItem("bts-vanilla-settings-v1");
    const s = raw ? JSON.parse(raw) : {};
    s.network = "testnet";
    s.activeNode = "wss://testnet.xbts.io/ws";
    localStorage.setItem("bts-vanilla-settings-v1", JSON.stringify(s));
  } catch {}
}, forceTestnet);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(waitMs);
let out;
try {
  out = await page.evaluate(async (src) => {
    try {
      const fn = new Function("return (" + src + ")");
      const v = await fn();
      return { ok: true, value: JSON.stringify(v).slice(0, 2000) };
    } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 500) }; }
  }, expr);
} catch (e) { out = { ok: false, error: "evaluate failed: " + String(e).slice(0, 300) }; }
console.log(JSON.stringify({ out, consoleErrors: errors }));
await browser.close();
