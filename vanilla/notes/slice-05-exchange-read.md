# Slice 05 — Exchange Read-Only: parity note

Date: 2026-09-27. Plan: `docs/superpowers/plans/2026-09-26-slice-05-exchange-read.md` (Task 4, this file).
Code Tasks 1–3 landed by prior workers; this note verifies (live WS + headless).
Worker scope: verification only — writes ONLY this file (+ throwaway `/tmp/mkt-*.js`, never committed). No commits.
Established facts reused without re-proof: Task-1 `formatPrice`/indicator vectors GREEN; `node --check` clean;
rot gate passes; market-ui split into `market-ui.js` + `market-book.js` + `market-orders.js` + `market-charts.js`.

## 1. Reference behavior

Chain contract ground truth (`bitshares-core`, sparse, read-only — verified `grep`, this session):

- `libraries/app/include/graphene/app/database_api.hpp:495` — `get_limit_orders_by_account(name_or_id, limit)`.
- `database_api.hpp:618` — `get_ticker(base, quote)`; `:636-637` — `get_order_book(base, quote, limit)`.
- `libraries/app/include/graphene/app/api.hpp:212` — `get_fill_order_history(a, b, limit)` (history api);
  `:229` — `get_market_history(a, b, bucket, start, end)`; `:239` — `get_market_history_buckets()`.
- `libraries/protocol/market.hpp` (fill_order_operation: pays/receives/fill_price{base,quote} integer
  amounts + asset_ids) — matches the live fill envelope recorded in §4.

Old-UI behavior (#1):

- MarketID convention `QUOTE_BASE` uppercase: `bitshares-ui/app/components/Exchange/MarketRow.jsx:70`
  (`marketID = quote.get("symbol") + "_" + base.get("symbol")`).
- Orientation (SETTLED per plan, verified not relitigated): displayed price = market-base_human /
  market-quote_human, where (quote, base) = URL-head / URL-tail. Chain `get_order_book` levels arrive as
  human strings via `price_to_string` (already base-per-quote) and render verbatim; fills/candles carry
  raw integers resolved via the Format BigInt path. Live proof in §4.
- #1 reads fills as `row.op` (order_history envelope, `MarketsStore.js:415-435`); candles resolve OHLC via
  `utils.get_asset_price` (`MarketsStore.js:831-890`). Both shapes confirmed live (see §4) — no contradiction
  with the plan's assumption, so no STOP was triggered.

Serializer: none new — read-only slice, no signing, no fees (fee-less note per plan Task 4 Step 5).

## 2. Vanilla implementation

- `vanilla/js/format.js` — `formatPrice` (Task-1 BigInt, exact plan algorithm). Size note: file is 59 lines
  (append-only per plan; export entries only).
- `vanilla/js/indicators.js` (63 lines) — `sma`/`ema` pure functions, Numbers-for-pixels only (header says so).
- `vanilla/js/market.js` (415 lines) — `parseId/assets/book/depth/trades/stats/candles/myOrders`.
  Slightly past the ~400-line split-candidate mark (see §6 note R2).
- `vanilla/js/market-ui.js` (617 lines, desk shell) + `vanilla/js/market-book.js` (267) +
  `vanilla/js/market-orders.js` (196) + `vanilla/js/market-charts.js` (256) — behavior-preserving §3.7
  split, accepted with note: shell still large because it owns picker + stats + refresh + routing glue;
  further split would scatter one screen's wiring across more files for no readability gain.
- `vanilla/js/router.js:43-81` — `/` redirects to last/default market; `/market/:marketID` renders
  `MarketUI.renderMarket` (`:70`); malformed ids fall through to the `render404` path (`:28,:116,:191`).
- Error sentences: `market-ui.js:141-147` (bad-market / bad-asset-shape / history-unavailable / wallet-locked),
  `market-book.js:56-62` + `market-orders.js:56-62` (same, per-file copies per transfer-ui.js convention),
  offline panel + Retry `market-ui.js:334,493`, locked-my-orders hint `market-orders.js:82-87`.

## 3. Manual test steps + observed result

Throwaway probe: `/tmp/mkt-probe.mjs` (stdlib-only WS, masked client frames per RFC 6455 — first version
forgot masking and timed out on login; fixed, never committed). Probe procedure per plan: discover, then vectors.

Headless (this environment, 2026-09-27; server `python3 -m http.server 8081 --directory vanilla`):

- Market page `@1440` (`#/market/USD_TEST`, default mainnet): desk renders — title, asset ids, spread line,
  book/charts/stats/picker sections, empty states, market list. Zero console errors. ✅
- Same page `@390`: stacked (charts → book), hamburger menu, no horizontal overflow. Zero console errors. ✅
- Same page `@1440` dark theme: all panels legible, search + list readable. Zero console errors. ✅
- Same page `@1440` light theme: renders acceptably. Zero console errors. ✅
- Bad market `#/market/BTS_BTS` @1440: "Market not found / Unknown market. Check the QUOTE_BASE pair
  (e.g. BTS_CNY)." Zero console errors. ✅ (error path, not just code)
- Data-rich page `#/market/USD_BTS` @1440 (mainnet public data): book/stats/trades/charts populate with
  real chain values (Latest 60, Best bid 60, Best ask 68.2534…, volumes 3055.02/50.917). Zero console
  errors. ✅ with FINDINGS F1 (spread) + F2 (overlap) below — recorded, not fixed (verification scope).

Error paths (code + live where possible):

- Bad market id `BTS_BTS` → `Market.parseId` throws `bad-market` → 404-style panel (shot proof above).
- Unknown asset (e.g. `ZZZ_QQQ`) → `lookup_asset_symbols` returns nulls → `bad-asset-shape` sentence
  (`market-ui.js:143`). Chain-verified: probe `lookup_asset_symbols` returns null entries for unknown
  symbols (ETH/LTC/EOS/KRW/HONEST.USD/XBTSX.USDT all null on testnet this session).
- History-plugin-missing: `testnet.xbts.io` HAS history (30 fills + buckets served this session), so the
  `history-unavailable` branch is code-covered only — tester step D covers a node without it.
- Locked my-orders: `Market.myOrders` throws `wallet-locked` unless unlocked; logged-out desk shows the
  unlock hint (`market-orders.js:82-87`) — tester step C confirms text.
- Offline panel + Retry: `market-ui.js:334,493` — tester step E (airplane-mode equivalent).

Browser (PENDING-BROWSER — follow steps A–E in order; record PASS/FAIL per step):

Setup (do once):
1. Open a terminal, `cd /workspace`, run `python3 -m http.server 8080 --directory vanilla`
   and leave it running. Confirm it prints `Serving HTTP on ... port 8080`.
2. Open Chrome/Edge/Firefox to `http://localhost:8080/`. Open DevTools (F12) → Console, keep it visible:
   any red error during the steps below is an automatic FAIL for that step — copy the message.
3. In Settings, switch to Testnet (`connected · 39f5e2ed · …`). All market steps below use testnet.

Step A — testnet desk with live book (phone width first):
1. Resize to 390px wide (DevTools device toolbar, e.g. iPhone 12). Go to `#/market/USD_TEST`.
2. PASS if: title "USD / TEST", "USD (1.3.15) / TEST (1.3.0)" subtitle, Bids table with ~50 rows at price
   "100" (chain-verbatim), stats row present, charts show "No price history on this market." +
   depth panel with bars (50 bids accumulate), markets picker lists USD_TEST/BTS_USD/BTS_CNY,
   no console errors. FAIL otherwise.

Step B — desktop width + theme trio:
1. Resize to 1440px. Reload `#/market/USD_TEST`. Then switch theme in Settings: original blue → light → dark.
2. PASS if: three-column desk (book | chart+trades | picker/stats) at 1440 in all three themes, no console
   errors. Note any stranded-narrow-column feel (see finding F3). FAIL on overlap/blank panel.

Step C — my orders locked + empty states:
1. While logged OUT, scroll to "My orders" on `#/market/CNY_TEST`: expect the "unlock to see your orders"
   hint with Wallet link (lite-test-1 has 0 open orders — verified live 2026-09-27 — so even unlocked
   the section shows the empty state, never a spinner forever).
2. `#/market/USD_TEST` trades section: expect the no-fills empty state (0 fills live). PASS if both,
   no console errors.

Step D — bad market + unknown asset + no-history node:
1. `#/market/BTS_BTS` → "Market not found" panel (headless proof exists; confirm in real browser).
2. `#/market/ZZZ_QQQ` → unknown-asset sentence, no blank screen.
3. If you can reach a node without the history plugin: fills/candles sections show the history-unavailable
   sentence (not blank). PASS if all three degrade gracefully, no console errors.

Step E — offline + refresh hygiene:
1. Open `#/market/USD_TEST`, note book content. Disconnect network (DevTools offline checkbox), click
   Refresh → offline panel + Retry (never blank). Reconnect, click Retry → desk rebuilds.
2. Navigate Dashboard → Exchange → Account → back: PASS if no cross-page 15s timers leak (book numbers
   stop updating once you leave the page; single refresh interval per visit), no console errors.

## 4. Raw→human test vectors

Market choice (probe-candidates procedure, `wss://testnet.xbts.io/ws`, 2026-09-27):

- `lookup_asset_symbols` found on testnet: TEST 1.3.0/p5, BTS 1.3.1420/p5, USD 1.3.15/p4, CNY 1.3.174/p2,
  BTC 1.3.1143/p4, EUR 1.3.19/p4, HERO 1.3.219/p5, GOLD 1.3.172/p2, SILVER 1.3.173/p2, USDT 1.3.1413/p4.
- Depth probe (limit 5, both orientations): only TEST/USD (5 bids) and TEST/CNY (3 bids) had books; all
  others 0/0. Full pull: (base 1.3.0, quote 1.3.15) = **50 bids / 0 asks** → chosen market **USD_TEST**
  (best liquidity). Second market **CNY_TEST** (base 1.3.0, quote 1.3.174) = 3 bids / 0 asks + **30 fills**.
- Non-TEST precision requirement: COVERED twice — USD leg p4 and CNY leg p2 (plus mainnet shape rows).

Book levels are chain-human strings (price/quote/base + order id/owner/expiry), displayed verbatim.
Hand-verification = independent inline BigInt reimplementation (no `format.js` import), then equality
against `Format.formatPrice(…, 8)`; value equality against the chain price string:

| # | row | rawB (prec) | rawQ (prec) | indep BigInt₈ | via format.js | chain verbatim | verdict |
|---|-----|-------------|-------------|---------------|---------------|----------------|---------|
| 1 | TEST/USD bid (0.10000 / 0.0010) | 10000 (p5) | 10 (p4) | 100.00000000 | 100.00000000 | "100" | ✅ same value |
| 2 | TEST/CNY L1 (1.10000 / 0.10) | 110000 (p5) | 10 (p2) | 11.00000000 | 11.00000000 | "11" | ✅ |
| 3 | TEST/CNY L2 (1 / 1) | 100000 (p5) | 100 (p2) | 1.00000000 | 1.00000000 | "1" | ✅ |
| 4 | TEST/CNY L3 (1 / 10) | 100000 (p5) | 1000 (p2) | 0.10000000 | 0.10000000 | "0.1" | ✅ |
| 5 | TEST/CNY fill `5.0.843235` fill_price | 149800000 (p5) | 74900 (p2) | 2.00000000 | 2.00000000 | ticker latest "2" | ✅ consistent |
| 6 | BTS/USD fill `5.0.200406289` (mainnet shape row) | 600000000 (p5) | 1000000 (p4) | 60.00000000 | 60.00000000 | ticker latest "60" | ✅ consistent |
| 7 | BTS/USD candle `5.1.45124612` open (mainnet shape row) | 5000000 (p5) | 6750 (p4) | 74.07407407 | 74.07407407 | — (round-half-up check) | ✅ |

Fills shape (live, testnet CNY market, 30 rows): order_history envelope
`{id 5.0.x, key:{base,quote,sequence}, time, op:{fee, order_id, account_id, pays:{amount,asset_id},
receives:{amount,asset_id}, fill_price:{base:{amount,asset_id},quote:{amount,asset_id}}, is_maker}}` —
matches the plan assumption (`row.op` preferred path). NO contradiction → no STOP. Cross-check: fill #5
pays 2000 TEST-raw (= 0.02) / receives 1 CNY-raw (= 0.01) → 2.00, equals fill_price ratio 1498/749 = 2. ✅
Testnet USD market fills: 0 rows → empty-state proof (UI must render "no fills", never hang).

Candle shape (live, mainnet `api.bitshares.dev` public-data only — testnet has none):
`{id 5.1.x, key:{base,quote,seconds,open}, open/high/low_base/quote RAW INTEGERS, base_volume,
quote_volume}` — matches the plan assumption. Bucket offer `[60,300,900,3600,14400,86400,604800]`
(mainnet) / `[60,300,900,1800,3600,14400,86400]` (testnet) → 3600-pick rule confirmed on both.
Testnet candles: 0 rows for both markets → empty-state proof; SMA(10)/EMA(50) overlays on empty input
stay covered by the GREEN Task-1 synthetic vectors (labeled as such, per plan).

My-orders: `get_limit_orders_by_account("lite-test-1", 100)` → `[]` (0 orders, 2026-09-27). Account name
from the task text; only public chain reads issued — <keys> never opened, never printed. No orders placed
(slice 6 owns trading). Empty-state proof recorded.

## 5. Theme + viewport checks

Headless proof this session (all with zero console errors):
- `@1440` original blue (`#/market/USD_TEST`): three-column desk, empty states, picker. ✅
- `@390` (phone): stacked chart→book, hamburger nav, connection badge wraps to two lines (cosmetic, usable). ✅
- `@1440` dark: panels, search, list all legible. ✅
- `@1440` light: renders acceptably (branded blue header retained). ✅
- Data-rich `@1440` (`#/market/USD_BTS`, mainnet public data): tables/charts/stats populate. ✅ modulo F1/F2.
- Bad-market `@1440`: 404-style panel. ✅
Full trio + both viewports in a REAL browser remain PENDING-BROWSER (tester Steps A–B).

## 6. Readability (§3.7)

- Every slice file opens with owns/consumes/side-effects/origin header (verified: market-ui, market-book,
  market-orders, market-charts, market, indicators headers all present; non-trivial functions carry
  what/params/returns/failure-modes — e.g. `market.js` _addDec/_fillPair/trades/candles/myOrders).
- Dead text: `grep -rniE "TODO|FIXME|XXX|HACK" vanilla/js/market*.js vanilla/js/format.js
  vanilla/js/indicators.js vanilla/css/` → zero hits. ✅
- R1 (accepted with note): `market-ui.js` is 617 lines — shell owning picker+stats+refresh+routing glue;
  the rendering split (book 267 / orders 196 / charts 256) already landed and is behavior-preserving.
- R2 (new note): `market.js` is 415 lines — marginally past the ~400 split-candidate mark. It is one
  coherent data layer (parse → fetch → normalize); splitting by endpoint would scatter the orientation
  proof. Recommend leaving, revisit if it grows.
- Comments explain WHY (orientation proof chain, pixel-vs-money boundaries, ambiguity log); float-grep
  hits are comments/pixel-only (see audit check 6).

## 7. Anti-rot gate (§4.5)

- (a) 2036 test: YES — `vanilla/` has no package.json/node_modules/lockfile, no framework imports, no CDN
  `<script src>`; chain surface is one module over plain WebSocket JSON-RPC; charts are Canvas2D;
  colors are CSS custom properties. Nothing in this slice adds a release-cycled dependency.
- (b) Newly depended on: NOTHING (no package, service, toolchain, or hosted asset added; testnet/mainnet
  node URLs are editable data, not code).
- (c) Smallest deletable subset: the depth-shading gradients + SMA/EMA overlays could go while the desk
  still reads (book/ticker/fills are the core). Kept because the plan mandates them for the DEX desk —
  they are ~150 lines of dependency-free canvas/CSS, not a future migration liability.

## Audit check results (auditing-vanilla-slices, all eight)

1. Rot gate: `python3 tooling/check_rot.py` → PASSED (exit 0); CDN grep clean; framework grep clean;
   `vanilla/package.json` + `vanilla/node_modules` absent. ✅ PASS
2. Retro look: desk mirrors #1 Exchange (book / chart / trades / picker / stats, QUOTE_BASE ids).
   Deviation analysis is headless-only → PENDING-BROWSER (tester Step B). ⚠️ PENDING
3. Feature coverage: read-only desk covers #1 Exchange read paths; place/cancel explicitly slice-6
   (no cancel-like controls rendered — verified in code). Astro-only ops (pools/HTLC/credit) are later
   slices, matrix unaffected. ✅ PASS (slice scope)
4. Modern glow: 15s refresh + manual Refresh, empty states, offline+Retry, typo-tolerant picker search —
   headless-confirmed; real-browser feel → PENDING-BROWSER. ⚠️ PENDING
5. Themes: trio renders headlessly (blue/light/dark proof above). Hex-literal grep: hits ONLY as
   `cssVar("--…", "#…")` fallbacks in `market-charts.js:125,156-158,174,213-214` (canvas needs a sync
   color read; values mirror `themes.css`). Conditional pass — tester to confirm no visual drift. ⚠️ PASS-WITH-NOTE
6. Human terms: `parseFloat|Math.pow(10` hits are comments only (`market.js:46,61`); `Number()` in
   `market.js:212,215-216,380` is depth-pixel/indicator-input only with exact-string twins kept
   (`totalBaseStr/totalQuoteStr`); `Math.round` in `market-charts.js:49-50` is DPR canvas sizing (pixels).
   7 live vectors incl. p2 + p4 non-TEST legs (§4). No raw integer reaches the screen by design. ✅ PASS
7. Both ends: `@390` + `@1440` headless proof (shots read, not just taken); touch targets/viewport/numeric
   keyboards need a real phone → PENDING-BROWSER (tester Step A). ⚠️ PENDING
8. Built to be read: headers ✅, function descriptions ✅, dead-text grep clean ✅, split landed
   (R1 accepted-with-note, R2 new note). ✅ PASS-WITH-NOTE

## Findings for the implementer (reported, NOT fixed — verification scope)

- F1 — spread/midpoint use the WORST ask, and asks render worst-first. Evidence: mainnet (BTS,USD) chain
  asks ascend 68.25 → 68.71 → 74.07… (probe, top-3), while the USD_BTS desk rendered asks top-down
  1000000 → 100000 → 99002… with "Spread 999940 · Midpoint 500030" (= 1000000−60, (1000000+60)/2).
  Code: `market-book.js:206` takes `bestAsk = asks[asks.length-1]` but `market-book.js:214` renders
  `asks.slice().reverse()` — consistent with chain-ascending input, i.e. both point at the dust tail.
  Ticker-derived "Best ask 68.25…" in stats is correct, so book and stats disagree on the same screen.
  Fix direction (slice owner decides): best ask = `asks[0]` with no reverse, or reverse consistently and
  take the post-reverse head; cross-check against #1 `OrderBook.jsx` (best-near-spread).
- F2 — layout overlap on data-rich books: the "Recent trades" heading paints over the asks-table rows
  (`/tmp/slice05-data-1440.png`: "…ent trades…" struck through row "1000.00297…"). Long-book grid
  containment needs a look (dense-grid 2560px+ check belongs here too).
- F3 — content column reads narrow at 1440 (~770px centered; whitespace both sides). Per §3.6 dense views
  should expand multi-column on wide monitors. Suggestion only; tester Step B records the verdict.

## Ruling log

- Orientation SETTLED per plan; live vectors (§4 rows 1–7) verify chain-verbatim levels + BigInt fills/candles.
- Fills envelope matched assumption (`row.op` order_history); candle raw-int shape matched assumption.
  No STOP-and-report triggered.
- No float-money, no keys, no commits. Mainnet used for public-data shape rows only.

## Repair 2026-09-26 (headless findings F1–F3, fixed same day)

- F1 (wrong number shown — principle #6): spread used `asks[last]` (worst) while
  the book renders reversed, so best-ask was wrong (`market-book.js`). Fixed to
  `asks[0]` (chain asks arrive best-first, proven vs ticker best-ask 68.25).
- F2 (reported trades/book overlap): NOT REPRODUCED on re-shot mainnet +
  testnet desks at 1440px — clean; likely an artifact of the pre-wide build.
  Left open for the tester to confirm or close in Step B.
- F3 (stranded narrow column): desk root used `.wrap` (720px cap), so the
  ≥1200px 3-column grid never breathed. Fixed: desk uses `.wrap.mkt-wrap`
  (1400px cap, new CSS rule) — verified on re-shot. (Deliberately NOT
  `.wrap.wide`, which would turn the wrapper into a 12-col grid.)
- Headless evidence: settings@1440, settings@390-dark, market@1440 (mainnet
  empty + testnet USD_TEST 50 bids + depth chart), market@1440-tall — all zero
  console errors. shot.mjs gained a `--network` flag (seeds settings before
  load) for network-specific shots.
