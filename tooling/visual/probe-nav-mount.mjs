/* probe-nav-mount.mjs — the in-app navigation mount gate.
 *
 * WHY: direct-URL proofs cannot see a view that stacks under the previous
 * one (a fresh #view is empty), which is exactly how the Account Network
 * page shipped broken: arriving from the Labs TOC left "Labs (4)" and the
 * TOC's four cards on screen, and the page had no <h1> at all. This probe
 * exercises the real path — click from one view to another — and asserts the
 * mount contract the checker (tooling/audit_view_mounts.py) can only partly
 * prove: after navigation, #view holds exactly ONE .wrap, the new view's own
 * heading is the first h1, and no stale view chrome survives.
 *
 * DEV-ONLY: playwright lives in tooling/visual/node_modules; never shipped,
 * never required to run the wallet. Run:
 *   PLAYWRIGHT_BROWSERS_PATH=.browsers node tooling/visual/probe-nav-mount.mjs */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = "/workspace/vanilla";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const p = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, p === "/" ? "index.html" : p);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (e) { res.writeHead(404).end("x"); }
});
await new Promise((r) => server.listen(8233, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e)));

/* The first-run tour dialog is a full-screen overlay that swallows clicks —
 * a real user dismisses it once, so the probe does too (its own persistence
 * key, tour-ui.js:23; Store.backend's default adapter writes localStorage
 * verbatim). */
await page.addInitScript(() => {
  try { localStorage.setItem("bts-vanilla-tour-dismissed-v1", "1"); } catch (e) { /* storage-less run */ }
});

const snap = () => page.evaluate(() => {
  const view = document.getElementById("view") || { querySelectorAll: () => [] };
  const q = (s) => view.querySelectorAll(s);
  const h1 = view.querySelector("h1");
  const icon = h1 ? h1.querySelector("img") : null;
  return {
    hash: location.hash,
    title: document.title,
    wraps: q(".wrap").length,
    firstH1: (h1 ? h1.textContent : "").trim(),
    headIcon: icon ? (icon.getAttribute("src") || "") : "",
    menuCards: q(".menu-card").length,
    crumbs: q(".menu-crumb").length,
    seedsInput: q(".an-seeds").length,
    graphHost: q(".an-graph").length,
    canvas: q("canvas").length,
  };
});

let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : ""));
};

/* 1. start on the Labs TOC */
await page.goto("http://localhost:8233/#/menu/labs", { waitUntil: "load" });
await page.waitForTimeout(1500);
const toc = await snap();
check("labs TOC renders as its own page", toc.firstH1.startsWith("Labs") && toc.menuCards === 4, JSON.stringify(toc));

/* 2. click the Account Network card — the reported defect */
await page.locator('a.menu-card[href^="#/account-network"]').first().click();
await page.waitForTimeout(2000);
const after = await snap();
check("click opens the account-network page", after.hash.startsWith("#/account-network"), "hash=" + after.hash);
check("no stacked view (one .wrap)", after.wraps === 1, "wraps=" + after.wraps);
check("own heading is the first h1", after.firstH1.indexOf("Account Network") === 0, "h1=" + JSON.stringify(after.firstH1));
check("heading carries the wired connected icon", /connected/.test(after.headIcon), "src=" + after.headIcon);
check("no stale Labs TOC chrome", after.menuCards === 0 && after.crumbs === 0, "cards=" + after.menuCards + " crumbs=" + after.crumbs);
check("page controls present", after.seedsInput === 1 && after.graphHost === 1, "seeds=" + after.seedsInput + " graph=" + after.graphHost);

/* 3. browser Back returns to the Labs TOC, still clean */
await page.goBack();
await page.waitForTimeout(1200);
const back = await snap();
check("back returns to the Labs TOC", back.firstH1.startsWith("Labs") && back.wraps === 1 && back.menuCards === 4, JSON.stringify(back));

/* 4. deep link straight to the page with seeds — the documented entry path */
await page.goto("http://localhost:8233/#/account-network?seeds=committee-account&classes=transfer,credit", { waitUntil: "load" });
await page.waitForTimeout(1200);
const deep = await snap();
check("deep link renders the page directly", deep.firstH1.indexOf("Account Network") === 0 && deep.wraps === 1, JSON.stringify(deep));
const seeded = await page.evaluate(() => (document.querySelector(".an-seeds") || {}).value || "");
check("deep link seeds prefill the input", /committee-account/.test(seeded), "value=" + JSON.stringify(seeded));
/* the scan needs the history index; wait briefly for a canvas or a status line */
await page.waitForTimeout(9000);
const drawn = await snap();
const status = await page.evaluate(() => (document.querySelector(".an-status") || {}).textContent || "");
check("draw attempt reports an honest status", status.trim().length > 0, "status=" + JSON.stringify(status.trim().slice(0, 90)));
console.log("     (canvas=" + drawn.canvas + " — 0 means no node/index in this probe run)");

/* 5. one more in-app hop away and back, to catch a second stacking path */
await page.goto("http://localhost:8233/#/menu", { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.locator('a.menu-card[href="#/menu/labs"]').first().click();
await page.waitForTimeout(900);
await page.locator('a.menu-card[href^="#/account-network"]').first().click();
await page.waitForTimeout(1500);
const hop = await snap();
check("second hop stays clean", hop.wraps === 1 && hop.menuCards === 0 && hop.firstH1.indexOf("Account Network") === 0, JSON.stringify(hop));

console.log("console errors:", errs.length ? errs : "none");
check("no console errors", errs.length === 0);

/* 6. theme trio + both ends for the page this probe is about (principle #5
 *    renders acceptably in all three themes, #7 at 360px and desktop). */
for (const theme of ["ref-ui-theme", "dex-ux-theme", "vanilla-ui-theme"]) {
  for (const [label, vp] of [["phone", { width: 360, height: 780 }], ["desk", { width: 1440, height: 900 }]]) {
    await page.setViewportSize(vp);
    await page.evaluate((th) => {
      document.documentElement.setAttribute("data-theme", th);
      location.hash = "#/menu/labs";
    }, theme);
    await page.waitForTimeout(700);
    await page.locator('a.menu-card[href^="#/account-network"]').first().click();
    await page.waitForTimeout(900);
    const t = await page.evaluate(() => {
      const view = document.getElementById("view");
      const h1 = view.querySelector("h1");
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        h1: h1 ? h1.textContent.trim() : "",
        iconVisible: !!(h1 && h1.querySelector("img")),
        controls: view.querySelectorAll(".an-seeds, .an-go, .an-chip").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wraps: view.querySelectorAll(".wrap").length,
      };
    });
    check(theme + "/" + label + ": own heading + wired icon",
      t.h1.indexOf("Account Network") === 0 && t.iconVisible, JSON.stringify(t));
    check(theme + "/" + label + ": controls present, no overflow, no stacking",
      t.controls >= 6 && t.overflow <= 1 && t.wraps === 1, "controls=" + t.controls + " overflow=" + t.overflow + " wraps=" + t.wraps);
    await page.screenshot({ path: "/tmp/opencode/an-" + theme + "-" + label + ".png" });
  }
}
await page.setViewportSize({ width: 1440, height: 900 });

/* 7. live draw in the default theme: canvas mounts and the status line is honest */
await page.goto("http://localhost:8233/#/account-network?seeds=committee-account&classes=transfer,credit", { waitUntil: "load" });
await page.waitForTimeout(11000);
const live = await page.evaluate(() => {
  const c = document.querySelector("#view canvas");
  const box = c ? c.getBoundingClientRect() : null;
  return {
    canvas: !!c,
    w: box ? Math.round(box.width) : 0,
    h: box ? Math.round(box.height) : 0,
    status: ((document.querySelector(".an-status") || {}).textContent || "").trim(),
    rows: document.querySelectorAll(".an-twin-body tr").length,
  };
});
check("live draw mounts a canvas", live.canvas && live.w > 300 && live.h > 200, JSON.stringify(live));
check("live draw reports real counts (no raw integers on screen)",
  /accounts/.test(live.status) && /lines/.test(live.status) && live.rows > 1, "status=" + JSON.stringify(live.status.slice(0, 80)));
await page.screenshot({ path: "/tmp/opencode/an-live-draw.png" });

/* 8. follow-up batch, kept green here (probe-followups retired into this gate):
 * no pool chrome on the account page; node activation re-seeds the map with
 * the node's account ID; account-id seeds draw. */
const chrome = await page.evaluate(() => {
  const view = document.getElementById("view");
  return {
    legend: view.querySelectorAll(".pool-net-legend").length,
    twin: view.querySelectorAll(".pool-net-twin").length,
    poolWords: /pools ·|Pool rows/.test(view.innerText || ""),
  };
});
check("no pool chrome on the account page", chrome.legend === 0 && chrome.twin === 0 && !chrome.poolWords, JSON.stringify(chrome));
await page.locator("#view canvas").first().focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);
const keynav = await page.evaluate(() => location.hash);
check("node activation re-seeds the map", keynav.startsWith("#/account-network?seeds="), "hash=" + keynav);
check("node activation seeds the account id", /seeds=1\.2\.\d+/.test(keynav), "hash=" + keynav);
await page.waitForTimeout(9000);
const iddraw = await page.evaluate(() => ({
  status: ((document.querySelector(".an-status") || {}).textContent || "").trim(),
  canvas: document.querySelectorAll("#view canvas").length,
}));
check("id-seeded map auto-draws", iddraw.canvas === 1 && iddraw.status.length > 20, JSON.stringify(iddraw.status.slice(0, 80)));

console.log("console errors after all steps:", errs.length ? errs : "none");
check("still no console errors", errs.length === 0);
await page.screenshot({ path: "/tmp/opencode/nav-mount-account-network.png" });
await browser.close();
server.close();
console.log(fails ? "nav-mount: " + fails + " FAILURE(S)" : "nav-mount: PASS");
process.exit(fails ? 1 : 0);
