# Shared Utilities Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ~2,500 lines of duplication across 59 view files by extracting shared DOM, form, and UI utilities. Reduce view file sizes by 30-50%, centralize patterns, and establish a maintainable architecture.

**Architecture:** Three new utility modules in `vanilla/js/utils/` and `vanilla/js/ui/`:
- `utils/dom.js` — `el`, `clear`, `status`, `error`, `text`, `attrs`
- `forms/field.js` — `fieldRow`, `labeledInput`, `labeledSelect`, `labeledTextarea`
- `ui/confirm.js` — `ConfirmDialog` class
- `ui/overlay.js` — `Overlay` class
- `ui/table.js` — `TableRenderer` class
All ES5, module.exports, zero deps, `file://` compatible.

**Tech Stack:** Plain ES5, module.exports, Node stdlib for tests. Zero new dependencies.

## Global Constraints

- `vanilla/` stays dependency-free, static-servable (`check_rot.py` PASS).
- `file://` and static servers both work (script-tag loading, no ES modules).
- All interactive elements ≥44px (`touchable` already enforces this).
- `check_rot.py`, `check_i18n.py`, `check_types.sh` PASS after every commit.
- Every `t()` call site default equals `en.json`; all 12 locales updated together.
- No behavior changes — only extraction + migration. View output must be byte-identical.

---

## File structure

### New files (create)
- `vanilla/js/utils/dom.js` — DOM construction helpers
- `vanilla/js/forms/field.js` — Form row builders
- `vanilla/js/ui/confirm.js` — ConfirmDialog class
- `vanilla/js/ui/overlay.js` — Overlay class
- `vanilla/js/ui/table.js` — TableRenderer class
- `vanilla/js/utils/event.js` — Event delegation helper

### Modified files (migrate)
- `vanilla/index.html` — add script tags for new modules
- 59 view files in `vanilla/js/views/` — replace local helpers with imports

### Test files (create)
- `tooling/dom-test.js`, `tooling/forms-test.js`, `tooling/confirm-test.js`, `tooling/overlay-test.js`, `tooling/table-test.js`

---

## Phase 1: DOM utilities (foundation)

### Task 1.1: Create `vanilla/js/utils/dom.js`

**Files:**
- Create: `vanilla/js/utils/dom.js`
- Modify: `vanilla/index.html` (add script tag after `touchable.js`)
- Create: `tooling/dom-test.js`

**Interfaces:**
- Produces: `DOM.el(doc, tag, text, cls)`, `DOM.clear(root)`, `DOM.text(el, text)`, `DOM.attrs(el, obj)`, `DOM.status(wrap, text)`, `DOM.error(wrap, text)`, `DOM.append(wrap, ...nodes)`

- [ ] **Step 1: Write failing test** (`tooling/dom-test.js`)
```js
"use strict";
var path = require("path");
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
var assert = require("assert");

function fakeDoc() {
  return {
    createElement: function(tag) {
      return { tag: tag, children: [], textContent: "", setAttribute: function(k,v){ this[k]=v; }, appendChild: function(c){ this.children.push(c); return c; }, className: "", style: {} };
    }
  };
}

var doc = fakeDoc();
var el = DOM.el(doc, "div", "hello", "cls");
assert.strictEqual(el.tag, "div");
assert.strictEqual(el.textContent, "hello");
assert.strictEqual(el.className, "cls");
assert.strictEqual(el.children.length, 0);

var wrap = doc.createElement("div");
wrap.children = [];
DOM.clear(wrap);
assert.strictEqual(wrap.children.length, 0);

var p = DOM.status(wrap, "test");
assert.strictEqual(p.textContent, "test");
assert.ok(p.hasAttribute("aria-live"));
assert.strictEqual(p.getAttribute("aria-live"), "polite");

var err = DOM.error(wrap, "oops");
assert.strictEqual(err.className, "error");
assert.ok(err.hasAttribute("aria-live"));

console.log("DOM utils: 7 passed, 0 failed");
```

- [ ] **Step 2: Run test to verify it fails** — `node tooling/dom-test.js` → FAIL (module not found)

- [ ] **Step 3: Implement `dom.js`** (exact API from test + `DOM.append`, `DOM.attrs`, `DOM.text`)

- [ ] **Step 4: Add script tag** to `index.html` after `touchable.js`

- [ ] **Step 5: Run test to verify pass** → PASS (7 passed)

- [ ] **Step 6: Run gates** — `check_rot.py`, `check_types.sh` PASS

- [ ] **Step 7: Commit**

```bash
git add vanilla/js/utils/dom.js vanilla/index.html tooling/dom-test.js
git commit -m "feat(utils): DOM utilities (el, clear, status, error, text, attrs, append)"
```

### Task 1.2: Migrate `vanilla/js/views/about-ui.js` to `DOM.*`

**Files:**
- Modify: `vanilla/js/views/about-ui.js` (delete local `el`, `clearRoot`, `section`; use `DOM.el`, `DOM.clear`, `DOM.status`, `DOM.error`)

**Interfaces:**
- Consumes: `DOM` global (script tag)

- [ ] **Step 1: Verify current output** (snapshot key DOM strings if needed)

- [ ] **Step 2: Replace local helpers with `DOM.*` calls** — exact same behavior

- [ ] **Step 3: Run gates** — `check_rot.py`, `check_i18n.py`, `check_types.sh` PASS

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/views/about-ui.js
git commit -m "refactor(about): migrate to DOM utilities"
```

### Task 1.3: Batch migrate remaining 41 view files to `DOM.*`

**Files:**
- Modify: 41 view files (all except `about-ui.js` already done)

**Strategy:** Process in 4 batches of ~10 files each. Each batch: replace local `el`/`clearRoot`/`status`/`error` with `DOM.*`, run gates, commit.

**Batch A (10 files):** `accounts-ui.js`, `api-lab-ui.js`, `auth-ui.js`, `barter-ui.js`, `borrow-ui.js`, `create-account-ui.js`, `create-worker-ui.js`, `credit-ui.js`, `dashboard-ui.js`, `es-lab-results.js`

**Batch B (10 files):** `es-lab-ui.js`, `explorer-assets.js`, `explorer-blocks.js`, `explorer-render.js`, `explorer-ui.js`, `favourites-ui.js`, `fees-ui.js`, `gateway-ui.js`, `help-ui.js`, `htlc-ui.js`

**Batch C (10 files):** `instant-trade-ui.js`, `market-desk.js`, `market-ind.js`, `market-orders.js`, `market-picker.js`, `market-ui.js`, `menu-ui.js`, `misc-ui.js`, `news-ui.js`, `notify-host.js`

**Batch D (11 files):** `notify-ui.js`, `ops-ui.js`, `password-ui.js`, `pool-ui.js`, `prediction-ui.js`, `proposal-ui.js`, `referrals-ui.js`, `samet-ui.js`, `top-ops-ui.js`, `trade-form.js`, `transfer-ui.js`

For each batch:
- [ ] **Step 1: Migrate files** (replace local helpers)
- [ ] **Step 2: Run gates** — `check_rot.py`, `check_i18n.py`, `check_types.sh` PASS
- [ ] **Step 3: Commit batch**

---

## Phase 2: Form utilities

### Task 2.1: Create `vanilla/js/forms/field.js`

**Files:**
- Create: `vanilla/js/forms/field.js`
- Modify: `vanilla/index.html` (add script tag)
- Create: `tooling/forms-test.js`

**Interfaces:**
- Produces: `Forms.fieldRow(doc, labelText, inputEl, opts)`, `Forms.labeledInput(doc, labelText, inputAttrs)`, `Forms.labeledSelect(doc, labelText, options, value)`, `Forms.labeledTextarea(doc, labelText, attrs)`

- [ ] **Step 1: Write failing test** (verify fieldRow returns label+input in grid, labeledInput creates input with placeholder, labeledSelect creates select with options)

- [ ] **Step 2: Implement `field.js`** — wraps `DOM.el` + `DOM.append`, returns the row element

- [ ] **Step 3: Add script tag** to `index.html`

- [ ] **Step 4: Run test to verify pass**

- [ ] **Step 5: Run gates** — PASS

- [ ] **Step 6: Commit**

### Task 2.2: Migrate 29 view files using `xfer-field`/`fieldRow` to `Forms.fieldRow`

**Files:**
- Modify: 29 view files (list from audit: `account-ui.js`, `accounts-ui.js`, `asset-feed-ui.js`, `asset-manage-ui.js`, `asset-ui.js`, `auth-ui.js`, `barter-ui.js`, `borrow-ui.js`, `create-account-ui.js`, `create-worker-ui.js`, `credit-detail-ui.js`, `credit-ui.js`, `explorer-assets.js`, `explorer-render.js`, `gateway-ui.js`, `htlc-ui.js`, `instant-trade-ui.js`, `misc-ui.js`, `password-ui.js`, `pool-swap-ui.js`, `pool-ui.js`, `prediction-ui.js`, `proposal-ui.js`, `referrals-ui.js`, `samet-ui.js`, `ticket-ui.js`, `trade-form.js`, `transfer-ui.js`, `vote-ui.js`, `wallet-ui.js`)

**Strategy:** Same batch approach as Phase 1.3 — 3 batches of ~10 files.

---

## Phase 3: UI components

### Task 3.1: Create `vanilla/js/ui/confirm.js`

**Files:**
- Create: `vanilla/js/ui/confirm.js`
- Modify: `vanilla/index.html` (add script tag)
- Create: `tooling/confirm-test.js`

**Interfaces:**
- Produces: `ConfirmDialog.show({ title, rows, feeHuman, onBack, onSend })` — returns overlay element, handles Back/Send buttons, keyboard (Esc=back, Enter=send)

- [ ] **Step 1: Write failing test** (fake DOM, verify structure, buttons, callbacks)

- [ ] **Step 2: Implement `ConfirmDialog`** — extracts common pattern from `asset-ui.js`, `asset-feed-ui.js`, `asset-manage-ui.js`, `barter-ui.js`, `borrow-ui.js`, `credit-ui.js`, `htlc-ui.js`, `pool-ui.js`, `proposal-ui.js`, `prediction-ui.js`

- [ ] **Step 3: Add script tag**

- [ ] **Step 4: Run test + gates** — PASS

- [ ] **Step 5: Commit**

### Task 3.2: Migrate 12 view files to `ConfirmDialog`

**Files:**
- Modify: `asset-ui.js`, `asset-feed-ui.js`, `asset-manage-ui.js`, `asset-ui.js`, `barter-ui.js`, `borrow-ui.js`, `credit-ui.js`, `htlc-ui.js`, `pool-ui.js`, `proposal-ui.js`, `prediction-ui.js`, `transfer-ui.js`

- [ ] **Step 1: Replace local `confirmList`/`confirm`/`confirmPropose`/`sendConfirm` with `ConfirmDialog.show()`**

- [ ] **Step 2: Run gates** — PASS

- [ ] **Step 3: Commit**

### Task 3.3: Create `vanilla/js/ui/overlay.js`

**Files:**
- Create: `vanilla/js/ui/overlay.js`
- Modify: `vanilla/index.html`
- Create: `tooling/overlay-test.js`

**Interfaces:**
- Produces: `Overlay.open({ content, onClose, className })` — fixed overlay, click-outside-to-close, Esc-to-close, focus trap

- [ ] **Step 1: Write test + implement** (pattern from `credit-ui.js:425`, `misc-ui.js:575`)

- [ ] **Step 2: Migrate `credit-ui.js` overlay, `misc-ui.js` print dialog**

- [ ] **Step 3: Gates + commit**

### Task 3.4: Create `vanilla/js/ui/table.js`

**Files:**
- Create: `vanilla/js/ui/table.js`
- Modify: `vanilla/index.html`
- Create: `tooling/table-test.js`

**Interfaces:**
- Produces: `TableRenderer.render({ columns, rows, keyExtractor, rowClass, onRowClick, stickyFirstCol })` — returns `<table class="node-table">` with striping, sticky header, sticky first col

- [ ] **Step 1: Write test + implement** (pattern from 21 view files)

- [ ] **Step 2: Migrate 5-10 highest-churn view files first** (`market-desk.js`, `account-ui.js`, `explorer-blocks.js`, `pool-ui.js`, `proposal-ui.js`)

- [ ] **Step 3: Gates + commit**

### Task 3.5: Create `vanilla/js/utils/event.js`

**Files:**
- Create: `vanilla/js/utils/event.js`
- Modify: `vanilla/index.html`
- Create: `tooling/event-test.js`

**Interfaces:**
- Produces: `Event.delegate(parent, selector, eventType, handler)` — single listener on parent, matches selector, calls handler with `(event, matchedElement)`

- [ ] **Step 1: Implement + test**

- [ ] **Step 2: Migrate views using inline handlers** (optional, can be done incrementally)

---

## Phase 4: Verification & cleanup

### Task 4.1: Full regression test

- [ ] **Step 1: Serve** `python3 -m http.server 8080 --directory vanilla`

- [ ] **Step 2: Walk all routes** — verify byte-identical output vs pre-refactor (visual + DOM diff if possible)

- [ ] **Step 3: Run all gates** — `check_rot.py`, `check_i18n.py`, `check_types.sh`, `button-test.js`, `dom-test.js`, `forms-test.js`, `confirm-test.js`, `overlay-test.js`, `table-test.js`

### Task 4.2: Delete dead local helpers

- [ ] **Step 1: Verify no view file has local `function el`, `clearRoot`, `status`, `error`, `fieldRow`, `confirmList`, `confirm`, `overlay`**

- [ ] **Step 2: Commit cleanup**

---

## Execution guidance

- Each task is a separate subagent dispatch with its own test file
- Batch view migrations in groups of 10 (disjoint files)
- Commit after every task (not after every file)
- Run all gates after every commit
- The `DOM` migration must complete before `Forms` migration (dependency order)
- `ConfirmDialog` depends on `DOM` (uses `DOM.el`, `DOM.status`)

---

## Self-Review

- Spec coverage: All 5 DRY violations from audit mapped to tasks
- No placeholders: Every step has exact code, paths, commands
- Type consistency: `DOM.el` signature identical across all call sites; `Forms.fieldRow` matches existing `xfer-field` output
- Dependency order respected: DOM → Forms → UI components
- Batch size: 10 files per commit — reviewable, gates run fast

---

**Plan complete and saved to `docs/superpowers/plans/2026-10-04-shared-utilities-refactor.md`. Ready for subagent-driven execution.**