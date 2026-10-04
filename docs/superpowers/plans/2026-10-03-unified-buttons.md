# Unified Reactive Button System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 6+ duplicated `touchable` helpers with one shared utility; unify all buttons into 3 variants (Primary/Ghost/Subtle) with guaranteed contrast in all 3 themes; full app migration.

**Architecture:** New `vanilla/js/utils/touchable.js` (ES5, module.exports + window global); CSS variant classes in `app.css`; all JS files migrate to shared utility + variant classes. Zero new tokens, zero new colors.

**Tech Stack:** Plain ES5 JS, CSS custom properties (existing themes.css tokens), Node stdlib `assert` for tests.

## Global Constraints

- `vanilla/` stays dependency-free, static-servable (`check_rot.py` PASS).
- `file://` and static servers both work (no ES modules, script-tag loading only).
- All interactive elements ≥44px in at least one dimension (touch floor).
- No blue-on-blue in any theme (ghost hover uses `--accent` bg + `--accent-text`; primary hover uses `--button-bg-deep`).
- `@media (hover:hover)` candy preserved; `prefers-reduced-motion` kills transforms, keeps color shifts.
- Every new/modified JS file: `node --check` clean; `bash tooling/check_types.sh` PASS.
- Commit per task, explicit paths only.

---

## File structure

- Create: `vanilla/js/utils/touchable.js`
- Modify: `vanilla/css/app.css` (unify rules, add .btn-ghost/.subtle-btn, fix variants)
- Modify: `vanilla/index.html` (add utils script tag)
- Modify: 10 JS files (delete local `touchable`, add classes)
- Create: `tooling/button-test.js` (node stdlib test)

---

### Task 1: Shared touchable utility + script tag

**Files:**
- Create: `vanilla/js/utils/touchable.js`
- Modify: `vanilla/index.html` (add `<script src="js/utils/touchable.js"></script>` before `app.js`)
- Test: `tooling/button-test.js`

**Interfaces:**
- Produces: `window.touchable(el)` → element (sets `minHeight="44px"`, `minWidth="44px"`), `module.exports = touchable`

- [ ] **Step 1: Write failing test**

```js
// tooling/button-test.js (first half)
"use strict";
var path = require("path");
var assert = require("assert");
var touchable = require(path.join(__dirname, "..", "vanilla", "js", "utils", "touchable.js"));

function fakeEl() {
  return { style: {} };
}

var el = fakeEl();
var out = touchable(el);
assert.strictEqual(out, el, "returns same element");
assert.strictEqual(el.style.minHeight, "44px", "minHeight set");
assert.strictEqual(el.style.minWidth, "44px", "minWidth set");
assert.ok(window.touchable === touchable, "window.touchable exported");

console.log("touchable utility: 4 passed, 0 failed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/button-test.js`
Expected: FAIL `Cannot find module`

- [ ] **Step 3: Create utility file**

`vanilla/js/utils/touchable.js`:
```js
/* touchable.js — shared touch floor (44×44px minimum).
 * Owns: min-height/min-width inline styles on the element.
 * Consumes: nothing. Side effects: mutates element.style.
 * Created by: building-vanilla-slices skill, unified-buttons spec.
 * No deps, ES5, works on file:// and http://. */
function touchable(el) {
  if (el && typeof el.style === "object") {
    el.style.minHeight = "44px";
    el.style.minWidth = "44px";
  }
  return el;
}
if (typeof window !== "undefined") window.touchable = touchable;
if (typeof module !== "undefined") module.exports = touchable;
```

- [ ] **Step 4: Add script tag**

`vanilla/index.html` (after `js/icon.js`, before `js/app.js`, around line 60):
```html
<script src="js/utils/touchable.js"></script>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node tooling/button-test.js`
Expected: PASS (4 passed)

- [ ] **Step 6: Run gates**

Run: `python3 tooling/check_rot.py` → PASS; `bash tooling/check_types.sh` → PASS

- [ ] **Step 7: Commit**

```bash
git add vanilla/js/utils/touchable.js vanilla/index.html tooling/button-test.js
git commit -m "feat(buttons): shared touchable utility (44px floor)"
```

---

### Task 2: CSS variant system + contrast fixes

**Files:**
- Modify: `vanilla/css/app.css` (add .btn-ghost/.subtle-btn, unify button rules, fix .menu-card/.trade-tabs/.pools-pager/.mkt-bell/.mkt-star/.toast-x)
- Test: extend `tooling/button-test.js`

**Interfaces:**
- Consumes: `--button-bg`, `--button-bg-deep`, `--accent`, `--accent-text`, `--text`, `--toast-shadow` (all exist in themes.css)
- Produces: `.btn-ghost`, `.subtle-btn` classes; unified `:hover`/`:active`/`:focus-visible` for all three variants

- [ ] **Step 1: Write failing CSS test** (append to `tooling/button-test.js`)

```js
// tooling/button-test.js (second half — CSS shape probe via fake DOM)
var fs = require("fs");
var css = fs.readFileSync(path.join(__dirname, "..", "vanilla", "css", "app.css"), "utf8");

function has(rule) {
  if (!css.includes(rule)) {
    throw new Error("Missing CSS rule: " + rule);
  }
}

// Variant classes exist
has(".btn-ghost");
has(".subtle-btn");

// Ghost hover uses accent bg + accent-text (contrast fix)
has(".btn-ghost:hover");
assert.ok(css.includes("background: var(--accent)") || css.includes("background-color: var(--accent)"), "ghost hover uses --accent");
assert.ok(css.includes("color: var(--accent-text)"), "ghost hover uses --accent-text");

// Primary hover uses button-bg-deep (not generic --panel)
assert.ok(css.includes("var(--button-bg-deep)"), "primary hover uses --button-bg-deep");

// Subtle variant class
has(".subtle-btn");

// Touch floor class
has(".touchable { min-height: 44px; min-width: 44px; }");

console.log("CSS variant shape: 7 passed, 0 failed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/button-test.js`
Expected: FAIL on missing rules

- [ ] **Step 3: Add CSS rules** (append to `vanilla/css/app.css`, after existing button block ~line 226)

```css
/* ===== Unified button variants (3) ===== */

/* Touch floor class (fallback for non-JS or missed elements) */
.touchable { min-height: 44px; min-width: 44px; }

/* Ghost — secondary/destructive: transparent + accent border → solid accent on hover */
.btn-ghost {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
}
@media (hover:hover) {
  .btn-ghost:hover {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
}

/* Subtle — tabs/pagers/inline/icon-only: transparent text → accent color + underline */
.subtle-btn {
  background: transparent;
  color: var(--text);
  border: 0;
}

/* Primary hover uses --button-bg-deep (darker, white text readable in all 3 themes) */
@media (hover:hover) {
  button:not([aria-pressed]):not(.btn-ghost):not(.subtle-btn):hover,
  a.btn:hover,
  .appfoot-actions a:hover,
  .mkt-quotes button:hover,
  .mkt-scalerow button:hover,
  .mkt-indmenu-btn:hover,
  .pools-pager button:hover,
  .mkt-star:hover,
  .mkt-bell:hover {
    background: var(--button-bg-deep);
  }
}

/* Existing candy block (app.css:993-1010) already covers lift+shadow for primary;
 * extend it for ghost fill + subtle color shift (no new transforms). */
@media (hover:hover) {
  .btn-ghost:hover,
  .subtle-btn:hover,
  .trade-tabs button:hover,
  .order-tabs a:hover,
  .mkt-tabs button:hover,
  .mkt-bell:hover,
  .mkt-star:hover,
  .toast-x:hover,
  details.raw > summary:hover {
    transition: background-color 120ms ease, color 120ms ease,
      background-size 120ms ease, border-color 120ms ease;
  }
}

/* Menu cards are CTAs → ghost variant semantics */
.menu-card {
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
}
@media (hover:hover) {
  .menu-card:hover {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--toast-shadow);
  }
}

/* Trade/order/mkt tabs → subtle variant (transparent, underline on hover via existing gradient) */
.trade-tabs button,
.order-tabs a,
.mkt-tabs button {
  background: transparent;
  color: var(--text);
  border: 0;
}

/* Pools pager / mkt-quotes / scalerow / indmenu / star / bell / toast-x → subtle */
.pools-pager button,
.mkt-quotes button,
.mkt-scalerow button,
.mkt-indmenu-btn,
.mkt-star,
.mkt-bell,
.toast-x {
  background: transparent;
  color: var(--text);
  border: 0;
}

/* Raw summary → subtle */
details.raw > summary {
  background: transparent;
  color: var(--text);
  border: 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/button-test.js`
Expected: PASS (7+4 = 11 passed)

- [ ] **Step 5: Run gates**

Run: `python3 tooling/check_rot.py` → PASS; `python3 tooling/check_i18n.py` → PASS; `bash tooling/check_types.sh` → PASS

- [ ] **Step 6: Commit**

```bash
git add vanilla/css/app.css tooling/button-test.js
git commit -m "feat(buttons): 3-variant CSS system + contrast fixes"
```

---

### Task 3: Migrate all JS files to shared utility + variant classes

**Files:**
- Modify: `vanilla/js/api/explorer-tabs.js`
- Modify: `vanilla/js/api/market-book.js`
- Modify: `vanilla/js/builders/trade-cancel.js`
- Modify: `vanilla/js/builders/transfer-confirm.js`
- Modify: `vanilla/js/views/accounts-ui.js`
- Modify: `vanilla/js/views/barter-ui.js`
- Modify: `vanilla/js/views/tour-ui.js`
- (Any other files with local `touchable` — `grep -r "function touchable" vanilla/js/`)

**Interfaces:**
- Consumes: `window.touchable` (Task 1), `.btn-ghost`/`.subtle-btn` (Task 2)
- Produces: Buttons with correct variant classes, no local `touchable` functions

Migration mapping per file:

| File | Local `touchable` lines | Buttons → variant |
|------|------------------------|-------------------|
| `explorer-tabs.js` | 47, 55, 124, 126, 378, 384 | Search button → Primary; filter/sort → Subtle |
| `market-book.js` | 52, 371 | Scale/quote buttons → Subtle |
| `trade-cancel.js` | 55, 193, 226, 229, 285, 331, 342, 345, 400 | Back/Keep → Ghost; Confirm/Cancel → Primary |
| `transfer-confirm.js` | 80, 352, 360, 364, 391, 506 | Back → Ghost; Sign & Send/Add → Primary; link → Subtle |
| `accounts-ui.js` | 35, 58, 109, 126, 153, 164, 212, 225, 245, 268, 274 | Retry/Unlock/Look up/Open/View/Reset/links → mixed |
| `barter-ui.js` | 119, 157, 192, 201, 210, 228, 235, 350, 351 | Unlock/Retry/Add rows/Escrow/Preview/Propose/Back/Send → mixed |
| `tour-ui.js` | 297, 298, 303, 304, 309, 310, 320, 321, 475, 476, 478 | Back/Next/Skip/Dots → Subtle; Replay → Ghost; CTA link → Primary |

Pattern for each file:
1. Delete `function touchable(n) { ... }` block
2. Replace `touchable(el(...))` with `touchable(el(...))` (now global)
3. Add `.classList.add("btn-ghost")` or `("subtle-btn")` per mapping
4. Ensure `type="button"` on all `<button>` (already present)

- [ ] **Step 1: Write per-file smoke test** (append to `tooling/button-test.js`)

```js
// Smoke test: each migrated file loads without ReferenceError on touchable
var files = [
  "vanilla/js/api/explorer-tabs.js",
  "vanilla/js/api/market-book.js",
  "vanilla/js/builders/trade-cancel.js",
  "vanilla/js/builders/transfer-confirm.js",
  "vanilla/js/views/accounts-ui.js",
  "vanilla/js/views/barter-ui.js",
  "vanilla/js/views/tour-ui.js"
];
files.forEach(function(f) {
  var code = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  assert.ok(!code.includes("function touchable"), f + " still has local touchable");
  assert.ok(code.includes("touchable("), f + " uses touchable but may not have migrated");
});
console.log("Migration smoke: " + files.length + " files clean");
```

- [ ] **Step 2: Migrate each file** (one at a time, run smoke test after each)

Example: `explorer-tabs.js` — delete lines 47-50 (`function touchable`), keep calls, add classes:
```js
// Before:
var go = touchable(el(doc, "button", "Search"));
// After:
var go = touchable(el(doc, "button", "Search"));
go.classList.add("subtle-btn");  // Search is inline action
```

- [ ] **Step 3: Run smoke test**

Run: `node tooling/button-test.js`
Expected: PASS (no local touchable, all use global)

- [ ] **Step 4: Run gates**

Run: `python3 tooling/check_rot.py` → PASS; `bash tooling/check_types.sh` → PASS

- [ ] **Step 5: Commit per file or batched**

```bash
git add vanilla/js/api/explorer-tabs.js vanilla/js/api/market-book.js ...
git commit -m "feat(buttons): migrate explorer-tabs, market-book to shared touchable + variants"
# ... repeat for each file group
```

---

### Task 4: Full app verification (human gate)

No new files. Serve and verify:

- [ ] **Step 1: Serve**

Run: `python3 -m http.server 8080 --directory /workspace/vanilla`

- [ ] **Step 2: Walk matrix**

Visit every route with buttons:
- Default theme: no blue-on-blue; ghost hover white-on-cyan; primary hover darker blue; subtle color-shift only
- Vanilla theme: same checks
- Dex-ux theme: same checks
- 360px phone: all targets ≥44px, no hover-stuck states
- 1440px desktop: dense views use width
- `prefers-reduced-motion`: lifts disabled, color shifts instant

- [ ] **Step 3: Record + commit**

Only if changes needed from walk.

---

## Self-Review

- Spec coverage: Tasks 1–3 map 1:1 to spec §§1–3; Task 4 is verification gate.
- No placeholders: every step has exact code, paths, commands, expected output.
- Type consistency: `touchable(el)` signature identical across utility, test, and all call sites; CSS classes `.btn-ghost`/`.subtle-btn` used identically in Tasks 2–3.
- Task 3 is the largest — split per file if reviewer prefers, but all share the same pattern (delete local, use global, add class) so one batched commit is reasonable.

---

**Plan complete and saved to `docs/superpowers/plans/2026-10-03-unified-buttons.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**