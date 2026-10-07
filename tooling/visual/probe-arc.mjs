import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band .pool-net-physwitch", { timeout: 20000 });
await page.waitForTimeout(6000);
await page.evaluate(() => { document.querySelector("#pool-net-band .pool-net-physwitch").click(); });
for (let w = 0; w < 5; w++) {
  let prev = await page.evaluate(() => {
    const S = document.querySelector("#pool-net-band canvas")._netState;
    const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
    return o;
  });
  await page.waitForTimeout(1000);
  const cur = await page.evaluate(() => {
    const S = document.querySelector("#pool-net-band canvas")._netState;
    const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
    return { o, running: S.running, temp: +S.temp.toFixed(2) };
  });
  let path = 0;
  Object.keys(prev).forEach((id) => { if (cur.o[id]) path += Math.hypot(cur.o[id][0] - prev[id][0], cur.o[id][1] - prev[id][1]); });
  console.log(`s${w}-${w + 1}: path=${Math.round(path)} temp=${cur.temp} running=${cur.running}`);
  if (!cur.running && w >= 2) break;
}
console.log("errs:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
