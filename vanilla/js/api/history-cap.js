/* HistoryCap: history/ES capability gates for every history-powered view.
 * Owns: the canonical ES_BASE (single source — views never hardcode hosts),
 *   the per-node history matrix (vendored sweep snapshot + live probe
 *   refresh), the esEnabled pref read, and the ONLY browser-side raw-ES
 *   fetch seam (esSearch). No WS of its own: WS history goes through Chain.
 * Consumes: Chain.hasHistory (active socket), Store.loadSettings (esEnabled).
 *   Side effects: in-memory live matrix + last-ES-result cache (never
 *   persisted — capability is re-probed, not remembered across sessions).
 * Created by: Phase-1 history/ES plan (probe sweep
 *   tooling/history-capabilities-2026-10-02.json, CORS preflight GO for
 *   es.bitshares.dev / NO-GO for kibana.bitshares.dev).
 * NOTE (migration): market-fills-history.js + pool-history.js still carry
 *   their own ES_URL + fetch (pre-Phase-1); they migrate to esSearch in
 *   Phase 4 (market-history UI) — no new direct ES fetches meanwhile. */
var HistoryCap = (function () {
  "use strict";

  /* ES_BASE: the ONLY raw-ES host the app may fetch. Canonical source is
   * the help directory (help-ui.js link "help.link_es_api" — same URL).
   * kibana.bitshares.dev is deliberately absent: it is a UI shell with no
   * CORS headers (preflight NO-GO) — linked from help, never fetched. */
  var ES_BASE = "https://es.bitshares.dev";

  /* ES_INDEXES: allowlist for esSearch (index goes into the URL path, so
   * arbitrary strings would be request forgery, not a query). The two
   * indexes astro-ui uses against this host (esquery.ts): bitshares-*
   * (operations) and objects-balance (balances/holders). */
  var ES_INDEXES = ["bitshares-*", "objects-balance"];

  /* HIST_SNAPSHOT: vendored fallback matrix from the 2026-10-02 probe sweep
   * (tooling/history-capabilities-2026-10-02.json — 9/9 nodes served the
   * history api id). Dated on purpose: live probeAll refresh overwrites it
   * via update(); unknown URLs report null (unknown), never guessed true. */
  var HIST_SNAPSHOT = {
    date: "2026-10-02",
    urls: {
      "wss://api.bitshares.dev/ws": true,
      "wss://dex.iobanker.com/ws": true,
      "wss://node.xbts.io/ws": true,
      "wss://public.xbts.io/ws": true,
      "wss://cloud.xbts.io/ws": true,
      "wss://api.bts.mobi/ws": true,
      "wss://api.dex.trading/ws": true,
      "wss://testnet.xbts.io/ws": true,
      "wss://testnet.dex.trading/": true
    }
  };

  /* Live matrix: url -> boolean, written by probeAll (Phase 3) via update().
   * Wins over the snapshot; never persisted (see header). */
  var live = {};
  /* Last ES result: {ok, t} or null (no attempt yet). esAvailable() reads it. */
  var esLast = null;

  /* update: record a live probe outcome. Params: url string, has boolean-ish.
   * Returns nothing. Fails: never (bad input ignored — a corrupt probe must
   * not poison the matrix). */
  function update(url, has) {
    try {
      if (typeof url !== "string" || !url) return;
      live[url] = (has === true);
    } catch (e) { /* matrix stands */ }
  }

  /* nodeHistory: known history state for a node URL. Params: url string.
   * Returns true/false, or null when neither live probe nor snapshot knows
   * it (custom nodes before their first probe). Sync on purpose — Settings
   * rows paint without awaiting. Never throws. */
  function nodeHistory(url) {
    try {
      if (typeof url !== "string" || !url) return null;
      if (Object.prototype.hasOwnProperty.call(live, url)) return live[url];
      if (Object.prototype.hasOwnProperty.call(HIST_SNAPSHOT.urls, url)) {
        return HIST_SNAPSHOT.urls[url];
      }
    } catch (e) { /* null below */ }
    return null;
  }

  /* historyHere: does the ACTIVE connection serve the history api. Params:
   * none. Returns boolean. Sync gate for WS history calls. Never throws
   * (missing Chain in unit tests reads as false — fail closed). */
  function historyHere() {
    try {
      if (typeof Chain !== "undefined" && Chain && typeof Chain.hasHistory === "function") {
        return Chain.hasHistory() === true;
      }
    } catch (e) { /* false below */ }
    return false;
  }

  /* esAllowed: did the user leave community ES enabled. Params: none.
   * Returns boolean (default ON per owner ruling — missing Store or missing
   * key reads as true, preserving today's ES-on fills behavior). Never
   * throws. */
  function esAllowed() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        return Store.loadSettings().esEnabled !== false;
      }
    } catch (e) { /* true below */ }
    return true;
  }

  /* recordEs: cache a raw-ES attempt outcome. Params: ok boolean-ish.
   * Returns nothing. Fails: never. */
  function recordEs(ok) {
    try { esLast = {ok: (ok === true), t: Date.now()}; } catch (e) { /* cache stands */ }
  }

  /* esLastOk: last raw-ES attempt outcome. Params: none. Returns
   * true/false, or null when no attempt yet. Never throws. */
  function esLastOk() {
    try { return esLast ? esLast.ok : null; } catch (e) { return null; }
  }

  /* esAvailable: sync best-knowledge ES reachability. Params: none. Returns
   * true (last attempt ok), false (last attempt failed AND user hasn't
   * re-enabled since — callers still try on null/unknown, fail-soft).
   * Null means "no data yet — attempt, then recordEs". Never throws. */
  function esAvailable() {
    try { return esLast ? esLast.ok : null; } catch (e) { return null; }
  }

  /* esSearch: the ONLY raw-ES fetch seam (see header NOTE). Params: index
   * (allowlisted string), body (plain query object), opts {timeoutMs}
   * optional. Returns a Promise for the parsed ES JSON. Fails:
   * "es-disabled" (pref off — no fetch fires), "es-bad-index" (not
   * allowlisted — never sent), "es-unavailable" (network/non-200/bad JSON —
   * recorded via recordEs(false)). Success records recordEs(true).
   * Bounded by callers (size/ranges) — never fires match_all from here. */
  function esSearch(index, body, opts) {
    return new Promise(function (resolve, reject) {
      if (!esAllowed()) { reject(new Error("es-disabled")); return; }
      if (ES_INDEXES.indexOf(index) === -1) { reject(new Error("es-bad-index")); return; }
      if (!body || typeof body !== "object") { reject(new Error("es-bad-index")); return; }
      var timeoutMs = (opts && typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) ? opts.timeoutMs : 10000;
      var url = ES_BASE + "/" + index + "/_search";
      var payload;
      try { payload = JSON.stringify(body); } catch (e) { reject(new Error("es-bad-index")); return; }
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return; settled = true;
        recordEs(false);
        reject(new Error("es-unavailable"));
      }, timeoutMs);
      function fin(ok, val, isErr) {
        if (settled) return; settled = true;
        try { clearTimeout(timer); } catch (e) { /* timer gone */ }
        recordEs(ok);
        if (isErr) reject(val); else resolve(val);
      }
      var fetchFn = null;
      try { fetchFn = (typeof fetch === "function") ? fetch : null; } catch (e) { fetchFn = null; }
      if (!fetchFn) { fin(false, new Error("es-unavailable"), true); return; }
      try {
        fetchFn(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: payload}).then(function (resp) {
          if (!resp || resp.ok !== true) { fin(false, new Error("es-unavailable"), true); return; }
          resp.json().then(function (j) { fin(true, j, false); }, function () { fin(false, new Error("es-unavailable"), true); });
        }, function () { fin(false, new Error("es-unavailable"), true); });
      } catch (e) { fin(false, new Error("es-unavailable"), true); }
    });
  }

  return {ES_BASE: ES_BASE, ES_INDEXES: ES_INDEXES, HIST_SNAPSHOT: HIST_SNAPSHOT,
    update: update, nodeHistory: nodeHistory, historyHere: historyHere,
    esAllowed: esAllowed, recordEs: recordEs, esLastOk: esLastOk,
    esAvailable: esAvailable, esSearch: esSearch};
})();
if (typeof module !== "undefined") { module.exports = HistoryCap; }
