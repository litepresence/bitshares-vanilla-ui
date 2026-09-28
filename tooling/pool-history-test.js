#!/usr/bin/env node
/* Pool-history vectors: synth-book CPMM math, candle bucketing, price
 * orientation, ES-doc parsing. Needs Format + Pool + PoolHistory globals
 * (same attach pattern as the indicator tests). Exit 0 green, 1 red. */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/format.js");
globalThis.Chain = { call: () => Promise.reject(new Error("no chain in vectors")) };
globalThis.Asset = { describe: () => Promise.reject(new Error("no chain")) };
globalThis.Pool = require("/workspace/vanilla/js/pool.js");
const PH = require("/workspace/vanilla/js/pool-history.js");

let pass = 0, fail = 0;
function eq(got, want, name) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}

// 1. synth book: balA=1e6 balB=2e6 p5/p5 taker 20 (0.2%).
//    slice 1/2000: dx=500, out=floor(500*2e6/1000500)=999, net=floor(999*9980/10000)=997.
const book = PH.synthBook({ balanceA_raw: "1000000", balanceB_raw: "2000000", precA: 5, precB: 5, taker_units: 20 });
// asks[0] is the 1/1000 slice (floor dust makes it best: pay 2000 B ->
// dx=floor(2e9/2002000)=999 -> net 997 -> 2000/997 = 2.00601805).
eq(book.asks[0].base, "0.02000", "synth ask pay amount (B)");
eq(book.asks[0].quote, "0.00997", "synth ask out amount (A)");
eq(book.asks[0].price, "2.00601805", "synth ask price B/A");
eq(book.bids[0].quote, "0.00500", "synth bid sell amount (A)");
eq(book.bids[0].base, "0.00997", "synth bid out amount (B)");
eq(book.bids[0].price, "1.99400000", "synth bid price B/A");
// best-first ordering: asks ascending, bids descending.
(function () {
  const ap = book.asks.map((l) => Number(l.price)), bp = book.bids.map((l) => Number(l.price));
  const asc = ap.every((v, i) => i === 0 || v >= ap[i - 1]);
  const desc = bp.every((v, i) => i === 0 || v <= bp[i - 1]);
  (asc && desc ? pass++ : (fail++, console.log("FAIL synth ordering " + JSON.stringify(ap) + " / " + JSON.stringify(bp))));
})();
// empty pool -> empty book.
eq(PH.synthBook({ balanceA_raw: "0", balanceB_raw: "5", precA: 5, precB: 5, taker_units: 0 }), { bids: [], asks: [] }, "synth empty");
// Mixed precisions pin the leg-precision mapping (equal-precision legs
// cannot catch a swap — this exact bug shipped once): balA=1e6 p5,
// balB=20000 p2, taker 0. Ask dust slice: sell=10 raw B, out=floor(1e7/20010)
// = 499 raw A -> price (10/1e2)/(499/1e5) = 20.04008016.
const mixed = PH.synthBook({ balanceA_raw: "1000000", balanceB_raw: "20000", precA: 5, precB: 2, taker_units: 0 });
(function () {
  const a0 = mixed.asks[0];
  ((Number(a0.price) > 19 && Number(a0.price) < 21) ? pass++ : (fail++, console.log("FAIL mixed ask scale " + JSON.stringify(a0))));
})();

// 2. price orientation: A=1.3.1 p5, B=1.3.2 p4.
const swAB = { paid: { amount: "100000", asset: "1.3.1" }, received: { amount: "20000", asset: "1.3.2" } };
eq(PH.priceHuman(swAB, 5, 4, "1.3.1", "1.3.2"), "2.00000000", "price A->B");
const swBA = { paid: { amount: "20000", asset: "1.3.2" }, received: { amount: "100000", asset: "1.3.1" } };
eq(PH.priceHuman(swBA, 5, 4, "1.3.1", "1.3.2"), "2.00000000", "price B->A");
eq(PH.priceHuman({ paid: { amount: "1", asset: "1.3.9" }, received: { amount: "1", asset: "1.3.8" } }, 5, 4, "1.3.1", "1.3.2"), null, "price unknown legs");

// 3. candles: 3 swaps in one 300s bucket, mixed directions.
const t0 = "2026-09-28T20:00:10Z", t1 = "2026-09-28T20:01:10Z", t2 = "2026-09-28T20:02:10Z";
const swaps = [
  { time: t2, paid: { amount: "100000", asset: "1.3.1" }, received: { amount: "22000", asset: "1.3.2" }, price: "2.20000000" },
  { time: t1, paid: { amount: "20000", asset: "1.3.2" }, received: { amount: "100000", asset: "1.3.1" }, price: "2.00000000" },
  { time: t0, paid: { amount: "100000", asset: "1.3.1" }, received: { amount: "18000", asset: "1.3.2" }, price: "1.80000000" },
];
const candles = PH.swapsToCandles(swaps, 86400, "1.3.2", 4);
eq(candles.length, 1, "candle count");
eq([candles[0].open, candles[0].high, candles[0].low, candles[0].close],
  ["2.20000000", "2.20000000", "1.80000000", "1.80000000"], "candle OHLC (newest-first input)");
// volume: B-leg flow = 22000 + 20000(paid B) + 18000 = 60000 raw p4 -> 6.0000.
eq(candles[0].baseVolume, "6.0000", "candle B-volume");
eq(PH.swapsToCandles([], 300, "1.3.2", 4), [], "candles empty");

// 4. ES-doc parse (live shape, pool 1.19.133 doc of 2026-09-28).
const hit = { _source: {
  operation_type: 63,
  block_data: { block_num: 114766643, block_time: "2026-09-28T20:12:24" },
  operation_history: {
    op_object: { account: "1.2.1622533", pool: "1.19.133" },
    operation_result_object: { which: 4, data_object: {
      paid: [{ amount: 12018, asset_id: "1.3.5537" }],
      received: [{ amount: 128265851, asset_id: "1.3.0" }] } }
  } } };
eq(PH._test.esSwap(hit, "1.19.133"), {
  time: "2026-09-28T20:12:24", block: 114766643, account: "1.2.1622533",
  paid: { amount: "12018", asset: "1.3.5537" },
  received: { amount: "128265851", asset: "1.3.0" }
}, "esSwap live shape");
eq(PH._test.esSwap(hit, "1.19.999"), null, "esSwap wrong pool");
// leg filter: cross-chain id collisions (1.3.0 = BTS mainnet = TEST testnet)
// must not pollute the tape.
(function () {
  const rows = [
    { paid: { amount: "1", asset: "1.3.0" }, received: { amount: "2", asset: "1.3.5" } },
  ];
  eq(PH._test.filterLegs(rows, "1.3.0", "1.3.5"), rows, "legs keep own-pool swaps");
  eq(PH._test.filterLegs(rows, "1.3.0", "1.3.9"), [], "legs drop foreign swaps");
})();
eq(PH._test.esSwap({ _source: { operation_type: 63, block_data: {},
  operation_history: { operation_result_object: { data_object: {
    paid: [{ amount: 1, asset_id: "1.3.0" }], received: [{ amount: 2, asset_id: "1.3.1" }] } } } } }, "1.19.133"),
  null, "esSwap missing pool id rejects (mainnet-only index guard)");

console.log("Pool-history vectors: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
