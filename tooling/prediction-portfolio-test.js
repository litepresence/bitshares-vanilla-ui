#!/usr/bin/env node
/* prediction-portfolio-test.js — offline vectors for prediction portfolio PnL,
 * status classification (incl. boundary expiry==now), countdown shaping.
 * Stdlib only: `node tooling/prediction-portfolio-test.js` (exit 0 green).
 * Money rule: all amount conversions via Format (parse/format), arithmetic
 * BigInt integer-only, never float. Chain truth: #4 asset_object.hpp:299
 * is_globally_settled = !settlement_price.is_null(); fill legs
 * protocol/market.hpp:206-220; ticker latest base-per-quote (market.js).
 */
"use strict";
const Format = require("/workspace/vanilla/js/api/format.js");
const Prediction = require("/workspace/vanilla/js/api/prediction.js");
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

/* ---- Format PnL math ---- */
(function pnl() {
  // Long profit: 1.0000 PMA (10000 @p4) bought 2 PMA for 1.0 TEST, avg 0.5; current 1.0 -> +0.5
  eq(Format.costForHolding("10000", "20000", "100000"), "50000", "long cost 1 PMA @ avg 0.5");
  eq(Format.valueFromFeedRaw("10000", "10000", "100000"), "100000", "long current 1.0 via feed");
  eq(Format.pnlRaw("100000", "50000", "0"), "50000", "long pnl +0.5");
  eq(Format.formatAmount("50000", 5), "0.50000", "long human 0.50000 TEST");
  // Short loss: bought 1 PMA for 1.0, price fell to 0.5 -> -0.5
  eq(Format.costForHolding("10000", "10000", "100000"), "100000", "short cost 1.0");
  eq(Format.valueFromFeedRaw("10000", "10000", "50000"), "50000", "short current 0.5 via feed");
  eq(Format.pnlRaw("50000", "100000", "0"), "-50000", "short pnl -0.5");
  eq(Format.formatAmount("-50000", 5), "-0.50000", "short human -0.50000");
  // Zero-cost: no fills, holding 1 PMA, current 1.0 -> all profit
  eq(Format.costForHolding("10000", "0", "0"), "0", "zero-cost returns 0");
  eq(Format.pnlRaw("100000", "0", "0"), "100000", "zero-cost pnl == current");
  // Worthless outcome: current 0 -> -cost
  eq(Format.valueFromFeedRaw("10000", "10000", "0"), "0", "worthless current 0");
  eq(Format.pnlRaw("0", "50000", "0"), "-50000", "worthless pnl -cost");
  // Fee-aware: current 1.0 - cost 0.5 - fee 0.1 = 0.4
  eq(Format.pnlRaw("100000", "50000", "10000"), "40000", "fee-aware pnl 0.4");
  eq(Format.formatAmount("40000", 5), "0.40000", "fee-aware human");
  // Mid-human path: 1 PMA @p4, backing @p5, mid 0.95 -> 95000 raw (0.95)
  eq(Format.valueFromMidHuman("10000", 4, 5, "0.95"), "95000", "mid 0.95 -> 95000");
  eq(Format.valueFromMidHuman("10000", 4, 5, "1"), "100000", "mid 1 -> 100000");
  // Avg per-unit via formatPrice: paid 1.0 TEST @p5 / received 2 PMA @p4 = 0.5
  eq(Format.formatPrice("100000", 5, "20000", 4, 8), "0.50000000", "avg per-unit 0.5");
  // Guards
  throws(() => Format.costForHolding("abc", "1", "1"), "bad holding throws");
  throws(() => Format.valueFromFeedRaw("100", "0", "100"), "zero feed base throws");
  throws(() => Format.valueFromMidHuman("100", 4, 5, "abc"), "bad mid throws");
  throws(() => Format.pnlRaw("abc", "0", "0"), "bad pnl input throws");
})();

/* ---- costBasisFromFills ---- */
(function basis() {
  const PMA = "1.3.1", BACK = "1.3.0";
  // Buys only: receive 2 PMA for 1.0 TEST across 2 fills
  const buys = [
    { op: [4, { pays: { amount: "60000", asset_id: BACK }, receives: { amount: "12000", asset_id: PMA } }] },
    { op: [4, { pays: { amount: "40000", asset_id: BACK }, receives: { amount: "8000", asset_id: PMA } }] },
  ];
  const b1 = Prediction.costBasisFromFills(buys, PMA);
  eq(b1.receivedRaw, "20000", "buys received 20000");
  eq(b1.paidRaw, "100000", "buys paid 100000");
  eq(b1.mixed, false, "buys not mixed");
  // Buys + sells net: buy 2 PMA for 1.0, sell 0.5 PMA for 0.4 -> net 1.5 PMA, 0.6 cost
  const net = [
    { op: [4, { pays: { amount: "100000", asset_id: BACK }, receives: { amount: "20000", asset_id: PMA } }] },
    { op: [4, { pays: { amount: "5000", asset_id: PMA }, receives: { amount: "40000", asset_id: BACK } }] },
  ];
  const b2 = Prediction.costBasisFromFills(net, PMA);
  eq(b2.receivedRaw, "15000", "net received 15000");
  eq(b2.paidRaw, "60000", "net paid 60000");
  // Mixed cost assets: pays in two different assets
  const mixed = [
    { op: [4, { pays: { amount: "100", asset_id: BACK }, receives: { amount: "10", asset_id: PMA } }] },
    { op: [4, { pays: { amount: "100", asset_id: "1.3.2" }, receives: { amount: "10", asset_id: PMA } }] },
  ];
  eq(Prediction.costBasisFromFills(mixed, PMA).mixed, true, "mixed cost flagged");
  // Zero fills
  eq(Prediction.costBasisFromFills([], PMA).receivedRaw, "0", "no fills zero-cost");
  // Non-fill ops skipped
  const withTransfer = buys.concat([{ op: [0, { amount: { amount: "1", asset_id: PMA } }] }]);
  eq(Prediction.costBasisFromFills(withTransfer, PMA).receivedRaw, "20000", "transfer skipped");
  // Bare body shape accepted
  const bare = [{ pays: { amount: "100", asset_id: BACK }, receives: { amount: "10", asset_id: PMA } }];
  eq(Prediction.costBasisFromFills(bare, PMA).receivedRaw, "10", "bare body accepted");
})();

/* ---- isSettledBitasset (#4 wins: price null-check, fund OR) ---- */
(function settled() {
  eq(Prediction.isSettledBitasset(null), false, "null not settled");
  eq(Prediction.isSettledBitasset({}), false, "empty not settled");
  eq(Prediction.isSettledBitasset({
    settlement_price: { base: { amount: "100", asset_id: "1.3.1" }, quote: { amount: "95", asset_id: "1.3.0" } },
    settlement_fund: "0"
  }), true, "price nonzero settles (fund 0)");
  eq(Prediction.isSettledBitasset({ settlement_price: null, settlement_fund: "0" }), false, "null price + zero fund open");
  eq(Prediction.isSettledBitasset({ settlement_price: null, settlement_fund: "100" }), true, "null price + fund OR settles");
  eq(Prediction.isSettledBitasset({
    settlement_price: { base: { amount: "0", asset_id: "1.3.1" }, quote: { amount: "0", asset_id: "1.3.0" } },
    settlement_fund: "0"
  }), false, "zero legs not settled");
})();

/* ---- classifyStatus (boundary expiry==now stays active) ---- */
(function status() {
  const NOW = Date.parse("2026-06-01T00:00:00Z");
  const FUT = "2026-07-01T00:00:00Z", PAST = "2026-05-01T00:00:00Z";
  const AT = "2026-06-01T00:00:00Z";
  eq(Prediction.classifyStatus({ expiryIso: FUT, nowMs: NOW, settled: false }), "active", "future unsettled active");
  eq(Prediction.classifyStatus({ expiryIso: PAST, nowMs: NOW, settled: false }), "expired", "past unsettled expired");
  eq(Prediction.classifyStatus({ expiryIso: PAST, nowMs: NOW, settled: true }), "settled", "settled wins over past");
  eq(Prediction.classifyStatus({ expiryIso: FUT, nowMs: NOW, settled: true }), "settled", "settled wins over future");
  eq(Prediction.classifyStatus({ expiryIso: AT, nowMs: NOW, settled: false }), "active", "boundary expiry==now active");
  eq(Prediction.classifyStatus({ expiryIso: "", nowMs: NOW, settled: false }), "active", "missing expiry active");
  eq(Prediction.classifyStatus({ expiryIso: "not-a-date", nowMs: NOW, settled: false }), "active", "bad expiry active");
  eq(Prediction.classifyStatus({ expiryIso: "", nowMs: NOW, settled: true }), "settled", "missing + settled");
})();

/* ---- countdown shaping (pure time math) ---- */
(function countdown() {
  const NOW = Date.parse("2026-06-01T00:00:00Z");
  eq(Prediction.countdownText(Prediction.countdownParts("", NOW)), "No expiry", "none");
  eq(Prediction.countdownText(Prediction.countdownParts("bad", NOW)), "No expiry", "bad -> none");
  eq(Prediction.countdownText(Prediction.countdownParts("2026-06-01T00:00:00Z", NOW)), "Closes now", "now");
  eq(Prediction.countdownText(Prediction.countdownParts("2026-06-01T00:01:30Z", NOW)), "1m 30s", "90s future");
  eq(Prediction.countdownText(Prediction.countdownParts("2026-06-01T01:01:40Z", NOW)), "1h 1m", "3700s -> 1h 1m");
  eq(Prediction.countdownText(Prediction.countdownParts("2026-06-02T01:00:00Z", NOW)), "1d 1h", "25h -> 1d 1h");
  eq(Prediction.countdownText(Prediction.countdownParts("2026-06-01T00:00:10Z", NOW)), "10s", "10s");
  eq(Prediction.countdownText(Prediction.countdownParts("2026-05-30T00:00:00Z", NOW)), "Expired 2d ago", "2d ago");
  eq(Prediction.countdownText(Prediction.countdownParts("2026-05-31T23:55:00Z", NOW)), "Expired 5m ago", "5m ago");
  // sortClosingSoon: ascending, missing last, input untouched
  const rows = [
    { id: "c", expiryIso: "2026-07-01T00:00:00Z" },
    { id: "a", expiryIso: "2026-05-01T00:00:00Z" },
    { id: "b", expiryIso: "" },
  ];
  const sorted = Prediction.sortClosingSoon(rows);
  eq(sorted.map(r => r.id), ["a", "c", "b"], "closing-soon sort");
  eq(rows.map(r => r.id), ["c", "a", "b"], "sort does not mutate");
})();

console.log("prediction-portfolio-test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
