# Slice 11 parity note — HTLC + direct debit + spotlight

Plan: `docs/superpowers/plans/2026-09-28-slice-11-htlc.md` (Tasks 1–4).

## What landed (vanilla file:line)
- `vanilla/js/tx.js` — 7 serializers appended: ops 25/26/27/28 + 49/50/52.
  Op-26 TRAP proven in bytes (start-time BEFORE count vs op-25 order).
  51/53 VIRTUAL never dispatched (explicit comment at dispatch site).
- `vanilla/js/htlc.js` (400) — reads (`htlc`, `mine`, `permissions`,
  `chainLimits`) + builders (`buildCreate/Redeem/Extend`,
  `buildDebitCreate/Update/Claim/Delete`) + `fee` (fills in place) +
  `sendAndProve` + duration/date formatters. sha256-only (vendor/ has no
  RIPEMD-160 — recorded gap, serializer still accepts variant ids 0–3).
- `vanilla/js/htlc-ui.js` (398) — `#/htlc`, `#/htlc/:id`: list, create,
  redeem (local hash-match check), extend; shared `_ui` helpers +
  `routeReady` with auto-resubscribe on connect.
- `vanilla/js/debit-ui.js` (321) — `#/direct-debit` (giver/recipient tables,
  create/update/claim/delete), `#/spotlight` (tile grid + recurring helper
  via slice-6 op-1 path, no-daemon honesty text, zero new serializers).
- Routes `router.js:101-102,110-111`, tags `index.html:58-60`.

## Reference behavior (file:line)
- #4 wins: hash variant `ripemd160(0)/sha1(1)/sha256(2)/hash160(3)`
  (`htlc.hpp:33-43`); objects `1.16.x` HTLC / `1.12.x` permission
  (`types.hpp:375,379`); ground truths `asset_ops.cpp:178`-class evaluator
  rejections observed live (wrong-size, wrong-content, self-debit
  `withdraw_permission.cpp:57`, start-time `..._evaluator.cpp:40`).
- #1 `HtlcActions.js:9-44` rejects sha1 — vanilla offers sha256 + ripemd160
  explicit-hash only. `/spotlight` is #1's `ShowcaseGrid` (no chain op).

## Bugs found by verification, fixed + re-proved
- F-FEEFILL: `Htlc.fee` never assigned `opData.fee` (fee-0 rejects) → single-point
  fill in `Htlc.fee` + `AssetOps.fee`; caller audit: Vote/transfer/trade clean.
- F-DEBITGEN: cross-file gen compare → separate counters (F3 precedent).
- F-MEMO: claim memo used account ids → async memo-key resolve via `get_objects`.
- F2-class (director): no `Store.subscribe` → `autoRetryOnOpen` in `routeReady`
  + spotlight gate (cross-file `isLive` param); stale watchers drained per entry.
- Stale header fees corrected: op-25/26/27 observed 100 raw each (not 1/20 BTS).

## Test vectors (raw → human, real files, live testnet)
- HTLC `1.16.621`: create fee `40000`→`0.40000 TEST`, lock `100000`→`1.00000 TEST`
  — block `100926544`; redeem fee `120000`→`1.20000 TEST` (fee_per_kb) — `100926545`.
- `1.16.622`: extend +300s exact (`12:10:24→12:15:24`) — expiry → virtual op-53
  @`100926739` (refund observed; 53 unbroadcastable by design).
- Cross-account `1.16.623/624` create+redeem as `t9-vanilla-6742`.
- Debit perm `1.12.139`: create fee `100`; limit `500000`→`5.00000 TEST`;
  claim 1.0000 (fee 100 claimant-paid, available `400000` exact) — `100926647/648`;
  op-26 limit →`700000` — `100926648`; op-28 delete fee `0` — `100926649`.
- Serializer: op-49 variant `02` + u16/u32 LE spots; `é`=2 bytes; `86400`→`1 day`.
- Chain limits live: `max_preimage_size 19300`, `max_timeout_secs 2419200`.
- BJS cross-check (audit follow-up): `bitshares/bitsharesjs` master
  `lib/serializer/src/operations.js`, fetched 2026-09-27 — file history shows
  last change May 3, 2022 (`e262273`, claim_fees ext) and HTLC serialization
  stable since Apr 5, 2019 (`664e8c7`); all 7 op orders match #3/#4, no conflicts.
- `usedPct` percent vector (audit follow-up, verbatim `debit-ui.js:25-31`
  integer math): `100000/500000`→`20.00%` (live claim state), `0/500000`→`0.00%`,
  `1/3`→`33.33%` (integer floor truncation, documented).
- Non-p5 amount vector (audit follow-up, real `Format.formatAmount`):
  `500000` p2 → `5000.00`. Slice-11 chain traffic was all p5 TEST (no non-p5
  HTLC/debit exists in our fixtures); the shared display path is slice-3-proven
  (p2/p4/p6/p8).
- Leftover (intentional): `1.16.625` 0.5 TEST self→self, preimage lost mid-run,
  expires ~13:30 UTC 2026-09-27, auto-refunds.

## Manual test (headless, --network testnet, zero console errors)
- `#/htlc` blue/dark/light @1440 + 390: Sent/Received tables, create form,
  named confirms (49/50/52 with length-only preimage row, `preimageLeaked:false`
  asserted in-DOM), hash-match green/red states, unknown-HTLC empty state.
- `#/direct-debit` renders (post-F-DEBITGEN); `#/spotlight` tiles stack.
- Preimage secrecy: visible only in own form input pre-broadcast; redeem confirm
  shows length + hash-match only.

## Tester pass (queued)
- Create→redeem→extend + debit create→claim→delete visuals; spotlight tiles;
  light theme; 390 scroll.

## Anti-rot gate (§4.5): (a) yes — static + existing Tx/Chain/Crypto reuse, no new
crypto vendored; (b) nothing new depended on; (c) smallest deletable: spotlight
page (HTLC/debit stand). `check_rot.py` PASS.
