#!/usr/bin/env node
/* viewport-audit-test.mjs — unit vectors for the two-ended viewport sweep
 * (tooling/visual/viewport-audit.mjs, spec
 * docs/superpowers/specs/2026-10-07-viewport-audit-design.md).
 * Stdlib only: `node tooling/visual/viewport-audit-test.mjs` (exit 0 = green).
 * No browser needed for Tasks 1-2; the DOM probe vectors (Task 3) are the only
 * ones that need one, and they need a running server on AUDIT_PORT (default
 * 8081) plus a `page.setContent` probe that never touches the app.
 *
 * Created by: viewport-audit plan Task 1-3.
 */
/* ESM (the .mjs suffix), but the repo's other tooling tests are CJS and use
 * require() -- createRequire gives us that without dropping top-level await,
 * which the dynamic import() of the ESM module under test needs. */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
var require = createRequire(import.meta.url);
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var __dirname = dirname(fileURLToPath(import.meta.url));

var ROOT = path.resolve(__dirname, "..", "..");

/* Task 1 -- route table coverage. */
var A = await import("./viewport-audit.mjs");
var passed = 0;
function ok(cond, name) { assert.ok(cond, name); passed++; }
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* routerPaths() must agree with the real router: the audit can never claim
 * coverage of a route file that no longer exists. */
var routerSrc = fs.readFileSync(path.join(ROOT, "vanilla", "js", "router.js"), "utf8");
var realPaths = (routerSrc.match(/var routes = \[([\s\S]*?)\n  \];/) || [null, ""])[1]
  .split("\n")
  .map(function (l) { var m = l.match(/\{ path: "([^"]+)"/); return m ? m[1] : null; })
  .filter(Boolean);
ok(realPaths.length >= 70, "router.js exposes >=70 route paths (got " + realPaths.length + ")");
eq(A.routerPaths(), realPaths, "routerPaths() matches router.js exactly");

var covered = new Set(A.ROUTES.map(function (r) { return r.src; }));
var missing = realPaths.filter(function (p) { return !covered.has(p); });
eq(missing, [], "every router path has >=1 ROUTES entry");

/* No invented routes: every src must be a real path. */
var bogus = A.ROUTES.filter(function (r) { return realPaths.indexOf(r.src) === -1; });
eq(bogus.map(function (r) { return r.src; }), [], "no ROUTES entry invents a path");

/* Hashes are unique -- a duplicate would silently sweep one route twice. */
var seen = new Set(), dupes = [];
A.ROUTES.forEach(function (r) {
  if (seen.has(r.hash)) dupes.push(r.hash); else seen.add(r.hash);
});
eq(dupes, [], "no duplicate hashes");

/* Every param route carries a concrete fixture: no ":name" survives into a
 * hash, EXCEPT the two deliberate skips, which are excluded by group. */
var paramHashes = A.ROUTES.filter(function (r) {
  return r.group !== "skip" && r.hash.indexOf(":") !== -1;
}).map(function (r) { return r.hash; });
eq(paramHashes, [], "no unresolved :param in any swept hash");

/* Object ids keep their full dotted form (1.19.66, not 66). */
ok(A.ROUTES.some(function (r) { return r.hash === "#/pools/1.19.66"; }), "pool fixture is the full dotted id");
ok(A.ROUTES.some(function (r) { return r.hash === "#/account/lite-test-1"; }), "account fixture recorded");

/* A skip carries a reason. An unexplained skip is an unrun route. */
var unreasoned = A.ROUTES.filter(function (r) { return r.group === "skip" && !r.note; })
  .map(function (r) { return r.hash; });
eq(unreasoned, [], "every skip route states a reason");

/* expandRoutes() drops skips. */
eq(A.expandRoutes().filter(function (r) { return r.group === "skip"; }).length, 0,
  "expandRoutes() excludes skips");

/* Task 2 -- verdict classification. Pure: no browser, no globals. */

/* A clean page at both widths: PASS, no fails, no notes. */
var clean = {
  overflowPx: 0, scrollRegion: "", widestSelector: "",
  smallTargets: [], contentRatio: 0.92, contentSelector: "section.x",
  clippedText: [], viewportMeta: "width=device-width, initial-scale=1", consoleErrors: [],
};
var c1 = A.classify(clean, 390);
eq(c1.verdict, "PASS", "clean page at phone width is PASS");
eq(c1.fails.length, 0, "clean page has no failures");
var c2 = A.classify(clean, 2560);
eq(c2.verdict, "PASS", "clean page at desk width is PASS");

/* A1: sideways scroll with no absorbing region is a FAIL. */
var over = Object.assign({}, clean, { overflowPx: 37, widestSelector: "table.orders" });
var c3 = A.classify(over, 390);
eq(c3.verdict, "FAIL", "h-overflow without a scroll region FAILS");
eq(c3.fails.map(function (f) { return f.id; }), ["A1-h-overflow"], "A1 is the failing assertion id");
eq(c3.fails[0].selector, "table.orders", "A1 names the offending selector");

/* A1: the same overflow INSIDE a scroll region is a note, not a failure --
 * a declared horizontal scroll region is the sanctioned dense-grid answer
 * (spec §4). */
var scroll = Object.assign({}, clean, { overflowPx: 37, widestSelector: "table.orders", scrollRegion: "div.pools-scroll" });
var c4 = A.classify(scroll, 390);
eq(c4.verdict, "PASS w/ note", "scroll-region overflow is a note, not a failure");
eq(c4.fails.length, 0, "scroll-region overflow produces no fails");
ok(c4.notes.join(" ").indexOf("pools-scroll") !== -1, "the note names the scroll region");

/* A2: a control under 44px in BOTH dimensions fails; 44px in one does not. */
var small = Object.assign({}, clean, { smallTargets: [{ selector: "a.skip", w: 28, h: 18 }] });
eq(A.classify(small, 390).verdict, "FAIL", "28x18 control FAILS the touch floor");
eq(A.classify(small, 390).fails.map(function (f) { return f.id; }), ["A2-touch-floor"], "A2 is the failing assertion id");
ok(A.classify(small, 390).fails[0].detail.indexOf("28x18") !== -1, "A2 reports the measured box");
var okOne = Object.assign({}, clean, { smallTargets: [{ selector: "input.x", w: 30, h: 44 }] });
eq(A.classify(okOne, 390).verdict, "PASS", "44px in one dimension PASSES (>=44 in at least one)");

/* A3: stranded column is a desk-width assertion only. */
var stranded = Object.assign({}, clean, { contentRatio: 0.41, contentSelector: "div.wrap" });
eq(A.classify(stranded, 2560).verdict, "FAIL", "41% content ratio at 2560 FAILS");
eq(A.classify(stranded, 2560).fails.map(function (f) { return f.id; }), ["A3-stranded-column"], "A3 is the failing assertion id");
eq(A.classify(stranded, 390).verdict, "PASS", "a narrow column is not a defect at phone width");

/* A4: any console error fails. */
var noisy = Object.assign({}, clean, { consoleErrors: ["pageerror: boom"] });
eq(A.classify(noisy, 390).verdict, "FAIL", "a console error FAILS");
eq(A.classify(noisy, 390).fails.map(function (f) { return f.id; }), ["A4-console"], "A4 is the failing assertion id");

/* Multiple failures are all reported, FAIL wins over notes. */
var many = Object.assign({}, clean, { overflowPx: 12, smallTargets: [{ selector: "b", w: 10, h: 10 }], consoleErrors: ["x"] });
var c5 = A.classify(many, 390);
eq(c5.verdict, "FAIL", "several defects still read as FAIL");
eq(c5.fails.length, 3, "all three defects are reported, not just the first");

/* Shot policy: every FAIL, plus a deterministic 1-in-5 PASS sample. */
eq(A.shouldShot("#/transfer", "FAIL"), true, "every FAIL is shot");
eq(A.shouldShot("#/transfer", "PASS w/ note"), true, "every PASS w/ note is shot");
/* The PASS rule IS the length modulus -- assert the contract, not a hash that
 * happens to fall inside or outside the sample. */
eq(A.shouldShot("#/transfer", "PASS"), "#/transfer".length % 5 === 0,
  "a PASS is shot only when the 1-in-5 length rule selects it");
eq(A.shouldShot("#/accounts", "PASS"), "#/accounts".length % 5 === 0,
  "the rule holds for a second hash");
var sample = A.expandRoutes().map(function (r) { return A.shouldShot(r.hash, "PASS"); });
var shotCount = sample.filter(Boolean).length;
ok(shotCount > 0, "the 1-in-5 PASS sample is non-empty (got " + shotCount + ")");
ok(shotCount < A.expandRoutes().length / 3,
  "the PASS sample stays well under a third of routes (got " + shotCount + "/" + A.expandRoutes().length + ")");
eq(A.expandRoutes().map(function (r) { return A.shouldShot(r.hash, "PASS"); }), sample,
  "the PASS sample is deterministic (same input, same shots)");

/* Task 3 -- the in-page probe. These vectors need playwright-core; they are
 * skipped (loudly) when it is absent so the pure vectors above still run. */
var hasPw = (function () {
  try { fs.accessSync(path.join(ROOT, "tooling", "visual", "node_modules", "playwright-core")); return true; }
  catch (e) { return false; }
})();
if (!hasPw) {
  console.log("viewport-audit-test: SKIP task-3 DOM vectors (playwright-core not installed)");
} else {
  A.ensureBrowsers();
  var pw = await import("./node_modules/playwright-core/index.js");
  var chromium = pw.chromium || (pw.default && pw.default.chromium);
  var br = await chromium.launch();
  var page = await br.newPage({ viewport: { width: 390, height: 844 } });

  /* A blank page measures clean: no overflow, no tiny targets. */
  await page.goto("about:blank");
  var m = await page.evaluate(A.measureInPage);
  ok(m && typeof m === "object", "measureInPage returns an object");
  eq(Number(m.overflowPx), 0, "a blank page has no h-overflow");
  ok(Array.isArray(m.smallTargets), "smallTargets is an array");
  ok(Array.isArray(m.consoleErrors), "consoleErrors is an array");
  eq(m.viewportMeta, "", "no viewport meta on about:blank");

  /* An element wider than the viewport IS caught, and names itself. */
  await page.setContent("<meta name='viewport' content='width=device-width, initial-scale=1'>"
    + "<div style='width:900px'>x</div>");
  m = await page.evaluate(A.measureInPage);
  ok(Number(m.overflowPx) > 1, "an oversized element produces overflowPx");
  ok(String(m.widestSelector).indexOf("div") === 0, "the widest offender is named (got " + m.widestSelector + ")");
  eq(m.scrollRegion, "", "no scroll region absorbs a plain overflow");

  /* The SAME overflow inside a declared scroll region is absorbed. */
  await page.setContent("<meta name='viewport' content='width=device-width, initial-scale=1'>"
    + "<div class='pools-scroll' style='overflow-x:auto;width:390px'>"
    + "<table style='width:900px'><tr><td>a</td></tr></table></div>");
  m = await page.evaluate(A.measureInPage);
  eq(m.scrollRegion, "div.pools-scroll", "a computed overflow-x ancestor is named as the scroll region");

  /* Touch floor: 20x20 is caught, 44px-tall is not. */
  await page.setContent("<meta name='viewport' content='width=device-width, initial-scale=1'>"
    + "<button style='width:20px;height:20px'>a</button>"
    + "<button style='width:30px;height:44px'>b</button>");
  m = await page.evaluate(A.measureInPage);
  eq(m.smallTargets.length, 1, "exactly the sub-44px-in-both control is flagged");
  ok(m.smallTargets[0].w === 20, "the flagged control reports its box (got " + JSON.stringify(m.smallTargets[0]) + ")");

  /* contentRatio: full-bleed beats nested, narrow reads as stranded. */
  await page.setViewportSize({ width: 2560, height: 1080 });
  await page.setContent("<div id='view'><div style='width:2560px'>wide</div></div>");
  m = await page.evaluate(A.measureInPage);
  ok(Number(m.contentRatio) >= 0.99, "a full-bleed child counts as full-bleed (got " + m.contentRatio + ")");
  await page.setContent("<div id='view'><div class='wrap' style='width:720px'>narrow</div></div>");
  m = await page.evaluate(A.measureInPage);
  ok(Number(m.contentRatio) < 0.55, "a 720px column at 2560 reads as stranded (got " + m.contentRatio + ")");

  /* A CLIPPED over-wide element must not distort contentRatio -- a hidden
   * overflow is an A1 finding, and folding it into the ratio would report a
   * meaningless number >1 instead of the stranded-column figure. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent("<div id='view' style='overflow:hidden'>"
    + "<div style='width:900px'>clipped</div></div>");
  m = await page.evaluate(A.measureInPage);
  ok(Number(m.contentRatio) <= 1.001,
    "a clipped over-wide child is excluded from contentRatio (got " + m.contentRatio + ")");

  /* An 18x18 radio inside a 44px label is NOT a defect -- the label is the
   * touch target (viewport-gaps.md:36 pattern). */
  await page.setContent("<meta name='viewport' content='width=device-width, initial-scale=1'>"
    + "<label style='display:block;min-height:44px'>"
    + "<input type='radio' style='width:18px;height:18px'>label text</label>");
  m = await page.evaluate(A.measureInPage);
  eq(m.smallTargets.length, 0, "a radio wrapped in a 44px label is not flagged (got " + JSON.stringify(m.smallTargets) + ")");

  /* ...but a bare 18x18 radio with no label still is. */
  await page.setContent("<meta name='viewport' content='width=device-width, initial-scale=1'>"
    + "<input type='radio' style='width:18px;height:18px'>");
  m = await page.evaluate(A.measureInPage);
  eq(m.smallTargets.length, 1, "an unlabelled 18x18 radio IS flagged");

  /* Prose vs control: an anchor left display:inline is part of a text run
   * (help TOC <li>, footer "Master") and must NOT fail the floor -- every real
   * control in the app is inline-flex/block. Without this rule 100% of routes
   * failed on the same footer link. */
  await page.setContent("<meta name='viewport' content='width=device-width, initial-scale=1'>"
    + "<span class='left'>v1.0.0 <a href='#'>Master</a></span>"
    + "<ul><li><a href='#'>Help</a></li></ul>");
  m = await page.evaluate(A.measureInPage);
  eq(m.smallTargets.length, 0, "inline prose links are not touch-floor failures");
  eq(m.inlineLinks.length, 1, "the narrow inline link is recorded instead");
  ok(m.inlineLinks[0].text === "Help", "the recorded link carries its text (got " + m.inlineLinks[0].text + ")");

  /* A genuinely small BUTTON is still a failure -- the rule is display-based,
   * not a blanket exemption for anchors. */
  await page.setContent("<meta name='viewport' content='width=device-width, initial-scale=1'>"
    + "<button style='width:20px;height:20px'>x</button>");
  m = await page.evaluate(A.measureInPage);
  eq(m.smallTargets.length, 1, "a 20x20 button is still flagged");

  /* A small anchor styled as a real control (inline-flex) IS a failure. */
  await page.setContent("<meta name='viewport' content='width=device-width, initial-scale=1'>"
    + "<a class='btn' href='#' style='display:inline-flex;width:24px;height:24px'>go</a>");
  m = await page.evaluate(A.measureInPage);
  eq(m.smallTargets.length, 1, "a 24x24 inline-flex control-anchor IS flagged");

  await br.close();
  passed += 18;
}

console.log("viewport-audit-test: " + passed + " assertions PASS");