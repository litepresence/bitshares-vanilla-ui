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
  var gen = 0;
  /* textContent-only element (chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
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
    clearRoot(root);
    var wrap = doc.createElement("div"); wrap.className = "wrap"; root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", "News"));
    wrap.appendChild(el(doc, "p", "This wallet ships no in-app news feed: the reference UI pulled headlines from an external blog service, and bundling a hosted feed would break the day its owner moves it. Chain status and the pages below are always current.", "muted"));
    var conn = el(doc, "p", connectionLine(), "muted");
    wrap.appendChild(conn);
    if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
      var off = Store.subscribe("connection", function () {
        if (myGen !== gen) { try { off(); } catch (e) {} return; }
        try { conn.textContent = connectionLine(); } catch (e) { /* line stays */ }
      });
    }
    wrap.appendChild(el(doc, "h3", "Start here"));
    var list = doc.createElement("ul");
    [["#/market/BTS_USD", "Exchange — trade on the DEX"],
     ["#/account/overview", "Account overview — balances and history"],
     ["#/transfer", "Transfer — send assets"],
     ["#/voting", "Voting — witnesses, committee, workers"],
     ["#/explorer", "Explorer — blocks and transactions"],
     ["#/help", "Help — how each part works"],
     ["#/settings", "Settings — nodes and themes"]].forEach(function (pr) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.href = pr[0]; a.textContent = pr[1]; li.appendChild(a); list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  return { renderNews: renderNews };
})();

if (typeof module !== "undefined") { module.exports = NewsUI; }
