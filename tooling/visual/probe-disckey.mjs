import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e && e.message || e)));
await page.goto("http://localhost:7334/#/market/BTS_USD?tf=discrete", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);
const r = await page.evaluate(() => {
  const cvs = Array.from(document.querySelectorAll("canvas.mkt-canvas"));
  const c = cvs.find((x) => { try { return !!x._discreteRec && x._discreteRec.xs.length; } catch (e) { return false; } });
  if (!c) return { nodiscrete: true };
  c.focus();
  const t1 = document.activeElement === c;
  c.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
  c.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
  const tip = document.querySelector("[data-discrete-tip]");
  const out = { focused: t1, tip: !!tip && tip.style.display !== "none",
    text: tip ? tip.textContent.slice(0, 60) : null,
    tabbable: c.getAttribute("tabindex"), role: c.getAttribute("role") };
  c.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  out.cleared = !tip || tip.style.display === "none";
  return out;
});
console.log("KEYBOARD:", JSON.stringify(r));
console.log("errs:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
