/* vote-credit-gateway-test.js — pure-logic vectors for api/vote.js +
 * api/credit.js + api/gateway.js. Stdlib assert only (tooling/dom-test.js
 * precedent). No network, deterministic; exit 0 = green.
 * Run: node tooling/vote-credit-gateway-test.js
 * Vote seams: currentVotes slate join (Chain/Account stubbed — no socket).
 * Credit seams: rate/tcr converters (percent shapes), creditFee integer math,
 *   durToHuman/durToSeconds, autoRepayWord, buildCallUpdate/buildOfferDelete/
 *   buildDealUpdate field validation, positionsMethod probe cache.
 * Gateway seams (importably pure): cacheGet/cacheSet round trip, list()
 *   registry shape, pre-fetch validation rejections (bad-account/bad-coin/
 *   unknown-gateway/disabled), health unknown-id (no fetch).
 * GAPS (chain/network-coupled): Vote.lists and witness/committee/worker reads
 *   (Chain reads); Credit offer/deal/position reads + symbol joins
 *   (_joinAssets/_legJoin/_normOffer/_normDeal are private + need lookup_asset_symbols);
 *   Gateway normalizeRow/normalizeList/addrKey/parseJson/mapDepositResponse/
 *   gdexEnvelope/storeDeposit (NOT exported — untestable headless, call out for
 *   a future export if vectors are wanted); any deposit/coins/health fetch path.
 */
"use strict";
var path = require("path");
var assert = require("assert");
var Vote = require(path.join(__dirname, "..", "vanilla", "js", "api", "vote.js"));
var Credit = require(path.join(__dirname, "..", "vanilla", "js", "api", "credit.js"));
var Gateway = require(path.join(__dirname, "..", "vanilla", "js", "api", "gateway.js"));

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
  catch (e) { if (re.test(String((e && e.message) || e))) { pass++; cur.n++; } else { fail++; console.log("FAIL " + name + " wrong error: " + ((e && e.message) || e)); } }
}

/* Chain/Account test doubles: no socket, canned rows. */
function stubChain(rowsById) {
  global.Chain = {
    db: function () { return Promise.resolve(0); },
    call: function (apiId, method, params) {
      if (method === "get_accounts") {
        var id = (params[0] || [])[0];
        var row = Object.prototype.hasOwnProperty.call(rowsById, id) ? rowsById[id] : null;
        return Promise.resolve([row]);
      }
      return Promise.reject(new Error("unexpected method " + method));
    }
  };
}
var SLATE = { options: { voting_account: "1.2.9", num_witness: 5, num_committee: 3,
  votes: ["0:12", "1:5", "2:77", "9:1", 42] } };

async function main() {
  section("vote");
  stubChain({ "1.2.5": { options: { voting_account: "1.2.5", votes: [] } }, "1.2.7": SLATE, "1.2.9": SLATE });
  global.Account = { resolve: function (x) { return Promise.resolve({ id: "1.2.9", name: "proxy-acct" }); } };
  var cv = await Vote.currentVotes("1.2.7");
  eq(cv.byType, { committee: ["0:12"], witness: ["1:5"], worker: ["2:77"] }, "vote slate split by type prefix");
  eq(cv.votes, ["0:12", "1:5", "2:77", "9:1", 42], "vote raw slate verbatim incl unknown prefix");
  eq(cv.voting_account, "1.2.9", "vote proxy id kept");
  eq(cv.voting_account_name, "proxy-acct", "vote proxy name joined");
  eq([cv.num_witness, cv.num_committee], [5, 3], "vote counts passthrough");
  var sent = await Vote.currentVotes("1.2.5");
  eq(sent.voting_account, "1.2.5", "vote sentinel id kept");
  eq(sent.voting_account_name, "", "vote sentinel yields no proxy name");
  var named = await Vote.currentVotes("alice");
  eq(named.voting_account, "1.2.9", "vote name input resolved");
  await rejectsRe(Vote.currentVotes(""), /unknown-account/, "vote empty input rejects");
  await rejectsRe(Vote.currentVotes("1.2.0"), /unknown-account/, "vote null row rejects");
  stubChain({ "1.2.7": { options: { voting_account: "1.2.5" } } });
  var bare = await Vote.currentVotes("1.2.7");
  eq([bare.num_witness, bare.num_committee, bare.votes], [0, 0, []], "vote missing counts/votes default");
  eq(Vote.PROXY_TO_SELF, "1.2.5", "vote sentinel exported");
  delete global.Chain; delete global.Account;

  section("credit");
  /* Fee-rate converters: denom 1M, string math, non-BTS precision irrelevant (unitless). */
  eq(Credit.rateUnitsToHuman(0), "0", "credit rate 0");
  eq(Credit.rateUnitsToHuman(1), "0.0001", "credit rate smallest step");
  eq(Credit.rateUnitsToHuman(1000), "0.1", "credit rate 0.1%");
  eq(Credit.rateUnitsToHuman(10000), "1", "credit rate 1%");
  eq(Credit.rateUnitsToHuman(1000000), "100", "credit rate 100% cap");
  throwsRe(function () { Credit.rateUnitsToHuman(1000001); }, /rate-trap/, "credit rate over 100% throws");
  throwsRe(function () { Credit.rateUnitsToHuman(-1); }, /rate-trap/, "credit rate negative throws");
  eq(Credit.rateHumanToUnits("0.1"), 1000, "credit rate parse 0.1");
  eq(Credit.rateHumanToUnits("100"), 1000000, "credit rate parse 100");
  throwsRe(function () { Credit.rateHumanToUnits("0.00001"); }, /bad rate/, "credit rate 5 decimals throws");
  throwsRe(function () { Credit.rateHumanToUnits("abc"); }, /bad rate/, "credit rate malformed throws");
  throwsRe(function () { Credit.rateHumanToUnits("100.0001"); }, /out of range/, "credit rate over cap throws");
  /* TCR converters: divisor 1000. */
  eq(Credit.tcrUnitsToHuman(1750), "1.75", "credit tcr 1750 -> 1.75");
  eq(Credit.tcrUnitsToHuman(0), "0", "credit tcr zero");
  eq(Credit.tcrHumanToUnits("1.75"), 1750, "credit tcr parse round trip");
  throwsRe(function () { Credit.tcrHumanToUnits("0.1234"); }, /bad TCR/, "credit tcr 4 decimals throws");
  /* Integer fee quotes (ceil, BigInt). */
  eq(Credit.creditFee("1000000", 10000), "10000", "credit fee 1% of 1M");
  eq(Credit.creditFee("1", 1000000), "1", "credit fee ceil dust to 1");
  eq(Credit.creditFee("0", 500), "0", "credit fee zero amount");
  eq(Credit.creditFee("3", 1), "1", "credit fee ceil tiny rate");
  throwsRe(function () { Credit.creditFee("1.5", 1); }, /digit string/, "credit fee float string throws");
  /* Duration helpers. */
  eq(Credit.durToHuman("259200"), "3 days", "credit dur human");
  eq(Credit.durToSeconds("3 days"), 259200, "credit dur words");
  eq(Credit.durToSeconds("3d"), 259200, "credit dur short unit");
  eq(Credit.durToSeconds("90 min"), 5400, "credit dur minutes");
  eq(Credit.durToSeconds("3600"), 3600, "credit dur bare number string");
  eq(Credit.durToSeconds(3600), 3600, "credit dur int passthrough");
  throwsRe(function () { Credit.durToSeconds("5x"); }, /bad duration/, "credit dur bad unit throws");
  /* Auto-repay words + builders. */
  eq(Credit.autoRepayWord(0), "no auto-repayment", "credit auto 0");
  eq(Credit.autoRepayWord(2), "allow partial repayment", "credit auto 2");
  throwsRe(function () { Credit.autoRepayWord(3); }, /0\/1\/2/, "credit auto bad throws");
  var cu = Credit.buildCallUpdate({ accountId: "1.2.5", collId: "1.3.0", debtId: "1.3.113",
    collRaw: "100000", debtRaw: "-50000", tcrUnitsOrNull: null });
  eq(cu[0], 3, "credit callupdate op id");
  eq(cu[1].delta_debt, { amount: "-50000", asset_id: "1.3.113" }, "credit callupdate negative debt kept");
  eq(cu[1].extensions, [], "credit callupdate null tcr -> empty extensions");
  var cut = Credit.buildCallUpdate({ accountId: "1.2.5", collId: "1.3.0", debtId: "1.3.113",
    collRaw: "100000", debtRaw: "50000", tcrUnitsOrNull: 1750 });
  eq(cut[1].extensions, { target_collateral_ratio: 1750 }, "credit callupdate tcr extension");
  var od = Credit.buildOfferDelete({ accountId: "1.2.5", offerId: "1.21.0" });
  eq(od[0], 70, "credit offerdelete op id");
  var du = Credit.buildDealUpdate({ accountId: "1.2.5", dealId: "1.22.0", autoRepay: 1 });
  eq(du[1].auto_repay, 1, "credit dealupdate repay kept");
  throwsRe(function () { Credit.buildDealUpdate({ accountId: "1.2.5", dealId: "1.22.0", autoRepay: 5 }); }, /0\/1\/2/, "credit dealupdate bad repay throws");
  eq(Credit.positionsMethod(), "unprobed", "credit positions cache starts unprobed");
  eq([Credit.FEE_RATE_DENOM, Credit.TCR_DIVISOR], [1000000, 1000], "credit denoms exported");

  section("gateway");
  var hit = Gateway.cacheSet("gw_test_key", { address: "ABC", memo: "m" });
  eq(hit.data, { address: "ABC", memo: "m" }, "gateway cache set returns envelope");
  eq(Gateway.cacheGet("gw_test_key").data, { address: "ABC", memo: "m" }, "gateway cache round trip");
  eq(Gateway.cacheGet("gw_missing_key"), null, "gateway cache miss null");
  var ids = Gateway.list().map(function (e) { return e.id; });
  eq(ids, ["XBTSX", "IOB", "GDEX", "BTWTY"], "gateway registry ids");
  var xbtsx = Gateway.list().filter(function (e) { return e.id === "XBTSX"; })[0];
  eq([xbtsx.enabled, typeof xbtsx.reason], [true, "object"], "gateway xbtsx enabled");
  var gdex = Gateway.list().filter(function (e) { return e.id === "GDEX"; })[0];
  eq(gdex.enabled, false, "gateway gdex disabled");
  await rejectsRe(Gateway.depositAddress("XBTSX", { account: "", coin: "BTC" }), /bad-account/, "gateway empty account rejects pre-fetch");
  await rejectsRe(Gateway.depositAddress("XBTSX", { account: "alice", coin: "" }), /bad-coin/, "gateway empty coin rejects pre-fetch");
  await rejectsRe(Gateway.depositAddress("NOPE", { account: "alice", coin: "BTC" }), /unknown-gateway/, "gateway unknown id rejects");
  await rejectsRe(Gateway.coins("NOPE"), /unknown-gateway/, "gateway coins unknown rejects");
  await rejectsRe(Gateway.coins("BTWTY"), /disabled/, "gateway coins disabled rejects");
  await rejectsRe(Gateway.validateWithdrawAddress("XBTSX", { address: "" }), /bad-account/, "gateway empty withdraw address rejects");
  var h1 = await Gateway.health("NOPE");
  eq([h1.ok, h1.reason], [false, "unknown-gateway: NOPE"], "gateway health unknown shape");
  eq(typeof h1.at, "number", "gateway health carries timestamp");
  await rejectsRe(Gateway.withdrawPrefill("BTWTY", "BTC"), /disabled/, "gateway btwty prefill disabled");

  console.log(cur.name + ": " + cur.n + " passed, 0 failed");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
