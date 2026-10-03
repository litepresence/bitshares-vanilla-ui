/* history-export-test.js — unit vectors for HistoryExport (org-survey ADOPT-1).
 * Stdlib only: `node tooling/history-export-test.js` (exit 0 = green).
 * Covers the 11-column CoinTracking header, deposit/withdrawal/trade/
 * fee-row/income mapping, p5+p2 precisions, empty rows (header only),
 * CSV escaping of commas/quotes in memo/comment, pair-envelope rows,
 * unknown-op + foreign-account skips, collectAssetIds, defaultFilename,
 * and the headless downloadCsv guard (false, never throws). No network,
 * no DOM, no deps.
 */
"use strict";
var assert = require("assert");
globalThis.Format = require("../vanilla/js/api/format.js");
var HX = require("../vanilla/js/api/history-export.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function ok(cond, name) {
  assert.ok(cond, name + " FAILED");
  passed++;
}

var BTS = { symbol: "BTS", precision: 5 };
var USD = { symbol: "USD", precision: 2 };
var ASSETS = { "1.3.0": BTS, "1.3.1": USD };
var ME = "1.2.5";

/* 1: exact 11-column header. */
eq(HX.HEADER, "Type,Buy Amount,Buy Currency,Sell Amount,Sell Currency," +
  "Fee Amount,Fee Currency,Exchange,Trade Group,Comment,Date", "header is the 11-column CoinTracking shape");
eq(HX.EXCHANGE, "vanilla-dex", "exchange constant");

/* 2: inbound transfer -> Deposit (p5 amount + p5 fee). */
var dep = HX.rowsToCsv([{
  id: "1.11.1", block_time: "2026-01-02T03:04:05",
  op: [0, { from: "1.2.2", to: ME,
    amount: { amount: "123456", asset_id: "1.3.0" },
    fee: { amount: "10", asset_id: "1.3.0" } }]
}], { accountId: ME, assets: ASSETS });
eq(dep.split("\n")[1],
  "Deposit,1.23456,BTS,,,0.00010,BTS,vanilla-dex,,1.11.1 transfer,2026-01-02T03:04:05",
  "inbound transfer maps to Deposit");

/* 3: outbound transfer -> Withdrawal, p2 asset. */
var wdl = HX.rowsToCsv([{
  id: "1.11.2", block_time: "2026-01-03T00:00:00",
  op: [0, { from: ME, to: "1.2.9",
    amount: { amount: "250", asset_id: "1.3.1" },
    fee: { amount: "10", asset_id: "1.3.0" } }]
}], { accountId: ME, assets: ASSETS });
eq(wdl.split("\n")[1],
  "Withdrawal,,,2.50,USD,0.00010,BTS,vanilla-dex,,1.11.2 transfer,2026-01-03T00:00:00",
  "outbound transfer maps to Withdrawal");

/* 4: fill_order (op 4) -> Trade: buys receives, sells pays, fee kept. */
var trade = HX.rowsToCsv([{
  id: "1.11.3", block_time: "2026-01-04T00:00:00",
  op: [4, { account_id: ME,
    pays: { amount: "10000", asset_id: "1.3.0" },
    receives: { amount: "250", asset_id: "1.3.1" },
    fee: { amount: "5", asset_id: "1.3.0" } }]
}], { accountId: ME, assets: ASSETS });
eq(trade.split("\n")[1],
  "Trade,2.50,USD,0.10000,BTS,0.00005,BTS,vanilla-dex,,1.11.3 fill_order,2026-01-04T00:00:00",
  "fill maps to Trade with both legs");

/* 5: fee-only op (account_update, op 6) -> Withdrawal fee row. */
var fee = HX.rowsToCsv([{
  id: "1.11.4", block_time: "2026-01-05T00:00:00",
  op: [6, { fee: { amount: "20", asset_id: "1.3.0" } }]
}], { accountId: ME, assets: ASSETS });
eq(fee.split("\n")[1],
  "Withdrawal,,,,,0.00020,BTS,vanilla-dex,,1.11.4 account_update,2026-01-05T00:00:00",
  "fee-only op maps to Withdrawal fee row");

/* 6: vesting_balance_withdraw (op 33) -> Income, no special-cased ids. */
var inc = HX.rowsToCsv([{
  id: "1.11.5", block_time: "2026-01-06T00:00:00",
  op: [33, { owner: ME, vesting_balance: "1.13.1",
    amount: { amount: "100000", asset_id: "1.3.0" },
    fee: { amount: "10", asset_id: "1.3.0" } }]
}], { accountId: ME, assets: ASSETS });
eq(inc.split("\n")[1],
  "Income,1.00000,BTS,,,0.00010,BTS,vanilla-dex,,1.11.5 vesting_balance_withdraw,2026-01-06T00:00:00",
  "vesting withdraw maps to Income");

/* 7: empty history -> header only (UI shows the honest note instead). */
eq(HX.rowsToCsv([], { accountId: ME, assets: ASSETS }), HX.HEADER + "\n", "empty rows yield header only");
eq(HX.rowsToCsv(null, null), HX.HEADER + "\n", "null input yields header only");

/* 8: CSV escaping — memo comma + quotes force one quoted Comment cell. */
var esc = HX.rowsToCsv([{
  id: "1.11.6", block_time: "2026-01-07T00:00:00",
  op: [0, { from: "1.2.2", to: ME,
    amount: { amount: "1", asset_id: "1.3.0" },
    fee: { amount: "10", asset_id: "1.3.0" },
    memo: { message: 'hi, "bob"' } }]
}], { accountId: ME, assets: ASSETS });
ok(esc.indexOf('"1.11.6 transfer memo:hi, ""bob"""') !== -1, "memo comma+quotes escape to one quoted cell");
eq(HX.csvCell("plain"), "plain", "csvCell leaves plain values alone");
eq(HX.csvCell("a,b"), '"a,b"', "csvCell quotes commas");
eq(HX.csvCell('q"q'), '"q""q"', "csvCell doubles quotes");
eq(HX.csvCell("l1\nl2"), '"l1\nl2"', "csvCell quotes newlines");

/* 9: pair-envelope rows [seq, object] unwrap like objects. */
var pair = HX.rowsToCsv([["1.11.9", {
  id: "1.11.9", block_time: "2026-01-08T00:00:00",
  op: [0, { from: ME, to: "1.2.9",
    amount: { amount: "100000", asset_id: "1.3.0" },
    fee: { amount: "10", asset_id: "1.3.0" } }]
}]], { accountId: ME, assets: ASSETS });
ok(pair.split("\n")[1].indexOf("Withdrawal,") === 0, "pair envelope unwraps");

/* 10: unknown ops + foreign-account transfers skip (never guessed). */
var skip = HX.rowsToCsv([
  { id: "1.11.10", op: [999, { fee: { amount: "1", asset_id: "1.3.0" } }] },
  { id: "1.11.11", op: [0, { from: "1.2.2", to: "1.2.3",
    amount: { amount: "1", asset_id: "1.3.0" },
    fee: { amount: "1", asset_id: "1.3.0" } }] },
  { broken: true }
], { accountId: ME, assets: ASSETS });
eq(skip, HX.HEADER + "\n", "unknown/foreign/malformed rows skip");

/* 11: missing precision falls back to raw digits (never blank). */
var raw = HX.rowsToCsv([{
  id: "1.11.12", block_time: "2026-01-09T00:00:00",
  op: [0, { from: ME, to: "1.2.9",
    amount: { amount: "42", asset_id: "1.3.99" },
    fee: { amount: "7", asset_id: "1.3.99" } }]
}], { accountId: ME, assets: ASSETS });
ok(raw.split("\n")[1].indexOf("Withdrawal,,,42,1.3.99,7,1.3.99,") !== -1, "unknown asset falls back to raw + id");

/* 12: string op aliases map like their numeric ids. */
var alias = HX.rowsToCsv([{
  id: "1.11.13", block_time: "2026-01-10T00:00:00",
  op: ["fill_order", { account_id: ME,
    pays: { amount: "100000", asset_id: "1.3.0" },
    receives: { amount: "100", asset_id: "1.3.1" },
    fee: { amount: "10", asset_id: "1.3.0" } }]
}], { accountId: ME, assets: ASSETS });
ok(alias.split("\n")[1].indexOf("Trade,1.00,USD,1.00000,BTS,") === 0, "string op alias maps");

/* 13: collectAssetIds unions legs in first-seen order. */
eq(HX.collectAssetIds([
  { id: "1.11.1", op: [0, { from: ME, to: "1.2.2",
    amount: { amount: "1", asset_id: "1.3.1" },
    fee: { amount: "1", asset_id: "1.3.0" } }] },
  { id: "1.11.2", op: [4, { pays: { amount: "1", asset_id: "1.3.0" },
    receives: { amount: "1", asset_id: "1.3.2" } }] }
]), ["1.3.1", "1.3.0", "1.3.2"], "collectAssetIds unions legs");

/* 14: defaultFilename sanitizes, never blanks. */
eq(HX.defaultFilename("alice"), "history-alice.csv", "filename keeps plain names");
eq(HX.defaultFilename("a/b c?"), "history-a-b-c.csv", "filename dashes unsafe chars");
eq(HX.defaultFilename(""), "history-account.csv", "filename never blanks");

/* 15: headless download guard: false, never throws (no document here). */
var dl = null;
try { dl = HX.downloadCsv("history-x.csv", HX.HEADER + "\n"); } catch (e) { dl = "threw"; }
eq(dl, false, "downloadCsv fails soft headless");

console.log("history-export-test: " + passed + " passed, 0 failed");
