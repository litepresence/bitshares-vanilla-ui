# LTM upgrade + witness/committee inclusion — STOPPED with exact reasons — 2026-09-30

> TESTNET ONLY via `tooling/testnet-lite-test-1.json` (gitignored, 600-perms).
> No broadcast was made, nothing was spent, no chain state was created. Keys
> lived in memory only and never entered logs. This note records the two
> independent stop reasons, the exact numbers, and the unblock path.

## Verdict

**STOPPED — two independent blocks, either one alone stops the sequence:**

1. **FUNDS (task STOP rule): the LTM upgrade is unaffordable on the fixture.**
   Op-8 `account_upgrade` fee is `20000000` raw (`200.00000` TEST, p5);
   fixture holds `3873890` raw (`38.73890` TEST). Shortfall `16126110` raw
   (`161.26110` TEST). Task rule: *"upgrade fee must leave dust for further
   proofs; if unaffordable, STOP … do not fund from elsewhere without
   recording"* — so no top-up was attempted.
2. **CLIENT BUG (found while verifying): the vanilla `Chain.connect` /
   `Tx.buildTx` head-shape gate rejects the REAL chain.** Both testnet nodes
   return `head_block_id` as 40 hex chars (RIPEMD160 — chain truth
   `bitshares-core/.../protocol/types.hpp:304`
   `using block_id_type = fc::ripemd160;`), but `vanilla/js/chain.js:104-105`
   and `vanilla/js/tx-send.js:47-48` demand 64 hex chars. Every broadcast via
   the vanilla path — including the LTM upgrade itself — is currently
   impossible, in Node scripts AND in the browser app (connect rejects →
   error state). Even a funded fixture could not upgrade until this is fixed.

## Step 1 — op-8 serializer + fee path (read-code verification)

- `serializeAccountUpgradeOp` (`vanilla/js/tx.js:2499-2507`): `fee` +
  `account_to_upgrade` (1.2.x) + LTM flag as one `0x00/0x01` byte + empty
  extensions — matches the `#4 account.hpp:300-301` FC_REFLECT order cited in
  the header comment (`tx.js:2491-2498`). Always upgrades to LTM (`true`);
  fee tier is flag-driven (`account.cpp:263-268`: true → lifetime fee).
- Dispatch: `serializeOperationData` case 8 (`tx.js:2618`),
  `serializeTransaction` case 8 (`tx.js:2697`), `OP.account_upgrade: 8`
  (`tx.js:2795`). Op-20/29 serializers alongside at `tx.js:2545-2586`
  (previously audited, commit `872f25d`; evaluator-reached byte-proof in
  `tooling/prove_witness_update_f1.cjs`).
- Fee path: `Tx.fee` (`vanilla/js/tx-send.js:109-122`) — zero placeholder,
  one `get_required_fees [[[opId, opData]], assetId]` call, flat unwrap. The
  op-8 fee below came from this exact path shape (raw RPC equivalent).

## Step 2 — fixture pre-reads (read-only, raw WS, no vanilla sources)

Node `wss://testnet.dex.trading/` (live tip), chain-id prefix `39f5e2ede1f8bc1a`
(matches fixture `chain_id`):

| Item | Observed |
|---|---|
| Fixture | `lite-test-1` (`1.2.26833`), registrar `1.2.25483` |
| TEST balance (`1.3.0`, p5) | `3873890` raw = `38.73890` TEST |
| `membership_expiration_date` | `1970-01-01T00:00:00` = basic (LTM sentinel is `2106-02-07T06:28:15`) |
| Op-8 fee (`get_required_fees`) | `20000000` raw = `200.00000` TEST |
| Op-20 fee | `100` raw = `0.00100` TEST |
| Op-29 fee | `100` raw = `0.00100` TEST |
| Witness for account | `null` (none) |
| Committee member for account | `null` (none) |
| Balance after all three (hypothetical) | `3873890 − 20000000 − 100 − 100` = `−16126310` → dust_ok `false` |

No `/tmp` upgrade broadcast was attempted: the affordability gate fails first
(`200.00000` fee vs `38.73890` held), and the connect gate fails second (below).

## Step 3 — vanilla-path attempt (exact errors, /tmp + committed scripts)

Real vanilla sources loaded in Node (`/tmp/vanilla_connect_attempt.cjs`):

```json
{"node":"wss://testnet.xbts.io/ws","result":"REJECTED","error":"bad-head-shape: head_block_id must be 64 hex chars"}
{"node":"wss://testnet.dex.trading/","result":"REJECTED","error":"bad-head-shape: head_block_id must be 64 hex chars"}
```

Raw head samples behind the error (both nodes, same shape):

- `testnet.xbts.io`: head `#100989922`, id
  `0604fbe2e1e7ed8ddbce2872d2ec9c53146be213` (40 chars),
  time `2026-09-29T18:32:30` — **STALE ~24h, same number F1/F2 saw.**
- `testnet.dex.trading`: head `#101015748`, id
  `060560c4c0d58ccb50f17443302bdc8096e7f34a` (40 chars),
  time `2026-09-30T18:56:27` — live tip. Leading 8 hex chars
  (`060560c4` = `101015748`) encode the block number per
  `transaction.hpp:51`, confirming the 40-char value is a genuine
  `block_id_type`, not corruption.

Committed prove scripts (created this round, stdlib-only, redacted — fixture
read at runtime, LTM + fee+dust gates built in, exit 3 = STOP-precondition):

- `tooling/prove_witness_create_20.cjs` (`node --check` clean) →
  `{"step":"connect","result":"STOP","reason":"Chain.connect rejected: bad-head-shape: head_block_id must be 64 hex chars","node":"wss://testnet.dex.trading/"}` EXIT=3
- `tooling/prove_committee_create_29.cjs` (`node --check` clean) →
  identical STOP at connect, EXIT=3.

Both stop BEFORE any fee query / build / sign / broadcast: zero cost, zero
state change. Post-fix they run the full sequence (LTM gate → fee+dust gate →
broadcast → `get_witness_by_account` / `get_committee_member_by_account` poll
→ `get_objects` re-read → witness/committee id + head block + fee logged).

## Cleanup / leftover state

- **Nothing to clean.** No transaction was broadcast, so no witness object, no
  committee object, no membership change exists for the fixture (both lookups
  `null`, membership still basic). Fixture balance untouched (`3873890` raw).
- Standing testnet clutter is unchanged (not ours this round):
  `AFKTEST10` (1.3.1849), `AFKTESTM11` (1.3.1850), proposals `1.10.1493/1494`.
- When the proves eventually succeed, the created witness/committee objects
  CANNOT be deleted cheaply (no delete op) — the scripts' headers already
  record that the leftover must be noted honestly; future note must list ids.

## Unblock path (owner decisions, NOT done here)

1. **Fix the head-shape gate** (vanilla change, needs owner approval —
   deliberately NOT applied: this round commits scripts + note only).
   Recommended: accept 40-hex RIPEMD160 in `chain.js:104` and
   `tx-send.js:47` (e.g. `/^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/` to take both
   BitShares-160 and SHA256-typed replies), citing `types.hpp:304`. Landed in
   commit `8c40f45`; before it, F2 inclusion `1.10.1493` succeeded against the
   same 40-char chain. `tooling/chain-keepalive-test.js` (touched by the same
   commit) should gain a 40-hex vector so the suite matches the real chain.
2. **Fund the fixture ≥ ~165 TEST** (200 fee + dust + op-20/29 fees at 100 raw
   each + margin for re-proofs) via the testnet faucet
   `https://testnet-faucet.xbts.io/api/v1/accounts` (fixture `faucet` field)
   or a direct transfer — recorded here as the explicit funding request the
   task requires; NOT executed without owner say-so.
3. **Re-run**: `/tmp` LTM upgrade (op-8 → `membership_expiration_date`
   `2106-02-07T06:28:15` re-read + block + fee), then the two committed prove
   scripts to inclusion blocks + `get_object` re-reads, then a follow-up note.

## Repro (redacted — fixture read at runtime, never committed)

```bash
node --check tooling/prove_witness_create_20.cjs
node --check tooling/prove_committee_create_29.cjs
node tooling/prove_witness_create_20.cjs    # STOP exit 3 at connect (gate bug) — costs nothing
node tooling/prove_committee_create_29.cjs  # STOP exit 3 at connect (gate bug) — costs nothing
python3 tooling/check_rot.py
git check-ignore -v tooling/testnet-lite-test-1.json
```

SAFETY: TESTNET ONLY via `tooling/testnet-lite-test-1.json` (gitignored,
`600`-perms). NEVER mainnet, NEVER commit secrets/keys. All scripts print
only ids/blocks/fees/reasons.

## Artifacts

- `tooling/prove_witness_create_20.cjs` (runnable, stdlib-only, redacted)
- `tooling/prove_committee_create_29.cjs` (runnable, stdlib-only, redacted)
- This note: `vanilla/notes/ltm-witness-committee-2026-09-30.md`
- Matrix delta appended in `vanilla/notes/op-coverage-matrix.md` (no status flips)
