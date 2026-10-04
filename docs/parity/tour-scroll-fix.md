# Tour scroll-hijack fix (2026-10-01, day-1 feedback)

Owner report: with the 5-step "Welcome to BitShares Vanilla" popup open on
first arrival, page scrolling is jerky.

## Root cause (verified in `vanilla/js/tour-ui.js`)

Two compounding defects, both in the re-render path — not page weight:

1. **Unconditional `scrollIntoView({behavior:"smooth"})` on every render**
   (old `renderCard`). The `#view` MutationObserver (`watchView`, 300ms
   debounce) re-fired `showStep(stepIdx)` on *every* async DOM fill (market
   strip chips, pulse cells, balances, history). Each refire rebuilt the
   whole card AND launched a new smooth-scroll animation — each one
   canceling/retargeting the in-flight one and fighting the user's own
   manual scroll. On a first-load landing page streaming chain data, that
   is a scroll-hijack loop: the definition of jerky.
2. **No scroll listener at all.** `onMove` (debounced re-anchor) bound only
   `resize` + `hashchange`, so the fixed card additionally went stale
   against its target mid-scroll.

## Fix (`tour-ui.js` only, no DOM/CSS changes)

- `scrollChanged(i, target, lastI, lastT)` pure gate + `scrollIdx/scrollTgt`
  tracker: smooth-scroll runs exactly once per real step/target change,
  never on observer re-renders of the same card. Reset in `end()` (replays
  scroll fresh; stale node refs never linger).
- `needsRerender(step, found, shown, hasCard)` pure gate in the observer
  callback: rebuild only when the target newly materializes (highlight
  upgrades) or vanishes from a target-required step (skips forward
  honestly). Routine fills skip entirely — no rebuild, no re-place.
- Passive `scroll` → `onMove` bind (options-object guarded for old
  browsers; removed in `end()`): the fixed card now re-anchors cheaply
  (position-only, debounced 120ms) while the user scrolls.
- `_test` seam (`scrollChanged`, `needsRerender`) + `tooling/tour-scroll-test.js`
  (14/14). No new copy → zero i18n impact.

## Verification

- `node --check` clean; `tour-scroll-test.js` 14/14; rot PASS; i18n OK
  (2832 keys, drift-free). Headless verified 2026-10-01 after unblocking the
  shooter (OS libs installed; see `shot.mjs` header): fresh-profile `#/`
  @1440 shows step 1/5 with NEXT/SKIP + 12px dots all inside the card, live
  pulse cells (head 114854682, counts, top-vol row) proving the refill path,
  zero console errors; @390 shows stacked cards + bottom-sheet tour, zero
  console errors. Smooth-motion itself stays a human check (stills can't
  show jank — but the re-fire loop is gone by construction + unit test).
- Human gate: open a fresh profile (tour auto-starts), scroll the landing
  mid-fill — motion must be smooth with the card tracking its target; step
  through all 5 (each scrolls once on arrival); dismiss + Take-tour replay.

## Anti-rot

(a) Platform listeners + two pure functions — ten-year safe. (b) Zero new
deps. (c) Deletable: the two gates collapse to the old unconditional calls
(the bug returns with them — documented here so nobody "simplifies" it).
