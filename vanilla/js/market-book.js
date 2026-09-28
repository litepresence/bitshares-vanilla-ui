/* MarketBook: order-book + recent-trades rendering for the DEX desk.
 * Owns: book side tables/cards with depth shading, spread/midpoint header
 *   text, trades tables/cards with raw-JSON details, plus the cumulative
 *   depth staircase canvas (dex-ux plot proposal 1, canvas 2D step-fill from
 *   Market.depth points — collapsible, inside the mkt-book grid area).
 *   The fill-size tape histogram (proposal 2) is owned by MarketOrders and
 *   mounted here into the recent-trades pane (mkt-trades area) when loaded.
 *   No fetching, no timers, no signing — pure DOM fill from
 *   caller-supplied data.
 * Consumes: Market (depth computation only, via global — same as before the
 *   split), MarketOrders.renderTape (optional tape histogram, guarded),
 *   Format not needed (chain-human strings render verbatim).
 * Globals/side effects: DOM under the given parent element only; global
 *   MarketBook only. Exact decimal-string math is a private copy of the
 *   market-ui.js helpers (split/add/sub/half/trim: BigInt + digit loops —
 *   binary float never touches money); Number() appears ONLY for canvas
 *   pixels and depth-bar widths (commented at each site).
 * Created by: building-vanilla-slices skill, slice-05 refactor (market-ui split).
 * Extended by: dex-ux plots task (AFK round — proposals 1+2, chain-history
 *   only, no new chain methods).
 */
var MarketBook = (function () {
  "use strict";

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

  /* Element helper: textContent only, user/chain strings never reach HTML. */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  /* --- Exact decimal-string math (money-safe: BigInt + digit loops) --- */

  /* Split a non-negative decimal string into int/frac parts. */
  function splitDec(s) {
    s = String(s);
    if (!/^\d+(?:\.\d+)?$/.test(s)) throw new Error("bad decimal: " + s);
    var parts = s.split(".");
    return { int: parts[0], frac: parts[1] || "" };
  }

  /* Exact a+b for non-negative decimal strings (trimmed result). */
  function addDec(a, b) {
    var x = splitDec(a), y = splitDec(b);
    var scale = Math.max(x.frac.length, y.frac.length);
    while (x.frac.length < scale) x.frac += "0";
    while (y.frac.length < scale) y.frac += "0";
    var sum = BigInt(x.int + x.frac) + BigInt(y.int + y.frac);
    return trimDec(_placeDec(sum.toString(), scale));
  }

  /* Exact a-b for non-negative decimal strings; negative results get "-". */
  function subDec(a, b) {
    var x = splitDec(a), y = splitDec(b);
    var scale = Math.max(x.frac.length, y.frac.length);
    while (x.frac.length < scale) x.frac += "0";
    while (y.frac.length < scale) y.frac += "0";
    var d = BigInt(x.int + x.frac) - BigInt(y.int + y.frac);
    var neg = d < 0n;
    if (neg) d = -d;
    var out = _placeDec(d.toString(), scale);
    return (neg ? "-" : "") + trimDec(out);
  }

  /* Place the decimal point `scale` digits from the right of digit string. */
  function _placeDec(digits, scale) {
    while (digits.length <= scale) digits = "0" + digits;
    return scale === 0 ? digits : digits.slice(0, digits.length - scale) + "." + digits.slice(digits.length - scale);
  }

  /* Exact halve of a non-negative decimal string (division by 2 terminates). */
  function halfDec(a) {
    var s = splitDec(a);
    var digits = s.int + s.frac;
    var shift = s.frac.length;
    var out = "";
    var carry = 0;
    var i, cur, q;
    for (i = 0; i < digits.length; i++) {
      cur = carry * 10 + (digits.charCodeAt(i) - 48);
      q = Math.floor(cur / 2);
      carry = cur % 2;
      out += String(q);
    }
    if (carry) {
      out += "5";
      shift += 1;
    }
    out = out.replace(/^0+(?=\d)/, "");
    if (out === "") out = "0";
    return trimDec(_placeDec(out, shift));
  }

  /* Strip trailing fractional zeros ("1.500" -> "1.5", "2.000" -> "2"). */
  function trimDec(s) {
    if (s.indexOf(".") === -1) return s;
    s = s.replace(/0+$/, "");
    if (s.charAt(s.length - 1) === ".") s = s.slice(0, -1);
    return s === "" ? "0" : s;
  }

  /* Spread + midpoint header from best bid/ask strings via exact string math
   * (unit: base-symbol per quote-symbol). Null when either side is empty. */
  function spreadMid(bestBid, bestAsk) {
    if (!bestBid || !bestAsk) return null;
    try {
      var spread = subDec(String(bestAsk), String(bestBid));
      var mid = halfDec(addDec(String(bestAsk), String(bestBid)));
      return { spread: spread, mid: mid };
    } catch (e) {
      return null;
    }
  }

  /* Read a CSS custom property off <html> (theme-aware plot colors);
   * falls back headlessly. Token-driven: all three renamed themes supply
   * --buy/--sell/--accent/--border/--muted/--text (themes.css). */
  function cssVar(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }

  /* Size a canvas to its layout width (300px fallback when hidden) at a fixed
   * CSS height, scaled by devicePixelRatio. Returns {ctx, w, h} CSS pixels,
   * or null when the canvas is unusable. Plain duplicate of the
   * market-charts.js fit helper (doctrine: duplicated plain code over a
   * shared abstraction with a future migration cost). */
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

  /* Centered muted empty text on a fitted canvas (never a blank canvas). */
  function canvasEmpty(g, text, muted) {
    g.ctx.fillStyle = muted;
    g.ctx.font = "13px system-ui, sans-serif";
    g.ctx.textAlign = "center";
    /* Pixel centering only (g.w/g.h are CSS-pixel layout sizes). */
    g.ctx.fillText(text, g.w / 2, g.h / 2);
    g.ctx.textAlign = "left";
  }

  /* Cumulative depth staircase (dex-ux proposal 1 — the portable pattern is
   * json_to_html.py:24-44 cumulative quote-volume + main.js:267-338
   * plotDepth step-fill; we port the MATH, never Plotly). Cumulative sums
   * are already exact upstream (Market.depth totals via BigInt decimal
   * addition; totalBaseStr kept per point); here each point's priceFloat /
   * totalBase becomes a step corner via Number() for PIXELS ONLY (chart
   * coordinates, never money — raw integers never enter). Renders as a
   * collapsible <details open> INSIDE the mkt-book grid area (no grid
   * restructure): bids green steps + asks red steps with a filled band to
   * the baseline. Empty both sides -> honest muted sentence, no canvas. */
  function drawStaircase(doc, parentEl, depth) {
    var bids = depth && Array.isArray(depth.bids) ? depth.bids : [];
    var asks = depth && Array.isArray(depth.asks) ? depth.asks : [];
    function finite(side) {
      return side.filter(function (p) {
        return p && typeof p.priceFloat === "number" && isFinite(p.priceFloat) &&
          typeof p.totalBase === "number" && isFinite(p.totalBase);
      });
    }
    var fb = finite(bids), fa = finite(asks);
    if (fb.length === 0 && fa.length === 0) {
      parentEl.appendChild(el(doc, "p",
        t("market_book.no_depth_plot", "No depth data — the book is empty on both sides."), "muted"));
      return;
    }
    var det = doc.createElement("details");
    det.className = "plot mkt-depth-plot";
    det.setAttribute("open", "");
    var sum = doc.createElement("summary");
    sum.setAttribute("aria-label", t("market_book.depth_plot_label", "Cumulative depth staircase plot"));
    touchable(sum);
    sum.textContent = t("market_book.depth_plot", "Depth staircase");
    det.appendChild(sum);
    var canvas = doc.createElement("canvas");
    canvas.className = "mkt-canvas";
    det.appendChild(canvas);
    parentEl.appendChild(det);
    var g = fitCanvas(canvas, 180);
    if (!g) return;
    var buy = cssVar("--buy", "#22d173");
    var sell = cssVar("--sell", "#e3745b");
    var muted = cssVar("--muted", "#777777");
    var text = cssVar("--text", "#c5cbce");
    var all = fb.concat(fa);
    var pmin = Infinity, pmax = -Infinity, tmax = 0, i;
    /* Min/max scan over pixel inputs only (layout domain, not money). */
    for (i = 0; i < all.length; i++) {
      if (all[i].priceFloat < pmin) pmin = all[i].priceFloat;
      if (all[i].priceFloat > pmax) pmax = all[i].priceFloat;
      if (all[i].totalBase > tmax) tmax = all[i].totalBase;
    }
    if (!(pmax > pmin)) { pmax = pmin + 1; pmin = pmin - 1; }
    if (!(tmax > 0)) tmax = 1;
    var padL = 8, padR = 8, padT = 24, padB = 18;
    var plotW = g.w - padL - padR;
    var plotH = g.h - padT - padB;
    function x(v) { return padL + ((v - pmin) / (pmax - pmin)) * plotW; }
    function y(v) { return padT + (1 - v / tmax) * plotH; }
    function stair(side, color) {
      var pts = side.slice().sort(function (a, b) { return a.priceFloat - b.priceFloat; });
      if (pts.length === 0) return;
      var ctx = g.ctx;
      ctx.beginPath();
      ctx.moveTo(x(pts[0].priceFloat), y(0));
      var j, prev = 0;
      for (j = 0; j < pts.length; j++) {
        ctx.lineTo(x(pts[j].priceFloat), y(prev));
        ctx.lineTo(x(pts[j].priceFloat), y(pts[j].totalBase));
        prev = pts[j].totalBase;
      }
      ctx.lineTo(x(pts[pts.length - 1].priceFloat), y(0));
      ctx.closePath();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      prev = 0;
      for (j = 0; j < pts.length; j++) {
        if (j === 0) ctx.moveTo(x(pts[j].priceFloat), y(prev));
        else ctx.lineTo(x(pts[j].priceFloat), y(prev));
        ctx.lineTo(x(pts[j].priceFloat), y(pts[j].totalBase));
        prev = pts[j].totalBase;
      }
      ctx.stroke();
    }
    stair(fb, buy);
    stair(fa, sell);
    /* Legend swatches + exact cumulative totals (verbatim totalBaseStr
     * strings from Market.depth — never recomputed here). */
    var ctx = g.ctx;
    ctx.font = "11px system-ui, sans-serif";
    var lx = 8;
    [["Bid", buy], ["Ask", sell]].forEach(function (e) {
      ctx.fillStyle = e[1];
      ctx.fillRect(lx, 6, 10, 10);
      ctx.fillStyle = muted;
      ctx.fillText(e[0], lx + 14, 15);
      lx += ctx.measureText(e[0]).width + 30;
    });
    ctx.fillStyle = text;
    ctx.textAlign = "right";
    var lastB = fb.length ? fb[fb.length - 1].totalBaseStr : null;
    var lastA = fa.length ? fa[fa.length - 1].totalBaseStr : null;
    var tot = [lastB, lastA].filter(function (s) { return s !== null; }).join(" / ");
    if (tot) ctx.fillText("Σ " + tot, g.w - 6, g.h - 6);
    ctx.textAlign = "left";
  }

  /* Compact ISO time ("2026-09-26T12:00:00" from "…T…Z"); verbatim fallback. */
  function timeText(t) {
    t = String(t === undefined || t === null ? "" : t);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(t)) {
      return t.slice(0, 16).replace("T", " ");
    }
    return t || "—";
  }

  /* Raw-JSON <details> block for a section ( P R O O F, not decoration).
   * Triangle-only summary per the shared details.raw contract in app.css;
   * label becomes the aria-label (nothing visible but ▸). */
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

  /* Book side table + phone cards (same .node-table/.node-cards pattern as
  * account-ui renderBalances). Amount = quote leg, Total = base leg, both
  * verbatim chain-human strings. Depth fraction per row comes from
  * Market.depth cumulative totalBase Numbers (pixels, not money — same as
  * the depth chart); the row stores it as --depth for desk-grid.css, which
  * paints ONE absolutely-positioned .depth-bar behind the row text
  * (asks red from the left, bids green from the right —
  * bitshares-ui OrderBook.jsx:176-184). Scroll regions + grid live in
  * desk-grid.css (.book-scroll/.book-cards/.book-grid). */
  function renderBookSide(doc, section, title, levels, depthPts) {
    var isAsk = title === "Asks";
    /* Title doubles as the caller's side key (Asks/Bids drive the depth-bar
     * color below), so the h3 localizes through a static per-side key while
     * `title` itself stays the English logic key. */
    var sideWrap = doc.createElement("div");
    sideWrap.className = "book-side " + (isAsk ? "book-asks" : "book-bids");
    section.appendChild(sideWrap);
    sideWrap.appendChild(el(doc, "h3", isAsk ? t("market.asks", "Asks") : t("market.bids", "Bids")));
    if (!levels || levels.length === 0) {
      sideWrap.appendChild(el(doc, "p", "No " + title.toLowerCase() + ".", "muted"));
      return;
    }
    var maxTot = 0;
    var i;
    for (i = 0; i < depthPts.length; i++) {
      if (typeof depthPts[i].totalBase === "number" && depthPts[i].totalBase > maxTot) {
        maxTot = depthPts[i].totalBase;
      }
    }
    var table = doc.createElement("table");
    table.className = "node-table book-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    [t("market.th_price", "Price"), t("market.th_amount", "Amount"), t("market.th_total", "Total")].forEach(function (h) {
      hr.appendChild(el(doc, "th", h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    var cards = doc.createElement("div");
    cards.className = "node-cards book-cards";
    for (i = 0; i < levels.length; i++) {
      var lv = levels[i] || {};
      var pct = 0; /* width percent: pixel shading from depth Numbers only */
      if (maxTot > 0 && depthPts[i] && typeof depthPts[i].totalBase === "number") {
        pct = (100 * depthPts[i].totalBase) / maxTot;
        if (!(pct >= 0)) pct = 0;
        if (pct > 100) pct = 100;
      }
      var frac = String(pct) + "%";
      var tr = doc.createElement("tr");
      tr.className = "book-row " + (isAsk ? "book-ask-row" : "book-bid-row");
      try { tr.style.setProperty("--depth", frac); } catch (e) { /* rows render without bars */ }
      var texts = [
        lv.displayPrice !== undefined ? String(lv.displayPrice) : "",
        lv.quote !== undefined ? String(lv.quote) : "",
        lv.base !== undefined ? String(lv.base) : ""
      ];
      texts.forEach(function (text, ci) {
        var td = doc.createElement("td");
        td.className = "book-cell";
        /* The row's single .depth-bar anchors in the price-side cell
         * (asks: first cell; bids: last cell) so desk-grid.css can grow it
         * across the row from the price side. */
        if ((isAsk && ci === 0) || (!isAsk && ci === texts.length - 1)) {
          var bar = doc.createElement("span");
          bar.className = "depth-bar " + (isAsk ? "bar-ask" : "bar-bid");
          bar.setAttribute("aria-hidden", "true");
          td.appendChild(bar);
        }
        var tx = doc.createElement("span");
        tx.className = "cell-text";
        tx.textContent = text;
        td.appendChild(tx);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      var card = doc.createElement("div");
      card.className = "node-card book-row-card " + (isAsk ? "book-ask-row" : "book-bid-row");
      try { card.style.setProperty("--depth", frac); } catch (e) { /* cards render without bars */ }
      var cbar = doc.createElement("span");
      cbar.className = "depth-bar " + (isAsk ? "bar-ask" : "bar-bid");
      cbar.setAttribute("aria-hidden", "true");
      card.appendChild(cbar);
      [String(lv.displayPrice || ""), "Amount " + String(lv.quote || ""), "Total " + String(lv.base || "")].forEach(function (text) {
        card.appendChild(el(doc, "div", text, "cell-text"));
      });
      cards.appendChild(card);
    }
    table.appendChild(tbody);
    /* Scroll region (matches the original's fixed-height book areas; native
     * overflow, no library): long books scroll in place instead of running
     * down the page. Thead sticks so prices stay labeled while scrolling. */
    var scroller = doc.createElement("div");
    scroller.className = "book-scroll";
    scroller.appendChild(table);
    sideWrap.appendChild(scroller);
    sideWrap.appendChild(cards);
  }

  /* Book section fill (moved verbatim from the MarketUI fill book handler):
   * clears the section, computes depth via Market, writes the spread header,
   * renders Asks (reversed) + Bids. ctx carries exactly the moved code's free
   * variables: { book, basePrec, quotePrec, baseSymbol, quoteSymbol,
   * spreadLine }. Returns depth so the caller can cache it for charts. */
  function renderBook(doc, parentEl, ctx) {
    while (parentEl.firstChild) parentEl.removeChild(parentEl.firstChild);
    var depth = Market.depth(ctx.book, ctx.basePrec, ctx.quotePrec);
    var bestBid = ctx.book.bids.length > 0 ? ctx.book.bids[0].displayPrice : null;
    /* Chain asks arrive best-first (ascending); the render below reverses for
     * display, so bestAsk is asks[0] — NOT asks[last] (that was the worst).
     * Levels and depth points reverse TOGETHER, so each row keeps its own
     * cumulative fraction for the --depth bar. */
    var bestAsk = ctx.book.asks.length > 0 ? ctx.book.asks[0].displayPrice : null;
    var sm = spreadMid(bestBid ? String(bestBid) : null, bestAsk ? String(bestAsk) : null);
    if (sm) {
      ctx.spreadLine.textContent = "Spread " + sm.spread + " · Midpoint " + sm.mid +
        " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
    } else {
      ctx.spreadLine.textContent = t("market_book.s1", "Spread — (empty book side)");
    }
    /* Sides render into a .book-grid wrapper (desk-grid.css squares the book
     * column); Asks and Bids each own a fixed-height scroll region. */
    var grid = doc.createElement("div");
    grid.className = "book-grid";
    parentEl.appendChild(grid);
    renderBookSide(doc, grid, "Asks", ctx.book.asks.slice().reverse(), depth.asks.slice().reverse());
    renderBookSide(doc, grid, "Bids", ctx.book.bids, depth.bids);
    /* Depth staircase plot (proposal 1): collapsible canvas inside the
     * mkt-book area, drawn from the same depth points as the row bars. */
    drawStaircase(doc, parentEl, depth);
    rawDetails(doc, parentEl, t("market.raw_book", "Raw order book"), ctx.book);
    return depth;
  }

  /* Trades section fill (moved verbatim from the MarketUI fill trades
   * handler): table + phone cards from fill rows, raw fills JSON. ctx carries
   * exactly the moved code's free variables: { rows, quoteSymbol }. Empty
   * markets get the muted sentence, never a blank panel. */
  function renderTrades(doc, parentEl, ctx) {
    var rows = ctx.rows;
    while (parentEl.firstChild) parentEl.removeChild(parentEl.firstChild);
    if (!rows || rows.length === 0) {
      parentEl.appendChild(el(doc, "p", t("market.no_fills", "No recent fills on this market."), "muted"));
      /* Honest tape empty state too (same guarded mount as below). */
      mountTape(doc, parentEl, []);
      return;
    }
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    [t("market.th_time", "Time"), t("market.th_price", "Price"), t("market.th_amount", "Amount")].forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    rows.forEach(function (r) {
      var tr = doc.createElement("tr");
      tr.appendChild(el(doc, "td", timeText(r.time)));
      tr.appendChild(el(doc, "td", r.displayPrice === null ? "—" : String(r.displayPrice)));
      tr.appendChild(el(doc, "td", (r.quoteAmount === null ? "" : String(r.quoteAmount) + " " + ctx.quoteSymbol)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    /* Fixed-height scroll region (desk-grid.css: 15-row fold, sticky thead);
     * fills scroll in place like the original market-history list. */
    var scroller = doc.createElement("div");
    scroller.className = "trades-scroll";
    scroller.appendChild(table);
    parentEl.appendChild(scroller);
    var cards = doc.createElement("div");
    cards.className = "node-cards trades-cards";
    rows.forEach(function (r) {
      var card = doc.createElement("div");
      card.className = "node-card";
      card.appendChild(el(doc, "div", timeText(r.time)));
      card.appendChild(el(doc, "div", r.displayPrice === null ? "—" : String(r.displayPrice)));
      card.appendChild(el(doc, "div", (r.quoteAmount === null ? "" : String(r.quoteAmount) + " " + ctx.quoteSymbol)));
      cards.appendChild(card);
    });
    parentEl.appendChild(cards);
    /* Fill-size tape histogram (proposal 2, owned by MarketOrders): mounts
     * into this same mkt-trades pane from the already-fetched fill rows —
     * no new chain call. Guarded: trades render fully when the module is
     * absent (same convention as TradeUI guards in market-orders.js). */
    mountTape(doc, parentEl, rows);
    rawDetails(doc, parentEl, t("market.raw_fills", "Raw fills"), rows.map(function (r) { return r.raw; }));
  }

  /* Guarded tape mount (single call site for both trades branches above). */
  function mountTape(doc, parentEl, rows) {
    try {
      if (typeof MarketOrders !== "undefined" && MarketOrders &&
          typeof MarketOrders.renderTape === "function") {
        MarketOrders.renderTape(doc, parentEl, rows);
      }
    } catch (e) { /* tape is optional decoration; trades stand alone */ }
  }

  return {
    renderBook: renderBook,
    renderTrades: renderTrades
  };
})();

if (typeof module !== "undefined") { module.exports = MarketBook; }
