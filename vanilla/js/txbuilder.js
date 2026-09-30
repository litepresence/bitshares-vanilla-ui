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
