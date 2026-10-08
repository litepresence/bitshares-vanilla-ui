#!/usr/bin/env node
/* market-candles-es-fallback-test: a chain-silent window must still consult
 * the ES backfill instead of returning empty.
 *
 * Audit 2026-10-08: the desk showed "No price history on this market" while
 * the community index held the fills (pruned/gapped history node). candles()
 * used to early-return [] when no chain slot matched, skipping the deep
 * merge entirely. Now the merge runs and ES-only windows paint (deep=true);
 * silent chain + empty cache still resolves the same honest empty.
 * Stdlib only. Exit 0 = all pass, 1 = any failure. */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
globalThis.HistoryCap = require("/workspace/vanilla/js/api/history-cap.js");
var MFreal = require("/workspace/vanilla/js/api/market-fills-history.js");
var MC = require("/workspace/vanilla/js/api/market-candles.js");
var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}

var baseId = "1.3.0", quoteId = "1.3.113";
/* Chain history node with pruned/gapped history: always empty. */
globalThis.Chain = {
  db: function () { return Promise.resolve(1); },
  history: function () { return Promise.resolve(2); },
  call: function (id, method) {
    if (method === "get_market_history_buckets") return Promise.resolve([3600]);
    if (method === "get_assets") return Promise.resolve([{ id: baseId, precision: 5 }, { id: quoteId, precision: 4 }]);
    if (method === "get_market_history") return Promise.resolve([]);
    return Promise.reject(new Error("unexpected " + method));
  }
};
/* One real executed fill (op-4 shape) inside the current hour. */
var slotISO = new Date(Math.floor(Date.now() / 1000 / 3600) * 3600 * 1000).toISOString().slice(0, -5);
var slotMs = Math.floor(Date.parse(slotISO + "Z") / 1000) * 1000;
globalThis.MarketFills = {
  fillsForMarket: function () {
    return Promise.resolve({ fills: [{
      time: slotISO, paid: { amount: "100000", asset: baseId }, received: { amount: "5000", asset: quoteId } }] });
  },
  fillsToCandles: MFreal.fillsToCandles,
  mergeDeep: MFreal.mergeDeep
};

(async function () {
  /* 1-2: silent chain + empty cache = the same honest empty as before. */
  var e = await MC.candles(baseId, quoteId, 3600, 5);
  eq(e.buckets.length, 0, "silent chain, no ES cache: zero buckets");
  eq(e.deep, false, "silent chain, no ES cache: deep false");
  /* 3-5: after deepen(), the same silent window paints ES-only candles. */
  var d = await MC.deepen(baseId, quoteId, 3600);
  eq(!!(d && d.key), true, "deepen stores the ES backfill");
  var c = await MC.candles(baseId, quoteId, 3600, 5);
  eq(c.buckets.length, 1, "silent chain + ES cache: one rescued bucket");
  eq(c.deep, true, "rescued window reports deep true");
  eq(c.buckets.length ? c.buckets[0].timeMs : null, slotMs, "rescued bucket slotted to the fill hour");
  /* 6: rescued window still honors the requested count cap. */
  var c2 = await MC.candles(baseId, quoteId, 3600, 5);
  eq(c2.buckets.length <= 5, true, "rescued window respects the count cap");
  console.log("market-candles-es-fallback: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(function (e) { fail++; console.log("FAIL harness\n " + (e && e.stack || e)); process.exit(1); });
