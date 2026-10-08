/* market-desk-fill.js — DEX desk chain fill (data fetching + refetch).
 *
 * What it owns: fill (book/stats/trades/my-trades/timeframes/candles —
 *   each section fails inline), graphSrc/ensurePoolGraph/_graphLoading/
 *   _graphWaiters (lazy pool-graph loader), deskAlive (liveness guard),
 *   fetchPoolMap/fetchFeed/redrawPoolMap (pool-map + feed panes). Consumes:
 *   MarketDesk._panels (paintBook/renderMyTrades/deepenOnce — late-bound at
 *   call time), Market/MarketBook/MarketOrders/MarketInd/MarketCharts/
 *   MarketCandles/PoolHistory/PoolGraph/Format/Chain/Store/DOM. Globals/side
 *   effects: DOM under caller-provided bodies only; attaches MarketDesk._fill
 *   and republishes globalThis.MarketDesk. No signing.
 *   Split from market-desk.js (mechanical move, zero behavior change —
 *   called by the facade showDesk + refresh timer via the registry).
 *   Facade: market-desk.js.
 * Created by: split_responsibility.py account/market frontier.
 */
var MarketDesk = (typeof globalThis !== "undefined" && globalThis.MarketDesk) ? globalThis.MarketDesk : ((typeof MarketDesk !== "undefined") ? MarketDesk : {});
MarketDesk._fill = MarketDesk._fill || {};
(function () {
  "use strict";

  /* Verbatim copy of market-desk.js t (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Batch-2b i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") {
        if (vars && typeof vars === "object") return I18n.t(key, dflt, vars);
        return I18n.t(key, dflt);
      }
    } catch (e) { /* default below */ }
    /* vars fill %(name)s placeholders when I18n is absent (pool-net-ui.js
     * precedent — file:// renders identically instead of showing raw %). */
    if (vars && typeof dflt === "string") {
      try {
        return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
          return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
        });
      } catch (e2) { /* default below */ }
    }
    return dflt;
  }

  /* No local el/clearRoot — use DOM.el, DOM.clear */

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */

  /* Verbatim copy of market-desk.js showError (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Inline error panel (aria-live); chain error shapes map to sentences.
   * History fallback keeps its byte-identical message key and gains a linked
   * "Open Settings" action (HistoryNotice.actionLink, pure DOM). */
  function showError(doc, wrap, e, fallback) {
    var raw = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || "");
    var isHist = raw.indexOf("history-unavailable") !== -1;
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("bad-market") !== -1) {
      msg = "Unknown market. Check the QUOTE_BASE pair (e.g. " + defaultMarket() + ").";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("market.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("market.err_history", "History unavailable on this node (fills and charts need the history plugin).");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    }
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

  /* Verbatim copy of market-desk.js rawDetails (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Raw-JSON <details> block for a section ( P R O O F, not decoration).
   * Triangle-only summary per the shared details.raw contract in app.css. */
  function rawDetails(doc, section, label, value) {
    var d = doc.createElement("details");
    d.className = "raw";
    var s = doc.createElement("summary");
    s.setAttribute("aria-label", label || t("market.raw_fallback", "Show raw JSON"));
    touchable(s);
    d.appendChild(s);
    var pre = doc.createElement("pre");
    try {
      pre.textContent = JSON.stringify(value, null, 2);
    } catch (e) {
      pre.textContent = String(value);
    }
    d.appendChild(pre);
    section.appendChild(d);
  }

  /* Verbatim copy of market-desk.js defaultMarket (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Canonical default market per bitshares-ui/app/branding.js:98-108. */
  function defaultMarket() {
    return network() === "testnet" ? "USD_TEST" : "BTS_CNY";
  }

  /* Verbatim copy of market-desk.js network (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Network from Store (sole settings owner); mainnet when unreadable. */
  function network() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* Fill every section from the chain; sections fail inline, never blank.
   * Strip/timeframe/chart bodies live in market-ind.js (MarketInd.*) — the
   * chain calls and section wiring stay here, exactly as before. */
  function fill(state) {
    if (state.loading) return;
    if (!state.assets) return;
    state.loading = true;
    var doc = state.doc;
    var q = state.assets.quote, b = state.assets.base;
    var done = function () {
      state.loading = false;
      try {
        state.updated.textContent = t("market.updated_prefix", "Updated ") + new Date().toLocaleTimeString();
      } catch (e) { state.updated.textContent = ""; }
    };

    /* Click-to-fill lives in the book rows (market-book.js fillTradePrice):
     * a row sets BOTH panels' price inputs and focuses the taking side's
     * amount. The book cells stay display-only otherwise. */
    Market.book(b.id, q.id, 50).then(function (book) {
      state.bookRaw = book;
      MarketDesk._panels.paintBook(doc, state);
      MarketInd.maybeDraw(state);
    }).catch(function (e) {
      DOM.clear(state.bidsBody);
      DOM.clear(state.asksBody);
      showError(doc, state.bidsBody, e, t("market.fail_book", "Could not load the order book."));
      var retry = touchable(DOM.el(doc, "button", t("market.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () { fill(state); });
      state.bidsBody.appendChild(retry);
      state.asksBody.appendChild(DOM.el(doc, "p", t("market.fail_book", "Could not load the order book."), "muted"));
    });

    MarketInd.renderStrip(doc, state);

    Market.stats(b.id, q.id).then(function (st) {
      state.ticker = st;
      MarketInd.renderStrip(doc, state);
      /* Slice-16 (F1a): pulled alert engine on the existing ticker refresh.
       * Pair key QUOTE_BASE + human latest; a notify fault never breaks the
       * desk (guarded; missing feed simply never fires downstream). */
      try {
        if (typeof NotifyHost !== "undefined" && NotifyHost &&
            typeof NotifyHost.mountToasts === "function") {
          try { NotifyHost.mountToasts(); } catch (e) { /* host best-effort */ }
        }
        if (typeof NotifyRules !== "undefined" && NotifyRules &&
            typeof NotifyRules.checkAlerts === "function") {
          try { NotifyRules.checkAlerts(state.id, st ? st.latest : null); } catch (e) { /* never break desk */ }
        }
      } catch (e) { /* notify optional here */ }
      /* Raw-ticker proof (triangle-only, refilled per fetch — the 24h dl
       * panel left with the stats grid cell; the strip above carries the
       * human fields). */
      DOM.clear(state.tickerRaw);
      rawDetails(doc, state.tickerRaw, "Raw ticker", st.raw);
    }).catch(function (e) {
      DOM.clear(state.tickerRaw);
      showError(doc, state.tickerRaw, e, t("market.fail_stats", "Could not load market stats."));
    });

    /* Deep view wins refills: while state.deepRows stands, the loop
     * re-renders it (no refetch, no wipe) — the Back button is the exit. */
    if (state.deepRows) {
      MarketBook.renderTrades(doc, state.recentBody || state.tradesBody, { rows: state.deepRows, quoteSymbol: q.symbol });
      MarketDesk._panels.paintDeepButton(doc, state, b, q);
      MarketDesk._panels.renderMyTrades(doc, state);
      MarketInd.maybeDraw(state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    } else {
    Market.trades(b.id, q.id, 30).then(function (rows) {
      MarketBook.renderTrades(doc, state.recentBody || state.tradesBody, { rows: rows, quoteSymbol: q.symbol });
      MarketDesk._panels.paintDeepButton(doc, state, b, q);
      MarketDesk._panels.renderMyTrades(doc, state);
      MarketInd.maybeDraw(state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    }).catch(function (e) {
      var rb = state.recentBody || state.tradesBody;
      DOM.clear(rb);
      showError(doc, rb, e, t("market.fail_trades", "Could not load recent trades."));
      /* Deep path stays offered: it reads the database api (time-windowed),
       * independent of the history plugin the fills above needed. */
      MarketDesk._panels.paintDeepButton(doc, state, b, q);
      MarketDesk._panels.renderMyTrades(doc, state);
      MarketOrders.render(state.doc, state.ordersBody, { assets: state.assets });
      done();
    });
    }

    /* Timeframe radios (once per desk): preferred shortlist first, then any
     * live extras the node offers (60s, weekly — reconcileBuckets, never a
     * silent drop); reconcile the default 3600 when the node lacks it. */
    if (!state.tfInit) {
      state.tfInit = true;
      Market.timeframes().then(function (live) {
        var avail = (typeof MarketInd.reconcileBuckets === "function")
          ? MarketInd.reconcileBuckets(live)
          : MarketInd.PREF_BUCKETS.filter(function (x) { return live.indexOf(x) !== -1; });
        if (avail.length === 0) avail = (live || []).slice();
        if (avail.indexOf(state.bucket) === -1 && avail.length > 0) {
          state.bucket = avail[0];
        }
        state.liveBuckets = avail;
        MarketInd.paintTimeframes(doc, state, function () { fill(state); });
        try {
          if (typeof MarketInd.paintCountInput === "function") {
            MarketInd.paintCountInput(doc, state, function () { fill(state); });
          }
        } catch (e) { /* radios + note stand without the input */ }
      }).catch(function () {
        DOM.clear(state.tfBox);
        state.tfBox.appendChild(DOM.el(doc, "span", t("market.fail_timeframes", "Timeframes unavailable on this node."), "muted"));
        MarketInd.paintCountNote(state);
      });
    }

    MarketInd.paintCountNote(state);

    /* Discrete mode: raw per-fill points, no buckets, no deepen, no
     * VWAP/depth/pool-map (those paint from candles()/book and stand down
     * on empty bucket sets by themselves). Transport cap 1000 (ES page
     * budget + chain limit arg); the count note shows the ACTUAL point
     * count via state.points, never the requested count. */
    if (state.discrete) {
      var dCount = 2000;
      try {
        if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) dCount = MarketInd.CANDLE_COUNT;
      } catch (e) { /* default stands */ }
      var dLim = Math.min(Math.max(1, dCount | 0), 1000);
      try {
        if (typeof MarketFills === "undefined" || !MarketFills ||
            typeof MarketFills.fillsForMarket !== "function" ||
            typeof MarketFills.fillsToPoints !== "function") throw new Error("history-unavailable");
        MarketFills.fillsForMarket(b.id, q.id, dLim).then(function (fres) {
          try { state.tipSeq = (state.tipSeq || 0) + 1; } catch (e) { /* seq best-effort */ }
          var dpts = [];
          try {
            dpts = MarketFills.fillsToPoints((fres && fres.fills) || [], b.id, b.precision, q.precision, q.id, dCount);
          } catch (e) { dpts = []; }
          state.points = dpts;
          state.candles = { buckets: [], closes: [] };
          try { state.deep = false; } catch (e) { /* flag best-effort */ }
          MarketInd.maybeDraw(state);
          try { if (typeof state.paintNote === "function") state.paintNote(); } catch (e) { /* note best-effort */ }
        }).catch(function () {
          state.points = [];
          state.candles = { buckets: [], closes: [] };
          try { state.deep = false; } catch (e) { /* flag best-effort */ }
          MarketInd.maybeDraw(state);
          try { if (typeof state.paintNote === "function") state.paintNote(); } catch (e) { /* note best-effort */ }
        });
      } catch (e) {
        state.points = [];
        state.candles = { buckets: [], closes: [] };
        MarketInd.maybeDraw(state);
      }
      return;
    }

    /* The candleKey proves the set below belongs to THESE params, so the
     * count note can state actual delivery ("1610 of 2000") instead of
     * echoing the request. Captured at call: a mid-flight count edit
     * mismatches on arrival and the note falls back to the request. */
    var reqCount = 2000;
    try { if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) reqCount = MarketInd.CANDLE_COUNT; } catch (e) { /* default stands */ }
    Market.candles(b.id, q.id, state.bucket, reqCount).then(function (c) {
      /* Newest paint wins: invalidate older in-flight tips before painting. */
      try { state.tipSeq = (state.tipSeq || 0) + 1; } catch (e) { /* seq best-effort */ }
      state.candles = c;
      try { state.candleKey = state.bucket + "|" + reqCount; } catch (e) { /* note falls back to requested */ }
      try { state.deep = !!(c && c.deep); } catch (e) { state.deep = false; }
      MarketInd.maybeDraw(state);
      /* Re-paint the deep/live suffix fill() itself reset above: the note
       * stays honest across 15s refreshes even with no live-push traffic. */
      try { if (typeof state.paintNote === "function") state.paintNote(); } catch (e) { /* note best-effort */ }
      MarketDesk._panels.deepenOnce(state, b, q);
    }).catch(function () {
      state.candles = { buckets: [], closes: [] };
      try { state.candleKey = state.bucket + "|" + reqCount; } catch (e) { /* note falls back to requested */ }
      try { state.deep = false; } catch (e) { /* flag best-effort */ }
      MarketInd.maybeDraw(state);
      try { if (typeof state.paintNote === "function") state.paintNote(); } catch (e) { /* note best-effort */ }
    });
  }

  /* Desk alive guard (stale-route: dead desk never paints). Params: state.
   * Returns boolean. Never throws. */
  function deskAlive(state) {
    try {
      return String((typeof location !== "undefined" && location.hash) || "")
        .toUpperCase().indexOf(state.id) !== -1;
    } catch (e) { return true; }
  }

  /* Fetch 2-layer pool graph for quote/base ids (lazy async, <=9 RPCs).
   * Loading note -> render. Failures -> honest partial/empty note.
   * 24h-activity gating (desk-map connects semantics): after the chain-first
   * paint, a best-effort ONE-call ES probe (PoolHistory.poolsActive24h,
   * mainnet only — the community index is mainnet-only and pool ids collide
   * across chains) keeps only pools that swapped in the past 24h. Probe
   * success -> strict connects definition; probe failure/partial/off-mainnet
   * -> funded chain pools stand with the fallback definition (the note says
   * so). The map is a safety feature, not mission-critical navigation: it
   * degrades to funded-pools + fallback wording, never to invented data. */
  function fetchPoolMap(doc, state) {
    if (!state.graphWrap || !state.graphCanvas || !state.graphNote) return;
    ensurePhysSwitch(doc, state);
    if (!state.assets) return;
    var q = state.assets.quote, b = state.assets.base, myId = state.id;
    state.graphActivity = null;
    try { state.graphNote.textContent = t("market.loading_pool_map", "Loading map…"); } catch (e) {}
    /* BACKEND SWITCH (clean split, owner 2026-10-07): a market desk draws
     * MARKETS. Ask the community index first for the 24h fill web (2 hops
     * around BOTH desk legs, no display caps); when it cannot answer (pref
     * off, testnet, unreachable, partial page) fall back to the pool graph
     * this desk has always shown. Same canvas, same Physics switch, same
     * pmap flag — `kind` tells the painter and the note which world is on
     * screen, so a fallback map never wears a market definition. */
    var MH = (typeof MarketHops !== "undefined" && MarketHops) ? MarketHops : null;
    poolsPath();
    function marketPath() {
      if (!MH || typeof MH.fetchActivePairs !== "function") return Promise.resolve(false);
      var pA = q.id, pB = b.id;
      return MH.fetchActivePairs({ days: 1 }).then(function (res) {
        /* partial => the window holds more than we read. A truncated web
         * presented as complete would be the silent lie this project never
         * ships, so a partial page takes the honest pool fallback. */
        if (!res || res.partial || !(res.pairs || []).length) return false;
        var hops = MH.hopsFrom(res.pairs, [pA, pB], 2);
        if (!(hops.edges || []).length) return false;
        var ids = hops.nodes.map(function (n) { return n.assetId; });
        return MH.lookupSyms(ids).then(function (symMap) {
          if (!deskAlive(state) || state.id !== myId) return false;
          var built = MH.toGraph(hops, { syms: symMap, quoteAsset: pA, baseAsset: pB });
          if (!(built.graph.edges || []).length) return false;
          /* Price provenance (spec G3): this desk's own ticker already told
           * us last + 24h volume, so the desk's OWN line carries them and a
           * hover states them; neighbours carry the fill count alone. */
          fillDeskProvenance(state, built);
          /* Explicit route to BTS through the most-filled markets
           * (routeToCore) — the market counterpart of the pool map's own-line
           * glow. Null (unreachable) is a normal outcome, not a warning. */
          state.graphData = {
            graph: built.graph, meta: built.meta, kind: "market",
            assetA: pA, assetB: pB,
            routeA: MH.routeToCore(hops.edges, [pA], MH.CORE_ID),
            routeB: MH.routeToCore(hops.edges, [pB], MH.CORE_ID)
          };
          return true;
        });
      }).catch(function () { return false; });
    }
    function poolsPath() {
      if (MH && typeof MH.fetchActivePairs === "function") {
        /* Markets first; the pool graph only when markets cannot answer.
         * The PAINTER loads first either way: PoolGraph is lazy (dynamic
         * <script>, not an index.html tag), and the market path paints
         * through it too — without this the canvas stays blank and the
         * note stays "Loading map…" with no error anywhere. */
        ensurePoolGraph(function (okPainter) {
          if (state.id !== myId || !deskAlive(state)) return;
          if (!okPainter) {
            try { state.graphNote.textContent = t("market.pool_map_unavailable_script", "Pool map unavailable (script load failed)."); } catch (e) {}
            return;
          }
          marketPath().then(function (ok) {
            if (state.id !== myId || !deskAlive(state)) return;
            if (ok) {
              state.graphActivity = { gated: false, count: 0, total: 0 };
              redrawPoolMap(doc, state);
              try { MarketInd.drawCharts(state); } catch (e) { /* pin best-effort */ }
              return;
            }
            loadPoolGraph();
          });
        });
        return;
      }
      loadPoolGraph();
    }
    function loadPoolGraph() {
    ensurePoolGraph(function (ok) {
      if (!deskAlive(state) || state.id !== myId) return;
      if (!ok) {
        try { state.graphNote.textContent = t("market.pool_map_unavailable_script", "Pool map unavailable (script load failed)."); } catch (e) {}
        return;
      }
      var pA, pB;
      try {
        if (typeof PoolGraph === "undefined" || !PoolGraph) throw new Error("missing");
        pA = q.id; pB = b.id;
      } catch (e) { return; }
      try {
        PoolGraph.buildGraph(pA, pB, { depth: 2, cap: 25 }).then(function (g) {
          if (!deskAlive(state) || state.id !== myId) return;
          var pa = null, pb = null;
          try { pa = PoolGraph.findCorePath(g, pA); } catch (e) { pa = null; }
          try { pb = PoolGraph.findCorePath(g, pB); } catch (e) { pb = null; }
          /* kind "pool" marks the fallback world: the pool trust verdict and
           * the pool connects definition come back with it. */
          state.graphData = { graph: g, meta: null, kind: "pool", assetA: pA, assetB: pB, pathA: pa, pathB: pb };
          redrawPoolMap(doc, state);
          try { MarketInd.drawCharts(state); } catch (e) { /* pin best-effort */ }
          gateByActivity(doc, state, myId);
        }).catch(function (e) {
          if (!deskAlive(state) || state.id !== myId) return;
          var m = String((e && e.message) || e || "");
          try {
            if (m.indexOf("not-connected") !== -1) state.graphNote.textContent = t("market.pool_map_unavailable_offline", "Pool map unavailable (offline).");
            else state.graphNote.textContent = t("pool.touch_hint", "No pools touch these assets — pick a pair with a pool, or create one at #/pools.");
          } catch (x) {}
        });
      } catch (e) { /* graph best-effort */ }
    });
    }
  }

  /* fillDeskProvenance: attach the desk's own chain ticker facts (last price
   * + 24h volume raws + BOTH precisions) to whichever built edge joins the two
   * desk legs. Chain owns price; ES supplied only the fill count, so this is
   * the whole "price provenance" story on the desk's own line. Best-effort: a
   * missing ticker leaves the fill count alone. Never throws.
   * @param {Object} state desk state (assets + ticker).
   * @param {Object} built MarketHops.toGraph output (meta mutated in place).
   * @returns {boolean} true when a desk edge was enriched. */
  function fillDeskProvenance(state, built) {
    try {
      var tk = state.ticker;
      var qa = state.assets && state.assets.quote, ba = state.assets && state.assets.base;
      if (!tk || !qa || !ba || !built || !built.meta) return false;
      var raw = tk.raw || {};
      var latest = (tk.latest !== undefined && tk.latest !== null) ? String(tk.latest) : null;
      if (!latest) return false;
      var hits = 0;
      (built.graph.edges || []).forEach(function (e) {
        if (!e || !built.meta[e.id]) return;
        if ((e.a === qa.id && e.b === ba.id) || (e.a === ba.id && e.b === qa.id)) {
          built.meta[e.id].latest = latest;
          if (raw.base_volume !== undefined && raw.base_volume !== null) built.meta[e.id].volBaseRaw = String(raw.base_volume);
          if (raw.quote_volume !== undefined && raw.quote_volume !== null) built.meta[e.id].volQuoteRaw = String(raw.quote_volume);
          if (typeof ba.precision === "number") built.meta[e.id].volBasePrec = ba.precision;
          if (typeof qa.precision === "number") built.meta[e.id].volQuotePrec = qa.precision;
          hits++;
        }
      });
      return hits > 0;
    } catch (e) { return false; }
  }

  /* Mainnet read (deepenPool precedent: community ES is mainnet-only).
   * @returns {boolean} true on mainnet. Never throws. */
  function isMainnet() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var st = Store.loadSettings();
        if (st && (st.network === "testnet" || st.network === "mainnet")) return st.network === "mainnet";
      }
    } catch (e) { /* mainnet default below */ }
    return true;
  }

  /* Prune a desk graph to 24h-active pools (pure shape, no chain calls).
   * Nodes shrink to edge endpoints + the desk legs; BTS paths recompute on
   * the pruned graph (a route through a dropped pool must not glow).
   * Params: gd (graphData with graph/assetA/assetB), active ({poolId:true}).
   * @returns {{graph: {nodes: Array, edges: Array}, pathA: Object|null,
   *   pathB: Object|null, kept: number}} Never throws (bad input -> empty). */
  function gateEdges(gd, active) {
    var kept = 0;
    try {
      var g = (gd && gd.graph) || { nodes: [], edges: [] };
      var aA = gd.assetA, aB = gd.assetB;
      var edges = ((g.edges) || []).filter(function (e) {
        return e && e.poolId && active[String(e.poolId)];
      });
      kept = edges.length;
      var keepN = {};
      try { keepN[String(aA)] = 1; keepN[String(aB)] = 1; } catch (e) { /* legs stand */ }
      edges.forEach(function (e) {
        try { keepN[String(e.a)] = 1; keepN[String(e.b)] = 1; } catch (x) { /* edge stands */ }
      });
      var nodes = ((g.nodes) || []).filter(function (n) {
        return n && keepN[String(n.assetId)];
      });
      var pruned = { nodes: nodes, edges: edges };
      var pa = null, pb = null;
      try {
        if (typeof PoolGraph !== "undefined" && PoolGraph && typeof PoolGraph.findCorePath === "function") {
          pa = PoolGraph.findCorePath(pruned, aA);
          pb = PoolGraph.findCorePath(pruned, aB);
        }
      } catch (e) { pa = null; pb = null; }
      return { graph: pruned, pathA: pa, pathB: pb, kept: kept };
    } catch (e) { return { graph: { nodes: [], edges: [] }, pathA: null, pathB: null, kept: 0 }; }
  }

  /* 24h-activity gating pass (runs once per desk after the chain-first
   * paint above — the desk never waits on it). Probe success with a
   * conclusive (non-partial) answer prunes to active pools and records the
   * strict-definition activity; anything else (ES down/disabled, partial
   * window, off-mainnet) records the fallback activity and the funded chain
   * pools stand. Stale-route guarded; never throws outward. */
  function gateByActivity(doc, state, myId) {
    try {
      if (!state.graphData || !state.graphData.graph) return;
      var total = ((state.graphData.graph.edges) || []).length;
      if (!total) return;
      if (typeof PoolHistory === "undefined" || !PoolHistory ||
          typeof PoolHistory.poolsActive24h !== "function" || !isMainnet()) {
        state.graphActivity = { gated: false, count: total, total: total };
        try { redrawPoolMap(doc, state); } catch (e) { /* chain paint stands */ }
        return;
      }
      var ids = [];
      try {
        state.graphData.graph.edges.forEach(function (e) {
          if (e && e.poolId) ids.push(String(e.poolId));
        });
      } catch (e) { ids = []; }
      PoolHistory.poolsActive24h(ids).then(function (res) {
        if (!deskAlive(state) || state.id !== myId) return;
        if (!res || res.partial) {
          state.graphActivity = { gated: false, count: total, total: total };
        } else {
          var out = gateEdges(state.graphData, res.active || {});
          state.graphData = { graph: out.graph, assetA: state.graphData.assetA,
            assetB: state.graphData.assetB, pathA: out.pathA, pathB: out.pathB };
          state.graphActivity = { gated: true, count: out.kept, total: total };
        }
        try { redrawPoolMap(doc, state); } catch (e) { /* chain paint stands */ }
        try { MarketInd.drawCharts(state); } catch (e) { /* pin best-effort */ }
      }).catch(function () {
        if (!deskAlive(state) || state.id !== myId) return;
        state.graphActivity = { gated: false, count: total, total: total };
        try { redrawPoolMap(doc, state); } catch (e) { /* chain paint stands */ }
      });
    } catch (e) { /* chain paint stands */ }
  }

  /* Repaint the pool-map canvas from cached graphData (theme/resize path).
   * Skips when toggled off or stale. Never throws outward. */
  /* Feed + settlement estimate for the strip (R1d — read path mirrors
   * asset-feed-ui.js loadFeed: lookup_asset_symbols -> bitasset_data_id ->
   * get_objects -> current_feed.settlement_price, formatted with BOTH
   * precisions via Format.formatPrice). Runs ONCE per desk (not per stats
   * refresh): exactly 2 RPCs, stale-route guarded. Orientation is market
   * base-per-quote: the settlement amounts map by asset_id onto the market
   * legs (precisions already known from state.assets); legs that don't match
   * the pair skip the feed (backing differs from the market quote) instead
   * of guessing. Settlement ports #1 ExchangeHeader.jsx:190-198 (wins over
   * astro's offset-less dialog per #4 asset_ops force-settlement comment):
   * offset=bit.options.force_settlement_offset_percent; base CORE(1.3.0) ?
   * feed/(1+off/10000) : feed*(1+off/10000) via Format.settleEstimate (exact
   * BigInt, never float); globally-settled (settlement_fund>0) uses
   * bitasset.settlement_price directly, same object, zero extra calls.
   * Non-MPA pairs and every failure fail OPEN (state.feed null, no cells,
   * the ticker strip stands). Params: (doc, state) with state.assets set.
   * Never throws outward. */
  function fetchFeed(doc, state) {
    var myId = state.id;
    function alive() {
      try { return deskAlive(state) && state.id === myId; } catch (e) { return false; }
    }
    /* novalue: feed fetch failed/absent — clear state.feed and repaint
     * the strip (which shows the missing-feed hint). Never throws. */
    function novalue() {
      if (!alive()) return;
      state.feed = null;
      try { MarketInd.renderStrip(doc, state); } catch (e) { /* strip stands */ }
    }
    try {
      if (typeof Chain === "undefined" || !Chain ||
          typeof Format === "undefined" || !Format ||
          typeof MarketInd === "undefined" || !MarketInd) return;
      var q = state.assets.quote, b = state.assets.base;
      var dbId;
      /* Perf: Market.assets already resolved this pair (its rows carry
       * bitasset_data_id) — reuse the feed leg instead of re-looking-up the
       * same symbols. Falls back to the lookup when the legs lack it. */
      var directBid = (q && q.bitasset_data_id) || (b && b.bitasset_data_id) || null;
      Chain.db().then(function (id) {
        dbId = id;
        if (directBid) return Chain.call(dbId, "get_objects", [[directBid]]);
        return Chain.call(dbId, "lookup_asset_symbols", [[q.symbol, b.symbol]]);
      }).then(function (rows) {
        if (!alive()) return null;
        if (directBid) return rows;
        var bid = null;
        (rows || []).forEach(function (r) {
          if (r && r.bitasset_data_id && !bid) bid = r.bitasset_data_id;
        });
        if (!bid) { novalue(); return null; }
        return Chain.call(dbId, "get_objects", [[bid]]);
      }).then(function (objs) {
        if (!objs || !alive()) return;
        var bit = objs[0] || null;
        var cur = bit && bit.current_feed;
        var pair = cur && cur.settlement_price;
        if (!pair || !pair.base || !pair.quote) { novalue(); return; }
        var rawB = null, rawQ = null;
        [pair.base, pair.quote].forEach(function (leg) {
          if (leg.asset_id === b.id) rawB = String(leg.amount);
          else if (leg.asset_id === q.id) rawQ = String(leg.amount);
        });
        if (rawB === null || rawQ === null) { novalue(); return; }
        var feed;
        try {
          feed = Format.formatPrice(rawB, b.precision, rawQ, q.precision, 8);
          /* 4-sf display (global price rule); raw legs stay in state for
           * the strip title path below. Never throws outward. */
          try {
            if (typeof Format.priceSig === "function") {
              var fsig = Format.priceSig(feed);
              if (typeof fsig === "string" && fsig) feed = fsig;
            }
          } catch (e) { /* 8-place stands */ }
        } catch (e) { novalue(); return; }
        var out = { feed: feed, settle: null };
        try {
          var fund = bit && bit.settlement_fund;
          /* Round-3 verified: globally-settled flag is exact BigInt (the fund
           * is a raw chain integer; Number() would still zero-test correctly
           * but BigInt keeps the integer discipline of this read path). */
          var fundStr = (fund === null || fund === undefined) ? "0" : String(fund).trim();
          var isSettled = false;
          try {
            if (/^-?\d+$/.test(fundStr)) isSettled = BigInt(fundStr) > 0n;
            else isSettled = Number(fund) > 0;
          } catch (e) { isSettled = Number(fund) > 0; }
          var sp = bit && bit.settlement_price;
          if (isSettled && sp && sp.base && sp.quote) {
            var sB = null, sQ = null;
            [sp.base, sp.quote].forEach(function (leg) {
              if (leg.asset_id === b.id) sB = String(leg.amount);
              else if (leg.asset_id === q.id) sQ = String(leg.amount);
            });
            if (sB !== null && sQ !== null) {
              var settleVal = Format.formatPrice(sB, b.precision, sQ, q.precision, 8);
              try {
                if (typeof Format.priceSig === "function") {
                  var ssig = Format.priceSig(settleVal);
                  if (typeof ssig === "string" && ssig) settleVal = ssig;
                }
              } catch (e) { /* 8-place stands */ }
              out.settle = { global: true, value: settleVal };
            }
          } else {
            /* Live asset: offset-adjusted estimate (R1d). Offset lives on the
             * bitasset_data options; missing/invalid fails OPEN (feed stands,
             * no settle cell) instead of guessing. baseIsCore follows #1
             * baseId=="1.3.0" branch. */
            var offRaw = bit && bit.options && bit.options.force_settlement_offset_percent;
            var off = (Number.isInteger(offRaw) && offRaw >= 0 && offRaw <= 0xFFFF) ? offRaw : null;
            if (off === null && offRaw !== undefined && offRaw !== null) {
              var parsed = Number(offRaw);
              off = (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xFFFF) ? parsed : null;
            }
            if (off === null && (offRaw === undefined || offRaw === null)) off = 0;
            if (off !== null && typeof Format.settleEstimate === "function") {
              var baseIsCore = String(b.id) === "1.3.0";
              var estVal = Format.settleEstimate(rawB, b.precision, rawQ, q.precision, off, baseIsCore, 8);
              try {
                if (typeof Format.priceSig === "function") {
                  var esig = Format.priceSig(estVal);
                  if (typeof esig === "string" && esig) estVal = esig;
                }
              } catch (e) { /* 8-place stands */ }
              out.settle = {
                global: false,
                offset: off,
                value: estVal
              };
            }
          }
        } catch (e) { out.settle = null; }
        if (!alive()) return;
        state.feed = out;
        try { MarketInd.renderStrip(doc, state); } catch (e) { /* strip stands */ }
      }).catch(function () { novalue(); });
    } catch (e) { /* feed optional, strip stands */ }
  }

  /* Pool-map Physics switch (Task 5, physics ONLY — the sole DOM addition to
   * this pane): ONE labeled on/off control, overlaid on the canvas
   * lower-left via a stage wrapper (band parity, owner call). Reads and
   * writes the shared poolNetReact key (PoolGraph.readReact/setReact when
   * loaded, guarded localStorage otherwise — the same key the pool desk and
   * both selector bands use, default ON). It is a GESTURE-REACTION flag, not
   * a fidelity dial (2026-10-07): ON = a drag release re-energizes the map,
   * OFF = gestures never do and the map stays where you dropped it. Labels
   * reuse the pool_net.phys dict keys
   * (already translated — no new strings). A flip repaints through
   * redrawPoolMap with explicit=true (bounded run even under reduced-motion);
   * auto repaints stay frozen under reduced-motion (PoolGraph.drawLive
   * policy). Idempotent: refetches repaint the existing switch. Never throws. */
  function readPhysMode() {
    try {
      if (typeof PoolGraph !== "undefined" && PoolGraph && typeof PoolGraph.readReact === "function") {
        return PoolGraph.readReact();
      }
    } catch (e) { /* storage below */ }
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("poolNetReact") === "0") return false;
    } catch (e) { /* ON stands */ }
    return true;
  }
  function persistPhys(on) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem("poolNetReact", on ? "1" : "0"); } catch (e) { /* memory-only */ }
  }
  /* stopLiveMap: park the desk map loop on this pane's canvas so the OFF
   * promise holds after the tap (no drift on the next settle). Never throws. */
  function stopLiveMap(st) {
    try {
      var c = (st && st.graphCanvas) ? st.graphCanvas : null;
      if (c && typeof PoolGraph !== "undefined" && PoolGraph && typeof PoolGraph.stopLive === "function") PoolGraph.stopLive(c);
    } catch (e) { /* parked anyway */ }
  }
  function paintPhysSwitch(box, mode) {
    try {
      var btn = box.querySelector ? box.querySelector("[data-phys-btn]") : null;
      if (!btn) {
        var kids = box.children || [];
        for (var i = 0; i < kids.length; i++) {
          if (kids[i] && kids[i].getAttribute && kids[i].getAttribute("data-phys-btn")) btn = kids[i];
        }
      }
      var on = (mode === false) ? false : true;
      if (btn) {
        btn.setAttribute("role", "switch");
        btn.setAttribute("aria-checked", on ? "true" : "false");
        btn.setAttribute("aria-label", t("pool_net.phys", "Physics"));
      }
      /* No visible On/Off word (owner 2026-10-07): the knob's side carries it
       * visually, aria-checked carries it to assistive tech. */
    } catch (e) { /* switch stands */ }
  }
  /* minFillsNow: the live noise floor for the market map. The desk state
   * carries it once the input exists; otherwise the persisted profile value
   * (or the shipped default) answers. Anything unreadable reads as "show
   * everything". Never throws.
   * @param {Object} state desk state. @returns {number} >= 0. */
  function minFillsNow(state) {
    try {
      if (state && typeof state.minFills === "number" && isFinite(state.minFills) && state.minFills >= 0) {
        return Math.floor(state.minFills);
      }
      if (typeof MarketHops !== "undefined" && MarketHops && typeof MarketHops.readMinFills === "function") {
        return MarketHops.readMinFills();
      }
    } catch (e) { /* default below */ }
    try {
      if (typeof MarketHops !== "undefined" && MarketHops && MarketHops.DEFAULT_MIN_FILLS) {
        return MarketHops.DEFAULT_MIN_FILLS;
      }
    } catch (e2) { /* literal below */ }
    return 10;
  }

  /* ensureMinFillsInput: the "Min fills" number input as a bottom-right
   * canvas overlay pill (market worlds only — pool worlds never prune, so
   * they never offer it). Same overlay treatment as the physics pill
   * (panel/border/radius, opposite corner) so the two map controls read as
   * one family; falls back beside the note when no canvas stage exists.
   * Built once per desk (guarded on state); a valid change persists per
   * profile and repaints the map, an invalid one reverts. Never throws.
   * @param {Document} doc owner document. @param {Object} state desk state.
   * @returns {void}. */
  function ensureMinFillsInput(doc, state) {
    try {
      if (!doc || !state.graphWrap) return;
      if (state.minFillsBox && state.minFillsBox.parentNode) return;
      if (typeof doc.createElement !== "function") return;
      var MH = (typeof MarketHops !== "undefined" && MarketHops) ? MarketHops : null;
      if (!MH || typeof MH.writeMinFills !== "function") return;
      if (typeof state.minFills !== "number") {
        try { state.minFills = minFillsNow(state); } catch (e) { state.minFills = 10; }
      }
      var row = doc.createElement("div");
      row.className = "pool-net-minfilter";
      try { row.setAttribute("data-minfilter", "fills"); } catch (e) { /* class stands */ }
      var lab = doc.createElement("label");
      lab.textContent = t("market.min_fills", "Min fills") + " ";
      var inp = doc.createElement("input");
      inp.type = "number";
      inp.min = "0";
      inp.value = String(minFillsNow(state));
      try { inp.setAttribute("inputmode", "numeric"); } catch (e) { /* value stands */ }
      try { inp.setAttribute("aria-label", t("market.min_fills", "Min fills")); } catch (e) { /* label stands */ }
      touchable(inp);
      lab.appendChild(inp);
      row.appendChild(lab);
      var placed = false;
      try {
        var cv = state.graphCanvas;
        if (cv && cv.parentNode) {
          var stage = cv.parentNode;
          if (stage && stage.className && String(stage.className).indexOf("pool-net-stage") !== -1) {
            stage.appendChild(row);
            placed = true;
          }
        }
      } catch (e) { /* fallback below */ }
      if (!placed) state.graphWrap.appendChild(row);
      state.minFillsBox = row;
      inp.addEventListener("change", function () {
        var v = parseInt(inp.value, 10);
        var okW = false;
        try { okW = MH.writeMinFills(v); } catch (e) { okW = false; }
        if (!okW) {
          try { inp.value = String(minFillsNow(state)); } catch (e) { /* stands */ }
          return;
        }
        try { state.minFills = MH.readMinFills(); } catch (e) { state.minFills = v; }
        try { redrawPoolMap(doc, state); } catch (e) { /* map stands */ }
      });
    } catch (e) { /* map stands without the filter */ }
  }

  function ensurePhysSwitch(doc, state) {
    try {
      if (!doc || !state.graphWrap) return;
      if (typeof doc.createElement !== "function") return;
      var existing = null;
      try { existing = state.graphWrap.querySelector ? state.graphWrap.querySelector("[data-phys-switch]") : null; } catch (e) { existing = null; }
      if (!existing) {
        var kids = state.graphWrap.getElementsByTagName ? state.graphWrap.getElementsByTagName("*") : [];
        for (var k = 0; k < kids.length; k++) {
          try {
            if (kids[k] && kids[k].getAttribute && kids[k].getAttribute("data-phys-switch")) { existing = kids[k]; break; }
          } catch (e2) { /* next child */ }
        }
      }
      if (existing) { paintPhysSwitch(existing, readPhysMode()); return; }
      var box = DOM.el(doc, "span", null, "pool-net-phys");
      try { box.setAttribute("data-phys-switch", "1"); } catch (e) { /* paint stands */ }
      box.appendChild(DOM.el(doc, "span", t("pool_net.phys", "Physics"), "pool-net-physlabel"));
      var btn = DOM.el(doc, "button", null, "pool-net-physwitch");
      btn.type = "button";
      try { btn.setAttribute("data-phys-btn", "1"); } catch (e) { /* paint stands */ }
      /* The button is the 44x44 HIT AREA; the visible pill is the track
       * inside it, so the control reads small without shrinking the touch
       * target below the platform floor (principle #7). */
      var track = DOM.el(doc, "span", null, "pool-net-phystrack");
      track.appendChild(DOM.el(doc, "span", null, "pool-net-physknob"));
      btn.appendChild(track);
      try { if (typeof touchable === "function") touchable(btn); } catch (e) { /* click still works */ }
      box.appendChild(btn);
      paintPhysSwitch(box, readPhysMode());
      btn.addEventListener("click", function () {
        /* Flip ON = consent to motion (repaint explicit=true, bounded run
         * even under reduced-motion). Flip OFF only stops: no repaint, no
         * re-energize, so the map does not drift after the tap. */
        var next = !readPhysMode();
        try {
          if (typeof PoolGraph !== "undefined" && PoolGraph && typeof PoolGraph.setReact === "function") {
            PoolGraph.setReact(next);
          } else persistPhys(next);
        } catch (e) { persistPhys(next); }
        paintPhysSwitch(box, next);
        if (!next) { try { stopLiveMap(state); } catch (eStop) { /* parked anyway */ } return; }
        try { redrawPoolMap(doc, state, true); } catch (e) { /* map stands */ }
      });
      /* On-canvas overlay (owner call, band parity): the switch floats over
       * the map lower-left inside a relative stage wrapper, not in the pane
       * header. Falls back to the header when the canvas is absent. */
      var placed = false;
      try {
        var cv = state.graphCanvas;
        if (cv && cv.parentNode) {
          var stage = cv.parentNode;
          var staged = false;
          try {
            staged = stage && stage.className && String(stage.className).indexOf("pool-net-stage") !== -1;
          } catch (e2) { staged = false; }
          if (!staged) {
            stage = doc.createElement("div");
            stage.className = "pool-net-stage";
            cv.parentNode.insertBefore(stage, cv);
            stage.appendChild(cv);
          }
          stage.appendChild(box);
          placed = true;
        }
      } catch (e) { /* header fallback below */ }
      if (!placed) state.graphWrap.appendChild(box);
    } catch (e) { /* desk stands without the switch */ }
  }

  function redrawPoolMap(doc, state, explicit) {
    if (!state.graphData || !state.graphCanvas) return;
    if (state.showPoolMap === false) return;
    if (!deskAlive(state)) return;
    try {
      if (typeof PoolGraph === "undefined" || !PoolGraph) return;
      var gd = state.graphData, hi = [], seen = {};
      /* kind: which world is on screen (clean split). "market" = the 24h fill
       * web, painted with the fills ramp + the BTS route and NO pool trust
       * verdict; anything else = the pool provenance map, byte-identical to
       * before this work. */
      var isMarket = (gd.kind === "market");
      if (isMarket) {
        /* The route to BTS through the most-filled markets: both desk legs'
         * routes unioned, mapped onto rendered edge ids (deskIdsFor). This is
         * the ONLY glowing set, exactly as the pool map glows its own line +
         * BTS route. An unreachable BTS highlights nothing (honest, calm). */
        var MHr = (typeof MarketHops !== "undefined" && MarketHops) ? MarketHops : null;
        if (MHr && typeof MHr.deskIdsFor === "function") {
          [gd.routeA, gd.routeB].forEach(function (rt) {
            MHr.deskIdsFor(rt, gd.graph.edges || []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; hi.push(id); } });
          });
        }
      }
      /* Pool worlds take their glow from findCorePath's `via` pool ids; a
       * market world already filled `hi` from the fills-weighted route above
       * (its pathA/pathB are ASSET paths, not pool ids). */
      if (!isMarket) {
        [(gd.pathA && gd.pathA.via) || [], (gd.pathB && gd.pathB.via) || []].forEach(function (list) {
          (list || []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; hi.push(id); } });
        });
      }
      /* Physics branch (2026-10-07 gesture-reaction model): ONE physics, so
       * every map render animates through PoolGraph.drawLive (same painter via
       * the _pos seam — look/verdicts/hit-test unchanged) and the settle runs
       * whether or not gestures react; the OFF flag is enforced inside
       * PoolGraph.wake, which refuses EXPLICIT (gesture) wakes. The old
       * "calm keeps the settle-once drawGraph path" split is gone — it was
       * why Off froze the desks but not the selector bands.
       * explicit=true only from flipping the switch ON (bounded run under
       * reduced-motion); auto repaints stay frozen there. */
      var liveOn = false;
      try {
        liveOn = typeof PoolGraph.drawLive === "function";
      } catch (e) { liveOn = false; }
      /* Edge navigation target: this desk trades ORDERS, so a line opens the
       * order book for the two assets it joins (QUOTE_BASE, desk legs first).
       * The swap desk opens the pool instead — same line, right destination
       * per desk (owner 2026-10-07). */
      var navMode = { mode: "market", quoteAsset: gd.assetA, baseAsset: gd.assetB };
      /* kind + meta + routeDeskIds travel with every frame: drawLive replays
       * them through the same painter, so the live loop cannot drift back to
       * pool semantics mid-settle. */
      /* Min-fills declutter (owner 2026-10-08): the market web is complete
       * in state.graphData, but the pane paints the pruned subset — thin
       * pairs hide while the BTS route and the desk legs always paint. The
       * note below states the shown/total split, so nothing hides silently.
       * Pool worlds never prune (their 25-node cap already bounds them). */
      var MHp = (typeof MarketHops !== "undefined" && MarketHops) ? MarketHops : null;
      var minF = minFillsNow(state);
      var shownGraph = gd.graph, shownTotal = (gd.graph.edges || []).length;
      if (isMarket && MHp && typeof MHp.pruneGraph === "function") {
        try {
          shownGraph = MHp.pruneGraph(gd.graph, minF, hi, [gd.assetA, gd.assetB]);
        } catch (eP) { shownGraph = gd.graph; }
        ensureMinFillsInput(doc, state);
      }
      var shownN = (shownGraph.edges || []).length;
      /* Per-leg standing for the corner verdicts (green/red/blue): present
       * only when the view actually computed routes — a verdict without
       * data would be a guess, and the painter must never guess. */
      var marketLegs = null;
      if (isMarket && gd && ("routeA" in gd) && ("routeB" in gd)) {
        try {
          marketLegs = { aOk: !!(gd.routeA && gd.routeA.assetPath), bOk: !!(gd.routeB && gd.routeB.assetPath) };
        } catch (eL) { marketLegs = null; }
      }
      var paintOpts = { assetA: gd.assetA, assetB: gd.assetB, highlightPools: hi, explicit: !!explicit,
        nav: navMode, kind: isMarket ? "market" : "pool",
        meta: (isMarket ? (gd.meta || null) : null), routeDeskIds: hi, marketLegs: marketLegs };
      if (liveOn) {
        PoolGraph.drawLive(doc, state.graphCanvas, shownGraph, paintOpts);
      } else {
        try {
          if (typeof PoolGraph.stopLive === "function") PoolGraph.stopLive(state.graphCanvas);
        } catch (e) { /* static paint stands */ }
        PoolGraph.drawGraph(doc, state.graphCanvas, shownGraph, paintOpts);
      }
      /* Below-map note (owner wording): the connects definition, never a
       * title. Strict when the 24h probe gated this render (with the honest
       * active/total count, tapeCount number-style — no new words); fallback
       * wording while the probe is pending or when ES could not answer (the
       * funded chain pools stand, and the note says activity is unconfirmed).
       * Truly pool-less pairs keep the honest empty sentence. */
      var act = state.graphActivity || null;
      var n = (gd.graph.edges || []).length;
      /* MARKETS: the definition states 24h FILLS (what the line now means),
       * plus the pair count and, when the web cannot reach BTS at all, a
       * calm "no route" note. Never a warning — an unreachable BTS through
       * markets is ordinary, not a scam signal. */
      if (isMarket) {
        /* The connects definition names the filter (owner 2026-10-08): a
         * filtered map says so — "Showing 54 of 85 pairs (min 5 fills/24h)"
         * — while an unfiltered map keeps the plain pair count. */
        var noteTxt;
        if (shownN < shownTotal) {
          noteTxt = t("market.map_hops_filtered",
            "A line is a market that filled in the past 24 hours. Showing %(shown)s of %(total)s pairs (min %(min)s fills/24h).",
            { shown: String(shownN), total: String(shownTotal), min: String(minF) });
        } else {
          noteTxt = t("market.map_hops_note", "A line is a market that filled in the past 24 hours. %(pairs)s pairs shown.", { pairs: String(shownTotal) });
        }
        var hasRoute = false;
        try {
          hasRoute = hi.length > 0;
        } catch (eR) { hasRoute = false; }
        if (!hasRoute) {
          noteTxt += " " + t("market.map_hops_no_route", "No route to BTS through filled markets.");
        }
        state.graphNote.textContent = noteTxt;
        return;
      }
      /* POOLS (the fallback world): the four honest pool sentences, verbatim
       * from before this work — a fallback map must never claim markets. */
      if (!n && !(act && act.gated && act.total > 0)) {
        state.graphNote.textContent = t("pool.touch_hint", "No pools touch these assets — pick a pair with a pool, or create one at #/pools.");
      } else if (act && act.gated) {
        state.graphNote.textContent = t("market.map_connects", "A line connects two assets when there has been a market trade in the past 24 hours.") +
          " " + String(act.count) + "/" + String(act.total);
      } else if (!act) {
        state.graphNote.textContent = t("market.loading_pool_map", "Loading map…");
      } else {
        state.graphNote.textContent = t("market.map_connects_fallback", "A line connects two assets when a funded pool exists. 24h trade activity is unconfirmed (history unavailable) — showing funded pools.") +
          " N=" + String(act.total);
      }
    } catch (e) { /* canvas best-effort */ }
  }

  function ensurePoolGraph(cb) {
    try {
      if (typeof PoolGraph !== "undefined" && PoolGraph) { cb(true); return; }
    } catch (e) { /* load below */ }
    if (typeof document === "undefined") { try { cb(false); } catch (e) {} return; }
    _graphWaiters.push(cb);
    if (_graphLoading) return;
    _graphLoading = true;
    try {
      var s = document.createElement("script");
      s.src = graphSrc(); s.async = true;
      s.onload = function () {
        _graphLoading = false;
        var w = _graphWaiters; _graphWaiters = [];
        w.forEach(function (f) { try { f(true); } catch (e) {} });
      };
      s.onerror = function () {
        _graphLoading = false;
        var w = _graphWaiters; _graphWaiters = [];
        w.forEach(function (f) { try { f(false); } catch (e) {} });
      };
      (document.head || document.getElementsByTagName("head")[0] || document.documentElement).appendChild(s);
    } catch (e) {
      _graphLoading = false;
      var w = _graphWaiters; _graphWaiters = [];
      w.forEach(function (f) { try { f(false); } catch (e2) {} });
    }
  }

  function graphSrc() {
    try {
      if (typeof document !== "undefined" && document.baseURI) {
        return new URL("js/api/pool-graph.js", document.baseURI).toString();
      }
    } catch (e) { /* relative fallback below */ }
    return "js/api/pool-graph.js";
  }

  /* Pool-map lazy loader (index.html frozen — dynamic script like router.js
   * dashboard precedent; relative URL only, never CDN). CANONICAL for both
   * desks: pool-detail-view.js _ensurePoolGraph delegates here, so one queue
   * serves concurrent requests (exactly one <script> inject). Params: cb(bool).
   * Returns nothing. Never throws. */
  var _graphLoading = false, _graphWaiters = [];
  MarketDesk._fill.fill = fill;
  MarketDesk._fill.deskAlive = deskAlive;
  MarketDesk._fill.fetchPoolMap = fetchPoolMap;
  MarketDesk._fill.fetchFeed = fetchFeed;
  MarketDesk._fill.redrawPoolMap = redrawPoolMap;
  MarketDesk._fill.ensurePoolGraph = ensurePoolGraph;
  if (typeof globalThis !== "undefined") { globalThis.MarketDesk = MarketDesk; }
})();

if (typeof module !== "undefined") { module.exports = MarketDesk; }
