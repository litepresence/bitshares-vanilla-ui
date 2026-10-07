import { chromium } from "playwright-core";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band .pool-net-physwitch", { timeout: 20000 });
await page.waitForTimeout(3000);
await page.evaluate(() => { document.querySelector("#pool-net-band .pool-net-physwitch").click(); });
let prev = null, path = 0;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(3000);
  const cur = await page.evaluate(() => {
    const S = document.querySelector("#pool-net-band canvas")._netState;
    const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
    return { o, running: S.running, settled: S.settled };
  });
  if (prev) Object.keys(prev).forEach((id) => { if (cur.o[id]) path += Math.hypot(cur.o[id][0] - prev[id][0], cur.o[id][1] - prev[id][1]); });
  prev = cur.o;
  console.log(`T+${(i + 1) * 3}s running=${cur.running} settled=${cur.settled} cumPath=${Math.round(path)}`);
  if (!cur.running) break;
}
await browser.close();
