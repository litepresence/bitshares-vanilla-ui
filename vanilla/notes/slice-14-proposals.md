# Slice 14 parity note — proposals + tickets + misc (+ barter PROPOSE)

Plan: `docs/superpowers/plans/2026-09-28-slice-14-proposals.md` (Tasks 1–4).

## What landed (vanilla file:line)
- `vanilla/js/tx.js` — 12 serializers: op 7, 22/23/24 (op_wrapper both forms,
  `serializeOperationData` recursion), 32/33 (policy array-form), 37 (fee 0),
  54/55/56 (restrictions 0–41 table), 57/58 (target varint 0–4). WHY-NOT: 38
  issuer-only, 39/40/41 blind-downscoped, 46 VIRTUAL. BJS: all 12 match
  (#4 wins the one gap — BJS lacks instant policy type 2).
- `vanilla/js/proposal.js` (239) + `proposal-ticket.js` (124) + `proposal-misc.js`
  (246) — reads (1.10/1.13/1.15/1.17/1.18), builders, invoice base58-JSON
  pack/unpack, airdrop batcher, `blindSend` throws.
- Views: `proposal-ui.js` 513 (shared-toolkit exception: helpers ~290 incl.
  nested renderer, views 188), `ticket-ui.js` 267, `misc-ui.js` 330,
  `vesting-ui.js` 240 (cap-split), `barter-ui.js` PROPOSE enabled.
- Routes: 8 (`#/proposals`, `#/proposals/:id`, `#/tickets`, `#/vesting`,
  `#/authorities`, `#/lists`, `#/airdrop`, `#/invoice[/:data]`).

## Reference behavior (file:line)
- #4 wins throughout; prompt guesses corrected by evidence: op 37 (not 38),
  blind trio 39/40/41 (not 46), authority trio 54/55/56 (not 39–41).
- Blind DOWNSCOPED honestly: commitments + bulletproofs + stealth ECDH have no
  static-page mint (#3 serializes bytes only, #2 needs electron IPC).
- Airdrop = N× op-14 batches (no op); invoice = base58-JSON URLs (not #1 zip —
  foreign URLs surface `invoice-unparseable`, never crash).

## Bugs found by verification, fixed + re-proved
- F1 BLOCKING: `Tx.fee` choked on op-22 `[[flat,[inners]]]` → nested unwrap
  (flat first, inners informational); `feeMulti` same + display-fee fix.
  Sub-cause: null memo objects rejected (`base58str.size`) → empty memo=null.
- F2: fee-payer column blank — chain sends `proposer`, not `fee_paying_account`.
- F3: create confirm lacked per-inner nested rows → added via `extra` slot.
- F4: op-type number → number + name. F5: stale disabled comment updated.
- F6: inner from==to → client gate (chain `transfer.cpp:42`).
- String lock enums (director): node returns `"lock_360_days"`, `lockLabel`
  took ints only → accepts both, rows canonicalize to int (proven live strings).

## Test vectors (raw → human, real files, live testnet)
- Proposal `1.10.1488`: create (inner xfer `10000`→`0.10000 TEST`) fee `4592`→
  `0.04592` — `100932694` (flat accepted, inners NOT added); approve fee `2443` —
  `100932695`; `1.10.1489` create→delete fee `100` — `100932695`.
- Barter op-22 (slice-13 deferred proof): `1.10.1491` inners `[[0,5000],[0,3000]]`,
  fee `7228` — `100932716`. Fee-delta 2636 = ppk size proof.
- Vesting: instant `1.13.885` 20000/fully withdrawn (`100932633-34`); linear
  `1.13.888` ✓; cdd `1.13.889` immediate-withdraw REJECTED
  (`is_withdraw_allowed`), matured withdraw — `100933376` (accrues from deposit).
- Authority `1.17.4`: create fee `530000`→`5.3` — `100932698` (30-day window
  REJECTED `max_custom_authority_lifetime`, 1-day accepted); update fee `110000`,
  delete fee `100000` — `100932699`.
- Whitelist `0→1→0` vs `1.2.25483`, fees 100 — `100932678-700`.
- Airdrop 2×op-14 (10000+5000 p4), total fee 394 (no batch discount) — `100932700`.
- Op-37: no claimable → broadcast correctly gated; fee-0 explicit in confirm.
- Tickets: broadcasts PENDING (fees 50+50 TEST > fixture 38.8; faucet
  rate-limited `Only one account per IP 30 min`). Builders byte-proven offline.
- Ambiguities: bare `[t,d]` REJECTED (`bad_cast`), `{op:}` required; op-72
  omit/set both proven (slice 13); maps canonical; TCR ÷1000 both ways.

## Manual test (headless, --network testnet, zero console errors ×13)
- All 8 routes @1440 blue/dark/light + 390: retro shell, connected badge, lock
  gates, trio holds at gate level. Nested renderer: transfer/whitelist/ticket/
  issue rows human, unknown-type fallback honest.

## Tester pass (queued)
- Proposal create→approve→delete + barter PROPOSE + ticket create→update (needs
  funded fixture ≥105 TEST) + vesting/authority/whitelist/airdrop visuals; trio; 390.

## Anti-rot gate (§4.5): (a) yes — static + existing Tx/Chain reuse, no stealth
crypto vendored; (b) nothing new depended on; (c) smallest deletable: invoice
page (proposal core stands). `check_rot.py` PASS.
