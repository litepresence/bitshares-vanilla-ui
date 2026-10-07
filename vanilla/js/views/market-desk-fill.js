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
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
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

    Market.candles(b.id, q.id, state.bucket, MarketInd.CANDLE_COUNT).then(function (c) {
      /* Newest paint wins: invalidate older in-flight tips before painting. */
      try { state.tipSeq = (state.tipSeq || 0) + 1; } catch (e) { /* seq best-effort */ }
      state.candles = c;
      try { state.deep = !!(c && c.deep); } catch (e) { state.deep = false; }
      MarketInd.maybeDraw(state);
      /* Re-paint the deep/live suffix fill() itself reset above: the note
       * stays honest across 15s refreshes even with no live-push traffic. */
      try { if (typeof state.paintNote === "function") state.paintNote(); } catch (e) { /* note best-effort */ }
      MarketDesk._panels.deepenOnce(state, b, q);
    }).catch(function () {
      state.candles = { buckets: [], closes: [] };
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
   * Loading note -> render. Failures -> honest partial/empty note. */
  function fetchPoolMap(doc, state) {
    if (!state.graphWrap || !state.graphCanvas || !state.graphNote) return;
    ensurePhysSwitch(doc, state);
    if (!state.assets) return;
    var q = state.assets.quote, b = state.assets.base, myId = state.id;
    try { state.graphNote.textContent = t("market.loading_pool_map", "Loading pool map…"); } catch (e) {}
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
          state.graphData = { graph: g, assetA: pA, assetB: pB, pathA: pa, pathB: pb };
          redrawPoolMap(doc, state);
          try { MarketInd.drawCharts(state); } catch (e) { /* pin best-effort */ }
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
   * this pane): ONE labeled on/off control in the map pane header. Reads and
   * writes the shared poolNetPhys key (PoolGraph.readPhys/setPhys when loaded,
   * guarded localStorage otherwise — same key the pool desk and the pools
   * band use, default calm/off). Labels reuse the pool_net.phys dict keys
   * (already translated — no new strings). A flip repaints through
   * redrawPoolMap with explicit=true (bounded run even under reduced-motion);
   * auto repaints stay frozen under reduced-motion (PoolGraph.drawLive
   * policy). Idempotent: refetches repaint the existing switch. Never throws. */
  function readPhysMode() {
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
  function persistPhys(m) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem("poolNetPhys", m); } catch (e) { /* memory-only */ }
  }
  function paintPhysSwitch(box, mode) {
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
  function ensurePhysSwitch(doc, state) {
    try {
      if (!doc || !state.graphWrap) return;
      var head = state.graphWrap.firstChild;
      if (!head || typeof doc.createElement !== "function") return;
      var existing = null;
      try { existing = head.querySelector ? head.querySelector("[data-phys-switch]") : null; } catch (e) { existing = null; }
      if (!existing) {
        var kids = head.children || [];
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
      btn.appendChild(DOM.el(doc, "span", null, "pool-net-physknob"));
      try { if (typeof touchable === "function") touchable(btn); } catch (e) { /* click still works */ }
      var st = DOM.el(doc, "span", t("pool_net.phys_off", "Off"), "pool-net-physstate");
      try { st.setAttribute("data-phys-state", "1"); } catch (e) { /* paint stands */ }
      box.appendChild(btn);
      box.appendChild(st);
      paintPhysSwitch(box, readPhysMode());
      btn.addEventListener("click", function () {
        var next = (readPhysMode() === "lively") ? "calm" : "lively";
        try {
          if (typeof PoolGraph !== "undefined" && PoolGraph && typeof PoolGraph.setPhys === "function") {
            PoolGraph.setPhys(next);
          } else persistPhys(next);
        } catch (e) { persistPhys(next); }
        paintPhysSwitch(box, next);
        try { redrawPoolMap(doc, state, true); } catch (e) { /* map stands */ }
      });
      head.appendChild(box);
    } catch (e) { /* desk stands without the switch */ }
  }

  function redrawPoolMap(doc, state, explicit) {
    if (!state.graphData || !state.graphCanvas) return;
    if (state.showPoolMap === false) return;
    if (!deskAlive(state)) return;
    try {
      if (typeof PoolGraph === "undefined" || !PoolGraph) return;
      var gd = state.graphData, hi = [], seen = {};
      [(gd.pathA && gd.pathA.via) || [], (gd.pathB && gd.pathB.via) || []].forEach(function (list) {
        (list || []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; hi.push(id); } });
      });
      /* Task 5 physics branch: lively animates through PoolGraph.drawLive
       * (same painter via the _pos seam — look/verdicts/hit-test unchanged);
       * calm (default) keeps the settle-once drawGraph path byte-identical.
       * explicit=true only from the Physics flip (bounded run under
       * reduced-motion); auto repaints stay frozen there. */
      var liveOn = false;
      try {
        liveOn = readPhysMode() === "lively" &&
          typeof PoolGraph.drawLive === "function";
      } catch (e) { liveOn = false; }
      if (liveOn) {
        PoolGraph.drawLive(doc, state.graphCanvas, gd.graph,
          { assetA: gd.assetA, assetB: gd.assetB, highlightPools: hi, explicit: !!explicit });
      } else {
        try {
          if (typeof PoolGraph.stopLive === "function") PoolGraph.stopLive(state.graphCanvas);
        } catch (e) { /* static paint stands */ }
        PoolGraph.drawGraph(doc, state.graphCanvas, gd.graph,
          { assetA: gd.assetA, assetB: gd.assetB, highlightPools: hi });
      }
      var n = (gd.graph.edges || []).length;
      if (!n) state.graphNote.textContent = t("pool.touch_hint", "No pools touch these assets — pick a pair with a pool, or create one at #/pools.");
      else if (!gd.pathA && !gd.pathB) state.graphNote.textContent = t("market.no_bts_path", "No BTS path — treat pair as unverified.");
      else {
        var bits = [];
        if (gd.pathA) bits.push("pool→BTS " + gd.pathA.hops.length + " hops");
        if (gd.pathB) bits.push("pool→BTS " + gd.pathB.hops.length + " hops");
        state.graphNote.textContent = t("market.bts_provenance_prefix", "BTS provenance: ") + bits.join(" · ") + ".";
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
