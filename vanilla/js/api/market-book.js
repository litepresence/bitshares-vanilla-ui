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
 *   Format (grouped-book price validation + base/quote sums ONLY — the
 *   ungrouped rows still render chain-human strings verbatim).
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

  /* 4-sig-fig price display (global price rule, Format.priceSig): every
   * DISPLAYED price routes through ps(); the full chain string stays on the
   * cell/line title. Falls back to trim6 when format.js is absent (renders
   * as today, never blank). Display/input split: book-row clicks fill the
   * trade price INPUT with the FULL plain-decimal chain string (parseAmount
   * cannot read sci notation, and trim6 truncation would destroy dust
   * prices) — only the visible text is 4-sf. Amounts, depth sums, grouping
   * keys, and spread/mid MATH stay untouched (ps wraps their display only). */
  function ps(s) {
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.priceSig === "function") return Format.priceSig(s);
    } catch (e) { /* fallback below */ }
    return trim6(s);
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

  /* GROUPED BOOK (desk toggle — client-side price bucketing of the fetched
   * get_order_book levels; NO new WS method, NO refetch, NO ES).
   * Bucketing = floor(price, decimals): "1.056"+"1.051" at 2 decimals share
   * bucket "1.05"; "1.099" at 1 decimal joins "1.0". Floor keeps bids honest
   * (a grouped bid never claims more than its best leg) and asks
   * conservative-symmetrical (documented, same rule both sides).
   * MONEY RULE: all price validation via Format.parsePriceRatio and all
   * base/quote sums via Format.parseAmount/formatAmount round-trips
   * (BigInt, never binary float). Number() never touches these paths.
   * Dust is preserved (sums at the bucket's common scale, never dropped);
   * empty sides yield [] (same contract as the ungrouped book). */

  /* Offered grouping precisions (null = exact/off, the default). */
  var GROUP_DECS = [null, 8, 6, 4, 2];

  /* Frac digits of a validated decimal string ("1.50" -> 2, "3" -> 0). */
  function _fracLen(s) {
    var i = String(s).indexOf(".");
    return i === -1 ? 0 : String(s).length - i - 1;
  }

  /* bucketKey: floor a human price string to `decimals` frac digits.
   * Params: priceStr (non-negative decimal string), decimals (int 0..8).
   * Returns the bucket key padded to exactly `decimals` digits ("1.5" at 2
   * -> "1.50"; "1.056" at 2 -> "1.05"; at 0 -> "1"). Validates the price
   * through Format.parsePriceRatio (money rule — the throw names the bad
   * leg). Throws "bad-group" on non-integer/out-of-range decimals. */
  function bucketKey(priceStr, decimals) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) throw new Error("bad-group");
    var s = String(priceStr);
    if (typeof Format === "undefined" || !Format ||
        typeof Format.parsePriceRatio !== "function") {
      throw new Error("format-missing: Format.parsePriceRatio unavailable");
    }
    Format.parsePriceRatio(s); /* validation only — the key math below is string ops */
    var parts = s.split(".");
    var int = parts[0], frac = parts[1] || "";
    if (decimals === 0) return int;
    var cut = frac.slice(0, decimals);
    while (cut.length < decimals) cut += "0";
    return int + "." + cut;
  }

  /* _sumHuman: exact sum of human decimal strings (bucket totals).
   * Params: strs (array of non-negative decimal strings; bad legs count as
   *   zero — documented in groupLevels, price discovery stands).
   * Returns the trimmed decimal string ("0" for empty). Integer/BigInt
   * string math only: common-scale Format.parseAmount/formatAmount
   * round-trip while the scale fits Format's 0..12 precision window, manual
   * BigInt at native scale above it (chain precisions cap at 12, so the
   * fallback only ever sees exotic price strings — dust-safe either way). */
  function _sumHuman(strs) {
    var clean = [];
    var i, s;
    for (i = 0; i < strs.length; i++) {
      s = String(strs[i]);
      if (/^\d+(?:\.\d+)?$/.test(s)) clean.push(s);
    }
    if (clean.length === 0) return "0";
    var scale = 0;
    for (i = 0; i < clean.length; i++) {
      var fl = _fracLen(clean[i]);
      if (fl > scale) scale = fl;
    }
    function trim(s2) { return trimDec(s2); }
    if (scale <= 12 && typeof Format !== "undefined" && Format &&
        typeof Format.parseAmount === "function" && typeof Format.formatAmount === "function") {
      var total = 0n;
      for (i = 0; i < clean.length; i++) {
        total += BigInt(Format.parseAmount(clean[i], scale));
      }
      return trim(Format.formatAmount(total.toString(), scale));
    }
    /* Exotic-scale fallback: pad frac parts manually, add as BigInt. */
    var tot = 0n;
    for (i = 0; i < clean.length; i++) {
      var p = clean[i].split(".");
      var f = (p[1] || "");
      while (f.length < scale) f += "0";
      tot += BigInt(p[0] + f);
    }
    var digits = tot.toString();
    while (digits.length <= scale) digits = "0" + digits;
    var out = scale === 0 ? digits : digits.slice(0, digits.length - scale) + "." + digits.slice(digits.length - scale);
    return trim(out);
  }

  /* _bucketCmp: ascending compare of bucket-key decimal strings via
   * Format.parsePriceRatio BigInt ratios (never float); unparseable keys
   * sort last, never throw. */
  function _bucketCmp(a, b) {
    try {
      if (typeof Format === "undefined" || !Format ||
          typeof Format.parsePriceRatio !== "function") {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      }
      var ra = Format.parsePriceRatio(String(a)), rb = Format.parsePriceRatio(String(b));
      var left = ra.num * rb.den, right = rb.num * ra.den;
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    } catch (e) {
      var sa = String(a), sb = String(b);
      if (sa === sb) return 0;
      return 1; /* junk sinks, never throws */
    }
  }

  /** groupLevels: bucket one book side to `decimals` places.
   * Params: levels (array of {displayPrice|price, base, quote} human-string
   *   rows — the get_order_book verbatim shapes), decimals (null = exact
   *   copy, else int 0..8), isBid (boolean: true sorts desc, false asc).
   * Returns a NEW array of {price, displayPrice, base, quote, _count}
   * bucket rows (base/quote = exact human sums, price = floor key).
   * Levels with unparseable prices are SKIPPED (junk row dropped, rest
   * stand); bad base/quote legs count as zero inside their bucket.
   * Empty input yields []. Never throws on level data (bad `decimals`
   * throws "bad-group" — caller-validated select values). */
  function groupLevels(levels, decimals, isBid) {
    var list = Array.isArray(levels) ? levels : [];
    if (decimals === undefined || decimals === null) return list.slice();
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) throw new Error("bad-group");
    var buckets = {};
    var order = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var lv = list[i] || {};
      var px = lv.displayPrice !== undefined && lv.displayPrice !== null ? lv.displayPrice : lv.price;
      var key;
      try {
        key = bucketKey(px, decimals);
      } catch (e) { continue; /* junk price row dropped, rest stand */ }
      if (!Object.prototype.hasOwnProperty.call(buckets, key)) {
        buckets[key] = { price: key, displayPrice: key, bases: [], quotes: [], _count: 0 };
        order.push(key);
      }
      var bk = buckets[key];
      bk.bases.push(lv.base !== undefined && lv.base !== null ? String(lv.base) : "0");
      bk.quotes.push(lv.quote !== undefined && lv.quote !== null ? String(lv.quote) : "0");
      bk._count += 1;
    }
    var out = order.map(function (k) {
      var bk2 = buckets[k];
      return {
        price: bk2.price, displayPrice: bk2.displayPrice,
        base: _sumHuman(bk2.bases), quote: _sumHuman(bk2.quotes),
        _count: bk2._count
      };
    });
    out.sort(function (x, y) {
      var c = _bucketCmp(x.price, y.price);
      return isBid ? -c : c;
    });
    return out;
  }

  /** groupBook: bucket both sides ({bids, asks} -> grouped pair).
   * Params: book ({bids, asks} level arrays), decimals (null = exact
   *   copies). Returns {bids, asks}. Empty sides stay []. */
  function groupBook(book, decimals) {
    book = book || {};
    return {
      bids: groupLevels(Array.isArray(book.bids) ? book.bids : [], decimals, true),
      asks: groupLevels(Array.isArray(book.asks) ? book.asks : [], decimals, false)
    };
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
    s.classList.add("subtle-btn");
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

  /* phoneCardsOn: phone-card layouts exist for the <=559px␣layout only
   * (app.css:196-199 — .node-cards display:none above 559px, .node-table
   * hidden below it). Perf: desktop paints skip the hidden card twins.
   * Guarded: no matchMedia (headless/old browsers) means build (today's
   * behavior, never blank). Resize edge: a breakpoint crossing without a
   * book poll keeps the old twin set until the next poll rebuilds (orderbook
   * polls run every few seconds on a live desk, so the stale window is one
   * poll, never permanent). */
  function phoneCardsOn() {
    try {
      if (typeof window !== "undefined" && window && typeof window.matchMedia === "function") {
        return !!window.matchMedia("(max-width: 559px)").matches;
      }
    } catch (e) { /* build below */ }
    return true;
  }

  /* Per-host row cache for keyed reuse (perf, output-identical): host element
   * -> {Asks: {...}, Bids: {...}} -> price key -> row record. Detached rows
   * keep their click/keydown listeners, so repaints attach zero new listeners
   * for resting prices. Stored as an expando on the STABLE host (renderBook's
   * parentEl, renderSplit's bidsEl/asksEl — never the per-paint grid wrapper,
   * which is fresh every call). Fake-doc safe (plain-object expandos). */
  function bookCache(host) {
    try {
      if (host && typeof host === "object") {
        if (!host._bookRowCache || typeof host._bookRowCache !== "object") host._bookRowCache = {};
        return host._bookRowCache;
      }
    } catch (e) { /* fresh map below */ }
    return {};
  }

  /* One side's price->record map out of a host cache (never throws). */
  function sideMap(cache, title) {
    try {
      if (cache && typeof cache === "object") {
        if (!cache[title] || typeof cache[title] !== "object") cache[title] = {};
        return cache[title];
      }
    } catch (e) { /* empty map below */ }
    return {};
  }

  /* DocumentFragment or null (headless fake docs lack it — callers fall back
   * to direct appends, same nodes, same order). */
  function frag(doc) {
    try {
      if (doc && typeof doc.createDocumentFragment === "function") return doc.createDocumentFragment();
    } catch (e) { /* direct appends below */ }
    return null;
  }

  /* Depth-bar width percent for one level (pixel shading from depth Numbers
   * only — money never enters; verbatim extraction of the inline math so the
   * create and update paths share one rule). */
  function depthPct(depthPt, maxTot, logVol) {
    var pct = 0;
    if (maxTot > 0 && depthPt && typeof depthPt.totalBase === "number") {
      var tot = depthPt.totalBase;
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
    return String(pct) + "%";
  }

  /* Create one book-level row record (the ONLY place listeners attach: row
   * click + row keydown + card click + card keydown — 4 per level when cards
   * build, 2 when they don't). The click closure captures the level price;
   * records are keyed by that same price, so a reused record's closure is
   * always current — updates never rewire listeners. Returns {key, tr, amtTx,
   * totTx, priceTd, fullPx, card, cardAmt, cardTot}. */
  function buildLevelRec(doc, isAsk, lv, frac) {
    var fullPx = (lv.displayPrice !== undefined && lv.displayPrice !== null) ? String(lv.displayPrice) : "";
    var texts = [
      fullPx === "" ? "" : ps(fullPx),
      lv.quote !== undefined ? String(lv.quote) : "",
      lv.base !== undefined ? String(lv.base) : ""
    ];
    var tr = doc.createElement("tr");
    tr.className = "book-row " + (isAsk ? "book-ask-row" : "book-bid-row");
    try { tr.style.setProperty("--depth", frac); } catch (e) { /* rows render without bars */ }
    try {
      tr.setAttribute("tabindex", "0");
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", t("market_book.fill_price", "Fill price") + " " + String(texts[0]));
      tr.title = t("market_book.fill_price", "Fill price");
    } catch (e) { /* rows render unclickable */ }
    var spans = [];
    var priceTd = null;
    texts.forEach(function (text, ci) {
      var td = doc.createElement("td");
      td.className = "book-cell" + (ci === 0 ? (isAsk ? " book-price-ask" : " book-price-bid") : "");
      if (ci === 0 && fullPx) td.title = fullPx;
      if (ci === 0) priceTd = td;
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
      spans.push(tx);
    });
    var rec = {
      key: fullPx, tr: tr, amtTx: spans[1], totTx: spans[2],
      priceTd: priceTd, fullPx: fullPx, card: null, cardAmt: null, cardTot: null
    };
    /* Click-to-fill wiring (the INPUT gets the FULL plain-decimal chain
     * price — never the 4-sf display text, which sci notation would make
     * unparsable and trim6 would truncate); row + card mirror.
     * Ask rows take into the buy panel, bid rows into the sell panel. */
    (function (row, priceText) {
      function go() { fillTradePrice(doc, priceText, isAsk ? "buy" : "sell"); }
      try {
        row.addEventListener("click", go);
        row.addEventListener("keydown", function (ev) {
          if (ev && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); go(); }
        });
      } catch (e) { /* rows render unclickable */ }
    })(tr, fullPx === "" ? texts[0] : fullPx);
    return rec;
  }

  /* Build the phone-card twin for a record (the remaining 2 of the 4
   * listeners); called at creation on phones, or lazily when a later poll
   * finds the breakpoint flipped phone-ward. Same nodes/order as before. */
  function buildLevelCard(doc, isAsk, rec, lv) {
    var fullPx = rec.fullPx;
    var card = doc.createElement("div");
    card.className = "node-card book-row-card " + (isAsk ? "book-ask-row" : "book-bid-row");
    try {
      var cur = null;
      try { cur = rec.tr.style.getPropertyValue("--depth"); } catch (e2) { cur = null; }
      card.style.setProperty("--depth", cur || "0%");
    } catch (e) { /* cards render without bars */ }
    var cbar = doc.createElement("span");
    cbar.className = "depth-bar " + (isAsk ? "bar-ask" : "bar-bid");
    cbar.setAttribute("aria-hidden", "true");
    card.appendChild(cbar);
    var divs = [];
    [(fullPx === "" ? "" : ps(fullPx)), "Amount " + String((lv && lv.quote) || ""), "Total " + String((lv && lv.base) || "")].forEach(function (text, ci) {
      /* Phone-card price (first div) mirrors the table price color hook. */
      var cd = el(doc, "div", text, "cell-text" + (ci === 0 ? (isAsk ? " book-price-ask" : " book-price-bid") : ""));
      if (ci === 0 && fullPx) cd.title = fullPx;
      card.appendChild(cd);
      divs.push(cd);
    });
    rec.card = card;
    rec.cardAmt = divs[1];
    rec.cardTot = divs[2];
    (function (cardEl, priceText) {
      function go() { fillTradePrice(doc, priceText, isAsk ? "buy" : "sell"); }
      try {
        cardEl.setAttribute("tabindex", "0");
        cardEl.setAttribute("role", "button");
        cardEl.setAttribute("aria-label", t("market_book.fill_price", "Fill price") + " " + String(priceText));
        cardEl.title = t("market_book.fill_price", "Fill price");
        cardEl.addEventListener("click", go);
        cardEl.addEventListener("keydown", function (ev) {
          if (ev && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); go(); }
        });
      } catch (e) { /* cards render unclickable */ }
    })(card, (rec.fullPx === "" ? "" : rec.fullPx));
    return card;
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
   * in desk-grid.css (.book-scroll/.book-cards/.book-grid).
   * PERF (output-identical): rows are keyed by price and reused across polls
   * (buildLevelRec/buildLevelCard above attach the 4 listeners exactly once;
   * repaints update textContent/--depth in place and reorder via one
   * synchronous fragment append = one paint). Rendered nodes, order, attrs,
   * and listener behavior match the old clear+rebuild path exactly; only
   * node identity and listener churn differ (unobservable). opts.cache
   * carries the host's side map (renderBook/renderSplit pass the STABLE
   * host's map — never the per-paint wrapper's). */
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
    /* Keyed row pass: reuse records by price, update amount/total/--depth in
     * place, collect in level order into fragments, single append per
     * container (one paint — all writes are synchronous). */
    var wantCards = phoneCardsOn();
    var cache = (opts && opts.cache && typeof opts.cache === "object") ? opts.cache : bookCache(section);
    var map = sideMap(cache, title);
    /* Cache hygiene: a side churning through hundreds of distinct prices
     * drops its map and rebuilds once instead of pinning dead nodes. */
    try {
      if (Object.keys(map).length > 600) {
        try { delete cache[title]; } catch (e2) { cache[title] = {}; }
        map = sideMap(cache, title);
      }
    } catch (e) { /* map stands */ }
    var seen = {};
    var tFrag = frag(doc), cFrag = wantCards ? frag(doc) : null;
    var cards = wantCards ? doc.createElement("div") : null;
    if (wantCards) cards.className = "node-cards book-cards";
    for (i = 0; i < levels.length; i++) {
      var lv = levels[i] || {};
      var pxKey = (lv.displayPrice !== undefined && lv.displayPrice !== null) ? String(lv.displayPrice) : "";
      /* Duplicate prices in one side share the key namespace with a suffix
       * (aggregated books never duplicate, so this path is cold). */
      var key = pxKey, dup = 1;
      while (Object.prototype.hasOwnProperty.call(seen, key)) { dup++; key = pxKey + "#" + dup; }
      seen[key] = true;
      var frac = depthPct(depthPts[i], maxTot, logVol);
      var rec = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
      if (!rec || !rec.tr) {
        rec = buildLevelRec(doc, isAsk, lv, frac);
        rec.key = key;
        map[key] = rec;
      } else {
        /* Same price key => same price text/title/aria (derived from the
         * key); only amount/total/depth move. Listeners stand untouched. */
        try { rec.tr.style.setProperty("--depth", frac); } catch (e) { /* rows render without bars */ }
        rec.amtTx.textContent = lv.quote !== undefined ? String(lv.quote) : "";
        rec.totTx.textContent = lv.base !== undefined ? String(lv.base) : "";
      }
      if (wantCards) {
        if (!rec.card) buildLevelCard(doc, isAsk, rec, lv);
        else {
          try { rec.card.style.setProperty("--depth", frac); } catch (e) { /* cards render without bars */ }
          rec.cardAmt.textContent = "Amount " + String(lv.quote || "");
          rec.cardTot.textContent = "Total " + String(lv.base || "");
        }
      } else if (rec.card) {
        /* Desktop paint: drop the hidden twin (rebuilt lazily on flip). */
        rec.card = null;
        rec.cardAmt = null;
        rec.cardTot = null;
      }
      if (tFrag) tFrag.appendChild(rec.tr);
      else tbody.appendChild(rec.tr);
      if (wantCards) {
        if (cFrag) cFrag.appendChild(rec.card);
        else cards.appendChild(rec.card);
      }
    }
    /* Evict prices that left the book (listeners GC with the nodes). */
    try {
      Object.keys(map).forEach(function (k) { if (!seen[k]) delete map[k]; });
    } catch (e) { /* stale records age out via the 600-cap above */ }
    if (tFrag) tbody.appendChild(tFrag);
    table.appendChild(tbody);
    /* Scroll region (matches the original's fixed-height book areas; native
     * overflow, no library): long books scroll in place instead of running
     * down the page. Thead sticks so prices stay labeled while scrolling. */
    var scroller = doc.createElement("div");
    scroller.className = "book-scroll";
    scroller.appendChild(table);
    sideWrap.appendChild(scroller);
    if (wantCards && cards) {
      if (cFrag) cards.appendChild(cFrag);
      sideWrap.appendChild(cards);
    }
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
      ctx.spreadLine.textContent = t("market_book.spread_prefix", "Spread ") + ps(sm.spread) + " · Midpoint " + ps(sm.mid) +
        " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
      try {
        ctx.spreadLine.title = t("market_book.spread_prefix", "Spread ") + sm.spread + " · Midpoint " + sm.mid +
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
    /* Keyed row cache lives on the STABLE parent (the per-paint grid above
     * is fresh every call, so caching on it would never hit). */
    var rc = bookCache(parentEl);
    renderBookSide(doc, grid, "Asks", ctx.book.asks, depth.asks, !!ctx.logVol, { cache: rc });
    renderBookSide(doc, grid, "Bids", ctx.book.bids, depth.bids, !!ctx.logVol, { cache: rc });
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
      ctx.spreadLine.textContent = t("market_book.spread_prefix", "Spread ") + ps(sm.spread) + " · Midpoint " + ps(sm.mid) +
        " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
      try {
        ctx.spreadLine.title = t("market_book.spread_prefix", "Spread ") + sm.spread + " · Midpoint " + sm.mid +
          " (" + ctx.baseSymbol + " per " + ctx.quoteSymbol + ")";
      } catch (e) { /* text stands */ }
    } else {
      ctx.spreadLine.textContent = t("market_book.s1", "Spread — (empty book side)");
    }
    renderBookSide(doc, bidsEl, "Bids", ctx.book.bids, depth.bids, !!ctx.logVol, { bare: true, cache: bookCache(bidsEl) });
    renderBookSide(doc, asksEl, "Asks", ctx.book.asks, depth.asks, !!ctx.logVol, { bare: true, cache: bookCache(asksEl) });
    rawDetails(doc, asksEl, t("market.raw_book", "Raw order book"), ctx.book);
    return depth;
  }

  /* Trades section fill (moved verbatim from the MarketUI fill trades
   * handler): table + phone cards from fill rows, raw fills JSON. ctx carries
   * exactly the moved code's free variables: { rows, quoteSymbol }. Empty
   * markets get the muted sentence, never a blank panel.
   * PERF (output-identical): fill rows are keyed (time|price|amount) and
   * reused across polls via the stable parent's cache (same expando as the
   * book sides, under the "Trades" side key); repaints update textContent in
   * place and land through one synchronous fragment append. Phone cards obey
   * the same <=559px guard as the book sides. */
  function renderTrades(doc, parentEl, ctx) {
    var rows = ctx.rows;
    while (parentEl.firstChild) parentEl.removeChild(parentEl.firstChild);
    if (!rows || rows.length === 0) {
      parentEl.appendChild(el(doc, "p", t("market.no_fills", "No recent fills on this market.") + t("market.fills_hint", " Fills appear once orders match — place one from the Buy/Sell panels."), "muted"));
      /* Honest tape empty state too (same guarded mount as below). */
      mountTape(doc, parentEl, []);
      return;
    }
    var wantCards = phoneCardsOn();
    var tMap = sideMap(bookCache(parentEl), "Trades");
    try {
      if (Object.keys(tMap).length > 600) {
        var tc = bookCache(parentEl);
        try { delete tc.Trades; } catch (e2) { tc.Trades = {}; }
        tMap = sideMap(tc, "Trades");
      }
    } catch (e) { /* map stands */ }
    var tSeen = {};
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    [t("market.th_time", "Time"), t("market.th_price", "Price"), t("market.th_amount", "Amount")].forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    var tFrag = frag(doc), cFrag = wantCards ? frag(doc) : null;
    var cards = wantCards ? doc.createElement("div") : null;
    if (wantCards) cards.className = "node-cards trades-cards";
    rows.forEach(function (r) {
      /* Punchlist MED: fill prices read 4-sf (global price rule); the full
       * chain string stays in the cell title. */
      var priceShown = (r.displayPrice === null || r.displayPrice === undefined) ? "—" : ps(String(r.displayPrice));
      var priceFull = (r.displayPrice === null || r.displayPrice === undefined) ? null : String(r.displayPrice);
      var amtShown = (r.quoteAmount === null ? "" : String(r.quoteAmount) + " " + ctx.quoteSymbol);
      var tKey = timeText(r.time) + " " + String(priceFull === null ? "—" : priceFull) + " " + amtShown;
      var dup = 1, k = tKey;
      while (Object.prototype.hasOwnProperty.call(tSeen, k)) { dup++; k = tKey + "#" + dup; }
      tSeen[k] = true;
      var rec = Object.prototype.hasOwnProperty.call(tMap, k) ? tMap[k] : null;
      if (!rec || !rec.tr) {
        var tr = doc.createElement("tr");
        var timeTd = el(doc, "td", timeText(r.time));
        var ftd = el(doc, "td", priceShown);
        if (priceFull !== null) ftd.title = priceFull;
        var atd = el(doc, "td", amtShown);
        tr.appendChild(timeTd);
        tr.appendChild(ftd);
        tr.appendChild(atd);
        rec = { tr: tr, timeTd: timeTd, priceTd: ftd, amtTd: atd, card: null, cardTime: null, cardPrice: null, cardAmt: null };
        tMap[k] = rec;
      } else {
        /* Same key => same time/price/amount strings; rewrite verbatim
         * (covers the "—" vs value flip when a fill's legs resolve). */
        rec.timeTd.textContent = timeText(r.time);
        rec.priceTd.textContent = priceShown;
        if (priceFull !== null) rec.priceTd.title = priceFull;
        rec.amtTd.textContent = amtShown;
      }
      if (tFrag) tFrag.appendChild(rec.tr);
      else tbody.appendChild(rec.tr);
      if (wantCards) {
        if (!rec.card) {
          var card = doc.createElement("div");
          card.className = "node-card";
          var cTime = el(doc, "div", timeText(r.time));
          var fcd = el(doc, "div", priceShown);
          if (priceFull !== null) fcd.title = priceFull;
          var cAmt = el(doc, "div", amtShown);
          card.appendChild(cTime);
          card.appendChild(fcd);
          card.appendChild(cAmt);
          rec.card = card;
          rec.cardTime = cTime;
          rec.cardPrice = fcd;
          rec.cardAmt = cAmt;
        } else {
          rec.cardTime.textContent = timeText(r.time);
          rec.cardPrice.textContent = priceShown;
          if (priceFull !== null) rec.cardPrice.title = priceFull;
          rec.cardAmt.textContent = amtShown;
        }
        if (cFrag) cFrag.appendChild(rec.card);
        else cards.appendChild(rec.card);
      } else if (rec.card) {
        rec.card = null;
        rec.cardTime = null;
        rec.cardPrice = null;
        rec.cardAmt = null;
      }
    });
    try {
      Object.keys(tMap).forEach(function (k) { if (!tSeen[k]) delete tMap[k]; });
    } catch (e) { /* stale records age out via the 600-cap above */ }
    if (tFrag) tbody.appendChild(tFrag);
    table.appendChild(tbody);
    /* Fixed-height scroll region (desk-grid.css: 15-row fold, sticky thead);
     * fills scroll in place like the original market-history list. */
    var scroller = doc.createElement("div");
    scroller.className = "trades-scroll";
    scroller.appendChild(table);
    parentEl.appendChild(scroller);
    if (wantCards && cards) {
      if (cFrag) cards.appendChild(cFrag);
      parentEl.appendChild(cards);
    }
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
    renderTrades: renderTrades,
    groupLevels: groupLevels,
    groupBook: groupBook,
    bucketKey: bucketKey,
    GROUP_DECS: GROUP_DECS,
    _test: { groupLevels: groupLevels, groupBook: groupBook, bucketKey: bucketKey }
  };
})();

if (typeof module !== "undefined") { module.exports = MarketBook; }
