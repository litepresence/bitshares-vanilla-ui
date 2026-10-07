import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(
  () => { const c = document.querySelector("#pool-net-band canvas"); return c && c._netState && Object.keys(c._netState.geom || {}).length > 5; },
  { timeout: 30000 }
);
const geomSum = () => page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const ids = Object.keys(S.geom);
  let sum = 0; ids.forEach((id) => { sum += S.geom[id].x + S.geom[id].y * 7; });
  return { n: ids.length, sum: Math.round(sum * 100) / 100, phys: S.phys, running: S.running, settled: S.settled, temp: +S.temp.toFixed(2) };
});
async function energy(sec) {
  let prev = await page.evaluate(() => {
    const S = document.querySelector("#pool-net-band canvas")._netState;
    const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
    return o;
  });
  let path = 0;
  for (let i = 0; i < sec * 2; i++) {
    await page.waitForTimeout(500);
    const cur = await page.evaluate(() => {
      const S = document.querySelector("#pool-net-band canvas")._netState;
      const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
      return o;
    });
    Object.keys(prev).forEach((id) => { if (cur[id]) path += Math.hypot(cur[id][0] - prev[id][0], cur[id][1] - prev[id][1]); });
    prev = cur;
  }
  return Math.round(path);
}
// let the map fully settle/sleep like a real lingering user session
console.log("waiting 25s for settle...");
await page.waitForTimeout(25000);
console.log("SETTLED?", JSON.stringify(await geomSum()));
// 1. flip to Lively late
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"));
  btns.find((b) => /lively/i.test(b.textContent || "")).click();
});
await page.waitForTimeout(500);
console.log("POST-FLIP:", JSON.stringify(await geomSum()));
const eFlip = await energy(6);
console.log("6s energy after late flip:", eFlip, eFlip > 1500 ? "VISIBLE" : "DEAD");
// 2. drag BTS node and release with a fling
const dragWorked = await page.evaluate(() => {
  const c = document.querySelector("#pool-net-band canvas");
  const S = c._netState, box = c.getBoundingClientRect();
  const g = S.geom["1.3.0"]; if (!g) return "no-bts";
  const sx = box.left + (g.x * S.scale + S.ox), sy = box.top + (g.y * S.scale + S.oy);
  const opts = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, isPrimary: true });
  c.dispatchEvent(new PointerEvent("pointerdown", opts(sx, sy)));
  const steps = 12;
  for (let i = 1; i <= steps; i++) c.dispatchEvent(new PointerEvent("pointermove", opts(sx + i * 14, sy - i * 9)));
  c.dispatchEvent(new PointerEvent("pointerup", opts(sx + steps * 14, sy - steps * 9)));
  return "dragged";
});
console.log("DRAG:", dragWorked);
const eThrow = await energy(4);
console.log("4s energy after throw-release:", eThrow, eThrow > 800 ? "REACTS" : "DEAD");
console.log("ERRS:", errs.length ? errs.slice(0, 5) : "none");
await browser.close();
