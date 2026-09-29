# Retro evening rotation parity (2026-09-28 → 2026-09-29)

Rotation scope: deep-live candles (exchange + pool), pools-list cleanup,
plot-ground/volume/time-sync/depth/mesh/Plots/VWAP, logged-out quote panels +
retro 2x3 grid, header forgery + footer REPORT/HELP + pools-swap cues, pool
provenance map, unlock previews (gate repairs + typed-account surfaces), candy
block, recapture rounds 1–3, networkx verdict, extension Tier-1 seam +
scaffold, QTradeX `interpolate_previous` port + `normalize` refusal.
HEAD at note time: `afc65dd`.

Read first: `vanilla/notes/retro-round-1.md` (rounds 1–3 record),
`vanilla/notes/dexux-networkx-verdict.md`,
`docs/superpowers/specs/2026-09-29-exchange-deep-live-candles-design.md`,
`docs/superpowers/plans/2026-09-29-exchange-pool-deep-live-candles.md`,
`extension-wrapper/TEST-PLAN.md`, plus every `git show --stat` below and the
cited `vanilla/js` lines. Nothing below is invented: claims without a
`file:line` are labeled builder-cited or UNRESOLVED.

## Honesty header (read before trusting anything below)

- **Everything tonight is headless-only.** No human browser pass ran on any
  of these commits. Builder headless proof = `tooling/visual/shot.mjs`
  (`PLAYWRIGHT_BROWSERS_PATH=.../.browsers`, exits 2 on console errors) with
  shots in `/tmp` (present at note time; `retro*`, `r2-*`, `r3-*`,
  `poolmap-*`, `candy-*`, `seam-*`). Note author personally READ
  `/tmp/r3-desk.png` and `/tmp/poolmap-market.png` (see §12); all other shot
  claims are builder-recorded in `retro-round-1.md`, not re-read here.
- Re-ran + read by the note author: `node --check` on 11 touched JS files
  (all OK), `tooling/market-fills-test.js` (16/16), `tooling/pool-graph-test.js`
  (11/11), `tooling/indicators-parity-test.js` (63/63),
  `tooling/wallet-seam-test.js` (13/13), `tooling/check_rot.py` (PASS),
  `tooling/check_i18n.py` (OK, 2164 keys / 2833 sites). No shooter run, no
  chain probe run by the note author.

---

## 1. Deep candles 1–5 + spec + plan (commits `7886ccc`, `41d3929`, `6cad182`, `557f677`, `e863a28`, `22804b9`, `336acd9`, `267efe9`)

**What landed (files:lines).**
- Spec: `docs/superpowers/specs/2026-09-29-exchange-deep-live-candles-design.md`
  (148 lines; amended once for the pools strict-ES rule). Plan:
  `docs/superpowers/plans/2026-09-29-exchange-pool-deep-live-candles.md`
  (215 lines, 5 tasks, one commit each).
- 1/5: new `vanilla/js/market-fills-history.js` (325 lines) + `tooling/market-fills-test.js`
  (78 lines) + one script tag in `vanilla/index.html`.
- 2/5: `vanilla/js/market-candles.js` deep merge (`:269-301`, result carries
  `deep:true|false`, `closes[]` rebuilt post-merge at `:301`).
- 3/5: `vanilla/js/chain.js` market-notice slot — `MARKET_CB_ID = 2` (`:32`),
  notice routing (`:239-243`), `subscribeMarket` (`:300-313`),
  `unsubscribeMarket` (`:315-329`).
- 4/5: `vanilla/js/market-desk.js` exchange live loop — documented `:704-705`
  (500 ms debounce, 3.5 s poll fallback), `onPush` (`:759`), subscribe call
  (`:791-792`), teardown via existing `_cleanups`.
- 5/5: `vanilla/js/pool-detail-ui.js` pool live tip — `poolLive` state
  (`:299-300`), head poll + `get_block` op-63 scan (`:293-356`), `live` suffix
  in the count note (`:278`).

**Reference behavior (re-verified file:line).**
- #4 `reference/bitshares-core/.../api.hpp:212` `get_fill_order_history`,
  `:239` `get_market_history_buckets`, `:222` bucket-must-be-offered
  constraint; `.../database_api.hpp:602` `subscribe_to_market`,
  `:1535` its api registration.
- #5 `reference/bitshares-dex-ux/kibana_queries.py:92` `kibana_fills` (op-4),
  `kibana.py:280` `discrete_to_candles`.
- #1 `MarketsActions.js:425-440` (subscribe_to_market + batch, re-verified;
  500 ms batch constants at `:17,:21`); #2
  `reference/astro-ui/src/bts/ws/ChainWebSocket.ts:168-169`
  (`set_subscribe_callback` / `subscribe_to_market`).

**Test vectors.**
- Money (raw→human, `tooling/market-fills-test.js:36-45`, re-ran green):
  opposite-direction fills `100000×1.3.0(p5)` / `5000×1.3.113(p4)` share one
  1h slot and orient to the same base-per-quote price (1.0/0.5 = 2.0-scale,
  asserted equal to `Format.formatPrice` output); base-leg volume
  `100000+200000` raw asserts equal to `Format.formatAmount("300000", 5)`.
- Logic + counts: merge keeps both slots, chain wins overlap (`:23-25`); cap
  slices oldest-off (`:28-31`); leg-guard accepts pair / rejects foreign leg /
  rejects non-op-4 (`:47-53`); `esQuery` size-500 + op-4 filter + block_time
  desc (`:55-60`); deep orchestration returns buckets capped 2000 with fetch
  stubbed dead (`:62-75`) — 16/16 pass re-run.
- Live-patch vectors (in-slot H/L/C/V update, cross-slot roll, last-price
  tracking) exist in the spec (§6) but were NOT executed headless tonight —
  honest gap, needs the human pass with a moving market.

**Manual/headless proof.** Builder headless per plan Task 4/5 (desk + pool at
1440/390, trio themes, zero console errors — builder-recorded, not re-run
here). Note author re-ran unit vectors only.

**Anti-rot.** (a) ES host dies → `fillsForMarket` degrades to chain
(`market-fills-history.js:203-206`), subscribe rejected → 3.5 s poll, 15 s
floor remains — desk works with zero network beyond the node. (b) New deps:
none (`fetch` is platform; ES URL is data like a node URL).
(c) Deletable: ES module (chain covers), live slot (poll covers), deep merge
(200 chain slots remain). `check_rot.py` PASS re-run.

---

## 2. QTradeX `interpolate_previous` port + `normalize` refusal + node-bucket probe

**What landed.** Provenance block `vanilla/js/market-fills-history.js:15-24`:
slot grid `floor(unix/size)` + miss rule (volume 0, O/H/L/C = prev close;
first slot uses first close) ported from `qtradex/public/klines_bitshares.py`
`interpolate_previous` and #5 `kibana.py:discrete_to_candles`; gap-fill lives
in `MarketCandles` prev-close carry (`market-candles.js:126,239-243`);
upstream `normalize` wick-clamping explicitly NOT ported (`:23-24`).
Refusal rationale (recorded in-code): `normalize` is a bot-outlier filter that
clips wicks — a wallet must show chain truth, never clipped wicks. Beyond-Tulip
indicator math provenance lives separately in `vanilla/js/indicators-qx.js:1-14`
(`qi.pyx` suite, per-fn lines cited, 63 vectors green re-run).

**Reference behavior.** #5 `kibana.py:280` (re-verified); QTradeX upstream
paths are builder-cited from code comments — **not re-verified by the note
author** (no QTradeX checkout in `/workspace/reference`).

**Node-bucket probe result: RESOLVED 2026-09-29 (re-proven live twice).**
`tooling/market-buckets-probe.mjs` (stdlib WS, committed): BTS/CNY hourly ×200
(`get_market_history`, base 1.3.113 / quote 1.3.0) returned **15 rows of 200
slots, 185 missing, 0 dupes** (first run 16/200/184). Sparse, non-linear buckets
confirmed on `api.bitshares.dev` — empty slots are simply absent, so client-side
slot-grid + carry-forward (`market-candles.js`, `swapsToCandles`) is load-bearing,
not cosmetic. Re-run: `node tooling/market-buckets-probe.mjs wss://api.bitshares.dev/ws`.

---

## 3. Pools list: drop STAKE, SWAP/STAKE rename, bold ⇄ (commits `cd5db15`, `01f0edf`, `796a0cd`)

**What landed.** `vanilla/js/pool-ui.js:239-243` (list-stays-a-list doctrine:
no separate STAKE column, same destination) + `:306-313` (EXCHANGE second,
blue ⇄ text link — text, not the vendored `swap.svg`, so it inherits link
color); header rename EXCHANGE → SWAP/STAKE (`01f0edf`, +10 locale dicts);
bold + larger links (`796a0cd`, `vanilla/css/app.css` 1 rule). Qty cells bare
numbers with raw ints in `title` (`pool-ui.js` inline comment).

**Reference behavior.** #1 `LiquidityPools.jsx:318-340`: an `exchange` column
(opening `PoolExchangeModal`) plus a `stake_unstake` column (opening the stake
modal) — same-page destinations, matching our list-stays-a-list doctrine. The ⇄
glyph itself is a vanilla styling choice: #1 renders a `poolmart` ICON (an
`<img>`-class glyph that cannot inherit link blue), and ours must be blue, so
text ⇄ stands in — documented in `pool-ui.js`. Deviation recorded honestly: #1's
exchange cell is icon-only (not a link) when logged out; ours links always
(principle #9: reads never gate).

**Test vectors.** None (display-only, no money path touched). Counts: −1
column, +1 locale key × 10 dicts.

**Anti-rot.** (a) Pure DOM + CSS, no data path. (b) Nothing. (c) Revertible
in 3 small commits independently.

---

## 4. Plot ground, volume pane, time-sync, depth slices, mesh overlays, Plots toggles, VWAP-off

**What landed (files:lines).**
- Plot ground (`4d0b498`): `--plot-bg` per theme — `vanilla/css/themes.css:48`
  (ref-ui `#1e1e1e`), `:80` (vanilla-ui `#ffffff`), `:103` (dex-ux `#131722`);
  canvas default `vanilla/css/app.css:242,268`; LWC `paneBg` reader
  `vanilla/js/charts-lwc.js:169-175` (darker content-block ground per #1).
- Volume own-pane (`004b248`): `vanilla/js/market-ind.js:773-783`
  (Volume ALWAYS first, own histogram sub-pane, locked on, no × button),
  `:1127-1130` (menu label "always shows in its own pane").
- Time-sync (`29434c9`): `vanilla/js/charts-lwc.js:484-520`
  (`linkTimeScales`, sync-guarded, best-effort never-throw) + `market-ind.js`
  wiring (19 added lines).
- Depth as charts-stack slice (`cb9e868`): `market-ind.js:894-936` (depth
  canvas pinned at stack index 1, pool-map right after); desk CSS
  `vanilla/css/desk-grid.css` 12-line rework.
- Mesh overlays (`8aeaa58`): `market-ind.js:350-397` (one adjustable number
  per meshable overlay; fixed-param legacy rows kept) + `:970+` (per-instance
  chips: label + period input + ×; 5/10/50 = three Adds + two edits).
- Plots toggles (`67ef850`): `market-ind.js:1148` ("everything but price":
  VWAP strip + depth slice + pool map toggleable) + 2 locale keys × 10.
- VWAP-off default (`5e78bc5`): `market-desk.js:265-267`
  (`showVwap:false, showDepth:true, showPoolMap:true`) mirrored in
  `pool-detail-ui.js:198`.

**Reference behavior.** Depth staircase ported from #5 `json_to_html.py:19-44`
(Plotly step-fill → canvas; builder-cited in `dexux-networkx-verdict.md:20`,
not re-read). VWAP strip = dex-ux proposal 3 (`market-ind.js:25,191-270`,
session math in `MarketCandles.vwap` via BigInt accumulation — money-safe).

**Test vectors.** Volume-by-construction (no vector — locked-on invariant);
time-sync best-effort (no vector — failure = unlinked panes, still drawn);
mesh periods validated + clamped in-menu (builder-stated, not re-exercised).

**Anti-rot.** (a) Canvas + platform DOM, no chart library (TradingView
refused per doctrine). (b) Nothing. (c) Each bullet reverts independently
(separate commits); VWAP-off is a 2-line default flip.

---

## 5. Quote panels (try-before-you-buy) + retro 2x3 grid (commits `47a30bb`, `b2c7cfb`, `cff7028`, `eadaeb0`)

**What landed.** `vanilla/js/trade-form.js` +432/−36 (`47a30bb` + `cff7028`
share): locked quote panels (`trade-form.js:389-400` header comment) — locked
wallets see Buy/Sell/Scaled tabs with live quotes + fee preview line (`:505`),
password asked ONLY at per-side "Unlock & review" (`:612,:945-946`);
scaled variants `:1179-1238`. 16 i18n keys × 10 dicts (`b2c7cfb`).
Retro equal 2x3: `vanilla/css/desk-grid.css:1-25` header (row 1
buy|sell|trades-toggle, row 2 bids|asks|open-orders) + `market-desk.js:8-16`
layout contract; book/trades/orders caps 12/15/8 (`desk-grid.css:35`).
Comparison shots committed: `vanilla/notes/original-buy-sell-2x3-2026-09-28.png`
(263107 B) + `vanilla/notes/vanilla-exchange-lower-2026-09-28.png` (220833 B).

**Reference behavior (re-verified).** #1 `BuySell.jsx:518`
(`disabled = noBalance || invalidPrice || invalidAmount` — only SUBMIT gates;
inputs/fee/total always live) — matches the locked-panels rule exactly.
`Exchange.jsx:2089-2210` (forms unconditional) builder-cited.

**Test vectors.** No money vectors tonight (quote math reuses proven
`Format` paths); fee preview builds the same op pre- and post-unlock
(`trade-form.js:505` comment). Counts: 6 grid cells, 12/15/8 row caps.

**Anti-rot.** (a) No new deps; unlock gate is a button handler, not a
service. (b) Nothing. (c) Locked panels degrade to the old locked-hint by
deleting the panel block; 2x3 reverts to prior grid CSS alone.

---

## 6. Header forgery + footer REPORT/HELP + pools-swap cues (commit `86d9ce5`)

**What landed.** `vanilla/js/app.js` +85: brand logo `<img>` preserved via
alt/aria-label (`localizeShell`), `paintLock` (`:419+`, locked glyph →
`#/login`, unlocked glyph → in-place `Wallet.lock()` + repaint),
`paintFootActions` (`:457-473`), `bindLockOnce`. `vanilla/index.html:34`
footer skeleton (`foot-report` → `https://t.me/bitsharesDEV` external,
`foot-help` → `#/help`). `vanilla/css/app.css` +101: gold `#warn-banner`
(`#fffbe6`/`#ffe58f`), `.brand-logo` 40px, `#lock-toggle` 44px, black nav bar
(rgba layering note, not pure #000), statstrip column-reverse
(value-over-label, zero JS), footer host UPPERCASE + green/red, REPORT/HELP
accent-blue square buttons, `.mkt-tabs` treatment (pool-swap `:80`,
pool-detail `:606`, desk `:422`, dashboard `:461` hosts), 360px footer wrap.
Comparison shots: `original-header-exchange-2026-09-28.png` (469119 B) +
`vanilla-header-exchange-2026-09-28.png` (253795 B) via `0149b7d`.

**Reference behavior (re-verified).** #1 `branding.js:64` `getLogo()`,
`Header.jsx:399` height 40 (builder-cited line, file verified);
`Header.jsx:663-681` lock/unlock next to hamburger (re-verified `:660-682`
shows the lock span); `Footer.jsx:675` `introjs-launcher` class + `:14-15`
`intro.js` import (re-verified; full 666-699 range builder-cited);
`NewsHeadline.jsx:139` `<Alert … banner />` (re-verified — grounds the
`#fffbe6` antd-v3 warning sampling); `$bs-blue #049cce == var(--button-bg)`
in ref-ui-theme (builder-measured).

**Test vectors.** None (chrome-only). Deliberate deviation recorded in CSS:
vanilla logo links home `#/` in every state; #1 links to the account
dashboard when logged in.

**Anti-rot.** (a) Static skeleton + CSS tokens; lock degrades to a plain
`#/login` link without JS. (b) Nothing (t.me URL is a link, not a dep).
(c) Whole pass is one CSS block + 3 small functions.

---

## 7. Pool-map provenance graph (commit `da6b735`)

**What landed.** New `vanilla/js/pool-graph.js` (364 lines: 2-layers-out
asset↔pool graph, BFS fewest-hops + widest-bottleneck tiebreak to core
`1.3.0` at `:159`, orphan-pair "no BTS path" state, 25-node cap,
deterministic layered-ring layout — no physics, no library) +
`tooling/pool-graph-test.js` (114 lines) + desk wiring
(`market-desk.js` +147, `pool-detail-ui.js` +125, `market-ind.js` +33,
Plots-toggleable, pinned after depth at stack index ~2).

**Reference behavior.** This is the vanilla answer to the dex-ux "network
plot" (§11 verdict): no networkx exists upstream, so the map ports the
*idea* (pool↔asset routing, `main.js:380-387` builder-cited) with own math.
BTS core `1.3.0` is a literal (`pool-graph.js:26`); a `lookup_asset_symbols`
confirmation is an honest fallback noted in-file (`:13`).

**Test vectors (re-ran 11/11 green).** Shortest-beats-wider (1 hop size 10 vs
2 hops size 1000 each → direct path), orphan → null, node cap respected,
layout deterministic. No money involved (routing + counts only).

**Headless proof (note-author-read).** `/tmp/poolmap-market.png` (1440,
ref-ui): desk renders zero console errors per builder; **the map itself is
NOT visible above the fold in the shot I read** — it lives below the DOM
slice / needs the tall variant (`poolmap-market-tall.png`, not read) or the
Plots toggle. Map-visible proof is builder-claimed only.

**Anti-rot.** (a) Pure canvas + BFS, zero graph library. (b) Nothing.
(c) Delete `pool-graph.js` + 3 wiring hunks → desks stand.

---

## 8. Unlock previews: gate repairs + typed-account surfaces + dead sweep (commits `0835586`, `3d64efd`)

**Task-label mapping (honest).** Code labels found: **G1** (`asset-ui.js:181`
— no entry unlock gate, issuer input with public 1.2.0 default, password only
at publish), **G6** (`account-ui.js:570` — public-first lookup, any account
page opens locked), **G7** (`transfer-ui.js:483` — locked keys cannot
encrypt, memo excluded from confirm), **G8** (`accounts-ui.js:122` —
pointer to the public lookup). **G2–G5: no such labels exist in the repo**
(earlier round or planned — not mappable, not claimed). **D1–D4** are not
code labels either; mapped here to the 4 typed-account preview surfaces in
`0835586`:
- D1 My orders: `market-orders.js:106-145` (Account input + Look up via
  public `get_limit_orders_by_account`; locked = display-only, no Cancel).
- D2 My fills: `market-desk.js:833-857,960+` (typed account + Look up paints
  ITS fills).
- D3 Pool exchanges: `pool-swap-ui.js:177-188,234+` (typed preview via
  public `Account.history`).
- D4 Pool My-exchanges: `pool-detail-ui.js:706+` (same pattern on the detail
  desk).
Plus `3d64efd`: asset-create/me/memo previews (`account-ui.js` +42 lookup
block, `transfer-ui.js` +43/−36 memo flow, `asset-ui.js` +27/−? issuer
default) and dead-helper sweep: `vote-ui.js` −36 (`renderUnlockPrompt`
deleted — public lists render locked, sign-time path directs via wallet
page), `asset-feed-ui.js`/`asset-manage-ui.js`/`proposal-ui.js` −11 each
(dead unlock shims).

**Reference behavior.** Principle #9 (browse-as-anyone; password only at
signing) throughout; `accounts-ui.js:144-155` is the in-repo pattern G6
copies. No new chain methods (public reads only).

**Test vectors.** None tonight (public-read paths reuse proven account
queries). Blank+locked keeps hint; blank+unlocked reloads wallet auto-load
(`market-orders.js:107`).

**Anti-rot.** (a) Display-only + public reads; no keystore path touched.
(b) Nothing. (c) Each surface reverts to its locked hint independently.

---

## 9. Candy block (commit `7863e57`)

**What landed.** `vanilla/css/app.css` +147, single headed block, one-commit
revertible: hover lift (buttons, 120 ms), row tints (tables/books), underline
sweep (nav/tabs), card raise — **all inside `@media (hover:hover)`** so touch
never sticks; charts explicitly untouched ("instruments, not toys").

**Anti-rot.** (a) CSS only, touch-safe by construction. (b) Nothing.
(c) The block IS the deletable subset (single header, single revert).

---

## 10. Recapture rounds 1–3 (commits `60da574`, `37fef4a`, `e8d20e3`; record `vanilla/notes/retro-round-1.md`, 326 lines)

Round 1 (CSS-only, `app.css`): form-control skin (white-box fix on dark
themes), 18px check/radio reset, global link cyan, nav tint-only, warn ×,
H1 density, footer clearance, phone stat-strip wrap, REPORT/HELP blue-on-blue
probe fix (computed-style confirmed `rgb(0,123,255)` on same).
Round 2 (closes D1/D2/D3 + D8): trim6-at-render (full precision kept in
`title`), Feed cell via 2-RPC read (`lookup_asset_symbols` →
`get_objects(bitasset_data_id)`, legs mapped by `asset_id`, fails open),
MY/FIND picker table (star-first, VOL from existing ticker rows, 20-row cap),
5 account tabs (Balances default, hidden tabs keep filling), 5 locale keys ×
10 dicts. Live: Latest `0.064343`, Bid–Ask `0.063417/0.064337`, spread
`0.000920`, midpoint `0.063877`, Feed `0.066686` (bitCNY, not settled → no
Settlement cell: honest empty).
Round 3: BigInt settlement-fund flag (`> 0n` exact), picker CHANGE sign paint
(string-only `chgSign`, pos → `--buy`, neg → `--sell`, zero → `--muted`;
11 logic vectors; live chain all-zero → all muted, correct-not-miss).
Reference: #1 `ExchangeHeader.jsx:160-198` feed/settlement rule incl. `1/x`
BTS-leg invert (builder-cited; vanilla folds the invert into leg mapping via
`Format.formatPrice`, BigInt instead of #1's float — math ported, not files).

**Note-author verification.** READ `/tmp/r3-desk.png`: strip shows
`0.064343 / 0 / 0 CNY / 0.063417-0.064337 / Feed 0.066686`, trimmed spread
line, ALL/STARRED tabs, MARKET/VOL/PRICE/24HΔ table, REPORT/HELP buttons,
footer `API.BITSH… · LATENCY 411ms / BLOCK #114777574`, count note
`200 × 1h candles`. (Older `/tmp/poolmap-market.png` I also read still shows
the pre-round-2 16-decimal strip + radio picker — correctly superseded.)

---

## 11. networkx verdict (commit `d2937e0`, `vanilla/notes/dexux-networkx-verdict.md`, 39 lines)

**Verdict: no networkx exists** — `grep -ri networkx` over
`reference/bitshares-dex-ux` (`bad2545`, 7 commits): zero hits;
`requirements.txt` = `aiohttp/falcon/socketify`; `stack.png` node-link glyphs
are vendor logos (architecture diagram, not app output). Client charts are
Plotly/LightweightCharts/KLineCharts (refused transports). Ported instead:
synth pool book (`falcon_app.py:167-214` → `PoolHistory.synthBook`), depth
staircase (`json_to_html.py:19-44` → canvas depth slice), discrete→candle
bucketing (`kibana.py:280-364` → `swapsToCandles`/`MarketCandles`), pool
routing (`main.js:380-387` → pool map §7). Rule restated: future network
plots → port MATH with vectors, never the plotting code.

---

## 12. Extension Tier-1 seam + scaffold (commits `f3d52f8`, `afc65dd`)

**What landed.** Seam: `vanilla/js/store.js` +74/−9 — `Store.backend`
`{get,set,del}` with sync localStorage default (`store.js:1-13` header,
`:46-71` adapter; settings keys/timing web-identical; extension injects
`chrome.storage` later). Scaffold: `extension-wrapper/adapter/bridge.js`
(94), `adapter/storage.js` (102), `content/inject.js` (95),
`background/sw.js` (90), `manifest.json` (38), `TEST-PLAN.md` (84),
`tooling/pack-extension.sh` tweaks. Reference model: #3
`wallet-extension` (AES-GCM/PBKDF2/session-only discipline ported as
properties, never `chrome.*` plumbing).

**Test vectors (re-ran 13/13 green).** `tooling/wallet-seam-test.js`:
backend get/set/del + web-identical timing contract.

**Proof status.** `TEST-PLAN.md:1` — **UNVERIFIED IN-BROWSER** (human must
check each box on a fresh profile; Tier-1 changes no pixels per `:33`).
Headless `/tmp/seam-home.png`, `/tmp/seam-settings.png` exist, not read here.

**Anti-rot.** (a) Web app never depends on the wrapper existing (out-of-v1
hardening, AGENTS.md §10.7). (b) Nothing added to `vanilla/` runtime.
(c) Seam = one object literal; scaffold lives outside `vanilla/`
(`check_rot.py` unaffected — PASS re-run).

---

## 13. Adjacent tonight commits (outside the rotation list, recorded for completeness)

- `81a019f` Depth log scales: toggles on both axes, ship log/log.
- `df1dd7a` One depth plot: staircase duplicate deleted, bids green.
- `96c2e6e` Correct stale tickets-PENDING lines (proven live: pool/ticket
  `1.18.61` — body one-liner, no diff inspected beyond `--stat`).
- `9882475` Fix osc stack overlapping book/trades (host min-height).
Details not covered here — see each commit's own diff; none touch money math
per their stats (CSS/market-ind/pool copy).

---

## 14. Verification summary (note-author-run, 2026-09-29)

| Check | Result |
|---|---|
| `node --check` × 11 touched JS files | OK |
| `tooling/market-fills-test.js` | 16 pass, 0 fail |
| `tooling/pool-graph-test.js` | 11 pass, 0 fail |
| `tooling/indicators-parity-test.js` | 63 pass, 0 fail |
| `tooling/wallet-seam-test.js` | 13 pass, 0 fail |
| `python3 tooling/check_rot.py` | PASS |
| `python3 tooling/check_i18n.py` | OK (2164 keys, 2833 sites) |
| Shots personally READ | `/tmp/r3-desk.png`, `/tmp/poolmap-market.png` |
| Human browser pass (any tonight item) | NOT DONE (see §15) |

---

## 15. DEFERRED (not done tonight — do not claim)

1. **Human browser passes** — every item above (§1–§13) is headless-only.
2. **Ticket funding** — future ticket proofs still need per-test faucet funds
   (cf. `slice-14-proposals.md:54` throwaway pattern); `96c2e6e` fixed copy
   only.
3. **Tier-2 gate** — approvals UI + signing gate explicitly out of the Tier-1
   scaffold (`TEST-PLAN.md:64,81`); no blind signing added.
4. **Tab click-through** — account tabs + picker Starred tab shot but never
   clicked (`retro-round-1.md:221`); shooter has no click step.
5. **Settlement estimate** — live-asset offset-adjusted estimate stays out;
   needs exact reciprocal-percent string math (`retro-round-1.md:264-266,322`).
   No estimate shown anywhere (honest empty stands).
6. **13-col account table** — per-row SEND/DEPOSIT/TRADE/BORROW/SETTLE +
   price/value columns not ported: needs N tickers + new behavior
   (`retro-round-1.md:182-186`).
7. ~~Unresolved evidence~~ RESOLVED 2026-09-29 — bucket probe committed as
   `tooling/market-buckets-probe.mjs` (15/200 re-proven, §2); ⇄ provenance
   corrected to `LiquidityPools.jsx:318-340` with documented glyph deviation (§3).
