# TxBuilder parity note — multi-account multi-op composer (Tasks 1–8)

Plan: `docs/superpowers/plans/2026-09-30-txbuilder.md` (Task 8 vectors T1–T6).
Code: `vanilla/js/txbuilder.js` (561 lines, state + fee/build/export/import +
auth/sign + describe + wrap/broadcast), `vanilla/js/txbuilder-ui.js` (163
lines, `#/txbuilder` desk + badge), route `router.js`, tags `index.html`,
badge hook `app.js`, outlets in `transfer-confirm.js` / `vote-ui.js` /
`pool-ui.js` (Tasks 5+7, unchanged here except the T8 fix below).

## What landed in Task 8

- Fix (vector-exposed, committed before this note): `TxBuilder.feeAll`
  read `ans.perOp`, but shipped `Tx.feeMulti` (`tx-send.js:195-199`)
  answers `{fees, totalRaw, totalDisplay}` — `perOp` exists only on the
  Task-2 unit stub. Live bundle quoting threw
  `Cannot read properties of undefined (reading 'map')`. Fix:
  `txbuilder.js` feeAll accepts `ans.perOp || ans.fees` (both shapes),
  throws `tb-bad-envelope` when neither is a list. Offline stub vectors
  (perOp shape) still pass; `{fees}` shape proven (`TB8-FEESHAPE-OK`).
- This note (`vanilla/notes/txbuilder-parity.md`): T1–T6 evidence below.
  No other code changed.

## Reference behavior (file:line)

- #4 wins: op 0 = `transfer_operation`, op 6 = `account_update_operation`
  (`operations.hpp:62`); fee truth is live `get_required_fees`, never
  estimated (per #3720 — composer makes exactly ONE call per bundle).
- #3 `popup.js` 78-op table is the confirm-wording spec; composer
  `describe` rows follow it (From/To/Amount/Fee, raw in `title`).
- #1 `MarketClasses.toReal` math is NOT reimplemented — display goes
  through the single `Format.formatAmount` module (principle #6).

## Testnet proof T1 — 2-op bundle end-to-end (testnet.dex.trading, chain 39f5e2ed)

Bundle (same payer, two ops — self-transfer is consensus-illegal, so the
transfer goes to `committee-account`): op-0 dust `1.2.26833
(lite-test-1) → 1.2.0` amount raw `10000` + op-6 vote no-op re-publish
(current options verbatim: `voting_account 1.2.25483`, `num_witness 0`,
`num_committee 0`, `votes []` — harmless, chain left as found).

- Fees: ONE `get_required_fees` call (spied on `Chain.call`);
  per-op `86869@1.3.0 + 5764@1.3.0`, `totalRaw 92633 == BigInt sum`,
  `totalDisplay 0.92633 TEST`. (Op-6 `5764` reproduces the slice-08
  vector exactly.)
- Human rows: op-0 `Amount = 0.10000 TEST` (raw `10000` in `title`
  only — never bare on screen); op-0 `Fee = 0.86869 TEST`; op-6 rows
  `Account = lite-test-1 (1.2.26833)`, `Voting account = 1.2.25483`,
  `Votes = 0 selected`, `Fee = 0.05764 TEST`.
- Auth: one row `lite-test-1 active threshold 1 missing:false`,
  `availablePubs [TEST7MBQ…]` (fixture active pub, in memory only).
- Build: `ref_block_num 27486 ref_block_prefix 1323604721`,
  `expiration 2026-09-30T21:31:21`, 2 ops.
- Envelope: `{app bts-vanilla-txbuilder, v 1, chain 39f5e2ed}`,
  `tx.operations` deep-equals `ops`, zero secret substrings
  (`wif|priv|brainkey|password` scan clean), `serializeTransaction`
  hex byte-identical across clear+import (96 bytes).
- Sign: `signed [TEST7MBQ…]` (one active sig satisfies both ops),
  `stillMissing []`.
- Broadcast: `via broadcast_transaction_with_callback` (no fallback
  needed); provers BOTH `observed` — op-0 history content-match at
  **block `101018463/0`** (head before `101018461`), op-6 slate
  re-read `voting_account 1.2.25483 votes []`.
- Balances: `3873890 → 3771257` (`38.73890 → 37.71257 TEST`);
  spend `102633 = 10000 dust + 92633 fees` exact.
- Verdict: `TB8-LIVE-PROVEN` (script `/tmp/tb8-live.mjs`, fixture keys
  in memory only, never printed or written).

## T2 — missing-key honesty (live reads, keys parked)

Transfer FROM `1.2.0` with empty wallet: one row
`committee-account missing:true threshold 84818` with honest
`nested-auth (needs 1.2.6 … 1.2.16)` note; `signatures []`;
`signLocal` throws `tb-wallet-locked`. No silent unsigned broadcast.

## T3 — export/import round-trip (on the LIVE envelope, §T1)

Leak scan clean, `chain_id` match, `tx.operations` deep-equals `ops`,
`serializeTransaction` hex identical after clear+import. Expired
envelope correctly throws `tb-expired` with the re-base/sig-drop
wording (observed first against the STUCK node below — the check works).

## T4 — proposal-wrap (shape + live fee, NOT broadcast)

`wrapProposal` → outer `[22, …]` with inners `[0, 6]` in `{op:[t,d]}`
form; wrapper fee live-quoted `10158` (`0.10158 TEST`); desk carries
the `executes only after approvals` notice. Deliberately not
broadcast: a live 24h proposal spends a wrapper fee and litters the
chain for zero behavioral gain — direct-send proof (§T1) covers the
bytes, shape+fee cover the delegation.

## T5 — non-BTS precision + percents (real Format/Pool, stubbed reads)

`parseAmount 12.345@3 → 12345`, `formatAmount 12345@3 → 12.345`;
`describe(61)` on a precision-3 pair → `Amount A 12.345 P3T`,
`Amount B 67.890 P3T` (fee row still p5 TEST — mixed precisions side
by side, no float anywhere). Percent 10000-base rule via the single
`Pool.pctUnitsToHuman`: `150 → 1.5`, `2000 → 20`, `5 → 0.05`.
(`TB8-T5-OK`.)

## T6 — regression: one-shot paths untouched

`node --check` clean on `transfer-confirm.js` / `vote-ui.js` /
`pool-ui.js`; `TB7-OK` (all three outlets reference `TxBuilder`);
`TB7-GUARD-OK` (`typeof TxBuilder` absence guards — one-shot
Review → Sign & Send works with `txbuilder.js` blocked). The T8 fix
touches composer fee-shape only; no pilot file changed.

## Viewport/theme gate (360px phone + 1440px desktop × 3 themes)

- Desk is class-only + inline responsive: `wrap wide` shell,
  `tb-grid` inline `repeat(auto-fit, minmax(280px, 1fr))` (stacks at
  phone widths, 2-column on desktop — no fixed pixel widths anywhere),
  textareas `width:100%`, all `<button>`s get 44px targets from the
  global `button, select, input { min-height: 44px }` rule, click-only
  (zero `mouseenter`/hover handlers — `title` tooltips are
  supplementary, never the only path), empty state with
  Transfer/Voting/Pools links (never blank).
- Themes: zero hardcoded colors/fonts in `txbuilder-ui.js`
  (color scan clean) — all styling via shared classes + CSS tokens,
  so ref-ui/dex-ux/vanilla-ui inherit automatically.
- Headless DOM proof (`TB8-DOM-OK`): empty + one-op-queued + badge
  render with zero exceptions (minimal stub; alias is fire-and-forget
  so the harness settles before asserting). No headless Chromium in
  this env (no `.browsers`) — the human browser pass at 360px +
  1440px in all three themes stays the gate before release.
- i18n: zero new keys (`I18n` count 0 in both composer files);
  `check_i18n.py` green (no dict/en-inventory change needed).

## Decisions log

- D-live-node: `wss://testnet.xbts.io/ws` is STUCK (head `100989922`,
  time `2026-09-29T18:32:30`, unmoved over 45s+ while wall clock is
  `2026-09-30T21:30Z`). Proof ran on `wss://testnet.dex.trading/`
  (head `101018445 → 101018459` in 45s, ~3s/block) — itself a vanilla
  default testnet node (`store.js:23`). The stuck node also proved the
  `tb-expired` path for free (fresh envelope vs ancient head time).
- D-no-proposal-broadcast: see T4 (fee+shape proven, chain unlittered).
- D-no-op-vote: re-publish of byte-identical options — inclusion-proven
  via slate re-read, chain state unchanged (balances excepted).
- D-desk-CSS: `.tb-grid`/cards intentionally need no stylesheet rules
  (inline auto-fit grid + shared classes suffice); a desktop-polish
  pass may add rules later — recorded, not blocking.

## Gates

- `python3 tooling/check_rot.py` → PASS (static, dependency-free).
- Placeholder scan (`TB""D|TO""DO` over composer files + this note) →
  CLEAN.
- Offline suites: `TB8-OFFLINE-OK`, `TB8-FEESHAPE-OK`, `TB8-T5-OK`,
  `TB8-DOM-OK`, `TB7-OK`, `TB7-GUARD-OK`.
- Anti-rot (§4.5): (a) ten-year test yes — static JS, platform APIs,
  one fixed-line shape bridge, no new dependency; (b) newly depended
  on: nothing (live node is data, failover pair already in settings);
  (c) smallest deletable: T4-wrap/T2-honesty prose — proof stands on
  T1 alone, but the rows cost nothing to keep.

*Vault: fixture `lite-test-1` spent `102633` raw (`0.10000` dust +
`0.92633` fees) at block `101018463`; no secrets entered the repo
(fixture file gitignored, keys memory-only in `/tmp` scripts).*
