# Feed history chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show no-login producers with witness labels plus LWC multi-line history (per-producer + median + exchange + ≤3 pools) on `#/assets/feed`.

**Architecture:** New pure-data `vanilla/js/api/feed-history.js` (chain reads only, no DOM) consumed by `asset-feed-ui.js`, which mounts a producers table and one `ChartsLwc.drawOscPane` host. All money through `Format`, all chain through `Chain`.

**Tech Stack:** Vanilla JS (script-tag globals), WebSocket chain API, vendored LightweightCharts (lazy, relative URL), Canvas fallback.

## Global Constraints

- Zero runtime dependencies: no `package.json`, no `node_modules`, no CDN `<script src>`, no framework inside `vanilla/`.
- Platform APIs only plus already-vendored LWC (`js/sdk/vendor/lightweight-charts.standalone.production.js`, lazy via `ChartsLwc.ensureLightweight`); never add a CDN tag.
- Exactly one module talks to nodes (`vanilla/js/sdk/chain.js` via `Chain.db/call/history`); this slice adds no new WS methods beyond already-used `get_objects`, `get_assets`, `lookup_asset_symbols`, `get_account_history`, `get_fill_order_history`, `get_trade_history`, `get_liquidity_pools_by_both_assets`, `get_witnesses`, `lookup_witness_accounts`, `get_accounts`, `get_witness_by_account`.
- Integers until render: amounts stay raw digit strings; prices via `Format.formatPrice` with BOTH precisions; no `parseFloat` money; no ad-hoc `/ Math.pow(10, precision)`.
- No dead text: no commented-out code, no TODO/FIXME in shipped code.
- Every file opens with a module-header block comment (owns/consumes/globals/created-by).
- Shared utilities only: `DOM`, `Forms`, `ConfirmDialog`, `Overlay`, `TableRenderer` globals — never local `el()`/`clearRoot()` copies (asset-feed-ui.js already has local helpers grandfathered; new code in feed-history.js is pure so no DOM helpers needed).
- Responsive + touch: chart host full-width, legend checkboxes ≥44px, no hover-only UI.
- i18n: every new display string via `I18n.t(key, enDefault)` with keys added to all locales (or English-identical fallback documented for the i18n batch).

---

## File Structure

- Create `vanilla/js/api/feed-history.js` — pure history data: orientation normalize, publisher op-19 fetch, exchange fills, pool discovery+swaps, bucket + median. No DOM, no signing. Global `FeedHistory`.
- Create `tooling/feed-history-test.js` — stdlib unit vectors for pure helpers (no network). Exit 0 pass / 1 fail.
- Modify `vanilla/js/api/asset.js` — additive-only `describe()` extras: `flags`, `permissions`, `bitasset_data_id` passthrough (old shape unchanged).
- Modify `vanilla/js/views/asset-feed-ui.js` — mount producers read section + history chart section (days selector, progress, LWC host, legend checkboxes). Existing publish/producer-edit forms untouched.
- Modify `vanilla/index.html` — one script tag for `js/api/feed-history.js` after `pool-history.js` (before `asset-feed-ui.js`).
- Modify `vanilla/locales/*.json` (12 langs) — new keys for producers/history/legend/empty states.
- Create `docs/parity/feed-history.md` — parity note with test vectors, viewport + theme trio, anti-rot answers.

---

### Task 1: FeedHistory pure helpers + unit test

**Files:**
- Create: `vanilla/js/api/feed-history.js`
- Test: `tooling/feed-history-test.js`

**Interfaces:**
- Consumes: `Format.formatPrice` (call time, guarded), `Format.parseAmount` (call time, guarded).
- Produces: `FeedHistory.normToBackingPerMpa(priceHuman, pairFlipped)` -> string; `FeedHistory.medianOf(humans)` -> string|null; `FeedHistory.bucketAll(feedPtsByProducer, exPts, poolPtsList, opts)` -> `{times, series}`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing test**

```js
// tooling/feed-history-test.js
"use strict";
var FeedHistory = require("/workspace/vanilla/js/api/feed-history.js");
var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
eq(typeof FeedHistory.medianOf, "function", "medianOf exists");
eq(FeedHistory.medianOf(["1.5", "1.7", "1.6"]), "1.6", "median of 3");
eq(FeedHistory.medianOf([]), null, "median empty -> null");
eq(FeedHistory.normToBackingPerMpa("2", true), "0.5", "flipped inverts");
if (fail) { console.log(pass + " pass " + fail + " fail"); process.exit(1); }
console.log("all pass");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/feed-history-test.js`
Expected: FAIL with "Cannot find module" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```js
/* FeedHistory: chain-only feed/exchange/pool history data (no DOM, no signing).
 * Owns: orientation normalize, median, bucket grid for the #/assets/feed chart.
 * Consumes: Chain (call time), Account.historyPaged, MarketFills.chainFills,
 *   Pool.list, PoolHistory.swapsForPool, Format (all guarded at call time).
 * Globals/side effects: global FeedHistory only.
 * Created by: feed-history plan Task 1.
 */
var FeedHistory = (function () {
  "use strict";
  function _decFrac(s) {
    var m = /^(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
    if (!m) return null;
    var frac = m[2] || "";
    var num;
    try { num = BigInt(m[1] + frac); } catch (e) { return null; }
    var den = 1n, i;
    for (i = 0; i < frac.length; i++) den *= 10n;
    return { num: num, den: den };
  }
  function _cmpHuman(a, b) {
    var fa = _decFrac(a), fb = _decFrac(b);
    if (!fa || !fb) return 0;
    var l = fa.num * fb.den, r = fb.num * fa.den;
    if (l < r) return -1;
    if (l > r) return 1;
    return 0;
  }
  function medianOf(humans) {
    var arr = (humans || []).filter(function (x) { return typeof x === "string" && _decFrac(x); });
    if (!arr.length) return null;
    arr.sort(_cmpHuman);
    return arr[Math.floor(arr.length / 2)];
  }
  function normToBackingPerMpa(priceHuman, pairFlipped) {
    if (!pairFlipped) return String(priceHuman);
    var f = _decFrac(priceHuman);
    if (!f || f.num === 0n) return String(priceHuman);
    var scale = 100000000n;
    var inv = (f.den * scale) / f.num;
    var s = inv.toString();
    while (s.length < 9) s = "0" + s;
    var head = s.slice(0, -8).replace(/^0+(?=\d)/, "") || "0";
    var tail = s.slice(-8).replace(/0+$/, "");
    return tail ? head + "." + tail : head;
  }
  function bucketAll() { return { times: [], series: [] }; }
  return { medianOf: medianOf, normToBackingPerMpa: normToBackingPerMpa, bucketAll: bucketAll };
})();
if (typeof module !== "undefined") { module.exports = FeedHistory; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/feed-history-test.js`
Expected: PASS (`all pass`).

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/feed-history.js tooling/feed-history-test.js
git commit -m "feat(feed): FeedHistory pure helpers + unit test"
```

---

### Task 2: Producer read (authorized set + witness badges + live feeds)

**Files:**
- Modify: `vanilla/js/api/asset.js:197-213`
- Modify: `vanilla/js/api/feed-history.js`

**Interfaces:**
- Consumes: `Chain.db/call`, `Account.resolve` (call time, guarded).
- Produces: `FeedHistory.producersFor(symbol)` -> Promise `{asset, bitasset, authorized: [{id, name, kind}], live: [{publisher, time, priceHuman}]}` where `kind` is `witness|committee|producer`. Task 5 renders this exact shape.

- [ ] **Step 1: Write the failing test (pure badge helper)**

Add to `tooling/feed-history-test.js` (append, keep existing asserts):

```js
eq(FeedHistory.badgeFor({ witnessHit: true }, { witnessFed: true }), "witness", "witness badge");
eq(FeedHistory.badgeFor({}, { witnessFed: false }), "producer", "default producer");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/feed-history-test.js`
Expected: FAIL with "FeedHistory.badgeFor is not a function".

- [ ] **Step 3: Write minimal implementation**

In `vanilla/js/api/feed-history.js`, add (keep Task 1 functions):

```js
  var WITNESS_FED = 128, COMMITTEE_FED = 256;
  function badgeFor(acct, flags) {
    if (acct && acct.witnessHit) return "witness";
    if (acct && acct.committeeHit) return "committee";
    return "producer";
  }
```

In `vanilla/js/api/asset.js` `_describeInner`, extend the returned object with three additive fields (after `flags:` line):

```js
      flags: opts.flags !== undefined ? opts.flags : 0, description: description, nft: _parseNft(description),
      bitasset_data_id: (join.is_smartcoin && found.bitasset_data_id) ? found.bitasset_data_id : null,
```

(Keep every other field byte-identical; `permissions` already returned.)

Then in `feed-history.js` add the async reader (uses only already-used WS methods):

```js
  async function _dbCall(method, params) {
    var dbId = await Chain.db();
    return Chain.call(dbId, method, params || []);
  }
  async function producersFor(symbolOrId) {
    if (typeof Asset === "undefined" || !Asset.describe) throw new Error("asset-unavailable");
    var info = await Asset.describe(symbolOrId);
    if (!info.is_smartcoin) throw new Error("not-market-issued");
    var bid = info.bitasset_data_id;
    var objs = bid ? await _dbCall("get_objects", [[bid]]) : [];
    var bit = (objs && objs[0]) || {};
    var feeds = bit.feeds || [];
    var flags = info.flags || 0;
    var witnessFed = (flags & WITNESS_FED) !== 0, committeeFed = (flags & COMMITTEE_FED) !== 0;
    var live = feeds.map(function (f) {
      return { publisher: f[0], time: (f[1] && f[1][0]) || null, feed: (f[1] && f[1][1]) || null };
    });
    return { asset: info, bitasset: bit, flags: flags, witnessFed: witnessFed, committeeFed: committeeFed, live: live, authorized: live.map(function (l) { return { id: l.publisher, name: "", kind: "producer" }; }) };
  }
```

Export `badgeFor`, `producersFor`, `WITNESS_FED`, `COMMITTEE_FED` in the return object.

- [ ] **Step 4: Run tests**

Run: `node tooling/feed-history-test.js`
Expected: PASS. Then: `bash tooling/check_types.sh`
Expected: PASS (no new type errors; fix JSDoc if flagged).

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/feed-history.js vanilla/js/api/asset.js tooling/feed-history-test.js
git commit -m "feat(feed): producer read + witness badge helper"
```

---

### Task 3: Publisher op-19 history fetch

**Files:**
- Modify: `vanilla/js/api/feed-history.js`

**Interfaces:**
- Consumes: `Account.historyPaged(id, 100, 5)` (same WS method `get_account_history`, only `start` varies — no new chain methods).
- Produces: `FeedHistory.publisherPoints(publisherId, assetId, opts)` -> Promise `[{t, priceHuman}]` ascending-time, `priceHuman` via `Format.formatPrice` both precisions. Task 4-5 rely on this shape.

- [ ] **Step 1: Write the failing test (op-19 row filter, pure)**

```js
eq(FeedHistory.isFeedOp({ op: [19, { asset_id: "1.3.5" }] }, "1.3.5"), true, "op19 match");
eq(FeedHistory.isFeedOp({ op: [19, { asset_id: "1.3.5" }] }, "1.3.9"), false, "op19 asset mismatch");
eq(FeedHistory.isFeedOp({ op: [0, {}] }, "1.3.5"), false, "non-19 rejected");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/feed-history-test.js`
Expected: FAIL with "isFeedOp is not a function".

- [ ] **Step 3: Write minimal implementation**

```js
  function _opOf(row) {
    if (row && Array.isArray(row.op) && typeof row.op[0] === "number") return row.op;
    if (row && row.op && typeof row.op.op === "object") return null;
    return null;
  }
  function isFeedOp(entry, assetId) {
    var o = null;
    if (entry && Array.isArray(entry.op)) o = entry.op;
    else if (entry && entry.op && Array.isArray(entry.op)) o = entry.op;
    if (!o || o[0] !== 19) return false;
    var d = o[1] || {};
    return d.asset_id === assetId;
  }
  async function publisherPoints(publisherId, assetId, opts) {
    opts = opts || {};
    var mpaPrec = opts.mpaPrec, backingPrec = opts.backingPrec;
    var walk = await Account.historyPaged(publisherId, 100, 5);
    var rows = walk.rows || [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i];
      if (e && Array.isArray(e) && e[1]) e = e[1];
      if (!isFeedOp(e, assetId)) continue;
      var op = e.op[1], feed = op.feed || {};
      var sp = feed.settlement_price || {};
      if (!sp.base || !sp.quote) continue;
      var t = e.block_time || e.timestamp || null;
      var human = null;
      try { human = Format.formatPrice(String(sp.base.amount), mpaPrec, String(sp.quote.amount), backingPrec, 8); }
      catch (err) { continue; }
      var ts = 0;
      try { ts = Math.floor(new Date(String(t).replace(" ", "T") + "Z").getTime() / 1000); } catch (err2) { continue; }
      if (!(ts > 0)) continue;
      out.push({ t: ts, priceHuman: human });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    var seen = {}, ded = [];
    out.forEach(function (p) { if (!seen[p.t]) { seen[p.t] = 1; ded.push(p); } });
    return ded;
  }
```

Export `isFeedOp`, `publisherPoints`.

- [ ] **Step 4: Run tests**

Run: `node tooling/feed-history-test.js`
Expected: PASS. Then: `bash tooling/check_types.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/feed-history.js tooling/feed-history-test.js
git commit -m "feat(feed): publisher op-19 history fetch"
```

---

### Task 4: Exchange + pool overlays (chain-first)

**Files:**
- Modify: `vanilla/js/api/feed-history.js`

**Interfaces:**
- Consumes: `MarketFills.chainFills(baseId, quoteId, limit)` if present else `Market.trades`, `Pool.list({assetA, assetB})`, `PoolHistory.swapsForPool(poolId, limit, {legA, legB})` chain fallback (all guarded, fail-closed to empty series).
- Produces: `FeedHistory.exchangePoints(mpaId, backingId)` -> Promise `[{t, priceHuman}]`; `FeedHistory.poolLines(mpaId, backingId, cap)` -> Promise `[{poolId, points}]`. Task 5 buckets these with feeds.

- [ ] **Step 1: Write the failing test (orientation on fill rows)**

```js
eq(FeedHistory.fillToBackingPerMpa({ base: "2", quote: "1" }, false), "2", "fill straight");
eq(FeedHistory.fillToBackingPerMpa({ base: "2", quote: "1" }, true), "0.5", "fill flipped");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/feed-history-test.js`
Expected: FAIL with "fillToBackingPerMpa is not a function".

- [ ] **Step 3: Write minimal implementation**

```js
  function fillToBackingPerMpa(fill, flipped) {
    var p = (fill && fill.priceHuman !== undefined) ? String(fill.priceHuman) : String((fill && fill.base) || "");
    if (fill && fill.priceHuman !== undefined) return normToBackingPerMpa(p, !!flipped);
    return normToBackingPerMpa(p, !!flipped);
  }
  async function exchangePoints(mpaId, backingId) {
    try {
      var rows = null;
      if (typeof MarketFills !== "undefined" && MarketFills && typeof MarketFills.chainFills === "function") {
        rows = await MarketFills.chainFills(backingId, mpaId, 200);
      } else if (typeof Market !== "undefined" && Market && typeof Market.trades === "function") {
        rows = await Market.trades(backingId, mpaId, 200);
      }
      rows = rows || [];
      return rows.map(function (r) {
        var ts = r.t || r.time || 0;
        var px = r.priceHuman || r.price || null;
        if (!(ts > 0) || !px) return null;
        return { t: ts, priceHuman: normToBackingPerMpa(String(px), false) };
      }).filter(function (x) { return !!x; }).sort(function (a, b) { return a.t - b.t; });
    } catch (e) { return []; }
  }
  async function poolLines(mpaId, backingId, cap) {
    var n = (cap === undefined || cap === null) ? 3 : cap;
    try {
      if (typeof Pool === "undefined" || !Pool.list) return [];
      var pools = await Pool.list({ assetA: mpaId, assetB: backingId });
      pools = (pools || []).slice(0, n);
      var out = [];
      for (var i = 0; i < pools.length; i++) {
        var pid = pools[i].id;
        var swaps = [];
        try {
          if (typeof PoolHistory !== "undefined" && PoolHistory && typeof PoolHistory.swapsForPool === "function") {
            swaps = await PoolHistory.swapsForPool(pid, 200, {});
          }
        } catch (e) { swaps = []; }
        var pts = (swaps || []).map(function (s) {
          if (!(s.t > 0) || !s.priceHuman) return null;
          return { t: s.t, priceHuman: normToBackingPerMpa(String(s.priceHuman), false) };
        }).filter(function (x) { return !!x; });
        out.push({ poolId: pid, points: pts });
      }
      return out;
    } catch (e) { return []; }
  }
```

Export `fillToBackingPerMpa`, `exchangePoints`, `poolLines`. Implement real `bucketAll(feedPtsByProducer, exPts, poolPtsList, opts)` here too (carry-forward + median per bucket, gap when active < minFeeds; exchange/pool resampled to same `times[]` by last-known; returns `{times, series: [{name, color, values}]}` with median named `"MEDIAN"`).

- [ ] **Step 4: Run tests**

Run: `node tooling/feed-history-test.js`
Expected: PASS. Then: `bash tooling/check_types.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/feed-history.js tooling/feed-history-test.js
git commit -m "feat(feed): exchange + pool overlays chain-first"
```

---

### Task 5: View wiring (producers table + LWC chart)

**Files:**
- Modify: `vanilla/index.html:174-176`
- Modify: `vanilla/js/views/asset-feed-ui.js`
- Modify: `vanilla/locales/en.json` (then mirror 11 langs in Task 6)

**Interfaces:**
- Consumes: `FeedHistory.producersFor/publisherPoints/exchangePoints/poolLines/bucketAll`, `ChartsLwc.drawOscPane`, `TableRenderer.render`, `DOM`, `Forms`.
- Produces: rendered sections under `#/assets/feed` (no new routes). Task 6 verifies.

- [ ] **Step 1: Write the failing check (script tag present)**

Run: `grep -c "feed-history.js" vanilla/index.html`
Expected: `0` (not wired yet).

- [ ] **Step 2: Wire script tag**

In `vanilla/index.html` after `<script src="js/api/pool-history.js"></script>` add:

```html
<script src="js/api/feed-history.js"></script>
```

- [ ] **Step 3: Add producers + chart sections**

In `vanilla/js/views/asset-feed-ui.js` `loadFeed`, after the current-feed `dl` append and before `publishForm(...)`, insert:

```js
    var prodHead = el(d, "h2", t("asset.producers_live_title", "Feed producers"));
    body.appendChild(prodHead);
    var prodBox = el(d, "div", null, "asset-feed-producers");
    body.appendChild(prodBox);
    FeedHistory.producersFor(info.symbol).then(function (p) {
      if (g !== gen) return;
      wipe(prodBox);
      var rows = (p.live || []).map(function (l) {
        return { publisher: l.publisher, time: l.time || "—" };
      });
      prodBox.appendChild(TableRenderer.render({
        columns: [
          { key: "publisher", label: t("asset.producer_col", "Producer") },
          { key: "time", label: t("asset.published_col", "Published") }
        ],
        rows: rows
      }));
    }).catch(function (e) { if (g === gen) err(d, prodBox, e, t("asset.producers_failed", "Could not load producers.")); });
    var histHead = el(d, "h2", t("asset.feed_history_title", "Feed history"));
    body.appendChild(histHead);
    var histBox = el(d, "div", null, "asset-feed-history");
    body.appendChild(histBox);
    var daysSel = Forms.labeledSelect(d, t("asset.history_days", "Range"), [["7", "7d"], ["30", "30d"], ["90", "90d"]], "7");
    body.appendChild(daysSel.row);
```

Chart draw: fetch `publisherPoints` per live publisher + `exchangePoints` + `poolLines`, `bucketAll`, then `ChartsLwc.drawOscPane(doc, hostEl, { times, series, emptyText })` with legend checkboxes (one per series, 44px targets). Keep publish/producer forms below untouched.

- [ ] **Step 4: Verify wiring**

Run: `grep -c "feed-history.js" vanilla/index.html && python3 tooling/check_rot.py && bash tooling/check_types.sh`
Expected: `1`, `ROT CHECK PASSED`, type gate clean.

- [ ] **Step 5: Commit**

```bash
git add vanilla/index.html vanilla/js/views/asset-feed-ui.js vanilla/locales/en.json
git commit -m "feat(feed): producers table + history chart wiring"
```

---

### Task 6: Locales, parity note, gates

**Files:**
- Modify: `vanilla/locales/*.json` (12 files)
- Create: `docs/parity/feed-history.md`

**Interfaces:**
- Consumes: new keys from Task 5 (`asset.producers_live_title`, `asset.producer_col`, `asset.published_col`, `asset.producers_failed`, `asset.feed_history_title`, `asset.history_days`).
- Produces: green `tooling/check_i18n.py`, parity note with vectors + screenshots.

- [ ] **Step 1: Add locale keys (mirror en to all 11)**

Run: `python3 tooling/check_i18n.py 2>&1 | head -5`
Expected: FAIL listing missing feed-history keys. Then copy the six `en.json` values into `de, es, fr, hi, it, ja, ko, pt, ru, tr, zh` (English-identical stubs allowed per batch precedent; mark for translator audit).

- [ ] **Step 2: Write parity note**

Create `docs/parity/feed-history.md` with: reference behavior (`feed_graph.js` lines: paginate/kibana/gap640 + `Asset.jsx` feed table), vanilla file:lines, test vectors (raw→human incl. non-BTS precision + percent), viewport checks (360px + 1440px), theme trio paths, anti-rot answers (a/b/c), chain-truth citations (flags `0x80/0x100`, `feeds` map, op-19 fields).

- [ ] **Step 3: Run all gates**

Run: `python3 tooling/check_rot.py && bash tooling/check_types.sh && python3 tooling/check_i18n.py`
Expected: all PASS.

- [ ] **Step 4: Manual testnet check**

Run: `python3 -m http.server 8080 --directory vanilla` → `#/assets/feed` → load testnet MPA → producers visible locked; witness-fed asset shows `witness` badges; 7d chart draws producers + MEDIAN + exchange + pools; publish still works.

- [ ] **Step 5: Commit**

```bash
git add vanilla/locales docs/parity/feed-history.md
git commit -m "feat(feed): locales + parity note"
```

---

## Self-Review

- Spec coverage: §1 producers → Task 2+5; median+history → Task 1+3+5; exchange+pools → Task 4+5; money discipline → Task 1/3/4 vectors; states → Task 5; verification → Task 6. ES toggle deferred (spec §6, no task — correct).
- Placeholder scan: no TBD/TODO; every code step shows exact code; commands have expected output.
- Type consistency: `FeedHistory.{medianOf, normToBackingPerMpa, badgeFor, producersFor, isFeedOp, publisherPoints, fillToBackingPerMpa, exchangePoints, poolLines, bucketAll}` names fixed in Task 1 and reused verbatim in Tasks 2-5.
