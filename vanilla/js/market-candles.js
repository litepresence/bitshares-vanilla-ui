/* MarketCandles: OHLCV candles + timeframe buckets for the DEX desk.
 * Owns: live bucket list (timeframes), slot-boundary ISO (_slotISO), exact
 *   red/green compare (_isRed), and candles() with timeframe + gap
 *   interpolation. No rendering, no signing.
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
 */
var MarketCandles = (function () {
  "use strict";

  /* Fixed decimals for BigInt-computed price strings (follows #1's
   * Price.toReal reward — `parseFloat(real.toFixed(8))`,
   * MarketClasses.js:284; Task-4 vectors pin it). */
  var PRICE_PLACES = 8;

  /* asset id -> numeric precision, filled on demand via get_assets. */
  var _precCache = {};

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

  /* Session cache for the live bucket list (timeframes(), slice-07 Task 3).
   * Null until first fetch; a copy is returned so callers cannot poison it. */
  var _bucketsCache = null;

  /* Supported bucket sizes in seconds from the live history api
   * (get_market_history_buckets, api.hpp:229). Sorted ascending, cached
   * per session. Observed live 2026-09-27: testnet
   * (wss://testnet.xbts.io/ws) [60,300,900,1800,3600,14400,86400];
   * mainnet (wss://api.bitshares.dev/ws)
   * [60,300,900,3600,14400,86400,604800] — never hardcode, always read.
   * Fails: "history-unavailable" when the history api is missing. */
  async function timeframes() {
    if (_bucketsCache !== null) return _bucketsCache.slice();
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
    if (count === undefined) count = 200;
    count = Math.floor(count);
    if (!(count >= 1)) throw new Error("bad-count");
    var nums = await timeframes(); // throws history-unavailable
    if (nums.length === 0) {
      return { bucket: null, start: null, end: null, buckets: [], closes: [] };
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
    var rows;
    try {
      rows = await Chain.call(histId, "get_market_history", [baseId, quoteId, bucket, startISO, endISO]);
    } catch (e) {
      throw new Error("history-unavailable");
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
    if (Object.keys(bySlot).length === 0) {
      return { bucket: bucket, start: startISO, end: endISO, buckets: [], closes: [] };
    }
    _needPriceMath();
    var precs = await _precisions([baseId, quoteId]);
    var out = [], closes = [];
    var prevB = null, prevQ = null, prevHuman = null, prevNum = null;
    for (var s = startSlotSec; s <= endSlotSec; s += bucket) {
      var row = bySlot[s] || null;
      var entry = null;
      if (row) {
        var oB = String(row.open_base), oQ = String(row.open_quote);
        var cB = String(row.close_base), cQ = String(row.close_quote);
        var hB = String(row.high_base), hQ = String(row.high_quote);
        var lB = String(row.low_base), lQ = String(row.low_quote);
        if (_isIntStr(oB) && _isIntStr(oQ) && _isIntStr(cB) && _isIntStr(cQ) &&
          _isIntStr(hB) && _isIntStr(hQ) && _isIntStr(lB) && _isIntStr(lQ)) {
          var o = Format.formatPrice(oB, precs[baseId], oQ, precs[quoteId], PRICE_PLACES);
          var h = Format.formatPrice(hB, precs[baseId], hQ, precs[quoteId], PRICE_PLACES);
          var l = Format.formatPrice(lB, precs[baseId], lQ, precs[quoteId], PRICE_PLACES);
          var c = Format.formatPrice(cB, precs[baseId], cQ, precs[quoteId], PRICE_PLACES);
          var bv = row.base_volume !== undefined && row.base_volume !== null ? String(row.base_volume) : null;
          var qv = row.quote_volume !== undefined && row.quote_volume !== null ? String(row.quote_volume) : null;
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
    return { bucket: bucket, start: startISO, end: endISO, buckets: out, closes: closes };
  }

  return {
    timeframes: timeframes,
    candles: candles
  };
})();

if (typeof module !== "undefined") { module.exports = MarketCandles; }
