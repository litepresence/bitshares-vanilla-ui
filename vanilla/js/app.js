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
   * @param {Object} [vars] optional %(name)s values (viewing.header_locked/unlocked)
   * @returns {string} */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") {
      return dflt.replace(/%\(([^)]+)\)s/g, function (m, n) {
        return (vars[n] !== undefined) ? String(vars[n]) : m;
      });
    }
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
    /* Drawer focus target (lifecycle): focusable container so opening the
     * drawer can move focus inside it; harmless when never focused. */
    try { panel.setAttribute("tabindex", "-1"); } catch (e) { /* links stay tabbable */ }
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
      paintShieldBadge();
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
        /* Two-size rule (app.css #acting-as): 20+ char names (chain allows
         * 63) get the small wrapping style instead of the ellipsis. */
        try {
          el.setAttribute("data-long", String(name).length >= 20 ? "true" : "false");
        } catch (e) { /* size stands */ }
      } catch (e) { /* name stands */ }
    }
    if (!walletUnlockedNow()) {
      (function () {
        var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        if (v.name === "committee-account") show(v.name, t("viewing.header_default", "Viewing as committee-account (locked)"));
        else show(v.name, t("viewing.header_locked", "Viewing as %(name)s (locked) — tap to change", { name: v.name }));
      })();
      return;
    }
    show("…", t("shell.acting_loading", "Resolving account…"));
    try {
      if (typeof Account === "undefined" || !Account ||
          typeof Account.myAccountId !== "function") {
        (function () {
          var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
          if (v.name === "committee-account") show(v.name, t("viewing.header_default", "Viewing as committee-account (locked)"));
          else show(v.name, t("viewing.header_locked", "Viewing as %(name)s (locked) — tap to change", { name: v.name }));
        })();
        return;
      }
      Account.myAccountId().then(function (id) {
        if (!id) { (function () {
          var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
          if (v.name === "committee-account") show(v.name, t("viewing.header_default", "Viewing as committee-account (locked)"));
          else show(v.name, t("viewing.header_locked", "Viewing as %(name)s (locked) — tap to change", { name: v.name }));
        })(); return; }
        return Account.resolve(id).then(function (a) {
          if (!walletUnlockedNow()) {
            (function () {
              var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
              if (v.name === "committee-account") show(v.name, t("viewing.header_default", "Viewing as committee-account (locked)"));
              else show(v.name, t("viewing.header_locked", "Viewing as %(name)s (locked) — tap to change", { name: v.name }));
            })();
            return;
          }
          var name = (a && a.name) ? String(a.name) : String(id);
          show(name, t("viewing.header_unlocked", "Acting as %(name)s", { name: name }));
        });
      }).catch(function () {
        (function () {
          var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
          if (v.name === "committee-account") show(v.name, t("viewing.header_default", "Viewing as committee-account (locked)"));
          else show(v.name, t("viewing.header_locked", "Viewing as %(name)s (locked) — tap to change", { name: v.name }));
        })();
      });
    } catch (e) {
      (function () {
        var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        if (v.name === "committee-account") show(v.name, t("viewing.header_default", "Viewing as committee-account (locked)"));
        else show(v.name, t("viewing.header_locked", "Viewing as %(name)s (locked) — tap to change", { name: v.name }));
      })();
    }
  }
  /* paintLock: lock affordance next to the hamburger (Header.jsx:663-681).
   *   Unlocked -> green open-padlock PNG, click locks in place; locked ->
   *   red locked-padlock PNG linking to #/login (owner-supplied state art —
   *   color carries the state, same contract as the shield badge).
   *   Params: none. Returns nothing. Fails: never throws — missing
   *   Wallet/Icon keeps the static 🔒 login link. */
  function paintLock() {
    if (typeof document === "undefined") return;
    var lock = document.getElementById("lock-toggle");
    if (!lock) return;
    var open = walletUnlockedNow();
    var iconOK = (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function");
    try {
      while (lock.firstChild) lock.removeChild(lock.firstChild);
      if (iconOK) lock.appendChild(Icon.img(open ? "lock-open" : "lock-closed", "nav-icon icon-state", ""));
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

  /* bindViewingAsOnce: header #acting-as click (locked only) + repaint
   *   subscription. Locked click navigates to #/settings and scrolls the
   *   inline view-as section to the top of the viewport (goToViewingAs);
   *   the picker itself lives exactly once at the bottom of settings
   *   (settings.js appends ViewingAs.renderSection; the route clears its
   *   root first, so copies cannot accumulate). Unlocked clicks keep the
   *   wallet identity (no-op). Repaint flows through the ViewingAs
   *   subscription. Wired once in finishBoot next to bindLockOnce.
   *   Params: none. Returns nothing. Fails: never throws — missing
   *   ViewingAs/DOM is a no-op (safe direction: header keeps the 1.2.0
   *   default via paintActingAs). */
  function bindViewingAsOnce() {
    if (typeof document === "undefined") return;
    try {
      if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.subscribe === "function") {
        ViewingAs.subscribe(function () { paintActingAs(); });
      }
    } catch (e) { /* header keeps prior paint */ }
    var el = document.getElementById("acting-as");
    if (!el || el.getAttribute("data-viewing-bound") === "true") return;
    el.setAttribute("data-viewing-bound", "true");
    el.addEventListener("click", function () {
      try {
        if (walletUnlockedNow()) return; /* unlocked keeps wallet identity */
        goToViewingAs();
      } catch (e) { /* header stands */ }
    });
  }

  /* goToViewingAs: navigate to #/settings and bring #viewing-as to the top
   * of the viewport. Thin wrapper over goToSettingsSection (the shield
   * badge rides the same helper to #sign-block). */
  function goToViewingAs() {
    goToSettingsSection("viewing-as");
  }

  /* goToSettingsSection: navigate to #/settings and bring one section to
   * the top of the viewport. Params: targetId (string, element id).
   * Already-on-settings scrolls immediately; otherwise the hash change
   * re-renders first and a bounded poll (20 × 50ms) waits for the section.
   * scrollIntoView() bare (instant top-align — no smooth motion,
   * reduced-motion safe). Never throws — worst case the user lands on
   * settings unscrolled. */
  function goToSettingsSection(targetId) {
    if (typeof document === "undefined" || !targetId) return;
    try {
      if (typeof window !== "undefined" && window.location && window.location.hash !== "#/settings") {
        window.location.hash = "#/settings";
      }
    } catch (e) { /* poll below still tries */ }
    var tries = 0;
    (function poll() {
      var target = null;
      try { target = document.getElementById(targetId); } catch (e) { target = null; }
      if (target && target.scrollIntoView) {
        try { target.scrollIntoView(); } catch (e) { /* landed anyway */ }
        return;
      }
      tries++;
      if (tries < 20) setTimeout(poll, 50);
    })();
  }

  /* paintFootActions: footer REPORT + ABOUT + HELP buttons
   *   (Footer.jsx:666-699 introjs-launcher pair + about spec 2026-10-04).
   *   REPORT is an internal link to the Community page; ABOUT to #/about;
   *   HELP reuses the help key and routes to the docs index (#/help,
   *   router.js /help/** -> HelpUI.renderHelp — verified present). Never throws. */
  function paintFootActions() {
    if (typeof document === "undefined") return;
    try {
      var report = document.getElementById("foot-report");
      if (report) report.textContent = t("shell.report", "REPORT");
      var about = document.getElementById("foot-about");
      if (about) about.textContent = t("about.link", "About");
      var help = document.getElementById("foot-help");
      if (help) help.textContent = t("help.help", "Help");
    } catch (e) { /* static skeleton stands */ }
  }

  function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
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
      if (mhost) ml1.appendChild(span(netHostText(currentNetwork(), mhost), "appfoot-host", "closed"));
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
      var net = currentNetwork();
      if (host) l1.appendChild(span(netHostText(net, host), "appfoot-host", net === "testnet" ? "open-testnet" : "open"));
      else l1.appendChild(span(netHostText(net, "—"), "appfoot-host", net === "testnet" ? "open-testnet" : "open"));
      foot.appendChild(l1);
      var l2 = line("appfoot-line2");
      l2.appendChild(span("LATENCY " + lat + blk, "appfoot-telemetry", null));
      foot.appendChild(l2);
    } else {
      var host = shortHost(s.node);
      var l1 = line("appfoot-line1");
      var net2 = currentNetwork();
      if (host) l1.appendChild(span(netHostText(net2, host), "appfoot-host", "closed"));
      else if (state && state !== "unknown") l1.appendChild(span(netHostText(net2, state), "appfoot-host", "closed"));
      else l1.appendChild(doc.createTextNode(t("shell.badge_initial", "connecting…")));
      foot.appendChild(l1);
      var l2 = line("appfoot-line2");
      if (host && state && state !== "unknown") l2.appendChild(span(state, "appfoot-telemetry", null));
      else l2.appendChild(doc.createTextNode(" "));
      foot.appendChild(l2);
    }
  }

  /* Footer build-info pure helpers (spec 2026-10-04-footer-build-info-design:
   * no DOM, no fetch — the impure wiring below consumes these. Unit-tested
   * via _test; under node I18n is absent so t() falls back to the English
   * defaults, which check_i18n.py pins byte-equal to en.json). */
  var COMPARE_TTL_MS = 10 * 60 * 1000;
  var COMPARE_CACHE_KEY = "footerBuildCompare.v1";

  /**
   * version.json -> strict record or null (never throws, never partial).
   * @param {*} json parsed version.json
   * @returns {{repo: string, branch: string, commit: string, short: string, generated_at: string, ahead_of_master: number | null} | null} */
  function parseBuildInfo(json) {
    try {
      if (!json || typeof json !== "object") return null;
      var commit = String(json.commit || "");
      if (!/^[0-9a-f]{40}$/i.test(commit)) return null;
      var repo = String(json.repo || "");
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
      var branch = String(json.branch || "");
      if (!branch) return null;
      var low = commit.toLowerCase();
      var gen = (typeof json.generated_at === "string") ? json.generated_at : "";
      var ah = json.ahead_of_master;
      if (typeof ah !== "number" || !isFinite(ah) || Math.floor(ah) !== ah || ah < 0) ah = null;
      return { repo: repo, branch: branch, commit: low, short: low.slice(0, 7), generated_at: gen, ahead_of_master: ah };
    } catch (e) { return null; }
  }

  /**
   * GitHub compare payload -> counts or null (never throws).
   * @param {*} json parsed compare response
   * @returns {{ahead: number, behind: number, status: string} | null} */
  function parseCompare(json) {
    try {
      if (!json || typeof json !== "object") return null;
      var a = json.ahead_by, b = json.behind_by;
      if (typeof a !== "number" || typeof b !== "number" || !isFinite(a) || !isFinite(b)) return null;
      if (Math.floor(a) !== a || Math.floor(b) !== b || a < 0 || b < 0) return null;
      var st = String(json.status || "");
      if (st !== "identical" && st !== "ahead" && st !== "behind" && st !== "diverged") st = "";
      return { ahead: a, behind: b, status: st };
    } catch (e) { return null; }
  }

  /**
   * Compare endpoint for own commit vs branch tip (base...head with
   * base=branch, head=own SHA — verified 2026-10-04 to accept pushed SHAs).
   * @param {string} repo "owner/name"
   * @param {string} branch branch name
   * @param {string} commit 40-hex SHA
   * @returns {string} */
  function compareUrl(repo, branch, commit) {
    return "https://api.github.com/repos/" + repo + "/compare/" + branch + "..." + commit;
  }

  /**
   * Relation fragment for footer-left (Master link appended by caller).
   * @param {{ahead: number, behind: number}} cmp counts
   * @returns {string} */
  function relationText(cmp) {
    /** @type {{ahead?: number, behind?: number}} */
    var c = cmp || {};
    var a = (typeof c.ahead === "number" && c.ahead > 0) ? Math.floor(c.ahead) : 0;
    var b = (typeof c.behind === "number" && c.behind > 0) ? Math.floor(c.behind) : 0;
    if (a > 0 && b > 0) {
      return t("shell.footer_diverged", "diverged from") + " (" + t("shell.footer_dahead", "%(n)s ahead", { n: String(a) }) + ", " + t("shell.footer_dbehind", "%(n)s behind", { n: String(b) }) + ")";
    }
    if (a > 0) {
      if (a === 1) return t("shell.footer_ahead_one", "1 commit ahead of");
      return t("shell.footer_ahead", "%(n)s commits ahead of", { n: String(a) });
    }
    if (b > 0) {
      if (b === 1) return t("shell.footer_behind_one", "1 commit behind");
      return t("shell.footer_behind", "%(n)s commits behind", { n: String(b) });
    }
    return t("shell.footer_sync", "in sync with");
  }

  /**
   * Offbranch relation for 404 builds (SHA unknown to GitHub): counted
   * "N ahead of" from the generation-time git count when known, else the
   * plain fallback. Caller appends the Master link, then .note in parens.
   * @param {{ahead_of_master: number | null, generated_at: string}} info parsed build record
   * @returns {{rel: string, note: string | null}} */
  function offbranchText(info) {
    try {
      var a = info ? info.ahead_of_master : null;
      if (typeof a === "number" && isFinite(a) && Math.floor(a) === a && a > 0) {
        var rel = (a === 1) ? t("shell.footer_ahead_one", "1 commit ahead of") : t("shell.footer_ahead", "%(n)s commits ahead of", { n: String(a) });
        var date = String((info && info.generated_at) || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return { rel: rel, note: t("shell.footer_at_build", "at build %(date)s", { date: date }) };
        }
        return { rel: rel, note: null };
      }
    } catch (e) { /* fallback below */ }
    return { rel: t("shell.footer_offbranch", "not on Master"), note: null };
  }

  /**
   * Active network, sole source Store settings (guarded mainnet default).
   * @returns {string} "mainnet" or "testnet" */
  function currentNetwork() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* mainnet below */ }
    return "mainnet";
  }

  /**
   * Footer-right line-1 text with network prefix (caps come from CSS).
   * @param {string} network "mainnet"|"testnet"
   * @param {string} host bare host or status word
   * @returns {string} */
  function netHostText(network, host) {
    var label = (network === "testnet") ? t("settings.network_testnet", "testnet") : t("settings.network_mainnet", "mainnet");
    return t("shell.footer_net_host", "%(net)s - %(host)s", { net: label, host: String(host) });
  }

  /* Footer build-info wiring (impure: fetch + localStorage, all fail-open).
   * State: buildInfo (parsed version.json), buildCmp (null unknown |
   * {offbranch:true} | {ahead,behind,status}), buildCmpAt (ms stamp).
   * paintVersion renders current truth every call and kicks maybeRefreshCmp,
   * whose completion repaints — connection-event repaints never fetch
   * directly (TTL + cache, 60/hr unauthenticated GitHub budget respected). */
  var buildInfo = null, buildCmp = null, buildCmpAt = 0, buildFetching = false, buildBooted = false;

  /**
   * Fetch version.json once (same-origin; file:// failure falls to null).
   * @returns {Promise} resolves parsed record or null, never rejects */
  function loadBuildInfo() {
    if (typeof fetch === "undefined") return Promise.resolve(null);
    return fetch("version.json", { cache: "no-store" }).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json().catch(function () { return null; });
    }).then(function (j) {
      return parseBuildInfo(j);
    }).then(null, function () { return null; });
  }

  /**
   * Cached compare for this commit or null (commit mismatch/TTL = null).
   * @param {string} commit 40-hex SHA
   * @returns {{ahead: number, behind: number, status: string} | {offbranch: boolean} | null} */
  function readCmpCache(commit) {
    try {
      if (typeof localStorage === "undefined") return null;
      var raw = localStorage.getItem(COMPARE_CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || c.commit !== commit) return null;
      if (typeof c.at !== "number" || (Date.now() - c.at) > COMPARE_TTL_MS) return null;
      if (c.offbranch) return { offbranch: true };
      return parseCompare({ ahead_by: c.ahead, behind_by: c.behind, status: c.status });
    } catch (e) { return null; }
  }

  /**
   * Persist one compare result (best-effort, never throws).
   * @param {string} commit 40-hex SHA
   * @param {*} cmp compare record or {offbranch:true}
   * @returns {void} */
  function writeCmpCache(commit, cmp) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(COMPARE_CACHE_KEY, JSON.stringify({ commit: commit, ahead: cmp.ahead, behind: cmp.behind, status: cmp.status, offbranch: !!cmp.offbranch, at: Date.now() }));
    } catch (e) { /* cache optional */ }
  }

  /** Kick one guarded compare fetch; completion repaints. Never throws.
   * @returns {void} */
  function maybeRefreshCmp() {
    if (!buildInfo || buildFetching) return;
    if (typeof fetch === "undefined") return;
    if (buildCmp && (Date.now() - buildCmpAt) <= COMPARE_TTL_MS) return;
    var cached = readCmpCache(buildInfo.commit);
    if (cached) { buildCmp = cached; buildCmpAt = Date.now(); return; }
    buildFetching = true;
    fetch(compareUrl(buildInfo.repo, buildInfo.branch, buildInfo.commit), { headers: { "Accept": "application/vnd.github+json" } }).then(function (r) {
      if (!r) return null;
      if (r.status === 404) return { offbranch: true };
      if (!r.ok) return null;
      return r.json().catch(function () { return null; });
    }).then(function (j) {
      if (!j) { buildCmpAt = Date.now(); return; }
      var next = j.offbranch ? { offbranch: true } : parseCompare(j);
      if (!next) { buildCmpAt = Date.now(); return; }
      buildCmp = next; buildCmpAt = Date.now();
      writeCmpCache(buildInfo.commit, next);
      paintVersion();
    }).then(null, function () { buildCmpAt = Date.now(); /* hash-only stands */ }).then(function () { buildFetching = false; });
  }

  /** One-shot boot for build info (skeleton stands until info lands).
   * @returns {void} */
  function bootBuildInfo() {
    if (buildBooted) return;
    buildBooted = true;
    loadBuildInfo().then(function (info) {
      if (!info) return;
      buildInfo = info;
      paintVersion();
      maybeRefreshCmp();
    });
  }

  /* paintVersion: bottom-LEFT build string "BITSHARES VANILLA UI <short7>
   * · <relation> Master" (Master = branch-name identifier, hyperlinked to
   * the repo root from version.json; chain prefix retired per spec).
   * Ladder: full relation | offbranch counted/plain | hash-only |
   * skeleton (no version.json — bootBuildInfo fails open, skeleton stands).
   * Called from paintFooter so every connection event refreshes it. */
  function paintVersion() {
    if (typeof document === "undefined") return;
    var left = document.getElementById("appfoot-version");
    if (!left) return;
    try {
      if (!buildInfo) { bootBuildInfo(); return; }
      maybeRefreshCmp();
      while (left.firstChild) left.removeChild(left.firstChild);
      var doc = left.ownerDocument || document;
      left.appendChild(doc.createTextNode(t("shell.footer_brand_vanilla", "BITSHARES VANILLA UI") + " " + buildInfo.short + " · "));
      var cmpRel = null, cmpNote = null;
      if (buildCmp && buildCmp.offbranch) {
        var ob = offbranchText(buildInfo);
        cmpRel = ob.rel; cmpNote = ob.note;
      } else if (buildCmp) {
        cmpRel = relationText(buildCmp);
      }
      if (cmpRel) left.appendChild(doc.createTextNode(cmpRel + " "));
      var a = doc.createElement("a");
      a.setAttribute("href", "https://github.com/" + buildInfo.repo);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      a.textContent = "Master";
      left.appendChild(a);
      if (cmpNote) left.appendChild(doc.createTextNode(" (" + cmpNote + ")"));
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
    if (next.theme !== lastTheme) { lastTheme = next.theme; applyTheme(next.theme); }
    paintShieldBadge();
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

  /* Signing-route badge (owner-supplied art): shield immediately left of
   * the lock — lock answers "locked?" (red locked / green open PNG),
   * shield answers "extension-routed?" (green check / red X PNG). BOTH
   * badges always present (owner call — no zero-pixel mode); color carries
   * the state. Taps to the settings signing section (indicators navigate,
   * never mutate). Labels via settings.sign_badge (routed) /
   * settings.sign_badge_local (in-page); Icon.img carries its own text
   * fallback so a missing file degrades to text, never a broken image.
   * Colored PNGs skip the --icon-filter invert via img.icon-state
   * (app.css). Params: none (reads SignMode + document). Returns nothing.
   * Never throws. */
  function paintShieldBadge() {
    if (typeof document === "undefined") return;
    try {
      var lock = document.getElementById("lock-toggle");
      if (!lock || !lock.parentNode) return;
      var old = document.getElementById("ext-sign-badge");
      var routed = false;
      try {
        if (typeof SignMode !== "undefined" && SignMode &&
            typeof SignMode.effectiveMode === "function") {
          routed = SignMode.effectiveMode() === "extension";
        }
      } catch (e) { routed = false; }
      var label = routed
        ? t("settings.sign_badge", "Extension signing active — details in Settings")
        : t("settings.sign_badge_local", "In-page signing — details in Settings");
      var icon = routed ? "shield-ok" : "shield-bad";
      if (!old) {
        var a = document.createElement("a");
        a.id = "ext-sign-badge";
        try { a.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
        try { a.style.minHeight = "44px"; } catch (e) { /* native stands */ }
        lock.parentNode.insertBefore(a, lock);
        old = a;
      }
      try {
        while (old.firstChild) old.removeChild(old.firstChild);
        if (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function") {
          old.appendChild(Icon.img(icon, "nav-icon icon-state", routed ? "EXT" : "SIG"));
        } else {
          old.textContent = routed ? "EXT" : "SIG";
        }
      } catch (e) {
        try { old.textContent = routed ? "EXT" : "SIG"; } catch (e2) { /* badge stands */ }
      }
      try {
        old.setAttribute("aria-label", label);
        old.setAttribute("title", label);
      } catch (e) { /* badge stands unlabeled */ }
      /* Click rides the shared settings-section helper (same as the
       * #acting-as account button): navigate + scroll #sign-block to the
       * top. preventDefault keeps it deterministic (no double handling
       * with the href); the href stays as the no-JS fallback. Bound once
       * — the badge element persists across repaints, only its children
       * are rebuilt. */
      try {
        if (old.getAttribute("data-sign-bound") !== "true") {
          old.setAttribute("data-sign-bound", "true");
          old.addEventListener("click", function (ev) {
            try {
              if (ev && ev.preventDefault) ev.preventDefault();
              goToSettingsSection("sign-block");
            } catch (e) { /* href fallback stands */ }
          });
        }
      } catch (e) { /* badge stands unbound */ }
    } catch (e) { /* header keeps prior paint */ }
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
    if (nav) buildNav(nav);
    if (toggle) ensureToggleIcon(toggle);
    bindLockOnce();
    bindViewingAsOnce();
    paintShieldBadge();
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
        /* Focus-return on close lives in closeDirectory. Never throws. */
        if (open) {
          /* Drawer focus (lifecycle): move focus into the opened drawer
           * (the #nav-directory container, tabindex=-1 above) so keyboard
           * users land inside it; close returns focus via closeDirectory. */
          try {
            var panel = document.getElementById("nav-directory");
            if (panel && typeof panel.focus === "function") panel.focus();
          } catch (e) { /* toggle keeps focus */ }
        }
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
    _test: { validPoolMarket: validPoolMarket, parseBuildInfo: parseBuildInfo, parseCompare: parseCompare, compareUrl: compareUrl, relationText: relationText, netHostText: netHostText, currentNetwork: currentNetwork, offbranchText: offbranchText } };
})();

if (typeof module !== "undefined") { module.exports = App; }
