/* In-page provider: window.bitsharesWallet, Tier 2 (P4).
 * Runs in the PAGE world (injected by content/inject.js as a file, never
 * inline — page CSPs may block inline scripts; a file from the extension
 * origin is the most-permissive honest route, and strict-CSP pages simply
 * get no provider rather than a half-built one). Talks to the isolated
 * relay ONLY via window.postMessage (marker vbBridge); shares no heap
 * with it and holds no keys — every signing-adjacent call resolves in the
 * SW after human approval, or rejects loudly.
 * Message shape page->relay: {vbBridge:true, dir:"req", id, type, payload}.
 * Relay->page: {vbBridge:true, dir:"res", id, ok, payload, error}.
 * signMessage stays UNIMPLEMENTED on purpose (bridge.js: blind-digest
 * signing is how approvals get spoofed — loud refusal, never absence).
 * No Beet-compat surface (proposal §3.3 non-goal).
 * Created by: extension Tier 2 build (P4 batch).
 */
(function () {
  "use strict";

  var APPROVAL_TIMEOUT_MS = 60000;
  var _seq = 0;
  var _pending = {};

  /* callRelay: one provider call through the isolated relay. Resolves with
   * the SW reply payload, rejects on timeout/denial/relay absence. */
  function callRelay(type, payload) {
    return new Promise(function (resolve, reject) {
      var id = "p-" + (++_seq) + "-" + Math.floor(Math.random() * 1e9).toString(36);
      var timer = setTimeout(function () {
        try { delete _pending[id]; } catch (e) {}
        reject(new Error("approval timeout: no response in 60s"));
      }, APPROVAL_TIMEOUT_MS);
      _pending[id] = { resolve: resolve, reject: reject, timer: timer };
      try {
        window.postMessage({ vbBridge: true, dir: "req", id: id, type: type,
          payload: payload === undefined ? null : payload }, "*");
      } catch (e) {
        try { clearTimeout(timer); } catch (x) {}
        try { delete _pending[id]; } catch (x) {}
        reject(e);
      }
    });
  }

  try {
    window.addEventListener("message", function (ev) {
      try {
        if (!ev || ev.source !== window) return;
        var d = ev.data;
        if (!d || d.vbBridge !== true || d.dir !== "res") return;
        var p = _pending[d.id];
        if (!p) return;
        try { delete _pending[d.id]; } catch (e) {}
        try { clearTimeout(p.timer); } catch (e) {}
        if (d.ok) p.resolve(d.payload === undefined ? null : d.payload);
        else p.reject(new Error((d.error && String(d.error)) || "request denied"));
      } catch (e) { /* relay best-effort */ }
    });
  } catch (e) { /* provider calls still attempt; relay absence rejects */ }

  /* getChainId: wallet's active chain id (wallet-side state, never the
   * dApp's claim — compare before building anything). No approval. */
  function getChainId() {
    return callRelay("vb-get-chain-id", null).then(function (r) {
      if (!r || typeof r.chainId !== "string" || !r.chainId) {
        throw new Error("bad chain id reply");
      }
      return r.chainId;
    });
  }

  /* getAccount: the account this origin is approved for (first binding),
   * or null when never approved. No approval prompt (read-only). */
  function getAccount() {
    return callRelay("vb-get-account", null).then(function (r) {
      var ids = r && Array.isArray(r.accountIds) ? r.accountIds : [];
      return ids.length ? ids[0] : null;
    });
  }

  /* requestSignature: full approval gate. Params: {unsigned, accountId,
   *   chainId (the dApp's claimed chain — SW verifies vs wallet active),
   *   label?}. Resolves the SW broadcast proof; rejects on deny/timeout/
   *   validation failure. */
  function requestSignature(req) {
    if (!req || typeof req !== "object") {
      return Promise.reject(new Error("requestSignature needs {unsigned, accountId, chainId}"));
    }
    return callRelay("vb-request-signature", {
      unsigned: req.unsigned || null,
      accountId: req.accountId || null,
      chainId: req.chainId || null,
      label: (typeof req.label === "string" && req.label) ? String(req.label).slice(0, 120) : ""
    });
  }

  /* signMessage: loud refusal (never silent absence). */
  function signMessage() {
    return Promise.reject(new Error("signMessage unimplemented: blind-digest signing is refused by design"));
  }

  try {
    if (typeof window !== "undefined" && !window.bitsharesWallet) {
      window.bitsharesWallet = {
        isBitsharesWallet: true,
        getChainId: getChainId,
        getAccount: getAccount,
        requestSignature: requestSignature,
        signMessage: signMessage
      };
    }
  } catch (e) { /* provider simply absent, never half-built */ }
})();
