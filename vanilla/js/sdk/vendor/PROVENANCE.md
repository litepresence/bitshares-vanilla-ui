# Vendored crypto provenance
- noble-secp256k1.js: byte-copy of reference/wallet-extension/src/lib/noble-secp256k1.js
  (itself vendored from @noble/secp256k1 v2.3.0, MIT, Paul Miller).
  Source sha256: 462b6380c45640f92dd613f39d044e4dd4f87b18831338a3fe4e2a019d30c83d. Do NOT edit by hand.
  Used for: private→public derivation (all secret-scalar ops).
- noble-classic.js: mechanical one-line transform of noble-secp256k1.js for
  classic `<script>` loading (no modules, `file://`-safe). The vendored file's
  ONLY module syntax is the single trailing line 797
  (`export { ... getPublicKey ... };`), which is replaced verbatim by
  `var nobleGetPublicKey = getPublicKey;`. Body untouched; verified by
  `node --check` (exit 0) plus a smoke test (privkey 0x01 → generator point
  0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798).
  Regenerate — never hand-edit — if the vendored file changes.
- noble-classic.js exposes getPublicKey, signAsync, getSharedSecret (one-line mechanical transform, re-verified 2026-09-26).
- Rule: SLIP-48/BIP-32/BIP-39 derivation must never enter vanilla/ (incompatible
  with legacy brainkeys — see slice-2 design). The vendored file contains no
  HD-wallet code paths used by us; we call getPublicKey only.
- lightweight-charts.standalone.production.js: byte-fetch from
  https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js
  version 5.2.1, license Apache-2.0 (verified via registry.npmjs.org
  dist-tags.latest on 2026-09-27), sha256
  e21cc5caa0226ef30bd8549c50b9ef926615f2a4ee6b4e486353477a55f598cf,
  197922 bytes. Do NOT edit by hand. Doctrine note: self-contained UMD/global
  build exposing `LightweightCharts`, no backend, pinned copy; canvas fallback
  retained in market-charts.js.
- scrypt.js: port of DEXBot2 `modules/crypto/pure_scrypt.ts`
  (https://github.com/bitshares/DEXBot2, MIT, Copyright (c) 2025 froooze;
  local HEAD f28145fdb5fbe2ea06362b210c547878948a7f64, source sha256
  cd2b60583bfbd0f6745225a96ff20beaf683cdfcc452455172f160e28aae2c5b).
  TRANSFORM: TypeScript stripped, wrapped as global `ScryptKdf.derive`.
  TWO DEVIATIONS from upstream, both forced by the RFC 7914 KAT:
  (1) upstream's ROMix reset X to the input block before phase 2, mixing from
      X_0 instead of X_N (RFC 7914 §5) — it matches no RFC vector; fixed by
      tracking X through phase 1;
  (2) upstream derived p*128*r bytes in one WebCrypto deriveBits call, which
      Firefox caps at 256 bytes (OperationError at r=8) — replaced with
      RFC 8018 block-wise PBKDF2-HMAC-SHA-256 over subtle.digest.
  Correctness: RFC 7914 vectors (N=16/1024/16384) + equality with Node
  crypto.scryptSync at N=2^15, r=8, p=1 (tooling/wallet-scrypt-test.js).
  Used for: v2 wallet password KDF. Do NOT hand-edit.
