# Tester manual — bitshares-vanilla-ui human gate (R6)

For the human unit tester. Written so a junior dev can follow with zero
prior context. Every section: what to open, what to click (numbered), what
you should see, what to write down. **Nothing here needs the command line**
(the dev team runs `tooling/*-test.js`, `check_rot.py`, `check_i18n.py`
separately — 488 vectors green + keepalive GREEN as of 2026-10-01).

## Ground rules (read once, apply everywhere)

1. **Console first.** Before each section: press F12 (or Ctrl+Shift+J /
   Cmd+Option+J), click the Console tab, right-click → Clear. After the
   section, copy ANY red text into your report. Zero red = PASS on console.
2. **Two widths.** Do every section twice when it says so: phone
   (DevTools device toolbar, 390px wide) and desktop (full window, ≥1440px).
   On phone, everything tappable must be finger-sized; nothing may need a
   mouse hover to work.
3. **Three themes.** Settings → appearance → try Classic (default theme),
   Vanilla light, DEX dark on the market, pools, transfer, and settings
   pages. Text must stay readable everywhere (no invisible/blue-on-blue).
4. **Report format per step:** `Section.Step — PASS` or `— FAIL: what you
   saw vs what this manual says`. Screenshots for every FAIL.
5. **Real keys only on testnet.** NEVER type a mainnet password/brainkey
   here. The dev team gives you the testnet fixture wallet password.

## 0. Setup

1. Open the URL the dev team gives you (a static server for the `vanilla/`
   folder). You should see the app shell: header, nav, footer
   `BITSHARES <8-char code> • v1.0.0 • Disclaimer`.
   - Expected: no blank page, even if the node is down (an offline panel
     with Retry appears instead — that is correct behavior, report it as
     "`Setup.1 — offline panel shown`" not a failure).
2. Open DevTools → Console, clear it. Leave it open for the whole session.
3. Resize check: set the viewport to 390px wide (DevTools → Toggle device
   toolbar → Responsive → 390). The sidebar/nav must collapse (hamburger
   or bottom nav — never a sidebar eating the phone screen). Record PASS/FAIL.
4. Fresh-profile tour (NEW — scroll-hijack fix): use a fresh browser
   profile (or clear site data) so the 5-step "Welcome to BitShares
   Vanilla" popup auto-starts on the landing page.
   - Scroll the page up and down while the popup is open.
     Expected: smooth gliding, popup tracking its target. FAIL = any
     yanking/fighting.
   - Click through all 5 steps. Expected: each step scrolls exactly once
     on arrival; NEXT/DONE/SKIP labels sit inside their buttons (never
     running off right); dots are small circles.
   - Dismiss, then click "Take tour" (dashboard). Expected: replay works.
5. Landing refill (NEW): with network throttled to Slow 3G (DevTools →
   Network), load `/` locked.
   - Expected: hero/cards/steps paint immediately; market chips + chain
     pulse fill in with live numbers once connected (never stuck "—").

## 1. Settings / nodes (`#/settings`)

1. Click Settings in the nav. Click the Nodes tab.
2. You see a list of nodes with latency numbers. Click a different node.
   - Expected: status changes, app reconnects, footer chain code stays the
     8-char mainnet/testnet prefix. If a node is dead, its row says down —
     never a blank screen.
3. Node health pills: rows show Good, Stale, Suspect, Forked,
   mismatch, Timeout, or Down — not just reachable/unreachable.
   - Hover any row: tooltip shows head age, participation %, irreversible
     lag, chain prefix, and "last good Xm ago" where known.
   - Expected: a fast-but-stale or forked node is labeled, never shown as
     healthy. Record any row whose pill contradicts its tooltip.
4. Flip the testnet toggle. Expected: node list switches to testnet nodes.
5. Add a custom node (type any `wss://` URL), then delete it.
   - Expected: it appears, can be selected, can be removed.
6. Button row (desktop 1440px): Ping All + node input/Add node + Find
   nodes share ONE line; on a 390px phone they stack.
   - Click "Find nodes", watch progress, then Cancel mid-run.
   - Expected: cancel stops it with partial results kept; completed runs
     list review candidates (URL + health + sources) with per-row Add;
     Add routes through the same custom validation (bad URLs refused);
     nothing is ever added without your click.
7. Header check: the username left of the lock reads committee-account
   while locked. Footer check: clicking the node/latency/block text opens
   `#/settings`.
8. Pool context: open `#/pools/1.19.66`, then click the header Exchange tab.
   - Expected: lands on that pool's pair market (not the default pair).
     Go to `#/wallet` and click Exchange again: back to the default pair.
9. Switch theme: Classic → Vanilla light → DEX dark (appearance control).
   - Expected: whole app re-skins instantly, no reload. Record any unreadable text per theme.
10. Record: console errors (want none except dead-node probe lines, which
   are normal and the UI must label that node down).

## 2. Wallet (`#/wallet`, `#/create-wallet-brainkey`, `#/existing-account`, `#/login`)

1. Go to Create Wallet (brainkey). Click "generate" (or equivalent).
   - Expected: a multi-word brainkey appears. **Write it on paper** (test
     wallet only). The screen tells you to back it up — confirm that hint exists.
2. Type a 3-letter password, click Create.
   - Expected: refusal — "Password must be 8 characters or more." (PASS = it refuses.)
3. Type an 8+ character password twice (matching), click Create.
   - Expected: wallet unlocks, console/status shows unlocked state.
4. Click Lock (nav or wallet page). Reload the page (F5).
   - Expected: wallet auto-locks on reload; balances/public pages still render (reads need no login).
5. Go to Login, type a WRONG password 3 times.
   - Expected: each failure makes you wait longer (1s, 2s, 4s… backoff).
     Note the wait — PASS if delays grow.
6. Type the RIGHT password. Expected: unlocks.
7. Wallet → "Show backup brainkey". Expected: same words as step 1.
   Lock the wallet, then try the backup screen again.
   - Expected: locked = it refuses ("unlock first"), never shows words.
8. Leave the app open, untouched, 6 minutes (or ask dev to shorten the
   timer). Expected: auto-locks by itself.
9. Hide the browser tab (switch tabs) and come back. Expected: locked.
10. Wallet → Change password (`#/wallet/password`): enter current + new +
    confirm. Expected: success panel + a proof line; wallet locks after.
11. Existing account → import the paper brainkey from step 1 with a password.
    - Expected: succeeds (look-ahead finds the funded account) OR honest
      "no-chain-keys" refusal for an empty brainkey — both are correct;
      record which you got.
12. Confirm the honest notes exist on screen: brainkey-only import (no
    `.bin` decrypt), no cloud name+password login. PASS = the notes are there.

## 3. Account view (`#/account/<name>`)

1. With wallet LOCKED, open `#/account/committee-account`.
   - Expected: balances + history render with NO login (public reads).
     Amounts look human (`1.23456 BTS`-style, never giant raw integers).
2. Type your testnet account name in the lookup. Expected: its page opens.
3. Open your testnet account page. Check: Balances tab, Open orders,
   History, Margin Positions / Credit Management reads (may be empty —
   empty panels must EXPLAIN, never blank).
4. If the account has a margin position: confirm a collateral-ratio number
   shows with a danger/warning/safe treatment. Record the value.
5. Phone width: tables must stack or scroll sideways with the first column
   sticky — record PASS/FAIL.

## 4. Transfer (`#/transfer`)

1. Unlock the wallet. Fill: To = testnet fixture account, Amount = tiny
   (0.1 TEST or less), Memo = "tester probe <date>".
2. Click Review. Expected: a human-readable confirm (from, to, amount,
   memo, fee) — read every row before continuing.
3. Confirm + sign. Expected: success with block number + position (NOT a
   transaction id — the app shows block # + position by design).
4. Repeat with an unknown recipient. Expected: clean refusal before signing.
5. Repeat with an amount larger than the balance. Expected: clean refusal
   (or honest node error after submit — record which).
6. Lock the wallet, click Review on a filled form.
   - Expected: locked preview works; memo field is excluded while locked;
     signing still gates on unlock.

## 5. Market (`#/market/<QUOTE>_<BASE>`, e.g. BTS_CNY)

1. Open a market. Expected: order book (bids green / asks red), spread +
   midpoint, ticker stats, trade history, price + depth charts.
2. Market picker: type 2–3 letters with a typo (e.g. "BTS" as "BTS", "USD"
   as "UDS"). Expected: forgiving fast search, keyboard navigable.
3. Buy/sell panels: enter a tiny off-market limit order (so it rests, not
   fills). Review → confirm rows → sign.
   - Expected: order appears in My orders AND in the book; fee preview line
     shows before you sign.
4. Cancel that order (per-row cancel). Expected: disappears from book.
5. Scaled orders (N=2–5, tiny amounts): place, verify N rows, cancel-all.
   Expected: book left clean, balance reconciles.
6. Fill-or-kill: place a FoK order that cannot fill. Expected: honest
   rejection, nothing rests.
7. Indicators: enable RSI + MACD + Volume. Expected: stacked sub-panes with
   independent scales + volume pane; indicators render on candles.
8. Zoom hold (NEW): zoom into a time range on the price chart, wait 15s
   through live refreshes.
   - Expected: zoom stays put (no reset to full view). Then change the
     Candles input (e.g. 2000 → 500): chart refetches and repaints at the
     new window; invalid entries (0, 99999, text) revert with a note.
9. Deep history (NEW): switch to 1D timeframe on BTS/CNY, wait for load.
   - Expected: candles reach back years (not just 2022/23), newest candle
     is current; hourly shows dense recent history. Record oldest/newest
     visible dates.
8. Settlement strip (MPAs): for a smartcoin market, confirm a feed price
   AND a settlement-estimate price both show (estimate differs from feed
   by the offset — record both numbers).
9. Open-settlement tab: for a market asset, open the Settlement tab.
   Expected: price/amount/date table sorted earliest-first, or an honest
   `no_orders`/non-bitasset note — never blank.
10. Phone width: book + chart + buy/sell stay legible without pinch-zoom.
    Desktop 1440px+: desk uses the width (multi-column, no stranded narrow column).

## 6. Voting (`#/voting`)

1. Open Voting. Expected: witness / committee / worker lists + details.
2. Select a proxy. Expected: slate editing disables with an honest note.
3. Clear proxy, change your vote slate (add/remove one entry).
   - Expected: draft-vs-published diff shows; publish signs op-6.
4. Join-as-witness / join-as-committee screens render (broadcast needs a
   funded LTM account — if it refuses for funds, record the exact message;
   that refusal is CORRECT, not a failure).

## 7. Explorer (`#/explorer`, `#/block/<height>`) + ranked ops (`#/top-ops`)

1. Explorer → Blocks: click the latest block → block detail → click a
   transaction. Expected: full op breakdown in human terms.
2. Explorer → Assets: search an asset (e.g. BTS). Expected: detail with
   live feed where applicable.
3. Paste an object id (`1.2.x` → account, `1.3.x` → asset redirects).
   Expected: lands on the right page.
4. Open `#/top-ops`. Expected: a table (type/name/count/share) + donut
   chart labeled "last 200 blocks on <node>", Refresh button re-runs it.
   Works on testnet (unlike the old stats page which was mainnet-only).
5. Block age (NEW — decimal timer): on the Blocks tab, watch the latest
   block's age line for 10 seconds.
   - Expected: it ticks in tenths (`2.3 seconds ago`-style) and resets on
     each new block. No full-page flicker — only the age text changes.

## 8. Assets (`#/assets`, `#/assets/create`, `#/asset/<symbol>`)

1. Asset detail for a smartcoin: confirm feed price, MCR/MSSR numbers in
   human percent (`175%`-style, never `1750`-looking raw).
2. UIA create flow (do NOT broadcast unless dev says so): fill the form to
   the Review step. Expected: every field validated inline; preview
   readable. Cancel safely.
3. Feed publish (issuer accounts only): same to Review, cancel.
4. Fee-pool funding form (on an asset page Actions tab): fill to Review,
   cancel. (Broadcast only on dev order.)

## 9. HTLC (`#/htlc`) + direct debit (`#/direct-debit`) + spotlight (`#/spotlight`)

1. HTLC tab: create form renders (hash algorithm choices, expiry, parties).
   Create → redeem/extend flow only on dev order; otherwise Review + cancel.
2. Direct debit: list + create + claim/update/delete forms render; same
   Review-then-cancel discipline.
3. Spotlight: featured view renders with no console errors.

## 10. Pools (`#/pools`, `#/pools/<id>`, `#/swap`)

1. Pools list renders with volumes. Open a pool detail: deposit/withdraw
   forms + history render.
2. Pool book layout (NEW — mirrors exchange): the book shows Bids and Asks
   SIDE BY SIDE (not stacked), best bid and best ask on the same top line
   near the center. At phone width they stack — that is correct, record
   desktop 1440px+ for this check.
3. Swap page: pick two assets, enter amount. Expected: live preview quote
   + fee line; Review → sign only on dev order.
3. Pool connection map (if shown): nodes/links render, no console errors.

## 11. Credit (`#/credit-offer`), Same-T (`#/samet`), borrow (`#/borrow`)

1. Credit offers list + offer detail (deals) render.
2. Same-T funds list renders.
3. Same-T row actions (REGRESSION — the type gate caught this dead):
   click Borrow+Repay, Repay, Update, Delete on an owned fund row.
   - Expected: each opens its form below (no dead click, no console error).
     Fill to Review, then cancel. (Before 2026-10-01 every one of these
     clicks threw; PASS = all four open.)
4. Borrow page: margin positions table WITH collateral-ratio column;
   open-position + adjust forms to Review, cancel.
5. Fee display: fees show in `1.3.0` (CORE) with a "fee-asset switching
   deferred" note — confirm the note exists.

## 12. Proposals (`#/proposals`), tickets (`#/tickets`), misc + trollbox (`#/trollbox`)

1. Proposals list + detail render; create-proposal flow to Review, cancel.
2. Vesting / authorities / lists / airdrop / invoice pages render with no
   console errors (broadcast only on dev order).
3. Open `#/trollbox`. Expected: channel tabs + message list in plain text
   (no raw code), composer with byte counter + fee preview.
   - If the node lacks the chat plugin: an honest "unavailable / switch
     node" note is CORRECT — record it, not a failure.
   - Post ONE short test message ONLY on dev order; then confirm it reads
     back in the list.

## 13. Gateways (`#/deposit-withdraw`)

1. Confirm exactly four integrations shown: XBTSX + IOB live coin lists;
   GDEX manual-only; BIT20 disabled — each labeled honestly.
2. Withdraw path: prefills a transfer (single signing path) — confirm the
   handoff works to Review, then cancel.

## 14. Notifications (`#/alerts`)

1. Bell icon in header/desk: click → alerts page.
2. Create a price-alert rule (browser notifications OFF by default —
   confirm the default is OFF). Trigger behavior only on dev order.

## 15. i18n + themes + viewports + accessibility (whole app)

1. Settings → language: switch to Spanish, visit market + transfer.
   Expected: chrome translates; variable data (names/numbers) never breaks
   layout. Switch back to English.
2. German-overflow glance (if available): long strings must wrap, not
   overflow panels — record worst offender or PASS.
3. Theme trio (§1 step 5 extended): market, pools, transfer, settings in
   Classic + Vanilla light + DEX dark at 390px AND 1440px. Record any
   unreadable combo as `Theme.<page>.<theme>.<width> — FAIL`.
4. Keyboard: Tab through market search → results → buy panel with NO
   mouse. Screen-reader (if available): focus order + announcements sane.
5. Amount inputs on phone: numeric keyboard appears (inputmode) — record.

## 16. Compatibility banner (dead-browser notice)

1. On your modern browser: confirm NO banner appears (it only shows when
   a required platform API is genuinely missing — silence is PASS).
2. Dismissal persistence is dev-tested; nothing for you to click unless
   the banner appears — if it does, screenshot + FAIL (your browser is
   modern, so it should not).

## 17. Extension wrapper Tier-1 drill (fresh profile, once)

1. Fresh browser profile → load unpacked `extension-wrapper/` (dev gives
   you the build) → open the app from the extension.
2. Create wallet → note a pubkey → Lock → Unlock → compare pubkey.
   Expected: identical, zero console errors.
3. Confirm the web build works with NO extension installed (wrapper is
   hardening, never a dependency).

## 18. Prediction markets (`#/prediction`, PMO, probability, portfolio)

1. Open `#/prediction` locked. Expected: Organizations (PMO) section,
   Active/Expired/My filter, Refresh, lookup, Create buttons, Portfolio
   with the viewing-as notice — zero console errors.
2. Filter to Expired, then My, then back to Active; click Refresh.
   - Expected: lists refilter, loading state shows during rescan, counts
     cover the scanned range honestly.
3. Open any market detail: confirm condition/expiry, probability panel
   (all four formats), Buy-YES/Buy-NO links route to instant-trade.
   - Expected: no price → honest "unavailable", never 50% by default.
4. Portfolio: Load with an unlocked testnet wallet holding a PMA.
   Expected: per-holding PnL in human terms; settle only on settled
   markets (Review → cancel unless dev orders broadcast).
5. Asset create: enter a short symbol (≤3) vs a long one (5+).
   - Expected: fee-tier line names the correct tier (symbol3/symbol4/
     long_symbol) beside the live fee; sub-asset (`PARENT.CHILD`) and PMO
     description templates prefill from their buttons.

## 19. Help (`#/help`)

1. Open `#/help`. Expected: 48 topic links, no English-only note, no
   mention of any old UI; Documentation section (2 links) and AI Assisted
   Help (deepwiki link) below the index — all open new tabs.
2. Open 3 articles (one new: trollbox; one old: backups; glossary).
   Expected: headings, paragraphs, and bullet lists render as structured
   text (never one giant block, never a raw `help.topic_*` key id).
3. Switch to Spanish, reopen `#/help`.
   - Expected: chrome translates; article bodies honestly remain English
     (stubs, not machine translation). Switch back.
4. Scroll to the community directory: Homepage, Code, Explorers, Forum,
   English Chat (5), Chinese Chat.
   - Expected: every link present with the exact URL from the list; all
     open new tabs.

## 20. What to send back

For every section: PASS/FAIL per numbered step + console-error text +
screenshots of FAILs + the exact numbers you recorded (§5.8, §11.4,
§3.4). A section is DONE when all its steps PASS at phone + desktop in
all three themes. Headless/dev results never override you — your browser
is the gate.
