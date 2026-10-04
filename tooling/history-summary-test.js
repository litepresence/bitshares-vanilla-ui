// tooling/history-summary-test.js — skeleton vectors for HistorySummary.enrich.
// Label-only fallback + never-rejects. Created by: history one-liners Task 2.
"use strict";
var assert = require("assert");
global.Chain = { db: function () { return Promise.resolve(1); },
  call: function () { return Promise.resolve([]); } };
global.Format = { formatAmount: function (raw, prec) { return raw + "@" + prec; } };
var HS = require("../vanilla/js/api/history-summary.js");
var rows = [{ id: "1.11.1", block_num: 1, op: [999, {}] }];
HS.enrich(rows, "1.2.0").then(function (out) {
  assert.strictEqual(out, rows, "same array");
  assert.ok(!out[0]._summary, "unknown tag stays label-only");
  console.log("history-summary skeleton: 2 passed");
}).catch(function (e) { console.error("FAIL", e); process.exit(1); });
