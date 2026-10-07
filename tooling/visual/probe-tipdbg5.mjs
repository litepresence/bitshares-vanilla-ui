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
  const rec = c._discreteRec;
  const box = c.getBoundingClientRect();
  const i = Math.floor(rec.xs.length / 2);
  const cx = box.left + rec.xs[i], cy = box.top + rec.ys[i];
  // replicate handler step by step
  let p = null;
  try { p = { x: 0, y: 0 }; const b2 = c.getBoundingClientRect(); p = { x: cx - b2.left, y: cy - b2.top }; log.push("ptr:" + p.x.toFixed(1) + "," + p.y.toFixed(1)); }
  catch (e) { log.push("ptrTHROW:" + String(e).slice(0, 60)); }
  // replicate nearestIdx
  let best = -1, bd = 100;
  try {
    for (let k = 0; k < rec.xs.length; k++) { const dx = rec.xs[k] - p.x, dy = rec.ys[k] - p.y, d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = k; } }
    log.push("nearest:" + best + " d2:" + Math.round(bd));
  } catch (e) { log.push("nearestTHROW:" + String(e).slice(0, 60)); }
  // replicate tipEl creation
  try {
    const host = c.parentNode;
    let tip = host.querySelector("[data-discrete-tip]");
    log.push("preTip:" + (tip ? "exists" : "null"));
    if (!tip) {
      tip = document.createElement("div");
      tip.setAttribute("data-discrete-tip", "1");
      host.appendChild(tip);
      log.push("created:ok");
    }
    const pt = rec.pts[best];
    log.push("ptKeys:" + (pt ? Object.keys(pt).join(",") : "none"));
  } catch (e) { log.push("tipTHROW:" + String(e).slice(0, 100)); }
  return { log };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
