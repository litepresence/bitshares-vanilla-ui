# Discrete timescale — design spec

Date: 2026-10-06. Scope: exchange (`#/market/...`) + pool-detail price plots only.
No new plot on Instant Trade (`#/instant-trade` convert screen stays as-is).
Renderer: canvas scatter (approved). Cap: shared candle-count input (approved).
Mode behavior: Discrete closes all indicator plots incl. pool-map; discrete
volume auto-opens below price; Indicators/Plots menu greyed + non-functional;
no other plots (approved).

## 1. dex-ux precedent review (read-only, behavior only)

- Timescale radios live in `reference/bitshares-dex-ux/order_book.html:108-134`:
  chart-type radios (`line`/`candle`/`advanced`, `name="candles"`) plus
  candle-size radios (`c900…c86400` + `discrete`, `name="options"`).
  Discrete is last in the row, label `Discrete`, value `discrete`.
- Backend (`reference/bitshares-dex-ux/kibana.py`): `discrete` is the raw
  per-fill list (`[unix, price, volume]` plus account/block/op + hover text at
  `format_onhover`, `discrete_to_candles` is only used to DERIVE bucketed
  candles FROM discrete — discrete itself is never bucketed). Capped at
  `KIBANA_CLIP` points. Inverted markets invert price only (`idx=1`) for
  discrete vs everything-but-time/volume for buckets (`falcon_app.py:285-307`,
  `kibana.py:526-548`).
- Frontend (`reference/bitshares-dex-ux/main.js:47-66, 191-263`):
  `chartHandler` routes `candleData[2] === "discrete"` AWAY from
  LightweightCharts (`TradingViewLightWeight`) and klinecharts (`advanced`)
  into `plotlyChart`: x = unix time, y = price, `markers` for candle/advanced
  modes, thin `line` for line mode. Irregular timestamps, multiple points per
  second preserved. Volume is not a separate discrete pane there.
- Vanilla deviation (deliberate, documented): dex-ux has no volume pane in
  discrete and keeps chart-type radios; vanilla has no chart-type radios
  (always candles via LWC) and the user explicitly requires a discrete volume
  plot below price plus a disabled menu. So vanilla Discrete = price dots +
  auto volume stems, no chart-type switch.

## 2. Vanilla current state

- Exchange desk timeframe radios: `market-ind-panes.js paintTimeframes()` from
  `state.liveBuckets` (live `get_market_history_buckets` reconciled via
  `reconcileBuckets` over `PREF_BUCKETS [300,900,1800,3600,14400,86400]`);
  data via `MarketCandles.candles(base,quote,bucket,count)` (bucketed OHLC +
  gap interpolation, paginated 200-slot chunks). Count from `CANDLE_COUNT`
  (persisted `bts-vanilla-candle-count-v1`, 1–5000, default 2000).
- Pool detail: fixed `POOL_BUCKETS`, data from swap tape via
  `PoolHistory.swapsToCandles` (+ ES `deepenPool` merge under chain authority).
- Panes: LWC price pane (`ChartsLwc.drawPricePane` candlesticks + overlay
  lines) + stacked osc panes (`drawOscPane`, incl. Volume histogram) + VWAP
  strip + depth slice + pool-map slice, all orchestrated by
  `maybeDraw`/`drawCharts` with a `_seriesCache` fast path.
- URL: `market-desk-query.js readDeskQuery/buildDeskQuery/syncUrl`
  (`?tf=&over=&osc=&log=&vwap=&depth=&pmap=&dx=&dy=&trades=&group=`).

## 3. Architecture

- Discrete is a MODE flag (`state.discrete` bool), never a bucket size.
  `state.bucket` keeps the last numeric bucket so leaving Discrete restores
  it with no refetch surprise.
- `paintTimeframes` appends a Discrete radio last (dex-ux order) regardless of
  the live bucket list; it is always available (chain fills / swap tape need
  no history-plugin buckets).
- `bucketLabel("discrete")` returns `"Discrete"`; numeric labels unchanged.
- URL: `readDeskQuery` accepts `tf=discrete` (sets flag, numeric `tf` values
  keep working; unknown stays default 3600). `buildDeskQuery` writes
  `tf=discrete` and suppresses `over/osc/vwap/depth/pmap` while active
  (they are meaningless in Discrete and must not resurrect on share-open).
  Pool detail is session-only (it has no chart URL contract today — no new
  pool URL keys are introduced).
- Count note reads `"<N> fills"` / `"<N> swaps"` in Discrete instead of
  `"N × <tf> candles"`. Count input stays live and re-slices/repaints.

## 4. Components (all dependency-free, no build step)

- `market-ind-panes.js` (owner of mode): `bucketLabel`, `paintTimeframes`
  (+Discrete radio), `paintCountNote` (fills/swaps wording), `renderIndMenu`
  disabled state, `maybeDraw`/`drawCharts` Discrete branch (bypass
  `_seriesCache`, overlay series, VWAP, depth, pool-map positioning).
- NEW `vanilla/js/api/discrete-charts.js` (one purpose: discrete painters):
  `drawDiscretePrice(canvas, points, {log, colors})` — per-fill dots at exact
  `timeMs`, no connecting line, no aggregation; `drawDiscreteVolume(canvas,
  points, {colors})` — per-fill vertical stems on a zero-based scale.
  DPR-aware fit (existing `fitCanvas` pattern, duplicated not shared per
  doctrine), theme colors via `readVar` tokens, `prefers-reduced-motion`
  respected (no animation at all), 44px touch floor untouched (canvases are
  not controls). LWC handles from bucketed mode are released via existing
  `removePane` on mode switch; no LWC calls while Discrete is active.
- `market-desk-fill.js` + pool `rebucket`: Discrete fetch branch (no
  `candles()`/`swapsToCandles()` bucket path, no `deepen`, tip poll re-fetches
  points). Exchange live-tip `tipHash` covers raw points (bucket + count +
  per-point time/raw-close/raw-volume + deep/live flags pattern reused).
- i18n: new keys (`market.tf_discrete`, `market.discrete_*`, menu-disabled
  titles, empty states) added to `en.json` + byte-identical English stubs in
  the other 11 locales (honest-stub rule §3.9; `tooling/check_i18n.py` green).
  Indicator symbols stay unlocalized (existing precedent).

## 5. Data flow (integers until the last moment, principle #6)

- Exchange: chain fills newest-first via the existing `MarketFills` fill path,
  sliced to `CANDLE_COUNT`, mapped by a new pure `fillsToPoints` (orientation
  via existing `priceHuman` incl. inverted-market leg swap; volume = base leg,
  same leg candles use; humans via `Format.formatPrice/formatAmount` BigInt
  math only). Same-second fills stay SEPARATE points (dex-ux parity; this is
  the whole point of Discrete). Sorted oldest-first for paint. No
  interpolation, no gap-fill, no bucket aggregation, no ES deepen (raw tape
  IS the source).
- Pools: loaded swap tape (`P.swaps`, enriched oriented price) sliced to
  `CANDLE_COUNT` newest, mapped the same way (base-leg volume). ES-sourced
  tape entries are already human-priced through the same BigInt path; chain
  tape wins ties exactly like `mergeDeep` chain-wins today.
- Malformed fills/swaps (unparseable time, non-digit raws, zero denominators)
  are skipped points, never blank-chart rejects, never rendered as null-OHLC.
- Log toggle applies to the discrete PRICE y-scale only (volume stays linear
  zero-based); Invert navigates pair-flip (re-fetch, same as today); book
  Grouping is untouched (book-level, not chart-level).

## 6. Disabled menu + closed plots + errors (exact behavior)

- Entering Discrete: teardown osc panes + VWAP strip + depth slice + pool-map
  slice (detach + `removePane`, same teardown paths as unchecking); auto-mount
  price dots + volume stems. No other plot can be opened while active.
- Indicators menu: button stays clickable (so the user sees WHY); every
  overlay/oscillator/plot checkbox is `disabled` with title `unavailable in
  Discrete` (volume-osc included — discrete volume is its own auto pane, not
  the toggleable Volume oscillator). X-buttons on torn-down panes no-op
  (panes are gone). Esc/outside-close behavior unchanged.
- Empty: `No fills yet — place an order or try another pair` (exchange) /
  `No swaps yet` (pools, existing key reused) — never blank, never raw ints.
- `history-unavailable` keeps the existing inline error + Settings link.
- Accessibility: canvases get `role="img"` + `aria-label` (existing
  `chart_aria` pattern); tabular fill/swap data already follows on both desks
  (trades list / swap tape), so no new table is required; keyboard users lose
  nothing (radios + menu are native controls).

## 7. Testing + parity gates

- Unit: `fillsToPoints`/swap-point mapping vectors (raw→human incl. non-BTS
  precision + percent-free price path, inverted legs, same-second separation,
  newest-first cap slicing, malformed-row skips); `bucketLabel("discrete")`;
  `readDeskQuery`/`buildDeskQuery` `tf=discrete` round-trip (incl. suppression
  of over/osc/vwap/depth/pmap + restore of retained bucket).
- Renderer smoke: empty points, N points, log/linear, DPR fit, theme tokens —
  headless, no network.
- Manual testnet script: exchange pair with fills + thin pair (few dots) +
  pool with swaps + empty pool; toggle in/out of Discrete; count change;
  share-link open (`tf=discrete` lands in Discrete, no indicators resurrect);
  360–390px phone + ≥1440px desktop; theme trio screenshots in the parity note.
- Gates before done-claim: `tooling/check_rot.py`, `tooling/check_i18n.py`,
  `bash tooling/check_types.sh`, `verification-before-completion`.

## 8. Anti-rot answers (§4.5 a–c)

- (a) Ten years untouched: radios + canvas + WS fills use platform APIs only;
  no new dependency, no hosted asset, no build step.
- (b) Newly depended on: nothing (one new vendored-zero file,
  `discrete-charts.js`, plus small edits in owned modules).
- (c) Smallest deletable subset: the volume-stems painter could go and price
  dots still carry the feature — kept because the requester explicitly
  requires it; everything else is the minimum mode switch.
