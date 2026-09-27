/* Store: tiny pub/sub + localStorage persistence. Sole settings owner.
 * Owns: settings envelope (network/activeNode/customNodes/theme/locale),
 *   DEFAULT_NODES/CHAIN_IDS constants, settings+connection topics.
 * Consumes: localStorage (readStored/saveSettings only, never the socket).
 *   Side effects: localStorage reads/writes under SETTINGS_KEY, listener
 *   fan-out on emit. Created by: building-vanilla-slices skill,
 *   slice-01-shell-settings plan. */
var Store = (function () {
  "use strict";

  var SETTINGS_KEY = "bts-vanilla-settings-v1";

  var DEFAULT_NODES = {
    mainnet: ["wss://api.bitshares.dev/ws", "wss://dex.iobanker.com/ws", "wss://node.xbts.io/ws", "wss://public.xbts.io/ws", "wss://cloud.xbts.io/ws", "wss://btsws.roelandp.nl/ws"],
    testnet: ["wss://testnet.xbts.io/ws", "wss://testnet.dex.trading/"]
  };

  var CHAIN_IDS = {
    mainnet: "4018d7844c78f6a6c41c6a552b898022310fc5dec06da467ee7905a8dad512c8",
    testnet: "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447"
  };

  var THEMES = ["original-blue", "light", "dark"];

  var listeners = { settings: [], connection: [] };

  /* baseSettings: fresh defaults (mainnet + first node + original-blue + en).
   *   Params: none. Returns a new settings object. Fails: never (pure). */
  function baseSettings() {
    return {
      network: "mainnet",
      activeNode: DEFAULT_NODES.mainnet[0],
      customNodes: [],
      theme: "original-blue",
      locale: "en"
    };
  }

  /* readStored: raw persisted envelope or null. Params: none. Returns the
   *   parsed object or null. Fails: never throws — missing storage, empty
   *   slot, or bad JSON all return null. */
  function readStored() {
    try {
      if (typeof localStorage === "undefined") return null;
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  /* loadSettings: base defaults overlaid with validated stored fields.
   *   Params: none. Returns a fresh settings object. Fails: never throws —
   *   unknown network/theme fall back to defaults, non-string nodes filtered. */
  function loadSettings() {
    var base = baseSettings();
    var stored = readStored();
    if (!stored) return base;
    var network = (stored.network === "testnet" || stored.network === "mainnet") ? stored.network : base.network;
    var theme = (THEMES.indexOf(stored.theme) !== -1) ? stored.theme : base.theme;
    var customNodes = Array.isArray(stored.customNodes)
      ? stored.customNodes.filter(function (u) { return typeof u === "string"; })
      : [];
    var fallbackNode = network === "testnet" ? DEFAULT_NODES.testnet[0] : DEFAULT_NODES.mainnet[0];
    var activeNode = (typeof stored.activeNode === "string" && stored.activeNode) ? stored.activeNode : fallbackNode;
    var locale = (typeof stored.locale === "string" && stored.locale) ? stored.locale : base.locale;
    return { network: network, activeNode: activeNode, customNodes: customNodes, theme: theme, locale: locale };
  }

  /* saveSettings: merges a patch onto current settings, persists + emits.
   *   Params: patch (object, optional — only known string/array fields apply).
   *   Returns the merged settings object. Fails: never throws — blocked/full
   *   storage still emits the in-memory value. */
  function saveSettings(patch) {
    var current = loadSettings();
    var next = {
      network: current.network,
      activeNode: current.activeNode,
      customNodes: current.customNodes,
      theme: current.theme,
      locale: current.locale
    };
    if (patch && typeof patch === "object") {
      if (typeof patch.network === "string") next.network = patch.network;
      if (typeof patch.activeNode === "string") next.activeNode = patch.activeNode;
      if (Array.isArray(patch.customNodes)) next.customNodes = patch.customNodes;
      if (typeof patch.theme === "string") next.theme = patch.theme;
      if (typeof patch.locale === "string") next.locale = patch.locale;
    }
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      }
    } catch (e) { /* storage blocked/full: keep in-memory value, still emit */ }
    emit("settings", next);
    return next;
  }

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

  return {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    storedLocale: storedLocale,
    subscribe: subscribe,
    emitConnection: emitConnection,
    DEFAULT_NODES: DEFAULT_NODES,
    CHAIN_IDS: CHAIN_IDS
  };
})();

/* Expose the single Store global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.Store === "undefined") { globalThis.Store = Store; }
if (typeof module !== "undefined") { module.exports = Store; }
