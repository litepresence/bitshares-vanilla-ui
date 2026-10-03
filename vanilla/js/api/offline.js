/* Offline: shared connectivity-recovery helper for every offline panel.
 * Owns: chain-state peek (state), active-node read (nodeUrl), throttled
 *   handshake (reconnect — one login->database handshake against the active
 *   node, null when already open/connecting or with no URL), fire-and-forget
 *   entry attempt (ensure — the automated behavior: every offline gate
 *   calls it on entry so a dropped socket heals without a click), Settings
 *   link builder (settingsLink — #/settings anchor for node failover), and
 *   Retry wiring (wire — button handshake with Connecting… feedback,
 *   per-node consecutive-failure counting with a Retry-N prefix after the
 *   first failure, and the unavailable message standing alongside the
 *   Settings link so repeated failures always offer failover).
 *   No fetching beyond Chain.connect, no storage writes, no signing.
 * Consumes: Chain.status/connect (guarded — absent reads as offline, absent
 *   connect reads as no-attempt), Store.loadSettings/subscribe (guarded),
 *   HistoryNotice.actionLink when present (else a manual #/settings anchor).
 *   Callers pass their own doc + t(key, dflt); the three status strings
 *   below reuse global keys byte-identical to en.json (drift gate).
 * Globals/side effects: global Offline only (+ one lazy Store connection
 *   subscription resetting failure counts on open); DOM only under
 *   caller-provided parents. Node for tests via module.exports.
 * Created by: systematic-debugging fix, pools Retry-dead round (offlineBox
 *   only re-rendered while Chain had given up — Retry must handshake).
 */
var Offline = (function () {
  "use strict";

  /* Consecutive handshake failures per node URL (reset on any open event or
   * successful reconnect). Plain object, memory-only — a fresh page starts
   * at zero, which is the honest count for this session. */
  var fails = {};
  var lastTryMs = 0;
  var THROTTLE_MS = 3000;
  var openWatchArmed = false;

  /* Current chain state string, or "unknown" when unreadable. Never throws. */
  function state() {
    try {
      if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
        var s = Chain.status();
        if (s && typeof s.state === "string" && s.state) return s.state;
      }
    } catch (e) { /* unknown below */ }
    return "unknown";
  }

  /* Active node URL from the sole settings owner, or null. Never throws. */
  function nodeUrl() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && typeof s.activeNode === "string" && s.activeNode) return s.activeNode;
      }
    } catch (e) { /* null below */ }
    return null;
  }

  /* Reset failure counts on any open event (lazy one-time subscription so
   * the helper stays side-effect free until first used). Never throws. */
  function armOpenWatch() {
    if (openWatchArmed) return;
    openWatchArmed = true;
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
        Store.subscribe("connection", function (st) {
          try {
            if (st && st.state === "open") fails = {};
          } catch (e) { /* counts stand */ }
        });
      }
    } catch (e) { /* counts reset on reconnect success below instead */ }
  }

  /* One handshake attempt against the active node. Returns the connect
   * promise, or null when no attempt applies (already open/connecting, no
   * URL, no Chain.connect, or within the throttle window). Never throws. */
  function reconnect() {
    armOpenWatch();
    try {
      var st = state();
      if (st === "open" || st === "connecting") return null;
      var now = Date.now();
      if (now - lastTryMs < THROTTLE_MS) return null;
      var url = nodeUrl();
      if (!url) return null;
      if (typeof Chain === "undefined" || !Chain || typeof Chain.connect !== "function") return null;
      lastTryMs = now;
      var p = Chain.connect(url);
      if (p && typeof p.then === "function") {
        p.then(function () {
          try { delete fails[url]; } catch (e) { /* counts stand */ }
        }, function () {
          try { fails[url] = (fails[url] || 0) + 1; } catch (e) { /* count stands */ }
        });
      }
      return p;
    } catch (e) { return null; }
  }

  /* Fire-and-forget entry attempt (automated behavior). Never throws,
   * never returns a promise callers must handle. */
  function ensure() {
    try { reconnect(); } catch (e) { /* manual Retry remains */ }
  }

  /* Consecutive failures for a URL (0 when none). Never throws. */
  function failsFor(url) {
    try {
      var n = fails[url];
      if (typeof n === "number" && isFinite(n) && n > 0) return Math.floor(n);
    } catch (e) { /* zero below */ }
    return 0;
  }

  /* Settings anchor for node failover. Prefers HistoryNotice.actionLink
   * (pure DOM, keyed label); falls back to a manual #/settings anchor with
   * the same key/default so the drift gate sees one literal. Never throws;
   * returns null only when doc cannot create elements. */
  function settingsLink(doc, t) {
    function tt(key, dflt) {
      try {
        if (typeof t === "function") return t(key, dflt);
      } catch (e) { /* default below */ }
      return dflt;
    }
    try {
      if (typeof HistoryNotice !== "undefined" && HistoryNotice &&
          typeof HistoryNotice.actionLink === "function") {
        var a = HistoryNotice.actionLink(doc, t, "settings");
        if (a) return a;
      }
    } catch (e) { /* manual below */ }
    try {
      var m = doc.createElement("a");
      m.textContent = tt("notice.open_settings", "Open Settings");
      try { m.setAttribute("href", "#/settings"); } catch (e2) { /* label stands */ }
      try { m.style.minHeight = "44px"; } catch (e3) { /* native stands */ }
      return m;
    } catch (e) { return null; }
  }

  /* Wire a Retry button to handshake-first behavior.
   * Params: btn (button element, disabled during attempts), statusEl (muted
   *   aria-live line for Connecting…/unavailable feedback, may be null),
   *   retryFn (view re-render, called when already open and after a
   *   successful handshake), t (caller i18n fn). The button keeps its
   *   caller-set label; status lines use global keys only. Never throws. */
  function wire(btn, statusEl, retryFn, t) {
    armOpenWatch();
    function tt(key, dflt) {
      try {
        if (typeof t === "function") return t(key, dflt);
      } catch (e) { /* default below */ }
      return dflt;
    }
    function say(text) {
      try { if (statusEl) statusEl.textContent = text; } catch (e) { /* button stands */ }
    }
    try {
      btn.addEventListener("click", function () {
        if (state() === "open") {
          try { retryFn(); } catch (e) { /* render carries it */ }
          return;
        }
        var attempt = null;
        try { attempt = reconnect(); } catch (e) { attempt = null; }
        if (!attempt || typeof attempt.then !== "function") {
          /* Throttled, already connecting, or no URL: fall back to the
           * plain re-render so the button never goes dead. */
          try { retryFn(); } catch (e) { /* render carries it */ }
          return;
        }
        try { btn.disabled = true; } catch (e) { /* label stands */ }
        say(tt("market.connecting", "Connecting to network…"));
        attempt.then(function () {
          try { btn.disabled = false; } catch (e) { /* stands */ }
          say("");
          try { retryFn(); } catch (e) { /* render carries it */ }
        }, function () {
          try { btn.disabled = false; } catch (e) { /* stands */ }
          var url = nodeUrl();
          var n = url ? failsFor(url) : 0;
          var base = tt("fees.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
          if (n >= 2) {
            say(tt("fees.retry", "Retry") + " " + String(n) + " — " + base);
          } else {
            say(base);
          }
        });
      });
    } catch (e) { /* button keeps any prior handler */ }
  }

  return {
    state: state,
    nodeUrl: nodeUrl,
    reconnect: reconnect,
    ensure: ensure,
    failsFor: failsFor,
    settingsLink: settingsLink,
    wire: wire
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.Offline === "undefined") { globalThis.Offline = Offline; }
if (typeof module !== "undefined") { module.exports = Offline; }
