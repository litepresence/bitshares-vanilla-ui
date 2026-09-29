/* Approval-bridge validation: page<->SW message discipline (Tier 1 scaffold).
 * Owns: pure validators + allowlist shape for the Tier 2 signing gate. No
 *   chrome APIs, no DOM, no storage, no crypto — dependency-free so the same
 *   file can load in the content script, the SW, and the approval page.
 * Consumes: nothing (pure functions + JSON-shaped messages).
 * Patterns (not code) from #3 pi314x service-worker approval flow (proposal
 *   §2.2: HTTPS-only origins, chain_id verification, 60s approval timeout,
 *   per-origin rate limits, allowedAccountIds binding); written fresh here —
 *   nothing copied from reference/wallet-extension/.
 * Tier 1 status: validators SHIP but nothing calls them yet (the gate is
 *   Tier 2 follow-up; sw.js keeps the in-page signing model). Wiring them is
 *   the Tier 2 task, acceptance per TEST-PLAN.md. Created by: Tier 1. */
(function () {
  "use strict";

  /* 60s approval timeout: every signing request dies unless the user
   * approves in the extension page within one minute (proposal §2.2). */
  var APPROVAL_TIMEOUT_MS = 60000;

  /* isHttpsOrigin: only secure origins may request anything. Params: origin
   *   string (e.g. "https://example.com"). Returns true only for https: (and
   *   localhost http for dev — never shipped, tested manually). Fails: never
   *   throws — non-strings and parse failures return false (deny by default). */
  function isHttpsOrigin(origin) {
    try {
      if (typeof origin !== "string" || !origin) return false;
      if (origin === "http://localhost" || origin.indexOf("http://localhost:") === 0 ||
        origin === "http://127.0.0.1" || origin.indexOf("http://127.0.0.1:") === 0) return true;
      return origin.indexOf("https://") === 0;
    } catch (e) { return false; }
  }

  /* checkChainId: the dApp's claimed chain must equal the wallet's active
   * chain (proposal §2.2 — stops testnet/mainnet confusion attacks).
   * Params: claimed, active (hex strings). Returns true on exact match.
   * Fails: never throws — anything non-string is a mismatch. */
  function checkChainId(claimed, active) {
    try {
      if (typeof claimed !== "string" || typeof active !== "string") return false;
      if (!claimed || !active) return false;
      return claimed.toLowerCase() === active.toLowerCase();
    } catch (e) { return false; }
  }

  /* Allowlist shape (persisted by Tier 2, documented here so Tier 1 zips the
   * contract): { "<origin>": { allowedAccountIds: ["1.2.x", ...],
   *   lastApproved: <ms epoch> } }. A site approved for A can never sign as
   *   B: every request's account id must be in that origin's binding. */
  function isAccountAllowed(allowlist, origin, accountId) {
    try {
      if (!allowlist || typeof allowlist !== "object") return false;
      var entry = allowlist[origin];
      if (!entry || !Array.isArray(entry.allowedAccountIds)) return false;
      return entry.allowedAccountIds.indexOf(accountId) !== -1;
    } catch (e) { return false; }
  }

  /* validateRequest: the full Tier 2 gate in one call. Params: msg
   *   {origin, chainId, accountId}, ctx {activeChainId, allowlist}.
   *   Returns {ok:true} or {ok:false, reason}. Fails: never throws. */
  function validateRequest(msg, ctx) {
    try {
      if (!msg || typeof msg !== "object") return { ok: false, reason: "bad message shape" };
      if (!ctx || typeof ctx !== "object") return { ok: false, reason: "gate misconfigured" };
      if (!isHttpsOrigin(msg.origin)) return { ok: false, reason: "origin not https" };
      if (!checkChainId(msg.chainId, ctx.activeChainId)) return { ok: false, reason: "chain_id mismatch" };
      if (typeof msg.accountId !== "string" || !msg.accountId) return { ok: false, reason: "missing account" };
      if (!isAccountAllowed(ctx.allowlist, msg.origin, msg.accountId)) {
        return { ok: false, reason: "account not approved for origin" };
      }
      return { ok: true };
    } catch (e) { return { ok: false, reason: "validator error" }; }
  }

  /* signMessage: deliberately UNIMPLEMENTED (proposal §2.2). Blind-signing a
   * digest lets a dApp smuggle a transaction hash past the human-readable
   * confirm dialog — the exact accident our per-op wording spec exists to
   * prevent. Loud refusal, never silent absence. */
  function signMessage() {
    throw new Error("signMessage unimplemented: blind-digest signing is refused by design");
  }

  var Bridge = {
    APPROVAL_TIMEOUT_MS: APPROVAL_TIMEOUT_MS,
    isHttpsOrigin: isHttpsOrigin,
    checkChainId: checkChainId,
    isAccountAllowed: isAccountAllowed,
    validateRequest: validateRequest,
    signMessage: signMessage
  };

  if (typeof globalThis !== "undefined" && typeof globalThis.Bridge === "undefined") { globalThis.Bridge = Bridge; }
  if (typeof module !== "undefined") { module.exports = Bridge; }
})();
