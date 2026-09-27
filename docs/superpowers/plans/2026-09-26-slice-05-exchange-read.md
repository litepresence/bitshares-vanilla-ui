# Slice 05 (Exchange Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only DEX desk — market picker with search, orderbook with depth, recent trades, 24h stats, canvas price + depth charts with SMA/EMA overlays, and my open orders (display only). No placing/canceling (slice 6).

**Architecture:** `market.js` (read-only data layer on `Chain`) feeds `market-ui.js` (tables + canvas charts). `format.js` gains BigInt price math; new `indicators.js` holds pure-function SMA/EMA. Refresh is interval-based (15s + manual); socket subscriptions are slice-6 scope.

**Tech Stack:** Vanilla JS + Canvas2D. Node 20 stdlib for checks. Python 3 for rot gate.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable.
- NO float money math: prices computed with BigInt only (spec below); `Number()`/`parseFloat` forbidden for money. Indicator math (SMA/EMA over bucket closes for CHART PIXELS) may use Numbers — chart coordinates are not money, but the underlying bucket values stay raw until plotted.
- marketID convention: `QUOTE_BASE` symbols, uppercase (`MarketRow.jsx:70`); same-asset → 404.
- Chain facts (verified): `get_order_book(base,quote,limit)` + `get_ticker(base,quote)` on database api (`database_api.hpp:618,636`); `get_fill_order_history(a,b,limit)`, `get_market_history(a,b,bucket,start,end)`, `get_market_history_buckets()` on history api (`api.hpp:208-242`, reached via login `"history"` = existing `Chain.history()`); `get_limit_orders_by_account(name_or_id, limit?)` on database (`database_api.hpp:495-498`).
- Base/quote orientation is DISPLAY: chain calls take `(base, quote)` asset ids; displayed price is base-per-quote human in `QUOTE_BASE` terms (proven vs #1 OrderBook + chain `price_to_string`; orderbook levels arrive as chain-human strings, displayed verbatim).
- Test keys only on testnet. Viewports 360px→4K; ≥44px; no hover-only UI. One global per file + `module.exports` guard.

---

## File Structure

```
vanilla/
├── js/
│   ├── format.js      ← TASK 1: +formatPrice (BigInt, exact algorithm below)
│   ├── indicators.js  ← TASK 1: sma/ema pure functions (exact below)
│   ├── market.js      ← TASK 2: data layer (exact API below)
│   ├── market-ui.js   ← TASK 3: picker, book, trades, stats, charts, my orders
│   └── router.js      ← TASK 3: wire /market/:marketID (+ redirect / → default market)
└── notes/
    └── slice-05-exchange-read.md  ← TASK 4: parity note
```

---

### Task 1: Price math + indicators (no float for money, Numbers for pixels)

**Files:**
- Modify: `vanilla/js/format.js` (append + export entries ONLY).
- Create: `vanilla/js/indicators.js`.

**Interfaces:**
- `Format.formatPrice(baseRaw, basePrec, quoteRaw, quotePrec, places)` — human price string with EXACTLY `places` decimals, BigInt only, round-half-up. Exact code:

```js
function formatPrice(baseRaw, basePrec, quoteRaw, quotePrec, places) {
  var b = BigInt(baseRaw), q = BigInt(quoteRaw);
  if (q === 0n) throw new Error("zero quote amount");
  if (places < 0) throw new Error("bad places");
  var num = b * (10n ** BigInt(quotePrec)) * (10n ** BigInt(places));
  var den = q * (10n ** BigInt(basePrec));
  var rounded = (num * 10n / den + 5n) / 10n; // round-half-up at places+1
  var s = rounded.toString();
  while (s.length <= places) s = "0" + s;
  return places === 0 ? s : s.slice(0, -places) + "." + s.slice(-places);
}
```

- `indicators.js` global `Indicators`: `sma(closes, period)` and `ema(closes, period)` over JS number arrays, returning arrays same-length with `null` for warmup bars (standard definitions: SMA = rolling mean; EMA seeded with SMA(period) at index period-1, k=2/(period+1)). Verify against Tulip published vectors in Task 4 (SMA(10)/EMA(10) on a fixed 20-close fixture — record fixture + expected in parity note).

- [ ] **Step 1: Append `formatPrice` + create `indicators.js`** (~60 lines, headers + guards).
- [ ] **Step 2: Checks** — `node --check` both, exit 0, plus:

Run:
```
node -e "
const F = require('/workspace/vanilla/js/format.js');
const I = require('/workspace/vanilla/js/indicators.js');
if (F.formatPrice('100000','5','2000000','6',4) !== '0.5000') throw new Error('price1');
if (F.formatPrice('1','5','3','5',4) !== '0.3333') throw new Error('rounding');
const c=[1,2,3,4,5,6,7,8,9,10];
if (JSON.stringify(I.sma(c,5).slice(4)) !== JSON.stringify([3,4,5,6,7,8])) throw new Error('sma');
const e=I.ema(c,5); if (!(e[4]===3 && e[9]>e[8] && e.slice(0,4).every(x=>x===null))) throw new Error('ema');
console.log('PRICE+INDICATOR VECTORS GREEN');"
```
Expected: `PRICE+INDICATOR VECTORS GREEN`, exit 0.

---

### Task 2: `market.js` — read-only data layer

**Files:**
- Create: `vanilla/js/market.js`.

**Interfaces:**
- Consumes: `Chain` (`db()`, `history()`, `call`), `Format`, `Indicators`, `Wallet` (my orders only — read accessor, do NOT modify `wallet.js`).
- Produces: global `Market`:
  - `Market.parseId(marketID)` → `{quote, base}` symbols (uppercase split; same-asset throws `"bad-market"`).
  - `Market.assets(quoteSym, baseSym)` → `lookup_asset_symbols` → `{quote:{id,symbol,precision}, base:{...}}` (assert numeric precision each, else `"bad-asset-shape"`).
  - `Market.book(baseId, quoteId, limit=50)` → `get_order_book` → `{bids:[{price, base, quote}...], asks:[...]}`. Levels carry CHAIN-HUMAN price strings (display verbatim); raw amounts via `Format.formatAmount`. Orientation base-per-quote proven (see Global Constraints).
  - `Market.depth(book, basePrec, quotePrec)` → cumulative `{priceFloat, totalBase, totalQuote}` arrays for charting (Numbers allowed — pixels, not money; totals also kept as raw strings for any displayed sums).
  - `Market.trades(baseId, quoteId, limit=30)` → `get_fill_order_history` → raw rows + `displayPrice` each (fill rows carry price base/quote — read exact shape live, record it; STOP if shape contradicts the plan, do not reshape blindly).
  - `Market.stats(baseId, quoteId)` → `get_ticker` → raw ticker object passthrough + formatted `latest`/`highBid`/`lowAsk` where present.
  - `Market.candles(baseId, quoteId)` → `get_market_history_buckets` → pick 3600 if present else largest → `get_market_history` last 7 days → raw bucket array `[{open,high,low,close,volume}...]` + closes[] for indicators (empty array is VALID — thin testnet markets render "no history" states).
  - `Market.myOrders()` → throws `"wallet-locked"` unless unlocked; `get_limit_orders_by_account(myId, 100)` → raw orders (NO cancel path — slice 6; UI shows them read-only).

- [ ] **Step 1: Write `vanilla/js/market.js`** (~200 lines, header + descriptions + guard).
- [ ] **Step 2: Syntax check** — `node --check vanilla/js/market.js`, exit 0.

---

### Task 3: `market-ui.js` — desk, picker, charts, my orders + wiring

**Files:**
- Create: `vanilla/js/market-ui.js`.
- Modify: `vanilla/js/router.js` (`/market/:marketID` entry ONLY + `/` redirect to default market), `vanilla/index.html` (script tags in dependency order — read current order first).

**Interfaces:**
- Consumes: `Market`, `Format`, `Indicators`, `Wallet`, `Store`.
- Produces: global `MarketUI.renderMarket(root, marketID)`:
  - Picker: search input (symbol substring, case-insensitive) over a curated list per network (mainnet: `BTS_USD BTS_CNY BTS_BTC BTS_ETH`; testnet: discover live — probe `get_ticker` on candidates `TEST_*`? testnet assets unknown ahead → picker ALSO accepts direct `QUOTE_BASE` typed entry validated via `lookup_asset_symbols`; record discovered testnet pairs in parity note) + ticker stats row (24h change/volume, formatted).
  - Book: two tables (asks top inverted, bids) with Price | Amount | Total, cumulative-depth shading via inline `background: linear-gradient` percentage bars (pure CSS, no lib), spread + midpoint header.
  - Trades: time + price + amount rows (formatted), `<details>` raw JSON.
  - Charts (Canvas2D, `devicePixelRatio`-aware, theme variables for colors, redraw on theme/viewport change): price panel (closes line + SMA(10)/EMA(50) overlays + legend; empty-state text when no buckets) + depth panel (cumulative bid/ask areas). NO axes library — minimal hand-drawn min/max labels, human-formatted.
  - My orders (only when unlocked; otherwise "unlock to see your orders" hint with link): price/amount/side rows, NO cancel button (slice 6 owns it — show a disabled-looking "cancel (slice 6)"? NO — show nothing cancel-like at all; a disabled control promises a feature. Just rows.).
  - Refresh: 15s interval + Refresh button; interval cleared on route change (unsubscribe pattern like other pages — verify no cross-page timers leak); full offline → error panel + Retry, never blank.
  - Responsive: ≥1200px three-column (book | chart+trades | picker/stats); <720px stacked (chart, book, trades, picker); tables→cards <560px reusing existing patterns.

- [ ] **Step 1: Write `vanilla/js/market-ui.js`** (~400 lines — if it passes ~450, SPLIT into `market-ui.js` + `market-charts.js` per §3.7 and record the split).
- [ ] **Step 2: Router + script tags** (exact entries/paths).
- [ ] **Step 3: Syntax checks** — `node --check` all touched JS, exit 0.

---

### Task 4: Verify, parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-05-exchange-read.md` (+ throwaway `/tmp/mkt-*.js`, NOT committed).

- [ ] **Step 1: Gates** — `python3 tooling/check_rot.py` exit 0; float-money grep CLEAN (`parseFloat|Math.pow(10` — `Math.round` inside canvas pixel code is allowed, record each hit as pixels-not-money or remove).
- [ ] **Step 2: Live vectors** — `/tmp` WS client (proven framing): testnet market with the BEST liquidity found (probe candidates, record choice + book depth found); for ≥3 book levels: hand-verify displayed price = BigInt formula from raw amounts (independent inline reimplementation, no `format.js` import); ticker fields recorded; fills (if any — thin markets may have none: record empty-state proof instead); buckets (if none: empty-state proof + indicator overlays verified on SYNTHETIC fixture instead, labeled as such); non-TEST precision asset REQUIRED in at least one vector (else fetch a second market).
- [ ] **Step 3: Error paths** — bad market id (`BTS_BTS` → 404), unknown asset, history-plugin-missing node behavior (record per node), locked my-orders, offline panel.
- [ ] **Step 4: Headless shots** (dev server + `tooling/visual/shot.mjs`): market page @1440 + @390, dark theme — READ them, fix layout breaks, record.
- [ ] **Step 5: Parity note** (seven fields + §3.7: reference file:lines — core `:475,:495,:618,:636,:662` + api.hpp history section, #1 `MarketRow.jsx:70` convention + orientation proof, #3 fee/price precedents where used; serializer: none new (read-only — state explicitly); vectors incl. fee-less note (no signing, no fees); theme trio + both viewports PENDING-BROWSER with tester steps; §4.5(a–c)).
- [ ] **Step 6: Audit** (all eight checks; browser-dependent honestly PENDING-BROWSER). No slice 6 until green-minus-browser.
