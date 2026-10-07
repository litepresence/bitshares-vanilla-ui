import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:7334/#/market/BTS_USD?tf=discrete", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);
const out = await page.evaluate(() => {
  const c = Array.from(document.querySelectorAll("canvas.mkt-canvas")).find((x) => { try { return !!x._discreteRec; } catch (e) { return false; } });
  const rec = c._discreteRec, r = c.getBoundingClientRect();
  return { liveW: Math.round(r.width), recPlotW: rec.plotW, recPadL: rec.padL, canvasAttrW: c.width };
});
console.log(JSON.stringify(out));
await browser.close();
