/* MarketBook: order-book + recent-trades rendering for the DEX desk.
 * Owns: book side tables/cards with depth shading, spread/midpoint header
 *   text, trades tables/cards with raw-JSON details. renderBook paints the
 *   combined Asks+Bids book (pool desk); renderSplit paints the same sides
 *   into two separate retro-2x3 cells (exchange BUY ORDERS + SELL ORDERS)
 *   through the ONE shared renderBookSide builder — row math has a single
 *   code path either way. The depth CHART lives
 *   in exactly one place — the desk's depth cell (MarketCharts.drawDepth
 *   via the shared redraw path); the old second copy here (cumulative
 *   staircase canvas, dex-ux proposal 1) was deleted 2026-09-29 so bids
 *   and asks share one green/red plot instead of two.
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

  /* Click-to-fill (desk parity with #1 order-book click): set the price
   * input of BOTH trade panels (per-side ids trade-price-buy /
   * trade-price-sell, legacy bare trade-price as fallback) and fire input
   * so each panel's three-way wiring syncs, then focus the amount input of
   * the taking side (ask rows -> buy panel, bid rows -> sell panel).
   * focusSide is "buy", "sell", or omitted (buys). No-op when the panels
   * are absent (pool desk, confirm screens). Never throws — money strings
   * pass through verbatim. */
  function fillTradePrice(doc, priceText, focusSide) {
    try {
      var filled = false;
      ["trade-price-buy", "trade-price-sell", "trade-price"].forEach(function (id) {
        var price = doc.getElementById(id);
        if (!price) return;
        price.value = String(priceText);
        var ev = null;
        if (typeof Event === "function") {
          try { ev = new Event("input", { bubbles: true }); } catch (e) { ev = null; }
        }
        if (ev && typeof price.dispatchEvent === "function") {
          try { price.dispatchEvent(ev); } catch (e) { /* value stands */ }
        }
        filled = true;
      });
      if (!filled) return;
      var amtId = focusSide === "sell" ? "trade-amount-sell" : "trade-amount-buy";
      var amt = doc.getElementById(amtId) || doc.getElementById("trade-amount");
      if (amt && typeof amt.focus === "function") amt.focus();
    } catch (e) { /* read-only desk stands */ }
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

  /* Display-only 6-decimal trim (retro round 2 D1/D8 — same rule as the
   * strip): spread/midpoint come from exact string math but can print 16+
   * decimals; the original shows 6. Pure string truncation at RENDER, the
   * full string stays on the line's title attr. Plain duplicate of the
   * market-ind.js helper (doctrine: duplication over shared abstraction). */
  function trim6(s) {
    s = String(s);
    var m = /^(-?\d+)\.(\d+)$/.exec(s);
    if (m && m[2].length > 6) return m[1] + "." + m[2].slice(0, 6);
    return s;
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
   * verbatim chain-human strings. opts.bare (split cells) skips the inner
   * h3 — the desk cell owns the BUY ORDERS / SELL ORDERS h2 instead.
   * Depth fraction per row comes from
   * Market.depth cumulative totalBase Numbers (pixels, not money — same as
   * the depth chart); the row stores it as --depth for desk-grid.css, which
   * paints ONE absolutely-positioned .depth-bar behind the row text
   * (asks red from the left, bids green from the right —
   * bitshares-ui OrderBook.jsx:176-184). logVol mirrors the depth chart's
   * volume toggle (log widths share its scale so bars and chart agree);
   * absent/false keeps the legacy linear share. Scroll regions + grid live
   * in desk-grid.css (.book-scroll/.book-cards/.book-grid). */
  function renderBookSide(doc, section, title, levels, depthPts, logVol, opts) {
    var isAsk = title === "Asks";
    var bare = !!(opts && opts.bare);
    /* Title doubles as the caller's side key (Asks/Bids drive the depth-bar
     * color below), so the h3 localizes through a static per-side key while
     * `title` itself stays the English logic key. Split cells (bare) skip
     * the h3 — the desk cell's own h2 names the side. */
    var sideWrap = doc.createElement("div");
    sideWrap.className = "book-side " + (isAsk ? "book-asks" : "book-bids");
    section.appendChild(sideWrap);
    if (!bare) {
      sideWrap.appendChild(el(doc, "h3", isAsk ? t("market.asks", "Asks") : t("market.bids", "Bids")));
    }
    if (!levels || levels.length === 0) {
      sideWrap.appendChild(el(doc, "p", t("market.no_prefix", "No ") + title.toLowerCase() + t("market.no_side_suffix", " yet — place one from the Buy/Sell panels below; resting orders list here."), "muted"));
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
        var tot = depthPts[i].totalBase;
        if (logVol) {
          /* Log share: dust stays visible next to whales (same compression
           * as the log-volume chart axis). ln(1+x) keeps 0 at 0%. */
          pct = tot <= 0 ? 0 : (100 * Math.log(1 + tot)) / Math.log(1 + maxTot);
        } else {
          pct = (100 * tot) / maxTot;
        }
        if (!(pct >= 0)) pct = 0;
        if (pct > 100) pct = 100;
      }
      var frac = String(pct) + "%";
      var tr = doc.createElement("tr");
      tr.className = "book-row " + (isAsk ? "book-ask-row" : "book-bid-row");
      try { tr.style.setProperty("--depth", frac); } catch (e) { /* rows render without bars */ }
      /* Punchlist MED: book-row prices trimmed to 6 decimals at RENDER
       * (trim6 above — same rule as the spread line). The chain ships long
       * human strings via price_to_string (market.js header); the full
       * string stays in the price cell's title. */
      var fullPx = (lv.displayPrice !== undefined && lv.displayPrice !== null) ? String(lv.displayPrice) : "";
      var texts = [
        fullPx === "" ? "" : trim6(fullPx),
        lv.quote !== undefined ? String(lv.quote) : "",
        lv.base !== undefined ? String(lv.base) : ""
      ];
      /* Click-to-fill: row price → trade-form price input (keyboard: Enter). */
      try {
        tr.setAttribute("tabindex", "0");
        tr.setAttribute("role", "button");
        tr.setAttribute("aria-label", "Fill price " + String(texts[0]));
        tr.title = "Fill price";
      } catch (e) { /* rows render unclickable */ }
      texts.forEach(function (text, ci) {
        var td = doc.createElement("td");
        /* Price cell (ci 0) carries the side color hook (book-price-bid green
         * / book-price-ask red via desk-grid.css theme tokens) alongside the
         * row-side class — mirrored column order stays AS-IS, raw/title attrs
         * on the row (fill-price title + aria-label) are untouched. */
        td.className = "book-cell" + (ci === 0 ? (isAsk ? " book-price-ask" : " book-price-bid") : "");
        if (ci === 0 && fullPx) td.title = fullPx;
        /* The row's single .depth-bar anchors in the price-side cell
         * (asks: first cell; bids: last cell) so desk-grid.css can grow it
         * across the row from the price side as a full-row cumulative wash
         * (original language: wash proportional to cumulative depth). */
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
      [(fullPx === "" ? "" : trim6(fullPx)), "Amount " + String(lv.quote || ""), "Total " + String(lv.base || "")].forEach(function (text, ci) {
        /* Phone-card price (first div) mirrors the table price color hook. */
        var cd = el(doc, "div", text, "cell-text" + (ci === 0 ? (isAsk ? " book-price-ask" : " book-price-bid") : ""));
        if (ci === 0 && fullPx) cd.title = fullPx;
        card.appendChild(cd);
      });
      cards.appendChild(card);
      /* Click-to-fill wiring (price text is texts[0]); row + card mirror.
       * Ask rows take into the buy panel, bid rows into the sell panel. */
      (function (row, cardEl, priceText) {
        function go() { fillTradePrice(doc, priceText, isAsk ? "buy" : "sell"); }
        try {
          row.addEventListener("click", go);
          row.addEventListener("keydown", function (ev) {
            if (ev && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); go(); }
          });
        } catch (e) { /* rows render unclickable */ }
        try {
          cardEl.setAttribute("tabindex", "0");
          cardEl.setAttribute("role", "button");
          cardEl.setAttribute("aria-label", "Fill price " + String(priceText));
          cardEl.title = "Fill price";
          cardEl.addEventListener("click", go);
          cardEl.addEventListener("keydown", function (ev) {
            if (ev && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); go(); }
          });
        } catch (e) { /* cards render unclickable */ }
      })(tr, card, texts[0]);
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
   * renders Asks + Bids in chain order (best-first, lowest ask on top — same
   * as renderSplit since commit 4adad6b; the old .reverse() here is gone so
   * the pool synth book mimics the exchange book). ctx carries exactly the
   * moved code's free variables: { book, basePrec, quotePrec, baseSymbol,
   * quoteSymbol, spreadLine }. Returns depth so the caller can cache it for
   * charts. */
  function renderBook(doc, parentEl, ctx) {
    while (parentEl.firstChild) parentEl.removeChild(parentEl.firstChild);
    var depth = Market.depth(ctx.book, ctx.basePrec, ctx.quotePrec);
    var bestBid = ctx.book.bids.length > 0 ? ctx.book.bids[0].displayPrice : null;
    /* Chain asks arrive best-first (ascending, lowest on top); levels and
     * depth points stay aligned so each row keeps its own cumulative
     * fraction for the --depth wash. bestAsk is asks[0]. */
    var bestAsk = ctx.book.asks.length > 0 ? ctx.book.asks[0].displayPrice : null;
    var sm = spreadMid(bestBid ? String(bestBid) : null, bestAsk ? String(bestAsk) : null);
    if (sm) {
      ctx.spreadLine.textContent = "Spread " + trim6(sm.spread) + " · Midpoint " + trim6(sm.mid) +
        " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
      try {
        ctx.spreadLine.title = "Spread " + sm.spread + " · Midpoint " + sm.mid +
          " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
      } catch (e) { /* text stands */ }
    } else {
      ctx.spreadLine.textContent = t("market_book.s1", "Spread — (empty book side)");
    }
    /* Sides render into a .book-grid wrapper (desk-grid.css squares the book
     * column); Asks and Bids each own a fixed-height scroll region. */
    var grid = doc.createElement("div");
    grid.className = "book-grid";
    parentEl.appendChild(grid);
    renderBookSide(doc, grid, "Asks", ctx.book.asks, depth.asks, !!ctx.logVol);
    renderBookSide(doc, grid, "Bids", ctx.book.bids, depth.bids, !!ctx.logVol);
    rawDetails(doc, parentEl, t("market.raw_book", "Raw order book"), ctx.book);
    return depth;
  }

  /* Split book fill for the retro 2x3 desk (row 2: BUY ORDERS | SELL ORDERS
   * as two equal cells): same depth computation, same spread header, same
   * row math as renderBook — the ONLY differences are destination (bids into
   * bidsEl, asks into asksEl, both bare since the desk cells own the h2s),
   * the raw-JSON proof landing in the asks cell, and ask ORDER: lowest ask
   * on top (chain order, best-first — no reverse). bestAsk stays asks[0].
   * ctx shape matches renderBook. Returns depth so the caller can cache it
   * for charts. */
  function renderSplit(doc, bidsEl, asksEl, ctx) {
    while (bidsEl.firstChild) bidsEl.removeChild(bidsEl.firstChild);
    while (asksEl.firstChild) asksEl.removeChild(asksEl.firstChild);
    var depth = Market.depth(ctx.book, ctx.basePrec, ctx.quotePrec);
    var bestBid = ctx.book.bids.length > 0 ? ctx.book.bids[0].displayPrice : null;
    /* Asks render in chain order (best-first, lowest on top) — levels and
     * depth points stay aligned so each row keeps its own cumulative
     * fraction for the --depth bar. */
    var bestAsk = ctx.book.asks.length > 0 ? ctx.book.asks[0].displayPrice : null;
    var sm = spreadMid(bestBid ? String(bestBid) : null, bestAsk ? String(bestAsk) : null);
    if (sm) {
      ctx.spreadLine.textContent = "Spread " + trim6(sm.spread) + " · Midpoint " + trim6(sm.mid) +
        " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
      try {
        ctx.spreadLine.title = "Spread " + sm.spread + " · Midpoint " + sm.mid +
          " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
      } catch (e) { /* text stands */ }
    } else {
      ctx.spreadLine.textContent = t("market_book.s1", "Spread — (empty book side)");
    }
    renderBookSide(doc, bidsEl, "Bids", ctx.book.bids, depth.bids, !!ctx.logVol, { bare: true });
    renderBookSide(doc, asksEl, "Asks", ctx.book.asks, depth.asks, !!ctx.logVol, { bare: true });
    rawDetails(doc, asksEl, t("market.raw_book", "Raw order book"), ctx.book);
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
      parentEl.appendChild(el(doc, "p", t("market.no_fills", "No recent fills on this market.") + t("market.fills_hint", " Fills appear once orders match — place one from the Buy/Sell panels."), "muted"));
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
      /* Punchlist MED: fill prices trimmed like book rows (trim6); the full
       * chain string stays in the cell title. */
      var ftd = el(doc, "td", (r.displayPrice === null || r.displayPrice === undefined) ? "—" : trim6(String(r.displayPrice)));
      if (r.displayPrice !== null && r.displayPrice !== undefined) ftd.title = String(r.displayPrice);
      tr.appendChild(ftd);
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
      var fcd = el(doc, "div", (r.displayPrice === null || r.displayPrice === undefined) ? "—" : trim6(String(r.displayPrice)));
      if (r.displayPrice !== null && r.displayPrice !== undefined) fcd.title = String(r.displayPrice);
      card.appendChild(fcd);
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
    renderSplit: renderSplit,
    renderTrades: renderTrades
  };
})();

if (typeof module !== "undefined") { module.exports = MarketBook; }
