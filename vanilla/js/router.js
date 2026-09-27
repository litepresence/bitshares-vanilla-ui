/* Router: hash router rendering §6 routes into #view. No dependencies. */
var Router = (function () {
  "use strict";

  var view = null;

  var NOT_PORTED_SUFFIX = " \u2014 not yet ported; tracked in slice N";

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      if (c === "&") return "&amp;";
      if (c === "<") return "&lt;";
      if (c === ">") return "&gt;";
      if (c === '"') return "&quot;";
      return "&#39;";
    });
  }

  function placeholder(title) {
    return function (root) {
      if (!root) return;
      root.innerHTML =
        '<div class="wrap"><h1>' + escapeHtml(title) + "</h1>" +
        '<p class="muted">' + escapeHtml(title + NOT_PORTED_SUFFIX) + "</p></div>";
    };
  }

  function render404(root) {
    if (!root) return;
    root.innerHTML =
      '<div class="wrap"><h1>Page Not Found</h1>' +
      '<p class="muted">Unknown route. <a href="#/">Go to Dashboard</a></p></div>';
  }

  function renderSettings(root, params) {
    if (typeof SettingsPage !== "undefined" && SettingsPage && typeof SettingsPage.render === "function") {
      SettingsPage.render(root, params);
      return;
    }
    placeholder("Settings")(root);
  }

  /* "/" redirects to the DEX desk: last-visited market when stored, else
   * the network default (MarketUI.homeTarget; branding.js:98-108 source).
   * A plain link stays behind so the page is never blank if hashing fails. */
  function renderHome(root) {
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
      '<div class="wrap"><h1>Dashboard</h1>' +
      '<p class="muted">Opening the market… <a href="#/market/' +
      escapeHtml(target) + '">Go to ' + escapeHtml(target) + "</a></p></div>";
  }

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
    { path: "/accounts", title: "Accounts", render: placeholder("Accounts") },
    { path: "/market/:marketID", title: "Exchange", render: renderMarketPage },
    { path: "/credit-offer/:id", title: "Credit Offer", render: function (root, params) { CreditDetailUI.renderOfferDetail(root, params && params.id); } },
    { path: "/credit-offer", title: "Credit Offer", render: function (root) { CreditUI.renderOffers(root); } },
    { path: "/samet", title: "Same-T Funds", render: function (root) { SametUI.renderSamet(root); } },
    { path: "/settings/:tab", title: "Settings", render: renderSettings },
    { path: "/settings", title: "Settings", render: renderSettings },
    { path: "/invoice/:data", title: "Invoice", render: placeholder("Invoice") },
    { path: "/deposit-withdraw", title: "Deposit / Withdraw", render: placeholder("Deposit / Withdraw") },
    { path: "/create-account", title: "Create Account", render: placeholder("Create Account") },
    { path: "/login", title: "Login", render: placeholder("Login") },
    { path: "/registration", title: "Registration", render: placeholder("Registration") },
    { path: "/registration/local", title: "Registration", render: placeholder("Registration") },
    { path: "/registration/cloud", title: "Registration", render: placeholder("Registration") },
    { path: "/news", title: "News", render: placeholder("News") },
    { path: "/voting", title: "Voting", render: function (root) { VoteUI.renderVoting(root); } },
    { path: "/explorer", title: "Explorer", render: function (root) { ExplorerUI.renderExplorer(root, "blocks"); } },
    { path: "/explorer/:tab", title: "Explorer", render: function (root, params) { ExplorerUI.renderExplorer(root, params && params.tab); } },
    { path: "/asset/:symbol", title: "Asset", render: function (root, params) { ExplorerUI.renderAsset(root, params && params.symbol); } },
    { path: "/block/:height", title: "Block", render: function (root, params) { ExplorerUI.renderBlock(root, params && params.height); } },
    { path: "/block/:height/:txIndex", title: "Transaction", render: function (root, params) { ExplorerUI.renderTx(root, params && params.height, params && params.txIndex); } },
    { path: "/borrow", title: "Borrow", render: function (root) { BorrowUI.renderBorrow(root); } },
    { path: "/barter", title: "Barter", render: function (root) { BarterUI.renderBarter(root); } },
    { path: "/direct-debit", title: "Direct Debit", render: function (root) { DebitUI.renderDirectDebit(root); } },
    { path: "/spotlight", title: "Spotlight", render: function (root) { DebitUI.renderSpotlight(root); } },
    { path: "/transfer/:to", title: "Transfer", render: function (root, params) { TransferUI.renderTransfer(root, params && params.to); } },
    { path: "/transfer", title: "Transfer", render: function (root, params) { TransferUI.renderTransfer(root, params && params.to); } },
    { path: "/wallet", title: "Wallet", render: function (root, params) { WalletUI.renderWallet(root, params); } },
    { path: "/create-wallet-brainkey", title: "Create Wallet (Brainkey)", render: function (root, params) { WalletUI.renderCreate(root, params); } },
    { path: "/existing-account", title: "Existing Account", render: function (root, params) { WalletUI.renderImport(root, params); } },
    { path: "/create-worker", title: "Create Worker", render: placeholder("Create Worker") },
    { path: "/help/**", title: "Help", render: placeholder("Help") },
    { path: "/htlc/:id", title: "HTLC", render: function (root, params) { HtlcUI.renderHtlcDetail(root, params && params.id); } },
    { path: "/htlc", title: "HTLC", render: function (root) { HtlcUI.renderHtlc(root); } },
    { path: "/prediction", title: "Prediction Markets", render: placeholder("Prediction Markets") },
    { path: "/prediction/:market", title: "Prediction Markets", render: placeholder("Prediction Markets") },
    { path: "/instant-trade", title: "Instant Trade", render: placeholder("Instant Trade") },
    { path: "/instant-trade/:marketID", title: "Instant Trade", render: placeholder("Instant Trade") },
    { path: "/pools/:id", title: "Liquidity Pool", render: function (root, params) { PoolDetailUI.renderPoolDetail(root, params && params.id); } },
    { path: "/pools", title: "Liquidity Pools", render: function (root) { PoolUI.renderPools(root); } },
    { path: "/swap", title: "Swap", render: function (root) { PoolSwapUI.renderSwap(root); } },
    { path: "/assets", title: "Assets", render: function (root) { AssetUI.renderAssets(root); } },
    { path: "/assets/create", title: "Create Asset", render: function (root) { AssetUI.renderCreate(root); } },
    { path: "/assets/update/:symbol", title: "Update Asset", render: function (root, params) { AssetManageUI.renderUpdate(root, params && params.symbol); } },
    { path: "/assets/issue", title: "Issue Asset", render: function (root) { AssetManageUI.renderIssue(root); } },
    { path: "/assets/feed", title: "Publish Feed", render: function (root) { AssetFeedUI.renderFeed(root); } },
    { path: "*", title: "Page Not Found", render: render404 }
  ];

  function splitSegments(path) {
    if (!path || path === "/") return [];
    return path.split("/").filter(function (s) { return s.length > 0; });
  }

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

  function match(path) {
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (r.path === "*") continue;
      var m = matchPattern(r.path, path);
      if (m) return { route: r, params: m.params };
    }
    return null;
  }

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
