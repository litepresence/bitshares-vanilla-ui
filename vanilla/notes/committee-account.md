# Committee Account Verification (1.2.0)

## Verification Summary

The BitShares `committee-account` resolves to object ID `1.2.0` on **both mainnet and testnet**.

## Evidence

### Testnet Verification
- `get_account_by_name committee-account` → `1.2.0` (see `vanilla/notes/api-lab.md:56`)
- Propose/proof test on testnet: `1.2.0` exists as `committee-account`; review time reads back correctly (see `vanilla/notes/propose-proof-2026-09-29.md:182`, lines 135, 269)
- Transfer/propose wire path proved on testnet: inner op-0 `lite-test-1 (1.2.26833) → committee-account (1.2.0)` included at head #100989922 (see `vanilla/notes/propose-proof-2026-09-29.md:F2`, `vanilla/notes/punchlist-2026-09-29.json:532`)

### Mainnet Verification
- `committee-account` is a protocol-level constant: Graphene chain spec defines the committee account as `GRAPHENE_COMMITTEE_ACCOUNT` = `1.2.0` (see `reference/bitshares-core/libraries/chain/include/graphene/chain/config.hpp`)
- All BitShares mainnet deployments inherit this genesis assignment; verified by inspection of live mainnet `get_objects ["1.2.0"]` returning the committee account object

## Citation for AGENTS.md

> Verified via testnet `get_account_by_name committee-account` → `1.2.0` and mainnet protocol constant `GRAPHENE_COMMITTEE_ACCOUNT` = `1.2.0` — see parity note `vanilla/notes/committee-account.md`