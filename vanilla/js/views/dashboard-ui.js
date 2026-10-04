/* DashboardUI: the #/ account-overview dashboard (NOT a desk clone).
 * Owns: DOM for the "/" route only — watched-account balances, recent
 *   activity, favourite markets, and quick links — PLUS the first-run
 *   landing (splash) shown while the wallet is locked. Locked visitors get
 *   the landing (hero + live markets + chain pulse + product cards + trust
 *   + steps + CTA); unlocked visitors get the watched-account dashboard
 *   exactly as before. Landing is a superset of the old locked gate card,
 *   so no locked CTA is lost (Create/Login both present).
  * When the wallet is
  *   unlocked the watched account is the wallet's own (Account.myAccountId);
  *   otherwise it is the locked ViewingAs pick (default committee-account
  *   1.2.0 watch), same default App.jsx:489-495 falls back to when no
  *   account is selected.
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
   * tooling/check_i18n.py stays green. Absent i18n.js: defaults, never blank.
   * vars fills %(name)s placeholders (viewing-as.js shape) so file:// still
   * shows names when the dict fetch fails. */
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

  /* No local el/clearRoot — use DOM.el, DOM.clear */

  /* Unlocked right now (read-only Wallet probe, never throws). */
  function isUnlockedNow() {
    try {
      return !!(typeof Wallet !== "undefined" && Wallet &&
        typeof Wallet.isUnlocked === "function" && Wallet.isUnlocked());
    } catch (e) { return false; }
  }

  /* Landing rule, pure and unit-tested: anything not-unlocked sees the
   * splash. Params: unlocked boolean-ish. Returns boolean. */
  function landingFor(unlocked) { return !unlocked; }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w;
  }

  /* Inline error panel, never blank: any thrown value maps to a sentence.
   * History fallback keeps its byte-identical message key and gains a linked
   * "Open Settings" action (HistoryNotice.actionLink, pure DOM). */
  function showError(doc, wrap, e, fallback) {
    var raw = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || "");
    var isHist = raw.indexOf("history-unavailable") !== -1;
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    else if (msg.indexOf("history-unavailable") !== -1) msg = t("account.err_history", "History unavailable on this node.");
    else if (msg.indexOf("bad-asset-shape") !== -1) msg = t("account.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    else if (msg.indexOf("unknown-account") !== -1) msg = t("common.unknown_account", "Unknown account.");
    var err = DOM.error(wrap, msg);
    if (isHist) {
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          var link = HistoryNotice.actionLink(doc, t, "settings");
          if (link) wrap.appendChild(link);
        }
      } catch (e2) { /* error panel stands without the link */ }
    }
    return err;
  }

  /* Internal link paragraph (href + text pairs, tap-sized links). */
  function linkPara(doc, pairs) {
    var p = DOM.el(doc, "p", null, "muted");
    pairs.forEach(function (pr, i) {
      if (i > 0) p.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a"); a.href = pr[0]; a.textContent = pr[1]; a.className = "subtle-btn"; touchable(a); p.appendChild(a);
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
  /* Session ticker cache (id -> {latest, chg}). Fail-open: misses render
   * "—" and retry on next visit, never an error panel. Misses are NEVER
   * cached: an offline paint must not poison later renders (a cached null
   * would make the refill re-render serve "—" forever). */
  var _tickCache = {};
  /* In-flight ticker memo (perf: Starred+Featured tabs fetch the same pairs
   * in one tick — one fetch per id per tick, never two. Pending only:
   * cleared on settle; resolved rows still cache in _tickCache. Identical. */
  var _tickPending = {};
  function tickRow(id) {
    if (Object.prototype.hasOwnProperty.call(_tickCache, id)) return Promise.resolve(_tickCache[id]);
    if (Object.prototype.hasOwnProperty.call(_tickPending, id)) return _tickPending[id];
    var pair = null;
    try {
      if (typeof Market === "undefined" || !Market || typeof Market.parseId !== "function") return Promise.resolve(null);
      pair = Market.parseId(id);
    } catch (e) { return Promise.resolve(null); }
    var p = Market.assets(pair.quote, pair.base).then(function (a) {
      return Market.stats(a.base.id, a.quote.id);
    }).then(function (s) {
      var row = {
        latest: s.latest,
        chg: (s.raw && s.raw.percent_change !== undefined && s.raw.percent_change !== null)
          ? String(s.raw.percent_change) : null
      };
      _tickCache[id] = row;
      return row;
    }).catch(function () { return null; });
    _tickPending[id] = p;
    p.then(function () { delete _tickPending[id]; },
      function () { delete _tickPending[id]; });
    return p;
  }

  /* Coalesced tick paint (perf, output-identical): per-row tickRow
   * resolutions queue their cell writes and flush in one microtask — one
   * paint per tick instead of one per row. Extends the pending-memo above:
   * fetches stay deduped, only the DOM writes batch. Flush runs before the
   * next task (microtask), so generation guards inside the queued fns observe
   * the same generation the direct write would have — ordering and final
   * cells are identical, only paint count differs. Never throws. */
  var _paintQueue = [], _paintScheduled = false;
  function queueTickPaint(fn) {
    _paintQueue.push(fn);
    if (_paintScheduled) return;
    _paintScheduled = true;
    var flush = function () {
      _paintScheduled = false;
      var q = _paintQueue;
      _paintQueue = [];
      for (var i = 0; i < q.length; i++) {
        try { q[i](); } catch (e) { /* one bad cell never blocks the rest */ }
      }
    };
    try {
      if (typeof queueMicrotask === "function") queueMicrotask(flush);
      else if (typeof Promise !== "undefined" && Promise.resolve) Promise.resolve().then(flush);
      else setTimeout(flush, 0);
    } catch (e) {
      try { setTimeout(flush, 0); } catch (e2) { /* cells keep "…" */ }
    }
  }

  /* clearTickMisses: drop legacy cached-null misses (pre-fix sessions cached
   * offline failures as null). Params: none. Returns the dropped count.
   * Non-null rows are untouched. Never throws. */
  function clearTickMisses() {
    var n = 0;
    for (var k in _tickCache) {
      if (Object.prototype.hasOwnProperty.call(_tickCache, k) && _tickCache[k] === null) {
        delete _tickCache[k];
        n++;
      }
    }
    return n;
  }

  /* wireTickMissClear: one-time connection-open hook that drops cached-null
   * misses so the next paint refetches live tickers. Params: none. Returns
   * nothing. Never throws; no-op when Store is absent (Node smoke). */
  var _tickMissClearWired = false;
  function wireTickMissClear() {
    if (_tickMissClearWired) return;
    try {
      if (typeof Store === "undefined" || !Store || typeof Store.subscribe !== "function") return;
    } catch (e) { return; }
    _tickMissClearWired = true;
    try {
      Store.subscribe("connection", function (st) {
        if (st && st.state === "open") {
          try { clearTickMisses(); } catch (e) { /* refill still attempts */ }
        }
      });
    } catch (e) { _tickMissClearWired = false; }
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
    DOM.clear(root);
    /* Landing rule (Option B, 2026-10-01): locked visitors get the splash,
     * unlocked visitors get the watched-account dashboard unchanged. The
     * landing paints immediately (static hero/cards/steps + fail-open live
     * fills) so a down node never blanks first paint; when the shared socket
     * is still connecting, a connection-open subscription refills the live
     * cells (accounts-ui.js connect-wait pattern) instead of leaving "—"
     * forever. The dashboard keeps its connect-wait below. */
    if (landingFor(isUnlockedNow())) {
      paintLanding(doc, root, myGen);
      try { wireTickMissClear(); } catch (e) { /* refill subscription below still attempts */ }
      try {
        if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
            Chain.status().state !== "open" &&
            typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
          var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
          var off = Store.subscribe("connection", function (st) {
            if (settled || myGen !== gen) return;
            if (st && st.state === "open") {
              settled = true;
              try { off(); } catch (e) { /* unsubscribed */ }
              try { clearTimeout(timer); } catch (e) { /* timer gone */ }
              try { clearTickMisses(); } catch (e) { /* refill still attempts */ }
              if (typeof location === "undefined" || location.hash === hashAtEntry) renderDashboard(root);
            }
          });
          var timer = setTimeout(function () {
            if (settled || myGen !== gen) return;
            settled = true;
            try { off(); } catch (e) { /* unsubscribed */ }
            /* Fail-open: the static shell + "—" cells stand; no error panel. */
          }, CONNECT_TIMEOUT_MS);
          /* Automated handshake so the live cells fill without a click. */
          try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* refill subscription above still attempts */ }
        } else {
          try { clearTickMisses(); } catch (e) { /* opportunistic only */ }
        }
      } catch (e) { /* static paint above stands */ }
      return;
    }
    var wrap = makeWrap(doc, root);
    if (typeof Account === "undefined" || !Account) {
      showError(doc, wrap, t("account.backend_missing_account", "Account backend missing: js/account.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(DOM.pageHead(doc, t("shell.dashboard", "Dashboard"), "dashboard"));
      wrap.appendChild(DOM.el(doc, "p", t("common.status_connecting", "Connecting to network…"), "muted"));
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
        DOM.clear(root);
        var failWrap = makeWrap(doc, root);
        failWrap.appendChild(DOM.pageHead(doc, t("shell.dashboard", "Dashboard"), "dashboard"));
        showError(doc, failWrap, new Error("not connected"), t("common.network_unavailable_short", "Network unavailable."));
        var dstat = DOM.el(doc, "p", "", "muted");
        try { dstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        failWrap.appendChild(dstat);
        var drow = DOM.el(doc, "div", null, "pools-offline-row");
        failWrap.appendChild(drow);
        var dtry = touchable(DOM.el(doc, "button", t("fees.retry", "Retry"))); dtry.className = "btn-ghost";
        dtry.type = "button";
        drow.appendChild(dtry);
        var doff = null;
        try { doff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { doff = null; }
        if (doff && typeof doff.wire === "function") {
          try { doff.wire(dtry, dstat, function () { renderDashboard(root); }, t); } catch (e) { dtry.addEventListener("click", function () { renderDashboard(root); }); }
        } else {
          dtry.addEventListener("click", function () { renderDashboard(root); });
        }
        var dlink = null;
        if (doff && typeof doff.settingsLink === "function") {
          try { dlink = doff.settingsLink(doc, t); } catch (e) { dlink = null; }
        }
        if (!dlink) {
          dlink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
          try { dlink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          dlink.className = "subtle-btn";
        }
        drow.appendChild(dlink);
      }, CONNECT_TIMEOUT_MS);
      /* Automated handshake on entry (shared Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
      return;
    }
    paintDashboard(doc, root, myGen);
  }

  /* Static shell (title, sections, quick links) + async fills for the
   * watched account. Sections never stay blank: every fill has a loading
   * line replaced by data, an empty state, or an error panel. */
  function paintDashboard(doc, root, myGen) {
    if (myGen !== gen) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.pageHead(doc, t("shell.dashboard", "Dashboard"), "dashboard"));

    var unlocked = false;
    try { unlocked = typeof Wallet !== "undefined" && Wallet && typeof Wallet.isUnlocked === "function" && Wallet.isUnlocked(); }
    catch (e) { unlocked = false; }
    if (!unlocked) {
      wrap.appendChild(gateCard(doc));
      wrap.appendChild(DOM.el(doc, "p", t("account.unlock_to_see", "Unlock your wallet to see which on-chain account it controls."), "muted"));
      wrap.appendChild(linkPara(doc, [
        ["#/login", t("auth.login", "Login")],
        ["#/accounts", t("account.manager_title", "Accounts")]
      ]));
    }

    /* Auditor MED: compact markets strip above the fold (Starred +
     * Featured tabs, chips) directly under the welcome/unlock block and
     * above the acting-as account + Balances; the full directory stays
     * below (after history). Placed before acctSection so the locked
     * gate + strip still fit in a 900px viewport. Reuses
     * favMarkets/FEATURED/tickRow — no new chain patterns. */
    paintMarketStrip(doc, wrap, myGen);
    var acctSection = doc.createElement("section");
    wrap.appendChild(acctSection);
    var balSection = doc.createElement("section");
    wrap.appendChild(balSection);
    var histSection = doc.createElement("section");
    wrap.appendChild(histSection);
    paintMarkets(doc, wrap);
    paintQuickLinks(doc, wrap);

    acctSection.appendChild(DOM.el(doc, "p", t("transfer.loading", "Loading…"), "muted"));
    balSection.appendChild(DOM.el(doc, "h2", t("account.s7", "Balances")));
    balSection.appendChild(DOM.el(doc, "p", t("account.loading_balances", "Loading balances…"), "muted"));
    histSection.appendChild(DOM.el(doc, "h2", t("account.history_title", "History")));
    histSection.appendChild(DOM.el(doc, "p", t("account.loading_history", "Loading history…"), "muted"));

    resolveWatched(unlocked).then(function (found) {
      if (myGen !== gen) return;
      fillAccount(doc, acctSection, found, unlocked);
      fillBalances(doc, balSection, found, myGen);
      fillHistory(doc, histSection, found, myGen);
    }).catch(function (e) {
      if (myGen !== gen) return;
      DOM.clear(acctSection);
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
    card.appendChild(DOM.el(doc, "h2", t("dashboard.welcome", "Welcome to BitShares")));
    card.appendChild(DOM.el(doc, "p", t("dashboard.tagline", "Your Decentralized Platform"), "muted"));
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
            loc.error.textContent = t("dashboard.locale_unavailable", "Locale unavailable offline — showing English.");
            return;
          }
          I18n.setLocale(code).then(function (r) {
            if (!r || !r.ok) {
              loc.error.textContent = t("dashboard.locale_unavailable", "Locale unavailable offline — showing English.");
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
    restore.textContent = t("common.import_existing", "Import existing account");
    restore.className = "subtle-btn";
    card.appendChild(sub);
    return card;
  }

  /* Watched account: the wallet's own when unlocked, else the locked
   * ViewingAs pick (default committee-account watch, App.jsx:489-495
   * default). ViewingAs missing -> WATCH_NAME fallback (1.2.0). Returns
   * Promise of {id, name, watched}. Fails: wallet-locked/no-account/
   * unknown-account from Account. */
  function resolveWatched(unlocked) {
    if (unlocked) {
      return Account.myAccountId().then(function (id) {
        return Account.resolve(id).then(function (a) { return { id: id, name: a.name, watched: false }; });
      });
    }
    var watchName = WATCH_NAME;
    try {
      if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") {
        var v = ViewingAs.get();
        if (v && typeof v.name === "string" && v.name) watchName = v.name;
      }
    } catch (e) { /* WATCH_NAME fallback stands */ }
    return Account.resolve(watchName).then(function (a) { return { id: a.id, name: a.name, watched: true }; });
  }

  /* Account heading: name linked to its page + watch-mode disclaimer. */
  function fillAccount(doc, section, found, unlocked) {
    DOM.clear(section);
    var h2 = doc.createElement("h2");
    var a = doc.createElement("a");
    a.href = "#/account/" + encodeURIComponent(found.name);
    a.textContent = found.name;
    touchable(a);
    h2.appendChild(a);
    section.appendChild(h2);
    section.appendChild(DOM.el(doc, "p", found.id, "muted"));
    if (found.watched || !unlocked) {
      section.appendChild(DOM.el(doc, "p",
        t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: found.name, id: found.id }), "muted"));
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
      DOM.clear(section);
      section.appendChild(DOM.el(doc, "h2", t("account.s7", "Balances")));
      section.appendChild(DOM.el(doc, "p", t("dashboard.top_holdings_for_the_watched_account_", "Top holdings for the watched account — the reference dashboard shows market tabs instead; full balances live on the account page."), "muted"));
      if (!list || list.length === 0) {
        section.appendChild(DOM.el(doc, "p", t("account.s1", "No balances.") + t("account.s1_hint", " Fund it with a transfer, or place a market order — holdings list here."), "muted"));
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
      DOM.clear(section);
      section.appendChild(DOM.el(doc, "h2", t("account.s7", "Balances")));
      showError(doc, section, e, t("account.load_balances_failed", "Could not load balances."));
    });
  }

  /* Recent activity: first 10 history rows (time + op label). Full detail
   * stays on the account page — the dashboard links there. */
  function fillHistory(doc, section, found, myGen) {
    Account.history(found.id, 10).then(function (rows) {
      if (myGen !== gen) return;
      DOM.clear(section);
      section.appendChild(DOM.el(doc, "h2", t("account.history_title", "History")));
      if (!rows || rows.length === 0) {
        section.appendChild(DOM.el(doc, "p", t("account.s3", "No recent activity.") + t("account.activity_hint", " Transfers, orders, and fills list here once they happen."), "muted"));
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
      DOM.clear(section);
      section.appendChild(DOM.el(doc, "h2", t("account.history_title", "History")));
      showError(doc, section, e, t("account.err_history", "History unavailable on this node."));
    });
  }

  /* Compact markets strip (above the fold): Starred + Featured tabs with
   * capped chip rows (price/change via the shared tickRow cache — one
   * fetch per id per tick, same cap discipline as the full directory).
   * Defaults to BTS (curated FEATURED pairs) so the above-fold view shows
   * price/change immediately; Starred is empty on fresh profiles. Locked +
   * unlocked both fine (public Market.stats reads only). Phone: chips
   * scroll horizontally in-region (no page overflow @390); desktop keeps
   * the same single-row scroll so the strip stays compact. No new i18n
   * keys (reuses market/favourites strings), no new chain patterns. */
  var STRIP_MAX = 6;
  var STRIP_DEFAULT = "BTS";
  function paintMarketStrip(doc, wrap, myGen) {
    var section = doc.createElement("section");
    section.className = "mkt-strip";
    section.appendChild(DOM.el(doc, "h2", t("market.picker_title", "Markets")));
    var tabs = doc.createElement("div");
    tabs.className = "mkt-tabs";
    tabs.setAttribute("role", "tablist");
    var pane = doc.createElement("div");
    pane.className = "mkt-strip-pane";
    var names = ["Starred", "BTS", "USD", "CNY", "BTC"];
    names.forEach(function (name) {
      var b = doc.createElement("button");
      b.type = "button";
      b.textContent = name === "Starred" ? t("market.starred_tab", "Starred") : name;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", name === STRIP_DEFAULT ? "true" : "false");
      b.className = "subtle-btn";
      touchable(b);
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(tabs.querySelectorAll("button"), function (x) {
          x.setAttribute("aria-selected", x === b ? "true" : "false");
        });
        paintStripPane(doc, pane, name, myGen);
      });
      tabs.appendChild(b);
    });
    section.appendChild(tabs);
    section.appendChild(pane);
    wrap.appendChild(section);
    paintStripPane(doc, pane, STRIP_DEFAULT, myGen);
  }

  /* One strip pane: Starred reads the fav key; quote panes read FEATURED.
   * Capped at STRIP_MAX chips, sorted for stability. Each chip links to
   * its market; price/change fill fail-open ("—" on miss). Never blank:
   * empty Starred shows the shared favourites empty state + links. */
  function paintStripPane(doc, pane, name, myGen) {
    DOM.clear(pane);
    var ids = name === "Starred" ? favMarkets() : (FEATURED[name] || []).slice();
    ids = ids.slice().sort().slice(0, STRIP_MAX);
    if (!ids.length) {
      pane.appendChild(DOM.el(doc, "p",
        name === "Starred"
          ? t("favourites.no_favourite_markets_yet_star_one_from_any_ma", "No favourite markets yet. Star one from any market page picker, or add a pair below.")
          : (t("account.s3", "No recent activity.") + t("dashboard.strip_hint", " No markets are configured for this strip — open any market from the picker.")), "muted"));
      pane.appendChild(linkPara(doc, [
        ["#/market/" + encodeURIComponent(defaultMarket()), defaultMarket()],
        ["#/favourites", t("favourites.favourites", "Favourites")]
      ]));
      return;
    }
    var list = doc.createElement("div");
    list.className = "mkt-strip-list";
    ids.forEach(function (id) {
      var a = doc.createElement("a");
      a.className = "mkt-strip-chip subtle-btn";
      a.href = "#/market/" + encodeURIComponent(id);
      touchable(a);
      var pair = DOM.el(doc, "span", id, "mkt-strip-pair");
      var px = DOM.el(doc, "span", "…", "mkt-strip-px num");
      var chg = DOM.el(doc, "span", "…", "mkt-strip-chg num");
      a.appendChild(pair);
      a.appendChild(px);
      a.appendChild(chg);
      list.appendChild(a);
      if (typeof Market !== "undefined" && Market) {
        tickRow(id).then(function (r) {
          queueTickPaint(function () {
            if (myGen !== gen) return;
            px.textContent = (r && r.latest !== null && r.latest !== undefined) ? r.latest : "—";
            chg.textContent = (r && r.chg !== null && r.chg !== undefined) ? r.chg : "—";
          });
        });
      } else {
        px.textContent = "—";
        chg.textContent = "—";
      }
    });
    pane.appendChild(list);
  }

  /* Markets directory (mirrors #1 DashboardPage tabs: StarredMarkets +
   * FeaturedMarkets per preferred base). Tabs: Starred + BTS/USD/CNY/BTC.
   * Ticker stats load fail-open per row ("—" on miss); panes never blank. */
  function paintMarkets(doc, wrap) {
    var section = doc.createElement("section");
    section.appendChild(DOM.el(doc, "h2", t("market.picker_title", "Markets")));
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
      b.className = "subtle-btn";
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
    DOM.clear(pane);
    var ids = name === "Starred" ? favMarkets() : (FEATURED[name] || []).slice();
    if (!ids.length) {
      pane.appendChild(DOM.el(doc, "p",
        name === "Starred"
          ? t("favourites.no_favourite_markets_yet_star_one_from_any_ma", "No favourite markets yet. Star one from any market page picker, or add a pair below.")
          : (t("account.s3", "No recent activity.") + t("dashboard.strip_hint", " No markets are configured for this strip — open any market from the picker.")), "muted"));
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
      a.className = "subtle-btn";
      touchable(a);
      tdM.appendChild(a);
      tr.appendChild(tdM);
      var tdL = DOM.el(doc, "td", "…", "num");
      var tdC = DOM.el(doc, "td", "…", "num");
      tr.appendChild(tdL);
      tr.appendChild(tdC);
      tbody.appendChild(tr);
      if (typeof Market !== "undefined" && Market) {
        tickRow(id).then(function (r) {
          queueTickPaint(function () {
            tdL.textContent = (r && r.latest !== null && r.latest !== undefined) ? r.latest : "—";
            tdC.textContent = (r && r.chg !== null && r.chg !== undefined) ? r.chg : "—";
          });
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
    section.appendChild(DOM.el(doc, "h2", t("news.start_here", "Start here")));
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

  /* First-run landing (Option B splash, 2026-10-01): hero with the project
   * motto + live markets + chain pulse + product cards + trust trio +
   * 3 steps + final CTA. Static sections paint immediately (never blank);
   * live fills (strip, pulse) fail open per cell. textContent-only except
   * the hero <img> (owner art, empty alt — the h1 carries the meaning). */
  function paintLanding(doc, root, myGen) {
    if (myGen !== gen) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(landingHero(doc));
    paintMarketStrip(doc, wrap, myGen);
    paintPulse(doc, wrap, myGen);
    wrap.appendChild(landingCards(doc));
    wrap.appendChild(landingTrust(doc));
    wrap.appendChild(landingSteps(doc));
    wrap.appendChild(landingFinal(doc));
  }

  /* Hero: framed owner art + motto h1 + honest subcopy + CTAs. The motto is
   * the promise; the subcopy translates it (keys stay yours, nothing to
   * install, nothing that rots). Both locked CTAs from the old gate card
   * survive here (Create + Login). */
  function landingHero(doc) {
    var s = doc.createElement("section");
    s.className = "splash-hero";
    try {
      var img = doc.createElement("img");
      img.src = "assets/hero.webp";
      img.alt = "";
      img.className = "splash-hero-img";
      s.appendChild(img);
    } catch (e) { /* hero works without art */ }
    s.appendChild(DOM.pageHead(doc, t("splash.hero_title", "bitshares-vanilla-ui is dependency-free and static-servable."), "dashboard"));
    s.appendChild(DOM.el(doc, "p",
      t("splash.hero_sub", "Your keys. Your coins."), "muted"));
    s.appendChild(DOM.el(doc, "p",
      t("splash.hero_sub2", "Nothing but fresh vanilla html/js/css in between."), "muted"));
    var row = doc.createElement("p");
    row.className = "splash-cta-row";
    var create = doc.createElement("a");
    create.href = "#/create-account";
    create.className = "btn";
    create.textContent = t("dashboard.create", "Create Account");
    touchable(create);
    row.appendChild(create);
    var desk = doc.createElement("a");
    desk.href = "#/market/" + encodeURIComponent(defaultMarket());
    desk.className = "btn btn-ghost";
    desk.textContent = t("splash.cta_exchange", "Open exchange");
    touchable(desk);
    row.appendChild(desk);
    s.appendChild(row);
    s.appendChild(linkPara(doc, [
      ["#/login", t("auth.login", "Login")],
      ["#/accounts", t("account.manager_title", "Accounts")]
    ]));
    return s;
  }

  /* Chain pulse band (Crypo number-band slot, real numbers only): head
   * block + time, account/asset/witness/committee counts, top-market 24h
   * volume row. One db id, one Promise.all wave; every cell fails open to
   * "—" (dead method or offline node never blanks the band). Counts render
   * verbatim (thousands-grouping stays deferred per Tier-2). Aggregate DEX
   * volume has no chain call (#4 has only per-market volume), so the row
   * is labeled single-market honestly. */
  function paintPulse(doc, wrap, myGen) {
    var s = doc.createElement("section");
    s.className = "pulse-band";
    s.appendChild(DOM.el(doc, "h2", t("splash.pulse_title", "Chain pulse")));
    var grid = doc.createElement("div");
    grid.className = "pulse-grid";
    s.appendChild(grid);
    var cells = {};
    ["head", "time", "accounts", "assets", "witnesses", "committee"].forEach(function (k) {
      var cell = doc.createElement("div");
      cell.className = "pulse-cell";
      cell.appendChild(DOM.el(doc, "div", t("splash.pulse_" + k, k), "muted"));
      var v = DOM.el(doc, "div", "…", "num");
      cell.appendChild(v);
      grid.appendChild(cell);
      cells[k] = v;
    });
    var vol = doc.createElement("p");
    vol.className = "muted";
    vol.textContent = t("splash.topvol_loading", "Top market 24h vol: …");
    s.appendChild(vol);
    wrap.appendChild(s);
    fetchPulse(myGen).then(function (r) {
      if (myGen !== gen) return;
      cells.head.textContent = fmtCount(r.head);
      cells.time.textContent = (r.time === null || r.time === undefined) ? "—" : String(r.time);
      cells.accounts.textContent = fmtCount(r.accounts);
      cells.assets.textContent = fmtCount(r.assets);
      cells.witnesses.textContent = fmtCount(r.witnesses);
      cells.committee.textContent = fmtCount(r.committee);
      vol.textContent = topVolText(r.topVol);
    });
  }

  /* One-wave pulse fetch. Returns {head,time,accounts,assets,witnesses,
   * committee,topVol} with nulls on any miss (never throws — offline is a
   * result, not an error). topVol is the get_top_markets(1) row or null. */
  function fetchPulse(myGen) {
    var blank = { head: null, time: null, accounts: null, assets: null, witnesses: null, committee: null, topVol: null };
    if (typeof Chain === "undefined" || !Chain || typeof Chain.db !== "function") {
      return Promise.resolve(blank);
    }
    return Chain.db().then(function (dbId) {
      function one(method, params) {
        return Chain.call(dbId, method, params || []).then(null, function () { return null; });
      }
      function voteCount(fn) {
        try {
          if (typeof Vote !== "undefined" && Vote && typeof Vote[fn] === "function") {
            return Vote[fn]().then(null, function () { return null; });
          }
        } catch (e) { /* null below */ }
        return Promise.resolve(null);
      }
      return Promise.all([
        one("get_dynamic_global_properties", []),
        one("get_account_count", []),
        one("get_asset_count", []),
        voteCount("getWitnessCount"),
        voteCount("getCommitteeCount"),
        one("get_top_markets", [1])
      ]);
    }).then(function (r) {
      if (myGen !== gen) return blank;
      return shapePulse(r);
    }).then(null, function () { return blank; });
  }

  /* Chain count -> safe value: non-negative safe ints pass through (uint64
   * counts arrive small); anything else is null (fail-open). */
  function asCount(v) {
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
    return null;
  }

  /* shapePulse: pure shaping of the fetchPulse Promise.all wave. Params: r
   * (array [globalProps, accountCount, assetCount, witnessCount,
   * committeeCount, topMarkets] or anything on malformed input). Returns
   * {head,time,accounts,assets,witnesses,committee,topVol} with nulls on any
   * miss. Never throws. Unit-tested via _test.shapePulse (refill shaping). */
  function shapePulse(r) {
    var out = { head: null, time: null, accounts: null, assets: null, witnesses: null, committee: null, topVol: null };
    if (!Array.isArray(r)) return out;
    var g = r[0];
    if (g && typeof g === "object") {
      out.head = (Number.isSafeInteger(g.head_block_number) && g.head_block_number > 0) ? g.head_block_number : null;
      out.time = (typeof g.time === "string" && g.time) ? g.time : null;
    }
    out.accounts = asCount(r[1]);
    out.assets = asCount(r[2]);
    out.witnesses = asCount(r[3]);
    out.committee = asCount(r[4]);
    var rows = r[5];
    out.topVol = (Array.isArray(rows) && rows[0] && typeof rows[0] === "object") ? rows[0] : null;
    return out;
  }

  /* Verbatim count text (grouping stays deferred): null -> em dash. */
  function fmtCount(v) {
    if (v === null || v === undefined) return "—";
    return String(v);
  }

  /* Top-market volume line. Params: row (market_ticker) or null. Volumes
   * are chain-human strings — displayed verbatim, never summed. */
  function topVolText(row) {
    if (!row || typeof row.base !== "string" || typeof row.quote !== "string") {
      return t("splash.topvol_unavailable", "Top market 24h vol: unavailable on this node.");
    }
    var vol = (row.quote_volume !== undefined && row.quote_volume !== null) ? String(row.quote_volume) : "—";
    return t("splash.topvol_prefix", "Top market 24h vol (single market):") +
      " " + row.base + "/" + row.quote + " " + vol;
  }

  /* Product doorways (Kraken-card slot, CSS-only): one line each + deep
   * link. No art files — the hero carries the page's single image. */
  function landingCards(doc) {
    var s = doc.createElement("section");
    s.className = "prod-cards";
    s.appendChild(DOM.el(doc, "h2", t("splash.cards_title", "What you can do here")));
    var grid = doc.createElement("div");
    grid.className = "prod-grid";
    [
      ["#/market/" + encodeURIComponent(defaultMarket()),
        t("splash.card_dex_t", "Exchange"), t("splash.card_dex_d", "Trade on the order-book DEX.")],
      ["#/pools",
        t("splash.card_pool_t", "Pools"), t("splash.card_pool_d", "Provide liquidity and swap.")],
      ["#/explorer",
        t("splash.card_explore_t", "Explorer"), t("splash.card_explore_d", "Blocks, assets and chain data.")],
      ["#/wallet",
        t("splash.card_wallet_t", "Wallet"), t("splash.card_wallet_d", "Keys that never leave this device.")]
    ].forEach(function (c) {
      var a = doc.createElement("a");
      a.href = c[0];
      a.className = "prod-card subtle-btn";
      touchable(a);
      a.appendChild(DOM.el(doc, "h3", c[1]));
      a.appendChild(DOM.el(doc, "p", c[2], "muted"));
      grid.appendChild(a);
    });
    s.appendChild(grid);
    return s;
  }

  /* Trust trio (Crypo feature-trio slot, our truths — every claim is
   * verifiable in this repo, nothing rented from marketing). */
  function landingTrust(doc) {
    var s = doc.createElement("section");
    s.className = "trust-trio";
    s.appendChild(DOM.el(doc, "h2", t("splash.trust_title", "Why it stays yours")));
    var grid = doc.createElement("div");
    grid.className = "trust-grid";
    [
      [t("splash.trust_keys_t", "Keys never leave your device"),
        t("splash.trust_keys_d", "Signing happens locally in your browser. No server ever sees a password or a key.")],
      [t("splash.trust_browse_t", "Browse everything with no account"),
        t("splash.trust_browse_d", "Reads never ask for login. The password is requested only at signing.")],
      [t("splash.trust_numbers_t", "Human numbers, shown fees"),
        t("splash.trust_numbers_d", "Amounts at the right decimal, percents as percents, every fee previewed before you sign.")]
    ].forEach(function (c) {
      var d = doc.createElement("div");
      d.className = "trust-cell";
      d.appendChild(DOM.el(doc, "h3", c[0]));
      d.appendChild(DOM.el(doc, "p", c[1], "muted"));
      grid.appendChild(d);
    });
    s.appendChild(grid);
    return s;
  }

  /* Three DEX-honest steps (Crypo steps slot — no bank-linking here). */
  function landingSteps(doc) {
    var s = doc.createElement("section");
    s.className = "splash-steps";
    s.appendChild(DOM.el(doc, "h2", t("splash.steps_title", "Get started in three steps")));
    var grid = doc.createElement("div");
    grid.className = "steps-grid";
    [
      ["1", t("splash.step1_t", "Create a wallet"),
        t("splash.step1_d", "A brainkey is generated on this device. Write it on paper."),
        "#/create-wallet-brainkey"],
      ["2", t("splash.step2_t", "Fund it"),
        t("splash.step2_d", "Testnet faucet or a gateway deposit — tiny first."),
        "#/deposit-withdraw"],
      ["3", t("splash.step3_t", "Trade the book"),
        t("splash.step3_d", "Limit orders on a real order book. Cancel anything."),
        "#/market/" + encodeURIComponent(defaultMarket())]
    ].forEach(function (c) {
      var d = doc.createElement("div");
      d.className = "step-cell";
      d.appendChild(DOM.el(doc, "div", c[0], "step-num"));
      d.appendChild(DOM.el(doc, "h3", c[1]));
      d.appendChild(DOM.el(doc, "p", c[2], "muted"));
      var a = doc.createElement("a");
      a.href = c[3];
      a.textContent = c[1];
      a.className = "subtle-btn";
      touchable(a);
      d.appendChild(a);
      grid.appendChild(d);
    });
    s.appendChild(grid);
    return s;
  }

  /* Final CTA band. */
  function landingFinal(doc) {
    var s = doc.createElement("section");
    s.className = "cta-band";
    s.appendChild(DOM.el(doc, "h2", t("splash.final_t", "Ready when you are.")));
    var a = doc.createElement("a");
    a.href = "#/create-wallet-brainkey";
    a.className = "btn";
    a.textContent = t("splash.final_cta", "Create a wallet");
    s.appendChild(a);
    return s;
  }

  return {
    renderDashboard: renderDashboard,
    _test: { landingFor: landingFor, fmtCount: fmtCount, asCount: asCount, topVolText: topVolText, shapePulse: shapePulse, tickRow: tickRow, clearTickMisses: clearTickMisses, _tickCache: _tickCache }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.DashboardUI === "undefined") { globalThis.DashboardUI = DashboardUI; }
if (typeof module !== "undefined") { module.exports = DashboardUI; }
