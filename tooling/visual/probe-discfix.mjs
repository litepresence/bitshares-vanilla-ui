import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/market/BTS_USD?tf=discrete", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);
const win = await page.evaluate(() => {
  const c = Array.from(document.querySelectorAll("canvas.mkt-canvas")).find((x) => { try { return !!x._discreteRec; } catch (e) { return false; } });
  const S = c._discreteRec, r = c.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const seq = [];
  for (let i = 0; i < 3; i++) {
    c.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: -200 }));
    seq.push(null);
  }
  return new Promise((res) => setTimeout(() => {
    const v = c._discreteRec.view, full = c._discreteRec;
    const span = (v.t1 - v.t0) / (full.hi - full.lo);
    res({ span: +span.toFixed(3), anchored: v.t0 > full.lo && v.t1 < full.hi });
  }, 1200));
});
console.log("ZOOM3x:", JSON.stringify(win));
// hover accuracy: empty corner vs exact dot
const hov = await page.evaluate(() => {
  const c = Array.from(document.querySelectorAll("canvas.mkt-canvas")).find((x) => { try { return !!x._discreteRec; } catch (e) { return false; } });
  const rec = c._discreteRec, r = c.getBoundingClientRect();
  const fire = (x, y) => { c.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + x, clientY: r.top + y })); };
  const tip = () => { const t = document.querySelector("[data-discrete-tip]"); return !!t && t.style.display !== "none"; };
  fire(4, 4); // top-left gutter (no dots)
  const emptyHides = !tip();
  const i = Math.floor(rec.xs.length / 2);
  fire(rec.xs[i], rec.ys[i]);
  const dotShows = tip();
  return { emptyHides, dotShows };
});
console.log("HOVER:", JSON.stringify(hov));
console.log("errs:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
