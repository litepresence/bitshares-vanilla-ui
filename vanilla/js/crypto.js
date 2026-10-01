/* crypto.js — async key derivation + key formats for the vanilla wallet.
 *
 * What it owns: all hashing, brainkey derivation, and WIF / prefixed-pubkey
 * formatting. Consumes: globals BRAINKEY_DICT (js/data/brainkey-dict.js) and
 * nobleGetPublicKey (js/vendor/noble-classic.js). Load order in index.html:
 * noble-classic.js, brainkey-dict.js, then this file. Side effects: none
 * beyond the `Crypto` global. Created by: building-vanilla-slices skill,
 * slice-02-wallet plan Task 3.
 *
 * Provenance / credits:
 * - Brainkey normalize + sha512(seq) chain + fromSeed formulas follow the
 *   classic path in astro-ui src/bts/key.js and bitshares-ui
 *   app/stores/WalletDb.js:260 (owner/active/memo seed = account+role+pw).
  * - base58 encode and ripemd160 below are ported from
  *   wallet-extension/src/lib/crypto-utils.js (pure-JS, no WebCrypto
  *   equivalent for ripemd160 exists); secret-scalar ops go only to the
  *   vendored noble file, never to hand-rolled math.
  * - Slice 04 memo + signing additions ported from
  *   wallet-extension/src/lib/crypto-utils.js: signHash :720-770,
  *   isCanonicalSignature :775-815, recoverPublicKey :822-887 (+ ECPoint,
  *   SECP256K1, mod/modInverse/modPow, bigInt helpers :22-230),
  *   encryptMemo :1068-1125, btsToPublicKeyBytes :1200-1231,
  *   aes256CbcEncrypt :1245-1261, wifToPrivateKey :631-672,
  *   base58Decode :942-971. Secret-scalar ops go only to the vendored
  *   noble globals (nobleSignAsync, nobleGetSharedSecret); the ported
  *   BigInt code is public-operations-only (recovery/validation), exactly
  *   as in #3's documented boundary.
 * - DEVIATION (generation only, derivation unaffected): suggestBrainkey uses
 *   Math.floor (uniform index in [0, 49743]) where the astro-ui reference
 *   used Math.round, which can overflow the 49744-word list at the top edge.
 *   normalizeBrainkey preserves case (no uppercasing) to match the classic
 *   derivation path.
 */

"use strict";

var Crypto = (function () {
  var DICT_SIZE = 49744;

  /* Encode a string to UTF-8 bytes; pass Uint8Array input through. */
  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof input === "string") return new TextEncoder().encode(input);
    throw new Error("expected Uint8Array or string");
  }

  /* Bytes to lowercase hex string. */
  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }

  /* 64-char hex string to 32 bytes; throws on bad input. */
  function hexToBytes32(hex) {
    if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error("expected 64-char hex private key");
    }
    var bytes = new Uint8Array(32);
    for (var i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  /* Raw SHA-256 digest bytes of bytes-or-string input. */
  async function sha256Bytes(input) {
    var buf = await crypto.subtle.digest("SHA-256", toBytes(input));
    return new Uint8Array(buf);
  }

  /* Raw SHA-512 digest bytes of bytes-or-string input. */
  async function sha512Bytes(input) {
    var buf = await crypto.subtle.digest("SHA-512", toBytes(input));
    return new Uint8Array(buf);
  }

  /* Hex of SHA-256(UTF-8(input)); accepts Uint8Array or string. */
  async function sha256hex(input) {
    return bytesToHex(await sha256Bytes(input));
  }

  /* Hex of SHA-512(UTF-8(input)); accepts Uint8Array or string. */
  async function sha512hex(input) {
    return bytesToHex(await sha512Bytes(input));
  }

  /* Collapse all ASCII whitespace runs to single spaces; throws on
   * non-string or empty-after-trim input. Case is preserved. */
  function normalizeBrainkey(s) {
    if (typeof s !== "string") throw new Error("brainkey must be a string");
    var t = s.trim();
    if (!t) throw new Error("brainkey is empty");
    return t.split(/[\t\n\v\f\r ]+/).join(" ");
  }

  /* Classic brainkey private key: SHA-256 over the raw 64 SHA-512 digest
   * bytes of UTF-8(normalized + " " + seq). Bytes stay bytes through the
   * whole chain — no intermediate hex string is ever re-hashed. */
  async function brainPrivateKeyHex(brainkey, seq) {
    if (seq === undefined) seq = 0;
    if (!Number.isInteger(seq) || seq < 0) {
      throw new Error("seq must be a non-negative integer");
    }
    var norm = normalizeBrainkey(brainkey);
    var seedBytes = new TextEncoder().encode(norm + " " + seq);
    var first = await sha512Bytes(seedBytes);
    var second = await sha256Bytes(first);
    return bytesToHex(second);
  }

  /* Hex of SHA-256(UTF-8(seedStr)). */
  async function fromSeedHex(seedStr) {
    if (typeof seedStr !== "string" || !seedStr) {
      throw new Error("seed must be a non-empty string");
    }
    return sha256hex(seedStr);
  }

  /* Resolve the key prefix: explicit arg wins; otherwise "TEST" on the
   * testnet network from Store settings, "BTS" everywhere else. */
  function resolvePrefix(prefix) {
    if (typeof prefix === "string" && prefix) return prefix;
    try {
      if (typeof Store !== "undefined" &&
          Store.loadSettings().network === "testnet") {
        return "TEST";
      }
    } catch (_) { /* fall through to default */ }
    return "BTS";
  }

  /* Keypair from a 32-byte hex private key: WIF plus prefixed public key.
   * Public bytes come from vendored noble only. */
  async function keypairFromPrivateHex(privHex, prefix) {
    var privBytes = hexToBytes32(privHex);
    if (typeof nobleGetPublicKey !== "function") {
      throw new Error("nobleGetPublicKey is not loaded");
    }
    var pubBytes = nobleGetPublicKey(privBytes, true);
    var wif = await privateBytesToWif(privBytes);
    var pub = publicBytesToPrefixed(pubBytes, resolvePrefix(prefix));
    return { wif: wif, pub: pub };
  }

  /* Random 16-word brainkey from 32 crypto-random bytes; two bytes per
   * word, index uniform via floor (see header deviation note). */
  async function suggestBrainkey() {
    if (typeof BRAINKEY_DICT !== "string" || !BRAINKEY_DICT) {
      throw new Error("BRAINKEY_DICT is not loaded");
    }
    var words = BRAINKEY_DICT.split(",");
    if (words.length !== DICT_SIZE) {
      throw new Error("BRAINKEY_DICT has " + words.length + " words");
    }
    var rnd = crypto.getRandomValues(new Uint8Array(32));
    var picked = [];
    for (var i = 0; i < 32; i += 2) {
      var num = (rnd[i] << 8) + rnd[i + 1];
      var idx = Math.floor(DICT_SIZE * num / 65536);
      picked.push(words[idx]);
    }
    return normalizeBrainkey(picked.join(" "));
  }

  /* WIF: base58(0x80 + 32 key bytes + first 4 of double-SHA-256). */
  async function privateBytesToWif(privBytes) {
    var extended = new Uint8Array(33);
    extended[0] = 0x80;
    extended.set(privBytes, 1);
    var once = await sha256Bytes(extended);
    var twice = await sha256Bytes(once);
    var wifBytes = new Uint8Array(37);
    wifBytes.set(extended);
    wifBytes.set(twice.slice(0, 4), 33);
    return base58Encode(wifBytes);
  }

  /* Prefixed public key: prefix + base58(33 key bytes + first 4 of
   * ripemd160(key bytes)). */
  function publicBytesToPrefixed(pubBytes, prefix) {
    var checksum = ripemd160(pubBytes);
    var withChecksum = new Uint8Array(37);
    withChecksum.set(pubBytes);
    withChecksum.set(checksum.slice(0, 4), 33);
    return prefix + base58Encode(withChecksum);
  }

  /* Base58 encode (bitcoin alphabet); ported from #3 crypto-utils.js. */
  function base58Encode(buffer) {
    var ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if (buffer.length === 0) return "";
    var digits = [0];
    for (var i = 0; i < buffer.length; i++) {
      var carry = buffer[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    var result = "";
    for (var k = 0; k < buffer.length && buffer[k] === 0; k++) {
      result += ALPHABET[0];
    }
    for (var m = digits.length - 1; m >= 0; m--) {
      result += ALPHABET[digits[m]];
    }
    return result;
  }

  /* RIPEMD-160 digest bytes; ported from #3 crypto-utils.js (no WebCrypto
   * equivalent exists, so this pure-JS version is required for key
   * checksums). Input: Uint8Array or string. */
  function ripemd160(data) {
    var input = data instanceof Uint8Array ? data : new TextEncoder().encode(data);

    var RL = [
       0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
       7,  4, 13,  1, 10,  6, 15,  3, 12,  0,  9,  5,  2, 14, 11,  8,
       3, 10, 14,  4,  9, 15,  8,  1,  2,  7,  0,  6, 13, 11,  5, 12,
       1,  9, 11, 10,  0,  8, 12,  4, 13,  3,  7, 15, 14,  5,  6,  2,
       4,  0,  5,  9,  7, 12,  2, 10, 14,  1,  3,  8, 11,  6, 15, 13
    ];
    var RR = [
       5, 14,  7,  0,  9,  2, 11,  4, 13,  6, 15,  8,  1, 10,  3, 12,
       6, 11,  3,  7,  0, 13,  5, 10, 14, 15,  8, 12,  4,  9,  1,  2,
      15,  5,  1,  3,  7, 14,  6,  9, 11,  8, 12,  2, 10,  0,  4, 13,
       8,  6,  4,  1,  3, 11, 15,  0,  5, 12,  2, 13,  9,  7, 10, 14,
      12, 15, 10,  4,  1,  5,  8,  7,  6,  2, 13, 14,  0,  3,  9, 11
    ];
    var SL = [
      11, 14, 15, 12,  5,  8,  7,  9, 11, 13, 14, 15,  6,  7,  9,  8,
       7,  6,  8, 13, 11,  9,  7, 15,  7, 12, 15,  9, 11,  7, 13, 12,
      11, 13,  6,  7, 14,  9, 13, 15, 14,  8, 13,  6,  5, 12,  7,  5,
      11, 12, 14, 15, 14, 15,  9,  8,  9, 14,  5,  6,  8,  6,  5, 12,
       9, 15,  5, 11,  6,  8, 13, 12,  5, 12, 13, 14, 11,  8,  5,  6
    ];
    var SR = [
       8,  9,  9, 11, 13, 15, 15,  5,  7,  7,  8, 11, 14, 14, 12,  6,
       9, 13, 15,  7, 12,  8,  9, 11,  7,  7, 12,  7,  6, 15, 13, 11,
       9,  7, 15, 11,  8,  6,  6, 14, 12, 13,  5, 14, 13, 13,  7,  5,
      15,  5,  8, 11, 14, 14,  6, 14,  6,  9, 12,  9, 12,  5, 15,  8,
       8,  5, 12,  9, 12,  5, 14,  6,  8, 13,  6,  5, 15, 13, 11, 11
    ];

    /* RIPEMD-160 round function (5 rounds selected by j); ported from #3
    * crypto-utils.js:339. Params: j (round index 0-79), x/y/z (u32 words).
    * Returns the u32 round output. Fails: never (pure integer ops). */
    function f(j, x, y, z) {
      if (j < 16) return (x ^ y ^ z) >>> 0;
      if (j < 32) return ((x & y) | (~x & z)) >>> 0;
      if (j < 48) return ((x | ~y) ^ z) >>> 0;
      if (j < 64) return ((x & z) | (y & ~z)) >>> 0;
      return (x ^ (y | ~z)) >>> 0;
    }

    /* RIPEMD-160 left-line constant per round; ported from #3
    * crypto-utils.js:348. Params: j (round index 0-79). Returns the u32
    * constant. Fails: never (pure). */
    function KL(j) {
      if (j < 16) return 0x00000000;
      if (j < 32) return 0x5A827999;
      if (j < 48) return 0x6ED9EBA1;
      if (j < 64) return 0x8F1BBCDC;
      return 0xA953FD4E;
    }

    /* RIPEMD-160 right-line constant per round; ported from #3
    * crypto-utils.js:356. Params: j (round index 0-79). Returns the u32
    * constant. Fails: never (pure). */
    function KR(j) {
      if (j < 16) return 0x50A28BE6;
      if (j < 32) return 0x5C4DD124;
      if (j < 48) return 0x6D703EF3;
      if (j < 64) return 0x7A6D76E9;
      return 0x00000000;
    }

    /* RIPEMD-160 32-bit left rotation; ported from #3 crypto-utils.js:364.
    * Params: x (u32 word), n (bit count). Returns the rotated u32. Fails:
    * never (pure). */
    function rol(x, n) {
      return ((x << n) | (x >>> (32 - n))) >>> 0;
    }

    var msgLen = input.length;
    var zeros = (55 - msgLen % 64 + 64) % 64;
    var padded = new Uint8Array(msgLen + 1 + zeros + 8);
    padded.set(input);
    padded[msgLen] = 0x80;
    var dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, (msgLen * 8) >>> 0, true);
    dv.setUint32(padded.length - 4, (msgLen >>> 29) >>> 0, true);

    var h0 = 0x67452301;
    var h1 = 0xEFCDAB89;
    var h2 = 0x98BADCFE;
    var h3 = 0x10325476;
    var h4 = 0xC3D2E1F0;

    for (var off = 0; off < padded.length; off += 64) {
      var w = new Uint32Array(16);
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, true);

      var al = h0, bl = h1, cl = h2, dl = h3, el = h4;
      var ar = h0, br = h1, cr = h2, dr = h3, er = h4;

      for (var j = 0; j < 80; j++) {
        var tl = (al + f(j, bl, cl, dl) + w[RL[j]] + KL(j)) >>> 0;
        tl = (rol(tl, SL[j]) + el) >>> 0;
        al = el; el = dl; dl = rol(cl, 10); cl = bl; bl = tl;

        var tr = (ar + f(79 - j, br, cr, dr) + w[RR[j]] + KR(j)) >>> 0;
        tr = (rol(tr, SR[j]) + er) >>> 0;
        ar = er; er = dr; dr = rol(cr, 10); cr = br; br = tr;
      }

      var t = (h1 + cl + dr) >>> 0;
      h1 = (h2 + dl + er) >>> 0;
      h2 = (h3 + el + ar) >>> 0;
      h3 = (h4 + al + br) >>> 0;
      h4 = (h0 + bl + cr) >>> 0;
      h0 = t;
    }

    var result = new Uint8Array(20);
    var rv = new DataView(result.buffer);
    rv.setUint32(0, h0, true);
    rv.setUint32(4, h1, true);
    rv.setUint32(8, h2, true);
    rv.setUint32(12, h3, true);
    rv.setUint32(16, h4, true);
    return result;
  }

  /* --- Slice 04 additions: memo ECDH + canonical signing ------------------
   * Ported from wallet-extension/src/lib/crypto-utils.js (see header).
   * Boundary (exactly as documented in #3): every SECRET-scalar operation
   * (ECDH multiply, ECDSA signing, pubkey derivation) goes to the vendored
   * noble globals; the BigInt EC code below is PUBLIC-operations-only
   * (signature recovery / validation) and never sees secret bytes.
   * Runtime guards throw if the noble globals (Task 1) are not loaded.
   * ---------------------------------------------------------------------- */

  /* secp256k1 curve parameters for the public-only recovery path; ported
   * from #3 crypto-utils.js:22-33. */
  var SECP256K1 = {
    P: BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F"),
    N: BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"),
    Gx: BigInt("0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798"),
    Gy: BigInt("0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8"),
    A: BigInt(0),
    B: BigInt(7)
  };

  /* Non-negative remainder; ported from #3 crypto-utils.js:38-41. */
  function ecMod(a, m) {
    var result = a % m;
    return result >= 0n ? result : result + m;
  }

  /* Modular inverse via extended Euclid; ported from #3
   * crypto-utils.js:43-60. Public-operand math only. */
  function ecModInverse(a, m) {
    a = ecMod(a, m);
    if (a === 0n) throw new Error("No modular inverse for 0");
    var oldR = a, r = m;
    var oldS = 1n, s = 0n;
    while (r !== 0n) {
      var q = oldR / r;
      var tmpR = oldR - q * r;
      oldR = r; r = tmpR;
      var tmpS = oldS - q * s;
      oldS = s; s = tmpS;
    }
    return ecMod(oldS, m);
  }

  /* Modular exponentiation; ported from #3 crypto-utils.js:62-75.
   * Public-operand math only. */
  function ecModPow(base, exp, m) {
    var result = 1n;
    base = ecMod(base, m);
    while (exp > 0n) {
      if (exp % 2n === 1n) result = ecMod(result * base, m);
      exp = exp / 2n;
      base = ecMod(base * base, m);
    }
    return result;
  }

  /* BigInt to fixed-length big-endian bytes; ported from #3
   * crypto-utils.js:214-221. */
  function bigIntToBytes(n, length) {
    var bytes = new Uint8Array(length);
    for (var i = length - 1; i >= 0; i--) {
      bytes[i] = Number(n & 0xffn);
      n = n >> 8n;
    }
    return bytes;
  }

  /* Big-endian bytes to BigInt; ported from #3 crypto-utils.js:223-230. */
  function bytesToBigInt(bytes) {
    var result = 0n;
    for (var i = 0; i < bytes.length; i++) {
      result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
  }

  /* Elliptic-curve point ops, PUBLIC points only (the recovery path below
   * never handles a secret scalar — signing/ECDH stay in noble). Ported
   * from #3 crypto-utils.js:80-206, keeping the double-and-add-ALWAYS
   * multiply loop and the on-curve check in fromCompressed. */
  function ECPoint(x, y) {
    this.x = x;
    this.y = y;
  }
  ECPoint.infinity = function () { return new ECPoint(null, null); };
  ECPoint.prototype.isInfinity = function () {
    return this.x === null && this.y === null;
  };
  ECPoint.prototype.equals = function (other) {
    return this.x === other.x && this.y === other.y;
  };
  ECPoint.prototype.add = function (other) {
    if (this.isInfinity()) return other;
    if (other.isInfinity()) return this;
    var P = SECP256K1.P;
    if (this.x === other.x) {
      if (ecMod(this.y + other.y, P) === 0n) return ECPoint.infinity();
      return this.double();
    }
    var slope = ecMod((other.y - this.y) * ecModInverse(other.x - this.x, P), P);
    var x3 = ecMod(slope * slope - this.x - other.x, P);
    var y3 = ecMod(slope * (this.x - x3) - this.y, P);
    return new ECPoint(x3, y3);
  };
  ECPoint.prototype.double = function () {
    if (this.isInfinity()) return this;
    var P = SECP256K1.P, A = SECP256K1.A;
    var slope = ecMod((3n * this.x * this.x + A) * ecModInverse(2n * this.y, P), P);
    var x3 = ecMod(slope * slope - 2n * this.x, P);
    var y3 = ecMod(slope * (this.x - x3) - this.y, P);
    return new ECPoint(x3, y3);
  };
  ECPoint.prototype.multiply = function (k) {
    if (k <= 0n) return ECPoint.infinity();
    var result = ECPoint.infinity();
    var addend = this;
    for (var i = 0; i < 256; i++) {
      var bit = (k >> BigInt(i)) & 1n;
      var sum = result.add(addend);
      result = bit === 1n ? sum : result;
      addend = addend.double();
    }
    return result;
  };
  /* Compress a curve point to 33 bytes (prefix + x). */
  ECPoint.prototype.toCompressed = function () {
    var xBytes = bigIntToBytes(this.x, 32);
    var prefix = this.y % 2n === 0n ? 0x02 : 0x03;
    var result = new Uint8Array(33);
    result[0] = prefix;
    result.set(xBytes, 1);
    return result;
  };

  /* Generator point for the recovery formula. */
  var ECG = new ECPoint(SECP256K1.Gx, SECP256K1.Gy);

  /* Base58 decode (bitcoin alphabet); ported from #3 crypto-utils.js:942-971.
   * Prerequisite for wifToPrivateKey / btsToPublicKeyBytes below. */
  function base58Decode(str) {
    var ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if (str.length === 0) return new Uint8Array(0);
    var bytes = [0];
    for (var i = 0; i < str.length; i++) {
      var value = ALPHABET.indexOf(str[i]);
      if (value === -1) throw new Error("Invalid Base58 character");
      var carry = value;
      for (var j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (var k = 0; k < str.length && str[k] === ALPHABET[0]; k++) {
      bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
  }

  /* WIF string to 32-byte private key; ported from #3
   * crypto-utils.js:631-672. Handles 37-byte (uncompressed) and 38-byte
   * (compressed) forms; verifies the double-SHA-256 checksum via the
   * existing sha256Bytes helper. The returned bytes are SECRET — callers
   * pass them only to noble, never to the BigInt math above. */
  async function wifToPrivateKey(wif) {
    if (typeof wif !== "string") {
      throw new Error("WIF must be a string, got " + typeof wif);
    }
    if (wif.length < 50 || wif.length > 52) {
      throw new Error("Invalid WIF string length: " + wif.length);
    }
    var decoded = base58Decode(wif);
    if (decoded.length !== 37 && decoded.length !== 38) {
      throw new Error("Invalid WIF decoded length: " + decoded.length);
    }
    var isCompressed = decoded.length === 38;
    var payloadLength = isCompressed ? 34 : 33;
    var payload = decoded.slice(0, payloadLength);
    var checksum = decoded.slice(payloadLength);
    var once = await sha256Bytes(payload);
    var calculated = await sha256Bytes(once);
    for (var i = 0; i < 4; i++) {
      if (checksum[i] !== calculated[i]) throw new Error("Invalid WIF checksum");
    }
    if (decoded[0] !== 0x80) {
      throw new Error("Invalid WIF version byte: " + decoded[0]);
    }
    return decoded.slice(1, 33);
  }

  /* Prefixed public-key string (BTS/TEST/GPH + base58) to 33 raw bytes;
   * ported from #3 crypto-utils.js:1200-1231. Verifies the ripemd160
   * checksum with the existing ripemd160 helper. Sync, public data only. */
  function btsToPublicKeyBytes(publicKeyBTS) {
    var prefix = "";
    var prefixes = ["BTS", "TEST", "GPH"];
    for (var i = 0; i < prefixes.length; i++) {
      if (publicKeyBTS.indexOf(prefixes[i]) === 0) {
        prefix = prefixes[i];
        break;
      }
    }
    if (!prefix) {
      throw new Error("Invalid public key format — expected BTS, TEST, or GPH prefix");
    }
    var decoded = base58Decode(publicKeyBTS.slice(prefix.length));
    if (decoded.length !== 37) throw new Error("Invalid public key length");
    var publicKeyBytes = decoded.slice(0, 33);
    var checksum = decoded.slice(33);
    var calculated = ripemd160(publicKeyBytes);
    for (var j = 0; j < 4; j++) {
      if (checksum[j] !== calculated[j]) throw new Error("Invalid public key checksum");
    }
    return publicKeyBytes;
  }

  /* AES-256-CBC encrypt via WebCrypto; ported from #3
   * crypto-utils.js:1245-1261. */
  async function aes256CbcEncrypt(data, key, iv) {
    var cryptoKey = await crypto.subtle.importKey(
      "raw", key, { name: "AES-CBC" }, false, ["encrypt"]
    );
    var encrypted = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: iv }, cryptoKey, data
    );
    return new Uint8Array(encrypted);
  }

  /* Graphene canonical-signature check; ported from #3
   * crypto-utils.js:775-815. Rejects top-bit-set R/S bytes (would need DER
   * padding) and non-minimal 0x00 padding — ~0.4% of low-S signatures still
   * fail this and would bounce off the node. Pure validation, no secrets. */
  function isCanonicalSignature(rBytes, sBytes) {
    var rIsZero = true;
    for (var i = 0; i < rBytes.length; i++) {
      if (rBytes[i] !== 0) { rIsZero = false; break; }
    }
    if (rIsZero) return false;
    var sIsZero = true;
    for (var j = 0; j < sBytes.length; j++) {
      if (sBytes[j] !== 0) { sIsZero = false; break; }
    }
    if (sIsZero) return false;
    if (rBytes[0] >= 0x80) return false;
    if (rBytes[0] === 0x00 && rBytes[1] < 0x80) return false;
    if (sBytes[0] >= 0x80) return false;
    if (sBytes[0] === 0x00 && sBytes[1] < 0x80) return false;
    return true;
  }

  /* Recover the 33-byte compressed signer pubkey from (hash, 65-byte
   * compact signature); ported from #3 crypto-utils.js:822-887. PUBLIC
   * math only — inputs are a digest and a signature, no secrets. Formula
   * Q = r^-1 * (s*R + (-e)*G), matching bitsharesjs/elliptic.js. */
  function recoverPublicKey(hash, signature) {
    var N = SECP256K1.N, P = SECP256K1.P, B = SECP256K1.B;
    var header = signature[0];
    var recoveryId = (header - 27) & 3;
    var rBytes = signature.slice(1, 33);
    var sBytes = signature.slice(33, 65);
    var r = bytesToBigInt(rBytes);
    var s = bytesToBigInt(sBytes);
    var e = bytesToBigInt(hash);
    if (r <= 0n || r >= N) throw new Error("Invalid r value");
    if (s <= 0n || s >= N) throw new Error("Invalid s value");
    var isYOdd = (recoveryId & 1) === 1;
    var isSecondKey = (recoveryId >> 1) & 1;
    var rx = r;
    if (isSecondKey) {
      rx = r + N;
      if (rx >= P) throw new Error("Invalid recovery ID - rx >= P");
    }
    var ySquared = ecMod(ecModPow(rx, 3n, P) + B, P);
    var ry = ecModPow(ySquared, (P + 1n) / 4n, P);
    if (ecMod(ry * ry, P) !== ySquared) throw new Error("Point not on curve");
    var ryIsOdd = (ry % 2n) === 1n;
    if (ryIsOdd !== isYOdd) ry = P - ry;
    var R = new ECPoint(rx, ry);
    var rInv = ecModInverse(r, N);
    var eMod = ecMod(e, N);
    var eNeg = eMod === 0n ? 0n : N - eMod;
    var sR = R.multiply(s);
    var eNegG = ECG.multiply(eNeg);
    var sum = sR.add(eNegG);
    var Q = sum.multiply(rInv);
    if (Q.isInfinity()) throw new Error("Recovered point is at infinity");
    return Q.toCompressed();
  }

  /* Sign a 32-byte hash with a WIF key, returning a 65-byte graphene
   * compact signature; ported from #3 crypto-utils.js:720-770.
   * Secret-scalar work is done ONLY by nobleSignAsync (RFC-6979,
   * constant-time); this function only enforces the canonical form and
   * verifies the recovery id against the independently recovered public
   * key (public-only math above) before returning. */
  async function signHash(hashU8, wif) {
    if (typeof nobleSignAsync !== "function") {
      throw new Error("nobleSignAsync is not loaded");
    }
    if (typeof nobleGetPublicKey !== "function") {
      throw new Error("nobleGetPublicKey is not loaded");
    }
    var hash = hashU8 instanceof Uint8Array ? hashU8 : toBytes(hashU8);
    /* M5: secret bytes are zeroed in the finally below. A Uint8Array CAN be
     * wiped (unlike the WIF string, which only drops out of reach). */
    var privateKeyBytes = await wifToPrivateKey(wif);
    try {
      var expectedPubKey = nobleGetPublicKey(privateKeyBytes, true);
      var expectedHex = bytesToHex(expectedPubKey);
      for (var attempt = 0; attempt < 128; attempt++) {
        var opts = attempt === 0
          ? { lowS: true }
          : { lowS: true, extraEntropy: crypto.getRandomValues(new Uint8Array(32)) };
        var sig = await nobleSignAsync(hash, privateKeyBytes, opts);
        var rBytes = bigIntToBytes(sig.r, 32);
        var sBytes = bigIntToBytes(sig.s, 32);
        if (!isCanonicalSignature(rBytes, sBytes)) continue;
        var signature = new Uint8Array(65);
        signature[0] = 27 + 4 + (sig.recovery & 3);
        signature.set(rBytes, 1);
        signature.set(sBytes, 33);
        try {
          if (bytesToHex(recoverPublicKey(hash, signature)) === expectedHex) {
            return signature;
          }
        } catch (_) { /* fall through and retry */ }
      }
      throw new Error("Unable to find a canonical signature after 128 attempts");
    } finally {
      try { privateKeyBytes.fill(0); } catch (wipeErr) { /* bytes dropped regardless */ }
    }
  }

  /* Encrypt a memo (BitShares ECIES); ported from #3
   * crypto-utils.js:1068-1125. ECDH shared secret via nobleGetSharedSecret
   * (x-coordinate only); key = SHA-512(nonce8 || x) split into AES-256-CBC
   * key (first 32B) + IV (next 16B); SHA-256(message)[:4] checksum
   * prepended; random 64-bit nonce. Reuses the existing
   * publicBytesToPrefixed / sha512Bytes / sha256Bytes / bytesToHex
   * helpers. Returns {from, to, nonce, message} ready for op 0. */
  async function encryptMemo(message, fromWIF, toPub, nonce) {
    if (nonce === undefined) nonce = null;
    if (typeof nobleGetSharedSecret !== "function") {
      throw new Error("nobleGetSharedSecret is not loaded");
    }
    if (typeof nobleGetPublicKey !== "function") {
      throw new Error("nobleGetPublicKey is not loaded");
    }
    var fromPrivateKeyBytes = await wifToPrivateKey(fromWIF);
    try {
      var memoPrefix = "BTS";
      var prefixes = ["BTS", "TEST", "GPH"];
      for (var p = 0; p < prefixes.length; p++) {
        if (toPub.indexOf(prefixes[p]) === 0) { memoPrefix = prefixes[p]; break; }
      }
      var fromPublicKeyBytes = nobleGetPublicKey(fromPrivateKeyBytes, true);
      var fromPublicKeyBTS = publicBytesToPrefixed(fromPublicKeyBytes, memoPrefix);
      var toPublicKeyBytes = btsToPublicKeyBytes(toPub);
      if (nonce === null) {
        var randBytes = crypto.getRandomValues(new Uint8Array(8));
        nonce = randBytes.reduce(function (acc, b) { return (acc << 8n) | BigInt(b); }, 0n);
      }
      var sharedXBytes = nobleGetSharedSecret(
        fromPrivateKeyBytes, toPublicKeyBytes, true
      ).slice(1, 33);
      var nonceBytes = bigIntToBytes(nonce, 8);
      var preKey = new Uint8Array(8 + 32);
      preKey.set(nonceBytes, 0);
      preKey.set(sharedXBytes, 8);
      var keyHash = await sha512Bytes(preKey);
      var encryptionKey = keyHash.slice(0, 32);
      var iv = keyHash.slice(32, 48);
      var messageBytes = new TextEncoder().encode(message);
      var encryptedBytes = await aes256CbcEncrypt(messageBytes, encryptionKey, iv);
      var messageChecksum = await sha256Bytes(messageBytes);
      var checksum = messageChecksum.slice(0, 4);
      var finalMessage = new Uint8Array(4 + encryptedBytes.length);
      finalMessage.set(checksum, 0);
      finalMessage.set(encryptedBytes, 4);
      return {
        from: fromPublicKeyBTS,
        to: toPub,
        nonce: nonce.toString(),
        message: bytesToHex(finalMessage)
      };
    } finally {
      /* M5: secret bytes zeroed even on throw (see signHash). */
      try { fromPrivateKeyBytes.fill(0); } catch (wipeErr) { /* bytes dropped regardless */ }
    }
  }

  return {
    sha256hex: sha256hex,
    sha512hex: sha512hex,
    normalizeBrainkey: normalizeBrainkey,
    brainPrivateKeyHex: brainPrivateKeyHex,
    fromSeedHex: fromSeedHex,
    suggestBrainkey: suggestBrainkey,
    keypairFromPrivateHex: keypairFromPrivateHex,
    wifToPrivateKey: wifToPrivateKey,
    btsToPublicKeyBytes: btsToPublicKeyBytes,
    encryptMemo: encryptMemo,
    signHash: signHash,
    isCanonicalSignature: isCanonicalSignature,
    recoverPublicKey: recoverPublicKey
  };
})();

if (typeof module !== "undefined") { module.exports = Crypto; }
