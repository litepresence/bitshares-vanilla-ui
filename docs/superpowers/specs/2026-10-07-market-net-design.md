# Markets landing (`#/markets`) — design (2026-10-07)

Pool-page twin for order-book markets: search + top-markets table + network
mapper → click through to `#/market/QUOTE_BASE`. Chain-only (no ES — §4.5
refuses ES transport; market-history calls answer the same question).

## §1 Architecture + placement (approved)

- New `vanilla/js/api/market-net.js`: discovery + rank + graph build + cache.
  No DOM, no signing. Pure fns tested headless (`tooling/market-net-test.js`).
- New `vanilla/js/views/market-net-ui.js`: `#/markets` landing (search +
  table + band). Reuses `PoolNetUI` canvas wholesale; only addition is a nav
  override passed as mount opts (`edge → #/market/…`, node mapping unchanged).
- Modified: `vanilla/js/router.js` (`/markets` route), `vanilla/index.html`
  (2 script tags), `vanilla/js/views/pool-net-ui.js` (nav-opts passthrough
  only — pool band behavior byte-identical). `market-picker.js` untouched.
- No skeleton file (markets aren't immutable — pairs live/die with activity):
  seeds = market-picker curated list + `localStorage` cache of discovered
  markets + user-typed pair.

## §2 Data flow (approved)

- Candidates for asset X = pool counterparties (free, from loaded PoolNet
  graph) ∪ curated seeds ∪ cached markets ∪ user-typed pair. Cap 20 pairs.
- 1× `get_ticker(X-as-base, Y)` per pair via `Market.stats` → `base_volume`
  comparable in X units; latest/change/spread free in the same call. Idle
  chunks, progressive paint. Budget/search: ≤20 tickers + 1 symbol join.
- Nodes = pairs with 24h volume > 0. Sparklines top 8 only
  (`get_market_history` 7d, 1 call each, lazy after table).
- Desk id orientation follows market-picker's rule verbatim (verify in
  implementation against `market-picker.js:590` + `#1 ChainStore`).
- Offline → cached markets + retry note. Zero-volume → honest empty state.

## §3 Table + mapper + nav (approved)

- Search: single asset input (defaults BTS; `?a=`/`?b=` habits from pools) +
  optional second asset narrowing to one pair. Order-free (both orientations
  probed, pools lesson reused).
- Table: Market (CP/X → desk) · Last · 24h change · 24h vol (X + CP) · 7d
  sparkline (top 8). No pager (capped list) + honest "top N of M probed" note.
- Mapper: pools band chrome reused (collapsible, Physics switch, legend,
  twin). Nodes sized by pair volume, edges colored by 24h direction. Tap edge
  → `#/market/…`, tap node → `#/asset/…`. Follows search filter (empty box =
  BTS default; curated-seed view when cleared).

## §4 States, perf, a11y, i18n (approved)

- Skeleton → progressive rows; table interactive before mapper finishes
  (pools non-blocking contract). Offline → cache + retry.
- Canvas engine unchanged: DPR cap, sleep + reduced-motion policy (auto
  frozen, explicit gestures run bounded), 44px targets, table doubles as
  screen-reader twin, canvas labelled.
- Strings `market_net.*` via `I18n.t` verbatim defaults; 3 themes; 360px→4K.

## Self-review

- No TBDs; one route + two modules + nav passthrough — desk slices, picker,
  and pool band untouched.
- Consistent: order-free + BTS-default + cache-first mirror the pools page;
  nav override defaults to pool behavior so existing callers can't regress.
- Doctrine: platform canvas + rAF only, read-only chain calls, `python3 -m
  http.server` serves, no new trust (no ES, no gateway, no feed reads).
