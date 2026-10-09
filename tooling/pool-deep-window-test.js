#!/usr/bin/env node
/* Deep-window ES backfill vectors (2026-10-08 audit).
 *
 * THE BUG THIS PINS: the pool chart's ES deepen asked for a flat 1000
 * newest events with NO time range (ES_MAX_EVENTS/ES_MAX_PAGES), so on a
 * sparse pool the 1000 newest swaps spanned only ~142 days (pool 1.19.2:
 * 2026-05-19..2026-10-08 measured) — every timeframe showed "June and
 * its daily candles" because the WINDOW, not the bucket, was capped. The
 * index holds 69,722 swaps for that pool back to 2021-04-18.
 *
 * The fix (historical-charts reference pattern, pools.js:2-49 +
 * main.js:214-261): compute the span the request actually needs
 * (bucket * count), push it into the query as a block_data.block_time
 * RANGE, and page with search_after until the SPAN IS COVERED (not until
 * an event count runs out). ES hard-caps `size` at 10000 — measured
 * 2026-10-08: size 20000 returns 200 with ZERO hits, silently — so the
 * page size is 10000 and depth comes from paging.
 *
 * Stub pages are FULL 10000-hit pages (the real index's shape: a short
 * page means the range is exhausted), with the final page short.
 *
 * Needs Format + Pool + PoolHistory globals (same attach pattern as
 * pool-history-test.js). Offline: fetch is stubbed. Exit 0 green, 1 red.
 */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
globalThis.Chain = { call: () => Promise.reject(new Error("no chain in vectors")) };
globalThis.Asset = { describe: () => Promise.reject(new Error("no chain")) };
globalThis.Pool = require("/workspace/vanilla/js/api/pool.js");
globalThis.HistoryCap = require("/workspace/vanilla/js/api/history-cap.js");
const PH = require("/workspace/vanilla/js/api/pool-history.js");

let pass = 0, fail = 0;
function eq(got, want, name) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}
const DAY = 86400000;        // ms — used for time math in assertions
const DAY_SEC = 86400;      // SECONDS — the unit coverSec takes (bucket * count)
const PAGE = PH.ES_DEEP_SIZE; // 10000 — the stub must mimic the real page size

/* One ES op-63 hit. ts = block time (ISO); sortVal = the ES sort value
 * (epoch MILLIS on the live index — the shape trap: Date.parse(1791..)
 * is NaN, so coverage must read the swap's own .time, never sort[0]). */
function mkHit(ts, sortVal, pool) {
  return {
    _source: {
      operation_type: 63,
      block_data: { block_num: 1000, block_time: ts },
      operation_history: {
        op_object: { account: "1.2.1", pool: pool || "1.19.133" },
        operation_result_object: { which: 4, data_object: {
          paid: [{ amount: 100, asset_id: "1.3.0" }],
          received: [{ amount: 200, asset_id: "1.3.113" }] } }
      }
    },
    sort: [sortVal]
  };
}

/* Lazy page source: page k holds `count` hits spaced `stepMs` apart,
 * descending in time from `newest`. Pages are generated on demand so a
 * 3-page walk does not build 30k objects up front. */
function makeSource(opts) {
  const step = opts.stepMs, count = opts.count === undefined ? PAGE : opts.count;
  const pool = opts.pool;
  const newest = Date.now();
  let served = 0;
  return function (k) {
    const hits = [];
    for (let i = 0; i < count; i++) {
      const ms = newest - (served + i) * step;
      hits.push(mkHit(new Date(ms).toISOString(), ms, pool));
    }
    served += count;
    return hits;
  };
}
function installFetch(src, opts) {
  opts = opts || {};
  const state = { calls: 0, bodies: [] };
  const _f = globalThis.fetch;
  globalThis.fetch = function (url, o) {
    state.calls++;
    state.bodies.push(o && o.body ? JSON.parse(String(o.body)) : {});
    const hits = src(state.calls - 1);
    const done = function () {
      return { ok: true, json: function () { return Promise.resolve({ hits: { hits: hits } }); } };
    };
    if (opts.delayMs) return new Promise(function (res) { setTimeout(function () { res(done()); }, opts.delayMs); });
    return Promise.resolve(done());
  };
  state.restore = function () { if (_f !== undefined) globalThis.fetch = _f; else delete globalThis.fetch; };
  return state;
}
function rangeOf(body) {
  const f = (body.query || {}).bool && body.query.bool.filter || [];
  for (const c of f) { const r = c.range && c.range["block_data.block_time"]; if (r) return r; }
  return null;
}
/* Chain stub: get_liquidity_pool_history rows the parser accepts. */
function stubChain(rows) {
  const real = globalThis.Pool;
  globalThis.Pool = { history: () => Promise.resolve(rows || []) };
  return function () { globalThis.Pool = real; };
}
function chainRow(pool, ts, block) {
  return {
    block_time: ts,
    raw: { time: ts, pool: pool, op: [{ block_num: block, op: [63, { pool: pool, account: "1.2.1" }], result: [0, { paid: [{ amount: 100, asset_id: "1.3.0" }], received: [{ amount: 200, asset_id: "1.3.113" }] }] }] }
  };
}
void chainRow; // fixture shape is owned by the chainSwaps vectors, not this suite

(async function run() {
  // 1. The deep query carries the RANGE and the 10000 page size — the two
  //    things the flat 1000-event query lacked.
  {
    const st = installFetch(makeSource({ stepMs: DAY, count: 10 }));
    const res = await PH.esSwapsWindow("1.19.133", 200 * DAY_SEC);
    st.restore();
    const b = st.bodies[0] || {};
    eq(b.size, PAGE, "deep page size is ES's hard cap 10000");
    const r = rangeOf(b);
    ok(!!r, "deep query carries a block_data.block_time range");
    if (r) {
      const gte = Date.parse(r.gte), lte = Date.parse(r.lte);
      const spanDays = (gte - lte) / DAY;
      ok(Math.abs(spanDays + 200) < 1, "deep range gte is ~coverSec back from lte (got " + spanDays.toFixed(1) + ")");
      ok(lte >= Date.now() - 5000, "deep range lte is now");
      ok((b._source || []).indexOf("account_history") === -1, "deep _source drops account_history (half the payload)");
      ok((b._source || []).indexOf("operation_history.op_object") !== -1, "deep _source keeps op_object (pool check)");
      ok((b._source || []).indexOf("operation_history.operation_result_object") !== -1, "deep _source keeps the result object (paid/received)");
    }
    eq(res.swaps.length, 10, "one short page resolves 10 swaps");
    eq(res.source, "es", "deep result is ES-sourced");
  }

  // 2. Depth comes from PAGING, past the old 2-page/1000-event cap.
  //    Step 8640ms = 1 day per full 10000-hit page. 2.5 days of coverage
  //    needs 3 pages (the old adapter could never fetch a 3rd).
  {
    const st = installFetch(makeSource({ stepMs: 8640 }));
    const res = await PH.esSwapsWindow("1.19.133", 2.5 * DAY_SEC);
    st.restore();
    eq(st.calls, 3, "walk pages past the old 2-page cap");
    eq(res.swaps.length, 3 * PAGE, "walk returns every swap it paged");
    ok(res.swaps.length > 1000, "walk far exceeds the old 1000-event ceiling");
    eq(res.capped, false, "coverage reached within budget is not capped");
    const after1 = st.bodies[1] && st.bodies[1].search_after;
    ok(!!after1, "page 2 resumes with search_after");
    ok(after1 && after1.length === 1 && typeof after1[0] === "number",
      "search_after carries the epoch-millis sort value verbatim");
    ok(st.bodies[2] && st.bodies[2].search_after, "page 3 also resumes (chain holds to the end)");
    const oldest = res.swaps[res.swaps.length - 1].time;
    ok((Date.now() - Date.parse(oldest)) / DAY >= 2.4, "oldest swap covers the requested span");
  }

  // 2b. The ceiling case (the user's shape: 2000 daily candles on an active
  //     pool needs more pages than the budget allows): the walk stops at the
  //     cap and SAYS capped rather than silently presenting a short window.
  {
    const st = installFetch(makeSource({ stepMs: 8640 }));
    const res = await PH.esSwapsWindow("1.19.133", 400 * DAY_SEC);
    st.restore();
    eq(st.calls, PH.ES_DEEP_MAX_PAGES, "uncovERable span stops at the page ceiling");
    eq(res.capped, true, "ceiling-stopped walk reports capped (honest)");
    eq(res.swaps.length, PH.ES_DEEP_MAX_PAGES * PAGE, "capped walk keeps every fetched event");
    ok(st.bodies.every(function (b, i) { return i === 0 || !!b.search_after; }),
      "every page after the first resumes with search_after");
  }

  // 3. Coverage STOP: once the span is covered, no further page is fetched
  //    (the whole point — stop on SPAN, not on an event count).
  {
    const st = installFetch(makeSource({ stepMs: 8640 }));
    const res = await PH.esSwapsWindow("1.19.133", 2.5 * DAY_SEC, { maxPages: 6 });
    st.restore();
    eq(st.calls, 3, "coverage stop halts paging at the covering page (not at the cap)");
    eq(res.capped, false, "covered span is not reported capped");
    const oldest = res.swaps[res.swaps.length - 1].time;
    ok((Date.now() - Date.parse(oldest)) / DAY >= 2.4, "stop happened only after coverage");
  }

  // 4. Short page = range exhausted (no cap flag — honest completeness).
  {
    const st = installFetch(makeSource({ stepMs: 30 * DAY, count: 7 }));
    const res = await PH.esSwapsWindow("1.19.133", 2000 * DAY_SEC);
    st.restore();
    eq(st.calls, 1, "short page stops the walk");
    eq(res.swaps.length, 7, "exhausted range returns every swap it has");
    eq(res.capped, false, "exhausted range is complete, not capped");
    eq(res.source, "es", "exhausted-range result is ES-sourced");
  }

  // 5. Hard caps hold: an uncovERable span on an endless pool stops at the
  //    page ceiling and SAYS so (honest partial, doctrine #6 honesty).
  {
    const st = installFetch(makeSource({ stepMs: 1 })); // 10000ms per page: never covers 200 days
    const res = await PH.esSwapsWindow("1.19.133", 200 * DAY_SEC);
    st.restore();
    eq(st.calls, PH.ES_DEEP_MAX_PAGES, "page ceiling holds");
    eq(res.capped, true, "uncovERable span reports capped (honest)");
  }

  // 6. Wall-clock budget: a slow index stops the walk and keeps what it got.
  {
    const st = installFetch(makeSource({ stepMs: 1000 }), { delayMs: 40 });
    const res = await PH.esSwapsWindow("1.19.133", 400 * DAY_SEC, { timeoutMs: 90 });
    st.restore();
    ok(st.calls < 9, "wall-clock budget stops the walk early (calls=" + st.calls + ")");
    eq(res.capped, true, "budget-stopped walk reports capped");
    ok(res.swaps.length > 0, "budget-stopped walk keeps the pages it fetched");
  }

  // 7. A mid-walk page failure keeps what was fetched (the chart still
  //    deepens); it must not reject and lose the pages already paid for.
  {
    const src = makeSource({ stepMs: 1000 });
    const _f = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = function (url, o) {
      calls++;
      if (calls > 2) return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) });
      const hits = src(calls - 1);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: hits } }) });
    };
    const res = await PH.esSwapsWindow("1.19.133", 400 * DAY_SEC, { timeoutMs: 5000 });
    if (_f !== undefined) globalThis.fetch = _f; else delete globalThis.fetch;
    eq(res.swaps.length, 2 * PAGE, "mid-walk failure keeps the fetched pages");
    eq(res.capped, true, "mid-walk failure reports capped");
  }

  // 8. Leg filter applies to window results (pool 1.3.0 collides across
  //    chains; a wrong-leg swap must not reach the chart).
  {
    const good = mkHit(new Date().toISOString(), Date.now(), "1.19.133");
    const bad = JSON.parse(JSON.stringify(good));
    bad._source.operation_history.operation_result_object.data_object.paid[0].asset_id = "1.3.999";
    const st = installFetch(function () { return [good, bad]; });
    const res = await PH.swapsForPoolWindow("1.19.133", 10 * DAY_SEC, { network: "mainnet", legA: "1.3.113", legB: "1.3.0" });
    st.restore();
    eq(res.swaps.length, 1, "leg filter drops off-leg swaps from the window walk");
    eq(res.source, "es", "window walk is ES-sourced when ES answers");
  }

  // 9. Fail closed to chain: ES down on page 1 => the chain path, never a throw.
  //    (The row SHAPE belongs to the pre-existing chainSwaps vectors — this
  //    pins only that a dead index routes to chain instead of rejecting.)
  {
    const _f = globalThis.fetch;
    globalThis.fetch = function () { return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }); };
    const unstub = stubChain([]);
    const res = await PH.swapsForPoolWindow("1.19.133", 200 * DAY_SEC, { network: "mainnet" });
    unstub();
    if (_f !== undefined) globalThis.fetch = _f; else delete globalThis.fetch;
    eq(res.source, "chain", "ES down falls back to chain");
    eq(res.pages, 0, "chain fallback reports no ES pages");
  }

  // 10. Testnet never touches ES (the index is mainnet-only) — chain only.
  {
    const st = installFetch(makeSource({ stepMs: DAY, count: 10 }));
    const unstub = stubChain([]);
    const res = await PH.swapsForPoolWindow("1.19.133", 200 * DAY_SEC, { network: "testnet" });
    unstub();
    st.restore();
    eq(st.calls, 0, "testnet issues zero ES queries");
    eq(res.source, "chain", "testnet window resolves from chain");
  }

  // 11. Shallow callers keep the cheap 1000-event cap — the deep window is
  //     opt-in, so the feed/backing price stays fast (no regression).
  {
    const st = installFetch(makeSource({ stepMs: 1000, count: PH.ES_SIZE }));
    const res = await PH.esSwaps("1.19.133", 5000);
    st.restore();
    eq(st.calls, 2, "shallow esSwaps still caps at 2 pages");
    eq(res.swaps.length, 1000, "shallow esSwaps still caps at 1000 events");
  }

  // 12. Progressive paint: opts.onPage fires after EVERY page (so the chart
  //     deepens while a minutes-long walk runs) and once more, terminally,
  //     with done + the final capped flag. A painter that throws must not
  //     break the walk (painting is best-effort, data is not).
  {
    const seen = [];
    const st = installFetch(makeSource({ stepMs: 8640 }));
    const res = await PH.esSwapsWindow("1.19.133", 2.5 * DAY_SEC, {
      onPage: function (m) { seen.push({ n: m.swaps.length, pages: m.pages, done: m.done, capped: m.capped }); }
    });
    st.restore();
    eq(st.calls, 3, "progressive walk fetched 3 pages");
    eq(seen.length, 4, "onPage fires once per page plus a terminal hand-off");
    eq(seen.map(function (s) { return s.n; }), [PAGE, 2 * PAGE, 3 * PAGE, 3 * PAGE],
      "each page hands over everything fetched SO FAR (growing, not replacing)");
    eq(seen.map(function (s) { return s.pages; }), [1, 2, 3, 3], "page counter rides along");
    eq(seen.map(function (s) { return s.done; }), [false, false, false, true], "only the last hand-off is terminal");
    eq(res.capped, false, "progressive walk reports the same verdict as its terminal page");

    const thrown = [];
    const st2 = installFetch(makeSource({ stepMs: 8640 }));
    const res2 = await PH.esSwapsWindow("1.19.133", 2.5 * DAY_SEC, {
      onPage: function () { thrown.push(1); throw new Error("painter exploded"); }
    });
    st2.restore();
    eq(res2.swaps.length, 3 * PAGE, "a throwing painter never costs the walk its data");
  }

  // 13. Terminal hand-off carries `capped` so a budget-truncated window is
  //     disclosed to the painter on its LAST paint, not just in the result.
  {
    const seen = [];
    const st = installFetch(makeSource({ stepMs: 1 }));
    await PH.esSwapsWindow("1.19.133", 400 * DAY_SEC, {
      onPage: function (m) { if (m.done) seen.push(m.capped); }
    });
    st.restore();
    eq(seen, [true], "terminal onPage reports capped on a ceiling-stopped walk");
  }

  console.log("pool-deep-window: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log("FAIL harness " + (e && e.stack || e));
  process.exit(1);
});
