# dex-ux plots + picker review (ref #5, `bad2545`, 2026-09-28)

Scope: read-only. No app-code edits, no commits. Ref #5 is behavior/style
reference only — Python/Falcon runtime, never a dependency.

## 1. networkx: NOT FOUND at this checkout

`rg -i networkx` over all tracked files: zero hits. `requirements.txt`
lists only `aiohttp/falcon/socketify`. `git log --all --grep='networkx|graph|plot'`
empty. There is **no networkx code, no node-edge graph construction, no graph
visualization** in `reference/bitshares-dex-ux` — the premise was wrong
(honest negative result, verified, not assumed).

Closest graph-like constructs (what exists instead, and why each is useful):

- **Synthetic pool orderbook from x·y=k** (`falcon_app.py:167-214`): builds 98
  synthetic asks + 98 bids by stepping `delta_a = i*0.01*balance_a` and solving
  `balance_b2 = k/balance_a2`. Reusable math for our pools desk: same
  constant-product walk renders a pool depth curve with zero chain calls
  beyond the pool object. (Ours: `vanilla/js/pool.js` reads pools; curve
  rendering is the gap — see proposal 5.)
- **Cumulative depth prep** (`json_to_html.py:19-44` cumulative `csum` per
  side; `main.js:267-338` `plotDepth` Plotly step-fill). Portable pattern:
  cumulative quote-volume staircase. We port the *math*, not Plotly — canvas
  step-fill (proposal 1).
- **Discrete-fill → candle bucketing** (`kibana.py:280-364` `discrete_to_candles`,
  `make_candles`, `append_to_candles`): `[unix,price,volume]` → OHLCV buckets
  via `bisect` on break boundaries. Useful as the bucketing algorithm shape,
  but its data source (ES `es.bts.mobi`, `kibana.py:106-111`) is REFUSED —
  we feed the same algorithm from `get_market_history` (proposal 3).

## 2. Market-picker logic (two-round search + filters)

Flow (`main.js:412-475`, `order_book.html:34-92`, `falcon_app.py:55-84,510-519`):

- **Round 1** (`firstChoice=true`): search string → `list_assets` WS msg
  (`reList`, `main.js:412-430`) → server `list_assets_sql` (`sql_utils.py:14-35`)
  substring match over sqlite `assets`/`pools` tables → rows with NO ticker
  (`json_to_html.py:264-273` fast path, zeros). Click → `firstSearch(token)`
  (`main.js:433-441`): flips `firstChoice`, pins `assetA`, resets box to "USD".
- **Round 2** (`firstChoice=false`): same query shape, server does per-pair
  `get_ticker` N+1 (`json_to_html.py:150-159`, `rpc.py:176-185`) → PAIR/LAST/
  CHANGE rows; click → `book()` loads orderbook (`main.js:355-409`).
- **Filters** (`order_book.html:52-64`, `main.js:464-475`, `falcon_app.py:132-139`,
  `sql_utils.py:38-72`): EXCLUSIVE single-type radio MPA/UIA/LPT/Pool/BTS
  (`clickFilter` zeroes all then sets one). Per-type SQL: MPA
  `bitasset_id<>""`, UIA `bitasset_id="" AND pool_id=""`, LPT `pool_id<>""`,
  Pool `asset in pools.xyk`, BTS appends literal. Sort: symbol alpha, then
  whitelist-greyscale rank (`utilities.py:120-135` BTS=brightest … COMPUMATRIX=
  darkest) with zebra striping (`json_to_html.py:209-225`).

Takeaways → concrete deltas vs our `vanilla/js/market-picker.js`:

1. Their round-2 ticker/volume/change columns over FULL DB enumeration vs our
   curated 4-market list with no volume data. DELTA: add optional
   volume-sorted discovery (bounded `list_assets` + `get_ticker` batch) as a
   later slice; keep curated default (fast, offline-safe).
2. Their EXCLUSIVE single-type radio hides everything else; ours defaults ALL
   + fails OPEN on missing kind records (`market-picker.js:249-258`). DELTA:
   none — ours is strictly safer; do NOT copy exclusivity.
3. Their LPT/Pool rows route via pool contract id (`book()` 1.19 branch,
   `main.js:380-387`). DELTA: when we add pool discovery, reuse our
   `get_liquidity_pools_by_*` in `pool.js:153-156` and route pool rows to
   pool detail, not the orderbook.
4. Their N+1 per-row `get_ticker` is a load anti-pattern. DELTA: batch or cap
   (≤20 rows) when we add volume columns; never row-per-RPC unbounded.
5. No favorites, no typed-pair validation on theirs; ours has both
   (`market-picker.js:94-124,344-368`). DELTA: none — keep.

## 3. Rendering: CANNOT render — do not try

Requires PyPy + Falcon/Socketify servers (`falcon_app.py:587-593`,
`falcon_website.py:115-123`), sqlite DB build (`init_database.py`), live ES
`es.bts.mobi` (`kibana.py:106-111`), live WS node (`rpc.py:24-44`), plus CDN
Plotly/LightweightCharts/KLineCharts (`order_book.html:21-23`) — wrong runtime
per doctrine §5 (Python/Falcon + ES transport refused). Instead: in-repo
screenshots (`Screenshot from 2023-02-*.png`, 3 files) + live-hash-route shots
in `vanilla/notes/dexux-ref/` (`btsx-home/market2/pools.png` + README with
desk/pools cues + 4 style deltas). Client charts are all JS libs (Plotly depth,
LightweightCharts line/candle, KLine advanced+MA/VOL in `main.js:69-188`) —
replace with canvas, never import.

## 4. Plot proposals — CHAIN HISTORY ONLY (ES refused, no exceptions)

Conventions: history api id via login `"history"` (standing finding §7);
amounts stay integer strings/BigInt until `format.js` renders; price compare
by cross-multiplication (`a1*b2` vs `a2*b1`), never float division on money.

1. **Cumulative depth staircase (canvas step-fill).**
   Source: database `get_order_book(base, quote, 50)` (already wrapped:
   `market.js:182-187`). Math: walk each side's levels, `cum += BigInt(quote_int)`;
   x = level price as (base_int, quote_int) pair, y = cum scaled by
   `10^-precision_quote` only at render via `format.js`. Host: `market-book.js`
   depth panel (replaces no-lib gap; dex-ux pattern `json_to_html.py:24-44`).
   Cost: 1 DB call per refresh, O(50) render — cheapest plot available.

2. **Fill-size tape histogram.**
   Source: history `get_fill_order_history(base, quote, 100)` (already wrapped:
   `market.js:259-275`). Math: bin each fill's `pays/receives` integer amount by
   order of magnitude (digit-count of the integer string — no float); counts per
   bin + max-bin highlight. Host: market desk recent-trades tab
   (`market-orders.js`). Cost: 1 history call on tab open, pure client CPU.

3. **Session VWAP + spread band over `get_market_history` buckets.**
   Source: history `get_market_history(a, b, bucket, start, end)` (already
   wrapped: `market-candles.js:113-161`). Math: per bucket
   `vwap_num += BigInt(base_vol_int)`, `vwap_den += BigInt(quote_vol_int)`;
   VWAP renders as num/den via `format.js`; band = bucket `(high,low)` ints.
   Overlay line on existing candle chart (`market-candles.js`/`charts-lwc.js`,
   slice-07 indicator host `market-ind.js`). Cost: 1 history call per bucket
   size; O(buckets ≤ clip).

4. **Account equity sparkline (per-asset integer replay).**
   Source: history `get_account_history(id, start, limit, stop)` (already
   wrapped: `account.js:85-97`), paged. Math: replay only balance-affecting ops
   (transfers, fills, pool payouts) as `Map(assetId → BigInt delta)`; render
   latest totals via `format.js` with each asset's precision; sparkline = total
   deltas per page index (unit-mixed pages kept separate per asset, never summed
   across precisions). Host: `account-ui.js` portfolio section. Cost: capped walk
   (≤5 pages × 100); stops early on empty page.

5. **Pool x·y=k curve + current point (dex-ux math, chain data).**
   Source: database `get_liquidity_pools[_by_*]` → `balance_a/balance_b` integers
   (already wrapped: `pool.js:153-162`). Math: port `falcon_app.py:167-202`
   with BigInt — `k = A*B`, step `s = A/100n`, points `(A+i*s, k/(A+i*s))` for
   i in 1..99, current point `(A,B)` marked; scale to human only at render.
   Host: `pool-detail-ui.js` / `pool-ui.js`. Cost: 1 DB call + O(99) integer ops.
