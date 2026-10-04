# Parity Note — Headings Burger + Sitemap TOC + Help Coverage

Date: 2026-10-03 (AFK build, owner pre-approved spec + plan).
Spec: `docs/superpowers/specs/2026-10-03-menu-sitemap-design.md`.
Plan: `docs/superpowers/plans/2026-10-03-menu-sitemap.md` (7 tasks, all done).

## 1. Reference behavior

- #1 header/bar + burger split: `reference/bitshares-ui/app/components/Layout/MenuDataStructure.js:66-75`
  (dashboard/market/lending/explorer + poolmart `inHeader`), `:66-152` (same
  areas spread across header + burger dropdown), `:182-299` (nav icon names),
  `:477-489` (hamburger glyph), `Header.jsx:663-681` (lock affordance),
  `Header.jsx:399` (logo height 40). Vanilla keeps the 5-link bar and the
  lock/header behavior; the 46-link burger directory it grew is replaced by
  6 headings (no #1 equivalent — #1 never had TOC pages; this is a vanilla
  navigability improvement, styling unchanged).
- #2 (astro-ui): N/A — dialog-based, no burger/sitemap pattern to port.
- #3 (wallet-extension): N/A for nav; its `popup.js` 78-op table remains the
  confirm-wording spec (untouched by this slice).
- #4 (bitshares-core): N/A — no chain calls in this slice (nav + docs only).

## 2. Vanilla implementation

- `vanilla/js/views/menu-ui.js` (new): `MenuUI.SECTIONS` sitemap table
  (6 sections, 51 links), `renderMenu` (#/menu), `renderSection` (#/menu/:section
  + honest unknown-slug miss), shared card-grid + substring filter.
- `vanilla/js/router.js`: `/menu` + `/menu/:section` routes (placeholder
  fallback when MenuUI absent).
- `vanilla/js/app.js`: `NAV_GROUPS` → `FALLBACK_SECTIONS`;
  `buildDirectory` renders 7 links (6 `MenuUI.SECTIONS` headings with counts
  + `#/menu` overview, label-only fallback); deleted `buildAccountActions`,
  `CONTACTS_KEY`/`loadContacts`/`saveContacts`/`hashAccount`,
  directory search/filter DOM, burger filter-focus; `navText` trimmed to the
  5 bar hrefs (net −231/+115 with the account move).
- `vanilla/js/views/account-ui.js`: follow/unfollow moved to `showAccount`
  (same `bts-vanilla-contacts-v1` key proposal-ui.js:383 reads — key
  byte-identical); plus a one-line comment reword (see §7).
- `vanilla/css/app.css`: dead `.nav-dir-*` classes replaced by
  `.menu-grid/.menu-card/.menu-filter/.menu-crumb` on existing theme tokens;
  candy + reduced-motion lists updated (no new tokens).
- `vanilla/js/views/help-ui.js`: 12 new TOPICS + bodies
  (samet/barter/spotlight/direct-debit/api-lab/es-lab/charts/dashboard/
  register/password/news/uris), `topops` + `history-index` bodies extended,
  index regrouped under `GROUPS` (same 6 headings), `_test.topicBody/GROUPS`
  seams. 61 topics, all unique.
- `vanilla/js/globals.d.ts`: `declare var MenuUI: any;` (type-gate seam).
- `vanilla/index.html`: one script tag (`menu-ui.js` before `router.js`).
- Locales: `menu` section (121 keys) + `account.follow/unfollow` +
  61×3 help keys in all 10 dicts (en full, 9 stubs English-identical);
  en `_meta.translated` synced (sorted). Side find: 17 hyphenated topics
  (accounts-*, assets-*, gateways-*, dex-*, borrow-extra, history-index,
  direct-debit, api-lab, es-lab) never had dict keys (dynamic `t()` keys
  escape the regex gate) — they were English-only by construction and are
  now keyed like everything else.
- Tests: `tooling/menu-test.js` (22 asserts: 6 sections, 51 links,
  single-home invariant), `tooling/help-test.js` (138 asserts: 61 topics,
  bodies, group coverage), `tooling/apply_i18n_menu_batch.py` (JS-sourced
  batch applier, idempotent).

## 3. Manual test steps + observed result (headless Chromium, 2026-10-03)

Server: `python3 -m http.server 8081 --directory vanilla`.
All shots with zero console errors (`shot.mjs` reports `consoleErrors:[]`).

- `#/menu` @1440 → 6 section cards with counts/icons/blurbs
  (`menu-overview-1440.png`); @390 → single column (`menu-overview-390.png`).
- `#/menu/earn` @1440 → breadcrumb + 7 cards (`menu-earn-1440.png`);
  `#/menu/trade` @390 → single column (`menu-trade-390.png`).
- Burger (in-page click via `eval-once.mjs`): `#nav.open=true`, 7 links
  (`#/menu/wallet…/labs`, `#/menu`), no errors.
- Filter (`#/menu/earn`, type "htlc"): 7→1 visible card, no errors.
- Follow (`#/account/committee-account`, testnet): h1 `committee-account`,
  `Follow committee-account` button renders (live chain resolve), no errors.
- `#/help` @1440 grouped index (`help-index-1440.png`); `#/help/samet`
  renders the new article (`help-samet-1440.png`).
- Human browser pass (tester): OPEN — burger at 360px + desktop, theme trio
  feel, account follow toggle on a real wallet.

## 4. Test vectors (principle #6)

No chain integers appear on any new page (nav + docs only — no Format vectors
apply). Arithmetic asserted in code, not by eye:

- Sitemap: 14+9+7+4+9+8 = 51 links, each href listed exactly once
  (`menu-test.js`: `new Set(all).size === all.length`).
- Help: 61 topics, unique keys, every key with a non-empty body and exactly
  one group (`help-test.js`, 138 asserts green).
- i18n: `check_i18n.py` OK — 3392 keys, 4089 call sites drift-free.

## 5. Theme + viewport checks

- Trio: `menu-overview-1440.png` (ref-ui), `menu-vanilla-1440.png`
  (vanilla light — cream, readable), `menu-dex-1440.png` (dex dark — readable).
- Phone: `menu-overview-390.png`, `menu-trade-390.png` — single column,
  ≥44px targets, no hover-dependent UI. Desktop 5-link bar unchanged in all
  shots. Filter input uses `type="search"` (phone keyboard with clear).

## 6. Readability (§3.7)

- New files open with module headers (owns/consumes/side-effects/skill+plan).
  Every function has what/params/fails descriptions. No TODO/FIXME markers
  in shipped files (grepped). Dead CSS classes deleted with their JS
  (`.nav-dir-*` gone from both). `FALLBACK_SECTIONS` keeps the burger
  honest when menu-ui.js is missing (never blank).

## 7. Anti-rot gate (AGENTS.md §4.5)

- (a) 2036 test: plain DOM + hash links + CSS grid; no dependency, no
  transport, no hosted asset. Yes.
- (b) Newly depended on: nothing. `MenuUI.SECTIONS` is consumed guarded with
  a label-only fallback; icons are decorative `Icon.img` with text fallback.
- (c) Smallest deletable subset: the `#/menu` overview could go (section
  pages stand alone) — kept as the sitemap front door. Net code change is
  negative (~−230/+140 excl. locales/help bodies).
- `tooling/check_rot.py`: PASS. Found + fixed a PRE-EXISTING violation on the
  way (account-ui.js:1571 comment contained the literal `globals.d.ts`,
  which the gate's self-policing probe matches — reworded to "ambient
  declarations file", zero behavior change).
- `bash tooling/check_types.sh`: PASS (after adding the `MenuUI` ambient line
  + one `string[]` cast in help-ui.js).
- `node tooling/menu-test.js` (22) + `help-test.js` (138) +
  `app-shell-test.js` (11): all green.
