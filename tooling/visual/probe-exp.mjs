import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 250)));
await page.goto("http://localhost:8081/#/explorer", { waitUntil: "load" });
await page.waitForTimeout(9000);
const out = await page.evaluate(async () => {
  const r = {};
  try {
    // raw chain reads
    const dbId = await Chain.db();
    const page1 = await Chain.call(dbId, "list_assets", ["", 25]);
    r.page1Count = page1.length;
    r.page1Syms = page1.map((a) => a.symbol);
    r.btsOnPage1 = page1.some((a) => a.symbol === "BTS");
    const btsRow = page1.find((a) => a.symbol === "BTS");
    r.btsBitasset = btsRow ? (btsRow.bitasset_data_id || null) : "not-on-page";
    // raw lookup_accounts shape
    const la = await Chain.call(dbId, "lookup_accounts", ["committee", 5]);
    r.lookupRaw = JSON.stringify(la).slice(0, 200);
    r.lookupIsPairs = Array.isArray(la) && la.length > 0 && Array.isArray(la[0]);
  } catch (e) { r.chainErr = String((e && e.message) || e); }
  // what mode is the assets tab in?
  const checked = document.querySelector('input[name="xplore-asset-filter"]:checked');
  r.modeChecked = checked ? checked.value : "(none found)";
  const search = document.querySelector('input[type="search"]');
  r.searchPresent = !!search;
  r.countLine = (document.querySelector(".muted") || {}).textContent || "";
  return r;
});
console.log(JSON.stringify(out, null, 1));
console.log("ERRORS:", JSON.stringify(errors));
await browser.close();
