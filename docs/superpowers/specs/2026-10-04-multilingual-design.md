# Principle #10 (Multilingual) + 11-Language Translation Program — Design

Date: 2026-10-04. Status: APPROVED (owner: 6 priority languages + es/fr/de/it/pt).
Scope: AGENTS.md principle, hi+pt plumbing, unkeyed-string sweep, full
translation of 10 non-en dicts via subagent translators + subagent auditors.
Terminal state: every supported language fully translated AND audited.

## 1. Goal

Multilingual support becomes guiding principle #10 (`#10 — EVERY LANGUAGE,
FULLY`), and all 11 supported languages — en + de, es, fr, hi, it, ja, ko,
pt, ru, tr, zh — work comprehensively through the app: every display string
keyed, every dict fully translated, every translation audited.

## 2. Language set (binding)

en (master) + de, es, fr, hi, it, ja, ko, pt, ru, tr, zh. Priority for
translation waves: ru, zh, hi, ko, ja, tr first; es-remainder, fr, de, it,
pt second. hi + pt are NEW (plumbing + stubs first, same as the 2026-10-03
menu batch did for keys).

## 3. Translation doctrine (binding on all translators/auditors)

- Placeholders (`%(name)s`), URLs, object IDs (`1.2.x`), operation numbers,
  asset symbols, theme/network IDs, and the IDENTIFIERS list stay
  byte-verbatim — a translation that breaks a placeholder is a bug, not a
  translation. The merge validator rejects it mechanically.
- BitShares-term glossary shared by all translators (witness/committee/worker/
  proxy/brainkey/vesting/HTLC/swap/slate — fixed target-language terms, no
  per-translator improvisation).
- No machine-translation API: subagents translate (LLM first draft), DIFFERENT
  subagents audit + repair (placeholders, meaning drift, term consistency,
  tone). Two passes, two eyes — the owner's ordered loop.
- Honesty preserved: fully-translated dicts flip to `untranslated:false`
  with complete `translated` lists; anything still English stays OUT of the
  allowlist. `check_i18n.py` semantics already support this (the es path).

## 4. Phases

- Phase 0 (deterministic, no translation): principle #10 in AGENTS.md
  ("nine"→"ten", new §3.8→§3.9 ordering TBD at edit time, §11 pointer fix);
  hi+pt plumbing (i18n.js CODES/NAMES, builders, checkers, switcher text);
  hi.json + pt.json honest stubs; unkeyed-string sweep (measure, then key
  every display literal); merge-validator tooling.
- Phase 1 (parallel subagents): translate per language in section chunks,
  priority order above.
- Phase 2 (different subagents): audit + repair per language, re-verify.
- Gates every phase: `check_i18n.py`, `check_rot.py`, `check_types.sh`,
  node suites. Translator output merges ONLY through the validator.

## 5. Doctrine (§4.5)

No exception: locale JSON + docs. Translators add no dependency, transport,
or build step. Deletable subset: any language file deletes cleanly (loader
falls back to en per key — verified behavior, not new).

## Self-review

- No placeholders; scope explicit (11 languages named, priority ordered).
- Consistent: stub-honesty rules retained, just with 10 flipped dicts.
- Unambiguous: "comprehensive" = every display string keyed + every dict
  fully translated + audited (NOT "installer translated" — no installer;
  NOT "help articles only" — all 3418 keys).
- Decomposition: Phase 0 → Phase 1 → Phase 2, each shippable (tree stays
  green; untranslated keys remain honest English until their wave lands).
