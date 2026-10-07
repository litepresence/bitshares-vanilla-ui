# Desk pool-map edges — hover, colour, navigation (2026-10-07)

The desk maps had the selector bands' *idea* but none of its behaviour: no
edge hover, a line that was only clickable at its midpoint, and two different
destinations for the same line depending on which desk you were on.

## What was wrong (measured, not assumed)

1. **No edge hover at all.** `pool-graph.js` had a node hover cursor and
   nothing else, so there was nothing to turn yellow — while the line joining
   your two desk legs painted **bold yellow** at rest. On a map where yellow
   means "hovered", a permanently yellow line reads as a stuck selection.
2. **The whole line was not the click target.** The click handler tested
   distance to each edge's **midpoint** with a 12px tolerance. Aiming anywhere
   else along a visible line did nothing — or, worse, landed inside a nearby
   node's radius and opened the *asset* instead of the pool. Measured: a click
   27px from the midpoint navigated to `#/asset/CNY`.
3. **"Edges" meant one thing.** Every edge on every desk routed to
   `#/pools/:id`. On the exchange desk that is the wrong destination — that
   desk trades order books.

## What it does now

| | Swap desk (`#/pools/:id`) | Exchange desk (`#/market/…`) |
|---|---|---|
| Hover a line | turns **yellow** (and the cursor says it's live) | same |
| Click a line | opens **that pool** | opens the **order book** for the two assets the line joins |
| Click a node | opens that asset (unchanged) | same |

- **The line colours (final spec, 2026-10-07):**
  - most lines — muted grey (`--border`)
  - the pair's own pool **and** its route back to BTS — **bluish grey with a
    glow** (`--accent` at 55% alpha, glow in the full accent; the only glowing
    lines on the map)
  - **any** line under the pointer — **yellow** (`--warn`), thicker, no glow;
    yellow means exactly one thing and never sticks once the pointer leaves

  The decision lives in one pure function,
  `edgeStyle(poolId, hi, pathSet, hoverEdge) -> {color, width}` with three
  tokens only: `path`, `warn`, `border`. An intermediate revision painted the
  triangle green; that was a misreading of the request and is gone.
- **The whole line is the target.** `hitAt()` resolves a pointer to a node
  first (a line ends at its nodes, so dragging stays reliable), else to the
  nearest edge **segment** within 8px. Leaving the canvas clears the hover, so
  no yellow sticks without a pointer over it.
- **Exchange-desk orientation rule** (`marketIdForEdge`, QUOTE_BASE, quote is
  the URL head): keep the desk's **base** leg as base when the edge touches it
  ("X per my base" reads the same as the desk you're on); else keep the desk's
  **quote** leg as quote; else the pool's own order. An edge with no usable
  symbols navigates nowhere rather than inventing a market.

## Evidence

- `tooling/pool-graph-test.js` → **190 pass, 0 fail** (was 136). New vectors:
  - **painter** (10, the regression guard): every stroke reaches the canvas as
    a resolvable colour, never a token name; path line = `rgba(…,0.55)` and
    glows; hovered line = `--warn`, thicker, no glow; plain lines = `--border`.
  - **colour contract** (11): hover beats the path set; the pair's own pool and
    both BTS routes are `path`; unrelated pools grey; hovering one line never
    tints another; *nothing is yellow at rest*.
  - **`withAlpha`** (7): hex3/hex6/rgb()/rgba() → `rgba()` at the requested
    alpha; an unparseable input is returned untouched (never a crash, never an
    invalid colour).
  - **line hit test** (17): `segDist` clamps to segment ends; midpoint, a
    quarter along, three quarters along (50px off the midpoint) all hit the
    same edge; ~36px off is an honest miss; a node inside its radius still wins.
  - **market navigation** (8): base-leg edge → `CNY_BTS` regardless of pool leg
    order; quote-leg edge keeps the quote; neither-leg edge falls back; self-edge
    → null; no nav opts → pool (swap desk unchanged).
- `tooling/visual/probe-desk-map-edges.mjs` → **DESK-MAP-EDGES OK**, zero page
  errors. Both desks: loop parked, gesture reaction off, hover registers the
  probed edge, hover clears on leaving, and the click lands —
  swap desk `#/pools/1.19.42`, exchange desk `#/market/GDEX.ETH_XBTSX.ETH`.
- `tooling/visual/probe-desk-map-colors.mjs` → **DESK-MAP-COLORS OK**, sampled
  from the real canvas on both desks:

  | | at rest | hovering a line | after leaving |
  |---|---|---|---|
  | Swap desk | 0 yellow · 11 bluish · 67 grey | **12 yellow** | 0 yellow |
  | Exchange desk | 0 yellow · 19 bluish · 55 grey | **3 yellow** | 0 yellow |

  (`other` counts are glow/anti-aliasing blends, allowed up to a 20% share;
  an all-black map resolves no token at all and fails.)
- Unchanged and green: `pool-net-ui-test` 76 · `pool-net-test` 39 ·
  `market-net-test` 22 · `market-net-ui-test` 23 · `node-network-test` 30.
- Gates: `check_rot.py` PASSED · `check_i18n.py` OK (3770 keys) ·
  `check_types.sh` PASS.

## The black-edges bug (three layers, all real)

1. **The painter assigned a token NAME.** `edgeStyle` returns `"warn"` /
   `"buy"` / `"border"`, and that name went straight into `ctx.strokeStyle`.
   An invalid colour is *silently ignored* by the canvas, which keeps its
   previous stroke — default **black**. Every line went black. The painter now
   resolves the name to a real colour; a black line also means "green on the
   desktop" for anyone reading the diff later.
2. **The hover repainted one frame behind.** `drawGraph` rebuilt
   `canvas._graphRepaint` *after* painting, storing a snapshot of the hover
   value. So hovering painted no yellow, and leaving painted a **stuck** yellow
   (the stale value). The hover now lives on the canvas and `drawGraph` reads
   it live — one source of truth.
3. **No test painted anything.** The suite had vectors for the *decision* and
   for navigation, and none for the painter — so a right answer in the pure
   function could still produce a black map. There is now a recording-canvas
   stub that asserts the values reaching the canvas are resolvable colours
   (`#rrggbb` / `rgb()`), that the path line is `rgba(…,0.55)` and glows, that
   the hovered line is `--warn` and does not, and that no token name can leak
   through again.

The browser probe's own first version also read only `rgb()` from the theme
and so parsed **no** hex token, reporting real green/yellow lines as "other";
it parses hex now. `DESK-MAP-COLORS` samples the actual painted pixels (a
block per point, since a 1–2px antialiased line defeats single-pixel reads)
and asserts the recognised-colour share, so an all-black map still fails.

## Bugs caught by the probe while building this

Three of them were mine, and each is now pinned by a vector or an ordering
assertion rather than a comment:

1. `_wire` re-mapped each edge-mid into a fresh `{x, y, poolId}`, silently
   dropping the leg/symbol/segment payload — the map behaved as if the change
   had not been made at all.
2. `marketIdForEdge` used `qSym`/`bSym` for the two legs and `qA`/`bA` for the
   desk's legs; the base-leg branch assigned both sides the same symbol and
   returned `null` for every edge. Renamed to `legA/symA/deskQuote/deskBase`.
3. The probe itself was wrong three times (aimed inside a node circle, called
   `setReact(false)` and then clicked the switch — which read `false` and turned
   physics back **on**, so the layout drifted mid-measurement — and counted its
   own `{errors}` sentinel as a third measurement). It now parks the layout
   before aiming and asserts the flag from its owners.

## The same bug on the market selector's band (reported next)

"Clicking an edge in the market selector network map does not nav to that
exchange desk for that pair" turned out to be **three** defects, and the first
two were invisible to the existing suite:

1. **69% of lines were dead.** `poolDeskMap` derived market ids from
   `Pool.list` rows for the focus asset, and only when the counterparty symbol
   was present. Measured on the live map: **100 of 319 edges** resolved to
   anything. Now every edge derives its id from the line's **own two symbols**
   (`deskIdForEdge`, pure, headless-tested) — 319/319 resolve, 0 dead. Unknown
   symbols fall back to the pool desk (honest, still clickable) rather than a
   line that does nothing.
2. **The click stripped the payload.** The handler built a fresh
   `{ edgeMid: true, poolId }` object and handed *that* to the nav override, so
   the legs and symbols were gone before the override could read them. It now
   passes the whole record.
3. **The record was missing its own marker.** Band edge records never carried
   `edgeMid`, so `resolveNav` read them as **nodes** — with the payload fix
   that meant clicking an edge opened `#/asset/undefined`. Records now carry
   `edgeMid` plus the segment (`ax..by`) and both legs, the same shape the
   desk engine uses.

Alongside that, the band's hit test moved from **midpoint-only** to
**segment distance** (the same fix as the desk maps), so the whole visible
line is clickable.

Orientation on this map: the focus asset is the **base** (X is probed as base,
so a pair touching it reads `counter_FOCUS`, matching the rows and
`poolDeskMap`); an edge touching neither leg uses the graph's own order; an
object id is never accepted as a symbol (a `1.3.7_1.3.0` desk would 404).

### Evidence
- `tooling/market-net-ui-test.js` → **36 passed** (was 23): the `navEdge`
  override contract (market desk / pool fallback / null), plus
  `deskIdForEdge` vectors including leg-order independence and the
  object-id-is-not-a-symbol rejection.
- `tooling/pool-net-ui-test.js` → **87 passed** (was 76): `segDist` maths and
  the painter/gesture contract (records carry a segment + both legs; the click
  path measures the segment and keeps midpoint distance as the fallback).
- `tooling/visual/probe-market-band-edges.mjs` → **MARKET-BAND-EDGES OK**,
  zero page errors. Census on the live map: **319 edges, 319 to a market desk,
  0 dead**. A click 25% along a line (not the midpoint) opens an order book.
- Unchanged and green: `pool-graph-test` 190 · `pool-net-test` 39 ·
  `market-net-test` 22 · `node-network-test` 30; rot/i18n/types all pass.

### Honest limits
This graph is dense (319 edges over 89 nodes), so lines cross and a few sit
almost on top of each other. Nearest-line-wins is the rule, and where two
lines are within a pixel of each other, *which* one you get is a tie-break,
not a promise — the promise is that a click opens **an** order book for a pair
on the map.

## Note

The exchange desk's fallback (an edge touching neither of the desk's legs)
navigates to the pool's own `A_B` order. That market may be thin or absent; the
desk shows an honest empty state rather than a fake one, which is the intended
behaviour for a market that has no order book.
