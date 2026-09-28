/* PoolHistory: swap-tape history + candles + synthetic CPMM book for pool desks.
 * Owns: swapsForPool (ES adapter with chain fallback), swapsToCandles
 *   (dex-ux discrete_to_candles math, exact money), synthBook (CPMM depth
 *   levels in MarketBook level shape). No DOM, no signing, no storage.
 * Consumes: Chain (db/history/call), Pool.history (chain fallback rows),
 *   Asset.describe (precisions), Format (human strings only). Side effects:
 *   WS calls + one HTTPS POST to the community ES endpoint (adapter: any
 *   failure falls back to chain, never throws outward except "bad pool id").
 *   Global PoolHistory only.
 * Refs: #5 kibana_queries.py:kibana_swaps (op-63 swap query) +
 *   kibana.py:parse_price_history (paid/received orientation) +
 *   discrete_to_candles (bucket OHLCV); #4 liquidity_pool.hpp:138-152
 *   (op-63 fields) + transaction.hpp:292-301 (processed results);
 *   database_api.hpp:182/190 (get_block/get_transaction).
 * Doctrine override (user, 2026-09-28): ES adapter ALLOWED as data source
 *   with chain fallback (written exception to the ES-refused standing rule —
 *   endpoint is data like a node, failure degrades to chain, nothing breaks
 *   when the host disappears).
 * Created by: building-vanilla-slices skill, pool-desk-uniformity plan. */
var PoolHistory = (function () {
  "use strict";

  /* ES endpoint (moved from es.bts.mobi 2026-09-28, 301 -> es.bitshares.dev).
   * Community infra, treated as DATA (node-list class): unreachable/slow/
   * blocked => chain fallback. Never load-bearing. */
  var ES_URL = "https://es.bitshares.dev/bitshares-*/_search";
  var ES_TIMEOUT_MS = 15000;
  var ES_SIZE = 500;

  /* Chain fallback bounds: newest-first block scan, concurrent batches. */
  var SCAN_BATCH = 8;
  var SCAN_MAX_BLOCKS = 2000;

  /* Synth-book slice fractions of reserve (num/den pairs, 0.05%..12%).
   * Integer math only; slices flooring to zero are skipped. */
  var SLICES = [[1, 2000], [1, 1000], [1, 500], [7, 2000], [1, 200],
    [1, 125], [3, 250], [1, 50], [3, 100], [1, 20], [2, 25], [3, 25]];

  function assertPoolId(id) {
    if (typeof id !== "string" || !/^1\.19\.\d+$/.test(id)) throw new Error("bad pool id: " + JSON.stringify(id));
  }

  /* ES query (mirrors #5 kibana_swaps, pool-id match instead of market text):
   * op-63 docs for one pool, newest first. POST (browsers drop GET bodies). */
  function esQuery(poolId) {
    return {
      track_total_hits: false,
      sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
      size: ES_SIZE,
      _source: ["account_history", "operation_history", "operation_type", "block_data"],
      query: {
        bool: {
          filter: [
            { match: { operation_type: "63" } },
            { multi_match: { type: "best_fields", query: poolId, lenient: true } }
          ]
        }
      }
    };
  }

  /* One ES hit -> normalized swap. The ES text match is loose (pool ids
   * tokenize) and the index is mainnet-only — the pool check below is
   * STRICT (missing pool id also rejects) so a testnet desk never charts
   * mainnet swaps. */
  function esSwap(hit, poolId) {
    try {
      var s = hit && hit._source;
      if (!s) return null;
      if (String(s.operation_type) !== "63") return null;
      var oh = s.operation_history || {};
      var obj = oh.op_object || {};
      if (String(obj.pool || "") !== poolId) return null;
      var res = oh.operation_result_object;
      var data = res && res.data_object;
      if (!data || !data.paid || !data.received || !data.paid[0] || !data.received[0]) return null;
      var bd = s.block_data || {};
      return {
        time: bd.block_time || null, block: bd.block_num !== undefined ? bd.block_num : null,
        account: obj.account || null,
        paid: { amount: String(data.paid[0].amount), asset: String(data.paid[0].asset_id) },
        received: { amount: String(data.received[0].amount), asset: String(data.received[0].asset_id) }
      };
    } catch (e) { return null; }
  }

  /* ES adapter: up to ES_SIZE recent swaps, newest first. Rejects on ANY
   * failure (network/CORS/timeout/shape) — the caller falls back to chain. */
  function esSwaps(poolId, limit) {
    assertPoolId(poolId);
    return new Promise(function (resolve, reject) {
      var ctrl = null, timer = null, done = false;
      function fail(e) { if (done) return; done = true; try { clearTimeout(timer); } catch (x) {} try { if (ctrl) ctrl.abort(); } catch (x) {} reject(e); }
      try {
        if (typeof fetch !== "function") { reject(new Error("no fetch")); return; }
        if (typeof AbortController === "function") ctrl = new AbortController();
        timer = setTimeout(function () { fail(new Error("es timeout")); }, ES_TIMEOUT_MS);
        fetch(ES_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(esQuery(poolId)),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (resp) {
          if (!resp || !resp.ok) { fail(new Error("es status " + (resp && resp.status))); return null; }
          return resp.json();
        }).then(function (data) {
          if (done) return;
          done = true;
          try { clearTimeout(timer); } catch (x) {}
          var hits = (data && data.hits && data.hits.hits) || [];
          var out = [];
          for (var i = 0; i < hits.length && out.length < limit; i++) {
            var sw = esSwap(hits[i], poolId);
            if (sw) out.push(sw);
          }
          resolve({ swaps: out, source: "es" });
        }).catch(fail);
      } catch (e) { fail(e); }
    });
  }

  /* Chain fallback: get_liquidity_pool_history rows (op + executed result,
   * proven live 2026-09-28) — newest first already. Pool filter is exact
   * (rows carry .pool). Rows without results are skipped, never guessed. */
  function chainSwaps(poolId, limit) {
    assertPoolId(poolId);
    return Pool.history(poolId, Math.min(500, Math.max(limit, 1))).then(function (rows) {
      var out = [];
      (rows || []).forEach(function (h) {
        if (out.length >= limit) return;
        try {
          var raw = h.raw || {};
          var op = raw.op || {};
          var inner = op.op || [];
          if (inner[0] !== 63) return;
          var body = inner[1] || {};
          if (String(body.pool || raw.pool || "") !== poolId) return;
          var res = (op.result || [])[1] || {};
          if (!res.paid || !res.received || !res.paid[0] || !res.received[0]) return;
          out.push({
            time: h.block_time || raw.time || null, block: op.block_num !== undefined ? op.block_num : null,
            account: body.account || null,
            paid: { amount: String(res.paid[0].amount), asset: String(res.paid[0].asset_id) },
            received: { amount: String(res.received[0].amount), asset: String(res.received[0].asset_id) }
          });
        } catch (e) { /* malformed row skips */ }
      });
      return { swaps: out, source: "chain" };
    });
  }

  /* Leg filter: pool ids AND asset ids collide across chains (1.3.0 is BTS
   * on mainnet, TEST on testnet) — a swap belongs to THIS pool only when
   * both its assets are the pool's legs. Missing legs = no filtering. */
  function filterLegs(swaps, legA, legB) {
    if (!legA || !legB) return swaps;
    return (swaps || []).filter(function (sw) {
      try {
        var p = String(sw.paid.asset), r = String(sw.received.asset);
        var a = String(legA), b = String(legB);
        return (p === a || p === b) && (r === a || r === b) && p !== r;
      } catch (e) { return false; }
    });
  }

  /* swapsForPool: mainnet tries ES first (empty ES page or non-mainnet
   * network goes chain — the community index is mainnet-only, proven
   * 2026-09-28). Chain fallback is authoritative. opts {network, legA,
   * legB}: leg filter applies to BOTH sources. Returns {swaps (newest
   * first), source}. Never rejects except bad pool id / both paths down. */
  function swapsForPool(poolId, limit, opts) {
    assertPoolId(poolId);
    opts = opts || {};
    var lim = limit === undefined ? 100 : limit;
    function legs(swaps) { return filterLegs(swaps, opts.legA, opts.legB); }
    function chain() {
      return chainSwaps(poolId, lim).then(function (res) {
        res.swaps = legs(res.swaps);
        return res;
      });
    }
    if (opts.network && opts.network !== "mainnet") return chain();
    return esSwaps(poolId, lim).then(function (res) {
      res.swaps = legs(res.swaps);
      if (res.swaps.length) return res;
      return chain();
    }).catch(chain);
  }

  /* Price orientation (#5 parse_price_history rule): price is always BUY-leg
   * per SELL-leg in pool-leg terms — legs sort by asset id (a<b consensus),
   * so paid=A&recv=B -> recv/paid, paid=B&recv=A -> paid/recv. Exact BigInt
   * ratio via Format; precisions resolved by the caller. Returns human
   * string or null (zero legs never divide). */
  function priceHuman(sw, precA, precB, assetA, assetB) {
    try {
      var paidA = String(sw.paid.asset) === String(assetA);
      var paidB = String(sw.paid.asset) === String(assetB);
      var recvA = String(sw.received.asset) === String(assetA);
      var recvB = String(sw.received.asset) === String(assetB);
      var num, numPrec, den, denPrec;
      if (paidA && recvB) { num = sw.received.amount; numPrec = precB; den = sw.paid.amount; denPrec = precA; }
      else if (paidB && recvA) { num = sw.paid.amount; numPrec = precB; den = sw.received.amount; denPrec = precA; }
      else return null;
      if (!/^\d+$/.test(String(num)) || !/^\d+$/.test(String(den))) return null;
      if (BigInt(den) <= 0n) return null;
      return Format.formatPrice(String(num), numPrec, String(den), denPrec, 8);
    } catch (e) { return null; }
  }

  /* swapsToCandles: dex-ux discrete_to_candles port. Buckets floor(unix/size);
   * OHLC from first/last/min/max PRICE (ordering uses Number() on human
   * strings, VALUES stay exact strings); volume is BASE-leg (B) flow per
   * bucket — received-B rows add received, paid-B rows add paid — raw ints
   * summed, formatted once. Direction-mixed buckets stay single-unit honest
   * (dex-ux summed mixed received floats; this is stricter). Returns
   * newest-last buckets shaped for MarketInd.maybeDraw ({timeMs,
   * open/high/low/close, baseVolume} human strings). Empty swaps -> []. */
  function swapsToCandles(swaps, bucketSec, assetB, precB) {
    if (!bucketSec || bucketSec <= 0) throw new Error("bad bucket");
    var buckets = {}, k;
    (swaps || []).forEach(function (sw) {
      if (sw.price === null || sw.price === undefined) return;
      var unix = Math.floor(Date.parse(sw.time) / 1000);
      if (!(unix > 0)) return;
      k = Math.floor(unix / bucketSec) * bucketSec;
      /* Oriented leg raws for this swap (B-leg + A-leg, whichever side). */
      var bRaw = null, aRaw = null;
      try {
        if (String(sw.received.asset) === String(assetB) && /^\d+$/.test(String(sw.received.amount))) {
          bRaw = sw.received.amount; aRaw = /^\d+$/.test(String(sw.paid.amount)) ? sw.paid.amount : null;
        } else if (String(sw.paid.asset) === String(assetB) && /^\d+$/.test(String(sw.paid.amount))) {
          bRaw = sw.paid.amount; aRaw = /^\d+$/.test(String(sw.received.amount)) ? sw.received.amount : null;
        }
      } catch (e) { bRaw = null; aRaw = null; }
      var b = buckets[k];
      if (!b) { b = buckets[k] = { n: 0, open: sw.price, high: sw.price, low: sw.price, close: sw.price, volRaw: 0n, vbRaw: "0", vqRaw: "0", hiB: bRaw, hiQ: aRaw, loB: bRaw, loQ: aRaw }; }
      b.n++;
      b.close = sw.price;
      if (Number(sw.price) > Number(b.high)) { b.high = sw.price; b.hiB = bRaw; b.hiQ = aRaw; }
      if (Number(sw.price) < Number(b.low)) { b.low = sw.price; b.loB = bRaw; b.loQ = aRaw; }
      if (bRaw !== null && aRaw !== null) {
        try {
          b.volRaw = b.volRaw + BigInt(bRaw);
          b.vbRaw = (BigInt(b.vbRaw) + BigInt(bRaw)).toString();
          b.vqRaw = (BigInt(b.vqRaw) + BigInt(aRaw)).toString();
        } catch (e) { /* volume skips bad rows */ }
      }
    });
    var keys = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
    return keys.map(function (t) {
      var b = buckets[t];
      var vol = "0";
      try { vol = Format.formatAmount(b.volRaw.toString(), precB); } catch (e) { vol = "0"; }
      return {
        timeMs: t * 1000, open: b.open, high: b.high, low: b.low, close: b.close, baseVolume: vol,
        volumeBaseRaw: b.vbRaw, volumeQuoteRaw: b.vqRaw,
        highBase: b.hiB, highQuote: b.hiQ, lowBase: b.loB, lowQuote: b.loQ
      };
    });
  }

  /* Enrich swaps with the oriented human price (one pass; unknown assets
   * keep a null price and drop from candles, never the tape). Returns the
   * same array (mutated with .price), newest first. */
  function enrich(swaps, assetA, precA, assetB, precB) {
    (swaps || []).forEach(function (sw) {
      sw.price = priceHuman(sw, precA, precB, assetA, assetB);
    });
    return swaps;
  }

  /* synthBook: CPMM depth levels in MarketBook level shape. Quote = leg A,
   * base = leg B (price = B per A, like the desk header SYMA/SYMB).
   * Asks = taker-BUYS-A rows (slices of balB paid, best = cheapest first);
   * bids = taker-SELLS-A rows (slices of balA sold, best = richest first) —
   * so bestAsk/bestBid straddle spot and the spread reads like a resting
   * book. Out = Pool.quote floor math with taker-fee haircut
   * (floor(out*(10000-taker)/10000)). Depth bars accumulate via Market.depth
   * exactly like resting books. Empty/zero reserve -> []. */
  function synthBook(args) {
    args = args || {};
    var balA = BigInt(args.balanceA_raw), balB = BigInt(args.balanceB_raw);
    var precA = args.precA, precB = args.precB;
    var taker = Number(args.taker_units) || 0;
    if (balA <= 0n || balB <= 0n) return { bids: [], asks: [] };
    function side(sellReserve, outReserve, sellPrec, outPrec, sellIsA) {
      var levels = [];
      SLICES.forEach(function (fr) {
        try {
          var sell = (sellReserve * BigInt(fr[0])) / BigInt(fr[1]);
          if (sell <= 0n) return;
          var q = Pool.quote({
            balanceA_raw: balA.toString(), balanceB_raw: balB.toString(),
            sell_raw: sell.toString(), sellIsA: sellIsA
          });
          var out = BigInt(q.out_raw);
          out = (out * BigInt(10000 - taker)) / 10000n;
          if (out <= 0n) return;
          /* Price B-per-A: asks pay B (sellPrec) for A; bids receive B
           * for A sold. Precisions ride their own legs (equal-precision
           * tests can't catch a swap — documented). */
          var price = sellIsA
            ? Format.formatPrice(out.toString(), outPrec, sell.toString(), sellPrec, 8)
            : Format.formatPrice(sell.toString(), sellPrec, out.toString(), outPrec, 8);
          var amtSell = Format.formatAmount(sell.toString(), sellPrec);
          var amtOut = Format.formatAmount(out.toString(), outPrec);
          levels.push({
            price: price, displayPrice: price,
            quote: sellIsA ? amtSell : amtOut,
            base: sellIsA ? amtOut : amtSell,
            _sellRaw: sell.toString()
          });
        } catch (e) { /* slice skips (empty/failed math) */ }
      });
      return levels;
    }
    /* Rows ship best-first like resting books (asks ascending cost,
     * bids descending proceeds): integer-floor dust makes raw slice order
     * non-monotonic at the small end (the chain floors identically) —
     * sorting is presentation order, every row's price stays exact. */
    var asks = side(balB, balA, precB, precA, false);
    var bids = side(balA, balB, precA, precB, true);
    asks.sort(function (a, b) { return Number(a.price) - Number(b.price); });
    bids.sort(function (a, b) { return Number(b.price) - Number(a.price); });
    return { asks: asks, bids: bids };
  }

  return {
    swapsForPool: swapsForPool, chainSwaps: chainSwaps, esSwaps: esSwaps,
    enrich: enrich, priceHuman: priceHuman, swapsToCandles: swapsToCandles,
    synthBook: synthBook, ES_URL: ES_URL,
    _test: { esSwap: esSwap, esQuery: esQuery, filterLegs: filterLegs, SLICES: SLICES }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolHistory === "undefined") { globalThis.PoolHistory = PoolHistory; }
if (typeof module !== "undefined") { module.exports = PoolHistory; }
