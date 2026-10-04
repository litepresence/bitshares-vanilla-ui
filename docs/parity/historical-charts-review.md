# BitShares-Historical-Charts review (reference #6, `dadd21b`, 2026-09-30)

squidKid-deluxe static-JS pool/book chart pages (ES + nodes, no build).
Unlicense (public domain). Behavior/math reference only — never a dependency.

## Data sources

- ES primary (`main.js:2`, same `es.bitshares.dev` host we use): op-63 pool
  swaps (`pools.js:2-49`, size 10000, `search_after` pagination
  `main.js:214-261`) + op-1 limit_order_creates for "books" (`books.js:2-58`).
- Nodes for object lookups only (`getObjects` chunked 90, `lookup_asset_symbols`).
- localStorage objectCache (audited pattern, crash-prone on unknown legs
  at `search-engine.js:124`).

## Do NOT mirror (vanilla is correct)

1. Double-divided volume (`pools.js:73-84`, `books.js:85-94` — `÷prec` twice).
2. "Book charts" are op-1 intent prices, NOT fill tape (don't treat as fills).
3. Pool price orientation is A-per-B; ours is B-per-A (desk-header convention).
4. Gap rules emit zero-price leading candles (`main.js:170-179`) and pad
   head/tail (`both.js:74-99`) — ours drops leading + carries forward only.
5. Bucket boundary: dex-ux `bisect` puts on-boundary events NEXT bucket;
   floor rule (ours + historical-charts + QTradeX) keeps CURRENT.
6. `parseFloat/10^prec` + `toFixed(16)` + CDN libs — unportable per #6/§4.5.

## Portable learnings (patterns only)

1. Paginated deep ES fetch (`search_after`, 10k chunks, progress hook) —
   future deep-history mode (we single-page 500 today).
2. Multi-pool-per-pair fan-out (`both.js:14-31` + `Promise.all`) — shape for
   an "all pools for pair" view (we're single-pool).
3. Time-range sync shell (`synchronizeMultipleCandles`) with OUR gap rules.
4. Index bootstrap (newest 1.19.x/1.3.x via ES → delta fetch → cache) for
   autocomplete.
5. Pool failover/lock hardening (`graphene-rpc.js:592-644`) — diff vs our
   `Chain.js` failover when touching it next.
