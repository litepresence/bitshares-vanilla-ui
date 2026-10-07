import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band .pool-net-physwitch", { timeout: 20000 });
await page.waitForTimeout(20000);
const info = await page.evaluate(() => {
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  sw.scrollIntoView({ block: "center" });
  const r = sw.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const label = document.querySelector("#pool-net-band .pool-net-physlabel");
  const state = document.querySelector("#pool-net-band .pool-net-physstate");
  return { y: Math.round(r.y), topmost: el === sw ? "SWITCH" : (el && el.tagName + "." + el.className),
    cursor: window.getComputedStyle(sw).cursor, role: sw.getAttribute("role"),
    checked: sw.getAttribute("aria-checked"), label: label && label.textContent,
    state: state && state.textContent };
});
console.log("SWITCH:", JSON.stringify(info));
const c = await page.evaluate(() => {
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  const r = sw.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
});
await page.mouse.move(c[0], c[1]);
await page.waitForTimeout(300);
const e0 = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const ids = Object.keys(S.geom); let s = 0; ids.forEach((id) => { s += S.geom[id].x + S.geom[id].y * 7; });
  return Math.round(s * 100) / 100;
});
await page.mouse.click(c[0], c[1]);
await page.waitForTimeout(2500);
const after = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const ids = Object.keys(S.geom); let s = 0; ids.forEach((id) => { s += S.geom[id].x + S.geom[id].y * 7; });
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  const state = document.querySelector("#pool-net-band .pool-net-physstate");
  return { phys: S.phys, temp: +S.temp.toFixed(2), running: S.running, sum: Math.round(s * 100) / 100,
    checked: sw.getAttribute("aria-checked"), state: state && state.textContent,
    stored: (() => { try { return localStorage.getItem("poolNetPhys"); } catch (e) { return "?"; } })() };
});
console.log("PRE-SUM:", e0, "AFTER:", JSON.stringify(after), "MOVED:", Math.abs(after.sum - e0) > 50 ? "YES" : "NO");
console.log("ERRS:", errs.length ? errs.slice(0, 5) : "none");
await browser.close();
