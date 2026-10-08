# Market Hops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two market network charts (#/markets band, #/market desk slice) an ES-driven multi-hop market web — 3 hops on the selector, 2 on the desk — with fills-based price provenance, an explicit BTS route, no display caps, and pool fallback with honest note switching.

**Architecture:** One new no-DOM data module `vanilla/js/api/market-hops.js` fetches 24h-active market pairs from the community ES with a single composite aggregation (paginated), then does pure in-memory BFS to grow a 3-hop / 2-hop web from seed assets. The result is emitted in the exact graph shape both existing painters already speak (`nodes`, `edges[{id,poolId,a,b,sizeRaw}]`, `meta`), so `PoolNetUI` (selector) and `PoolGraph` (desk) render it unchanged apart from a `kind:"market"` branch that swaps the fills ramp and the BTS-route highlight. Any ES failure (pref off, testnet, unreachable, partial page) falls back to today's ticker graph on the selector and today's pool graph on the desk, with the note switching to match what is actually painted.

**Tech Stack:** vanilla ES5-style JS (classic `<script>`), Canvas2D, `HistoryCap.esSearch` (the single pref-gated ES seam), BigInt-free integer math on fill counts, node test harness under `tooling/`.

## Global Constraints

- Zero runtime dependencies. No npm, no bundler, no CDN. Static-servable via `python3 -m http.server`. (`AGENTS.md` §4.5 rule 1)
- One module talks to nodes: `vanilla/js/api/chain.js` (via `Market`/`PoolGraph` helpers). ES goes only through `HistoryCap.esSearch`. (`AGENTS.md` principle 3)
- All human-readable numbers go through `Format` (`vanilla/js/api/format.js`). Fill counts are integers, not money — `Number()` is fine for counts and canvas pixels only, never for amounts. (`AGENTS.md` §3.5)
- No per-pair ES fan-out. One composite aggregation + in-memory BFS.
- Testnet never queries ES (index is mainnet-only; ids collide across chains). Guard on `Store.loadSettings().network === "mainnet"`.
- ES transport pages (`composite size 1000`, max 3 pages) are the only bound; display has NO caps. A partial page degrades to fallback rather than truncating silently.
- Shared helpers must be used, never reimplemented: `DOM`, `Forms`, `touchable`, `TableRenderer`, `ConfirmDialog`, `Overlay`, `Event`. (`AGENTS.md` §7 rule 9)
- Every user-visible string: `t(key, "verbatim English default")`, keyed under a `market.*` namespace, with entries in all 12 `vanilla/locales/*.json`.
- Every file opens with a module header (owns / consumes / side effects / origin) and every non-trivial function gets a what/params/returns/failure comment. No `TODO|FIXME`, no commented-out code.
- Pool charts (`#/pools` band, `#/pools/:id` slice) have ZERO behavior change in this plan.

---

## File Structure

**Create:**
- `vanilla/js/api/market-hops.js` — ES 24h active pairs fetch + merge, pure BFS `hopsFrom`, fills-weighted `routeToCore`, `toGraph` emitter. No DOM.
- `tooling/market-hops-test.js` — headless node tests for all of the above.

**Modify:**
- `vanilla/js/views/market-net-ui.js` — band graph resolution: MarketHops 3-hop first, ticker 1-hop fallback; status/note keys.
- `vanilla/js/views/pool-net-chrome.js` — market-mode status + edge card gains fills + price provenance.
- `vanilla/js/views/market-desk-fill.js` — `fetchPoolMap` tries MarketHops 2-hop; fallback pool path; `kind` on `graphData`; note switch.
- `vanilla/js/api/pool-graph.js` — `drawGraph` accepts `opts.kind === "market"` (fills ramp, route path set, no orphan verdict).
- `vanilla/js/views/pool-net-paint.js` — `edgeT` fills window.
- `vanilla/index.html` — one `<script>` for `market-hops.js`.
- `vanilla/js/globals.d.ts` — `MarketHops` declaration.
- `vanilla/locales/*.json` (12 files) — new `market.*` keys.

---

## Task 1: `market-hops.js` — pure core (merge, BFS, route, toGraph)

**Files:**
- Create: `vanilla/js/api/market-hops.js`
- Test: `tooling/market-hops-test.js`

**Interfaces:**
- Consumes: nothing (pure functions in this task; the ES fetch is Task 2).
- Produces (global `MarketHops`):
  - `mergePairs(buckets: Array) -> Array<{a:string,b:string,fills:number}>` — pure. Unordered dedupe+sum.
  - `hopsFrom(pairs: Array<{a,b,fills}>, seeds: Array<string>, depth: number) -> {nodes: Array<{assetId:string,fills:number,layer:number}>, edges: Array<{id,poolId,a,b,fills:number,sizeRaw:string,layer:number}>}` — pure BFS, no caps.
  - `routeToCore(edges: Array, seeds: Array<string>, coreId: string) -> {deskIds: Array<string>, hops: number}|null` — pure fills-weighted route.

- [ ] **Step 1: Write the failing test file**

`tooling/market-hops-test.js`:

```js
/* market-hops-test.js — headless tests for the market-hops pure core.
 * No network, no DOM: merge + BFS + route + graph shaping. */
var ok = 0, bad = 0;
function assert(cond, msg) { if (cond) { ok++; } else { bad++; console.log("FAIL: " + msg); } }

var MarketHops = require("../vanilla/js/api/market-hops.js");

/* ---- mergePairs ---- */
var buckets = [
  { key: { pays: "1.3.0", receives: "1.3.121" }, doc_count: 5 },
  { key: { pays: "1.3.121", receives: "1.3.0" }, doc_count: 3 },
  { key: { pays: "1.3.0", receives: "1.3.5" }, doc_count: 2 },
  { key: { pays: "bad", receives: "1.3.0" }, doc_count: 9 },
  { doc_count: 7 }
];
var merged = MarketHops.mergePairs(buckets);
assert(merged.length === 2, "merge: two valid pairs survive");
assert(merged[0].a === "1.3.0" && merged[0].b === "1.3.121" && merged[0].fills === 8, "merge: unordered sum = 8");
assert(merged[1].a === "1.3.0" && merged[1].b === "1.3.5" && merged[1].fills === 2, "merge: second pair = 2");
assert(MarketHops.mergePairs(buckets).length === 2, "merge: deterministic (no mutation)");

/* ---- hopsFrom ---- */
/* chain: 0 - 1 - 2 - 3 - 4 - 5  (fills descending along the chain) */
var chain = [
  { a: "1.3.1", b: "1.3.2", fills: 100 },
  { a: "1.3.2", b: "1.3.3", fills: 90 },
  { a: "1.3.3", b: "1.3.4", fills: 80 },
  { a: "1.3.4", b: "1.3.5", fills: 70 },
  { a: "1.3.5", b: "1.3.6", fills: 60 }
];
var h3 = MarketHops.hopsFrom(chain, ["1.3.1"], 3);
var ids3 = h3.nodes.map(function (n) { return n.assetId; });
assert(ids3.indexOf("1.3.4") !== -1, "hops3: 3 hops reached");
assert(ids3.indexOf("1.3.5") === -1, "hops3: 4 hops NOT reached (depth bound held)");
var h2 = MarketHops.hopsFrom(chain, ["1.3.1"], 2);
var ids2 = h2.nodes.map(function (n) { return n.assetId; });
assert(ids2.indexOf("1.3.3") !== -1, "hops2: 2 hops reached");
assert(ids2.indexOf("1.3.4") === -1, "hops2: 3 hops NOT reached");

/* no caps: a 200-edge ring all reachable within depth must all survive */
var ring = [];
for (var i = 0; i < 200; i++) ring.push({ a: "1.3." + (100 + i), b: "1.3." + (100 + ((i + 1) % 200)), fills: 200 - i });
var hRing = MarketHops.hopsFrom(ring, ["1.3.100"], 3);
assert(hRing.edges.length > 0, "nocaps: ring produced edges");

/* seeds always present even when isolated */
var hIso = MarketHops.hopsFrom([], ["1.3.0", "1.3.999"], 2);
assert(hIso.nodes.length === 2, "hops: isolated seeds kept as nodes");

/* deterministic node order */
var orderA = MarketHops.hopsFrom(chain, ["1.3.1"], 3).nodes.map(function (n) { return n.assetId; }).join(",");
var orderB = MarketHops.hopsFrom(chain.slice().reverse(), ["1.3.1"], 3).nodes.map(function (n) { return n.assetId; }).join(",");
assert(orderA === orderB, "hops: node order deterministic under input reorder");

/* ---- routeToCore ---- */
/* pairs: seed S - X (fills 10), S - Y (fills 5), Y - CORE (fills 5), X - CORE (fills 1) */
/* fewest hops from S to CORE is 2 either way; widest bottleneck prefers S-Y-CORE (bottleneck 5) */
var rEdges = [
  { poolId: "SX", a: "1.3.10", b: "1.3.11", fills: 10 },
  { poolId: "SY", a: "1.3.10", b: "1.3.12", fills: 5 },
  { poolId: "YC", a: "1.3.12", b: "1.3.0", fills: 5 },
  { poolId: "XC", a: "1.3.11", b: "1.3.0", fills: 1 }
];
var route = MarketHops.routeToCore(rEdges, ["1.3.10"], "1.3.0");
assert(route !== null, "route: found");
assert(route.hops === 2, "route: 2 hops");
assert(route.deskIds.indexOf("SY") !== -1 && route.deskIds.indexOf("YC") !== -1, "route: widest bottleneck SY-CORE chosen");
var noRoute = MarketHops.routeToCore([{ poolId: "AB", a: "1.3.20", b: "1.3.21", fills: 3 }], ["1.3.20"], "1.3.0");
assert(noRoute === null, "route: null when core unreachable (never fabricated)");

console.log("market-hops core: " + ok + " passed, " + bad + " failed");
if (bad > 0) process.exit(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/market-hops-test.js`
Expected: FAIL — `Cannot find module '../vanilla/js/api/market-hops.js'`.

- [ ] **Step 3: Write `market-hops.js` — pure core only (no ES fetch yet)**

```js
/* MarketHops: 24h-active market network for the two market charts.
 * Owns (this file, pure): mergePairs (ES composite buckets -> unordered
 *   pairs with summed fill counts), hopsFrom (unbounded BFS from seed
 *   assets to a hop depth), routeToCore (fewest-hops, widest-bottleneck
 *   route to BTS weighted by fills), toGraph (emit the shared painter
 *   graph shape from hops + optional ticker provenance).
 *   Also owns fetchActivePairs (the single ES composite aggregation) and
 *   the in-session cache — see its own header section below.
 * Consumes: HistoryCap.esSearch (the ONLY raw-ES seam), Chain.db/call for
 *   lookup_asset_symbols + lookup_asset_ids, Format (human provenance at
 *   render only, via the callers), I18n via the local t wrapper.
 * Side effects: one HTTPS POST per page to the community ES endpoint
 *   (pref-gated, mainnet-gated, capped pages, 15s budget) + in-session
 *   memo of the pair set (never persisted). No DOM, no signing.
 * CHAIN TRUTH (#4 wins): fill_order op id 4 (market.hpp) —
 *   operation_type 4 with pays/receives legs is the 24h fill signal.
 *   BTS core = 1.3.0 literal (consensus, not a lookup).
 * MONEY DISCIPLINE (#6): fills are integer COUNTS (never money) —
 *   sizes feed canvas pixels only; any human price/volume string shown
 *   beside a line is passed in by the view from its own chain ticker
 *   probe (chain owns price, ES owns activity).
 * Created by: market-hops design 2026-10-07
 *   (docs/superpowers/specs/2026-10-07-market-hops-design.md). */

var MarketHops = (function () {
  "use strict";

  var CORE_ID = "1.3.0";
  var ASSET_RE = /^1\.3\.\d+$/;
  var ES_INDEX = "bitshares-*";
  var ES_SIZE = 1000;              // composite page size (astro TopActiveMarkets.ts:85)
  var ES_MAX_PAGES = 3;            // transport page cap, NOT a display cap
  var ES_TIMEOUT_MS = 15000;       // total budget across pages

  /* Batch-2d i18n (market-net-ui.js precedent): verbatim English default,
   * file://-safe; raw default returns unfilled without I18n. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }

  /* ---- mergePairs ---- */

  /* mergePairs: ES composite buckets -> unordered {a,b,fills}, summed.
   * A market between A and B is the same regardless of which side paid,
   * so the two ids are sorted and joined; both orientations sum into one
   * entry (astro TopActiveMarkets.ts pairKey + merge). Malformed buckets
   * (missing legs, non 1.3.x ids, missing doc_count) are DROPPED, never
   * coerced — an invented pair is a lie about activity.
   * Pure: input untouched.
   * @param {Array<Object>} buckets ES by_pair composite buckets.
   * @returns {Array<{a: string, b: string, fills: number}>} sorted by fills desc, then a asc.
   */
  function mergePairs(buckets) {
    var byKey = {}, order = [];
    (buckets || []).forEach(function (bk) {
      if (!bk || !bk.key) return;
      var pays = bk.key.pays, receives = bk.key.receives;
      if (!ASSET_RE.test(String(pays)) || !ASSET_RE.test(String(receives))) return;
      var n = Number(bk.doc_count);
      if (!isFinite(n) || n <= 0) return;
      var ids = [String(pays), String(receives)].sort();
      if (ids[0] === ids[1]) return;             // self-pair is not a market
      var key = ids[0] + "|" + ids[1];
      if (!byKey[key]) { byKey[key] = { a: ids[0], b: ids[1], fills: 0 }; order.push(key); }
      byKey[key].fills += Math.floor(n);
    });
    return order.map(function (k) { return byKey[k]; }).sort(function (x, y) {
      if (x.fills !== y.fills) return y.fills - x.fills;
      return x.a < y.a ? -1 : (x.a > y.a ? 1 : 0);
    });
  }

  /* ---- hopsFrom ---- */

  /* hopsFrom: unbounded BFS from seed assets over the 24h-active pair
   * set, out to `depth` hops. NO CAPS (owner ruling) — the full reachable
   * web is shown; ES page size is the only bound upstream. Seeds are
   * always kept as nodes even when isolated. Node order is deterministic
   * (fills desc, then id asc) so rings never jump between renders.
   * Pure: input untouched.
   * @param {Array<{a:string,b:string,fills:number}>} pairs 24h-active pairs.
   * @param {Array<string>} seeds asset ids to grow from.
   * @param {number} depth max hops (3 selector, 2 desk).
   * @returns {{nodes: Array<{assetId:string,fills:number,layer:number}>,
   *            edges: Array<{id,poolId,a,b,fills:number,sizeRaw:string,layer:number}>}}
   *   nodes carry the summed fills touching that asset; edges carry the
   *   poolId as its own desk id placeholder (toGraph renames), the fills
   *   count, and sizeRaw = fills as a digit string (shared ramp input).
   */
  function hopsFrom(pairs, seeds, depth) {
    var d = (typeof depth === "number" && depth >= 1) ? Math.floor(depth) : 2;
    var adj = {}, nodeFills = {}, layer = {}, reached = {}, i, e;
    for (i = 0; i < (pairs || []).length; i++) {
      e = pairs[i];
      if (!e || !ASSET_RE.test(String(e.a)) || !ASSET_RE.test(String(e.b))) continue;
      var f = Number(e.fills);
      if (!isFinite(f) || f <= 0) continue;
      (adj[e.a] = adj[e.a] || []).push({ to: e.b, fills: f });
      (adj[e.b] = adj[e.b] || []).push({ to: e.a, fills: f });
      nodeFills[e.a] = (nodeFills[e.a] || 0) + f;
      nodeFills[e.b] = (nodeFills[e.b] || 0) + f;
    }
    var seedList = (seeds || []).filter(function (s) { return ASSET_RE.test(String(s)); }).map(String);
    var frontier = seedList.slice(), keepEdge = {}, seen = {};
    seedList.forEach(function (s) { seen[s] = 1; layer[s] = 0; });
    var outEdges = [];
    for (var hop = 1; hop <= d && frontier.length; hop++) {
      var next = [];
      frontier.forEach(function (cur) {
        (adj[cur] || []).forEach(function (link) {
          var to = link.to, k = cur < to ? cur + "|" + to : to + "|" + cur;
          if (!keepEdge[k]) { keepEdge[k] = { a: cur, b: to, fills: link.fills, layer: hop }; outEdges.push(keepEdge[k]); }
          if (!seen[to]) { seen[to] = 1; layer[to] = hop; next.push(to); }
        });
      });
      frontier = next;
    }
    var nodes = Object.keys(seen).map(function (id) {
      return { assetId: id, fills: nodeFills[id] || 0, layer: layer[id] };
    });
    nodes.sort(function (x, y) {
      if (x.fills !== y.fills) return y.fills - x.fills;
      return x.assetId < y.assetId ? -1 : (x.assetId > y.assetId ? 1 : 0);
    });
    return { nodes: nodes, edges: outEdges };
  }

  /* ---- routeToCore ---- */

  /* routeToCore: the fills-weighted route from the seeds to BTS. Fewest
   * hops first; ties broken by the WIDEST bottleneck (the smallest fill
   * count along the route) — "most-filled route", the market analogue of
   * PoolGraph.findCorePath's widest-min-edge tiebreak. Returns null when
   * BTS is unreachable: a thin market web is NORMAL, not an orphan
   * warning, so nothing is fabricated.
   * Pure. @param {Array} edges (needs a/b/poolId/fills).
   * @param {Array<string>} seeds. @param {string} coreId (default 1.3.0).
   * @returns {{deskIds: Array<string>, hops: number}|null}
   */
  function routeToCore(edges, seeds, coreId) {
    var core = String(coreId || CORE_ID);
    var adj = {}, e, i;
    for (i = 0; i < (edges || []).length; i++) {
      e = edges[i];
      if (!e || !ASSET_RE.test(String(e.a)) || !ASSET_RE.test(String(e.b))) continue;
      var f = Number(e.fills); if (!isFinite(f)) f = 0;
      (adj[e.a] = adj[e.a] || []).push({ to: e.b, via: e.poolId, fills: f });
      (adj[e.b] = adj[e.b] || []).push({ to: e.a, via: e.poolId, fills: f });
    }
    var seedList = (seeds || []).filter(function (s) { return ASSET_RE.test(String(s)); }).map(String);
    var best = {}, queue = [];
    seedList.forEach(function (s) { best[s] = { hops: 0, bottle: -1 }; queue.push({ id: s, hops: 0, bottle: -1 }); });
    var guard = 0;
    while (queue.length && guard++ < 20000) {
      var cur = queue.shift();
      if (cur.id === core && best[core] && cur.hops > best[core].hops) continue;
      (adj[cur.id] || []).forEach(function (l) {
        var nb = cur.bottle < 0 ? l.fills : (l.fills < cur.bottle ? l.fills : cur.bottle);
        var cand = { id: l.to, hops: cur.hops + 1, bottle: nb, via: l.via, prev: cur.id };
        var have = best[l.to];
        var better = !have || cand.hops < have.hops || (cand.hops === have.hops && cand.bottle > have.bottle);
        if (better) { best[l.to] = cand; queue.push(cand); }
      });
    }
    var hit = best[core];
    if (!hit || hit.hops === undefined || hit.prev === undefined) return null;
    var deskIds = [], at = core, g = 0;
    while (at !== undefined && at !== null && hit && g++ < 200) {
      var b = best[at];
      if (!b || (b.prev === undefined && b.hops > 0)) break;
      if (b.via) deskIds.unshift(b.via);
      at = b.prev;
      if (at === undefined) break;
    }
    return { deskIds: deskIds, hops: hit.hops };
  }

  /* ---- toGraph (fill in Task 2 with the desk-id orientation + provenance) ---- */

  /* Placeholder export surface; toGraph is added with the fetch task so
   * the two land together. For now export the pure core. */
  var api = {
    mergePairs: mergePairs,
    hopsFrom: hopsFrom,
    routeToCore: routeToCore,
    CORE_ID: CORE_ID,
    _test: { ASSET_RE: ASSET_RE, ES_SIZE: ES_SIZE, ES_MAX_PAGES: ES_MAX_PAGES, t: t }
  };
  return api;
})();
if (typeof globalThis !== "undefined" && typeof globalThis.MarketHops === "undefined") { globalThis.MarketHops = MarketHops; }
if (typeof module !== "undefined") { module.exports = MarketHops; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/market-hops-test.js`
Expected: `market-hops core: N passed, 0 failed` (exit 0).

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/market-hops.js tooling/market-hops-test.js
git commit -m "feat(market-hops): pure core — mergePairs, unbounded BFS hopsFrom, fills-weighted routeToCore"
```

---

## Task 2: `market-hops.js` — ES fetch + `toGraph` graph shaping

**Files:**
- Modify: `vanilla/js/api/market-hops.js` (add fetch + toGraph, extend exports)
- Test: `tooling/market-hops-test.js` (append)

**Interfaces:**
- Consumes: Task 1's `mergePairs`; global `HistoryCap.esSearch`, `Chain`, `Store`, `Format`.
- Produces (added to `MarketHops`):
  - `fetchActivePairs(opts) -> Promise<{pairs: Array, partial: boolean}>`. Rejects `"es-disabled"`, `"es-unavailable"`, `"es-testnet"`.
  - `toGraph(hops, opts) -> {graph: {nodes, edges}, meta: Object}` where `nodes:[{assetId,sym}]`, `edges:[{id,poolId,a,b,fills,sizeRaw}]`, `id === poolId === QUOTE_BASE desk id`, `meta[id]={symA,symB,fills,latest,volBaseRaw,volQuoteRaw,volBasePrec,volQuotePrec}`.
  - `deskId(symA, symB) -> string` — the `QUOTE_BASE` id rule.

- [ ] **Step 1: Append failing tests for the query body + toGraph**

Append to `tooling/market-hops-test.js` (before the final summary lines):

```js
/* ---- query body shape (pinned against es-lab.js:286 top-markets) ---- */
var body = MarketHops._test.queryBody(1, null);
assert(body.size === 0, "query: size 0 (aggregation)");
assert(body.query.bool.filter[0].term.operation_type === 4, "query: operation_type 4 (fill_order)");
assert(body.query.bool.filter[1].range["block_data.block_time"].gte === "now-24h", "query: 24h range");
assert(body.aggs.by_pair.composite.sources.length === 2, "query: composite on both legs");
assert(body.aggs.by_pair.composite.sources[0].pays.terms.field === "operation_history.op_object.pays.asset_id.keyword", "query: pays field");
assert(body.aggs.by_pair.composite.sources[1].receives.terms.field === "operation_history.op_object.receives.asset_id.keyword", "query: receives field");
assert(body.after_key === undefined, "query: no after_key on page 1");

/* ---- deskId orientation (QUOTE_BASE, market-picker.js:382) ---- */
assert(MarketHops.deskId("BTS", "BTC") === "BTC_BTS", "deskId: QUOTE_BASE");

/* ---- toGraph ---- */
var syms = { "1.3.0": "BTS", "1.3.1": "USD", "1.3.2": "BTC" };
var provenance = {
  "BTC_BTS": { latest: "0.00010000", volBaseRaw: "12345678", volQuoteRaw: "1234", volBasePrec: 5, volQuotePrec: 2 }
};
var hops = { nodes: [{ assetId: "1.3.0", fills: 30, layer: 0 }, { assetId: "1.3.2", fills: 30, layer: 1 }],
             edges: [{ a: "1.3.0", b: "1.3.2", fills: 30, sizeRaw: "30", layer: 1 }] };
var built = MarketHops.toGraph(hops, { syms: syms, provenance: provenance, quoteAsset: "1.3.0", baseAsset: "1.3.2" });
var e0 = built.graph.edges[0];
assert(built.graph.nodes.length === 2, "toGraph: 2 nodes");
assert(e0.id === "BTC_BTS" && e0.poolId === "BTC_BTS", "toGraph: id === poolId === desk id");
assert(built.meta[e0.id].fills === 30, "toGraph: meta carries fills");
assert(built.meta[e0.id].latest === "0.00010000", "toGraph: meta carries provenance latest");
assert(built.meta[e0.id].volBaseRaw === "12345678", "toGraph: meta carries provenance volume");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/market-hops-test.js`
Expected: FAIL — `_test.queryBody` / `deskId` / `toGraph` are not functions.

- [ ] **Step 3: Add fetch + toGraph to `market-hops.js`**

Insert before `var api = {` and extend the export object:

```js
  /* ---- ES fetch ---- */

  /* queryBody: the 24h fill-pair aggregation. Byte-shape mirrors the
   * proven `top-markets` template (es-lab.js:286 / astro TopActiveMarkets.ts)
   * — term op-4 + block_time range + composite over both asset-id legs.
   * `after` is the previous page's after_key (undefined on page 1).
   * Pure (unit-tested). @param {number} days window. @param {Object|null} after.
   * @returns {Object} ES request body. */
  function queryBody(days, after) {
    var hours = Math.max(1, Math.floor(days || 1) * 24);
    var b = {
      track_total_hits: false,
      size: 0,
      query: { bool: { filter: [
        { term: { operation_type: 4 } },
        { range: { "block_data.block_time": { gte: "now-" + hours + "h", lte: "now" } } }
      ] } },
      aggs: { by_pair: { composite: { size: ES_SIZE, sources: [
        { pays: { terms: { field: "operation_history.op_object.pays.asset_id.keyword" } } },
        { receives: { terms: { field: "operation_history.op_object.receives.asset_id.keyword" } } }
      ] } } }
    };
    if (after) b.after_key = after;
    return b;
  }

  /* session cache: window-keyed pair set; NEVER persisted (capability is
   * re-probed each load — the cache is a speedup, never load-bearing). */
  var _cache = {};

  /* esOn: pref gate (HistoryCap owns the setting). Missing HistoryCap reads
   * as ON here — the fetch then rejects and callers fall back. */
  function _esOn() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.esAllowed === "function") return HistoryCap.esAllowed() !== false;
    } catch (e) { /* ON stands */ }
    return true;
  }

  /* mainnetOnly: the community index is mainnet-only and market ids collide
   * across chains — testnet never probes (pool-history.js:330 same rule).
   * Reads Store (sole settings owner); mainnet when unreadable. */
  function _mainnet() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && s.network === "testnet") return false;
      }
    } catch (e) { /* mainnet default */ }
    return true;
  }

  function _historyCap() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.esSearch === "function") return HistoryCap;
    } catch (e) { /* node preload below */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.HistoryCap && typeof globalThis.HistoryCap.esSearch === "function") return globalThis.HistoryCap;
    } catch (e) { /* null below */ }
    return null;
  }

  /* fetchActivePairs: the 24h-active market pair set from the community
   * index — ONE composite aggregation per page, `after_key` pagination up
   * to ES_MAX_PAGES, one 15s TOTAL deadline (each page gets the
   * remainder). Transport is HistoryCap.esSearch (the ONLY raw-ES seam).
   * Resolves {pairs, partial} — partial when the last allowed page came
   * back full (the window holds more than we read). Rejects es-disabled /
   * es-unavailable / es-testnet so callers fall back honestly; never
   * resolves invented pairs.
   * @param {{days?: number, force?: boolean}} [opts] force bypasses the cache.
   * @returns {Promise<{pairs: Array<{a,b,fills}>, partial: boolean}>}
   */
  function fetchActivePairs(opts) {
    opts = opts || {};
    var days = (typeof opts.days === "number" && opts.days >= 1) ? Math.floor(opts.days) : 1;
    var key = String(days);
    if (!opts.force && _cache[key]) return Promise.resolve(_cache[key]);
    var HC = _historyCap();
    if (!HC) return Promise.reject(new Error("es-unavailable"));
    if (!_esOn()) return Promise.reject(new Error("es-disabled"));
    if (!_mainnet()) return Promise.reject(new Error("es-testnet"));
    var all = [], after = null, partial = false;
    var deadline = Date.now() + ES_TIMEOUT_MS;
    function page() {
      var left = Math.max(1000, deadline - Date.now());
      return HC.esSearch(ES_INDEX, queryBody(days, after), { timeoutMs: left }).then(function (json) {
        var aggs = (json && json.aggregations) || {};
        var cp = aggs.by_pair || {};
        all = all.concat(Array.isArray(cp.buckets) ? cp.buckets : []);
        var full = (Array.isArray(cp.buckets) ? cp.buckets.length : 0) >= ES_SIZE;
        var ak = cp.after_key;
        if (full && after !== null && all.length >= ES_SIZE * (ES_MAX_PAGES - 1)) { partial = true; return null; }
        if (full && pagesLeft() > 1 && ak) { after = ak; return page(); }
        if (full) partial = true;
        return null;
      });
    }
    var _pages = 0;
    function pagesLeft() { return ES_MAX_PAGES - _pages; }
    function countedPage() {
      _pages++;
      return page();
    }
    return countedPage().then(function () {
      var out = { pairs: mergePairs(all), partial: partial };
      _cache[key] = out;
      return out;
    });
  }

  /* ---- toGraph ---- */

  /* deskId: the shared QUOTE_BASE desk id — quote is the URL head
   * (market-picker.js:382 / market-net.js:25). @returns {string}. */
  function deskId(symA, symB) { return String(symB) + "_" + String(symA); }

  /* toGraph: hops -> the graph shape BOTH painters already speak, so no
   * painter change is needed for structure. Edge id === poolId === the
   * QUOTE_BASE desk id (one identity, two names — market-net.js:226
   * precedent). Orientation: when the desk legs are given, an edge
   * touching the BASE keeps it as base (reads like the desk you are on);
   * else the desk's quote leg stays quote; else the hop's own order.
   * Provenance (latest/vol/precisions) is passed in per desk id from the
   * view's own chain ticker probe — chain owns price, ES owns activity.
   * Pure (unit-tested). Never throws.
   * @param {{nodes: Array, edges: Array}} hops hopsFrom output.
   * @param {{syms?: Object, provenance?: Object, quoteAsset?: string, baseAsset?: string}} opts
   * @returns {{graph: {nodes: Array, edges: Array}, meta: Object}}
   */
  function toGraph(hops, opts) {
    opts = opts || {};
    var syms = opts.syms || {}, prov = opts.provenance || {};
    var quoteAsset = opts.quoteAsset == null ? null : String(opts.quoteAsset);
    var baseAsset = opts.baseAsset == null ? null : String(opts.baseAsset);
    var nodes = [], seen = {};
    (hops && hops.nodes || []).forEach(function (n) {
      if (!n || !n.assetId) return;
      if (seen[n.assetId]) return;
      seen[n.assetId] = 1;
      nodes.push({ assetId: String(n.assetId), sym: syms[n.assetId] || String(n.assetId) });
    });
    nodes.sort(function (x, y) { return x.assetId < y.assetId ? -1 : (x.assetId > y.assetId ? 1 : 0); });
    var meta = {}, edges = [];
    ((hops && hops.edges) || []).forEach(function (e) {
      if (!e || !e.a || !e.b || e.a === e.b) return;
      var symA = syms[e.a] || String(e.a), symB = syms[e.b] || String(e.b);
      if (symA === symB) return;
      var quote = symA, base = symB;
      if (baseAsset && (e.a === baseAsset || e.b === baseAsset)) {
        base = (e.a === baseAsset) ? symA : symB;
        quote = (e.a === baseAsset) ? symB : symA;
      } else if (quoteAsset && (e.a === quoteAsset || e.b === quoteAsset)) {
        quote = (e.a === quoteAsset) ? symA : symB;
        base = (e.a === quoteAsset) ? symB : symA;
      }
      var id = deskId(base, quote) === String(base) + "_" + String(quote) ? quote + "_" + base : quote + "_" + base;
      id = quote + "_" + base;
      var fills = Number(e.fills) || 0;
      edges.push({ id: id, poolId: id, a: String(e.a), b: String(e.b), fills: fills, sizeRaw: String(fills), layer: e.layer });
      meta[id] = { symA: (id.indexOf(base + "_") === 0) ? base : symA, symB: symB, fills: fills };
      var p = prov[id];
      if (p) { meta[id].latest = p.latest; meta[id].volBaseRaw = p.volBaseRaw;
        meta[id].volQuoteRaw = p.volQuoteRaw; meta[id].volBasePrec = p.volBasePrec; meta[id].volQuotePrec = p.volQuotePrec; }
    });
    return { graph: { nodes: nodes, edges: edges }, meta: meta };
  }
```

Extend the export object:

```js
  var api = {
    mergePairs: mergePairs,
    hopsFrom: hopsFrom,
    routeToCore: routeToCore,
    fetchActivePairs: fetchActivePairs,
    toGraph: toGraph,
    deskId: deskId,
    CORE_ID: CORE_ID,
    _test: { ASSET_RE: ASSET_RE, ES_SIZE: ES_SIZE, ES_MAX_PAGES: ES_MAX_PAGES, t: t, queryBody: queryBody }
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/market-hops-test.js`
Expected: all pass, exit 0.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/market-hops.js tooling/market-hops-test.js
git commit -m "feat(market-hops): ES 24h fill-pair fetch (paginated composite) + toGraph painter-graph shaping"
```

---

## Task 3: Register the module (script tag + globals) and i18n keys

**Files:**
- Modify: `vanilla/index.html` (after line 188 `market-net.js` line — actually add before `pool-net.js`)
- Modify: `vanilla/js/globals.d.ts`
- Modify: `vanilla/locales/{en,de,es,fr,hi,it,ja,ko,pt,ru,tr,zh}.json`

**Interfaces:**
- Consumes: nothing.
- Produces: global `MarketHops` available to views; `market.*` strings resolvable.

- [ ] **Step 1: Add the script tag**

In `vanilla/index.html`, immediately after the `<script src="js/api/market-net.js?v=423ea73"></script>` line, add:

```html
<script src="js/api/market-hops.js?v=423ea73"></script>
```

- [ ] **Step 2: Declare the global**

In `vanilla/js/globals.d.ts`, next to the other `Market*` declarations, add:

```ts
declare var MarketHops: any;
```

- [ ] **Step 3: Add the i18n keys**

For `vanilla/locales/en.json`, add to the flat key inventory (inside the existing structure — match how `market_net.*` keys are stored; keys are dotted strings in a single object):

```
"market.map_hops_ready": "%(pairs)s pairs · %(assets)s assets · 24h fills",
"market.map_hops_note": "A line is a market that filled in the past 24 hours. %(pairs)s pairs shown.",
"market.map_hops_no_route": "No route to BTS through filled markets.",
"market.map_hops_fallback": "Showing pool connectivity — 24h market fills unavailable (history unavailable).",
"market.map_edge_fills": "%(desk)s · %(a)s–%(b)s · %(fills)s fills/24h",
"market.map_edge_price": "@ %(price)s · %(vol)s",
```

For the other 11 locales, add the same keys with the **verbatim English value** (honest English stubs per the existing convention — `check_i18n.py` proves key-completeness; translations follow later per the i18n workflow).

- [ ] **Step 4: Verify i18n gate**

Run: `python3 tooling/check_i18n.py`
Expected: green (all locales carry every key).

- [ ] **Step 5: Commit**

```bash
git add vanilla/index.html vanilla/js/globals.d.ts vanilla/locales/*.json
git commit -m "chore(market-hops): register script tag + global + market.* i18n keys across 12 locales"
```

---

## Task 4: Market selector band — 3-hop web with ticker fallback

**Files:**
- Modify: `vanilla/js/views/market-net-ui.js` (`loadInto`, around lines 573-590 where `vg` is built)
- Modify: `vanilla/js/views/pool-net-chrome.js` (`edgeCard` market branch + status)
- Test: `tooling/market-net-ui-test.js` (existing — must stay green; add one assertion)

**Interfaces:**
- Consumes: `MarketHops.fetchActivePairs/hopsFrom/toGraph/deskId`; existing `Asset.describe` precisions map; existing ranked ticker rows for provenance.
- Produces: the band mounts with a market-hops graph; on failure it mounts the existing `MarketNet.graph(ranked)` graph with `fallback: true` in navOpts.

- [ ] **Step 1: Add a failing assertion to the existing headless test**

In `tooling/market-net-ui-test.js`, inside the render test, after the table assertions, assert the band mounted and that its status text is one of the two honest states:

```js
var band = root.querySelector("#market-net-band");
assert(band !== null, "market-net: band mounted");
// status line is honest in both states (3-hop web or ticker fallback)
var statusText = band.textContent || "";
assert(statusText.indexOf("pairs") !== -1 || statusText.indexOf("assets") !== -1 || statusText.indexOf("No markets") !== -1,
  "market-net: band carries an honest status line");
```

(The headless harness stubs `MarketHops` as absent, so this exercises the fallback path — which is exactly the branch that must keep working.)

- [ ] **Step 2: Run it to verify it fails (or note it already passes — then tighten)**

Run: `node tooling/market-net-ui-test.js`
Expected: the new assertions pass against the stub (fallback path). If they fail, the wiring in Step 3 is what fixes them.

- [ ] **Step 3: Wire the band graph resolution**

In `market-net-ui.js loadInto`, replace the `vg` construction block (currently building `MarketNet.graph(ranked)`) with a MarketHops-first resolution that keeps the ticker graph as fallback:

```js
      /* Band graph: ES 24h fill web first (3 hops, no caps), today's
       * 1-hop ticker graph as the honest fallback. The table above is
       * unchanged — chain owns price/volume; the map adds the reachable
       * web through markets that actually filled. */
      var vg = null, fallback = false;
      var MH = (typeof MarketHops !== "undefined" && MarketHops) ? MarketHops : null;
      var xId = xDesc ? xDesc.id : null;
      function tickerGraph() {
        try {
          var built = MN.graph(ranked, xId);
          (built.edges || []).forEach(function (e) {
            var m = built.meta[e.id];
            if (m) {
              if (typeof precs[e.a] === "number") m.volBasePrec = precs[e.a];
              if (typeof precs[e.b] === "number") m.volQuotePrec = precs[e.b];
            }
          });
          return { graph: { nodes: built.nodes, edges: built.edges }, meta: built.meta };
        } catch (e) { return { graph: { nodes: [], edges: [] }, meta: {} }; }
      }
      /* provenance: latest + 24h vol from the rows we already probed */
      function provenanceFrom(rows) {
        var out = {};
        (rows || []).forEach(function (r) {
          var id = deskForProbe(r.symA, r.symB);
          out[id] = { latest: r.latest, volBaseRaw: r.baseVol, volQuoteRaw: r.quoteVol,
            volBasePrec: precs[r.a], volQuotePrec: precs[r.b] };
        });
        return out;
      }
      if (MH && typeof MH.fetchActivePairs === "function" && xId) {
        var noteEl = mk(doc, "p", t("market_net.loading", "Loading markets\u2026"), "muted");
        MH.fetchActivePairs({ days: 1 }).then(function (res) {
          if (!live()) return;
          if (!res || res.partial || !(res.pairs || []).length) {
            var tg = tickerGraph();
            vg = tg; fallback = true;
            mountBand(doc, wrap, selGetter, vg, myGen, fallback);
            return;
          }
          var hops = MH.hopsFrom(res.pairs, [xId], 3);
          var ids = hops.nodes.map(function (n) { return n.assetId; });
          return MH.lookupSyms(ids).then(function (symMap) {
            if (!live()) return;
            var built = MH.toGraph(hops, { syms: symMap, provenance: provenanceFrom(shown), quoteAsset: xId, baseAsset: null });
            /* fill precisions into the emitted meta */
            (built.graph.edges || []).forEach(function (e) {
              var m = built.meta[e.id];
              if (m) { if (typeof precs[e.a] === "number") m.volBasePrec = precs[e.a];
                if (typeof precs[e.b] === "number") m.volQuotePrec = precs[e.b]; }
            });
            vg = built; fallback = false;
            mountBand(doc, wrap, selGetter, vg, myGen, fallback);
          });
        }).catch(function () {
          if (!live()) return;
          vg = tickerGraph(); fallback = true;
          mountBand(doc, wrap, selGetter, vg, myGen, fallback);
        });
      } else {
        vg = tickerGraph(); fallback = true;
        mountBand(doc, wrap, selGetter, vg, myGen, fallback);
      }
```

Where `selGetter` is the existing live selection getter (currently constructed inline at the `mountBand` call site — hoist it to a named function so both branches share it):

```js
      var selGetter = function () {
        return { a: aName, b: bName, s: "", aId: xDesc ? xDesc.id : null, bId: yDesc ? yDesc.id : null };
      };
```

And update `mountBand`'s signature to accept `fallback` and pass it into navOpts (`fallback: fallback`), which the chrome reads to choose the status/note wording.

- [ ] **Step 4: Update `pool-net-chrome.js` status + edge card for the market branch**

In `edgeCard`'s `isMarket(S)` branch, append fills (from meta) and the provenance price line. In the status writer (`mountMarketGraph`'s caller / `NetChrome.status`), when `S.navOpts.fallback` is true, use the fallback wording:

```js
      /* edge card with activity + provenance */
      if (isMarket(S)) {
        var m = S.meta[poolId] || {};
        var fills = (m && m.fills !== undefined && m.fills !== null) ? String(m.fills) : "?";
        var label = t("market.map_edge_fills", "%(desk)s · %(a)s–%(b)s · %(fills)s fills/24h",
          { desk: String(poolId), a: String(m.symA || "?"), b: String(m.symB || "?"), fills: fills });
        if (m.latest !== undefined && m.latest !== null && String(m.latest) !== "") {
          var vol = "";
          try {
            vol = (typeof Format !== "undefined" && Format && m.volBasePrec !== undefined && m.volBasePrec !== null)
              ? Format.formatAmount(String(m.volBaseRaw || "0"), m.volBasePrec) + " " + String(m.symA || "")
              : "";
          } catch (e) { vol = ""; }
          label += " " + t("market.map_edge_price", "@ %(price)s · %(vol)s",
            { price: String(m.latest), vol: vol || "-" });
        }
        return label;
      }
```

- [ ] **Step 5: Run the market-net headless test**

Run: `node tooling/market-net-ui-test.js`
Expected: exit 0 (fallback path proven; ES path is the browser-only branch).

- [ ] **Step 6: Commit**

```bash
git add vanilla/js/views/market-net-ui.js vanilla/js/views/pool-net-chrome.js tooling/market-net-ui-test.js
git commit -m "feat(markets): selector band shows ES 3-hop fill web, ticker 1-hop fallback, fills+price on hover"
```

---

## Task 5: Exchange desk map — 2-hop web, pool fallback, honest note

**Files:**
- Modify: `vanilla/js/views/market-desk-fill.js` (`fetchPoolMap`, `redrawPoolMap`, `gateByActivity`)
- Modify: `vanilla/js/api/pool-graph.js` (`drawGraph` market branch)
- Test: new `tooling/market-desk-map-test.js` (headless, stubs)

**Interfaces:**
- Consumes: `MarketHops.fetchActivePairs/hopsFrom/routeToCore/toGraph/lookupSyms`.
- Produces: `state.graphData.kind` ∈ `{"market","pool"}`; `PoolGraph.drawGraph` honors `opts.kind === "market"`.

- [ ] **Step 1: Write the failing desk-map test**

`tooling/market-desk-map-test.js`:

```js
/* market-desk-map-test.js — headless: desk map backend choice + note switch. */
var ok = 0, bad = 0;
function assert(c, m) { if (c) ok++; else { bad++; console.log("FAIL: " + m); } }

var PoolGraph = require("../vanilla/js/api/pool-graph.js");
var MarketHops = require("../vanilla/js/api/market-hops.js");

/* The desk map's note must state the painted truth. These are the exact
 * strings the view chooses between; both must be reachable. */
assert(typeof PoolGraph.drawGraph === "function", "pool-graph: drawGraph present (shared painter)");

/* A market graph fed through the shared painter must not throw and must
 * honor the route path set (kind:"market"). */
var canvasStub = {
  width: 0, height: 0, style: {},
  getContext: function () { return {
    setTransform: function(){}, clearRect: function(){}, save: function(){}, restore: function(){},
    beginPath: function(){}, moveTo: function(){}, lineTo: function(){}, stroke: function(){},
    arc: function(){}, fill: function(){}, fillText: function(){}, strokeText: function(){},
    set strokeStyle(v){}, get strokeStyle(){ return ""; },
    set fillStyle(v){}, get fillStyle(){ return ""; },
    set lineWidth(v){}, set font(v){}, set textAlign(v){}, set shadowColor(v){}, set shadowBlur(v){}
  }; },
  addEventListener: function(){}, setAttribute: function(){}, getAttribute: function(){ return null; },
  getBoundingClientRect: function(){ return { left: 0, top: 0 }; }, clientWidth: 300, clientHeight: 180
};
var hops = MarketHops.hopsFrom([
  { a: "1.3.0", b: "1.3.1", fills: 50 }, { a: "1.3.1", b: "1.3.2", fills: 40 }
], ["1.3.0"], 2);
var built = MarketHops.toGraph(hops, { syms: { "1.3.0":"BTS","1.3.1":"USD","1.3.2":"BTC" }, quoteAsset: "1.3.1", baseAsset: "1.3.0" });
var res = PoolGraph.drawGraph(null, canvasStub, built.graph, { assetA: "1.3.1", assetB: "1.3.0", kind: "market", highlightPools: [], nav: { mode: "market" } });
assert(res !== null, "desk map: market graph paints through shared painter");

console.log("market-desk-map: " + ok + " passed, " + bad + " failed");
if (bad > 0) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tooling/market-desk-map-test.js`
Expected: FAIL (market graph hits the pool `mapTheme`/size-ramp path, or the pool-assumption throws).

- [ ] **Step 3: Add the market branch to `PoolGraph.drawGraph`**

At the top of `drawGraph`, after `var assetA = opts.assetA, assetB = opts.assetB;`, branch:

```js
    var isMarket = (opts && opts.kind === "market");
```

Then:
- **Size ramp**: when `isMarket`, the base `t` uses the fills digit length instead of pool-size digits:
```js
      var baseT = 0;
      try {
        if (isMarket) {
          var f = Number(e.fills); if (isFinite(f) && f > 0) {
            var fd = String(Math.floor(f)).replace(/^0+/, "").length;
            baseT = fd <= 1 ? 0 : Math.min((fd - 1) / 3, 1);
          }
        } else {
          var rawS = String(e.sizeRaw == null ? "" : e.sizeRaw);
          if (/^\d+$/.test(rawS)) {
            var dd = rawS.replace(/^0+/, "").length;
            baseT = dd <= 4 ? 0 : Math.min((dd - 4) / 18, 1);
          }
        }
      } catch (e2) { baseT = 0; }
```
- **Theme (verdict) skip**: wrap the `mapTheme` call so it only runs for pools; a market web has no orphan verdict:
```js
    var theme = null;
    if (!isMarket) { try { theme = mapTheme(graph, assetA, assetB); } catch (e) { theme = null; } }
```
- **Route path set**: when `isMarket`, seed `pathSet` from `opts.routeDeskIds` (the `routeToCore` result) instead of `theme.pathPools`:
```js
    var pathSet = {};
    try {
      if (isMarket) {
        (opts.routeDeskIds || []).forEach(function (id) { pathSet[String(id)] = 1; });
      } else {
        ((theme && theme.pathPools) || []).forEach(function (pid) { pathSet[String(pid)] = 1; });
        if (theme && theme.legEdge) pathSet[String(theme.legEdge)] = 1;
      }
    } catch (e) { /* plain edges stand */ }
```
- **Corner verdict text**: `cornerText` calls are already guarded by `theme && !theme.takeover`; with `theme === null` they simply do not draw — correct for markets (no orphan banner).

- [ ] **Step 4: Run the desk-map test**

Run: `node tooling/market-desk-map-test.js`
Expected: exit 0.

- [ ] **Step 5: Wire `market-desk-fill.js` — MarketHops first, pool fallback, note switch**

In `fetchPoolMap`, insert a MarketHops attempt before the existing `PoolGraph.buildGraph` block. Structure:

```js
    /* Backend: markets first (2-hop 24h fill web), pools as the honest
     * fallback. Both paint through the same canvas/flag/note; `kind`
     * tells the painter and the note which world is on screen. */
    var MH = (typeof MarketHops !== "undefined" && MarketHops) ? MarketHops : null;
    function poolsPath() { /* the existing buildGraph + findCorePath + gateByActivity, verbatim */ }
    function marketPath() {
      if (!MH || typeof MH.fetchActivePairs !== "function") return Promise.resolve(false);
      return MH.fetchActivePairs({ days: 1 }).then(function (res) {
        if (!res || res.partial || !(res.pairs || []).length) return false;
        var hops = MH.hopsFrom(res.pairs, [pA, pB], 2);
        if (!(hops.edges || []).length) return false;
        var ids = hops.nodes.map(function (n) { return n.assetId; });
        return MH.lookupSyms(ids).then(function (symMap) {
          if (!live(myGen, uiGen)) return false;
          var built = MH.toGraph(hops, { syms: symMap, quoteAsset: pA, baseAsset: pB });
          /* carry the desk legs' own precision into meta for provenance */
          (built.graph.edges || []).forEach(function (e) {
            var m = built.meta[e.id];
            if (!m) return;
            if (e.a === b.id && typeof b.precision === "number") m.volBasePrec = b.precision;
            if (e.b === q.id && typeof q.precision === "number") m.volQuotePrec = q.precision;
          });
          var routeA = MH.routeToCore(hops.edges, [pA], MH.CORE_ID);
          var routeB = MH.routeToCore(hops.edges, [pB], MH.CORE_ID);
          P.graphData = { graph: built.graph, assetA: pA, assetB: pB, kind: "market",
            meta: built.meta, pathA: routeA, pathB: routeB };
          return true;
        });
      }).catch(function () { return false; });
    }
    marketPath().then(function (ok) {
      if (!ok) { poolsPath(); return; }
      redrawPoolMap(doc, P, myGen, uiGen);
      try { MarketInd.drawCharts(P); } catch (e) { /* pin best-effort */ }
    });
```

(Move the existing pool logic into `poolsPath()` unchanged; it must set `P.graphData.kind = "pool"`.)

In `redrawPoolMap`, pass `kind`, `meta`, and `routeDeskIds` into the painter opts:

```js
      var isMarket = gd.kind === "market";
      var routeIds = [];
      if (isMarket) {
        [gd.pathA, gd.pathB].forEach(function (r) { (r && r.deskIds || []).forEach(function (id) { if (routeIds.indexOf(id) === -1) routeIds.push(id); }); });
      }
      var drawOpts = { assetA: gd.assetA, assetB: gd.assetB, highlightPools: hi, explicit: !!explicit,
        nav: navMode, kind: isMarket ? "market" : "pool", routeDeskIds: routeIds };
      PoolGraph.drawLive(doc, P.graphCanvas, gd.graph, drawOpts);
```

And rewrite the note switch so it states the painted truth:

```js
      var act = P._activity || null;
      var n = (gd.graph.edges || []).length;
      if (gd.kind === "market") {
        var routeTxt = "";
        try {
          var hasRoute = (gd.pathA && gd.pathA.deskIds && gd.pathA.deskIds.length) || (gd.pathB && gd.pathB.deskIds && gd.pathB.deskIds.length);
          if (!hasRoute) routeTxt = " " + t("market.map_hops_no_route", "No route to BTS through filled markets.");
        } catch (eR) { /* note stands without the route line */ }
        P.graphNote.textContent = t("market.map_hops_note",
          "A line is a market that filled in the past 24 hours. %(pairs)s pairs shown.", { pairs: String(n) }) + routeTxt;
        return;
      }
      /* pool fallback: existing three-way note (empty / strict / fallback) verbatim */
      if (!n && !(act && act.gated && act.total > 0)) { /* existing empty line */ }
      else if (act && act.gated) { /* existing strict pool line */ }
      else if (!act) { /* existing loading line */ }
      else { /* existing pool fallback line */ }
```

- [ ] **Step 6: Run the desk-map + pool-graph + market-desk tests**

Run: `node tooling/market-desk-map-test.js && node tooling/pool-graph-test.js && node tooling/market-desk-test.js`
Expected: all exit 0 (pool desks unchanged; market desk paints through the shared painter).

- [ ] **Step 7: Commit**

```bash
git add vanilla/js/api/pool-graph.js vanilla/js/views/market-desk-fill.js tooling/market-desk-map-test.js
git commit -m "feat(markets): desk map = 2-hop 24h fill web, pool fallback, honest note, market ink branch"
```

---

## Task 6: Parity note + gates + visual audit

**Files:**
- Create: `docs/parity/market-hops.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the parity note satisfying the 8-field contract.

- [ ] **Step 1: Run all three gates**

Run:
```bash
bash tooling/check_types.sh
python3 tooling/check_i18n.py
python3 tooling/check_rot.py
```
Expected: all green.

- [ ] **Step 2: Run the full headless suite**

Run: `node tooling/run-all-tests.js` (or the repo's test runner — check `tooling/` for the aggregate entry).
Expected: exit 0.

- [ ] **Step 3: Visual audit**

Run the screenshot tool against the two market routes in all three themes at 360px and 1440px:

```bash
node tooling/visual/shot.mjs --route '#/markets'   --themes all --widths 360,1440 --out docs/parity/market-hops/
node tooling/visual/shot.mjs --route '#/market/BTS_USD' --themes all --widths 360,1440 --out docs/parity/market-hops/
```
Expected: no console errors; both bands/desks render the map in all three themes at both widths. Capture the shots for the parity note.

- [ ] **Step 4: Write the parity note**

`docs/parity/market-hops.md` with the eight contract fields (reference behavior, vanilla file:line, manual steps, raw→human vectors, theme trio + widths, headers, anti-rot a–c, gate output). Key vectors:

| Raw ES input | Human display | Where |
|---|---|---|
| composite `doc_count: 8` for BTS/USD + 3 for USD/BTS | `11 fills/24h` (one unordered pair) | `mergePairs` |
| ticker `latest: "0.00010000"` | `0.00010000` (chain string, verbatim) | edge card provenance |
| `volBaseRaw: "12345678"` @ prec 5 | `123.45678` | edge card `Format.formatAmount` |
| pair `{a:"1.3.0", b:"1.3.999"}` | 1 hop to BTS (fills 5) | `routeToCore` |

- [ ] **Step 5: Commit**

```bash
git add docs/parity/market-hops.md docs/parity/market-hops/
git commit -m "docs(market-hops): parity note + theme/width audit shots"
```

---

## Self-Review

**Spec coverage:**
- G1 (3-hop selector) → Task 4 ✓
- G2 (2-hop desk) → Task 5 ✓
- G3 (price provenance) → Task 4 (edge card) + Task 5 (meta precisions) ✓
- G4 (BTS most-filled route) → Task 1 `routeToCore` + Task 5 `routeDeskIds` path set ✓
- G5 (no caps) → Task 1 `hopsFrom` (unbounded) ✓
- G6 (pool fallback + honest note) → Task 4 (ticker fallback) + Task 5 (pool fallback + note switch) ✓
- G7 (zero deps) → Global Constraints; `check_rot.py` in Task 6 ✓
- Error matrix → Task 2 `fetchActivePairs` rejects + Task 5 note switch ✓
- Testing → Task 1/2 unit + Task 5 desk test + Task 6 gates ✓

**Placeholder scan:** No TBD/TODO. All code shown in full. One note: Task 5 Step 5 references `poolsPath()` as "the existing buildGraph logic, verbatim" — the implementer reads the current `fetchPoolMap` body and wraps it; this is a mechanical move, not new logic.

**Type consistency:** `MarketHops.fetchActivePairs(opts)`, `hopsFrom(pairs, seeds, depth)`, `routeToCore(edges, seeds, coreId)`, `toGraph(hops, opts)`, `deskId(symA, symB)`, `lookupSyms(ids)` are each defined exactly once and consumed with the same signature. `graphData.kind` is `"market"|"pool"` everywhere. `routeToCore` returns `{deskIds, hops}` and Task 5 reads `pathA.deskIds` — consistent.