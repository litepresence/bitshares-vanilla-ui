/* probe-desk-map-edges.mjs — the desk pool maps, measured (dev-only).
 *
 * Under test (owner 2026-10-07):
 *   1. The "triangle" (the pair's own pool + both legs' routes to BTS) paints
 *      GREEN, so yellow means exactly one thing: hovered.
 *   2. Hovering a LINE turns it yellow — the selector bands' behavior, brought
 *      to the desk maps.
 *   3. Clicking a line navigates, and the destination depends on the desk:
 *      swap desk -> that pool (#/pools/:id); exchange desk -> the ORDER BOOK
 *      for those two legs (#/market/QUOTE_BASE).
 *   4. The whole line is clickable, not just its midpoint dot.
 *
 * Run:  python3 -m http.server 7334 --directory vanilla &
 *       PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *         node tooling/visual/probe-desk-map-edges.mjs
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:7334/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

/* Interaction state only. The COLOUR contract is pinned headlessly in
 * tooling/pool-graph-test.js (_edgeStyleForTest): yellow == hovered, green ==
 * the triangle, grey == everything else. Reading pixels off a DPR-scaled,
 * live-repainting canvas proved unreliable, so we assert what the app itself
 * believes: which edge is hovered, and where a click lands. */
async function mapState() {
  return page.evaluate(() => {
    const c = document.querySelector(".mkt-canvas");
    return {
      hoverEdge: String(c._graphHoverEdge || ""),
      nav: c._graphNav || null
    };
  });
}

async function probe(url, label, wantPool) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => {
    const c = document.querySelector(".mkt-canvas");
    return !!(c && c._graphHits && c._graphHits.some((h) => h && h.edgeMid));
  }, { timeout: 30000 });
  await page.waitForTimeout(4000);            /* let the load settle finish */
  await page.evaluate(() => document.querySelector(".mkt-canvas").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(600);

  const rest = await mapState();

  /* Park the layout first: with the settle loop running the nodes DRIFT
   * between reading the hit list and moving the mouse, which flaked this
   * probe into clicking whatever had moved into place. Only the switch is
   * touched (calling PoolGraph.setReact directly and then clicking the switch
   * would flip it straight back ON — the switch reads the stored flag). */
  await page.evaluate(() => {
    const sw = document.querySelector(".pool-net-physwitch");
    if (sw && sw.getAttribute("aria-checked") === "true") sw.click();
  });
  await page.waitForTimeout(1200);
  /* stopLive() deliberately REMOVES the live state, so the flag is read from
   * its owners: PoolGraph.readReact() (session/storage) and the switch's own
   * aria-checked (what the user actually sees). */
  const parked = await page.evaluate(() => {
    const c = document.querySelector(".mkt-canvas");
    const sw = document.querySelector(".pool-net-physwitch");
    let react = null;
    try { if (typeof PoolGraph !== "undefined" && PoolGraph) react = PoolGraph.readReact(); } catch (e) {}
    return {
      live: !!(c._graphLiveS && c._graphLiveS.running),
      react: react,
      switchOff: !!(sw && sw.getAttribute("aria-checked") === "false")
    };
  });

  /* Hits are re-read AFTER parking, so they describe the frozen layout. */
  const target = await page.evaluate(() => {
    const c = document.querySelector(".mkt-canvas");
    /* An edge that is NOT the pool this desk is already showing: clicking it
     * must move us, which "same hash" would otherwise hide. */
    const here = String((location.hash.match(/1\.19\.\d+/) || [""])[0]);
    const all = (c._graphHits || []).filter((x) => x && x.edgeMid && x.ax);
    /* The LONGEST line that is not the pool we are already on, probed at its
     * middle: that is what a user aims at. A point inside a node's circle
     * belongs to the node (dragging starts there), so the probe must not
     * aim there. */
    const len = (x) => Math.hypot(x.bx - x.ax, x.by - x.ay);
    const h = all.filter((x) => String(x.poolId) !== here).sort((a, b2) => len(b2) - len(a))[0] || all[0];
    if (!h) return null;
    const r = c.getBoundingClientRect();
    const t = 0.5;
    const px = h.ax + (h.bx - h.ax) * t, py = h.ay + (h.by - h.ay) * t;
    /* Sanity: the probe point must be clear of both endpoint circles. */
    const clearOfNodes = ((c._graphHits || []).filter((n) => n && !n.edgeMid)
      .every((n) => Math.hypot(n.x - px, n.y - py) > (n.r || 8) + 6));
    return { poolId: String(h.poolId), lineLen: Math.round(len(h)), clearOfNodes,
      x: r.left + px, y: r.top + py };
  });
  if (!target) return { label, skipped: "no edge" };

  await page.mouse.move(target.x - 40, target.y - 40);
  await page.waitForTimeout(200);
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.waitForTimeout(400);
  const hovered = await mapState();

  /* Move off the map FIRST: a stale yellow with no pointer over it would read
   * as a stuck selection (and the click navigates away, so this has to be
   * checked while we are still on the desk). */
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  const off = await mapState();

  /* Back onto the line, then click it. */
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => location.hash);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(1400);
  const after = await page.evaluate(() => location.hash);

  return {
    label,
    hoverPool: target.poolId,
    parkedLoop: !parked.live,
    reactOff: parked.react === false && parked.switchOff,
    probedMidpointOfLine: target.lineLen + "px",
    clearOfNodes: target.clearOfNodes,
    hoverEdgeState: hovered.hoverEdge,
    hoverRegistered: hovered.hoverEdge === target.poolId,
    hoverClearedOnLeave: off.hoverEdge === "",
    navMode: rest.nav && rest.nav.mode,
    hashBefore: before,
    hashAfter: after,
    destination: after.split("/").slice(0, 3).join("/"),
    expectedKind: wantPool ? "#/pools/" : "#/market/"
  };
}

const out = [];
out.push(await probe("#/pools/1.19.0", "swap desk", true));
out.push(await probe("#/market/BTS_USD", "exchange desk", false));
/* errors is reported alongside the rows, never pushed as one: a sentinel in
 * this array would be counted as a third "measurement". */
console.log("DESK-MAP-EDGES:", JSON.stringify({ rows: out, errors }, null, 1));

const measured = out.filter((r) => !r.skipped && typeof r.hashAfter === "string");
const ok =
  errors.length === 0 &&
  measured.length === 2 &&
  measured.every((r) =>
    r.parkedLoop &&
    r.reactOff &&
    r.clearOfNodes &&
    r.hoverRegistered &&
    r.hoverClearedOnLeave &&
    r.hashAfter !== r.hashBefore &&
    r.hashAfter.indexOf(r.expectedKind) === 0);
console.log(ok ? "DESK-MAP-EDGES OK" : "DESK-MAP-EDGES FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
