# Parity note — edge volume ramp (grey→blue replaces thickness)

Round: owner request — replace the edge thickness scale with a grey→blue
color scale (grey low, BitShares blue high) on all 4 map views. No
thickness encoding (owner decision). Spec:
`docs/superpowers/specs/2026-10-07-edge-volume-ramp-design.md`; plan:
`docs/superpowers/plans/2026-10-07-edge-volume-ramp.md`.

## 1. Reference behavior

No new chain surface. Idea lineage: squidKid-deluxe/bitshares-networks
`pool_mapper.py` "edge-width by BTS value" (already credited in
`pool-graph.js:27` + `pool-net-ui.js:22`) — this round ports the *intent*
(size-visible edges) from width to color. Reference #1 has no equivalent
 preliminary-review aid (its confirm shows QR/JSON, not a data map).

## 2. Vanilla implementation (file:line)

- `vanilla/js/views/pool-net-paint.js` — `_ramp(t, grey, blue)` pure
  (hex3/hex6/rgb() parse, fail-closed grey) + `_rampForTest`; `edgeT`
  calibrated windows (pool 4–22, market 5–11); `drawScene` paints
  `ramp(t)` at constant 1.25 width; `_edgeWidth` + vectors DELETED.
- `vanilla/js/api/pool-graph.js` — verbatim `_ramp` twin + `_rampForTest`;
  `drawGraph` base ink = ramp by `sizeRaw` digits (window 4–22, shared
  with bands); `edgeStyle` base width 1.2→1.25, base token "border"→"ramp";
  hover/path/glow precedence untouched.
- `vanilla/js/views/pool-net-chrome.js` — `isMarket(S)` branches
  (node/edge cards, verdict, prompt, twin wording, canvas label);
  `appendRamp` legend key (CSS-swatch classes, theme-tracked);
  brand row skipped in market mode.
- `vanilla/js/views/market-desk-fill.js`,
  `vanilla/js/views/pool-detail-view.js` — success-branch note gains the
  `pool_net.ramp` key (caption lines only).
- Endpoints resolved once per scene from `--muted`/`--accent`
  (fallbacks `#758696`/`#1E9ED7`); legend swatches are CSS classes on the
  same tokens, so key and ink cannot disagree.

## 3. Manual test steps + observed result

Automated (see §8). LIVE VISUAL AUDIT (this round, headless Chromium
against local server + mainnet, zero console errors):
- `#/pools` shot: hub lines blue, peripheral lines grey — spread visible
  (the /14 sketch saturated 67% to full blue; caught here, recalibrated).
- `#/markets` shot: table "Top 6 of 20" correct humans + band
  "6 markets · 7 assets" (this audit ALSO caught the decimal-volume bug —
  chain sends "16.47978", table hid it as zero; fixed via
  `MarketNet.volInt`, committed separately).
- Pixel probes (`tooling/visual/probe-band-ramp.mjs`, new): pools band
  hi-quartile blueness 142 vs lo 89 (288/319 edges, miss = clipped);
  markets band 202 vs 119 (6/6). Both PASS.
- Dark theme shot: ramp re-resolves (accent-tracked blue), spread intact.
- Desk mini-map shot: ramp live (2 edges — concurrent workstream's
  24h-activity gating narrows the set; color verified by vectors).
- Legend key verified in DOM (text + both swatches + resolved backgrounds).
- HUMAN QUEUE: phone-width look + pool-detail page glance (same code
  path, vectors green, but eyes beat probes).

## 4. Raw→human test vectors

No new amount paths: ramp consumes digit-string LENGTHS (counts, never
values); hover cards/twin keep the existing Format paths. Unit vectors
assert endpoints/mix/clamp/garbage + cross-module equality + scene
ordering (big-pool > market-mid > small-pool).

## 5. Theme/viewport checks

Dark theme: audited live (see §3). Ref/ui + phone widths: queued human
(canvas pipeline + touch floors untouched; only ink + strings changed).

## 6. Readability (§3.7)

Headers updated where behavior changed; every new function documented;
no TODO/FIXME; replaced code deleted with its tests (no orphans).

## 7. Anti-rot gate (§4.5)

- (a) Ten years: pure math + platform canvas + theme tokens; dies with
  the painters, no new coupling.
- (b) Newly depended on: nothing (no chain calls, no assets, no libs;
  visual probes are dev-only, never shipped).
- (c) Smallest deletable subset: the legend key (ink still encodes);
  kept because a scale without a key is decoration, not information.

## 8. Gate evidence

- `pool-net-ui-test.js` 106 pass (ramp + scene-ink + market-mode vectors).
- `pool-graph-test.js` 204 pass (ramp + mini-map ink vectors).
- `market-net-test.js` 37 pass (volInt + decimal rank/graph vectors).
- `check_rot.py` PASS; `check_types.sh` PASS; `check_i18n.py` green at
  commit time (2 keys × 12 dicts, zero new beyond those).
- Scripts: `tooling/add_edge_ramp_i18n.py` (idempotent);
  `tooling/visual/probe-ramp-hist.mjs` (calibration) +
  `probe-band-ramp.mjs` (audit) — dev-only.

## 9. Concurrent-workstream notes (same tree, same day)

- A parallel round is adding 24h-activity gating to the desk mini-map
  (`_funded`, `gateByActivity`, ES probe) — compatible (it narrows WHICH
  edges exist; the ramp colors whatever exists). Its hunks in
  `market-desk-fill.js`/`pool-detail-view.js`/`pool-graph.js`/
  `pool-graph-test.js` are NOT mine and stay uncommitted by me.
- Decimal volumes ("16.47978") are now normalized once in
  `MarketNet.volInt` — any future volume consumer must use it, never a
  bare digit regex (the table, rank, graph gate, and display all did).
