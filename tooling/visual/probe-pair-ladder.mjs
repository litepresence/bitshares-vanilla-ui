/* probe-pair-ladder.mjs — headless check that the selector ladder reads the
 * global pair (dev-only; never shipped, never required to use the wallet).
 *
 * Run:  python3 -m http.server 7334 --directory vanilla &
 *       PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *         node tooling/visual/probe-pair-ladder.mjs
 * Exit 0 when every assertion holds; otherwise LADDER FAIL + exit 1.
 *
 * Covers: navbar labels, selector H1s, the [BTS] default seed, a desk
 * writing the pair and the selector coming back seeded, the shared
 * ?a=/?b= deep link still winning over the stored pair, and the
 * section-aware tab highlight one rung down.
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:7334/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
const out = {};

async function seedInputs() {
  return page.$$eval(".pools-filters input", (ns) => ns.map((n) => n.value));
}

/* --- default seed: [BTS] with no second leg --- */
await page.goto(BASE + "#/markets", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector(".pools-filters input", { timeout: 20000 });
out.defaultSeed = await seedInputs();

/* --- a desk writes the pair; the selector comes back seeded --- */
await page.evaluate(() => PairContext.set(["BTS", "ETH"]));
await page.goto(BASE + "#/market/ETH_BTS", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
out.deskWrote = await page.evaluate(() => PairContext.get().join(","));
await page.goto(BASE + "#/markets", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pools-filters input", { timeout: 20000 });
out.seededFromPair = await seedInputs();

/* --- a shared deep link still wins over the stored pair --- */
await page.goto(BASE + "#/markets?a=DOGE&b=USD", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pools-filters input", { timeout: 20000 });
out.deepLinkWins = await seedInputs();

/* --- navbar + heading ladder --- */
out.navbar = await page.$$eval("#nav a", (as) => as.map((a) => a.textContent.trim()).filter(Boolean).slice(0, 6));
out.h1 = await page.$eval("h1", (h) => h.textContent.trim());
out.marketsTabCurrent = await page.$$eval('#nav a[href="#/markets"]', (as) => as.map((a) => a.getAttribute("aria-current")));
out.deskTabCurrent = await page.goto(BASE + "#/market/ETH_BTS", { waitUntil: "domcontentloaded" })
  .then(() => page.waitForTimeout(1500))
  .then(() => page.$$eval('#nav a[href="#/markets"]', (as) => as.map((a) => a.getAttribute("aria-current"))));

/* --- pools selector: same precedence, same pair --- */
await page.goto(BASE + "#/pools", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pools-filters input", { timeout: 20000 });
out.poolsH1 = await page.$eval("h1", (h) => h.textContent.trim());
out.poolsSeed = await page.$$eval(".pools-filters input", (ns) => ns.slice(0, 2).map((n) => n.value));
out.poolsTabCurrent = await page.$$eval('#nav a[href="#/pools"]', (as) => as.map((a) => a.getAttribute("aria-current")));
await page.goto(BASE + "#/pools/1.19.0", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
out.poolsTabOnDesk = await page.$$eval('#nav a[href="#/pools"]', (as) => as.map((a) => a.getAttribute("aria-current")));
out.poolDeskWrote = await page.evaluate(() => PairContext.get().join(","));

out.errors = errors;
console.log("LADDER:", JSON.stringify(out));
const ok =
  JSON.stringify(out.defaultSeed) === JSON.stringify(["BTS", ""]) &&
  out.deskWrote === "BTS,ETH" &&
  JSON.stringify(out.seededFromPair) === JSON.stringify(["BTS", "ETH"]) &&
  JSON.stringify(out.deepLinkWins) === JSON.stringify(["DOGE", "USD"]) &&
  out.h1 === "Market Selector" &&
  out.poolsH1 === "Pool Selector" &&
  out.navbar.includes("Markets") &&
  out.navbar.includes("Pools") &&
  JSON.stringify(out.marketsTabCurrent) === JSON.stringify(["page"]) &&
  JSON.stringify(out.deskTabCurrent) === JSON.stringify(["page"]) &&
  JSON.stringify(out.poolsTabCurrent) === JSON.stringify(["page"]) &&
  JSON.stringify(out.poolsTabOnDesk) === JSON.stringify(["page"]) &&
  out.poolDeskWrote.indexOf("BTS") !== -1 &&
  errors.length === 0;
console.log(ok ? "LADDER OK" : "LADDER FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
