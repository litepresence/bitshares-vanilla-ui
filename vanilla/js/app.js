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

  var lastNode = null, lastNetwork = null, lastTheme = null;

  /* Batch-1 i18n (slice-17 Task 2): localize the static shell chrome that
 *   lives in index.html (brand, nav links, menu toggle).
 *   Called at boot and after every locale switch; connection status paints
 *   through the footer subscription only. */
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

  /* ORIGINAL_NAV: the header bar mirrors #1 getHeader()
   *   (MenuDataStructure.js:66-75: dashboard/market/lending/explorer +
   *   poolmart inHeader Always) — Dashboard, Exchange, Credit Offer,
   *   Liquidity Pools, Explore. Account/Transfer/Voting/Settings live in the
   *   burger palette (as in #1's dropdown), reachable everywhere. */
  var ORIGINAL_NAV = ["#/", "#/market/BTS_USD", "#/credit-offer", "#/pools",
    "#/explorer"];

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
    /* Active-route highlight (command-palette findability): exact hash match
     * gets aria-current; refreshed on every buildNav (boot, locale, hash). */
    try {
      var h = (typeof location !== "undefined" && location.hash) || "#/";
      if (h === href) a.setAttribute("aria-current", "page");
    } catch (e) { /* highlight skipped */ }
    return a;
  }

  /* buildDirectory: grouped 46-link command palette (lives inside #nav,
   *   shown only while #nav.open via app.css — no inline positioning).
   *   Search filters by label+href substring (case-insensitive, no lib);
   *   empty groups hide, empty query shows all; no-match shows a note.
   *   Link click closes the panel (wired here); Esc + hashchange close it
   *   (wired once in finishBoot). Styling is class-driven in app.css so all
   *   three themes keep working. Returns the panel div. Never throws. */
  function buildDirectory(iconOK) {
    var panel = document.createElement("div");
    panel.id = "nav-directory";
    panel.setAttribute("role", "search");
    var search = document.createElement("input");
    search.type = "search";
    search.className = "nav-dir-search";
    search.setAttribute("aria-label", t("shell.menu_filter", "Filter menu"));
    search.placeholder = t("shell.menu_filter", "Filter menu");
    try { search.style.minHeight = "44px"; } catch (e) { /* native stands */ }
    panel.appendChild(search);
    var empty = document.createElement("p");
    empty.className = "nav-dir-empty muted";
    empty.textContent = t("shell.menu_no_match", "No matching pages.");
    empty.style.display = "none";
    /* Account actions (mirrors #1 dropdown head: lock toggle, create,
     * follow, send/deposit/withdraw). Route-backed (no modal system in
     * vanilla); lock acts directly on the Wallet keystore. */
    try { panel.appendChild(buildAccountActions(document)); } catch (e) { /* groups stand alone */ }
    var sections = [];
    NAV_GROUPS.forEach(function (group) {
      var section = document.createElement("div");
      section.className = "nav-dir-group";
      var head = document.createElement("span");
      head.className = "nav-group";
      head.textContent = group.heading;
      section.appendChild(head);
      var row = document.createElement("div");
      row.className = "nav-dir-row";
      group.hrefs.forEach(function (href) {
        var a = buildNavLink(href, iconOK);
        try { a.dataset.search = (navText(href) + " " + href).toLowerCase(); } catch (e) { /* filter skips */ }
        a.addEventListener("click", function () { closeDirectory(true); });
        row.appendChild(a);
      });
      section.appendChild(row);
      panel.appendChild(section);
      sections.push(section);
    });
    panel.appendChild(empty);
    search.addEventListener("input", function () {
      var q = "";
      try { q = (search.value || "").toLowerCase(); } catch (e) { q = ""; }
      var shown = 0;
      sections.forEach(function (section) {
        var links = section.querySelectorAll("a");
        var vis = 0;
        Array.prototype.forEach.call(links, function (a) {
          var hay = "";
          try { hay = a.dataset.search || (a.textContent || "").toLowerCase(); } catch (e) { hay = ""; }
          var hit = !q || hay.indexOf(q) !== -1;
          a.style.display = hit ? "" : "none";
          if (hit) vis++;
        });
        section.style.display = vis ? "" : "none";
        shown += vis;
      });
      empty.style.display = shown ? "none" : "block";
    });
    return panel;
  }

  /* Contacts (mirrors #1 follow/unfollow): localStorage set of followed
   * account names. No chain calls — pure watch-list. Never throws. */
  var CONTACTS_KEY = "bts-vanilla-contacts-v1";
  function loadContacts() {
    try {
      var raw = localStorage.getItem(CONTACTS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === "string"; }) : [];
    } catch (e) { return []; }
  }
  function saveContacts(arr) {
    try { localStorage.setItem(CONTACTS_KEY, JSON.stringify(arr)); } catch (e) { /* follow skips */ }
  }
  /* Current account name from the hash (#/account/<name>), "" otherwise. */
  function hashAccount() {
    try {
      var h = (typeof location !== "undefined" && location.hash) || "";
      var m = /^#\/account\/([^\/?#]+)/.exec(h);
      if (!m || m[1] === "me") return "";
      return decodeURIComponent(m[1]);
    } catch (e) { return ""; }
  }
  /* buildAccountActions: lock toggle + follow + send/deposit/withdraw +
   * create-account row at the palette head (#1 dropdown parity). Links close
   * the palette; lock acts then rebuilds the nav. Never throws. */
  function buildAccountActions(doc) {
    var box = doc.createElement("div");
    box.className = "nav-dir-actions";
    function actLink(href, label) {
      var a = doc.createElement("a");
      a.setAttribute("href", href);
      a.textContent = label;
      a.addEventListener("click", function () { closeDirectory(false); });
      box.appendChild(a);
      return a;
    }
    function actButton(label, fn) {
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "nav-dir-btn";
      b.textContent = label;
      try { b.style.minHeight = "44px"; } catch (e) { /* native stands */ }
      b.addEventListener("click", fn);
      box.appendChild(b);
      return b;
    }
    var unlocked = false;
    try {
      unlocked = (typeof Wallet !== "undefined" && Wallet &&
        typeof Wallet.isUnlocked === "function" && Wallet.isUnlocked());
    } catch (e) { unlocked = false; }
    if (unlocked) {
      actButton(t("shell.lock", "Lock"), function () {
        try { if (typeof Wallet !== "undefined" && Wallet && Wallet.lock) Wallet.lock(); } catch (e) { /* stays */ }
        try {
          var nav = doc.getElementById("nav");
          if (nav) buildNav(nav);
        } catch (e) { /* label keeps prior state */ }
      });
    } else {
      actLink("#/login", t("shell.unlock", "Unlock"));
    }
    var acct = hashAccount();
    if (acct) {
      var contacts = loadContacts();
      var follows = contacts.indexOf(acct) !== -1;
      actButton((follows ? t("shell.unfollow", "Unfollow") : t("shell.follow", "Follow")) + " " + acct, function () {
        var list = loadContacts();
        var i = list.indexOf(acct);
        if (i === -1) list.push(acct);
        else list.splice(i, 1);
        saveContacts(list);
        try {
          var nav = doc.getElementById("nav");
          if (nav) { buildNav(nav); nav.classList.add("open"); }
        } catch (e) { /* label keeps prior state */ }
      });
      actLink("#/transfer", t("nav.transfer", "Transfer"));
      actLink("#/deposit-withdraw", t("gateway.title", "Deposit / Withdraw"));
    }
    actLink("#/create-account", t("account.register_short", "Register a new account"));
    return box;
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

  /* buildNav: 7-link bar + command-palette directory (idempotent; preserves
   *   the .open state so a locale switch never collapses the menu). Theme
   *   switching lives in settings + the header-bar copy (finishBoot) — the
   *   old second copy inside #nav was crowding the palette and is gone. */
  function buildNav(nav) {
    if (!nav || typeof document === "undefined") return;
    var wasOpen = nav.classList.contains("open");
    var iconOK = (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function");
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    ORIGINAL_NAV.forEach(function (href) {
      nav.appendChild(buildNavLink(href, iconOK));
    });
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
   *   parity: the node location name carries the state in COLOR, green when
   *   connected, red otherwise; no topbar badge). Params: status ({state,
   *   node, latencyMs, headBlock}). Returns nothing. Fails: never — missing
   *   footer is a no-op. Latency + head block are heartbeat-live. */
  function paintFooter(status) {
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
    if (state === "open") {
      var host = shortHost(s.node);
      var lat = (s.latencyMs !== null && s.latencyMs !== undefined) ? s.latencyMs + "ms" : "—";
      var blk = s.headBlock ? " / BLOCK #" + String(s.headBlock) : "";
      if (host) {
        foot.appendChild(span(host, "appfoot-host", "open"));
        foot.appendChild(doc.createTextNode(" · "));
      }
      foot.appendChild(doc.createTextNode("LATENCY " + lat + blk));
    } else {
      var host = shortHost(s.node);
      if (host) {
        foot.appendChild(span(host, "appfoot-host", "closed"));
        foot.appendChild(doc.createTextNode(" · "));
      }
      var label = (state && state !== "unknown") ? state : "connecting…";
      if (state && state !== "unknown") foot.appendChild(span(label, "appfoot-host", "closed"));
      else foot.appendChild(doc.createTextNode(label));
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
   *   Chain.connect rejections are swallowed; the footer carries the error. */
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
    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        syncDirectory(nav);
        /* Focus the filter on open (keyboard path); focus-return on close
         * lives in closeDirectory. Never throws — missing search is fine. */
        if (open) {
          try {
            var q = nav.querySelector(".nav-dir-search");
            if (q && typeof q.focus === "function") q.focus();
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
  }

  /* Classic script: auto-boot in browsers only; require() under node stays side-effect free. */
  if (typeof document !== "undefined") boot();

  return { boot: boot, localizeShell: localizeShell };
})();

if (typeof module !== "undefined") { module.exports = App; }
