import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem("poolNetPhys", "lively"); } catch (e) {} });
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(
  () => { const c = document.querySelector("#pool-net-band canvas"); return c && c._netState && Object.keys(c._netState.geom || {}).length > 5; },
  { timeout: 30000 }
);
await page.waitForTimeout(5000); // mid-run, temp ~2
const geoms = [];
for (let i = 0; i < 3; i++) {
  geoms.push(await page.evaluate(() => {
    const S = document.querySelector("#pool-net-band canvas")._netState;
    const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
    return o;
  }));
  await page.waitForTimeout(1000);
}
const st = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  return { temp: +S.temp.toFixed(2), running: S.running, settled: S.settled };
});
const rows = Object.keys(geoms[0]).map((id) => {
  const d1 = Math.hypot(geoms[1][id][0] - geoms[0][id][0], geoms[1][id][1] - geoms[0][id][1]);
  const d2 = Math.hypot(geoms[2][id][0] - geoms[1][id][0], geoms[2][id][1] - geoms[1][id][1]);
  return { id, d1: +d1.toFixed(2), d2: +d2.toFixed(2) };
}).sort((a, b) => (b.d1 + b.d2) - (a.d1 + a.d2));
console.log("state:", JSON.stringify(st));
console.log("top movers:", JSON.stringify(rows.slice(0, 8)));
console.log("movers>1px:", rows.filter((r) => r.d1 + r.d2 > 1).length, "/", rows.length);
await browser.close();
