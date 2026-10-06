"use strict";
var FeedHistory = require("/workspace/vanilla/js/api/feed-history.js");
var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}
eq(typeof FeedHistory.medianOf, "function", "medianOf exists");
eq(FeedHistory.medianOf(["1.5", "1.7", "1.6"]), "1.6", "median of 3");
eq(FeedHistory.medianOf([]), null, "median empty -> null");
eq(FeedHistory.normToBackingPerMpa("2", true), "0.5", "flipped inverts");
eq(FeedHistory.badgeFor({ witnessHit: true }, { witnessFed: true }), "witness", "witness badge");
eq(FeedHistory.badgeFor({}, { witnessFed: false }), "producer", "default producer");
eq(FeedHistory.isFeedOp({ op: [19, { asset_id: "1.3.5" }] }, "1.3.5"), true, "op19 match");
eq(FeedHistory.isFeedOp({ op: [19, { asset_id: "1.3.5" }] }, "1.3.9"), false, "op19 asset mismatch");
eq(FeedHistory.isFeedOp({ op: [0, {}] }, "1.3.5"), false, "non-19 rejected");
eq(FeedHistory.fillToBackingPerMpa({ base: "2", quote: "1" }, false), "2", "fill straight");
eq(FeedHistory.fillToBackingPerMpa({ base: "2", quote: "1" }, true), "0.5", "fill flipped");
// bucketAll: median of actives, gap when active < minFeeds (never zero-fill).
(function () {
  var byPub = {
    "1.2.1": [{ t: 1000, priceHuman: "1.5" }, { t: 2000, priceHuman: "1.7" }],
    "1.2.2": [{ t: 1000, priceHuman: "1.9" }]
  };
  var g = FeedHistory.bucketAll(byPub, [], [], { start: 1000, stop: 3000, bucketSec: 1000, minFeeds: 2, lifetimeSec: 1500 });
  eq(g.times, [1000, 2000, 3000], "bucket times");
  eq(g.series.length, 4, "producers + MEDIAN + EXCHANGE");
  eq(g.series[2], { name: "MEDIAN", values: ["1.9", "1.9", null] }, "median then gap");
})();
// publisherPoints orientation: backing-per-MPA (matches exchange/pool overlays).
// Live HONEST.BTC legs: base 1603644699 (prec 8) / quote 100000000000000 (BTS prec 5).
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
globalThis.Account = {
  historyPaged: async function () {
    return { rows: [{
      id: "1.11.1398881145", block_num: 114999464, block_time: "2026-10-06T22:43:33",
      op: [19, { asset_id: "1.3.5650",
        feed: { settlement_price: {
          base: { amount: "1603644699", asset_id: "1.3.5650" },
          quote: { amount: "100000000000000", asset_id: "1.3.0" } } } }]
    }], truncated: false };
  }
};
globalThis.Market = {
  trades: async function (baseId, quoteId, limit) {
    eq([baseId, quoteId, limit], ["1.3.0", "1.3.5", 100], "trades args backing/mpa/100");
    return [
      { time: "2026-10-06T22:10:42", priceExact: "34.5", displayPrice: "34.5" },
      { time: null, priceExact: "35.5" },
      { time: "2026-10-06T22:11:42", priceExact: null }
    ];
  }
};
// poolLines: Pool.list + swapsForPool {swaps} envelope + priceHuman delegation.
globalThis.Chain = {
  db: async function () { return 2; },
  call: async function (db, method, params) {
    if (method === "get_assets") return [{ id: "1.3.5", precision: 4 }, { id: "1.3.0", precision: 5 }];
    throw new Error("unexpected " + method);
  }
};
globalThis.Pool = {
  list: async function (opts) {
    eq(opts, { assetA: "1.3.5", assetB: "1.3.0" }, "pool list pair");
    return [{ id: "1.19.2" }, { id: "1.19.8" }];
  }
};
globalThis.PoolHistory = {
  swapsForPool: async function (pid, limit, opts) {
    eq([pid, limit], ["1.19.2", 100], "swaps args");
    eq(opts, { legA: "1.3.5", legB: "1.3.0" }, "swaps legs");
    return { swaps: [{ time: "2026-10-06T22:10:42", paid: { amount: "1", asset: "1.3.5" }, received: { amount: "2", asset: "1.3.0" } }], source: "chain" };
  },
  priceHuman: function (sw, pA, pB, aA, aB) {
    eq([pA, pB, aA, aB], [4, 5, "1.3.5", "1.3.0"], "pool priceHuman orientation");
    return "2";
  }
};
(async function () {
  var btc = await FeedHistory.publisherPoints("1.2.581357", "1.3.5650", { mpaPrec: 8, backingPrec: 5 });
  eq(btc.length, 1, "one btc feed point");
  eq(btc[0].priceHuman, "62357952.52050404", "backing-per-MPA orientation");
  var ex = await FeedHistory.exchangePoints("1.3.5", "1.3.0");
  eq(ex, [{ t: Math.floor(Date.parse("2026-10-06T22:10:42Z") / 1000), priceHuman: "34.5" }], "exchange maps trades envelope, drops bad rows");
  var pls = await FeedHistory.poolLines("1.3.5", "1.3.0", 1);
  eq(pls.length, 1, "pool cap respected");
  eq(pls[0].poolId, "1.19.2", "pool id");
  eq(pls[0].points.length, 1, "one swap point");
  eq(typeof pls[0].points[0].t, "number", "point time numeric");
  eq(pls[0].points[0].priceHuman, "2", "pool price via priceHuman");
  if (fail) { console.log(pass + " pass " + fail + " fail"); process.exit(1); }
  console.log("all pass");
})().catch(function (e) { console.log("FAIL async: " + (e && e.stack || e)); process.exit(1); });
