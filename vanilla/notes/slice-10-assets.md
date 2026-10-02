# Slice 10 parity note — asset ops

Plan: `docs/superpowers/plans/2026-09-28-slice-10-assets.md` (Tasks 1–4).

## What landed (vanilla file:line)
- `vanilla/js/tx.js` — 7 serializers appended: op 10/11/12/13/14/15/19 +
  `serializeAssetOptions`/`serializeBitassetOptions`/`serializePrice`/
  `serializePriceFeed`/`serializeIdSet`. BJS cross-check fetched
  (`operations.js` 2026-09-27): all orders match #3/#4, no conflicts.
- `vanilla/js/asset.js` — reads (`issuedBy`, `describe`, `feeSchedule`) +
  builders `buildCreate/Update/UpdateBitasset/UpdateProducers/Issue/Reserve/
  Feed` + `fee` + `sendAndProve`; percent/ratio helpers (integer-only).
- `vanilla/js/asset-ui.js` (267: list + create) + `vanilla/js/asset-manage-ui.js`
  (275: update + issue) + `vanilla/js/asset.js` (170: reads) +
  `vanilla/js/asset-ops.js` (380: builders + helpers) — split per audit B2,
  re-verified (fee table renders, zero `undefined`, rot PASS).
- `vanilla/js/asset-feed-ui.js` (261) — `#/assets/feed` (read-back + op-19 +
  op-13 editor) + `feeSection` fee-schedule table.
- Routes `router.js:116-120`, tags `index.html` before `router.js`.

## Reference behavior (file:line)
- #4 wins throughout: op ids + FC order `asset_ops.hpp:626-639,650-658,682-726`;
  price_feed `asset.hpp:312-313`; chain ground truth `asset_ops.cpp:178`
  (settlement.base == CER.base) + `asset.cpp:266-273` (`is_for`).
- #1 `Asset.jsx:738-748`: MCR/MSSR/MCR ÷1000 (`1750`→`1.75×`); market fee
  hundredths (`200`→`2%`). NFT = description-JSON convention; PMA = op-10 +
  `is_prediction_market:true` (no separate ops). Ops 16/17/18/43/47/48
  deferred (settle→slice 13).

## Bugs found by verification, fixed + re-proved
- F1 BLOCKING: feed CER legs swapped (views built CER base=backing). Fixed
  (`asset.js:444-467`, `asset-feed-ui.js:7-11,172,190-213,218`) → feed
  ACCEPTED at **block `100918551`** (settle + CER both `1.3.1850/1.3.0`,
  MCR 1750/MSSR 1500). Op-10 create CER placeholder (`1.3.1`) is correct —
  chain overwrites it (proven on re-read).
- B1 MONEY-CRITICAL (audit): `pctHumanToRatio("175")` returned `175` not
  `1750` (missing ×10 pad; decimals worked). Fixed (pad like sibling).
  Chain reconcile: `1.3.1850` bitasset `2.4.448` CURRENTLY stores MCR 1750 /
  MSSR 1500 — the F1 proof passed via explicit ints; only the UI form string
  path was broken, fixed at the single helper. Round-trips:
  `"175"→1750→"175"`, `"150"→1500→"150"`, `"175.5"→1755→"175.5"`, `"2"→200→"2"`.
- F2: `cold()` never subscribed → same `Store.subscribe("connection")`
  pattern as transfer/vote/explorer; proven by no-click re-render shot.
- F3: fee table compared cross-file gen → own `feeGen` guard; fee rows render.

## Test vectors (raw → human, real files, live testnet)
- CREATE UIA `AFKTEST10` (`1.3.1849`, p4): fee `20008496`→`200.08496 TEST`,
  maxsupply `10000000000`→`1000000.0000` — block `100918131`.
- ISSUE 10.0000: fee `197`→`0.00197`; supply/balance exact — ~`100918147`.
- UPDATE (desc): fee `8498`→`0.08498` — block `100918148` (first attempt
  correctly REJECTED `invalid asset * price` on create-style CER — evaluator
  proof the node parsed our bytes).
- RESERVE 1.0000: fee `100`→`0.00100`; supply `100000`→`90000` — `100918149`.
- MPA `AFKTESTM11` (`1.3.1850`, smartcoin, backing `1.3.0`) — `100918151`;
  op-12 lifetime 86400→43200 — `100918152`; op-13 self-producer — `100918156`;
  op-19 feed — `100918180` + F1 correction feed — `100918551`.
- Fee tiers live: op-10 `{symbol3:2000000000, symbol4:200000000,
  long:20000000, ppk:100000}`, op-11/14 `{fee:100, ppk:100000}`, op-12/13/15/19
  flat `100`; surcharges ≈ bytes × ppk (`+8496/+10058/+8398/+97`).
- Serializer: `200→c8 00`, `1750→d6 06`, `1500→dc 05`; op-10 UIA 86B / MPA 106B
  deterministic; `hundredthsToPct(200)="2"`, `ratioToPct(1750)="175"`.

## Manual test (headless, --network testnet, zero console errors)
- `#/assets` @1440 (+dark/light trio): fee table renders real rows, no stale
  offline panel; 390 stacks with hamburger.
- `#/assets/create|issue|feed`: connected badge + correct lock gate.
- Leftovers (no chain delete): `AFKTEST10` 9.0000 held by issuer; `AFKTESTM11`
  supply 0.

## Tester pass (queued)
- Create UIA → issue → reserve → update (named confirms, human fees);
  create MPA → set producers → publish feed; fee table; light visual; 390.

## Anti-rot gate (§4.5): (a) yes — static + existing Tx/Chain reuse; (b) nothing
new depended on (BJS fetched once as reference, never imported); (c) smallest
deletable: feed page (create/issue/update stand). `check_rot.py` PASS.

## Delta 2026-10-01 — R1d settlement estimate (reads/display only, no new ops)

- Formula ports #1 `ExchangeHeader.jsx:190-198` (wins over astro's offset-less
  dialog per #4 `asset_ops.hpp` force-settlement comment): `offset=
  bit.options.force_settlement_offset_percent`; base CORE(`1.3.0`) ?
  `feed/(1+off/10000)` : `feed*(1+off/10000)` via `Format.settleEstimate`
  (exact BigInt, `vanilla/js/format.js`); `feedReal` from
  `current_feed.settlement_price` with BOTH legs' precisions via
  `Format.formatPrice`; globally-settled (`settlement_fund>0`) uses
  `bitasset.settlement_price` directly, same object, zero extra calls
  (`vanilla/js/market-desk.js:fetchFeed`).
- Strip shows Feed + Settlement (`vanilla/js/market-ind.js:renderStrip`;
  live title carries `offset X/10000`, global keeps Global Settlement label).
- Fee asset stays `1.3.0` default; switching deferred (honest note in
  borrow confirms, same round).
- Vectors: `tooling/settle-cr-test.js` 40/40 (offset 0 == feed, nonzero both
  branches, non-BTS p4/p2, global vs live differ, fund BigInt flags).
  `node --check` clean, `check_rot` PASS, `Math.pow(10` outside `format.js`
  empty.

## Delta 2026-10-02 — prediction implied-probability + quick-position (reads/display only, no new ops)

> Home note (why slice-10, not slice-14): PMA lifecycle (op-10 +
> `is_prediction_market:true`) is slice-10 asset ops, and this delta is
> display-only on top of slice-10 PMAs + existing market reads — same seat
> as the R1d settlement-estimate delta above. No proposals/tickets/misc
> ops, so slice-14 (`slice-14-proposals.md`, misc-ops home) is the wrong
> home. No human browser/testnet pass ran in this round (offline vectors
> only, tester-queued — same honesty rule as the slice-14 trollbox delta).

### Reference behavior (file:line)
- #1 opinions ARE orderbook rows (`PredictionMarkets.jsx:104-160`, NOT
  copied — detail links to the live desk instead); list concepts
  (`:368-419` filter+search, `:492-618` overview) already ported in
  `prediction-ui.js:20-25`. #2 has no prediction page (nothing to diff).
- Instant-trade route `#/instant-trade/:marketID` exists (matrix A31);
  entry `InstantTradeUI.renderInstant(root, marketID)` takes ONLY a
  `SELL_RECEIVE` pair (`instant-trade-ui.js:200-206` parsePair — no side or
  query param). So a market+side preset cannot pass `side=` — the market
  DIRECTION is the preset (never faked).

### Vanilla implementation (file:line)
- `vanilla/js/views/prediction-ui.js:136-256` — pure probability section
  (display math on HUMAN prices only, never raw integers, so plain Number
  is allowed; `Format` still owns all raw↔human — single-format-module
  rule holds by construction): `probabilityFromPrice` (null when no price,
  clamp >1/<0), `probabilityFromBook` (mid preferred, last fallback,
  zero-sum book falls through, else null), `formatImplied` (1dp %),
  `formatDecimal` (2dp = 1/p, null at 0), `formatFractional` ((1-p)/p
  reduced via `gcd`, den cap 100, null at 0/1 edges), `formatAmerican`
  (±, `Even` within 1e-12 of 0.5, null at 0/1 edges). Exposed on `_test`
  (`:768-781`, top-ops precedent).
- Detail panel `:640-713` — `Implied probability` section paints
  `Loading market price...` then updates in place when `get_ticker` +
  `get_order_book [backId, info.id]` resolve (gen-guarded — that update IS
  the live-updating); all four formats + `Mid-price …`/`Last price …`
  source note; honest `No market price yet - probability unavailable.`
  empty (never 50%-by-default). Chain-direct (no new Market global);
  failures resolve nullish → empty, never a throw. textContent-only.
- Quick-position `:715-738` — `Buy YES` →
  `#/instant-trade/BACK_PMA` (spends backing), `Buy NO` →
  `#/instant-trade/PMA_BACK` (spends shares); hint states the gap
  (instant-trade has no side parameter, direction is the preset).
- i18n: 14 `prediction.*` keys via `t()` + all 10 dicts
  (`probability/prob_implied/prob_decimal/prob_fractional/prob_american/
  prob_no_price/prob_loading/prob_source_mid/prob_source_last/buy_yes/
  buy_no/quick_position/quick_position_hint/even`, en-identical stubs).

### Test vectors (`tooling/prediction-prob-test.js` 48/48 GREEN, committed)
- Edges: 0→`0.0%`/decimal-null/fractional-null/american-null;
  0.5→`50.0%`/`2.00`/`1/1`/`Even`; 1→`100.0%`/`1.00`/null/null.
- Clamp: 1.5→1, -0.2→0. No-price: null/undefined/""/"abc"/"NaN"→null.
- Book: mid (0.6+0.8)/2=0.7 beats last; last fallback 0.75; empty→null;
  0/0 book→null (no fake mid); 0/1→0.5; mid 3→clamp 1.
- Fractional reduction: 2/3→`1/2`, 1/3→`2/1`, 0.75→`1/3`, 0.25→`3/1`;
  denominator ≤100.
- American: 0.75→`-300`, 0.25→`+300`, 2/3→`-200`, 1/3→`+200`, sign both
  sides, `Even` only at 50%.
- `node --check` clean (view + test), `check_rot` PASS, `check_i18n` OK
  (10 dicts key-complete, 3826 sites drift-free).

### Tester pass (queued — exact steps, no owner order needed)
1. Open `#/prediction/:PMA` on testnet for a PMA with a live book: panel
   shows all four formats + `Mid-price …`; for a PMA with no book/ticker:
   honest `No market price yet…` (never 50%).
2. `Buy YES` lands on `#/instant-trade/BACK_PMA` (sell=backing),
   `Buy NO` on `#/instant-trade/PMA_BACK` (sell=shares).
3. Themes trio + 360–390px phone AND 1440px+ desktop (not run this round).

### Anti-rot gate (§4.5): (a) yes — static + existing Chain/Explorer/Asset
reuse, zero new deps, no vendored crypto (probability is display float on
human prices, not money); (b) nothing new depended on (node list is data,
ticker/book degrade to the honest empty); (c) smallest deletable:
quick-position links (probability panel stands). `check_rot.py` PASS.

## Delta 2026-10-02 — PMO organizations + asset-create fee-tier display (reads/display only, no new ops)

> Home note (same seat as the deltas above): PMO orgs are plain-asset
> description conventions grouping PMA markets, and the fee tier is op-10
> schedule display — no serializers, no signing, no new chain surface.
> GROUND TRUTH (verified from BTS-CM/pma source 2026-10-02, reference-only,
> never cloned): pmo_object = {type:"PMO/ORGANIZATION@1.0",
> identity:{name,website,manifest},
> governance:{resolution_policy,dispute_mechanism,onchain_account},
> attestation}; PMA description = {main, condition, expiry} (+ optional
> market). FEE TRUTH (documented in-app, never a discount claim): NO PMO
> discount exists — sub-assets are cheap/expensive purely via the op-10
> symbol-length tiers (symbol3/symbol4/long_symbol params for op 10 +
> price_per_kbyte data fee, slice-10 live vectors). No human browser/testnet
> pass ran in this round (offline vectors only, tester-queued).

### Reference behavior (mapping-chain-calls — no new WS methods, all reads exist)
- PMO schema <- BTS-CM/pma source (see Ground Truth above; #1/#2/#3 carry
  no PMO concept, #4 has no description-JSON conventions — recorded as the
  single source, fail-soft by design).
- Reads reused (file:line of the EXISTING call sites, untouched):
  `list_assets` pages <- `Explorer.assetsPage` (prediction-ui.js scan core);
  `get_objects` bitasset batch <- same core; `lookup_asset_symbols` symbol
  pre-check + `get_required_fees` live fee <- asset-ui.js review path;
  `get_global_properties` fee schedule <- `Asset.feeSchedule`
  (vanilla/js/api/asset.js:227, consumed like fees-ui.js:314).
- Fee tiers <- slice-10 live vectors (this note: op-10
  `{symbol3:2000000000, symbol4:200000000, long:20000000, ppk:100000}`).

### Vanilla implementation (file:line)
- `vanilla/js/views/prediction-ui.js:150-216` — `PMO_TYPE`, `parsePMO`
  (fail-soft null; accepts `{pmo_object}` alongside PMA keys OR a bare org
  object; one-level-deeper string nesting; requires exact type + named
  identity + governance object + present attestation) + `isSubAssetOf`
  (parent-prefix-plus-dot, case-insensitive, never throws).
- `:348-427` — scan refactor: `scanAssets()` core (same pages + same
  `get_objects` join — one paging loop, never two scans per entry),
  behavior-identical `scanPMAs()` wrapper, new `scanPMOs()` (orgs + per-org
  subCount/active/expired tallies via `settledOf`, scanned-range only).
- `:724-799` — `paintOrgs()` (Organization/Name/Markets/Active/Expired/
  Details; honest empty row) + `:902,920` single-scan call sites.
- `:958-1038` — `renderOrgDetail()` (identity/governance/attestation dl +
  child-PMA markets table + `#/assets/create?sub=PARENT` entry + back
  links); `:1040-1075` detail branch (non-PMA + PMO parse -> org view, else
  the existing not-a-pma error). textContent-only, 44px targets.
- `vanilla/js/views/asset-ui.js:42-97` — `feeTierForSymbol` (3->symbol3,
  4->symbol4, 5+->long_symbol on the FULL symbol incl. dots; <3 -> null),
  value-copied `isSubAssetOf` (OP_NAMES precedent, documented), blank
  `pmoTemplate()`, `hashSubParent()` (`?sub=` from location.hash — the
  router strips queries before matching, so the view reads the hash itself).
- `:300-375` — tier line under the symbol field (tier name paints sync from
  input; schedule param joins gen-guarded from `Asset.feeSchedule` op-10
  row, scaled human via `Format.formatAmount` — money math via format.js
  only) + no-discount note + `Prefill PMO template` button + `?sub=PARENT.`
  symbol prefill. `:428-439` — confirm-time tier row beside the live
  `get_required_fees` fee (tier name + which param applied).
- i18n: 23 keys via `t()` (15 `prediction.pmo_*` + 8 `asset.*tier*/prefill/
  pmo_template_hint/sub_symbol_hint`) + all 10 dicts (en real, 9 stubs
  en-identical per batch precedent). My 23 verified present + defaults
  byte-equal; `check_i18n` redness this round is the parallel portfolio
  session's 16 mid-work keys (prediction.active/expired/my/refresh/…),
  none mine.

### Test vectors (`tooling/pmo-fee-tier-test.js` 53/53 GREEN, committed)
- parsePMO valid (nested alongside main / bare org / doubly-nested string /
  minimal with empty optionals), missing (empty/null/plain-text/PMA-desc ->
  null), invalid (bad JSON/array/wrong tag/nameless/blank-name/no
  governance/no attestation/non-object pmo_object -> null).
- Tier boundaries: 3->symbol3, 4->symbol4, 5->long_symbol, dotted
  `ORG.MARKET1` by full length, len<3/empty -> null, trim+upper.
- isSubAssetOf x2 homes (asset+prediction agree): child/grandchild true,
  self/bare/prefix-without-dot/trailing-dot/empty false, case-insensitive.
- Template round-trip (blank NOT an org; completed parses) + Format money
  (`200000000` p5 -> `2000.00000`, `2000000000` -> `20000.00000`).
- `node --check` clean (both views + test), `check_rot` PASS, parallel
  `prediction-prob-test.js` still 48/48 (helpers untouched), `Math.pow(10`
  outside format.js empty. `check_types` errors this round are the parallel
  session's portfolio seam only (prediction-ui.js:906/911); none in PMO/tier
  code. Tester pass queued (org list/detail, tier line + confirm row,
  ?sub= prefill, trio + phone/desktop).

### Anti-rot gate (§4.5): (a) yes — static + existing Chain/Explorer/Asset/
  feeSchedule reuse, zero new deps, no new WS surface; (b) nothing new
  depended on (schedule miss leaves the tier-only line; scan bound is the
  honest scope); (c) smallest deletable: org detail branch (list tallies
  stand). `check_rot.py` PASS.
