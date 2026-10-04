# Masterful wallet+desk rework — parity addendum (Phases A–E)

Date: 2026-09-28. Spec: `docs/superpowers/specs/2026-09-28-masterful-wallet-desk-design.md`.
Method: code + `original-pages/` shots + `viewport-gaps.md`; fresh headless shots blocked (sandbox lacks `libnspr4.so` — human browser pass stays the gate).

## Landed

- A burger palette (`app.js`, `app.css`): search filter, aria-current, Esc/close-on-nav/focus-return, focus-filter-on-open, nav theme-copy removed (header copy stays). i18n `shell.menu_filter/menu_no_match` ×10 dicts.
- B dashboard gate (`dashboard-ui.js`, `app.css`, `a.btn`): locked welcome card mirroring `root.png` (Create/Login/restore). i18n `dashboard.*` ×4 keys ×10 dicts.
- C desk density: fluid caps ≥1440 (`app.css`), quote-button row + arrow-key nav (`market-picker.js`), book click-to-fill price→`#trade-price` + amount focus (`market-book.js`).
- D pools: page-sort Pool ID/Taker/Withdrawal with aria-sort (`pool-ui.js`), virgin-mint note in create. i18n `pool.sort_by/virgin_note` ×10 dicts.
- E polish: `#fff` literals out of `app.css` (→`--accent-text`), footer `BLOCK #n @connect` honesty, dismissible `#warn-banner` (persisted flag).

## Gates

`node --check` clean (all touched files); `check_rot.py` PASS; `check_i18n.py` OK (2124 keys, 2773 sites drift-free); zero TODO/FIXME. Prior viewport fixes (a)–(f) already in `app.css:363-429` — reused, not duplicated.

## Deferred (honest, tracked)

- `.wide` expansion to explorer/voting/account: mechanism proven (pools + contract (e)); per-view wiring needs a real browser to verify — queued for tester round.
- Human passes: burger tap, gate-card trio, quote-row, click-fill one-hand flow, pools sort, banner dismiss ×3 themes — all in tester queue with slices 2–17.
- Theme-default question (`SLICES.md:142`): spec records darkTheme stays per `branding.js:72-74`; owner closes.
- Banner ink `#1a1a1a`: written exception (amber band needs dark ink in every theme; no token is dark-on-amber-safe) — same class as slice-18 exceptions.

## Anti-rot (§4.5)

(a) Static, no new deps — 2036 yes. (b) Depended: nothing. (c) Deletable: palette search, gate card, quote row, sort, banner — each kept for discoverability/density with the mechanism surviving deletion.
