/* account-ui.js — #/account/:name THIN FACADE (identical public surface).
 *
 * What it owns: route entry renderAccount (+ locked renderUnlockPrompt),
 *   the showAccount skeleton (header, follow row, section shells, tab row
 *   with ?tab=/?hist= deep-link state, fills orchestration), contacts
 *   watch-list, the _histFirst watcher seed. Section bodies live in
 *   account-history.js (AccountUI._history: orders + history) and
 *   account-membership.js (AccountUI._membership: membership + margin +
 *   credit); portfolio + equity bodies stay local to this file. (The former
 *   account-portfolio.js shadow copy was deleted unreferenced — never
 *   wired, no callers; see commit history.)
 * Consumes: AccountUI._history/_membership (late-bound at call time),
 *   Account, Wallet, ViewingAs, NotifyHost, NotifyRules, Offline,
 *   HistoryNotice, Explorer, Store, DOM, Forms, Icon. Globals/side effects:
 *   publishes globalThis.AccountUI; module.exports for node suites
 *   (account-deeplink-test.js pins _test). Load order in index.html:
 *   account-history.js, account-membership.js,
 *   account-ui.js (facade LAST).
 * Created by: split_responsibility.py account/market frontier (facade
 *   assembly — skeleton + entries kept, section bodies moved verbatim).
 */
var AccountUI = (typeof globalThis !== "undefined" && globalThis.AccountUI) ? globalThis.AccountUI : ((typeof AccountUI !== "undefined") ? AccountUI : {});
/* Node suites require() the facade directly while the browser loads
 * the parts via <script> order. Pull the parts through the module loader
 * WITHOUT naming `require` (checkJs runs browser libs — a bare require()
 * call is TS2591 there; tx.js precedent). module.require resolves relative
 * to THIS file, like require(). */
var __partRequire = null;
try {
  if (typeof module !== "undefined" && module && /** @type {any} */ (module).require && /** @type {any} */ (module).require.bind) __partRequire = /** @type {any} */ (module).require.bind(module);
} catch (e) { __partRequire = null; }
if (__partRequire && (!AccountUI._history || !AccountUI._membership)) {
  try { __partRequire("./account-history.js"); } catch (e) {}
  try { __partRequire("./account-membership.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.AccountUI) AccountUI = globalThis.AccountUI;
}
(function () {
  "use strict";

  /* Batch-2a i18n: display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back
   * to the default when i18n.js failed to load: never blank, never throws.
   * vars fills %(name)s placeholders (Reference #6 shape); without I18n
   * the raw default returns unfilled — i18n.js is a local script tag,
   * absent only when the file itself is missing. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Slice-16 (F1b): per-account last-seen history first-id for the pulled
   * fill/transfer watcher. No global polling state in Notify; the caller
   * persists per-view. First paint is a baseline (never toasts). */
  var _histFirst = {};

  /* Followed accounts (menu-sitemap slice: moved here from app.js when the
   * burger shrank to headings — follow/unfollow is contextual on the
   * account page, not in a menu). Plain-name watch-list in localStorage
   * (same key proposal-ui.js:383 reads for its trust check — keep the key
   * byte-identical). No chain calls — pure watch-list. Never throws. */
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

  /* Clear all children of the router root. */
  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  /* New .wrap container appended to root. Wide (viewport-gaps fix
   * 2026-09-28): full-bleed stacked grid ≥1200px instead of the 720px
   * stranded column; children span full width via app.css .wide contract. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  /* Inline error line (aria-live so screen readers announce failures). */
  function makeError(doc) {
    var err = doc.createElement("div");
    err.className = "error";
    err.setAttribute("aria-live", "polite");
    return err;
  }

  /* Show an inline error panel that is never blank: any thrown value maps
   * to a human sentence; unknown shapes fall back to a generic message.
   * History fallback keeps its byte-identical message key and gains a linked
   * "Open Settings" action (HistoryNotice.actionLink, pure DOM). */
  function showError(doc, wrap, e, fallback) {
    var err = makeError(doc);
    var raw = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || "");
    var isHist = raw.indexOf("history-unavailable") !== -1;
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) {
      msg = fallback || t("common.unknown_account", "Unknown account.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("transfer.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("account.err_history", "History unavailable on this node.");
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("account.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
    if (isHist) {
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          var link = HistoryNotice.actionLink(doc, t, "settings");
          if (link) wrap.appendChild(link);
        }
      } catch (e2) { /* error panel stands without the link */ }
    }
  }

  /** Decimal string -> {num, den} BigInts ("12.5" -> 125n/10n), or null on
   * any other shape. Integer-only; feeds exact BTS-value multiplication
   * (binary float for money is a bug, not a shortcut).
   * TYPE NOTE: explicit bigint return pins decFrac against tsc's evolving-any
   * inference (bare `var num` + try/catch reads back as number at the
   * multiply site). No shared vanilla/js/api/types.js exists yet (group 1
   * owns it); this local annotation stands alone, nothing to merge.
   * @param {any} s display decimal (string expected, anything coerced)
   * @returns {{num: bigint, den: bigint} | null} exact ratio, UNREDUCED */
  function decFrac(s) {
    if (typeof s !== "string") s = String(s === null || s === undefined ? "" : s);
    var m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
    if (!m) return null;
    var frac = m[2] || "";
    var num;
    try { num = BigInt(m[1] + frac); } catch (e) { return null; }
    var den = 1n, i;
    for (i = 0; i < frac.length; i++) den *= 10n;
    return { num: num, den: den };
  }

  /** Exact floor of qtyHuman * priceHuman scaled to a raw integer at prec
   * decimals (value in BTS smallest units). Returns the digit string, or
   * null when either side is not a plain non-negative decimal (caller
   * dashes the cell — never throws on chain data).
   * @param {any} qtyHuman display quantity
   * @param {any} priceHuman display price (BTS per unit)
   * @param {any} prec asset precision (non-negative integer)
   * @returns {string | null} raw integer digits, or null on bad input */
  function valueRawOf(qtyHuman, priceHuman, prec) {
    var q = decFrac(qtyHuman), p = decFrac(priceHuman);
    if (!q || !p) return null;
    var scale = 1n, i;
    for (i = 0; i < prec; i++) scale *= 10n;
    try {
      return ((q.num * p.num * scale) / (q.den * p.den)).toString();
    } catch (e) { return null; }
  }

  /* Add a raw integer string into map[assetId] (BigInt sum; malformed legs
   * are ignored so one bad row never blanks the column). */
  function sumRawInto(map, assetId, raw) {
    if (typeof assetId !== "string" || !assetId) return;
    var s = String(raw === null || raw === undefined ? "" : raw);
    if (!/^\d+$/.test(s)) return;
    try {
      var cur = map[assetId];
      map[assetId] = ((cur === undefined ? 0n : BigInt(cur)) + BigInt(s)).toString();
    } catch (e) { /* malformed leg ignored */ }
  }

  /* Raw integer -> display string at prec decimals; falls back to the raw
   * digits when Format is absent (never throws on chain data). */
  function fmtRaw(raw, prec) {
    if (typeof prec !== "number") return String(raw);
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function") {
        return Format.formatAmount(String(raw), prec);
      }
    } catch (e) { /* raw fallback below */ }
    return String(raw);
  }

  /* trim6 at RENDER (retro round 4, D1 rule ported to the portfolio PRICE
   * column): get_ticker latest strings can carry 16+ decimals (SILVER
   * 1547.9876… vs original account.png 5-decimal prices); the original
   * shows ~6. Pure string truncation of ^-?\d+\.\d{7,}$ to 6 decimals.
   * Format math untouched; the full-precision chain string stays on the
   * cell's title attr. Duplicated from market-ind.js:639 / market-book.js:162
   * / market-picker.js:57 per the no-shared-abstraction doctrine. */
  function trim6(s) {
    s = String(s);
    var m = /^(-?\d+)\.(\d+)$/.exec(s);
    if (m && m[2].length > 6) return m[1] + "." + m[2].slice(0, 6);
    return s;
  }

  /* Dash text for honestly-missing cells (reuses the shared dash key). */
  function dashText() { return t("settings.dash", "—"); }

  /* Per-asset route links (punchlist 2): SEND -> #/transfer, DEPOSIT ->
   * #/deposit-withdraw, TRADE -> #/market/<SYM>_BTS (BTS itself uses the
   * app-default BTS_CNY market — router.js renderHomeFallback precedent),
   * BORROW + SETTLE -> #/borrow (the margin/settle family page hosts both
   * flows; nothing rebuilt here). Plain anchors: tap-friendly, no hover
   * dependence. Params: doc, symbol, btsSymbol. Returns a span element. */
  function actionLinks(doc, symbol, btsSymbol) {
    var sym = String(symbol || "");
    var base = String(btsSymbol || "BTS");
    var pair = (sym === base) ? base + "_CNY" : sym + "_" + base;
    /* Polish Task 4: monochrome glyph alongside each action label (icon+text
     * always, never icon-only — the text carries meaning when the glyph is
     * unknown or fails to load). Names mirror the nav semantics (transfer /
     * deposit-withdraw / market / borrow); SETTLE shares the borrow glyph
     * (the margin/settle family page hosts both flows). Guarded by
     * Icon.known: unknown names skip the network and render text-only, never
     * blank. Themed by the existing .icon-img filter (themes.css
     * --icon-filter), so glyphs track surrounding text color in all themes. */
    var ICONS = { SEND: "transfer", DEPOSIT: "deposit", TRADE: "trade", BORROW: "borrow", SETTLE: "settle" };
    var defs = [
      ["SEND", "#/transfer", "Send " + sym + " (transfer page)"],
      ["DEPOSIT", "#/deposit-withdraw", "Deposit or withdraw " + sym + " (gateway page)"],
      ["TRADE", "#/market/" + encodeURIComponent(pair), "Trade " + pair + " (market page)"],
      ["BORROW", "#/borrow", "Borrow against " + sym + " (borrow page)"],
      ["SETTLE", "#/borrow", "Settle " + sym + " (borrow page)"]
    ];
    var span = doc.createElement("span");
    defs.forEach(function (d, i) {
      if (i > 0) span.appendChild(doc.createTextNode(" | "));
      var a = doc.createElement("a");
      a.setAttribute("href", d[1]);
      a.title = d[2];
      var withIcon = false;
      try {
        var iname = ICONS[d[0]];
        if (iname && typeof Icon !== "undefined" && Icon &&
            typeof Icon.img === "function" && typeof Icon.known === "function" &&
            Icon.known(iname)) {
          var glyph = Icon.img(iname, "nav-icon", "");
          if (glyph) {
            a.appendChild(glyph);
            a.appendChild(doc.createTextNode(" " + d[0]));
            withIcon = true;
          }
        }
      } catch (e) { withIcon = false; }
      if (!withIcon) a.textContent = d[0];
      span.appendChild(a);
    });
    return span;
  }

  /* Portfolio enrichment (punchlist 1): per-asset IN ORDERS / IN VESTING /
   * IN COLLATERAL / PRICE(BTS) / 24HR reads behind the balances tab.
   * Reference concepts only: #1 AccountPortfolioList.getHeader (qty /
   * inOrders / inVesting / inCollateral / price / hour24 / value) plus its
   * _renderBalances vesting/collateral joins; #1 AccountOverview adds the
   * TotalBalanceValue line with MarginPositionsTable + CreditOfferAccountPage
   * sections below it. Sources: Account.openOrders
   * (get_limit_orders_by_account — sell legs summed per asset),
   * get_vesting_balances (balance legs summed per asset),
   * Credit.positions (proven margin-first / by-account-fallback read —
   * collateral summed per asset), and one get_ticker batch quoted in BTS
   * (latest = BTS-per-asset human, percent_change shown verbatim).
   * Ticker batch is capped at 20 assets (N+1 ban holds: one bounded batch,
   * never per-row refetch on filter). Every leg is best-effort: failures
   * resolve to null and render as dashes with a muted note — a missing
   * read never blanks the tab.
   * Params: acctId "1.2.N", balances (Account.balances rows), shared
   * (optional {orders, positions} zero-arg fns returning the render's shared
   * open-orders/margin promises — perf: the Orders/Margin tabs read the same
   * rows in the same render, so one fetch serves both; absent means fetch
   * here as before).
   * Returns a Promise of {inOrders, vesting, collateral (assetId->raw, or
   * null when that read failed), prices (assetId->{latest, change}), bts
   * ({id, prec, symbol} or null), capped, notes}. Never rejects. */
  function enrichPortfolio(acctId, balances, shared) {
    var useShared = (shared && typeof shared === "object") ? shared : null;
    var out = { inOrders: {}, vesting: null, collateral: null, prices: {},
      bts: null, capped: false, notes: [] };
    if (typeof Chain === "undefined" || !Chain || typeof Chain.db !== "function") {
      out.notes.push("Chain backend missing — portfolio extras dashed.");
      return Promise.resolve(out);
    }
    var list = Array.isArray(balances) ? balances : [];
    function dbCall(method, params) {
      return Chain.db().then(function (dbId) { return Chain.call(dbId, method, params); });
    }
    var jobs = [];
    /* IN ORDERS: sum open-order sell legs per asset (the same WS method the
     * Orders tab reads — one extra call, never per-row). */
    jobs.push(Promise.resolve().then(function () {
      if (useShared && typeof useShared.orders === "function") return useShared.orders();
      return Account.openOrders(acctId);
    }).then(function (orders) {
      (orders || []).forEach(function (o) {
        if (o && o.sell) sumRawInto(out.inOrders, o.sell.asset_id, o.sell.raw);
      });
    }).catch(function () {
      out.notes.push("Open orders unavailable — in-orders dashed.");
    }));
    /* IN VESTING: get_vesting_balances summed per asset (same method and
     * [id] param shape as referrals-ui.js / vesting-ui.js). */
    jobs.push(dbCall("get_vesting_balances", [acctId]).then(function (rows) {
      var map = {};
      (rows || []).forEach(function (vb) {
        var bal = vb && vb.balance;
        if (bal) sumRawInto(map, bal.asset_id, bal.amount);
      });
      out.vesting = map;
    }).catch(function () {
      out.vesting = null;
      out.notes.push("Vesting balances unavailable on this node — column dashed.");
    }));
    /* IN COLLATERAL: Credit.positions when that backend loaded (its proven
     * read already handles the margin/by-account fallback); an absent
     * backend dashes the column instead of breaking the tab. */
    if (typeof Credit !== "undefined" && Credit && typeof Credit.positions === "function") {
      jobs.push(Promise.resolve().then(function () {
        if (useShared && typeof useShared.positions === "function") return useShared.positions();
        return Credit.positions(acctId);
      }).then(function (rows) {
        var map = {};
        (rows || []).forEach(function (r) {
          if (r) sumRawInto(map, r.coll_id, r.coll_raw);
        });
        out.collateral = map;
      }).catch(function () {
        out.collateral = null;
        out.notes.push("Collateral positions unavailable — column dashed.");
      }));
    } else {
      out.notes.push("Credit backend not loaded — collateral column dashed.");
    }
    /* PRICE(BTS) + 24HR: BTS id first, then ONE bounded ticker batch (base
     * BTS, quote asset). BTS itself prices at 1 with no call. */
    jobs.push(dbCall("lookup_asset_symbols", [["BTS"]]).then(function (rows) {
      var bts = rows && rows[0];
      if (!bts || typeof bts.precision !== "number") throw new Error("no-bts");
      out.bts = { id: bts.id, prec: bts.precision, symbol: bts.symbol || "BTS" };
      var need = [];
      list.forEach(function (b) {
        if (b && b.asset_id !== bts.id) need.push(b.asset_id);
      });
      if (need.length > 20) { out.capped = true; need = need.slice(0, 20); }
      /* Bounded burst: Promise.all in chunks of 5 (never 20-at-once).
       * Results merge back keyed by asset id (deterministic rows, same
       * shape as before); one asset failing dashes that row only — a
       * per-asset catch means the chunk (and batch) never rejects. */
      function fetchChunk(idx) {
        if (idx >= need.length) return Promise.resolve();
        var slice = need.slice(idx, idx + 5);
        var burst = slice.map(function (aid) {
          return dbCall("get_ticker", [bts.id, aid]).then(function (tk) {
            out.prices[aid] = {
              latest: (tk && tk.latest !== undefined && tk.latest !== null) ? String(tk.latest) : null,
              change: (tk && tk.percent_change !== undefined && tk.percent_change !== null)
                ? String(tk.percent_change) : null
            };
          }).catch(function () { out.prices[aid] = { latest: null, change: null }; });
        });
        return Promise.all(burst).then(function () { return fetchChunk(idx + 5); });
      }
      return fetchChunk(0).then(function () { /* batch settled */ });
    }).catch(function () {
      out.bts = null;
      out.notes.push("BTS price batch unavailable — price/value columns dashed.");
    }));
    return Promise.all(jobs).then(function () { return out; });
  }

  /** Portfolio table + phone cards (punchlist 1-5): Asset (linked to
   * #/asset/:symbol) | QTY | IN ORDERS | IN VESTING | IN COLLATERAL |
   * PRICE(BTS) | 24HR | VALUE(BTS) | actions. A search input filters rows
   * client-side (no refetch); a muted subtext line carries the summed BTS
   * total (floor of qty*price per asset, BTS row at face value, visible
   * rows only). Missing legs render as dashes (see enrichPortfolio notes).
   * Params: doc, section, acct ({id, name}), balances, enrich.
   * @param {Document} doc owner document
   * @param {HTMLElement} section mount element for the portfolio panel
   * @param {any} acct account object ({id, name})
   * @param {any} balances balance rows for the account
   * @param {any} enrich enrichment helpers (prices/flags) */
  function renderPortfolio(doc, section, acct, balances, enrich) {
    var list = Array.isArray(balances) ? balances : [];
    var bts = enrich.bts;
    var btsSym = bts ? bts.symbol : "BTS";
    if (!list.length) {
      var empty = doc.createElement("p");
      empty.className = "muted";
      empty.textContent = t("account.s1", "No balances.") + t("account.s1_hint", " Fund it with a transfer, or place a market order — holdings list here.");
      section.appendChild(empty);
      (enrich.notes || []).forEach(function (n) {
        var nn = doc.createElement("p");
        nn.className = "muted";
        nn.textContent = n;
        section.appendChild(nn);
      });
      return;
    }
    function isBts(b) { return !!(bts && b && b.asset_id === bts.id); }
    /* One enriched row per balance (humans via fmtRaw; value floored via
     * valueRawOf; anything missing dashes — never throws). */
    function rowFor(b) {
      var inORaw = enrich.inOrders[b.asset_id];
      var vMap = enrich.vesting, cMap = enrich.collateral;
      var price = null, change = null, valueRaw = null;
      if (isBts(b)) {
        price = "1";
        valueRaw = /^\d+$/.test(String(b.raw)) ? String(b.raw) : null;
      } else if (enrich.prices[b.asset_id]) {
        price = enrich.prices[b.asset_id].latest;
        change = enrich.prices[b.asset_id].change;
      }
      if (bts && valueRaw === null && price) {
        valueRaw = valueRawOf(b.display, price, bts.prec);
      }
      var valueH = null;
      if (bts && valueRaw !== null) {
        try { valueH = fmtRaw(valueRaw, bts.prec); } catch (e) { valueH = null; }
      }
      return {
        b: b,
        inOH: (inORaw !== undefined ? fmtRaw(inORaw, b.precision) : dashText()),
        vestH: (!vMap ? dashText()
          : (vMap[b.asset_id] !== undefined ? fmtRaw(vMap[b.asset_id], b.precision) : dashText())),
        collH: (!cMap ? dashText()
          : (cMap[b.asset_id] !== undefined ? fmtRaw(cMap[b.asset_id], b.precision) : dashText())),
        priceH: (price !== null && price !== undefined && price !== "" ? trim6(price) : dashText()),
        priceFull: (price !== null && price !== undefined && price !== "" ? String(price) : ""),
        changeH: (change !== null && change !== undefined && change !== "" ? change : dashText()),
        valueH: (valueH !== null ? valueH : dashText()),
        valueRaw: valueRaw
      };
    }
    /* Asset search filter (punchlist 5): plain substring on the symbol,
     * case-insensitive; re-draws from the cached rows (no refetch). */
    var search = doc.createElement("input");
    search.type = "search";
    search.placeholder = t("account.filter_by_asset_symbol", "Filter by asset symbol…");
    search.setAttribute("aria-label", t("account.filter_assets_by_symbol", "Filter assets by symbol"));
    search.style.minHeight = "44px";
    search.style.width = "100%";
    search.style.maxWidth = "360px";
    section.appendChild(search);
    /* Total-value BTS subtext (punchlist 4): filled per draw so a filter
     * totals the visible rows; honest when no price leg exists. */
    var total = doc.createElement("p");
    total.className = "muted";
    section.appendChild(total);
    var box = doc.createElement("div");
    section.appendChild(box);
    (enrich.notes || []).forEach(function (n) {
      var nn = doc.createElement("p");
      nn.className = "muted";
      nn.textContent = n;
      section.appendChild(nn);
    });
    if (enrich.capped) {
      var cap = doc.createElement("p");
      cap.className = "muted";
      cap.textContent = t("account.prices_cover_the_first_20_assets_the_rest_are", "Prices cover the first 20 assets — the rest are dashed.");
      section.appendChild(cap);
    }
    function symbolLink(sym) {
      var a = doc.createElement("a");
      a.setAttribute("href", "#/asset/" + encodeURIComponent(sym));
      a.textContent = sym;
      return a;
    }
    function draw() {
      var q = search.value.trim().toLowerCase();
      while (box.firstChild) box.removeChild(box.firstChild);
      var rows = list.map(rowFor).filter(function (r) {
        return !q || String(r.b.symbol).toLowerCase().indexOf(q) !== -1;
      });
      if (!rows.length) {
        var none = doc.createElement("p");
        none.className = "muted";
        none.textContent = t("account.no_assets_match_this_filter", "No assets match this filter.") + t("account.filter_hint", " Clear the filter to see the full portfolio.");
        box.appendChild(none);
      } else {
        var table = doc.createElement("table");
        table.className = "node-table";
        var thead = doc.createElement("thead");
        var headRow = doc.createElement("tr");
        [t("account.asset_th", "Asset"), "QTY", "IN ORDERS", "IN VESTING",
          "IN COLLATERAL", "PRICE(BTS)", "24HR", "VALUE(BTS)",
          t("account.manage", "Manage")].forEach(function (label) {
          var th = doc.createElement("th");
          th.textContent = label;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = doc.createElement("tbody");
        rows.forEach(function (r) {
          var tr = doc.createElement("tr");
          var symCell = doc.createElement("td");
          symCell.appendChild(symbolLink(r.b.symbol));
          tr.appendChild(symCell);
          var qtyCell = doc.createElement("td");
          qtyCell.textContent = r.b.display;
          qtyCell.title = r.b.raw;
          tr.appendChild(qtyCell);
          [r.inOH, r.vestH, r.collH, r.priceH, r.changeH, r.valueH].forEach(function (txt, ci) {
            var td = doc.createElement("td");
            td.textContent = txt;
            /* PRICE column keeps the full chain string on title (D1 rule). */
            if (ci === 3 && r.priceFull) td.title = r.priceFull;
            tr.appendChild(td);
          });
          var actCell = doc.createElement("td");
          actCell.appendChild(actionLinks(doc, r.b.symbol, btsSym));
          tr.appendChild(actCell);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        box.appendChild(table);

        var cards = doc.createElement("div");
        cards.className = "node-cards";
        rows.forEach(function (r) {
          var card = doc.createElement("div");
          card.className = "node-card";
          var top = doc.createElement("div");
          top.appendChild(symbolLink(r.b.symbol));
          top.appendChild(doc.createTextNode(" " + r.b.display));
          top.title = r.b.raw;
          card.appendChild(top);
          var mid = doc.createElement("div");
          mid.className = "muted";
          mid.textContent = r.priceH + " BTS · " + r.valueH + " BTS";
          if (r.priceFull) mid.title = r.priceFull + t("account.price_full_suffix", " BTS (full chain precision)");
          card.appendChild(mid);
          var acts = doc.createElement("div");
          acts.appendChild(actionLinks(doc, r.b.symbol, btsSym));
          card.appendChild(acts);
          cards.appendChild(card);
        });
        box.appendChild(cards);
      }
      var sum = 0n, any = false;
      rows.forEach(function (r) {
        if (r.valueRaw !== null) {
          try { sum += BigInt(r.valueRaw); any = true; } catch (e) { /* leg ignored */ }
        }
      });
      if (bts && any) {
        total.textContent = t("account.total", "Total ≈ ") + fmtRaw(sum.toString(), bts.prec) + " " + btsSym;
        total.title = t("account.raw_prefix", "raw ") + sum.toString();
      } else {
        total.textContent = t("account.total_value_unavailable_no_bts_prices_yet", "Total value unavailable (no BTS prices yet).");
        total.title = "";
      }
    }
    search.addEventListener("input", draw);
    draw();
    var detBal = doc.createElement("details");
    detBal.className = "raw";
    var sumBal = doc.createElement("summary");
    sumBal.setAttribute("aria-label", t("account.bal_json_label", "Show raw balances JSON"));
    detBal.appendChild(sumBal);
    var preBal = doc.createElement("pre");
    try { preBal.textContent = JSON.stringify(list, null, 2); }
    catch (e) { preBal.textContent = String(list); }
    detBal.appendChild(preBal);
    section.appendChild(detBal);
  }

  /* Read a CSS custom property off <html> (theme-aware plot colors);
   * falls back headlessly. Token-driven: all three themes supply
   * --buy/--sell/--accent/--border/--muted/--text (themes.css). Plain
   * duplicate of the market-book.js helper (doctrine: duplicated plain code
   * over a shared abstraction with a future migration cost). */
  function cssVar(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }

  /* DPR-aware canvas fit (plain duplicate of the market-book.js helper —
   * same contract: {ctx, w, h} CSS pixels, or null when unusable). */
  function fitCanvas(canvas, cssH) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    var w = canvas.clientWidth;
    if (!w && canvas.parentNode && canvas.parentNode.clientWidth) {
      w = canvas.parentNode.clientWidth;
    }
    if (!w || w <= 0) w = 300;
    var dpr = 1;
    try {
      if (typeof window !== "undefined" && window.devicePixelRatio) {
        dpr = window.devicePixelRatio;
      }
    } catch (e) { dpr = 1; }
    canvas.style.width = "100%";
    canvas.style.height = cssH + "px";
    /* Pixel sizing below is Number() on layout pixels only — never money. */
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, cssH);
    return { ctx: ctx, w: w, h: cssH };
  }

  /* One small-multiple sparkline: per-page net deltas (raw strings,
   * chronological) as a BigInt-normalized line with a dashed zero line when
   * the series spans both signs. Pixel mapping is parts-per-million in
   * BigInt, then Number() on the 0..1e6 int — exact and pixel-only (never
   * money). Single-point series draw one dot. Returns nothing. */
  function drawSpark(canvas, seriesRaw, color) {
    var g = fitCanvas(canvas, 70);
    if (!g) return;
    var vals = (Array.isArray(seriesRaw) ? seriesRaw : []).map(function (s) {
      try {
        return BigInt(String(s));
      } catch (e) {
        return 0n;
      }
    });
    if (!vals.length) return;
    var muted = cssVar("--muted", "#777777");
    var i, mn = vals[0], mx = vals[0];
    for (i = 1; i < vals.length; i++) {
      if (vals[i] < mn) mn = vals[i];
      if (vals[i] > mx) mx = vals[i];
    }
    var range = mx - mn;
    var padL = 8, padR = 8, padT = 8, padB = 12;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    /* frac: BigInt value -> 0..1 plot fraction (pixel math only, never
     * display: display strings come from Format). Returns 0.5 on flat data. */
    function frac(v) {
      if (range === 0n) return 0.5;
      /* Pixel-only Number(): ppm is a 0..1e6 int, exact in double. */
      return Number((v - mn) * 1000000n / range) / 1000000;
    }
    /* Pixel x: even page-index spacing (single page centers one dot). */
    function x(i) {
      return vals.length === 1 ? padL + plotW / 2 : padL + (i / (vals.length - 1)) * plotW;
    }
    function y(v) {
      return padT + (1 - frac(v)) * plotH;
    }
    var ctx = g.ctx;
    ctx.strokeStyle = cssVar("--border", "rgba(128,128,128,0.45)");
    ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, padT + 0.5, plotW - 1, plotH - 1);
    if (mn < 0n && mx > 0n) {
      ctx.strokeStyle = muted;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y(0n));
      ctx.lineTo(padL + plotW, y(0n));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (i = 0; i < vals.length; i++) {
      if (i === 0) ctx.moveTo(x(i), y(vals[i]));
      else ctx.lineTo(x(i), y(vals[i]));
    }
    ctx.stroke();
    for (i = 0; i < vals.length; i++) {
      ctx.beginPath();
      ctx.arc(x(i), y(vals[i]), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = muted;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("oldest", padL + 2, g.h - 2);
    ctx.textAlign = "right";
    ctx.fillText("newest", padL + plotW - 2, g.h - 2);
    ctx.textAlign = "left";
  }

  /* Human net for one replayed asset (Format at render; raw id fallback when
   * the join missed the precision — never throws on chain data). */
  function equityHuman(a) {
    if (a.precision === null || a.precision === undefined) return a.total_raw + " (" + a.asset_id + ")";
    try {
      return Format.formatAmount(a.total_raw, a.precision) + " " + a.symbol;
    } catch (e) {
      return a.total_raw + " (" + a.asset_id + ")";
    }
  }

  /* Equity sparkline section fill (dex-ux plot proposal 4 host — docs/parity/dexux-plots.md section 4). One <details open> with a small-multiples
   * canvas per plotted asset (top 3 by |net|) + a net-change table for ALL
   * replayed assets + an honest counts line. Assets are never summed across
   * precisions (one series per asset, each scaled independently — the note
   * says so). Honest empties: no history vs history-without-balance-legs. */
  function renderEquity(doc, section, eq) {
    var counts = "Replayed " + eq.pagesFetched + " page(s), " + eq.eventsSeen + " events: " +
      eq.counted + " balance legs counted, " + eq.skipped + " skipped." +
      (eq.truncated ? " Walk stopped at the 5-page cap — older history not included." : "");
    if (!eq.assets || eq.assets.length === 0) {
      var msg = doc.createElement("p");
      msg.className = "muted";
      msg.textContent = eq.eventsSeen === 0
        ? "No history for this account yet — sparkline empty."
        : "No balance-affecting ops in the last " + eq.eventsSeen +
          " events (transfers, fills, pool legs) — sparkline empty.";
      section.appendChild(msg);
      var note0 = doc.createElement("p");
      note0.className = "muted";
      note0.textContent = counts;
      section.appendChild(note0);
      return;
    }
    var det = doc.createElement("details");
    det.className = "plot acct-equity";
    det.setAttribute("open", "");
    var sum = doc.createElement("summary");
    sum.setAttribute("aria-label", t("account.equity_sparkline_plot", "Equity sparkline plot"));
    sum.style.minHeight = "44px";
    sum.textContent = t("account.equity_sparkline", "Equity sparkline");
    det.appendChild(sum);
    section.appendChild(det);
    var colors = [cssVar("--buy", "#6ba583"), cssVar("--sell", "#e3745b"), cssVar("--accent", "#1ec3fa")];
    eq.assets.slice(0, 3).forEach(function (a, idx) {
      var label = doc.createElement("div");
      label.textContent = a.symbol + ": " + equityHuman(a);
      label.title = t("account.raw_prefix", "raw ") + a.total_raw;
      det.appendChild(label);
      var canvas = doc.createElement("canvas");
      canvas.className = "mkt-canvas";
      det.appendChild(canvas);
      drawSpark(canvas, a.perPage_raw, colors[idx % colors.length]);
    });
    if (eq.assets.length > 3) {
      var more = doc.createElement("p");
      more.className = "muted";
      more.textContent = "+" + (eq.assets.length - 3) + " more asset(s) in the table below (top 3 plotted).";
      det.appendChild(more);
    }
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var headRow = doc.createElement("tr");
    ["Asset", "Net change"].forEach(function (h) {
      var th = doc.createElement("th");
      th.textContent = h;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    eq.assets.forEach(function (a) {
      var tr = doc.createElement("tr");
      var symCell = doc.createElement("td");
      symCell.textContent = a.symbol;
      tr.appendChild(symCell);
      var netCell = doc.createElement("td");
      netCell.textContent = equityHuman(a);
      netCell.title = t("account.raw_prefix", "raw ") + a.total_raw;
      tr.appendChild(netCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    det.appendChild(table);
    var note = doc.createElement("p");
    note.className = "muted";
    note.textContent = counts + " Shape only, not a balance: each asset scaled independently —" +
      " compare shape, not height. Pool receive legs replay at the min_to_receive floor" +
      " (actual may exceed it); withdraw releases settle on chain.";
    det.appendChild(note);
  }

  /* Unlock prompt for /account/me while locked: password + button; on
   * success re-renders #/account/me so the user lands back where asked. */
  function renderUnlockPrompt(doc, wrap, root) {
    wrap.appendChild(DOM.pageHead(doc, t("account.s4", "My account"), "user"));
    var hint = doc.createElement("p");
    hint.textContent = t("account.s5", "Wallet is locked. Enter your password to view your account.");
    wrap.appendChild(hint);
    var label = doc.createElement("label");
    label.appendChild(doc.createTextNode(t("account.password_label", "Password ")));
    var input = doc.createElement("input");
    input.id = "acct-unlock-password";
    input.type = "password";
    input.setAttribute("autocomplete", "current-password");
    label.appendChild(input);
    wrap.appendChild(label);
    var btn = doc.createElement("button");
    btn.id = "acct-unlock-do";
    btn.type = "button";
    btn.textContent = t("account.s6", "Unlock");
    wrap.appendChild(btn);
    var err = makeError(doc);
    wrap.appendChild(err);
    btn.addEventListener("click", function () {
      err.textContent = "";
      btn.disabled = true;
      /* H2: wipe the password local + input on either outcome. */
      var pw = input.value;
      Promise.resolve()
        .then(function () { return Wallet.unlock(pw); })
        .then(function () {
          input.value = "";
          pw = null;
          renderAccount(root, "me");
        })
        .catch(function (e) {
          input.value = "";
          pw = null;
          btn.disabled = false;
          var msg = (e && e.message) ? e.message : t("common.unlock_failed", "Unlock failed.");
          err.textContent = msg;
        });
    });
    /* Public-first lookup (G6 repair): locked users can still open ANY
     * account page without unlock (pattern copied from
     * accounts-ui.js:144-155 — input + button, no resolve, the account page
     * reports unknown names itself). Plus a wallet-manager link. */
    var lookH = doc.createElement("h2");
    lookH.textContent = t("account.lookup_title", "Look up an account");
    wrap.appendChild(lookH);
    var lookNote = doc.createElement("p");
    lookNote.className = "muted";
    lookNote.textContent = t("account.lookup_hint", "Public data — no unlock needed. Opens the full account page (balances, orders, history).");
    wrap.appendChild(lookNote);
    var lookInput = doc.createElement("input");
    lookInput.type = "text";
    lookInput.setAttribute("autocomplete", "off");
    lookInput.style.minHeight = "44px";
    var lookRow = Forms.fieldRow(doc, t("common.account_name", "Account name "), lookInput);
    wrap.appendChild(lookRow);
    var lookErr = makeError(doc);
    wrap.appendChild(lookErr);
    var lookBtn = doc.createElement("button");
    lookBtn.type = "button";
    lookBtn.style.minHeight = "44px";
    lookBtn.textContent = t("account.open_account", "Open account page");
    wrap.appendChild(lookBtn);
    lookBtn.addEventListener("click", function () {
      var v = lookInput.value.trim().toLowerCase();
      if (!v) { lookErr.textContent = t("account.enter_name", "Enter an account name."); return; }
      lookErr.textContent = "";
      if (typeof location !== "undefined") location.hash = "#/account/" + encodeURIComponent(v);
    });
    /* Locked view-as affordance (view-as task 3, same block as
     * accounts-ui.js lookup: same keys, same error mapping, same field
     * error slot). The unlock form above stays untouched (signing path
     * unchanged). ViewingAs missing -> network_error. */
    var lookViewBtn = doc.createElement("button");
    lookViewBtn.type = "button";
    lookViewBtn.style.minHeight = "44px";
    lookViewBtn.textContent = t("viewing.dialog_open", "View as");
    wrap.appendChild(lookViewBtn);
    lookViewBtn.addEventListener("click", function () {
      var v = lookInput.value.trim().toLowerCase();
      if (!v) { lookErr.textContent = t("account.enter_name", "Enter an account name."); return; }
      lookErr.textContent = "";
      lookViewBtn.disabled = true;
      Promise.resolve().then(function () {
        if (typeof ViewingAs === "undefined" || !ViewingAs || typeof ViewingAs.set !== "function") throw new Error("network_error");
        return ViewingAs.set(v);
      }).then(function () {
        lookViewBtn.disabled = false;
      }).catch(function (e) {
        lookViewBtn.disabled = false;
        var m = (e && e.message) ? e.message : "";
        if (m.indexOf("unknown-account") !== -1) lookErr.textContent = t("viewing.unknown_account", "Unknown account name.");
        else lookErr.textContent = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
      });
    });
    var lookResetLine = doc.createElement("p");
    lookResetLine.className = "muted";
    var lookResetBtn = doc.createElement("button");
    lookResetBtn.type = "button";
    lookResetBtn.style.minHeight = "44px";
    lookResetBtn.textContent = t("viewing.dialog_reset", "Reset");
    lookResetLine.appendChild(lookResetBtn);
    wrap.appendChild(lookResetLine);
    lookResetBtn.addEventListener("click", function () {
      lookErr.textContent = "";
      try {
        if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.clear === "function") ViewingAs.clear();
      } catch (e) { /* default stands */ }
    });
    var walletLine = doc.createElement("p");
    walletLine.className = "muted";
    var walletLink = doc.createElement("a");
    walletLink.setAttribute("href", "#/wallet");
    walletLink.textContent = t("account.wallet_manager", "Wallet manager");
    walletLine.appendChild(walletLink);
    wrap.appendChild(walletLine);
  }

  /* Fill an account page: header (name + id), then Balances / Open orders /
   * History / Membership / Equity / Margin Positions / Credit Management
   * sections behind a tab row (retro round 2 D3 — the original's 5-tab
   * language, extended by the punchlist; our sections, not its 13-column
   * table). Balances is the default tab like #1. Sections fill
   * independently and fail inline (never blank, never wiping each other);
   * hidden tabs keep filling so switching never shows a stale loader. */
  /* Account deep-link state (?tab=<slug>&hist=<mode>): active tab +
   * history filter survive reload and share links. Slugs are stable
   * identifiers (balances/orders/history/membership/equity/margin/credit);
   * hist modes are the select values (all/0/4). Unknown values fall back
   * to balances/all — never throw, never blank. Module scope (exported
   * via _test); only syncAcctUrl's callers live in showAccount. */
  var ACCT_TABS = ["balances", "orders", "history", "membership", "equity", "margin", "credit"];

  var ACCT_HIST = ["all", "0", "4"];

  /* parseAcctQuery: URL query -> {tab, hist} (unit-tested). Params: raw
   * (Router.query() object or null). Returns validated slugs (tab null =
   * default balances, hist "all" = default). Never throws. */
  function parseAcctQuery(raw) {
    var out = { tab: null, hist: "all" };
    try {
      var q = (raw && typeof raw === "object") ? raw : {};
      if (ACCT_TABS.indexOf(q.tab) !== -1 && q.tab !== "balances") out.tab = q.tab;
      if (ACCT_HIST.indexOf(q.hist) !== -1) out.hist = q.hist;
    } catch (e) { /* defaults stand */ }
    return out;
  }

  /* buildAcctQuery: (tab, hist) -> "" or "?tab=&hist=" (unit-tested).
   * Defaults vanish (balances/all = bare account path). Pure. */
  function buildAcctQuery(tab, hist) {
    var parts = [];
    try {
      if (ACCT_TABS.indexOf(tab) !== -1 && tab !== "balances") parts.push("tab=" + tab);
      if (ACCT_HIST.indexOf(hist) !== -1 && hist !== "all") parts.push("hist=" + hist);
    } catch (e) { /* parts stand */ }
    return parts.length ? ("?" + parts.join("&")) : "";
  }

  /* syncAcctUrl: write tab/filter into the hash without re-rendering
   * (replaceState never fires hashchange — no render loop). Preserves
   * the current account path. Never throws. */
  function syncAcctUrl(tab, hist) {
    try {
      if (typeof location === "undefined" || !location.href) return;
      if (typeof history === "undefined" || typeof history.replaceState !== "function") return;
      var path = "#/account";
      try { path = String(location.hash || "").split("?")[0] || path; } catch (e) { /* default stands */ }
      history.replaceState(null, "", location.href.split("#")[0] + path + buildAcctQuery(tab, hist));
    } catch (e) { /* URL stays; view unaffected */ }
  }

  function showAccount(doc, wrap, root, acct) {
    wrap.appendChild(DOM.pageHead(doc, acct.name, "user"));
    var sub = doc.createElement("p");
    sub.className = "muted";
    sub.textContent = acct.id;
    wrap.appendChild(sub);
    /* Copy-share-link row (hash deep link the router already resolves:
     * #/account/:name, router.js). Clipboard API with an execCommand
     * textarea fallback; the result reads inline via aria-live, never a
     * dialog. Button/status labels via t() (misc.copy_link/misc.copying,
     * centrally merged); result textContent only. Explorer backend is call-time-guarded
     * (explorer.js loads after this file) — without it the row falls back
     * to the bare hash, still a working deep link. */
    (function shareRow() {
      try {
        var row = doc.createElement("div");
        row.className = "xplore-share";
        var btn = doc.createElement("button");
        btn.type = "button";
        btn.textContent = t("misc.copy_link", "Copy link");
        btn.style.minHeight = "44px";
        var note = doc.createElement("span");
        note.className = "muted";
        note.setAttribute("aria-live", "polite");
        row.appendChild(btn);
        row.appendChild(doc.createTextNode(" "));
        row.appendChild(note);
        var hash = "#/account/" + acct.name;
        btn.addEventListener("click", function () {
          btn.disabled = true;
          note.textContent = t("misc.copying", "Copying…");
          /* Live hash (tab/filter state rides replaceState — the shared
           * link preserves the view, not just the account). Falls back to
           * the bare account path when unreadable. */
          try {
            if (typeof location !== "undefined" && typeof location.hash === "string" && location.hash) {
              hash = location.hash;
            }
          } catch (e) { /* static hash stands */ }
          var url = hash;
          try {
            if (typeof Explorer !== "undefined" && Explorer &&
                typeof Explorer.currentShareUrl === "function") {
              url = Explorer.currentShareUrl(hash);
            } else if (typeof location !== "undefined" && location.href) {
              url = location.href.split("#")[0] + hash;
            }
          } catch (e) { url = hash; }
          function done(ok) {
            btn.disabled = false;
            note.textContent = ok ? "Copied" : "Copy failed — long-press the address bar to copy";
          }
          function fallback() {
            try {
              var ta = doc.createElement("textarea");
              ta.value = url;
              doc.body.appendChild(ta);
              ta.select();
              var ok = false;
              try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
              try { ta.parentNode.removeChild(ta); } catch (e2) { /* gone */ }
              done(!!ok);
            } catch (e) { done(false); }
          }
          try {
            if (typeof navigator !== "undefined" && navigator.clipboard &&
                typeof navigator.clipboard.writeText === "function") {
              navigator.clipboard.writeText(url).then(function () { done(true); }, function () { fallback(); });
            } else {
              fallback();
            }
          } catch (e) { fallback(); }
        });
        wrap.appendChild(row);
      } catch (e) { /* header stands without sharing */ }
    })();
    /* Follow toggle (moved from the burger menu — contextual here). Toggles
     * acct.name in the localStorage watch-list; label flips in place.
     * 44px touch target; never throws. */
    (function followRow() {
      try {
        var name = acct && acct.name;
        if (typeof name !== "string" || !name) return;
        var btn = doc.createElement("button");
        btn.type = "button";
        btn.style.minHeight = "44px";
        function paint() {
          var follows = loadContacts().indexOf(name) !== -1;
          btn.textContent = follows
            ? t("account.unfollow", "Unfollow") + " " + name
            : t("account.follow", "Follow") + " " + name;
        }
        paint();
        btn.addEventListener("click", function () {
          var list = loadContacts();
          var i = list.indexOf(name);
          if (i === -1) list.push(name);
          else list.splice(i, 1);
          saveContacts(list);
          paint();
        });
        wrap.appendChild(btn);
      } catch (e) { /* header stands without follow */ }
    })();
    /* Dense-table scope for the CSS below (smaller padding, tabular numbers
     * — columns untouched). */
    try { wrap.classList.add("acct"); } catch (e) { /* density skips */ }

    /* Perf: one open-orders fetch + one margin fetch per render. The Orders
     * tab, the Margin tab, and the Balances enrichment all read the same rows
     * in the same render — shared lazy promises serve all three (created on
     * first use, so an unused tab costs nothing). Same data, same render,
     * never cached across renders. */
    var ordersSharedP = null, positionsSharedP = null;
    function sharedOrders() {
      if (!ordersSharedP) ordersSharedP = Account.openOrders(acct.id);
      return ordersSharedP;
    }
    function sharedPositions() {
      if (!positionsSharedP) {
        if (typeof Credit === "undefined" || !Credit || typeof Credit.positions !== "function") {
          return Promise.reject(new Error("margin backend missing"));
        }
        positionsSharedP = Credit.positions(acct.id);
      }
      return positionsSharedP;
    }
    var sharedReads = { orders: sharedOrders, positions: sharedPositions };

    var balSection = doc.createElement("section");
    var balH = doc.createElement("h2");
    balH.textContent = t("account.s7", "Balances");
    balSection.appendChild(balH);
    var balLoading = doc.createElement("p");
    balLoading.className = "muted";
    balLoading.textContent = t("account.loading_balances", "Loading balances…");
    balSection.appendChild(balLoading);
    wrap.appendChild(balSection);

    var ordSection = doc.createElement("section");
    var ordH = doc.createElement("h2");
    ordH.textContent = t("account.orders_title", "Open orders");
    ordSection.appendChild(ordH);
    var ordLoading = doc.createElement("p");
    ordLoading.className = "muted";
    ordLoading.textContent = t("account.loading_orders", "Loading open orders…");
    ordSection.appendChild(ordLoading);
    wrap.appendChild(ordSection);

    var histSection = doc.createElement("section");
    var histH = doc.createElement("h2");
    histH.textContent = t("account.history_title", "History");
    histSection.appendChild(histH);
    /* History CSV export (org-survey 2026-10-03 ADOPT-1: 11-column
     * CoinTracking shape via HistoryExport.rowsToCsv — raw per-fill rows,
     * grouping is a follow-up). The button carries the English literal on
     * purpose: no account.export_csv key exists in vanilla/locales/*.json
     * and this file cannot mint one (check_i18n gate) — the next i18n batch
     * mints account.export_csv. Wiring only: HistoryExport + Asset resolve
     * at call time (backend-missing and empty-history fail soft through the
     * existing showError path, never blank, never throwing). */
    var histRowsCache = [];
    var histExportBtn = doc.createElement("button");
    histExportBtn.type = "button";
    histExportBtn.style.minHeight = "44px";
    histExportBtn.textContent = t("account.export_csv", "Export CSV");
    histSection.appendChild(histExportBtn);
    histExportBtn.addEventListener("click", function () {
      if (!histRowsCache || histRowsCache.length === 0) {
        var noneMsg = t("account.s3", "No recent activity.");
        showError(doc, histBody, new Error(noneMsg), noneMsg);
        return;
      }
      var HE = null;
      try {
        /* globalThis-bracket (not bare `typeof HistoryExport`): the type
         * gate's ambient declarations file has no HistoryExport line and
         * this file cannot mint one — bare references fail checkJs. */
        HE = (typeof globalThis !== "undefined" && globalThis["HistoryExport"]) || null;
      } catch (e) { HE = null; }
      if (!HE) {
        showError(doc, histBody, new Error("history-export backend missing"),
          t("account.err_history", "History unavailable on this node."));
        return;
      }
      var ids = [];
      try { ids = HE.collectAssetIds(histRowsCache); } catch (e) { ids = []; }
      /* Finish an export with a resolved asset map (missing precisions fall
       * back to raw digits inside rowsToCsv — never a blank download). */
      function finishExport(assetMap) {
        var csv = "";
        try {
          csv = HE.rowsToCsv(histRowsCache, { accountId: acct.id, assets: assetMap || {} });
        } catch (e) {
          showError(doc, histBody, e, t("account.err_history", "History unavailable on this node."));
          return;
        }
        var fname = "history.csv";
        try { fname = HE.defaultFilename(acct.name); } catch (e) { fname = "history.csv"; }
        var ok = false;
        try { ok = HE.downloadCsv(fname, csv); } catch (e) { ok = false; }
        if (!ok) {
          showError(doc, histBody, new Error("export-download-unavailable"),
            t("account.err_history", "History unavailable on this node."));
        }
      }
      var useAsset = null;
      try {
        if (typeof Asset !== "undefined" && Asset && typeof Asset.describe === "function") useAsset = Asset;
      } catch (e) { useAsset = null; }
      if (!useAsset || !ids || ids.length === 0) { finishExport({}); return; }
      var bounded = ids.slice(0, 50);
      var built = {};
      Promise.all(bounded.map(function (aid) {
        return Promise.resolve().then(function () { return useAsset.describe(aid); }).then(function (a) {
          if (a && typeof a.precision === "number") built[a.id || aid] = { symbol: a.symbol || aid, precision: a.precision };
        }).catch(function () { /* miss falls back to raw id inside rowsToCsv */ });
      })).then(function () { finishExport(built); }).catch(function (e) {
        showError(doc, histBody, e, t("account.err_history", "History unavailable on this node."));
      });
    });
    var histLoading = doc.createElement("p");
    histLoading.className = "muted";
    histLoading.textContent = t("account.loading_history", "Loading history…");
    histSection.appendChild(histLoading);
    /* History op-type filter: a select row above the list. "all" reuses the
     * existing historyPaged path (Account.history, unchanged default); "0"
     * and "4" fetch Account.opsFiltered(id, [type], 20) (transfer-only /
     * fill-only, the astro-ui DexLiveOrderBook use). Labels reuse existing
     * i18n keys only — no dedicated "All activity" key exists, so All
     * renders as t("market.kind_all"). Unclassed native select + 44px
     * inline floor (no select precedent on this page; history-notice.js
     * actionLink pattern). No new CSS. */
    var histFilter = doc.createElement("select");
    histFilter.setAttribute("aria-label", t("account.history_title", "History"));
    histFilter.style.minHeight = "44px";
    [["all", t("market.kind_all", "All")],
     ["0", t("transfer.title", "Transfer")],
     ["4", t("account.op_fill", "Fill order")]].forEach(function (pair) {
      var opt = doc.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      histFilter.appendChild(opt);
    });
    histSection.appendChild(histFilter);
    var histBody = doc.createElement("div");
    histSection.appendChild(histBody);
    wrap.appendChild(histSection);

    var memSection = doc.createElement("section");
    var memH = doc.createElement("h2");
    memH.textContent = t("account.membership", "Membership");
    memSection.appendChild(memH);
    wrap.appendChild(memSection);
    AccountUI._membership.renderMembership(doc, memSection, acct);

    var eqSection = doc.createElement("section");
    var eqH = doc.createElement("h2");
    eqH.textContent = t("account.equity_tab", "Equity");
    eqSection.appendChild(eqH);
    var eqLoading = doc.createElement("p");
    eqLoading.className = "muted";
    eqLoading.textContent = t("account.replaying_recent_history", "Replaying recent history…");
    eqSection.appendChild(eqLoading);
    wrap.appendChild(eqSection);

    var marSection = doc.createElement("section");
    var marH = doc.createElement("h2");
    marH.textContent = t("account.margin_positions", "Margin positions");
    marSection.appendChild(marH);
    wrap.appendChild(marSection);
    AccountUI._membership.renderMargin(doc, marSection, acct, sharedPositions);

    var creSection = doc.createElement("section");
    var creH = doc.createElement("h2");
    creH.textContent = t("account.credit_management", "Credit management");
    creSection.appendChild(creH);
    wrap.appendChild(creSection);
    AccountUI._membership.renderCredit(doc, creSection, acct);

    /* Tab row (original Balances-first language; hidden sections keep their
     * h2s for screen readers via tabpanel roles). Buttons ride the shared
     * .mkt-tabs style (dashboard/pool/desk precedent) — 44px from CSS.
     * Proposals tab deferred by punchlist scope (see renderCredit): the
     * row keeps the round-2 tabs plus Margin Positions + Credit Management;
     * #/proposals stays reachable from the credit tab's link line. */
    var tabDefs = [
      { key: "balances", label: t("account.s7", "Balances"), sec: balSection },
      { key: "orders", label: t("account.orders_title", "Open orders"), sec: ordSection },
      { key: "history", label: t("account.history_title", "History"), sec: histSection },
      { key: "membership", label: t("account.membership", "Membership"), sec: memSection },
      { key: "equity", label: t("account.equity_tab", "Equity"), sec: eqSection },
      { key: "margin", label: "Margin Positions", sec: marSection },
      { key: "credit", label: "Credit Management", sec: creSection }
    ];
    /* Deep-link seed: ?tab= picks the initial tab (?hist= seeds the filter
     * below); unknown slugs stay on Balances. */
    var acctSeed = (function () {
      try {
        if (typeof Router !== "undefined" && Router && typeof Router.query === "function") {
          return parseAcctQuery(Router.query());
        }
      } catch (e) { /* defaults below */ }
      return parseAcctQuery(null);
    })();
    var activeTabKey = acctSeed.tab || "balances";
    var activeIdx = 0;
    tabDefs.forEach(function (def, i) {
      if (def.key === activeTabKey) activeIdx = i;
    });
    var tabBar = doc.createElement("div");
    tabBar.className = "mkt-tabs acct-tabs";
    tabBar.setAttribute("role", "tablist");
    tabBar.setAttribute("aria-label", t("account.title", "Account"));
    tabDefs.forEach(function (def, i) {
      try { def.sec.setAttribute("role", "tabpanel"); } catch (e) { /* sections stand */ }
      if (i !== activeIdx) def.sec.style.display = "none";
      var b = doc.createElement("button");
      b.type = "button";
      b.textContent = def.label;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
      b.addEventListener("click", function () {
        tabDefs.forEach(function (d) {
          d.sec.style.display = (d === def) ? "" : "none";
        });
        Array.prototype.forEach.call(tabBar.querySelectorAll("button"), function (x) {
          x.setAttribute("aria-selected", x === b ? "true" : "false");
        });
        activeTabKey = def.key;
        try { syncAcctUrl(activeTabKey, histFilter.value); } catch (e) { /* URL stays */ }
      });
      tabBar.appendChild(b);
    });
    wrap.insertBefore(tabBar, balSection);

    Account.balances(acct.id).then(function (list) {
      balSection.removeChild(balLoading);
      enrichPortfolio(acct.id, list, sharedReads).then(function (enrich) {
        renderPortfolio(doc, balSection, acct, list, enrich);
      });
    }).catch(function (e) {
      balSection.removeChild(balLoading);
      showError(doc, balSection, e, t("account.load_balances_failed", "Could not load balances."));
    });

    Account.equity(acct.id).then(function (eq) {
      eqSection.removeChild(eqLoading);
      renderEquity(doc, eqSection, eq);
    }).catch(function (e) {
      eqSection.removeChild(eqLoading);
      showError(doc, eqSection, e, "Could not replay equity.");
    });

    /**
     * Load one history-filter mode into the history body container.
     * "all" calls Account.history (the pre-existing historyPaged path);
     * "0"/"4" call Account.opsFiltered with the single op type
     * (transfer-only / fill-only). Rows render through renderHistory and
     * failures through showError, so the history-unavailable mapping keeps
     * its Round-1 Settings link in every mode. The pulled fill/transfer
     * watcher runs on "all" only: filtered first-ids are not the global
     * baseline and must not reset it.
     * @param {string} mode "all", "0", or "4" (the select's value).
     * @returns {void} Async; never throws (errors render inline).
     */
    function loadHist(mode) {
      if (histLoading.parentNode === histSection) histSection.removeChild(histLoading);
      while (histBody.firstChild) histBody.removeChild(histBody.firstChild);
      var fetching = doc.createElement("p");
      fetching.className = "muted";
      fetching.textContent = t("account.loading_history", "Loading history…");
      histBody.appendChild(fetching);
      var p;
      if (mode === "0" || mode === "4") {
        if (typeof Account.opsFiltered === "function") {
          p = Account.opsFiltered(acct.id, [parseInt(mode, 10)], 20);
        } else {
          p = Promise.reject(new Error("history-unavailable"));
        }
      } else {
        p = Account.history(acct.id, 20);
      }
      Promise.resolve(p).then(function (rows) {
        if (fetching.parentNode === histBody) histBody.removeChild(fetching);
        /* Slice-16 (F1b): pulled history watcher on the existing fetch.
         * First-entry diff per plan; a notify fault never breaks history. */
        if (mode === "all") {
          try {
            if (typeof NotifyHost !== "undefined" && NotifyHost &&
                typeof NotifyHost.mountToasts === "function") {
              try { NotifyHost.mountToasts(); } catch (e) { /* host best-effort */ }
            }
            if (typeof NotifyRules !== "undefined" && NotifyRules &&
                typeof NotifyRules.checkHistory === "function") {
              try {
                var prev = Object.prototype.hasOwnProperty.call(_histFirst, acct.id)
                  ? _histFirst[acct.id] : null;
                var res = NotifyRules.checkHistory(prev, rows, { watchAccounts: [acct.id] });
                if (res && res.firstId !== undefined && res.firstId !== null) {
                  _histFirst[acct.id] = String(res.firstId);
                }
              } catch (e) { /* watcher sleeps, never breaks the view */ }
            }
          } catch (e) { /* notify optional here */ }
        }
        /* History one-liners Task 3 prerequisite: the enrich->render chain
         * is RETURNED so a render throw rejects the outer promise and
         * routes to .catch(showError) instead of an unhandled rejection. */
        return Promise.resolve(rows).then(function (r2) {
          if (typeof HistorySummary !== "undefined" && HistorySummary && typeof HistorySummary.enrich === "function") return HistorySummary.enrich(r2, acct.id);
          return r2;
        }).then(function (r3) {
          histRowsCache = Array.isArray(r3) ? r3 : [];
          AccountUI._history.renderHistory(doc, histBody, r3);
        });
      }).catch(function (e) {
        if (fetching.parentNode === histBody) histBody.removeChild(fetching);
        showError(doc, histBody, e, t("account.err_history", "History unavailable on this node."));
      });
    }
    histFilter.addEventListener("change", function () {
      loadHist(histFilter.value);
      try { syncAcctUrl(activeTabKey, histFilter.value); } catch (e) { /* URL stays */ }
    });
    try { histFilter.value = acctSeed.hist; } catch (e) { /* "all" stands */ }
    loadHist(acctSeed.hist);

    /* Public read: any account's open orders render with NO login (#1 shows
     * them for every viewed account; only cancel requires ownership, and
     * cancel lives on the market desk — no cancel buttons here by design).
     * Shared with the Balances enrichment (perf: one fetch per render). */
    sharedOrders().then(function (orders) {
      ordSection.removeChild(ordLoading);
      AccountUI._history.renderOpenOrders(doc, ordSection, orders);
    }).catch(function (e) {
      ordSection.removeChild(ordLoading);
      showError(doc, ordSection, e, t("account.load_orders_failed", "Could not load open orders."));
    });
  }

  /* Route entry: renderAccount(root, name). Name "me" resolves through the
   * wallet keystore (unlock prompt when locked); anything else resolves as
   * a public account name or 1.2.N id. Unknown accounts render an inline
   * error panel, never a blank page. */
  function renderAccount(root, name) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);

    if (typeof Account === "undefined" || !Account) {
      showError(doc, wrap, t("account.backend_missing_account", "Account backend missing: js/account.js failed to load."));
      return;
    }
    if (typeof name !== "string" || !name) {
      showError(doc, wrap, "unknown-account", t("common.unknown_account", "Unknown account."));
      return;
    }

    /* Wait for the shared connection before any chain read: deep links land
     * before boot finishes connecting. Re-renders once on open; times out
     * into the normal error panel. Guards against route changes mid-wait.
     * (Pattern for all future data pages: never read on a cold socket.) */
    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      var waiting = doc.createElement("p");
      waiting.className = "muted";
      waiting.textContent = t("common.status_connecting", "Connecting to network…");
      wrap.appendChild(waiting);
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderAccount(root, name);
        }
      });
      var timer = setTimeout(function () {
        if (settled) return; settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        clearRoot(root);
        var failed = makeWrap(doc, root);
        showError(doc, failed, new Error("not connected"), t("common.network_unavailable_short", "Network unavailable."));
        var astat = doc.createElement("p");
        astat.className = "muted";
        try { astat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        failed.appendChild(astat);
        var arow = doc.createElement("div");
        arow.className = "pools-offline-row";
        failed.appendChild(arow);
        var abtn = doc.createElement("button");
        abtn.type = "button";
        abtn.textContent = t("fees.retry", "Retry");
        try { abtn.style.minHeight = "44px"; } catch (e) { /* native stands */ }
        arow.appendChild(abtn);
        var aoff = null;
        try { aoff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { aoff = null; }
        if (aoff && typeof aoff.wire === "function") {
          try { aoff.wire(abtn, astat, function () { renderAccount(root, name); }, t); } catch (e) { abtn.addEventListener("click", function () { renderAccount(root, name); }); }
        } else {
          abtn.addEventListener("click", function () { renderAccount(root, name); });
        }
        var alink = null;
        if (aoff && typeof aoff.settingsLink === "function") {
          try { alink = aoff.settingsLink(doc, t); } catch (e) { alink = null; }
        }
        if (!alink) {
          alink = doc.createElement("a");
          alink.textContent = t("notice.open_settings", "Open Settings");
          try { alink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          try { alink.style.minHeight = "44px"; } catch (e) { /* native stands */ }
        }
        arow.appendChild(alink);
      }, 15000);
      /* Automated handshake on entry (shared Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
      return;
    }

    if (name === "me") {
      if (typeof Wallet === "undefined" || !Wallet ||
          typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked()) {
        renderUnlockPrompt(doc, wrap, root);
        return;
      }
      var loading = doc.createElement("p");
      loading.className = "muted";
      loading.textContent = t("transfer.loading", "Loading…");
      wrap.appendChild(loading);
      Account.myAccountId().then(function (id) {
        return Account.resolve(id);
      }).then(function (acct) {
        clearRoot(root);
        showAccount(doc, makeWrap(doc, root), root, acct);
      }).catch(function (e) {
        clearRoot(root);
        var retry = makeWrap(doc, root);
        retry.appendChild(DOM.pageHead(doc, t("account.s4", "My account"), "user"));
        showError(doc, retry, e, t("transfer.load_account_failed", "Could not load your account."));
      });
      return;
    }

    var loadingPub = doc.createElement("p");
    loadingPub.className = "muted";
    loadingPub.textContent = t("transfer.loading", "Loading…");
    wrap.appendChild(loadingPub);
    Account.resolve(name).then(function (acct) {
      clearRoot(root);
      showAccount(doc, makeWrap(doc, root), root, acct);
    }).catch(function (e) {
      clearRoot(root);
      var failed = makeWrap(doc, root);
      showError(doc, failed, e, t("transfer.unknown_account_name", "Unknown account: %(name)s.", {name: name}));
    });
  }
  AccountUI.renderAccount = renderAccount;
  AccountUI.OP_LABELS = AccountUI._history.OP_LABELS;
  AccountUI._test = { parseAcctQuery: parseAcctQuery, buildAcctQuery: buildAcctQuery };
  if (typeof globalThis !== "undefined") { globalThis.AccountUI = AccountUI; }
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountUI === "undefined") { globalThis.AccountUI = AccountUI; }
if (typeof module !== "undefined") { module.exports = AccountUI; }
