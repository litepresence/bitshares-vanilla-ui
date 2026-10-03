# Help/Community Split — Design

Date: 2026-10-04. Status: APPROVED (owner, one-click: "Approved, build it").
Scope: tiny — split one page, rewire one footer link. No chain calls, no
crypto, no new transport. Process note: no separate writing-plans doc for
this change — the 8-step build list below IS the plan (too small to split;
deviation from the brainstorming terminal state recorded here by owner
approval, not by omission).

## 1. Goal

`#/help` becomes docs-only (topics + Documentation + AI help). The community
link directory moves to a new `#/community` page. Footer REPORT links
internally to `#/community` (no more `t.me` deep link); HELP keeps `#/help`.

## 2. Decisions

- Approach A (top-level `#/community`): clean URL, no wildcard carve-out.
  Rejected B (`#/help/community`): the `/help/**` handler treats every suffix
  as a topic key — would need special-casing and muddies the sitemap.
- `renderCommunity` lives in help-ui.js next to `renderHelp` (same
  textContent-only external-link pattern, `target _blank` + `noopener`).
- `#/help` index gains a one-line pointer to `#/community` (new keys
  `help.community_hint` + link; the directory itself moves, not copies).
- Footer: `index.html` REPORT href → `#/community`, drop `target`/`rel`;
  `paintFootActions` comment updated (no longer external). Label stays REPORT.
- Sitemap: Labs & Personal gains the Community card → 52 links
  (`menu-test.js` 51→52 + `#/community` in the spot-check list).
- Locales: `menu.p_community`/`menu.d_community` (auto-extracted from
  SECTIONS) + `help.community_title`/`help.community_intro`/
  `help.community_hint` (batch script extended with an explicit EXTRA map —
  regex only sweeps `menu.*`/`account.*`; topic extraction stays as-is).

## 3. Build list (the plan)

1. help-ui.js: move SECTIONS directory block out of `paintIndex` into
   `renderCommunity(root)` (h1 + intro + directory); slim index + hint link;
   export `renderCommunity`.
2. router.js: `/community` route (title "Community", placeholder fallback).
3. index.html: REPORT → `#/community`, drop `target`/`rel`.
4. app.js: `paintFootActions` comment (external → internal).
5. menu-ui.js: Labs links += Community card (icon `people`).
6. menu-test.js: 51→52 + `#/community` spot-check.
7. apply_i18n_menu_batch.py: EXTRA map for the 3 help keys; run batch.
8. Gates (rot, types, i18n) + node tests + headless shots (both pages,
   footer in frame) + parity addendum `vanilla/notes/help-split.md`.

## 4. Doctrine (AGENTS.md §4.5)

No exception: no dependency, no transport, no hosted asset. Page counts
51→52 are config arithmetic, not chain data (#6 holds trivially).

## Self-review

- No placeholders; every step names exact files/symbols.
- Consistent with the sitemap single-home rule (community listed once, in Labs).
- Unambiguous: REPORT keeps its label, only the target changes.
- Small enough for one implementation pass — no decomposition needed.
