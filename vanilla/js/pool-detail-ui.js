/* pool-detail-ui.js — #/pools/:id detail desk (stats + chart + actions + depth + history).
 * Owns: detail desk mirroring the market-ui.js skeleton (stats strip, LWC chart
 *   pane from bucketed chain history, action panels below the chart, x·y=k
 *   curve canvas + CPMM depth table (dex-ux plot proposal 5, chain data)
 *   + pool-history tabs), stake (op-61) / unstake (op-62) / inline swap (op-63)
 *   / update (op-75, withdrawal 0-only) / delete (op-60, fee 0) panels with
 *   NAMED-row confirms. DOM scaffolding comes from PoolUI._ui (pool-ui.js loads
 *   first); reads/builders stay in pool.js. WIFs are JS values, never DOM.
 *   Unknown id -> empty state, never blank. No ops-57/58 code (slice 14 owns them).
 * Consumes: PoolUI._ui (routeReady/reviewSection/tableHead/amtText/pctText),
 *   Pool (get/list/history/quote/minReceive/buildDeposit/buildWithdraw/
 *   buildExchange/buildUpdate/buildDelete), Format (parseAmount only), Account,
 *   Wallet (via _ui gates). Side effects: DOM under the router root; global
 *   PoolDetailUI only. Own gen + PoolUI-live check drop stale async work.
 * Created by: building-vanilla-slices skill, slice-12-pools plan Task 3
 *   (split from pool-ui.js so every file stays <=400 lines).
 * MIRROR SPEC (Reference #27): same skeleton as the orderbook desk — picker
 *   (list page) + stats strip + chart pane + action panels + depth/history tabs;
 *   book -> CPMM curve, trades -> pool-history rows, buy/sell -> swap form.
 */
var PoolDetailUI = (function () {
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
  /* Shared-_ui accessor: PoolUI._ui (pool-ui.js loads first); throws when the backend is missing. */
  function U() {
    if (typeof PoolUI === "undefined" || !PoolUI._ui) throw new Error(t("pool.backend_missing", "Pool backend missing: pool-ui.js failed to load."));
    return PoolUI._ui;
  }
  function live(myGen, uiGen) { /* both counters live (debit-ui two-counter precedent) */
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  function whoText(me) { return me.name + " (" + me.id + ")"; }
  function precOr5(p) { return (p === null || p === undefined) ? 5 : p; }
  /* Route entry: #/pools/:id — detail desk mirroring the orderbook desk grid. */
  function renderPoolDetail(root, poolId) {
    if (!root) return;
    var u = U(), retry = function () { renderPoolDetail(root, poolId); };
    var ctx = u.routeReady(root, "Pool " + poolId, retry);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.className = "wrap mkt-wrap";
    u.showStatus(doc, ctx.wrap,t("pool.loading_detail", "Loading pool…"));
    Pool.get(String(poolId)).then(function (row) {
      if (!live(myGen, uiGen)) return;
      root.innerHTML = "";
      var wrap = u.el(doc, "div", null, "wrap mkt-wrap"); root.appendChild(wrap);
      var desk = u.el(doc, "div", null, "mkt"); wrap.appendChild(desk);
      var head = doc.createElement("section"); head.className = "mkt-head"; desk.appendChild(head);
      head.appendChild(u.el(doc, "h1", "Pool " + row.id));
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
    var aA = u.amtText(r.balance_a_raw, r.asset_a_id, r.prec_a === undefined ? null : r.prec_a, r.sym_a);
    var aB = u.amtText(r.balance_b_raw, r.asset_b_id, r.prec_b === undefined ? null : r.prec_b, r.sym_b);
    strip.appendChild(u.el(doc, "span", "Balance A: " + aA.text)); strip.lastChild.title = "raw " + aA.raw;
    strip.appendChild(u.el(doc, "span", "Balance B: " + aB.text)); strip.lastChild.title = "raw " + aB.raw;
    strip.appendChild(u.el(doc, "span", "Taker: " + u.pctText(r.taker_units)));
    strip.appendChild(u.el(doc, "span", "Withdrawal: " + u.pctText(r.withdrawal_units)));
    strip.appendChild(u.el(doc, "span", "Share: " + (r.sym_share || r.share_id)));
    /* Spot price B-per-A (exact BigInt ratio, precOr5 fallbacks — same
     * orientation as the book and candles below). */
    try {
      var spot = Format.formatPrice(String(r.balance_b_raw), precOr5(r.prec_b), String(r.balance_a_raw), precOr5(r.prec_a), 8);
      var spotEl = u.el(doc, "span", t("pool.spot_row", "Spot") + ": " + spot + " " + (r.sym_b || r.asset_b_id) + "/" + (r.sym_a || r.asset_a_id));
      strip.appendChild(spotEl);
    } catch (e) { /* strip stands without spot */ }
    /* One tape fetch shared by chart + history (mainnet: ES adapter ->
     * chain; other networks: chain — the community index is mainnet-only).
     * Legs passed so cross-chain id collisions can never pollute the tape. */
    var tape = { swaps: [], source: null };
    if (typeof PoolHistory !== "undefined" && PoolHistory && typeof PoolHistory.swapsForPool === "function") {
      var net = "mainnet";
      try {
        if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
          var st = Store.loadSettings();
          if (st && (st.network === "testnet" || st.network === "mainnet")) net = st.network;
        }
      } catch (e) { /* mainnet default stands */ }
      try {
        tape = await PoolHistory.swapsForPool(r.id, 200, { network: net, legA: r.asset_a_id, legB: r.asset_b_id });
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
    chartPane(doc, charts, r, tape, myGen, uiGen, synthLevels);
    var acts = doc.createElement("section"); acts.className = "mkt-side"; desk.appendChild(acts);
    acts.appendChild(u.el(doc, "h2", t("pool.stake_title", "Stake / unstake")));
    stakeBoxes(doc, acts, r, uiGen);
    acts.appendChild(u.el(doc, "h2", t("pool.swap_title", "Swap in pool")));
    swapInlineBox(doc, acts, r, uiGen);
    acts.appendChild(u.el(doc, "h2", t("pool.manage_title", "Update / delete")));
    manageBoxes(doc, acts, r, uiGen);
    var book = doc.createElement("section"); book.className = "mkt-book"; desk.appendChild(book);
    book.appendChild(u.el(doc, "h2", t("pool.book_title", "Order book")));
    depthPane(doc, book, r, synthLevels);
    var hist = doc.createElement("section"); hist.className = "mkt-trades"; desk.appendChild(hist);
    hist.appendChild(u.el(doc, "h2", t("pool.pool_history_title", "Pool history")));
    historyPane(doc, hist, r, tape, myGen, uiGen);
  }
  /* Pool chart buckets (swap-tape timeframes; chain buckets API has no pool
   * leg, so bucketing happens here over enriched swaps). */
  var POOL_BUCKETS = [60, 300, 900, 1800, 3600];

  function chartPane(doc, charts, r, tape, myGen, uiGen, synthLevels) {
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
    var tfBox = doc.createElement("div");
    tfBox.className = "mkt-tfrow";
    tfBox.setAttribute("role", "radiogroup");
    charts.appendChild(tfBox);
    var countNote = u.el(doc, "p", "", "muted mkt-count-note");
    countNote.setAttribute("aria-live", "polite");
    charts.appendChild(countNote);
    var menuHost = doc.createElement("div");
    charts.appendChild(menuHost);
    var priceHost = doc.createElement("div");
    priceHost.className = "mkt-price-host";
    charts.appendChild(priceHost);
    var oscHost = doc.createElement("div");
    oscHost.className = "mkt-osc-host";
    charts.appendChild(oscHost);
    var oscNote = u.el(doc, "p", "", "muted");
    oscNote.setAttribute("aria-live", "polite");
    charts.appendChild(oscNote);
    var P = {
      doc: doc, bucket: 300, liveBuckets: POOL_BUCKETS.slice(), logScale: false,
      over: { sma: true, ema: true }, osc: { volume: true }, oscBoxes: {}, panes: {}, paneEls: {},
      candles: { buckets: [] }, tfBox: tfBox, countNote: countNote,
      priceHost: priceHost, oscHost: oscHost, oscNote: oscNote,
      depthCanvas: null, basePrec: precOr5(r.prec_b), quotePrec: precOr5(r.prec_a),
      assets: {
        base: { precision: precOr5(r.prec_b), symbol: r.sym_b || r.asset_b_id },
        quote: { precision: precOr5(r.prec_a), symbol: r.sym_a || r.asset_a_id }
      },
      swaps: [], precA: precOr5(r.prec_a), precB: precOr5(r.prec_b)
    };
    try { MarketInd.renderIndMenu(doc, menuHost, P); } catch (e) { /* chart works without the menu */ }
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
    function rebucket() {
      P.candles = { buckets: PoolHistory.swapsToCandles(P.swaps, P.bucket, r.asset_b_id, P.precB) };
      try { MarketInd.maybeDraw(P); } catch (e) { /* note below carries it */ }
      try {
        var liveSuffix = (typeof poolLive !== "undefined" && poolLive && poolLive.live) ? " · live" : "";
        P.countNote.textContent = P.swaps.length + " swaps · " + P.bucket + "s candles" + liveSuffix;
      } catch (e) { /* count stands */ }
    }
    var swaps = (tape && tape.swaps) || [];
    if (!tape || !tape.source) { note.textContent = t("pool_detail.s2", "Pool history unavailable (chain-only; no external index)."); return; }
    if (!swaps.length) { note.textContent = t("pool.no_swaps", "No swaps yet."); return; }
    P.swaps = swaps;
    note.textContent = swaps.length + " swaps. " + (tape.source === "es"
      ? t("pool.hist_source_es", "Swap history via community index.")
      : t("pool.hist_source_chain", "Swap history via chain."));
    try {
      MarketInd.paintTimeframes(doc, P, function () { if (live(myGen, uiGen)) rebucket(); });
    } catch (e) { /* default bucket stands */ }
    rebucket();
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
            try { PoolHistory.enrich(out, poolLive.legA, P.precA, poolLive.legB, P.precB); } catch (e) { /* tape renders unpriced */ }
            P.swaps = out.concat(P.swaps).slice(0, 500);
            rebucket();
          } catch (e) { /* scan skips */ }
        }).catch(function () { /* head fetch skips */ });
      } catch (e) { /* live tip skips */ }
    }
    var poolTimer = null;
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

  /* Pool x·y=k curve + current point (dex-ux plot proposal 5 — math from
   * Pool.curvePoints, itself a BigInt port of falcon_app.py:167-202; never
   * imported). Source balances come from the already-fetched detail row —
   * no new chain call. Collapsible <details open> with a canvas 2D line
   * (ask side: selling A into the pool) + marked current reserves. The axis
   * domains span the curve plus the current point; pixel mapping is
   * parts-per-million in BigInt, then Number() on the 0..1e6 int — exact
   * and pixel-only (never money). Tick labels go human via u.amtText at
   * render (raw fallback when the join missed a precision). Empty pool →
   * silent no-op (the depth table path below owns the honest empty sentence). */
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
    sum.setAttribute("aria-label", "Pool x y k curve plot");
    u.touchable(sum);
    sum.textContent = "Pool curve (x·y=k)";
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
    var i, xmin = null, xmax = null, ymin = null, ymax = null;
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
    var xrange = xmax - xmin, yrange = ymax - ymin;
    var padL = 8, padR = 8, padT = 24, padB = 30;
    var plotW = g.w - padL - padR, plotH = g.h - padT - padB;
    function fx(x) {
      if (xrange === 0n) return padL + plotW / 2;
      /* Pixel-only Number(): ppm is a 0..1e6 int, exact in double. */
      return padL + (Number((x - xmin) * 1000000n / xrange) / 1000000) * plotW;
    }
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
     * through the SHARED MarketBook renderer (same tables, depth bars,
     * spread line, staircase as the exchange desk) + the x·y=k canvas above.
     * Levels arrive precomputed from detailFill (shared with the charts-stack
     * depth slice above). Rows are synthetic (no counterparty) — the note
     * says so. Clicking a row prefills the inline swap form. */
    var u = U();
    drawCurve(doc, book, r); /* x·y=k canvas above the table; silent no-op on empty pools */
    book.appendChild(u.el(doc, "p", t("pool.synth_note", "Synthetic depth from the CPMM curve at current reserves — not resting orders."), "muted"));
    if (typeof MarketBook === "undefined" || typeof PoolHistory === "undefined" ||
        typeof MarketBook.renderBook !== "function") {
      book.appendChild(u.el(doc, "p", t("pool.depth_unavailable", "Depth unavailable (empty pool)."), "muted"));
      return;
    }
    var precA = precOr5(r.prec_a), precB = precOr5(r.prec_b);
    var levels = synthLevels || null;
    if (!levels || (!levels.asks.length && !levels.bids.length)) {
      book.appendChild(u.el(doc, "p", t("pool.depth_unavailable", "Depth unavailable (empty pool)."), "muted"));
      return;
    }
    var spreadLine = u.el(doc, "p", "", "muted");
    book.appendChild(spreadLine);
    var host = doc.createElement("div");
    book.appendChild(host);
    try {
      MarketBook.renderBook(doc, host, {
        book: levels, basePrec: precB, quotePrec: precA,
        baseSymbol: r.sym_b || r.asset_b_id, quoteSymbol: r.sym_a || r.asset_a_id,
        spreadLine: spreadLine
      });
    } catch (e) {
      book.appendChild(u.el(doc, "p", t("pool.depth_unavailable", "Depth unavailable (empty pool)."), "muted"));
      return;
    }
    /* Click-fill: DOM rows follow their side array order (asks ship reversed
     * for display — same array renderBookSide receives). Ask rows are
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
      var sides = host.querySelectorAll(".book-asks, .book-bids");
      Array.prototype.forEach.call(sides, function (side) {
        var isAsk = side.className.indexOf("book-asks") !== -1;
        var arr = isAsk ? levels.asks.slice().reverse() : levels.bids;
        var rows = side.querySelectorAll("table tbody tr, .book-row-card");
        Array.prototype.forEach.call(rows, function (row, i) {
          var lv = arr[i];
          if (!lv) return;
          var human = isAsk ? lv.base : lv.quote;
          var dir = isAsk ? "B" : "A";
          try {
            row.setAttribute("tabindex", "0");
            row.setAttribute("role", "button");
            row.title = "Fill swap";
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
      tr.appendChild(u.el(doc, "td", (sw.price === null || sw.price === undefined) ? "—" : String(sw.price)));
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
  function historyPane(doc, hist, r, tape, myGen, uiGen) {
    /* Swap tape (Time / Price / Paid / Received / Account) + My-exchanges
     * toggle — mirrors the market desk Recent/My tabs (same mkt-tabs
     * contract, same locked-hint). Rows come from the shared tape fetch
     * (executed paid/received, human strings, raw in title). */
    var u = U();
    var u = U();
    /* Toggle mirrors #1 MarketHistory group-1 tabs (Exchange.jsx:2551-2616):
     * Pool history (all events) vs My exchanges (wallet op-63 for this pool).
     * My needs unlock: locked wallets get the Wallet-link hint (#9). */
    var tabs = doc.createElement("div");
    tabs.className = "mkt-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("pool.exchanges_toggle_label", "Pool or my exchanges"));
    var tabPool = u.touchable(u.el(doc, "button", t("pool.tab_pool", "Pool history")));
    tabPool.type = "button"; tabPool.id = "pool-hist-tab-pool"; tabPool.setAttribute("role", "tab");
    var tabMy = u.touchable(u.el(doc, "button", t("pool.tab_my", "My exchanges")));
    tabMy.type = "button"; tabMy.id = "pool-hist-tab-my"; tabMy.setAttribute("role", "tab");
    tabs.appendChild(tabPool); tabs.appendChild(tabMy);
    hist.appendChild(tabs);
    var poolBody = u.el(doc, "div"); poolBody.id = "pool-hist-pool"; poolBody.setAttribute("role", "tabpanel");
    var myBody = u.el(doc, "div"); myBody.id = "pool-hist-my"; myBody.setAttribute("role", "tabpanel");
    hist.appendChild(poolBody); hist.appendChild(myBody);
    var cur = "pool";
    function paint() {
      var isMy = cur === "my";
      tabPool.setAttribute("aria-selected", isMy ? "false" : "true");
      tabMy.setAttribute("aria-selected", isMy ? "true" : "false");
      tabPool.setAttribute("aria-pressed", isMy ? "false" : "true");
      tabMy.setAttribute("aria-pressed", isMy ? "true" : "false");
      poolBody.style.display = isMy ? "none" : "";
      myBody.style.display = isMy ? "" : "none";
    }
    tabPool.addEventListener("click", function () { cur = "pool"; paint(); });
    tabMy.addEventListener("click", function () { cur = "my"; paint(); loadMy(poolBody, myBody, r, myGen, uiGen); });
    paint();
    var note = u.el(doc, "p", t("account.loading_history", "Loading history…"), "muted"); poolBody.appendChild(note);
    poolBody.removeChild(note);
    var swaps = (tape && tape.swaps) || [];
    if (!tape || !tape.source) {
      poolBody.appendChild(u.el(doc, "p", t("pool_detail.s2", "Pool history unavailable (chain-only; no external index)."), "muted"));
    } else if (!swaps.length) {
      poolBody.appendChild(u.el(doc, "p", t("pool.no_swaps", "No swaps yet."), "muted"));
    } else {
      poolBody.appendChild(tapeTable(doc, swaps.slice(0, 50), r));
    }
    myBody.appendChild(u.el(doc, "p", t("pool.my_hist_hint", "Open My exchanges to see your fills in this pool."), "muted"));
    function loadMy(poolBodyEl, myBodyEl, row, g1, g2) {
      void poolBodyEl;
      u.clearBox(myBodyEl);
      var unlocked = false;
      try {
        unlocked = typeof Wallet !== "undefined" && Wallet &&
          (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
      } catch (e) { unlocked = false; }
      if (!unlocked) {
        var hint = u.el(doc, "p", t("pool.my_locked", "Unlock your wallet to see your exchanges in this pool. "), "muted");
        var a = doc.createElement("a");
        a.textContent = t("market.go_wallet", "Go to Wallet");
        a.setAttribute("href", "#/wallet");
        u.touchable(a);
        hint.appendChild(a);
        myBodyEl.appendChild(hint);
        return;
      }
      u.showStatus(doc, myBodyEl, t("account.loading_history", "Loading history…"));
      Account.myAccountId().then(function (myId) {
        if (!live(g1, g2)) return;
        u.clearBox(myBodyEl);
        var tape2 = (typeof tape !== "undefined" && tape && tape.swaps) || [];
        var mine = tape2.filter(function (sw) { return sw && String(sw.account) === String(myId); });
        if (!mine.length) { myBodyEl.appendChild(u.el(doc, "p", t("pool.no_my_exchanges", "No exchanges for your account in this pool."), "muted")); return; }
        myBodyEl.appendChild(tapeTable(doc, mine.slice(0, 20), row));
      }).catch(function (e) {
        if (!live(g1, g2)) return;
        u.clearBox(myBodyEl); u.showError(doc, myBodyEl, e, t("pool.my_history_failed", "Could not load your exchanges."));
      });
    }
  }
  function stakeBoxes(doc, box, r, uiGen) { /* op-61 deposit + op-62 withdraw with share previews */
    var u = U();
    var fA = u.field(doc, t("pool.amount_a_field", "Amount A"), { inputmode: "decimal", placeholder: "1.0" });
    var fB = u.field(doc, t("pool.amount_b_field", "Amount B"), { inputmode: "decimal", placeholder: "1.0" });
    box.appendChild(fA.row); box.appendChild(fB.row);
    u.reviewSection(doc, box, uiGen, t("pool.review_stake", "Review stake"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildDeposit({ accountId: me.id, poolId: r.id, assetAId: r.asset_a_id, assetBId: r.asset_b_id,
          aHuman: fA.input.value.trim(), precA: precOr5(r.prec_a),
          bHuman: fB.input.value.trim(), precB: precOr5(r.prec_b) });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var lA = u.amtText(op.amount_a.amount, op.amount_a.asset_id, precOr5(r.prec_a), r.sym_a);
        var lB = u.amtText(op.amount_b.amount, op.amount_b.asset_id, precOr5(r.prec_b), r.sym_b);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.amount_a_field", "Amount A"),  lA.text, "raw " + lA.raw], [t("pool.amount_b_field", "Amount B"),  lB.text, "raw " + lB.raw],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_stake", "Confirm stake"), ok: function () { return t("pool.staked", "Staked (deposit broadcast)."); }, fail: t("pool.stake_failed", "Could not prepare the stake.") });
    var fS = u.field(doc, t("pool.shares_field", "LP shares"), { inputmode: "decimal", placeholder: "1.0" });
    box.appendChild(fS.row);
    u.reviewSection(doc, box, uiGen, t("pool.review_unstake", "Review unstake"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildWithdraw({ accountId: me.id, poolId: r.id, shareId: r.share_id,
          shareHuman: fS.input.value.trim(), precShare: precOr5(r.prec_share) });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var sh = u.amtText(op.share_amount.amount, op.share_amount.asset_id, precOr5(r.prec_share), r.sym_share);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.shares_field", "LP shares"),  sh.text, "raw " + sh.raw],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_unstake", "Confirm unstake"), ok: function () { return t("pool.unstaked", "Unstaked (withdraw broadcast)."); }, fail: t("pool.unstake_failed", "Could not prepare the unstake.") });
  }
  function swapInlineBox(doc, box, r, uiGen) { /* op-63 mini-form: quote + impact + slippage preview */
    var u = U();
    var fSell = u.field(doc, t("pool.sell_amount_field", "Sell amount"), { inputmode: "decimal", placeholder: "1.0" });
    try { fSell.input.id = "pool-swap-amount"; } catch (e) { /* fill skips */ }
    box.appendChild(fSell.row);
    var dir = doc.createElement("select"); u.touchable(dir);
    try { dir.id = "pool-swap-dir"; } catch (e) { /* fill skips */ }
    var oA = doc.createElement("option"); oA.value = "A"; oA.textContent = t("account.sell_prefix", "Sell ") + (r.sym_a || r.asset_a_id);
    var oB = doc.createElement("option"); oB.value = "B"; oB.textContent = t("account.sell_prefix", "Sell ") + (r.sym_b || r.asset_b_id);
    dir.appendChild(oA); dir.appendChild(oB); box.appendChild(dir);
    var fSlip = u.field(doc, t("pool.slippage_field", "Slippage %"), { value: Pool.DEFAULT_SLIPPAGE_PCT, inputmode: "decimal" });
    box.appendChild(fSlip.row);
    u.reviewSection(doc, box, uiGen, t("pool.review_swap", "Review swap"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var sellIsA = dir.value === "A";
        var precSell = precOr5(sellIsA ? r.prec_a : r.prec_b);
        var sellRaw = Format.parseAmount(fSell.input.value.trim(), precSell);
        var q = Pool.quote({ balanceA_raw: r.balance_a_raw, balanceB_raw: r.balance_b_raw, sell_raw: sellRaw, sellIsA: sellIsA });
        var minRaw = Pool.minReceive(q.out_raw, fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT);
        var pair = Pool.buildExchange({ accountId: me.id, poolId: r.id,
          sellHuman: fSell.input.value.trim(), precSell: precSell,
          sellAssetId: sellIsA ? r.asset_a_id : r.asset_b_id,
          minRaw: minRaw, recvAssetId: sellIsA ? r.asset_b_id : r.asset_a_id });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me, q: q, minRaw: minRaw, sellIsA: sellIsA,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var precSell = precOr5(R.sellIsA ? r.prec_a : r.prec_b);
        var precRecv = precOr5(R.sellIsA ? r.prec_b : r.prec_a);
        var sell = u.amtText(op.amount_to_sell.amount, op.amount_to_sell.asset_id, precSell, R.sellIsA ? r.sym_a : r.sym_b);
        var min = u.amtText(R.minRaw, op.min_to_receive.asset_id, precRecv, R.sellIsA ? r.sym_b : r.sym_a);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("account.sell_th", "Sell"),  sell.text, "raw " + sell.raw],
          [t("pool.quote_row", "Quote out (raw)"),  R.q.out_raw], [t("pool.min_recv_row", "Min to receive"),  min.text, "raw " + min.raw],
          [t("pool.slippage_row", "Slippage"),  String(fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT) + "%"],
          [t("pool.impact_row", "Price impact"),  (R.q.impact_bp / 100) + "%"],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_swap", "Confirm swap"), ok: function () { return t("pool.swapped", "Swapped."); }, fail: t("pool.swap_failed", "Could not prepare the swap.") });
  }
  function manageBoxes(doc, box, r, uiGen) { /* op-75 fee edit (withdrawal 0-only) + op-60 owner delete (fee 0) */
    var u = U();
    var fT = u.field(doc, t("pool.taker_field", "New taker fee % (blank = keep)"), { inputmode: "decimal", placeholder: Pool.pctUnitsToHuman(r.taker_units) });
    box.appendChild(fT.row);
    var wSel = doc.createElement("select"); u.touchable(wSel);
    var wKeep = doc.createElement("option"); wKeep.value = ""; wKeep.textContent = t("pool_detail.s3", "Withdrawal fee: keep");
    var wZero = doc.createElement("option"); wZero.value = "0"; wZero.textContent = t("pool_detail.s4", "Withdrawal fee: set 0 (only allowed change)");
    wSel.appendChild(wKeep); wSel.appendChild(wZero); box.appendChild(wSel);
    u.reviewSection(doc, box, uiGen, t("credit.review_update", "Review update"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var t = String(fT.input.value).trim();
        var pair = Pool.buildUpdate({ accountId: me.id, poolId: r.id,
          takerHumanOrNull: t === "" ? null : t, withdrawalZeroOrNull: wSel.value === "" ? null : "0" });
        var op = pair[1];
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try {
              var cur = await Pool.get(r.id);
              if (op.taker_fee_percent !== null && op.taker_fee_percent !== undefined &&
                cur.taker_units !== op.taker_fee_percent) return null;
              if (op.withdrawal_fee_percent !== null && op.withdrawal_fee_percent !== undefined &&
                cur.withdrawal_units !== op.withdrawal_fee_percent) return null;
              return cur;
            } catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1], rows = [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)]];
        if (op.taker_fee_percent !== null && op.taker_fee_percent !== undefined)
          rows.push([t("pool.taker_row", "Taker fee"),  u.pctText(r.taker_units) + " → " + u.pctText(op.taker_fee_percent)]);
        if (op.withdrawal_fee_percent !== null && op.withdrawal_fee_percent !== undefined)
          rows.push([t("pool.withdrawal_row", "Withdrawal fee"),  u.pctText(r.withdrawal_units) + " → 0%"]);
        rows.push([t("misc.note", "Note"),  t("pool.withdrawal_zero_note", "Withdrawal fee can only be set to 0.")]);
        rows.push([t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw]); rows.push([t("borrow.network", "Network"),  "testnet"]);
        return rows;
      },
      title: t("pool.confirm_update", "Confirm pool update"), ok: function () { return t("pool.updated", "Pool updated."); }, fail: t("credit.could_not_prepare_the_update", "Could not prepare the update.") });
    u.reviewSection(doc, box, uiGen, t("credit.review_delete", "Review delete"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildDelete({ accountId: me.id, poolId: r.id });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { await Pool.get(r.id); return null; } catch (e) { return { gone: true }; } } };
      },
      rows: function (R, fee) {
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.warning_row", "Warning"),  t("pool.delete_warning", "Delete is owner-only cleanup. Withdraw all liquidity first.")],
          [t("borrow.fee", "Fee"),  fee.text + " (expected 0)", "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
      },
      title: t("pool.confirm_delete", "Confirm pool delete"), ok: function () { return t("pool.deleted", "Pool deleted."); }, fail: t("credit.could_not_prepare_the_delete", "Could not prepare the delete.") });
  }
  return { renderPoolDetail: renderPoolDetail };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolDetailUI === "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
if (typeof module !== "undefined") { module.exports = PoolDetailUI; }
