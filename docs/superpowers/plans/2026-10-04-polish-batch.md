# Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 7 tester-report polish items as independent slices with per-item proof.

**Architecture:** Seven independent tasks, no shared code between them (one task's revert must not break another). CSS tasks stay CSS-only; JS tasks follow existing in-file patterns (`sortTh`, `poolTable` pager, `Icon.img`).

**Tech Stack:** Vanilla JS/CSS, Node stdlib tests, Python gates.

## Global Constraints

- Zero runtime dependencies in `vanilla/` (`python3 tooling/check_rot.py` green).
- Theme tokens only, no hardcoded colors outside `themes.css`.
- All targets ≥44px; no hover-dependent UI.
- Every new user-visible string via `t(key, default)` with keys in all 12 locales (`python3 tooling/check_i18n.py` green).
- JSDoc on touched seams; `bash tooling/check_types.sh` green.
- Never edit `reference/`; no TODO/FIXME markers.
- Frequent commits (one per task minimum).

---

### Task 1: Desk alignment (buy/sell + depth)

**Files:**
- Modify: `vanilla/css/app.css` (legacy `.mkt` grid areas ~line 384-388), `vanilla/css/desk-grid.css` (sole grid source)
- Test: screenshot pixel-diff at 1440px (headless `tooling/visual/shot.mjs` aid; human browser pass is the gate)

**Interfaces:** Consumes: nothing (CSS only). Produces: one grid definition.

- [ ] **Step 1: Confirm the competing definitions**

Run: `grep -n "grid-template-areas" vanilla/css/app.css vanilla/css/desk-grid.css`
Expected: two competing `.mkt` area maps (the bug — later file wins by accident, not design).

- [ ] **Step 2: Unify**

Delete the legacy `.mkt` areas block in `app.css`; keep `desk-grid.css` as the sole source. Equal-height panel headers (one shared `h2` margin/line-height rule for `.mkt-buy`/`.mkt-sell`), and one `--desk-row-h` token consumed by both depth canvases instead of estimated values.

- [ ] **Step 3: Verify + commit**

Human/headless screenshot at 1440px: buy/sell tops level, depth charts aligned. Then:

```bash
python3 tooling/check_rot.py && bash tooling/check_types.sh
git add vanilla/css/app.css vanilla/css/desk-grid.css
git commit -m "fix(desk): single grid source, level buy/sell + depth alignment"
```

---

### Task 2: Fees width cap

**Files:**
- Modify: `vanilla/css/app.css` (fees wrap rule; `fees-ui.js` uses plain `.wrap`)
- Test: screenshot 1440px

- [ ] **Step 1: Scope the rule so only fees narrows**

Add a fees-scoped selector (e.g. `.fees-view .wrap { max-width: min(70vw, 1080px); margin-inline: auto; }`) — do NOT change the global `.wrap` both dense and narrow pages share. Confirm the view root class in `fees-ui.js` first (`rg -n "fees-view|wrap" vanilla/js/views/fees-ui.js`).

- [ ] **Step 2: Verify + commit**

Screenshots 1440px + 390px × 3 themes (no overflow, no stranded column).

```bash
git add vanilla/css/app.css
git commit -m "fix(fees): cap content width at ~70vw"
```

---

### Task 3: Committee name-cards

**Files:**
- Modify: `vanilla/js/api/explorer-tabs.js` (`memberTab`, ~lines 159-201)
- Test: existing explorer suites + screenshot

- [ ] **Step 1: Reuse the card fallback**

`memberTab` builds a table; mirror the `deskTable`/`poolTable` pattern used elsewhere (table + `.node-cards` fallback from the same rows, `node-cards` visible <560px per existing CSS). No new component, no new CSS (reuse `.node-table`/`.node-card`).

- [ ] **Step 2: Verify + commit**

Run: `node tooling/explorer-blocks-ago-test.js` (or nearest explorer suite) + screenshots both widths.

```bash
git add vanilla/js/api/explorer-tabs.js
git commit -m "feat(explore): committee name-cards via shared card fallback"
```

---

### Task 4: Account action icons

**Files:**
- Modify: `vanilla/js/views/account-ui.js` (`actionLinks`, ~line 223-244 — 5 text anchors joined by `" | "`)
- Test: screenshot + keyboard walkthrough (links stay links)

- [ ] **Step 1: Prepend glyphs, keep text**

```js
var ICONS = { SEND: "transfer", DEPOSIT: "deposit", TRADE: "trade", BORROW: "borrow", SETTLE: "settle" };
```

Verify each name with `Icon.known(name)` guard at runtime (unknown → text-only, never blank). Use `Icon.img(name, "nav-icon", "")` — themed by the existing `.icon-img` filter. Icon+text always, never icon-only.

- [ ] **Step 2: Verify + commit**

Screenshots 390px + 1440px × 3 themes (glyphs match surrounding text color in all themes).

```bash
git add vanilla/js/views/account-ui.js
git commit -m "feat(account): icons alongside SEND/DEPOSIT/TRADE/BORROW/SETTLE"
```

---

### Task 5: Portfolio sorting

**Files:**
- Modify: `vanilla/js/views/account-ui.js` (portfolio `draw()`, ~lines 464-488 — static `thead`, `list.map(rowFor)` chain order)
- Test: new vectors in anResolvers? No — DOM vectors: extend the nearest account suite or add `tooling/account-sort-test.js` with a fake-doc row sort check

**Interfaces:** Follow `explorer-assets.js:582-600` `sortTh(key,label)` exactly (click toggles, `aria-sort`, `sortDir`).

- [ ] **Step 1: Write the failing test**

```js
// tooling/account-sort-test.js — replicate sortTh contract on portfolio keys:
// sortKey null (chain order) default; click asset -> alpha; click again -> reverse.
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tooling/account-sort-test.js`
Expected: FAIL (no sortTh in portfolio).

- [ ] **Step 3: Implement sortable Asset/Qty/Price/Value headers**

Sortable: Asset (symbol alpha), Qty (numeric on raw), Price, Value (numeric, dashed-last). Default `sortKey = null` = today's chain order. Reuse existing header i18n keys (no new strings).

- [ ] **Step 4: Verify + commit**

```bash
node tooling/account-sort-test.js && bash tooling/check_types.sh
git add vanilla/js/views/account-ui.js tooling/account-sort-test.js
git commit -m "feat(account): sortable portfolio columns (asset/qty/price/value)"
```

---

### Task 6: Asset price paging (replaces first-20 cap)

**Files:**
- Modify: `vanilla/js/views/account-ui.js` (`enrichPortfolio`, ~lines 258-360 — 20-cap at line 338, notice at 452-457)
- Test: vectors for pager math (page bounds, partial last page)

- [ ] **Step 1: Write the failing test**

Pager over the balance list: page size 25, `pageCount = ceil(n/25)`, out-of-range page clamps, priced set = current page's ids only. Pure-function vectors (no Chain needed).

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL (cap-at-20 exists, no pager).

- [ ] **Step 3: Implement**

Replace the slice-at-20 with per-page pricing (25/page): price only current page's asset ids (same bounded-burst code, different input slice), keep the honest notice updated ("Prices cover this page — …"), Prev/Next pager reusing the `.pools-pager`/`subtle-btn` pattern. No N+1 (one batch per page turn).

- [ ] **Step 4: Verify + commit**

```bash
node tooling/account-sort-test.js && bash tooling/check_types.sh
git add vanilla/js/views/account-ui.js
git commit -m "feat(account): page portfolio price batches instead of first-20 cap"
```

---

### Task 7: Explorer-assets filter memory + honesty label

**Files:**
- Modify: `vanilla/js/views/explorer-assets.js` (`assetState`, ~lines 67-83; mode radios ~401-442)
- Test: state vectors (restore/default/clamp unknown mode)

- [ ] **Step 1: Write the failing test**

Session-memory (module-level, never `localStorage` — view state, not settings): last mode persists across re-renders within the session; unknown stored value falls back to `market`; first paint defaults `market` (today's behavior).

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL (mode always resets to `market`).

- [ ] **Step 3: Implement**

Persist `assetState.mode` across renders (module-level already is — keep it, just stop resetting on entry); add an honest label line above the table (`Showing: SmartCoins/User-Issued/Prediction — …`, new keys via one-shot script + `check_i18n.py`).

- [ ] **Step 4: Verify + commit**

```bash
python3 tooling/check_i18n.py && bash tooling/check_types.sh
git add vanilla/js/views/explorer-assets.js tooling/add_explorer_filter_i18n.py vanilla/locales/*.json
git commit -m "feat(explore): remember asset filter per session + honest showing-line"
```
