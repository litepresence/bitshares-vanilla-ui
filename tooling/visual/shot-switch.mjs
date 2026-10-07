import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector("#pool-net-band .pool-net-physwitch", { timeout: 20000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const sw = document.querySelector("#pool-net-band .pool-net-physwitch");
  sw.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(800);
// turn ON for the shot
await page.evaluate(() => { document.querySelector("#pool-net-band .pool-net-physwitch").click(); });
await page.waitForTimeout(2500);
await page.locator("#pool-net-band .pool-net-phys").screenshot({ path: "/tmp/switch-on.png" });
await browser.close();
