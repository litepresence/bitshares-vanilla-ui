# Parity note — wallet keystore v2 (scrypt + HKDF + timing-safe verifier)

> Scope: harden the local master-password KDF from PBKDF2-600k to
> memory-hard scrypt, add per-envelope key separation (HKDF) and a
> timing-safe unlock verifier, and keep every existing v1 wallet working
> (read + transparent in-place upgrade). No UI, no chain calls, no new
> runtime dependency (`vanilla/` still static).
> Written 2026-10-08. Related issue: litepresence/bitshares-vanilla-ui #2
> (multi-key keystore) — this change is the crypto prerequisite, not the
> `.bin` feature.

## 1. Reference behavior

- **DEXBot2** `modules/chain_keys.ts` + `docs/CREDENTIAL_SECURITY.md` (MIT,
  `froooze`): master password → **scrypt** vault key → **HKDF-SHA256** record
  key → **AES-256-GCM**; stored **HMAC-SHA256 vault verifier** compared with
  `crypto.timingSafeEqual` (`chain_keys.ts:319-349,391`). Browser-portable
  scrypt in `modules/crypto/pure_scrypt.ts` driven by
  `modules/crypto/browser_provider.ts`.
- **Reference #3** `wallet-extension/src/lib/crypto-utils.js` /
  `wallet-manager.js`: AES-256-GCM + PBKDF2-600k + per-wallet salt — the
  model the slice-02 keystore was built to match.
- **RFC 7914** (scrypt) and **RFC 8018** (PBKDF2) — the authoritative KAT.

## 2. Vanilla implementation

- `vanilla/js/sdk/vendor/scrypt.js` — vendored scrypt, global `ScryptKdf.derive`.
- `vanilla/js/api/wallet.js`:
  - `_scryptDerive` (:161) — v2 vault key, validates N/r/p bounds.
  - `_hkdfKey` (:178) — HKDF-SHA256 record-key separation.
  - `_hmacSha256` (:193) + `_timingSafeEqual` (:202) — verifier.
  - `_encryptPlain` (:250) — writes the v2 envelope `{v:2,kdf,N,r,p,salt,hkdfSalt,verifier,iv,data}`.
  - `_checkPlain` (:281), `_decryptPlain` (:295) — v2 verifier-first, v1 legacy branch.
  - `unlock` (:~430) — v1→v2 upgrade-on-unlock (best-effort).
  - `_deriveKeyV1` (:142) — untouched PBKDF2 path for v1 envelopes.
- Load/order consumers updated: `vanilla/index.html`, `vanilla/js/globals.d.ts`,
  `extension-wrapper/background/sw.js`, `extension-wrapper/background/firefox.html`.
- Provenance + watch: `vanilla/js/sdk/vendor/PROVENANCE.md`,
  `vanilla/SECURITY.md`.

### Upstream bugs found (fixed in the port, documented in provenance)

1. **ROMix phase 2 started from X_0 instead of X_N** — upstream's
   `pure_scrypt.ts` reset `X` to the input block after phase 1, so it matched
   no RFC 7914 vector. Upstream's own test only checked output length. Fixed
   by tracking `X` through phase 1.
2. **Firefox `deriveBits` 256-byte cap** — upstream derived `p*128*r` bytes in
   one `subtle.deriveBits` call; Firefox throws `OperationError` at r=8
   (1024 bytes). Replaced with block-wise PBKDF2-HMAC-SHA256 (RFC 8018) over
   `subtle.digest`.

## 3. Test evidence (observed, not assumed)

- `tooling/wallet-scrypt-test.js` — **19/19 pass**: RFC 7914 KAT (N=16/1024/16384),
  vendored scrypt == Node `crypto.scryptSync` at N=2^15 r=8 p=1, v2 create/unlock
  round-trip, fresh salt/hkdfSalt/iv, wrong-password via verifier, tampered
  verifier ⇒ wrong password, tampered ciphertext ⇒ corrupt wallet, v1 unlock +
  in-place upgrade, failed-migration fallback.
- `tooling/wallet-seam-test.js` — **18/18 pass** (unchanged suite, now v2).
- Focused regression sweep (shim `/workspace`): forms 20, es-lab-ui 10,
  explorer-readability 61, pool-stake 47, menu 27, signmode 30, my-positions 55,
  txbuilder 53, transfer-confirm 14, tier2-gate 50, viewas 16, app-shell 11+
  pulldown 21 + bar-six 34 + phone-scroll 6 — all green.
- **Firefox (real browser, `tooling/visual` playwright):** create writes a v2
  envelope (`N=32768`), unlock round-trips, wrong password rejected by the
  verifier, `#/wallet` UI unlock reveals the same brainkey, zero non-WS console
  errors. Screenshot: `/tmp/wallet-browser.png` (dev aid; human pass is the gate).

## 4. Raw→human test vectors

Not applicable: this change displays no chain number. The keystore's only
user-visible outputs (balances/amounts) are untouched and remain routed through
`vanilla/js/api/format.js`.

## 5. Themes + viewports

Not applicable visually (no markup/CSS change; the `#/wallet` screen is
unchanged). Browser check ran at desktop 1440px. The N choice is the
phone-relevant decision: N=2^15 = ~1.8s / 32MiB on desktop Firefox; N=2^16 was
~3.5s and rejected as too slow for repeated unlock on a phone. Params are
stored per-envelope, so raising N later needs no format change.

## 6. Readability (§3.7)

`wallet.js` is now 628 lines (>400). Kept whole with a written exception
(intrinsic to the keystore: envelope crypto + lifecycle share `_subtle`,
`_randU8`, `_b64*`, and the storage seam; a split adds load-order seams across
browser + extension-wrapper + tests for no functional gain — same rationale as
`crypto.js 743` in `slice-18-readability.md`). Every new function has a
what/params/returns/fails header; no TODO/FIXME/commented-out code.

## 7. Anti-rot gate (§4.5)

- (a) Ten years, nothing updated: still runs — pure HTML/JS/CSS, and the new
  KDF is vendored source (no CDN, no npm, no build step).
- (b) Newly depends on: the vendored `scrypt.js` (MIT, pinned HEAD + sha256 +
  `SECURITY.md` watch row) and RFC-standard WebCrypto HKDF/HMAC/AES-GCM.
  No runtime package added.
- (c) Smallest deletable subset: the HKDF layer and the v1 migration are the
  removable extras; deleting them still yields a working v2 keystore. They are
  kept because key-separation is the foundation for the multi-key work in
  issue #2 and v1 migration protects existing wallets.

## 8. Gate evidence

- `python3 tooling/check_rot.py` → PASS.
- `python3 tooling/check_i18n.py` → OK (12 dicts, no new strings).
- `bash tooling/check_types.sh` → PASS.
- `node --check` clean on all touched scripts.

## Decisions / limitations

- **Default params N=2^15, r=8, p=1.** Documented rationale + benchmark above.
- **v1 migration is best-effort.** A failed rewrite leaves the working v1
  envelope and the next unlock retries; proven by test 5b.
- **No daemon/headless path** (DEXBot2-only concept; out of scope for a
  browser wallet).
- **Rate-limit unchanged** (persisted exponential backoff is the right browser
  model; DEXBot2's 3-attempt-then-exit is CLI semantics, deliberately not copied).
