// Visual iteration aid for the vanilla BitShares build (DEV ONLY —
// never shipped, never required: the human browser pass stays the gate).
// Screenshots any vanilla route headlessly and reports console errors.
//
// Usage (server must be running: python3 -m http.server 8081 --directory vanilla):
//   node shot.mjs --url http://localhost:8081/#/settings --width 1440 --out /tmp/s.png
//   node shot.mjs --url http://localhost:8081/#/settings --width 390 --theme dark --out /tmp/s-mobile.png
//   node shot.mjs --url http://localhost:8081/#/settings --browser firefox --out /tmp/s.png
//
// --browser picks the Playwright engine (chromium default | firefox | webkit).
// Use whichever engine is actually installed in the shared ms-playwright
// cache; on this machine only firefox-1543 is present, so pass
// --browser firefox. PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers is optional —
// the default shared cache (~/.cache/ms-playwright) works when the browser
// was installed elsewhere. Stdlib + playwright-core only (dev-only: the
// human browser pass stays the gate).
// OS deps (Ubuntu 22.04, one-time as root — the failure mode is the
// headless shell exiting on missing libnspr4.so; unblocked 2026-10-01):
//   apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2
//     libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
//     libgbm1 libpango-1.0-0 libcairo2 libasound2
import { chromium, firefox, webkit } from "playwright-core";

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

/* Engine choice: --browser chromium|firefox|webkit (default chromium).
 * Params: args.browser (string). Returns the Playwright browser type.
 * Fails: unknown name falls back to chromium (never throws). */
const engine = { chromium, firefox, webkit }[(args.browser || "chromium").toLowerCase()] || chromium;
const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text().slice(0, 300));
});
page.on("pageerror", (err) => errors.push("pageerror: " + String(err).slice(0, 300)));
/* Unhandled rejections are invisible otherwise (AFK R5 lesson: a cleared
 * list box + a rejected render promise = a silently empty panel the gate
 * never sees). Guarded: old playwright-core may lack the event. */
try {
  page.on("unhandledrejection", (reason) => errors.push("unhandled: " + String(reason).slice(0, 300)));
} catch (e) { /* pageerror coverage stands */ }
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
/* Optional scroll framing: --scrollY PX scrolls the page before capture
 * (region shots like the order-book panel without changing the route).
 * Never throws — unscrolled shot stands. */
if (args.scrollY) {
  try {
    await page.evaluate((y) => { window.scrollTo(0, Number(y) || 0); }, args.scrollY);
    await page.waitForTimeout(1200);
  } catch (e) { /* unscrolled shot stands */ }
}
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
/* Optional search proof: --type TEXT --into PLACEHOLDER types into the first
 * text input whose placeholder contains INTO (or the first text input), then
 * presses Enter and waits again (AFK rounds prove search routing headlessly).
 * Never throws the run — a missing input just shoots the untyped page. */
if (args.type) {
  try {
    const needle = (args.into || "").toLowerCase();
    var typedEcho = "";
    try {
      typedEcho = await page.evaluate(({ text, nd }) => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]'));
        const vis = inputs.filter((x) => { try { return x.offsetParent !== null; } catch (e) { return false; } });
        const pool = vis.length ? vis : inputs;
        const el = (nd && pool.find((x) => ((x.getAttribute("placeholder") || "").toLowerCase().indexOf(nd) !== -1))) || pool[0];
        if (el) { el.focus(); el.value = String(text); el.dispatchEvent(new Event("input", { bubbles: true })); return String(el.value).slice(0, 12) + "@" + String(el.getAttribute("placeholder") || "").slice(0, 20); }
        return "NO-EL(n=" + inputs.length + ",v=" + vis.length + ")";
      }, { text: args.type, nd: needle });
    } catch (e) { typedEcho = "EVAL-THREW:" + String(e && e.message || e).slice(0, 120); }
    globalThis.__typedEcho = typedEcho;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    /* Form-submit fallback: some handlers listen to the submit button only —
     * click it in the same form without clearing the typed value. */
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]'));
      const vis = inputs.filter((x) => { try { return x.offsetParent !== null; } catch (e) { return false; } });
      const pool = vis.length ? vis : inputs;
      const el = pool.find((x) => x && x.value) || pool[0];
      const form = el && el.form;
      const btn = form && form.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(Math.min(waitMs, 10000));
  } catch (e) { /* untyped shot stands */ }
}
await page.screenshot({ path: out });
/* Final hash: proves --click/--type interactions routed (log-only). */
let finalHash = "";
try { finalHash = await page.evaluate(() => String(location.hash || "")); } catch (e) { /* hash stands empty */ }
console.log(JSON.stringify({ out, width, height, theme, hash: finalHash, typed: (typeof globalThis.__typedEcho === "string" ? globalThis.__typedEcho : ""), consoleErrors: errors }));
await browser.close();
if (errors.length) process.exitCode = 2;
