/* Boot: settings -> theme -> router -> chain connect; badge + theme follow the store. */
var App = (function () {
  "use strict";

  var lastNode = null, lastNetwork = null, lastTheme = null;

  function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
  }

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

  function boot() {
    var settings = Store.loadSettings();
    lastTheme = settings.theme; lastNetwork = settings.network; lastNode = settings.activeNode;
    applyTheme(settings.theme);
    Router.start(document.getElementById("view"));
    Store.subscribe("connection", paintBadge);
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
    return settings;
  }

  /* Classic script: auto-boot in browsers only; require() under node stays side-effect free. */
  if (typeof document !== "undefined") boot();

  return { boot: boot };
})();

if (typeof module !== "undefined") { module.exports = App; }
