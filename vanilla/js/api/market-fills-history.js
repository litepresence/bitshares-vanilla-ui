/* MarketFills: ES fill tape (op-4) + local bucketing + deep merge for DEX candles.
 * Owns: esQuery/esFill (kibana_fills adapter), esFills/chainFills/fillsForMarket
 *   (ES with chain fallback), fillsToCandles (discrete datestamp bucketing),
 *   mergeDeep (chain-wins overlap merge, cap slice). No DOM, no signing.
 * Consumes: Chain.history/.call (single chain-facing module), Format.formatPrice
 *   /.formatAmount (BigInt money math only). Side effects: WS calls + one
 *   HTTPS POST to the community ES endpoint via HistoryCap.esSearch (the
 *   ONLY raw-ES seam: pref-gated, index-allowlisted; any failure falls back
 *   to chain, never throws outward except bad ids / bad bucket / bad count).
 *   Global MarketFills only.
 * Provenance (PORT THE MATH, never import):
 *   - Query shape: #5 kibana_queries.py:kibana_fills (op-4 + both-leg
 *     multi_match + is_maker:false text, size, block_time desc sort).
 *   - Orientation: #5 kibana.py:parse_price_history (paid/received leg rule,
 *     B-per-A style) + #1 MarketClasses.js FillOrder (op.pays/receives).
 *   - Bucketing: #5 kibana.py:discrete_to_candles slot grid
 *     floor(unix/size); QTradeX qtradex/public/klines_bitshares.py
 *     `interpolate_previous` slot-match rule (0 <= gridTs - dataTs < period
 *     == floor grouping) and miss rule (volume 0, O/H/L/C = prev close;
 *     first slot uses first close). Gap-fill itself lives in MarketCandles
 *     (prev-close carry, same rule); this file buckets discrete fills only.
 *     Empty input stays [] (upstream falls back to rpc_last — we do NOT
 *     guess; the caller shows the honest empty state).
 *   - NOT ported: upstream `normalize` wick-clamping (bot outlier filter;
 *     the wallet shows chain truth, never clipped wicks).
 *   - Chain contract: #4 api.hpp:212 get_fill_order_history(a, b, limit).
 * Doctrine override (user, 2026-09-28): ES adapter ALLOWED as data source
 *   with chain fallback (endpoint is data like a node URL; failure degrades
 *   to chain, nothing breaks when the host disappears).
 * Created by: building-vanilla-slices skill, deep-candles plan Task 1. */
var MarketFills = (function () {
  "use strict";

  /* Community ES endpoint (moved from es.bts.mobi 2026-09-28).
   * DATA, not dependency: unreachable/slow/blocked => chain fallback.
   * INFORMATIONAL since the HistoryCap migration: HistoryCap.esSearch owns
   * the host (ES_BASE) and builds this same URL; kept exported for compat. */
  var ES_URL = "https://es.bitshares.dev/bitshares-*/_search";
  var ES_TIMEOUT_MS = 15000;
  var ES_SIZE = 500;
  /* Capped pagination: 500/page, max 2 pages = 1000 events (deep:CANDLES
   * window is 200 buckets — 1000 fills cover it generously; the 4-page/2000
   * cap measured ~3MB per fill (762KB/page on 1.19.2, 672KB on BTS_CNY,
   * 2026-10-01) and no caller needs 2000 events for 200 buckets.
   * Pattern: reference/bitshares-historical-charts main.js:214-261
   * (queryElasticsearchWithPagination — search_after loop, short-page stop).
   * Our _source query bodies stay; only the search_after + cap + total
   * budget are ported. Foreground never waits on ES (lazy-deep: candles
   * paint chain-first, this adapter runs background-only via deepen). */
  var ES_MAX_PAGES = 2;
  var ES_MAX_EVENTS = 1000;

  /* Deep-window walk (2026-10-08 audit — "the chart stops at June").
   *
   * WHY: the caps above bound EVENTS, not TIME. 1000 newest fills is
   * however much wall-clock that happens to be — for a quiet pair a few
   * days, so a 2000-candle request could never be served no matter what the
   * timeframe was (BTS/CNY 1h measured 1623 of 2000; 1D 1502; 1W 575 —
   * the ES side could never go deeper than its 1000 fills).
   *
   * HOW (reference pattern — squidKid-deluxe/BitShares-Historical-Charts
   * books.js + main.js:214-261): compute the span the candles need
   * (bucket * count), push it into the query as a block_data.block_time
   * RANGE, and page with search_after until that SPAN IS COVERED rather
   * than until an event count runs out.
   *
   * ES_DEEP_SIZE is 10000 because that is the index's hard ceiling:
   * measured 2026-10-08, `size: 20000` returns HTTP 200 with ZERO hits —
   * a silent data-loss trap. Depth is bought with paging, never size.
   *
   * Budgets stay bounded and honest: page/event ceilings plus a wall clock,
   * and `capped` marks a walk that ended before coverage so the caller can
   * SAY the window was truncated. Foreground never waits on this
   * (lazy-deep: candles paint chain-first, this runs background-only). */
  var ES_DEEP_SIZE = 10000;
  var ES_DEEP_MAX_PAGES = 8;
  var ES_DEEP_MAX_EVENTS = 80000;
  /* 60s, not the shallow adapter's 15s: a wide request (2000 weekly candles
   * = years of fills) is legitimately slow background work. It stays lazy,
   * cancellable and disclosed, and callers paint every page as it lands
   * (opts.onPage) so the chart GROWS while the walk runs. */
  var ES_DEEP_TIMEOUT_MS = 60000;

  /* Fixed decimals for BigInt price strings (follows #1 Price.toReal
   * reward `parseFloat(real.toFixed(8))`, MarketClasses.js:284). Kept as the
   * empty/zero-only fallback — live ES candles use the magnitude-aware places
   * below (4 sig figs, satoshi-scale fix, same rule as MarketCandles). */
  var PRICE_PLACES = 8;

  /* Ceiling for magnitude-aware places (see MarketCandles.SIGFIG_MAX —
   * duplicated plain code keeps this file self-contained, same convention
   * as the precision-cache split). */
  var SIGFIG_MAX = 12;

  /* Magnitude-aware places for already-human price strings (Number for
   * magnitude only, never money). Falls back to PRICE_PLACES when the
   * formatter is absent or the set is empty/zero-only. Never throws. */
  function _sigPlaces(humans) {
    try {
      if (typeof Format !== "undefined" && Format &&
          typeof Format.sigFigPlaces === "function") {
        var p = Format.sigFigPlaces(humans);
        if (Number.isInteger(p) && p >= 0 && p <= 18) return p > SIGFIG_MAX ? SIGFIG_MAX : p;
      }
    } catch (e) { /* fallback stands */ }
    return PRICE_PLACES;
  }

  /* True for digit-only raw-int strings (unsigned; amounts are >= 0). */
  function _isIntStr(s) {
    return typeof s === "string" && /^\d+$/.test(s);
  }

  /* Fail fast on malformed market ids (both legs required, 1.3.x shape). */
  function assertMarketIds(baseId, quoteId) {
    if (typeof baseId !== "string" || !/^1\.3\.\d+$/.test(baseId)) {
      throw new Error("bad base id: " + JSON.stringify(baseId));
    }
    if (typeof quoteId !== "string" || !/^1\.3\.\d+$/.test(quoteId)) {
      throw new Error("bad quote id: " + JSON.stringify(quoteId));
    }
  }

  /* ES query (mirrors #5 kibana_fills, text-match form): op-4 docs matching
   * BOTH legs plus taker-only (is_maker:false avoids double-counting each
   * match's maker+taker sides), newest first. POST (browsers drop bodies
   * on GET). Legs are asset symbols when known, else asset ids — the index
   * tokenizes both (pool-id text query proven live 2026-09-28).
   * searchAfter (optional): ES sort key from the previous page's last hit
   * (.sort on block_data.block_time desc) — capped pagination stays on the
   * same sort the adapter already uses. */
  function esQuery(baseSym, quoteSym, searchAfter) {
    var q = {
      track_total_hits: false,
      sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
      size: ES_SIZE,
      _source: ["account_history", "operation_history", "operation_type", "block_data"],
      query: {
        bool: {
          filter: [
            { match: { operation_type: "4" } },
            { multi_match: { type: "best_fields", query: String(baseSym), lenient: true } },
            { multi_match: { type: "best_fields", query: String(quoteSym), lenient: true } },
            { multi_match: { type: "best_fields", query: "operation_history.op_object.is_maker : false", lenient: true } }
          ]
        }
      }
    };
    if (searchAfter) q.search_after = searchAfter;
    return q;
  }

  /* Deep-window query: esQuery + the block_data.block_time RANGE that makes
   * the window WIDE instead of shallow, and ES_DEEP_SIZE per page. Range
   * bounds are ISO strings on the same field the query already sorts on (so
   * it is mapped); `format: strict_date_optional_time` mirrors the reference
   * books.js. startMs = window floor, searchAfter = previous page's last
   * sort (verbatim). */
  function esQueryDeep(baseSym, quoteSym, startMs, searchAfter) {
    var q = {
      track_total_hits: false,
      sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
      size: ES_DEEP_SIZE,
      _source: ["account_history", "operation_history", "operation_type", "block_data"],
      query: {
        bool: {
          filter: [
            { match: { operation_type: "4" } },
            { multi_match: { type: "best_fields", query: String(baseSym), lenient: true } },
            { multi_match: { type: "best_fields", query: String(quoteSym), lenient: true } },
            { multi_match: { type: "best_fields", query: "operation_history.op_object.is_maker : false", lenient: true } },
            {
              range: {
                "block_data.block_time": {
                  format: "strict_date_optional_time",
                  gte: _iso(startMs),
                  lte: _iso(Date.now())
                }
              }
            }
          ]
        }
      }
    };
    if (searchAfter) q.search_after = searchAfter;
    return q;
  }

  /* epoch ms -> ISO string (search bounds only; a non-numeric value reads
   * as epoch, which ES treats as "no floor" rather than an error). */
  function _iso(ms) {
    var n = Number(ms);
    if (!isFinite(n)) return new Date(0).toISOString();
    return new Date(n).toISOString();
  }

  /* One ES hit -> normalized fill {time, paid, received} or null. The ES
   * text match is loose and the index is mainnet-only, so the leg check is
   * STRICT (missing/wrong legs reject) — a testnet desk never charts
   * mainnet fills. Accepts op_object with pays/receives, or [4, body]
   * tuple envelopes on either op_object or op (index shape drift). */
  function esFill(hit, baseId, quoteId) {
    try {
      var s = hit && hit._source;
      if (!s) return null;
      if (String(s.operation_type) !== "4") return null;
      var oh = s.operation_history || {};
      var obj = oh.op_object || null;
      if (Array.isArray(obj) && obj.length >= 2) obj = obj[1];
      if (!obj || !obj.pays || !obj.receives) {
        var alt = oh.op;
        if (Array.isArray(alt) && alt.length >= 2) obj = alt[1];
      }
      if (!obj || !obj.pays || !obj.receives) return null;
      var pays = obj.pays, recv = obj.receives;
      var pAmt = String(pays.amount), rAmt = String(recv.amount);
      var pA = String(pays.asset_id), rA = String(recv.asset_id);
      if (!_isIntStr(pAmt) || !_isIntStr(rAmt)) return null;
      var b = String(baseId), q = String(quoteId);
      if (!((pA === b || pA === q) && (rA === b || rA === q) && pA !== rA)) return null;
      var bd = s.block_data || {};
      return {
        time: bd.block_time || null,
        block: (bd.block_num !== undefined && bd.block_num !== null) ? bd.block_num : null,
        account: (obj.account_id !== undefined && obj.account_id !== null) ? String(obj.account_id)
          : ((obj.account !== undefined && obj.account !== null) ? String(obj.account) : null),
        paid: { amount: pAmt, asset: pA },
        received: { amount: rAmt, asset: rA }
      };
    } catch (e) { return null; }
  }

  /* HistoryCap seam (the ONLY raw-ES path — direct fetch here is FORBIDDEN
   * by the centralization rule). Classic-script global in the browser
   * (typeof-guarded, load-order agnostic — index.html loads this file BEFORE
   * history-cap.js); lazy require() under node so unit tests resolve the same
   * seam with no global preload. Missing everywhere => null, and esFills
   * rejects to the chain path (never a direct fetch). */
  /* _historyCap: the HistoryCap seam (single ES gateway). Browser: the
   *   classic-script global (call-time lookup — load order agnostic).
   *   Node suites: globalThis.HistoryCap preloaded by the test harness.
   *   No require() here: checkJs runs browser libs (TS2591), and shipped
   *   code must not know about module loaders. Null => caller goes chain. */
  function _historyCap() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.esSearch === "function") return HistoryCap;
    } catch (e) {}
    try {
      if (typeof globalThis !== "undefined" && globalThis.HistoryCap && typeof globalThis.HistoryCap.esSearch === "function") return globalThis.HistoryCap;
    } catch (e) {}
    return null;
  }

  /* esOn: community-ES pref gate. False => user disabled ES (skip ES
   * entirely). Missing HistoryCap reads as ON here — esFills then rejects
   * via _historyCap and the caller still lands on chain (fail closed). */
  function _esOn() {
    try {
      var HC = _historyCap();
      if (HC && typeof HC.esAllowed === "function") return HC.esAllowed() !== false;
    } catch (e) {}
    return true;
  }

  /* ES adapter: up to `limit` recent fills, newest first (capped at 1000 —
   * the deep-candle window is 200 buckets). Capped search_after pagination:
   * 500/page, max 2 pages = 1000 raw events; strict leg guards apply per
   * stops early when a page returns <500 raw hits or the want is reached.
   * 15s TOTAL budget across pages (one deadline — each page gets the
   * REMAINDER via esSearch opts). Transport is HistoryCap.esSearch; the
   * query bodies are the byte-identical esQuery DSL below. Rejects on ANY
   * failure (es-disabled/es-unavailable/shape/missing seam) — the caller
   * falls back to chain. */
  function esFills(baseId, quoteId, limit) {
    assertMarketIds(baseId, quoteId);
    var want = limit === undefined ? ES_SIZE : Math.floor(limit);
    if (!(want >= 1)) want = ES_SIZE;
    if (want > ES_MAX_EVENTS) want = ES_MAX_EVENTS;
    return new Promise(function (resolve, reject) {
      var done = false;
      var deadline = Date.now() + ES_TIMEOUT_MS;
      function fail(e) {
        if (done) return; done = true;
        reject(e instanceof Error ? e : new Error("es-unavailable"));
      }
      function finish(out) {
        if (done) return; done = true;
        resolve({ fills: out, source: "es" });
      }
      try {
        var HC = _historyCap();
        if (!HC) { fail(new Error("no history-cap")); return; }
        var out = [];
        var searchAfter = null;
        var pages = 0;
        function fetchPage() {
          if (done) return;
          if (pages >= ES_MAX_PAGES || out.length >= want) { finish(out); return; }
          var remain = deadline - Date.now();
          if (remain <= 0) { fail(new Error("es timeout")); return; }
          var q = esQuery(baseId, quoteId, searchAfter);
          HC.esSearch("bitshares-*", q, { timeoutMs: remain }).then(function (data) {
            if (done) return;
            var hits = (data && data.hits && data.hits.hits) || [];
            for (var i = 0; i < hits.length && out.length < want; i++) {
              var f = esFill(hits[i], baseId, quoteId);
              if (f) out.push(f);
            }
            pages++;
            if (hits.length < ES_SIZE || out.length >= want || pages >= ES_MAX_PAGES) { finish(out); return; }
            var last = hits[hits.length - 1];
            if (!last || !last.sort) { finish(out); return; }
            searchAfter = last.sort;
            fetchPage();
          }).catch(fail);
        }
        fetchPage();
      } catch (e) { fail(e); }
    });
  }

  /* esFillsWindow: deep-window ES walk for candles that need TIME, not a
   * fixed event count. coverSec = the span the candles must cover
   * (bucket * count), so the walk pages until the oldest fetched fill is at
   * least that far back instead of stopping at 1000 events.
   * Resolves {fills (newest first), source:"es", pages, capped}; `capped`
   * means a budget ended the walk before coverage (the caller discloses it),
   * false means full coverage or an exhausted range (both complete).
   * Coverage is measured from the PARSED fills' own .time, never from the
   * hit's `sort` value: on the live index sort[0] is epoch MILLIS
   * (measured 2026-10-08) and Date.parse() of that is NaN.
   * Rejects only on seam/shape failure (caller falls back to chain); a
   * mid-walk page failure keeps what was already fetched. */
  function esFillsWindow(baseId, quoteId, coverSec, opts) {
    assertMarketIds(baseId, quoteId);
    opts = opts || {};
    var coverMs = Math.floor(Number(coverSec) * 1000);
    if (!(coverMs > 0)) coverMs = 0;
    var maxPages = opts.maxPages ? Math.floor(Number(opts.maxPages)) : ES_DEEP_MAX_PAGES;
    if (!(maxPages >= 1)) maxPages = ES_DEEP_MAX_PAGES;
    var maxEvents = opts.maxEvents ? Math.floor(Number(opts.maxEvents)) : ES_DEEP_MAX_EVENTS;
    if (!(maxEvents >= 1)) maxEvents = ES_DEEP_MAX_EVENTS;
    var budgetMs = opts.timeoutMs ? Math.floor(Number(opts.timeoutMs)) : ES_DEEP_TIMEOUT_MS;
    if (!(budgetMs > 0)) budgetMs = ES_DEEP_TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
      var done = false;
      var deadline = Date.now() + budgetMs;
      var out = [];
      var searchAfter = null;
      var pages = 0;
      var capped = false;
      var oldestMs = null;
      function finish() {
        if (done) return; done = true;
        /* Final hand-off: the last page's paint above plus the terminal
         * flags (capped = the walk ended on a budget, not on coverage). */
        if (typeof opts.onPage === "function") {
          try { opts.onPage({ fills: out.slice(), pages: pages, capped: capped, done: true }); } catch (e) { /* painter is optional */ }
        }
        resolve({ fills: out, source: "es", pages: pages, capped: capped });
      }
      function fail(e) {
        if (done) return; done = true;
        reject(e instanceof Error ? e : new Error("es-unavailable"));
      }
      /* Coverage reached? Only a real, parsed, strictly older fill counts —
       * an unparseable time must never end the walk with a false "full". */
      function covered() {
        return coverMs > 0 && oldestMs !== null && (Date.now() - oldestMs) >= coverMs;
      }
      try {
        var HC = _historyCap();
        if (!HC) { fail(new Error("no history-cap")); return; }
        var startMs = Date.now() - coverMs;
        function fetchPage() {
          if (done) return;
          if (pages >= maxPages || out.length >= maxEvents) { capped = true; finish(); return; }
          if (covered()) { finish(); return; }
          var remain = deadline - Date.now();
          if (remain <= 0) { capped = out.length > 0; finish(); return; }
          HC.esSearch("bitshares-*", esQueryDeep(baseId, quoteId, startMs, searchAfter), { timeoutMs: remain }).then(function (data) {
            if (done) return;
            var hits = (data && data.hits && data.hits.hits) || [];
            for (var i = 0; i < hits.length && out.length < maxEvents; i++) {
              var f = esFill(hits[i], baseId, quoteId);
              if (!f || !f.time) continue;
              out.push(f);
              var t = Date.parse(f.time);
              if (isFinite(t) && (oldestMs === null || t < oldestMs)) oldestMs = t;
            }
            pages++;
            /* Progressive paint (2026-10-08): hand the caller what we have
             * after EVERY page so the chart deepens while the walk runs —
             * a 2000-candle window can take minutes, and showing it only at
             * the end means staring at a short chart the whole time. */
            if (typeof opts.onPage === "function") {
              try { opts.onPage({ fills: out.slice(), pages: pages, capped: false, done: false }); } catch (e) { /* painter is optional */ }
            }
            if (hits.length < ES_DEEP_SIZE) { finish(); return; }
            if (out.length >= maxEvents) { capped = true; finish(); return; }
            var last = hits[hits.length - 1];
            if (!last || !last.sort) { capped = true; finish(); return; }
            searchAfter = last.sort;
            fetchPage();
          }).catch(function (e) {
            /* Mid-walk failure keeps the pages already paid for; page 1
             * failure rejects so the caller can fall back to chain. */
            if (out.length) { capped = true; finish(); }
            else fail(e);
          });
        }
        fetchPage();
      } catch (e) { fail(e); }
    });
  }

  /* One chain row (order_history object: op.pays/receives + time) ->
   * normalized fill or null. Maker fills skip (same rule as #1
   * MarketsStore activeMarketHistory: taker-only, no double-count). */
  function chainRow(row, baseId, quoteId) {
    try {
      var op = row ? row.op : null;
      if (Array.isArray(op)) op = op[1];
      if (!op || !op.pays || !op.receives) return null;
      if (op.is_maker === true) return null;
      var pAmt = String(op.pays.amount), rAmt = String(op.receives.amount);
      var pA = String(op.pays.asset_id), rA = String(op.receives.asset_id);
      if (!_isIntStr(pAmt) || !_isIntStr(rAmt)) return null;
      var b = String(baseId), q = String(quoteId);
      if (!((pA === b || pA === q) && (rA === b || rA === q) && pA !== rA)) return null;
      return {
        time: row.time || row.block_time || null,
        account: (op.account_id !== undefined && op.account_id !== null) ? String(op.account_id) : null,
        order: (op.order_id !== undefined && op.order_id !== null) ? String(op.order_id) : null,
        paid: { amount: pAmt, asset: pA },
        received: { amount: rAmt, asset: rA }
      };
    } catch (e) { return null; }
  }

  /* Chain fallback: get_fill_order_history (api.hpp:212), newest first.
   * Empty history is VALID ([]). Rejects only when the history api is down. */
  function chainFills(baseId, quoteId, limit) {
    assertMarketIds(baseId, quoteId);
    return Chain.history().then(function (histId) {
      return Chain.call(histId, "get_fill_order_history", [baseId, quoteId, limit]);
    }).then(function (rows) {
      var out = [];
      (rows || []).forEach(function (row) {
        if (out.length >= limit) return;
        var f = chainRow(row, baseId, quoteId);
        if (f) out.push(f);
      });
      return { fills: out, source: "chain" };
    });
  }

  /* fillsForMarket: mainnet tries ES first (empty ES page goes chain — the
   * community index is mainnet-only); any non-mainnet network goes chain
   * directly, as does pref-off (esEnabled false skips ES entirely — the
   * chain label below already covers it, no new copy). Returns {fills
   * (newest first), source}. Never rejects except bad ids / both paths down. */
  function fillsForMarket(baseId, quoteId, limit, opts) {
    assertMarketIds(baseId, quoteId);
    opts = opts || {};
    var lim = limit === undefined ? 100 : limit;
    function chain() { return chainFills(baseId, quoteId, lim); }
    if (opts.network && opts.network !== "mainnet") return chain();
    if (!_esOn()) return chain();
    return esFills(baseId, quoteId, lim).then(function (res) {
      if (res.fills.length) return res;
      return chain();
    }).catch(chain);
  }

  /* fillsForMarketWindow: fillsForMarket's deep twin — same mainnet /
   * ES-pref contract, but the ES side walks until coverSec of HISTORY is in
   * hand (esFillsWindow) instead of until 1000 events run out. Chain
   * fallback stays the authority and stays shallow (get_fill_order_history
   * is capped by the node); the window is an ES-only enrichment, exactly as
   * the deepen path was before. Resolves {fills, source, pages, capped};
   * never rejects except bad ids / both paths down. */
  function fillsForMarketWindow(baseId, quoteId, coverSec, opts) {
    assertMarketIds(baseId, quoteId);
    opts = opts || {};
    var lim = opts.chainLimit === undefined ? 100 : opts.chainLimit;
    function chain() {
      return chainFills(baseId, quoteId, lim).then(function (res) {
        res.pages = 0;
        res.capped = false;
        return res;
      });
    }
    if (opts.network && opts.network !== "mainnet") return chain();
    if (!_esOn()) return chain();
    return esFillsWindow(baseId, quoteId, coverSec, opts).then(function (res) {
      if (res.fills.length) return res;
      return chain();
    }).catch(chain);
  }

  /* Oriented base-per-quote human price for one fill (Market display rule:
   * base_human / quote_human via BigInt math). Base leg = whichever side
   * carries baseId; quote leg = the other side (strict pair when quoteId
   * given, else single-leg guard). Null when unmappable — never guessed.
   * Params: (fill, baseId, precB, precQ, quoteId, places?) — places defaults
   * to PRICE_PLACES (backward compat); fillsToCandles passes the
   * magnitude-aware value so ES buckets read like chain candles. */
  function priceHuman(fill, baseId, precB, precQ, quoteId, places) {
    try {
      var paid = fill.paid, recv = fill.received;
      if (!paid || !recv) return null;
      var pA = String(paid.asset), rA = String(recv.asset);
      var b = String(baseId);
      var bRaw = null, qRaw = null;
      if (quoteId !== undefined && quoteId !== null) {
        var q = String(quoteId);
        if (pA === b && rA === q) { bRaw = paid.amount; qRaw = recv.amount; }
        else if (pA === q && rA === b) { bRaw = recv.amount; qRaw = paid.amount; }
        else return null;
      } else {
        if (pA === b && rA !== b) { bRaw = paid.amount; qRaw = recv.amount; }
        else if (rA === b && pA !== b) { bRaw = recv.amount; qRaw = paid.amount; }
        else return null;
      }
      if (!_isIntStr(String(bRaw)) || !_isIntStr(String(qRaw))) return null;
      if (BigInt(String(qRaw)) <= 0n) return null;
      var pl = (Number.isInteger(places) && places >= 0 && places <= 18) ? places : PRICE_PLACES;
      return Format.formatPrice(String(bRaw), precB, String(qRaw), precQ, pl);
    } catch (e) { return null; }
  }

  /* cmpPrice: exact human-decimal-string compare via Format.parsePriceRatio
   * cross-multiplication (BigInt, never Number — WHY: binary float ties
   * "12345678.12345679" vs "12345678.12345678" (16 significant digits over
   * the 53-bit mantissa), freezing whichever wicked first and hiding the true
   * high/low; a.num/a.den vs b.num/b.den <=> a.num*b.den vs b.num*a.den is
   * exact for any decimal places. Equal-places zero-padded string compare
   * would agree — cross-multiply needs no padding step.
   * @param {string} a first human price. @param {string} b second human price.
   * @returns {number} 1 when a is higher, -1 when lower, 0 when equal or when
   *   either leg is unparseable (fail-open: first-seen wick stands, same rule
   *   as the volume skip below). Pure. */
  function cmpPrice(a, b) {
    try {
      var r1 = Format.parsePriceRatio(String(a));
      var r2 = Format.parsePriceRatio(String(b));
      var left = r1.num * r2.den, right = r2.num * r1.den;
      if (left > right) return 1;
      if (left < right) return -1;
      return 0;
    } catch (e) { return 0; }
  }

  /* fillsToCandles: discrete datestamp bucketing (dex-ux discrete_to_candles
   * port + upstream slot-match rule: slot = floor(unix/bucket)*bucket).
   * OHLC from the oriented human price (ordering uses cmpPrice exact BigInt
   * cross-multiplication, VALUES stay exact strings); volume is the BASE leg
   * per bucket (raw ints summed, formatted once). Buckets keyed oldest-first
   * (newest-last) shaped for MarketInd.maybeDraw ({timeMs, time slot ISO,
   * open/high/low/close, baseVolume} + raw leg pairs). Empty fills -> []. */
  function fillsToCandles(fills, bucketSec, baseId, precB, precQ, quoteId) {
    if (!bucketSec || Math.floor(bucketSec) <= 0) throw new Error("bad bucket");
    bucketSec = Math.floor(bucketSec);
    /* Satoshi-scale (4 sig figs): probe all fill prices at SIGFIG_MAX
     * (human strings via BigInt; Number measures magnitude only), choose
     * places once, then bucket at that precision. Empty/zero-only falls
     * back to PRICE_PLACES (renders as today). */
    var places = PRICE_PLACES;
    try {
      var probe = [];
      (fills || []).forEach(function (f) {
        var p = priceHuman(f, baseId, precB, precQ, quoteId, SIGFIG_MAX);
        if (p !== null && p !== undefined) probe.push(p);
      });
      places = _sigPlaces(probe);
    } catch (e) { places = PRICE_PLACES; }
    var buckets = {};
    (fills || []).forEach(function (f) {
      var price = priceHuman(f, baseId, precB, precQ, quoteId, places);
      if (price === null || price === undefined) return;
      var unix = Math.floor(Date.parse(f.time) / 1000);
      if (!(unix > 0)) return;
      var k = Math.floor(unix / bucketSec) * bucketSec;
      var bRaw = null, qRaw = null;
      try {
        var b = String(baseId);
        if (String(f.paid.asset) === b) { bRaw = f.paid.amount; qRaw = f.received.amount; }
        else if (String(f.received.asset) === b) { bRaw = f.received.amount; qRaw = f.paid.amount; }
        if (!_isIntStr(String(bRaw)) || !_isIntStr(String(qRaw))) { bRaw = null; qRaw = null; }
      } catch (e) { bRaw = null; qRaw = null; }
      var bk = buckets[k];
      if (!bk) {
        bk = buckets[k] = {
          n: 0, open: price, high: price, low: price, close: price,
          volRaw: 0n, vbRaw: "0", vqRaw: "0",
          hiB: bRaw, hiQ: qRaw, loB: bRaw, loQ: qRaw
        };
      }
      bk.n++;
      bk.close = price;
      if (cmpPrice(price, bk.high) > 0) { bk.high = price; bk.hiB = bRaw; bk.hiQ = qRaw; }
      if (cmpPrice(price, bk.low) < 0) { bk.low = price; bk.loB = bRaw; bk.loQ = qRaw; }
      if (bRaw !== null && qRaw !== null) {
        try {
          bk.volRaw = bk.volRaw + BigInt(bRaw);
          bk.vbRaw = (BigInt(bk.vbRaw) + BigInt(bRaw)).toString();
          bk.vqRaw = (BigInt(bk.vqRaw) + BigInt(qRaw)).toString();
        } catch (e) { /* volume skips bad rows */ }
      }
    });
    var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
    return keys.map(function (t) {
      var bk = buckets[t];
      var vol = "0";
      try { vol = Format.formatAmount(bk.volRaw.toString(), precB); } catch (e) { vol = "0"; }
      return {
        timeMs: t * 1000,
        time: new Date(t * 1000).toISOString().slice(0, -5),
        open: bk.open, high: bk.high, low: bk.low, close: bk.close, baseVolume: vol,
        volumeBaseRaw: bk.vbRaw, volumeQuoteRaw: bk.vqRaw,
        highBase: bk.hiB, highQuote: bk.hiQ, lowBase: bk.loB, lowQuote: bk.loQ
      };
    });
  }

  /* fillsToPoints: raw fills -> discrete scatter points (Discrete timescale).
   * Same orientation/volume contract as fillsToCandles (priceHuman legs,
   * base-leg volume) but NO bucketing, NO merging: every mappable fill is
   * one point, same-second fills stay separate (dex-ux plotlyChart parity —
   * the Discrete radio routes away from candle renderers into per-fill
   * markers, reference/bitshares-dex-ux/main.js chartHandler).
   * Params: fills (newest-first, chainFills/fillsForMarket shape), baseId,
   *   precB/precQ numeric precisions, quoteId, cap (1..5000 integer, the
   *   shared candle-count input — the newest cap entries survive, painted
   *   oldest-first). Returns oldest-first [{timeMs, price, volume (base-leg
   *   human), volumeBaseRaw, volumeQuoteRaw, volumeQuote (quote-leg human),
   *   accountId (filler 1.2.x or null), orderId (1.7.x or null), blockNum
   *   (ES rows only, else null)}]. Empty fills are VALID ([]).
   * Malformed fills (bad time, unmappable legs, zero quote) are skipped,
   * never reject. Throws "bad-count" on a non-integer cap < 1.
   * Pure except Format (BigInt money math only); Number() never touches money. */
  function fillsToPoints(fills, baseId, precB, precQ, quoteId, cap) {
    if (cap === undefined) cap = 2000;
    cap = Math.floor(cap);
    if (!(cap >= 1)) throw new Error("bad-count");
    var list = Array.isArray(fills) ? fills.slice(0, cap) : [];
    var places = PRICE_PLACES;
    try {
      var probe = [];
      list.forEach(function (f) {
        var p = priceHuman(f, baseId, precB, precQ, quoteId, SIGFIG_MAX);
        if (p !== null && p !== undefined) probe.push(p);
      });
      places = _sigPlaces(probe);
    } catch (e) { places = PRICE_PLACES; }
    var newest = [];
    list.forEach(function (f) {
      var price = priceHuman(f, baseId, precB, precQ, quoteId, places);
      if (price === null || price === undefined) return;
      var unix = Math.floor(Date.parse(f && f.time) / 1000);
      if (!(unix > 0)) return;
      var bRaw = null, qRaw = null;
      try {
        var b = String(baseId), qid = String(quoteId);
        var pA = String(f.paid.asset), rA = String(f.received.asset);
        if (pA === b && rA === qid) { bRaw = String(f.paid.amount); qRaw = String(f.received.amount); }
        else if (pA === qid && rA === b) { bRaw = String(f.received.amount); qRaw = String(f.paid.amount); }
        if (!_isIntStr(String(bRaw)) || !_isIntStr(String(qRaw))) { bRaw = null; qRaw = null; }
      } catch (e) { bRaw = null; qRaw = null; }
      if (bRaw === null || qRaw === null) return;
      var vol = "0", volQ = "0";
      try { vol = Format.formatAmount(bRaw, precB); } catch (e) { vol = "0"; }
      try { volQ = Format.formatAmount(qRaw, precQ); } catch (e) { volQ = "0"; }
      newest.push({ timeMs: unix * 1000, price: price, volume: vol, volumeBaseRaw: bRaw, volumeQuoteRaw: qRaw,
        volumeQuote: volQ,
        accountId: (f && f.account !== undefined && f.account !== null) ? String(f.account) : null,
        orderId: (f && f.order !== undefined && f.order !== null) ? String(f.order) : null,
        blockNum: (f && f.block !== undefined && f.block !== null) ? f.block : null });
    });
    newest.reverse();
    return newest;
  }

  /* mergeDeep: ES backfill under chain authority. Keyed on timeMs; chain
   * wins every overlap (fresher + authoritative); result sorted ascending,
   * sliced to the last `cap` (default 2000). Pure. */
  function mergeDeep(chainBuckets, esBuckets, cap) {
    if (cap === undefined) cap = 2000;
    cap = Math.floor(cap);
    if (!(cap >= 1)) throw new Error("bad-count");
    var byMs = {};
    (esBuckets || []).forEach(function (e) {
      if (e && typeof e.timeMs === "number") byMs[e.timeMs] = e;
    });
    (chainBuckets || []).forEach(function (c) {
      if (c && typeof c.timeMs === "number") byMs[c.timeMs] = c;
    });
    var keys = Object.keys(byMs).map(Number).sort(function (a, b) { return a - b; });
    var out = keys.map(function (k) { return byMs[k]; });
    if (out.length > cap) out = out.slice(out.length - cap);
    return out;
  }

  return {
    fillsForMarket: fillsForMarket, fillsToCandles: fillsToCandles, fillsToPoints: fillsToPoints, mergeDeep: mergeDeep,
    esQuery: esQuery, esFill: esFill, priceHuman: priceHuman,
    chainFills: chainFills, esFills: esFills,
    fillsForMarketWindow: fillsForMarketWindow, esFillsWindow: esFillsWindow,
    ES_URL: ES_URL, ES_TIMEOUT_MS: ES_TIMEOUT_MS, ES_SIZE: ES_SIZE,
    ES_MAX_PAGES: ES_MAX_PAGES, ES_MAX_EVENTS: ES_MAX_EVENTS,
    ES_DEEP_SIZE: ES_DEEP_SIZE, ES_DEEP_MAX_PAGES: ES_DEEP_MAX_PAGES,
    ES_DEEP_MAX_EVENTS: ES_DEEP_MAX_EVENTS, ES_DEEP_TIMEOUT_MS: ES_DEEP_TIMEOUT_MS,
    _test: { esQuery: esQuery, esQueryDeep: esQueryDeep, esFill: esFill, chainRow: chainRow }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.MarketFills === "undefined") { globalThis.MarketFills = MarketFills; }
if (typeof module !== "undefined") { module.exports = MarketFills; }
