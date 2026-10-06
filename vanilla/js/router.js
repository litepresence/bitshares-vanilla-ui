/* Router: hash router rendering §6 routes into #view. No dependencies.
 * Owns: the §6 route table, pattern matching (matchPattern/match), render
 *   dispatch + 404/home/market shells, hash query parsing (query() for view
 *   workers reading #/path?k=v — e.g. the invoice pre-fill). Consumes: view
 *   globals by feature
 *   (MarketUI/AccountUI/etc, guarded — placeholder when absent), I18n.t for
 *   shell strings (guarded fallback), window.location.hash. Side effects: DOM
 *   under the given #view element + document.title, hashchange listener on
 *   start. Created by: building-vanilla-slices skill, slice-01-shell-settings
 *   plan. */
var Router = (function () {
  "use strict";

  /**
   * @typedef {import('./api/types.js').TFunction} TFunction
   * @typedef {import('./api/types.js').CountResult} CountResult
   */

  var view = null;

  /* Batch-1 i18n (slice-17 Task 2): shell chrome strings only (404, home).
   * Route titles + per-view placeholders stay hardcoded
   * English for later per-view batches. Same t() fallback shape as
   * settings.js: I18n when loaded, verbatim default otherwise. vars fills
   * %(name)s placeholders (vote-ballot.js shape) so keyed templates like
   * seo.title_account render with the name even on file://.
   * @param {string} key dotted i18n key.
   * @param {string} dflt verbatim English default (keeps served-source
   *   English-identical when dict fetch fails).
   * @param {Object} [vars] placeholder values (e.g. {name} for titles).
   * @returns {string} localized string, never blank, never throws. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }

  /* escapeHtml: &-<>"' escaping for interpolated shell strings. Params: s
   * (any, stringified). Returns the escaped string. Fails: never. */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      if (c === "&") return "&amp;";
      if (c === "<") return "&lt;";
      if (c === ">") return "&gt;";
      if (c === '"') return "&quot;";
      return "&#39;";
    });
  }

  /* placeholder: INTENTIONAL fallback renderer for view-script load failure
   *   (not dead code — About/Menu/Settings/Exchange routes call it when their
   *   view global is absent). Params: title (string). Returns a render
   *   function (root) -> void. Fails: never — a missing root is a no-op,
   *   strings are HTML-escaped. */
  function placeholder(title) {
    return function (root) {
      if (!root) return;
      root.innerHTML =
        '<div class="wrap"><h1>' + escapeHtml(title) + "</h1></div>";
    };
  }

  /* fourOhFourImg: theme-aware 404 art filename (owner-supplied PNGs, no new
   *   assets). Reads the data-theme switch on <html> (app.js applyTheme owns
   *   it): vanilla-ui-theme -> light, dex-ux-theme -> midnight, anything else
   *   (ref-ui-theme default, unknown, or no DOM) -> dark. Params: none.
   *   Returns the PNG filename. Fails: never. */
  function fourOhFourImg() {
    var theme = "";
    try {
      if (typeof document !== "undefined" && document.documentElement &&
          typeof document.documentElement.getAttribute === "function") {
        theme = document.documentElement.getAttribute("data-theme") || "";
      }
    } catch (e) { /* default below */ }
    if (theme === "vanilla-ui-theme") return "logo-404-light.png";
    if (theme === "dex-ux-theme") return "logo-404-midnight.png";
    return "logo-404-dark.png";
  }

  /* render404: unknown-route page with a dashboard link. Params: root
   *   (element). Returns nothing. Fails: never — a missing root is a no-op. */
  function render404(root) {
    if (!root) return;
    root.innerHTML =
      '<div class="wrap"><img src="assets/' + fourOhFourImg() + '" alt="">' +
      '<h1>' + escapeHtml(t("shell.page_not_found", "Page Not Found")) + "</h1>" +
      '<p class="muted">' + escapeHtml(t("shell.unknown_route", "Unknown route. ")) +
      '<a href="#/">' + escapeHtml(t("shell.go_dashboard", "Go to Dashboard")) + "</a></p></div>";
  }

  /* renderSettings: settings route with placeholder fallback. Params: root
   *   (element), params (object, e.g. {tab}). Returns nothing. Fails: never —
   *   falls back to the Settings placeholder when SettingsPage is absent. */
  function renderSettings(root, params) {
    if (typeof SettingsPage !== "undefined" && SettingsPage && typeof SettingsPage.render === "function") {
      SettingsPage.render(root, params);
      return;
    }
    placeholder("Settings")(root);
  }

  /* "/" is the account-overview dashboard (DashboardUI), NOT a desk clone:
   *   #1 App.jsx:503-507 routes "/" to DashboardPage (starred/featured
   *   market tabs with a LoginSelector gate); vanilla shows the watched
   *   account (the wallet's own when unlocked, else the committee-account
   *   watch) with balances, recent activity, favourite markets and quick
   *   links — BUT locked visitors get the Option-B splash instead
   *   (2026-10-01: hero + live markets + chain pulse + cards + trust +
   *   steps + CTA; unlocked path byte-identical to before, §3.1 deviation
   *   recorded in slice-01-settings.md). dashboard-ui.js eager-loads via
   *   index.html (dashboard script tag) so DashboardUI is present at boot:
   *   ensureDashboard below is only the load-failure fallback (inject once,
   *   paint a loading line, re-render on load; failed load falls back to
   *   the old market redirect so the page is never blank). */
  var dashLoading = false;

  /* dashSrc: absolute URL for the dashboard script (document.baseURI keeps
   *   it correct under any served sub-path; file:// included). Params: none.
   *   Returns a URL string. Fails: never throws — falls back to relative. */
  function dashSrc() {
    try {
      if (typeof document !== "undefined" && document.baseURI) {
        return new URL("js/views/dashboard-ui.js", document.baseURI).toString();
      }
    } catch (e) { /* relative fallback below */ }
    return "js/views/dashboard-ui.js";
  }

  /* ensureDashboard: true when DashboardUI.renderDashboard is callable,
   *   kicking off the one-time lazy load otherwise. Params: root (element).
   *   Returns boolean. Fails: never throws — load failure paints the
   *   redirect fallback inline. False under node (no document to load with). */
  function ensureDashboard(root) {
    if (typeof DashboardUI !== "undefined" && DashboardUI &&
        typeof DashboardUI.renderDashboard === "function") return true;
    if (typeof document === "undefined" || !root) return false;
    if (!dashLoading) {
      dashLoading = true;
      try {
        var s = document.createElement("script");
        s.src = dashSrc();
        s.async = true;
        s.onload = function () { dashLoading = false; render(); };
        s.onerror = function () { dashLoading = false; renderHomeFallback(root); };
        (document.head || document.getElementsByTagName("head")[0] || document.documentElement).appendChild(s);
      } catch (e) { dashLoading = false; return false; }
    }
    return false;
  }

  /* renderHome: dashboard route (live DashboardUI when loaded, loading /
   * fallback shells otherwise — never blank). Params: root (view element).
   * Returns nothing. Fails: never throws (missing DOM is a no-op). */
  function renderHome(root) {
    if (ensureDashboard(root)) {
      DashboardUI.renderDashboard(root);
      return;
    }
    if (dashLoading) {
      if (!root) return;
      root.innerHTML =
        '<div class="wrap"><h1>' + escapeHtml(t("shell.dashboard", "Dashboard")) + "</h1>" +
        '<p class="muted">' + escapeHtml(t("transfer.loading", "Loading…")) + "</p></div>";
      return;
    }
    renderHomeFallback(root);
  }

  /* renderHomeFallback: pre-dashboard "/" behavior (redirect to the DEX
   * desk: last-visited market when stored, else the network default).
   * Kept for the dashboard-script-load-failure path only. A plain link
   * stays behind so the page is never blank if hashing fails. */
  function renderHomeFallback(root) {
    var target = "BTS_CNY";
    try {
      if (typeof MarketUI !== "undefined" && MarketUI &&
          typeof MarketUI.homeTarget === "function") {
        target = MarketUI.homeTarget();
      }
    } catch (e) { /* default stands */ }
    if (typeof window !== "undefined" && window.location) {
      var want = "#/market/" + target;
      try {
        if (window.location.hash !== want) window.location.hash = want;
      } catch (e) { /* link below still works */ }
    }
    if (!root) return;
    root.innerHTML =
      '<div class="wrap"><h1>' + escapeHtml(t("shell.dashboard", "Dashboard")) + "</h1>" +
      '<p class="muted">' + escapeHtml(t("shell.opening_market", "Opening the market… ")) + '<a href="#/market/' +
      escapeHtml(target) + '">' + escapeHtml(t("shell.go_to", "Go to ")) + escapeHtml(target) + "</a></p></div>";
  }

  /* renderMarketPage: market route with placeholder fallback. Params: root
   *   (element), params ({marketID}). Returns nothing. Fails: never — falls
   *   back to the Exchange placeholder when MarketUI is absent. */
  function renderMarketPage(root, params) {
    if (typeof MarketUI !== "undefined" && MarketUI &&
        typeof MarketUI.renderMarket === "function") {
      MarketUI.renderMarket(root, params && params.marketID);
      return;
    }
    placeholder("Exchange")(root);
  }

  /* Full §6 route list, in plan order. :params match one segment; /help/** matches any depth. */
  var routes = [
    { path: "/", title: "Dashboard", render: renderHome },
    { path: "/account/:account_name", title: "Account", render: function (root, params) { AccountUI.renderAccount(root, params && params.account_name); } },
    { path: "/accounts", title: "Accounts", render: function (root) { AccountsUI.renderAccounts(root); } },
    { path: "/market/:marketID", title: "Exchange", render: renderMarketPage },
    { path: "/credit-offer/:id", title: "Credit Offer", render: function (root, params) { CreditDetailUI.renderOfferDetail(root, params && params.id); } },
    { path: "/deal/:id", title: "Credit Deal", render: function (root, params) { CreditDetailUI.renderDealDetail(root, params && params.id); } },
    { path: "/credit-offer", title: "Credit Offer", render: function (root) { CreditUI.renderOffers(root); } },
    { path: "/samet", title: "Same-T Funds", render: function (root) { SametUI.renderSamet(root); } },
    { path: "/settings/:tab", title: "Settings", render: renderSettings },
    { path: "/settings", title: "Settings", render: renderSettings },
    { path: "/invoice/:data", title: "Invoice", render: function (root, params) { MiscUI.renderInvoice(root, params && params.data); } },
    { path: "/invoice", title: "Invoice", render: function (root) { MiscUI.renderInvoice(root, null); } },
    { path: "/proposals/:id", title: "Proposal", render: function (root, params) { ProposalUI.renderProposalDetail(root, params && params.id); } },
    { path: "/proposals", title: "Proposals", render: function (root) { ProposalUI.renderProposals(root); } },
    { path: "/tickets", title: "Tickets", render: function (root) { TicketUI.renderTickets(root); } },
    { path: "/vesting", title: "Vesting", render: function (root) { VestingUI.renderVesting(root); } },
    { path: "/authorities", title: "Custom Authorities", render: function (root) { MiscUI.renderAuthorities(root); } },
    { path: "/lists", title: "Account Lists", render: function (root) { MiscUI.renderLists(root); } },
    { path: "/airdrop", title: "Airdrop", render: function (root) { TicketUI.renderAirdrop(root); } },
    { path: "/deposit-withdraw/:gateway", title: "Deposit / Withdraw", render: function (root, params) { GatewayUI.renderDesk(root, params && params.gateway); } },
    { path: "/deposit-withdraw", title: "Deposit / Withdraw", render: function (root) { GatewayUI.renderDesk(root, null); } },
    { path: "/create-account", title: "Create Account", render: function (root) { CreateAccountUI.renderCreateAccount(root); } },
    { path: "/login", title: "Login", render: function (root) { AuthUI.renderLogin(root); } },
    { path: "/registration", title: "Registration", render: function (root) { AuthUI.renderRegistration(root); } },
    { path: "/registration/local", title: "Registration", render: function (root) { AuthUI.renderLocal(root); } },
    { path: "/registration/cloud", title: "Registration", render: function (root) { AuthUI.renderCloud(root); } },
    { path: "/news", title: "News", render: function (root) { NewsUI.renderNews(root); } },
    { path: "/voting", title: "Voting", render: function (root) { VoteUI.renderVoting(root); } },
    { path: "/explorer", title: "Explore", render: function (root) { ExplorerUI.renderExplorer(root, "blocks"); } },
    { path: "/explorer/:tab", title: "Explore", render: function (root, params) { ExplorerUI.renderExplorer(root, params && params.tab); } },
    { path: "/asset/:symbol", title: "Asset", render: function (root, params) { ExplorerUI.renderAsset(root, params && params.symbol); } },
    { path: "/block/:height", title: "Block", render: function (root, params) { ExplorerUI.renderBlock(root, params && params.height); } },
    { path: "/block/:height/:txIndex", title: "Transaction", render: function (root, params) { ExplorerUI.renderTx(root, params && params.height, params && params.txIndex); } },
    { path: "/borrow", title: "Borrow", render: function (root) { BorrowUI.renderBorrow(root); } },
    { path: "/barter", title: "Barter", render: function (root) { BarterUI.renderBarter(root); } },
    { path: "/direct-debit", title: "Direct Debit", render: function (root) { DebitUI.renderDirectDebit(root); } },
    { path: "/spotlight", title: "Spotlight", render: function (root) { DebitUI.renderSpotlight(root); } },
    { path: "/transfer/:to", title: "Transfer", render: function (root, params) { TransferUI.renderTransfer(root, params && params.to); } },
    { path: "/transfer", title: "Transfer", render: function (root, params) { TransferUI.renderTransfer(root, params && params.to); } },
    { path: "/wallet/password", title: "Change Wallet Password", render: function (root) { PasswordUI.renderPassword(root); } },
    { path: "/wallet", title: "Wallet", render: function (root, params) { WalletUI.renderWallet(root, params); } },
    { path: "/create-wallet-brainkey", title: "Create Wallet (Brainkey)", render: function (root, params) { WalletUI.renderCreate(root, params); } },
    { path: "/existing-account", title: "Existing Account", render: function (root, params) { WalletUI.renderImport(root, params); } },
    { path: "/create-worker", title: "Create Worker", render: function (root) { CreateWorkerUI.renderCreateWorker(root); } },
    { path: "/about", title: "About", render: function (root) {
      if (typeof AboutUI !== "undefined" && AboutUI && typeof AboutUI.renderAbout === "function") { AboutUI.renderAbout(root); return; }
      placeholder("About")(root);
    } },
    { path: "/community", title: "Community", render: function (root) {
      if (typeof HelpUI !== "undefined" && HelpUI && typeof HelpUI.renderCommunity === "function") { HelpUI.renderCommunity(root); return; }
      placeholder("Community")(root);
    } },
    { path: "/help/**", title: "Help", render: function (root, params) { HelpUI.renderHelp(root, params); } },
    { path: "/htlc/:id", title: "HTLC", render: function (root, params) { HtlcUI.renderHtlcDetail(root, params && params.id); } },
    { path: "/htlc", title: "HTLC", render: function (root) { HtlcUI.renderHtlc(root); } },
    { path: "/prediction", title: "Prediction Markets", render: function (root) { PredictionUI.renderList(root); } },
    { path: "/prediction/:market", title: "Prediction Markets", render: function (root, params) { PredictionUI.renderDetail(root, params && params.market); } },
    { path: "/instant-trade", title: "Instant Trade", render: function (root) { InstantTradeUI.renderInstant(root, null); } },
    { path: "/instant-trade/:marketID", title: "Instant Trade", render: function (root, params) { InstantTradeUI.renderInstant(root, params && params.marketID); } },
    { path: "/pools/:id", title: "Liquidity Pool", render: function (root, params) { PoolDetailUI.renderPoolDetail(root, params && params.id); } },
    { path: "/pools", title: "Liquidity Pools", render: function (root) { PoolUI.renderPools(root); } },
    { path: "/alerts", title: "Price Alerts", render: function (root) { NotifyUI.render(root); } },
    { path: "/trollbox", title: "Trollbox", render: function (root) { TrollboxUI.renderTrollbox(root); } },
    { path: "/assets", title: "Assets", render: function (root) { AssetUI.renderAssets(root); } },
    { path: "/assets/create", title: "Create Asset", render: function (root) { AssetUI.renderCreate(root); } },
    { path: "/assets/update/:symbol", title: "Update Asset", render: function (root, params) { AssetManageUI.renderUpdate(root, params && params.symbol); } },
    { path: "/assets/issue", title: "Issue Asset", render: function (root) { AssetManageUI.renderIssue(root); } },
    { path: "/assets/feed", title: "Publish Feed", render: function (root) { AssetFeedUI.renderFeed(root); } },
    { path: "/fees", title: "Network Fees", render: function (root) { FeesUI.renderFees(root); } },
    { path: "/referrals", title: "Referrals", render: function (root) { ReferralsUI.renderReferrals(root); } },
    { path: "/favourites", title: "Favourites", render: function (root) { FavouritesUI.renderFavourites(root); } },
    { path: "/top-ops", title: "Top Operations", render: function (root) { TopOpsUI.renderTopOps(root); } },
    { path: "/ops", title: "Top Operations", render: function (root) { OpsUI.renderOps(root); } },
    { path: "/txbuilder", title: "Transaction Builder", render: function (root) { TxBuilderUI.renderDesk(root); } },
    { path: "/api-lab", title: "API Lab", render: function (root) { ApiLabUI.renderLab(root); } },
    { path: "/es-lab", title: "ES Lab", render: function (root) { EsLabUI.renderLab(root); } },
    { path: "/menu", title: "Menu", render: function (root) {
      if (typeof MenuUI !== "undefined" && MenuUI && typeof MenuUI.renderMenu === "function") { MenuUI.renderMenu(root); return; }
      placeholder("Menu")(root);
    } },
    { path: "/menu/:section", title: "Menu", render: function (root, params) {
      if (typeof MenuUI !== "undefined" && MenuUI && typeof MenuUI.renderSection === "function") { MenuUI.renderSection(root, params && params.section); return; }
      placeholder("Menu")(root);
    } },
    { path: "*", title: "Page Not Found", render: render404 }
  ];

  /* ROUTE_META: per-hash-surface SEO titles + descriptions (marketing-auditor
   *   lens 5: unique title ≤60ch + description ≤155ch per routable surface).
   *   WHY one shared document: hash routes never reload, so paintMeta swaps
   *   the title/meta per render instead of shipping separate files (static-only
   *   doctrine — no SSR, no plugin). WHY keyed seo.* pairs, not literals:
   *   each entry holds the i18n key plus its verbatim English default, and
   *   metaFor resolves via t() per render — so the served source stays
   *   English-identical (crawler-safe) while a language switch applies on the
   *   next navigation with no reload. The account title keeps its
   *   {name}/30ch-cap logic: the raw name (sliced, never translated per
   *   batch-2b) fills the %(name)s placeholder, glue stays in the default.
   *   Descriptions are honest (live-chain wording, no counts or volumes — a
   *   dead feed says so, never fakes it). Pure strings: no chain calls.
   *   "/account/:name" is a template (never an exact path — metaFor
   *   interpolates it); "/help" also covers "/help/**" depths.
   * @type {Object<string, {titleKey: string, title: string, descKey: string, description: string}>} */
  var ROUTE_META = {
    "/": { titleKey: "seo.title_dashboard", title: "Dashboard — BitShares Wallet", descKey: "seo.desc_dashboard", description: "BitShares dashboard — balances, markets and chain activity at a glance. Browse freely; keys stay on your device." },
    "/market/BTS_USD": { titleKey: "seo.title_market", title: "BTS/USD Exchange — BitShares Wallet", descKey: "seo.desc_market", description: "Trade BTS for USD on the BitShares order book — live bids, asks and history, signed locally on your device." },
    "/pools": { titleKey: "seo.title_pools", title: "Liquidity Pools — BitShares Wallet", descKey: "seo.desc_pools", description: "Browse BitShares liquidity pools — pairs, balances and activity read live from the chain. No login needed." },
    "/explorer": { titleKey: "seo.title_explorer", title: "Blockchain Explorer — BitShares Wallet", descKey: "seo.desc_explorer", description: "Explore BitShares blocks, transactions and assets — live chain data, browsable with no login." },
    "/transfer": { titleKey: "seo.title_transfer", title: "Send Funds — BitShares Wallet", descKey: "seo.desc_transfer", description: "Send BitShares assets to any account. Review every field, then sign locally — keys never leave your device." },
    "/account/:name": { titleKey: "seo.title_account", title: "Account %(name)s — BitShares Wallet", descKey: "seo.desc_account", description: "View this BitShares account — balances, orders and history read live from the chain. No login needed." },
    "/voting": { titleKey: "seo.title_voting", title: "Vote Witnesses — BitShares Wallet", descKey: "seo.desc_voting", description: "Vote for BitShares witnesses, committee members and workers. Every ballot is signed locally on your device." },
    "/about": { titleKey: "seo.title_about", title: "About — BitShares Wallet", descKey: "seo.desc_about", description: "About this BitShares wallet — local keys, no signup, no tracking. Browse freely and sign locally." },
    "/help": { titleKey: "seo.title_help", title: "Help — BitShares Wallet", descKey: "seo.desc_help", description: "BitShares wallet help — guides for accounts, trading, voting and recovery. Start here when stuck." },
    "/login": { titleKey: "seo.title_login", title: "Log In — BitShares Wallet", descKey: "seo.desc_login", description: "Unlock your local BitShares wallet — password, brainkey or imported keys. Keys never leave this device." }
  };

  /* metaFor: resolve the SEO meta for one normalized path. Params: path
   *   (leading-slash, query-stripped — currentPath() output), params (match()
   *   params; account_name feeds the Account title, capped at 30 chars so the
   *   title keeps its ≤60ch budget), fallbackTitle (route.title for surfaces
   *   outside the top-10 — returned verbatim so other routes keep prior tab
   *   text). Returns {title, description} (description null = leave the meta
   *   tag untouched). Resolution runs through t() per call (keyed entries in
   *   ROUTE_META, account name as an unwrapped %(name)s var) so the active
   *   locale applies on every navigation. Fails: never throws — bad input
   *   yields the fallback. No chain calls.
   * @param {string} path
   * @param {Object} [params]
   * @param {string} [fallbackTitle]
   * @returns {{title: string, description: (string|null)}} */
  function metaFor(path, params, fallbackTitle) {
    var p = (typeof path === "string" && path) ? path : "/";
    if (Object.prototype.hasOwnProperty.call(ROUTE_META, p)) {
      var hit = ROUTE_META[p];
      return { title: t(hit.titleKey, hit.title), description: t(hit.descKey, hit.description) };
    }
    /* Dynamic account surface: /account/<name> reuses the template with the
     * matched (or path-derived) name, sliced to 30 chars per spec. The name
     * stays raw (never translated — batch-2b values-unwrapped precedent) and
     * fills the template's %(name)s placeholder. */
    if (p === "/account" || p.indexOf("/account/") === 0) {
      var tmpl = ROUTE_META["/account/:name"];
      var raw = "";
      try {
        if (params && typeof params.account_name === "string" && params.account_name) {
          raw = params.account_name;
        } else {
          raw = decodeURIComponent(p.slice("/account/".length).split("/")[0] || "");
        }
      } catch (e) { raw = ""; }
      raw = String(raw || "").slice(0, 30) || "Account";
      return { title: t(tmpl.titleKey, tmpl.title, { name: raw }), description: t(tmpl.descKey, tmpl.description) };
    }
    /* Help depths (/help, /help/**) share the Help surface. */
    if (p === "/help" || p.indexOf("/help/") === 0) {
      var help = ROUTE_META["/help"];
      return { title: t(help.titleKey, help.title), description: t(help.descKey, help.description) };
    }
    return { title: (typeof fallbackTitle === "string" && fallbackTitle) ? fallbackTitle : "BitShares Wallet", description: null };
  }

  /* paintMeta: swap the document title + meta description for one surface.
   * Params: title (string, shown on the tab), description (string|null —
   *   null keeps the current meta content, used for non-top-10 surfaces).
   *   Callers pass metaFor-resolved strings (already through t(), so the
   *   active locale is baked in); paintMeta itself paints verbatim.
   *   Returns nothing. Fails: never throws — missing DOM (node smoke tests)
   *   is a no-op; a missing meta tag is created under <head>. file:// safe:
   *   same-document touch only, no fetch, no baseURI math. No chain calls.
   * @param {string} title
   * @param {string|null} [description]
   * @returns {void} */
  function paintMeta(title, description) {
    if (typeof document === "undefined") return;
    try {
      if (typeof title === "string" && title) document.title = title;
      if (typeof description !== "string" || !description) return;
      var meta = null;
      try {
        if (document.querySelector) meta = document.querySelector('meta[name="description"]');
      } catch (e) { meta = null; }
      if (meta && typeof meta.setAttribute === "function") {
        meta.setAttribute("content", description);
        return;
      }
      try {
        var head = document.head || (document.getElementsByTagName ?
          document.getElementsByTagName("head")[0] : null);
        if (!head || typeof document.createElement !== "function") return;
        var made = document.createElement("meta");
        made.setAttribute("name", "description");
        made.setAttribute("content", description);
        head.appendChild(made);
      } catch (e) { /* head keeps prior tags */ }
    } catch (e) { /* paint stands */ }
  }

  /* splitSegments: "/a/b" -> ["a","b"] (root -> []). Params: path string.
   * Returns the segment array. Fails: never (falsy path yields []). */
  function splitSegments(path) {
    if (!path || path === "/") return [];
    return path.split("/").filter(function (s) { return s.length > 0; });
  }

  /* matchPattern: one pattern against one path. Params: pattern (string with
   *   :params or trailing /**), path (string). Returns {params} or null.
   *   Fails: never throws — bad-decode segments fall back to the raw text. */
  function matchPattern(pattern, path) {
    if (pattern === "/") return path === "/" || path === "" ? { params: {} } : null;
    var patSegs = splitSegments(pattern);
    var pathSegs = splitSegments(path);
    /* /help/** matches /help and any depth below it. */
    if (patSegs.length >= 1 && patSegs[patSegs.length - 1] === "**") {
      var base = patSegs.slice(0, -1);
      if (pathSegs.length < base.length) return null;
      var rest = [];
      for (var b = 0; b < base.length; b++) {
        if (base[b] !== pathSegs[b]) return null;
      }
      rest = pathSegs.slice(base.length);
      return { params: { wildcard: rest.join("/") } };
    }
    if (patSegs.length !== pathSegs.length) return null;
    var params = {};
    for (var i = 0; i < patSegs.length; i++) {
      var pat = patSegs[i];
      var seg = pathSegs[i];
      if (pat.charAt(0) === ":") {
        if (!seg) return null;
        try { params[pat.slice(1)] = decodeURIComponent(seg); }
        catch (e) { params[pat.slice(1)] = seg; }
      } else if (pat !== seg) {
        return null;
      }
    }
    return { params: params };
  }

  /* match: first route whose pattern fits. Params: path (string). Returns
   *   {route, params} or null. Fails: never throws ("*" is skipped here —
   *   render() handles the miss as 404). */
  function match(path) {
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (r.path === "*") continue;
      var m = matchPattern(r.path, path);
      if (m) return { route: r, params: m.params };
    }
    return null;
  }

  /* currentPath: normalized path from location.hash. Params: none. Returns a
   *   leading-slash path with query stripped and trailing slash removed.
   *   Fails: never throws — a missing hash yields "/". */
  function currentPath() {
    var hash = "";
    if (typeof window !== "undefined" && window.location && typeof window.location.hash === "string") {
      hash = window.location.hash;
    }
    var path = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    if (!path) path = "/";
    var q = path.indexOf("?");
    if (q !== -1) path = path.slice(0, q);
    if (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
    if (path.charAt(0) !== "/") path = "/" + path;
    return path;
  }

  /* query: decoded query params of the current hash (e.g. #/invoice?to=a
   *   reads {to:"a"}). Owns: hash query parsing for view workers — the
   *   invoice pre-fill reads this (BitsharesURI.open navigates, the view
   *   owns validation/render). Params: none. Returns a plain object
   *   (possibly {}). Fails: never throws — bad % escapes fall back to raw
   *   text, duplicate keys last-win, a missing hash yields {}. */
  function query() {
    var hash = "";
    if (typeof window !== "undefined" && window.location && typeof window.location.hash === "string") {
      hash = window.location.hash;
    }
    var qi = hash.indexOf("?");
    if (qi === -1) return {};
    var out = {};
    var parts = hash.slice(qi + 1).split("&");
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var eq = parts[i].indexOf("=");
      var rk = eq === -1 ? parts[i] : parts[i].slice(0, eq);
      var rv = eq === -1 ? "" : parts[i].slice(eq + 1);
      var k, v;
      try { k = decodeURIComponent(rk); } catch (e) { k = rk; }
      try { v = decodeURIComponent(rv); } catch (e2) { v = rv; }
      if (!k) continue;
      out[k] = v;
    }
    return out;
  }

  /* a11ySweep: post-render accessibility backstop (a11y audit 2026-09-30).
   * Owns: th scope="col" on our tables, role/aria-label on 2D plot canvases,
   *   aria-label on raw-JSON disclosures missing one. Consumes: view DOM only.
   *   LWC internals (layout tables, chart canvases inside .mkt-price-host /
   *   .mkt-osc-host without .mkt-canvas) are untouched — their text fallback
   *   is the surrounding raw <details> + status notes, not per-canvas labels.
   *   Never throws; never restructures. */
  function a11ySweep(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    try {
      var ths = root.querySelectorAll("table.node-table th:not([scope]), table.pools-table th:not([scope]), .xplore-scroll table th:not([scope])");
      for (var i = 0; i < ths.length; i++) ths[i].setAttribute("scope", "col");
    } catch (e) { /* tables stand unlabeled */ }
    try {
      var cvs = root.querySelectorAll("canvas.mkt-canvas:not([aria-label])");
      for (var c = 0; c < cvs.length; c++) {
        cvs[c].setAttribute("role", "img");
        cvs[c].setAttribute("aria-label", t("shell.chart_aria", "Chart plot. Tabular data follows."));
      }
    } catch (e) { /* canvases stand unnamed */ }
    try {
      var sums = root.querySelectorAll("details.raw > summary:not([aria-label])");
      for (var s = 0; s < sums.length; s++) sums[s].setAttribute("aria-label", t("market.raw_fallback", "Show raw JSON"));
    } catch (e) { /* disclosures stand */ }
  }

  /* render: draws currentPath into #view. Params: none. Returns nothing.
   *   Fails: never throws on routing — unknown paths render the 404 view
   *   (view errors themselves propagate). No-op before start(). */
  function render() {
    if (!view) return;
    /* Router scrolls first, then the view renders and performs its own
     * scrolling (deep-link `?dialog=` expand+scroll, explorer Return-to-top,
     * tour targets) — so view-level scrolls always win. Never throws. */
    try {
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") window.scrollTo(0, 0);
    } catch (e) { /* scroll stands */ }
    var path = currentPath();
    var m = match(path);
    var title, fn, params;
    if (m) {
      title = m.route.title;
      fn = m.route.render;
      params = m.params;
    } else {
      title = "Page Not Found";
      fn = render404;
      params = {};
    }
    /* SEO swap (marketing-auditor lens 5): every render — top-10 surfaces get
     * unique title+description, all others keep their route title verbatim
     * with the meta tag untouched (metaFor fallback). Guarded inside
     * paintMeta for node smoke tests. */
    var meta = metaFor(path, params, title);
    paintMeta(meta.title, meta.description);
    /* Pool-market context hygiene: the header Exchange tab follows pool
     * pages only. Leaving pools/market clears it (market routes set
     * their own context implicitly by being the desk). currentPath() yields
     * "#"-less paths ("/pools/…"). Never throws. */
    try {
      if (typeof App !== "undefined" && App && typeof App.setPoolMarket === "function") {
        if (path.indexOf("/pools") !== 0 && path.indexOf("/market/") !== 0) {
          App.setPoolMarket(null);
        }
      }
    } catch (e) { /* context stands */ }
    fn(view, params);
    try { a11ySweep(view); } catch (e) { /* paint stands */ }
    /* Candy-2 view-enter restart (tab-switch micro-fade; CSS owns motion). */
    try {
      if (view && view.classList) {
        view.classList.remove("view-enter");
        void view.offsetWidth;
        view.classList.add("view-enter");
      }
    } catch (e) { /* paint stands */ }
  }

  /** start: binds hashchange and renders once. Params: viewEl (element).
   *   Returns nothing. Fails: never throws — render is safe on any hash.
   *   A MutationObserver re-runs a11ySweep on async fills (chain tables /
   *   canvases render after the sync render above; without this the scope
   *   backstop misses them — observed 2026-09-30: only #/settings passed).
   * @param {any} viewEl
   * @returns {void} */
  var a11yTimer = null;
  function start(viewEl) {
    view = viewEl;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.removeEventListener("hashchange", render);
      window.addEventListener("hashchange", render);
    }
    try {
      if (typeof MutationObserver !== "undefined" && view &&
          typeof view.nodeType === "number" && !/** @type {any} */ (start)._a11yWired) {
        /** @type {any} */ (start)._a11yWired = true;
        var obs = new MutationObserver(function () {
          if (a11yTimer) return;
          a11yTimer = setTimeout(function () {
            a11yTimer = null;
            try { a11ySweep(view); } catch (e) { /* paint stands */ }
          }, 300);
        });
        obs.observe(view, { childList: true, subtree: true });
      }
    } catch (e) { /* sync sweep stands */ }
    render();
  }

  return { start: start, routes: routes, match: match, placeholder: placeholder, query: query };
})();

/* Expose the single Router global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.Router === "undefined") { globalThis.Router = Router; }
if (typeof module !== "undefined") { module.exports = Router; }
