// tooling/history-summary-test.js — vectors for HistorySummary.enrich Tasks 3+4.
// Task 3 daily-eight families (tags 0,1,2,77,3,4,19,6): transfer direction
// trio + name-form viewer + precision-miss dash; label-only fallback +
// never-rejects from the Task 2 skeleton stay covered. Created by: history
// one-liners Task 3.
// Task 4 pool/asset/credit/samet/debit families (tags 59-63,75,10-18,42,43,
// 47,48,64-68,69-76,25-28): one vector per tag (43+47 share the claim
// template) + fee-pool unknown-asset fallback. Appended by: history Task 4.
// Task 5 governance/HTLC/tickets/vesting/proposals/misc/blind families
// (tags 20,21,29,30,34,22,23,24,32,33,49-53,57,58,54-56,5,7,8,9,35,37,45,
// 39-41): one vector per tag (54-56 share sum_authorities, 39-41 share
// sum_blind counts-only) + label-only rows for 31/36/44/46 + a null-payload
// fallback row. Appended by: history Task 5.
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
  "1.3.1": { id: "1.3.1", symbol: "USD", precision: 4 },
  "1.3.2": { id: "1.3.2", symbol: "SHARE", precision: 5 }
};
var ACCOUNTS = {
  "1.2.1": { id: "1.2.1", name: "alice" },
  "1.2.2": { id: "1.2.2", name: "bob" },
  "1.2.3": { id: "1.2.3", name: "carol" }
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

var t4 = [
  row("1.11.20", 59, { account: "1.2.1", asset_a: "1.3.0", asset_b: "1.3.1" }),
  row("1.11.21", 60, { account: "1.2.1", pool: "1.19.1" }),
  row("1.11.22", 61, { account: "1.2.1", pool: "1.19.1",
    amount_a: { amount: "100000", asset_id: "1.3.0" },
    amount_b: { amount: "50000", asset_id: "1.3.1" } }),
  row("1.11.23", 62, { account: "1.2.1", pool: "1.19.1",
    share_amount: { amount: "50000", asset_id: "1.3.2" } }),
  row("1.11.24", 63, { account: "1.2.1", pool: "1.19.1",
    amount_to_sell: { amount: "100000", asset_id: "1.3.0" },
    min_to_receive: { amount: "50000", asset_id: "1.3.1" } }),
  row("1.11.25", 75, { account: "1.2.1", pool: "1.19.2" }),
  row("1.11.26", 10, { issuer: "1.2.1", symbol: "MINE", precision: 5 }),
  row("1.11.27", 11, { issuer: "1.2.1", asset_to_update: "1.3.1" }),
  row("1.11.28", 48, { issuer: "1.2.1", asset_to_update: "1.3.1", new_issuer: "1.2.2" }),
  row("1.11.29", 12, { issuer: "1.2.1", asset_to_update: "1.3.1" }),
  row("1.11.30", 13, { issuer: "1.2.1", asset_to_update: "1.3.1",
    new_feed_producers: ["1.2.1", "1.2.2"] }),
  row("1.11.31", 14, { issuer: "1.2.1",
    asset_to_issue: { amount: "50000", asset_id: "1.3.1" }, issue_to_account: "1.2.2" }),
  row("1.11.32", 15, { payer: "1.2.1", amount_to_reserve: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.33", 16, { from_account: "1.2.1", asset_id: "1.3.1", amount: "300000" }),
  row("1.11.34", 16, { from_account: "1.2.1", asset_id: "1.3.999", amount: "300000" }),
  row("1.11.35", 17, { account: "1.2.1", amount: { amount: "50000", asset_id: "1.3.1" } }),
  row("1.11.36", 18, { issuer: "1.2.1", asset_to_settle: "1.3.1" }),
  row("1.11.37", 42, { account: "1.2.1", amount: { amount: "50000", asset_id: "1.3.1" } }),
  row("1.11.38", 43, { issuer: "1.2.1", amount_to_claim: { amount: "10000", asset_id: "1.3.1" } }),
  row("1.11.39", 47, { issuer: "1.2.1", asset_id: "1.3.1",
    amount_to_claim: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.40", 64, { owner_account: "1.2.1", asset_type: "1.3.0", balance: "200000" }),
  row("1.11.41", 65, { owner_account: "1.2.1", fund_id: "1.20.1" }),
  row("1.11.42", 66, { owner_account: "1.2.1", fund_id: "1.20.1" }),
  row("1.11.43", 67, { borrower: "1.2.2", fund_id: "1.20.1",
    borrow_amount: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.44", 68, { account: "1.2.2", fund_id: "1.20.1",
    repay_amount: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.45", 69, { owner_account: "1.2.1", asset_type: "1.3.0", balance: "500000" }),
  row("1.11.46", 70, { owner_account: "1.2.1", offer_id: "1.21.1" }),
  row("1.11.47", 71, { owner_account: "1.2.1", offer_id: "1.21.1" }),
  row("1.11.48", 72, { borrower: "1.2.2", offer_id: "1.21.1",
    borrow_amount: { amount: "100000", asset_id: "1.3.0" },
    collateral: { amount: "200000", asset_id: "1.3.1" } }),
  row("1.11.49", 73, { account: "1.2.2", deal_id: "1.22.1",
    repay_amount: { amount: "50000", asset_id: "1.3.0" } }),
  row("1.11.50", 76, { account: "1.2.1", deal_id: "1.22.1" }),
  row("1.11.51", 74, { deal_id: "1.22.1" }),
  row("1.11.52", 25, { withdraw_from_account: "1.2.1", authorized_account: "1.2.2",
    withdrawal_limit: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.53", 26, { withdraw_from_account: "1.2.1", authorized_account: "1.2.2",
    withdrawal_limit: { amount: "200000", asset_id: "1.3.0" } }),
  row("1.11.54", 27, { withdraw_from_account: "1.2.1", withdraw_to_account: "1.2.2",
    amount_to_withdraw: { amount: "50000", asset_id: "1.3.0" } }),
  row("1.11.55", 28, { withdraw_from_account: "1.2.1", authorized_account: "1.2.2",
    withdrawal_permission: "1.12.1" })
];

var t5 = [
  row("1.11.60", 20, { witness_account: "1.2.2" }),
  row("1.11.61", 21, { witness: "1.6.1", witness_account: "1.2.2" }),
  row("1.11.62", 29, { committee_member_account: "1.2.3" }),
  row("1.11.63", 30, { committee_member: "1.5.1", committee_member_account: "1.2.3" }),
  row("1.11.64", 34, { owner: "1.2.1", name: "my-worker" }),
  row("1.11.65", 22, { fee_paying_account: "1.2.1",
    proposed_ops: [{ op: [0, {}] }, { op: [1, {}] }] }),
  row("1.11.66", 23, { fee_paying_account: "1.2.1", proposal: "1.10.5" }),
  row("1.11.67", 24, { fee_paying_account: "1.2.1", proposal: "1.10.5" }),
  row("1.11.68", 32, { creator: "1.2.1", owner: "1.2.2",
    amount: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.69", 33, { vesting_balance: "1.13.1", owner: "1.2.2",
    amount: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.70", 49, { from: "1.2.1", to: "1.2.2",
    amount: { amount: "100000", asset_id: "1.3.0" }, htlc_id: "1.16.1" }),
  row("1.11.71", 50, { htlc_id: "1.16.1", redeemer: "1.2.2" }),
  row("1.11.72", 51, { htlc_id: "1.16.1", from: "1.2.1", to: "1.2.2",
    redeemer: "1.2.2", amount: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.73", 52, { htlc_id: "1.16.1", update_issuer: "1.2.1", seconds_to_add: 3600 }),
  row("1.11.74", 53, { htlc_id: "1.16.1", to: "1.2.1",
    original_htlc_recipient: "1.2.2",
    htlc_amount: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.75", 57, { account: "1.2.1",
    amount: { amount: "50000", asset_id: "1.3.1" } }),
  row("1.11.76", 58, { account: "1.2.1", ticket: "1.18.1" }),
  row("1.11.77", 54, { account: "1.2.1" }),
  row("1.11.78", 55, { account: "1.2.1", authority_to_update: "1.17.1" }),
  row("1.11.79", 56, { account: "1.2.1", authority_to_delete: "1.17.1" }),
  row("1.11.80", 5, { registrar: "1.2.1", name: "dave" }),
  row("1.11.81", 7, { authorizing_account: "1.2.1", account_to_list: "1.2.3" }),
  row("1.11.82", 8, { account_to_upgrade: "1.2.3" }),
  row("1.11.83", 9, { account_id: "1.2.3", new_owner: "1.2.2" }),
  row("1.11.84", 35, { payer: "1.2.1", required_auths: ["1.2.2"] }),
  row("1.11.85", 37, { deposit_to_account: "1.2.2",
    total_claimed: { amount: "100000", asset_id: "1.3.0" } }),
  row("1.11.86", 45, { bidder: "1.2.1",
    additional_collateral: { amount: "200000", asset_id: "1.3.0" },
    debt_covered: { amount: "50000", asset_id: "1.3.1" } }),
  row("1.11.87", 39, { from: "1.2.1",
    amount: { amount: "100000", asset_id: "1.3.0" }, outputs: [{}, {}] }),
  row("1.11.88", 40, { inputs: [{}], outputs: [{}, {}] }),
  row("1.11.89", 41, { to: "1.2.2",
    amount: { amount: "100000", asset_id: "1.3.0" }, inputs: [{}] }),
  row("1.11.90", 31, { new_parameters: {} }),
  row("1.11.91", 36, { fee_paying_account: "1.2.1", predicates: [] }),
  row("1.11.92", 44, { account_id: "1.2.1", amount: "500000" }),
  row("1.11.93", 46, { bidder: "1.2.1" }),
  row("1.11.94", 20, {})
];

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
  return HS.enrich(t4, "1.2.1");
}).then(function (out) {
  eq(out[0]._summary, "Created pool BTS / USD", "tag 59 pool create");
  eq(out[1]._summary, "Deleted pool 1.19.1", "tag 60 pool delete");
  eq(out[2]._summary, "Staked 1.00000 BTS + 5.0000 USD in pool 1.19.1", "tag 61 pool deposit");
  eq(out[3]._summary, "Unstaked 0.50000 SHARE from pool 1.19.1", "tag 62 pool withdraw");
  eq(out[4]._summary, "Swapped 1.00000 BTS \u2192 at least 5.0000 USD in pool 1.19.1", "tag 63 pool swap");
  eq(out[5]._summary, "Updated pool 1.19.2", "tag 75 pool update");
  eq(out[6]._summary, "Created asset MINE", "tag 10 asset create");
  eq(out[7]._summary, "Updated asset USD", "tag 11 asset update");
  eq(out[8]._summary, "New issuer for USD: bob", "tag 48 issuer update");
  eq(out[9]._summary, "Updated smartcoin USD", "tag 12 smartcoin update");
  eq(out[10]._summary, "Set 2 feed producers for USD", "tag 13 feed producers");
  eq(out[11]._summary, "Issued 5.0000 USD to bob", "tag 14 asset issue");
  eq(out[12]._summary, "Burned 1.00000 BTS", "tag 15 asset burn");
  eq(out[13]._summary, "Funded fee pool of USD with 3.00000 BTS", "tag 16 fee pool fund");
  eq(out[14]._summary, "Funded fee pool of 1.3.999 with 3.00000 BTS", "tag 16 unknown asset fallback");
  eq(out[15]._summary, "Requested settlement of 5.0000 USD", "tag 17 settle");
  eq(out[16]._summary, "Globally settled USD", "tag 18 global settle");
  eq(out[17]._summary, "Cancelled settlement of 5.0000 USD", "tag 42 settle cancel");
  eq(out[18]._summary, "Claimed 1.0000 USD in fees", "tag 43 claim fees");
  eq(out[19]._summary, "Claimed 1.00000 BTS in fees", "tag 47 claim pool");
  eq(out[20]._summary, "Created SameT fund with 2.00000 BTS", "tag 64 samet create");
  eq(out[21]._summary, "Deleted SameT fund 1.20.1", "tag 65 samet delete");
  eq(out[22]._summary, "Updated SameT fund 1.20.1", "tag 66 samet update");
  eq(out[23]._summary, "Borrowed 1.00000 BTS from fund 1.20.1", "tag 67 samet borrow");
  eq(out[24]._summary, "Repaid 1.00000 BTS to fund 1.20.1", "tag 68 samet repay");
  eq(out[25]._summary, "Created credit offer in BTS", "tag 69 offer create");
  eq(out[26]._summary, "Deleted offer 1.21.1", "tag 70 offer delete");
  eq(out[27]._summary, "Updated offer 1.21.1", "tag 71 offer update");
  eq(out[28]._summary, "Borrowed 1.00000 BTS against 20.0000 USD (offer 1.21.1)", "tag 72 offer accept");
  eq(out[29]._summary, "Repaid 0.50000 BTS on deal 1.22.1", "tag 73 deal repay");
  eq(out[30]._summary, "Updated deal 1.22.1", "tag 76 deal update");
  eq(out[31]._summary, "Deal 1.22.1 expired", "tag 74 deal expired");
  eq(out[32]._summary, "Authorized 1.00000 BTS debit for bob", "tag 25 debit create");
  eq(out[33]._summary, "Updated 2.00000 BTS debit for bob", "tag 26 debit update");
  eq(out[34]._summary, "Claimed 0.50000 BTS debit", "tag 27 debit claim");
  eq(out[35]._summary, "Deleted debit permission 1.12.1", "tag 28 debit delete");
  return HS.enrich(t5, "1.2.1");
}).then(function (out) {
  eq(out[0]._summary, "Became witness: bob", "tag 20 witness create");
  eq(out[1]._summary, "Updated witness bob", "tag 21 witness update");
  eq(out[2]._summary, "Became committee member: carol", "tag 29 committee create");
  eq(out[3]._summary, "Updated committee member carol", "tag 30 committee update");
  eq(out[4]._summary, 'Created worker "my-worker"', "tag 34 worker create");
  eq(out[5]._summary, "Proposed 2 operations", "tag 22 proposal create");
  eq(out[6]._summary, "Approved proposal 1.10.5", "tag 23 proposal update");
  eq(out[7]._summary, "Deleted proposal 1.10.5", "tag 24 proposal delete");
  eq(out[8]._summary, "Vested 1.00000 BTS for bob", "tag 32 vesting create");
  eq(out[9]._summary, "Withdrew 1.00000 BTS vested", "tag 33 vesting withdraw");
  eq(out[10]._summary, "HTLC 1.16.1: 1.00000 BTS from alice to bob", "tag 49 htlc create");
  eq(out[11]._summary, "Redeemed HTLC 1.16.1", "tag 50 htlc redeem");
  eq(out[12]._summary, "HTLC 1.16.1 claimed", "tag 51 htlc redeemed");
  eq(out[13]._summary, "Extended HTLC 1.16.1", "tag 52 htlc extend");
  eq(out[14]._summary, "HTLC 1.16.1 refunded", "tag 53 htlc refund");
  eq(out[15]._summary, "Created ticket 5.0000 USD", "tag 57 ticket create");
  eq(out[16]._summary, "Updated ticket 1.18.1", "tag 58 ticket update");
  eq(out[17]._summary, "Updated authorities for alice", "tag 54 authority create");
  eq(out[18]._summary, "Updated authorities for alice", "tag 55 authority update");
  eq(out[19]._summary, "Updated authorities for alice", "tag 56 authority delete");
  eq(out[20]._summary, "Registered dave", "tag 5 account create");
  eq(out[21]._summary, "Listed carol", "tag 7 whitelist");
  eq(out[22]._summary, "Upgraded carol", "tag 8 upgrade");
  eq(out[23]._summary, "Transferred account to bob", "tag 9 account transfer");
  eq(out[24]._summary, "Custom operation by alice", "tag 35 custom");
  eq(out[25]._summary, "Claimed 1.00000 BTS", "tag 37 balance claim");
  eq(out[26]._summary, "Bid 2.00000 BTS for 5.0000 USD", "tag 45 bid");
  eq(out[27]._summary, "Blind transfer (0 in, 2 out)", "tag 39 to-blind");
  eq(out[28]._summary, "Blind transfer (1 in, 2 out)", "tag 40 blind");
  eq(out[29]._summary, "Blind transfer (1 in, 0 out)", "tag 41 from-blind");
  eq(out[30]._summary, undefined, "tag 31 params label-only");
  eq(out[31]._summary, undefined, "tag 36 assert label-only");
  eq(out[32]._summary, undefined, "tag 44 fba label-only");
  eq(out[33]._summary, undefined, "tag 46 execute-bid label-only");
  eq(out[34]._summary, undefined, "tag 20 empty payload fallback");
  console.log("history-summary Tasks 3+4+5: " + passed + " passed");
}).catch(function (e) { console.error("FAIL", e); process.exit(1); });
