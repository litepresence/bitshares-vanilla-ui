/* prediction-ui.js — #/prediction + #/prediction/:market honest-scope views.
 * Owns: PMA LIST (bounded list_assets scan + symbol search, open/settled
 *   filter, hide-unknown-houses + hide-invalid-assets client filters) and
 *   PMA detail (issuer, settlement status/price, feed) with
 *   deep-links into the existing #/market/QUOTE_BASE desk for YES/NO
 *   positioning. LIST columns per row: Asset / Description / Condition /
 *   Expiry / Validity / House / Market confidence / Predicted likelihood /
 *   Market (desk link, asset-page fallback) / Details (-> #/prediction/:id).
 *   Description trio parses the scan row's options.description JSON only
 *   (dash when unreadable — no new chain reads); validity is invalidReason()
 *   or dash; Market targets verified routes (router.js /market/:marketID,
 *   /asset/:symbol); Details targets /prediction/:market. Positions ARE
 *   limit orders on the pair, so NO new serializers, no signing, no fee
 *   math in this file. All reads public, no login gate.
 * Consumes: Explorer (assetsPage/asset/feeds joins), Asset.describe,
 *   Format (amount/price display only), Chain (backing-symbol lookup),
 *   Store ("connection" resubscribe). Globals/side effects: exposes global
 *   PredictionUI only; DOM under the given root; Store subscriptions dropped
 *   on every entry (generation counter).
 * Refs: #1 PredictionMarkets.jsx list concepts only — description/condition/
 *   expiry + market button per row (:368-419 open/past filter + search,
 *   :492-618 overview section + OverviewTable columns); opinions ARE
 *   orderbook rows :104-160 (NOT copied — detail links to the live desk);
 *   resolve = global_settle :341-372 — NOT reimplemented, issuer-only
 *   signing lives in AssetManage);
 *   PMAssetsContainer.jsx:121-127 (_isPredictionMarket = bitasset_data
 *   .is_prediction_market; :92-104 whitelist comes from an on-chain config
 *   asset that testnet does not publish, so no whitelist here — bounded
 *   scan instead); OverviewTable (:384-402 ticker per row — NOT copied,
 *   detail links to the live desk instead); #2 has no prediction page;
 *   slice-10 PMA support: asset-ops.js builders (op-10 +
 *   is_prediction_market:true) + tx.js:913-929 serializer.
 * Created by: stub-queue build (matrix §A row A30, LAST stub group).
 * CHAIN TRUTH (#4 wins): list_assets <- database_api.hpp; bitasset objects
 *   carry is_prediction_market + settlement_fund (protocol/asset.hpp);
 *   description JSON {main, condition, expiry} is a #1 convention
 *   (asset_utils.js parseDescription), parsed defensively, never trusted.
 */
var PredictionUI = (function () {
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
  var SCAN_PAGES = 8, PAGE_SIZE = 25; /* bounded: 200 assets max per entry */
  var openSubs = [];
  function dropOpenSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }

  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(box) { while (box.firstChild) box.removeChild(box.firstChild); }

  function missingBackends() {
    var need = ["Explorer", "Asset", "Format", "Chain", "Store"], miss = null;
    need.forEach(function (g) { if (typeof globalThis[g] === "undefined") miss = g; });
    return miss;
  }
  function showError(doc, wrap, e, fallback) {
    var m = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("prediction.unexpected_error", "Unexpected error"));
    var map = [["not-connected", t("prediction.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.")],
      ["unknown-asset", t("prediction.asset_not_found_on_this_network", "Asset not found on this network.")],
      ["not-a-pma", t("prediction.that_asset_is_not_a_prediction_market_no_is_p", "That asset is not a prediction market (no is_prediction_market flag).")]];
    if (m.indexOf("not connected") !== -1) m = map[0][1];
    for (var i = 0; i < map.length; i++) if (m.indexOf(map[i][0]) !== -1) { m = map[i][1]; break; }
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function retryButton(doc, wrap, retryFn) {
    var b = touchable(el(doc, "button", t("prediction.retry", "Retry"))); b.type = "button";
    b.addEventListener("click", retryFn); wrap.appendChild(b);
  }
  function autoRetryOnOpen(myGen, retryFn) {
    try {
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (myGen !== gen) { settled = true; try { off(); } catch (e) {} return; }
        if (st && st.state === "open") {
          settled = true; try { off(); } catch (e) {}
          if (typeof location === "undefined" || location.hash === hashAtEntry) retryFn();
        }
      });
      openSubs.push(off);
    } catch (e) { /* manual Retry remains */ }
  }

  /* Description JSON -> {main, condition, expiry} strings (never throws:
   * plain text / missing keys / bad JSON yield ""). Mirrors #1's
   * parseDescription + forPredictions.description convention. */
  function parsePMADescription(description) {
    var out = { main: "", condition: "", expiry: "" };
    if (typeof description !== "string" || !description) return out;
    var parsed = null;
    try { parsed = JSON.parse(description); } catch (e) { return { main: description, condition: "", expiry: "" }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { main: description, condition: "", expiry: "" };
    ["main", "condition", "expiry"].forEach(function (k) {
      if (typeof parsed[k] === "string") out[k] = parsed[k];
      else if (typeof parsed[k] === "number") out[k] = String(parsed[k]);
    });
    return out;
  }

  /* Validity bar copied from #1 PredictionMarkets.jsx:75-102 (valid-date +
   * description lengths + market fee < 10%). Params: asset join row
   * {asset, bitasset}. Returns "" when valid, else a short reason. */
  function invalidReason(row) {
    var a = row.asset || {}, opts = a.options || {};
    var d = parsePMADescription(typeof opts.description === "string" ? opts.description : "");
    if (!d.condition || !d.main) return t("prediction.missing_condition_description", "missing condition/description");
    if (d.condition.length < 10 || d.main.length < 20) return t("prediction.description_too_short", "description too short");
    if (d.expiry) { var dt = new Date(d.expiry); if (dt instanceof Date && isNaN(dt.getTime())) return t("prediction.bad_expiry_date", "bad expiry date"); }
    if ((opts.market_fee_percent || 0) / 100 >= 10) return t("prediction.market_fee_10", "market fee ≥ 10%");
    return "";
  }

  /* Bounded PMA scan: list_assets pages ("" bound, PAGE_SIZE) then ONE
   * batched get_objects for bitasset_data_ids, keeping rows whose bitasset
   * has is_prediction_market === true. Returns {rows, scanned, truncated}.
   * Fails "not-connected". No efficient chain query exists (#1 paginates
   * ALL assets the same way), so the bound + symbol search below are the
   * honest scope. */
  async function scanPMAs() {
    var seen = [], lower = "", pages = 0, truncated = false;
    for (;;) {
      var page = await Explorer.assetsPage(lower, PAGE_SIZE);
      if (!page || !page.length) break;
      seen = seen.concat(page);
      pages++;
      lower = page[page.length - 1].symbol;
      if (page.length < PAGE_SIZE || pages >= SCAN_PAGES) {
        if (page.length === PAGE_SIZE && pages >= SCAN_PAGES) truncated = true;
        break;
      }
    }
    var want = [], byBitId = {};
    seen.forEach(function (a) {
      if (a && a.bitasset_data_id) { want.push(a.bitasset_data_id); byBitId[a.bitasset_data_id] = a; }
    });
    var rows = [];
    if (want.length) {
      var dbId = await Chain.db();
      var objs = await Chain.call(dbId, "get_objects", [want]);
      (objs || []).forEach(function (b) {
        if (b && b.is_prediction_market === true && byBitId[b.id]) {
          rows.push({ asset: byBitId[b.id], bitasset: b });
        }
      });
    }
    return { rows: rows, scanned: seen.length, truncated: truncated };
  }

  function settledOf(row) {
    var b = row.bitasset || {};
    return (b.settlement_fund || 0) > 0;
  }

  /* One LIST row: Asset / Description / Condition / Expiry / Validity /
   * House / Market confidence / Predicted likelihood / Market / Details.
   * The description trio comes from the scan row's options.description JSON
   * only (parsePMADescription, #1 asset_utils.js convention) — dash when
   * unreadable, never a new chain read. Validity is invalidReason() or
   * dash. Market targets the live #/market/QUOTE_BASE desk when the backing
   * symbol resolved, else the #/asset/SYMBOL page (both routes verified in
   * router.js: /market/:marketID + /asset/:symbol); Details targets
   * #/prediction/SYMBOL (/prediction/:market). Enrich gaps (house,
   * confidence, likelihood) show "—", never raw integers, never throw. */
  function appendRow(doc, tbody, row, filter, enrich) {
    var a = row.asset, d = parsePMADescription((a.options || {}).description || "");
    var settled = settledOf(row);
    if (filter === "open" && settled) return false;
    if (filter === "settled" && !settled) return false;
    enrich = enrich || {};
    var tr = doc.createElement("tr");
    function cell(text) { var td = doc.createElement("td"); td.textContent = text; return td; }
    function linkCell(href, label) {
      var td = doc.createElement("td");
      var link = doc.createElement("a"); link.href = href; link.textContent = label;
      touchable(link); td.appendChild(link);
      return td;
    }
    var sym = a.symbol || a.id;
    tr.appendChild(cell(sym || "—"));
    tr.appendChild(cell(d.main || "—"));
    tr.appendChild(cell(d.condition || "—"));
    tr.appendChild(cell(d.expiry || "—"));
    tr.appendChild(cell(invalidReason(row) || "—"));
    tr.appendChild(cell(enrich.house || "—"));
    tr.appendChild(cell(enrich.conf || "—"));
    tr.appendChild(cell(enrich.like || "—"));
    if (sym) {
      if (enrich.backSym) {
        tr.appendChild(linkCell("#/market/" + encodeURIComponent(sym) + "_" +
          encodeURIComponent(enrich.backSym), t("borrow.market", "Market")));
      } else {
        tr.appendChild(linkCell("#/asset/" + encodeURIComponent(sym),
          t("borrow.market", "Market")));
      }
      tr.appendChild(linkCell("#/prediction/" + encodeURIComponent(sym),
        t("prediction.details", "Details")));
    } else {
      tr.appendChild(cell("—"));
      tr.appendChild(cell("—"));
    }
    tbody.appendChild(tr);
    return true;
  }

  /* #/prediction — list. Search filters scanned rows; the symbol box resolves
   * one asset directly (covers PMAs outside the scan bound). */
  function renderList(root) {
    if (!root) return;
    var doc = root.ownerDocument || document, myGen = ++gen, miss = missingBackends();
    dropOpenSubs();
    clearBox(root);
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", t("prediction.prediction_markets", "Prediction Markets")));
    wrap.appendChild(el(doc, "p", t("prediction.prediction_market_assets_yes_no_shares_positi", "Prediction-market assets (YES/NO shares). Positions are ordinary limit orders on the asset's market — open a market below and trade from the desk."), "muted"));
    if (miss) { showError(doc, wrap, "Prediction backend missing: " + miss + " failed to load."); return; }
    var self = function () { if (myGen === gen) renderList(root); };

    var toolbar = el(doc, "div", null, "toolbar"); wrap.appendChild(toolbar);
    var search = doc.createElement("input");
    search.type = "search"; search.placeholder = t("prediction.filter_by_symbol_or_condition", "Filter by symbol or condition…");
    search.setAttribute("aria-label", t("prediction.filter_prediction_markets", "Filter prediction markets")); touchable(search);
    toolbar.appendChild(search);
    var filterSel = doc.createElement("select");
    filterSel.setAttribute("aria-label", t("prediction.open_or_settled_filter", "Open or settled filter")); touchable(filterSel);
    [["open", t("prediction.open", "Open")], ["settled", t("prediction.settled", "Settled")], ["all", t("prediction.all", "All")]].forEach(function (pr) {
      var o = doc.createElement("option"); o.value = pr[0]; o.textContent = pr[1]; filterSel.appendChild(o);
    });
    toolbar.appendChild(filterSel);
    var sym = doc.createElement("input");
    sym.type = "text"; sym.placeholder = t("prediction.look_up_symbol_or_1_3_x_id", "Look up symbol or 1.3.x id…");
    sym.setAttribute("aria-label", t("prediction.look_up_a_prediction_asset_directly", "Look up a prediction asset directly")); touchable(sym);
    toolbar.appendChild(sym);
    var go = touchable(el(doc, "button", t("prediction.open", "Open"))); go.type = "button"; toolbar.appendChild(go);
    go.addEventListener("click", function () {
      var v = (sym.value || "").trim();
      if (v) location.hash = "#/prediction/" + encodeURIComponent(v);
    });
    /* MED create button (#1 PredictionMarkets.jsx create_market modal entry):
     * vanilla creates under the existing #/assets/create PMA tab (verified:
     * router.js maps /assets/create -> AssetUI.renderCreate, which draws a
     * PMA tab locking is_prediction_market ON). Batch-3 i18n: keyed. */
    var mk = touchable(el(doc, "button", t("prediction.create_prediction_market", "Create prediction market"))); mk.type = "button";
    toolbar.appendChild(mk);
    mk.addEventListener("click", function () { location.hash = "#/assets/create"; });
    /* MED client-side toggles (#1 PredictionMarkets.jsx:37-38 defaults ON,
     * :378-400 _filterMarkets): unknown house = issuer name unresolvable on
     * this network; invalid = invalidReason() non-empty. Batch-3 i18n: keyed. */
    var toggleRow = el(doc, "div", null, "toolbar"); wrap.appendChild(toggleRow);
    function checkBox(labelText, checked) {
      var lab = doc.createElement("label");
      var box = doc.createElement("input"); box.type = "checkbox"; box.checked = !!checked;
      touchable(box); lab.appendChild(box);
      lab.appendChild(doc.createTextNode(" " + labelText));
      toggleRow.appendChild(lab);
      return box;
    }
    var chkU = checkBox(t("prediction.hide_unknown_houses", "Hide unknown houses"), true);
    var chkI = checkBox(t("prediction.hide_invalid_assets", "Hide invalid assets"), true);
    wrap.appendChild(el(doc, "p", t("prediction.new_markets_are_created_under_assets_", "New markets are created under Assets → Create → PMA tab (#/assets/create). Unknown house = issuer name not resolvable on this network."), "muted"));

    var status = showStatus(doc, wrap, t("prediction.scanning_assets_for_prediction_markets", "Scanning assets for prediction markets…"));
    var tableWrap = el(doc, "div", null, "table-scroll prediction-scroll"); wrap.appendChild(tableWrap);
    var note = el(doc, "p", "", "muted"); wrap.appendChild(note);
    var createP = el(doc, "p", "", "muted"); wrap.appendChild(createP);
    var ca = doc.createElement("a"); ca.href = "#/assets/create"; ca.textContent = t("prediction.create_one_under_assets_create_pma_tab", "Create one under Assets → Create (PMA tab)");
    createP.textContent = "No market you expected? The scan covers the first " + (SCAN_PAGES * PAGE_SIZE) +
      " assets — use the lookup box above, or ";
    createP.appendChild(ca); createP.appendChild(doc.createTextNode("."));

    var cache = { rows: [], scanned: 0, truncated: false };
    /* Per-asset enrichment from clean reads only (dash otherwise): house =
     * issuer name via Account.resolve, confidence/likelihood = get_ticker
     * (backing, asset), desk backing symbol via backingSymbol. Entries:
     * {done, house, conf, like, backSym}. Filled once per asset; paint
     * re-runs when a fill lands (gen-guarded). */
    var enrichCache = {};
    function enrichKey(row) {
      var a = row && row.asset;
      return (a && (a.id || a.symbol)) || "";
    }
    function cleanNum(s) {
      return typeof s === "string" && /^\d+(\.\d+)?$/.test(s) && s !== "0" && s !== "1" &&
        s !== "NaN" && s !== "-NaN";
    }
    /* enrichRow: house/confidence/likelihood/backing for one PMA row (3 best-effort reads).
     * WHY all-dash fallback: issuer/ticker/backing gaps must not blank the list row.
     * Param row (scan row); returns {done, house, conf, like, backSym}. */
    async function enrichRow(row) {
      var out = { done: true, house: null, conf: null, like: null, backSym: null };
      var a = row.asset || {}, b = row.bitasset || {};
      try {
        if (a.issuer) {
          var acc = await Account.resolve(a.issuer);
          if (acc && acc.name) out.house = acc.name;
        }
      } catch (e) { /* unknown house stands */ }
      var backId = b.short_backing_asset ||
        (a.options && a.options.core_exchange_rate && a.options.core_exchange_rate.base &&
          a.options.core_exchange_rate.base.asset_id) || null;
      if (backId) {
        try { out.backSym = await backingSymbol(backId); } catch (e) { /* dash stands */ }
      }
      if (backId && a.id && out.backSym) {
        try {
          var dbId = await Chain.db();
          var tk = await Chain.call(dbId, "get_ticker", [backId, a.id]);
          if (tk && typeof tk === "object") {
            if (cleanNum(tk.quote_volume)) out.conf = String(tk.quote_volume) + " " + out.backSym;
            if (cleanNum(tk.latest)) {
              var pct = Number(tk.latest) * 100;
              if (isFinite(pct)) out.like = pct.toPrecision(3) + "%";
            }
          }
        } catch (e) { /* dashes stand */ }
      }
      return out;
    }
    function fillEnrich() {
      (cache.rows || []).forEach(function (row) {
        var k = enrichKey(row);
        if (!k || enrichCache[k]) return;
        enrichCache[k] = { done: false, house: null, conf: null, like: null, backSym: null };
        enrichRow(row).then(function (e) {
          if (myGen !== gen) return;
          enrichCache[k] = e;
          paint();
        }).catch(function () {
          if (myGen !== gen) return;
          enrichCache[k] = { done: true, house: null, conf: null, like: null, backSym: null };
          paint();
        });
      });
    }
    function paint() {
      clearBox(tableWrap);
      var q = (search.value || "").toUpperCase(), f = filterSel.value;
      var hideU = !!(chkU && chkU.checked), hideI = !!(chkI && chkI.checked);
      var table = doc.createElement("table"); table.className = "node-table";
      var thead = doc.createElement("thead"), hr = doc.createElement("tr");
      /* LIST columns (#1 OverviewTable concepts: description + condition +
       * expiry + market button per row, plus validity label + Details link;
       * scan enrichment kept alongside as confidence/likelihood). Headers
       * reuse existing dict keys only (no locale drift — see check_i18n). */
      [t("prediction.hdr_asset", "Asset"), t("explorer.description", "Description"), t("prediction.hdr_condition", "Condition"), t("prediction.hdr_expiry", "Expiry"), t("prediction.hdr_validity", "Validity"), t("prediction.house", "House"), t("prediction.market_confidence", "Market confidence"), t("prediction.predicted_likelihood", "Predicted likelihood"), t("borrow.market", "Market"), t("prediction.details", "Details")].forEach(function (h) {
        var th = doc.createElement("th"); th.textContent = h; th.setAttribute("scope", "col"); hr.appendChild(th);
      });
      thead.appendChild(hr); table.appendChild(thead);
      var tbody = doc.createElement("tbody"); table.appendChild(tbody);
      var shown = 0;
      cache.rows.forEach(function (row) {
        var a = row.asset, d = parsePMADescription((a.options || {}).description || "");
        if (q && ((a.symbol || "") + " " + d.condition + " " + d.main).toUpperCase().indexOf(q) === -1) return;
        if (hideI && invalidReason(row)) return;
        var k = enrichKey(row), en = enrichCache[k] || { done: false };
        if (hideU && en.done && !en.house) return;
        if (appendRow(doc, tbody, row, f, en.done ? en : {})) shown++;
      });
      if (!shown) {
        var tr = doc.createElement("tr"), td = doc.createElement("td");
        td.colSpan = 10;
        td.textContent = cache.rows.length
          ? "No prediction markets match this filter."
          : "No prediction-market assets in the scanned range. Try the lookup box above.";
        tr.appendChild(td); tbody.appendChild(tr);
      }
      tableWrap.appendChild(table);
      note.textContent = "Scanned " + cache.scanned + " assets, found " + cache.rows.length +
        " prediction market" + (cache.rows.length === 1 ? "" : "s") +
        (cache.truncated ? " (scan bound reached — lookup finds the rest)." : ".");
      fillEnrich();
    }
    search.addEventListener("input", paint);
    filterSel.addEventListener("change", paint);
    chkU.addEventListener("change", paint);
    chkI.addEventListener("change", paint);

    scanPMAs().then(function (r) {
      if (myGen !== gen) return;
      cache = r;
      status.textContent = "";
      paint();
    }).catch(function (e) {
      if (myGen !== gen) return;
      status.textContent = "";
      showError(doc, wrap, e, t("prediction.could_not_load_prediction_markets", "Could not load prediction markets."));
      retryButton(doc, wrap, self);
      autoRetryOnOpen(myGen, self);
    });
    autoRetryOnOpen(myGen, self);
  }

  /* Backing-asset symbol for a 1.3.x id (degrades to the bare id, never a
   * crash). Params: id. Returns symbol string. */
  async function backingSymbol(id) {
    try {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_assets", [[id]]);
      if (rows && rows[0] && rows[0].symbol) return rows[0].symbol;
    } catch (e) { /* bare id below */ }
    return id;
  }

  /* #/prediction/:market — detail. Issuer, settlement status/price, feed via
   * Explorer.feeds; YES/NO positioning deep-links to #/market/QUOTE_BASE
   * (positions ARE limit orders on the pair — no serializers here). */
  function renderDetail(root, market) {
    if (!root) return;
    var doc = root.ownerDocument || document, myGen = ++gen, miss = missingBackends();
    dropOpenSubs();
    clearBox(root);
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    var key = (market !== undefined && market !== null) ? String(market) : "";
    try { key = decodeURIComponent(key); } catch (e) { /* raw key stands */ }
    wrap.appendChild(el(doc, "h1", "Prediction Market" + (key ? ": " + key : "")));
    if (miss) { showError(doc, wrap, "Prediction backend missing: " + miss + " failed to load."); return; }
    if (!key) { showError(doc, wrap, "unknown-asset", t("prediction.no_market_given", "No market given.")); return; }
    var self = function () { if (myGen === gen) renderDetail(root, market); };
    var status = showStatus(doc, wrap, "Loading " + key + "…");

    Asset.describe(key).then(function (info) {
      if (myGen !== gen) return;
      if (!info.is_prediction_market) throw new Error("not-a-pma");
      return Explorer.feeds([info.symbol]).then(function (feeds) {
        if (myGen !== gen) return;
        var feed = (feeds && feeds[0]) || null;
        return backingSymbol(info.bitasset ? info.bitasset.short_backing_asset : "1.3.0").then(function (backSym) {
          if (myGen !== gen) return;
          clearBox(wrap);
          wrap.appendChild(el(doc, "h1", "Prediction Market: " + info.symbol));
          var d = parsePMADescription(info.description || "");
          if (d.main) wrap.appendChild(el(doc, "p", d.main));
          if (d.condition) wrap.appendChild(el(doc, "p", "Condition: " + d.condition));
          if (d.expiry) wrap.appendChild(el(doc, "p", "Expiry: " + d.expiry));

          var dl = doc.createElement("dl");
          function row(k, v) {
            var dt = doc.createElement("dt"); dt.textContent = k; dl.appendChild(dt);
            var dd = doc.createElement("dd"); dd.textContent = v; dl.appendChild(dd);
          }
          row(t("prediction.asset", "Asset"), info.symbol + " (" + info.id + ")");
          row(t("prediction.issuer", "Issuer"), (info.issuer_name || info.issuer_id || "—"));
          row(t("prediction.backing_asset", "Backing asset"), backSym);
          if (info.supply_raw !== null && info.supply_raw !== undefined) {
            try { row(t("prediction.current_supply", "Current supply"), Format.formatAmount(info.supply_raw, info.precision) + " " + info.symbol); }
            catch (e) { row(t("prediction.current_supply", "Current supply"), String(info.supply_raw)); }
          }
          /* Settlement status: settlement_fund > 0 means globally settled
           * (#1 _filterMarkets :419-421). Asset.describe does not join the
           * fund, so re-read the bitasset object via Explorer.asset. */
          Explorer.asset(info.symbol).then(function (join) {
            if (myGen !== gen) return;
            var b = (join && join.bitasset) || {};
            var fund = (b.settlement_fund !== undefined && b.settlement_fund !== null) ? String(b.settlement_fund) : "0";
            var isSettled = false;
            try { isSettled = BigInt(fund) > 0n; } catch (e) { isSettled = fund !== "0"; }
            var sRow = doc.createElement("dt"); sRow.textContent = t("prediction.settlement", "Settlement");
            dl.appendChild(sRow);
            var sVal = doc.createElement("dd");
            sVal.textContent = isSettled ? t("prediction.settled_global_settlement_executed", "Settled (global settlement executed)") : t("prediction.open_not_settled", "Open (not settled)");
            dl.appendChild(sVal);
            if (isSettled) {
              var fRow = doc.createElement("dt"); fRow.textContent = t("prediction.settlement_fund", "Settlement fund");
              dl.appendChild(fRow);
              var fVal = doc.createElement("dd");
              try { fVal.textContent = Format.formatAmount(fund, info.precision) + " " + info.symbol; }
              catch (e) { fVal.textContent = fund; }
              dl.appendChild(fVal);
            }
          }).catch(function () { /* status row stays absent, never a crash */ });

          /* Feed / settlement price: raw pair + human string with BOTH
           * precisions (principle #6 — Format.formatPrice, never raw). */
          if (feed && feed.settlement_raw) {
            var sp = feed.settlement_raw, base = sp.base || sp.quote, quote = sp.quote || sp.base;
            var qp = (feed.quote_precision === null || feed.quote_precision === undefined)
              ? feed.base_precision : feed.quote_precision;
            /* Zero/missing legs mean an empty default feed, not a price. */
            var usable = base && quote && base.amount !== undefined && base.amount !== null &&
              quote.amount !== undefined && quote.amount !== null &&
              String(base.amount) !== "0" && String(quote.amount) !== "0";
            var human = null;
            if (usable) {
              try {
                human = Format.formatPrice(String(base.amount), feed.base_precision,
                  String(quote.amount), qp, 6);
              } catch (e) { human = null; }
            }
            row(t("prediction.settlement_price", "Settlement price"), human !== null ? (human + " " + backSym + " per " + info.symbol) : "No usable feed published");
          } else {
            row(t("prediction.settlement_price", "Settlement price"), "No feed published");
          }
          wrap.appendChild(dl);

          var h = el(doc, "h3", t("prediction.take_a_position", "Take a position")); wrap.appendChild(h);
          wrap.appendChild(el(doc, "p", "YES and NO are ordinary limit orders on the " +
            info.symbol + " / " + backSym + " market. You trade from the desk — nothing here signs.", "muted"));
          var desk = doc.createElement("a");
          desk.href = "#/market/" + encodeURIComponent(info.symbol) + "_" + encodeURIComponent(backSym);
          desk.textContent = "Open " + info.symbol + " / " + backSym + " desk";
          touchable(desk); wrap.appendChild(desk);
          var more = el(doc, "p", "", "muted"); wrap.appendChild(more);
          var a1 = doc.createElement("a"); a1.href = "#/asset/" + encodeURIComponent(info.symbol);
          a1.textContent = t("prediction.asset_detail", "Asset detail"); more.appendChild(a1);
          more.appendChild(doc.createTextNode(" · "));
          var a2 = doc.createElement("a"); a2.href = "#/prediction";
          a2.textContent = t("prediction.all_prediction_markets", "All prediction markets"); more.appendChild(a2);
        });
      });
    }).catch(function (e) {
      if (myGen !== gen) return;
      status.textContent = "";
      showError(doc, wrap, e, t("prediction.could_not_load_this_prediction_market", "Could not load this prediction market."));
      retryButton(doc, wrap, self);
      autoRetryOnOpen(myGen, self);
    });
    autoRetryOnOpen(myGen, self);
  }

  return { renderList: renderList, renderDetail: renderDetail };
})();

if (typeof module !== "undefined") { module.exports = PredictionUI; }
