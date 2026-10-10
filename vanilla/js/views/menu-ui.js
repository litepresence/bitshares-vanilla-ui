/* menu-ui.js — sitemap table-of-contents pages (#/menu + #/menu/:section).
 * Owns: the MenuUI.SECTIONS sitemap table (single source: 7 sections, 53
 *   page links, every list route exactly once), the #/menu overview renderer
 *   and the #/menu/:section renderer (card grids + in-page substring filter).
 *   Consumes: Icon.img for card glyphs (guarded — text-only cards when
 *   absent), I18n.t for titles/blurbs (guarded English defaults). No chain,
 *   no wallet, no amounts — no Format vectors apply (page counts only).
 *   Side effects: DOM under the given root only. No listeners outside root.
 *   Globals: single MenuUI (+ module.exports). Static renders.
 * Created by: building-vanilla-slices skill, menu-sitemap plan
 *   (docs/superpowers/plans/2026-10-03-menu-sitemap.md, Task 1).
 * Reference: router.js route table (§6) for href truth; help-ui.js TOPICS
 *   for the mirrored help index (same 6 headings). */
var MenuUI = (function () {
  "use strict";

  /**
   * @typedef {object} MenuLink
   * @property {string} href
   * @property {string} icon
   * @property {string} titleKey
   * @property {string} titleDefault
   * @property {string} blurbKey
   * @property {string} blurbDefault
   * @typedef {object} MenuSection
   * @property {string} slug
   * @property {string} icon
   * @property {string} titleKey
   * @property {string} titleDefault
   * @property {string} blurbKey
   * @property {string} blurbDefault
   * @property {MenuLink[]} links
   */

  /* Batch-pattern i18n (slice-17 precedent): display strings resolve via
   * I18n.t with the pre-conversion literal kept verbatim as enDefault.
   * Falls back to the default when i18n.js failed to load: never blank,
   * never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* SECTIONS: the sitemap. Binding order per the menu-sitemap design spec
   * (§3) plus the Community card (help/community split 2026-10-04), the
   *   About card (about spec 2026-10-04), and the Labs/Personal split
   *   (nav-pulldown Task 3, owner ruling 2026-10-04: API Lab + ES Lab in
   *   NEITHER menu, reached via the Labs TOC page):
   *   wallet 14, trade 8, earn 7, govern 4, explore 9, labs 3, personal 7 = 52.
   * Icons are icon.js KNOWN names (decorative <img>, never load-bearing).
   * Detail routes (/pools/:id, /asset/:symbol, …) are never listed — their
   * list parents link onward, as in #1. */
  var SECTIONS = [
    { slug: "wallet", icon: "wallet",
      titleKey: "menu.section_wallet", titleDefault: "Wallet",
      blurbKey: "menu.blurb_wallet", blurbDefault: "Money in and out, accounts, and your keys.",
      links: [
        { href: "#/", icon: "dashboard", titleKey: "menu.p_dashboard", titleDefault: "Dashboard", blurbKey: "menu.d_dashboard", blurbDefault: "Markets at a glance and your watched account." },
        { href: "#/account/me", icon: "user", titleKey: "menu.p_my_account", titleDefault: "My account", blurbKey: "menu.d_my_account", blurbDefault: "Your balances, open orders, and history." },
        { href: "#/accounts", icon: "people", titleKey: "menu.p_accounts", titleDefault: "Accounts", blurbKey: "menu.d_accounts", blurbDefault: "Manage and follow accounts." },
        { href: "#/transfer", icon: "transfer", titleKey: "menu.p_transfer", titleDefault: "Transfer", blurbKey: "menu.d_transfer", blurbDefault: "Send any asset, with optional encrypted memo." },
        { href: "#/invoice", icon: "merchant", titleKey: "menu.p_invoice", titleDefault: "Invoice", blurbKey: "menu.d_invoice", blurbDefault: "Request a precise payment with a shareable link." },
        { href: "#/vesting", icon: "hourglass", titleKey: "menu.p_vesting", titleDefault: "Vesting", blurbKey: "menu.d_vesting", blurbDefault: "Time-locked balances and claiming." },
        { href: "#/wallet", icon: "wallet", titleKey: "menu.p_wallet", titleDefault: "Wallet", blurbKey: "menu.d_wallet", blurbDefault: "Keys, backups, and lock state." },
        { href: "#/wallet/password", icon: "key", titleKey: "menu.p_password", titleDefault: "Change wallet password", blurbKey: "menu.d_password", blurbDefault: "Re-encrypt the local vault." },
        { href: "#/create-wallet-brainkey", icon: "paperclip", titleKey: "menu.p_brainkey", titleDefault: "Create Wallet (Brainkey)", blurbKey: "menu.d_brainkey", blurbDefault: "New wallet from a word brainkey." },
        { href: "#/existing-account", icon: "download", titleKey: "common.import_existing", titleDefault: "Import existing account", blurbKey: "menu.d_import", blurbDefault: "Bring keys into this wallet." },
        { href: "#/create-account", icon: "plus-circle", titleKey: "menu.p_register", titleDefault: "Register a new account", blurbKey: "menu.d_register", blurbDefault: "Claim a name via the faucet." },
        { href: "#/login", icon: "unlocked", titleKey: "menu.p_login", titleDefault: "Login", blurbKey: "menu.d_login", blurbDefault: "Unlock the local vault." },
        { href: "#/registration", icon: "clippy", titleKey: "menu.p_registration", titleDefault: "Registration", blurbKey: "menu.d_registration", blurbDefault: "Cloud, local, and brainkey sign-up paths." },
        { href: "#/referrals", icon: "thumbs-up", titleKey: "menu.p_referrals", titleDefault: "Referrals", blurbKey: "menu.d_referrals", blurbDefault: "Fee splits from accounts you brought in." }
      ] },
    { slug: "trade", icon: "trade",
      titleKey: "menu.section_trade", titleDefault: "Trade",
      blurbKey: "menu.blurb_trade", blurbDefault: "Markets, pools, and moving coins in.",
      links: [
        { href: "#/markets", icon: "trade", titleKey: "menu.p_exchange", titleDefault: "Exchange", blurbKey: "menu.d_exchange", blurbDefault: "Order book, charts, and buy/sell desk." },
        { href: "#/instant-trade", icon: "instant-trade", titleKey: "menu.p_instant", titleDefault: "Instant Trade", blurbKey: "menu.d_instant", blurbDefault: "One-screen buy and sell at market price." },
        { href: "#/pools", icon: "pools", titleKey: "menu.p_pools", titleDefault: "Liquidity Pools", blurbKey: "menu.d_pools", blurbDefault: "Supply pairs and earn swap fees." },
        { href: "#/borrow", icon: "borrow", titleKey: "menu.p_borrow", titleDefault: "Borrow", blurbKey: "menu.d_borrow", blurbDefault: "Borrow smartcoins against BTS collateral." },
        { href: "#/barter", icon: "barter", titleKey: "menu.p_barter", titleDefault: "Barter", blurbKey: "menu.d_barter", blurbDefault: "Propose direct asset-for-asset trades." },
        { href: "#/deposit-withdraw", icon: "deposit", titleKey: "menu.p_gateway", titleDefault: "Deposit / Withdraw", blurbKey: "menu.d_gateway", blurbDefault: "Gateway bridges to outside chains." },
        { href: "#/samet", icon: "shuffle", titleKey: "menu.p_samet", titleDefault: "Same-T Funds", blurbKey: "menu.d_samet", blurbDefault: "Pooled same-asset funds and draws." },
        { href: "#/spotlight", icon: "eye", titleKey: "menu.p_spotlight", titleDefault: "Spotlight", blurbKey: "menu.d_spotlight", blurbDefault: "Recurring spotlight order desk." }
      ] },
    { slug: "earn", icon: "dollar",
      titleKey: "menu.section_earn", titleDefault: "Earn & Protect",
      blurbKey: "menu.blurb_earn", blurbDefault: "Yield, locks, and permission safety.",
      links: [
        { href: "#/credit-offer", icon: "dollar", titleKey: "menu.p_credit", titleDefault: "Credit Offer", blurbKey: "menu.d_credit", blurbDefault: "Lend on your terms; track deals." },
        { href: "#/direct-debit", icon: "direct_debit", titleKey: "menu.p_debit", titleDefault: "Direct Debit", blurbKey: "menu.d_debit", blurbDefault: "Recurring authorized pulls." },
        { href: "#/htlc", icon: "htlc", titleKey: "menu.p_htlc", titleDefault: "HTLC", blurbKey: "menu.d_htlc", blurbDefault: "Hash time-locked atomic swaps." },
        { href: "#/tickets", icon: "thumb-tack", titleKey: "menu.p_tickets", titleDefault: "Tickets", blurbKey: "menu.d_tickets", blurbDefault: "Vote-locked stake with growing weight." },
        { href: "#/airdrop", icon: "share", titleKey: "menu.p_airdrop", titleDefault: "Airdrop", blurbKey: "menu.d_airdrop", blurbDefault: "Distribute an asset to many accounts." },
        { href: "#/authorities", icon: "locked", titleKey: "menu.p_authorities", titleDefault: "Custom Authorities", blurbKey: "menu.d_authorities", blurbDefault: "Named permission roles beyond owner/active." },
        { href: "#/lists", icon: "minus-circle", titleKey: "menu.p_lists", titleDefault: "Account Lists", blurbKey: "menu.d_lists", blurbDefault: "Allow and block lists for assets." }
      ] },
    { slug: "govern", icon: "voting",
      titleKey: "menu.section_govern", titleDefault: "Govern",
      blurbKey: "menu.blurb_govern", blurbDefault: "Votes, proposals, and prediction markets.",
      links: [
        { href: "#/voting", icon: "voting", titleKey: "menu.p_voting", titleDefault: "Voting", blurbKey: "menu.d_voting", blurbDefault: "Witnesses, committee, workers, and proxies." },
        { href: "#/proposals", icon: "grouping", titleKey: "menu.p_proposals", titleDefault: "Proposals", blurbKey: "menu.d_proposals", blurbDefault: "Pending multi-signature actions." },
        { href: "#/create-worker", icon: "cogs", titleKey: "menu.p_worker", titleDefault: "Create Worker", blurbKey: "menu.d_worker", blurbDefault: "Propose chain-funded work." },
        { href: "#/prediction", icon: "prediction", titleKey: "menu.p_prediction", titleDefault: "Prediction Markets", blurbKey: "menu.d_prediction", blurbDefault: "YES/NO shares on real outcomes." }
      ] },
    { slug: "explore", icon: "server",
      titleKey: "menu.section_explore", titleDefault: "Explore",
      blurbKey: "menu.blurb_explore", blurbDefault: "Chain truth: blocks, assets, fees, activity.",
      links: [
        { href: "#/explorer", icon: "server", titleKey: "menu.p_explorer", titleDefault: "Explore", blurbKey: "menu.d_explorer", blurbDefault: "Blocks, transactions, and objects." },
        { href: "#/assets", icon: "assets", titleKey: "menu.p_assets", titleDefault: "Assets", blurbKey: "menu.d_assets", blurbDefault: "Browse every listed asset." },
        { href: "#/assets/create", icon: "plus-circle", titleKey: "menu.p_asset_create", titleDefault: "Create asset", blurbKey: "menu.d_asset_create", blurbDefault: "Issue your own token." },
        { href: "#/assets/issue", icon: "deposit", titleKey: "menu.p_asset_issue", titleDefault: "Issue Asset", blurbKey: "menu.d_asset_issue", blurbDefault: "Mint supply of an asset you control." },
        { href: "#/assets/feed", icon: "connected", titleKey: "menu.p_asset_feed", titleDefault: "Publish feed", blurbKey: "menu.d_asset_feed", blurbDefault: "Publish price feeds as issuer or witness." },
        { href: "#/fees", icon: "dollar-green", titleKey: "menu.p_fees", titleDefault: "Network fees", blurbKey: "menu.d_fees", blurbDefault: "What each operation costs." },
        { href: "#/ops", icon: "list", titleKey: "menu.p_ops", titleDefault: "Operations", blurbKey: "menu.d_ops", blurbDefault: "Ranked operation counts from recent blocks." },
        { href: "#/top-ops", icon: "fire", titleKey: "menu.p_topops", titleDefault: "Top Operations", blurbKey: "menu.d_topops", blurbDefault: "Rankings with the chain-activity donut." },
        { href: "#/news", icon: "news", titleKey: "menu.p_news", titleDefault: "News", blurbKey: "menu.d_news", blurbDefault: "Project news and updates." }
      ] },
    { slug: "labs", icon: "cogs",
      titleKey: "menu.section_labs", titleDefault: "Labs",
      blurbKey: "menu.blurb_labs", blurbDefault: "Power tools for chain and node work.",
      links: [
        { href: "#/api-lab", icon: "insight", titleKey: "menu.p_apilab", titleDefault: "API Lab", blurbKey: "menu.d_apilab", blurbDefault: "Probe node methods with a 29-call catalog." },
        { href: "#/es-lab", icon: "zoom", titleKey: "menu.p_eslab", titleDefault: "ES Lab", blurbKey: "menu.d_eslab", blurbDefault: "Search the community history index." },
        { href: "#/txbuilder", icon: "checkmark-circle", titleKey: "menu.p_txbuilder", titleDefault: "Transaction Builder", blurbKey: "menu.d_txbuilder", blurbDefault: "Compose many operations, sign once." },
        { href: "#/account-network", icon: "connected", titleKey: "menu.p_account_net", titleDefault: "Account Network", blurbKey: "menu.d_account_net", blurbDefault: "transfer tracking" }
      ] },
    { slug: "personal", icon: "user",
      titleKey: "menu.section_personal", titleDefault: "Personal",
      blurbKey: "menu.blurb_personal", blurbDefault: "Chat, alerts, and your setup.",
      links: [
        { href: "#/trollbox", icon: "text", titleKey: "menu.p_trollbox", titleDefault: "Trollbox", blurbKey: "menu.d_trollbox", blurbDefault: "On-chain public chat channels." },
        { href: "#/favourites", icon: "fi-star", titleKey: "menu.p_favourites", titleDefault: "Favourites", blurbKey: "menu.d_favourites", blurbDefault: "Pinned markets, assets, and accounts." },
        { href: "#/alerts", icon: "alarm", titleKey: "menu.p_alerts", titleDefault: "Price Alerts", blurbKey: "menu.d_alerts", blurbDefault: "Get notified when a market crosses your price." },
        { href: "#/help", icon: "question-circle", titleKey: "menu.p_help", titleDefault: "Help", blurbKey: "menu.d_help", blurbDefault: "Guides for every part of the wallet." },
        { href: "#/about", icon: "info-circle-o", titleKey: "menu.p_about", titleDefault: "About", blurbKey: "menu.d_about", blurbDefault: "What this wallet is and why it is built this way." },
        { href: "#/community", icon: "people", titleKey: "menu.p_community", titleDefault: "Community", blurbKey: "menu.d_community", blurbDefault: "Chats, forums, explorers, and code." },
        { href: "#/settings", icon: "cog", titleKey: "menu.p_settings", titleDefault: "Settings", blurbKey: "menu.d_settings", blurbDefault: "Nodes, themes, language, and housekeeping." }
      ] }
  ];

  /* findSection: slug -> section object or null. Params: slug (any).
   * Returns the section or null. Pure, unit-tested. Never throws. */
  function findSection(slug) {
    try {
      for (var i = 0; i < SECTIONS.length; i++) {
        if (SECTIONS[i].slug === slug) return SECTIONS[i];
      }
    } catch (e) { /* null below */ }
    return null;
  }

  /* sectionSlugs: ["wallet","trade","earn","govern","explore","labs","personal"].
   * Params: none. Returns a fresh array. Pure, unit-tested. */
  function sectionSlugs() {
    return SECTIONS.map(function (s) { return s.slug; });
  }

  /* No local el/clearRoot — use DOM.el, DOM.clear */

  /* iconOK: vendored-icon availability probe. Params: none. Returns boolean.
   * Never throws. */
  function iconOK() {
    try {
      return (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function");
    } catch (e) { return false; }
  }

  /* card: one full-card <a> for a link (icon + title + blurb). Params: doc,
   *   link ({href, icon, titleKey/titleDefault, blurbKey/blurbDefault}).
   *   Returns the anchor. Never throws — Icon failures fall back to text. */
  function card(doc, link) {
    var a = doc.createElement("a");
    a.className = "menu-card";
    a.setAttribute("href", link.href);
    var title = t(link.titleKey, link.titleDefault);
    var blurb = t(link.blurbKey, link.blurbDefault);
    try { a.dataset.search = (title + " " + blurb + " " + link.href).toLowerCase(); }
    catch (e) { /* filter skips this card */ }
    try {
      if (iconOK()) a.appendChild(Icon.img(link.icon, "nav-icon", ""));
    } catch (e) { /* text stands */ }
    var body = doc.createElement("span");
    body.className = "menu-card-body";
    var b = doc.createElement("b");
    b.textContent = title;
    body.appendChild(b);
    var small = doc.createElement("small");
    small.textContent = blurb;
    body.appendChild(small);
    a.appendChild(body);
    return a;
  }

  /* grid: card grid + live substring filter. Params: doc, wrap, cards
   *   ([{href,title,blurb}] via card() anchors already carrying
   *   dataset.search). Returns nothing. The filter input + empty note render
   *   here so overview and section pages share one code path. Never throws. */
  function grid(doc, wrap, anchors) {
    var search = doc.createElement("input");
    search.type = "search";
    search.className = "menu-filter";
    search.setAttribute("aria-label", t("menu.filter", "Filter pages"));
    search.placeholder = t("menu.filter", "Filter pages");
    wrap.appendChild(search);
    var g = doc.createElement("div");
    g.className = "menu-grid";
    anchors.forEach(function (a) { g.appendChild(a); });
    wrap.appendChild(g);
    var empty = DOM.el(doc, "p", t("menu.no_match", "No matching pages. Clear the search to see everything."), "muted");
    empty.style.display = "none";
    wrap.appendChild(empty);
    search.addEventListener("input", function () {
      var q = "";
      try { q = (search.value || "").toLowerCase(); } catch (e) { q = ""; }
      var shown = 0;
      anchors.forEach(function (a) {
        var hay = "";
        try { hay = a.dataset.search || (a.textContent || "").toLowerCase(); }
        catch (e) { hay = ""; }
        var hit = !q || hay.indexOf(q) !== -1;
        a.style.display = hit ? "" : "none";
        if (hit) shown++;
      });
      empty.style.display = shown ? "none" : "block";
    });
  }

  /* pageTitle: section title + page count ("Earn & Protect (7)").
   * Counts are page counts, never chain data. Pure. */
  function pageTitle(section) {
    return t(section.titleKey, section.titleDefault) + " (" + section.links.length + ")";
  }

  /* renderMenu: #/menu overview — one section card per section (linking to
   * its #/menu/<slug> page) plus a global filter over every page.
   * Params: root (element). Returns nothing. Never throws on routing —
   * a missing root is a no-op. */
  function renderMenu(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    DOM.clear(root);
    var wrap = doc.createElement("div");
    wrap.className = "wrap mkt-wrap";
    root.appendChild(wrap);
    wrap.appendChild(DOM.pageHead(doc, t("menu.title", "Menu"), "list"));
    wrap.appendChild(DOM.el(doc, "p",
      t("menu.intro", "Every page in the wallet, grouped by job. Pick a section to see its pages."), "muted"));
    var anchors = [];
    SECTIONS.forEach(function (section) {
      var title = t(section.titleKey, section.titleDefault);
      var blurb = t(section.blurbKey, section.blurbDefault);
      var a = doc.createElement("a");
      a.className = "menu-card";
      a.setAttribute("href", "#/menu/" + section.slug);
      try { a.dataset.search = (title + " " + blurb + " " + section.slug).toLowerCase(); }
      catch (e) { /* filter skips */ }
      try {
        if (iconOK()) a.appendChild(Icon.img(section.icon, "nav-icon", ""));
      } catch (e) { /* text stands */ }
      var body = doc.createElement("span");
      body.className = "menu-card-body";
      var b = doc.createElement("b");
      b.textContent = title + " (" + section.links.length + ")";
      body.appendChild(b);
      var small = doc.createElement("small");
      small.textContent = blurb;
      body.appendChild(small);
      a.appendChild(body);
      anchors.push(a);
    });
    /* The overview filter matches section titles/blurbs; each section
     * page filters its own pages. */
    grid(doc, wrap, anchors);
  }

  /* renderSection: #/menu/:section — breadcrumb, heading with count, filter,
   * page cards. Unknown slug → honest miss + link back to #/menu.
   * Params: root (element), slug (string). Returns nothing. */
  function renderSection(root, slug) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    DOM.clear(root);
    var wrap = doc.createElement("div");
    /* mkt-wrap, not the 720px .wrap: a card index strands a desk monitor in
     * whitespace (viewport-audit A3 flagged 42% on #/menu/labs) — the wide
     * cap lets the card grid earn its pixels. No new CSS. */
    wrap.className = "wrap mkt-wrap";
    root.appendChild(wrap);
    var section = findSection(slug);
    if (!section) {
      wrap.appendChild(DOM.pageHead(doc, t("menu.title", "Menu"), "list"));
      wrap.appendChild(DOM.el(doc, "p",
        t("menu.unknown_section", "No menu section with that name. Pick one below."), "muted"));
      var back = doc.createElement("a");
      back.className = "menu-card";
      back.setAttribute("href", "#/menu");
      back.textContent = t("menu.all_pages", "All pages");
      wrap.appendChild(back);
      return;
    }
    var crumb = DOM.el(doc, "p", null, "muted menu-crumb");
    var home = doc.createElement("a");
    home.setAttribute("href", "#/menu");
    home.textContent = t("menu.title", "Menu");
    crumb.appendChild(home);
    crumb.appendChild(doc.createTextNode(" / " + t(section.titleKey, section.titleDefault)));
    wrap.appendChild(crumb);
    wrap.appendChild(DOM.pageHead(doc, pageTitle(section), "list"));
    wrap.appendChild(DOM.el(doc, "p", t(section.blurbKey, section.blurbDefault), "muted"));
    var anchors = section.links.map(function (link) { return card(doc, link); });
    grid(doc, wrap, anchors);
  }

  return { renderMenu: renderMenu, renderSection: renderSection,
    SECTIONS: SECTIONS, _test: { sectionSlugs: sectionSlugs, findSection: findSection } };
})();

if (typeof module !== "undefined") { module.exports = MenuUI; }
