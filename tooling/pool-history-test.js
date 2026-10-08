#!/usr/bin/env node
/* Pool-history vectors: synth-book CPMM math, candle bucketing, price
 * orientation, ES-doc parsing. Needs Format + Pool + PoolHistory globals
 * (same attach pattern as the indicator tests). Exit 0 green, 1 red. */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
globalThis.Chain = { call: () => Promise.reject(new Error("no chain in vectors")) };
globalThis.Asset = { describe: () => Promise.reject(new Error("no chain")) };
globalThis.Pool = require("/workspace/vanilla/js/api/pool.js");
/* HistoryCap seam preload (Phase 4b migration — see market-fills-test.js). */
globalThis.HistoryCap = require("/workspace/vanilla/js/api/history-cap.js");
const PH = require("/workspace/vanilla/js/api/pool-history.js");
const MI = require("/workspace/vanilla/js/views/market-ind.js");
const fs = require("fs");

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

// 4b. countSwaps: strict per-pool 24h magnitudes for the min-swaps floor.
function swapHit(pool, time) {
  return { _source: {
    operation_type: 63,
    block_data: { block_num: 1, block_time: time || "2026-10-08T10:00:00" },
    operation_history: {
      op_object: { account: "1.2.1", pool: pool },
      operation_result_object: { which: 4, data_object: {
        paid: [{ amount: 10, asset_id: "1.3.0" }],
        received: [{ amount: 20, asset_id: "1.3.1" }] } } } } };
}
eq(PH._test.countSwaps(
  [swapHit("1.19.1"), swapHit("1.19.1"), swapHit("1.19.2")],
  ["1.19.1", "1.19.2"], "2026-10-08T00:00:00"),
  { "1.19.1": 2, "1.19.2": 1 }, "countSwaps tallies per pool");
eq(PH._test.countSwaps(
  [swapHit("1.19.9"), swapHit("1.19.1", "2026-10-01T00:00:00")],
  ["1.19.1"], "2026-10-08T00:00:00"),
  {}, "countSwaps drops foreign pools and stale hits");
eq(PH._test.countSwaps([], ["1.19.1"], ""), {}, "countSwaps empty page, empty since");
eq(PH._test.countSwaps(null, null, null), {}, "countSwaps garbage in, {} out");
eq(PH.readMinSwaps(), 1, "readMinSwaps default is 1 (strict-gate parity)");
eq(PH.writeMinSwaps(0), false, "writeMinSwaps rejects zero");
eq(PH.writeMinSwaps("abc"), false, "writeMinSwaps rejects garbage");

// 5. ES capped search_after pagination (offline, fetch stubbed).
// 500/page, max 2 pages = 1000 events, 15s total budget (lazy-deep audit
// 2026-10-01: 762KB/page measured — the 4-page/2000 cap cost ~3MB per fill
// and no caller needs 2000 events for a 200-bucket window).
(async () => {
  function mkSwapHit(tag, idx) {
    return {
      _source: {
        operation_type: 63,
        block_data: { block_num: 1000 + idx, block_time: "2026-09-28T20:12:24" },
        operation_history: {
          op_object: { account: "1.2.1", pool: "1.19.133" },
          operation_result_object: { which: 4, data_object: {
            paid: [{ amount: 12018, asset_id: "1.3.5537" }],
            received: [{ amount: 128265851, asset_id: "1.3.0" }] } }
        }
      },
      sort: [tag + "-" + idx]
    };
  }
  function swapPage(n, tag) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(mkSwapHit(tag, i));
    return a;
  }
  try {
    const _f0 = globalThis.fetch;
    const pages = [swapPage(500, "p1"), swapPage(2, "p3")];
    let calls = 0;
    const bodies = [];
    globalThis.fetch = function (url, opts) {
      calls++;
      bodies.push(opts && opts.body ? String(opts.body) : "");
      const hits = pages[Math.min(calls - 1, pages.length - 1)] || [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits } }) });
    };
    const pres = await PH.esSwaps("1.19.133", 2000);
    eq(pres.swaps.length, 502, "es pagination 2-page merge");
    eq(calls, 2, "es pagination short-page stop (2nd <500)");
    const b2 = JSON.parse(bodies[1]);
    eq(!!b2.search_after, true, "es pagination uses search_after");
    eq(JSON.stringify(b2.search_after), JSON.stringify(["p1-499"]), "es pagination search_after = last sort");
    if (_f0 !== undefined) globalThis.fetch = _f0; else delete globalThis.fetch;
  } catch (e) { fail++; console.log("FAIL es pagination 2-page\n " + (e && e.stack || e)); if (typeof _f0 !== "undefined" && _f0 !== undefined) { globalThis.fetch = _f0; } else { delete globalThis.fetch; } }
  try {
    const _f1 = globalThis.fetch;
    let c1 = 0;
    globalThis.fetch = function () {
      c1++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: swapPage(2, "s1") } }) });
    };
    const r1 = await PH.esSwaps("1.19.133", 2000);
    eq(r1.swaps.length, 2, "es short page returns 2");
    eq(c1, 1, "es short-page stops after 1 fetch");
    if (_f1 !== undefined) globalThis.fetch = _f1; else delete globalThis.fetch;
  } catch (e) { fail++; console.log("FAIL es short-page stop\n " + (e && e.stack || e)); if (typeof _f1 !== "undefined" && _f1 !== undefined) { globalThis.fetch = _f1; } else { delete globalThis.fetch; } }
  try {
    const _f2 = globalThis.fetch;
    let c2 = 0;
    globalThis.fetch = function () {
      c2++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: swapPage(500, "c" + c2) } }) });
    };
    const r2 = await PH.esSwaps("1.19.133", 5000);
    eq(c2, 2, "es cap respects max 2 pages");
    eq(r2.swaps.length <= 1000, true, "es cap respects 1000 events");
    if (_f2 !== undefined) globalThis.fetch = _f2; else delete globalThis.fetch;
  } catch (e) { fail++; console.log("FAIL es cap respect\n " + (e && e.stack || e)); if (typeof _f2 !== "undefined" && _f2 !== undefined) { globalThis.fetch = _f2; } else { delete globalThis.fetch; } }
  // 6. chainSwaps clamps to the history-api limit (chain asserts limit <= 101;
  // measured 2026-10-01: limit 200 rejects, 100 returns 100 rows in 55ms).
  // Without the clamp the pool desk's chain-first paint could never work.
  try {
    const realPool = globalThis.Pool;
    let seen = null;
    globalThis.Pool = { history: (id, lim) => { seen = lim; return Promise.resolve([]); } };
    await PH.chainSwaps("1.19.133", 200);
    eq(seen, 101, "chainSwaps clamps desk want 200 to 101");
    await PH.chainSwaps("1.19.133");
    eq(seen, 100, "chainSwaps defaults to 100");
    globalThis.Pool = realPool;
  } catch (e) { fail++; console.log("FAIL chainSwaps clamp\n " + (e && e.stack || e)); }

  // 7. Pool chart timeframes (pool-detail-ui.js POOL_BUCKETS + chartPane
  //    default + market-ind.js bucketLabel coverage). POOL_BUCKETS is a
  //    closure private in the view, so list/order/default asserts read the
  //    shipped source (explorer-blocks-ago-test.js precedent); bucketing
  //    behavior asserts run through swapsToCandles above.
  const _poolDetailSrc = fs.readFileSync("/workspace/vanilla/js/views/pool-detail-ui.js", "utf8");
  (function () {
    const m = _poolDetailSrc.match(/var POOL_BUCKETS = \[([^\]]*)\]/);
    eq(m ? JSON.parse("[" + m[1] + "]") : null,
      [60, 300, 900, 1800, 3600, 14400, 86400, 604800], "POOL_BUCKETS exact contents/order");
  })();
  (function () {
    const d = _poolDetailSrc.match(/bucket: (\d+), liveBuckets: POOL_BUCKETS\.slice\(\)/);
    eq(d ? Number(d[1]) : null, 300, "pool chart default bucket stays 300");
  })();
  // bucketLabel already maps every pool size (market-ind.js) — zero new strings.
  eq([60, 300, 900, 1800, 3600, 14400, 86400, 604800].map((b) => MI.bucketLabel(b)),
    ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"], "bucketLabel covers all pool sizes");
  // 1D-bucket smoke: synthetic swaps across 2 days bucket into 2 slots.
  (function () {
    const twoDays = [
      { time: "2026-09-29T10:00:00Z", price: "2.00000000",
        paid: { amount: "30000", asset: "1.3.2" }, received: { amount: "150000", asset: "1.3.1" } },
      { time: "2026-09-28T15:00:00Z", price: "1.50000000",
        paid: { amount: "100000", asset: "1.3.1" }, received: { amount: "15000", asset: "1.3.2" } },
      { time: "2026-09-28T09:00:00Z", price: "1.00000000",
        paid: { amount: "10000", asset: "1.3.2" }, received: { amount: "50000", asset: "1.3.1" } },
    ];
    const c = PH.swapsToCandles(twoDays, 86400, "1.3.2", 4);
    eq(c.length, 2, "1D smoke: 2 days -> 2 slots");
    eq([c[0].timeMs, c[1].timeMs], [1790553600000, 1790640000000], "1D smoke: day-boundary slots");
    eq([c[0].open, c[0].high, c[0].low, c[0].close],
      ["1.50000000", "1.50000000", "1.00000000", "1.00000000"], "1D smoke: day-1 OHLC (newest-first input)");
    eq([c[1].open, c[1].high, c[1].low, c[1].close],
      ["2.00000000", "2.00000000", "2.00000000", "2.00000000"], "1D smoke: day-2 OHLC");
    eq([c[0].baseVolume, c[1].baseVolume], ["2.5000", "3.0000"], "1D smoke: B-leg volume per slot");
  })();

  // 8. Sub-satoshi tapes keep their variation (pool 1.19.58: ~2e-8 legs;
  // fixed-8 enrich printed one flat "0.00000002" candle for a 5% move).
  // enrich is upgrade-only: normal tapes keep pinned 8-place strings.
  (function () {
    const A = "1.3.0", B = "1.3.1";
    const tiny = [
      { time: "2026-10-06T12:49:39Z", paid: { amount: "100000000", asset: A }, received: { amount: "1610", asset: B } },
      { time: "2026-10-06T12:48:09Z", paid: { amount: "100000000", asset: A }, received: { amount: "1690", asset: B } },
    ];
    PH.enrich(tiny, A, 5, B, 8);
    eq(tiny.map((s) => s.price), ["0.00000001610", "0.00000001690"], "tiny enrich keeps 5% move distinct");
    const c = PH.swapsToCandles(tiny, 300, B, 8);
    eq(c.length, 1, "tiny: one bucket");
    eq(c[0].high !== c[0].low, true, "tiny: candle shows high/low variation (was flat)");
    // explicit places still honored (single pass, back-compat).
    const one = [{ paid: { amount: "100000000", asset: A }, received: { amount: "1610", asset: B } }];
    PH.enrich(one, A, 5, B, 8, 8);
    eq(one[0].price, "0.00000002", "tiny enrich explicit 8 stays 8");
    // normal tapes untouched by the probe.
    const norm = [
      { time: "2026-10-06T12:49:39Z", paid: { amount: "100000", asset: "1.3.1" }, received: { amount: "20000", asset: "1.3.2" } },
      { time: "2026-10-06T12:48:09Z", paid: { amount: "100000", asset: "1.3.1" }, received: { amount: "22000", asset: "1.3.2" } },
    ];
    PH.enrich(norm, "1.3.1", 5, "1.3.2", 4);
    eq(norm.map((s) => s.price), ["2.00000000", "2.20000000"], "normal enrich stays 8-place");
    // tiny synth book keeps distinct levels (was: every level one price).
    const tb = PH.synthBook({ balanceA_raw: "1291515628227", balanceB_raw: "20874513", precA: 5, precB: 8, taker_units: 50 });
    eq(new Set(tb.asks.map((l) => l.price)).size, tb.asks.length, "tiny book asks distinct");
    eq(new Set(tb.bids.map((l) => l.price)).size, tb.bids.length, "tiny book bids distinct");
  })();

  // 9. poolsActive24h probe (desk-map connects gating): one ES call over
  // many pools; strict per-hit pool match; stale hits excluded; full page ->
  // partial (inconclusive, caller falls back); ES down -> rejects (caller
  // falls back); empty set resolves without firing.
  try {
    const _f3 = globalThis.fetch;
    const nowIso = new Date().toISOString().slice(0, 19);
    function actHit(pool, time) {
      return {
        _source: {
          operation_type: 63,
          block_data: { block_num: 2000, block_time: time },
          operation_history: {
            op_object: { account: "1.2.7", pool: pool },
            operation_result_object: { which: 4, data_object: {
              paid: [{ amount: 5, asset_id: "1.3.0" }],
              received: [{ amount: 9, asset_id: "1.3.1" }] } }
          }
        },
        sort: [pool + "-" + time]
      };
    }
    let seenBody = null, calls3 = 0;
    globalThis.fetch = function (url, opts) {
      calls3++;
      try { seenBody = JSON.parse(opts && opts.body ? String(opts.body) : "{}"); } catch (e) { seenBody = null; }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: [
        actHit("1.19.7", nowIso),
        actHit("1.19.9", "2020-01-01T00:00:00"),
        actHit("1.19.999", nowIso)
      ] } }) });
    };
    const rAct = await PH.poolsActive24h(["1.19.7", "1.19.9", "bad-id"]);
    eq(rAct.active["1.19.7"], true, "active pool confirmed by recent hit");
    eq(rAct.active["1.19.9"], undefined, "stale hit does not confirm activity");
    eq(rAct.active["1.19.999"], undefined, "unlisted pool never leaks into the set");
    eq(rAct.partial, false, "short page is conclusive");
    const filters = (seenBody && seenBody.query && seenBody.query.bool && seenBody.query.bool.filter) || [];
    eq(filters.some((f) => f && f.range && f.range["block_data.block_time"] && typeof f.range["block_data.block_time"].gte === "string"), true, "probe carries a 24h range");
    eq(filters.some((f) => f && f.multi_match && String(f.multi_match.query || "").indexOf("1.19.7") !== -1), true, "probe carries the pool set");
    // full page -> partial (window may hold more; caller falls back).
    const big = [];
    for (let i = 0; i < 500; i++) big.push(actHit("1.19.7", nowIso));
    globalThis.fetch = function () {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: big } }) });
    };
    const rPart = await PH.poolsActive24h(["1.19.7"]);
    eq(rPart.partial, true, "full page reports partial");
    // ES down -> rejects (caller keeps chain pools + fallback note).
    globalThis.fetch = function () { return Promise.reject(new Error("down")); };
    let rejected = false;
    try { await PH.poolsActive24h(["1.19.7"]); } catch (e) { rejected = true; }
    eq(rejected, true, "ES failure rejects to the fallback path");
    // empty set resolves without firing.
    calls3 = 0;
    globalThis.fetch = function () { calls3++; return Promise.reject(new Error("must not fire")); };
    const rEmpty = await PH.poolsActive24h([]);
    eq(rEmpty.partial, false, "empty set conclusive");
    eq(Object.keys(rEmpty.active).length, 0, "empty set confirms nothing");
    eq(calls3, 0, "empty set fires no call");
    if (_f3 !== undefined) globalThis.fetch = _f3; else delete globalThis.fetch;
  } catch (e) { fail++; console.log("FAIL poolsActive24h probe\n " + (e && e.stack || e)); }

  console.log("Pool-history vectors: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})();
