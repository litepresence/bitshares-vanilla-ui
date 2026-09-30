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

## Artifacts

- `tooling/prove_transfer_propose_f1.cjs` (runnable, stdlib-only, redacted)
- This note: `vanilla/notes/propose-proof-2026-09-29.md`
