/* App: boot wiring (settings -> theme -> router -> chain connect).
 * Owns: boot/finishBoot sequencing, theme application, shell localization,
 *   footer status painting, settings-change reconnect. Consumes: Store.loadSettings/
 *   subscribe (sole settings owner, read-only), Router.start, Chain.connect,
 *   I18n.loadCached/t (guarded fallbacks). Side effects: sets
 *   data-theme + shell strings + #view content, opens the chain socket,
 *   subscribes to settings/connection topics. Created by:
 *   building-vanilla-slices skill, slice-01-shell-settings plan. */
var App = (function () {
  "use strict";

  /**
   * @typedef {import('./api/types.js').TFunction} TFunction
   * @typedef {import('./api/types.js').ChainStatus} ChainStatus
   * @typedef {import('./api/types.js').CountResult} CountResult
   * @typedef {import('./api/types.js').PulseResult} PulseResult
   */

  var lastNode = null, lastNetwork = null, lastTheme = null;

  /** Batch-1 i18n (slice-17 Task 2): localize the static shell chrome that
   *   lives in index.html (brand, nav links, menu toggle).
   *   Called at boot and after every locale switch; connection status paints
   *   through the footer subscription only.
   * @param {string} key
   * @param {string} dflt
   * @returns {string} */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Headings burger + sitemap pages (menu-sitemap slice): #nav holds ONLY
   *   the original 5-link bar (ORIGINAL_NAV below), and the burger panel
   *   holds 6 heading links + one "All pages" overview link — each heading
   *   navigates to its #/menu/<slug> table-of-contents page, which lists
   *   that section's pages as styled cards with its own filter. The old
   *   46-link grouped directory + burger filter + per-account follow/send
   *   shortcuts are gone (follow moved to account-ui.js showAccount, where
   *   it is contextual; lock lives in the header; theme in header+settings).
   *   The heading table is MenuUI.SECTIONS (menu-ui.js, single source),
   *   consumed guarded with a label-only fallback so the burger never
   *   blanks when the script is missing. Detail routes (/pools/:id,
   *   /asset/:symbol, …) open from their list parents — as in #1 — so
   *   only sections get burger links. */
  var FALLBACK_SECTIONS = [
    { slug: "wallet", title: "Wallet" },
    { slug: "trade", title: "Trade" },
    { slug: "earn", title: "Earn & Protect" },
    { slug: "govern", title: "Govern" },
    { slug: "explore", title: "Explore" },
    { slug: "labs", title: "Labs & Personal" }
  ];

  /* ORIGINAL_NAV: the header bar mirrors #1 getHeader()
   *   (MenuDataStructure.js:66-75: dashboard/market/lending/explorer +
   *   poolmart inHeader Always) — Dashboard, Exchange, Credit Offer,
   *   Liquidity Pools, Explore. Account/Transfer/Voting/Settings live in the
   *   burger palette (as in #1's dropdown), reachable everywhere. */
  var ORIGINAL_NAV = ["#/", "#/market/BTS_USD", "#/credit-offer", "#/pools",
    "#/explorer"];

  /* Pool-market context (owner: Exchange tab follows the pool you're
   * visiting). Pool views publish their pair's QUOTE_BASE market id here;
   * the header Exchange link swaps to it (falling back to the default).
   * Transient UI state, never persisted — the router clears it off pool
   * routes so the tab never goes stale. Never throws. */
  var poolMarketID = null;
  /* validPoolMarket: QUOTE_BASE id with real symbols (never 1.2.x-style
   * object ids — those would misroute the desk). Params: id unknown.
   * Returns boolean. Pure, unit-tested. */
  function validPoolMarket(id) {
    if (typeof id !== "string") return false;
    var parts = id.toUpperCase().split("_");
    if (parts.length !== 2) return false;
    var ok = parts.every(function (p) {
      return /^[A-Z0-9.]{1,12}$/.test(p) && !/^1\.\d+\.\d+$/.test(p);
    });
    return !!ok;
  }
  function setPoolMarket(id) {
    try {
      poolMarketID = validPoolMarket(id) ? id.toUpperCase() : null;
    } catch (e) { poolMarketID = null; }
    refreshExchangeLink();
  }
  function poolMarket() { return poolMarketID; }
  /* refreshExchangeLink: point the header Exchange tab at the pool market
   * (or back at the default when cleared). Targeted DOM touch — no full
   * nav rebuild. Never throws (missing nav is a no-op). */
  function refreshExchangeLink() {
    try {
      if (typeof document === "undefined") return;
      var a = document.querySelector("a[data-nav-exchange]");
      if (!a) return;
      a.setAttribute("href", poolMarketID ? "#/market/" + poolMarketID : "#/market/BTS_USD");
      a.setAttribute("title", poolMarketID ? "#/market/" + poolMarketID : "#/market/BTS_USD");
    } catch (e) { /* link stands */ }
  }

  /* Nav icons (icon-wiring pass): href -> vendored icon name. Mapping cites
   *   #1 MenuDataStructure.js:182-299 (dashboard:194, trade:214, server:242;
   *   credit uses borrow: #1's deployment-unit asset renders as a blob at
   *   18px while the IcoMoon borrow glyph stays crisp — documented deviation,
   *   same link/target/label). "user"/"voting" are the same icons-loader.js
   *   names #1 uses for account/voting affordances. Icons are decorative
   *   (aria-hidden <img>); the label span keeps the accessible name, so
   *   routing, order, and i18n strings are untouched — skin only. Only the
   *   seven original links are iconified; grouped links stay text until an
   *   icon pass maps them (plain text never breaks). */
  var NAV_ICONS = {
    "#/": "dashboard",
    "#/market/BTS_USD": "trade",
    "#/credit-offer": "borrow",
    "#/pools": "poolmart",
    "#/explorer": "server"
  };

  /* Explicit per-href labels for the header bar links (not a data-driven
   *   t() loop) so the check_i18n.py drift gate scans every default against
   *   en.json. Menu page titles live in menu-ui.js SECTIONS (single source);
   *   this covers the bar only. Hrefs with no title key use plain hardcoded
   *   English, like router.js route titles — never a t() call with an
   *   unknown key. */
  function navText(href) {
    switch (href) {
      case "#/": return t("nav.dashboard", "Dashboard");
      case "#/market/BTS_USD": return t("nav.exchange", "Exchange");
      case "#/credit-offer": return t("credit.title", "Credit Offer");
      case "#/pools": return t("pools.title", "Liquidity Pools");
      case "#/explorer": return t("nav.explorer", "Explore");
      default: return href;
    }
  }

  /* buildNavLink: one <a> for an href (icon + label span when the href is
   *   icon-mapped, else plain text). Params: href string, iconOK bool.
   *   Returns the anchor. Fails: never throws — Icon failures fall back to
   *   plain text. */
  function buildNavLink(href, iconOK) {
    var a = document.createElement("a");
    /* Pool-context swap: the header Exchange tab follows the pool market
     * (setPoolMarket), falling back to the default pair. */
    if (href === "#/market/BTS_USD" && poolMarketID) href = "#/market/" + poolMarketID;
    a.setAttribute("href", href);
    if (href.indexOf("#/market/") === 0) a.setAttribute("data-nav-exchange", "true");
    try { if (href.indexOf("#/market/") === 0) a.setAttribute("title", href); } catch (e) { /* label stands */ }
    var label = navText(href);
    if (href.indexOf("#/market/") === 0 && label === href) label = t("nav.exchange", "Exchange");
    var icon = NAV_ICONS[href] || (href.indexOf("#/market/") === 0 ? "trade" : null);
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
    /* Active-route highlight (command-palette findability): exact hash match
     * gets aria-current; refreshed on every buildNav (boot, locale, hash). */
    try {
      var h = (typeof location !== "undefined" && location.hash) || "#/";
      if (h === href) a.setAttribute("aria-current", "page");
    } catch (e) { /* highlight skipped */ }
    return a;
  }

  /* buildDirectory: 6 sitemap heading links + overview link (lives inside
   *   #nav, shown only while #nav.open via app.css — no inline positioning).
   *   Headings come from MenuUI.SECTIONS when loaded (icon + localized title
   *   + page count), else the label-only fallback. Link click closes the
   *   panel (wired here); Esc + hashchange close it (wired once in
   *   finishBoot). Styling is class-driven in app.css so all three themes
   *   keep working. Returns the panel div. Never throws. */
  function buildDirectory(iconOK) {
    var panel = document.createElement("div");
    panel.id = "nav-directory";
    panel.setAttribute("role", "navigation");
    function headingLink(href, icon, label) {
      var a = document.createElement("a");
      a.setAttribute("href", href);
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
      a.addEventListener("click", function () { closeDirectory(true); });
      panel.appendChild(a);
      return a;
    }
    var sections = null;
    try {
      if (typeof MenuUI !== "undefined" && MenuUI && Array.isArray(MenuUI.SECTIONS)) sections = MenuUI.SECTIONS;
    } catch (e) { sections = null; }
    if (sections && sections.length) {
      sections.forEach(function (section) {
        var label = section.slug;
        try {
          var T = (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") ? I18n.t : null;
          label = T ? T(section.titleKey, section.titleDefault) : section.titleDefault;
          label += " (" + section.links.length + ")";
        } catch (e) { label = section.titleDefault || section.slug; }
        headingLink("#/menu/" + section.slug, section.icon, label);
      });
    } else {
      FALLBACK_SECTIONS.forEach(function (section) {
        headingLink("#/menu/" + section.slug, null, section.title);
      });
    }
    headingLink("#/menu", null, t("menu.all_pages", "All pages"));
    return panel;
  }

  /* closeDirectory: collapse #nav.open, refocus the toggle (focus-return).
   * Params: refocus bool. Never throws — missing DOM is a no-op. */
  function closeDirectory(refocus) {    try {
      var nav = document.getElementById("nav");
      var toggle = document.getElementById("nav-toggle");
      if (!nav || !nav.classList.contains("open")) return;
      nav.classList.remove("open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
      syncDirectory(nav);
      if (refocus && toggle && typeof toggle.focus === "function") toggle.focus();
    } catch (e) { /* menu keeps prior state */ }
  }

  /* syncDirectory: compat no-op — visibility is class-driven
   *   (#nav.open #nav-directory in app.css). Kept so callers never throw. */
  function syncDirectory(nav) { return; }

  /* buildNav: 5-link bar + sitemap headings (idempotent; preserves
   *   the .open state so a locale switch never collapses the menu). Theme
   *   switching lives in settings + the header-bar copy (finishBoot). */
  function buildNav(nav) {
    if (!nav || typeof document === "undefined") return;
    var wasOpen = nav.classList.contains("open");
    var iconOK = (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function");
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    ORIGINAL_NAV.forEach(function (href) {
      nav.appendChild(buildNavLink(href, iconOK));
    });
    /* Grouped directory: sitemap headings, visible only while open. */
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
   *   are skipped, I18n failures keep previous strings. The brand holds a
   *   logo <img> (branding.js:64-66 file, Header.jsx:399 height 40), so the
   *   shell string feeds its alt/aria-label — never textContent (that would
   *   wipe the image). Lock + footer actions repaint here too (called at boot,
   *   on locale switch, and on every hashchange). */
  function localizeShell() {
    if (typeof document === "undefined") return;
    try {
      var brand = document.querySelector(".brand");
      if (brand) {
        var logo = brand.querySelector("img.brand-logo");
        var name = t("shell.brand", "BitShares");
        if (logo) {
          logo.setAttribute("alt", name);
          brand.setAttribute("aria-label", name);
        } else {
          brand.textContent = name;
        }
      }
      var toggle = document.getElementById("nav-toggle");
      if (toggle) toggle.setAttribute("aria-label", t("shell.menu", "Menu"));
      paintLock();
      paintActingAs();
      paintFootActions();
      var nav = document.getElementById("nav");
      if (nav) localizeNav(nav);
    } catch (e) { /* shell keeps previous strings */ }
  }

  /* walletUnlockedNow: guarded peek at the keystore state. Params: none.
   *   Returns true when Wallet reports unlocked keys. Fails: never throws —
   *   unknown states read as locked (the safe direction). */
  function walletUnlockedNow() {
    try {
      if (typeof Wallet !== "undefined" && Wallet) {
        if (typeof Wallet.isUnlocked === "function") return !!Wallet.isUnlocked();
        if (Wallet.keys) return true;
      }
    } catch (e) { /* locked below */ }
    return false;
  }

  /* paintActingAs: username left of the lock (owner call). Unlocked ->
   * the wallet's own account name; locked (or any failure) -> the
   * viewing-as default committee-account (principle #9: acting-as defaults
   * to 1.2.0). Async resolve with a stale-guard (a lock landing mid-flight
   * keeps the default — fails toward locked, the safe direction). Called
   * from localizeShell (boot, hashchange, locale) and after lock toggles.
   * Params: none. Returns nothing. Fails: never throws. */
  var actingGen = 0;
  function paintActingAs() {
    if (typeof document === "undefined") return;
    var myGen = ++actingGen;
    var el = document.getElementById("acting-as");
    if (!el) return;
    function show(name, title) {
      if (myGen !== actingGen) return;
      try {
        el.textContent = name;
        el.setAttribute("title", title);
      } catch (e) { /* name stands */ }
    }
    if (!walletUnlockedNow()) {
      show("committee-account", t("shell.acting_default", "Viewing as committee-account (locked)"));
      return;
    }
    show("…", t("shell.acting_loading", "Resolving account…"));
    try {
      if (typeof Account === "undefined" || !Account ||
          typeof Account.myAccountId !== "function") {
        show("committee-account", t("shell.acting_default", "Viewing as committee-account (locked)"));
        return;
      }
      Account.myAccountId().then(function (id) {
        if (!id) { show("committee-account", t("shell.acting_default", "Viewing as committee-account (locked)")); return; }
        return Account.resolve(id).then(function (a) {
          if (!walletUnlockedNow()) {
            show("committee-account", t("shell.acting_default", "Viewing as committee-account (locked)"));
            return;
          }
          var name = (a && a.name) ? String(a.name) : String(id);
          show(name, t("shell.acting_unlocked", "Acting as ") + name);
        });
      }).catch(function () {
        show("committee-account", t("shell.acting_default", "Viewing as committee-account (locked)"));
      });
    } catch (e) {
      show("committee-account", t("shell.acting_default", "Viewing as committee-account (locked)"));
    }
  }
  /* paintLock: lock affordance next to the hamburger (Header.jsx:663-681).
   *   Unlocked -> vendored unlocked glyph, click locks in place; locked ->
   *   locked glyph linking to #/login. Params: none. Returns nothing. Fails:
   *   never throws — missing Wallet/Icon keeps the static 🔒 login link. */
  function paintLock() {
    if (typeof document === "undefined") return;
    var lock = document.getElementById("lock-toggle");
    if (!lock) return;
    var open = walletUnlockedNow();
    var iconOK = (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function");
    try {
      while (lock.firstChild) lock.removeChild(lock.firstChild);
      if (iconOK) lock.appendChild(Icon.img(open ? "unlocked" : "locked", "nav-icon", ""));
      else lock.textContent = open ? "🔓" : "🔒";
    } catch (e) { lock.textContent = open ? "🔓" : "🔒"; }
    lock.setAttribute("aria-label", open ? t("shell.lock", "Lock") : t("shell.unlock", "Unlock"));
    if (open) lock.setAttribute("href", "#/wallet");
    else lock.setAttribute("href", "#/login");
  }

  /* bindLockOnce: click behavior for #lock-toggle (wired once in finishBoot;
   *   painting stays in paintLock). Unlocked click locks the keystore in place
   *   and repaints; locked click follows the #/login link. Never throws. */
  function bindLockOnce() {
    if (typeof document === "undefined") return;
    var lock = document.getElementById("lock-toggle");
    if (!lock || lock.getAttribute("data-bound") === "true") return;
    lock.setAttribute("data-bound", "true");
    lock.addEventListener("click", function (ev) {
      if (!walletUnlockedNow()) return; /* follow #/login */
      try {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (typeof Wallet !== "undefined" && Wallet && typeof Wallet.lock === "function") Wallet.lock();
      } catch (e) { /* stays unlocked */ }
      paintLock();
      paintActingAs();
    });
  }

  /* paintFootActions: footer REPORT + HELP buttons (Footer.jsx:666-699
   *   introjs-launcher pair). REPORT is an external invite link (no locale);
   *   HELP reuses the help key and routes to the onboard-docs index (#/help,
   *   router.js /help/** -> HelpUI.renderHelp — verified present). Never throws. */
  function paintFootActions() {
    if (typeof document === "undefined") return;
    try {
      var report = document.getElementById("foot-report");
      if (report) report.textContent = t("shell.report", "REPORT");
      var help = document.getElementById("foot-help");
      if (help) help.textContent = t("help.help", "Help");
    } catch (e) { /* static skeleton stands */ }
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
  /* Human names for the header select (raw ids are identifiers, kept as
   * option values + in settings; the header shows names a person picks). */
  var THEME_NAMES = {
    "ref-ui-theme": "Classic",
    "vanilla-ui-theme": "Vanilla light",
    "dex-ux-theme": "DEX dark"
  };

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
      opt.textContent = THEME_NAMES[id] || id;
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

  /* paintFooter: persistent status bar — the connectivity signal (#1
   *   parity: the node location name carries the state in COLOR, vivid
   *   --live green when connected, red otherwise; no topbar badge).
   *   Right side is a two-line stack (original footer: host caps on line 1,
   *   latency/block grey caps on line 2) with REPORT/HELP spanning both rows
   *   via CSS (.appfoot-actions stretch). Left side carries the version
   *   string via paintVersion below.
   *   Params: status ({state, node, latencyMs, headBlock}). Returns nothing.
   *   Fails: never — missing footer is a no-op. */
  function paintFooter(status) {
    paintVersion(status);
    var foot = document.getElementById("appfoot-status");
    if (!foot) return;
    var s = status || {};
    var state = s.state || "unknown";
    while (foot.firstChild) foot.removeChild(foot.firstChild);
    var doc = foot.ownerDocument || document;
    function span(text, cls, st) {
      var n = doc.createElement("span");
      if (cls) n.className = cls;
      if (st) n.setAttribute("data-state", st);
      n.textContent = text;
      return n;
    }
    function line(cls) {
      var d = doc.createElement("div");
      d.className = cls;
      return d;
    }
    /* H1: a chain-id mismatch is a blocking message, not a quiet state —
     * host on line 1 (closed color), the expected-vs-got text on line 2. */
    if (s.mismatch) {
      var mhost = shortHost(s.node);
      var ml1 = line("appfoot-line1");
      if (mhost) ml1.appendChild(span(mhost, "appfoot-host", "closed"));
      else ml1.appendChild(span("error", "appfoot-host", "closed"));
      foot.appendChild(ml1);
      var ml2 = line("appfoot-line2");
      var mspan = span(String(s.mismatch), "appfoot-telemetry", null);
      mspan.title = String(s.mismatch);
      ml2.appendChild(mspan);
      foot.appendChild(ml2);
      return;
    }
    if (state === "open") {
      var host = shortHost(s.node);
      var lat = (s.latencyMs !== null && s.latencyMs !== undefined) ? s.latencyMs + "ms" : "—";
      var blk = s.headBlock ? " / BLOCK #" + String(s.headBlock) : "";
      var l1 = line("appfoot-line1");
      if (host) l1.appendChild(span(host, "appfoot-host", "open"));
      else l1.appendChild(span("—", "appfoot-host", "open"));
      foot.appendChild(l1);
      var l2 = line("appfoot-line2");
      l2.appendChild(span("LATENCY " + lat + blk, "appfoot-telemetry", null));
      foot.appendChild(l2);
    } else {
      var host = shortHost(s.node);
      var l1 = line("appfoot-line1");
      if (host) l1.appendChild(span(host, "appfoot-host", "closed"));
      else if (state && state !== "unknown") l1.appendChild(span(state, "appfoot-host", "closed"));
      else l1.appendChild(doc.createTextNode("connecting…"));
      foot.appendChild(l1);
      var l2 = line("appfoot-line2");
      if (host && state && state !== "unknown") l2.appendChild(span(state, "appfoot-telemetry", null));
      else l2.appendChild(doc.createTextNode(" "));
      foot.appendChild(l2);
    }
  }

  /* paintVersion: bottom-LEFT version string "BITSHARES <chainid8> • v1.0.0 •
   * Disclaimer" (original footer: chain prefix + disclaimer link; the app
   * version stamp was ruled in ship-day R8). The 8
   * chars come from Chain.status().chainId, uppercased; a missing chain id
   * omits the hash silently (prefix + disclaimer still paint — never blank,
   * never throws). Called from paintFooter so every connection event
   * refreshes it, plus once at boot. */
  function paintVersion(status) {
    if (typeof document === "undefined") return;
    var left = document.getElementById("appfoot-version");
    if (!left) return;
    try {
      var s = status || {};
      var hash = "";
      if (s.chainId !== null && s.chainId !== undefined && String(s.chainId)) {
        hash = " " + String(s.chainId).slice(0, 8).toUpperCase();
      } else {
        try {
          if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
            var cur = Chain.status() || {};
            if (cur.chainId !== null && cur.chainId !== undefined && String(cur.chainId)) {
              hash = " " + String(cur.chainId).slice(0, 8).toUpperCase();
            }
          }
        } catch (e) { /* hash stays omitted */ }
      }
      while (left.firstChild) left.removeChild(left.firstChild);
      var doc = left.ownerDocument || document;
      left.appendChild(doc.createTextNode("BITSHARES" + hash + " • v1.0.0 • "));
      var a = doc.createElement("a");
      a.setAttribute("href", "#/help");
      a.textContent = "Disclaimer";
      left.appendChild(a);
    } catch (e) { /* static skeleton stands */ }
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
   * H1 chain-id pin: after connect resolves, the answered chain id must
   *   equal Store.CHAIN_IDS for the active network. A mismatch (wrong-chain
   *   or aliased node) disconnects immediately and the footer carries a
   *   blocking mismatch message (expected vs got, first 8 chars each) —
   *   reads never silently follow the wrong chain.
   * Params: node (wss:// URL string). Returns nothing. Fails: never throws —
   *   Chain.connect rejections are swallowed; the footer carries the error. */
  function connect(node) {
    if (!node) return;
    Chain.connect(node).then(function (r) {
      try {
        var st = Store.loadSettings();
        var exp = Store.CHAIN_IDS && Store.CHAIN_IDS[st.network];
        var got = r && r.chainId;
        if (exp && got && String(got).toLowerCase() !== String(exp).toLowerCase()) {
          try { Chain.disconnect(); } catch (discErr) { /* state below */ }
          var msg = "CHAIN-ID MISMATCH on " + shortHost(node) + ": expected " +
            String(exp).slice(0, 8).toUpperCase() + ", got " +
            String(got).slice(0, 8).toUpperCase() + ". Disconnected — check Settings → Nodes.";
          try {
            Store.emitConnection({state: "error", node: node, chainId: got, mismatch: msg});
          } catch (emitErr) { /* footer keeps prior state */ }
        }
      } catch (pinErr) { /* pin best-effort; the socket stays connected */ }
    }).catch(function () { /* failures surface via connection events */ });
  }

  /* onSettings: settings-emit fan-out (theme apply + node reconnect on
   * change). Params: next (settings object). Returns nothing. Fails: never
   * throws — connect failures surface via connection events. */
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

  /* compatMissing: feature-detect the platform APIs the wallet genuinely
   *   needs (R1c dead-browser notice — feature detection, NOT UA sniffing).
   *   #1 sniffed navigator.userAgent for firefox/chrome/edge
   *   (App.jsx:345-356) and upsold Chrome via a google.com link
   *   (BrowserSupportModal.jsx:9-15); vanilla refuses both the sniff and
   *   the upsell. Gates on actually-required APIs only: WebSocket (chain
   *   socket), WebCrypto subtle (keystore digest), BigInt (money math),
   *   and local storage (localStorage and/or IndexedDB — either one keeps
   *   settings alive). Params: none. Returns an array of missing capability
   *   names (identifiers, never localized). Empty = fully supported.
   *   Fails: never throws — a detection fault counts as missing, never as
   *   a boot block. */
  function compatMissing() {
    var missing = [];
    try {
      if (typeof WebSocket !== "function" && typeof WebSocket !== "object") missing.push("WebSocket");
    } catch (e) { missing.push("WebSocket"); }
    try {
      var subtle = null;
      if (typeof crypto !== "undefined" && crypto) subtle = crypto.subtle || /** @type {any} */ (crypto).webkitSubtle;
      if (!subtle || typeof subtle.digest !== "function") missing.push("WebCrypto");
    } catch (e) { missing.push("WebCrypto"); }
    try {
      if (typeof BigInt !== "function") missing.push("BigInt");
    } catch (e) { missing.push("BigInt"); }
    try {
      var storageOK = false;
      try {
        if (typeof localStorage !== "undefined" && localStorage) {
          localStorage.setItem("bts-vanilla-compat-probe", "1");
          localStorage.removeItem("bts-vanilla-compat-probe");
          storageOK = true;
        }
      } catch (e) { storageOK = false; }
      if (!storageOK) {
        try {
          if (typeof indexedDB !== "undefined" && indexedDB) storageOK = true;
        } catch (e2) { /* stays false */ }
      }
      if (!storageOK) missing.push("local storage");
    } catch (e) { missing.push("local storage"); }
    return missing;
  }

  /* finishBoot: wire footer + settings subscriptions and first paint.
   * Params: settings (Store envelope, already loaded). Returns nothing.
   * Fails: never — every DOM/storage touch is guarded; errors surface in
   *   the footer/banner inline. */
  function finishBoot(settings) {
    Store.subscribe("connection", paintFooter);
    try { paintFooter(typeof Chain !== "undefined" && Chain ? Chain.status() : null); } catch (e) { /* footer carries errors */ }
    Store.subscribe("settings", onSettings);
    /* Warning banner (static #1-parity notice): visible until dismissed;
     * dismissal persists in localStorage. Never throws — banner works
     * without storage (shows every boot) and without JS it stays visible. */
    try {
      var banner = document.getElementById("warn-banner");
      var dismiss = document.getElementById("warn-dismiss");
      if (banner) {
        var off = false;
        try { off = localStorage.getItem("bts-vanilla-warn-off-v1") === "1"; } catch (e) { /* shows */ }
        if (off) banner.setAttribute("hidden", "");
        if (dismiss) dismiss.addEventListener("click", function () {
          banner.setAttribute("hidden", "");
          try { localStorage.setItem("bts-vanilla-warn-off-v1", "1"); } catch (e) { /* session-only */ }
        });
      }
    } catch (e) { /* banner keeps static state */ }
    /* Dead-browser notice (R1c): a dismissible banner — NEVER a load gate —
     *   shown ONLY when compatMissing() reports something genuinely absent.
     *   Dismissal persists in localStorage (view-state flags stay on direct
     *   localStorage by design — store.js seam). Copy is neutral (no browser
     *   upsell, no google.com link — the link goes to #/help instead) and
     *   resolves via t() with en-identical stubs in all 10 locale dicts.
     *   Never throws — without DOM or storage the banner simply stays hidden. */
    try {
      var compat = document.getElementById("compat-banner");
      var cdismiss = document.getElementById("compat-dismiss");
      if (compat) {
        var missing = compatMissing();
        var compatOff = false;
        try { compatOff = localStorage.getItem("bts-vanilla-compat-off-v1") === "1"; } catch (e) { /* shows */ }
        if (missing.length > 0 && !compatOff) {
          compat.removeAttribute("hidden");
          var cmsg = document.getElementById("compat-msg");
          if (cmsg) {
            cmsg.textContent = /** @type {any} */ (t)("compat.msg", "Some features need a modern browser (WebSocket, WebCrypto, BigInt, local storage). Missing here: %(missing)s. Browsing still works — wallet signing may not.", { missing: missing.join(", ") });
          }
          var chelp = document.getElementById("compat-help");
          if (chelp) chelp.textContent = t("help.help", "Help");
        } else {
          compat.setAttribute("hidden", "");
        }
        if (cdismiss) {
          cdismiss.textContent = t("compat.dismiss", "Dismiss");
          cdismiss.addEventListener("click", function () {
            compat.setAttribute("hidden", "");
            try { localStorage.setItem("bts-vanilla-compat-off-v1", "1"); } catch (e) { /* session-only */ }
          });
        }
      }
    } catch (e) { /* banner keeps static state */ }
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
    bindLockOnce();
    /* M4a: extension-wrapper Tier 1 — the SW's vb-lock broadcast locks the
     * in-page keystore (auto-lock fan-out across open app pages). Unlock/
     * lock notices ride the other way from wallet.js _notifySw. Web build
     * has no chrome/browser namespace: guarded, best-effort, never throws. */
    try {
      var extNs = (typeof chrome !== "undefined" && chrome) ||
        (typeof browser !== "undefined" && browser);
      if (extNs && extNs.runtime && extNs.runtime.onMessage &&
          typeof extNs.runtime.onMessage.addListener === "function") {
        extNs.runtime.onMessage.addListener(function (msg) {
          try {
            if (msg && msg.type === "vb-lock" &&
                typeof Wallet !== "undefined" && Wallet && typeof Wallet.lock === "function") {
              Wallet.lock();
            }
          } catch (e) { /* lock best-effort */ }
        });
      }
    } catch (e) { /* web build: no extension messaging */ }
    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        syncDirectory(nav);
        /* Focus-return on close lives in closeDirectory; nothing to focus
         * on open (headings need no filter). Never throws. */
      });
      /* Esc closes + refocuses; route change closes without stealing focus. */
      try {
        document.addEventListener("keydown", function (ev) {
          if ((ev && ev.key === "Escape") || (ev && ev.keyCode === 27)) closeDirectory(true);
        });
        window.addEventListener("hashchange", function () {
          try {
            var n = document.getElementById("nav");
            var tg = document.getElementById("nav-toggle");
            if (n && n.classList.contains("open")) {
              n.classList.remove("open");
              if (tg) tg.setAttribute("aria-expanded", "false");
            }
          } catch (e) { /* menu keeps prior state */ }
          /* Active highlight follows the new hash on next rebuild. */
          try { if (typeof localizeShell === "function") localizeShell(); } catch (e) { /* highlight skips */ }
        });
      } catch (e) { /* click-toggle still works */ }
    }
    connect(settings.activeNode);
    try { if (typeof TxBuilderUI !== "undefined" && TxBuilderUI.mountBadge) TxBuilderUI.mountBadge(); } catch (e) { /* desk badge optional */ }
  }

  /* Classic script: auto-boot in browsers only; require() under node stays side-effect free. */
  if (typeof document !== "undefined") boot();

  return { boot: boot, localizeShell: localizeShell, setPoolMarket: setPoolMarket,
    _test: { validPoolMarket: validPoolMarket } };
})();

if (typeof module !== "undefined") { module.exports = App; }
