# Slice 12 parity note — pools + swap + stake

Plan: `docs/superpowers/plans/2026-09-28-slice-12-pools.md` (Tasks 1–4).
User direction: pools desk mirrors the orderbook desk per DEX-UX review;
DEX-UX ES-candle transport REFUSED (chain history only, grep-gated).

## What landed (vanilla file:line)
- `vanilla/js/tx.js` — 6 serializers: ops 59/60/61/62/63/75. Percents u16
  hundredths (`150`=1.5%). Op-75 optionals: absent = single `0x00`.
- `vanilla/js/pool.js` (375) — reads (`get/list/mine/history/listForm`),
  CPMM math (`quote/minReceive/shareOut/shareBack/depthPoints`, BigInt),
  builders + `fee` (fills in place) + `sendAndProve`.
- `vanilla/js/pool-ui.js` (277) — `#/pools` list + filters + my-pools + op-59.
- `vanilla/js/pool-detail-ui.js` (288) — `#/pools/:id` desk: stats strip, LWC
  pane, stake/unstake, inline swap, update/delete, CPMM depth, history.
- `vanilla/js/pool-swap-ui.js` (164) — `#/swap` pickers + quote + slippage.
- Routes `router.js:116-118`, tags `index.html`.
- Staking = LP shares only (op 61/62); tickets are slice 14 (grep-clean).

## Reference behavior (file:line)
- #4: ops `liquidity_pool.hpp:163-175`, ids `operations.hpp:115-119,131`;
  reads `database_api.hpp:683-856`; virgin mint `max(amount_a,amount_b)` raw
  (evaluator source, PROVEN below — geometric mean disproven).
- DEX-UX (webfetch, never cloned): ES flow (`kibana.py`, size-10000 desc,
  op-63 pool-id match, freshness gates) — transport refused; desk mirror
  (`order_book.html`: picker left, chart+buy/sell center, book+trades right)
  → our spec: same skeleton/classes, book→CPMM curve, trades→pool history,
  buy/sell→swap+slippage.
- #3 serializers match #4 FC order; #3 confirm rows `popup.js:6159-6194`.

## Bugs found by verification, fixed + re-proved
- Virgin `shareOut` geometric-mean (31622) vs chain mint (100000) → second pool
  lifecycle proves rule = max(raw): inA=40000/inB=90000 → minted 90000.
  Fixed (`pool.js:204,214`), dead `_isqrt` removed (also fixes 397→375 size).
- Inline-swap Sell confirm row raw → human + raw-title (swap shape).
- Stale op-75 fee header (1 BTS) → observed 0.10000 TEST (#3720 rule).

## Test vectors (raw → human, real files, live testnet)
- Pool `1.19.66` (TEST p5/AFKTEST10 p4, share `AFKPOOL652147` p4): create fee
  `5000000`→`50.00000` — `100929432` (taker `50`→`0.5%`, withdrawal `0`→`0%`);
  deposit fee `10000`→`0.10000`, `0/0`→`100000/10000`, mint `100000` — `100929451`;
  exchange sell `20000`→quote `1666`→min `1657` (`floor(1666×0.995)`), got `1658`,
  result tag 4 with 3 fees — `100929452`; withdraw-partial fee `500000`→`5.00000`,
  `-12000/-834` proportional — `100929478`; update taker `50`→`100` (`0.5%`→`1%`),
  fee `10000` — `100929479`; withdraw-rest + delete fee `0` — `100929479`.
- Pool `1.19.67` (share `AFKPOOLV29847` p4): create `100929848`;
  virgin deposit `40000/90000` → mint `90000` = max(raw) — `100929849`;
  full withdraw exact legs back — `100929850`; delete — `100929850`.
- Percents `150`→`1.5%`, `2000`→`20%`, `50`→`0.5%`, `100`→`1%`;
  round-trips `1.5`→`150`→`1.5`; amounts `58536392` p5→`585.36392`,
  `90000` p4→`9.0000`, `416138896` p8→`4.16138896`; mid `1.2/0.8342`→`1.4385`.
- Serializer: op-59 22B tail `9600`; op-75 taker-only 18B vs both 20B.
- Fee headers observed: 59=50, 61=0.1, 62=5, 63=1, 75=0.1, 60=0 (TEST).
- Money reconciles exact on both lifecycles; leftovers: share UIAs `1.3.1851/52`
  (supply 0), `AFKTEST10` back to `90000`, pools gone.
- `list_liquidity_pools` 2-arg proven; history on api id 2 (seqs 1/2/3 = 59/61/63).

## Manual test (headless, --network testnet, zero console errors)
- `#/pools`, `#/pools/1.19.66`, `#/swap` @1440 blue/dark/light + 390:
  connected badge, lock gate, zero `undefined`. Desk-mirror holds vs
  `original-pages/pools.png` (same skeleton language, detail-desk panels
  replace per-row modals — documented adaptation).

## Tester pass (queued)
- Unlock → pools list → detail desk → stake/unstake → swap quote → confirms;
  trio visuals; 390 scroll.

## Anti-rot gate (§4.5): (a) yes — static + existing Tx/Chain reuse, ES refused;
(b) nothing new depended on; (c) smallest deletable: swap page (pools desk
stands). `check_rot.py` PASS.

## Delta 2026-10-02 — deterministic force relaxation for the pool map (owner: networkx-like physics on canvas)
`layout()` rings were correct but rigid. New `relax()` settles the seed to a
static equilibrium synchronously at paint: Coulomb repulsion (all pairs) +
log-weighted springs (weight from raw-digit length — money never touches
float) + weak center gravity (3x for the L0 pair anchor) + wall soft-push and
hard clamp. Fixed 150 iterations, fixed cooling, golden-angle d==0 splits,
zero randomness/timers/animation: same graph always settles to the same
pixels. `drawGraph` (both pages) feeds `relax(layout(...))`; drag offsets,
hit-testing, labels, radii, and `_rings` (label stagger) untouched. Vectors
43→68 (determinism, containment, separation, L0-near-center, center-of-mass,
degenerate-input softness, weight ordering). Headless `#/pools/1.19.66`:
organic spread, pair central with highlighted edge, labels readable, zero
console errors. Tune next (only on owner call): repulsion/cooling/wall
constants, spring weight curve.

## Delta 2026-10-02 — provenance banner on the pool map (owner wording, polished)
`provenanceStatus(graph, assetA, assetB)` (pure, `_test`-exported): direct if
either leg pairs straight with BTS (or IS BTS — 0 hops), else shortest-path
hops via `findCorePath`, else none. `drawGraph` paints one top line —
green Direct / yellow Indirect (+hops, `{n}` interpolated locally since the
`t()` fallback path cannot interpolate) / red Warning — using --buy/--warn/
--danger tokens with the standard halo. Both pages inherit it (single wiring
point); the DOM provenance line stays as the screen-reader twin (canvas text
is invisible to assistive tech). Vectors +7 (direct/indirect/zero-hop/
orphan/empty/null). Headless `#/pools/1.19.66`: green Direct banner correct
(BTS leg), zero console errors.
