# Parity Addendum — Help/Community Split

Date: 2026-10-04. Spec: `docs/superpowers/specs/2026-10-04-help-community-split-design.md`
(approach A, owner-approved one-click). Follows `vanilla/notes/menu-sitemap.md`.

## 1. Reference behavior

No reference change: #1 has no community page (its help + external links live
in unrelated components). This split is vanilla information architecture:
docs vs people-and-places. #2/#3/#4 N/A (no dialogs, signing, or chain calls).

## 2. Vanilla implementation

- `vanilla/js/views/help-ui.js`: `paintIndex` keeps topics + Documentation +
  AI help and gains a Community hint link (`help.community_hint`);
  the link directory moves verbatim into `paintCommunityDir`, rendered by new
  `HelpUI.renderCommunity` (`#/community`, h1 + intro + directory + back link
  to `#/help`). External links keep `target _blank` + `noopener`,
  textContent-only (unchanged pattern).
- `vanilla/js/router.js`: `/community` route (title "Community", placeholder
  fallback when HelpUI absent — same shape as the `/menu` routes).
- `vanilla/index.html`: `#foot-report` href `https://t.me/bitsharesDEV` →
  `#/community`, `target`/`rel` dropped (internal now). Label stays REPORT.
- `vanilla/js/app.js`: `paintFootActions` comment updated (external → internal).
- `vanilla/js/views/menu-ui.js`: Labs & Personal gains the Community card
  (icon `people`, 52 links total; SECTIONS comment updated).
- Tests: `tooling/menu-test.js` 51→52 + `#/community` spot-check (23 green).
- Locales: `menu.p_community`/`menu.d_community` + `help.community_title`/
  `help.community_intro`/`help.community_hint` in all 10 dicts (batch script
  extended with an explicit EXTRA sweep for `help.community_*`; idempotent).

## 3. Manual test steps + observed result (headless Chromium, 2026-10-04)

- `#/community` @1440 → heading + intro + Homepage/Code/Explorers/Elastic/
  Forum sections (`community-1440.png`), zero console errors.
- `#/help` @1440 → topics only + hint link "Community" (`help-slim-1440.png`),
  zero console errors.
- In-page eval: `#foot-report` href `#/community`, no `target`; hint link
  present on `#/help`; zero console errors.
- Human browser pass (tester): OPEN.

## 4. Vectors (#6)

No chain integers on either page (docs + external links only). Count
arithmetic: sitemap 14+9+7+4+9+9 = 52, single-home asserted by `menu-test.js`.

## 5. Themes + viewports

Verified ref-ui-theme @1440 in shots; both pages reuse `.wrap`/token classes
already covered by the theme trio in `menu-sitemap.md` (no new CSS added —
this slice adds zero stylesheet lines).

## 6. Readability (§3.7)

`renderCommunity`/`paintCommunityDir` carry what/params/fails headers;
moved block re-indented to its function; no TODO/FIXME (grepped).

## 7. Anti-rot (§4.5)

(a) Plain DOM + hash route — 2036-safe. (b) Nothing newly depended on.
(c) Deletable subset: the `#/help` hint line could go (footer still links both
pages) — kept as wayfinding. Gates: `check_rot.py` PASS, `check_types.sh`
PASS, `check_i18n.py` OK (3397 keys, 4094 call sites), node suites green
(menu 23, help 138, app-shell 11, bitshares-uri 77, es-lab-ui 10).
