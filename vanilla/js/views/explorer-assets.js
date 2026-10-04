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
  function t(key, dflt, vars) {
    var s = dflt;
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") {
        var probe = I18n.t(key, dflt, vars);
        if (typeof probe === "string" && probe.indexOf("%(") === -1) return probe;
        if (typeof probe === "string") s = probe;
      }
    } catch (e) { /* default below */ }
    /* Split/join fallback (pool-graph precedent): fills %(name)s from vars
     * when I18n is absent or left placeholders behind. Never throws. */
    try {
      if (vars && typeof vars === "object") {
        s = String(s).replace(/%\(([^)]+)\)s/g, function (m, name) {
          return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
        });
      }
    } catch (e) { s = dflt; }
    return s;
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

  /** Bit int -> "a, b" label list, "(none)" when empty; "" on garbage.
   * TYPE NOTE: PERM_LABELS rows infer as (string|number)[] so p[0] reads
   * back string|number at the & site; the cast pins the bit operand.
   * No shared types.js yet (group 1 owns it); local cast only.
   * @param {any} v bit field (number expected, anything coerced)
   * @returns {string} label list, "(none)", or "" on garbage */
  function flagBitNames(v) {
    var n = parseInt(String(v), 10);
    if (!(n >= 0)) return "";
    var out = [];
    PERM_LABELS.forEach(function (p) { if (n & (/** @type {any} */ (p[0]))) out.push(p[1]); });
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

  /* No local el — use DOM.el */

  /* Touch target floor (principle #7): interactive elements are >=44px in
   * at least one dimension. */
/* clearRoot removed — use DOM.clear */

  /* Wide (viewport-gaps fix 2026-09-28): full-bleed stacked grid
   * ≥1200px; children span full width via app.css .wide contract. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  function anchor(doc, text, href) {
    var a = DOM.el(doc, "a", text);
    a.setAttribute("href", href);
    touchable(a);
    a.style.display = "inline-block";
    return a;
  }

  /* Copy-share-link row for the asset view (verbatim twin of the
   * explorer-blocks.js shareRow — same per-file convention as the
   * el/touchable copies above, so this file needs no new cross-module
   * surface). Hash deep links the router already resolves (router.js:
   * #/asset/:symbol). Clipboard API with an execCommand textarea fallback;
   * the result reads inline via aria-live, never a dialog. textContent
   * only. Params: doc, hash ("#/…"). Returns the row div. Never throws. */
  function shareRow(doc, hash) {
    var row = DOM.el(doc, "div", null, "xplore-share");
    var btn = touchable(DOM.el(doc, "button", "Copy link", "subtle-btn"));
    btn.type = "button";
    var note = DOM.el(doc, "span", "", "muted");
    note.setAttribute("aria-live", "polite");
    row.appendChild(btn);
    row.appendChild(DOM.el(doc, "span", " "));
    row.appendChild(note);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      note.textContent = t("misc.copying", "Copying…");
      var url = "";
      try {
        if (typeof Explorer !== "undefined" && Explorer &&
            typeof Explorer.currentShareUrl === "function") {
          url = Explorer.currentShareUrl(hash);
        } else if (typeof location !== "undefined" && location.href) {
          url = location.href.split("#")[0] + hash;
        } else {
          url = hash;
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
    return row;
  }

  /* Inline error panel that is never blank: thrown values map to human
   * sentences; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var box = null; /* created via DOM.error below — use DOM.el, DOM.clear */
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message : String(e || fallback || t("explorer.unexpected", "Unexpected error"));
    if (msg.indexOf("unknown-block") !== -1) msg = t("explorer.unknown_block", "Unknown block.");
    else if (msg.indexOf("unknown-tx") !== -1) msg = t("explorer.unknown_tx", "Unknown transaction.");
    else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || t("explorer.unknown_asset", "Unknown asset.");
    else if (msg.indexOf("unknown-object") !== -1) msg = fallback || (t("explorer.not_found", "Nothing found for that search.") + " Check the id shape (1.x.x) or name spelling and retry.");
    else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = t("explorer.tx_expired", "Transaction hash lookup covers recent transactions only — this one is expired or unknown.");
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = t("explorer.offline", "Network unavailable. Check Settings → Nodes and retry.");
    }
    box = DOM.error(wrap, msg);
    return box;
  }

  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text);
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
    var scroller = DOM.el(doc, "div", null, "xplore-scroll");
    scroller.style.overflowX = "auto";
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    headers.forEach(function (h) { hr.appendChild(DOM.el(doc, "th", h)); });
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

  /* _parseHolders: ES objects-balance _search JSON -> [{owner, balance}].
   * OBSERVED shape (live curl 2026-10-02 against es.bitshares.dev): hits.hits[i]
   * ._source = {id "2.5.x", asset_type "1.3.x", balance <raw int, JSON number>,
   * maintenance_flag bool, owner_ "1.2.x" (trailing underscore), object_id,
   * block_time, block_number}. No account names and no asset precision ride
   * in the hits (precision comes from the asset object at the call site, names
   * resolve via ExplorerRender.accountLink) — astro-ui's
   * TopAssetHolders.ts:30-37 is the query-shape hint only, not the row shape.
   * Balances stay digit-strings for Format.formatAmount (never Number math).
   * Shape-tolerant: anything missing -> []. Never throws.
   * @param {any} esJson parsed ES _search response
   * @returns {Array<{owner:string,balance:string}>} rows in hit (rank) order */
  function _parseHolders(esJson) {
    try {
      var hits = esJson && esJson.hits && esJson.hits.hits;
      if (!Array.isArray(hits)) return [];
      var out = [];
      for (var i = 0; i < hits.length; i++) {
        var src = hits[i] && hits[i]._source;
        if (!src || typeof src !== "object") continue;
        if (typeof src.owner_ !== "string" || !ACCT_RE.test(src.owner_)) continue;
        var bal = src.balance;
        if (typeof bal === "number") {
          if (!isFinite(bal)) continue;
          bal = String(Math.floor(bal));
        }
        if (typeof bal !== "string" || !/^\d+$/.test(bal)) continue;
        out.push({ owner: src.owner_, balance: bal });
      }
      return out;
    } catch (e) { return []; }
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
    DOM.clear(body);
    /* Filter bar (rebuilt per page turn with state values preserved; table
     * repaints below it so typing never loses focus). New labels are plain
     * literals (no new t() keys) per the file-scope i18n note above. */
    var bar = DOM.el(doc, "div", null, "xplore-filters");
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
    var radioWrap = DOM.el(doc, "span", null, "xplore-radios");
    radioWrap.setAttribute("role", "radiogroup");
    radioWrap.setAttribute("aria-label", t("explorer.asset_type_filter", "Asset type filter"));
    modes.forEach(function (m) {
      var lab = DOM.el(doc, "label", null, "xplore-radio");
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
      lab.appendChild(DOM.el(doc, "span", " " + m[1]));
      radioWrap.appendChild(lab);
    });
    bar.appendChild(radioWrap);
    var perLab = DOM.el(doc, "label", t("explorer.rows", " Rows "));
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
    var tableWrap = DOM.el(doc, "div", null, "xplore-tablewrap");
    body.appendChild(tableWrap);
    var navWrap = DOM.el(doc, "div", null, "xplore-nav");
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
      /* finish: join dynamic/bitasset lookups into allRows then repaint.
       * WHY nested: both lookup batches share this tail; caller holds the gen guard.
       * No params, no return; never throws (missing objects stay null/dash). */
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
    /* filteredSorted: apply mode/search filter + sortKey sort over allRows.
     * WHY separate: paintCached reuses it on every keystroke/sort without re-fetch.
     * No params; returns a new array (BigInt supply compare, nulls last). */
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
    /* paintCached: repaint the cached allRows via filteredSorted (gen-guarded).
     * WHY cached: search/sort/paging repaint locally; chain reads happen once.
     * No params, no return; empty view shows an honest muted line. */
    function paintCached() {
      if (!isCurrent(myGen)) return;
      if (!allRows) return;
      DOM.clear(tableWrap);
      DOM.clear(navWrap);
      var view = filteredSorted();
      if (view.length === 0) {
        tableWrap.appendChild(DOM.el(doc, "p", t("explorer.no_assets", "No assets on this page.") + t("explorer.clear_filter_hint", " Clear the search filter to see the full page."), "muted"));
      } else {
        var scroller = DOM.el(doc, "div", null, "xplore-scroll");
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
          var b = touchable(DOM.el(doc, "button", label + sortMark(key)));
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
        hr.appendChild(DOM.el(doc, "th", t("explorer.market_3", "Market")));
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
            ? ExplorerRender.accountLink(doc, a.issuer, myGen) : DOM.el(doc, "span", String(a.issuer));
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
        var prev = touchable(DOM.el(doc, "button", t("explorer.prev", "← Prev")));
        prev.type = "button";
        prev.addEventListener("click", function () {
          var back = (stack || []).slice(0, -1);
          var to = (stack || [])[(stack || []).length - 1];
          assetsTab(doc, body, root, myGen, to === undefined ? "" : to, back);
        });
        navWrap.appendChild(prev);
      }
      if (lastRows.length >= assetState.perPage && lastRows.length > 0) {
        var next = touchable(DOM.el(doc, "button", t("explorer.next", "Next →")));
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
        DOM.clear(tableWrap);
        tableWrap.appendChild(DOM.el(doc, "p", t("explorer.no_assets", "No assets on this page.") + t("explorer.clear_filter_hint", " Clear the search filter to see the full page."), "muted"));
        return;
      }
      enrichAndStore(rows);
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      DOM.clear(tableWrap);
      showError(doc, tableWrap, e, t("explorer.assets_failed", "Could not load assets."));
      var retry = touchable(DOM.el(doc, "button", t("explorer.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () {
        assetsTab(doc, body, root, myGen, lower, stack);
      });
      tableWrap.appendChild(retry);
    });
  }

  /** #/asset/:symbol: header + MARKET button (preferred market) +
   * ASSET INFO/ACTIONS tabs + asset-type/flags section + description box with
   * grouped amounts + feed section when is_smartcoin (both-precisions math)
   * else the "not a smartcoin" empty state. Concepts from #1 Asset.jsx:
   * AboutBox preferredMarket (description.market else core, self->USD),
   * Tabs info/actions (Asset.jsx:2337-2403), type/flags (asset_utils +
   * permission bits), description main/market (parseDescription). DEFERRED:
   * FEE POOL funding/claim panel (Asset.jsx renderFeePool* needs signing —
   * read-only explorer shows the fee-pool balance only) + prediction LIST
   * view (Assets.jsx:492- List with condition/expiry — table covers it).
   * @param {HTMLElement} root router mount element
   * @param {string} symbol asset symbol for the detail view */
  function renderAsset(root, symbol) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = bumpGen();
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer) {
      showError(doc, wrap, t("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load."));
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderAsset(root, symbol); })) return;
    if (typeof symbol !== "string" || !symbol) {
      wrap.appendChild(DOM.pageHead(doc, t("explorer.asset_title", "Asset"), "insight"));
      showError(doc, wrap, new Error("unknown-asset"), t("explorer.unknown_asset", "Unknown asset."));
      return;
    }
    wrap.appendChild(DOM.pageHead(doc, t("explorer.asset_prefix", "Asset ") + symbol, "insight"));
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
      DOM.clear(wrap);
      wrap.appendChild(DOM.pageHead(doc, t("explorer.asset_prefix", "Asset ") + a.symbol, "insight"));
      var marketBtn = anchor(doc, t("explorer.market_2", "MARKET →"), "#/market/" + marketID);
      marketBtn.title = marketID;
      marketBtn.setAttribute("aria-label", t("explorer.open_preferred_market", "Open preferred market ") + marketID);
      wrap.appendChild(marketBtn);
      wrap.appendChild(shareRow(doc, "#/asset/" + a.symbol));
      /* Tabs (shared .xplore-tab underline treatment with explorer-ui.js —
       * grey caps, active accent underline; same bar so all tab rows agree).
       * #1 Tabs info/actions (Asset.jsx:2337-2403). */
      var tabBar = DOM.el(doc, "div", null, "xplore-tabs");
      tabBar.setAttribute("role", "tablist");
      var infoBtn = touchable(DOM.el(doc, "button", t("explorer.asset_info", "ASSET INFO"), "xplore-tab active"));
      infoBtn.type = "button";
      infoBtn.setAttribute("role", "tab");
      var actBtn = touchable(DOM.el(doc, "button", t("explorer.actions", "ACTIONS"), "xplore-tab"));
      actBtn.type = "button";
      actBtn.setAttribute("role", "tab");
      tabBar.appendChild(infoBtn);
      tabBar.appendChild(actBtn);
      wrap.appendChild(tabBar);
      var infoBox = DOM.el(doc, "div", null, "xplore-tabinfo");
      var actBox = DOM.el(doc, "div", null, "xplore-tabact");
      actBox.style.display = "none";
      wrap.appendChild(infoBox);
      wrap.appendChild(actBox);
      /* selectTab: toggle the asset detail info/actions panes (shared
       * .xplore-tab/.active classes with explorer-ui.js + aria-selected).
       * WHY helper: both tab buttons share this state flip; styling-only, never throws.
       * Param which ("info"|"actions"); no return. */
      function selectTab(which) {
        var info = which !== "actions";
        infoBox.style.display = info ? "" : "none";
        actBox.style.display = info ? "none" : "";
        try {
          infoBtn.setAttribute("aria-selected", info ? "true" : "false");
          actBtn.setAttribute("aria-selected", info ? "false" : "true");
          infoBtn.className = info ? "xplore-tab active" : "xplore-tab";
          actBtn.className = info ? "xplore-tab" : "xplore-tab active";
        } catch (e) { /* styling only */ }
      }
      infoBtn.addEventListener("click", function () { selectTab("info"); });
      actBtn.addEventListener("click", function () { selectTab("actions"); });
      selectTab("info");
      var dl = DOM.el(doc, "dl", null, "xplore-fields");
      /* humanRowInto: append a dt/dd row with a Format-human amount (raw in title).
       * WHY helper: asset-page rows share the dash-on-missing contract (principle #6).
       * Params target, term, raw (chain int string); no return, never throws. */
      function humanRowInto(target, term, raw) {
        target.appendChild(DOM.el(doc, "dt", term));
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
        target.appendChild(DOM.el(doc, "dt", term));
        var dd = doc.createElement("dd");
        if (raw === undefined || raw === null) dd.textContent = "—";
        else {
          try { dd.textContent = Format.formatAmount(String(raw), CORE_PRECISION); }
          catch (e) { dd.textContent = String(raw); }
          dd.title = String(raw);
        }
        target.appendChild(dd);
      }
      dl.appendChild(DOM.el(doc, "dt", t("explorer.id_row", "ID")));
      var idDd = doc.createElement("dd");
      idDd.textContent = a.id;
      dl.appendChild(idDd);
      dl.appendChild(DOM.el(doc, "dt", t("explorer.issuer_row", "Issuer")));
      var issuerDd = doc.createElement("dd");
      issuerDd.appendChild((typeof a.issuer === "string" && ACCT_RE.test(a.issuer))
        ? ExplorerRender.accountLink(doc, a.issuer, myGen) : DOM.el(doc, "span", String(a.issuer)));
      dl.appendChild(issuerDd);
      dl.appendChild(DOM.el(doc, "dt", t("explorer.precision_row", "Precision")));
      var pDd = doc.createElement("dd");
      pDd.textContent = String(prec);
      dl.appendChild(pDd);
      dl.appendChild(DOM.el(doc, "dt", t("explorer.asset_type", "Asset type")));
      var tyDd = doc.createElement("dd");
      tyDd.textContent = typeLabel;
      dl.appendChild(tyDd);
      infoBox.appendChild(dl);
      /* Asset-type/flags section (chain truth: protocol/types.hpp permission
       * bits; raw ints in titles, human lists via flagBitNames). */
      infoBox.appendChild(DOM.el(doc, "h2", t("explorer.asset_type_and_permissions", "Asset type and permissions")));
      var dlF = DOM.el(doc, "dl", null, "xplore-fields");
      function flagRow(term, raw) {
        dlF.appendChild(DOM.el(doc, "dt", term));
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
      dlF.appendChild(DOM.el(doc, "dt", t("explorer.market_fee", "Market fee")));
      dlF.appendChild(feeDd);
      infoBox.appendChild(dlF);
      /* Description box with grouped amounts (main text + short_name +
       * max/current/fees/fee-pool human — #1 AboutBox + Summary grouped). */
      var descBox = DOM.el(doc, "div", null, "xplore-descbox");
      descBox.appendChild(DOM.el(doc, "h2", t("explorer.description", "Description")));
      var mainText = (descParsed.main && descParsed.main.trim())
        ? descParsed.main : "(no description)";
      descBox.appendChild(DOM.el(doc, "p", mainText));
      if (descParsed.shortName) descBox.appendChild(DOM.el(doc, "p", t("explorer.short", "Short: ") + descParsed.shortName));
      if (descParsed.market) descBox.appendChild(DOM.el(doc, "p", t("explorer.market", "Market: ") + descParsed.market));
      var dl2 = DOM.el(doc, "dl", null, "xplore-fields");
      descBox.appendChild(dl2);
      humanRowInto(dl2, t("explorer.max_supply", "Max supply"), a.options && a.options.max_supply);
      humanRowInto(dl2, t("explorer.current_supply", "Current supply"), dyn.current_supply);
      humanRowInto(dl2, t("explorer.accumulated_fees", "Accumulated fees"), dyn.accumulated_fees);
      coreRowInto(dl2, t("explorer.fee_pool", "Fee pool"), dyn.fee_pool);
      infoBox.appendChild(descBox);
      /* Top-holders panel (ES objects-balance via HistoryCap.esSearch — WS has
       * no holder endpoint, sweep-proven -32601 everywhere). Query shape mirrors
       * astro-ui TopAssetHolders.ts:30-37 (match on asset_type, balance desc,
       * size 25); rows parsed by _parseHolders against the OBSERVED shape.
       * Owner cells reuse ExplorerRender.accountLink (id now, name when the
       * resolve lands — same helper as the issuer row above); balances go
       * through Format.formatAmount with this asset's precision (raw in
       * title). Gated: HistoryCap missing, esAllowed() false, or esSearch
       * reject -> keyed one-line notice + HistoryNotice settings link.
       * Never blank, never throws. */
      (function holdersSection() {
        var box = DOM.el(doc, "div", null, "xplore-holders");
        infoBox.appendChild(box);
        box.appendChild(DOM.el(doc, "h2", t("asset.holders_title", "Top holders")));
        var listBox = DOM.el(doc, "div", null, "xplore-holders-list");
        box.appendChild(listBox);
        showStatus(doc, listBox, t("explorer.loading_prefix", "Loading ") + t("asset.holders_title", "Top holders") + "…");
        /* holdersUnavailable: keyed one-line notice + Settings action link.
         * WHY helper: three failure paths (pref off, missing seam, ES reject)
         * share this honest panel; display-only, never throws. No params. */
        function holdersUnavailable() {
          DOM.clear(listBox);
          listBox.appendChild(DOM.el(doc, "p",
            t("asset.holders_unavailable", "Top holders unavailable — the community index is off or unreachable; check Settings."), "muted"));
          try {
            if (typeof HistoryNotice !== "undefined" && HistoryNotice &&
                typeof HistoryNotice.actionLink === "function") {
              var link = HistoryNotice.actionLink(doc, t, "settings");
              if (link) listBox.appendChild(link);
            }
          } catch (e2) { /* notice stands without the link */ }
        }
        try {
          if (typeof HistoryCap === "undefined" || !HistoryCap ||
              typeof HistoryCap.esAllowed !== "function" ||
              typeof HistoryCap.esSearch !== "function" || !HistoryCap.esAllowed()) {
            holdersUnavailable();
            return;
          }
          var body = { query: { bool: { must: [{ match: { asset_type: { query: a.id } } }] } },
            track_total_hits: false, size: 25, sort: [{ balance: { order: "desc" } }] };
          HistoryCap.esSearch("objects-balance", body).then(function (esJson) {
            if (!isCurrent(myGen)) return;
            /* Belt-and-braces (AFK R5): everything after the clear() below
             * must land SOMETHING — any unexpected throw (future edits,
             * transient shapes) falls through to the honest notice, never a
             * silently empty box (unhandled rejections are invisible to the
             * headless shooter, so fail-soft here instead of upstream). */
            try {
              var rows = _parseHolders(esJson);
              DOM.clear(listBox);
              if (rows.length === 0) { holdersUnavailable(); return; }
              var scroller = DOM.el(doc, "div", null, "xplore-scroll");
              scroller.style.overflowX = "auto";
              var table = doc.createElement("table");
              table.className = "node-table";
              var thead = doc.createElement("thead");
              var hr = doc.createElement("tr");
              hr.appendChild(DOM.el(doc, "th", t("asset.holders_account", "Account")));
              hr.appendChild(DOM.el(doc, "th", t("asset.holders_balance", "Balance")));
              thead.appendChild(hr);
              table.appendChild(thead);
              var tb = doc.createElement("tbody");
              rows.forEach(function (r) {
                var tr = doc.createElement("tr");
                var tdA = doc.createElement("td");
                tdA.appendChild(ExplorerRender.accountLink(doc, r.owner, myGen));
                tr.appendChild(tdA);
                var tdB = doc.createElement("td");
                try {
                  tdB.textContent = Format.formatAmount(r.balance, prec);
                  tdB.title = r.balance;
                } catch (e) { tdB.textContent = r.balance; }
                tr.appendChild(tdB);
                tb.appendChild(tr);
              });
              table.appendChild(tb);
              scroller.appendChild(table);
              listBox.appendChild(scroller);
            } catch (e) {
              if (!isCurrent(myGen)) return;
              holdersUnavailable();
            }
          }).catch(function () {
            if (!isCurrent(myGen)) return;
            holdersUnavailable();
          });
        } catch (e) { holdersUnavailable(); }
      })();
      /* ACTIONS tab: market/transfer links + live fee-pool FUND form (op 16).
       * RESOLVED (was deferred): funding now signs locally via AssetOps +
       * Tx like the asset-manage flows (review + unlock-at-sign + pool-delta
       * re-read proof). Claiming (ops 43/47) stays deferred honestly — no
       * serializer or form for it here. Concepts from #1 Asset.jsx
       * renderFeePoolFunding + FeePoolOperation fund path and #2
       * AssetIssuerActions fund-fee-pool dialog (current pool + amount +
       * confirm); vanilla uses named confirm rows, never raw JSON. */
      actBox.appendChild(DOM.el(doc, "h2", t("explorer.asset_actions", "Asset actions")));
      var mLink = anchor(doc, t("explorer.open_market", "Open market ") + marketID, "#/market/" + marketID);
      mLink.title = marketID;
      actBox.appendChild(mLink);
      actBox.appendChild(DOM.el(doc, "p", t("explorer.trade_and_transfer_this_asset_from_its_prefer", "Trade and transfer this asset from its preferred market."), "muted"));
      var tLink = anchor(doc, t("explorer.transfer", "Transfer ") + a.symbol, "#/transfer");
      tLink.title = t("explorer.pill_transfer", "Transfer");
      actBox.appendChild(tLink);
      /* Fund-fee-pool form (op 16) — anyone may fund any asset's pool with
       * CORE. Reads are public; the password is asked ONLY at signing
       * (publish gates on the fresh WIF, same as asset-manage-ui). Batch-7
       * i18n: labels keyed via t() under explorer dot fund, confirm, plus suffixes. */
      (function fundSection() {
        actBox.appendChild(DOM.el(doc, "h2", t("explorer.fund_fee_pool_h", "Fund fee pool (op 16)")));
        var poolHuman = "—", poolRaw = (dyn && dyn.fee_pool !== undefined && dyn.fee_pool !== null)
          ? String(dyn.fee_pool) : null;
        try { poolHuman = poolRaw === null ? "—" : Format.formatAmount(poolRaw, CORE_PRECISION) + t("explorer.core_suffix", " (core)"); }
          catch (e) { poolHuman = String(poolRaw); }
        var pPool = DOM.el(doc, "p", t("explorer.current_pool_prefix", "Current pool: ") + poolHuman, "muted");
        if (poolRaw !== null) pPool.title = poolRaw;
        actBox.appendChild(pPool);
        try {
          if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
            var _v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
            actBox.appendChild(DOM.el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v.name, id: _v.id }), "muted"));
          }
        } catch (e) { /* notice is display-only */ }
        /* Forms seam (Task 2.2): labeled text input — div.xfer-field >
         * label(text + " ") > input; autocomplete stays off as before. */
        function fundField(label, val, mode, ph) {
          var seam = Forms.labeledInput(doc, label + " ", {
            value: val || "", placeholder: ph, inputmode: mode || undefined });
          seam.input.type = "text";
          seam.input.setAttribute("autocomplete", "off");
          return seam;
        }
        var amtF = fundField(t("explorer.fund_amount_label", "Amount (core, human — e.g. 0.1)"), "0.1", "decimal", "0.1");
        var whoF = fundField(t("explorer.fund_from_label", "From account (name or 1.2.N)"), (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0", null, "1.2.0");
        actBox.appendChild(amtF.row); actBox.appendChild(whoF.row);
        var review = touchable(DOM.el(doc, "button", t("explorer.review_funding", "Review funding")));
        review.type = "button"; actBox.appendChild(review);
        var msgBox = DOM.el(doc, "div", null, "xplore-fundmsg");
        actBox.appendChild(msgBox);
        /* fundMsg: replace the fee-pool form notice (aria-live, error vs muted).
         * WHY helper: review errors and hints share this slot; display-only.
         * Params text, isErr; returns the notice node. */
        function fundMsg(text, isErr) {
          DOM.clear(msgBox);
          var n = DOM.el(doc, "p", text, isErr ? "error" : "muted");
          n.setAttribute("aria-live", "polite"); msgBox.appendChild(n); return n;
        }
        review.addEventListener("click", function () {
          review.disabled = true;
          (async function () {
            if (typeof AssetOps === "undefined" || typeof Tx === "undefined" ||
                typeof Account === "undefined" || typeof Wallet === "undefined" ||
                typeof Format === "undefined" || typeof Chain === "undefined") {
              throw new Error(t("explorer.fund_backend_missing", "Asset backend missing."));
            }
            var amountHuman = (amtF.input.value || "").trim();
            var raw = Format.parseAmount(amountHuman, CORE_PRECISION);
            if (!/[1-9]/.test(raw)) throw new Error(t("explorer.fund_amount_zero", "Amount must be greater than zero."));
            var from = await Account.resolve((whoF.input.value || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
            var before = poolRaw;
            var pair = AssetOps.buildFundFeePool({
              fromAccountId: from.id, assetId: a.id,
              amountHuman: amountHuman, corePrecision: CORE_PRECISION
            });
            var f = await AssetOps.fee(pair, "1.3.0");
            pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
            if (!isCurrent(myGen)) return;
            DOM.clear(actBox);
            actBox.appendChild(DOM.el(doc, "h2", t("explorer.confirm_fund_h", "Confirm fee-pool funding")));
            var dl = DOM.el(doc, "dl", null, "xfer-confirm");
            /* confRow: append a confirm dt/dd row (human visible, raw in title).
             * WHY helper: fee-pool confirm rows share the human+raw contract (#6).
             * Params term, human, rawTitle; no return. */
            function confRow(term, human, rawTitle) {
              dl.appendChild(DOM.el(doc, "dt", term));
              var dd = DOM.el(doc, "dd", human); if (rawTitle) dd.title = rawTitle;
              dl.appendChild(dd);
            }
            var amtHuman;
            try { amtHuman = Format.formatAmount(raw, CORE_PRECISION) + t("explorer.core_suffix", " (core)"); }
            catch (e) { amtHuman = String(raw); }
            confRow(t("explorer.confirm_asset", "Asset"), a.symbol + " (" + a.id + ")");
            confRow(t("explorer.confirm_amount", "Amount"), amtHuman, raw);
            confRow(t("explorer.confirm_from", "From"), (from.name || from.id) + " (" + from.id + ")");
            var feeHuman;
            try { feeHuman = Format.formatAmount(String(f.amount), CORE_PRECISION) + t("explorer.core_suffix", " (core)"); }
            catch (e) { feeHuman = String(f.amount); }
            confRow(t("explorer.confirm_fee", "Fee"), feeHuman, String(f.amount));
            var netName = "testnet";
            try { netName = (typeof Store !== "undefined" && Store.loadSettings().network) || "testnet"; }
            catch (e) { /* display-only */ }
            confRow(t("explorer.confirm_network", "Network"), netName);
            actBox.appendChild(dl);
            var back = touchable(DOM.el(doc, "button", t("explorer.fund_back", "Back"))); back.type = "button";
            var send = touchable(DOM.el(doc, "button", t("explorer.fund_sign_send", "Sign & Send"))); send.type = "button";
            actBox.appendChild(back); actBox.appendChild(send);
            back.addEventListener("click", function () { renderAsset(root, symbol); });
            send.addEventListener("click", function () {
              back.disabled = true; send.disabled = true;
              var st = DOM.el(doc, "p", t("explorer.fund_signing", "Signing…"), "muted");
              st.setAttribute("aria-live", "polite"); actBox.appendChild(st);
              (async function () {
                var unsigned = await Tx.buildTx([pair]);
                var wif = (Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
                if (!wif) throw new Error("wallet-locked");
                st.textContent = t("explorer.fund_broadcasting", "Broadcasting…");
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
                DOM.clear(actBox);
                actBox.appendChild(DOM.el(doc, "h1", t("explorer.funded_h", "Fee pool funded")));
                var okP = DOM.el(doc, "p",
                  t("explorer.observed_prefix", "Observed at head block #") + headN + " (" + r.via + ").", "xfer-ok");
                okP.setAttribute("aria-live", "polite"); actBox.appendChild(okP);
                actBox.appendChild(DOM.el(doc, "p",
                  amtHuman + " → " + a.symbol + t("explorer.pool_delta_suffix", " pool (re-read delta matches)."), "muted"));
                var backLink = anchor(doc, t("explorer.open_prefix", "Open ") + a.symbol, "#/asset/" + a.symbol);
                actBox.appendChild(backLink);
              })().catch(function (e) {
                try { actBox.removeChild(st); } catch (x) { /* gone */ }
                var m = (e && e.message) ? e.message : String(e || t("explorer.send_failed", "Send failed."));
                if (m.indexOf("wallet-locked") !== -1) m = t("explorer.wallet_locked_msg", "Wallet is locked.");
                else if (m.indexOf("not-connected") !== -1 || m.indexOf("not connected") !== -1) {
                  m = t("explorer.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
                }
                fundMsg(m, true); back.disabled = false;
              });
            });
          })().catch(function (e) {
            review.disabled = false;
            var m = (e && e.message) ? e.message : String(e || t("explorer.prepare_failed", "Could not prepare the funding."));
            fundMsg(m, true);
          });
        });
      })();
      actBox.appendChild(DOM.el(doc, "p",
        t("explorer.claim_deferred", "Fee-pool claiming (issuer) stays deferred here — no claim serializer in this view."), "muted"));
      if (!j.is_smartcoin) {
        infoBox.appendChild(DOM.el(doc, "p", t("explorer.not_smartcoin", "Not a smartcoin — no price feeds."), "muted"));
        return;
      }
      infoBox.appendChild(DOM.el(doc, "h2", t("explorer.feeds_h", "Price feeds")));
      var feedBox = DOM.el(doc, "div", null, "xplore-feed");
      infoBox.appendChild(feedBox);
      showStatus(doc, feedBox, t("explorer.loading_feeds", "Loading feeds…"));
      Explorer.feeds([a.symbol]).then(function (rows) {
        if (!isCurrent(myGen)) return;
        DOM.clear(feedBox);
        var f = (rows || [])[0];
        if (!f || !f.is_smartcoin || !f.settlement_raw) {
          feedBox.appendChild(DOM.el(doc, "p", t("explorer.no_feeds", "No live feeds published.") + t("explorer.feeds_hint", " Feeds appear once publishers publish for an asset."), "muted"));
          return;
        }
        /* Feed health strip (survey verdict ADAPT: witness-monitor
         * pricefeed.js publisher math — CER ~= settlement price * premium,
         * MCR/MSSR x1000 ratios, per-asset isolated failures, stale =
         * publication time + lifetime). Read-only math over the
         * already-fetched bitasset join (bitObj, via Explorer.asset's
         * get_objects) + the feeds() row (f): NO new chain calls — any
         * missing field renders "—" with its raw title, never guessed,
         * never fabricated. Reference: #1 Asset.jsx:738-748 (MCR/MSSR
         * /1000), Asset.jsx:1668-1679 (stale filter pubtime + lifetime,
         * feeds[][0] publisher / [][1][0] timestamp); chain truth
         * asset_object.hpp:268 (feeds map publisher -> [time, feed]),
         * :274 (current_feed_publication_time = oldest factored feed). */
        (function feedHealth() {
          var bo = bitObj || {};
          var cur = (bo.current_feed && typeof bo.current_feed === "object") ? bo.current_feed : null;
          var health = DOM.el(doc, "div", null, "xplore-feed-health");
          /* Badge: LIVE / STALE / AGE UNKNOWN. The "No live feeds" empty
           * state above owns the missing-feed case — this badge only ages
           * an existing settlement price, never invents one. */
          var pubRaw = (typeof bo.current_feed_publication_time === "string")
            ? bo.current_feed_publication_time : null;
          var lifeRaw = (f.feed_lifetime_sec !== null && f.feed_lifetime_sec !== undefined)
            ? f.feed_lifetime_sec : (bo.options && bo.options.feed_lifetime_sec);
          var pubMs = NaN;
          try { pubMs = pubRaw ? Date.parse(/Z$/.test(pubRaw) ? pubRaw : pubRaw + "Z") : NaN; }
          catch (e) { pubMs = NaN; }
          var lifeOk = /^\d+$/.test(String((lifeRaw === undefined || lifeRaw === null) ? "" : lifeRaw));
          var badge = DOM.el(doc, "p", null, null);
          var strong = doc.createElement("strong");
          if (isFinite(pubMs) && lifeOk) {
            var fresh = Date.now() < pubMs + parseInt(String(lifeRaw), 10) * 1000;
            strong.textContent = fresh
              ? t("explorer.feed_badge_live", "LIVE")
              : t("explorer.feed_badge_stale", "STALE — feed expired");
            badge.title = t("explorer.feed_badge_title", "oldest factored feed %(pub)s; lifetime %(life)ss", { pub: String(pubRaw), life: String(lifeRaw) });
            if (!fresh) badge.className = "error";
          } else {
            strong.textContent = t("explorer.feed_badge_unknown", "FEED AGE UNKNOWN");
            badge.title = t("explorer.feed_badge_unknown_title", "publication time or lifetime missing");
          }
          badge.appendChild(strong);
          health.appendChild(badge);
          var hdl = DOM.el(doc, "dl", null, "xplore-fields");
          health.appendChild(hdl);
          /* rowInto: dt + dd with human text + raw title (dash-on-missing
           * contract shared with humanRowInto above). Params term, human,
           * rawTitle; never throws. */
          function rowInto(term, human, rawTitle) {
            hdl.appendChild(DOM.el(doc, "dt", term));
            var dd = DOM.el(doc, "dd", human);
            if (rawTitle !== undefined && rawTitle !== null) dd.title = String(rawTitle);
            hdl.appendChild(dd);
          }
          /* cerPremiumBps: CER-vs-settlement premium in hundredths of a
           * percent (800 = +8.00%), exact BigInt ratio math. Leg precisions
           * resolve from already-fetched ids only (own asset id -> prec,
           * settlement quote id -> f.quote_precision); anything
           * unresolvable -> null (caller renders "—"). Never float.
           * @param {any} cer core_exchange_rate price object (or null)
           * @param {any} settle settlement price object (or null)
           * @returns {bigint|null} signed premium bps, or null when missing */
          function cerPremiumBps(cer, settle) {
            try {
              if (!cer || !settle || !cer.base || !cer.quote || !settle.base || !settle.quote) return null;
              var sqId = settle.quote.asset_id;
              var ids = [cer.base.asset_id, cer.quote.asset_id, settle.base.asset_id, settle.quote.asset_id];
              var amts = [cer.base.amount, cer.quote.amount, settle.base.amount, settle.quote.amount];
              var precs = [];
              for (var i = 0; i < 4; i++) {
                if (typeof ids[i] !== "string") return null;
                if (ids[i] === a.id) precs.push(prec);
                else if (typeof sqId === "string" && ids[i] === sqId &&
                  f.quote_precision !== null && f.quote_precision !== undefined) precs.push(f.quote_precision);
                else return null;
                if (!/^\d+$/.test(String(amts[i]))) return null;
                if (!Number.isInteger(precs[i]) || precs[i] < 0 || precs[i] > 18) return null;
              }
              var cB = BigInt(String(amts[0])), cQ = BigInt(String(amts[1]));
              var sB = BigInt(String(amts[2])), sQ = BigInt(String(amts[3]));
              if (cQ === 0n || sB === 0n || sQ === 0n) return null;
              /* ratio = cerReal/setReal = cB*10^p1*sQ*10^p2 / cQ*10^p0*sB*10^p3 */
              function p10(n) { var r = 1n; for (var k = 0; k < n; k++) r *= 10n; return r; }
              var rn = cB * p10(precs[1]) * sQ * p10(precs[2]);
              var rd = cQ * p10(precs[0]) * sB * p10(precs[3]);
              if (rd === 0n) return null;
              var diff = rn - rd;
              var neg = diff < 0n, absD = neg ? -diff : diff;
              var qq = (absD * 10000n) / rd, rem = (absD * 10000n) % rd;
              if (rem * 2n >= rd) qq += 1n; /* half-up at the bps digit */
              return neg ? -qq : qq;
            } catch (e) { return null; }
          }
          /* Signed bps -> "+8.00%" / "-0.25%"; BigInt math, never float. */
          function fmtBps(bps) {
            var neg = bps < 0n, m = neg ? -bps : bps;
            return (neg ? "-" : "+") + (m / 100n).toString() + "." +
              (m % 100n).toString().padStart(2, "0") + "%";
          }
          var cer = cur ? cur.core_exchange_rate : null;
          var bps = cerPremiumBps(cer, f.settlement_raw);
          if (bps === null) {
            rowInto(t("explorer.feed_cer_premium", "CER premium (publisher-rule estimate)"), "—",
              cer ? t("explorer.feed_cer_uncomputable", "core_exchange_rate present but premium not computable from fetched legs")
                : t("explorer.feed_cer_missing", "core_exchange_rate missing"));
          } else {
            rowInto(t("explorer.feed_cer_premium", "CER premium (publisher-rule estimate)"), fmtBps(bps),
              t("explorer.feed_cer_title", "cer base %(cb)s / quote %(cq)s vs settle base %(sb)s / quote %(sq)s",
                { cb: String(cer.base.amount), cq: String(cer.quote.amount), sb: String(f.settlement_raw.base.amount), sq: String(f.settlement_raw.quote.amount) }));
          }
          /* MCR / MSSR via the file-local ratio1000 (same #1 /1000
           * convention as the fieldRow pair below — strip is the summary). */
          function ratioOrDash(v) {
            if (v === null || v === undefined || !/^\d+$/.test(String(v))) return null;
            try { return ratio1000(String(v)); } catch (e) { return null; }
          }
          var mcrH = ratioOrDash(f.mcr), mssrH = ratioOrDash(f.mssr_hundredths);
          rowInto(t("explorer.feed_mcr_mssr", "MCR / MSSR"),
            (mcrH === null && mssrH === null) ? "—" : ((mcrH || "—") + " / " + (mssrH || "—")),
            t("explorer.feed_mcr_mssr_title", "mcr %(mcr)s; mssr %(mssr)s", { mcr: String(f.mcr), mssr: String(f.mssr_hundredths) }));
          /* ageText: chain UTC timestamp ms -> "5 hours ago", reusing
           * lifetimeText's existing explorer.*_unit keys (wall-clock
           * only, never money). */
          function ageText(ms) {
            var s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
            return lifetimeText(String(s)) + t("explorer.feed_ago_suffix", " ago");
          }
          hdl.appendChild(DOM.el(doc, "dt", t("explorer.feed_last_update", "Last update")));
          var luDd = doc.createElement("dd");
          if (isFinite(pubMs)) { luDd.textContent = ageText(pubMs); luDd.title = String(pubRaw); }
          else { luDd.textContent = "—"; luDd.title = t("explorer.feed_pubtime_missing", "current_feed_publication_time missing"); }
          hdl.appendChild(luDd);
          /* feeds map: chain flat_map serializes as [[pubId, [ts, feed]]]
           * pairs (#1 Asset.jsx:1665); tolerate a plain-object shape too.
           * Latest = max timestamp; count = valid publisher entries. */
          var entries = [];
          try {
            var fm = bo.feeds;
            if (Array.isArray(fm)) entries = fm;
            else if (fm && typeof fm === "object") {
              entries = Object.keys(fm).map(function (k) { return [k, fm[k]]; });
            }
          } catch (e) { entries = []; }
          var count = 0, latestId = null, latestMs = NaN, latestRaw = null;
          entries.forEach(function (en) {
            var pid = en && en[0], ts = en && en[1] && en[1][0];
            if (typeof pid !== "string" || !ACCT_RE.test(pid)) return;
            count++;
            var ms = NaN;
            try { ms = (typeof ts === "string") ? Date.parse(/Z$/.test(ts) ? ts : ts + "Z") : NaN; }
            catch (e2) { ms = NaN; }
            if (isFinite(ms) && !(ms <= latestMs)) { latestMs = ms; latestId = pid; latestRaw = ts; }
          });
          hdl.appendChild(DOM.el(doc, "dt", t("explorer.feed_publishers", "Publishers")));
          var pubDd = doc.createElement("dd");
          if (count > 0 && latestId) {
            pubDd.appendChild(doc.createTextNode(String(count) + " — latest "));
            pubDd.appendChild(ExplorerRender.accountLink(doc, latestId, myGen));
            if (isFinite(latestMs)) pubDd.appendChild(doc.createTextNode(" (" + ageText(latestMs) + ")"));
            pubDd.title = t("explorer.feed_publisher_title", "%(id)s @ %(ts)s", { id: String(latestId), ts: String(latestRaw) });
          } else { pubDd.textContent = "—"; pubDd.title = t("explorer.feed_feeds_missing", "feeds missing"); }
          hdl.appendChild(pubDd);
          feedBox.appendChild(health);
        })();
        var fdl = DOM.el(doc, "dl", null, "xplore-fields");
        function priceRow(term, pair) {
          fdl.appendChild(DOM.el(doc, "dt", term));
          var dd = doc.createElement("dd");
          if (!pair || f.quote_precision === null || f.quote_precision === undefined) {
            dd.textContent = t("explorer.unavailable_quote", "unavailable (quote precision unknown)");
          } else {
            try {
              dd.textContent = Format.formatPrice(String(pair.base.amount), f.base_precision,
                String(pair.quote.amount), f.quote_precision, PRICE_PLACES);
              dd.title = t("explorer.price_base", "base ") + pair.base.amount + " / quote " + pair.quote.amount;
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
          fdl.appendChild(DOM.el(doc, "dt", t("explorer.feed_lifetime", "Feed lifetime")));
          var lt = doc.createElement("dd");
          lt.textContent = lifetimeText(f.feed_lifetime_sec);
          lt.title = String(f.feed_lifetime_sec) + t("explorer.seconds_unit", " seconds");
          fdl.appendChild(lt);
        }
        if (f.min_feeds !== null && f.min_feeds !== undefined) {
          fdl.appendChild(DOM.el(doc, "dt", t("explorer.min_feeds", "Minimum feeds")));
          var mf = doc.createElement("dd");
          mf.textContent = String(f.min_feeds);
          fdl.appendChild(mf);
        }
        feedBox.appendChild(fdl);
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        DOM.clear(feedBox);
        showError(doc, feedBox, e, t("explorer.feeds_failed", "Could not load feeds."));
      });
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      DOM.clear(wrap);
      wrap.appendChild(DOM.pageHead(doc, t("explorer.asset_prefix", "Asset ") + symbol, "insight"));
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
        DOM.clear(body);
        showError(doc, body, e, t("explorer.scan_failed", "Could not scan assets."));
      });
    }
    function paint() {
      DOM.clear(body);
      if (found.length === 0) {
        body.appendChild(DOM.el(doc, "p",
          t("explorer.no_smartcoins", "No smartcoins with feeds found on this node. User-issued assets show here once they publish feeds."), "muted"));
        return;
      }
      showStatus(doc, body, t("explorer.loading_feeds_for", "Loading feeds for ") + found.length + t("explorer.asset_count_suffix", " asset(s)…"));
      Explorer.feeds(found).then(function (rows) {
        if (!isCurrent(myGen)) return;
        DOM.clear(body);
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
        DOM.clear(body);
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
    _test: { pctHundredths: pctHundredths, ratio1000: ratio1000, lifetimeText: lifetimeText, parseHolders: _parseHolders }
  };
})();

if (typeof module !== "undefined") { module.exports = ExplorerAssets; }
