# Account Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `#/account-network` — enter one or more accounts, see the 1-hop union of their account-to-account flows as a canvas graph of accounts joined by arrowed, class-coloured lines, with an accessible table twin.

**Architecture:** A new pure data adapter `vanilla/js/api/account-net.js` scans the community index once per seed (union of the *enabled* op classes only, paged with `search_after`, capped), extracts strictly-validated account↔account edges, resolves credit offer/deal owners through the chain, and aggregates into the `{nodes, edges}` shape the shipped network canvas already consumes. A new view `vanilla/js/views/account-network-ui.js` owns the page shell (seed input, class chips, status/detail lines, table twin) and mounts `PoolNetUI.mount(doc, wrap, getSelection, {mode:"account", navNode, navEdge, graph})`, so physics, zoom/pan, drag, tap, keyboard, resize, IntersectionObserver and reduced-motion are reused rather than rebuilt. `pool-net-paint.js` gains **opt-in** arrowheads and a per-class edge colour (defaults unchanged, so the pool/market maps stay byte-identical).

**Tech Stack:** Vanilla JS + Canvas2D + rAF + WebSocket chain client (`Chain.db/call`, `Account.resolve`, `Credit.offer/deal`, `Asset.describe`), `HistoryCap.esSearch` (the only raw-ES seam), `localStorage`, no deps.

## Global Constraints

- `vanilla/` has no `package.json`, no `node_modules`, no CDN `<script src>`, no framework — `python3 tooling/check_rot.py` must pass.
- Platform APIs only; no graph library, no bundler. `python3 -m http.server` serves the app.
- Money stays a raw digit string / BigInt until `Format` renders it; `Number()` is only ever canvas pixels, counts or ranking weights. **Never sum amounts across assets.**
- Every display string goes through `I18n.t(key, englishDefault)` with the default byte-identical to `en.json` — `python3 tooling/check_i18n.py` enforces both directions.
- New raw-ES access goes through `HistoryCap.esSearch` only; the index is mainnet-only, pref-gated by `esEnabled`, and page size is pinned at `10000` (measured: `size: 20000` returns HTTP 200 with **zero** hits).
- Every op extractor validates its expected field names per hit and counts mismatches — the index's `operation_type` numbering disagrees with `Tx.OP` for 10/11/22/23/39 (measured), so op numbers are never trusted alone.
- Shared utilities are mandatory, never re-created: `DOM.*`, `Forms.*`, `TableRenderer.render`, `ConfirmDialog`, `Overlay`, `Event.delegate`, `DOM.touchable` (AGENTS.md §7 rule 9).
- `bash tooling/check_types.sh` (tsc `checkJs`, zero emit) must pass.
- Phone 360px → 4K; 44px touch targets; `prefers-reduced-motion` settles with zero frames.
- Module format: block header (owns / consumes / globals / created-by), IIFE, `globalThis` guard + `module.exports` tail, script tag with the shared cache-bust token.

---

### Task 1: Class table + strict edge extraction (pure)

**Files:**
- Create: `vanilla/js/api/account-net.js`
- Test: `tooling/account-net-test.js`

**Interfaces:**
- Consumes: nothing (pure; reads no globals at module scope).
- Produces (used by Tasks 2–5):
  - `AccountNet.CLASSES` — object keyed by class id:
    `{ id, ops:number[], kind:"flow"|"relation", labelKey, defaultOn:boolean }`
    classes: `transfer [0]`, `credit [69,70,71,72,73,76]`, `override [38]`,
    `debit [25,26,27,28]`, `htlc [49,50,51,52]`, `vesting [34]`.
    `DEFAULT_CLASSES = ["transfer","credit"]`, `MAX_SEEDS = 12`, `OP_UNION_CAP = 40`.
  - `AccountNet.opUnion(enabledIds) -> number[]` — dedup + ascending; throws
    `Error("class-union-too-big")` above `OP_UNION_CAP`.
  - `AccountNet.classify(hit, opts) -> {edge:Object}|{skip:string}` where
    `opts = {enabled:Object(classId->true), seedId:string}` and
    `edge = {cls, kind, from, to, amountRaw, assetId, time, blockNum, opId, opType, refs}`.
    `refs` is `{offerId}` (op 72) or `{dealId}` (ops 73/76) for credit.
  - `AccountNet.edgeKey(edge) -> "from|to|cls"`.

- [ ] **Step 1: Write the failing test**

Create `tooling/account-net-test.js`. The fixtures below are the **real doc shapes probed live on 2026-10-08** (`es.bitshares.dev`, index `bitshares-*`):

```js
#!/usr/bin/env node
/* account-net vectors — class table, strict op extraction, direction,
 * shape-mismatch skips, self-edge drops, op-union cap. Pure: no network.
 * Exit 0 green, 1 red. */
"use strict";
const AccountNet = require("/workspace/vanilla/js/api/account-net.js");
let pass = 0, fail = 0;
function eq(got, want, name) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}
function ok(c, name) { if (c) pass++; else { fail++; console.log("FAIL " + name); } }

/* --- real probed fixtures (2026-10-08) --- */
function transferHit(from, to, amount, asset) {
  return { _source: { operation_type: 0,
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

// 1. class table invariants
eq(AccountNet.DEFAULT_CLASSES.join(","), "transfer,credit", "transfer + credit default on");
eq(AccountNet.CLASSES.transfer.ops, [0], "transfer class is op 0");
eq(AccountNet.CLASSES.credit.ops, [69, 70, 71, 72, 73, 76], "credit class is ops 69-73 + 76");
eq(AccountNet.CLASSES.vesting.kind, "relation", "vesting is a relation, not a flow");
eq(AccountNet.CLASSES.debit.kind, "relation", "direct debit permissions are relations");

// 2. op union: dedup + ascending; refuses a wild combination
eq(AccountNet.opUnion(["transfer", "credit"]), [0, 69, 70, 71, 72, 73, 76], "op union is deduped + sorted");
eq(AccountNet.opUnion(["transfer", "transfer"]), [0], "op union dedupes repeats");
(function () {
  let threw = false;
  try { AccountNet.opUnion(Object.keys(AccountNet.CLASSES).concat(["transfer"])); } catch (e) { threw = /class-union-too-big/.test(String(e.message)); }
  ok(threw, "op union refuses an oversized class set");
})();

// 3. transfer: direction + amount, and the edge key
const t = AccountNet.classify(transferHit("1.2.1", "1.2.2", "5000000", "1.3.0"), { enabled: ON });
eq([t.edge.from, t.edge.to, t.edge.amountRaw, t.edge.assetId, t.edge.kind],
   ["1.2.1", "1.2.2", "5000000", "1.3.0", "flow"], "transfer edge from -> to with raw amount");
eq(AccountNet.edgeKey(t.edge), "1.2.1|1.2.2|transfer", "edge key is from|to|class");

// 4. credit accept is LENDER -> BORROWER (the lender arrives via the offer join)
const c72 = AccountNet.classify(creditAcceptHit("1.2.1804436", "1.21.3", "1000000000"), { enabled: ON });
eq([c72.edge.cls, c72.edge.from, c72.edge.to, c72.edge.refs],
   ["credit", null, "1.2.1804436", { offerId: "1.21.3" }],
   "credit accept: borrower is known, lender is the pending offer join");
// 5. credit repay is BORROWER -> LENDER (deal join), and carries the repaid raw
const c73 = AccountNet.classify(creditRepayHit("1.2.1804436", "1.22.0", "1000000000"), { enabled: ON });
eq([c73.edge.cls, c73.edge.from, c73.edge.refs, c73.edge.amountRaw],
   ["credit", "1.2.1804436", { dealId: "1.22.0" }, "1000000000"],
   "credit repay: borrower -> pending deal join, repaid amount kept");

// 6. lifecycle ops draw no line and are NOT counted as errors
eq(AccountNet.classify(offerCreateHit("1.2.1035733"), { enabled: ON }), { skip: "no-endpoint" },
   "credit offer create draws no line");

// 7. shape mismatch is a counted skip, never a guess
(function () {
  const bad = transferHit("1.2.1", "1.2.2", "1", "1.3.0");
  delete bad._source.operation_history.op_object.to;
  eq(AccountNet.classify(bad, { enabled: ON }), { skip: "shape" }, "missing endpoint field -> shape skip");
})();

// 8. self-edges never draw
eq(AccountNet.classify(transferHit("1.2.1", "1.2.1", "5", "1.3.0"), { enabled: ON }), { skip: "self" },
   "self transfer draws no line");

// 9. a disabled class is skipped as "disabled", an enabled one is not
eq(AccountNet.classify(transferHit("1.2.1", "1.2.2", "5", "1.3.0"), { enabled: AccountNet.enabled([]) }),
   { skip: "disabled" }, "disabled class is skipped");
ok(AccountNet.classify(transferHit("1.2.1", "1.2.2", "5", "1.3.0"), { enabled: ON }).edge, "enabled class extracts");

// 10. garbage in never throws
[null, undefined, {}, { _source: null }, { _source: { operation_type: 0 } }].forEach(function (g, i) {
  let r = null;
  try { r = AccountNet.classify(g, { enabled: ON }); } catch (e) { r = "THREW " + e.message; }
  ok(r && typeof r === "object" && !r.threw, "garbage hit " + i + " returns a skip, never throws");
});

console.log("account-net: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/account-net-test.js`
Expected: FAIL — `Cannot find module '/workspace/vanilla/js/api/account-net.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `vanilla/js/api/account-net.js`:

```js
/* AccountNet: account-to-account edge graph data (pure adapter, no DOM).
 * Owns: the op-class table (which indexed operations describe a flow or a
 *   relation between two accounts), the per-hit edge extractor, and the op
 *   union the ES query filters on. The aggregation (buildGraph), the ES walk
 *   (scanSeed) and the chain credit join (creditOwners/gather) live here too
 *   so every rule about "what counts as an edge" exists exactly once.
 * Consumes: HistoryCap.esSearch (the ONLY raw-ES seam), Chain.db/Chain.call
 *   (get_objects), Account.resolve, Credit.offer/deal, Format — all guarded
 *   at call time. Side effects: HTTP POST to the community index + chain
 *   reads, both lazy and best-effort. No signing, no storage, no tx build.
 *   Global AccountNet.
 * MONEY DISCIPLINE: amounts stay raw digit strings; nothing here sums two
 *   assets together or converts an amount through Number().
 * ES TRUTH (probed 2026-10-08, es.bitshares.dev index bitshares-*):
 *   - account_history.account is the account ID, and every operation is
 *     indexed ONCE PER PARTY (a transfer A->B yields two docs) -> callers
 *     must dedupe by block_num + account_history.operation_id.
 *   - the index's operation_type numbering disagrees with Tx.OP for
 *     10/11/22/23/39 (index 10 = asset_create), so every extractor
 *     validates its expected field names and skips a mismatch.
 *   - `size` above 10000 returns HTTP 200 with ZERO hits: ES_SIZE is pinned.
 * Created by: account-network graph spec (docs/superpowers/specs/
 *   2026-10-09-account-network-design.md), brainstorm + audit with owner. */
var AccountNet = (function () {
  "use strict";

  var ES_SIZE = 10000;      // ES hard ceiling (measured; see header)
  var SCAN_CAP = 5000;      // hits per seed
  var SCAN_MAX_PAGES = 2;
  var SCAN_TIMEOUT_MS = 30000;
  var NODE_CAP = 40;        // counterparties shown besides the seeds
  var EDGE_CAP = 400;
  var MAX_SEEDS = 12;
  var OP_UNION_CAP = 40;    // refuse a wild class combination outright

  /* Op classes. `kind` is load-bearing honesty: a line that is not a
   * movement of value (vesting authority, a direct-debit permission) must
   * never render like one. `defaultOn` is what the page ships with. */
  var CLASSES = {
    transfer: { id: "transfer", ops: [0], kind: "flow", defaultOn: true },
    credit: { id: "credit", ops: [69, 70, 71, 72, 73, 76], kind: "flow", defaultOn: true },
    override: { id: "override", ops: [38], kind: "flow", defaultOn: false },
    debit: { id: "debit", ops: [25, 26, 27, 28], kind: "relation", defaultOn: false },
    htlc: { id: "htlc", ops: [49, 50, 51, 52], kind: "flow", defaultOn: false },
    vesting: { id: "vesting", ops: [34], kind: "relation", defaultOn: false }
  };
  var DEFAULT_CLASSES = ["transfer", "credit"];

  /* CLASS_BY_OP: op id -> class id (built, never hand-maintained twice). */
  var CLASS_BY_OP = {};
  Object.keys(CLASSES).forEach(function (id) {
    CLASSES[id].ops.forEach(function (op) { CLASS_BY_OP[op] = id; });
  });

  /* Per-op extraction table. Each entry returns the two account ids and the
   * amount leg for THAT op's real field shape, or null when the op carries
   * no counterpart pair (lifecycle ops draw no line). Verified live
   * 2026-10-08 — see the spec table for the probed fields. */
  var EXTRACT = {
    0: function (o) { return leg(o, "from", "to", o.amount_); },              // transfer
    38: function (o) { return leg(o, "from", "to", o.amount_); },             // override_transfer
    72: function (o) { return pending(o, "offerId", o.offer_id, "borrower", "to", o.borrow_amount); },
    73: function (o) { return pending(o, "dealId", o.deal_id, "account", "from", o.repay_amount); },
    25: function (o) { return leg(o, "withdraw_from_account", "authorized_account", o.withdrawal_limit); },
    26: function (o) { return leg(o, "withdraw_from_account", "authorized_account", o.withdrawal_limit); },
    27: function (o) { return leg(o, "withdraw_from_account", "withdraw_to_account", o.amount_to_withdraw); },
    28: function (o) { return leg(o, "withdraw_from_account", "authorized_account", o.withdrawal_limit); },
    49: function (o) { return leg(o, "from", "to", o.amount_); },              // htlc create (verified: from/to/amount_)
    51: function (o) { return leg(o, "from", "to", o.amount_); },              // htlc update w/ preimage (same shape)
    34: function (o) { return leg(o, "initializer", "owner_", null); }        // vesting authority
  };
  /* Ops with NO extractor on purpose (probed 2026-10-08, they name a single
   * account so there is no pair to draw): credit 69/70/71 (offer lifecycle),
   * credit 76 (auto-repay flag), htlc 50 (redeem: htlc_id + redeemer only),
   * htlc 52 (extend: update_issuer only). They ride along in the query
   * because the class ships them together; classify() reports "no-endpoint",
   * which is not an error counter. */

  function acct(v) {
    var s = v === undefined || v === null ? "" : String(v);
    return /^1\.2\.\d+$/.test(s) ? s : null;
  }
  function amountOf(leg) {
    if (!leg) return null;
    var a = String(leg.amount === undefined ? "" : leg.amount);
    var id = String(leg.asset_id === undefined ? "" : leg.asset_id);
    if (!/^\d+$/.test(a) || !/^1\.3\.\d+$/.test(id)) return null;
    return { raw: a, assetId: id };
  }
  function leg(o, fromKey, toKey, amountLeg) {
    var f = acct(o[fromKey]), t = acct(o[toKey]);
    if (!f || !t) return null;
    var amt = amountOf(amountLeg);
    return { from: f, to: t, amountRaw: amt ? amt.raw : null, assetId: amt ? amt.assetId : null };
  }
  /* A credit line names the borrower (or the repaying account) and a
   * reference; the LENDER arrives later from the chain join (creditOwners).
   * `slot` says which end the known account sits on. */
  function pending(o, refKey, refVal, whoKey, slot, amountLeg) {
    var who = acct(o[whoKey]);
    var ref = String(refVal === undefined ? "" : refVal);
    if (!who || !/^1\.2[12]\.\d+$/.test(ref)) return null;
    var amt = amountOf(amountLeg);
    var refs = {}; refs[refKey] = ref;
    return { known: who, slot: slot, refs: refs,
      amountRaw: amt ? amt.raw : null, assetId: amt ? amt.assetId : null };
  }

  function enabled(ids) {
    var out = {};
    (ids || DEFAULT_CLASSES).forEach(function (id) { if (CLASSES[id]) out[id] = true; });
    return out;
  }

  function opUnion(ids) {
    var seen = {}, out = [];
    (ids && ids.length ? ids : DEFAULT_CLASSES).forEach(function (id) {
      var c = CLASSES[id];
      if (!c) return;
      c.ops.forEach(function (op) { if (!seen[op]) { seen[op] = 1; out.push(op); } });
    });
    out.sort(function (a, b) { return a - b; });
    if (out.length > OP_UNION_CAP) throw new Error("class-union-too-big");
    return out;
  }

  /* classify: one indexed hit -> one edge (or a counted skip).
   * Never throws: a malformed doc is a skip, never a guess. */
  function classify(hit, opts) {
    try {
      opts = opts || {};
      var en = opts.enabled || enabled(null);
      var s = hit && hit._source;
      if (!s) return { skip: "shape" };
      var opType = Number(s.operation_type);
      if (!isFinite(opType)) return { skip: "shape" };
      var cls = CLASS_BY_OP[opType];
      if (!cls) return { skip: "unknown-op" };
      if (!en[cls]) return { skip: "disabled" };
      var fn = EXTRACT[opType];
      if (!fn) return { skip: "no-endpoint" };
      var oo = (s.operation_history || {}).op_object;
      if (!oo || typeof oo !== "object") return { skip: "shape" };
      var got = fn(oo);
      if (!got) return { skip: "shape" };
      var edge = {
        cls: cls, kind: CLASSES[cls].kind, opType: opType,
        from: null, to: null,
        amountRaw: got.amountRaw, assetId: got.assetId,
        refs: got.refs || null,
        time: (s.block_data || {}).block_time || null,
        blockNum: (s.block_data || {}).block_num === undefined ? null : Number(s.block_data.block_num),
        opId: (s.account_history || {}).operation_id === undefined ? null : Number(s.account_history.operation_id)
      };
      if (got.known) { edge[got.slot] = got.known; }
      else { edge.from = got.from; edge.to = got.to; }
      /* A credit line stays incomplete until creditOwners() fills the other
       * end — classify() reports refs so the join can route it. */
      if (!edge.from || !edge.to) return { skip: "needs-join", edge: edge };
      if (edge.from === edge.to) return { skip: "self" };
      return { edge: edge };
    } catch (e) { return { skip: "shape" }; }
  }

  function edgeKey(e) {
    return String(e && e.from) + "|" + String(e && e.to) + "|" + String(e && e.cls);
  }

  return {
    CLASSES: CLASSES, DEFAULT_CLASSES: DEFAULT_CLASSES,
    ES_SIZE: ES_SIZE, SCAN_CAP: SCAN_CAP, SCAN_MAX_PAGES: SCAN_MAX_PAGES,
    SCAN_TIMEOUT_MS: SCAN_TIMEOUT_MS, NODE_CAP: NODE_CAP, EDGE_CAP: EDGE_CAP,
    MAX_SEEDS: MAX_SEEDS, OP_UNION_CAP: OP_UNION_CAP,
    enabled: enabled, opUnion: opUnion, classify: classify, edgeKey: edgeKey,
    _test: { EXTRACT: EXTRACT, CLASS_BY_OP: CLASS_BY_OP, amountOf: amountOf }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNet === "undefined") { globalThis.AccountNet = AccountNet; }
if (typeof module !== "undefined") { module.exports = AccountNet; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/account-net-test.js`
Expected: `account-net: 33 pass, 0 fail` (adjust the expected count to what you actually assert — the point is 0 fail).

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/account-net.js tooling/account-net-test.js
git commit -m "feat(account-net): class table + strict per-hit edge extraction"
```

---

### Task 2: Dedupe + aggregation + graph build (pure)

**Files:**
- Modify: `vanilla/js/api/account-net.js` (append aggregation; extend exports)
- Test: `tooling/account-net-test.js` (append vectors)

**Interfaces:**
- Consumes: `classify`, `edgeKey`, `CLASSES`, `NODE_CAP`, `EDGE_CAP` from Task 1.
- Produces:
  - `AccountNet.dedupeKey(hit) -> "blockNum|opId"` (from the same doc shape `classify` reads).
  - `AccountNet.buildGraph(edges, seeds, opts) -> {nodes, edges, stats}` where
    `opts = {nodeCap, edgeCap}`.
    - node: `{assetId, sym, seeded:boolean, degree:number, count:number, weightRaw:string}`
      (`weightRaw` is a BigInt digit string: the sum of the edge's largest
      asset only — never a cross-asset sum).
    - edge: `{a, b, poolId, cls, kind, count, perAsset:Object, firstSeen, lastSeen}`
      (`poolId` is the engine's identity field; we put the edge key there).
    - `stats`: `{scanned, edges, nodes, droppedSelf, droppedShape, needsJoin, caps:{nodeCapHit,edgeCapHit,scanCapHit}}`.

- [ ] **Step 1: Write the failing test**

Append to `tooling/account-net-test.js`:

```js
/* ---- Task 2: dedupe + aggregation (pure) ---- */
function edge(cls, from, to, raw, assetId, blockNum, opId, time) {
  return { cls: cls, kind: AccountNet.CLASSES[cls].kind, from: from, to: to,
    amountRaw: raw, assetId: assetId, blockNum: blockNum, opId: opId,
    time: time || "2026-09-01T10:00:00", refs: null };
}

// 11. dedupe key: the per-party duplicate of one operation collapses
eq(AccountNet.dedupeKey(transferHit("1.2.1", "1.2.2", "5", "1.3.0")), "12345|4242",
   "dedupe key is block_num + operation_id");

// 12. aggregation: one edge per from|to|class, per-asset BigInt sums, no cross-asset total
(function () {
  const g = AccountNet.buildGraph([
    edge("transfer", "1.2.1", "1.2.2", "5000000", "1.3.0", 10, 1),
    edge("transfer", "1.2.1", "1.2.2", "2500000", "1.3.0", 11, 2),
    edge("transfer", "1.2.1", "1.2.2", "7", "1.3.113", 12, 3),
    edge("transfer", "1.2.2", "1.2.1", "9", "1.3.0", 13, 4)          // opposite direction
  ], [{ id: "1.2.1", name: "alice" }]);
  eq(g.edges.length, 2, "two edges: one per direction");
  const out = g.edges.filter((e) => e.a === "1.2.1")[0];
  eq(out.count, 3, "three ops share one directed edge");
  eq(out.perAsset, { "1.3.0": "7500000", "1.3.113": "7" }, "per-asset sums stay separate");
  eq(g.nodes.length, 2, "two nodes");
  eq(g.nodes.filter((n) => n.seeded).length, 1, "the seed is flagged seeded");
  eq(g.nodes[0].sym, "alice", "seed node carries the account name");
  // the reverse edge exists separately (direction preserved)
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

// 16. counters: self/shape drops are counted by the caller via classify(); here we
//     prove buildGraph never invents an edge from a malformed input edge
(function () {
  const g = AccountNet.buildGraph([null, { cls: "transfer" }, edge("transfer", "1.2.1", "1.2.2", "5", "1.3.0", 1, 1)],
    [{ id: "1.2.1", name: "alice" }]);
  eq(g.edges.length, 1, "malformed edges are ignored");
  eq(g.nodes.length, 2, "only real endpoints become nodes");
})();

console.log("account-net: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
```

Delete the earlier single `console.log`/`process.exit` tail you added in Task 1 so the file ends with this one (one summary, one exit).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/account-net-test.js`
Expected: FAIL — `AccountNet.dedupeKey is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Insert into `vanilla/js/api/account-net.js` before the `return`:

```js
  /* dedupeKey: the index stores ONE DOC PER PARTY (measured 2026-10-08), so
   * the same operation arrives twice when both ends are seeds. block_num +
   * operation_id is stable across those copies. */
  function dedupeKey(hit) {
    try {
      var s = (hit && hit._source) || {};
      var b = (s.block_data || {}).block_num;
      var o = (s.account_history || {}).operation_id;
      if (b === undefined || b === null || o === undefined || o === null) return null;
      return String(b) + "|" + String(o);
    } catch (e) { return null; }
  }

  function addRaw(sum, raw) {
    /* BigInt string addition; a missing/garbage leg adds nothing (never 0.5,
     * never a Number round-trip). */
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return;
    try { sum.value = (sum.value + BigInt(raw)).toString(); } catch (e) { /* skip leg */ }
  }

  /* buildGraph: extracted edges -> the {nodes, edges} shape PoolNetUI.mount
   * consumes (node.assetId/node.sym, edge.a/edge.b/edge.poolId). Pure.
   * opts {nodeCap, edgeCap}. Money: perAsset holds raw digit strings keyed by
   * asset id; node.weightRaw is the largest single asset's sum (a magnitude
   * for the node radius), NEVER a cross-asset total. */
  function buildGraph(edges, seeds, opts) {
    opts = opts || {};
    var nodeCap = opts.nodeCap === undefined ? NODE_CAP : Math.max(1, Math.floor(opts.nodeCap));
    var edgeCap = opts.edgeCap === undefined ? EDGE_CAP : Math.max(1, Math.floor(opts.edgeCap));
    var seedIds = {}, seedName = {};
    (seeds || []).forEach(function (s) {
      if (s && s.id) { seedIds[s.id] = 1; seedName[s.id] = s.name || s.id; }
    });
    var byKey = {}, order = [];
    (edges || []).forEach(function (e) {
      if (!e || !e.cls || !e.from || !e.to || !CLASSES[e.cls]) return;
      if (e.from === e.to) return;
      var k = edgeKey(e);
      var cur = byKey[k];
      if (!cur) {
        cur = byKey[k] = { a: e.from, b: e.to, poolId: k, cls: e.cls, kind: CLASSES[e.cls].kind,
          count: 0, perAsset: {}, firstSeen: null, lastSeen: null };
        order.push(k);
      }
      cur.count++;
      if (e.assetId && typeof e.amountRaw === "string") {
        if (!cur.perAsset[e.assetId]) cur.perAsset[e.assetId] = { value: "0" };
        addRaw(cur.perAsset[e.assetId], e.amountRaw);
      }
      if (e.time) {
        if (!cur.firstSeen || e.time < cur.firstSeen) cur.firstSeen = e.time;
        if (!cur.lastSeen || e.time > cur.lastSeen) cur.lastSeen = e.time;
      }
    });
    /* Weight for ranking = the LARGEST asset sum (BigInt compare on strings),
   never a sum across assets. */
    Object.keys(byKey).forEach(function (k) {
      var e = byKey[k], best = "0", bestLen = 0;
      Object.keys(e.perAsset).forEach(function (aid) {
        var v = e.perAsset[aid].value, len = v.replace(/^0+/, "").length;
        if (len > bestLen || (len === bestLen && v > best)) { best = v; bestLen = len; }
      });
      e.weightRaw = best;
    });
    var ranked = order.slice().sort(function (x, y) {
      var ea = byKey[x], eb = byKey[y];
      if (eb.count !== ea.count) return eb.count - ea.count;
      return (eb.weightRaw || "").length - (ea.weightRaw || "").length;
    });
    var caps = { nodeCapHit: false, edgeCapHit: false, scanCapHit: false };
    var kept = ranked.slice(0, edgeCap);
    if (kept.length < ranked.length) caps.edgeCapHit = true;
    /* Counterparty ranking per seed: seeds always survive; everyone else is
     * ranked by (degree, weight) and capped. */
    var degree = {}, weight = {};
    kept.forEach(function (k) {
      var e = byKey[k];
      [e.a, e.b].forEach(function (id) {
        degree[id] = (degree[id] || 0) + 1;
        weight[id] = (weight[id] || "0");
        try { weight[id] = (BigInt(weight[id]) + BigInt(e.weightRaw || "0")).toString(); } catch (x) {}
      });
    });
    var others = Object.keys(degree).filter(function (id) { return !seedIds[id]; })
      .sort(function (a, b) {
        if (degree[b] !== degree[a]) return degree[b] - degree[a];
        return weight[b].length - weight[a].length || (weight[b] > weight[a] ? 1 : -1);
      });
    var room = Math.max(0, nodeCap - Object.keys(seedIds).length);
    var shown = others.slice(0, room);
    if (shown.length < others.length) caps.nodeCapHit = true;
    var keepIds = {};
    Object.keys(seedIds).forEach(function (id) { keepIds[id] = 1; });
    shown.forEach(function (id) { keepIds[id] = 1; });
    var outEdges = kept.filter(function (k) { return keepIds[byKey[k].a] && keepIds[byKey[k].b]; })
      .map(function (k) { return byKey[k]; });
    var outNodes = [];
    Object.keys(keepIds).forEach(function (id) {
      outNodes.push({ assetId: id, sym: seedName[id] || null, seeded: !!seedIds[id],
        degree: degree[id] || 0, count: degree[id] || 0, weightRaw: weight[id] || "0" });
    });
    return {
      nodes: outNodes, edges: outEdges,
      stats: { edges: outEdges.length, nodes: outNodes.length,
        scanned: opts.scanned || 0,
        droppedSelf: opts.droppedSelf || 0, droppedShape: opts.droppedShape || 0,
        needsJoin: opts.needsJoin || 0, caps: caps }
    };
  }
```

Extend the `return` block with `dedupeKey: dedupeKey, buildGraph: buildGraph,`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/account-net-test.js`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/account-net.js tooling/account-net-test.js
git commit -m "feat(account-net): dedupe, per-asset aggregation, node/edge caps"
```

---

### Task 3: ES walk + chain credit join + gather

**Files:**
- Modify: `vanilla/js/api/account-net.js`
- Test: `tooling/account-net-test.js` (append network-stub vectors)

**Interfaces:**
- Consumes: Task 1 + Task 2 exports; `HistoryCap.esSearch`, `Chain.db()`, `Chain.call`.
- Produces:
  - `AccountNet.scanSeed(seedId, opIds, opts) -> Promise<{hits, scanned, truncated}>`
    (paged `search_after`, `size: ES_SIZE`, `SCAN_CAP`, mid-walk failure keeps
    the pages already fetched).
  - `AccountNet.creditOwners(refs) -> Promise<{offer:{id:ownerId}, deal:{id:ownerId}, missing:[ids]}>`
    — chunked `get_objects` over `1.21.x` / `1.22.x`; a missing object lands in
    `missing`, never a guessed owner.
  - `AccountNet.gather(seeds, enabledIds, opts) -> Promise<{graph, seeds, unknown, stats}>`
    — resolves seeds with `Account.resolve`, scans each, classifies, joins
    credit owners, aggregates. Sequential seeds, painting through
    `opts.onSeed(seedsSoFar, graphSoFar)`.

- [ ] **Step 1: Write the failing test**

Append to `tooling/account-net-test.js` (before the summary/exit), adding the
seam preloads at the top of the file (right after the existing require):

```js
globalThis.HistoryCap = require("/workspace/vanilla/js/api/history-cap.js");
```

…and the vectors:

```js
/* ---- Task 3: ES walk + credit join (fetch + chain stubbed) ---- */
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
  // 17. the query shape: exact party term + op terms + size 10000 + newest-first sort
  {
    const st = stubFetch([esPage(3, "a")]);
    const res = await AccountNet.scanSeed("1.2.1", [0], {});
    st.restore();
    const b = st.bodies[0];
    eq(b.size, 10000, "ES page size is the 10000 hard cap");
    const s = JSON.stringify(b.query);
    ok(s.indexOf('"account_history.account":"1.2.1"') !== -1, "party filter is an exact term on account_history.account");
    ok(s.indexOf('"operation_type":[0]') !== -1, "op filter is a terms list");
    ok(JSON.stringify(b.sort).indexOf("block_data.block_time") !== -1, "sorted newest-first by block time");
    eq(res.hits.length, 3, "one short page resolves");
    eq(res.truncated, false, "short page is not truncation");
  }

  // 18. paging: past one page, with search_after carrying the last sort verbatim
  {
    const st = stubFetch([esPage(10000, "p1"), esPage(4, "p2")]);
    const res = await AccountNet.scanSeed("1.2.1", [0], {});
    st.restore();
    eq(st.calls, 2, "walked a second page");
    ok(!!st.bodies[1].search_after, "second page resumes with search_after");
    ok(Array.isArray(st.bodies[1].search_after), "search_after is the raw sort array (epoch millis on the live index)");
    eq(res.hits.length, 10004, "both pages kept");
  }

  // 19. SCAN_CAP: a huge account stops at the cap and says truncated
  {
    const st = stubFetch([esPage(10000, "c1"), esPage(10000, "c2"), esPage(10000, "c3")]);
    const res = await AccountNet.scanSeed("1.2.1", [0], {});
    st.restore();
    eq(res.hits.length, 5000, "scan stops at SCAN_CAP");
    eq(res.truncated, true, "capped scan reports truncated");
    eq(st.calls, 1, "the cap is enforced without fetching a second page");
  }

  // 20. mid-walk failure keeps what it fetched (never a total loss)
  {
    const prev = globalThis.fetch; let calls = 0;
    globalThis.fetch = function () {
      calls++;
      if (calls > 1) return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hits: { hits: esPage(10000, "m") } }) });
    };
    const res = await AccountNet.scanSeed("1.2.1", [0], {});
    if (prev !== undefined) globalThis.fetch = prev; else delete globalThis.fetch;
    eq(res.hits.length, 10000, "mid-walk failure keeps the first page");
    eq(res.truncated, true, "mid-walk failure is a truncation, not a silent success");
  }

  // 21. a dead index rejects so the view can show the reason (no fabrication)
  {
    const prev = globalThis.fetch;
    globalThis.fetch = function () { return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }); };
    let msg = "";
    try { await AccountNet.scanSeed("1.2.1", [0], {}); } catch (e) { msg = String(e && e.message); }
    if (prev !== undefined) globalThis.fetch = prev; else delete globalThis.fetch;
    ok(/es-unavailable|unavailable/i.test(msg), "a dead index rejects with an honest error (" + msg + ")");
  }

  // 22. credit join: offers + deals in one chunked get_objects; missing ids listed
  {
    const prevChain = globalThis.Chain;
    const seen = [];
    globalThis.Chain = {
      db: () => Promise.resolve(0),
      call: (_api, method, params) => {
        seen.push([method, JSON.stringify(params[0])]);
        if (method === "get_objects") {
          const ids = params[0];
          return Promise.resolve(ids.map((id) => (/^1\.21\./.test(id)
            ? { id: id, owner: "1.2.777" }
            : { id: id, offer_id: "1.21.9", borrower: "1.2.888" })));
        }
        return Promise.resolve([]);
      }
    };
    const res = await AccountNet.creditOwners({ offerId: ["1.21.3"], dealId: ["1.22.0", "1.22.999"] });
    globalThis.Chain = prevChain;
    eq(res.offer["1.21.3"], "1.2.777", "offer owner resolved from the chain");
    ok(/get_objects/.test(seen[0][0]), "the join goes through get_objects");
    ok(res.missing.indexOf("1.22.999") !== -1 || Object.keys(res.deal).length === 2,
       "an unresolvable reference is either missing or resolved, never guessed");
  }

  // 23. gather: unknown seeds are reported, known ones still draw
  {
    const prevRes = globalThis.Account, prevPool = globalThis.Pool;
    globalThis.Account = { resolve: (n) => (String(n) === "nope" ? Promise.reject(new Error("unknown-account")) : Promise.resolve({ id: "1.2." + String(n).length, name: String(n) })) };
    const st = stubFetch([esPage(2, "g")]);
    const out = await AccountNet.gather(["alice", "nope"], ["transfer"], {});
    st.restore();
    globalThis.Account = prevRes; globalThis.Pool = prevPool;
    eq(out.unknown.join(","), "nope", "an unknown seed is listed by its raw name");
    eq(out.graph.edges.length, 1, "the resolvable seed still draws its edge");
  }

  console.log("account-net: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL harness " + (e && e.stack || e)); process.exit(1); });
```

Note: Tasks 1–2 vectors are synchronous; wrap the whole file body in the
async IIFE shown here (move the earlier vectors inside it) so the summary
prints once, after the network vectors.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/account-net-test.js`
Expected: FAIL — `AccountNet.scanSeed is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Insert into `vanilla/js/api/account-net.js` before the `return` (and add a
`_historyCap()` accessor mirroring `pool-history.js:138-146`):

```js
  /* HistoryCap seam (the ONLY raw-ES path — a direct fetch here is FORBIDDEN
   * by the centralization rule). Classic-script global in the browser,
   * globalThis preload in node suites. Missing => null => es rejects and the
   * view shows the honest reason. */
  function _historyCap() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.esSearch === "function") return HistoryCap;
    } catch (e) {}
    try {
      if (typeof globalThis !== "undefined" && globalThis.HistoryCap && typeof globalThis.HistoryCap.esSearch === "function") return globalThis.HistoryCap;
    } catch (e) {}
    return null;
  }
  function _esOn() {
    try {
      var HC = _historyCap();
      if (HC && typeof HC.esAllowed === "function") return HC.esAllowed() !== false;
    } catch (e) {}
    return true;
  }

  /* esQuery: the seed's indexed history for a set of ops, newest first.
   * account_history.account is an exact id term (verified 2026-10-08). */
  function esQuery(seedId, opIds, searchAfter) {
    var q = { track_total_hits: false,
      sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
      size: ES_SIZE,
      _source: ["account_history", "operation_history", "operation_type", "block_data"],
      query: { bool: { filter: [
        { term: { "account_history.account": seedId } },
        { terms: { operation_type: opIds } } ] } } };
    if (searchAfter) q.search_after = searchAfter;
    return q;
  }

  /* scanSeed: paged walk up to SCAN_CAP. Resolves {hits, scanned, truncated};
   * rejects "es-disabled" / "es-unavailable" so the view can say why. A page
   * that fails mid-walk keeps what it already fetched and reports truncated
   * (same honesty rule as the candle deep walk). */
  function scanSeed(seedId, opIds, opts) {
    opts = opts || {};
    var cap = opts.cap === undefined ? SCAN_CAP : Math.max(1, Math.floor(opts.cap));
    var budget = opts.timeoutMs === undefined ? SCAN_TIMEOUT_MS : Math.max(1000, Math.floor(opts.timeoutMs));
    return new Promise(function (resolve, reject) {
      if (!/^1\.2\.\d+$/.test(String(seedId))) { reject(new Error("bad-account-id")); return; }
      if (!_esOn()) { reject(new Error("es-disabled")); return; }
      var HC = _historyCap();
      if (!HC) { reject(new Error("es-unavailable")); return; }
      var deadline = Date.now() + budget;
      var hits = [], searchAfter = null, pages = 0, truncated = false, done = false;
      function finish() {
        if (done) return; done = true;
        resolve({ hits: hits, scanned: hits.length, truncated: truncated });
      }
      function fail(e) {
        if (done) return; done = true;
        if (hits.length) { truncated = true; finish(); return; }
        reject(e instanceof Error ? e : new Error("es-unavailable"));
      }
      function page() {
        if (done) return;
        if (pages >= SCAN_MAX_PAGES) { truncated = true; finish(); return; }
        var remain = deadline - Date.now();
        if (remain <= 0) { truncated = true; finish(); return; }
        HC.esSearch("bitshares-*", esQuery(seedId, opIds, searchAfter), { timeoutMs: remain }).then(function (data) {
          if (done) return;
          var got = (data && data.hits && data.hits.hits) || [];
          for (var i = 0; i < got.length && hits.length < cap; i++) hits.push(got[i]);
          pages++;
          if (hits.length >= cap) { truncated = true; finish(); return; }
          if (got.length < ES_SIZE) { finish(); return; }
          var last = got[got.length - 1];
          if (!last || !last.sort) { truncated = true; finish(); return; }
          searchAfter = last.sort;
          page();
        }).catch(fail);
      }
      page();
    });
  }

  /* creditOwners: op 72 names a borrower + offer_id, op 73/76 an account +
   * deal_id; the LENDER is the offer owner (deal -> offer -> owner). One
   * chunked get_objects round. Missing objects land in `missing` — the caller
   * drops those lines and says so. Never guesses an owner. */
  function creditOwners(refs) {
    refs = refs || {};
    var offerIds = (refs.offerId || []).filter(function (v) { return /^1\.21\.\d+$/.test(String(v)); });
    var dealIds = (refs.dealId || []).filter(function (v) { return /^1\.22\.\d+$/.test(String(v)); });
    var out = { offer: {}, deal: {}, missing: [] };
    if (!offerIds.length && !dealIds.length) return Promise.resolve(out);
    var CHUNK = 100;
    function fetchIds(ids) {
      var steps = [];
      for (var i = 0; i < ids.length; i += CHUNK) steps.push(ids.slice(i, i + CHUNK));
      return steps.reduce(function (p, chunk) {
        return p.then(function (acc) {
          return Chain.db().then(function (api) { return Chain.call(api, "get_objects", [chunk]); })
            .then(function (rows) { return acc.concat(rows || []); });
        });
      }, Promise.resolve([]));
    }
    return fetchIds(offerIds.concat(dealIds)).then(function (rows) {
      var dealOffer = {};
      rows.forEach(function (o) {
        if (!o || !o.id) return;
        var id = String(o.id);
        if (/^1\.21\./.test(id)) { if (o.owner) out.offer[id] = String(o.owner); }
        else if (/^1\.22\./.test(id)) { if (o.offer_id) dealOffer[id] = String(o.offer_id); }
      });
      return fetchIds(Object.keys(dealOffer).map(function (d) { return dealOffer[d]; })).then(function (offers) {
        var ownerByOffer = {};
        offers.forEach(function (o) { if (o && o.id && o.owner) ownerByOffer[String(o.id)] = String(o.owner); });
        Object.keys(dealOffer).forEach(function (d) {
          var own = ownerByOffer[dealOffer[d]];
          if (own) out.deal[d] = own; else out.missing.push(d);
        });
        offerIds.forEach(function (id) { if (!out.offer[id]) out.missing.push(id); });
        return out;
      });
    }).catch(function () { return out; });   /* join failure => missing, never a guess */
  }

  /* gather: seeds -> scan -> classify -> credit join -> aggregate. Seeds are
   * scanned SEQUENTIALLY (one account at a time; the index is a courtesy) and
   * opts.onSeed fires after each so the page paints as results land. */
  function gather(seedNames, enabledIds, opts) {
    opts = opts || {};
    var en = enabled(enabledIds);
    var ops = opUnion(enabledIds);              // throws class-union-too-big
    var names = (seedNames || []).map(function (s) { return String(s).trim(); })
      .filter(function (s) { return s.length; }).slice(0, MAX_SEEDS);
    var seeds = [], unknown = [], all = [], stats = { scanned: 0, truncated: false,
      droppedSelf: 0, droppedShape: 0, needsJoin: 0, unknown: [] };
    var seen = {}, refs = { offerId: [], dealId: [] };
    function resolveOne(n) {
      if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") return Promise.reject(new Error("unknown-account"));
      return Account.resolve(n);
    }
    return names.reduce(function (p, n) {
      return p.then(function () {
        return resolveOne(n).then(function (r) {
          if (!r || !r.id || seen[r.id]) { if (r && r.id) return null; return null; }
          seen[r.id] = 1;
          seeds.push({ id: r.id, name: r.name || n });
          return scanSeed(r.id, ops, opts).then(function (res) {
            stats.scanned += res.scanned;
            if (res.truncated) stats.truncated = true;
            var perSeed = {};
            res.hits.forEach(function (hit) {
              var dk = dedupeKey(hit);
              if (dk) { if (perSeed[dk]) return; perSeed[dk] = 1; }
              var got = classify(hit, { enabled: en, seedId: r.id });
              if (got.skip === "self") stats.droppedSelf++;
              else if (got.skip === "shape") stats.droppedShape++;
              else if (got.skip === "needs-join") { stats.needsJoin++; all.push(got.edge); collectRefs(got.edge, refs); }
              else if (got.edge) { all.push(got.edge); }
            });
            if (typeof opts.onSeed === "function") { try { opts.onSeed(seeds.slice(), stats); } catch (e) {} }
          });
        }).catch(function () { unknown.push(n); return null; });
      });
    }, Promise.resolve([]))
      .then(function () { return creditOwners(refs); })
      .then(function (owners) {
        var edges = [];
        all.forEach(function (e) {
          if (!e.refs) { edges.push(e); return; }
          var own = e.refs.offerId ? owners.offer[e.refs.offerId] : owners.deal[e.refs.dealId];
          if (!own) return;                       /* unresolvable => dropped, counted via missing */
          if (e.to === null) e.to = own; else if (e.from === null) e.from = own;
          if (!e.from || !e.to || e.from === e.to) return;
          edges.push(e);
        });
        var graph = buildGraph(edges, seeds, { scanned: stats.scanned,
          droppedSelf: stats.droppedSelf, droppedShape: stats.droppedShape,
          needsJoin: stats.needsJoin, nodeCap: opts.nodeCap, edgeCap: opts.edgeCap });
        graph.stats.missingCredit = owners.missing.length;
        graph.stats.unknown = unknown.slice();
        graph.stats.truncated = stats.truncated;
        return { graph: graph, seeds: seeds, unknown: unknown, stats: graph.stats };
      });
  }
  function collectRefs(edge, refs) {
    if (!edge || !edge.refs) return;
    if (edge.refs.offerId && refs.offerId.indexOf(edge.refs.offerId) === -1) refs.offerId.push(edge.refs.offerId);
    if (edge.refs.dealId && refs.dealId.indexOf(edge.refs.dealId) === -1) refs.dealId.push(edge.refs.dealId);
  }
```

Extend the `return` block: `scanSeed: scanSeed, creditOwners: creditOwners,
gather: gather, esQuery: esQuery`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/account-net-test.js`
Expected: 0 fail.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/account-net.js tooling/account-net-test.js
git commit -m "feat(account-net): paged ES walk, chain credit join, gather"
```

---

### Task 4: Opt-in arrowheads + per-class edge colour in the shared painter

**Files:**
- Modify: `vanilla/js/api/charts-lwc.js`? **No** — the painter is `vanilla/js/views/pool-net-paint.js`:
  `drawScene(ctx, W, H, view, geom, paint)` at line 218, edge loop at 255-292.
- Test: `tooling/account-net-paint-test.js` (new, stub-ctx style copied from `tooling/pool-net-ui-test.js:11-26`)

**Interfaces:**
- Consumes: nothing (the paint module already resolves theme tokens).
- Produces: `drawScene` honours two OPT-IN fields on `paint`:
  - `paint.arrows === true` → draws one filled arrowhead per edge at the `b`
    end (direction = a → b).
  - `paint.edgeClassOf(edge) -> string|null` → when it returns a token name
    (`"buy"`, `"sell"`, `"accent"`, `"warn"`, `"muted"`), that token's hex
    becomes the edge `strokeStyle`; hover/selected states still win.
  Absent fields ⇒ byte-identical behaviour for the pool/market maps.

- [ ] **Step 1: Write the failing test**

Create `tooling/account-net-paint-test.js`:

```js
#!/usr/bin/env node
/* Painter extension vectors: arrows + per-class edge colour are OPT-IN and
 * must not change the shipped pool/market frames. Stub ctx only. */
"use strict";
const PoolNet = require("/workspace/vanilla/js/api/pool-net.js");
const PoolNetUI = require("/workspace/vanilla/js/views/pool-net-ui.js");
const MP = PoolNetUI._paintForTest ? PoolNetUI._paintForTest() : null;

let pass = 0, fail = 0;
function ok(c, n) { if (c) pass++; else { fail++; console.log("FAIL " + n); } }

function stubCtx() {
  const st = { fills: 0, strokes: 0, styles: [], arrows: 0 };
  const ctx = {
    setTransform() {}, clearRect() {}, save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() { st.strokes++; }, closePath() {},
    arc() {}, fill() { st.fills++; }, fillText() {}, strokeText() {}, quadraticCurveTo() {},
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", globalAlpha: 1,
    shadowColor: "", shadowBlur: 0
  };
  return { ctx, st };
}
const view = { nodes: [{ assetId: "1.2.1", sym: "alice" }, { assetId: "1.2.2", sym: "bob" }],
  edges: [{ a: "1.2.1", b: "1.2.2", poolId: "1.2.1|1.2.2|transfer", cls: "transfer" }] };
const geom = { "1.2.1": { x: 20, y: 20 }, "1.2.2": { x: 200, y: 160 } };

ok(MP && typeof MP.drawScene === "function", "drawScene reachable for tests");
// default: no arrowhead ink at all (pool/market maps unchanged)
{
  const { ctx, st } = stubCtx();
  MP.drawScene(ctx, 320, 240, view, geom, { scale: 1, ox: 0, oy: 0 });
  ok(st.strokes >= 1, "edge stroked without paint.arrows");
  ok(st.fills === 0, "NO arrowhead ink when paint.arrows is absent (" + st.fills + ")");
}
// opt-in arrows
{
  const { ctx, st } = stubCtx();
  MP.drawScene(ctx, 320, 240, view, geom, { scale: 1, ox: 0, oy: 0, arrows: true });
  ok(st.fills >= 1, "arrowhead painted when paint.arrows is true");
}
// opt-in class colour wins over the volume ramp
{
  const { ctx, st } = stubCtx();
  const seen = [];
  const c2 = Object.assign({}, ctx);
  Object.defineProperty(c2, "strokeStyle", { set(v) { seen.push(v); }, get() { return ""; } });
  MP.drawScene(c2, 320, 240, view, geom,
    { scale: 1, ox: 0, oy: 0, arrows: true, edgeClassOf: (e) => (e.cls === "credit" ? "sell" : null) });
  ok(seen.length >= 1, "strokeStyle assigned");
  ok(seen.some((v) => typeof v === "string" && /^#|rgb/.test(v)), "class colour resolves to a real colour (" + seen[0] + ")");
}
// hover still overrides the class colour
{
  const { ctx } = stubCtx();
  const seen = [];
  const c2 = Object.assign({}, ctx);
  Object.defineProperty(c2, "strokeStyle", { set(v) { seen.push(v); }, get() { return ""; } });
  MP.drawScene(c2, 320, 240, view, geom,
    { scale: 1, ox: 0, oy: 0, edgeClassOf: () => "sell", hoverEdge: view.edges[0].poolId });
  ok(seen.indexOf(seen[0]) === 0 && seen.length >= 1, "hover path still assigns a colour");
}
console.log("account-net-paint: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
```

If `PoolNetUI` does not expose the painter, require the painter module
directly: `require("/workspace/vanilla/js/views/pool-net-paint.js")` and use
its `drawScene` export.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/account-net-paint-test.js`
Expected: FAIL on `arrowhead painted when paint.arrows is true` (fills === 0).

- [ ] **Step 3: Write the minimal implementation**

In `vanilla/js/views/pool-net-paint.js`:

1. Inside `drawScene`, right after the `edges.forEach` opening, resolve the
   class-colour helper:

```js
      /* Account-network mode (2026-10-09): class-coloured edges. OPT-IN —
       * absent paint.edgeClassOf, the volume ramp below is byte-identical to
       * the pool/market maps, which never set it. */
      var classColorOf = null;
      try {
        if (paint && typeof paint.edgeClassOf === "function") classColorOf = paint.edgeClassOf;
      } catch (e) { classColorOf = null; }
      var CLASS_TOKENS = { buy: ["--buy", "#26de81"], sell: ["--sell", "#ef5350"],
        accent: ["--accent", "#1E9ED7"], warn: ["--warn", "#ffb300"], muted: ["--muted", "#758696"] };
      function classColor(e) {
        if (!classColorOf) return null;
        var name = null;
        try { name = classColorOf(e); } catch (x) { return null; }
        var t = name ? CLASS_TOKENS[name] : null;
        return t ? _cssTok(t[0], t[1]) : null;
      }
      /* Arrowheads (OPT-IN): the line already records its two screen ends, so
       * the head is a filled triangle at ~82% of the path pointing at `b`.
       * Direction is therefore a → b, which is the flow direction the account
       * network is about. */
      function arrowHead(p0, p1) {
        var hx = p0.x + (p1.x - p0.x) * 0.82, hy = p0.y + (p1.y - p0.y) * 0.82;
        var ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        var s = 7, spread = 0.42;
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(ang) * s, hy + Math.sin(ang) * s);
        ctx.lineTo(hx + Math.cos(ang + spread) * s, hy + Math.sin(ang + spread) * s);
        ctx.lineTo(hx + Math.cos(ang - spread) * s, hy + Math.sin(ang - spread) * s);
        ctx.closePath();
        ctx.fill();
      }
```

2. In the edge loop, replace the `ctx.strokeStyle = ...` line so the class
   colour applies only when no interaction state is set (state wins), and
   call `arrowHead` after `ctx.stroke()` when `paint.arrows` is true:

```js
          var clsColor = classColor(e);
          ctx.strokeStyle = (hot || onPath || hov) ? (hot ? buy : PATH_WARM) : (clsColor || _ramp(edgeT(paint.meta, e.poolId), rampLo, rampHi));
```

and immediately after the existing `ctx.stroke();` + `restore()`:

```js
          if (paint && paint.arrows) {
            try {
              ctx.fillStyle = ctx.strokeStyle;
              arrowHead({ x: SX(p.x), y: SY(p.y) }, { x: SX(q.x), y: SY(q.y) });
            } catch (x) { /* head is decoration; the line still reads */ }
          }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/account-net-paint-test.js` → 0 fail, then the pool/market
suites (they must be unchanged): `node tooling/pool-net-ui-test.js`,
`node tooling/pool-graph-test.js`, `node tooling/market-desk-map-test.js`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/pool-net-paint.js tooling/account-net-paint-test.js
git commit -m "feat(pool-net-paint): opt-in arrowheads + per-class edge colour"
```

---

### Task 5: The page shell

**Files:**
- Create: `vanilla/js/views/account-network-ui.js`
- Test: `tooling/account-network-ui-test.js`

**Interfaces:**
- Consumes: Task 3 `AccountNet.gather/enabled/CLASSES/DEFAULT_CLASSES`,
  Task 4 `paint.arrows` / `paint.edgeClassOf`, plus shared `DOM.*`,
  `TableRenderer.render`, `PoolNetUI.mount`, `Router.query`.
- Produces: `AccountNetworkUI.renderAccountNetwork(root)` and
  `AccountNetworkUI._test` with `{parseSeeds, classChips, classRow, detailLine,
  seedSummary, summaryStats}` (pure helpers the vectors drive).

**Layout contract (exact class names, reused styling where it exists):**
`.wrap` → `h1` "Account Network" → `.muted` intro (says it reads the
community index) → `#an-seeds` (text input, comma/space separated) +
`button.an-go` → `#an-chips` (one `.an-chip` checkbox per class, 44px tall) →
`#an-status` (`.muted`) → `#an-detail` (`.an-detail`) → `#an-graph`
(PoolNetUI mount target) → `details.an-twin > table` (table twin).

- [ ] **Step 1: Write the failing test**

Create `tooling/account-network-ui-test.js` (stub-element harness copied
from `tooling/pool-net-ui-test.js:28-40`; no DOM, no network):

```js
#!/usr/bin/env node
/* account-network-ui vectors: seed parsing, chip wiring, honest status text,
 * table-twin rows, hash round-trip. Stub elements only. */
"use strict";
globalThis.AccountNet = require("/workspace/vanilla/js/api/account-net.js");
const AN = require("/workspace/vanilla/js/views/account-network-ui.js");
let pass = 0, fail = 0;
function eq(g, w, n) { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.log("FAIL " + n + "\n  got  " + JSON.stringify(g) + "\n  want " + JSON.stringify(w)); } }
function ok(c, n) { if (c) pass++; else { fail++; console.log("FAIL " + n); } }
const T = AN._test;

// 1. seed parsing: comma / space / newline, deduped, capped at 12
eq(T.parseSeeds("alice, bob carol\ndave"), ["alice", "bob", "carol", "dave"], "separators + trim + dedupe");
eq(T.parseSeeds("alice,,alice"), ["alice"], "empty entries dropped");
eq(T.parseSeeds(Array.from({ length: 20 }, (_, i) => "a" + i).join(" ")).length, 12, "seed cap is 12");

// 2. chip model: transfer + credit default on, the rest off, each with its kind
eq(T.chipModel().filter((c) => c.on).map((c) => c.id).join(","), "transfer,credit", "defaults: transfer + credit");
eq(T.chipModel().find((c) => c.id === "vesting").kind, "relation", "vesting chip is marked a relation");
eq(T.chipModel().length, 6, "six classes ship as chips");

// 3. status text is honest about what was scanned and what was dropped
(function () {
  const s = T.statusText({
    seeds: [{ id: "1.2.1", name: "alice" }], unknown: ["nope"],
    stats: { scanned: 2075, edges: 12, nodes: 9, truncated: true,
      droppedSelf: 3, droppedShape: 1, missingCredit: 2,
      caps: { nodeCapHit: false, edgeCapHit: false } }
  });
  ok(/alice/.test(s), "status names the seed");
  ok(/nope/.test(s), "status names the unknown seed");
  ok(/2075/.test(s), "status states the scanned op count");
  ok(/newest/i.test(s), "a truncated scan says the window is newest-first");
  ok(/2/.test(s), "status counts the unresolvable credit lines");
})();

// 4. detail line states amount + count + flow/relation + both ends
(function () {
  const d = T.detailText({
    edge: { a: "1.2.1", b: "1.2.2", cls: "credit", kind: "flow", count: 3,
      perAsset: { "1.3.0": { value: "7500000" } }, firstSeen: "2026-01-01T00:00:00", lastSeen: "2026-06-01T00:00:00" },
    names: { "1.2.1": "alice", "1.2.2": "bob" }, assets: { "1.3.0": { sym: "BTS", prec: 5 } }
  });
  ok(/alice/.test(d) && /bob/.test(d), "detail names both ends");
  ok(/0\.075 BTS/.test(d), "detail renders the raw amount in human terms (" + d + ")");
  ok(/3/.test(d), "detail states the op count");
  ok(/flow/i.test(d), "detail states flow vs relation");
})();

// 5. multi-asset edges: top asset + "+N more", never a cross-asset sum
(function () {
  const d = T.detailText({
    edge: { a: "1.2.1", b: "1.2.2", cls: "transfer", kind: "flow", count: 5,
      perAsset: { "1.3.0": { value: "100000000" }, "1.3.113": { value: "500" }, "1.3.121": { value: "7" } },
      firstSeen: null, lastSeen: null },
    names: {}, assets: { "1.3.0": { sym: "BTS", prec: 5 }, "1.3.113": { sym: "CNY", prec: 4 }, "1.3.121": { sym: "USD", prec: 3 } }
  });
  ok(/10 BTS/.test(d), "largest asset rendered in human terms");
  ok(/\+2 more/i.test(d), "remaining assets counted, not summed (" + d + ")");
})();

// 6. table twin rows carry from / to / class / kind / count
(function () {
  const rows = T.twinRows({ nodes: [{ assetId: "1.2.1", sym: "alice" }],
    edges: [{ a: "1.2.1", b: "1.2.2", poolId: "k", cls: "transfer", kind: "flow", count: 2, perAsset: {}, firstSeen: null, lastSeen: null }] },
    { "1.2.2": "bob" }, {});
  eq(rows.length, 1, "one twin row per edge");
  eq(rows[0].cells.length >= 5, true, "twin row has from/to/class/kind/count columns");
});

// 7. hash round-trip: seeds + classes survive and are parsed back
(function () {
  const url = T.hashFor(["alice", "bob"], ["transfer"]);
  ok(url.indexOf("seeds=alice%2Cbob") !== -1 || url.indexOf("seeds=alice,bob") !== -1, "seeds encoded in the hash (" + url + ")");
  const q = T.parseHash("#/account-network?seeds=alice,bob&classes=transfer");
  eq(q.seeds, ["alice", "bob"], "hash seeds parse back");
  eq(q.classes, ["transfer"], "hash classes parse back");
  eq(T.parseHash("#/account-network"), { seeds: [], classes: [] }, "empty hash is empty, never throws");
})();

// 8. the ES-off state says so and never invents data
(function () {
  const s = T.esErrorText("es-disabled");
  ok(/index/i.test(s), "ES-off copy names the index (" + s + ")");
  ok(/settings/i.test(s), "ES-off copy points at Settings");
  ok(!/0 candles|No transfers/i.test(s), "no fabricated zero-state copy");
});
console.log("account-network-ui: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tooling/account-network-ui-test.js`
Expected: FAIL — `Cannot find module .../account-network-ui.js`.

- [ ] **Step 3: Write the implementation**

Create `vanilla/js/views/account-network-ui.js` with this structure (module
header in the repo's house style — owns / consumes / globals / created-by /
money discipline — IIFE, `globalThis.AccountNetworkUI` guard, `module.exports`):

```js
/* AccountNetworkUI: the #/account-network page (accounts-as-nodes graph).
 * Owns: the page shell — seed input + go button, the op-class chips, the
 *   status + detail lines, the <details> table twin — and the mount of the
 *   shared network canvas in account mode. No chain reads and no graph math
 *   here: AccountNet gathers, PoolNetUI draws. Data only — this page never
 *   builds or signs anything.
 * Consumes: AccountNet (gather/CLASSES/enabled), PoolNetUI.mount,
 *   Account.resolve (inside AccountNet), Asset.describe + Format (human
 *   strings at render), TableRenderer, DOM.*, Router.query, I18n.t,
 *   localStorage (recent seeds).
 * Side effects: one ES scan + chain reads per draw (lazy, on the user's go),
 *   a canvas rAF loop owned by PoolNetUI, resize/visibility listeners through
 *   _cleanups. Global AccountNetworkUI.
 * Created by: account-network spec (docs/superpowers/specs/
 *   2026-10-09-account-network-design.md). */
var AccountNetworkUI = (function () {
  "use strict";

  var _cleanups = [];
  var _gen = 0;
  var SEEDS_KEY = "accountNet.seeds.v1";

  function t(key, dflt, vars) { /* repo-standard I18n.t wrapper */ }

  function parseSeeds(raw) {
    return String(raw === undefined || raw === null ? "" : raw)
      .split(/[\s,;]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; })
      .filter(function (s, i, a) { return a.indexOf(s) === i; })
      .slice(0, AccountNet.MAX_SEEDS);
  }
  function chipModel() {
    return Object.keys(AccountNet.CLASSES).map(function (id) {
      var c = AccountNet.CLASSES[id];
      return { id: id, kind: c.kind,
        label: t("account_net.class_" + id, id),
        on: AccountNet.DEFAULT_CLASSES.indexOf(id) !== -1 };
    });
  }
  function parseHash(hash) {
    var out = { seeds: [], classes: [] };
    var s = String(hash || "");
    var qi = s.indexOf("?");
    if (qi === -1) return out;
    var parts = s.slice(qi + 1).split("&");
    parts.forEach(function (p) {
      var eqi = p.indexOf("=");
      if (eqi === -1) return;
      var k = decodeURIComponent(p.slice(0, eqi));
      var v = decodeURIComponent(p.slice(eqi + 1));
      if (k === "seeds") out.seeds = parseSeeds(v);
      else if (k === "classes") out.classes = v.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    });
    return out;
  }
  function hashFor(seeds, classes) {
    return "#/account-network?seeds=" + encodeURIComponent((seeds || []).join(",")) +
      "&classes=" + encodeURIComponent((classes || []).join(","));
  }
  /* The four builders below are PURE: every user-visible sentence on this
   * page lives in one of them, so the i18n drift gate can check it and the
   * vectors can pin the honesty wording. Money is formatted HERE and only
   * here (Format.formatAmount on the raw string with that asset's precision).
   * res = {seeds, unknown, stats}; stats.caps = {nodeCapHit, edgeCapHit}. */

  function assetLabel(assetId, assets) {
    var a = assets && assets[assetId];
    var sym = (a && a.sym) ? a.sym : assetId;
    return { sym: sym, prec: (a && typeof a.prec === "number") ? a.prec : 0 };
  }
  function humanAmount(raw, assetId, assets) {
    var lab = assetLabel(assetId, assets);
    var out = "";
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function") {
        out = Format.formatAmount(raw, lab.prec) + " " + lab.sym;
      } else out = raw + " " + lab.sym;
    } catch (e) { out = String(raw) + " " + lab.sym; }
    return out;
  }
  /* Top asset by raw magnitude + "+N more" for the rest. NEVER a cross-asset
   * sum (different assets are not comparable quantities). */
  function amountsText(perAsset, assets) {
    var ids = Object.keys(perAsset || {});
    if (!ids.length) return t("account_net.no_amount", "no amount");
    var best = ids[0], bestLen = -1;
    ids.forEach(function (id) {
      var v = perAsset[id].value, len = String(v).replace(/^0+/, "").length;
      if (len > bestLen) { bestLen = len; best = id; }
    });
    var more = ids.length - 1;
    var head = humanAmount(perAsset[best].value, best, assets);
    return more > 0 ? head + t("account_net.more_assets", " + %(n)d more", { n: more }) : head;
  }
  function statusText(res) {
    var st = (res && res.stats) || {};
    var seeds = (res && res.seeds) || [], unknown = (res && res.unknown) || [];
    var bits = [];
    bits.push(t("account_net.status_scanned",
      "%(scanned)s indexed operations from %(n)s account(s)",
      { scanned: String(st.scanned || 0), n: String(seeds.length) }));
    bits.push(t("account_net.status_graph", "%(nodes)s accounts · %(edges)s lines",
      { nodes: String(st.nodes || 0), edges: String(st.edges || 0) }));
    if (st.truncated) bits.push(t("account_net.status_truncated",
      "newest %(n)s operations per account", { n: String(AccountNet.SCAN_CAP) }));
    if (st.caps && st.caps.nodeCapHit) bits.push(t("account_net.status_node_cap",
      "top %(n)s counterparties shown", { n: String(AccountNet.NODE_CAP) }));
    if (st.caps && st.caps.edgeCapHit) bits.push(t("account_net.status_edge_cap",
      "top %(n)s lines shown", { n: String(AccountNet.EDGE_CAP) }));
    if (st.droppedSelf) bits.push(t("account_net.status_self", "%(n)s self-transfers skipped", { n: String(st.droppedSelf) }));
    if (st.droppedShape) bits.push(t("account_net.status_shape", "%(n)s unreadable entries skipped", { n: String(st.droppedShape) }));
    if (st.missingCredit) bits.push(t("account_net.status_credit_missing",
      "%(n)s credit lines skipped (offer or deal not found on chain)", { n: String(st.missingCredit) }));
    if (unknown.length) bits.push(t("account_net.status_unknown", "not found: %(names)s",
      { names: unknown.join(", ") }));
    return bits.join(" · ");
  }
  function detailText(arg) {
    var e = (arg && arg.edge) || null;
    if (!e) return t("account_net.detail_hint", "Tap a line for its detail; tap an account to open it.");
    var names = (arg && arg.names) || {}, assets = (arg && arg.assets) || {};
    var an = names[e.a] || e.a, bn = names[e.b] || e.b;
    var kindWord = t(e.kind === "relation" ? "account_net.kind_relation" : "account_net.kind_flow",
      e.kind === "relation" ? "relation" : "flow");
    return t("account_net.detail_line",
      "%(from)s → %(to)s · %(amount)s · %(count)s ops · %(kind)s",
      { from: an, to: bn, amount: amountsText(e.perAsset, assets),
        count: String(e.count || 0), kind: kindWord });
  }
  function twinRows(graph, names, assets) {
    var out = [];
    var g = graph || {};
    (g.edges || []).forEach(function (e) {
      out.push({ key: e.poolId, cells: [
        (names[e.a] || e.a), (names[e.b] || e.b),
        t("account_net.class_" + e.cls, e.cls),
        t(e.kind === "relation" ? "account_net.kind_relation" : "account_net.kind_flow", e.kind),
        amountsText(e.perAsset, assets),
        String(e.count || 0),
        (e.firstSeen || "—") + " → " + (e.lastSeen || "—")
      ] });
    });
    return out;
  }
  function esErrorText(code) {
    var c = String(code || "");
    if (/disabled/i.test(c)) return t("account_net.es_disabled",
      "The community index is switched off. Turn it on in Settings to draw this map.");
    if (/bad-account/i.test(c)) return t("account_net.es_bad_account",
      "That name is not an account on this chain.");
    return t("account_net.es_unavailable",
      "The community index is not reachable right now. Try again in a moment.");
  }

  /* renderAccountNetwork(root): build the shell, mount the canvas, wire go /
   * chips / hash. Returns nothing; never throws. */
  function renderAccountNetwork(root) { /* per the layout contract */ }

  return { renderAccountNetwork: renderAccountNetwork,
    _test: { parseSeeds: parseSeeds, chipModel: chipModel, parseHash: parseHash,
      hashFor: hashFor, statusText: statusText, detailText: detailText,
      twinRows: twinRows, esErrorText: esErrorText } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNetworkUI === "undefined") { globalThis.AccountNetworkUI = AccountNetworkUI; }
if (typeof module !== "undefined") { module.exports = AccountNetworkUI; }
```

Then `app.css` gets one small block (no new theme tokens — the chips reuse
`--border/--text/--muted/--accent`):

```css
/* Account-network page: seeds, class chips, detail line, table twin. */
#an-seeds { width: 100%; max-width: 520px; min-height: 44px; }
.an-go { min-height: 44px; }
#an-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.an-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 44px;
  padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.an-chip input { width: 18px; height: 18px; }
.an-detail { min-height: 24px; margin: 8px 0; color: var(--text); }
.an-twin table { width: 100%; }
@media (max-width: 640px) { .an-twin { overflow-x: auto; } #an-chips { gap: 6px; } }
```

The page body then:

1. reads `parseHash(location.hash)`; falls back to the saved seeds.
2. paints chips from `chipModel()`; each chip writes `localStorage` + the hash.
3. on go: `AccountNet.gather(seeds, classes, {onSeed: paint})`, then
   `PoolNetUI.mount(doc, graphHost, getter, { mode: "account", graph,
     navNode: (hit) => "#/account/" + name, navEdge: (hit) => { select(hit); return null; } })`
   and sets `S.paint.arrows = true` / `S.paint.edgeClassOf = (e) => classToken(e.cls)`
   (transfer → `accent`, credit → `buy`, override → `muted`, debit → `warn`,
   htlc → `sell`, vesting → `muted`).
4. paints the status line, the detail line, and the table twin through
   `TableRenderer.render({columns, rows, keyExtractor})`.
5. registers every listener/timer in `_cleanups` and guards async callbacks
   with a `gen` counter.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tooling/account-network-ui-test.js` → 0 fail, and
`bash tooling/check_types.sh` → PASS.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/views/account-network-ui.js tooling/account-network-ui-test.js
git commit -m "feat(account-network): page shell, class chips, status/detail, table twin"
```

---

### Task 6: Wire route, sitemap card, account-page seed button, i18n

**Files:**
- Modify: `vanilla/js/router.js` (route + `ROUTE_META`), `vanilla/js/views/menu-ui.js` (Labs card), `vanilla/js/views/account-ui.js` (seed button), `vanilla/index.html` (script tags)
- Create: `tooling/add_account_net_i18n.py`
- Test: `tooling/menu-test.js` (counts), plus the i18n/types/rot gates

**Interfaces:**
- Consumes: `AccountNetworkUI.renderAccountNetwork`, `AccountNet`.
- Produces: routable `#/account-network`; Labs section grows 3 → 4 links;
  `all.length` 52 → 53 in `tooling/menu-test.js`.

- [ ] **Step 1: Write the failing test (the two count assertions)**

In `tooling/menu-test.js`, change the two pinned counts and add the href:

```js
eq(all.length, 53, "53 listed pages");
...
eq(MenuUI._test.findSection("labs").links.length, 4, "labs holds api-lab, es-lab, txbuilder + account-network");
ok(all.indexOf("#/account-network") !== -1, "#/account-network listed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tooling/menu-test.js`
Expected: FAIL on `53 listed pages` (still 52).

- [ ] **Step 3: Make the changes**

`menu-ui.js` — append inside the `labs` `links` array:

```js
        { href: "#/account-network", icon: "share-alt", titleKey: "menu.p_account_net",
          titleDefault: "Account Network", blurbKey: "menu.d_account_net",
          blurbDefault: "transfer tracking" },
```

`router.js` — route next to `/es-lab`, and a `ROUTE_META` entry (title ≤60
chars, description ≤155):

```js
    { path: "/account-network", title: "Account Network", render: function (root) {
        if (typeof AccountNetworkUI !== "undefined" && AccountNetworkUI && typeof AccountNetworkUI.renderAccountNetwork === "function") { AccountNetworkUI.renderAccountNetwork(root); return; }
        placeholder("Account Network")(root);
    } },
```
```js
    "/account-network": { titleKey: "seo.title_account_net", title: "Account Network — BitShares Wallet", descKey: "seo.desc_account_net", description: "Map who an account sends to, lends to and borrows from — read from the community index. No login needed." },
```

`account-ui.js` — one "Draw network" button beside the account heading that
navigates to `AccountNetworkUI` hash built from `hashFor([acct.name], [])`.

`index.html` — two script tags after the pool-net block, sharing the file's
cache-bust token:
`<script src="js/api/account-net.js?v=<token>"></script>` and
`<script src="js/views/account-network-ui.js?v=<token>"></script>`.

`tooling/add_account_net_i18n.py` — write every key the new view uses into all
12 dicts and their `_meta.translated` inventories, following
`tooling/add_deep_window_i18n.py` exactly (idempotent, sorted inventory,
`ensure_ascii=False`, trailing newline). Keys: `account_net.*` (title, intro,
seeds_label, go, chip labels per class, status/summary/detail/twin strings,
es_disabled, es_unavailable, scan_truncated, node_cap, edge_cap,
missing_credit, unknown_seed, kind_flow, kind_relation, twin_summary),
`menu.p_account_net`, `menu.d_account_net`, `seo.title_account_net`,
`seo.desc_account_net`.

- [ ] **Step 4: Run the gates**

Run: `node tooling/menu-test.js` → 0 fail ·
`python3 tooling/add_account_net_i18n.py` → 12 updated ·
`python3 tooling/check_i18n.py` → OK · `bash tooling/check_types.sh` → PASS ·
`python3 tooling/check_rot.py` → PASSED.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/router.js vanilla/js/views/menu-ui.js vanilla/js/views/account-ui.js \
        vanilla/index.html vanilla/locales tooling/add_account_net_i18n.py tooling/menu-test.js
git commit -m "feat(account-network): route, Labs sitemap card, seed button, i18n"
```

---

### Task 7: Live verification, parity note, audit

**Files:**
- Create: `docs/parity/account-network.md`
- Test: `tooling/visual/` probe (dev-only, never shipped) + the full suite

- [ ] **Step 1: Run the full suite**

```bash
for t in account-net account-net-paint account-network-ui account-fills-test pool-history-test; do node tooling/$t.js; done
node tooling/menu-test.js; node tooling/pool-net-ui-test.js; node tooling/pool-graph-test.js
bash tooling/check_types.sh; python3 tooling/check_i18n.py; python3 tooling/check_rot.py
```

Expected: every suite 0 fail; all three gates green.

- [ ] **Step 2: Live proof (headless Chromium against mainnet)**

Serve `python3 -m http.server 8081 --directory vanilla`, then with
`tooling/visual/shot.mjs`'s Playwright setup drive `#/account-network`:

- Seed a normal account (`committee-account`) and a second one in the same
  draw; screenshot 1440px and 360px in all three themes.
- Record: ES calls per seed, hit counts, payload, elapsed ms, node/edge counts,
  the status line verbatim, and any truncation/skip counters.
- Assert the perf guard: a single seed completes ≤3 s and ≤2 MB
  (measured baseline: committee-account transfer+credit = 2 075 hits / 1.79 MB /
  2.5 s), and no query ever carries more ops than the enabled classes.
- Tap a node → lands on `#/account/:name`; tap an edge → the detail line fills
  and the hash does NOT change.
- Toggle a chip → the scan re-runs and the edge set changes accordingly.

- [ ] **Step 3: Write the parity note**

`docs/parity/account-network.md` with: reference behavior (the ES Lab field
refs + this page's own probes), the op-numbering hazard, dedupe rule, every cap
and its disclosure, the live numbers from Step 2, the theme/viewport trio,
vectors (§6 human-terms table incl. a non-BTS precision and a multi-asset
edge), the §4.5 gate answers (a)/(b)/(c), and the audit checklist results.

- [ ] **Step 4: Run the audit skill and record the result**

Load `skills/auditing-vanilla-slices/SKILL.md` and apply its checklist
(displayed numbers traced to raw source, human-terms vectors, themes,
viewports, readability, no dead text). Fix anything it fails, re-run the
suites, and note the outcome in the parity note.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(parity): account network audit record + live proof"
```
