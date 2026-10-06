/* FeedHistory: chain-only feed/exchange/pool history data (no DOM, no signing).
 * Owns: orientation normalize, median, bucket grid for the #/assets/feed chart.
 * Consumes: Chain (call time), Account.historyPaged, MarketFills.chainFills,
 *   Pool.list, PoolHistory.swapsForPool, Format (all guarded at call time).
 * Globals/side effects: global FeedHistory only.
 * Created by: feed-history plan Task 1.
 */
var FeedHistory = (function () {
  "use strict";
  function _decFrac(s) {
    var m = /^(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
    if (!m) return null;
    var frac = m[2] || "";
    var num;
    try { num = BigInt(m[1] + frac); } catch (e) { return null; }
    var den = 1n, i;
    for (i = 0; i < frac.length; i++) den *= 10n;
    return { num: num, den: den };
  }
  function _cmpHuman(a, b) {
    var fa = _decFrac(a), fb = _decFrac(b);
    if (!fa || !fb) return 0;
    var l = fa.num * fb.den, r = fb.num * fa.den;
    if (l < r) return -1;
    if (l > r) return 1;
    return 0;
  }
  function medianOf(humans) {
    var arr = (humans || []).filter(function (x) { return typeof x === "string" && _decFrac(x); });
    if (!arr.length) return null;
    arr.sort(_cmpHuman);
    return arr[Math.floor(arr.length / 2)];
  }
  function normToBackingPerMpa(priceHuman, pairFlipped) {
    if (!pairFlipped) return String(priceHuman);
    var f = _decFrac(priceHuman);
    if (!f || f.num === 0n) return String(priceHuman);
    var scale = 100000000n;
    var inv = (f.den * scale) / f.num;
    var s = inv.toString();
    while (s.length < 9) s = "0" + s;
    var head = s.slice(0, -8).replace(/^0+(?=\d)/, "") || "0";
    var tail = s.slice(-8).replace(/0+$/, "");
    return tail ? head + "." + tail : head;
  }
  function bucketAll(feedPtsByProducer, exPts, poolPtsList, opts) {
    opts = opts || {};
    var start = opts.start || 0, stop = opts.stop || 0, step = opts.bucketSec || 3600;
    var minFeeds = (opts.minFeeds === undefined || opts.minFeeds === null) ? 1 : opts.minFeeds;
    var lifetime = (opts.lifetimeSec === undefined || opts.lifetimeSec === null) ? 86400 : opts.lifetimeSec;
    if (!(stop > start) || !(step > 0)) return { times: [], series: [] };
    var times = [], t;
    for (t = start; t <= stop; t += step) times.push(t);
    var pubs = Object.keys(feedPtsByProducer || {});
    function lastKnown(pts, bt) {
      var best = null, i;
      for (i = 0; i < (pts || []).length; i++) {
        if (pts[i].t <= bt) best = pts[i];
        else break;
      }
      return best;
    }
    var series = [], prodVals = {}, b, i;
    pubs.forEach(function (p) { prodVals[p] = []; });
    var medVals = [];
    for (b = 0; b < times.length; b++) {
      var bt = times[b], actives = [];
      for (i = 0; i < pubs.length; i++) {
        var lk = lastKnown((feedPtsByProducer || {})[pubs[i]], bt);
        if (lk && (bt - lk.t) <= lifetime) { prodVals[pubs[i]].push(lk.priceHuman); actives.push(lk.priceHuman); }
        else prodVals[pubs[i]].push(null);
      }
      medVals.push(actives.length >= minFeeds ? medianOf(actives) : null);
    }
    pubs.forEach(function (p) { series.push({ name: p, values: prodVals[p] }); });
    series.push({ name: "MEDIAN", values: medVals });
    function resample(pts) {
      var vals = [], k;
      for (k = 0; k < times.length; k++) {
        var lk2 = lastKnown(pts || [], times[k]);
        vals.push(lk2 ? lk2.priceHuman : null);
      }
      return vals;
    }
    series.push({ name: "EXCHANGE", values: resample(exPts || []) });
    (poolPtsList || []).forEach(function (pl) {
      series.push({ name: "POOL " + pl.poolId, values: resample(pl.points || []) });
    });
    return { times: times, series: series };
  }
  var WITNESS_FED = 128, COMMITTEE_FED = 256;
  function badgeFor(acct, flags) {
    if (acct && acct.witnessHit) return "witness";
    if (acct && acct.committeeHit) return "committee";
    return "producer";
  }
  async function _dbCall(method, params) {
    var dbId = await Chain.db();
    return Chain.call(dbId, method, params || []);
  }
  async function producersFor(symbolOrId) {
    if (typeof Asset === "undefined" || !Asset.describe) throw new Error("asset-unavailable");
    var info = await Asset.describe(symbolOrId);
    if (!info.is_smartcoin) throw new Error("not-market-issued");
    var bid = info.bitasset_data_id;
    var objs = bid ? await _dbCall("get_objects", [[bid]]) : [];
    var bit = (objs && objs[0]) || {};
    var feeds = bit.feeds || [];
    var flags = info.flags || 0;
    var witnessFed = (flags & WITNESS_FED) !== 0, committeeFed = (flags & COMMITTEE_FED) !== 0;
    var live = feeds.map(function (f) {
      return { publisher: f[0], time: (f[1] && f[1][0]) || null, feed: (f[1] && f[1][1]) || null };
    });
    return { asset: info, bitasset: bit, flags: flags, witnessFed: witnessFed, committeeFed: committeeFed, live: live, authorized: live.map(function (l) { return { id: l.publisher, name: "", kind: "producer" }; }) };
  }
  function isFeedOp(entry, assetId) {
    var o = null;
    if (entry && Array.isArray(entry.op)) o = entry.op;
    else if (entry && entry.op && Array.isArray(entry.op)) o = entry.op;
    if (!o || o[0] !== 19) return false;
    var d = o[1] || {};
    return d.asset_id === assetId;
  }
  async function publisherPoints(publisherId, assetId, opts) {
    opts = opts || {};
    var mpaPrec = opts.mpaPrec, backingPrec = opts.backingPrec;
    var walk = await Account.historyPaged(publisherId, 100, 5);
    var rows = walk.rows || [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var e = rows[i];
      if (e && Array.isArray(e) && e[1]) e = e[1];
      if (!isFeedOp(e, assetId)) continue;
      var op = e.op[1], feed = op.feed || {};
      var sp = feed.settlement_price || {};
      if (!sp.base || !sp.quote) continue;
      var t = e.block_time || e.timestamp || null;
      var human = null;
      try { human = Format.formatPrice(String(sp.base.amount), mpaPrec, String(sp.quote.amount), backingPrec, 8); }
      catch (err) { continue; }
      var ts = _toUnix(t);
      if (!(ts > 0)) continue;
      out.push({ t: ts, priceHuman: human });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    var seen = {}, ded = [];
    out.forEach(function (p) { if (!seen[p.t]) { seen[p.t] = 1; ded.push(p); } });
    return ded;
  }
  function fillToBackingPerMpa(fill, flipped) {
    var p = (fill && fill.priceHuman !== undefined) ? String(fill.priceHuman) : String((fill && fill.base) || "");
    if (fill && fill.priceHuman !== undefined) return normToBackingPerMpa(p, !!flipped);
    return normToBackingPerMpa(p, !!flipped);
  }
  /* ISO/block-time -> unix seconds (pure). Numeric strings pass through
   * (ms detected by magnitude); zone-less ISO is UTC (chain times are UTC —
   * a trailing Z is added only when no zone designator is present, so a
   * double-Z can never form). Unparseable -> 0 (caller drops it, never plots). */
  function _toUnix(t) {
    if (t === null || t === undefined) return 0;
    var s = String(t).trim();
    if (/^\d+$/.test(s)) {
      var n = parseInt(s, 10);
      return n > 100000000000 ? Math.floor(n / 1000) : n;
    }
    if (s.indexOf("T") === -1) s = s.replace(" ", "T");
    if (!(/[zZ]|([+-]\d{2}:?\d{2})$/.test(s))) s += "Z";
    var ms = Date.parse(s);
    return isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }
  /* Pair precisions for the overlay price helpers (callers pass them in opts
   * when known; otherwise one get_assets read, 5/5 honest fallback). */
  async function _precisions(mpaId, backingId, opts) {
    opts = opts || {};
    if (Number.isInteger(opts.mpaPrec) && Number.isInteger(opts.backingPrec)) {
      return { mpaPrec: opts.mpaPrec, backingPrec: opts.backingPrec };
    }
    var mp = 5, bp = 5;
    try {
      var db = await Chain.db();
      var metas = await Chain.call(db, "get_assets", [[mpaId, backingId]]);
      (metas || []).forEach(function (a) {
        if (a && a.id === mpaId && Number.isInteger(a.precision)) mp = a.precision;
        if (a && a.id === backingId && Number.isInteger(a.precision)) bp = a.precision;
      });
    } catch (e) { /* 5s stand */ }
    return { mpaPrec: mp, backingPrec: bp };
  }
  /* Exchange overlay: DEX fills for backing/mpa as backing-per-MPA points
   * (chain-first, oldest-last). Primary: Market.trades (own envelope is
   * already base-per-quote with exact 8-place strings); fallback: chainFills
   * rows via the exported MarketFills.priceHuman. Fail-closed to [] (the feed
   * lines stand alone with a muted note — never a blank chart). */
  async function exchangePoints(mpaId, backingId) {
    try {
      if (typeof Market !== "undefined" && Market && typeof Market.trades === "function") {
        var rows = await Market.trades(backingId, mpaId, 100);
        return (rows || []).map(function (r) {
          var ts = _toUnix(r.time);
          if (!(ts > 0) || !r.priceExact) return null;
          return { t: ts, priceHuman: String(r.priceExact) };
        }).filter(function (x) { return !!x; }).sort(function (a, b) { return a.t - b.t; });
      }
      if (typeof MarketFills === "undefined" || !MarketFills.chainFills) return [];
      var pr = await _precisions(mpaId, backingId, {});
      var res = await MarketFills.chainFills(backingId, mpaId, 100);
      var fills = (res && res.fills) || [];
      return fills.map(function (f) {
        var px = MarketFills.priceHuman(f, backingId, pr.backingPrec, pr.mpaPrec, mpaId, 8);
        var ts = _toUnix(f.time);
        if (!(ts > 0) || !px) return null;
        return { t: ts, priceHuman: px };
      }).filter(function (x) { return !!x; }).sort(function (a, b) { return a.t - b.t; });
    } catch (e) { return []; }
  }
  /* Pool overlays: pools holding mpa+backing (capped), each as backing-per-MPA
   * points via the exported PoolHistory.priceHuman (B-leg per A-leg with
   * A=mpa, B=backing). swapsForPool envelope is {swaps, source} (chain
   * fallback authoritative). Fail-closed per pool (one dead pool never
   * blocks the others). */
  async function poolLines(mpaId, backingId, cap, opts) {
    var n = (cap === undefined || cap === null) ? 3 : cap;
    try {
      if (typeof Pool === "undefined" || !Pool.list) return [];
      if (typeof PoolHistory === "undefined" || !PoolHistory.swapsForPool) return [];
      var pools = await Pool.list({ assetA: mpaId, assetB: backingId });
      pools = (pools || []).slice(0, n);
      var pr = await _precisions(mpaId, backingId, opts);
      var out = [];
      for (var i = 0; i < pools.length; i++) {
        var pid = pools[i].id, swaps = [];
        try {
          var res = await PoolHistory.swapsForPool(pid, 100, { legA: mpaId, legB: backingId });
          swaps = (res && res.swaps) || [];
        } catch (e) { swaps = []; }
        var pts = swaps.map(function (sw) {
          var px = PoolHistory.priceHuman(sw, pr.mpaPrec, pr.backingPrec, mpaId, backingId, 8);
          var ts = _toUnix(sw.time);
          if (!(ts > 0) || !px) return null;
          return { t: ts, priceHuman: px };
        }).filter(function (x) { return !!x; }).sort(function (a, b) { return a.t - b.t; });
        out.push({ poolId: pid, points: pts });
      }
      return out;
    } catch (e) { return []; }
  }
  return { medianOf: medianOf, normToBackingPerMpa: normToBackingPerMpa, bucketAll: bucketAll,
    badgeFor: badgeFor, producersFor: producersFor, WITNESS_FED: WITNESS_FED, COMMITTEE_FED: COMMITTEE_FED,
    isFeedOp: isFeedOp, publisherPoints: publisherPoints,
    fillToBackingPerMpa: fillToBackingPerMpa, exchangePoints: exchangePoints, poolLines: poolLines };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.FeedHistory === "undefined") { globalThis.FeedHistory = FeedHistory; }
if (typeof module !== "undefined") { module.exports = FeedHistory; }
