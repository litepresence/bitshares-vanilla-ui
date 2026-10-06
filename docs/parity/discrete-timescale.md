# Parity note — Discrete timescale (exchange + pool plots)

Date: 2026-10-06. Feature request: a "Discrete" timescale beside 1d/1h/etc.
on the exchange and pool price plots, reviewed against how bitshares-dex-ux
handled discrete plots. Design spec: `docs/superpowers/specs/2026-10-06-
discrete-timescale-design.md`. Implementation plan:
`docs/superpowers/plans/2026-10-06-discrete-timescale.md` (7 tasks, all
landed; deviations from plan recorded in §7).

## 1. Reference behavior (file:line)

bitshares-dex-ux (behavior-only reference — never a dependency):

- `reference/bitshares-dex-ux/order_book.html:108-134` — timescale radios
  `c900…c86400` plus `discrete` LAST (`name="options"`, label `Discrete`);
  chart-type radios `line`/`candle`/`advanced` (`name="candles"`).
- `reference/bitshares-dex-ux/kibana.py:280-316` (`discrete_to_candles`),
  `:367-399` (`append_to_discrete`), `:505-515` (`period == "discrete"`
  passthrough) — discrete is the RAW per-fill list (`[unix, price, volume]`
  + account/block/op + hover text), never bucketed; bucketed candles are
  DERIVED from it. Capped at `KIBANA_CLIP`.
- `reference/bitshares-dex-ux/main.js:47-66` (`chartHandler` routes
  `candleData[2] === "discrete"` away from candle/line renderers),
  `:191-263` (`plotlyChart`: x = unix time, y = price; markers for
  candle/advanced modes, thin line for line mode).
- `reference/bitshares-dex-ux/falcon_app.py:268-307` — inverted markets
  invert price only for discrete (`idx=1`) vs everything-but-time/volume
  for buckets.
- `reference/bitshares-core/.../database_api.hpp:701` —
  `list_liquidity_pools(limit, start_id, …)` (limit FIRST; the probe first
  tried `(start, limit)` and the node rejected it — recorded so nobody
  repeats it). Pool swap rows: `get_liquidity_pool_history(pool, null,
  null, lim)` → `{pool, time, op:{op:[63, body], result:[4, {paid,
  received}]}}` (body shape, not the bare `op_type: 63` number).
- Deliberate vanilla deviations (user-approved): dex-ux has NO volume pane
  in discrete and keeps chart-type radios; vanilla has no chart-type radios
  and the requester explicitly requires an auto discrete-volume plot plus a
  greyed-out menu. Vanilla Discrete = price dots + auto volume stems.

No astro-ui / wallet-extension surface applies (read-only chart mode, no
signing, no keystore, no new WS method).

## 2. Vanilla implementation (file:line)

- `vanilla/js/api/market-fills-history.js` — NEW `fillsToPoints(fills,
  baseId, precB, precQ, quoteId, cap)` after `fillsToCandles` (~line 425):
  newest-first in, oldest-first out, same-second fills stay separate points,
  cap slices newest-first, malformed rows skipped, `bad-count` on cap < 1.
- `vanilla/js/api/pool-history.js` — NEW `swapsToPoints(swaps, assetB,
  precB, cap)` after `swapsToCandles`: same contract on the enriched tape
  (B-leg volume whether paid or received).
- `vanilla/js/api/discrete-charts.js` (NEW, 210 lines) — `drawDiscretePrice`
  (dots, log-opt price y only) + `drawDiscreteVolume` (zero-based linear
  stems, `volumeBaseRaw` magnitude for pixel height only); DPR-aware,
  theme tokens via CSS vars with headless fallbacks, honest empties, never
  throws. Wired in `vanilla/index.html` after `market-charts.js`; declared
  in `vanilla/js/globals.d.ts`.
- `vanilla/js/views/market-desk-query.js` — `readDeskQuery` accepts
  `tf=discrete` (flag + retained numeric bucket); `buildDeskQuery` writes
  `tf=discrete` and suppresses over/osc/vwap/depth/pmap (log rides along);
  non-discrete serialization byte-identical (existing
  `tooling/market-deeplink-test.js` still green).
- `vanilla/js/views/market-ind-panes.js` — `bucketLabel("discrete")`,
  Discrete radio appended last in `paintTimeframes` (numeric radios clear
  the flag), fills-worded `paintCountNote`, construction-time menu disable,
  NEW `syncIndMenu` (marker-guarded enable/disable so mid-session switches
  land; construction-disabled boxes untouched), `drawDiscrete` branch in
  `maybeDraw` (tears down LWC/oscs/VWAP/depth/pool-map, auto-mounts volume),
  `drawCharts` re-dispatch (resize/theme stay live), volume-wrap retirement
  on return to buckets.
- `vanilla/js/views/market-desk-fill.js` — `fill(state)` Discrete branch:
  `MarketFills.fillsForMarket` (lim = min(count, 1000)) → `fillsToPoints`
  → `state.points`; skips candles/deepen; note shows ACTUAL count.
- `vanilla/js/views/market-desk.js` — `state.discrete` seed (+ retained
  bucket), `discreteHash` + `refreshDiscreteTip` (tape-moved repaint only;
  ticker refresh shared).
- `vanilla/js/views/market-desk-panels.js` — `deepenOnce` landing during
  Discrete stands down (4 lines).
- `vanilla/js/views/pool-detail-view.js` — `P.discrete` + swaps-worded
  `discreteEmptyText`, `rebucketDiscrete` (tape slice → `swapsToPoints`),
  `repaintForMode` router (rides P for deepenPool's adopted-tape callbacks),
  deepen-landing guard, invert/count/live-tip routing; pool stays
  session-only (no pool URL contract added).
- `vanilla/locales/*.json` (12) — 6 keys (`market.tf_discrete`,
  `discrete_fills/swaps/unavailable/no_fills/volume`), English stubs
  outside en via `tooling/add_discrete_i18n.py`.
- Tests/probes (all stdlib, all green): `tooling/discrete-timescale-test.js`
  (44 vectors), `tooling/probe-discrete-fills.mjs` (live fills + buckets on
  testnet AND mainnet), `tooling/probe-pool-id.mjs` (pool ids + exchange-op
  activity signal).

## 3. Manual test steps + observed result

Live chain (2026-10-06; headless Chromium + stdlib WS probes; human browser
pass still required per tooling policy — the dedicated pool/user-M5 flow,
pool invert in Discrete, and the theme trio beyond light/dark are the
explicit human-gate items):

1. Exchange mainnet `#/market/BTS_CNY?tf=discrete` → Discrete radio checked
   last; price shows BLUE DOT SCATTER (no candles), `Discrete volume` stems
   below; note `1000 fills · chain-only · live`; no VWAP/depth/pool-map;
   zero console errors (screenshots `/tmp/discrete-full.png`,
   `/tmp/discrete-light.png`).
2. Share-link reload → lands in Discrete, no indicators resurrected.
3. Testnet `#/market/TEST_BTS` bucketed → click Discrete → dots path with
   honest `0 fills` empty (thin pair), menu 69/69 disabled; click 1h →
   buckets + selections return, menu 0 disabled, note
   `2000 × 1h candles · chain-only · live`; zero errors.
4. Pool mainnet `#/pools/1.19.2` (BTS/CNY, 5/5 recent exchange ops per
   probe) → click Discrete → `100 swaps`, volume pane only, menu 69/69
   disabled; 25 s later (ES deepen landed mid-mode) note STILL `100 swaps`
   (race fixed); back to 300 s → buckets + menu restored; zero errors.
5. Pool testnet `#/pools/1.19.0` (history rows but 0 exchange ops) →
   pre-existing honest `Pool history unavailable…`, no radios, zero errors
   (empty-tape path untouched by this slice).
6. Probes: testnet `get_fill_order_history(TEST,BTS)` works (0 fills — thin
   pair, method proven); mainnet BTS_CNY returns 10 fills in the exact
   `chainRow` shape; buckets offered on both (testnet incl. 60 s, mainnet
   incl. 604800).

## 4. Raw→human test vectors (principle #6)

Live mainnet fill (probe sample, 2026-10-04T15:49:45, BTS_CNY desk with
base=CNY 1.3.113 p4, quote=BTS 1.3.0 p5):

- price: pays `1705` × 1.3.113 / receives `268855` × 1.3.0 →
  (1705/10⁴)/(268855/10⁵) = 0.1705/2.68855 = `0.06342` CNY per BTS
  (matches strip Latest `0.06342` on the screenshot).
- volume: base leg `268855` raw @ p5 → `2.68855` BTS.
- Non-BTS precision pair: the SAME vector exercises p4/p5 legs (neither is
  the 5-decimal BTS-only path on both sides); inverted-orientation vector
  in-unit (`fillsToPoints` pts4: received-leg base maps, `volumeBaseRaw`
  `100`); same-second separation in-unit (2 points, never merged).
- Percent fields: none displayed by this slice (no percent math added;
  market-fee percents untouched) — honestly N/A, not faked.
- Money discipline: `Number()` touches only human strings for pixels
  (`charts` + volume magnitude from digit-string raws); all price/volume
  strings via `Format.formatPrice/formatAmount` (BigInt). `Math.pow(10`
  appears only in `format.js` + the pre-existing vendored LWC build.

## 5. Theme + viewport checks (principle #5/#7)

- Dark (dex-ux-theme-ish default): `/tmp/discrete-full.png` — dots in
  `--accent`, volume stems `--muted`, legible.
- Light (vanilla cream/chocolate): `/tmp/discrete-light.png` — dots in
  dark-teal accent on cream, legible; zero errors.
- Ref-ui (default blue) + full trio re-shot: human-gate item (canvases read
  tokens live, no hardcoded paint colors — the 5 hex hits in
  discrete-charts.js are `readVar` FALLBACKS only, same precedent as
  `market-ind-panes.js` `themeChartColors`).
- Phone 390 px (`/tmp/discrete-phone.png`): shell collapses (hamburger),
  stats stack, no horizontal breakage; canvases are 100%-width DPR-fit like
  every other pane. Desktop 1440/1600 proven above.

## 6. Readability (principle #8)

New file opens with owns/consumes/side-effects/origin header; every new
function carries what/params/returns/failure-modes; comments explain WHY
(dex-ux parity, race guards, scope-visibility). No TODO/FIXME/XXX/HACK in
touched files (auditor grep clean). `discrete-charts.js` is 210 lines (new
painters live there precisely so `market-ind-panes.js` — already 1109 lines
pre-slice — only gains mode-routing); pool/exchange deltas are branch
insertions, no restructures, no shadow copies. Shared seams reused: `DOM`,
`touchable` (global), `MarketInd.paintTimeframes/paintCountInput`,
`MarketFills`/`PoolHistory` globals — zero local copies (rule-9 grep clean).

## 7. Anti-rot answers (§4.5 a–c) + plan deviations

- (a) Ten years untouched: radios + canvas 2D + the pre-existing WS fill
  calls use platform APIs only; no new dependency, hosted asset, or build
  step (`check_rot` green).
- (b) Newly depended on: nothing (one new 210-line file + branch edits;
  probes/tests are stdlib-only dev tools under `tooling/`).
- (c) Smallest deletable subset: the volume-stems painter could go and dots
  still carry the feature — kept because the requester explicitly requires
  it; everything else is the minimum mode switch.
- Deviations from the plan (all from live verification, none from taste):
  1. `syncIndMenu` (marker-guarded) ADDED — the plan's construction-time
     disable missed mid-session switches (caught in-page: pool menu 0/69).
  2. Deepen-landing guards on both desks (pool `deepenPool` completion +
     adopted-tape routing via `P.repaintForMode`; exchange `deepenOnce`) —
     in-flight ES depth overwrote the discrete note (caught in-page).
  3. `eval-once.mjs` gained a `mainnet` 4th arg (testnet pools have no
     swaps; mainnet proof required it).
  4. Plan's 7th locale key (`discrete_price`) dropped — the price pane has
     no title; shipping an unused key would be dead text.
  5. Pool stays session-only (no `tf=discrete` URL): headless pool-discrete
     proof done via in-page clicks instead.

## 8. Gate evidence

- `node tooling/discrete-timescale-test.js` → 44 passed.
- `node tooling/market-deeplink-test.js` → 25 passed (non-discrete
  serialization byte-identical).
- `bash tooling/check_types.sh` → PASS (checkJs, no emit).
- `python3 tooling/check_i18n.py` → OK: 12 dicts key-complete; 4897 t()
  call sites drift-free.
- `python3 tooling/check_rot.py` → PASSED.
- `node --check` on all 9 touched/created JS files → clean.
- Headless renders with `consoleErrors: []` on every run (exchange dark +
  light + phone, pool mainnet, testnet empty states).
