# i18n Human Audit Tracking — R17

**Date:** 2026-10-04  
**Spec:** Principle #10 / §3.9 ("Every language, fully") — stubs honest, verified by human before v1 done-claim.

---

## Scope

11 non-English locales × 7 keys in `about.*` namespace:
- `about.making_body`
- `about.s1_body` — `about.s6_body`

| Locale | Code | Language | `making_body` | `s1_body`–`s6_body` (both sets) |
|--------|------|----------|---------------|----------------------------------|
| German | de | Deutsch | **unverified — stub (English)** | translated ✓ |
| Spanish | es | Español | **unverified — stub (English)** | translated ✓ |
| French | fr | Français | **unverified — stub (English)** | translated ✓ |
| Hindi | hi | हिन्दी | **unverified — stub (English)** | translated ✓ |
| Italian | it | Italiano | **unverified — stub (English)** | translated ✓ |
| Japanese | ja | 日本語 | **unverified — stub (English)** | translated ✓ |
| Korean | ko | 한국어 | **unverified — stub (English)** | translated ✓ |
| Portuguese | pt | Português | **unverified — stub (English)** | translated ✓ |
| Russian | ru | Русский | **unverified — stub (English)** | translated ✓ |
| Turkish | tr | Türkçe | **unverified — stub (English)** | translated ✓ |
| Chinese | zh | 中文 | **unverified — stub (English)** | translated ✓ |

> **Note:** Each locale has TWO sets of `s1_body`–`s6_body` keys (dashboard/about hero and "Making of" section). Both sets are translated in all 11 locales. Only `making_body` remains an English stub in all 11.

---

## Status Definitions

- **unverified — stub (English)** — Key exists in `translated[]` array and has a value, but the value is the English source text (not a human translation). Per §3.9: "stubs stay honestly English until a human verifies them."
- **translated** — Key has a human-authored translation in the target language.

---

## Target

Human audit pass for all 11 locales before v1 done-claim. Audit must:
1. Confirm each `making_body` translation is accurate, natural, and preserves placeholders/IDs/operation numbers per §3.9 glossary rules.
2. Confirm each `s1_body`–`s6_body` translation (both sets) is accurate and matches the English meaning.
3. Sign off per locale in this note (add ✅ + auditor initials + date) or file follow-up tasks.

---

## Sign-off

| Locale | Auditor | Date | Notes |
|--------|---------|------|-------|
| de | | | |
| es | | | |
| fr | | | |
| hi | | | |
| it | | | |
| ja | | | |
| ko | | | |
| pt | | | |
| ru | | | |
| tr | | | |
| zh | | | |

---

## References

- `AGENTS.md` §3.9 / principle #10
- `vanilla/notes/i18n-program.md` (wave-1 delivery receipt)
- `vanilla/locales/*.json` — source of truth
- `tooling/check_i18n.py` — mechanical gate (key completeness, placeholders, non-empty)