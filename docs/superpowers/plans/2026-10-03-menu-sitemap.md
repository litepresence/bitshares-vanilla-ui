# Menu Sitemap (headings burger + TOC pages + 12 help articles) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 46-link burger directory with 6 heading links, add `#/menu` + `#/menu/:section` styled TOC card pages covering every route exactly once, and add 12 missing help articles with the index regrouped under the same 6 headings.

**Architecture:** New DOM-only view `vanilla/js/views/menu-ui.js` owns the `MenuUI.SECTIONS` data table (single source; `app.js` burger consumes it guarded). Two router entries, one script tag, CSS card classes on existing theme tokens, locale keys in the existing nested-`en.json` pattern, help topics in the existing TOPICS+BODY_DEFAULTS pattern.

**Tech Stack:** Plain HTML/CSS/JS, no dependencies, no build step. Node stdlib only for tests (`node tooling/menu-test.js`).

## Global Constraints

- Static only: `python3 -m http.server` serves a working app; no `package.json`/`node_modules`/CDN in `vanilla/`.
- Never edit anything under `/workspace/reference/` (read-only).
- Never use binary float for money — N/A here (page counts only, no chain numbers on these pages).
- Every user-visible string via `I18n.t`/`t()` with verbatim English default (slice-17 batch pattern); new keys in `en.json` full, 9 stubs get English fallback entries.
- Touch targets ≥44px; no hover-only UI; 1-col @360px → 2-col @≥720px → 3-col @≥1200px; `prefers-reduced-motion` respected (no animation on these pages).
- CSP `script-src 'self'` — no inline scripts; new view loads via `<script src>` tag.
- Desktop 5-link header bar UNTOUCHED.

---

### Task 1: `menu-ui.js` — SECTIONS data + pure helpers + renderers

**Files:**
- Create: `vanilla/js/views/menu-ui.js`
- Create: `tooling/menu-test.js`

**Interfaces:**
- Consumes: `Icon.img(name, cls, alt)` when present (guarded), `I18n.t` via local `t()` fallback (same shape as help-ui.js:29-37).
- Produces: `MenuUI.renderMenu(root)`, `MenuUI.renderSection(root, slug)`, `MenuUI.SECTIONS` (array of `{slug, icon, titleKey, titleDefault, blurbKey, blurbDefault, links: [{href, icon, titleKey, titleDefault, blurbKey, blurbDefault}]}`), `MenuUI._test = {sectionSlugs, findSection}`.

**Section slugs (binding):** `wallet`, `trade`, `earn`, `govern`, `explore`, `labs`. Section icons (existing KNOWN names only): wallet→`wallet`, trade→`trade`, earn→`dollar`, govern→`voting`, explore→`server`, labs→`cogs`.

**Link table (binding, href → section):**
- wallet: `#/` (Dashboard), `#/account/me`, `#/accounts`, `#/transfer`, `#/invoice`, `#/vesting`, `#/wallet`, `#/wallet/password`, `#/create-wallet-brainkey`, `#/existing-account`, `#/create-account`, `#/login`, `#/registration`, `#/referrals`
- trade: `#/market/BTS_USD`, `#/instant-trade`, `#/pools`, `#/swap`, `#/borrow`, `#/barter`, `#/deposit-withdraw`, `#/samet`, `#/spotlight`
- earn: `#/credit-offer`, `#/direct-debit`, `#/htlc`, `#/tickets`, `#/airdrop`, `#/authorities`, `#/lists`
- govern: `#/voting`, `#/proposals`, `#/create-worker`, `#/prediction`
- explore: `#/explorer`, `#/assets`, `#/assets/create`, `#/assets/issue`, `#/assets/feed`, `#/fees`, `#/ops`, `#/top-ops`, `#/news`
- labs: `#/api-lab`, `#/es-lab`, `#/txbuilder`, `#/trollbox`, `#/favourites`, `#/alerts`, `#/help`, `#/settings`

- [ ] **Step 1: Write the failing test** — create `tooling/menu-test.js`:

```js
/* menu-test.js — sitemap single-home invariant + MenuUI pure helpers.
 * Stdlib only: `node tooling/menu-test.js` (exit 0 = green). No DOM, no network.
 */
"use strict";
var assert = require("assert");
global.Icon = undefined;
global.I18n = { t: function (k, d) { return d; } };
var MenuUI = require("../vanilla/js/views/menu-ui.js");
var passed = 0;
function eq(a, e, n) { assert.strictEqual(a, e, n + " (got " + JSON.stringify(a) + ")"); passed++; }
function ok(c, n) { assert.ok(c, n); passed++; }
eq(MenuUI.SECTIONS.length, 6, "six sections");
eq(MenuUI._test.sectionSlugs().join(","), "wallet,trade,earn,govern,explore,labs", "slug order");
var all = [];
MenuUI.SECTIONS.forEach(function (s) { s.links.forEach(function (l) { all.push(l.href); }); });
eq(all.length, 51, "51 listed pages");
eq(new Set(all).size, all.length, "no href listed twice (single-home)");
["#/", "#/transfer", "#/market/BTS_USD", "#/samet", "#/barter", "#/spotlight",
 "#/direct-debit", "#/api-lab", "#/es-lab", "#/txbuilder", "#/ops", "#/top-ops",
 "#/registration", "#/voting", "#/fees", "#/news"].forEach(function (h) {
  ok(all.indexOf(h) !== -1, h + " listed");
});
eq(MenuUI._test.findSection("earn").links.length, 7, "earn has 7 links");
eq(MenuUI._test.findSection("nope"), null, "unknown slug is null");
console.log("menu-test: " + passed + " passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/menu-test.js`
Expected: FAIL with "Cannot find module '../vanilla/js/views/menu-ui.js'"

- [ ] **Step 3: Write minimal implementation** — create `vanilla/js/views/menu-ui.js` with module header (what it owns/consumes/side effects/skill+plan refs), `t()` fallback, `SECTIONS` table exactly as above (each link: href + icon from KNOWN names + `menu.p_<slug>` title/blurb keys with verbatim English defaults), `el()`/`clearRoot()`/`makeWrap()` (same textContent-only pattern as help-ui.js:599-607), `renderMenu(root)` (h1 + global search input + 6 section cards linking `#/menu/<slug>`), `renderSection(root, slug)` (breadcrumb `Menu / <Title>`, h1, section filter input, link cards; unknown slug → honest miss + link to `#/menu`), card filter handler (substring over title+blurb+href, min-height 44px on interactive elements via CSS class `menu-card`), `_test` hooks, classic-script global + `module.exports` guard (same as help-ui.js:781 pattern).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/menu-test.js`
Expected: PASS with "menu-test: N passed"

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/menu-ui.js tooling/menu-test.js
git commit -m "feat(menu): SECTIONS sitemap table + card renderers + single-home test"
```

### Task 2: Router + script wiring

**Files:**
- Modify: `vanilla/js/router.js` (routes array)
- Modify: `vanilla/index.html` (script tag)

**Interfaces:**
- Consumes: `MenuUI.renderMenu/renderSection` from Task 1 (guarded — falls back to `placeholder("Menu")` when absent, same pattern as router.js renderSettings).
- Produces: working `#/menu` and `#/menu/:section` hashes.

- [ ] **Step 1: Add routes** — in `vanilla/js/router.js`, insert before the `"*"` catch-all:

```js
{ path: "/menu", title: "Menu", render: function (root) {
  if (typeof MenuUI !== "undefined" && MenuUI && typeof MenuUI.renderMenu === "function") { MenuUI.renderMenu(root); return; }
  placeholder("Menu")(root);
} },
{ path: "/menu/:section", title: "Menu", render: function (root, params) {
  if (typeof MenuUI !== "undefined" && MenuUI && typeof MenuUI.renderSection === "function") { MenuUI.renderSection(root, params && params.section); return; }
  placeholder("Menu")(root);
} },
```

- [ ] **Step 2: Add script tag** — in `vanilla/index.html`, insert `<script src="js/views/menu-ui.js"></script>` immediately before the `<script src="js/router.js">` line (menu-ui must load before router renders; no other ordering constraint).

- [ ] **Step 3: Smoke-test routes**

Run: `node -e "var R=require('./vanilla/js/router.js'); var m=R.match('/menu'); console.log(m&&m.route.title); var s=R.match('/menu/earn'); console.log(s&&s.route.title, JSON.stringify(s.params));"`
Expected: `Menu` then `Menu {"section":"earn"}`

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/router.js vanilla/index.html
git commit -m "feat(menu): /menu + /menu/:section routes with placeholder fallback"
```

### Task 3: Burger rework in `app.js`

**Files:**
- Modify: `vanilla/js/app.js`
- Modify: `tooling/app-shell-test.js` (add burger-data assertions if pure helpers added; otherwise unchanged)

**Interfaces:**
- Consumes: `MenuUI.SECTIONS` when present (guarded `typeof MenuUI !== "undefined"`), else 6 label-only fallback headings.
- Produces: `#nav-directory` panel containing exactly 7 links (6 section + `#/menu` overview).

- [ ] **Step 1: Replace `NAV_GROUPS` + `buildDirectory`** — delete `NAV_GROUPS`, `buildNavLink`'s directory use stays for the bar only, `buildDirectory` search/filter/empty-note DOM, `buildAccountActions`, `closeDirectory`'s filter-focus (keep Esc/hashchange close + focus-return). New `buildDirectory()`: takes no iconOK beyond headings; renders `<a href="#/menu">All pages</a>` + one `<a href="#/menu/<slug>">` per section (icon via `Icon.img` when available + label span, same decorative pattern). Fallback slugs `["wallet","trade","earn","govern","explore","labs"]` with English labels when `MenuUI` absent.

- [ ] **Step 2: Move or delete account helpers** — grep callers of `loadContacts`/`saveContacts`/`hashAccount`: if the only caller was `buildAccountActions`, delete all three + `CONTACTS_KEY`; if account-ui.js (or another view) uses them, move verbatim with header comment. No commented-out code remains.

- [ ] **Step 3: Run existing tests**

Run: `node tooling/app-shell-test.js && node tooling/menu-test.js`
Expected: both PASS

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/app.js tooling/app-shell-test.js
git commit -m "feat(menu): burger shrinks to 6 sitemap headings + overview (~200 lines deleted)"
```

### Task 4: TOC card styles in `app.css`

**Files:**
- Modify: `vanilla/css/app.css`

- [ ] **Step 1: Add menu classes** — append (near the help-index styles):

```css
.menu-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 720px) { .menu-grid { grid-template-columns: 1fr 1fr; } }
@media (min-width: 1200px) { .menu-grid { grid-template-columns: 1fr 1fr 1fr; } }
.menu-card { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; min-height: 44px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); text-decoration: none; }
.menu-card:hover { background: var(--bg); }
.menu-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.menu-card .nav-icon { width: 22px; height: 22px; flex: none; }
.menu-card b { display: block; }
.menu-card small { display: block; opacity: 0.85; }
.menu-filter { width: 100%; max-width: 420px; min-height: 44px; margin: 0 0 12px; }
.menu-crumb { margin: 0 0 4px; }
```

Verify every `var(--…)` token already exists in `css/themes.css` (grep); if any is missing, reuse the closest existing token instead of adding one.

- [ ] **Step 2: Commit**

```bash
git add vanilla/css/app.css
git commit -m "style(menu): responsive card grid on theme tokens, 44px targets"
```

### Task 5: Locale keys (`en.json` full + 9 stubs)

**Files:**
- Modify: `vanilla/locales/en.json` (+ `es/fr/it/ja/ko/ru/tr/zh/de.json` — whichever 9 stub files exist)
- Test: `python3 tooling/check_i18n.py` (run; fix drift it reports for touched keys)

- [ ] **Step 1: Add `menu` section to en.json** — nested pattern: `"menu": {"section_wallet": "Wallet", "blurb_wallet": "…", "p_dashboard": "Dashboard", "d_dashboard": "…", …}` for all 6 sections + 51 pages (title + one-line blurb each; blurbs reuse the design-spec wording). Add `help` keys for the 12 new topics (`help.topic_<key>_title/_text/_body` following the existing nested shape).

- [ ] **Step 2: Stub dicts** — add the same keys with English values to the 9 non-en files (slice-17 stub precedent: English-identical until translators arrive).

- [ ] **Step 3: Run drift gate**

Run: `python3 tooling/check_i18n.py`
Expected: no NEW drift for `menu.*` / new `help.topic_*` keys (pre-existing drift, if any, left untouched and noted in commit message).

- [ ] **Step 4: Commit**

```bash
git add vanilla/locales/
git commit -m "i18n(menu+help): 6 sections + 51 pages + 12 topics keyed (en full, 9 stubs)"
```

### Task 6: 12 help articles + regrouped index

**Files:**
- Modify: `vanilla/js/views/help-ui.js`
- Extend: `tooling/menu-test.js` or new `tooling/help-test.js` (assert 59 topics, no duplicate keys)

**Interfaces:**
- Consumes: nothing new. Produces: `HelpUI.TOPICS` with 59 entries; bodies in `BODY_DEFAULTS`.

- [ ] **Step 1: Add TOPICS rows** (key, title, guide, route): `samet` (Same-T Funds, `#/samet`), `barter` (Barter, `#/barter`), `spotlight` (Spotlight, `#/spotlight`), `direct-debit` (Direct Debit, `#/direct-debit`), `api-lab` (API Lab, `#/api-lab`), `es-lab` (ES Lab, `#/es-lab`), `charts` (Charts & indicators, `#/market/BTS_USD`), `dashboard` (Dashboard, `#/`), `register` (Creating an account, `#/create-account`), `password` (Changing the wallet password, `#/wallet/password`), `news` (News, `#/news`), `uris` (Payment requests & exports, `#/invoice`).

- [ ] **Step 2: Add bodies** — 4–8 lite-markdown lines each (`# ` headings, `- ` bullets, textContent-safe, no HTML), behavior-accurate: samet (denom 1M, same-tx rule), barter (PROPOSE flow), spotlight/debit (op families + claim/update/delete), api-lab (29-method prober, read-only vs broadcast), es-lab (allowlisted indexes, esEnabled gate, mainnet-only), charts (25-indicator catalog, interpolated candles, stacked panes), dashboard (locked splash vs unlocked overview), register (testnet faucet alive `testnet-faucet.xbts.io`, EU faucet dead), password (re-encrypt, verify unlock after), news (deferred feed — honest state), uris (bitshares:// links, CSV export). Update `topops` body with one line naming both `#/ops` and `#/top-ops`; `history-index` body with one paragraph pointing at `#/es-lab`.

- [ ] **Step 3: Regroup index** — `paintIndexList` renders the same links under 6 `<h2>` subheads (Wallet/Trade/Earn & Protect/Govern/Explore/Labs & Personal) mapping each topic key to its sitemap section; unknown future keys fall into a trailing "More" group (never dropped).

- [ ] **Step 4: Run tests**

Run: `node tooling/menu-test.js` (and help-test if created)
Expected: PASS, 59 topics, no duplicate keys

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/help-ui.js tooling/
git commit -m "docs(help): 12 new articles + index regrouped under sitemap headings"
```

### Task 7: Verification + parity note + audit

**Files:**
- Create: `vanilla/notes/menu-sitemap.md` (parity note per contract)
- Create screenshots (tester or `tooling/visual/shot.mjs` if chromium available)

- [ ] **Step 1: Rot gate**

Run: `python3 tooling/check_rot.py`
Expected: PASS

- [ ] **Step 2: Type gate**

Run: `bash tooling/check_types.sh`
Expected: PASS (annotate JSDoc seams if new errors appear; never weaken the gate)

- [ ] **Step 3: Node tests**

Run: `node tooling/menu-test.js && node tooling/app-shell-test.js`
Expected: all PASS

- [ ] **Step 4: Browser pass** — burger shows 6 headings + overview at 360px and 1440px; each heading navigates; filters narrow cards; theme trio (ref-ui/vanilla/dex-ux) + phone + desktop shots; desktop 5-link bar unchanged; help index shows 6 groups with 59 topics; 12 new articles render.

- [ ] **Step 5: Parity note** — `vanilla/notes/menu-sitemap.md` with all 7 contract fields (field 4: no chain numbers on these pages — record the page-count arithmetic 14+9+7+4+9+8=51 + overview; field 1 cites `app.js` NAV_GROUPS lines + `router.js` routes + help-ui TOPICS).

- [ ] **Step 6: Commit**

```bash
git add vanilla/notes/menu-sitemap.md
git commit -m "docs(menu): parity note (burger+TOC+help, browser items as noted)"
```

## Self-Review

- [x] Spec coverage: §3 sitemap → Task 1 table (51 hrefs asserted); §4 burger → Task 3; §5 styling → Task 4; §6 help → Tasks 5–6; §9 verification → Task 7.
- [x] Placeholder scan: no TBD/TODO/vague steps; every code step shows the code; every run step states expected output.
- [x] Type consistency: `MenuUI.renderMenu/renderSection/SECTIONS/_test.{sectionSlugs,hrefsFor?,findSection}` — test uses `sectionSlugs` + `findSection` only; `hrefsFor` dropped from the interface (iteration is via SECTIONS directly). Fixed before saving.
