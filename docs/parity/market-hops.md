# Parity Note — Market Hops (ES 24h-fill webs on the two market charts)

Date: 2026-10-07. Spec: `docs/superpowers/specs/2026-10-07-market-hops-design.md`
(plan: `docs/superpowers/plans/2026-10-07-market-hops.md`). Owner-approved scope:
clean split — pool charts show pools, market charts show markets; style shared,
backend switched. Pool charts have zero behavior change.

## 1. Reference behavior

- #1 (`bitshares-ui`) has no multi-hop market web. Its market discovery is the
  `MarketPicker` curated list + search (`app/components/Exchange/MarketPicker.jsx`)
  and per-desk `get_ticker`/`get_order_book` reads — strictly one pair at a time.
  There is no "what can I reach from X" view anywhere in #1.
- #2 (`astro-ui`) HAS the data primitive this work is built on:
  `src/nanoeffects/TopActiveMarkets.ts:72-93` — most actively traded pairs ranked by
  `fill_order` (op 4) count over a rolling window, via an ES `composite` aggregation
  over `pays.asset_id` + `receives.asset_id`, canonicalised in JS (both orderings
  collapse, counts summed). The vanilla port keeps the query shape byte-compatible
  and the merge rule identical; only the window (24h) and pagination (`after_key`,
  max 3 pages) are wallet-chosen.
- #3 (`wallet-extension`) contributes nothing here (no market discovery surface).
- #4 (`bitshares-core`) is the op truth: `fill_order` is operation 4 with
  pays/receives legs; `get_ticker` remains the price/volume source. Chain owns
  price, the community index owns activity — that division is the whole design.

## 2. Vanilla implementation

- `vanilla/js/api/market-hops.js` (new, ~470 lines): `fetchActivePairs` (ONE
  paginated ES composite agg through `HistoryCap.esSearch`, mainnet-gated,
  pref-gated, 15s total budget, `partial:true` when the last allowed page is
  full), `mergePairs` (unordered dedupe+sum, malformed dropped),
  `hopsFrom` (unbounded BFS to a hop depth — NO display caps, owner ruling),
  `routeToCore` (fewest hops, widest-bottleneck = most-filled route; null when
  unreachable, never fabricated) + `deskIdsFor` (asset path → rendered edge
  ids), `lookupSyms` (one `lookup_asset_symbols` join, bare ids on miss),
  `toGraph` (emits the shared painter shape: `id === poolId === QUOTE_BASE`
  desk id, `sizeRaw` = fills count so the shared ramps work unchanged).
  No DOM, no signing, in-session cache only (never persisted).
- `vanilla/js/views/market-net-ui.js`: band graph resolution — ES 3-hop web
  first (with ticker-row provenance attached: latest + both 24h volume raws +
  precisions), today's 1-hop ticker graph as fallback; `mountBand` takes a
  `fallback` flag into navOpts.
- `vanilla/js/views/pool-net-ui.js` (`mountMarketGraph`): fill-web status
  (`map_hops_ready`, "N pairs · M assets · 24h fills") vs fallback status
  (`map_fallback`, "… · 24h fills unconfirmed"); BTS route restored into
  `pathSet` after the pool-only stage; fill-web exception in `applySelection`
  (0–1 legs → full web stands, so 3 hops actually paint; 2 legs → pair union).
- `vanilla/js/views/pool-net-chrome.js`: market edge cards state fills + chain
  price (`edge_card_fills` + `edge_card_price`), verdict `verdict_web`
  ("reachable from", fill webs) vs `verdict_star` ("touching", ticker fallback),
  pair verdict `verdict_path` ("in N filled markets"), ramp legend `ramp_fills`
  ("24h fills: low → high") on fill webs only.
- `vanilla/js/views/market-desk-fill.js`: `fetchPoolMap` tries the 2-hop market
  web first (painter ensured loaded first — PoolGraph is a lazy script),
  falls back to the byte-identical pool path with `kind:"pool"`;
  `fillDeskProvenance` attaches the desk's own ticker facts to its own line;
  `redrawPoolMap` passes `kind`/`meta`/`routeDeskIds` every frame and its note
  switch states the painted world (market strict + calm no-route line, else the
  four verbatim pool sentences).
- `vanilla/js/api/pool-graph.js`: `drawGraph` accepts `opts.kind === "market"`
  (fills digit-window ramp, route path set, NO trust verdict text, NO orphan
  takeover — an empty market web is an honest one-liner; market aria label;
  hover provenance caption with fills + latest/vol). Pool path untouched;
  `drawLive` forwards kind/meta/route so the live loop cannot drift worlds.
- Registration: `vanilla/index.html` script tag, `vanilla/js/globals.d.ts`
  ambient, 14 `market.*`/`market_net.*` keys in all 12 locales (English-identical
  stubs per convention, `tooling/add_market_hops_i18n.py`).

## 3. Manual test steps + observed result (headless Chromium, mainnet, 2026-10-07)

- `#/markets` (BTS default) → table "Top 6 of 20 probed — by 24h volume" unchanged;
  band status "81 pairs · 59 assets · 24h fills"; full 3-hop web with 2nd/3rd-hop
  structure (e.g. XBTSX.USDT–XBTSX.BTC–BTC triangle away from BTS); verdict
  "Markets reachable from BTS: 81"; ramp "24h fills: low → high"; twin
  "Market rows (81)". Zero console errors (`selector-1440-ref.png`).
- `#/market/BTS_CNY` → desk loads (book/trades/charts untouched); map note "A line
  is a market that filled in the past 24 hours. 81 pairs shown." (no no-route
  suffix — CNY→BTS 1-hop route found, desk's own line glows); canvas painted
  824×180. Zero console errors (`desk-1440-ref.png`).
- Fallback (ES pref off via `bts-vanilla-settings-v1.esEnabled=false`) →
  desk shows the pool graph (17 pools) with the verbatim pool fallback note
  ("…funded pool exists… N=17"). Selector with MarketHops absent →
  1-hop ticker band (headless test). No blank anywhere.
- Bug found and fixed in audit: market path ran before the lazy PoolGraph
  `<script>` loaded → blank canvas + stuck "Loading map…" with zero errors
  (silent by design of the best-effort wrappers). Fix: ensure the painter first,
  then resolve the backend. Verified painted after fix.
- Second audit find: band-side star filter amputated hops 2–3 (64 of 81 edges
  painted). Fix: fill-web exception — full web stands on 0–1 legs. Verified 81/81.
- `#/pools` regression → "515 pools · 176 assets", full pool network byte-identical
  behavior (`pools-1440-ref-regression.png`).

## 4. Vectors (#6)

Money never touches a float anywhere in this work (fills are integer COUNTS;
amounts stay raw digit strings until `Format` at render). Vectors:

| Raw input | Rule | Display | Where |
|---|---|---|---|
| composite buckets BTS/USD 5 + USD/BTS 3 | unordered merge+sum | one pair, `8 fills` | `mergePairs` |
| ticker `latest "0.00010000"` | chain string, verbatim | `0.00010000` | edge caption/provenance |
| `volBaseRaw "12345678"` @ prec 5 | `Format.formatAmount` at render | `123.45678 BTS` | edge caption |
| fills 1 vs 9000 | digit-window ramp `(digits-1)/3` | grey vs accent ink | painter |
| pair `{1.3.0–1.3.999}`, no BTS path | `routeToCore` → null | no glow + calm no-route line | note, never a warning |
| full last ES page (1000/1000 on page 3) | `partial:true` | pool/ticker fallback | never a silent cut |

## 5. Themes + viewports

Trio + both ends verified with zero console errors on every shot
(`docs/parity/market-hops/`): selector 1440 ref/light/dark, selector 390 ref,
desk 1440 ref, desk 390 ref, pools 1440+390 regression. 390px: filters stack,
table yields to the pre-existing card layout (`app.css:225`, verified
pre-existing at HEAD, out of scope), band canvas renders. Dense-desk note: an
81-edge web in a 180px desk slice is legitimately dense (no-caps ruling) — the
Physics switch + drag + tap-to-open carry it; the selector band is the
roomy view for exploration.

## 6. Readability (§3.7)

Module header (owns/consumes/side effects/chain-truth/money-discipline/origin)
on `market-hops.js`; every function carries what/params/returns/failure notes
explaining WHY (hop bounds, fallback honesty, ramp windows); no
TODO/FIXME/commented-out code (grepped). Tests document the contracts.

## 7. Anti-rot gate (§4.5)

- (a) 2036 test: ES travels over `fetch` through the pre-existing
  `HistoryCap.esSearch` seam (same host the fills/pool adapters already use).
  No new transport, no new host, no new API surface. Worst case the index
  vanishes and both charts show exactly what they showed before this work.
- (b) Newly depended on: nothing with a release cycle. The community index is
  DATA (node-list class, already canonical `ES_BASE`), consumed through the
  existing seam with chain/pool fallbacks. Removal plan: delete `market-hops.js`
  + the two call sites + the `kind` branches → pool-graph-only behavior
  restored exactly; pool charts never depended on it.
- (c) Smallest deletable subset: `market-hops.js` + the `kind:"market"` branches
  in the two painters + the note switches. Physics, gestures, nav, chrome
  furniture are shared with the pool charts and could not go without breaking them.

## 8. Gates

- `node tooling/market-hops-test.js` → 55 passed, 0 failed (merge, unbounded
  BFS incl. 120-edge no-cap proof, route fewest-hops + widest-bottleneck +
  null-when-unreachable, query shape pinned to `es-lab.js:286`, desk-id
  orientation, toGraph id===poolId + provenance + malformed drops).
- `node tooling/market-desk-map-test.js` → 26 passed (market/pool ink split,
  fills ramp, route glow on/off, honest empties both worlds, aria both worlds,
  drawLive kind forwarding).
- `pool-graph-test` 204, `market-net-test` 37, `market-net-ui-test` 29,
  `pool-net-test` 66, `pool-net-ui-test` 107 (incl. new fill-web + fallback
  status assertions), `es-lab`/`history-cap`/`market-fills`/`market-deeplink`/`misc-seams` green.
- `bash tooling/check_types.sh` → PASS. `python3 tooling/check_i18n.py` → OK
  (3811 keys, allowlists exact, 5043 call sites drift-free).
  `python3 tooling/check_rot.py` → PASSED.
