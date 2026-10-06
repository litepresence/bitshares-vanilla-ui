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
  function bucketAll() { return { times: [], series: [] }; }
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
  return { medianOf: medianOf, normToBackingPerMpa: normToBackingPerMpa, bucketAll: bucketAll,
    badgeFor: badgeFor, producersFor: producersFor, WITNESS_FED: WITNESS_FED, COMMITTEE_FED: COMMITTEE_FED };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.FeedHistory === "undefined") { globalThis.FeedHistory = FeedHistory; }
if (typeof module !== "undefined") { module.exports = FeedHistory; }
