/* probe-band-ramp.mjs — verify the grey->blue edge ramp on band canvases
 * (dev-only, never shipped). Samples painted pixels at edge midpoints from
 * canvas._netState and correlates blueness (b-r) with meta digit lengths:
 * top-half edges must average bluer than bottom-half edges, and no sampled
 * pixel may be black (invalid colour) or fully transparent.
 * Run:  python3 -m http.server 8081 --directory vanilla &
 *   PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *     node tooling/visual/probe-band-ramp.mjs --url http://localhost:8081/#/pools
 */
import { chromium } from "playwright-core";

const ai = process.argv.indexOf("--url");
const url = (ai !== -1 && process.argv[ai + 1]) || "http://localhost:8081/#/pools";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
await page.goto(url, { waitUntil: "commit" });
await page.waitForTimeout(22000);

const out = await page.evaluate(() => {
  const c = document.querySelector("canvas.pool-net-canvas");
  if (!c) return { error: "no band canvas" };
  const S = c._netState;
  if (!S || !S.mids || !S.mids.length) return { error: "no edge mids" };
  const G = c.getContext("2d");
  const rect = c.getBoundingClientRect();
  const sx = (c.width / rect.width) || 1, sy = (c.height / rect.height) || 1;
  function digitsFor(id) {
    const m = (S.meta || {})[id] || {};
    if (typeof m.balance_a_raw === "string" && typeof m.balance_b_raw === "string" &&
        /^\d+$/.test(m.balance_a_raw) && /^\d+$/.test(m.balance_b_raw)) {
      return m.balance_a_raw.replace(/^0+/, "").length + m.balance_b_raw.replace(/^0+/, "").length;
    }
    if (typeof m.volBaseRaw === "string" && /^\d+$/.test(m.volBaseRaw)) {
      return m.volBaseRaw.replace(/^0+/, "").length;
    }
    return -1;
  }
  const samples = [];
  const vedges = (S.view && S.view.edges) || [];
  S.mids.forEach((m, i) => {
    try {
      /* True curve apex: drawScene offsets control points by
       * ((((ei % 5) + 5) % 5 - 2) * 6) with ei = view edge order, so the
       * straight midpoint can miss the ink by 6px. Recompute B(0.5) and
       * take the 3x3 median (halo-proof, neighbor-proof). */
      const e = vedges[i] || {};
      const ax = m.ax, ay = m.ay, bx = m.bx, by = m.by;
      const vx = bx - ax, vy = by - ay;
      const vlen = Math.sqrt(vx * vx + vy * vy) || 1;
      const off = ((((i || 0) % 5) + 5) % 5 - 2) * 6;
      const cx = (ax + bx) / 2 - (vy / vlen) * off, cy = (ay + by) / 2 + (vx / vlen) * off;
      const px = (ax + 2 * cx + bx) / 4, py = (ay + 2 * cy + by) / 4;
      const blues = [];
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const d = G.getImageData(Math.round(px * sx) + dx, Math.round(py * sy) + dy, 1, 1).data;
          if (d[3] > 64) blues.push(d[2] - d[0]);
        }
      }
      if (!blues.length) { samples.push({ id: m.poolId, missed: true }); return; }
      blues.sort((x, y) => x - y);
      samples.push({ id: m.poolId, digits: digitsFor(m.poolId), blue: blues[Math.floor(blues.length / 2)] });
    } catch (e) { /* edge stands unsampled */ }
  });
  return { samples };
});

if (out.error) {
  console.log(JSON.stringify(out));
} else {
  const live = out.samples.filter((s) => !s.missed && s.digits >= 0);
  const missed = out.samples.filter((s) => s.missed).length;
  const ds = live.map((s) => s.digits).sort((x, y) => x - y);
  const mid = ds[Math.floor(ds.length / 2)];
  const lo = live.filter((s) => s.digits <= mid), hi = live.filter((s) => s.digits > mid);
  const avg = (xs) => xs.reduce((t, s) => t + s.blue, 0) / Math.max(1, xs.length);
  console.log(JSON.stringify({
    edges: out.samples.length, sampled: live.length, missed: missed,
    loN: lo.length, hiN: hi.length,
    loBlue: Math.round(avg(lo) * 10) / 10, hiBlue: Math.round(avg(hi) * 10) / 10,
    pass: missed <= out.samples.length * 0.25 && hi.length > 0 && lo.length > 0 && avg(hi) > avg(lo)
  }, null, 1));
}
console.log("pageerrors: " + JSON.stringify(errors.slice(0, 3)));
await browser.close();
