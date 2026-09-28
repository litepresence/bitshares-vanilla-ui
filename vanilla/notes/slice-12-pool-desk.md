# Slice-12 addendum — pool desk uniformity (exchange-format pools)

Date: 2026-09-28. Directive: user ES-override (ES adapter + chain fallback) +
pools mirror the exchange desk (synth book, Recent/My, all indicators).

## 1. Reference behavior

- #1 `PoolmartPage` + `Exchange` desk (orderbook, chart+indicators, Recent/My
  tabs, buy/sell): layout parity target is the EXCHANGE desk, not Poolmart.
- #2 astro-ui pools/swap/stake pages: all ported (op-coverage matrix, 0 missing).
- #4 `liquidity_pool.hpp:138-152` (op-63 fields), `transaction.hpp:292-301`
  (processed results carry executed paid/received), `database_api.hpp:182/190`
  (get_block/get_transaction).
- #5 `kibana_queries.py:kibana_swaps` (op-63 ES query) + `kibana.py:
  parse_price_history` (paid/received orientation) + `discrete_to_candles`
  (bucket OHLCV) — math ported, transport adapted (host moved
  es.bts.mobi -> es.bitshares.dev, 301 observed 2026-09-28).
- QTradeX `qtradex/indicators/qi.pyx` (vortex:155, kst:206, zigzag:309,
  ravi:370, aema:426, tsi:577, smi:631, eri:681, awesome:735, supertrend:772,
  arsi:824, keltner:859, donchian:910, ulcer:1223, trix:1261, earsi:1297,
  vhf:1425, holtwinters:1181, kagi:941) + `tulipy_wrapped.py` (full Tulip
  list) — formulas transcribed, runtimes never imported.

## 2. Vanilla implementation

- `vanilla/js/pool-history.js` (new): swapsForPool (ES POST -> strict
  pool-id + leg filter -> chain `get_liquidity_pool_history`), enrich,
  priceHuman (B-per-A both directions), swapsToCandles (dex-ux buckets +
  raw-volume VWAP fields), synthBook (12 CPMM slices, Pool.quote floors +
  taker haircut, best-first sorted; asks = taker-buys-A).
- `vanilla/js/pool-detail-ui.js`: chartPane via shared MarketInd state
  (timeframes, dropdown menu, LWC candles, osc stack, VWAP), depthPane via
  shared MarketBook.renderBook + click-fill into `#pool-swap-amount`/
  `#pool-swap-dir`, historyPane tape (Time/Price/Paid/Received/Account) +
  My filter, strip Spot. Curve canvas kept (collapsible).
- `vanilla/js/indicators-{tulip,tmom,tvol,qx}.js` (new, 63 vectors):
  Tulip overlap/momentum/volume gaps + qi add-ons; attach to global
  Indicators (osc precedent). Deferred honestly: candle patterns,
  tick/trin/market-profile (need tick infra), typed_* dupes.
- `vanilla/js/market-ind.js`: OSC_ORDER 6 -> 44, OVERLAY_DEFS 4 -> 19,
  oscOne/priceOverlays branches, shared renderIndMenu dropdown;
  `vanilla/js/market-desk.js` consumes it (sprawl rows deleted).
- `index.html`: 5 new script tags (order: base, osc, tulip, tmom, tvol, qx,
  pool-history before pool consumers).

## 3. Manual tests + observed results (headless, zero console errors throughout)

- `#/pools/1.19.133` @1440: "200 swaps via community index", 5m candles +
  volume + SMA, INDICATORS menu (66 items), VWAP live, synth Asks/Bids with
  depth bars + staircase, spread +0.00001036 (positive), tape rows with
  executed amounts + account links, MY EXCHANGES tab.
- Same @390: stacked, no overflow, badge wraps.
- `#/pools/1.19.0` testnet: ES correctly yields nothing (mainnet-only
  index, strict guard), chain method absent on testnet.xbts.io (proved
  method-not-found) -> honest "unavailable" + Retry. Chain fallback itself
  proven on mainnet (Pool.history 3 rows with results).
- Menu: CCI+OBV panes verified live in DOM; all 66 boxes enabled.
- Testnet reset noted: slice-12 pools 1.19.66/67 no longer exist.

## 4. Vectors

- `tooling/pool-history-test.js`: 21/21 (synth slices incl. fee haircut,
  best-first ordering, mixed-precision guard, candle OHLC/B-volume,
  orientation both ways, ES-doc parse + guards).
- `tooling/indicators-parity-test.js`: 63/63 (hand-computed + bounds +
  ordering invariants per fn).
- Percent vector (audit): taker 0.5% renders from units (pool strip).

## 5. Screenshots

`/tmp/vpool-desk.png` (desk), `/tmp/vpool-tall2.png` (book+tape),
`/tmp/vpool-390.png` (phone), `/tmp/vpool-tnet3.png` (testnet honest gap),
`/tmp/vind-menu.png` + `/tmp/vind-panes.png` (menu + new panes).
Theme trio: ref-theme verified headless; light/dark render via shared
MarketInd tokens (per-slice trio stays with the human tester round).

## 6. Headers/descriptions

pool-history.js header owns/consumes/side-effects/refs/provenance; every fn
has what/params/fails. No dead text (OP_NAMES deleted with the old tape).

## 7. Anti-rot

(a) 2036: ES host may die — every path degrades to chain or honest text;
no build, no npm, no framework. (b) New deps: NONE (fetch is platform;
endpoint is data like a node URL, removable by deleting one constant).
(c) Deletable: ES adapter (chain covers), synth book (curve remains),
per-indicator branches (base 25 remain). `check_rot.py` PASS.
