import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", String((e && e.message || e)).slice(0, 200)));
await page.goto("http://localhost:7334/#/market/BTS_USD?tf=discrete", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);
const out = await page.evaluate(() => {
  const log = [];
  const cvs = Array.from(document.querySelectorAll("canvas.mkt-canvas"));
  const c = cvs.find((x) => { try { return !!x._discreteRec && x._discreteRec.xs.length; } catch (e) { return false; } });
  if (!c) return { nodiscrete: true };
  window.__fired = 0;
  c.addEventListener("mousemove", () => { window.__fired++; });
  const rec = c._discreteRec, r = c.getBoundingClientRect();
  const i = Math.floor(rec.xs.length / 2);
  c.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + rec.xs[i], clientY: r.top + rec.ys[i] }));
  log.push("myListenerFired:" + window.__fired);
  log.push("wired:" + !!c._discreteWired);
  log.push("hasTip:" + !!document.querySelector("[data-discrete-tip]"));
  // manual nearest computation
  const px = r.left + rec.xs[i], py = r.top + rec.ys[i];
  let best = -1, bd = 1e9;
  rec.xs.forEach((x, k) => { const dx = x - (px - r.left), dy = rec.ys[k] - (py - r.top); const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = k; } });
  log.push("manualNearest:" + best + " dist2:" + Math.round(bd));
  log.push("ptsLen:" + (rec.pts ? rec.pts.length : "none") + " ptKeys:" + (rec.pts && rec.pts[i] ? Object.keys(rec.pts[i]).join(",") : "none"));
  return { log };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
