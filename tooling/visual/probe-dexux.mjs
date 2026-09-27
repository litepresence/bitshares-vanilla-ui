// Probe renderer for dexux style iteration (DEV ONLY — headless visual aid).
// Renders unlock-gated views with stubbed wallet/account (in-page only, the
// shipped gating is untouched) against REAL testnet chain data, then shots.
//
// Usage (server must run: python3 -m http.server 8081 --directory vanilla):
//   node probe-dexux.mjs --what pools --theme dark --out /tmp/p.png
//   node probe-dexux.mjs --what trade --theme original-blue --out /tmp/t.png
//   node probe-dexux.mjs --what instant --theme dark --out /tmp/i.png
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);

const what = args.what || "pools";
const width = Number(args.width || 1440);
const height = Number(args.height || 900);
const out = args.out || "/tmp/probe.png";
const theme = args.theme || "original-blue";
const waitMs = Number(args.wait || 15000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text().slice(0, 300));
});
page.on("pageerror", (err) => errors.push("pageerror: " + String(err).slice(0, 300)));
await page.addInitScript(({ t }) => {
  try {
    const raw = localStorage.getItem("bts-vanilla-settings-v1");
    const s = raw ? JSON.parse(raw) : {};
    s.theme = t;
    s.network = "testnet";
    s.activeNode = "wss://testnet.xbts.io/ws";
    localStorage.setItem("bts-vanilla-settings-v1", JSON.stringify(s));
  } catch {}
}, { t: theme });
await page.goto("http://localhost:8081/#/", { waitUntil: "domcontentloaded", timeout: 30000 });
// Wait for the real socket before stubbing anything (no new sockets: the
// app's own connection only).
await page.waitForFunction(
  () => typeof Chain !== "undefined" && Chain.status && Chain.status().state === "open",
  { timeout: 25000 }
);
await page.evaluate(async (w) => {
  // Unlock + account stubs (visual probe only — shipped gating untouched).
  Wallet.isUnlocked = () => true;
  Account.myAccountId = () => Promise.resolve("1.2.310");
  Account.resolve = () => Promise.resolve({ id: "1.2.310", name: "probe-acct" });
  const view = document.getElementById("view");
  view.innerHTML = "";
  if (w === "pools") {
    Pool.mine = () => Promise.resolve([]);
    PoolUI.renderPools(view);
  } else if (w === "trade") {
    const am = await Market.assets("USD", "TEST");
    const mount = document.createElement("div");
    mount.id = "probe-trade";
    view.appendChild(mount);
    TradeUI.renderPanels(document, mount, {
      base: am.base.id, quote: am.quote.id,
      basePrec: am.base.precision, quotePrec: am.quote.precision,
      baseSym: am.base.symbol, quoteSym: am.quote.symbol,
      myId: null, refresh: () => {}
    });
  } else if (w === "instant") {
    InstantTradeUI.renderInstant(view, "USD_TEST");
  } else if (w === "swap") {
    PoolSwapUI.renderSwap(view);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btnByText = (t) =>
      [...view.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
    await sleep(1500);
    const inputs = view.querySelectorAll("input");
    // Sell asset=TEST, Buy asset=CONTEST.BTC (pool 1.19.0 on testnet), amount=1.
    if (inputs[0]) inputs[0].value = "TEST";
    if (inputs[1]) inputs[1].value = "CONTEST.BTC";
    if (inputs[2]) inputs[2].value = "1";
    const find = btnByText("Find pools");
    if (find) find.click();
    await sleep(6000);
    const quote = btnByText("Quote");
    if (quote) quote.click();
    await sleep(6000);
  }
}, what);
await page.waitForTimeout(waitMs);
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, what, width, height, theme, consoleErrors: errors }));
await browser.close();
if (errors.length) process.exitCode = 2;
