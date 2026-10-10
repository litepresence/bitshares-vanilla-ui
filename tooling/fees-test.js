#!/usr/bin/env node
/* fees vectors: every fee-schedule op links to its desk — the op->desk map
 * covers all 78 chain ops (tags 0-77 per bitshares-core operations.hpp), and
 * every target is a routable in-app hash. Pure: no DOM, no chain. */
"use strict";
const FeesUI = require("/workspace/vanilla/js/views/fees-ui.js");

let pass = 0, fail = 0;
function ok(c, n) { if (c) pass++; else { fail++; console.log("FAIL " + n); } }
function eq(g, w, n) {
  if (JSON.stringify(g) === JSON.stringify(w)) pass++;
  else { fail++; console.log("FAIL " + n + "\n  got  " + JSON.stringify(g) + "\n  want " + JSON.stringify(w)); }
}

const T = { deskFor: FeesUI.deskFor };
ok(typeof FeesUI.deskFor === "function", "deskFor is a public export (the explorer fees tab consumes it)");
ok(typeof FeesUI.renderTables === "function", "renderTables is the single shared fee-tables renderer (used by #/explorer/fees and #/assets)");
ok(T && typeof T.deskFor === "function", "deskFor exported for vectors");

/* Every op id 0..77 resolves to an in-app hash link. */
{
  const bad = [];
  for (let id = 0; id <= 77; id++) {
    const href = T.deskFor(id);
    if (typeof href !== "string" || href.charAt(0) !== "#") bad.push(id);
  }
  eq(bad, [], "all 78 ops (0-77) link somewhere in-app");
}

/* Spot checks: the desks the owner named, plus one per family. */
eq(T.deskFor(1), "#/markets", "limit_order_create resolves without MarketUI (browser upgrades this to the default desk)");
eq(T.deskFor(0), "#/transfer", "transfer links the transfer page");
eq(T.deskFor(10), "#/assets/create", "asset_create links asset creation");
eq(T.deskFor(14), "#/assets/issue", "asset_issue links asset issuing");
eq(T.deskFor(19), "#/assets/feed", "asset_publish_feed links feed publishing");
eq(T.deskFor(20), "#/voting", "witness_create links voting");
eq(T.deskFor(22), "#/proposals", "proposal_create links proposals");
eq(T.deskFor(34), "#/create-worker", "worker_create links worker creation");
eq(T.deskFor(25), "#/direct-debit", "withdraw_permission_create links direct debit");
eq(T.deskFor(49), "#/htlc", "htlc_create links the HTLC page");
eq(T.deskFor(54), "#/authorities", "custom_authority_create links authorities");
eq(T.deskFor(57), "#/tickets", "ticket_create links tickets");
eq(T.deskFor(59), "#/pools", "liquidity_pool_create links pools");
eq(T.deskFor(64), "#/samet", "samet_fund_create links Same-T funds");
eq(T.deskFor(69), "#/credit-offer", "credit_offer_create links credit offers");
eq(T.deskFor(3), "#/borrow", "call_order_update links borrowing");
eq(T.deskFor(5), "#/create-account", "account_create links account creation");
eq(T.deskFor(32), "#/vesting", "vesting_balance_create links vesting");
eq(T.deskFor(35), "#/txbuilder", "custom links the transaction builder");
eq(T.deskFor(77), "#/markets", "limit_order_update resolves without MarketUI");
eq(T.deskFor(999), null, "an unknown op id links nowhere");

console.log("fees: " + pass + " pass, " + fail + " fail");
process.exitCode = fail ? 1 : 0;
