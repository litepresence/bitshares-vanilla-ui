import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:7334/#/pools/1.19.1", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(8000);
await page.evaluate(() => {
  const r = Array.from(document.querySelectorAll('input[type="radio"]')).find((x) => x.value === "discrete");
  if (r) r.click();
  const t = document.querySelector("#tour-card"); if (t) t.style.display = "none";
  const w = document.querySelector(".warn-banner"); if (w) w.style.display = "none";
});
await page.waitForTimeout(4000);
const cvs = await page.$$("canvas.mkt-canvas");
console.log("canvases:", cvs.length);
for (let i = 0; i < cvs.length; i++) {
  const box = await cvs[i].boundingBox();
  if (box && box.width > 300 && box.height > 100) {
    await cvs[i].screenshot({ path: "/tmp/disc-pane-" + i + ".png" });
    console.log("shot", i, Math.round(box.width) + "x" + Math.round(box.height));
  }
}
await browser.close();
