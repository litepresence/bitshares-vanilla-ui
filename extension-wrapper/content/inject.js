/* Content-script provider: isolated-world window.bitsharesWallet (Tier 1 scaffold).
 * Owns: NOTHING secret — a message-only bridge between untrusted page JS and
 *   the extension service worker. Page scripts can only postMessage; they can
 *   never read keys, the envelope, or session state (this file touches no
 *   storage API, no Wallet, no crypto — zero key access by construction).
 * Consumes: window.postMessage (page side), chrome/browser.runtime (SW side).
 *   Side effects: defines window.bitsharesWallet in the isolated world only.
 * Patterns (not code) from #3 pi314x inpage provider + background approval
 *   flow (proposal §2.2: HTTPS-only, 60s timeout, allowedAccountIds binding);
 *   written fresh here — nothing copied from reference/wallet-extension/.
 *   Tier 1 ships the surface UNWIRED (methods reject with "not yet wired —
 *   Tier 2"); see adapter/bridge.js for the validation shape and
 *   TEST-PLAN.md for the human install/approval drills. No Beet-compat
 *   surface (proposal §3.3 non-goal). Created by: extension-wrapper Tier 1. */
(function () {
  "use strict";

  /* Namespace compat: Firefox/Safari expose `browser`, Chromium `chrome`. */
  var ext = (typeof browser !== "undefined" && browser) ||
    (typeof chrome !== "undefined" && chrome) || null;

  /* Request ids Sharp enough for concurrent page calls (monotonic + random). */
  var _seq = 0;

  /* Forward one provider call to the service worker with a 60s approval
   * timeout (proposal §2.2 discipline). Resolves with the SW reply payload,
   * rejects on timeout / missing runtime / SW-side denial. Never throws sync. */
  function _callSW(type, payload) {
    return new Promise(function (resolve, reject) {
      if (!ext || !ext.runtime || typeof ext.runtime.sendMessage !== "function") {
        reject(new Error("bitsharesWallet unavailable: extension runtime missing"));
        return;
      }
      var id = "vb-" + (++_seq) + "-" + Math.floor(Math.random() * 1e9).toString(36);
      var timer = setTimeout(function () {
        reject(new Error("approval timeout: no response in 60s"));
      }, 60000);
      try {
        ext.runtime.sendMessage({ type: type, id: id, payload: payload || null }, function (reply) {
          try { clearTimeout(timer); } catch (e) {}
          try {
            if (ext.runtime && ext.runtime.lastError) {
              reject(new Error(ext.runtime.lastError.message || "extension error"));
              return;
            }
          } catch (e) {}
          if (!reply || typeof reply !== "object" || reply.id !== id) {
            reject(new Error("approval failed: bad reply"));
            return;
          }
          if (reply.ok) resolve(reply.payload === undefined ? null : reply.payload);
          else reject(new Error((reply.error && String(reply.error)) || "request denied"));
        });
      } catch (e) {
        try { clearTimeout(timer); } catch (x) {}
        reject(e);
      }
    });
  }

  /* Tier 1 surface. All signing-adjacent methods reject until the Tier 2
   * gate wires them (bridge.js + sw.js approval page). Read-only helpers
   * that need no approval may land here first; each documents its trust. */
  function notWired(name) {
    return function () {
      return Promise.reject(new Error(name + " not yet wired: Tier 2 signing gate (see TEST-PLAN.md)"));
    };
  }

  /* getChainId: pure read of the wallet's active network id. Served from the
   * extension page state (never the dApp's claim) once wired; Tier 1 stub. */
  var provider = {
    isBitsharesWallet: true,
    getChainId: notWired("getChainId"),
    requestSignature: notWired("requestSignature"),
    getAccount: notWired("getAccount")
  };

  /* signMessage stays UNIMPLEMENTED on purpose (proposal §2.2 / bridge.js):
   * blind-signing a digest is how approvals get spoofed. A named function
   * (not a silent absence) so page code gets a loud, honest refusal. */
  provider.signMessage = function () {
    return Promise.reject(new Error("signMessage unimplemented: blind-digest signing is refused by design"));
  };

  /* Expose in the isolated world only. Page JS sees the object but shares no
   * JS heap with it (platform guarantee) — and this closure holds no keys. */
  try {
    if (typeof window !== "undefined" && !window.bitsharesWallet) {
      window.bitsharesWallet = provider;
    }
  } catch (e) { /* page CSP edge: provider simply absent, never half-built */ }

  void _callSW;
})();
