import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
await page.goto("http://localhost:8081/#/explorer", { waitUntil: "load" });
await page.waitForTimeout(8000);
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const assets = tabs.find((t) => /asset/i.test(t.textContent));
  if (assets) assets.click();
});
await page.waitForTimeout(2500);
// type into the TAB's filter input (inside xplore-filters), then wait for debounce+fetch+enrich
await page.evaluate(() => {
  const s = document.querySelector(".xplore-filters input[type=\"search\"]");
  if (s) { s.focus(); s.value = "BTS"; s.dispatchEvent(new Event("input", { bubbles: true })); }
});
await page.waitForTimeout(7000);
const assetsRes = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".xplore-tablewrap tbody tr")).map((tr) => tr.firstChild.textContent);
  const emptyMsg = Array.from(document.querySelectorAll(".xplore-tablewrap p")).map((p) => p.textContent).join(" / ");
  return { n: rows.length, rows: rows.slice(0, 10), emptyMsg };
});
console.log("ASSETS:", JSON.stringify(assetsRes, null, 1));
// accounts tab
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const accts = tabs.find((t) => /account/i.test(t.textContent));
  if (accts) accts.click();
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const forms = Array.from(document.querySelectorAll("form"));
  const f = forms.find((fm) => fm.querySelector('input[placeholder*="prefix" i], input[placeholder*="Prefix"]')) || forms[0];
  const inp = f.querySelector("input");
  inp.focus(); inp.value = "committee";
  f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
await page.waitForTimeout(5000);
const acctsRes = await page.evaluate(() => Array.from(document.querySelectorAll("ul li a")).slice(0, 5).map((a) => ({ href: a.getAttribute("href"), text: a.textContent })));
console.log("ACCOUNTS:", JSON.stringify(acctsRes, null, 1));
console.log("ERRORS:", JSON.stringify(errors));
await browser.close();
