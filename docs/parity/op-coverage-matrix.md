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
| A1 | `/` → DashboardPage (:503) | index.astro + Home.jsx | `/` (:111) → PORTED (slice-05/07; documented deviation: redirects to last/default market desk with link, no blank page; 2026-10-01 Option-B splash: locked visitors get landing — hero motto + live strip + 5-call chain pulse + top-market row + cards/trust/steps/CTA — unlocked path unchanged, §3.1 deviation in slice-01 delta) |
| A2 | `/account/:account_name` → AccountPage (:510) | balances, recent-activity, open-orders, call-orders.astro | `/account/:account_name` (:112) → PORTED (slice-03: balances, open orders, history, 22 live vectors; +2026-09-29 G6 public-first lookup, any account opens locked — account-ui.js:572) |
| A3 | `/accounts` → DashboardAccountsOnly (:512) | — (no equiv) | `/accounts` (:113) → PORTED (`accounts-ui.js`: wallet card + lookup + manage links) |
| A4 | `/market/:marketID` → Exchange (:516) | dex.astro | `/market/:marketID` (:114) → PORTED (slices 05–07: book, charts, 25 indicators, trading; +2026-09-29 typed-account My fills/orders preview locked, logged-out quote panels, equal 2x3, overlay mesh, feed/settlement strip reads-only — market-desk.js:702,1230; market-ind.js:352,975; trade-form.js:389; desk-grid.css:51; +2026-10-01 R1d offset estimate + R1e open-settle tab — market.js:settleOrders/sortSettles, market-orders.js tabs, market-desk.js:fetchFeed) |
| A5 | `/credit-offer` → CreditOfferPage (:520) | offers, offer, lend.astro | `/credit-offer` (:116) + `/credit-offer/:id` (:115) → PORTED (slice-13: offer 1.21.43 → deals 1.22.70/71) |
| A6 | `/settings`, `/settings/:tab` (:524–528) | nodes, theme, visuals, page_themes.astro | `/settings`, `/settings/:tab` (:118–119) → PORTED (slice-01 nodes/latency/testnet; slice-17 switcher; 3 themes) |
| A7 | `/invoice/:data` → Invoice (:529) | create_invoice, pay_invoice, stored_invoices, invoice_inventory.astro | `/invoice/:data` (:120) + `/invoice` (:121) → PORTED (slice-14 MiscUI) |
| A8 | `/deposit-withdraw` (:533) | — (no astro equiv; gateway bridge) | `/deposit-withdraw` (:130) + `/:gateway` (:129) → PORTED (slice-15: XBTSX/IOB live, GDEX manual-only, BTWTY disabled) |
| A9 | `/create-account` → LoginSelector (:538) | create_account.astro | `/create-account` (:131) → PORTED (`create-account-ui.js`: availability + brainkey + faucet register + verify) |
| A10 | `/login` → Login (:542) | change_password.astro (partial) | `/login` (:132) → PORTED (`auth-ui.js`: unlock form + links) |
| A11 | `/registration` → RegistrationSelector (:543) | create_account.astro | `/registration` (:133) → PORTED (`auth-ui.js` hub) |
| A12 | `/registration/local` → WalletRegistration (:548) | — | `/registration/local` (:134) → PORTED (`auth-ui.js` → `#/create-wallet-brainkey`) |
| A13 | `/registration/cloud` → AccountRegistration (:553) | create_account.astro | `/registration/cloud` (:135) → PORTED (`auth-ui.js` → `#/create-account`) |
| A14 | `/news` → News (:558) | — | `/news` (:136) → PORTED (`news-ui.js`: honest static, no fake feed) |
| A15 | `/voting` → redirect to `/account/:name/voting` (:559) | vote, governance, witnesses, committee, committee_parameters.astro | `/voting` (:137) → PORTED (slice-08: lists, proxy, slates, op-6 proven blocks 100916767/68; +ops 20/21/29/30 serializers live, testnet evaluator-reached at head 100989922 — full inclusion needs an LTM payer, vote slate is) |
| A16 | `/explorer`, `/explorer/:tab` (:566–570) | explorer.astro | `/explorer`, `/explorer/:tab` (:138–139) → PORTED (slice-09) |
| A17 | `/asset/:symbol` → Asset (:571) | smartcoin, smartcoins, issued_assets.astro | `/asset/:symbol` (:140) → PORTED (slice-09/10) |
| A18 | `/block/:height` → Block (:575) | blocks.astro | `/block/:height` (:141) → PORTED (slice-09, fixtures 100916767/68) |
| A19 | `/block/:height/:txIndex` → Block (:580) | blocks.astro | `/block/:height/:txIndex` (:142) → PORTED (slice-09) |
| A20 | `/borrow` → Borrow showcase (:585) | borrow.astro | `/borrow` (:143) → PORTED (slice-13 BorrowUI: margin positions, call orders, settle op-17; +2026-10-01 R1e CR column + bands + fee-asset deferred note — borrow-ui.js:previewRatio/posTable) |
| A21 | `/barter` → Barter (:587) | barter.astro | `/barter` (:144) → PORTED (slice-13/14: op-22 PROPOSE proven 1.10.1491) |
| A22 | `/direct-debit` → DirectDebit (:588) | withdraw_permissions.astro | `/direct-debit` (:145) → PORTED (slice-11: debit 1.12.139 full lifecycle) |
| A23 | `/spotlight` → ShowcaseGrid (:593) | featured.astro | `/spotlight` (:146) → PORTED (slice-11 DebitUI.renderSpotlight) |
| A24 | `/wallet` → WalletManager (:599) | — (astro outsources to Beet; local keystore is #1-only) | `/wallet` (:149) → PORTED (slice-02: PBKDF2-600k/AES-GCM, auto-lock, backup) |
| A25 | `/create-wallet-brainkey` (:603) | — | `/create-wallet-brainkey` (:150) → PORTED (slice-02: classic brainkey, 49,744-word dict) |
| A26 | `/existing-account` (:607) | — | `/existing-account` (:151) → PORTED (slice-02: import/look-ahead discovery) |
| A27 | `/create-worker` → CreateWorker (:612) | create_worker.astro | `/create-worker` (:152) → PORTED (`create-worker-ui.js` + op-34 serializer, broadcast wired) |
| A28 | `/help` + 3 nested `:path` routes (:618–633) | forum.astro (docs-adjacent) | `/help/**` (:153) → PORTED (`help-ui.js`: 20-topic index) |
| A29 | `/htlc` → Htlc showcase (:634) | htlc.astro | `/htlc` (:155) + `/htlc/:id` (:154) → PORTED (slice-11: HTLC 1.16.621–625 lifecycle) |
| A30 | `/prediction` (+`/:market` per §6) (:635) | — (no astro page; README-level only) | `/prediction` (:156) + `/prediction/:market` (:157) → PORTED (`prediction-ui.js`: PMA scan + detail + desk links; +2026-10-02 PMO org section/detail + fee-tier display — see slice-10 delta; +2026-10-02 portfolio PnL + op-17 settle + Active/Expired/My + countdown/Refresh — see prediction-portfolio delta) |
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
| B18 | BrowserSupportModal.jsx | — | PORTED as a dismissible feature-detected banner (R1c 2026-10-01: `compatMissing()` gates WebSocket/WebCrypto/BigInt/storage — never UA sniff, never a load gate; neutral copy + `#/help` link, dismissal in localStorage; #1's UA-sniff + Chrome upsell refused) |
| B19 | ReportModal.jsx (issue reporter) | — | DEFERRED: points at GitHub issues; out of wallet scope (reason: not a chain/wallet function) |

## C. Astro-only pages (no #1 route) → vanilla route

| # | Astro page(s) | Op / feature (README:18–68) | Vanilla route → status |
|---|---|---|---|
| C1 | balances, recent-activity, open-orders, call-orders.astro | portfolio / activity / open orders | merged in A2 → PORTED (slice-03) |
| C2 | top-markets.astro | 24hr trading rankings | market picker + ticker stats → PORTED (slice-05) |
| C3 | top-operations.astro | most-used ops stats | `/top-ops` → PORTED (R1c 2026-10-01: bounded N=200 chain-scan via Chain.db/call `get_block`, Type/Name/Count/Share table + hand-rolled SVG donut, Refresh, honest last-200 label + testnet-works note, `Format.pct1` shares; legacy `#/ops` N≤200 sample view retained) |
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
| C26 | settlement.astro | force-settlement (op-17) | PORTED via `/borrow` + asset ops (slice-10/13; asset_settle op-17 serializer slice-14; +2026-10-01 R1d settlement estimate: offset-adjusted feed via Format.settleEstimate, global fund>0 uses settlement_price — market-desk.js:fetchFeed, market-ind.js:renderStrip) |
| C27 | settlement_bids.astro | collateral bidding (op-45 bid_collateral; 46 is VIRTUAL execute_bid) | PORTED (op-45 serializer + `#/borrow` settlement-bid section; broadcast tester-queued; +2026-10-01 R1e open-settle tab: get_settle_orders(assetId,100) sorted by settlement_date — market.js:settleOrders/sortSettles, market-orders.js tabs) |
| C28 | borrow, lend.astro | borrow/lend | merged in A20/A5 → PORTED (slice-13) |
| C29 | ltm.astro | lifetime membership (op-8 account_upgrade) | PORTED (op-8 serializer + Membership section on account view; broadcast tester-queued) |
| C30 | monthly_referrer.astro | referrer stats (read-only) | PORTED (`#/referrals`: registrar/referrer/splits/vesting; counts honestly absent) |
| C31 | network_fees.astro | fee schedule display | PORTED (`#/fees`: standalone feeSection reuse) |
| C32 | nodes.astro | node connections | merged in A6 → PORTED (slice-01) |
| C33 | theme, visuals, page_themes.astro | theme config | merged in A6 → PORTED (themes.css 3-theme switch, slice-01/17) |
| C34 | change_password.astro | keystore password change | PORTED (`#/wallet/password`: verify + re-encrypt + proof) |
| C35 | favourites.astro | favourite assets/accounts/markets | PORTED (`#/favourites` dashboard) |
| C36 | forum, forum_thread.astro | docs/forum mirror | DEFERRED (reason: external community forum, not a wallet function; same class as ReportModal) |
| C37 | trollbox.astro | deprecated chat | `/trollbox` → PORTED (R1c 2026-10-01: reads via Chain.custom + 100/page pager, 9199-only post path, live inclusion tester-queued — see slice-14 delta; dex.trading restricts custom_operations reads, xbts.io plugin-open) |
| C38 | featured.astro | featured pools | merged in A23 → PORTED (slice-11) |
| C39 | create_account, create_worker, instant_trade, htlc, barter, debt pages | (dupes of A-rows) | merged in A9/A27/A31/A29/A21/A22 → status per A-row |
| C40 | swap.astro | pool swaps | `/swap` (:162) → PORTED (slice-12) |
| C41 | governance-adjacent: committee.astro, witnesses.astro | status lists | merged in A15/C19 → PORTED view (slice-08) |

## D. Explicitly out-of-scope (not MISSING — decided, with reason)

| # | Item | Reason |
|---|---|---|
| D1 | Historic gateways (RuDEX/Citadel/BlockTrades/…) | Out of business; SCOPE directive 2026-09-28 (ID corrected 2026-10-07 BIT20→BTWTY): XBTSX/BTWTY/GDEX/IOB only (slice-15) |
| D2 | GDEX auto-provisioning / BTWTY auto-rates | GDEX DNS-dead → honest manual-only panel; BTWTY endpoint-undiscovered → disabled (slice-15) |
| D3 | Extension-wrapper adapter | Post-v1 hardening by design, never a v1 dependency (SLICES.md) |
| D4 | dApp provider bridge (window.beet compat) | Out of v1 scope; if ever added, copies ref-#3 permission patterns |
| D5 | TradingView charting_library | Proprietary; replaced by vendored lightweight-charts + canvas (SLICES.md charting decision) |
| D6 | Virtual ops 51/53 (expiry events), op-74 virtual | Never signed by construction (slices 11/14) |
| D7 | Blind-transfer crypto (39–42) companions | Same as C23 — no silent half-port |

## Counts

- Section A (#1 routes): 33 rows — PORTED 33, STUB 0, DEFERRED 0, MISSING 0.
- Section B (#1 modals/widgets): 19 rows — PORTED 18, DEFERRED 1 (B19 issue reporter), MISSING 0.
- Section C (astro-only pages): 41 rows = 28 substantive PORTED (20 + C27/C29/C30/C31/C34/C35 confirmed PORTED per-row + C3 ranked-ops + C37 trollbox PORTED 2026-10-01) + 11 merge-pointers to §A rows (C1, C19, C20, C22, C25, C28, C32, C33, C38, C39, C41) + 2 DEFERRED (C23 blind, C36 forum — reasoned; corrected 2026-10-01 per R2: the old "10 DEFERRED" line mislisted six PORTED rows), MISSING 0.
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

## Punchlist delta (director round 1 `81f7b60` → verify-close `eca9ae1`)

> Append-only note for the punchlist round (`81f7b60..eca9ae1`, ~30 commits).
> Convention: same as above — behavior deltas only; status cells above are
> NOT flipped by this round (all rows stay PORTED/DEFERRED as listed).
> Every claim below was verified by `rg` in the cited file:line (never
> invented). Headless-only caveat: no human browser pass ran in this round;
> builder proof is `tooling/visual/shot.mjs` + `node --check` + headless
> DOM text per `vanilla/notes/punchlist-2026-09-29.json` (`verified:
> headless`). No `vanilla/js/tx.js` dispatch line was removed; the dispatch
> set only grew (ops 20/21/29/30).

- Ops 20/21/29/30 serializers ADDED (commit `872f25d`, no full inclusion —
  fixture not LTM): builders `serializeWitnessCreateOp` (`tx.js:2342`),
  `serializeWitnessUpdateOp` (`tx.js:2359`),
  `serializeCommitteeMemberCreateOp` (`tx.js:2375`),
  `serializeCommitteeMemberUpdateOp` (`tx.js:2390`) + dispatch
  `tx.js:2423-2424,2432-2433`. Proof is evaluator-reached, not included:
  `tooling/prove_witness_update_f1.cjs:1,20,25` (basic fixture hits the
  `is_lifetime_member` assert in `witness_evaluator.cpp:35` /
  `committee_member_evaluator.cpp:37`) + header honesty
  `vote-ui.js:58-62` (needs an LTM payer; vote slate is the proven path).
  Rows A15/B9 already carry this caveat — no status change.
- Op-22 transfer-propose path LIVE (commit `8432b52`, code-live, chain-proof
  as coded): Send/Propose toggle (`transfer-ui.js:435,497-503`), proposer +
  expiration + review inputs (`transfer-ui.js:452-466,712-723`), op-0 wrapped
  in op-22 via `Proposal.buildCreate` (`transfer-ui.js:62-66`,
  `proposal.js:104-111`), wrapper serializer
  `serializeProposalCreateOp` (`tx.js:1983`) + dispatch `tx.js:2425`,
  confirm/broadcast `transfer-ui.js:1230-1407`. Testnet inclusion PROVEN
  (commits `13a15a0` byte-proof + `5320596` inclusion): proposal **`1.10.1493`**
  at head **`100989922`**, inner op-0 lite-test-1→committee-account amount 1,
  fee 4787 raw TEST, re-read via `get_objects` (proposer/expiry/review/enclosed
  op confirmed; artifacts `tooling/prove_transfer_propose_f2.cjs` +
  `vanilla/notes/propose-proof-2026-09-29.md`). Prior claimed `1.10.1492`
  remains unverified/uncounted (self-transfer shape is consensus-illegal).
  Row C21 stays PORTED (same op-0 + op-22 wrapper, new UI path only).
- QuickTrade dual flow, SAME ops (commit `5ed6499`): dual SELL/RECEIVE +
  swap + per-side balances + walkthrough (`instant-trade-ui.js:1-23,383,
  521-622`), single op-1 `limit_order_create`
  (`instant-trade-ui.js:703,836-840`, `fill_or_kill: true`), confirm rows
  per #3 op-1 table (`instant-trade-ui.js:858-885`). `git show --stat
  5ed6499` touches `instant-trade-ui.js` only — no `tx.js` change, no new
  op. Row A31 stays PORTED.
- Fee groups / LTM, READS only (commit `7958649`): grouped table
  (`fees-ui.js:2-8,173-184`, `TYPE_ORDER` `fees-ui.js:84`),
  `fee*scale/1e4` + LTM column + dash treatment
  (`fees-ui.js:180,242,276-327`), sole reader `Asset.feeSchedule`
  (`asset.js:209-232`). No serializer touched. Row C31 stays PORTED.
- Account portfolio tabs, READS only (commit `53eea4b`): portfolio
  columns/actions/tabs incl. Margin Positions + Credit Management reads
  (`account-ui.js:544,621,1162,1301-1393`), membership op-8 section
  (`account-ui.js:1154-1162`, dispatch `tx.js:2415`). No new op dispatch.
  Row A2 stays PORTED.
- Borrow open-position, OP-3 path as coded (commit `887a520`): open form
  (`borrow-ui.js:196-197,421`), adjust form (`borrow-ui.js:189`),
  broadcasts as coded (adjust `borrow-ui.js:323-340`, open
  `borrow-ui.js:516-540`, bids `borrow-ui.js:737-754`), serializer
  `serializeCallOrderUpdateOp` (`tx.js:1334`) + dispatch `tx.js:2412`.
  No inclusion proof claimed beyond the code path. Row A20 stays PORTED.
- Vote joins, BROADCAST per serializer status (commit `a7e9fc5` on top of
  `872f25d`): `renderJoinWitness` (`vote-ui.js:885`),
  `renderJoinCommittee` (`vote-ui.js:965`), join broadcast
  (`vote-ui.js:1081-1098` via `Tx.buildTx` + `broadcast_transaction…`).
  Broadcast is live per code; inclusion is subject to the same LTM-payer
  caveat as ops 20/21/29/30 above. Rows A15/B9 stay PORTED with caveat.
- Rest of the round is NO-OP-CHANGE (reads/UI/i18n/help): transfer gating
  (`42f5b26`), explorer assets (`039eb60`), wallet console
  (`f28d5e3`/`15b3e81`), vote budget/toggle (`15b3e81`), meds/lows
  (`9e2c6be`-`f9ea49e`), prediction columns (`3fc3ee5`/`7868caf`),
  help articles (`2b19d5e`), i18n batches (`c472d59`-`eca9ae1`). None touch
  `tx.js` dispatch (verified: `git diff 5d4681b..eca9ae1 --stat` shows
  `tx.js` changed ONLY in `872f25d`).
- Counts this round: §A 33 PORTED / §B 17 PORTED + 2 DEFERRED / §C 20
  substantive PORTED + 11 merge-pointers + 10 DEFERRED / §D 7 — unchanged.
  MISSING (unjustified): still 0.

## Nightly delta 2 (2026-09-30) — op 16 fee-pool funding (testnet-proved)

- Op 16 `asset_fund_fee_pool` (fee)(from_account)(asset_id)(amount, bare
  int64 core)(extensions=absent): serializer `serializeAssetFundFeePoolOp` +
  dispatch (`tx.js`), builder `AssetOps.buildFundFeePool` (`asset-ops.js`,
  human CORE amount via `Format.parseAmount`, zero rejected), fee via
  `AssetOps.fee` → `get_required_fees`, send via `sendAndProve`.
  Field order vs #4 `asset_ops.hpp:728` + BJS `operations.js` (fetched raw
  2026-09-30) + #3 `bitshares-api.js:2566` — unanimous (op number corrected
  from 17: 17 = `asset_settle` per `operations.hpp:72`).
- Testnet proof (commit `444eb18`, artifacts
  `tooling/prove-feepool-fund-16.cjs` + fee-pool section): funded
  fixture-issued AFKTEST10 (1.3.1849, p4) dust 0.1 TEST = 10000 raw, pool
  10004248 → 10014248 (delta exact), fee 100 raw, wallet delta −10100 exact,
  head #100989922. Unit vectors 20/20 (`tooling/fee-pool-fund-16-test.js`).
- Asset page ACTIONS tab gained the funding form (amount + from-account +
  Review → named-row confirm → unlock-at-sign → pool-delta re-read proof);
  also fixed a 10× display bug (fee-pool shown at asset precision, now core
  p5). Claiming (ops 43/47) stays honestly deferred.
- Counts: unchanged otherwise. MISSING (unjustified): still 0.

## LTM / witness-create / committee-create delta (2026-09-30) — STOPPED, two blocks

> Task: upgrade fixture `lite-test-1` (`1.2.26833`) to LTM (op-8), then full
> inclusion proofs for op-20 `witness_create` + op-29 `committee_member_create`.
> Outcome: NO broadcast, nothing spent, no state created. Full detail in
> `vanilla/notes/ltm-witness-committee-2026-09-30.md`. No row changes
> PORTED→anything; rows A15/B9/C29 keep PORTED-with-caveat, caveat now doubled.
> Counts: §A 33 PORTED / §B 17 PORTED + 2 DEFERRED / §C 20 substantive PORTED
> + 11 merge-pointers + 10 DEFERRED / §D 7 — unchanged. MISSING: still 0.

- Funds block (task STOP rule): op-8 fee `20000000` raw (`200.00000` TEST,
  p5, live `get_required_fees`) vs fixture `3873890` raw (`38.73890` TEST);
  shortfall `16126110` raw (`161.26110` TEST). Membership still basic
  (`1970-01-01T00:00:00`; LTM sentinel `2106-02-07T06:28:15`). No top-up
  attempted (task: do not fund without recording — funding request:
  ≥ ~165 TEST via `testnet-faucet.xbts.io`, owner decision).
- Client-bug block (found verifying): `Chain.connect` + `Tx.buildTx` head
  gates (`chain.js:104-105`, `tx-send.js:47-48`, landed `8c40f45`) demand
  64-hex `head_block_id`, but the real chain uses 40-hex RIPEMD160
  (`types.hpp:304`; both testnet nodes agree: xbts.io head `#100989922`
  STALE ~24h, dex.trading `#101015748` live). Verbatim:
  `bad-head-shape: head_block_id must be 64 hex chars` on BOTH nodes via the
  real vanilla path — browser app equally affected (connect rejects). Fix
  recommended in the note, NOT applied (scripts + note only this round).
- Scripts committed (stdlib-only, redacted, `node --check` clean):
  `tooling/prove_witness_create_20.cjs` + `tooling/prove_committee_create_29.cjs`
  (LTM + fee+dust gates, exit 3 = STOP). Both STOP at connect with the exact
  gate error (EXIT=3, zero cost); post-fix they prove to inclusion + re-read.
  Op-20/29 fees observed `100` raw each — trivial once LTM exists.
- Leftover state: NONE this round (witness/committee lookups `null`,
  balance untouched). Standing clutter unchanged (AFKTEST10/M11,
  `1.10.1493/94`). Post-success note must list created ids (no delete op).

## LTM funding round 2 (2026-09-30 evening) — faucet refused, STOPPED, no flips

> Task: fund `lite-test-1` (`1.2.26833`) to ~165+ TEST via
> `testnet-faucet.xbts.io`, upgrade op-8, prove op-20/29. Outcome: faucet
> delivered NOTHING (direct-claim generic error, 2× rate-limit
> `Only one account per IP 30 min` with honest 30-min waits, 1× generic
> `Error registration new account`, 2× client timeout + 1× fetch-failed
> network); registrar funded (`59445578898` raw), count `26838`, so NOT empty
> — refused/flaky. Balance before = after = `3873890` raw; membership basic;
> witness/committee `null`. Op-8 NOT attempted (shortfall `16126110` raw).
> Both prove scripts CONNECT (40-hex fix `87e15f5` resolved the morning
> connect-block) then STOP at `ltm_gate` EXIT=3, zero cost. Throwaway names
> (`afk-fund-264c/ab43`, `afk-tkt-6a47`) all `null` — zero clutter. Full
> exact-response table in `vanilla/notes/ltm-witness-committee-2026-09-30.md`
> (funding-round-2 section). No row changes; counts unchanged; MISSING: 0.

## TxBuilder delta (2026-09-30) — composer capability, no new ops

> Append-only note for the TxBuilder composer landing (plan
> `docs/superpowers/plans/2026-09-30-txbuilder.md`, Tasks 1–8).
> Convention: same as above — behavior delta only; no §A/§B/§C status
> cell flips (composer reuses already-PORTED op paths, adds no op).
> Every claim below was verified by `rg` in the cited file:line (never
> invented). Offline proof is the committed `tooling/txbuilder-test.js`
> (53/53 stdlib-only, exit 0); live proof is
> `vanilla/notes/txbuilder-parity.md` vectors T1–T6.

- Composer capability (NO new ops — same serializers, new bundling):
  `vanilla/js/txbuilder.js` (565 lines) owns queued `[opId, opData]`
  state + `feeAll` (`txbuilder.js:111`, ONE `get_required_fees` call)
  + `buildUnsigned` (`txbuilder.js:129`) + versioned export/import
  envelope (`exportJSON` `txbuilder.js:142`, `importJSON`
  `txbuilder.js:164`, strict `tb-bad-envelope`/`tb-chain-mismatch`/
  `tb-ops-drift`/`tb-expired` guards) + `resolveAuths`
  (`txbuilder.js:264`, batched `get_objects`) + `signLocal`
  (`txbuilder.js:331`, append-only, `tb-wallet-locked` when locked) +
  `describe` (`txbuilder.js:431`, pilot ops 0/6/61 human rows + honest
  `not yet described` fallback) + `wrapProposal` (`txbuilder.js:497`,
  delegates to `Proposal.buildCreate`, no new builder) +
  `broadcastSigned` (`txbuilder.js:512`, callback-first/plain-fallback
  + per-op provers, long-tail `accepted by node, inclusion not proven`
  wording). Desk is `vanilla/js/txbuilder-ui.js` (178 lines,
  `renderDesk` `:76`, `mountBadge` `:150`), route `/txbuilder`
  (`router.js:235`), tags (`index.html:130-131`), badge hook
  (`app.js:841`). Unit suite `tooling/txbuilder-test.js` covers state
  core (add/remove/clear/invalidation, fee-asset guard), envelope
  (feeAll/buildUnsigned/export/import incl. expired + non-JSON guards),
  auth (threshold-met + all-missing honesty), describe (titles +
  fallback), wrap/broadcast shapes (proposal wrap, empty/sigless
  negatives) — fully offline via stubbed Chain/Wallet/Format.
- Testnet bundle 0+6 @101018463 (composer proof, NOT a new op):
  direct-send 2-op bundle op-0 dust `10000` raw + op-6 vote no-op
  re-publish, ONE fee call `totalRaw 92633`, human rows `0.10000 TEST`
  (raw in `title` only), sign `stillMissing []`, `via
  broadcast_transaction_with_callback`, op-0 history content-match at
  block `101018463/0` + op-6 slate re-read
  (`vanilla/notes/txbuilder-parity.md:33-66,157-159`).
- Pilot outlets (additive, one-shot paths untouched): Transfer
  `Add to TxBuilder` (`transfer-confirm.js:321,328`), Voting
  `Add vote to TxBuilder` (`vote-ui.js:685,691`), Pool stake
  `Add deposit to TxBuilder` (`pool-ui.js:178,185`) — each guarded by
  `typeof TxBuilder` absence checks, navigating to `#/txbuilder`.
- Missing-key honesty: empty wallet yields all-missing `resolveAuths`
  rows (never throws); locked wallet `signLocal` throws
  `tb-wallet-locked`; T2 live vector shows `committee-account
  missing:true` with `nested-auth` note and `signatures []`
  (`vanilla/notes/txbuilder-parity.md:68-73`).
- Counts: §A 33 PORTED / §B 17 PORTED + 2 DEFERRED / §C 20 substantive
  PORTED + 11 merge-pointers + 10 DEFERRED / §D 7 — unchanged.
  MISSING (unjustified): still 0.

## R1c part-1 delta (2026-10-01) — B18 + C3 PORTED, zero new deps

- B18 (dead-browser notice) DEFERRED → PORTED: `vanilla/js/app.js`
  `compatMissing()` + `#compat-banner` (`index.html`, `app.css`), neutral copy
  + `#/help` link, dismissal `bts-vanilla-compat-off-v1`; #1's UA-sniff
  (`App.jsx:345-356`) + Chrome upsell (`BrowserSupportModal.jsx:9-15`,
  `locale-en.json:496-497`) refused. Delta in `slice-01-settings.md`.
- C3 (ranked ops) DEFERRED → PORTED: `#/top-ops` (`vanilla/js/top-ops-ui.js`,
  route in `router.js`, Explore nav link in `app.js`) — N=200 `get_block`
  chain-scan (`database_api.hpp:182/:229`), table + SVG donut, Refresh, honest
  last-200 label + testnet-works note, `Format.pct1` shares; astro's ES POST
  (`TopOperations.ts:15-85`) refused, mainnet-only limit lifted. Vectors
  `tooling/top-ops-test.js` 41/41. Delta in `slice-09-explorer.md`.
- Counts now: §A 33 PORTED / §B 18 PORTED + 1 DEFERRED / §C 21 substantive
  PORTED + 11 merge-pointers + 1 BUILDING (C37 trollbox) + 2 DEFERRED /
  §D 7. MISSING (unjustified): still 0. Verification this round:
  `node --check` clean, `check_rot.py` PASS, `check_i18n.py` OK (2752 keys),
  `top-ops-test.js` 41/41; `shot.mjs` blocked by sandbox-missing `libnspr4.so`
  (recorded, static smoke substituted); live 200-block testnet scan + human
  browser passes queued with the tester.

## R1d+R1e delta (2026-10-01) — settlement estimate + CR + open-settle tab (reads only)

- R1d (C26-ported note): settlement estimate on the desk strip
  (`market-desk.js:fetchFeed`, `market-ind.js:renderStrip`,
  `Format.settleEstimate`): offset from `bit.options.
  force_settlement_offset_percent`, CORE-base branch per #1, global fund>0
  uses `settlement_price` directly. Fee asset stays `1.3.0` + deferred note.
- R1e CR (A20-ported note): collateral ratio column + bands in `#/borrow`
  (`borrow-ui.js:previewRatio/posTable`, `Format.collateralNumDen/
  formatRatio2dp/pct2dp/ratioBelowMcr/PlusHalf/mcrUnitsToHuman/nominalNumDen`):
  danger `cr<mcr`, warning `cr<mcr+0.5` (exclusive), nominal honestly labelled.
- R1e tab (A4-ported note, C20 unchanged — explorer untouched):
  open-settle tab on the desk (`market.js:settleOrders/sortSettles`,
  `market-orders.js` My/Settlement tabs): `get_settle_orders(assetId,100)`
  <=300, price/amount/date sorted by `settlement_date`, empty->`no_orders`.
- Vectors: `tooling/settle-cr-test.js` 40/40 (offset 0/nonzero, non-BTS p4/p2,
  global branch, CR bands incl. boundary mcr and mcr+0.5, settle-date sort).
  Verification: `node --check` clean (6 files), `check_rot` PASS,
  `check_i18n` OK (2793 keys, 13 new keys ×10 dicts), `Math.pow(10` outside
  `format.js` empty. Counts unchanged; MISSING still 0.

## R1c trollbox delta (2026-10-01) — C37 BUILDING → PORTED
- C37 (trollbox) BUILDING → PORTED: `#/trollbox` (`vanilla/js/trollbox.js` +
  `trollbox-ui.js`, `Chain.custom()`, op-35 9198/9199-only exception in
  `tx.js`, 28 `trollbox.*` keys ×10 dicts). Reads: 100/page pager + meta probe;
  post: live fee + direct key read-back. Live inclusion tester-queued (one
  accepted post, key absent — see slice-14 delta). Detail in
  `vanilla/notes/slice-14-proposals.md` (R1c trollbox delta).
- Counts now: §A 33 PORTED / §B 18 PORTED + 1 DEFERRED / §C 22 substantive
  PORTED + 11 merge-pointers + 0 BUILDING + 2 DEFERRED (C23 blind, C36 forum) /
  §D 7. MISSING (unjustified): still 0. Verification this round:
  `tooling/trollbox-test.js` 75/75, `node --check` clean, `check_rot.py` PASS,
  `check_i18n.py` OK (2793 keys, 3756 sites drift-free).

## PMO + fee-tier delta (2026-10-02) — A30 enrichment, no new ops
- A30 stays PORTED (same routes, new display paths): `#/prediction` gains the
  Organizations (PMO) section (parent org assets via `pmo_object` description
  JSON + scanned-range sub-asset/active/expired tallies, one shared bounded
  scan); `#/prediction/:market` on an org symbol renders the org detail
  (identity/governance/attestation + child markets + `#/assets/create?sub=`
  entry); `#/assets/create` shows the op-10 fee tier by full symbol length
  beside the live `get_required_fees` fee + PMO-template / sub-prefill
  entries. No new WS methods (list_assets/get_objects/lookup/get_required_
  fees/get_global_properties all pre-existing); NO PMO fee discount exists
  (tier-by-length documented in-app). Vectors `tooling/pmo-fee-tier-test.js`
  53/53. Detail in `vanilla/notes/slice-10-assets.md` (PMO delta).
- Counts: §A 33 PORTED / §B 18 PORTED + 1 DEFERRED / §C 22 substantive
  PORTED + 11 merge-pointers + 0 BUILDING + 2 DEFERRED / §D 7 — unchanged.
  MISSING (unjustified): still 0.

## Prediction-portfolio delta (2026-10-02) — A30 enrichment, op-17 settle path code-live

- A30 stays PORTED (same routes, new portfolio paths): `#/prediction` gains
  Active (unexpired+unsettled, closing-soon sort) / Expired (past+unsettled,
  awaiting resolution) / My (wallet created-or-held) + Open/Settled/All,
  expiry countdown text (pure time math) + manual Refresh (loading state),
  and a Portfolio section (balances⋈scan + fill-history avg-cost via
  `Prediction.costBasisFromFills` + settlement/mid/feed current via
  `Format.valueFromFeedRaw/valueFromMidHuman` + `Format.pnlRaw`, human terms
  with raw titles, phone cards) + per-settled-holding op-17 settle
  (`AssetOps.buildSettle` + `get_required_fees`, unlock-at-sign, named-row
  confirm, balances re-read proof). Settlement state from #4
  `settlement_price` null-check (`asset_object.hpp:299`), fund>0
  corroborating OR. No new WS methods (all pre-existing reads + op-17
  serializer from slice-10/14). Settle broadcast CODE-LIVE, tester-queued
  (no holder-fixture spend this round — never fabricated). Vectors
  `tooling/prediction-portfolio-test.js` 55/55. Detail in
  `vanilla/notes/prediction-portfolio-2026-10-02.md`.
- Counts: §A 33 PORTED / §B 18 PORTED + 1 DEFERRED / §C 22 substantive
  PORTED + 11 merge-pointers + 0 BUILDING + 2 DEFERRED / §D 7 — unchanged.
  MISSING (unjustified): still 0.

## Explorer-readability delta (2026-10-02) — sentence/typeahead/share rows

> Enrichment of the PORTED explorer rows (A16/A18/A19, B13/B14) — no status
> cell changes, no new ops, no count changes. Activity sentences now cover
> 22 op types (was 10): 0/1/2/3/4/5/6/7/8/10/11/14/15/16/17/19/22/23/33/49/50/77,
> with honest `(virtual)` markers on 4/42/44/46/51/53/74 per
> `operations.hpp:56-133` (open-graphene 78-op spec concurs, zero conflicts).
> Witness/committee/pool/samet/credit/ticket/custom-authority ops keep the
> generic fallback (spaced name + block link) — full views live in owning
> slices (A15/A32/C-see-rows). Search typeahead: `lookup_accounts` +
> `list_assets` prefix paging (#4 `database_api.hpp:357,435`; no
> `lookup_assets` exists — recorded, not assumed); tx-hash path deferred
> (`get_recent_transaction_by_id` exists at `:200` but is location-less).
> Share rows on `#/block/:h`, `#/block/:h/:ix`, `#/account/:name`,
> `#/asset/:symbol` (router-resolvable hashes only). Counts unchanged: §A 33
> PORTED / §B 18+1 / §C per above / §D 7 — MISSING (unjustified): still 0.
