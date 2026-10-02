# Slice 7 parity note — indicators + candles + desk restyle

Plan: `docs/superpowers/plans/2026-09-26-slice-07-indicators.md` (Tasks 1–6).
Reads-only slice: no signing, no confirm dialog (all `sign*` hits are MACD/fisher
signal lines; headers state no signing path).

## What landed (vanilla file:line)
- `vanilla/js/indicators.js` (~340) — SMA/EMA/MACD/BBands/StdDev/PSAR/ZLEMA/TRIMA/HMA/
  VWAP/HeikinAshi/Renko/Ichimoku/MFI/FRAMA + `warm()`. QTradeX/Tulip formulas,
  canvas-port provenance per header.
- `vanilla/js/indicators-osc.js` (~285) — RSI/Stoch/AroonOsc/ADX/ATR/Fisher/PSAR-extra/
  UO/Fosc/DMI, all BigInt-input closures. Wired `index.html:39` (verified 25/25
  fns live in load order; prior stale "not wired" comments fixed).
- `vanilla/js/market.js` — `candles()` timeframe interpolation, red/green exact-BigInt,
  VALID_EMPTY on no-history, bucket set `[60,300,900,1800,3600,14400,86400]`.
- `vanilla/js/vendor/lightweight-charts.standalone.production.js` — v5.2.1,
  Apache-2.0, sha256 `e21cc5caa0226ef3…598cf` byte-identical, provenance in
  `vanilla/js/vendor/PROVENANCE.md`. Loaded BEFORE `market-charts.js`.
- `vanilla/js/market-charts.js` — price pane + one independently-scaled sub-pane
  per checked key (RSI/MACD/Stoch/ATR/Fisher/Volume histogram), canvas fallback
  one line chart per pane, LWC teardown on `removePane`/route change.
- `vanilla/js/market-ui.js` — stacked `.mkt-osc-pane` wrappers in OSC_ORDER,
  title + ✕ per pane, checkbox↔pane reconciliation in `drawCharts`, desk restyle
  (stats strip, spread line, touch targets, scroll regions).

## Reference behavior (file:line)
- #1 `bitshares-ui/app/components/Exchange/...` — DEX desk layout, bucket sizes;
  TradingView `charting_library/` REJECTED (proprietary+m
irror), replaced by LWC+canvas.
- #2 `astro-ui` instant-trade/market pages — indicator set cross-checked.
- #4 `bitshares-core` — `get_market_history_buckets` live constraint set matches.

## Test vectors (raw → human, all through real format.js/market.js)
- `sma([1..5],3)`→`[null,null,2,3,4]`; `ema5[4]=3`; MACD warmup nulls idx<25;
  RSI14 seed `70.464` (Wilder, self-consistent); stoch `88.89/88.89`.
- Live fill (TEST p5/CNY p2): base `149800000`/quote `74900` → price `2.00000000`,
  amounts `0.02000 TEST` / `0.01 CNY`; ratio cross-check 2.0 agrees.
- Interpolation: 5-slot grid uniform, mid-gap carried prevClose + `volumeBaseRaw="0"`;
  red/green exact (`close>open` green, `<` red, `=` green).

## Percent-field vector (audit follow-up)
- `get_ticker.percent_change` is a chain-HUMAN float, not a hundredths int —
  #1 renders it `parseFloat(ticker.percent_change).toFixed(2)`
  (`bitshares-ui/app/stores/MarketsStore.js:1456`), no /100 division.
- Vanilla renders it verbatim (`market-ui.js:927-929,953-955`): raw `0` → `0`
  (matches #1); raw `2.3456` → `2.3456` (#1 shows `2.35` — display-precision
  delta only, no money risk). Protocol hundredths-int percents (fee splits
  etc.) belong to op slices, not this reads-only slice.

## Manual test (headless, --network testnet, zero console errors ×3)- `/tmp/s7-desk-1440-blue.png` — full desk, live `connected · 39f5e2ed`, honest
  empty states, 1h/200-candle radios, SMA+EMA+MACD checked.
- `/tmp/s7-desk-1440-dark.png` — DEX-UX dark, no leakage.
- `/tmp/s7-desk-390-dark.png` — phone stacks, no overflow (connected pill wraps,
  cosmetic only).
- Light theme + live LWC candles + real-data sub-panes: PENDING-BROWSER (testnet
  bucket history unpopulated — chain condition, head `100916379`).

## Tester pass (queued)
- Light-theme desk shot; check RSI box → own sub-pane appears; check Volume →
  histogram pane; uncheck/✕ removes one pane; phone 390 scroll regions.

## Anti-rot gate (§4.5): (a) yes — static files, no services; (b) LWC vendored
(byte-copy + license + hash), removable → canvas fallback covers all panes;
(c) smallest deletable: osc module (base 14 indicators remain). `check_rot.py` PASS.

## Delta 2026-10-02 — zoom memory, tip generation guard, candle window 2000 (day-1 chart feedback)

Owner reports: exchange chart updates flaky (pool chart fine) + zoom resets
every few seconds in the LWC widget. Root causes, all verified in code:

1. **Zoom reset: every repaint destroyed the chart.** `drawPricePane`/
   `drawOscPane` ran `clearHost` (chart.remove()) + fresh createChart +
   setData on EVERY call — checkbox toggles, theme switches, resizes, and
   each 3.5s live-tip refresh. A fresh chart always opens fit-to-content,
   so zoom could never survive. Fix: capture `getVisibleLogicalRange()`
   before teardown, `setVisibleLogicalRange()` after setData (guarded;
   fresh fit stands on reject). The existing cross-pane mesh already
   tolerates the echo (shared-flag design) — each pane restores its own
   identical range, mesh intact.
2. **Flaky paints: overlapping tip/full/deepen responses with no recency
   rule.** The 3.5s poll, push-debounced refresh, and ES-deepen completion
   could resolve out of order; oldest-wins flickered the chart (thin pairs
   with slow history nodes suffered most — pools looked fine because their
   tape path differs). Fix: `state.tipSeq` generation shared by tips,
   initial fill, and deepen completion — only the newest paints. Plus the
   deepen key is now pair+bucket+COUNT (a count edit used to reuse a
   stale-window ES merge) and the merge cap is the requested count (was a
   hardcoded 2000 while the window said 200).
3. **Candle window input (owner: default 2000, exchange + pools).** One
   shared `MarketInd` number input (1–5000, persisted per profile) beside
   the timeframe radios; all three fetch sites already read the single
   `CANDLE_COUNT` source (export-refresh included — the export is a
   load-time primitive copy). `candles()` default + dead-path fallbacks
   200 → 2000. Invalid entries revert with an honest inline note.

Verification: `chart-zoom-test.js` 21/21 (range capture/restore incl.
degenerate/null/chart-throwing paths; count boundaries); `node --check`
×5; types PASS; rot PASS; i18n OK (2 keys × 10); headless `#/market/BTS_CNY`
@1440: "2000 × 1h candles · deep · live", input rendered with value, zero
console errors. Zoom-hold across a live refresh stays a human check (stills
cannot show retained zoom — but rebuild-destroy is gone by construction).
Anti-rot: (a) platform timers + vendored LWC only; (b) zero new deps (one
localStorage key, two locale keys); (c) deletable: input (2000 default
stands), seq guard (paints race again — kept because the flake was real).
