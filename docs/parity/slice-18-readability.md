# Slice 18 readability note — final pass (principle #8)

Method: full read-only audit of all 60 `js/*.js` + css + index.html (§3.7),
then three behavior-identical fix workers. Every file: node --check green,
rot gate green, drift gate green; 8-route headless smoke, zero console errors.

## Splits landed (all behavior-identical, byte-proven where load-bearing)
- settings.js 443→204 (+ settings-nodes.js 290, settings-prefs.js 114;
  `render:59` decomposed into section builders).
- market-ui.js 1329→123 shell (+ market-picker.js 337, market-desk.js 665,
  market-ind.js 436).
- trade-ui.js 1206→71 shell (+ trade-form.js 982, trade-cancel.js 389;
  `row:893`→`confirmRow`).
- vote-ui.js 952→748 (+ vote-slate.js 323; 10 state fns described).
- explorer-assets.js 786→496 (+ explorer-render.js 451; `fillValue` documented).
- tx.js 2674→2411 (+ tx-send.js 295: envelope/fee/sign/send; op-0/6/63 byte-proof).
- transfer-ui.js 579→373 (+ transfer-confirm.js 324).
- market.js 542→364 (+ market-candles.js 272).
- market-charts.js 638→328 (+ charts-lwc.js 493).
- Headers upgraded to full shape: chain, store, router, app, settings.
- Descriptions added: chain/store/router/app/format + ~120 one-liners
  repo-wide (non-trivial first, trivial via per-file header notes).
- Dead code deleted (caller-proven zero): vote.js ×3, explorer.js ×2 (+TXID_RE),
  htlc.js chainLimits, crypto.js passwordKeys, credit.js ×2, credit-samet.js
  fundsByAsset, proposal-misc.js claimables, pool.js shareBack.
  Kept-as-seams (wired): pool.js shareOut/listForm (tooling probes),
  VoteUI._test + ExplorerAssets._test (headless seams, noted).
- Renames: htlc map×2 → mapHtlcRows/mapPermRows; trade row:893 → confirmRow.
- Cleanups: market-orders dup Consumes block; tx.js op-6/7 typo; U() ×8 header
  notes; crypto f/KL/KR/rol documented as RIPEMD-160 rounds.

## Written exceptions (kept whole, justification recorded)
- tx.js 2411 — serializer REGISTRY: one registry property + per-fn provenance
  chain; splitting by op family breaks both for zero readability gain.
- trade-form.js 982 — ONE form flow (single+scaled+expiry+fee+send); halves
  would be arbitrary cuts through one state machine, fully described.
- market-desk.js 665 — ONE desk (render/fill/cleanup); children already
  extracted (picker/ind/book/orders); halves would strand shared state.
- vote-ui.js 748 — shell+proxy+publish after slate extract; state core out,
  remainder is one screen flow, fully described.
- crypto.js 743 — single-purpose crypto; ripemd split would leave ~600 lines
  + a load-order edge for zero gain (recorded, not deferred).
- proposal-ui.js 566 — shared `_ui` toolkit host (~290) + views (~190);
  consumers bind to `ProposalUI._ui` names; split would scatter the toolkit.
- account-ui.js 502, explorer-assets.js 496, explorer-render.js 451,
  market-ind.js 436, charts-lwc.js 493, htlc.js/htlc-ui.js ~420 — one coherent
  view/layer each, fully headered + described + dead-free; further splits
  would be arbitrary. Revisit if any grows: the cap still bites on growth.

## Audits on the pass
- TODO/FIXME/XXX/HACK: zero across vanilla/js + css.
- console.*: one intentional dev warn (i18n missing-var), never user-facing.
- Duplication: all cross-file copies documented WHY (doctrine rule 5);
  `U()` ×8 + chrome noted per file.
- Behaviors narrated-not-WHY: none systemic found.
- Total: 25,851 lines across 70 JS files; index.html load order = dependency
  order; routes all resolve; smoke screenshots read (market desk + explorer
  pixel-faithful post-split).

## Anti-rot gate (§4.5): (a) yes — comments + file moves only, zero new deps;
(b) nothing new depended on; (c) n/a (subtractive pass). `check_rot.py` PASS.
