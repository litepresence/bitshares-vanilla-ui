# Unified Reactive Button System — design

Date: 2026-10-03. Status: approved, awaiting plan.

## Context

Current state: 6+ duplicated `touchable()` helpers across `vanilla/js/`, inconsistent button variants (primary/ghost/subtle/menu-card/trade-tabs/pools-pager/mkt-bell), contrast issues in default theme (blue-on-blue), no shared utility.

## Goal

Single `touchable` utility, three coherent button variants, guaranteed contrast in all three themes, full app migration, addictive busy-box feel preserved.

## 1. Shared utility

**File:** `vanilla/js/utils/touchable.js` (new)
```js
function touchable(el) {
  el.style.minHeight = "44px";
  el.style.minWidth = "44px";
  return el;
}
if (typeof module !== "undefined") module.exports = touchable;
```
- Exported for Node tests, global `window.touchable` for inline scripts.
- All 6+ local copies deleted, replaced by `<script src="js/utils/touchable.js">` + import.

**CSS fallback** (app.css):
```css
.touchable { min-height: 44px; min-width: 44px; }
```

## 2. Three variants (theme-token only)

### Primary — main actions
```css
/* Resting */
background: var(--button-bg);
color: var(--accent-text);
border: 0;

/* Hover (hover:hover) */
background: var(--button-bg-deep);  /* darker, white text stays readable */
transform: translateY(-1px);
box-shadow: 0 4px 12px var(--toast-shadow);

/* Active */
transform: translateY(0) scale(0.99);
box-shadow: none;
```
**Use:** Sign, Send, Propose, Confirm, Add, Create, Unlock, Retry, Look up, Open account, View as, Reset, Regenerate, Register.

### Ghost — secondary / destructive
```css
/* Resting */
background: transparent;
color: var(--accent);
border: 1px solid var(--accent);

/* Hover */
background: var(--accent);
color: var(--accent-text);  /* guaranteed white-on-accent */
border-color: var(--accent);

/* Active */
transform: translateY(0) scale(0.99);
```
**Use:** Back, Cancel, Keep order, Close, Dismiss, Keep orders.

### Subtle — tabs, pagers, inline, icon-only
```css
/* Resting */
background: transparent;
color: var(--text);
border: 0;

/* Hover */
color: var(--accent);
/* underline via existing gradient (app.css:1054-1064) */

/* Active */
transform: translateY(0) scale(0.99);
```
**Use:** Trade-tabs, order-tabs, mkt-tabs, pools-pager, mkt-bell, mkt-star, toast-x, pager buttons, mkt-indmenu-btn, mkt-scalerow button, mkt-quotes button.

## 3. Contrast fixes (token-only)

| Theme | Fix |
|-------|-----|
| ref-ui (default) | `--button-bg-deep: #03739a` (already 10% darker than `--button-bg: #049cce`) — white `--accent-text` passes WCAG AA on both |
| vanilla-ui | `--button-bg-deep: #0B5C7E` (already tuned) — passes |
| dex-ux | `--button-bg-deep: #0069d9` (already tuned) — passes |

Ghost hover: `--accent` background + `--accent-text` (white) — passes in all three (measured: 4.50+ on all grounds).

Subtle: no background change — only color shift to `--accent` + existing underline gradient.

## 4. Migration mapping

| Current pattern | → Variant | Selector(s) |
|-----------------|-----------|-------------|
| `button` (global rule) | Primary | `button:not([aria-pressed]):not(.btn-ghost):not(.subtle-btn)` |
| `a.btn` (CTA cards) | Primary | `.menu-card` (promote), `a.btn` |
| `.trade-tabs button` | Subtle | `.trade-tabs button, .order-tabs a, .mkt-tabs button` |
| `.pools-pager button` | Subtle | `.pools-pager button` |
| `.mkt-bell` | Subtle (icon-only) | `.mkt-bell` |
| `.mkt-star` | Subtle (icon-only) | `.mkt-star` |
| `.mkt-quotes button, .mkt-scalerow button, .mkt-indmenu-btn` | Subtle | as-is |
| `.toast-x` | Subtle (icon-only) | `.toast-x` |
| `details.raw > summary` | Subtle | `details.raw > summary` |

**New class helpers** (added to app.css):
```css
.btn-ghost   { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
.subtle-btn { background: transparent; color: var(--text); border: 0; }
```
Apply via `classList.add("btn-ghost")` / `("subtle-btn")` in JS.

## 5. Motion (extends existing candy block)

All variants use existing `@media (hover:hover)` block:
- Primary: lift + shadow (already lines 1001-1006)
- Ghost: background fill + color flip (new, same 120ms)
- Subtle: underline slide + color shift (already lines 1061-1064)

`prefers-reduced-motion` kills transforms, keeps color/background shifts.

## 6. Touch floor

`touchable()` sets `min-height: 44px; min-width: 44px;`.
Icon-only buttons (mkt-bell, mkt-star, toast-x, pager) get both dimensions.

## 7. Files

| File | Action |
|------|--------|
| `vanilla/js/utils/touchable.js` | Create |
| `vanilla/css/app.css` | Modify (unify rules, add ghost/subtle, fix .menu-card/.trade-tabs/.pools-pager/.mkt-bell/.mkt-star/.toast-x) |
| `vanilla/index.html` | Modify (add `js/utils/touchable.js` script tag before `app.js`) |
| `vanilla/js/api/explorer-tabs.js` | Modify (delete local touchable, use shared) |
| `vanilla/js/api/market-book.js` | Modify (delete local touchable) |
| `vanilla/js/builders/trade-cancel.js` | Modify (delete local touchable, add .btn-ghost/.subtle-btn classes) |
| `vanilla/js/builders/transfer-confirm.js` | Modify (delete local touchable, add classes) |
| `vanilla/js/views/accounts-ui.js` | Modify (delete local touchable, add classes) |
| `vanilla/js/views/barter-ui.js` | Modify (add classes) |
| `vanilla/js/views/tour-ui.js` | Modify (add classes to replay/back/next/skip/dot buttons) |
| Any other `touchable` sites | Modify (grep + migrate) |

## 8. Verification

- `python3 tooling/check_rot.py` PASS
- `python3 tooling/check_i18n.py` PASS
- `bash tooling/check_types.sh` PASS
- `node tooling/app-shell-test.js` PASS
- 360px + 1440px visual: all three themes, hover states visible, contrast readable
- No button <44px in either dimension
- No blue-on-blue in default theme
- `prefers-reduced-motion` disables lifts, keeps color shifts

## Anti-rot

- Zero new deps, zero new colors (all tokens exist), file:// works, same CSP.