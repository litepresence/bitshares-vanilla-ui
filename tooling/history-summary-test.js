// tooling/history-summary-test.js — vectors for HistorySummary.enrich Task 3.
// Daily-eight families (tags 0,1,2,77,3,4,19,6): transfer direction trio +
// name-form viewer + precision-miss dash; label-only fallback + never-rejects
// from the Task 2 skeleton stay covered. Created by: history one-liners Task 3.
"use strict";
var assert = require("assert");

/* Real money math (integer-only); Chain joins + I18n interpolation stubbed. */
global.Format = require("../vanilla/js/api/format.js");
global.I18n = {
  t: function (key, dflt, vars) {
    var s = String(dflt);
    if (!vars || typeof vars !== "object") return s;
    return s.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }
};
var ASSETS = {
  "1.3.0": { id: "1.3.0", symbol: "BTS", precision: 5 },
  "1.3.1": { id: "1.3.1", symbol: "USD", precision: 4 }
};
var ACCOUNTS = {
  "1.2.1": { id: "1.2.1", name: "alice" },
  "1.2.2": { id: "1.2.2", name: "bob" }
};
global.Chain = {
  db: function () { return Promise.resolve(1); },
  call: function (dbId, method, params) {
    var ids = (params && params[0]) || [];
    if (method === "lookup_asset_symbols") {
      return Promise.resolve(ids.map(function (id) { return ASSETS[id] || null; }));
    }
    if (method === "get_accounts") {
      return Promise.resolve(ids.map(function (id) { return ACCOUNTS[id] || null; }));
    }
    return Promise.resolve([]);
  }
};

var HS = require("../vanilla/js/api/history-summary.js");

function row(id, tag, payload) {
  return { id: id, block_num: 1, op: [tag, payload] };
}
var XFER = { from: "1.2.1", to: "1.2.2", amount: { amount: "100000", asset_id: "1.3.0" } };
var MINUS = "−"; // U+2212, the brief's signed-delta mark

var asAlice = [
  row("1.11.0", 999, {}),
  row("1.11.1", 0, XFER),
  row("1.11.2", 0, { from: "1.2.1", to: "1.2.2", amount: { amount: "100000", asset_id: "1.3.999" } }),
  row("1.11.3", 1, { seller: "1.2.1", amount_to_sell: { amount: "100000", asset_id: "1.3.0" },
    min_to_receive: { amount: "50000", asset_id: "1.3.1" } }),
  row("1.11.4", 2, { fee_paying_account: "1.2.1", order: "1.7.5" }),
  row("1.11.5", 77, { seller: "1.2.1", order: "1.7.6",
    delta_amount_to_sell: { amount: "50000", asset_id: "1.3.0" } }),
  row("1.11.6", 3, { funding_account: "1.2.1", delta_collateral: { amount: "200000", asset_id: "1.3.0" },
    delta_debt: { amount: "-50000", asset_id: "1.3.1" } }),
  row("1.11.7", 4, { account_id: "1.2.1", order_id: "1.7.1", pays: { amount: "100000", asset_id: "1.3.0" },
    receives: { amount: "50000", asset_id: "1.3.1" } }),
  row("1.11.8", 19, { publisher: "1.2.1", asset_id: "1.3.1" }),
  row("1.11.9", 6, { account: "1.2.1" })
];
var asBob = [row("1.11.10", 0, XFER)];
var asBobName = [row("1.11.11", 0, XFER)];
var asStranger = [row("1.11.12", 0, XFER)];

var passed = 0;
function eq(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg);
  passed++;
}

HS.enrich(asAlice, "1.2.1").then(function (out) {
  eq(out, asAlice, "same array");
  eq(out[0]._summary, undefined, "unknown tag stays label-only");
  eq(out[1]._summary, "Sent 1.00000 BTS to bob", "tag 0 send");
  eq(out[2]._summary, "Sent — to bob", "tag 0 precision-miss dash");
  eq(out[3]._summary, "Offered 1.00000 BTS for at least 5.0000 USD", "tag 1 create");
  eq(out[4]._summary, "Cancelled order 1.7.5", "tag 2 cancel");
  eq(out[5]._summary, "Updated order 1.7.6", "tag 77 update");
  eq(out[6]._summary, "Adjusted position: +2.00000 BTS collateral, " + MINUS + "5.0000 USD debt", "tag 3 call");
  eq(out[7]._summary, "Filled: paid 1.00000 BTS, received 5.0000 USD", "tag 4 fill");
  eq(out[8]._summary, "Feed published for USD by alice", "tag 19 feed");
  eq(out[9]._summary, "Account updated: alice", "tag 6 account update");
  return HS.enrich(asBob, "1.2.2");
}).then(function (out) {
  eq(out[0]._summary, "Received 1.00000 BTS from alice", "tag 0 recv (id viewer)");
  return HS.enrich(asBobName, "bob");
}).then(function (out) {
  eq(out[0]._summary, "Received 1.00000 BTS from alice", "tag 0 recv (name viewer)");
  return HS.enrich(asStranger, "1.2.9");
}).then(function (out) {
  eq(out[0]._summary, "Transfer 1.00000 BTS from alice to bob", "tag 0 neither side");
  console.log("history-summary Task 3: " + passed + " passed");
}).catch(function (e) { console.error("FAIL", e); process.exit(1); });
