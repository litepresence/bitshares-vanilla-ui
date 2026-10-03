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

  /* Tier 2 message protocol (P1). Page -> content relay -> SW envelope:
   *   {type, id, payload} where type is one of REQ_* below; SW replies
   *   {id, ok:true, payload} or {id, ok:false, error}. The content relay
   *   attaches `origin` from the platform-provided postMessage event origin
   *   (unforgeable); SW prefers sender.tab.url when present and MUST ignore
   *   any page-claimed origin field. Wallet-self requests (vanilla P5 seam)
   *   carry origin WALLET_SELF and always prompt (never allowlisted). */
  var REQ_CHAIN_ID = "vb-get-chain-id";
  var REQ_ACCOUNT = "vb-get-account";
  var REQ_SIGN = "vb-request-signature";
  var WALLET_SELF = "wallet-self";

  /* isValidUnsignedTx: shape gate for signing payloads. Params: tx unknown.
   * Returns true only for {operations: [[id, body], ...non-empty],
   * expiration: string, signatures: []|missing}. No crypto, no chain —
   * pure shape so malformed dApp payloads die before an approval opens.
   * Fails: never throws (non-conforming input is false, deny by default). */
  function isValidUnsignedTx(tx) {
    try {
      if (!tx || typeof tx !== "object" || Array.isArray(tx)) return false;
      var ops = tx.operations;
      if (!Array.isArray(ops) || !ops.length) return false;
      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        if (!Array.isArray(op) || op.length !== 2) return false;
        if (typeof op[0] !== "number" || !(isFinite(op[0])) || op[0] < 0) return false;
        if (!op[1] || typeof op[1] !== "object") return false;
      }
      if (typeof tx.expiration !== "string" || !tx.expiration) return false;
      if (tx.signatures !== undefined && tx.signatures !== null) {
        if (!Array.isArray(tx.signatures) || tx.signatures.length) return false;
      }
      return true;
    } catch (e) { return false; }
  }

  /* Rate-limit state shape (persisted by the SW in session storage so SW
   * restarts fail closed instead of resetting budgets):
   *   { "<origin>": { windowStart: <ms epoch>, count: <int> } }.
   * checkRateLimit: at most MAX_PER_WINDOW requests per origin per
   * WINDOW_MS (sliding from first-seen). Params: state (object, may be
   * null), origin string, nowMs number. Returns {allow: bool, state} with
   * an updated copy (inputs never mutated). Fails: never throws — unusable
   * inputs deny. */
  var RATE_WINDOW_MS = 60000;
  var RATE_MAX_PER_WINDOW = 5;
  function checkRateLimit(state, origin, nowMs) {
    try {
      var st = {};
      if (state && typeof state === "object" && !Array.isArray(state)) {
        var keys = Object.keys(state);
        for (var k = 0; k < keys.length; k++) {
          var e = state[keys[k]];
          if (e && typeof e === "object" &&
              typeof e.windowStart === "number" && typeof e.count === "number") {
            st[keys[k]] = { windowStart: e.windowStart, count: e.count };
          }
        }
      }
      if (typeof origin !== "string" || !origin ||
          typeof nowMs !== "number" || !isFinite(nowMs)) {
        return { allow: false, state: st };
      }
      var cur = st[origin];
      if (!cur || (nowMs - cur.windowStart) >= RATE_WINDOW_MS) {
        st[origin] = { windowStart: nowMs, count: 1 };
        return { allow: true, state: st };
      }
      if (cur.count >= RATE_MAX_PER_WINDOW) return { allow: false, state: st };
      st[origin] = { windowStart: cur.windowStart, count: cur.count + 1 };
      return { allow: true, state: st };
    } catch (e) { return { allow: false, state: {} }; }
  }

  var Bridge = {
    APPROVAL_TIMEOUT_MS: APPROVAL_TIMEOUT_MS,
    isHttpsOrigin: isHttpsOrigin,
    checkChainId: checkChainId,
    isAccountAllowed: isAccountAllowed,
    validateRequest: validateRequest,
    signMessage: signMessage,
    REQ_CHAIN_ID: REQ_CHAIN_ID,
    REQ_ACCOUNT: REQ_ACCOUNT,
    REQ_SIGN: REQ_SIGN,
    WALLET_SELF: WALLET_SELF,
    RATE_WINDOW_MS: RATE_WINDOW_MS,
    RATE_MAX_PER_WINDOW: RATE_MAX_PER_WINDOW,
    isValidUnsignedTx: isValidUnsignedTx,
    checkRateLimit: checkRateLimit
  };

  if (typeof globalThis !== "undefined" && typeof globalThis.Bridge === "undefined") { globalThis.Bridge = Bridge; }
  if (typeof module !== "undefined") { module.exports = Bridge; }
})();
