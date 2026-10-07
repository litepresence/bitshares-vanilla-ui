import { chromium } from "playwright-core";
// Replicate user env: 4K viewport, skip the tour like they do, late flip + drag.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band .pool-net-physwitch", { timeout: 20000 });
// skip the tour exactly like the user
const tourSeen = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button"));
  const skip = btns.find((b) => /^skip$/i.test((b.textContent || "").trim()));
  if (skip) { skip.click(); return true; }
  return false;
});
console.log("TOUR-SKIPPED:", tourSeen);
await page.waitForTimeout(20000); // linger like a real session
const pre = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  return { tourGone: !document.querySelector("#tour-card"), scrollY: Math.round(window.scrollY),
    phys: S.phys, running: S.running, settled: S.settled, temp: +S.temp.toFixed(2), W: Math.round(S.W), H: Math.round(S.H) };
});
console.log("PRE:", JSON.stringify(pre));
// real-mouse flip
const c = await page.evaluate(() => {
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  sw.scrollIntoView({ block: "center" });
  const r = sw.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2,
    top: el && (el === sw || sw.contains(el) ? "SWITCH-OK" : el.tagName + "." + el.className) };
});
console.log("AIM:", JSON.stringify(c));
const e0 = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const ids = Object.keys(S.geom); let s = 0; ids.forEach((id) => { s += S.geom[id].x + S.geom[id].y * 7; });
  return Math.round(s * 100) / 100;
});
await page.mouse.click(c.x, c.y);
await page.waitForTimeout(2500);
const after = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const ids = Object.keys(S.geom); let s = 0; ids.forEach((id) => { s += S.geom[id].x + S.geom[id].y * 7; });
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  return { phys: S.phys, temp: +S.temp.toFixed(2), running: S.running, sum: Math.round(s * 100) / 100,
    checked: sw.getAttribute("aria-checked") };
});
console.log("PRE-SUM:", e0, "AFTER:", JSON.stringify(after), "MOVED:", Math.abs(after.sum - e0) > 50 ? "YES" : "NO");
console.log("ERRS:", errs.length ? errs.slice(0, 5) : "none");
await browser.close();
