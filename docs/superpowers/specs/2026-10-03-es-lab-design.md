# ES Lab (community-index browser) — Design

Date: 2026-10-03. Status: approved (api-lab-twin architecture).
Author: brainstorm with owner.
Scope: one new standalone slice-addition to `vanilla/` — a full-featured,
Swagger-feel browser for the community Elasticsearch index, with curated
searches for casual explorers and a raw Query-DSL console for power users
and devs. No new transport, no build step, no persistence.

## 1. Goal

Serve three audiences from one page: casual explorers (who get plain-language
search forms over operations and holders), power users (block ranges, op-type
filters, paged results, shareable links), and devs/testers (a raw DSL console
for arbitrary bodies against the allowlisted indexes, plus in-desk proof of
the query shapes the wallet itself uses). The api-lab desk
(`#/api-lab`, spec `2026-10-03-api-lab-design.md`) is the interaction
precedent: curated boxes AND a raw mirror, kept in sync both ways.

## 2. Decisions (from brainstorm)

- Placement: standalone route `#/es-lab`, linked from the Explorer header +
  footer dev entry (same treatment as `#/api-lab`). Not an Explorer tab.
- Architecture: api-lab twin — `vanilla/js/api/es-lab.js` (query-template
  catalog + pure helpers, no DOM) + `vanilla/js/views/es-lab-ui.js` (the
  desk, DOM only). Rejected: Explorer-integrated panels (spreads the ES
  surface across many files, harder to audit) and notebook-style saved
  queries (new localStorage persistence/privacy surface for a v1).
- Coverage: both allowlisted indexes AND the raw console — ops-by-account,
  ops-by-type, block-range and tx lookup over `bitshares-*`; holders-by-asset
  and balances-by-account over `objects-balance`; index picker + raw JSON
  body editor for arbitrary DSL.
- Transport: `HistoryCap.esSearch` ONLY (`vanilla/js/api/history-cap.js`) —
  no new fetch seam. The `esEnabled` pref gate and the index allowlist are
  therefore enforced twice (catalog + seam). Reads auto-run from deep links
  (safe: read-only, and shareability is the point).
- Consent: NO advanced-use gate (reasoned deviation from api-lab, which gates
  because broadcasts move funds — nothing here moves anything). The consent
  layer is the existing `esEnabled` pref + third-party disclaimer in
  Settings; the desk links to it on every `es-disabled` failure.
- Memory: in-session history only (last ~20 runs, like api-lab). Queries can
  name accounts, so nothing persists across sessions. Saved queries and
  CSV/JSON export are recorded extension points, not v1 scope.

## 3. Doctrine exception (AGENTS.md §4.5)

Prior standing rules refused ES transport (R1c ranked-ops, slice-12 pools,
SLICES.md:154 plots). Those refusals are superseded — not deleted — by the
written-exception architecture the wallet already ships: ES is DATA like a
node URL, pref-gated (default ON per owner ruling), never load-bearing, with
chain fallback or an honest-unavailable panel everywhere it appears
(`pool-history.js`, `market-fills-history.js`, asset top-holders). This spec
extends that exact pattern to a lab desk and adds no new exception.

Removal plan (per §4.5): if `es.bitshares.dev` dies, goes hostile, or loses
CORS, the lab degrades to honest-unavailable panels with zero code changes
required; the two lab files plus route/nav wirings delete cleanly without
touching any wallet feature, since no feature imports them.

## 4. Architecture

Two new files only, plus route + nav wiring:

- `vanilla/js/api/es-lab.js` — catalog + pure helpers, no DOM. Template
  shape: `{ index, title, desc, sourceRef, fields: [{name, type, required,
  example, hint}], build(values) -> ES body, parse(json) -> row array }`.
  Seed templates (v1): over `bitshares-*`: ops-by-account, ops-by-type,
  block-range scan, tx lookup; over `objects-balance`: holders-by-asset,
  balances-by-account. Query shapes mirror astro-ui (`esquery.ts`,
  `TopOperations.ts:15-85`, `TopAssetHolders.ts:30-37`, `TopPoolSwaps.ts`)
  and the wallet's own `pool-history.js` / `market-fills-history.js` /
  holders-section bodies; exact field mapping is verified against live ES
  responses at build time, never guessed. Ground truth for "what the wallet
  already asks" is those three in-tree call sites.
- `vanilla/js/views/es-lab-ui.js` — the desk (DOM only). Builds forms from
  `fields`, mirrors curated<->raw DSL both ways (bad JSON = inline error,
  never sent), calls `HistoryCap.esSearch` (sole ES path), renders a parsed
  table for known shapes + the raw node JSON `<pre>` (escaped) always + a
  human-hint line where the shape is known (`format.js`; raw ints stay raw).
- Router: `#/es-lab` + query `q/params`; `index.html` script tags in
  dependency order (catalog before UI, same as api-lab/explorer).
- i18n: `I18n.t` with verbatim en defaults (slice-17 precedent) AND the
  `en.json` entries (+ stubs) ship in the same commit (api-lab F1 lesson).
- Default template resolved by key lookup, never by catalog index (api-lab
  F2 lesson).

Out of scope: per-query host picker (single `ES_BASE` is canonical data, not
a setting), persisted/saved queries, CSV/JSON export, new indexes (allowlist
change = separate decision), Kibana (no CORS headers — link-only, per the
`HistoryCap` header).

## 5. Layout (Swagger feel, retro skin)

Desktop two-column, phone stacked (principle #7):

- Left: template list grouped by index (`Operations`, `Holders & balances`,
  `Raw console`) + typo-tolerant filter (market-picker precedent,
  keyboard-navigable). A permanent banner states the index covers mainnet
  only + links Settings (testnet honesty, settings-page precedent).
- Right: template card — description + `sourceRef`, curated boxes with example
  placeholders, collapsible raw-DSL mirror, Run / Reset / Copy-link (≥44px
  targets), `esEnabled`/reachability strip (`HistoryCap.esAvailable()` +
  link), results pane (parsed table + raw `<pre>` + hint line).
- Styling: existing retro cards + `themes.css` tokens only; verified in all
  three themes. No new CSS file (doctrine).

## 6. Data flow

1. Select template → build empty form from `fields` (examples as
   placeholders).
2. Typing in curated boxes re-serializes the raw DSL mirror live; editing raw
   re-validates into boxes (bad JSON = inline error, never sent).
3. Run → `HistoryCap.esSearch(index, body, {timeoutMs})` on the canonical
   host (500 hits/page, max 2 pages = 1000 rows, 15s TOTAL budget across
   pages with each page getting the remainder, short-page stop —
   `market-fills-history.js:41-50,168-211` precedent).
4. Success → parsed table + raw JSON + hint; failure → the honest panel for
   its error class (`es-disabled` → Settings-toggle link;
   `es-unavailable` → Retry + Settings link; `es-bad-index` → never
   user-reachable, logged as a bug).
5. Every Run updates the URL (`q + params`) and pushes session history.
   Read templates auto-run from deep links; the raw console loads prefilled
   and waits for Run (pasted bodies deserve one more look).

## 7. Safety + errors

- Read-only by construction: only `_search` POSTs to allowlisted indexes;
   the index travels in the URL path and is validated before every send, so
   arbitrary-host/URL forgery is impossible from this desk.
- Never load-bearing: every failure path lands on an honest notice + action
  link (top-holders `holdersUnavailable` precedent); no blank panels, no
  faked rows, no silent empty tables.
- Offline/slow → slice-1 offline discipline + Retry, never blank. Timeouts
  named per template. No keys/WIFs in DOM; all interpolated strings escaped
  (`textContent`-only insertion); generation-counter teardown on route change
  (api-lab/ops-ui pattern).
- `esEnabled` off → the desk still opens (reads the catalog, shows forms)
  but every Run explains the pref is off and links Settings — the lab never
  nags, never flips the pref itself.

## 8. Verification

- Templates: 2 live vectors each against `es.bitshares.dev` (known
  account/asset/block-range → expected shape), plus one pref-off vector
  proving the honest-disabled panel, plus one unreachable-host vector
  (timeout forced short) proving the honest-unavailable panel.
- Gates: `tooling/check_rot.py` clean, `check_types.sh` (checkJs) clean,
  theme trio + 360px/1440px checks, raw→human vectors for every hinted shape,
  parity note `vanilla/notes/es-lab.md` with the 7 slice fields (ref
  behavior, vanilla file:line, test steps + observed, vectors, trio +
  viewports, headers/descriptions, anti-rot a–c).
- 2036 test: catalog is in-repo data (no remote spec fetch), UI is platform
  DOM + platform `fetch`, single `ES_BASE` constant. If the host is gone in
  ten years, the page still opens and says so honestly.

## 9. Build order

1. `api/es-lab.js` catalog (template bodies verified live first) +
   `index.html` tags + i18n keys in the same commit.
2. `views/es-lab-ui.js` desk (list+filter, form builder, raw mirror,
   run/history/deep-link, honest panels) + `#/es-lab` route + nav links.
3. Raw console + pagination bounds + reachability strip.
4. Live vectors + parity note + audit + screenshots.
