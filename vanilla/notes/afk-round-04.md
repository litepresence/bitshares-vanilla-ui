# AFK Round 4 record — tx-hash links + trade-history depth + shooter repair

## Worker C — Phase 6.1 tx-by-hash (`explorer.js`, `explorer-ui.js`, 1 key)
- Verified FIRST (live curl): astro's `trx_id[.keyword]` trio returns ZERO
  hits on the live mapping; `block_data.trx_id[.keyword]` returns the ops.
  Cascade leads with the observed trio, astro trio rides last as
  forward-compat (logged in `_txHashQueries` header — verify beats cite).
- Observed hit shape: `_source.block_data.{block_num,block_time,trx_id}` +
  `operation_history.trx_in_block` (+ top-level fallbacks in `_txHashBlock`).
- `resolveTxHash` never throws → block / tx / not-found / offline / invalid;
  ES-hit navigates `#/block/:h/:ix` (renderTx untouched); WS location-less
  paints the no-block-link panel; neither → `explorer.tx_not_found` notice +
  Settings link. `renderTx` in explorer-blocks.js untouched.
- Test `tooling/tx-hash-test.js` 55/55 (fixture = observed field names).

## Worker D — Phase 7 B1 `tradesDeep` (`market.js` only, backend-only)
- Signature verified: `database_api.hpp:662-664` — WS order is
  `[base, quote, latestISO, earliestISO, limit]` (C++ names read
  start/stop but start = LATEST bound; astro `DexLiveOrderBook.ts:86` +
  `MarketTradeHistory.ts:138` agree, live won the naming conflict).
- `Chain.db()` (database api, NOT history api). Factored shared `_fillRow`/
  `_normalizeFills` (single normalizer; `trades()` behavior identical —
  proven by deep-equal test); `market_trade` rows carry human strings +
  `date` (trailing `|| row.date` fallback, documented judgment call).
- Defaults {days:7, limit:100}; disjoint 1-day windows, min(days,8) pages,
  short-page stop, newest-first JSON-dedupe. Empty → [] (valid).
- Test `tooling/trade-depth-test.js` 25/25. Future UI needs exactly one key
  (`market.load_deeper`, NOT minted — backend-only shipment).

## Director — shooter repair + end-to-end proof (workers' blind spot, my fix)
- `shot.mjs --type` never typed: this playwright-core's `page.evaluate`
  takes ONE arg (multi-arg throws, swallowed by the fail-soft catch).
  Wrapped `{text, nd}` object. Lesson: fail-soft tooling must ECHO what it
  did — `--type` now logs `typed:` (value@placeholder) and every run logs
  final `hash:`. Both permanent (future --click/--type proofs need them).
- Also fixed in passing: hidden nav "Filter menu" input shadowed real inputs
  (visible-first pool) + submit-button fallback + `--click` flag (R2).
- Independent curl proof: fixture hash → block 114884983 / trx_in_block 0.
- In-app proof: `#/explorer` + typed hash → `#/block/114884983/0`,
  "Transaction 114884983 / 0" with backlink, human fees, zero errors.

## Gates
types PASS · rot PASS · i18n OK (3093 keys, 3984 sites) · tx-hash 55/55 ·
trade-depth 25/25 · all prior suites green (fills 29, pool-hist 31, ops 16,
cap 30, notice 14, holders 69, health 52, zoom 42, intel 37, gov 33,
readability 61, shell 11).
Money: tx fees via existing renderTx Format path (0.00482 BTS observed);
market_trade strings never float-mathed (normalizer reuses trades() path).
Anti-rot: (a) platform only; (b) nothing new (2 readers + 1 resolver);
(c) deletable: cascade (WS path stands), tradesDeep (trades() stands).
