/* probe-ramp-hist.mjs — digit-sum histograms of live band edge data
 * (calibrates the grey->blue ramp scale; dev-only, never shipped).
 * Pool band: balance_a_raw + balance_b_raw digit lengths per edge.
 * Market band: volBaseRaw digit lengths per edge.
 * Run:  python3 -m http.server 8081 --directory vanilla &
 *   PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *     node tooling/visual/probe-ramp-hist.mjs [--url http://localhost:8081/#/pools]
 */
import { chromium } from "playwright-core";

const url = (process.argv[2] === "--url" && process.argv[3]) || "http://localhost:8081/#/pools";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "commit" });
await page.waitForTimeout(22000);
const hist = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const S = c && c._netState;
  if (!S) return { error: "no canvas state" };
  const meta = S.meta || {};
  const buckets = {};
  let n = 0, nob = 0;
  Object.keys(meta).forEach((id) => {
    const m = meta[id] || {};
    n++;
    let d = -1;
    if (typeof m.balance_a_raw === "string" && typeof m.balance_b_raw === "string" &&
        /^\d+$/.test(m.balance_a_raw) && /^\d+$/.test(m.balance_b_raw)) {
      d = m.balance_a_raw.replace(/^0+/, "").length + m.balance_b_raw.replace(/^0+/, "").length;
    } else if (typeof m.volBaseRaw === "string" && /^\d+$/.test(m.volBaseRaw)) {
      d = m.volBaseRaw.replace(/^0+/, "").length;
    } else { nob++; return; }
    const b = Math.floor(d / 2) * 2;
    buckets[b] = (buckets[b] || 0) + 1;
  });
  return { n, nodata: nob, buckets };
});
console.log(JSON.stringify(hist, null, 1));
await browser.close();
