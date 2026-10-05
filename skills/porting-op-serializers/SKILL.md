---
name: porting-op-serializers
description: Use when adding a BitShares operation serializer to vanilla/js/api/tx-ops-*.js — field order from chain headers, unit vectors, fee path, UI wiring, testnet proof.
---

# Porting Op Serializers

Repeated pattern (ops 16, 17/43/47/48, 20/21/29/30, 22-nesting): serializer +
vectors + fee + UI + testnet proof, same shape every time.

Codebase reality (post-split): serializers live in `vanilla/js/api/tx-primitives.js`
(frame + primitives + dispatch), `tx-ops-trade.js` / `tx-ops-gov.js` (op bodies),
with `vanilla/js/api/tx.js` as the thin facade. Conventions below name `tx.js`
locations — new op bodies go in the correct ops file, dispatch + `_ser` export
+ `Tx.OP.<name>` wiring included.

## Contract

1. **Ground truth order.** Field order from `#4` ONLY:
   `reference/bitshares-core/libraries/protocol/<area>.hpp` struct +
   `FC_REFLECT` line. Cross-check upstream bitsharesjs raw files on demand
   (fetch, never install, never import) + #3 `bitshares-api.js` line refs.
   Record all three sources in per-function provenance comments. If sources
   disagree, #4 wins; note the conflict.
2. **Conventions in `tx.js`.** `serializeXxxOp` + both dispatches
   (`serializeOperationData` + `serializeTransaction`) + `_ser` export +
   `Tx.OP.<name> = <id>`. No `|| default` fallbacks on money/ids — missing
   values throw loudly. No extensions field unless the struct has one.
3. **Unit vectors first.** `tooling/<op>-test.js` (stdlib node only):
   exact-bytes vs manual part concat (proves field order + extension tails),
   builder shapes, guard-throws (missing/bad/zero), both dispatch paths + tx
   framing, undispatched neighbors still rejected.
4. **Fee path.** Builder with zero-placeholder fee + `get_required_fees`
   via existing `AssetOps.fee`-style helper. Fee rail applies (suspicious
   fees throw — never auto-proceed).
5. **UI wiring.** Form → review (named rows) → unlock-at-sign → broadcast +
   re-read proof. Locked preview works (1.2.0 placeholder + notice). UI code
   uses the shared globals (AGENTS.md §7 rule 9: `Forms` field builders,
   `ConfirmDialog.show`, `DOM` helpers — never local copies), keys every new
   display string via `t()` + all 12 locale dicts, and meets the UX floor
   (44px targets, labeled inputs, theme tokens, empty states + inline
   validation). JSDoc on touched seams; `check_types.sh` green.
6. **Testnet proof (testnet ONLY, fixture `tooling/testnet-lite-test-1.json`,
   never mainnet, never commit secrets).** `tooling/prove-<op>-f<N>.cjs`
   (stdlib WS) + note under `docs/parity/` with ids/blocks/fees/repro commands. Inclusion ideal;
   evaluator/validate-stage rejection counts as byte-proof ONLY with the
   exact node error recorded (file:line of the evaluator). Shape errors
   (e.g. self-transfer) are test bugs, not proofs — fix the shape, re-run.

## Red Flags

- Serializing from #3 or BJS order without checking #4 first.
- `|| 0` / `|| ''` defaults on amounts or ids.
- Claiming a proposal id with zero repo hits (the 1.10.1492 rule: no
  artifact = unproven, never counted).
- Testnet funds moved beyond dust without recording deltas.
