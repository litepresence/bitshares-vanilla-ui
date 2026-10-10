/* ExplorerTabs: the six ref-parity explorer tabs (pools, accounts, witnesses,
 * committee, markets, fees) — #1 Explorer.jsx:18-64 has eight tabs
 * (blocks/assets/pools/accounts/witnesses/committee/markets/fees); vanilla
 * already owned blocks/assets (+feeds extra, kept as documented superset).
 * Owns: tab body renderers only — poolsTab/accountsTab/witnessesTab/
 *   committeeTab/marketsTab/feesTab(doc, body, root, myGen). Shell
 *   (search/tabs/head/object panel) stays in explorer-ui.js, which
 *   dispatches here by tab id (lazy globals, same pattern as
 *   ExplorerBlocks/ExplorerAssets). No signing, no storage.
 * Consumes: Pool.list (pool rows), Chain (lookup_accounts, get_top_markets),
 *   Asset.describe (market symbols, fail-open per row), Vote.lists
 *   (witness/committee entries), FeesUI.renderTables (fee tables),
 *   ExplorerUI gen guard via isCurrent callback passed by the shell —
 *   callers pass a live() closure, never the counter. Side effects: DOM
 *   under the given body only; global ExplorerTabs only.
 * Reads stay public (no unlock gates anywhere here — principle #9).
 * Created by: building-vanilla-slices skill, explorer-tabs plan. */
var ExplorerTabs = (function () {
  "use strict";

  /**
   * @typedef {import('./types.js').TopMarketRow} TopMarketRow
   * @typedef {import('./types.js').CountResult} CountResult
   * @typedef {import('./types.js').PulseResult} PulseResult
   * @typedef {import('./types.js').TFunction} TFunction
   */

  /* Batch-3 i18n (slice-17 precedent): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Local element helpers (textContent-only; per-file copies per doctrine
   * rule 5 — WHY: no shared-DOM-util module may grow inside vanilla/). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function link(doc, href, text) {
    var a = doc.createElement("a");
    a.setAttribute("href", href);
    a.textContent = text;
    touchable(a);
    return a;
  }
  function errBox(doc, body, msg) {
    var p = el(doc, "p", msg, "error");
    p.setAttribute("aria-live", "polite");
    body.appendChild(p);
    return p;
  }
  function table(doc, heads) {
    var t = doc.createElement("table");
    t.className = "node-table";
    var thead = doc.createElement("thead"), hr = doc.createElement("tr");
    heads.forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = doc.createElement("tbody");
    t.appendChild(tb);
    return { table: t, tbody: tb };
  }

  /** poolsTab: first 20 pools (id/share/legs) + desk link.
   * @param {any} doc
   * @param {any} body
   * @param {any} live
   * @returns {void} */
  function poolsTab(doc, body, live) {
    if (typeof Pool === "undefined" || !Pool || typeof Pool.list !== "function") {
      errBox(doc, body, "Pool backend missing: js/pool.js failed to load.");
      return;
    }
    body.appendChild(el(doc, "p", "Loading pools…", "muted"));
    Pool.list({ limit: 20 }).then(function (rows) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      if (!rows || !rows.length) {
        body.appendChild(el(doc, "p", /** @type {any} */ (t)("explorer.no_pools_found", "No pools found — create one from the Pools desk (#/pools) Stake form."), "muted"));
        return;
      }
      /** @type {any} */
      var t = table(doc, ["Pool", "Share", "Asset A", "Asset B"]);
      rows.forEach(function (r) {
        var tr = doc.createElement("tr");
        var td = doc.createElement("td");
        td.appendChild(link(doc, "#/pools/" + r.id, r.id));
        tr.appendChild(td);
        tr.appendChild(el(doc, "td", r.sym_share || r.share_id || "—"));
        tr.appendChild(el(doc, "td", r.sym_a || r.asset_a_id || "—"));
        tr.appendChild(el(doc, "td", r.sym_b || r.asset_b_id || "—"));
        t.tbody.appendChild(tr);
      });
      body.appendChild(t.table);
      var p = el(doc, "p", null, "muted");
      p.appendChild(link(doc, "#/pools", "Open the pools desk →"));
      body.appendChild(p);
    }).catch(function (e) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      errBox(doc, body, (e && e.message) || "Could not load pools.");
    });
  }

  /* accountLinkTarget: one lookup_accounts row -> link target, or null.
   * WHY: the node answers [name, id] PAIRS (#4 database_api.hpp:357;
   * live-proven), so stringifying the row leaks ",1.2.x" into the href
   * (#/account/committee%2C1.2.599999 -> 404) and the label. The name wins
   * in every shape; garbage rows yield null so the caller skips them.
   * Pure (unit-tested). @param {any} nm row. @returns {{href,label}|null}. */
  function accountLinkTarget(nm) {
    try {
      var name = null;
      if (typeof nm === "string") name = nm;
      else if (Array.isArray(nm) && typeof nm[0] === "string") name = nm[0];
      else if (nm && typeof nm === "object" && typeof nm.name === "string") name = nm.name;
      if (!name) return null;
      return { href: "#/account/" + encodeURIComponent(name), label: name };
    } catch (e) { return null; }
  }

  /* accountsTab: prefix search via lookup_accounts -> name links. */
  function accountsTab(doc, body, live) {
    var form = doc.createElement("form");
    var input = doc.createElement("input");
    input.type = "search";
    input.setAttribute("placeholder", t("explorer.accounts_prefix_ph", "Account name prefix…"));
    input.setAttribute("aria-label", t("explorer.accounts_search_aria", "Search accounts by name prefix"));
    touchable(input);
    input.classList.add("subtle-btn");
    form.appendChild(input);
    var go = touchable(el(doc, "button", "Search"));
    go.type = "submit";
    form.appendChild(go);
    body.appendChild(form);
    var out = doc.createElement("div");
    body.appendChild(out);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      while (out.firstChild) out.removeChild(out.firstChild);
      var q = String(input.value || "").trim().toLowerCase();
      if (!q) return;
      out.appendChild(el(doc, "p", "Searching…", "muted"));
      Chain.db().then(function (dbId) {
        return Chain.call(dbId, "lookup_accounts", [q, 20]);
      }).then(function (names) {
        if (!live()) return;
        while (out.firstChild) out.removeChild(out.firstChild);
        if (!names || !names.length) {
          out.appendChild(el(doc, "p", t("explorer.no_accounts_found", "No accounts found — check the name prefix, or register a new name at Create Account (#/create-account)."), "muted"));
          return;
        }
        var ul = doc.createElement("ul");
        names.forEach(function (nm) {
          var tgt = accountLinkTarget(nm);
          if (!tgt) return;
          var li = doc.createElement("li");
          li.appendChild(link(doc, tgt.href, tgt.label));
          ul.appendChild(li);
        });
        if (!ul.firstChild) {
          out.appendChild(el(doc, "p", t("explorer.no_accounts_found", "No accounts found — check the name prefix, or register a new name at Create Account (#/create-account)."), "muted"));
          return;
        }
        out.appendChild(ul);
      }).catch(function (e) {
        if (!live()) return;
        while (out.firstChild) out.removeChild(out.firstChild);
        errBox(doc, out, (e && e.message) || "Account search failed.");
      });
    });
  }

  /* memberTab: shared witness/committee table (name/account/active/link).
   * Vote weights are raw stake ints — intentionally NOT shown here (principle
   * #6: the voting page owns human weight math; this summary links there).
   * LOW punchlist: thin-summary honesty — the scope line below names the
   * full page for weights and slates. Batch-3 i18n: keyed. */
  function memberTab(doc, body, live, kind) {
    var isWit = kind === "witnesses";
    if (typeof Vote === "undefined" || !Vote || typeof Vote.lists !== "function") {
      errBox(doc, body, "Voting backend missing: js/vote.js failed to load.");
      return;
    }
    body.appendChild(el(doc, "p", "Loading " + kind + "…", "muted"));
    Vote.lists().then(function (all) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      var rows = (isWit ? all.witnesses : all.committee) || [];
      if (!rows.length) {
        body.appendChild(el(doc, "p", "No " + kind + " found.", "muted"));
        return;
      }
      var tbl = table(doc, ["Name", "Account", "Active"]);
      var cards = doc.createElement("div");
      cards.className = "node-cards";
      rows.slice(0, 50).forEach(function (m) {
        var label = m.name || m.account_id;
        var href = "#/account/" + encodeURIComponent(m.name || m.account_id);
        var tr = doc.createElement("tr");
        var td = doc.createElement("td");
        td.appendChild(link(doc, href, label));
        tr.appendChild(td);
        tr.appendChild(el(doc, "td", m.account_id || "—"));
        tr.appendChild(el(doc, "td", m.active ? "yes" : "—"));
        tbl.tbody.appendChild(tr);
        var card = doc.createElement("div");
        card.className = "node-card";
        var headline = doc.createElement("div");
        headline.appendChild(link(doc, href, label));
        card.appendChild(headline);
        card.appendChild(el(doc, "div", m.account_id || "—", "muted"));
        card.appendChild(el(doc, "div", m.active ? "yes" : "—"));
        cards.appendChild(card);
      });
      body.appendChild(tbl.table);
      body.appendChild(cards);
      var p = el(doc, "p", null, "muted");
      p.appendChild(link(doc, "#/voting", "Open voting for weights and slates →"));
      body.appendChild(p);
      body.appendChild(el(doc, "p", t("explorer.thin_summary_top_50_names_and_activity", "Thin summary (top 50, names and activity only) — weights and publishing live on the voting page."), "muted"));
    }).catch(function (e) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      errBox(doc, body, (e && e.message) || ("Could not load " + kind + "."));
    });
  }
  function witnessesTab(doc, body, live) { memberTab(doc, body, live, "witnesses"); }
  function committeeTab(doc, body, live) { memberTab(doc, body, live, "committee"); }

  /* cmpDec: ascending compare of two human decimal strings via
   * Format.parsePriceRatio BigInt ratios (money rule — no parseFloat, no
   * Number on prices). Null/empty/unparseable legs sort LAST (return 1 when
   * only b is comparable, -1 when only a is, 0 when neither). Never throws.
   * @param {any} a
   * @param {any} b
   * @returns {number} */
  function cmpDec(a, b) {
    function ratio(s) {
      if (s === undefined || s === null) return null;
      s = String(s);
      if (!s) return null;
      try {
        if (typeof Format === "undefined" || !Format ||
            typeof Format.parsePriceRatio !== "function") return null;
        return Format.parsePriceRatio(s);
      } catch (e) { return null; }
    }
    var ra = ratio(a), rb = ratio(b);
    if (ra === null && rb === null) return 0;
    if (ra === null) return 1;
    if (rb === null) return -1;
    var left, right;
    try {
      left = ra.num * rb.den;
      right = rb.num * ra.den;
    } catch (e) { return 0; }
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  /** filterMarkets: case-insensitive QUOTE_BASE substring filter.
   * @param {any[]} rows
   * @param {any} q
   * @returns {any[]} */
  function filterMarkets(rows, q) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    var needle = String((q === undefined || q === null) ? "" : q).trim().toLowerCase();
    if (!needle) return list;
    return list.filter(function (r) {
      return String((r && r.id) || "").toLowerCase().indexOf(needle) !== -1;
    });
  }

  /* _rankable: true when a human decimal string parses via
   * Format.parsePriceRatio (money rule — the single validity gate for
   * sorting). Unparseable legs always sink last, ascending OR descending.
   * @param {any} s
   * @returns {boolean} */
  function _rankable(s) {
    if (s === undefined || s === null || String(s) === "") return false;
    try {
      if (typeof Format === "undefined" || !Format ||
          typeof Format.parsePriceRatio !== "function") return false;
      Format.parsePriceRatio(String(s));
      return true;
    } catch (e) { return false; }
  }

  /** sortMarkets: NEW sorted array by key (chain order untouched).
   * Keys: vol_desc (chain default) / vol_asc / price_desc / price_asc /
   * change_desc / change_asc / market_az. Unknown key keeps chain order.
   * Unparseable legs sink last in EVERY direction (descending flips values,
   * never junk). Stable for ties.
   * @param {any[]} rows
   * @param {string} key
   * @returns {any[]} */
  function sortMarkets(rows, key) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    function byVol(r) { return r ? r.baseVol : null; }
    function byPrice(r) { return r ? r.latest : null; }
    function byChange(r) { return r ? r.change : null; }
    /* dirCmp(get, dir): ascending (dir=1) or descending (dir=-1) compare
     * with junk-last in both directions. */
    function dirCmp(get, dir) {
      return function (x, y) {
        var a = get(x), b = get(y);
        var pa = _rankable(a), pb = _rankable(b);
        if (!pa && !pb) return 0;
        if (!pa) return 1;
        if (!pb) return -1;
        return dir * cmpDec(a, b);
      };
    }
    if (key === "vol_asc") {
      list.sort(dirCmp(byVol, 1));
    } else if (key === "price_desc") {
      list.sort(dirCmp(byPrice, -1));
    } else if (key === "price_asc") {
      list.sort(dirCmp(byPrice, 1));
    } else if (key === "change_desc") {
      list.sort(dirCmp(byChange, -1));
    } else if (key === "change_asc") {
      list.sort(dirCmp(byChange, 1));
    } else if (key === "market_az") {
      list.sort(function (x, y) {
        var a = String((x && x.id) || ""), b = String((y && y.id) || "");
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });
    } else if (key === "vol_desc" || !key) {
      /* Chain already returns reverse base_volume; re-sort to pin the
       * contract (unparseable volumes sink last instead of floating). */
      list.sort(dirCmp(byVol, -1));
    }
    return list;
  }

  /* marketsTab: most-active-markets overview (database get_top_markets, :643).
   * #4 CONTRACT (mapping-chain-calls, #4 wins): get_top_markets(uint32_t
   *   limit) is EXPERIMENTAL and capped at api_limit_get_top_markets = 100
   *   (application.hpp:56); it returns vector<market_ticker> sorted by
   *   reverse base_volume (database_api.hpp:639-646). market_ticker legs are
   *   HUMAN strings (api_objects.hpp:112-138: latest, lowest_ask/highest_bid
   *   + sizes, percent_change, base/quote_volume) — rendered verbatim, never
   *   parsed for display. No new WS methods: this tab calls get_top_markets
   *   once + the existing per-row Asset.describe symbol join (fail-open per
   *   row: id fallback, a row never drops the volume the chain reported).
   *   Filter (QUOTE_BASE substring) + sort (volume desc = chain order,
   *   price/change/market client-side via cmpDec BigInt compare) run on the
   *   fetched sample only — the sample stays honestly labeled experimental. */
  function marketsTab(doc, body, live) {
    body.appendChild(el(doc, "p", "Loading top markets…", "muted"));
    Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_top_markets", [20]);
    }).then(function (rows) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      if (!rows || !rows.length) {
        body.appendChild(el(doc, "p", "No markets found.", "muted"));
        return;
      }
      var pend = rows.slice(0, 20).map(function (m) {
        return { m: m, quote: null, base: null };
      });
      function sym(id) {
        if (typeof Asset !== "undefined" && Asset && typeof Asset.describe === "function") {
          return Asset.describe(id).then(function (a) { return a.symbol; }).catch(function () { return String(id); });
        }
        return Promise.resolve(String(id));
      }
      var jobs = [];
      pend.forEach(function (r) {
        jobs.push(sym(r.m.quote).then(function (s) { r.quote = s; }));
        jobs.push(sym(r.m.base).then(function (s) { r.base = s; }));
      });
      return Promise.all(jobs).then(function () {
        if (!live()) return;
        /* Enriched rows: chain ticker strings verbatim (null where absent). */
        var enriched = pend.map(function (r) {
          var m = r.m || {};
          return {
            id: r.quote + "_" + r.base,
            latest: m.latest !== undefined && m.latest !== null ? String(m.latest) : null,
            bid: m.highest_bid !== undefined && m.highest_bid !== null ? String(m.highest_bid) : null,
            ask: m.lowest_ask !== undefined && m.lowest_ask !== null ? String(m.lowest_ask) : null,
            baseVol: m.base_volume !== undefined && m.base_volume !== null ? String(m.base_volume) : null,
            quoteVol: m.quote_volume !== undefined && m.quote_volume !== null ? String(m.quote_volume) : null,
            change: m.percent_change !== undefined && m.percent_change !== null ? String(m.percent_change) : null
          };
        });
        /* Honest sample label (experimental API, chain-sorted, verbatim). */
        body.appendChild(el(doc, "p", /** @type {any} */ (t)("explorer.markets_experimental", "Experimental get_top_markets sample — top 20 by base volume, chain-sorted desc; not a full market list. Values are chain human strings verbatim."), "muted"));
        /* Filter + sort controls (touch-sized, keyboard-native). */
        var ctl = doc.createElement("div");
        ctl.className = "xplore-ctl";
        var filter = doc.createElement("input");
        filter.type = "search";
        filter.setAttribute("placeholder", /** @type {any} */ (t)("explorer.markets_filter_ph", "Filter markets…"));
        filter.setAttribute("aria-label", /** @type {any} */ (t)("explorer.markets_filter_ph", "Filter markets…"));
        touchable(filter);
        filter.classList.add("subtle-btn");
        ctl.appendChild(filter);
        var sortLab = el(doc, "span", /** @type {any} */ (t)("explorer.markets_sort_label", "Sort") + " ");
        ctl.appendChild(sortLab);
        var sortSel = doc.createElement("select");
        sortSel.setAttribute("aria-label", /** @type {any} */ (t)("explorer.markets_sort_label", "Sort"));
        touchable(sortSel);
        sortSel.classList.add("subtle-btn");
        [["vol_desc", "explorer.markets_sort_vol_desc", "Volume ↓"],
         ["vol_asc", "explorer.markets_sort_vol_asc", "Volume ↑"],
         ["price_desc", "explorer.markets_sort_price_desc", "Price ↓"],
         ["price_asc", "explorer.markets_sort_price_asc", "Price ↑"],
         ["change_desc", "explorer.markets_sort_change_desc", "Change ↓"],
         ["change_asc", "explorer.markets_sort_change_asc", "Change ↑"],
         ["market_az", "explorer.markets_sort_market_az", "Market A–Z"]].forEach(function (opt) {
          var o = doc.createElement("option");
          o.value = opt[0];
          o.textContent = /** @type {any} */ (t)(opt[1], opt[2]);
          sortSel.appendChild(o);
        });
        ctl.appendChild(sortSel);
        body.appendChild(ctl);
        var count = el(doc, "p", "", "muted");
        count.setAttribute("aria-live", "polite");
        body.appendChild(count);
        var tbl = table(doc, ["Market", "Price", "Bid", "Ask", "Vol (base)", "Vol (quote)", "Change"]);
        body.appendChild(tbl.table);
        var emptyNote = el(doc, "p", /** @type {any} */ (t)("explorer.markets_empty_filter", "No markets match this filter."), "muted");
        emptyNote.style.display = "none";
        body.appendChild(emptyNote);
        /* paint: filter + sort the fetched sample, repaint rows + count. */
        function paint() {
          var q = filter.value || "";
          var key = sortSel.value || "vol_desc";
          var view = sortMarkets(filterMarkets(enriched, q), key);
          while (tbl.tbody.firstChild) tbl.tbody.removeChild(tbl.tbody.firstChild);
          view.forEach(function (r) {
            var tr = doc.createElement("tr");
            var td = doc.createElement("td");
            var a = link(doc, "#/market/" + encodeURIComponent(r.id), r.id);
            td.appendChild(a);
            tr.appendChild(td);
            tr.appendChild(el(doc, "td", r.latest === null ? "—" : r.latest));
            tr.appendChild(el(doc, "td", r.bid === null ? "—" : r.bid));
            tr.appendChild(el(doc, "td", r.ask === null ? "—" : r.ask));
            tr.appendChild(el(doc, "td", r.baseVol === null ? "—" : r.baseVol));
            tr.appendChild(el(doc, "td", r.quoteVol === null ? "—" : r.quoteVol));
            tr.appendChild(el(doc, "td", r.change === null ? "—" : r.change));
            tbl.tbody.appendChild(tr);
          });
          emptyNote.style.display = view.length === 0 ? "" : "none";
          count.textContent = /** @type {any} */ (t)("explorer.markets_showing", "Showing") + " " +
            view.length + " " + /** @type {any} */ (t)("explorer.markets_of", "of") + " " + enriched.length;
        }
        filter.addEventListener("input", paint);
        sortSel.addEventListener("change", paint);
        paint();
        body.appendChild(el(doc, "p", /** @type {any} */ (t)("explorer.thin_summary_top_20_by_volume_full_orde", "Thin summary (top 20 by volume) — full order books, charts and trading live on each market page."), "muted"));
      });
    }).catch(function (e) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      errBox(doc, body, (e && e.message) || "Could not load top markets.");
    });
  }

  /* feesTab: the shared fee tables (FeesUI.renderTables — the single fee
   * renderer every surface mounts; the old compact fork is gone). */
  function feesTab(doc, body, live) {
    void live;
    if (typeof FeesUI !== "undefined" && FeesUI &&
        typeof FeesUI.renderTables === "function") {
      try {
        FeesUI.renderTables(doc, body);
      } catch (e) {
        errBox(doc, body, (e && e.message) || "Could not load fees.");
      }
    } else {
      errBox(doc, body, "Fee backend missing: js/views/fees-ui.js failed to load.");
    }
  }

  return {
    poolsTab: poolsTab, accountsTab: accountsTab,
    witnessesTab: witnessesTab, committeeTab: committeeTab,
    marketsTab: marketsTab, feesTab: feesTab,
    _test: { filterMarkets: filterMarkets, sortMarkets: sortMarkets, cmpDec: cmpDec, accountLinkTarget: accountLinkTarget }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.ExplorerTabs === "undefined") { globalThis.ExplorerTabs = ExplorerTabs; }
if (typeof module !== "undefined") { module.exports = ExplorerTabs; }
