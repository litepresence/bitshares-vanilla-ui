# Phase 7 design — most impactful wallet/explorer features via history_api + unused database API

Status: DESIGN (no code). Ground truth: `tooling/history-capabilities-2026-10-02.json`
(sweep 9/9 nodes, 2026-10-02) + sparse-checkout signatures
(`database_api.hpp`, `api.hpp`) + vanilla usage grep (2026-10-02, exact call-strings,
`vendor/` excluded). Philosophy (from phase-06): provide everything available,
disclose limits honestly, fail gracefully with a Settings path. No ES in this
phase — everything here is chain-native WS.

## Baseline facts (locked, do not re-litigate in implementation)

- WS `history_api` resolves on ALL 9 probed nodes (`historyApiId` 2 everywhere,
  `hasHistory: true`). Live-verified ok: `get_account_history`,
  `get_relative_account_history`, `get_account_history_operations`,
  `get_fill_order_history`, `get_market_history`, `get_market_history_buckets`.
- WS gaps verified ABSENT everywhere (both api ids): `get_asset_holders`,
  `get_asset_holders_count` (`-32601 Method not found`). `get_trade_history` is a
  **database**-api method (`database_api.hpp:662`) — the sweep calls it `ok` on the
  database api id on all 9 nodes (it only 404s on the history api id). Not a gap.
- Bucket sets differ per node and callers must read `get_market_history_buckets`
  at runtime, never hardcode: 5 nodes end at weekly `604800`
  (`api.bitshares.dev`, `dex.iobanker.com`, `public.xbts.io`, `cloud.xbts.io`,
  `api.bts.mobi`); 4 nodes offer `1800` instead of `604800` (`node.xbts.io`,
  `api.dex.trading`, both testnets). Common set everywhere:
  `60/300/900/3600/14400/86400`.
- Testnet `BTS` is NOT `1.3.0` (sweep resolved `1.3.1420/1.3.15`); never hardcode asset ids.
- Current vanilla history usage (exact-string grep): `account.js` `history()`
  (`:129-144`, `get_account_history` newest-first) + `_historyPage` (`:181-195`,
  same method, varying `start`) + `historyPaged` (`:206+`, <=5 pages x 100, id-walk
  with duplicate-tail drop); `market.js` fills (`:283-299`,
  `get_fill_order_history(a, b, limit)`); `market-candles.js` buckets (`:100-133`,
  runtime read + cache) + paged candles (`:151-212`, nodes cap `get_market_history`
  at 200 buckets/call, oldest-first); `market-fills-history.js` `chainFills`
  (`:226-229`); `pool.js` `history()` (`:178-189`, history api first, `_dbCall`
  `get_liquidity_pool_history` fallback); `tx-send.js` `pollHistoryForTransfer`
  (`:316-321`, `get_account_history` content-match proof).
- Signature map (all in-checkout, `#4` wins): history signatures live in
  `api.hpp:89-300` (NOT `database_api.hpp`); everything in Part B lives in
  `database_api.hpp` with line numbers cited per item. Anything the sweep did not
  probe is flagged NEEDS-PROBE (signature known, live behavior unverified) — see §4.

## Part A — ranked history_api features (all methods sweep-verified)

### A1. Op-type-filtered account streams (account view) — HIGHEST impact/cost
User value: "transfers only" / "my trades" / audit views for any account without
walking 500 rows of id-walk history and without ES. Powers tax-record exports,
per-account fill tapes (op 4), vesting-claim proofs (op 33), proposal audit —
the single most-requested history shape in both references.
Method: `get_account_history_operations(account, operation_type, start, stop, limit)`
(`api.hpp:146-152`; NOTE param order: `start` before `stop`, unlike
`get_account_history`'s stop-first order — copy the order, not the habit).
`operation_type` is the numeric op id (0 = transfer, 1/2 = orders, 4 = fill, …).
Surface: op-type selector on `#/account/:name` history (All + Transfer + Orders +
Fills + …), reusing the existing history table render; per-account "trade tape"
uses type 4. Fallback: history-absent notice variant (Settings → history node)
when `Chain.history()` rejects; per-type empty is VALID (says "no transfers on
chain", never an error). Effort: small (one new `Account.historyByOp` wrapper +
filter UI; `historyPaged` stays the All-types path).

### A2. Relative-history deep paging (account view, whale/old accounts)
User value: accounts older than the 500-row id-walk cap (`historyPaged` 5x100)
currently hit an honest truncation wall. Sequence-number addressing jumps
directly to any depth and walks forward from the oldest op — deep archives for
exchanges, faucet accounts, and veterans.
Method: `get_relative_account_history(account, stop=0, limit, start=0)`
(`api.hpp:167-171`; stop SECOND, start LAST, both default 0 = newest; current
sequence count readable from account statistics). Walk: `start=0` for newest page,
then `start=oldest_seq-1` backward; `stop=N, start=0` fast-forwards from genesis.
Surface: "Load older" continuation past the `historyPaged` truncation point on
`#/account/:name` (keeps the existing truncated-says-so label, then extends it);
"jump to oldest" link for audit. Fallback: same history notice; sequence gaps
render as gaps, never interpolated. Effort: medium (sequence cursor math + merge
with id-walk rows, de-dupe by `1.11.x` id — the `_histRowId` helper already exists
in `account.js:171-175`).

### A3. Live-bucket multi-timeframe candles (market desk honesty finish)
User value: slice-07 reads buckets at runtime (`market-candles.js:100-133`) and
pages 200/call (`:197-212`), but the timeframe picker can still offer a weekly
view on nodes that only serve `1800`. Per-node availability must drive the UI so
a timeframe is never selectable where the chain cannot serve it.
Method: `get_market_history_buckets()` (`api.hpp:239`) → timeframe list;
`get_market_history(a, b, bucket, start, end)` (`api.hpp:229-232`, oldest-first,
200/call cap) stitched for long windows. Bucket divergence from the sweep: weekly
`604800` on 5 nodes, `1800` (30m) on 4 — the picker shows exactly what the active
node returned, labeled ("30m · this node", "weekly unavailable on this node").
Surface: timeframe selector on `#/market/:id` + long-window chart stitching;
unavailable timeframes disabled with reason, not hidden. Fallback: fewer
timeframes + notice pointing at Settings (a fuller-history node), never ES.
Effort: small-medium (UI gating on the cached bucket list + existing pager).

### A4. Full-market fill archives with an honest cap (market desk tape)
User value: deeper "recent trades" tape per market. Constraint, stated plainly:
`get_fill_order_history(a, b, limit)` (`api.hpp:212-215`) takes NO cursor — each
call returns the latest N only, so "pagination" here means bounded refresh, not
arbitrary depth. Depth beyond N comes from B1 (`get_trade_history` time windows).
Method: `get_fill_order_history` polled at a bounded cadence + de-dupe by fill id;
archive depth labeled ("latest 100 fills served by this node"). Surface: trade-tape
"load more" that extends to the node cap then says so, with B1 time-windowing as
the deeper path when built. Fallback: history notice + Settings path. Effort:
small (reuse `chainFills` in `market-fills-history.js:226-229`).

### A5. Cross-market fill aggregation (portfolio trade tape)
User value: "my recent fills everywhere" for active traders — one tape across all
pairs the account touched, without visiting each market page.
Method: `get_top_markets(N)` (`database_api.hpp:646`, already used by
`explorer-tabs.js:332`) for the pair universe × `get_fill_order_history` per pair
(bounded fan-out, e.g. top-20 pairs) merged newest-first, OR per-account op-4
stream via A1 (cheaper when A1 exists — prefer A1, fall back to pair fan-out).
Surface: "All-markets fills" strip on dashboard/portfolio when unlocked; labeled
pair + human price via `format.js`. Fallback: per-market tapes (A4) + notice.
Effort: medium (bounded fan-out + merge + pair labels; de-dupe with A1 path).

## Part B — ranked unused database-API features (USED vs UNUSED per exact grep)

Method list extracted from `database_api.hpp` (citations below); each marked USED
or UNUSED by exact `"method"` grep over `vanilla/js` (vendor excluded) on 2026-10-02.

### B1. Time-windowed market trades via `get_trade_history` — HIGHEST impact
User value: the honest answer to A4's no-cursor limit — page fills by TIME, not
by latest-N. Short-window trade history with explicit `[stop, start]` UTC range
(`database_api.hpp:662-664`: `(base, quote, start, stop, limit)`, most-recent-first,
same-second overflow escalates to `by_sequence`). Sweep-verified `ok` on the
database api id on all 9 nodes. UNUSED today (zero exact hits).
Surface: market tape "previous day/week" paging on `#/market/:id`; fills render
through the existing `chainRow` path in `market-fills-history.js`. Fallback:
latest-N tape (A4) + notice; empty window is VALID. Effort: small-medium (time
arithmetic + window walker; UTC-only per contract, no timezone math).

### B2. Borrower-side credit deals (`get_credit_deals_by_borrower` + `by_offer_owner`)
User value: slice-13 built offers (`list_credit_offers`, `credit.js:193`) and
deals-by-offer (`get_credit_deals_by_offer_id`, `credit.js:213`) — but a borrower
cannot see "my open borrowings". Lenders cannot list deals on their offers except
per-offer. These two calls close the loop.
Methods: `get_credit_deals_by_borrower(borrower, limit?, start?)`
(`database_api.hpp:1069-1072`); `get_credit_deals_by_offer_owner(owner, …)`
(`:1048-1051`). `list_credit_deals` + `by_debt_asset`/`by_collateral_asset`
(`:1007`, `:1090`, `:1111`) stay parked (global scans, low wallet value). All UNUSED.
Surface: "My borrowings" on `#/credit` (borrower key) + per-offer deal list on
offer detail; amounts via `format.js`. Fallback: offer-side view + notice.
Effort: small (same `_deals` helper shape as `credit.js:213`).

### B3. Claimable-now vesting amounts via `get_vested_balances`
User value: the vesting UI lists objects (`get_vesting_balances` — USED in
`proposal-misc.js:91`, `account-ui.js:326`, `vesting-ui.js:344`) but cannot answer
"how much can I claim RIGHT NOW". `get_vested_balances(balance_ids[])`
(`database_api.hpp:390`) computes exactly that at head-block time. UNUSED today.
Surface: "claimable" column on vesting panels + claim-form prefill; raw→human via
`format.js` with a recorded vector. Fallback: object list without claimable +
notice (chain decides at broadcast anyway). Effort: small (id-collect + one call).

### B4. My settlement requests via `get_settle_orders_by_account`
User value: R1e built the market-wide settlement tab (`get_settle_orders`,
`market.js:398-410`, `market-orders.js:322`) — an MPA holder still cannot see
"MY open settlement requests" on the borrow view. `get_settle_orders_by_account
(account, start_1.4.x, limit)` (`database_api.hpp:569-571`) is that tab. UNUSED.
Surface: "My settlements" tab on borrow/asset view with price/amount/date table
(same columns as the R1e tab). Fallback: market-wide tab + notice. Effort: small.

### B5. My orders in THIS market via `get_account_limit_orders`
User value: the desk shows the full book (`get_order_book`, `market.js:206-211`)
and the account page shows all-markets orders (`get_limit_orders_by_account`,
`market.js:381-392`) — but the desk lacks "my open orders in this pair".
`get_account_limit_orders(account, base, quote, limit, ostart_id?, ostart_price?)`
(`database_api.hpp:524-529`) scopes exactly that, price-sorted. UNUSED.
Surface: "My orders (this market)" tab on `#/market/:id` with per-row cancel
(existing cancel path). Fallback: account-page orders + notice. Effort:
small-medium (price-cursor paging only if the list exceeds one page; usually one call).

### B6. One-call vote-slate resolution via `lookup_vote_ids`
User value: opening an account/voting page fans out to N `get_objects` batches
today; `lookup_vote_ids(vote_ids[])` (`database_api.hpp:1233`) resolves a whole
slate (witness/committee/worker mix, same order, nulls for unknowns) in one call.
UNUSED — `vote.js:20-23` explicitly notes it is not wrapped. Complements (never
replaces) the existing `get_witnesses`/`get_committee_members`/`get_all_workers`
batch reads.
Surface: no new UI — faster account + voting loads (fewer round trips on slow
nodes). Fallback: existing batch path (keep it; use lookup as fast path with
batch fallback per id). Effort: small (wrapper + call-site swap with fallback).

### B7. Dedicated 24h volume via `get_24_volume`
User value: 24h volume currently arrives piggybacked on `get_ticker`
(`market.js:330-336`, `database_api.hpp:618`). `get_24_volume(base, quote)`
(`database_api.hpp:626`) fetches volume alone — cheaper header/picker refreshes
and an honest "volume" field where the full ticker is stale or unwanted. UNUSED.
Surface: market-picker volume column + desk header refresh path. Fallback: ticker
volume (existing). Effort: trivial (one wrapper; reuse `market_volume` render).

## Considered and parked (checked, not ranked — with reason)

- Witness/committee pagination "beyond votes UI": COVERED. Batch reads
  (`get_witnesses`, `get_committee_members`, `vote.js:84-108`), name lookups
  (`lookup_witness_accounts`, `lookup_committee_member_accounts`), and counts
  (`get_witness_count`, `get_committee_count`) are all USED. No new surface.
- `get_required_fees` extensions (fee-asset choice): method USED (13 call sites);
  non-BTS fee assets DEFERRED per owner ruling R1e (fee asset stays `1.3.0`).
  Queued behind owner order, not designed here.
- `get_balance_objects` (unclaimed genesis/bonus balances, `:382`): UNUSED but
  balance-claim paths DEFERRED per R1b. Not designed here.
- `get_blinded_balances` (`proposal.js:159`): USED for read-only blind lookup;
  blind-transfer BUILD stays downscoped per slice-14. Scope note only.
- `get_full_accounts` (`:309`): UNUSED — considered-REJECTED for v1: one heavy
  call with subscribe semantics contradicts the granular-read doctrine; current
  per-object reads stay.
- `get_named_account_balances` (`:375`): UNUSED — semantically equivalent to
  `get_account_balances` (`account.js:76`); no value, skip.
- Market-wide `get_limit_orders` (`:475`) / `get_call_orders` (`:538`): UNUSED —
  parked; `get_order_book` + account-scoped variants cover the wallet's needs and
  a raw ladder is low value.
- `get_limit_orders_by_account` pagination (`start_id`, `:495-498`): USED
  (`market.js:392`, first page); deeper pages only on demand — no new surface
  until an account exceeds 100 open orders.
- `verify_authority` / `verify_account_authority` / `validate_transaction`
  (`:1288-1305`): UNUSED — parked; pre-broadcast dry-run looks valuable but is
  racy against head state, and broadcast proof (already built) is truth. Revisit
  only with a concrete failed-broadcast UX case. (`get_potential_signatures` IS
  used, `txbuilder.js:360`.)
- `get_transaction_hex` / `get_transaction_hex_without_sig`: UNUSED — no v1
  surface (debug aid only).
- Key/account helpers `is_public_key_registered` (`:263`),
  `get_account_id_from_string` (`:275`), `lookup_account_names` (`:342`),
  `get_account_references` (`:333`), `get_next_object_id` (`:240`): UNUSED —
  parked; vanilla resolves via `get_account_by_name` + `get_key_references`
  (both USED) with no gap to fill.
- `get_chain_properties` (`:209`) + `get_config` (`:219`): UNUSED — "chain
  parameters" explorer tab is real display-honesty value (committee-controlled
  values, fee schedule visibility) but ranks below B1–B7; first candidate for
  the next design round. (`get_global_properties` USED in `asset.js:228`;
  `get_chain_id` / `get_dynamic_global_properties` USED throughout.)
- `get_samet_funds_by_asset` (`:922`): UNUSED — parked; owner-side + list views
  (`list_samet_funds`, `by_owner`) cover the wallet.
- `list_htlcs` (`htlc.js:21` notes unused): parked; from/to queries
  (`htlc.js:165`) cover account views and global HTLC scans are explorer-ES
  territory (phase-06).
- `get_trade_history_by_sequence` (`:677`), `get_account_history_by_time`
  (`api.hpp:112`), `get_account_history_by_operations` plural (`api.hpp:128`),
  `get_block_operation_history` (`api.hpp:186`), `get_block_operations_by_time`
  (`api.hpp:202`), `get_liquidity_pool_history_by_sequence` (`api.hpp:295`):
  signatures in-checkout but NOT sweep-probed → NEEDS-PROBE (§4), not designed here.

## NEEDS-VERIFY items

NONE. Every method cited in Parts A/B was verified in the sparse checkout with
an exact `file:line` above — no single-path fetch was needed and none was made.
Adjacent runtime risk (not a doc blocker): the six NEEDS-PROBE methods listed at
the end of the parked section have known signatures but were outside the
2026-10-02 sweep; any future design using them must live-probe first (same
`history-probe.mjs` shape) and never assume node support.

## Cross-cutting requirements (every feature above — pointer, per phase-06)

Same rules as `phase-06-es-design.md` §"Cross-cutting requirements", WS variant:

- Capability gates: `historyHere()` (WS `history` id resolves on the active node)
  from the planned `api/history-cap.js`; every new surface gates on it — no raw
  `Chain.history()` outside capability-checked wrappers; bounded limits everywhere
  (`get_account_history*` <= 100/call, `historyPaged` 5-page cap kept, fill fan-out
  capped at top-20 pairs, `get_trade_history` windows bounded to day/week steps).
- Notices: shared `historyNotice(kind)` — history variant links `#/settings`
  (switch to a history node); per-timeframe variant names the bucket gap
  ("weekly unavailable on this node") with the Settings path. Never an empty
  table where a notice belongs.
- Settings: History pill per node row (from the sweep's `hasHistory`) + ES switch
  already specified in phase-06; this phase adds per-node bucket labels where the
  picker needs them (no new pref).
- Money/i18n/a11y: ALL amounts through `format.js` with raw→human vectors in the
  parity note (incl. a non-BTS precision + a percent field where touched); ALL
  copy as future-`t()` keys across the 10 dicts (en-first, stubs elsewhere per
  slice-17); 44px targets, no hover-only UI, `aria-live` result regions.
- Gates: `check_rot.py` (no new deps — WS only, nothing to except),
  `check_types.sh`, unit vectors per new wrapper (cursor math, window stitching,
  empty-is-valid cases), theme trio + 390px/1440px shots per surface, parity-note
  deltas against the §6 route table.

## Rollout order

A1 → B1 (together these make history genuinely browsable: filter by TYPE, page
by TIME; each independently shippable, A1 first as the smaller proof) → A2 →
B3 → B4 → B5 (account/money honesty cluster, any order) → B2 → B6 → B7
(credit/voting/market polish) → A3 → A4 → A5 (desk tape depth + aggregation,
after the primitives they compose are proven). Steps A1–A2 carry the WS-only
fallback from day one; nothing in this phase may depend on ES or on NEEDS-PROBE
methods.
