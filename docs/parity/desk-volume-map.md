# Parity note — desk volume map (`#/markets` band from market volume)

Round: owner analogy — the exchange-desk map should mirror the market
selector the way the swap-side map mirrors the pool selector, with recent
volume as the visibility gate. Spec:
`docs/superpowers/specs/2026-10-07-desk-volume-map-design.md`; plan:
`docs/superpowers/plans/2026-10-07-desk-volume-map.md`.

## 1. Reference behavior

No new chain surface: `get_ticker(base, quote)` probing is the existing
`Market.stats` path (`market.js:452-462`, contract `#4
database_api.hpp:618`); QUOTE_BASE desk ids follow the existing desk-id
rule (`market-net.js:19-24`, verified against `market-picker.js:382`).
Idea credit: full-network map concept from
squidKid-deluxe/bitshares-networks `pool_mapper.py` (already credited in
`pool-net-ui.js:22-26` — same lineage, new data source).

## 2. Vanilla implementation (file:line)

- `vanilla/js/api/market-net.js` — `MarketNet.graph(rows, focusId)`:
  volume-gated `{nodes, edges, meta}` (edge id = desk id, `poolId` repeats
  it for the shared pipeline); focus-base orientation wins by convention.
- `vanilla/js/views/pool-net-ui.js` — `mount()` accepts
  `{mode: "market", graph, meta}` (skeleton + backfill skipped);
  `marketMode()` stands down brand filter + BTS path-find.
- `vanilla/js/views/pool-net-chrome.js` — `isMarket(S)` branches:
  node/edge cards, verdict (no route fiction), legend skipped, twin market
  wording, canvas aria-label + prompt.
- `vanilla/js/views/pool-net-paint.js` — `_edgeWidth` accepts `volBaseRaw`
  digits with the identical formula (+ `_edgeWidthForTest` seam).
- `vanilla/js/views/market-net-ui.js` — `mountBand` builds the graph from
  the table's ranked rows (+ precisions join), direct desk nav; deleted
  `poolDeskMap`/`deskIdForEdge` + export seams + their tests. `poolRows`
  `Pool.list` fetch STAYS (candidate discovery still uses it).

## 3. Manual test steps + observed result

Automated (this round — see §8). BROWSER (queued for the human — no
browser here, never fabricated): load `#/markets` (default BTS) at 360px
+ desktop × 3 themes; band shows only volume markets with volume-weighted
lines; hover cards show volume/price; edge click → `#/market/<id>`; twin
table lists market rows; filter to a dead pair → table empty note + band
honest empty note; collapse toggle persists.

## 4. Raw→human test vectors

No new amount paths: hover cards format via the existing
`Format.formatAmount` + raw-fallback `humanBal` path (principle #6
pre-covered); volumes stay BigInt digit strings (a float-scale fee-style
vector does not apply — nothing converts units). Unit vectors assert
gating/dedupe/shapes instead.

## 5. Theme/viewport checks

Queued with §3 (human pass). By construction: canvas pipeline, tokens,
and touch floors untouched; only data + strings changed.

## 6. Readability (§3.7)

Headers updated in `market-net.js`, `pool-net-ui.js` (mount contract);
every new function has what/params/returns/failure notes; no TODO/FIXME;
deleted helpers left no orphans (grep-verified).

## 7. Anti-rot gate (§4.5)

- (a) Ten years untouched: same ES5 + platform modules; the volume path
  dies exactly when the pool pipeline dies — one new pure function, zero
  new coupling class.
- (b) Newly depended on: nothing. No chain calls added (rows already
  probed), no assets, no services.
- (c) Smallest deletable subset: the market chrome wording (band would
  still draw with pool-worded cards); kept because pool words on market
  data would be a lie.

## 8. Gate evidence

- `node tooling/market-net-test.js` → 29 pass (7 new graph vectors).
- `node tooling/market-net-ui-test.js` → 29 pass (rewritten band block).
- `node tooling/pool-net-ui-test.js` → 100 pass (market-mode mount +
  width vectors); `pool-net-test.js` rerun green.
- `python3 tooling/check_rot.py` → PASS; `bash tooling/check_types.sh`
  → PASS; `python3 tooling/check_i18n.py` → OK (11 keys × 12 dicts).
- i18n script: `tooling/add_desk_volume_map_i18n.py` (idempotent).

## 9. Known honest limits

- Volumes in different base-asset units share one thickness scale (same
  caveat the pool version always had with mixed leg units); rank-stepped
  thickness recorded as the unit-proof alternative.
- Map is a load-time snapshot like the table (no poll).
- Dual selection reads as full counts (no route claim without pool data).
