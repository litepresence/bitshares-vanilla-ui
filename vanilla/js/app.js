/* App: boot wiring (settings -> theme -> router -> chain connect).
 * Owns: boot/finishBoot sequencing, theme application, shell localization,
 *   badge painting, settings-change reconnect. Consumes: Store.loadSettings/
 *   subscribe (sole settings owner, read-only), Router.start, Chain.connect,
 *   I18n.loadCached/t (guarded fallbacks). Side effects: sets
 *   data-theme + shell strings + #view content, opens the chain socket,
 *   subscribes to settings/connection topics. Created by:
 *   building-vanilla-slices skill, slice-01-shell-settings plan. */
var App = (function () {
  "use strict";

  var lastNode = null, lastNetwork = null, lastTheme = null;

  /* Batch-1 i18n (slice-17 Task 2): localize the static shell chrome that
   * lives in index.html (brand, nav links, menu toggle, initial badge).
   * Called at boot and after every locale switch; the dynamic connection
   * badge (paintBadge states) stays English until its per-view batch. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Explicit per-link calls (not a loop over dynamic keys) so the
   * check_i18n.py drift gate scans every default against en.json. */
  function localizeNav(nav) {
    var a;
    a = nav.querySelector('a[href="#/"]');
    if (a) a.textContent = t("nav.dashboard", "Dashboard");
    a = nav.querySelector('a[href="#/market/BTS_USD"]');
    if (a) a.textContent = t("nav.exchange", "Exchange");
    a = nav.querySelector('a[href="#/account/overview"]');
    if (a) a.textContent = t("nav.account", "Account");
    a = nav.querySelector('a[href="#/transfer"]');
    if (a) a.textContent = t("nav.transfer", "Transfer");
    a = nav.querySelector('a[href="#/explorer"]');
    if (a) a.textContent = t("nav.explorer", "Explorer");
    a = nav.querySelector('a[href="#/voting"]');
    if (a) a.textContent = t("nav.voting", "Voting");
    a = nav.querySelector('a[href="#/settings"]');
    if (a) a.textContent = t("nav.settings", "Settings");
  }

  /* localizeShell: paints static index.html chrome in the current locale.
   *   Params: none. Returns nothing. Fails: never throws — missing DOM nodes
   *   are skipped, I18n failures keep previous strings. */
  function localizeShell() {
    if (typeof document === "undefined") return;
    try {
      var brand = document.querySelector(".brand");
      if (brand) brand.textContent = t("shell.brand", "BitShares");
      var toggle = document.getElementById("nav-toggle");
      if (toggle) toggle.setAttribute("aria-label", t("shell.menu", "Menu"));
      var nav = document.getElementById("nav");
      if (nav) localizeNav(nav);
      var badge = document.getElementById("conn-badge");
      if (badge && badge.getAttribute("data-state") === "unknown") {
        badge.textContent = t("shell.badge_initial", "connecting…");
      }
    } catch (e) { /* shell keeps previous strings */ }
  }

  function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
  }

  /* paintBadge: connection status -> #conn-badge. Params: status ({state,
   *   chainId, latencyMs}). Returns nothing. Fails: never — a missing badge
   *   is a no-op, unknown states render as their state name. */
  function paintBadge(status) {
    var badge = document.getElementById("conn-badge");
    if (!badge) return;
    var s = status || {};
    var state = s.state || "unknown";
    badge.setAttribute("data-state", state);
    badge.textContent = state === "open"
      ? "connected · " + String(s.chainId || "").slice(0, 8) + " · " + s.latencyMs + "ms"
      : state;
  }

  /* paintFooter: persistent status bar (dexux-ref footer cue: version left,
   *   latency/block right). Params: status ({state, node, latencyMs,
   *   headBlock}). Returns nothing. Fails: never — missing footer is a
   *   no-op. No sockets: reads the connection status only (head block is the
   *   connect-time value Chain stashes; it refreshes on reconnect). */
  function paintFooter(status) {
    var foot = document.getElementById("appfoot-status");
    if (!foot) return;
    var s = status || {};
    if (s.state === "open") {
      var host = shortHost(s.node);
      var lat = (s.latencyMs !== null && s.latencyMs !== undefined) ? s.latencyMs + "ms" : "—";
      var blk = s.headBlock ? " / BLOCK #" + String(s.headBlock) : "";
      foot.textContent = (host ? host + " · " : "") + "LATENCY " + lat + blk;
    } else {
      foot.textContent = (s.state && s.state !== "unknown") ? String(s.state) : "connecting…";
    }
  }

  /* shortHost: wss:// URL -> bare host (footer node label; the ref shows
   *   geographic names we don't have, so the host is the honest label).
   *   Params: url string. Returns host or "". Fails: never throws. */
  function shortHost(url) {
    try {
      var m = /^wss?:\/\/([^/]+)/.exec(String(url || ""));
      return m ? m[1] : "";
    } catch (e) {
      return "";
    }
  }

  /* connect: opens the chain socket (failures via connection events).
   *   Params: node (wss:// URL string). Returns nothing. Fails: never throws —
   *   Chain.connect rejections are swallowed; the badge carries the error. */
  function connect(node) {
    if (node) Chain.connect(node).catch(function () { /* failures surface via connection events */ });
  }

  function onSettings(next) {
    if (!next) return;
    if (next.theme !== lastTheme) { lastTheme = next.theme; applyTheme(next.theme); }
    if (next.activeNode !== lastNode || next.network !== lastNetwork) {
      lastNetwork = next.network; lastNode = next.activeNode; connect(next.activeNode);
    }
  }

  /* boot: settings -> theme -> locale -> router -> chain connect. Params:
   *   none. Returns the loaded settings. Fails: never throws — a missing
   *   I18n falls back to sync English boot via t() defaults. */
  function boot() {
    var settings = Store.loadSettings();
    lastTheme = settings.theme; lastNetwork = settings.network; lastNode = settings.activeNode;
    applyTheme(settings.theme);
    /* Persisted locale first (I18n.loadCached reads the pref + {v:1} dict
     * cache, never throws): shell strings render in the stored language on
     * first paint, then the router draws the view. Load failure keeps
     * English via the t() defaults — identical by construction. */
    function ready() {
      localizeShell();
      Router.start(document.getElementById("view"));
      finishBoot(settings);
    }
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.loadCached === "function") {
        I18n.loadCached().then(ready, ready);
        return settings;
      }
    } catch (e) { /* sync boot below */ }
    ready();
    return settings;
  }

  function finishBoot(settings) {
    Store.subscribe("connection", paintBadge);
    Store.subscribe("connection", paintFooter);
    try { paintFooter(typeof Chain !== "undefined" && Chain ? Chain.status() : null); } catch (e) { /* badge carries errors */ }
    Store.subscribe("settings", onSettings);
    var toggle = document.getElementById("nav-toggle");
    var nav = document.getElementById("nav");
    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    connect(settings.activeNode);
  }

  /* Classic script: auto-boot in browsers only; require() under node stays side-effect free. */
  if (typeof document !== "undefined") boot();

  return { boot: boot, localizeShell: localizeShell };
})();

if (typeof module !== "undefined") { module.exports = App; }
