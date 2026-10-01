/* Notify: toast queue + prefs + browser-note gate + tx-confirmed hook.
 * Owns: toast queue (levels, durations, tap-to-dismiss), preference flags
 *   (browser opt-in default OFF, transferToMe default ON) + persistence, the
 *   platform Notification gate (explicit opt-in only), and txConfirmed (the
 *   toast hook sendAndProve callers use; inline result panels stay primary).
 *   No view DOM: the only browser surface is the platform Notification
 *   constructor, behind explicit opt-in only.
 * Consumes: localStorage (guarded, in-memory fallback under node), platform
 *   Notification (feature-detected), timers for auto-dismiss. No sockets,
 *   no signing, no serializers.
 * Globals/side effects: single global Notify (+ module.exports); persists
 *   notify_prefs_v1; arms wall-clock auto-dismiss timers (nothing fires
 *   while the page is closed).
 * Created by: building-vanilla-slices skill, slice-16-notify plan Task 1;
 *   rule store + exact engine + history watcher + sweep live in
 *   notify-rules.js (cap-breach split, behavior-identical move).
 * Reference shapes (bitshares-ui, read-only): NotificationStore.js:4-26 +
 *   NotificationActions.js:4-41 (levels); App.jsx:451-459 (pump, 10s);
 *   BrowserNotifications.jsx:25-65 (gate chain);
 *   SettingsStore.js:121-126,165-170 (toggle defaults/WORDS);
 *   TransactionConfirm.jsx:131-149 (confirmed words).
 * Created by: building-vanilla-slices skill, slice-16-notify plan Task 1.
 * Reference shapes (bitshares-ui, read-only): NotificationStore.js:4-26 +
 *   NotificationActions.js:4-41 (levels); App.jsx:451-459 (pump, 10s);
 *   Exchange.js:1-4 (types "1"/"2"); PriceAlert.jsx:36-42,82-101,160-189;
 *   Exchange.jsx:134-179 (pair tag/filter); PriceAlertNotifications.jsx
 *   :13-60,70-182 (pair key, >= / <=, NaN guard, 30s, self-delete);
 *   Notifier.jsx:18-54 (fill-only, new-id, 5s);
 *   BrowserNotifications.jsx:25-119,156-172 (gate chain);
 *   SettingsStore.js:93,121-126,165-170,718-734; SettingsEntry.jsx:115-171;
 *   TransactionConfirm.jsx:131-149 (confirmed words).
 * Deliberate deviations: browser notes default OFF, asked for ONLY inside
 *   enableBrowser (never on load).
 */
var Notify = (function () {
  "use strict";
  /* Verbatim durations: 10s default / 30s alerts / 5s fills. */
  var DUR = { toast: 10000, alert: 30000, fill: 5000 };
  var MAX_VISIBLE = 5;
  var PREFS_KEY = "notify_prefs_v1";
  var _seq = 0, _toasts = [], _dropped = 0, _subs = [], _mem = {};
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
  /* Fan out a snapshot to subscribers; listener errors never break the queue. */
  function _emit() {
    var snap = list();
    for (var i = 0; i < _subs.length; i++) {
      try { _subs[i]({ toasts: snap, dropped: _dropped }); } catch (e) { /* keep going */ }
    }
  }
  /* push: enqueue a toast (levels success|info|warning|error, else bad-rule).
   * Bare-string title with no body is wrapped as the message. opts
   * {durationMs default 10000, sticky}. Past MAX_VISIBLE the oldest
   * non-sticky toast drops (overflow counted). Returns {id}. */
  function push(level, title, body, opts) {
    if (level !== "success" && level !== "info" && level !== "warning" && level !== "error") {
      throw new Error("bad-rule");
    }
    if (typeof body === "undefined" && typeof title === "string") { body = title; title = ""; }
    opts = opts || {};
    var msg = typeof body === "string" ? body
      : (body && typeof body.message === "string" ? body.message
      : (body === undefined || body === null ? "" : String(body)));
    var d = opts.durationMs;
    var dur = (typeof d === "number" && isFinite(d) && d >= 0 && Math.floor(d) === d) ? d : DUR.toast;
    var t = { id: "n" + (++_seq) + "_" + Date.now(), level: level,
      title: title === undefined || title === null ? "" : String(title),
      body: msg, durationMs: dur, sticky: !!opts.sticky, at: Date.now() };
    _toasts.push(t);
    while (_toasts.length > MAX_VISIBLE) {
      var idx = 0, i;
      for (i = 0; i < _toasts.length; i++) { if (!_toasts[i].sticky) { idx = i; break; } }
      _toasts.splice(idx, 1);
      _dropped++;
    }
    if (!t.sticky) setTimeout(function () { dismiss(t.id); }, t.durationMs);
    _emit();
    return { id: t.id };
  }
  /* dismiss: remove one toast by id. Returns {dismissed: bool}. */
  function dismiss(id) {
    for (var i = 0; i < _toasts.length; i++) {
      if (_toasts[i].id === id) { _toasts.splice(i, 1); _emit(); return { dismissed: true }; }
    }
    return { dismissed: false };
  }
  /* clear: empty the queue, reset overflow. Returns {cleared: n}. */
  function clear() {
    var n = _toasts.length;
    _toasts = []; _dropped = 0; _emit();
    return { cleared: n };
  }
  /* list: visible toasts, oldest first (copies). overflow: dropped count. */
  function list() {
    return _toasts.map(function (t) {
      return { id: t.id, level: t.level, title: t.title, body: t.body,
        durationMs: t.durationMs, sticky: t.sticky, at: t.at };
    });
  }
  function overflow() { return _dropped; }
  /* subscribe: fn({toasts, dropped}) on every change. Returns unsub. */
  function subscribe(fn) {
    if (typeof fn !== "function") throw new Error("bad-rule");
    _subs.push(fn);
    return function () { var i = _subs.indexOf(fn); if (i !== -1) _subs.splice(i, 1); };
  }
  /* Prefs merged over defaults {browser: false, transferToMe: true}. */
  function _loadPrefs() {
    var out = { browser: false, transferToMe: true };
    try {
      var p = JSON.parse(_get(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (typeof p.transferToMe === "boolean") out.transferToMe = p.transferToMe;
        if (typeof p.browser === "boolean") out.browser = p.browser;
      }
    } catch (e) { /* corrupt: defaults */ }
    return out;
  }
  function prefs() { return _loadPrefs(); }
  /* setPrefs: transferToMe merges freely; browser:false honored; browser:true
   * is IGNORED unless permission is already granted (only enableBrowser sets
   * it true — explicit opt-in, never auto-requested). Returns stored prefs. */
  function setPrefs(patch) {
    var next = _loadPrefs();
    if (patch && typeof patch.transferToMe === "boolean") next.transferToMe = patch.transferToMe;
    if (patch && patch.browser === false) next.browser = false;
    else if (patch && patch.browser === true && _perm() === "granted") next.browser = true;
    _set(PREFS_KEY, JSON.stringify(next));
    return prefs();
  }
  /* _perm: permission state, or "unsupported" without the API. Never throws. */
  function _perm() {
    if (typeof Notification === "undefined") return "unsupported";
    try { return Notification.permission || "default"; } catch (e) { return "unsupported"; }
  }
  /* Persist the browser flag without touching permission. */
  function _setBrowser(on) {
    var next = _loadPrefs();
    next.browser = !!on;
    _set(PREFS_KEY, JSON.stringify(next));
  }
  /* enableBrowser: THE ONLY permission-request call site (explicit toggle
   * clicks only, never on load). Returns {granted} or {granted, reason}. */
  async function enableBrowser() {
    if (typeof Notification === "undefined") {
      _setBrowser(false);
      return { granted: false, reason: "unsupported" };
    }
    var p = _perm();
    if (p === "granted") { _setBrowser(true); return { granted: true }; }
    if (p === "denied") { _setBrowser(false); return { granted: false, reason: "denied" }; }
    var next = await Notification.requestPermission();
    if (next === "granted") { _setBrowser(true); return { granted: true }; }
    _setBrowser(false);
    return { granted: false, reason: next === "denied" ? "denied" : "default" };
  }
  /* notifyBrowser: platform note ONLY when opted in AND supported AND granted.
   * Else {skipped: disabled|unsupported|denied|default}. Never throws. */
  function notifyBrowser(title, body) {
    if (!_loadPrefs().browser) return { skipped: "disabled" };
    if (typeof Notification === "undefined") return { skipped: "unsupported" };
    var p = _perm();
    if (p === "denied") return { skipped: "denied" };
    if (p !== "granted") return { skipped: "default" };
    try {
      new Notification(String(title), { body: String(body) });
      return { sent: true };
    } catch (e) { return { skipped: "error" }; }
  }
  /* txConfirmed: supplement hook for sendAndProve callers (inline result
   * panels stay primary). Default 10s toast. Returns {id}. */
  function txConfirmed(txId) {
    return push("success", "Transaction confirmed",
      txId ? "Included: " + String(txId) : "Included in a block.", {});
  }
  return {
    DURATIONS: { toast: DUR.toast, alert: DUR.alert, fill: DUR.fill },
    push: push, dismiss: dismiss, clear: clear, list: list, overflow: overflow,
    subscribe: subscribe, prefs: prefs,
    setPrefs: setPrefs, enableBrowser: enableBrowser, notifyBrowser: notifyBrowser,
    txConfirmed: txConfirmed
  };
})();
/* Expose the single Notify global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.Notify === "undefined") { globalThis.Notify = Notify; }
if (typeof module !== "undefined") { module.exports = Notify; }
