import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band .pool-net-physbtn", { timeout: 20000 });
await page.waitForTimeout(6000); // let it settle like a lingering user
const info = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"));
  const lv = btns.find((b) => /lively/i.test(b.textContent || ""));
  const r = lv.getBoundingClientRect();
  const cs = window.getComputedStyle(lv);
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    cursor: cs.cursor, disabled: !!lv.disabled,
    topmost: el === lv ? "BUTTON" : ((el && el.tagName) + "." + (el && el.className)),
    pressed: btns.map((b) => b.textContent + "=" + b.getAttribute("aria-pressed")).join(",") };
});
console.log("HOVER-INFO:", JSON.stringify(info));
// real mouse: hover then click with hit-testing
await page.mouse.move(info.rect.x + info.rect.w / 2, info.rect.y + info.rect.h / 2);
await page.waitForTimeout(400);
const hov = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn"));
  const lv = btns.find((b) => /lively/i.test(b.textContent || ""));
  return window.getComputedStyle(lv, ":hover").cursor;
});
console.log("CURSOR-ON-HOVER:", hov);
await page.mouse.click(info.rect.x + info.rect.w / 2, info.rect.y + info.rect.h / 2);
await page.waitForTimeout(800);
const after = await page.evaluate(() => {
  const S = document.querySelector("#pool-net-band canvas")._netState;
  return { phys: S.phys, temp: +S.temp.toFixed(2), running: S.running,
    pressed: Array.from(document.querySelectorAll("#pool-net-band .pool-net-physbtn")).map((b) => b.textContent + "=" + b.getAttribute("aria-pressed")).join(",") };
});
console.log("AFTER-REAL-CLICK:", JSON.stringify(after));
console.log("ERRS:", errs.length ? errs.slice(0, 5) : "none");
await browser.close();
