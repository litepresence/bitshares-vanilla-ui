# Exchange deep + live candles — design (2026-09-29)

Scope: exchange price plot only (`#/market/:marketID`). Pool desk (`#/pools/:id`,
`pool-history.js` + `pool-detail-ui.js chartPane`) already ships ES-backfilled swap
candles; `#/swap` stays quote-only by design. No indicator-math change (slice-07 catalog
stands); no TradingView; no new runtime dependency.

## 1. Goal

Candles are a three-layer stack, newest-last, one `{buckets, closes}` array out:

1. **Baseline (authoritative recent):** public-node `get_market_history_buckets` +
   `get_market_history(a, b, bucket, start, end)` exactly as today
   (`market-candles.js:81-101,137-168`), ~200 slots, gap-interpolated.
2. **Deep (backfill):** community ES `kibana_fills` (op-4) time-pages behind the chain
   window until 2000 candles or history exhausted (~1yr `KIBANA_HISTORY`), bucketed on
   the same bucket grid. Chain wins any time overlap (covers ES `KIBANA_CANDLE_LIFE`
   lag). Mainnet only (index is mainnet-only, pool-proven 2026-09-28); testnet /
   ES-down stays chain-only with an honest note.
3. **Forward (live tip):** market-scoped operation push during the exchange view only:
   `subscribe_to_market(base, quote)` → debounced refetch + surgical patch of the
   current bucket OHLCV + last-price strip. Slot-cross rolls a new bucket without a
   full refetch. Unsubscribe on leave. Subscribe-rejected nodes fall back to a light
   fills/ticker poll; the 15s full `fill(state)` stays as floor.

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
- `market-desk.js` owns the live loop: on `showDesk` with resolved assets →
  `Chain.subscribeMarket` → 500ms debounce (astro `DexLiveOrderBook` / #1
  `MarketsActions.js:430-437` parity) → delta `get_fill_order_history(…, 10)` +
  `get_ticker` → patch `state.candles` tip + strip + `MarketInd.maybeDraw`. All
  continuations gen-guarded; teardown via existing `_cleanups` + `cleanup()` on
  hash change. Testnet / subscribe-fail: 3.5s fills/ticker-only poll
  (`DexLiveOrderBook.ts:220-254` precedent), no subscribe retry storm.

## 3. Data flow

1. Desk resolves `Market.assets(quote, base)` → ids + precisions (cached).
2. `Market.candles(base, quote, bucket, 200)` → chain buckets (recent) + ES pages
   (deep, mainnet) → merged ≤2000 newest-last + `closes[]` Numbers-for-pixels.
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

Pool candles, `#/swap` charts, indicator additions, orderbook live depth beyond the
existing 15s book fetch, backfill for account history / pool history, any
`bitsharesjs` import (reference only), any build step.
