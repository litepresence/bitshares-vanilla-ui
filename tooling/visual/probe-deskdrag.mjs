import { chromium } from "playwright-core";
const browser = await chromium.launch();
for (const route of ["#/market/BTS_USD", "#/pools/1.19.1"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
  await page.goto("http://localhost:7334/" + route, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(9000);
  // flip Physics ON first
  await page.evaluate(() => {
    const sw = document.querySelector("[data-phys-switch]");
    if (sw) { const b = sw.querySelector("[data-phys-btn]"); if (b) b.click(); }
  });
  await page.waitForTimeout(1500);
  const e = await page.evaluate(async () => {
    const cvs = Array.from(document.querySelectorAll("canvas.mkt-canvas"));
    const c = cvs.find((x) => { try { return !!x._graphLiveS; } catch (e) { return false; } });
    if (!c) return { nolive: true };
    const S = c._graphLiveS;
    const sum = () => { let s = 0; Object.keys(S.geom).forEach((id) => { s += S.geom[id].x + S.geom[id].y * 7; }); return Math.round(s * 100) / 100; };
    const before = sum(), run0 = S.running;
    const box = c.getBoundingClientRect();
    const opts = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, isPrimary: true });
    const sx = box.left + box.width / 2, sy = box.top + box.height / 2;
    c.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)));
    for (let i = 1; i <= 8; i++) c.dispatchEvent(new PointerEvent("pointermove", opts(sx + i * 10, sy - i * 6)));
    c.dispatchEvent(new PointerEvent("pointerup", opts(sx + 80, sy - 48)));
    await new Promise((r) => setTimeout(r, 2500));
    return { before, after: sum(), wasRunning: run0, nowRunning: S.running, moved: Math.abs(sum() - before) > 1 };
  });
  console.log(route, "drag-under-lively:", JSON.stringify(e), "errs:", errs.length ? errs.slice(0, 3) : "none");
  await page.close();
}
await browser.close();
