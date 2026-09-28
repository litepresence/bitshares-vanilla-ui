/* MarketBook: order-book + recent-trades rendering for the DEX desk.
 * Owns: book side tables/cards with depth shading, spread/midpoint header
 *   text, trades tables/cards with raw-JSON details. No fetching, no timers,
 *   no signing — pure DOM fill from caller-supplied data.
 * Consumes: Market (depth computation only, via global — same as before the
 *   split), Format not needed (chain-human strings render verbatim).
 * Globals/side effects: DOM under the given parent element only; global
 *   MarketBook only. Exact decimal-string math is a private copy of the
 *   market-ui.js helpers (split/add/sub/half/trim: BigInt + digit loops —
 *   binary float never touches money); Number() appears ONLY for depth-bar
 *   widths (pixels, same as before).
 * Created by: building-vanilla-slices skill, slice-05 refactor (market-ui split).
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
   * verbatim chain-human strings; depth shading widths come from Market.depth
   * cumulative Numbers (pixels, not money). */
  function renderBookSide(doc, section, title, levels, depthPts) {
    /* Title doubles as the caller's side key (Asks/Bids drive the depth-bar
     * color below), so the h3 localizes through a static per-side key while
     * `title` itself stays the English logic key. */
    section.appendChild(el(doc, "h3", title === "Asks" ? t("market.asks", "Asks") : t("market.bids", "Bids")));
    if (!levels || levels.length === 0) {
      section.appendChild(el(doc, "p", "No " + title.toLowerCase() + ".", "muted"));
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
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    [t("market.th_price", "Price"), t("market.th_amount", "Amount"), t("market.th_total", "Total")].forEach(function (h) {
      hr.appendChild(el(doc, "th", h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    var cards = doc.createElement("div");
    cards.className = "node-cards";
    var bar = title === "Asks" ? "var(--sell)" : "var(--buy)";
    for (i = 0; i < levels.length; i++) {
      var lv = levels[i] || {};
      var pct = 0; /* width percent: pixel shading from depth Numbers only */
      if (maxTot > 0 && depthPts[i] && typeof depthPts[i].totalBase === "number") {
        pct = (100 * depthPts[i].totalBase) / maxTot;
        if (!(pct >= 0)) pct = 0;
        if (pct > 100) pct = 100;
      }
      var shade = "linear-gradient(90deg, transparent " + String(100 - pct) + "%, " + bar + "33 " + String(100 - pct) + "%)";
      var tr = doc.createElement("tr");
      tr.style.background = shade;
      tr.appendChild(el(doc, "td", lv.displayPrice !== undefined ? String(lv.displayPrice) : ""));
      tr.appendChild(el(doc, "td", lv.quote !== undefined ? String(lv.quote) : ""));
      tr.appendChild(el(doc, "td", lv.base !== undefined ? String(lv.base) : ""));
      tbody.appendChild(tr);
      var card = doc.createElement("div");
      card.className = "node-card";
      card.style.background = shade;
      card.appendChild(el(doc, "div", String(lv.displayPrice || "")));
      card.appendChild(el(doc, "div", "Amount " + String(lv.quote || "")));
      card.appendChild(el(doc, "div", "Total " + String(lv.base || "")));
      cards.appendChild(card);
    }
    table.appendChild(tbody);
    /* Scroll region (matches the original's fixed-height book areas; native
     * overflow, no library): long books scroll in place instead of running
     * down the page. Thead sticks so prices stay labeled while scrolling. */
    var scroller = doc.createElement("div");
    scroller.className = "book-scroll";
    scroller.appendChild(table);
    section.appendChild(scroller);
    section.appendChild(cards);
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
     * display, so bestAsk is asks[0] — NOT asks[last] (that was the worst). */
    var bestAsk = ctx.book.asks.length > 0 ? ctx.book.asks[0].displayPrice : null;
    var sm = spreadMid(bestBid ? String(bestBid) : null, bestAsk ? String(bestAsk) : null);
    if (sm) {
      ctx.spreadLine.textContent = "Spread " + sm.spread + " · Midpoint " + sm.mid +
        " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
    } else {
      ctx.spreadLine.textContent = t("market_book.s1", "Spread — (empty book side)");
    }
    renderBookSide(doc, parentEl, "Asks", ctx.book.asks.slice().reverse(), depth.asks.slice().reverse());
    renderBookSide(doc, parentEl, "Bids", ctx.book.bids, depth.bids);
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
    parentEl.appendChild(table);
    var cards = doc.createElement("div");
    cards.className = "node-cards";
    rows.forEach(function (r) {
      var card = doc.createElement("div");
      card.className = "node-card";
      card.appendChild(el(doc, "div", timeText(r.time)));
      card.appendChild(el(doc, "div", r.displayPrice === null ? "—" : String(r.displayPrice)));
      card.appendChild(el(doc, "div", (r.quoteAmount === null ? "" : String(r.quoteAmount) + " " + ctx.quoteSymbol)));
      cards.appendChild(card);
    });
    parentEl.appendChild(cards);
    rawDetails(doc, parentEl, t("market.raw_fills", "Raw fills"), rows.map(function (r) { return r.raw; }));
  }

  return {
    renderBook: renderBook,
    renderTrades: renderTrades
  };
})();

if (typeof module !== "undefined") { module.exports = MarketBook; }
