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

  /* Pairs view: live [opId, opData] references (fee fill writes through). */
  function _pairs() {
    return _ops.map(function (e) { return [e.opId, e.opData]; });
  }

  /* Chain-id guard: every build/import must know which chain it targets. */
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

  TxBuilder.addOp = addOp;
  TxBuilder.removeOp = removeOp;
  TxBuilder.clear = clear;
  TxBuilder.setFeeAsset = setFeeAsset;
  TxBuilder.list = list;
  TxBuilder.count = count;
  TxBuilder.subscribe = subscribe;
  TxBuilder.state = state;
  TxBuilder.feeAll = feeAll;
  TxBuilder.buildUnsigned = buildUnsigned;
  TxBuilder.exportJSON = exportJSON;
  TxBuilder.importJSON = importJSON;
  // feeAll / resolveAuths / buildUnsigned / signLocal / describe / wrapProposal /
  // exportJSON / importJSON / broadcastSigned land in Tasks 2-4+6 on this same global.
  if (typeof globalThis !== "undefined") { globalThis.TxBuilder = TxBuilder; }
})();

if (typeof module !== "undefined") { module.exports = TxBuilder; }
