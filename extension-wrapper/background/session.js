/* Session vault: Tier 2 key-intent storage (P2).
 * Owns: namespace-compat access to chrome.storage.session (memory-backed,
 *   survives SW restarts, dies with the browser — same as #3) with an
 *   in-memory fallback for MV2 background pages without the session API
 *   (MV2 pages are persistent, so memory is equivalent there); promise
 *   helpers for session + local areas; key names for session keys, intent
 *   journal, rate-limit budgets, and the persistent allowlist.
 * Consumes: chrome/browser.storage (session preferred, local for the
 *   allowlist). No DOM, no network, no wallet code, no crypto.
 * Secrets discipline: session keys are written ONLY by gate.js after an
 *   approval-scoped unlock and wiped by the lock path; this file never
 *   logs, never broadcasts, never persists keys outside the session area.
 * Globals/side effects: global SessionVault only (+ in-memory fallback
 *   map when the session API is absent); module.exports for node tests.
 * Created by: extension Tier 2 build (P1+P2 batch).
 */
(function () {
  "use strict";

  /* Storage key names (vb- prefix: vanilla bridge; stable across versions —
   * renaming orphans persisted allowlists, so never rename casually). */
  var K_KEYS = "vb-session-keys";
  var K_META = "vb-session-meta";
  var K_RATE = "vb-rate-budgets";
  var K_INTENTS = "vb-intents";
  var K_ALLOWLIST = "vb-allowlist-v1";

  /* In-memory fallback (MV2 background pages without storage.session —
   * persistent pages, so memory is equivalent; content never runs here). */
  var _mem = {};

  /* Extension namespace (browser vs chrome), or null outside extensions. */
  function ns() {
    try {
      if (typeof browser !== "undefined" && browser && browser.storage) return browser;
      if (typeof chrome !== "undefined" && chrome && chrome.storage) return chrome;
    } catch (e) { /* null below */ }
    return null;
  }

  /* Session area handle, or null when the API is absent (memory fallback). */
  function sessionArea() {
    try {
      var n = ns();
      if (n && n.storage && n.storage.session) return n.storage.session;
    } catch (e) { /* fallback below */ }
    return null;
  }

  /* Local area handle, or null. The allowlist requires persistence — when
   * local is absent the allowlist cannot be remembered (callers treat a
   * missing store as "no grants", i.e. prompt every time: fail safe). */
  function localArea() {
    try {
      var n = ns();
      if (n && n.storage && n.storage.local) return n.storage.local;
    } catch (e) { /* null below */ }
    return null;
  }

  /* lastError check helper: extension callbacks report via runtime.lastError,
   * never via throw. Returns an Error or null. */
  function lastErr() {
    try {
      var n = ns();
      if (n && n.runtime && n.runtime.lastError && n.runtime.lastError.message) {
        return new Error(String(n.runtime.lastError.message));
      }
    } catch (e) { /* no error below */ }
    return null;
  }

  /* sessionGet: read keys from the session area (memory fallback). Params:
   *   keys (array of strings). Resolves {[k]: value} (missing keys absent).
   *   Rejects only when the area errors. */
  function sessionGet(keys) {
    return new Promise(function (resolve, reject) {
      try {
        var area = sessionArea();
        if (!area) {
          var out = {};
          (Array.isArray(keys) ? keys : []).forEach(function (k) {
            if (Object.prototype.hasOwnProperty.call(_mem, k)) out[k] = _mem[k];
          });
          resolve(out);
          return;
        }
        area.get(Array.isArray(keys) ? keys : [], function (items) {
          var e = lastErr();
          if (e) { reject(e); return; }
          resolve(items || {});
        });
      } catch (e) { reject(e); }
    });
  }

  /* sessionSet: write an object into the session area (memory fallback).
   * Resolves true. Rejects on area errors. */
  function sessionSet(obj) {
    return new Promise(function (resolve, reject) {
      try {
        var area = sessionArea();
        if (!area) {
          var ks = (obj && typeof obj === "object") ? Object.keys(obj) : [];
          ks.forEach(function (k) { _mem[k] = obj[k]; });
          resolve(true);
          return;
        }
        area.set(obj || {}, function () {
          var e = lastErr();
          if (e) { reject(e); return; }
          resolve(true);
        });
      } catch (e) { reject(e); }
    });
  }

  /* sessionRemove: delete keys from the session area (memory fallback).
   * Resolves true. Never rejects for missing keys. */
  function sessionRemove(keys) {
    return new Promise(function (resolve) {
      try {
        var list = Array.isArray(keys) ? keys : [];
        var area = sessionArea();
        if (!area) {
          list.forEach(function (k) { try { delete _mem[k]; } catch (e) {} });
          resolve(true);
          return;
        }
        area.remove(list, function () { resolve(true); });
      } catch (e) { resolve(true); }
    });
  }

  /* localGet/localSet: persistent area (allowlist home). localSet merges
   * are the caller's job (read-modify-write here races across restarts —
   * gate.js serializes allowlist writes through its intent flow). */
  function localGet(keys) {
    return new Promise(function (resolve, reject) {
      try {
        var area = localArea();
        if (!area) { reject(new Error("persistent storage unavailable")); return; }
        area.get(Array.isArray(keys) ? keys : [], function (items) {
          var e = lastErr();
          if (e) { reject(e); return; }
          resolve(items || {});
        });
      } catch (e) { reject(e); }
    });
  }

  function localSet(obj) {
    return new Promise(function (resolve, reject) {
      try {
        var area = localArea();
        if (!area) { reject(new Error("persistent storage unavailable")); return; }
        area.set(obj || {}, function () {
          var e = lastErr();
          if (e) { reject(e); return; }
          resolve(true);
        });
      } catch (e) { reject(e); }
    });
  }

  var SessionVault = {
    K_KEYS: K_KEYS,
    K_META: K_META,
    K_RATE: K_RATE,
    K_INTENTS: K_INTENTS,
    K_ALLOWLIST: K_ALLOWLIST,
    sessionGet: sessionGet,
    sessionSet: sessionSet,
    sessionRemove: sessionRemove,
    localGet: localGet,
    localSet: localSet
  };

  if (typeof globalThis !== "undefined" && typeof globalThis.SessionVault === "undefined") { globalThis.SessionVault = SessionVault; }
  if (typeof module !== "undefined") { module.exports = SessionVault; }
})();
