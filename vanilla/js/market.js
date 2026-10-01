/* Market: read-only DEX data layer (slice-05 Task 2).
 * Owns: market-id parsing, asset lookup, order-book / fills / ticker /
 *   depth accumulation, my-orders lookup. Candle fetching + normalization
 *   and the live bucket list moved to market-candles.js (slice-18 split —
 *   Market.timeframes/.candles delegate there, API unchanged).
 *   No rendering, no signing, no cancel path (slice 6).
 * Consumes: Chain.db/.history/.call, Format.formatAmount/.formatPrice
 *   (Task-1 BigInt price math), Account.myAccountId (unlocked wallet's
 *   account id), Wallet.isUnlocked/.keys (read-only unlock check).
 * Globals/side effects: exposes global Market only; no DOM, no storage.
 *   One module-level precision cache (asset id -> numeric precision).
 * Created by: building-vanilla-slices skill, slice-05-exchange-read plan Task 2.
 *
 * PRICE ORIENTATION (quote-per-base wording corrected — follow-#1 rule):
 *   Displayed price = marketBase_human / marketQuote_human, where
 *   (quote, base) = parseId split (quote = URL head, base = URL tail).
 *   Proof chain (all verified in-clone):
 *   - MarketID convention QUOTE_BASE: MarketRow.jsx:70
 *     (`marketID = quote.get("symbol") + "_" + base.get("symbol")`);
 *     ExchangeContainer.jsx:19,129-130 splits URL marketID into
 *     quoteAsset=symbols[0], baseAsset=symbols[1].
 *   - Chain calls take (base, quote) = (baseAsset, quoteAsset):
 *     MarketsActions.js subscribeMarket(base, quote) issues get_limit_orders,
 *     get_ticker, subscribe_to_market, get_market_history,
 *     get_fill_order_history all as [base.get("id"), quote.get("id"), ...].
 *   - Store builds LimitOrder(order, assets, market_base=quoteAsset.id):
 *     MarketsStore.js:331. LimitOrder.getPrice = sell_price.toReal(
 *     sell_price.base.id === market_base): MarketClasses.js:527-533.
 *   - Price.toReal(true)=quote_human/base_human (price-pair terms),
 *     toReal(false)=base_human/quote_human: MarketClasses.js:275-284.
 *     Both sell sides normalize to marketBase_human/marketQuote_human.
 *     OrderBook.jsx:78-80,137-139 renders exactly order.getPrice() via
 *     <PriceText price={order.getPrice()} quote={quote} base={base} />.
 *   - Chain agrees: get_order_book price levels use price_to_string
 *     (database_api.cpp get_order_book impl) which computes
 *     base_human/quote_human (util.cpp price_to_string); ticker latest/
 *     bid/ask and trade price strings use the same helper; candle OHLC in
 *     MarketsStore.js:831+ resolves to base_human/quote_human via
 *     utils.get_asset_price(baseAmt, baseAsset, quoteAmt, quoteAsset).
 *   - Task-1 Format.formatPrice(baseRaw, basePrec, quoteRaw, quotePrec)
 *     computes the identical ratio (base_human/quote_human) with BigInt.
 *   So every displayPrice below passes the MARKET-BASE raw first.
 *
 * CHAIN-SHAPE FINDINGS (recorded, not guessed):
 * - get_order_book levels are HUMAN-READABLE strings (price/quote/base via
 *   price_to_string/amount_to_string, database_api.cpp) — NOT raw integers.
 *   They are preserved verbatim; displayPrice = the chain price string
 *   (already base-per-quote, proven above). No Number()/parseFloat touches
 *   them: binary float for money is a bug, not a shortcut.
 * - Raw-integer shapes DO exist for fills (fill_order_operation:
 *   protocol/market.hpp:206-220 — pays/receives/fill_price{base,quote} with
 *   integer amounts + asset_ids; history rows carry it as row.op per
 *   MarketsStore.js:415-435) and candles (bucket *_base/*_quote +
 *   *_volume raw integers, per MarketsStore.js:831-890). Those paths use
 *   Format.formatPrice/formatAmount (BigInt/string math only).
 * - AMBIGUITIES (stated, to be closed by Task-4 live vectors, not guessed):
 *   (a) fill-row envelope: #1 reads row.op.pays/receives (order_history
 *       object); #2 account-history code reads res.op[1].fill_price. trades()
 *       accepts both, preferring row.op.
 *   (b) candle volume: #1 charts quote_volume, #2 uses base_volume; candles()
 *       exposes both plus volume=base-volume human string.
 *   (c) PRICE_PLACES=8 default for BigInt price strings follows #1's
 *       Price.toReal reward (`parseFloat(real.toFixed(8))`,
 *       MarketClasses.js:284); Task-4 vectors pin it.
 */
var Market = (function () {
  "use strict";

  /* Fixed decimals for BigInt-computed price strings (see header (c)). */
  var PRICE_PLACES = 8;

  /* asset id -> numeric precision, filled on demand via get_assets. */
  var _precCache = {};

  /* Exact decimal-string addition (no binary float). Returns trimmed string.
   * Params: a, b non-negative decimal strings ("20.5", "3", "0").
   * Fails: plain Error on non-numeric input (internal helper, not a contract). */
  function _addDec(a, b) {
    var parts;
    function _split(s) {
      s = String(s);
      if (!/^\d+(?:\.\d+)?$/.test(s)) throw new Error("bad decimal: " + s);
      parts = s.split(".");
      return { int: parts[0], frac: parts[1] || "" };
    }
    var x = _split(a), y = _split(b);
    var scale = Math.max(x.frac.length, y.frac.length);
    while (x.frac.length < scale) x.frac += "0";
    while (y.frac.length < scale) y.frac += "0";
    var sum = BigInt(x.int + x.frac) + BigInt(y.int + y.frac);
    var s = sum.toString();
    while (s.length <= scale) s = "0" + s;
    var out = scale === 0 ? s : s.slice(0, s.length - scale) + "." + s.slice(s.length - scale);
    if (scale > 0) {
      out = out.replace(/0+$/, "");
      if (out.charAt(out.length - 1) === ".") out = out.slice(0, -1);
    }
    return out;
  }

  /* True for optional leading "-" followed by digits only (raw-int shape). */
  function _isIntStr(s) {
    return typeof s === "string" && /^-?\d+$/.test(s);
  }

  /* Fail fast with a clear message if Task-1 price math has not landed. */
  function _needPriceMath() {
    if (typeof Format === "undefined" || typeof Format.formatPrice !== "function") {
      throw new Error("format-missing: Format.formatPrice unavailable (slice-05 Task 1)");
    }
  }

  /* Resolve numeric precisions for asset ids, cached. Throws "bad-asset-shape"
   * when any asset is missing or lacks a numeric precision (same contract as
   * Account.balances in vanilla/js/account.js). */
  async function _precisions(ids) {
    var missing = [];
    var i;
    for (i = 0; i < ids.length; i++) {
      if (typeof _precCache[ids[i]] !== "number") missing.push(ids[i]);
    }
    if (missing.length > 0) {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_assets", [missing]);
      for (i = 0; i < missing.length; i++) {
        var r = rows && rows[i];
        if (!r || typeof r.precision !== "number") throw new Error("bad-asset-shape");
        _precCache[missing[i]] = r.precision;
      }
    }
    var out = {};
    for (i = 0; i < ids.length; i++) {
      if (typeof _precCache[ids[i]] !== "number") throw new Error("bad-asset-shape");
      out[ids[i]] = _precCache[ids[i]];
    }
    return out;
  }

  /* Split a QUOTE_BASE market id into uppercase symbols.
   * Params: marketID string like "USD_BTS".
   * Returns: {quote, base} (quote = head, base = tail).
   * Fails: "bad-market" on malformed ids or same-asset pairs. */
  function parseId(marketID) {
    if (typeof marketID !== "string") throw new Error("bad-market");
    var parts = marketID.toUpperCase().split("_");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("bad-market");
    if (parts[0] === parts[1]) throw new Error("bad-market");
    return { quote: parts[0], base: parts[1] };
  }

  /* In-flight asset-pair memo, keyed QUOTE_BASE (perf: desk entry fires
   *   Market.assets plus picker/feed lookups for the same pair in one tick —
   *   one lookup per pair per tick, never two. Pending only: cleared on
   *   settle, nothing completed is cached. Same promise shared, identical. */
  var _assetsPending = {};

  /* Resolve both market assets to {id, symbol, precision} via
   * lookup_asset_symbols (database_api.hpp: lookup path, same call #1's
   * ChainStore uses for quote/base assets). bitasset_data_id rides along
   * (additive — the desk feed reuses it instead of re-looking-up the pair).
   * Fails: "bad-asset-shape" on unknown symbols or non-numeric precision. */
  async function assets(quoteSym, baseSym) {
    var key = String(quoteSym).toUpperCase() + "_" + String(baseSym).toUpperCase();
    if (Object.prototype.hasOwnProperty.call(_assetsPending, key)) {
      return _assetsPending[key];
    }
    var p = _assetsInner(quoteSym, baseSym);
    _assetsPending[key] = p;
    p.then(function () { delete _assetsPending[key]; },
      function () { delete _assetsPending[key]; });
    return p;
  }

  /* Inner pair resolve (unchanged contract — see assets above). */
  async function _assetsInner(quoteSym, baseSym) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "lookup_asset_symbols", [[quoteSym, baseSym]]);
    if (!rows || !rows[0] || !rows[1]) throw new Error("bad-asset-shape");
    if (typeof rows[0].precision !== "number" || typeof rows[1].precision !== "number") {
      throw new Error("bad-asset-shape");
    }
    return {
      quote: { id: rows[0].id, symbol: rows[0].symbol, precision: rows[0].precision,
        bitasset_data_id: rows[0].bitasset_data_id || null },
      base: { id: rows[1].id, symbol: rows[1].symbol, precision: rows[1].precision,
        bitasset_data_id: rows[1].bitasset_data_id || null }
    };
  }

  /* Copy one get_order_book level verbatim (human strings, see header).
   * displayPrice = chain price string (already base-per-quote). */
  function _level(row) {
    row = row || {};
    var price = row.price !== undefined && row.price !== null ? String(row.price) : "";
    return {
      price: price,
      base: row.base !== undefined && row.base !== null ? String(row.base) : "",
      quote: row.quote !== undefined && row.quote !== null ? String(row.quote) : "",
      displayPrice: price,
      raw: row
    };
  }

  /* Fetch the order book (database get_order_book(base, quote, limit),
   * database_api.hpp:636). Empty books are VALID: {bids: [], asks: []}. */
  async function book(baseId, quoteId, limit) {
    if (limit === undefined) limit = 50;
    var dbId = await Chain.db();
    var res = await Chain.call(dbId, "get_order_book", [baseId, quoteId, limit]);
    var bids = [], asks = [], i;
    if (res) {
      if (Array.isArray(res.bids)) {
        for (i = 0; i < res.bids.length; i++) bids.push(_level(res.bids[i]));
      }
      if (Array.isArray(res.asks)) {
        for (i = 0; i < res.asks.length; i++) asks.push(_level(res.asks[i]));
      }
    }
    return { bids: bids, asks: asks };
  }

  /* Accumulate one book side into cumulative depth points (pure function).
   * Numbers are CHART-PIXEL inputs only (never money): priceFloat/totalBase/
   * totalQuote are Number(); totalBaseStr/totalQuoteStr are exact decimal
   * strings for any displayed sums. basePrec/quotePrec are carried per the
   * Task-2 signature (forward-compat for raw-int levels); level math is
   * precision-agnostic exact-decimal addition. */
  function _depthSide(levels, isBid) {
    var pts = [];
    var totBase = "0", totQuote = "0";
    var i, lv;
    for (i = 0; i < levels.length; i++) {
      lv = levels[i] || {};
      totBase = _addDec(totBase, /^\d+(?:\.\d+)?$/.test(String(lv.base)) ? String(lv.base) : "0");
      totQuote = _addDec(totQuote, /^\d+(?:\.\d+)?$/.test(String(lv.quote)) ? String(lv.quote) : "0");
      var px = Number(lv.displayPrice !== undefined ? lv.displayPrice : lv.price);
      pts.push({
        priceFloat: isNaN(px) ? null : px, // pixels only, not money
        totalBase: Number(totBase), // pixels only, not money
        totalQuote: Number(totQuote), // pixels only, not money
        totalBaseStr: totBase, // exact string for displayed sums
        totalQuoteStr: totQuote // exact string for displayed sums
      });
    }
    return pts;
  }

  /* Cumulative depth for charting (pure; empty book yields empty arrays). */
  function depth(bookRes, basePrec, quotePrec) {
    void basePrec;
    void quotePrec;
    bookRes = bookRes || {};
    return {
      bids: _depthSide(Array.isArray(bookRes.bids) ? bookRes.bids : [], true),
      asks: _depthSide(Array.isArray(bookRes.asks) ? bookRes.asks : [], false)
    };
  }

  /* Pick the market-base/quote-denominated raw amounts out of a fill row.
   * Accepts row.op (order_history envelope, #1 MarketsStore.js:415-435) or
   * row.op[1] (account-history tuple, #2 usage); needs fill_price with
   * integer amounts. Returns null when unmappable (documented ambiguity). */
  function _fillPair(row, baseId, quoteId) {
    var op = row ? row.op : null;
    if (Array.isArray(op)) op = op[1];
    if (!op) op = row ? row.fill_price ? { fill_price: row.fill_price } : null : null;
    var fp = op ? op.fill_price : null;
    if (!fp || !fp.base || !fp.quote) return null;
    var bAmt = fp.base.amount !== undefined ? String(fp.base.amount) : null;
    var qAmt = fp.quote.amount !== undefined ? String(fp.quote.amount) : null;
    if (!_isIntStr(bAmt) || !_isIntStr(qAmt)) return null;
    if (fp.base.asset_id === baseId && fp.quote.asset_id === quoteId) {
      return { rawB: bAmt, rawQ: qAmt };
    }
    if (fp.base.asset_id === quoteId && fp.quote.asset_id === baseId) {
      return { rawQ: bAmt, rawB: qAmt };
    }
    return null;
  }

  /* Recent fills (history get_fill_order_history(a, b, limit), api.hpp:212 —
   * history api via Chain.history(), params (base, quote) like #1).
   * Empty histories are VALID ([]). displayPrice/baseAmount/quoteAmount are
   * base-per-quote human strings via BigInt math; null when the row shape is
   * unmappable (see header ambiguity (a)). Fails: "history-unavailable" when
   * the history api is missing (same contract as Account.history). */
  async function trades(baseId, quoteId, limit) {
    if (limit === undefined) limit = 30;
    var histId;
    try {
      histId = await Chain.history();
    } catch (e) {
      throw new Error("history-unavailable");
    }
    var rows;
    try {
      rows = await Chain.call(histId, "get_fill_order_history", [baseId, quoteId, limit]);
    } catch (e) {
      throw new Error("history-unavailable");
    }
    if (!Array.isArray(rows) || rows.length === 0) return [];
    _needPriceMath();
    var precs = await _precisions([baseId, quoteId]);
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var pair = _fillPair(row, baseId, quoteId);
      out.push({
        raw: row,
        time: row.time || row.block_time || null,
        displayPrice: pair ? Format.formatPrice(pair.rawB, precs[baseId], pair.rawQ, precs[quoteId], PRICE_PLACES) : null,
        baseAmount: pair ? Format.formatAmount(pair.rawB, precs[baseId]) : null,
        quoteAmount: pair ? Format.formatAmount(pair.rawQ, precs[quoteId]) : null
      });
    }
    return out;
  }

  /* 24h ticker (database get_ticker(base, quote), database_api.hpp:618).
   * Raw object passes through; latest/highestBid/lowestAsk are the chain's
   * human base-per-quote strings (market_ticker ctor, same helper as the
   * book), null where absent. */
  async function stats(baseId, quoteId) {
    var dbId = await Chain.db();
    var t = await Chain.call(dbId, "get_ticker", [baseId, quoteId]);
    if (!t || typeof t !== "object") throw new Error("bad ticker response");
    return {
      raw: t,
      latest: t.latest !== undefined && t.latest !== null ? String(t.latest) : null,
      highestBid: t.highest_bid !== undefined && t.highest_bid !== null ? String(t.highest_bid) : null,
      lowestAsk: t.lowest_ask !== undefined && t.lowest_ask !== null ? String(t.lowest_ask) : null
    };
  }

  /* Live bucket list + OHLCV candles (slice-18 split): canonical
   * implementation in market-candles.js (MarketCandles). Delegated so the
   * Market.* API and error contracts stay byte-identical. */
  async function timeframes() {
    if (typeof MarketCandles !== "undefined" && MarketCandles &&
        typeof MarketCandles.timeframes === "function") {
      return MarketCandles.timeframes();
    }
    throw new Error("candle backend missing: js/market-candles.js failed to load.");
  }

  /* See the timeframes note above: candles live in market-candles.js.
   * candles() paints chain-first (never waits on ES); deepen() below fetches
   * the background ES backfill once per pair+bucket (lazy-deep, 2026-10-01
   * audit) — the desk calls it after the chain paint, never on polls. */
  async function candles(baseId, quoteId, bucketSec, count) {
    if (typeof MarketCandles !== "undefined" && MarketCandles &&
        typeof MarketCandles.candles === "function") {
      return MarketCandles.candles(baseId, quoteId, bucketSec, count);
    }
    throw new Error("candle backend missing: js/market-candles.js failed to load.");
  }

  /* Background ES backfill (see MarketCandles.deepen): resolves {key, fills}
   * when fresh ES buckets landed for this pair+bucket, null when there is
   * nothing to merge (testnet / already deep / ES down). Never rejects. */
  async function deepen(baseId, quoteId, bucketSec) {
    if (typeof MarketCandles !== "undefined" && MarketCandles &&
        typeof MarketCandles.deepen === "function") {
      return MarketCandles.deepen(baseId, quoteId, bucketSec);
    }
    return null;
  }

  /* Read-only open limit orders for the unlocked wallet's account
   * (database get_limit_orders_by_account(name_or_id, limit),
   * database_api.hpp:495-498). No cancel path — slice 6 owns it.
   * Fails: "wallet-locked" unless unlocked (Wallet.isUnlocked/.keys read
   * only); "no-account" when the active key has no chain reference
   * (via Account.myAccountId, same contract as vanilla/js/account.js). */
  async function myOrders() {
    var unlocked = typeof Wallet !== "undefined" &&
      (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
    if (!unlocked || typeof Wallet === "undefined" || !Wallet.keys) throw new Error("wallet-locked");
    var myId = await Account.myAccountId();
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_limit_orders_by_account", [myId, 100]);
    if (!Array.isArray(rows)) return [];
    return rows;
  }

  return {
    parseId: parseId,
    assets: assets,
    book: book,
    depth: depth,
    trades: trades,
    stats: stats,
    candles: candles,
    deepen: deepen,
    timeframes: timeframes,
    myOrders: myOrders
  };
})();

if (typeof module !== "undefined") { module.exports = Market; }
