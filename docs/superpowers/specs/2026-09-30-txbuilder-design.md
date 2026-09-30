# TxBuilder — multi-account, multi-op transaction composer

**Date:** 2026-09-30
**Status:** design (no code; implementation follows via writing-plans)
**Owner architecture (binding, from the task brief):** forms propose ops, never accounts.
The composer collects `[opId, opData]` pairs from any account. At sign time the
wallet resolves required authorities (`account_auths` / `key_auths` via
`get_objects` on the involved accounts) against unlocked keys and signs with
every matching key. Missing keys surface as an honest "unsigned for X" state,
never silent. Broadcasting a partially-signed multisig tx is allowed by the
chain (signatures can be added later) — the design supports save / export /
import of unsigned-tx JSON for multi-device signing ceremonies.
**Scope guard:** this spec designs the composer, its authority resolution, its
ceremonies, and the migration of 3 pilot forms. It does NOT redesign the
keystore (single-brainkey today), the serializers, or the broadcast transport.

---

## 1. Context and evidence (what exists today)

| Concern | Current vanilla truth (file:line) |
|---|---|
| Serializer registry + op dispatch | `vanilla/js/tx.js` — `Tx._ser.serializeTransaction` plus per-op serializers (ops 0–3, 6–8, 10–17, 19–24, 25–30, 32–34, 37, 43, 47–50, 52, 54–63, 75–76, …); header documents provenance per function against #3 `bitshares-api.js` and #4 headers |
| Envelope / fee / sign / broadcast | `vanilla/js/tx-send.js` — `Tx.buildTx` (:125, any `[opId, opData]` list, ref-block + 30 s expiry from `get_dynamic_global_properties`), `Tx.buildTransfer` (:162, op-0 on top of `buildTx`), `Tx.fee` (:48, single op, unwraps the op-22 `[flat, [inners]]` nested shape per #3 `:1339-1341`), `Tx.feeMulti` (:73, ONE `get_required_fees` call for the full list, fills fees in place), `Tx.sign` (:189, single WIF, digest `SHA-256(chainId + packed)`, **overwrites** `signatures=[hex]`), `Tx.broadcast` (:253, callback-first + plain fallback, inclusion proven by op-0 history poll only) |
| Existing multi-op path | `vanilla/js/proposal.js:104-111` `buildCreate` — wraps `innerOps` (bare `[t, d]` or `{op:[t, d]}`, normalised by `_normInnerOps`) into op-22 `{fee_paying_account, expiration_time, proposed_ops, review_period_seconds}`; `fee` (:203) and `sendAndProve` (:211) follow the vote pattern |
| Review / confirm pattern to generalise | `vanilla/js/transfer-ui.js` Send/Propose toggle (commit `8432b52`, 2026-09-29) + `vanilla/js/transfer-confirm.js:155-218` `review()` (validate → build unsigned → live fee → confirm context) and `:226-304` `showConfirm` (human `dl` rows From/To/Amount/Memo + Fee + Network, raw-JSON `<details>`, Back + Sign & Send) |
| Keys / memory / unlock | `vanilla/js/wallet.js` — single-brainkey envelope (`bts-vanilla-wallet-v1`, PBKDF2-600k + AES-GCM), in-memory `_data`/`api.keys` (`{owner, active, memo}` WIF+pub triples), 5-minute + hidden-tab auto-lock, exponential + persisted rate-limit; `Wallet.keys` is the ONLY signing source, WIFs pass as JS values, never into the DOM |
| Multi-op broadcast precedent | `vanilla/js/vote-ui.js:716-790` `publishWithRetry` + `sendAndProve` — local send (callback + plain fallback, `sendRejected` flag) then prove by **re-reading domain state** (slate match), never by trusting the send ack; `pool.js:355-383` `sendAndProve` is the same shape |
| Human-row convention | #3 `reference/wallet-extension/src/popup/popup.js:5544+` `OPERATION_NAMES` + `:5717+` `renderOperationDetails` — the per-op row spec (From/To/Amount/Memo for op-0, etc.). Vanilla MUST follow its row order/labels but render amounts human via `Format` (the #3 table shows raw integers; principle #6 forbids that) |
| Approval-pattern concepts (only) | #3 `reference/wallet-extension/src/background/service-worker.js` — per-request popup approval (`:649-698`), 60 s timeout (`:658, :753`), one-pending-request gate (`:698, :937`), `allowedAccountIds` bound so a site connected to A can't sign as B (`:718-721, :1262-1272`), chain-id re-verified at approval time (`:1169-1170`), `signMessage` deliberately unimplemented against blind-signing (`:917-928`). No `chrome.*` plumbing is ported; the concepts ported are: explicit per-tx approval screen, timeout, account binding, chain-id check, no blind signing |
| Chain ground truth for authority APIs | #4 `reference/bitshares-core/libraries/app/include/graphene/app/database_api.hpp:1262-1295` — `get_required_signatures(trx, available_keys)`, `get_potential_signatures(trx)`, `get_potential_address_signatures(trx)`, `verify_authority(trx)`, `verify_account_authority(name_or_id, signers)` |
| Key primitive | `vanilla/js/crypto.js:641-671` `signHash(hashU8, wif)` → 65-byte compact sig (noble secret-scalar path only); `vanilla/js/account.js:33-60` `resolve(nameOrId)`, `:404-414` `myAccountId()` (wallet active seq1 pub → `get_key_references`); `vanilla/js/chain.js:285-314` `db()/history()/net()`, `:211-228` `chainId` captured at connect and in `Chain.status()` |

**What is missing today (the gap this spec closes):** there is no place where
ops from *different* accounts coexist. Every form builds exactly one op for
exactly the wallet account, signs with the one active WIF (`transfer-confirm.js:280`,
`vote-ui.js:687`), and broadcasts immediately. A vote-publish for Alice plus a
transfer from Bob cannot be composed, a multisig authority cannot be honestly
left half-signed, and a second signer on another device has no JSON to import.

---

## 2. Approaches considered

Three shapes were weighed. The brief already binds the owner architecture
(forms propose ops; composer collects pairs; wallet resolves at sign time), so
these differ only in *where the composer lives and what it reuses*.

### A. Composer module + `#/txbuilder` desk (RECOMMENDED)

A new dependency-free `js/txbuilder.js` owns op-pair state (no DOM); a new
`js/txbuilder-ui.js` renders a full route desk (review rows, auth rows, fee
line, export/import, send choice). Pilot forms gain one secondary
"Add to TxBuilder" button; their one-shot paths are untouched. Authority
resolution is client-side `get_objects` (owner binding) with the
`get_required_signatures` / `verify_authority` node methods as a best-effort
cross-check only.

*Pros:* deep-linkable (`#/txbuilder`), phone stacks naturally with the existing
`wrap wide` + `dl` idioms, no global drawer state, confirm flows keep working,
one purpose per file (principle #8), zero new chain methods required.
*Cons:* one more route in an already long table; users must navigate to the
desk (mitigated by a header badge + post-add navigation).

### B. Global drawer / slide-over composer (REJECTED)

A persistent drawer available on every page, holding the op list.

*Pros:* always visible while composing across forms.
*Cons:* needs global open/close state outside the hash router (a new
framework-shaped abstraction — §4.5 rule 2); drawers are the worst pattern for
360 px phones (cover content, trap focus, hover/touch conflicts) and violate
principle #7; the confirm/approve screen still needs a full page anyway, so the
drawer duplicates the desk instead of replacing it. Rejected.

### C. Proposal-only composition — wrap everything in op-22 (REJECTED as the base)

Reuse `Proposal.buildCreate` for all multi-op flows: the "bundle" is always a
proposal whose inner ops are the composer ops.

*Pros:* reuses the only proven multi-op path today; approval semantics come free.
*Cons:* changes semantics silently — proposal inners execute only after
approvals, while a direct bundle executes atomically at broadcast. Forcing every
bundle through op-22 would delay same-block intent (transfer + stake) by a
review period and charge the wrapper fee even when the user wants direct
execution. Proposal-wrap stays as *one* send path ( §7), not the composer
itself. Rejected as the base, kept as an option.

---

## 3. Design: state shape

### 3.1 Composer entry (in-memory only)

```js
// js/txbuilder.js — one entry per proposed op. No DOM, no keys, no signing.
{
  key: "tb-0007",            // local uid (counter + random suffix); never a chain id
  opId: 0,                   // integer op index (same domain as Tx._ser dispatch)
  opData: {                  // fee is a ZERO placeholder until feeAll fills it
    fee: { amount: "0", asset_id: "1.3.0" },
    from: "1.2.17", to: "1.2.20",
    amount: { amount: "150000", asset_id: "1.3.0" },
    extensions: []
  },
  source: "transfer:alice→bob 1.5 BTS",  // human provenance, set by the proposing form
  addedAt: "2026-09-30T12:00:00"         // ISO; display + export ordering only
}
```

Rules: amounts stay raw digit strings end to end (principle #6 — `Number()`
never touches money; `Format.parseAmount` at form edge, `Format.formatAmount`
at render). `opData` objects are owned by the composer (forms hand over the
pair; the composer deep-clones on `addOp` so later form edits cannot mutate a
queued op). `key` is local only and never serialised into chain bytes.

### 3.2 Composer state (single object, pub/sub like `Store`)

```js
TxBuilder.state() -> {
  ops: [ entry, ... ],        // §3.1, in composer order (== broadcast order)
  feeAssetId: "1.3.0",        // one fee asset for feeAll (core default; UI-selectable later)
  fees: null | {              // last feeAll answer (raw + display; display via Format at render)
    perOp: [{ amount, asset_id }, ...],
    totalRaw: "12345",        // BigInt sum digit string
    totalDisplay: "1.2345"    // Format.formatAmount(totalRaw, fee precision)
  },
  requiredAuths: null | [     // last resolveAuths answer (§5)
    { accountId: "1.2.17", accountName: "alice", level: "active",
      threshold: 1, availablePubs: ["BTS…"], missing: false },
    ...
  ],
  availablePubs: [],          // pubs the resolver matched against (Wallet.keys pubs at resolve time)
  signatures: [],             // parallel to a built unsigned tx: [{ pub, hex }] (empty until sign)
  chainId: null,              // Chain.status().chainId captured at buildUnsigned; export/import guard
  built: null                 // last built unsigned tx (Tx.buildTx shape) or null when ops changed
}
```

Invalidation rule (no silent staleness): **any** `addOp` / `removeOp` / `clear`
/ `setFeeAsset` resets `fees`, `requiredAuths`, `signatures`, and `built` to
null. The desk disables Sign / Export / Wrap until `feeAll` + `resolveAuths`
re-run. This is the same honesty contract as the transfer gating reasons
(`transfer-ui.js` gate box) — a stale fee or auth set is never displayed as
current.

### 3.3 Export envelope (multi-device JSON, v1)

```js
{
  app: "bts-vanilla-txbuilder",
  v: 1,
  chain_id: "4018d784…",      // Chain.status().chainId at build; import refuses mismatch
  feeAssetId: "1.3.0",
  ops: [[0, {…}], [6, {…}]],   // fee-FILLED pairs (feeAll ran before export)
  tx: {                        // full unsigned tx from Tx.buildTx (ref-block FIXED at export)
    ref_block_num: 1234, ref_block_prefix: 5678,
    expiration: "2026-09-30T12:01:00",
    operations: [[0, {…}], [6, {…}]],
    extensions: []
  },
  signatures: [{ pub: "BTS…", hex: "1b…" }],  // appended so far (possibly empty)
  meta: {
    sources: ["transfer:alice→bob 1.5 BTS", "vote:alice slate 3+2"],
    described: [[ "From", "alice (1.2.17)" ], …],  // describe() rows at export (audit trail)
    requiredAuths: [ … ],      // §5 answer at export (so the importer sees who is missing)
    exportedAt: "2026-09-30T12:00:30",
    expiresNote: "Signatures bind ref-block+expiration: re-basing invalidates them."
  }
}
```

What is NEVER in the envelope: WIFs, private hex, brainkeys, passwords. The
envelope is safe to copy across devices precisely because it carries no
secrets — only ops, the fixed digest inputs, and public signatures. Validation
on import is strict: `app` + `v===1`, `chain_id` equals the local chain id,
every entry is `[int, object]` with a fee object present, `tx.operations`
deep-equals `ops` (no drift between the two copies), signatures are 65-byte
hex with distinct pubs. Anything else fails loudly with a named error
(`tb-bad-envelope`, `tb-chain-mismatch`, `tb-ops-drift`) — never a silent
repair.

Ref-block consequence (recorded, not hidden): signatures bind the exact
`ref_block_num` / `ref_block_prefix` / `expiration` bytes. If the importer's
tx expired, the importer offers **Re-base** (rebuild via `Tx.buildTx` with a
fresh head, fees re-quoted) with the explicit warning that existing signatures
are dropped and all parties must re-sign. Re-basing never silently keeps old
sigs.

---

## 4. Composer API (`js/txbuilder.js`, no DOM)

```js
TxBuilder.addOp(opId, opData, source) -> key
  // Validates [int, object] (same gate as Tx.buildTx), requires opData.fee
  // object (fills zero placeholder when absent — never leaves fee undefined,
  // because get_required_fees requires the field present), deep-clones,
  // assigns key, invalidates derived state, notifies subscribers.
  // Throws tb-bad-op on bad shape; throws tb-unknown-op when Tx._ser has no
  // serializer for opId (the desk can never queue bytes it cannot build).

TxBuilder.removeOp(key) -> boolean
TxBuilder.clear() -> void
TxBuilder.setFeeAsset(assetId) -> void   // strict N.N.N; invalidates fees
TxBuilder.list() -> [entry, ...]         // shallow copy in composer order
TxBuilder.count() -> number
TxBuilder.subscribe(fn) -> off()         // Store.subscribe-shaped; header badge uses it

TxBuilder.describe(opId, opData) -> Promise<[{label, value, title?}]>
  // Human rows per op, §6. Async (needs Account.resolve + asset precision
  // reads). Amounts via Format.formatAmount(raw, precision); percents via the
  // existing converters (Pool.pctUnitsToHuman for pool fees; GRAPHENE
  // 10000-base for vote/market percents); prices via Format.formatPrice with
  // BOTH precisions (principle #6). Account ids resolve to "name (1.2.N)".
  // Unknown opId -> [{label:"Operation", value:"op <id> (not yet described)"},
  // {label:"Data", value: <pretty JSON>}] — honest fallback, never a crash.

TxBuilder.feeAll() -> Promise<{perOp, totalRaw, totalDisplay}>
  // Delegates to Tx.feeMulti(opsPairs, feeAssetId): ONE get_required_fees call
  // for the whole bundle (tx-send.js:73-117), fills each opData.fee in place,
  // resolves fee-asset precision with one get_assets read for totalDisplay.
  // Op-22 entries (proposal-wrap preview, §7) unwrap the nested shape per the
  // Tx.fee rule. Mixed-asset answers sum raw regardless; the display asset is
  // fees[0].asset_id (today always one asset).

TxBuilder.resolveAuths() -> Promise<[authRow, ...]>
  // §5 algorithm. Reads involved accounts' owner/active authorities (one
  // batched get_objects), matches Wallet.keys pubs, returns rows with
  // missing flags. Never throws "no keys" — an empty wallet yields all-missing
  // rows (the honest state), not an error.

TxBuilder.buildUnsigned() -> Promise<tx>
  // Requires non-empty ops + fees filled (calls feeAll first when stale).
  // Delegates envelope to Tx.buildTx(opsPairs) — no duplicated ref-block
  // logic. Captures chainId, stores tx in state.built.

TxBuilder.signLocal() -> Promise<{signed: [pub, ...], stillMissing: [accountId, ...]}>
  // §5.3 + §6 ceremony. Reads Wallet.keys in memory (no new unlock code —
  // the desk gates on Wallet.isUnlocked like transfer-confirm.js:280 and
  // vote-ui.js:687), signs the digest ONCE per distinct matching WIF via
  // Crypto.signHash, APPENDS {pub, hex} without duplicating a pub that
  // already signed. Never overwrites another signer's entry.

TxBuilder.wrapProposal({feePayerId, expirationIso, reviewPeriodSecOrNull}) -> [22, opData]
  // §7. Delegates to Proposal.buildCreate with innerOps = queued pairs.

TxBuilder.exportJSON() -> string   // §3.3 (requires built + fees; throws tb-nothing-to-export when empty)
TxBuilder.importJSON(text) -> {ops, signatures, requiredAuths}  // strict validation; replaces composer content
TxBuilder.broadcastSigned(tx, provers) -> Promise<result>  // §6.4 generic prove
```

All async failures use named errors (`tb-empty`, `tb-bad-op`,
`tb-unknown-op`, `tb-not-connected`, `tb-wallet-locked`, `tb-bad-envelope`,
`tb-chain-mismatch`, `tb-ops-drift`, `tb-expired`) so the desk maps each to a
human sentence — the same named-error discipline as `pool.js` and
`proposal.js`.

---

## 5. Authority resolution algorithm (binding: `get_objects`, client-side)

### 5.1 Which chain reads, exactly

1. **Involved accounts:** for each queued op, extract candidate `1.2.N` ids by
   (a) reading the op's known auth/payer fields from a small per-op table
   (below), plus (b) a fallback scan of all string values in `opData`
   matching `/^1\.2\.\d+$/`. Union, dedupe. For op-22 entries, recurse into
   `proposed_ops` (both `{op:[t,d]}` and bare `[t,d]` shapes, same
   normalisation as `proposal.js:95-102`).
2. **One batched read:** `dbId = await Chain.db()`,
   `rows = await Chain.call(dbId, "get_objects", [accountIds])`. A null slot
   yields an honest `unknown-account(<id>)` auth row (never a throw that kills
   the whole resolution — one bad op must not hide the rest).
3. **Per account object**, read `owner` and `active` authorities:
   `{weight_threshold, account_auths: [[id, weight]…], key_auths: [[pub, weight]…]}`
   (`address_auths` ignored — #4 keeps it for backward compat only, always
   empty in practice; the row notes `address_auths: ignored (legacy)` when
   non-empty so the omission is visible, not silent).
4. **Available pubs:** the in-memory wallet pubs at resolve time —
   `Wallet.keys.owner.pub`, `Wallet.keys.active.pub` (memo pub EXCLUDED: the
   memo key never authorises a tx), plus any pubs already in
   `state.signatures` (a second device's appended sig counts as available for
   threshold math on re-import). No private material is read.
5. **Threshold math per level:** sum weights of `key_auths` entries whose pub
   is in available pubs, plus `account_auths` entries whose referenced account
   is itself fully available (one level of recursion; deeper nesting reports
   `nested-auth (needs <id>)` honestly rather than recursing unboundedly).
   Level satisfied when sum ≥ `weight_threshold`. Account row satisfied when
   EITHER level the op requires is satisfied (see §5.2 for which level each op
   needs; default: active).

Best-effort cross-check (never required, never blocking): when the node
supports it, call `get_potential_signatures([builtTx])` and
`get_required_signatures([builtTx, availablePubs])` (`database_api.hpp:1262-1273`)
and compare against the client-side answer. Agreement is logged silently;
disagreement surfaces as `auth-cross-check differs from node — node wins at
broadcast; re-resolve before signing` (the node is ground truth at broadcast,
the client answer is what makes the ceremony work offline and on sparse nodes).
`verify_authority([signedTx])` (`:1288`) is offered as a pre-broadcast dry run
button, not an automatic gate (some public nodes disable it; failure to call
it never blocks a user who understands the warning).

### 5.2 Per-op auth-level table (initial coverage = pilot + serialized ops)

| Op(s) | Required level | Account field(s) read |
|---|---|---|
| 0 transfer | active of `from` | `from` |
| 1 limit_order_create | active of `seller` | `seller` |
| 2 limit_order_cancel | active of `fee_paying_account` | `fee_paying_account` |
| 3 call_order_update | active of `funding_account` | `funding_account` |
| 6 account_update | active of `account` (owner fields when `owner` present → owner) | `account` |
| 7 whitelist, 8 upgrade | active | `authorizing_account` / `account_to_upgrade` |
| 10–17 asset ops | active of `issuer` | `issuer` |
| 19 publish_feed | active of `publisher` | `publisher` |
| 20/21 witness, 29/30 committee | active of member account | `witness_account` / `committee_member_account` / `witness`→resolve |
| 22 proposal_create | active of `fee_paying_account` (proposer) | `fee_paying_account` + recurse inners (informational) |
| 23/24 proposal update/delete | active of `fee_paying_account` (+ `using_owner_authority` → owner for op-24) | `fee_paying_account` |
| 25–28 withdraw permission | active of `withdraw_from_account` | `withdraw_from_account` |
| 32/33 vesting, 37 balance_claim | active of owner account | `creator`/`owner`/`deposit_to_account` per op |
| 34 worker_create | active of `owner` | `owner` |
| 43/47/48 asset fee/pool/issuer | active of `issuer`, EXCEPT op-48 `asset_update_issuer` = **owner** (chain-enforced; `tx.js` header documents the owner-WIF rule — the resolver marks op-48 owner-only and the desk warns when only the active key is unlocked) | `issuer` |
| 49/50/52 HTLC | active of `from` / `redeemer` / `update_issuer` | per op |
| 54/55/56 custom authority | active of `account` | `account` |
| 57/58 ticket | active of `account` | `account` |
| 59–63, 75 pool | active of `account` | `account` |
| 64–68 samet, 69–73/76 credit | active of `owner_account`/`borrower`/`account` per op | per op |
| default (any other serializable op) | active of every `1.2.N` found by the fallback scan | scan |

Multisig note: an account whose `weight_threshold` needs 2-of-3 renders ONE row
with `threshold: 2`, `availablePubs` listing which of its keys are local, and
`missing` naming the shortfall (`1 more signature for alice (active 2-of-3)`).
The row never claims *which* remote key must sign — only how many more are
needed and which pubs would satisfy it (from the authority's `key_auths` list).

### 5.3 Which WIF signs what

- Active-satisfied → `Wallet.keys.active.wif`. Owner-satisfied (op-48, op-24
  with `using_owner_authority`, owner-threshold multisigs) → `Wallet.keys.owner.wif`.
- Least privilege: when both levels are satisfied locally, sign with active
  unless the op table says owner. The desk shows `signed as <pub> (<level>)`
  per row.
- Memo WIF never signs. A locked wallet signs nothing (`tb-wallet-locked`
  names the gate; the desk offers unlock inline — password asked ONLY at sign,
  principle #9).
- Digest is computed ONCE per `state.built` (`SHA-256(chainId + packed)`,
  same layout as `tx-send.js:189-209`); `signLocal` calls `Crypto.signHash`
  once per distinct WIF and appends. Re-signing with the same pub replaces its
  `{pub, hex}` entry (idempotent retry), never duplicates it.

---

## 6. Signing ceremony

### 6.1 Local single-device (the default path)

1. Desk shows queued ops as human rows (§6 human-row rule below) + fee line
   (live, from `feeAll`) + auth rows from `resolveAuths`:
   `✓ alice (1.2.17) — active key available` /
   `… bob (1.2.20) — unsigned for bob (no local key)`.
2. User presses **Sign with local keys**. If locked → inline unlock (same gate
   as `transfer-confirm.js:280` / `vote-ui.js:687`: `Wallet.keys` read in
   memory; nothing else changes about unlock).
3. `signLocal` signs every satisfiable row, leaves the rest as
   `unsigned for X`. The result screen states counts honestly:
   `Signed 1 of 2 required authorities. Still unsigned for: bob (1.2.20).`
4. Choices from here: **Broadcast anyway** (partial — §6.4 warning),
   **Export for second signer** (§6.3), **Proposal-wrap instead** (§7), or Back.

No step ever signs for an account whose keys are absent; no step hides an
unsigned row. The ceremony's honesty invariant: *the set of pubs that signed
is always displayed next to the set the resolver required.*

### 6.2 Human rows (`describe`, the 78-op table convention)

Row order and labels follow #3 `renderOperationDetails` per op type (From/To/
Amount/Memo for op-0; Seller/Sell/Buy/Expiration for op-1; …), with these
vanilla corrections (principle #6 + public-first):

- Every `{amount, asset_id}` renders `Format.formatAmount(raw, precision)`
  with the raw integer in `title` (balances convention), precision resolved by
  one `get_assets` read per distinct asset id (batched). #3's raw
  `"amount (asset id)"` fallback is kept ONLY when the asset read fails, and
  labelled as unresolved (`1.3.0 unresolved — showing raw 150000`), never as a
  clean number.
- Every account id renders `name (1.2.N)` via `Account.resolve`; unresolvable
  renders the bare id with `(unknown account)` — never blank.
- Percents render human (`20%`, not `2000`): pool fees via
  `Pool.pctUnitsToHuman`, market/asset percents via the 10000-base rule
  (`config.hpp:102-103`). Prices use `Format.formatPrice` with both
  precisions. Expirations render local + ISO.
- The fee row per op shows the `feeAll` answer in the fee asset at the right
  precision; the total row shows `totalDisplay (totalRaw raw)`.
- A `<details>` raw-JSON block per op (same idiom as
  `transfer-confirm.js:253-261`) carries the exact bytes-to-be-signed for
  audit. No secrets ever render (ops carry no WIFs by construction).

Coverage rule: pilot ops (0, 6, 61) ship fully described; every other
serializable op ships at least a correct title + fee + involved-account rows
with remaining fields as labelled raw values (never blank, never mislabelled).
Full per-field rows for the long tail accrue per slice — `describe` has an
explicit per-op coverage table in code comments so gaps are visible.

### 6.3 Export / import (air-gapped second signer)

- **Export:** requires `built` + `fees` current. Produces `tb-<n>ops-<date>.json`
  download AND a copyable textarea (phone-friendly: paste works where file
  transfer doesn't). The desk confirms `chain_id`, op count, total fee, and the
  required-auths summary before offering the payload.
- **Import (second device):** paste / file-pick → strict validation (§3.3) →
  composer replaced, `describe` re-rendered from local reads, auth rows
  re-resolved against *this* device's keys → second signer presses Sign (their
  pubs append) → they export again (now with N+1 signatures) → first device
  re-imports and broadcasts. `chain_id` mismatch refuses with
  `tb-chain-mismatch (export is for <mainnet|testnet>, you are on …)`.
- **Signatures bind the envelope:** importing a JSON whose `tx.expiration`
  passed offers Re-base (rebuild + re-quote, old sigs dropped with explicit
  warning) or read-only inspect. There is no "extend expiry keeping sigs" —
  that would be forging the digest inputs.

### 6.4 Broadcast (generic prove, partial allowed)

Transport reuses the vote pattern (`vote-ui.js:757-790`): `broadcast_transaction_with_callback`
first, `broadcast_transaction` fallback once, `sendRejected` flagging. What
changes is the proof:

- Per-op provers where one exists: op-0 → sender history poll
  (`tx-send.js:216-238` content match); op-6 vote shape → slate re-read
  (`vote-ui.js:779-786`); pool ops → `Pool.get` re-read; op-22 → `proposalsFor`
  + `get_objects` (the `transfer-ui.js` propose path). The desk runs the
  provers for the ops in the bundle and reports per-op `observed / not observed`.
- Ops with no prover (today: most of the long tail) report
  `accepted by node, inclusion not proven for op <id> — check history before
  retrying (do NOT blindly rebroadcast)`, same wording discipline as
  `tx-send.js:280-282`. An unproven broadcast is never displayed as confirmed.
- **Partially-signed broadcast** is a deliberate, separately-confirmed action:
  the button reads `Broadcast partially-signed (N of M signed)`, requires a
  checkbox `I understand unsigned authorities must sign later`, and the result
  screen repeats the still-missing set. Rationale: the chain accepts
  partially-signed multisig txs (signatures are appended in later txs / via
  proposal approvals) — refusing would make multisig ceremonies impossible.
  The danger (an authority never completing) is handled by honesty, not by a ban.

---

## 7. Proposal-wrap integration (op-22 of the whole bundle)

From the same composer, the desk offers **Wrap as proposal** as an alternative
send path (radio: `Send directly` / `Wrap as proposal (op 22)`):

- Inputs: proposer (`fee_paying_account`, defaults to wallet account when
  unlocked else `1.2.0` with the viewing-as notice — same convention as the
  transfer propose flow), expiration ISO (default +24 h), review-period seconds
  (blank = none). Validation mirrors `transfer-ui.js` propose gating.
- Build: `Proposal.buildCreate({feePayerId, expirationIso,
  reviewPeriodSecOrNull, innerOps: queuedPairs})` — the existing multi-op path,
  no new builder. The WRAPPER fee is quoted live via `Proposal.fee`/`Tx.fee`
  (nested-shape unwrap); inner fees are informational (same rule as
  `tx-send.js:40-59`).
- Confirm rows: proposer + expiration + review + one human block per inner op
  (`Enclosed op: transfer (op 0) — executes only after approvals`, same label
  shape as the transfer propose notice). The desk states the semantic
  difference explicitly: *direct sends execute atomically at broadcast;
  proposal inners execute only after approvals.*
- Broadcast + prove reuse `Proposal.sendAndProve` (`proposalsFor` +
  `get_objects` re-read, proposal id observed). The direct-bundle provers (§6.4)
  do NOT run on the wrap path — the proposal id is the proof.

Why this falls out cleanly: the composer already speaks `[opId, opData]`, which
is exactly what `buildCreate` consumes. No serialiser, fee, or broadcast code
is duplicated — the wrap path is a one-line delegation plus rows.

---

## 8. UI sketch (ONE recommendation: `#/txbuilder` desk)

**Recommendation: a full `#/txbuilder` route desk. No drawer.**

Desk layout (stacked sections, same `wrap wide` shell as voting/transfer):

1. **Queue** — one card per op: title (`#3 OPERATION_NAMES[opId]` + source),
   human `dl` rows from `describe`, raw-JSON `<details>`, Remove button.
   Empty state explains what the desk is + links to the 3 pilot forms
   (never blank — principle #4).
2. **Fees** — `Quote fees` button → per-op fee rows + total line (human +
   raw title) + fee-asset note. Auto-quotes on op add (best-effort; failure
   renders the error inline, queue stays editable).
3. **Authorities** — `Resolve authorities` output: per-row
   `account name (id) — level threshold — ✓ <pub…> / … unsigned for X`.
   Op-48-style owner rows carry their owner-key warning.
4. **Send choice** — radio Direct / Proposal-wrap (proposal inputs appear when
   selected) → Review screen (all rows + total + auths + chain id) → Sign
   (password gate only here) → result (per-authority signed/missing +
   per-op observed/unproven).
5. **Export / Import** — Export download + textarea; Import textarea +
   file-pick + Re-base offer when expired. Both behind explicit buttons, never
   automatic.

Chrome: a header badge `TxBuilder (N)` linking to `#/txbuilder`, subscribed to
`TxBuilder.subscribe` (count only — no op contents in the header). Badge hidden
at N=0 to avoid noise.

Why the desk wins (justification): (a) the router already owns navigation —
a route needs ~3 lines in `router.js` versus a new global drawer state machine
(§4.5 rule 5: boring beats clever); (b) 360 px phones stack sections
vertically with ≥44 px targets and no hover, while a drawer would cover the
form that feeds it; (c) 4K desks get the same content in a 2-column grid
(queue | fees+auths) without a second layout; (d) every existing confirm
(transfer, vote, pool) already proves the `dl` + `details` + Back/Sign idiom at
full-page width — the desk reuses it instead of inventing a compact variant;
(e) deep-linking (`#/txbuilder`) makes the export/import ceremony explainable
in help docs and test scripts; a drawer state cannot be linked to.

 Pilot-form touchpoints (each a secondary button beside the existing primary;
 one-shot path default and unchanged): transfer form `Add transfer to
 TxBuilder`; vote confirm `Add vote to TxBuilder` (adds the `[6, opData]`
 without broadcasting); pool stake confirm `Add deposit to TxBuilder`. After
 adding, the form navigates to `#/txbuilder` and the desk toasts
 `Added <source> (op <id>) — N in queue`.

---

## 9. Migration: 3 pilot forms (additive only)

Each pilot keeps its current Review → Confirm → Sign & Send working exactly as
today. The migration adds one op-emitting outlet per form:

1. **Transfer** (`transfer-ui.js` + `transfer-confirm.js:155-218`): after
   `review()` builds the unsigned `[0, opData]` (fee filled), the confirm
   gains `Add to TxBuilder`. Emits `TxBuilder.addOp(0, ctx.unsigned.operations[0][1],
   "transfer:<from>→<to> <human> <SYM>")`. Encrypted-memo ops carry their
   already-encrypted memo object (encryption happened with local keys at
   review — the pair is self-contained). Locked-encrypted preview state (memo
   excluded, `transfer-ui.js` G7 rule) is NOT emittable — the button disables
   with the reason shown until unlock.
2. **Vote publish** (`vote-ui.js:573-619` `preparePublish`): after `newOptions`
   + fee are built, the confirm gains `Add to TxBuilder`. Emits
   `TxBuilder.addOp(6, {fee, account, new_options}, "vote:<name> slate w+c+w")`.
   The proxy-vs-self retry rule (`publishWithRetry`) does NOT transfer — the
   composer stores the sentinel (`1.2.5`) shape; if the node rejects at
   broadcast, the desk offers the same one-time self-retry explicitly.
3. **Pool stake (deposit)** (`pool.js:286-297` `buildDeposit` + pool stake
   confirm): after the confirm builds `[61, opData]`, gains
   `Add to TxBuilder`. Emits `TxBuilder.addOp(61, opData, "pool:deposit <pool> …")`.
   Leg-orientation (`a<b` order-trap) and `shareOut` estimates happen in the
   form before emitting, unchanged.

Shared outlet contract (so the 4th form costs nothing new): a form emits only
after its own validation + builder succeed, with a zero-or-filled fee (the
composer re-quotes via `feeAll` anyway), and passes a human `source` string.
Forms never touch `requiredAuths` / `signatures` / broadcast. Removal or failure
of the composer never breaks the one-shot path (each `addOp` call is guarded by
`typeof TxBuilder !== "undefined"` with silent absence — the button hides when
the script failed to load, same pattern as `router.js` guarded view globals).

---

## 10. Test plan

All tests run against testnet (faucet accounts; no mainnet keys). The desk is
exercised at 360 px phone width and ≥1440 px desktop width in all three themes
for every case below (principles #4/#5/#7 are release gates, not follow-ups).

- **T1 — two-account bundle (the core vector).** Queue A: transfer 1.5 TEST
  from `alice-test` (op-0, precision 5 → raw `150000`); Queue B: vote-publish
  for `alice-test` changing one witness (op-6). `feeAll` asserts ONE
  `get_required_fees` call with both pairs (spy on `Chain.call`), per-op fees
  filled in place, `totalRaw` = BigInt sum, `totalDisplay` formatted at fee
  precision. `resolveAuths` returns 1 row (same payer) satisfied locally.
  Sign → both pubs listed → broadcast → op-0 history poll observes the
  transfer AND slate re-read observes the vote. Human rows assert
  `1.50000 TEST` (never `150000`) and the fee total likewise.
- **T2 — missing-key honesty.** Queue transfer from `bob-test` while unlocked
  as Alice (or locked). `resolveAuths` returns `unsigned for bob-test (1.2.N)
  — no local key`. Sign yields `signed 0 of 1`, result names Bob. No signature
  bytes exist for Bob (assert `state.signatures` empty / not containing Bob's
  pub). Broadcast-anyway is offered behind the checkbox; if taken on testnet,
  the node rejects (single-sig shortfall) and the desk shows the node text
  inline — the honest outcome, never a fabricated success.
- **T3 — export / import round-trip.** Build T1's bundle, export JSON, assert:
  no `wif`/`priv`/`brainkey`/`password` substring anywhere in the payload;
  `chain_id` equals `Chain.status().chainId`; `tx.operations` deep-equals
  `ops`. Clear the composer, import the JSON, assert byte-identical
  `Tx._ser.serializeTransaction(tx)` hex before and after. Sign on "device B"
  (second testnet key), export again, re-import on A, assert two distinct
  `{pub, hex}` entries and `verify_authority` dry-run agreement where the node
  supports it. Expired-tx import offers Re-base and drops old sigs with the
  warning visible.
- **T4 — proposal-wrap.** Wrap T1's bundle via `wrapProposal` (proposer Alice,
  +24 h expiry, no review). Assert the outer pair is `[22, …]` with
  `proposed_ops.length === 2` in `{op:[t,d]}` canonical form, wrapper fee
  quoted live, inner fees informational. Broadcast via `Proposal.sendAndProve`;
  prove by `proposalsFor(alice)` + `get_objects` observing the proposal id.
  Confirm screen asserts the `executes only after approvals` notice is present.
- **T5 — non-BTS precision + percent fields.** Queue a pool deposit on a
  precision-3 test asset and an op-6 with committee votes; assert `describe`
  shows the deposit at 3 decimals and fee-split percents as `X%` (u16/100),
  with test vectors recorded in the implementation parity note (raw → human).
- **T6 — regression: one-shot paths untouched.** With the composer loaded AND
  with `js/txbuilder.js` blocked (script 404), transfer / vote / pool-stake
  one-shot Review → Sign & Send still succeed on testnet. The Add buttons hide
  when the global is absent; nothing throws.

---

## 11. Anti-rot gate (a)(b)(c)

- **(a) Ten years untouched, still runs?** Yes. `js/txbuilder.js` is plain JS
  with no imports: it consumes the existing globals (`Tx`, `Proposal`,
  `Chain`, `Wallet`, `Crypto`, `Format`, `Account`) through guarded reads and
  introduces no package, no CDN asset, no build output, no new WS method
  requirement (authority resolution is `get_objects` + `get_account_by_name`
  + `get_assets` + `get_required_fees` — all baseline database-API methods the
  app already calls). The export JSON is versioned (`v:1`) and validated
  strictly, so a future `v:2` cannot silently misread today's payloads.
- **(b) What did this newly depend on?** Nothing external. New code files
  (`js/txbuilder.js`, `js/txbuilder-ui.js`, two `<script>` tags, one router
  entry, three additive form buttons) depend only on in-repo globals. The only
  chain-surface addition is *optional* (`get_potential_signatures` /
  `get_required_signatures` / `verify_authority` as best-effort cross-checks —
  failure degrades to the client-side answer, never blocks). Nothing needs
  vendoring because nothing new is imported.
- **(c) Smallest deletable subset?** The export/import UI (~half of
  `txbuilder-ui.js`) and the proposal-wrap radio could be deleted leaving a
  working local single-device multi-op signer; the cross-check calls could be
  deleted leaving pure `get_objects` resolution; the header badge could be
  deleted leaving the desk reachable by URL. None was deleted because each
  carries a binding requirement (multi-device ceremony, op-22 bundle path,
  discoverability) — but each is isolated behind its own function boundary so
  removal stays a deletion, never a refactor.

`tooling/check_rot.py` stays green: no `package.json` / `node_modules` /
lockfile, no framework imports, no CDN `<script src>`, everything served by
`python3 -m http.server`.

---

## 12. Risks and open questions

1. **Single-brainkey wallet vs multi-account ambition.** Today `Wallet.keys`
   holds ONE account's triples; a bundle spanning Alice + Bob can resolve Bob
   as missing but cannot unlock Bob's keys without overwriting Alice's stored
   envelope (`wallet.js:252-271` `create` replaces). Phase 1 therefore supports
   *compose-anything + sign-what-is-local + export-the-rest* honestly, but true
   two-local-key signing waits for a multi-keystore slice (out of scope here;
   the composer API is already keystore-agnostic — `availablePubs` is just a
   list). **Owner input wanted:** confirm that phase-1 honesty (missing-key
   rows + export) is acceptable before a multi-keystore redesign.
2. **Generic broadcast proof for the long tail.** Only ops with existing
   provers (0, 6-vote, pool, 22) get observed proofs; other ops report
   accepted-but-unproven. This is honest but less satisfying than a txid.
   **Owner input wanted:** accept the per-op prover list growing slice by
   slice, or prioritise a generic `get_transaction` / history-scan prover now?
3. **Fee-asset choice.** The composer fixes one `feeAssetId` (core default)
   for `feeAll`. Per-op fee assets (pay op-0 fee in BTS, op-61 fee in TEST)
   are chain-legal but explode the total-display semantics. Kept single-asset
   for v1; recorded, not lost.

---

## Self-review (fixed inline before commit)

- **Placeholder scan:** no TBD/TODO markers; every "later" item names its owner
  slice (multi-keystore, per-op prover growth, per-field describe long tail).
  Version strings, error names, and method names are concrete.
- **Internal consistency:** state invalidation (§3.2) matches the API (§4) and
  the ceremony (§6.1) — Sign/Export/Wrap all require fresh fees+auths. The
  export envelope (§3.3) carries exactly what the ceremony (§6.3) and tests
  (T3) consume; signatures-bind-envelope is stated once in §3.3 and referenced
  (not redefined) in §6.3. Proposal-wrap (§7) delegates to the existing
  `buildCreate`/`sendAndProve` rather than re-specifying them. `Tx.sign`'s
  overwrite behaviour is preserved for existing callers; only the composer uses
  append semantics via `signLocal`.
- **Scope check:** single-spec scope — composer + desk + 3 pilot outlets. No
  keystore redesign, no new serializers, no new chain methods required, no
  drawer, no QR, no per-op fee assets. Each deferred item is fenced with a
  reason.
- **Ambiguity check:** "required authorities" is pinned to the per-op table +
  fallback scan (§5.1–5.2); "available keys" is pinned to in-memory wallet pubs
  + imported sig pubs (memo excluded); "signed" means a `{pub, hex}` entry over
  the fixed `state.built` digest; "broadcast success" is split into
  per-op observed vs accepted-but-unproven (§6.4). Chain-id mismatch refuses;
  expiry re-bases with sig-drop warning. Nothing here has two readings left.
