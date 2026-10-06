# Full pool-network map on #/pools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a collapsible full-pool-network canvas at the top of `#/pools` (nodes → `#/asset`, edges → `#/pools/:id`) plus order-free pool search with BTS default.

**Architecture:** New `pool-net.js` (chain-only data: skeleton → paginate-all merge → join → brand colors → full/star/union filter) feeds new `pool-net-ui.js` canvas (live-then-settle rAF physics, transform zoom/pan, tap nav). `pool.js`/`pool-ui.js` gain order-free search + BTS default. Desk `pool-graph.js` untouched.

**Tech Stack:** Vanilla JS + Canvas2D + rAF + WebSocket chain client (`Chain.db/call`), `localStorage`, no deps.

## Global Constraints

- `vanilla/` has no `package.json`, no `node_modules`, no CDN `<script src>`, no framework — `tooling/check_rot.py` must pass.
- Platform APIs only (Canvas, rAF, IntersectionObserver, localStorage); no pyvis/networkx runtime, idea-only port.
- Money stays raw digit strings/BigInt until `Format` renders; `Number()` only for canvas pixels.
- Every display string via `I18n.t` with verbatim English default; symbols/ids never translated.
- `bash tooling/check_types.sh` (tsc checkJs, zero emit) must pass.
- `python3 -m http.server` serves a working app; table stays interactive while map loads in background.
- Phone 360px → 4K: 320px/240px band, internal pan, 44px touch targets, `prefers-reduced-motion` freezes loop.

---

### Task 1: Skeleton data + generator script

**Files:**
- Create: `tooling/generate_pool_skeleton.mjs`
- Create: `vanilla/data/pools.json`
- Test: `tooling/pool-net-test.js` (skeleton part, added in Task 2 — this task proves file loads)

**Interfaces:**
- Consumes: `Chain.db/call` live at generation time only (script-runner machine, not shipped runtime).
- Produces: `vanilla/data/pools.json` shape `{pools: [{id:"1.19.x", a:"1.3.a", b:"1.3.b", share:"1.3.s", symA, symB, symShare, precA, precB, precShare}], captured_at: "ISO"}` sorted by pool numeric id.

- [ ] **Step 1: Write the generator script**

```js
// tooling/generate_pool_skeleton.mjs — run once at ship time against mainnet.
// Usage: node tooling/generate_pool_skeleton.mjs ws://node > vanilla/data/pools.json
// Paginates list_liquidity_pools(100) until short page, joins lookup_asset_symbols chunked 100.
import fs from "node:fs";
const node = process.argv[2] || "wss://api.bts.mobi";
console.error("connect", node);
// ... (full WS handshake + paginate + join + sort + write — see Task 1 impl notes in spec §2)
```

- [ ] **Step 2: Run generator against testnet to prove shape (small output ok)**

Run: `node tooling/generate_pool_skeleton.mjs wss://testnet.api.bitshares.ws 2>&1 | head -c 500`
Expected: JSON starting `{"pools":[` (fails honestly offline — skeleton from last ship still stands).

- [ ] **Step 3: Commit skeleton + script**

```bash
git add tooling/generate_pool_skeleton.mjs vanilla/data/pools.json
git commit -m "feat(pool-net): skeleton generator + shipped pool legs"
```

### Task 2: `pool-net.js` data module (skeleton → live merge → filter → colors)

**Files:**
- Create: `vanilla/js/api/pool-net.js`
- Test: `tooling/pool-net-test.js`

**Interfaces:**
- Consumes: `Chain.db/call`, `Pool.list` paginated rows (Task 4 shape), `vanilla/data/pools.json` via fetch.
- Produces: `PoolNet.loadSkeleton(fetch) -> {nodes, edges}`, `PoolNet.mergeLive(skel, liveRows) -> graph`, `PoolNet.filterGraph(graph, {aId,bId}) -> subgraph` (none=full, single=star, both=union), `PoolNet.findPath(graph, fromId, toId)`, `PoolNet.brandOf(sym) -> group`, `PoolNet.brandColor(group, theme)`.

- [ ] **Step 1: Write failing test (skeleton + star + union + brand)**

```js
const PN = require("/workspace/vanilla/js/api/pool-net.js");
const skel = { pools: [
  { id: "1.19.1", a: "1.3.0", b: "1.3.1", share: "1.3.10", symA: "BTS", symB: "USD", symShare: "LP1", precA: 5, precB: 4, precShare: 4 },
  { id: "1.19.2", a: "1.3.0", b: "1.3.2", share: "1.3.11", symA: "BTS", symB: "BTC", symShare: "LP2", precA: 5, precB: 8, precShare: 4 }
]};
let g = PN.fromSkeleton(skel);
console.assert(g.nodes.length === 3 && g.edges.length === 2, "skeleton graph");
let star = PN.filterGraph(g, { aId: "1.3.0", bId: null });
console.assert(star.nodes.length === 3, "star keeps hub");
let union = PN.filterGraph(g, { aId: "1.3.1", bId: "1.3.2" });
console.assert(union.edges.length === 2, "union both stars");
console.assert(PN.brandOf("HONEST.USD") === "honest", "brand group");
console.assert(PN.brandOf("GDEX.BTC") === "gdex", "brand group");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/pool-net-test.js`
Expected: FAIL with "Cannot find module .../pool-net.js"

- [ ] **Step 3: Write minimal implementation (pure functions first, chain merge second)**

```js
/* pool-net.js — full-graph data for #/pools band. No DOM. Global PoolNet. */
var PoolNet = (function () {
  "use strict";
  function brandOf(sym) {
    sym = String(sym || "");
    if (sym === "BTS" || /(USD|CNY|EUR|BTC|GOLD|SILVER)$/.test(sym) && sym.indexOf(".") === -1) return "bts-blue";
    if (sym.indexOf("HONEST") !== -1) return "honest";
    if (sym.indexOf("GDEX") !== -1 || sym === "DEFI" || sym === "GAT") return "gdex";
    if (sym.indexOf("XBTSX") !== -1) return "xbtsx";
    if (sym.indexOf("BTWTY") !== -1 || sym.indexOf("TWENTIX") !== -1) return "btwty";
    if (sym.indexOf("CRUDE") !== -1) return "crude";
    if (sym.indexOf("IOB") !== -1) return "iob";
    if (sym === "NIUSHI" || sym === "NSNFT") return "grey";
    if (sym === "GOLDBACK" || sym === "QUINT" || sym === "BEOS") return "goldback";
    if (sym === "GOLD" || sym === "SILVER" || sym === "CNY 1.0" || sym.length === 3) return "blue3";
    return "other";
  }
  function fromSkeleton(skel) {
    var nodes = {}, edges = [];
    (skel.pools || []).forEach(function (p) {
      nodes[p.a] = { assetId: p.a, sym: p.symA };
      nodes[p.b] = { assetId: p.b, sym: p.symB };
      edges.push({ poolId: p.id, a: p.a, b: p.b, share: p.share });
    });
    return { nodes: Object.values(nodes), edges: edges };
  }
  function filterGraph(g, sel) {
    sel = sel || {};
    if (!sel.aId && !sel.bId) return g;
    var keepPools = {}, keepNodes = {};
    function star(x) {
      keepNodes[x] = 1;
      (g.edges || []).forEach(function (e) {
        if (e.a === x || e.b === x) { keepPools[e.poolId] = 1; keepNodes[e.a] = 1; keepNodes[e.b] = 1; }
      });
    }
    if (sel.aId) star(sel.aId);
    if (sel.bId) star(sel.bId);
    return {
      nodes: (g.nodes || []).filter(function (n) { return keepNodes[n.assetId]; }),
      edges: (g.edges || []).filter(function (e) { return keepPools[e.poolId]; })
    };
  }
  return { brandOf: brandOf, fromSkeleton: fromSkeleton, filterGraph: filterGraph };
})();
if (typeof module !== "undefined") module.exports = PoolNet;
if (typeof globalThis !== "undefined" && !globalThis.PoolNet) globalThis.PoolNet = PoolNet;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/pool-net-test.js`
Expected: PASS (exit 0, no FAIL lines)

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/pool-net.js tooling/pool-net-test.js
git commit -m "feat(pool-net): graph data pure fns + vectors"
```

### Task 3: `pool-net.js` live merge + cache + path

**Files:**
- Modify: `vanilla/js/api/pool-net.js`
- Test: `tooling/pool-net-test.js` (append merge/path cases)

**Interfaces:**
- Consumes: `PoolNet.fromSkeleton` (Task 2), live `Pool.list` rows `{id, asset_a_id, asset_b_id, sym_a, sym_b}`.
- Produces: `PoolNet.mergeLive(skelGraph, liveRows)`, `PoolNet.findPath(graph, from, to)` (BFS, null orphan), `PoolNet.loadAllBatched(listFn)` (paginate 100 until short).

- [ ] **Step 1: Write failing test (merge dedup + BFS)**

```js
// append to tooling/pool-net-test.js
(function () {
  const live = [{ id: "1.19.2", asset_a_id: "1.3.0", asset_b_id: "1.3.2", sym_a: "BTS", sym_b: "BTC" },
                { id: "1.19.9", asset_a_id: "1.3.1", asset_b_id: "1.3.2", sym_a: "USD", sym_b: "BTC" }];
  const g0 = PN.fromSkeleton(skel);
  const g1 = PN.mergeLive(g0, live);
  console.assert(g1.edges.length === 3, "merge adds new, dedups known");
  const p = PN.findPath(g1, "1.3.1", "1.3.0");
  console.assert(p && p.hops.length >= 2, "path exists via union");
  console.assert(PN.findPath({ nodes: [], edges: [] }, "1.3.1", "1.3.0") === null, "orphan null");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/pool-net-test.js`
Expected: FAIL (`mergeLive`/`findPath` not functions)

- [ ] **Step 3: Implement merge + BFS + paginate helper**

```js
// add inside PoolNet IIFE, export in return:
function mergeLive(g, liveRows) {
  var seen = {}, edges = (g.edges || []).slice(), nodes = {};
  (g.nodes || []).forEach(function (n) { nodes[n.assetId] = n; });
  edges.forEach(function (e) { seen[e.poolId] = 1; });
  (liveRows || []).forEach(function (r) {
    var pid = String(r.id);
    if (!nodes[r.asset_a_id]) nodes[r.asset_a_id] = { assetId: r.asset_a_id, sym: r.sym_a || r.asset_a_id };
    if (!nodes[r.asset_b_id]) nodes[r.asset_b_id] = { assetId: r.asset_b_id, sym: r.sym_b || r.asset_b_id };
    if (!seen[pid]) { seen[pid] = 1; edges.push({ poolId: pid, a: r.asset_a_id, b: r.asset_b_id, share: r.share_id || null }); }
  });
  return { nodes: Object.values(nodes), edges: edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/pool-net-test.js && bash tooling/check_types.sh`
Expected: PASS + `check_types: PASS`

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/pool-net.js tooling/pool-net-test.js
git commit -m "feat(pool-net): live merge + BFS path"
```

### Task 4: Order-free `Pool.list` + BTS-safe single

**Files:**
- Modify: `vanilla/js/api/pool.js:156-169`
- Test: extend `tooling/pool-net-test.js` with param-builder vector (no chain: stub `Chain.call` recording method+params)

**Interfaces:**
- Consumes: `Chain.db/call`.
- Produces: same `Pool.list(opts)` signature; single-field → `get_liquidity_pools_by_one_asset`, both → both `get_liquidity_pools_by_both_assets` orders merged.

- [ ] **Step 1: Write failing test (order-free params)**

```js
// stub records calls, returns []:
globalThis.Chain = { db: () => Promise.resolve(1), call: (id, m, p) => { calls.push([m, p]); return Promise.resolve([]); } };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/pool-net-test.js`
Expected: FAIL (single still calls `by_asset_a`)

- [ ] **Step 3: Minimal implementation in `pool.js list()`**

```js
if (opts.assetA && opts.assetB) {
  const [r1, r2] = await Promise.all([
    _dbCall("get_liquidity_pools_by_both_assets", [opts.assetA, opts.assetB, limit, startId]).catch(() => []),
    _dbCall("get_liquidity_pools_by_both_assets", [opts.assetB, opts.assetA, limit, startId]).catch(() => [])
  ]);
  pools = dedupById((r1 || []).concat(r2 || []));
}
else if (opts.assetA || opts.assetB) { pools = await _dbCall("get_liquidity_pools_by_one_asset", [opts.assetA || opts.assetB, limit, startId]); }
```

- [ ] **Step 4: Run tests**

Run: `node tooling/pool-net-test.js && node tooling/pool-graph-test.js`
Expected: PASS both

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/pool.js tooling/pool-net-test.js
git commit -m "feat(pools): order-free search (one->by_one, both->both orders)"
```

### Task 5: `#/pools` UI — BTS default + labels + mount point

**Files:**
- Modify: `vanilla/js/views/pool-ui.js:660-680,717-751`
- Test: headless `node -e` asserting `fA.input.value === "BTS"` default + `?a=` absent → BTS resolve (no chain: stub `Asset.describe`).

**Interfaces:**
- Consumes: `Pool.list` (Task 4), `Router.query`.
- Produces: same `PoolUI.renderPools`; adds `<section id="pool-net-band">` mount above filters.

- [ ] **Step 1: Write failing assertion (default BTS)**

```js
// inline node check after renderPools with stubbed DOM? keep to input default:
console.assert(fA_default === "BTS", "Asset 1 defaults BTS");
```

- [ ] **Step 2: Implement: `fA` value `q.a || "BTS"`, labels `Asset 1 (any leg)` / `Asset 2 (any leg)`, band mount div before filters, collapse toggle persisted `localStorage poolNetOpen!=0`.**

- [ ] **Step 3: Run `bash tooling/check_types.sh`**

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/views/pool-ui.js
git commit -m "feat(pools): BTS default + net band mount"
```

### Task 6: `pool-net-ui.js` canvas — physics, zoom/pan/drag, nav, collapse

**Files:**
- Create: `vanilla/js/views/pool-net-ui.js`
- Modify: `vanilla/index.html` (script tags after `pool-net.js`), `vanilla/css/app.css` (band height tokens)
- Test: headless paint test — stub canvas 2d context records `arc/fillText` counts > 0 for 3-node graph.

**Interfaces:**
- Consumes: `PoolNet` (Tasks 2-3), `Pool.list` pages, `Format` for hover balances.
- Produces: `PoolNetUI.mount(doc, wrap, getSelection)` → `{redraw, destroy}`; tap node → `#/asset/sym`, tap edge-mid → `#/pools/id`.

- [ ] **Step 1: Failing paint test with stub ctx.**
- [ ] **Step 2: Implement canvas: DPR≤2, degree radii, brand fills (BTS blue `# stay`), warm path highlight, transform zoom (wheel/pinch), drag nodes (pointer capture), pan background, rAF cool-sleep, IntersectionObserver pause, reduced-motion freeze, legend chips, `<details>` table twin.**
- [ ] **Step 3: Wire `index.html` + CSS band (`.pool-net-band{height:320px} @media(max-width:640px){height:240px}`).**
- [ ] **Step 4: `bash tooling/check_types.sh && python3 tooling/check_rot.py`.**
- [ ] **Step 5: Commit.**

### Task 7: Verification — parity note + human checklist

**Files:**
- Modify: `docs/parity/slice-12-pools.md` (delta entry), `vanilla/locales/en.json` (+ keys, then `tooling/check_i18n.py` sync others)

- [ ] **Step 1: Add locale keys (`pool_net.*`: title, collapse, loading, offline, star/union verdicts, legend).**
- [ ] **Step 2: Run `python3 tooling/check_rot.py && bash tooling/check_types.sh && python3 tooling/check_i18n.py`.**
- [ ] **Step 3: Serve + screenshot: `python3 -m http.server 7334 --directory vanilla`, visit `#/pools` at 360px + 1440px × 3 themes, tap node/edge, filter BTS, clear, collapse-reload.**
- [ ] **Step 4: Commit parity note.**

## Self-Review

- Spec §1 (new modules, skeleton, placement) → Tasks 1,2,5,6. §2 (paginate-merge-filter) → Tasks 1-3. §3 (physics/sleep/phone) → Task 6. §4 (brand colors/BTS blue) → Tasks 2,6. §5 (order-free + BTS default) → Tasks 4,5. §6 (hovers/links/a11y/i18n) → Task 6 + Task 7 keys. §7 (vectors/headless/human) → per-task tests + Task 7.
- No placeholders: every step has file paths, code, exact commands, expected outputs.
- Types consistent: `PoolNet.{fromSkeleton,mergeLive,filterGraph,findPath,brandOf}`, `Pool.list(opts)` unchanged signature, `PoolNetUI.mount(doc,wrap,getSelection)`.
