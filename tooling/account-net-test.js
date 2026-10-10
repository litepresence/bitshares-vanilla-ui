#!/usr/bin/env node
/* account-net vectors — class table, strict op extraction, direction,
 * shape-mismatch skips, self-edge drops, op-union cap, then (Task 2)
 * dedupe + per-asset aggregation + caps.
 *
 * The fixtures are the REAL doc shapes probed live on 2026-10-08 against
 * es.bitshares.dev, index bitshares-* (see the parity note). They are
 * copied verbatim, because the extractor's whole job is to survive the
 * index's actual shapes — including its op numbering, which disagrees
 * with Tx.OP for 10/11/22/23/39.
 *
 * Offline: fetch + chain stubbed inside the network vectors. Exit 0 green.
 */
"use strict";
const AccountNet = require("/workspace/vanilla/js/api/account-net.js");
globalThis.HistoryCap = require("/workspace/vanilla/js/api/history-cap.js");

let pass = 0, fail = 0;
function eq(got, want, name) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}

/* --- real probed fixtures (2026-10-08) --- */
let HIT_SEQ = 0;
function transferHit(from, to, amount, asset) {
  /* `sort` is always present on a real hit (epoch millis) — the paging loop
   * resumes from the previous page's last one. */
  const ms = 1790000000000 + (++HIT_SEQ) * 1000;
  return { sort: [ms], _source: { operation_type: 0,
    account_history: { account: from, operation_id: 4242 },
    block_data: { block_num: 12345, block_time: "2026-09-01T10:00:00" },
    operation_history: { op_object: { from: from, to: to,
      amount_: { amount: amount, asset_id: asset }, fee: { amount: 0, asset_id: "1.3.0" } } } } };
}
function creditAcceptHit(borrower, offerId, amount) {
  return { _source: { operation_type: 72,
    account_history: { account: "1.2.1700686", operation_id: 77 },
    block_data: { block_num: 65421038, block_time: "2026-08-01T00:00:00" },
    operation_history: { op_object: { borrower: borrower, offer_id: offerId,
      borrow_amount: { amount: amount, asset_id: "1.3.0" },
      collateral: { amount: 30000000, asset_id: "1.3.113" } } } } };
}
function creditRepayHit(account, dealId, amount) {
  return { _source: { operation_type: 73,
    account_history: { account: account, operation_id: 78 },
    block_data: { block_num: 65424215, block_time: "2026-08-02T00:00:00" },
    operation_history: { op_object: { account: account, deal_id: dealId,
      repay_amount: { amount: amount, asset_id: "1.3.0" },
      credit_fee: { amount: 1000000, asset_id: "1.3.0" } } } } };
}
function offerCreateHit(owner) { // lifecycle op: draws NO line
  return { _source: { operation_type: 69,
    account_history: { account: owner, operation_id: 79 },
    block_data: { block_num: 65343388, block_time: "2026-07-01T00:00:00" },
    operation_history: { op_object: { owner_account: owner, asset_type: "1.3.0",
      balance: "100000000", fee_rate: "10000" } } } };
}
const ON = AccountNet.enabled(["transfer", "credit"]);

/* ================= Task 1: class table + extraction ================= */

// 1. class table invariants
eq(AccountNet.DEFAULT_CLASSES.join(","), "transfer,credit", "transfer + credit default on");
eq(AccountNet.CLASSES.transfer.ops, [0], "transfer class is op 0");
eq(AccountNet.CLASSES.credit.ops, [69, 70, 71, 72, 73, 76], "credit class is ops 69-73 + 76");
eq(AccountNet.CLASSES.vesting.kind, "relation", "vesting is a relation, not a flow");
eq(AccountNet.CLASSES.debit.kind, "relation", "direct debit permissions are relations");
eq(AccountNet.CLASSES.htlc.ops, [49, 50, 51, 52], "htlc class is ops 49-52");
ok(AccountNet.MAX_SEEDS === 12, "seed cap is 12");
ok(AccountNet.ES_SIZE === 1000, "page size is 1000 (bounded payload)");
ok(AccountNet.ES_SIZE_CEILING === 10000, "the index's hard 10000 ceiling is recorded, never crossed");
ok(AccountNet.SCAN_CAP > AccountNet.ES_SIZE, "the hit cap spans several pages, so the walk is real");

// 2. op union: dedup + ascending; refuses a wild combination
eq(AccountNet.opUnion(["transfer", "credit"]), [0, 69, 70, 71, 72, 73, 76], "op union is deduped + sorted");
eq(AccountNet.opUnion(["transfer", "transfer"]), [0], "op union dedupes repeats");
eq(AccountNet.opUnion([]), AccountNet.opUnion(null), "an empty selection falls back to the defaults");
eq(AccountNet.opUnion(["nope", "transfer"]).join(","), "0", "unknown class ids are ignored, never throw");
eq(AccountNet.opUnion(Object.keys(AccountNet.CLASSES)).length, 17,
   "every shipped class together is 17 ops (SCAN_CAP bounds payload, not the op count)");

// 3. transfer: direction + amount, and the edge key
const t = AccountNet.classify(transferHit("1.2.1", "1.2.2", "5000000", "1.3.0"), { enabled: ON });
eq([t.edge.from, t.edge.to, t.edge.amountRaw, t.edge.assetId, t.edge.kind],
   ["1.2.1", "1.2.2", "5000000", "1.3.0", "flow"], "transfer edge from -> to with raw amount");
eq(AccountNet.edgeKey(t.edge), "1.2.1|1.2.2|transfer", "edge key is from|to|class");

// 4. credit accept is LENDER -> BORROWER (the lender arrives via the offer join)
const c72 = AccountNet.classify(creditAcceptHit("1.2.1804436", "1.21.3", "1000000000"), { enabled: ON });
eq([c72.edge.cls, c72.edge.from, c72.edge.to, c72.edge.refs],
   ["credit", null, "1.2.1804436", { offerId: "1.21.3" }],
   "credit accept: borrower known, lender pending the offer join");

// 5. credit repay is BORROWER -> LENDER (deal join), and keeps the repaid raw
const c73 = AccountNet.classify(creditRepayHit("1.2.1804436", "1.22.0", "1000000000"), { enabled: ON });
eq([c73.edge.cls, c73.edge.from, c73.edge.refs, c73.edge.amountRaw],
   ["credit", "1.2.1804436", { dealId: "1.22.0" }, "1000000000"],
   "credit repay: borrower -> pending deal join, repaid amount kept");

// 6. lifecycle ops draw no line and are NOT counted as errors
eq(AccountNet.classify(offerCreateHit("1.2.1035733"), { enabled: ON }), { skip: "no-endpoint" },
   "credit offer create draws no line");
eq(AccountNet.classify({ _source: { operation_type: 76, account_history: {}, block_data: {},
  operation_history: { op_object: { account: "1.2.1", deal_id: "1.22.7", auto_repay: "0" } } } }, { enabled: ON }),
   { skip: "no-endpoint" }, "credit deal auto-repay flag draws no line");
eq(AccountNet.classify({ _source: { operation_type: 50, account_history: {}, block_data: {},
  operation_history: { op_object: { htlc_id: "1.16.0", redeemer: "1.2.9" } } } },
  { enabled: AccountNet.enabled(["htlc"]) }),
   { skip: "no-endpoint" }, "htlc redeem (no second account) draws no line");

// 7. shape mismatch is a counted skip, never a guess
(function () {
  const bad = transferHit("1.2.1", "1.2.2", "1", "1.3.0");
  delete bad._source.operation_history.op_object.to;
  eq(AccountNet.classify(bad, { enabled: ON }), { skip: "shape" }, "missing endpoint field -> shape skip");
  const badAmt = transferHit("1.2.1", "1.2.2", "1", "1.3.0");
  badAmt._source.operation_history.op_object.amount_ = { amount: "-5", asset_id: "1.3.0" };
  const gotBadAmt = AccountNet.classify(badAmt, { enabled: ON });
  eq(gotBadAmt.edge.amountRaw, null, "a negative raw amount is dropped, not summed");
  const badAsset = transferHit("1.2.1", "1.2.2", "1", "1.3.0");
  badAsset._source.operation_history.op_object.amount_ = { amount: "5", asset_id: "9.9.9" };
  eq(AccountNet.classify(badAsset, { enabled: ON }).edge.amountRaw, null, "a malformed asset id is dropped");
})();

// 8. self-edges never draw
eq(AccountNet.classify(transferHit("1.2.1", "1.2.1", "5", "1.3.0"), { enabled: ON }), { skip: "self" },
   "self transfer draws no line");

// 9. a disabled class is skipped as "disabled", an enabled one is not
eq(AccountNet.classify(transferHit("1.2.1", "1.2.2", "5", "1.3.0"), { enabled: AccountNet.enabled([]) }),
   { skip: "disabled" }, "an explicitly empty selection skips everything");
eq(AccountNet.enabled(null).transfer, true, "null selection means the defaults");
eq(Object.keys(AccountNet.enabled([])).length, 0, "an empty array is not the defaults");
ok(AccountNet.classify(transferHit("1.2.1", "1.2.2", "5", "1.3.0"), { enabled: ON }).edge, "enabled class extracts");

// 10. garbage in never throws
[null, undefined, {}, { _source: null }, { _source: { operation_type: 0 } },
 { _source: { operation_type: 77, operation_history: { op_object: {} } } }].forEach(function (g, i) {
  let r = null;
  try { r = AccountNet.classify(g, { enabled: ON }); } catch (e) { r = { threw: e.message }; }
  ok(r && typeof r === "object" && !r.threw, "garbage hit " + i + " returns a skip, never throws");
});

/* ================= Task 2: dedupe + aggregation ================= */

function edge(cls, from, to, raw, assetId, blockNum, opId, time) {
  return { cls: cls, kind: AccountNet.CLASSES[cls].kind, from: from, to: to,
    amountRaw: raw, assetId: assetId, blockNum: blockNum, opId: opId,
    time: time || "2026-09-01T10:00:00", refs: null };
}

// 11. dedupe key: the per-party duplicate of one operation collapses
eq(AccountNet.dedupeKey(transferHit("1.2.1", "1.2.2", "5", "1.3.0")), "12345|4242",
   "dedupe key is block_num + operation_id");
eq(AccountNet.dedupeKey({ _source: { block_data: {}, account_history: {} } }), null,
   "a doc with no block/op id has no dedupe key (caller keeps it)");

// 12. aggregation: one edge per from|to|class, per-asset sums, direction kept
(function () {
  const g = AccountNet.buildGraph([
    edge("transfer", "1.2.1", "1.2.2", "5000000", "1.3.0", 10, 1),
    edge("transfer", "1.2.1", "1.2.2", "2500000", "1.3.0", 11, 2),
    edge("transfer", "1.2.1", "1.2.2", "7", "1.3.113", 12, 3),
    edge("transfer", "1.2.2", "1.2.1", "9", "1.3.0", 13, 4)
  ], [{ id: "1.2.1", name: "alice" }]);
  eq(g.edges.length, 2, "two edges: one per direction");
  const out = g.edges.filter((e) => e.a === "1.2.1")[0];
  eq(out.count, 3, "three ops share one directed edge");
  eq(out.perAsset, { "1.3.0": "7500000", "1.3.113": "7" }, "per-asset sums stay separate");
  eq(g.nodes.length, 2, "two nodes");
  eq(g.nodes.filter((n) => n.seeded).length, 1, "the seed is flagged seeded");
  eq(g.nodes.filter((n) => n.seeded)[0].sym, "alice", "seed node carries the account name");
  ok(g.edges.some((e) => e.a === "1.2.2" && e.b === "1.2.1"), "reverse direction is its own edge");
})();

// 13. class separation: transfer + credit between the same pair are two edges
(function () {
  const g = AccountNet.buildGraph([
    edge("transfer", "1.2.1", "1.2.2", "5", "1.3.0", 1, 1),
    edge("credit", "1.2.1", "1.2.2", "9", "1.3.0", 2, 2)
  ], [{ id: "1.2.1", name: "alice" }, { id: "1.2.2", name: "bob" }]);
  eq(g.edges.length, 2, "class is part of the edge key");
  eq(g.edges.map((e) => e.cls).sort().join(","), "credit,transfer", "both classes survive");
})();

// 14. caps: node cap keeps seeds + top counterparties, and says so
(function () {
  const many = [];
  for (let i = 2; i < 12; i++) many.push(edge("transfer", "1.2.1", "1.2." + i, String(100 + i), "1.3.0", i, i));
  const g = AccountNet.buildGraph(many, [{ id: "1.2.1", name: "alice" }], { nodeCap: 4 });
  eq(g.nodes.length, 5, "seed + 4 counterparties");
  ok(g.stats.caps.nodeCapHit, "node cap is reported, not silent");
})();

// 15. edge cap is reported too
(function () {
  const many = [];
  for (let i = 0; i < 9; i++) many.push(edge("transfer", "1.2.1", "1.2." + (i + 2), "5", "1.3.0", i, i));
  const g = AccountNet.buildGraph(many, [{ id: "1.2.1", name: "alice" }], { edgeCap: 4 });
  eq(g.edges.length, 4, "edge cap enforced");
  ok(g.stats.caps.edgeCapHit, "edge cap reported");
})();

// 16. malformed edges are ignored, never turned into graph nodes
(function () {
  const g = AccountNet.buildGraph([null, { cls: "transfer" }, edge("transfer", "1.2.1", "1.2.2", "5", "1.3.0", 1, 1)],
    [{ id: "1.2.1", name: "alice" }]);
  eq(g.edges.length, 1, "malformed edges are ignored");
  eq(g.nodes.length, 2, "only real endpoints become nodes");
})();

// 17. weightRaw is a magnitude, never a cross-asset total
(function () {
  const g = AccountNet.buildGraph([
    edge("transfer", "1.2.1", "1.2.2", "1000000", "1.3.0", 1, 1),
    edge("transfer", "1.2.1", "1.2.2", "999999999", "1.3.113", 2, 2)
  ], [{ id: "1.2.1", name: "alice" }]);
  const w = g.edges[0].weightRaw;
  ok(w === "999999999", "weightRaw is the largest single asset sum, not a total (" + w + ")");
})();

const AccountNetDepth = require("/workspace/vanilla/js/api/account-net-depth.js");

/* ================= Two-hop depth planner ================= */
eq(AccountNetDepth.normalizeDepth("2"), 2, "depth accepts 2");
eq(AccountNetDepth.normalizeDepth("7"), 1, "depth above 2 normalizes to 1");
eq(AccountNetDepth.normalizeDepth(0), 1, "depth below 1 normalizes to 1");
eq(AccountNetDepth.normalizeRing1("999"), 40, "ring 1 clamps to 40");
eq(AccountNetDepth.normalizeRing2("0"), 1, "ring 2 clamps up to 1");
eq(AccountNetDepth.expansionCount(2, 8), 8, "depth 2 allows 8 expansions");
eq(AccountNetDepth.expansionCount(1, 8), 0, "depth 1 expands nothing");
eq(AccountNetDepth.topCounterparties({ "1.2.2": 5, "1.2.3": 9, "1.2.4": 9 }, { "1.2.1": 1 }, 2),
  ["1.2.3", "1.2.4"], "top counterparties rank by ops, ties break by id");
eq(AccountNetDepth.planExpansions({ "1.2.2": 5, "1.2.1": 9 }, { "1.2.1": 1 }, {}, 2),
  ["1.2.2"], "seeds are never expansion targets");
eq(AccountNetDepth.planExpansions({ "1.2.2": 5 }, { "1.2.1": 1 }, { "1.2.2": 1 }, 2),
  [], "already-scanned accounts are not expanded again");

/* ================= Task 3: ES walk + credit join ================= */

function esPage(n, tag) {
  const hits = [];
  for (let i = 0; i < n; i++) hits.push(transferHit("1.2.1", "1.2." + (2 + i), String(i + 1), "1.3.0"));
  return hits;
}
function stubFetch(pages) {
  const state = { calls: 0, bodies: [] };
  const prev = globalThis.fetch;
  globalThis.fetch = function (url, opts) {
    state.calls++;
    state.bodies.push(JSON.parse(String(opts.body)));
    const hits = pages[Math.min(state.calls - 1, pages.length - 1)] || [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: hits } }) });
  };
  state.restore = function () { if (prev !== undefined) globalThis.fetch = prev; else delete globalThis.fetch; };
  return state;
}

(async function () {
  // 18. query shape: exact party term + op terms + size 10000 + newest-first
  {
    const st = stubFetch([esPage(3, "a")]);
    const res = await AccountNet.scanSeed("1.2.1", [0], {});
    st.restore();
    const b = st.bodies[0];
    eq(b.size, 1000, "ES page size is the bounded 1000");
    const s = JSON.stringify(b.query);
    ok(s.indexOf('"account_history.account":"1.2.1"') !== -1, "party filter is an exact term on account_history.account");
    ok(s.indexOf('"operation_type":[0]') !== -1, "op filter is a terms list");
    ok(JSON.stringify(b.sort).indexOf("block_data.block_time") !== -1, "sorted newest-first by block time");
    eq(res.hits.length, 3, "one short page resolves");
    eq(res.truncated, false, "short page is not truncation");
  }

  // 19. paging: past one page, search_after carries the last sort verbatim
  {
    const st = stubFetch([esPage(1000, "p1"), esPage(4, "p2")]);
    const res = await AccountNet.scanSeed("1.2.1", [0], {});
    st.restore();
    eq(st.calls, 2, "walked a second page");
    ok(!!st.bodies[1].search_after, "second page resumes with search_after");
    ok(Array.isArray(st.bodies[1].search_after), "search_after is the raw sort array (epoch millis live)");
    eq(res.hits.length, 1004, "both pages kept");
  }

  // 20. SCAN_CAP: a huge account stops at the cap and says truncated
  {
    const st = stubFetch([esPage(1000, "c1"), esPage(1000, "c2"), esPage(1000, "c3"),
      esPage(1000, "c4"), esPage(1000, "c5"), esPage(1000, "c6")]);
    const res = await AccountNet.scanSeed("1.2.1", [0], {});
    st.restore();
    eq(res.hits.length, 5000, "scan stops at SCAN_CAP");
    eq(res.truncated, true, "capped scan reports truncated");
    eq(st.calls, 5, "the cap is enforced after the page that crosses it");
  }

  // 21. mid-walk failure keeps what it fetched (never a total loss)
  {
    const prev = globalThis.fetch; let calls = 0;
    globalThis.fetch = function () {
      calls++;
      if (calls > 1) return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: esPage(1000, "m") } }) });
    };
    const res = await AccountNet.scanSeed("1.2.1", [0], {});
    if (prev !== undefined) globalThis.fetch = prev; else delete globalThis.fetch;
    eq(res.hits.length, 1000, "mid-walk failure keeps the first page");
    eq(res.truncated, true, "mid-walk failure is a truncation, not a silent success");
  }

  // 22. a dead index rejects so the view can show the reason (no fabrication)
  {
    const prev = globalThis.fetch;
    globalThis.fetch = function () { return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }); };
    let msg = "";
    try { await AccountNet.scanSeed("1.2.1", [0], {}); } catch (e) { msg = String(e && e.message); }
    if (prev !== undefined) globalThis.fetch = prev; else delete globalThis.fetch;
    ok(/es-unavailable|unavailable/i.test(msg), "a dead index rejects with an honest error (" + msg + ")");
  }

  // 22b. a malformed seed id never reaches the network
  {
    let msg = "";
    try { await AccountNet.scanSeed("not-an-account", [0], {}); } catch (e) { msg = String(e && e.message); }
    ok(/bad-account-id/.test(msg), "a malformed seed id rejects locally (" + msg + ")");
  }

  // 23. credit join: offers + deals in chunked get_objects; missing ids listed
  {
    /* Offline guard: creditOwners falls back to the INDEX for references the
     * chain cannot answer, so these vectors must not reach the network. */
    const prevFetch = globalThis.fetch;
    globalThis.fetch = function () {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: [] } }) });
    };
    const prevChain = globalThis.Chain;
    const seen = [];
    globalThis.Chain = {
      db: () => Promise.resolve(0),
      call: (_api, method, params) => {
        seen.push([method, JSON.stringify(params[0])]);
        if (method === "get_objects") {
          /* The chain returns NOTHING for an unknown/deleted id — that is
           * exactly the case the missing list exists for. */
          /* owner_account, NOT owner — the real credit_offer_object field
           * (verified live 2026-10-09 against 1.21.79). */
          const known = {
            "1.21.3": { id: "1.21.3", owner_account: "1.2.777", asset_type: "1.3.0" },
            "1.21.9": { id: "1.21.9", owner_account: "1.2.777", asset_type: "1.3.0" },
            "1.22.0": { id: "1.22.0", offer_id: "1.21.9", borrower: "1.2.888" }
          };
          return Promise.resolve(params[0].map((id) => known[id]).filter(Boolean));
        }
        return Promise.resolve([]);
      }
    };
    const res = await AccountNet.creditOwners({ offerId: ["1.21.3"], dealId: ["1.22.0", "1.22.999"] });
    globalThis.Chain = prevChain;
    if (prevFetch !== undefined) globalThis.fetch = prevFetch; else delete globalThis.fetch;
    eq(res.offer["1.21.3"], "1.2.777", "offer owner resolved from the chain's owner_account field");
    eq(res.deal["1.22.0"], "1.2.777", "deal owner resolved through its offer");
    eq(res.missing.join(","), "1.22.999", "an unresolvable reference is listed, never guessed");
    ok(seen[0][0] === "get_objects", "the join goes through get_objects");
    ok(/1\.21\.3/.test(seen[0][1]) && /1\.22\.0/.test(seen[0][1]), "offer + deal ids batch into one call");
  }

  // 23a2. A legacy `owner` field still resolves (shape drift tolerance).
  {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = function () {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: [] } }) });
    };
    const prevChain = globalThis.Chain;
    globalThis.Chain = { db: () => Promise.resolve(0), call: (_a, m, p) => Promise.resolve(
      m === "get_objects" ? [{ id: p[0][0], owner: "1.2.654" }] : []) };
    const res = await AccountNet.creditOwners({ offerId: ["1.21.77"] });
    globalThis.Chain = prevChain;
    if (prevFetch !== undefined) globalThis.fetch = prevFetch; else delete globalThis.fetch;
    eq(res.offer["1.21.77"], "1.2.654", "an owner field (index drift) resolves too");
  }

  // 23b. a chain failure during the join degrades to "missing", never a guess
  {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = function () {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: [] } }) });
    };
    const prevChain = globalThis.Chain;
    globalThis.Chain = { db: () => Promise.reject(new Error("nc")), call: () => Promise.reject(new Error("nc")) };
    const res = await AccountNet.creditOwners({ offerId: ["1.21.3"] });
    globalThis.Chain = prevChain;
    if (prevFetch !== undefined) globalThis.fetch = prevFetch; else delete globalThis.fetch;
    eq(Object.keys(res.offer).length, 0, "a failed join resolves no owners");
    eq(res.missing.join(","), "1.21.3", "a failed join reports the reference as missing");
  }

  // 23c. The INDEX fallback: a DELETED deal/offer (get_objects -> [null]) is
  // still resolvable, because the create operation carries the id it minted.
  // Real shapes: op 72 result_object.data_object.new_objects = ["1.22.0"],
  // op 69 result_object.data_string = "1.21.0" (+ op_object.owner_account).
  {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = function (url, opts) {
      const body = JSON.parse(String(opts.body));
      const flt = JSON.stringify(body.query);
      let hits = [];
      if (flt.indexOf('new_objects.keyword":["1.22.0"]') !== -1) {
        hits = [{ sort: [1], _source: { operation_type: 72, operation_history: {
          op_object: { borrower: "1.2.1804436", offer_id: "1.21.3" },
          operation_result_object: { which: 5, data_object: {
            impacted_accounts: ["1.2.1700686"], new_objects: ["1.22.0"] } } } } }];
      } else if (flt.indexOf('data_string.keyword":["1.21.3"]') !== -1) {
        hits = [{ sort: [2], _source: { operation_type: 69, operation_history: {
          op_object: { owner_account: "1.2.1700686", asset_type: "1.3.0" },
          operation_result_object: { which: 1, data_string: "1.21.3" } } } }];
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: hits } }) });
    };
    /* Chain knows NOTHING (objects deleted). */
    const prevChain = globalThis.Chain;
    globalThis.Chain = { db: () => Promise.resolve(0), call: () => Promise.resolve([null]) };
    const res = await AccountNet.creditOwners({ offerId: ["1.21.3"], dealId: ["1.22.0"] });
    globalThis.Chain = prevChain;
    if (prevFetch !== undefined) globalThis.fetch = prevFetch; else delete globalThis.fetch;
    eq(res.offer["1.21.3"], "1.2.1700686", "a deleted offer resolves from its create operation");
    eq(res.deal["1.22.0"], "1.2.1700686", "a deleted deal resolves from the accept operation");
    eq(res.missing.length, 0, "nothing is reported missing when the index answers");
    ok(res.viaIndex.offers + res.viaIndex.deals >= 1, "the index-sourced resolutions are counted for disclosure");
  }

  // 24. gather: unknown seeds are reported, known ones still draw
  {
    const prevAcc = globalThis.Account;
    globalThis.Account = { resolve: (n) => (String(n) === "nope"
      ? Promise.reject(new Error("unknown-account"))
      : Promise.resolve({ id: "1.2." + String(n).length, name: String(n) })) };
    const st = stubFetch([esPage(2, "g")]);
    const out = await AccountNet.gather(["alice", "nope"], ["transfer"], {});
    st.restore();
    globalThis.Account = prevAcc;
    eq(out.unknown.join(","), "nope", "an unknown seed is listed by its raw name");
    eq(out.seeds.length, 1, "the resolvable seed is kept");
  }

  console.log("account-net: " + pass + " pass, " + fail + " fail");
  /* exitCode, not exit(): process.exit() can drop a piped stdout write. */
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log("FAIL harness " + (e && e.stack || e)); process.exit(1); });
