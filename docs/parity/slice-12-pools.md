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

## Delta 2026-10-02 — fixed map color language (owner spec)
BTS node always theme-blue (`--accent`); the two viewed legs always
Live-green (same `--live` as the explorer Live indicator); the leg↔leg pool
edge green; either leg ↔ BTS edges blue; user highlight still wins ties
(buy-green); everything else dim context (BTS↔non-leg edges included, only
the pair's own BTS links glow). Pure `nodePaintRole`/`edgePaintRole`
(headless-tested role names; drawGraph maps roles to tokens). Vectors 89/89.
Headless `#/pools/1.19.66`: blue BTS, green HONEST.BTC leg, blue link
between them, zero console errors.

## Delta 2026-10-06 — pool-net Task 7: locale keys + headless verification (owner gate: human browser pass)

`pool-net-ui.js` used 27 `pool_net.*` call sites but `en.json` only held 4
keys (title/collapse/expand/loading from Task 5) — every verdict, hover
card, legend, twin, and offline note rendered via the `t()` English
fallback, invisible to `check_i18n`. New `tooling/add_pool_net_task7_i18n.py`
(Task-5 band-script pattern) adds the 23 missing keys with verbatim
defaults to all 12 dicts (non-en land allowlisted as honest English stubs);
`check_i18n.py` call-site drift (4876 sites) is clean for every `pool_net.*`
key. Code dedup to keep the gate exact (no key may carry two defaults):
`twin` initial summary now uses the `%(n)s` template (`n: "0"` until
`rebuildTwin` counts — was bare `"Pool rows"` vs `"Pool rows (%(n)s)"`);
the no-skeleton offline note moves to new `pool_net.offline_empty` (was a
second `pool_net.offline` default). Net keys: 4 → 27.

Headless proof (human pass stays the gate — tap node/edge nav, Clear flow,
collapse-reload persistence, dex-ux trio shot, phone touch):
`python3 -m http.server 7334` + 6 `shot.mjs` captures, zero console errors
on all: 1440px band mounts (header + COLLAPSE + `515 pools · 176 assets`
ready line on live mainnet merge), star verdict `Pools touching BTS: 109`
(BTS default + star filter end-to-end on live data), canvas paints full
network + 11 brand chips; 360px stacks cleanly; vanilla-ui-theme light
renders; COLLAPSE click flips to EXPAND and hides the band. `check_rot.py`
PASS, `check_types.sh` PASS, `pool-net-test.js` 36/36, `pool-net-ui-test.js`
7/7, `pool-graph-test.js` 96/96, `check_i18n.py` OK (12 dicts key-complete,
pool_net drift-free; feed-workstream keys rode along in the same dicts to keep
this commit gate-green — feed code files stay with their workstream).
Supersedes the banner + first color pass (removed with vectors, noted):
`mapTheme()` computes legs (green/yellow/red by own BTS hops), node roles
(BTS blue, legs by verdict, rest grey), path pools (both shortest BTS paths
+ direct leg pool, bold yellow), hot glow (static shadowBlur, no loop),
corner texts (upper-left A / upper-right B), bottom pair line
(green/yellow-reach/red), and red 1.5x bold centered takeover ONLY on empty
edge sets (disjoint maps show 3 reds over the visible map). Screen-reader
twin: canvas aria-label refreshed with each render's verdicts. Vectors 96
(rewrote 5e/5f as mapTheme combos: mixed/indirect/orphan/disjoint/empty/
null/same-asset + determinism/containment/separation). Headless direct
pair: green corners, green bottom, blue BTS, yellow path edges, zero errors.

## Delta 2026-10-06 — pool-net v2: lively physics + Calm/Lively switch + link audit (Tasks 1–3)

Calm stays the shipped default (byte-identical v1 constants); Lively adds the
pyvis-barnesHut character beside it behind a persisted segmented switch; every
edge on both plots provably routes to its swap desk and every node to its
asset page. Commits `8de4dc9` (preset + switch), `f9ac027` (calm `springK`
`0.0015` → `0.015` v1 byte-identical + lock vector), `c0736f1` (nav audit).

### Preset mapping table (pyvis → PHYS, `pool-net-ui.js:41-48`)

| pyvis character | Calm (v1, unchanged) | Lively |
|---|---|---|
| Repulsion law | `repPow: 1` (linear-ish, `min((k*k)/(d*d+1)*2, 5)`) | `repPow: 2` inverse-square degree-mass: `min(2.6·k²·deg/(d²+400), 40)`, `deg = 1+deg_a+deg_b`, 400px² softening keeps close-range finite |
| Springs | `springRest: 1.1`, `springK: 0.015` | long + firm (underdamped overshoot): `springRest: 2.2`, `springK: 0.014` |
| Carryover/damping | `carry: 0.8` | `carry: 0.985` (underdamped — oscillation decays over ~11s, not ~2s) |
| Center pull | `pull: 0.008` | weak: `pull: 0.003` (`btsPullX: 3` both) |
| Energy | `temp0: 6`, `cool: 0.98`, `tempMin: 1` | hotter + slow cool: `temp0: 10`, `cool: 0.999`, `tempMin: 1.2` |
| Sleep gate | `stillTol: 0.35`, `stillFrames: 25`, `minFrames: 0` | late + min-run + budget: `stillTol: 0.25`, `stillFrames: 120`, `minFrames: 400`, `maxFrames: 1500` (calm `maxFrames: 900` pure backstop) |
| Edges | straight (`curved: false`) | quadratic midpoint offset `((edgeIndex % 5) − 2) · 6px` (`curved: true`) |

Wall-clamp kills inward velocity (both presets): a node pressed against the
wall previously retained full-temp velocity into it, so `maxStep` parked at
the temp cap forever — the sleep gate never fired and the loop spun on a
frozen map. `maxStep` is now measured post-clamp; calm equilibrium (never at
walls) is unaffected.

`stepFrame`/`drawScene`/`loop`/`wake` read `S.phys` (`PHYS[S.phys] ||
PHYS.calm`); nothing else branches. `loop` counts `S.frames`, `wake` resets
`S.frames = 0` and re-seeds `S.temp = P.temp0` so a flip re-settles from
current positions. `prefers-reduced-motion` (`S.reduced`) freezes either mode
— no new branch.

### Switch behavior

Segmented Calm/Lively control in the band header (`pool-net-ui.js:780-816`):
`aria-pressed`, 44px `touchable`, `role="group"` labelled by
`pool_net.phys_label` (`"Network motion"`). Persists `localStorage poolNetPhys`
(`"lively"` → lively, anything else/absent/storage-failure → calm; default
calm). Keys `pool_net.phys_calm` (`"Calm"`) / `pool_net.phys_lively`
(`"Lively"`) / `pool_net.phys_label` resolved via `I18n.t` verbatim defaults;
all 12 dicts carry them nested under `pool_net` (Task-1 commit synced the 11
non-en as honest English stubs — verified present, no Task-3 edit needed).

### Link audit table (evidence first; zero handler-behavior change)

Pure `navForHit(h)` in both files (`pool-net-ui.js:487-491`,
`pool-graph.js:804-808`): `{edgeMid, poolId}` → `"#/pools/" + poolId` (raw
`1.19.x`, `router.js:272`); `{sym}` → `"#/asset/" + encodeURIComponent(sym)`
(dots verbatim, slashes route-safe, `router.js:243`); null → null. Every
existing handler wired through it (click/tap/keydown/twin/`goPool`/twin
`href`), byte-identical strings.

| Plot | Element | Target | Proven by |
|---|---|---|---|
| pool-net band canvas | node tap | `#/asset/:symbol` | ui-test nav vectors (incl. `XBTSX.BTC` dot verbatim) |
| pool-net band canvas | edge-mid tap | `#/pools/:id` | ui-test nav vectors (`1.19.66`) |
| pool-net band | keyboard Enter | BTS-or-first node asset page | existing handler via `navForHit` |
| pool-net twin | node row link | `#/asset/:symbol` | `href` via `navForHit` |
| pool-net twin | edge row (`goPool`) | `#/pools/:id` | `goPool` via `navForHit` |
| desk pool-graph canvas | node click | `#/asset/:symbol` | graph-test nav vectors |
| desk pool-graph canvas | edge-mid click | `#/pools/:id` | graph-test nav vectors |
| desk pool-graph | keydown Enter | node asset page | handler via `navForHit` |

Audit found no missing/wrong record (`sym`/`poolId` construction intact), so
no record fixes were needed — resolver + wiring only.

Refine — 3s pause rule (user call: "pause after 3s until next interaction"):
`maxFrames: 180` both presets, lively `minFrames: 60`. Every wake runs at
most ~3s then freezes; any node-moving interaction (flip, drag-release,
filter) re-seeds and runs another 3s. Zoom is camera-only (no wake). Ends the stuck-jitter class structurally —
tails can't outlive the cap. Browser proof: idle paused @180, flip runs,
paused @180 again, zero errors.

Refine — `pool-net-ui.js` split 1468→589 + 4 modules (readability): `api/pool-net-phys.js`
(simulation + loop via injected `S.paint`), `pool-net-paint.js` (pure render),
`pool-net-gestures.js` (input via hooks), `pool-net-chrome.js` (band
furniture builders), ui left as composer with all 10 exports delegating —
all 49 vectors pass unmodified, gates green, live flip verified. Stale
pre-switch probes deleted; scenario probe ported to the switch.

Refine — desk switch overlays canvas + drag-release wakes (user call):
both trading-desk Physics switches moved from pane headers into
relative stage wrappers over the map lower-left (band parity, same
`.pool-net-stage` CSS; header-space lookup retargeted so refetches can't
duplicate); `endDrag` in `pool-graph.js` now wakes the live state
explicitly on moved-release (previously the drop landed dead on a paused
map — offsets are visual-only, so no throw velocity, just a 3s
re-energize). Verified headless on both desks: overlay positioned +
`role=switch`, drag-under-lively moves and keeps/reacts the loop, zero
errors. Nothing else on either desk changed.

Refine — switch overlays canvas lower-left (user call): `Physics`
control moved into a relative `.pool-net-stage` wrapper, absolutely
positioned over the art (panel pill, readable in all themes) instead of
sitting above the band. Verified in-position + clickable headlessly.

Refine — wind-down arc (user Q: would lower gravity/tension cut jitter?):
measured no — halving either leaves the tail byte-identical (tails are
temp-cap-quantized, not force-set; softer springs only sprawl wider).
The real lever is cooling inside the 3s budget: `cool: 0.984` lands
temp 7→0.4 across 180 frames, so the pause lands softly instead of
freezing mid-fast-motion. Browser arc post-flip: 12904 → 4991 → 2009 →
paused, zero errors. Gravity/tension left alone (weaker pull risks
sprawl/drift with zero jitter benefit).

Refine — zoom is camera-only (user call): wheel-zoom no longer wakes the
loop (verified headless: zoom 1.0 to 1.49 with running false). Only moving
nodes — drag-release throw, Physics flip re-spread, filter change —
re-energizes. (Unrelated: `check_types.sh` is red on
`account-ui.js` myGen/gen from another workstream's uncommitted edit —
zero errors in pool-net files.)

Refine — induced swap edges (user call): star/union views now include every
pool whose BOTH legs are already visible, not just pools touching the
selected asset(s). Two BTS-linked assets that also pair directly show that
swap link too. Edges only — both endpoints visible by construction, so no new
nodes, no extra RPC. Live proof: BTS star renders 89 nodes / 319 edges
(was ~109 pools). Vectors in `pool-net-test.js` §4b.

Refine 2026-10-07 — "a bit jittery / high tension" (user feel): softened
lively (`carry: 0.98`, `springK: 0.010`, `cool: 0.999`, `tempMin: 1.2`,
`temp0: 7`, `repCap: 20`) — same long run, calmer tail creep, sleeps via
gate; then "center wobble lasts too long": the BTS hub (tugged by every
leaf) now carries less velocity (`hubCarry: 0.90`, lively-only, calm
untouched) — hub tail motion 3× down, rim drift intact. Energy vector
still 7.6× calm. Tale of the tape in `pool-net-ui-test.js` energy block.

### Follow-up — reduced-motion: explicit flips/releases run bounded (user env)

User on Brave/Linux Mint 4K with the tour skipped: switch dead, release
dead, map frozen from load — while headless Chromium (motion allowed) showed
everything working. Reproduced exactly by forcing `reducedMotion: reduce`
headless: `S.reduced=true`, loop never starts, flip only flips state,
`running:false` forever. Almost certainly the user's OS/compositor advertises
`prefers-reduced-motion` (or Brave maps it), freezing every wake — including
explicit ones.

Policy now: AUTO wakes (load/filter/scroll/resize) stay frozen under
reduced-motion; EXPLICIT gestures (Physics flip, drag-release throw,
wheel-zoom via the shared `S.wake`) run bounded — flipping the switch on IS
informed consent, and every run self-terminates via sleep gate + `maxFrames`.
`wake(S, explicit)` carries the flag; `loop` honors `S.forced` and clears it
on every exit. Vectors: auto wake frozen, explicit wake settles (34/34).
Browser proof (forced reduced-motion): flip → bounded ~27s run, settles,
zero errors; ambient load stays frozen.

### Follow-up — Physics on/off switch replaces Calm/Lively buttons (user call)

Owner verdict on the segmented control: buttons felt dead (no pointer
cursor, no visible pressed state — both gaps real, fixed first), then asked
for ONE labeled switch instead. Now: `Physics` label + `role="switch"`
track/knob + `On`/`Off` state text (`pool_net.phys/phys_on/phys_off`;
stale `phys_calm/phys_lively/phys_label` keys removed from all 12 dicts).
ON = v2 lively motion, OFF = v1 calm settle (default off); same persist
(`poolNetPhys`), re-spread, and wake path as the buttons. Native `<button>`
keeps Space/Enter; 60×44px track meets the touch floor; knob side + accent
border + state text read in all three themes. Real-mouse probe:
cursor pointer, click → `aria-checked=true`, `On`, stored `lively`,
temp 9.27 re-energize, layout re-spread, zero errors.

### Follow-up 2026-10-07 — "buttons do nothing" (user report, root-caused)

Report: flipping Calm→Lively showed no visible change; map stayed calm-like.
Headless repro (`tooling/visual/probe-poolnet-phys.mjs`: click Lively, sample
`canvas._netState` + displacement) proved the switch works mechanically
(`S.phys` flips, loop runs, zero console errors) — the lively *dynamics* were
at fault, in two layers:

1. **Wrong falloff (shipped `d³+1`, should be `d²+soft`).** The v2 plan prose
   said "inverse-square" but the dictated formula divided by `d³+1`: at working
   distances (30–150px) lively repulsion ran ~7–18× *weaker* than calm, so the
   map parked into static equilibrium in ~2s. Energy regression vector added
   (`pool-net-ui-test.js`: identical ring start, 300 steps, lively path >
   1.5× calm — failed 1.39× pre-fix, 3.51× post-fix).
2. **Overdamped lively + wall-pin spin.** The first retune still parked 85/89
   nodes (per-node browser trace: 4 movers >1px/s) while the loop spun forever:
   wall-clamped nodes retained full-temp inward velocity, faking `maxStep` at
   the cap so the sleep gate never fired. Fix: clamp zeroes inward velocity +
   `maxStep` measured post-clamp; lively retuned underdamped (`carry: 0.99`,
   `springK: 0.025`, `cool: 0.9995`, `tempMin: 1.5`) for ~14s visible oscillation
   (asymmetric + ring harnesses both sleep via gate, ~825–850 frames);
   `maxFrames` (lively 1500 / calm 900) is the pyvis-style stabilization
   budget backstop. Browser proof: fresh-mount lively out-moves calm, T+12s
   spread 146 vs 95, `/tmp/phys-lively-t12.png` vs `/tmp/phys-calm-t12.png`
   (tight ball vs wide curved-edge starburst), zero console errors.

### Gate evidence (Task 3 run, 2026-10-06)

- `python3 tooling/check_rot.py` → PASSED (dependency-free, static-servable).
- `bash tooling/check_types.sh` → PASS (checkJs, zero emit).
- `python3 tooling/check_i18n.py` → OK: 12 dicts key-complete (3729 keys),
  allowlists exact, stubs honest, 4902 `t()` call sites drift-free.
- `node tooling/pool-net-test.js` → 36 passed, 0 failed.
- `node tooling/pool-net-ui-test.js` → 25 passed, 0 failed (7 v1 + preset,
  default, switch-persistence, calm-lock, nav-target vectors).
- `node tooling/pool-graph-test.js` → 103 pass, 0 fail (96 v1 + nav vectors).
- Headless serve `python3 -m http.server` → `js/views/pool-net-ui.js` 200,
  `data/pools.json` 200, `index.html` 200.
- `shot.mjs` `#/pools` @1440 and @390 → `consoleErrors: []` on both
  (`/tmp/poolv2-1440.png`, `/tmp/poolv2-390.png`). Human browser pass (tap
  node/edge nav, Clear flow, collapse-reload persistence, trio, phone touch)
  stays the gate — queued for tester.

Anti-rot (§4.5): (a) yes — preset table + pure resolver, platform APIs only
(Canvas/rAF/localStorage/matchMedia), no new import; (b) nothing new depended
on; (c) smallest deletable: lively preset (calm band + audit stand).
`check_rot.py` PASS.

## Delta 2026-10-07 — desk physics-only upgrade (market-net Task 5; pool desk half, visuals byte-identical)

The pool desk (`#/pools/:id`) pool-map keeps its exact look, colors, verdicts,
hit-testing, and layout — ONLY the physics driver changed, plus the shared
Physics switch in the map pane header. `pool-graph.js`: preset-driven live loop
(calm = shipped `relax()` settle-once; lively = same relax math per-frame,
temp/cool/sleep + 180-frame cap; presets from `PoolNetUI._physForTest` with
built-in calm-equivalent fallback so the module stays standalone). One
deliberate seam (`drawGraph opts._pos`, lively loop only — all pre-existing
vectors green = default path unchanged). `pool-detail-view.js`: ONLY the
Physics switch in `chartPane`'s `graphHead` (shared `poolNetPhys` key, default
calm/off, `role="switch"`, 44px, helpers duplicated per doctrine) + the same
`redrawPoolMap` lively branch as the market desk. Vectors: `pool-graph-test.js`
123/123 (calm≡relax positions; lively 3-node demo runs the full 180 cap —
bounded, terminating, same pause-rule semantics as the band). Headless
`#/pools/1.19.1`: map loads, switch present, zero app console errors. Full
note: `docs/parity/slice-markets.md` (desk physics-only section) + Task-5
report `.superpowers/sdd/task-5-report.md`.
