# Slice 02 (Wallet Lifecycle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real wallet lifecycle with real keys — create (brainkey), unlock/lock, encrypted keystore, backup, brainkey import verified against the chain — using classic BitShares derivation and vendored audited ECC.

**Architecture:** `crypto.js` ( OUR async WebCrypto code + vendored noble for secret-scalar ops only) feeds `wallet.js` (PBKDF2-600k + AES-GCM keystore, memory-only unlock, auto-lock), surfaced by `wallet-ui.js` screens on the existing router. No signing yet (slice 4); no amounts displayed (no `format.js` yet).

**Tech Stack:** Vanilla JS + WebCrypto (`subtle.digest` SHA-256/512, PBKDF2, AES-GCM), `crypto.getRandomValues`, localStorage. Node 20 stdlib for checks/probes. Python 3 for dict extraction + rot gate.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable.
- Classic derivation ONLY (AGENTS.md §5 + slice-2 design): SLIP-48 must not enter the codebase — grep must not find `mnemonicToSeed`, `m/48'`, or `bip32` anywhere in `vanilla/`.
- All `crypto.js` functions are async (WebCrypto). Private key bytes touch noble only, never hand-rolled math.
- Fresh-wallet convention (vanilla convention, NOT chain consensus — record in parity note): owner←brainkey-seq0, active←seq1, memo←seq2. Import look-ahead sequences 0..9 rediscovers regardless.
- Key prefixes: mainnet `BTS`, testnet `TEST` (`astro-ui/src/bts/ws/ChainConfig.ts:10,16`).
- Chain IDs / node lists: from slice 1 (`store.js`). Faucet: testnet `https://faucet.testnet.bitshares.eu`, path `/api/v1/accounts`, body `{account:{name,owner_key,active_key,memo_key,refcode,referrer}}`, error in `res.error` (`bitshares-ui/app/actions/WalletActions.js:116-145`).
- Keystore: PBKDF2-HMAC-SHA-256, 600,000 iterations, random 16-byte salt, AES-256-GCM with random 12-byte IV per encrypt; versioned envelope; wrong password and corrupt store MUST error loudly, never return garbage.
- Test keys only on testnet. Viewport range 360px→4K; targets ≥44px; no hover-only UI.
- Each `js/*.js` one global + trailing `module.exports` guard (slice-1 rule).

---

## File Structure

```
vanilla/
├── js/
│   ├── vendor/
│   │   ├── noble-secp256k1.js  ← TASK 1: byte-copy of wallet-extension/src/lib/noble-secp256k1.js
│   │   └── PROVENANCE.md       ← TASK 1: source + version + sha256 + why vendored
│   ├── data/
│   │   └── brainkey-dict.js    ← TASK 2: `var BRAINKEY_DICT = "a,aa,...";` 49,744 words
│   ├── crypto.js               ← TASK 3: async crypto API (below)
│   ├── wallet.js               ← TASK 4: keystore (below)
│   ├── wallet-ui.js            ← TASK 6: screens
│   ├── chain.js                ← TASK 5: +Chain.db() (append-only edit)
│   └── router.js               ← TASK 6: wire /wallet, /create-wallet-brainkey, /existing-account
└── notes/
    └── slice-02-wallet.md      ← TASK 7: parity note
tooling/
└── extract_brainkey_dict.py    ← TASK 2: csv→js extractor (rerunnable, documented)
```

---

### Task 1: Vendor noble-secp256k1.js

**Files:**
- Create: `vanilla/js/vendor/noble-secp256k1.js` (byte copy)
- Create: `vanilla/js/vendor/PROVENANCE.md`

**Interfaces:** none (byte copy). Consumers (`crypto.js`) use `nobleGetPublicKey(privBytes32) -> 33-byte compressed pubkey` — verify this export exists in the file before copying (grep `getPublicKey`).

- [ ] **Step 1: Copy + verify**

Run:
```
mkdir -p vanilla/js/vendor && cp /workspace/wallet-extension/src/lib/noble-secp256k1.js vanilla/js/vendor/noble-secp256k1.js
sha256sum /workspace/wallet-extension/src/lib/noble-secp256k1.js vanilla/js/vendor/noble-secp256k1.js
grep -c "getPublicKey" vanilla/js/vendor/noble-secp256k1.js && head -n 8 vanilla/js/vendor/noble-secp256k1.js
```
Expected: two identical sha256 lines; grep count ≥1; header shows `@noble/secp256k1 v2.3.0, MIT, Paul Miller`.

- [ ] **Step 1b: ESM survey + classic wrapper (REQUIRED for Task 3)**

Run: `grep -n "^import\|^export" vanilla/js/vendor/noble-secp256k1.js`
- If the ONLY module syntax is ONE trailing `export {...}` line: create
  `vanilla/js/vendor/noble-classic.js` as a byte-copy with exactly that line
  replaced by `var nobleGetPublicKey = getPublicKey;` (verify the export list
  contains `getPublicKey`; if the name differs, use the actual name and record
  it). Confirm: `node --check vanilla/js/vendor/noble-classic.js`, exit 0
  (classic scripts must parse without modules).
- If there are MORE ESM statements: STOP. Do not transform, do not guess.
  Report the full grep output — Task 3 cannot proceed until resolved.

- [ ] **Step 2: Write `vanilla/js/vendor/PROVENANCE.md`**

```md
# Vendored crypto provenance
- noble-secp256k1.js: byte-copy of wallet-extension/src/lib/noble-secp256k1.js
  (itself vendored from @noble/secp256k1 v2.3.0, MIT, Paul Miller).
  Source sha256: <paste from Step 1>. Do NOT edit by hand.
  Used for: private→public derivation (all secret-scalar ops).
- Rule: SLIP-48/BIP-32/BIP-39 derivation must never enter vanilla/ (incompatible
  with legacy brainkeys — see slice-2 design). The vendored file contains no
  HD-wallet code paths used by us; we call getPublicKey only.
```

---

### Task 2: Brainkey dictionary extractor + data file

**Files:**
- Create: `tooling/extract_brainkey_dict.py`
- Create: `vanilla/js/data/brainkey-dict.js`

**Interfaces:**
- Consumes: `bitshares-ui/app/lib/common/dictionary_en.json` (`{"en": "comma,words,..."}`).
- Produces: global `BRAINKEY_DICT` (one comma-joined string); `tooling/extract_brainkey_dict.py` regenerates it (stdlib only, prints word count).

- [ ] **Step 1: Write `tooling/extract_brainkey_dict.py`**

```python
#!/usr/bin/env python3
"""Regenerate vanilla/js/data/brainkey-dict.js from the reference dictionary.
Stdlib only. Run from /workspace."""
import json

with open("bitshares-ui/app/lib/common/dictionary_en.json") as fh:
    words = json.load(fh)["en"].split(",")
print("words:", len(words))
assert len(words) == 49744, "expected 49744 dictionary words"
with open("vanilla/js/data/brainkey-dict.js", "w") as fh:
    fh.write('/* 49,744-word brainkey dictionary. Generated by\n'
             '   tooling/extract_brainkey_dict.py — do not edit. */\n'
             'var BRAINKEY_DICT = "')
    fh.write(",".join(words))
    fh.write('";\n')
    fh.write('if (typeof module !== "undefined") { module.exports = BRAINKEY_DICT; }\n')
print("wrote vanilla/js/data/brainkey-dict.js")
```

- [ ] **Step 2: Run + verify**

Run: `python3 tooling/extract_brainkey_dict.py`
Expected: `words: 49744` then `wrote ...`.

Run: `node -e "const d=require('/workspace/vanilla/js/data/brainkey-dict.js').split(','); console.log(d.length, d[0], d[d.length-1]);"`
Expected: `49744 a <last-word>` (whatever the last word is — record it), exit 0.

---

### Task 3: `crypto.js` — derivation + formats (async, WebCrypto + noble)

**Files:**
- Create: `vanilla/js/crypto.js`

**Interfaces:**
- Consumes: globals `BRAINKEY_DICT`, `noble` vendored file — LOADING RULE: `index.html` gains two classic script tags BEFORE `crypto.js` (`js/vendor/noble-secp256k1.js` exposes `nobleSecp256k1` global — VERIFY the actual global name by grepping the vendored file for its UMD/global assignment first; if it is ESM-only (`export` with no global), Task 3 must instead inline-import it via a tiny `js/vendor/noble-loader.js` shim — NO, simpler: check the file head now. The file begins with comments then ESM `export` (it was authored as a module). Classic scripts cannot `export`. Therefore: load order uses `<script type="module">`? Modules break `file://` (CORS). RESOLUTION (locked): `crypto.js` stays a classic script; noble access goes through a `NobleBridge`: Task 3 first line checks `typeof nobleGetPublicKey` (in case a future classic build exists) — NO. Stop. Simplest correct classic-compatible path: the vendored file IS ESM; our classic `crypto.js` CANNOT import it. So Task 3 ALSO converts the vendored copy to classic by appending `var nobleGetPublicKey = secp256k1.getPublicKey;`? The file's exports are ESM `export {...}` — appending classic code to an ESM file loaded via classic script tag FAILS on the `export` keyword (SyntaxError).
- LOCKED RESOLUTION: keep the vendored file byte-identical (Task 1, never edited); `crypto.js` loads noble via dynamic `import()` ONLY when served over http(s), with a file:// fallback error message? That breaks plug-and-play. ALTERNATIVE LOCKED RESOLUTION: Task 1 worker ALSO saves a classic wrapper: read the vendored file, strip NOTHING, and our `index.html` loads noble through `js/vendor/noble-classic.js`, which is a byte-copy PLUS the ESM `export {...}` footer line replaced by `var nobleGetPublicKey = getPublicKey;` — i.e., a mechanical, documented one-line transform (the export list is the only module syntax; the body is plain declarations). Task 1 MUST verify: `grep -n "^import\|^export" vanilla/js/vendor/noble-secp256k1.js` — if the ONLY module syntax is the single trailing `export {...}` line, the classic copy replaces exactly that line; if there are more ESM statements, STOP and escalate (do not guess) — record the grep output in the report.

To keep tasks disjoint: Task 1 does the copy + the ESM-syntax survey (report the grep). Task 3 READS Task 1's report... cross-task read is fine (sequential rounds: Task 1 in round 1, Task 3 in round 2 after verifying the classic wrapper exists).

REVISED task split (disjoint, ordered):
- Round A: Task 1 (vendor + ESM survey + classic wrapper if one-line), Task 2 (dict).
- Round B: Task 3 (crypto.js), Task 4 (wallet.js — needs only crypto.js interface, spec'd below), Task 5 (Chain.db).
- Round C: Task 6 (UI + router), Task 7 (verify).

**`crypto.js` API (ALL async, all return Promises; throws Error on bad input, never null):**
- `Crypto.sha256hex(u8|str)`, `Crypto.sha512hex(u8|str)` — UTF-8 encode strings; `crypto.subtle.digest`.
- `Crypto.normalizeBrainkey(s)` (sync ok): non-string→throw; trim; empty→throw; `split(/[\t\n\v\f\r ]+/).join(" ")`. (Matches #2 `key.js:107-120`. NO uppercasing — that was #3's SLIP-48 path.)
- `Crypto.brainPrivateKeyHex(brainkey, seq=0)`: normalize → UTF-8 bytes of `(norm + " " + seq)` → SUBTLE SHA-512 → SUBTLE SHA-256 **of the raw 64 digest bytes** (NOT of any hex string — bytes-in/bytes-out) → hex. (Matches #2 `get_brainPrivateKey`.)
- `Crypto.fromSeedHex(seedStr)`: hex of SHA-256(UTF-8(seedStr)). (Matches #2 `PrivateKey.fromSeed`.)
- `Crypto.passwordKeys(account, password)`: for role of `["active","owner","memo"]`: `fromSeedHex(account + role + password)` → keypair (below). (Seed formula confirmed in #1 `AccountActions`/`generateKeys`, #2 `AccountLogin`, #3 `generateKeysFromPassword`.)
- `Crypto.suggestBrainkey()`: 32 bytes via `crypto.getRandomValues` → 16 words: per pair `num=(b[i]<<8)+b[i+1]`, `idx=Math.floor(49744*num/65536)`, word=`BRAINKEY_DICT.split(",")[idx]` → normalize. (DEVIATION from #2's `Math.round` documented: round can overflow the list; floor is uniform and generation-only — derivation compat unaffected. Record in parity note.)
- `Crypto.keypairFromPrivateHex(privHex)`: bytes → `nobleGetPublicKey(bytes, true)` → `{wif, pub}` where `wif`=base58(`0x80`+key+sha256d[:4]), `pub`=prefix+base58(key33+ripemd160(key33)[:4]), prefix `"BTS"`/`"TEST"` param defaulting from `Store` network (`Store.loadSettings().network`). base58 + ripemd160 ported from #3 `crypto-utils.js` (credit in header comment; ripemd160 has no WebCrypto equivalent).
- Header comment credits: derivation formulas (#2 `key.js`, #1 `WalletDb.js:260`), base58/ripemd160 (#3), deviation note (floor vs round).

- [ ] **Step 1: Write `vanilla/js/crypto.js`** per API above (~200 lines, `"use strict"`, `var Crypto = {...}` global + module guard).
- [ ] **Step 2: Syntax check** — `node --check vanilla/js/crypto.js`, exit 0.

---

### Task 4: `wallet.js` — encrypted keystore

**Files:**
- Create: `vanilla/js/wallet.js`

**Interfaces:**
- Consumes: `Crypto` (Task 3), `Store` (settings only), `Chain` (import verification).
- Produces: global `Wallet`:
  - `Wallet.create(password, brainkey)` → saves envelope `{v:1, salt:b64, iterations:600000, iv:b64, data:b64}` under localStorage `bts-vanilla-wallet-v1`; plaintext `{brainkey, keys:{owner,active,memo:{wif,pub}}, created}`; fresh roles owner←seq0, active←seq1, memo←seq2; brainkey must be ≥50 chars post-normalize (else throw — matches #1 `WalletDb.js:285`).
  - `Wallet.unlock(password)` → decrypts to MEMORY ONLY (`Wallet.keys`, never localStorage); starts 5-minute inactivity auto-lock (any `Wallet.touch()` resets; `visibilitychange` hidden locks immediately).
  - `Wallet.lock()` → zeroes memory (overwrite key strings before null), emits via callback `Wallet.onLock(fn)`.
  - `Wallet.isUnlocked()`, `Wallet.getBrainkey()` (throws if locked — backup screen uses this).
  - `Wallet.importBrainkey(brainkey, password)` → normalize → derive seq0..9 pubkeys → `Chain.db()` + `get_key_references([pubs])` → if NO account found anywhere: throw `new Error("no-chain-keys")` (loud refusal, never silent wrong wallet); else create() with the brainkey.
  - Wrong password / corrupt envelope / short brainkey ALL throw distinct Errors (no silent garbage).

- [ ] **Step 1: Write `vanilla/js/wallet.js`** (~180 lines).
- [ ] **Step 2: Syntax check** — `node --check vanilla/js/wallet.js`, exit 0.

---

### Task 5: `Chain.db()` helper (append-only edit to `chain.js`)

**Files:**
- Modify: `vanilla/js/chain.js` (append `db()` + export entry ONLY; touch nothing else).

- [ ] **Step 1: Append** (before the `return {...}` line):

```js
  var _dbId = null;
  function db() {
    if (_dbId !== null) return Promise.resolve(_dbId);
    return call(1, "database", []).then(function (id) { _dbId = id; return id; });
  }
```

and add `db: db` to the returned object. NOTE: `db()` requires the shared socket open (boot connects it); `call` rejects `not connected` otherwise — callers (import) run post-connect.

- [ ] **Step 2: Syntax check** — `node --check vanilla/js/chain.js`, exit 0.

---

### Task 6: Wallet screens + router wiring

**Files:**
- Create: `vanilla/js/wallet-ui.js`
- Modify: `vanilla/js/router.js` (wire real renderers for `/wallet`, `/create-wallet-brainkey`, `/existing-account` ONLY), `vanilla/index.html` (add the 4 new classic script tags in dependency order: vendor classic, dict, crypto, wallet, wallet-ui — BEFORE store/chain/router per load graph).

**Interfaces:**
- Consumes: `Wallet`, `Crypto`, `Store`, `Router.routes` entries.
- Produces: global `WalletUI` with `renderWallet`, `renderCreate`, `renderImport`; screens: status/manager (locked→password prompt; unlocked→account-key pubkeys shown, Lock button, Backup link), create (generate brainkey → checkbox "I wrote it down" → password+confirm → create → backup view), import (brainkey textarea → password → verify-vs-chain → errors shown inline: `no-chain-keys`, short brainkey, wrong password). Retro layout per #1 `Wallet/` screens; all errors inline (never blank); inputs `autocomplete="new-password"`, `spellcheck=false`, `inputmode` where relevant.

- [ ] **Step 1: Write `vanilla/js/wallet-ui.js`** (~220 lines).
- [ ] **Step 2: Wire router + index.html script tags** (exact paths; order: `js/vendor/noble-secp256k1-classic.js` (or per Task 1 report), `js/data/brainkey-dict.js`, `js/crypto.js`, `js/wallet.js`, `js/wallet-ui.js`, then existing tags).
- [ ] **Step 3: Syntax check** — `node --check` on all three touched JS files, exit 0.

---

### Task 7: Verify, parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-02-wallet.md` (+ throwaway `/tmp/brain-check.mjs`, NOT committed).

- [ ] **Step 1: Rot gate** — `python3 tooling/check_rot.py`, exit 0. Plus: `grep -rni "mnemonicToSeed\|m/48\|bip32\|bip39" vanilla/ || echo CLEAN` (SLIP-48 must be absent), exit 0 path = CLEAN.

- [ ] **Step 2: Independent cross-check** — write `/tmp/brain-check.mjs` reimplementing ONLY normalize + `sha256(sha512(+seq))` + `fromSeed` with `node:crypto` (separate code path, same spec), compare against `crypto.js` outputs for: the classic test brainkey at seq 0,1,2; a password seed; an empty/whitespace-padded brainkey (throw expected). All outputs byte-identical or FAIL stops the slice.

- [ ] **Step 3: Testnet round-trip** — generate brainkey → derive owner/active/memo (seq0/1/2) pubkeys → `curl POST {testnet-faucet}/api/v1/accounts` with `{account:{name:<pick unique test-<date>>, owner_key, active_key, memo_key}}` → `Chain` `get_account <name>` → on-chain keys MUST equal derived pubkeys. Then fresh `importBrainkey` of the same brainkey → must DISCOVER the account via look-ahead (positive import proof). If the testnet faucet is dead: STOP, record curl output, escalate (chain-doctor fallback) — do NOT fake it.
  Faucet probe first: `curl -s -o /dev/null -w "%{http_code}\n" https://faucet.testnet.bitshares.eu/` (record code).

- [ ] **Step 4: Error paths** — wrong password unlock throws; corrupt envelope (flip one localStorage char) throws; 49-char brainkey refused; unknown brainkey import throws `no-chain-keys`. All four observed, recorded.

- [ ] **Step 5: Parity note** (seven fields per building-vanilla-slices + §3.7 item: crypto rationale — classic-for-compat, PBKDF2-600k/GCM-for-storage, noble-for-signing; fresh-wallet seq convention; floor-vs-round deviation; testnet account name + vectors; theme trio + both viewports; §4.5(a–c)).

- [ ] **Step 6: Audit** (REQUIRED SUB-SKILL: `auditing-vanilla-slices`, all eight checks). No slice 3 until green.
