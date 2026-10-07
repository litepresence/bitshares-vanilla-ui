# Network graphs beyond pools & markets: transfer/account/operation maps

Status: proposal (user-authorized while AFK 2026-10-07). Nothing here is
scheduled; pool + market mappers ship first. Doctrine boundary is load-bearing
and stated once: **every graph below ships chain-default wherever a chain
source exists; ES appears ONLY as opt-in ES-lab enrichment** (endpoint
configurable, dead-ES hides the tab, chain wins every tie — the established
`es-lab.js` contract). An "ES-dependent" graph in this doc means "ES enriches
or ES-only inside the lab", never a core route that needs ES to render.

Reusable engine (already shipped, no new machinery):
`PoolNetUI` canvas (repulsion + springs + center pull, 3s pause rule,
Physics on/off, wheel/pinch zoom, drag + throw, tap nav, keyboard Enter,
reduced-motion policy) + `mount` opts (`navEdge`/`navNode`, `compact`,
`palette`) + node sizing by weight + edge width by volume + brand/degree
fills. Every proposal below is a **data adapter + palette + nav triple** on
this engine — no new physics, no new canvas code expected.

Field references marked [V] are verified live against `es.bitshares.dev`
(per `vanilla/js/api/es-lab.js` sourceRefs); [T] means verify-against-ES at
implementation time (same probe pattern as the lab's 2026-10-03 probes).

## A. Transfer ego-graph — CHAIN-ONLY, buildable today

- Nodes: accounts. Edges: transfers (op 0) to/from the searched account.
- Source: `get_account_history(id, 100, start, stop)` paged walk (existing
  `Account.historyPaged`: ≤5 pages × 100, stops early on short page).
  Transfer rows carry from/to/amount in the op object — filter
  `op[0] === 0`, accumulate per-counterparty totals as BigInt per asset
  (never sum across precisions; display via `Format` with each asset's
  precision at render).
- Depth: 1 hop default; optional 2nd hop re-walks top-N counterparties
  (cap: 8 × 2 pages — bounded, disclosed).
- Clicks: node → `#/account/:name`, edge → account-history filtered view
  (or the transfer Tx detail where known).
- Honesty: "last ≤500 ops" scope note (chain paging, not full history);
  amounts per asset, never merged.
- Effort: small (new `transfer-net.js` adapter + `#/transfers` route reuse?
  recommend new route `#/graph/transfers` or a tab on the account page —
  account-page tab is cheaper and contextually right).

## B. N-day counterparty ranking — chain walk, ES optional

- Same graph as A, weighted by an N-day window instead of last-N-ops.
- Chain path: extend the history walk with block-time cutoff (rows carry
  `block_time`; stop paging past the window). Cost grows with account
  activity — cap pages, disclose truncation.
- ES path (opt-in): `donors-to-account` template exists (`es-lab.js`,
  recipient + asset + days + limit, self-transfers excluded) [V: field refs
  in template]. One query replaces the walk; every returned counterparty
  re-proven by a chain `get_account_history` peek before display.
- Clicks/targets: same as A.

## C. Multi-hop flow tracing — ES OPT-IN (lab only)

- Question: where did funds go / come from, 2–3 hops out (donors of
  donors, recipients of recipients).
- Chain path is combinatorially hopeless (branching walks explode) — this
  is the honest ES showcase: chained `donors-to-account`-style aggs or a
  scripted flow query [T: field path for sender terms +
  `operation_history.op_object` amount].
- Rules: depth cap 3, node cap ~60, every leg re-proven on chain before the
  edge draws (a leg the chain can't confirm renders dashed-"unconfirmed" or
  not at all — never faked). Dead ES → tab hidden with the lab's standard
  note.
- Clicks: node → account, edge → the hop's transfer list (ES results link
  into the lab's raw console for audit).

## D. Fill network (who trades with whom) — chain-first, ES optional

- Nodes: accounts. Edges: fill pairs (taker ↔ maker) on a selected market.
- Chain path: `get_fill_order_history(base, quote, 100)` rows keep the raw
  row (`_fillRow.raw`); the taker side is in-row (verify the account field
  name at implementation — do NOT assume `_normalizeFills` parses it, it
  handles price/amount only), the maker side needs the matched order read.
  Bounded: last 100 fills per market, pairs counted, no amounts merged
  across assets.
- ES path (opt-in): fills agg over N days for markets whose books are
  thin today (same `top-markets`-style agg family that already exists).
- Clicks: node → account, edge → `#/market/QUOTE_BASE` at the fill's price
  (deep link where supported, else the desk).

## E. Operation-mix bipartite map — ES OPT-IN (lab only)

- Nodes: one account + operation-type nodes (transfer, fill, HTLC, vesting,
  vote, ...). Edges: count of each op by the account in N days.
- Source: existing terms agg on `operation_type` (`es-lab.js:248`
  `by_op_type`, size 200) [V] + `account_history.account` term filter [V].
  No chain equivalent at scale (would require full history walks) — this
  one is ES-only and says so on the tin.
- Clicks: op-type node → lab query prefilled for that type; account node →
  account page.

## F. HTLC + vesting payout graphs — chain-first

- HTLC: `get_htlc_by_from/to` (check `htlc-ui.js` existing reads) →
  contract node ↔ creator/recipient edges, amounts + hash preimages as edge
  detail. Fully chain-native, small graphs.
- Vesting: `get_vesting_balances` + balance objects (owner, terms) →
  payer ↔ payee edges. Chain-native.
- ES role: none needed (discovery is per-account reads). Only if someone
  wants "all HTLCs chain-wide" does ES enter — out of scope, say so.

## G. Vote graph (account → witnesses/committee/workers) — CHAIN-ONLY

- Nodes: accounts + witnesses + committee members + workers. Edges:
  approvals (account object's `votes` + proxy chain — `vote.js` already
  resolves this for the ballot UI; reuse the resolver, don't re-derive).
- Fully chain-native, no ES involved at any depth. Proxy edges render
  distinctly (dashed) from direct votes.
- Clicks: account → account page, witness/committee → existing voting
  rows, worker → proposal detail.
- This is the cheapest high-value graph after transfers: all data is one
  `get_objects`/`get_account` round trip per account viewed.

## H. Referral/registrar tree — CHAIN-ONLY

- Nodes: accounts. Edges: registrar → registered, referrer → referred
  (both fields live on the account object — single reads, exact, no
  inference).
- Tree layout wants a layered variant of the engine (BFS depth from the
  searched account as the ring assignment — `pool-graph.js` rings
  precedent, port the idea not the code).
- Clicks: node → account page. Depth cap 3, node cap ~100, honest note.

## I. Explicitly OUT (asked, refused, or deferred)

- Full-chain "all transfers ever" graph: no bounded source; ES can't credibly
  aggregate it either at lab query budgets. Refuse; ego-graphs + windows only.
- Balance-weighted-holder overlap maps: holder enumeration (`get_asset_holders`
  caps) is sampling with survivor bias — would look authoritative while
  lying. Refuse until a bounded honest query exists.
- Real-time streaming positions on any graph: polling loops rot into battery
  fires; the 3s-pause + interaction-resume contract stays. Any proposal that
  needs a live loop must justify against it in writing.

## ES-lab integration shape (when any C/D/E ships)

- New template(s) in `es-lab.js` following the existing `TEMPLATES` entry
  shape (key/group/kind/index/title/desc/sourceRef/fields) + a graph tab
  that mounts the shared canvas in `compact` mode with the proposal's nav
  triple. Endpoint stays user-configurable where the lab already allows it;
  dead endpoint hides the tab with the standard honest note (never a
  spinner, never a fallback fabrication).
- Budgets live in the template `fields` (days ≤ 90, limit ≤ 100 precedent)
  and in the adapter (node cap 60–100, chain re-proof per edge).

## Suggested build order (when authorized)

1. G (vote graph) — cheapest, fully chain, reuses ballot resolver.
2. A (transfer ego-graph, account tab) — chain walk exists, needs the adapter.
3. H (referral tree) — trivial reads, needs layered rings.
4. B (N-day windows) — extends A; ES donor template already exists for the
   opt-in side.
5. F (HTLC/vesting) — small, completes the account-context story.
6. D (fill network) — needs fill-row account parsing verified first.
7. C, E (ES-only lab graphs) — last; ES-lab home turf, needs template probes.

Anti-rot for all of the above (§4.5): (a) every graph renders from reads
any static server can make — no build step, no npm, no canvas lib; (b) new
trust is exactly one configurable ES endpoint, and only inside the lab,
with chain re-proof per edge; (c) smallest deletable per graph is the
adapter file (engine stands alone).
