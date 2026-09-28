/* help-ui.js — help index + topic views (stub-batch 2, matrix §A row A28).
 * Owns: /help/** (index at /help, one view per topic key). Topic list follows
 *   reference #1's help structure (app/help/en/toc.md: accounts, assets,
 *   components, dex, gateways, voting, glossary, disclaimer, introduction).
 *   HONESTY NOTE: the summaries below are short guides written for THIS
 *   wallet (navigational — "what it is, where it lives here"), NOT #1's full
 *   help text, which is not vendored. Each topic links at the in-app screen
 *   that implements it. Unknown keys render an honest unknown-topic page,
 *   never a blank page.
 * Consumes: nothing (static data + DOM). No wallet, no chain, no amounts —
 *   no Format vectors apply. Global HelpUI only; static renders.
 * Refs: App.jsx:618-633 (/help + 3 nested :path routes); toc.md structure.
 * Created by: stub-queue build (matrix §A STUB queue, batch 2).
 */
var HelpUI = (function () {
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
  /* key, title, one-line guide (own words, navigational), in-app route or null. */
  var TOPICS = [
    ["disclaimer", "Disclaimer", "Keys stay on your device; nothing here is financial advice. Back up before funding.", null],
    ["bitshares", "What is BitShares", "A delegated-proof-of-stake chain with an on-chain exchange. Start at the market desk.", "#/market/BTS_USD"],
    ["wallets", "Wallets", "A wallet holds your brainkey and derives owner, active and memo keys. Managed under Wallet.", "#/wallet"],
    ["backups", "Backups", "Your brainkey IS the backup — write it down. View it any time in the wallet manager.", "#/wallet"],
    ["blockchain", "Blockchain", "Blocks, transactions and objects, browsable in the explorer.", "#/explorer"],
    ["voting", "Voting", "Vote for witnesses, committee members and workers, or set a proxy.", "#/voting"],
    ["accounts-general", "Accounts", "One name, one on-chain account: balances, orders and history.", "#/accounts"],
    ["accounts-proposed", "Proposed transactions", "Multi-signature proposals: review and approve pending actions.", "#/proposals"],
    ["accounts-permissions", "Permissions", "Owner, active and memo keys and what each one may sign.", "#/accounts"],
    ["accounts-membership", "Memberships", "Basic vs lifetime membership tiers and what changes.", "#/accounts"],
    ["assets-mpa", "Market-pegged assets", "Smartcoins backed by collateral with price feeds from witnesses.", "#/assets"],
    ["assets-uia", "User-issued assets", "Anyone can issue a custom token; create and manage them under Assets.", "#/assets/create"],
    ["assets-private", "Privatized BitAssets", "Issuer-controlled assets with restricted transfer lists.", "#/assets"],
    ["dex-intro", "Decentralized exchange", "Order books settle on-chain — the desk shows book, chart and your orders.", "#/market/BTS_USD"],
    ["dex-trading", "Trading", "Limit orders with exact prices; instant-trade wraps the same path in one screen.", "#/instant-trade"],
    ["dex-shorting", "Borrowing and shorting", "Borrow smartcoins against collateral; positions and margin calls under Borrow.", "#/borrow"],
    ["gateways", "Gateways", "Move coins across chains via gateway bridges (deposit / withdraw desks).", "#/deposit-withdraw"],
    ["gateways-xbts", "XBTS gateway", "XBTS bridge desk with supported coins and manual fallback.", "#/deposit-withdraw"],
    ["gateways-ioxbank", "IOXBank gateway", "IOXBank bridge desk with supported coins.", "#/deposit-withdraw"],
    ["glossary", "Glossary", "Names used across this wallet: objects (1.x.y), operations, witnesses, committee.", null]
  ];
  function topicByKey(key) {
    for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i][0] === key) return TOPICS[i];
    return null; }
  /* textContent-only element (topic strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }

  /* Route entry: empty wildcard -> index; known key -> topic; else honest miss. */
  function renderHelp(root, params) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    var key = params && typeof params.wildcard === "string" ? params.wildcard.replace(/^\/+|\/+$/g, "") : "";
    if (!key) { paintIndex(doc, wrap); return; }
    var hit = topicByKey(key);
    if (!hit) {
      wrap.appendChild(el(doc, "h1", t("help.help", "Help")));
      wrap.appendChild(el(doc, "p", "No help topic named “" + key + "”. Pick one from the index.", "muted"));
      paintIndexList(doc, wrap);
      return;
    }
    paintTopic(doc, wrap, hit);
  }

  /* Index: every topic as a link (mirrors the #1 toc structure). */
  function paintIndex(doc, wrap) {
    wrap.appendChild(el(doc, "h1", t("help.help", "Help")));
    wrap.appendChild(el(doc, "p", t("help.short_guides_for_each_part_of_the_wallet_thes", "Short guides for each part of the wallet. These are summaries written for this app, not the reference UI's full help pages."), "muted"));
    paintIndexList(doc, wrap);
  }
  function paintIndexList(doc, wrap) {
    var list = doc.createElement("ul");
    TOPICS.forEach(function (e) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.href = "#/help/" + e[0]; a.textContent = t("help.topic_" + e[0] + "_title", e[1]); li.appendChild(a); list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  /* Topic: title + guide summary + in-app pointer + back to index. */
  function paintTopic(doc, wrap, topic) {
    wrap.appendChild(el(doc, "h1", t("help.topic_" + topic[0] + "_title", topic[1])));
    wrap.appendChild(el(doc, "p", t("help.topic_" + topic[0] + "_text", topic[2])));
    if (topic[3]) {
      var p = el(doc, "p", null, "muted"), a = doc.createElement("a");
      a.href = topic[3]; a.textContent = t("help.open_in_the_wallet", "Open in the wallet");
      p.appendChild(a); wrap.appendChild(p);
    } else {
      wrap.appendChild(el(doc, "p", t("help.reference_reading_no_dedicated_wallet_screen", "Reference reading — no dedicated wallet screen."), "muted"));
    }
    var back = el(doc, "p", null, "muted"), b = doc.createElement("a");
    b.href = "#/help"; b.textContent = t("help.all_help_topics", "All help topics");
    back.appendChild(b); wrap.appendChild(back);
  }

  return { renderHelp: renderHelp, TOPICS: TOPICS };
})();

if (typeof module !== "undefined") { module.exports = HelpUI; }
