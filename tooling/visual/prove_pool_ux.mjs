// prove_pool_ux.mjs — headless interaction proof for the pool-desk UX gaps
// (swap flip + chart invert + stake auto-fill). Reads live chain state;
// asserts DOM behavior only, never signs. Usage:
//   python3 -m http.server 8081 --directory vanilla   (one terminal)
//   PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node prove_pool_ux.mjs
//   (run from tooling/visual/). Exit 0 = all proofs hold.
// DEV-ONLY keeper (prove-claim-fees-43.cjs precedent): never shipped.
import { chromium } from "playwright-core";

const BASE = process.env.POOL_UX_BASE || "http://localhost:8081";
const POOL = process.env.POOL_UX_POOL || "1.19.133";
const out = { pass: [], fail: [] };
function check(name, cond, extra) {
  (cond ? out.pass : out.fail).push(name + (cond ? "" : " :: " + (extra || "no detail")));
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  await page.addInitScript(() => {
    try { localStorage.setItem("bts-vanilla-tour-dismissed-v1", "1"); } catch {}
  });

  /* FIX 1: swap flip swaps values + re-runs lookup. */
  await page.goto(BASE + "/#/swap", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#swap-flip", { timeout: 30000 });
  const flip = await page.evaluate(() => {
    const btn = document.getElementById("swap-flip");
    const rows = Array.from(document.querySelectorAll("input"));
    const sell = rows.find((i) => (i.value || "") === "BTS") || rows[0];
    const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent);
    // Scope to the two asset inputs: first two text inputs on the page.
    const [s, b] = rows;
    s.focus(); s.value = "BTS"; s.dispatchEvent(new Event("input", { bubbles: true }));
    b.focus(); b.value = "HONEST.USD"; b.dispatchEvent(new Event("input", { bubbles: true }));
    const before = [s.value, b.value];
    btn.click();
    return { before, after: [s.value, b.value],
      aria: btn.getAttribute("aria-label"),
      labels: labels.slice(0, 4).join("|") };
  });
  check("flip button carries a keyed aria-label", !!flip.aria, flip.aria);
  check("flip swaps sell/buy values",
    flip.before[0] === "BTS" && flip.before[1] === "HONEST.USD" &&
    flip.after[0] === "HONEST.USD" && flip.after[1] === "BTS",
    JSON.stringify(flip));
  // The flip re-runs Find-pools: a pool <select> or an inline error appears.
  await page.waitForTimeout(9000);
  const lookup = await page.evaluate(() => ({
    selects: document.querySelectorAll("select").length,
    body: document.body.textContent.slice(0, 4000),
  }));
  check("flip re-runs the pool lookup (select or honest no-pool note)",
    lookup.selects > 0 || /No pool exists for|Could not find pools/i.test(lookup.body),
    "selects=" + lookup.selects);
  await page.screenshot({ path: "/tmp/prove-swap-flip.png" });

  /* FIX 2 + FIX 3: pool detail invert + stake auto-fill. */
  await page.goto(BASE + "/#/pools/" + POOL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#pool-chart-invert", { timeout: 45000 });
  await page.waitForSelector("#pool-stake-ratio", { timeout: 15000 });
  const spotBefore = await page.evaluate(() => {
    const strip = document.querySelector(".mkt-statstrip");
    return strip ? strip.textContent : "NO-STRIP";
  });
  await page.evaluate(() => document.getElementById("pool-chart-invert").click());
  await page.waitForTimeout(4000);
  const spotAfter = await page.evaluate(() => {
    const strip = document.querySelector(".mkt-statstrip");
    const btn = document.getElementById("pool-chart-invert");
    return { text: strip ? strip.textContent : "NO-STRIP",
      pressed: btn ? btn.getAttribute("aria-pressed") : "NO-BTN" };
  });
  check("invert toggle exposes aria-pressed=true after click", spotAfter.pressed === "true", spotAfter.pressed);
  check("invert flips the spot orientation (B-per-A -> A-per-B)",
    /IOB|SUSDT|USD|CNY|BTS/.test(spotBefore) && spotAfter.text !== spotBefore &&
    /\//.test(spotAfter.text),
    JSON.stringify({ spotBefore, spotAfter }));
  await page.screenshot({ path: "/tmp/prove-pool-inverted.png" });

  /* FIX 3: typing Amount A auto-fills Amount B at pool ratio. */
  const stake = await page.evaluate(() => {
    const ratio = document.getElementById("pool-stake-ratio");
    const scope = ratio ? ratio.parentNode : document;
    const inputs = Array.from(scope.querySelectorAll("input"));
    const [a, b] = inputs;
    const ratioText = ratio ? ratio.textContent : "NO-RATIO";
    a.focus(); a.value = "1.0"; a.dispatchEvent(new Event("input", { bubbles: true }));
    const filled = b.value;
    const share = document.getElementById("pool-stake-shares");
    return { ratioText, filled, aEmpty: a.value, share: share ? share.textContent : "NO-SHARE" };
  });
  await page.waitForTimeout(4000); // async share-supply fetch resolves
  const shareAfter = await page.evaluate(() => {
    const s = document.getElementById("pool-stake-shares");
    return s ? s.textContent : "NO-SHARE";
  });
  check("stake ratio line renders at pool ratio", /Ratio \(spot\): 1 /.test(stake.ratioText), stake.ratioText);
  check("stake typing A auto-fills B (non-empty, differs from placeholder)",
    stake.filled !== "" && stake.filled !== "1.0", JSON.stringify(stake));
  check("stake share preview estimates (or honest offline note)",
    /Est\. LP shares|unavailable|Enter both|Check the amounts/.test(shareAfter), shareAfter);

  check("no page errors during proofs", errors.length === 0, errors.join(" // "));
} finally {
  await browser.close();
}
console.log(JSON.stringify({ pass: out.pass, fail: out.fail }, null, 1));
process.exit(out.fail.length ? 1 : 0);
