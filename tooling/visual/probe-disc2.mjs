import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/pools/1.19.1", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);
// click the Discrete timeframe radio
const found = await page.evaluate(() => {
  const r = Array.from(document.querySelectorAll('input[type="radio"]')).find((x) => x.value === "discrete");
  if (!r) return "no-radio";
  r.click();
  return "clicked";
});
console.log("RADIO:", found);
await page.waitForTimeout(5000);
const hov = await page.evaluate(() => {
  const cvs = Array.from(document.querySelectorAll("canvas.mkt-canvas"));
  const c = cvs.find((x) => { try { return !!x._discreteRec && x._discreteRec.xs.length; } catch (e) { return false; } });
  if (!c) return { nodiscrete: true };
  const rec = c._discreteRec, r = c.getBoundingClientRect();
  const i = Math.floor(rec.xs.length / 2), sx = r.left + rec.xs[i], sy = r.top + rec.ys[i];
  c.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: sx, clientY: sy }));
  const tip = document.querySelector("[data-discrete-tip]");
  return { dots: rec.xs.length, tipShown: !!tip && tip.style.display !== "none", tipText: tip ? tip.textContent.slice(0, 100) : null };
});
console.log("POOL hover:", JSON.stringify(hov));
await page.screenshot({ path: "/tmp/disc-pool.png", fullPage: false });
console.log("errs:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
