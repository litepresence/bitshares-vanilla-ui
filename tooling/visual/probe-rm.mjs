import { chromium } from "playwright-core";
// Replicate suspected user env: prefers-reduced-motion ON (Mint/Brave may set it).
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 3840, height: 2160 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band .pool-net-physwitch", { timeout: 20000 });
await page.waitForTimeout(6000);
const pre = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  return { reduced: S.reduced, running: S.running, settled: S.settled, media: window.matchMedia("(prefers-reduced-motion: reduce)").matches };
});
console.log("PRE:", JSON.stringify(pre));
await page.evaluate(() => {
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  sw.scrollIntoView({ block: "center" });
});
const c = await page.evaluate(() => {
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  const r = sw.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
});
await page.mouse.click(c[0], c[1]);
await page.waitForTimeout(2000);
const after = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  return { phys: S.phys, running: S.running, checked: sw.getAttribute("aria-checked") };
});
console.log("AFTER-FLIP:", JSON.stringify(after));
await browser.close();
