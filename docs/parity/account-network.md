# Parity Note — Account Network (`#/account-network`)

Date: 2026-10-09. Slice: new page (spec
`docs/superpowers/specs/2026-10-09-account-network-design.md`, plan
`docs/superpowers/plans/2026-10-09-account-network.md`).
Data-only: no operation is ever built, signed or broadcast here.

## 1. Reference behavior

- **Proposal doc** `docs/es-network-graphs.md` §A ("Transfer ego-graph") is
  this page's ancestor; it named the reuse targets and the honesty rule.
- **#2 astro-ui / #5 dex-ux / `bitshares-historical-charts`**:
  `pools.js:2-49` (range + `search_after` query builder) and
  `main.js:214-261` (`queryElasticsearchWithPagination`, 10 000/page loop,
  short-page stop) are the paging pattern this slice ports.
- **#1 bitshares-ui** has no account graph; its account page shows history as
  a flat list (`account-history.js renderHistory`), which is what the arrow
  graph replaces.
- **Live index probes** (2026-10-08/09, `es.bitshares.dev`, index
  `bitshares-*`, through `HistoryCap.esSearch` only):
  - `account_history.account` is the account **id**, and every operation is
    indexed **once per party** (transfer A→B yields two docs) →
    dedupe by `block_data.block_num` + `account_history.operation_id`.
  - the index's `operation_type` numbering disagrees with `Tx.OP` for
    10/11/22/23/39 (index 10 = `asset_create`, not `min_to_receiver`) →
    every extractor validates its field names; a mismatch is a counted skip.
  - `size` above 10 000 returns **HTTP 200 with zero hits**.
  - `credit_offer_object.owner_account` (not `owner`); `credit_deal_object`
    has `offer_id`.
  - op 69's `operation_result_object.data_string` = the offer id it minted;
    op 72's `data_object.new_objects[0]` = the deal id, with
    `impacted_accounts[0]` = the lender. Both term-filterable.
  - `get_objects(["1.22.209"])` → `[null]`: offers and deals are deleted
    objects while their operations live on.

## 2. Vanilla implementation

| File | Lines | Owns |
|---|---|---|
| `vanilla/js/api/account-net.js` | 458 | the RULES: class table, strict extraction, dedupe, per-asset aggregation (pure; re-exports the transport half) |
| `vanilla/js/api/account-net-es.js` | 439 | the TRANSPORT: HistoryCap seam, paged ES walk, chunked `get_objects` credit join, index fallback for deleted offers/deals, `gather` |
| `vanilla/js/views/account-network-copy.js` | 362 | every user-visible string, as pure builders |
| `vanilla/js/views/account-network-ui.js` | 475 | the WIDGETS: seeds, chips, status, detail, table twin, canvas mount, hash sync |
| `vanilla/js/views/pool-net-paint.js` | +45 | opt-in arrowheads, per-class edge colour, per-node fill |
| `vanilla/js/views/pool-net-ui.js` | +25 | injected-graph gate, mount opts (`arrows`/`edgeClassOf`/`nodeFillOf`), account status isolation |
| `vanilla/css/app.css` | +18 | `.an-*` block |
| `vanilla/index.html` | +4 | four script tags (core, transport, copy, view) in dependency order |
| `vanilla/js/router.js`, `menu-ui.js`, `account-ui.js`, `index.html`, `globals.d.ts` | — | route + Labs card + seed button + script tags + type decls |
| `vanilla/locales/*.json` | 12 | 56 new keys per locale (3883 total) |

Edge semantics: **Transfer** (op 0) and **Credit** (op 72 accept = lender →
borrower, op 73 repay = borrower → lender) on by default; **Override
transfer** (38), **Direct debit** (25–28), **HTLC** (49/51), **Vesting
update** (34) as opt-in chips. Margin is deliberately absent (owner
decision: no honest account↔account meaning).

## 3. Manual test steps + observed result (mainnet, live)

| Seed | Result |
|---|---|
| `committee-account` | 2065 indexed ops (3 ES pages of 1000/1000/65) → 41 accounts, 45 lines, "top 40 counterparties shown"; all 45 lines are transfers, spanning 2018-03 → 2026-10 |
| `1.2.1804436` (am1q) | 1548 ops → 41 accounts, 70 lines (54 transfer + **16 credit**), 40 credit lines resolved from the index |
| both seeds (union) | 3613 ops → 42 accounts, 80 lines (64 transfer + 16 credit) |
| edge tap | detail line fills, e.g. `committee-burn → committee-account · Transfer · 91848.00000 BTS · 1 op · flow 2020-09-28 → 2020-09-28`; **hash unchanged** (select, not navigate) |
| boot | **0 ES calls** — the page never scans until asked; a deep link draws once, after the node opens |
| three themes + 360 px | all render; zero console errors in every run |

## 4. Raw → human test vectors (#6)

| Raw | Rule | Display | Vector |
|---|---|---|---|
| `7500000` @ BTS (p5) | `Format.formatAmount` at render | `75.00000 BTS` | `detailText` |
| `100000000` @ p5 | same | `1000.00000 BTS` | `detailText` |
| multi-asset edge `{BTS: 100000000, CNY: 500, USD: 7}` | largest asset + count the rest, **never summed** | `1000.00000 BTS + 2 more` | `amountsText` |
| raw int from ES, precision unknown before the join | no placeholder precision | `1.3.5925` (asset id fallback) | live edge above |
| `count: 1` | singular key | `1 op` | `detailText` |
| flow vs relation | class `kind` | `flow` / `relation` in detail + twin | class-table vectors |

## 5. Themes, viewports, a11y

- `account-network-{credit,dark,vanilla}-1440.png` + `account-network-phone-360.png`.
- Canvas reuses the shipped engine: wheel/pinch zoom, drag, tap, keyboard
  Enter, resize, IntersectionObserver, `prefers-reduced-motion` (settles with
  zero frames).
- 44 px chips/button/input; `aria-label` on the seed input and every chip;
  `th scope="col"` from TableRenderer; the `<details>` table twin means the
  canvas is never the only source of truth (45–80 rows).

## 6. Readability (§3.7)

Module headers state owns/consumes/globals/created-by plus the ES-truth and
money-discipline notes; every exported function has what/params/returns/failure
JSDoc; shared shapes (`AccountNetEdge`, `AccountNetClassify`,
`AccountNetGraph`) are typedef'd once in the owning module. No TODO/FIXME
(grepped); no local `el()`/`touchable()` copies (`DOM.*` and the shared
`touchable` global are used); no dead CSS (19 dead selectors pre-exist, zero
added).

## 7. Anti-rot gate (§4.5)

- (a) A vanished index leaves an honest page (`es-unavailable` copy), never a
  fake graph; a ten-year-old browser still runs everything here.
- (b) New dependencies: **none**. New trust: the one already-configurable
  community index behind the existing `esEnabled` preference.
- (c) Smallest deletable subset: `account-net.js` + `account-network-ui.js`
  + two route lines. The canvas, physics and gestures are the shipped engine.

## 8. Gates

- New vectors: `account-net` **85**, `account-net-paint` **15**,
  `account-network-ui` **62** — all pass.
- Both slice files were split after the audit's size check (§3.7 ~400-line
  rule): rules vs transport, words vs widgets. Re-verified live after the
  split (all four globals resolve, 70 lines, canvas, zero console errors).
- Unchanged green: `menu-test` 28, `pool-net-ui` 110, `pool-graph` 206,
  `market-desk-map` 44, `pool-history` 65, `market-fills` 29, candle suites
  7/8/9/5.
- `bash tooling/check_types.sh` PASS · `python3 tooling/check_i18n.py` OK
  (3883 keys, 5105 call sites) · `python3 tooling/check_rot.py` PASSED ·
  `scan_dead_css` adds none.

## 9. Audit checklist result (skills/auditing-vanilla-slices)

| # | Check | Result |
|---|---|---|
| 1 | Rot gate | PASS (`check_rot.py`; no CDN/framework/package.json) |
| 2 | Retro look | New page by owner request; shares the shipped network engine, header nav and page furniture (bar still 6 links) |
| 3 | Feature coverage | §A of the proposal doc, plus credit (the owner asked for credit; margin was explicitly dropped) |
| 4 | Modern glow | Progressive scan status, honest empties, no hover-only UI, `replaceState` URL sync, cleanup + `gen` guards, shared touch floor |
| 5 | Themes | Four screenshots (ref / dark / vanilla / 360 px); **zero hardcoded hex** in the slice (verified by grep: `.an-*`, view and adapter contain none) |
| 6 | Human terms | All amounts via `Format.formatAmount` at render; no `Math.pow(10` outside `format.js`; vectors include a non-BTS precision, a multi-asset edge and the singular count |
| 7 | Both ends | 360 px and 1440 px recorded; chips/button/input ≥44 px; table twin scrolls |
| 8 | Built to be read | Headers + JSDoc everywhere; **files split** after the check flagged 808/767 lines; no TODO/FIXME |
| 9 | Type gate | PASS (`check_types.sh`), two `declare var` lines added per split module |
| 10 | No recreated utilities | Uses `DOM.*`, shared `touchable`, `TableRenderer.render`, `DOM.pageHead`; grep clean |
| 11 | i18n | 3883 keys × 12 locales, drift-free |

## 10. Defects found and fixed during the build (record, not blame)

Unit vectors caught: a promise left **unsettled** on mid-walk failure (a
silent spinner); a deleted deal silently dropped instead of reported missing;
`SCAN_CAP` below the page size made the paging loop unreachable; `enabled([])`
silently becoming the defaults.

The live browser caught: `location.hash` re-entering the router and orphaning
the draw; one generation counter doing two jobs; the engine's injected-graph
gate rejecting `mode: "account"` (it drew the POOL skeleton over the account
graph); deep links drawing before the node opened (claiming "account not
found"); `TableRenderer.render(cfg)` returning a table rather than taking a
host; `credit_offer_object.owner_account` misread as `owner`; deleted
offers/deals unresolvable from chain; the pool status strip and
"Loading network…" leaking in; every node painted alert-red; `"1 ops"`.
