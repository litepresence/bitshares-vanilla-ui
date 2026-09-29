/* Router: hash router rendering §6 routes into #view. No dependencies.
 * Owns: the §6 route table, pattern matching (matchPattern/match), render
 *   dispatch + 404/home/market shells. Consumes: view globals by feature
 *   (MarketUI/AccountUI/etc, guarded — placeholder when absent), I18n.t for
 *   shell strings (guarded fallback), window.location.hash. Side effects: DOM
 *   under the given #view element + document.title, hashchange listener on
 *   start. Created by: building-vanilla-slices skill, slice-01-shell-settings
 *   plan. */
var Router = (function () {
  "use strict";

  var view = null;

  /* Batch-1 i18n (slice-17 Task 2): shell chrome strings only (404, home,
   * not-ported suffix). Route titles + per-view placeholders stay hardcoded
   * English for later per-view batches. Same t() fallback shape as
   * settings.js: I18n when loaded, verbatim default otherwise. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Function (not const): the suffix re-resolves on every render so a locale
   * switch re-renders it without reload. Default holds a literal em-dash to
   * match en.json verbatim (drift check compares source text, not \\uXXXX). */
  function notPortedSuffix() { return t("shell.not_ported_suffix", " — not yet ported; tracked in slice N"); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      if (c === "&") return "&amp;";
      if (c === "<") return "&lt;";
      if (c === ">") return "&gt;";
      if (c === '"') return "&quot;";
      return "&#39;";
    });
  }

  /* placeholder: stub renderer for not-yet-ported routes. Params: title
   *   (string). Returns a render function (root) -> void. Fails: never — a
   *   missing root is a no-op, strings are HTML-escaped. */
  function placeholder(title) {
    return function (root) {
      if (!root) return;
      root.innerHTML =
        '<div class="wrap"><h1>' + escapeHtml(title) + "</h1>" +
        '<p class="muted">' + escapeHtml(title + notPortedSuffix()) + "</p></div>";
    };
  }

  /* render404: unknown-route page with a dashboard link. Params: root
   *   (element). Returns nothing. Fails: never — a missing root is a no-op. */
  function render404(root) {
    if (!root) return;
    root.innerHTML =
      '<div class="wrap"><h1>' + escapeHtml(t("shell.page_not_found", "Page Not Found")) + "</h1>" +
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
   *   links. dashboard-ui.js lazy-loads here so index.html needs no new
   *   script tag: when the global is absent we inject js/dashboard-ui.js
   *   once, paint a loading line, and re-render on load; a failed load
   *   falls back to the old market redirect so the page is never blank. */
  var dashLoading = false;

  /* dashSrc: absolute URL for the dashboard script (document.baseURI keeps
   *   it correct under any served sub-path; file:// included). Params: none.
   *   Returns a URL string. Fails: never throws — falls back to relative. */
  function dashSrc() {
    try {
      if (typeof document !== "undefined" && document.baseURI) {
        return new URL("js/dashboard-ui.js", document.baseURI).toString();
      }
    } catch (e) { /* relative fallback below */ }
    return "js/dashboard-ui.js";
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
    { path: "/help/**", title: "Help", render: function (root, params) { HelpUI.renderHelp(root, params); } },
    { path: "/htlc/:id", title: "HTLC", render: function (root, params) { HtlcUI.renderHtlcDetail(root, params && params.id); } },
    { path: "/htlc", title: "HTLC", render: function (root) { HtlcUI.renderHtlc(root); } },
    { path: "/prediction", title: "Prediction Markets", render: function (root) { PredictionUI.renderList(root); } },
    { path: "/prediction/:market", title: "Prediction Markets", render: function (root, params) { PredictionUI.renderDetail(root, params && params.market); } },
    { path: "/instant-trade", title: "Instant Trade", render: function (root) { InstantTradeUI.renderInstant(root, null); } },
    { path: "/instant-trade/:marketID", title: "Instant Trade", render: function (root, params) { InstantTradeUI.renderInstant(root, params && params.marketID); } },
    { path: "/pools/:id", title: "Liquidity Pool", render: function (root, params) { PoolDetailUI.renderPoolDetail(root, params && params.id); } },
    { path: "/pools", title: "Liquidity Pools", render: function (root) { PoolUI.renderPools(root); } },
    { path: "/swap", title: "Swap", render: function (root) { PoolSwapUI.renderSwap(root); } },
    { path: "/alerts", title: "Price Alerts", render: function (root) { NotifyUI.render(root); } },
    { path: "/assets", title: "Assets", render: function (root) { AssetUI.renderAssets(root); } },
    { path: "/assets/create", title: "Create Asset", render: function (root) { AssetUI.renderCreate(root); } },
    { path: "/assets/update/:symbol", title: "Update Asset", render: function (root, params) { AssetManageUI.renderUpdate(root, params && params.symbol); } },
    { path: "/assets/issue", title: "Issue Asset", render: function (root) { AssetManageUI.renderIssue(root); } },
    { path: "/assets/feed", title: "Publish Feed", render: function (root) { AssetFeedUI.renderFeed(root); } },
    { path: "/fees", title: "Network Fees", render: function (root) { FeesUI.renderFees(root); } },
    { path: "/referrals", title: "Referrals", render: function (root) { ReferralsUI.renderReferrals(root); } },
    { path: "/favourites", title: "Favourites", render: function (root) { FavouritesUI.renderFavourites(root); } },
    { path: "/ops", title: "Top Operations", render: function (root) { OpsUI.renderOps(root); } },
    { path: "*", title: "Page Not Found", render: render404 }
  ];

  function splitSegments(path) {
    if (!path || path === "/") return [];
    return path.split("/").filter(function (s) { return s.length > 0; });
  }

  /* matchPattern: one pattern against one path. Params: pattern (string with
   *   :params or trailing /**), path (string). Returns {params} or null.
   *   Fails: never throws — bad-decode segments fall back to the raw text. */
  function matchPattern(pattern, path) {
    if (pattern === "*") return null;
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

  /* render: draws currentPath into #view. Params: none. Returns nothing.
   *   Fails: never throws on routing — unknown paths render the 404 view
   *   (view errors themselves propagate). No-op before start(). */
  function render() {
    if (!view) return;
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
    if (typeof document !== "undefined") document.title = title;
    fn(view, params);
  }

  /* start: binds hashchange and renders once. Params: viewEl (element).
   *   Returns nothing. Fails: never throws — render is safe on any hash. */
  function start(viewEl) {
    view = viewEl;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.removeEventListener("hashchange", render);
      window.addEventListener("hashchange", render);
    }
    render();
  }

  return { start: start, routes: routes, match: match, placeholder: placeholder };
})();

/* Expose the single Router global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.Router === "undefined") { globalThis.Router = Router; }
if (typeof module !== "undefined") { module.exports = Router; }
