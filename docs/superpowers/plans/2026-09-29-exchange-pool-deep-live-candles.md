# Exchange + Pool Deep + Live Candles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exchange candles go 200 → 2000 via ES backfill with a market-listener live tip; pool candles gain a block-listener live tip; both bucket locally from discrete datestamps.

**Architecture:** New `market-fills-history.js` (ES op-4 fills → local buckets → merge chain-wins); `MarketCandles` orchestrates deep merge; `Chain.js` adds a market-notice slot; `market-desk.js` patches the tip live; `pool-detail-ui.js` patches its tip from the block-applied feed + `get_block` op-63 scan.

**Tech Stack:** Vanilla JS (no deps), WebSocket JSON-RPC, `fetch` POST for ES, BigInt money math, `node --check` + `node tooling/*-test.js` + `python3 tooling/check_rot.py`.

## Global Constraints

- Zero runtime dependencies: no package.json, no node_modules, no CDN script, no framework in `vanilla/`.
- Platform APIs only: WebSocket, fetch, BigInt, Intl; no mini-framework inside `vanilla/`.
- Integers until render: raw ints + precisions through `Format.formatPrice/formatAmount`; `Number()` pixels/time-bucketing only.
- One chain module: only `chain.js` opens the socket; views call `Chain.call/db/history`.
- ES endpoint is data (like a node URL): any ES failure degrades to chain, never blank.
- Every file ≤400 lines, module header (owns/consumes/side-effects/created-by), function descriptions, no TODO/FIXME/dead code.
- Verify phone 390px + desktop 1440px and trio themes render; numeric inputs use inputmode.

---

### Task 1: `market-fills-history.js` + unit vectors (ES fills → local candles → merge)

**Files:**
- Create: `vanilla/js/market-fills-history.js`
- Create: `tooling/market-fills-test.js`
- Modify: `vanilla/index.html` (one script tag after `market-candles.js` line)

**Interfaces:**
- Consumes: `Chain.history/call`, `Format.formatPrice/formatAmount`, `Market._fillPair` rule (row.op pays/receives/fill_price).
- Produces: `MarketFills.fillsForMarket(baseId, quoteId, limit, {network}) -> {fills, source}`,
  `MarketFills.fillsToCandles(fills, bucketSec, baseId, precB, precQ) -> [buckets newest-last]`,
  `MarketFills.mergeDeep(chainBuckets, esBuckets, cap) -> merged`, `MarketFills.ES_URL`.

- [ ] **Step 1: Write the failing test**

```js
// tooling/market-fills-test.js (append-only new file)
globalThis.Format = require("/workspace/vanilla/js/format.js");
globalThis.Chain = { call: () => Promise.reject(new Error("no chain in vectors")) };
const MF = require("/workspace/vanilla/js/market-fills-history.js");
let pass = 0, fail = 0;
function eq(got, want, name) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}
// sparse node shape: 200-slot window returned 2 rows, 3 slots missing in the middle
const chain = [
  { timeMs: 1000 * 3600 * 10, open: "2.0", high: "2.0", low: "2.0", close: "2.0", baseVolume: "1.0", volumeBaseRaw: "100000", volumeQuoteRaw: "50000", highBase: "1", highQuote: "1", lowBase: "1", lowQuote: "1" },
];
const es = [
  { timeMs: 1000 * 3600 * 7, open: "1.0", high: "1.0", low: "1.0", close: "1.0", baseVolume: "1.0", volumeBaseRaw: "100000", volumeQuoteRaw: "100000", highBase: "1", highQuote: "1", lowBase: "1", lowQuote: "1" },
  { timeMs: 1000 * 3600 * 10, open: "9.0", high: "9.0", low: "9.0", close: "9.0", baseVolume: "9.0", volumeBaseRaw: "9", volumeQuoteRaw: "9", highBase: "9", highQuote: "9", lowBase: "9", lowQuote: "9" },
];
const merged = MF.mergeDeep(chain, es, 2000);
eq(merged.length, 2, "merge keeps both slots");
eq(merged[1].close, "2.0", "chain wins overlap");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/market-fills-test.js`
Expected: FAIL with "Cannot find module ... market-fills-history.js"

- [ ] **Step 3: Write minimal implementation**

Create `vanilla/js/market-fills-history.js` with header + `ES_URL = "https://es.bitshares.dev/bitshares-*/_search"`, `ES_TIMEOUT_MS = 15000`, `esQuery(baseSym, quoteSym)` (op-4 `kibana_fills` shape: `operation_type:4` + both leg multi_match + `is_maker:false` text, size 500, sort `block_data.block_time` desc, `_source` legs), `esFill(hit, baseId, quoteId)` strict leg-guard returning `{time, paid, received}` or null, `fillsForMarket` (non-mainnet → chain `get_fill_order_history` only; mainnet ES → chain fallback), `fillsToCandles` (slot-grid `floor(unix/bucket)*bucket`, OHLC from oriented human price, base-leg BigInt volume add, newest-last), `mergeDeep` (key timeMs, chain wins, sort asc, slice last `cap`). Wire `<script src="js/market-fills-history.js">` after market-candles in `index.html`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/market-fills-test.js`
Expected: exit 0, no FAIL lines. Then `node --check vanilla/js/market-fills-history.js` clean.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/market-fills-history.js tooling/market-fills-test.js vanilla/index.html
git commit -m "Deep candles 1/5: market-fills-history ES fills, local buckets, merge"
```

### Task 2: `MarketCandles` deep orchestration (200 → 2000, chain-wins)

**Files:**
- Modify: `vanilla/js/market-candles.js`
- Test: `tooling/market-fills-test.js` (extend, same file)

**Interfaces:**
- Consumes: `MarketFills.fillsForMarket/fillsToCandles/mergeDeep`, existing `timeframes/candles/vwap`.
- Produces: `MarketCandles.candles()` unchanged signature, merged ≤2000 buckets + `deep: true|false` on result.

- [ ] **Step 1: Write the failing test**

```js
// append to tooling/market-fills-test.js
(async () => {
  globalThis.Chain = { history: () => Promise.resolve(2), call: (api, m) => Promise.resolve([]) };
  const MC = require("/workspace/vanilla/js/market-candles.js");
  const r = await MC.candles("1.3.113", "1.3.0", 3600, 5);
  eq(Array.isArray(r.buckets), true, "candles returns buckets");
  eq(r.buckets.length <= 2000, true, "candles capped 2000");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/market-fills-test.js`
Expected: FAIL (no `deep` merge path / buckets uncapped shape)

- [ ] **Step 3: Write minimal implementation**

In `market-candles.js candles()`: after building chain `out` buckets, if `MarketFills` present and network is mainnet (via `Store.loadSettings`, default mainnet): `fills = (await MarketFills.fillsForMarket(baseId, quoteId, 500, {network})).fills`, `enrich` via `_precisions`, `esBuckets = MarketFills.fillsToCandles(...)`, `out = MarketFills.mergeDeep(out, esBuckets, 2000)`, set `deep=true` else `deep=false`. Rebuild `closes[]` from merged closes. Keep error contract (`history-unavailable`, `bad-bucket`, `bad-count`); ES throw → chain-only.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/market-fills-test.js && node --check vanilla/js/market-candles.js`
Expected: PASS, check clean.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/market-candles.js tooling/market-fills-test.js
git commit -m "Deep candles 2/5: MarketCandles ES merge to 2000, chain wins"
```

### Task 3: `Chain.js` market-notice slot (`subscribe_to_market`)

**Files:**
- Modify: `vanilla/js/chain.js`
- Test: `node --check vanilla/js/chain.js` + headless subscribe smoke (manual, testnet)

**Interfaces:**
- Consumes: existing `call/db`, `database_api.hpp:602-610` (`subscribe_to_market(cb,A,B)`, `unsubscribe_from_market(A,B)`).
- Produces: `Chain.subscribeMarket(baseId, quoteId, cb) -> Promise<unsub>`, `Chain.unsubscribeMarket(baseId, quoteId)`.

- [ ] **Step 1: Write the failing check**

Run: `node -e "const C=require('/workspace/vanilla/js/chain.js'); console.log(typeof C.subscribeMarket)"`
Expected: `undefined`

- [ ] **Step 2: Implement minimal slot**

Add `MARKET_CB_ID = 2`, `marketCb = null`; in `connect()` after block-callback, do not auto-subscribe (route-owned). `subscribeMarket(base, quote, cb)`: `marketCb = cb`; `return call(dbId, "subscribe_to_market", [MARKET_CB_ID, base, quote]).then(() => () => unsubscribeMarket(base, quote))`. Extend `onmessage` notice routing: `params[0]===MARKET_CB_ID → marketCb(params[1])`. `unsubscribeMarket`: `marketCb = null`; best-effort `call(dbId, "unsubscribe_from_market", [base, quote]).catch(()=>{})`. Reset `marketCb` on close/reconnect.

- [ ] **Step 3: Verify**

Run: `node --check vanilla/js/chain.js && node -e "const C=require('/workspace/vanilla/js/chain.js'); console.log(typeof C.subscribeMarket, typeof C.unsubscribeMarket)"`
Expected: `function function`, check clean.

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/chain.js
git commit -m "Deep candles 3/5: Chain market-notice slot with unsubscribe"
```

### Task 4: Exchange live tip in `market-desk.js` (debounced patch + poll fallback)

**Files:**
- Modify: `vanilla/js/market-desk.js`
- Test: headless `#/market/BTS_CNY` mainnet + testnet, zero console errors

**Interfaces:**
- Consumes: `Chain.subscribeMarket/unsubscribeMarket`, `Market.trades/stats`, `MarketInd.maybeDraw`, existing `_cleanups/cleanup/gen-guard`.
- Produces: live tip patch (same `state.candles` shape), count note `N candles · deep|chain-only · live|poll`.

- [ ] **Step 1: Write the failing expectation (code search)**

Run: `grep -c "subscribeMarket" vanilla/js/market-desk.js`
Expected: `0`

- [ ] **Step 2: Implement**

In `showDesk` after assets resolve: try `Chain.subscribeMarket(b.id, q.id, onMarketPush)` with 500ms debounce → delta `Market.trades(b.id,q.id,10)` + `Market.stats` → orient each fill (`Market._fillPair`-equivalent via `trades()` rows is enough: reuse latest `displayPrice`), patch tip bucket or roll new slot(s) with carry-forward, update strip last-price, `MarketInd.maybeDraw(state)`; push `_cleanups` entry calling unsub + clearTimeout. Catch → 3.5s `setInterval` light poll of same delta (skip when `document.hidden`), also registered in `_cleanups`. Keep 15s full `fill(state)` floor. Gen-guard every continuation with route-id check.

- [ ] **Step 3: Verify headless**

Run: serve `python3 -m http.server 8081 --directory vanilla`, load `#/market/BTS_CNY` headless at 1440 + 390 in all three themes, confirm tip updates on push or poll, no console errors; route away → no further market calls.

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/market-desk.js
git commit -m "Deep candles 4/5: exchange live tip with poll fallback"
```

### Task 5: Pool live tip in `pool-detail-ui.js` (block feed → op-63 scan)

**Files:**
- Modify: `vanilla/js/pool-detail-ui.js`
- Test: headless `#/pools/1.19.133` mainnet, zero console errors

**Interfaces:**
- Consumes: `Chain.status` head block (existing block-applied feed), `Chain.db/call(get_block)`, `PoolHistory.enrich`, `MarketInd.maybeDraw`.
- Produces: pool tip patch/roll on new heads while route is live.

- [ ] **Step 1: Write the failing expectation**

Run: `grep -c "get_block" vanilla/js/pool-detail-ui.js`
Expected: `0`

- [ ] **Step 2: Implement**

In `detailFill` after `chartPane` paints: store `poolLive = {id, legA, legB, lastHead}`; `Store.subscribe("connection", st => onHead(st.headBlock))` registered in route teardown (use existing `gen`/`live()` guards; keep the returned off in a local and call it when `live()` goes false — simplest: poll `Chain.status().headBlock` on a 3.5s interval AND hook the existing connection subscriber if `Store.subscribe` exists). `onHead(n)`: if `n<=lastHead` return; `lastHead=n`; `get_block(n)` → scan `transactions[].operations[]` for `[63, body]` with `body.pool===id` → build swap discretes from `operation_result_object` paid/received (same shape as `chainSwaps`) → leg-filter → `enrich` → append to `P.swaps` → `rebucket()` + tape prepend (cap 200). Failures silent.

- [ ] **Step 3: Verify headless + rot gate**

Run: `python3 tooling/check_rot.py` (expect PASS), `node --check vanilla/js/pool-detail-ui.js`, headless pool desk at 1440 + 390 in all three themes loads with `live` in count note, zero console errors.

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/pool-detail-ui.js
git commit -m "Deep candles 5/5: pool block-listener live tip"
```
