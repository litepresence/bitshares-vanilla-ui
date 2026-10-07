/* probe-phys-toggle.mjs — the Physics switch, measured on every surface that
 * has one: both selector bands and both desk maps. Dev-only; never shipped.
 *
 * The promise under test (owner 2026-10-07):
 *   OFF = you can drag a node and NOTHING moves after the release
 *         (no settle, no spring reaction, no throw).
 *   ON  = the mesh reacts to the release.
 * Automatic settles (load, filter, resize) are not gestures, so they are not
 * asserted here — that is covered headlessly in pool-net-ui-test.js.
 *
 * Run:  python3 -m http.server 7334 --directory vanilla &
 *       PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *         node tooling/visual/probe-phys-toggle.mjs
 * Exit 0 when every surface agrees.
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:7334/";
const OFF_TOLERANCE = 0.75;   /* px of post-release motion tolerated as "stopped" */
const ON_MIN_MOTION = 5;      /* px: a reacting mesh moves well past this */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

/* The band (selector pages) keeps its live state on the canvas; the desk maps
 * keep theirs on PoolGraph's canvas._graphLiveS. Either way the probe only
 * needs "where are the node positions right now". */
async function readNodes() {
  return page.evaluate(() => {
    const out = {};
    const band = document.querySelector(".pool-net-canvas");
    const desk = document.querySelector(".mkt-canvas");
    const S = (band && band._netState) || (desk && desk._graphLiveS) || null;
    if (S && S.geom) {
      for (const k of Object.keys(S.geom)) out[k] = [S.geom[k].x, S.geom[k].y];
    }
    return out;
  });
}

async function hitPoint() {
  return page.evaluate(() => {
    const band = document.querySelector(".pool-net-canvas");
    const desk = document.querySelector(".mkt-canvas");
    const canvas = band || desk;
    if (!canvas) return null;
    const hits = (band && band._netHits) || (desk && desk._graphHits) || [];
    const h = hits.find((x) => x && x.assetId) || hits[0];
    if (!h) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + h.x, y: r.top + h.y, id: h.assetId };
  });
}

async function switchState() {
  return page.evaluate(() => {
    const sw = document.querySelector(".pool-net-physwitch");
    const hint = document.querySelector(".pool-net-physhint");
    const st = document.querySelector(".pool-net-physstate");
    if (!sw) return null;
    return {
      checked: sw.getAttribute("aria-checked"),
      state: st ? st.textContent.trim() : null,
      hint: hint ? hint.textContent.trim() : null,
      stored: (() => { try { return localStorage.getItem("poolNetReact"); } catch (e) { return "n/a"; } })()
    };
  });
}

async function setOff(wantOff) {
  return page.evaluate((off) => {
    const sw = document.querySelector(".pool-net-physwitch");
    if (!sw) return false;
    const isOff = sw.getAttribute("aria-checked") === "false";
    if (off !== isOff) sw.click();
    return true;
  }, wantOff);
}

async function measure(url, label) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => {
    const band = document.querySelector(".pool-net-canvas");
    const desk = document.querySelector(".mkt-canvas");
    const S = (band && band._netState) || (desk && desk._graphLiveS) || null;
    return !!(S && S.geom && Object.keys(S.geom).length > 1);
  }, { timeout: 25000 });
  /* Let the automatic load settle finish so it cannot be mistaken for a
   * gesture reaction. */
  await page.waitForTimeout(3500);

  const rows = [];
  for (const off of [true, false]) {
    if (!(await setOff(off))) { rows.push({ label, off, skipped: "no switch on this page" }); continue; }
    await page.waitForTimeout(off ? 400 : 900);
    const sw = await switchState();
    const hit = await hitPoint();
    if (!hit) { rows.push({ label, off, sw, skipped: "no node hit" }); continue; }
    await page.mouse.move(hit.x, hit.y);
    await page.mouse.down();
    await page.mouse.move(hit.x + 40, hit.y + 30, { steps: 6 });
    await page.mouse.up();
    /* Snapshot AFTER the release: the drag itself is not the measurement. */
    const s0 = await readNodes();
    await page.waitForTimeout(1500);
    const s1 = await readNodes();
    let max = 0;
    for (const k of Object.keys(s0)) {
      if (!s1[k]) continue;
      max = Math.max(max, Math.abs(s0[k][0] - s1[k][0]), Math.abs(s0[k][1] - s1[k][1]));
    }
    rows.push({
      label,
      off,
      ariaChecked: sw.checked,
      stateLabel: sw.state,
      stored: sw.stored,
      draggedNode: hit.id,
      maxMotionAfterRelease: Math.round(max * 100) / 100
    });
  }
  return rows;
}

const out = [];
for (const [url, label] of [
  ["#/pools", "pool selector"],
  ["#/markets", "market selector"],
  ["#/pools/1.19.0", "pool desk"],
  ["#/market/BTS_USD", "market desk"]
]) out.push(...(await measure(url, label)));

console.log("PHYS-TOGGLE:", JSON.stringify({ rows: out, errors }, null, 1));

const skipped = out.filter((r) => r.skipped);
const measured = out.filter((r) => !r.skipped && typeof r.maxMotionAfterRelease === "number");
const ok =
  errors.length === 0 &&
  measured.length > 0 &&
  measured.every((r) => (r.off
    ? r.maxMotionAfterRelease <= OFF_TOLERANCE && r.stored === "0"
    : r.maxMotionAfterRelease >= ON_MIN_MOTION)) &&
  /* every surface that HAS a switch must be measured in both states */
  new Set(measured.map((r) => r.label)).size === 4;
console.log(ok ? "PHYS-TOGGLE OK" : "PHYS-TOGGLE FAIL" +
  (skipped.length ? " (skipped: " + skipped.map((s) => s.label + " " + s.skipped).join(", ") + ")" : ""));
await browser.close();
process.exit(ok ? 0 : 1);
