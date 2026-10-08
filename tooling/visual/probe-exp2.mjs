import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
await page.goto("http://localhost:8081/#/explorer", { waitUntil: "load" });
await page.waitForTimeout(8000);
// click the Assets tab (2nd tab) then type BTS
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const assets = tabs.find((t) => /asset/i.test(t.textContent));
  if (assets) assets.click();
});
await page.waitForTimeout(1500);
const before = await page.evaluate(() => ({
  count: (document.querySelector(".xplore-tablewrap") || {}).textContent?.slice(0, 120) || "(none)"
}));
await page.evaluate(() => {
  const s = document.querySelector('input[type="search"]');
  s.focus(); s.value = "BTS";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(4000);
const after = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".xplore-tablewrap tbody tr")).map((tr) => tr.firstChild.textContent);
  const links = Array.from(document.querySelectorAll(".xplore-tablewrap tbody tr td:first-child a")).map((a) => a.getAttribute("href"));
  return { rows: rows.slice(0, 8), links: links.slice(0, 3), showing: document.querySelectorAll(".xplore-tablewrap p").length };
});
console.log(JSON.stringify({ before, after }, null, 1));
// accounts tab: search committee, read result links
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const accts = tabs.find((t) => /account/i.test(t.textContent));
  if (accts) accts.click();
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const inp = document.querySelector('.xplore-tablewrap input, div input[type="search"]') || Array.from(document.querySelectorAll("input")).find((i) => /prefix/i.test(i.placeholder || ""));
  if (inp) { inp.focus(); inp.value = "committee"; inp.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
});
await page.waitForTimeout(4000);
const accts = await page.evaluate(() => Array.from(document.querySelectorAll("ul li a")).slice(0, 4).map((a) => ({ href: a.getAttribute("href"), text: a.textContent })));
console.log(JSON.stringify({ accts }, null, 1));
console.log("ERRORS:", JSON.stringify(errors));
await browser.close();
