import { chromium } from "playwright-core";
const PRESET = process.argv[2] || "lively";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((p) => { try { localStorage.setItem("poolNetPhys", p); } catch (e) {} }, PRESET);
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(
  () => { const c = document.querySelector("#pool-net-band canvas"); return c && c._netState && Object.keys(c._netState.geom || {}).length > 5; },
  { timeout: 30000 }
);
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const S = document.querySelector("#pool-net-band canvas")._netState;
    const ids = Object.keys(S.geom);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, dc = 0;
    ids.forEach((id) => { const p = S.geom[id];
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      dc += Math.hypot(p.x - S.W / 2, p.y - S.H / 2); });
    return { phys: S.phys, temp: +S.temp.toFixed(2), W: Math.round(S.W), H: Math.round(S.H),
      n: ids.length, degKeys: Object.keys(S.deg || {}).length,
      bbox: [Math.round(minX), Math.round(maxX), Math.round(minY), Math.round(maxY)],
      meanDist: Math.round(dc / ids.length), running: S.running, settled: S.settled };
  });
  console.log(`T+${i + 1}s:`, JSON.stringify(s));
}
console.log("ERRS:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
