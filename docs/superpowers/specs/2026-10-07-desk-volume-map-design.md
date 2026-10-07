# Desk volume map — design spec

Date: 2026-10-07. Owner request: the `#/markets` band map should mirror
the market selector's universe the way the swap-side map mirrors the pool
selector — nodes/edges appear only for pairs with recent volume. Style
unchanged (same canvas pipeline). Approved as presented (plan-mode design
+ "perfect").

## 1. Analogy (binding)

Swap side: pool selector (list) + pool-net map reflecting pool presence.
Exchange side: market selector (top-markets table) + band map reflecting
**markets with recent volume**. The band stops consuming `poolRows`; the
table's already-probed ticker rows become the graph source. Zero new chain
calls — the data is free (one `get_ticker` per candidate already paid).

## 2. Shapes (locked)

```js
// MarketNet.graph(rows) -> { nodes, edges, meta }
// rows: probeOne ticker rows {a, b, symA, symB, baseVol, quoteVol, latest, change}
nodes: [{ assetId: "1.3.x", sym: "SYM" }]          // distinct assets of kept edges
edges: [{ id: "QUOTE_BASE", a: "1.3.x", b: "1.3.x" }]  // id IS the desk id
meta:  { "<deskId>": { symA, symB,
         volBaseRaw, volBasePrec, volQuoteRaw, volQuotePrec,
         latest, change } }
```

- Gate: edge kept iff `baseVol` is a digit string with nonzero value
  (BigInt-safe; malformed counts as zero → hidden from map, kept in table).
- Orientation dedupe: one edge per unordered pair; the **focus-base
  orientation wins by page convention** (never by cross-unit size — volumes
  in different base units are incomparable, and we refuse to pretend).
- `latest`/`change` ride along for the hover card; precisions ride along so
  chrome formats at render (money discipline: raw until `Format`).

## 3. Seams (locked — no signature changes)

- `PoolNetUI.mount(doc, wrap, getSelection, opts)`: `opts` gains optional
  `mode: "market"`, `graph`, `meta`. When `graph` present: skip the
  `data/pools.json` skeleton + `liveBackfill` entirely; `S.full = graph`,
  `S.meta = meta`. `S.navOpts` already flows to chrome — mode branches read
  it there. Physics, gestures, resize/destroy, selection, `filterGraph`
  untouched.
- `pool-net-paint.js _edgeWidth(meta, id)`: same signature; accepts
  `volBaseRaw` digit string with the **identical** digit-length math
  (default approved; rank-stepped thickness recorded as the unit-proof
  alternative). Node radius untouched (degree-based).
- `pool-net-chrome.js`: `edgeCard`/`nodeCard` gain a mode branch —
  market edge card = volume human (both legs, raw in title) + latest +
  change + desk id; market node card = symbol + edge count (no BTS-hop
  fiction — `findPath` is pool data). Brand-chip row hidden in market mode;
  path overlay off. Status: "N markets · M assets".
- `market-net-ui.js mountBand`: builds `MarketNet.graph(ranked)` from the
  table's rows, passes `{navEdge: direct desk nav, mode: "market", graph,
  meta}`. `deskByPool`/`poolDeskMap`/`deskIdForEdge` leave this path
  (verify zero other callers, then delete + drop their tests). `poolRows`
  `Pool.list` fetch STAYS — `candidates()` discovery still uses pool
  counterparties; only the band stops consuming it.
- Empty map (nothing with volume): honest note, never blank canvas.

## 4. Strings (new, `market_net.*` × 12 dicts)

`map_ready` ("%(n)s markets · %(m)s assets"), `map_empty` ("No markets
with recent volume."), card labels reuse existing keys where they fit
(volume/price/change terms already keyed for the table).

## 5. Non-goals

Market picker untouched. `#/pools` graph untouched. No polling (map =
load-time snapshot, like the table). No QR. No new deps, ES5, classic
script tags (anti-rot §4.5: same file, same fate as the pool pipeline).

## 6. Verification

- Unit vectors: zero-vol filtered, malformed hidden, orientation dedupe
  (focus-base wins), empty rows → empty graph, no input mutation.
- `node --check` touched files; `check_rot.py` / `check_types.sh` /
  `check_i18n.py` green; existing market-net + pool-net suites green.
- Human browser pass: phone + desktop widths, all three themes, hover
  cards, edge→desk nav, empty-volume state.
