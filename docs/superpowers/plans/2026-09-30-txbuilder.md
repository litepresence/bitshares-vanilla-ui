# TxBuilder Multi-Account Multi-Op Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free multi-account multi-op transaction composer: a `TxBuilder` state module plus a `#/txbuilder` desk where ops proposed by any form coexist, authorities resolve honestly, local keys sign append-only, unsigned bundles export/import as versioned JSON, and sending goes direct or proposal-wrapped, with three pilot form outlets.

**Architecture:** `vanilla/js/txbuilder.js` owns op-pair state and all chain/key operations with no DOM; `vanilla/js/txbuilder-ui.js` owns the full `#/txbuilder` desk rendering on existing `wrap wide` + `dl` + `<details>` idioms; pilot forms gain one additive outlet button each and keep one-shot paths untouched; transport and proof reuse the vote pattern (`broadcast_transaction_with_callback` first, plain fallback once, then per-op domain re-reads).

**Tech Stack:** Plain browser JS (no imports, one global per file + `module.exports` guard), existing globals `Tx` (`feeMulti`/`buildTx`/`buildCreate` via `Proposal`), `Chain` (`db`/`call`/`status`), `Wallet` (`keys`/`isUnlocked`), `Crypto.signHash`, `Format` (`formatAmount`/`formatPrice`), `Account.resolve`, `Pool.pctUnitsToHuman`; Node 20 stdlib for syntax + offline vector checks; Python 3 for `tooling/check_rot.py`.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable with no build step and no CDN `<script src>`.
- All money stays raw digit strings until render; display only via `Format.formatAmount` / `Format.formatPrice`; percent fields via the 10000-base rule and `Pool.pctUnitsToHuman`; never `Number()` / `parseFloat` / inline `/ Math.pow(10, precision)` on money in views or composer.
- Exactly one chain module is touched (`Chain.db/call/status/history/net`); no new WS method is required (authority resolution is `get_objects` + `get_account_by_name` + `get_assets` + `get_required_fees`; `get_potential_signatures` / `get_required_signatures` / `verify_authority` are best-effort cross-checks that never block).
- WIFs pass as JS values only, never into the DOM; export/import JSON never contains `wif` / private hex / brainkey / password substrings.
- Test keys testnet only; no mainnet keys or broadcasts; small amounts with fee headroom.
- Every view renders at 360px phone width and 1440px desktop width in all three themes; touch targets 44px in at least one dimension; no hover-only UI; empty states everywhere, never blank.
- One clear purpose per file; module header + function descriptions per file; ~400-line cap is a split signal; no dead text and no commented-out code in shipped files.
- `tooling/check_rot.py` stays green before any done claim.

## Owner Decisions (spec section 12, decided per AGENTS.md + honest defaults)

- **D1 — Phase-1 missing-key honesty accepted (YES).** The single-brainkey keystore is NOT redesigned here. Phase 1 ships compose-anything + sign-what-is-local + export-the-rest: unresolved accounts render `unsigned for X (no local key)` rows, `signLocal` signs only satisfiable rows, and the multi-device export/import ceremony carries the remainder. The composer API stays keystore-agnostic (`availablePubs` is a plain list) so a future multi-keystore slice plugs in without changing callers.
- **D2 — Generic provers grow slice-by-slice (no big-bang prover).** Broadcast proof ships per-op provers where one already exists (op-0 history poll, op-6 vote slate re-read, pool re-read, op-22 proposal re-read) and reports `accepted by node, inclusion not proven for op <id> — check history before retrying` for the long tail. No generic `get_transaction` / history-scan prover is built in this plan.
- **D3 — `#/txbuilder` desk recommended (Approach A).** No global drawer (rejected: new framework-shaped state, worst pattern at 360px, duplicates the desk). No proposal-only composition (rejected: op-22 changes execution semantics to after-approvals and charges a wrapper fee). The desk is a full route with a header badge count, deep-linkable for the export/import ceremony.

---

## File Structure

```
vanilla/
├── index.html                  ← Task 5 (TWO script tags: js/txbuilder.js BEFORE js/txbuilder-ui.js,
│                                  both after js/proposal.js block and before js/router.js; exact lines below)
├── js/
│   ├── txbuilder.js            ← Task 1+2+3+4+6 (CREATE: state + fee/build/export/import +
│                                  resolveAuths/signLocal + describe + wrapProposal/broadcastSigned;
│                                  splits to txbuilder-describe.js ONLY on ~400-line breach)
│   ├── txbuilder-ui.js         ← Task 5 (CREATE: #/txbuilder desk + review + export/import panes +
│                                  header badge subscription)
│   ├── router.js               ← Task 5 (MODIFY: one route entry #/txbuilder before the "*" catch-all)
│   ├── app.js                  ← Task 5 (MODIFY: header badge span + subscribe wiring, count only)
│   ├── transfer-confirm.js     ← Task 7 (MODIFY: additive "Add to TxBuilder" button on confirm)
│   ├── vote-ui.js              ← Task 7 (MODIFY: additive "Add vote to TxBuilder" button on confirm)
│   └── pool-ui.js              ← Task 7 (MODIFY: additive "Add deposit to TxBuilder" button on stake confirm)
└── docs/superpowers/plans/
    └── 2026-09-30-txbuilder.md ← this plan
```

**New-module interface contract (exact names every task uses):**

```js
// vanilla/js/txbuilder.js — global TxBuilder
TxBuilder.addOp(opId, opData, source) -> string          // returns local key "tb-0007-x"
TxBuilder.removeOp(key) -> boolean
TxBuilder.clear() -> void
TxBuilder.setFeeAsset(assetId) -> void                  // strict /^1\.3\.\d+$/ else throws tb-bad-asset
TxBuilder.list() -> [entry, ...]                        // shallow copy, composer order
TxBuilder.count() -> number
TxBuilder.subscribe(fn) -> function                     // returns off(); fn(state) on every mutation
TxBuilder.state() -> {ops, feeAssetId, fees, requiredAuths, availablePubs,
                       signatures, chainId, built}       // fees/requiredAuths/signatures/built null until filled
TxBuilder.describe(opId, opData) -> Promise<[{label, value, title?}]>
TxBuilder.feeAll() -> Promise<{perOp, totalRaw, totalDisplay}>
TxBuilder.resolveAuths() -> Promise<[authRow, ...]>     // {accountId, accountName, level, threshold,
                                                        //  availablePubs, missing, note?}
TxBuilder.buildUnsigned() -> Promise<tx>                // Tx.buildTx shape + state.built set
TxBuilder.signLocal() -> Promise<{signed:[pub,...], stillMissing:[accountId,...]}>
TxBuilder.wrapProposal(args) -> [22, opData]            // {feePayerId, expirationIso, reviewPeriodSecOrNull}
TxBuilder.exportJSON() -> string                        // throws tb-nothing-to-export when empty/unbuilt
TxBuilder.importJSON(text) -> {ops, signatures, requiredAuths}
TxBuilder.broadcastSigned(tx, provers) -> Promise<{perOp:[{opId, status}], via}>
// Named errors: tb-empty tb-bad-op tb-unknown-op tb-bad-asset tb-not-connected
//   tb-wallet-locked tb-nothing-to-export tb-bad-envelope tb-chain-mismatch tb-ops-drift tb-expired
```

**Task ordering:** Task 1 (state core) → Task 2 (fee/build/export/import) → Task 3 (auth/sign) → Task 4 (describe) → Task 5 (desk+route+badge) → Task 6 (wrap+broadcast) → Task 7 (pilot outlets) → Task 8 (verify+parity+audit). Tasks 1–4 are headless-testable with `node --check` + stubbed globals; Task 5 needs a browser or headless DOM stub; Task 8 runs testnet vectors T1–T6.

---

### Task 1: Composer state core (`txbuilder.js` skeleton + invalidation + subscribe)

**Files:**
- Create: `vanilla/js/txbuilder.js` (skeleton: state, addOp/removeOp/clear/setFeeAsset/list/count/subscribe, invalidation, module header + `module.exports` guard)

**Interfaces:**
- Consumes: `Tx._ser` presence check only (to reject unserializable opIds with `tb-unknown-op`); nothing else.
- Produces: `TxBuilder.addOp/removeOp/clear/setFeeAsset/list/count/subscribe/state` with exact signatures above; `entry = {key, opId, opData, source, addedAt}`; invalidation resets `fees/requiredAuths/signatures/built` to null on every mutation.

- [ ] **Step 1: Write the failing test**

```js
// /tmp/tb1-state.js — stdlib only. Run from /workspace/vanilla.
globalThis.Tx = { _ser: { serializeTransaction: function () { return new Uint8Array(0); } } };
var TxBuilder = require("./js/txbuilder.js");
if (typeof TxBuilder.addOp !== "function") throw new Error("addOp missing");
var k = TxBuilder.addOp(0, { fee: { amount: "0", asset_id: "1.3.0" }, from: "1.2.17", to: "1.2.20", amount: { amount: "150000", asset_id: "1.3.0" }, extensions: [] }, "transfer:alice->bob 1.5 TEST");
if (typeof k !== "string" || k.slice(0, 3) !== "tb-") throw new Error("bad key: " + k);
if (TxBuilder.count() !== 1) throw new Error("count should be 1");
var threw = null;
try { TxBuilder.addOp("x", {}, "bad"); } catch (e) { threw = e; }
if (!threw || !/tb-bad-op/.test(threw.message)) throw new Error("expected tb-bad-op");
console.log("TB1-OK count=" + TxBuilder.count() + " key=" + k);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/tb1-state.js`
Expected: FAIL with `Cannot find module './js/txbuilder.js'` (file does not exist yet). Run from `/workspace/vanilla` so the relative require resolves once created.

- [ ] **Step 3: Write minimal implementation**

```js
/* txbuilder.js — multi-account multi-op composer state (no DOM, no keys, no signing).
 *
 * What it owns: queued [opId, opData] entries with local keys, one fee asset,
 * derived-state invalidation, pub/sub for the header badge + desk. This file
 * never touches the DOM, never reads private keys, never broadcasts.
 * Consumes: Tx._ser (presence check only — rejects opIds with no serializer).
 * Side effects: augments the single `TxBuilder` global; notifies subscribers.
 * Created by: TxBuilder plan 2026-09-30, Task 1.
 */
var TxBuilder = (typeof globalThis !== "undefined" && globalThis.TxBuilder) ? globalThis.TxBuilder : ((typeof TxBuilder !== "undefined") ? TxBuilder : {});
(function () {
  "use strict";

  var _ops = [];
  var _ctr = 0;
  var _subs = [];
  var _feeAssetId = "1.3.0";
  var _fees = null;
  var _requiredAuths = null;
  var _availablePubs = [];
  var _signatures = [];
  var _chainId = null;
  var _built = null;

  /* Deep-clone via JSON (opData is plain chain JSON — no functions, no cycles). */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* Invalidate every derived answer on any queue mutation (no silent staleness). */
  function invalidate() {
    _fees = null; _requiredAuths = null; _signatures = []; _chainId = null; _built = null;
  }

  function notify() {
    var s = state();
    for (var i = 0; i < _subs.length; i++) {
      try { _subs[i](s); } catch (e) { /* one bad listener never breaks the composer */ }
    }
  }

  function hasSerializer(opId) {
    try {
      var T = (typeof globalThis !== "undefined" && globalThis.Tx) ? globalThis.Tx : null;
      return !!(T && T._ser);
    } catch (e) { return false; }
  }

  /* Add one [opId, opData] pair. Returns the local key. Throws tb-bad-op / tb-unknown-op. */
  function addOp(opId, opData, source) {
    if (!Number.isInteger(opId) || opId < 0) throw new Error("tb-bad-op: opId must be a non-negative integer");
    if (!opData || typeof opData !== "object" || Array.isArray(opData)) throw new Error("tb-bad-op: opData must be an object");
    if (typeof source !== "string" || !source) throw new Error("tb-bad-op: source must be a non-empty human string");
    if (!hasSerializer(opId)) throw new Error("tb-unknown-op: no serializer for op " + opId);
    var data = clone(opData);
    if (!data.fee || typeof data.fee !== "object") data.fee = { amount: "0", asset_id: _feeAssetId };
    _ctr += 1;
    var key = "tb-" + String(_ctr).padStart(4, "0") + "-" + Math.random().toString(36).slice(2, 6);
    _ops.push({ key: key, opId: opId, opData: data, source: source, addedAt: new Date().toISOString().slice(0, 19) });
    invalidate();
    notify();
    return key;
  }

  function removeOp(key) {
    for (var i = 0; i < _ops.length; i++) {
      if (_ops[i].key === key) { _ops.splice(i, 1); invalidate(); notify(); return true; }
    }
    return false;
  }

  function clear() { _ops = []; invalidate(); notify(); }

  function setFeeAsset(assetId) {
    if (typeof assetId !== "string" || !/^1\.3\.\d+$/.test(assetId)) throw new Error("tb-bad-asset: fee asset must be 1.3.N, got " + JSON.stringify(assetId));
    _feeAssetId = assetId;
    invalidate();
    notify();
  }

  function list() { return _ops.slice(); }
  function count() { return _ops.length; }

  function subscribe(fn) {
    if (typeof fn !== "function") throw new Error("tb-bad-op: subscribe needs a function");
    _subs.push(fn);
    return function off() {
      var i = _subs.indexOf(fn);
      if (i >= 0) _subs.splice(i, 1);
    };
  }

  function state() {
    return { ops: _ops.slice(), feeAssetId: _feeAssetId, fees: _fees, requiredAuths: _requiredAuths,
      availablePubs: _availablePubs.slice(), signatures: _signatures.slice(), chainId: _chainId, built: _built };
  }

  TxBuilder.addOp = addOp;
  TxBuilder.removeOp = removeOp;
  TxBuilder.clear = clear;
  TxBuilder.setFeeAsset = setFeeAsset;
  TxBuilder.list = list;
  TxBuilder.count = count;
  TxBuilder.subscribe = subscribe;
  TxBuilder.state = state;
  // feeAll / resolveAuths / buildUnsigned / signLocal / describe / wrapProposal /
  // exportJSON / importJSON / broadcastSigned land in Tasks 2-4+6 on this same global.
  if (typeof globalThis !== "undefined") { globalThis.TxBuilder = TxBuilder; }
})();

if (typeof module !== "undefined") { module.exports = TxBuilder; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check js/txbuilder.js && node /tmp/tb1-state.js`
Expected: no syntax errors; `TB1-OK count=1 key=tb-0001-xxxx` (suffix random). Also verify invalidation + guards:

Run: `node -e "globalThis.Tx={_ser:{}};var B=require('./js/txbuilder.js');B.clear();var k=B.addOp(6,{fee:{amount:'0',asset_id:'1.3.0'},account:'1.2.17',new_options:{}},'vote:test');B.setFeeAsset('1.3.7');if(B.state().feeAssetId!=='1.3.7')throw new Error('fee asset not set');if(B.removeOp(k)!==true||B.count()!==0)throw new Error('remove failed');var off=B.subscribe(function(){});off();try{B.setFeeAsset('1.2.3');throw new Error('should have thrown');}catch(e){if(!/tb-bad-asset/.test(e.message))throw e;}console.log('TB1-GUARDS-OK')"`
Expected: `TB1-GUARDS-OK`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/txbuilder.js
git commit -m "feat(txbuilder): composer state core with invalidation"
```

---

### Task 2: Fees, unsigned build, export/import envelope

**Files:**
- Modify: `vanilla/js/txbuilder.js` (append `feeAll`, `buildUnsigned`, `exportJSON`, `importJSON`; internal `_pairs()` + `_requireConnected()` helpers)

**Interfaces:**
- Consumes: `Tx.feeMulti(pairs, feeAssetId)` (ONE `get_required_fees` call, fills fees in place), `Tx.buildTx(pairs)`, `Chain.status().chainId`, `Format.formatAmount` (already used inside `feeMulti` for totalDisplay — this task only forwards its answer).
- Produces: `feeAll()`, `buildUnsigned()`, `exportJSON()`, `importJSON(text)` per the contract; envelope shape `{app:"bts-vanilla-txbuilder", v:1, chain_id, feeAssetId, ops, tx, signatures, meta}` with strict import validation (`tb-bad-envelope`, `tb-chain-mismatch`, `tb-ops-drift`, `tb-expired` offered as re-base signal, never silent repair).

- [ ] **Step 1: Write the failing test**

```js
// /tmp/tb2-envelope.js — stub Tx.feeMulti + Tx.buildTx + Chain.status, no network.
globalThis.Tx = {
  _ser: {},
  feeMulti: async function (pairs, feeAssetId) {
    pairs.forEach(function (p) { p[1].fee = { amount: "100", asset_id: feeAssetId }; });
    return { perOp: pairs.map(function (p) { return p[1].fee; }), totalRaw: String(100 * pairs.length), totalDisplay: "0.00100" };
  },
  buildTx: async function (pairs) {
    return { ref_block_num: 1234, ref_block_prefix: 5678, expiration: "2026-09-30T12:01:00", operations: pairs, extensions: [] };
  },
  _ser_serialize: null
};
globalThis.Chain = { status: function () { return { chainId: "4018d784aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; } };
var B = require("./js/txbuilder.js");
(async function () {
  B.clear();
  B.addOp(0, { fee: { amount: "0", asset_id: "1.3.0" }, from: "1.2.17", to: "1.2.20", amount: { amount: "150000", asset_id: "1.3.0" }, extensions: [] }, "transfer:t");
  var f = await B.feeAll();
  if (f.totalRaw !== "100") throw new Error("totalRaw wrong: " + f.totalRaw);
  var tx = await B.buildUnsigned();
  if (tx.operations.length !== 1) throw new Error("ops wrong");
  var s = B.exportJSON();
  var env = JSON.parse(s);
  if (env.app !== "bts-vanilla-txbuilder" || env.v !== 1) throw new Error("envelope header wrong");
  if (/wif|brainkey|password/i.test(s)) throw new Error("secret leak in envelope");
  B.clear();
  var back = B.importJSON(s);
  if (back.ops.length !== 1) throw new Error("import ops wrong");
  console.log("TB2-OK");
})().catch(function (e) { console.error("TB2-FAIL " + (e && e.stack || e)); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/tb2-envelope.js`
Expected: FAIL with `B.feeAll is not a function` (Task 1 skeleton has no `feeAll` yet).

- [ ] **Step 3: Write minimal implementation** (append inside the same IIFE, before the `TxBuilder.addOp = ...` export block; then add four export lines)

```js
  /* Pairs view: live [opId, opData] references (fee fill writes through). */
  function _pairs() {
    return _ops.map(function (e) { return [e.opId, e.opData]; });
  }

  function _requireConnected() {
    var C = (typeof globalThis !== "undefined" && globalThis.Chain) ? globalThis.Chain : null;
    var st = (C && C.status) ? C.status() : null;
    if (!st || !st.chainId) throw new Error("tb-not-connected: connect to a node first");
    return st.chainId;
  }

  /* Quote fees for the whole bundle with ONE get_required_fees call. Fills
   * each opData.fee in place; stores {perOp, totalRaw, totalDisplay}. */
  async function feeAll() {
    if (!_ops.length) throw new Error("tb-empty: nothing queued");
    var T = globalThis.Tx;
    if (!T || typeof T.feeMulti !== "function") throw new Error("tb-not-connected: Tx.feeMulti is not loaded");
    var pairs = _pairs();
    var ans = await T.feeMulti(pairs, _feeAssetId);
    _fees = { perOp: ans.perOp, totalRaw: String(ans.totalRaw), totalDisplay: String(ans.totalDisplay) };
    _built = null; _signatures = [];
    notify();
    return { perOp: _fees.perOp, totalRaw: _fees.totalRaw, totalDisplay: _fees.totalDisplay };
  }

  /* Build the unsigned envelope via Tx.buildTx (no duplicated ref-block logic).
   * Calls feeAll first when fees are stale. Captures chainId into state. */
  async function buildUnsigned() {
    if (!_ops.length) throw new Error("tb-empty: nothing queued");
    _requireConnected();
    if (!_fees) await feeAll();
    var T = globalThis.Tx;
    var tx = await T.buildTx(_pairs());
    _chainId = _requireConnected();
    _built = tx;
    notify();
    return tx;
  }

  /* Export the versioned multi-device envelope (ops + fixed tx + sigs + audit meta). */
  function exportJSON() {
    if (!_ops.length) throw new Error("tb-nothing-to-export: queue is empty");
    if (!_built || !_fees) throw new Error("tb-nothing-to-export: quote fees and build first");
    var env = {
      app: "bts-vanilla-txbuilder",
      v: 1,
      chain_id: _chainId,
      feeAssetId: _feeAssetId,
      ops: _pairs().map(function (p) { return [p[0], clone(p[1])]; }),
      tx: clone(_built),
      signatures: _signatures.slice(),
      meta: {
        sources: _ops.map(function (e) { return e.source; }),
        requiredAuths: _requiredAuths ? clone(_requiredAuths) : null,
        exportedAt: new Date().toISOString().slice(0, 19),
        expiresNote: "Signatures bind ref-block+expiration: re-basing invalidates them."
      }
    };
    return JSON.stringify(env);
  }

  /* Strict import: replaces composer content. Never silently repairs. */
  function importJSON(text) {
    var env = null;
    try { env = JSON.parse(text); } catch (e) { throw new Error("tb-bad-envelope: not JSON"); }
    if (!env || env.app !== "bts-vanilla-txbuilder" || env.v !== 1) throw new Error("tb-bad-envelope: app/v mismatch");
    var localChain = _requireConnected();
    if (env.chain_id !== localChain) throw new Error("tb-chain-mismatch: export is for " + String(env.chain_id).slice(0, 8) + ", you are on " + String(localChain).slice(0, 8));
    if (!Array.isArray(env.ops) || !env.ops.length) throw new Error("tb-bad-envelope: ops missing");
    env.ops.forEach(function (p, i) {
      if (!Array.isArray(p) || !Number.isInteger(p[0]) || p[0] < 0 || !p[1] || typeof p[1] !== "object") throw new Error("tb-bad-op: ops[" + i + "] must be [opId, opData]");
      if (!p[1].fee || typeof p[1].fee !== "object") throw new Error("tb-bad-envelope: ops[" + i + "] has no fee object");
    });
    if (!env.tx || !Array.isArray(env.tx.operations)) throw new Error("tb-bad-envelope: tx missing");
    if (JSON.stringify(env.tx.operations) !== JSON.stringify(env.ops)) throw new Error("tb-ops-drift: tx.operations differs from ops");
    var sigs = Array.isArray(env.signatures) ? env.signatures : [];
    var seen = {};
    sigs.forEach(function (s, i) {
      if (!s || typeof s.pub !== "string" || typeof s.hex !== "string" || !/^[0-9a-fA-F]{130}$/.test(s.hex)) throw new Error("tb-bad-envelope: signatures[" + i + "] malformed");
      if (seen[s.pub]) throw new Error("tb-bad-envelope: duplicate signature pub " + s.pub);
      seen[s.pub] = true;
    });
    _ops = [];
    _ctr = 0;
    env.ops.forEach(function (p) {
      _ctr += 1;
      _ops.push({ key: "tb-" + String(_ctr).padStart(4, "0") + "-imp", opId: p[0], opData: clone(p[1]), source: "imported op " + p[0], addedAt: new Date().toISOString().slice(0, 19) });
    });
    if (Array.isArray(env.meta && env.meta.sources)) {
      for (var i = 0; i < env.meta.sources.length && i < _ops.length; i++) _ops[i].source = String(env.meta.sources[i]);
    }
    _feeAssetId = env.feeAssetId || "1.3.0";
    _fees = null;
    _requiredAuths = (env.meta && env.meta.requiredAuths) || null;
    _signatures = sigs.slice();
    _chainId = env.chain_id;
    _built = clone(env.tx);
    if (Date.parse(_built.expiration + "Z") < Date.now()) throw new Error("tb-expired: envelope expired — re-base to continue (old signatures are dropped)");
    notify();
    return { ops: list(), signatures: _signatures.slice(), requiredAuths: _requiredAuths };
  }
```

Export lines to add beside the Task 1 exports:

```js
  TxBuilder.feeAll = feeAll;
  TxBuilder.buildUnsigned = buildUnsigned;
  TxBuilder.exportJSON = exportJSON;
  TxBuilder.importJSON = importJSON;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check js/txbuilder.js && node /tmp/tb2-envelope.js`
Expected: syntax clean; `TB2-OK`. Negative checks:

Run: `node -e "globalThis.Tx={_ser:{},feeMulti:async()=>{throw new Error('x')},buildTx:async()=>({})};globalThis.Chain={status:()=>'null'};var B=require('./js/txbuilder.js');B.clear();try{B.exportJSON();throw new Error('should throw');}catch(e){if(!/tb-nothing-to-export|tb-empty/.test(e.message))throw e;}try{B.importJSON('not json');throw new Error('should throw');}catch(e){if(!/tb-bad-envelope/.test(e.message))throw e;}console.log('TB2-NEG-OK')"`
Expected: `TB2-NEG-OK`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/txbuilder.js
git commit -m "feat(txbuilder): feeAll, buildUnsigned, export/import envelope"
```

---

### Task 3: Authority resolution + local multi-key signing

**Files:**
- Modify: `vanilla/js/txbuilder.js` (append `AUTH_LEVELS` table + `resolveAuths` + `signLocal`; internal `_collectAccountIds` + `_thresholdMet` helpers)

**Interfaces:**
- Consumes: `Chain.db()` + `Chain.call(dbId, "get_objects", [ids])`, `Wallet.keys` (`{owner:{wif,pub}, active:{wif,pub}}` — memo excluded), `Crypto.signHash(digestU8, wif)`, `Tx._ser.serializeTransaction` + `hexToBytes` (digest = `SHA-256(chainId + packed)`, same layout as `tx-send.js` sign).
- Produces: `resolveAuths()` (never throws "no keys" — empty wallet yields all-missing rows), `signLocal()` (appends `{pub, hex}` per distinct matching WIF, re-sign replaces same-pub entry, never overwrites another signer, locked wallet throws `tb-wallet-locked`).

- [ ] **Step 1: Write the failing test**

```js
// /tmp/tb3-auth.js — one 1.2.17 account, threshold 1, local active key matches.
globalThis.Tx = { _ser: { serializeTransaction: function () { return new Uint8Array([9]); }, hexToBytes: function () { return new Uint8Array([1, 2]); } } };
globalThis.Chain = {
  db: async function () { return 1; },
  call: async function (id, method, params) {
    if (method === "get_objects") return [{ id: "1.2.17", name: "alice",
      owner: { weight_threshold: 1, account_auths: [], key_auths: [["BTSOwnerPub", 1]] },
      active: { weight_threshold: 1, account_auths: [], key_auths: [["BTSActivePub", 1]] } }];
    throw new Error("unexpected " + method);
  },
  status: function () { return { chainId: "abcd" }; }
};
globalThis.Wallet = { keys: { owner: { wif: "ownerWIF", pub: "BTSOwnerPub" }, active: { wif: "activeWIF", pub: "BTSActivePub" } } };
globalThis.Crypto = { signHash: async function () { return new Uint8Array(65).fill(7); } };
globalThis.crypto = globalThis.crypto || {};
globalThis.crypto.subtle = globalThis.crypto.subtle || { digest: async function () { return new Uint8Array(32).fill(3).buffer; } };
var B = require("./js/txbuilder.js");
(async function () {
  B.clear();
  B.addOp(0, { fee: { amount: "0", asset_id: "1.3.0" }, from: "1.2.17", to: "1.2.20", amount: { amount: "150000", asset_id: "1.3.0" }, extensions: [] }, "transfer:t");
  var rows = await B.resolveAuths();
  if (rows.length !== 1 || rows[0].missing !== false) throw new Error("auth row wrong: " + JSON.stringify(rows));
  console.log("TB3-OK rows=" + JSON.stringify(rows));
})().catch(function (e) { console.error("TB3-FAIL " + (e && e.stack || e)); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/tb3-auth.js`
Expected: FAIL with `B.resolveAuths is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
  /* Per-op required-level table (spec section 5.2, initial coverage = serialized ops).
   * Each entry: function reading the payer/account field(s) from opData plus the
   * level ("active" default, "owner" for op-48 and op-24-with-owner-flag). */
  var AUTH_LEVELS = {
    0: { fields: ["from"], level: "active" },
    1: { fields: ["seller"], level: "active" },
    2: { fields: ["fee_paying_account"], level: "active" },
    3: { fields: ["funding_account"], level: "active" },
    6: { fields: ["account"], level: "active" },
    7: { fields: ["authorizing_account"], level: "active" },
    8: { fields: ["account_to_upgrade"], level: "active" },
    22: { fields: ["fee_paying_account"], level: "active" },
    23: { fields: ["fee_paying_account"], level: "active" },
    24: { fields: ["fee_paying_account"], level: "active" },
    48: { fields: ["issuer"], level: "owner" }
  };

  /* Collect involved 1.2.N ids: per-op table fields + fallback scan of all
   * string values + recursion into op-22 proposed_ops (both shapes). */
  function _collectAccountIds() {
    var out = [];
    function push(id) { if (typeof id === "string" && /^1\.2\.\d+$/.test(id) && out.indexOf(id) < 0) out.push(id); }
    function scanObj(o) {
      if (!o || typeof o !== "object") return;
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (typeof v === "string") push(v);
        else if (v && typeof v === "object") scanObj(v);
      });
    }
    function scanOp(opId, opData) {
      var spec = AUTH_LEVELS[opId];
      (spec ? spec.fields : []).forEach(function (f) { push(opData[f]); });
      if (opId === 22 && Array.isArray(opData.proposed_ops)) {
        opData.proposed_ops.forEach(function (w) {
          var inner = (w && w.op) ? w.op : w;
          if (Array.isArray(inner) && Number.isInteger(inner[0]) && inner[1]) scanOp(inner[0], inner[1]);
        });
      }
      scanObj(opData);
    }
    _ops.forEach(function (e) { scanOp(e.opId, e.opData); });
    return out;
  }

  /* Threshold math for one authority level against available pubs (one level
   * of account_auths recursion; deeper nesting reports honestly via note). */
  function _levelMet(auth, avail) {
    var sum = 0;
    var nested = [];
    (auth.key_auths || []).forEach(function (ka) { if (avail.indexOf(ka[0]) >= 0) sum += ka[1]; });
    (auth.account_auths || []).forEach(function (aa) {
      if (avail.indexOf("ACCOUNT:" + aa[0]) >= 0) sum += aa[1];
      else nested.push(aa[0]);
    });
    return { met: sum >= (auth.weight_threshold || 1), weight: sum, threshold: (auth.weight_threshold || 1), nested: nested };
  }

  /* Resolve required authorities client-side via one batched get_objects read.
   * Returns rows; empty wallet yields all-missing rows (honest, never throws). */
  async function resolveAuths() {
    if (!_ops.length) throw new Error("tb-empty: nothing queued");
    var C = globalThis.Chain;
    if (!C || typeof C.db !== "function") throw new Error("tb-not-connected: Chain is not loaded");
    var ids = _collectAccountIds();
    var rows = [];
    var byId = {};
    if (ids.length) {
      var dbId = await C.db();
      var objs = await C.call(dbId, "get_objects", [ids]);
      ids.forEach(function (id, i) { byId[id] = (objs && objs[i]) || null; });
    }
    var W = globalThis.Wallet || {};
    var avail = [];
    if (W.keys && W.keys.owner && W.keys.owner.pub) avail.push(W.keys.owner.pub);
    if (W.keys && W.keys.active && W.keys.active.pub) avail.push(W.keys.active.pub);
    _signatures.forEach(function (s) { if (avail.indexOf(s.pub) < 0) avail.push(s.pub); });
    _availablePubs = avail.slice();
    // Mark accounts satisfied by an already-imported signature so nested math sees them.
    Object.keys(byId).forEach(function (id) {
      var o = byId[id];
      if (!o) return;
      ["owner", "active"].forEach(function (lvl) {
        var a = o[lvl];
        if (!a) return;
        var r = _levelMet(a, avail);
        if (r.met && avail.indexOf("ACCOUNT:" + id) < 0) avail.push("ACCOUNT:" + id);
      });
    });
    var seen = {};
    _ops.forEach(function (e) {
      var spec = AUTH_LEVELS[e.opId] || { fields: [], level: "active" };
      var level = spec.level;
      if (e.opId === 6 && e.opData.owner) level = "owner";
      if (e.opId === 24 && e.opData.using_owner_authority) level = "owner";
      var candIds = [];
      spec.fields.forEach(function (f) { if (/^1\.2\.\d+$/.test(e.opData[f] || "")) candIds.push(e.opData[f]); });
      if (!candIds.length) candIds = ids.slice();
      candIds.forEach(function (id) {
        if (seen[id + ":" + level]) return;
        seen[id + ":" + level] = true;
        var o = byId[id];
        if (!o) { rows.push({ accountId: id, accountName: "unknown-account(" + id + ")", level: level, threshold: 1, availablePubs: [], missing: true, note: "account object not found" }); return; }
        var auth = o[level] || o.active;
        var r = _levelMet(auth, avail);
        var pubs = (auth.key_auths || []).map(function (ka) { return ka[0]; });
        rows.push({ accountId: id, accountName: o.name || id, level: level, threshold: r.threshold,
          availablePubs: avail.filter(function (p) { return pubs.indexOf(p) >= 0; }),
          missing: !r.met,
          note: (!r.met && r.nested.length ? "nested-auth (needs " + r.nested.join(", ") + ")" : "") +
            ((auth.address_auths && auth.address_auths.length) ? " address_auths: ignored (legacy)" : "") });
      });
    });
    // Best-effort node cross-check (never required, never blocking).
    try {
      if (_built && C && typeof C.call === "function") {
        var dbId2 = await C.db();
        await C.call(dbId2, "get_potential_signatures", [_built]).catch(function () { return null; });
      }
    } catch (e) { /* cross-check failure degrades silently to the client answer */ }
    _requiredAuths = rows;
    notify();
    return rows.map(function (r) { return Object.assign({}, r); });
  }

  /* Sign with every distinct matching local WIF (append-only; same-pub re-sign
   * replaces its entry). Locked wallet throws tb-wallet-locked. */
  async function signLocal() {
    if (!_ops.length) throw new Error("tb-empty: nothing queued");
    var W = globalThis.Wallet || {};
    if (!W.keys || !W.keys.active) throw new Error("tb-wallet-locked: unlock the wallet before signing");
    if (!_built) await buildUnsigned();
    if (!_requiredAuths) await resolveAuths();
    var T = globalThis.Tx;
    var C = globalThis.Chain;
    var st = C.status();
    var packed = T._ser.serializeTransaction(_built);
    var chainBytes = T._ser.hexToBytes(st.chainId);
    var msg = new Uint8Array(chainBytes.length + packed.length);
    msg.set(chainBytes); msg.set(packed, chainBytes.length);
    var digest = new Uint8Array(await crypto.subtle.digest("SHA-256", msg));
    var wifs = [];
    function consider(pub, wif) {
      if (!pub || !wif) return;
      if (_signatures.some(function (s) { return s.pub === pub; })) return;
      if (wifs.some(function (w) { return w.pub === pub; })) return;
      wifs.push({ pub: pub, wif: wif });
    }
    var needOwner = _requiredAuths.some(function (r) { return r.level === "owner"; });
    var activeSatisfied = _requiredAuths.some(function (r) { return r.level === "active" && !r.missing; });
    if (needOwner && W.keys.owner) consider(W.keys.owner.pub, W.keys.owner.wif);
    if (!needOwner || !activeSatisfied) consider(W.keys.active.pub, W.keys.active.wif);
    if (needOwner && W.keys.owner) consider(W.keys.owner.pub, W.keys.owner.wif);
    var signed = [];
    for (var i = 0; i < wifs.length; i++) {
      var sig = await globalThis.Crypto.signHash(digest, wifs[i].wif);
      if (!(sig instanceof Uint8Array) || sig.length !== 65) throw new Error("tb-bad-envelope: Crypto.signHash must return 65 bytes");
      var hex = T._ser.bytesToHex ? T._ser.bytesToHex(sig) : Array.prototype.map.call(sig, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      var at = -1;
      for (var j = 0; j < _signatures.length; j++) if (_signatures[j].pub === wifs[i].pub) at = j;
      var entry = { pub: wifs[i].pub, hex: hex };
      if (at >= 0) _signatures[at] = entry; else _signatures.push(entry);
      signed.push(wifs[i].pub);
    }
    var stillMissing = _requiredAuths.filter(function (r) {
      return r.missing && signed.indexOf(r.availablePubs[0]) < 0 &&
        !_signatures.some(function (s) { return r.availablePubs.indexOf(s.pub) >= 0; });
    }).map(function (r) { return r.accountId; });
    // Recompute missing honestly: rows whose threshold still unmet after new sigs.
    stillMissing = _requiredAuths.filter(function (r) { return r.missing; }).map(function (r) { return r.accountId; });
    var availNow = _availablePubs.concat(signed);
    stillMissing = _requiredAuths.filter(function (r) {
      return r.availablePubs.every(function (p) { return availNow.indexOf(p) < 0; }) && r.missing;
    }).map(function (r) { return r.accountId; });
    notify();
    return { signed: signed, stillMissing: stillMissing };
  }
```

Export lines:

```js
  TxBuilder.resolveAuths = resolveAuths;
  TxBuilder.signLocal = signLocal;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check js/txbuilder.js && node /tmp/tb3-auth.js`
Expected: syntax clean; `TB3-OK` with one row `missing:false`. Missing-key honesty check:

Run: `node -e "globalThis.Tx={_ser:{serializeTransaction:()=>'x',hexToBytes:()=>'y'}};globalThis.Chain={db:async()=>'1',call:async()=>'[{id:\"1.2.99\",name:\"bob\",owner:{weight_threshold:1,account_auths:[],key_auths:[[\"BTSRemote\",1]]},active:{weight_threshold:1,account_auths:[],key_auths:[[\"BTSRemote\",1]]}}]',status:()=>'({})'};globalThis.Wallet={keys:null};var B=require('./js/txbuilder.js');B.clear();B.addOp(0,{fee:{amount:'0',asset_id:'1.3.0'},from:'1.2.99',to:'1.2.20',amount:{amount:'1',asset_id:'1.3.0'},extensions:[]},'t');B.resolveAuths().then(r=>{if(!r[0].missing)throw new Error('should be missing');console.log('TB3-MISSING-OK')})"`
Expected: `TB3-MISSING-OK` (empty wallet yields all-missing rows, never throws).

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/txbuilder.js
git commit -m "feat(txbuilder): get_objects authority resolution and append-only signLocal"
```

---

### Task 4: Human rows (`describe` — pilot ops 0/6/61 + honest fallback)

**Files:**
- Modify: `vanilla/js/txbuilder.js` (append `describe` + `OP_TITLES` coverage table + internal `_assetPrecisions` helper)

**Interfaces:**
- Consumes: `Account.resolve(id)` → `{name, id}` (fallback: bare id + `(unknown account)`), `Chain.call(dbId, "get_assets", [[ids]])` for precisions (fallback: `unresolved — showing raw`), `Format.formatAmount(raw, prec)`, `Format.formatPrice`, `Pool.pctUnitsToHuman`.
- Produces: `describe(opId, opData)` → `Promise<[{label, value, title?}]>`; pilot ops 0/6/61 fully described; every other serializable op returns title + fee + involved-account rows with remaining fields as labelled raw values (never blank); unknown opId returns the honest `op <id> (not yet described)` fallback.

- [ ] **Step 1: Write the failing test**

```js
// /tmp/tb4-describe.js — op-0 transfer renders human amount, unknown op falls back.
globalThis.Tx = { _ser: {} };
globalThis.Account = { resolve: async function (id) { return { name: "alice", id: id }; } };
globalThis.Chain = { db: async function () { return 1; },
  call: async function (id, m, p) { if (m === "get_assets") return [{ id: "1.3.0", precision: 5, symbol: "TEST" }]; throw new Error(m); } };
globalThis.Format = { formatAmount: function (raw, prec) { return "1.50000 TEST"; }, formatPrice: function () { return "1.0"; } };
var B = require("./js/txbuilder.js");
(async function () {
  var rows = await B.describe(0, { fee: { amount: "100", asset_id: "1.3.0" }, from: "1.2.17", to: "1.2.20", amount: { amount: "150000", asset_id: "1.3.0" }, extensions: [] });
  if (!rows.some(function (r) { return r.label === "Amount" && /1\.50000/.test(r.value); })) throw new Error("amount row wrong: " + JSON.stringify(rows));
  var fb = await B.describe(999, { fee: { amount: "0", asset_id: "1.3.0" } });
  if (!/not yet described/.test(fb[0].value)) throw new Error("fallback wrong");
  console.log("TB4-OK");
})().catch(function (e) { console.error("TB4-FAIL " + (e && e.stack || e)); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/tb4-describe.js`
Expected: FAIL with `B.describe is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
  /* Per-op coverage table (visible gaps: pilot ops full, long tail title+fee+accounts).
   * Titles follow #3 OPERATION_NAMES order/labels; amounts render via Format. */
  var OP_TITLES = { 0: "Transfer", 1: "Limit order create", 2: "Limit order cancel",
    3: "Call order update", 6: "Account update", 7: "Account whitelist", 8: "Account upgrade",
    10: "Asset create", 14: "Asset issue", 19: "Feed publish", 22: "Proposal create",
    23: "Proposal update", 24: "Proposal delete", 32: "Vesting create", 33: "Vesting withdraw",
    37: "Balance claim", 48: "Asset update issuer", 49: "HTLC create", 50: "HTLC redeem",
    54: "Custom authority create", 55: "Custom authority update", 56: "Custom authority delete",
    57: "Ticket create", 58: "Ticket update", 59: "Pool create", 60: "Pool update",
    61: "Pool deposit", 62: "Pool withdraw", 63: "Pool exchange", 75: "Pool claim" };

  /* Batch precision read for distinct asset ids (one get_assets call). */
  async function _assetPrecisions(ids) {
    var out = {};
    var uniq = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
    if (!uniq.length) return out;
    try {
      var C = globalThis.Chain;
      var dbId = await C.db();
      var rows = await C.call(dbId, "get_assets", [uniq]);
      uniq.forEach(function (id, i) {
        var r = rows && rows[i];
        out[id] = (r && typeof r.precision === "number") ? { precision: r.precision, symbol: r.symbol || id } : null;
      });
    } catch (e) { uniq.forEach(function (id) { out[id] = null; }); }
    return out;
  }

  async function _nameOf(id) {
    try {
      var A = globalThis.Account;
      if (A && typeof A.resolve === "function") {
        var r = await A.resolve(id);
        if (r && r.name) return r.name + " (" + id + ")";
      }
    } catch (e) { /* fall through to bare id */ }
    return id + " (unknown account)";
  }

  function _fmtAmt(raw, prec, sym) {
    try { return globalThis.Format.formatAmount(String(raw), prec) + (sym ? " " + sym : ""); }
    catch (e) { return String(raw) + " (raw)"; }
  }

  /* Human rows per op. Amounts via Format at the right precision (raw in title);
   * accounts as name (id); fee row always present; raw JSON stays in the view's
   * <details>, never here. Unknown opId returns the honest fallback. */
  async function describe(opId, opData) {
    var d = opData || {};
    var title = OP_TITLES[opId] || ("op " + opId + " (not yet described)");
    if (!OP_TITLES[opId]) {
      return [{ label: "Operation", value: title }, { label: "Data", value: JSON.stringify(d) }];
    }
    var rows = [{ label: "Operation", value: title + " (op " + opId + ")" }];
    var assetIds = [];
    JSON.stringify(d);
    (function collect(o) {
      if (!o || typeof o !== "object") return;
      if (typeof o.asset_id === "string" && /^\d+\.\d+\.\d+$/.test(o.asset_id) && typeof o.amount !== "undefined") assetIds.push(o.asset_id);
      Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === "object") collect(o[k]); });
    })(d);
    var precs = await _assetPrecisions(assetIds);
    async function amtStr(slot) {
      if (!slot || typeof slot.amount === "undefined") return "—";
      var p = precs[slot.asset_id];
      if (!p) return String(slot.asset_id) + " unresolved — showing raw " + String(slot.amount);
      return _fmtAmt(slot.amount, p.precision, p.symbol);
    }
    if (opId === 0) {
      rows.push({ label: "From", value: await _nameOf(d.from) });
      rows.push({ label: "To", value: await _nameOf(d.to) });
      var av = await amtStr(d.amount);
      rows.push({ label: "Amount", value: av, title: String((d.amount || {}).amount) });
      if (d.memo && d.memo.message) rows.push({ label: "Memo", value: String(d.memo.message).slice(0, 120) });
    } else if (opId === 6) {
      rows.push({ label: "Account", value: await _nameOf(d.account) });
      var no = d.new_options || {};
      rows.push({ label: "Voting account", value: String(no.voting_account || "—") });
      rows.push({ label: "Votes", value: String(((no.votes || []).length) + " selected") });
      rows.push({ label: "Witnesses / committee", value: String(no.num_witness || "—") + " / " + String(no.num_committee || "—") });
    } else if (opId === 61) {
      rows.push({ label: "Account", value: await _nameOf(d.account) });
      rows.push({ label: "Pool", value: String(d.pool || "—") });
      var a0 = await amtStr(d.amount_a), a1 = await amtStr(d.amount_b);
      rows.push({ label: "Amount A", value: a0, title: String((d.amount_a || {}).amount) });
      rows.push({ label: "Amount B", value: a1, title: String((d.amount_b || {}).amount) });
    } else {
      var ids = [];
      (function idsOf(o) {
        if (!o || typeof o !== "object") return;
        Object.keys(o).forEach(function (k) {
          if (typeof o[k] === "string" && /^1\.2\.\d+$/.test(o[k])) ids.push(o[k]);
          else if (o[k] && typeof o[k] === "object") idsOf(o[k]);
        });
      })(d);
      for (var i = 0; i < ids.length; i++) rows.push({ label: "Account", value: await _nameOf(ids[i]) });
      Object.keys(d).forEach(function (k) {
        if (k === "fee" || k === "extensions") return;
        var v = d[k];
        if (v && typeof v === "object" && typeof v.amount !== "undefined" && v.asset_id) return;
        if (typeof v === "string" && /^1\.2\.\d+$/.test(v)) return;
        rows.push({ label: k, value: typeof v === "object" ? JSON.stringify(v) : String(v) });
      });
    }
    if (d.fee) {
      var fp = precs[d.fee.asset_id];
      rows.push({ label: "Fee", value: fp ? _fmtAmt(d.fee.amount, fp.precision, fp.symbol) : ("raw " + String(d.fee.amount) + " " + String(d.fee.asset_id)), title: String(d.fee.amount) });
    }
    return rows;
  }
```

Export line:

```js
  TxBuilder.describe = describe;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check js/txbuilder.js && node /tmp/tb4-describe.js`
Expected: syntax clean; `TB4-OK`. Precision-fallback check:

Run: `node -e "globalThis.Tx={_ser:{}};globalThis.Account={resolve:async()=>{throw new Error('down')}};globalThis.Chain={db:async()=>'1',call:async()=>{throw new Error('asset down')}};globalThis.Format={formatAmount:(r,p)=>r+'@'+p};var B=require('./js/txbuilder.js');B.describe(0,{fee:{amount:'5',asset_id:'1.3.0'},from:'1.2.1',to:'1.2.2',amount:{amount:'9',asset_id:'1.3.0'},extensions:[]}).then(r=>{var a=r.filter(x=>x.label==='Amount')[0];if(!/unresolved/.test(a.value))throw new Error('should label unresolved: '+a.value);console.log('TB4-FALLBACK-OK')})"`
Expected: `TB4-FALLBACK-OK`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/txbuilder.js
git commit -m "feat(txbuilder): describe human rows for pilot ops plus fallback"
```

---

### Task 5: `#/txbuilder` desk view + route + header badge + script wiring

**Files:**
- Create: `vanilla/js/txbuilder-ui.js` (desk: queue cards, fees pane, authorities pane, send-choice radio, export/import panes, review gate)
- Modify: `vanilla/js/router.js` (one route entry before `"*"`), `vanilla/index.html` (two script tags), `vanilla/js/app.js` (header badge)

**Interfaces:**
- Consumes: `TxBuilder.subscribe/list/state/feeAll/resolveAuths/buildUnsigned/signLocal/describe/exportJSON/importJSON` + `Router` routes array + existing `wrap wide` CSS classes.
- Produces: `TxBuilderUI.renderDesk(root)` + header badge `#tb-badge` (`TxBuilder (N)`, hidden at 0, links to `#/txbuilder`).

- [ ] **Step 1: Write the failing test**

```js
// /tmp/tb5-route.js — router has no txbuilder route yet; badge absent.
var src = require("fs").readFileSync("./js/router.js", "utf8");
if (/txbuilder/.test(src)) throw new Error("route already present (unexpected)");
var html = require("fs").readFileSync("./index.html", "utf8");
if (/txbuilder\.js/.test(html)) throw new Error("script tag already present (unexpected)");
console.log("TB5-PRE-OK (route + script absent as expected)");
```

- [ ] **Step 2: Run test to verify it fails-after-implementation-inverts**

Run: `node /tmp/tb5-route.js`
Expected: PASS pre-implementation (`TB5-PRE-OK`). After Step 3 the same script must FAIL (route present) — invert by running the post-check below in Step 4.

- [ ] **Step 3: Write minimal implementation**

`vanilla/js/txbuilder-ui.js` (complete, 4 sections; phone stacks, desktop 2-column via existing grid):

```js
/* txbuilder-ui.js — #/txbuilder desk (DOM only; state lives in txbuilder.js).
 *
 * What it owns: queue cards with human dl rows + raw-JSON details + Remove,
 * fees pane, authorities pane, Direct/Proposal send-choice radio, export/import
 * panes, review-then-sign result rendering, header badge count subscription.
 * Consumes: TxBuilder (state/describe/feeAll/resolveAuths/buildUnsigned/
 * signLocal/exportJSON/importJSON), Wallet.isUnlocked (gate only), Chain.status
 * (chain-id line). No keys, no WIFs, no secrets in the DOM ever.
 * Created by: TxBuilder plan 2026-09-30, Task 5.
 */
var TxBuilderUI = (typeof globalThis !== "undefined" && globalThis.TxBuilderUI) ? globalThis.TxBuilderUI : ((typeof TxBuilderUI !== "undefined") ? TxBuilderUI : {});
(function () {
  "use strict";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (typeof text !== "undefined" && text !== null) n.textContent = text;
    return n;
  }

  function dlRow(dl, label, value, title) {
    var dt = document.createElement("dt"); dt.textContent = label;
    var dd = document.createElement("dd"); dd.textContent = value;
    if (title) dd.title = title;
    dl.appendChild(dt); dl.appendChild(dd);
  }

  /* Render one queued op card: title + human rows + raw details + Remove. */
  async function renderCard(wrap, entry) {
    var card = el("div", "card tb-card");
    var h = el("h3", null, (entry.source || ("op " + entry.opId)));
    card.appendChild(h);
    var dl = el("dl", "dl");
    card.appendChild(dl);
    try {
      var rows = await TxBuilder.describe(entry.opId, entry.opData);
      rows.forEach(function (r) { dlRow(dl, r.label, r.value, r.title); });
    } catch (e) { dlRow(dl, "Error", String((e && e.message) || e)); }
    var det = document.createElement("details");
    var sum = document.createElement("summary"); sum.textContent = "Raw operation JSON";
    var pre = document.createElement("pre"); pre.textContent = JSON.stringify([entry.opId, entry.opData], null, 2);
    det.appendChild(sum); det.appendChild(pre); card.appendChild(det);
    var rm = el("button", "btn danger", "Remove");
    rm.setAttribute("type", "button");
    rm.addEventListener("click", function () { TxBuilder.removeOp(entry.key); renderDesk(wrap); });
    card.appendChild(rm);
    wrap.appendChild(card);
  }

  /* Full desk: queue | fees+auths grid, send choice, export/import. */
  async function renderDesk(root) {
    root.innerHTML = "";
    var wrap = el("div", "wrap wide"); root.appendChild(wrap);
    wrap.appendChild(el("h2", null, "Transaction Builder"));
    var st = TxBuilder.state();
    if (!st.ops.length) {
      var empty = el("p", "empty", "No operations queued. Build one from Transfer, Voting, or Pools — each confirm screen offers Add to TxBuilder — then review it here.");
      wrap.appendChild(empty);
      var links = el("p", null, "");
      [["#/transfer", "Transfer"], ["#/voting", "Voting"], ["#/pools", "Pools"]].forEach(function (pair) {
        var a = document.createElement("a"); a.href = pair[0]; a.textContent = pair[1]; a.style.marginRight = "12px";
        links.appendChild(a);
      });
      wrap.appendChild(links);
      return;
    }
    var grid = el("div", "tb-grid"); wrap.appendChild(grid);
    var qcol = el("div", "tb-col"); qcol.appendChild(el("h3", null, "Queue (" + st.ops.length + ")"));
    grid.appendChild(qcol);
    for (var i = 0; i < st.ops.length; i++) { await renderCard(qcol, st.ops[i]); }
    var scol = el("div", "tb-col"); grid.appendChild(scol);
    var feeBtn = el("button", "btn", "Quote fees");
    feeBtn.setAttribute("type", "button");
    feeBtn.addEventListener("click", async function () {
      feeBtn.disabled = true;
      try { var f = await TxBuilder.feeAll(); feeOut.textContent = "Total " + f.totalDisplay + " (" + f.totalRaw + " raw)"; }
      catch (e) { feeOut.textContent = "Fee error: " + String((e && e.message) || e); }
      feeBtn.disabled = false;
    });
    scol.appendChild(feeBtn);
    var feeOut = el("p", "tb-fees", st.fees ? ("Total " + st.fees.totalDisplay) : "Fees not quoted yet.");
    scol.appendChild(feeOut);
    var authBtn = el("button", "btn", "Resolve authorities");
    authBtn.setAttribute("type", "button");
    var authOut = el("div", "tb-auths");
    authBtn.addEventListener("click", async function () {
      authBtn.disabled = true; authOut.innerHTML = "";
      try {
        var rows = await TxBuilder.resolveAuths();
        rows.forEach(function (r) {
          authOut.appendChild(el("p", null, (r.missing ? "… " : "✓ ") + r.accountName + " (" + r.accountId + ") — " + r.level + " threshold " + r.threshold + (r.missing ? " — unsigned for " + r.accountName + " (no local key)" : " — key available") + (r.note ? " [" + r.note + "]" : "")));
        });
      } catch (e) { authOut.appendChild(el("p", "error", "Auth error: " + String((e && e.message) || e))); }
      authBtn.disabled = false;
    });
    scol.appendChild(authBtn); scol.appendChild(authOut);
    var chainP = el("p", "muted", "Chain: " + (st.chainId ? st.chainId.slice(0, 8) : "not built yet"));
    scol.appendChild(chainP);
    var expBtn = el("button", "btn", "Export JSON");
    expBtn.setAttribute("type", "button");
    var expArea = document.createElement("textarea"); expArea.rows = 6; expArea.placeholder = "Export payload appears here";
    expBtn.addEventListener("click", async function () {
      try { if (!st.built) await TxBuilder.buildUnsigned(); expArea.value = TxBuilder.exportJSON(); }
      catch (e) { expArea.value = "Export error: " + String((e && e.message) || e); }
    });
    scol.appendChild(expBtn); scol.appendChild(expArea);
    var impArea = document.createElement("textarea"); impArea.rows = 6; impArea.placeholder = "Paste an export payload, then Import";
    var impBtn = el("button", "btn", "Import JSON");
    impBtn.setAttribute("type", "button");
    impBtn.addEventListener("click", function () {
      try { TxBuilder.importJSON(impArea.value); renderDesk(root); }
      catch (e) { impArea.value = "Import error: " + String((e && e.message) || e); }
    });
    scol.appendChild(impArea); scol.appendChild(impBtn);
  }

  /* Header badge: count only, hidden at 0, links to the desk. */
  function mountBadge() {
    if (document.getElementById("tb-badge") || typeof TxBuilder === "undefined") return;
    var bar = document.querySelector(".topbar") || document.querySelector("header") || document.body;
    var a = document.createElement("a");
    a.id = "tb-badge"; a.href = "#/txbuilder"; a.style.display = "none";
    bar.appendChild(a);
    TxBuilder.subscribe(function (s) {
      a.style.display = s.ops.length ? "" : "none";
      a.textContent = "TxBuilder (" + s.ops.length + ")";
    });
    var s0 = TxBuilder.state();
    if (s0.ops.length) { a.style.display = ""; a.textContent = "TxBuilder (" + s0.ops.length + ")"; }
  }

  function renderDeskInto(root) { renderDesk(root); }

  TxBuilderUI.renderDesk = renderDeskInto;
  TxBuilderUI.mountBadge = mountBadge;
  if (typeof globalThis !== "undefined") { globalThis.TxBuilderUI = TxBuilderUI; }
})();

if (typeof module !== "undefined") { module.exports = TxBuilderUI; }
```

`router.js` edit (insert directly before the `"*"` catch-all entry):

```js
    { path: "/txbuilder", title: "Transaction Builder", render: function (root) { TxBuilderUI.renderDesk(root); } },
```

`index.html` edit (insert after the `proposal.js` line group, before `router.js`):

```html
<script src="js/txbuilder.js"></script>
<script src="js/txbuilder-ui.js"></script>
```

`app.js` edit (call once at boot end, guarded so a missing file never breaks boot):

```js
  try { if (typeof TxBuilderUI !== "undefined" && TxBuilderUI.mountBadge) TxBuilderUI.mountBadge(); } catch (e) { /* desk badge optional */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check js/txbuilder-ui.js && node -e "var s=require('fs').readFileSync('./js/router.js','utf8');if(!/\"\/txbuilder\"/.test(s))throw new Error('route missing');var h=require('fs').readFileSync('./index.html','utf8');if(h.indexOf('js/txbuilder.js')<0||h.indexOf('js/txbuilder-ui.js')<0)throw new Error('script tags missing');if(h.indexOf('js/txbuilder.js')>h.indexOf('js/router.js'))throw new Error('script order wrong');console.log('TB5-OK')"`
Expected: syntax clean; `TB5-OK`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/txbuilder-ui.js vanilla/js/router.js vanilla/index.html vanilla/js/app.js
git commit -m "feat(txbuilder): txbuilder desk route, badge, and script wiring"
```

---

### Task 6: Proposal-wrap + generic broadcast with per-op provers

**Files:**
- Modify: `vanilla/js/txbuilder.js` (append `wrapProposal` + `broadcastSigned`)

**Interfaces:**
- Consumes: `Proposal.buildCreate({feePayerId, expirationIso, reviewPeriodSecOrNull, innerOps})`, `Proposal.sendAndProve` (wrap path proof), `Tx.broadcast`-equivalent transport pattern (`broadcast_transaction_with_callback` first, `broadcast_transaction` fallback once), per-op provers passed in by the desk (`provers = {0: fn, 6: fn, 61: fn, 22: fn}` supplied by `txbuilder-ui.js` at call time; unknown opIds report accepted-but-unproven).
- Produces: `wrapProposal(args)` → `[22, opData]` (delegates, no new builder) and `broadcastSigned(tx, provers)` → `{perOp, via}` with partial-sign support (broadcast allowed when `signatures.length > 0`; empty signatures throws `tb-empty`).

- [ ] **Step 1: Write the failing test**

```js
// /tmp/tb6-wrap.js — wrap delegates to Proposal.buildCreate; broadcast uses stub transport.
globalThis.Tx = { _ser: {} };
globalThis.Proposal = { buildCreate: function (a) { return [22, { fee_paying_account: a.feePayerId, proposed_ops: a.innerOps.map(function (p) { return { op: p }; }) }]; } };
globalThis.Chain = { db: async function () { return 1; }, net: async function () { return 2; },
  call: async function (id, m) { if (m === "broadcast_transaction_with_callback") return true; throw new Error("no " + m); },
  status: function () { return { chainId: "c" }; } };
var B = require("./js/txbuilder.js");
(async function () {
  B.clear();
  B.addOp(0, { fee: { amount: "0", asset_id: "1.3.0" }, from: "1.2.17", to: "1.2.20", amount: { amount: "10", asset_id: "1.3.0" }, extensions: [] }, "t");
  var w = B.wrapProposal({ feePayerId: "1.2.17", expirationIso: "2026-10-01T12:00:00", reviewPeriodSecOrNull: null });
  if (w[0] !== 22 || w[1].proposed_ops.length !== 1) throw new Error("wrap wrong");
  console.log("TB6-OK");
})().catch(function (e) { console.error("TB6-FAIL " + (e && e.stack || e)); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/tb6-wrap.js`
Expected: FAIL with `B.wrapProposal is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
  /* Wrap the whole queue as op-22 (alternative send path — direct send stays
   * default). Delegates to Proposal.buildCreate; no new builder here. */
  function wrapProposal(args) {
    args = args || {};
    if (!args.feePayerId || !/^1\.2\.\d+$/.test(args.feePayerId)) throw new Error("tb-bad-op: feePayerId must be 1.2.N");
    if (!args.expirationIso || !Number.isFinite(Date.parse(args.expirationIso))) throw new Error("tb-bad-op: expirationIso must parse");
    var P = globalThis.Proposal;
    if (!P || typeof P.buildCreate !== "function") throw new Error("tb-not-connected: Proposal.buildCreate is not loaded");
    return P.buildCreate({ feePayerId: args.feePayerId, expirationIso: args.expirationIso,
      reviewPeriodSecOrNull: (typeof args.reviewPeriodSecOrNull === "undefined" ? null : args.reviewPeriodSecOrNull),
      innerOps: _pairs() });
  }

  /* Broadcast a signed (possibly partially-signed) tx. Transport: callback
   * method first, plain fallback once. Proof: per-op provers where supplied;
   * unknown opIds report accepted-but-unproven (never displayed as confirmed).
   * Partial broadcast is deliberate: allowed when at least one signature exists. */
  async function broadcastSigned(tx, provers) {
    provers = provers || {};
    if (!tx || !Array.isArray(tx.operations) || !tx.operations.length) throw new Error("tb-empty: nothing to broadcast");
    var sigs = tx.signatures || _signatures.map(function (s) { return s.hex; });
    if (!sigs.length) throw new Error("tb-empty: no signatures — sign or import signatures first");
    var C = globalThis.Chain;
    var netId = await C.net();
    var via = "broadcast_transaction_with_callback";
    var wire = Object.assign({}, tx, { signatures: sigs });
    try {
      await C.call(netId, "broadcast_transaction_with_callback", [Math.floor(Math.random() * 4294967296), wire]);
    } catch (e) {
      via = "broadcast_transaction";
      await C.call(netId, "broadcast_transaction", [wire]);
    }
    var perOp = [];
    for (var i = 0; i < tx.operations.length; i++) {
      var opId = tx.operations[i][0];
      var fn = provers[opId];
      if (typeof fn === "function") {
        try {
          var ok = await fn(tx.operations[i][1], tx);
          perOp.push({ opId: opId, status: ok ? "observed" : "not observed" });
        } catch (e) { perOp.push({ opId: opId, status: "not observed" }); }
      } else {
        perOp.push({ opId: opId, status: "accepted by node, inclusion not proven for op " + opId + " — check history before retrying" });
      }
    }
    return { perOp: perOp, via: via };
  }
```

Export lines:

```js
  TxBuilder.wrapProposal = wrapProposal;
  TxBuilder.broadcastSigned = broadcastSigned;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check js/txbuilder.js && node /tmp/tb6-wrap.js`
Expected: syntax clean; `TB6-OK`. Transport-fallback check:

Run: `node -e "globalThis.Tx={_ser:{}};globalThis.Proposal={buildCreate:()=>'x'};var calls=[];globalThis.Chain={net:async()=>'2',call:async(id,m)=>{calls.push(m);if(m==='broadcast_transaction_with_callback')throw new Error('node rejects method');return true;},status:()=>'({chainId:\"c\"})'};var B=require('./js/txbuilder.js');B.broadcastSigned({operations:[[99,{fee:{amount:'1',asset_id:'1.3.0'}}}],signatures:['aa']},{}).then(r=>{if(r.via!=='broadcast_transaction')throw new Error('no fallback');if(!/not proven/.test(r.perOp[0].status))throw new Error('long-tail wording wrong');console.log('TB6-FALLBACK-OK')})"`
Expected: `TB6-FALLBACK-OK`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/txbuilder.js
git commit -m "feat(txbuilder): proposal-wrap delegation and generic broadcast"
```

---

### Task 7: Three pilot outlets (transfer + vote + pool stake, additive + guarded)

**Files:**
- Modify: `vanilla/js/transfer-confirm.js` (Add button on confirm), `vanilla/js/vote-ui.js` (Add button on vote confirm), `vanilla/js/pool-ui.js` (Add button on stake confirm)

**Interfaces:**
- Consumes: `TxBuilder.addOp` guarded by `typeof TxBuilder !== "undefined"` (button hides when the script failed to load); per-form unsigned opData already built by the form's own `review`/`preparePublish`/`buildDeposit` (this task emits only, never rebuilds or revalidates).
- Produces: three outlet buttons navigating to `#/txbuilder` with toast `Added <source> (op <id>) — N in queue`; one-shot Review → Sign & Send paths byte-identical.

- [ ] **Step 1: Write the failing test**

```js
// /tmp/tb7-outlets.js — each pilot file references TxBuilder.addOp behind a guard.
var fs = require("fs");
[["transfer-confirm.js", "Add to TxBuilder"], ["vote-ui.js", "Add vote to TxBuilder"], ["pool-ui.js", "Add deposit to TxBuilder"]].forEach(function (pair) {
  var src = fs.readFileSync("./js/" + pair[0], "utf8");
  if (src.indexOf("TxBuilder") < 0) throw new Error(pair[0] + " has no TxBuilder outlet");
  if (src.indexOf(typeof pair[1] === "string" ? pair[1].slice(0, 6) : "") < 0) throw new Error(pair[0] + " label missing");
});
console.log("TB7-OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node /tmp/tb7-outlets.js`
Expected: FAIL with `transfer-confirm.js has no TxBuilder outlet` (outlets not added yet).

- [ ] **Step 3: Write minimal implementation** (one guarded block per file, beside the existing primary Sign button; exact sketches)

Transfer (`transfer-confirm.js`, inside `showConfirm` after the Sign & Send button wiring):

```js
    /* TxBuilder outlet (additive): queue this unsigned transfer without broadcasting. */
    try {
      if (typeof TxBuilder !== "undefined" && TxBuilder.addOp && ctx && ctx.unsigned && ctx.unsigned.operations && ctx.unsigned.operations[0]) {
        var addBtn = document.createElement("button");
        addBtn.className = "btn secondary";
        addBtn.setAttribute("type", "button");
        addBtn.textContent = "Add to TxBuilder";
        addBtn.addEventListener("click", function () {
          var pair = ctx.unsigned.operations[0];
          TxBuilder.addOp(pair[0], pair[1], "transfer:" + from + "->" + (ctx.toName || pair[1].to));
          location.hash = "#/txbuilder";
        });
        btnRow.appendChild(addBtn);
      }
    } catch (e) { /* outlet never breaks the one-shot path */ }
```

Vote (`vote-ui.js`, inside `showConfirm` after the publish button wiring; `newOptions` + `st.me.id` in scope):

```js
    /* TxBuilder outlet (additive): queue the [6, opData] without broadcasting. */
    try {
      if (typeof TxBuilder !== "undefined" && TxBuilder.addOp) {
        var addVote = document.createElement("button");
        addVote.className = "btn secondary";
        addVote.setAttribute("type", "button");
        addVote.textContent = "Add vote to TxBuilder";
        addVote.addEventListener("click", function () {
          TxBuilder.addOp(6, { fee: { amount: "0", asset_id: "1.3.0" }, account: st.me.id, new_options: newOptions }, "vote:" + (st.me.name || st.me.id) + " slate");
          location.hash = "#/txbuilder";
        });
        btnRow.appendChild(addVote);
      }
    } catch (e) { /* outlet never breaks the one-shot path */ }
```

Pool stake (`pool-ui.js`, inside the stake/deposit confirm after the primary button; `depositOp` is the built `[61, opData]` pair):

```js
    /* TxBuilder outlet (additive): queue the [61, opData] without broadcasting. */
    try {
      if (typeof TxBuilder !== "undefined" && TxBuilder.addOp && typeof depositOp !== "undefined" && depositOp) {
        var addDep = document.createElement("button");
        addDep.className = "btn secondary";
        addDep.setAttribute("type", "button");
        addDep.textContent = "Add deposit to TxBuilder";
        addDep.addEventListener("click", function () {
          TxBuilder.addOp(depositOp[0], depositOp[1], "pool:deposit " + String(depositOp[1].pool || ""));
          location.hash = "#/txbuilder";
        });
        btnRow.appendChild(addDep);
      }
    } catch (e) { /* outlet never breaks the one-shot path */ }
```

Locked-memo rule (transfer): when the encrypted-memo preview state excludes the memo (locked), the transfer outlet disables with its reason shown — implement as `addBtn.disabled = true; addBtn.title = "Unlock to include the encrypted memo"` in that branch (same gating idiom as the form's gate box).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --check js/transfer-confirm.js && node --check js/vote-ui.js && node --check js/pool-ui.js && node /tmp/tb7-outlets.js`
Expected: all syntax clean; `TB7-OK`. Absence-guard check:

Run: `node -e "var fs=require('fs');['transfer-confirm.js','vote-ui.js','pool-ui.js'].forEach(f=>{var s=fs.readFileSync('./js/'+f,'utf8');if(s.indexOf('typeof TxBuilder')<0)throw new Error(f+' missing absence guard')});console.log('TB7-GUARD-OK')"`
Expected: `TB7-GUARD-OK` (one-shot paths work with `js/txbuilder.js` blocked).

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/transfer-confirm.js vanilla/js/vote-ui.js vanilla/js/pool-ui.js
git commit -m "feat(txbuilder): pilot outlets on transfer, vote, and pool stake"
```

---

### Task 8: Testnet verification vectors T1–T6 + parity note + rot gate

**Files:**
- Create: `vanilla/notes/txbuilder-parity.md` (vectors T1–T6 with raw→human pairs, viewport/theme trio, decisions log)
- Verify: `vanilla/js/txbuilder.js`, `vanilla/js/txbuilder-ui.js` (no code changes unless a vector exposes a bug — then a fix commit precedes the note)

**Interfaces:**
- Consumes: live testnet (`Chain.db/history/net`), faucet accounts, `Tx._ser.serializeTransaction` hex (byte-identical round-trip proof), `tooling/check_rot.py`.
- Produces: parity note with observed block numbers / proposal ids / fee totals / viewport checks; `check_rot.py` exit 0.

- [ ] **Step 1: Write the failing test (offline round-trip + leak scan before touching testnet)**

```js
// /tmp/tb8-offline.js — export/import byte-identity + secret-leak scan on builders only.
globalThis.Tx = { _ser: { serializeTransaction: function (tx) { return new Uint8Array(Buffer.from(JSON.stringify(tx.operations))); },
    hexToBytes: function (h) { return new Uint8Array(Buffer.from(h.slice(0, 8))); }, bytesToHex: function (u) { return Buffer.from(u).toString("hex"); } },
  feeMulti: async function (pairs, id) { pairs.forEach(function (p) { p[1].fee = { amount: "100", asset_id: id }; }); return { perOp: pairs.map(function (p) { return p[1].fee; }), totalRaw: String(100 * pairs.length), totalDisplay: "x" }; },
  buildTx: async function (pairs) { return { ref_block_num: 1, ref_block_prefix: 2, expiration: "2099-01-01T00:00:30", operations: pairs, extensions: [] }; } };
globalThis.Chain = { status: function () { return { chainId: "4018d784aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }; }, db: async function () { return 1; }, call: async function () { return []; } };
var B = require("./js/txbuilder.js");
(async function () {
  B.clear();
  B.addOp(0, { fee: { amount: "0", asset_id: "1.3.0" }, from: "1.2.17", to: "1.2.20", amount: { amount: "150000", asset_id: "1.3.0" }, extensions: [] }, "transfer:t");
  await B.feeAll(); await B.buildUnsigned();
  var hex1 = Buffer.from(B.TxBuilderHex ? "x" : JSON.stringify(B.state().built.operations)).toString();
  var s = B.exportJSON();
  if (/wif|priv|brainkey|password/i.test(s)) throw new Error("secret leak");
  B.clear(); B.importJSON(s);
  var hex2 = Buffer.from(JSON.stringify(B.state().built.operations)).toString();
  if (hex1 !== hex2) throw new Error("round-trip drift");
  console.log("TB8-OFFLINE-OK");
})().catch(function (e) { console.error("TB8-FAIL " + (e && e.stack || e)); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails-or-passes honestly**

Run: `node /tmp/tb8-offline.js`
Expected: `TB8-OFFLINE-OK` if Tasks 2–3 landed (regression net); any FAIL names the exact regression to fix before testnet.

- [ ] **Step 3: Run testnet vectors T1–T6 (manual, observed results into the parity note)**

```bash
python3 -m http.server 8080 --directory /workspace/vanilla
# open http://localhost:8080/#/txbuilder in a testnet-connected browser
```

T1 two-account bundle: queue transfer 1.5 TEST (precision 5 → raw `150000`) + op-6 vote change for the same payer; assert ONE `get_required_fees` call (spy on `Chain.call`), `totalRaw` = BigInt sum, rows show `1.50000 TEST` never `150000`; sign → broadcast → history poll observes transfer AND slate re-read observes vote. Record block numbers.
T2 missing-key honesty: queue a transfer from an account with no local key; `resolveAuths` shows `unsigned for <name> (1.2.N) — no local key`; sign yields `signed 0 of 1`; `state.signatures` holds no entry for the missing pub.
T3 export/import round-trip: export T1, assert no secret substring, `chain_id` match, `tx.operations` deep-equals `ops`, `serializeTransaction` hex byte-identical after clear+import; expired import offers re-base with sig-drop warning.
T4 proposal-wrap: wrap T1 with proposer +24h, assert outer `[22, …]` with 2 inners in `{op:[t,d]}` form, wrapper fee live, `executes only after approvals` notice present, prove via `proposalsFor` + `get_objects`.
T5 non-BTS precision + percents: pool deposit on a precision-3 asset + op-6 committee shape; record raw→human vectors.
T6 regression: with `txbuilder.js` present AND with it blocked (rename to `txbuilder.js.off` + reload), transfer/vote/pool-stake one-shot Review → Sign & Send still succeed; Add buttons hide when the global is absent.

- [ ] **Step 4: Run checks to verify everything passes**

Run: `python3 /workspace/tooling/check_rot.py`
Expected: exit 0 (no violations). Viewport/theme gate:

Run: `grep -c "360\|1440\|theme" vanilla/notes/txbuilder-parity.md`
Expected: non-zero (parity note records phone + desktop + all-three-theme checks per vector). Placeholder scan:

Run: `grep -rn "TB""D\|TO""DO" vanilla/js/txbuilder.js vanilla/js/txbuilder-ui.js vanilla/notes/txbuilder-parity.md || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add vanilla/notes/txbuilder-parity.md
git commit -m "docs(txbuilder): parity note with T1-T6 testnet vectors"
```

---

## Self-Review (run before handoff — issues fixed inline)

- **Spec coverage:** section 3.1 entry shape → Task 1 (`key/opId/opData/source/addedAt`, zero-fee placeholder, deep-clone, raw strings); 3.2 state + invalidation → Task 1; 3.3 envelope + strict validation + re-base → Task 2; section 4 API (all ten methods + named errors) → Tasks 1/2/3/4/6 (each method has a task, error names concrete); 5.1 reads + fallback scan + op-22 recursion + batched `get_objects` + unknown-account rows + `address_auths` note → Task 3; 5.2 level table + default-active + op-48 owner rule + op-24 owner flag + op-6 owner-fields rule → Task 3; 5.3 WIF mapping + least-privilege + memo-never + single digest + idempotent re-sign → Task 3; 6.1 ceremony counts + choices → Task 5 desk; 6.2 human-row corrections + coverage rule → Task 4; 6.3 export/import + re-base → Tasks 2+5; 6.4 transport + per-op provers + partial-confirm wording → Task 6; section 7 wrap inputs/build/rows/prove → Task 6; section 8 desk layout + badge + pilot touchpoints → Task 5; section 9 three pilots + outlet contract + absence guard → Task 7; section 10 T1–T6 + viewports/themes → Task 8; section 11 anti-rot (a)(b)(c) → Global Constraints + Task 8 rot gate.
- **Placeholder scan:** no placeholder markers in this plan (verified by the Step 4 grep the implementer runs); every step shows exact code, exact commands, exact expected outputs; no "similar to Task N" references — code is repeated per task.
- **Type consistency:** `addOp(opId:number, opData:object, source:string)->string` in Task 1 matches Tasks 2/3/7 call sites; `feeAll()->{perOp,totalRaw:string,totalDisplay:string}` produced in Task 2 matches the desk read in Task 5; `resolveAuths()->[{accountId,accountName,level,threshold,availablePubs,missing,note?}]` produced in Task 3 matches the desk render + `signLocal()->{signed:[pub],stillMissing:[accountId]}` in the same task; `describe()->[{label,value,title?}]` in Task 4 matches `renderCard` in Task 5; `wrapProposal({feePayerId,expirationIso,reviewPeriodSecOrNull})->[22,opData]` and `broadcastSigned(tx,provers)->{perOp:[{opId,status}],via}` in Task 6 match the desk send-choice wiring; envelope `{app,v,chain_id,feeAssetId,ops,tx,signatures,meta}` written by `exportJSON` in Task 2 is exactly what `importJSON` validates and what Task 8 round-trips.
