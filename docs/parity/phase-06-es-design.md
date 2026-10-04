# Phase 6 design — most impactful wallet/explorer features via ElasticSearch

Status: DESIGN (no code). Ground truth: `tooling/history-capabilities-2026-10-02.json`
(probe `tooling/history-probe.mjs`, 9/9 nodes, 2026-10-02) + browser CORS preflight
(es.bitshares.dev GO / kibana.bitshares.dev NO-GO). Philosophy: provide everything
available, disclose 3rd party, fail gracefully, offer a reconciliation path.

## Baseline facts (locked, do not re-litigate in implementation)

- WS `history_api` resolves on ALL 9 probed nodes (7 mainnet + 2 testnet). Live-verified:
  `get_account_history`, `get_relative_account_history`, `get_account_history_operations`,
  `get_fill_order_history`, `get_market_history`, `get_market_history_buckets`.
- WS gaps verified ABSENT everywhere (both api ids): `get_asset_holders`,
  `get_asset_holders_count` (`-32601 Method not found`). `get_trade_history` is a
  **database**-api method (`database_api.hpp:662`, ok on all 9) — not a gap.
- Bucket sets differ per node (most end at weekly `604800`; `node.xbts.io`,
  `api.dex.trading`, both testnets offer `1800` instead). Callers must read
  `get_market_history_buckets` at runtime, never hardcode.
- Testnet `BTS` is NOT `1.3.0` (sweep resolved `1.3.1420/1.3.15`); never hardcode asset ids.
- Raw ES HTTP: `POST https://es.bitshares.dev/<index>/_search` works from a real
  browser context (CORS `ACAO` echoes origin incl. `null`, anonymous, no auth) on both
  indexes (`bitshares-*`, `objects-balance`). Kibana host is a UI shell (no CORS) —
  link it, never fetch it. Canonical host = the help-listed `https://es.bitshares.dev`
  behind one constant; `esEnabled` defaults ON.
- Transport rule: WS `history_api` first (chain-native framing); raw ES HTTP only for
  what WS cannot serve (holders via `objects-balance`, tx-by-hash, aggs). Every ES
  surface carries the third-party notice (t.me/bitsharesDEV) + graceful fallback to
  the WS/chain variant or a Settings-path notice.

## Ranked features (impact × feasibility)

### 1. Transaction-by-hash deep links (explorer) — HIGHEST impact/cost ratio
Today `get_recent_transaction_by_id` (`database_api.hpp:200`) returns a location-less
tx, so bare-hash search honestly defers. ES `bitshares-*` carries block context:
`{term:{"trx_id.keyword":hash},size:5}` → fall back `{term:{trx_id:hash}}` →
`{match:{trx_id:hash}}` (astro `Explorer.ts:231-235` pattern), then WS fallback.
Surface: hash search resolves to `#/block/:h/:ix`; failure renders the history-notice
variant (never a guessed block). Effort: small (one query + existing render path).

### 2. Account activity search + operation filter (account view)
`get_account_history_operations` is live on all nodes, but WS paging is id-walk only.
ES `bitshares-*` adds text/range/collapse: `{bool:{must:[{term:{"account_history.account":id}}
(+ `block_data.block_time` range)]}}, collapse:{field:"operation_id_num"},
sort:[{operation_id_num:desc}]` (astro `AccountActivity.ts:79-94`). Surface: filter
by op type + date window on `#/account/:name` history; WS `historyPaged` remains the
fallback when ES is off/unreachable. Effort: medium (filter UI + dual-source merge
with de-dupe by `operation_id_num`).

### 3. Top holders per asset (asset view) — fills a genuine WS void
No WS method exists (sweep-proven), but ES `objects-balance` does:
`{match:{asset_type:{query:assetId}}}`, sort `balance desc` (astro
`TopAssetHolders.ts:30-37`). Surface: "Top holders" table on `#/asset/:symbol` with
human amounts via `format.js` + the ES third-party notice; when ES is off, the panel
explains the absence (chain API has no holder endpoint) instead of an empty table.
Effort: medium (new panel + amount formatting + notice).

### 4. Market trade/fill depth beyond the WS window (market desk)
WS `get_fill_order_history` caps per call; ES `bitshares-*` gives ranged fill queries
(dex-ux `kibana_fills`: market-pair filter + `operation_type:4` + time range) and
`get_market_history_buckets` (already WS-live) drives bucket choice. Surface: deeper
"Trade history" paging + long-window charts on `#/market/:id`, labeled by source
(chain vs community index — the pool desk's `hist_source_es/chain` labels are the
template). Effort: medium (reuse `market-fills-history.js` dual-source shape).

### 5. Pool swap leaderboards / top swaps (pools)
ES agg on `operation_history.op_object.pool.keyword` filtered by `operation_type:63`
+ time range (astro `TopPoolSwaps.ts:53-72`; dex-ux `kibana_swaps`). Surface: "Top
swaps" on pool detail; WS `get_liquidity_pool_history` (`pool.js:183`) stays the
default/fallback. Effort: medium (agg parsing + existing swap table).

### 6. Chain-wide op search (explorer activity)
`bitshares-*` `multi_match`/term queries across `operation_type`, account, memo text,
and time ranges turn the tip-sample activity panel into a searchable window. Surface:
explorer search box gains ES-backed ranked results with the ES notice; WS object/block
routing stays the deterministic path. Effort: medium-large (ranking UX + debounced
typeahead already exists in `explorer-ui.js` to build on).

### 7. Balance/portfolio lookup for watch-only (account view, deferred)
`objects-balance` per-owner queries enable watch-only portfolio snapshots without
walking every asset. Deferred behind 1–6: value is real but owner-field mapping needs
its own verification pass. Recorded here so it isn't discovered late.

Explicitly OUT: anything needing `kibana.bitshares.dev` JSON (no CORS by design),
gateway internals, news/editorial (not chain data, not ES data).

## Cross-cutting requirements (every feature above)

- Capability gates: `historyHere()` (WS id resolves on active node) / `esAllowed()`
  (`esEnabled` pref) / `esAvailable()` (CORS+reachability) from the planned
  `api/history-cap.js`; no raw `fetch(ES)` outside it; bounded `size`/ranges, never
  `match_all`.
- Notices: shared `historyNotice(kind)` — history variant links `#/settings`;
  ES variant names third-party status + t.me/bitsharesDEV + help ES entry; testnet
  variant cites the sweep (testnet ES absent) with the Settings path.
- Settings: History pill per node row/card (from probe's `hasHistory`), surfaced head
  age + pill in-row (tooltip keeps the rest), ES on/off switch (default ON) +
  disclaimer, testnet banner. Fallbacks everywhere instruct: Settings → history node
  or enable ES.
- Money/i18n/a11y: all amounts through `format.js` with raw→human vectors; all copy
  as `t()` keys across 10 dicts; 44px targets, no hover-only UI, `aria-live` results.
- Gates: `check_rot.py` (raw-ES needs the written §4.5(b) exception: removable via the
  WS fallback + one-constant host swap), `check_types.sh`, unit vectors per new query
  shape, theme trio + 390px/1440px shots per surface, parity-note deltas.

## Rollout order
1 → 2 → 3 (each independently shippable; 1 is the smallest proof of the ES path) →
4 → 5 → 6 → 7. Steps 1–2 need WS-only fallback from day one; step 3 is the first
ES-or-notice surface and sets the disclosure pattern the rest copy.
