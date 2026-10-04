# Parity Note — Principle #10 + 11-Language Program

Date: 2026-10-04 (AFK build, owner pre-approved spec + MT+audit loop).
Specs: `docs/superpowers/specs/2026-10-04-multilingual-design.md`,
`docs/superpowers/plans/2026-10-04-i18n-wave1.md`.

## 1. Reference behavior

- #1: `reference/bitshares-ui/app/assets/locales/` (de/es/fr/it/ja/ko/ru/tr/zh)
  used as term precedent by auditors (B1#1 pattern); astro-ui dicts as second
  opinion (pt). No behavior ported — terms only.
- #2/#3/#4: N/A (no dialogs, signing, or chain calls in this program).

## 2. Vanilla implementation (selected file:lines)

- `AGENTS.md`: principle #10 + §3.9 elaboration ("nine"→"ten", §11 pointer).
- `vanilla/js/i18n.js:19-23`: 12 CODES + NAMES (hi हिन्दी, pt Português).
- Plumbing: `settings-prefs.js:94-99` (stubCodes, now `[]`),
  `build_locale_dicts.py:32`, `check_i18n.py:29` (+ full-dict branch),
  `sync_locale_keys.py`, `merge_i18n_frags.py`, `i18n_add_keys.py`,
  `collect_i18n_orphans.py`, `sync_prediction_portfolio_i18n.py:53`,
  `asset-holders-test.js:106`.
- Sweep: `find_unkeyed_strings.py` (now reports 0), `merge_sweep_keys.py`
  (67 keys), 136 literals keyed across 39 view files (7 workers).
- Merge/audit: `merge_translations.py` (+ `--overlay`, `EXCEPT_EMPTY`),
  `validate_translations.py` (+ `EXCEPT_EMPTY`), `apply_audit_patch.py`.
- Locales: 12 dicts × 3497 keys; hi.json + pt.json created.

## 3. Test steps + observed results

- `check_i18n.py`: OK (12 dicts, 3497 keys, 4287 call sites drift-free).
- `check_rot.py` PASS; `check_types.sh` PASS; node suites green
  (menu 24, help 138, app-shell 11, bitshares-uri 77, es-lab-ui 10).
- `validate_translations.py <lang>` green for all 11 (placeholders,
  identifiers, non-empty, _meta).
- `find_unkeyed_strings.py`: TOTAL UNKEYED 0 in 0 files.
- Waves: 6 priority (ru/zh/hi/ko/ja/tr) + 5 (fr/de/it/pt/es-overlay)
  merged per-language commits; 11/11 auditors delivered patches
  (ru72/zh78/hi375/ko121/ja199/tr146/fr112/de157/it143/pt67/es28 +
  viewing×11); all applied validator-green.
- Concurrent-session note: a parallel view-as session landed
  `viewing-as.js` + 12 viewing keys mid-program; its English viewing copies
  were translated by the dedicated viewing worker; a pre-existing rot-gate
  trip (literal `globals.d.ts` in a comment) was fixed the same way.
- Human browser pass (tester): OPEN — all 12 locales need an in-app
  language-switch read-through.

## 4. Vectors (#6)

No chain numbers (locale JSON only). Counts asserted mechanically:
3485→3497 keys (67 sweep + 12 viewing + 19 about + community/help/help-split
keys across the program); per-language chunk totals verified pre-merge;
single-home sitemap 53 (menu-test 24 asserts).

## 5. Themes + viewports

N/A beyond existing coverage — this program adds no DOM/CSS (one footer link
and locale plumbing reuse verified classes; about shots in `about.md`).

## 6. Readability (§3.7)

New scripts carry headers/usage/contracts; no TODO/FIXME (the two
`EXCEPT_EMPTY` tables are documented exceptions, not TODOs). Translator
glossaries live in commit messages + auditor reports (working notes — the
_dictionaries_ are the durable record).

## 7. Anti-rot (§4.5)

(a) JSON + docs only — nothing to expire. (b) No dependency/transport added
(MT happened via subagents, not an API). (c) Deletable: any locale file
deletes cleanly (per-key en fallback). Known follow-ups (NOT deferred
silently): EN-plural `"s"` concatenation in instant-trade (breaks Hindi/
Japanese/Korean plurals), vote multi-part sentence splits, gendered
fragments (FR/IT/ES/RU) — all flagged by translators/auditors for a future
i18n-engineering pass; Russian plural classes (1/2-4/5+) likewise.
