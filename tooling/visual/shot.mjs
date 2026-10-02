// Visual iteration aid for the vanilla BitShares build (DEV ONLY —
// never shipped, never required: the human browser pass stays the gate).
// Screenshots any vanilla route headlessly and reports console errors.
//
// Usage (server must be running: python3 -m http.server 8081 --directory vanilla):
//   node shot.mjs --url http://localhost:8081/#/settings --width 1440 --out /tmp/s.png
//   node shot.mjs --url http://localhost:8081/#/settings --width 390 --theme dark --out /tmp/s-mobile.png
//
// Requires: PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers (this dir). Stdlib + playwright-core only.
// OS deps (Ubuntu 22.04, one-time as root — the failure mode is the
// headless shell exiting on missing libnspr4.so; unblocked 2026-10-01):
//   apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2
//     libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
//     libgbm1 libpango-1.0-0 libcairo2 libasound2
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);

const url = args.url || "http://localhost:8081/#/";
const width = Number(args.width || 1440);
const height = Number(args.height || 900);
const out = args.out || "/tmp/shot.png";
const theme = args.theme || null;
const network = args.network || null;
const noTour = args.notour || null;
const locale = args.locale || null;
const waitMs = Number(args.wait || 12000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text().slice(0, 300));
});
page.on("pageerror", (err) => errors.push("pageerror: " + String(err).slice(0, 300)));
if (theme || network || noTour || locale) {
  await page.addInitScript(
    ({ t, n, nodes, notour, loc }) => {
      try {
        const raw = localStorage.getItem("bts-vanilla-settings-v1");
        const s = raw ? JSON.parse(raw) : {};
        if (t) s.theme = t;
        if (n) {
          s.network = n;
          const list = (nodes && nodes[n]) || [];
          if (list.length) s.activeNode = list[0];
        }
        localStorage.setItem("bts-vanilla-settings-v1", JSON.stringify(s));
        if (notour) localStorage.setItem("bts-vanilla-tour-dismissed-v1", "1");
        if (loc) localStorage.setItem("bts-vanilla-locale-v1", loc);
      } catch {}
    },
    {
      t: theme,
      n: network,
      notour: noTour,
      loc: locale,
      nodes: {
        mainnet: ["wss://api.bitshares.dev/ws"],
        testnet: ["wss://testnet.xbts.io/ws"],
      },
    }
  );
}
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(waitMs);
/* Optional tab-gated capture: --click TEXT clicks the first button whose
 * trimmed uppercase text matches, then waits again (AFK rounds need shots
 * of tab content like account HISTORY without a human hand). Never throws
 * the run — a missing button just shoots the unclicked page. */
if (args.click) {
  try {
    await page.evaluate((want) => {
      const btns = Array.from(document.querySelectorAll("button"));
      const b = btns.find((x) => (x.textContent || "").trim().toUpperCase() === String(want).toUpperCase());
      if (b) b.click();
    }, args.click);
    await page.waitForTimeout(Math.min(waitMs, 10000));
  } catch (e) { /* unclicked shot stands */ }
}
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, width, height, theme, consoleErrors: errors }));
await browser.close();
if (errors.length) process.exitCode = 2;
