# Feed producers + history chart on #/assets/feed — design (2026-10-06)

Source ideas: `squidKid-deluxe/feed-graph-js` `feed_graph.js` (MPA search, per-producer
lines, gap>7200s outage bars, ES `_async_search` 3000-size `search_after`, in-memory cache,
Plotly via CDN) + user ask (no-login producer list with witness labels; historical
per-producer lines + on-chain median; plus exchange + pool overlays). Idea-only, never
imported: no Plotly, no axios, no ES query copied; math re-derived via `Format`.

## §1 Architecture + placement (approved)

- New `vanilla/js/api/feed-history.js`: chain-only history data. No DOM, no signing.
  Chain via `Chain.db/call` only. Owns: publisher op-19 fetch (per-publisher
  `get_account_history` filter op 19 + `asset_id`), exchange fills
  (`MarketFills.chainFills` / `Market.trades` time-walk reuse, never duplicated),
  pool discovery (`Pool.list({assetA, assetB})` both-orientations) + per-pool
  `PoolHistory.swapsForPool` chain fallback, bucket + median-recompute.
- Modified `vanilla/js/api/asset.js` `describe()`: additive-only — expose `flags`,
  `permissions`, `bitasset_data_id`, `feeds` keys source already joined (live
  `bitasset_data` object via `get_objects([bitasset_data_id])` gives
  `feeds` map publisher `1.2.N` -> `(time, price_feed)` + `options`).
  Old callers unchanged.
- Modified `vanilla/js/views/asset-feed-ui.js`: after current-feed block, mount
  (a) "Feed producers" read section (no wallet gate), (b) history chart section
  (days 7/30/90 default 7, progress, LWC host + legend checkboxes, empty states).
  Publish (op-19) + producer-edit (op-13) forms untouched below.
- Chart via vendored LWC (`ChartsLwc.drawOscPane`, lazy `js/sdk/vendor/
  lightweight-charts.standalone.production.js`, relative URL only) — one host,
  N `LineSeries`: thin per-publisher, bold median, dashed exchange, ≤3 pool lines.
  Canvas fallback free. No Plotly, no CDN (passes `tooling/check_rot.py`).

## §2 Data flow (chain-only, table never blocked)

1. `loadFeed(symbol)` → `Asset.describe` + `get_objects([bitasset_data_id])` join.
   Current-feed block renders immediately (existing behavior, unchanged).
2. Producers section (no login): authorized set = manual allow-list (from bitasset
   join; field name confirmed on testnet — headers only show `feeds`, not the
   allow-list; fallback = `feeds`-keys ∪ flags) + flags `witness_fed 0x80` /
   `committee_fed 0x100` (`bitshares-ui/app/lib/chain/asset_constants.js:10-11`).
   Witness-fed → `get_witnesses`/`lookup_witness_accounts` + `get_accounts` names,
   every row badged `witness`; committee-fed likewise; manual → badge `producer`.
   Each row: account link `#/account/<name>`, `1.2.N`, last-publish time from
   `feeds` map, stale tint when older than `feed_lifetime_sec`.
3. History (parallel, progress `Page N • M points • P%` like upstream):
   (a) per-publisher op-19 points → `{t, priceHuman}` via `Format.formatPrice`
   with BOTH precisions; (b) exchange fills for token/backing bucketed to same
   grid, orientation normalized to backing-per-MPA; (c) `Pool.list` token+backing
   → cap 3 largest by balance → per-pool swaps → same orientation.
   `bucketMedian(seriesByProducer, lifetime, minFeeds)`: per bucket, carry-forward
   last-known per publisher, median of active (within lifetime), gap when
   active < `minimum_feeds` (mirrors `update_median_feeds`; never fake zeros —
   upstream `both.js:74-99` zero-pad explicitly NOT ported).
4. Draw: single `times[]` + `series[]` → `drawOscPane`. Legend checkboxes toggle
   series (pool default-on ≤3, exchange default-on, median default-on).
   Gaps break lines (no zero-candles).

## §3 Orientation + money discipline (#6)

- Feed legs: settlement/CER base=MPA quote=backing (`asset_ops.cpp:178`,
  `asset.cpp:266`). Display via `Format.formatPrice(baseRaw, mpaPrec,
  quoteRaw, backingPrec)`.
- Exchange fills: `base/quote` depend on market convention — normalize to
  backing-per-MPA before bucketing (invert when pair is flipped; one helper,
  tested).
- Pool swaps: `PoolHistory.priceHuman` buy-leg rule (`pool-history.js:292`) —
  normalize same way.
- Integers until render: raws stay digit strings; median over human strings via
  integer compare (no `parseFloat` money; upstream `parseFloat/10^prec` NOT ported).
  MCR/MSSR ratios over 1000 (`1750=175%`), hundredths elsewhere — existing
  `AssetOps` helpers only.

## §4 Error + empty states (never blank)

- Offline → existing `cold()` panel + retry; reconnect auto-rerun via
  `Store.subscribe("connection")`.
- Non-MPA → existing "Not a market-issued asset" + help text.
- No live feeds → "No live feed published yet" + chart empty text.
- No exchange history → dashed line omitted + muted note (feed lines stand).
- No pools for pair → pool lines omitted + muted note.
- Publisher history page fails mid-walk → partial series stand + honest note.
- ES never touched in this slice (deferred opt-in behind `es-lab.js` consent).

## §5 Verification

- Testnet: load TESTMPA smartcoin → producers section lists publishers without
  unlock; witness-fed asset (e.g. BTS-bitUSD style flags) shows witness badge rows.
- Vectors: feed leg → human (both precisions, non-BTS precision); fill flip →
  same orientation; pool buy-leg → same; median with 1 expired + minFeeds=2 →
  gap; outage gap breaks line (no zero).
- Viewports 360px + 1440px (stacked chart + checkbox legend, 44px targets, no
  hover-only UI); themes ref-ui/dex-ux/vanilla trio screenshots in parity note.
- Gates: `python3 tooling/check_rot.py`, `bash tooling/check_types.sh`,
  `verification-before-completion` before done-claim. Anti-rot answers:
  (a) 10yr: static JS + vendored LWC + WS nodes — runs; (b) new deps: none
  (chain reads + vendored chart already shipped); (c) deletable subset: pool
  overlay (feeds+median+exchange still work — kept because user explicitly asked).

## §6 Deferred (not this slice)

- ES deep-history toggle (`feed_graph.js` `_async_search` shape ported into
  `es-lab.js` runner, opt-in consent + A-fallback). Needs its own slice.
- Outage stacked bars verbatim (line-breaks cover it; bars are candy).
- In-memory cross-symbol cache (per-load fetch is fine for 7d default).
