/* notify-rules.js — price-alert rule store + exact trigger engine + watcher + sweep.
 * Owns: rule CRUD + persistence (notify_alerts_v1 envelope), per-pair
 *   last-fired summaries (notify_fired_v1 envelope, time + threshold + actual
 *   recorded at fire time from data already in hand), pairKey, the
 *   decimal-exact HIGHER/LOWER compare, the pulled checkAlerts engine with
 *   fulfilled-rule self-delete, the pulled checkHistory watcher (fill-only +
 *   transfer-to-me), and the 7-day sweepStale hygiene. No view DOM, no
 *   sockets, no signing, no serializers.
 * Consumes: Notify (toast queue + prefs + browser note — guarded delegates;
 *   notify.js loads BEFORE this file). localStorage (guarded, in-memory
 *   fallback under node). Nothing fires while the page is closed: both
 *   engines are pulled by existing ticker/history reads.
 * Globals/side effects: single global NotifyRules (+ module.exports);
 *   persists notify_alerts_v1 + notify_fired_v1. Toast/pref writes go through Notify.
 * Created by: building-vanilla-slices skill, slice-16 cap-breach split —
 *   rule/engine half moved behavior-identically OUT of notify.js (toast
 *   queue + prefs + browser gate + txConfirmed stay there).
 * Reference shapes (bitshares-ui, read-only): Exchange.js:1-4 (types "1"/"2"
 *   as STRINGS); PriceAlert.jsx:36-42,82-101,160-189 (CRUD + validation);
 *   Exchange.jsx:134-179 (pair tag/filter); PriceAlertNotifications.jsx
 *   :13-60,70-182 (pair key, >= / <=, NaN guard, 30s, self-delete);
 *   Notifier.jsx:18-54 (fill-only, new-id, 5s);
 *   BrowserNotifications.jsx:25-119 (gate chain); SettingsStore.js:93,718-734.
 * Deliberate deviations (inherited from notify.js): exact scaled-integer
 *   compares (never float — #1 wraps everything in Number()); 7-day sweep
 *   drops rules whose pair stays unresolvable (badge first, never silent).
 * Precision policy (ambiguity B): decimal caps apply ONLY when the caller
 *   passes numeric basePrec/quotePrec. Thresholds stay STRINGS until compare.
 */
var NotifyRules = (function () {
  "use strict";
  var RULES_KEY = "notify_alerts_v1";
  /* WHY a second key (not a field on the rules envelope): checkAlerts
   * self-deletes fired rules and sweepStale rewrites the rules envelope, so
   * history kept inside it would be wiped by the same write that deletes the
   * rule. A sibling envelope with the same guarded _get/_set + versioned
   * {v, at, ...} shape survives both, costs no new dependency or timer. */
  var FIRED_KEY = "notify_fired_v1";
  var STALE_MS = 7 * 24 * 3600 * 1000;
  var _mem = {};
  /* Guarded storage read: localStorage, else in-memory (node/headless). */
  function _get(k) {
    try { if (typeof localStorage !== "undefined") return localStorage.getItem(k); }
    catch (e) { /* blocked: fall through to memory */ }
    return Object.prototype.hasOwnProperty.call(_mem, k) ? _mem[k] : null;
  }
  /* Guarded storage write: localStorage, else in-memory. Never throws. */
  function _set(k, v) {
    try { if (typeof localStorage !== "undefined") { localStorage.setItem(k, v); return; } }
    catch (e) { /* blocked/full: keep memory copy */ }
    _mem[k] = v;
  }
  /* Toast delegate: queue lives in notify.js. Missing Notify -> skip the
   * toast but NEVER change rule outcomes (fire/delete/event still apply). */
  function _toast(level, title, body, durationMs) {
    try {
      if (typeof Notify !== "undefined" && Notify &&
          typeof Notify.push === "function") {
        Notify.push(level, title, body, { durationMs: durationMs });
      }
    } catch (e) { /* queue best-effort; engine outcome stands */ }
  }
  /* Duration delegate: verbatim 10s/30s/5s live in Notify.DURATIONS; the
   * literals below are load-order fallbacks only (same values, never drifted). */
  function _dur(name, fallback) {
    try {
      if (typeof Notify !== "undefined" && Notify && Notify.DURATIONS &&
          typeof Notify.DURATIONS[name] === "number") return Notify.DURATIONS[name];
    } catch (e) { /* fall through */ }
    return fallback;
  }
  /* Prefs delegate: transferToMe gate lives in notify.js. Missing Notify ->
   * default { transferToMe: true } (matches Notify defaults). */
  function _transferToMe() {
    try {
      if (typeof Notify !== "undefined" && Notify &&
          typeof Notify.prefs === "function") {
        var p = Notify.prefs();
        return !(p && p.transferToMe === false);
      }
    } catch (e) { /* default below */ }
    return true;
  }
  /* Browser-note delegate: gated + honest skip reasons live in notify.js. */
  function _browser(title, body) {
    try {
      if (typeof Notify !== "undefined" && Notify &&
          typeof Notify.notifyBrowser === "function") {
        Notify.notifyBrowser(title, body);
      }
    } catch (e) { /* in-app toast already queued; never throw */ }
  }
  /* pairKey: QUOTE_BASE uppercase key (quote_base shape port). Fails bad-pair. */
  function pairKey(quote, base) {
    var q = typeof quote === "string" ? quote.trim().toUpperCase() : "";
    var b = typeof base === "string" ? base.trim().toUpperCase() : "";
    if (!q || !b || q === b) throw new Error("bad-pair");
    return q + "_" + b;
  }
  /* Split a display decimal into {neg, int, frac}; null when malformed. */
  function _decParts(s) {
    if (typeof s !== "string") return null;
    var neg = false;
    if (s.charAt(0) === "-") { neg = true; s = s.slice(1); }
    var m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return null;
    return { neg: neg, int: m[1].replace(/^0+(?=\d)/, ""), frac: m[2] || "" };
  }
  /* Load persisted rules (envelope {v, at, rules}); corrupt shape yields []. */
  function _loadRules() {
    var raw = _get(RULES_KEY);
    if (!raw) return [];
    try {
      var env = JSON.parse(raw);
      var arr = env && Array.isArray(env.rules) ? env.rules : [];
      return arr.filter(function (r) {
        return r && typeof r.key === "string" && typeof r.quote === "string" &&
          typeof r.base === "string" && (r.type === "1" || r.type === "2") &&
          typeof r.price === "string" && _decParts(r.price);
      });
    } catch (e) { return []; }
  }
  /* Persist rules under the versioned envelope. */
  function _saveRules(rulesArr) {
    _set(RULES_KEY, JSON.stringify({ v: 1, at: Date.now(), rules: rulesArr }));
  }
  /**
   * Load last-fired summaries keyed by QUOTE_BASE pair key.
   * Corrupt/missing storage yields {} (never throws; history is best-effort).
   * @returns {Object<string, {at:number, price:string, actual:string, type:string}>} Pair key to summary copies.
   */
  function _loadFiredMap() {
    var raw = _get(FIRED_KEY);
    if (!raw) return {};
    try {
      var env = JSON.parse(raw);
      var src = env && env.fired && typeof env.fired === "object" ? env.fired : {};
      var out = {}, k;
      for (k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var e = src[k];
        /* WHY strict shape here: fired lines render threshold + actual +
         * time, so a half-written entry (crashed mid-save) must not paint. */
        if (e && typeof e.at === "number" && isFinite(e.at) &&
            typeof e.price === "string" && e.price &&
            typeof e.actual === "string" && e.actual &&
            (e.type === "1" || e.type === "2")) {
          out[String(k).toUpperCase()] = { at: e.at, price: e.price, actual: e.actual, type: e.type };
        }
      }
      return out;
    } catch (e) { return {}; }
  }
  /**
   * Persist the fired map under the versioned envelope (text only).
   * @param {Object<string, {at:number, price:string, actual:string, type:string}>} map Pair key to summary.
   * @returns {void}
   */
  function _saveFiredMap(map) {
    _set(FIRED_KEY, JSON.stringify({ v: 1, at: Date.now(), fired: map || {} }));
  }
  /**
   * Record one batch of fired rules as the pair's last-fired summary.
   * Last entry in the batch wins (deterministic; no new reads to rank them).
   * @param {string} wantPairKey Uppercase QUOTE_BASE pair key.
   * @param {Array<{rule:{price:string, type:string}, actual:string}>} firedArr Fired entries from data already in hand.
   * @param {number} nowMs Wall-clock ms captured once per checkAlerts call.
   * @returns {void}
   */
  function _recordFired(wantPairKey, firedArr, nowMs) {
    var map = _loadFiredMap(), i;
    for (i = 0; i < firedArr.length; i++) {
      /* WHY the two guards (not || {}): tsc checkJs types {} as lacking
       * rule/actual, so defaulting would fail the type gate; explicit
       * falsy skips keep the seam typed and the runtime identical. */
      var f = firedArr[i];
      if (!f) continue;
      var r = f.rule;
      if (!r) continue;
      if (typeof r.price !== "string" || !r.price) continue;
      if (typeof f.actual !== "string" || !f.actual) continue;
      if (r.type !== "1" && r.type !== "2") continue;
      map[wantPairKey] = { at: nowMs, price: r.price, actual: f.actual, type: r.type };
    }
    _saveFiredMap(map);
  }
  /**
   * Last-fired summary for a pair, or null when nothing fired yet.
   * @param {string} quote Quote symbol.
   * @param {string} base Base symbol.
   * @returns {{at:number, price:string, actual:string, type:string}|null} Copy of the summary, never a live reference.
   */
  function lastFired(quote, base) {
    var k = pairKey(quote, base);
    var map = _loadFiredMap();
    var e = map[k];
    if (!e) return null;
    return { at: e.at, price: e.price, actual: e.actual, type: e.type };
  }
  /* rules: all stored rules as copies (incl. unresolvedSince badge data). */
  function rules() {
    return _loadRules().map(function (r) {
      var c = { key: r.key, quote: r.quote, base: r.base, type: r.type, price: r.price };
      if (r.unresolvedSince) c.unresolvedSince = r.unresolvedSince;
      return c;
    });
  }
  /* rulesFor: pair filter (getPriceAlertRules port). hasAny: bell indicator. */
  function rulesFor(quote, base) {
    var k = pairKey(quote, base);
    return rules().filter(function (r) { return r.quote + "_" + r.base === k; });
  }
  function hasAny(quote, base) { return rulesFor(quote, base).length > 0; }
  /* Decimals in a shape-checked display string. */
  function _decimals(price) {
    var dot = price.indexOf(".");
    return dot === -1 ? 0 : price.length - dot - 1;
  }
  /* addRule: validate + store {quote, base, type "1"|"2", price string}.
   * Shape ^\d+(\.\d+)?$ verbatim; with numeric basePrec+quotePrec, decimals
   * must fit max(basePrec, quotePrec). Fails bad-rule / bad-pair. Idempotent. */
  function addRule(spec) {
    spec = spec || {};
    if (spec.type !== "1" && spec.type !== "2") throw new Error("bad-rule");
    var k = pairKey(spec.quote, spec.base);
    var price = typeof spec.price === "string" ? spec.price.trim() : "";
    if (!/^\d+(?:\.\d+)?$/.test(price)) throw new Error("bad-rule");
    var bp = spec.basePrec, qp = spec.quotePrec;
    if (typeof bp === "number" && typeof qp === "number" && isFinite(bp) && isFinite(qp) &&
        bp >= 0 && qp >= 0 && Math.floor(bp) === bp && Math.floor(qp) === qp) {
      var cap = bp > qp ? bp : qp;
      if (_decimals(price) > cap) throw new Error("bad-rule");
    }
    var all = _loadRules();
    var key = k + "|" + spec.type + "|" + price, parts = k.split("_"), i;
    for (i = 0; i < all.length; i++) { if (all[i].key === key) return { key: key }; }
    all.push({ key: key, quote: parts[0], base: parts[1], type: spec.type,
      price: price, createdAt: Date.now() });
    _saveRules(all);
    return { key: key };
  }
  /* removeRule: delete by key. Returns {removed: bool}. */
  function removeRule(key) {
    var all = _loadRules();
    var next = all.filter(function (r) { return r.key !== key; });
    if (next.length !== all.length) _saveRules(next);
    return { removed: next.length !== all.length };
  }
  /* compare: EXACT decimal compare -> -1|0|1. Integers by length-then-lex,
   * fractions right-padded to common length (scaled-integer semantics, no
   * float). Fails bad-rule on malformed input. */
  function compare(a, b) {
    var x = _decParts(typeof a === "string" ? a.trim() : "");
    var y = _decParts(typeof b === "string" ? b.trim() : "");
    if (!x || !y) throw new Error("bad-rule");
    if (x.neg !== y.neg) return x.neg ? -1 : 1;
    var sign = x.neg ? -1 : 1;
    if (x.int.length !== y.int.length) return (x.int.length > y.int.length ? 1 : -1) * sign;
    if (x.int !== y.int) return (x.int > y.int ? 1 : -1) * sign;
    var n = x.frac.length > y.frac.length ? x.frac.length : y.frac.length;
    var xf = x.frac, yf = y.frac;
    while (xf.length < n) xf += "0";
    while (yf.length < n) yf += "0";
    if (xf === yf) return 0;
    return (xf > yf ? 1 : -1) * sign;
  }
  /* checkAlerts: pulled engine. Null/missing/malformed price NEVER fires (NaN
   * guard). HIGHER ("1") fires at compare(actual, expected) >= 0, LOWER ("2")
   * at <= 0. Each fired rule pushes a 30s toast in the locale words AND is
   * deleted (self-delete). Returns {fired: [{rule, actual}], kept: n}. */
  function checkAlerts(pairKeyStr, humanPrice) {
    var pk = String(pairKeyStr || "").trim().toUpperCase().split("_");
    if (pk.length !== 2 || !pk[0] || !pk[1]) throw new Error("bad-pair");
    var want = pk[0] + "_" + pk[1];
    var all = _loadRules();
    var mine = all.filter(function (r) { return r.quote + "_" + r.base === want; });
    var actual = typeof humanPrice === "string" ? humanPrice.trim() : null;
    if (!actual || !_decParts(actual)) return { fired: [], kept: mine.length };
    var alertMs = _dur("alert", 30000);
    var fired = [];
    var kept = all.filter(function (r) {
      if (r.quote + "_" + r.base !== want) return true;
      var c;
      try { c = compare(actual, r.price); } catch (e) { return true; }
      if (r.type === "1" ? c < 0 : c > 0) return true;
      var pair = r.quote + "/" + r.base;
      _toast("info", "Price Alert", r.type === "1"
        ? "The price of " + pair + " rose higher than " + r.price + " and is now " + actual
        : "The price of " + pair + " fell lower than " + r.price + " and is now " + actual,
        alertMs);
      fired.push({ rule: { key: r.key, quote: r.quote, base: r.base, type: r.type,
        price: r.price }, actual: actual });
      return false;
    });
    /* WHY persist here (not in the view, not on a timer): this is the only
     * instant the threshold + actual coexist — the rule self-deletes below,
     * so waiting would lose the threshold. One wall-clock stamp per batch,
     * text-only write, guarded so storage failure never changes the
     * fire/delete outcome. No polling, no new timers. */
    if (fired.length > 0) {
      try { _recordFired(want, fired, Date.now()); } catch (e) { /* history best-effort */ }
      _saveRules(kept);
    }
    return { fired: fired, kept: mine.length - fired.length };
  }
  /* Classify one account-history op tuple [code-or-name, body]: fill_order is
   * op 4, transfer is op 0. Anything else -> null (silent). */
  function _opKind(op) {
    if (!Array.isArray(op) || op.length < 2) return null;
    if (op[0] === 4 || op[0] === "fill_order") return { kind: "fill", body: op[1] || {} };
    if (op[0] === 0 || op[0] === "transfer") return { kind: "transfer", body: op[1] || {} };
    return null;
  }
  /* checkHistory: diff newest-first rows vs the caller's prevFirstId. No prev
   * id -> baseline (first paint never toasts). Fill rows push 5s toasts;
   * transfer rows to a watched account push transfer toasts ONLY when the
   * transferToMe pref is on (plus a best-effort gated browser note).
   * Same-id -> silent. Bodies carry NO amounts (exact human enrichment is
   * the view's async job with looked-up precisions). Returns {events, firstId}
   * for the caller to persist per-view; no global polling state lives here. */
  function checkHistory(prevFirstId, rows, opts) {
    rows = Array.isArray(rows) ? rows : [];
    var firstId = rows.length > 0 && rows[0] && rows[0].id !== undefined
      ? String(rows[0].id) : (prevFirstId ? String(prevFirstId) : null);
    if (!prevFirstId) return { events: [], firstId: firstId };
    var prev = String(prevFirstId), fresh = [], i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].id !== undefined && String(rows[i].id) === prev) break;
      fresh.push(rows[i]);
    }
    var watch = [];
    if (opts && Array.isArray(opts.watchAccounts)) {
      for (i = 0; i < opts.watchAccounts.length; i++) watch.push(String(opts.watchAccounts[i]));
    }
    var fillMs = _dur("fill", 5000);
    var allowTransfer = _transferToMe();
    var events = [];
    for (i = 0; i < fresh.length; i++) {
      var row = fresh[i] || {}, k = _opKind(row.op);
      if (!k) continue;
      if (k.kind === "fill") {
        _toast("info", "Order filled", "A limit order was filled (" +
          (row.id !== undefined ? String(row.id) : "new") + ").", fillMs);
        events.push({ kind: "fill", row: row });
      } else if (k.kind === "transfer") {
        var to = k.body && k.body.to !== undefined ? String(k.body.to) : "";
        if (watch.indexOf(to) === -1 || !allowTransfer) continue;
        _toast("info", "Incoming transfer", "Incoming transfer to " + to + ".", fillMs);
        _browser("Incoming transfer", "Incoming transfer to " + to + ".");
        events.push({ kind: "transfer-to-me", row: row });
      }
    }
    return { events: events, firstId: firstId };
  }
  /* sweepStale: 7-day hygiene. isResolvable(quote, base) is the view's sync
   * predicate (it owns the asset cache). Unresolvable rules are stamped once
   * (badge via rules()) and dropped only after 7 days; resolver failure keeps
   * the rule (never silent-delete on errors). Returns {kept, dropped, marked}. */
  function sweepStale(isResolvable) {
    if (typeof isResolvable !== "function") throw new Error("bad-rule");
    var all = _loadRules(), now = Date.now(), dropped = 0, marked = 0, changed = false;
    var kept = all.filter(function (r) {
      var ok = true;
      try { ok = !!isResolvable(r.quote, r.base); } catch (e) { ok = true; }
      if (ok) {
        if (r.unresolvedSince) { delete r.unresolvedSince; changed = true; }
        return true;
      }
      if (!r.unresolvedSince) { r.unresolvedSince = now; marked++; changed = true; return true; }
      if (typeof r.unresolvedSince === "number" && (now - r.unresolvedSince) > STALE_MS) {
        dropped++; changed = true; return false;
      }
      return true;
    });
    if (changed) _saveRules(kept);
    return { kept: kept.length, dropped: dropped, marked: marked };
  }
  return {
    STALE_MS: STALE_MS,
    pairKey: pairKey, rules: rules, rulesFor: rulesFor,
    hasAny: hasAny, addRule: addRule, removeRule: removeRule, compare: compare,
    checkAlerts: checkAlerts, checkHistory: checkHistory, sweepStale: sweepStale,
    lastFired: lastFired
  };
})();
/* Expose the single NotifyRules global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.NotifyRules === "undefined") { globalThis.NotifyRules = NotifyRules; }
if (typeof module !== "undefined") { module.exports = NotifyRules; }
