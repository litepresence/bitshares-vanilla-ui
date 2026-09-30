/* ExplorerAssets: asset views for the explorer (tables + #/asset/:symbol).
 * Owns: the Assets tab table (25/page lower-bound paging), the Feeds tab
 *   (smartcoin scan), #/asset/:symbol (human supply/fees + feed section +
 *   fee-pool FUND form op 16 with review + unlock-at-sign + pool-delta
 *   re-read proof), plus the pctHundredths/ratio1000/lifetimeText helpers. The generic
 *   value-rendering layer (fieldRow/fillValue/opSection/renderObjectPanel,
 *   amount/price spans, account/asset/object links) moved to
 *   js/explorer-render.js (ExplorerRender, slice-18 split) — this file
 *   reaches it for issuer links + feed rows and re-exports three aliases
 *   (opSection/accountLink/renderObjectPanel) so explorer-blocks.js +
 *   explorer-ui.js keep working unchanged. All moved verbatim from
 *   explorer-ui.js except the generation-counter and shell-navigation
 *   references (see delegates).
 * Consumes: Explorer.asset/assetsPage/feeds/resolveObject (read-only, via
 *   global), Account.resolve (account-name links, via ExplorerRender),
 *   Format.formatAmount/formatPrice (money math only — never float, never
 *   inline Math.pow), ExplorerRender.fieldRow/accountLink (generic rows),
 *   ExplorerUI._bumpGen/_isCurrent/_waitForOpen/_setPending/renderExplorer
 *   (single generation counter, connect gate, and pending-object shell live
 *   in explorer-ui.js, which loads AFTER this file — all lookups lazy).
 * Globals/side effects: DOM under the given parent/root only; global
 *   ExplorerAssets only. Tiny DOM helpers (el/touchable/clearRoot/makeWrap/
 *   anchor/showError/showStatus/scrollTable) are private verbatim copies of
 *   the explorer-ui.js originals (same per-file convention as the market-ui
 *   split) so moved bodies stay byte-identical.
 * MONEY DISCIPLINE (principle #6): every amount through
 *   Format.formatAmount(raw, precision); every price pair through
 *   Format.formatPrice(base, basePrec, quote, quotePrec, 8) with BOTH
 *   precisions; market-fee-style percents from hundredths ints (2000->20%)
 *   and MCR/MSSR ratios from thousandths ints (1100->1.1x, the #1
 *   Asset.jsx:738-748 convention) via BigInt/string math — never float,
 *   never inline Math.pow. Raw ints stay in `title` attributes only.
 * Created by: building-vanilla-slices skill, slice-09 repair (explorer-ui split);
 *   value layer split OUT to explorer-render.js in the slice-18 audit.
 */
var ExplorerAssets = (function () {
  "use strict";
  /* Batch-2c i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws.
   * Dynamic sentences keep their code structure (batch-2b precedent): only
   * complete static literals are wrapped, values and punctuation glue stay
   * raw, so every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }


  var ASSETS_PAGE = 25; /* #1 Assets.jsx 25/page default (rows-per-page overrides) */
  var FEED_SCAN_PAGES = 4; /* asset pages scanned for smartcoins */
  var FEED_MAX = 10; /* smartcoins shown on the Feeds tab */
  var PRICE_PLACES = 8; /* market.js/market-orders.js convention (mirrors ExplorerRender.PRICE_PLACES) */
  var CORE_PRECISION = 5; /* fee_pool lives in core asset (asset_object.hpp:65;
   * GRAPHENE_BLOCKCHAIN_PRECISION = 10^5, config.hpp:29-30; same const as
   * ExplorerRender.CORE_PRECISION — never the funded asset's precision) */
  var ACCT_RE = /^1\.2\.\d+$/; /* issuer-id check for account links (mirrors ExplorerRender's copy) */

  /* Assets-tab UI state (punchlist HIGHs, #1 Assets.jsx:432-490 concepts):
   * mode market|user|prediction (default market = SmartCoins), q text filter,
   * perPage 10/25/50/100, sortKey symbol|issuer|supply + dir 1|-1. Module-level
   * so Next/Prev page turns keep the user's filter/sort (shell re-invokes
   * assetsTab with new lower/stack but same state). Plain literals for new
   * labels (no new t() keys) so check_i18n stays green without touching
   * vanilla/locales/* — file-scope punchlist constraint. */
  var assetState = { mode: "market", q: "", perPage: 25, sortKey: "symbol", sortDir: 1 };
  var ROW_OPTIONS = [10, 25, 50, 100];

  /* Permission/flag bit labels (chain truth: protocol/types.hpp
   * asset_issuer_permission_flags). Duplicated plain list per doctrine rule 5
   * (no shared-DOM-util module may grow) — same source as asset-ui.js
   * PERMS/FLAGS, extended with the disable-bits for the detail page. */
  var PERM_LABELS = [[1, "charge fee"], [2, "whitelist"], [4, "override"],
    [8, "restricted"], [16, "no force settle"], [32, "global settle"],
    [64, "no confidential"], [128, "witness-fed"], [256, "committee-fed"],
    [512, "lock max supply"], [1024, "disable new supply"],
    [2048, "disable mcr update"], [4096, "disable icr update"],
    [8192, "disable mssr update"], [16384, "disable bsrm update"],
    [32768, "disable collateral bidding"]];

  /* Bit int -> "a, b" label list, "(none)" when empty; "" on garbage. */
  function flagBitNames(v) {
    var n = parseInt(String(v), 10);
    if (!(n >= 0)) return "";
    var out = [];
    PERM_LABELS.forEach(function (p) { if (n & p[0]) out.push(p[1]); });
    return out.length ? out.join(", ") : "(none)";
  }

  /* Preferred market id SYMBOL_QUOTE (#1 Assets.jsx:240-247 + Asset.jsx:366-379
   * simplified): description.market when the issuer set JSON {market}, else
   * BTS; self-markets fall back to USD (BTS_BTS would be invalid — #1 uses
   * USD for the core asset). Short-backing-asset lookup for MPAs needs an
   * extra get_assets round trip per row — deferred to keep the tab read-only
   * with no new chain surface; description.market covers the UIA case that
   * matters here. */
  function marketIdFor(symbol, descStr) {
    var quote = "BTS";
    try {
      if (typeof descStr === "string" && descStr.indexOf("{") !== -1) {
        var p = JSON.parse(descStr);
        if (p && typeof p.market === "string" && p.market) quote = p.market;
      }
    } catch (e) { /* fallback stands */ }
    if (typeof symbol === "string" && symbol === quote) quote = "USD";
    return symbol + "_" + quote;
  }

  /* Description JSON -> {main, market, shortName}: {main: raw} when plain
   * text or bad JSON (#1 asset_utils.parseDescription concept, without the
   * sanitizer dep — textContent at render is the XSS boundary). */
  function parseDesc(descStr) {
    if (typeof descStr !== "string" || !descStr) return { main: "", market: "", shortName: "" };
    try {
      var p = JSON.parse(descStr);
      if (p && typeof p === "object" && !Array.isArray(p)) {
        return { main: typeof p.main === "string" ? p.main : descStr,
          market: typeof p.market === "string" ? p.market : "",
          shortName: typeof p.short_name === "string" ? p.short_name : "" };
      }
    } catch (e) { /* plain text below */ }
    return { main: descStr, market: "", shortName: "" };
  }


  /* Local fallback counter, used ONLY when explorer-ui.js failed to load
   * (impossible in the shipped app — script tags are load-bearing). In
   * practice every bump/check below reaches the shell's single counter, so
   * stale async work bails across routes instead of touching detached DOM. */
  var localGen = 0;

  /* Single generation counter (shell-owned): every route entry bumps it;
   * async continuations bail when their generation no longer matches. */
  function bumpGen() {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._bumpGen === "function") return ExplorerUI._bumpGen();
    localGen += 1;
    return localGen;
  }

  /* True while myGen is still the latest route entry. */
  function isCurrent(myGen) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._isCurrent === "function") return ExplorerUI._isCurrent(myGen);
    return myGen === localGen;
  }

  /* Connect gate (canonical implementation in explorer-ui.js): when the
   * socket is cold it paints the connecting/offline panel and returns true
   * (caller must stop). Falls through when the shell is missing — chain
   * calls then fail into the honest error panels below, never blank. */
  function waitForOpen(doc, wrap, root, myGen, rerun) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._waitForOpen === "function") {
      return ExplorerUI._waitForOpen(doc, wrap, root, myGen, rerun);
    }
    return false;
  }

  /* Create an element with optional text + class (textContent only — user
   * and chain strings never reach innerHTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch target floor (principle #7): interactive elements are >=44px in
   * at least one dimension. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  /* Wide (viewport-gaps fix 2026-09-28): full-bleed stacked grid
   * ≥1200px; children span full width via app.css .wide contract. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  function anchor(doc, text, href) {
    var a = el(doc, "a", text);
    a.setAttribute("href", href);
    touchable(a);
    a.style.display = "inline-block";
    return a;
  }

  /* Inline error panel that is never blank: thrown values map to human
   * sentences; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var box = el(doc, "div", null, "error");
    box.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message : String(e || fallback || t("explorer.unexpected", "Unexpected error"));
    if (msg.indexOf("unknown-block") !== -1) msg = t("explorer.unknown_block", "Unknown block.");
    else if (msg.indexOf("unknown-tx") !== -1) msg = t("explorer.unknown_tx", "Unknown transaction.");
    else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || t("explorer.unknown_asset", "Unknown asset.");
    else if (msg.indexOf("unknown-object") !== -1) msg = fallback || t("explorer.not_found", "Nothing found for that search.");
    else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = t("explorer.tx_expired", "Transaction hash lookup covers recent transactions only — this one is expired or unknown.");
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = t("explorer.offline", "Network unavailable. Check Settings → Nodes and retry.");
    }
    box.textContent = msg;
    wrap.appendChild(box);
    return box;
  }

  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted");
    p.setAttribute("aria-live", "polite");
    wrap.appendChild(p);
    return p;
  }

  /* Hundredths int string -> "20%" (2000), "20.5%" (2050); "" on garbage. */
  function pctHundredths(raw) {
    if (!/^\d+$/.test(String(raw || ""))) return "";
    var v = BigInt(String(raw));
    var whole = (v / 100n).toString();
    var frac = (v % 100n).toString().padStart(2, "0").replace(/0+$/, "");
    return frac ? whole + "." + frac + "%" : whole + "%";
  }

  /* Thousandths ratio int -> "1.1×" (1100), "1.75×" (1750); "" on garbage. */
  function ratio1000(raw) {
    if (!/^\d+$/.test(String(raw || ""))) return "";
    var v = BigInt(String(raw));
    var whole = (v / 1000n).toString();
    var frac = (v % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
    return frac ? whole + "." + frac + "×" : whole + "×";
  }

  /* Seconds int -> "24 hours" when whole, else "90 seconds". */
  function lifetimeText(raw) {
    if (!/^\d+$/.test(String(raw || ""))) return String(raw);
    var s = parseInt(String(raw), 10);
    if (s % 3600 === 0) return (s / 3600) + t("explorer.hours_unit", " hours");
    if (s % 60 === 0) return (s / 60) + t("explorer.minutes_unit", " minutes");
    return s + t("explorer.seconds_unit", " seconds");
  }

  /* Scrollable table shell (principle #7: dense tables scroll horizontally
   * on phones instead of squeezing; no new CSS — inline overflow only). */
  function scrollTable(doc, headers, rows) {
    var scroller = el(doc, "div", null, "xplore-scroll");
    scroller.style.overflowX = "auto";
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    headers.forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = doc.createElement("tbody");
    rows.forEach(function (cells) {
      var tr = doc.createElement("tr");
      cells.forEach(function (c) {
        var td = doc.createElement("td");
        if (typeof c === "string") td.textContent = c;
        else if (c) td.appendChild(c);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    scroller.appendChild(table);
    return scroller;
  }


  /* Assets tab: filterable/sortable table (Symbol, Issuer, Supply human +
   *   Market link) with lower-bound paging (Next/Prev stack, Reference #18
   *   pattern). Concepts from #1 Assets.jsx:432-490: text filter + radio
   *   SmartCoins(User=market)/User-Issued/Prediction + rows-per-page
   *   10/25/50/100; columns from Assets.jsx:151-334 (symbol/issuer/supply
   *   sortable + marketId link). DEFERRED: prediction LIST view (antd List
   *   with condition/expiry — table covers filtering; list polish deferred).
   *   Supply fix: dynamics are 2.3.x implementation objects — explorer.js
   *   resolveObject now accepts space 2 (was space-1 only, hence dashes).
   *   Bitasset 2.4.x joins ride the same flow for the prediction filter. */
  function assetsTab(doc, body, root, myGen, lower, stack) {
    while (body.firstChild) body.removeChild(body.firstChild);
    /* Filter bar (rebuilt per page turn with state values preserved; table
     * repaints below it so typing never loses focus). New labels are plain
     * literals (no new t() keys) per the file-scope i18n note above. */
    var bar = el(doc, "div", null, "xplore-filters");
    /* Inline flex (no new CSS): wraps on 360px phones, one row on desktop.
     * Principle #7 — no hover-dependent UI, everything tap-sized. */
    try {
      bar.style.display = "flex"; bar.style.flexWrap = "wrap";
      bar.style.gap = "8px 16px"; bar.style.alignItems = "center";
      bar.style.marginBottom = "8px";
    } catch (e) { /* styling only */ }
    var search = doc.createElement("input");
    search.type = "search";
    search.value = assetState.q || "";
    search.setAttribute("placeholder", t("explorer.filter_by_symbol", "Filter by symbol…"));
    search.setAttribute("aria-label", t("explorer.filter_assets_by_symbol", "Filter assets by symbol"));
    touchable(search);
    search.style.minWidth = "180px";
    bar.appendChild(search);
    var modes = [["market", "SmartCoins"], ["user", "User-Issued"], ["prediction", "Prediction"]];
    var radioWrap = el(doc, "span", null, "xplore-radios");
    radioWrap.setAttribute("role", "radiogroup");
    radioWrap.setAttribute("aria-label", t("explorer.asset_type_filter", "Asset type filter"));
    modes.forEach(function (m) {
      var lab = el(doc, "label", null, "xplore-radio");
      touchable(lab);
      var inp = doc.createElement("input");
      inp.type = "radio";
      inp.name = "xplore-asset-filter";
      inp.value = m[0];
      if (assetState.mode === m[0]) inp.checked = true;
      inp.addEventListener("change", function () {
        assetState.mode = m[0];
        paintCached();
      });
      lab.appendChild(inp);
      lab.appendChild(el(doc, "span", " " + m[1]));
      radioWrap.appendChild(lab);
    });
    bar.appendChild(radioWrap);
    var perLab = el(doc, "label", t("explorer.rows", " Rows "));
    var perSel = doc.createElement("select");
    perSel.setAttribute("aria-label", t("explorer.rows_per_page", "Rows per page"));
    touchable(perSel);
    ROW_OPTIONS.forEach(function (n) {
      var opt = doc.createElement("option");
      opt.value = String(n);
      opt.textContent = String(n) + " rows";
      if (assetState.perPage === n) opt.selected = true;
      perSel.appendChild(opt);
    });
    perSel.addEventListener("change", function () {
      var n = parseInt(perSel.value, 10);
      if (ROW_OPTIONS.indexOf(n) === -1) n = 25;
      if (n === assetState.perPage) return;
      assetState.perPage = n;
      assetsTab(doc, body, root, myGen, "", []);
    });
    perLab.appendChild(perSel);
    bar.appendChild(perLab);
    body.appendChild(bar);
    var tableWrap = el(doc, "div", null, "xplore-tablewrap");
    body.appendChild(tableWrap);
    var navWrap = el(doc, "div", null, "xplore-nav");
    body.appendChild(navWrap);
    var allRows = null; /* enriched rows for client-side filter/sort */
    var lastRows = []; /* raw page rows for Next paging */
    showStatus(doc, tableWrap, t("explorer.loading_assets", "Loading assets…"));
    search.addEventListener("input", function () {
      assetState.q = search.value || "";
      paintCached();
    });
    function enrichAndStore(rows) {
      lastRows = rows || [];
      var supplyOf = {};
      var predById = {};
      var dynIds = [], bitIds = [];
      (rows || []).forEach(function (a) {
        if (!a) return;
        if (typeof a.dynamic_asset_data_id === "string") dynIds.push(a.dynamic_asset_data_id);
        if (typeof a.bitasset_data_id === "string") bitIds.push(a.bitasset_data_id);
      });
      function finish() {
        allRows = (rows || []).map(function (a) {
          var isSmart = !!(a && a.bitasset_data_id);
          return { a: a, supplyRaw: supplyOf[a.id] !== undefined ? supplyOf[a.id] : null,
            isSmart: isSmart, isPrediction: predById[a.id] === true,
            marketID: marketIdFor(a.symbol, a.options && a.options.description) };
        });
        paintCached();
      }
      var jobs = [];
      if (dynIds.length > 0) {
        jobs.push(Promise.all(dynIds.map(function (id) {
          return Explorer.resolveObject(id).then(function (e) { return e.object; }).catch(function () { return null; });
        })).then(function (objs) {
          var byId = {};
          dynIds.forEach(function (id, i) { byId[id] = objs[i]; });
          (rows || []).forEach(function (a) {
            var o = a && byId[a.dynamic_asset_data_id];
            if (o && o.current_supply !== undefined && o.current_supply !== null) supplyOf[a.id] = String(o.current_supply);
          });
        }));
      }
      if (bitIds.length > 0) {
        jobs.push(Promise.all(bitIds.map(function (id) {
          return Explorer.resolveObject(id).then(function (e) { return e.object; }).catch(function () { return null; });
        })).then(function (objs) {
          var byId = {};
          bitIds.forEach(function (id, i) { byId[id] = objs[i]; });
          (rows || []).forEach(function (a) {
            var o = a && a.bitasset_data_id && byId[a.bitasset_data_id];
            if (o && o.is_prediction_market === true) predById[a.id] = true;
          });
        }));
      }
      if (jobs.length === 0) { finish(); return; }
      Promise.all(jobs).then(function () {
        if (!isCurrent(myGen)) return;
        finish();
      }).catch(function () {
        if (!isCurrent(myGen)) return;
        finish();
      });
    }
    function filteredSorted() {
      var q = (assetState.q || "").toUpperCase();
      var out = (allRows || []).filter(function (r) {
        if (!r || !r.a) return false;
        if (assetState.mode === "market" && !(r.isSmart && !r.isPrediction)) return false;
        if (assetState.mode === "user" && r.isSmart) return false;
        if (assetState.mode === "prediction" && !(r.isSmart && r.isPrediction)) return false;
        if (q && String(r.a.symbol || "").toUpperCase().indexOf(q) === -1) return false;
        return true;
      });
      var k = assetState.sortKey, d = assetState.sortDir >= 0 ? 1 : -1;
      out.sort(function (x, y) {
        var c = 0;
        if (k === "issuer") {
          var xi = String((x.a && x.a.issuer) || ""), yi = String((y.a && y.a.issuer) || "");
          c = xi < yi ? -1 : xi > yi ? 1 : 0;
        } else if (k === "supply") {
          var xs = x.supplyRaw, ys = y.supplyRaw;
          if (xs === null && ys === null) c = 0;
          else if (xs === null) c = 1;
          else if (ys === null) c = -1;
          else {
            try {
              var xb = BigInt(String(xs)), yb = BigInt(String(ys));
              c = xb < yb ? -1 : xb > yb ? 1 : 0;
            } catch (e) { c = String(xs) < String(ys) ? -1 : String(xs) > String(ys) ? 1 : 0; }
          }
        } else {
          var xa = String((x.a && x.a.symbol) || ""), ya = String((y.a && y.a.symbol) || "");
          c = xa < ya ? -1 : xa > ya ? 1 : 0;
        }
        return c * d;
      });
      return out;
    }
    function sortMark(key) {
      if (assetState.sortKey !== key) return "";
      return assetState.sortDir >= 0 ? " ▲" : " ▼";
    }
    function paintCached() {
      if (!isCurrent(myGen)) return;
      if (!allRows) return;
      while (tableWrap.firstChild) tableWrap.removeChild(tableWrap.firstChild);
      while (navWrap.firstChild) navWrap.removeChild(navWrap.firstChild);
      var view = filteredSorted();
      if (view.length === 0) {
        tableWrap.appendChild(el(doc, "p", t("explorer.no_assets", "No assets on this page."), "muted"));
      } else {
        var scroller = el(doc, "div", null, "xplore-scroll");
        scroller.style.overflowX = "auto";
        var table = doc.createElement("table");
        table.className = "node-table";
        /* Inline opt-out of the global phone hide (app.css hides .node-table
         * <560px expecting card fallbacks; pools-scroll precedent restores
         * with CSS — file-scoped punchlist restores inline so the scouted
         * horizontal scroller above keeps the table legible on 360px phones
         * with no CSS touch). Principle #7: scroll, never vanish. */
        try { table.style.display = "table"; } catch (e) { /* stylesheet stands */ }
        var thead = doc.createElement("thead");
        var hr = doc.createElement("tr");
        function sortTh(key, label) {
          var th = doc.createElement("th");
          th.setAttribute("scope", "col");
          if (isCurrent(myGen)) th.setAttribute("aria-sort",
            assetState.sortKey === key ? (assetState.sortDir >= 0 ? "ascending" : "descending") : "none");
          var b = touchable(el(doc, "button", label + sortMark(key)));
          b.type = "button";
          b.addEventListener("click", function () {
            if (assetState.sortKey === key) assetState.sortDir = -assetState.sortDir;
            else { assetState.sortKey = key; assetState.sortDir = 1; }
            paintCached();
          });
          th.appendChild(b);
          return th;
        }
        hr.appendChild(sortTh("symbol", t("explorer.th_symbol", "Symbol")));
        hr.appendChild(sortTh("issuer", t("explorer.th_issuer", "Issuer")));
        hr.appendChild(sortTh("supply", t("explorer.th_supply", "Supply")));
        hr.appendChild(el(doc, "th", t("explorer.market_3", "Market")));
        thead.appendChild(hr);
        table.appendChild(thead);
        var tb = doc.createElement("tbody");
        view.forEach(function (r) {
          var a = r.a;
          var tr = doc.createElement("tr");
          var tdS = doc.createElement("td");
          var sym = anchor(doc, a.symbol, "#/asset/" + a.symbol);
          sym.title = a.id;
          tdS.appendChild(sym);
          tr.appendChild(tdS);
          var tdI = doc.createElement("td");
          var issuer = (typeof a.issuer === "string" && ACCT_RE.test(a.issuer))
            ? ExplorerRender.accountLink(doc, a.issuer, myGen) : el(doc, "span", String(a.issuer));
          if (typeof issuer === "string") tdI.textContent = issuer;
          else tdI.appendChild(issuer);
          tr.appendChild(tdI);
          var tdP = doc.createElement("td");
          if (r.supplyRaw !== undefined && r.supplyRaw !== null) {
            try {
              tdP.textContent = Format.formatAmount(String(r.supplyRaw), a.precision);
              tdP.title = String(r.supplyRaw);
            } catch (e) { tdP.textContent = String(r.supplyRaw); }
          } else tdP.textContent = "—";
          tr.appendChild(tdP);
          var tdM = doc.createElement("td");
          var ml = anchor(doc, t("explorer.market_3", "Market"), "#/market/" + r.marketID);
          ml.title = r.marketID;
          tdM.appendChild(ml);
          tr.appendChild(tdM);
          tb.appendChild(tr);
        });
        table.appendChild(tb);
        scroller.appendChild(table);
        tableWrap.appendChild(scroller);
      }
      if ((stack || []).length > 0) {
        var prev = touchable(el(doc, "button", t("explorer.prev", "← Prev")));
        prev.type = "button";
        prev.addEventListener("click", function () {
          var back = (stack || []).slice(0, -1);
          var to = (stack || [])[(stack || []).length - 1];
          assetsTab(doc, body, root, myGen, to === undefined ? "" : to, back);
        });
        navWrap.appendChild(prev);
      }
      if (lastRows.length >= assetState.perPage && lastRows.length > 0) {
        var next = touchable(el(doc, "button", t("explorer.next", "Next →")));
        next.type = "button";
        next.addEventListener("click", function () {
          assetsTab(doc, body, root, myGen, lastRows[lastRows.length - 1].symbol, (stack || []).concat([lower]));
        });
        navWrap.appendChild(next);
      }
    }
    Explorer.assetsPage(lower, assetState.perPage).then(function (rows) {
      if (!isCurrent(myGen)) return;
      rows = rows || [];
      if (rows.length === 0 && (stack || []).length === 0 && !assetState.q) {
        while (tableWrap.firstChild) tableWrap.removeChild(tableWrap.firstChild);
        tableWrap.appendChild(el(doc, "p", t("explorer.no_assets", "No assets on this page."), "muted"));
        return;
      }
      enrichAndStore(rows);
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      while (tableWrap.firstChild) tableWrap.removeChild(tableWrap.firstChild);
      showError(doc, tableWrap, e, t("explorer.assets_failed", "Could not load assets."));
      var retry = touchable(el(doc, "button", t("explorer.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () {
        assetsTab(doc, body, root, myGen, lower, stack);
      });
      tableWrap.appendChild(retry);
    });
  }

  /* #/asset/:symbol: header + MARKET button (preferred market) +
   * ASSET INFO/ACTIONS tabs + asset-type/flags section + description box with
   * grouped amounts + feed section when is_smartcoin (both-precisions math)
   * else the "not a smartcoin" empty state. Concepts from #1 Asset.jsx:
   * AboutBox preferredMarket (description.market else core, self->USD),
   * Tabs info/actions (Asset.jsx:2337-2403), type/flags (asset_utils +
   * permission bits), description main/market (parseDescription). DEFERRED:
   * FEE POOL funding/claim panel (Asset.jsx renderFeePool* needs signing —
   * read-only explorer shows the fee-pool balance only) + prediction LIST
   * view (Assets.jsx:492- List with condition/expiry — table covers it). */
  function renderAsset(root, symbol) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = bumpGen();
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer) {
      showError(doc, wrap, t("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load."));
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderAsset(root, symbol); })) return;
    if (typeof symbol !== "string" || !symbol) {
      wrap.appendChild(el(doc, "h1", t("explorer.asset_title", "Asset")));
      showError(doc, wrap, new Error("unknown-asset"), t("explorer.unknown_asset", "Unknown asset."));
      return;
    }
    wrap.appendChild(el(doc, "h1", t("explorer.asset_prefix", "Asset ") + symbol));
    showStatus(doc, wrap, t("explorer.loading_asset", "Loading asset…"));
    Explorer.asset(symbol).then(function (j) {
      if (!isCurrent(myGen)) return;
      var a = j.asset, dyn = j.dynamic || {};
      var prec = a.precision;
      var bitObj = j.bitasset || null;
      var isSmart = !!j.is_smartcoin;
      var isPrediction = !!(bitObj && bitObj.is_prediction_market === true);
      var typeLabel = isPrediction ? "Prediction Market"
        : isSmart ? "SmartCoin (MPA)" : "User-Issued (UIA)";
      var descParsed = parseDesc(a.options && a.options.description);
      var marketID = marketIdFor(a.symbol, a.options && a.options.description);
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(el(doc, "h1", t("explorer.asset_prefix", "Asset ") + a.symbol));
      var marketBtn = anchor(doc, t("explorer.market_2", "MARKET →"), "#/market/" + marketID);
      marketBtn.title = marketID;
      marketBtn.setAttribute("aria-label", t("explorer.open_preferred_market", "Open preferred market ") + marketID);
      wrap.appendChild(marketBtn);
      /* Tabs (plain labels per file-scope i18n note; #1 Tabs info/actions). */
      var tabBar = el(doc, "div", null, "xplore-tabs");
      var infoBtn = touchable(el(doc, "button", t("explorer.asset_info", "ASSET INFO")));
      infoBtn.type = "button";
      var actBtn = touchable(el(doc, "button", t("explorer.actions", "ACTIONS")));
      actBtn.type = "button";
      tabBar.appendChild(infoBtn);
      tabBar.appendChild(actBtn);
      wrap.appendChild(tabBar);
      var infoBox = el(doc, "div", null, "xplore-tabinfo");
      var actBox = el(doc, "div", null, "xplore-tabact");
      actBox.style.display = "none";
      wrap.appendChild(infoBox);
      wrap.appendChild(actBox);
      function selectTab(which) {
        var info = which !== "actions";
        infoBox.style.display = info ? "" : "none";
        actBox.style.display = info ? "none" : "";
        try {
          infoBtn.setAttribute("aria-selected", info ? "true" : "false");
          actBtn.setAttribute("aria-selected", info ? "false" : "true");
          infoBtn.style.fontWeight = info ? "bold" : "";
          actBtn.style.fontWeight = info ? "" : "bold";
        } catch (e) { /* styling only */ }
      }
      infoBtn.addEventListener("click", function () { selectTab("info"); });
      actBtn.addEventListener("click", function () { selectTab("actions"); });
      selectTab("info");
      var dl = el(doc, "dl", null, "xplore-fields");
      function humanRowInto(target, term, raw) {
        target.appendChild(el(doc, "dt", term));
        var dd = doc.createElement("dd");
        if (raw === undefined || raw === null) dd.textContent = "—";
        else {
          try { dd.textContent = Format.formatAmount(String(raw), prec); }
          catch (e) { dd.textContent = String(raw); }
          dd.title = String(raw);
        }
        target.appendChild(dd);
      }
      /* Fee-pool row in CORE precision (not the asset precision above):
       * dyn.fee_pool funds fee payments in core asset (#1 FeePoolOperation
       * uses core precision; #2 shows feePoolBalance in CORE_PRECISION).
       * Using prec here would misplace the decimal on any p!=5 asset. */
      function coreRowInto(target, term, raw) {
        target.appendChild(el(doc, "dt", term));
        var dd = doc.createElement("dd");
        if (raw === undefined || raw === null) dd.textContent = "—";
        else {
          try { dd.textContent = Format.formatAmount(String(raw), CORE_PRECISION); }
          catch (e) { dd.textContent = String(raw); }
          dd.title = String(raw);
        }
        target.appendChild(dd);
      }
      dl.appendChild(el(doc, "dt", t("explorer.id_row", "ID")));
      var idDd = doc.createElement("dd");
      idDd.textContent = a.id;
      dl.appendChild(idDd);
      dl.appendChild(el(doc, "dt", t("explorer.issuer_row", "Issuer")));
      var issuerDd = doc.createElement("dd");
      issuerDd.appendChild((typeof a.issuer === "string" && ACCT_RE.test(a.issuer))
        ? ExplorerRender.accountLink(doc, a.issuer, myGen) : el(doc, "span", String(a.issuer)));
      dl.appendChild(issuerDd);
      dl.appendChild(el(doc, "dt", t("explorer.precision_row", "Precision")));
      var pDd = doc.createElement("dd");
      pDd.textContent = String(prec);
      dl.appendChild(pDd);
      dl.appendChild(el(doc, "dt", t("explorer.asset_type", "Asset type")));
      var tyDd = doc.createElement("dd");
      tyDd.textContent = typeLabel;
      dl.appendChild(tyDd);
      infoBox.appendChild(dl);
      /* Asset-type/flags section (chain truth: protocol/types.hpp permission
       * bits; raw ints in titles, human lists via flagBitNames). */
      infoBox.appendChild(el(doc, "h3", t("explorer.asset_type_and_permissions", "Asset type and permissions")));
      var dlF = el(doc, "dl", null, "xplore-fields");
      function flagRow(term, raw) {
        dlF.appendChild(el(doc, "dt", term));
        var dd = doc.createElement("dd");
        var names = flagBitNames(raw);
        dd.textContent = names || "—";
        dd.title = String(raw);
        dlF.appendChild(dd);
      }
      flagRow("Permissions", a.options && a.options.issuer_permissions);
      flagRow("Flags", a.options && a.options.flags);
      var feeDd = doc.createElement("dd");
      var feeKey = a.options && a.options.market_fee_percent;
      if (feeKey !== undefined && /^\d+$/.test(String(feeKey))) {
        feeDd.textContent = pctHundredths(String(feeKey));
        feeDd.title = String(feeKey);
      } else feeDd.textContent = "—";
      dlF.appendChild(el(doc, "dt", t("explorer.market_fee", "Market fee")));
      dlF.appendChild(feeDd);
      infoBox.appendChild(dlF);
      /* Description box with grouped amounts (main text + short_name +
       * max/current/fees/fee-pool human — #1 AboutBox + Summary grouped). */
      var descBox = el(doc, "div", null, "xplore-descbox");
      descBox.appendChild(el(doc, "h3", t("explorer.description", "Description")));
      var mainText = (descParsed.main && descParsed.main.trim())
        ? descParsed.main : "(no description)";
      descBox.appendChild(el(doc, "p", mainText));
      if (descParsed.shortName) descBox.appendChild(el(doc, "p", t("explorer.short", "Short: ") + descParsed.shortName));
      if (descParsed.market) descBox.appendChild(el(doc, "p", t("explorer.market", "Market: ") + descParsed.market));
      var dl2 = el(doc, "dl", null, "xplore-fields");
      descBox.appendChild(dl2);
      humanRowInto(dl2, t("explorer.max_supply", "Max supply"), a.options && a.options.max_supply);
      humanRowInto(dl2, t("explorer.current_supply", "Current supply"), dyn.current_supply);
      humanRowInto(dl2, t("explorer.accumulated_fees", "Accumulated fees"), dyn.accumulated_fees);
      coreRowInto(dl2, t("explorer.fee_pool", "Fee pool"), dyn.fee_pool);
      infoBox.appendChild(descBox);
      /* ACTIONS tab: market/transfer links + live fee-pool FUND form (op 16).
       * RESOLVED (was deferred): funding now signs locally via AssetOps +
       * Tx like the asset-manage flows (review + unlock-at-sign + pool-delta
       * re-read proof). Claiming (ops 43/47) stays deferred honestly — no
       * serializer or form for it here. Concepts from #1 Asset.jsx
       * renderFeePoolFunding + FeePoolOperation fund path and #2
       * AssetIssuerActions fund-fee-pool dialog (current pool + amount +
       * confirm); vanilla uses named confirm rows, never raw JSON. */
      actBox.appendChild(el(doc, "h3", t("explorer.asset_actions", "Asset actions")));
      var mLink = anchor(doc, t("explorer.open_market", "Open market ") + marketID, "#/market/" + marketID);
      mLink.title = marketID;
      actBox.appendChild(mLink);
      actBox.appendChild(el(doc, "p", t("explorer.trade_and_transfer_this_asset_from_its_prefer", "Trade and transfer this asset from its preferred market."), "muted"));
      var tLink = anchor(doc, t("explorer.transfer", "Transfer ") + a.symbol, "#/transfer");
      tLink.title = t("explorer.pill_transfer", "Transfer");
      actBox.appendChild(tLink);
      /* Fund-fee-pool form (op 16) — anyone may fund any asset's pool with
       * CORE. Reads are public; the password is asked ONLY at signing
       * (publish gates on the fresh WIF, same as asset-manage-ui). New
       * labels are plain literals (no new t() keys) so check_i18n stays
       * green without touching vanilla/locales/*. */
      (function fundSection() {
        actBox.appendChild(el(doc, "h3", "Fund fee pool (op 16)"));
        var poolHuman = "—", poolRaw = (dyn && dyn.fee_pool !== undefined && dyn.fee_pool !== null)
          ? String(dyn.fee_pool) : null;
        try { poolHuman = poolRaw === null ? "—" : Format.formatAmount(poolRaw, CORE_PRECISION) + " (core)"; }
        catch (e) { poolHuman = String(poolRaw); }
        var pPool = el(doc, "p", "Current pool: " + poolHuman, "muted");
        if (poolRaw !== null) pPool.title = poolRaw;
        actBox.appendChild(pPool);
        try {
          if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
            actBox.appendChild(el(doc, "p", "Viewing as committee-account (1.2.0) — unlock to act as yourself.", "muted"));
        } catch (e) { /* notice is display-only */ }
        function fundField(label, val, mode, ph) {
          var row = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", label + " ");
          var inp = doc.createElement("input");
          inp.type = "text"; if (mode) inp.setAttribute("inputmode", mode);
          inp.value = val || ""; if (ph) inp.setAttribute("placeholder", ph);
          inp.setAttribute("autocomplete", "off"); touchable(inp);
          lab.appendChild(inp); row.appendChild(lab); return { row: row, input: inp };
        }
        var amtF = fundField("Amount (core, human — e.g. 0.1)", "0.1", "decimal", "0.1");
        var whoF = fundField("From account (name or 1.2.N)", "1.2.0", null, "1.2.0");
        actBox.appendChild(amtF.row); actBox.appendChild(whoF.row);
        var review = touchable(el(doc, "button", "Review funding"));
        review.type = "button"; actBox.appendChild(review);
        var msgBox = el(doc, "div", null, "xplore-fundmsg");
        actBox.appendChild(msgBox);
        function fundMsg(text, isErr) {
          while (msgBox.firstChild) msgBox.removeChild(msgBox.firstChild);
          var n = el(doc, "p", text, isErr ? "error" : "muted");
          n.setAttribute("aria-live", "polite"); msgBox.appendChild(n); return n;
        }
        review.addEventListener("click", function () {
          review.disabled = true;
          (async function () {
            if (typeof AssetOps === "undefined" || typeof Tx === "undefined" ||
                typeof Account === "undefined" || typeof Wallet === "undefined" ||
                typeof Format === "undefined" || typeof Chain === "undefined") {
              throw new Error("Asset backend missing.");
            }
            var amountHuman = (amtF.input.value || "").trim();
            var raw = Format.parseAmount(amountHuman, CORE_PRECISION);
            if (!/[1-9]/.test(raw)) throw new Error("Amount must be greater than zero.");
            var from = await Account.resolve((whoF.input.value || "").trim() || "1.2.0");
            var before = poolRaw;
            var pair = AssetOps.buildFundFeePool({
              fromAccountId: from.id, assetId: a.id,
              amountHuman: amountHuman, corePrecision: CORE_PRECISION
            });
            var f = await AssetOps.fee(pair, "1.3.0");
            pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
            if (!isCurrent(myGen)) return;
            while (actBox.firstChild) actBox.removeChild(actBox.firstChild);
            actBox.appendChild(el(doc, "h3", "Confirm fee-pool funding"));
            var dl = el(doc, "dl", null, "xfer-confirm");
            function confRow(term, human, rawTitle) {
              dl.appendChild(el(doc, "dt", term));
              var dd = el(doc, "dd", human); if (rawTitle) dd.title = rawTitle;
              dl.appendChild(dd);
            }
            var amtHuman;
            try { amtHuman = Format.formatAmount(raw, CORE_PRECISION) + " (core)"; }
            catch (e) { amtHuman = String(raw); }
            confRow("Asset", a.symbol + " (" + a.id + ")");
            confRow("Amount", amtHuman, raw);
            confRow("From", (from.name || from.id) + " (" + from.id + ")");
            var feeHuman;
            try { feeHuman = Format.formatAmount(String(f.amount), CORE_PRECISION) + " (core)"; }
            catch (e) { feeHuman = String(f.amount); }
            confRow("Fee", feeHuman, String(f.amount));
            var netName = "testnet";
            try { netName = (typeof Store !== "undefined" && Store.loadSettings().network) || "testnet"; }
            catch (e) { /* display-only */ }
            confRow("Network", netName);
            actBox.appendChild(dl);
            var back = touchable(el(doc, "button", "Back")); back.type = "button";
            var send = touchable(el(doc, "button", "Sign & Send")); send.type = "button";
            actBox.appendChild(back); actBox.appendChild(send);
            back.addEventListener("click", function () { renderAsset(root, symbol); });
            send.addEventListener("click", function () {
              back.disabled = true; send.disabled = true;
              var st = el(doc, "p", "Signing…", "muted");
              st.setAttribute("aria-live", "polite"); actBox.appendChild(st);
              (async function () {
                var unsigned = await Tx.buildTx([pair]);
                var wif = (Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
                if (!wif) throw new Error("wallet-locked");
                st.textContent = "Broadcasting…";
                var r = await AssetOps.sendAndProve(unsigned, wif, async function () {
                  try {
                    var n = await Explorer.asset(a.symbol);
                    var after = n && n.dynamic && n.dynamic.fee_pool !== undefined
                      ? String(n.dynamic.fee_pool) : null;
                    if (after === null || before === null) return null;
                    return (BigInt(after) - BigInt(before) === BigInt(raw)) ? n : null;
                  } catch (e) { return null; }
                });
                var headN = 0;
                try {
                  var dbId = await Chain.db();
                  var gp = await Chain.call(dbId, "get_dynamic_global_properties", []);
                  headN = (gp && gp.head_block_number) || 0;
                } catch (e) { /* head is display-only */ }
                if (!isCurrent(myGen)) return;
                while (actBox.firstChild) actBox.removeChild(actBox.firstChild);
                actBox.appendChild(el(doc, "h1", "Fee pool funded"));
                var okP = el(doc, "p",
                  "Observed at head block #" + headN + " (" + r.via + ").", "xfer-ok");
                okP.setAttribute("aria-live", "polite"); actBox.appendChild(okP);
                actBox.appendChild(el(doc, "p",
                  amtHuman + " → " + a.symbol + " pool (re-read delta matches).", "muted"));
                var backLink = anchor(doc, "Open " + a.symbol, "#/asset/" + a.symbol);
                actBox.appendChild(backLink);
              })().catch(function (e) {
                try { actBox.removeChild(st); } catch (x) { /* gone */ }
                var m = (e && e.message) ? e.message : String(e || "Send failed.");
                if (m.indexOf("wallet-locked") !== -1) m = "Wallet is locked.";
                else if (m.indexOf("not-connected") !== -1 || m.indexOf("not connected") !== -1) {
                  m = "Network unavailable. Check Settings → Nodes and retry.";
                }
                fundMsg(m, true); back.disabled = false;
              });
            });
          })().catch(function (e) {
            review.disabled = false;
            var m = (e && e.message) ? e.message : String(e || "Could not prepare the funding.");
            fundMsg(m, true);
          });
        });
      })();
      actBox.appendChild(el(doc, "p",
        "Fee-pool claiming (issuer) stays deferred here — no claim serializer in this view.", "muted"));
      if (!j.is_smartcoin) {
        infoBox.appendChild(el(doc, "p", t("explorer.not_smartcoin", "Not a smartcoin — no price feeds."), "muted"));
        return;
      }
      infoBox.appendChild(el(doc, "h3", t("explorer.feeds_h", "Price feeds")));
      var feedBox = el(doc, "div", null, "xplore-feed");
      infoBox.appendChild(feedBox);
      showStatus(doc, feedBox, t("explorer.loading_feeds", "Loading feeds…"));
      Explorer.feeds([a.symbol]).then(function (rows) {
        if (!isCurrent(myGen)) return;
        while (feedBox.firstChild) feedBox.removeChild(feedBox.firstChild);
        var f = (rows || [])[0];
        if (!f || !f.is_smartcoin || !f.settlement_raw) {
          feedBox.appendChild(el(doc, "p", t("explorer.no_feeds", "No live feeds published."), "muted"));
          return;
        }
        var fdl = el(doc, "dl", null, "xplore-fields");
        function priceRow(term, pair) {
          fdl.appendChild(el(doc, "dt", term));
          var dd = doc.createElement("dd");
          if (!pair || f.quote_precision === null || f.quote_precision === undefined) {
            dd.textContent = t("explorer.unavailable_quote", "unavailable (quote precision unknown)");
          } else {
            try {
              dd.textContent = Format.formatPrice(String(pair.base.amount), f.base_precision,
                String(pair.quote.amount), f.quote_precision, PRICE_PLACES);
              dd.title = "base " + pair.base.amount + " / quote " + pair.quote.amount;
            } catch (e) { dd.textContent = t("explorer.unavailable", "unavailable"); }
          }
          fdl.appendChild(dd);
        }
        priceRow(t("explorer.settlement_row", "Settlement price"), f.settlement_raw);
        priceRow(t("explorer.feed_row", "Feed price"), f.feed_raw);
        var ctx = { gen: myGen, root: root, tab: "assets" };
        if (f.mssr_hundredths !== null && f.mssr_hundredths !== undefined) {
          ExplorerRender.fieldRow(doc, fdl, "maximum_short_squeeze_ratio", f.mssr_hundredths, ctx, 0);
        }
        if (f.mcr !== null && f.mcr !== undefined) {
          ExplorerRender.fieldRow(doc, fdl, "maintenance_collateral_ratio", f.mcr, ctx, 0);
        }
        if (f.feed_lifetime_sec !== null && f.feed_lifetime_sec !== undefined) {
          fdl.appendChild(el(doc, "dt", t("explorer.feed_lifetime", "Feed lifetime")));
          var lt = doc.createElement("dd");
          lt.textContent = lifetimeText(f.feed_lifetime_sec);
          lt.title = String(f.feed_lifetime_sec) + t("explorer.seconds_unit", " seconds");
          fdl.appendChild(lt);
        }
        if (f.min_feeds !== null && f.min_feeds !== undefined) {
          fdl.appendChild(el(doc, "dt", t("explorer.min_feeds", "Minimum feeds")));
          var mf = doc.createElement("dd");
          mf.textContent = String(f.min_feeds);
          fdl.appendChild(mf);
        }
        feedBox.appendChild(fdl);
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        while (feedBox.firstChild) feedBox.removeChild(feedBox.firstChild);
        showError(doc, feedBox, e, t("explorer.feeds_failed", "Could not load feeds."));
      });
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(el(doc, "h1", t("explorer.asset_prefix", "Asset ") + symbol));
      showError(doc, wrap, e, t("explorer.unknown_asset", "Unknown asset."));
    });
  }

  /* Feeds tab: scan the first asset pages for smartcoins, then show MPA
   * rows (symbol, settlement, feed, MSSR). Verified empty state when the
   * chain has none (ambiguity C) — never faked, never blank. */
  function feedsTab(doc, body, root, myGen) {
    showStatus(doc, body, t("explorer.scanning", "Scanning for smartcoins…"));
    var lower = "", pages = 0, found = [];
    function scan() {
      Explorer.assetsPage(lower, ASSETS_PAGE).then(function (rows) {
        if (!isCurrent(myGen)) return;
        rows = rows || [];
        rows.forEach(function (a) {
          if (a && a.bitasset_data_id && found.length < FEED_MAX) found.push(a.symbol);
        });
        pages++;
        if (rows.length >= ASSETS_PAGE && pages < FEED_SCAN_PAGES && found.length < FEED_MAX) {
          lower = rows[rows.length - 1].symbol;
          scan();
          return;
        }
        paint();
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        while (body.firstChild) body.removeChild(body.firstChild);
        showError(doc, body, e, t("explorer.scan_failed", "Could not scan assets."));
      });
    }
    function paint() {
      while (body.firstChild) body.removeChild(body.firstChild);
      if (found.length === 0) {
        body.appendChild(el(doc, "p",
          t("explorer.no_smartcoins", "No smartcoins with feeds found on this node. User-issued assets show here once they publish feeds."), "muted"));
        return;
      }
      showStatus(doc, body, t("explorer.loading_feeds_for", "Loading feeds for ") + found.length + t("explorer.asset_count_suffix", " asset(s)…"));
      Explorer.feeds(found).then(function (rows) {
        if (!isCurrent(myGen)) return;
        while (body.firstChild) body.removeChild(body.firstChild);
        var tableRows = (rows || []).map(function (f) {
          var sym = anchor(doc, f.symbol, "#/asset/" + f.symbol);
          function priceCell(pair) {
            if (!pair || f.quote_precision === null || f.quote_precision === undefined) return "—";
            try {
              return Format.formatPrice(String(pair.base.amount), f.base_precision,
                String(pair.quote.amount), f.quote_precision, PRICE_PLACES);
            } catch (e) { return "—"; }
          }
          var mssr = (f.mssr_hundredths !== null && f.mssr_hundredths !== undefined &&
            /^\d+$/.test(String(f.mssr_hundredths))) ? ratio1000(String(f.mssr_hundredths)) : "—";
          return [sym, priceCell(f.settlement_raw), priceCell(f.feed_raw), mssr];
        });
        body.appendChild(scrollTable(doc,
          [t("explorer.th_symbol", "Symbol"), t("explorer.th_settlement", "Settlement"), t("explorer.th_feed", "Feed"), t("explorer.th_mssr", "MSSR")], tableRows));
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        while (body.firstChild) body.removeChild(body.firstChild);
        showError(doc, body, e, t("explorer.feeds_failed", "Could not load feeds."));
      });
    }
    scan();
  }

  return {
    /* Slice-18 aliases: the value layer lives in ExplorerRender (which
     * loads first) — same functions, stable ExplorerAssets paths for
     * explorer-blocks.js + explorer-ui.js. */
    opSection: ExplorerRender.opSection,
    accountLink: ExplorerRender.accountLink,
    renderObjectPanel: ExplorerRender.renderObjectPanel,
    assetsTab: assetsTab,
    renderAsset: renderAsset,
    feedsTab: feedsTab,
    _test: { pctHundredths: pctHundredths, ratio1000: ratio1000, lifetimeText: lifetimeText }
  };
})();

if (typeof module !== "undefined") { module.exports = ExplorerAssets; }
