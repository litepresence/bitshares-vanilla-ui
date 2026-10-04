# Slice 04 — Transfer: parity note

Date: 2026-09-26. Plan: `docs/superpowers/plans/2026-09-26-slice-04-transfer.md` (Task 5, this file).
Code Tasks 1–4 landed by prior workers; this note verifies (headless + live WS).
Worker scope: verification only — writes ONLY this file (+ throwaway `/tmp/*.js`, never committed). No commits.

## 1. Reference behavior

Ground-truth chain contract (`bitshares-core`, sparse, read-only):

- `libraries/protocol/include/graphene/protocol/transfer.hpp:45-68` — `transfer_operation` field order
  `(fee)(from)(to)(amount)(memo?)(extensions)`; `@pre from != to` (this rule killed the plan's
  self-transfer step — see §3, TX-SELF).
- `libraries/protocol/transfer.cpp:39-45` — `validate()`: `fee.amount >= 0`, `from != to`,
  `amount.amount > 0`. Node rejects anything else at broadcast time (observed verbatim, §3).
- `libraries/protocol/include/graphene/protocol/memo.hpp:37-61` — `memo_data (from)(to)(nonce)(message)`;
  decryption needs one of the two private keys (sender OR recipient — ECDH is symmetric).
- `libraries/app/include/graphene/app/database_api.hpp:1313` — `get_required_fees`.
- `libraries/app/include/graphene/app/api.hpp:360` — `broadcast_transaction_with_callback`.

Serializer / signing / memo port sources (#3, credited per function in code headers):

- `wallet-extension/src/lib/bitshares-api.js:761-788` — `getRequiredFee` shape `[[[opId, opData]], assetId`;
  `:885-920` — ref-block/expiry (`head & 0xFFFF`, prefix = head-id bytes 4–7 LE, +30s expiry);
  `:1392-1415` — sign layout (`chainId + packed tx`, SHA-256, compact sig hex);
  `:1420-1488,1663-1728,1950-2041,3599-3731` — varint/uint/string/asset/object-id/memo/pubkey/transfer-op/tx serializers;
  `:855-880` + `:208-225` — callback broadcast wire `[callbackId, signedTx]` + notice branch
  (`:846-853` documents some nodes never push the notice — hence vanilla polls history).
- `wallet-extension/src/lib/crypto-utils.js:720-770` — `signHash` (RFC-6979 + canonical + recovery verify);
  `:775-815` — `isCanonicalSignature`; `:822-887` — `recoverPublicKey` (public math only);
  `:1068-1125` — `encryptMemo` (ECDH x-only, `SHA-512(nonce8||x)` → AES-256-CBC key + IV,
  `SHA-256(msg)[:4]` checksum prepend); `:1133-1200` — `decryptMemo` (reimplemented in `/tmp`, NOT shipped).
- `wallet-extension/src/popup/popup.js:5717-5722` — op-0 confirm rows From / To / Amount / Memo(`[encrypted]`).
- #1 plain-memo encoding: `bitshares-ui/app/components/Modal/SendModal.jsx:151-153` (memo as raw UTF-8 bytes);
  vanilla sends `{from, to, nonce:"0", message:utf8hex}` (transfer-ui.js:20).

BJS cross-check: NOT consulted — no ambiguity found (#3 is explicit line-by-line, #4 confirms field order,
testnet acceptance is the gate). Same documented decision as `tx.js:53-54`.

## 2. Vanilla implementation

| File | Lines | Role |
|---|---|---|
| `vanilla/js/tx.js` | 454 total; `_ser` serializers :69-250, `fee` :272-281, `buildTransfer` :289-325, `sign` :330-350, `broadcast` :394-425 (+history-poll :356-379) | op-0-only serializer subset + sign + broadcast; WIF passes through opaquely, never decoded here |
| `vanilla/js/crypto.js` | additions :348-730 (`encryptMemo` :686-730, `signHash` :647-677, `isCanonicalSignature` :584-600, `recoverPublicKey` :606-639, ECPoint/BigInt public-only helpers) | memo ECDH + canonical signing; secret-scalar ops only via vendored noble globals |
| `vanilla/js/chain.js` | `net()` :115-119, export :120 | append-only `network_broadcast` id (mirrors `db()`) |
| `vanilla/js/transfer-ui.js` | 538 total; locked gate :242-245, form :271-362, `review()` :367-430, confirm :436-509, result :513-531 | form → confirm → result; keys as JS values only, never in DOM |
| `vanilla/js/router.js` | :70-71 | `/transfer` + `/transfer/:to` → `TransferUI.renderTransfer` |
| `vanilla/index.html` | :33 (`js/tx.js`), :37 (`js/transfer-ui.js`) | script tags in dependency order |

Serializer inventory — IN `tx.js` (op 0 only): varint-uint32, uint16, uint32, int64(BigInt),
string, optional, bytes-hex, asset, object-id (strict, no silent repair — header :56-58),
public-key, memo, transfer-op, tx envelope. DEFERRED (later slices): every other op id
(`sign`/`serializeTransaction` throw on op ≠ 0, tx.js:246).

## 3. Manual test steps + observed result

Headless + live WS, 2026-09-26, node `wss://testnet.xbts.io/ws` (chain-id `39f5e2ed…` asserted
before every tx; abort rule armed, never triggered). Scripts: `/tmp/tx-crosscheck.js`,
`/tmp/live-transfer.js`, `/tmp/verify-plain.js`, `/tmp/error-paths.js` (throwaways, stdlib only,
WS framing modeled on `tooling/ws-probe.mjs`; fixture read from file, never printed).

Step 1 — gates (observed):

- `python3 tooling/check_rot.py` → `ROT CHECK PASSED` exit 0 ✅
- `grep -rni "mnemonicToSeed\|m/48\|bip32\|bip39" vanilla/` → CLEAN ✅
- `grep -rn "Math.pow(10" vanilla/js/` → CLEAN (no hits, even in `format.js`) ✅
- `node --check` tx/crypto/transfer-ui/chain → all OK ✅

Step 2 — serializer cross-check, no broadcast (`node /tmp/tx-crosscheck.js`, exit 0):

- FIXED fixture (from `1.2.26833`, to `1.2.17`, amount `100000`, fee `20000`, no memo):
  independent Buffer/DataView reimplementation vs `Tx._ser` → `CROSSCHECK-OP BYTE-IDENTICAL (24 bytes)` ✅
- Envelope with fixed ref fields → `CROSSCHECK-ENVELOPE BYTE-IDENTICAL (37 bytes)` ✅
- Throwaway-key sign: `isCanonicalSignature` true + `recoverPublicKey` matches noble pub (header 31) ✅

Step 3 — LIVE (deviation from plan recorded: plan said self-transfer; the chain forbids it):

- TX-SELF (rejected, proves the rule): `lite-test-1 → lite-test-1` broadcast → node error
  `Assert Exception: from != to` (`transfer.cpp` validate, `transfer.cpp:42`) — recorded exactly,
  NO retry of that shape; pre-history check confirmed no trace (top entry stayed block 100910755) ✅
- TX-A-ENC: `lite-test-1 (1.2.26833) → faucet (1.2.17)`, 1 TEST (raw `100000`), encrypted memo
  `"vanilla slice4 2026-09-26"` (sender key → faucet memo key) → INCLUDED block **100911601**
  (`broadcast_transaction_with_callback+history-poll`), fee raw **92147** → display **0.92147 TEST** ✅
- History read-back + `/tmp` decrypt (from #3 `decryptMemo` logic, sender-role with fixture memo key):
  plaintext **DECRYPT-MATCH** (full E2E incl. memo privacy) ✅
- TX-C-PLAIN: same route, plaintext memo `{nonce:"0", message:utf8hex}` → INCLUDED block **100911602**,
  fee raw **91629** → display **0.91629 TEST**; memo-hex read-back **PLAINTEXT-MATCH** ✅
  (First-pass poll attributed TX-C to TX-A's entry — identical from/to/amount; re-verified by unique
  memo-hex match. Known limitation, see §6 note.)
- Balance arithmetic closes: `1000 − 1 − 0.92147 − 1 − 0.91629 = 996.16224 TEST` — node itself
  reported `Insufficient Balance: 996.16224 TEST` in Step 4 ✅

Step 4 — error paths (`node /tmp/error-paths.js`, all PASS):

- E1 unknown recipient: real `Account.resolve("no-such-acct-xyz-9")` → `unknown-account`
  (UI maps to inline "Unknown account.", never blank) ✅
- E2 excess decimals: real `Format.parseAmount("1.123456", 5)` → `too many decimals for precision 5`
  (UI maps to inline amount-field error, form preserved) ✅
- E3 overspend broadcast (999,999,999 TEST >> balance): node rejects
  `insufficient_balance: Insufficient Balance: 996.16224 TEST, unable to transfer …` — history
  re-checked, no entry ✅
- E4 locked wallet → `#/transfer`: CODE-PASS — `renderTransfer` gates on `Wallet.isUnlocked()`
  (transfer-ui.js:242-245) into the unlock prompt with return path; click test PENDING-BROWSER (Step C) ✅

Browser — PENDING (human tester; steps A–E below; record PASS/FAIL per step):

Setup (do once):

1. `cd /workspace && python3 -m http.server 8080 --directory vanilla` (leave running).
2. Open browser to `http://localhost:8080/`. DevTools (F12) → Console, keep visible: any red error = FAIL for that step (quote it).
3. Settings → Testnet + `wss://testnet.xbts.io/ws` (badge `connected · 39f5e2ed · …`); unlock wallet in `#/wallet`.

Step A — form render (`#/transfer`):

1. Navigate to `http://localhost:8080/#/transfer`.
2. PASS if: `From:` shows your account (name + id, read-only); To/Asset(pre-filled TEST)/Amount/Memo inputs;
   Encrypted checkbox ON; Review button; all touch targets ≥44px in ≥1 dim; no console errors.

Step B — review → confirm → (DO NOT SEND, or send 1 TEST max to `faucet` on testnet only):

1. To=`faucet`, Asset=`TEST`, Amount=`1`, Memo=`hello`, Review.
2. PASS if: confirm lists From/To/Amount(`1.00000 TEST`)/Memo(Encrypted)/Fee(human + raw in title)/Network;
   Back returns with inputs preserved; invalid To shows inline "Unknown account." without wiping the form.

Step C — locked gate:

1. Lock wallet (`#/wallet` → Lock), then navigate to `#/transfer`.
2. PASS if: "Wallet is locked. Enter your password…" + password field + Unlock; wrong password → INLINE error;
   correct password → form renders. FAIL on blank or missing return.

Step D — theme trio (on `#/transfer` + confirm screen):

1. Settings → Original Blue → screenshot; Light → screenshot; Dark → screenshot.
2. PASS if: all three readable; slice adds NO hardcoded colors (`#`-hex grep clean). Attach 3 screenshots.

Step E — viewports:

1. Phone ~360px: PASS if nav collapses, form usable single-column, no horizontal scroll, numeric keyboard on Amount.
2. Desktop ≥1440px: PASS if content uses width (no stranded narrow column). Attach 2 screenshots.

Report format: one line `PASS` / `FAIL + what you saw` per A–E (console errors quoted). Only all-PASS closes the browser pass.

## 4. Raw→human test vectors

Live, TEST (`1.3.0`) precision 5, 2026-09-26 (all via shipped `Format`, string math only):

| raw (chain integer) | precision | context | display (human) |
|---|---|---|---|
| `100000` | 5 | TX-A + TX-C amount | `1.00000 TEST` |
| `92147` | 5 | TX-A fee (`get_required_fees`, encrypted memo) | `0.92147 TEST` |
| `91629` | 5 | TX-C fee (`get_required_fees`, plain memo) | `0.91629 TEST` |
| `99616224` | 5 | closing balance (node-quoted `996.16224 TEST`) | `996.16224 TEST` |

Non-BTS precision + percent: covered by slice-03's 22 live vectors (p2/p4/p6/p8); this slice adds
no new asset class — amounts route through the same `Format` (no float anywhere, §1 Step 1 grep).
Fee delta (92147 vs 91629 = 518 units) is the memo-size data fee (`calculate_data_fee`, transfer.cpp:32-35):
72-hex-byte encrypted memo costs more than the 52-hex-byte plain memo — chain behavior, observed ✅

Memo vectors:

| memo | nonce | message (hex len) | read-back |
|---|---|---|---|
| encrypted (`Crypto.encryptMemo`, random 64-bit nonce, 19 digits) | random | 72 (4 checksum + 32 = 2 AES blocks for 26-byte text) | DECRYPT-MATCH |
| plain (`{from,to,nonce:"0",message:utf8hex}`) | `0` | 52 (`"vanilla slice4 2026-09-26"` UTF-8) | PLAINTEXT-MATCH |

## 5. Theme + viewport checks

CODE-PASS: slice uses structural classes + `var(--*)` tokens only; `#`-hex grep over
`transfer-ui.js` + `tx.js` → CLEAN (exit 1, no literals); `index.html` viewport meta present
(per slice-01); amount input carries `inputmode="decimal"` (transfer-ui.js:301); every button/input
`touchable()` ≥44px (transfer-ui.js:57-60); tables→forms single-column by construction.
Screenshots (trio + 360px/1440px): PENDING browser pass Steps D–E.

## 6. Readability (§3.7)

- Module headers present: `tx.js:1-63` (owns/consumes/side effects/provenance per function/BJS note/deviations),
  `transfer-ui.js:1-30` (owns/consumes/DOM-key rule/memo + confirm wording sources),
  `crypto.js:1-32` (+ slice-04 provenance :17-26), `chain.js:1` (+ `net()` :113-114). ✅
- Function descriptions on all non-trivial functions (what/params/returns/failure-modes). ✅
- No dead text: `TODO|FIXME|XXX|HACK` over slice JS → CLEAN. ✅
- One purpose per file: `tx.js` serializes/signs/broadcasts; `transfer-ui.js` owns DOM;
  `chain.js` owns the socket; `crypto.js` owns keys/memo/signing. ✅
- Split candidates (over ~400, flagged for the director — NOT refactored here, verification scope):
  `transfer-ui.js` 538, `tx.js` 454 (op 0 only; will grow per slice — split by op family when it hurts),
  `crypto.js` 750 (multi-slice accumulator). Single-purpose each; no action this slice.
- `node --check` clean on all four. ✅
- KNOWN LIMITATION (evidence, not a fix — out of verification scope): `Tx.broadcast`'s history-poll
  matches on (from,to,amount), so two identical back-to-back transfers attribute the second proof to the
  first entry (observed TX-C → TX-A entry). Fix direction for a future task: match on memo bytes or
  require `block_num` strictly greater than the sender's previous identical transfer. Recorded, not hidden.

## 7. Anti-rot gate (§4.5)

- (a) Ten years, zero maintenance: static HTML/CSS/JS + platform WebSocket + WebCrypto + `localStorage`;
  serializer is hand-ported bytes (no lib to expire); node list is data in `store.js`. YES.
- (b) New dependencies: NONE. `check_rot.py` PASSED exit 0; CDN grep CLEAN; framework-import grep CLEAN;
  no `package.json`/`node_modules`; `/tmp/*.js` are node-stdlib throwaways, never shipped, never committed;
  vendored noble was already in-repo (slice-02) — this slice only exposes two more of its exports.
- (c) Smallest deletable subset: `/tmp/tx-crosscheck.js` + `/tmp/live-transfer.js` +
  `/tmp/verify-plain.js` + `/tmp/error-paths.js` (verification convenience; results above already record
  the same ground). Already outside the repo by design — nothing to delete from `vanilla/`.

## Audit check results (auditing-vanilla-slices, all eight)

1. Rot gate — PASS (`check_rot.py` exit 0, CDN/framework/`package.json` greps clean).
2. Retro look — PENDING-BROWSER (side-by-side vs #1 send flow in Steps A–B; deviations only if
   broken-original or #4-required with before/after note).
3. Feature coverage — CODE-PASS (op 0 transfer = #1 Transfer route + #2 per-op page + #3 78-op table row;
   serializer inventory in §2 shows op-0-only, later ops deferred per SLICES.md), live-confirm PENDING (Step B).
4. Modern glow — CODE-PASS (no full-page reloads, connect-wait + return path, inline field errors with
   preserved input, confirm wording per #3 table, never-blank result/error panels), live-confirm PENDING.
5. Themes — CODE-PASS (tokens only, hex grep clean), screenshots PENDING (Step D).
6. Human terms — PASS (4/4 live vectors green; `Math.pow(10` grep CLEAN; raw integers only in `title`
   attrs, never as display text; fee always from `get_required_fees`, never estimated).
7. Viewports — PENDING-BROWSER (360px + 1440px per Step E; viewport meta + `inputmode` + touchables in code).
8. Readability — PASS with notes (§6 above: split candidates flagged, limitation recorded).

Slice is NOT done until browser Steps A–E are all-PASS. Headless + live-broadcast (2 inclusions +
decrypt round-trip) + error-path + code-audit portions are GREEN.
