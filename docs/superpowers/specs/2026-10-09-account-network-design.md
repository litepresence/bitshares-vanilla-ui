# Account Network (accounts-as-nodes graph) — Design

Date: 2026-10-09. Status: approved (owner: "spec, plan, implement, audit,
commit"; placement + classes confirmed).
Author: brainstorm with owner.
Scope: one new standalone page in `vanilla/` — enter one or more accounts,
see the union of everything those accounts sent/received as a directed graph
of accounts and arrowed lines. Data-only: reads the community index + chain
reads, builds no transaction, signs nothing, stores no keys.

## 1. Goal

Give the user the missing question in the wallet: **"who does this account
actually deal with?"** Today the app shows an account's balances and its
history as a flat list; there is no picture of the relationship. This page
answers it as a graph: seeded accounts in the middle, their direct
counterparties around them, one arrowed line per flow with amounts and
counts. It is the accounts-as-nodes twin of the shipped pool/market network
maps (`docs/es-network-graphs.md` §A, extended with credit + the optional
account↔account families).

Not a scam-map or a "who's in cahoots" tool: every line is a real indexed
operation, every number is a real raw integer, and every scope limit is
stated on the page.

## 2. Decisions (from brainstorm)

- **Placement:** new standalone route `#/account-network`, listed on the
  **Labs table-of-contents** (`#/menu/labs`) next to ES Lab / API Lab —
  card title "Account Network", blurb **"transfer tracking"**. The header
  bar stays at its owner-ruled 6 links; the Labs card count auto-derives
  (3 → 4). Plus a "Draw network" seed button on the account page.
- **Depth:** **1 hop**, union across every seed entered. No multi-hop
  expansion (owner choice; it keeps the ES budget and the canvas honest).
- **Nodes:** accounts only. **Edges:** account↔account operations only.
- **Margin: skipped** (owner decision) — op 3 names only `funding_account`
  (usually the account itself) and ops 45/46 name the `bidder` but not the
  position owner, so a margin line has no honest account↔account meaning.
- **Default classes ON:** Transfer (op 0) **and Credit (69–73, 76) — the
  two families originally requested. Everything else defaults OFF and is
  switched on with chips (owner's "op 0 default with buttons to add/remove
  all potential other account-account data").
- **ES is required** (owner: "it will require ES; its a feature that is
  data only"). No chain fallback is fabricated. When the index is off or
  unreachable the page states the reason and where to fix it.
- **Interaction:** tap a **node** → that account's page. Tap an **edge** →
  selects it and shows its detail (amount, count, first/last seen) in the
  detail line + highlights its row in the table twin — deliberately *not* a
  navigation, because the account-page history filter only offers
  all/transfer/fills and could not deep-link a credit edge honestly.
- **One visual note per class**, never merged across assets.

## 3. Verified chain-index facts (probed live 2026-10-08)

All against `es.bitshares.dev` index `bitshares-*` through the one sanctioned
seam `HistoryCap.esSearch`. These are the spec's load-bearing facts.

| Fact | Consequence |
|---|---|
| `account_history.account` holds the **account id** (`"1.2.90744"`), and every operation is indexed **once per party** (a transfer from A to B yields two docs) | One query per seed returns that account's whole indexed history — but hits **must be deduped** by `block_data.block_num` + `account_history.operation_id` |
| The index's `operation_type` numbering does **not** match `Tx.OP` for 10/11/22/23/39 (index 10 = `asset_create`, not `min_to_receiver`) | Only the ids whose field shape was probed are used; every extractor **validates its expected field names per hit** and counts mismatches. Never infer an op from its number |
| `size` above 10 000 returns **HTTP 200 with zero hits** | Page size pinned at 10 000; depth comes from `search_after` paging |
| ES `sort[0]` is **epoch millis** | Sort key passed back verbatim; coverage/time math never uses it |
| Per-seed volume (transfer+credit): committee-account 2 075 ops / 1.79 MB / 2.5 s; typical accounts 248–282 ops / 0.27 MB / 0.35–1.4 s | One page per seed covers nearly every account; `SCAN_CAP` 5 000 is generous and bounded |
| The **19-op union** for committee-account is 25 910 ops / **47 MB** / 7.7 s | Never query all families at once: query the **union of the enabled classes only**, and refuse a class set whose op count exceeds the cap |

Per-family endpoint fields, as probed:

| Class | ES ops in the query | Ops that **draw a line** | Direction | Amount | Line kind |
|---|---|---|---|---|---|
| Transfer | 0 | 0 | `from` → `to` | `amount_.{amount,asset_id}` | flow |
| Credit | 69, 70, 71, 72, 73, 76 | **72** (accept), **73** (repay) | 72: lender → borrower · 73: borrower → lender | 72: `borrow_amount` · 73: `repay_amount` | flow |
| Override transfer | 38 | 38 | `from` → `to` | `amount_` | flow |
| Direct debit | 25, 26, 27, 28 | 25, 26, 28 (permission), 27 (drawdown) | owner (`withdraw_from_account`) → `authorized_account` / `withdraw_to_account` | `withdrawal_limit` / `amount_to_withdraw` | **relation** (25/26/28) · flow (27) |
| HTLC | 49, 50, 51, 52 | **49, 51** | `from` → `to` | `amount_` | flow |
| Vesting update | 34 | 34 | `initializer` → `owner_` | `daily_pay` | **relation** (authority, not a flow) |

**Ops that deliberately draw no line** (lifecycle, not counterparty): credit
69/70/71 (offer create/delete/update — only the owner is named;
`acceptable_borrowers` is a permission list, not a flow), credit 76 (deal
auto-repay flag — no amount), HTLC 50 (redeem — only `redeemer` and
`htlc_id`, no second account) and 52 (extend — only `update_issuer`). They
ride along only because the class ships them together; the extractor skips
them silently (not as errors).

**Flow vs relation is a first-class label.** A line that is not a movement of
value must never look like one: every class carries `kind: "flow" |
"relation"`, the legend marks it, the detail line states it, and the table
twin has a column for it. Mixing them silently would misrepresent the chain.

Credit counterparties need a join: op 72/73/76 name only `offer_id` (1.21.x)
/ `deal_id` (1.22.x). The **owner** comes from the chain —
`get_objects` over the referenced ids (`Credit.offer`/`Credit.deal` already
normalize owner + owner name). Unresolvable references are counted and the
line is dropped, never invented.

## 4. Doctrine exception (AGENTS.md §4.5 / es-network-graphs.md preamble)

The standing rule is *chain-default, ES as opt-in enrichment*. This page is
**ES-required by owner decision** — the same shape the candle deep-walk
already ships with (ES first, honest degraded state, chain labels when
chain-only). Recorded exception: new trust is exactly the one existing
configurable community-index endpoint behind `HistoryCap`, already governed
by the `esEnabled` preference. No new host, no new transport, no new
persistence.

## 5. Architecture

```
┌ account-network-ui.js (view)  ── seed input · class chips · status ·
│                                  detail line · legend · table twin
│  ├─ router.js route + Router.query() seeds/classes (shareable URL)
│  ├─ Account.resolve(nameOrId)      → seed ids/names (chain)
│  ├─ account-net.js  (pure data, no DOM)
│  │    ├─ scanSeed(seedId, opIds)   → HistoryCap.esSearch, paged, capped
│  │    ├─ classify(hit)             → strict per-op edge extraction + skip reasons
│  │    ├─ creditOwners(refs)        → chain get_objects join (Credit.offer/deal)
│  │    └─ buildGraph(edges, seeds)  → nodes/edges/caps/stats (BigInt per asset)
│  ├─ Asset.describe / symbol cache → asset symbols + precisions at render
│  └─ PoolNetUI.mount(..., {mode:"account", navNode, edgeHit})
       → reuses the shipped canvas: physics, wheel/pinch zoom, drag+throw,
         tap, keyboard Enter, resize, IntersectionObserver, reduced-motion
```

`navNode` navigates (node → `#/account/:name`); `edgeHit` *selects* — the
engine's edge resolver hook is reused, but on this page it highlights the
edge and fills the detail line rather than navigating (§2). **Parallel
edges:** when two classes connect the same pair in the same direction, the
draw offset separates them by class so neither hides under the other (the
pool map never needed this; a transfer + credit pair does).

Isolation: `account-net.js` is pure (no DOM, no storage, no chain beyond the
`Chain`/`Account`/`Credit`/`Asset` globals the rest of the app already uses),
so every rule below is headless-testable. The view owns DOM only. The canvas
paint gets **opt-in** arrows + per-class colours (defaults unchanged, so the
pool/market maps stay byte-identical).

## 6. Data flow

1. **Seeds** — read from `#/account-network?seeds=a,b&classes=transfer`,
   else the input box, else the account page's seed button. Parse on
   comma/space/newline; cap 12; `Account.resolve` each (unknown names listed
   honestly, the rest still draw); remember recent seeds in `localStorage`
   (`accountNet.seeds.v1`, session-safe).
2. **Op union** — enabled classes → flat op-id list (`CLASSES[id].ops`).
   Refuse (with a message) if the union is larger than the class cap.
3. **Scan** — per seed, one query:
   `filter: [term account_history.account = seedId, terms operation_type = opIds]`,
   `size: 10 000`, sorted `block_data.block_time` desc, `search_after`
   paging to `SCAN_CAP` (5 000 hits/seed, `SCAN_MAX_PAGES` 2). Result carries
   `{ops, scanned, truncated}`. Seeds run sequentially (small concurrency ≤2)
   and **paint as each completes** (the candle walk's `onPage` pattern).
4. **Classify** — per hit: verify the op id is enabled, verify the expected
   endpoint fields exist, drop self-edges (`a === b`), map to
   `{class, from, to, amountRaw, assetId, time, blockNum, opId}`. Skips are
   counted by reason and surfaced (`skippedShapes`, `skippedSelf`).
5. **Credit join** — batch the referenced `offer_id`/`deal_id` sets through
   the chain (`get_objects`, chunked) → owner per reference; unresolved ones
   are counted and dropped.
6. **Aggregate** — dedupe hits by `block_num|operation_id`; group into edges
   keyed `from|to|class` (direction is preserved, so A→B and B→A are two
   lines); per edge keep `{count, perAsset: {assetId: BigInt}, firstSeen,
   lastSeen, kind}` where `kind` is the class's flow/relation tag. **Never sum
   across assets.**
7. **Cap** — nodes: seeds always + top `NODE_CAP` (40) counterparties by
   weight; edges: top `EDGE_CAP` (400). Every cap that bites is reported.
8. **Render** — graph shape handed to `PoolNetUI.mount`; node radius by
   weight, edge width by weight (log-scaled like the pool map), edge colour by
   class, arrowhead at the target end; status line + detail line + `<details>`
   table twin listing every edge with from/to/class/amount/count/first-last.

## 7. Honesty + failure states

- ES disabled (`esEnabled === false`) → plain note: "community index
  disabled — enable it in Settings", with a Settings link. No chain
  fabrication, no spinner that never resolves.
- ES unreachable / error → the error's own words, a Retry button, and the
  seeds preserved.
- Partial scan (cap hit) → "showing newest N of the account's indexed
  operations".
- Node/edge cap hit → "top N counterparties of M".
- Unknown seed names → listed by name, others still drawn.
- Credit reference unresolvable → counted ("N credit lines skipped: offer
  or deal not found on chain").
- Shape mismatch → counted, never inferred.
- A seed with zero indexed counterparties → honest empty state naming the
  account and its op count (an account can genuinely be idle).

## 8. Layout + responsiveness

Retro shell (page head, muted body copy, card furniture) with the shipped
canvas band reused as-is: 640px canvas, 480px under 640px viewport, internal
pan/zoom, 44px touch targets, `prefers-reduced-motion` settles synchronously
(no frames). Seed input + class chips sit above the canvas in a wrapping row
(chips wrap at 360px, each chip ≥44px). The table twin scrolls horizontally
under 640px. Three themes must all read: colours come from the same CSS
custom properties the pool map uses, class colours picked from the existing
`--buy/--sell/--accent/--warn/--muted` tokens, never hardcoded hex.

## 9. Testing

- `tooling/account-net-test.js` — pure vectors using the **real probed doc
  shapes** as fixtures: one per class; strict field validation (mismatched
  shape → skip + count); direction per op (including credit accept =
  lender→borrower, repay = borrower→lender); duplicate-pair dedupe
  (`block_num`+`operation_id`); self-edge drop; multi-asset aggregation
  (top asset + "+N more", never summed); caps + flags; unknown seed;
  credit join incl. missing deal; `Number()`-free BigInt arithmetic; op-union
  cap refusal.
- `tooling/account-network-ui-test.js` — DOM-stub vectors: seed parsing
  (comma/space/newline, cap 12), chip → class toggling, status/detail text,
  table-twin rows, hash round-trip, `_cleanups` on leave.
- `tooling/pool-net-*-test.js` — must stay green (paint default unchanged).
- Gates: `bash tooling/check_types.sh`, `python3 tooling/check_i18n.py`,
  `python3 tooling/check_rot.py`, plus the full existing suite.
- Live proof: seeded graph for 1–2 real accounts in all three themes at
  360px and 1440px, with the perf guard measured (single seed ≤3 s, ≤2 MB)
  and the whale seed (committee-account) staying bounded.

## 10. Files

| File | Change |
|---|---|
| `vanilla/js/api/account-net.js` | **new** — pure adapter (classes, seeds, scan, classify, join, graph) |
| `vanilla/js/views/account-network-ui.js` | **new** — page shell + table twin |
| `vanilla/css/app.css` | edit — `.an-*` block (chips wrap, 44px, twin scrolls under 640px) |
| `vanilla/js/globals.d.ts` | edit — two `declare var` lines (tsc hard gate) |
| `vanilla/js/api/pool-net-paint.js` | edit — opt-in arrowheads + per-class edge colour (guarded) |
| `vanilla/js/router.js` | edit — route + `ROUTE_META` entry |
| `vanilla/js/views/menu-ui.js` | edit — Labs section card (title/blurb/keys) |
| `vanilla/js/views/account-ui.js` | edit — "Draw network" seed button |
| `vanilla/index.html` | edit — two script tags (shared cache-bust token) |
| `vanilla/locales/*.json` | edit — `account_net.*`, `menu.p_account_net`, `menu.d_account_net` (12 locales) |
| `tooling/account-net-test.js`, `tooling/account-network-ui-test.js` | **new** — vectors |
| `tooling/add_account_net_i18n.py` | **new** — keys into all 12 dicts |
| `docs/parity/account-network.md` | **new** — parity note (audit record) |

## 11. Out of scope

Multi-hop expansion; margin edges; fills (op 4 — the maker side needs an
order lookup the index cannot answer); pool/market edges (that is the other
graph); referrals/registrar trees (§H of the proposal doc, still unbaked);
live/streaming edges (the pool map's 3s-pause contract wins); any tx
construction (this page reads and draws, nothing more).

## 12. Anti-rot gate (§4.5)

- (a) A vanished index leaves an honest empty page; a vanished app removes
  the route; the engine is pre-existing.
- (b) New dependencies: **none**. New trust: one already-configurable ES
  endpoint behind the existing preference.
- (c) Smallest deletable subset: `account-net.js` + `account-network-ui.js`
  + the two route/menu lines — the shipped canvas, physics and gestures stay
  untouched.
