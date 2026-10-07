import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band canvas", { timeout: 20000 });
await page.waitForTimeout(6000); // settle into pause
const box = await page.evaluate(() => {
  const c = document.querySelector("#pool-net-band canvas");
  const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
});
await page.mouse.move(box[0], box[1]);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(800);
const s = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  return { running: S.running, scale: +S.scale.toFixed(2) };
});
console.log("after wheel:", JSON.stringify(s), (!s.running && s.scale > 1) ? "ZOOM-ONLY" : "RESTARTED?");
console.log("errs:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
