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
