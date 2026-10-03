#!/usr/bin/env node
/* my-positions-test.js — unit vectors for Market.mySettlements (Phase 7 B4)
 * and Market.myLimitOrders (Phase 7 B5 backend, first page).
 * Stdlib only, stubbed global.Chain recording method+args, no network.
 * `node tooling/my-positions-test.js` (exit 0 = green).
 *
 * Envelope contract (proven below, not assumed):
 * - myLimitOrders returns the SAME raw limit_order_object array as the
 *   existing Market.myOrders reader (market.js) — desk tab
 *   (market-orders.js), trade-cancel.js, account-ui.js open-orders consume
 *   that shape. Vector 13 deep-equals the two for identical stub rows.
 * - mySettlements returns the SAME raw force_settlement_object array as
 *   Market.settleOrders rows — Market.sortSettles consumes it. Vector 14
 *   round-trips stub rows through sortSettles.
 */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");

var ACCT = "1.2.123";
var SETTLE_ROW = { id: "1.4.7", owner: ACCT, balance: { amount: "5000", asset_id: "1.3.113" }, settlement_date: "2026-10-03T10:00:00" };
var LIMIT_ROW = { id: "1.7.9", seller: ACCT, expiration: "2026-10-09T00:00:00", sell_price: { base: { amount: "100000", asset_id: "1.3.0" }, quote: { amount: "5000", asset_id: "1.3.113" } } };

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

/* Stub Chain: records every call in rec.calls. settleRows/limitRows served
 * per method; dbReject/callReject flip the history-unavailable paths;
 * nonArrayRow served verbatim (null or object) for the non-array path. */
function stubChain(opts) {
  opts = opts || {};
  var rec = { calls: [] };
  globalThis.Chain = {
    db: function () {
      if (opts.dbReject) return Promise.reject(new Error("no db api"));
      return Promise.resolve(1);
    },
    call: function (apiId, method, args) {
      rec.calls.push({ api: apiId, method: method, args: args });
      if (opts.callReject) return Promise.reject(new Error("node down"));
      if (method === "get_settle_orders_by_account") {
        return Promise.resolve(opts.settleRows !== undefined ? opts.settleRows : []);
      }
      if (method === "get_limit_orders_by_account") {
        return Promise.resolve(opts.limitRows !== undefined ? opts.limitRows : []);
      }
      return Promise.resolve([]);
    }
  };
  return rec;
}
function freshMarket() {
  delete require.cache[require.resolve("/workspace/vanilla/js/api/market.js")];
  return require("/workspace/vanilla/js/api/market.js");
}
function callsFor(rec, method) {
  return rec.calls.filter(function (c) { return c.method === method; });
}

(async () => {
  var M, rec, out, sc, lc;

  /* 1-3: mySettlements exact method + arg order [account, "1.4.0", limit]. */
  M = freshMarket();
  rec = stubChain({ settleRows: [SETTLE_ROW] });
  out = await M.mySettlements(ACCT, 100);
  sc = callsFor(rec, "get_settle_orders_by_account");
  eq(sc.length, 1, "mySettlements makes exactly 1 db call");
  eq(sc[0].method, "get_settle_orders_by_account", "mySettlements method name");
  eq(sc[0].args, [ACCT, "1.4.0", 100], "mySettlements arg order [account, start, limit]");

  /* 4: default limit 100. */
  M = freshMarket();
  rec = stubChain({ settleRows: [] });
  await M.mySettlements(ACCT);
  eq(callsFor(rec, "get_settle_orders_by_account")[0].args, [ACCT, "1.4.0", 100], "mySettlements default limit 100");

  /* 5-7: myLimitOrders exact method + arg order [account, limit]. */
  M = freshMarket();
  rec = stubChain({ limitRows: [LIMIT_ROW] });
  out = await M.myLimitOrders(ACCT, 100);
  lc = callsFor(rec, "get_limit_orders_by_account");
  eq(lc.length, 1, "myLimitOrders makes exactly 1 db call");
  eq(lc[0].method, "get_limit_orders_by_account", "myLimitOrders method name");
  eq(lc[0].args, [ACCT, 100], "myLimitOrders arg order [account, limit]");

  /* 8: default limit 100. */
  M = freshMarket();
  rec = stubChain({ limitRows: [] });
  await M.myLimitOrders(ACCT);
  eq(callsFor(rec, "get_limit_orders_by_account")[0].args, [ACCT, 100], "myLimitOrders default limit 100");

  /* 9-10: bad account ids throw bad-args pre-network, zero WS calls. */
  var badIds = ["", "1.2", "1.2.x", "1.3.5", "1.4.0", "alice", 123, null, undefined, "2.2.1"];
  M = freshMarket();
  rec = stubChain({});
  var i;
  for (i = 0; i < badIds.length; i++) {
    try { await M.mySettlements(badIds[i], 100); fail++; console.log("FAIL mySettlements accepted " + JSON.stringify(badIds[i])); }
    catch (e) { ok(String(e && e.message) === "bad-args", "mySettlements rejects " + JSON.stringify(badIds[i]) + " with bad-args"); }
    try { await M.myLimitOrders(badIds[i], 100); fail++; console.log("FAIL myLimitOrders accepted " + JSON.stringify(badIds[i])); }
    catch (e) { ok(String(e && e.message) === "bad-args", "myLimitOrders rejects " + JSON.stringify(badIds[i]) + " with bad-args"); }
  }
  eq(rec.calls.length, 0, "bad ids send zero WS calls");

  /* 11: bad limits throw pre-network, zero WS calls. */
  M = freshMarket();
  rec = stubChain({});
  var badLimits = [0, -1, 1.5, "100", NaN, 301, 102];
  for (i = 0; i < badLimits.length; i++) {
    var lim = badLimits[i];
    var fn = lim === 102 ? "myLimitOrders" : "mySettlements";
    if (lim === 102) {
      try { await M.myLimitOrders(ACCT, lim); fail++; console.log("FAIL myLimitOrders accepted limit 102"); }
      catch (e) { ok(String(e && e.message) === "bad-args", "myLimitOrders rejects limit 102 (cap 101)"); }
    } else if (lim === 301) {
      try { await M.mySettlements(ACCT, lim); fail++; console.log("FAIL mySettlements accepted limit 301"); }
      catch (e) { ok(String(e && e.message) === "bad-args", "mySettlements rejects limit 301 (cap 300)"); }
      try { await M.myLimitOrders(ACCT, lim); fail++; console.log("FAIL myLimitOrders accepted limit 301"); }
      catch (e) { ok(String(e && e.message) === "bad-args", "myLimitOrders rejects limit 301 (cap 101)"); }
    } else {
      try { await M.mySettlements(ACCT, lim); fail++; console.log("FAIL mySettlements accepted limit " + JSON.stringify(lim)); }
      catch (e) { ok(String(e && e.message) === "bad-args", "mySettlements rejects limit " + JSON.stringify(lim)); }
      try { await M.myLimitOrders(ACCT, lim); fail++; console.log("FAIL myLimitOrders accepted limit " + JSON.stringify(lim)); }
      catch (e) { ok(String(e && e.message) === "bad-args", "myLimitOrders rejects limit " + JSON.stringify(lim)); }
    }
  }
  eq(rec.calls.length, 0, "bad limits send zero WS calls");

  /* 12: empty rows are VALID ([]). */
  M = freshMarket();
  stubChain({ settleRows: [], limitRows: [] });
  eq(await M.mySettlements(ACCT, 100), [], "mySettlements empty is VALID ([])");
  eq(await M.myLimitOrders(ACCT, 100), [], "myLimitOrders empty is VALID ([])");

  /* 13: non-array rows coerce to [] (same contract as myOrders/settleOrders). */
  M = freshMarket();
  stubChain({ settleRows: null, limitRows: null });
  eq(await M.mySettlements(ACCT, 100), [], "mySettlements null rows coerce to []");
  eq(await M.myLimitOrders(ACCT, 100), [], "myLimitOrders null rows coerce to []");

  /* 14-15: db-reject and call-reject map to history-unavailable (both fns). */
  M = freshMarket();
  stubChain({ dbReject: true });
  try { await M.mySettlements(ACCT, 100); fail++; console.log("FAIL mySettlements db-reject should throw"); }
  catch (e) { eq(String(e && e.message), "history-unavailable", "mySettlements db-reject maps to history-unavailable"); }
  try { await M.myLimitOrders(ACCT, 100); fail++; console.log("FAIL myLimitOrders db-reject should throw"); }
  catch (e) { eq(String(e && e.message), "history-unavailable", "myLimitOrders db-reject maps to history-unavailable"); }
  M = freshMarket();
  stubChain({ callReject: true });
  try { await M.mySettlements(ACCT, 100); fail++; console.log("FAIL mySettlements call-reject should throw"); }
  catch (e) { eq(String(e && e.message), "history-unavailable", "mySettlements call-reject maps to history-unavailable"); }
  try { await M.myLimitOrders(ACCT, 100); fail++; console.log("FAIL myLimitOrders call-reject should throw"); }
  catch (e) { eq(String(e && e.message), "history-unavailable", "myLimitOrders call-reject maps to history-unavailable"); }

  /* 16: envelope parity — myLimitOrders deep-equals myOrders for same rows
   * (proves the existing readers' shape: market-orders.js desk tab,
   * trade-cancel.js, account-ui.js open-orders). myOrders reads the
   * unlocked wallet's id via Account.myAccountId — stub both globals. */
  M = freshMarket();
  rec = stubChain({ limitRows: [LIMIT_ROW] });
  globalThis.Wallet = { isUnlocked: function () { return true; }, keys: {} };
  globalThis.Account = { myAccountId: function () { return Promise.resolve(ACCT); } };
  var viaMine = await M.myLimitOrders(ACCT, 100);
  var viaMyOrders = await M.myOrders();
  eq(viaMine, viaMyOrders, "myLimitOrders envelope deep-equals myOrders envelope");
  eq(Object.keys(viaMine[0]).sort(), Object.keys(LIMIT_ROW).sort(), "limit envelope keys are the raw limit_order_object keys");
  delete globalThis.Wallet;
  delete globalThis.Account;

  /* 17: settlement envelope — rows flow through the existing sortSettles
   * reader unchanged (market-orders.js R1e tab path). */
  M = freshMarket();
  stubChain({ settleRows: [SETTLE_ROW] });
  out = await M.mySettlements(ACCT, 100);
  eq(M.sortSettles(out), [SETTLE_ROW], "mySettlements rows round-trip through existing sortSettles");
  eq(Object.keys(out[0]).sort(), Object.keys(SETTLE_ROW).sort(), "settlement envelope keys are the raw force_settlement_object keys");

  console.log("my-positions-test: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
