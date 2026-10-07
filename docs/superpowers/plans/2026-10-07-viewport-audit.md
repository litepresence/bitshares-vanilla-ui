# Two-Ended Viewport Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a headless sweep that measures all ~74 vanilla routes at 390px and 2560px against live testnet, fix every layout defect it finds in place, and record honest per-route verdicts in a parity note — the first green pass of check 7 (`skills/auditing-vanilla-slices/SKILL.md:57`) in the project's history.

**Architecture:** One dev-only Node ESM script, `tooling/visual/viewport-audit.mjs`, exporting **pure** functions (`ROUTES`, `expandRoutes`, `classify`, `shouldShot`, `measureInPage`) plus a runner that only executes when invoked directly. Pure logic is unit-tested with no browser; the in-page DOM probe is tested against a live route and against a deliberately-broken injected state. Because the script is `.mjs` and the repo runs Node 20 (`require()` of ESM is unavailable), the test harness loads it via dynamic `import()`.

**Tech Stack:** Node 20 ESM, `playwright-core` 1.63 (already in `tooling/visual/node_modules`; chromium-1243 in `~/.cache/ms-playwright`). Zero new dependencies. Plain `python3 -m http.server` to serve `vanilla/`.

## Global Constraints

- **Zero new dependencies.** No npm install, no new `package.json` entry. `playwright-core` is already declared in `tooling/visual/package.json:3`.
- **Dev-only.** `tooling/visual/viewport-audit.mjs` is never shipped and never required to use, test, or deploy the wallet (`AGENTS.md` §4.5 rule 4). Nothing under `vanilla/` may import it.
- **Testnet only. Reads only.** No keys, no broadcasts, no writes. Node list pinned to `wss://testnet.xbts.io/ws` via the settings envelope.
- **All four gates must stay green** after every code change: `python3 tooling/check_rot.py`, `bash tooling/check_types.sh`, `python3 tooling/check_i18n.py`, `python3 tooling/scan_dead_css.py`. All four currently PASS.
- **No fabricated fixtures.** Every object id comes from a recorded parity note. A route that cannot be given a real id is `SKIP-no-fixture` with a reason — never silently passed, never invented.
- **Touch floor is ≥44px in at least one dimension** (`AGENTS.md` §3.6). A control failing both is a defect.
- **Every fix records a retro note.** Pure widening is not a retro break and needs none; a restructure needs the before/after justification required by `skills/component-wisdom/SKILL.md:139-145`.
- **Shared utilities are inviolable** (`AGENTS.md` §7 rule 9). No fix may introduce a local `el()`, `clearRoot()`, `fieldRow()`, or `touchable()` copy.

---

## File Structure

| File | Responsibility |
|---|---|
| `tooling/visual/viewport-audit.mjs` | **Create.** Owns the route table, the pure verdict logic, the in-page DOM probe, and the sweep runner. Single purpose: "measure and classify every route at two viewports". |
| `tooling/visual/viewport-audit-test.mjs` | **Create.** Unit + integration tests for the pure logic and the DOM probe. Stdlib `assert` only. |
| `docs/parity/viewport-audit-2.json` | **Generated.** Machine verdicts. |
| `docs/parity/viewport-shots/*.png` | **Generated.** Screenshots — every FAIL, plus the deterministic 1-in-5 PASS sample. |
| `docs/parity/viewport-audit-2.md` | **Create (hand-written).** Per-route table, ranked punchlist, before/after per fix, honest human-only carry-overs. |
| `vanilla/css/app.css` + offending views | **Modify.** The fixes themselves. |

The script stays one file because every part of it exists to answer one question per route: *does this route survive at this width?* Splitting the route table from the probe from the runner would be three files that always change together — the split cost in import wiring exceeds the clarity gain at this size. If it passes ~500 lines it becomes a split candidate, per §3.7.

---

## Task 1: Route table and expansion

**Files:**
- Create: `tooling/visual/viewport-audit.mjs`
- Create: `tooling/visual/viewport-audit-test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `ROUTES: Array<{ src: string, hash: string, group: "static"|"live-id"|"expanded"|"dynamic"|"skip", note?: string }>` — every `src` matches a `path:` in `vanilla/js/router.js`'s `routes` array.
  - `routerPaths(): string[]` — parses the `path:` entries straight out of `router.js` so coverage can never drift.
  - `expandRoutes(): Array<{ hash, group }>` — `ROUTES` minus `group === "skip"`.

**Why the split matters:** the test parses `router.js` independently and asserts every path is represented. A new route added to the router but not to the audit table fails the test — the whole point of a coverage audit is that coverage cannot silently rot.

- [ ] **Step 1: Write the failing test**

Create `tooling/visual/viewport-audit-test.mjs`:

```js
#!/usr/bin/env node
/* viewport-audit-test.mjs — unit vectors for the two-ended viewport sweep
 * (tooling/visual/viewport-audit.mjs, spec
 * docs/superpowers/specs/2026-10-07-viewport-audit-design.md).
 * Stdlib only: `node tooling/visual/viewport-audit-test.mjs` (exit 0 = green).
 * No browser needed for Tasks 1-2; the DOM probe vectors (Task 3) are the only
 * ones that need one, and they are marked as such below.
 */
"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");

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

/* Every param route carries a concrete fixture: no ":name" survives into a hash. */
var paramHashes = A.ROUTES.filter(function (r) { return r.hash.indexOf(":") !== -1; })
  .map(function (r) { return r.hash; });
eq(paramHashes, [], "no unresolved :param in any hash");

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

console.log("viewport-audit-test: " + passed + " assertions PASS");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/visual/viewport-audit-test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./viewport-audit.mjs` (the file does not exist yet).

- [ ] **Step 3: Write the route table**

Create `tooling/visual/viewport-audit.mjs`:

```js
#!/usr/bin/env node
/* viewport-audit.mjs — two-ended viewport sweep for the vanilla wallet
 * (DEV ONLY — never shipped, never required; the human browser pass stays
 * the gate, per AGENTS.md §4.5 rule 4).
 *
 * Owns: the audit route table, the pure verdict logic, the in-page DOM probe,
 * and the sweep runner. One purpose: decide whether each route survives at
 * each of two viewports, and say why not.
 * Spec: docs/superpowers/specs/2026-10-07-viewport-audit-design.md
 * Parity note: docs/parity/viewport-audit-2.md
 * Consumes: playwright-core (dev-only, tooling/visual/package.json:3).
 * Side effects: writes screenshots + a JSON report; never touches vanilla/.
 *
 * Usage (server must be running):
 *   python3 -m http.server 8081 --directory vanilla &
 *   node tooling/visual/viewport-audit.mjs --port 8081
 *   node tooling/visual/viewport-audit.mjs --port 8081 --viewport phone
 *   node tooling/visual/viewport-audit.mjs --port 8081 --routes "#/transfer"
 *
 * Stdlib + playwright-core only. No new dependency.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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
 * Failure: returns [] when the routes array cannot be found (test then fails
 * loudly rather than passing on an empty table). */
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

export const _internal = { ROOT, HERE, TESTNET_NODE };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/visual/viewport-audit-test.mjs`
Expected: `viewport-audit-test: 9 assertions PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tooling/visual/viewport-audit.mjs tooling/visual/viewport-audit-test.mjs
git commit -m "feat(viewport-audit): route table + coverage-locked expansion (task 1)"
```

---

## Task 2: Verdict classification and shot policy

**Files:**
- Modify: `tooling/visual/viewport-audit.mjs`
- Modify: `tooling/visual/viewport-audit-test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 except the file being extended.
- Produces:
  - `classify(m: Metrics, width: number): { verdict: "PASS"|"PASS w/ note"|"FAIL", fails: Array<{id, detail, selector}>, notes: string[] }` — pure.
  - `shouldShot(hash: string, verdict: string): boolean` — pure.
  - `Metrics` shape (documented in the header): `{ overflowPx, scrollRegion, widestSelector, smallTargets: Array<{selector,w,h}>, contentRatio, contentSelector, clippedText: string[], viewportMeta, consoleErrors: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `tooling/visual/viewport-audit-test.mjs`, before the final `console.log`:

```js
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
eq(A.shouldShot("#/transfer", "PASS"), false, "a plain PASS outside the sample is not shot");
var sample = A.expandRoutes().map(function (r) { return A.shouldShot(r.hash, "PASS"); });
ok(sample.some(Boolean), "the 1-in-5 PASS sample is non-empty");
ok(sample.length < A.expandRoutes().length / 3, "the PASS sample stays well under a third of routes");
eq(A.expandRoutes().map(function (r) { return A.shouldShot(r.hash, "PASS"); }), sample,
  "the PASS sample is deterministic (same input, same shots)");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/visual/viewport-audit-test.mjs`
Expected: FAIL — `TypeError: A.classify is not a function`.

- [ ] **Step 3: Implement classify and shouldShot**

Insert into `tooling/visual/viewport-audit.mjs`, directly above `export const _internal`:

```js
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

  /* A2 -- touch floor: >=44px in AT LEAST ONE dimension (§3.6). */
  var targets = Array.isArray(m.smallTargets) ? m.smallTargets : [];
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i] || {};
    fails.push({
      id: "A2-touch-floor",
      detail: Math.round(Number(t.w) || 0) + "x" + Math.round(Number(t.h) || 0),
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/visual/viewport-audit-test.mjs`
Expected: `viewport-audit-test: 30 assertions PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tooling/visual/viewport-audit.mjs tooling/visual/viewport-audit-test.mjs
git commit -m "feat(viewport-audit): pure verdict classification + deterministic shot policy (task 2)"
```

---

## Task 3: In-page DOM probe and sweep runner

**Files:**
- Modify: `tooling/visual/viewport-audit.mjs`
- Modify: `tooling/visual/viewport-audit-test.mjs`

**Interfaces:**
- Consumes: `ROUTES`, `expandRoutes()`, `classify()`, `shouldShot()`, `VIEWPORTS` from Tasks 1–2.
- Produces:
  - `measureInPage(): Metrics` — serialised into the browser by Playwright; returns the `Metrics` shape.
  - `sweep(opts): Promise<Report>` — `opts = { port, viewportId?, routeFilter?, waitMs?, shotsDir?, reportPath? }`. `Report = { ranAt, network, viewports, results: Array<{hash, viewport, width, verdict, fails, notes, metrics, shot}>, skips }`.

- [ ] **Step 1: Write the failing test**

Append to `tooling/visual/viewport-audit-test.mjs`, before the final `console.log`:

```js
/* Task 3 -- the in-page probe. These vectors need a live server + browser;
 * they are skipped (loudly) when tooling/visual/node_modules is absent so the
 * pure vectors above still run anywhere. */
var fsmod = fs;
var hasPw = (function () {
  try { fsmod.accessSync(path.join(ROOT, "tooling", "visual", "node_modules", "playwright-core")); return true; }
  catch (e) { return false; }
})();
if (!hasPw) {
  console.log("viewport-audit-test: SKIP task-3 DOM vectors (playwright-core not installed)");
} else {
  var { chromium } = await import("./node_modules/playwright-core/index.js");
  var origin = "http://localhost:" + (process.env.AUDIT_PORT || "8081");
  var br = await chromium.launch();
  var page = await br.newPage({ viewport: { width: 390, height: 844 } });

  /* A blank page measures clean: no overflow, no tiny targets, full width. */
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
  ok(m.smallTargets[0].detail === "20x20" || m.smallTargets[0].w === 20, "the flagged control reports its box");

  /* contentRatio: full-bleed beats nested, narrow reads as stranded. */
  await page.setViewportSize({ width: 2560, height: 1080 });
  await page.setContent("<div id='view'><div style='width:2560px'>wide</div></div>");
  m = await page.evaluate(A.measureInPage);
  ok(Number(m.contentRatio) >= 0.99, "a full-bleed child counts as full-bleed (got " + m.contentRatio + ")");
  await page.setContent("<div id='view'><div class='wrap' style='width:720px'>narrow</div></div>");
  m = await page.evaluate(A.measureInPage);
  ok(Number(m.contentRatio) < 0.55, "a 720px column at 2560 reads as stranded (got " + m.contentRatio + ")");

  await br.close();
  passed += 8;
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/visual/viewport-audit-test.mjs`
Expected: FAIL — `TypeError: A.measureInPage is not a function`.

- [ ] **Step 3: Implement measureInPage**

Insert into `tooling/visual/viewport-audit.mjs`, directly above `export const _internal`:

```js
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
    var cls = (el.getAttribute && el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
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

    /* Touch floor: >=44px in at least one dimension. */
    var SEL = "button, a[href], select, input:not([type=hidden]), textarea, [role=button]";
    var ctrls = doc.querySelectorAll(SEL);
    for (var c = 0; c < ctrls.length; c++) {
      var el = ctrls[c];
      if (!shown(el)) continue;
      var b = el.getBoundingClientRect();
      if (b.height < 44 && b.width < 44 && out.smallTargets.length < 8) {
        out.smallTargets.push({ selector: sel(el), w: Math.round(b.width), h: Math.round(b.height) });
      }
    }

    /* Widest block-level descendant of #view = the real content width. */
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
    var texts = doc.querySelectorAll("#view p, #view span, #view td, #view th, #view label, #view h1, #view h2, #view h3, #view button");
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
```

- [ ] **Step 4: Implement the runner**

Append to `tooling/visual/viewport-audit.mjs`, after `export const _internal`:

```js
/* slugFor: a filesystem-safe stem for a route hash.
 * Params: hash route hash. Returns: string. Pure, never throws. */
function slugFor(hash) {
  return String(hash).replace(/^#\/?/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

/* settle: wait for the route to actually render rather than sleeping blind.
 * #view is the router's render target (index.html:65). Fails: falls back to a
 * fixed wait so a never-rendering route is still measured (and recorded). */
async function settle(page, waitMs) {
  try {
    await page.waitForFunction(() => {
      var v = document.getElementById("view");
      return !!v && v.children.length > 0;
    }, { timeout: Math.min(waitMs, 20000) });
  } catch (e) { /* falls through to the fixed wait */ }
  await page.waitForTimeout(waitMs);
}

/* sweep: measure every route at every viewport against live testnet.
 * Params: opts { port, viewportId?, routeFilter?, waitMs?, shotsDir?, reportPath? }.
 *   Defaults: port 8081, waitMs 6000, shotsDir docs/parity/viewport-shots,
 *   reportPath docs/parity/viewport-audit-2.json.
 * Returns: Promise<Report> (see Interfaces). Skipped routes come back in
 *   Report.skips with their recorded reason -- never counted as passes.
 * Failure: a route that throws mid-measure records metrics.overflowPx = -1 and
 *   an A4-console entry naming the error; the run never aborts. */
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

  /* Dev-only dep; imported lazily so the pure exports stay importable anywhere. */
  const { chromium } = await import("./node_modules/playwright-core/index.js");
  var browser = await chromium.launch();
  var results = [], skips = [];

  ROUTES.filter(function (r) { return r.group === "skip"; }).forEach(function (r) {
    skips.push({ hash: r.hash, reason: r.note || "no reason recorded" });
  });

  try {
    for (var vi = 0; vi < viewports.length; vi++) {
      var vp = viewports[vi];
      var context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });

      /* Same bootstrap shot.mjs uses (shot.mjs:47-66): pin testnet, dismiss
       * the tour so it never covers the page under test. */
      await context.addInitScript(({ node, flag }) => {
        try {
          var raw = localStorage.getItem("bts-vanilla-settings-v1");
          var s = raw ? JSON.parse(raw) : {};
          s.network = "testnet";
          s.activeNode = node;
          localStorage.setItem("bts-vanilla-settings-v1", JSON.stringify(s));
          localStorage.setItem("bts-vanilla-tour-dismissed-v1", flag);
        } catch (e) { /* defaults stand */ }
      }, { node: TESTNET_NODE, flag: "1" });

      for (var ri = 0; ri < routes.length; ri++) {
        var r = routes[ri];
        var page = await context.newPage();
        var errors = [];
        page.on("console", function (m) { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
        page.on("pageerror", function (e) { errors.push("pageerror: " + String(e).slice(0, 300)); });
        try {
          page.on("unhandledrejection", function (reason) { errors.push("unhandled: " + String(reason).slice(0, 300)); });
        } catch (e) { /* older playwright-core: pageerror coverage stands */ }

        var metrics = { overflowPx: -1, scrollRegion: "", widestSelector: "", smallTargets: [],
          contentRatio: 0, contentSelector: "", clippedText: [], viewportMeta: "", consoleErrors: errors };

        try {
          await page.goto("http://localhost:" + port + "/" + r.hash, { waitUntil: "domcontentloaded", timeout: 30000 });
          await settle(page, waitMs);
          metrics = await page.evaluate(measureInPage);
          metrics.consoleErrors = errors;
        } catch (e) {
          errors.push("sweep: " + String((e && e.message) || e).slice(0, 200));
          metrics.consoleErrors = errors;
        }

        var verdict = classify(metrics, vp.width);
        var shot = null;
        if (shouldShot(r.hash, verdict.verdict)) {
          shot = join(shotsDir, slugFor(r.hash) + "-" + vp.id + ".png");
          try { await page.screenshot({ path: shot }); } catch (e) { shot = null; }
        }

        results.push({
          hash: r.hash, group: r.group, viewport: vp.id, width: vp.width,
          verdict: verdict.verdict, fails: verdict.fails, notes: verdict.notes,
          metrics: metrics, shot: shot,
        });
        process.stderr.write("[" + (ri + 1) + "/" + routes.length + " " + vp.id + "] "
          + r.hash + " -> " + verdict.verdict + "\n");
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  var report = {
    ranAt: new Date().toISOString(),
    network: "testnet",
    node: TESTNET_NODE,
    viewports: viewports,
    routesSwept: routes.length,
    results: results,
    skips: skips,
  };
  try { writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); } catch (e) { /* report is stdout too */ }
  return report;
}

/* isMain: true only when this file is the entrypoint (so importing it for its
 * pure exports never launches a browser). */
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
```

- [ ] **Step 5: Run the test to verify it passes**

Start the server first: `python3 -m http.server 8081 --directory vanilla &`

Run: `node tooling/visual/viewport-audit-test.mjs`
Expected: `viewport-audit-test: 38 assertions PASS`, exit 0. (The task-3 block adds 8.)

- [ ] **Step 6: Smoke the runner on one route**

Run: `node tooling/visual/viewport-audit.mjs --port 8081 --routes "#/settings" --wait 4000`
Expected: JSON with `swept: 2` (one route × two viewports), a verdict per route, and screenshots under `docs/parity/viewport-shots/`.

- [ ] **Step 7: Commit**

```bash
git add tooling/visual/viewport-audit.mjs tooling/visual/viewport-audit-test.mjs
git commit -m "feat(viewport-audit): in-page DOM probe + testnet sweep runner (task 3)"
```

---

## Task 4: Full sweep and ranked punchlist

**Files:**
- Create: `docs/parity/viewport-audit-2.json` (generated)
- Create: `docs/parity/viewport-shots/*.png` (generated)

**Interfaces:**
- Consumes: `sweep()` from Task 3.
- Produces: a ranked failure list. Ranking rule: money paths first (transfer, htlc, samet, credit, barter, borrow, pools, assets), then reach (route entries), then severity (FAIL assertions in order A1, A4, A3, A2 — overflow and console errors break the page, stranded columns waste it, touch floors hurt).

- [ ] **Step 1: Run the full sweep**

```bash
python3 -m http.server 8081 --directory vanilla &
node tooling/visual/viewport-audit.mjs --port 8081 --wait 6000 2>/tmp/viewport-progress.log
```

Expected: progress lines for every route×viewport on stderr; JSON summary on stdout; exit code 2 (failures are expected — this task's job is to find them).

- [ ] **Step 2: Read the progress log for crashes**

Run: `grep -c "pageerror\|sweep:" /tmp/viewport-progress.log; tail -5 /tmp/viewport-progress.log`
Expected: `sweep:` count 0 (a non-zero count means a route threw mid-measure and its metrics are unreliable — re-run that route alone before trusting its verdict).

- [ ] **Step 3: Produce the ranked punchlist**

Run:

```bash
node -e '
const r = JSON.parse(require("fs").readFileSync("docs/parity/viewport-audit-2.json","utf8"));
const MONEY = ["transfer","htlc","samet","credit","deal","barter","borrow","pools","assets","asset/","vote","proposal","vesting","ticket","authorities","direct-debit","spotlight"];
const money = (h) => MONEY.some((m) => h.includes(m)) ? 0 : 1;
const sev = (f) => ({ "A1-h-overflow":0, "A4-console":1, "A3-stranded-column":2, "A2-touch-floor":3 }[f.id] ?? 4);
const out = [];
r.results.forEach((x) => {
  if (x.verdict !== "FAIL") return;
  out.push({ hash:x.hash, viewport:x.viewport, rank: money(x.hash), worst: Math.min(...x.fails.map((f)=>sev(f))),
             fails: x.fails.map((f) => f.id + " " + f.detail + " @" + f.selector) });
});
out.sort((a,b) => a.rank-b.rank || a.worst-b.worst || a.hash.localeCompare(b.hash));
console.log(out.length + " failing route/viewport pairs");
out.forEach((o) => { console.log("\n" + o.rank + "/" + o.worst + "  " + o.hash + "  [" + o.viewport + "]");
  o.fails.forEach((f) => console.log("    " + f)); });
'
```

Expected: the ranked list, money paths first. This output is the input to Task 5.

- [ ] **Step 4: Record the skips honestly**

Run: `node -e 'const r=JSON.parse(require("fs").readFileSync("docs/parity/viewport-audit-2.json","utf8")); r.skips.forEach(s=>console.log(s.hash+" -- "+s.reason));'`
Expected: exactly the reasoned skips from Task 1 (`#/invoice/:data`, `#/prediction/:market`). Any skip without a reason is a bug in the table.

- [ ] **Step 5: Commit the generated evidence**

```bash
git add docs/parity/viewport-audit-2.json docs/parity/viewport-shots
git commit -m "audit(viewport): full two-ended sweep evidence — $(node -e 'const r=JSON.parse(require("fs").readFileSync("docs/parity/viewport-audit-2.json","utf8"));console.log(r.results.length+" measurements")')"
```

---

## Task 5: Fix the failures in place

**Files:**
- Modify: `vanilla/css/app.css` (and specific views as the punchlist names)

**Interfaces:**
- Consumes: the ranked punchlist from Task 4.
- Produces: zero FAIL rows on re-sweep, or a documented deferral for each remaining one.

**This task's shape is determined by the punchlist, not by this plan** — the plan fixes the *method*, because the actual defects are unknown until the sweep runs. Follow it per finding:

- [ ] **Step 1: Fix shared-CSS-class defects first**

One-line fixes in `vanilla/css/app.css` reach every route. Do these before any per-view edit. The known candidate from `docs/parity/viewport-gaps.md:26` is the inline label cramp: form rows should stack at phone width.

- [ ] **Step 2: Fix per-view defects**

For each remaining punchlist row, edit the named view. Rules: use `DOM`, `Forms`, `TableRenderer`, `Event.delegate`, and the shared `touchable` — never a local helper (`AGENTS.md` §7 rule 9). Touch-floor failures are fixed by adding the shared `touchable()` to the control, not by hand-writing a min-height.

- [ ] **Step 3: Re-run all four gates after every batch of fixes**

```bash
python3 tooling/check_rot.py && bash tooling/check_types.sh && python3 tooling/check_i18n.py && python3 tooling/scan_dead_css.py
```
Expected: `ROT CHECK PASSED`, `check_types: PASS`, `OK: 12 dicts key-complete`, and a clean dead-CSS scan. Any failure blocks the next batch.

- [ ] **Step 4: Re-sweep only what failed**

```bash
node tooling/visual/viewport-audit.mjs --port 8081 --routes "#/transfer" --wait 6000
```
Expected: `verdict` no longer `FAIL` for the pairs this route failed on before. Repeat per fixed route.

- [ ] **Step 5: Commit each batch with its before/after in the message**

```bash
git commit -m "fix(viewport): <route> phone — <before> -> <after> (viewport-audit-2)"
```

---

## Task 6: Parity note and honest carry-overs

**Files:**
- Create: `docs/parity/viewport-audit-2.md`
- Modify: `SLICES.md` (status table + slice-18 readability line)
- Modify: `docs/parity/component-audit.md` (record that the in-flight diff's phone-width behaviour is now measured)

**Interfaces:**
- Consumes: the re-sweep JSON, the punchlist, the fixes.
- Produces: the note that closes check 7, and the honest list of what stays human.

- [ ] **Step 1: Write the note**

`docs/parity/viewport-audit-2.md` must contain: the run header (date, node, head block, route count, measurement count); a per-route table with verdict at both viewports; the ranked punchlist with a before/after line per fix; the theme note (this sweep runs the default `ref-ui-theme` — the theme trio is a separate round); and an explicit carry-over list of everything a machine cannot judge.

- [ ] **Step 2: State the human-only items explicitly**

Must appear in the note: unlocked-wallet bodies; swipe-scrolling a `.pools-scroll` region; keyboard-only runs through pickers and the new pagers; open-state hamburger tap; and the theme trio. Never let a machine pass imply these are done.

- [ ] **Step 3: Update SLICES.md**

Mark check 7 green for the routes swept, and record the sweep as evidence for slice 18's readability line. Do not mark the browser pass ⏳ items done — they are the human tester's.

- [ ] **Step 4: Final gate run**

```bash
python3 tooling/check_rot.py && bash tooling/check_types.sh && python3 tooling/check_i18n.py && python3 tooling/scan_dead_css.py
git status --short
```
Expected: four greens; `git status` clean apart from the intentionally untracked/unstaged in-flight component-wisdom diff (audit 2's business, not this plan's).

- [ ] **Step 5: Commit**

```bash
git add docs/parity/viewport-audit-2.md SLICES.md docs/parity/component-audit.md
git commit -m "docs(viewport-audit): parity note + SLICES check-7 status (task 6)"
```

---

## Self-Review

**1. Spec coverage.** Spec §2 route set → Task 1 (table with all 74 paths, coverage-locked by test). §3 groups → Task 1 (`group` field carries static/live-id/expanded/skip; wallet-gated routes are ordinary static entries, since the locked prompt is what renders). §4 four assertions → Task 2 (A1–A4) and Task 3 (`measureInPage`), including the two recorded-not-failing signals (`clippedText`, `viewportMeta`). §5 verdict schema → Task 2 (`classify`, `shouldShot`), Task 3 (`Report`). §6 workflow → Tasks 4, 5, 6. §7 out-of-scope → stated in Task 6 Step 2. §8 honesty rules → Task 1's skip-reason test, Task 4 Step 4, Task 6 Step 2.

**2. Placeholder scan.** No TBD/TODO. Task 5 is deliberately method-shaped rather than fix-shaped — the fixes cannot be written before the sweep, and the plan says so explicitly instead of pretending otherwise.

**3. Type consistency.** `Metrics` is documented once in the script header and referenced identically by `classify` (Task 2) and `measureInPage` (Task 3). `classify(m, width)` returns `{verdict, fails, notes}` and `sweep` writes `verdict.verdict`, `verdict.fails`, `verdict.notes` into the report consistently. `shouldShot(hash, verdict)` is called with the same `hash` string the report stores. `expandRoutes()` returns `{hash, group}` and Task 3's filter reads `.hash`. `routerPaths()` is used by the test only, by design — the runner sweeps `expandRoutes()`.

**Known limitation, recorded honestly:** the A2 touch-floor check flags controls below 44px in both dimensions. Some are legitimately small (an inline text link inside a paragraph is not a touch target by intent). Task 5 must judge each hit rather than blanket-raising every one — a blanket `min-height:44px` on all `a` elements would wreck prose layout. The punchlist's severity ordering puts A2 last for exactly this reason.