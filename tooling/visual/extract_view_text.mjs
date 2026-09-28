// DEV ONLY — dump #view innerText for i18n batch diffs (lives here so
// playwright-core resolves from this dir's node_modules, same as shot.mjs).
// Usage: node tooling/visual/extract_view_text.mjs --url http://localhost:8082/#/market/USD_TEST --out /tmp/x.txt [--wait 15000]
// Requires: PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers. Stdlib + playwright-core only.
import { chromium } from "playwright-core";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);
const url = args.url || "http://localhost:8082/#/";
const out = args.out || "/tmp/view.txt";
const waitMs = Number(args.wait || 15000);
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(waitMs);
const data = await page.evaluate(() => {
  const v = document.querySelector("#view");
  return {
    viewText: v ? v.innerText : null,
    keyIds: (v ? v.innerText : "").split("\n").filter((l) => /[a-z_]+\.[a-z_0-9]+/.test(l)),
  };
});
await page.close();
await browser.close();
fs.writeFileSync(out, (data.viewText || "") + "\n");
console.log(JSON.stringify({ out, chars: (data.viewText || "").length, keyIdLines: data.keyIds, pageErrors: errors }));
