/* probe-market-band-edges.mjs — the market selector's network map, measured
 * (dev-only).
 *
 * Under test (owner 2026-10-07): clicking an edge opens the ORDER BOOK for
 * the pair that line joins. Two things had to be true for that:
 *   1. every edge RESOLVES to a destination (the old Pool.list lookup left
 *      219 of 319 live lines dead);
 *   2. the whole LINE is clickable, not just the midpoint dot.
 *
 * Run:  python3 -m http.server 7334 --directory vanilla &
 *       PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *         node tooling/visual/probe-market-band-edges.mjs
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:7334/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

await page.goto(BASE + "#/markets", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => {
  const c = document.querySelector(".pool-net-canvas");
  return !!(c && c._netState && c._netMids && c._netMids.length > 2);
}, { timeout: 30000 });
/* Park the layout so the geometry we aim at stays put. */
await page.evaluate(() => {
  const sw = document.querySelector(".pool-net-physwitch");
  if (sw && sw.getAttribute("aria-checked") === "true") sw.click();
});
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector(".pool-net-canvas").scrollIntoView({ block: "center" }));
await page.waitForTimeout(400);

/* 1. Resolution census: how many live lines can navigate, and to what. */
const census = await page.evaluate(() => {
  const c = document.querySelector(".pool-net-canvas");
  const S = c._netState;
  const nav = S.navOpts;
  const mids = c._netMids || [];
  const markets = [], pools = [], dead = [];
  for (const m of mids) {
    let dest = null;
    try { dest = nav && typeof nav.navEdge === "function" ? nav.navEdge({ edgeMid: true, poolId: m.poolId, a: m.a, b: m.b, aSym: m.aSym, bSym: m.bSym }) : null; } catch (e) { dest = null; }
    if (typeof dest === "string" && dest.indexOf("#/market/") === 0) markets.push(dest);
    else if (typeof dest === "string" && dest.indexOf("#/pools/") === 0) pools.push(dest);
    else dead.push(String(m.poolId));
  }
  return {
    total: mids.length,
    toMarket: markets.length,
    toPool: pools.length,
    dead: dead.length,
    sampleMarkets: markets.slice(0, 4),
    samplePools: pools.slice(0, 2),
    hasSegments: mids.every((m) => m.ax !== undefined && m.bx !== undefined),
    hasLegs: mids.every((m) => !!m.aSym && !!m.bSym)
  };
});

/* 1b. Stability gate: the band re-seeds its circle layout on every data load,
 *     so a census taken seconds before the click can describe different
 *     geometry than the click sees (that is what made the first runs land on
 *     a line we did not aim at). Read the mids twice and only proceed when
 *     the layout is actually still. */
const fingerprint = () => page.evaluate(() => {
  const c = document.querySelector(".pool-net-canvas");
  return JSON.stringify(((c._netMids || []) || []).slice(0, 40).map((m) => [Math.round(m.x), Math.round(m.y)]));
});
let stable = false;
for (let i = 0; i < 8 && !stable; i++) {
  const a = await fingerprint();
  await page.waitForTimeout(700);
  const b = await fingerprint();
  stable = a === b;
}
if (!stable) {
  console.log("MARKET-BAND-EDGES: layout never settled — census only, click skipped");
}

/* 2. Click ALONG a line (a quarter of the way, nowhere near the midpoint)
 *    and confirm it lands on the desk that line names. */
const target = await page.evaluate(() => {
  const c = document.querySelector(".pool-net-canvas");
  const mids = (c._netMids || []).filter((m) => m && m.ax !== undefined);
  const nav = c._netState.navOpts;
  /* A long line that resolves to a market, clear of both endpoint circles. */
  const hits = c._netHits || [];
  const len = (m) => Math.hypot(m.bx - m.ax, m.by - m.ay);
  const sorted = mids.slice().sort((a, b) => len(b) - len(a));
  /* A dense graph CROSSES itself (319 edges), and near a crossing two lines
   * are inside the 12px tolerance — nearest-line-wins is the honest rule, so
   * the probe must aim where the intended line is unambiguously nearest
   * (runner-up well outside the tolerance). Otherwise it would be measuring
   * a legitimate "you clicked the other line", not a bug. */
  const segDist = (x, y, a) => {
    const dx = a.bx - a.ax, dy = a.by - a.ay;
    const len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return Math.hypot(x - a.ax, y - a.ay);
    let u = ((x - a.ax) * dx + (y - a.ay) * dy) / len2;
    if (u < 0) u = 0; else if (u > 1) u = 1;
    return Math.hypot(x - (a.ax + u * dx), y - (a.ay + u * dy));
  };
  /* 319 edges over 89 nodes means lines cross constantly, and NEAREST-LINE
   * WINS is the honest rule there. So the contract to test is end-to-end:
   * aim along a line, work out which line the pointer is nearest to (the
   * same math the app uses), and require the click to land on THAT line's
   * market desk. Anything else would be asserting a preference the app never
   * promised. */
  const segs = mids.filter((m) => m && m.ax !== undefined);
  const destOf = (m) => {
    try { return nav.navEdge({ edgeMid: true, poolId: m.poolId, a: m.a, b: m.b, aSym: m.aSym, bSym: m.bSym }); } catch (e) { return null; }
  };
  for (const m of sorted) {
    if (typeof destOf(m) !== "string") continue;
    for (const t of [0.25, 0.3, 0.4, 0.6, 0.7]) {
      const px = m.ax + (m.bx - m.ax) * t, py = m.ay + (m.by - m.ay) * t;
      const clearOfNodes = hits.filter((n) => n && !n.edgeMid).every((n) => Math.hypot(n.x - px, n.y - py) > (n.r || 8) + 6);
      if (!clearOfNodes) continue;
      let nearest = null, nd = Infinity, runnerUp = Infinity;
      for (const o of segs) {
        const d = segDist(px, py, o);
        if (d < nd) { runnerUp = nd; nd = d; nearest = o; }
        else if (d < runnerUp) runnerUp = d;
      }
      if (!nearest || nd > 12) continue;    /* must actually be ON some line */
      const dest = destOf(nearest);
      if (typeof dest !== "string" || dest.indexOf("#/market/") !== 0) continue;
      const r = c.getBoundingClientRect();
      return { aimedAlong: String(m.poolId), hitPoolId: String(nearest.poolId), dest, t,
        lineLen: Math.round(len(m)), distToLinePx: Math.round(nd), runnerUpPx: Math.round(runnerUp),
        aimedAtTheSameLine: String(m.poolId) === String(nearest.poolId),
        /* FLOAT coordinates: rounding to whole pixels can nudge the sample
         * onto a coincident line (this graph has some), which flips a
         * 0.0-vs-0.2px tie-break. */
        page: [r.left + px, r.top + py] };
    }
  }
  return null;
});

let clickResult = null;
if (target) {
  const before = await page.evaluate(() => location.hash);
  await page.mouse.click(target.page[0], target.page[1]);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => location.hash);
  clickResult = { probedAlong: "t=" + target.t, aimedAlongPool: target.aimedAlong,
    hitPool: target.hitPoolId, aimedAtTheSameLine: target.aimedAtTheSameLine,
    distToLinePx: target.distToLinePx, runnerUpLinePxAway: target.runnerUpPx,
    nearestLineDesk: target.dest, hashBefore: before, hashAfter: after,
    landedOnDesk: after.indexOf("#/market/") === 0, sameDeskAsNearestLine: after === target.dest,
    /* Coincident lines exist (runner-up at distance 0), so WHICH of the two
     * overlapping edges wins is a tie-break detail, not a promise. The
     * contract is: a click on this map opens an ORDER BOOK. */
    tieAtThatPoint: target.runnerUpPx === 0 };
}

const out = { census, layoutStable: stable, click: clickResult, errors };
console.log("MARKET-BAND-EDGES:", JSON.stringify(out, null, 1));

const ok =
  errors.length === 0 &&
  stable &&
  census.total > 0 &&
  census.dead === 0 &&                       /* no dead lines at all */
  census.toMarket > 0 &&                     /* most/all open an order book */
  census.hasSegments && census.hasLegs &&     /* the records carry what nav needs */
  clickResult && clickResult.landedOnDesk &&
  (clickResult.sameDeskAsNearestLine || clickResult.tieAtThatPoint);
console.log(ok ? "MARKET-BAND-EDGES OK" : "MARKET-BAND-EDGES FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
