/* Wallet: encrypted brainkey keystore (PBKDF2-600k + AES-GCM).
 * Owns: wallet envelope under bts-vanilla-wallet-v1, in-memory unlock
 *   state (Wallet.keys), 5-minute inactivity auto-lock + hidden-tab lock,
 *   unlock rate-limit (in-memory exponential + persisted lockout stamp).
 * Storage backend seam (extension-wrapper): getItem/setItem go through
 *   _store() — default is localStorage (sync values ride await unchanged,
 *   so web behavior is byte-identical); the extension injects a
 *   chrome.storage backend via setBackend() before boot. Nothing else in
 *   this file knows which backend is active.
 * Consumes: Crypto.normalizeBrainkey/.brainPrivateKeyHex/.keypairFromPrivateHex
 *   (Task 3 interface only), Chain.db/.call for import verification.
 * Globals/side effects: backend reads/writes, setTimeout/clearTimeout lock
 *   timer, document visibilitychange listener, global Wallet.
 * Created by: building-vanilla-slices skill, slice-02 Task 4.
 */
var Wallet = (function () {
  "use strict";

  var LS_KEY = "bts-vanilla-wallet-v1";
  var ENVELOPE_V = 1;
  var ITERATIONS = 600000;
  var SALT_LEN = 16;
  var IV_LEN = 12;
  var LOCK_MS = 5 * 60 * 1000;
  var MIN_BRAINKEY_LEN = 50;

  var _data = null; // {brainkey:string, keys:{owner,active,memo:{wif,pub}}, created:string} | null
  var _lockTimer = null;
  var _onLock = null;
  /* Rate-limit state: consecutive failures this session + persisted lockout
   * stamp (survives restarts where the backend persists). Delays: 0,1,2,4,8
   * … seconds, capped at 30s. Storage failures never weaken the in-memory
   * count — they only lose cross-restart memory. */
  var _failCount = 0;
  var LOCKOUT_KEY = "bts-vanilla-lockout-v1";
  var _backend = null;

  var api = {
    keys: null,
    create: create,
    unlock: unlock,
    lock: lock,
    isUnlocked: isUnlocked,
    getBrainkey: getBrainkey,
    importBrainkey: importBrainkey,
    touch: touch,
    onLock: onLock,
    setBackend: setBackend
  };

  /* Storage backend (extension seam — see header). Default wraps
   * localStorage; values may be strings or Promises of strings. */
  function _store() {
    if (_backend) return _backend;
    return {
      getItem: function (k) {
        if (typeof localStorage === "undefined") throw new Error("storage unavailable: localStorage missing");
        return localStorage.getItem(k);
      },
      setItem: function (k, v) {
        if (typeof localStorage === "undefined") throw new Error("storage unavailable: localStorage missing");
        return localStorage.setItem(k, v);
      }
    };
  }

  /* setBackend: inject a {getItem(k), setItem(k,v)} backend (extension
   * entry point — call before boot). Params: backend object. Fails: bad
   * shape. Never touches stored data (migration is the wrapper's job). */
  function setBackend(b) {
    if (!b || typeof b.getItem !== "function" || typeof b.setItem !== "function") {
      throw new Error("bad storage backend: need getItem/setItem functions");
    }
    _backend = b;
  }

  /* Return the WebCrypto subtle handle, or throw a loud distinct Error. */
  function _subtle() {
    var c = (typeof globalThis !== "undefined" && globalThis.crypto) ||
      (typeof crypto !== "undefined" ? crypto : null);
    if (!c || !c.subtle) throw new Error("crypto unavailable: WebCrypto subtle missing");
    return c.subtle;
  }

  /* Fill a Uint8Array with secure random bytes. Throws if unavailable. */
  function _randU8(n) {
    var c = (typeof globalThis !== "undefined" && globalThis.crypto) ||
      (typeof crypto !== "undefined" ? crypto : null);
    if (!c || !c.getRandomValues) throw new Error("crypto unavailable: getRandomValues missing");
    var u8 = new Uint8Array(n);
    c.getRandomValues(u8);
    return u8;
  }

  /* base64-encode a Uint8Array (platform btoa, no deps). */
  function _b64encodeU8(u8) {
    var s = "";
    var i;
    for (i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    if (typeof btoa !== "undefined") return btoa(s);
    if (typeof Buffer !== "undefined") return Buffer.from(s, "binary").toString("base64");
    throw new Error("crypto unavailable: base64 encode missing");
  }

  /* base64-decode to Uint8Array. Throws on invalid input (caller maps to corrupt). */
  function _b64decodeToU8(b64) {
    var bin;
    if (typeof atob !== "undefined") bin = atob(b64);
    else if (typeof Buffer !== "undefined") bin = Buffer.from(b64, "base64").toString("binary");
    else throw new Error("crypto unavailable: base64 decode missing");
    var u8 = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  /* Derive an AES-256-GCM key from password+salt via PBKDF2-HMAC-SHA-256. */
  function _deriveKey(password, saltU8) {
    var subtle = _subtle();
    var pwU8 = new TextEncoder().encode(password);
    return subtle.importKey("raw", pwU8, { name: "PBKDF2" }, false, ["deriveKey"])
      .then(function (base) {
        return subtle.deriveKey(
          { name: "PBKDF2", salt: saltU8, iterations: ITERATIONS, hash: "SHA-256" },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  /* Read + shape-check the stored envelope. Throws no-wallet / corrupt. */
  async function _readEnvelope() {
    var raw;
    try {
      raw = await _store().getItem(LS_KEY);
    } catch (e) {
      throw new Error("storage unavailable: " + (e && e.message ? e.message : String(e)));
    }
    if (!raw) throw new Error("no wallet found under " + LS_KEY);
    var env;
    try {
      env = JSON.parse(raw);
    } catch (e) {
      throw new Error("corrupt wallet envelope: invalid JSON");
    }
    if (!env || typeof env !== "object" || env.v !== ENVELOPE_V ||
      typeof env.salt !== "string" || typeof env.iv !== "string" ||
      typeof env.data !== "string" || env.iterations !== ITERATIONS) {
      throw new Error("corrupt wallet envelope: bad shape or version");
    }
    return env;
  }

  /* Encrypt plaintext object -> versioned envelope. Random salt+iv per call. */
  function _encryptPlain(password, plain) {
    var salt = _randU8(SALT_LEN);
    var iv = _randU8(IV_LEN);
    var bytes = new TextEncoder().encode(JSON.stringify(plain));
    return _deriveKey(password, salt).then(function (key) {
      return _subtle().encrypt({ name: "AES-GCM", iv: iv }, key, bytes);
    }).then(function (ct) {
      return {
        v: ENVELOPE_V,
        salt: _b64encodeU8(salt),
        iterations: ITERATIONS,
        iv: _b64encodeU8(iv),
        data: _b64encodeU8(new Uint8Array(ct))
      };
    });
  }

  /* Decrypt envelope -> plaintext object. Auth failure maps to wrong-password. */
  function _decryptPlain(password, env) {
    var saltU8, ivU8, dataU8;
    try {
      saltU8 = _b64decodeToU8(env.salt);
      ivU8 = _b64decodeToU8(env.iv);
      dataU8 = _b64decodeToU8(env.data);
    } catch (e) {
      throw new Error("corrupt wallet envelope: bad base64");
    }
    return _deriveKey(password, saltU8).then(function (key) {
      return _subtle().decrypt({ name: "AES-GCM", iv: ivU8 }, key, dataU8);
    }).then(function (pt) {
      var plain;
      try {
        plain = JSON.parse(new TextDecoder().decode(new Uint8Array(pt)));
      } catch (e) {
        throw new Error("corrupt wallet plaintext: invalid JSON");
      }
      if (!plain || typeof plain !== "object" || typeof plain.brainkey !== "string" ||
        !plain.keys || !plain.keys.owner || !plain.keys.active || !plain.keys.memo ||
        typeof plain.keys.owner.wif !== "string" || typeof plain.keys.owner.pub !== "string" ||
        typeof plain.keys.active.wif !== "string" || typeof plain.keys.active.pub !== "string" ||
        typeof plain.keys.memo.wif !== "string" || typeof plain.keys.memo.pub !== "string") {
        throw new Error("corrupt wallet plaintext: bad shape");
      }
      return plain;
    }).catch(function (e) {
      if (e && typeof e.message === "string" &&
        (e.message.indexOf("wrong password") === 0 || e.message.indexOf("corrupt wallet") === 0)) throw e;
      throw new Error("wrong password: decrypt failed");
    });
  }

  /* Throw a distinct Error unless the normalized brainkey meets minimum length. */
  function _checkBrainkeyLen(norm) {
    if (norm.length < MIN_BRAINKEY_LEN) {
      throw new Error("brainkey too short: normalized length " + norm.length + " < " + MIN_BRAINKEY_LEN);
    }
  }

  /* Derive fresh roles owner<-seq0, active<-seq1, memo<-seq2. Returns {owner,active,memo}. */
  function _deriveFreshKeys(norm) {
    var out = {};
    return Crypto.brainPrivateKeyHex(norm, 0).then(function (h0) {
      return Crypto.keypairFromPrivateHex(h0);
    }).then(function (k0) {
      out.owner = { wif: k0.wif, pub: k0.pub };
      return Crypto.brainPrivateKeyHex(norm, 1);
    }).then(function (h1) {
      return Crypto.keypairFromPrivateHex(h1);
    }).then(function (k1) {
      out.active = { wif: k1.wif, pub: k1.pub };
      return Crypto.brainPrivateKeyHex(norm, 2);
    }).then(function (h2) {
      return Crypto.keypairFromPrivateHex(h2);
    }).then(function (k2) {
      out.memo = { wif: k2.wif, pub: k2.pub };
      return out;
    });
  }

  /* Store plaintext in memory only and (re)arm the inactivity lock timer. */
  function _setUnlocked(plain) {
    _data = plain;
    api.keys = plain.keys;
    _armLock();
  }

  /* (Re)start the 5-minute inactivity auto-lock timer. */
  function _armLock() {
    if (_lockTimer) { try { clearTimeout(_lockTimer); } catch (e) {} _lockTimer = null; }
    _lockTimer = setTimeout(function () { lock(); }, LOCK_MS);
  }

  /* Create + persist a wallet from a brainkey. Resolves to Wallet.keys when unlocked.
   * Params: password non-empty string; brainkey raw string (>=50 chars post-normalize).
   * Fails: bad password/brainkey input, short brainkey, missing Crypto, save failure. */
  async function create(password, brainkey) {
    if (typeof password !== "string" || password.length === 0) {
      throw new Error("password required: expected a non-empty string");
    }
    if (typeof Crypto === "undefined" || !Crypto.normalizeBrainkey) {
      throw new Error("crypto backend missing: Crypto global unavailable");
    }
    var norm = Crypto.normalizeBrainkey(brainkey);
    _checkBrainkeyLen(norm);
    var keys = await _deriveFreshKeys(norm);
    var plain = { brainkey: norm, keys: keys, created: new Date().toISOString() };
    var env = await _encryptPlain(password, plain);
    try {
      await _store().setItem(LS_KEY, JSON.stringify(env));
    } catch (e) {
      throw new Error("wallet save failed: " + (e && e.message ? e.message : String(e)));
    }
    _setUnlocked(plain);
    return api.keys;
  }

  /* Decrypt the stored wallet into memory only. Resolves to Wallet.keys.
   * Params: password string. Rate-limited: each consecutive failure waits
   *   0,1,2,4,8…s (cap 30s) before deriving, and persists a lockout stamp;
   *   success resets both. Fails: locked-out, no wallet, corrupt envelope,
   *   wrong password. */
  async function unlock(password) {
    if (typeof password !== "string" || password.length === 0) {
      throw new Error("password required: expected a non-empty string");
    }
    try {
      var stamp = await _store().getItem(LOCKOUT_KEY);
      var until = parseInt(stamp, 10);
      if (isFinite(until) && until > Date.now()) {
        throw new Error("locked out: try again in " + Math.ceil((until - Date.now()) / 1000) + "s");
      }
    } catch (e) {
      if (e && e.message && e.message.indexOf("locked out") === 0) throw e;
      /* unreadable stamp: in-memory count still enforced below */
    }
    if (_failCount > 0) {
      var waitMs = Math.min(30000, 1000 * Math.pow(2, _failCount - 1));
      await new Promise(function (res) { setTimeout(res, waitMs); });
    }
    var env = await _readEnvelope();
    try {
      var plain = await _decryptPlain(password, env);
      _failCount = 0;
      try { await _store().setItem(LOCKOUT_KEY, "0"); } catch (e) { /* stamp best-effort */ }
      _setUnlocked(plain);
      return api.keys;
    } catch (e) {
      _failCount++;
      var waitMs2 = Math.min(30000, 1000 * Math.pow(2, _failCount - 1));
      try { await _store().setItem(LOCKOUT_KEY, String(Date.now() + waitMs2)); } catch (x) { /* stamp best-effort */ }
      throw e;
    }
  }

  /* Best-effort zero of key material (strings immutable in JS: overwrite refs
   * with zeros before nulling), clear timer, notify the onLock callback once. */
  function lock() {
    var wasUnlocked = !!_data;
    if (_lockTimer) { try { clearTimeout(_lockTimer); } catch (e) {} _lockTimer = null; }
    if (_data) {
      try {
        var roles = ["owner", "active", "memo"];
        var i, r;
        for (i = 0; i < roles.length; i++) {
          r = _data.keys && _data.keys[roles[i]];
          if (r) {
            if (typeof r.wif === "string") r.wif = "0".repeat(r.wif.length);
            if (typeof r.pub === "string") r.pub = "0".repeat(r.pub.length);
          }
        }
        if (typeof _data.brainkey === "string") _data.brainkey = "0".repeat(_data.brainkey.length);
      } catch (e) {}
    }
    _data = null;
    api.keys = null;
    if (wasUnlocked && typeof _onLock === "function") {
      try { _onLock(); } catch (e) {}
    }
  }

  /* True when decrypted key material is present in memory. */
  function isUnlocked() {
    return _data !== null;
  }

  /* Return the in-memory brainkey (backup screen). Throws when locked. */
  function getBrainkey() {
    if (!_data) throw new Error("wallet locked: unlock first");
    touch();
    return _data.brainkey;
  }

  /* Verify a brainkey against the chain (seq0..9 look-ahead), then create().
   * Params: brainkey raw string, password non-empty string.
   * Fails: short brainkey, chain unavailable, bad chain response, no-chain-keys. */
  async function importBrainkey(brainkey, password) {
    if (typeof password !== "string" || password.length === 0) {
      throw new Error("password required: expected a non-empty string");
    }
    if (typeof Crypto === "undefined" || !Crypto.normalizeBrainkey) {
      throw new Error("crypto backend missing: Crypto global unavailable");
    }
    var norm = Crypto.normalizeBrainkey(brainkey);
    _checkBrainkeyLen(norm);
    if (typeof Chain === "undefined" || !Chain.db || !Chain.call) {
      throw new Error("chain not ready: Chain.db/call unavailable");
    }
    var pubs = [];
    var seq;
    for (seq = 0; seq <= 9; seq++) {
      var privHex = await Crypto.brainPrivateKeyHex(norm, seq);
      var kp = await Crypto.keypairFromPrivateHex(privHex);
      pubs.push(kp.pub);
    }
    var dbId = await Chain.db();
    var refs = await Chain.call(dbId, "get_key_references", [pubs]);
    if (!Array.isArray(refs)) throw new Error("chain error: unexpected get_key_references response");
    var found = false;
    var i;
    for (i = 0; i < refs.length; i++) {
      if (Array.isArray(refs[i]) && refs[i].length > 0) { found = true; break; }
    }
    if (!found) throw new Error("no-chain-keys");
    return create(password, norm);
  }

  /* Reset the inactivity auto-lock timer. No-op while locked. */
  function touch() {
    if (_data) _armLock();
  }

  /* Register the single lock callback invoked by lock(). Overwrites prior. */
  function onLock(fn) {
    if (typeof fn !== "function") throw new Error("onLock requires a function");
    _onLock = fn;
  }

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) lock();
    });
  }

  return api;
})();

if (typeof module !== "undefined") { module.exports = Wallet; }
