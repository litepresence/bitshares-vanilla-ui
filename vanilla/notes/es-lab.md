# Parity note — ES Lab (#/es-lab, community-index browser)

Spec: `docs/superpowers/specs/2026-10-03-es-lab-design.md` (api-lab twin, approved).
Plan: `docs/superpowers/plans/2026-10-03-es-lab.md` (7 tasks, all executed).

## 1. Reference behavior

- #2 astro `esquery.ts:18-42` (`ES_BASE https://es.bitshares.dev`, POST
  `/${index}/_search`) — transport shape copied exactly (same host, same
  path form, same JSON POST).
- #2 `TopOperations.ts:47-64` (size-0 + `block_data.block_time` range filter
  + `terms operation_type size 200` → buckets) — the `top-ops-agg` body.
- #2 `TopAssetHolders.ts:28-37` (`match asset_type`, `balance` desc, size N,
  rows from `_source.owner_`/`balance`) — the `holders-by-asset` body, same
  body the wallet's own asset panel sends (`views/explorer-assets.js:907-908`).
- In-tree `api/market-fills-history.js:83-92` (op-4 match + base/quote
  multi_match + `is_maker:false` text, block_time-desc sort, capped
  `_source`) and `api/pool-history.js:65-72` (op-63 + pool-id match) — the
  fills/swaps bodies. `market-fills-history.js:168-211` (500/page, max 2,
  15s shared deadline, short-page stop) — the `runPaged` caps, verbatim.
- #1 has no ES browser (its Console is a WS `eval` box — deliberately NOT
  copied, same stance as api-lab). Interaction twin is the api-lab desk
  (`js/views/api-lab-ui.js`): pulldown+filter, curated↔raw mirror, history,
  deep-links. Styling cues mirrored 1:1 per owner instruction (stacked
  label-over-box rows, ≤560px inline styles, no new CSS, ≥44px targets,
  muted meta, raw `<pre>` pre-wrap).
- Doctrine: prior ES refusals (R1c, slice-12, SLICES.md:154) are superseded
  by the shipped written-exception pattern — ES is DATA (HistoryCap seam),
  pref-gated, never load-bearing. This slice adds no new exception
  (spec §3 with removal plan).

## 2. Vanilla implementation

- `js/api/es-lab.js` (334 lines) — 7-template catalog + coerce/build/
  fromBody/parse. No DOM, no fetch. Probe-locked live 2026-10-03:
  `term account_history.account` (exact), `range block_data.block_num`
  (`{block_num,block_time,trx_id}` observed), `match owner_`.
- `js/api/es-lab-run.js` (160) — resolveAccount (Chain.db→call two-step,
  pool.js pattern), run/runPaged (`{rows, json}` — desk always shows raw),
  precMap (ONE batched get_objects, ≤50 ids, fail-soft `{}`).
- `js/views/es-lab-ui.js` (595 — over the ~400 split-candidate line;
  recorded debt for slice-18, api-lab precedent) — desk shell.
- `js/views/es-lab-results.js` (215) — parsed tables + honest panels.
- Wiring: `#/es-lab` route (`js/router.js`), Explore nav + `navText`
  (`js/app.js`), static header link + 3 script tags (`index.html`),
  ambients (`js/globals.d.ts`). 34 `eslab.*` keys shipped WITH the desk
  (api-lab F1 lesson) — `check_i18n` drift-free, 3230 keys.
- Two live-fire bug fixes during build (both in-note): (a) fills fields
  were symbols — index text-matches IDS only (adapter passes
  `baseId/quoteId`; empty-ES→chain fallback in fillsForMarket proves the
  looseness); fields corrected to ids with honest hints. (b) `resolveAccount`
  first used `Chain.db(name)` — db() takes NO args (returns the api id);
  fixed to db→call before any browser ran it.

## 3. Manual test steps + observed result (2026-10-03)

- Unit: `node tooling/es-lab-test.js` 32 passed (bodies, round-trips,
  caps, resolve, precMap); `node tooling/es-lab-ui-test.js` 10 passed
  (kind/href/deep-link). `node --check` all touched files clean.
- Live (`node /tmp/eslab-live.js` → es.bitshares.dev): holders BTS 5 rows
  (`1.2.881242`/`38978217981523`); fills 1.3.0/1.3.121 5 rows (type 4,
  block 114858532); swaps 1.19.66 5 rows (type 63, block 114875220); agg 7d
  24 buckets (top `limit_order_create` 41.0%); ops committee-account 5 rows;
  range 114876000-10 5 rows; balances 1.2.0 10 rows (asset per row);
  pref-off → `es-disabled` (no fetch); 1ms timeout → `es-unavailable`.
- Headless browser (`tooling/visual/shot.mjs`, Chromium, zero console
  errors on every shot): deep-link auto-run renders the holders table with
  HUMAN balances (389782179.81523 — live p5 via get_objects in-page),
  linked account ids, raw JSON pre, "Index: reachable" strip.
- Browser-gated PENDING (tester): human click-through, name→id resolve
  against a live node, non-BTS precision display check (see §4), raw-console
  hand-run. No broadcast exists on this desk (nothing to fire).

## 4. Raw→human vectors

- `38978217981523` (BTS p5, live precision via in-page get_objects) →
  `389782179.81523` — OBSERVED rendered in headless Chromium (§3 shot).
- Agg: counts 283072/690k total → `41.0%` via `Format.pct1` (integer math,
  truncation per top-ops vectors); generic rule restated in-desk
  (`2000` → `20%`).
- Block heights/heights are plain ints (stated in-desk, never "converted").
- PENDING-tester: one non-BTS precision display vector (e.g. holders of
  1.3.121) — precision plumbing is unit-covered (precMap vectors) and
  live-proven for p5; the pN render needs one human run.

## 5. Themes + viewports

- Trio + phone saved: `notes/es-lab-proof-ref.png` (ref-ui, results proof),
  `es-lab-trio-light.png` (vanilla-ui-theme), `es-lab-trio-dark.png`
  (dex-ux-theme), `es-lab-phone.png` (390px — stacks, full-width boxes,
  table scrolls via xplore-scroll, ≥44px targets). No new CSS; zero hex
  literals in slice JS (grep-verified). Viewport meta present (index.html:5);
  uint boxes use `inputmode=numeric`.
- Human tester pass (click flow at both widths): PENDING, same gate as
  slices 2–17.

## 6. Headers + descriptions

- All four files open with owns/consumes/globals/refs headers; every
  non-trivial function documents params/return/failure. No TODO/FIXME/
  commented-out code, no `eval`, no direct `fetch` outside HistoryCap
  (grep-verified), no `innerHTML`. `resolveIds` no-op helper deleted in
  Task 7 (caught by re-read, not shipped).
- Known debt: `es-lab-ui.js` 595 lines (split-candidate → slice-18).

## 7. Anti-rot gate (AGENTS.md §4.5)

- (a) 2036 test: catalog is in-repo data, UI is platform DOM + platform
  fetch-via-one-seam, single ES_BASE constant. Host gone → honest panels.
  Yes, still runs.
- (b) New dependencies: none. No package, no CDN, no build step; 4 static
  files + wirings + dict keys. `check_rot.py`: only the pre-existing
  `globals.d.ts` note (dev-only, predates this slice — same as api-lab).
  `check_types.sh`: PASS. `check_i18n.py`: PASS.
- (c) Smallest deletable subset: the raw console + agg template could go
  and curated lookups still work — kept because the owner ordered
  full-featured (casual + power + dev); each deletes to one entry + one
  branch. `EsLabResults` could fold back into the desk shell — kept split
  per §3.7 (it is the split the shell's size demanded).
