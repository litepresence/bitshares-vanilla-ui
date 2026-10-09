/* MarketCandles: OHLCV candles + timeframe buckets for the DEX desk.
 * Owns: live bucket list (timeframes), slot-boundary ISO (_slotISO), exact
 *   red/green compare (_isRed), and candles() with timeframe + gap
 *   interpolation, plus session VWAP + per-bucket spread band math (vwap(),
 *   dex-ux plot proposal 3 — BigInt volume accumulation, humans via Format).
 *   No rendering, no signing.
 * Consumes: Chain.db/.history/.call (single chain-facing module),
 *   Format.formatPrice/.formatAmount (BigInt/string math only).
 * Globals/side effects: exposes global MarketCandles only; no DOM, no
 *   storage. One module-level bucket cache + one precision cache (asset id
 *   -> numeric precision). The precision cache duplicates market.js's
 *   (same get_assets memo): two caches are one extra lookup per session
 *   worst-case, and keep this file self-contained — the split seam, not a
 *   behavior change.
 * Created by: building-vanilla-slices skill, slice-18 audit (market.js split —
 *   moved verbatim from market.js timeframes/_slotISO/_isRed/candles; Market
 *   delegates its timeframes/candles to this file, API unchanged).
 * Extended by: dex-ux plots task (AFK round — proposal 3 VWAP math,
 *   chain-history only, ES refused).
   * Extended by: deep-candles plan Task 2 (ES deep merge, chain wins;
   *   MarketFills + Store consumed guarded, ES throw degrades to chain-only).
   * Lazy-deep (2026-10-01 audit): candles() NEVER waits on ES — it paints
   *   chain-first (chain get_market_history: 42ms/2KB vs ES page: ~1s/670KB
   *   measured) and merges background ES buckets fetched by deepen() via the
   *   one-entry _deepCache below (fresh chain buckets stay authoritative).
   *   deepen() runs once per pair+bucket (desk-guarded), ES capped 2 pages /
   *   1000 events (~1.4MB worst, typically 1 page); interval refreshes and
   *   live-tip polls stay chain-only, so idle desks cost ~0 bytes.
 */
var MarketCandles = (function () {
  "use strict";

  /* Fixed decimals for BigInt-computed price strings (follows #1's
   * Price.toReal reward — `parseFloat(real.toFixed(8))`,
   * MarketClasses.js:284; Task-4 vectors pin it). Kept as the
   * empty/zero-only fallback — live candles use the magnitude-aware places
   * below (4 sig figs, satoshi-scale fix). */
  var PRICE_PLACES = 8;

  /* Ceiling for magnitude-aware places (Format allows 0..18; 12 covers
   * ~1e-9 at 4 sig figs — below that the 12-place string still stands,
   * honest but capped, never a "0" invented; see Format.sigFigPlaces). */
  var SIGFIG_MAX = 12;

  /* Magnitude-aware places for already-human price strings (Number for
   * magnitude only, never money). Falls back to PRICE_PLACES when the
   * formatter is absent or the set is empty/zero-only (renders as today).
   * Never throws. */
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

  /* asset id -> numeric precision, filled on demand via get_assets. */
  var _precCache = {};

  /* True for digit-only raw-int strings (unsigned; chain amounts are >= 0).
   * Negatives from a hostile node fail the gate (treated as gaps, never
   * rendered as negative money). */
  function _isIntStr(s) {
    return typeof s === "string" && /^\d+$/.test(s);
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

  /* Session cache for the live bucket list (timeframes(), slice-07 Task 3).
   * Null until first fetch; a copy is returned so callers cannot poison it. */
  var _bucketsCache = null;
  /* In-flight buckets memo (perf: fill() calls timeframes() and candles()
   * together — candles() awaits timeframes() internally, so every desk load
   * fired the same zero-arg call twice. One RPC per tick, never two. Pending
   * only: cleared on settle; the resolved list still caches in
   * _bucketsCache. Behavior identical. */
  var _bucketsPending = null;

  /* Background ES buckets for the lazy-deep merge (one entry: the pair +
   * bucket the desk last deepened). Written by deepen(), read synchronously
   * by candles() — the only cross-call state, cleared on network/pair flip
   * bucket the desk last deepened). Written by deepen(), read synchronously
   * by candles() — the only cross-call state, cleared on network/pair flip
   * by key mismatch (a stale key simply never matches). */
  var _deepCache = null;

  /* Supported bucket sizes in seconds from the live history api
   * (get_market_history_buckets, api.hpp:229). Sorted ascending, cached
   * per session. Observed live 2026-09-27: testnet
   * (wss://testnet.xbts.io/ws) [60,300,900,1800,3600,14400,86400];
   * mainnet (wss://api.bitshares.dev/ws)
   * [60,300,900,3600,14400,86400,604800] — never hardcode, always read.
   * Fails: "history-unavailable" when the history api is missing. */
  async function timeframes() {
    if (_bucketsCache !== null) return _bucketsCache.slice();
    if (_bucketsPending !== null) return _bucketsPending.then(function (nums) { return nums.slice(); });
    _bucketsPending = _timeframesInner();
    _bucketsPending.then(function () { _bucketsPending = null; },
      function () { _bucketsPending = null; });
    return _bucketsPending.then(function (nums) { return nums.slice(); });
  }

  /* Inner bucket-list fetch (unchanged contract — see timeframes above). */
  async function _timeframesInner() {
    var histId;
    try {
      histId = await Chain.history();
    } catch (e) {
      throw new Error("history-unavailable");
    }
    var buckets;
    try {
      buckets = await Chain.call(histId, "get_market_history_buckets", []);
    } catch (e) {
      throw new Error("history-unavailable");
    }
    var nums = (Array.isArray(buckets) ? buckets : []).filter(function (b) {
      return typeof b === "number" && b > 0;
    });
    nums.sort(function (a, b) { return a - b; });
    _bucketsCache = nums;
    return nums.slice();
  }

  /* Slot-boundary ISO for a unix-seconds timestamp (chain key.open format:
   * toISOString without millis/Z, e.g. "2026-09-25T03:00:00"). Pure. */
  function _slotISO(slotSec) {
    return new Date(slotSec * 1000).toISOString().slice(0, -5);
  }

  /* Red iff close price < open price, compared exactly on raw integers:
   * closeB/closeQ < openB/openQ ⟺ closeB*openQ < openB*closeQ (BigInt,
   * no binary float). Params are validated digit strings. Pure. */
  function _isRed(openB, openQ, closeB, closeQ) {
    return BigInt(closeB) * BigInt(openQ) < BigInt(openB) * BigInt(closeQ);
  }

  /* Bucket orientation (the inverted-market fix — see MarketsStore._priceChart
   * in #1, the `quoteAsset.id === key.quote` branch): get_market_history
   * returns legs in chain-canonical order, NOT necessarily the requested
   * (baseId, quoteId) order. #1 detects the swapped case via row.key.quote
   * and swaps the legs back (plus a high/low cross — reciprocal flips the
   * ordering — plus the volume-leg swap). This file previously assumed the
   * matched case always, so an inverted market priced swapped raws at
   * unswapped precisions (reciprocal times 10^2Δp — a decimal-place-looking
   * error), while the book/ticker (server-rendered base-per-quote strings)
   * stayed correct: the plot/book mismatch.
   * Params: row (bucket with key.{base,quote}), baseId/quoteId requested ids.
   * Returns true when the wire legs are swapped vs the request, false when
   * matched, null when the key names a foreign pair (unmappable — caller
   * treats the row as a gap, never renders wrong money). A missing key (or
   * missing legs) assumes matched: backward-compatible, never blanks a chart
   * over absent metadata. Pure. */
  function _isSwapped(row, baseId, quoteId) {
    try {
      var k = row ? row.key : null;
      var kb = k ? k.base : null, kq = k ? k.quote : null;
      if (typeof kb !== "string" || typeof kq !== "string" || !kb || !kq) return false;
      if (kq === quoteId && kb === baseId) return false;
      if (kq === baseId && kb === quoteId) return true;
      return null;
    } catch (e) { return false; }
  }

  /* OHLCV candles with timeframe + gap interpolation (slice-07 Task 3).
   * History api: get_market_history(a, b, bucket, start, end), api.hpp:229-237.
   * Params: baseId/quoteId asset ids; bucketSec defaults to 3600 (largest
   *   bucket fallback when 3600 is not offered, as before); count defaults
   *   to 200. Old two-arg calls keep working unchanged.
   * Window: the last `count` bucket slots ending at the current bucket
   *   boundary (slot grid, unix seconds). Interpolation (exact per plan):
   *   returned rows are mapped by start time (r.key.open floored to the
   *   bucket grid); an empty slot copies the previous slot's close pair
   *   into O/H/L/C with zero volume; leading empties (no prevClose) are
   *   dropped. Red iff close<open (exact BigInt compare), else green.
   * Each bucket keeps the old human-string fields (open/high/low/close/
   *   volume/baseVolume/quoteVolume via BigInt Format math, time, raw)
   *   and adds: timeMs, openBase/openQuote + high/low/close pairs and
   *   volumeBaseRaw/volumeQuoteRaw as RAW int strings ("0" when filled),
   *   and red. closes[] are Numbers for Indicators chart-pixel input only
   *   (Global Constraints). Empty result is VALID ({buckets: [], closes: []}
   *   renders "no history"). Malformed rows are treated as gaps (never
   *   rendered as null-OHLC entries).
   * Fails: "history-unavailable" when the history api is missing;
   *   "bad-bucket"/"bad-count" on invalid timeframe args. */
  async function candles(baseId, quoteId, bucketSec, count) {
    if (count === undefined) count = 2000;
    count = Math.floor(count);
    if (!(count >= 1)) throw new Error("bad-count");
    var nums = await timeframes(); // throws history-unavailable
    if (nums.length === 0) {
      return { bucket: null, start: null, end: null, buckets: [], closes: [], deep: false, places: PRICE_PLACES };
    }
    var bucket;
    if (bucketSec === undefined) {
      bucket = nums.indexOf(3600) !== -1 ? 3600 : Math.max.apply(null, nums);
    } else {
      bucket = Math.floor(bucketSec);
      if (!(bucket >= 1)) throw new Error("bad-bucket");
    }
    var nowSec = Math.floor(Date.now() / 1000); // epoch time math, not money
    var endSlotSec = Math.floor(nowSec / bucket) * bucket;
    var startSlotSec = endSlotSec - (count - 1) * bucket;
    var startISO = _slotISO(startSlotSec);
    var endISO = _slotISO(endSlotSec + bucket);
    var histId;
    try {
      histId = await Chain.history();
    } catch (e) {
      throw new Error("history-unavailable");
    }
    /* Paginated fetch (2026-10-02 fix): nodes cap get_market_history at 200
     * buckets per call and serve oldest-first — one wide-window call used to
     * return only the OLDEST 200 slots (2022/23 on BTS_CNY daily), so new
     * data never arrived. Walk backward from the tip in 200-slot chunks
     * (bounded: ceil(count/200)+1 calls, 25 max) and stitch by slot; sparse
     * markets simply yield fewer rows, pruned/history nodes yield what they
     * have. bySlot keying dedupes chunk overlaps for free. */
    var rows = [];
    try {
      var chunks = Math.min(25, Math.ceil(count / 200) + 1);
      for (var k = 0; k < chunks; k++) {
        var chunkEnd = endSlotSec - k * 200 * bucket;
        if (chunkEnd < startSlotSec) break;
        var chunkStart = chunkEnd - (200 - 1) * bucket;
        if (chunkStart < startSlotSec) chunkStart = startSlotSec;
        var page = await Chain.call(histId, "get_market_history",
          [baseId, quoteId, bucket, _slotISO(chunkStart), _slotISO(chunkEnd + bucket)]);
        if (Array.isArray(page) && page.length > 0) rows = rows.concat(page);
      }
    } catch (e) {
      if (rows.length === 0) throw new Error("history-unavailable");
      /* partial window stands — pruned nodes give what they have */
    }
    var bySlot = {};
    var i;
    if (Array.isArray(rows)) {
      for (i = 0; i < rows.length; i++) {
        var r = rows[i] || {};
        var keyOpen = r.key ? r.key.open : null;
        var t = typeof keyOpen === "string" ? Date.parse(keyOpen) : NaN;
        if (isNaN(t)) continue;
        var slot = Math.floor(Math.floor(t / 1000) / bucket) * bucket;
        if (slot < startSlotSec || slot > endSlotSec) continue;
        bySlot[slot] = r;
      }
    }
    /* Chain-silent windows still consult the ES backfill below instead of
     * returning empty here: a pruned/gapped history node must not blank a
     * chart the community index can fill (audit 2026-10-08 — the desk
     * showed "No price history" while ES held the fills). The merge stays
     * chain-wins, so a silent chain plus an empty cache still resolves the
     * same honest empty as before. */
    var chainSilent = Object.keys(bySlot).length === 0;
    _needPriceMath();
    var precs = await _precisions([baseId, quoteId]);
    /* Satoshi-scale (4 sig figs): probe the fetched set at SIGFIG_MAX
     * (human strings via BigInt; Number measures magnitude only), choose
     * places once, then format every leg at that precision. Empty/zero-only
     * falls back to PRICE_PLACES (renders as today). */
    var places = PRICE_PLACES;
    try {
      var magProbe = [];
      Object.keys(bySlot).forEach(function (k) {
        var rr = bySlot[k] || {};
        var sw = _isSwapped(rr, baseId, quoteId);
        if (sw === null) return; /* foreign pair: a gap, never a probe */
        /* Oriented legs (matched: wire order stands; swapped: wire base↔quote
         * trade places AND high↔low cross — the reciprocal flips ordering,
         * #1 else-branch verbatim). Precisions always follow the ASSET. */
        var oBw = String(rr.open_base), oQw = String(rr.open_quote);
        var hBw = String(rr.high_base), hQw = String(rr.high_quote);
        var lBw = String(rr.low_base), lQw = String(rr.low_quote);
        var cBw = String(rr.close_base), cQw = String(rr.close_quote);
        var legs = sw
          ? [[oQw, oBw], [lQw, lBw], [hQw, hBw], [cQw, cBw]]
          : [[oBw, oQw], [hBw, hQw], [lBw, lQw], [cBw, cQw]];
        for (var li = 0; li < legs.length; li++) {
          var bRaw = String(legs[li][0]), qRaw = String(legs[li][1]);
          if (!_isIntStr(bRaw) || !_isIntStr(qRaw)) continue;
          try {
            magProbe.push(Format.formatPrice(bRaw, precs[baseId], qRaw, precs[quoteId], SIGFIG_MAX));
          } catch (e) { /* malformed leg is a gap, never a reject */ }
        }
      });
      places = _sigPlaces(magProbe);
    } catch (e) { places = PRICE_PLACES; }
    var out = [], closes = [];
    var prevB = null, prevQ = null, prevHuman = null, prevNum = null;
    for (var s = startSlotSec; s <= endSlotSec; s += bucket) {
      var row = bySlot[s] || null;
      var entry = null;
      if (row) {
        var sw = _isSwapped(row, baseId, quoteId);
        var oBw = String(row.open_base), oQw = String(row.open_quote);
        var cBw = String(row.close_base), cQw = String(row.close_quote);
        var hBw = String(row.high_base), hQw = String(row.high_quote);
        var lBw = String(row.low_base), lQw = String(row.low_quote);
        if (sw === null) {
          /* Foreign pair legs: unmappable, a gap (never wrong money). */
        } else if (_isIntStr(oBw) && _isIntStr(oQw) && _isIntStr(cBw) && _isIntStr(cQw) &&
          _isIntStr(hBw) && _isIntStr(hQw) && _isIntStr(lBw) && _isIntStr(lQw)) {
          /* Oriented pairs (swapped: legs trade places, high↔low cross).
           * The cross ALSO swaps within the pair: wire low_base is the QUOTE
           * leg, so oriented highBase takes the wire low_QUOTE (#1
           * get_asset_price(low_quote, baseAsset, low_base, quoteAsset)). */
          var oB = sw ? oQw : oBw, oQ = sw ? oBw : oQw;
          var cB = sw ? cQw : cBw, cQ = sw ? cBw : cQw;
          var hB = sw ? lQw : hBw, hQ = sw ? lBw : hQw;
          var lB = sw ? hQw : lBw, lQ = sw ? hBw : lQw;
          try {
          var o = Format.formatPrice(oB, precs[baseId], oQ, precs[quoteId], places);
          var h = Format.formatPrice(hB, precs[baseId], hQ, precs[quoteId], places);
          var l = Format.formatPrice(lB, precs[baseId], lQ, precs[quoteId], places);
          var c = Format.formatPrice(cB, precs[baseId], cQ, precs[quoteId], places);
          var bvW = row.base_volume !== undefined && row.base_volume !== null ? String(row.base_volume) : null;
          var qvW = row.quote_volume !== undefined && row.quote_volume !== null ? String(row.quote_volume) : null;
          /* Oriented volumes (swapped: wire base_volume is the quote leg). */
          var bv = sw ? qvW : bvW;
          var qv = sw ? bvW : qvW;
          var cn = Number(c);
          cn = isNaN(cn) ? null : cn; // pixels only, not money
          entry = {
            raw: row,
            time: row.key.open,
            timeMs: s * 1000,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: _isIntStr(bv) ? Format.formatAmount(bv, precs[baseId]) : null,
            baseVolume: _isIntStr(bv) ? Format.formatAmount(bv, precs[baseId]) : null,
            quoteVolume: _isIntStr(qv) ? Format.formatAmount(qv, precs[quoteId]) : null,
            openBase: oB,
            openQuote: oQ,
            highBase: hB,
            highQuote: hQ,
            lowBase: lB,
            lowQuote: lQ,
            closeBase: cB,
            closeQuote: cQ,
            volumeBaseRaw: _isIntStr(bv) ? bv : null,
            volumeQuoteRaw: _isIntStr(qv) ? qv : null,
            red: _isRed(oB, oQ, cB, cQ)
          };
          prevB = cB;
          prevQ = cQ;
          prevHuman = c;
          prevNum = cn;
          } catch (e) { entry = null; /* malformed row (zero quote etc.) is a gap, never a whole-chart reject */ }
        }
      }
      if (!entry) {
        if (prevB === null) continue; // leading gap: drop (no prevClose)
        var zeroBase = Format.formatAmount("0", precs[baseId]);
        var zeroQuote = Format.formatAmount("0", precs[quoteId]);
        entry = {
          raw: null, // synthetic gap-fill marker
          time: _slotISO(s),
          timeMs: s * 1000,
          open: prevHuman,
          high: prevHuman,
          low: prevHuman,
          close: prevHuman,
          volume: zeroBase,
          baseVolume: zeroBase,
          quoteVolume: zeroQuote,
          openBase: prevB,
          openQuote: prevQ,
          highBase: prevB,
          highQuote: prevQ,
          lowBase: prevB,
          lowQuote: prevQ,
          closeBase: prevB,
          closeQuote: prevQ,
          volumeBaseRaw: "0",
          volumeQuoteRaw: "0",
          red: false // close == open → green
        };
      }
      out.push(entry);
      closes.push(prevNum); // pixels only, not money (prevNum tracks this slot's close)
    }
    /* Deep backfill, lazy (2026-10-01 audit): merge the background ES buckets
     * fetched by deepen() UNDER fresh chain authority (chain wins every
     * overlap, same mergeDeep rule as before). The merge cap is the
     * REQUESTED count (not a fixed 2000): changing the candle window
     * re-windows the merged output instead of reusing a stale span.
     * Synchronous cache read — this function never waits on the network,
     * so first candles paint at chain speed (~50ms) and deepen visibly the
     * chart when ES lands. Mainnet only (the community index is
     * mainnet-only); empty cache = chain-only with deep=false, never
     * a throw. */
    var deep = false;
    var deepCapped = false;
    try {
      /* Key includes the count (deepen() caches per bucket+count): a count
       * edit re-windows the merged output instead of reusing a span sized
       * for the previous request. */
      var dkey = baseId + "|" + quoteId + "|" + bucket + "|" + count;
      if (_deepCache && _deepCache.key === dkey &&
        Array.isArray(_deepCache.esBuckets) && _deepCache.esBuckets.length > 0 &&
        typeof MarketFills !== "undefined" && MarketFills &&
        typeof MarketFills.mergeDeep === "function") {
        out = MarketFills.mergeDeep(out, _deepCache.esBuckets, count);
        closes = out.map(function (e) {
          var n = Number(e && e.close);
          return isNaN(n) ? null : n; // pixels only, not money
        });
        deep = true;
        /* A budget-capped walk leaves a short window; the desk note says so
         * rather than implying the market has no older trades. */
        deepCapped = !!_deepCache.capped;
      }
    } catch (e) { deep = false; /* cache merge never breaks chain paint */ }
    /* Merged-window places: the ES backfill may widen the range, so the
     * chart axis follows the FINAL set (same 4-sig-fig rule, Number for
     * magnitude only). Chain-only keeps the probe value above. */
    var finalPlaces = places;
    try {
      if (deep && out.length > 0) {
        var mergedHumans = [];
        for (var mi = 0; mi < out.length; mi++) {
          var me = out[mi] || {};
          if (me.open !== undefined) mergedHumans.push(me.open);
          if (me.high !== undefined) mergedHumans.push(me.high);
          if (me.low !== undefined) mergedHumans.push(me.low);
          if (me.close !== undefined) mergedHumans.push(me.close);
        }
        finalPlaces = _sigPlaces(mergedHumans);
      }
    } catch (e) { finalPlaces = places; }
    return { bucket: bucket, start: startISO, end: endISO, buckets: out, closes: closes, deep: deep, deepCapped: deepCapped, places: finalPlaces };
  }

  /* deepen: background ES backfill for one pair+bucket (lazy-deep, Playwright
   *   desk calls this ONCE per pair+bucket after the chain-first paint; the
   *   next candles() call merges the result under fresh chain authority).
   *
   *   Window-corrected 2026-10-08 — this used to ask for a flat 1000 fills,
   *   which bounds EVENTS, not TIME: 1000 fills is however much wall-clock
   *   that happens to be (BTS/CNY 1h 1623-of-2000, 1D 1502, 1W 575 measured —
   *   the ES side could never go past its 1000 fills, so a wide request was
   *   unreachable however the user set the count). It now walks the index
   *   until the candles' own span (bucket * count) is covered
   *   (MarketFills.fillsForMarketWindow) and carries the walk's `capped` flag
   *   so a truncated window is disclosed instead of implied.
   *
   *   countSec = the candle count in force when the deepen started (the desk
   *   passes the live input value; defaults to 2000). Mainnet only
   *   (community index is mainnet-only); any failure or empty ES page
   *   resolves null and the desk keeps its chain-only paint — never rejects,
   *   never throws outward (bad bucket still throws like candles()).
   *   Returns {key, fills, capped} on success or null when there is nothing
   *   to merge. Pure side effect: one _deepCache entry; no DOM, no storage.
   *
   *   onPage (optional): called with "page N arrived" after every page, so
   *   the desk can repaint while a minutes-long walk runs instead of
   *   staring at the chain-only chart until it lands. The callback is given
   *   no arguments (the cache is already updated — a repaint just re-reads
   *   candles()); failures inside it never break the walk. */
  async function deepen(baseId, quoteId, bucketSec, countSec, onPage) {
    var bucket = Math.floor(bucketSec);
    if (!(bucket >= 1)) throw new Error("bad-bucket");
    var want = Math.floor(Number(countSec));
    if (!(want >= 1)) want = 2000;
    /* Cache identity includes the count: a count edit asks for a different
     * span, so reusing a window sized for the previous request would
     * silently under-fill the chart. */
    var key = baseId + "|" + quoteId + "|" + bucket + "|" + want;
    try {
      var net = "mainnet";
      try {
        if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
          var st = Store.loadSettings();
          if (st && (st.network === "testnet" || st.network === "mainnet")) net = st.network;
        }
      } catch (e) { /* mainnet default stands */ }
      if (net !== "mainnet") {
        if (_deepCache && _deepCache.key === key) _deepCache = null;
        return null;
      }
      if (_deepCache && _deepCache.key === key) return null; // already deep
      if (typeof MarketFills === "undefined" || !MarketFills ||
        typeof MarketFills.fillsForMarketWindow !== "function" ||
        typeof MarketFills.fillsToCandles !== "function") return null;
      var precs = await _precisions([baseId, quoteId]);
      /* Progressive paint: bucket + cache each page, then let the caller
       * repaint. `publish` is the one place the cache is written, so an
       * intermediate page and the terminal result are identical in shape. */
      function publish(fills, capped) {
        if (!Array.isArray(fills) || fills.length === 0) return false;
        var esBuckets = MarketFills.fillsToCandles(fills, bucket, baseId, precs[baseId], precs[quoteId], quoteId);
        if (!Array.isArray(esBuckets) || esBuckets.length === 0) return false;
        _deepCache = { key: key, esBuckets: esBuckets, capped: !!capped };
        return true;
      }
      var paint = function () {
        try { if (typeof onPage === "function") onPage(); } catch (e) { /* painter is optional */ }
      };
      var seen = { n: 0 };
      var fres = await MarketFills.fillsForMarketWindow(baseId, quoteId, bucket * want, {
        network: net,
        onPage: function (m) {
          if (!publish(m.fills, m.capped)) return;
          seen.n++;
          paint();
        }
      });
      var fills = fres && fres.fills ? fres.fills : [];
      if (!Array.isArray(fills) || fills.length === 0) return null;
      /* Terminal pass: re-publish under the walk's own verdict so the cache
       * can never disagree with what the caller was told. */
      if (!seen.n || (_deepCache && _deepCache.key !== key)) publish(fills, fres && fres.capped);
      paint();
      return { key: key, fills: fills.length, capped: !!(fres && fres.capped) };
    } catch (e) { return null; /* ES/chain throw → chain-only stands */ }
  }

  /* Session VWAP + per-bucket spread band (dex-ux proposal 3 — the portable
   * math is kibana.py discrete_to_candles bucketing SHAPE only; its ES
   * source is REFUSED, we feed the same algorithm from get_market_history
   * buckets built by candles() above). Pure: no fetching.
   * Params: buckets (candles() entries with volumeBaseRaw/volumeQuoteRaw +
   *   high/low raw pairs), basePrec/quotePrec numeric precisions.
   * Math: per bucket vwap_num += BigInt(base_vol_int),
   *   vwap_den += BigInt(quote_vol_int); session VWAP renders as num/den
   *   via Format.formatPrice (BigInt, both precisions applied); band = the
   *   bucket (high, low) raw pairs as human strings. Zero-volume gap slots
   *   ("0"/"0") carry no VWAP and are skipped, never averaged in.
   * Returns: {num, den} session raw-integer strings, human session string
   *   (null when den is 0), per[] of {timeMs, vwap, high, low} human
   *   strings for the overlay renderer, skipped count. Empty input is VALID
   *   ({human: null, per: []} renders "VWAP unavailable").
   * Fails: "bad-precision" on non-numeric precisions. */
  function vwap(buckets, basePrec, quotePrec) {
    if (typeof basePrec !== "number" || typeof quotePrec !== "number") {
      throw new Error("bad-precision");
    }
    _needPriceMath();
    var list = Array.isArray(buckets) ? buckets : [];
    /* Same 4-sig-fig rule as candles(): follow the input window's own
     * humans so the strip reads like the price pane (fallback 8 renders
     * as today). */
    var vplaces = PRICE_PLACES;
    try {
      var vmag = [];
      for (var mi = 0; mi < list.length; mi++) {
        var me = list[mi] || {};
        if (me.close !== undefined) vmag.push(me.close);
        if (me.high !== undefined) vmag.push(me.high);
        if (me.low !== undefined) vmag.push(me.low);
        if (me.open !== undefined) vmag.push(me.open);
      }
      vplaces = _sigPlaces(vmag);
    } catch (e) { vplaces = PRICE_PLACES; }
    var num = 0n, den = 0n, per = [], skipped = 0, i;
    for (i = 0; i < list.length; i++) {
      var e = list[i] || {};
      var bRaw = e.volumeBaseRaw !== undefined && e.volumeBaseRaw !== null
        ? String(e.volumeBaseRaw) : null;
      var qRaw = e.volumeQuoteRaw !== undefined && e.volumeQuoteRaw !== null
        ? String(e.volumeQuoteRaw) : null;
      if (!_isIntStr(bRaw) || !_isIntStr(qRaw)) { skipped++; continue; }
      var bB = BigInt(bRaw), qB = BigInt(qRaw);
      if (qB <= 0n || bB < 0n) { skipped++; continue; }
      num += bB;
      den += qB;
      try {
        per.push({
          timeMs: e.timeMs || 0,
          vwap: Format.formatPrice(bRaw, basePrec, qRaw, quotePrec, vplaces),
          high: Format.formatPrice(String(e.highBase), basePrec, String(e.highQuote), quotePrec, vplaces),
          low: Format.formatPrice(String(e.lowBase), basePrec, String(e.lowQuote), quotePrec, vplaces)
        });
      } catch (err) { skipped++; continue; }
    }
    var human = null;
    if (den > 0n) {
      try {
        human = Format.formatPrice(num.toString(), basePrec, den.toString(), quotePrec, vplaces);
        /* 4-sf display (global price rule): the session string is painted
         * as text ("Session VWAP: …" + canvas label); per-bucket vwap/high/
         * low stay as computed (plotted via Number, never text). Sci
         * notation still Number-parses for the plot position below. */
        try {
          if (typeof Format.priceSig === "function") {
            var hsig = Format.priceSig(human);
            if (typeof hsig === "string" && hsig) human = hsig;
          }
        } catch (e) { /* places string stands */ }
      } catch (err) { human = null; }
    }
    return { num: num.toString(), den: den.toString(), human: human, per: per, skipped: skipped, places: vplaces };
  }

  /* mergeWindows: tip-sized fresh fetch into the painted window (pure).
   * Fresh rows win overlaps (they are newer by construction), output sorted
   * ascending and sliced to the last `cap`. Keyed on timeMs like mergeDeep
   * (which stays the ES backfill path — this one is chain-vs-chain).
   * Params: oldBuckets, freshBuckets (candle entries or falsy), cap number.
   * Returns the merged array (possibly []). Never throws. Unit-tested. */
  function mergeWindows(oldBuckets, freshBuckets, cap) {
    try {
      var n = Math.floor(cap);
      if (!(n >= 1)) return [];
      var byMs = {};
      (Array.isArray(oldBuckets) ? oldBuckets : []).forEach(function (e) {
        if (e && typeof e.timeMs === "number") byMs[e.timeMs] = e;
      });
      (Array.isArray(freshBuckets) ? freshBuckets : []).forEach(function (e) {
        if (e && typeof e.timeMs === "number") byMs[e.timeMs] = e;
      });
      var keys = Object.keys(byMs).map(Number).sort(function (a, b) { return a - b; });
      var out = keys.map(function (k) { return byMs[k]; });
      if (out.length > n) out = out.slice(out.length - n);
      return out;
    } catch (e) { return []; }
  }

  return {
    timeframes: timeframes,
    candles: candles,
    deepen: deepen,
    mergeWindows: mergeWindows,
    vwap: vwap
  };
})();

if (typeof module !== "undefined") { module.exports = MarketCandles; }
