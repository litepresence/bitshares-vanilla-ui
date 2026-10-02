# Market intelligence delta — 2026-10-02 (most-active-markets + grouped book)

Two extensions, zero new WS methods, zero ES, zero deps. Chain calls re-verified
at #4 before coding (mapping-chain-calls); reference checkouts untouched.

## 1. Reference behavior

- `reference/bitshares-core/.../database_api.hpp:639-646`: `get_top_markets(uint32_t
  limit)` is EXPERIMENTAL, capped at `api_limit_get_top_markets = 100`
  (`application.hpp:56`); returns `vector<market_ticker>` sorted by reverse
  `base_volume`. `market_ticker` legs are HUMAN strings (`api_objects.hpp:112-138`:
  `latest`, `lowest_ask`/`highest_bid` + sizes, `percent_change`,
  `base/quote_volume`).
- `reference/bitshares-ui/app/components/Dashboard/Markets.jsx:128-134`: #1's
  `TopMarkets` renders an EMPTY `MarketsTable` (stub — no sort/filter/columns to
  port); the old explorer Markets container only listed the sample. Vanilla
  superset (filter/sort + full ticker columns) is a documented #4-glow addition.
- Order-book grouping has no #1 counterpart (book renders raw levels); bucketing
  is client-side only, over the already-fetched `get_order_book` pair
  (`database_api.hpp:628-637`), so no chain contract is reinterpreted.

## 2. Vanilla implementation

- `vanilla/js/api/explorer-tabs.js:213` (`cmpDec`), `:242` (`filterMarkets`),
  `:256` (`_rankable`), `:274` (`sortMarkets`), `:329` (`marketsTab`), `:466`
  (`_test` seam): `get_top_markets [20]` once + existing per-row
  `Asset.describe` join; 7 columns (Market/Price/Bid/Ask/Vol-base/Vol-quote/Change,
  verbatim strings, `—` where absent); QUOTE_BASE substring filter + 7-key sort
  (vol desc = chain order default; junk legs sink last in EVERY direction);
  experimental-sample note + `Showing X of Y` count + thin-summary line kept.
- `vanilla/js/api/market-book.js:196` (`GROUP_DECS`), `:210` (`bucketKey`),
  `:234` (`_sumHuman`), `:303` (`groupLevels`), `:344` (`groupBook`), `:689-690`
  (exports + `_test`): floor-to-decimals bucketing (Exact/8/6/4/2); price
  validation via `Format.parsePriceRatio`, totals via
  `Format.parseAmount`/`formatAmount` round-trips (BigInt, >12dp manual-BigInt
  fallback); bids desc / asks asc; junk-price rows dropped, junk legs count zero,
  dust preserved, empty sides stay `[]`.
- `vanilla/js/views/market-desk.js:287` (`groupDec`/`bookRaw` state), `:401`
  (`#mkt-book-group` toggle in the head — both lists), `:1241` (`paintBook`),
  `:1282` (`bookRaw` cache in `fill`): toggle repaints from cache, never refetches;
  grouping faults fall back to the exact book.
- i18n: 17 keys (`explorer.markets_*` × 13, `market.group_*` × 4) via
  `tooling/sync_locale_keys.py` (en-identical stubs); all display strings keyed,
  `textContent`-only throughout, 44px touch targets.

## 3. Manual tests + observed (testnet, 2026-10-02)

- `#/explorer/markets`: 20 rows, filter+sort controls present, experimental note
  present, zero console errors (headless eval).
- `#/market/BTS_CNY`: `#mkt-book-group` present with 5 options; switching to 2dp
  on the (genuinely empty — chain returned `bids: [], asks: []`) testnet book kept
  the honest empty states with zero console errors. Grouped-row correctness is
  carried by the 37 unit vectors (live books are empty on testnet for this pair).
- `tooling/market-intel-test.js`: **37 passed, 0 failed** (bucket boundaries,
  merge sums, side ordering, dust, empty sides, junk handling, sort directions,
  filter match/blank/no-match).
- Gates: `node --check` ×4 clean; `check_rot.py` PASS; `check_i18n.py` OK
  (10 dicts, 3077 keys, 3955 call sites drift-free); `check_types.sh` PASS.

## 4. Raw→human vectors

No new money display: every cell renders the chain's human strings verbatim
(proven base-per-quote, `market.js` header). Computed values pin exact strings:
`1.056+1.051 @2dp → bucket 1.05 = 30/15 (n=2)`; `1.049|1.050 @2dp → 1.04|1.05`;
`0.00000001+0.00000002 → 0.00000003` (dust kept); `price_asc 9.75<10.5<100`
(BigInt, never float). Full list in `tooling/market-intel-test.js`.

## 5. Screenshots

- `/tmp/mi-markets-1440.png` (1440px, 0 console errors), `/tmp/mi-markets-390.png`
  (390px phone, 0 errors) — filter/sort/sample-note verified in-DOM.
- `/tmp/mi-desk-1440.png` (1440px desk, 0 errors) — grouping toggle verified in-DOM
  (5 options). Theme trio + human browser pass: with the tester (slices 2–17
  precedent).

## 6. Readability

Module headers updated (`market-book.js` Consumes now names Format-for-grouping);
every new function has what/params/return/failure docs; no TODOs, no dead code;
`GROUP_DECS`/`paintBook`/`dirCmp` names say their job. No new vanilla files.

## 7. Anti-rot (AGENTS.md §4.5)

(a) Ten years untouched: static JS + `get_top_markets`/`get_order_book` only —
  no new endpoint, no ES, no library; worst case the sample call fails into the
  existing honest error box. (b) Newly depended on: nothing (17 locale strings +
  3 edited files + 1 tooling test). (c) Smallest deletable subset: the grouping
  block (`GROUP_DECS`→`groupBook` + toggle + `paintBook` branch) or the
  filter/sort controls — each deletes cleanly leaving the exact book / plain
  top-20 table. `check_rot.py` PASS.

## Matrix rows (reference × vanilla)

| # | Reference | Vanilla → status |
|---|---|---|
| M1 | #4 `get_top_markets` experimental sample (`database_api.hpp:639-646`, cap 100) | `ExplorerTabs.marketsTab` → PORTED (top-20 sample, 7 ticker columns verbatim, filter + 7-key sort, experimental label; delta 2026-10-02) |
| M2 | #1 `TopMarkets` empty-table stub (`Markets.jsx:128-134`) + explorer Markets container | Same `marketsTab` → SUPERSET (filter/sort/columns #1 never had; documented, no behavior contradicted) |
| M3 | #4 `get_order_book` levels (`database_api.hpp:628-637`) + desk book parity (slice-05) | `MarketBook.groupBook` + desk `#mkt-book-group` → PORTED (client-side floor bucketing Exact/8/6/4/2, exact sums, no refetch; delta 2026-10-02) |
