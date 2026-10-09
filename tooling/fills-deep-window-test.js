#!/usr/bin/env node
/* Deep-window ES backfill vectors — FILLS side (2026-10-08 audit).
 *
 * The pool suite (pool-deep-window-test.js) pins the same contract against
 * PoolHistory; this pins it against MarketFills, which had the identical
 * defect: a flat 1000-newest-fill cap bounded EVENTS, not TIME, so the
 * exchange desk could never widen its window (BTS/CNY measured 1h 1623 of
 * 2000, 1D 1502, 1W 575 — the ES side could never pass its 1000 fills).
 *
 * Fix: range the query to the span the candles need (bucket * count) and
 * page with search_after until that span is COVERED. ES hard-caps `size` at
 * 10000 (measured 2026-10-08: size 20000 -> HTTP 200, zero hits, silently),
 * so depth is bought with paging.
 *
 * Stub pages are FULL 10000-hit pages (the real index's shape: a short page
 * means the range is exhausted). Offline: fetch is stubbed.
 */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
globalThis.Chain = { call: () => Promise.reject(new Error("no chain in vectors")), history: () => Promise.reject(new Error("no chain in vectors")) };
globalThis.HistoryCap = require("/workspace/vanilla/js/api/history-cap.js");
const MF = require("/workspace/vanilla/js/api/market-fills-history.js");

let pass = 0, fail = 0;
function eq(got, want, name) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}
const DAY = 86400000;   // ms, for assertion math
const DAY_SEC = 86400;  // seconds — the unit coverSec takes (bucket * count)
const PAGE = MF.ES_DEEP_SIZE;
const BASE = "1.3.0", QUOTE = "1.3.113";

/* One ES op-4 hit (taker side, both legs). sortVal is epoch MILLIS on the
 * live index — coverage must read the fill's own .time, never sort[0]. */
function mkHit(ts, sortVal) {
  return {
    _source: {
      operation_type: 4,
      block_data: { block_num: 1000, block_time: ts },
      operation_history: {
        op_object: { account_id: "1.2.1", is_maker: false, pays: { amount: 100, asset_id: BASE }, receives: { amount: 200, asset_id: QUOTE } }
      }
    },
    sort: [sortVal]
  };
}
function makeSource(opts) {
  const step = opts.stepMs, count = opts.count === undefined ? PAGE : opts.count;
  const newest = Date.now();
  let served = 0;
  return function () {
    const hits = [];
    for (let i = 0; i < count; i++) {
      const ms = newest - (served + i) * step;
      hits.push(mkHit(new Date(ms).toISOString(), ms));
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
    const done = function () { return { ok: true, json: function () { return Promise.resolve({ hits: { hits: hits } }); } }; };
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

(async function run() {
  // 1. Deep query carries the RANGE + the 10000 page size.
  {
    const st = installFetch(makeSource({ stepMs: DAY, count: 10 }));
    const res = await MF.esFillsWindow(BASE, QUOTE, 200 * DAY_SEC);
    st.restore();
    const b = st.bodies[0] || {};
    eq(b.size, PAGE, "deep fills page size is ES's hard cap 10000");
    const r = rangeOf(b);
    ok(!!r, "deep fills query carries a block_data.block_time range");
    if (r) {
      const spanDays = (Date.parse(r.gte) - Date.parse(r.lte)) / DAY;
      ok(Math.abs(spanDays + 200) < 1, "deep fills range gte is ~coverSec back from lte");
    }
    eq(res.fills.length, 10, "one short page resolves 10 fills");
    eq(res.source, "es", "deep fills result is ES-sourced");
    // the leg filters must survive the deep rewrite
    const s = JSON.stringify(b.query.bool.filter);
    ok(s.indexOf('"operation_type": "4"') !== -1 || s.indexOf('"operation_type":"4"') !== -1, "deep fills query still filters op-4");
    ok(s.indexOf("is_maker") !== -1, "deep fills query still filters taker-only");
  }

  // 2. Paging past the old 2-page/1000-fill cap; coverage stops the walk.
  //    8640ms per hit = 1 day per full page; 2.5 days needs 3 pages.
  {
    const st = installFetch(makeSource({ stepMs: 8640 }));
    const res = await MF.esFillsWindow(BASE, QUOTE, 2.5 * DAY_SEC);
    st.restore();
    eq(st.calls, 3, "fills walk pages past the old 2-page cap");
    eq(res.fills.length, 3 * PAGE, "fills walk returns every fill it paged");
    ok(res.fills.length > 1000, "fills walk far exceeds the old 1000-event ceiling");
    eq(res.capped, false, "covered fills span is not capped");
    const after1 = st.bodies[1] && st.bodies[1].search_after;
    ok(after1 && after1.length === 1 && typeof after1[0] === "number",
      "fills search_after carries the epoch-millis sort value verbatim");
    const oldest = res.fills[res.fills.length - 1].time;
    ok((Date.now() - Date.parse(oldest)) / DAY >= 2.4, "oldest fill covers the requested span");
  }

  // 3. Short page = range exhausted (complete, not capped).
  {
    const st = installFetch(makeSource({ stepMs: 30 * DAY, count: 7 }));
    const res = await MF.esFillsWindow(BASE, QUOTE, 2000 * DAY_SEC);
    st.restore();
    eq(st.calls, 1, "short fills page stops the walk");
    eq(res.fills.length, 7, "exhausted fills range returns every fill it has");
    eq(res.capped, false, "exhausted fills range is complete, not capped");
  }

  // 4. Page ceiling + honest `capped`.
  {
    const st = installFetch(makeSource({ stepMs: 1 }));
    const res = await MF.esFillsWindow(BASE, QUOTE, 400 * DAY_SEC);
    st.restore();
    eq(st.calls, MF.ES_DEEP_MAX_PAGES, "uncovERable fills span stops at the page ceiling");
    eq(res.capped, true, "ceiling-stopped fills walk reports capped");
  }

  // 5. Wall-clock budget.
  {
    const st = installFetch(makeSource({ stepMs: 1000 }), { delayMs: 40 });
    const res = await MF.esFillsWindow(BASE, QUOTE, 400 * DAY_SEC, { timeoutMs: 90 });
    st.restore();
    ok(st.calls < 9, "wall-clock budget stops the fills walk");
    eq(res.capped, true, "budget-stopped fills walk reports capped");
    ok(res.fills.length > 0, "budget-stopped fills walk keeps what it fetched");
  }

  // 6. Mid-walk failure keeps the fetched pages (no rejection, no data loss).
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
    const res = await MF.esFillsWindow(BASE, QUOTE, 400 * DAY_SEC, { timeoutMs: 5000 });
    if (_f !== undefined) globalThis.fetch = _f; else delete globalThis.fetch;
    eq(res.fills.length, 2 * PAGE, "mid-walk failure keeps the fetched fills");
    eq(res.capped, true, "mid-walk failure reports capped");
  }

  // 7. Fail closed to chain: ES down on page 1 => chain, never a throw.
  {
    const _f = globalThis.fetch;
    globalThis.fetch = function () { return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }); };
    const _h = globalThis.Chain.history;
    globalThis.Chain.history = () => Promise.resolve(["history", 0]);
    globalThis.Chain.call = () => Promise.resolve([]);
    const res = await MF.fillsForMarketWindow(BASE, QUOTE, 200 * DAY_SEC, { network: "mainnet" });
    globalThis.Chain.history = _h;
    if (_f !== undefined) globalThis.fetch = _f; else delete globalThis.fetch;
    eq(res.source, "chain", "ES down falls back to chain");
    eq(res.pages, 0, "chain fallback reports no ES pages");
  }

  // 8. Testnet never queries ES (index is mainnet-only).
  {
    const st = installFetch(makeSource({ stepMs: DAY, count: 10 }));
    const _h = globalThis.Chain.history;
    globalThis.Chain.history = () => Promise.resolve(["history", 0]);
    globalThis.Chain.call = () => Promise.resolve([]);
    const res = await MF.fillsForMarketWindow(BASE, QUOTE, 200 * DAY_SEC, { network: "testnet" });
    globalThis.Chain.history = _h;
    st.restore();
    eq(st.calls, 0, "testnet issues zero ES queries");
    eq(res.source, "chain", "testnet window resolves from chain");
  }

  // 9. Shallow callers keep the cheap 1000-event cap (no regression).
  {
    const st = installFetch(makeSource({ stepMs: 1000, count: MF.ES_SIZE }));
    const res = await MF.esFills(BASE, QUOTE, 5000);
    st.restore();
    eq(st.calls, 2, "shallow esFills still caps at 2 pages");
    eq(res.fills.length, 1000, "shallow esFills still caps at 1000 events");
  }

  console.log("fills-deep-window: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log("FAIL harness " + (e && e.stack || e));
  process.exit(1);
});
