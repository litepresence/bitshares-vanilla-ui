# Slice 9 parity note — explorer

Plan: `docs/superpowers/plans/2026-09-28-slice-09-explorer.md` (Tasks 1–3).
Reads-only slice: no signing, no confirm dialog (`tx.js`/`crypto.js` untouched).

## What landed (vanilla file:line)
- `vanilla/js/explorer.js` — reads only: `head`, `recentBlocks` (batch pairs
  unpacked + per-row `get_block` tx counts), `block`, `tx`, `recentTxById`,
  `assetsPage`, `assetCount`, `asset`, `feeds`, `resolveObject`, `search`.
- `vanilla/js/explorer-ui.js` — `#/explorer` (+`:tab` blocks|assets|feeds),
  `#/block/:height`, `#/block/:height/:txIndex`, `#/asset/:symbol`; 1.x.y
  search with `1.2.x`→`#/account/:name`, `1.3.x`→`#/asset/:symbol` redirects;
  generic object panel with humanized leaves; gen-counter teardown.
- Routes `router.js:94-98`, tags `index.html` before `router.js`.
- Readability split (audit follow-up): `explorer-ui.js` 396 (shell), new
  `explorer-blocks.js` 367, new `explorer-assets.js` 786 (assets+feeds+values
  layer, no separate cap — readability-pass candidate). Re-verified post-split:
  fee `0.05959 TEST`, AAAA supply `101.00000`, zero `undefined`, rot PASS.
- Probe saved per policy §7.3: `tooling/explorer-reprobe.mjs` (stdlib-only, 9/9).

## Reference behavior (file:line)
- #4: methods per `database_api.hpp:92-200,229,413-461`; op enum 0–77
  (`operations.hpp:56-133`); spaces (`types.hpp:362-386`); `get_bitasset_data`
  is wallet-API-only so feeds go via `bitasset_data_id` + `get_objects`
  (confirmed by #1 `AssetActions.js:574-580`).
- #1 `Asset.jsx:738-748`: MSSR/MCR ÷1000 ratio (`1100`→`1.1×`); market fee
  hundredths (`0`→`0%`). Chain facts that beat guesses: `get_block` has no
  height in body (client-attached); batch returns `[height,header]` pairs
  (fc map encoding); ticker change is human float.

## Bugs found by verification, fixed + re-probed
1. `head()` read `head_block_time`, chain sends `time` → now `g.time` + fallback.
2. Batch pairs not unpacked; headers carry no tx count → unpack + per-row
   `get_block` (page-capped, failure → `—`).
3. `resolveObject` space/type misassigned → space literal 1, type=m[1];
   restores typeName, both redirects, 1.11.x op-attach.
4. Generic panel raw leaves → CORE_AMOUNT_KEYS at core p5, OWN_AMOUNT_KEYS at
   owning-asset precision (async resolve, else raw + ` (raw)`).

## Test vectors (raw → human, real files, live testnet)
- Fixture blocks read back our own slice-8 contents: `100916767` op-6
  `votes ["1:0"]` proxy `1.2.5` fee `5959`→`0.05959 TEST`; `100916768` op-6
  `votes []` proxy `1.2.25483` fee `5764`→`0.05764 TEST`.
- `AAAA (1.3.642)`: supply `10100000`→`101.00000`, fee pool
  `15000000000`→`150000.00000`; MSSR `1100`→`1.1×`; `TEST` max supply
  `1000000000000000`→`10000000000.00000`; market fee `0`→`0%`.
- `1.6.1`: `witness · 80000000.00000 votes (raw 8000000000000)`.
- Hundredths percent (audit follow-up, real `pctHundredths`): `2000`→`20%`,
  `0`→`0%`. Non-p5 amount (real `Format.formatAmount`): `74900` p2 → `749.00`
  (CNY, slice-7 live fill precision).
- Feed ambiguity RESOLVED live: `current_feed` wins; zero-pairs → `—`/`unavailable`.
- `get_asset_count` = `1849`; `1.10.1` → honest "Nothing found".

## Manual test (headless, --network testnet, zero console errors)
- `#/explorer` @1440 blue/dark + @390: head strip
  `Head #100917335 · 2026-09-27T04:10:39 · irreversible #100917327`, rows with
  time + witness links + Txs, phone stacks.
- `#/block/100916767` + `/0` + `#/asset/TEST` + `#/explorer/feeds` (10 live MPAs):
  all fully correct.
- `1.11.x` live objects pruned on testnet — op-attach branch code-intact,
  untestable live (honestly recorded).

## Tester pass (queued)
- Search `1.3.0`→asset page, `1.2.5`→account page, `1.6.1`→witness panel;
  block→tx→op drill-down; feeds tab; light-theme visual; phone-390 scroll.

## Anti-rot gate (§4.5): (a) yes — static reads via existing chain.js, no new
deps; (b) nothing new depended on; (c) smallest deletable: feeds tab (blocks/
txs/assets stand). `check_rot.py` PASS.

## R1c delta — ranked ops via bounded chain-scan (2026-10-01, R1c part 1 task B)

Reference behavior (read-only): `astro-ui/src/pages/top-operations.astro` +
`BlockchainTopOperations.jsx:303-307` (Type/Name/Quantity/% table, Refresh
button, <1% grouped as Other, recharts donut) + `nanoeffects/TopOperations.ts:
15-85` (off-chain POST `https://es.bitshares.dev` aggregation). Vanilla REFUSES
the ES transport (doctrine — external index is a dependency) and astro's
mainnet-only limit (its testnet branch renders "unsupported").

Vanilla implementation (file:line):
- `vanilla/js/top-ops-ui.js` (new): `TopOpsUI.renderTopOps` — head via
  `Chain.db()` + `get_dynamic_global_properties` (#4 `database_api.hpp:229`),
  then N=200 `get_block` calls (#4 `:182`) in CHUNK=25 waves over the shared
  socket; counts `operation_type` by id (array `[idx, fields]` or `{type}`
  shapes; virtual ids kept and labeled `(virtual)`); table (Type/Operation/
  Count/Share) + hand-rolled SVG donut (`polar`/`ringWedge`/`sliceSpans`, top 8
  + Other, theme-token fills, `role="img"` + table carries the same data);
  Refresh button; honest `topops.sample` label ("last 200 blocks … on <node>")
  + `topops.testnet` note; every share via `Format.pct1` (new in
  `vanilla/js/format.js`: BigInt tenths-of-a-percent, `"33.3%"`, never float).
  textContent-only; gen-guarded teardown; 44px targets; `.topops-layout`
  stacks on phones, side-by-side ≥900px (tokens only, `app.css`).
- `vanilla/js/router.js`: new `#/top-ops` route (legacy `#/ops` N≤200 sample
  view retained); `vanilla/js/app.js`: Explore-group nav link + `navText`.
- Locales: 13 `topops.*` keys en-identical in all 10 dicts (sync script).
- Vectors: `tooling/top-ops-test.js` 41/41 green (pct1 incl. `1/3→33.3%`,
  `1/200→0.5%`, zero-total; wedge flags/ring; spans cover 360°; Other fold).

Manual test + observed result (headless, this sandbox 2026-10-01):
- `node --check` clean (format/top-ops-ui/app/router); `check_rot.py` PASS;
  `check_i18n.py` OK (2752 keys, drift-free); static smoke: `Router.match(
  "/top-ops")` → route, `TopOpsUI.renderTopOps` function, N=200.
- Live 200-block scan NOT run here (no browser chain session in sandbox;
  `shot.mjs` blocked by missing `libnspr4.so`, recorded above). Testnet proof
  (connect → scan → table+donut on testnet node, phone + desktop widths) is
  with the human tester; the scan path uses only the two long-proven WS
  methods above (same calls `explorer.js` already makes).
- Matrix: op-coverage C3 flipped DEFERRED → PORTED (this route); B18 flipped
  DEFERRED → PORTED (the R1c banner in the slice-01 delta above).

Raw→human vectors: shares are counts, not money — `Format.pct1` vectors in
`tooling/top-ops-test.js` (41/41). No asset amounts on this page.
Anti-rot gate: (a) static + two database-API reads, runs in 10 years;
(b) zero new deps (no ES fetch, no recharts); (c) deletable: the donut (table
stands alone — kept because astro parity names the breakdown).

## Decimal block-age delta (2026-10-01, tenths ticker, no new polling)

Reference behavior: old UI never had decimals — `Blocks.jsx:23-48`
BlockTimeAgo floored to integer seconds. The tenths display here is NEW
flash, labeled honestly as such in code (`explorer-blocks.js:62-71,766-772`).

Vanilla implementation (file:line):
- `vanilla/js/explorer-blocks.js:72-82` — pure `agoTextAt(nowMs, newestTs)`:
  `Math.max(0, (nowMs-newestTs)/1000).toFixed(1) + " " + t("explorer.ago_many_suffix", "seconds ago")`
  (durations, not money — display rounding fine; negatives/NaN clamp to
  `"0.0 seconds ago"`; reuses the existing suffix key, no new copy/keys).
- `:773-777` — thin `agoText(newestTs)` wrapper (`Date.now()` → `agoTextAt`).
- `:918-935` — `statTimer` 1000ms → 150ms, updating ONLY
  `cLast.val.textContent` in place; `>15000ms` stall branch, gen guards, and
  `stopLive` teardown untouched. Tip updates stay push-driven (Store
  connection feed via `chain.js` `set_block_applied_callback`, zero RPC/block).
- `:1258` — `_test: { agoTextAt }` headless seam (no DOM).
- CSS: no change — reuses `tr.xplore-flash` + `.xplore-bump` as-is, no new
  keyframes (nothing to add to the `prefers-reduced-motion` disable list at
  `app.css:1098-1112`); `aria-live="off"` on the stats grid stays,
  `xplore-live` line stays polite.

Manual test + observed result (offline, this sandbox 2026-10-01):
- `node --check vanilla/js/explorer-blocks.js` clean.
- `node tooling/explorer-blocks-ago-test.js` 15/15 green (10 shaping vectors
  + 5 source guards: exactly one `setInterval` at `, 150)`, stall/teardown/push
  markers present).
- `python3 tooling/check_rot.py` PASS; `python3 tooling/check_i18n.py` OK
  (10 dicts key-complete, 3791 `t()` call sites drift-free — suffix default
  still matches `en.json`; retained `explorer.ago_one` simply unrendered).
- Headless `shot.mjs` NOT run here (Playwright chromium missing in sandbox —
  `chrome-headless-shell` absent; recorded, not skipped silently). Live
  tenths repaint + theme/viewport trio is with the human browser pass.

Raw→human vectors (durations, `tooling/explorer-blocks-ago-test.js`):
`0ms→"0.0 seconds ago"`, `400ms→"0.4"`, `1000ms→"1.0"` (was `"1 second ago"`),
`1234ms→"1.2"`, `1500ms→"1.5"`, `3200ms→"3.2"`, `16000ms→"16.0"`,
future/NaN→`"0.0"`.
Anti-rot gate: (a) static + existing push feed, runs in 10 years; (b) zero new
deps (no new interval source, no keyframes, no keys); (c) deletable: the
tenths (integer label stands alone — kept because liveness flash is the point).

## Delta 2026-10-01 — bars direction, neutral flash, stopwatch age, live activity (day-1 feedback)

Owner reports, all verified in code before fixing:

1. **Bar strips ran backwards.** `drawBars` plotted newest-first arrays leftward,
   so each head shifted history right (newest bar at left). Chart convention is
   time-leftward-to-right: now oldest-left/newest-right (single-point fix in
   `drawBars`, both strips), history marches left on each head.
2. **Row flash color.** New rows flashed theme `--live` green (reads as a status
   glow). Old UI flashes neutral `#6b6b6b` → transparent 1.25s. New `--flash`
   token in all three themes (byte-identical parity value, documented) drives
   `xplore-flash` (1.25s); green stays on the live dot/line only. Also capped
   the live tbody at 30 rows (old-UI `maxBlocks` parity — it grew unbounded).
3. **Age pinned at 0.0.** Chain stamps are UTC and usually naive; `Date()`
   parses naive stamps as LOCAL, so west-of-UTC viewers got future times and
   the clamp pinned the label. Two-layer fix: strict `parseChainTime` (naive
   reads as UTC, anything else → null, never guessed) for stored rows, and
   the live age now counts from local head-ARRIVAL (`Date.now()` in `onNew`)
   — a true stopwatch 0.0 → ~3.0s per head regardless of witness-clock games.
4. **Activity went stale.** The panel painted once from the initial `recentOps`
   window. Now each head feeds its own ops via new `Explorer.opsFromBody`
   (pure shaping factored from `recentOps`, ZERO new RPCs — the body was
   already fetched for the table), prepended and capped at 12 with a panel
   repaint. `block()` carries additive `raw` for this; nothing else changes.

Verification: `explorer-blocks-ago-test` 22/22 + new `explorer-ops-test`
16/16; `node --check` clean; types clean; rot + i18n green (no new copy);
headless `#/explorer` @1440 twice 20s apart, zero console errors — "2.8" then
"0.1 SECONDS AGO" across heads 114857166→178 (stopwatch proven live),
newest row visibly flashing, tall bars on the strip's right edge.
Human gate: flash feel + stopwatch glide on device.
Anti-rot: (a) platform timers + canvas + existing push feed; (b) zero new
deps, one token, one additive field; (c) deletable: activity refresh
(panel keeps its initial window), UTC parse (local parse stands with clamp),
row cap (table grows again — kept because the leak was real).

## Addendum — 3.0s reference line (owner: see above/under deviations, then removed)

Live-measured mainnet: 29/29 consecutive intervals exactly 3.0s (1s stamp
resolution + DPoS metronome — uniformity is real data, verified live, not a
plot bug). A 1px line shipped briefly, then removed same session (owner
call): with 1-second resolution, above/under-3.0 deviations cannot actually
resolve, so the line marked precision the data does not have. Bars +
gutters + direction carry the strip alone; removal was pure deletion (no
dead code, no leftover token — `--flash` stays for row flashes).
