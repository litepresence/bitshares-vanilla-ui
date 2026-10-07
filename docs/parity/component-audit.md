# Component Audit — full sweep round 1 (2026-10-07)

## Implementation status (2026-10-07 session — all recs actioned, zero new deps)

Plan: `docs/superpowers/plans/2026-10-07-component-recs.md`. Gates green at
close: `node --check` on every touched file, `check_rot.py` PASS,
`check_types.sh` PASS, `check_i18n.py` OK (3737 keys, 4926 call sites).
Testnet sign/broadcast + theme/phone screenshots remain HUMAN follow-up.

- Rec 1 DONE: `transfer-ui.js` input↔select swap → stable INPUT + `datalist#xfer-asset-list` (`refreshAssetList`; To-field :467-485 precedent). No new strings.
- Rec 2 DONE: non-blocking blur pre-checks on registry inputs — `samet-ui.js` (asset→`Asset.describe`), `proposal-ui.js` (4 account fields→`Account.resolve`), `referrals-ui.js` (reuses `fail()` mapping), `credit-detail-ui.js` (borrower + collateral asset), `gateway-ui.js` (deposit account, guarded backend probe), `htlc-ui.js` (to + asset), `barter-ui.js` (both peers). New shared key: `common.unknown_asset` (+`common.page_n` below); account side reuses `common.unknown_account` / `htlc.unknown_account`.
- Rec 3 DONE (corrected scope): account "all"-history pager — Prev/`Page %(n)s`/Next over the `get_account_history` cursor (`api/account.js`: `history()` gained optional `start`, new pure `histRowId()` seam; `account-ui.js` cursor stack + over-fetch hasNext + stale-turn token + page-0-only notify watcher). CORRECTIONS to round-1 rows: `explorer-assets.js` already pages (Prev/Next + rows-per-page, `explorer.prev/next`); `explorer-blocks.js` is a head-anchored live view (no list cursor to page); `pool-detail-view.js` tape is chain-capped ≤101 (a pager would be fake); filtered transfer/fill history stays 20-latest (no multi-type merge cursor). Labels reuse `pool.prev_btn/next_btn` (sibling-portfolio precedent) + new `common.page_n`.
- Rec 4 DONE: `DOM.skel(wrap, rows)` (+`globals.d.ts` decls) rendering aria-hidden shimmer rows; `app.css` `.skel*` reusing `candy-shimmer` (tokens only, §8 reduced-motion list extended — pre-existing shimmer covered only status lines, not layouts). Wired into dashboard balances/history, fills panel (both paths), pool list, account balances + open orders. Canvas loads (pool-net graph, fills map) SKIPPED with reason (no row layout; status line stays).
- Rec 5 DONE: duration preset chips on `barter-ui.js` (+24h/+3d/+7d → datetime-local; none/1h/1d → review seconds) and `proposal-ui.js` (same, `fE`/`fR`); `htlc-ui.js` `secsPicker` cited as the house precedent. Chip labels are duration symbols (no new keys); none-chips reuse `barter.none` / `proposal.none`.
- Rec 7 VERIFIED CONFORMING (no code change): sweep of `market-orders` (11 tips), `market-ind-panes` (10), `market-desk` (8) found titles only as named-control hints (aria-labels present; gear button uses text + `aria-disabled`) or redundant full-precision disclosure beside visible values + visible notes. No critical-info-only-in-tooltip found.
- Rec 8 CORRECTED (no code change): the "zero-empty" signal was a grep artifact — `fees-ui` (error/offline/dash rows), `market-ui`/`vote-ui`/`prediction-ui`/`trade-form` (pure facades, bodies own empties), `news-ui` (documented honestly-static), worker/ticket/vesting/activity (error panels + honest notes) all degrade honestly.
- Rec 9 DONE (2 of 3): header-only `.ca-steps` steppers (`app.css`, tokens only) on `create-account-ui.js` (name→brainkey→register, tracked via `P.checked`/register flow) and `barter-ui.js` (build→preview→propose, tracked via `lastPreview`/propose click). New keys: `createaccount.step_*` + `barter.step_*` (short labels; English stubs). PROPOSAL SKIPPED with reason: its review stage lives inside shared `reviewSection` — a stepper that cannot track position honestly is decoration (wisdom rule).
- Rec 10 DONE: `explorer-ui`/`explorer-assets`/`prediction-flows` verified conforming (type=search + aria + touchable + debounce/listbox where applicable); fixed `favourites-ui.js` unnamed add-form inputs (aria-label mirrored from placeholder) and `es-lab-ui.js` filter missing touch floor. No new keys.
- i18n incident log: two script slips caught BY the gate (en `barter`-ns mis-insert; `pool.prev_btn/next_btn` first-match deletion) — both repaired, `check_i18n.py` green. Dormant `barter.prev_btn/next_btn/page_n` keys (no call sites) left untouched per `collect_i18n_orphans.py` reporting 0 orphans.
- Retro-breaks shipped (3, all token-styled with before/after in rows above): history pager row, duration chips, steppers. Everything else restyles nothing.

Skill: `skills/component-wisdom/SKILL.md` (hybrid wisdom from the 20 benchmark
systems at uiguideline.com/systems; 38 free components enumerated, Pro
families marked [inferred] — detail pages are paywalled, no Pro content claimed).
Policy: zero-dep + shared-utils inviolable; retro may break only with a
before/after UX justification (user-approved 2026-10-07).

Method: signal sweep over all 78 files in `vanilla/js/views/` (counts below:
table/overlay/confirm/forms/search/empty + select/tip/badge/load/page/step/
slider/choice), plus deep reads of transfer-ui, market-picker, dashboard-ui,
pool-ui (pager), barter-ui (datetime), trade-core (expiration select),
asset-feed-ui (range select). Live phone+desktop screenshot verification is a
follow-up round — this round is code-evidence; no behavior is claimed from
unread lines.

## Top 10 recommendations (ordered by money-risk × reach)

### 1. Transfer asset field: input↔select swap → true Combobox (HIGH)
- Where: `vanilla/js/views/transfer-ui.js:487-494` (swappable input/select),
  `:945` (swap comment).
- Wisdom: Combobox (Ant/Primer/Radix consensus) — ONE control accepting typed
  symbols AND offering the validated list; swapping control types under the
  user breaks focus/mental model and mobile keyboards.
- Vanilla mapping: keep `Forms.fieldRow` + `input list=`datalist (already at
  `:483` for the To field) for both To and Asset; validate via symbol→1.3.x
  lookup, never a bare select. Effort M. Retro: none (same row styling).

### 2. Chain-object pickers: raw text inputs → Search+Menu (HIGH)
- Where: `samet-ui.js:360-362` ("symbol or 1.3.x"), `proposal-ui.js:614-619`
  ("name or 1.2.N"), `referrals-ui.js:155`, `credit-detail-ui.js:256`,
  `gateway-ui.js:399-403`, `htlc-ui.js` search=4 but no menu signals.
- Wisdom: Selection&Pickers rule — every registry object (account/asset)
  gets Search + filtered Menu + keyboard + empty state (`market-picker.js`
  precedent, `:486-502`: `type="search"`, aria-label, touchable, scroll region).
- Vanilla mapping: `Forms.labeledInput` + suggestion list + `Event.delegate`
  + `get_account_by_name` validation. Effort M–L per view. Retro: none.

### 3. Propagate the pool pager to unpaged long lists (MED)
- Good precedent: `pool-ui.js:630-634` (page-size select 10/25/50 + Prev/Next,
  over-fetch for hasNext, no invented totals) and `account-ui.js:490,566`
  (portfolio paging).
- Gaps (no pager signals): `account-history.js`, `explorer-blocks.js`
  (table=1, empty=7), `explorer-assets.js`, `pool-detail-view.js` (empty=21 —
  longest empty handling, but page=0). Chain data suits Pagination over
  infinite scroll (stable position, testable).
- Vanilla mapping: copy the pool pager shape + `TableRenderer`. Effort M.
  Retro: justified addition — before (endless/uncapped list), after (Prev/Next
  + size); same tokens, new control row.

### 4. Skeletons for known layouts, spinners stay for unknown waits (MED)
- Signal: `DOM.status`/loading hits are heavy (`account-ui` 34, `account-
  membership` 21, `prediction-flows` 17, `pool-net-ui` 16) with zero Skeleton
  usage anywhere (grep: no hits).
- Wisdom: Feedback family — known layout loading (balance rows, orderbook,
  pool rows) → Skeleton rows matching final layout; unknown waits → Spinner;
  known-duration tasks → Progress Bar.
- Vanilla mapping: CSS-only skeleton rows in `themes.css` tokens + `DOM`
  swap on data arrival; first targets: dashboard balances, market-desk
  panels, pool table. Effort M. Retro: none.

### 5. Durations, not raw seconds + datetime-local alone (MED)
- Where: `barter-ui.js:220-221` (`datetime-local` + raw "review period
  seconds"), `proposal-ui.js:621` (seconds input). Good: `trade-core.js:144`
  expiration `labeledSelect` precedent.
- Wisdom: Date Picker family — chain users think in durations; offer preset
  chips (1h / 1d / 3d / 7d / custom) syncing to the underlying seconds/ISO.
- Vanilla mapping: `Forms` chips + existing inputs as custom path. Effort S–M.
  Retro: justified addition (chips row, same tokens).

### 6. Keep the conforming selects (NO CHANGE — cite as good)
- `asset-feed-ui.js:296` (Range 7d/30d/90d), `create-worker-ui.js:200` (pay
  destination), `market-desk-panels.js:229` + `pool-detail-view.js:1173,1392`
  (Side filter), `transfer-ui.js:535-537` (fee asset), `ticket-ui.js:72`,
  `trade-core.js:144` — all <8 static options → Select is the wise choice.
  No action.

### 7. Tooltip sweep: hints only, never critical info (LOW-MED)
- Signal: tooltip/aria-label density highest in `market-orders` (11),
  `market-ind-panes` (10), `market-desk` (8), `instant-trade-ui` (6),
  `pool-detail-view` (6), `explorer-assets` (5). No `title="` tooltips found
  (good — all via aria-labels presumably on icon buttons).
- Rule: 1-line icon-button hints stay; any paragraph or critical value found
  only in a tooltip moves to visible text or tap-safe Popover (phone has no
  hover). Effort S per fix. Retro: none.

### 8. Empty-state floor: 6 views with zero empty signals (LOW)
- Zero-empty views: `fees-ui`, `market-ui`, `prediction-ui`, `vote-ui`,
  `explorer-blocks-activity`, `trade-form` (also `es-lab-results` low at 2
  but non-zero). Longest handling (`pool-detail-view` 21, `pool-ui` 16,
  `prediction-flows` 15) is the model.
- Wisdom: Empty State = icon + sentence + action (open settings / retry /
  create). Vanilla: `DOM.status`/`DOM.error` + action link
  (`HistoryNotice.actionLink` precedent). Effort S. Retro: none.

### 9. Stepper headers for multi-step builders (MED, retro-break)
- Candidates: `create-account-ui` (step=0), `barter-ui` (one long proposal
  form, `:220-331`), `proposal-ui` (long builder), wallet import flows.
  Only stepper signals in app: `borrow-ui` (5) and `dashboard-ui`/`tour-ui`
  (1 each).
- Wisdom: Stepper shows position + allows back in ordered flows.
- Vanilla mapping: header-only stepper (no new deps), `Forms` sections
  unchanged. Effort M. Retro: JUSTIFIED BREAK — before (single long form),
  after (numbered step header, same tokens); improves completion on phones.

### 10. Search quality propagation (MED)
- Reference: `market-picker.js:486-502` (search + aria + touchable + scroll
  region + favourites). Thinner pickers: `explorer-ui.js` (search=1),
  `favourites-ui.js` (1), `explorer-assets.js` (1), `es-lab-ui.js`
  (filter input `:175`), `prediction-flows.js:274` (filter).
- Wisdom: every chain-data picker gets debounce + typo-tolerance + keyboard
  + empty state (principle #4 release blocker).
- Vanilla mapping: market-picker pattern + `Event.delegate`. Effort M.
  Retro: none.

## Family verdicts

| Family | Verdict |
|---|---|
| Navigation (Menu/Tabs/Stepper/Pagination/Link) | Menu + account search solid; Tabs need APG keyboard check; Pagination correct in pools/portfolio, missing elsewhere (rec 3); Stepper missing in builders (rec 9) |
| Forms & Input | `Forms.*` adoption excellent (27 hits asset-manage, 18 borrow, 16 asset); `inputmode="decimal"` discipline present; gaps are picker-type choices (recs 1–2, 5) |
| Feedback & Status | Alert banners + notify host + toasts exist; Badge/Tag usage light and sane; Skeleton absent (rec 4); empty states broad but uneven (rec 8) |
| Data Display | `TableRenderer` where it counts (5 views); cards for summaries; no Carousel abuse (tour only); Avatar sane |
| Overlays & Disclosure | `ConfirmDialog` on all money builders read (9 asset-manage, 4 borrow, 3 pool/feed); `Overlay` rare (1 credit-ui) — check undisclosed custom dialogs; tooltips need content sweep (rec 7) |
| Selection & Pickers | market-picker is the house reference; raw-input pickers are the top money-risk gap (recs 1–2, 10) |

## Full per-view triage (signal-based; D = deep-read this round)

| View | Signals (tbl/ovl/cfm/frm/srch/empty \| sel/tip/bdg/load/pg/stp) | Verdict |
|---|---|---|
| about-ui.js | 0/0/0/0/0/1 \| 0/1/0/8/0/0 | Static page; loading=8 is status lines — keep; no action |
| account-history.js | 1/0/0/0/0/9 \| 0/2/0/0/0/0 | Table+empty good; needs pager (rec 3). M |
| account-membership.js | 0/0/0/0/0/9 \| 0/0/0/21/0/0 | Status-heavy; skeleton candidate (rec 4). M |
| account-ui.js (D) | 0/0/0/1/0/11 \| 0/5/3/34/9/0 | Reference for paging+empty; skeleton candidate; tooltip check (recs 4,7). M |
| accounts-ui.js | 0/0/0/3/0/3 \| 0/0/0/0/0/0 | Forms good; picker needs Search+Menu (rec 2). M |
| api-lab-ui.js | 0/0/0/0/0/1 \| 0/3/0/1/0/0 | Dev tool; empty-state light — acceptable; no action |
| asset-feed-ui.js (D) | 1/0/3/13/0/6 \| 1/1/2/5/0/0 | Conforming select + confirms; keep |
| asset-manage-ui.js | 0/0/9/27/0/1 \| 1/0/0/1/0/0 | Confirm/Forms exemplary; keep |
| asset-ui.js | 0/0/2/16/0/4 \| 0/0/0/1/0/0 | Solid builder; keep |
| auth-ui.js | 0/0/0/4/0/10 \| 0/4/7/0/0/0 | Badges (7) — verify they are status, not static text. S |
| barter-ui.js (D) | 0/0/1/9/3/1 \| 0/1/0/1/0/0 | Needs duration presets + stepper (recs 5,9). M |
| borrow-ui.js | 0/0/4/18/1/6 \| 0/1/0/3/0/5 | Step signals present — verify stepper pattern reusable. S |
| create-account-ui.js | 0/0/0/3/0/2 \| 0/0/0/1/0/0 | Needs stepper header (rec 9). M |
| create-worker-ui.js | 0/0/0/9/0/0 | Empty=0 — needs empty/error states (rec 8). S |
| credit-detail-ui.js | 0/0/0/2/0/3 \| 0/0/0/3/0/0 | Picker needs Search+Menu (rec 2). M |
| credit-ui.js | 0/1/1/2/4/9 \| 0/4/0/4/0/0 | Overlay+confirm present; keep; tooltip check. S |
| dashboard-ui.js (D) | 0/0/0/0/0/7 \| 0/0/0/6/0/1 | Landing+dashboard; skeleton candidate for balances (rec 4). M |
| debit-ui.js | 0/0/0/0/0/2 \| 0/0/0/2/0/0 | Small; keep |
| es-lab-results.js | 0/0/0/0/0/2 \| 0/0/0/0/0/0 | Results renderer; keep |
| es-lab-ui.js | 0/0/0/0/0/6 \| 0/2/0/0/0/0 | Filter input good; keyboard check (rec 10). S |
| explorer-assets.js | 0/0/0/1/1/10 \| 0/5/12/6/0/0 | Badge-heavy (12) — verify status use; needs pager+search depth (recs 3,10). M |
| explorer-blocks-activity.js | 0/0/0/0/0/0 \| 0/0/14/0/0/0 | Badge 14, empty 0 — needs empty states (rec 8). S |
| explorer-blocks-detail.js | 0/0/0/0/1/2 \| 0/1/1/3/0/0 | Breadcrumb context good; keep |
| explorer-blocks.js | 1/0/0/0/0/7 \| 0/2/12/2/0/0 | Table good; badges verify; pager (rec 3). M |
| explorer-render.js | 0/0/0/0/0/1 \| 0/1/1/0/0/0 | Shared renderer; keep |
| explorer-ui.js | 0/0/0/0/1/3 \| 0/2/0/3/0/0 | Search exists; keyboard/typo check (rec 10). S |
| favourites-ui.js | 0/0/0/0/1/5 \| 0/1/0/0/0/0 | Search exists; keyboard check. S |
| fees-ui.js | 0/0/0/0/0/0 \| 0/2/0/1/0/0 | Zero empty — needs empty state (rec 8). S |
| gateway-ui.js | 0/0/0/4/2/2 \| 0/1/0/3/0/0 | Account input needs Search+Menu (rec 2). M |
| help-ui.js | 0/0/0/0/0/9 \| 0/0/1/1/0/0 | Accordion candidate for FAQ ([inferred]); keep styling. S |
| htlc-ui.js | 0/0/2/1/4/5 \| 0/3/0/4/0/0 | Confirms good; picker depth (rec 2). M |
| instant-trade-ui.js | 0/0/0/1/1/11 \| 0/6/0/4/0/0 | Empty good; 6 tips — content sweep (rec 7). S |
| market-desk-fill.js | 0/0/0/0/0/3 \| 0/1/0/12/0/0 | Loading 12 — skeleton candidate (rec 4). M |
| market-desk-panels.js | 1/0/0/4/1/3 \| 1/2/0/2/0/0 | Conforming table/select; keep |
| market-desk-query.js | 0/0/0/0/0/1 \| 0/0/0/0/0/0 | Query helper; keep |
| market-desk.js | 0/0/0/0/0/7 \| 0/8/0/8/0/0 | 8 tips — sweep (rec 7); skeleton candidate. M |
| market-ind-panes.js | 0/0/0/0/0/11 \| 0/10/0/3/0/0 | 10 tips + 51 choice hits — verify control labelling; sweep. M |
| market-ind-series.js | 0/0/0/0/0/0 \| 0/0/0/0/0/0 | Helper; keep |
| market-ind.js | 0/0/0/0/0/0 \| 0/0/0/0/0/0 | Helper; keep |
| market-orders.js | 0/0/2/4/1/7 \| 0/11/1/6/0/0 | 11 tips — sweep (rec 7). M |
| market-picker.js (D) | 0/0/0/0/2/5 \| 0/5/0/1/0/0 | HOUSE REFERENCE — propagate pattern (rec 10) |
| market-ui.js | 0/0/0/0/0/0 \| 0/0/0/1/0/0 | Thin facade; needs empty state (rec 8). S |
| menu-ui.js | 0/0/0/0/0/5 \| 0/1/0/0/0/0 | Keep |
| misc-ui.js | 0/0/0/1/1/5 \| 0/3/0/1/0/0 | Mixed small views; keep |
| news-ui.js | 0/0/0/0/0/0 \| 0/0/0/1/0/0 | Static; needs empty/error state. S |
| notify-host.js | 0/0/0/0/0/0 \| 0/2/0/0/0/0 | Toast host; keep |
| notify-ui.js | 0/0/0/0/0/2 \| 0/1/2/0/0/0 | 14 choice hits = rule toggles — verify Switch-vs-Checkbox (Switch correct for immediate settings). S |
| ops-ui.js | 1/0/0/0/0/0 \| 0/1/0/1/0/0 | Keep |
| password-ui.js | 0/0/0/1/0/1 \| 0/0/0/0/0/0 | Keep |
| pool-detail-actions.js | 0/0/0/0/0/8 \| 0/0/0/0/0/0 | Keep |
| pool-detail-ui.js | 0/0/0/0/0/0 \| 0/0/0/0/0/0 | Facade; keep |
| pool-detail-view.js | 0/0/0/7/0/21 \| 2/6/0/6/0/0 | Model empty handling; selects conform; tooltip sweep. S |
| pool-net-ui.js | 0/0/0/0/0/9 \| 0/4/0/16/0/0 | Loading 16 — skeleton candidate (rec 4). M |
| pool-ui.js (D) | 0/0/3/10/0/16 \| 0/4/1/6/8/0 | Pager reference; keep; tooltip check. — |
| prediction-flows.js | 0/0/3/1/1/15 \| 0/5/0/17/6/0 | Page=6 signals — verify pagination shape; loading 17 skeleton candidate. M |
| prediction-helpers.js | 0/0/0/0/0/3 \| 0/0/0/0/0/0 | Helper; keep |
| prediction-ui.js | 0/0/0/0/0/0 \| 0/0/0/0/0/0 | Facade; needs empty state (rec 8). S |
| proposal-ui.js | 0/0/1/11/0/11 \| 1/5/11/4/0/0 | Badge 11 — verify; picker+duration (recs 2,5). M |
| referrals-ui.js | 0/0/0/2/1/3 \| 0/0/0/12/0/0 | Loading 12 — skeleton/status check; picker (rec 2). M |
| samet-ui.js | 0/0/0/10/0/1 \| 0/0/0/1/0/0 | Pickers (rec 2); percent inputs keep numeric. M |
| ticket-ui.js | 0/0/0/8/1/0 \| 1/0/0/2/0/0 | Empty=0 — needs empty states (rec 8). S |
| top-ops-ui.js | 0/0/0/0/0/3 \| 0/2/0/3/0/0 | Keep |
| tour-ui.js | 0/0/0/0/0/0 \| 0/3/0/1/0/0 | Carousel correct context; keep |
| trade-core.js (D) | 0/0/0/1/0/1 \| 1/1/0/1/0/0 | Expiration select reference; keep |
| trade-form.js | 0/0/0/0/0/0 \| 0/0/0/0/0/0 | Facade/helper; keep |
| trade-panels.js | 0/0/0/12/0/4 \| 1/2/0/4/0/0 | Forms-heavy correct; keep |
| trade-ui.js | 0/0/0/0/0/0 \| 0/0/0/0/0/0 | Facade; keep |
| transfer-preview.js | 0/0/0/0/0/0 \| 0/1/0/0/0/0 | Helper; keep |
| transfer-propose.js | 0/0/1/0/0/0 \| 0/2/0/0/0/0 | Confirm correct; keep |
| transfer-ui.js (D) | 0/0/0/11/0/9 \| 2/0/0/8/0/0 | Combobox upgrade (rec 1); fee select keep. M |
| trollbox-ui.js | 0/0/0/0/0/3 \| 0/3/11/6/0/0 | Badge 11 — verify channel/status use. S |
| txbuilder-ui.js | 0/0/0/0/0/2 \| 0/4/11/0/0/0 | Badge 11 — verify op-type labels vs Tag use. S |
| vesting-ui.js | 0/0/0/0/0/0 \| 0/1/0/1/0/0 | Thin; needs empty state. S |
| vote-ballot.js | 0/0/0/2/1/7 \| 0/1/1/3/0/0 | Search exists; keep |
| vote-gov.js | 3/0/0/6/0/2 \| 0/0/0/2/0/0 | 3 tables — verify TableRenderer sort/filter; keep. S |
| vote-slate.js | 0/0/0/0/1/3 \| 0/2/0/0/0/0 | Keep |
| vote-ui.js | 0/0/0/0/0/0 \| 0/0/0/0/0/0 | Facade; needs empty state (rec 8). S |
| wallet-ui.js | 0/0/0/6/0/5 \| 0/1/0/0/0/0 | Stepper candidate for import flows (rec 9). M |

## Constraint check (per audit row)

- Zero-dep: all recs implementable with DOM/Forms/Overlay/ConfirmDialog/
  TableRenderer/Event + CSS tokens. No new dependency proposed.
- Shared-utils: every rec names its global; no local helper copies.
- Retro: recs 3 (pager rows), 5 (duration chips), 9 (stepper headers) add
  controls the old UI lacks — each carries its before/after note above.
  All others restyle nothing.

## Follow-up rounds

- R2: deep-read the M-flagged views above + phone (360–390px) and desktop
  (≥1440px) pass per changed pattern; numeric `inputmode` check; hover-only
  sweep.
- R3: live screenshot trio (ref-ui/light/dark) for changed views +
  keyboard-only run through every picker and stepper.
- Sources re-checked 2026-10-07: `/systems` (20 systems), `/components`
  (38 free + Pro-gated). No paywalled content reproduced.
