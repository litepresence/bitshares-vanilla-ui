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

## 2. Findings + fixes (all in this commit unless noted)

**F1. Exchange note lied (fixed earlier, 19f5e89 — re-verified here).**
`paintCountNote` echoed the request ("2000 × 1h") while leading-gap drops
delivered 1610. Now states actuals ("1610 of 2000 × 1h candles · deep ·
live") via the `candleKey` staleness guard. Live matrix on BTS/CNY: 5m
1372, 15m 1826, 1h 1623, 4h 1574, 1D 1502, 1m 2000/2000, 1W 575/2000,
Discrete 1000 fills — every row sorted, deduped, slot-aligned.

**F2. Chain-silent windows blanked the chart despite ES fills (FIXED HERE).**
`Market.candles` early-returned `[]` before the deep merge whenever no
chain slot matched, so a pruned/gapped history node showed "No price
history" while the index held the fills. The merge now runs regardless;
chain-wins ordering is untouched, so silent-chain + empty-cache resolves
the identical honest empty as before. Vectors:
`tooling/market-candles-es-fallback-test.js` (7 pass: empty stays empty,
post-deepen rescue paints 1 slotted bucket, deep=true, count cap holds).

**F3. Pool merge cap ignored the count input (FIXED HERE).**
`rebucket()` merged ES under a hardcoded 2000, truncating a 5000-wide
request. Now the live input value. Trailing slice already used it.

**F4. Pool note never stated plotted buckets (FIXED HERE).**
`P.countNote` read "98 swaps · 300s candles" with no candle count at all.
Now mirrors the exchange contract: "98 swaps · 400 of 2000 × 5m
candles · live" (shortfall) / "… · 2000 × 5m candles" (full), with
`bucketLabel` names (1m…1W) instead of raw seconds. Keys
`pool_detail.candle_count{,_partial}` in all 12 locales. Live matrix on
pool 1.19.0 (1000-swap ES tape): 1m 537, 5m 400, 15m 314, 30m 260, 1h 216,
4h 114, 1D 28, 1W 5 — every cell sorted, deduped, slot-aligned, sliced to
count. Source contracts: `tooling/pool-rebucket-count-test.js` (5 pass).

**F5. Backend history flapping (DOCUMENTED, not fixed — out of scope).**
`wss://api.bitshares.dev/ws` alternates between a full archival state
(382-row windows) and a nearly-empty one (0–2 rows) for identical calls
— backend rotation or intermittent pruning behind one endpoint. The app
degrades honestly in every observed state (empty states, actual-count
notes, 15s refills + 3.5s tip polls self-heal) and every merge stays
correct on whatever arrives. No app change can fix server-side history;
the note honesty work (F1/F4) is what makes the flap legible instead of
mysterious.

## 3. Manual test steps + observed result (headless Chromium, mainnet)

- `#/market/BTS_CNY` each timeframe radio (5m→Discrete): notes above,
  zero console errors; 1h chart paints 1623 candles
  (`candles-audit/exchange-1h-rendered.png` — 756 green body pixels
  sampled live, note "1623 of 2000 × 1h candles · deep · live").
- `#/pools/1.19.0` each timeframe radio: notes above, candles paint
  (`candles-audit/swap-5m-rendered.png`), zero console errors.
- Count input 2000→500 on exchange: refetch returns exactly 500, note
  "500 × 1h candles" (input path exonerated — it always worked).
- Backend-pruned session: honest "No price history" empty (pre-fix code);
  post-fix logic proven headless (F2 vectors) — live re-proof left to a
  pruned-backend session since backends flap by the minute.

## 4. Vectors (#6)

| Raw | Rule | Display | Where |
|---|---|---|---|
| 1000-fill ES tape, 300s, count 500 | trailing slice | 400 plotted of 500 | pool matrix |
| 1000-fill ES tape, 86400s, count 2000 | bounded tape | "28 of 2000 × 1D" | pool note |
| chain [], 1 ES fill @slot | ES-only merge | 1 bucket, deep=true | es-fallback vectors |
| chain 1623 + ES overlap | chain wins | chain close kept | market-fills-test merge vectors |
| volumes raw "300000" p5 | Format at render | human string | fillsToCandles vector |

No float money math anywhere on these paths (BigInt ratios, Format only);
fills are integer counts feeding pixels.

## 5. Themes + viewports

Ref/blue/dark trio + 1440/390 covered for these desks under
`docs/parity/market-hops/` (same panes, unchanged styling — this commit
touches data + note strings only, zero CSS/DOM shape changes). The two new
shots here are ref/1440 records of painted charts.

## 6. Readability (§3.7)

`candles()` early-return site carries the why (audit date, symptom,
doctrine preserved); `rebucket()` merge-cap line states the live-count
rule; no TODO/FIXME (grepped); `market-candles-es-fallback-test.js` and
`pool-rebucket-count-test.js` document the contracts.

## 7. Anti-rot gate (§4.5)

- (a) No new transport/host/API surface: same ES seam, same WS methods,
  same merge functions. A vanished index yields the pre-existing empties.
- (b) New dependencies: none. Removal = restore the early return +
  the 2000 literal + the old note line.
- (c) Smallest deletable subset: the early-return deletion, the
  `pnMerge` variable, the note branch. Everything else stands without them.

## 8. Gates

- New: `market-candles-es-fallback-test` 7 pass, `pool-rebucket-count-test`
  5 pass. Unchanged green: `market-candles-orient-test`,
  `market-fills-test`, `pool-history-test`, `market-count-note-test`,
  `market-net-ui-test`, `pool-net-ui-test`, `market-desk-map-test`.
- `bash tooling/check_types.sh` PASS · `python3 tooling/check_i18n.py` OK
  (3824 keys, 5064 call sites drift-free) · `python3 tooling/check_rot.py`
  PASSED · `scan_dead_css` untouched (no CSS in this commit).
