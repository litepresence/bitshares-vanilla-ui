/* Extension storage adapter: chrome.storage backend for the Wallet seam.
 * Owns: NOTHING in the web build — loaded only by extension-wrapper/app.html
 *   (injected by tooling/pack-extension.sh ahead of wallet.js consumers, any
 *   time before first create/unlock). Envelope -> chrome.storage.local
 *   (persistent); lockout stamp rides the same backend (Wallet persists it).
 * Consumes: chrome.storage.local, Wallet.setBackend (vanilla seam).
 * Globals/side effects: none at load; setBackend on injection.
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

  /* Inject before first wallet use (app.html guarantees order). No-op
   * without chrome (adapter file simply never ships to web). */
  try {
    if (typeof Wallet !== "undefined" && Wallet && typeof Wallet.setBackend === "function") {
      Wallet.setBackend(chromeBackend());
    }
  } catch (e) {
    /* WebCrypto-gated wallet screens surface storage errors at use time. */
  }
})();
