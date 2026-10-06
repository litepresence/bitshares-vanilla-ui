# Testnet proof round 2 — LTM set + affordable set (2026-10-06)

> Fixture `lite-test-1` (`1.2.26833`), testnet ONLY (chain `39f5e2ed…617447`).
> Node `wss://testnet.dex.trading/` live (head `#101179053` 17:18:06Z →
> `#101179109` 17:20:54Z); `wss://testnet.xbts.io/ws` used ONLY as the
> custom-operations fallback for op-35. Scripts (new, owned by this task):
> `tooling/prove-round2-preread.cjs` (read-only),
> `tooling/prove-round2-ltm.cjs` (LTM pre-read + ONE faucet POST),
> `tooling/prove-round2-affordable.cjs` (dust broadcasts).
> Precedent: git show `75231c3` (2026-09-30: fixture `3873890` raw TEST,
> op-8 fee `20000000`, faucet refused). Secrets discipline: WIFs/brainkey
> never printed; fixture WIF in memory for sign calls only; throwaway keys
> in `/tmp` 600-perms, saved BEFORE POST, shredded after (verified gone).

## Fixture pre-state (live re-reads, this round)

| Item | Observed |
|---|---|
| Account | `lite-test-1` (`1.2.26833`), registrar `1.2.25483`, membership `1970-01-01T00:00:00` (basic, NOT LTM) |
| TEST balance | `3771237` raw (`37.71237`, p5) — down `102653` since 09-30 (other workers' dust proofs elsewhere; not this task) |
| Other balances | `120000` `1.3.1849` (AFKTEST10) + zeros `1.3.1851/1852`; `0` AFKTESTM11 (`1.3.1850`) |
| Witness / committee | `null` / `null` (no objects to update → ops 21/30 have no target) |
| Margin positions | `0` (`get_margin_positions`); settle orders `0` |
| AFKTESTM11 bitasset (`2.4.448`) | fixture IS issuer; 1 feed, settlement_price `0/0` (no median), `settlement_fund 0`, no settlement |
| Global-settle scan (op-45) | 8 bitassets via `list_assets("",100)`: ALL `settlement_fund 0`, feed base `0` — no globally-settled candidate found |
| Balance objects (op-37) | `0` rows for all 6 fixture-key addresses (owner/active/memo × PTS-v56/BTS-v0, BJS `address.js` derivation) |

## Per-op verdicts

| op | pre-state | result | block / error | fee / delta (raw TEST) |
|---|---|---|---|---|
| 8 `account_upgrade` | balance `3771237`, fee `20000000` (direct `get_required_fees`, bypasses the Tx 5-unit guard so the number is exact) | BLOCKED (funds) | shortfall `16328763` raw (`163.28763`); reserve `100000` untouched | `0` (no broadcast) |
| 20 `witness_create` | membership basic, witness `null` | BLOCKED (LTM gate) | `witness_evaluator.cpp:35` requires `is_lifetime_member()`; sentinel `2106-02-07T06:28:15` | `0` |
| 21 `witness_update` | witness `null` (no target) + basic | BLOCKED (state+LTM) | no `1.6.x` to update; fee quoted `100` (dummy shape, fee rail only) | `0` |
| 29 `committee_member_create` | membership basic, committee `null` | BLOCKED (LTM gate) | `committee_member_evaluator.cpp:37` requires LTM | `0` |
| 30 `committee_member_update` | committee `null` + basic | BLOCKED (state+LTM) | no `1.5.x` to update; fee quoted `100` | `0` |
| 3 `call_order_update` | 0 positions; dust collateral-only shape (`10000` TEST + `0` debt, `1.3.1850`) | EVALUATOR-REACHED | `market_evaluator.cpp:565 do_evaluate`: `o.delta_debt.amount > 0: Delta debt amount of new debt position should be positive` (code 10). Bytes parsed (validate passed: `market.cpp:88-96`); NOT retried with debt — that opens a leveraged position, beyond the dust mandate | quoted `100`; delta `0` |
| 17 `asset_settle` | 0 MPA held; feed `0/0` | EVALUATOR-REACHED | `asset_evaluator.cpp:1179 do_evaluate`: `insufficient feeds` (code 37006; matches the settle-17 precedent pin) | quoted `100`; delta `0` |
| 34 `worker_create` | fee affordable (`100`) | EVALUATOR-REACHED (**LTM-gated — new finding**) | `worker_evaluator.cpp:39 do_evaluate`: `d.get(o.owner).is_lifetime_member()` (code 10). Dust shape (`daily_pay "1"`, 1-week refund window) parsed fine; consensus blocks non-LTM owners. Joins the post-op-8 queue | quoted `100`; delta `0` |
| 35 custom `9199` | plugin missing on dex.trading → fallback xbts.io | COVERED | storage `7.0.98`, catalog `trollbox-general`, text match `true`, via `broadcast_transaction_with_callback+storage-readback` | fee `15139`; `3771237` → `3756098`, delta `-15139` |
| 45 `bid_collateral` | `1.3.1850` not settled (`settlement_fund 0`); dust both-legs shape | EVALUATOR-REACHED | `market_evaluator.cpp:819 do_evaluate`: `_bitasset_data->is_globally_settled(): Cannot bid since the asset is not globally settled` (code 10). Validate passed (`market.cpp:99-103`) → bytes proven | quoted `100`; delta `0` |
| 37 `balance_claim` | 0 claimables (see pre-state) | BLOCKED (honestly unprovable) | no `1.15.x` to claim; nothing to build; fee would be consensus-0 (`balance.hpp:51`) | `0` |

Fixture TEST: start `3771237` → end `3756098`; **total delta `-15139`** (op-35 fee only).
Every spend recorded; rejections cost nothing (never included).

## Faucet — EXACTLY ONE attempt, SUCCEEDED (then STOPPED per rule)

| # | UTC | Request | Result (exact) |
|---|---|---|---|
| 1 (only) | ~17:21 | POST `https://testnet-faucet.xbts.io/api/v1/accounts` `{account:{name:"r2fund-cad3",owner_key,active_key,memo_key}}` (fresh noble keys via `Crypto.keypairFromPrivateHex`, TEST prefix; keys saved to `/tmp/r2-faucet-r2fund-cad3.json` 600-perms BEFORE POST; 90s timeout) | HTTP 200 `{"status":"Account created","account":{"name":"r2fund-cad3","owner_key":"TEST82WWgkdLeDnuCvEVfmHTEyE8nXxxUcHxn2PjALsgbDj6GNsPgr","active_key":"TEST55Rr2vVjcyAceWDDRTtqtvNDESZ9DxLXoUcmJ96JXwXAhzZr7x","memo_key":"TEST6B3JwPgVTT4u2LoSjLWrLGioBVNf9ZeC61NkSDyXTFoJrWaFQ9"}}` |

On-chain verify: `get_account_by_name("r2fund-cad3")` → `1.2.26839`, owner-key MATCH.
Funding (public read, no keys): `100000000` raw TEST (`1000.00000`) — standard faucet funding.
`/tmp` key file shredded (overwrite + unlink, verified gone). **No second POST, no
retry, no workaround — STOPPED.** No transfers made (moving throwaway→fixture funds
is a separate funded-transfer task, explicitly out of scope here).

## Unblock path (for a follow-up task, NOT done here)

1. Transfer ≥ ~165 TEST from `1.2.26839` to the fixture (needs a throwaway-signed
   transfer — new keys required, out of scope), OR wait for another faucet window.
2. Op-8 upgrade (`20000000` fee) → re-read membership `2106-02-07T06:28:15`.
3. Re-run LTM-gated proves: ops 20/29 (existing `prove_witness_create_20.cjs` /
   `prove_committee_create_29.cjs` gate on exactly this), then op-34 (same LTM
   gate, `worker_evaluator.cpp:39`) and ops 21/30 once objects exist.

## Repro (redacted — ids/blocks/fees only, never secrets)

```bash
node --check tooling/prove-round2-preread.cjs
node --check tooling/prove-round2-ltm.cjs
node --check tooling/prove-round2-affordable.cjs
node tooling/prove-round2-preread.cjs      # read-only, no keys
node tooling/prove-round2-ltm.cjs          # STOP exit 3: pre-read + ONE faucet POST, zero broadcasts
node tooling/prove-round2-affordable.cjs   # dust proofs with per-op deltas
git check-ignore -v tooling/testnet-lite-test-1.json  # must stay ignored
git status --short                          # only tooling/prove-round2-*.cjs + this note may show
```

SAFETY: TESTNET ONLY via `tooling/testnet-lite-test-1.json` (gitignored,
 600-perms). NEVER mainnet, NEVER commit secrets/keys. Logs carry
 ids/blocks/fees/deltas only. Leftover state created this round: trollbox
 message `7.0.98` (catalog `trollbox-general`) + throwaway account `1.2.26839`
 (faucet-funded, untouched). No margin positions, no workers, no bids created.

---

# Testnet proof round 3 — faucet-funded LTM queue attempt (2026-10-06)

> Fixture `lite-test-1` (`1.2.26833`), testnet ONLY (chain `39f5e2ed…617447`).
> Node `wss://testnet.dex.trading/` throughout. Scripts (new, owned by this
> task): `tooling/prove-round3-faucet-ltm.cjs` (ONE faucet POST →
> transfer-first-then-shred → op-8 → ops 20/29/34/21/30, each via the vanilla
> serializer path with dust-exact deltas), `tooling/prove-round3-recheck.cjs`
> (read-only late-funding + final-state check, zero keys, zero broadcasts).
> Secrets discipline: WIFs/brainkey never printed; fixture WIF in memory for
> sign calls only; throwaway keys in `/tmp` 600-perms, saved BEFORE POST.

## Faucet — EXACTLY ONE attempt (then STOPPED per rule)

| # | UTC | Request | Result (exact) |
|---|---|---|---|
| 1 (only) | ~17:26 | POST `https://testnet-faucet.xbts.io/api/v1/accounts` `{account:{name:"r3fund-512c",owner_key,active_key,memo_key}}` (fresh noble keys via `Crypto.keypairFromPrivateHex`, TEST prefix; keys saved to `/tmp/r3-faucet-r3fund-512c.json` 600-perms BEFORE POST; 90s timeout) | HTTP 200 `{"status":"Account created","account":{"name":"r3fund-512c","owner_key":"TEST7mMmHXJ3jxTpfzu6mujE8nXxxUcHxn2PjALsgbDj6GNsPgr","active_key":"TEST7Fh8nSZoDccwe99Gmm7Ti7uaR91k39DPD5VCb37F68QhRiZaSp","memo_key":"TEST8iuzpQLEoy6oyBE9WFRq9kwSy5pPhvpEmBVNf9ZeC61NkSDyXTFoJrWaFQ9"}}` |

 Immediate on-chain verify (`get_account_by_name("r3fund-512c")`):
 `1.2.26840`, owner-key MATCH, but TEST balance read `0` — taken as
 refused-funding, so the script shredded the `/tmp` key file (overwrite +
 unlink, verified gone) and recorded the refused branch. **No second POST,
 no retry, no workaround — STOPPED.**

## Late-funding finding (the hygiene lesson, recorded honestly)

A read-only recheck ~4 min later (`prove-round3-recheck.cjs`, head
`#101179263` 17:28:54Z) showed `1.2.26840` holding `100000000` raw TEST
(`1000.00000`) — the faucet's funding transfer confirms in a LATER block
 than account creation, and the immediate post-POST balance read raced it.
 The keys were already shredded, so this second 1000 TEST is STRANDED
 (same as round 2's `1.2.26839` — do not attempt recovery of either).

 LESSON (binding on future faucet tasks): a `0` balance on the first read
 after a faucet POST is NOT a refused-funding verdict — poll the throwaway
 balance for several minutes (quiet waits) BEFORE deciding funded-vs-refused,
 and NEVER shred until the verdict is settled or the transfer has confirmed.
 Transfer-first-then-shred was preserved (nothing was shredded while holding
 funds the task still needed — the shred happened on a `0` read), but the
 rule needs the polling amendment above to avoid stranding faucet funds.

## Per-op verdicts (round 3 — zero broadcasts, fixture untouched)

| op | pre-state | result | block / error | fee / delta (raw TEST) |
|---|---|---|---|---|
| 0 `transfer` (throwaway→fixture, 250 TEST) | throwaway read `0` at verify time | NOT ATTEMPTED (no funds observed; late funding arrived after shred) | — | `0` |
| 8 `account_upgrade` | balance `3756098`, direct fee `20000000` | BLOCKED (funds) | shortfall `16343902` raw (`163.43902`); reserve `100000` untouched | `0` (no broadcast) |
| 20 `witness_create` | membership basic, witness `null` | BLOCKED (LTM gate, re-confirmed) | `witness_evaluator.cpp:35` requires `is_lifetime_member()` | `0` |
| 21 `witness_update` | witness `null` (no target) + basic | BLOCKED (state+LTM) | no `1.6.x` to update | `0` |
| 29 `committee_member_create` | membership basic, committee `null` | BLOCKED (LTM gate, re-confirmed) | `committee_member_evaluator.cpp:37` requires LTM | `0` |
| 30 `committee_member_update` | committee `null` + basic | BLOCKED (state+LTM) | no `1.5.x` to update | `0` |
| 34 `worker_create` | fee affordable but owner basic | BLOCKED (LTM gate, round-2 evaluator pin stands) | `worker_evaluator.cpp:39 do_evaluate` | `0` (not re-broadcast per no-redo rule) |
| 3 / 17 / 45 | evaluator-reached round 2 | NOT REDONE (explicit task rule) | — | `0` |

 Fixture TEST: start `3756098` → end `3756098`; **total delta `0`**.
 Fresh balance quote at head `#101179263`: `3756098` raw (`37.56098`,
 p5) + `120000` `1.3.1849`; membership still `1970-01-01T00:00:00`
 (basic); witness/committee still `null`.

## Unblock path (for a follow-up task, NOT done here)

 1. The gate is unchanged: op-8 needs `20000000` raw (200 TEST); fixture
    holds `3756098`. A FUNDED throwaway with INTACT keys must transfer ≥
    ~165 TEST to the fixture — with the polling amendment above (confirm
    funding observed over several minutes BEFORE any shred decision).
 2. Stranded accounts `1.2.26839` + `1.2.26840` (1000 TEST each) are
    UNRECOVERABLE (keys shredded, verified gone) — a follow-up must use a
    NEW faucet account, never these.
 3. Then: op-8 upgrade → re-read membership `2106-02-07T06:28:15` → ops
    20/29/34 + 21/30 via the existing `prove-round3-faucet-ltm.cjs` funded
    branch (transfer → shred → queue, already written and syntax-checked).

## Repro (redacted — ids/blocks/fees only, never secrets)

```bash
node --check tooling/prove-round3-faucet-ltm.cjs
node --check tooling/prove-round3-recheck.cjs
node tooling/prove-round3-faucet-ltm.cjs   # ONE faucet POST + conditional queue; exits 3 on refused/funds STOP
node tooling/prove-round3-recheck.cjs      # read-only: throwaway/fixture balances + membership + gov nulls
ls /tmp/r2-faucet-* /tmp/r3-faucet-*       # must print "No such file or directory" (shred verified)
git check-ignore -v tooling/testnet-lite-test-1.json  # must stay ignored
git status --short                          # only tooling/prove-round3-*.cjs + this note may show (plus other workers' files)
```

 LEFTOVER STATE this round: throwaway `r3fund-512c` (`1.2.26840`,
 faucet-funded 1000 TEST AFTER shred — stranded, keys gone). No transfers,
 no upgrades, no witnesses/committee/workers, no margin positions created.

---

# Testnet proof round 4 — FINAL LTM funding round: queue COVERED (2026-10-06)

> Fixture `lite-test-1` (`1.2.26833`), testnet ONLY (chain `39f5e2ed…617447`).
> Node `wss://testnet.dex.trading/` throughout (op-77 leg re-run via
> `wss://testnet.xbts.io/ws` per `prove-op77-update.cjs`). Scripts (new, owned
> by this task): `tooling/prove-round4-faucet-ltm.cjs` (ONE faucet POST +
> 10-min `get_objects` poll → transfer-first-then-shred → op-8 → ops
> 20/29/34/21/30 → dust op-1 → op-77, all via the vanilla serializer path with
> dust-exact deltas), `tooling/prove-round4-recheck.cjs` (read-only
> final-state check, zero keys, zero broadcasts; optional throwaway id/name
> argv). Secrets discipline: WIFs/brainkey never printed; fixture WIF in
> memory for sign calls only; throwaway keys in `/tmp` 600-perms, saved
> BEFORE POST, shredded AFTER the transfer confirmed (verified gone).

## Faucet — EXACTLY ONE attempt, FUNDED (the poll amendment vindicated)

| # | UTC | Request | Result (exact) |
|---|---|---|---|
| 1 (only) | ~17:37 | POST `https://testnet-faucet.xbts.io/api/v1/accounts` `{account:{name:"r4fund-9d34",owner_key,active_key,memo_key}}` (fresh noble keys via `Crypto.keypairFromPrivateHex`, TEST prefix; keys saved to `/tmp/r4-faucet-r4fund-9d34.json` 600-perms BEFORE POST; 90s timeout) | HTTP 200 `{"status":"Account created","account":{"name":"r4fund-9d34","owner_key":"TEST6xMxjQGivur4GM3XX7hwVD5P824RJbEPPg3c31i1xiGymkMcpr","active_key":"TEST6TxFdPv9VMDFu115n42q3aqWHLTm9XjyV8e7nkLUoYjYj6DXm6","memo_key":"TEST5F2qqpj6tXh3dH48hxvVujAY5cmx7c67ggjkF8g2nTT5h8D1su"}}` |

Poll log (binding §2: immediate 0 = "not yet", never "refused"):

| round | UTC | `get_objects` | TEST balance raw | verdict |
|---|---|---|---|---|
| verify | 17:38:00Z | — | `0` (`1.2.26841`, owner-key MATCH) | not-yet, keep polling — NO shred |
| 1/10 | 17:39:00Z | `1.2.26841` | `100000000` (`1000.00000`) | funds observed → proceeding (head `#101179459`) |

Funding landed ~1 min after creation — inside the window that stranded rounds
2–3. No further polls needed; keys intact throughout.

## Per-op verdicts (round 4 — vanilla serializer path, re-read proofs)

| op | pre-state | result | block / error | fee / delta (raw TEST) |
|---|---|---|---|---|
| 0 `transfer` (throwaway→fixture, 250 TEST) | throwaway `100000000`, fixture `3756098` | COVERED | `#101179459` via `broadcast_transaction_with_callback+re-read` | fee `86869` (throwaway-paid: `100000000` → `74913131`); fixture `3756098` → `28756098`, delta `+25000000` exact |
| 8 `account_upgrade` | balance `28756098`, direct fee `20000000` | COVERED | `#101179459` via `broadcast+re-read` | membership `1970-01-01T00:00:00` → `2106-02-07T06:28:15` (LTM); `28756098` → `8756098`, delta `-20000000` |
| 20 `witness_create` | LTM fresh, witness `null` | COVERED | `#101179460` via `broadcast+re-read` | `1.6.131` (`https://example.com/vanilla-witness-20`); fee `100`, delta `-100` |
| 29 `committee_member_create` | LTM fresh, committee `null` | COVERED | `#101179460` via `broadcast+re-read` | `1.5.35` (`https://example.com/vanilla-committee-29`); fee `100`, delta `-100` |
| 34 `worker_create` | owner now LTM | COVERED | `#101179460` via `broadcast+re-read` | `1.14.55` (`r4-dust-worker`, `daily_pay 1`); fee `100`, delta `-100` |
| 21 `witness_update` | `1.6.131` exists | COVERED | `#101179461` via `broadcast+re-read` | url → `…/vanilla-witness-21`; fee `100`, delta `-100` |
| 30 `committee_member_update` | `1.5.35` exists | COVERED | `#101179461` via `broadcast+re-read` | url → `…/vanilla-committee-30`; fee `100`, delta `-100` |
| 1 `limit_order_create` (dust: sell `10000` TEST `1.3.0`/p5, buy `1000` BTS `1.3.1420`/p5 — ids resolved live via `lookup_asset_symbols`, never hardcoded) | LTM, TEST dust + fee dust available | EVALUATOR-REACHED | `market_evaluator.cpp:78` code `3050105` `limit_order_create_receiving_asset_unauthorized`: "The account is not allowed to transact the receiving asset" — BTS carries whitelist `flags=3` (slice-06), fixture not whitelisted; bytes parsed, consensus refused. Honestly unprovable as COVERED on a BTS pair | quoted fee not logged on the evaluator path by the script; delta `0` (rejections never included) |
| 77 `limit_order_update` | no `1.7.x` (op-1 rejected, none pre-existing) | BLOCKED (no-target) | `prove-op77-update.cjs` re-run: exit 2 PROOF-BLOCKED, `open_orders []`, zero broadcasts | `0` |
| 3 / 17 / 45 | evaluator-reached round 2 | NOT REDONE (explicit task rule) | — | `0` |

Fixture TEST: start `3756098` → end `8755598`; **total delta `+4999500`**
(`+25000000` transfer `−20000000` op-8 `−5×100` queue fees; transfer fee
`86869` paid by the throwaway, not the fixture). Every spend recorded;
rejections cost nothing (never included).

Independent recheck (`prove-round4-recheck.cjs r4fund-9d34`, head
`#101179491`): throwaway `1.2.26841` `74913131`; fixture `8755598` +
`120000` `1.3.1849`; `is_ltm true`; witness `1.6.131` (url `…-21`);
committee `1.5.35` (url `…-30`); workers [`1.14.55 r4-dust-worker`];
orders `[]`. Matches the run log exactly.

## Repro (redacted — ids/blocks/fees only, never secrets)

```bash
node --check tooling/prove-round4-faucet-ltm.cjs
node --check tooling/prove-round4-recheck.cjs
node tooling/prove-round4-faucet-ltm.cjs   # ONE faucet POST + 10-min poll + queue; exits 0 covered / 3 funds STOP
node tooling/prove-round4-recheck.cjs [throwaway-id-or-name]  # read-only final-state check
node tooling/prove-op77-update.cjs         # exit 2 PROOF-BLOCKED while fixture holds no 1.7.x
ls /tmp/r4-faucet-*                        # must print "No such file or directory" (shred verified)
git check-ignore -v tooling/testnet-lite-test-1.json  # must stay ignored
git status --short                          # this task owns only tooling/prove-round4-*.cjs + this note (plus other workers' files)
```

 SAFETY: TESTNET ONLY via `tooling/testnet-lite-test-1.json` (gitignored,
 600-perms). NEVER mainnet, NEVER commit secrets/keys. Logs carry
 ids/blocks/fees/deltas/pubs only. LEFTOVER STATE this round: throwaway
 `r4fund-9d34` (`1.2.26841`, remainder `74913131` raw — keys shredded AFTER
 the transfer per procedure, remainder treated as spent); fixture now LTM
 with witness `1.6.131`, committee `1.5.35`, worker `1.14.55` (intentional
 dust-fee proofs). No margin positions, no bids, no orders created. Stranded
 round-2/3 accounts `1.2.26839`/`1.2.26840` remain UNRECOVERABLE — untouched.

---

# Testnet proof round 5 — LAST open proof closed: op-77 limit_order_update COVERED (2026-10-06)

> Fixture `lite-test-1` (`1.2.26833`), testnet ONLY (chain `39f5e2ed…617447`).
> Node `wss://testnet.dex.trading/` throughout. Script (new, owned by this
> task): `tooling/prove-round5-dust-order77.cjs` (dust op-1 create
> AFKTEST10→TEST + op-77 expiry-only update on that order, both via the
> vanilla serializer path with dust-exact deltas). Read-only confirm via the
> existing `tooling/prove-round4-recheck.cjs` (zero keys, zero broadcasts).
> Secrets discipline: fixture WIF in memory for sign calls only, never
> printed; fixture file read-only (mtime + perms unchanged); logs carry
> ids/blocks/fees/deltas only.

## Why this pair (round-4 context)

Round 4's dust `limit_order_create` (sell TEST `1.3.0`, buy BTS `1.3.1420`)
was evaluator-rejected — `market_evaluator.cpp:78` code `3050105`
`limit_order_create_receiving_asset_unauthorized` (BTS `flags=3` whitelist,
fixture not whitelisted) — leaving zero open orders, so
`tooling/prove-op77-update.cjs` exits 2 PROOF-BLOCKED. This round sells dust
of `AFKTEST10` (`1.3.1849`: fixture IS issuer, `flags=0`, empty
whitelist/blacklist — live `get_assets` pre-read) for core TEST (`1.3.0`, no
whitelist): both authorization ends clean by construction.

`prove-op77-update.cjs` was NOT run: it predates the slice-18 serializer
split and no longer loads `api/tx-primitives.js` + `api/tx-ops-trade.js` +
`api/tx-ops-gov.js`, so `Tx._ser.serializeLimitOrderUpdateOp` is undefined
at its `buildTx` (it would throw `FAILED` on any target — never reached
while orders were `[]`). Ownership forbids touching it; the round-5 script
replicates its exact expiry-only path (same op shape, same +30d rule, same
`get_limit_orders_by_account` re-read proof) with the round-4-proven load
list.

## Pre-state (live re-reads, this round)

| Item | Observed |
|---|---|
| Account | `lite-test-1` (`1.2.26833`), LTM sentinel `2106-02-07T06:28:15` |
| TEST balance | `8755598` raw (`87.55598`, p5) |
| AFKTEST10 (`1.3.1849`, p4) | `120000` raw, issuer `1.2.26833` (= fixture), `flags=0`, `issuer_permissions=79`, no lists |
| Open orders | `[]` (head `#101179565`) |

## Per-op verdicts (round 5 — vanilla serializer path, re-read proofs)

| op | shape (dust) | result | block / proof | fee / delta (raw) |
|---|---|---|---|---|
| 1 `limit_order_create` | SELL `5000` `1.3.1849` / min `100` `1.3.0`, exp `2026-11-05T17:44:30`, no FOK | COVERED | `#101179566` via `broadcast_transaction_with_callback+re-read` → order `1.7.9233099` | fee `100`; TEST `8755598` → `8755498` (`-100`); AFKTEST10 `120000` → `115000` (`-5000` locked in order) |
| 77 `limit_order_update` | expiry-only `2026-11-05T17:44:30` → `2026-12-05T17:44:30` (+30d, no funds move, exactly one optional set — Q1 rule) | COVERED | `#101179567` via `broadcast+re-read`: order object shows new expiration; `deferred_fee 75` | quoted fee `75`; TEST `8755498` → `8755516` (net `+18`: deferred-fee accounting returns more than the quote — recorded as observed, not adjusted) |

Fixture TEST: start `8755598` → end `8755516`; **total delta `-82`**
(`-100` op-1 fee `+18` op-77 net). AFKTEST10: `120000` → `115000`
(`-5000` dust locked in the still-open order — recoverable via cancel,
deliberately left open as the proof artifact).

Independent recheck (`prove-round4-recheck.cjs`, head `#101179570`):
balances `8755516` + `115000` match; orders [`1.7.9233099`,
exp `2026-12-05T17:44:30`]; LTM/witness/committee/worker unchanged. Exact match.

## Repro (redacted — ids/blocks/fees only, never secrets)

```bash
node --check tooling/prove-round5-dust-order77.cjs
node tooling/prove-round5-dust-order77.cjs   # dust op-1 + op-77; exits 0 honest-end / 3 funds STOP / 1 shape-bug
node tooling/prove-round4-recheck.cjs        # read-only confirm: balances + 1.7.x expiration
git check-ignore -v tooling/testnet-lite-test-1.json  # must stay ignored
git status --short                          # this task owns only tooling/prove-round5-dust-order77.cjs + this note
```

SAFETY: TESTNET ONLY via `tooling/testnet-lite-test-1.json` (gitignored,
600-perms, untouched). NEVER mainnet, NEVER commit secrets/keys. LEFTOVER
STATE this round: open dust order `1.7.9233099` (sell `5000` AFKTEST10 / min
`100` TEST, exp `2026-12-05T17:44:30`) — intentional proof artifact, cancellable
anytime via op-2. No margin positions, no workers, no bids created.
