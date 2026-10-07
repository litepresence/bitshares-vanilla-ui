# Global Market Pair Context + Parallel Selector Ladder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One global "selected pair" (`[base, quote]`, 1–2 items, default `[BTS]`) travels the app, so the navbar ladders read `Markets → Market Selector → Exchange Desk` and `Pools → Pool Selector → Swap Desk` in parallel.

**Architecture:** A new dependency-free module `vanilla/js/api/pair-context.js` owns the pair: normalization, `QUOTE_BASE` market-id derivation, and a 3-line pub/sub, all in memory (no storage). Both pickers **read** it to seed their search/filter fields; both desks **write** it on load. The navbar Exchange tab becomes a static `#/markets` link and the one-way pool→Exchange context swap is deleted.

**Tech Stack:** Plain ES5-style JS (classic scripts, `var`, no modules, no deps), node stdlib test scripts, python stdlib i18n adders, headless Chromium probes (dev-only, `tooling/visual/`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-10-07-market-pair-context-design.md`. Where this plan and the spec differ, the spec wins; report the divergence instead of improvising.
- **Zero runtime dependencies** (§4.5): no `package.json`, no CDN, no framework, no build step. `python3 -m http.server` must serve a working app.
- **Pair order is human order `[base, quote]`**; desk ids are `QUOTE_BASE` (`PairContext.marketId()` is the ONLY place that knows this).
- **Pair never empty:** any normalization that yields nothing resets to `DEFAULT = ["BTS"]`.
- **Object-id rejection stays:** symbols matching `^1\.\d+\.\d+$` are dropped (the `validPoolMarket` rule moved, it did not change).
- **One writer per value:** pickers read, desks write. Pickers must NOT write the pair.
- **Seed precedence in both pickers:** URL `?a=`/`?b=` → `PairContext.get()` → `[BTS]`.
- **Script cache-buster:** new `<script>` tags use the same `?v=` value as their neighbours in `vanilla/index.html` (currently `423ea73`).
- **i18n:** every new display string is keyed with a verbatim-English default; no key value is ever machine-translated; **never clobber a verified translation** (all 12 dicts list `nav.exchange` in `_meta.translated`, so `nav.exchange` is kept as-is and `nav.markets` is added beside it).
- **Shared utilities (§7.9):** use `DOM`, `Forms`, `TableRenderer`, `I18n.t` — no local `el()`/`clearRoot()` helpers.
- **Numbers:** this feature adds no money math. Any money display stays through `Format` at render only.
- **Dirty tree:** `vanilla/js/views/pool-ui.js` and ~15 other files carry uncommitted concurrent-workstream edits. Read the working tree, edit surgically, `git add <exact paths>` only. Never `git add -A`, never revert.
- **Gates before any commit:** `python3 tooling/check_rot.py` (PASS), `python3 tooling/check_i18n.py` (OK), `bash tooling/check_types.sh` (green **except** pre-existing `vanilla/js/views/account-ui.js` TS2304 `myGen`/`gen` errors from the concurrent workstream — filter with `grep -v account-ui` and confirm zero other errors).

---

### Task 1: i18n keys for the selector ladder

**Files:**
- Create: `tooling/add_pair_selector_i18n.py`
- Modify: `vanilla/locales/{en,de,es,fr,hi,it,ja,ko,pt,ru,tr,zh}.json` (via the adder)

**Interfaces:**
- Consumes: nothing.
- Produces: five keys in all 12 dicts — `nav.markets` ("Markets"), `market_net.selector_title` ("Market Selector"), `pools.selector_title` ("Pool Selector"), `seo.title_markets` ("Markets — BitShares Wallet"), `seo.desc_markets` ("Browse BitShares order-book markets by 24h volume and open any pair's trading desk. No login needed."). Later tasks call these via `I18n.t(key, default)` with exactly these defaults.

- [ ] **Step 1: Write the adder**

Create `tooling/add_pair_selector_i18n.py`:

```python
#!/usr/bin/env python3
"""add_pair_selector_i18n.py — selector-ladder copy keys.

Adds the 5 keys the parallel Markets/Pools selector ladder needs
(nav.markets, market_net.selector_title, pools.selector_title,
seo.title_markets, seo.desc_markets) to all 12 vanilla/locales/*.json.

Non-en dicts get the verbatim English value (unverified strings stay
English until a human verifies them — principle #10), so every new key is
allowlisted as a stub and stub-honest. insert-if-missing only: never
clobbers a refined translation. en.json _meta.translated inventory kept
sorted. `nav.exchange` ("Exchange", verified in 12 dicts) is deliberately
KEPT even though the navbar now uses `nav.markets` — its translations are
correct English-word translations and must not be destroyed.

Stdlib only. Usage: python3 tooling/add_pair_selector_i18n.py
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

NEW_KEYS = {
    "nav.markets": "Markets",
    "market_net.selector_title": "Market Selector",
    "pools.selector_title": "Pool Selector",
    "seo.title_markets": "Markets — BitShares Wallet",
    "seo.desc_markets": "Browse BitShares order-book markets by 24h volume and open any pair's trading desk. No login needed.",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        added = []
        for dotted, default in NEW_KEYS.items():
            section_name, key = dotted.split(".", 1)
            section = data.get(section_name)
            if not isinstance(section, dict):
                print("%s section MISSING in %s" % (section_name, path))
                return 1
            if key not in section:
                section[key] = default
                added.append(dotted)
        meta = data.get("_meta")
        if isinstance(meta, dict) and isinstance(meta.get("translated"), list):
            inv = meta["translated"]
            for dotted in NEW_KEYS:
                if dotted not in inv:
                    inv.append(dotted)
            inv.sort()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print("updated %s (%d added)" % (path, len(added)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the adder and the drift gate**

Run: `python3 tooling/add_pair_selector_i18n.py`
Expected: 12 lines `updated vanilla/locales/<code>.json (5 added)`.

Run: `python3 tooling/check_i18n.py`
Expected: `OK: 12 dicts key-complete (… keys); allowlists exact; stubs honest; … t() call sites drift-free.` (exit 0)

- [ ] **Step 3: Verify the new keys landed and old ones survived**

Run: `python3 -c "import json;d=json.load(open('vanilla/locales/de.json'));print(d['nav']['markets'], '|', d['nav']['exchange'], '|', d['market_net']['selector_title'], '|', d['pools']['selector_title'])"`
Expected: `Markets | Börse | Market Selector | Pool Selector` — the German `nav.exchange` translation is intact.

- [ ] **Step 4: Commit**

```bash
git add tooling/add_pair_selector_i18n.py vanilla/locales/en.json vanilla/locales/de.json vanilla/locales/es.json vanilla/locales/fr.json vanilla/locales/hi.json vanilla/locales/it.json vanilla/locales/ja.json vanilla/locales/ko.json vanilla/locales/pt.json vanilla/locales/ru.json vanilla/locales/tr.json vanilla/locales/zh.json
git commit -m "i18n(pair-context): selector-ladder copy keys in 12 dicts"
```

---

### Task 2: `PairContext` module (the one owner of the global pair)

**Files:**
- Create: `vanilla/js/api/pair-context.js`
- Create: `tooling/pair-context-test.js`
- Modify: `vanilla/index.html` (one `<script>` tag, after the other `js/api/*` tags)

**Interfaces:**
- Consumes: nothing (no other module, no DOM, no chain).
- Produces (used by Tasks 3–6):
  - `PairContext.get() -> string[]` (1–2 uppercase symbols, human `[base, quote]` order; fresh copy)
  - `PairContext.set(pair: string[]|string) -> string[]` (normalized; notifies subscribers only when the value changes)
  - `PairContext.marketId() -> string|null` (`"QUOTE_BASE"`; `null` for a 1-item pair)
  - `PairContext.fromMarketId(id: string) -> string[]` (`"ETH_BTS"` → `["BTS","ETH"]`; junk/bare ids → `["BTS"]`)
  - `PairContext.fromPool(assets: {base:{symbol?}, quote:{symbol?}}) -> string[]` (pool's own `(base, quote)` order, so `marketId()` reproduces the string the pool desk builds today)
  - `PairContext.on(fn: Function) -> Function` (unsubscribe)
  - `PairContext.reset() -> string[]`
  - `PairContext._t` — test seams `{ normalize, marketId, fromMarketId, DEFAULT }`

- [ ] **Step 1: Write the failing test**

Create `tooling/pair-context-test.js`:

```javascript
/* pair-context-test.js — unit vectors for the global selected pair
 * (vanilla/js/api/pair-context.js). Stdlib only:
 *   node tooling/pair-context-test.js   (exit 0 = green)
 * Covers normalization (case/blanks/dupes/length/object ids/empty),
 * QUOTE_BASE derivation, the round trip, the pool->market string the pool
 * desk builds today, and the pub/sub. Ported from App._test.validPoolMarket
 * (same cases, same expectations — the rule moved to this module).
 * No DOM, no chain, no deps.
 */
"use strict";
var assert = require("assert");
var PairContext = require("../vanilla/js/api/pair-context.js");
var T = PairContext._t;
assert.ok(T && typeof T.normalize === "function", "_t.normalize exported");
assert.ok(T && typeof T.marketId === "function", "_t.marketId exported");
assert.ok(T && typeof T.fromMarketId === "function", "_t.fromMarketId exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function deep(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* --- normalize: the ported validPoolMarket cases, per-leg now --- */
deep(T.normalize(["bts_cny"]), ["BTS_CNY"], "legacy underscore id reaches normalize");
deep(T.normalize(["bts", "cny"]), ["BTS", "CNY"], "lowercase accepted (uppercased)");
deep(T.normalize(["HONEST.BTC", "bts"]), ["HONEST.BTC", "BTS"], "dotted symbols accepted");
deep(T.normalize(["1.3.113"]), ["BTS"], "bare object id dropped -> default");
deep(T.normalize(["1.3.113", "1.3.0"]), ["BTS"], "object-id pair dropped -> default");
deep(T.normalize(["BTS", "1.3.0"]), ["BTS"], "object-id leg dropped, real leg kept");
deep(T.normalize(["A", "B", "C"]), ["A", "B"], "three legs truncated to two");
deep(T.normalize(["BTS", "BTS"]), ["BTS"], "duplicates collapse");
deep(T.normalize(["  bts  ", "", "  ", null, undefined]), ["BTS"], "blanks/nulls dropped, real leg kept");
deep(T.normalize([]), ["BTS"], "empty array resets to default");
deep(T.normalize(["   "]), ["BTS"], "whitespace-only resets to default");
deep(T.normalize(null), ["BTS"], "null resets to default");
deep(T.normalize("bts"), ["BTS"], "a string is ONE leg (id -> pair is fromMarketId's job)");
deep(T.normalize("ETH_BTS"), ["ETH_BTS"], "normalize never splits a string on the separator");
deep(T.normalize("TOOLONGSYMBOLNAME"), ["BTS"], "over-12-char symbol dropped");
deep(T.normalize(["BTS", "ABCDEFGHIJKL"]), ["BTS", "ABCDEFGHIJKL"], "exactly-12-char symbol kept");
deep(T.DEFAULT, ["BTS"], "DEFAULT is [BTS]");

/* --- marketId: QUOTE_BASE is the ONLY place this rule lives --- */
eq(T.marketId(["BTS", "ETH"]), "ETH_BTS", "pair [BTS,ETH] -> desk ETH_BTS");
eq(T.marketId(["BTS", "BTC"]), "BTC_BTS", "spec's BTS/BTC -> BTC_BTS case");
eq(T.marketId(["BTS"]), null, "one-item pair has no desk id");
eq(T.marketId([]), null, "empty pair has no desk id");

/* --- round trip --- */
deep(T.fromMarketId("ETH_BTS"), ["BTS", "ETH"], "desk id -> human pair");
deep(T.fromMarketId("eth_bts"), ["BTS", "ETH"], "lowercase desk id uppercased");
deep(T.fromMarketId("BTC_BTS"), ["BTS", "BTC"], "BTC_BTS -> [BTS,BTC]");
deep(T.fromMarketId("BTS"), ["BTS"], "bare id -> single-leg pair");
deep(T.fromMarketId("1.3.113"), ["BTS"], "object id -> default");
deep(T.fromMarketId(""), ["BTS"], "empty id -> default");
deep(T.fromMarketId(null), ["BTS"], "null id -> default");
deep(T.fromMarketId("A_B_C"), ["BTS"], "three-part id rejected (validPoolMarket rule) -> default");

/* --- pool -> pair -> desk id: reproduces today's pool string --- */
deep(PairContext.fromPool({ base: { symbol: "BTS" }, quote: { symbol: "USDT" } }), ["BTS", "USDT"],
  "pool pair is the pool's own (base, quote) order");
eq(PairContext.marketId.call({ _pair: ["BTS", "USDT"] }, null), null, "marketId ignores extra args");
PairContext.reset();
PairContext.set(["BTS", "USDT"]);
eq(PairContext.marketId(), "USDT_BTS", "pool pair -> USDT_BTS (what pool-detail-view built)");
deep(PairContext.fromPool({ base: {}, quote: {} }), ["BTS"], "pool with no symbols -> default");
PairContext.reset();
PairContext.set(["BTS", "1.3.0"]);
deep(PairContext.fromPool({ base: { symbol: "USDT" }, quote: {} }), ["USDT"], "missing pool leg -> one leg");

/* --- live state: default, set, copy-on-get, change notification --- */
PairContext.reset();
deep(PairContext.get(), ["BTS"], "reset -> default pair");
PairContext.set(["bts", " eth "]);
deep(PairContext.get(), ["BTS", "ETH"], "set normalizes");
deep(PairContext.set("ETH_BTS"), ["BTS", "ETH"], "set accepts a QUOTE_BASE id string");
PairContext.set(["", "   "]);
deep(PairContext.get(), ["BTS"], "unusable set resets to default");
PairContext.reset();
var copy = PairContext.get();
copy.push("ETH");
deep(PairContext.get(), ["BTS"], "get() returns a copy (caller cannot mutate state)");

var seen = [];
var off = PairContext.on(function (p) { seen.push(p.join(",")); });
PairContext.set(["BTS", "ETH"]);
PairContext.set(["BTS", "ETH"]);
PairContext.set(["bts", "eth"]);
deep(seen, ["BTS,ETH"], "subscriber notified once, only on a real change");
off();
PairContext.set(["BTS", "DOGE"]);
deep(seen, ["BTS,ETH"], "unsubscribe stops notifications");
PairContext.on(function () { throw new Error("throwing subscriber must not break set"); });
PairContext.set(["BTS", "ETH"]); /* must not throw */
PairContext.reset();

/* --- subscriber removal mid-notify is safe --- */
var order = [];
var offA = PairContext.on(function () { order.push("a"); });
PairContext.on(function () { order.push("b"); offA(); });
PairContext.set(["BTS", "XRP"]);
deep(order, ["a", "b"], "unsubscribing during notify does not throw");

console.log("pair-context vectors: " + passed + " passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tooling/pair-context-test.js`
Expected: FAIL — `Cannot find module '../vanilla/js/api/pair-context.js'`.

- [ ] **Step 3: Write the module**

Create `vanilla/js/api/pair-context.js`:

```javascript
/* PairContext: the global selected pair — the one piece of trading context
 * that travels the app. Owns: the pair value, its normalization, the
 * QUOTE_BASE market-id rule, and a 3-line pub/sub.
 * Consumes: nothing (no DOM, no chain, no storage, no other module).
 *   Side effects: none beyond its own module state.
 * Value: string[] of 1-2 uppercase symbols in HUMAN order [base, quote]
 *   (["BTS"] default). Desk ids are QUOTE_BASE ("ETH_BTS"), which is why
 *   marketId() swaps the legs and why nothing else in the app should do
 *   that swap.
 * Lifetime: session memory only (owner ruling 2026-10-07) — a reload
 *   resets to [BTS]; shareable URLs carry ?a=/?b= instead.
 * Readers/writers: both pickers READ (seed their search/filter fields),
 *   both desks WRITE (on load, from the route). Pickers never write.
 * Created by: pair-context plan Task 2
 *   (spec docs/superpowers/specs/2026-10-07-market-pair-context-design.md).
 * NEVER throws: every public call is wrapped, bad input normalizes to the
 * default, a throwing subscriber cannot break a write.
 */
var PairContext = (function () {
  "use strict";

  var DEFAULT = ["BTS"];
  var SYMBOL_MAX = 12;
  var OBJECT_ID_RE = /^1\.\d+\.\d+$/;
  var pair = DEFAULT.slice();
  var subs = [];

  /* normalize: any input -> the canonical pair. Accepts an array of legs
   * or a bare id string ("ETH_BTS" / "ETH-BTS"); trims, uppercases, drops
   * blanks, drops object-id-shaped junk (a bare id would misroute a desk —
   * the validPoolMarket rule, kept verbatim), enforces the 12-char symbol
   * cap, dedupes, truncates to 2 legs, and resets an empty result to
   * DEFAULT so the pickers can always render something.
   * @param {string[]|string|null|undefined} input
   * @returns {string[]} 1-2 symbols, human order. Never empty. */
  function normalize(input) {
    var legs = [];
    try {
      if (Array.isArray(input)) legs = input.slice();
      else if (typeof input === "string") legs = [input];
      else if (input && typeof input.length === "number") legs = Array.prototype.slice.call(input);
    } catch (e) { legs = []; }
    var out = [];
    for (var i = 0; i < legs.length; i++) {
      var s = "";
      try { s = String(legs[i] == null ? "" : legs[i]).trim().toUpperCase(); } catch (e) { s = ""; }
      if (!s) continue;
      if (OBJECT_ID_RE.test(s)) continue;
      if (s.length > SYMBOL_MAX) continue;
      if (out.indexOf(s) !== -1) continue;
      out.push(s);
      if (out.length === 2) break;
    }
    return out.length ? out : DEFAULT.slice();
  }

  /* marketId: the pair as a desk id (QUOTE_BASE), or null when the pair
   * has one leg (an anchor with no market yet — the pickers render it, the
   * desk cannot open it).
   * @param {string[]} [p] pair to convert; defaults to the live pair
   * @returns {string|null} e.g. ["BTS","ETH"] -> "ETH_BTS" */
  function marketId(p) {
    var legs = normalize(arguments.length ? p : pair);
    return legs.length === 2 ? legs[1] + "_" + legs[0] : null;
  }

  /* fromMarketId: desk id -> pair. Inverse of marketId(). Bare ids and
   * junk yield the single-leg pair (["BTS"]) rather than throwing, so an
   * odd URL still leaves a renderable picker.
   * @param {string} id QUOTE_BASE desk id
   * @returns {string[]} human-order pair */
  function fromMarketId(id) {
    var parts = [];
    try { parts = String(id == null ? "" : id).split(/[-_]/); } catch (e) { parts = []; }
    var legs = [];
    if (parts.length === 2) legs = [parts[1], parts[0]];
    else if (parts.length === 1) legs = [parts[0]];
    return normalize(legs);
  }

  /* fromPool: pool assets -> pair, in the pool's own (base, quote) order.
   * That order is deliberate: marketId() then reproduces the exact
   * "QUOTE_BASE" string pool-detail-view.js used to hand the navbar, so a
   * pool visit and an Exchange visit agree on one pair.
   * @param {{base?: {symbol?: string}, quote?: {symbol?: string}}} assets
   * @returns {string[]} human-order pair */
  function fromPool(assets) {
    var legs = [];
    try {
      if (assets && typeof assets === "object") {
        if (assets.base) legs.push(assets.base.symbol);
        if (assets.quote) legs.push(assets.quote.symbol);
      }
    } catch (e) { legs = []; }
    return normalize(legs);
  }

  /* get: the live pair as a fresh array (callers cannot mutate state).
   * @returns {string[]} 1-2 symbols */
  function get() {
    try { return normalize(pair); } catch (e) { return DEFAULT.slice(); }
  }

  /* set: replace the pair (array or id string) and notify subscribers when
   * the normalized value actually changed. Never throws — a throwing or
   * self-unsubscribing subscriber cannot break the write.
   * @param {string[]|string} next
   * @returns {string[]} the stored pair */
  function set(next) {
    var input = next;
    try {
      if (typeof input === "string" && /^[^_-]+[-_][^_-]+$/.test(input.trim())) input = fromMarketId(input);
    } catch (e) { /* normalize below handles it */ }
    var normalized = normalize(input);
    try {
      var same = normalized.length === pair.length;
      if (same) for (var i = 0; i < normalized.length; i++) if (normalized[i] !== pair[i]) { same = false; break; }
      if (same) return normalized.slice();
      pair = normalized;
    } catch (e) { pair = normalized; }
    var snapshot = subs.slice();
    for (var k = 0; k < snapshot.length; k++) {
      try { snapshot[k](normalized.slice()); } catch (e) { /* one bad subscriber stands alone */ }
    }
    return normalized.slice();
  }

  /* on: subscribe to pair changes.
   * @param {Function} fn called with the new pair
   * @returns {Function} unsubscribe */
  function on(fn) {
    if (typeof fn !== "function") return function () {};
    try { subs.push(fn); } catch (e) { return function () {}; }
    return function () {
      try { var i = subs.indexOf(fn); if (i !== -1) subs.splice(i, 1); } catch (e) { /* gone */ }
    };
  }

  /* reset: back to DEFAULT (tests + a future Clear affordance).
   * @returns {string[]} ["BTS"] */
  function reset() { return set(DEFAULT.slice()); }

  return {
    get: get, set: set, on: on, reset: reset,
    marketId: marketId, fromMarketId: fromMarketId, fromPool: fromPool,
    _t: { normalize: normalize, marketId: marketId, fromMarketId: fromMarketId, DEFAULT: DEFAULT }
  };
})();

if (typeof module !== "undefined") { module.exports = PairContext; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/pair-context-test.js`
Expected: `pair-context vectors: 40 passed` (any count ≥ 1 with exit 0; the exact number may differ if assertions are counted differently — the line must end in `passed` and exit 0).

- [ ] **Step 5: Register the script tag**

In `vanilla/index.html`, add one line immediately after the existing
`<script src="js/api/market-net.js?v=423ea73"></script>` line:

```html
<script src="js/api/pair-context.js?v=423ea73"></script>
```

Rationale: `PairContext` has no load-order dependency (every caller guards
with `typeof`), and placing it with the other `js/api/*` tags keeps the file
grouped for a reader.

- [ ] **Step 6: Run the gates**

Run: `python3 tooling/check_rot.py` → expect `ROT CHECK PASSED`.
Run: `node tooling/pair-context-test.js` → green.

- [ ] **Step 7: Commit**

```bash
git add vanilla/js/api/pair-context.js tooling/pair-context-test.js vanilla/index.html
git commit -m "feat(pair-context): global selected pair module + unit vectors"
```

---

### Task 3: Navbar + sitemap point at the selectors (and the pool swap dies)

**Files:**
- Modify: `vanilla/js/app.js` — `ORIGINAL_NAV` (line 74), delete `poolMarketID` / `validPoolMarket` / `setPoolMarket` / `poolMarket` / `refreshExchangeLink` (lines 77–113), `NAV_ICONS` (line 134), `navText` (line 150), `buildNavLink` (lines 163–191), module exports (line 1322)
- Modify: `vanilla/js/router.js` — delete the pool-context clear hook (lines 570–580); add the `/markets` SEO entry beside the `/pools` one (line ~323)
- Modify: `vanilla/js/views/menu-ui.js` — Trade section card `Exchange` href → `#/markets` (line 79)
- Modify: `tooling/app-shell-test.js` — update nav vectors, drop the `validPoolMarket` block (ported in Task 2's test file)

**Interfaces:**
- Consumes: `PairContext` is NOT used by app.js (navbar hrefs are static; the pair travels through the pages). `App.setPoolMarket` disappears — any remaining caller must be migrated (Task 6 does the only one).
- Produces: `_test.ORIGINAL_NAV`, `_test.NAV_ICONS`, `_test.navText`, `_test.navIsCurrent(hash, href)` (new seam for the section-aware highlight).

- [ ] **Step 1: Update the failing test first**

In `tooling/app-shell-test.js`, delete the `validPoolMarket` assertion block
(lines 12–28, i.e. the `assert.ok(T && typeof T.validPoolMarket …)` line and
the seven `eq(T.validPoolMarket(…), …)` lines) and replace the nav-shape
vectors with:

```javascript
/* nav-six after the selector ladder: Markets + Pools are category tabs
 * (the selectors), not desks. 6 links, unchanged count/order. */
eq(T.ORIGINAL_NAV.length, 6, "nav-six still 6 links");
eq(T.ORIGINAL_NAV[1], "#/markets", "Exchange slot is the market selector");
eq(T.ORIGINAL_NAV[2], "#/pools", "Pools slot is the pool selector");
eq(T.NAV_ICONS["#/markets"], "trade", "Markets tab keeps the trade glyph");
eq(T.NAV_ICONS["#/pools"], "poolmart", "Pools tab keeps the poolmart glyph");
eq(T.NAV_ICONS["#/market/BTS_USD"], undefined, "no desk href in the icon map any more");
assert.strictEqual(T.navText("#/markets"), "Markets", "Markets label");
assert.strictEqual(T.navText("#/pools"), "Pools", "Pools label");

/* Section-aware current-tab highlight (one rung deep stays highlighted). */
eq(T.navIsCurrent("#/markets", "#/markets"), true, "selector highlights itself");
eq(T.navIsCurrent("#/market/BTS_USD", "#/markets"), true, "market desk highlights Markets");
eq(T.navIsCurrent("#/market/ETH_BTS", "#/markets"), true, "any market desk highlights Markets");
eq(T.navIsCurrent("#/pools", "#/pools"), true, "pools selector highlights itself");
eq(T.navIsCurrent("#/pools/1.19.0", "#/pools"), true, "pool desk highlights Pools");
eq(T.navIsCurrent("#/market/BTS_USD", "#/pools"), false, "market desk does not highlight Pools");
eq(T.navIsCurrent("#/pools/1.19.0", "#/markets"), false, "pool desk does not highlight Markets");
eq(T.navIsCurrent("#/explorer", "#/explorer"), true, "exact match still highlights");
eq(T.navIsCurrent("#/explorer/blocks", "#/explorer"), false, "explorer tabs stay exact-match only");
eq(T.navIsCurrent("#/", "#/"), true, "dashboard highlights itself");
eq(T.navIsCurrent("#/market/BTS_USD", "#/"), false, "desk does not highlight Dashboard");
```

Note: `navText` needs `I18n` — under node it falls back to the verbatim
default, so the assertions hold without a browser.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tooling/app-shell-test.js`
Expected: FAIL — `ORIGINAL_NAV[1]` is `"#/market/BTS_USD"`, and `T.navIsCurrent` is not a function.

- [ ] **Step 3: Rewire `app.js`**

3a. Replace the `ORIGINAL_NAV` array and its comment header (lines 67–75):

```javascript
  /* ORIGINAL_NAV: the header bar (nav-six 2026-10-05 owner ruling, pools
   *   restore: Dashboard, Exchange, Pools, Credit, Margin, Explore).
   *   2026-10-07 selector ladder: the two trading tabs are CATEGORIES, so
   *   they land on the selector pages (Markets -> #/markets, Pools ->
   *   #/pools) and never jump straight to a desk. The pair the user last
   *   looked at travels in PairContext (session memory), so the selector
   *   re-seeds itself — the navbar needs no context swap, and the
   *   pool->Exchange one-way swap is deleted with it. Credit Offer
   *   shortens to Credit; Margin (#/borrow) joins. The two
   *   vanilla-original labs (API Lab, ES Lab) are reachable from the Labs
   *   sitemap section only, never the bar (nav-pulldown Task 3 owner
   *   ruling), so boot rebuilds keep 6 links. */
  var ORIGINAL_NAV = ["#/", "#/markets", "#/pools", "#/credit-offer",
    "#/borrow", "#/explorer"];
```

3b. Delete lines 77–113 entirely (the `poolMarketID` variable, its comment
block, `validPoolMarket`, `setPoolMarket`, `poolMarket`, and
`refreshExchangeLink`).

3c. In `NAV_ICONS`, replace `"#/market/BTS_USD": "trade",` with
`"#/markets": "trade",`.

3d. In `navText`, replace the two cases:

```javascript
      case "#/markets": return t("nav.markets", "Markets");
      case "#/pools": return t("nav.pools", "Pools");
```

3e. Insert `navIsCurrent` immediately before `buildNavLink`:

```javascript
  /* NAV_SECTIONS: hrefs that own a child route, so the tab stays current
   * one rung down the ladder (the selector's desk still belongs to it).
   * Exact match otherwise — a tab never lights up for a sibling. */
  var NAV_SECTIONS = { "#/markets": ["#/market/"], "#/pools": ["#/pools/"] };
  /* navIsCurrent: is `href`'s tab the current one for `hash`?
   * @param {string} hash current location.hash (with "#")
   * @param {string} href tab href (with "#")
   * @returns {boolean} never throws */
  function navIsCurrent(hash, href) {
    try {
      var h = String(hash || "#/");
      var a = String(href || "");
      if (h === a) return true;
      var kids = NAV_SECTIONS[a] || [];
      for (var i = 0; i < kids.length; i++) if (h.indexOf(kids[i]) === 0) return true;
      return false;
    } catch (e) { return false; }
  }
```

3f. Rewrite `buildNavLink`'s opening (delete the pool-context swap and the
`#/market/` special cases):

```javascript
  function buildNavLink(href, iconOK) {
    var a = document.createElement("a");
    a.setAttribute("href", href);
    var label = navText(href);
    var icon = NAV_ICONS[href] || null;
    try {
      if (icon && iconOK) {
        a.appendChild(Icon.img(icon, "nav-icon", ""));
        var span = document.createElement("span");
        span.className = "nav-label";
        span.textContent = label;
        a.appendChild(span);
      } else {
        a.textContent = label;
      }
    } catch (e) { a.textContent = label; }
    /* Active-route highlight (command-palette findability): section match,
     * so the desk one rung below a selector keeps its tab current. */
    try {
      var h = (typeof location !== "undefined" && location.hash) || "#/";
      if (navIsCurrent(h, href)) a.setAttribute("aria-current", "page");
    } catch (e) { /* highlight skipped */ }
    return a;
  }
```

3g. Update the exports (line ~1322):

```javascript
  return { boot: boot, localizeShell: localizeShell,
    _test: { parseBuildInfo: parseBuildInfo, parseCompare: parseCompare, compareUrl: compareUrl, relationText: relationText, netHostText: netHostText, currentNetwork: currentNetwork, offbranchText: offbranchText, buildDirectory: buildDirectory, closeDirectory: closeDirectory, ORIGINAL_NAV: ORIGINAL_NAV, NAV_ICONS: NAV_ICONS, NAV_SECTIONS: NAV_SECTIONS, navText: navText, navIsCurrent: navIsCurrent, buildNav: buildNav, buildNavLink: buildNavLink } };
```

- [ ] **Step 4: Rewire `router.js`**

4a. Delete the pool-context clear hook (the `try { if (typeof App !== "undefined" … setPoolMarket …) }` block and its comment).

4b. Add the `/markets` SEO entry immediately after the `"/pools"` line:

```javascript
    "/markets": { titleKey: "seo.title_markets", title: "Markets — BitShares Wallet", descKey: "seo.desc_markets", description: "Browse BitShares order-book markets by 24h volume and open any pair's trading desk. No login needed." },
```

- [ ] **Step 5: Retarget the sitemap card**

In `vanilla/js/views/menu-ui.js`, in the `trade` section, change the first card:

```javascript
        { href: "#/markets", icon: "trade", titleKey: "menu.p_exchange", titleDefault: "Exchange", blurbKey: "menu.d_exchange", blurbDefault: "Order book, charts, and buy/sell desk." },
```

- [ ] **Step 6: Run the tests**

Run: `node tooling/app-shell-test.js` → exit 0.
Run: `node tooling/pair-context-test.js` → green (regression).
Run: `python3 tooling/check_i18n.py` → `OK: …` (the `nav.markets` default must match en.json).

- [ ] **Step 7: Commit**

```bash
git add vanilla/js/app.js vanilla/js/router.js vanilla/js/views/menu-ui.js tooling/app-shell-test.js
git commit -m "feat(nav): Markets/Pools tabs land on the selector pages"
```

---

### Task 4: Market selector reads the pair (`#/markets`)

**Files:**
- Modify: `vanilla/js/views/market-net-ui.js` — H1 (lines 635–641), the backend-missing notice (line 643), the input seed (lines 726–730)
- Create: `tooling/visual/probe-pair-ladder.mjs`

**Interfaces:**
- Consumes: `PairContext.get()` (Task 2).
- Produces: `pairSeed()` — a module-local helper `{a: string, b: string}` implementing the precedence `?a/?b → PairContext.get() → ["BTS"]`. Task 5 implements the same precedence in `pool-ui.js` separately (the two pickers own their own query shapes).

- [ ] **Step 1: Write the headless probe**

Create `tooling/visual/probe-pair-ladder.mjs`:

```javascript
/* probe-pair-ladder.mjs — headless check that the selector ladder reads the
 * global pair (dev-only; never shipped, never required).
 *
 * Run:  python3 -m http.server 7334 --directory vanilla &
 *       PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers \
 *         node tooling/visual/probe-pair-ladder.mjs
 * Exit 0 when every assertion holds.
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:7334/#/markets";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
const out = {};

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector(".pools-filters input", { timeout: 20000 });

/* default seed: [BTS] with no second leg */
out.defaultSeed = await page.$$eval(".pools-filters input", (ns) => ns.map((n) => n.value));

/* the pair the desks write must come back as the seed */
out.afterPairWrite = await page.evaluate(() => {
  PairContext.set(["BTS", "ETH"]);
  return PairContext.get().join(",");
});
await page.goto("http://localhost:7334/#/market/ETH_BTS", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
out.deskWrote = await page.evaluate(() => PairContext.get().join(","));
await page.goto("http://localhost:7334/#/markets", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pools-filters input", { timeout: 20000 });
out.seededFromPair = await page.$$eval(".pools-filters input", (ns) => ns.map((n) => n.value));

/* a deep link still wins over the stored pair */
await page.goto("http://localhost:7334/#/markets?a=DOGE&b=USD", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pools-filters input", { timeout: 20000 });
out.deepLinkWins = await page.$$eval(".pools-filters input", (ns) => ns.map((n) => n.value));

/* navbar + heading ladder */
out.navbar = await page.$$eval("#nav a", (as) => as.map((a) => a.textContent.trim()).filter(Boolean).slice(0, 6));
out.h1 = await page.$eval("h1", (h) => h.textContent.trim());
out.marketsTabCurrent = await page.$$eval('#nav a[href="#/markets"]', (as) => as.map((a) => a.getAttribute("aria-current")));

out.errors = errors;
console.log("LADDER:", JSON.stringify(out));
const ok =
  JSON.stringify(out.defaultSeed) === JSON.stringify(["BTS", ""]) &&
  out.deskWrote === "BTS,ETH" &&
  JSON.stringify(out.seededFromPair) === JSON.stringify(["BTS", "ETH"]) &&
  JSON.stringify(out.deepLinkWins) === JSON.stringify(["DOGE", "USD"]) &&
  out.h1 === "Market Selector" &&
  out.navbar.includes("Markets") &&
  out.navbar.includes("Pools") &&
  JSON.stringify(out.marketsTabCurrent) === JSON.stringify(["page"]) &&
  errors.length === 0;
console.log(ok ? "LADDER OK" : "LADDER FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m http.server 7334 --directory vanilla &` then
`PLAYWRIGHT_BROWSERS_PATH=tooling/visual/.browsers node tooling/visual/probe-pair-ladder.mjs`
Expected: `LADDER FAIL` — `defaultSeed` seeds Asset 2 with the stored pair or the H1 is still `Markets`.

- [ ] **Step 3: Seed the inputs from the pair**

In `vanilla/js/views/market-net-ui.js`, insert this helper just above
`function renderMarkets(root) {`:

```javascript
  /* pairSeed: the Asset 1 / Asset 2 starting values, in the spec's
   * precedence — a shared ?a=/?b= deep link wins (it is the URL someone
   * deliberately shared), then the global pair the last desk/pool visit
   * wrote, then the BTS default. Never throws. */
  function pairSeed() {
    var q = readQuery();
    if (String(q.a || "").trim() || String(q.b || "").trim()) {
      return { a: String(q.a || "").trim(), b: String(q.b || "").trim() };
    }
    var legs = [];
    try {
      if (typeof PairContext !== "undefined" && PairContext && typeof PairContext.get === "function") {
        legs = PairContext.get() || [];
      }
    } catch (e) { legs = []; }
    return { a: String(legs[0] || "BTS"), b: String(legs[1] || "") };
  }
```

Then replace the existing seed block:

```javascript
    try {
      var seed = pairSeed();
      if (fA.input) fA.input.value = seed.a.slice(0, 64);
      if (fB.input) fB.input.value = seed.b.slice(0, 64);
    } catch (e) { /* defaults stand */ }
```

- [ ] **Step 4: Rename the heading**

Replace the H1 line (and keep the backend-missing notice consistent):

```javascript
      try { wrap.appendChild(D.pageHead(doc, t("market_net.selector_title", "Market Selector"))); } catch (e) {
        wrap.appendChild(mk(doc, "h1", t("market_net.selector_title", "Market Selector")));
      }
```

and in the `miss` branch, replace
`t("market_net.title", "Markets") + " backend missing: " + miss + " failed to load."`
with
`t("market_net.selector_title", "Market Selector") + " backend missing: " + miss + " failed to load."`.

Leave `market_net.title` in the dicts — `router.js:274` uses it as the route
title and it is still the honest word for the SEO/browser title.

- [ ] **Step 5: Run the probe again**

Run the probe command from Step 2.
Expected: `LADDER: {…}` with `h1: "Market Selector"`, `seededFromPair: ["BTS","ETH"]`, `deepLinkWins: ["DOGE","USD"]`, `navbar` containing `Markets` and `Pools`, `errors: []`, then `LADDER OK` and exit 0.

- [ ] **Step 6: Gates + commit**

```bash
python3 tooling/check_i18n.py && python3 tooling/check_rot.py
node tooling/market-net-test.js
bash tooling/check_types.sh 2>&1 | grep error | grep -v account-ui   # must print nothing
git add vanilla/js/views/market-net-ui.js tooling/visual/probe-pair-ladder.mjs
git commit -m "feat(markets): market selector seeds from the global pair"
```

Expected: i18n `OK`, `ROT CHECK PASSED`, `market-net-test` green, no
non-`account-ui` type errors.

---

### Task 5: Pool selector reads the pair (`#/pools`)

**Files:**
- Modify: `vanilla/js/views/pool-ui.js` — route title (line 638), asset seed (lines 862–865)

**Interfaces:**
- Consumes: `PairContext.get()` (Task 2).
- Produces: nothing new; `pool-ui.js` keeps its own `readQuery`/`writeQuery`.

**WARNING:** `pool-ui.js` has uncommitted concurrent-workstream edits. Edit
only the two regions named below; never run `git checkout`/`stash` on it,
and stage it with `git add vanilla/js/views/pool-ui.js` only after
`git diff --stat vanilla/js/views/pool-ui.js` shows your hunks are the only
new ones you intend (other hunks may already be staged by that workstream —
if so, stop and report instead of committing).

- [ ] **Step 1: Extend the probe to fail on the pool side**

In `tooling/visual/probe-pair-ladder.mjs`, append before `out.errors = errors;`:

```javascript
/* pools selector: same precedence, same pair */
await page.goto("http://localhost:7334/#/pools", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pools-filters input", { timeout: 20000 });
out.poolsH1 = await page.$eval("h1", (h) => h.textContent.trim());
out.poolsSeed = await page.$$eval(".pools-filters input", (ns) => ns.slice(0, 2).map((n) => n.value));
out.poolsTabCurrent = await page.$$eval('#nav a[href="#/pools"]', (as) => as.map((a) => a.getAttribute("aria-current")));
await page.goto("http://localhost:7334/#/pools/1.19.0", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
out.poolsTabOnDesk = await page.$$eval('#nav a[href="#/pools"]', (as) => as.map((a) => a.getAttribute("aria-current")));
```

and extend the `ok` expression with:

```javascript
  out.poolsH1 === "Pool Selector" &&
  JSON.stringify(out.poolsSeed) === JSON.stringify(["BTS", "ETH"]) &&
  JSON.stringify(out.poolsTabCurrent) === JSON.stringify(["page"]) &&
  JSON.stringify(out.poolsTabOnDesk) === JSON.stringify(["page"]) &&
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `LADDER FAIL` — `poolsH1` is `Liquidity Pools` and `poolsSeed` starts at `BTS`/`""`.

- [ ] **Step 3: Rename the route title**

Line 638:

```javascript
    var ctx = routeReady(root, t("pools.selector_title", "Pool Selector"), function () { renderPools(root); });
```

(`pools.title` stays in the dicts — the desk and other copy still use it.)

- [ ] **Step 4: Seed Asset A / Asset B from the pair**

Replace the restore block's two seed lines (currently
`if (Object.prototype.hasOwnProperty.call(q, "a")) … else fA.input.value = "BTS";` and the `b` line) with:

```javascript
      /* Seed precedence (spec §2.2): a shared ?a=/?b= deep link wins, then
       * the global pair the last desk visit wrote, then the BTS default.
       * An EXPLICIT ?a=/?b= (even empty — the Clear path) still wins so
       * Back/clear round-trips stay honest. */
      var hasDeep = Object.prototype.hasOwnProperty.call(q, "a") || Object.prototype.hasOwnProperty.call(q, "b");
      var legs = [];
      if (!hasDeep) {
        try {
          if (typeof PairContext !== "undefined" && PairContext && typeof PairContext.get === "function") legs = PairContext.get() || [];
        } catch (e) { legs = []; }
      }
      if (Object.prototype.hasOwnProperty.call(q, "a")) fA.input.value = String(q.a || "").slice(0, 64);
      else fA.input.value = String(legs[0] || "BTS").slice(0, 64);
      if (Object.prototype.hasOwnProperty.call(q, "b")) fB.input.value = String(q.b || "").slice(0, 64);
      else if (legs[1]) fB.input.value = String(legs[1]).slice(0, 64);
```

- [ ] **Step 5: Run the probe again**

Expected: `LADDER OK`, exit 0, with `poolsH1: "Pool Selector"`, `poolsSeed: ["BTS","ETH"]`, `poolsTabCurrent: ["page"]`, `poolsTabOnDesk: ["page"]`, `errors: []`.

- [ ] **Step 6: Gates + commit**

```bash
python3 tooling/check_i18n.py && python3 tooling/check_rot.py
node tooling/pool-history-test.js
bash tooling/check_types.sh 2>&1 | grep error | grep -v account-ui   # must print nothing
git add vanilla/js/views/pool-ui.js tooling/visual/probe-pair-ladder.mjs
git commit -m "feat(pools): pool selector seeds from the global pair"
```

---

### Task 6: Both desks write the pair, and the swap call site migrates

**Files:**
- Modify: `vanilla/js/views/market-desk.js` — after line 176 (`MarketDesk._query.saveLast(id);`)
- Modify: `vanilla/js/views/pool-detail-view.js` — replace the `App.setPoolMarket` block (lines 420–427)

**Interfaces:**
- Consumes: `PairContext.set`, `PairContext.fromMarketId`, `PairContext.fromPool` (Task 2).
- Produces: after this task `App.setPoolMarket` has no callers (verify with grep).

- [ ] **Step 1: Extend the probe for the pool desk write**

In `tooling/visual/probe-pair-ladder.mjs`, after the pool-desk visit add:

```javascript
out.poolDeskWrote = await page.evaluate(() => PairContext.get().join(","));
```

and add `out.poolDeskWrote.length > 0 && out.poolDeskWrote !== "BTS,ETH" ? false : true` — i.e. extend `ok` with:

```javascript
  out.poolDeskWrote.indexOf("BTS") !== -1 &&
```

(the pool desk writes the pool's own legs, which on testnet pool `1.19.0`
are not BTS/ETH — the assertion only insists the pair changed from the
markets side).

- [ ] **Step 2: Market desk writes its pair**

In `vanilla/js/views/market-desk.js`, immediately after
`MarketDesk._query.saveLast(id);` add:

```javascript
    /* Global pair context (selector ladder 2026-10-07): a desk visit is a
     * pair visit — the selector you come back to seeds with this pair.
     * fromMarketId undoes the QUOTE_BASE id so the pair is stored in
     * human [base, quote] order, same as the pools side. */
    try {
      if (typeof PairContext !== "undefined" && PairContext && typeof PairContext.set === "function") {
        PairContext.set(PairContext.fromMarketId(id));
      }
    } catch (e) { /* selectors keep their last pair */ }
```

- [ ] **Step 3: Pool desk replaces the pool-context swap**

In `vanilla/js/views/pool-detail-view.js`, replace the
`Pool->Exchange context (owner)` comment + `try { … App.setPoolMarket … }`
block with:

```javascript
    /* Global pair context (selector ladder 2026-10-07): a pool visit writes
     * the pool's own (base, quote) legs, so BOTH selectors come back seeded
     * and the pool->Exchange one-way navbar swap is gone. fromPool keeps
     * the pool's leg order, which is what marketId() needs to rebuild the
     * same "QUOTE_BASE" id the old swap produced. */
    try {
      if (typeof PairContext !== "undefined" && PairContext && typeof PairContext.set === "function") {
        PairContext.set(PairContext.fromPool(P.assets));
      }
    } catch (e) { /* selectors keep their last pair */ }
```

- [ ] **Step 4: Verify no orphan caller remains**

Run: `grep -rn "setPoolMarket\|refreshExchangeLink\|validPoolMarket" vanilla/js tooling | grep -v "tooling/pair-context-test.js"`
Expected: no output. (The pool-context rule now lives only in
`pair-context.js` as the object-id rejection in `normalize`.)

- [ ] **Step 5: Run the probe + tests**

Run the probe: expect `LADDER OK`, exit 0, `poolDeskWrote` set.
Run: `node tooling/pair-context-test.js`, `node tooling/market-fills-test.js`, `node tooling/pool-history-test.js`, `node tooling/app-shell-test.js` — all green.

- [ ] **Step 6: Write the parity note**

Create `docs/parity/pair-context.md` with: the owner rulings (session
memory + URL seeds; pickers read / desks write; seed precedence;
section-aware highlight), the ladder names, evidence (probe output, the
ported `validPoolMarket` vectors), the two accepted costs (navbar drops the
word "Exchange"; `nav.exchange` kept for its verified translations), and
the anti-rot answers: no new dependency, no new chain call, nothing to
delete to keep it working beyond the module itself.

- [ ] **Step 7: Gates + commit**

```bash
python3 tooling/check_rot.py && python3 tooling/check_i18n.py
bash tooling/check_types.sh 2>&1 | grep error | grep -v account-ui   # must print nothing
git add vanilla/js/views/market-desk.js vanilla/js/views/pool-detail-view.js tooling/visual/probe-pair-ladder.mjs docs/parity/pair-context.md
git commit -m "feat(pair-context): desks write the global pair; pool swap retired"
```

---

## Final verification (after Task 6)

- [ ] `node tooling/pair-context-test.js` → green
- [ ] `node tooling/app-shell-test.js` → green
- [ ] `node tooling/market-net-test.js` → green
- [ ] `node tooling/pool-history-test.js` → green
- [ ] `node tooling/market-fills-test.js` → green
- [ ] `python3 tooling/check_rot.py` → `ROT CHECK PASSED`
- [ ] `python3 tooling/check_i18n.py` → `OK: …`
- [ ] `bash tooling/check_types.sh` → no errors other than the pre-existing concurrent `account-ui.js` TS2304 pair
- [ ] Probe: navbar `Markets` → `Market Selector` → pick a row → `Exchange Desk` → navbar → selector pre-seeded; same for `Pools` → `Pool Selector` → `Swap Desk`; `?a=&b=` still wins
- [ ] `git status --short` shows no unrelated file staged, and every unrelated concurrent-workstream diff is still present and unstaged

## Self-review

- **Spec coverage:** §1 module → Task 2 (every call in the table exists); §2 four seams → Tasks 3–6; §2.1 read/write split → Task 2 header + Tasks 4/5/6; §2.2 precedence → Tasks 4 and 5; §2.3 section highlight → Task 3 (`navIsCurrent`); §3 naming + SEO + i18n → Tasks 1, 3, 4, 5; §5 testing → Task 2 (unit), Task 3 (nav vectors), Tasks 4–6 (probe) plus the gate list.
- **Placeholder scan:** no TBD/TODO; every step names exact files, code, commands, and expected output.
- **Type consistency:** `get/set/on/reset/marketId/fromMarketId/fromPool/_t.normalize/_t.marketId/_t.fromMarketId/_t.DEFAULT` are defined once in Task 2 and used verbatim in Tasks 3–6; `navIsCurrent(hash, href)` argument order is identical in the test (Task 3) and the implementation (Task 3).
- **Divergences from the spec, all deliberate and documented in the spec text itself:** pickers do not write (§2.1); `nav.markets` is a new key rather than a rename of `nav.exchange` (Global Constraints); a malformed multi-part desk id (`A_B_C`) is REJECTED to the default pair rather than truncated — the ported `validPoolMarket` rule said three parts are not a valid market, and silently opening a different market from a typo is worse than falling back (found while running Task 2's test). `normalize` also treats a STRING as one leg and never splits it — `set` is the only door that accepts a `QUOTE_BASE` string, routing it through `fromMarketId`, so the two input shapes can never mean different things in different callers.
