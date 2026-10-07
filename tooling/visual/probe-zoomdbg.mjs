import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:7334/#/market/BTS_USD?tf=discrete", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);
const out = await page.evaluate(() => {
  const c = Array.from(document.querySelectorAll("canvas.mkt-canvas")).find((x) => { try { return !!x._discreteRec; } catch (e) { return false; } });
  const log = [];
  const r = c.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 3; i++) {
    c.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: -200 }));
    const v = c._discreteRec.view;
    log.push("z" + (i + 1) + ": t0=" + v.t0 + " t1=" + v.t1);
  }
  const rec = c._discreteRec;
  log.push("bounds: lo=" + rec.lo + " hi=" + rec.hi + " wlo=" + rec.wlo + " whi=" + rec.whi);
  return { log };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
