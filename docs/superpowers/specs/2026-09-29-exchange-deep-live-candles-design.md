# Exchange + pool deep + live candles — design (2026-09-29)

Scope: exchange price plot (`#/market/:marketID`) AND pool price plot (`#/pools/:id`).
`#/swap` stays quote-only by design. No indicator-math change (slice-07 catalog
stands); no TradingView; no new runtime dependency.

Local-bucketing rule (binding for both): candles are built client-side from discrete
order datestamps on a local slot grid (`floor(t/bucket)*bucket`) with local gap
carry-forward. Node `get_market_history` rows are treated as raw bucket inputs, never
as a pre-interpolated linear series — missing slots are filled locally, leading
empties dropped, exactly like `market-candles.js:236-266` and
`pool-history.js swapsToCandles` already do. Pools have no node market history at
all: strictly ES discretes + block-op-listener discretes, same local bucketer.

## 1. Goal

Exchange candles are a three-layer stack, newest-last, one `{buckets, closes}` array
out (cap 2000):

1. **Baseline (authoritative recent):** public-node `get_market_history_buckets` +
   `get_market_history(a, b, bucket, start, end)` (`market-candles.js:81-101,137-168`),
   ~200 slots, re-gridded + gap-interpolated LOCALLY per the rule above.
2. **Deep (backfill):** community ES `kibana_fills` (op-4) time-pages behind the chain
   window until 2000 candles or history exhausted (~1yr `KIBANA_HISTORY`), bucketed
   locally from discrete fill datestamps on the same grid. Chain wins any time
   overlap (covers ES `KIBANA_CANDLE_LIFE` lag). Mainnet only (index is mainnet-only,
   pool-proven 2026-09-28); testnet / ES-down stays chain-only with an honest note.
3. **Forward (live tip):** market-scoped operation push during the exchange view only:
   `subscribe_to_market(base, quote)` → debounced refetch + surgical patch of the
   current bucket OHLCV + last-price strip. Slot-cross rolls a new bucket without a
   full refetch. Unsubscribe on leave. Subscribe-rejected nodes fall back to a light
   fills/ticker poll; the 15s full `fill(state)` stays as floor.

Pool candles are a two-layer stack, same `{buckets}` shape via the shared local
bucketer (`PoolHistory.swapsToCandles`): **strictly ES discretes** (`kibana_swaps`,
op-63, already shipped) deep to 2000 **+ block-op-listener discretes** (block-applied
feed → `get_block` → filter op-63 for this pool id + legs → patch/roll tip). No node
market-history call exists for pools and none is added.

`MarketInd` / `charts-lwc.js` input shape does not change.

## 2. Architecture

- New `vanilla/js/market-fills-history.js` (no DOM, no signing, no storage), mirroring
  `pool-history.js` contract: `fillsForMarket(baseId, quoteId, limit, {network})`,
  `enrich` (orient + human price), `fillsToCandles(fills, bucketSec, baseId, precB,
  precQ)` (dex-ux `discrete_to_candles` port, BigInt volumes), `mergeDeep(chainBuckets,
  esBuckets)` (chain-wins overlap, cap 2000, newest-last).
- `MarketCandles.candles()` orchestrates: live bucket list → chain window fetch →
  (mainnet only) ES backfill fetch → merge → return. Error contract unchanged
  (`history-unavailable`, `bad-bucket`, `bad-count`); ES failures are swallowed to
  chain with `deep: false` flag for the note.
- `Chain.js` gains one market-notice slot alongside footer `BLOCK_CB_ID=1`
  (`chain.js:25,215-233`): `subscribeMarket(baseId, quoteId, cb)` /
  `unsubscribeMarket()` wrapping `subscribe_to_market` / `unsubscribe_from_market`
  with callback-id registry (astro `ChainWebSocket.ts:166-198` pattern), single
  active market at a time (route-owned). Unknown notices still ignored; heartbeat
  still covers unsubscribed nodes.
- `market-desk.js` owns the exchange live loop: on `showDesk` with resolved assets →
  `Chain.subscribeMarket` → 500ms debounce (astro `DexLiveOrderBook` / #1
  `MarketsActions.js:430-437` parity) → delta `get_fill_order_history(…, 10)` +
  `get_ticker` → patch `state.candles` tip + strip + `MarketInd.maybeDraw`. All
  continuations gen-guarded; teardown via existing `_cleanups` + `cleanup()` on
  hash change. Testnet / subscribe-fail: 3.5s fills/ticker-only poll
  (`DexLiveOrderBook.ts:220-254` precedent), no subscribe retry storm.
- `pool-detail-ui.js chartPane` owns the pool live loop: reuse the existing shared
  block-applied feed (footer `BLOCK_CB_ID`) as the tick source → per new head,
  `get_block(head)` → scan `transactions[].operations[]` for op-63 whose pool id +
  legs match this desk → `PoolHistory.enrich` + local bucket patch/roll + shared
  `MarketInd.maybeDraw` + count note. No `subscribe_to_market` for pools (no market
  pair subscription exists for `1.19.x`); no polling beyond the existing desk (snapshot
  stays, tip goes live). Block-scan failures are silent (tip simply waits for the
  next head); leaving the route drops the pool id filter so late arrivals are ignored.

## 3. Data flow

Exchange:

1. Desk resolves `Market.assets(quote, base)` → ids + precisions (cached).
2. `Market.candles(base, quote, bucket, 200)` → chain buckets (recent, locally
   re-gridded) + ES discrete fills (deep, mainnet, locally bucketed) → merged ≤2000
   newest-last + `closes[]` Numbers-for-pixels.
3. `MarketInd.maybeDraw(state)` renders LWC candles + overlays + osc panes + VWAP
   unchanged; count note shows `N candles · deep|chain-only`.
4. Live: market push → debounce → delta fills: each fill oriented to base/quote legs
   (`_fillPair` rule, `market.js:241-257`), current-slot (`floor(t/bucket)==tipSlot`)
   updates high/low/close + `volumeBaseRaw/volumeQuoteRaw` BigInt add; slot-cross
   appends new bucket(s) with gap carry-forward (`market-candles.js:236-266` rule);
   last-price strip from latest fill price, ticker as fallback. Red/green by exact
   `BigInt` cross-compare (`_isRed`).
5. Leave: `unsubscribe_from_market` (best-effort) + clear debounce/poll + existing
   LWC `removePane` teardown.

Pool:

1. `detailFill` fetches the pool row + one shared `PoolHistory.swapsForPool` tape
   (ES → chain `get_liquidity_pool_history` fallback, strict pool-id + leg filter).
2. `chartPane` buckets the tape LOCALLY via `swapsToCandles` (already the
   `discrete_to_candles` port — no change to bucket math) up to 2000, newest-last.
3. Live: block-applied tick → `get_block` → op-63 discretes for this pool →
   `enrich` → same local patch/roll path as exchange (same slot grid, same
   carry-forward, same BigInt volumes) + count note `N swaps · ES|chain + live`.
4. Leave: clear the pool-id filter; tape + panes tear down with the route.

## 4. Error handling

- ES: 15s timeout (pool `ES_TIMEOUT_MS` precedent), non-OK/CORS/shape → chain-only,
  note `deep history unavailable (chain-only)`. Strict pair-leg filter both sources;
  missing legs → no filtering rather than wrong filtering. Zero-leg division never
  attempted (`priceHuman` null-guard pattern).
- Subscribe: rejection/timeout → light-poll path, no error banner (liveness is
  best-effort; data stays correct via 15s floor). Poll skips hidden tabs
  (`document.hidden` gate, astro parity).
- Stale: desk `gen` + `Store.subscribe("connection")` reconnect re-subscribes only
  when hash still on same market id.
- Nodes without history plugin keep today's `history-unavailable` sentence; empty
  markets keep `no history` empty state — never blank, never guessed.

## 5. Money + performance

- Integers until render: raw fill/candle ints + precisions through
  `Format.formatPrice/formatAmount`; `Number()` only for pixel widths, closes[],
  time-bucketing. No float accumulation for volumes (BigInt add, format once).
- Bounds: ES pages size ≤500/post, total fills cap 5000 + candle cap 2000
  (`KIBANA_CLIP` precedent); debounce coalesces push herds; delta fetch limit 10;
  single market subscription at a time; no extra socket (shared `Chain.ws`).

## 6. Testing

- Unit (`tooling/`): ES-doc parse + leg guards, bucket OHLCV, merge overlap
  (chain-wins), tip-patch vs slot-roll, mixed-precision guard — green before browser.
- Headless: mainnet deep desk (2000-cap, `deep` note, SMA/indicators over ES range),
  testnet chain-only desk (no ES attempt), subscribe-fail poll path, route-leave
  teardown (no timers/listeners leak), phone 390 + desktop 1440, trio themes,
  zero console errors.
- Vectors: raw→human fill price + candle bucket + percent note (`2000`→`20%`
  belongs to op slices, recorded here only as no-touch); live-patch vector
  (fill in-slot updates H/L/C/V; cross-slot rolls bucket; last-price tracks tip).
- Anti-rot (§4.5): (a) host dies → chain-only desk, no build, no npm; (b) new deps:
  none (`fetch` is platform; ES URL is data like a node URL); (c) deletable: ES
  module (chain covers), live slot (15s poll covers), per-bucket merge (200 remain).
  `tooling/check_rot.py` must pass.

## 7. Out of scope

`#/swap` charts, indicator additions, orderbook live depth beyond the
existing 15s book fetch, backfill for account history, any
`bitsharesjs` import (reference only), any build step.
