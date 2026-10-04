# AFK Round 5 record — my-positions backend + help topic + manual + audit

## Worker — B4/B5 backend (`market.js` +96/−1, `my-positions-test.js` 55/55)
- Verified: `get_settle_orders_by_account(acct, start, limit)` START required
  (`database_api.hpp:569-571`; zero call sites in all three references —
  genuine gap closed); `get_limit_orders_by_account(acct, limit[, start_id])`
  (`:495-498`, astro `AccountLimitOrders.ts:45`); `get_account_limit_orders`
  needs (acct, base, quote) (`:524-529`) so the assigned (acct, limit) shape
  canNOT serve it — shipped all-markets first page, "this market" stays a
  client-side filter or follow-up wrapper (logged in-code).
- Caps from `application.hpp:65-70` (101 / 300). B4 first page passes "1.4.0"
  genesis; live cursor flagged NEEDS-PROBE. No normalizer factored (raw rows
  like existing myOrders/settleOrders readers). Backend-only; future UI keys
  proposed in report, NOT minted.

## Director — help topic + manual + holders hardening + shooter gap
- `#/help/history-index` (49th topic): two-histories, third-party notice +
  t.me/bitsharesDEV, testnet limits, Settings pointer. Bodies are
  English-first by design (zero locale churn — i18n still green). Shot clean.
- Manual: §1 steps 11–13 (pills, ES switch, testnet banner), §3 step 6
  (history filter + Settings-link proof), §7 steps 6–7 (hash search, Top
  holders incl. ES-off case), §19 (49 topics + history-index article).
- Holders hardening: one 390px run showed heading + EMPTY list (no loading,
  no table, no notice; 3 other runs fine, no rejection captured). Every
  reviewed path leaves content, so the cause is unreconstructed — but the
  .then body could throw after clear() into an uncaptured rejection, so it
  is now wrapped: ANY throw lands holdersUnavailable (honest notice, never
  silent-empty). Shooter also gained an `unhandledrejection` listener (the
  gate gap this exposed).

## 9-gate audit (AFK scope: all touched surfaces)
1. Rot: check_rot PASS; no pkg/node_modules; CDN hits = provenance docs only;
   §4.5(b) raw-ES exception carried from R3 (WS fallbacks + one-constant host).
2. Retro: additive only (pill span, switch block, select row, holders table,
   hash panel reusing renderTx) — no restyling, no deviations to justify.
3. Coverage: no new ops (reads only); matrix counts unchanged (B-methods are
   db reads, not ops).
4. Glow: targeted DOM throughout; notices with Settings links; typeahead
   untouched; hash search debounced-listbox-free (direct submit).
5. Themes: no hex literals in new code (grep clean); trio settings
   default/light/dark + holders light/dark + 390px all readable, zero errors.
6. Numbers: Math.pow(10) vendor-only; holders p5 vectors (69 checks);
   market_trade strings via shared normalizer; my-* backend-only (no display).
7. Viewports: 390 settings stack (cards), holders table in xplore-scroll
   (sticky-first-col class family); 1440/2600 dense views expand as before.
8. Read: headers + JSDoc on all new/changed units; TODO/FIXME grep clean;
   oversize note: explorer-assets.js 1234 lines (pre-existing shape, split
   candidate for the readability pass — recorded, not started).
9. Types: check_types PASS.
Suites: 55/25/16/30/14/27/69/52/42/29/31/37/33/61/11 + my-positions 55 — all green.
