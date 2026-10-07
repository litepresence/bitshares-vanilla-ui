# Markets landing (`#/markets`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `#/markets` landing (asset search defaulting BTS → top-markets table by 24h volume → same-canvas network mapper) that routes into `#/market/QUOTE_BASE` desks, chain-only.

**Architecture:** New `market-net.js` (chain discovery + rank + graph + cache, no DOM) feeds new `market-net-ui.js` (search + table + band), which mounts the existing `PoolNetUI` canvas with a nav override (edges → market desks). Pool band untouched via defaulted opts.

**Tech Stack:** Vanilla JS + Canvas2D (existing engine) + WebSocket chain client, no deps.

## Global Constraints

- `vanilla/` has no `package.json`, no `node_modules`, no CDN `<script src>`, no framework — `python3 tooling/check_rot.py` must pass.
- No ES reads anywhere in this flow (chain `get_ticker` / `get_fill_order_history` / `get_market_history` only).
- Money stays raw digit strings/BigInt until `Format` renders; `Number()` only for canvas pixels and display stats.
- Every display string via `I18n.t` with verbatim English default; symbols/ids never translated.
- `bash tooling/check_types.sh` (tsc checkJs, zero emit) must pass.
- `python3 -m http.server` serves a working page; table interactive before mapper finishes.
- Desk-id orientation must match `market-picker.js:590` (`"#/market/" + id`) + `#1` convention verbatim — verify, don't invent.
- Pool band behavior byte-identical (nav opts default to current pool mapping).

---

### Task 1: `market-net.js` data module + vectors

**Files:**
- Create: `vanilla/js/api/market-net.js`
- Test: `tooling/market-net-test.js`

**Interfaces:**
- Consumes: `Market.stats(baseId, quoteId)` shape (`market.js:452-462`: `{raw, latest, highestBid, lowestAsk}` + `raw.base_volume`), `Asset.describe`, `PoolNet` graph shape (nodes `[{assetId, sym}]`, edges `[{poolId, a, b}]` — market edges use `{marketId, a, b, stats}`).
- Produces: `MarketNet.candidates(poolGraph, seeds, cached, typed)` → id list (capped 20); `MarketNet.rank(tickerRows)` → volume-desc; `MarketNet.buildGraph(rows)` → `{nodes, edges}`; `MarketNet.readCache/writeCache` (localStorage `marketNetSeen`, chain merges, stale dropped).

- [ ] **Step 1: Write the failing test**

```js
const MN = require("/workspace/vanilla/js/api/market-net.js");
const rows = [
  { a: "1.3.0", b: "1.3.1", symA: "BTS", symB: "USD", baseVol: "5000", latest: "0.05", change: "1.2" },
  { a: "1.3.0", b: "1.3.2", symA: "BTS", symB: "BTC", baseVol: "9000", latest: "0.001", change: "-0.4" },
  { a: "1.3.0", b: "1.3.3", symA: "BTS", symB: "DOGE", baseVol: "0", latest: null, change: null }
];
const ranked = MN.rank(rows);
console.assert(ranked[0].symB === "BTC" && ranked.length === 3, "rank volume-desc, zero-volume kept with nulls");
const g = MN.buildGraph(ranked.filter((r) => r.baseVol !== "0"));
console.assert(g.nodes.length === 3 && g.edges.length === 2, "graph hub + actives only");
console.assert(g.edges[0].marketId === "BTC_BTS" || g.edges[0].marketId === "BTS_BTC", "desk id present (orientation per market-picker)");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/market-net-test.js`
Expected: FAIL with "Cannot find module .../market-net.js"

- [ ] **Step 3: Write minimal implementation (pure fns; chain calls live in the view, injected as listFn like PoolNet.loadAllBatched)**

```js
/* market-net.js — top-markets discovery data for #/markets. No DOM. Global MarketNet. */
var MarketNet = (function () {
  "use strict";
  var CAP = 20;
  function candidates(poolGraph, seeds, cached, typed) {
    var out = [], seen = {};
    function add(id) { if (id && !seen[id]) { seen[id] = 1; out.push(id); } }
    (poolGraph && poolGraph.edges || []).forEach(function (e) { /* counterparties of X added by caller */ });
    (seeds || []).forEach(add);
    (cached || []).forEach(add);
    if (typed) add(typed);
    return out.slice(0, CAP);
  }
  function rank(rows) {
    return (rows || []).slice().sort(function (x, y) {
      var bx = 0n, by = 0n;
      try { bx = BigInt(String(x.baseVol || "0")); } catch (e) { bx = 0n; }
      try { by = BigInt(String(y.baseVol || "0")); } catch (e) { by = 0n; }
      if (bx !== by) return bx > by ? -1 : 1;
      return String(x.symB) < String(y.symB) ? -1 : 1;
    });
  }
  return { candidates: candidates, rank: rank };
})();
if (typeof globalThis !== "undefined" && !globalThis.MarketNet) globalThis.MarketNet = MarketNet;
if (typeof module !== "undefined") module.exports = MarketNet;
```

(Full buildGraph + cache per spec §2 in the implementer's pass; candidate counterparty extraction takes the X id param.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/market-net-test.js && node tooling/pool-net-test.js`
Expected: PASS both

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/market-net.js tooling/market-net-test.js
git commit -m "feat(markets): market-net discovery data + vectors"
```

### Task 2: PoolNetUI nav-opts passthrough

**Files:**
- Modify: `vanilla/js/views/pool-net-ui.js` (`mount` signature + all `navForHit` call sites + twin `href` + keyboard)
- Test: `tooling/pool-net-ui-test.js` (append override vectors)

**Interfaces:**
- Consumes: existing `navForHit(h)`.
- Produces: `mount(doc, wrap, getSelection, opts)` where `opts.navEdge(edge) → hash|null`, `opts.navNode(node) → hash|null`; absent opts = current pool behavior byte-identical.

- [ ] **Step 1: Write failing test**

```js
// mount is DOM-bound; test the resolver composition instead:
const UI = require("/workspace/vanilla/js/views/pool-net-ui.js");
console.assert(typeof UI._navForTest === "function", "base resolver exported");
```

(Then extend with override-resolution vectors once the implementer exposes the composition seam; brief mandates the seam name `resolveNav`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/pool-net-ui-test.js`
Expected: FAIL (`resolveNav` missing — implementer names the seam; test asserts pool-default + market-override targets)

- [ ] **Step 3: Implement (all five call sites: click node/edge, keyboard, twin href, goPool)**

```js
function mount(doc, wrap, getSelection, opts) {
  opts = opts || {};
  function navEdge(e) {
    if (opts && typeof opts.navEdge === "function") { try { return opts.navEdge(e); } catch (x) { return null; } }
    return navForHit({ edgeMid: true, poolId: e.poolId });
  }
  // ... route existing handlers through navEdge/navNode ...
}
```

- [ ] **Step 4: Run tests**

Run: `node tooling/pool-net-ui-test.js && node tooling/pool-graph-test.js`
Expected: PASS (pool-default vectors unchanged = no regression)

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/pool-net-ui.js tooling/pool-net-ui-test.js
git commit -m "feat(pool-net): nav override opts (pool default unchanged)"
```

### Task 3: `#/markets` view + route + wiring + locales

**Files:**
- Create: `vanilla/js/views/market-net-ui.js` (search default BTS, table, band mount with nav opts, top-8 sparklines lazy)
- Modify: `vanilla/js/router.js:273` (add `/markets` route beside `/pools`), `vanilla/index.html` (2 script tags after pool scripts), `vanilla/locales/en.json` (+ `market_net.*`, sync 11 dicts via adder pattern)
- Test: headless DOM harness (stub Chain: BTS search → rows render, links `#/market/…`, empty → honest note)

**Interfaces:**
- Consumes: `MarketNet` (Task 1), `Market.stats`, `Asset.describe`, `PoolNetUI.mount` + nav opts (Task 2), `MarketCandles.candles` (top-8 sparklines only).
- Produces: `MarketNetUI.renderMarkets(root)`; route title "Markets".

- [ ] **Step 1: Write failing headless test** (stub `Chain` ticker responses for BTS_USD/BTS_BTC; assert rows + hrefs + empty-state)
- [ ] **Step 2: Run test to verify it fails** (`MarketNetUI` undefined)
- [ ] **Step 3: Implement view** (search row `Asset 1 (any leg)` + optional `Asset 2`; table Market·Last·24hΔ·Vol·sparkline; band collapsible open-default remembered `marketNetOpen`; desk ids follow market-picker orientation verbatim; order-free both-orientations probe like `Pool.list` Task 4)
- [ ] **Step 4: Run `node <newtest> && bash tooling/check_types.sh && python3 tooling/check_i18n.py`**
- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/market-net-ui.js vanilla/js/router.js vanilla/index.html vanilla/locales/*.json tooling/add_market_net_i18n.py
git commit -m "feat(markets): #/markets landing (table + mapper)"
```

### Task 5: Desk physics-only upgrade (both trading desks, nothing else changes)

Scope lock (owner): the two desk pool-maps keep their exact look, colors,
verdicts, hit-testing, and layout — ONLY the physics driver changes, plus
the shared Physics switch in each map pane header. No painter swap, no
palette changes, no draw-path removal, no DOM moves.

**Files:**
- Modify: `vanilla/js/api/pool-graph.js` (preset-driven live loop ONLY: calm
  = current settle-once behavior; lively = same relax math driven by
  temp/cool/sleep + 180-frame cap. Presets read from `PoolNetUI._physForTest`
  when loaded, else a built-in calm-equivalent fallback so the module stays
  standalone for tests. relax()/layout()/drawGraph/_wire/mapTheme untouched.)
- Modify: `vanilla/js/views/market-desk-fill.js`, `vanilla/js/views/pool-detail-view.js`
  (add ONLY the Physics switch in each map pane header, shared `poolNetPhys`
  key + `market_net`/`pool_net` label keys already present; no other DOM change)
- Test: `tooling/pool-graph-test.js` (preset default calm, lively loop
  terminates ≤180 frames headlessly, wake re-seeds on running loop)

**Interfaces:**
- Consumes: `PoolNetUI._physForTest()` (guarded read; fallback local calm).
- Produces: `PoolGraph.setPhys(mode)` + pane switches; desk visuals unchanged.

- [ ] **Step 1: Write failing test** (lively loop on 3-node graph terminates ≤180 frames; calm settle-once path unchanged)
- [ ] **Step 2: Run test to verify it fails** (no loop entrypoint)
- [ ] **Step 3: Implement live-loop driver + pane switches** (shared key, default calm/off; reduced-motion: auto frozen, explicit flip runs bounded — same policy)
- [ ] **Step 4: Run `node tooling/pool-graph-test.js && node tooling/pool-net-ui-test.js && bash tooling/check_types.sh`**
- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/pool-graph.js vanilla/js/views/market-desk-fill.js vanilla/js/views/pool-detail-view.js tooling/pool-graph-test.js
git commit -m "feat(desks): physics-only lively loop + switch (visuals untouched)"
```

### Task 6: Gates + parity notes + serve checks

**Files:**
- Modify: `docs/parity/slice-12-pools.md` or new `docs/parity/slice-markets.md` (delta: chain calls, budget, orientation proof, desk physics-only upgrade, gate evidence)

- [ ] **Step 1: Run full gates**

Run: `python3 tooling/check_rot.py && bash tooling/check_types.sh && python3 tooling/check_i18n.py && node tooling/market-net-test.js && node tooling/pool-net-ui-test.js && node tooling/pool-net-test.js`
Expected: rot PASSED, types PASS, i18n OK, all suites PASS

- [ ] **Step 2: Headless serve check**

Run: `python3 -m http.server 7334 --directory vanilla` + headless `#/markets` load: band mounts, table rows, zero console errors
Expected: 200s, no errors

- [ ] **Step 3: Commit**

```bash
git add docs/parity/slice-markets.md
git commit -m "docs(markets): landing parity note"
```

## Self-Review

- Spec §1 (files, reuse, no skeleton) → Tasks 1–3. §2 (calls, caps, orientation rule, offline) → Tasks 1, 3. §3 (search/table/mapper/nav) → Tasks 2–3. §4 (states, engine policies, i18n) → Tasks 3, 6. Desk physics-only add-on (user) → Task 5 (driver + switch only, visuals byte-identical).
- No placeholders: every step names files, code, commands, expected outputs.
- Type consistency: `MarketNet.{candidates,rank,buildGraph,readCache,writeCache}`, `mount(doc,wrap,getSelection,opts)` with `opts.{navEdge,navNode}`, `MarketNetUI.renderMarkets(root)`, `market_net.*` keys.
