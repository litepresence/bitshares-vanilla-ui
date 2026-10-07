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

- **Yellow means hovered. Nothing else.** The "triangle" — the pool joining
  your two desk legs *plus* both legs' routes to BTS — is now **green** as one
  visual unit (it used to be the same bold yellow bucket as the path lines).
  Every other line stays muted grey. The colour decision lives in one pure
  function, `edgeStyle(poolId, hi, pathSet, hoverEdge)`.
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

- `tooling/pool-graph-test.js` → **170 pass, 0 fail** (was 136). New vectors:
  - **colour contract** (11): hover beats the triangle; triangle pools green;
    unrelated pools grey; hovering one line never tints another; *nothing is
    yellow at rest*.
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
- Unchanged and green: `pool-net-ui-test` 76 · `pool-net-test` 39 ·
  `market-net-test` 22 · `market-net-ui-test` 23 · `node-network-test` 30.
- Gates: `check_rot.py` PASSED · `check_i18n.py` OK (3770 keys) ·
  `check_types.sh` PASS.

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

## Note

The exchange desk's fallback (an edge touching neither of the desk's legs)
navigates to the pool's own `A_B` order. That market may be thin or absent; the
desk shows an honest empty state rather than a fake one, which is the intended
behaviour for a market that has no order book.
