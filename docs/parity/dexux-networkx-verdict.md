# dex-ux "networkx" verdict (2026-09-29)

User memory: bitshares-dex-ux had interesting networkx plots worth mimicking.

## Verdict: no networkx exists in the repo

- `grep -ri networkx` over the full `reference/bitshares-dex-ux` checkout
  (`bad2545`, sole branch `master`, 7 commits): **zero hits**.
- `requirements.txt` lists only `aiohttp/falcon/socketify`.
- The node-link-looking glyphs in `stack.png` are vendor logos (aiohttp,
  socketify), not plots — it is an architecture diagram, not app output.
- Client charts in the repo are Plotly depth, LightweightCharts line/candle,
  and KLineCharts (`order_book.html:21-23`, `main.js:69-188`) — all refused
  transports, never imports.

## What exists instead (graph-adjacent, ported or portable)

1. **Synthetic pool orderbook from x·y=k** (`falcon_app.py:167-214`) —
   PORTED as `PoolHistory.synthBook` + pool x·y=k curve canvas.
2. **Cumulative depth staircase** (`json_to_html.py:19-44`, Plotly step-fill) —
   PORTED as the canvas depth slice (exchange + pool-synth).
3. **Discrete→candle bucketing** (`kibana.py:280-364`) — PORTED as
   `swapsToCandles` / `MarketCandles.candles` local bucketing.
4. **Pool↔asset routing** (pool rows route via pool contract id,
   `main.js:380-387`) — PORTED as pool-detail routing + the new
   **Pool map** provenance plot (`pool-graph.js`: 2-layers-out asset↔pool
   graph, BFS fewest-hops/widest-volume path back to BTS 1.3.0, orphan-pair
   "no BTS path" state). This is the vanilla answer to "network plot": a
   live, chain-data, canvas-rendered connection map exactly where the user
   asked (below the DOM slice, Plots-toggleable, both desks) — without a
   graph library, since layout is deterministic layered rings (no physics
   engine needed at ≤25 nodes).

## Rule restated

If a future dex-ux checkout grows a real network plot, port its MATH
(adjacency + path choice) into dependency-free JS with vectors, verified
against its published outputs — never install, never import, never copy
plotting code. Same treatment as QTradeX indicator math (§5.7).
