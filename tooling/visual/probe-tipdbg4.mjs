import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", String((e && e.message || e)).slice(0, 200)));
await page.goto("http://localhost:7334/#/market/BTS_USD?tf=discrete", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);
const out = await page.evaluate(() => {
  const log = [];
  const c = Array.from(document.querySelectorAll("canvas.mkt-canvas"))
    .find((x) => { try { return !!x._discreteRec && x._discreteRec.xs.length; } catch (e) { return false; } });
  if (!c) return { nodiscrete: true };
  const rec = c._discreteRec, r = c.getBoundingClientRect();
  const i = Math.floor(rec.xs.length / 2);
  c.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + rec.xs[i], clientY: r.top + rec.ys[i] }));
  const tip = document.querySelector("[data-discrete-tip]");
  log.push("tip:" + (tip ? tip.style.display + "|" + tip.textContent.slice(0, 40) : "NONE"));
  return { log };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
