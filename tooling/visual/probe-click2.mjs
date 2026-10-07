import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band .pool-net-physbtn", { timeout: 20000 });
await page.waitForTimeout(20000); // settle like a lingering session
// scroll the Lively button into view first (tour may have scrolled past it)
const info = await page.evaluate(() => {
  const lv = Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"))
    .find((b) => /lively/i.test(b.textContent || ""));
  lv.scrollIntoView({ block: "center" });
  const r = lv.getBoundingClientRect();
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { y: Math.round(r.y), topmost: el === lv ? "BUTTON" : (el && el.tagName + "." + el.className),
    cursor: window.getComputedStyle(lv).cursor };
});
console.log("BUTTON:", JSON.stringify(info));
const cx = await page.evaluate(() => {
  const lv = Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"))
    .find((b) => /lively/i.test(b.textContent || ""));
  const r = lv.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
});
await page.mouse.move(cx[0], cx[1]);
await page.waitForTimeout(300);
const hov = await page.evaluate(() => {
  const lv = Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"))
    .find((b) => /lively/i.test(b.textContent || ""));
  return window.getComputedStyle(lv, ":hover").cursor;
});
console.log("CURSOR-ON-HOVER:", hov);
const e0 = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const ids = Object.keys(S.geom); let s = 0; ids.forEach((id) => { s += S.geom[id].x + S.geom[id].y * 7; });
  return Math.round(s * 100) / 100;
});
await page.mouse.click(cx[0], cx[1]);
await page.waitForTimeout(2500);
const after = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  const ids = Object.keys(S.geom); let s = 0; ids.forEach((id) => { s += S.geom[id].x + S.geom[id].y * 7; });
  return { phys: S.phys, temp: +S.temp.toFixed(2), running: S.running,
    sum: Math.round(s * 100) / 100,
    pressed: Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn")).map((b) => b.textContent + "=" + b.getAttribute("aria-pressed")).join(",") };
});
console.log("PRE-SUM:", e0, "AFTER:", JSON.stringify(after), "MOVED:", Math.abs(after.sum - e0) > 50 ? "YES" : "NO");
console.log("ERRS:", errs.length ? errs.slice(0, 5) : "none");
await browser.close();
