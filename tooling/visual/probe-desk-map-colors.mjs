/* probe-desk-map-colors.mjs — read the ACTUAL painted pixels of the desk pool
 * map (dev-only). The green/black/yellow question is only answerable by
 * sampling the canvas, so this does exactly that: along each edge line, at
 * three points, and counts which theme colour each pixel really is.
 *
 * What it proves (owner 2026-10-07):
 *   - nothing is BLACK (a token name assigned to strokeStyle is silently
 *     invalid, and an invalid colour paints as the canvas default)
 *   - the pair's own pool + its route to BTS are bluish grey (with glow)
 *   - the hovered line is YELLOW, and only while hovered
 *   - every other line is the muted grey
 *
 * Run:  python3 -m http.server 7334 --directory vanilla &
 *       PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *         node tooling/visual/probe-desk-map-colors.mjs
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:7334/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

/* Classify by nearest theme token, and count anything far from every token as
 * "other" (which is where black lands — that is the point of the probe). */
async function sample() {
  return page.evaluate(() => {
    const c = document.querySelector(".mkt-canvas");
    const hits = c._graphHits || [];
    if (!hits.length) return null;
    const G = c.getContext("2d");
    const rect = c.getBoundingClientRect();
    const sx = (c.width / rect.width) || 1;
    const sy = (c.height / rect.height) || 1;
    const css = getComputedStyle(document.documentElement);
    /* Theme tokens are HEX in all three themes; an earlier version of this
     * probe only understood rgb() and so read every hex token as null — which
     * made real green/yellow lines report as "other". Parse both. */
    const rgbOf = (v) => {
      const c = String(v || "").trim();
      const hex = /^#([0-9a-f]{3,8})$/i.exec(c);
      if (hex) {
        let h = hex[1];
        if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
      const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    };
    const pal = {
      warn: rgbOf(css.getPropertyValue("--warn")),
      path: rgbOf(css.getPropertyValue("--accent")),   /* the path lines, at reduced alpha */
      border: rgbOf(css.getPropertyValue("--border"))
    };
    const near = (a, b) => a && b && Math.abs(a[0] - b[0]) < 26 && Math.abs(a[1] - b[1]) < 26 && Math.abs(a[2] - b[2]) < 26;
    const counts = { warn: 0, path: 0, border: 0, other: 0, transparent: 0 };
    const samples = [];
    /* A 1-2.5px antialiased line is thinner than the pixel grid's good
     * behaviour: a single-pixel read at the exact float coordinate lands
     * half a pixel off and returns background or a blend. So read a small
     * BLOCK and take the best token match inside it — a black line matches no
     * token at all, which is exactly what we want the probe to notice. */
    const R = 3;
    for (const h of hits) {
      if (!h || !h.edgeMid || !h.ax) continue;
      for (const t of [0.3, 0.5, 0.7]) {
        const cx = Math.round((h.ax + (h.bx - h.ax) * t) * sx);
        const cy = Math.round((h.ay + (h.by - h.ay) * t) * sy);
        let blk = null;
        try { blk = G.getImageData(Math.max(0, cx - R), Math.max(0, cy - R), R * 2 + 1, R * 2 + 1).data; } catch (e) { blk = null; }
        if (!blk) continue;
        const wpx = R * 2 + 1;
        let name = "other", best = 1e9, anyOpaque = false;
        for (let i = 0; i < blk.length; i += 4) {
          if (blk[i + 3] < 30) continue;
          anyOpaque = true;
          const v = [blk[i], blk[i + 1], blk[i + 2]];
          for (const key of ["warn", "path", "border"]) {
            const p = pal[key];
            if (!p) continue;
            const d = Math.abs(v[0] - p[0]) + Math.abs(v[1] - p[1]) + Math.abs(v[2] - p[2]);
            if (d < best) { best = d; name = key; }
          }
        }
        if (!anyOpaque) { counts.transparent++; continue; }
        /* A "match" must be close: a far-away best guess is not a match. */
        if (best > 78) name = "other";
        counts[name]++;
        samples.push({ poolId: String(h.poolId), t, name, dist: Math.round(best) });
      }
    }
    const tally = { warn: 0, path: 0, border: 0, other: 0 };
    for (const sm of samples) tally[sm.name]++;
    return { counts, tally, hoverEdge: String(c._graphHoverEdge || ""), palette: pal, samples: samples.slice(0, 6) };
  });
}

const out = {};
for (const [url, label] of [["#/pools/1.19.0", "swap desk"], ["#/market/BTS_USD", "exchange desk"]]) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => {
    const c = document.querySelector(".mkt-canvas");
    return !!(c && c._graphHits && c._graphHits.some((h) => h && h.edgeMid));
  }, { timeout: 30000 });
  /* Park the layout so the sampled coordinates stay valid. */
  await page.evaluate(() => {
    const sw = document.querySelector(".pool-net-physwitch");
    if (sw && sw.getAttribute("aria-checked") === "true") sw.click();
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector(".mkt-canvas").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);

  const atRest = await sample();

  /* Hover the longest line at its middle. */
  const target = await page.evaluate(() => {
    const c = document.querySelector(".mkt-canvas");
    const all = (c._graphHits || []).filter((x) => x && x.edgeMid && x.ax);
    const len = (x) => Math.hypot(x.bx - x.ax, x.by - x.ay);
    const h = all.sort((a, b) => len(b) - len(a))[0];
    if (!h) return null;
    const r = c.getBoundingClientRect();
    return { poolId: String(h.poolId), x: r.left + (h.ax + h.bx) / 2, y: r.top + (h.ay + h.by) / 2 };
  });
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.waitForTimeout(500);
  const hovered = await sample();
  await page.mouse.move(4, 4);
  await page.waitForTimeout(400);
  const afterLeave = await sample();

  out[label] = {
    atRest: atRest && atRest.tally,
    hovered: hovered && hovered.tally,
    hoverEdge: hovered && hovered.hoverEdge,
    afterLeave: afterLeave && afterLeave.tally,
    palette: atRest && atRest.palette,
    samplePixels: atRest && atRest.samples
  };
}
out.errors = errors;
console.log("DESK-MAP-COLORS:", JSON.stringify(out, null, 1));

const rows = Object.keys(out).filter((k) => k !== "errors");
const ok =
  errors.length === 0 &&
  rows.length === 2 &&
  rows.every((k) => {
    const r = out[k];
    /* "other" is not required to be ZERO: the glow halo and 1-2px
     * antialiasing legitimately blend a line with the panel, and those pixels
     * match no token. What matters is that the overwhelming share of sampled
     * line pixels resolve to a real theme colour — an all-black map (a token
     * NAME assigned to strokeStyle) resolves to NONE, so this still catches
     * that regression without breaking on a glow. */
    const share = (c) => (c.warn + c.path + c.border) / Math.max(1, c.warn + c.path + c.border + c.other);
    return share(r.atRest) >= 0.8 &&       /* lines are real theme colours, not black */
      r.atRest.warn === 0 &&                /* yellow only on hover */
      r.atRest.path > 0 &&                  /* the pair's own line + route are bluish */
      r.atRest.border > 0 &&                /* everything else grey */
      r.hovered.warn > 0 &&                 /* hover turns it yellow */
      r.hovered.hoverEdge !== "" &&
      r.afterLeave.warn === 0;              /* and it does not stick */
  });
console.log(ok ? "DESK-MAP-COLORS OK" : "DESK-MAP-COLORS FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
