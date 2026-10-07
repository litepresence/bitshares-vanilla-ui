#!/usr/bin/env node
/* viewport-audit.mjs — two-ended viewport sweep for the vanilla wallet
 * (DEV ONLY — never shipped, never required; the human browser pass stays
 * the gate, per AGENTS.md §4.5 rule 4).
 *
 * Owns: the audit route table, the pure verdict logic, the in-page DOM probe,
 * and the sweep runner. One purpose: decide whether each route survives at
 * each of two viewports, and say why not.
 * Consumes: playwright-core (dev-only, tooling/visual/package.json:3).
 * Side effects: writes screenshots + a JSON report; never touches vanilla/.
 * Exports: pure logic (tested in viewport-audit-test.mjs) plus sweep().
 *
 * Spec:     docs/superpowers/specs/2026-10-07-viewport-audit-design.md
 * Plan:     docs/superpowers/plans/2026-10-07-viewport-audit.md
 * Note:     docs/parity/viewport-audit-2.md
 *
 * Usage (server must be running):
 *   python3 -m http.server 8081 --directory vanilla &
 *   node tooling/visual/viewport-audit.mjs --port 8081
 *   node tooling/visual/viewport-audit.mjs --port 8081 --viewport phone
 *   node tooling/visual/viewport-audit.mjs --port 8081 --routes "#/transfer"
 *
 * Stdlib + playwright-core only. No new dependency.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/* Viewports (spec §4). "phone" is the 360-390px band §3.6 mandates;
 * "desk" is 2560px, the dense-view width check 7 requires. */
export const VIEWPORTS = [
  { id: "phone", width: 390, height: 844 },
  { id: "desk", width: 2560, height: 1080 },
];

/* Testnet node, pinned. Reads only; no keys, no broadcasts. */
const TESTNET_NODE = "wss://testnet.xbts.io/ws";

/* Live object ids, all recorded in existing parity notes -- never invented:
 * lite-test-1/1.2.26833 (testnet-proof-round2.md), pool 1.19.66 (slice-12),
 * htlc 1.16.621 (slice-11), credit offer 1.21.43 + deal 1.22.70 (slice-13),
 * proposal 1.10.1488 (slice-14), block 100916767 (slice-09). */
export const ROUTES = [
  { src: "/", hash: "#/", group: "static" },
  { src: "/account/:account_name", hash: "#/account/lite-test-1", group: "live-id" },
  { src: "/accounts", hash: "#/accounts", group: "static" },
  { src: "/market/:marketID", hash: "#/market/USD_TEST", group: "live-id" },
  { src: "/market/:marketID", hash: "#/market/BTS_HONEST.BTC", group: "live-id" },
  { src: "/credit-offer/:id", hash: "#/credit-offer/1.21.43", group: "live-id" },
  { src: "/deal/:id", hash: "#/deal/1.22.70", group: "live-id" },
  { src: "/credit-offer", hash: "#/credit-offer", group: "static" },
  { src: "/samet", hash: "#/samet", group: "static" },
  { src: "/settings/:tab", hash: "#/settings/nodes", group: "expanded",
    note: "renderSettings ignores the tab param (vanilla/js/settings.js) -- finding, recorded" },
  { src: "/settings", hash: "#/settings", group: "static" },
  { src: "/invoice/:data", hash: "#/invoice/:data", group: "skip",
    note: "invoice payload is per-recipient base64; no recorded fixture and fabricating one proves nothing" },
  { src: "/invoice", hash: "#/invoice", group: "static" },
  { src: "/proposals/:id", hash: "#/proposals/1.10.1488", group: "live-id" },
  { src: "/proposals", hash: "#/proposals", group: "static" },
  { src: "/tickets", hash: "#/tickets", group: "static" },
  { src: "/vesting", hash: "#/vesting", group: "static" },
  { src: "/authorities", hash: "#/authorities", group: "static" },
  { src: "/lists", hash: "#/lists", group: "static" },
  { src: "/airdrop", hash: "#/airdrop", group: "static" },
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/XBTSX", group: "expanded" },
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/IOB", group: "expanded" },
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/GDEX", group: "expanded" },
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/BTWTY", group: "expanded" },
  { src: "/deposit-withdraw", hash: "#/deposit-withdraw", group: "static" },
  { src: "/create-account", hash: "#/create-account", group: "static" },
  { src: "/login", hash: "#/login", group: "static" },
  { src: "/registration", hash: "#/registration", group: "static" },
  { src: "/registration/local", hash: "#/registration/local", group: "static" },
  { src: "/registration/cloud", hash: "#/registration/cloud", group: "static" },
  { src: "/news", hash: "#/news", group: "static" },
  { src: "/voting", hash: "#/voting", group: "static" },
  { src: "/explorer", hash: "#/explorer", group: "static" },
  { src: "/explorer/:tab", hash: "#/explorer/blocks", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/assets", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/pools", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/accounts", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/witnesses", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/committee", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/markets", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/fees", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/feeds", group: "expanded" },
  { src: "/asset/:symbol", hash: "#/asset/HONEST.BTC", group: "live-id" },
  { src: "/asset/:symbol", hash: "#/asset/BTS", group: "live-id" },
  { src: "/block/:height", hash: "#/block/100916767", group: "live-id" },
  { src: "/block/:height/:txIndex", hash: "#/block/100916767/0", group: "live-id" },
  { src: "/borrow", hash: "#/borrow", group: "static" },
  { src: "/barter", hash: "#/barter", group: "static" },
  { src: "/direct-debit", hash: "#/direct-debit", group: "static" },
  { src: "/spotlight", hash: "#/spotlight", group: "static" },
  { src: "/transfer/:to", hash: "#/transfer/lite-test-1", group: "live-id" },
  { src: "/transfer", hash: "#/transfer", group: "static" },
  { src: "/wallet/password", hash: "#/wallet/password", group: "static" },
  { src: "/wallet", hash: "#/wallet", group: "static" },
  { src: "/create-wallet-brainkey", hash: "#/create-wallet-brainkey", group: "static" },
  { src: "/existing-account", hash: "#/existing-account", group: "static" },
  { src: "/create-worker", hash: "#/create-worker", group: "static" },
  { src: "/about", hash: "#/about", group: "static" },
  { src: "/community", hash: "#/community", group: "static" },
  { src: "/help/**", hash: "#/help", group: "static" },
  { src: "/help/**", hash: "#/help/disclaimer", group: "expanded" },
  { src: "/help/**", hash: "#/help/wallets", group: "expanded" },
  { src: "/help/**", hash: "#/help/dex-trading", group: "expanded" },
  { src: "/help/**", hash: "#/help/assets-mpa", group: "expanded" },
  { src: "/help/**", hash: "#/help/pools", group: "expanded" },
  { src: "/help/**", hash: "#/help/proposals", group: "expanded" },
  { src: "/help/**", hash: "#/help/charts", group: "expanded" },
  { src: "/help/**", hash: "#/help/glossary", group: "expanded" },
  { src: "/htlc/:id", hash: "#/htlc/1.16.621", group: "live-id" },
  { src: "/htlc", hash: "#/htlc", group: "static" },
  { src: "/prediction", hash: "#/prediction", group: "static" },
  { src: "/prediction/:market", hash: "#/prediction/:market", group: "skip",
    note: "no prediction market id recorded on testnet; the list route covers the renderer" },
  { src: "/instant-trade", hash: "#/instant-trade", group: "static" },
  { src: "/instant-trade/:marketID", hash: "#/instant-trade/USD_TEST", group: "live-id" },
  { src: "/pools/:id", hash: "#/pools/1.19.66", group: "live-id" },
  { src: "/pools", hash: "#/pools", group: "static" },
  { src: "/markets", hash: "#/markets", group: "static" },
  { src: "/alerts", hash: "#/alerts", group: "static" },
  { src: "/trollbox", hash: "#/trollbox", group: "static" },
  { src: "/assets", hash: "#/assets", group: "static" },
  { src: "/assets/create", hash: "#/assets/create", group: "static" },
  { src: "/assets/update/:symbol", hash: "#/assets/update/HONEST.BTC", group: "live-id" },
  { src: "/assets/issue", hash: "#/assets/issue", group: "static" },
  { src: "/assets/feed", hash: "#/assets/feed", group: "static" },
  { src: "/fees", hash: "#/fees", group: "static" },
  { src: "/referrals", hash: "#/referrals", group: "static" },
  { src: "/favourites", hash: "#/favourites", group: "static" },
  { src: "/top-ops", hash: "#/top-ops", group: "static" },
  { src: "/ops", hash: "#/ops", group: "static" },
  { src: "/txbuilder", hash: "#/txbuilder", group: "static" },
  { src: "/api-lab", hash: "#/api-lab", group: "static" },
  { src: "/es-lab", hash: "#/es-lab", group: "static" },
  { src: "/menu", hash: "#/menu", group: "static" },
  { src: "/menu/:section", hash: "#/menu/wallet", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/trade", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/earn", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/govern", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/explore", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/labs", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/personal", group: "expanded" },
  { src: "*", hash: "#/this-route-does-not-exist", group: "static" },
];

/* routerPaths: the `path:` entries parsed straight out of the router, so the
 * route table above can never claim coverage the router does not have.
 * Params: none. Returns: string[] in file order.
 * Failure: returns [] when the routes array cannot be found (the test then
 * fails loudly rather than passing on an empty table). */
export function routerPaths() {
  var src = readFileSync(join(ROOT, "vanilla", "js", "router.js"), "utf8");
  var m = src.match(/var routes = \[([\s\S]*?)\n  \];/);
  if (!m) return [];
  return m[1].split("\n").map(function (l) {
    var hit = l.match(/\{ path: "([^"]+)"/);
    return hit ? hit[1] : null;
  }).filter(Boolean);
}

/* expandRoutes: the routes to actually sweep. Params: none.
 * Returns: Array<{hash, group}> -- every ROUTES entry except the skips.
 * Pure, never throws. */
export function expandRoutes() {
  return ROUTES.filter(function (r) { return r.group !== "skip"; })
    .map(function (r) { return { hash: r.hash, group: r.group }; });
}

/* classify: turn measured metrics into a verdict (spec §5). PURE -- no DOM,
 * no browser, no globals -- so it is unit-testable and cannot drift from the
 * rule it encodes.
 * Params: m Metrics (see header); width viewport width in px.
 *   Metrics = { overflowPx, scrollRegion, widestSelector,
 *               smallTargets:[{selector,w,h}], contentRatio, contentSelector,
 *               clippedText:[], viewportMeta, consoleErrors:[] }
 * Returns: { verdict, fails:[{id,detail,selector}], notes:[string] }.
 *   verdict is "FAIL" if any assertion failed, else "PASS w/ note" if a
 *   scroll region absorbed overflow, else "PASS".
 * Failure: never throws; a malformed metric object yields FAIL, not a crash. */
export function classify(m, width) {
  var fails = [], notes = [];
  m = m || {};

  /* A1 -- sideways page scroll. A declared scroll region on an ancestor is
   * the sanctioned dense-grid answer (§3.6), so it downgrades to a note. */
  var overflowPx = Number(m.overflowPx) || 0;
  if (overflowPx > 1) {
    if (m.scrollRegion) {
      notes.push("h-overflow " + overflowPx + "px absorbed by scroll region " + m.scrollRegion);
    } else {
      fails.push({ id: "A1-h-overflow", detail: overflowPx + "px", selector: m.widestSelector || "" });
    }
  }

  /* A2 -- touch floor: >=44px in AT LEAST ONE dimension (§3.6). The rule is
   * applied HERE, not trusted from the probe, so a probe bug cannot mint a
   * false failure and classify stays the single source of the threshold. */
  var targets = Array.isArray(m.smallTargets) ? m.smallTargets : [];
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i] || {};
    var tw = Number(t.w) || 0, th = Number(t.h) || 0;
    if (th >= 44 || tw >= 44) continue;
    fails.push({
      id: "A2-touch-floor",
      detail: Math.round(tw) + "x" + Math.round(th) + (t.hint ? " " + JSON.stringify(t.hint) : ""),
      selector: t.selector || "",
    });
  }

  /* A3 -- stranded column. Desktop assertion only: a narrow column is the
   * correct phone layout, so this must never fire at phone width. */
  var ratio = Number(m.contentRatio);
  if (width >= 2000 && isFinite(ratio) && ratio < 0.55) {
    fails.push({
      id: "A3-stranded-column",
      detail: Math.round(ratio * 100) + "% of viewport",
      selector: m.contentSelector || "",
    });
  }

  /* A4 -- console errors are failures of the #4 floor as much as #7. */
  var errs = Array.isArray(m.consoleErrors) ? m.consoleErrors : [];
  for (var j = 0; j < errs.length; j++) {
    fails.push({ id: "A4-console", detail: String(errs[j]).slice(0, 200), selector: "" });
  }

  return {
    verdict: fails.length ? "FAIL" : (notes.length ? "PASS w/ note" : "PASS"),
    fails: fails,
    notes: notes,
  };
}

/* shouldShot: which route/viewport pairs get a PNG (spec §5). Every failure
 * is shot; plain passes are sampled 1-in-5 by a hash-length rule, which is
 * deterministic and reproducible -- never cherry-picked.
 * Params: hash route hash; verdict from classify.
 * Returns: boolean. Pure, never throws. */
export function shouldShot(hash, verdict) {
  if (verdict !== "PASS") return true;
  return String(hash).length % 5 === 0;
}

/* ensureBrowsers: point Playwright at the vendored browser dir when the env
 * var is unset. shot.mjs's header documents the same location; without this a
 * fresh clone fails with "Executable doesn't exist" even though the browsers
 * are on disk.
 * Params: none. Returns: the effective PLAYWRIGHT_BROWSERS_PATH (or "").
 * Failure: never throws -- with no local .browsers dir, the caller's own env
 * or Playwright default resolution stands. */
export function ensureBrowsers() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    var local = join(HERE, ".browsers");
    if (existsSync(local)) process.env.PLAYWRIGHT_BROWSERS_PATH = local;
  }
  return process.env.PLAYWRIGHT_BROWSERS_PATH || "";
}

/* measureInPage: the DOM probe. Serialised by Playwright into the page, so it
 * must be SELF-CONTAINED -- no imports, no closure over module scope, only
 * browser globals. Returns a Metrics object (see classify).
 * Params: none. Returns: Metrics.
 * Failure: never throws. A missing #view yields contentRatio 0 rather than an
 * exception, and every list field is always an array. */
export function measureInPage() {
  var doc = document;
  var de = doc.documentElement;
  var out = {
    overflowPx: 0, scrollRegion: "", widestSelector: "",
    smallTargets: [], contentRatio: 0, contentSelector: "",
    clippedText: [], inlineLinks: [], viewportMeta: "", consoleErrors: [],
  };

  /* A short, readable selector -- enough to grep app.css by, not a full path.
   * Inputs carry their identifying attributes, because a punchlist row reading
   * "input 18x18" is not actionable and eight identical rows are useless. */
  function sel(el) {
    if (!el) return "";
    var s = el.tagName.toLowerCase();
    if (el.id) return s + "#" + el.id;
    var cls = ((el.getAttribute && el.getAttribute("class")) || "").trim().split(/\s+/).filter(Boolean);
    if (cls.length) s += "." + cls.slice(0, 2).join(".");
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      var bits = [];
      if (el.type) bits.push("[type=" + el.type + "]");
      if (el.name) bits.push("[name=" + el.name + "]");
      if (el.placeholder) bits.push("[placeholder=" + String(el.placeholder).slice(0, 24) + "]");
      if (bits.length) s += bits.join("");
      else if (!cls.length) s += "(no id/class/attrs)";
    }
    return s;
  }
  function shown(el) {
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    var r = el.getBoundingClientRect();
    return !(r.width === 0 && r.height === 0);
  }
  function scrolls(el) {
    var cs = getComputedStyle(el);
    return cs.overflowX === "auto" || cs.overflowX === "scroll";
  }

  try {
    var vm = doc.querySelector('meta[name="viewport"]');
    out.viewportMeta = vm ? String(vm.getAttribute("content") || "") : "";
  } catch (e) { /* no meta is a finding, not a crash */ }

  /* The EFFECTIVE touch target. A radio/checkbox wrapped in a <label> is
   * tapped via the label, so a 18x18 input inside a 44px label is NOT a
   * defect -- measuring the bare input would flood the report with false
   * positives (viewport-gaps.md:36 documents exactly this pattern). */
  function targetBox(el) {
    var b = el.getBoundingClientRect();
    var lab = el.closest ? el.closest("label") : null;
    if (lab) {
      var lb = lab.getBoundingClientRect();
      if (lb.width > b.width || lb.height > b.height) return { w: Math.max(b.width, lb.width), h: Math.max(b.height, lb.height) };
    }
    return { w: b.width, h: b.height };
  }

  try {
    out.overflowPx = Math.max(0, Math.round(de.scrollWidth - de.clientWidth));

    /* Widest offender + the scroll region absorbing it, if any. */
    var widest = null, widestRight = -1;
    var all = doc.querySelectorAll("body *");
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width > 0 && r.right > widestRight) { widestRight = r.right; widest = all[i]; }
    }
    if (widest) {
      out.widestSelector = sel(widest);
      for (var p = widest; p && p !== de; p = p.parentElement) {
        if (scrolls(p)) { out.scrollRegion = sel(p); break; }
      }
    }

    /* Touch floor. The probe only collects candidates (capped at 8 for a
     * readable report); classify applies the >=44px rule itself.
     *
     * INLINE ANCHORS ARE NOT CONTROLS. Every real control in this app is
     * styled inline-flex / inline-block / block (a.btn:112, .subtle-btn,
     * #appfoot .appfoot-actions a:1054) -- all >=44px by construction. An
     * anchor left `display:inline` is part of a text run (help TOC <li>,
     * the footer's "Master" inside .appfoot-left), and inflating it to 44px
     * would break the line it sits in. Those go to `inlineLinks` --
     * recorded, never failing -- so the report stays honest without
     * drowning real findings in prose. Observed: without this rule 100% of
     * routes FAILed on the same footer link. */
    var SEL = "button, a[href], select, input:not([type=hidden]), textarea, [role=button]";
    var ctrls = doc.querySelectorAll(SEL);
    for (var c = 0; c < ctrls.length; c++) {
      var el = ctrls[c];
      if (out.smallTargets.length >= 8) break;
      if (!shown(el)) continue;
      var b2 = targetBox(el);
      if (!(b2.h < 44 && b2.w < 44)) continue;
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") {
        if (out.inlineLinks.length < 10) {
          out.inlineLinks.push({
            selector: sel(el),
            text: (el.textContent || "").trim().slice(0, 30),
            w: Math.round(b2.w), h: Math.round(b2.h),
          });
        }
        continue;
      }
      out.smallTargets.push({
        selector: sel(el),
        w: Math.round(b2.w), h: Math.round(b2.h),
        /* A short text/attr hint so the punchlist row is actionable -- a row
         * reading "a 38x13" tells the fixer nothing. */
        hint: (el.tagName === "A"
          ? (el.textContent || "").trim().slice(0, 40) || (el.getAttribute("href") || "")
          : (el.placeholder || el.getAttribute("aria-label") || "").trim().slice(0, 40)),
      });
    }

    /* Widest descendant of #view that FITS the viewport = the real content
     * width. Clipped over-wide elements are excluded on purpose: a hidden
     * overflow is an A1 finding, and counting it here would report a
     * meaningless ratio >1 instead of the stranded-column number A3 wants.
     * "Fits" is tested as width <= viewport width rather than by right-edge
     * containment, so the body's default margin cannot disqualify a
     * full-bleed panel. A full-bleed panel nested in a narrow wrapper still
     * wins. */
    var view = doc.getElementById("view");
    if (view) {
      var best = 0, bestSel = "";
      var kids = view.querySelectorAll("*");
      for (var k = 0; k < kids.length; k++) {
        var kb = kids[k].getBoundingClientRect();
        if (kb.width <= 0 || kb.width > de.clientWidth) continue;
        if (kb.width > best) { best = kb.width; bestSel = sel(kids[k]); }
      }
      out.contentSelector = bestSel;
      out.contentRatio = de.clientWidth ? Math.round((best / de.clientWidth) * 1000) / 1000 : 0;
    }

    /* Clipped text -- recorded, never a failure (leading indicator only). */
    var TX = "#view p, #view span, #view td, #view th, #view label, #view h1, #view h2, #view h3, #view button";
    var texts = doc.querySelectorAll(TX);
    for (var t = 0; t < texts.length && out.clippedText.length < 10; t++) {
      var te = texts[t];
      if (!shown(te)) continue;
      if (te.scrollWidth > te.clientWidth + 1 && !scrolls(te.parentElement || te)) {
        out.clippedText.push(sel(te));
      }
    }
  } catch (e) {
    out.probeError = String((e && e.message) || e).slice(0, 200);
  }
  return out;
}

/* slugFor: a filesystem-safe stem for a route hash.
 * Params: hash route hash. Returns: string. Pure, never throws. */
export function slugFor(hash) {
  return String(hash).replace(/^#\/?/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

/* settle: wait for the route to actually render rather than sleeping blind.
 * #view is the router's render target (index.html:65).
 * Failure: falls back to the fixed wait, so a never-rendering route is still
 * measured -- and its emptiness shows up as a finding, not a silent pass. */
async function settle(page, waitMs) {
  try {
    await page.waitForFunction(function () {
      var v = document.getElementById("view");
      return !!v && v.children.length > 0;
    }, { timeout: Math.min(waitMs, 20000) });
  } catch (e) { /* falls through to the fixed wait */ }
  await page.waitForTimeout(waitMs);
}

/* launchBrowser: a fresh browser with the vendored browsers path applied.
 * Params: none. Returns: Promise<Browser>.
 * Failure: throws -- the caller decides whether to retry or record. */
async function launchBrowser() {
  ensureBrowsers();
  var pw = await import("./node_modules/playwright-core/index.js");
  var chromium = pw.chromium || (pw.default && pw.default.chromium);
  return chromium.launch();
}

/* makeContext: one context per route, carrying the testnet bootstrap.
 * A fresh context per route is what keeps a long sweep alive: pages leak
 * inside a long-lived context and the browser eventually dies mid-run
 * (observed: crash at route 21 of the first full sweep).
 * Params: browser; vp viewport {id,width,height}. Returns: Promise<Context>. */
async function makeContext(browser, vp) {
  var context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  /* Same bootstrap shot.mjs uses (shot.mjs:47-66): pin testnet, dismiss the
   * tour so it never covers the page under test. */
  await context.addInitScript(function ({ node, flag }) {
    try {
      var raw = localStorage.getItem("bts-vanilla-settings-v1");
      var s = raw ? JSON.parse(raw) : {};
      s.network = "testnet";
      s.activeNode = node;
      localStorage.setItem("bts-vanilla-settings-v1", JSON.stringify(s));
      localStorage.setItem("bts-vanilla-tour-dismissed-v1", flag);
    } catch (e) { /* app defaults stand */ }
  }, { node: TESTNET_NODE, flag: "1" });
  return context;
}

/* sweep: measure every route at every viewport against live testnet.
 * Params: opts { port, viewportId?, routeFilter?, waitMs?, shotsDir?, reportPath? }.
 *   Defaults: port 8081, waitMs 6000, shotsDir docs/parity/viewport-shots,
 *   reportPath docs/parity/viewport-audit-2.json.
 * Returns: Promise<Report>. Report = { ranAt, network, node, viewports,
 *   routesSwept, results, skips }. Skipped routes come back in Report.skips
 *   with their recorded reason -- never counted as passes.
 * Failure: a route that cannot be measured records overflowPx -1 plus an
 *   A4-console entry naming the crash, and is retried once on a relaunched
 *   browser. The run itself never aborts. */
export async function sweep(opts) {
  opts = opts || {};
  var port = opts.port || 8081;
  var waitMs = opts.waitMs || 6000;
  var shotsDir = opts.shotsDir || join(ROOT, "docs", "parity", "viewport-shots");
  var reportPath = opts.reportPath || join(ROOT, "docs", "parity", "viewport-audit-2.json");
  var viewports = VIEWPORTS.filter(function (v) { return !opts.viewportId || v.id === opts.viewportId; });
  var routes = expandRoutes().filter(function (r) {
    return !opts.routeFilter || r.hash.indexOf(opts.routeFilter) !== -1;
  });

  mkdirSync(shotsDir, { recursive: true });

  /* Skips are reported whether or not the route filter narrows the sweep. */
  var skips = ROUTES.filter(function (r) { return r.group === "skip"; })
    .map(function (r) { return { hash: r.hash, reason: r.note || "no reason recorded" }; });

  var browser = await launchBrowser();
  var results = [];

  for (var vi = 0; vi < viewports.length; vi++) {
    var vp = viewports[vi];

    for (var ri = 0; ri < routes.length; ri++) {
      var r = routes[ri];
      var attempt = 0, metrics = null, errors = [], shot = null, verdict = null;

      /* One retry: a dead browser is relaunched and the route re-measured. */
      while (attempt < 2) {
        attempt++;
        var context = null, page = null;
        errors = [];
        try {
          context = await makeContext(browser, vp);
          page = await context.newPage();
          page.on("console", function (m) { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
          page.on("pageerror", function (e) { errors.push("pageerror: " + String(e).slice(0, 300)); });
          try {
            page.on("unhandledrejection", function (reason) { errors.push("unhandled: " + String(reason).slice(0, 300)); });
          } catch (e) { /* older playwright-core: pageerror coverage stands */ }

          await page.goto("http://localhost:" + port + "/" + r.hash,
            { waitUntil: "domcontentloaded", timeout: 30000 });
          await settle(page, waitMs);
          metrics = await page.evaluate(measureInPage);
          metrics.consoleErrors = errors;

          verdict = classify(metrics, vp.width);
          if (shouldShot(r.hash, verdict.verdict)) {
            shot = join(shotsDir, slugFor(r.hash) + "-" + vp.id + ".png");
            try { await page.screenshot({ path: shot }); } catch (e) { shot = null; }
          }
        } catch (e) {
          metrics = { overflowPx: -1, scrollRegion: "", widestSelector: "", smallTargets: [],
            contentRatio: 0, contentSelector: "", clippedText: [], viewportMeta: "",
            consoleErrors: ["sweep-crash: " + String((e && e.message) || e).slice(0, 200)] };
          verdict = classify(metrics, vp.width);
          /* The browser is the likely casualty -- relaunch before retrying. */
          try { await browser.close(); } catch (e2) { /* already gone */ }
          browser = await launchBrowser();
        } finally {
          try { if (page) await page.close(); } catch (e) { /* page already gone */ }
          try { if (context) await context.close(); } catch (e) { /* context already gone */ }
        }
        if (!metrics || metrics.overflowPx >= 0 || attempt >= 2) break;
      }

      results.push({
        hash: r.hash, group: r.group, viewport: vp.id, width: vp.width,
        verdict: verdict.verdict, fails: verdict.fails, notes: verdict.notes,
        metrics: metrics, shot: shot,
      });
      process.stderr.write("[" + (vi * routes.length + ri + 1) + "/" + (viewports.length * routes.length)
        + " " + vp.id + "] " + r.hash + " -> " + verdict.verdict + "\n");
    }
  }

  try { await browser.close(); } catch (e) { /* already closed */ }

  var report = {
    ranAt: new Date().toISOString(),
    network: "testnet",
    node: TESTNET_NODE,
    viewports: viewports,
    routesSwept: routes.length,
    results: results,
    skips: skips,
  };
  try { writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); } catch (e) { /* stdout still carries the summary */ }
  return report;
}

/* isMain: true only when this file is the entrypoint, so importing it for its
 * pure exports never launches a browser. */
function isMain() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) {
  var a = process.argv.slice(2).reduce(function (acc, cur, i, arr) {
    if (cur.startsWith("--")) acc[cur.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1";
    return acc;
  }, {});
  var report = await sweep({
    port: Number(a.port || 8081),
    viewportId: a.viewport || null,
    routeFilter: a.routes || null,
    waitMs: Number(a.wait || 6000),
  });
  var fails = report.results.filter(function (r) { return r.verdict === "FAIL"; });
  console.log(JSON.stringify({
    swept: report.results.length,
    fail: fails.length,
    passWithNote: report.results.filter(function (r) { return r.verdict === "PASS w/ note"; }).length,
    pass: report.results.filter(function (r) { return r.verdict === "PASS"; }).length,
    skips: report.skips.length,
    failures: fails.map(function (r) {
      return { hash: r.hash, viewport: r.viewport, fails: r.fails };
    }),
  }, null, 2));
  if (fails.length) process.exitCode = 2;
}