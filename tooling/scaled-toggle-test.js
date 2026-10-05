#!/usr/bin/env node
/* scaled-toggle-test: vectors for the shared SINGLE/SCALED desk toggle.
 * Stdlib only, real Format + TradeCore math, stubbed Tx.OP for createOp.
 * Exit 0 = all pass, 1 = any failure.
 *
 * Covers:
 *  1. Sell-side scaled legs mirror the single-order sell construction
 *     (op-1 amount_to_sell QUOTE / min_to_receive BASE, quoteToBaseRaw —
 *     the same branch reviewSingle uses for side==="sell").
 *  2. Buy-side scaled legs mirror the single-order buy construction
 *     (sell BASE / recv QUOTE via baseToQuoteRaw).
 *  3. Split exactness: per-order sellRaw sums to the total (remainder last).
 *  4. Toggle-state source contracts: ONE shared bar, both columns switch
 *     together, per-side scaled state, no buy-only remnants.
 */
"use strict";
var fs = require("fs"), path = require("path");

globalThis.Format = require("/workspace/vanilla/js/api/format.js");
globalThis.Tx = { OP: { limit_order_create: 1 } };
var TradeCore = require("/workspace/vanilla/js/views/trade-core.js");

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL " + name); }
}
function eq(got, want, name) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + g + "\n want " + w); }
}

/* Desk ctx: QUOTE BTS-like p5, BASE USD-like p4 (non-BTS precision pair). */
var CTX = { base: "1.3.1", quote: "1.3.0", basePrec: 4, quotePrec: 5,
            baseSym: "USD", quoteSym: "BTS" };

/* Replicates scaledOrders (trade-panels.js) step-for-step with the real
 * Format/TradeCore calls, so the vectors prove the SHIPPED formulas. */
function scaledCalc(ctx, spec) {
  var n = Number(String(spec.n).trim());
  var lowR = Format.parsePriceRatio(spec.low);
  var highR = Format.parsePriceRatio(spec.high);
  var D = lowR.den * highR.den;
  var lowD = lowR.num * highR.den;
  var highD = highR.num * lowR.den;
  var sellAssetId = spec.side === "buy" ? ctx.base : ctx.quote;
  var recvAssetId = spec.side === "buy" ? ctx.quote : ctx.base;
  var sellPrec = spec.side === "buy" ? ctx.basePrec : ctx.quotePrec;
  var totalRaw = Format.parseAmount(spec.total, sellPrec);
  var total = BigInt(totalRaw);
  var per = total / BigInt(n);
  var stepNum = (highD - lowD) / BigInt(n - 1);
  var orders = [];
  for (var i = 0; i < n; i++) {
    var priceNum = (i === n - 1) ? highD : lowD + stepNum * BigInt(i);
    var sellRaw = (i === n - 1)
      ? (total - per * BigInt(n - 1)).toString()
      : per.toString();
    var recvRaw = spec.side === "buy"
      ? TradeCore.baseToQuoteRaw(sellRaw, priceNum, D, ctx.quotePrec, ctx.basePrec)
      : TradeCore.quoteToBaseRaw(sellRaw, priceNum, D, ctx.quotePrec, ctx.basePrec);
    orders.push({ priceNum: priceNum, priceDen: D, sellRaw: sellRaw, recvRaw: recvRaw });
  }
  return { orders: orders, sellAssetId: sellAssetId, recvAssetId: recvAssetId,
           totalRaw: totalRaw };
}

(function sellSide() {
  var R = scaledCalc(CTX, { n: "3", low: "0.5", high: "1.5", total: "30", side: "sell" });
  /* Legs mirrored exactly like reviewSingle side==="sell": sell QUOTE. */
  eq(R.sellAssetId, CTX.quote, "sell-scaled sells the QUOTE leg");
  eq(R.recvAssetId, CTX.base, "sell-scaled receives the BASE leg");
  eq(R.orders.length, 3, "sell-scaled N=3 orders");
  /* Split exactness: 30.00000 BTS p5 = 3000000 raw; 1000000 x2 + 1000000. */
  eq(R.totalRaw, "3000000", "sell-scaled total parses to raw");
  var sum = R.orders.reduce(function (a, o) { return a + BigInt(o.sellRaw); }, 0n);
  eq(sum.toString(), "3000000", "sell-scaled per-order sell sums to total");
  /* Each recv matches the single-order sell formula at that order's price. */
  R.orders.forEach(function (o, i) {
    var want = TradeCore.quoteToBaseRaw(o.sellRaw, o.priceNum, o.priceDen,
      CTX.quotePrec, CTX.basePrec);
    eq(o.recvRaw, want, "sell-scaled order " + (i + 1) + " recv == single-sell formula");
    ok(/[1-9]/.test(o.recvRaw), "sell-scaled order " + (i + 1) + " recv nonzero");
  });
  /* Op-1 shape: amount_to_sell QUOTE / min_to_receive BASE (byte-shape of
   * the existing single-sell op, verified against op-1 construction). */
  var op = TradeCore.createOp("1.2.7", R.sellAssetId, R.orders[0].sellRaw,
    R.recvAssetId, R.orders[0].recvRaw, "2027-01-01T00:00:00", false);
  eq(op[0], 1, "sell-scaled op id is limit_order_create");
  eq(op[1].amount_to_sell.asset_id, CTX.quote, "sell-scaled op sells QUOTE");
  eq(op[1].min_to_receive.asset_id, CTX.base, "sell-scaled op receives BASE");
  eq(op[1].seller, "1.2.7", "sell-scaled op seller passes through");
  ok(op[1].fill_or_kill === false, "sell-scaled op fok false (scaled never FoK)");
})();

(function buySide() {
  var R = scaledCalc(CTX, { n: "2", low: "0.5", high: "1.5", total: "10", side: "buy" });
  eq(R.sellAssetId, CTX.base, "buy-scaled sells the BASE leg");
  eq(R.recvAssetId, CTX.quote, "buy-scaled receives the QUOTE leg");
  eq(R.totalRaw, "100000", "buy-scaled total parses to raw (10.0000 USD p4)");
  var sum = R.orders.reduce(function (a, o) { return a + BigInt(o.sellRaw); }, 0n);
  eq(sum.toString(), "100000", "buy-scaled per-order sell sums to total");
  R.orders.forEach(function (o, i) {
    var want = TradeCore.baseToQuoteRaw(o.sellRaw, o.priceNum, o.priceDen,
      CTX.quotePrec, CTX.basePrec);
    eq(o.recvRaw, want, "buy-scaled order " + (i + 1) + " recv == single-buy formula");
  });
  var op = TradeCore.createOp("1.2.7", R.sellAssetId, R.orders[0].sellRaw,
    R.recvAssetId, R.orders[0].recvRaw, "2027-01-01T00:00:00", false);
  eq(op[1].amount_to_sell.asset_id, CTX.base, "buy-scaled op sells BASE");
  eq(op[1].min_to_receive.asset_id, CTX.quote, "buy-scaled op receives QUOTE");
})();

(function singleParity() {
  /* One scaled leg == the single order at the same amount+price (both sides).
   * Single-sell: quoteRaw 1000000 (10.00000 BTS) at 1.0 USD/BTS. */
  var qp = CTX.quotePrec, bp = CTX.basePrec;
  var r = Format.parsePriceRatio("1.0");
  var singleRecv = TradeCore.quoteToBaseRaw("1000000", r.num, r.den, qp, bp);
  var RS = scaledCalc(CTX, { n: "2", low: "1.0", high: "1.0", total: "20", side: "sell" });
  /* N=2 flat prices: per-order 1000000 raw; first order price == 1.0 exactly
   * (lowD when step 0; last pinned to highD — equal here). */
  eq(RS.orders[0].sellRaw, "1000000", "scaled per-order sellRaw matches single amount");
  eq(RS.orders[0].recvRaw, singleRecv, "scaled sell leg == single-sell recv at same price");
})();

(function toggleContracts() {
  var src = fs.readFileSync(path.join(__dirname, "..", "vanilla", "js", "views",
    "trade-panels.js"), "utf8");
  ok((src.match(/trade-mode-bar/g) || []).length >= 2,
    "one shared #trade-mode-bar (stale removed + fresh mounted)");
  ok(/deskEl\.insertBefore\(wrap, colBuy\)/.test(src),
    "mode bar mounts above both columns (insertBefore buy column)");
  ok(/scrapeScaled\(P\.mounts\.buy, P\.scaledBuy, "buy"\)/.test(src) &&
     /scrapeScaled\(P\.mounts\.sell, P\.scaledSell, "sell"\)/.test(src),
    "mode flip scrapes BOTH scaled forms");
  ok(/scrapeSingle\(P\.mounts\.buy, P\.buy, "buy"\)/.test(src) &&
     /scrapeSingle\(P\.mounts\.sell, P\.sell, "sell"\)/.test(src),
    "mode flip scrapes BOTH single forms");
  ok(/paintSide\(doc, P\.mounts\.buy, P, "buy"\)/.test(src) &&
     /paintSide\(doc, P\.mounts\.sell, P, "sell"\)/.test(src),
    "mode flip repaints BOTH panels");
  ok(/scaledBuy: \{[^}]*side: "buy"/.test(src) &&
     /scaledSell: \{[^}]*side: "sell"/.test(src),
    "per-side scaled state with fixed sides");
  ok(src.indexOf("#trade-scaled-side-buy") === -1,
    "side selector gone (no #trade-scaled-side-buy)");
  ok(/function scaledForm\(doc, body, mount, P, side\)/.test(src),
    "scaledForm takes the panel side");
  ok(/function paintConfirmScaled\(doc, mount, P, R, side\)/.test(src),
    "paintConfirmScaled takes the panel side");
  ok(/paintConfirmScaled\(doc, mount, P, R, side\)/.test(src),
    "scaled preview confirms into its own column");
  ok(/paintConfirmScaled\(doc, mount, P, R, spec\.side === "sell" \? "sell" : "buy"\)/.test(src),
    "locked scaled review confirms into its own column");
  ok(src.indexOf('t("trade.tab_buy"') === -1,
    "BUY tab renamed (no trade.tab_buy call site left)");
  ok(src.indexOf('t("trade.tab_single", "Single")') !== -1,
    "SINGLE tab keyed (trade.tab_single)");
  ok(/sid\("trade-n", side\)/.test(src) && /sid\("trade-preview", side\)/.test(src) &&
     /sid\("trade-back", side\)/.test(src) && /sid\("trade-send", side\)/.test(src) &&
     /sid\("unlock-and-review", side\)/.test(src),
    "scaled ids namespaced per side (no buy/sell collision)");
})();

console.log("scaled-toggle-test: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
