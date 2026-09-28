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

  /* Full-route shell nav (mega-menu repair): every router.js list route is
   *   one link, grouped Wallet / Exchange / Governance / Explorer / More.
   *   #1 MenuDataStructure.js:66-152 spreads the same areas across its header
   *   + burger dropdown; vanilla does the same split: #nav holds ONLY the
   *   original 7-link bar (ORIGINAL_NAV below), and the full 46-link grouped
   *   directory lives in a #nav-directory panel inside #nav, visible ONLY
   *   while #nav.open (hamburger toggle + aria-expanded in finishBoot are
   *   untouched; the toggle is forced visible at all widths so desktop
   *   reaches every route too). Rendering all 46 links inline wrapped into a
   *   3-row desktop mega-menu (seen in /tmp/grid-2560-tall.png) — never again.
   *   Detail routes (/pools/:id, /proposals/:id, /asset/:symbol,
   *   /block/:height, …) open from their list parents — as in #1, where rows
   *   link to details — so only list routes get links. FIX vs the old nav:
   *   "#/account/overview" resolved as an account literally named "overview"
   *   (AccountUI only special-cases "me"); it now points at "#/account/me". */
  var NAV_GROUPS = [
    { heading: "Wallet", hrefs: ["#/", "#/account/me", "#/accounts", "#/transfer",
      "#/invoice", "#/wallet", "#/wallet/password", "#/create-wallet-brainkey",
      "#/existing-account", "#/create-account", "#/login", "#/registration",
      "#/vesting", "#/authorities", "#/lists", "#/referrals"] },
    { heading: "Exchange", hrefs: ["#/market/BTS_USD", "#/instant-trade", "#/pools",
      "#/swap", "#/borrow", "#/barter", "#/deposit-withdraw", "#/samet"] },
    { heading: "Governance", hrefs: ["#/voting", "#/proposals", "#/create-worker",
      "#/credit-offer", "#/direct-debit", "#/spotlight", "#/tickets", "#/airdrop",
      "#/htlc", "#/prediction"] },
    { heading: "Explorer", hrefs: ["#/explorer", "#/assets", "#/assets/create",
      "#/assets/issue", "#/assets/feed", "#/fees", "#/ops", "#/news"] },
    { heading: "More", hrefs: ["#/settings", "#/alerts", "#/favourites", "#/help"] }
  ];

  /* ORIGINAL_NAV: the 7-link header bar — the pre-existing static index.html
   *   set (Dashboard, Exchange, Account, Transfer, Explorer, Voting, Settings;
   *   the NAV_ICONS keys below). "#/account/me" keeps the FIX noted above. */
  var ORIGINAL_NAV = ["#/", "#/market/BTS_USD", "#/account/me", "#/transfer",
    "#/explorer", "#/voting", "#/settings"];

  /* Nav icons (icon-wiring pass): href -> vendored icon name. Mapping cites
   *   #1 MenuDataStructure.js:182-299 (dashboard:194, trade:214, server:242,
   *   transfer:251, cogs:296); "user"/"voting" are the same icons-loader.js
   *   names #1 uses for account/voting affordances. Icons are decorative
   *   (aria-hidden <img>); the label span keeps the accessible name, so
   *   routing, order, and i18n strings are untouched — skin only. Only the
   *   seven original links are iconified; grouped links stay text until an
   *   icon pass maps them (plain text never breaks). */
  var NAV_ICONS = {
    "#/": "dashboard",
    "#/market/BTS_USD": "trade",
    "#/account/me": "user",
    "#/transfer": "transfer",
    "#/explorer": "server",
    "#/voting": "voting",
    "#/settings": "cogs"
  };

  /* Explicit per-href labels (not a data-driven t() loop) so the
   * check_i18n.py drift gate scans every default against en.json. Hrefs
   * with no title key use plain hardcoded English, like router.js route
   * titles — never a t() call with an unknown key. */
  function navText(href) {
    switch (href) {
      case "#/": return t("nav.dashboard", "Dashboard");
      case "#/account/me": return t("account.s4", "My Account");
      case "#/accounts": return t("account.manager_title", "Accounts");
      case "#/transfer": return t("nav.transfer", "Transfer");
      case "#/invoice": return t("misc.title", "Invoice");
      case "#/wallet": return t("wallet.title", "Wallet");
      case "#/wallet/password": return t("password.change_wallet_password", "Change wallet password");
      case "#/create-wallet-brainkey": return t("wallet.s4", "Create Wallet (Brainkey)");
      case "#/existing-account": return t("password.import_existing_account", "Import existing account");
      case "#/create-account": return t("account.register_short", "Register a new account");
      case "#/login": return t("auth.login", "Login");
      case "#/registration": return t("auth.registration", "Registration");
      case "#/vesting": return t("vesting.title", "Vesting");
      case "#/authorities": return t("misc.custom_authorities", "Custom Authorities");
      case "#/lists": return t("misc.account_lists", "Account Lists");
      case "#/referrals": return "Referrals";
      case "#/market/BTS_USD": return t("nav.exchange", "Exchange");
      case "#/instant-trade": return "Instant Trade";
      case "#/pools": return t("pools.title", "Liquidity Pools");
      case "#/swap": return t("swap.title", "Swap");
      case "#/borrow": return t("borrow.title", "Borrow");
      case "#/barter": return t("barter.title", "Barter");
      case "#/deposit-withdraw": return t("gateway.title", "Deposit / Withdraw");
      case "#/samet": return t("samet.title", "Same-T Funds");
      case "#/voting": return t("nav.voting", "Voting");
      case "#/proposals": return t("proposals.title", "Proposals");
      case "#/create-worker": return "Create Worker";
      case "#/credit-offer": return t("credit.title", "Credit Offer");
      case "#/direct-debit": return t("debit.title", "Direct Debit");
      case "#/spotlight": return "Spotlight";
      case "#/tickets": return t("tickets.title", "Tickets");
      case "#/airdrop": return "Airdrop";
      case "#/htlc": return t("htlc.title", "HTLC");
      case "#/prediction": return "Prediction Markets";
      case "#/explorer": return t("nav.explorer", "Explorer");
      case "#/assets": return t("assets.title", "Assets");
      case "#/assets/create": return t("assets_manage.title", "Create Asset");
      case "#/assets/issue": return "Issue Asset";
      case "#/assets/feed": return t("assets_feed.title", "Publish Feed");
      case "#/fees": return t("fees.network_fees", "Network fees");
      case "#/ops": return "Top Operations";
      case "#/news": return t("news.news", "News");
      case "#/settings": return t("nav.settings", "Settings");
      case "#/alerts": return t("notify.title", "Price Alerts");
      case "#/favourites": return t("favourites.favourites", "Favourites");
      case "#/help": return t("help.help", "Help");
      default: return href;
    }
  }

  /* buildNavLink: one <a> for an href (icon + label span when the href is
   *   icon-mapped, else plain text). Params: href string, iconOK bool.
   *   Returns the anchor. Fails: never throws — Icon failures fall back to
   *   plain text. */
  function buildNavLink(href, iconOK) {
    var a = document.createElement("a");
    a.setAttribute("href", href);
    var label = navText(href);
    var icon = NAV_ICONS[href];
    try {
      if (icon && iconOK) {
        a.appendChild(Icon.img(icon, "nav-icon", ""));
        var span = document.createElement("span");
        span.className = "nav-label";
        span.textContent = label;
        a.appendChild(span);
      } else {
        a.textContent = label;
      }
    } catch (e) { a.textContent = label; }
    return a;
  }

  /* buildDirectory: the grouped 46-link directory panel (lives inside #nav,
   *   shown only while #nav.open — see syncDirectory). Styling is inline and
   *   token-driven (var(--panel)/var(--text)/var(--border)) so all three
   *   themes keep working with app.css/themes.css untouched. Directory links
   *   reuse #nav a rules (the panel sits inside #nav). Params: iconOK bool.
   *   Returns the panel div. Fails: never throws — callers guard. */
  function buildDirectory(iconOK) {
    var panel = document.createElement("div");
    panel.id = "nav-directory";
    try {
      panel.style.display = "none";
      panel.style.position = "absolute";
      panel.style.top = "100%"; panel.style.left = "0"; panel.style.right = "0";
      panel.style.zIndex = "50";
      panel.style.background = "var(--panel)"; panel.style.color = "var(--text)";
      panel.style.borderBottom = "1px solid var(--border)";
      panel.style.padding = "12px 16px";
      panel.style.maxHeight = "70vh"; panel.style.overflowY = "auto";
    } catch (e) { /* unstyled panel stands */ }
    NAV_GROUPS.forEach(function (group) {
      var section = document.createElement("div");
      section.className = "nav-dir-group";
      try { section.style.margin = "0 0 10px"; } catch (e) { /* stands */ }
      var head = document.createElement("span");
      head.className = "nav-group";
      head.textContent = group.heading;
      try { head.style.fontWeight = "700"; head.style.display = "block"; head.style.margin = "0 0 4px"; } catch (e) { /* unstyled heading stands */ }
      section.appendChild(head);
      var row = document.createElement("div");
      try { row.style.display = "flex"; row.style.flexWrap = "wrap"; row.style.gap = "4px"; } catch (e) { /* vertical stack stands */ }
      group.hrefs.forEach(function (href) {
        row.appendChild(buildNavLink(href, iconOK));
      });
      section.appendChild(row);
      panel.appendChild(section);
    });
    return panel;
  }

  /* syncDirectory: panel visibility follows #nav.open. Params: nav element.
   *   Returns nothing. Fails: never throws — a missing panel is a no-op. */
  function syncDirectory(nav) {
    try {
      var panel = nav.querySelector("#nav-directory");
      if (!panel) return;
      panel.style.display = nav.classList.contains("open") ? "block" : "none";
    } catch (e) { /* panel keeps prior state */ }
  }

  /* buildNav: 7-link bar + burger directory (idempotent; preserves the .open
   *   hamburger state so a locale switch never collapses the menu). Params:
   *   nav element. Returns nothing. Fails: never throws — without Icon
   *   (script order) links keep plain text. */
  function buildNav(nav) {
    if (!nav || typeof document === "undefined") return;
    var wasOpen = nav.classList.contains("open");
    var iconOK = (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function");
    try { nav.style.position = "relative"; } catch (e) { /* static CSS stands */ }
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    ORIGINAL_NAV.forEach(function (href) {
      nav.appendChild(buildNavLink(href, iconOK));
    });
    /* Burger-menu theme copy (rebuilt with the nav so locale switches and
     * re-renders never lose it; the current theme is re-read inside). Sits
     * on the bar — reachable without opening the directory. */
    try {
      nav.appendChild(buildThemeSwitcher(document, "nav", false));
    } catch (e) { /* nav works without the theme copy */ }
    /* Grouped directory: every NAV_GROUPS link, visible only while open. */
    try {
      nav.appendChild(buildDirectory(iconOK));
    } catch (e) { /* bar works without the directory */ }
    if (wasOpen) nav.classList.add("open");
    syncDirectory(nav);
  }

  /* ensureToggleIcon: paint the ☰ menu button with the vendored hamburger
   *   glyph (#1 Header.jsx:477-489 hamburger/hamburger-x). Decorative only;
   *   the click handler + aria-expanded in finishBoot are untouched. */
  function ensureToggleIcon(toggle) {
    if (!toggle || typeof document === "undefined") return;
    if (typeof Icon === "undefined" || !Icon || typeof Icon.img !== "function") return;
    try {
      if (toggle.getAttribute("data-iconified") === "true") return;
      while (toggle.firstChild) toggle.removeChild(toggle.firstChild);
      toggle.appendChild(Icon.img("hamburger", "nav-icon", ""));
      toggle.setAttribute("data-iconified", "true");
    } catch (e) { /* ☰ text stays */ }
  }

  /* localizeNav: rebuilds the grouped nav in the current locale (called at
   * boot and after every locale switch; the .open state survives). */
  function localizeNav(nav) {
    buildNav(nav);
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

  /* THEME_SWITCHER (user complaint: the switcher lived only in #/settings).
   *   #1 has NO header theme switch — the "themes" dropdown renders only on
   *   the settings page (SettingsEntry.jsx:100-113 case "themes";
   *   Settings.jsx:38 lists it among settings entries, :226-228 handle the
   *   case). Vanilla keeps that settings-page select (#1 parity) AND adds a
   *   compact header copy plus a burger-menu copy inside #nav, so the theme
   *   is visible/switchable from anywhere. Option list is the same three ids
   *   as settings-prefs.js buildTheme (settings-prefs.js:54) + Store THEMES
   *   (store.js:23) — keep all three in sync by hand (plain array; no module
   *   system here by design, and theme ids are identifiers, never localized).
   *   Behavior: native <select> (keyboard accessible: tab + arrows),
   *   min-height 44px touch target, change -> Store.saveSettings (the
   *   existing Store path; the settings subscription in onSettings flips
   *   data-theme instantly). Every copy re-syncs via syncThemeSwitchers on
   *   each settings emit. */
  var THEMES = ["ref-ui-theme", "vanilla-ui-theme", "dex-ux-theme"];

  /* setTheme: persist via the sole settings owner. Params: id (theme id
   *   string). Returns nothing. Fails: never throws — unknown ids are
   *   ignored, Store failures keep the current theme. Instant-apply flows
   *   through the existing settings subscription (onSettings->applyTheme). */
  function setTheme(id) {
    if (THEMES.indexOf(id) === -1) return;
    try {
      Store.saveSettings({ theme: id });
    } catch (e) { /* current theme stands */ }
  }

  /* currentTheme: read-only peek at the persisted theme. Params: none.
   *   Returns the theme id or "ref-ui-theme". Fails: never throws. */
  function currentTheme() {
    try {
      var s = Store.loadSettings();
      if (s && THEMES.indexOf(s.theme) !== -1) return s.theme;
    } catch (e) { /* default below */ }
    return "ref-ui-theme";
  }

  /* buildThemeSwitcher: one compact label+select pair. Params: doc, suffix
   *   (id suffix keeping the header/nav copies unique), onBar (true: the
   *   copy sits on the header bar -> header-token colors; false: the copy
   *   sits in #nav -> panel-token colors, so it stays readable on the light
   *   cream/white nav of vanilla-ui-theme). Returns the wrapper span.
   *   Fails: never throws — without Store the default stays selected.
   *   Layout styling is inline (themes.css owns color tokens only): 44px
   *   min-height; options get a fixed dark-on-light pair so the native popup
   *   stays readable even when the bar is dark. */
  function buildThemeSwitcher(doc, suffix, onBar) {
    var fg = onBar ? "var(--header-text)" : "var(--text)";
    var edge = onBar ? "var(--header-text)" : "var(--border)";
    var wrap = doc.createElement("span");
    wrap.className = "theme-switcher";
    try { wrap.style.display = "inline-flex"; wrap.style.alignItems = "center"; wrap.style.gap = "6px"; } catch (e) { /* unstyled stands */ }
    var label = doc.createElement("label");
    label.textContent = t("settings.theme_label", "Theme ");
    try { label.style.color = fg; label.style.fontSize = "0.9rem"; } catch (e) { /* inherit stands */ }
    var select = doc.createElement("select");
    select.id = "theme-switch-" + suffix;
    select.className = "theme-switcher-select";
    select.setAttribute("aria-label", t("settings.theme_label", "Theme "));
    try {
      select.style.minHeight = "44px"; select.style.maxWidth = "150px";
      select.style.background = "transparent"; select.style.color = fg;
      select.style.border = "1px solid " + edge; select.style.borderRadius = "6px";
    } catch (e) { /* native styling stands */ }
    THEMES.forEach(function (id) {
      var opt = doc.createElement("option");
      opt.value = id;
      opt.textContent = id;
      try { opt.style.color = "#111111"; opt.style.background = "#ffffff"; } catch (e) { /* native popup stands */ }
      select.appendChild(opt);
    });
    select.value = currentTheme();
    select.addEventListener("change", function () { setTheme(select.value); });
    label.appendChild(select);
    wrap.appendChild(label);
    return wrap;
  }

  /* syncThemeSwitchers: repaint every header/nav copy after a theme change
   *   from anywhere (settings page, another copy). Params: id (theme id).
   *   Returns nothing. Fails: never throws — missing DOM is a no-op. */
  function syncThemeSwitchers(id) {
    if (typeof document === "undefined" || THEMES.indexOf(id) === -1) return;
    try {
      Array.prototype.forEach.call(document.querySelectorAll("select.theme-switcher-select"), function (sel) {
        sel.value = id;
      });
    } catch (e) { /* copies keep stale selection until next rebuild */ }
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
    if (next.theme !== lastTheme) { lastTheme = next.theme; applyTheme(next.theme); syncThemeSwitchers(next.theme); }
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
    /* Header theme copy: sits on the bar before the hamburger toggle, so it
     * is visible without opening any menu (guarded: exactly one copy). */
    try {
      var topbar = document.querySelector(".topbar");
      if (topbar && toggle && !document.getElementById("theme-switch-header")) {
        topbar.insertBefore(buildThemeSwitcher(document, "header", true), toggle);
      }
    } catch (e) { /* settings-page select remains the switcher */ }
    if (nav) buildNav(nav);
    if (toggle) ensureToggleIcon(toggle);
    if (toggle) {
      /* Hamburger at ALL widths (mega-menu repair): app.css shows #nav-toggle
       * only at <=719px, but the grouped directory must open on desktop too,
       * so the toggle is forced visible inline (CSS files untouched). */
      try { toggle.style.display = "inline-flex"; toggle.style.alignItems = "center"; toggle.style.justifyContent = "center"; } catch (e) { /* CSS standing */ }
    }
    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        syncDirectory(nav);
      });
    }
    connect(settings.activeNode);
  }

  /* Classic script: auto-boot in browsers only; require() under node stays side-effect free. */
  if (typeof document !== "undefined") boot();

  return { boot: boot, localizeShell: localizeShell };
})();

if (typeof module !== "undefined") { module.exports = App; }
