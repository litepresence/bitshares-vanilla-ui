# Deferred chain-op verdicts (chain-doctor ruling)

> Date: 2026-10-06. READ-ONLY ruling — no code changed, no commit.
> Procedure: `chain-doctor` (read wide, tiebreakers in order, never invent).
> Ground truth: `reference/bitshares-core` headers (`develop`, HEAD `fe7000c`).
> Triangulated: #1 `bitshares-ui` (`79f8cca`) · #2 `astro-ui` (`5037d61`) ·
> #3 `wallet-extension` (`ebb7451`) · BJS-via-#2 `src/bts/` ·
> machine oracle `reference/open-graphene/.../bitshares.open-graphene.json`.
> Tiebreakers applied: #4 wins reference conflicts; nothing here had a live
> testnet observation, so no testnet-overrides-headers case arises; #3 wins
> crypto-discipline questions; landed vanilla code (`vanilla/js/api/tx.js`
> ASSESSED notes) wins ties. Standing ASSESSED notes in
> `vanilla/js/api/tx.js:150-219` were independently re-verified below —
> agreed in all six cases, with one flip from note to build order (op-77).

## Q1 — Op-77 `limit_order_update_operation`: SIGNABLE, verdict IMPLEMENT

**Verdict: IMPLEMENT** — in-place update form (NOT cancel+recreate).

Header evidence (all #4, all agree with the oracle):

- `libraries/protocol/include/graphene/protocol/operations.hpp:133` —
  `/* 77 */ limit_order_update_operation`, last union member, NOT marked
  `// VIRTUAL` (virtuals 4/42/44/46/51/53/74 all are).
- Struct `libraries/protocol/include/graphene/protocol/market.hpp:117-136`:
  `fee`, `seller`, `order`, `optional<price> new_price`,
  `optional<asset> delta_amount_to_sell`, `optional<time_point_sec> new_expiration`,
  `optional<vector<limit_order_auto_action>> on_fill`, `extensions`;
  `fee_payer()` = seller (`market.hpp:134`); `fee_params_t` =
  3/8 PRECISION (`market.hpp:119-121`).
- Evaluator EXISTS: `libraries/chain/include/graphene/chain/market_evaluator.hpp:62-88`
  (`limit_order_update_evaluator`, do_evaluate + do_apply + fee overrides).
  Corroborated by `hardfork_visitor.hpp:50` (`hf1604_ops` lists the op) and
  op-specific exceptions `exceptions.hpp:141-143`.
- FC_REFLECT field order `market.hpp:299-300`:
  `(fee)(seller)(order)(new_price)(delta_amount_to_sell)(new_expiration)(on_fill)(extensions)`.
- Oracle concurs: open-graphene op-77 fields 0–7 in exactly that order
  (fee, seller→account, order→limit_order, optional price, optional asset,
  optional time_point_sec, optional vector static_variant, extensions set).

Reference triangulation:

- #1 has NO update path (grep over `Exchange/`, `actions/`, `lib/` empty) —
  #1 users cancel + recreate. No conflict: absence, not contradiction.
- #2 HAS the op end to end: serializer `src/bts/serializer/operations.js:1667-1675`
  (field order matches FC_REFLECT exactly), enum `ChainTypes.js:141`,
  edit UX `src/components/MarketOrder.jsx:149-156` (price/amount/total/expiry
  locks) → `DeepLinkDialog operationNames=["limit_order_update"]`
  (`MarketOrder.jsx:1567-1572`). Caveat: #2 signs via Beet deep-link, so it
  proves the SHAPE, not local signing.
- #3 HAS the wire-correct vanilla serializer
  `src/lib/bitshares-api.js:1840-1889` (fee, seller, order 1.7.x,
  three optionals, on_fill, empty extensions) INCLUDING the audited subtlety
  at `:1870-1883`: absent `on_fill` must encode as empty optional `0x00`,
  never present-but-empty `0x01 0x00`, or the node recovers the wrong signer
  ("Missing Active Authority"). Confirm dialog `src/popup/popup.js:2805`,
  dApp-allowlisted (`wallet-manager.js:1694`). This is the byte source the
  builder ports.
- Vanilla today: cancel (op-2) + recreate (op-1) only
  (`views/market-orders.js` cancel flows; `tx.js` dispatch has no 77;
  error text names "77 adjust-via-cancel+recreate").

Serializer spec for the builder (struct + FC_REFLECT order):

```
limit_order_update =
  fee: asset
  seller: protocol_id(account)            // fee_payer, signs (active)
  order: protocol_id(limit_order 1.7.x)   // must be seller's open order
  new_price: optional(price)              // base/quote pair, both precisions
  delta_amount_to_sell: optional(asset)   // SIGNED delta (+add / −remove)
  new_expiration: optional(time_point_sec)
  on_fill: optional(vector(limit_order_auto_action)) // absent => 0x00, see #3 subtlety
  extensions: set (always empty)
fee via get_required_fees (never #1 static tables, #3720 rule).
```

UI shape: **in-place update form**, an "Adjust" affordance on the user's own
open orders (market-orders row/card). Prefill price/amount/expiry from the
`1.7.x` object; send only changed fields as set, the rest null; shared
`ConfirmDialog` rows (order id, old→new price, delta amount, old→new expiry,
fee human via `Format`); unlock-at-sign; re-read the order object as proof.
Why not cancel+recreate: two fees instead of one, loses queue position, and
#2 already proves the edit-dialog UX (`MarketOrder.jsx`). Open point for the
builder's testnet proof (validate() body lives in the un-checked-out .cpp):
whether an all-null update is rejected — send ≥1 changed field and record it.

Reopener: n/a — this IS the build order. Close-out = testnet inclusion +
re-read proof in the owning slice's parity note.

## Q2 — Assessed-gap ops verdicts

| op | verdict | header evidence (file:lines) | spec-or-reason | reopener |
|---|---|---|---|---|
| 5 `account_create` | DOCUMENTED-DEFER | struct+`registrar` pays/LTM-gated `protocol/.../account.hpp:81-126` (fee_params `:91-96`, `fee_payer` registrar `:115`); FC_REFLECT `:288-292`; evaluator `chain/.../account_evaluator.hpp:30-37`; oracle op-5 fields agree | Faucet covers registration (`views/create-account-ui.js:1-38`, faucet alive per slice-02); local-sign path needs an LTM registrar + premium/basic/price-per-kbyte tiers no UI path needs. #3 serializer (`bitshares-api.js:2402-2414`) + broadcast (`wallet-manager.js:720`) and #2 LTM flow (`content/docs/docs/settings/create_account.mdx:48`) are the spec pointers when needed. | Faucet unavailable (esp. mainnet) OR LTM-registrar demand; then port #3 serializer + prove op-5 inclusion on testnet |
| 9 `account_transfer` | DOCUMENTED-DEFER | struct `protocol/.../account.hpp:267-278`, FC_REFLECT `:311`, trivial validate `protocol/account.cpp:275-278` — BUT **no evaluator declared** in any `chain/include` header (`account_evaluator.hpp:30-71` lists create/update/upgrade/whitelist only; `transfer_evaluator.hpp:31-48` covers 0/38 only; repo-wide grep: zero `account_transfer` hits under `libraries/chain/`); exceptions entry commented out (`exceptions.hpp:165`) | Two independent legs: (a) chain acceptance unproven — #1's own test note says `["account_transfer", …] // Crashes the node currently` (`app/test/README.txt:108`); (b) danger — irreversible ownership transfer; key rotation via op-6 already covers the legitimate need, and the wallet should not offer a foot-gun. #3 CAN encode the bytes (`bitshares-api.js:2462-2469`) but bytes ≠ acceptance. Honest scoping: `sliced_lists.hxx:81` "Unimplemented" is BSIP-40 custom-authority nesting scope, NOT chain-wide — not cited as acceptance evidence either way. | Testnet inclusion proof of a signed op-9 (would settle the evaluator question empirically) PLUS an owner danger-UX decision with extreme gating; without both it stays deferred |
| 18 `asset_global_settle` | DOCUMENTED-DEFER | struct `protocol/.../asset_ops.hpp:238-250` (`issuer` must equal asset issuer `:243`); FC_REFLECT `:721-722`; evaluator `chain/.../asset_evaluator.hpp:139-142` (exceptions entry commented `:177` — evaluator still declared, so signable-by-issuer) | Issuer-only by construction; for committee-owned bitassets the issuer IS `committee-account`, so the only honest path is committee multisig → proposal nesting (op-22 wrapper + op-23 approvals, both live in vanilla). No vanilla form exists and a solo form would serve only self-issued bitassets. #1 builder (`AssetActions.js:238`) + #3 serializer (`bitshares-api.js:2596-2604`) are the spec pointers. Display already PORTED (history/explorer rows). | Proposal-nesting settle form lands (propose-as-committee path) OR proven demand for a self-issuer settle button; then port #3 bytes + prove inclusion |
| 31 `committee_member_update_global_parameters` | DOCUMENTED-DEFER | struct `protocol/.../committee_member.hpp:84-93`; header comment `:82-83` "may only be used in a proposed transaction…"; `fee_payer()` returns EMPTY account (`:91`) — direct signing is structurally impossible; FC_REFLECT `:107`; evaluator `chain/.../committee_member_evaluator.hpp:48-54` | Two blockers: (a) proposal-only by header contract — needs the op-22 nesting UI first; (b) NO wire-correct vanilla source — #3's serializer is an explicit JSON-blob stub (`bitshares-api.js:2804-2817`: "best-effort… would need to match the chain_parameters serializer exactly"), and `chain_parameters` is a 165-line struct (`chain_parameters.hpp`, whole file) needing its own audited slice. Vanilla reads fee params today (`views/fees-ui.js`) — reads stay, writes wait. | (1) audited `chain_parameters` serializer slice lands, AND (2) proposal-nesting authoring UI exists; then wire op-31 inside op-22 + prove on testnet |
| 36 `assert_operation` | DOCUMENTED-DEFER | struct `protocol/.../assert.hpp:93-106` (predicates vector `:99` + `required_auths` `:100`); predicate variants `:79-83`; FC_REFLECT `:115`; evaluator `chain/.../assert_evaluator.hpp:31-38`; oracle op-36 fields agree | Predicates are NOT approvals: assert verifies pre/post-conditions, it does not move multisig approval — vanilla multisig approve/reject already signs op-23 via `Proposal.buildApprove/buildUnapprove` (`js/api/proposal.js:120-134`, dispatched `tx.js:62`). No UI builds predicates; #3's wire-correct serializer (`bitshares-api.js:2881-2910`, incl. `[type,data]` array-form note `:1889-1890`) is the spec pointer if a real use case appears. Display already PORTED (name table). | A concrete user story needing on-chain pre/post-condition assertion (not approval) with owner sign-off; then port #3 bytes + prove inclusion |

## Q3 — Blind 39–41: downscope HOLDS (re-checked #2/#3 current state)

Chain side is NOT the blocker: structs `protocol/.../confidential.hpp:150-167`
(39) / `:238-259` (40) / `:173-193` (41), FC_REFLECT `:277-282`, and all three
evaluators exist (`chain/.../confidential_evaluator.hpp:30-58`). A client that
could mint the crypto could sign. The block is purely client crypto, unchanged:

- #3 serializes but never mints: `bitshares-api.js:2951-2985` passthrough-encode
  caller-supplied `blinding_factor` (32B) / `commitment` (33B) / `range_proof`
  bytes; `crypto-utils.js` has ZERO blind/commitment/range-proof/stealth matches —
  no mint, no Pedersen, no bulletproof, no stealth ECDH anywhere in #3.
- #2 does not mint either: `src/bts/ecc/` is 9 files (Aes, PrivateKey, PublicKey,
  address, ecdsa, ecsignature, hash, key, signature — no blind/Pedersen file),
  and `src/components/BlindTransfers.jsx:76` treats blinding-factor/commitment/
  range-proof as user-pasted hex with tooltip explanations ("unclear
  cryptographic fields… what to enter"). Serializers exist
  (`operations.js:1259-1276` + fee params `:289-306`); minting does not.
- Landed vanilla position (`tx.js:166-172`, matrix C23/D7) already states this;
  re-verified, no new auditable vanilla source found in either reference.

**Verdict: DOWNSCOPE HOLDS** — no serializer lands until blind-crypto ships as
its own audited slice. Reopener: an audited vanilla slice delivering Pedersen
commitment mint + bulletproof range proofs + blinding-factor stealth ECDH
(WebCrypto/noble discipline per #3 patterns); THEN port byte serializers and
prove 39→40→41 lifecycle on testnet. Never half-port (bytes without mint =
unusable form).

## Ruling log

| Method/op | Options (per-reference, file:lines) | Ruling | Reason (tiebreaker) | Date |
|---|---|---|---|---|
| op-77 update form | in-place (#2 MarketOrder) vs cancel+recreate (#1 = only path; vanilla today) | in-place IMPLEMENT | #4 evaluator+struct prove signability; #3 gives wire-correct bytes incl. subtlety; #2 proves UX shape — unanimous, no conflict to break | 2026-10-06 |
| op-5 local-sign | faucet-only (vanilla) vs LTM local-sign (#2 docs, #3 broadcast) | DOCUMENTED-DEFER | consistency w/ landed code; no UI path needs it; faucet works | 2026-10-06 |
| op-9 offer-or-not | encode-able (#3) vs no-evaluator + crash-note + danger | DOCUMENTED-DEFER | strictest discipline + never invent (no evaluator in headers; acceptance unproven) | 2026-10-06 |
| op-18 solo form | solo issuer form (#1 builder) vs proposal-nesting | DOCUMENTED-DEFER | issuer-only + committee-owned reality → nesting is the honest path | 2026-10-06 |
| op-31 direct form | direct (#3 stub — not wire-correct) vs proposal-only + params slice | DOCUMENTED-DEFER | #4 header ("proposed transaction only", empty fee_payer) wins; #3 stub is not a source | 2026-10-06 |
| op-36 predicates UI | new predicates builder vs op-23 approve coverage | DOCUMENTED-DEFER | predicates ≠ approvals; op-23 path already live | 2026-10-06 |
| ops 39-41 | port serializers now vs downscope | DOWNSCOPE HOLDS | #3 crypto discipline: no auditable mint source in #2 or #3 | 2026-10-06 |
