# Market Hops — ES-driven multi-hop market networks (design)

Date: 2026-10-07
Status: approved by owner (clean split, pool fallback, honest note, no caps, price provenance, BTS most-filled route)
Scope: `/workspace/vanilla/` — the two MARKET network charts only. Pool charts are untouched.

---

## 1. The problem

The four network plots split into two families today:

| Chart | Route | Engine | Backend today |
|---|---|---|---|
| Pool selector band | `#/pools` | `PoolNetUI` (full-network canvas) | pools (skeleton + `Pool.list`) |
| Swap desk slice | `#/pools/:id` | `PoolGraph` painter | pools (`buildGraph` + op-63 24h gate) |
| Market selector band | `#/markets` | `PoolNetUI` `mode:"market"` | 1-hop ticker probes only |
| Exchange desk slice | `#/market/Q_B` | `PoolGraph` painter | pools (a pool graph on a market desk) |

Pools are model citizens: a global graph, hop reasoning to BTS, honest fallback wording.
Markets are not. Specifically:

1. The selector map (`market-net-ui.js:482-529`, `market-net.js:80 candidates`) only knows pairs
   it can name up front: pool counterparties of X, curated seeds, cache — capped at 20
   `get_ticker` probes. A route like `BTS → USD → BTC` is invisible unless `BTS/BTC` itself
   has a ticker.
2. The exchange desk map shows POOL provenance (`market-desk-fill.js:331 PoolGraph.buildGraph`,
   gated by `PoolHistory.poolsActive24h` on op-63 swaps) while its own note claims
   "market trade in 24 hours" (`market-desk-fill.js:758`). The note describes markets; the
   graph shows pools. On a market desk that is the wrong question.

Owner's ruling: **pool charts show pools, market charts show markets. Style stays shared;
only the backend switches.**

## 2. Goals

* G1. Market selector band: full N-hop market web reachable from the selected token through
  pairs with 24h fill activity. Depth **3**.
* G2. Exchange desk map: the same, centered on BOTH desk legs. Depth **2**.
* G3. **Price provenance is part of the display**, not a footnote — every line states the
  activity behind it (fills/24h) and, where the chain has already been asked, the price
  (`latest`, 24h `vol`).
* G4. Explicit **route to BTS via most-filled markets** when the graph reaches BTS
  (the market analogue of the pool map's BTS-path glow).
* G5. **No caps.** The full reachable web is shown. ES transport pages are the only bound,
  and a partial page degrades honestly rather than silently truncating.
* G6. Fallback to **pools** when ES cannot answer (testnet, pref off, unreachable, partial),
  with the note switching to the pool definition so a fallback map never wears a market
  definition.
* G7. Zero new runtime dependencies, no build step, static-servable.

## 3. Non-goals

* Pool selector band and swap desk slice: **no behavior change at all**.
* No per-pair ES fan-out (one aggregation + in-memory BFS, never N queries).
* No ES-derived volume. Fill *counts* come from ES; prices/volumes stay with the chain
  (`get_ticker`). ES sums over `amount_` are not fill-volume.
* No new route, no menu entry, no settings toggle for this feature.

## 4. Architecture

### 4.1 New module: `vanilla/js/api/market-hops.js`

No DOM, no signing, no storage beyond an in-session cache.

```
fetchActivePairs(opts) -> Promise<{pairs: [{a,b,fills}], partial: boolean}>
    ONE HistoryCap.esSearch("bitshares-*", topMarketsBody(days, afterKey))
    rejects "es-disabled" / "es-unavailable" / non-mainnet
```

Query body — the `top-markets` shape already proven in `es-lab.js:286-293`
(astro `TopActiveMarkets.ts:77-93`):

```
{ size: 0,
  query: { bool: { filter: [
      { term: { operation_type: 4 } },
      { range: { "block_data.block_time": { gte: "now-24h", lte: "now" } } } ] } },
  aggs: { by_pair: { composite: { size: 1000,
      sources: [
        { pays:     { terms: { field: "operation_history.op_object.pays.asset_id.keyword" } } },
        { receives: { terms: { field: "operation_history.op_object.receives.asset_id.keyword" } } }
      ] } } },
  after_key }                                  // pagination, present only on pages 2+
```

Pagination: `after_key` from `aggregations.by_pair.after_key`, **max 3 pages**, one 15s
total deadline across pages (`HistoryCap.esSearch` `opts.timeoutMs` gets the remainder).
A page that returns `size == 1000` on the last allowed page sets `partial: true`.
`track_total_hits: false` throughout.

Merging (`mergePairs`, pure): directed composite buckets collapse to unordered pairs —
sort the two ids, join with `|`, sum `doc_count`. First-seen order preserved for
determinism. Malformed buckets (missing `key.pays`/`key.receives`, non-`1.3.x` ids)
are dropped, never coerced.

```
hopsFrom(pairs, seeds, depth) -> {nodes, edges, layers}
    Pure BFS. `depth` = 3 (selector) or 2 (desk). NO caps.
    Seeds always included as nodes even when isolated.
    Nodes sorted by fills desc, then asset id asc (deterministic rings).
    Edges carry `fills` and the BFS layer they were discovered at.
```

Route highlight (`routeToCore`, pure): BFS from each seed over the fills-weighted
adjacency, preferring the fewest hops and the widest bottleneck (same tiebreak as
`PoolGraph.findCorePath:211`, weighted by `fills` instead of pool size). Returns
`{pools: [deskIds], hops: number}` or `null`. **Null is a normal outcome** — a market
web that does not reach BTS is not an orphan warning, and must not paint one.

`toGraph(hops, syms)` emits the shape BOTH painters already speak, unchanged:
`nodes:[{assetId, sym}]`, `edges:[{id, poolId, a, b, fills, sizeRaw}]` where
`id === poolId === QUOTE_BASE desk id` (`market-net.js:226 graph` precedent — one
identity, two names, never two values), plus
`meta[id] = {symA, symB, fills, latest, volBaseRaw, volQuoteRaw, volBasePrec, volQuotePrec}`.
`sizeRaw` is the fills count as a digit string so the shared `_ramp`/`_edgeWeight`
pipelines keep working without a second ramp.

Symbol join: one `lookup_asset_symbols` call for the surviving ids (misses stay bare ids,
never throws). Precisions come from the view's existing `Asset.describe` cache where
present (selector) or the desk's `state.assets` (desk).

Session cache: `fetchActivePairs` memoizes per `days` for the session only. Capability is
re-probed each load; nothing is persisted (AGENTS.md §4.5 doctrine — cache is a speedup,
never load-bearing).

### 4.2 Market selector band (`#/markets`)

`market-net-ui.js mountBand` gains a market-hops path ahead of the existing graph:

1. Existing ticker table (top-20 by `base_volume`, sparklines) stays **exactly** as is —
   it is the price/volume truth and the chain owns it.
2. Map graph resolution:
   * `MarketHops.fetchActivePairs({days:1})` → `hopsFrom(pairs, [xDesc.id], 3)` →
     `toGraph` → mount with `mode:"market"`, `navEdge` unchanged (desk id → `#/market/Q_B`,
     `1.19.x` defensive → `#/pools/id`, `1.3.x` pairs → null).
   * On any rejection / `partial:true` → keep today's `MarketNet.graph(ranked)` 1-hop
     ticker graph (existing code path, unchanged) and set the fallback note.
3. Status line: ES path reports `N pairs · M assets` (`market_net.map_hops_ready`);
   fallback reports the existing `market_net.map_ready` wording.
4. Edge card gains the activity + price provenance (`NetChrome.edgeCard` market branch):
   `DESK · A–B · N fills/24h` plus `latest` / 24h `vol` when the row's ticker probe
   already supplied them.

### 4.3 Exchange desk map (`#/market/Q_B`)

`market-desk-fill.js` — the `fetchPoolMap`/`redrawPoolMap` pair becomes backend-agnostic
while keeping its DOM, flag (`pmap` / `state.showPoolMap`), canvas, physics switch,
note element and nav mode untouched:

1. `fetchPoolMap` tries `MarketHops` first: seeds `[q.id, b.id]`, depth 2 → `toGraph` →
   `state.graphData = {graph, assetA:q.id, assetB:b.id, kind:"market", pathA, pathB}`
   where `pathA/pathB` come from `routeToCore` (may be null).
2. On rejection / partial / zero pairs → the existing `PoolGraph.buildGraph` + op-63
   `gateByActivity` path runs unchanged and sets `kind:"pool"` (pool fallback, approved).
3. `redrawPoolMap` passes `kind` into `PoolGraph.drawGraph` opts; the painter branches:
   * **market kind**: skip the BTS trust verdict text + orphan takeover banner, skip the
     pool size ramp in favour of a fills ramp, honor `routeToCore` as the "path" set.
   * **pool kind**: byte-identical to today.
4. Note (`graphNote`) always states the painted truth:
   * market strict: `A line is a market that filled in the past 24 hours. N pairs shown.`
   * market no-route: same line + `No route to BTS through filled markets.` (informative,
     not a warning)
   * pool fallback: today's pool wording verbatim (`pool_detail.map_connects*` / `N=`),
     so a fallback map never claims markets.

### 4.4 Ink and labels

* `edgeT` / desk ramp gain a **fills** window (digits of the fills count) alongside the
  existing pool-balance and market-volume windows — three absolute windows, one visual
  language, so a given blue means the same size everywhere. Counts only, never money.
* Market nodes: desk legs keep accent, BTS keeps accent when present, the rest muted —
  no green/yellow/red trust coding (that is pool semantics; a thin market is normal).
* Hover already turns a line yellow on both engines (`edgeStyle:1240`, paint `:265`) —
  yellow stays exactly one meaning: "this line is clickable".

## 5. Error handling

| State | Selector band | Exchange desk |
|---|---|---|
| ES ok, pairs found | 3-hop market web, market note | 2-hop market web, market note + BTS route |
| ES ok, zero pairs | honest empty (`market_net.map_empty`) | honest empty (`pool.touch_hint`) |
| ES pref off | 1-hop ticker fallback + fallback note | pool graph + pool note |
| testnet | 1-hop ticker fallback + fallback note | pool graph + pool note |
| ES unreachable | 1-hop ticker fallback + fallback note | pool graph + pool note |
| partial page | same as unreachable (never a silent cut) | same |

Testnet never fires ES: the index is mainnet-only and market/pool ids collide across chains
(`pool-history.js:330` records this for pools; same rule for markets).

## 6. Testing

New `tooling/market-hops-test.js` (node, no network):

1. `mergePairs` — directed→unordered merge, summation, dedupe, malformed drop, determinism.
2. `hopsFrom` — depth 3 respects the bound, depth 2 on the desk graph, seeds always present,
   isolated seeds kept, deterministic node order, no caps (a 200-pair chain yields all of it).
3. `routeToCore` — fewest hops, widest-bottleneck tiebreak, null when unreachable (never a
   fabricated route).
4. `toGraph` — `id === poolId === QUOTE_BASE` orientation matches `market-net.js` desk rule,
   meta carries fills + optional price provenance, malformed rows dropped.
5. Query body shape pinned against `es-lab.js:286` (`operation_type: 4`, 24h range,
   composite on both legs).

Regression: `tooling/market-net-ui-test.js`, `tooling/pool-net-*`, `tooling/market-desk-*`,
`tooling/split-smoke-test.js` all stay green.

Gates before "done": `bash tooling/check_types.sh`, `python3 tooling/check_i18n.py`,
`python3 tooling/check_rot.py`, plus a headless run of the full test suite.

## 7. Parity note

`docs/parity/market-hops.md` with the eight contract fields: reference behavior
(`bitshares-ui/app/components/Exchange/`, `astro-ui/src/nanoeffects/TopActiveMarkets.ts`),
vanilla file:line, manual mainnet + testnet steps, raw→human vectors for `fills` and the
provenance fields, theme trio + phone/desktop checks, headers present, anti-rot answers
(a)–(c), and gate output.

## 8. Anti-rot gate (§4.5)

* **(a) 2036 test** — ES is fetched over `fetch` through the existing `HistoryCap.esSearch`
  seam (already shipping in `market-fills-history.js`, `pool-history.js`). No new host, no
  new transport, no new API surface. Canvas + DOM + BigInt only. Runs in any contemporary
  browser.
* **(b) Newly depended on** — one community ES endpoint (`es.bitshares.dev`, already the
  app's canonical `ES_BASE`). Not vendorable (it is data, like a node list). Removal plan:
  deleting `market-hops.js` and the two call sites restores the pool-graph-only behavior
  exactly; the pool charts never depended on it.
* **(c) Smallest subset** — `market-hops.js` alone plus the `kind` branch in the two
  painters. Everything else (physics, gestures, nav, notes, notes' DOM) is shared with the
  pool charts and could not be deleted without breaking them.

## 9. Strings (i18n, all 12 locales)

```
market.map_hops_ready     "%(pairs)s pairs · %(assets)s assets · 24h fills"
market.map_hops_note      "A line is a market that filled in the past 24 hours. %(pairs)s pairs shown."
market.map_hops_no_route  "No route to BTS through filled markets."
market.map_hops_fallback  "Showing pool connectivity — 24h market fills unavailable (history unavailable)."
market.map_edge_fills     "%(desk)s · %(a)s–%(b)s · %(fills)s fills/24h"
market.map_edge_price     "@ %(price)s · %(vol)s"
```

Placeholders, symbols, ids and desk ids stay byte-verbatim; non-`en` dicts stay honest
English stubs per the existing convention.