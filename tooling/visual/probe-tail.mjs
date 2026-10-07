import { chromium } from "playwright-core";
const PRESET = process.argv[2] || "calm";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((p) => { try { localStorage.setItem("poolNetPhys", p); } catch (e) {} }, PRESET);
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(
  () => { const c = document.querySelector("#pool-net-band canvas"); return c && c._netState && Object.keys(c._netState.geom || {}).length > 5; },
  { timeout: 30000 }
);
await page.waitForTimeout(12000);
const st = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const ids = Object.keys(S.geom);
  let dc = 0; ids.forEach((id) => { dc += Math.hypot(S.geom[id].x - S.W / 2, S.geom[id].y - S.H / 2); });
  return { phys: S.phys, running: S.running, settled: S.settled, temp: +S.temp.toFixed(2), spread: Math.round(dc / ids.length) };
});
console.log("T+12s (" + PRESET + "):", JSON.stringify(st));
await page.locator("#pool-net-band canvas").screenshot({ path: "/tmp/phys-" + PRESET + "-t12.png" });
await browser.close();
