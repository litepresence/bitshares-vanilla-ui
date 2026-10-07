# Edge Volume Ramp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace edge thickness encoding with a grey→blue volume ramp on all 4 map views.

**Architecture:** One pure `_ramp(t)` helper duplicated verbatim into both painters; per-scene endpoint resolution; base width constant; legend key on bands, caption on mini-maps.

**Tech Stack:** ES5 vanilla JS, Canvas2D, Node 20 harness, Python stdlib i18n, headless Chromium visual probes.

## Global Constraints

- Zero runtime dependencies (`python3 tooling/check_rot.py` green).
- No floats on money — digit strings/lengths only (lengths are counts, not values; already the width-math precedent).
- Every user string via `t(key, enDefault)`, 12 dicts (`python3 tooling/check_i18n.py` green).
- `bash tooling/check_types.sh` green.
- No `TODO|FIXME`; delete (don't orphan) the width code being replaced.

---

### Task 1: Ramp helper + vectors in both painters

**Files:**
- Modify: `vanilla/js/views/pool-net-paint.js` (append `_ramp` + hex parse + export `_rampForTest`)
- Modify: `vanilla/js/api/pool-graph.js` (same, verbatim + provenance comment)
- Test: `tooling/pool-net-ui-test.js` (paint vectors), pool-graph test file (find-or-create vectors — check for existing `pool-graph-test.js` first)

**Interfaces:**
- Consumes: nothing (pure: `(t, greyHex, blueHex)` → `rgb()` string; parse handles `#rgb`/`#rrggbb`/`rgb()`; garbage → grey).
- Produces: `_rampForTest` on both modules.

- [ ] **Step 1: Write the failing test**

```js
var r = NP._rampForTest;
ok(r(0, "#758696", "#1E9ED7") === "rgb(117, 134, 150)", "t=0 is grey");
ok(r(1, "#758696", "#1E9ED7") === "rgb(30, 158, 215)", "t=1 is BitShares blue");
ok(r(0.5, "#000000", "#ffffff") === "rgb(128, 128, 128)", "midpoint is a true mix");
ok(r(9, "#758696", "#1E9ED7") === "rgb(30, 158, 215)", "clamps high");
ok(r(-2, "#758696", "#1E9ED7") === "rgb(117, 134, 150)", "clamps low");
ok(r(0.5, "banana", "#1E9ED7") === "rgb(117, 134, 150)", "garbage grey falls closed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/pool-net-ui-test.js`
Expected: FAIL `_rampForTest` not a function (TypeError on `r(` — assert the failure mentions ramp).

- [ ] **Step 3: Write minimal implementation** (identical in both files, provenance comment citing the other):

```js
  /* Volume ramp: t in [0,1] -> grey-to-blue ink (owner 2026-10-07: color
   * replaces the old digit-length thickness — same t metric, same /14
   * scale, so a given blue means the same thing on every map. Pure:
   * parse failures fail closed to grey. Verbatim twin lives in
   * pool-graph.js (pool-net-paint.js here) — doctrine prefers the
   * duplication over a shared import for two files. */
  function _ramp(t, greyHex, blueHex) {
    function chan(h, i) { return parseInt(h.substr(i, 2), 16); }
    function rgb(h) {
      try {
        var s = String(h).trim();
        var m = /^#([0-9a-fA-F]{6})$/.exec(s);
        if (m) return [chan(m[1], 0), chan(m[1], 2), chan(m[1], 4)];
        var m3 = /^#([0-9a-fA-F]{3})$/.exec(s);
        if (m3) return [chan(m3[1][0] + m3[1][0], 0), chan(m3[1][1] + m3[1][1], 0), chan(m3[1][2] + m3[1][2], 0)];
        var mg = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
        if (mg) return [Number(mg[1]), Number(mg[2]), Number(mg[3])];
      } catch (e) { /* grey below */ }
      return null;
    }
    var g = rgb(greyHex), b = rgb(blueHex);
    if (!g || !b) return "rgb(117, 134, 150)";
    var k = Number(t);
    if (!(k > 0)) k = 0;
    if (k > 1) k = 1;
    function mix(i) { return Math.round(g[i] + (b[i] - g[i]) * k); }
    return "rgb(" + mix(0) + ", " + mix(1) + ", " + mix(2) + ")";
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/pool-net-ui-test.js` (+ pool-graph vectors)
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/pool-net-paint.js vanilla/js/api/pool-graph.js tooling/pool-net-ui-test.js <graph-test>
git commit -m "feat(maps): shared grey-blue volume ramp helper + vectors"
```

### Task 2: Bands — color replaces width + legend key

**Files:**
- Modify: `vanilla/js/views/pool-net-paint.js` (`drawScene` edge loop: `strokeStyle = ramp(t(meta))`, base `lineWidth = 1.25`; delete `_edgeWidth` + `_edgeWidthForTest` export; `t` from balance digits (pool mode) or `volBaseRaw` (market mode) — one `edgeT(meta, id)` helper)
- Modify: `vanilla/js/views/pool-net-chrome.js` (legend swatch row: grey chip → blue chip + `pool_net.ramp` / `market_net.ramp` label by mode)
- Test: `tooling/pool-net-ui-test.js` (strokeStyle asserts on stub ctx: high-digit edge strokes blue-ish, low-digit grey-ish, both width 1.25; legend contains ramp label)

**Interfaces:**
- Consumes: existing `S.meta` (balances / volBaseRaw), `_cssTok("--muted"/"--accent")` resolved once per scene next to `border`/`buy`.
- Produces: same hits/mids/nav contract; `drawScene` return shape unchanged.

- [ ] **Step 1: Write the failing test** — stub-ctx `drawScene` (or `paintGraph` if it routes through the edge loop — check current paintGraph vectors first) capture `strokeStyle` per edge + `lineWidth`; assert blue for 13-digit edge, grey for 1-digit, width 1.25 both.
- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/pool-net-ui-test.js`
Expected: FAIL (uniform border color, width varies).

- [ ] **Step 3: Write minimal implementation** — per-scene `var rampLo = _cssTok("--muted", "#758696"), rampHi = _cssTok("--accent", "#1E9ED7");` beside the existing token block; edge loop: `var et = edgeT(paint.meta, e.poolId); ctx.strokeStyle = (hot || onPath || hov) ? <existing> : _ramp(et, rampLo, rampHi); ctx.lineWidth = (hot || onPath || hov) ? 2.5 : 1.25;` delete `_edgeWidth` + its test-seam export + its vectors (replaced, not orphaned).
- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/pool-net-ui-test.js && node tooling/pool-net-test.js`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/pool-net-paint.js vanilla/js/views/pool-net-chrome.js tooling/pool-net-ui-test.js
git commit -m "feat(bands): grey-blue volume ramp replaces edge widths"
```

### Task 3: Mini-maps — color replaces width + caption

**Files:**
- Modify: `vanilla/js/api/pool-graph.js` (`drawGraph` edge loop: ramp by balance digits, base width 1.25; triangle/hover/glow precedence untouched; delete width-by-value code)
- Modify: callers' `graphNote` caption (`market-desk-fill.js`, `pool-detail-view.js` graphNote wiring — one pool-worded line, keyed `pool_net.ramp`)
- Test: pool-graph vectors (strokeStyle blue/grey by digits, width constant)

**Interfaces:**
- Consumes: edge pool rows already in hand (balance raws); per-frame token resolution pattern already in file.
- Produces: same hits/nav contract.

- [ ] **Step 1: Write the failing test** — drawGraph on stub ctx with big/small pools; assert stroke colors differ blue-ward/grey-ward, widths equal.
- [ ] **Step 2: Run test to verify it fails**

Run: pool-graph test file
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation** — mirror Task 2 (ramp endpoints once per draw; `t` from `balance_a_raw`+`balance_b_raw` digit lengths — same `/14`).
- [ ] **Step 4: Run test to verify it passes**

Run: pool-graph test file
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/pool-graph.js <graph-test> <caller files as touched>
git commit -m "feat(mini-maps): grey-blue pool-size ramp replaces edge widths"
```

### Task 4: i18n + gates + visual audit

**Files:**
- Create: `tooling/add_edge_ramp_i18n.py` (`pool_net.ramp`, `market_net.ramp` × 12)
- Create: `docs/parity/edge-volume-ramp.md` (8-field contract)
- Modify: `vanilla/locales/*.json` (via script)

- [ ] **Step 1: Write the script** (copy `add_desk_volume_map_i18n.py` shape).
- [ ] **Step 2: Run gates**

Run: `python3 tooling/add_edge_ramp_i18n.py && python3 tooling/check_i18n.py && python3 tooling/check_rot.py && bash tooling/check_types.sh && node --check <every touched file>`
Expected: all green.

- [ ] **Step 3: Visual audit** — `python3 -m http.server` on vanilla + `tooling/visual/shot.mjs` + `probe-market-band-edges.mjs` / `probe-desk-map-colors.mjs` captures of all four maps; human theme flip ×3 (accent-tracked blue, readable grey, no cached hex). If headless browsers unavailable, record the exact manual shot list in the parity note instead of fabricating it.

- [ ] **Step 4: Commit**

```bash
git add tooling/add_edge_ramp_i18n.py vanilla/locales/ docs/parity/edge-volume-ramp.md
git commit -m "chore(ramp): i18n keys + parity note, gates green"
```
