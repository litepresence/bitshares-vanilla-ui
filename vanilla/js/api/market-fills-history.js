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

  /* Fixed decimals for BigInt price strings (follows #1 Price.toReal
   * reward `parseFloat(real.toFixed(8))`, MarketClasses.js:284). */
  var PRICE_PLACES = 8;

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

  /* Oriented base-per-quote human price for one fill (Market display rule:
   * base_human / quote_human via BigInt math). Base leg = whichever side
   * carries baseId; quote leg = the other side (strict pair when quoteId
   * given, else single-leg guard). Null when unmappable — never guessed. */
  function priceHuman(fill, baseId, precB, precQ, quoteId) {
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
      return Format.formatPrice(String(bRaw), precB, String(qRaw), precQ, PRICE_PLACES);
    } catch (e) { return null; }
  }

  /* fillsToCandles: discrete datestamp bucketing (dex-ux discrete_to_candles
   * port + upstream slot-match rule: slot = floor(unix/bucket)*bucket).
   * OHLC from the oriented human price (ordering uses Number() on human
   * strings, VALUES stay exact strings); volume is the BASE leg per bucket
   * (raw ints summed, formatted once). Buckets keyed oldest-first
   * (newest-last) shaped for MarketInd.maybeDraw ({timeMs, time slot ISO,
   * open/high/low/close, baseVolume} + raw leg pairs). Empty fills -> []. */
  function fillsToCandles(fills, bucketSec, baseId, precB, precQ, quoteId) {
    if (!bucketSec || Math.floor(bucketSec) <= 0) throw new Error("bad bucket");
    bucketSec = Math.floor(bucketSec);
    var buckets = {};
    (fills || []).forEach(function (f) {
      var price = priceHuman(f, baseId, precB, precQ, quoteId);
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
      if (Number(price) > Number(bk.high)) { bk.high = price; bk.hiB = bRaw; bk.hiQ = qRaw; }
      if (Number(price) < Number(bk.low)) { bk.low = price; bk.loB = bRaw; bk.loQ = qRaw; }
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
    fillsForMarket: fillsForMarket, fillsToCandles: fillsToCandles, mergeDeep: mergeDeep,
    esQuery: esQuery, esFill: esFill, priceHuman: priceHuman,
    chainFills: chainFills, esFills: esFills,
    ES_URL: ES_URL, ES_TIMEOUT_MS: ES_TIMEOUT_MS, ES_SIZE: ES_SIZE,
    ES_MAX_PAGES: ES_MAX_PAGES, ES_MAX_EVENTS: ES_MAX_EVENTS,
    _test: { esQuery: esQuery, esFill: esFill, chainRow: chainRow }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.MarketFills === "undefined") { globalThis.MarketFills = MarketFills; }
if (typeof module !== "undefined") { module.exports = MarketFills; }
