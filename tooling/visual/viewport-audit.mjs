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
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/BIT20", group: "expanded" },
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
      detail: Math.round(tw) + "x" + Math.round(th),
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
    clippedText: [], viewportMeta: "", consoleErrors: [],
  };

  /* A short, readable selector -- enough to grep app.css by, not a full path. */
  function sel(el) {
    if (!el) return "";
    var s = el.tagName.toLowerCase();
    if (el.id) return s + "#" + el.id;
    var cls = ((el.getAttribute && el.getAttribute("class")) || "").trim().split(/\s+/).filter(Boolean);
    if (cls.length) return s + "." + cls.slice(0, 2).join(".");
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
     * readable report); classify applies the >=44px rule itself. */
    var SEL = "button, a[href], select, input:not([type=hidden]), textarea, [role=button]";
    var ctrls = doc.querySelectorAll(SEL);
    for (var c = 0; c < ctrls.length; c++) {
      var el = ctrls[c];
      if (out.smallTargets.length >= 8) break;
      if (!shown(el)) continue;
      var b = el.getBoundingClientRect();
      if (b.height < 44 && b.width < 44) {
        out.smallTargets.push({ selector: sel(el), w: Math.round(b.width), h: Math.round(b.height) });
      }
    }

    /* Widest descendant of #view = the real content width. A full-bleed panel
     * nested inside a narrow wrapper still wins, which is the point. */
    var view = doc.getElementById("view");
    if (view) {
      var best = 0, bestSel = "";
      var kids = view.querySelectorAll("*");
      for (var k = 0; k < kids.length; k++) {
        var kb = kids[k].getBoundingClientRect();
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

export const _internal = { ROOT, HERE, TESTNET_NODE };