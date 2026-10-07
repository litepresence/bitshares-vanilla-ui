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
  const host = c.parentNode;
  log.push("host:" + (host && host.tagName + "." + host.className));
  try {
    const q = host.querySelector("[data-discrete-tip]");
    log.push("hostQuery:" + (q ? "found" : "null"));
  } catch (e) { log.push("hostQueryTHREW:" + String(e).slice(0, 80)); }
  try {
    const d = document.createElement("div");
    d.setAttribute("data-discrete-tip", "1");
    log.push("createElement:ok");
  } catch (e) { log.push("createElementTHREW:" + String(e).slice(0, 80)); }
  // list canvas mousemove listeners? can't — instead check __listeners via getEventListeners (devtools only, undefined here)
  log.push("typeofGetEventListeners:" + typeof window.getEventListeners);
  return { log };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
