---
name: auditing-vanilla-slices
description: Use when reviewing vanilla UI code for principle compliance, when checking whether a slice is complete, or when any asset amount, price, fee, or percent is displayed to the user
---

# Auditing Vanilla Slices

## Overview

Eight checks, one per guiding principle. Run all eight, in order. The slice passes only if all eight pass.

## When to Use

- Before declaring any slice "done" (REQUIRED by AGENTS.md §7)
- When reviewing vanilla code you did not write
- When adding or changing any displayed number

When NOT to use: during initial implementation (that is `building-vanilla-slices`).

## The Six Checks

### 1. Rot gate (principle #1, AGENTS.md §4.5)

```bash
python3 tooling/check_rot.py   # from /workspace
grep -rniE "unpkg|jsdelivr|cdn\.|googleapis" vanilla/ ; echo "CDN hits above (want none)"
grep -rn "from ['\"]react\|from ['\"]vue\|require('react" vanilla/ ; echo "framework hits above (want none)"
ls vanilla/package.json vanilla/node_modules 2>&1  # want "No such file"
```

If `tooling/check_rot.py` does not exist yet, create it per the spec in AGENTS.md §8 before proceeding — a missing gate tool does not waive the gate. Then answer §4.5(a–c) in the parity note.

### 2. Retro look (principle #2, §3.1)

Side-by-side against the old UI route/flow. Any visual deviation needs a before/after note justifying it as broken-original or #4-required. Taste-driven restyling fails the audit.

### 3. Feature coverage (principle #3, §3.2)

Every op in the slice exists in the op-coverage matrix (`#1 route/modal` × `#2 page` × `vanilla slice`). An astro-only op with no vanilla plan is a gap, not a pass.

### 4. Modern glow (principle #4, §3.3)

No full-page reloads on chain updates; empty states and inline validation present; market/account/asset search is fast, typo-tolerant, keyboard-friendly. Search quality is a release blocker.

### 5. Themes (principle #5, §3.4)

Slice renders acceptably in original blue, light, and dark. Parity note contains the screenshot trio. Hardcoded colors outside `themes.css` fail the audit — grep for `#` hex literals in slice CSS/JS.

### 6. Human terms (principle #6, §3.5)

```bash
grep -rn "Math.pow(10" vanilla/js/   # hits allowed ONLY in vanilla/js/api/format.js
```

Every displayed number has a raw→human test vector in the parity note, including one non-BTS precision and one percent field (`2000` → `20%`). Any raw integer on screen, or float math for money outside `format.js`, fails the audit.

### 7. Both ends of the screen (principle #7, §3.6)

Navigate the slice's full flow at 360–390px phone width AND at desktop width (1440px minimum; 2560px+ for dense grids), with touch-sized emulation at the phone end, and record both in the parity note. Phone: nav collapses, tables/cards stay usable, targets ≥44px in at least one dimension, no hover-only UI, correct viewport meta, numeric keyboards on amount inputs. Desktop: dense views expand into multi-column arrangements — no stranded narrow column on a wide monitor. Single-viewport passes fail the audit.

### 8. Built to be read (principle #8, §3.7)

```bash
grep -rniE "TODO|FIXME|XXX|HACK" vanilla/js/ vanilla/css/ ; echo "dead-text hits above (want none)"
find vanilla/js -name '*.js' | xargs wc -l | sort -n | tail -n 8  # any file past ~400 lines is a split candidate
```

Every file opens with a module header (owns/consumes/side effects/origin); every non-trivial function has what/params/returns/failure-modes; comments explain WHY, never restate WHAT. Missing headers, unexplained functions, or dead text fail the audit. (The full end-to-end readability pass is its own final slice — this check enforces per-slice hygiene so that pass is polish, not rescue.)

### 9. Type gate (hard — added 2026-10-01)

```bash
bash tooling/check_types.sh  # tsc --checkJs --noEmit over vanilla/js/** (exit 0 = clean)
```

New/changed code must typecheck: JSDoc `@param`/`@returns`/`@typedef` on
touched seams, shared shapes in `vanilla/js/api/types.js`, cross-file
globals in `vanilla/js/globals.d.ts` (dev-only — never add a script tag
for it; the rot gate fails a loaded `.d.ts`). Only parenthesized
`/** @type {X} */ (expr)` casts as code-shape change — any behavior delta
fails the audit. A red gate fails the slice, no exceptions.

## Red Flags — Stop and Fix

- "It's just a demo/prototype, we'll harden later"
- "One small dependency won't hurt"
- "Precision handling is fine, it looked right for BTS"
- "Themes work, I checked one of them"
- "Mobile looks fine, I resized the window a bit"
- "The gate tool doesn't exist yet, so I'll skip that check"

All of these mean: stop, fix, re-run all eight checks.
