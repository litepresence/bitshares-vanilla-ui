# Feed producers + history chart — parity note (2026-10-06)

Slice: no-login producer list with witness labels + chain-only LWC history
(per-producer + recomputed MEDIAN + EXCHANGE + ≤3 POOL lines) on `#/assets/feed`.
Spec: `docs/superpowers/specs/2026-10-06-feed-history-design.md`.
Plan: `docs/superpowers/plans/2026-10-06-feed-history.md` (6 tasks, all committed).

## Reference behavior (file:line)

- Upstream idea source `squidKid-deluxe/feed-graph-js` `feed_graph.js`:
  MPA search → `idsFromNames`, `paginate`/`kibana` over
  `es.bitshares.dev/bitshares-*/_async_search` (3000-size, `search_after`),
  `settlement_price()` leg math, per-producer Plotly traces, gap>7200s outage
  bars stacked at the bottom, in-memory `cachedGraphs`, 7-day default.
  Plotly-via-CDN + ES transport + `parseFloat/10^prec` math explicitly NOT
  ported (doctrine §4.5, principle #6).
- #1 live per-publisher table: `reference/bitshares-ui/app/components/Blockchain/Asset.jsx`
  `_renderFeedTable` (~:1654-1850: `bitAsset.feeds` map publisher → `(time, feed)`,
  valid-lifetime filter, median-offset column). Our producers section covers the
  publisher/time columns; the per-feed price table stays a follow-up (live
  `feeds` map already read — cheap to add).
- #1 fed flags: `reference/bitshares-ui/app/lib/chain/asset_constants.js:10-11`
  (`witness_fed_asset 0x80`, `committee_fed_asset 0x100`).

## Vanilla (file:line)

- `vanilla/js/api/feed-history.js` — pure history data (no DOM, no signing):
  `medianOf:28`, `normToBackingPerMpa:34`, `bucketAll:46` (carry-forward +
  median-of-actives, gap when active < minFeeds — never zero-fill),
  `badgeFor:92`, `producersFor:101` (bitasset `feeds` keys + flags),
  `isFeedOp:116` / `publisherPoints:124` (op-19 filter, `Format.formatPrice`
  both precisions), `exchangePoints:194` (`Market.trades` envelope, fallback
  `chainFills` + exported `MarketFills.priceHuman`), `poolLines:221`
  (`Pool.list` both-orientations + `swapsForPool` envelope + exported
  `PoolHistory.priceHuman` B-per-A with A=mpa).
- `vanilla/js/views/asset-feed-ui.js:226` `producersSection` (no unlock gate,
  `TableRenderer`, row-tap → `#/account/<id>`, async name + witness badge
  fill-in), `:290` `historySection` (7/30/90d, progress, one `drawOscPane`
  host, 44px legend checkboxes, fail-closed per source).
- `vanilla/index.html:176` script tag (after `pool-history.js`).
- `vanilla/js/api/asset.js` `_describeInner` — additive `bitasset_data_id`
  passthrough (old shape unchanged).
- Locales: 17 `asset.*` keys in all 12 dicts (`tooling/add_feed_history_i18n.py`).

## Chain truth (live-verified 2026-10-06, read-only probes)

- Testnet `AFKTESTM11` (1.3.1850): `feeds=[[1.2.26833,[time,feed]]]`,
  settlement legs base=MPA/quote=backing (matches `buildFeed` leg convention),
  `flags=0` (manual producers), publisher `1.2.26833` IS a witness
  (`get_witness_by_account` hit — badge path exercised), history API present.
- Mainnet `CNY` (1.3.113): 5 live feeds (2 fresh 2026-10-06, 2 stale 2024 —
  stale-tint + minFeeds-gap logic exercised), `flags=1031` (no fed flags →
  manual producers), op-19 present in publisher account history (walk source
  confirmed), 5 pools for CNY/BTS (cap-3 exercised).
- `get_fill_order_history` takes the HISTORY api id (`market.js:342-360`,
  `market-fills-history.js:274` via `Chain.history()`); a database-api call
  with the same method fails — probe caught this, view code uses the right id.
- Orientation: feed legs base=MPA/quote=backing (`asset_ops.cpp:178`);
  exchange via `Market.trades(backing, mpa)` (`priceExact` = backing-per-MPA);
  pools via `priceHuman(sw, mpaPrec, backingPrec, mpaId, backingId)` (B-per-A).
  Test vectors in `tooling/feed-history-test.js` (median, flip, op-19 filter,
  trades-envelope mapping, pool envelope + cap, bucket median-then-gap).

## Test vectors (raw → human)

- Orientation (all series backing-per-MPA): live HONEST.BTC legs base
  1603644699 (prec 8) / quote 100000000000000 (BTS prec 5) →
  `62357952.52050404`. The first cut computed base-per-quote (`0.00000002`),
  pinning producers + median to the zero line while exchange/pool drew at
  62M — fixed by swapping the `formatPrice` legs in `publisherPoints`
  (locked in `tooling/feed-history-test.js`).

- `medianOf(["1.5","1.7","1.6"])` → `"1.6"` (integer-compare, no float).
- `normToBackingPerMpa("2", true)` → `"0.5"`.
- Bucket: pubs `{1.2.1:[1000:1.5, 2000:1.7], 1.2.2:[1000:1.9]}`,
  lifetime 1500, minFeeds 2 → MEDIAN `["1.9","1.9",null]` (gap, never zero).
- Non-BTS precision + percent fields: covered by existing `Format`/`AssetOps`
  suites (this slice adds no new money math — all prices via `Format`).

## Gates

- `node tooling/feed-history-test.js` → all pass.
- `python3 tooling/check_i18n.py` → OK (3724 keys, drift-free).
- `python3 tooling/check_rot.py` → PASSED (no new deps; LWC already vendored).
- `bash tooling/check_types.sh` → PASS.
- Anti-rot: (a) static JS + vendored LWC + WS nodes — runs with no updates;
  (b) new deps: none (chain reads + already-vendored chart); (c) deletable
  subset: pool overlay (feeds+median+exchange still work — kept per request).

## Pending human-browser pass (not done in this session)

- `#/assets/feed` click-through on testnet MPA (producers visible locked,
  witness badges, 7d chart draws producers + MEDIAN + EXCHANGE + pools).
- Viewport checks 360px + 1440px; theme trio screenshots (ref-ui/dex-ux/vanilla).
- Publish op-19 + producer op-13 forms regression (untouched, but re-prove).
