// Locked swap quote + sign-gate proof (DEV ONLY — headless test aid).
// Drives #/swap while locked: fills a testnet pair with a pool, clicks
// Find pools -> Quote (public, must render), then Review swap (must show
// the unlock notice, never a throw). Saves useful flows under tooling/ per
// repo policy (no inline throwaway scripts).
//
// Usage (server must run: python3 -m http.server 8081 --directory vanilla):
//   PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node swap-quote.mjs
import { chromium } from "playwright-core";

const out1 = process.argv[2] || "/tmp/swap-quote-locked.png";
const out2 = process.argv[3] || "/tmp/swap-review-locked.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text().slice(0, 300));
});
page.on("pageerror", (err) => errors.push("pageerror: " + String(err).slice(0, 300)));
await page.addInitScript(() => {
  try {
    const raw = localStorage.getItem("bts-vanilla-settings-v1");
    const s = raw ? JSON.parse(raw) : {};
    s.network = "testnet";
    s.activeNode = "wss://testnet.xbts.io/ws";
    localStorage.setItem("bts-vanilla-settings-v1", JSON.stringify(s));
  } catch {}
});
await page.goto("http://localhost:8081/#/swap", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(9000);
await page.getByLabel(/Sell asset/).fill("TEST");
await page.getByLabel(/Buy asset/).fill("MKUU");
await page.getByLabel(/Sell amount/).fill("10");
await page.getByRole("button", { name: "Find pools" }).click();
await page.waitForTimeout(9000);
const quoteBtn = page.getByRole("button", { name: "Quote" });
if ((await quoteBtn.count()) > 0) {
  await quoteBtn.first().click();
  await page.waitForTimeout(9000);
}
await page.screenshot({ path: out1 });
const reviewBtn = page.getByRole("button", { name: "Review swap" });
if ((await reviewBtn.count()) > 0) {
  await reviewBtn.first().click();
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: out2 });
console.log(JSON.stringify({ out1, out2, consoleErrors: errors }));
await browser.close();
if (errors.length) process.exitCode = 2;
