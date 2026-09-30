/* DashboardUI: the #/ account-overview dashboard (NOT a desk clone).
 * Owns: DOM for the "/" route only — watched-account balances, recent
 *   activity, favourite markets, and quick links. When the wallet is
 *   unlocked the watched account is the wallet's own (Account.myAccountId);
 *   otherwise it is the read-only committee-account watch (1.2.0), same
 *   default App.jsx:489-495 falls back to when no account is selected.
 * Consumes: Account.resolve/balances/history/myAccountId (js/account.js),
 *   Wallet.isUnlocked (js/wallet.js, read-only here), Chain.status (connect
 *   gate), Store.subscribe (connection only), MarketUI.defaultMarket +
 *   localStorage fav-markets key (favourite markets, read-only), I18n.t
 *   (display strings with verbatim en defaults), AccountUI.OP_LABELS
 *   (history labels, guarded — private helpers stay in account-ui.js).
 *   Amounts reach the screen ONLY as Account.balances display strings
 *   (Format.formatAmount inside account.js) — no money math here. Globals /
 *   side effects: DOM under the router root only; one localStorage read
 *   (fav markets); global DashboardUI. Generation counter tears down stale
 *   async work on route change (accounts-ui.js pattern).
 * Refs: #1 App.jsx:503-507 (/ -> DashboardPage), DashboardPage.jsx:13-33
 *   (starred/featured market tabs + LoginSelector gate), Markets.jsx:11-31
 *   (starred markets from settings), MenuDataStructure.js:182-198
 *   (dashboard entry targets the current account).
 * Created by: building-vanilla-slices skill, nav-audit dashboard rebuild.
 */
var DashboardUI = (function () {
  "use strict";

  var gen = 0, CONNECT_TIMEOUT_MS = 15000;
  var FAV_KEY = "bts-vanilla-fav-markets-v1";
  var WATCH_NAME = "committee-account";

  /* Display strings resolve via I18n.t with the pre-conversion literal as
   * enDefault (accounts-ui.js shape). Every key below exists in
   * vanilla/locales/en.json with the identical default, so
   * tooling/check_i18n.py stays green. Absent i18n.js: defaults, never blank. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* textContent-only element (user/chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w;
  }

  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("transfer.err_unexpected", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("transfer.err_network", "Network unavailable. Check Settings → Nodes and retry.");
    else if (msg.indexOf("history-unavailable") !== -1) msg = t("account.err_history", "History unavailable on this node.");
    else if (msg.indexOf("bad-asset-shape") !== -1) msg = t("account.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    else if (msg.indexOf("unknown-account") !== -1) msg = t("transfer.unknown_account", "Unknown account.");
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }

  /* Internal link paragraph (href + text pairs, tap-sized links). */
  function linkPara(doc, pairs) {
    var p = el(doc, "p", null, "muted");
    pairs.forEach(function (pr, i) {
      if (i > 0) p.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a"); a.href = pr[0]; a.textContent = pr[1]; touchable(a); p.appendChild(a);
    });
    return p;
  }

  /* Tolerant history-row helpers. account-ui.js:119-148 owns the canonical
   * versions (private there — only OP_LABELS is exported), so this file
   * carries small copies for the 10-row summary. Unknown shapes stay visible. */
  function opTypeOf(row) {
    if (!row || typeof row !== "object") return null;
    if (Array.isArray(row.op) && typeof row.op[0] === "number") return row.op[0];
    if (typeof row.op_type === "number") return row.op_type;
    if (typeof row.type === "number") return row.type;
    return null;
  }

  /* Numeric op type -> human label via the shared AccountUI table when
   * loaded, else a bare fallback. Params: n (number|null). Never throws. */
  function opLabel(n) {
    try {
      if (typeof n === "number" && typeof AccountUI !== "undefined" && AccountUI &&
          AccountUI.OP_LABELS && Object.prototype.hasOwnProperty.call(AccountUI.OP_LABELS, n)) {
        return AccountUI.OP_LABELS[n];
      }
    } catch (e) { /* fallback below */ }
    return n === null ? t("account.unknown_operation", "Unknown operation") : "Operation " + String(n);
  }

  /* Best-effort time text: chain timestamp, else block number, else row id. */
  function timeText(row) {
    if (row.timestamp) return String(row.timestamp);
    if (row.time) return String(row.time);
    if (row.block_time) return String(row.block_time);
    if (row.block_num !== undefined && row.block_num !== null) {
      return t("account.block_prefix", "block #") + String(row.block_num);
    }
    if (row.id) return String(row.id);
    return t("settings.dash", "—");
  }

  /* Favourite market ids from the picker-owned key (market-picker.js owns
   * writes; this page only reads). Broken storage yields []. */
  function favMarkets() {
    try {
      if (typeof localStorage === "undefined") return [];
      var arr = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === "string" && x; }) : [];
    } catch (e) { return []; }
  }

  /* Featured markets per quote base (mirrors #1 DashboardPage preferredBases
   * tabs + FeaturedMarkets). Curated ids only — unknown pairs drop fail-open
   * at fill time, never blank the tab. */
  var FEATURED = {
    BTS: ["BTS_USD", "BTS_CNY", "BTS_BTC", "BTS_ETH"],
    USD: ["BTS_USD", "BTC_USD", "ETH_USD"],
    CNY: ["BTS_CNY", "BTC_CNY"],
    BTC: ["BTS_BTC", "ETH_BTC"]
  };
  /* Session ticker cache (id -> {latest, chg} or null-miss). Fail-open:
   * misses render "—" and retry on next visit, never an error panel. */
  var _tickCache = {};
  function tickRow(id) {
    if (Object.prototype.hasOwnProperty.call(_tickCache, id)) return Promise.resolve(_tickCache[id]);
    var pair = null;
    try {
      if (typeof Market === "undefined" || !Market || typeof Market.parseId !== "function") return Promise.resolve(null);
      pair = Market.parseId(id);
    } catch (e) { _tickCache[id] = null; return Promise.resolve(null); }
    return Market.assets(pair.quote, pair.base).then(function (a) {
      return Market.stats(a.base.id, a.quote.id);
    }).then(function (s) {
      var row = {
        latest: s.latest,
        chg: (s.raw && s.raw.percent_change !== undefined && s.raw.percent_change !== null)
          ? String(s.raw.percent_change) : null
      };
      _tickCache[id] = row;
      return row;
    }).catch(function () { _tickCache[id] = null; return null; });
  }

  /* Network default market for the empty-favourites state
   * (MarketUI.defaultMarket: branding.js:98-108 source). Guarded fallback. */
  function defaultMarket() {
    try {
      if (typeof MarketUI !== "undefined" && MarketUI && typeof MarketUI.defaultMarket === "function") {
        return MarketUI.defaultMarket();
      }
    } catch (e) { /* fallback below */ }
    return "BTS_CNY";
  }

  /* Route entry. Gates backends, then waits for the shared socket (the
   * accounts-ui.js connect-wait pattern — deep links land before boot
   * connects), then paints the overview. */
  function renderDashboard(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Account === "undefined" || !Account) {
      showError(doc, wrap, t("account.backend_missing_account", "Account backend missing: js/account.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "h1", t("shell.dashboard", "Dashboard")));
      wrap.appendChild(el(doc, "p", t("transfer.connecting", "Connecting to network…"), "muted"));
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderDashboard(root);
        }
      });
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        clearRoot(root);
        showError(doc, makeWrap(doc, root), new Error("not connected"), t("transfer.network_unavailable_short", "Network unavailable."));
      }, CONNECT_TIMEOUT_MS);
      return;
    }
    paintDashboard(doc, root, myGen);
  }

  /* Static shell (title, sections, quick links) + async fills for the
   * watched account. Sections never stay blank: every fill has a loading
   * line replaced by data, an empty state, or an error panel. */
  function paintDashboard(doc, root, myGen) {
    if (myGen !== gen) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("shell.dashboard", "Dashboard")));

    var unlocked = false;
    try { unlocked = typeof Wallet !== "undefined" && Wallet && typeof Wallet.isUnlocked === "function" && Wallet.isUnlocked(); }
    catch (e) { unlocked = false; }
    if (!unlocked) {
      wrap.appendChild(gateCard(doc));
      wrap.appendChild(el(doc, "p", t("account.unlock_to_see", "Unlock your wallet to see which on-chain account it controls."), "muted"));
      wrap.appendChild(linkPara(doc, [
        ["#/login", t("auth.login", "Login")],
        ["#/accounts", t("account.manager_title", "Accounts")]
      ]));
    }

    var acctSection = doc.createElement("section");
    wrap.appendChild(acctSection);
    /* Punchlist MED: markets directory (StarredMarkets + FeaturedMarkets
     * tabs) above the fold — balances/history fill below. */
    paintMarkets(doc, wrap);
    var balSection = doc.createElement("section");
    wrap.appendChild(balSection);
    var histSection = doc.createElement("section");
    wrap.appendChild(histSection);
    paintQuickLinks(doc, wrap);

    acctSection.appendChild(el(doc, "p", t("transfer.loading", "Loading…"), "muted"));
    balSection.appendChild(el(doc, "h2", t("account.s7", "Balances")));
    balSection.appendChild(el(doc, "p", t("account.loading_balances", "Loading balances…"), "muted"));
    histSection.appendChild(el(doc, "h2", t("account.history_title", "History")));
    histSection.appendChild(el(doc, "p", t("account.loading_history", "Loading history…"), "muted"));

    resolveWatched(unlocked).then(function (found) {
      if (myGen !== gen) return;
      fillAccount(doc, acctSection, found, unlocked);
      fillBalances(doc, balSection, found, myGen);
      fillHistory(doc, histSection, found, myGen);
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearRoot(acctSection);
      showError(doc, acctSection, e, t("transfer.load_account_failed", "Could not load your account."));
    });
  }

  /* Gate card (locked home, mirrors #1 root.png): centered welcome panel
   *   with Create/Login actions + restore/registration links. Pure links —
   *   no chain calls, no signing. Never throws — missing DOM is a no-op. */
  function gateCard(doc) {
    var card = doc.createElement("section");
    card.className = "dashboard-gate";
    /* Brand mark (mirrors #1 root.png: logo above the welcome heading).
     * Same byte-copied asset as the header brand; decorative here since
     * the header logo already carries the accessible name. */
    try {
      var logo = doc.createElement("img");
      logo.src = "assets/logo-ico-blue.png";
      logo.alt = "";
      logo.width = 64;
      logo.height = 64;
      logo.className = "dashboard-gate-logo";
      card.appendChild(logo);
    } catch (e) { /* gate works without the mark */ }
    card.appendChild(el(doc, "h2", t("dashboard.welcome", "Welcome to BitShares")));
    card.appendChild(el(doc, "p", t("dashboard.tagline", "Your Decentralized Platform"), "muted"));
    var row = doc.createElement("p");
    row.className = "dashboard-gate-row";
    var create = doc.createElement("a");
    create.href = "#/create-account";
    create.className = "btn";
    create.textContent = t("dashboard.create", "Create Account");
    touchable(create);
    row.appendChild(create);
    var login = doc.createElement("a");
    login.href = "#/login";
    login.className = "btn btn-ghost";
    login.textContent = t("auth.login", "Login");
    touchable(login);
    row.appendChild(login);
    card.appendChild(row);
    /* Language select (mirrors #1 gate globe+English dropdown): reuses the
     * settings locale builder so names/honesty rules stay single-sourced.
     * Success re-renders shell + view (settings.js pattern); failure shows
     * the honest line and snaps back. Never blank, never throws. */
    try {
      if (typeof SettingsPrefs !== "undefined" && SettingsPrefs &&
          typeof SettingsPrefs.buildLocale === "function") {
        var loc = SettingsPrefs.buildLocale(doc, t);
        card.appendChild(loc.label);
        card.appendChild(loc.error);
        loc.select.addEventListener("change", function () {
          var code = loc.select.value;
          loc.error.textContent = "";
          if (typeof I18n === "undefined" || !I18n || typeof I18n.setLocale !== "function") {
            loc.error.textContent = "Locale unavailable offline — showing English.";
            return;
          }
          I18n.setLocale(code).then(function (r) {
            if (!r || !r.ok) {
              loc.error.textContent = "Locale unavailable offline — showing English.";
              try { loc.select.value = I18n.locale(); } catch (e) { /* keeps pick */ }
              return;
            }
            try {
              if (typeof App !== "undefined" && App && typeof App.localizeShell === "function") App.localizeShell();
            } catch (e) { /* shell keeps previous strings */ }
            try {
              if (typeof Router !== "undefined" && Router && typeof Router.start === "function") {
                Router.start(doc.getElementById("view") || undefined);
              }
            } catch (e) { /* view keeps previous strings */ }
          });
        });
      }
    } catch (e) { /* gate works without the language row */ }
    var sub = doc.createElement("p");
    sub.className = "muted";
    sub.appendChild(doc.createTextNode(t("dashboard.restore_prefix", "Optionally, ")));
    var restore = doc.createElement("a");
    restore.href = "#/existing-account";
    restore.textContent = t("password.import_existing_account", "Import existing account");
    touchable(restore);
    sub.appendChild(restore);
    card.appendChild(sub);
    return card;
  }

  /* Watched account: the wallet's own when unlocked, else the public
   * committee-account watch (App.jsx:489-495 default). Returns
   * Promise of {id, name, watched}. Fails: wallet-locked/no-account/
   * unknown-account from Account. */
  function resolveWatched(unlocked) {
    if (unlocked) {
      return Account.myAccountId().then(function (id) {
        return Account.resolve(id).then(function (a) { return { id: id, name: a.name, watched: false }; });
      });
    }
    return Account.resolve(WATCH_NAME).then(function (a) { return { id: a.id, name: a.name, watched: true }; });
  }

  /* Account heading: name linked to its page + watch-mode disclaimer. */
  function fillAccount(doc, section, found, unlocked) {
    clearRoot(section);
    var h2 = doc.createElement("h2");
    var a = doc.createElement("a");
    a.href = "#/account/" + encodeURIComponent(found.name);
    a.textContent = found.name;
    touchable(a);
    h2.appendChild(a);
    section.appendChild(h2);
    section.appendChild(el(doc, "p", found.id, "muted"));
    if (found.watched || !unlocked) {
      section.appendChild(el(doc, "p",
        t("borrow.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as your account."), "muted"));
    }
    section.appendChild(linkPara(doc, [
      ["#/account/" + encodeURIComponent(found.name), t("account.open_prefix", "Open ") + found.name],
      ["#/transfer", t("transfer.title", "Transfer")]
    ]));
  }

  /* Balances table + phone cards. Cells show Account.balances display
   * strings only (human terms, principle #6); raw integers hide in title.
   * Same shape as account-ui.js:150-213 (table/cards swap under 560px).
   * LOW punchlist: reference DashboardPage shows market tabs, not a balances
   * table — this pulse keeps top-5 plus an honest scope line + account link. */
  function fillBalances(doc, section, found, myGen) {
    Account.balances(found.id).then(function (list) {
      if (myGen !== gen) return;
      clearRoot(section);
      section.appendChild(el(doc, "h2", t("account.s7", "Balances")));
      section.appendChild(el(doc, "p", t("dashboard.top_holdings_for_the_watched_account_", "Top holdings for the watched account — the reference dashboard shows market tabs instead; full balances live on the account page."), "muted"));
      if (!list || list.length === 0) {
        section.appendChild(el(doc, "p", t("account.s1", "No balances."), "muted"));
        return;
      }
      var table = doc.createElement("table");
      table.className = "node-table";
      var thead = doc.createElement("thead");
      var headRow = doc.createElement("tr");
      [t("account.asset_th", "Asset"), t("account.balance_th", "Balance")].forEach(function (label) {
        var th = doc.createElement("th");
        th.textContent = label;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = doc.createElement("tbody");
      /* Dashboard is a pulse, not the ledger: top 5 + link to the full
       * account page (keeps locked scroll short; #1 shows tabs, not walls). */
      list.slice(0, 5).forEach(function (b) {
        var tr = doc.createElement("tr");
        var assetCell = doc.createElement("td");
        assetCell.textContent = b.symbol;
        tr.appendChild(assetCell);
        var balCell = doc.createElement("td");
        balCell.textContent = b.display;
        balCell.title = b.raw;
        tr.appendChild(balCell);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      section.appendChild(table);
      var cards = doc.createElement("div");
      cards.className = "node-cards";
      list.slice(0, 5).forEach(function (b) {
        var card = doc.createElement("div");
        card.className = "node-card";
        var name = doc.createElement("div");
        name.textContent = b.symbol;
        card.appendChild(name);
        var bal = doc.createElement("div");
        bal.textContent = b.display;
        bal.title = b.raw;
        card.appendChild(bal);
        cards.appendChild(card);
      });
      section.appendChild(cards);
      section.appendChild(linkPara(doc, [
        ["#/account/" + encodeURIComponent(found.name),
          t("account.open_prefix", "Open ") + found.name +
          (list.length > 5 ? " (" + list.length + ")" : t("dashboard.full_balances_suffix", " — full balances"))]
      ]));
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearRoot(section);
      section.appendChild(el(doc, "h2", t("account.s7", "Balances")));
      showError(doc, section, e, t("account.load_balances_failed", "Could not load balances."));
    });
  }

  /* Recent activity: first 10 history rows (time + op label). Full detail
   * stays on the account page — the dashboard links there. */
  function fillHistory(doc, section, found, myGen) {
    Account.history(found.id, 10).then(function (rows) {
      if (myGen !== gen) return;
      clearRoot(section);
      section.appendChild(el(doc, "h2", t("account.history_title", "History")));
      if (!rows || rows.length === 0) {
        section.appendChild(el(doc, "p", t("account.s3", "No recent activity."), "muted"));
        return;
      }
      var ul = doc.createElement("ul");
      rows.slice(0, 10).forEach(function (row) {
        var li = doc.createElement("li");
        li.textContent = timeText(row) + " — " + opLabel(opTypeOf(row));
        ul.appendChild(li);
      });
      section.appendChild(ul);
      section.appendChild(linkPara(doc, [
        ["#/account/" + encodeURIComponent(found.name), t("account.open_prefix", "Open ") + found.name]
      ]));
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearRoot(section);
      section.appendChild(el(doc, "h2", t("account.history_title", "History")));
      showError(doc, section, e, t("account.err_history", "History unavailable on this node."));
    });
  }

  /* Markets directory (mirrors #1 DashboardPage tabs: StarredMarkets +
   * FeaturedMarkets per preferred base). Tabs: Starred + BTS/USD/CNY/BTC.
   * Ticker stats load fail-open per row ("—" on miss); panes never blank. */
  function paintMarkets(doc, wrap) {
    var section = doc.createElement("section");
    section.appendChild(el(doc, "h2", t("market.picker_title", "Markets")));
    var tabs = doc.createElement("div");
    tabs.className = "mkt-tabs";
    tabs.setAttribute("role", "tablist");
    var pane = doc.createElement("div");
    var names = ["Starred", "BTS", "USD", "CNY", "BTC"];
    names.forEach(function (name, i) {
      var b = doc.createElement("button");
      b.type = "button";
      b.textContent = name === "Starred" ? t("market.starred_tab", "Starred") : name;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      touchable(b);
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(tabs.querySelectorAll("button"), function (x) {
          x.setAttribute("aria-selected", x === b ? "true" : "false");
        });
        paintMarketPane(doc, pane, name);
      });
      tabs.appendChild(b);
    });
    section.appendChild(tabs);
    section.appendChild(pane);
    wrap.appendChild(section);
    paintMarketPane(doc, pane, "Starred");
  }

  /* One markets pane: Starred reads the fav key; quote panes read FEATURED.
   * Rows: market link + latest + 24h change (fail-open "—"). */
  function paintMarketPane(doc, pane, name) {
    while (pane.firstChild) pane.removeChild(pane.firstChild);
    var ids = name === "Starred" ? favMarkets() : (FEATURED[name] || []).slice();
    if (!ids.length) {
      pane.appendChild(el(doc, "p",
        name === "Starred"
          ? t("favourites.no_favourite_markets_yet_star_one_from_any_ma", "No favourite markets yet. Star one from any market page picker, or add a pair below.")
          : t("account.s3", "No recent activity."), "muted"));
      pane.appendChild(linkPara(doc, [
        ["#/market/" + encodeURIComponent(defaultMarket()), defaultMarket()],
        ["#/favourites", t("favourites.favourites", "Favourites")]
      ]));
      return;
    }
    var table = doc.createElement("table");
    table.className = "node-table";
    var headRow = doc.createElement("tr");
    [t("pool.market_col", "Market"), t("market.latest_label", "Latest"), t("market.chg_label", "24h Δ")].forEach(function (label) {
      var th = doc.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    var thead = doc.createElement("thead");
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    ids.slice().sort().forEach(function (id) {
      var tr = doc.createElement("tr");
      var tdM = doc.createElement("td");
      var a = doc.createElement("a");
      a.href = "#/market/" + encodeURIComponent(id);
      a.textContent = id;
      touchable(a);
      tdM.appendChild(a);
      tr.appendChild(tdM);
      var tdL = el(doc, "td", "…", "num");
      var tdC = el(doc, "td", "…", "num");
      tr.appendChild(tdL);
      tr.appendChild(tdC);
      tbody.appendChild(tr);
      if (typeof Market !== "undefined" && Market) {
        tickRow(id).then(function (r) {
          tdL.textContent = (r && r.latest !== null && r.latest !== undefined) ? r.latest : "—";
          tdC.textContent = (r && r.chg !== null && r.chg !== undefined) ? r.chg : "—";
        });
      } else {
        tdL.textContent = "—";
        tdC.textContent = "—";
      }
    });
    table.appendChild(tbody);
    pane.appendChild(table);
  }

  /* Quick links into every area (labels reuse the news view's section
   * strings, byte-identical to en.json). */
  function paintQuickLinks(doc, wrap) {
    var section = doc.createElement("section");
    section.appendChild(el(doc, "h2", t("news.start_here", "Start here")));
    section.appendChild(linkPara(doc, [
      ["#/account/me", t("news.account_overview_balances_and_history", "Account overview — balances and history")],
      ["#/market/" + encodeURIComponent(defaultMarket()), t("news.exchange_trade_on_the_dex", "Exchange — trade on the DEX")],
      ["#/transfer", t("news.transfer_send_assets", "Transfer — send assets")]
    ]));
    section.appendChild(linkPara(doc, [
      ["#/explorer", t("news.explorer_blocks_and_transactions", "Explorer — blocks and transactions")],
      ["#/voting", t("news.voting_witnesses_committee_workers", "Voting — witnesses, committee, workers")],
      ["#/settings", t("news.settings_nodes_and_themes", "Settings — nodes and themes")],
      ["#/help", t("news.help_how_each_part_works", "Help — how each part works")]
    ]));
    wrap.appendChild(section);
  }

  return { renderDashboard: renderDashboard };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.DashboardUI === "undefined") { globalThis.DashboardUI = DashboardUI; }
if (typeof module !== "undefined") { module.exports = DashboardUI; }
