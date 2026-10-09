# Parity Note — Candle Audit (both desks, every timeframe)

Date: 2026-10-08. Scope: verify every timeframe pulls the selected candle
count via the correct merge (ES + node buckets + live tip on the exchange
desk; ES + live on the swap desk), fix what lies, prove it visually.

## 1. Reference behavior

- #1 (`bitshares-ui`): `MarketsActions.getMarketHistory(bucket)` + `PriceChart`
  renders whatever the node returns for one bucket at a time; no count
  input, no ES backfill, no live tip merge. Nothing to match — vanilla
  supersedes it (count input + deep backfill + live tip are vanilla-only).
- Chain truth (#4): `get_market_history(base, quote, bucket, start, stop)`
  serves ≤200 buckets per call (the 2026-10-02 fix paginates backward from
  the tip in 200-slot chunks because of this cap); history nodes may prune.
- ES truth: op-4 fills (`market-fills-history.js`, kibana_fills shape) and
  op-63 swaps (`pool-history.js`, kibana_swaps shape) bucketed by
  `floor(unix/size)` with prev-close carry for gaps.
- **ES paging pattern (this fix's source):** squidKid-deluxe/
  `BitShares-Historical-Charts` — `pools.js:2-49` (range + `search_after`
  query builder) and `main.js:214-261` (`queryElasticsearchWithPagination`,
  10,000/page loop, short-page stop). Ported as math + query shape only.

## 2. Findings + fixes

**F1. Exchange note lied (fixed earlier, 19f5e89 — re-verified here).**
`paintCountNote` echoed the request ("2000 × 1h") while leading-gap drops
delivered 1610. Now states actuals ("1610 of 2000 × 1h candles · deep ·
live") via the `candleKey` staleness guard. Live matrix on BTS/CNY: 5m
1372, 15m 1826, 1h 1623, 4h 1574, 1D 1502, 1m 2000/2000, 1W 575/2000,
Discrete 1000 fills — every row sorted, deduped, slot-aligned.

**F2. Chain-silent windows blanked the chart despite ES fills (FIXED).**
`Market.candles` early-returned `[]` before the deep merge whenever no
chain slot matched, so a pruned/gapped history node showed "No price
history" while the index held the fills. The merge now runs regardless;
chain-wins ordering is untouched, so silent-chain + empty-cache resolves
the identical honest empty as before. Vectors:
`tooling/market-candles-es-fallback-test.js` (8 pass).

**F3. Pool merge cap ignored the count input (FIXED).**
`rebucket()` merged ES under a hardcoded 2000, truncating a 5000-wide
request. Now the live input value. Trailing slice already used it.

**F4. Pool note never stated plotted buckets (FIXED).**
`P.countNote` read "98 swaps · 300s candles" with no candle count at all.
Now mirrors the exchange contract: "98 swaps · 400 of 2000 × 5m
candles · live" (shortfall) / "… · 2000 × 5m candles" (full), with
`bucketLabel` names (1m…1W) instead of raw seconds. Keys
`pool_detail.candle_count{,_partial}` in all 12 locales.

### F5 — THE REPORTED BUG: the window was capped in EVENTS, not in TIME
*("no matter the timeframe I only see data back to June", pool 1.19.2.)*

The ES backfill asked for a flat **1000 newest events** (`ES_MAX_EVENTS`,
2 pages × 500) on both desks. Events span whatever wall-clock that happens
to be, so on a sparse pool the reachable window was a fixed ~5 months:

| request | old reach (1000 events) | measured |
|---|---|---|
| pool 1.19.2, any bucket | 2026-05-19 → 2026-10-08 | **142 days** |
| BTS/CNY 1h | 1000 fills | 1623 of 2000 buckets |

That is exactly the reported symptom: 2000 daily candles painted ~140 and
stopped, because the *window* never widened — switching timeframe only
re-bucketed the same 142 days. Measured against the index, which held
**69,722 swaps for that pool back to 2021-04-18**.

**Fix (both desks, same shape):** compute the span the candles actually
need (`bucket × count`), push it into the query as a
`block_data.block_time` **RANGE**, and page with `search_after` until the
**span is covered** rather than until an event count runs out
(`PoolHistory.esSwapsWindow` / `MarketFills.esFillsWindow`, with
`swapsForPoolWindow` / `fillsForMarketWindow` wrappers keeping the
mainnet/ES-pref/leg-filter/fail-to-chain contract).

Two hard-won constants behind it:
- **`size` is capped at 10 000.** Measured 2026-10-08: `size: 20000`
  returns **HTTP 200 with zero hits** — a silent data-loss trap. Depth is
  bought with paging, never with a bigger page.
- **ES `sort[0]` is epoch MILLIS** on this index, so `Date.parse` of it is
  NaN. Coverage is measured from the parsed rows' own `.time`; the sort key
  is passed back verbatim.

Depth is bounded and disclosed: 8 pages / 80k events / 60s wall clock, and
`capped` propagates to both desks' count notes
(`pool_detail.candle_capped`, `market_ind.count_capped` — "window
truncated"), so a budget-capped window never reads like "the pool has no
older swaps".

**F6. The deep cache was keyed by bucket only — a count edit reused a stale
window** (FIXED). Both desks now key the deep cache on `bucket|count`
(`P._deepKey`, `_deepCache.key`), so widening the count re-walks instead of
reusing a span sized for the previous request.

**F7. The deep result only painted at the very end** (FIXED). A 2000-day
window is 60k+ swaps and tens of seconds; showing it only on completion
means staring at a short chart. Both walks now hand off **every page**
(`opts.onPage`) and the desks merge each one under chain authority, so the
chart visibly deepens. Verified live: pool 1.19.2 1D went
18 → 1930 candles across the walk (7 × 10 000 pages).

**F8. Freshly loaded history rendered off-screen (FIXED).** Two layered
causes, both measured in-browser:
1. `tryPriceUpdate`'s in-place `setData` path handled *any* dataset change,
   which keeps the old visible range. It now fast-paths only same-size
   repaints and the +1 tip rollover; a materially different dataset
   rebuilds.
2. The vendored lightweight-charts **does not fit content by default** —
   after `setData` of 1930 daily bars the visible logical range was
   `{from: 1798.7, to: 1931}` (the last ~132 bars), and a *synchronous*
   `fitContent()` was a no-op. `ChartsLwc.fitOnNextFrame` now defers the
   fit by one frame, where it does take effect.
Zoom memory is preserved where it should be: same-size repaints (theme,
resize, live tip) still replay the captured range — now guarded by bar
count, so a captured zoom is never replayed onto a different dataset
(`savedRange`/`restoreRange` carry `len`; oscillator panes apply the same
guard locally, so panes can't disagree).

**F9. Backend history flapping (DOCUMENTED, not fixed — out of scope).**
`wss://api.bitshares.dev/ws` alternates between a full archival state
(382-row windows) and a nearly-empty one (0–2 rows) for identical calls —
backend rotation or intermittent pruning behind one endpoint. The app
degrades honestly in every observed state and self-heals on refresh. The
ES walk has the same property: a walk can end on its wall-clock budget
while the index is slow, which is why `capped` is disclosed rather than
hidden. No app change can fix server-side history.

## 3. Manual test steps + observed result (headless Chromium, mainnet)

Pool 1.19.2 (BTS/CNY pool), count 2000, live ES:

| bucket | requested span | swaps walked | candles plotted | note |
|---|---|---|---|---|
| 1m | 1.4 d | 5 | 5 | 5 of 2000 |
| 5m | 7 d | 17 | 15 | 15 of 2000 |
| 15m | 21 d | 88 | 46 | 46 of 2000 |
| 1h | 83 d | 767 | 231 | 231 of 2000 |
| 4h | 333 d | 2 278 | **627** | 627 of 2000 |
| 1D | 2 000 d | 60 000–69 721 | **1 930** | 1 930 of 2000 |
| 1W | 14 000 d | 80 000 (capped) | 237 | … window truncated |

Exchange BTS/CNY, count 2000: 4h 1523 · deep; 1D **1969 of 2000 · window
truncated · deep** (8 × 10 000 pages); 1W 575 · deep. Zero console errors
on both desks.

Visual proof: `candles-audit/pool-1d-deep-2021-2026.png` — the daily chart
spanning **Jul 2022 → Aug 2026** (the fix for the reported symptom; before
it, the same view showed Jun → Oct).

Timing, measured: 4h window ~0.7 s (1 page); 1D window 30–150 s depending
on index speed (4–8 pages). The walk is lazy, cancellable, single-flight,
and paints progressively; the slow cases are inherent to moving 60–80k
indexed docs, exactly as the reference app does.

## 4. Vectors (#6)

| Raw | Rule | Display | Where |
|---|---|---|---|
| 1000-event cap on pool 1.19.2 | fixed by F5 | 142 d → 333 d at 4h | live matrix above |
| `size: 20000` | ES silent-empty trap | page size pinned 10 000 | fills/pool deep-window vectors |
| `sort[0] = 1791470139000` | epoch millis | coverage from `.time` | deep-window search_after vectors |
| chain 1930 + ES 806 (1D) | chain wins, ES widens | 1969 of 2000 | exchange live note |
| 80k events, page ceiling hit | honest cap | "window truncated" | capped vectors + notes |
| 3 pages, 30k swaps | progressive | 10k → 20k → 30k handed over | onPage vectors (both desks) |
| volumes raw "300000" p5 | Format at render | human string | fillsToCandles vector |

No float money math on these paths (BigInt ratios, Format only); fills are
integer counts feeding pixels.

## 5. Themes + viewports

Ref/blue/dark trio + 1440/390 covered for these desks under
`docs/parity/market-hops/` (same panes, unchanged styling — this commit
touches data, range and note strings only, zero CSS/DOM shape changes). The
new shot here is a ref/1440 record of the deep daily chart.

## 6. Readability (§3.7)

Every new constant carries its measurement and the reason it exists (page
ceiling, budgets, the `size` trap); both walk functions document the
coverage stop, the `capped` contract and the sort-shape trap; `fitOnNextFrame`
documents the non-fitting library default and the frame requirement. No
TODO/FIXME (grepped); three test files document the contracts.

## 7. Anti-rot gate (§4.5)

- (a) No new transport/host/API surface: same ES seam, same WS methods, same
  query fields the reference already used. A vanished index yields the
  pre-existing chain-only empties.
- (b) New dependencies: none. Removal = delete the range filter, the paging
  loop and `fitOnNextFrame`; the desks fall back to chain + default view.
- (c) Smallest deletable subset: `fitOnNextFrame` alone fixes the visible
  symptom without the walk (the data would still be short); the walk alone
  fixes the data without showing it. Both are needed for the reported bug,
  and each is independently reversible.

## 8. Gates

- New: `pool-deep-window-test` 51, `fills-deep-window-test` 29,
  `chart-zoom-test` +6 (dataset-change guard + fast-path vectors).
- Unchanged green: `market-fills-test` 29, `market-candles-orient-test` 7,
  `market-candles-es-fallback-test` 8, `market-count-note-test` 9,
  `market-desk-map-test` 44, `market-net-ui-test` 29, `pool-history-test` 65,
  `pool-rebucket-count-test` 5, `pool-net-ui-test` 110, `pool-graph-test` 206.
- `bash tooling/check_types.sh` PASS · `python3 tooling/check_i18n.py` OK
  (3826 keys, 5066 call sites drift-free) · `python3 tooling/check_rot.py`
  PASSED · `scan_dead_css` untouched (no CSS in this commit).
