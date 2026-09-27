# Slice 09 (Explorer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only chain explorer parity with the old UI at `#/explorer` (+ tabs), `#/block/:height`, `#/block/:height/:txIndex`, and `#/asset/:symbol`: recent-blocks + block-detail + transaction-detail views, an asset list + asset-detail view, a feeds table for smartcoins, a global search box (object id `1.x.y` / account name / asset symbol), and object/operation deep links (`1.7.x` limit orders, `1.8.x` call orders, `1.10.x` proposals, etc. resolve to human-readable rows). Existing `#/account/:name` (slice 3) is reused as the `1.2.x` deep-link target, not rebuilt.

**Architecture:** `explorer.js` owns ALL explorer chain reads (head, block, tx, assets, feeds, object resolution). `explorer-ui.js` owns the views (`#/explorer` + tabs, `#/block/:height`, `#/block/:height/:txIndex`, `#/asset/:symbol`, search, deep-link dispatch). NO serializer change, NO signing, NO confirm dialog — this is a reads-only slice (stated explicitly; there is nothing to confirm). `router.js` swaps four stubs for renderers; `index.html` gains two `<script>` tags.

**Tech Stack:** Vanilla JS + `Chain.db` reads + existing `Account.resolve` + `Format` string math. Node 20 stdlib for checks. Python 3 for rot gate. No new files beyond `explorer.js` + `explorer-ui.js` (+ parity note); `index.html` + `router.js` are modified only.

## References (mapped first — evidence, not memory)

Method / op-field table. #4 wins conflicts; testnet confirms.

| # | Item | Value | Source file:line |
|---|---|---|---|
| 1 | `get_objects(ids, subscribe?)` — universal resolver; null variant per unknown id; `1.11.x`/`2.9.x` cannot subscribe | `database_api.hpp:87-93` | `bitshares-core/.../app/database_api.hpp:87-93` |
| 2 | `get_block_header(block_num, with_witness_signature?)` → header or null | `database_api.hpp:162-164` | `bitshares-core/.../app/database_api.hpp:155-164` |
| 3 | `get_block_header_batch(block_nums, …)` → map height→header-or-null (cheap list rows) | `database_api.hpp:173-175` | `bitshares-core/.../app/database_api.hpp:166-175` |
| 4 | `get_block(block_num)` → `optional<signed_block>`, null when unknown; returned object carries NO height (client attaches it) | `database_api.hpp:182`; #1 works around with `result.id = height` | `bitshares-core/.../app/database_api.hpp:177-182`; `bitshares-ui/app/actions/BlockchainActions.js:34-39` (`getLatest`), `:58-63` (`getBlock`) |
| 5 | `get_transaction(block_num, trx_in_block)` → `processed_transaction` (tx at 0-based index) | `database_api.hpp:190` | `bitshares-core/.../app/database_api.hpp:184-190` |
| 6 | `get_recent_transaction_by_id(txid)` → tx ONLY if not expired, else NULL ("not known ≠ not included") — hash lookup is best-effort by consensus design | `database_api.hpp:200` | `bitshares-core/.../app/database_api.hpp:192-200` |
| 7 | `get_dynamic_global_properties()` → head block number/time, `last_irreversible_block_num` (list anchor + irreversibility marker) | `database_api.hpp:229`; #1 reads `last_irreversible_block_num` off `2.1.0` | `bitshares-core/.../app/database_api.hpp:227-229`; `bitshares-ui/app/components/Blockchain/Operation.jsx:57-60` |
| 8 | Asset reads: `get_asset_id_from_string`, `get_assets(symbols_or_ids, subscribe?)` → `extended_asset_object`, `list_assets(lower, limit)`, `lookup_asset_symbols`, `get_asset_count`, `get_assets_by_issuer(issuer, start, limit)`; list cap `api_limit_get_assets = 101` | `database_api.hpp:413-461`; `application.hpp:57` | `bitshares-core/.../app/database_api.hpp:408-461`; `.../app/application.hpp:57` |
| 9 | `get_bitasset_data` lives in the WALLET api, NOT `database_api` (`wallet.hpp:280`) — vanilla never calls it; feed/bitasset joins go via `asset.bitasset_data_id` + `get_objects` (same pattern as #1's `dynamicIDS`/`bitAssetIDS` batches) | `wallet.hpp:280`; `AssetActions.js:574-580`, `:639` | `bitshares-core/.../wallet/wallet.hpp:280`; `bitshares-ui/app/actions/AssetActions.js:571-580` |
| 10 | Batch `get_blocks(from, to)` lives in `block_api` (`api.hpp:320`) — a SEPARATE api id from `database`; `Chain.js` exposes `db()/history()/net()` only, so vanilla uses per-height database `get_block` (+ header batch) and does NOT add a block-api accessor unless testnet proves a need (see ambiguity B) | `api.hpp:320` | `bitshares-core/.../app/api.hpp:310-320`; `vanilla/js/chain.js:103-119` |
| 11 | Op enum 0–77 with VIRTUAL markers (4, 42, 44, 46, 51, 53, 74 virtual) — the op-name table source | `operations.hpp:56-133` | `bitshares-core/.../protocol/operations.hpp:56-133` |
| 12 | Object-space table `1.x.y`: 1.2 account, 1.3 asset, 1.4 force_settlement, 1.5 committee_member, 1.6 witness, 1.7 limit_order, 1.8 call_order, 1.10 proposal, 1.11 operation_history, 1.12 withdraw_permission, 1.13 vesting_balance, 1.14 worker, 1.15 balance, 1.16 htlc, 1.17 custom_authority, 1.18 ticket, 1.19 liquidity_pool, 1.20 samet_fund, 1.21 credit_offer, 1.22 credit_deal (1.0/1.1 null/base, 1.9 custom unused) | `types.hpp:362-386` | `bitshares-core/.../protocol/types.hpp:361-386` |
| 13 | Price math (principle #6): `price.to_real() = base/quote` is RAW units (`asset.hpp:127`); display must apply BOTH precisions — #1's equivalent is `MarketClasses.toReal()` + `precisionsRatio` (`MarketClasses.js:275`, `:651`, feed `:724`); vanilla equivalent is `Format.formatPrice(baseRaw, basePrec, quoteRaw, quotePrec)` | `asset.hpp:91-127`; `MarketClasses.js:270-275`, `:651`, `:715-733` | `bitshares-core/.../protocol/asset.hpp:91-127`; `bitshares-ui/app/lib/common/MarketClasses.js:651`, `:724`; `vanilla/js/format.js:41-50` |
| 14 | Percent fields are hundredths: `GRAPHENE_100_PERCENT = 10000`, `GRAPHENE_1_PERCENT = 100` — stored `2000` means 20% (applies to market-fee percent, feed `maximum_short_squeeze_ratio`, issuer permissions) | `config.hpp:102-103` | `bitshares-core/.../protocol/config.hpp:102-103` |
| 15 | #1 explorer shape: 8 tabs (blocks / assets / pools / accounts / witnesses / committee_members / markets / fees) | `Explorer.jsx:18-67` | `bitshares-ui/app/components/Explorer/Explorer.jsx:18-67` |
| 16 | #1 routes: `/explorer/:tab`, `/explorer`, `/asset/:symbol`, `/block/:height`, `/block/:height/:txIndex` | `App.jsx:566-584` | `bitshares-ui/app/App.jsx:566-584` |
| 17 | #1 op rendering: `ops = Object.keys(operations)` + `opComponents(opType)` switch + per-op files in `operations/` (~60 files incl. `FillOrder`, `HtlcRedeemed` virtuals); label via `trxTypes[ops[type]]` | `Operation.jsx:19-40`; `operations/index.js:62+` | `bitshares-ui/app/components/Blockchain/Operation.jsx:19-40`; `.../Blockchain/operations/index.js:62-80` |
| 18 | #1 asset list: `list_assets` paging with cached `totalAssets` (3000 default on mainnet chain id `4018d784`, 50 elsewhere), 25 rows/page, market/prediction/other filters + search | `Assets.jsx:31-51` | `bitshares-ui/app/components/Explorer/Assets.jsx:23-51` |
| 19 | #1 fees tab groups fee_schedule by op id (`fee_grouping: general [0, 25, …]`) — DEFERRED to slice 10 (fee schedule is asset-ops territory; scope here is blocks/txs/assets/feeds) | `Fees.jsx:19+` | `bitshares-ui/app/components/Blockchain/Fees.jsx:19-30` |
| 20 | #1 asset detail joins ChainStore/Apis with `FeedPrice` from MarketClasses, issuer links, settle/price helpers (port the MATH via Format, not the components) | `Asset.jsx:1-20` | `bitshares-ui/app/components/Blockchain/Asset.jsx:1-20` |
| 21 | #2 explorer: `Explorer.jsx` (search across User/Coins/Hash/FileText/Box types), `LiveBlocks.jsx` (live list + `opTypes` table from `lib/opTypes.js`), pages `explorer.astro` / `blocks.astro` / `issued_assets.astro` / `publish_feed.astro` — behavior cross-check only, Beet signing ignored | As cited | `astro-ui/src/components/Explorer.jsx:1-30`; `astro-ui/src/components/LiveBlocks.jsx:1-25`; `astro-ui/src/pages/{explorer,blocks,issued_assets,publish_feed}.astro` |
| 22 | #3 chain client: `get_dynamic_global_properties` (`:351`), `get_assets` (`:496`), `lookup_asset_symbols` (`:498`), `get_objects` uncached batch (`:606`), asset display joins (`:978`, `:991`) — third data point for read patterns + failover | As cited | `wallet-extension/src/lib/bitshares-api.js:351`, `:496-498`, `:606`, `:978-991` |
| 23 | Vanilla conventions reused: `Chain.db()` + `Chain.call` resolve pattern (`account.js:28-37`); `get_assets`/`lookup_asset_symbols` join (`market.js:121-122`, `:154-155`); history api via `Chain.history()` (`market.js:267-273`); confirm-row pattern is transfer-ui precedent BUT this slice has no confirm (reads-only) | As cited | `vanilla/js/account.js:24-37`; `vanilla/js/market.js:121-122`, `:154-155`; `vanilla/js/transfer-ui.js:432-436` (pattern reference only) |
| 24 | Router stubs to replace: `/explorer`, `/explorer/:tab`, `/asset/:symbol`, `/block/:height`, `/block/:height/:txIndex` all `placeholder(...)` | `router.js:94-98` | `vanilla/js/router.js:94-98` (`/account/:name` at `:79` already live — deep-link target) |
| 25 | Script-tag slot: `vote.js` + `vote-ui.js` at `:47-48`, `router.js` at `:49` — new tags go between | `index.html:47-49` | `vanilla/index.html:47-49` |
| 26 | Retro reference captures: `explorer.png`, `explorer-blocks.png`, `explorer-assets.png`, `explorer-witnesses.png`, `block.png`, `block-tx.png`, `asset.png` — side-by-side layout source | `original-pages/` | `vanilla/notes/original-pages/{explorer,explorer-blocks,explorer-assets,block,block-tx,asset}.png` |
| 27 | Testnet fixtures: vote blocks **100916767** (vote `["1:0"]`) and **100916768** (unvote cleanup) from slice 8 — perfect read-back fixtures: assert the op-6 contents match what we wrote | `slice-08-voting.md:39-42` | `vanilla/notes/slice-08-voting.md:38-44` |

**Real vs dead/showcase triage (#1 `Blockchain/` + `Explorer/`, 78+13 files — what we port, what we don't):**
- PORT: `Explorer.jsx` tab shell (subset: blocks/assets/feeds — see scope decision below), `Blocks.jsx` live/recent list, `Block.jsx` + `BlockContainer.jsx` detail, `Transaction.jsx` detail, `Operation.jsx` + `operations/` per-op field renderers (as the field-coverage checklist for op rows), `Asset.jsx` detail, `Assets.jsx` list, `BlockTime.jsx` timestamp display.
- LINK-OUT (owned by other slices, explorer only deep-links): pools → slice 12, witnesses/committee → slice 8, markets → slice 5, accounts → slice 3, HTLC objects → slice 11, fees tab → slice 10.
- DO NOT PORT: `Showcases/`, `Console/`, `PredictionMarkets/` demos, `json-inspector` raw dumps (we render named human rows, never raw JSON), `perfect-scrollbar` / `react-scroll` machinery.

**Scope decision (recorded):** `#/explorer` ships THREE tabs — Blocks, Assets, Feeds. The other five #1 tabs are covered: Accounts (slice 3 `#/account/:name` already live — search links out), Witnesses/Committee (slice 8 `#/voting`), Markets (slice 5 `#/market/:id`), Pools (slice 12), Fees (slice 10 with asset ops). No separate `#/explorer/:tab` registrations beyond `blocks|assets|feeds` (unknown tab → Blocks with a note, never blank).

**Recorded ambiguities (NOT guessed — testnet decides, Task 3):**
- (A) Feed field shape: which price object to display (`settlement_price` vs `current_feed.settlement_price` vs CER) and exact field names on the live `bitasset_data` object are read off the testnet object at runtime (Reference #9 path), not asserted here. Both-precisions math per Reference #13 regardless of which field wins.
- (B) `block_api` vs `database` for recent-block lists: default is per-height database `get_block` + `get_block_header_batch` (Reference #10); if a testnet node lacks either, fall back to the other and record which served.
- (C) Testnet MPA availability: if no smartcoin with live feeds exists on testnet, the Feeds tab ships with its empty state VERIFIED (not faked) + vectors computed from a pinned mainnet-shape fixture clearly labeled as such; asset/blocks/tx verification still goes through on testnet blocks 100916767/100916768.
- (D) `get_recent_transaction_by_id` expiry horizon is node-configured (Reference #6) — hash search documents "recent only" in the UI; no retry logic is built around it.

**Percent-math note (principle #6):** amounts via `Format.formatAmount(raw, precision)`; feed/settlement prices via `Format.formatPrice` with BOTH precisions (Reference #13); percents (market fee, MSSR, fee-split) from hundredths ints (`2000` → `20%`) with string/int math — never float. Fee-schedule display belongs to slice 10 and is out of scope here.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable. No crypto, no signing, no serializer — reads only, so `tx.js`/`crypto.js` are untouched.
- All displayed numbers through `Format` — never inline `/ Math.pow(10, precision)` (audit greps). Raw ints stay STRINGs until render.
- One new file pair only: `explorer.js` (reads) + `explorer-ui.js` (view). `index.html` gains two `<script>` tags (order: `explorer.js` then `explorer-ui.js`, both before `router.js`); `router.js` swaps FIVE stub lines for renderers. Nothing else touched.
- Test keys: none needed — no signing in this slice. Public testnet reads only.
- Viewports 360px→1440px minimum (2560px where dense tables allow); tables stack to cards / scrollable regions with sticky first column on phone; touch targets ≥44px in ≥1 dimension; no hover-only UI. Three themes via existing tokens (no new palette values).
- Search: single box accepting `1.x.y` ids, account names, asset symbols; typo tolerance where cheap (case-insensitive, prefix match within fetched asset page, `Account.resolve` fallback) — no fuzzy library, no index build.
- Empty states everywhere: unknown block/tx/asset/object, pre-head height, expired-tx hash, node down (offline panel + Retry per slice-1 pattern), empty feeds.
- One global per file + `module.exports` guard (existing convention). Module headers + function descriptions per §3.7; no dead text, no TODOs.

---

## File Structure

```
vanilla/
├── index.html            ← Task 2 (TWO script tags: explorer.js BEFORE explorer-ui.js, both BEFORE router.js)
├── js/
│   ├── explorer.js       ← Task 1 (CREATE: chain reads)
│   ├── explorer-ui.js    ← Task 2 (CREATE: views + search + deep links)
│   └── router.js         ← Task 2 (MODIFY: 5 stubs → ExplorerUI renderers, :94-98)
└── notes/
    └── slice-09-explorer.md ← Task 3: parity note
```

**Task ordering:** Task 1 (reads) → Task 2 (view) → Task 3 (verify + parity + audit). Task 1 is independently checkable with `node --check` + read-only testnet probes; Task 2 needs 1; Task 3 needs all.

---

### Task 1: `explorer.js` — explorer chain reads (one purpose: reads)

**Files:**
- Create: `vanilla/js/explorer.js` (global `Explorer`, `module.exports` guard, §3.7 header).

**Interface (all return plain JSON, throw named errors `not-connected` / `unknown-block` / `unknown-tx` / `unknown-asset` / `unknown-object` / `tx-expired-or-unknown`):**
- `Explorer.head()` → `{head_block_number, head_block_time, last_irreversible_block_num}` via `get_dynamic_global_properties` (Reference #7). Single call; callers derive "N blocks behind" display-side.
- `Explorer.recentBlocks(count)` → `get_block_header_batch` over `[head-count+1 … head]` (Reference #3), newest-first, each `{height, timestamp, witness}`; on batch-method absence fall back to per-height `get_block_header` (ambiguity B — record which served). Cap `count ≤ 50`.
- `Explorer.block(height)` → `get_block(height)` (Reference #4); throw `unknown-block` on null; attach `height` client-side (#1 `:39` pattern); normalize to `{height, timestamp, witness_account_id, tx_count, transactions: [{index, op_count, ops: [{type_idx, type_name}]}]}` with `type_name` from the op table (Reference #11, VIRTUAL-marked entries labeled `virtual`).
- `Explorer.tx(height, index)` → `get_transaction(height, index)` (Reference #5) → `{block: height, index, ops: [{type_idx, type_name, fields}], signatures}` where `fields` is the RAW op JSON with asset-amount leaves preserved as raw strings (humanization is the view's job via Format).
- `Explorer.recentTxById(txid)` → `get_recent_transaction_by_id` best-effort (Reference #6); null → throw `tx-expired-or-unknown` (UI says "recent only", per ambiguity D).
- `Explorer.assetsPage(lower, limit)` → `list_assets(lower, min(limit,25))` (Reference #8, #1 `:25/page` pattern); `Explorer.assetCount()` → `get_asset_count`; `Explorer.asset(symbolOrId)` → `lookup_asset_symbols([[s]])` then `get_objects([[bitasset_data_id, dynamic_asset_data_id]])` join when present (Reference #9); absent `bitasset_data_id` → `{is_smartcoin: false}` (NOT an error). Amount leaves (`current_supply`, `max_supply`, `accumulated_fees`, `fee_pool`) stay raw strings.
- `Explorer.feeds(symbols)` → for each MPA symbol: `asset()` join → `{symbol, settlement_raw:{base,quote}, feed_raw:{base,quote} or null, mssr_hundredths, mcr, feed_lifetime_sec, min_feeds}` with precisions of both sides attached (`{base_precision, quote_precision}`) so the view can call `Format.formatPrice` (Reference #13). Feed FIELD selection follows ambiguity A (record what testnet returned).
- `Explorer.resolveObject(id)` → validates `/^1\.\d+\.\d+$/` → `get_objects([[id]])` (Reference #1) → `{id, space, type, typeName}` from the space table (Reference #12) + raw object; null → `unknown-object`. Op-history `1.11.x` resolves the embedded op for deep-link display.
- `Explorer.search(q)` → dispatch: `1.x.y` → `resolveObject`; else `Account.resolve(q)` try → `{kind:"account"}`; else `lookup_asset_symbols` try → `{kind:"asset"}`; else throw `unknown-object`. No index, no fuzzy lib (cheap tolerance: caller lowercases/uppercases symbol variants before giving up).

- [ ] **Step 1: Implement** (~220 lines max; op table + space table are data arrays, not logic).
- [ ] **Step 2: Syntax + read-only probe** — `node --check js/explorer.js`, exit 0; against testnet (no signing, no keys): `head()` returns sane head; `block(100916767)` tx list contains an op-6 row and `block(100916768)` likewise (fixtures, Reference #27); `asset("TEST")` (or testnet core symbol) resolves with precision; `resolveObject("1.3.0")` → `{typeName:"asset"}`; `resolveObject("1.2.5")` → `{typeName:"account"}`; unknown height (`999999999`) throws `unknown-block`. Record counts + one sample row per call.

**Acceptance:** read-only probe green on testnet; all amount/price/percent leaves are raw strings (no float, no pre-formatting); fixture blocks resolve with op-6 rows; unknown inputs throw named errors, never crash.

---

### Task 2: `explorer-ui.js` — views + search + deep links (one purpose: the explorer screens)

**Files:**
- Create: `vanilla/js/explorer-ui.js` (global `ExplorerUI`, `module.exports` guard, §3.7 header).
- Modify: `vanilla/index.html` (TWO script tags, order: `explorer.js` then `explorer-ui.js`, both before `router.js` at `:49`); `vanilla/js/router.js` (FIVE stubs at `:94-98` → `ExplorerUI.renderExplorer` / `renderBlock` / `renderTx` / `renderAsset`; `/explorer/:tab` accepts `blocks|assets|feeds` only).

**Layout (retro parity with `original-pages/` captures, modern glow per principle #4):**
- `#/explorer` shell: search box (kinds: `1.x.y` / account / symbol; ≥44px, keyboard-submit, inline `unknown-object` message) + three tabs (Blocks / Assets / Feeds, #1 `Explorer.jsx:18-67` subset per scope decision) + head strip (head block #, time, irreversible marker — human times, raw heights as plain ints, never formatted as money).
- Blocks tab: recent-blocks table (height link → `#/block/:height`, time, witness link → `#/account/:name` via slice-3 route, tx count); phone: cards; desktop: full columns; "older" paging by height decrement (no infinite scroll lib).
- `#/block/:height`: header (height, time, witness, irreversible badge) + tx list (each → `#/block/:height/:txIndex`, op-count + first-op name chips). `#/block/:height/:txIndex`: op rows with NAMED fields (op-name header per Reference #11/17 checklist; amounts via `formatAmount`, prices via `formatPrice`, percents via hundredths math, account/asset ids as deep links) — never raw JSON dumps (beats #1's `json-inspector`).
- Assets tab: 25/page table (symbol link → `#/asset/:symbol`, issuer, precision, supply human) with lower-bound paging (Reference #18); `#/asset/:symbol`: header + supply/max/fees human rows + permissions flags + feed section when `is_smartcoin` (settlement + feed prices via both-precisions math, MSSR/MCR hundredths, lifetime, min-feeds) else "not a smartcoin" empty state.
- Feeds tab: MPA rows (symbol, settlement price, feed price, MSSR%) from `Explorer.feeds` over a curated testnet-MPA list (record the list; ambiguity C if empty).
- Deep links: `1.2.x` → `#/account/:name` (resolve id→name first); `1.3.x` → `#/asset/:symbol`; `1.7.x/1.8.x/1.10.x/1.12.x–1.22.x` → inline human rows (key fields: order amounts/prices, proposal ops summary, HTLC amount/expiry, ticket type, pool assets, credit terms — each via Format, full-field coverage deferred to owning slices with a "full view in slice N" note); `1.11.x` → owning block/tx link when determinable, else op row.
- Empty states everywhere (unknown block/tx/asset/object, pre-head height, expired hash, node down + Retry, empty feeds). Wait-for-connection pattern for deep links (slice-5 race repair precedent).

- [ ] **Step 1: Implement** (~380 lines max; past ~400 split is a Task-2 failure — keep op-field rendering tabular/generic, not per-op components like #1's 60-file `operations/`).
- [ ] **Step 2: Syntax checks** — `node --check` all touched JS, exit 0; `router.match("/explorer")`, `"/block/100916767"`, `"/block/100916767/0"`, `"/asset/TEST"` resolve to the new renderers (headless `node` smoke like slice-04).

**Acceptance:** all five routes render with no console errors on a connected testnet node AND show the offline panel when disconnected; every amount/price/percent on screen is human (spot-check: a raw `current_supply` never appears verbatim); phone-390 stacks, desktop-1440 tables; no `JSON.stringify` of chain objects in user-visible output.

---

### Task 3: Verify, parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-09-explorer.md` (seven-field parity contract + §3.7 + §4.5(a–c)).

- [ ] **Step 1: Testnet read-back (no signing, no keys)** — (a) `head()` + `recentBlocks(10)` sane vs node; (b) read fixture blocks **100916767** and **100916768**: assert each contains the op-6 `account_update` with the exact vote contents slice 8 wrote (`["1:0"]` vote / full-restore unvote — Reference #27), i.e. explorer output matches our own written history; (c) `tx(100916767, <vote-tx-index>)` op fields match; (d) asset read (core symbol + one non-core precision if present); (e) `resolveObject` spot checks `1.2.5`/`1.3.0`/`1.6.x`/`1.10.x` (one each, testnet-real ids); (f) feeds per ambiguity C. Record block heights, tx indexes, and op contents observed.
- [ ] **Step 2: Raw→human vectors** — in the parity note: asset supply/max/fees (incl. a non-BTS precision), one feed/settlement price with BOTH precisions shown (`baseRaw/basePrec/quoteRaw/quotePrec` → expected string), one hundredths-percent (`2000` → `20%`); block heights/timestamps explicitly NOT money (state that).
- [ ] **Step 3: Rot gate** — `python3 tooling/check_rot.py` exit 0; float-money grep CLEAN (any `Math.*` hit listed as pixels/none with file:line or removed); new files have headers + function descriptions; no TODO/FIXME; `tx.js`/`crypto.js` untouched (prove reads-only: `git status --short` shows only the 4 paths).
- [ ] **Step 4: Headless shots (dev server + shot.mjs, READ them)** — `#/explorer`, `#/block/100916767`, `#/asset/<core>` @1440 + @390, original-blue + dark (+ light if cheap), search + one deep-link visible; side-by-side against `original-pages/` captures (`explorer.png`, `block.png`, `asset.png`…); fix NOTHING in code (report findings); record.
- [ ] **Step 5: Parity note** — seven fields: reference file:lines (table above), vanilla file:lines, manual test steps + observed result (heights, tx indexes, op-6 match proof, ambiguity A–D outcomes), vectors, theme trio + both viewports (browser-dependent honestly PENDING-BROWSER with tester steps), §3.7 checklist, §4.5(a–c).
- [ ] **Step 6: Audit** — all eight checks (browser-dependent honestly PENDING-BROWSER, queued in the note). No slice 10 until green-minus-browser.

**Acceptance:** fixture read-back matches slice-8 written contents on-chain; parity note complete incl. ambiguity outcomes; rot gate green; tester browser pass queued.

---

## Anti-rot gate (AGENTS.md §4.5 — answers required in the parity note)

- **(a) 2036 test:** `explorer.js`/`explorer-ui.js` are plain scripts with no imports, no build, no framework; the op-name + object-space tables are pinned DATA copied from consensus-frozen sources (References #11/#12), not a library call — a decade-old copy still labels ops correctly because the `FC_REFLECT` order and space ids are chain-frozen. What could break: node WS endpoints (data, not code — editable node list covers it) and the curated MPA list for the Feeds tab (degrades to the verified empty state, never a crash).
- **(b) New dependencies:** none. New chain surface: eight database read methods + `get_objects`, all through the single `Chain` module (no new socket code, no `block_api`/`history_api` accessors added unless ambiguity B forces it — then justified in the note). #2 consulted as pages only; #3 as read-pattern cross-check; nothing vendored, nothing imported.
- **(c) Smallest deletable subset:** the Feeds tab + hash-tx search + non-core object rows (keep: recent blocks, block/tx detail, asset list/detail, `1.2.x`/`1.3.x` links) — kept because scope (SLICES.md §9) names feeds tables and `1.x.y` addressing explicitly; if the slice overruns, defer exotic object rows (1.15–1.22 detail fields) first, never the fixture read-back step.
