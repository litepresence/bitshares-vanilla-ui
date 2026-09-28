# Slice-09 addendum — explorer ref-tab parity (pools/accounts/witnesses/committee/markets/fees)

Date: 2026-09-28. Ref: `Explorer.jsx:18-64` (8 tabs). Vanilla had 3
(blocks/assets/+feeds extra); now 9 (ref order + feeds kept as documented
superset).

## 1. Reference behavior

`bitshares-ui/app/components/Explorer/Explorer.jsx:18-64`: blocks,
assets, pools, accounts, witnesses, committee_members, markets, fees —
each a tab rendering its container (Blocks/Assets/LiquidityPools/
Accounts/Witnesses/CommitteeMembers/Markets/Fees containers).

## 2. Vanilla implementation

- `vanilla/js/explorer-tabs.js` (new, 280 lines): poolsTab (Pool.list 20 +
  desk link), accountsTab (lookup_accounts prefix search + links),
  witnessesTab/committeeTab (Vote.lists tables Name/Account/Active + voting
  link; weights deliberately omitted — voting page owns human weight math,
  principle #6), marketsTab (get_top_markets 20, MARKET/PRICE/VOLUME/CHANGE
  + desk links), feesTab (shared AssetFeedUI.feeSection, zero fork).
- `vanilla/js/explorer-ui.js`: TABS 3 -> 9 in ref order, dispatch chain to
  ExplorerTabs with gen-guarded live() closure; tab labels capitalize from
  ids (no dict churn).
- `vanilla/index.html`: explorer-tabs.js after explorer-assets.js.

## 3. Manual tests + observed (headless, zero console errors x6)

- All 6 tabs render live mainnet data: pools 1.19.0+, accounts search
  "committee-acc" -> 5 links, witnesses 194 rows, committee rows, markets
  with human volumes/changes, full fee schedule.
- Actives verified: 16/194 witnesses, 11/65 committee flagged (init miners
  correctly "—": retired on mainnet — first suspected a join bug, live
  2.0.0 probe proved active_witnesses starts at 1.6.35; evidence over
  assumption).
- market_ticker shape proven before rendering: symbols + human strings
  (no raw ints on screen).

## 4. Vectors

No money math in this slice (ids/names/links + verbatim human ticker
strings). Fee table reuses the audited feeSection (raw ints in titles).

## 5. Screenshots

/tmp/vx-{pools,accounts,witnesses,committee,markets,fees}.png @1440, all
green. Theme trio via shared tokens (human tester round).

## 6. Readability

explorer-tabs.js header owns/consumes/side-effects; per-fn what/params;
no dead text.

## 7. Anti-rot

(a) Static, same socket, no new deps. (b) Nothing new depended on.
(c) Deletable: any single tab renderer (shell + remaining tabs stand).
`check_rot.py` PASS.
