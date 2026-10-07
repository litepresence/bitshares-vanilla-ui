/* pool-detail-view.js — #/pools/:id detail desk (stats + chart + depth + history).
 *
 * What it owns: the detail route entry (renderPoolDetail + detailFill —
 * stats strip, shared tape fetch, section scaffolding), the pool chart pane
 * (POOL_BUCKETS + chartPane through the shared MarketInd stack + deepenPool
 * ES merge), the x·y=k curve canvas + CPMM depth table (cssTok/fitPlot/
 * drawCurve/depthPane), the pool-history tabs (tapeTable/historyPane with
 * the late-tape hook) and the pool-map provenance slice (_ensurePoolGraph delegates to the canonical
 * MarketDesk._fill.ensurePoolGraph + fetchPoolMap/redrawPoolMap). Stake/swap/update/delete
 * panels live in pool-detail-actions.js and are called via
 * PoolDetailUI._actions at call time. Unknown id -> empty state, never
 * blank. No ops-57/58 code (slice 14 owns them).
 * Consumes: PoolDetailUI._actions (panels, late-bound), PoolUI._ui
 *   (routeReady/reviewSection/tableHead/amtText/pctText — pool-ui.js loads
 *   first), Pool (get/list/history/quote), PoolHistory (chainSwaps/enrich/
 *   synthBook/swapsToCandles), MarketInd (renderIndMenu/maybeDraw/
 *   drawCharts/CANDLE_COUNT), Market (depth), MarketFills (mergeDeep),
 *   PoolGraph (lazy script), Format, Account, App, Store, DOM.
 * Globals/side effects: DOM under the router root; owns the generation
 *   counter + _cleanups itself (actions take no staleness params — they are
 *   leaf panels under reviewSection); attaches PoolDetailUI._view and
 *   republishes globalThis.PoolDetailUI. WIFs are JS values, never DOM.
 * Created by: task-res-split2 (pool-detail-ui.js responsibility split —
 *   detail half; bodies moved verbatim, only _actions call sites rewritten).
 *   Facade: pool-detail-ui.js (thin, identical surface). Load order in
 *   index.html: pool-detail-actions.js, pool-detail-view.js,
 *   pool-detail-ui.js (facade last; actions/view bind at call time).
 * Pre-split pool-detail-ui.js header (MIRROR SPEC): preserved verbatim
 *   in git history of pool-detail-ui.js.
 */
var PoolDetailUI = (typeof globalThis !== "undefined" && globalThis.PoolDetailUI) ? globalThis.PoolDetailUI : ((typeof PoolDetailUI !== "undefined") ? PoolDetailUI : {});
PoolDetailUI._view = PoolDetailUI._view || {};
(function () {
  "use strict";

  /* Batch-2d i18n (slice-17 precedent): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. Dynamic sentences keep
   * their code structure (batch-2b precedent): only complete static literals and
   * word-bearing segments are wrapped, values and punctuation glue stay raw, so
   * every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  var gen = 0;

  /* Route-listener cleanups (market-desk.js _cleanups precedent): resize +
   * theme subscriptions registered per render; drained on the next render
   * entry so re-renders never stack listeners. Navigation-away is still
   * covered by the live() self-remove backstop below. */
  var _cleanups = [];

  /* Drain pending listener cleanups. Params: none. Returns nothing.
   * Fails: never throws — each cleanup is individually guarded. */
  function cleanupDetail() {
    var fns = _cleanups;
    _cleanups = [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](); } catch (e) { /* cleanup must not throw */ }
    }
  }

  /* Shared-_ui accessor: PoolUI._ui (pool-ui.js loads first); throws when the backend is missing. */
  function U() {
    if (typeof PoolUI === "undefined" || !PoolUI._ui) throw new Error(t("pool.backend_missing", "Pool backend missing: pool-ui.js failed to load."));
    return PoolUI._ui;
  }

  function live(myGen, uiGen) { /* both counters live (debit-ui two-counter precedent) */
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }

  function precOr5(p) { return (p === null || p === undefined) ? 5 : p; }

  /* orientedRow: pool row with legs swapped for the inverted (A-per-B) desk
   * (chart-invert wiring). Returns r unchanged when normal; otherwise a
   * shallow copy with every a/b leg field mirrored (ids, raw balances,
   * precisions, symbols). Trade forms keep the canonical r — only the
   * chart/spot/book/tape surfaces consume the oriented copy.
   * Params: r (pool row), inverted (boolean). Returns a row object. */
  function orientedRow(r, inverted) {
    if (!inverted) return r;
    var o = {}, k;
    for (k in r) { if (Object.prototype.hasOwnProperty.call(r, k)) o[k] = r[k]; }
    o.asset_a_id = r.asset_b_id; o.asset_b_id = r.asset_a_id;
    o.balance_a_raw = String(r.balance_b_raw); o.balance_b_raw = String(r.balance_a_raw);
    o.prec_a = r.prec_b; o.prec_b = r.prec_a;
    o.sym_a = r.sym_b; o.sym_b = r.sym_a;
    return o;
  }

  /** Route entry: #/pools/:id — detail desk mirroring the orderbook desk grid.
   * @param {HTMLElement} root router mount element
   * @param {string} poolId pool object id (1.19.x) or symbol */
  function renderPoolDetail(root, poolId) {
    if (!root) return;
    cleanupDetail();
    var u = U(), retry = function () { renderPoolDetail(root, poolId); };
    var ctx = u.routeReady(root, t("pool.swap_desk", "Swap Desk"), retry);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.className = "wrap mkt-wrap";
    u.showStatus(doc, ctx.wrap,t("pool.loading_detail", "Loading pool…"));
    Pool.get(String(poolId)).then(function (row) {
      if (!live(myGen, uiGen)) return;
      root.innerHTML = "";
      var wrap = u.el(doc, "div", null, "wrap mkt-wrap"); root.appendChild(wrap);
      var desk = u.el(doc, "div", null, "mkt mkt-pool"); wrap.appendChild(desk);
      var head = doc.createElement("section"); head.className = "mkt-head"; desk.appendChild(head);
      head.appendChild(DOM.pageHead(doc, t("pool.swap_desk", "Swap Desk"), "pools"));
      /* Copy-link share (account shareRow precedent — copy-link only, no QR
       * by decision). Static pool hash; the router resolves #/pools/:id. */
      try {
        (function poolShare() {
          var srow = u.el(doc, "div", null, "xplore-share");
          var sbtn = doc.createElement("button");
          sbtn.type = "button";
          sbtn.textContent = t("misc.copy_link", "Copy link");
          if (typeof u.touchable === "function") u.touchable(sbtn);
          else if (typeof touchable === "function") touchable(sbtn);
          var snote = u.el(doc, "span", "", "muted");
          try { snote.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
          srow.appendChild(sbtn);
          srow.appendChild(doc.createTextNode(" "));
          srow.appendChild(snote);
          var hash = "#/pools/" + row.id;
          sbtn.addEventListener("click", function () {
            if (!live(myGen, uiGen)) return;
            sbtn.disabled = true;
            snote.textContent = t("misc.copying", "Copying…");
            var url = hash;
            try {
              if (typeof location !== "undefined" && location.href) url = location.href.split("#")[0] + hash;
            } catch (e) { url = hash; }
            function done(ok) {
              if (!live(myGen, uiGen)) return;
              try { sbtn.disabled = false; } catch (e2) { /* stands */ }
              snote.textContent = ok ? t("misc.copied", "Copied")
                : t("misc.copy_failed_select_manually", "Copy failed — select the link manually");
            }
            function fallback() {
              try {
                var ta = doc.createElement("textarea");
                ta.value = url; doc.body.appendChild(ta); ta.select();
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
              } else fallback();
            } catch (e) { fallback(); }
          });
          head.appendChild(srow);
        })();
      } catch (e) { /* detail stands without share */ }
      var strip = doc.createElement("div"); strip.className = "mkt-statstrip"; strip.setAttribute("aria-live", "polite");
      head.appendChild(strip);
      detailFill(doc, desk, head, strip, row, myGen, uiGen);
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return;
      u.routeFail(root, "Pool " + poolId, e, function () { renderPoolDetail(root, poolId); }); });
  }

  async function detailFill(doc, desk, head, strip, row, myGen, uiGen) {
    var u = U(), joined = null;
    try { joined = (await Pool.list({ share: row.share_id }))[0] || null; } catch (e) { joined = null; }
    if (!live(myGen, uiGen)) return;
    var r = joined || row;
    /* Pool id lives here in the stats strip (owner call — the h1 above is
     * just "Swap Desk"), alongside balances and spot. */
    strip.appendChild(u.el(doc, "span", "Pool: " + r.id));
    var aA = u.amtText(r.balance_a_raw, r.asset_a_id, r.prec_a === undefined ? null : r.prec_a, r.sym_a);
    var aB = u.amtText(r.balance_b_raw, r.asset_b_id, r.prec_b === undefined ? null : r.prec_b, r.sym_b);
    strip.appendChild(u.el(doc, "span", "Balance A: " + aA.text)); strip.lastChild.title = t("account.raw_prefix", "raw ") + aA.raw;
    strip.appendChild(u.el(doc, "span", "Balance B: " + aB.text)); strip.lastChild.title = t("account.raw_prefix", "raw ") + aB.raw;
    strip.appendChild(u.el(doc, "span", "Taker: " + u.pctText(r.taker_units)));
    strip.appendChild(u.el(doc, "span", "Withdrawal: " + u.pctText(r.withdrawal_units)));
    strip.appendChild(u.el(doc, "span", "Share: " + (r.sym_share || r.share_id)));
    /* Spot price (exact BigInt ratio, precOr5 fallbacks — same orientation as
     * the book and candles below; the chart Invert toggle repaints it via
     * orient.spotRepaint, swapping B-per-A to A-per-B through the same
     * formatPrice path — never 1/x float math). */
    var orient = { inverted: false, spotRepaint: null, bookRepaint: null };
    var spotEl = null;
    /* 4-sf helper (global price rule, guarded — the strip stands unpriced
     * when format.js is absent rather than blanking). */
    function spotSig(human) {
      try {
        if (typeof Format !== "undefined" && Format && typeof Format.priceSig === "function") {
          var sig = Format.priceSig(human);
          if (typeof sig === "string" && sig) return sig;
        }
      } catch (e) { /* 8-place stands */ }
      return human;
    }
    orient.spotRepaint = function () {
      if (!spotEl) return;
      try {
        var s = orient.inverted
          ? spotSig(Format.formatPrice(String(r.balance_a_raw), precOr5(r.prec_a), String(r.balance_b_raw), precOr5(r.prec_b), 8))
          : spotSig(Format.formatPrice(String(r.balance_b_raw), precOr5(r.prec_b), String(r.balance_a_raw), precOr5(r.prec_a), 8));
        var q = orient.inverted ? (r.sym_a || r.asset_a_id) : (r.sym_b || r.asset_b_id);
        var b = orient.inverted ? (r.sym_b || r.asset_b_id) : (r.sym_a || r.asset_a_id);
        spotEl.textContent = t("pool.spot_row", "Spot") + ": " + s + " " + q + "/" + b;
      } catch (e) { /* last spot stands */ }
    };
    try {
      var spot0 = spotSig(Format.formatPrice(String(r.balance_b_raw), precOr5(r.prec_b), String(r.balance_a_raw), precOr5(r.prec_a), 8));
      spotEl = u.el(doc, "span", t("pool.spot_row", "Spot") + ": " + spot0 + " " + (r.sym_b || r.asset_b_id) + "/" + (r.sym_a || r.asset_a_id));
      strip.appendChild(spotEl);
    } catch (e) { /* strip stands without spot */ }
    /* One tape fetch shared by chart + history (lazy-deep 2026-10-01 audit:
     * CHAIN-FIRST — chainSwaps (history api, ≤101 rows by chain assert,
     * 55ms/69KB measured) paints the desk immediately and never waits on ES.
     * ES depth arrives in the background via deepenPool in chartPane. Legs
     * passed so cross-chain id collisions can never pollute the tape. */
    var tape = { swaps: [], source: null };
    if (typeof PoolHistory !== "undefined" && PoolHistory && typeof PoolHistory.chainSwaps === "function") {
      try {
        var cres = await PoolHistory.chainSwaps(r.id, 100);
        var cswaps = (cres && cres.swaps) || [];
        try {
          if (typeof PoolHistory.filterLegs === "function") cswaps = PoolHistory.filterLegs(cswaps, r.asset_a_id, r.asset_b_id);
        } catch (e) { /* unfiltered stands */ }
        if (cswaps.length) tape = { swaps: cswaps, source: "chain" };
      } catch (e) { tape = { swaps: [], source: null }; }
    }
    if (!live(myGen, uiGen)) return;
    if (tape.swaps && tape.swaps.length) {
      try {
        PoolHistory.enrich(tape.swaps, r.asset_a_id, precOr5(r.prec_a), r.asset_b_id, precOr5(r.prec_b));
      } catch (e) { /* tape renders unpriced */ }
    }
    var charts = doc.createElement("section"); charts.className = "mkt-charts"; desk.appendChild(charts);
    charts.appendChild(u.el(doc, "h2", t("pool.history_title", "Price history")));
    /* Synthetic CPMM levels computed once: the charts-stack depth slice
     * (chartPane) draws the cumulative staircase, the book section
     * (depthPane) renders the clickable table — same levels, no recompute. */
    var synthLevels = null;
    try {
      if (typeof PoolHistory !== "undefined" && PoolHistory &&
          typeof PoolHistory.synthBook === "function") {
        synthLevels = PoolHistory.synthBook({
          balanceA_raw: r.balance_a_raw, balanceB_raw: r.balance_b_raw,
          precA: precOr5(r.prec_a), precB: precOr5(r.prec_b), taker_units: r.taker_units
        });
      }
    } catch (e) { synthLevels = null; }
    /* Late-tape hook: historyPane (built below) registers setTape here so the
     * background deepenPool can fill the list when chain-first came up empty.
     * Declared before chartPane — the background resolves after both ran. */
    var histHook = {};
    chartPane(doc, charts, r, tape, myGen, uiGen, synthLevels, histHook, orient);
    var acts = doc.createElement("section"); acts.className = "mkt-side"; desk.appendChild(acts);
    acts.appendChild(u.el(doc, "h2", t("pool.stake_title", "Stake / unstake")));
    PoolDetailUI._actions.stakeBoxes(doc, acts, r, uiGen);
    acts.appendChild(u.el(doc, "h2", t("pool.swap_title", "Swap in pool")));
    PoolDetailUI._actions.swapInlineBox(doc, acts, r, uiGen);
    acts.appendChild(u.el(doc, "h2", t("pool.manage_title", "Update / delete")));
    PoolDetailUI._actions.manageBoxes(doc, acts, r, uiGen);
    var book = doc.createElement("section"); book.className = "mkt-book"; desk.appendChild(book);
    book.appendChild(u.el(doc, "h2", t("pool.book_title", "Order book")));
    depthPane(doc, book, r, synthLevels);
    /* Invert repaint for the book (chart-invert wiring): keep the h2,
     * re-render the curve + split book through depthPane with the legs
     * swapped (same BigInt synthBook path, mirrored via orientedRow above).
     * Params: none (reads orient). Returns nothing; route-gen guarded. */
    orient.bookRepaint = function () {
      if (!live(myGen, uiGen)) return;
      while (book.children.length > 1) book.removeChild(book.lastChild);
      var rO = orientedRow(r, orient.inverted);
      var lvO = synthLevels;
      if (orient.inverted && typeof PoolHistory !== "undefined" && PoolHistory &&
          typeof PoolHistory.synthBook === "function") {
        try {
          lvO = PoolHistory.synthBook({ balanceA_raw: String(r.balance_b_raw), balanceB_raw: String(r.balance_a_raw),
            precA: precOr5(r.prec_b), precB: precOr5(r.prec_a), taker_units: r.taker_units });
        } catch (e) { lvO = { bids: [], asks: [] }; }
      }
      depthPane(doc, book, rO, lvO);
    };
    var hist = doc.createElement("section"); hist.className = "mkt-trades"; desk.appendChild(hist);
    hist.appendChild(u.el(doc, "h2", t("pool.pool_history_title", "Pool history")));
    historyPane(doc, hist, r, tape, myGen, uiGen, histHook);
  }

  /* Pool chart buckets (swap-tape timeframes; chain buckets API has no pool
   * leg, so bucketing happens here over enriched swaps). */
  var POOL_BUCKETS = [60, 300, 900, 1800, 3600, 14400, 86400, 604800];

  function chartPane(doc, charts, r, tape, myGen, uiGen, synthLevels, histHook, orient) {
    /* Swap-price candles (ES adapter -> chain fallback) drawn through the
     * SHARED MarketInd stack (timeframes + dropdown menu + LWC price pane +
     * oscillator sub-panes) — the pool desk reads exactly like the exchange
     * desk. State contract mirrors market-desk.js showDesk. Tape arrives
     * pre-fetched from detailFill (shared with the history pane). */
    var u = U();
    if (typeof PoolHistory === "undefined" || typeof MarketInd === "undefined") {
      charts.appendChild(u.el(doc, "p", t("pool_detail.s2", "Pool history unavailable (chain-only; no external index)."), "muted"));
      return;
    }
    var note = u.el(doc, "p", t("pool.loading_history", "Loading price history…"), "muted");
    charts.appendChild(note);
    /* Charts restyle (same contract as market-desk.js showDesk):
     * div.mkt-chartgrid > div.mkt-controls + div.mkt-plots — one CSS block
     * serves both desks. Controls hold timeframe radios, count note, and the
     * indicator menu; plots hold priceHost + VWAP wrap (drawVwap inserts it
     * as priceHost.nextSibling) + oscHost + oscNote. Ids, listeners, and the
     * P state fields are unchanged — only DOM parenting moves. */
    var chartGrid = doc.createElement("div");
    chartGrid.className = "mkt-chartgrid";
    charts.appendChild(chartGrid);
    var controls = doc.createElement("div");
    controls.className = "mkt-controls";
    chartGrid.appendChild(controls);
    var plots = doc.createElement("div");
    plots.className = "mkt-plots";
    chartGrid.appendChild(plots);
    var tfBox = doc.createElement("div");
    tfBox.className = "mkt-tfrow";
    tfBox.setAttribute("role", "radiogroup");
    controls.appendChild(tfBox);
    var countNote = u.el(doc, "p", "", "muted mkt-count-note");
    countNote.setAttribute("aria-live", "polite");
    controls.appendChild(countNote);
    var menuHost = doc.createElement("div");
    menuHost.className = "mkt-indrow";
    controls.appendChild(menuHost);
    /* Invert toggle (FIX 2, market-desk.js:535-549 semantics): the exchange
     * desk re-renders the swapped QUOTE_BASE pair via the hash router; a pool
     * has no pair URL, so this re-renders in place with legs swapped (A-per-B):
     * candles re-enriched + rebucketed on the swapped legs, the depth slice
     * recomputed from the mirrored synthBook, and the spot line + book + tape
     * repainted via the orient hooks. Every number re-derives through the
     * existing BigInt formatPrice path — no 1/x float math anywhere. The pool
     * map carries no price orientation (symmetric pair graph), so it only
     * repaints (theme/resize parity). */
    var invBtn = u.touchable(u.el(doc, "button", t("pool_detail.invert", "Invert")));
    invBtn.type = "button"; invBtn.id = "pool-chart-invert";
    invBtn.setAttribute("aria-label", t("pool_detail.invert_label", "Invert chart orientation (A-per-B / B-per-A)"));
    invBtn.setAttribute("aria-pressed", "false");
    controls.appendChild(invBtn);
    invBtn.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return;
      P.inverted = !P.inverted;
      if (orient) orient.inverted = P.inverted;
      invBtn.setAttribute("aria-pressed", P.inverted ? "true" : "false");
      try { orientEnrich(P.swaps); } catch (e) { /* tape renders unpriced */ }
      paintAssets();
      try {
        var lv = orientLevels();
        if (lv && (lv.asks.length || lv.bids.length) &&
            typeof Market !== "undefined" && Market && typeof Market.depth === "function") {
          P.bookDepth = Market.depth({ bids: lv.bids, asks: lv.asks });
        }
      } catch (e) { /* depth slice stands */ }
      /* ES-bucket cache is orientation-bound (timeframe-switch precedent):
       * drop it so deepenPool re-merges under the new legs. Discrete repaints
       * from the re-enriched tape with no deepen and no pool map (closed). */
      repaintForMode();
      if (!P.discrete) {
        try { redrawPoolMap(doc, P, myGen, uiGen); } catch (e) { /* map best-effort */ }
      }
      try { if (orient && typeof orient.spotRepaint === "function") orient.spotRepaint(); } catch (e) { /* spot stands */ }
      try { if (orient && typeof orient.bookRepaint === "function") orient.bookRepaint(); } catch (e) { /* book stands */ }
      try {
        if (histHook && typeof histHook.setTape === "function") {
          histHook.setTape(P.swaps, P._tapeSource || (tape && tape.source) || null);
        }
      } catch (e) { /* tape stands */ }
    });
    var priceHost = doc.createElement("div");
    priceHost.className = "mkt-price-host";
    plots.appendChild(priceHost);
    var oscHost = doc.createElement("div");
    oscHost.className = "mkt-osc-host";
    plots.appendChild(oscHost);
    var oscNote = u.el(doc, "p", "", "muted");
    oscNote.setAttribute("aria-live", "polite");
    plots.appendChild(oscNote);
    var P = {
      doc: doc, bucket: 300, liveBuckets: POOL_BUCKETS.slice(), logScale: false,
      /* Discrete mode (raw swaps, no buckets — session-only, no URL keys):
       * the shared paintTimeframes sets P.discrete via its Discrete radio;
       * numeric radios clear it. Empty text stays swaps-worded. */
      discrete: false, discreteEmptyText: t("pool.no_swaps", "No swaps yet."),
      /* Minimal defaults (owner): price + pool map only. Every overlay,
       * oscillator, and the depth/VWAP plots stay available in the
       * Indicators pulldown — all default off. */
      over: {}, osc: {}, oscBoxes: {}, panes: {}, paneEls: {},
      /* Toggleable plots (menu "Plots" group): only price is always on. */
      showVwap: false, showDepth: false, showPoolMap: true,
      candles: { buckets: [] }, tfBox: tfBox, countNote: countNote,
      priceHost: priceHost, oscHost: oscHost, oscNote: oscNote,
      depthCanvas: null, graphWrap: null, graphCanvas: null, graphNote: null, graphData: null,
      basePrec: precOr5(r.prec_b), quotePrec: precOr5(r.prec_a),
      assets: {
        base: { precision: precOr5(r.prec_b), symbol: r.sym_b || r.asset_b_id },
        quote: { precision: precOr5(r.prec_a), symbol: r.sym_a || r.asset_a_id }
      },
      swaps: [], precA: precOr5(r.prec_a), precB: precOr5(r.prec_b),
      /* Invert state (FIX 2): false = B-per-A desk orientation, true =
       * A-per-B. _tapeSource tracks which tape the history list shows so the
       * toggle repaints it under the new legs. */
      inverted: !!(orient && orient.inverted),
      _tapeSource: (tape && tape.source) || null
    };
    /* Global pair context (selector ladder 2026-10-07): a pool visit writes
     * the pool's own (base, quote) legs, so BOTH selectors come back seeded
     * and the one-way pool->Exchange navbar swap is gone. fromPool keeps the
     * pool's leg order, which is exactly what marketId() needs to rebuild the
     * same "QUOTE_BASE" id the old swap produced — so a pool visit and a
     * market visit still agree on one pair. */
    try {
      if (typeof PairContext !== "undefined" && PairContext && typeof PairContext.set === "function") {
        PairContext.set(PairContext.fromPool(P.assets));
      }
    } catch (e) { /* selectors keep their last pair */ }
    try { MarketInd.renderIndMenu(doc, menuHost, P); } catch (e) { /* chart works without the menu */ }
    /* Orientation helpers (invert wiring): normal legs quote B-per-A (desk
     * header SYMA/SYMB orientation); inverted legs quote A-per-B. Enriching
     * with swapped (asset, prec) args re-derives prices through the same
     * BigInt formatPrice path (pool-history.js priceHuman) — never floats. */
    function orientEnrich(swaps) {
      if (P.inverted) PoolHistory.enrich(swaps, r.asset_b_id, precOr5(r.prec_b), r.asset_a_id, precOr5(r.prec_a));
      else PoolHistory.enrich(swaps, r.asset_a_id, precOr5(r.prec_a), r.asset_b_id, precOr5(r.prec_b));
    }
    function orientVol() {
      return P.inverted ? { asset: r.asset_a_id, prec: precOr5(r.prec_a) } : { asset: r.asset_b_id, prec: precOr5(r.prec_b) };
    }
    function paintAssets() {
      if (P.inverted) {
        P.basePrec = precOr5(r.prec_a); P.quotePrec = precOr5(r.prec_b);
        P.assets = {
          base: { precision: precOr5(r.prec_a), symbol: r.sym_a || r.asset_a_id },
          quote: { precision: precOr5(r.prec_b), symbol: r.sym_b || r.asset_b_id }
        };
      } else {
        P.basePrec = precOr5(r.prec_b); P.quotePrec = precOr5(r.prec_a);
        P.assets = {
          base: { precision: precOr5(r.prec_b), symbol: r.sym_b || r.asset_b_id },
          quote: { precision: precOr5(r.prec_a), symbol: r.sym_a || r.asset_a_id }
        };
      }
    }
    /* Mirrored depth levels (invert wiring): swapping the synthBook inputs
     * walks the same CPMM BigInt path (Pool.quote floors + taker haircut)
     * and yields A-per-B levels for the charts-stack depth slice. */
    function orientLevels() {
      if (!P.inverted) return synthLevels;
      return PoolHistory.synthBook({ balanceA_raw: String(r.balance_b_raw), balanceB_raw: String(r.balance_a_raw),
        precA: precOr5(r.prec_b), precB: precOr5(r.prec_a), taker_units: r.taker_units });
    }
    /* Synthetic depth slice (CPMM levels as a cumulative staircase, same
     * visual language as the exchange depth slice): canvas in an osc-sized
     * wrap pinned at stack index 1 by drawCharts via P.depthWrap. Levels
     * arrive precomputed from detailFill (shared with the book table). */
    try {
      if (synthLevels && (synthLevels.asks.length || synthLevels.bids.length) &&
          typeof Market !== "undefined" && Market && typeof Market.depth === "function") {
        P.bookDepth = Market.depth({ bids: synthLevels.bids, asks: synthLevels.asks });
        var depthWrap = doc.createElement("div");
        depthWrap.className = "mkt-osc-pane";
        var depthHead = doc.createElement("div");
        depthHead.className = "mkt-osc-head";
        var depthTitle = doc.createElement("span");
        depthTitle.className = "mkt-osc-title";
        depthTitle.textContent = t("pool.book_title", "Order book") + " (synthetic)";
        depthHead.appendChild(depthTitle);
        depthWrap.appendChild(depthHead);
        var depthCanvas = doc.createElement("canvas");
        depthCanvas.className = "mkt-canvas";
        depthWrap.appendChild(depthCanvas);
        oscHost.appendChild(depthWrap);
        P.depthWrap = depthWrap;
        P.depthCanvas = depthCanvas;
      }
    } catch (e) { /* desk stands without the depth slice */ }
    /* Pool-map provenance slice: .mkt-osc-pane titled "Pool map" in oscHost.
     * drawCharts pins graphWrap right after depthWrap (index 2-ish). Lazy
     * async fetch for this pool's legs; never blocks the desk. */
    try {
      var graphWrap = doc.createElement("div");
      graphWrap.className = "mkt-osc-pane";
      var graphHead = doc.createElement("div");
      graphHead.className = "mkt-osc-head";
      var graphTitle = doc.createElement("span");
      graphTitle.className = "mkt-osc-title";
      graphTitle.textContent = t("pool_detail.pool_map", "Pool map");
      graphHead.appendChild(graphTitle);
      /* Pool-map Physics switch (Task 5, physics ONLY — the sole DOM addition
       * to this pane): ONE labeled on/off control, overlaid on the canvas
       * lower-left via the stage wrapper below (band parity, owner call).
       * Shared poolNetPhys key with the exchange desk + pools band (default
       * calm/off); labels reuse pool_net.phys keys (already translated — no
       * new strings). Flip persists via PoolGraph.setPhys and repaints with
       * explicit=true (bounded run even under reduced-motion); auto repaints
       * stay frozen there. Never throws. */
      try {
        var physBox = u.el(doc, "span", null, "pool-net-phys");
        try { physBox.setAttribute("data-phys-switch", "1"); } catch (eSw) { /* paint stands */ }
        physBox.appendChild(u.el(doc, "span", t("pool_net.phys", "Physics"), "pool-net-physlabel"));
        var physBtn = u.el(doc, "button", null, "pool-net-physwitch");
        try { physBtn.type = "button"; } catch (eSw) { /* click still works */ }
        try { physBtn.setAttribute("data-phys-btn", "1"); } catch (eSw) { /* paint stands */ }
        physBtn.appendChild(u.el(doc, "span", null, "pool-net-physknob"));
        try {
          if (typeof u.touchable === "function") u.touchable(physBtn);
          else if (typeof touchable === "function") touchable(physBtn);
        } catch (eSw) { /* click still works */ }
        var physState = u.el(doc, "span", t("pool_net.phys_off", "Off"), "pool-net-physstate");
        try { physState.setAttribute("data-phys-state", "1"); } catch (eSw) { /* paint stands */ }
        physBox.appendChild(physBtn);
        physBox.appendChild(physState);
        try { paintPoolPhysSwitch(physBox, readPoolPhysMode()); } catch (eSw) { /* default stands */ }
        (function (box) {
          physBtn.addEventListener("click", function () {
            var next = (readPoolPhysMode() === "lively") ? "calm" : "lively";
            try {
              if (typeof PoolGraph !== "undefined" && PoolGraph && typeof PoolGraph.setPhys === "function") {
                PoolGraph.setPhys(next);
              } else persistPoolPhys(next);
            } catch (eSw) { persistPoolPhys(next); }
            try { paintPoolPhysSwitch(box, next); } catch (eSw) { /* map stands */ }
            try { redrawPoolMap(doc, P, myGen, uiGen, true); } catch (eSw) { /* map stands */ }
          });
        })(physBox);
        graphHead.appendChild(physBox);
      } catch (eSw) { /* desk stands without the switch */ }
      graphWrap.appendChild(graphHead);
      var graphCanvas = doc.createElement("canvas");
      graphCanvas.className = "mkt-canvas";
      /* On-canvas switch overlay (owner call, band parity): the Physics box
       * built above floats over the map lower-left inside a relative stage
       * wrapper instead of sitting in the pane header. */
      var graphStage = doc.createElement("div");
      graphStage.className = "pool-net-stage";
      graphStage.appendChild(graphCanvas);
      try {
        var movedBox = graphHead.querySelector ? graphHead.querySelector("[data-phys-switch]") : null;
        if (movedBox) graphStage.appendChild(movedBox);
      } catch (eSw) { /* switch stays in header */ }
      graphWrap.appendChild(graphStage);
      var graphNote = u.el(doc, "p", "Loading pool map…", "muted");
      graphNote.setAttribute("aria-live", "polite");
      graphWrap.appendChild(graphNote);
      oscHost.appendChild(graphWrap);
      P.graphWrap = graphWrap; P.graphCanvas = graphCanvas; P.graphNote = graphNote;
      /* Existing redraw path hook: price/osc redraws also repaint the map
       * (theme/resize via P.redraw below + window resize). */
      P.redraw = function () {
        try { MarketInd.drawCharts(P); } catch (e) { /* panes stand */ }
        try { redrawPoolMap(doc, P, myGen, uiGen); } catch (e) { /* map best-effort */ }
      };
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        var onRs = function () { if (live(myGen, uiGen)) P.redraw(); else { try { window.removeEventListener("resize", onRs); } catch (e) {} } };
        window.addEventListener("resize", onRs);
        _cleanups.push(function () { try { window.removeEventListener("resize", onRs); } catch (e) { /* gone */ } });
      }
      try {
        if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
          var offTh = Store.subscribe("settings", function () { if (live(myGen, uiGen)) P.redraw(); });
          if (typeof offTh === "function") _cleanups.push(offTh);
        }
      } catch (e) { /* theme redraw best-effort */ }
      fetchPoolMap(doc, P, r, myGen, uiGen);
    } catch (e) { /* desk stands without the pool map */ }
    /* rebucketDiscrete: Discrete-mode paint from the swap tape (raw points,
     * no buckets, no ES depth — the tape IS the source). Orientation follows
     * the current enrich (invert re-enriches P.swaps, then repaints here).
     * Cap is the shared candle-count input; the note shows the ACTUAL point
     * count ("N swaps"). Never throws outward. */
    function rebucketDiscrete() {
      var cap = 2000;
      try {
        if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) cap = MarketInd.CANDLE_COUNT;
      } catch (e) { /* default stands */ }
      var vv = orientVol();
      var pts = [];
      try {
        if (typeof PoolHistory !== "undefined" && PoolHistory && typeof PoolHistory.swapsToPoints === "function") {
          pts = PoolHistory.swapsToPoints(P.swaps, vv.asset, vv.prec, cap);
        }
      } catch (e) { pts = []; }
      P.points = pts;
      P.candles = { buckets: [] };
      try { MarketInd.maybeDraw(P); } catch (e) { /* note below carries it */ }
      try {
        P.countNote.textContent = pts.length + " " + t("market.discrete_swaps", "swaps");
      } catch (e) { /* count stands */ }
    }
    /* repaintForMode: route chart repaints by mode (Discrete skips ES depth
     * + pool map — the tape IS the source and the map stays closed). Rides P
     * (state.redraw/state.paintNote precedent) so deepenPool's adopted-tape
     * callbacks — which live outside this closure — route the same way. */
    function repaintForMode() {
      P._deepDone = false; P.esBuckets = null; P._deepBucket = null;
      if (P.discrete) { rebucketDiscrete(); return; }
      rebucket();
      deepenPool(doc, P, r, note, myGen, uiGen, rebucket, histHook);
    }
    try { P.repaintForMode = repaintForMode; } catch (e) { /* callbacks fall back to bucketed */ }
    function rebucket() {
      /* Lazy-deep merge (2026-10-01 audit): background ES buckets cached by
       * deepenPool merge UNDER chain authority (fresh P.swaps win every
       * overlap — same chain-wins rule as the market desk). Bucket-keyed:
       * a timeframe switch resets the cache, so stale-bucket merges are
       * impossible. MarketFills missing -> chain buckets stand. */
      var vv = orientVol();
      var chainBuckets = PoolHistory.swapsToCandles(P.swaps, P.bucket, vv.asset, vv.prec);
      var buckets = chainBuckets;
      try {
        if (P.esBuckets && P.esBuckets.length && P._deepBucket === P.bucket &&
            typeof MarketFills !== "undefined" && MarketFills && typeof MarketFills.mergeDeep === "function") {
          buckets = MarketFills.mergeDeep(chainBuckets, P.esBuckets, 2000);
        }
      } catch (e) { buckets = chainBuckets; }
      /* Candle window (shared input): pools build from the swap tape, so
       * the count applies as a trailing slice, not a fetch window. */
      try {
        var pn = 2000;
        if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) pn = MarketInd.CANDLE_COUNT;
        if (Array.isArray(buckets) && buckets.length > pn) buckets = buckets.slice(buckets.length - pn);
      } catch (e) { /* full tape stands */ }
      P.candles = { buckets: buckets };
      try { MarketInd.maybeDraw(P); } catch (e) { /* note below carries it */ }
      try {
        var liveSuffix = (typeof poolLive !== "undefined" && poolLive && poolLive.live) ? " · live" : "";
        P.countNote.textContent = P.swaps.length + " swaps · " + P.bucket + "s candles" + liveSuffix;
      } catch (e) { /* count stands */ }
    }
    var swaps = (tape && tape.swaps) || [];
    if (!tape || !tape.source) {
      note.textContent = t("pool_detail.s2", "Pool history unavailable (chain-only; no external index).");
      deepenPool(doc, P, r, note, myGen, uiGen, rebucket, histHook);
      return;
    }
    if (!swaps.length) {
      note.textContent = t("pool.no_swaps", "No swaps yet.") + t("pool.swaps_hint", " Swaps appear after the first exchange in this pool — run one from the Swap panel above.");
      deepenPool(doc, P, r, note, myGen, uiGen, rebucket, histHook);
      return;
    }
    P.swaps = swaps;
    note.textContent = swaps.length + " swaps. " + (tape.source === "es"
      ? t("pool.hist_source_es", "Swap history via community index.")
      : t("pool.hist_source_chain", "Swap history via chain."));
    try {
      MarketInd.paintTimeframes(doc, P, function () {
        if (!live(myGen, uiGen)) return;
        repaintForMode();
      });
      if (typeof MarketInd.paintCountInput === "function") {
        MarketInd.paintCountInput(doc, P, function () {
          if (!live(myGen, uiGen)) return;
          repaintForMode();
        });
      }
    } catch (e) { /* default bucket stands */ }
    repaintForMode();
    /* Pool live tip (deep-candles 5/5): head-block poll + get_block op-63
     * scan. Each new head is fetched once; its transactions are scanned for
     * [63, body] rows in this pool, built into swap discretes (same shape as
     * PoolHistory.chainSwaps), leg-filtered, enriched, prepended (cap 500),
     * then rebucketed. Self-clears on route change via the gen guard; skips
     * when the tab is hidden; all failures silent. */
    var poolLive = { id: String(r.id), legA: r.asset_a_id, legB: r.asset_b_id, lastHead: 0, live: false };
    try { poolLive.lastHead = (Chain.status() || {}).headBlock || 0; } catch (e) { poolLive.lastHead = 0; }
    function markLive() {
      if (poolLive.live) return;
      poolLive.live = true;
      try {
        if (P.countNote && P.countNote.textContent.indexOf("live") === -1) {
          P.countNote.textContent = P.countNote.textContent + " · live";
        }
      } catch (e) { /* next rebucket carries it */ }
    }
    function scanBlock(n) {
      try {
        if (typeof Chain === "undefined" || !Chain) return;
        Chain.db().then(function (dbId) { return Chain.call(dbId, "get_block", [n]); }).then(function (block) {
          if (!live(myGen, uiGen)) return;
          try {
            var txs = (block && block.transactions) || [], out = [];
            var stamp = (block && (block.timestamp || block.block_time)) || new Date().toISOString();
            txs.forEach(function (tx) {
              var ops = (tx && tx.operations) || [], ress = (tx && tx.operation_results) || [];
              ops.forEach(function (op, k) {
                try {
                  var oid = Array.isArray(op) ? op[0] : op.type;
                  if (oid !== 63) return;
                  var bodyb = Array.isArray(op) ? op[1] : op.data;
                  if (!bodyb || String(bodyb.pool) !== poolLive.id) return;
                  var res = ress[k];
                  var resObj = Array.isArray(res) ? res[1] : res;
                  if (!resObj || !resObj.paid || !resObj.received || !resObj.paid[0] || !resObj.received[0]) return;
                  var paid = resObj.paid[0], recv = resObj.received[0];
                  var p = String(paid.asset_id), rc = String(recv.asset_id);
                  var a = String(poolLive.legA), b = String(poolLive.legB);
                  if (!((p === a || p === b) && (rc === a || rc === b) && p !== rc)) return;
                  out.push({ time: stamp, block: n, account: bodyb.account || null,
                    paid: { amount: String(paid.amount), asset: p },
                    received: { amount: String(recv.amount), asset: rc } });
                } catch (e) { /* malformed op skips */ }
              });
            });
            if (!out.length) return;
            /* Live-tip enrich follows the current orientation (invert wiring). */
            try {
              if (P.inverted) PoolHistory.enrich(out, poolLive.legB, P.precB, poolLive.legA, P.precA);
              else PoolHistory.enrich(out, poolLive.legA, P.precA, poolLive.legB, P.precB);
            } catch (e) { /* tape renders unpriced */ }
            P.swaps = out.concat(P.swaps).slice(0, 500);
            if (P.discrete) rebucketDiscrete();
            else rebucket();
          } catch (e) { /* scan skips */ }
        }).catch(function () { /* head fetch skips */ });
      } catch (e) { /* live tip skips */ }
    }
    var poolTimer = null;
    /* Leave-cleanup: the gen guard below is the backstop, but a route leave
     * for a NON-pool page never re-enters renderPoolDetail, so the 3.5s
     * poll would tick orphaned until its next live() check. Register the
     * interval in _cleanups (pool->pool navigation drains it on entry) AND
     * arm a one-shot hashchange guard that clears it the moment the hash
     * leaves this pool's detail and then removes itself. Never throws. */
    (function armLeaveCleanup() {
      var wantHash = "#/pools/" + String(r.id);
      function clearPoolTimer() {
        try { if (poolTimer !== null) clearInterval(poolTimer); } catch (e) { /* gone */ }
        poolTimer = null;
      }
      _cleanups.push(clearPoolTimer);
      try {
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
        var onLeave = function () {
          var h = "";
          try { h = String((typeof location !== "undefined" && location.hash) || ""); } catch (e) { h = ""; }
          if (h.indexOf(wantHash) === 0) return;
          clearPoolTimer();
          try { window.removeEventListener("hashchange", onLeave); } catch (e) { /* gone */ }
        };
        window.addEventListener("hashchange", onLeave);
        _cleanups.push(function () { try { window.removeEventListener("hashchange", onLeave); } catch (e) { /* gone */ } });
      } catch (e) { /* gen guard below still covers */ }
    })();
    function watchHead() {
      try {
        if (!live(myGen, uiGen)) { try { clearInterval(poolTimer); } catch (e) {} return; }
        if (typeof document !== "undefined" && document.hidden) return;
        var head = null;
        try { head = (typeof Chain !== "undefined" && Chain && Chain.status() ? Chain.status().headBlock : null) || null; } catch (e) { head = null; }
        if (!head) return;
        markLive();
        if (head > poolLive.lastHead) { poolLive.lastHead = head; scanBlock(head); }
      } catch (e) { /* poll skips */ }
    }
    try { poolTimer = setInterval(watchHead, 3500); } catch (e) { poolTimer = null; }
  }

  /* deepenPool: background ES depth for the pool chart (lazy-deep, 2026-10-01
   * audit). The desk above already painted chain-first; this fetches the ES
   * tape ONCE per bucket (2 pages / 1000 events max, ~1.5MB worst, typically
   * 1 page — measured) and caches its candles for rebucket() to merge under
   * chain authority. Tape rows stay chain (like the market desk's Recent
   * tab); only the chart gains depth, and the source line flips to the
   * existing community-index key. A chain-empty desk (lagging history api)
   * also fills its tape + history list here. Any failure or empty ES page
   * keeps the chain paint — never throws outward. No new i18n keys. */
  function deepenPool(doc, P, r, note, myGen, uiGen, rebucket, histHook) {
    try {
      if (P._deepFlight || P._deepDone) return;
      if (typeof PoolHistory === "undefined" || !PoolHistory || typeof PoolHistory.swapsForPool !== "function") return;
      var net = "mainnet";
      try {
        if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
          var st = Store.loadSettings();
          if (st && (st.network === "testnet" || st.network === "mainnet")) net = st.network;
        }
      } catch (e) { /* mainnet default stands */ }
      if (net !== "mainnet") return;
      P._deepFlight = true;
      PoolHistory.swapsForPool(r.id, 1000, { network: net, legA: r.asset_a_id, legB: r.asset_b_id }).then(function (res) {
        P._deepFlight = false;
        if (!live(myGen, uiGen)) return;
        /* A deepen flight landing while Discrete is active stands down:
         * the raw tape IS the source and ES depth is meaningless there.
         * Returning to buckets re-runs deepen through repaintForMode. */
        if (P.discrete) return;
        var swaps = (res && res.swaps) || [];
        if (!swaps.length) return;
        /* Orientation-bound (invert wiring): the ES tape enriches + buckets
         * on the current legs, never a cached orientation. */
        try {
          if (P.inverted) PoolHistory.enrich(swaps, r.asset_b_id, precOr5(r.prec_b), r.asset_a_id, precOr5(r.prec_a));
          else PoolHistory.enrich(swaps, r.asset_a_id, precOr5(r.prec_a), r.asset_b_id, precOr5(r.prec_b));
        } catch (e) { /* tape renders unpriced */ }
        var esBuckets = [];
        try {
          var ev = P.inverted ? { asset: r.asset_a_id, prec: precOr5(r.prec_a) } : { asset: r.asset_b_id, prec: precOr5(r.prec_b) };
          esBuckets = PoolHistory.swapsToCandles(swaps, P.bucket, ev.asset, ev.prec);
        } catch (e) { esBuckets = []; }
        if (!esBuckets.length) return;
        if (!P.swaps.length) {
          /* Chain was empty (lagging history api): adopt the ES tape for the
           * list too (cap like the live tip), then paint timeframes + chart.
           * Live-tip stays off here — parity with the old empty-tape path,
           * which never reached the watchHead setup either. */
          P.swaps = swaps.slice(0, 500);
          try {
            MarketInd.paintTimeframes(doc, P, function () {
              if (!live(myGen, uiGen)) return;
              /* Mode router rides P (state.redraw/state.paintNote precedent):
               * chartPane assigns it below; the fallback preserves the old
               * bucketed behavior when absent. */
              if (typeof P.repaintForMode === "function") { P.repaintForMode(); return; }
              P._deepDone = false; P.esBuckets = null; P._deepBucket = null;
              rebucket();
              deepenPool(doc, P, r, note, myGen, uiGen, rebucket, histHook);
            });
            if (typeof MarketInd.paintCountInput === "function") {
              MarketInd.paintCountInput(doc, P, function () {
                if (!live(myGen, uiGen)) return;
                if (typeof P.repaintForMode === "function") { P.repaintForMode(); return; }
                P._deepDone = false; P.esBuckets = null; P._deepBucket = null;
                rebucket();
                deepenPool(doc, P, r, note, myGen, uiGen, rebucket, histHook);
              });
            }
          } catch (e) { /* default bucket stands */ }
          try {
            if (histHook && typeof histHook.setTape === "function") histHook.setTape(P.swaps, "es");
          } catch (e) { /* chart below still paints */ }
          P._tapeSource = "es";
        }
        P.esBuckets = esBuckets;
        P._deepBucket = P.bucket;
        P._deepDone = true;
        try { rebucket(); } catch (e) { /* chain paint stands */ }
        try { note.textContent = P.swaps.length + " swaps. " + t("pool.hist_source_es", "Swap history via community index."); } catch (e) { /* count stands */ }
      }).catch(function () { P._deepFlight = false; /* chain paint stands */ });
    } catch (e) { /* deep is best-effort */ }
  }

  /* Theme token read (plain duplicate of the market-book.js helper —
   * doctrine prefers duplication over a shared chart abstraction). */
  function cssTok(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }

  /* DPR-aware canvas fit (same contract as market-book.js: {ctx, w, h} CSS
   * pixels, or null when unusable). */
  function fitPlot(canvas, cssH) {
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

  /** Pool x·y=k curve + current point (dex-ux plot proposal 5 — math from
   * Pool.curvePoints, itself a BigInt port of falcon_app.py:167-202; never
   * imported). Source balances come from the already-fetched detail row —
   * no new chain call. Collapsible <details open> with a canvas 2D line
   * (ask side: selling A into the pool) + marked current reserves. The axis
   * domains span the curve plus the current point; pixel mapping is
   * parts-per-million in BigInt, then Number() on the 0..1e6 int — exact
   * and pixel-only (never money). Tick labels go human via u.amtText at
   * render (raw fallback when the join missed a precision). Empty pool →
   * silent no-op (the depth table path below owns the honest empty sentence).
   * TYPE NOTE: xmin/xmax/ymin/ymax start null and absorb BigInt span
   * values; the inferred shape reads back mixed at the xrange/yrange
   * compare and multiply sites. Pin the accumulators (and the derived
   * ranges) to any. No shared types.js yet (group 1 owns it); local
   * annotations only, nothing to merge.
   * @param {Document} doc owner document
   * @param {HTMLElement} book mount element for the plot
   * @param {any} r pool row (balance_a_raw/balance_b_raw + precisions/syms)
   * @returns {void} */
  function drawCurve(doc, book, r) {
    var u = U(), c;
    try {
      c = Pool.curvePoints({ balanceA_raw: r.balance_a_raw, balanceB_raw: r.balance_b_raw });
    } catch (e) {
      return;
    }
    var det = doc.createElement("details");
    det.className = "plot pool-curve";
    det.setAttribute("open", "");
    var sum = doc.createElement("summary");
    sum.setAttribute("aria-label", t("pool_detail.pool_curve_plot", "Pool x y k curve plot"));
    u.touchable(sum);
    sum.textContent = t("pool_detail.pool_curve", "Pool curve (x·y=k)");
    det.appendChild(sum);
    var canvas = doc.createElement("canvas");
    canvas.className = "mkt-canvas";
    det.appendChild(canvas);
    var precA = r.prec_a === undefined ? null : r.prec_a;
    var precB = r.prec_b === undefined ? null : r.prec_b;
    var aA = u.amtText(r.balance_a_raw, r.asset_a_id, precA, r.sym_a);
    var aB = u.amtText(r.balance_b_raw, r.asset_b_id, precB, r.sym_b);
    det.appendChild(u.el(doc, "p", "Current: " + aA.text + " / " + aB.text +
      " — selling " + (r.sym_a || r.asset_a_id) + " into the pool (ask side, integer floors).", "muted"));
    book.appendChild(det);
    var g = fitPlot(canvas, 180);
    if (!g) return;
    var accent = cssTok("--accent", "#007bff");
    var buy = cssTok("--buy", "#26de81");
    var muted = cssTok("--muted", "#777777");
    var border = cssTok("--border", "#2a2e39");
    var i;
    /* TYPE NOTE: one @type above a multi-declarator var pins only the
     * first name, so each reserve bound carries its own initializer cast
     * (null is assignable to bigint with this jsconfig's strict:false;
     * runtime values are BigInts after the first span() pass). */
    var xmin = /** @type {bigint} */ (null), xmax = /** @type {bigint} */ (null),
      ymin = /** @type {bigint} */ (null), ymax = /** @type {bigint} */ (null);
    function span(v, mn, mx) {
      if (mn === null || v < mn) mn = v;
      if (mx === null || v > mx) mx = v;
      return [mn, mx];
    }
    var xs = [], ys = [];
    for (i = 0; i < c.points.length; i++) {
      var px = BigInt(c.points[i].x_raw), py = BigInt(c.points[i].y_raw);
      xs.push(px);
      ys.push(py);
      var sx = span(px, xmin, xmax);
      xmin = sx[0];
      xmax = sx[1];
      var sy = span(py, ymin, ymax);
      ymin = sy[0];
      ymax = sy[1];
    }
    var curX = BigInt(c.current.x_raw), curY = BigInt(c.current.y_raw);
    xs.push(curX);
    ys.push(curY);
    var s2 = span(curX, xmin, xmax);
    xmin = s2[0];
    xmax = s2[1];
    var s3 = span(curY, ymin, ymax);
    ymin = s3[0];
    ymax = s3[1];
    var xrange = /** @type {bigint} */ (xmax - xmin), yrange = /** @type {bigint} */ (ymax - ymin);
    var padL = 8, padR = 8, padT = 24, padB = 30;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    /** Reserve -> x pixel (parts-per-million BigInt, then Number on the
     * 0..1e6 int — exact, pixel-only).
     * @param {bigint} x reserve coordinate
     * @returns {number} canvas x pixel */
    function fx(x) {
      if (xrange === 0n) return padL + plotW / 2;
      /* Pixel-only Number(): ppm is a 0..1e6 int, exact in double. */
      return padL + (Number((x - xmin) * 1000000n / xrange) / 1000000) * plotW;
    }
    /** Reserve -> y pixel (parts-per-million BigInt, then Number on the
     * 0..1e6 int — exact, pixel-only).
     * @param {bigint} v reserve coordinate
     * @returns {number} canvas y pixel */
    function fy(v) {
      if (yrange === 0n) return padT + plotH / 2;
      /* Pixel-only Number(): ppm is a 0..1e6 int, exact in double. */
      return padT + (1 - Number((v - ymin) * 1000000n / yrange) / 1000000) * plotH;
    }
    var ctx = g.ctx;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, padT + 0.5, plotW - 1, plotH - 1);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    /* Points arrive in ascending x (i = 1..99), so one pass draws the curve. */
    for (i = 0; i < xs.length - 1; i++) {
      var qx = fx(xs[i]), qy = fy(ys[i]);
      if (i === 0) ctx.moveTo(qx, qy);
      else ctx.lineTo(qx, qy);
    }
    ctx.stroke();
    var cx = fx(curX), cy = fy(curY);
    ctx.fillStyle = buy;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = accent;
    ctx.fillRect(padL + 2, 6, 10, 3);
    ctx.fillStyle = muted;
    ctx.fillText("x·y=k", padL + 16, 15);
    ctx.fillStyle = buy;
    ctx.beginPath();
    ctx.arc(padL + 62, 11, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = muted;
    ctx.fillText("current", padL + 69, 15);
    /* Human tick labels at render (amtText degrades to raw on join miss). */
    var xMinH = u.amtText(xmin.toString(), r.asset_a_id, precA, r.sym_a).text;
    var xMaxH = u.amtText(xmax.toString(), r.asset_a_id, precA, r.sym_a).text;
    var yMinH = u.amtText(ymin.toString(), r.asset_b_id, precB, r.sym_b).text;
    var yMaxH = u.amtText(ymax.toString(), r.asset_b_id, precB, r.sym_b).text;
    ctx.fillStyle = muted;
    ctx.textAlign = "left";
    ctx.fillText(xMinH, padL + 2, padT + plotH + 14);
    ctx.fillText(yMaxH, padL + 2, padT + plotH + 26);
    ctx.textAlign = "right";
    ctx.fillText(xMaxH, padL + plotW - 2, padT + plotH + 14);
    ctx.fillText(yMinH, padL + plotW - 2, padT + plotH + 26);
    ctx.textAlign = "left";
  }

  function depthPane(doc, book, r, synthLevels) {
    /* Synthetic resting-book view: the CPMM curve rendered as bids/asks
     * through the SHARED MarketBook.renderSplit path (same tables, depth
     * bars, spread line as the exchange desk) + the x·y=k canvas above.
     * Levels arrive precomputed from detailFill (shared with the charts-stack
     * depth slice above). Rows are synthetic (no counterparty) — the note
     * says so. Clicking a row prefills the inline swap form. */
    var u = U();
    drawCurve(doc, book, r); /* x·y=k canvas above the table; silent no-op on empty pools */
    book.appendChild(u.el(doc, "p", t("pool.synth_note", "Synthetic depth from the CPMM curve at current reserves — not resting orders."), "muted"));
    if (typeof MarketBook === "undefined" || typeof PoolHistory === "undefined" ||
        typeof MarketBook.renderSplit !== "function") {
      book.appendChild(u.el(doc, "p", t("pool.depth_unavailable", "Depth unavailable (empty pool).") + t("pool.depth_hint", " Stake both legs from the Stake form to open depth."), "muted"));
      return;
    }
    var precA = precOr5(r.prec_a), precB = precOr5(r.prec_b);
    var levels = synthLevels || null;
    if (!levels || (!levels.asks.length && !levels.bids.length)) {
      book.appendChild(u.el(doc, "p", t("pool.depth_unavailable", "Depth unavailable (empty pool).") + t("pool.depth_hint", " Stake both legs from the Stake form to open depth."), "muted"));
      return;
    }
    var spreadLine = u.el(doc, "p", "", "muted");
    book.appendChild(spreadLine);
    /* Split book cells (mirror market-desk.js:585-597): BUY ORDERS (bids) |
     * SELL ORDERS (asks) as two section cells; MarketBook.renderSplit fills
     * both through the shared renderBookSide path (bare — the cells own the
     * h2s). Spread line + synth note stay above; curve canvas untouched. */
    var bidsSec = doc.createElement("section");
    bidsSec.className = "mkt-bids";
    book.appendChild(bidsSec);
    bidsSec.appendChild(u.el(doc, "h3", "Buy orders"));
    var bidsBody = doc.createElement("div");
    bidsSec.appendChild(bidsBody);
    var asksSec = doc.createElement("section");
    asksSec.className = "mkt-asks";
    book.appendChild(asksSec);
    asksSec.appendChild(u.el(doc, "h3", "Sell orders"));
    var asksBody = doc.createElement("div");
    asksSec.appendChild(asksBody);
    try {
      MarketBook.renderSplit(doc, bidsBody, asksBody, {
        book: levels, basePrec: precB, quotePrec: precA,
        baseSymbol: r.sym_b || r.asset_b_id, quoteSymbol: r.sym_a || r.asset_a_id,
        spreadLine: spreadLine
      });
    } catch (e) {
      book.appendChild(u.el(doc, "p", t("pool.depth_unavailable", "Depth unavailable (empty pool).") + t("pool.depth_hint", " Stake both legs from the Stake form to open depth."), "muted"));
      return;
    }
    /* Click-fill: DOM rows follow their side array order (chain order,
     * best-first, lowest ask on top — same as the exchange split renderer
     * since commit 4adad6b; no reverse anywhere). Ask rows are
     * taker-buys-A (pay leg B); bid rows are taker-sells-A (pay leg A);
     * amounts are the exact human strings on the row. */
    function fillSwap(human, dir) {
      try {
        var amt = doc.getElementById("pool-swap-amount");
        var sel = doc.getElementById("pool-swap-dir");
        if (!amt || !sel) return;
        amt.value = human;
        sel.value = dir;
        var ev = null;
        if (typeof Event === "function") {
          try { ev = new Event("input", { bubbles: true }); } catch (x) { ev = null; }
        }
        if (ev && typeof amt.dispatchEvent === "function") {
          try { amt.dispatchEvent(ev); } catch (x) { /* value stands */ }
        }
        if (typeof amt.focus === "function") amt.focus();
      } catch (e) { /* read-only desk stands */ }
    }
    try {
      var sides = book.querySelectorAll(".book-asks, .book-bids");
      Array.prototype.forEach.call(sides, function (side) {
        var isAsk = side.className.indexOf("book-asks") !== -1;
        var arr = isAsk ? levels.asks : levels.bids;
        var rows = side.querySelectorAll("table tbody tr, .book-row-card");
        Array.prototype.forEach.call(rows, function (row, i) {
          var lv = arr[i];
          if (!lv) return;
          var human = isAsk ? lv.base : lv.quote;
          var dir = isAsk ? "B" : "A";
          try {
            row.setAttribute("tabindex", "0");
            row.setAttribute("role", "button");
            row.setAttribute("aria-label", t("pool.fill_swap", "Fill swap"));
            row.title = t("pool.fill_swap", "Fill swap");
          } catch (e) { /* rows render unclickable */ }
          function go() { fillSwap(human, dir); }
          try {
            row.addEventListener("click", go);
            row.addEventListener("keydown", function (ev) {
              if (ev && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); go(); }
            });
          } catch (e) { /* rows render unclickable */ }
        });
      });
    } catch (e) { /* book renders unclickable */ }
  }

  /* tapeTable: swap rows with EXECUTED amounts (Time / Price B-per-A /
   * Paid / Received / Account). Amounts human via leg precisions (raw in
   * title); unknown assets render raw, never blank. */
  function tapeTable(doc, swaps, r) {
    var u = U();
    function leg(asset) {
      if (String(asset) === String(r.asset_a_id)) {
        return { prec: (r.prec_a === undefined || r.prec_a === null) ? null : r.prec_a, sym: r.sym_a || String(asset) };
      }
      if (String(asset) === String(r.asset_b_id)) {
        return { prec: (r.prec_b === undefined || r.prec_b === null) ? null : r.prec_b, sym: r.sym_b || String(asset) };
      }
      return { prec: null, sym: String(asset) };
    }
    var table = doc.createElement("table"); table.className = "node-table";
    table.appendChild(u.tableHead(doc, [
      t("pool.time_col", "Time (UTC)"), t("market.th_price", "Price"),
      t("pool.paid_col", "Paid"), t("pool.recv_col", "Received"),
      t("account.card_account", "Account")]));
    var tbody = doc.createElement("tbody");
    swaps.forEach(function (sw) {
      var tr = doc.createElement("tr");
      tr.appendChild(u.el(doc, "td", sw.time || "unknown"));
      /* Executed-swap price reads 4-sf (global price rule); paid/received
       * amounts are NOT prices and stay full-precision. */
      var tapePx = "—";
      if (sw.price !== null && sw.price !== undefined) {
        tapePx = String(sw.price);
        try {
          if (typeof Format !== "undefined" && Format && typeof Format.priceSig === "function") {
            var tsig = Format.priceSig(tapePx);
            if (typeof tsig === "string" && tsig) tapePx = tsig;
          }
        } catch (e) { /* 8-place stands */ }
      }
      tr.appendChild(u.el(doc, "td", tapePx));
      [sw.paid, sw.received].forEach(function (legAmt) {
        var L = leg(legAmt.asset);
        tr.appendChild(u.el(doc, "td", u.amtText(legAmt.amount, legAmt.asset, L.prec, L.sym).text));
      });
      var tdA = doc.createElement("td");
      if (sw.account) {
        var a = doc.createElement("a");
        a.href = "#/account/" + encodeURIComponent(sw.account);
        a.textContent = sw.account;
        u.touchable(a);
        tdA.appendChild(a);
      } else tdA.textContent = "—";
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function historyPane(doc, hist, r, tape, myGen, uiGen, histHook) {
    /* Swap tape (Time / Price / Paid / Received / Account) + My-swaps
     * toggle — mirrors the market desk Recent/My tabs (same mkt-tabs
     * contract, same locked-hint). Rows come from the shared tape fetch
     * (executed paid/received, human strings, raw in title). Long tapes
     * scroll in place inside .pool-hist-scroll (same 15-row metrics as
     * .trades-scroll in desk-grid.css), never running down the page. */
    var u = U();
    /* Toggle mirrors #1 MarketHistory group-1 tabs (Exchange.jsx:2551-2616):
     * Pool history (all events) vs My swaps (wallet op-63 for this pool).
     * My needs unlock: locked wallets get the Wallet-link hint (#9). */
    var tabs = doc.createElement("div");
    tabs.className = "mkt-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("pool.exchanges_toggle_label", "Pool or my swaps"));
    var tabPool = u.touchable(u.el(doc, "button", t("pool.tab_pool", "Pool history")));
    tabPool.type = "button"; tabPool.id = "pool-hist-tab-pool"; tabPool.setAttribute("role", "tab");
    var tabMy = u.touchable(u.el(doc, "button", t("pool.tab_my", "My swaps")));
    tabMy.type = "button"; tabMy.id = "pool-hist-tab-my"; tabMy.setAttribute("role", "tab");
    tabs.appendChild(tabPool); tabs.appendChild(tabMy);
    hist.appendChild(tabs);
    /* Swap filter row (client-side over the fetched tape — no refetch, no
     * new chain call; ephemeral, persist nothing): side select (buy =
     * received leg A, sell = paid leg A — A is the charted goods in this
     * desk's B-per-A orientation) + min/max price bounds on the displayed
     * 8-place Price column (Format.parseAmount at 8 places; blank/invalid
     * bounds are ignored, never blocking — forgiving per principle #4) +
     * account substring (id or name fragment, case-insensitive).
     * paintTape reads these controls at every paint, so the background
     * deepenPool late-fill keeps active filters. */
    var fltSide = Forms.labeledSelect(doc, t("market.col_side", "Side") + " ",
      [["all", t("market.kind_all", "All")], ["buy", t("account.buy_th", "Buy")], ["sell", t("account.sell_th", "Sell")]], "all");
    hist.appendChild(fltSide.row);
    var fltMin = Forms.labeledInput(doc, t("market.flt_min_price", "Min price") + " ", { inputmode: "decimal", autocomplete: "off" });
    hist.appendChild(fltMin.row);
    var fltMax = Forms.labeledInput(doc, t("market.flt_max_price", "Max price") + " ", { inputmode: "decimal", autocomplete: "off" });
    hist.appendChild(fltMax.row);
    var fltAcct = Forms.labeledInput(doc, t("account.card_account", "Account") + " ", {
      placeholder: t("common.name_or_id_hint", "name or 1.2.N"), autocomplete: "off"
    });
    hist.appendChild(fltAcct.row);
    var poolBody = u.el(doc, "div"); poolBody.id = "pool-hist-pool"; poolBody.setAttribute("role", "tabpanel");
    var myBody = u.el(doc, "div"); myBody.id = "pool-hist-my"; myBody.setAttribute("role", "tabpanel");
    /* APG tab-panel association (both panels exist with stable ids). */
    tabPool.setAttribute("aria-controls", "pool-hist-pool");
    tabMy.setAttribute("aria-controls", "pool-hist-my");
    poolBody.setAttribute("aria-labelledby", "pool-hist-tab-pool");
    myBody.setAttribute("aria-labelledby", "pool-hist-tab-my");
    hist.appendChild(poolBody); hist.appendChild(myBody);
    var cur = "pool";
    /* paint: Pool-history vs My-swaps tab visibility + ARIA (incl. roving
     * tabindex: selected 0, rest -1). */
    function paint() {
      var isMy = cur === "my";
      tabPool.setAttribute("aria-selected", isMy ? "false" : "true");
      tabMy.setAttribute("aria-selected", isMy ? "true" : "false");
      tabPool.setAttribute("aria-pressed", isMy ? "false" : "true");
      tabMy.setAttribute("aria-pressed", isMy ? "true" : "false");
      tabPool.tabIndex = isMy ? -1 : 0;
      tabMy.tabIndex = isMy ? 0 : -1;
      poolBody.style.display = isMy ? "none" : "";
      myBody.style.display = isMy ? "" : "none";
    }
    tabPool.addEventListener("click", function () { cur = "pool"; paint(); });
    tabMy.addEventListener("click", function () { cur = "my"; paint(); loadMy(poolBody, myBody, r, myGen, uiGen); });
    /* APG tabs keyboard: arrows/Home/End focus + click (activation stays
     * the click path above, no separate route). */
    tabs.addEventListener("keydown", function (ev) {
      if (!ev) return;
      var k = ev.key;
      if (k !== "ArrowLeft" && k !== "ArrowRight" && k !== "ArrowUp" &&
        k !== "ArrowDown" && k !== "Home" && k !== "End") return;
      var pair = [tabPool, tabMy];
      var curI = 0;
      if (doc.activeElement === tabMy) curI = 1;
      else if (doc.activeElement !== tabPool) {
        curI = (cur === "my") ? 1 : 0;
      }
      var n = curI;
      if (k === "ArrowLeft" || k === "ArrowUp") n = (curI + pair.length - 1) % pair.length;
      else if (k === "ArrowRight" || k === "ArrowDown") n = (curI + 1) % pair.length;
      else if (k === "Home") n = 0;
      else if (k === "End") n = pair.length - 1;
      if (ev.preventDefault) ev.preventDefault();
      pair[n].focus();
      pair[n].click();
    });
    paint();
    var note = u.el(doc, "p", t("account.loading_history", "Loading history…"), "muted"); poolBody.appendChild(note);
    poolBody.removeChild(note);
    /* paintTape: render one tape state into poolBody (extracted so the
     * background deepenPool can late-fill the list when chain-first came up
     * empty — same three branches, same keys, no new words). Caches the
     * tape for filter repaints, then applies the filter row client-side;
     * the 50-row cap is kept and the N= line names the filtered total so
     * caps never hide silently. */
    /* lastTape: most recent tape state for filter repaints (filter changes
     * never refetch). */
    var lastTape = { swaps: [], source: null };
    function paintTape(swaps, source) {
      lastTape = { swaps: swaps || [], source: source || null };
      var filtered = applyTapeFilter(lastTape.swaps, readTapeFilter());
      while (poolBody.firstChild) poolBody.removeChild(poolBody.firstChild);
      if (!lastTape.source) {
        poolBody.appendChild(u.el(doc, "p", t("pool_detail.s2", "Pool history unavailable (chain-only; no external index)."), "muted"));
      } else if (!lastTape.swaps.length) {
        poolBody.appendChild(u.el(doc, "p", t("pool.no_swaps", "No swaps yet.") + t("pool.swaps_hint", " Swaps appear after the first exchange in this pool — run one from the Swap panel above."), "muted"));
      } else if (!filtered.length) {
        poolBody.appendChild(u.el(doc, "p", t("pool.no_filter_match", "No swaps match these filters."), "muted"));
        poolBody.appendChild(u.el(doc, "p", tapeCount(0, 0), "muted"));
      } else {
        var shown = filtered.slice(0, 50);
        var scroller = doc.createElement("div");
        scroller.className = "pool-hist-scroll";
        scroller.appendChild(tapeTable(doc, shown, r));
        poolBody.appendChild(scroller);
        poolBody.appendChild(u.el(doc, "p", tapeCount(shown.length, filtered.length), "muted"));
      }
    }
    /* readTapeFilter: current pool-tape filter values (side/all + raw bound
     * + account strings — parsing happens in applyTapeFilter). Never throws
     * (missing controls read as unfiltered).
     * @returns {{side: string, min: string, max: string, acct: string}} */
    function readTapeFilter() {
      var side = "all", mn = "", mx = "", ac = "";
      try { side = fltSide.select.value || "all"; } catch (e) { side = "all"; }
      try { mn = fltMin.input.value; } catch (e) { mn = ""; }
      try { mx = fltMax.input.value; } catch (e) { mx = ""; }
      try { ac = fltAcct.input.value; } catch (e) { ac = ""; }
      return { side: side, min: String(mn || "").trim(), max: String(mx || "").trim(), acct: String(ac || "").trim() };
    }
    /* swapSide: buy when the swap RECEIVED leg A (bought the charted goods),
     * sell when it PAID leg A. Null on unknown legs (matches no side
     * filter, kept when side is all). Orientation-independent (legs never
     * swap under the Invert toggle — only prices re-enrich).
     * @param {any} sw enriched swap (paid/received {amount, asset})
     * @returns {string|null} "buy", "sell", or null. */
    function swapSide(sw) {
      try {
        if (sw && sw.received && String(sw.received.asset) === String(r.asset_a_id)) return "buy";
        if (sw && sw.paid && String(sw.paid.asset) === String(r.asset_a_id)) return "sell";
      } catch (e) { /* null below */ }
      return null;
    }
    /* swapPrice12: tape Price string (B-per-A from enrich, 8 places on
     * normal pools, up to 12 on sub-satoshi ones) as a raw int via
     * parseAmount round-trip — exact, never float. Parsed at 12 so longer
     * strings never throw (8-place strings pad up fine, comparisons stay
     * exact). Null when the row never enriched: bounded filters exclude it,
     * unbounded keep it.
     * @param {any} sw enriched swap
     * @returns {string|null} digit string or null. */
    function swapPrice12(sw) {
      try {
        if (!sw || sw.price === null || sw.price === undefined) return null;
        return Format.parseAmount(String(sw.price), 12);
      } catch (e) { return null; }
    }
    /* tapeBound12: human decimal bound -> 12-place raw int string, or null
     * for blank/invalid (ignored, never blocking — forgiving per #4).
     * Parses at 12 to match swapPrice12 above (a typed 8-place bound pads
     * up exactly; sub-satoshi bounds keep their figs).
     * @param {string} s raw input
     * @returns {string|null} */
    function tapeBound12(s) {
      var v = String(s || "").trim();
      if (!v) return null;
      try { return Format.parseAmount(v, 12); } catch (e) { return null; }
    }
    /* applyTapeFilter: side + price-band + account-substring over fetched
     * swaps (client-side only — no refetch). Price compares exact BigInt at
     * 12 places (never float); account matches case-insensitively.
     * @param {any[]} swaps unfiltered tape swaps
     * @param {{side: string, min: string, max: string, acct: string}} flt
     * @returns {any[]} filtered swaps. */
    function applyTapeFilter(swaps, flt) {
      var minR = tapeBound12(flt.min), maxR = tapeBound12(flt.max);
      var minB = null, maxB = null;
      try { if (minR !== null) minB = BigInt(minR); } catch (e) { minB = null; }
      try { if (maxR !== null) maxB = BigInt(maxR); } catch (e) { maxB = null; }
      var aq = flt.acct ? flt.acct.toLowerCase() : "";
      return (swaps || []).filter(function (sw) {
        if (flt.side === "buy" || flt.side === "sell") {
          if (swapSide(sw) !== flt.side) return false;
        }
        if (minB !== null || maxB !== null) {
          var p12 = swapPrice12(sw);
          if (p12 === null) return false;
          var pv = null;
          try { pv = BigInt(p12); } catch (e) { return false; }
          if (minB !== null && pv < minB) return false;
          if (maxB !== null && pv > maxB) return false;
        }
        if (aq && String((sw && sw.account) || "").toLowerCase().indexOf(aq) === -1) return false;
        return true;
      });
    }
    /* tapeCount: cap label in pure symbols (numbers + "/" + "N=" need no
     * translation — principle #10). "N=47" when everything shows, "50/231"
     * when the 50-row cap cuts the filtered tape, so caps never hide
     * silently.
     * @param {number} shown rows rendered
     * @param {number} total filtered rows
     * @returns {string} */
    function tapeCount(shown, total) {
      return shown >= total ? ("N=" + total) : (shown + "/" + total);
    }
    /* Tape filter repaints (reactive per #4): every control repaints from
     * the cached tape — never a refetch. */
    function refilterTape() {
      paintTape(lastTape.swaps, lastTape.source);
    }
    fltSide.select.addEventListener("change", refilterTape);
    fltMin.input.addEventListener("input", refilterTape);
    fltMax.input.addEventListener("input", refilterTape);
    fltAcct.input.addEventListener("input", refilterTape);
    paintTape((tape && tape.swaps) || [], tape ? tape.source : null);
    try {
      if (histHook) histHook.setTape = function (swaps, source) {
        if (!live(myGen, uiGen)) return;
        paintTape(swaps || [], source || null);
      };
    } catch (e) { /* initial paint stands */ }
    myBody.appendChild(u.el(doc, "p", t("pool.my_hist_hint", "Open My swaps to see your fills in this pool."), "muted"));
    /* loadMy: My-swaps tab body (typed-account preview + locked hint +
     * unlocked wallet tape, filtered to this pool). Params: container els,
     * confirm-row spec, generation pair. Route-gen guarded. */
    function loadMy(poolBodyEl, myBodyEl, row, g1, g2) {
      void poolBodyEl;
      u.clearBox(myBodyEl);
      var unlocked = false;
      try {
        unlocked = typeof Wallet !== "undefined" && Wallet &&
          (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
      } catch (e) { unlocked = false; }
      /* Typed-account preview row (principle #9: reads never gate on
       * unlock). The pool tape is already fetched; a typed lookup only
       * resolves the account and filters the same tape rows. Blank +
       * locked keeps the Wallet-link hint. Unlocked prefills the wallet
       * account; the wallet tape-filter below is unchanged. */
      var fAcct = u.field(doc, t("account.card_account", "Account"),
        { placeholder: t("common.name_or_id_hint", "name or 1.2.N") });
      myBodyEl.appendChild(fAcct.row);
      var viewBtn = u.touchable(u.el(doc, "button", t("referrals.look_up", "Look up")));
      viewBtn.type = "button";
      myBodyEl.appendChild(viewBtn);
      /* My-swaps filter row: side + min/max price only (account stays the
       * fAcct lookup above — no second account control here). Same
       * client-side contract as the pool-tape row: ephemeral, no refetch. */
      var fSide = Forms.labeledSelect(doc, t("market.col_side", "Side") + " ",
        [["all", t("market.kind_all", "All")], ["buy", t("account.buy_th", "Buy")], ["sell", t("account.sell_th", "Sell")]], "all");
      myBodyEl.appendChild(fSide.row);
      var fMin = Forms.labeledInput(doc, t("market.flt_min_price", "Min price") + " ", { inputmode: "decimal", autocomplete: "off" });
      myBodyEl.appendChild(fMin.row);
      var fMax = Forms.labeledInput(doc, t("market.flt_max_price", "Max price") + " ", { inputmode: "decimal", autocomplete: "off" });
      myBodyEl.appendChild(fMax.row);
      var listBox = u.el(doc, "div");
      myBodyEl.appendChild(listBox);
      /* lastMine: this account's pool swaps (unfiltered cache — filter
       * changes repaint, never refetch). Null until the first paint. */
      var lastMine = null;
      /* drawMine: paint one account's pool swaps (empty -> hint).
       * Caches the unfiltered rows, then applies the side/price filter row
       * above client-side via the shared applyTapeFilter (acct blank — the
       * fAcct lookup already scoped the rows); the 20-row cap is kept and
       * the N= line names the filtered total. No-ops when the route
       * generation moved on. Long lists scroll in place inside
       * .pool-hist-scroll (same metrics as .trades-scroll). */
      function drawMine(mine) {
        if (!live(g1, g2)) return;
        lastMine = mine || [];
        var side = "all", mn = "", mx = "";
        try { side = fSide.select.value || "all"; } catch (e) { side = "all"; }
        try { mn = fMin.input.value; } catch (e) { mn = ""; }
        try { mx = fMax.input.value; } catch (e) { mx = ""; }
        var filtered = applyTapeFilter(lastMine, { side: side, min: String(mn || "").trim(), max: String(mx || "").trim(), acct: "" });
        u.clearBox(listBox);
        if (!filtered.length) {
          if (lastMine.length) { listBox.appendChild(u.el(doc, "p", t("pool.no_filter_match", "No swaps match these filters."), "muted")); }
          else { listBox.appendChild(u.el(doc, "p", t("pool.no_my_exchanges", "No swaps for your account in this pool.") + t("pool.my_swaps_hint", " Run one from the Swap panel above — your swaps in this pool list here."), "muted")); }
          listBox.appendChild(u.el(doc, "p", tapeCount(0, 0), "muted"));
          return;
        }
        var shown = filtered.slice(0, 20);
        var scroller = doc.createElement("div");
        scroller.className = "pool-hist-scroll";
        scroller.appendChild(tapeTable(doc, shown, row));
        listBox.appendChild(scroller);
        listBox.appendChild(u.el(doc, "p", tapeCount(shown.length, filtered.length), "muted"));
      }
      /* Mine filter repaints: every control repaints from the cached rows. */
      function refilterMine() {
        if (lastMine === null) return;
        drawMine(lastMine);
      }
      fSide.select.addEventListener("change", refilterMine);
      fMin.input.addEventListener("input", refilterMine);
      fMax.input.addEventListener("input", refilterMine);
      /* lockedHint: locked-wallet empty state with a Wallet link. */
      function lockedHint() {
        if (!live(g1, g2)) return;
        u.clearBox(listBox);
        var hint = u.el(doc, "p", t("pool.my_locked", "Unlock your wallet to see your swaps in this pool. "), "muted");
        var a = doc.createElement("a");
        a.textContent = t("market.go_wallet", "Go to Wallet");
        a.setAttribute("href", "#/wallet");
        u.touchable(a);
        hint.appendChild(a);
        listBox.appendChild(hint);
      }
      /* loadTyped: resolve the typed account and filter the fetched tape
       * to its rows (public reads only); blank input keeps the hint. */
      function loadTyped() {
        if (!live(g1, g2)) return;
        var v = fAcct.input.value.trim();
        if (!v) {
          if (!live(g1, g2)) return;
          if (!unlocked) lockedHint();
          else loadMy(poolBodyEl, myBodyEl, row, g1, g2);
          return;
        }
        u.clearBox(listBox);
        u.showStatus(doc, listBox, t("account.loading_history", "Loading history…"));
        Promise.resolve().then(function () {
          if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
            throw new Error("account backend missing");
          }
          return Account.resolve(v);
        }).then(function (acct) {
          if (!live(g1, g2)) return;
          var tape2 = (typeof tape !== "undefined" && tape && tape.swaps) || [];
          drawMine(tape2.filter(function (sw) { return sw && String(sw.account) === String(acct.id); }));
        }).catch(function (e) {
          if (!live(g1, g2)) return;
          u.clearBox(listBox); u.showError(doc, listBox, e, t("pool.my_history_failed", "Could not load your swaps."));
          try {
            if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
              var typedHistLink = HistoryNotice.actionLink(doc, t, "settings");
              if (typedHistLink) listBox.appendChild(typedHistLink);
            }
          } catch (e2) { /* error panel stands without the link */ }
        });
      }
      viewBtn.addEventListener("click", loadTyped);
      if (!unlocked) {
        lockedHint();
        return;
      }
      /* Unlocked: prefill the wallet account id (convenience only). */
      try {
        if (typeof Account !== "undefined" && Account && typeof Account.myAccountId === "function") {
          Account.myAccountId().then(function (id) {
            if (!live(g1, g2)) return;
            if (!fAcct.input.value && id) fAcct.input.value = String(id);
          }).catch(function () { /* tape filter below stands */ });
        }
      } catch (e) { /* tape filter below stands */ }
      u.showStatus(doc, listBox, t("account.loading_history", "Loading history…"));
      Account.myAccountId().then(function (myId) {
        if (!live(g1, g2)) return;
        u.clearBox(listBox);
        var tape2 = (typeof tape !== "undefined" && tape && tape.swaps) || [];
        drawMine(tape2.filter(function (sw) { return sw && String(sw.account) === String(myId); }));
      }).catch(function (e) {
        if (!live(g1, g2)) return;
        u.clearBox(listBox); u.showError(doc, listBox, e, t("pool.my_history_failed", "Could not load your swaps."));
        try {
          if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
            var myHistLink = HistoryNotice.actionLink(doc, t, "settings");
            if (myHistLink) listBox.appendChild(myHistLink);
          }
        } catch (e2) { /* error panel stands without the link */ }
      });
    }
  }

  /* Pool-map lazy loader: the SINGLE canonical loader lives in
   * market-desk-fill.js (MarketDesk._fill.ensurePoolGraph — once-guard,
   * onload/onerror waiter drain, file:// + http via document.baseURI;
   * index.html loads the fill before this file, so the global is present).
   * This wrapper only delegates — no second queue, so both desks requesting
   * together inject exactly one <script>. Never throws. */
  function _ensurePoolGraph(cb) {
    try {
      var f = null;
      if (typeof MarketDesk !== "undefined" && MarketDesk && MarketDesk._fill &&
          typeof MarketDesk._fill.ensurePoolGraph === "function") f = MarketDesk._fill.ensurePoolGraph;
      else if (typeof globalThis !== "undefined" && globalThis.MarketDesk && globalThis.MarketDesk._fill &&
          typeof globalThis.MarketDesk._fill.ensurePoolGraph === "function") f = globalThis.MarketDesk._fill.ensurePoolGraph;
      if (f) { f(cb); return; }
    } catch (e) { /* honest fail below */ }
    /* Fill missing (node require of this file alone — no document either):
     * match the canonical loader's headless contract (cb(false)). */
    try { cb(false); } catch (e) {}
  }

  /* Pool-map Physics pref (Task 5): shared poolNetPhys key with the exchange
   * desk + pools band, default calm/off. PoolGraph.readPhys wins when the
   * lazy script loaded, else guarded localStorage. Never throws. */
  function readPoolPhysMode() {
    try {
      if (typeof PoolGraph !== "undefined" && PoolGraph && typeof PoolGraph.readPhys === "function") {
        return PoolGraph.readPhys();
      }
    } catch (e) { /* storage below */ }
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("poolNetPhys") === "lively") return "lively";
    } catch (e) { /* calm stands */ }
    return "calm";
  }
  function persistPoolPhys(m) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem("poolNetPhys", m); } catch (e) { /* memory-only */ }
  }
  function paintPoolPhysSwitch(box, mode) {
    try {
      var btn = box.querySelector ? box.querySelector("[data-phys-btn]") : null;
      var st = box.querySelector ? box.querySelector("[data-phys-state]") : null;
      if (!btn || !st) {
        var kids = box.children || [];
        for (var i = 0; i < kids.length; i++) {
          if (kids[i] && kids[i].getAttribute && kids[i].getAttribute("data-phys-btn")) btn = kids[i];
          if (kids[i] && kids[i].getAttribute && kids[i].getAttribute("data-phys-state")) st = kids[i];
        }
      }
      var on = mode === "lively";
      if (btn) {
        btn.setAttribute("role", "switch");
        btn.setAttribute("aria-checked", on ? "true" : "false");
        btn.setAttribute("aria-label", t("pool_net.phys", "Physics"));
      }
      if (st) st.textContent = on ? t("pool_net.phys_on", "On") : t("pool_net.phys_off", "Off");
    } catch (e) { /* switch stands */ }
  }

  /* Fetch 2-layer pool graph for this pool's legs (lazy async, <=9 RPCs).
   * Stale-route guarded by live(). Failures -> honest empty note. */
  function fetchPoolMap(doc, P, r, myGen, uiGen) {
    if (!P.graphWrap || !P.graphCanvas || !P.graphNote) return;
    _ensurePoolGraph(function (ok) {
      if (!live(myGen, uiGen)) return;
      if (!ok) { try { P.graphNote.textContent = t("pool_detail.pool_map_unavailable_script", "Pool map unavailable (script load failed)."); } catch (e) {} return; }
      var pA = r.asset_a_id, pB = r.asset_b_id;
      try {
        PoolGraph.buildGraph(pA, pB, { depth: 2, cap: 25 }).then(function (g) {
          if (!live(myGen, uiGen)) return;
          var pa = null, pb = null;
          try { pa = PoolGraph.findCorePath(g, pA); } catch (e) { pa = null; }
          try { pb = PoolGraph.findCorePath(g, pB); } catch (e) { pb = null; }
          P.graphData = { graph: g, assetA: pA, assetB: pB, pathA: pa, pathB: pb };
          redrawPoolMap(doc, P, myGen, uiGen);
          try { MarketInd.drawCharts(P); } catch (e) { /* pin best-effort */ }
        }).catch(function (e) {
          if (!live(myGen, uiGen)) return;
          var m = String((e && e.message) || e || "");
          try {
            if (m.indexOf("not-connected") !== -1) P.graphNote.textContent = t("pool_detail.pool_map_unavailable_offline", "Pool map unavailable (offline).");
            else P.graphNote.textContent = t("pool.touch_hint", "No pools touch these assets — pick a pair with a pool, or create one at #/pools.");
          } catch (x) {}
        });
      } catch (e) { /* map best-effort */ }
    });
  }

  /* Repaint the pool-map canvas from cached graphData (theme/resize path). Never throws outward. */
  function redrawPoolMap(doc, P, myGen, uiGen, explicit) {
    if (!P.graphData || !P.graphCanvas) return;
    if (P.showPoolMap === false) return;
    if (!live(myGen, uiGen)) return;
    try {
      if (typeof PoolGraph === "undefined" || !PoolGraph) return;
      var gd = P.graphData, hi = [], seen = {};
      [(gd.pathA && gd.pathA.via) || [], (gd.pathB && gd.pathB.via) || []].forEach(function (list) {
        (list || []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; hi.push(id); } });
      });
      /* Task 5 physics branch (exchange-desk parity): lively animates through
       * PoolGraph.drawLive (same painter — look/verdicts/hit-test unchanged);
       * calm keeps the settle-once drawGraph path. explicit=true only from
       * the Physics flip. */
      var liveOn = false;
      try {
        liveOn = readPoolPhysMode() === "lively" &&
          typeof PoolGraph.drawLive === "function";
      } catch (e) { liveOn = false; }
      if (liveOn) {
        PoolGraph.drawLive(doc, P.graphCanvas, gd.graph,
          { assetA: gd.assetA, assetB: gd.assetB, highlightPools: hi, explicit: !!explicit });
      } else {
        try {
          if (typeof PoolGraph.stopLive === "function") PoolGraph.stopLive(P.graphCanvas);
        } catch (e) { /* static paint stands */ }
        PoolGraph.drawGraph(doc, P.graphCanvas, gd.graph,
          { assetA: gd.assetA, assetB: gd.assetB, highlightPools: hi });
      }
      var n = (gd.graph.edges || []).length;
      if (!n) P.graphNote.textContent = t("pool.touch_hint", "No pools touch these assets — pick a pair with a pool, or create one at #/pools.");
      else if (!gd.pathA && !gd.pathB) P.graphNote.textContent = t("pool_detail.no_bts_path_unverified", "No BTS path — treat pair as unverified.");
      else {
        var bits = [];
        if (gd.pathA) bits.push("pool→BTS " + gd.pathA.hops.length + " hops");
        if (gd.pathB) bits.push("pool→BTS " + gd.pathB.hops.length + " hops");
        P.graphNote.textContent = t("pool_detail.bts_provenance_prefix", "BTS provenance: ") + bits.join(" · ") + ".";
      }
    } catch (e) { /* canvas best-effort */ }
  }
  PoolDetailUI._view.renderPoolDetail = renderPoolDetail;
  if (typeof globalThis !== "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
})();

if (typeof module !== "undefined") { module.exports = PoolDetailUI; }
