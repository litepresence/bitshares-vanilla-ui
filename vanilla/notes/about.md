# Parity Note — About Page (marketing-layered philosophy)

Date: 2026-10-04. Spec: `docs/superpowers/specs/2026-10-04-about-design.md`
(approach A, owner-approved). Static page — no chain, wallet, or crypto.

## 1. Reference behavior

No reference equivalent: #1 has no about page (its story lives in README +
blog). Content is drawn from this repo's own doctrine (AGENTS.md motto,
principles #1/#2/#4/#6/#9, §3.8 honesty bounds, §11 founding vision) —
marketing voice, repo-true claims. #2/#3/#4 N/A.

## 2. Vanilla implementation

- `vanilla/js/views/about-ui.js` (new): `AboutUI.renderAbout` — hero + 2 CTA
  cards + 6 philosophy blocks + honest-limits block + links row. Static DOM,
  textContent-only, `about.*` keys, zero chain/wallet/format contact.
  Styling reuses `.wrap/.menu-grid/.menu-card` (zero new CSS lines).
- `vanilla/js/router.js`: `/about` (title "About", placeholder fallback).
- `vanilla/index.html`: script tag + third footer link `#foot-about`.
- `vanilla/js/app.js`: `paintFootActions` paints ABOUT (`about.link`).
- `vanilla/js/views/menu-ui.js`: Labs += About card (53 links).
- `vanilla/js/globals.d.ts`: `AboutUI` ambient line (type gate).
- Locales: 19 `about.*` keys + `menu.p_about/d_about` in all 12 dicts.

## 3. Manual test steps + observed result (headless Chromium, 2026-10-04)

- `#/about` @1440 → hero, both CTAs, all 6 sections render
  (`about-1440.png`), zero console errors.
- `#/about` @390 → single column, stacked CTAs, footer REPORT/ABOUT/HELP
  all visible (`about-390.png`), zero console errors.
- Footer ABOUT navigates to `#/about` (seen in both shots).
- Human browser pass (tester): OPEN.

## 4. Vectors (#6)

No chain integers anywhere on the page (static copy + internal hash links
only). Sitemap arithmetic: 14+9+7+4+9+10 = 53, single-home asserted.

## 5. Themes + viewports

1440 + 390 verified in ref-ui-theme; component classes (`.menu-card`/grid)
are the same ones trio-verified in `menu-sitemap.md` across all three
themes — no new selectors, no new tokens.

## 6. Readability (§3.7)

Module header + per-function what/params/fails notes; no TODO/FIXME
(grepped). Copy bounds (§3.8) documented in the file header.

## 7. Anti-rot (§4.5)

(a) Static DOM + hash links — renders with the node down (which is the
pitch). (b) Nothing newly depended on. (c) Deletable: blocks 5–6 could go;
kept per the layered-audience approval. Gates: rot PASS, types PASS,
i18n OK, node suites green (see multilingual parity note for the full run).
