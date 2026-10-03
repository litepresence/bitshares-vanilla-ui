/* SignMode: signing-route resolution for the Tier 2 wallet-as-dApp seam.
 * Owns: capability detection (extension page vs provider vs none),
 *   effective-mode resolution from the Store signing pin (auto default),
 *   display-account extraction (first 1.2.x in the unsigned tx — display
 *   only; the SW binds nothing for wallet-self, which always prompts), and
 *   wallet-originated signature requests (direct runtime message from
 *   extension pages, provider.requestSignature from web pages, with
 *   MV3-safe intent polling shared with content/inpage.js pollIntent —
 *   duplicated 15 lines across the trust boundary on purpose, cited here).
 *   No user strings (edge errors are technical English surfaced through
 *   existing panel fallbacks); no storage writes (reads Store only).
 * Consumes: Store.loadSettings (signing pin), Chain.status (page chainId
 *   for provider requests), chrome.runtime (extension pages),
 *   window.bitsharesWallet (web pages, Tier 2 provider). Side effects:
 *   outbound runtime/provider messages only. Global SignMode (+ node
 *   export for tests). No DOM.
 * Created by: extension Tier 2 build (P5 batch).
 */
var SignMode = (function () {
  "use strict";

  /* capable: 'extension-page' (direct runtime channel, no provider object
   * needed), 'provider' (web page with the injected provider), or 'none'.
   * Never throws. */
  function capable() {
    try {
      var proto = "";
      try {
        if (typeof location !== "undefined" && location.protocol) proto = String(location.protocol);
      } catch (e) { proto = ""; }
      if (proto === "chrome-extension:" || proto === "moz-extension:") {
        if (typeof chrome !== "undefined" && chrome && chrome.runtime &&
            typeof chrome.runtime.sendMessage === "function") return "extension-page";
        try {
          if (typeof browser !== "undefined" && browser && browser.runtime &&
              typeof browser.runtime.sendMessage === "function") return "extension-page";
        } catch (e) { /* fall through */ }
      }
      if (typeof window !== "undefined" && window) {
        var prov = null;
        try { prov = /** @type {any} */ (window).bitsharesWallet; } catch (e) { prov = null; }
        if (prov && prov.isBitsharesWallet === true) return "provider";
      }
    } catch (e) { /* none below */ }
    return "none";
  }

  /* signingPin: stored override ("auto"|"extension"|"browser", default
   * auto). Unknown values read as auto (fail toward the default, never
   * toward a forced route). Never throws. */
  function signingPin() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.signing === "extension" || s.signing === "browser" || s.signing === "auto")) {
          return s.signing;
        }
      }
    } catch (e) { /* auto below */ }
    return "auto";
  }

  /* effectiveMode: 'extension' only when pinned-or-auto AND a channel
   * exists; otherwise 'browser' (today's in-page path, byte-identical).
   * Never throws. */
  function effectiveMode() {
    try {
      var pin = signingPin();
      if (pin === "browser") return "browser";
      var cap = capable();
      if (cap === "none") return "browser";
      if (pin === "extension") return "extension";
      return "extension"; /* auto + channel present */
    } catch (e) { return "browser"; }
  }

  /* firstAccountId: first whole-value 1.2.x in the unsigned tx (display
   * only — wallet-self binds nothing; dApp accountId comes from the dApp
   * and is validated SW-side). Returns "" when none. Never throws. */
  function firstAccountId(unsigned) {
    try {
      var found = "";
      (function walk(v) {
        if (found) return;
        if (typeof v === "string") {
          if (/^1\.2\.\d+$/.test(v)) found = v;
          return;
        }
        if (!v || typeof v !== "object") return;
        if (Array.isArray(v)) {
          for (var i = 0; i < v.length && !found; i++) walk(v[i]);
          return;
        }
        var ks = Object.keys(v);
        for (var k = 0; k < ks.length && !found; k++) walk(v[ks[k]]);
      })((unsigned && unsigned.operations) || []);
      return found;
    } catch (e) { return ""; }
  }

  /* sendDirect: extension-page runtime round-trip. Never throws sync. */
  function sendDirect(msg) {
    return new Promise(function (resolve, reject) {
      var rt = null;
      try {
        if (typeof chrome !== "undefined" && chrome && chrome.runtime &&
            typeof chrome.runtime.sendMessage === "function") rt = chrome.runtime;
        else if (typeof browser !== "undefined" && browser && browser.runtime &&
            typeof browser.runtime.sendMessage === "function") rt = browser.runtime;
      } catch (e) { rt = null; }
      if (!rt) { reject(new Error("extension runtime missing")); return; }
      try {
        rt.sendMessage(msg, function (reply) {
          try {
            var le = null;
            try {
              var ns = (typeof chrome !== "undefined" && chrome) ||
                (typeof browser !== "undefined" && browser);
              if (ns && ns.runtime && ns.runtime.lastError) le = ns.runtime.lastError;
            } catch (e) {}
            if (le && le.message) { reject(new Error(le.message)); return; }
          } catch (e) { /* reply below */ }
          if (!reply || typeof reply !== "object") { reject(new Error("no reply from signer")); return; }
          if (reply.ok) resolve(reply.payload === undefined ? null : reply.payload);
          else reject(new Error((reply.error && String(reply.error)) || "request denied"));
        });
      } catch (e) { reject(e); }
    });
  }

  /* pollIntent: MV3-safe proof wait (duplicate of the inpage.js poller —
   * shared file impossible across the page/extension trust boundary).
   * sendFn(type, payload) abstracts direct vs provider transport. */
  function pollIntent(sendFn, intentId) {
    var tries = 0;
    return new Promise(function (resolve, reject) {
      function tick() {
        tries++;
        sendFn("vb-intent-status", { intentId: intentId }).then(function (st) {
          if (!st || typeof st.status !== "string") throw new Error("bad intent status");
          if (st.status === "approved") { resolve(st.proof || { intentId: intentId }); return; }
          if (st.status === "denied") {
            reject(new Error(st.error ? String(st.error) : "request denied"));
            return;
          }
          if (tries >= 45) { reject(new Error("approval timeout: no decision in 90s")); return; }
          setTimeout(tick, 2000);
        }).catch(reject);
      }
      tick();
    });
  }

  /* requestWalletSignature: wallet-originated approval (always prompts —
   * wallet-self is never allowlisted). Params: unsigned (shape-gated
   * SW-side), label (short human context, optional). Resolves the SW proof
   * {via, headBefore, intentId, signedTx}. Rejects verbatim. */
  function requestWalletSignature(unsigned, label) {
    var cap = capable();
    if (cap === "none") return Promise.reject(new Error("extension signing unavailable"));
    var accountId = firstAccountId(unsigned);
    if (cap === "extension-page") {
      return sendDirect({ type: "vb-wallet-sign",
        payload: { unsigned: unsigned, accountId: accountId, label: label || "" } })
        .then(function (r) {
          if (!r || typeof r.intentId !== "string" || !r.intentId) throw new Error("bad sign request reply");
          return pollIntent(sendDirect, r.intentId);
        });
    }
    /* Web page via the injected provider (dApp path with wallet label —
     * SW still always prompts for signing; binding follows page origin). */
    var chainId = null;
    try {
      if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
        var st = Chain.status();
        if (st && typeof st.chainId === "string") chainId = st.chainId;
      }
    } catch (e) { chainId = null; }
    var p = null;
    try { p = /** @type {any} */ (window).bitsharesWallet; } catch (e) { p = null; }
    if (!p || typeof p.requestSignature !== "function") {
      return Promise.reject(new Error("extension signing unavailable"));
    }
    return p.requestSignature({ unsigned: unsigned, accountId: accountId,
      chainId: chainId, label: label || "This wallet" });
  }

  return {
    capable: capable,
    signingPin: signingPin,
    effectiveMode: effectiveMode,
    firstAccountId: firstAccountId,
    requestWalletSignature: requestWalletSignature
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.SignMode === "undefined") { globalThis.SignMode = SignMode; }
if (typeof module !== "undefined") { module.exports = SignMode; }
