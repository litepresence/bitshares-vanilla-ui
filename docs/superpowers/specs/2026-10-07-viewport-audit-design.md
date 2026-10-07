# Two-Ended Viewport Audit — design (2026-10-07)

> **Status:** approved by owner 2026-10-07. Round 2 of the principle #7 pass,
> superseding `docs/parity/viewport-gaps.md` (2026-09-28, 10 routes, eyes-only).
> **Owner decisions this spec encodes:** full sweep of all ~75 routes · fix
> findings in place + re-run gates · in-page assertions with screenshots on
> failure · testnet throughout.

## 1. Why this round exists

`docs/parity/viewport-gaps.md` swept **10 of ~75 routes** on 2026-09-28 and
found real GAPs: inline label cramp on `#/transfer` + `#/credit-offer`, the
exchange desk stranded inside a 1400px column at 2560px, `.wrap.wide` present
in CSS but assigned by no route, and an unverified open-state hamburger.

Nine days and dozens of commits later, the surfaces have moved: `pool-net`
split into 5 modules with a physics layer, `discrete-charts.js` canvas plots
landed on both desks, a `#/markets` landing page appeared, the feed history
chart shipped, the desks got headers. **None of that has been looked at at
390px or 2560px.** `SLICES.md` still carries `browser pass ⏳` for slices 2–17,
so check 7 of `skills/auditing-vanilla-slices/SKILL.md` has never once gone
green.

The four automated gates that guard every other principle —
`tooling/check_rot.py`, `tooling/check_types.sh`, `tooling/check_i18n.py`,
`tooling/scan_dead_css.py` — are dependency-, type-, text- and
selector-level. **Not one of them can observe a layout.** Overflow, touch
target size, and stranded columns are invisible to all of them. That is the
hole this audit fills.

There is a second reason to run it now: a **20-file uncommitted diff is in
flight** (the component-wisdom sweep — datalist comboboxes replacing
`<select>` swaps, `DOM.skel` skeleton rows, header steppers, duration chips, an
account-history pager). Those are all new phone-width behavior, and the
`<select>`→`<datalist>` swap in particular changes control type and mobile
keyboard behavior. Sweeping before that diff is validated would be sweeping
the wrong tree; sweeping after is the point.

## 2. What ships

| Artifact | Path | Status |
|---|---|---|
| Sweep script (dev-only, never shipped, never required) | `tooling/visual/viewport-audit.mjs` | new |
| Machine verdicts | `docs/parity/viewport-audit-2.json` | new, generated |
| Human note + punchlist + before/after proof | `docs/parity/viewport-audit-2.md` | new |
| Layout fixes | `vanilla/css/app.css` + offending views | edited |
| This spec | `docs/superpowers/specs/2026-10-07-viewport-audit-design.md` | new |

Stdlib + `playwright-core` only, matching `tooling/visual/shot.mjs`
(`package.json` lives in `tooling/visual/`, git-ignored territory, dev-only).
Browser: `chromium-1243` already present in `~/.cache/ms-playwright`.

## 3. Route set — all ~75, params resolved

Enumerated from the `routes` array at `vanilla/js/router.js:212` (~75 `path:`
entries). Every entry gets swept; none is silently skipped. Param routes are
resolved by group:

| Group | Examples | Param source |
|---|---|---|
| **Static** | `/transfer`, `/pools`, `/voting`, `/explorer`, `/settings/*`, `/assets/*`, `/barter`, `/htlc`, `/samet`, `/borrow`, `/tickets`, `/vesting`, `/fees`, `/txbuilder`, `/api-lab`, `/es-lab`, `/markets`, `/menu/**`, `/deposit-withdraw*`, `/proposals`, `/tickets`, `/airdrop`, `/alerts`, `/trollbox`, `/top-ops`, `/ops`, `/referrals`, `/favourites`, `/news`, `/login`, `/registration*`, `/create-account`, `/create-worker`, `/about`, `/community` | none |
| **Live-id** | `/account/lite-test-1`, `/market/USD_TEST`, `/pools/66`, `/htlc/621`, `/credit-offer/43`, `/deal/70`, `/proposals/1488`, `/block/100916767` | ids already recorded in `docs/parity/testnet-proof-round2.md` + slice-11/12/13/14 notes. **Reused, never re-invented.** |
| **Dynamic** | `/block/:h/:txIndex`, `/asset/:symbol`, `/help/**`, `/transfer/:to`, `/invoice/:data` | discovered at runtime — the script opens the parent route, reads a real link off the rendered DOM, and follows it. **Never fabricates an id**; a route with no discoverable id is recorded as `SKIP-no-fixture` with the reason, not silently passed. |
| **Wallet-gated** | `/wallet`, `/existing-account`, `/create-wallet-brainkey`, `/wallet/password` | assert the **locked-prompt state** renders — that is the state a logged-out visitor sees and the only one reachable without keys. The unlocked body stays ⏳ human (chain-safety rule 6: real keys on testnet only, and these are already tracked as human items in `SLICES.md`). |

Testnet is selected through the `?network=testnet` bootstrap the app already
supports (the mechanism `tooling/visual/shot.mjs:47-66` drives). Reads only —
no keys, no broadcasts, no writes.

## 4. The four assertions

All measured in-page via `page.evaluate` after the route settles.

| # | Assertion | Method | FAIL condition |
|---|---|---|---|
| 1 | **h-overflow** | `documentElement.scrollWidth > clientWidth + 1`, then walk up from the widest offending element | page scrolls sideways — **unless** some ancestor of the widest offending element has a computed `overflow-x` of `auto` or `scroll`. That case is `PASS w/ note`, with the scroll-region selector recorded, because horizontal scroll regions are the sanctioned §3.6 answer for dense grids. The test is the **computed style**, not a hardcoded `.pools-scroll` allowlist, so a new scroll region is covered without editing the script. |
| 2 | **touch floor** | every `button, a[href], select, input:not([type=hidden]), textarea, [role=button]` → `getBoundingClientRect()` | any **visible** control with `height < 44 && width < 44` (§3.6: ≥44px in at least one dimension). Zero-size / `visibility:hidden` / `display:none` are skipped — a hidden control is not a touch target. |
| 3 | **stranded column** (2560px only) | widest block-level descendant of the app content root ÷ viewport width | `< 0.55`. The app content root is `#view` (`vanilla/index.html:65`, the router's render target per `vanilla/js/app.js:1043`); taking the **widest** block-level descendant (not the first, and not the outermost) means a full-bleed panel nested inside a narrow wrapper still counts as full-bleed. This is the §3.6 rule "dense views expand into multi-column arrangements — no stranded narrow column on a wide monitor", given a number. |
| 4 | **console** | `console` + `pageerror` listeners, same shape as `shot.mjs:34-37` | any `console.error` or `pageerror`. Errors are failures of the principle #4 floor ("no blank screen", honest error states) as much as of #7. |

Two **recorded-but-not-failing** signals, because they are leading indicators
worth a note without being defects yet:

- text clipped by an ancestor (`scrollWidth > clientWidth` on a text-bearing
  element's parent while the element itself is inside bounds)
- `<meta name="viewport">` present and correct

## 5. Verdict schema and pass criteria

| Verdict | Meaning |
|---|---|
| `PASS` | all four assertions clean |
| `PASS w/ note` | clean except a declared scroll region absorbed overflow; selector recorded |
| `FAIL` | one or more assertions failed; failing selector + assertion recorded |
| `SKIP-no-fixture` | dynamic param route with no discoverable id; **reason recorded, never counted as a pass** |

`viewport-audit-2.json` carries, per route×viewport: verdict, the failing
assertion ids, offending selectors, clipped-text selectors, console messages,
content-ratio, and the screenshot path when one was saved.

Screenshots are saved for **every FAIL** plus a deterministic 1-in-5 PASS
sample (`route.length % 5 === 0`), so eyeballing stays affordable and the
sample is reproducible rather than cherry-picked. No screenshot is written for
a passing route outside the sample — that is the whole reason assertion mode
was chosen over the eyes-only round 1.

`viewport-audit-2.md` is the human note: a per-route table, a ranked punchlist
(money paths first, then reach), and a before/after line per fix.

## 6. Workflow

1. Start `python3 -m http.server 8081 --directory vanilla` (dev-only).
2. Run the sweep → JSON + shots under `docs/parity/viewport-shots/`.
3. Triage failures into a ranked punchlist with `file:line`.
4. **Fix in place.** Shared-CSS class fixes first — one line, whole-app reach.
5. Re-run all four gates: `check_rot.py`, `check_types.sh`, `check_i18n.py`,
   `scan_dead_css.py`.
6. Re-shoot **only** the previously-failing route×viewport pairs to prove
   before/after.
7. Write the note. Every layout change records a retro-override justification
   per the component-wisdom retro rule (before/after + why retro styling could
   not host it) — a pure widening is not a retro break and needs none, but a
   restructure does.

## 7. Explicitly out of scope

- The uncommitted component-wisdom diff review — audit 2, ordered next.
- Canvas-rendered numbers (`#6` blind spot, 33 `fillText` sites) — audit 3.
- Anything requiring human eyes: unlocked-wallet bodies, real touch gestures
  (swipe-scrolling a `.pools-scroll` region), keyboard-only runs. These stay
  ⏳ for the human tester and this audit says so rather than implying
  otherwise.
- Retro *styling* changes. This audit finds layout breaks. It does not
  restyle anything for taste (principle #2, §3.1).

## 8. Honesty rules for the note

- A route that fails to render is a **finding**, not a skip.
- An empty state on testnet for lack of data is recorded as such, not read as
  a broken empty state.
- No claim of "#7 covered" until every static and live-id route is `PASS` or
  `PASS w/ note` at both viewports, and every `SKIP-no-fixture` is either
  resolved or explicitly carried as a human item.