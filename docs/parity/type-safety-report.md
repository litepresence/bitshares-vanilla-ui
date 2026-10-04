# Type-safety report — JSDoc seams pass + Kacper-dare verdict (2026-10-01)

## What was done

- `tooling/typecheck/` (TS 7.0.2 exact, `checkJs --noEmit`, hard gate
  `tooling/check_types.sh`), `vanilla/js/globals.d.ts` (100 ambient
  declares, dev-only, never loaded — rot gate carries a self-policing
  carve-out that fails if any `.d.ts` is ever referenced), shared
  `@typedef`s in `vanilla/js/api/types.js` (no script tag — tsc-only).
- Annotated: sdk (chain, crypto), all api/ + builders/ seams, all 13
  high-error views, tour/ticket/charts tail. Baseline 3361 → 432 (declares
  + vendor exclusion) → 92 → **0. Gate PASSES.**
- Rules of engagement kept throughout: JSDoc comments only, sole
  code-shape change is parenthesized `/** @type {X} */ (expr)` casts, every
  touched file `node --check` clean, full 16-suite battery green after
  (517 vectors + keepalive), rot + i18n green.

## The gate caught a live bug

`samet-ui.js openAction` used the route-liveness token `myGen` it never
received (5-arg call, 6-arg body) — every Borrow/Repay/Update/Delete click
threw `ReferenceError`. Dead feature, shipped. Fix threads `myGen`
through (2 lines + BUGFIX NOTE at site), matching all sibling forms.
Tester manual §11 step 3 covers the regression. This is the exhibit for
"types describe, tests prove, runtime asserts defend" — no test covered
the click path, the checker did.

## Kacper-dare verdict: no file needs TypeScript-the-language

Every one of the 92 errors yielded to JSDoc + casts — including the hard
cases (bigint/number ladder mixes got real `bigint` shapes, not `any`;
multi-declarator `var` needed per-name casts; `/**` vs `/*` matters).
Two `any`-bridge spots remain, named here as optional follow-ups (NOT
required — the gate is green without them):

1. **Our `Crypto` namespace collides with DOM lib's `Crypto` interface.**
   Cross-file `Crypto.*` calls bridge via `any` casts. A TS rewrite would
   rename or namespace-import; in JSDoc-land a dedicated `@typedef` for
   the wallet-crypto surface would remove ~20 casts. Mechanical follow-up.
2. **Custom `Error` properties** (`err.detail`, `fromName/fromId/walletId`).
   A small `@typedef {Error & {...}}` family would remove ~10 casts.
   Mechanical follow-up.

Neither is expressiveness JSDoc lacks — both are half-hour typedef chores.
The standing offer holds: name a seam JSDoc cannot express and it gets
fancier machinery. Nothing on this list qualifies.
