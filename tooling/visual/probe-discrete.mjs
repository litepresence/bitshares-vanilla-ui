import { chromium } from "playwright-core";
const browser = await chromium.launch();
for (const route of ["#/market/BTS_USD?tf=discrete", "#/pools/1.19.1?tf=discrete"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
  await page.goto("http://localhost:7334/" + route, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(9000);
  // aim hover at the first painted dot, not canvas center
  const hov = await page.evaluate(() => {
    const cvs = Array.from(document.querySelectorAll("canvas.mkt-canvas"));
    const c = cvs.find((x) => { try { return !!x._discreteRec && x._discreteRec.xs.length; } catch (e) { return false; } });
    if (!c) return { nodiscrete: true };
    const rec = c._discreteRec, r = c.getBoundingClientRect();
    const i = Math.floor(rec.xs.length / 2), sx = r.left + rec.xs[i], sy = r.top + rec.ys[i];
    c.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: sx, clientY: sy }));
    const tip = document.querySelector("[data-discrete-tip]");
    return { dots: rec.xs.length, tipShown: !!tip && tip.style.display !== "none", tipText: tip ? tip.textContent.slice(0, 90) : null };
  });
  const shot = "/tmp/disc-" + route.replace(/[^A-Za-z0-9]+/g, "_") + ".png";
  await page.screenshot({ path: shot, fullPage: false });
  console.log(route, "hover:", JSON.stringify(hov), "errs:", errs.length ? errs.slice(0, 3) : "none", shot);
  await page.close();
}
await browser.close();
