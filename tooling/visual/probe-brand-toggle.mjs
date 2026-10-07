/* probe-brand-toggle.mjs — brand legend chips on the selector map (dev-only).
 *
 * Under test (owner 2026-10-07): a chip is a FILTER, not a dimmer.
 *   OFF -> that brand's nodes AND the edges touching them leave the plot, the
 *          hit list and the table twin.
 *   ON  -> they come back and the physics SPRINGS: the loop wakes and runs
 *          frames, and the returning nodes get positions of their own.
 *
 * Run:  python3 -m http.server 7334 --directory vanilla &
 *       PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *         node tooling/visual/probe-brand-toggle.mjs
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:7334/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

await page.goto(BASE + "#/pools", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction(() => {
  const c = document.querySelector(".pool-net-canvas");
  return !!(c && c._netState && c._netHits && c._netHits.length > 3);
}, { timeout: 30000 });
await page.waitForTimeout(2500);

const read = () => page.evaluate(() => {
  const c = document.querySelector(".pool-net-canvas");
  const S = c._netState;
  const chips = Array.from(document.querySelectorAll(".pool-net-chip")).map((el) => ({
    label: (el.textContent || "").trim(), pressed: el.getAttribute("aria-pressed"),
    dim: /pool-net-dim/.test(el.className || "")
  }));
  return {
    hidden: JSON.parse(JSON.stringify(S.hide || {})),
    viewNodes: (S.view && S.view.nodes || []).length,
    viewEdges: (S.view && S.view.edges || []).length,
    geomNodes: Object.keys(S.geom || {}).length,
    hitNodes: (c._netHits || []).length,
    mids: (c._netMids || []).length,
    chips,
    running: !!S.running,
    frames: S.frames || 0,
    temp: S.temp
  };
});

const out = {};
out.before = await read();

/* Pick the chip with the fewest nodes so the change is unmistakable, and that
 * leaves at least a handful of nodes behind. */
const pick = await page.evaluate(() => {
  const c = document.querySelector(".pool-net-canvas");
  const S = c._netState;
  const PN = typeof PoolNet !== "undefined" ? PoolNet : null;
  const groups = {};
  (S.view.nodes || []).forEach((n) => { const g = PN.brandOf(n.sym); groups[g] = (groups[g] || 0) + 1; });
  const list = Object.keys(groups).map((g) => ({ g, n: groups[g] })).sort((a, b) => a.n - b.n);
  if (!list.length) return null;
  const target = list[0];
  const el = Array.from(document.querySelectorAll(".pool-net-chip"))
    .find((x) => (x.textContent || "").trim() === target.g);
  if (!el) return null;
  el.click();
  return { group: target.g, nodesInGroup: target.n, totalNodes: (S.view.nodes || []).length };
});
out.picked = pick;
await page.waitForTimeout(300);
out.afterOff = await read();
await page.waitForTimeout(1500);
out.afterOffSettled = await read();

/* Turn it back on and watch the physics actually run. */
const backOn = await page.evaluate((g) => {
  const el = Array.from(document.querySelectorAll(".pool-net-chip")).find((x) => (x.textContent || "").trim() === g);
  if (!el) return false;
  el.click();
  return true;
}, pick && pick.group);
out.backOnClicked = backOn;
out.immediatelyAfterOn = await read();
await page.waitForTimeout(2000);
out.afterOnSettled = await read();

out.errors = errors;
console.log("BRAND-TOGGLE:", JSON.stringify(out, null, 1));

const off = out.afterOff;
const on = out.afterOnSettled;
const ok =
  errors.length === 0 &&
  !!pick && pick.nodesInGroup > 0 &&
  off.hidden && Object.keys(off.hidden).length === 1 &&
  off.viewNodes === out.before.viewNodes - pick.nodesInGroup &&
  off.viewEdges < out.before.viewEdges &&          /* edges touching it went too */
  off.geomNodes === off.viewNodes &&                 /* and left the simulation */
  off.hitNodes === off.viewNodes &&                  /* and the hit list */
  off.chips.some((c) => c.label === pick.group && c.pressed === "false" && c.dim) &&
  /* physics resprings on the way back */
  on.hidden && Object.keys(on.hidden).length === 0 &&
  on.viewNodes === out.before.viewNodes &&
  on.geomNodes === on.viewNodes &&
  (on.frames > out.afterOff.frames || on.running);
console.log(ok ? "BRAND-TOGGLE OK" : "BRAND-TOGGLE FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
