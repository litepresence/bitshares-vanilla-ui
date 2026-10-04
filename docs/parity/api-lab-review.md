# Review — API Lab build (follow-up to `vanilla/notes/api-lab.md`)

Date: 2026-10-03. Reviewer: independent pass over the api-lab agent's work.
Scope: spec `docs/superpowers/specs/2026-10-03-api-lab-design.md` (Option B),
commits `7a6f1b4` (spec), `5868066` (build), `a845ba1` (note tweak).

Verdict: **solid work, ship-acceptable, with 4 findings below — none blocking,
all fixable in minutes.** The security architecture (curated catalog instead
of the old UI's `eval(js)` console, sole-socket chain path, broadcast
unlock+confirm) is correct and the parity note is unusually honest about what
is still PENDING. This document exists so the findings don't evaporate.

## What holds up (verified, not just claimed)

- #4 header refs spot-checked against the sparse checkout and match:
  `get_account_by_name database_api.hpp:326`,
  `get_required_fees database_api.hpp:1313`,
  `get_account_history api.hpp:89`.
- "No `debug_api` class exists" — confirmed present in neither `api.hpp`
  class list context the catalog cites; the login-probe design is the honest
  response.
- `node --check` passes on both new files (re-run during this review).
- The failing `check_rot.py` / `check_types.sh` gates are NOT this slice's
  dirt: rot flags long-pre-existing `vanilla/js/globals.d.ts` (in-tree for
  many commits before api-lab; dev-only, documented never-loaded), and type
  errors are all in untracked `vanilla/js/api/bitshares-uri.js`, a concurrent
  agent's file. The parity note discloses both correctly in substance.

## Findings

### F1. Shipped without i18n dict entries (minor — already cleaned up by someone else)

- Evidence: commit `5868066` touches 6 files, zero under `vanilla/locales/`,
  while `vanilla/js/views/api-lab-ui.js` calls `t("apilab.*", ...)` ~20 times
  (`api-lab-ui.js:76-79,134-148,172-179,204-208,276,291-301,372,403-427`).
- Impact: low — `t()` falls back to the verbatim English default (slice-17
  precedent), so nothing rendered broken. But a follow-up round had to
  backfill every key × 10 locales via `tooling/i18n_add_keys.py`, whose own
  comment reads "another session's api-lab feature shipped WITHOUT dict
  entries."
- Fix for next time: any slice that adds `I18n.t` keys ships the `en.json`
  entries (plus stubs) in the same commit. Runtime fallback is a safety net,
  not a workflow.

### F2. Default method selected by magic index (minor — still in-tree)

- Evidence: `vanilla/js/views/api-lab-ui.js:200`:
  `if (!startEntry) startEntry = ApiLab.METHODS[7]; /* get_account_by_name */`
- Impact: reordering `METHODS` in `vanilla/js/api/api-lab.js` silently changes
  the landing method. Catalog order is presentation order today; coupling the
  default to position 7 is one innocent-looking insertion away from a bug.
- Fix (~2 lines): `ApiLab.byMethod("get_account_by_name", "database") || ApiLab.METHODS[0]`.

### F3. `api-lab-ui.js` over the ~400-line split-candidate mark (accepted debt — track it)

- Evidence: 478 lines at commit; acknowledged in `vanilla/notes/api-lab.md:82-85`
  with reasoning (splitting desk state pre-browser-pass is untestable).
- No action now beyond what the note already does: the slice-18 readability
  pass must confirm this file got its split. Recording here so the debt has
  two pointers, not one.

### F4. Parity-note gate wording already drifting stale (nit)

- Evidence: `vanilla/notes/api-lab.md:91-96` describes the rot violation as
  "pre-existing uncommitted `account-ui.js` mentioning `globals.d.ts`"; the
  current `check_rot.py` output is `- js/globals.d.ts: loaded .d.ts would
  need a build step`. Substance matches (not our dirt), but the quoted
  symptom no longer matches the tool output, and the `check_types.sh` error
  count has moved as the tree changed underneath it.
- Fix: re-run both gates and refresh those two lines when the tester browser
  pass lands, in the same edit that records the pass.

## Still PENDING (not findings — already declared in the parity note)

- Human browser pass + theme trio + 360px/1440px viewport checks
  (`vanilla/notes/api-lab.md:58,72-75`).
- No broadcast ever fired (confirm path reviewed, not executed) — correct,
  do not "verify" this with a real broadcast without owner sign-off.

## Bottom line for the owning agent

F2 is yours to fix (two lines). F1 is already fixed by someone else — don't
repeat the pattern. F3 is slice-18's problem, already recorded. F4 refreshes
itself when the browser pass lands.

## Resolution (repair round, 2026-10-03, per owner order)

- **F1 — resolved, no action.** Verified: 25 `apilab.*` keys in `en.json`
  (+ stubs), `check_i18n` drift-free over 4123 call sites. Backfill held.
- **F2 — FIXED.** `api-lab-ui.js:200` now reads
  `ApiLab.byMethod("get_account_by_name", "database") || ApiLab.METHODS[0]`
  (key lookup, index fallback). Behavior-proofed headlessly (`byMethod`
  resolves `get_account_by_name`/`database`); `node --check` + `check_types`
  green.
- **F3 — open, still slice-18's.** Unchanged.
- **F4 — refreshed.** Gate symptom wording in `api-lab.md` §7(b) updated to
  current tool output (rot: dev-only `globals.d.ts` note; types: tree-wide
  PASS). Full refresh still rides with the tester browser pass.
