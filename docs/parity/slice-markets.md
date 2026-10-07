# Slice markets parity note — `#/markets` landing (chain-only top-markets + mapper)

Plan: `docs/superpowers/plans/2026-10-07-market-net.md` (Tasks 1–3, 5–6).
Spec: `docs/superpowers/specs/2026-10-07-market-net-design.md` (§1–§4).
Route: `#/markets` → search (Asset 1 defaults BTS, optional Asset 2) →
top-markets table by 24h volume → same-canvas network mapper → `#/market/QUOTE_BASE` desks.

## What landed (vanilla file:line)

- `vanilla/js/api/market-net.js` (251) — discovery data, no DOM, no signing:
  `candidates(poolGraph, xId, seeds, cached, typed)` (pool counterparties of X
  first as `Y_X` ids, then curated seeds, cached, typed; dedupe; cap 20),
  `rank(rows)` (BigInt `baseVol` volume-desc, zero-volume kept, symB tie-break),
  `buildGraph(rows)` (caller-filtered rows → `{nodes, edges}` with
  `QUOTE_BASE` desk ids), `readCache/writeCache` (`localStorage marketNetSeen`),
  `reconcileCache(seedIds, liveIds)` (cache := live-minus-seeds, stale dropped).
- `vanilla/js/views/market-net-ui.js` (751+26) — `#/markets` landing:
  `renderMarkets(root)`; X-only discovery (pool counterparties + curated seeds
  + cached, `Market.stats` X-as-base per counter); two-asset order-free pair
  (both orientations probed, `Pool.list` both-orders precedent); volume-desc
  table (Market·Last·24hΔ·24h vol·7d) + honest "Top N of M probed" scope note;
  lazy top-8 sparklines (`MarketCandles.candles`, 7d daily, after the table —
  table interactive before mapper/sparks finish); collapsible band
  (`marketNetOpen`, default open) mounting `PoolNetUI` with a navEdge override
  (known pool edge → `#/market/…` desk via `poolDeskMap`; unknown → null, never
  pool default; navNode stays pool default `#/asset/:symbol`); `?a=/?b=`
  deep-link seed (Back from a desk restores the search); cold-load auto-retry
  (see Task-6 fix below).
- `vanilla/js/views/pool-net-ui.js` — Task-2 nav-opts passthrough only:
  `mount(doc, wrap, getSelection, opts)` with `opts.{navEdge,navNode}`; pure
  `resolveNav(hit, opts)` seam; absent opts = `navForHit` pool behavior
  byte-identical (all pool-default vectors unchanged). `market-picker.js` untouched.
- Route `vanilla/js/router.js:274-277` (`/markets`, title "Markets"); 2 script
  tags `vanilla/index.html`; `market_net.*` locale keys (20) in all 12 dicts.

## Reference behavior (file:line)

- #1 desk-id convention: `MarketRow.jsx:70`
  (`marketID = quote.get("symbol") + "_" + base.get("symbol")`); vanilla
  contract `vanilla/js/api/market.js:141-151` (`parseId`: quote = URL head,
  base = URL tail), `:165` (pair key `QUOTE_BASE`), `:382-387` (discovery ids
  `q + "_" + b`), `:590` (`href = "#/market/" + id` — bare id, no transform).
  Chain calls take `(base, quote)` = swapped vs URL (`market.js:452-454`).
- #4 ground truth: `get_ticker(base, quote)` —
  `reference/bitshares-core/libraries/app/include/graphene/app/database_api.hpp:618`;
  `get_market_history` — `api.hpp:229-237` (via `market-candles.js`).
- #2 consulted for op coverage only (no per-op work here — read-only landing).
  ES transport refused per doctrine (§4.5): tickers + market-history only.

## Desk-id orientation proof (verify, don't invent)

Rows probe `Market.stats(X, Y)` (X-as-base so `base_volume` compares in X
units) with `a = X-as-base, b = counter-as-quote`. The desk id is therefore
`symB(counter/QUOTE) + "_" + symA(X/BASE)` — e.g. X=BTS vs BTC probes
`stats(1.3.0, BTC-id)` and links `#/market/BTC_BTS`. Vectors:
`market-net-test.js` §4 (BTS/BTC row → exactly `BTC_BTS`);
`market-net-ui-test.js` (stub tickers BTS/USD 5000, BTS/BTC 9000 → hrefs
`["#/market/BTC_BTS", "#/market/USD_BTS"]`, volume-desc). Pool-band edges map
through `poolDeskMap`: pool `1.19.1` (BTS/USD legs) → `#/market/USD_BTS`
(vector-pinned). Live headless `#/market/BTC_BTS` renders `BTC / BTS` header
from the same `get_ticker` source — desk and landing agree.

## Chain calls + per-search RPC budget (bounded, chain-only)

| Search | Calls (worst case) |
|---|---|
| X-only (default BTS) | 1 `Asset.describe(X)` + 1 `Pool.list({assetA: X, limit: 100})` (counterparties, free graph legs) + ≤20 `Asset.describe(counter)` (in-flight-memoized, `descCache`) + ≤20 `get_ticker(X-as-base, counter)` + ≤8 `get_market_history` (top-8 sparklines, lazy after table) |
| Two-asset (X + Y) | 2 `describe` + 2 `get_ticker` (both orientations, each its own desk) + ≤2 sparkline histories |

No ES reads anywhere in this flow (grep-clean: `get_ticker` /
`get_market_history` only). Deviation from spec §2's "≤20 tickers + 1 symbol
join" wording, recorded honestly: the symbol join is per-counter memoized
`describe` (lookup + `get_objects` + `get_accounts` each, `asset.js:128-175`),
not one batched call — still bounded by CAP 20 and never load-bearing (cache
is a speedup; chain re-validates every load). Idle chunks + progressive paint;
table paints before sparks/band settle (pools non-blocking contract).

## Human terms, never raw integers (#6)

Money stays raw digit strings/BigInt until `Format` renders: `rank` compares
`BigInt(baseVol)` (float never touches volume); `humanVol` renders
`Format.formatAmount` per leg with per-asset precisions, raw `base/quote`
pair in `title` (`account.raw_prefix`); `lastText` via `Format.priceSig`
(full chain string in `title`); `chgSign` is string-only digit inspection.
Vectors (headless, non-BTS precisions): baseVol `9000` p5 → `0.09000 BTS`
with `title "raw 9000 / 9"`; change `-0.4` → `-0.4%` (neg class); latest via
priceSig. Live mainnet 2026-10-07: all probed BTS order-book pairs report
`base_volume "0"` with live prices (e.g. BTS/USD latest `65.78…`) — order-book
flow is dormant, pools carry the volume. The landing reports this honestly
("Top 0 of 20 probed" + `market_net.empty`), consistent with `#/market/BTC_BTS`
showing the same zeros from the same `get_ticker` source. A slice rendering a
raw integer anywhere is not done — none found (amounts only via `humanVol`).

## States / offline / i18n / responsive

- Cold-load race (Task-6 gate fix, `market-net-ui.js:646-681`): the route used
  to check `Chain.status()` once and strand the offline panel after connect
  (headless proof pre-fix: `st:"open"`, 0 tables, no band). Now it subscribes
  `Store "connection"` and re-renders once on the first `open` while current
  (hash-guarded, self-unsubscribing) plus one `Offline.ensure()` handshake —
  the `pool-ui.js` `autoRetry` / `asset-feed-ui.js` `cold` precedent, minimal.
  Retry button + Settings link remain for manual path.
- Offline → cached note + Retry + Settings (`market_net.offline`); unknown
  asset → `common.unknown_asset` + honest empty (never blank).
- Strings `market_net.*` (20 keys) via `I18n.t` verbatim defaults, all 12
  dicts key-complete; symbols/ids/URLs never translated. Canvas has aria-label
  twin; table doubles as screen-reader twin; 44px touch floor via `touchable`.
- 360px: filters stack, table scrolls region-style; 1440px: band full width;
  ref-ui default theme verified headless (trio + 4K stay tester-gated).

## Desk physics-only upgrade (Task 5 — visuals byte-identical)

`pool-graph.js` preset-driven live loop ONLY (calm = shipped settle-once via
`relax()`; lively = same relax math per-frame, temp/cool/sleep + 180-frame cap;
presets read from `PoolNetUI._physForTest` with built-in calm-equivalent
fallback); one deliberate seam (`drawGraph opts._pos` — new lively loop only,
all pre-existing vectors green = default path unchanged); Physics switch
(shared `poolNetPhys` key, default calm/off) added ONLY in each map pane header
(`market-desk-fill.js`, `pool-detail-view.js` — helpers duplicated per
doctrine, no new shared abstraction). Full note in the Task-5 report;
one-line delta also appended to `docs/parity/slice-12-pools.md` (this file's
sister note owns the pool desk).

## Carried minors ledger (recorded, NOT re-fixed)

- Task 1: `readCache` keeps shape-valid ids; staleness is dropped by
  `reconcileCache` (live-minus-seeds rewrite), never by `read` — by design,
  vector-pinned. `globals.d.ts` note resolved: Task 3 added
  `declare var MarketNet/MarketNetUI` (`globals.d.ts:74-75`).
- Task 2: `resolveNav` passthrough; `paintGraph`'s headless `_wire` passes a
  stateless state (no `navOpts`) so it always resolves pool-default — intended
  (test path only; production band goes through `mount`).
- Task 5: lively 3-node demo runs the full 180-frame cap (sleep gate never
  trips on tiny graphs — same pause-rule semantics as the band; bounded,
  terminating); desk switch helpers duplicated per doctrine (no abstraction).

## Manual test (headless; human browser pass stays the gate)

Server: `python3 -m http.server 7334 --directory vanilla`.

- `#/markets` @1440 (`/tmp/mk-markets-1440b.png`): search row (Asset 1=BTS),
  "Top 0 of 20 probed — by 24h volume." + "No markets found for this filter."
  (honest zero-volume chain state, see above), Market network band mounted
  (`515 pools · 176 assets`, canvas painting, COLLAPSE). Post-fix cold load
  auto-recovers (pre-fix it stranded offline).
- `#/markets` @390 (`/tmp/mk-markets-390.png`): filters stack, hash seeds
  `?a=BTS`, no overflow from this page's content.
- `#/market/BTS_USD` @1440 (`/tmp/mk-desk-1440.png`): desk loads, hash holds.
  `#/market/BTC_BTS`: `BTC / BTS` header + 24h Vol line (same ticker source).
- `#/pools/1.19.1` @1440 (`/tmp/mk-pool-desk-1440.png`): pool desk + map load
  (Task-5 physics switch present, visuals unchanged).
- Console errors on all four: exactly one `404` — the pre-existing footer
  version-check (`app.js:759` GitHub compare API), proven identical on `#/pools`
  (not from this workstream). Zero app errors.

## Tester pass (queued)

BTS default → table/scope note → row opens `#/market/…` desk; Asset-2
narrows to pair (both orientations); band edge → market desk, node → asset;
Clear flow; collapse-reload persistence; theme trio; 390px touch; `?a=/?b=`
Back-restore.

## Gate evidence (Task 6 run, 2026-10-07, post-fix worktree)

- `python3 tooling/check_rot.py` → PASSED (dependency-free, static-servable).
- `bash tooling/check_types.sh` → PASS (checkJs, zero emit).
- `python3 tooling/check_i18n.py` → OK: 12 dicts key-complete (3757 keys),
  allowlists exact, stubs honest, 4971 `t()` call sites drift-free.
- `node tooling/market-net-test.js` → 29 passed, 0 failed.
- `node tooling/market-net-ui-test.js` → 23 passed, 0 failed.
- `node tooling/pool-net-ui-test.js` → 49 passed, 0 failed (no regression).
- `node tooling/pool-net-test.js` → 39 passed, 0 failed (no regression).
- `node tooling/pool-graph-test.js` → 123 pass, 0 fail (no regression).
- Headless serve `python3 -m http.server` → `index.html`,
  `js/views/market-net-ui.js` 200; `shot.mjs` ×4 → app `consoleErrors: []`
  (only the pre-existing footer-API 404 above).

Anti-rot (§4.5): (a) yes — static + `Chain`/`Market`/`Asset`/`PoolNetUI`
reuse, platform APIs only, ES refused; (b) nothing new depended on (no new
script tags beyond the 2 for these modules, no imports); (c) smallest
deletable: sparklines (table + band stand). `check_rot.py` PASS.
