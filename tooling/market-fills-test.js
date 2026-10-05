#!/usr/bin/env node
/* market-fills-test: unit vectors for MarketFills (deep-candles plan Task 1).
 * Stdlib only. Exit 0 = all pass, 1 = any failure. */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
globalThis.Chain = { call: function () { return Promise.reject(new Error("no chain in vectors")); } };
/* HistoryCap seam preload (Phase 4b migration: esFills routes through the
 * central gateway; esAllowed() fails open without Store, fetch stays stubbed). */
globalThis.HistoryCap = require("/workspace/vanilla/js/api/history-cap.js");
var MF = require("/workspace/vanilla/js/api/market-fills-history.js");
var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}

/* 1-2: merge chain-wins vector (plan Task 1 Step 1 verbatim). */
var chain = [
  { timeMs: 1000 * 3600 * 10, open: "2.0", high: "2.0", low: "2.0", close: "2.0", baseVolume: "1.0", volumeBaseRaw: "100000", volumeQuoteRaw: "50000", highBase: "1", highQuote: "1", lowBase: "1", lowQuote: "1" }
];
var es = [
  { timeMs: 1000 * 3600 * 7, open: "1.0", high: "1.0", low: "1.0", close: "1.0", baseVolume: "1.0", volumeBaseRaw: "100000", volumeQuoteRaw: "100000", highBase: "1", highQuote: "1", lowBase: "1", lowQuote: "1" },
  { timeMs: 1000 * 3600 * 10, open: "9.0", high: "9.0", low: "9.0", close: "9.0", baseVolume: "9.0", volumeBaseRaw: "9", volumeQuoteRaw: "9", highBase: "9", highQuote: "9", lowBase: "9", lowQuote: "9" }
];
var merged = MF.mergeDeep(chain, es, 2000);
eq(merged.length, 2, "merge keeps both slots");
eq(merged[1].close, "2.0", "chain wins overlap");

/* 3: merge cap slices the oldest off. */
var many = [1, 2, 3, 4, 5].map(function (h) {
  return { timeMs: 1000 * 3600 * h, close: String(h) };
});
eq(MF.mergeDeep(many, [], 3).map(function (b) { return b.close; }), ["3", "4", "5"], "mergeDeep slices last cap");

/* 4-6: bucket orientation vector — opposite-direction fills, same slot,
 * same oriented price, base-leg volume summed. Base 1.3.0 prec 5,
 * quote 1.3.113 prec 4: 1.0/0.5 and 2.0/1.0 both price 2.0. */
var fills = [
  { time: "2026-09-01T10:15:00Z", paid: { amount: "100000", asset: "1.3.0" }, received: { amount: "5000", asset: "1.3.113" } },
  { time: "2026-09-01T10:45:00Z", paid: { amount: "10000", asset: "1.3.113" }, received: { amount: "200000", asset: "1.3.0" } }
];
var buckets = MF.fillsToCandles(fills, 3600, "1.3.0", 5, 4, "1.3.113");
var slot = Math.floor(Date.parse("2026-09-01T10:00:00Z") / 1000) * 1000;
eq(buckets.length, 1, "orientation fills share one bucket");
eq(buckets.length ? buckets[0].timeMs : null, slot, "bucket slotted by floor(unix/bucket)");
eq(buckets.length ? buckets[0].close : null, "2.000", "oriented price base-per-quote (4 sig figs, was 2.00000000 at fixed 8)");
eq(buckets.length ? buckets[0].baseVolume : null, globalThis.Format.formatAmount("300000", 5), "base-leg volume summed");

/* 7-9: leg-guard vector — esFill accepts the pair, rejects strangers. */
function hit(opType, pays, recv) {
  return { _source: { operation_type: opType, operation_history: { op_object: { pays: pays, receives: recv, is_maker: false } }, block_data: { block_time: "2026-09-01T10:15:00Z" } } };
}
eq(MF.esFill(hit("4", { amount: "100", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.113" }), "1.3.0", "1.3.113") !== null, true, "leg-guard accepts market pair");
eq(MF.esFill(hit("4", { amount: "100", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.999" }), "1.3.0", "1.3.113"), null, "leg-guard rejects foreign leg");
eq(MF.esFill(hit("63", { amount: "100", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.113" }), "1.3.0", "1.3.113"), null, "leg-guard rejects non-op-4");

/* 10-11: esQuery shape — op-4 kibana_fills contract. */
var q = MF.esQuery("BTS", "USD");
eq(q.size, 500, "esQuery size 500");
eq(JSON.stringify(q.query).indexOf('"operation_type":"4"') !== -1, true, "esQuery filters operation_type 4");
eq(JSON.stringify(q.sort).indexOf("block_data.block_time") !== -1 && JSON.stringify(q.sort).indexOf("desc") !== -1, true, "esQuery sorts block_time desc");
eq(q._source.slice().sort(), ["account_history", "block_data", "operation_history", "operation_type"], "esQuery _source legs");

/* 12-13: MarketCandles deep orchestration (plan Task 2 Step 1 verbatim,
 * plus a fast fetch stub so ES degrades to chain without network). */
(async () => {
  /* 14-18: ES capped search_after pagination (offline, fetch stubbed).
   * 500/page, max 2 pages = 1000 events, 15s total budget (lazy-deep audit
   * 2026-10-01: 672KB/page measured — the 4-page/2000 cap cost ~3MB per fill
   * and no caller needs 2000 events for a 200-bucket window). */
  function mkPageHit(tag, idx) {
    return {
      _source: {
        operation_type: "4",
        operation_history: { op_object: { pays: { amount: "100", asset_id: "1.3.0" }, receives: { amount: "200", asset_id: "1.3.113" } } },
        block_data: { block_time: "2026-09-01T10:15:00Z" }
      },
      sort: [tag + "-" + idx]
    };
  }
  function pageOf(n, tag) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(mkPageHit(tag, i));
    return a;
  }
  try {
    var _f0 = globalThis.fetch;
    var pages = [pageOf(500, "p1"), pageOf(2, "p3")];
    var calls = 0, bodies = [];
    globalThis.fetch = function (url, opts) {
      calls++;
      bodies.push(opts && opts.body ? String(opts.body) : "");
      var hits = pages[Math.min(calls - 1, pages.length - 1)] || [];
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ hits: { hits: hits } }); } });
    };
    var pres = await MF.esFills("1.3.0", "1.3.113", 2000);
    eq(pres.fills.length, 502, "es pagination 2-page merge");
    eq(calls, 2, "es pagination short-page stop (2nd <500)");
    var b2 = JSON.parse(bodies[1]);
    eq(!!b2.search_after, true, "es pagination uses search_after");
    eq(JSON.stringify(b2.search_after), JSON.stringify(["p1-499"]), "es pagination search_after = last sort");
    if (_f0 !== undefined) { globalThis.fetch = _f0; } else { delete globalThis.fetch; }
  } catch (e) { fail++; console.log("FAIL es pagination 2-page\n " + (e && e.stack || e)); if (typeof _f0 !== "undefined" && _f0 !== undefined) { globalThis.fetch = _f0; } else { delete globalThis.fetch; } }
  try {
    var _f1 = globalThis.fetch;
    var c1 = 0;
    globalThis.fetch = function () {
      c1++;
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ hits: { hits: pageOf(2, "s1") } }); } });
    };
    var r1 = await MF.esFills("1.3.0", "1.3.113", 2000);
    eq(r1.fills.length, 2, "es short page returns 2");
    eq(c1, 1, "es short-page stops after 1 fetch");
    if (_f1 !== undefined) { globalThis.fetch = _f1; } else { delete globalThis.fetch; }
  } catch (e) { fail++; console.log("FAIL es short-page stop\n " + (e && e.stack || e)); if (typeof _f1 !== "undefined" && _f1 !== undefined) { globalThis.fetch = _f1; } else { delete globalThis.fetch; } }
  try {
    var _f2 = globalThis.fetch;
    var c2 = 0;
    globalThis.fetch = function () {
      c2++;
      var hits = pageOf(500, "c" + c2);
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ hits: { hits: hits } }); } });
    };
    var r2 = await MF.esFills("1.3.0", "1.3.113", 5000);
    eq(c2, 2, "es cap respects max 2 pages");
    eq(r2.fills.length <= 1000, true, "es cap respects 1000 events");
    if (_f2 !== undefined) { globalThis.fetch = _f2; } else { delete globalThis.fetch; }
  } catch (e) { fail++; console.log("FAIL es cap respect\n " + (e && e.stack || e)); if (typeof _f2 !== "undefined" && _f2 !== undefined) { globalThis.fetch = _f2; } else { delete globalThis.fetch; } }
  /* 19-21: lazy-deep — candles() resolves chain-first even when ES hangs
   * forever, and deepen() merges the backfill when ES lands (offline). */
  try {
    var _f3 = globalThis.fetch;
    globalThis.fetch = function () { return new Promise(function () {}); };
    var slotISO = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString().slice(0, -5);
    function chainStub() {
      return {
        history: function () { return Promise.resolve(2); },
        db: function () { return Promise.resolve(1); },
        call: function (api, m) {
          if (m === "get_market_history_buckets") return Promise.resolve([3600]);
          if (m === "get_market_history") return Promise.resolve([{
            key: { open: slotISO },
            open_base: "100000", open_quote: "5000",
            close_base: "100000", close_quote: "5000",
            high_base: "100000", high_quote: "5000",
            low_base: "100000", low_quote: "5000",
            base_volume: "100000", quote_volume: "5000"
          }]);
          if (m === "get_assets") return Promise.resolve([{ precision: 5 }, { precision: 4 }]);
          return Promise.resolve([]);
        }
      };
    }
    globalThis.Chain = chainStub();
    delete require.cache[require.resolve("/workspace/vanilla/js/api/market-candles.js")];
    var MC2 = require("/workspace/vanilla/js/api/market-candles.js");
    var rc = await Promise.race([
      MC2.candles("1.3.0", "1.3.113", 3600, 5),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error("candles waited on ES")); }, 3000); })
    ]);
    eq(Array.isArray(rc.buckets), true, "lazy candles resolve with hanging ES");
    eq(rc.deep, false, "lazy candles chain-only while ES hangs");
    eq(rc.buckets.length, 1, "lazy candles paint the chain row (leading gaps dropped)");
    if (_f3 !== undefined) { globalThis.fetch = _f3; } else { delete globalThis.fetch; }
  } catch (e) { fail++; console.log("FAIL lazy candles hang\n " + (e && e.stack || e)); if (typeof _f3 !== "undefined" && _f3 !== undefined) { globalThis.fetch = _f3; } else { delete globalThis.fetch; } }
  try {
    var _f4 = globalThis.fetch;
    var hits2 = pageOf(2, "d1");
    globalThis.fetch = function () {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ hits: { hits: hits2 } }); } });
    };
    var dd = await MC2.deepen("1.3.0", "1.3.113", 3600);
    eq(dd && dd.fills, 2, "deepen fetches ES backfill");
    var rd = await MC2.candles("1.3.0", "1.3.113", 3600, 5);
    eq(rd.deep, true, "candles merge the deep cache");
    if (_f4 !== undefined) { globalThis.fetch = _f4; } else { delete globalThis.fetch; }
  } catch (e) { fail++; console.log("FAIL deepen merge\n " + (e && e.stack || e)); if (typeof _f4 !== "undefined" && _f4 !== undefined) { globalThis.fetch = _f4; } else { delete globalThis.fetch; } }
  try {
    var _fetch = globalThis.fetch;
    globalThis.fetch = function () { return Promise.reject(new Error("no net in test")); };
    globalThis.Chain = { history: () => Promise.resolve(2), call: (api, m) => Promise.resolve([]), db: () => Promise.resolve(1) };
    delete require.cache[require.resolve("/workspace/vanilla/js/api/market-candles.js")];
    const MC = require("/workspace/vanilla/js/api/market-candles.js");
    const r = await MC.candles("1.3.113", "1.3.0", 3600, 5);
    eq(Array.isArray(r.buckets), true, "candles returns buckets");
    eq(r.buckets.length <= 2000, true, "candles capped 2000");
    if (_fetch !== undefined) { globalThis.fetch = _fetch; } else { delete globalThis.fetch; }
  } catch (e) { fail++; console.log("FAIL candles deep path\n " + (e && e.stack || e)); }
  console.log("market-fills-test: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
