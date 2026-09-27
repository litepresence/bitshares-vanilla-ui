# Slice 04 (Transfer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real signed transfers on testnet — amount entry with precision parsing, fee fetched from the chain, optional encrypted memo, human-readable confirm, broadcast with inclusion proof. First signing slice; `tx.js` serializer debuts with op 0.

**Architecture:** `tx.js` (ported serializer subset + sign + broadcast, credited to #3) uses `crypto.js` (extended: memo ECDH, canonical signing) and `Chain` (new `net()` helper). `transfer-ui.js` renders the form → confirm → result flow. Keys come only from unlocked `Wallet`; WIFs never touch the DOM.

**Tech Stack:** Vanilla JS + WebCrypto + vendored noble (now also `signAsync`, `getSharedSecret` via the classic wrapper). Node 20 stdlib for checks. Python 3 for rot gate.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable.
- No float money math anywhere (audit greps). Amounts are integer strings until render.
- Serializer is HAND-PORTED from #3 (`wallet-extension/src/lib/bitshares-api.js`), credited per function; cross-checked against BJS current + #4 `protocol/transfer.hpp` + testnet acceptance. SLIP-48/BIP references remain forbidden in `vanilla/`.
- Canonical graphene signatures REQUIRED (see sign spec below) — non-canonical broadcasts get rejected by the node.
- Fees ALWAYS from `get_required_fees` at confirm time, displayed human-formatted via `Format`.
- Test keys only on testnet. Fixture `tooling/testnet-lite-test-1.json` (git-ignored) may be USED by verification scripts, NEVER pasted, committed, or rendered.
- Viewports 360px→4K; ≥44px targets; no hover-only UI. One global per file + `module.exports` guard.

---

## File Structure

```
vanilla/
├── js/
│   ├── vendor/noble-classic.js ← TASK 1: extend export line (mechanical, re-verify)
│   ├── tx.js                   ← TASK 2: serializer subset + sign + broadcast
│   ├── crypto.js               ← TASK 3: +encryptMemo, +signHash/canonical/recover (append)
│   ├── chain.js                ← TASK 2: +Chain.net() (append-only edit)
│   ├── transfer-ui.js          ← TASK 4: form → confirm → result
│   └── router.js               ← TASK 4: wire /transfer (+ /transfer/:to prefill)
└── notes/
    └── slice-04-transfer.md    ← TASK 5: parity note
```

---

### Task 1: Extend the noble classic wrapper (mechanical)

**Files:**
- Modify: `vanilla/js/vendor/noble-classic.js` (ONE line), `vanilla/js/vendor/PROVENANCE.md` (one line).

- [ ] **Step 1: Verify exports exist, extend the wrapper line**

Run: `grep -n "signAsync\|getSharedSecret" vanilla/js/vendor/noble-secp256k1.js | head -n 4`
Expected: both present in the export list (v2.3.0 exports `sign, signAsync, getSharedSecret`).

Then replace the wrapper's export line with EXACTLY:
```js
var nobleGetPublicKey = getPublicKey; var nobleSignAsync = signAsync; var nobleGetSharedSecret = getSharedSecret;
```
Confirm: `grep -c "^import\|^export" vanilla/js/vendor/noble-classic.js` → `0`, and `node --check` exit 0.

- [ ] **Step 2: Record in PROVENANCE.md** — append: `noble-classic.js exposes getPublicKey, signAsync, getSharedSecret (one-line mechanical transform, re-verified <date>).`

---

### Task 2: `tx.js` — serializer subset + sign + broadcast (port from #3, credited)

**Files:**
- Create: `vanilla/js/tx.js`
- Modify: `vanilla/js/chain.js` (append `net()` + export entry ONLY).

**Interfaces:**
- Consumes: `Chain` (`db()`, `net()`, `call`), `Crypto` (Task 3 additions), `Format`, noble via `crypto.js` only (NEVER direct — secret-scalar boundary stays in `crypto.js`).
- Produces: global `Tx`:
  - `Tx.fee(opId, opData, feeAssetId="1.3.0")` → `{amount (int), asset_id}` via `get_required_fees [[[opId, opData]], feeAssetId]` with `opData.fee = {amount: 0, asset_id: feeAssetId}` pre-filled (extension bitshares-api.js:801-812).
  - `Tx.buildTransfer({fromId, toId, amountInt, assetId, memoObj|null})` → unsigned tx `{ref_block_num, ref_block_prefix, expiration, operations: [[0, op]], extensions: []}` where ref fields come from fresh `get_dynamic_global_properties` (num = head_block_number & 0xFFFF; prefix = LE-uint32 of head_block_id bytes 4–7; expiration = head time + 30s, `toISOString().slice(0,-5)`) — extension :885-920 verbatim logic.
  - `Tx.sign(txObj, activeWIF)` → message = `chainIdBytes + serialize(tx)` → `sha256` → `Crypto.signHash` → `signatures: [hex]` (extension :1392-1415).
  - `Tx.broadcast(signedTx)` → `network_broadcast` api + `broadcast_transaction_with_callback`, resolving on inclusion (port extension :836+ confirmation approach; if the callback proves unreliable on testnet, fallback `broadcast_transaction` + poll `get_account_history` for the txid — decide with testnet evidence, record the choice).
  - Serialization port list (from extension, credited per function in header comments; verify each against BJS current raw file on demand): varint-uint32, uint16, string (varint-len + utf8), asset `{amount:int64, asset_id}`, object-id, bool, optional, bytes, public-key (33B raw), memo `{from,to,nonce,message}`, transfer-op `{fee,from,to,amount,memo?,extensions}` (op id 0), tx envelope. NO other ops (later slices extend this file).

- [ ] **Step 1: Write `vanilla/js/tx.js`** (~250 lines, header credits per function: `#3 file:line`, BJS cross-check noted, `#4 transfer.hpp` fields).
- [ ] **Step 2: Append `Chain.net()`** (mirrors `db()` with `"network_broadcast"`).
- [ ] **Step 3: Syntax checks** — `node --check` both files, exit 0.

---

### Task 3: `crypto.js` additions — memo ECDH + canonical signing (port from #3, credited)

**Files:**
- Modify: `vanilla/js/crypto.js` (APPEND functions + export entries ONLY).

**Interfaces (append to `Crypto`):**
- `Crypto.encryptMemo(message, fromWIF, toPub)` → `{from, to, nonce, message}` — port extension `crypto-utils.js:1068-1125` verbatim logic: ECDH via `nobleGetSharedSecret` (x-coordinate only), key = `SHA-512(nonce8 || x)` → AES-256-CBC key (first 32B) + IV (next 16B) via WebCrypto, checksum = `SHA-256(message)[:4]` prepended, hex output, random 64-bit nonce. (Uses existing `wifToPrivateKey`-equivalent + `btsToPublicKeyBytes`-equivalent already in `crypto.js` — READ the file first, reuse, do not duplicate.)
- `Crypto.signHash(hashU8, wif)` → 65-byte compact signature — port extension `:720-770` verbatim logic: noble `signAsync` RFC-6979 first try, entropy-hedged retries, graphene-canonical check, recovery-id verification against independently recovered key, ≤128 attempts. Includes porting `isCanonicalSignature` + `recoverPublicKey` + minimal ECPoint public-only helpers it needs (credited; public math only — no secrets leave noble).
- Header credit update: memo + signing provenance (`#3 file:lines`).

- [ ] **Step 1: Append the three functions + helpers** (~150 lines).
- [ ] **Step 2: Syntax check** — `node --check vanilla/js/crypto.js`, exit 0.

---

### Task 4: Transfer screens + wiring

**Files:**
- Create: `vanilla/js/transfer-ui.js`
- Modify: `vanilla/js/router.js` (`/transfer`, `/transfer/:to` entries ONLY), `vanilla/index.html` (ONE script tag: `js/tx.js` in dependency order + `js/transfer-ui.js` — read current order first).

**Interfaces:**
- Consumes: `Wallet` (must be unlocked — else unlock prompt with return path, same pattern as `/account/me`), `Account` (resolve `to` name/id; fetch recipient memo key via `get_account` → `options.memo_key`), `Tx`, `Format`, `Store`.
- Produces: global `TransferUI.renderTransfer(root, prefillTo)`:
  - Form: From (my account, read-only text), To (input, validated via resolve on blur/submit), Asset (symbol input defaulting to network core `TEST`/`BTS`, validated via `lookup_asset_symbols`, precision drives `parseAmount`), Amount (text, `inputmode="decimal"`, parsed via `Format.parseAmount` — errors inline), Memo (optional textarea + `Encrypted` checkbox, default ON when recipient memo key exists), Fee line (fetched live at confirm time, human-formatted + raw in `title`).
  - Confirm screen (per #3's op table wording): From / To / Amount / Memo (showing Encrypted vs Plain) / Fee / network — Back + Sign&Send buttons.
  - Result screen: inclusion (block # + txid, truncated) + link to `#/account/<from>`; failures (insufficient funds, bad recipient, broadcast reject) as inline panels with the node error text, never blank.
  - No WIF/private material in the DOM at any point (keys stay in `Wallet` memory; `Tx.sign` receives WIF as a JS value only).

- [ ] **Step 1: Write `vanilla/js/transfer-ui.js`** (~230 lines).
- [ ] **Step 2: Router + script tags** (exact entries/paths).
- [ ] **Step 3: Syntax checks** — `node --check` all touched JS, exit 0.

---

### Task 5: Verify (REAL broadcast), parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-04-transfer.md` (+ throwaway `/tmp/tx-*.js`, NOT committed).

- [ ] **Step 1: Gates** — `python3 tooling/check_rot.py` exit 0; `grep -rni "mnemonicToSeed\|m/48\|bip32\|bip39" vanilla/` CLEAN; float-money grep CLEAN.
- [ ] **Step 2: Serializer cross-check (no broadcast)** — independent `/tmp` reimplementation of transfer-op bytes for a FIXED fixture (from-id, to-id, amount, no memo) vs `tx.js` output: byte-identical or STOP. Canonical-sig check: sign the fixture digest with a throwaway key, assert `isCanonicalSignature` + recovery to signer pub.
- [ ] **Step 3: LIVE broadcast round-trip** (testnet ONLY, fixture `tooling/testnet-lite-test-1.json` via file, never pasted): self-transfer `1 TEST` (raw `100000`) `lite-test-1 → lite-test-1` WITH encrypted memo `"vanilla slice4 <date>"` → confirm inclusion (block #) → read back via history → DECRYPT memo with fixture memo key → plaintext must equal sent string (full E2E incl. memo privacy). Then a plaintext-memo self-transfer (format check). Record block numbers, txids (truncated in note), fee charged (raw + display).
- [ ] **Step 4: Error paths** — unknown recipient, amount exceeding balance, excess decimals for precision, locked-wallet direct navigation to `#/transfer`, broadcast of an over-spend (node must reject; record message).
- [ ] **Step 5: Parity note** (seven fields + §3.7: reference file:lines — #3 serializer/sign/broadcast/memo lines, BJS cross-checks, #4 `transfer.hpp`; serializer subset inventory (what's in `tx.js` vs deferred ops); test vectors incl. fee + memo vectors; theme trio + both viewports PENDING-BROWSER with tester steps; §4.5(a–c)).
- [ ] **Step 6: Audit** (all eight checks; browser-dependent honestly PENDING-BROWSER). No slice 5 until green-minus-browser.
