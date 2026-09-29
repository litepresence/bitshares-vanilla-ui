/* Extension storage adapter: backends for the vanilla storage seams.
 * Owns: NOTHING in the web build — loaded only by extension-wrapper dist
 *   pages (injected by tooling/pack-extension.sh ahead of wallet.js, any
 *   time before first create/unlock/boot).
 * Split on purpose (see vanilla/js/store.js header):
 *   - Wallet envelope + lockout stamp -> chrome.storage.local (persistent,
 *     async-capable {getItem,setItem}; secrets leave extension-origin
 *     localStorage entirely).
 *   - Store settings (nodes/theme/locale) -> extension-origin localStorage
 *     via Store.setBackend ({get,set,del} sync shape from the Part-A seam).
 *     Sync because 20+ call sites read settings synchronously at boot;
 *     safe because extension-origin storage is isolated from page origins
 *     and holds no secrets (proposal §1.1: non-sensitive, user-chosen).
 * Consumes: chrome.storage.local (Wallet side), localStorage (Store side),
 *   Wallet.setBackend + Store.setBackend (vanilla seams).
 * Globals/side effects: setBackend calls on injection only.
 * Patterns (not code) from #3 pi314x envelope-in-chrome.storage.local +
 *   session-unlock properties (proposal §2.2); written fresh here — nothing
 *   copied from reference/wallet-extension/.
 * Created by: extension-wrapper plan (v1 Tier 1). */
(function () {
  "use strict";

  /* backend: promise-based {getItem, setItem} over extension storage.
   * Namespace compat: `browser` (Firefox/Safari) or `chrome` (Chromium).
   * Missing storage API -> throws loudly at injection time. */
  function chromeBackend() {
    var ns = (typeof browser !== "undefined" && browser && browser.storage) ? browser
      : (typeof chrome !== "undefined" && chrome && chrome.storage) ? chrome : null;
    var store = (ns && ns.storage && ns.storage.local) || null;
    if (!store) throw new Error("extension storage unavailable: storage.local missing");
    var rt = (ns && ns.runtime) || null;
    return {
      getItem: function (k) {
        return new Promise(function (resolve, reject) {
          try {
            store.get([k], function (items) {
              try {
                if (rt && rt.lastError) { reject(new Error(rt.lastError.message)); return; }
                var v = items ? items[k] : undefined;
                resolve(v === undefined ? null : String(v));
              } catch (e) { reject(e); }
            });
          } catch (e) { reject(e); }
        });
      },
      setItem: function (k, v) {
        return new Promise(function (resolve, reject) {
          try {
            var o = {};
            o[k] = String(v);
            store.set(o, function () {
              try {
                if (rt && rt.lastError) { reject(new Error(rt.lastError.message)); return; }
                resolve();
              } catch (e) { reject(e); }
            });
          } catch (e) { reject(e); }
        });
      }
    };
  }

  /* Inject before first wallet use (dist index.html guarantees order). No-op
   * without the extension namespaces (adapter file simply never ships to
   * web). Wallet injection needs chrome.storage; Store injection only needs
   * extension-origin localStorage, so each is attempted independently. */
  try {
    if (typeof Wallet !== "undefined" && Wallet && typeof Wallet.setBackend === "function") {
      Wallet.setBackend(chromeBackend());
    }
  } catch (e) {
    /* WebCrypto-gated wallet screens surface storage errors at use time. */
  }
  try {
    if (typeof Store !== "undefined" && Store && typeof Store.setBackend === "function") {
      Store.setBackend({
        get: function (k) {
          try {
            if (typeof localStorage === "undefined") return null;
            var raw = localStorage.getItem(k);
            return (raw === undefined) ? null : raw;
          } catch (e) { return null; }
        },
        set: function (k, v) {
          try {
            if (typeof localStorage === "undefined") return;
            localStorage.setItem(k, String(v));
          } catch (e) { /* blocked/full: in-memory value still emits */ }
        },
        del: function (k) {
          try {
            if (typeof localStorage === "undefined") return;
            localStorage.removeItem(k);
          } catch (e) { /* best-effort */ }
        }
      });
    }
  } catch (e) {
    /* Settings fall back to the web default backend (same shape, same keys). */
  }
})();
