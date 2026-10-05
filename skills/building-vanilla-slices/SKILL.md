---
name: building-vanilla-slices
description: Use when implementing a vertical slice of the vanilla BitShares UI (settings/nodes, wallet lifecycle, account view, transfer, DEX read/trade, or any feature slice), before writing implementation code
---

# Building Vanilla Slices

## Overview

One slice at a time: spec, implement, verify on testnet, record parity. A slice is not done until its parity note exists and the audit passes.

## When to Use

- Starting any vertical slice in `/workspace/vanilla/` (first slice: shell + settings/nodes)
- Extending an existing slice with new behavior

When NOT to use: pure inventory/mapping work with no new UI code (that is `mapping-chain-calls`); reviewing already-written code (that is `auditing-vanilla-slices`).

## Workflow

1. **Brainstorm the slice design** (REQUIRED: use the brainstorming skill). Present the design, get approval.
2. **Write the implementation plan** (REQUIRED: use the writing-plans skill). Keep the slice small enough to verify on testnet in one session. Any useful probe/audit script goes in `/workspace/tooling/` as a saved file — never inline-only (repo policy, AGENTS.md §7 rule 3).
3. **Map chain calls first** (REQUIRED: use `mapping-chain-calls`). No WS method or op field enters the code without a recorded source.
4. **Implement in `/workspace/vanilla/` only.** Static files, zero runtime deps. All money math goes through `vanilla/js/api/format.js` — never inline `amount / Math.pow(10, precision)` (binary float for money is a bug, not a shortcut).
5. **Use shared utilities — DO NOT RECREATE** (AGENTS.md §7 rule 9, the costliest revision history in the repo: four DOM batches + three Forms batches + ConfirmDialog ×3 + touchable ×3). Import from the globals, never write local copies:
   - DOM helpers → global `DOM` (`el`, `clear`, `status`, `error`, `text`, `attrs`, `append`, `pageHead`); touch floor → `DOM.touchable` / shared `touchable`
   - Form rows → global `Forms` (`fieldRow`, `labeledInput`, `labeledSelect`, `labeledTextarea`)
   - Confirm flows → global `ConfirmDialog.show({ title, rows, feeHuman, onBack, onSend })` with keyed fee term + raw `dd` titles (never post-show restore loops)
   - Modals → global `Overlay.open`; tables → global `TableRenderer.render`; delegated clicks → global `Event.delegate`
   A local `function el/clearRoot/showStatus/confirmList/fieldRow/touchable` is a defect, not a shortcut — the audit greps for these.
6. **Verify on testnet.** Connect → read → sign → broadcast, observed — not assumed.
7. **Write the parity note** under `/workspace/docs/parity/<slice>.md` (NOT `vanilla/notes/` — moved 2026-10-01), then run the audit (REQUIRED: use `auditing-vanilla-slices`).

## Per-File Standards (write it right the first time — every revision wave below was a retrofit)

- **Readability (§3.7):** every file opens with a module header (owns / consumes / side effects / origin skill+task); every non-trivial function has what / params / returns / failure-modes; comments explain WHY, never restate WHAT. No `TODO|FIXME|XXX|HACK`, no commented-out code, no stray duplicated tails.
- **File size:** any file past ~400 lines is a split candidate — split by responsibility into focused modules + thin facade (precedents: `transfer-ui` → preview+propose, `tx.js` → primitives/ops-trade/ops-gov, `account-ui`/`market-desk`/`vote-ui`/`pool-detail-ui` splits). Moved bodies stay byte-identical; duplication of small verbatim helpers across split parts is the documented convention (doctrine prefers it over a shared abstraction). Never leave an unwired shadow copy (the 1919-line `account-portfolio.js` lesson).
- **Types (hard gate):** JSDoc `@param`/`@returns`/`@typedef` on every touched seam; shared shapes in `vanilla/js/api/types.js`; cross-file globals declared in `vanilla/js/globals.d.ts` (dev-only, never a `<script>` tag). Cross-part calls use parenthesized `/** @type {X} */ (expr)` seam-casts. `bash tooling/check_types.sh` must be green.
- **i18n from day one (principle #10):** every user-visible string is `t(key, enDefault)` namespaced by view, with entries + English values in ALL 12 `vanilla/locales/*.json` + `en.json` inventory. Placeholders (`%(name)s`), URLs, IDs, symbols, theme/network IDs stay byte-verbatim. New literals in English-identical rendering; non-en dicts stay honest English stubs outside allowlists. `python3 tooling/check_i18n.py` must be green before the slice leaves your hands.
- **UX floor (principles #4/#7, never "polish later"):** touch targets ≥44px in ≥1 dimension; no hover-only UI; correct `inputmode` on amount inputs; labeled inputs (`aria-label`/`th scope="col"`/table `aria-label`); heading order honest (`h1` page title via `DOM.pageHead`, no orphan `h3`); theme tokens only (no hardcoded hex outside `themes.css`, contrast ≥4.5:1); empty states + inline validation on every form; scroll-to-top on route change; listeners cleaned up + focus returned on close (the R1-LISTEN lesson).
- **Workspace hygiene:** no dead files/selectors/keys committed (grep orphans, run `tooling/scan_dead_css.py` where touched); `notes/` paths in comments point at `docs/parity/`; never commit generated artifacts (`dist/`, `__pycache__/`, backups) or to `reference/`.

## Parity Note Contract

Every parity note MUST contain these fields, in this order:

1. Reference behavior (`bitshares-ui` file:line, plus `astro-ui`/`wallet-extension` file:line where applicable)
2. Vanilla implementation (file:line)
3. Manual test steps + observed result (testnet)
4. Raw→human test vectors for every displayed number (see principle #6, AGENTS.md §3.5)
5. Theme screenshot trio (original blue / light / dark) plus phone-width AND desktop-width flow checks
6. Module headers + function descriptions present per §3.7 (no dead text)
7. Anti-rot gate answers (AGENTS.md §4.5 questions a–c)
8. Type gate + i18n gate evidence (`check_types.sh` / `check_i18n.py` green)

Missing field = slice not done. No exceptions for "trivial" slices.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Starting slice N+1 before slice N passes audit | Finish the parity note first; slices are sequential |
| Editing anything under `reference/` | Read-only. Copy to `/tmp` or `docs/parity/` scratch to experiment |
| Inline float math for amounts | Route through `format.js`; the audit greps for this |
| Adding a dependency "just for this slice" | Answer §4.5(b) in writing, with a removal plan — or don't add it |
| Skipping themes/tests "for now" | "For now" is how #3583 started; the note requires both |
| Local helper that duplicates DOM/Forms/Confirm/Overlay/Table/Event | Use the shared global (rule 9); the DRY migrations cost dozens of commits — never restart them |
| Hardcoded display text instead of t() | Key it now with all 12 dict entries; unkeyed-string sweeps are always retrofits |
| File growing past ~400 lines | Split by responsibility + thin facade now, not "next slice" |
