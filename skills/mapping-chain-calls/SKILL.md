---
name: mapping-chain-calls
description: Use when needing a BitShares WebSocket API method, an operation's field list, fee behavior, or node and faucet endpoints for the vanilla UI
---

# Mapping Chain Calls

## Overview

Every WS method and op field in vanilla code traces to a recorded source. Triangulate across references; core wins conflicts; testnet confirms.

## When to Use

- Finding how to call `get_accounts`, `get_required_fees`, market queries, broadcast, history, or any WS method
- Finding an operation's fields and which are optional (transfer, limit_order_create, HTLC, tickets, Same-T funds, …)
- Choosing node or faucet endpoints

When NOT to use: pure UI work with no chain interaction.

## Reference Priority

| # | Source | Authority |
|---|---|---|
| 4 | `reference/bitshares-core/.../database_api.hpp`, `api.hpp`, `protocol/<op>.hpp` | Ground truth. Wins every conflict. |
| BJS | Upstream `bitshares/bitsharesjs` (serializer + ecc), consulted on demand via raw GitHub — never cloned, never installed | Official JS rendering of the protocol; core devs update it with API changes, so it is the authoritative answer to "how does this op serialize in JS today". Second opinion after #4, before #2/#3. |
| 1 | `reference/bitshares-ui/app/{actions,stores,lib}` | Canonical behavior, but verify — some logic is stale (e.g. `trxHelper.estimateFee`, see issue #3720). Note: #1 embeds bitsharesjs `^6.0.3` as a *pinned snapshot* — treat its serialization as dated, always re-check BJS current. |
| 2 | `reference/astro-ui/src/bts/`, `src/components/<Op>.jsx` | Modern patterns; signing is Beet-specific — take the op builders and WS calls, not the signing wrapper |
| 3 | `reference/wallet-extension/src/lib/bitshares-api.js` | 2026 nodes, failover, fee-fill; `popup.js` 78-op table is the confirm-dialog wording spec |
| 6 | `reference/open-graphene/.../dist/bitshares.open-graphene.json` (sparse checkout) | Machine-extracted spec cross-check oracle — third machine opinion for serializer field order/tags. Below BJS; #4 wins conflicts; testnet decides. Reference-only, never a dependency. |

Online mirrors: `docs.bitshares.dev` (Database/History/Broadcast API) and `bitshares.github.io/doxygen`.

## Procedure

1. Start at #4: confirm the method exists and copy exact params (`database_api.hpp` for reads, `api.hpp` for broadcast, `protocol/<op>.hpp` for op fields — struct field order comes from the `FC_REFLECT` line, which is serializer ground truth).
2. Check BJS current for the official JS serialization of the op (fetch the single file raw from GitHub on demand — no checkout, no install, never cloned per AGENTS.md §8 Phase 2).
3. Check #1 for how the old UI calls it (action→store→chain-call matrix, AGENTS.md §8 Phase 1).
4. Cross-check #2 and #3 for newer usage. If they disagree with #4, #4 wins — note the conflict.
5. Record the result in the slice's parity note under `docs/parity/` (NOT a central `chain-calls.md` matrix — Phase 1 inventory was folded into slices): method, params, one file:line per reference consulted, testnet observation.
6. Fees always come from `get_required_fees` at runtime. Never copy #1's static fee tables into vanilla.

## Serializer Rules (repeated testnet-proof failures — non-negotiable)

- **Provenance comment per function:** every `serializeXxxOp` records all three sources (#4 struct + `FC_REFLECT` line, BJS raw file, #3 `bitshares-api.js` line ref). If sources disagree, #4 wins; note the conflict in the comment.
- **No `|| default` on money/ids:** missing amounts or object IDs throw loudly — `|| 0` / `|| ''` silently builds a valid-looking wrong transaction.
- **No extensions field unless the struct has one.**
- **Fee rail:** builders carry a zero-placeholder fee filled via `get_required_fees` through the existing `AssetOps.fee`-style helper; suspicious fees throw — never auto-proceed.
- **Testnet proof discipline:** testnet ONLY, fixture `tooling/testnet-lite-test-1.json`, never mainnet, never commit secrets. Evaluator/validate-stage rejection counts as byte-proof ONLY with the exact node error recorded (file:line of the evaluator). Shape errors (e.g. self-transfer) are test bugs, not proofs. No artifact = unproven (the 1.10.1492 rule).

## Common Mistakes

| Mistake | Fix |
|---|---|
| Trusting #1's fee estimation | It is stale (#3720); `get_required_fees` is the only source |
| Hardcoding 2022 faucet/registrar URLs from #1 | Re-discover during the wallet slice; endpoints move |
| Copying astro-ui's Beet signing flow | Vanilla signs locally like #1; take op construction, not signing |
| Treating testnet behavior as optional confirmation | If testnet disagrees with all four references, testnet wins — record it |
| Expanding the `bitshares-core` sparse checkout "just to look" | Out of scope (AGENTS.md §5.6); close the file |
