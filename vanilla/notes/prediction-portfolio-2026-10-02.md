# Prediction portfolio delta — 2026-10-02 (PnL + settle + filtered views + countdown/refresh)

> Append-only delta for the prediction-portfolio task (code-live, tester-queued
> for live broadcast). No placeholder, no fabricated inclusion.

## 1. Reference behavior (file:line)

- #1 list concepts only: `PredictionMarkets.jsx:368-419` open/past filter +
  search, `:492-618` overview + OverviewTable columns; opinions are orderbook
  rows `:104-160` (NOT copied — detail links to the live desk); resolve =
  global_settle `:341-372` (issuer-only, lives in AssetManage, NOT reimplemented
  here). Filter truth `PredictionMarkets.jsx:415-421`: `settlement_fund>0 ||
  resolutionDate<now` => past; `_filterMarkets` open/past. Validity bar
  `:75-102` (valid-date + description lengths + market fee <10%).
- #1 settled heuristic: `Asset.jsx:815` + `:2258` `settlement_fund>0`,
  `SettleModal.jsx:241` same, `BorrowModal.jsx:607` PMA guard. All fund-only.
- #2 modern: `Smartcoins.jsx:221-228` settled = price legs nonzero AND fund
  nonzero (mirrors core `is_globally_settled`); ticker/book reads for
  probability (mid preferred, last fallback).
- #3 confirm wording: `popup.js` 78-op table is the confirm-dialog spec
  (field-level parity for the op-17 settle confirm); `bitshares-api.js`
  `:2583-2590` serializeAssetSettleOp order, `:761-788` getRequiredFee,
  `:885-920` buildTransaction envelope.
- #4 ground truth (wins every conflict): `is_globally_settled() =
  !settlement_price.is_null()` <- `chain/asset_object.hpp:299`
  (price object, both legs nonzero); op-17 fields
  (fee)(account)(amount)(extensions) <- `protocol/asset_ops.hpp:267-288` +
  FC `:719`; fill legs pays/receives/fill_price <- `protocol/market.hpp:206-220`
  + FC `:305-306`; reads `list_assets`/`get_objects`/`get_account_balances`/
  `get_assets`/`get_account_history`/`get_ticker`/`get_required_fees`/
  `broadcast_transaction_with_callback` <- `database_api.hpp` (`:460-461`
  by-issuer, `:444` lookup, `:618` ticker, `:636` book, `:1313` fees) +
  `api.hpp:360` broadcast. #1 fund-only vs #2 price+fund vs #4 price-only:
  #4 wins — vanilla uses price null-check primary, fund>0 corroborating OR
  (a settled market has both; a node omitting one leg must not hide it).

## 2. Vanilla implementation (file:line)

- `vanilla/js/api/prediction.js` (new, 267 lines): `isSettledBitasset`
  (price null-check + fund OR), `classifyStatus` (settled wins, expired =
  past+unsettled, boundary expiry==now stays active), `sortClosingSoon`
  (missing last, input untouched), `countdownParts`/`countdownText` (pure
  time math, deterministic shaping), `costBasisFromFills` (fill-only sums,
  mixed-asset flagged, net<=0 => zero-cost, non-fills skipped).
- `vanilla/js/api/format.js`: +`costForHolding` (holding*paid/received floor,
  zero-received => "0"), +`valueFromFeedRaw` (holding*quote/base, precisions
  cancel), +`valueFromMidHuman` (holding*num*10^q/(den*10^p) via
  parsePriceRatio), +`pnlRaw` (current-cost-fee signed). All BigInt, never float.
- `vanilla/js/views/prediction-ui.js`: `settledOf` now delegates to
  `Prediction.isSettledBitasset` (fund fallback); `statusOf`/`expiryCellText`
  helpers; `appendRow` handles active/expired/my + countdown cell;
  `filterSel` Active/Expired/My/Open/Settled/All (default Active);
  `Refresh` re-runs `scanPMOs` with loading state + enrich reset + portfolio
  rescan; `myState`/`ensureMy` wallet join (balances+issuedBy PMA-only,
  pruned to scan, locked stays empty honest); Portfolio section (viewing-as
  1.2.0 while locked, account input blank=wallet, Load, holdings joined to
  scan, historyPaged cost replay, ticker-mid else settlement/feed current,
  human terms with raw titles, phone cards, settle per settled holding via
  `AssetOps.buildSettle` + `AssetOps.fee` + `Tx.buildTx` +
  `AssetOps.sendAndProve` with balances re-read proof, unlock-at-sign).
- `vanilla/js/api/prediction.js` loaded via `index.html` before
  `prediction-ui.js`; `globals.d.ts` declares `Prediction`.
- i18n: 27 new `prediction.*` keys x10 dicts via
  `tooling/sync_prediction_portfolio_i18n.py` (stubs honest, es non-allowlisted
  == en); generic words reuse `borrow.*`/`confirm.*` (no drift).

## 3. Manual test steps + observed result (testnet)

Status: CODE-LIVE, TESTER-QUEUED — no live broadcast claimed (no holder
fixture funds spent, never fabricated).

Tester-queued steps (testnet, holder fixture required):
1. Serve `python3 -m http.server 8080 --directory vanilla`, open
   `#/prediction`, observe Active default (closing-soon sort, countdowns like
   "2026-… (2d 3h)"), switch to Expired/My/All, press Refresh (loading state,
   rescan).
2. Portfolio: enter a PMA-holder account (or blank = wallet when unlocked),
   Load portfolio, observe holdings joined to scan (Balance human + raw title,
   Avg cost backing per PMA, Current with (settlement|mid|feed) source, PnL
   +raw with profit/loss class, phone cards). Zero-cost holdings show
   "zero-cost (no fills)"; mixed show "mixed cost assets"; no price shows
   "no price".
3. Settle (settled-market holding ONLY, holder fixture): press Settle, Review
   (fee via get_required_fees, named rows Account/Asset/Amount/Fee/Network),
   unlock at Sign & Send when locked, broadcast, observe "Settle broadcast."
   + head block + via. Verify on-chain via balances re-read (holding reduced)
   + history op-17. Do NOT rebroadcast on timeout — check state first.
4. My filter while locked => honest locked hint, 0 rows; unlocked => wallet
   created-or-held PMAs only.

Observed (builder, offline): `prediction-portfolio-test.js` 55/55;
`node --check` clean (prediction.js/format.js/prediction-ui.js);
`check_rot.py` PASS; `check_i18n.py` OK (2922 keys, 3930 sites);
`check_types.sh` PASS. No socket, no keys, no broadcast attempted.

## 4. Raw→human vectors (every displayed number)

From `tooling/prediction-portfolio-test.js` (55 asserts, all via Format):

- Long profit (p4 PMA / p5 TEST): holding `10000` (1.0000), bought 2 for
  `100000` (1.00000) => cost `50000` (0.50000); feed base `10000` quote
  `100000` => current `100000`; PnL `50000` => `0.50000 TEST`.
- Short loss: cost `100000`, current `50000` => PnL `-50000` => `-0.50000`.
- Zero-cost: received `0` => cost `0`; current `100000` => PnL `100000`.
- Worthless: current `0`, cost `50000` => PnL `-50000`.
- Fee-aware: `100000-50000-10000` => `40000` => `0.40000`.
- Mid-human: `10000 @p4` x `0.95` (backing @p5) => `95000`; `1` => `100000`.
- Avg per-unit: `formatPrice(100000 @p5, 20000 @p4)` => `0.50000000` backing/PMA.
- Status: future+unsettled active; past+unsettled expired; settled wins;
  boundary expiry==now active; missing/bad expiry active unless settled.
- Countdown: none/bad => "No expiry"; now => "Closes now"; 90s => "1m 30s";
  3700s => "1h 1m"; 25h => "1d 1h"; 10s => "10s"; 2d past => "Expired 2d ago".
- Non-BTS precisions throughout (p4/p5); percent field analogue: likelihood
  stays existing `Number*100` display (not chain hundredths — no raw percent
  on screen).

## 5. Themes + viewports

Tester-queued (human browser pass stays the gate): verify trio
ref-ui-theme / vanilla-ui-theme / dex-ux-theme + 360–390px phone (cards,
44px targets, no hover-only) AND 1440px desktop (table uses width) for
list + portfolio + settle confirm. Builder headless proof is the committed
suite + type/rot/i18n gates above; no screenshots fabricated.

## 6. Module headers + function descriptions

`prediction.js` header owns/consumes/side-effects/origin + #4 citations;
every non-trivial function documents what/params/returns/failure-modes.
`format.js` additions carry the same. `prediction-ui.js` portfolio/settle
helpers carry WHY (borrow-pattern mirror, public-first, code-live proof).
No TODO/FIXME/XXX/HACK (grep clean). `prediction.js` 267 lines, single
purpose (pure PMA math).

## 7. Anti-rot gate (AGENTS.md §4.5)

- (a) Ten-year test: zero runtime deps (stdlib only, no npm, no CDN, no
  framework, no build step — `python3 -m http.server` serves). Time math uses
  Date (platform, decades-stable); money uses BigInt + string ops (platform).
  Deleting `prediction.js` loses portfolio math, never the list (guarded
  fallbacks).
- (b) Newly depended on: NOTHING (no package, service, toolchain, hosted
  asset). Chain surface reused only pre-existing WS methods
  (list_assets/get_objects/get_account_balances/get_assets/get_account_history/
  get_ticker/get_required_fees/broadcast + dynamic props for head block).
  Fee asset stays 1.3.0 deferred (noted in confirm). Vendoring: none.
- (c) Smallest deletable subset: portfolio + settle + My/Active/Expired +
  countdown/Refresh could be deleted leaving the prior open/settled list
  byte-identical (settledOf fallback, paint default, toolbar options). Kept
  because the task requires them; nothing else was added.

Broadcast-or-queued: QUEUED (code-live, tester-queued steps above; zero
testnet spends this round).
