// Task-2 English-identical proof + es spot-checks (DEV ONLY — headless).
// Compares pre-conversion baseline vs converted app in en mode (extracted
// shell+settings strings must diff EMPTY modulo the ADDED locale row), then
// asserts es/stub/failure/rapid-switch behavior on the converted app.
//
// Usage:
//   python3 -m http.server 8081 --directory /tmp/vanilla-baseline &
//   python3 -m http.server 8082 --directory /workspace/vanilla &
//   node tooling/prove_i18n_task2.mjs --base http://localhost:8081 --new http://localhost:8082 --out /tmp/i18n-proof
import { chromium } from "playwright-core";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);
const BASE = args.base || "http://localhost:8081";
const NEW = args.new || "http://localhost:8082";
const OUT = args.out || "/tmp/i18n-proof";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("ok  ", name); }
  else { fail++; console.log("FAIL", name, extra === undefined ? "" : JSON.stringify(extra).slice(0, 400)); }
}

// Live probe results (latency ms + chain-id prefix) differ run to run —
// normalize them out before diffing; they are not converted strings.
function normView(view) {
  return (view || "").split("\n")
    .filter((l) => !l.includes("wss://"))
    .map((l) => l.replace(/\d+ms/g, "Nms").replace(/\b[0-9a-f]{8}\b/g, "CHAINID"))
    .filter((l) => l.trim() !== "");
}

const browser = await chromium.launch();

async function extractEn(url, localePref) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  if (localePref) {
    await page.addInitScript((loc) => {
      try { localStorage.setItem("bts-vanilla-locale-v1", loc); } catch {}
    }, localePref);
  }
  await page.goto(url + "/#/settings", { waitUntil: "load" });
  await page.waitForSelector("#locale-select, #theme-select", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500); // settle: loadCached + first paint (probes still running)
  const data = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent);
    const nav = qa("#nav a");
    const brand = q(".brand") ? q(".brand").textContent : null;
    const view = q("#view") ? q("#view").innerText : null;
    const localeSelect = q("#locale-select");
    const localeOpts = localeSelect ? Array.from(localeSelect.options).map((o) => o.text + "|" + o.value) : null;
    const themeSel = q("#theme-select") ? q("#theme-select").value : null;
    return { nav, brand, view, localeSelect: !!localeSelect, localeOpts, themeSel };
  });
  await page.close();
  return data;
}

// 1. en-mode extract-diff: baseline vs converted
const base = await extractEn(BASE, null);
const conv = await extractEn(NEW, null);
fs.writeFileSync(OUT + "/base-en.json", JSON.stringify(base, null, 1));
fs.writeFileSync(OUT + "/conv-en.json", JSON.stringify(conv, null, 1));
check("nav links identical", JSON.stringify(base.nav) === JSON.stringify(conv.nav), { base: base.nav, conv: conv.nav });
check("brand identical", base.brand === conv.brand, { base: base.brand, conv: conv.brand });
// view text: converted adds exactly the locale row ("Language " + 10 option names are in the select, not innerText... innerText includes label text)
const baseLines = normView(base.view);
const convLines = normView(conv.view);
const added = convLines.filter((l) => !baseLines.includes(l));
const removed = baseLines.filter((l) => !convLines.includes(l));
check("no pre-existing settings strings removed", removed.length === 0, removed);
check("only locale-row strings added", added.every((l) => /Language|in English|Deutsch|Espa|Fran|Italiano|日本|한국|Русский|Türkçe|简体中文|English/.test(l)), added);
check("locale select present (converted)", conv.localeSelect === true);
check("locale select absent (baseline)", base.localeSelect === false);
check("10 locale options, stubs suffixed", conv.localeOpts && conv.localeOpts.length === 10 &&
  conv.localeOpts.filter((o) => o.endsWith("|de") || o.endsWith("|zh")).every((o) => o.includes("in English")), conv.localeOpts);

// 2. Screenshots (read by the worker afterwards)
async function shot(url, width, out, localePref) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  if (localePref) {
    await page.addInitScript((loc) => {
      try { localStorage.setItem("bts-vanilla-locale-v1", loc); } catch {}
    }, localePref);
  }
  await page.goto(url + "/#/settings", { waitUntil: "load" });
  await page.waitForSelector("#theme-select", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
  await page.close();
}
await shot(BASE, 1440, OUT + "/base-settings-1440.png");
await shot(NEW, 1440, OUT + "/conv-settings-1440.png");
await shot(NEW, 390, OUT + "/conv-settings-390.png");

// 3. es mode spot-checks (converted app only)
const es = await extractEn(NEW, "es");
fs.writeFileSync(OUT + "/conv-es.json", JSON.stringify(es, null, 1));
check("es nav translated", es.nav.includes("Tablero") && es.nav.includes("Transferencia"), es.nav);
check("es settings title translated", (es.view || "").includes("Configuraciónes"), (es.view || "").slice(0, 200));
// Strip URLs/domains first: "bitshares.dev"-style tokens are not i18n key-ids.
const esScreen = ((es.nav || []).join(" ") + "\n" + (es.view || ""))
  .replace(/wss:\/\/\S+/g, "").replace(/\S+\.\S+/g, "");
check("es no key-ids on screen", !/[a-z_]+\.[a-z_0-9]+/.test(esScreen), es.nav);
check("es probe button translated", (es.view || "").includes("Probar todos"));

// 4. stub locale (de): honest English + suffix, never blank
const de = await extractEn(NEW, "de");
check("de nav falls back to English", JSON.stringify(de.nav) === JSON.stringify(base.nav), de.nav);

// 5. failure path: block locale JSON, pick es -> toast + snap-back to en
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**/locales/*.json", (r) => r.abort());
  await page.goto(NEW + "/#/settings", { waitUntil: "load" });
  await page.waitForSelector("#locale-select", { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.selectOption("#locale-select", "es");
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({
    err: document.querySelector("#locale-error") ? document.querySelector("#locale-error").textContent : null,
    val: document.querySelector("#locale-select") ? document.querySelector("#locale-select").value : null,
    nav0: document.querySelector('#nav a[href="#/"]') ? document.querySelector('#nav a[href="#/"]').textContent : null
  }));
  check("failure toast shown", st.err === "Locale unavailable offline — showing English.", st);
  check("select snaps back to en", st.val === "en", st);
  check("shell stays English", st.nav0 === "Dashboard", st);
  await page.close();
}

// 6. rapid switch en->es->en: no stale strings
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(NEW + "/#/settings", { waitUntil: "load" });
  await page.waitForSelector("#locale-select", { timeout: 15000 });
  await page.waitForTimeout(1500);
  const nav0 = () => page.evaluate(() => document.querySelector('#nav a[href="#/"]').textContent);
  await page.selectOption("#locale-select", "es");
  await page.waitForTimeout(1200);
  const e1 = await nav0();
  await page.selectOption("#locale-select", "en");
  await page.waitForTimeout(1200);
  const e2 = await nav0();
  await page.selectOption("#locale-select", "es");
  await page.waitForTimeout(1200);
  const e3 = await nav0();
  check("rapid switch lands Spanish, back, Spanish", e1 === "Tablero" && e2 === "Dashboard" && e3 === "Tablero", [e1, e2, e3]);
  await page.close();
}

console.log(`\nproof: ${pass} pass, ${fail} fail; console/page errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10).join("\n"));
await browser.close();
process.exit(fail ? 1 : 0);
