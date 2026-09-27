# Slice 07 (Indicators + Real Candles + Desk Restyle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Indicator-rich real financial charts — full QTradeX indicator set as dependency-free math, multi-timeframe interpolated red/green candlesticks on a vendored MIT chart core, and a desk restyle toward the original's density with DEX-UX-flavored dark mode.

**Architecture:** `indicators.js` grows the full catalog (pure functions, verified vectors). `market.js` gains timeframe-aware interpolated candles. Price pane renders through vendored lightweight-charts; depth stays our canvas; desk CSS gains density + stats strip + picker filters.

**Tech Stack:** Vanilla JS + Canvas2D + ONE vendored file (`lightweight-charts.standalone.production.js`, Apache-2.0). Node 20 stdlib for checks. Python 3 for rot gate.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable.
- No float money math (audit greps): candles carry raw ints; display via `Format`; indicator math on Numbers is pixels-only (chart coordinates, never balances).
- Indicator formulas: Tulip 12 verified against Tulip published vectors; QTradeX-community ones ported from repo raw (`qi.pyx`/`utilities.pyx`/strategy files — consult on demand) with per-indicator provenance + vectors recorded. MSW + FFT-lowpass included ONLY if a verifiable formula is found in QTradeX raw — else recorded deferral, never guessed.
- Buckets: supported set from live `get_market_history_buckets` (observed `[60,300,900,1800,3600,14400,86400]`); timeframe choices intersect preferred `[300,900,1800,3600,14400,86400]`; default 3600, count default 200.
- Interpolation (exact): slot grid = last N bucket boundaries ending at current bucket; map returned buckets by start time; empty slot → O=H=L=C=prevClose, volume=0; leading empties (no prevClose) dropped; red iff close<open else green.
- Dark theme resembles DEX-UX (palette below); original-blue/light keep #1 look (PALETTE.md stays authoritative for those).
- Test keys only on testnet (reads only this slice — no signing). Viewports 360px→4K; ≥44px; no hover-only UI. One global per file + `module.exports` guard.

---

## File Structure

```
vanilla/
├── js/
│   ├── vendor/lightweight-charts.standalone.production.js ← TASK 1 (vendored)
│   ├── vendor/PROVENANCE.md   ← TASK 1 (append entry)
│   ├── indicators.js          ← TASK 2 (full catalog)
│   ├── market.js              ← TASK 3 (timeframes + interpolation; modify)
│   ├── market-charts.js       ← TASK 4 (candle pane + indicator panes; modify)
│   ├── market-ui.js           ← TASK 5 (stats strip, picker filters, invert, log toggle; modify)
│   ├── app.css (css/)         ← TASK 5 (density pass; modify)
│   └── themes.css (css/)      ← TASK 5 (DEX-UX dark values; modify)
└── notes/
    └── slice-07-indicators.md ← TASK 6: parity note
```

---

### Task 1: Vendor lightweight-charts (MIT-class, single file)

**Files:**
- Create: `vanilla/js/vendor/lightweight-charts.standalone.production.js` (byte-fetch, never edited).
- Modify: `vanilla/js/vendor/PROVENANCE.md` (append entry ONLY).

- [ ] **Step 1: Fetch + verify**

Run:
```
curl -sL "https://registry.npmjs.org/lightweight-charts" -o /tmp/lwc-meta.json
node -e "const d=require('/tmp/lwc-meta.json'); console.log(d['dist-tags'].latest, d.versions[d['dist-tags'].latest].license)"
```
Expected: version printed, license `Apache-2.0` (verified 5.2.1 at plan time — record ACTUAL fetched version; if license differs: STOP and report).
Then download the standalone production build for that version from unpkg/jsdelivr
(`https://unpkg.com/lightweight-charts@<V>/dist/lightweight-charts.standalone.production.js`)
to the vendor path, and record its sha256 + byte size in PROVENANCE.md with:
source URL, version, license, date, and the doctrine note (self-contained, no
backend, pinned; canvas fallback retained in market-charts.js).
- [ ] **Step 2: Load check** — `node --check` the file (must parse; it's a UMD/global build exposing `LightweightCharts`), exit 0. Confirm NO other files were added (single-file vendor).

---

### Task 2: Full indicator catalog in `indicators.js`

**Files:**
- Modify: `vanilla/js/indicators.js` (append ONLY; keep existing sma/ema byte-identical).

**Locked list (24):** sma, ema, macd, rsi, stoch, aroonosc, adx, bbands, stddev, atr, fisher, psar (Tulip — verify vs Tulip published vectors) + mfi, vwap, zlema, trima, hma, uo, fosc, dmi (up/down pair), renko, heikinashi, ichimoku, frama (QTradeX-community — port from repo raw, provenance per function). MSW + FFT-lowpass: include ONLY with verifiable formula, else recorded deferral.
- Conventions: pure functions over number arrays; same-length outputs with `null` warmup (existing convention); params objects with QTradeX-compatible defaults (record each default + source).
- [ ] **Step 1: Implement** (~400 lines max — if passing ~500, SPLIT `indicators-trend.js`/`indicators-osc.js`? NO new files beyond plan without director approval: record split candidate instead).
- [ ] **Step 2: Vector checks** — `node` script (inline in report): Tulip 12 vs published vectors (fetch tulipy docs vectors on demand, record URLs); community ones vs hand-computed fixtures + invariants (BBands upper≥middle≥lower; RSI/Stoch within 0–100; ATR≥0; Heikin-Ashi close = (O+H+L+C)/4 identity). ALL GREEN or STOP.

---

### Task 3: Timeframes + interpolated candles in `market.js`

**Files:**
- Modify: `vanilla/js/market.js` (extend candles path + export entries ONLY).

**Interfaces:**
- `Market.timeframes()` → supported bucket list from live `get_market_history_buckets` (cached per session).
- `Market.candles(baseId, quoteId, bucketSec, count=200)` → fetch `[start,end]` window sized `count*bucketSec` back from now → interpolate per Global Constraints → array of `{timeMs, open,high,low,close (RAW int strings), volumeBase raw, red}` + `closes[]` Numbers for indicators. Empty result VALID (renders empty state).
- Keep existing `candles()` signature working (default bucket 3600, count 200) — callers unchanged.
- [ ] **Step 1: Implement** (~80 lines).
- [ ] **Step 2: Syntax check** + unit test interpolation in node with a SYNTHETIC bucket array (gap in middle → carried close + zero volume; leading gap → dropped; red/green flags) — exact fixture in report, exit 0.

---

### Task 4: Candle + indicator panes (vendored core) + desk restyle inputs

**Files:**
- Modify: `vanilla/js/market-charts.js` (price pane via LightweightCharts; depth stays canvas), `vanilla/js/market-ui.js` (picker filters, invert, log toggle, stats strip, timeframe picker), `vanilla/css/app.css` (density), `vanilla/css/themes.css` (dark values), `vanilla/index.html` (ONE tag: vendor file BEFORE market-charts.js).

**Interfaces:**
- `MarketCharts.drawPrice(doc, canvasHostEl, {candles, overlays:[{name,color,values}], logScale})` — builds a LightweightCharts chart in the host el: candlestick series (up `#26de81`/down `#ff231f`), volume histogram, overlay line series per indicator, crosshair + time scale (gaps shown as whitespace — never compressed), theme colors passed in (no hardcoded colors; dark pane bg `#131722`, grid `#2a2e39`, text `#c5cbce`). If `LightweightCharts` global absent → fallback to existing canvas line renderer (keep that code path intact and TEST it by temporarily hiding the global in a headless check — record the test).
- Timeframe picker: radio row (labels from supported buckets: 5m/15m/30m/1h/4h/1D as available) + candle count note ("N×interval"); indicator picker: checkboxes for overlay set (SMA/EMA/BB/PSAR on price; RSI/MACD/Stoch/ATR/Fisher each in its OWN stacked sub-pane with independent scale (ranges incompatible — never shared), plus optional Volume histogram pane; panes individually removable; canvas fallback draws one simple line chart per pane (Task 4b); Log toggle (priceScale mode switch); Invert toggle (re-fetch swapped QUOTE_BASE pair and re-render — cheap, ported from DEX-UX).
- Picker filters (ported from DEX-UX market selector): asset-type radios MPA/UIA/BTS (+LPT/POOL only if classifiable from asset fields live — else recorded deferral) + existing search; favorites star per market persisted in localStorage (own key, documented).
- Header stats strip (toward #1: Latest / 24h change / 24h volume / Best bid-ask — compact row above charts, theme-aware).
- Density pass (principle #2 + user styling review): compact book rows, smaller desk headings, tighter section spacing on the desk ONLY (no global body changes without recording); dark theme values converge on DEX-UX (bg panels `#131722`, borders `#2a2e39`, text `#e0e3eb`, muted `#758696`, accent `#007bff`, buy `#26de81`, sell `#ff231f`); original-blue/light keep PALETTE.md authority (no cross-theme leakage — verify per theme).
- bookClick-to-fill (DEX-UX pattern: click book row fills trade form): NOT in scope — recorded as slice-6 follow-up in the parity note, not implemented here.

- [ ] **Step 1: Implement** (charts ~200 new lines; ui/css edits minimal-diffs).
- [ ] **Step 2: Syntax checks** — `node --check` all touched JS, exit 0.

---

### Task 5: (moved) — see Task 6.

### Task 6: Verify, parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-07-indicators.md` (+ throwaway `/tmp/ind-*.js`, NOT committed).

- [ ] **Step 1: Gates** — `python3 tooling/check_rot.py` exit 0 (vendor file is a static asset, must pass); float-money grep CLEAN (`Math.*` allowed ONLY in charts/indicators pixel code — list each hit as pixels with file:line or remove).
- [ ] **Step 2: Indicator vectors** — all 24 (+2 conditional) GREEN per Task 2 procedure, recorded with sources (Tulip URLs / QTradeX raw paths).
- [ ] **Step 3: Live candle proof** — testnet market with the richest buckets: fetch → interpolate → assert slot regularity (uniform time grid), gap-fill correctness (a known sparse window), red/green on every candle; non-TEST precision market REQUIRED in at least one vector.
- [ ] **Step 4: Headless shots** (dev server + shot.mjs, READ them): desk @1440 + @390, dark + original-blue, candles + 2 overlays + oscillator pane visible; compare against `original-pages/market.png` + DEX-UX dark values; fix NOTHING in code (report findings); record.
- [ ] **Step 5: Parity note** (seven fields + §3.7: reference file:lines — QTradeX raw paths per indicator, Tulip vector URLs, dex-ux `order_book.html`/`style.css` feature sources, lightweight version+hash+license; serializer: none new; vectors; theme trio + both viewports PENDING-BROWSER with tester steps; §4.5(a–c) incl. vendor-file justification).
- [ ] **Step 6: Audit** (all eight checks; browser-dependent honestly PENDING-BROWSER). No slice 8 until green-minus-browser.
