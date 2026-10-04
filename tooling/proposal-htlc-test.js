/* proposal-htlc-test.js — pure-logic vectors for api/proposal.js + api/htlc.js.
 * Style: stdlib assert only (tooling/dom-test.js precedent). No network, no
 * socket, deterministic; exit 0 = green. Run: node tooling/proposal-htlc-test.js
 * Proposal seams (importably pure): durToHuman, buildCreate (inner-op join +
 *   zero-fee shape), buildApprove/Unapprove/Delete, buildAirdropBatch,
 *   pack/unpackInvoice, blindSend, fee (Tx stubbed). Htlc seams: formatDuration,
 *   formatDateTime, buildRedeem/buildExtend/buildDebitDelete validation,
 *   checkClaim gates, hash-algo rejection paths.
 * GAPS (UI/chain-coupled, untestable headless): Proposal.proposal/proposalsFor/
 *   blindedLookup/sendAndProve (Chain.db reads + broadcast); Htlc.htlc/mine/
 *   permissions (Chain reads); hashPreimage live sha256 (needs secure-context
 *   WebCrypto — only rejection paths covered here); buildCreate op-49,
 *   buildDebitCreate/Update/Claim (need Format.parseAmount + chain reads);
 *   Htlc.checkPreimage match path (needs live hash); fee/sendAndProve live paths.
 */
"use strict";
var path = require("path");
var assert = require("assert");
var Proposal = require(path.join(__dirname, "..", "vanilla", "js", "api", "proposal.js"));
var Htlc = require(path.join(__dirname, "..", "vanilla", "js", "api", "htlc.js"));

var pass = 0, fail = 0;
var cur = null;
function section(name) {
  if (cur) console.log(cur.name + ": " + cur.n + " passed, 0 failed");
  cur = { name: name, n: 0 };
}
function eq(actual, expected, name) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; cur.n++; }
  else { fail++; console.log("FAIL " + name + " want=" + e + " got=" + a); }
}
function throwsRe(fn, re, name) {
  try { fn(); fail++; console.log("FAIL " + name + " (no throw)"); }
  catch (e) { if (re.test(e.message)) { pass++; cur.n++; } else { fail++; console.log("FAIL " + name + " wrong error: " + e.message); } }
}
async function rejectsRe(p, re, name) {
  try { await p; fail++; console.log("FAIL " + name + " (no reject)"); }
  catch (e) { if (re.test(e.message)) { pass++; cur.n++; } else { fail++; console.log("FAIL " + name + " wrong error: " + e.message); } }
}

async function main() {
  section("proposal");
  /* ---- Proposal.durToHuman ---- */
  eq(Proposal.durToHuman(0), "0 seconds", "prop-dur zero");
  eq(Proposal.durToHuman(1), "1 second", "prop-dur one second");
  eq(Proposal.durToHuman(60), "1 minute", "prop-dur minute");
  eq(Proposal.durToHuman(120), "2 minutes", "prop-dur two minutes");
  eq(Proposal.durToHuman(90), "90 seconds", "prop-dur remainder stays seconds");
  eq(Proposal.durToHuman(3600), "1 hour", "prop-dur hour");
  eq(Proposal.durToHuman(86400), "1 day", "prop-dur day");
  eq(Proposal.durToHuman("86400"), "1 day", "prop-dur string input");
  eq(Proposal.durToHuman(604800), "1 week", "prop-dur week");
  throwsRe(function () { Proposal.durToHuman(-5); }, /non-negative/, "prop-dur negative throws");
  throwsRe(function () { Proposal.durToHuman(1.5); }, /non-negative/, "prop-dur float throws");

  /* ---- Proposal.buildCreate: zero-fee shape + inner-op join ---- */
  var c = Proposal.buildCreate({ feePayerId: "1.2.10", expirationIso: "2026-10-05T00:00:00",
    innerOps: [[0, { from: "1.2.10" }]], reviewPeriodSecOrNull: null });
  eq(c[0], 22, "prop-create op id");
  eq(c[1].fee, { amount: "0", asset_id: "1.3.0" }, "prop-create zero fee");
  eq(c[1].proposed_ops, [{ op: [0, { from: "1.2.10" }] }], "prop-create bare pair joined");
  eq(c[1].review_period_seconds, null, "prop-create null review");
  var c2 = Proposal.buildCreate({ feePayerId: "1.2.10", expirationIso: "2026-10-05T00:00:00",
    innerOps: [{ op: [1, { a: 1 }] }, [0, { from: "1.2.10" }]], reviewPeriodSecOrNull: 3600 });
  eq(c2[1].proposed_ops, [{ op: [1, { a: 1 }] }, { op: [0, { from: "1.2.10" }] }], "prop-create mixed join");
  eq(c2[1].review_period_seconds, 3600, "prop-create review kept");
  throwsRe(function () { Proposal.buildCreate({ feePayerId: "alice", expirationIso: "2026-10-05T00:00:00", innerOps: [[0, {}]] }); }, /feePayerId/, "prop-create bad payer throws");
  throwsRe(function () { Proposal.buildCreate({ feePayerId: "1.2.10", expirationIso: "2026-10-05T00:00:00", innerOps: [] }); }, /non-empty/, "prop-create empty ops throws");
  throwsRe(function () { Proposal.buildCreate({ feePayerId: "1.2.10", expirationIso: "2026-10-05T00:00:00", innerOps: [["x"]] }); }, /\[opId, opData\]/, "prop-create malformed pair throws");

  /* ---- Proposal approve / unapprove / delete ---- */
  var ap = Proposal.buildApprove({ feePayerId: "1.2.10", proposalId: "1.10.1", accountId: "1.2.7" });
  eq(ap[0], 23, "prop-approve op id");
  eq(ap[1].active_approvals_to_add, ["1.2.7"], "prop-approve active add bit");
  eq(ap[1].owner_approvals_to_add, [], "prop-approve owner add empty");
  var apo = Proposal.buildApprove({ feePayerId: "1.2.10", proposalId: "1.10.1", accountId: "1.2.7", ownerNotActive: true });
  eq(apo[1].owner_approvals_to_add, ["1.2.7"], "prop-approve owner bit");
  var un = Proposal.buildUnapprove({ feePayerId: "1.2.10", proposalId: "1.10.1", accountId: "1.2.7" });
  eq(un[1].active_approvals_to_remove, ["1.2.7"], "prop-unapprove remove bit");
  var del = Proposal.buildDelete({ feePayerId: "1.2.10", proposalId: "1.10.1", usingOwner: true });
  eq(del, [24, { fee: { amount: "0", asset_id: "1.3.0" }, fee_paying_account: "1.2.10",
    using_owner_authority: true, proposal: "1.10.1", extensions: [] }], "prop-delete shape");
  throwsRe(function () { Proposal.buildApprove({ feePayerId: "1.2.10", proposalId: "1.10.1", accountId: "bad" }); }, /accountId/, "prop-approve bad account throws");

  /* ---- Proposal.buildAirdropBatch ---- */
  var air = Proposal.buildAirdropBatch("1.2.10", [{ toId: "1.2.7", amountRaw: "100000", assetId: "1.3.0" }]);
  eq(air.length, 1, "prop-airdrop one row");
  eq(air[0][0], 14, "prop-airdrop op id");
  eq(air[0][1].asset_to_issue, { amount: "100000", asset_id: "1.3.0" }, "prop-airdrop raw amount kept");
  eq(air[0][1].memo, null, "prop-airdrop memo null default");
  throwsRe(function () { Proposal.buildAirdropBatch("1.2.10", []); }, /non-empty/, "prop-airdrop empty throws");
  throwsRe(function () { Proposal.buildAirdropBatch("bad", [{ toId: "1.2.7", amountRaw: "1", assetId: "1.3.0" }]); }, /issuerId/, "prop-airdrop bad issuer throws");

  /* ---- Proposal invoice pack/unpack + blindSend ---- */
  var inv = { to: "alice", amount: "1.00000 BTS" };
  eq(Proposal.unpackInvoice(Proposal.packInvoice(inv)), inv, "prop-invoice round trip");
  throwsRe(function () { Proposal.packInvoice("str"); }, /must be an object/, "prop-invoice pack non-object throws");
  await rejectsRe(Promise.resolve().then(function () { return Proposal.unpackInvoice("!!!"); }), /invoice-unparseable/, "prop-invoice bad base58 unparseable");
  throwsRe(function () { Proposal.unpackInvoice(""); }, /invoice-unparseable/, "prop-invoice empty unparseable");
  throwsRe(function () { Proposal.blindSend(); }, /blind-disabled/, "prop-blindSend gated");

  /* ---- Proposal.fee (Tx stubbed; tx-unavailable first) ---- */
  await rejectsRe(Proposal.fee([22, { fee: { amount: "0", asset_id: "1.3.0" } }]), /tx-unavailable/, "prop-fee no Tx throws");
  global.Tx = { fee: function () { return Promise.resolve({ amount: "500", asset_id: "1.3.1" }); } };
  var pair = [22, { fee: { amount: "0", asset_id: "1.3.0" } }];
  eq(await Proposal.fee(pair, "1.3.1"), { amount: "500", asset_id: "1.3.1" }, "prop-fee returns chain answer");
  eq(pair[1].fee, { amount: "500", asset_id: "1.3.1" }, "prop-fee filled in place");
  delete global.Tx;
  throwsRe(function () { Proposal.buildDelete({ feePayerId: "1.2.10", proposalId: "nope" }); }, /proposalId/, "prop-delete bad id throws");

  /* ---- Htlc.formatDuration ---- */
  section("htlc");
  eq(Htlc.formatDuration(0), "0 seconds", "htlc-dur zero");
  eq(Htlc.formatDuration(1), "1 second", "htlc-dur one");
  eq(Htlc.formatDuration(60), "1 minute", "htlc-dur minute");
  eq(Htlc.formatDuration(61), "1 minute 1 second", "htlc-dur compound");
  eq(Htlc.formatDuration(3600), "1 hour", "htlc-dur hour");
  eq(Htlc.formatDuration(86400), "1 day", "htlc-dur day");
  eq(Htlc.formatDuration(90000), "1 day 1 hour", "htlc-dur day+hour");
  eq(Htlc.formatDuration("7200"), "2 hours", "htlc-dur string input");
  throwsRe(function () { Htlc.formatDuration(-1); }, /bad duration/, "htlc-dur negative throws");
  throwsRe(function () { Htlc.formatDuration(1.5); }, /bad duration/, "htlc-dur float throws");
  throwsRe(function () { Htlc.formatDuration("abc"); }, /bad duration/, "htlc-dur malformed throws");

  /* ---- Htlc.formatDateTime ---- */
  eq(typeof Htlc.formatDateTime("2026-01-01T00:00:00"), "string", "htlc-dt returns string");
  eq(Htlc.formatDateTime("2026-01-01T00:00:00").length > 0, true, "htlc-dt non-empty");
  throwsRe(function () { Htlc.formatDateTime("garbage"); }, /bad-date/, "htlc-dt garbage throws");
  throwsRe(function () { Htlc.formatDateTime(""); }, /bad-date/, "htlc-dt empty throws");

  /* ---- Htlc.buildRedeem hash validation ---- */
  var rd = Htlc.buildRedeem({ htlcId: "1.16.3", redeemerId: "1.2.7", preimageHex: "AB12" });
  eq(rd[0], 50, "htlc-redeem op id");
  eq(rd[1].preimage, "ab12", "htlc-redeem hex lowercased");
  throwsRe(function () { Htlc.buildRedeem({ htlcId: "1.16.3", redeemerId: "1.2.7", preimageHex: "abc" }); }, /bad-preimage/, "htlc-redeem odd hex throws");
  throwsRe(function () { Htlc.buildRedeem({ htlcId: "1.16.3", redeemerId: "1.2.7", preimageHex: "zz" }); }, /bad-preimage/, "htlc-redeem non-hex throws");
  throwsRe(function () { Htlc.buildRedeem({ htlcId: "1.16.3", redeemerId: "1.2.7", preimageHex: "" }); }, /bad-preimage/, "htlc-redeem empty throws");
  throwsRe(function () { Htlc.buildRedeem({ htlcId: "1.16", redeemerId: "1.2.7", preimageHex: "ab" }); }, /htlcId/, "htlc-redeem bad id throws");
  throwsRe(function () { Htlc.buildRedeem({ htlcId: "1.16.3", redeemerId: "bob", preimageHex: "ab" }); }, /redeemerId/, "htlc-redeem bad redeemer throws");

  /* ---- Htlc.buildExtend + buildDebitDelete ---- */
  var ex = Htlc.buildExtend({ htlcId: "1.16.3", issuerId: "1.2.7", secondsToAdd: 3600 });
  eq(ex, [52, { fee: { amount: "0", asset_id: "1.3.0" }, htlc_id: "1.16.3",
    update_issuer: "1.2.7", seconds_to_add: 3600, extensions: [] }], "htlc-extend shape");
  throwsRe(function () { Htlc.buildExtend({ htlcId: "1.16.3", issuerId: "1.2.7", secondsToAdd: 0 }); }, />= 1/, "htlc-extend zero throws");
  throwsRe(function () { Htlc.buildExtend({ htlcId: "nope", issuerId: "1.2.7", secondsToAdd: 5 }); }, /htlcId/, "htlc-extend bad id throws");
  var dd = Htlc.buildDebitDelete({ permId: "1.12.4", fromId: "1.2.5", toId: "1.2.7" });
  eq(dd[0], 28, "htlc-debitdelete op id");
  eq(dd[1].withdrawal_permission, "1.12.4", "htlc-debitdelete perm kept");
  throwsRe(function () { Htlc.buildDebitDelete({ permId: "1.12", fromId: "1.2.5", toId: "1.2.7" }); }, /permId/, "htlc-debitdelete bad perm throws");

  /* ---- Htlc.checkClaim gates ---- */
  eq(Htlc.checkClaim({ started: true, available_raw: "1000" }, "500"), { ok: true }, "htlc-claim ok");
  eq(Htlc.checkClaim({ started: true, available_raw: "1000" }, "1000"), { ok: true }, "htlc-claim exact limit ok");
  throwsRe(function () { Htlc.checkClaim({ started: true, available_raw: "1000" }, "0"); }, /limit-exceeded/, "htlc-claim zero throws");
  throwsRe(function () { Htlc.checkClaim({ started: true, available_raw: "1000" }, "1001"); }, /limit-exceeded/, "htlc-claim over limit throws");
  throwsRe(function () { Htlc.checkClaim({ started: false, available_raw: "1000" }, "10"); }, /period-not-started/, "htlc-claim unstarted throws");
  throwsRe(function () { Htlc.checkClaim(null, "10"); }, /permission row/, "htlc-claim bad row throws");
  throwsRe(function () { Htlc.checkClaim({ started: true, available_raw: "10" }, "1.5"); }, /digit string/, "htlc-claim malformed amount throws");

  /* ---- Htlc hash-algo rejection paths (pre-crypto, deterministic) ---- */
  await rejectsRe(Htlc.checkPreimage("nope", "x", 2, "ab"), /unknown hash algo/, "htlc-hash unknown algo rejects");
  await rejectsRe(Htlc.hashPreimage("ripemd160", "secret"), /ripemd160-unavailable/, "htlc-hash ripemd160 gated");
  await rejectsRe(Htlc.hashPreimage("sha256", ""), /bad-preimage/, "htlc-hash empty preimage rejects");

  console.log(cur.name + ": " + cur.n + " passed, 0 failed");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
