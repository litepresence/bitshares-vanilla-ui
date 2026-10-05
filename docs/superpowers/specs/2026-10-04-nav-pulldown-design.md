# Nav pulldown — design (2026-10-04)

Replace the burger's in-flow directory strip with an overlay pulldown.
Approved by owner 2026-10-04 (primary bar stays; phone behavior delegated).

## 1. Problem

Clicking ☰ expands `#nav-directory` in-flow, pushing page content down —
a second nav bar that comes and goes beneath the static 7-link bar, with
text-only headings while the bar above shows the same destinations with
icons. Two presentations of navigation stacked on each other.

## 2. Mechanics

- ☰ toggles an overlay panel pinned below the header's live bottom edge
  (`position: fixed`, top computed from the header rect at open — the bar
  wraps on narrow screens, so no constant offset), right-aligned to the
  toggle. Opening/closing never moves page content.
- Closes on: toggle tap, `Esc`, tap outside, any navigation.
- Focus moves to the first item on open, returns to ☰ on close;
  `aria-expanded` + `aria-haspopup` on the toggle.
- Instant show/hide, no slide/fade (reduced-motion safe, zero jank).
- `max-height: 70vh` with internal scroll (keeps the current directory cap).

## 3. Contents

Same data as today, one presentation: the 7 primary links with icons
(same `buildNavLink` source, existing `--header-icon-filter` theming),
a divider, the 6 section entries with icons → `#/menu/:slug`, and
"All pages" → `#/menu`. Nothing reachable today becomes unreachable.

## 4. Small screens (owner-delegated, principle #7)

Below ~720px the static bar becomes one horizontally scrollable row
(`overflow-x: auto`, `nowrap` — no wrap, no push-down); the pulldown goes near-full-width (viewport
minus 16px) with the same 70vh scroll. All targets ≥44px; everything
works on tap/Enter/Esc — no hover-dependent UI.

## 5. Unchanged

The 7 static links, all `#/menu` TOC pages, themes (tokens only), footer.

## 6. Testing and gates

Keyboard-only walkthrough (Tab/Esc/focus-return), outside-tap close,
content-offset-doesn't-move assertion, 390px + 1440px × 3 themes, zero
console errors. `check_rot.py`, `check_types.sh`, `check_i18n.py` green
(new strings keyed × 12 if any copy is added; reuse existing keys first).
