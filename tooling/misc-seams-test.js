/* misc-seams-test.js — minimal seam tests for api/market-charts.js +
 * api/api-lab.js + builders/credit-samet.js + builders/proposal-misc.js +
 * builders/proposal-ticket.js. One section per module. Stdlib assert only
 * (tooling/dom-test.js precedent). No network, deterministic; exit 0 = green.
 * Run: node tooling/misc-seams-test.js
 * market-charts seams: headless chart-kind fallback (hasLightweight false,
 *   panes -> {kind:none}, removePane no-throw, canvas-guard returns).
 * api-lab seams: catalog shape (group/login/method/params/tier), byMethod,
 *   defaults alignment, coerce type vectors.
 * Builder seams: field validation + op-id/shape vectors (credit-samet ops
 *   64-68 with the real Credit rate converter; proposal-misc whitelist/
 *   vesting/claim/authority ops 7/32/33/37/54/55/56; proposal-ticket lock
 *   converters + ops 57/58).
 * GAPS: market-charts pixel paths (need canvas/DOM); api-lab run() (socket);
 *   credit-samet fund/funds/fundsByOwner reads (Chain); proposal-misc
 *   vestings/authority/authorities reads (Chain); proposal-ticket tickets reads;
 *   all fee/sendAndProve live paths.
 */
"use strict";
var path = require("path");
var assert = require("assert");
var MarketCharts = require(path.join(__dirname, "..", "vanilla", "js", "api", "market-charts.js"));
var ApiLab = require(path.join(__dirname, "..", "vanilla", "js", "api", "api-lab.js"));
global.Credit = require(path.join(__dirname, "..", "vanilla", "js", "api", "credit.js"));
var CreditSamet = require(path.join(__dirname, "..", "vanilla", "js", "builders", "credit-samet.js"));
var ProposalMisc = require(path.join(__dirname, "..", "vanilla", "js", "builders", "proposal-misc.js"));
var ProposalTicket = require(path.join(__dirname, "..", "vanilla", "js", "builders", "proposal-ticket.js"));

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
function noThrow(fn, name) {
  try { fn(); pass++; cur.n++; }
  catch (e) { fail++; console.log("FAIL " + name + " threw: " + e.message); }
}
async function rejectsRe(p, re, name) {
  try { await p; fail++; console.log("FAIL " + name + " (no reject)"); }
  catch (e) { if (re.test(String((e && e.message) || e))) { pass++; cur.n++; } else { fail++; console.log("FAIL " + name + " wrong error: " + ((e && e.message) || e)); } }
}

async function main() {
  section("market-charts");
  eq(MarketCharts.hasLightweight(), false, "charts no backend headless");
  eq(MarketCharts.drawPricePane(null, null, {}), { kind: "none", chart: null }, "charts price pane fallback");
  eq(MarketCharts.drawOscPane(null, null, {}), { kind: "none", chart: null }, "charts osc pane fallback");
  noThrow(function () { MarketCharts.removePane(null); }, "charts removePane null no-throw");
  noThrow(function () { MarketCharts.removePane(undefined); }, "charts removePane undefined no-throw");
  noThrow(function () { MarketCharts.removePane({ kind: "none", chart: null }); }, "charts removePane none-handle no-throw");
  eq(MarketCharts.drawPrice(null, [1, 2], null, null, {}, ""), undefined, "charts drawPrice null canvas returns");
  eq(MarketCharts.drawDepth(null, [], [], {}, ""), undefined, "charts drawDepth null canvas returns");
  eq(MarketCharts.drawPrice(undefined, null, null, null, null), undefined, "charts drawPrice undefined returns");

  section("api-lab");
  eq(ApiLab.GROUPS.indexOf("Database") !== -1 && ApiLab.GROUPS.length, 8, "lab 8 groups");
  eq([ApiLab.TIERS.read, ApiLab.TIERS.fee, ApiLab.TIERS.broadcast, ApiLab.TIERS.debug], ["read", "fee", "broadcast", "debug"], "lab tiers");
  eq(ApiLab.METHODS.length > 50, true, "lab catalog breadth");
  var badShape = ApiLab.METHODS.filter(function (m) {
    return !(m.group && m.login && m.method && Array.isArray(m.params) && m.tier);
  });
  eq(badShape.length, 0, "lab every entry has group/login/method/params/tier");
  var go = ApiLab.byMethod("get_objects", "database");
  eq([go.method, go.login], ["get_objects", "database"], "lab byMethod exact");
  eq(ApiLab.byMethod("get_objects", "history").method, "get_objects", "lab byMethod falls back across login");
  eq(ApiLab.byMethod("nope", "database"), null, "lab byMethod miss null");
  eq(ApiLab.defaults(go), ['["1.2.0","1.3.0"]'], "lab defaults aligned examples");
  eq(ApiLab.coerce(go, ['["1.2.0"]']), [["1.2.0"]], "lab coerce strlist");
  var gb = ApiLab.byMethod("get_block", "database");
  eq(ApiLab.coerce(gb, ["100"]), [100], "lab coerce uint");
  throwsRe(function () { ApiLab.coerce(gb, ["abc"]); }, /bad uint/, "lab coerce bad uint throws");
  throwsRe(function () { ApiLab.coerce(gb, [""]); }, /missing: block_num/, "lab coerce missing required throws");
  var tm = ApiLab.byMethod("get_top_markets", "database");
  throwsRe(function () { ApiLab.coerce(tm, ["1001"]); }, /over max/, "lab coerce over max throws");
  var gbh = ApiLab.byMethod("get_block_header", "database");
  eq(ApiLab.coerce(gbh, ["100", ""]), [100, null], "lab coerce optional blank null");
  throwsRe(function () { ApiLab.coerce(gbh, ["100", "yes"]); }, /bad bool/, "lab coerce bad bool throws");
  var ts = ApiLab.byMethod("get_trade_history_by_sequence", "database");
  eq(ApiLab.coerce(ts, ["BTS", "USD", "-5", "2026-01-01T00:00:00", "10"])[2], -5, "lab coerce signed int");
  throwsRe(function () { ApiLab.coerce(go, ['"x"']); }, /need array/, "lab coerce strlist non-array throws");

  section("credit-samet");
  var sc = CreditSamet.buildSametCreate({ accountId: "1.2.5", assetId: "1.3.0", balanceRaw: "100000", rateHuman: "0.1" });
  eq(sc[0], 64, "samet create op id");
  eq(sc[1].fee_rate, 1000, "samet create rate via Credit converter");
  eq(sc[1].fee, { amount: "0", asset_id: "1.3.0" }, "samet create zero fee");
  throwsRe(function () { CreditSamet.buildSametCreate({ accountId: "1.2.5", assetId: "1.3.0", balanceRaw: "0", rateHuman: "0.1" }); }, /> 0/, "samet create zero balance throws");
  throwsRe(function () { CreditSamet.buildSametCreate({ accountId: "1.2.5", assetId: "1.3.0", balanceRaw: "10", rateHuman: "999" }); }, /out of range/, "samet create bad rate throws");
  var su = CreditSamet.buildSametUpdate({ accountId: "1.2.5", fundId: "1.20.0", deltaRawOrNull: "-500", deltaAssetId: "1.3.0", rateHumanOrNull: null });
  eq(su, [66, { fee: { amount: "0", asset_id: "1.3.0" }, owner_account: "1.2.5", fund_id: "1.20.0",
    delta_amount: { amount: "-500", asset_id: "1.3.0" }, new_fee_rate: null, extensions: [] }], "samet update delta shape");
  throwsRe(function () { CreditSamet.buildSametUpdate({ accountId: "1.2.5", fundId: "1.20.0", deltaRawOrNull: null, rateHumanOrNull: null }); }, />= 1 field/, "samet update empty throws");
  eq(CreditSamet.buildSametDelete({ accountId: "1.2.5", fundId: "1.20.0" })[0], 65, "samet delete op id");
  var sb = CreditSamet.buildSametBorrow({ borrowerId: "1.2.7", fundId: "1.20.0", borrowAssetId: "1.3.0", borrowRaw: "1000" });
  eq(sb[1].borrow_amount, { amount: "1000", asset_id: "1.3.0" }, "samet borrow leg raw");
  throwsRe(function () { CreditSamet.buildSametBorrow({ borrowerId: "1.2.7", fundId: "1.20.0", borrowAssetId: "1.3.0", borrowRaw: "0" }); }, /> 0/, "samet borrow zero throws");
  var sr = CreditSamet.buildSametRepay({ accountId: "1.2.7", fundId: "1.20.0", assetId: "1.3.0", repayRaw: "1000", feeRaw: "10" });
  eq(sr[0], 68, "samet repay op id");
  eq(sr[1].fund_fee, { amount: "10", asset_id: "1.3.0" }, "samet repay fee leg raw");
  await rejectsRe(CreditSamet.funds({ limit: 0 }), /limit must be/, "samet funds bad limit throws pre-read");
  throwsRe(function () { CreditSamet.buildSametRepay({ accountId: "1.2.7", fundId: "1.20.0", assetId: "1.3.0", repayRaw: "0", feeRaw: "10" }); }, /> 0/, "samet repay zero repay throws");

  section("proposal-misc");
  eq(ProposalMisc.listingLabel(0), "none", "misc listing 0");
  eq(ProposalMisc.listingLabel(3), "both", "misc listing 3");
  throwsRe(function () { ProposalMisc.listingLabel(4); }, /0-3/, "misc listing bad throws");
  eq(ProposalMisc.listingFromHuman("whitelisted"), 1, "misc listing word");
  eq(ProposalMisc.listingFromHuman("black"), 2, "misc listing short word");
  throwsRe(function () { ProposalMisc.listingFromHuman("gold"); }, /0-3/, "misc listing unknown throws");
  eq(ProposalMisc.listingAdd(0, 1), 1, "misc bit add white");
  eq(ProposalMisc.listingAdd(1, 2), 3, "misc bit OR to both");
  eq(ProposalMisc.listingRemove(3, 2), 1, "misc bit clear black");
  throwsRe(function () { ProposalMisc.listingAdd(0, 4); }, /1 \(white\) or 2/, "misc bit bad bit throws");
  throwsRe(function () { ProposalMisc.requireClaimable([]); }, /no-claimables/, "misc empty claimables throws");
  eq(ProposalMisc.requireClaimable([{ id: "1.13.0" }]).length, 1, "misc claimables passthrough");
  var wl = ProposalMisc.buildWhitelist({ authorizerId: "1.2.5", listeeId: "1.2.7", newListing: 1 });
  eq(wl, [7, { fee: { amount: "0", asset_id: "1.3.0" }, authorizing_account: "1.2.5",
    account_to_list: "1.2.7", new_listing: 1, extensions: [] }], "misc whitelist shape");
  throwsRe(function () { ProposalMisc.buildWhitelist({ authorizerId: "1.2.5", listeeId: "1.2.7", newListing: 9 }); }, /0-3/, "misc whitelist bad listing throws");
  var vc = ProposalMisc.buildVestingCreate({ creatorId: "1.2.5", ownerId: "1.2.7", amountRaw: "1000",
    assetId: "1.3.0", policy: [2, {}] });
  eq(vc[0], 32, "misc vesting create op id");
  throwsRe(function () { ProposalMisc.buildVestingCreate({ creatorId: "1.2.5", ownerId: "1.2.7",
    amountRaw: "1000", assetId: "1.3.0", policy: { type: 2 } }); }, /array form/, "misc vesting object policy throws");
  var vw = ProposalMisc.buildVestingWithdraw({ ownerId: "1.2.7", vestingId: "1.13.0", amountRaw: "5", assetId: "1.3.0" });
  eq(vw[0], 33, "misc vesting withdraw op id");
  eq("extensions" in vw[1], false, "misc op-33 carries no extensions");
  throwsRe(function () { ProposalMisc.buildBalanceClaim({ depositId: "1.2.5", balanceId: "1.15.0",
    amountRaw: "5", assetId: "1.3.0", ownerKey: "" }); }, /ownerKey/, "misc claim empty key throws");
  var bc = ProposalMisc.buildBalanceClaim({ depositId: "1.2.5", balanceId: "1.15.0",
    amountRaw: "5", assetId: "1.3.0", ownerKey: "BTS6xxx" });
  eq(bc[0], 37, "misc balance claim op id");
  var ac = ProposalMisc.buildAuthorityCreate({ accountId: "1.2.5", validFromIso: "2026-01-01T00:00:00",
    validToIso: "2027-01-01T00:00:00", opType: 0, enabled: true,
    auth: { weight_threshold: 1, account_auths: [] }, restrictions: [] });
  eq(ac[0], 54, "misc authority create op id");
  var au = ProposalMisc.buildAuthorityUpdate({ accountId: "1.2.5", authorityId: "1.17.0" });
  eq([au[1].new_enabled, au[1].new_auth, au[1].restrictions_to_remove], [null, null, []], "misc authority update nulls stay null");
  eq(ProposalMisc.buildAuthorityDelete({ accountId: "1.2.5", authorityId: "1.17.0" })[0], 56, "misc authority delete op id");

  section("proposal-ticket");
  eq(ProposalTicket.lockLabel(0), "liquid", "ticket lock 0 word");
  eq(ProposalTicket.lockLabel(4), "forever", "ticket lock 4 word");
  eq(ProposalTicket.lockLabel("lock_360_days"), "360-day lock", "ticket lock enum string");
  throwsRe(function () { ProposalTicket.lockLabel(5); }, /bad-lock-type/, "ticket lock 5 throws");
  throwsRe(function () { ProposalTicket.lockLabel("someday"); }, /bad-lock-type/, "ticket lock unknown word throws");
  eq(ProposalTicket.lockFromHuman("180d"), 1, "ticket lock 180d");
  eq(ProposalTicket.lockFromHuman("forever"), 4, "ticket lock forever");
  eq(ProposalTicket.lockFromHuman("360"), 2, "ticket lock bare number");
  throwsRe(function () { ProposalTicket.lockFromHuman("90d"); }, /bad-lock-type/, "ticket lock bad human throws");
  var tc = ProposalTicket.buildTicketCreate({ accountId: "1.2.5", amountRaw: "100000", assetId: "1.3.0", targetType: 1 });
  eq(tc, [57, { fee: { amount: "0", asset_id: "1.3.0" }, account: "1.2.5", target_type: 1,
    amount: { amount: "100000", asset_id: "1.3.0" }, extensions: [] }], "ticket create shape");
  throwsRe(function () { ProposalTicket.buildTicketCreate({ accountId: "1.2.5", amountRaw: "1", assetId: "1.3.0", targetType: 9 }); }, /0-4/, "ticket create bad lock throws");
  var tu = ProposalTicket.buildTicketUpdate({ ticketId: "1.18.0", accountId: "1.2.5", targetType: 2,
    amountRawOrNull: null, assetIdOrNull: null });
  eq(tu[1].amount_for_new_target, null, "ticket update null amount absent");
  var tu2 = ProposalTicket.buildTicketUpdate({ ticketId: "1.18.0", accountId: "1.2.5", targetType: 2,
    amountRawOrNull: "500", assetIdOrNull: "1.3.0" });
  eq(tu2[1].amount_for_new_target, { amount: "500", asset_id: "1.3.0" }, "ticket update amount kept");
  throwsRe(function () { ProposalTicket.buildTicketUpdate({ ticketId: "1.18.0", accountId: "1.2.5",
    targetType: 2, amountRawOrNull: "500", assetIdOrNull: null }); }, /assetIdOrNull/, "ticket update amount without asset throws");
  await rejectsRe(ProposalTicket.tickets({ limit: 101 }), /limit must be/, "ticket list over-limit throws pre-read");
  await rejectsRe(ProposalTicket.tickets({ limit: 0 }), /limit must be/, "ticket list zero throws pre-read");

  console.log(cur.name + ": " + cur.n + " passed, 0 failed");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
