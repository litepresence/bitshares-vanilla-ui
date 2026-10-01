# Original UI page map — bts.exchange, captured 2026-09-27 headless @1440px

All routes from `reference/bitshares-ui/app/App.jsx:504-650`. Public unless noted.
Reference for principle #2 (retro parity). Compare with our renders in the
per-slice parity notes.

| # | Route | Shot | What it shows |
|---|---|---|---|
| / | `root.png` | Scam-warning banner, header nav, create-account/login gate, footer latency+block |
| /account/committee-account | `account.png` | PUBLIC full account: Balances/Open Orders/Margin Positions/Credit Management/Activity tabs; balance table (QTY, in-orders, vesting, collateral, PRICE(BTS), 24HR, VALUE(BTS)) + SEND/DEPOSIT/TRADE/BORROW/SETTLE columns; filter + Active/Visual |
| /accounts | `accounts.png` | (check: likely wallet-gated list) |
| /market/BTS_USD | `market.png` | Header stats, TV chart, buy/sell LIMIT+SCALED, markets sidebar (see earlier capture) |
| /credit-offer | `credit-offer.png` | Credit offers |
| /settings | `settings.png` | Settings landing |
| /settings/access | `settings-access.png` | Left menu (General/Accounts/Nodes/Faucet/Reset), auto-select toggle, node filter, active-node card + witness + latency, AVAILABLE/PERSONAL/HIDDEN/TESTNET tabs |
| /deposit-withdraw | `deposit-withdraw.png` | Gateway bridge (note: SSL errors in console — gateway endpoints rotting) |
| /create-account | `create-account.png` | Faucet/registrar flow |
| /login | `login.png` | Login gate |
| /registration | `registration.png` | Registration selector |
| /news | `news.png` | News feed |
| /voting | `voting.png` | Redirects to `/account/:name/voting` (login-gated) |
| /explorer | `explorer.png` | Explorer landing |
| /explorer/blocks | `explorer-blocks.png` | Blocks table |
| /explorer/assets | `explorer-assets.png` | Assets table |
| /explorer/witnesses | `explorer-witnesses.png` | Witnesses table |
| /asset/BTS | `asset.png` | Asset detail |
| /block/114715770 | `block.png` | Block detail (fresh head at capture time) |
| /block/114715770/0 | `block-tx.png` | Transaction detail |
| /borrow | `borrow.png` | Margin/borrow (QuickTrade family) |
| /barter | `barter.png` | Barter |
| /direct-debit | `direct-debit.png` | Withdraw permissions |
| /spotlight | `spotlight.png` | Spotlight orders |
| /wallet | `wallet.png` | Wallet manager (login-gated) |
| /create-wallet-brainkey | `create-wallet-brainkey.png` | Brainkey creation |
| /existing-account | `existing-account.png` | Import existing |
| /create-worker | `create-worker.png` | Worker proposal creation |
| /help | `help.png` | Help landing |
| /htlc | `htlc.png` | HTLC |
| /prediction | `prediction.png` | Prediction markets |
| /instant-trade | `instant-trade.png` | Simple trade view |
| /pools | `pools.png` | Liquidity pools |
| /invoice/abc | `invoice-bad.png` | Error state for bad invoice data |
| /nope-xyz | `page404.png` | 404 page |

Notes:
- Every page load logs dead-node WS errors (roelandp DNS, loclx 404, lebin SSL) — live rot evidence; the app still works via surviving nodes (failover doing its job).
- `deposit-withdraw` additionally shows resource SSL errors — gateway rot, supports the adapter-with-unavailable-states design.
- Account page renders fully logged-out (balances + orders + activity public) — confirms reads-need-no-login; only cancel/sign actions gate on ownership.
