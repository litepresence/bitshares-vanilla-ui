#!/usr/bin/env node
/* settle-cr-test.js — R1d+R1e vectors: settlement estimate, CR bands, settle sort.
 * Stdlib only. Exit 0 green, 1 red. All money math via vanilla/js/format.js.
 * Chain truth: #1 ExchangeHeader.jsx:190-198 (offset formula, base CORE branch),
 *   BorrowModal.jsx:572-604 = MarginPosition.jsx:79-97 (CR + MCR/1000 + 0.5 band),
 *   #4 database_api.hpp:558 get_settle_orders(assetId,100) <=300, sorted earliest->latest.
 */
"use strict";
const Format = require("/workspace/vanilla/js/format.js");
const Market = require("/workspace/vanilla/js/market.js");
let pass = 0, fail = 0;
function eq(got, want, name) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}
function throws(fn, name) {
  try { fn(); fail++; console.log("FAIL " + name + " (did not throw)"); }
  catch (e) { pass++; }
}

/* R1d SETTLEMENT ESTIMATE — offset 0 equals feedReal (both branches). */
eq(Format.settleEstimate("100", 2, "100", 2, 0, true, 8), Format.formatPrice("100", 2, "100", 2, 8), "offset 0 core-true == feed");
eq(Format.settleEstimate("100", 2, "100", 2, 0, false, 8), Format.formatPrice("100", 2, "100", 2, 8), "offset 0 core-false == feed");
eq(Format.settleEstimate("100000", 5, "5000", 4, 0, true, 8), Format.formatPrice("100000", 5, "5000", 4, 8), "offset 0 non-BTS precisions == feed");

/* R1d nonzero offset, both branches, BTS-ish precisions (2/2, feed 1.0, off 100 = 1%). */
eq(Format.settleEstimate("100", 2, "100", 2, 100, true, 8), "0.99009901", "offset 100 core-true 1/1.01");
eq(Format.settleEstimate("100", 2, "100", 2, 100, false, 8), "1.01000000", "offset 100 core-false 1*1.01");

/* R1d non-BTS precisions (p4/p2, feed 1.0 and 4.0, off 100/200). */
eq(Format.settleEstimate("10000", 4, "100", 2, 100, false, 8), "1.01000000", "non-BTS p4/p2 feed 1.0 off 100");
eq(Format.settleEstimate("20000", 4, "50", 2, 200, false, 8), "4.08000000", "non-BTS p4/p2 feed 4.0 off 200 core-false");
eq(Format.settleEstimate("20000", 4, "50", 2, 200, true, 8), "3.92156863", "non-BTS p4/p2 feed 4.0 off 200 core-true");

/* R1d global-settle branch: fund>0 uses settlement_price directly (formatPrice),
 * live uses estimate (they differ when offset nonzero — branch matters). */
(function globalBranch() {
  const feedB = "100", feedQ = "100";
  const live = Format.settleEstimate(feedB, 2, feedQ, 2, 100, false, 8);
  const global = Format.formatPrice(feedB, 2, feedQ, 2, 8);
  eq(live, "1.01000000", "live estimate with offset");
  eq(global, "1.00000000", "global uses settlement_price directly");
  eq(live !== global, true, "global vs live differ when offset nonzero");
  /* Fund flag is exact BigInt (desk parity): "0"/"000" false, "1" true. */
  eq(BigInt("0") > 0n, false, "fund 0 not settled");
  eq(BigInt("000") > 0n, false, "fund 000 not settled");
  eq(BigInt("1") > 0n, true, "fund 1 settled");
  eq(BigInt("10004248") > 0n, true, "fund nonzero settled");
})();

/* R1e CR — exact num/den + display + bands (MCR 1750 = 1.75). */
(function cr() {
  /* Feed CR 2.0 (warning band: >=1.75 but <2.25). */
  const nd = Format.collateralNumDen("200", "100", "100", "100");
  eq(nd, { num: "20000", den: "10000" }, "CR num/den 2.0");
  eq(Format.formatRatio2dp(nd.num, nd.den), "2.00", "CR display 2.00");
  eq(Format.formatRatioPct2dp(nd.num, nd.den), "200.00", "CR pct 200.00");
  eq(Format.ratioBelowMcr(nd.num, nd.den, 1750), false, "CR 2.0 not danger");
  eq(Format.ratioBelowMcrPlusHalf(nd.num, nd.den, 1750), true, "CR 2.0 warning");
  /* Danger 1.0. */
  const d = Format.collateralNumDen("100", "100", "100", "100");
  eq(Format.ratioBelowMcr(d.num, d.den, 1750), true, "CR 1.0 danger");
  /* Safe 3.0. */
  const s = Format.collateralNumDen("300", "100", "100", "100");
  eq(Format.ratioBelowMcr(s.num, s.den, 1750), false, "CR 3.0 not danger");
  eq(Format.ratioBelowMcrPlusHalf(s.num, s.den, 1750), false, "CR 3.0 safe");
  /* Boundary MCR exactly (1.75 == 1750/1000): exclusive, safe from danger. */
  eq(Format.ratioBelowMcr("175", "100", 1750), false, "boundary mcr exclusive");
  eq(Format.ratioBelowMcrPlusHalf("175", "100", 1750), true, "boundary mcr still warning");
  /* Boundary MCR+0.5 exactly (2.25): exclusive, safe. */
  eq(Format.ratioBelowMcr("225", "100", 1750), false, "boundary half not danger");
  eq(Format.ratioBelowMcrPlusHalf("225", "100", 1750), false, "boundary half exclusive safe");
  /* Just below each edge (integer-exact, no float). */
  eq(Format.ratioBelowMcr("1749", "1000", 1750), true, "just below mcr danger");
  eq(Format.ratioBelowMcrPlusHalf("2249", "1000", 1750), true, "just below half warning");
  eq(Format.ratioBelowMcr("2249", "1000", 1750), false, "2.249 not danger");
  /* MCR human (Format twin, divisor 1000). */
  eq(Format.mcrUnitsToHuman(1750), "1.75", "MCR 1750 -> 1.75");
  eq(Format.mcrUnitsToHuman(1500), "1.5", "MCR 1500 -> 1.5");
  eq(Format.mcrUnitsToHuman(1755), "1.755", "MCR 1755 -> 1.755");
  /* Nominal fallback round-trip (no feed): coll 1.0 p5 / debt 0.5 p4 = 2.0 units. */
  const nn = Format.nominalNumDen("100000", 5, "5000", 4);
  eq(Format.formatRatio2dp(nn.num, nn.den), "2.00", "nominal 2.00 round-trip");
  /* Guards (never silent zero). */
  throws(() => Format.settleEstimate("100", 2, "0", 2, 0, true, 8), "zero quote throws");
  throws(() => Format.collateralNumDen("100", "0", "100", "100"), "zero feed base throws");
  throws(() => Format.formatRatio2dp("1", "0"), "zero den throws");
})();

/* R1e settle-date sort (earliest -> latest, missing last, input untouched). */
(function sort() {
  const rows = [
    { id: "1.4.3", settlement_date: "2026-01-03T00:00:00", balance: { amount: "300", asset_id: "1.3.15" } },
    { id: "1.4.1", settlement_date: "2026-01-01T00:00:00", balance: { amount: "100", asset_id: "1.3.15" } },
    { id: "1.4.2", settlement_date: "2026-01-02T00:00:00", balance: { amount: "200", asset_id: "1.3.15" } },
    { id: "1.4.4", balance: { amount: "400", asset_id: "1.3.15" } }
  ];
  const sorted = Market.sortSettles(rows);
  eq(sorted.map(r => r.id), ["1.4.1", "1.4.2", "1.4.3", "1.4.4"], "settle-date sort ascending, missing last");
  eq(rows.map(r => r.id), ["1.4.3", "1.4.1", "1.4.2", "1.4.4"], "sort does not mutate input");
  eq(Market.sortSettles([]), [], "empty sorts to empty");
})();

console.log("settle-cr-test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
