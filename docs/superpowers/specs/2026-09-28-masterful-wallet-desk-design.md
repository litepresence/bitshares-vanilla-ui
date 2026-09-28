# Masterful Wallet + Trading Desk — Design Spec

Date: 2026-09-28. Scope: burger menu, dashboard, exchange orderbook desk, pools/swap desk, global polish.
Refs: `bitshares-ui develop 79f8cca`, vanilla `SLICES.md` (slices 1–18 built, browser passes pending), `vanilla/notes/original-pages/` (35 shots), `vanilla/notes/viewport-gaps.md`, op-coverage matrix (0 unjustified missing).
Doctrine: AGENTS.md §4.5 anti-rot — zero runtime deps, platform APIs only, vendor-never-depend, no build step, `tooling/check_rot.py` green per phase.

## 1. Audit summary (evidence)

- Shell: ref has warning banner + black header + live footer latency/block + REPORT/HELP. Vanilla has flat blue topbar + 7-link nav row + connect-time-only footer (`app.js:387-399`).
- Burger: vanilla `#nav-directory` 46 links, absolute `70vh` panel, inline styles (`app.js:164-232`), no search/active/Esc/close-on-nav. Open-tap unverified (`viewport-gaps.md:27,79`).
- Dashboard `/`: ref `root.png` is Create/Login gate card. Vanilla `dashboard-ui.js` is watched-account overview (`committee-account 1.2.0`) — neither gate nor portfolio.
- Exchange: ref `market.png` stat strip + TV chart + right rail (liquid-only, star-only, Filter, quote buttons BTS/BTC/CNY/USD, MARKET/VOL/PRICE/CHANGE) + BUY/SELL LIMIT/SCALED with unit suffixes. Vanilla: LWC+canvas (no drawings), picker 4 curated + favs only, `trade-form.js:982` single flow, no click-book-to-fill, 1400px-centered desk with ~580px gutters at 2560, long phone stack.
- Pools: ref `pools.png` 3 searches + size select + dense 10-col table + pagination 1..11. Vanilla: filters stack well; 390px shows 3/10 cols (scroll unverified); split `#/pools / #/pools/:id / #/swap`; virgin-mint + withdraw-0 traps unexplained.
- 8-check: rot PASS; retro PARTIAL; coverage 0-missing; glow PARTIAL (search weak); themes trio renders, default disputed + 2 `#fff`; human terms PASS; viewports FAIL (stranded column + form overlap); readability PASS with exceptions (`tx.js:2411`, `trade-form.js:982`).

## 2. Architecture

- No new modules, no deps, no build. Work lands in existing files: `app.js` (nav), `dashboard-ui.js`, `desk-grid.css` + `market-picker.js` + `market-book.js` + `trade-form.js` (desk), `pool-ui.js` + `pool-detail-ui.js` + `pool-swap-ui.js` (pools), `app.css` + `themes.css` + `PALETTE.md` (polish).
- One purpose per file preserved; splits only where file already past ~400 lines with a clean seam (`trade-form.js` form sections, never a framework).
- Data flow unchanged: `Chain` sole socket, `Store` sole settings, views render from caller-supplied data. No new chain methods (chain-history only; ES refused).

## 3. Phases

### A. Burger → command palette
Owns: slide-over panel replacing absolute dropdown. Search input filters 46 links (substring, case-insensitive; typo-tolerance = substring, never fuzzy lib). Active route highlighted via `location.hash`. Esc closes, link click closes, focus returns to toggle. Single theme copy removed from nav (stays settings + footer). `app.js` only; CSS via `app.css` classes (inline styles deleted).
Fail modes: missing nav = no-op; Icon absent = text links. Never blank, never throws.

### B. Dashboard → home
Locked: gate card (logo, Create/Login, restore/advanced, language select — mirrors `root.png`). Unlocked: portfolio pulse (balances top-5, fav markets with last price, recent activity 10, alerts entry, quick links). Locked fallback keeps `committee-account` watch with notice. `dashboard-ui.js` + `router.js` fallback untouched.

### C. Exchange desk density
Fluid widths: `.wrap` → `min(94vw,1080px)`, `.mkt-wrap` → `min(96vw,2200px)` ≥1440 (`app.css:26-27`). Desk ≥1600px: `320px minmax(0,1fr) 320px` (book|chart|rail). Rail: quote-button row + liquid-only checkbox + star-only + filter + keyboard nav (arrows + Enter). Book rows clickable → fill trade-form price. LIMIT/SCALED tabs compact; spread/mid sticky header. Empty states + offline Retry kept.

### D. Pools swap desk
List keeps 3 searches + size + sort (volume/APY) + pagination. Row click opens inline detail + swap/stake box side-by-side ≥1200px (stacked below). Inline explainers: virgin mint = max(raw) rule, withdrawal = 0-only trap. Phone cards carry all 10 fields. No new ops.

### E. Global polish
Live footer block (refresh on `new_block` via existing connection sub, no new socket). Warning-banner slot (dismissible, localStorage). Transfer/credit labels-above-inputs ≤720px, 2-col grid above. `.wide` assigned to explorer/voting/account ≥1200px. `overflow-x:clip` body. Consume `PALETTE.md` 93 vars; delete 2 `#fff`; resolve theme-default (darkTheme per `branding.js:72-74` stays default — record decision, close morning question).

## 4. Error handling

Every view keeps: offline panel + Retry, unknown-id empty states (never blank), wallet-locked unlock hints, `textContent`-only chain strings, `aria-live` errors. Panel/desk failures degrade to list + Retry, never spinner-forever.

## 5. Testing

Per phase: `node --check` on touched files, `python3 tooling/check_rot.py` PASS, `grep TODO|FIXME` clean, headless `shot.mjs` 390 + 1440 zero console errors (human browser pass stays gate per SLICES.md), viewport checks recorded in parity-note addendum, raw→human vectors untouched (no money-math changes except exact-string paths already proven).

## 6. Anti-rot answers

(a) 2036: static HTML/CSS/vanilla JS, no CDN, no framework — runs. (b) New deps: none; LWC already vendored with hash, removable to canvas fallback. (c) Smallest deletable per phase: A search (plain list remains), B portfolio pulse (gate remains), C quote-row (typed entry remains), D explainers (forms remain), E banner (footer remains). None deleted — all pay for themselves in discoverability/density.

## Self-review

- Placeholders: none — all files/lines cited, no TBD.
- Consistency: phases touch disjoint file sets except `app.css` (A vs E) — order A before E, E rebases on A. No architecture contradiction.
- Scope: single spec, five sequential phases, each shippable alone. Not too large for one plan cycle.
- Ambiguity: search = substring (explicit, not fuzzy); theme default = darkTheme stays (explicit); footer block = existing connection event (explicit, no new socket).
