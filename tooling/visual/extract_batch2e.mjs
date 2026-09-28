// DEV ONLY — batch #view innerText dump for batch-2e English-identical proof.
// One browser, sequential routes; prints JSON {route: {text, keyIds, errors}}.
// Usage: node tooling/visual/extract_batch2e.mjs --base http://localhost:8081 --out /tmp/2e-base.json
// Requires: PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers.
import { chromium } from "playwright-core";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);
const BASE = args.base || "http://localhost:8081";
const OUT = args.out || "/tmp/2e-view.json";
const WAIT = Number(args.wait || 8000);

const ROUTES = [
  "/#/credit-offer", "/#/credit-offer/1.20.0", "/#/samet", "/#/borrow",
  "/#/barter", "/#/proposals", "/#/proposals/1.10.1", "/#/tickets",
  "/#/airdrop", "/#/authorities", "/#/lists", "/#/invoice",
  "/#/invoice/demo", "/#/vesting", "/#/login", "/#/registration",
  "/#/registration/local", "/#/registration/cloud", "/#/news", "/#/help",
  "/#/help/voting", "/#/fees", "/#/referrals", "/#/favourites",
  "/#/wallet/password", "/#/prediction", "/#/instant-trade",
  "/#/create-account", "/#/create-worker",
];

const browser = await chromium.launch();
const out = {};
for (const r of ROUTES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
  try {
    await page.goto(BASE + r, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(WAIT);
    out[r] = await page.evaluate(() => {
      const v = document.querySelector("#view");
      const t = v ? v.innerText : null;
      return {
        text: t,
        keyIds: (t || "").split("\n").filter((l) => /[a-z_]+\.[a-z_0-9]+/.test(l)),
      };
    });
    out[r].errors = errs;
  } catch (e) {
    out[r] = { text: null, keyIds: [], errors: ["goto: " + String(e).slice(0, 200)] };
  }
  await page.close();
}
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const nerr = Object.values(out).reduce((n, v) => n + (v.errors || []).length, 0);
console.log(JSON.stringify({ routes: ROUTES.length, out: OUT, totalErrors: nerr }));
