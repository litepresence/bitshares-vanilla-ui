# Op-Coverage Matrix — #1 routes/modals × #2 pages × vanilla routes

> Proof that every ref-UI page AND every astro-ui page is ported.
> Method: (1) all `<Route>` paths + components extracted from
> `bitshares-ui/app/App.jsx:502-651` (37 route entries + `*`);
> all 27 `app/components/Modal/` files + `TransactionConfirm`/`WalletUnlockModal`/`GatewaySelectorModal`;
> (2) all 74 `.astro` files in `astro-ui/src/pages/` + README op list
> (`astro-ui/README.md:18-68`, ~60 ops); (3) all 59 entries in
> `vanilla/js/router.js:110-170`.
> Statuses: PORTED (dedicated vanilla view wired in router) ·
> STUB (vanilla `placeholder()` route — cited) ·
> DEFERRED (reason given) · MISSING (must stay zero unjustified).
> Reference HEADs: bitshares-ui `79f8cca`, astro-ui `5037d61`,
> wallet-extension `ebb7451`, bitshares-core `fe7000c`. Written 2026-09-27.

## A. Reference #1 routes → #2 page → vanilla route

| # | #1 route → component (App.jsx) | #2 page / component | Vanilla route (router.js) → status |
|---|---|---|---|
| A1 | `/` → DashboardPage (:503) | index.astro + Home.jsx | `/` (:111) → PORTED (slice-05/07; documented deviation: redirects to last/default market desk with link, no blank page) |
| A2 | `/account/:account_name` → AccountPage (:510) | balances, recent-activity, open-orders, call-orders.astro | `/account/:account_name` (:112) → PORTED (slice-03: balances, open orders, history, 22 live vectors; +2026-09-29 G6 public-first lookup, any account opens locked — account-ui.js:572) |
| A3 | `/accounts` → DashboardAccountsOnly (:512) | — (no equiv) | `/accounts` (:113) → PORTED (`accounts-ui.js`: wallet card + lookup + manage links) |
| A4 | `/market/:marketID` → Exchange (:516) | dex.astro | `/market/:marketID` (:114) → PORTED (slices 05–07: book, charts, 25 indicators, trading; +2026-09-29 typed-account My fills/orders preview locked, logged-out quote panels, equal 2x3, overlay mesh, feed/settlement strip reads-only — market-desk.js:702,1230; market-ind.js:352,975; trade-form.js:389; desk-grid.css:51) |
| A5 | `/credit-offer` → CreditOfferPage (:520) | offers, offer, lend.astro | `/credit-offer` (:116) + `/credit-offer/:id` (:115) → PORTED (slice-13: offer 1.21.43 → deals 1.22.70/71) |
| A6 | `/settings`, `/settings/:tab` (:524–528) | nodes, theme, visuals, page_themes.astro | `/settings`, `/settings/:tab` (:118–119) → PORTED (slice-01 nodes/latency/testnet; slice-17 switcher; 3 themes) |
| A7 | `/invoice/:data` → Invoice (:529) | create_invoice, pay_invoice, stored_invoices, invoice_inventory.astro | `/invoice/:data` (:120) + `/invoice` (:121) → PORTED (slice-14 MiscUI) |
| A8 | `/deposit-withdraw` (:533) | — (no astro equiv; gateway bridge) | `/deposit-withdraw` (:130) + `/:gateway` (:129) → PORTED (slice-15: XBTSX/IOB live, GDEX manual-only, BIT20 disabled) |
| A9 | `/create-account` → LoginSelector (:538) | create_account.astro | `/create-account` (:131) → PORTED (`create-account-ui.js`: availability + brainkey + faucet register + verify) |
| A10 | `/login` → Login (:542) | change_password.astro (partial) | `/login` (:132) → PORTED (`auth-ui.js`: unlock form + links) |
| A11 | `/registration` → RegistrationSelector (:543) | create_account.astro | `/registration` (:133) → PORTED (`auth-ui.js` hub) |
| A12 | `/registration/local` → WalletRegistration (:548) | — | `/registration/local` (:134) → PORTED (`auth-ui.js` → `#/create-wallet-brainkey`) |
| A13 | `/registration/cloud` → AccountRegistration (:553) | create_account.astro | `/registration/cloud` (:135) → PORTED (`auth-ui.js` → `#/create-account`) |
| A14 | `/news` → News (:558) | — | `/news` (:136) → PORTED (`news-ui.js`: honest static, no fake feed) |
| A15 | `/voting` → redirect to `/account/:name/voting` (:559) | vote, governance, witnesses, committee, committee_parameters.astro | `/voting` (:137) → PORTED (slice-08: lists, proxy, slates, op-6 proven blocks 100916767/68; caveat: witness/committee create/update signing not yet — vote slate is) |
| A16 | `/explorer`, `/explorer/:tab` (:566–570) | explorer.astro | `/explorer`, `/explorer/:tab` (:138–139) → PORTED (slice-09) |
| A17 | `/asset/:symbol` → Asset (:571) | smartcoin, smartcoins, issued_assets.astro | `/asset/:symbol` (:140) → PORTED (slice-09/10) |
| A18 | `/block/:height` → Block (:575) | blocks.astro | `/block/:height` (:141) → PORTED (slice-09, fixtures 100916767/68) |
| A19 | `/block/:height/:txIndex` → Block (:580) | blocks.astro | `/block/:height/:txIndex` (:142) → PORTED (slice-09) |
| A20 | `/borrow` → Borrow showcase (:585) | borrow.astro | `/borrow` (:143) → PORTED (slice-13 BorrowUI: margin positions, call orders, settle op-17) |
| A21 | `/barter` → Barter (:587) | barter.astro | `/barter` (:144) → PORTED (slice-13/14: op-22 PROPOSE proven 1.10.1491) |
| A22 | `/direct-debit` → DirectDebit (:588) | withdraw_permissions.astro | `/direct-debit` (:145) → PORTED (slice-11: debit 1.12.139 full lifecycle) |
| A23 | `/spotlight` → ShowcaseGrid (:593) | featured.astro | `/spotlight` (:146) → PORTED (slice-11 DebitUI.renderSpotlight) |
| A24 | `/wallet` → WalletManager (:599) | — (astro outsources to Beet; local keystore is #1-only) | `/wallet` (:149) → PORTED (slice-02: PBKDF2-600k/AES-GCM, auto-lock, backup) |
| A25 | `/create-wallet-brainkey` (:603) | — | `/create-wallet-brainkey` (:150) → PORTED (slice-02: classic brainkey, 49,744-word dict) |
| A26 | `/existing-account` (:607) | — | `/existing-account` (:151) → PORTED (slice-02: import/look-ahead discovery) |
| A27 | `/create-worker` → CreateWorker (:612) | create_worker.astro | `/create-worker` (:152) → PORTED (`create-worker-ui.js` + op-34 serializer, broadcast wired) |
| A28 | `/help` + 3 nested `:path` routes (:618–633) | forum.astro (docs-adjacent) | `/help/**` (:153) → PORTED (`help-ui.js`: 20-topic index) |
| A29 | `/htlc` → Htlc showcase (:634) | htlc.astro | `/htlc` (:155) + `/htlc/:id` (:154) → PORTED (slice-11: HTLC 1.16.621–625 lifecycle) |
| A30 | `/prediction` (+`/:market` per §6) (:635) | — (no astro page; README-level only) | `/prediction` (:156) + `/prediction/:market` (:157) → PORTED (`prediction-ui.js`: PMA scan + detail + desk links) |
| A31 | `/instant-trade` + `/:marketID` (:639–648) | instant_trade.astro | `/instant-trade` (:158) + `/instant-trade/:marketID` (:159) → PORTED (`instant-trade-ui.js`: simple buy/sell via op-1) |
| A32 | `/pools` → PoolmartPage (:649) | pools, stake, top-pools, custom_pool_overview, custom_pool_tracker.astro | `/pools` (:161) + `/pools/:id` (:160) + `/swap` (:162) → PORTED (slice-12: ops 59–63/75, lifecycles 1.19.66/67; +2026-09-29 pool provenance map reads-only + typed-account swap preview — pool-graph.js:93, pool-detail-ui.js:975) |
| A33 | `*` → Page404 (:650) | — | `*` (:169) → PORTED (render404 + dashboard link, router.js:54–60) |

## B. Reference #1 modals/transaction UX (27 Modal files + shell widgets)

| # | #1 modal (components/Modal/ + shell) | #2 equiv | Vanilla → status |
|---|---|---|---|
| B1 | SendModal.jsx (transfer confirm) | Transfer.jsx | transfer-confirm.js → PORTED (slice-04: human-readable confirm, memo, fee-fill; +2026-09-29 G7 locked memo excluded from confirm — transfer-ui.js:485) |
| B2 | BorrowModal.jsx | CreditBorrow.jsx | BorrowUI → PORTED (slice-13) |
| B3 | HtlcModal.jsx | HtlcCreateDialog.jsx | HtlcUI → PORTED (slice-11) |
| B4 | DirectDebitModal.jsx + DirectDebitClaimModal.jsx | WithdrawPermissions.jsx | DebitUI → PORTED (slice-11) |
| B5 | CreatePoolModal + DeletePoolModal + PoolStakeModal + PoolExchangeModal.jsx | CreatePool + PoolStake + SimpleSwap.jsx | PoolUI/PoolSwapUI → PORTED (slice-12) |
| B6 | IssueModal + ReserveAssetModal + SettleModal.jsx | — | AssetManageUI/AssetFeedUI → PORTED (slice-10) |
| B7 | ProposalModal.jsx | Proposals.jsx | ProposalUI → PORTED (slice-14: props 1.10.1488/89/91) |
| B8 | DepositModal + WithdrawModalNew.jsx | WithdrawDialog.jsx | GatewayUI → PORTED (slice-15; withdraw = transfer-prefill delegation) |
| B9 | JoinWitnessesModal + JoinCommitteeModal.jsx | WitnessCommittee.jsx | VoteUI → PORTED (slice-08; see A15 caveat) |
| B10 | CreateLockModal.jsx (vesting lock) | CreateVestingBalance.jsx | VestingUI → PORTED (slice-14) |
| B11 | SetDefaultFeeAssetModal.jsx | — | PORTED (fee-asset selection, slices 04/10 via get_required_fees) |
| B12 | QrcodeModal.jsx | InvoiceCreator.jsx | MiscUI invoice → PORTED (slice-14) |
| B13 | View/* (op/JSON inspect) | Explorer.jsx | explorer op view (op enum 0–77 + space tables) → PORTED (slice-09) |
| B14 | TransactionConfirm (Blockchain/) | 78-op table (popup.js, ref #3) | transfer-confirm.js + per-op confirms → PORTED (slices 04, 06, 08, 10–14) |
| B15 | WalletUnlockModal (Wallet/) | — (Beet outsourced) | WalletUI unlock/auto-lock → PORTED (slice-02) |
| B16 | GatewaySelectorModal (Gateways/) | — | GatewayUI desk → PORTED (slice-15) |
| B17 | ChoiceModal.js (generic confirm) | ui/dialog.jsx | generic inline-confirm pattern → PORTED (used slices 06, 12, 13) |
| B18 | BrowserSupportModal.jsx | — | DEFERRED: evergreen-browser assumption documented; no modal needed (reason: dead-browser warning adds no wallet function) |
| B19 | ReportModal.jsx (issue reporter) | — | DEFERRED: points at GitHub issues; out of wallet scope (reason: not a chain/wallet function) |

## C. Astro-only pages (no #1 route) → vanilla route

| # | Astro page(s) | Op / feature (README:18–68) | Vanilla route → status |
|---|---|---|---|
| C1 | balances, recent-activity, open-orders, call-orders.astro | portfolio / activity / open orders | merged in A2 → PORTED (slice-03) |
| C2 | top-markets.astro | 24hr trading rankings | market picker + ticker stats → PORTED (slice-05) |
| C3 | top-operations.astro | most-used ops stats | DEFERRED: ranked op-count stats panel (reason: op browser + enum tables PORTED slice-09; ranking is analytics, not wallet function; tracked) |
| C4 | top-pools.astro | most active pools | merged in A32 → PORTED (slice-12) |
| C5 | order.astro | limit-order form | trade form → PORTED (slice-06: limit, FoK, scaled N=2–20) |
| C6 | tfunds, tfund_user.astro | Same-T funds create/update/delete | `/samet` (:117) → PORTED (slice-13: funds 1.20.29/30) |
| C7 | deals, edit_deal.astro | credit deals overview/edit | `/credit-offer/:id` (:115) → PORTED (slice-13) |
| C8 | create_pool.astro | create liquidity pools | pool create in PoolUI → PORTED (slice-12, op-59 proven) |
| C9 | stake.astro | pool staking | `/pools` + `/swap` → PORTED (slice-12) |
| C10 | custom_pool_overview, custom_pool_tracker.astro | featured pool tracker | `/pools/:id` (:160) → PORTED (slice-12; personal tracker = detail + favourites) |
| C11 | proposals.astro | proposals approve/reject + create for all ops | `/proposals` (:123) + `/proposals/:id` (:122) → PORTED (slice-14) |
| C12 | vesting.astro, create_vesting.astro | claim/create vesting | `/vesting` (:125) → PORTED (slice-14) |
| C13 | custom_authorities.astro | create/manage custom authorities | `/authorities` (:126) → PORTED (slice-14: authority 1.17.4) |
| C14 | account_lists.astro | allow/block lists | `/lists` (:127) → PORTED (slice-14, incl. blocked-users management in Lists view) |
| C15 | blocked-users.astro | block accounts from UX | merged in C14 → PORTED (slice-14) |
| C16 | airdrop_calculate.astro | large-scale airdrops | `/airdrop` (:128) → PORTED view (slice-14; broadcast path via propose flow) |
| C17 | create_uia, create_smartcoin, smartcoin, smartcoins, issued_assets, publish_feed.astro | UIA/smartcoin/NFT/PMA create/update + feeds | `/assets` (:164), `/assets/create` (:165), `/assets/update/:symbol` (:166), `/assets/issue` (:167), `/assets/feed` (:168), `/asset/:symbol` → PORTED (slice-10: AFKTEST10/M11 lifecycles; +2026-09-29 G1 asset-create previewable locked, explicit issuer input 1.2.0 default, sign still gates at publish — asset-ui.js:183, asset-manage-ui.js:256) |
| C18 | create_ticket, ticket_leaderboard.astro | vote-lock tickets + leaderboard | `/tickets` (:124) → PORTED view (slice-14; caveat CLOSED: create→update PROVEN on throwaway afk-tkt-75a7 (ticket 1.18.61, blocks 100943508/509)) |
| C19 | vote, governance, witnesses, committee, committee_parameters.astro | witnesses/committee lists, proxy, voting | merged in A15 → PORTED (slice-08; see A15 caveat) |
| C20 | explorer, blocks.astro | chain explorer | merged in A16/A18 → PORTED (slice-09) |
| C21 | transfer.astro | transfer + memo | `/transfer` (:148) + `/transfer/:to` (:147) → PORTED (slice-04: 2 testnet broadcasts; +2026-09-29 locked preview path, G7 memo excluded locked — transfer-ui.js:485) |
| C22 | create_invoice, pay_invoice, stored_invoices, invoice_inventory.astro | invoices | merged in A7 → PORTED (slice-14) |
| C23 | blind_transfers.astro | blind transfers | DEFERRED (reason: slice-14 honest downscope — commitments + bulletproofs + stealth ECDH have no auditable vanilla source; tracked, never silently half-ported) |
| C24 | timed_transfer.astro | delayed transfers | PORTED via `/proposals` generic propose flow (slice-14; note: no dedicated prefill — propose-a-transfer covers the chain path) |
| C25 | withdraw_permissions.astro | direct debit | merged in A22 → PORTED (slice-11) |
| C26 | settlement.astro | force-settlement (op-17) | PORTED via `/borrow` + asset ops (slice-10/13; asset_settle op-17 serializer slice-14) |
| C27 | settlement_bids.astro | collateral bidding (op-45 bid_collateral; 46 is VIRTUAL execute_bid) | PORTED (op-45 serializer + `#/borrow` settlement-bid section; broadcast tester-queued) |
| C28 | borrow, lend.astro | borrow/lend | merged in A20/A5 → PORTED (slice-13) |
| C29 | ltm.astro | lifetime membership (op-8 account_upgrade) | PORTED (op-8 serializer + Membership section on account view; broadcast tester-queued) |
| C30 | monthly_referrer.astro | referrer stats (read-only) | PORTED (`#/referrals`: registrar/referrer/splits/vesting; counts honestly absent) |
| C31 | network_fees.astro | fee schedule display | PORTED (`#/fees`: standalone feeSection reuse) |
| C32 | nodes.astro | node connections | merged in A6 → PORTED (slice-01) |
| C33 | theme, visuals, page_themes.astro | theme config | merged in A6 → PORTED (themes.css 3-theme switch, slice-01/17) |
| C34 | change_password.astro | keystore password change | PORTED (`#/wallet/password`: verify + re-encrypt + proof) |
| C35 | favourites.astro | favourite assets/accounts/markets | PORTED (`#/favourites` dashboard) |
| C36 | forum, forum_thread.astro | docs/forum mirror | DEFERRED (reason: external community forum, not a wallet function; same class as ReportModal) |
| C37 | trollbox.astro | deprecated chat | DEFERRED (reason: dead chat widget, not a wallet function) |
| C38 | featured.astro | featured pools | merged in A23 → PORTED (slice-11) |
| C39 | create_account, create_worker, instant_trade, htlc, barter, debt pages | (dupes of A-rows) | merged in A9/A27/A31/A29/A21/A22 → status per A-row |
| C40 | swap.astro | pool swaps | `/swap` (:162) → PORTED (slice-12) |
| C41 | governance-adjacent: committee.astro, witnesses.astro | status lists | merged in A15/C19 → PORTED view (slice-08) |

## D. Explicitly out-of-scope (not MISSING — decided, with reason)

| # | Item | Reason |
|---|---|---|
| D1 | Historic gateways (RuDEX/Citadel/BlockTrades/…) | Out of business; SCOPE directive 2026-09-28: XBTSX/BIT20/GDEX/IOB only (slice-15) |
| D2 | GDEX auto-provisioning / BIT20 auto-rates | GDEX DNS-dead → honest manual-only panel; BIT20 gateway-less → disabled (slice-15) |
| D3 | Extension-wrapper adapter | Post-v1 hardening by design, never a v1 dependency (SLICES.md) |
| D4 | dApp provider bridge (window.beet compat) | Out of v1 scope; if ever added, copies ref-#3 permission patterns |
| D5 | TradingView charting_library | Proprietary; replaced by vendored lightweight-charts + canvas (SLICES.md charting decision) |
| D6 | Virtual ops 51/53 (expiry events), op-74 virtual | Never signed by construction (slices 11/14) |
| D7 | Blind-transfer crypto (39–42) companions | Same as C23 — no silent half-port |

## Counts

- Section A (#1 routes): 33 rows — PORTED 33, STUB 0, DEFERRED 0, MISSING 0.
- Section B (#1 modals/widgets): 19 rows — PORTED 17, DEFERRED 2 (B18 browser warning, B19 issue reporter), MISSING 0.
- Section C (astro-only pages): 41 rows = 20 PORTED substantive + 11 merge-pointers to §A rows (C1, C19, C20, C22, C25, C28, C32, C33, C38, C39, C41) + 10 DEFERRED (C3 top-ops stats, C23 blind, C27 bid_collateral, C29 LTM op-8, C30 referrer display, C31 fee-schedule table, C34 password change, C35 favourites dashboard, C36 forum, C37 trollbox — all reasoned), MISSING 0.
- Section D (out-of-scope, decided): 7 items, all with standing-directive reasons.
- **MISSING (unjustified): 0.** Every App.jsx route has a row in §A; every astro page has a row in §A or §C; every vanilla router entry maps to a row above. Former STUB routes (A3, A9–A14, A27, A28, A30, A31) all built out in stub batches 1–3 + op-34; no placeholders remain in §A. DEFERRED items each carry a reason + tracking note (C18 tickets PROVEN on-chain, throwaway-funded).

## Nightly delta (2026-09-29) — previews, pool map, mesh (no new ops)

> Append-only note for the 2026-09-28→29 round (`01f0edf..d5d61de`, 30 commits).
> Convention: this section records behavior deltas only; status cells above are
> updated in place where a row is affected. No row changes PORTED→STUB/MISSING
> tonight. Headless-only caveat: per `vanilla/notes/retro-evening-2026-09-29.md`
> honesty header, no human browser pass ran tonight; builder headless proof is
> `tooling/visual/shot.mjs` + `node --check` + `pool-graph-test.js` (11/11).
> Matrix author verified by `rg` in cited files, not by re-running the browser.

- Pool-connection provenance map (A32 detail enrichment, NO new ops): new
  `vanilla/js/pool-graph.js` reads `get_liquidity_pools_by_one_asset`
  (`pool-graph.js:93`, chain truth `pool-graph.js:10`) + in-memory BFS
  `findCorePath` (`pool-graph.js:163`) with L1_CAP 8 / L2 6×3 / NODE_CAP 25
  (`pool-graph.js:28,119-142`); lazily loaded by `pool-detail-ui.js:948-979`
  and `market-desk.js:1151-1212`, canvas draw at `pool-detail-ui.js:1005`.
  Vectors: `tooling/pool-graph-test.js` (11/11 per retro-evening note).
  Coverage: reads-only enrichment of the PORTED pool/market desks; op set
  unchanged (59–63/75 per A32).
- Overlay mesh (A4 enrichment, NO new ops, same fns): meshable price overlays
  with one adjustable number each (`market-ind.js:352`), legacy single-checkbox
  rows kept (`market-ind.js:395-399`), per-instance period chips
  (`market-ind.js:975-977,1041`). Same indicator fns, new multi-instance UI only.
- Unlock previews — same ops, new logged-out paths (rows A2/A4/A32/B1/C17/C21
  annotated above): G1 asset-create previewable locked with explicit issuer
  input 1.2.0 default, sign still gates at publish (`asset-ui.js:183`,
  `asset-manage-ui.js:256,301-312`); typed-account previews for My
  orders/fills/exchanges via public `Account.history` (`market-desk.js`
  `renderMyTrades` typed input + `pairFills` op-4 filter, commits `0835586`,
  `3d64efd`); G6 public-first account lookup (`account-ui.js:572`); G7 locked
  memo excluded from confirm (`transfer-ui.js:485`); G8 pointer to public
  lookup (`accounts-ui.js:122`). Honest boundary: code labels verified are
  G1/G6/G7/G8 only — G2–G5 labels do not exist in-repo
  (`retro-evening-2026-09-29.md:287-292`); no G2–G5 coverage claimed.
- Quote panels + equal 2x3 (A4 layout, SAME op-1 path): locked quote panels
  with live three-way wiring + fee preview line (`trade-form.js:389-398,424-434,
  505-509`), i18n keys for locked panel (`b2c7cfb`), retro equal 2x3 grid
  buy/sell/trades over bids/asks/orders (`desk-grid.css:51-59`, commit `cff7028`).
  Signing still gates at review (`47a30bb` "unlock only at review").
- Settlement/feed strip cells (A4 reads-only): strip feed + settlement via one
  lookup + `get_objects → current_feed.settlement_price` with BOTH precisions
  (`market-desk.js:702,1230-1323`); globally-settled fund display same object,
  zero extra calls (`market-desk.js:1239-1240`). No serializer touched.
- Storage seam (NO coverage change): `Store.backend {get,set,del}` with
  localStorage default (`store.js:4-5,46,76-94,220`); reads/writes routed
  through backend, commit `f3d52f8`. No route/op affected.
- Extension scaffold (OUT-OF-MATRIX, separate track): `extension-wrapper/`
  Tier-1 scaffold (`adapter/bridge.js`, `adapter/storage.js`,
  `background/sw.js`, `content/inject.js`, manifests) explicitly UNVERIFIED
  IN-BROWSER per `extension-wrapper/TEST-PLAN.md:1` and commit `afc65dd`.
  Not a §D item (D3 remains the deferred wrapper adapter); no matrix row
  claims it. Track in TEST-PLAN.md, not here.
- Serializers untouched (verified 2026-09-29): `git diff 01f0edf..d5d61de
  --name-only` shows no `vanilla/js/tx.js`, no `asset-ops.js`/`tx-send.js`/
  `ops-ui.js`; last `tx.js` change is `2c2809d` (pre-round). Op builders
  unchanged, so op-10 (C17) / op-1 (A4/C21) / op-4 (A4 fills) deltas above are
  preview/read paths only — same ops, same serializers.
- Counts tonight: §A 33 PORTED / §B 17 PORTED + 2 DEFERRED / §C 20 substantive
  PORTED + 11 merge-pointers + 10 DEFERRED / §D 7 — unchanged from pre-round.
  MISSING (unjustified): still 0. Nothing got WORSE; newly uncertain: locked
  preview UX is headless-only until the human browser pass (not a coverage
  regression, a verification gap — noted, not hidden).
