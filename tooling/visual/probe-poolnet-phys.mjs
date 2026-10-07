// probe-poolnet-phys.mjs — repro: do Calm/Lively buttons flip the physics?
// Reads canvas._netState (S) before/after clicking Lively: S.phys, running,
// settled, visible, reduced + geometric displacement over 2s.
// Usage: node tooling/probe-poolnet-phys.mjs [baseUrl]
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

const BASE = process.argv[2] || "http://localhost:7334/#/pools";
const SHOT_DIR = "/tmp";

const browser = await chromium.launch(); // PLAYWRIGHT_BROWSERS_PATH=.browsers (shot.mjs precedent)
const PRESET = process.argv[3] || null; // "lively": seed poolNetPhys before load (fresh-mount energy)
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (PRESET) {
  await page.addInitScript((p) => { try { localStorage.setItem("poolNetPhys", p); } catch (e) {} }, PRESET);
}
const errors = [];
page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band", { timeout: 20000 });
await page.waitForFunction(
  () => { const c = document.querySelector("#pool-net-band canvas"); return c && c._netState && Object.keys(c._netState.geom || {}).length > 5; },
  { timeout: 30000 }
);
if (PRESET) {
  // fresh-mount energy mode: measure the first 8s of motion, then exit
  let prev = await page.evaluate(() => {
    const S = document.querySelector("#pool-net-band canvas")._netState;
    const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
    return o;
  });
  let path = 0;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const cur = await page.evaluate(() => {
      const S = document.querySelector("#pool-net-band canvas")._netState;
      const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
      return { o, phys: S.phys, running: S.running };
    });
    Object.keys(prev).forEach((id) => {
      if (cur.o[id]) path += Math.hypot(cur.o[id][0] - prev[id][0], cur.o[id][1] - prev[id][1]);
    });
    prev = cur.o;
  }
  const st = await page.evaluate(() => { const S = document.querySelector("#pool-net-band canvas")._netState; return { phys: S.phys, running: S.running, settled: S.settled }; });
  console.log("FRESH-MOUNT energy (" + PRESET + "): path=" + Math.round(path), JSON.stringify(st));
  console.log("CONSOLE ERRORS:", errors.length ? errors.slice(0, 5) : "none");
  await browser.close();
  process.exit(0);
}
// let v1 settle
await page.waitForTimeout(4000);

const snap = () => page.evaluate(() => {
  const c = document.querySelector("#pool-net-band canvas");
  const S = c && c._netState;
  if (!S) return { none: true };
  const ids = Object.keys(S.geom);
  let sum = 0;
  ids.forEach((id) => { sum += S.geom[id].x + S.geom[id].y * 7; });
  return {
    phys: S.phys, running: S.running, settled: S.settled,
    visible: S.visible, reduced: S.reduced, dead: S.dead,
    nodes: ids.length, checksum: Math.round(sum * 100) / 100,
    pressed: Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"))
      .map((b) => b.textContent + "=" + b.getAttribute("aria-pressed")),
  };
});

const before = await snap();
console.log("BEFORE:", JSON.stringify(before));

// click the Lively button
const clicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"));
  const lv = btns.find((b) => /lively/i.test(b.textContent || ""));
  if (!lv) return "no-lively-btn:" + btns.map((b) => b.textContent).join("|");
  const r = lv.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const blocked = el && el !== lv && !lv.contains(el) ? (el.className + "#" + el.id + "<" + el.tagName + ">") : null;
  lv.click();
  return "clicked" + (blocked ? " BUT topmost=" + blocked : "");
});
console.log("CLICK:", clicked);

const samples = [];
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(500);
  samples.push(await snap());
}
samples.forEach((s, i) => console.log(`T+${(i + 1) * 0.5}s:`, JSON.stringify(s)));
const disp = Math.abs(samples[samples.length - 1].checksum - before.checksum);
console.log("DISPLACEMENT(checksum delta):", disp);
console.log("CONSOLE ERRORS:", errors.length ? errors.slice(0, 5) : "none");

// --- energy + curve check: per-node path length over 8s in each mode ---
async function energyAndShot(mode, shotPath) {
  await page.evaluate((m) => {
    const btns = Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"));
    btns.find((b) => new RegExp(m, "i").test(b.textContent || "")).click();
  }, mode);
  await page.waitForTimeout(300);
  let prev = await page.evaluate(() => {
    const S = document.querySelector("#pool-net-band canvas")._netState;
    const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
    return o;
  });
  let path = 0, frames = 0;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const cur = await page.evaluate(() => {
      const S = document.querySelector("#pool-net-band canvas")._netState;
      const o = {}; Object.keys(S.geom).forEach((id) => { o[id] = [S.geom[id].x, S.geom[id].y]; });
      return { o, running: S.running, settled: S.settled };
    });
    Object.keys(prev).forEach((id) => {
      if (cur.o[id]) path += Math.hypot(cur.o[id][0] - prev[id][0], cur.o[id][1] - prev[id][1]);
    });
    prev = cur.o; frames++;
    if (!cur.running) break;
  }
  const c = await page.evaluate(() => document.querySelector("#pool-net-band canvas"));
  await page.locator("#pool-net-band canvas").screenshot({ path: shotPath });
  return { mode, path: Math.round(path), frames };
}
const eLively = await energyAndShot("lively", "/tmp/phys-lively.png");
const eCalm = await energyAndShot("calm", "/tmp/phys-calm.png");
console.log("ENERGY lively:", JSON.stringify(eLively), "calm:", JSON.stringify(eCalm));
await browser.close();
