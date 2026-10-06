# Full pool-network map on #/pools + order-free search — design (2026-10-06)

Source idea: `squidKid-deluxe/bitshares-networks` `pools/pool_mapper.py` (pyvis + networkx
full-pool network, BFS `nx.shortest_path` pricing to BTS 1.3.0, edge-width by BTS value,
hover balances/prices, drag-to-untangle, DETACH/ATTACH). Idea-only, never imported.
Provenance fix shipped: `vanilla/js/api/pool-graph.js:25`, `docs/parity/dexux-networkx-verdict.md:34`.
`bitshares-dex-ux` has no networkx (verified zero hits) — not the source.

## §1 Architecture + placement (approved)

- New `vanilla/js/api/pool-net.js`: full-graph data. Skeleton load → paginate-all
  `list_liquidity_pools` merge → `lookup_asset_symbols` join → brand colors →
  filter to full / star / union. No DOM, no signing. Chain via `Chain.db/call` only.
- New `vanilla/js/views/pool-net-ui.js`: canvas band. Live-then-settle physics (rAF +
  damping/friction, velocity-threshold sleep), wheel-zoom + pinch-zoom + drag nodes +
  pan, tap node → `#/asset/:symbol`, tap edge-mid → `#/pools/:id`. Existing
  `pool-graph.js` desk 2-step slices untouched.
- New `vanilla/data/pools.json`: skeleton `poolId → [assetA, assetB, shareId, symA,
  symB, symShare, precA, precB, precShare]` captured at ship time. Ids/legs/syms
  immutable; balances/fees live-only. `localStorage` cache for newly-discovered pools,
  chain re-validated each load, stale ids dropped.
- Placement: collapsible band at top of `#/pools` (`pool-ui.js` above `pools-filters`),
  open by default, closed-state remembered in `localStorage`. Fixed height (320px desk /
  240px phone), internal pan — page scroll never hijacked.
- Modified: `pool-ui.js` (mount band + `fA=BTS` default + order-free calls), `pool.js`
  (order-free `list`).

## §2 Data flow (chain-only, table never blocked)

1. First paint: skeleton → instant structure (zero RPC). Table `loadPage()` runs
   immediately, unaffected.
2. Background: `list_liquidity_pools(100, startId)` paginate until short page / empty
   (idle chunks, progressive paint per page). Then one batched `lookup_asset_symbols`
   join (chunked ≤100). Balances stay raw digit strings; human only at render via `Format`.
3. Merge: live rows overlay skeleton (legs must match skeleton or skeleton entry is
   flagged stale, never trusted over chain). New ids → `localStorage` cache. Deleted ids
   → dropped from cache.
4. Filter client-side from loaded graph (no extra RPC): none selected → full; single X →
   star(X) = X + pools touching X + counter-assets (1 hop); both X,Y → union(starX, starY)
   + BFS X↔Y path highlight when exists, orphan verdict when not.
5. Failures: partial graph stands with honest note; `not-connected` → offline note + retry.
   No ES, no feeds, no pyvis/networkx runtime.

## §3 Physics (live-then-settle, eye candy without jank)

- Force-directed: repulsion (Fruchterman-Reingold `k²/d`) + springs on edges + center
  gravity + wall containment. Fixed timestep, cooling schedule, velocity damping.
- Sleeps: all velocities < epsilon for K frames → cancel rAF (settled). Any drag/zoom/
  filter change → wake. `IntersectionObserver` pauses offscreen. `prefers-reduced-motion`
  → frozen first frame + static drag/zoom only, no loop.
- Perf: single canvas, DPR capped at 2, transform-only zoom/pan (no re-layout),
  degree-sized nodes, edge-width from raw-digit magnitude (never float money).
- Phone: `touch-action:none` only mid-drag/pinch inside canvas; swipe-pan thumb
  left/right/up/down; tap (≤5px move) navigates; 44px min hit radius via edge-mid
  tolerance + node radius floor.

## §4 Colors (brand groups, BTS blue guaranteed)

- Same groups as `config.py` `node_color_mapping`: XBTSX→purple, GDEX/DEFI/GAT→teal,
  GOLD/SILVER/CNY/3-letter→blue family, BTWTY/TWENTIX→pink, HONEST→green,
  CRUDE→yellow, IOB→orange, NIUSHI/NSNFT→grey, GOLDBACK/QUINT/BEOS→gold, else red.
- Hexes re-tuned per theme for readability, but BTS (1.3.0) + committee smartcoins
  always BitShares blue in all three themes. Edge: BTS-path highlighted warm yellow,
  user-selected pool glow (existing `pool-graph.js` language), rest theme border grey.
- Legend row under canvas (brand → color chips, tap chip toggles brand dim — display
  only, never chain).

## §5 Order-free search + BTS default (folded in)

- `Pool.list`: single field (either box) → `get_liquidity_pools_by_one_asset(X)`
  (either leg). Both fields → `get_liquidity_pools_by_both_assets` in both orders
  concurrently, merge-dedup by `1.19.x`. `hasNext` = either side has more.
- Labels: `Asset 1 / Asset 2 (order doesn't matter)`; `?a=`/`?b=` keys unchanged
  (back-compat); empty-state note mentions chain legs `a<b` only as trivia, never as
  user burden.
- Default: `fA=BTS` prefilled; absent `?a=` on first load means BTS. Clearable to empty
  for unfiltered full list. Restore-from-query still wins (Back from detail intact).

## §6 Hovers, links, a11y, i18n

- Node hover/tap card: symbol + `1.3.x` + pool-count + hops-to-BTS. Edge hover/tap card:
  pool `1.19.x` + share symbol + human balances (both precisions) + tap → swap page.
  No USD/BTC feeds (saves RPCs, MPA-only — refused for speed per perf discussion).
- Keyboard: canvas `tabindex`, Enter opens BTS node or first hit (existing pattern).
  `role=img` + live verdict label; screen-reader table twin lists pool rows below canvas
  (collapsed `<details>`, same data — canvas never the only source).
- i18n: all strings via `I18n.t` with verbatim English defaults (existing `t()` shape);
  symbols/ids/pool numbers never translated.

## §7 Testing / verification

- Unit (node-safe, no DOM): skeleton parse, merge-dedup, star/union filters, BFS path +
  orphan, brand-color map, order-free param builder (both-orders), `hasNext` merge.
- Headless: `python3 -m http.server` serves; `check_rot.py` clean (no deps, no CDN);
  canvas paints skeleton with zero RPC (stub `Chain`); offline → honest note.
- Human (owner eyes): `#/pools` at 360px + 1440px × 3 themes; collapse remembered;
  tap node → `#/asset`, tap edge → `#/pools/:id`; filter A=BTS → star; clear → full;
  swapped A/B → same rows; reduced-motion → frozen.

## Self-review

- No TBDs; scope is one page band + two small `pool.js`/`pool-ui.js` changes — no new
  routes, no desk changes, no feed reads.
- Consistent: full/star/union all derive from one loaded graph; table + map share the
  same order-free helper; skeleton never overrides chain legs.
- No contradictions with doctrine: platform canvas + rAF only, vendored nothing,
  `python3 -m http.server` serves, 2036 test passes (stale skeleton still paints,
  live chain corrects it).
