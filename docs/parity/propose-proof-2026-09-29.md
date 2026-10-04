# Transfer propose-toggle testnet re-proof — 2026-09-29

> Prior claim of proposal `1.10.1492` has zero repo hits — treated as
> unverified. This note re-proves the toggle path with committed artifacts,
> honestly reporting the chain's answer. TESTNET ONLY.

## Verdict

**BYTE-PROVED at chain-validation stage — inclusion NOT proved (by chain
design).** The prescribed minimal self-transfer proposal (inner op-0:
`from == to == fixture`, `1` raw TEST unit, review `3600`s) serializes,
signs, and broadcasts correctly through the REAL vanilla path, and the
testnet node parses it far enough to run chain validation — then refuses
on the `from != to` business rule. Rejected txs change nothing and cost
nothing. Prior id `1.10.1492` is NOT counted as proof; op-matrix row C21
stays PORTED.

## Prior-claim status

- `rg -n 1492` across the repo (excluding `reference/`) finds NO in-repo hit
  for a `1.10.1492` proof — only the op-coverage-matrix audit line noting its
  absence (`vanilla/notes/op-coverage-matrix.md`, transfer-propose bullet:
  "`rg -n 1492` finds NO in-repo hit (only slice-14 `1.10.1488/89/91` +
  barter `1.10.1491`) — so `1492` is NOT independently verified here and is
  NOT counted as proof").
- Repro: `grep -rn "1\.10\.1492" /workspace --exclude-dir=reference` → empty
  (matrix audit line aside).

## Code path (all live, file:line)

- Toggle + inputs: `vanilla/js/transfer-ui.js:430-440` (Send/Propose buttons),
  `:494-525` (mode refresh), `:450-471` (proposer + expiration + review
  inputs + locked notice), `:715-728` (propose gating: proposer required,
  expiration ISO, review u32).
- Wrap: `:1386-1390` (`Proposal.buildCreate` with `{op: [0, leg.opData]}`
  nesting — the `barter-ui.js:269-270` path, never reinvented).
- Wrapper fee live: `vanilla/js/tx-send.js:48-59` (`get_required_fees` on
  op-22, `[flat, [inners]]` unwrap — flat is the proposal's own fee).
- Builder: `vanilla/js/proposal.js:104-111` (`buildCreate`), `:203-209`
  (`fee` → `Tx.fee`, filled in place), `:75-84` (`proposalsFor`), `:68`
  (`proposal` via `get_objects`).
- Serializer: `vanilla/js/tx.js:1983-2013` (`serializeProposalCreateOp`),
  dispatch `:2425` / `:2499`, recursion through `serializeOperationData`
  (nested op-0 bytes identical to top-level).
- Confirm/broadcast/result: `vanilla/js/transfer-ui.js:1237-1329`
  (`showProposeConfirm` + `Proposal.sendAndProve` with `proposalsFor` +
  `get_objects` re-read), `:1333-1353` (proposal id + head block result).
- Self-transfer guard (UI already forbids this shape):
  `:709-711` (gate: `from != to` case-insensitive) and `:1167`
  (`resolveProposeLeg`: `fromAcc.id === to.id` throws).

## Testnet observation (committed script run, 2026-09-30 ~02:41 UTC)

- Node: `wss://testnet.xbts.io/ws` (fixture `node`), chain-id prefix
  `39f5e2ede1f8bc1a` (testnet, matches fixture `chain_id`).
- Fixture account: `lite-test-1` (`1.2.26833`) — ids only, keys never logged.
- Head before: `#100989922`.
- Inner: op-0 `1.2.26833 → 1.2.26833`, amount `1` raw TEST (`1.3.0`), no memo.
- Proposal envelope: expiry `2026-10-01T02:41:15` (+24h), review `3600`.
- Wrapper fee (live `get_required_fees` on op-22): `4982` raw TEST
  (`1.3.0`).
- `proposalsFor(1.2.26833)` before: `4`.
- Broadcast (`broadcast_transaction_with_callback`, no method-fallback
  needed): **REJECTED** with the exact node error —
  `{"code":10,"message":"Execution error: Assert Exception: from != to: ",`
  `"data":{"code":10,"name":"assert_exception","message":"Assert Exception",`
  `"stack":[{"context":{"level":"error","file":"transfer.cpp","line":42,`
  `"method":"validate",...},"format":"from != to: ","data":{}}]}}`
  (node timestamp `2026-09-30T02:39:46` on the first /tmp run; identical
  shape on the committed-script run).
- Observed head at refusal: `#100989922`. No new proposal row (count
  unchanged) — `get_objects` re-read N/A by design on refusal.
- Classification: **validate-reached byte-proof** (`transfer.cpp:42
  validate`), not evaluator-stage — correcting the task's parenthetical
  honestly. The node deserialized the op-22 envelope AND the nested op-0
  and ran transfer validation against our bytes; a serialization or
  signature-envelope fault would have failed earlier with a different
  error. Inclusion of a `from == to` transfer is unprovable because the
  chain forbids it — same as the UI gating above.

## What this proves / does not prove

- PROVES: the propose-toggle wire path (build → wrapper fee → sign →
  broadcast → classify) works end to end with real vanilla serializers;
  op-22 + nested op-0 bytes are chain-parseable (validation ran on them).
- DOES NOT PROVE: inclusion of any proposal id for this shape (impossible
  for `from == to`); the prior `1.10.1492` claim remains unverified and
  uncounted. A non-self leg (e.g. fixture → `1.2.0`) would be needed for an
  inclusion proof — explicitly NOT attempted here (task prescribed the
  self-transfer shape; no chain state was created).

## Repro (redacted — fixture read at runtime, never committed)

```bash
node --check /workspace/tooling/prove_transfer_propose_f1.cjs
node /workspace/tooling/prove_transfer_propose_f1.cjs
# prints only ids/blocks/fees + the exact node error excerpt (no keys)
python3 /workspace/tooling/check_rot.py
grep -rn "1\.10\.1492" /workspace --exclude-dir=reference
```

SAFETY: TESTNET ONLY via `tooling/testnet-lite-test-1.json` (gitignored,
`600`-perms). NEVER mainnet, NEVER commit secrets/keys — the proof script
reads the fixture at runtime and prints only ids/blocks/fees.

## Artifacts (F1)

- `tooling/prove_transfer_propose_f1.cjs` (runnable, stdlib-only, redacted)
- This note: `vanilla/notes/propose-proof-2026-09-29.md`

---

## F2 — consensus-legal inclusion proof (fixture → committee-account) — 2026-09-30

> F1 tested the prescribed self-transfer shape and was consensus-rejected
> (`transfer.cpp:42 from != to`) — byte-proof only, by chain design. F2
> repeats the SAME vanilla path with the consensus-legal shape the task
> prescribes: inner op-0 `lite-test-1 (1.2.26833) → committee-account
> (1.2.0)`, amount `1` raw TEST (`1.3.0`), no memo, `review_period 3600`,
> expiry `+24h`. TESTNET ONLY.

### Verdict

**INCLUSION PROVED: `1.10.1493` re-read via `get_objects` (plus accidental
duplicate `1.10.1494` — see honesty note).** The op-22 wrapper built,
fee-filled, signed, and broadcast through the unmodified vanilla sources;
`proposalsFor` count advanced and `get_objects` returns the enclosed op-0,
review time, and proposer. No funding, no account creation attempted.

### Testnet observation (committed F2 script, 2026-09-30 ~02:44 UTC)

- Node: `wss://testnet.xbts.io/ws`, chain-id prefix `39f5e2ede1f8bc1a`
  (testnet, matches fixture `chain_id`).
- Endpoints pre-read via `get_accounts`: from `1.2.26833` (`lite-test-1`)
  exists; to `1.2.0` exists, name `committee-account` — the task's
  "always exists" premise HOLDS on testnet (no missing-account path taken).
- Head before: `#100989922` (same number F1 saw ~3 min earlier — recorded
  honestly; proposals still increment, so the node accepts transactions
  while reporting a static head over this window).
- Inner: op-0 `1.2.26833 → 1.2.0`, amount `1` raw TEST (`1.3.0`), no memo.
- Envelope: expiry `2026-10-01T02:44:13` (+24h), review `3600`.
- Wrapper fee (live `get_required_fees` on op-22): **`4787` raw TEST**
  (`1.3.0`) — vs F1's `4982` for the self-transfer shape (different inner
  bytes, recorded as observed).
- `proposalsFor(1.2.26833)` before: `4`.
- Broadcast (`broadcast_transaction_with_callback`, no fallback needed):
  **ACCEPTED**.
- Re-read: `proposalsFor` count `4 → 5`; `get_objects(["1.10.1493"])`
  returns:
  - `id: 1.10.1493`, `proposer: 1.2.26833`,
  - `expiration_time: 2026-10-01T02:44:13`,
  - `review_period_time: 2026-10-01T01:44:13` (absolute timestamp =
    expiry − 3600s; `review_period_seconds` slot is `null` on this node —
    the chain stores the review DEADLINE, not the duration),
  - enclosed `operations[0]: [0, {from: 1.2.26833, to: 1.2.0,
    amount: {amount: 1, asset_id: 1.3.0}}]`.
- Observed head at proof: `#100989922`. Wrapper fee pair recorded:
  `{amount: "4787", asset_id: "1.3.0"}`.

### Honesty note — accidental duplicate `1.10.1494`

A second F2 run (intended as a read-only re-check) re-executed the script,
which always broadcasts, and created **`1.10.1494`** with identical shape
(expiry `2026-10-01T02:44:37`, fee `4787`, head `#100989922`,
`proposalsFor` before `5`). That run's `proposals_before: 5` independently
confirms `1.10.1493` persisted (4 → 5). No further runs after this was
noticed — each broadcast pays the proposal fee, so re-proving by
re-broadcasting is wasteful by construction. Future re-reads must use
`get_objects` only, never re-run the prove script.

### What this proves / does not prove

- PROVES: the propose-toggle wire path end to end with a consensus-legal
  leg — build → wrapper fee → sign → broadcast → `proposalsFor` +
  `get_objects` inclusion proof (`1.10.1493`, `1.10.1494` duplicate).
- DOES NOT PROVE: execution of the inner transfer (proposals execute only
  after review/approval — neither attempted here); the F1 self-transfer
  shape remains un-includable by chain design; prior `1.10.1492` claim
  remains unverified and uncounted.
- CONTRADICTS / CLARIFIES vs F1: inclusion IS provable once `from != to`
  (F1's "NOT proved by design" was shape-specific, not path-specific);
  `1.2.0` exists on testnet as `committee-account`; review time reads back
  as absolute `review_period_time`, not seconds.

### Repro (redacted — fixture read at runtime, never committed)

```bash
node --check /workspace/tooling/prove_transfer_propose_f2.cjs
node /workspace/tooling/prove_transfer_propose_f2.cjs   # broadcasts once per run — do NOT re-run to "re-check"; re-read with get_objects
python3 /workspace/tooling/check_rot.py
git check-ignore -v tooling/testnet-lite-test-1.json
```

SAFETY: TESTNET ONLY via `tooling/testnet-lite-test-1.json` (gitignored,
`600`-perms). NEVER mainnet, NEVER commit secrets/keys — the proof script
reads the fixture at runtime and prints only ids/blocks/fees.

### Artifacts (F2)

- `tooling/prove_transfer_propose_f2.cjs` (runnable, stdlib-only, redacted;
  F1 script left untouched)
- This note: `vanilla/notes/propose-proof-2026-09-29.md` (F2 section)

---

## F3 — Signing path restored: 40-hex fix + UI-path inclusion proof — 2026-09-30

> Commit `8c40f45` introduced a head-shape gate demanding 64-hex block ids;
> the real chain returns 40-hex RIPEMD160 (`protocol/types.hpp:304`
> `using block_id_type = fc::ripemd160`). Every `Chain.connect` rejected with
> `bad-head-shape` and every `Tx.buildTx` threw `bad-head-block` — ALL UI
> signing was broken (browser + Node). The fix (uncommitted at task start,
> verified then proven here): `vanilla/js/chain.js:106` + `vanilla/js/tx-send.js:47`
> `{64}` → `{40}` with a `types.hpp:304 — NOT 64` comment. TESTNET ONLY.

### Verdict

**SIGNING PATH RESTORED — INCLUSION PROVED: `1.10.1495` re-read via
`get_objects` at head `#100989922`.** Unit (40 accepts / 39-41-non-hex-bad-time-
zero-64 reject on BOTH validators), live connect (no rejection, stays open),
UI-path broadcast (real `Tx.buildTx` + `Tx.sign` + broadcast with
`wallet.js` loaded), and LTM-gated witness re-runs (now pass connect, stop at
LTM as designed) are all green.

### Fix verification (before any proof)

- `vanilla/js/chain.js:106` reads `/^[0-9a-fA-F]{40}$/` + comment
  `head_block_id 40 hex chars (RIPEMD160 block id, types.hpp:304 — NOT 64; a
  64-char demand broke all signing)` — no `{64}` remains.
- `vanilla/js/tx-send.js:47` reads the same `{40}` + `must be 40 hex chars` —
  no `{64}` remains.
- Chain truth re-checked: `reference/bitshares-core/.../protocol/types.hpp:304`
  `using block_id_type = fc::ripemd160;` (160-bit = 40 hex). Live heads confirm:
  `0604fbe2e1e7ed8ddbce2872d2ec9c53146be213` (40 chars, xbts) and
  `060560c4c0d58ccb50f17443302bdc8096e7f34a` (40 chars, dex.trading).

### (1) Unit — `tooling/verify_head40_unit.cjs` — GREEN

Real sources in vm sandboxes (chain.js via `Chain.connect` StubWS path,
tx-send.js via `Tx.buildTx` mocked-Chain path). All 19 checks pass:

- File gates: chain.js reads `{40}` / no `{64}`; tx-send.js reads `{40}` / no `{64}`.
- Chain (`assertPropsShape`): 40-hex passes, 40-hex UPPER passes, 39-hex fails
  `bad-head-shape`, 41-hex fails, 64-hex fails (old demand gone), non-hex
  fails, bad time fails, zero head fails.
- Tx (`assertHeadProps`): 40-hex passes (envelope `ref_block_num/prefix`
  derived), 39/41/non-hex/bad-time/zero-head/64-hex all fail `bad-head-block`.

### (2) Connect — `tooling/head40_connect_proof.cjs` — GREEN

Real `vanilla/js/chain.js` + stdlib `MiniWebSocket`, no fixture, no secrets:

- `wss://testnet.xbts.io/ws`: connected, chain-id prefix `39f5e2ede1f8bc1a`,
  latency `1013ms`, head `#100989922`, `head_id_len: 40`,
  prefix `0604fbe2`, **stayed open 6s (`state: open`)** — no bad-head-shape
  rejection. First node sufficed (dex.trading not needed).

### (3) UI-path broadcast — `tooling/prove_signing_restored_40hex.cjs` — GREEN

Real vanilla sources loaded in Node (order mirrors `index.html`, wallet.js
REQUIRED): `vendor/noble-classic.js`, `data/brainkey-dict.js`, `crypto.js`,
`wallet.js`, `store.js`, `chain.js`, `tx.js`, `tx-send.js`, `format.js`,
`account.js`, `proposal.js`. Fixture WIF in memory only (= what an unlocked
wallet hands `Tx.sign`); logs carry ids/blocks/fees only.

- Modules: `wallet: object, tx_buildTx: function, tx_sign: function`.
- Node `wss://testnet.xbts.io/ws`, chain-id prefix `39f5e2ede1f8bc1a`.
- Head before `#100989922` (`head_id_len: 40`).
- Endpoints: `1.2.26833 lite-test-1` → `1.2.0 committee-account` (both exist).
- Inner: op-0 `1` raw TEST (`1.3.0`), no memo (`Tx.buildTransfer` placeholder).
- Wrapper: expiry `2026-10-01T19:07:09` (+24h), review `3600`,
  live fee `4787` raw TEST (`Proposal.fee` → `Tx.fee` unwrap).
- `proposals_before: 6`; broadcast `broadcast_transaction_with_callback`
  (no fallback needed); poll `proposalsFor` → new row.
- **Proved `1.10.1495` at head `#100989922`** (`via: broadcast_transaction_with_callback+re-read`):
  `get_objects(["1.10.1495"])` returns `proposer: 1.2.26833`,
  `expiration_time: 2026-10-01T19:07:09`,
  `review_period_time: 2026-10-01T18:07:09` (= expiry − 3600s),
  enclosed `[0, {from: 1.2.26833, to: 1.2.0, amount: {amount: 1, asset_id: 1.3.0}}]`,
  wrapper fee `{amount: "4787", asset_id: "1.3.0"}`, elapsed `3276ms`.
- Standing clutter grows by one (no delete op exists): proposals
  `1.10.1493/1494` (F2) + `1.10.1495` (here). Do NOT re-run to "re-check" —
  re-read with `get_objects`; each run pays the fee.

### (4) LTM-gated witness re-runs — PASS CONNECT, STOP at LTM (by design)

Both previously STOPPED at connect (`bad-head-shape: ... 64 hex chars`,
exit 3, zero cost). After the fix, with zero script changes:

- `prove_witness_create_20.cjs`: `connected` (dex.trading, `876ms`) →
  `pre_read` (balance `3873890` raw, membership `1970-01-01T00:00:00` basic,
  witness `null`) → `ltm_gate STOP` (exit 3):
  `fixture is not a lifetime member; witness_create is consensus-unprovable
  until op-8 upgrades it`. Fee/dust gate never reached; nothing broadcast.
- `prove_committee_create_29.cjs`: identical shape (`864ms`, committee
  `null`) → `ltm_gate STOP` (exit 3). Nothing broadcast.
- The remaining block is FUNDS (op-8 fee `20000000` raw vs `3873890` held —
  see `vanilla/notes/ltm-witness-committee-2026-09-30.md`), NOT the client.
  Post-funding these scripts run unchanged to inclusion.

### Repro (redacted — fixture read at runtime, never committed)

```bash
node --check /workspace/tooling/verify_head40_unit.cjs
node /workspace/tooling/verify_head40_unit.cjs          # offline, no secrets
node --check /workspace/tooling/head40_connect_proof.cjs
node /workspace/tooling/head40_connect_proof.cjs        # live connect, no secrets
node --check /workspace/tooling/prove_signing_restored_40hex.cjs
node /workspace/tooling/prove_signing_restored_40hex.cjs # BROADCASTS once per run — do NOT re-run; re-read with get_objects
node /workspace/tooling/prove_witness_create_20.cjs     # STOP exit 3 at ltm_gate (connect now passes) — costs nothing
node /workspace/tooling/prove_committee_create_29.cjs   # STOP exit 3 at ltm_gate (connect now passes) — costs nothing
node --check /workspace/vanilla/js/chain.js && node --check /workspace/vanilla/js/tx-send.js
python3 /workspace/tooling/check_rot.py
git check-ignore -v tooling/testnet-lite-test-1.json
```

SAFETY: TESTNET ONLY via `tooling/testnet-lite-test-1.json` (gitignored,
`600`-perms). NEVER mainnet, NEVER commit secrets/keys — all scripts read the
fixture at runtime and print only ids/blocks/fees/reasons.

### Artifacts (F3)

- `tooling/verify_head40_unit.cjs` (offline unit, stdlib-only, no secrets)
- `tooling/head40_connect_proof.cjs` (live connect, stdlib-only, no secrets)
- `tooling/prove_signing_restored_40hex.cjs` (UI-path broadcast, stdlib-only, redacted)
- This note: `vanilla/notes/propose-proof-2026-09-29.md` (F3 section)
- Fix itself: `vanilla/js/chain.js` + `vanilla/js/tx-send.js` (`{64}` → `{40}`)
