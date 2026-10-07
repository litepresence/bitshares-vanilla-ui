# Desk Volume Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the `#/markets` band map from ranked ticker rows (recent volume gate) instead of pool rows, keeping the canvas style byte-identical.

**Architecture:** Pure `MarketNet.graph(rows)` builder (TDD vectors) feeds an injected-graph seam in `PoolNetUI.mount` opts; paint generalizes edge width to volume digit strings; chrome gains market hover cards; `mountBand` wires rows→graph. No new chain calls, no new files except tests/scripts.

**Tech Stack:** ES5 vanilla JS, classic script tags, Canvas2D (existing), Node 20 test harness (fake-doc where needed), Python stdlib i18n scripts.

## Global Constraints

- Zero runtime dependencies (anti-rot §4.5 gate: `python3 tooling/check_rot.py` green).
- Money: raw digit strings until `Format` at render; BigInt compare, never `Number()`/floats on volumes.
- Every user string via `t(key, enDefault)`, `market_net.*` namespace, all 12 `vanilla/locales/*.json` + `en.json` inventory (`python3 tooling/check_i18n.py` green).
- `bash tooling/check_types.sh` green (JSDoc on seams, `globals.d.ts` untouched — no new globals).
- Touch targets ≥44px (existing chrome already floors), `aria-live` status, `prefers-reduced-motion` path untouched.
- No `TODO|FIXME`, no dead code (dead pool-only helpers on this path get deleted with their tests).

---

### Task 1: `MarketNet.graph(rows)` + vectors

**Files:**
- Modify: `vanilla/js/api/market-net.js` (append `graph` + export; header line 1-29 gains one bullet)
- Test: `tooling/market-net-test.js` (append vector blocks)

**Interfaces:**
- Consumes: probeOne row shape `{a, b, symA, symB, baseVol, quoteVol, latest, change}` (strings; `latest`/`change` nullable).
- Produces: `MarketNet.graph(rows)` → `{nodes: [{assetId, sym}], edges: [{id, a, b}], meta: {deskId: {symA, symB, volBaseRaw, volBasePrec, volQuoteRaw, volQuotePrec, latest, change}}}`. Pure, input untouched, never throws (bad rows skipped).

- [ ] **Step 1: Write the failing test** — append to `tooling/market-net-test.js`:
```js
// 8. Graph: volume-gated edges, desk-id edge ids, orientation dedupe.
(function () {
  const rows = [
    { a: "1.3.0", b: "1.3.1", symA: "BTS", symB: "USD", baseVol: "5000", quoteVol: "250", latest: "0.05", change: "1.2" },
    { a: "1.3.1", b: "1.3.0", symA: "USD", symB: "BTS", baseVol: "999999", quoteVol: "1", latest: "20.0", change: "0.1" },
    { a: "1.3.0", b: "1.3.2", symA: "BTS", symB: "BTC", baseVol: "0", latest: null, change: null },
    { a: "1.3.0", b: "1.3.3", symA: "BTS", symB: "BAD", baseVol: "not-a-number", latest: null, change: null }
  ];
  const g = MN.graph(rows, "1.3.0");
  ok(g.edges.length === 1, "only the nonzero-volume pair survives");
  ok(g.edges[0].id === "USD_BTS", "focus-base orientation wins (QUOTE_BASE desk id)");
  ok(g.nodes.length === 2, "nodes are the kept edge's assets");
  ok(g.meta["USD_BTS"].volBaseRaw === "5000", "meta carries raw volume + labels");
  ok(rows.length === 4, "input untouched");
  const g2 = MN.graph([rows[1], rows[0], rows[2], rows[3]], "1.3.0");
  ok(g2.edges.length === 1 && g2.edges[0].id === "USD_BTS", "focus-base wins regardless of input order");
})();
```
- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/market-net-test.js`
Expected: FAIL log `only the nonzero-volume pair survives` (TypeError: MN.graph is not a function)

- [ ] **Step 3: Write minimal implementation** — append to `vanilla/js/api/market-net.js` before the return block, export as `graph: graph`:
```js
  function graph(rows, focusId) {
    var nodes = [], edges = [], meta = {}, seenN = {}, seenP = {};
    function liveVol(v) {
      try { return typeof v === "string" && /^\d+$/.test(v) && /[1-9]/.test(v); }
      catch (e) { return false; }
    }
    function isFocusBase(r) {
      return typeof focusId === "string" && focusId && String(r.a) === String(focusId);
    }
    var kept = {};
    (rows || []).forEach(function (r) {
      if (!r || !liveVol(r.baseVol)) return;
      var a = String(r.a), b = String(r.b);
      if (!a || !b || a === b) return;
      if (!r.symA || !r.symB || r.symA === r.symB) return;
      var key = a < b ? a + "|" + b : b + "|" + a;
      /* Orientation: focus-base wins by page convention (never by
       * cross-unit size); otherwise first-seen wins. Deterministic. */
      if (kept[key] && !(isFocusBase(r) && !isFocusBase(kept[key].r))) return;
      kept[key] = { r: r, a: a, b: b };
    });
    Object.keys(kept).forEach(function (key) {
      var k = kept[key], r = k.r, a = k.a, b = k.b;
      if (!seenN[a]) { seenN[a] = 1; nodes.push({ assetId: a, sym: String(r.symA) }); }
      if (!seenN[b]) { seenN[b] = 1; nodes.push({ assetId: b, sym: String(r.symB) }); }
      var id = String(r.symB) + "_" + String(r.symA);
      seenP[id] = 1;
      edges.push({ id: id, a: a, b: b });
      meta[id] = { symA: String(r.symA), symB: String(r.symB), volBaseRaw: String(r.baseVol),
        volBasePrec: null, volQuoteRaw: String(r.quoteVol || "0"), volQuotePrec: null,
        latest: (r.latest === null || r.latest === undefined) ? null : String(r.latest),
        change: (r.change === null || r.change === undefined) ? null : String(r.change) };
    });
    return { nodes: nodes, edges: edges, meta: meta };
  }
Note: `volBasePrec`/`volQuotePrec` ship null here — Task 4 fills them from
the caller's `precs` map before mounting (spec §2 shape).
- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/market-net-test.js`
Expected: all green including the new block (fix orientation/precisions per failures — vectors are truth).

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/market-net.js tooling/market-net-test.js
git commit -m "feat(market-net): volume-gated graph builder with vectors"
```

### Task 2: `PoolNetUI.mount` injected-graph seam + market chrome

**Files:**
- Modify: `vanilla/js/views/pool-net-ui.js:124-172,340-430` (opts.graph/meta/mode branch; skip skeleton+liveBackfill; market status text; hide brand row + path in market mode)
- Modify: `vanilla/js/views/pool-net-chrome.js:68-86` (mode branch in nodeCard/edgeCard)
- Test: `tooling/pool-net-ui-test.js` (mount with injected graph: no fetch issued, status shows markets count)

**Interfaces:**
- Consumes: `opts = {navEdge?, navNode?, mode?: "market", graph?: {nodes, edges}, meta?: {...}}` (all optional; absent = pool behavior byte-identical).
- Produces: same `{redraw, destroy}` api; `S.full`/`S.meta` from injection; `S.navOpts.mode` readable by chrome.

- [ ] **Step 1: Write the failing test** — append block asserting `PoolNetUI.mount` with `{mode: "market", graph: {nodes: [{assetId: "1.3.0", sym: "BTS"}], edges: []}, meta: {}}` issues zero `fetch` calls and writes a `market_net.map_empty`-ish status (assert exact text after implementation; status writer seam follows existing pool-net-ui-test patterns).
- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/pool-net-ui-test.js`
Expected: FAIL (fetch issued / pool status text)

- [ ] **Step 3: Write minimal implementation** — in `mount()`, after `S` init: `if (navOpts && navOpts.graph) { S.full = navOpts.graph; S.meta = navOpts.meta || {}; S.loaded = true; applySelection(); setStatus(market text); return wired api without skeletonFirst()/liveBackfill(); }`. Chrome: `if (S.navOpts && S.navOpts.mode === "market")` branches in `nodeCard` (symbol + edge count, no hops fiction) and `edgeCard` (volume human via Format + latest/change + desk id); brand-row builder early-returns in market mode; `findPath` call sites guarded by mode.
- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/pool-net-ui-test.js && node tooling/pool-net-test.js`
Expected: green, no regressions.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/pool-net-ui.js vanilla/js/views/pool-net-chrome.js tooling/pool-net-ui-test.js
git commit -m "feat(pool-net): injected-graph market mode (style untouched)"
```

### Task 3: Paint volume widths

**Files:**
- Modify: `vanilla/js/views/pool-net-paint.js:89-101` (`_edgeWidth`)
- Test: extend paint vectors (existing pool-net test file covering `_edgeWidth` — assert `volBaseRaw` digits size identically to balance digits; absent → 1.0 thin)

**Interfaces:**
- Consumes: `meta[id].volBaseRaw` digit string (new, optional).
- Produces: same pixel widths; zero caller changes (`_edgeWidth(meta, id)` signature kept).

- [ ] **Step 1: Write the failing test** — `meta = {X: {volBaseRaw: "5000000"}}` asserts width > 1.0 and equals the width for equivalent balance digits.
- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/pool-net-test.js` (or whichever file hosts paint vectors — check imports first)
Expected: FAIL (thin 1.0)

- [ ] **Step 3: Write minimal implementation** — in `_edgeWidth`, after the balance branch: `var v = m && m.volBaseRaw; if (digit string) return 0.8 + Math.min(stripped length / 14, 1.6);` (same formula, same comment updated).
- [ ] **Step 4: Run test to verify it passes**

Run: same suite
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/pool-net-paint.js <paint test file>
git commit -m "feat(pool-net-paint): edge width from volume digits"
```

### Task 4: `mountBand` wiring + dead-code removal

**Files:**
- Modify: `vanilla/js/views/market-net-ui.js:404-491,604-614` (build `MN.graph(ranked, xDesc.id)`, fill precisions into meta from the existing `precs` map, pass `{navEdge: direct, mode: "market", graph, meta}`; delete `deskByPool`/`poolDeskMap`/`deskIdForEdge` + `_deskIdForEdgeForTest` export after verifying zero other callers)
- Test: `tooling/market-net-ui-test.js` (band graph built from fixture rows; navEdge returns `#/market/<id>`; pool helpers gone)

**Interfaces:**
- Consumes: `ranked` rows + `precs` map (both already in scope at lines 585-596); `PoolNetUI.mount` market mode (Task 2).
- Produces: band shows volume edges; `poolRows` fetch stays (discovery still uses it — comment says so).

- [ ] **Step 1: Write the failing test** — fixture rows → `mountBand`-adjacent pure path (graph build + navEdge mapping) asserts desk hrefs; assert `typeof MarketNetUI._deskIdForEdgeForTest === "undefined"`.
- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/market-net-ui-test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation** — replace `poolDeskMap`/`deskByPool` plumbing with `var vg = MN.graph(ranked, xDesc.id); fillMetaPrecs(vg.meta, precs); PUI.mount(doc, body, getSelection, { mode: "market", graph: {nodes: vg.nodes, edges: vg.edges}, meta: vg.meta, navEdge: function (hit) { var id = hit && (hit.id || hit.poolId) ? String(hit.id || hit.poolId) : ""; return id ? "#/market/" + id : null; } });` delete `poolDeskMap`, `deskIdForEdge`, export line 836, and their test blocks.
- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/market-net-ui-test.js && node tooling/market-net-test.js`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/market-net-ui.js tooling/market-net-ui-test.js
git commit -m "feat(markets): band draws volume-gated market graph"
```

### Task 5: i18n + gates + parity note

**Files:**
- Create: `tooling/add_desk_volume_map_i18n.py` (new `market_net.map_ready/map_empty/card` keys × 12 dicts, sorted inventory, idempotent — follow `add_*_i18n.py` precedent)
- Create: `docs/parity/desk-volume-map.md` (8-field contract: ref behavior N/A-new-capability + astro/pool-map idea credit; file:lines; manual steps; no amount vectors — Format paths pre-covered, cite; theme trio + phone/desktop queued for human; anti-rot a–c; gate evidence)
- Modify: `vanilla/locales/*.json` (via script)

**Interfaces:**
- Consumes: exact English defaults from the code written in Tasks 2–4.
- Produces: `check_i18n.py` green; committed note.

- [ ] **Step 1: Write the script** (copy `tooling/add_pool_net_switch_i18n.py` shape, new KEYS map).
- [ ] **Step 2: Run gates**

Run: `python3 tooling/add_desk_volume_map_i18n.py && python3 tooling/check_i18n.py && python3 tooling/check_rot.py && bash tooling/check_types.sh && node --check <every touched file>`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add tooling/add_desk_volume_map_i18n.py vanilla/locales/ docs/parity/desk-volume-map.md
git commit -m "chore(volume-map): i18n keys + parity note, gates green"
```
