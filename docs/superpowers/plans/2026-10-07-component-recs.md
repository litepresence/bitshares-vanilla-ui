# Component-Recs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 10 component-wisdom audit recommendations across `vanilla/js/views/`, `vanilla/css/`, and `vanilla/locales/`.

**Architecture:** No new files except none; every change binds to existing shared globals (`DOM`, `Forms`, `ConfirmDialog`, `Overlay`, `TableRenderer`, `Event`, `touchable`) and `themes.css` tokens. Retro styling untouched except recs 3/5/9, which add controls in existing tokens with before/after notes in `docs/parity/component-audit.md`.

**Tech Stack:** Vanilla JS (ES5, classic script tags), vanilla CSS custom properties, JSON locales. No build, no packages.

## Global Constraints

- ZERO new dependencies: no `package.json`, no `node_modules`, no CDN `<script src>`, no framework imports. Every task must pass `python3 tooling/check_rot.py`.
- No local copies of shared helpers: no `function el/clearRoot/showStatus/confirmList/fieldRow/touchable` in views; use globals via script-tag order.
- Money math only in `vanilla/js/api/format.js`; no `Math.pow(10` elsewhere.
- Every new user-visible string: `t("ns.key", "English default")` with byte-identical default in `en.json` (nested), plus honest English stubs in the other 11 `vanilla/locales/*.json`. Must pass `python3 tooling/check_i18n.py`.
- JSDoc on touched seams; must pass `bash tooling/check_types.sh`.
- Every touched JS file must pass `node --check`.
- Touch targets ≥44px one dimension; no hover-only UI; `inputmode="decimal"` on amounts; theme tokens only.
- Testnet sign/broadcast + screenshots are HUMAN follow-up (no live keys in this session); code-evidence + gates are this plan's verification.

---

### Task 1: Transfer asset Combobox (Rec 1, HIGH)

**Files:**
- Modify: `vanilla/js/views/transfer-ui.js` (`swapAssetToSelect`, comments at :487-491, :934, :944-948)

**Interfaces:**
- Consumes: `assetF` ({row, input} from `Forms.labeledInput`), `bals` (array of {symbol}), `assetVal()`, `bindAssetEvents()`, `refreshFeeOpts/Avail/updateGate`.
- Produces: stable INPUT + `<datalist id="xfer-asset-list">`; no caller changes (all readers use `.value` at event time).

- [ ] **Step 1: Replace swap with datalist fill.** Replace `swapAssetToSelect` body so it builds/refreshes `datalist#xfer-asset-list` from `bals` symbols (+ current value union), sets `assetF.input.setAttribute("list", "xfer-asset-list")`, and never replaces the input. Delete the `:950` tagName guard's purpose (input is now always INPUT). Keep `bindAssetEvents()` bound once.
- [ ] **Step 2: Update the three comments** (:487-491 field note, :934 rebound note, :944-948 function note) to describe the datalist combobox + To-field precedent (:467-485).
- [ ] **Step 3: Verify.** `node --check vanilla/js/views/transfer-ui.js`, `bash tooling/check_types.sh`, `python3 tooling/check_rot.py`. No new strings → `check_i18n.py` unaffected.

### Task 2: Search+Menu pickers (Rec 2, HIGH)

**Files (each: replace bare account/asset text input with datalist-backed combobox + blur-validate, transfer-ui To-field precedent):**
- Modify: `vanilla/js/views/samet-ui.js` (~:360 asset), `vanilla/js/views/proposal-ui.js` (~:614-619 account), `vanilla/js/views/referrals-ui.js` (~:155 account), `vanilla/js/views/credit-detail-ui.js` (~:256 collateral asset), `vanilla/js/views/gateway-ui.js` (~:399-403 account), `vanilla/js/views/htlc-ui.js` (picker inputs)

**Interfaces:**
- Consumes: per-view existing resolve/lookup (e.g. `Account.resolve`); `Forms.labeledInput`; native `datalist`.
- Produces: unchanged submit payloads (inputs keep ids/names); only UX affordance added.

- [ ] **Step 1–6 (per view):** Attach a `datalist` of candidate values where a candidate source exists (balances, known contacts, recent); add/keep blur-validation with `setFieldError`-style inline error; keep free-text typing (never restrict to list).
- [ ] **Step 7: i18n.** Any new hint string → `t()` + 12-locale entries (en value everywhere outside allowlists).
- [ ] **Step 8: Verify** per file: `node --check`, `check_types.sh`, `check_i18n.py`, `check_rot.py`.

### Task 3: Pager propagation (Rec 3, MED)

**Files:**
- Modify: `vanilla/js/views/account-history.js`, `vanilla/js/views/explorer-blocks.js`, `vanilla/js/views/explorer-assets.js`, `vanilla/js/views/pool-detail-view.js`
- Reference: `vanilla/js/views/pool-ui.js:630-646` pager shape (page-size select 10/25/50 + Prev/Next + over-fetch hasNext, no invented totals); `account-ui.js:490,566` paging shape.

- [ ] **Step 1–4 (per view):** Add page-size select (`Forms.labeledSelect`) + Prev/Next + "Page N" row reusing the pool-ui pattern; fetch one row over page size for hasNext; drop inclusive-start duplicates where the API pages inclusively.
- [ ] **Step 2: i18n** for Prev/Next/Page/size labels (likely existing keys reusable — grep first; reuse beats new keys).
- [ ] **Step 3: Verify** per file as in Task 1 + i18n gate.

### Task 4: Skeleton rows (Rec 4, MED)

**Files:**
- Modify: `vanilla/css/app.css` (or `themes.css` if token-only; skeleton shimmer must use theme tokens + `prefers-reduced-motion` off-switch), plus loading branches in `vanilla/js/views/dashboard-ui.js`, `vanilla/js/views/market-desk-panels.js`, `vanilla/js/views/market-desk-fill.js`, `vanilla/js/views/pool-ui.js`, `vanilla/js/views/pool-net-ui.js`, `vanilla/js/views/account-ui.js`.

- [ ] **Step 1: CSS.** `.skel` row style: token background, pulse animation, `@media (prefers-reduced-motion: reduce)` static fallback. No hardcoded hex.
- [ ] **Step 2–7 (per view):** Where a `DOM.status("loading…")` precedes a known layout, render N skeleton rows matching the final layout instead; swap on data arrival. Unknown waits keep spinners.
- [ ] **Step 3: Verify** CSS has no hex literals outside themes.css; `node --check` per JS file; gates green.

### Task 5: Duration preset chips (Rec 5, MED)

**Files:**
- Modify: `vanilla/js/views/barter-ui.js` (~:220-221 expiration + review seconds), `vanilla/js/views/proposal-ui.js` (~:621 review seconds)
- Reference: `vanilla/js/views/trade-core.js:144` expiration select.

- [ ] **Step 1 (per view):** Add preset chip row (1h / 1d / 3d / 7d / custom) syncing to the existing seconds/datetime inputs (custom = manual entry path unchanged). Chips are buttons ≥44px, `Event.delegate` or direct binding per file convention.
- [ ] **Step 2: i18n** for chip labels if not existing keys.
- [ ] **Step 3: Verify** per file + gates.

### Task 6: Tooltip sweep + empty-state floor (Recs 7+8, LOW-MED)

**Files:**
- Read/check tips in: `market-orders.js` (11), `market-ind-panes.js` (10), `market-desk.js` (8), `instant-trade-ui.js` (6), `pool-detail-view.js` (6), `explorer-assets.js` (5).
- Add empty states to: `fees-ui.js`, `market-ui.js`, `prediction-ui.js`, `vote-ui.js`, `explorer-blocks-activity.js`, `trade-form.js` (+ `create-worker-ui.js`, `ticket-ui.js`, `vesting-ui.js`, `news-ui.js` zero-empty facades).

- [ ] **Step 1:** For each tip carrying critical info → move to visible text or tap-safe inline disclosure; pure icon-button hints stay.
- [ ] **Step 2:** Per zero-empty view: `DOM.status`/`DOM.error` sentence + action link (settings/retry/create per context).
- [ ] **Step 3: i18n** for new sentences; **verify** gates.

### Task 7: Stepper headers (Rec 9, MED, retro-break)

**Files:**
- Modify: `vanilla/js/views/create-account-ui.js`, `vanilla/js/views/barter-ui.js` (proposal form), `vanilla/js/views/proposal-ui.js` (builder)

- [ ] **Step 1 (per view):** Header-only stepper (`Step 1 … 2 … 3`, current marked `aria-current="step"`), existing `Forms` sections unchanged underneath; Back path preserved.
- [ ] **Step 2:** Record before/after note in `docs/parity/component-audit.md` per instance (retro-break justification).
- [ ] **Step 3: i18n + verify** gates.

### Task 8: Search quality propagation (Rec 10, MED)

**Files:**
- Modify: `vanilla/js/views/explorer-ui.js`, `vanilla/js/views/favourites-ui.js`, `vanilla/js/views/explorer-assets.js`, `vanilla/js/views/es-lab-ui.js` (~:175), `vanilla/js/views/prediction-flows.js` (~:274)
- Reference: `vanilla/js/views/market-picker.js:486-502` (search + aria-label + touchable + scroll region).

- [ ] **Step 1 (per view):** Ensure `type="search"` + `aria-label` + touch floor + debounced filtering + keyboard navigability + empty state.
- [ ] **Step 2: Verify** per file + gates.

### Task 9: Final verification + report update

- [ ] **Step 1:** Run full gates: `node --check` on every touched file; `python3 tooling/check_rot.py`; `bash tooling/check_types.sh`; `python3 tooling/check_i18n.py`. All exit 0.
- [ ] **Step 2:** Update `docs/parity/component-audit.md` rows from proposed → implemented with file:line.
- [ ] **Step 3:** `git status --short` — only intended files; no `reference/` edits; no generated artifacts.

## Self-Review

- Spec coverage: all 10 recs mapped (6 = no-change cite, folded into Task 6 notes — no code).
- No placeholders: exact files/lines/patterns per task; repo gates are the test cycle (no JS test harness ships in vanilla by doctrine).
- Type consistency: shared-global names (`Forms.labeledInput/labeledSelect/fieldRow`, `DOM.status/error/el`, `Event.delegate`, `touchable`) reused verbatim across tasks.
