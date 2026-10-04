/* news-ui.js — static info view (stub-batch 2, matrix §A row A14).
 * Owns: /news. Reference #1's News.jsx pulls an external Steemit feed — an
 *   off-chain hosted dependency this wallet will not bundle (anti-rot §4.5:
 *   nothing with a release cycle, no hosted feed that can move). So this
 *   view is HONESTLY STATIC: it says there is no in-app feed, shows live
 *   connection/network state (Chain.status + Store network), and links at
 *   useful in-app pages. No fake headlines, no fetched feed, no dates.
 * Consumes: Chain (status, guarded), Store (network name, guarded).
 *   No wallet, no account, no amounts — no Format vectors apply.
 *   Global NewsUI only; static render, no subscriptions (connection line is
 *   point-in-time with a Settings pointer, never a stale promise).
 * Refs: App.jsx:558 (News); News.jsx:27-33 (external steemit fetch — NOT copied).
 * Created by: stub-queue build (matrix §A STUB queue, batch 2).
 */
var NewsUI = (function () {
  "use strict";

  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. vars supports
   * %(name)s templates at a few asset/named-count labels. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  var gen = 0;
  /* No local el/clearRoot — use DOM.el, DOM.clear */
  /* Point-in-time connection line (honest: labeled as current state, with a
   * Settings pointer when offline — never a live-updating promise). */
  function connectionLine() {
    var state = "unknown", network = "mainnet";
    try {
      if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
        state = Chain.status().state || "unknown";
      }
    } catch (e) { state = "unknown"; }
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) network = s.network;
      }
    } catch (e) { /* default stands */ }
    return "Network: " + network + " · connection: " + state +
      (state === "open" ? "" : " (see Settings → Nodes)");
  }

  /* Route entry: static wallet-status + in-app links. No fetch, no feed.
   * The connection line binds Store "connection" (gen-guarded) so a slow
   * socket still resolves to the live state instead of a stale snapshot. */
  function renderNews(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    DOM.clear(root);
    var wrap = doc.createElement("div"); wrap.className = "wrap"; root.appendChild(wrap);
    wrap.appendChild(DOM.pageHead(doc, t("news.news", "News"), "news"));
    wrap.appendChild(DOM.el(doc, "p", t("news.this_wallet_ships_no_in_app_news_feed_the_ref", "This wallet ships no in-app news feed: the reference UI pulled headlines from an external blog service, and bundling a hosted feed would break the day its owner moves it. Chain status and the pages below are always current."), "muted"));
    wrap.appendChild(DOM.el(doc, "p", t("news.no_feed_fetch_is_attempted_so_there_is_no", "No feed fetch is attempted, so there is no feed loading spinner or fetch-error panel — the live connection line below is the loading/error indicator for this page."), "muted"));
    var conn = DOM.el(doc, "p", t("news.checking_connection", "Checking connection…"), "muted");
    conn.setAttribute("aria-live", "polite");
    wrap.appendChild(conn);
    try { conn.textContent = connectionLine(); } catch (e) { conn.textContent = t("news.network_unknown_connection_unknown_see_se", "Network: unknown · connection: unknown (see Settings → Nodes)"); }
    if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
      var off = Store.subscribe("connection", function () {
        if (myGen !== gen) { try { off(); } catch (e) {} return; }
        try { conn.textContent = connectionLine(); } catch (e) { /* line stays */ }
      });
    }
    wrap.appendChild(DOM.el(doc, "h2", t("news.start_here", "Start here")));
    var list = doc.createElement("ul");
    [["#/market/BTS_USD", t("news.exchange_trade_on_the_dex", "Exchange — trade on the DEX")],
     ["#/account/me", t("news.account_overview_balances_and_history", "Account overview — balances and history")],
     ["#/transfer", t("news.transfer_send_assets", "Transfer — send assets")],
     ["#/voting", t("news.voting_witnesses_committee_workers", "Voting — witnesses, committee, workers")],
     ["#/explorer", t("news.explorer_blocks_and_transactions", "Explorer — blocks and transactions")],
     ["#/help", t("news.help_how_each_part_works", "Help — how each part works")],
     ["#/settings", t("news.settings_nodes_and_themes", "Settings — nodes and themes")]].forEach(function (pr) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.href = pr[0]; a.textContent = pr[1]; li.appendChild(a); list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  return { renderNews: renderNews };
})();

if (typeof module !== "undefined") { module.exports = NewsUI; }
