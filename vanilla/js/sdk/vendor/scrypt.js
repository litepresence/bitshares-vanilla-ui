/*
 * Vendored pure-JS scrypt (RFC 7914) — memory-hard password KDF.
 *
 * Provenance: ported from DEXBot2 `modules/crypto/pure_scrypt.ts`
 * (https://github.com/bitshares/DEXBot2, MIT, Copyright (c) 2025 froooze),
 * local checkout HEAD f28145fdb5fbe2ea06362b210c547878948a7f64 (2026-10-08),
 * source sha256 cd2b60583bfbd0f6745225a96ff20beaf683cdfcc452455172f160e28aae2c5b.
 * TRANSFORM: TypeScript types/`export` stripped; wrapped in an IIFE exposing
 * global `ScryptKdf.derive` for classic <script> loading (no modules,
 * `file://`-safe). One BUG FIX vs upstream (found by RFC 7914 KAT): upstream
 * `romixBlock` reset X to the original block before ROMix phase 2, so phase 2
 * mixed from X_0 instead of X_N (RFC 7914 §5). Upstream's own test only checked
 * output length, never a known-answer vector, so it never caught this. The
 * corrected loop below tracks X through phase 1. Verified against the RFC 7914
 * vectors in `tooling/wallet-scrypt-test.js` (N=16/r=1/p=1, N=1024/r=8/p=16,
 * N=16384/r=8/p=1, all matching Node `crypto.scryptSync`). Do NOT hand-edit —
 * re-port from the upstream file (and re-apply the fix) then re-run the KAT.
 * The outer PBKDF2-HMAC-SHA256 steps use WebCrypto (`crypto.subtle`);
 * Salsa20/8 ROMix is pure JS, so no Node/npm dependency exists.
 * Watch triggers: see vanilla/SECURITY.md (scrypt row).
 */
var ScryptKdf = (function () {
  "use strict";

  /* rotl32: 32-bit left rotate. Params: x (int), n (0..31). Returns uint32. */
  function rotl32(x, n) {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  /* salsa208Core: Salsa20/8 core over a 16-word state. Params: output,
   *   input (Uint32Array(16)). Returns nothing (writes output). */
  function salsa208Core(output, input) {
    var x = new Uint32Array(16);
    for (var i = 0; i < 16; i++) x[i] = input[i];

    for (var i = 0; i < 8; i += 2) {
      x[4] ^= rotl32((x[0] + x[12]) | 0, 7);
      x[8] ^= rotl32((x[4] + x[0]) | 0, 9);
      x[12] ^= rotl32((x[8] + x[4]) | 0, 13);
      x[0] ^= rotl32((x[12] + x[8]) | 0, 18);
      x[9] ^= rotl32((x[5] + x[1]) | 0, 7);
      x[13] ^= rotl32((x[9] + x[5]) | 0, 9);
      x[1] ^= rotl32((x[13] + x[9]) | 0, 13);
      x[5] ^= rotl32((x[1] + x[13]) | 0, 18);
      x[14] ^= rotl32((x[10] + x[6]) | 0, 7);
      x[2] ^= rotl32((x[14] + x[10]) | 0, 9);
      x[6] ^= rotl32((x[2] + x[14]) | 0, 13);
      x[10] ^= rotl32((x[6] + x[2]) | 0, 18);
      x[3] ^= rotl32((x[15] + x[11]) | 0, 7);
      x[7] ^= rotl32((x[3] + x[15]) | 0, 9);
      x[11] ^= rotl32((x[7] + x[3]) | 0, 13);
      x[15] ^= rotl32((x[11] + x[7]) | 0, 18);

      x[1] ^= rotl32((x[0] + x[3]) | 0, 7);
      x[2] ^= rotl32((x[1] + x[0]) | 0, 9);
      x[3] ^= rotl32((x[2] + x[1]) | 0, 13);
      x[0] ^= rotl32((x[3] + x[2]) | 0, 18);
      x[6] ^= rotl32((x[5] + x[4]) | 0, 7);
      x[7] ^= rotl32((x[6] + x[5]) | 0, 9);
      x[4] ^= rotl32((x[7] + x[6]) | 0, 13);
      x[5] ^= rotl32((x[4] + x[7]) | 0, 18);
      x[11] ^= rotl32((x[10] + x[9]) | 0, 7);
      x[8] ^= rotl32((x[11] + x[10]) | 0, 9);
      x[9] ^= rotl32((x[8] + x[11]) | 0, 13);
      x[10] ^= rotl32((x[9] + x[8]) | 0, 18);
      x[12] ^= rotl32((x[15] + x[14]) | 0, 7);
      x[13] ^= rotl32((x[12] + x[15]) | 0, 9);
      x[14] ^= rotl32((x[13] + x[12]) | 0, 13);
      x[15] ^= rotl32((x[14] + x[13]) | 0, 18);
    }

    for (var k = 0; k < 16; k++) output[k] = (x[k] + input[k]) | 0;
  }

  /* blockMix: scrypt BlockMix (RFC 7914 §4). Params: output, input
   *   (Uint8Array, length 128*r), r. Returns nothing. */
  function blockMix(output, input, r) {
    var blockSize = 64;
    var x = new Uint32Array(16);
    var xView = new DataView(new ArrayBuffer(64));
    var xBytes = new Uint8Array(xView.buffer);
    var y = new Uint8Array(2 * r * blockSize);

    var lastStart = (2 * r - 1) * blockSize;
    for (var i = 0; i < blockSize; i++) xBytes[i] = input[lastStart + i];

    for (var b = 0; b < 2 * r; b++) {
      var biStart = b * blockSize;
      for (var j = 0; j < blockSize; j++) xBytes[j] ^= input[biStart + j];
      for (var w = 0; w < 16; w++) x[w] = xView.getUint32(w * 4, true);
      salsa208Core(x, x);
      for (var w2 = 0; w2 < 16; w2++) xView.setUint32(w2 * 4, x[w2], true);
      var yiStart = b * blockSize;
      for (var c = 0; c < blockSize; c++) y[yiStart + c] = xBytes[c];
    }

    for (var even = 0; even < r; even++) {
      var srcIdx = even * 2 * blockSize;
      var dstIdx = even * blockSize;
      for (var e = 0; e < blockSize; e++) output[dstIdx + e] = y[srcIdx + e];
    }
    for (var odd = 0; odd < r; odd++) {
      var srcIdx2 = (odd * 2 + 1) * blockSize;
      var dstIdx2 = (r + odd) * blockSize;
      for (var o = 0; o < blockSize; o++) output[dstIdx2 + o] = y[srcIdx2 + o];
    }
  }

  /* integerify: little-endian uint32 of the last 64-byte block's first word.
   * Params: b (Uint8Array), r. Returns uint32. */
  function integerify(b, r) {
    var offset = (2 * r - 1) * 64;
    return (b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16) | (b[offset + 3] << 24)) >>> 0;
  }

  /* xorBlock: dst = a xor b (in place into dst). Returns nothing. */
  function xorBlock(dst, a, b) {
    for (var i = 0; i < dst.length; i++) dst[i] = a[i] ^ b[i];
  }

  /* romixBlock: scrypt ROMix (RFC 7914 §5). Params: block (Uint8Array,
   *   length 128*r, updated in place), N, r. Returns nothing. */
  function romixBlock(block, N, r) {
    var blockSize = 128 * r;
    var V = new Array(N);

    /* Phase 1 (RFC 7914 §5): V[i] = X_i, X_{i+1} = BlockMix(X_i), leaving
     * X = X_N for phase 2. blockMix(X, X) is alias-safe: it reads `input`
     * fully before writing `output`. */
    var X = new Uint8Array(block);
    for (var i = 0; i < N; i++) {
      V[i] = new Uint8Array(X);
      blockMix(X, X, r);
    }

    for (var k = 0; k < N; k++) {
      var j = integerify(X, r) % N;
      var vBlock = V[j];
      var tmp = new Uint8Array(blockSize);
      xorBlock(tmp, X, vBlock);
      blockMix(X, tmp, r);
    }

    for (var m = 0; m < blockSize; m++) block[m] = X[m];
  }

  /* subtleOrThrow: fetch WebCrypto. Returns SubtleCrypto. Fails: throws. */
  function subtleOrThrow() {
    var subtle = (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) || null;
    if (!subtle) throw new Error("Web Crypto API not available");
    return subtle;
  }

  /* sha256: one-shot SHA-256. Params: data (Uint8Array). Returns
   *   Promise<Uint8Array(32)>. */
  async function sha256(data) {
    return new Uint8Array(await subtleOrThrow().digest("SHA-256", data));
  }

  /* hmacSha256: HMAC-SHA256 (RFC 2104) built on subtle.digest rather than
   * subtle.sign, so an empty key (valid per RFC 2104 zero-padding, and used
   * by the RFC 7914 vector P="") works — WebCrypto importKey rejects a
   * zero-length HMAC key. Params: key, data (Uint8Array). Returns
   *   Promise<Uint8Array(32)>. */
  async function hmacSha256(key, data) {
    var k = key.length > 64 ? await sha256(key) : key;
    var ipad = new Uint8Array(64 + data.length);
    var opad = new Uint8Array(64 + 32);
    for (var i = 0; i < 64; i++) {
      var b = i < k.length ? k[i] : 0;
      ipad[i] = b ^ 0x36;
      opad[i] = b ^ 0x5c;
    }
    ipad.set(data, 64);
    opad.set(await sha256(ipad), 64);
    return sha256(opad);
  }

  /* pbkdf2HmacSha256: PBKDF2-HMAC-SHA256 (RFC 8018 §5.2), block-wise.
   * Block-wise (not `subtle.deriveBits`) because Firefox caps deriveBits
   * output at 256 bytes while scrypt's first call needs p*128*r (1024 at
   * r=8) — upstream's single-call version throws OperationError in Firefox.
   * Params: password, salt (Uint8Array), iterations (int), keyLength (bytes).
   * Returns Promise<Uint8Array>. */
  async function pbkdf2HmacSha256(password, salt, iterations, keyLength) {
    var hLen = 32;
    var blocks = Math.ceil(keyLength / hLen);
    var out = new Uint8Array(blocks * hLen);
    var msg = new Uint8Array(salt.length + 4);
    msg.set(salt, 0);
    for (var i = 1; i <= blocks; i++) {
      msg[salt.length] = (i >>> 24) & 0xff;
      msg[salt.length + 1] = (i >>> 16) & 0xff;
      msg[salt.length + 2] = (i >>> 8) & 0xff;
      msg[salt.length + 3] = i & 0xff;
      var u = await hmacSha256(password, msg);
      var t = u;
      for (var c = 2; c <= iterations; c++) {
        u = await hmacSha256(password, u);
        for (var k = 0; k < hLen; k++) t[k] ^= u[k];
      }
      out.set(t, (i - 1) * hLen);
    }
    return out.subarray(0, keyLength);
  }

  /* derive: scrypt key derivation. Params: password, salt (Uint8Array),
   *   keyLength (bytes), options {N, r, p}. Returns Promise<Uint8Array>.
   *   Fails: throws on missing WebCrypto or invalid params. */
  async function derive(password, salt, keyLength, options) {
    var N = options.N, r = options.r, p = options.p;
    var blockSize = 128 * r;

    var totalBlocks = p * blockSize;
    var B = await pbkdf2HmacSha256(password, salt, 1, totalBlocks);

    for (var i = 0; i < p; i++) {
      var start = i * blockSize;
      var chunk = B.subarray(start, start + blockSize);
      romixBlock(chunk, N, r);
    }

    return pbkdf2HmacSha256(password, B, 1, keyLength);
  }

  return { derive: derive };
})();
