/* PoolHistory: swap-tape history + candles + synthetic CPMM book for pool desks.
 * Owns: swapsForPool (ES adapter with chain fallback), swapsToCandles
 *   (dex-ux discrete_to_candles math, exact money), synthBook (CPMM depth
 *   levels in MarketBook level shape). No DOM, no signing, no storage.
 * Consumes: Chain (db/history/call), Pool.history (chain fallback rows),
 *   Asset.describe (precisions), Format (human strings only). Side effects:
 *   WS calls + one HTTPS POST to the community ES endpoint via
 *   HistoryCap.esSearch (the ONLY raw-ES seam: pref-gated,
 *   index-allowlisted; any failure falls back to chain, never throws
 *   outward except "bad pool id").
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
   * blocked => chain fallback. Never load-bearing.
   * INFORMATIONAL since the HistoryCap migration: HistoryCap.esSearch owns
   * the host (ES_BASE) and builds this same URL; kept exported for compat. */
  var ES_URL = "https://es.bitshares.dev/bitshares-*/_search";
  var ES_TIMEOUT_MS = 15000;
  var ES_SIZE = 500;
  /* Capped pagination: 500/page, max 2 pages = 1000 events (pool chart
   * window is 200 buckets — 1000 swaps cover it; the 4-page/2000 cap
   * measured ~3MB per fill, 2026-10-01). Pattern:
   * reference/bitshares-historical-charts main.js:214-261
   * (queryElasticsearchWithPagination — search_after loop, short-page stop).
   * Our _source query bodies stay; only the search_after + cap + total
   * budget are ported. Foreground never waits on ES (lazy-deep: pool desk
   * paints chain-first, this adapter runs background-only). */
  var ES_MAX_PAGES = 2;
  var ES_MAX_EVENTS = 1000;

  /* Deep-window walk (2026-10-08 audit — the "chart stops at June" bug).
   *
   * WHY: the caps above bound EVENTS, not TIME. A 1000-event newest-first
   * walk on a sparse pool spans only months — measured on pool 1.19.2:
   * 1000 swaps covered 2026-05-19..2026-10-08 (142 days), so a 2000-daily
   * candle request painted ~140 candles and stopped, on EVERY timeframe,
   * because the window never widened. The index actually holds 69,722
   * swaps for that pool back to 2021-04-18 (measured 2026-10-08).
   *
   * HOW (reference pattern — squidKid-deluxe/BitShares-Historical-Charts
   * pools.js:2-49 + main.js:214-261): compute the span the request needs
   * (bucket * count), push it into the query as a block_data.block_time
   * RANGE, and page with search_after until the SPAN IS COVERED rather
   * than until an event count runs out.
   *
   * ES_DEEP_SIZE is 10000 because that is the index's hard ceiling:
   * measured 2026-10-08, `size: 20000` returns HTTP 200 with ZERO hits —
   * a silent data loss trap, so depth is bought with paging, never size.
   *
   * Budgets keep it honest and bounded: ES_DEEP_MAX_PAGES (80k events),
   * ES_DEEP_MAX_EVENTS, ES_DEEP_TIMEOUT_MS wall clock. Hitting one sets
   * `capped` so the chart can SAY the window was truncated instead of
   * pretending the pool only ever traded that much. Foreground never waits
   * on this (lazy-deep: chain paint first, walk in background). */
  var ES_DEEP_SIZE = 10000;
  var ES_DEEP_MAX_PAGES = 8;
  var ES_DEEP_MAX_EVENTS = 80000;
  /* 60s, not the shallow adapter's 15s: a wide request (2000 daily candles
   * on an active pool = 60k+ swaps, measured 2026-10-08) is legitimately
   * minutes of background work. It stays lazy, cancellable and disclosed,
   * and callers paint every page as it lands (opts.onPage), so the chart
   * GROWS while the walk runs instead of sitting short until the end. */
  var ES_DEEP_TIMEOUT_MS = 60000;

  /* Fixed decimals for BigInt-computed price strings (follows #1's
   * Price.toReal reward — `parseFloat(real.toFixed(8))`,
   * MarketClasses.js:284). Kept as the default — sub-satoshi tapes use the
   * magnitude-aware places below (4 sig figs, same rule as MarketCandles and
   * MarketFills; pool 1.19.58 proved fixed-8 collapses a 5% move at 2e-8 to
   * one flat "0.00000002" candle). */
  var PRICE_PLACES = 8;

  /* Ceiling for magnitude-aware places (see MarketCandles.SIGFIG_MAX —
   * duplicated plain code keeps this file self-contained, same convention
   * as the market-fills split). */
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
   * op-63 docs for one pool, newest first. POST (browsers drop GET bodies).
   * searchAfter (optional): ES sort key from the previous page's last hit
   * (.sort on block_data.block_time desc) — capped pagination stays on the
   * same sort the adapter already uses. */
  function esQuery(poolId, searchAfter) {
    var q = {
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
    if (searchAfter) q.search_after = searchAfter;
    return q;
  }

  /* Deep-window query: esQuery + the block_data.block_time RANGE that makes
   * the window WIDE instead of shallow, and ES_DEEP_SIZE per page.
   * Range bounds are ISO strings (the same field/sort the shallow query
   * already uses, so it is mapped — `format: strict_date_optional_time`
   * mirrors the reference pools.js:32-38). Narrow _source: the deep walk
   * only ever reads op_object + operation_result_object + block_data, and
   * dropping account_history halves the page (measured 2026-10-08: 2.05MB
   * vs 4.11MB per 10k-hit page, 100% parse rate either way).
   * startMs (optional): floor of the window. searchAfter (optional): the
   * previous page's last sort, verbatim. */
  function esQueryDeep(poolId, startMs, searchAfter) {
    var q = {
      track_total_hits: false,
      sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
      size: ES_DEEP_SIZE,
      _source: ["operation_history.operation_result_object", "operation_history.op_object", "operation_type", "block_data"],
      query: {
        bool: {
          filter: [
            { match: { operation_type: "63" } },
            { multi_match: { type: "best_fields", query: poolId, lenient: true } },
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

  /* epoch ms -> ISO string. ES date math here is display-independent (the
   * range bounds only ever steer the search); undefined -> epoch, which ES
   * reads as "no floor" rather than an error. */
  function _iso(ms) {
    var n = Number(ms);
    if (!isFinite(n)) return new Date(0).toISOString();
    return new Date(n).toISOString();
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

  /* HistoryCap seam (the ONLY raw-ES path — direct fetch here is FORBIDDEN
   * by the centralization rule). Classic-script global in the browser
   * (typeof-guarded, load-order agnostic); globalThis preload in node
   * suites (no require() — checkJs runs browser libs, TS2591). Missing
   * everywhere => null, and esSwaps rejects to the chain path. */
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
   * entirely). Missing HistoryCap reads as ON here — esSwaps then rejects
   * via _historyCap and the caller still lands on chain (fail closed). */
  function _esOn() {
    try {
      var HC = _historyCap();
      if (HC && typeof HC.esAllowed === "function") return HC.esAllowed() !== false;
    } catch (e) {}
    return true;
  }

  /* ES adapter: up to `limit` recent swaps, newest first (capped at 1000).
   * Capped search_after pagination: 500/page, max 2 pages = 1000 raw
   * events; strict pool guards apply per page (esSwap); stops early when
   * a page returns <500 raw hits or the want is reached. 15s TOTAL budget
   * across pages (one deadline — each page gets the REMAINDER via esSearch
   * opts). Transport is HistoryCap.esSearch; the query bodies are the
   * byte-identical esQuery DSL below. Rejects on ANY failure
   * (es-disabled/es-unavailable/shape/missing seam) — the caller falls
   * back to chain. */
  function esSwaps(poolId, limit) {
    assertPoolId(poolId);
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
        resolve({ swaps: out, source: "es" });
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
          var q = esQuery(poolId, searchAfter);
          HC.esSearch("bitshares-*", q, { timeoutMs: remain }).then(function (data) {
            if (done) return;
            var hits = (data && data.hits && data.hits.hits) || [];
            for (var i = 0; i < hits.length && out.length < want; i++) {
              var sw = esSwap(hits[i], poolId);
              if (sw) out.push(sw);
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

  /* esSwapsWindow: deep-window ES walk for a chart that needs TIME, not a
   * fixed event count. coverSec = the span the candles must cover
   * (bucket * count), so the walk pages until the oldest fetched swap is at
   * least that far back, instead of stopping at 1000 events.
   * Resolves {swaps (newest first), source:"es", pages, capped} —
   * `capped` true means a budget (pages/events/wall clock) ended the walk
   * before coverage, so the caller can say the window was truncated; false
   * means either full coverage or an exhausted range (both complete).
   * Coverage is measured from the PARSED swaps' own .time, never from the
   * hit's `sort` value: on the live index sort[0] is epoch MILLIS
   * (measured 2026-10-08), and Date.parse() of that is NaN.
   * Rejects only on seam/shape failure (caller falls back to chain) — a
   * partial walk never throws, it reports capped and keeps what it got. */
  function esSwapsWindow(poolId, coverSec, opts) {
    assertPoolId(poolId);
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
          try { opts.onPage({ swaps: out.slice(), pages: pages, capped: capped, done: true }); } catch (e) { /* painter is optional */ }
        }
        resolve({ swaps: out, source: "es", pages: pages, capped: capped });
      }
      function fail(e) {
        if (done) return; done = true;
        reject(e instanceof Error ? e : new Error("es-unavailable"));
      }
      /* Coverage reached? Only a real, parsed, strictly older swap counts —
       * an unparseable time never ends the walk early with a false "full". */
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
          HC.esSearch("bitshares-*", esQueryDeep(poolId, startMs, searchAfter), { timeoutMs: remain }).then(function (data) {
            if (done) return;
            var hits = (data && data.hits && data.hits.hits) || [];
            for (var i = 0; i < hits.length && out.length < maxEvents; i++) {
              var sw = esSwap(hits[i], poolId);
              if (!sw || !sw.time) continue;
              out.push(sw);
              var t = Date.parse(sw.time);
              if (isFinite(t) && (oldestMs === null || t < oldestMs)) oldestMs = t;
            }
            pages++;
            /* Progressive paint (2026-10-08): hand the caller what we have
             * after EVERY page so the chart deepens while the walk runs —
             * a 2000-candle window can take minutes, and showing it only at
             * the end means staring at a short chart the whole time. */
            if (typeof opts.onPage === "function") {
              try { opts.onPage({ swaps: out.slice(), pages: pages, capped: false, done: false }); } catch (e) { /* painter is optional */ }
            }
            if (hits.length < ES_DEEP_SIZE) { finish(); return; }
            if (out.length >= maxEvents) { capped = true; finish(); return; }
            var last = hits[hits.length - 1];
            if (!last || !last.sort) { capped = true; finish(); return; }
            searchAfter = last.sort;
            fetchPage();
          }).catch(function (e) {
            /* A failed page mid-walk keeps the pages already fetched (the
             * chart still deepens); a failure on page 1 rejects to chain. */
            if (out.length) { capped = true; finish(); }
            else fail(e);
          });
        }
        fetchPage();
      } catch (e) { fail(e); }
    });
  }

  /* Chain fallback: get_liquidity_pool_history rows (op + executed result,
   * proven live 2026-09-28) — newest first already. Pool filter is exact
   * (rows carry .pool). Rows without results are skipped, never guessed.
   * Chain asserts limit <= 101 (measured 2026-10-01 on api.bitshares.dev:
   * limit 200 rejects, limit 100 returns 100 rows in 55ms) — clamp here so
   * the chain-first paint can never throw on the desk's want. */
  function chainSwaps(poolId, limit) {
    assertPoolId(poolId);
    var want = limit === undefined ? 100 : Math.floor(limit);
    if (!(want >= 1)) want = 100;
    if (want > 101) want = 101;
    return Pool.history(poolId, want).then(function (rows) {
      var out = [];
      (rows || []).forEach(function (h) {
        if (out.length >= want) return;
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
   * 2026-09-28; pref-off (esEnabled false) skips ES entirely — the chain
   * label below already covers it, no new copy). Chain fallback is authoritative. opts {network, legA,
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
    if (!_esOn()) return chain();
    return esSwaps(poolId, lim).then(function (res) {
      res.swaps = legs(res.swaps);
      if (res.swaps.length) return res;
      return chain();
    }).catch(chain);
  }

  /* swapsForPoolWindow: swapsForPool's deep twin — same mainnet/ES-pref/
   * leg-filter contract, but the ES side walks until coverSec of HISTORY is
   * in hand (esSwapsWindow) instead of until 1000 events run out. Chain
   * fallback stays the authority and stays shallow (the history api caps
   * at 101 rows — the window is an ES-only enrichment, exactly as the
   * deepen path was before). Resolves {swaps, source, pages, capped};
   * never rejects except bad pool id / both paths down. */
  function swapsForPoolWindow(poolId, coverSec, opts) {
    assertPoolId(poolId);
    opts = opts || {};
    function legs(swaps) { return filterLegs(swaps, opts.legA, opts.legB); }
    function chain() {
      return chainSwaps(poolId, opts.chainLimit).then(function (res) {
        res.swaps = legs(res.swaps);
        res.pages = 0;
        res.capped = false;
        return res;
      });
    }
    if (opts.network && opts.network !== "mainnet") return chain();
    if (!_esOn()) return chain();
    return esSwapsWindow(poolId, coverSec, opts).then(function (res) {
      res.swaps = legs(res.swaps);
      if (res.swaps.length) return res;
      return chain();
    }).catch(chain);
  }

  /* ES 24h-activity probe query (desk-map connects gating): ONE search over
   * many pools — op-63 docs in the past-24h window mentioning ANY listed
   * pool id (multi_match best_fields, lenient — same recall shape as the
   * per-pool esQuery; strict per-hit pool validation happens in
   * poolsActive24h via esSwap, so tokenization looseness never invents
   * activity). Range on block_data.block_time (the field esQuery already
   * sorts on, so it is mapped). Single page, no search_after: a full page
   * means the window may hold more than one page and the probe reports
   * partial:true (caller falls back to unfiltered edges + fallback note)
   * rather than pretending exhaustive. Params: poolIds (non-empty string
   * array), sinceIso ("YYYY-MM-DDTHH:mm:ss" UTC). Returns the query body. */
  function esActiveQuery(poolIds, sinceIso) {
    return {
      track_total_hits: false,
      sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
      size: ES_SIZE,
      _source: ["account_history", "operation_history", "operation_type", "block_data"],
      query: {
        bool: {
          filter: [
            { match: { operation_type: "63" } },
            { range: { "block_data.block_time": { gte: sinceIso } } },
            { multi_match: { type: "best_fields", query: poolIds.join(" "), lenient: true } }
          ]
        }
      }
    };
  }

  /* _fetchActiveHits: validate + probe the 24h op-63 window for a pool set
   * (ONE ES search, mainnet community index). Shared by poolsActive24h
   * (boolean presence) and poolSwapCounts (per-pool counts) so the query,
   * the caps and the honesty rule exist exactly once. Resolves
   * {hits, partial, ids, since} — partial true when the window filled the
   * whole page (activity beyond it unobserved; callers treat as
   * inconclusive and fall back). Rejects "es-unavailable"/"es-disabled".
   * Testnet callers must not call this (index is mainnet-only and pool ids
   * collide across chains). Params: poolIds (validated + deduped, cap 100).
   * Never throws outward (validation failures reject as es-unavailable). */
  function _fetchActiveHits(poolIds) {
    var ids = [], seen = {};
    (poolIds || []).forEach(function (id) {
      try {
        assertPoolId(id);
        if (!seen[id]) { seen[id] = true; ids.push(id); }
      } catch (e) { /* malformed id never probes */ }
    });
    if (ids.length > 100) ids = ids.slice(0, 100);
    if (!ids.length) return Promise.resolve({ hits: [], partial: false, ids: [], since: "" });
    var HC = _historyCap();
    if (!HC) return Promise.reject(new Error("es-unavailable"));
    if (!_esOn()) return Promise.reject(new Error("es-disabled"));
    var since = "";
    try { since = new Date(Date.now() - 86400000).toISOString().slice(0, 19); } catch (e) { since = ""; }
    if (!since) return Promise.reject(new Error("es-unavailable"));
    return HC.esSearch("bitshares-*", esActiveQuery(ids, since), { timeoutMs: ES_TIMEOUT_MS }).then(function (data) {
      var hits = (data && data.hits && data.hits.hits) || [];
      return { hits: hits, partial: hits.length >= ES_SIZE, ids: ids, since: since };
    });
  }

  /* poolsActive24h: which pools from the set swapped in the past 24h.
   * Resolves {active: {poolId: true}, partial: boolean} — see
   * _fetchActiveHits for transport. Never resolves invented activity: a
   * pool lands in active only on a strict esSwap match (exact pool id +
   * executed paid/received), with a lexicographic recency double-check
   * when the hit carries a time string (the ES range is the authority;
   * unparseable times ride it). Params: poolIds (string array). */
  function poolsActive24h(poolIds) {
    return _fetchActiveHits(poolIds).then(function (res) {
      var active = {};
      (res.hits || []).forEach(function (hit) {
        for (var i = 0; i < res.ids.length; i++) {
          var sw = null;
          try { sw = esSwap(hit, res.ids[i]); } catch (e) { sw = null; }
          if (!sw) continue;
          try {
            if (sw.time && String(sw.time).slice(0, 19) < res.since) continue;
          } catch (e) { /* range authority stands */ }
          active[res.ids[i]] = true;
          break;
        }
      });
      return { active: active, partial: res.partial };
    });
  }

  /* countSwaps: strict per-pool 24h swap counts over one probe page (pure).
   * Same match rule as poolsActive24h (exact pool id + executed legs +
   * recency double-check), but every matching hit COUNTS instead of just
   * marking presence — the min-swaps floor needs magnitudes, not booleans.
   * A hit matching no listed pool counts nowhere (never invented). Pure
   * (unit-tested). @param {Array} hits raw ES hits. @param {Array<string>}
   * ids validated pool ids. @param {string} since "YYYY-MM-DDTHH:mm:ss" UTC
   * floor ("", the empty probe, disables the recency check). @returns
   * {Object} poolId -> integer count (only pools with >= 1 hit). */
  function countSwaps(hits, ids, since) {
    var counts = {};
    try {
      (hits || []).forEach(function (hit) {
        for (var i = 0; i < (ids || []).length; i++) {
          var sw = null;
          try { sw = esSwap(hit, ids[i]); } catch (e) { sw = null; }
          if (!sw) continue;
          try {
            if (since && sw.time && String(sw.time).slice(0, 19) < since) continue;
          } catch (e) { /* range authority stands */ }
          counts[ids[i]] = (counts[ids[i]] || 0) + 1;
          break;
        }
      });
    } catch (e) { /* partial counts stand */ }
    return counts;
  }

  /* poolSwapCounts: per-pool 24h swap counts for a pool set (ONE ES search).
   * Resolves {counts: {poolId: n}, partial: boolean} — partial follows the
   * same rule as poolsActive24h (a full page may hide activity, so callers
   * fall back rather than filter on truncated counts). Rejects
   * "es-unavailable"/"es-disabled" like poolsActive24h. Params: poolIds. */
  function poolSwapCounts(poolIds) {
    return _fetchActiveHits(poolIds).then(function (res) {
      return { counts: countSwaps(res.hits, res.ids, res.since), partial: res.partial };
    });
  }

  /* DEFAULT_MIN_SWAPS: the swap desk's out-of-the-box noise floor (owner
   * 2026-10-08). 1 means "swapped at least once in 24h" — identical to the
   * pre-existing strict gate, so first paint is byte-identical to before.
   * Persisted per profile like the candle count. */
  var DEFAULT_MIN_SWAPS = 1;
  var MIN_SWAPS_KEY = "bts-vanilla-min-swaps-v1";

  /* readMinSwaps: persisted floor, or 1. Anything-not-a-non-negative-int reads
   * as 1 (0 shows every funded pool). Never throws. @returns {number} >= 0. */
  function readMinSwaps() {
    try {
      if (typeof localStorage !== "undefined") {
        var v = parseInt(localStorage.getItem(MIN_SWAPS_KEY), 10);
        if (isFinite(v) && v >= 0) return Math.floor(v);
      }
    } catch (e) { /* default stands */ }
    return DEFAULT_MIN_SWAPS;
  }

  /* writeMinSwaps: persist a validated floor. Anything-not-a-non-negative-int
   * is ignored (the input reverts). Never throws. @returns {boolean}. */
  function writeMinSwaps(v) {
    try {
      var n = Math.floor(Number(v));
      if (!isFinite(n) || n < 0) return false;
      if (typeof localStorage !== "undefined") localStorage.setItem(MIN_SWAPS_KEY, String(n));
      return true;
    } catch (e) { return false; }
  }
  /* Price orientation (#5 parse_price_history rule): price is always BUY-leg
   * per SELL-leg in pool-leg terms — legs sort by asset id (a<b consensus),
   * so paid=A&recv=B -> recv/paid, paid=B&recv=A -> paid/recv. Exact BigInt
   * ratio via Format; precisions resolved by the caller. places defaults to
   * PRICE_PLACES (backward compat — the "2.00000000" vectors pin it);
   * enrich passes the magnitude-aware value so sub-satoshi tapes keep their
   * variation. Returns human string or null (zero legs never divide). */
  function priceHuman(sw, precA, precB, assetA, assetB, places) {
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
      var pl = (Number.isInteger(places) && places >= 0 && places <= 18) ? places : PRICE_PLACES;
      return Format.formatPrice(String(num), numPrec, String(den), denPrec, pl);
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
    bucketSec = Math.floor(bucketSec);
    if (!(bucketSec >= 1)) throw new Error("bad bucket: " + JSON.stringify(bucketSec));
    if (!Number.isInteger(precB) || precB < 0 || precB > 12) throw new Error("bad precision: " + JSON.stringify(precB));
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

  /* swapsToPoints: enriched swaps -> discrete scatter points (Discrete
   * timescale). Same price/volume contract as swapsToCandles (enriched
   * .price, B-leg volume whether paid or received) but NO bucketing:
   * every priced swap is one point (dex-ux discrete parity — raw tape,
   * never aggregated). Params: swaps (newest-first tape), assetB id,
   * precB numeric B precision, cap 1..5000 integer (shared candle-count
   *   input — newest cap entries survive, painted oldest-first). Returns
   *   oldest-first [{timeMs, price, volume (B-leg human), volumeBaseRaw,
   *   volumeQuoteRaw, accountId (swapper or null), blockNum (or null)}]. Swaps with null price, bad time, or non-digit legs
   * are skipped, never reject. Empty swaps are VALID ([]).
   * Throws "bad-count" on cap < 1, "bad precision" on bad precB.
   * Pure except Format.formatAmount (BigInt money math only). */
  function swapsToPoints(swaps, assetB, precB, cap) {
    if (cap === undefined) cap = 2000;
    cap = Math.floor(cap);
    if (!(cap >= 1)) throw new Error("bad-count");
    if (!Number.isInteger(precB) || precB < 0 || precB > 12) throw new Error("bad precision: " + JSON.stringify(precB));
    var list = Array.isArray(swaps) ? swaps.slice(0, cap) : [];
    var newest = [];
    list.forEach(function (sw) {
      if (!sw || sw.price === null || sw.price === undefined) return;
      var unix = Math.floor(Date.parse(sw.time) / 1000);
      if (!(unix > 0)) return;
      var bRaw = null, aRaw = null;
      try {
        if (String(sw.received.asset) === String(assetB) && /^\d+$/.test(String(sw.received.amount))) {
          bRaw = String(sw.received.amount); aRaw = /^\d+$/.test(String(sw.paid.amount)) ? String(sw.paid.amount) : null;
        } else if (String(sw.paid.asset) === String(assetB) && /^\d+$/.test(String(sw.paid.amount))) {
          bRaw = String(sw.paid.amount); aRaw = /^\d+$/.test(String(sw.received.amount)) ? String(sw.received.amount) : null;
        }
      } catch (e) { bRaw = null; aRaw = null; }
      if (bRaw === null || aRaw === null) return;
      var vol = "0";
      try { vol = Format.formatAmount(bRaw, precB); } catch (e) { vol = "0"; }
      newest.push({ timeMs: unix * 1000, price: String(sw.price), volume: vol, volumeBaseRaw: bRaw, volumeQuoteRaw: aRaw,
        accountId: (sw && sw.account !== undefined && sw.account !== null) ? String(sw.account) : null,
        blockNum: (sw && sw.block !== undefined && sw.block !== null) ? sw.block : null });
    });
    newest.reverse();
    return newest;
  }

  /* Enrich swaps with the oriented human price (one pass; unknown assets
   * keep a null price and drop from candles, never the tape). places defaults
   * to magnitude-aware (probe every swap at SIGFIG_MAX, choose once via
   * _sigPlaces, then price at that precision — the market-fills fillsToCandles
   * pattern; empty/zero-only falls back to PRICE_PLACES and renders as
   * today). An explicit integer 0..18 overrides (single pass). Returns the
   * same array (mutated with .price), newest first.
   * Robustness: non-array input throws named "bad swaps" (never raw). */
  function enrich(swaps, assetA, precA, assetB, precB, places) {
    if (!Array.isArray(swaps)) throw new Error("bad swaps: expected array, got: " + String(swaps).slice(0, 32));
    var pl = (Number.isInteger(places) && places >= 0 && places <= 18) ? places : null;
    if (pl === null) {
      /* Upgrade-only (never below PRICE_PLACES): normal tapes keep their
       * pinned 8-place strings (vectors + the tape price-band filter count
       * on it); sub-satoshi tapes open to 9..12 so a 5% move at 2e-8 stops
       * printing one flat candle. */
      try {
        var probe = [];
        (swaps || []).forEach(function (sw) {
          var p = priceHuman(sw, precA, precB, assetA, assetB, SIGFIG_MAX);
          if (p !== null && p !== undefined) probe.push(p);
        });
        pl = _sigPlaces(probe);
        if (!(pl >= PRICE_PLACES)) pl = PRICE_PLACES;
      } catch (e) { pl = PRICE_PLACES; }
    }
    (swaps || []).forEach(function (sw) {
      sw.price = priceHuman(sw, precA, precB, assetA, assetB, pl);
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
    var balA, balB;
    try {
      if (typeof args.balanceA_raw !== "string" || !/^\d+$/.test(args.balanceA_raw)) throw new Error("bad reserves");
      if (typeof args.balanceB_raw !== "string" || !/^\d+$/.test(args.balanceB_raw)) throw new Error("bad reserves");
      balA = BigInt(args.balanceA_raw); balB = BigInt(args.balanceB_raw);
    } catch (e) {
      if (/^bad reserves/.test(e.message)) throw new Error("bad reserves: " + JSON.stringify(args.balanceA_raw) + "/" + JSON.stringify(args.balanceB_raw));
      throw new Error("bad reserves: " + String(e.message).slice(0, 48));
    }
    var precA = args.precA, precB = args.precB;
    if (!Number.isInteger(precA) || precA < 0 || precA > 12) throw new Error("bad precision: precA " + JSON.stringify(precA));
    if (!Number.isInteger(precB) || precB < 0 || precB > 12) throw new Error("bad precision: precB " + JSON.stringify(precB));
    var taker = Number(args.taker_units) || 0;
    if (!Number.isInteger(taker) || taker < 0 || taker > 10000) taker = 0; // hostile fee defaults to 0 haircut (never inflate out)
    if (balA <= 0n || balB <= 0n) return { bids: [], asks: [] };
    /* Level-price places (same collapse as the swap tape: fixed 8 prints one
     * flat "0.00000002" book on sub-satoshi pools like 1.19.58). Probe the
     * spot at SIGFIG_MAX once, choose via _sigPlaces, then price every
     * level at that precision — normal pools keep 8, tiny ones open up. */
    var levelPlaces = PRICE_PLACES;
    try {
      var spotProbe = Format.formatPrice(balB.toString(), precB, balA.toString(), precA, SIGFIG_MAX);
      levelPlaces = _sigPlaces([spotProbe]);
      /* Upgrade-only like enrich above: the "2.00601805"/"1.99400000"
       * book vectors pin 8 places for normal pools. */
      if (!(levelPlaces >= PRICE_PLACES)) levelPlaces = PRICE_PLACES;
    } catch (e) { levelPlaces = PRICE_PLACES; }
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
           * tests can't catch a swap — documented). Places ride the
           * spot probe above (sub-satoshi books keep their spread). */
          var price = sellIsA
            ? Format.formatPrice(out.toString(), outPrec, sell.toString(), sellPrec, levelPlaces)
            : Format.formatPrice(sell.toString(), sellPrec, out.toString(), outPrec, levelPlaces);
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
    swapsForPoolWindow: swapsForPoolWindow, esSwapsWindow: esSwapsWindow,
    poolsActive24h: poolsActive24h,
    poolSwapCounts: poolSwapCounts,
    readMinSwaps: readMinSwaps, writeMinSwaps: writeMinSwaps,
    DEFAULT_MIN_SWAPS: DEFAULT_MIN_SWAPS,
    enrich: enrich, priceHuman: priceHuman, swapsToCandles: swapsToCandles, swapsToPoints: swapsToPoints,
    filterLegs: filterLegs,
    synthBook: synthBook, ES_URL: ES_URL, ES_TIMEOUT_MS: ES_TIMEOUT_MS,
    ES_SIZE: ES_SIZE, ES_MAX_PAGES: ES_MAX_PAGES, ES_MAX_EVENTS: ES_MAX_EVENTS,
    ES_DEEP_SIZE: ES_DEEP_SIZE, ES_DEEP_MAX_PAGES: ES_DEEP_MAX_PAGES,
    ES_DEEP_MAX_EVENTS: ES_DEEP_MAX_EVENTS, ES_DEEP_TIMEOUT_MS: ES_DEEP_TIMEOUT_MS,
    _test: { esSwap: esSwap, esQuery: esQuery, esQueryDeep: esQueryDeep, esActiveQuery: esActiveQuery, filterLegs: filterLegs, SLICES: SLICES, countSwaps: countSwaps }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolHistory === "undefined") { globalThis.PoolHistory = PoolHistory; }
if (typeof module !== "undefined") { module.exports = PoolHistory; }
