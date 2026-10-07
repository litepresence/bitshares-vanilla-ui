/* PairContext: the global selected pair — the one piece of trading context
 * that travels the app. Owns: the pair value, its normalization, the
 * QUOTE_BASE market-id rule, and a 3-line pub/sub.
 * Consumes: nothing (no DOM, no chain, no storage, no other module).
 *   Side effects: none beyond its own module state.
 * Value: string[] of 1-2 uppercase symbols in HUMAN order [base, quote]
 *   (["BTS"] default). Desk ids are QUOTE_BASE ("ETH_BTS"), which is why
 *   marketId() swaps the legs and why nothing else in the app should do
 *   that swap.
 * Lifetime: session memory only (owner ruling 2026-10-07) — a reload
 *   resets to [BTS]; shareable URLs carry ?a=/?b= instead.
 * Readers/writers: both pickers READ (seed their search/filter fields),
 *   both desks WRITE (on load, from the route). Pickers never write.
 * Created by: pair-context plan Task 2
 *   (spec docs/superpowers/specs/2026-10-07-market-pair-context-design.md).
 * NEVER throws: every public call is wrapped, bad input normalizes to the
 * default, a throwing subscriber cannot break a write.
 */
var PairContext = (function () {
  "use strict";

  var DEFAULT = ["BTS"];
  var SYMBOL_MAX = 12;
  var OBJECT_ID_RE = /^1\.\d+\.\d+$/;
  var pair = DEFAULT.slice();
  var subs = [];

  /* normalize: any input -> the canonical pair. An ARRAY is a list of legs;
   * a STRING is ONE leg (never split here — turning a desk id into a pair
   * is fromMarketId's job, so the two never mean different things in
   * different callers). Trims, uppercases, drops blanks, drops
   * object-id-shaped junk (a bare id would misroute a desk — the
   * validPoolMarket rule, kept verbatim), enforces the 12-char symbol cap,
   * dedupes, truncates to 2 legs, and resets an empty result to DEFAULT so
   * the pickers can always render something.
   * @param {string[]|string|null|undefined} input
   * @returns {string[]} 1-2 symbols, human order. Never empty. */
  function normalize(input) {
    var legs = [];
    try {
      if (Array.isArray(input)) legs = input.slice();
      else if (typeof input === "string") legs = [input];
      else if (input && typeof input.length === "number") legs = Array.prototype.slice.call(input);
    } catch (e) { legs = []; }
    var out = [];
    for (var i = 0; i < legs.length; i++) {
      var s = "";
      try { s = String(legs[i] == null ? "" : legs[i]).trim().toUpperCase(); } catch (e) { s = ""; }
      if (!s) continue;
      if (OBJECT_ID_RE.test(s)) continue;
      if (s.length > SYMBOL_MAX) continue;
      if (out.indexOf(s) !== -1) continue;
      out.push(s);
      if (out.length === 2) break;
    }
    return out.length ? out : DEFAULT.slice();
  }

  /* marketId: the pair as a desk id (QUOTE_BASE), or null when the pair
   * has one leg (an anchor with no market yet — the pickers render it, the
   * desk cannot open it).
   * @param {string[]} [p] pair to convert; defaults to the live pair
   * @returns {string|null} e.g. ["BTS","ETH"] -> "ETH_BTS" */
  function marketId(p) {
    var legs = normalize(arguments.length ? p : pair);
    return legs.length === 2 ? legs[1] + "_" + legs[0] : null;
  }

  /* fromMarketId: desk id -> pair. Inverse of marketId(). Bare ids and
   * junk yield the single-leg pair (["BTS"]) rather than throwing, so an
   * odd URL still leaves a renderable picker.
   * @param {string} id QUOTE_BASE desk id
   * @returns {string[]} human-order pair */
  function fromMarketId(id) {
    var parts = [];
    try { parts = String(id == null ? "" : id).split(/[-_]/); } catch (e) { parts = []; }
    var legs = [];
    if (parts.length === 2) legs = [parts[1], parts[0]];
    else if (parts.length === 1) legs = [parts[0]];
    return normalize(legs);
  }

  /* fromPool: pool assets -> pair, in the pool's own (base, quote) order.
   * That order is deliberate: marketId() then reproduces the exact
   * "QUOTE_BASE" string pool-detail-view.js used to hand the navbar, so a
   * pool visit and an Exchange visit agree on one pair.
   * @param {{base?: {symbol?: string}, quote?: {symbol?: string}}} assets
   * @returns {string[]} human-order pair */
  function fromPool(assets) {
    var legs = [];
    try {
      if (assets && typeof assets === "object") {
        if (assets.base) legs.push(assets.base.symbol);
        if (assets.quote) legs.push(assets.quote.symbol);
      }
    } catch (e) { legs = []; }
    return normalize(legs);
  }

  /* get: the live pair as a fresh array (callers cannot mutate state).
   * @returns {string[]} 1-2 symbols */
  function get() {
    try { return normalize(pair); } catch (e) { return DEFAULT.slice(); }
  }

  /* set: replace the pair and notify subscribers when the normalized value
   * actually changed. An array is a pair; a string carrying exactly one
   * separator ("ETH_BTS") is a desk id and goes through fromMarketId, so
   * callers may hand over either without a conversion step of their own.
   * Never throws — a throwing or self-unsubscribing subscriber cannot break
   * the write.
   * @param {string[]|string} next pair legs, or a QUOTE_BASE desk id
   * @returns {string[]} the stored pair */
  function set(next) {
    var input = next;
    try {
      if (typeof input === "string" && /^[^_-]+[-_][^_-]+$/.test(input.trim())) input = fromMarketId(input);
    } catch (e) { /* normalize below handles it */ }
    var normalized = normalize(input);
    try {
      var same = normalized.length === pair.length;
      if (same) for (var i = 0; i < normalized.length; i++) if (normalized[i] !== pair[i]) { same = false; break; }
      if (same) return normalized.slice();
      pair = normalized;
    } catch (e) { pair = normalized; }
    var snapshot = subs.slice();
    for (var k = 0; k < snapshot.length; k++) {
      try { snapshot[k](normalized.slice()); } catch (e) { /* one bad subscriber stands alone */ }
    }
    return normalized.slice();
  }

  /* on: subscribe to pair changes.
   * @param {Function} fn called with the new pair
   * @returns {Function} unsubscribe */
  function on(fn) {
    if (typeof fn !== "function") return function () {};
    try { subs.push(fn); } catch (e) { return function () {}; }
    return function () {
      try { var i = subs.indexOf(fn); if (i !== -1) subs.splice(i, 1); } catch (e) { /* gone */ }
    };
  }

  /* reset: back to DEFAULT (tests + a future Clear affordance).
   * @returns {string[]} ["BTS"] */
  function reset() { return set(DEFAULT.slice()); }

  return {
    get: get, set: set, on: on, reset: reset,
    marketId: marketId, fromMarketId: fromMarketId, fromPool: fromPool,
    _t: { normalize: normalize, marketId: marketId, fromMarketId: fromMarketId, DEFAULT: DEFAULT }
  };
})();

if (typeof module !== "undefined") { module.exports = PairContext; }
