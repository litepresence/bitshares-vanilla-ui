# Retro recapture round 1 (2026-09-29)

One CSS-only audit→fix→recapture pass over the highest-traffic pages, forged
against `vanilla/notes/original-pages/` (35 captures, bts.exchange 2026-09-27)
plus `vanilla/notes/original-buy-sell-2x3-2026-09-28.png` and
`vanilla/notes/original-header-exchange-2026-09-28.png`.

Server: `python3 -m http.server 8081 --directory vanilla`. Shooter:
`PLAYWRIGHT_BROWSERS_PATH=/workspace/tooling/visual/.browsers node
tooling/visual/shot.mjs`. Every shot below was READ (no blind claims).
Touched file: `vanilla/css/app.css` ONLY (no JS, no strings, no behavior).

## Fixed (all in app.css, theme tokens only — 3 themes keep working)

1. **Base form-control skin (the big one).** No rule ever set
   input/select/textarea background/color/border, so every form fell back to
   browser-default WHITE boxes on the dark themes (transfer, swap, pools
   filters, voting proxy+search, explorer search, dashboard language, topbar
   theme select). Now `background: var(--bg); color: var(--text); border: 1px
   solid var(--border); border-radius: 0` (square kept), padding, and
   `::placeholder` in `--muted`. Precedent: `.mkt-indmenu-item input` already
   used `var(--bg)`.
2. **Check/radio 18px reset.** The global 44px min-height stretched the
   transfer encrypted-memo box into a giant square. Native boxes are 18px
   again (accent-color themed); wrapping `.xfer-field` label rows keep
   min-height 44px so touch targets stay ≥44px.
3. **Global `a { color: var(--accent); }`.** Explorer block/witness links
   rendered browser-default dark blue on dark grey (unreadable); now cyan
   like #1. Specificity audit: `#nav a`, `#lock-toggle`, `a.btn`,
   `.order-tabs a`, `.appfoot-actions a` all still win where they set color.
4. **Nav current-page: tint only.** Ours drew a cyan outline box around the
   active item; #1 highlights with background tint only. Outline removed for
   mouse, restored on `:focus-visible` for keyboard users.
5. **Warn dismiss plain ×.** Border removed to match #1's root.png banner.
6. **Wrap H1 density** (`.wrap > h1` 1.35rem): #1 has no giant page titles.
7. **Footer clearance.** `body` padding 44→64px (desktop) / 88→104px (phone):
   the transfer REVIEW TRANSFER bar's label was half-clipped by the fixed
   footer.
8. **Phone stat-strip wrap.** Bid/Ask fraction clipped past the 390px edge;
   now wraps via `overflow-wrap: anywhere` + `break-all`. Needed (0,2,0)
   selectors — the first attempt at (0,1,0) lost to the later desk rules by
   source order.
9. **REPORT/HELP invisible in dex-ux-theme (probed, not guessed).**
   `#appfoot a` (1,0,1) beat `.appfoot-actions a` (0,1,1), so button text
   resolved to `--accent` — which EQUALS `--button-bg` in dex-ux-theme (and
   vanilla-ui-theme): blue-on-blue, confirmed via computed-style probe
   (rgb(0,123,255) on rgb(0,123,255)). Now `#appfoot .appfoot-actions a`
   forces `--accent-text`. Also explains the washed look in ref-ui-theme
   (cyan on blue).

## Per-page deltas (found → fixed / deferred)

- `#/` dashboard: gate card wider than #1's, no logo mark, extra "Dashboard"
  H1, wording differs ("Import existing account" vs "restore your account …
  advanced form"). → fixed: theme/language selects, H1 size, dismiss ×.
  DEFERRED D7 (logo + wording need markup/strings).
- `#/market/BTS_CNY` desk: strip/quote pills/search now themed; nav tint;
  dex-ux spot-check green (REPORT/HELP legible, chart readable). Phone 390:
  strip wraps, no sideways overflow. → DEFERRED D1/D2/D8 (below).
- `#/pools`: white filter inputs → themed; table density already close to #1
  (cyan links, right-num columns, swap glyph). Pagination below fold not
  compared.
- `#/pools/1.19.2`: detail + stake/unstake/swap/delete column read clean;
  right-rail inputs/select now themed. No original detail capture exists —
  visual sanity only.
- `#/swap`: all inputs/selects + suffix units now dark; tabs/H1 tidy. (No #1
  counterpart — vanilla-only page.)
- `#/account/committee-account`: balances table correct + human-scaled.
  → DEFERRED D3 (tabs + 13-column layout is structural).
- `#/transfer`: fully recaptured — dark inputs, small checkbox, clear CTA.
  Fixed.
- `#/settings`: node table clean (latency/chain-id/down states live).
  → DEFERRED D5 (lands on nodes, #1 lands on General).
- `#/explorer`: cyan links, dark search, tinted nav, live head/irreversible
  line. → DEFERRED D6 (solid-blue tab bar vs #1 text tabs).
- `#/voting`: proxy/search inputs now dark; WITNESS/COMMITTEE/WORKER tabs +
  weighted rows render. → DEFERRED D9 (table shape vs #1).

## Deferred (expensive/structural — NOT gold-plated this round)

- **D1 (top): strip precision + fields.** Ours prints 16-decimal raw
  (`0.06434776124159851`) vs #1's 6-decimal (`0.064344`); ours shows Bid-Ask
  pair where #1 shows Feed Price + Settlement. Needs a format/precision
  decision in market-ind.js (behavior-adjacent) — do with the formatter,
  not in CSS.
- **D2:** markets sidebar is radio+buttons+simple list vs #1's MY/FIND tabs +
  VOL/PRICE/CHANGE table + stars + liquid-only filter. Structural.
- **D3:** account page lacks #1's 5 tabs, filter + Active/Visual toggle, and
  the 13-column balance table (in-orders/vesting/collateral/price/24hr/value
  + SEND/DEPOSIT/TRADE/BORROW/SETTLE). Structural.
- **D4:** buy/sell 2x3 below-fold comparison (fee/market-fee/expiry/ask/bid/
  balance block, BUY/BORROW/SELL buttons, depth books, MY OPEN ORDERS) not
  captured this round — take scroll/full-page shots next round.
- **D5:** settings default tab (nodes vs General).
- **D6:** explorer tab-bar restyle (solid blue bar vs text tabs).
- **D7:** dashboard gate logo + wording (needs markup + strings).
- **D8:** spread/midpoint 16-decimal line — same fix as D1.
- **D9:** voting table shape vs #1 (SUPPORTED/TOGGLE/JOIN/UPDATE/CREATE LOCK).

## Shots (all in /tmp)

Before: retro-dash, retro-desk, retro-pools, retro-swap, retro-account,
retro-transfer, retro-settings, retro-explorer, retro-voting, retro-pool2,
retro-desk-dark, retro-dash-phone, retro-desk-phone.
After: retro2-transfer, retro2-explorer, retro2-desk-dark, retro2-swap,
retro2-desk-phone, retro3-desk-phone, retro4-desk-phone (wrap fix verified).

## Verify

- `node --check`: N/A — zero JS files touched (CSS only).
- `python3 tooling/check_rot.py`: PASS.
- `python3 tooling/check_i18n.py`: N/A — zero strings added/changed.
- Anti-rot gates: (a) 10-year test — pure CSS + tokens, no new dependency;
  (b) newly depended on: nothing; (c) smallest deletable subset: the whole
  round-1 block is one revertible unit (single comment header).

---

# Round 2 (2026-09-29) — D1/D2/D3 structural deferreds

Closes the three structural deferreds above with small-JS + CSS (no
behavior/session change: no new routes, no signing path touched, no settings
shape touched). Same server + shooter as round 1
(`python3 -m http.server 8081 --directory vanilla`,
`PLAYWRIGHT_BROWSERS_PATH=/workspace/tooling/visual/.browsers node
tooling/visual/shot.mjs`). Every shot below was READ (no blind claims).
Touched files: `vanilla/js/{market-ind,market-desk,market-book,
market-picker,account-ui}.js` + `vanilla/css/app.css` + 5 locale keys × 10
dicts. Untouched per scope: reference/, docs/, tooling/, chain.js, tx.js,
wallet.js, crypto.js.

## D1 — strip precision + Feed/Settlement (CLOSED, one honest gap recorded)

- **trim6 at RENDER** (`market-ind.js` trim6, duplicated in `market-book.js`
  and `market-picker.js` per the no-shared-abstraction doctrine): pure string
  truncation of `^\d+\.\d{7,}$` to 6 decimals. Format math untouched; the
  full-precision chain string stays on each value's `title` attr (strip
  cells, spread line, picker cells). Live proof on BTS/CNY:
  Latest `0.064343`, Bid–Ask `0.063417 / 0.064337` (was 16-decimal raw),
  spread `0.000920 · Midpoint 0.063877`.
- **Feed Price cell** (`market-desk.js` fetchFeed, 2 RPCs once per desk:
  `lookup_asset_symbols` → `get_objects([bitasset_data_id])` →
  `current_feed.settlement_price`, oriented to market base-per-quote by
  asset_id via `Format.formatPrice`, legs that don't match the pair skip
  instead of guessing). Same read path as `asset-feed-ui.js` loadFeed —
  the clean path EXISTS, so NANO did not apply. Live: `0.066686` on
  BTS/CNY. Fails open (no cells) on non-MPA pairs and every error.
- **Settlement: honest half.** Globally-settled assets (`settlement_fund >
  0`) show the on-chain `settlement_price` as "Global Settlement" (same
  object, zero extra calls — #1 ExchangeHeader.jsx:161-189 rule). Live
  assets show NO Settlement cell: #1's estimate is feed ×/÷
  `(1 + force_settlement_offset_percent/10000)` in float on the
  reciprocal-oriented value; porting it needs exact reciprocal-percent
  string math — out of display-only scope. bitCNY is not globally settled,
  so the shot shows Feed only.
- D8 (spread/midpoint line) closed by the same trim.

## D2 — picker as MY/FIND table (CLOSED)

- Rows: star FIRST column, MARKET/VOL/PRICE/CHANGE header, one grid row per
  pair (CSS grid `44px 1fr auto auto auto`, tabular numbers, name
  ellipsizes). VOL comes from the SAME already-fetched get_ticker row
  (`raw.base_volume`) — no added batch, no invented data; rows hard-capped
  at 20 (dexux-plots.md N+1 ban). Prices trim6 + full title.
- All/★ Starred tabs mirror MY vs FIND (Starred = favs only; All keeps
  favs-first sort; `role=tablist`, `.mkt-tabs` style, 44px). Kind radios,
  quote buttons, search, typed QUOTE_BASE entry unchanged.
- Residual: change values stay uncolored (original is red/green) — candy,
  not structure; no new strings needed for it later.

## D3 — account tabs + density (CLOSED)

- Tab row Balances / Open Orders / History / Membership / Equity (our
  sections behind the original's 5-tab language; Balances default like #1;
  `role=tablist/tab/tabpanel`, `.mkt-tabs` style, wraps to 2 rows at 390px).
  Sections keep their h2s + independent async fills (hidden tabs keep
  filling, so switching never shows a stale loader).
- Density via CSS only: `.wrap.acct .node-table` 6px/8px padding +
  tabular numbers, no column dropped; phone <560px keeps the card swap.
- Also fixed while inside: the Equity h2 was a bare literal — now
  `t("account.equity_tab", "Equity")` (was an i18n hole).
- Residual: original's 13-column balance table (in-orders/vesting/
  collateral/price/24hr/value + SEND/DEPOSIT/TRADE/BORROW/SETTLE actions)
  is NOT ported — data columns we don't fetch (per-account price/value
  needs N tickers) and per-row action affordances are new behavior, out of
  this round. Tabs + density were the scoped ask.

## i18n (5 new keys, all 10 locales)

`market.stat_feed` "Feed Price", `market.stat_settle` "Settlement Price",
`market.stat_global_settle` "Global Settlement", `market.vol_label` "Vol",
`account.equity_tab` "Equity" — via `tooling/sync_locale_keys.py` (honest
stubs). Picker header otherwise reuses `pool.market_col`, `market.th_price`,
`market.chg_label`; tabs reuse `market.kind_all`, `market.starred_tab`.

## Shots (all in /tmp, all READ)

- r2-desk.png (1440, ref-ui): 6-decimal strip + Feed cell + trimmed spread +
  picker table with header/tabs. r2-desk-dexux.png: same legible in
  dex-ux-theme. r2-desk-phone.png (390): strip wraps, no sideways overflow.
- r2-acct.png (1440, ref-ui): 5 tabs (Balances active) + dense table.
  r2-acct-vanilla.png: same clean in vanilla-ui-theme. r2-acct-phone.png
  (390): tabs wrap 2 rows, cards view intact.

## Verify

- `node --check` on all 5 touched JS files: OK.
- `python3 tooling/check_rot.py`: PASS.
- `python3 tooling/check_i18n.py`: OK (2164 keys, 2833 call sites).
- 6 shots, zero console errors on every one (shooter exits 2 on errors).
- 44px: star buttons + links + tab buttons keep min-height 44px (JS
  touchable() + `.mkt-tabs`/`.mkt-picker-list` CSS); grid change adds no
  sub-44px target (header row is aria-hidden, non-interactive).
- Anti-rot gates: (a) 10-year test — platform APIs + vendored Format only,
  2-RPC read uses the single chain module; (b) newly depended on: nothing
  (no package, no service, no toolchain); (c) deletable subset: fetchFeed +
  feed cells revert independently of trim6; tabs revert to stacked sections
  by deleting the tab bar block.
- NOT verified headlessly: tab CLICK-through (shot.mjs has no click step;
  toggle mirrors the proven dashboard tab pattern) — needs the human
  browser pass: click each account tab + picker Starred tab + inspect a
  strip Feed title attr.

---

# Round 3 (2026-09-29) — settlement verification + picker change colors

Closes the two recorded Round-2 gaps: the Settlement half-cell and the
uncolored picker CHANGE column. Display-only (no new routes, no signing path,
no settings shape). Same server + shooter as rounds 1–2
(`python3 -m http.server 8081 --directory vanilla`,
`PLAYWRIGHT_BROWSERS_PATH=/workspace/tooling/visual/.browsers node
tooling/visual/shot.mjs`). Every shot below was READ (no blind claims).
Touched files: `vanilla/js/market-picker.js` + `vanilla/js/market-desk.js` +
`vanilla/css/app.css` + this note. Untouched per scope: reference/, docs/,
tooling/, chain.js, tx.js, wallet.js, crypto.js.

## Settlement cell (VERIFIED, one hardening edit)

- **#1 formula** (`ExchangeHeader.jsx:160-198`): globally-settled assets
  (`bitasset.settlement_fund > 0`) show the on-chain `settlement_price` as
  "Global Settlement" via `Price.toReal()` (float, `MarketClasses.js:275-285`)
  with a `1/x` float invert when the market base is BTS (`1.3.0`); live
  assets show feed ×/÷ `(1 + force_settlement_offset_percent/10000)` in
  float (`:190-198`).
- **Vanilla global path was already exact** (`market-desk.js` fetchFeed):
  legs map by `asset_id` onto the market base/quote and format through
  `Format.formatPrice` (BigInt, half-up to 8 places) — mathematically the
  market-oriented `toReal()` with the BTS-leg invert folded into the leg
  mapping, minus #1's float. MATH ported, not files. Round-3 edit is one
  line of discipline only: the settled flag went from `Number(fund) > 0` to
  an exact `BigInt(fundStr) > 0n` integer test (verified against
  `MarketClasses.js:59-63` `toSats` + `:275-285`: the fund is a raw chain
  integer, so the zero/nonzero verdict is integer business).
- **Display** already follows the Feed rule: the settle value renders through
  the strip's shared `cell()` (`market-ind.js` renderStrip) — trim6 at
  render, full-precision chain string on `title`. Non-MPA pairs and every
  failure still fail open (no cells, ticker strip stands).
- **Live proof is an honest empty:** bitCNY is NOT globally settled, so
  `#/market/BTS_CNY` shows Feed `0.066686` and no Settlement cell — exactly
  the designed behavior. The global-settlement branch (same object, zero
  extra calls) cannot be shot live today: no curated pair touches a
  globally-settled asset. Deliberately skipped: the live-asset
  offset-adjusted estimate stays out (needs exact reciprocal-percent string
  math #1 does in float — recorded in Round 2, still out of display-only
  scope). No estimate is shown anywhere; no guessing.

## Picker change colors (CLOSED)

- **Single renderer confirmed:** `MarketPicker.renderPicker` is the only
  picker renderer in the app (used by the exchange rail + the empty-market
  state, `market-desk.js:210,594`). No pool picker reuses it (pool tables
  own their columns; `pool-ui.js` has no ticker-change column) — so one
  paint point covers "both desks' pickers".
- **Sign test is string-only** (`market-picker.js` chgSign/paintChg):
  `+1.2`/`1.2` → pos, `-0.5` → neg, `0`/`0.00`/`-0.00` → zero,
  unparseable (`—`, `%`-suffixed, blank) → null (stays muted). Float never
  touches the text; percents still render verbatim (no trim6 — D1 rule).
- **Color is text-only via theme tokens** (`app.css`, (0,2,0) so it beats
  `.muted` with the JS also dropping `.muted` on pos/neg — either layer
  alone wins): pos → `var(--buy)`, neg → `var(--sell)`, zero →
  `var(--muted)`. Grid columns, rows, and targets untouched — no layout
  shift; the CHANGE span is non-interactive (no 44px rule applies; stars,
  links, tabs keep theirs).
- **Live state today is all-zero:** every curated ticker reads `0` change,
  so all visible CHANGE cells render muted — correct, not a miss. pos/neg
  proved by logic vectors (`0`→zero, `0.00`→zero, `-0.00`→zero, `+0`→zero,
  `1.2`→pos, `+1.2`→pos, `-0.5`→neg, `0.000001`→pos, `-12.34%`/`—`/`""`→
  null) plus the token mapping, which the dexux shot confirms legible.
  Human pass: re-check on a moving market for live green/red.

## i18n (zero new keys)

No new display strings (sign classes reuse existing cells; settlement keys
`market.stat_feed` / `market.stat_settle` / `market.stat_global_settle`
already landed in Round 2). `check_i18n.py`: OK (2164 keys, 2833 call
sites — unchanged).

## Shots (all in /tmp, all READ, zero console errors each)

- r3-desk.png (1440, ref-ui): strip Latest/Δ/Vol/Bid–Ask + Feed `0.066686`,
  no Settlement (honest empty); picker table VOL/PRICE/CHANGE with muted
  zeros; spread/midpoint trimmed.
- r3-desk-phone.png (390): strip wraps, no sideways overflow, Feed cell
  intact; picker below fold as before.
- r3-desk-dexux.png (1440, dex-ux-theme): same strip + picker legible in
  dark theme (token colors hold).

## Verify

- `node --check` on both touched JS files: OK.
- `python3 tooling/check_rot.py`: PASS.
- `python3 tooling/check_i18n.py`: OK (2164 keys, 2833 call sites).
- 3 shots, zero console errors on every one (shooter exits 2 on errors).
- 44px: no interactive element added or resized (CHANGE span is
  non-interactive); stars/links/tabs keep min-height 44px.
- Anti-rot gates: (a) 10-year test — platform DOM + vendored Format only,
  2-RPC read path unchanged, CSS is tokens only; (b) newly depended on:
  nothing; (c) deletable subset: chgSign/paintChg + 3 CSS rules revert to
  all-muted by deleting the paint call; the BigInt fund flag reverts to the
  Number test in one line.
 - Deliberately skipped: live-asset settlement estimate (float
  reciprocal-percent math — recorded above, not guessed); strip 24h Δ
  coloring (picker scope only); live green/red screenshot (chain shows all
  zeros today — logic vectors + token mapping stand in, human pass on a
  moving market).

---

# Error sweep (2026-09-29) — headless console-error pass over every §6 route

Same server + shooter as rounds 1–3
(`python3 -m http.server 8081 --directory vanilla`,
`PLAYWRIGHT_BROWSERS_PATH=/workspace/tooling/visual/.browsers node
tooling/visual/shot.mjs --url <route> --width 1440 --wait 9000`).
36 routes + 2 tall shots (`--height 2400/2000` for below-fold desk + pool
detail). Every screenshot below was READ (no blind claims). Zero JS/CSS
touched — sweep only, so `node --check` is N/A (nothing touched),
`check_rot` PASS, `check_i18n` OK (2164 keys, 2833 call sites), tree clean.

## Result: 34/36 clean, 2 known-expected errors, 0 regressions, 0 fixes

- **PASS, zero console errors (34):** `#/`, `#/market/BTS_CNY`,
  `#/market/BTS_USD`, `#/pools`, `#/pools/1.19.2`, `#/swap`,
  `#/account/committee-account`, `#/transfer`,
  `#/transfer/lite-test-1`, `#/explorer`, `#/explorer/assets`,
  `#/voting`, `#/assets`, `#/assets/create`, `#/htlc`, `#/proposals`,
  `#/tickets`, `#/credit-offer`, `#/samet`, `#/borrow`, `#/barter`,
  `#/vesting`, `#/alerts`, `#/news`, `#/instant-trade`, `#/prediction`,
  `#/fees`, `#/referrals`, `#/favourites`, `#/ops`, `#/wallet`,
  `#/login`, `#/help`, `#/nope-never-here` (honest 404 +
  "Go to Dashboard").
- **PASS with known-expected error (2, both pre-existing, not tonight's):**
  - `#/settings`: `wss://btsws.roelandp.nl/ws ... ERR_NAME_NOT_RESOLVED`.
    Standing tracked debt (SLICES.md: roelandp DNS-dead from sandbox, kept
    last, failover covers). Page renders the honest `down` row; 5/6 nodes
    show chain-id `4018d784` with latencies. No action.
  - `#/deposit-withdraw`: one `ERR_NAME_NOT_RESOLVED` resource load — the
    dead GDEX domain (slice-15 scope: GDEX dead DNS → manual-only). Page
    renders the honest `gateway-down: TypeError` line next to XBTSX/IOB ok.
    No action.
- **Tonight's areas re-verified in the tall shots (all render, zero
  errors):** desk 2x3 buy/sell (Buy BTS / Sell BTS / Trades with
  RECENT/MY tabs + live rows), quote panels (BTS/USD/BTC/TEST/USDT),
  depth + synthetic pool curve, pool map + provenance line, INDICATORS
  plots menu + MACD/volume sub-panes, header forgery + footer REPORT/HELP
  on every route, unlock previews (`UNLOCK & REVIEW`, viewing-as notices).
- **Live chain proof (bonus, via /tmp/feed-probe.mjs — repo untouched):**
  bitUSD `2.4.21` has `settlement_fund 2368199380699` (> 0, globally
  settled) while bitCNY `2.4.13` has fund `0` — so `#/market/BTS_USD`
  showing Feed `0.001410` + Global Settlement `0.048100` (both recomputed
  by hand from the returned legs through `formatPrice` quote-per-base) is
  exact chain-faithful rendering, and `#/market/BTS_CNY` showing Feed only
  is the designed honest empty. The frozen-looking USD feed is the stale
  on-chain `current_feed` of a settled asset, displayed verbatim — not a
  bug. (The feed looks "10x off market" only because post-GS feeds freeze.)

## Shots (all in /tmp/sweep/, all READ)

- `01-root` … `36-404` (1440×900 each) + `02b-desk-tall` (1440×2400:
  strip → charts rail → depth → pool map → volume → MACD → full 2x3 +
  trades) + `05b-pool2-tall` (1440×2000: price history → synthetic book →
  pool map → volume → curve → pool history rows).
- Residual non-blockers (recorded, not fixed — not regressions, do not
  gold-plate): MACD pane × sits tight against its label; `#/assets` +
  `#/fees` name ops 0–9 / 16 raw (`op_0`) with `—` fees on 4/5/8/10
  (pre-existing display, honest empties); LWC price-axis scale reads raw
  units (pre-existing chart behavior).
- Human browser pass still wanted: tab CLICK-throughs (account tabs,
  picker Starred — shot.mjs has no click step), live green/red picker
  CHANGE on a moving market, phone-width re-check of tonight's tall
  content (1440 only this sweep).

---

# Round 4 (2026-09-30) — punchlist-pages recapture (heavily-changed only)

Same server + shooter as rounds 1–3
(`python3 -m http.server 8081 --directory vanilla`,
`PLAYWRIGHT_BROWSERS_PATH=/workspace/tooling/visual/.browsers node
tooling/visual/shot.mjs --url <route> --width 1440/390`). Every shot below
was READ (no blind claims). Touched file: `vanilla/js/account-ui.js` ONLY
(small-JS display trim, no CSS, no strings, no behavior, no serializer).
Untouched per scope: reference/, docs/, tooling/, chain.js, tx.js, wallet.js,
crypto.js, CSS, locales.

## Fixed (one cheap-exact retro delta)

1. **Account PRICE(BTS) 16-decimal → trim6 at RENDER** (`account-ui.js`
   trim6, duplicated from `market-ind.js:639` / `market-book.js:162` /
   `market-picker.js:57` per the no-shared-abstraction doctrine): pure
   string truncation of `^-?\d+\.\d{7,}$` to 6 decimals. Format math
   untouched — `valueRawOf` still uses the FULL ticker string, so VALUE(BTS)
   and totals are unchanged; the full-precision chain string stays on each
   price cell/card `title` (table PRICE td + phone-card mid). Live proof on
   `#/account/committee-account`: SILVER `1547.987616` (was
   `1547.98761609907120743034`), GOLD `45977.011494` (was
   `45977.011494252873563218`), CNY `15.541518`, EUR `808.421734`, USD
   `60.975869` — matches the original `account.png` 5–6-decimal density
   (60.00000, 8.90000, 0.50000). D1 rule finally covers the portfolio
   column it missed.

## Per-page deltas (found → fixed / deferred)

- `#/market/BTS_CNY` desk (1440 + 390): strip Latest/Δ/Vol/Bid–Ask + Feed
  `0.066686` trimmed, spread/midpoint trimmed, picker VOL/PRICE/CHANGE
  table with muted zeros — rounds 2–3 hold. Phone 390: strip wraps, no
  sideways overflow. → NO FIX (already recaptured; below-fold 2x3 covered
  by the sweep tall shot).
- `#/account/committee-account` (1440 + 390): balances table correct +
  human-scaled; PRICE column was the 16-decimal outlier → FIXED above.
  Phone 390: tabs wrap, cards view intact (`r4-acct-fix-phone.png`). →
  DEFERRED R4-D1 (below): pill tabs vs original text tabs; per-row MANAGE
  links vs original icon/dash affordances; no-comma thousands (see below).
- `#/fees` (1440 + 390): General group + `# | Operation | Type |
  Standard fee | LTM fee` with scale applied + LTM column read clean
  (punchlist `7958649`). Phone 390: table rides its existing
  `overflow-x:auto` scroll wrapper (`fees-ui.js:182`) — columns scroll in
  place instead of hiding, per the code comment. No original fees capture
  exists — visual sanity only. → NO FIX (scroll contract already holds).
- `#/borrow` (1440 + 390): functional margin desk (positions + op-3 adjust
  + op-3 open + op-45 bids) renders clean, locked preview notices honest.
  Original `borrow.png` is the showcase splash (Create CDP + GET STARTED),
  not the margin desk — intentional product divergence (the desk is the
  functional home per punchlist `887a520`). → NO FIX (a splash-chrome
  restyle would misrepresent the desk; recorded, not gold-plated).
- `#/wallet` (1440 + 390): console card + unlock + honesty note render
  clean. Original `wallet.png` is the empty multi-wallet console (grey
  placeholder cards + RESTORE BACKUP / NEW LOCAL WALLET outline buttons) —
  different model by design (single-slot brainkey keystore; punchlist
  `f28d5e3`/`15b3e81` scope). → NO FIX (outline-button restyle is candy,
  not structure; model divergence is documented in the punchlist).
- `#/proposals` (1440 + 390): list + create-proposal forms render clean,
  locked viewing-as notice honest. No original proposals capture exists —
  visual sanity only. → NO FIX.

## Deferred (observed, NOT gold-plated this round)

- **R4-D1 (tabs): pill vs text.** All `.mkt-tabs` hosts (desk ALL/STARRED,
  account 7-tab row, pool/swap/dashboard toggles) render as bordered pills
  (`desk-grid.css` pill block wins over `app.css:744-752` text-tab rule —
  probed: account tab button computes to `1px solid + 8px radius + panel
  bg`). Original `market.png` (MY/FIND) + `account.png` (Balances/Open
  Orders/…) are borderless text tabs with accent underline. Unifying to
  text tabs is CSS-only but GLOBAL (every desk changes) — needs a design
  call, not a one-page hex tweak. Recorded, not attempted.
- **R4-D2 (account actions): all-links vs icon/dash.** Ours prints all 5
  MANAGE links on every row; original shows send-arrow/deposit-icon/trade-
  chart/borrow-help/settle-flag with dashes where N/A (needs availability
  logic — behavior-adjacent, out of display-only scope).
- **R4-D3 (thousands commas):** ours `136289.07401` vs original
  `136,289.07401` (QTY/VALUE/total). Grouping is display-only and cheap,
  but touches every money cell — batch with the formatter, not as a
  one-column tweak. Recorded.

## Shots (all in /tmp, all READ, zero console errors each)

- r4-desk.png (1440) + r4-desk-phone.png (390): desk + picker.
- r4-acct.png (1440, BEFORE) + r4-acct-fix.png (1440, AFTER: trimmed
  PRICE) + r4-acct-phone.png / r4-acct-fix-phone.png (390).
- r4-fees.png (1440) + r4-fees-phone.png (390): grouped fees + scroll.
- r4-borrow.png (1440) + r4-borrow-phone.png (390): margin desk.
- r4-wallet.png (1440) + r4-wallet-phone.png (390): console + unlock.
- r4-props.png (1440) + r4-props-phone.png (390): proposals.
- Originals compared: `original-pages/market.png`, `account.png`,
  `borrow.png`, `wallet.png` (fees/proposals have no original capture —
  sanity only, stated above).

## Verify

- `node --check vanilla/js/account-ui.js`: OK.
- `python3 tooling/check_rot.py`: PASS.
- `python3 tooling/check_i18n.py`: OK (10 dicts key-complete, 2587 keys;
  3495 t() call sites drift-free — zero strings added/changed this round).
- 14 shots, zero console errors on every one (shooter exits 2 on errors).
- 44px: no interactive element added or resized (trim changes text only;
  titles are non-interactive).
- Anti-rot gates: (a) 10-year test — pure string slice + title attr, no new
  dependency; (b) newly depended on: nothing; (c) deletable subset: trim6 +
  two title lines revert to verbatim 16-decimal by deleting the call.
- NOT verified headlessly: title-attr hover/long-press read (shot.mjs has
  no hover step) — needs the human browser pass: hover a trimmed PRICE
  cell + phone-card mid and confirm the full chain string shows.

---

# Round 5 (2026-09-30) — newest/changed pages recapture

Same server + shooter as rounds 1–4
(`python3 -m http.server 8081 --directory vanilla`,
`PLAYWRIGHT_BROWSERS_PATH=/workspace/tooling/visual/.browsers node
tooling/visual/shot.mjs --url <route> --width 1440/390`). Every shot below
was READ (no blind claims). Touched files: `vanilla/js/instant-trade-ui.js`
(one constant) + `vanilla/css/app.css` (one Round-5 block, tokens only).
Untouched per scope: reference/, docs/, tooling/, chain.js, tx.js, wallet.js,
crypto.js, locales (zero strings added/changed).

## Fixed (two cheap-exact retro deltas, no behavior change)

1. **Instant-trade stats 8-decimal → 6-decimal** (`instant-trade-ui.js`
   PRICE_PLACES 8→6): the `#/instant-trade/BTS_CNY` stats line printed
   8 places (`0.06434377`) while the desk strip (rounds 2–3, trim6) prints
   6 (`0.064343`). Same BigInt path (`humanPrice` + `effectiveHuman` via
   `ratioToDec`), only the place count changes; full-precision chain
   strings stay on `title` attrs. Live proof: Latest `0.064343` · Best bid
   `0.063417` · Best ask `0.064337` (was `0.06434377 / 0.06341714 /
   0.06433729`). Effective price + walkthrough table prices follow the
   same constant when typed.
2. **Transfer Send/Propose toggle as primary/ghost** (`app.css` Round-5
   block, CSS only): `#1 SendModal.jsx:551-564` renders Send vs Propose in
   an EqualWidthContainer with primary-solid vs ghost-outline by flag.
   Ours rendered both buttons solid cyan (SEND bold, PROPOSE normal,
   touching). Now `.xfer-mode` is an equal-width flex row (`display:flex;
   gap:8px`, buttons `flex:1`) and the inactive side
   (`button[aria-pressed="false"]`, already set by `refreshMode`) is
   ghost — transparent bg, accent text, 1px accent border
   (`(0,2,1)` beats the global `button` rule; active keeps solid
   `--button-bg`). Live proof on `#/transfer`: SEND solid, PROPOSE
   outline, equal widths with gap (`r5-transfer-fix.png`).

## Per-page deltas (found → fixed / deferred)

- `#/instant-trade/BTS_CNY` (1440 + 390 + tall): dual SELL/RECEIVE +
  swap + walkthrough render clean; stats were the 8-decimal outlier →
  FIXED above. Phone 390: panels stack, no sideways overflow. Original
  `instant-trade.png` is the minimal SELL/RECEIVE card (icons + bare ⇄
  + SELL button); ours is the functional convert superset by design
  (QuickTrade flow per file header: walkthrough + effective price + fee
  previews + REVIEW). → DEFERRED R5-D1: SWAP solid button vs original
  bare glyph (label change needs strings, out of CSS/small-JS scope).
- `#/borrow` (1440 + 390 + tall 2400): positions + op-3 adjust + op-3
  open + stepper ("Step 1 of 4" + PREVIOUS/NEXT) + op-45 bids render
  clean, locked previews honest. Original `borrow.png` is the showcase
  splash (Create CDP + GET STARTED), not the margin desk — intentional
  divergence (Round 4, punchlist `887a520`). → NO FIX.
- `#/wallet` (1440 + 390): console + unlock + honesty note render clean.
  Original `wallet.png` is the empty multi-wallet console (grey
  placeholder cards + RESTORE BACKUP / NEW LOCAL WALLET outline
  buttons) — different model by design (single-slot brainkey keystore;
  Round 4). → NO FIX (outline-button restyle is candy on divergent
  content, not structure).
- `#/proposals` (1440 + 390 + tall 2400): list (empty until LIST clicked
  — committee-account has no live proposals today) + create-proposal
  forms render clean. No original proposals capture exists; nearest
  reference is `Proposals.jsx` (scam/unknown badges, approver lists,
  NestedApprovalState) — ours ports WORDS-only trust badges + approvals
  cell + inline `<details>` raw JSON per code comment. → NO FIX
  (badges/approvals/raw JSON need live proposal data to shoot; empty
  state is honest).
- `#/transfer` (1440 + 390 + tall 2400): propose toggle was the
  both-solid outlier → FIXED above. Encrypted-memo 18px box, fee
  selector, REVIEW + gating reasons read clean. No original transfer
  capture exists; SendModal primary/ghost is the codebase counterpart
  (cited above). Phone 390: rows stack, toggle below fold scrolls in
  place. → FIXED.
- `#/vesting` (1440 + 390 + tall 2400): table empty until LIST clicked
  (no vesting for 1.2.0 today) + create op-32 + claim op-37 + blind
  panel render clean. Progress columns (Required/Earned/Remaining days
  + Available %) already match `AccountVesting.jsx:285-339` (#/balance_
  type/cashback/required/earned/remaining/available/action) per the
  punchlist build. → NO FIX (columns need live rows to shoot).
- `#/prediction` (1440 + 390): 10-column list renders (Asset /
  Description / Condition / Expiry / Validity / House / Market
  confidence / Predicted likelihood / Market / Details —
  `prediction-ui.js:364` + `appendRow`) vs original `prediction.png`
  8-column (ASSET/HOUSE/PREDICTION/MARKET CONFIDENCE/MARKET PREDICATED
  LIKELIHOOD/DESCRIPTION/RESOLUTION DATE/ACTION). Ours splits
  description into main/condition/expiry/validity and adds
  Market+Details links — superset, retro-faithful. Live row
  ABITS.JUN20BTS30 shows the long CJK description forcing the scroll
  region (nowrap per `.prediction-scroll` contract); remaining 8 cols
  sit right of the fold at 1440 with real data — same contract as
  pools/offers tables. Phone 390: toolbar wraps, table rides the scroll
  region (opt-in `display:table`). → NO FIX (unwrap would break the
  scroll contract; original shot shows "No Data" so wrap behavior with
  data is unprovable).

## Deferred (observed, NOT gold-plated this round)

- **R5-D1 (instant SWAP chrome):** ours solid "SWAP ⇅" button vs original
  bare ⇄ glyph. Restyle to ghost/bare is CSS, but the "SWAP ⇅" label
  itself differs (strings/i18n scope) — batch with the next copy pass,
  not as a lone hex tweak.
- **R5-D2 (wallet console card):** original centered title + placeholder
  cards + outline buttons vs ours left-aligned H1+H2 + links + solid
  UNLOCK. Model divergence (Round 4); card chrome on different content
  is candy.
- **R5-D3 (prediction description width):** long-CJK row forces scroll
  at 1440; original "No Data" shot cannot prove wrap-vs-scroll with
  data. Keep the scroll-region contract.
- **R5-D4 (proposals/vesting live rows):** badges/approvals/raw JSON
  (proposals) and progress columns (vesting) need funded accounts with
  live objects to shoot — empty states verified honest today; human
  pass with live data wanted.

## Shots (all in /tmp, all READ, zero console errors each)

- r5-instant.png (1440, BEFORE) + r5-instant-fix.png (1440, AFTER:
  6-decimal stats) + r5-instant-phone.png / r5-instant-fix-phone.png
  (390) + r5-instant-tall.png (1440×2000: REVIEW + full-desk link).
- r5-borrow.png (1440) + r5-borrow-phone.png (390) + r5-borrow-tall.png
  (1440×2400: open form + stepper + op-45).
- r5-wallet.png (1440) + r5-wallet-phone.png (390).
- r5-props.png (1440) + r5-props-phone.png (390) + r5-props-tall.png
  (1440×2400: create form + enclosed ops).
- r5-transfer.png (1440, BEFORE) + r5-transfer-tall.png (BEFORE tall:
  both-solid toggle) + r5-transfer-fix.png (AFTER tall: ghost toggle)
  + r5-transfer-phone.png / r5-transfer-fix-phone.png (390).
- r5-vesting.png (1440) + r5-vesting-tall.png (1440×2400: op-32 +
  op-37 + blind) + r5-vesting-phone.png (390, in batch).
- r5-pred.png (1440) + r5-pred-phone.png (390).
- Originals compared: `original-pages/instant-trade.png`,
  `borrow.png`, `wallet.png`, `prediction.png` (transfer/proposals/
  vesting have no original capture — codebase counterparts cited
  above, sanity only as stated).

## Verify

- `node --check vanilla/js/instant-trade-ui.js`: OK.
  `node --check vanilla/js/transfer-ui.js`: N/A — untouched (CSS-only
  toggle; transfer-ui.js read for the aria-pressed contract only).
- `python3 tooling/check_rot.py`: PASS.
- `python3 tooling/check_i18n.py`: OK (10 dicts key-complete, 2587 keys;
  3495 t() call sites drift-free — zero strings added/changed).
- 18 shots, zero console errors on every one (shooter exits 2 on errors).
- 44px: no target added or resized (place-count changes text only;
  ghost toggle keeps `touchable()` min-heights + flex equal widths;
  phone stacks verified at 390).
- Anti-rot gates: (a) 10-year test — one integer constant + 3 CSS rules
  on tokens, no new dependency; (b) newly depended on: nothing;
  (c) deletable subset: PRICE_PLACES reverts to 8 in one digit; the
  Round-5 CSS block deletes to both-solid buttons.
- NOT verified headlessly: propose-mode CLICK-through (shot.mjs has no
  click step — toggle mirrors the proven pattern; ghost shows on the
  inactive side by aria-pressed) — human pass: click PROPOSE, confirm
  proposer/expiry/review-period reveal + ghost flips to SEND.
