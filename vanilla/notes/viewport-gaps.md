# Viewport gaps — 10 routes × 390px × 2560px (headless, testnet)

> Worker pass, 2026-09-28. Server: `python3 -m http.server 8081` on `/workspace/vanilla`.
> Shots: `tooling/visual/shot.mjs --network testnet`, 390×844 (phone) + 2560×1080 (desk).
> PNGs: `/tmp/viewport/<route>-<width>.png` (20 total, ALL read by the worker).
> Result: **zero routes failed to render, zero console errors on all 20 captures.**
> All shots show live testnet data (head blocks #1009432xx–#100943368, `lite-test-1`
> balances incl. 38.73890 TEST, pools list, blocks table, fee table).

## Per-route verdicts (390px phone)

| Route | Verdict | Notes |
|---|---|---|
| `#/` (→ USD/TEST desk) | PASS w/ minor | Badge wraps 2 lines, readable. Ticker card wraps. Timeframe radios 2 rows, indicator checkboxes wrap, INVERT fits. Book/markets below fold = long scroll, acceptable. No page-level h-overflow. |
| `#/transfer` | GAP (minor, CSS) | Label+input inline rows cramped (`To (name or 1.2.N)` squeezes its input). No overflow; REVIEW TRANSFER prominent; all targets 44px (`app.css:49`). Fix: stack labels ≤559px. |
| `#/market/USD_TEST` | PASS w/ minor | Same view as `#/`. Bids table renders (100-price rows) despite "empty book side" spread note. No overflow. |
| `#/pools` | GAP (verify) | Filters stack full-width, good. 10-col table shows only POOL ID / SHARE ASSET / ASSET A — rest clipped. CSS declares `.pools-scroll{overflow-x:auto}` + sticky first col (`app.css:242-248`), so the *intent* is a scroll region, but touch-scroll + sticky were NOT gesture-verified headlessly. Needs human swipe test. |
| `#/account/lite-test-1` | PASS | Balances as stacked cards, UPGRADE fits, no overflow. One-handed usable. |
| `#/voting` | PASS w/ minor | Proxy input + SET PROXY fit one row. Tabs wrap to L (REMOVE / WIT+COMM / WORKERS). Rows wrap weight to 2nd line — readable. Checkboxes get `touchable()` 44px (`vote-slate.js:288`). No overflow. |
| `#/explorer` | PASS | Search + SEARCH fit side-by-side; tabs fit; blocks table fits with Time wrapping 2 lines — dense but legible. No h-overflow. |
| `#/settings` | PASS | Node cards (`node-cards` <560px, `app.css:42-48`), radios, PROBE ALL/ADD, Theme/Language all stack. Textbook. |
| `#/credit-offer` | GAP (minor, CSS) | Same inline-row cramp as transfer (`Owner [1.2.0]`, `Asset […]` share lines). No overflow. Same fix. |
| `#/assets` | PASS | Links wrap, issuer input + LOAD stack, fee Op/Fee table fits. |

Phone-wide notes:
- Hamburger visible in all 10 shots, nav correctly hidden by default (`app.css:30-35`).
  **OPEN-state (tap → menu) was NOT exercised headlessly — human tap test required.**
- Touch floor is implemented, not just claimed: global `button,select,input{min-height:44px}`
  (`app.css:49`) + per-view `touchable()` setting 44px min-height (vote checkboxes,
  market controls, transfer inputs, etc.). Radios/checkboxes *look* small but carry
  44px hit height. PASS on targets with that evidence.
- No page-level horizontal overflow visible in any 390 shot (pools/dense tables clip
  inside their own regions only).

## Per-route verdicts (2560px desk)

**Global finding (all 10 routes): content strands in a centered narrow column.**
- 7 routes use `.wrap{max-width:720px}` (`app.css:26`) → ~920px empty margin per side
  (transfer, account, voting, explorer, settings, credit-offer, assets). Readable but absurd.
- Market + pools use `.wrap.mkt-wrap{max-width:1400px}` (`app.css:27`; assigned in
  `market-desk.js:176`, `pool-ui.js:279`, `pool-detail-ui.js:42`) → ~580px margin per side;
  the 3-col desk (Order book | Charts | 24h stats/Markets) is squeezed mid-screen while
  >40% of the viewport sits empty gray.
- `.wrap.wide` (max-width:none + 12-col grid ≥1200px, `app.css:28-29`) EXISTS but **no
  route assigns it** (grep: only `mkt-wrap` is assigned). Dead mechanism.
- Top nav bar correctly uses full width on all shots. Density/legibility otherwise fine.

| Route | 2560 verdict |
|---|---|
| `#/`, `#/market/USD_TEST` | GAP — desk squeezed into 1400px center; chart + book + stats cramped while sides empty. |
| `#/transfer` | GAP (worst single page) — inline label+input rows visibly **overlap/stagger** (inputs overlap each other diagonally) inside the 720px column. Looks broken, not just narrow. |
| `#/pools` | GAP (mild) — 10-col table fully visible and readable (best desk page), still centered w/ big margins. |
| `#/account/lite-test-1` | GAP (mild) — single narrow balances column; orders/history stacked below; stranded. |
| `#/voting` | GAP (mild) — rows read well (name left, weight right on one line — *better* than phone), stranded column. |
| `#/explorer` | GAP (mild) — table legible, stranded; a desk wants full-bleed table + sticky first col. |
| `#/settings` | GAP (mild) — node table readable, stranded. |
| `#/credit-offer` | GAP — same inline-row stagger as transfer in filter + create-offer forms. |
| `#/assets` | GAP (mild) — fee table readable, stranded. |

## Prioritized fix list

### CSS-only (do first)
1. **Form rows** (fixes transfer/credit 2560 overlap + 390 cramp): labels above inputs
   below ~720px; 2-col grid (label col + input col) above. Touches `transfer-ui`,
   `credit-ui`, settings proxy row only — no logic change.
2. **Desk width caps**: `.wrap` 720px → fluid `min(94vw, 1080px)` and `.mkt-wrap`
   1400px → `min(96vw, 2200px)` at ≥1440px breakpoints. Two declarations, huge payoff.
3. **Market desk ≥1600px**: 3-col grid `320px minmax(0,1fr) 320px` (book | chart | stats)
   so the chart breathes instead of squeezing.
4. **Body safety**: `overflow-x: clip` on body + audit fixed-pixel widths >360px, so any
   future table can only ever clip inside its own scroll region, never the page.

### Structural (JS/layout, still no deps)
5. **Assign `.wide`**: wire the existing (dead) `.wrap.wide` 12-col grid to
   explorer / voting / pools / account ≥1200px (e.g. account: balances+orders side by
   side; explorer: full-bleed table). Extend the ≤559px scroll-region + sticky-first-col
   contract (`app.css:242-248` pattern) up to these views.
6. **Voting rows ≥720px**: keep weight on one line (nowrap/ellipsis) — cosmetic.
7. **Human-device verification** (cannot be proven headless): hamburger open-state tap,
   pools-table swipe + sticky col at 390, transfer form one-handed flow. The human
   browser pass stays the gate.

## Worst 3 gaps
1. **2560 stranded column on every route** (720px cap ×7, 1400px ×market/pools; `.wide`
   mechanism exists but is assigned nowhere) — principle #7 "wide screens earn their
   pixels" fails globally.
2. **Transfer (/credit) form rows overlap at 2560**, cramped at 390 — inline
   label+input layout breaks at both ends; looks broken, not just narrow.
3. **Pools 10-col table at 390 shows 3 cols** — scroll region exists in CSS but is
   gesture-unverified; same human-test debt as the hamburger open-state.
