# Polish batch — design (2026-10-04)

Seven independent tester-report items, one spec, seven small slices.
Approved by owner 2026-10-04 (resolutions as below; silence was approval).

## 1. Desk alignment (buy/sell + depth offsets)

Single grid source: remove the legacy `.mkt` areas in `app.css`, keep
`desk-grid.css`; equal-height panel headers; depth canvases share one
row-height token instead of estimated values. Screenshot pixel-diff at
1440px proves it; no behavior change.

## 2. Fees width

Cap the fees wrap (~70vw, tokens only) instead of today's near-full-bleed
stretch. One-line CSS, all three themes.

## 3. Committee cards

Enable the existing `.node-card` fallback rendering for the committee
table (name cards) alongside the dense table — reuse, no new component.
Phone gets cards, desktop keeps the table; same data both.

## 4. Account action icons

`SEND | DEPOSIT | TRADE | BORROW | SETTLE` gains vendored monochrome
glyphs via `Icon.img` + theme filter BEFORE the text labels.
Icon+text always, never icon-only.

## 5. Portfolio sorting

Adopt the `explorer-assets.js` `sortTh` pattern (click toggles,
`aria-sort`) for asset, balance, and price columns. Default order stays
chain order until the user clicks.

## 6. Asset price paging

Keep the honest cap notice, but page it: price the visible page (25/page
like the assets tab) with Prev/Next instead of first-20-then-dashes.
Same bounded-RPC discipline, no N+1.

## 7. Explorer-assets filter honesty

Remember the last filter mode per session (SmartCoins default on first
paint, as today) and label the control with what it shows
("Showing: SmartCoins — …"). New strings keyed × 12 locales.

## 8. Testing and gates (all seven)

Per-item vectors where logic changes (sort, paging, filter memory);
screenshot pairs for alignment/width/cards/icons at 390px + 1440px × 3
themes; zero console errors. `check_rot.py`, `check_types.sh`,
`check_i18n.py` green throughout.
