/* MarketNetUI: #/markets landing — asset search defaulting BTS, top-markets
 * table by 24h volume, lazy top-8 sparklines, pool-network band retargeted to
 * market desks.
 * Owns: search row (Asset 1 any-leg + optional Asset 2), ticker probing
 *   (X-as-base per counter so base_volume compares in X units; both
 *   orientations when two assets are typed, Pool.list both-orders precedent),
 *   volume-desc table (Market·Last·24h change·24h vol·7d sparkline), honest
 *   "top N of M probed" scope note, collapsible band (marketNetOpen, default
 *   open) mounting PoolNetUI with a navEdge override (pool edge -> market
 *   desk via the pool-leg map; unknown pools -> null, never pool default).
 * Consumes: MarketNet (candidates/rank/cache), Market.stats
 *   (get_ticker, database_api.hpp:618), Asset.describe (ids + precisions),
 *   MarketCandles.candles (top-8 7d sparklines only), Pool.list (pool
 *   counterparties + poolDeskMap edge->desk map, optional), PoolNetUI.mount + nav opts
 *   (Task 2 seam), Format (human strings at render only), I18n.t (all
 *   strings), DOM/Forms/touchable shared helpers (raw doc.createElement
 *   fallback when absent, Forms/TableRenderer pattern precedent).
 *   No signing, no ES reads (chain get_ticker/get_market_history only).
 * Created by: markets landing Task 3
 *   (plan docs/superpowers/plans/2026-10-07-market-net.md;
 *   spec docs/superpowers/specs/2026-10-07-market-net-design.md §3-§4).
 * DESK-ID RULE (Task 1 report, market-picker.js:382 + :590 authoritative):
 *   desk ids are QUOTE_BASE (quote = URL head). Rows probe X-as-base
 *   (stats(X, Y)) so base_volume compares in X units; the desk is therefore
 *   symB(counter/QUOTE) + "_" + symA(X/BASE), e.g. BTS/BTC -> BTC_BTS.
 *   Links are the bare id ("#/market/" + id), no transformation at link time.
 * MONEY DISCIPLINE (#6): volumes stay raw digit strings until
 *   Format.formatAmount at render (raw in title); latest/change are the
 *   chain's human strings (priceSig display only); Number() only for
 *   sparkline pixels and the 24h-sign test input magnitude — never money.
 * TABLE (shared-utilities rule): TableRenderer renders text cells only and
 *   documents links as per-view ("sorting, links, and cards stay per-view",
 *   table.js) — the Market column needs real desk anchors (copy-link,
 *   keyboard, SEO), so the table is hand-rolled on DOM helpers like
 *   pool-ui.js poolTable, not a second renderer.
 */
var MarketNetUI = (function () {
  "use strict";

  var gen = 0;
  var liveBands = [];
  var CAP = 20;
  var SPARK_N = 8;
  var OPEN_KEY = "marketNetOpen";
  var CURATED = {
    mainnet: ["BTS_USD", "BTS_CNY", "BTS_BTC", "BTS_ETH"],
    testnet: ["USD_TEST"]
  };

  /* Batch-2d i18n (pool-ui.js precedent): I18n.t with the verbatim English
   * default (file://-safe); raw default returns filled without I18n. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }

  function _dom() {
    if (typeof DOM !== "undefined" && DOM) return DOM;
    return null;
  }
  function floor(el) {
    if (el && typeof touchable === "function") { try { touchable(el); } catch (e) { /* stands */ } }
    return el;
  }

  /* mk: shared-DOM element (raw fallback for headless docs).
   * @param {Document} doc owner document.
   * @param {string} tag element tag. @param {string|null} text textContent.
   * @param {string|null} cls className. @returns {any} element. */
  function mk(doc, tag, text, cls) {
    var D = _dom();
    if (D) return D.el(doc, tag, text, cls);
    var el = doc.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function clearBox(box) {
    var D = _dom();
    if (D) { D.clear(box); return; }
    try { box.innerHTML = ""; } catch (e) { /* fallback below */ }
    try { if (box.children) box.children.length = 0; } catch (e2) { /* stands */ }
  }

  /* network: live network for the curated seed list (picker precedent:
   * Store is the sole settings owner; mainnet when unreadable).
   * @returns {string} "testnet"|"mainnet". Never throws. */
  function network() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* deskForProbe: QUOTE_BASE desk id for one ticker probe (Task 1 rule).
   * @param {string} baseSym BASE-leg symbol (X, the stats base).
   * @param {string} quoteSym QUOTE-leg symbol (counter, the stats quote).
   * @returns {string} QUOTE_BASE desk id (e.g. ("BTS","BTC") -> "BTC_BTS"). */
  function deskForProbe(baseSym, quoteSym) {
    return String(quoteSym) + "_" + String(baseSym);
  }

  /* hasVol: raw digit string with nonzero value (zero-volume rows render the
   * honest empty scope, never vanish silently — they count as probed).
   * @param {string} v raw base_volume. @returns {boolean}. Never throws. */
  function hasVol(v) {
    try {
      return typeof v === "string" && /^\d+$/.test(v) && /[1-9]/.test(v);
    } catch (e) { return false; }
  }

  /* chgSign: string-only 24h-change sign (picker chgSign precedent: display
   * text only, float never touches money — here the input is already a
   * display percent string).
   * @param {string} s trimmed percent_change text. @returns {string}
   *   "pos"|"neg"|"zero"|"muted". */
  function chgSign(s) {
    var m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(s || "").trim());
    if (!m) return "muted";
    var digits = (m[2] + (m[3] || "")).replace(/^0+/, "");
    if (!digits) return "zero";
    return m[1] === "-" ? "neg" : "pos";
  }

  /* humanVol: raw volumes (X base + counter quote) -> "a X + b CP" via
   * Format at render; raw integers stay in the title (poolTable precedent).
   * @param {string} baseRaw X-leg raw. @param {number} basePrec X precision.
   * @param {string} baseSym X symbol. @param {string} qRaw counter raw.
   * @param {number} qPrec counter precision. @param {string} qSym counter sym.
   * @returns {{text: string, raw: string}}. Never throws (raw fallback). */
  function humanVol(baseRaw, basePrec, baseSym, qRaw, qPrec, qSym) {
    var raw = String(baseRaw) + " / " + String(qRaw);
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function" &&
          typeof basePrec === "number" && typeof qPrec === "number") {
        return { text: Format.formatAmount(String(baseRaw), basePrec) + " " + baseSym +
          " + " + Format.formatAmount(String(qRaw), qPrec) + " " + qSym, raw: raw };
      }
    } catch (e) { /* raw below */ }
    return { text: String(baseRaw) + " " + baseSym + " + " + String(qRaw) + " " + qSym, raw: raw };
  }

  /* lastText: chain human latest -> 4-sf display (picker ps precedent),
   * full string stays on title. @param {string|null} s latest string.
   * @returns {{text: string, raw: string}}. Never throws. */
  function lastText(s) {
    var raw = (s === null || s === undefined) ? "" : String(s);
    if (!raw) return { text: "", raw: "" };
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.priceSig === "function") {
        return { text: Format.priceSig(raw), raw: raw };
      }
    } catch (e) { /* raw below */ }
    return { text: raw, raw: raw };
  }

  /* probeOne: single X-as-base ticker attempt (null when the pair has no
   * ticker — distinct from a zero-volume ticker, which stays probed).
   * @param {string} baseId stats base. @param {string} baseSym base symbol.
   * @param {string} quoteId stats quote. @param {string} quoteSym quote sym.
   * @returns {Promise<Object|null>} ticker row or null. Never throws. */
  function probeOne(baseId, baseSym, quoteId, quoteSym) {
    var M = (typeof Market !== "undefined" && Market) ? Market : null;
    if (!M || typeof M.stats !== "function") return Promise.resolve(null);
    return M.stats(baseId, quoteId).then(function (s) {
      if (!s || !s.raw || typeof s.raw !== "object") return null;
      var raw = s.raw;
      return {
        a: String(baseId), b: String(quoteId), symA: String(baseSym), symB: String(quoteSym),
        baseVol: (raw.base_volume !== undefined && raw.base_volume !== null) ? String(raw.base_volume) : "0",
        quoteVol: (raw.quote_volume !== undefined && raw.quote_volume !== null) ? String(raw.quote_volume) : "0",
        latest: (s.latest !== null && s.latest !== undefined) ? String(s.latest) : null,
        change: (raw.percent_change !== undefined && raw.percent_change !== null) ? String(raw.percent_change) : null
      };
    }).catch(function () { return null; });
  }

  /* themeAccent: --accent token or BitShares blue (pool-net-ui brandFill
   * precedent: core blue tracks the theme; sparkline is data ink).
   * @returns {string} CSS color. Never throws. */
  function themeAccent() {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue("--accent");
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return "#1E9ED7";
  }

  /* spark: lazy 7d sparkline into a canvas (top-8 only, caller-capped).
   * Chain get_market_history daily x7 via MarketCandles (1 call); any
   * failure leaves the "—" placeholder (never an error, never blank).
   * Number() here is chart pixels only, never money.
   * @param {any} canvas target canvas. @param {Object} row ticker row.
   * @param {string} deskId QUOTE_BASE id (aria label). @returns {Promise<void>}. */
  function spark(canvas, row, deskId) {
    var MC = (typeof MarketCandles !== "undefined" && MarketCandles) ? MarketCandles : null;
    if (!MC || typeof MC.candles !== "function") return Promise.resolve();
    return MC.candles(row.a, row.b, 86400, 7).then(function (res) {
      var closes = (res && res.closes) || [];
      if (!closes.length) return;
      var ctx = null;
      try { ctx = canvas.getContext("2d"); } catch (e) { ctx = null; }
      if (!ctx) return;
      var W = 80, H = 24, pad = 2;
      try { canvas.width = W; canvas.height = H; } catch (e) { /* stub size */ }
      var vals = closes.map(function (c) { return Number(c); }).filter(isFinite);
      if (!vals.length) return;
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (!(hi > lo)) hi = lo + 1;
      function X(i) { return pad + (i * (W - 2 * pad)) / Math.max(vals.length - 1, 1); }
      function Y(v) { return H - pad - ((v - lo) * (H - 2 * pad)) / (hi - lo); }
      try {
        ctx.beginPath();
        for (var i = 0; i < vals.length; i++) {
          if (i === 0) ctx.moveTo(X(i), Y(vals[i]));
          else ctx.lineTo(X(i), Y(vals[i]));
        }
        ctx.strokeStyle = themeAccent();
        ctx.lineWidth = 1.5;
        ctx.stroke();
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", t("market_net.spark_label", "7-day trend for %(id)s", { id: deskId }));
      } catch (e) { /* placeholder stands */ }
    }).catch(function () { /* placeholder stands */ });
  }

  /* destroyBands: stop previously mounted bands (pool-ui dropSubs precedent:
   * rAF loop + observer stop on re-render; cross-route loops sleep via the
   * band's own IntersectionObserver). */
  function destroyBands() {
    liveBands.forEach(function (h) { try { if (h && h.destroy) h.destroy(); } catch (e) { /* down */ } });
    liveBands = [];
  }

  /* offlineBox: honest offline panel (pool-ui offlineBox precedent, minimal:
   * cached note + Retry + Settings link; no Offline-helper dependency).
   * @param {Document} doc owner document. @param {any} wrap container.
   * @param {Function} retry retry thunk. @returns {void}. */
  function offlineBox(doc, wrap, retry) {
    wrap.appendChild(mk(doc, "p", t("market_net.offline", "Network unavailable — showing cached markets. Retry when connected."), "muted"));
    var row = mk(doc, "div", null, "pools-offline-row");
    wrap.appendChild(row);
    var b = floor(mk(doc, "button", t("fees.retry", "Retry")));
    b.type = "button";
    b.className = "btn-ghost";
    b.addEventListener("click", retry);
    row.appendChild(b);
    var settingsLink = mk(doc, "a", t("notice.open_settings", "Open Settings"), "subtle-btn");
    try { settingsLink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
    row.appendChild(settingsLink);
  }

  /* readQuery/writeQuery: ?a=/?b= deep-link seed (pool-ui readQuery/writeQuery
   * precedent: Back from a desk restores the search; replaceState, no render).
   * @returns {{a: string, b: string}} raw seeds (possibly ""). Never throws. */
  function readQuery() {
    var q = {};
    try {
      if (typeof Router !== "undefined" && Router && typeof Router.query === "function") q = Router.query() || {};
    } catch (e) { q = {}; }
    return { a: String((q && q.a) || ""), b: String((q && q.b) || "") };
  }
  function writeQuery(a, b) {
    try {
      if (typeof history === "undefined" || typeof history.replaceState !== "function") return;
      if (typeof window === "undefined" || !window.location) return;
      var parts = [];
      if (String(a || "").trim()) parts.push("a=" + encodeURIComponent(String(a).trim()));
      if (String(b || "").trim()) parts.push("b=" + encodeURIComponent(String(b).trim()));
      var base = String(window.location.href).split("#")[0];
      history.replaceState(null, "", base + "#/markets" + (parts.length ? "?" + parts.join("&") : ""));
    } catch (e) { /* URL stays unshared — list still works */ }
  }

  /* paintTable: volume-desc rows -> hand-rolled table (links per-view, see
   * header note). Zero-volume rows are omitted but counted in the scope
   * note; empty -> honest market_net.empty note (never blank).
   * @param {Document} doc owner document. @param {any} box table container.
   * @param {Array<Object>} ranked MarketNet.rank output (all probed).
   * @param {Object} precs assetId -> numeric precision (CP leg join).
   * @param {number} myGen liveness token.
   * @returns {Array<Object>} shown rows (vol > 0, ranked). */
  function paintTable(doc, box, ranked, precs, myGen) {
    clearBox(box);
    function live() { return myGen === gen; }
    var shown = (ranked || []).filter(function (r) { return r && hasVol(r.baseVol); });
    box.appendChild(mk(doc, "p", t("market_net.top_note", "Top %(shown)s of %(probed)s probed — by 24h volume.",
      { shown: String(shown.length), probed: String((ranked || []).length) }), "muted"));
    if (!shown.length) {
      box.appendChild(mk(doc, "p", t("market_net.empty", "No markets found for this filter."), "muted"));
      return shown;
    }
    var table = doc.createElement("table");
    table.className = "node-table pools-table";
    var hr = doc.createElement("tr");
    [t("market_net.col_market", "Market"), t("market_net.col_last", "Last"),
     t("market_net.col_change", "24h \u0394"), t("market_net.col_vol", "24h vol"),
     t("market_net.col_spark", "7d")].forEach(function (h) {
      var th = doc.createElement("th");
      th.textContent = h;
      try { th.setAttribute("scope", "col"); } catch (e) { /* text stands */ }
      hr.appendChild(th);
    });
    var thead = doc.createElement("thead");
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    shown.forEach(function (r) {
      if (!live()) return;
      var deskId = deskForProbe(r.symA, r.symB);
      var tr = doc.createElement("tr");
      var tdM = doc.createElement("td");
      var link = mk(doc, "a", deskId);
      try {
        link.setAttribute("href", "#/market/" + deskId);
        link.setAttribute("aria-label", t("market_net.open_desk", "Open %(id)s", { id: deskId }));
      } catch (e) { /* label stands */ }
      floor(link);
      tdM.appendChild(link);
      tr.appendChild(tdM);
      var lt = lastText(r.latest);
      var tdL = mk(doc, "td", lt.text || "", "num");
      if (lt.raw) { try { tdL.title = lt.raw; } catch (e) { /* text stands */ } }
      tr.appendChild(tdL);
      var chg = (r.change === null || r.change === undefined) ? "" : String(r.change);
      var tdC = mk(doc, "td", chg ? chg + "%" : "", "num");
      try {
        var sign = chgSign(chg);
        if (sign === "pos") tdC.className = "num chg-pos";
        else if (sign === "neg") tdC.className = "num chg-neg";
      } catch (e) { /* class stands */ }
      tr.appendChild(tdC);
      var hv = humanVol(r.baseVol, precs[r.a], r.symA, r.quoteVol, precs[r.b], r.symB);
      var tdV = mk(doc, "td", hv.text, "num");
      try { tdV.title = t("account.raw_prefix", "raw ") + hv.raw; } catch (e) { /* text stands */ }
      tr.appendChild(tdV);
      var tdS = doc.createElement("td");
      var ph = mk(doc, "span", "\u2014", "muted");
      tdS.appendChild(ph);
      tr.appendChild(tdS);
      tbody.appendChild(tr);
      r._sparkCell = tdS;
      r._deskId = deskId;
    });
    table.appendChild(tbody);
    box.appendChild(table);
    return shown;
  }

  /* mountBand: volume-driven PoolNetUI band (desk map mirrors the market
   * selector — edges exist only for pairs with recent volume).
   * @param {Document} doc owner document. @param {any} wrap page container.
   * @param {Function} getSelection live {a,b,s,aId,bId} getter.
   * @param {any} vg volume graph {graph: {nodes, edges}, meta} from
   *   MarketNet.graph + precisions (null/empty = honest empty via market
   *   mode — the band still mounts so the note has a home).
   * @param {number} myGen liveness token.
   * Replaces any previous band node + stops its loop (one band per page). */
  function mountBand(doc, wrap, getSelection, vg, myGen) {
    var PUI = (typeof PoolNetUI !== "undefined" && PoolNetUI) ? PoolNetUI : null;
    if (!PUI || typeof PUI.mount !== "function") return;
    destroyBands();
    try {
      var old = wrap._bandEl;
      if (old && old.parentNode === wrap) wrap.removeChild(old);
    } catch (e) { /* appended below anyway */ }
    var open = true;
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(OPEN_KEY) === "0") open = false;
    } catch (e) { /* default open stands */ }
    var band = mk(doc, "section", null, "pool-net-band");
    try { band.setAttribute("id", "market-net-band"); } catch (e) { band.id = "market-net-band"; }
    var head = mk(doc, "div", null, "pool-net-head");
    head.appendChild(mk(doc, "h2", t("market_net.band_title", "Market network")));
    var toggle = mk(doc, "button", open ? t("market_net.collapse", "Collapse") : t("market_net.expand", "Expand"), "subtle-btn");
    toggle.type = "button";
    try {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-controls", "market-net-body");
    } catch (e) { /* label stands */ }
    floor(toggle);
    head.appendChild(toggle);
    band.appendChild(head);
    var body = mk(doc, "div", null, "pool-net-body");
    try { body.setAttribute("id", "market-net-body"); } catch (e) { body.id = "market-net-body"; }
    body.appendChild(mk(doc, "p", t("pool_net.loading", "Loading network\u2026"), "muted"));
    if (!open) { try { body.style.display = "none"; } catch (e) { /* visible fallback */ } }
    band.appendChild(body);
    toggle.addEventListener("click", function () {
      if (myGen !== gen) return;
      open = !open;
      try {
        body.style.display = open ? "" : "none";
        toggle.textContent = open ? t("market_net.collapse", "Collapse") : t("market_net.expand", "Expand");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      } catch (e) { /* visual state stands */ }
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(OPEN_KEY, open ? "1" : "0");
      } catch (e) { /* memory-only session */ }
    });
    wrap.appendChild(band);
    try { wrap._bandEl = band; } catch (e) { /* headless stands */ }
    var handle = null;
    try {
      var vgGraph = (vg && vg.graph) || { nodes: [], edges: [] };
      var vgMeta = (vg && vg.meta) || {};
      handle = PUI.mount(doc, body, getSelection, {
        /* Volume edges carry their desk id (QUOTE_BASE), so navigation is
         * direct — no pool lookup table, no symbol derivation, no dead
         * lines. Pool-shaped ids (defensive: foreign graphs) stay pool
         * desks; object-id pairs (would 404) resolve to nothing. */
        mode: "market",
        graph: vgGraph,
        meta: vgMeta,
        navEdge: function (hit) {
          try {
            var id = hit && (hit.id || hit.poolId) ? String(hit.id || hit.poolId) : "";
            if (!id) return null;
            if (/^1\.19\.\d+$/.test(id)) return "#/pools/" + id;
            if (/^[A-Za-z0-9.]+_[A-Za-z0-9.]+$/.test(id) && id.indexOf("1.3.") === -1) return "#/market/" + id;
          } catch (e) { /* null below */ }
          return null;
        }
      });
    } catch (e) { handle = null; }
    if (handle) liveBands.push(handle);
  }

  /* loadInto: resolve X (+optional Y), probe tickers, paint table, lazy
   * sparklines, reconcile the discovery cache, mount the band.
   * @param {Document} doc owner document. @param {any} wrap page container.
   * @param {string} rawA Asset-1 input. @param {string} rawB Asset-2 input.
   * @param {number} myGen liveness token. @returns {Promise<void>}. */
  function loadInto(doc, wrap, rawA, rawB, myGen) {
    function live() { return myGen === gen; }
    var A = (typeof Asset !== "undefined" && Asset) ? Asset : null;
    var MN = (typeof MarketNet !== "undefined" && MarketNet) ? MarketNet : null;
    var listBox = mk(doc, "div");
    wrap.appendChild(listBox);
    listBox.appendChild(mk(doc, "p", t("market_net.loading", "Loading markets\u2026"), "muted"));
    var aName = String(rawA || "").trim() || "BTS";
    var bName = String(rawB || "").trim();
    var xDesc = null, yDesc = null, poolRows = [];
    return Promise.resolve().then(function () {
      return A.describe(aName);
    }).then(function (xd) {
      xDesc = xd;
      if (!xDesc || !xDesc.id) throw new Error("unknown-asset");
      if (bName) return A.describe(bName).then(function (yd) { yDesc = yd; });
      return null;
    }).then(function () {
      if (bName && (!yDesc || !yDesc.id)) throw new Error("unknown-asset");
      /* Pool counterparties are opportunistic (1 one-asset call, fail-open):
       * the chain stays the source of truth, seeds + cache still list. */
      if (!bName && typeof Pool !== "undefined" && Pool && typeof Pool.list === "function") {
        return Pool.list({ assetA: xDesc.id, limit: 100 }).catch(function () { return []; }).then(function (rows) {
          poolRows = rows || [];
        });
      }
      return null;
    }).then(function () {
      if (!live()) return;
      var probes = [];
      if (yDesc) {
        /* Order-free pair (Pool.list both-orders precedent): probe both
         * orientations; each orientation is its own desk (reciprocal). */
        probes.push(probeOne(xDesc.id, xDesc.symbol, yDesc.id, yDesc.symbol));
        probes.push(probeOne(yDesc.id, yDesc.symbol, xDesc.id, xDesc.symbol));
        return Promise.all(probes).then(function (rows) {
          return { rows: rows.filter(Boolean), counters: [], descCache: null };
        });
      }
      /* X-only discovery: pool counterparties (free graph legs) + curated
       * seeds + cached markets, deduped + capped via MarketNet.candidates
       * (pool legs become Y_X ids; seeds/cached pass through verbatim). */
      var seeds = ((CURATED[network()] || CURATED.mainnet)).filter(function (id) {
        return id.indexOf(xDesc.symbol + "_") === 0 || id.indexOf("_" + xDesc.symbol) !== -1;
      });
      var cached = [];
      try { cached = MN.readCache().filter(function (id) {
        return id.indexOf(xDesc.symbol + "_") === 0 || id.indexOf("_" + xDesc.symbol) !== -1;
      }); } catch (e) { cached = []; }
      var graph = { nodes: [], edges: [] };
      try {
        var seen = {};
        poolRows.forEach(function (p) {
          var a = p.asset_a_id || p.asset_a, b = p.asset_b_id || p.asset_b;
          if (!seen[a]) { seen[a] = 1; graph.nodes.push({ assetId: String(a), sym: p.sym_a || String(a) }); }
          if (!seen[b]) { seen[b] = 1; graph.nodes.push({ assetId: String(b), sym: p.sym_b || String(b) }); }
          graph.edges.push({ poolId: String(p.id), a: String(a), b: String(b) });
        });
      } catch (e) { graph = { nodes: [], edges: [] }; }
      var ids = [];
      try { ids = MN.candidates(graph, xDesc.id, seeds, cached, null); } catch (e) { ids = seeds.slice(); }
      var counters = [], cSeen = {};
      ids.forEach(function (id) {
        var parts = String(id).split("_");
        if (parts.length !== 2) return;
        var other = parts[0] === xDesc.symbol ? parts[1] : (parts[1] === xDesc.symbol ? parts[0] : null);
        if (other && !cSeen[other]) { cSeen[other] = 1; counters.push(other); }
      });
      counters = counters.slice(0, (MN && MN.CAP) || CAP);
      var descCache = {};
      descCache[xDesc.symbol] = xDesc;
      function descOf(sym) {
        if (descCache[sym]) return Promise.resolve(descCache[sym]);
        return A.describe(sym).then(function (d) { descCache[sym] = d; return d; });
      }
      var tasks = counters.map(function (sym) {
        return descOf(sym).then(function (d) {
          if (!d || !d.id) return null;
          return probeOne(xDesc.id, xDesc.symbol, d.id, d.symbol);
        }).catch(function () { return null; });
      });
      return Promise.all(tasks).then(function (rows) {
        return { rows: rows.filter(Boolean), counters: counters, descCache: descCache };
      });
    }).then(function (out) {
      if (!live() || !out) return;
      var rows = out.rows || [];
      var ranked = rows;
      try { ranked = MN.rank(rows); } catch (e) { ranked = rows.slice(); }
      clearBox(listBox);
      var precs = {};
      try {
        if (xDesc) precs[xDesc.id] = xDesc.precision;
        if (yDesc) precs[yDesc.id] = yDesc.precision;
        if (out.descCache) Object.keys(out.descCache).forEach(function (k) {
          var d = out.descCache[k];
          if (d && d.id && typeof d.precision === "number") precs[d.id] = d.precision;
        });
      } catch (e) { /* humanVol falls back to raw */ }
      var shown = paintTable(doc, listBox, ranked, precs, myGen);
      /* Discovery cache: chain re-validates every load, stale drops
       * (reconcileCache rewrites to live-minus-seeds). Best-effort. */
      try {
        var liveIds = shown.map(function (r) { return deskForProbe(r.symA, r.symB); });
        MN.reconcileCache(CURATED[network()] || CURATED.mainnet, liveIds);
      } catch (e) { /* cache is a speedup, never load-bearing */ }
      /* Band mounts right after the table (parallel with sparklines):
       * the mapper starts while the 8 history calls fly; spark canvases
       * fill in when ready. Spark logic itself unchanged. The graph comes
       * from the table's own ranked rows (volume-gated markets — the band
       * mirrors the selector); precisions join from the map above so the
       * hover cards format at render. */
      var vg = null;
      try {
        var built = MN.graph(ranked, xDesc.id);
        (built.edges || []).forEach(function (e) {
          var m = built.meta[e.id];
          if (m) {
            if (typeof precs[e.a] === "number") m.volBasePrec = precs[e.a];
            if (typeof precs[e.b] === "number") m.volQuotePrec = precs[e.b];
          }
        });
        vg = { graph: { nodes: built.nodes, edges: built.edges }, meta: built.meta };
      } catch (e) { vg = null; }
      (function () {
        var rawA = aName, rawB = bName;
        mountBand(doc, wrap, function () {
          return { a: rawA, b: rawB, s: "", aId: xDesc ? xDesc.id : null, bId: yDesc ? yDesc.id : null };
        }, vg, myGen);
      })();
      /* Lazy top-8 sparklines (spec §2: 1 get_market_history each, after the
       * table — the table stays interactive before the mapper finishes). */
      var jobs = shown.slice(0, SPARK_N).map(function (r) {
        if (!live() || !r._sparkCell) return Promise.resolve();
        return spark((function () {
          var cv = null;
          try { cv = doc.createElement("canvas"); } catch (e) { return null; }
          if (!cv) return null;
          try { cv.className = "market-net-spark"; } catch (e) { /* stands */ }
          clearBox(r._sparkCell);
          r._sparkCell.appendChild(cv);
          return cv;
        })(), r, r._deskId).catch(function () { /* placeholder stands */ });
      });
      return Promise.all(jobs);
    }).catch(function (e) {
      if (!live()) return;
      clearBox(listBox);
      var m = (e && e.message) ? e.message : String(e || "");
      if (m.indexOf("unknown-asset") !== -1) {
        listBox.appendChild(mk(doc, "p", t("common.unknown_asset", "Unknown asset.") + ": " + (bName && !yDesc ? bName : aName), "muted"));
        listBox.appendChild(mk(doc, "p", t("market_net.empty", "No markets found for this filter."), "muted"));
        return;
      }
      if (m.indexOf("not-connected") !== -1) {
        offlineBox(doc, listBox, function () {
          var r = null;
          try { r = listBox._retryRoot || null; } catch (e) { r = null; }
          if (live() && r) renderMarkets(r);
        });
        return;
      }
      var err = null;
      var D = _dom();
      if (D) err = D.error(listBox, m);
      else listBox.appendChild(mk(doc, "p", m, "error"));
      void err;
    });
  }

  /* renderMarkets: route entry #/markets — search + table + band.
   * PUBLIC-FIRST (pool-ui precedent): reads never gate on unlock; the
   * password is asked only at signing (no signing on this page at all).
   * @param {HTMLElement} root router mount element.
   * @returns {Promise<void>} resolves when the table + sparkline settle
   *   lands (band mounts right after the table, before spark settle;
   *   headless tests await this). */
  /* pairSeed: the Asset 1 / Asset 2 starting values, in the spec's
   * precedence — a shared ?a=/?b= deep link wins (it is a URL someone
   * deliberately shared), then the global pair the last desk/pool visit
   * wrote (PairContext, session memory), then the BTS default. Never
   * throws; the fields simply keep their defaults. */
  function pairSeed() {
    var q = readQuery();
    if (String(q.a || "").trim() || String(q.b || "").trim()) {
      return { a: String(q.a || "").trim(), b: String(q.b || "").trim() };
    }
    var legs = [];
    try {
      if (typeof PairContext !== "undefined" && PairContext && typeof PairContext.get === "function") {
        legs = PairContext.get() || [];
      }
    } catch (e) { legs = []; }
    return { a: String(legs[0] || "BTS"), b: String(legs[1] || "") };
  }

  function renderMarkets(root) {
    if (!root) return Promise.resolve();
    var myGen = ++gen;
    destroyBands();
    var doc = root.ownerDocument || ((typeof document !== "undefined") ? document : null);
    if (!doc) return Promise.resolve();
    var miss = null;
    ["Market", "MarketNet", "Asset", "Chain", "Format"].forEach(function (g) {
      try {
        if (typeof globalThis !== "undefined" && typeof globalThis[g] === "undefined") miss = g;
      } catch (e) { /* present below */ }
    });
    var wrap = mk(doc, "div", null, "wrap wide");
    try { wrap._root = root; } catch (e) { /* headless stands */ }
    clearBox(root);
    root.appendChild(wrap);
    var D = _dom();
    if (D && typeof D.pageHead === "function") {
      try { wrap.appendChild(D.pageHead(doc, t("market_net.selector_title", "Market Selector"))); } catch (e) {
        wrap.appendChild(mk(doc, "h1", t("market_net.selector_title", "Market Selector")));
      }
    } else {
      wrap.appendChild(mk(doc, "h1", t("market_net.selector_title", "Market Selector")));
    }
    if (miss) {
      wrap.appendChild(mk(doc, "p", t("market_net.selector_title", "Market Selector") + " backend missing: " + miss + " failed to load.", "error"));
      return Promise.resolve();
    }
    try {
      if (typeof Chain !== "undefined" && Chain && Chain.status && Chain.status().state !== "open") {
        var cachedBox = mk(doc, "div");
        wrap.appendChild(cachedBox);
        offlineBox(doc, cachedBox, function () { if (myGen === gen) renderMarkets(root); });
        /* Cold-load race (pool-ui autoRetry / asset-feed-ui cold precedent):
         * the route often paints before the handshake lands — without this
         * the offline panel survives after connect. Re-render once on the
         * first "open" event while this render is still current and the
         * hash hasn't moved on; plus one automated handshake attempt. */
        (function () {
          var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
          var settled = false, off = function () {};
          function rerun() {
            if (settled) return;
            settled = true;
            try { off(); } catch (e) { /* gone */ }
            if (myGen === gen && (typeof location === "undefined" || location.hash === hashAtEntry)) renderMarkets(root);
          }
          try {
            if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
              off = Store.subscribe("connection", function (st) {
                if (settled || myGen !== gen) { settled = true; try { off(); } catch (e) { /* gone */ } return; }
                if (st && st.state === "open") rerun();
              });
            }
          } catch (e) { /* manual Retry remains */ }
          try {
            if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure();
          } catch (e) { /* subscription above still covers */ }
        })();
        return Promise.resolve();
      }
    } catch (e) { /* connected path below */ }
    wrap.appendChild(mk(doc, "p", t("market_net.subtitle", "Top order-book markets by 24h volume. Pick a row to open the desk."), "muted"));
    var filters = mk(doc, "div", null, "pools-filters");
    var fA, fB;
    try {
      if (typeof Forms !== "undefined" && Forms && typeof Forms.labeledInput === "function") {
        fA = Forms.labeledInput(doc, t("market_net.asset_1_field", "Asset 1 (any leg)") + " ",
          { placeholder: t("common.symbol_or_id_hint", "symbol or 1.3.x") });
        fB = Forms.labeledInput(doc, t("market_net.asset_2_field", "Asset 2 (any leg)") + " ",
          { placeholder: t("common.symbol_or_id_hint", "symbol or 1.3.x") });
      } else {
        throw new Error("no-forms");
      }
    } catch (e) {
      fA = (function () {
        var row = mk(doc, "div", null, "xfer-field");
        var label = mk(doc, "label", t("market_net.asset_1_field", "Asset 1 (any leg)") + " ");
        var input = null;
        try { input = doc.createElement("input"); } catch (e2) { input = null; }
        if (input && label.appendChild) label.appendChild(input);
        row.appendChild(label);
        return { row: row, input: input };
      })();
      fB = (function () {
        var row = mk(doc, "div", null, "xfer-field");
        var label = mk(doc, "label", t("market_net.asset_2_field", "Asset 2 (any leg)") + " ");
        var input = null;
        try { input = doc.createElement("input"); } catch (e2) { input = null; }
        if (input && label.appendChild) label.appendChild(input);
        row.appendChild(label);
        return { row: row, input: input };
      })();
    }
    filters.appendChild(fA.row);
    filters.appendChild(fB.row);
    var go = floor(mk(doc, "button", t("market_net.list_btn", "List markets")));
    go.type = "button";
    var clearBtn = floor(mk(doc, "button", t("market_net.clear_btn", "Clear"), "subtle-btn"));
    clearBtn.type = "button";
    filters.appendChild(go);
    filters.appendChild(clearBtn);
    wrap.appendChild(filters);
    try {
      var seed = pairSeed();
      if (fA.input) fA.input.value = seed.a.slice(0, 64);
      if (fB.input) fB.input.value = seed.b.slice(0, 64);
    } catch (e) { /* defaults stand */ }
    function currentLoad() {
      if (myGen !== gen) return Promise.resolve();
      var olds = null;
      try {
        olds = wrap._loadBox;
        if (olds && olds.parentNode === wrap) wrap.removeChild(olds);
      } catch (e) { /* appended below anyway */ }
      var box = mk(doc, "div");
      try { wrap._loadBox = box; } catch (e) { /* headless stands */ }
      try { box._retryRoot = root; } catch (e2) { /* headless stands */ }
      wrap.appendChild(box);
      var a = "", b = "";
      try {
        if (fA.input) a = String(fA.input.value || "");
        if (fB.input) b = String(fB.input.value || "");
      } catch (e) { /* BTS default stands */ }
      writeQuery(a, b);
      return loadInto(doc, box, a, b, myGen);
    }
    go.addEventListener("click", function () { currentLoad(); });
    clearBtn.addEventListener("click", function () {
      if (myGen !== gen) return;
      try {
        if (fA.input) fA.input.value = "";
        if (fB.input) fB.input.value = "";
      } catch (e) { /* cleared anyway */ }
      currentLoad();
    });
    [fA, fB].forEach(function (f) {
      try {
        if (f.input && f.input.addEventListener) f.input.addEventListener("keydown", function (e) {
          if ((e.key === "Enter" || e.keyCode === 13) && myGen === gen) {
            if (e.preventDefault) e.preventDefault();
            currentLoad();
          }
        });
      } catch (e) { /* click path remains */ }
    });
    /* Re-search replaces the previous load box (mountBand also swaps the
     * band node + stops its loop, so only one rAF loop runs). */
    return currentLoad().then(function () { return undefined; });
  }

  return {
    renderMarkets: renderMarkets,
    _deskForTest: deskForProbe
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.MarketNetUI === "undefined") { globalThis.MarketNetUI = MarketNetUI; }
if (typeof module !== "undefined") { module.exports = MarketNetUI; }
