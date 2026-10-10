# Account Network Two-Hop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add depth 1-or-2 selection plus adjustable Ring 1/Ring 2 neighbor counts to `#/account-network`, with bounded top-N depth-2 expansion, overlaid canvas pills, honest depth reporting, and full gates.

**Architecture:** A new pure depth planner owns normalization, ranking, and expansion selection; the existing ES transport gains a depth-aware second ring while keeping ring-0 behavior byte-identical by default; copy owns depth/hash/status/table words; a new depth widget owns the selector plus overlaid pills; the canvas engine is reused unchanged.

**Tech Stack:** Vanilla JS + Canvas2D + existing PoolNet engine, WebSocket chain client, `HistoryCap.esSearch`, `localStorage`, Playwright dev-only probes; no runtime dependencies.

## Global Constraints

- `vanilla/` has no `package.json`, no `node_modules`, no CDN `<script src>`, no framework — `python3 tooling/check_rot.py` must pass.
- Platform APIs only; no graph library, no bundler. `python3 -m http.server` serves the app.
- Data-only page: no operation is built, signed, or broadcast here.
- Money stays a raw digit string / BigInt until `Format` renders it; `Number()` is only ever canvas pixels, counts or ranking weights. **Never sum amounts across assets.**
- Every display string goes through `I18n.t(key, englishDefault)` with the default byte-identical to `en.json` — `python3 tooling/check_i18n.py` enforces both directions.
- New raw-ES access goes through `HistoryCap.esSearch` only; the index is mainnet-only, pref-gated by `esEnabled`, page size is `ES_SIZE = 1000`, hard ceiling `ES_SIZE_CEILING = 10000`.
- Existing scan/display budgets stay: `SCAN_CAP = 5000`, `SCAN_MAX_PAGES = 6`, `SCAN_TIMEOUT_MS = 30000`, `NODE_CAP = 40`, `EDGE_CAP = 400`, `MAX_SEEDS = 12`.
- New depth budgets are fixed: `MAX_DEPTH = 2`, `DEFAULT_DEPTH = 1`, `DEFAULT_RING1 = 40`, `MAX_RING1 = 40`, `DEFAULT_RING2 = 8`, `MAX_RING2 = 8`, `EXPANSION_SCAN_CAP = 2000`, `EXPANSION_SCAN_MAX_PAGES = 2`.
- Every op extractor validates its expected field names per hit and counts mismatches — the index's `operation_type` numbering disagrees with `Tx.OP` for 10/11/22/23/39, so op numbers are never trusted alone.
- Shared utilities are mandatory, never re-created: `DOM.*`, `Forms.*`, `TableRenderer.render`, `ConfirmDialog`, `Overlay`, `Event.delegate`, `DOM.touchable`.
- Types: JSDoc `@param`/`@returns` on every touched seam; cross-file shapes as `@typedef` in the owning module; parenthesized `/** @type {X} */ (expr)` seam-casts on cross-part calls; new globals declared in `vanilla/js/globals.d.ts` alphabetical, dev-only, never a `<script>` tag.
- i18n from day one: every visible string is `t(key, englishDefault)`; the English literal must be byte-identical in code and in all 12 `vanilla/locales/*.json` plus the `en.json` `_meta.translated` inventory; `%(name)s` placeholders stay verbatim.
- UX floor: `DOM.pageHead` for the single `h1`; `aria-label` on the seed input and depth/ring inputs; `th scope="col"` in the twin; theme tokens only, no hardcoded hex; >=44px targets; every listener/interval registered in `_cleanups` and focus returned on teardown.
- No dead selectors: run `python3 tooling/scan_dead_css.py` after touching `app.css`.
- `bash tooling/check_types.sh` must pass.
- Phone 360px to 4K; `prefers-reduced-motion` settles with zero frames.
- Module format: block header, IIFE, `globalThis` guard + `module.exports` tail, script tag with the shared cache-bust token.
- TDD: failing test first, minimal implementation, passing tests, then commit per task.

---

## File structure

- Create `vanilla/js/api/account-net-depth.js`: pure depth normalization, Ring 1/Ring 2 ranking, expansion planning, expansion scan budget constants.
- Modify `vanilla/js/api/account-net-es.js`: depth-aware `gather()` second ring, global cross-ring operation dedupe for expansions, ring/depth annotation, depth stats.
- Modify `vanilla/js/views/account-network-copy.js`: depth prefs storage, depth/hash helpers, depth-aware status/detail/twin words, new i18n keys.
- Create `vanilla/js/views/account-network-depth-ui.js`: depth selector plus overlaid Ring 1/Ring 2 pills, validation, disabled states, stale signaling.
- Modify `vanilla/js/views/account-network-ui.js`: mount the depth widget, wire state/hash/draw/stale behavior, annotate legend/table behavior without changing the canvas engine.
- Modify `vanilla/css/app.css`: append `.an-depth*` overlay/fallback rules using theme tokens only.
- Modify `tooling/add_account_net_i18n.py`, regenerate `vanilla/locales/*.json`.
- Modify `vanilla/index.html`, `vanilla/js/globals.d.ts`.
- Modify `tooling/account-net-test.js`, `tooling/account-network-ui-test.js`.
- Modify `tooling/visual/viewport-audit.mjs`: add idle depth-2 route.
- Modify `docs/parity/account-network.md`.

---

### Task 1: Pure depth planner

**Files:**
- Create: `vanilla/js/api/account-net-depth.js`
- Modify: `tooling/account-net-test.js`
- Modify: `vanilla/js/globals.d.ts`
- Test: `node tooling/account-net-test.js`

**Interfaces:**
- Consumes: nothing.
- Produces for Tasks 2–4:
  - `AccountNetDepth.MAX_DEPTH: 2`
  - `AccountNetDepth.DEFAULT_DEPTH: 1`
  - `AccountNetDepth.DEFAULT_RING1: 40`
  - `AccountNetDepth.MAX_RING1: 40`
  - `AccountNetDepth.DEFAULT_RING2: 8`
  - `AccountNetDepth.MAX_RING2: 8`
  - `AccountNetDepth.EXPANSION_SCAN_CAP: 2000`
  - `AccountNetDepth.EXPANSION_SCAN_MAX_PAGES: 2`
  - `AccountNetDepth.normalizeDepth(v): number`
  - `AccountNetDepth.normalizeRing1(v): number`
  - `AccountNetDepth.normalizeRing2(v): number`
  - `AccountNetDepth.expansionCount(depth, ring2): number`
  - `AccountNetDepth.topCounterparties(counts, seedIds, limit): string[]`
  - `AccountNetDepth.planExpansions(counts, seedIds, scannedIds, maxExpansions): string[]`

- [ ] **Step 1: Write the failing test**

Append to `tooling/account-net-test.js`, after the pure Task 1 vectors and before the Task 3 ES section:

```js
const AccountNetDepth = require("/workspace/vanilla/js/api/account-net-depth.js");

/* ================= Two-hop depth planner ================= */
eq(AccountNetDepth.normalizeDepth("2"), 2, "depth accepts 2");
eq(AccountNetDepth.normalizeDepth("7"), 1, "depth above 2 normalizes to 1");
eq(AccountNetDepth.normalizeDepth(0), 1, "depth below 1 normalizes to 1");
eq(AccountNetDepth.normalizeRing1("999"), 40, "ring 1 clamps to 40");
eq(AccountNetDepth.normalizeRing2("0"), 1, "ring 2 clamps up to 1");
eq(AccountNetDepth.expansionCount(2, 8), 8, "depth 2 allows 8 expansions");
eq(AccountNetDepth.expansionCount(1, 8), 0, "depth 1 expands nothing");
eq(AccountNetDepth.topCounterparties({ "1.2.2": 5, "1.2.3": 9, "1.2.4": 9 }, { "1.2.1": 1 }, 2),
  ["1.2.3", "1.2.4"], "top counterparties rank by ops, ties break by id");
eq(AccountNetDepth.planExpansions({ "1.2.2": 5, "1.2.1": 9 }, { "1.2.1": 1 }, {}, 2),
  ["1.2.2"], "seeds are never expansion targets");
eq(AccountNetDepth.planExpansions({ "1.2.2": 5 }, { "1.2.1": 1 }, { "1.2.2": 1 }, 2),
  [], "already-scanned accounts are not expanded again");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/account-net-test.js`
Expected: FAIL with `Cannot find module '/workspace/vanilla/js/api/account-net-depth.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `vanilla/js/api/account-net-depth.js` with exactly this behavior:

```js
/* AccountNetDepth: pure two-hop depth policy for the account network.
 * Owns: depth normalization, Ring 1/Ring 2 count policy, top-N expansion
 * ranking, and the fixed per-expansion scan budget. No DOM, no storage, no
 * chain, no ES. Callers keep raw-ES work in account-net-es.js and words in
 * account-network-copy.js.
 * Consumes: nothing. Global AccountNetDepth.
 */
var AccountNetDepth = (function () {
  "use strict";

  var MAX_DEPTH = 2;
  var DEFAULT_DEPTH = 1;
  var DEFAULT_RING1 = 40;
  var MAX_RING1 = 40;
  var DEFAULT_RING2 = 8;
  var MAX_RING2 = 8;
  var EXPANSION_SCAN_CAP = 2000;
  var EXPANSION_SCAN_MAX_PAGES = 2;

  /**
   * clampInt: finite integer clamp with default fallback.
   * @param {*} v Raw value. @param {number} dflt Default. @param {number} min Minimum. @param {number} max Maximum.
   * @returns {number} Clamped integer.
   */
  function clampInt(v, dflt, min, max) {
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return dflt;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  /**
   * isAccountId: strict 1.2.x reader.
   * @param {*} v Raw value. @returns {boolean} True for a canonical account id.
   */
  function isAccountId(v) {
    return /^1\.2\.\d+$/.test(String(v === undefined || v === null ? "" : v));
  }

  /**
   * normalizeDepth: only 1 or 2 exist. Anything else resets to the default —
   * a clamp would silently promote an invalid depth to 2, the expensive mode.
   * @param {*} v Raw depth. @returns {number} 1 or 2.
   */
  function normalizeDepth(v) {
    var n = Math.floor(Number(v));
    if (n !== 1 && n !== 2) return DEFAULT_DEPTH;
    return n;
  }

  /**
   * normalizeRing1: retained depth-1 counterparties.
   * @param {*} v Raw count. @returns {number} 1..40.
   */
  function normalizeRing1(v) {
    return clampInt(v, DEFAULT_RING1, 1, MAX_RING1);
  }

  /**
   * normalizeRing2: depth-2 expansions.
   * @param {*} v Raw count. @returns {number} 1..8.
   */
  function normalizeRing2(v) {
    return clampInt(v, DEFAULT_RING2, 1, MAX_RING2);
  }

  /**
   * expansionCount: expansions actually performed for a depth setting.
   * @param {*} depth Raw depth. @param {*} ring2 Raw ring-2 count.
   * @returns {number} 0 at depth 1, otherwise 1..8.
   */
  function expansionCount(depth, ring2) {
    if (normalizeDepth(depth) < 2) return 0;
    return normalizeRing2(ring2);
  }

  /**
   * topCounterparties: rank eligible non-seed accounts by indexed-operation count.
   * @param {Object<string,number>} counts Account id -> indexed operations.
   * @param {Object<string,number>} seedIds Seed ids to exclude.
   * @param {number} limit Maximum ids to return.
   * @returns {string[]} Ranked account ids, deterministic by count then id.
   */
  function topCounterparties(counts, seedIds, limit) {
    var ids = Object.keys(counts || {}).filter(function (id) {
      return isAccountId(id) && !(seedIds && seedIds[id]);
    });
    ids.sort(function (a, b) {
      var ca = Number(counts[a]) || 0, cb = Number(counts[b]) || 0;
      if (cb !== ca) return cb - ca;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return ids.slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
  }

  /**
   * planExpansions: choose depth-2 scan targets.
   * @param {Object<string,number>} counts Indexed operations per account.
   * @param {Object<string,number>} seedIds Seed ids.
   * @param {Object<string,number>} scannedIds Already-scanned ids.
   * @param {number} maxExpansions Maximum expansions.
   * @returns {string[]} Ranked expansion targets.
   */
  function planExpansions(counts, seedIds, scannedIds, maxExpansions) {
    var ids = topCounterparties(counts, seedIds, Object.keys(counts || {}).length);
    return ids.filter(function (id) { return !(scannedIds && scannedIds[id]); })
      .slice(0, Math.max(0, Math.floor(Number(maxExpansions) || 0)));
  }

  return {
    MAX_DEPTH: MAX_DEPTH, DEFAULT_DEPTH: DEFAULT_DEPTH,
    DEFAULT_RING1: DEFAULT_RING1, MAX_RING1: MAX_RING1,
    DEFAULT_RING2: DEFAULT_RING2, MAX_RING2: MAX_RING2,
    EXPANSION_SCAN_CAP: EXPANSION_SCAN_CAP,
    EXPANSION_SCAN_MAX_PAGES: EXPANSION_SCAN_MAX_PAGES,
    normalizeDepth: normalizeDepth, normalizeRing1: normalizeRing1,
    normalizeRing2: normalizeRing2, expansionCount: expansionCount,
    topCounterparties: topCounterparties, planExpansions: planExpansions
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNetDepth === "undefined") { globalThis.AccountNetDepth = AccountNetDepth; }
if (typeof module !== "undefined") { module.exports = AccountNetDepth; }
```

Add to `vanilla/js/globals.d.ts`, alphabetical near the other account-network entries:

```ts
declare var AccountNetDepth: any;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/account-net-test.js`
Expected: `account-net: 95 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/account-net-depth.js tooling/account-net-test.js vanilla/js/globals.d.ts
git commit -m "feat(account-network): add pure two-hop depth planner"
```

---

### Task 2: Depth-aware gather

**Files:**
- Modify: `vanilla/js/api/account-net-es.js`
- Modify: `tooling/account-net-test.js`
- Test: `node tooling/account-net-test.js`

**Interfaces:**
- Consumes: `AccountNet` core classify/dedupe/buildGraph/scan caps; `AccountNetDepth` policy.
- Produces for Tasks 3–5: `gather()` accepts `{depth, ring1, ring2}` and returns `graph.stats` with `{depth, ring1, ring2, expanded, unexpanded, expansionScanned, expansionTruncated}`; every output node carries `ring` 0/1/2; every output edge carries `depth` 1/2.

- [ ] **Step 1: Write the failing test**

Append an async depth-gather block using unique fixtures and a party-routed fetch stub. The stub answers ring-0 seed `1.2.1` with two counterparties and answers the top expansion `1.2.2` with one depth-2 counterparty:

```js
// 25. depth 2 expands the top-ranked depth-1 counterparty only
{
  const seenBodies = [];
  const prevFetch = globalThis.fetch;
  const prevAccount = globalThis.Account;
  globalThis.Account = { resolve: (n) => Promise.resolve({ id: "1.2.1", name: "alice" }) };
  globalThis.fetch = function (url, opts) {
    const body = JSON.parse(String(opts.body));
    seenBodies.push(body);
    const party = JSON.stringify(body.query);
    function hit(from, to, seq) {
      return { sort: [1790000000000 + seq], _source: { operation_type: 0,
        account_history: { account: from, operation_id: 9000 + seq },
        block_data: { block_num: 80000 + seq, block_time: "2026-09-01T10:00:00" },
        operation_history: { op_object: { from: from, to: to,
          amount_: { amount: "1000000", asset_id: "1.3.0" }, fee: { amount: 0, asset_id: "1.3.0" } } } } };
    }
    let hits = [];
    if (party.indexOf('"1.2.1"') !== -1) hits = [hit("1.2.1", "1.2.2", 1), hit("1.2.1", "1.2.2", 2), hit("1.2.1", "1.2.3", 3)];
    else if (party.indexOf('"1.2.2"') !== -1) hits = [hit("1.2.2", "1.2.4", 4)];
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: hits } }) });
  };
  const out = await AccountNet.gather(["alice"], ["transfer"], { depth: 2, ring1: 40, ring2: 1 });
  globalThis.fetch = prevFetch;
  globalThis.Account = prevAccount;
  eq(out.graph.stats.depth, 2, "depth-2 gather reports depth 2");
  eq(out.graph.stats.expanded.join(","), "1.2.2", "only the top-ranked counterparty expands");
  eq(out.graph.stats.unexpanded, 1, "the unexpanded counterparty is counted");
  eq(out.graph.edges.length, 3, "ring-0 and ring-1 edges merge");
  eq(out.graph.nodes.length, 4, "seed plus three counterparties are present");
  ok(out.graph.edges.some((e) => e.depth === 2), "a depth-2 edge is labeled");
  ok(out.graph.nodes.some((n) => n.assetId === "1.2.4" && n.ring === 2), "the depth-2 account is ring 2");
  eq(seenBodies.length, 2, "one ring-0 scan plus one expansion scan ran");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/account-net-test.js`
Expected: FAIL on `depth-2 gather reports depth 2`, got `undefined`.

- [ ] **Step 3: Write minimal implementation**

Restructure `gather()` in `vanilla/js/api/account-net-es.js` without changing the ring-0 path for depth 1:

1. Resolve `depth`, `ring1`, `ring2` through `AccountNetDepth` with guarded fallbacks to `1`, `40`, `8`.
2. Keep the existing sequential ring-0 seed loop, but collect raw classified edges into `ring0Edges` and `ring0Keys` for every deduped hit.
3. Count indexed operations per non-seed endpoint from `ring0Edges`.
4. Retain the top `ring1` counterparties with `AccountNetDepth.topCounterparties`; filter ring-0 edges to seeds plus retained accounts.
5. At depth 2, choose expansions with `AccountNetDepth.planExpansions`; scan each expansion id sequentially with `{ cap: AccountNetDepth.EXPANSION_SCAN_CAP, maxPages: AccountNetDepth.EXPANSION_SCAN_MAX_PAGES, timeoutMs: opts.timeoutMs }`.
6. Skip expansion hits already present in `ring0Keys`; track expansion-only dedupe keys separately so ring-0 results stay exactly as before.
7. Record `scanDepth` 1 for ring-0 edges and 2 for expansion edges; map each aggregated edge key to its first discovery depth.
8. Run the existing credit join once over the merged edge list.
9. Call the existing `A.buildGraph()` once, then annotate output nodes with `ring` and output edges with `depth`.
10. Extend stats with depth/ring/expansion fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/account-net-test.js`
Expected: `account-net: 106 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/account-net-es.js tooling/account-net-test.js
git commit -m "feat(account-network): gather an optional bounded second hop"
```

---

### Task 3: Depth words, hash, status, twin, locales

**Files:**
- Modify: `vanilla/js/views/account-network-copy.js`
- Modify: `vanilla/js/views/account-network-ui.js` for `_test` passthrough accessors only
- Modify: `tooling/account-network-ui-test.js`
- Modify: `tooling/add_account_net_i18n.py`
- Modify: `vanilla/locales/*.json` via the script
- Test: `node tooling/account-network-ui-test.js`, `python3 tooling/check_i18n.py`

**Interfaces:**
- Consumes: `AccountNetDepth` policy, existing copy builders, `AccountNet` caps.
- Produces for Task 4: `parseDepth()`, `hashForDepth()`, `readDepthPrefs()`, `writeDepthPrefs()`, `depthLabel()`, depth-aware `statusText()`, depth-aware `twinRows()`/`twinColumns()`.

- [ ] **Step 1: Write the failing test**

Append depth/hash/status/twin vectors to `tooling/account-network-ui-test.js`:

```js
/* ---- depth prefs + hash ---- */
{
  const d = T.parseDepth("#/account-network?seeds=a&depth=2&ring1=12&ring2=3");
  eq(d, { depth: 2, ring1: 12, ring2: 3 }, "depth hash parses depth + rings");
  eq(T.parseDepth("#/account-network?depth=9"), { depth: 1, ring1: 40, ring2: 8 }, "bad depth normalizes");
  const h = T.hashForDepth(["a"], ["transfer"], 2, 12, 3);
  ok(h.indexOf("depth=2") !== -1 && h.indexOf("ring1=12") !== -1 && h.indexOf("ring2=3") !== -1, "depth hash round-trips (" + h + ")");
  eq(T.depthLabel(2), "2 hops", "depth label is plural");
  eq(T.depthLabel(1), "1 hop", "depth label is singular");
}

/* ---- depth status + twin ---- */
{
  const s = T.statusText({ seeds: [{ id: "1.2.1", name: "alice" }], unknown: [],
    stats: { scanned: 10, edges: 3, nodes: 4, truncated: false, droppedSelf: 0,
      droppedShape: 0, missingCredit: 0, caps: {}, depth: 2, ring1: 40, ring2: 1,
      expanded: ["1.2.2"], unexpanded: 1, expansionScanned: 4, expansionTruncated: false } });
  ok(/2 hops/.test(s), "depth-2 status names the depth (" + s + ")");
  ok(/1\.2\.2/.test(s) && /unexpanded/.test(s), "expanded and unexpanded accounts are disclosed");
  const rows = T.twinRows({ nodes: [{ assetId: "1.2.1", sym: "alice" }, { assetId: "1.2.2", sym: "bob" }],
    edges: [{ a: "1.2.1", b: "1.2.2", poolId: "k1", cls: "transfer", kind: "flow", count: 2,
      perAsset: {}, firstSeen: null, lastSeen: null, depth: 2 }] }, {}, {});
  eq(rows[0].depth, "2 hops", "twin rows carry hop depth");
  eq(T.twinColumns().map((c) => c.key).join(","), "from,to,cls,kind,amount,count,span,depth", "twin adds a depth column");
}
```

Expose the new accessors through `AccountNetworkUI._test` and `AccountNetworkCopy` returns.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/account-network-ui-test.js`
Expected: FAIL with `T.parseDepth is not a function`.

- [ ] **Step 3: Write minimal implementation**

1. Add storage key `accountNet.depth.v1` holding `{depth, ring1, ring2}` JSON.
2. Add guarded `AccountNetDepth` access with literal fallbacks.
3. Add `parseDepth()` returning exactly `{depth, ring1, ring2}` in that key order, plus `hashForDepth()`, `readDepthPrefs()`, `writeDepthPrefs()`, `depthLabel()`, and `ringLabel()`.
4. Extend `statusText()` with depth label, expanded ids, unexpanded count, expansion scan count/truncation. The unexpanded wording must contain the word `unexpanded`.
5. Add `depth` to twin rows and columns.
6. Add these exact English strings both at the call sites and in `tooling/add_account_net_i18n.py`:

```python
NEW_DEPTH_KEYS = {
    "account_net.depth_label": "Depth",
    "account_net.depth_1": "1 hop",
    "account_net.depth_2": "2 hops",
    "account_net.ring1_label": "Ring 1",
    "account_net.ring2_label": "Ring 2",
    "account_net.stale_settings": "Depth or neighbor settings changed — press Draw network.",
    "account_net.status_depth": "%(depth)s map",
    "account_net.status_expanded": "expanded: %(names)s",
    "account_net.status_unexpanded": "%(n)s direct counterparties unexpanded",
    "account_net.status_expansion_scanned": "%(n)s indexed operations from expansions",
    "account_net.status_expansion_truncated": "expansion scans truncated to newest operations",
    "account_net.twin_depth": "Hop",
}
```

Then run:

```bash
python3 tooling/add_account_net_i18n.py
python3 tooling/check_i18n.py
```

Expected i18n output: `OK: 12 dicts key-complete`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/account-network-ui-test.js`
Expected: `account-network-ui: 74 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/account-network-copy.js vanilla/js/views/account-network-ui.js tooling/account-network-ui-test.js tooling/add_account_net_i18n.py vanilla/locales/*.json
git commit -m "feat(account-network): depth-aware words, hash, status, and twin"
```

---

### Task 4: Depth selector and overlaid ring pills

**Files:**
- Create: `vanilla/js/views/account-network-depth-ui.js`
- Modify: `vanilla/js/views/account-network-ui.js`
- Modify: `vanilla/css/app.css`
- Modify: `tooling/account-network-ui-test.js`
- Test: `node tooling/account-network-ui-test.js`, `bash tooling/check_types.sh`, manual browser probe

**Interfaces:**
- Consumes: `AccountNetDepth` normalization, copy prefs/hash helpers, `DOM.*`, `touchable`.
- Produces: mounted depth selector plus `Ring 1`/`Ring 2` pills; `get()`/`set()` state; `onChange()` stale signaling; overlay placement with normal-flow fallback.

- [ ] **Step 1: Write the failing test**

Append one pure widget-sanitizer vector to `tooling/account-network-ui-test.js`:

```js
const DepthUI = require("/workspace/vanilla/js/views/account-network-depth-ui.js");

/* ---- depth widget sanitizer ---- */
eq(DepthUI.sanitize({ depth: "2", ring1: "999", ring2: "0" }),
  { depth: 2, ring1: 40, ring2: 1 }, "widget sanitizes depth inputs through the depth policy");
```

The widget module must expose `sanitize()` without touching `document` at load time, so Node can require it. Layout stays with the browser probe.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/account-network-ui-test.js`
Expected: FAIL with `Cannot find module '/workspace/vanilla/js/views/account-network-depth-ui.js'`.

- [ ] **Step 3: Write minimal implementation**

1. Expose pure `sanitize()` using `AccountNetDepth` normalization.
2. Create the depth selector in the controls row: two `aria-pressed` buttons, `1 hop` default.
3. Create one `.an-depth` overlay container with labeled `Ring 1` and `Ring 2` numeric inputs.
4. Append the container to `.pool-net-stage` when present; otherwise append `.an-depth-fallback` in normal flow under the graph.
5. Re-mount or move the same pill nodes after every canvas mount because `PoolNetUI.mount` clears its host.
6. Disable `Ring 2` at depth 1; revert invalid values; persist prefs; sync depth/ring hash; mark the map stale without auto-scanning.
7. Make the overlay container pointer-transparent except for its controls so canvas gestures still work.
8. Append theme-token-only CSS for `.an-depth`, `.an-depth-fallback`, labels, numeric inputs, and disabled states.
9. Run `python3 tooling/scan_dead_css.py` and verify no new dead account-network selector is introduced.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
node tooling/account-network-ui-test.js
bash tooling/check_types.sh
```

Expected: `account-network-ui: 75 pass, 0 fail`, `check_types: PASS`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/account-network-depth-ui.js vanilla/js/views/account-network-ui.js vanilla/css/app.css tooling/account-network-ui-test.js
git commit -m "feat(account-network): depth selector and overlaid ring pills"
```

---

### Task 5: Wiring, visual audit, parity note, gates, commit

**Files:**
- Modify: `vanilla/index.html`
- Modify: `vanilla/js/globals.d.ts`
- Modify: `tooling/visual/viewport-audit.mjs`
- Modify: `docs/parity/account-network.md`
- Test: full gates plus browser/visual checks

**Interfaces:**
- Consumes: all Tasks 1–4 deliverables.
- Produces: shippable wired feature plus recorded proof.

- [ ] **Step 1: Wire script order and types**

Insert after the account-network transport script, preserving dependency order:

```html
<script src="js/api/account-net-depth.js?v=b519fbf"></script>
```

Insert after the account-network copy script:

```html
<script src="js/views/account-network-depth-ui.js?v=b519fbf"></script>
```

Add alphabetical dev-only declarations:

```ts
declare var AccountNetDepth: any;
declare var AccountNetworkDepthUI: any;
```

- [ ] **Step 2: Add idle depth route to the viewport sweep**

```js
{ src: "/account-network-depth", hash: "#/account-network?depth=2&ring1=40&ring2=8", group: "static" },
```

- [ ] **Step 3: Run unit gates**

Run:

```bash
node tooling/account-net-test.js
node tooling/account-net-paint-test.js
node tooling/account-network-ui-test.js
node tooling/menu-test.js
bash tooling/check_types.sh
python3 tooling/check_i18n.py
python3 tooling/check_rot.py
python3 tooling/audit_view_mounts.py
```

Expected: `106/15/75/28` passes respectively, all static checks green.

- [ ] **Step 4: Run navigation and viewport checks**

Start the static server, run both checks, then stop the server:

```bash
python3 -m http.server 8081 --directory vanilla >/tmp/opencode/account-network-http.log 2>&1 &
HTTP_PID=$!
PLAYWRIGHT_BROWSERS_PATH=.browsers node tooling/visual/probe-nav-mount.mjs
node tooling/visual/viewport-audit.mjs --port 8081 --routes "#/account-network,#/account-network-depth"
kill $HTTP_PID
```

Expected: nav-mount PASS; both account-network routes PASS at phone and desk widths; zero console errors.

Targeted viewport runs regenerate standing audit artifacts, so keep only the route-table code change:

```bash
git status --short
git checkout -- docs/parity/viewport-audit-2.json
git checkout -- docs/parity/viewport-shots/
rm -f docs/parity/viewport-shots/account-network-depth-*.png
git status --short
```

- [ ] **Step 5: Perform the live visual audit**

Draw `#/account-network?seeds=committee-account&classes=transfer,credit&depth=2&ring1=40&ring2=8` on mainnet and record:
- one `.wrap`, correct `Account Network` heading, `connected.svg` icon;
- depth selector state, enabled Ring 1/Ring 2 pills, fallback placement if the stage is absent;
- honest status naming expanded/unexpanded accounts and truncations;
- live canvas plus accessible depth-labeled table;
- three themes, 360px and desktop widths, zero console errors.

- [ ] **Step 6: Update the parity note and commit**

Update `docs/parity/account-network.md` with the depth design, budgets, proof, and gate totals, then stage only the intended files and verify the tree:

```bash
git add vanilla/index.html vanilla/js/globals.d.ts tooling/visual/viewport-audit.mjs docs/parity/account-network.md
git status --short
git diff --check
git commit -m "feat(account-network): wire and prove optional two-hop expansion"
```

## Self-Review

- Spec coverage: depth selection, Ring 1/Ring 2 defaults and ranges, ranking, expansion budget, global dedupe, ring/depth labels, hash/storage, overlay pills, fallback, stale behavior, honesty copy, twin depth, i18n, types, CSS, viewport/live proof, parity note.
- No placeholders: every task names exact files, interfaces, commands, and expected outputs.
- Type consistency: `AccountNetDepth` owns policy; transport owns scans; copy owns words; depth widget owns controls; view owns page lifecycle; engine remains unchanged.
