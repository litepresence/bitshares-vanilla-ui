/* AccountNetDepth: pure two-hop depth policy for the account network.
 * Owns: depth normalization, Ring 1/Ring 2 count policy, top-N expansion
 * ranking, and the fixed per-expansion scan budget. No DOM, no storage, no
 * chain, no ES. Callers keep raw-ES work in account-net-es.js and words in
 * account-network-copy.js.
 * Consumes: nothing. Global AccountNetDepth.
 */
var AccountNetDepth = (function () {
  "use strict";

  var MAX_DEPTH = 2;
  var DEFAULT_DEPTH = 1;
  var DEFAULT_RING1 = 40;
  var MAX_RING1 = 40;
  var DEFAULT_RING2 = 8;
  var MAX_RING2 = 8;
  var EXPANSION_SCAN_CAP = 2000;
  var EXPANSION_SCAN_MAX_PAGES = 2;

  /**
   * clampInt: finite integer clamp with default fallback.
   * @param {*} v Raw value. @param {number} dflt Default. @param {number} min Minimum. @param {number} max Maximum.
   * @returns {number} Clamped integer.
   */
  function clampInt(v, dflt, min, max) {
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return dflt;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  /**
   * isAccountId: strict 1.2.x reader.
   * @param {*} v Raw value. @returns {boolean} True for a canonical account id.
   */
  function isAccountId(v) {
    return /^1\.2\.\d+$/.test(String(v === undefined || v === null ? "" : v));
  }

  /**
   * normalizeDepth: only 1 or 2 exist; anything else resets to the default.
   * @param {*} v Raw depth. @returns {number} 1 or 2.
   */
  function normalizeDepth(v) {
    var n = Math.floor(Number(v));
    if (n !== 1 && n !== 2) return DEFAULT_DEPTH;
    return n;
  }

  /**
   * normalizeRing1: retained depth-1 counterparties.
   * @param {*} v Raw count. @returns {number} 1..40.
   */
  function normalizeRing1(v) {
    return clampInt(v, DEFAULT_RING1, 1, MAX_RING1);
  }

  /**
   * normalizeRing2: depth-2 expansions.
   * @param {*} v Raw count. @returns {number} 1..8.
   */
  function normalizeRing2(v) {
    return clampInt(v, DEFAULT_RING2, 1, MAX_RING2);
  }

  /**
   * expansionCount: expansions actually performed for a depth setting.
   * @param {*} depth Raw depth. @param {*} ring2 Raw ring-2 count.
   * @returns {number} 0 at depth 1, otherwise 1..8.
   */
  function expansionCount(depth, ring2) {
    if (normalizeDepth(depth) < 2) return 0;
    return normalizeRing2(ring2);
  }

  /**
   * topCounterparties: rank eligible non-seed accounts by indexed-operation count.
   * @param {Object<string,number>} counts Account id -> indexed operations.
   * @param {Object<string,number>} seedIds Seed ids to exclude.
   * @param {number} limit Maximum ids to return.
   * @returns {string[]} Ranked account ids, deterministic by count then id.
   */
  function topCounterparties(counts, seedIds, limit) {
    var ids = Object.keys(counts || {}).filter(function (id) {
      return isAccountId(id) && !(seedIds && seedIds[id]);
    });
    ids.sort(function (a, b) {
      var ca = Number(counts[a]) || 0, cb = Number(counts[b]) || 0;
      if (cb !== ca) return cb - ca;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return ids.slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
  }

  /**
   * planExpansions: choose depth-2 scan targets.
   * @param {Object<string,number>} counts Indexed operations per account.
   * @param {Object<string,number>} seedIds Seed ids.
   * @param {Object<string,number>} scannedIds Already-scanned ids.
   * @param {number} maxExpansions Maximum expansions.
   * @returns {string[]} Ranked expansion targets.
   */
  function planExpansions(counts, seedIds, scannedIds, maxExpansions) {
    var ids = topCounterparties(counts, seedIds, Object.keys(counts || {}).length);
    return ids.filter(function (id) { return !(scannedIds && scannedIds[id]); })
      .slice(0, Math.max(0, Math.floor(Number(maxExpansions) || 0)));
  }

  return {
    MAX_DEPTH: MAX_DEPTH, DEFAULT_DEPTH: DEFAULT_DEPTH,
    DEFAULT_RING1: DEFAULT_RING1, MAX_RING1: MAX_RING1,
    DEFAULT_RING2: DEFAULT_RING2, MAX_RING2: MAX_RING2,
    EXPANSION_SCAN_CAP: EXPANSION_SCAN_CAP,
    EXPANSION_SCAN_MAX_PAGES: EXPANSION_SCAN_MAX_PAGES,
    normalizeDepth: normalizeDepth, normalizeRing1: normalizeRing1,
    normalizeRing2: normalizeRing2, expansionCount: expansionCount,
    topCounterparties: topCounterparties, planExpansions: planExpansions
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNetDepth === "undefined") { globalThis.AccountNetDepth = AccountNetDepth; }
if (typeof module !== "undefined") { module.exports = AccountNetDepth; }
