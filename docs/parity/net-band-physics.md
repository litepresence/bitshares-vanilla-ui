# Network-band physics switch — parity note (2026-10-07)

"Physics Off" did not stop the map. It picked a *gentler preset* — and on the
desk pages it picked a different one again, because the band existed twice.

## Root cause (two layers, both real)

1. **The switch was a fidelity dial wearing an On/Off label.** `S.phys` was a
   two-value preset (`calm` | `lively`). `calm` is a full Fruchterman-Reingold
   simulation with `temp0: 6` — it moves. So "Off" animated on every touch,
   forever after. Users read "Off" as *stopped*.
2. **There were two band engines.** The selector bands
   (`#/markets`, `#/pools`) run `PoolNetUI` + `PoolNetPhys`; the desk maps
   (`#/market/…`, `#/pools/:id`) run `PoolGraph` from `api/pool-graph.js`,
   where `calm` painted the `relax()` equilibrium and ran **zero live frames**.
   Same On/Off label, same `poolNetPhys` storage key, two opposite meanings —
   which is exactly the reported "it turns off on the desk pages but not on the
   selector pages". A stale `poolNetPhys` value also disagreed with the live
   state between the two engines.

## What the switch means now (owner ruling)

**One physics.** Both engines now run the same single preset (the former
`lively`); `calm` is deleted. The switch is a **gesture-reaction flag**:

| | Behavior |
|---|---|
| **On** | A drag release re-energizes the simulation, so neighbours visibly react and it re-settles (bounded ~3s). |
| **Off** | Gestures never wake it. You can still drag nodes — the mesh **stays exactly where you dropped it**. No settle, no spring reaction, no throw. |

**Automatic settles still run either way** (page load, filter/pair change,
resize, scroll back into view) — those aren't gestures, so "Off" never leaves
the map unarranged for a new filter. Flipping **On** is treated as consent to
motion and runs bounded even under `prefers-reduced-motion`.

## Changes

- `vanilla/js/api/pool-net-phys.js` — one preset (`calm` deleted); `readReact`/
  `writeReact` replace `readPhys`; `wake()` refuses *explicit* wakes when
  `S.react === false`; storage key `poolNetReact` (the retired `poolNetPhys`
  is never read, so no preset can resurrect).
- `vanilla/js/api/pool-graph.js` — same rework on the desk engine: one preset,
  `setReact`/`readReact`, `wake()` gesture gate, `endDrag()` gated,
  `_runLive`'s zero-frame calm short-circuit removed, `drawLive` always paints
  then settles.
- `vanilla/js/views/pool-net-gestures.js` — the release throw only stores
  velocity when reaction is on (leftover velocity would drift the graph on the
  next automatic settle).
- `vanilla/js/views/pool-net-chrome.js` — `setReact`, On/Off from the flag,
  flip-off stops the loop and drops residual velocity without re-spreading
  (flipping off must not teleport the mesh the user was reading), flip-on
  re-spreads and settles. **No tooltip, no hint line.**
- `vanilla/js/views/market-desk-fill.js`, `vanilla/js/views/pool-detail-view.js`
  — desk switches converted to the flag; the old "calm = settle-once"
  drawGraph branch is gone (that branch is *why* the desk froze and the
  selectors didn't).
- `vanilla/css/app.css` — switch visuals halved (30×16 pill, 8px knob) inside a
  **44×44 hit area** so the touch floor survives; focus ring added.
- **Label trimmed to the switch itself** (owner, later the same day): the
  tooltip, the hint line, *and* the visible `On`/`Off` word are all gone. The
  bar now reads just `Physics` + the pill. State still reaches assistive tech
  through `role="switch"` + `aria-checked` (+ `aria-label="Physics"`), so
  nothing is lost to a screen reader; sighted users read the knob's side and
  the accent color. The retired `pool_net.phys_on` / `phys_off` keys were
  deleted from all 12 dicts rather than left orphaned.

## Regression caught while testing this

My first pass wrote `on = …` inside `paintPhysSwitch(box, mode)` in
`market-desk-fill.js` — `on` was undeclared, the assignment threw under strict
mode, and the market desk's switch never painted `aria-checked` (the probe
caught it: `aria: null`). Fixed; the probe now asserts the aria state flips on
all four surfaces.

## Evidence

- `tooling/pool-net-ui-test.js` → **76 passed** (one preset + `calm` gone,
  flag defaults, gesture-vs-auto wake vectors, persistence incl. corrupt value
  and retired key, travel/settle guard, switch DOM contract incl. the
  no-tooltip / no-hint / no-On-Off-word contract across all three builders).
- `tooling/pool-graph-test.js` → **136 pass** (one preset, stale mode argument
  ignored, gesture gate, persistence, determinism).
- `pool-net-test` 39 · `market-net-test` 22 · `market-net-ui-test` 23 ·
  `node-network-test` 30 — all green, unchanged.
- `tooling/visual/probe-phys-toggle.mjs` → **PHYS-TOGGLE OK**, all four
  surfaces, zero page errors. Motion after release:

  | Surface | Off | On |
  |---|---|---|
  | Pool selector | **0px** | 121.7px |
  | Market selector | **0px** | 119.9px |
  | Pool desk | **0px** | 72.3px |
  | Market desk | **0px** | 13.2px |

- Switch geometry at 1440px and 390px: button 44×44, track 30×16, no `title`,
  zero hint elements, zero state elements — the half-size control keeps the
  full-size target. Bar text is exactly `Physics` on all three surfaces, with
  `aria-checked` flipping correctly and zero page errors.
- Gates: `check_rot.py` PASSED · `check_i18n.py` OK (3772 keys, 4980 call
  sites) · `check_types.sh` PASS.

## Accepted trade-off

The desk maps now always animate their automatic settle, where the desk
`calm` mode previously painted a static frame. That is the price of one
meaning for "Off"; the flag is the only way to turn gesture reaction off, and
it reads honestly on every surface. The retired `poolNetPhys` key is ignored
rather than migrated — its values ("calm"/"lively") name a preset that no
longer exists.
