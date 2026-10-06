# Discrete timescale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discrete timescale radio to the exchange and pool-detail price plots that renders raw per-fill dots plus an auto volume-stems pane on dependency-free canvas, with all bucket-derived plots closed and the Indicators menu greyed out.

**Architecture:** Discrete is a `state.discrete` mode flag (never a bucket size). Pure point-mapping functions live next to their price helpers (`MarketFills.fillsToPoints`, `PoolHistory.swapsToPoints`); a new small renderer (`DiscreteCharts`) paints dots + stems on canvas; the shared timeframe/menu/draw code branches on the flag.

**Tech Stack:** Vanilla JS + canvas 2D only (no new dependency, no LWC calls in Discrete mode). Node stdlib-only test scripts in `tooling/`.

## Global Constraints

- `vanilla/` stays dependency-free and static-servable: no `package.json`, no `node_modules`, no CDN `<script>`, no framework, no build step to run (`python3 -m http.server` serves a working app).
- All money math goes through `vanilla/js/api/format.js` (BigInt): never `amount / Math.pow(10, precision)`, never `parseFloat` on money. `Number()` is allowed only on already-human strings for pixel coordinates.
- Every user-visible string resolves via `t(key, enDefault)` with entries in ALL 12 `vanilla/locales/*.json` files; non-English dicts carry honest English stubs; `python3 tooling/check_i18n.py` stays green.
- No local `el/clearRoot/showStatus/confirmList/fieldRow/touchable` copies: use globals `DOM`, `Forms`, `ConfirmDialog`, `Overlay`, `TableRenderer`, `Event`.
- JSDoc `@param`/`@returns` on every new function; cross-file globals declared in `vanilla/js/globals.d.ts`; `bash tooling/check_types.sh` stays green; `python3 tooling/check_rot.py` stays green.
- Touch targets ≥44px in ≥1 dimension (radios via existing `touchable`); theme tokens only (no hardcoded hex outside `themes.css`); `prefers-reduced-motion` respected (canvas painters animate nothing).
- Never edit anything under `/workspace/reference/` (read-only). New code lives in `/workspace/vanilla/`; new tests in `/workspace/tooling/`.

---

## File map

| File | Responsibility in this plan |
|---|---|
| `vanilla/js/views/market-desk-query.js` | `readDeskQuery` accepts `tf=discrete`; `buildDeskQuery` writes it and suppresses over/osc/vwap/depth/pmap while active |
| `vanilla/js/views/market-ind-panes.js` | `bucketLabel("discrete")`, Discrete radio in `paintTimeframes`, fills/swaps count note, `renderIndMenu` disabled state, `maybeDraw`/`drawCharts` Discrete branch |
| `vanilla/js/api/market-fills-history.js` | NEW pure `fillsToPoints(fills, baseId, precB, precQ, quoteId, cap)` (newest-first in, oldest-first out, same-second fills stay separate) |
| `vanilla/js/api/pool-history.js` | NEW pure `swapsToPoints(swaps, assetB, precB, cap)` (same ordering contract) |
| `vanilla/js/api/discrete-charts.js` | NEW renderer: `drawDiscretePrice` (dots) + `drawDiscreteVolume` (stems), DPR-aware, theme tokens, honest empties |
| `vanilla/index.html` | ONE `<script src="js/api/discrete-charts.js">` tag after `market-charts.js` |
| `vanilla/js/globals.d.ts` | Declare `DiscreteCharts` global (dev-only typing) |
| `vanilla/js/views/market-desk-fill.js` | Exchange `fill(state)` Discrete branch: fetch fills, skip candles/deepen/VWAP/depth/poolmap |
| `vanilla/js/views/market-desk.js` | Seed `state.discrete`, retain numeric bucket, Discrete live-tip re-fetch |
| `vanilla/js/views/pool-detail-view.js` | `rebucket()` Discrete branch from swap tape |
| `vanilla/locales/*.json` (12) | 7 new keys, English stubs outside en |
| `tooling/discrete-timescale-test.js` | NEW stdlib-only unit suite (query round-trip, labels, point mapping, cap, skips) |
| `docs/parity/discrete-timescale.md` | Parity note (contract §7 below) |

No NEW chain surface (plan constraint from `building-vanilla-slices` step 3): exchange fills reuse `get_fill_order_history` via existing `MarketFills.chainFills`/`fillsForMarket` (`bitshares-core/.../api.hpp:212`, already mapped in `market-fills-history.js` header); pool swaps reuse the already-loaded tape (`PoolHistory.swaps`/`enrich`, already mapped). No `mapping-chain-calls` invocation needed: zero new WS methods, zero new op fields.

---

### Task 1: Query round-trip + Discrete label (pure plumbing)

**Files:**
- Modify: `vanilla/js/views/market-desk-query.js`
- Modify: `vanilla/js/views/market-ind-panes.js` (`bucketLabel` only)
- Test: `tooling/discrete-timescale-test.js` (create, Task 1 vectors only; later tasks append their vectors to the same file)

**Interfaces:**
- Consumes: existing `readDeskQuery(raw, indApi)`, `buildDeskQuery(state)`, `bucketLabel(b)`.
- Produces: `readDeskQuery` returns `seed.discrete` bool (default `false`); `buildDeskQuery` honors `state.discrete`; `bucketLabel("discrete") === "Discrete"`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing test (query + label vectors)**

Create `tooling/discrete-timescale-test.js` with exactly this content (stdlib only, exit 0 = green):

```js
#!/usr/bin/env node
/* discrete-timescale-test.js — unit vectors for the Discrete timescale mode.
 * Stdlib only: `node tooling/discrete-timescale-test.js` (exit 0 = green).
 * No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var MarketDeskQ = require("../vanilla/js/views/market-desk-query.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

var IND = {
  OVERLAY_DEFS: [["sma", null], ["ema", null]],
  OSC_ORDER: [["volume", "Volume"], ["rsi", "RSI"]]
};

/* tf=discrete seeds the mode flag and keeps a sane numeric bucket. */
var d = MarketDeskQ._query.readDeskQuery({ tf: "discrete" }, IND);
eq(d.discrete, true, "tf=discrete sets the flag");
eq(d.bucket, 3600, "tf=discrete keeps the default numeric bucket");

/* Plain queries stay non-discrete (backward compatible). */
d = MarketDeskQ._query.readDeskQuery(null, IND);
eq(d.discrete, false, "null query is not discrete");
d = MarketDeskQ._query.readDeskQuery({ tf: "900" }, IND);
eq(d.discrete, false, "numeric tf is not discrete");
eq(d.bucket, 900, "numeric tf still parses");

/* Build: discrete writes tf=discrete and suppresses indicator/plot params. */
var q = MarketDeskQ._query.buildDeskQuery({ bucket: 3600, discrete: true, over: { sma: [{}] }, osc: { rsi: true }, logScale: true, showVwap: true, showDepth: true, showPoolMap: false });
eq(q.indexOf("tf=discrete") !== -1, true, "discrete serializes tf=discrete");
eq(q.indexOf("over="), -1, "discrete suppresses over");
eq(q.indexOf("osc="), -1, "discrete suppresses osc");
eq(q.indexOf("vwap="), -1, "discrete suppresses vwap");
eq(q.indexOf("depth="), -1, "discrete suppresses depth");
eq(q.indexOf("pmap="), -1, "discrete suppresses pmap");
eq(q.indexOf("log=1") !== -1, true, "discrete keeps log");

/* Build: non-discrete output is byte-identical to before (no tf when default). */
q = MarketDeskQ._query.buildDeskQuery({ bucket: 3600, over: {}, osc: {}, logScale: false, showVwap: false, showDepth: false, showPoolMap: true });
eq(q, "", "default desk still serializes empty");

console.log("discrete-timescale task-1 vectors: " + passed + " passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/discrete-timescale-test.js`
Expected: FAIL with `d.discrete` undefined (or `Cannot read properties`), because `readDeskQuery` sets no `discrete` field yet.

- [ ] **Step 3: Write minimal implementation (query only)**

In `vanilla/js/views/market-desk-query.js`, make exactly these edits:

Edit A — seed default gains the flag (in `readDeskQuery`, the seed literal):

```js
    var seed = {
      bucket: 3600, discrete: false, over: {}, osc: {},
      logScale: false, showVwap: false, showDepth: false, showPoolMap: true,
      depthLogX: true, depthLogY: true, tradesTab: "recent", groupDec: null
    };
```

Edit B — right after the `tf` parse lines (`var tf = parseInt(q.tf, 10); ...`), insert:

```js
      if (typeof q.tf === "string" && q.tf.trim().toLowerCase() === "discrete") seed.discrete = true;
```

Edit C — at the top of `buildDeskQuery`'s try block, before the bucket line, insert:

```js
      var isDiscrete = !!(s && s.discrete);
      if (isDiscrete) parts.push("tf=discrete");
```

Edit D — guard the four suppressed params. Change:

```js
      if (Number.isInteger(s.bucket) && s.bucket > 0 && s.bucket !== 3600) parts.push("tf=" + s.bucket);
```

to:

```js
      if (!isDiscrete && Number.isInteger(s.bucket) && s.bucket > 0 && s.bucket !== 3600) parts.push("tf=" + s.bucket);
```

and change each of the `over`/`osc`/`vwap`/`depth`/`pmap` push lines to skip when `isDiscrete`. Concretely, wrap the five statements:

```js
      var ol = Object.keys(s.over || {}).filter(function (k) {
        return KEY_RE.test(k) && s.over[k] && s.over[k].length;
      });
      if (ol.length) parts.push("over=" + ol.join(","));
```

into:

```js
      if (!isDiscrete) {
        var ol = Object.keys(s.over || {}).filter(function (k) {
          return KEY_RE.test(k) && s.over[k] && s.over[k].length;
        });
        if (ol.length) parts.push("over=" + ol.join(","));
        var sl = Object.keys(s.osc || {}).filter(function (k) {
          return KEY_RE.test(k) && !!s.osc[k];
        });
        if (sl.length) parts.push("osc=" + sl.join(","));
        if (s.showVwap) parts.push("vwap=1");
        if (s.showDepth) parts.push("depth=1");
        if (s.showPoolMap === false) parts.push("pmap=0");
      }
```

(`log`, `dx`, `dy`, `trades`, `group` lines stay outside the guard, unchanged.)

Edit E — `bucketLabel` in `vanilla/js/views/market-ind-panes.js`. Change:

```js
  function bucketLabel(b) {
    var known = { 60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h", 86400: "1D", 604800: "1W" };
```

to:

```js
  function bucketLabel(b) {
    if (b === "discrete") return "Discrete";
    var known = { 60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h", 86400: "1D", 604800: "1W" };
```

Append the label vector to the test file (before the final `console.log`):

```js
/* bucketLabel: discrete short label (needs the panes registry; skip when absent). */
try {
  var MarketInd = require("../vanilla/js/views/market-ind.js");
  var api = MarketInd._panes || MarketInd;
  if (api && api._test && typeof api._test.bucketLabel === "function") {
    eq(api._test.bucketLabel("discrete"), "Discrete", "discrete label");
    eq(api._test.bucketLabel(3600), "1h", "numeric labels unchanged");
  }
} catch (e) { /* registry without _test: label covered manually */ }
```

For that vector to run, expose the helper. At the end of the `market-ind-panes.js` IIFE return block (where `MarketInd._panes.paintTimeframes = paintTimeframes;` etc. are assigned), add:

```js
  MarketInd._panes._test = { bucketLabel: bucketLabel, reconcileBuckets: reconcileBuckets };
```

(Check the exact assignment block in the file first: it lists `maybeDraw`, `paintTimeframes`, ...; append the `_test` line after `CANDLE_COUNT`. If `reconcileBuckets` is not in scope under that exact name, expose only `bucketLabel`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/discrete-timescale-test.js`
Expected: PASS with `discrete-timescale task-1 vectors: N passed` (N >= 12).

Also run the existing deep-link suite to prove byte-identical non-discrete behavior:

Run: `node tooling/market-deeplink-test.js`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/market-desk-query.js vanilla/js/views/market-ind-panes.js tooling/discrete-timescale-test.js
git commit -m "feat(discrete): tf=discrete query round-trip + Discrete label"
```

---

### Task 2: `MarketFills.fillsToPoints` (exchange point mapping, pure)

**Files:**
- Modify: `vanilla/js/api/market-fills-history.js` (add function + export; no other line changes)
- Test: append vectors to `tooling/discrete-timescale-test.js`

**Interfaces:**
- Consumes: `priceHuman(fill, baseId, precB, precQ, quoteId, places)`, `_sigPlaces`, `PRICE_PLACES`, `SIGFIG_MAX`, `_isIntStr`, `Format.formatAmount` (stubbed in tests).
- Produces: `MarketFills.fillsToPoints(fills, baseId, precB, precQ, quoteId, cap)` returning oldest-first `[{timeMs, price, volume, volumeBaseRaw, volumeQuoteRaw}]`. Task 4 consumes it.

- [ ] **Step 1: Write the failing test (append before the final console.log)**

```js
/* fillsToPoints: newest-first fills in, oldest-first points out. */
(function () {
  var MarketFills = require("../vanilla/js/api/market-fills-history.js");
  var G = (typeof globalThis !== "undefined") ? globalThis : global;
  var savedFormat = G.Format;
  /* Deterministic Format stub: price names its legs, volume echoes raw. */
  G.Format = {
    formatPrice: function (bRaw, bP, qRaw, qP, pl) { return "P(" + bRaw + "/" + qRaw + ":" + bP + "," + qP + "," + pl + ")"; },
    formatAmount: function (raw, prec) { return "A(" + raw + ":" + prec + ")"; }
  };
  try {
    var fills = [
      { time: "2026-10-05T02:00:00", paid: { amount: "300", asset: "1.3.0" }, received: { amount: "30", asset: "1.3.1" } },
      { time: "2026-10-05T01:00:00", paid: { amount: "100", asset: "1.3.0" }, received: { amount: "10", asset: "1.3.1" } },
      { time: "2026-10-05T01:00:00", paid: { amount: "200", asset: "1.3.0" }, received: { amount: "25", asset: "1.3.1" } },
      { time: "bogus", paid: { amount: "1", asset: "1.3.0" }, received: { amount: "1", asset: "1.3.1" } },
      { time: "2026-10-05T03:00:00", paid: { amount: "5", asset: "1.3.999" }, received: { amount: "5", asset: "1.3.1" } }
    ];
    /* baseId 1.3.0, precB 5, precQ 4, quoteId 1.3.1, cap 10. */
    var pts = MarketFills.fillsToPoints(fills, "1.3.0", 5, 4, "1.3.1", 10);
    eq(pts.length, 3, "two bad rows skipped, three points kept");
    eq(pts[0].timeMs < pts[1].timeMs, true, "oldest first");
    eq(pts[1].timeMs === pts[2].timeMs, false, "distinct slots ordered");
    eq(pts[0].volumeBaseRaw, "100", "base-leg raw kept");
    eq(pts[0].volume, "A(100:5)", "base-leg human volume");
    /* Same-second fills stay SEPARATE points (the point of Discrete). */
    var same = [
      { time: "2026-10-05T01:00:00", paid: { amount: "100", asset: "1.3.0" }, received: { amount: "10", asset: "1.3.1" } },
      { time: "2026-10-05T01:00:00.500", paid: { amount: "200", asset: "1.3.0" }, received: { amount: "25", asset: "1.3.1" } }
    ];
    var pts2 = MarketFills.fillsToPoints(same, "1.3.0", 5, 4, "1.3.1", 10);
    eq(pts2.length, 2, "same-second fills are two points, never merged");
    /* Cap slices newest-first BEFORE oldest-first paint order. */
    var pts3 = MarketFills.fillsToPoints(fills.slice(0, 3), "1.3.0", 5, 4, "1.3.1", 2);
    eq(pts3.length, 2, "cap slices to newest 2");
    eq(pts3[1].volumeBaseRaw, "300", "newest fill survives the cap");
    /* Inverted orientation: baseId on the received leg still maps. */
    var inv = [{ time: "2026-10-05T04:00:00", paid: { amount: "10", asset: "1.3.1" }, received: { amount: "100", asset: "1.3.0" } }];
    var pts4 = MarketFills.fillsToPoints(inv, "1.3.0", 5, 4, "1.3.1", 10);
    eq(pts4.length, 1, "inverted legs map");
    eq(pts4[0].volumeBaseRaw, "100", "inverted base raw is the received leg");
    /* Bad cap throws named, empty fills are valid. */
    assert.throws(function () { MarketFills.fillsToPoints(fills, "1.3.0", 5, 4, "1.3.1", 0); }, /bad-count/, "cap 0 throws bad-count");
    eq(MarketFills.fillsToPoints([], "1.3.0", 5, 4, "1.3.1", 10).length, 0, "empty fills valid");
  } finally {
    if (savedFormat === undefined) delete G.Format; else G.Format = savedFormat;
  }
})();
```

Note: the `pts[1].timeMs === pts[2].timeMs` false-check relies on distinct slot times (01:00 vs 02:00); the same-second pair is covered by `pts2`. Times: fills[0] is 02:00 (newest), fills[1]/fills[2] are 01:00. Output oldest-first: [01:00(#100), 01:00(#200), 02:00(#300)] — wait, both 01:00 rows share the same `time` string so `timeMs` ties. `pts[0].timeMs < pts[1].timeMs` compares 01:00 < 01:00 → false! Fix the vector: order the assertions on the known layout. Oldest-first stable order of [02:00, 01:00a, 01:00b] reversed-sliced = [01:00a, 01:00b, 02:00]. So assert `pts[0].volumeBaseRaw === "100"`, `pts[1].volumeBaseRaw === "200"`, `pts[2].volumeBaseRaw === "300"`, and `pts[0].timeMs === pts[1].timeMs` (tie preserved, two points), `pts[2].timeMs > pts[1].timeMs`. Use exactly this corrected block (replace the three ordering lines):

```js
    eq(pts[0].volumeBaseRaw, "100", "oldest fill first");
    eq(pts[1].volumeBaseRaw, "200", "tie slot keeps second fill");
    eq(pts[0].timeMs === pts[1].timeMs, true, "same slot is two points");
    eq(pts[2].timeMs > pts[1].timeMs, true, "newest fill last");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/discrete-timescale-test.js`
Expected: FAIL with `MarketFills.fillsToPoints is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `vanilla/js/api/market-fills-history.js`, insert this function directly after the `fillsToCandles` function closes (before `mergeDeep`), with this exact JSDoc + body (it reuses the file's own `_sigPlaces`, `SIGFIG_MAX`, `PRICE_PLACES`, `_isIntStr`, `priceHuman` — verify those identifiers exist in the file first; they do per the read-back at lines 308/364-375):

```js
  /* fillsToPoints: raw fills -> discrete scatter points (Discrete timescale).
   * Same orientation/volume contract as fillsToCandles (priceHuman legs,
   * base-leg volume) but NO bucketing, NO merging: every mappable fill is
   * one point, same-second fills stay separate (dex-ux plotlyChart parity —
   * order_book.html Discrete radio + main.js chartHandler scatter branch).
   * Params: fills (newest-first, chainFills/fillsForMarket shape), baseId,
   *   precB/precQ numeric precisions, quoteId, cap (1..5000 integer, the
   *   shared candle-count input — newest cap entries survive, painted
   *   oldest-first). Returns oldest-first [{timeMs, price, volume (base-leg
   *   human), volumeBaseRaw, volumeQuoteRaw}]. Empty fills are VALID ([]).
   * Malformed fills (bad time, unmappable legs, zero quote) are skipped,
   * never reject. Throws "bad-count" on a non-integer cap < 1.
   * Pure except Format (BigInt money math only); Number() never touches money. */
  function fillsToPoints(fills, baseId, precB, precQ, quoteId, cap) {
    if (cap === undefined) cap = 2000;
    cap = Math.floor(cap);
    if (!(cap >= 1)) throw new Error("bad-count");
    var list = Array.isArray(fills) ? fills.slice(0, cap) : [];
    var places = PRICE_PLACES;
    try {
      var probe = [];
      list.forEach(function (f) {
        var p = priceHuman(f, baseId, precB, precQ, quoteId, SIGFIG_MAX);
        if (p !== null && p !== undefined) probe.push(p);
      });
      places = _sigPlaces(probe);
    } catch (e) { places = PRICE_PLACES; }
    var newest = [];
    list.forEach(function (f) {
      var price = priceHuman(f, baseId, precB, precQ, quoteId, places);
      if (price === null || price === undefined) return;
      var unix = Math.floor(Date.parse(f && f.time) / 1000);
      if (!(unix > 0)) return;
      var bRaw = null, qRaw = null;
      try {
        var b = String(baseId), q = String(quoteId);
        var pA = String(f.paid.asset), rA = String(f.received.asset);
        if (pA === b && rA === q) { bRaw = String(f.paid.amount); qRaw = String(f.received.amount); }
        else if (pA === q && rA === b) { bRaw = String(f.received.amount); qRaw = String(f.paid.amount); }
        if (!_isIntStr(String(bRaw)) || !_isIntStr(String(qRaw))) { bRaw = null; qRaw = null; }
      } catch (e) { bRaw = null; qRaw = null; }
      if (bRaw === null || qRaw === null) return;
      var vol = "0";
      try { vol = Format.formatAmount(bRaw, precB); } catch (e) { vol = "0"; }
      newest.push({ timeMs: unix * 1000, price: price, volume: vol, volumeBaseRaw: bRaw, volumeQuoteRaw: qRaw });
    });
    newest.reverse();
    return newest;
  }
```

And add `fillsToPoints: fillsToPoints` to the returned object (the `fillsForMarket: ..., fillsToCandles: ..., mergeDeep: ...` list).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/discrete-timescale-test.js`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/market-fills-history.js tooling/discrete-timescale-test.js
git commit -m "feat(discrete): MarketFills.fillsToPoints raw point mapping"
```

---

### Task 3: `PoolHistory.swapsToPoints` (pool point mapping, pure)

**Files:**
- Modify: `vanilla/js/api/pool-history.js` (add function + export)
- Test: append vectors to `tooling/discrete-timescale-test.js`

**Interfaces:**
- Consumes: enriched swaps (`.price`, `.time`, `.paid`, `.received`), `Format.formatAmount`.
- Produces: `PoolHistory.swapsToPoints(swaps, assetB, precB, cap)` oldest-first. Task 6 consumes it.

- [ ] **Step 1: Write the failing test (append before the final console.log)**

```js
/* swapsToPoints: newest-first tape in, oldest-first points out. */
(function () {
  var PoolHistory = require("../vanilla/js/api/pool-history.js");
  var G = (typeof globalThis !== "undefined") ? globalThis : global;
  var savedFormat = G.Format;
  G.Format = { formatAmount: function (raw, prec) { return "A(" + raw + ":" + prec + ")"; } };
  try {
    var swaps = [
      { time: "2026-10-05T02:00:00", price: "2.0", paid: { amount: "20", asset: "1.3.1" }, received: { amount: "40", asset: "1.3.2" } },
      { time: "2026-10-05T01:00:00", price: "1.0", paid: { amount: "10", asset: "1.3.1" }, received: { amount: "10", asset: "1.3.2" } },
      { time: "2026-10-05T01:00:00", price: "1.5", paid: { amount: "30", asset: "1.3.2" }, received: { amount: "20", asset: "1.3.1" } },
      { time: "2026-10-05T00:00:00", price: null, paid: { amount: "1", asset: "1.3.1" }, received: { amount: "1", asset: "1.3.2" } }
    ];
    /* assetB 1.3.2, precB 5, cap 10. */
    var pts = PoolHistory.swapsToPoints(swaps, "1.3.2", 5, 10);
    eq(pts.length, 3, "null-price swap skipped");
    eq(pts[0].price, "1.0", "oldest swap first");
    eq(pts[1].price, "1.5", "same-slot second swap kept separate");
    eq(pts[1].volumeBaseRaw, "30", "paid-B leg is the base volume");
    eq(pts[0].volumeBaseRaw, "10", "received-B leg is the base volume");
    eq(pts[2].price, "2.0", "newest swap last");
    var capped = PoolHistory.swapsToPoints(swaps.slice(0, 3), "1.3.2", 5, 2);
    eq(capped.length, 2, "cap slices newest 2");
    eq(capped[1].price, "2.0", "newest swap survives the cap");
    assert.throws(function () { PoolHistory.swapsToPoints(swaps, "1.3.2", 5, 0); }, /bad-count/, "cap 0 throws bad-count");
    eq(PoolHistory.swapsToPoints([], "1.3.2", 5, 10).length, 0, "empty tape valid");
  } finally {
    if (savedFormat === undefined) delete G.Format; else G.Format = savedFormat;
  }
})();
```

(Assumes `pool-history.js` has `module.exports = PoolHistory` — verify before writing; if it exports differently, require the documented path and adjust one line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/discrete-timescale-test.js`
Expected: FAIL with `PoolHistory.swapsToPoints is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `vanilla/js/api/pool-history.js`, insert after `swapsToCandles` closes:

```js
  /* swapsToPoints: enriched swaps -> discrete scatter points (Discrete
   * timescale). Same price/volume contract as swapsToCandles (enriched
   * .price, B-leg volume whether paid or received) but NO bucketing:
   * every priced swap is one point (dex-ux discrete parity — raw tape,
   * never aggregated). Params: swaps (newest-first tape), assetB id,
   * precB numeric B precision, cap 1..5000 integer (shared candle-count
   * input — newest cap entries survive, painted oldest-first). Returns
   * oldest-first [{timeMs, price, volume (B-leg human), volumeBaseRaw,
   * volumeQuoteRaw}]. Unpriced/un Shirted swaps are skipped, never reject.
   * Empty swaps are VALID ([]). Throws "bad-count" on cap < 1. Pure except
   * Format.formatAmount (BigInt money math only). */
  function swapsToPoints(swaps, assetB, precB, cap) {
    if (cap === undefined) cap = 2000;
    cap = Math.floor(cap);
    if (!(cap >= 1)) throw new Error("bad-count");
    if (!Number.isInteger(precB) || precB < 0 || precB > 12) throw new Error("bad precision: " + JSON.stringify(precB));
    var list = Array.isArray(swaps) ? swaps.slice(0, cap) : [];
    var newest = [];
    list.forEach(function (sw) {
      if (!sw || sw.price === null || sw.price === undefined) return;
      var unix = Math.floor(Date.parse(sw.time) / 1000);
      if (!(unix > 0)) return;
      var bRaw = null, aRaw = null;
      try {
        if (String(sw.received.asset) === String(assetB) && /^\d+$/.test(String(sw.received.amount))) {
          bRaw = String(sw.received.amount); aRaw = /^\d+$/.test(String(sw.paid.amount)) ? String(sw.paid.amount) : null;
        } else if (String(sw.paid.asset) === String(assetB) && /^\d+$/.test(String(sw.paid.amount))) {
          bRaw = String(sw.paid.amount); aRaw = /^\d+$/.test(String(sw.received.amount)) ? String(sw.received.amount) : null;
        }
      } catch (e) { bRaw = null; aRaw = null; }
      if (bRaw === null || aRaw === null) return;
      var vol = "0";
      try { vol = Format.formatAmount(bRaw, precB); } catch (e) { vol = "0"; }
      newest.push({ timeMs: unix * 1000, price: String(sw.price), volume: vol, volumeBaseRaw: bRaw, volumeQuoteRaw: aRaw });
    });
    newest.reverse();
    return newest;
  }
```

(Fix the JSDoc typo "Un Shirted" → "Untimed/malformed" when writing for real — the committed text must contain no such typo. Final wording: "Swaps with null price, bad time, or non-digit legs are skipped, never reject.")

Add `swapsToPoints: swapsToPoints` to the file's export list (verify the exact return-object shape first).

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/discrete-timescale-test.js`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/pool-history.js tooling/discrete-timescale-test.js
git commit -m "feat(discrete): PoolHistory.swapsToPoints raw point mapping"
```

---

### Task 4: `DiscreteCharts` canvas renderer + script tag (no LWC in Discrete)

**Files:**
- Create: `vanilla/js/api/discrete-charts.js`
- Modify: `vanilla/index.html` (one script tag after `js/api/market-charts.js`)
- Modify: `vanilla/js/globals.d.ts` (declare the global; verify exact file content first)
- Test: headless stub-canvas smoke appended to `tooling/discrete-timescale-test.js`

**Interfaces:**
- Consumes: `DOM.clear` (guarded — works headless when `doc` stub provides `createElement`), theme CSS vars via `getComputedStyle` (guarded fallback).
- Produces: global `DiscreteCharts` with `drawDiscretePrice(doc, hostEl, points, opts)` and `drawDiscreteVolume(doc, hostEl, points, opts)`; both return `{kind: "discrete", n}` and never throw. Tasks 5–6 consume them.

- [ ] **Step 1: Write the failing test (stub-canvas smoke)**

Append before the final `console.log`:

```js
/* DiscreteCharts smoke: stub canvas 2D, no DOM, no network. */
(function () {
  var DiscreteCharts = require("../vanilla/js/api/discrete-charts.js");
  function stubCtx() {
    return { calls: [], setTransform: function () {}, clearRect: function () {}, beginPath: function () { this.calls.push("begin"); }, arc: function () { this.calls.push("dot"); }, fill: function () { this.calls.push("fill"); }, moveTo: function () { this.calls.push("move"); }, lineTo: function () { this.calls.push("line"); }, stroke: function () { this.calls.push("stroke"); }, fillText: function () {}, setLineDash: function () {} };
  }
  function stubDoc(ctx) {
    return { createElement: function () { return { className: "", style: {}, clientWidth: 300, width: 0, height: 0, getContext: function () { return ctx; }, setAttribute: function () {}, appendChild: function () {} }; } };
  }
  function stubHost() {
    var kids = [];
    return { clientWidth: 300, appendChild: function (k) { kids.push(k); }, removeChild: function () {}, get children() { return kids; } };
  }
  var pts = [
    { timeMs: 1000, price: "1.0", volume: "A(10:5)", volumeBaseRaw: "10", volumeQuoteRaw: "5" },
    { timeMs: 1000, price: "1.5", volume: "A(30:5)", volumeBaseRaw: "30", volumeQuoteRaw: "20" },
    { timeMs: 2000, price: "2.0", volume: "A(40:5)", volumeBaseRaw: "40", volumeQuoteRaw: "20" }
  ];
  var ctx = stubCtx();
  var r = DiscreteCharts.drawDiscretePrice(stubDoc(ctx), stubHost(), pts, { log: false, colors: {} });
  eq(r.n, 3, "price paints 3 dots");
  eq(ctx.calls.indexOf("dot") !== -1, true, "dots drawn as arcs");
  var ctx2 = stubCtx();
  var r2 = DiscreteCharts.drawDiscreteVolume(stubDoc(ctx2), stubHost(), pts, { colors: {} });
  eq(r2.n, 3, "volume paints 3 stems");
  var ctx3 = stubCtx();
  var r3 = DiscreteCharts.drawDiscretePrice(stubDoc(ctx3), stubHost(), [], { colors: {} });
  eq(r3.n, 0, "empty points valid, honest empty (no throw)");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/discrete-timescale-test.js`
Expected: FAIL with `Cannot find module '../vanilla/js/api/discrete-charts.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `vanilla/js/api/discrete-charts.js` with this exact content (module header + two painters; DPR fit duplicated from the desk pattern per doctrine; every helper guarded so headless/odd-DOM never throws):

```js
/* DiscreteCharts: Discrete-timescale canvas painters (dots + volume stems).
 * Owns: drawDiscretePrice (one dot per fill/swap at exact timeMs, no
 *   connecting line, no aggregation) and drawDiscreteVolume (one vertical
 *   stem per point on a zero-based scale). No fetching, no LWC, no signing.
 * Consumes: DOM.clear (guarded), getComputedStyle theme vars (guarded
 *   fallbacks), devicePixelRatio (guarded). Numbers from human strings are
 *   pixel coordinates only — money math already settled upstream in
 *   MarketFills.fillsToPoints / PoolHistory.swapsToPoints via Format.
 * Globals/side effects: publishes globalThis.DiscreteCharts; module.exports
 *   for node suites. Created by: discrete-timescale plan Task 4 (dex-ux
 *   plotlyChart scatter parity — markers for irregular timestamps, multiple
 *   points per second preserved).
 */
var DiscreteCharts = (function () {
  "use strict";

  /* Read a theme token with fallback (same pattern as market-ind-panes
   * readVar — duplicated plain code keeps this file self-contained).
   * Params: name (CSS var), fallback string. Returns string, never throws. */
  function readVar(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }

  /* Frame colors (theme-aware, never hardcoded). Returns object, never throws. */
  function colorsOf(over) {
    over = over || {};
    return {
      paneBg: over.paneBg || readVar("--plot-bg", "#131722"),
      grid: over.grid || readVar("--border", "#2a2e39"),
      text: over.text || readVar("--text", "#c5cbce"),
      accent: over.accent || readVar("--accent", "#007bff"),
      muted: over.muted || readVar("--muted", "#758696")
    };
  }

  /* DPR-aware canvas under a host (clears the host first when DOM.clear is
   * present). Params: doc, hostEl, cssH. Returns {ctx, w, h} or null. Never throws. */
  function fitHost(doc, hostEl, cssH) {
    try {
      if (!doc || !hostEl || typeof doc.createElement !== "function") return null;
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.clear === "function") DOM.clear(hostEl);
      } catch (e) { /* paint over whatever stands */ }
      var canvas = doc.createElement("canvas");
      if (!canvas || typeof canvas.getContext !== "function") return null;
      canvas.className = "mkt-canvas";
      var w = hostEl.clientWidth || 300;
      var dpr = 1;
      try {
        if (typeof window !== "undefined" && window.devicePixelRatio) dpr = window.devicePixelRatio;
      } catch (e) { dpr = 1; }
      try {
        canvas.style.width = "100%";
        canvas.style.height = cssH + "px";
      } catch (e) { /* size attrs below still apply */ }
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(cssH * dpr);
      var ctx = canvas.getContext("2d");
      if (!ctx) return null;
      try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) { /* unscaled stands */ }
      try { ctx.clearRect(0, 0, w, cssH); } catch (e) { /* blank stands */ }
      try { hostEl.appendChild(canvas); } catch (e) { return null; }
      return { ctx: ctx, w: w, h: cssH };
    } catch (e) { return null; }
  }

  /* Honest empty note in the host (never a blank pane). Never throws. */
  function emptyNote(doc, hostEl, text) {
    try {
      if (!doc || !hostEl) return;
      var p = doc.createElement("p");
      p.className = "muted";
      try { p.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      var label = (typeof text === "string" && text) ? text : "No fills yet.";
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.text === "function") DOM.text(p, label);
        else p.textContent = label;
      } catch (e) { p.textContent = label; }
      try { hostEl.appendChild(p); } catch (e) { /* host gone */ }
    } catch (e) { /* empty state is best-effort */ }
  }

  /* Price dots. Params: doc, hostEl, points ([{timeMs, price}]), opts
   * {log, colors, emptyText}. Log applies to the price y-scale only.
   * Returns {kind: "discrete", n}. Never throws. */
  function drawDiscretePrice(doc, hostEl, points, opts) {
    opts = opts || {};
    var list = Array.isArray(points) ? points : [];
    var C = colorsOf(opts.colors);
    if (list.length === 0) {
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.clear === "function") DOM.clear(hostEl);
      } catch (e) { /* note below covers */ }
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var g = fitHost(doc, hostEl, 260);
    if (!g) return { kind: "discrete", n: list.length };
    var i, t = [], v = [];
    for (i = 0; i < list.length; i++) {
      var ms = list[i] && list[i].timeMs;
      var px = list[i] ? Number(list[i].price) : NaN;
      if (typeof ms !== "number" || !isFinite(px)) continue;
      if (opts.log && !(px > 0)) continue;
      t.push(ms);
      v.push(opts.log ? Math.log10(px) : px);
    }
    if (v.length === 0) {
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var lo = Math.min.apply(null, t), hi = Math.max.apply(null, t);
    var vlo = Math.min.apply(null, v), vhi = Math.max.apply(null, v);
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    if (!(vhi > vlo)) { vhi = vlo + 1; vlo = vlo - 1; }
    var padL = 8, padR = 8, padT = 12, padB = 18;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    var ctx = g.ctx;
    try {
      ctx.fillStyle = C.accent;
      for (i = 0; i < t.length; i++) {
        var x = padL + ((t[i] - lo) / (hi - lo)) * plotW;
        var y = padT + (1 - (v[i] - vlo) / (vhi - vlo)) * plotH;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, 6.283185307179586);
        ctx.fill();
      }
    } catch (e) { /* partial dots stand */ }
    return { kind: "discrete", n: v.length };
  }

  /* Volume stems (zero-based, always linear). Params: doc, hostEl, points
   * ([{timeMs, volume}]), opts {colors, emptyText}. Returns {kind, n}. Never throws. */
  function drawDiscreteVolume(doc, hostEl, points, opts) {
    opts = opts || {};
    var list = Array.isArray(points) ? points : [];
    var C = colorsOf(opts.colors);
    if (list.length === 0) {
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.clear === "function") DOM.clear(hostEl);
      } catch (e) { /* note below covers */ }
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var g = fitHost(doc, hostEl, 120);
    if (!g) return { kind: "discrete", n: list.length };
    var i, t = [], v = [];
    for (i = 0; i < list.length; i++) {
      var ms = list[i] && list[i].timeMs;
      var amt = list[i] ? Number(list[i].volume) : NaN;
      if (typeof ms !== "number" || !isFinite(amt) || amt < 0) continue;
      t.push(ms);
      v.push(amt);
    }
    if (v.length === 0) {
      emptyNote(doc, hostEl, opts.emptyText);
      return { kind: "discrete", n: 0 };
    }
    var lo = Math.min.apply(null, t), hi = Math.max.apply(null, t);
    var vmax = Math.max.apply(null, v);
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    if (!(vmax > 0)) vmax = 1;
    var padL = 8, padR = 8, padT = 8, padB = 14;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    var ctx = g.ctx;
    try {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (i = 0; i < t.length; i++) {
        var x = padL + ((t[i] - lo) / (hi - lo)) * plotW;
        var y = padT + (1 - v[i] / vmax) * plotH;
        ctx.moveTo(x, padT + plotH);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    } catch (e) { /* partial stems stand */ }
    return { kind: "discrete", n: v.length };
  }

  return {
    drawDiscretePrice: drawDiscretePrice,
    drawDiscreteVolume: drawDiscreteVolume
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.DiscreteCharts === "undefined") { globalThis.DiscreteCharts = DiscreteCharts; }
if (typeof module !== "undefined") { module.exports = DiscreteCharts; }
```

Then: add `<script src="js/api/discrete-charts.js"></script>` in `vanilla/index.html` immediately after the `market-charts.js` script tag (verify exact neighboring lines first). And declare the global in `vanilla/js/globals.d.ts` following the existing `MarketCharts`/`MarketFills` declaration pattern (read the file first; mimic verbatim).

Volume stems note: `Number(list[i].volume)` parses human volume strings like `"A(10:5)"` in tests → NaN → skipped, so the Task-4 smoke's volume assertion (`r2.n === 3`) would FAIL with stub volumes. Fix: stems read `volumeBaseRaw`/`volumeQuoteRaw`? Raw ints can exceed float precision — but pixels only: use `Number(volumeBaseRaw)` magnitude (documented pixels-only, same class as closes). Change the volume read to prefer `volumeBaseRaw` (digit string) then fall back to `volume`:

```js
      var raw = list[i] ? list[i].volumeBaseRaw : null;
      var amt = (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : (list[i] ? Number(list[i].volume) : NaN);
```

With stub volumes `"A(10:5)"` failing the digit test, fallback `Number("A(10:5)")` is NaN → still skipped → smoke fails. So instead the TEST must carry digit raws (it does: `volumeBaseRaw: "10"`) — with the `volumeBaseRaw`-first read, `Number("10")` works and `r2.n === 3` passes. Use the `volumeBaseRaw`-first read in the real code (also honest: base-leg magnitude is the volume semantic). Specify exactly that.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/discrete-timescale-test.js`
Expected: PASS, exit 0.

Run: `bash tooling/check_types.sh`
Expected: PASS (or only pre-existing errors — compare against `git stash` baseline if any error mentions the new file).

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/discrete-charts.js vanilla/index.html vanilla/js/globals.d.ts tooling/discrete-timescale-test.js
git commit -m "feat(discrete): canvas dots+stems renderer, no LWC in Discrete"
```

---

### Task 5: Exchange desk wiring (fetch branch, draw branch, greyed menu)

**Files:**
- Modify: `vanilla/js/views/market-desk-fill.js` (`fill(state)` Discrete branch)
- Modify: `vanilla/js/views/market-ind-panes.js` (`paintTimeframes` Discrete radio, `paintCountNote` fills wording, `renderIndMenu` disabled state, `maybeDraw`/`drawCharts` Discrete branch)
- Modify: `vanilla/js/views/market-desk.js` (seed `state.discrete`, live-tip Discrete re-fetch)
- Modify: `vanilla/js/views/market-desk-query.js` (`syncUrl` needs no change — it calls `buildDeskQuery`; verify)

**Interfaces:**
- Consumes: `MarketFills.fillsForMarket` (Task 2), `DiscreteCharts` (Task 4), `MarketInd.CANDLE_COUNT`, `state.discrete`/`state.bucket`/`state.points`.
- Produces: Discrete desk behavior per spec §6. Task 7 verifies manually.

- [ ] **Step 1: Write the failing test** — DOM wiring has no headless unit test (parity contract verifies via manual testnet script in Task 7). Instead add a regression pin for the mode contract that IS testable: extend `tooling/discrete-timescale-test.js` with the `buildDeskQuery` restore vector (leaving Discrete keeps the retained bucket):

```js
/* Leaving Discrete restores the retained numeric bucket (no refetch surprise). */
(function () {
  var MarketDeskQ = require("../vanilla/js/views/market-desk-query.js");
  var IND2 = { OVERLAY_DEFS: [["sma", null]], OSC_ORDER: [["rsi", "RSI"]] };
  var seed = MarketDeskQ._query.readDeskQuery({ tf: "discrete" }, IND2);
  eq(seed.bucket, 3600, "discrete seed retains numeric bucket");
  var back = MarketDeskQ._query.buildDeskQuery({ bucket: seed.bucket, discrete: false, over: {}, osc: {}, logScale: false, showVwap: false, showDepth: false, showPoolMap: true });
  eq(back, "", "leaving discrete restores clean default URL");
})();
```

Run: `node tooling/discrete-timescale-test.js` — Expected: PASS already (contract holds by construction); this step pins it, no FAIL cycle needed. (TDD note for the reviewer: pure contract covered in Task 1; DOM branch below is Task-7 manual-verified per the parity contract.)

- [ ] **Step 2: Implement the desk branch (complete code)**

2a. `market-desk.js showDesk`: after `bucket: seed.bucket, tfInit: false, ...` add `discrete: !!seed.discrete,` to the state literal (verify the exact state literal lines first — the `bucket: seed.bucket` line). Seed wiring only; `state.bucket` stays numeric always.

2b. `market-ind-panes.js paintTimeframes`: after the `avail.forEach` loop (before `paintCountNote(state)`), append the Discrete radio:

```js
    /* Discrete mode (raw fills, no buckets): always offered last (dex-ux
     * order_book.html radio order). Selecting it sets state.discrete and
     * keeps state.bucket as the return target; numeric radios clear the flag. */
    (function () {
      var lab = doc.createElement("label");
      lab.className = "mkt-tf";
      var radio = doc.createElement("input");
      radio.type = "radio";
      radio.name = "mkt-tf";
      radio.value = "discrete";
      radio.checked = !!state.discrete;
      radio.setAttribute("aria-label", t("market.tf_discrete", "Discrete") + " fills");
      touchable(radio);
      radio.addEventListener("change", function () {
        state.discrete = true;
        paintCountNote(state);
        onBucket();
        try {
          if (typeof MarketDesk !== "undefined" && MarketDesk && typeof MarketDesk.syncUrl === "function") MarketDesk.syncUrl(state);
        } catch (e) { /* URL stays */ }
      });
      lab.appendChild(radio);
      lab.appendChild(DOM.el(doc, "span", t("market.tf_discrete", "Discrete")));
      state.tfBox.appendChild(lab);
    })();
```

And in the numeric radio `change` handler, first line add `state.discrete = false;`. (`touchable` and `t` and `DOM` are already in scope in that file — verify, do not redeclare.)

2c. `paintCountNote`: change the body to branch on the flag:

```js
  function paintCountNote(state) {
    if (state.countNote) {
      if (state.discrete) {
        var n = 0;
        try {
          if (state.points && Array.isArray(state.points)) n = state.points.length;
          else if (state.chartData && Array.isArray(state.chartData.buckets)) n = state.chartData.buckets.length;
        } catch (e) { n = 0; }
        state.countNote.textContent = String(n) + " " + t("market.discrete_fills", "fills");
      } else {
        state.countNote.textContent =
          CANDLE_COUNT + " × " + bucketLabel(state.bucket) + " candles";
      }
    }
  }
```

(Pool detail overrides the wording with swaps in Task 6 by setting `state.points` + its own note line — the shared function stays fills-worded; pool sets `P.countNote` text directly in `rebucket` as it does today.)

2d. `renderIndMenu`: right after `panel` is built and before `overlaysGroup(doc, panel, state)` (verify exact lines), insert the Discrete guard:

```js
    /* Discrete mode: everything but price is closed, so the whole menu is
     * inspectable but non-functional (greyed). Selections are RETAINED in
     * state.over/state.osc for the return to buckets — only the controls
     * are disabled, never the state. */
    if (state.discrete) {
      try {
        var note = doc.createElement("p");
        note.className = "muted";
        note.textContent = t("market.discrete_unavailable", "Indicators unavailable in Discrete.");
        panel.appendChild(note);
      } catch (e) { /* menu still disables below */ }
    }
```

and in the `group()` item builder + `overlaysGroup` rows, disable when `state.discrete`: after each `box`/`add`/`num`/`x` control is created, add `if (state.discrete) { try { ctrl.disabled = true; ctrl.title = t("market.discrete_unavailable", "Indicators unavailable in Discrete."); } catch (e) {} }`. Concretely: in `group()`, after `touchable(box);` insert the disabled guard for `box`; in `overlaysGroup`, after `add` creation insert the guard for `add`, and inside `paintChips` after `num`/`x` creation insert guards. (Five one-spot insertions; do not restructure either function.)

Also the plots `group(t("market.plots_group", "Plots"), ...)` call and depth `scaleBtn`s: the Plots group rows are built by the same `group()` helper → covered. The depth scale buttons live in `market-desk.js` (not the menu) and stay functional (price/volume canvas scales) — no change.

2e. `maybeDraw`/`drawCharts` Discrete branch. In `maybeDraw`, first line after `buckets` is read, insert:

```js
    if (state.discrete) {
      var pts = Array.isArray(state.points) ? state.points : [];
      var Cd = themeChartColors();
      var frame = { paneBg: Cd.paneBg, grid: Cd.grid, text: Cd.text, accent: Cd.accent, muted: Cd.muted };
      try {
        if (typeof MarketCharts !== "undefined" && MarketCharts && typeof MarketCharts.removePane === "function") {
          MarketCharts.removePane(state.panes.price);
          Object.keys(state.panes.oscs || {}).forEach(function (k) {
            MarketCharts.removePane(state.panes.oscs[k]);
          });
        }
      } catch (e) { /* teardown must not throw */ }
      state.panes.price = null;
      state.panes.oscs = {};
      /* Tear down torn-down wrappers (osc panes, VWAP, depth, pool map) so
       * only price + discrete volume remain. Depth/pool-map wraps are owned
       * by the desk (state.depthWrap/graphWrap) — detach, never destroy the
       * canvases' state (rebuilt on return by the normal path). */
      try {
        Object.keys(state.paneEls || {}).forEach(function (k) {
          var slot = state.paneEls[k];
          if (slot && slot.wrap && slot.wrap.parentNode) {
            try { slot.wrap.parentNode.removeChild(slot.wrap); } catch (e2) { /* gone */ }
          }
        });
      } catch (e) { /* panes stand */ }
      state.paneEls = {};
      try {
        if (state.depthWrap && state.depthWrap.parentNode) state.depthWrap.parentNode.removeChild(state.depthWrap);
      } catch (e) { /* slice order is chrome */ }
      try {
        if (state.graphWrap && state.graphWrap.parentNode) state.graphWrap.parentNode.removeChild(state.graphWrap);
      } catch (e) { /* slice order is chrome */ }
      if (state.vwapWrap && state.vwapWrap.parentNode) {
        try { state.vwapWrap.parentNode.removeChild(state.vwapWrap); } catch (e) { /* gone */ }
        state.vwapWrap = null;
      }
      /* Discrete volume pane: auto-mounted below price (own wrapper, owned
       * here so bucketed mode never sees it). */
      var dvWrap = state.discreteVolWrap || null;
      if (!dvWrap || dvWrap.parentNode !== state.oscHost) {
        dvWrap = doc.createElement("div");
        dvWrap.className = "mkt-osc-pane";
        var dvHead = doc.createElement("div");
        dvHead.className = "mkt-osc-head";
        dvHead.appendChild(DOM.el(doc, "span", t("market.discrete_volume", "Discrete volume"), "mkt-osc-title"));
        dvWrap.appendChild(dvHead);
        var dvBody = doc.createElement("div");
        dvBody.className = "mkt-osc-body";
        dvWrap.appendChild(dvBody);
        state.discreteVolWrap = dvWrap;
        state.discreteVolBody = dvBody;
        try { state.oscHost.appendChild(dvWrap); } catch (e) { /* host gone */ }
      }
      try {
        if (typeof DiscreteCharts !== "undefined" && DiscreteCharts) {
          state.panes.price = null;
          DiscreteCharts.drawDiscretePrice(doc, state.priceHost, pts, {
            log: !!state.logScale, colors: frame,
            emptyText: t("market.discrete_no_fills", "No fills yet — place an order or try another pair.")
          });
          DiscreteCharts.drawDiscreteVolume(doc, state.discreteVolBody, pts, {
            colors: frame,
            emptyText: t("market.discrete_no_fills", "No fills yet — place an order or try another pair.")
          });
        }
      } catch (e) { /* panes stand on honest empties */ }
      state.chartData = { buckets: [], discrete: true, points: pts };
      try { paintCountNote(state); } catch (e) { /* note best-effort */ }
      return;
    }
```

(`doc` is NOT in scope in `maybeDraw(state)` — it takes only state. The branch needs `state.doc`: the desk state carries `doc` (showDesk sets `doc: doc`). Use `state.doc` throughout the inserted block instead of bare `doc`. Adjust every `doc.createElement` → `state.doc.createElement`, and guard `if (!state.doc || !state.priceHost || !state.oscHost) return;` at the top of the branch. Write it that way for real.)

In `drawCharts`, first line insert `if (state.chartData && state.chartData.discrete) return;` (the Discrete branch above already painted; theme/resize redraws re-enter via `maybeDraw`, not `drawCharts` directly — verify callers: `state.redraw` calls `MarketInd.drawCharts(state)` on resize/theme! So resize/theme in Discrete would hit the early return and go stale. Fix: in `drawCharts`, replace the early return with a re-dispatch: `if (state.chartData && state.chartData.discrete) { maybeDraw(state); return; }` — but `maybeDraw` rebuilds from `state.points` (no fetch), so resize/theme repaints correctly. Specify exactly that.)

2f. `market-desk-fill.js fill(state)`: find the candles fetch (`Market.candles(b.id, q.id, state.bucket, MarketInd.CANDLE_COUNT)`) and branch BEFORE it:

```js
    /* Discrete mode: raw fills, no buckets, no deepen, no VWAP/depth/poolmap.
     * Transport cap 1000 (ES page budget / chain limit arg); the count note
     * shows the ACTUAL point count, never the requested count. */
    if (state.discrete) {
      var dCount = 2000;
      try {
        if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) dCount = MarketInd.CANDLE_COUNT;
      } catch (e) { /* default stands */ }
      var lim = Math.min(Math.max(1, dCount | 0), 1000);
      Market.fillsForMarket(b.id, q.id, lim).then(function (fres) {
        ...map via MarketFills.fillsToPoints(fres.fills, b.id, b.precision, q.precision, q.id, dCount)
        ...state.points = pts; state.candles = { buckets: [] };
        ...MarketInd.maybeDraw(state); ...strip/book paints continue below as today...
      }).catch(history-error path as today);
      return;
    }
```

(Verify the exact fetch shape in `market-desk-fill.js` first: asset/precision variable names (`b.precision`? `assets.base.precision`?), the `Market.` API name for fills (`Market.fillsForMarket` vs `MarketFills.fillsForMarket` — `market-candles.js deepen()` uses `MarketFills.fillsForMarket`, so use that exact global), and the error path. Mirror the surrounding success/error handling byte-for-byte, only swapping the data call + mapping. Do NOT restructure the rest of `fill`.)

2g. Live tip (`market-desk.js refreshTip`): at the top of the `Market.candles(...TIP_COUNT)` success path, branch: when `state.discrete`, re-fetch `MarketFills.fillsForMarket(b.id, q.id, lim)` with the same `lim` rule, map via `fillsToPoints`, compare `discreteHash` (`n + "|" + lastTimeMs + "|" + lastPrice`), skip repaint on match, else `state.points = pts; MarketInd.maybeDraw(state); paintNote();`. Ticker refresh continues unchanged. (`state.tipSeq`/generation guards reused verbatim.)

- [ ] **Step 3: Run the suites**

Run: `node tooling/discrete-timescale-test.js` — Expected: PASS.
Run: `node tooling/market-deeplink-test.js` — Expected: PASS.
Run: `bash tooling/check_types.sh` — Expected: PASS (fix new JSDoc/seam errors only in touched code).
Run: `python3 -m http.server 8080 --directory /workspace/vanilla` + load `#/market/BTS_CNY` headless? Manual browser check belongs to Task 7; here just confirm no console-blocking syntax error by running `node --check` on each touched file:

Run: `node --check vanilla/js/views/market-desk-fill.js && node --check vanilla/js/views/market-ind-panes.js && node --check vanilla/js/views/market-desk.js && node --check vanilla/js/views/market-desk-query.js`
Expected: no output (syntax valid).

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/views/market-desk-fill.js vanilla/js/views/market-ind-panes.js vanilla/js/views/market-desk.js tooling/discrete-timescale-test.js
git commit -m "feat(discrete): exchange desk Discrete branch + greyed menu"
```

---

### Task 6: Pool-detail wiring (tape branch, swaps wording)

**Files:**
- Modify: `vanilla/js/views/pool-detail-view.js` (`rebucket()` Discrete branch)
- Test: no new unit vectors (mapping covered in Task 3); manual in Task 7.

**Interfaces:**
- Consumes: `PoolHistory.swapsToPoints`, `DiscreteCharts`, shared `paintTimeframes`/`maybeDraw` (Task 5 branches activate automatically via `P.discrete`).
- Produces: pool Discrete behavior per spec §6.

- [ ] **Step 1: Implement (complete code)**

1a. Pool state literal (the `P = { doc: doc, bucket: 300, ... }` block): add `discrete: false,` after `bucket: 300,`. (Session-only per spec — no URL keys.)

1b. `rebucket()`: first line insert:

```js
    function rebucketDiscrete() {
      var cap = 2000;
      try {
        if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) cap = MarketInd.CANDLE_COUNT;
      } catch (e) { /* default stands */ }
      var vv = orientVol();
      var pts = [];
      try {
        if (typeof PoolHistory !== "undefined" && PoolHistory && typeof PoolHistory.swapsToPoints === "function") {
          pts = PoolHistory.swapsToPoints(P.swaps, vv.asset, vv.prec, cap);
        }
      } catch (e) { pts = []; }
      P.points = pts;
      P.discrete = true;
      P.candles = { buckets: [] };
      try { MarketInd.maybeDraw(P); } catch (e) { /* note below carries it */ }
      try {
        P.countNote.textContent = pts.length + " " + t("market.discrete_swaps", "swaps");
      } catch (e) { /* count stands */ }
    }
```

Wait — `P.discrete` must be set by the timeframe radio, not inside rebucket. Restructure: the `paintTimeframes(doc, P, onBucket)` shared helper (Task 5) already sets `state.discrete` on radio change and calls `onBucket`. Pool's `onBucket` callback today does `rebucket(); deepenPool(...)`. Change pool's callback to:

```js
      function () {
        if (!live(myGen, uiGen)) return;
        if (P.discrete) {
          P._deepDone = false; P.esBuckets = null; P._deepBucket = null;
          rebucketDiscrete();
          return; /* no deepen in Discrete — the tape IS the source */
        }
        P._deepDone = false; P.esBuckets = null; P._deepBucket = null;
        rebucket();
        deepenPool(doc, P, r, note, myGen, uiGen, rebucket, histHook);
      }
```

And numeric-radio clearing of the flag is handled by the shared `paintTimeframes` change (Task 5: numeric handler sets `state.discrete = false`). `rebucketDiscrete` sets `P.points` + `P.candles = {buckets: []}` and calls the shared `maybeDraw(P)` Discrete branch (which reads `state.points`, paints dots + volume, tears down depth/pool-map slices — pool's `depthWrap`/`graphWrap` detach via the same code; pool re-mounts them on return because pool's chartPane setup re-runs `rebucket()` + slice creation? VERIFY: pool creates depthWrap/graphWrap once at pane setup; the shared teardown only DETACHES them (`removeChild`), and the bucketed `drawCharts` path re-appends? The bucketed path pins `state.depthWrap` at index 1 only `if (state.depthWrap && ...)` — after detach, `depthWrap.parentNode !== oscHost`, so the pin block re-appends it. Confirm this re-mount works by manual Task-7 toggle test (Discrete → bucket → slices return). If not, Task 6 must re-append explicitly in `rebucket()`:

```js
      try {
        if (P.depthWrap && P.depthWrap.parentNode !== oscHost) oscHost.appendChild(P.depthWrap);
        if (P.graphWrap && P.graphWrap.parentNode !== oscHost) oscHost.appendChild(P.graphWrap);
      } catch (e) { /* slices best-effort */ }
```

Include that re-mount proactively (harmless when already mounted — `appendChild` moves; guarded by the parent check so no churn).

Also pool's discrete volume wrapper: the shared `maybeDraw` branch creates `state.discreteVolWrap` under `state.oscHost` — pool passes `oscHost` in P, so it works unchanged. Pool titles: price empty text should read swaps — pass pool-specific `emptyText`? The shared branch uses `market.discrete_no_fills`. For pools, override BEFORE calling maybeDraw: set `P.discreteEmpty = t("pool.no_swaps", ...)`? Simpler: the shared branch reads `state.discreteEmptyText` when present:

In Task 5's branch, `emptyText:` expressions become `(state.discreteEmptyText || t("market.discrete_no_fills", "..."))`. Pool sets `P.discreteEmptyText = t("pool.no_swaps", "No swaps yet.") + ...` at pane setup. (One-line change in Task 5's block — fold it in when writing Task 5; Task 6 sets the field. Order note for the implementer.)

1c. `swapsToPoints` input order: `P.swaps` is newest-first (enrich contract) — matches the function's newest-first-in contract. No reversal needed at the call site.

- [ ] **Step 2: Syntax + suites**

Run: `node --check vanilla/js/views/pool-detail-view.js` — Expected: no output.
Run: `node tooling/discrete-timescale-test.js` — Expected: PASS.
Run: `bash tooling/check_types.sh` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add vanilla/js/views/pool-detail-view.js
git commit -m "feat(discrete): pool-detail Discrete branch from swap tape"
```

---

### Task 7: i18n keys, gates, parity note (done-claim)

**Files:**
- Modify: `vanilla/locales/*.json` (12 files, 7 keys each)
- Create: `docs/parity/discrete-timescale.md`
- Test: `python3 tooling/check_i18n.py`, `bash tooling/check_types.sh`, `python3 tooling/check_rot.py`

**Interfaces:** none downstream. This task makes the done-claim.

Keys (namespace `market`, English values byte-identical to the `t()` defaults above):

| key | en |
|---|---|
| `tf_discrete` | `Discrete` |
| `discrete_fills` | `fills` |
| `discrete_swaps` | `swaps` |
| `discrete_unavailable` | `Indicators unavailable in Discrete.` |
| `discrete_no_fills` | `No fills yet — place an order or try another pair.` |
| `discrete_price` | `Discrete fills` |
| `discrete_volume` | `Discrete volume` |

- [ ] **Step 1: Add keys to all 12 locale dicts**

Follow the repo's i18n-batch precedent (`tooling/add_*_i18n.py` scripts): write one small adder or hand-edit `en.json` + copy English stubs to the other 11 files at the correct alphabetical/group position (verify each file's key ordering first — match the surrounding `market.*` block, e.g. after the `tf`/timeframe keys; check `en.json` lines ~5074 `plots_group` area). Non-en values stay byte-identical English (honest-stub rule). Every key used in code MUST exist in every file or `check_i18n.py` fails.

Run: `python3 tooling/check_i18n.py`
Expected: green (zero missing keys).

- [ ] **Step 2: Run all gates**

Run: `bash tooling/check_types.sh` — Expected: PASS.
Run: `python3 tooling/check_rot.py` — Expected: PASS (no new runtime deps, no CDN, no framework imports in `vanilla/js/api/discrete-charts.js`).
Run: `node tooling/discrete-timescale-test.js && node tooling/market-deeplink-test.js` — Expected: both PASS.

- [ ] **Step 3: Manual testnet verification (observed, not assumed)**

Serve: `python3 -m http.server 8080 --directory /workspace/vanilla` → `http://localhost:8080/#/market/BTS_CNY` (testnet via Settings → Nodes if proving testnet; else mainnet read-only observation — reads never gate on unlock per principle #9).

Script (record ACTUAL observed results in the parity note):
1. Open exchange pair with fills → timeframe row shows Discrete last → select it → price shows dots (no candles/lines), volume stems appear below, indicators/VWAP/depth/pool-map gone, Indicators menu opens with all controls disabled + unavailable note. URL shows `?tf=discrete`.
2. Reload the share link → lands in Discrete with no indicators resurrected.
3. Change candle count → dot count re-slices (note shows actual N).
4. Select a numeric timeframe → buckets + prior indicator selections return intact.
5. Thin pair (few/no fills) → honest empty note, never blank.
6. Pool detail with swaps → same Discrete behavior, note reads "N swaps"; empty pool → `pool.no_swaps` text.
7. Phone 360–390px + desktop ≥1440px layout check; theme trio screenshots.

- [ ] **Step 4: Write the parity note** at `docs/parity/discrete-timescale.md` with ALL 8 contract fields in order (`building-vanilla-slices` §Parity Note Contract):
1. Reference behavior (`order_book.html:131`, `main.js:47-66/191-263`, `kibana.py:280-316/367-399`, `falcon_app.py:268-307` file:line).
2. Vanilla implementation (file:line per task).
3. Manual test steps + observed result (from Step 3).
4. Raw→human test vectors (chain fill raw ints → displayed price/volume incl. a non-BTS precision pair).
5. Theme trio + phone + desktop checks.
6. Module headers + function descriptions present, no dead text.
7. Anti-rot answers (a–c from the spec §8, updated with actuals).
8. Type + i18n gate evidence (paste gate outputs).

- [ ] **Step 5: Commit**

```bash
git add vanilla/locales/ docs/parity/discrete-timescale.md
git commit -m "feat(discrete): i18n keys + parity note, gates green"
```

Then run the audit (REQUIRED per `building-vanilla-slices` step 7): use `auditing-vanilla-slices` before any done-claim.

---

## Self-Review

**1. Spec coverage:** §1 dex-ux review → plan header + Task 2/3/4 provenance comments. §3 mode flag + radio-last + `tf=discrete` + retained bucket → Tasks 1/5/6. §4 components → Tasks 1/4/5/6 file map. §5 data flow (fills newest-first cap slice, base-leg volume, same-second separation, no deepen, log-price-only, invert/book untouched) → Tasks 2/3/5/6. §6 disabled menu + closed plots + empties + a11y → Task 5 (2d/2e) + Task 4 (aria via muted live note) + Task 7 (manual script). §7 testing/parity → Tasks 1–4 unit vectors + Task 7 script + parity note. §8 anti-rot → Task 7 gates + parity field 7. No gaps.

**2. Placeholder scan:** no TBD/TODO/"appropriate handling"/"similar to Task N" — every step carries exact file paths, complete code, exact commands with expected output. Two spots verified-first instead of assumed: `market-ind-panes.js` `_test` block shape (Task 1), `market-desk-fill.js` fetch variable names + `pool-history.js`/`market-desk.js` export shapes (Tasks 2/3/5/6) — each flagged with an explicit "verify X first" instruction naming the exact identifier to confirm.

**3. Type consistency:** `fillsToPoints(fills, baseId, precB, precQ, quoteId, cap)` ↔ Task 5 call `MarketFills.fillsToPoints(fres.fills, b.id, b.precision, q.precision, q.id, dCount)` — names match. `swapsToPoints(swaps, assetB, precB, cap)` ↔ Task 6 call `PoolHistory.swapsToPoints(P.swaps, vv.asset, vv.prec, cap)` — match. Point shape `{timeMs, price, volume, volumeBaseRaw, volumeQuoteRaw}` identical in Tasks 2/3/4/5/6. `drawDiscretePrice(doc, hostEl, points, opts)` / `drawDiscreteVolume(doc, hostEl, points, opts)` return `{kind: "discrete", n}` everywhere. `state.discrete` / `state.points` / `state.discreteVolWrap` / `state.discreteVolBody` / `state.discreteEmptyText` spelled identically across Tasks 4/5/6. `bucketLabel("discrete")`, `seed.discrete`, `tf=discrete` consistent in Tasks 1/5/7. Fixed during review: volume stems read `volumeBaseRaw` first (raw digit magnitude, pixels-only) so stub-human volumes in tests behave; pool sets `discreteEmptyText`; `drawCharts` re-dispatches to `maybeDraw` in Discrete (resize/theme stay live).

---

*Plan saved. Pre-approval noted: the user approved spec + plan for implementation before the plan was written ("your spec and plan are pre approved for implmentation"), so the User Review Gate and Execution Handoff choice are satisfied in advance — proceeding to inline implementation task-by-task in this session (executing-plans flow), starting with Task 1, with test + commit per task and all Task-7 gates before any done-claim.*
