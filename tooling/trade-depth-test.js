#!/usr/bin/env node
/* trade-depth-test: unit vectors for Market.tradesDeep (Phase 7 B1).
 * Stdlib only, stubbed global.Chain recording method+args, no network.
 * Exit 0 = all pass, 1 = any failure. */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");

var BASE = "1.3.0", QUOTE = "1.3.113";
var PRECS = [{ precision: 5 }, { precision: 4 }];
var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL " + name); }
}

/* Fill-history-shaped row (trades() envelope path: row.op.fill_price). */
function fillRow(t, bAmt, qAmt) {
  return {
    time: t,
    op: { fill_price: { base: { amount: bAmt, asset_id: BASE }, quote: { amount: qAmt, asset_id: QUOTE } } }
  };
}

/* Stub Chain: script = array of get_trade_history pages (or Error to throw);
 * records every call in rec.calls. get_assets resolves precisions. */
function stubChain(script, opts) {
  opts = opts || {};
  var rec = { calls: [] };
  globalThis.Chain = {
    db: function () {
      if (opts.dbReject) return Promise.reject(new Error("no db api"));
      return Promise.resolve(1);
    },
    history: function () {
      if (opts.historyReject) return Promise.reject(new Error("no history api"));
      return Promise.resolve(2);
    },
    call: function (apiId, method, args) {
      rec.calls.push({ api: apiId, method: method, args: args });
      if (method === "get_assets") return Promise.resolve(PRECS);
      if (method === "get_trade_history") {
        if (opts.callReject) return Promise.reject(new Error("history plugin disabled"));
        var page = script[rec.calls.filter(function (c) { return c.method === "get_trade_history"; }).length - 1];
        if (page instanceof Error) return Promise.reject(page);
        return Promise.resolve(page || []);
      }
      if (method === "get_fill_order_history") return Promise.resolve(opts.fillRows || []);
      return Promise.resolve([]);
    }
  };
  return rec;
}
function tradeCalls(rec) {
  return rec.calls.filter(function (c) { return c.method === "get_trade_history"; });
}
function freshMarket() {
  delete require.cache[require.resolve("/workspace/vanilla/js/api/market.js")];
  return require("/workspace/vanilla/js/api/market.js");
}

(async () => {
  var M, rec, tcs, out;

  /* 1-5: arg order [base, quote, latestISO, earliestISO, limit], ISO math. */
  M = freshMarket();
  rec = stubChain([[]], {});
  out = await M.tradesDeep(BASE, QUOTE, { days: 2, limit: 3 });
  tcs = tradeCalls(rec);
  eq(tcs.length, 1, "empty first page makes exactly 1 call");
  eq(out, [], "empty window is VALID ([])");
  eq(tcs[0].args.slice(0, 2), [BASE, QUOTE], "arg order [base, quote, ...]");
  eq(tcs[0].args[4], 3, "per-window limit passed through");
  ok(ISO_RE.test(tcs[0].args[2]) && ISO_RE.test(tcs[0].args[3]), "window bounds are ISO strings");
  ok(tcs[0].args[2] > tcs[0].args[3], "latest bound (arg2) > earliest bound (arg3)");
  eq(Date.parse(tcs[0].args[2] + "Z") - Date.parse(tcs[0].args[3] + "Z"), 86400000, "window spans exactly one day");

  /* 6-8: contiguous disjoint day windows stepping backward. */
  M = freshMarket();
  var full = [fillRow("2026-09-01T10:00:00", "100000", "5000"), fillRow("2026-09-01T09:00:00", "200000", "8000")];
  rec = stubChain([full.slice(), full.slice(), [fillRow("2026-08-30T10:00:00", "100000", "5000")]], {});
  out = await M.tradesDeep(BASE, QUOTE, { days: 3, limit: 2 });
  tcs = tradeCalls(rec);
  eq(tcs.length, 3, "3 full/short days make 3 calls");
  eq(tcs[1].args[2], tcs[0].args[3], "page1 latest == page0 earliest (contiguous)");
  eq(tcs[2].args[2], tcs[1].args[3], "page2 latest == page1 earliest (disjoint, no overlap)");

  /* 9: chunk bound — 30 requested days, full pages, <=8 calls. */
  M = freshMarket();
  var pages = [];
  for (var d = 0; d < 30; d++) pages.push(full.slice());
  rec = stubChain(pages, {});
  await M.tradesDeep(BASE, QUOTE, { days: 30, limit: 2 });
  tcs = tradeCalls(rec);
  eq(tcs.length, 8, "full windows bounded at 8 calls");

  /* 10-11: short-page stop. */
  M = freshMarket();
  rec = stubChain([full.slice(), [fillRow("2026-08-31T10:00:00", "100000", "5000")]], {});
  out = await M.tradesDeep(BASE, QUOTE, { days: 7, limit: 2 });
  tcs = tradeCalls(rec);
  eq(tcs.length, 2, "short page stops the walk");
  eq(out.length, 3, "short-page rows merged");

  /* 12-13: dedupe — shared row across pages appears once, newest-first. */
  M = freshMarket();
  var A = fillRow("2026-09-01T10:00:00", "100000", "5000");
  var B = fillRow("2026-09-01T09:00:00", "200000", "8000");
  var C = fillRow("2026-08-31T10:00:00", "300000", "9000");
  var D = fillRow("2026-08-31T09:00:00", "400000", "7000");
  rec = stubChain([[A, B, JSON.parse(JSON.stringify(C))], [JSON.parse(JSON.stringify(C)), D]], {});
  out = await M.tradesDeep(BASE, QUOTE, { days: 2, limit: 3 });
  eq(out.map(function (r) { return r.time; }),
    ["2026-09-01T10:00:00", "2026-09-01T09:00:00", "2026-08-31T10:00:00", "2026-08-31T09:00:00"],
    "dedupe keeps first (newest) occurrence, newest-first order");

  /* 14-16: envelope parity — tradesDeep single page deep-equals trades(). */
  M = freshMarket();
  var rows = [fillRow("2026-09-01T10:00:00", "100000", "5000"), { time: "2026-09-01T08:00:00", junk: true }];
  rec = stubChain([rows.slice()], { fillRows: rows.slice() });
  var deep = await M.tradesDeep(BASE, QUOTE, { days: 1, limit: 10 });
  var shallow = await M.trades(BASE, QUOTE, 10);
  eq(deep, shallow, "tradesDeep envelope deep-equals trades() envelope");
  eq(Object.keys(deep[0]).sort(), ["baseAmount", "displayPrice", "quoteAmount", "raw", "time"], "envelope keys match trades()");
  eq([deep[1].displayPrice, deep[1].baseAmount, deep[1].quoteAmount], [null, null, null], "unmappable row is nulls, not a reject");

  /* 17: market_trade chain shape — human strings + date, time falls back to date. */
  M = freshMarket();
  rec = stubChain([[{ sequence: 42, date: "2026-09-01T10:00:00", price: "2.5", amount: "1.0", value: "2.5", type: "buy" }]], {});
  out = await M.tradesDeep(BASE, QUOTE, { days: 1, limit: 10 });
  eq(out.length, 1, "market_trade row accepted");
  eq(out[0].time, "2026-09-01T10:00:00", "market_trade time falls back to row.date");
  eq([out[0].displayPrice, out[0].baseAmount, out[0].quoteAmount], [null, null, null], "market_trade has no fill_price so amounts stay null");

  /* 18-19: db-reject and window-reject map to history-unavailable. */
  M = freshMarket();
  stubChain([[]], { dbReject: true });
  try { await M.tradesDeep(BASE, QUOTE, { days: 2 }); fail++; console.log("FAIL db-reject should throw"); }
  catch (e) { eq(String(e && e.message), "history-unavailable", "db-reject maps to history-unavailable"); }
  M = freshMarket();
  stubChain([[]], { callReject: true });
  try { await M.tradesDeep(BASE, QUOTE, { days: 2 }); fail++; console.log("FAIL call-reject should throw"); }
  catch (e) { eq(String(e && e.message), "history-unavailable", "window-reject maps to history-unavailable"); }

  /* 20-21: bad opts rejected, never sent. */
  M = freshMarket();
  rec = stubChain([[]], {});
  try { await M.tradesDeep(BASE, QUOTE, { days: 0 }); fail++; console.log("FAIL days:0 should throw"); }
  catch (e) { ok(/bad days/.test(String(e && e.message)), "days:0 rejected"); }
  try { await M.tradesDeep(BASE, QUOTE, { limit: 0 }); fail++; console.log("FAIL limit:0 should throw"); }
  catch (e) { ok(/bad limit/.test(String(e && e.message)), "limit:0 rejected"); }
  eq(tradeCalls(rec).length, 0, "invalid opts send no WS calls");

  console.log("trade-depth-test: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
