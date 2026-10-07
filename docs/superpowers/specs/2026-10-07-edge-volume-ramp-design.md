# Edge volume ramp — design spec

Date: 2026-10-07. Owner request: replace the edge thickness scale with a
grey→blue color scale (grey = low, BitShares blue = high) on all 4 map
views. No thickness encoding (owner decision — blue colorblindness rare
enough to accept color-only encoding).

## 1. Surfaces (all 4)

1. `#/pools` band — `pool-net-paint.drawScene`, metric: pool balance digits.
2. `#/markets` band — same painter, metric: `volBaseRaw` digits.
3. Desk mini-map + 4. pool-detail mini-map — `PoolGraph.drawGraph` (one
   change covers both), metric: pool balance digits (no ticker data in
   hand; probing per edge refused — decoration must not cost chain calls).

## 2. Ramp spec (locked)

- `t = min(strippedDigitLength / 14, 1)` — the same 14 as the old width
  formula, so a given blue means the same thing on every map/filter/page.
- Low = `--muted` token, high = `--accent` token; fallbacks `#758696` /
  `#1E9ED7` (values both painters already use). Non-hex token values fail
  closed to fallbacks.
- Lerp in RGB, output `rgb(r,g,b)` string. Pure, vector-tested, exposed as
  `_rampForTest` in both modules (verbatim-duplicated per doctrine, with
  provenance comment — same as the width math it replaces).
- Endpoints resolved ONCE PER SCENE (existing per-scene token pattern in
  both painters), never per edge/frame.
- Base width becomes constant 1.25 on all four maps; hot/selected, on-path
  (bands) / triangle-green (mini-maps), hovered, and user-glow states keep
  their colors/widths and keep overriding data-ink. The digit-length width
  code is DELETED everywhere (no parallel encoding left to rot).

## 3. Legend + strings

- Bands: swatch row in the legend area — grey chip → blue chip + label
  (`market_net.ramp`: "24h volume: low → high"; `pool_net.ramp`:
  "Pool size: small → large"). Mini-maps: same pool wording as a one-line
  `graphNote` caption on both pages. 2 new keys × 12 dicts.
- Hover cards, twin tables, node colors: untouched (cards already show the
  numbers the color summarizes).

## 4. Non-goals

Thickness (explicitly refused by owner). QR. Polling. Market picker.
`prefers-reduced-motion` path untouched (color is static ink).

## 5. Verification

- Unit vectors: endpoints, true-mix midpoint, clamping both ends,
  garbage→grey, equal digits ⇒ equal colors across pool/volume inputs.
- Headless repaint suites green; rot/types/i18n gates green.
- Visual audit: `tooling/visual/shot.mjs` + band probes against a local
  server; human theme flip across all three themes (accent-tracked blue,
  readable grey, no cached-hex sticking).
