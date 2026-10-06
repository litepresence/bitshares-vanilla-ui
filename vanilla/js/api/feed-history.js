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
  return { medianOf: medianOf, normToBackingPerMpa: normToBackingPerMpa, bucketAll: bucketAll };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.FeedHistory === "undefined") { globalThis.FeedHistory = FeedHistory; }
if (typeof module !== "undefined") { module.exports = FeedHistory; }
