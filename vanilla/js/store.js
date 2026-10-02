/* Store: tiny pub/sub + localStorage persistence. Sole settings owner.
 * Owns: settings envelope (network/activeNode/customNodes/theme/locale),
 *   DEFAULT_NODES/CHAIN_IDS constants, settings+connection topics.
 * Storage backend seam (extension-wrapper): reads/writes go through
 *   Store.backend {get(k), set(k,v), del(k)} — default wraps localStorage
 *   (sync, web-identical: same keys, same timing); the extension injects
 *   its chrome.storage-backed adapter via setBackend() before boot.
 *   Sync contract preserved: loadSettings/saveSettings stay synchronous
 *   (20+ call sites); view-state keys elsewhere (favs, last-market,
 *   dismissal flags, i18n cache, contacts, gateway cache, alerts) stay on
 *   direct localStorage by design — no secrets, extension-origin isolated.
 * Consumes: Store.backend only (never raw localStorage, never the socket).
 *   Side effects: backend reads/writes under SETTINGS_KEY, listener
 *   fan-out on emit. Created by: building-vanilla-slices skill,
 *   slice-01-shell-settings plan. */
var Store = (function () {
  "use strict";

  var SETTINGS_KEY = "bts-vanilla-settings-v1";

  /* Default node lists (latency-sorted live at probe time — order here is
   * fallback only). api.dex.trading added 2026-10-02 after the concurrent
   * discovery sweep proved it mainnet-fast (0.42s, chain-verified). */
  var DEFAULT_NODES = {
    mainnet: ["wss://api.bitshares.dev/ws", "wss://dex.iobanker.com/ws", "wss://node.xbts.io/ws", "wss://public.xbts.io/ws", "wss://cloud.xbts.io/ws", "wss://api.bts.mobi/ws", "wss://api.dex.trading/ws"],
    testnet: ["wss://testnet.xbts.io/ws", "wss://testnet.dex.trading/"]
  };

  var CHAIN_IDS = {
    mainnet: "4018d7844c78f6a6c41c6a552b898022310fc5dec06da467ee7905a8dad512c8",
    testnet: "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447"
  };

  var THEMES = ["ref-ui-theme", "vanilla-ui-theme", "dex-ux-theme"];

  /* THEME_MIGRATION: 2026-09-28 rename (original-blue->ref-ui-theme,
   *   light->vanilla-ui-theme, dark->dex-ux-theme). Applied in loadSettings
   *   only — the migrated value persists on the next saveSettings (which
   *   merges from loadSettings), so old envelopes self-heal with no extra
   *   write here. Params: none (lookup table). Fails: never (pure data). */
  var THEME_MIGRATION = {
    "original-blue": "ref-ui-theme",
    "light": "vanilla-ui-theme",
    "dark": "dex-ux-theme"
  };

  var listeners = { settings: [], connection: [] };

  /* Default backend: sync localStorage adapter. Sync on purpose — 20+
   * call sites use loadSettings() synchronously at boot; async-ification
   * is contained to Wallet (already async create/unlock). Extension pages
   * keep extension-origin localStorage for settings (isolated from page
   * origins); only the keystore envelope needs chrome.storage (Wallet).
   * Params: k string key. get returns string|null (never throws — missing
   *   storage, empty slot both yield null); set stringifies; del removes.
   * Fails: never throws (guarded; set/del swallow blocked/full storage). */
  var _defaultBackend = {
    get: function (k) {
      try {
        if (typeof localStorage === "undefined") return null;
        var raw = localStorage.getItem(k);
        return (raw === undefined) ? null : raw;
      } catch (e) { return null; }
    },
    set: function (k, v) {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(k, String(v));
      } catch (e) { /* blocked/full: in-memory value still emits */ }
    },
    del: function (k) {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.removeItem(k);
      } catch (e) { /* best-effort */ }
    }
  };

  var _backend = null;

  /* Active backend (default localStorage adapter until setBackend).
   * Params: none. Returns the {get,set,del} backend. Fails: never. */
  function _store() {
    return _backend || _defaultBackend;
  }

  /* setBackend: inject a {get(k), set(k,v), del(k)} backend (extension
   * entry point — call before boot; Store.backend is replaced so the new
   * object is live for later readers). Params: backend object. Fails: bad
   * shape throws. Never touches stored data (migration is the wrapper's). */
  function setBackend(b) {
    if (!b || typeof b.get !== "function" || typeof b.set !== "function" ||
      typeof b.del !== "function") {
      throw new Error("bad storage backend: need get/set/del functions");
    }
    _backend = b;
    api.backend = b;
  }

  /* baseSettings: fresh defaults (mainnet + first node + ref-ui-theme + en +
   *   ElasticSearch ON per owner ruling — community history is a main feature).
   *   Params: none. Returns a new settings object. Fails: never (pure). */
  function baseSettings() {
    return {
      network: "mainnet",
      activeNode: DEFAULT_NODES.mainnet[0],
      customNodes: [],
      theme: "ref-ui-theme",
      locale: "en",
      esEnabled: true
    };
  }

  /* readStored: raw persisted envelope or null. Params: none. Returns the
   *   parsed object or null. Fails: never throws — missing storage, empty
   *   slot, or bad JSON all return null. */
  function readStored() {
    var raw = null;
    try {
      raw = _store().get(SETTINGS_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  /* loadSettings: base defaults overlaid with validated stored fields.
   *   Params: none. Returns a fresh settings object. Fails: never throws —
   *   unknown network/theme fall back to defaults, non-string nodes filtered.
   *   Stored pre-rename theme ids pass through THEME_MIGRATION first, so a
   *   2026-09-27 envelope ("dark") loads as its successor ("dex-ux-theme"). */
  function loadSettings() {
    var base = baseSettings();
    var stored = readStored();
    if (!stored) return base;
    var network = (stored.network === "testnet" || stored.network === "mainnet") ? stored.network : base.network;
    var rawTheme = THEME_MIGRATION[stored.theme] || stored.theme;
    var theme = (THEMES.indexOf(rawTheme) !== -1) ? rawTheme : base.theme;
    var customNodes = Array.isArray(stored.customNodes)
      ? stored.customNodes.filter(function (u) { return typeof u === "string"; })
      : [];
    var fallbackNode = network === "testnet" ? DEFAULT_NODES.testnet[0] : DEFAULT_NODES.mainnet[0];
    var activeNode = (typeof stored.activeNode === "string" && stored.activeNode) ? stored.activeNode : fallbackNode;
    var locale = (typeof stored.locale === "string" && stored.locale) ? stored.locale : base.locale;
    /* esEnabled: pre-Phase-1 envelopes lack the key — default ON (owner ruling
     * 2026-10-02: community ES is a main feature). Only an explicit false
     * opts out, so old wallets gain history illumination, never lose it. */
    var esEnabled = (stored.esEnabled === false) ? false : true;
    return { network: network, activeNode: activeNode, customNodes: customNodes, theme: theme, locale: locale, esEnabled: esEnabled };
  }

  /* saveSettings: merges a patch onto current settings, persists + emits.
   *   Params: patch (object, optional — only known fields apply: strings,
   *   string arrays, and the esEnabled boolean). Returns the merged settings
   *   object. Fails: never throws — blocked/full storage still emits the
   *   in-memory value. */
  function saveSettings(patch) {
    var current = loadSettings();
    var next = {
      network: current.network,
      activeNode: current.activeNode,
      customNodes: current.customNodes,
      theme: current.theme,
      locale: current.locale,
      esEnabled: current.esEnabled
    };
    if (patch && typeof patch === "object") {
      if (typeof patch.network === "string") next.network = patch.network;
      if (typeof patch.activeNode === "string") next.activeNode = patch.activeNode;
      if (Array.isArray(patch.customNodes)) next.customNodes = patch.customNodes;
      if (typeof patch.theme === "string") next.theme = patch.theme;
      if (typeof patch.locale === "string") next.locale = patch.locale;
      if (typeof patch.esEnabled === "boolean") next.esEnabled = patch.esEnabled;
    }
    try {
      _store().set(SETTINGS_KEY, JSON.stringify(next));
    } catch (e) { /* storage blocked/full: keep in-memory value, still emit */ }
    emit("settings", next);
    return next;
  }

  /* subscribe: register a listener on a topic ("settings"/"connection").
   * Params: topic (string), fn (callback). Returns an unsubscribe closure.
   * Fails: never throws (unknown topics start empty; see emit for fan-out). */
  function subscribe(topic, fn) {
    if (!listeners[topic]) listeners[topic] = [];
    listeners[topic].push(fn);
    return function () {
      var arr = listeners[topic] || [];
      var i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    };
  }

  /* emit: fan-out to a topic's listeners (snapshot copy). Params: topic
   *   (string), data (any). Returns nothing. Fails: never — a throwing
   *   listener is swallowed so the store never breaks. */
  function emit(topic, data) {
    var arr = (listeners[topic] || []).slice();
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](data); } catch (e) { /* listener errors must not break the store */ }
    }
  }

  /* status: {state, node, latencyMs, chainId}; state in unknown|connecting|open|closed|error */
  function emitConnection(status) {
    emit("connection", status || {});
  }

  /* Raw explicitly-stored locale (or null): lets i18n.js prefer an
   * envelope value the user actually chose over its legacy standalone key
   * (loadSettings() merges base defaults, so it cannot make that
   * distinction). Slice-17. */
  function storedLocale() {
    var stored = readStored();
    return (stored && typeof stored.locale === "string" && stored.locale) ? stored.locale : null;
  }

  var api = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    storedLocale: storedLocale,
    subscribe: subscribe,
    emitConnection: emitConnection,
    backend: _defaultBackend,
    setBackend: setBackend,
    DEFAULT_NODES: DEFAULT_NODES,
    CHAIN_IDS: CHAIN_IDS
  };

  return api;
})();

/* Expose the single Store global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.Store === "undefined") { globalThis.Store = Store; }
if (typeof module !== "undefined") { module.exports = Store; }
