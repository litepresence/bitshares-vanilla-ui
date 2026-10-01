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

  /**
   * @typedef {import('./types.js').OpTuple} OpTuple
   * @typedef {import('./types.js').TxEnvelope} TxEnvelope
   * @typedef {import('./types.js').CountResult} CountResult
   * @typedef {import('./types.js').FeeAssetId} FeeAssetId
   */

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

  /* Deep-clone via JSON (opData is plain chain JSON — no functions, no cycles).
   * Params: o (plain object). Returns a detached copy. Fails: throws on
   * cyclic/non-serializable input (never happens for chain opData). */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* Invalidate every derived answer on any queue mutation (no silent staleness).
   * Params: none. Returns nothing. Fails: never. */
  function invalidate() {
    _fees = null; _requiredAuths = null; _signatures = []; _chainId = null; _built = null;
  }

  /* notify: fan out a state() snapshot to every subscriber.
   * Params: none (reads module state). Returns nothing.
   * Fails: never throws — one bad listener is swallowed so the composer stands. */
  function notify() {
    var s = state();
    for (var i = 0; i < _subs.length; i++) {
      try { _subs[i](s); } catch (e) { /* one bad listener never breaks the composer */ }
    }
  }

  /* hasSerializer: presence check only — rejects opIds with no serializer.
   * Params: opId (integer, unused beyond the presence contract — every known
   * op shares the single Tx._ser table). Returns boolean.
   * Fails: never throws (try/catch yields false when Tx is absent). */
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

  /* Remove one queued entry by its local key.
   * Params: key (string, "tb-NNNN-xxxx"). Returns true when removed,
   * false when the key is unknown. Fails: never throws. */
  function removeOp(key) {
    for (var i = 0; i < _ops.length; i++) {
      if (_ops[i].key === key) { _ops.splice(i, 1); invalidate(); notify(); return true; }
    }
    return false;
  }

  /* Clear the whole queue (derived answers invalidated, subscribers told).
   * Params: none. Returns nothing. Fails: never. */
  function clear() { _ops = []; invalidate(); notify(); }

  /* Set the single fee asset for the next feeAll quote.
   * Params: assetId (string "1.3.N"). Returns nothing.
   * Fails: throws tb-bad-asset on any non-1.3.N string. */
  function setFeeAsset(assetId) {
    if (typeof assetId !== "string" || !/^1\.3\.\d+$/.test(assetId)) throw new Error("tb-bad-asset: fee asset must be 1.3.N, got " + JSON.stringify(assetId));
    _feeAssetId = assetId;
    invalidate();
    notify();
  }

  /* list: shallow copy of queued entries (callers must not mutate module state).
   * Params: none. Returns array of entry objects. Fails: never. */
  function list() { return _ops.slice(); }
  /* count: queue length for the header badge + pilot confirm screens.
   * Params: none. Returns integer >= 0. Fails: never. */
  function count() { return _ops.length; }

  /* Subscribe to composer state snapshots (header badge + desk re-render).
   * Params: fn (function receiving one state() snapshot). Returns an
   * unsubscribe function. Fails: throws tb-bad-op when fn is not a function. */
  function subscribe(fn) {
    if (typeof fn !== "function") throw new Error("tb-bad-op: subscribe needs a function");
    _subs.push(fn);
    return function off() {
      var i = _subs.indexOf(fn);
      if (i >= 0) _subs.splice(i, 1);
    };
  }

  /* state: point-in-time snapshot for views (arrays defensively copied).
   * Params: none. Returns {ops, feeAssetId, fees, requiredAuths,
   * availablePubs, signatures, chainId, built}. Fails: never. */
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
    // Shape bridge: shipped Tx.feeMulti answers {fees,...} while the Task 2
    // stub (and the contract) say {perOp,...} — accept both, never undefined.
    var per = ans.perOp || ans.fees;
    if (!Array.isArray(per)) throw new Error("tb-bad-envelope: fee answer has no per-op list");
    _fees = { perOp: per, totalRaw: String(ans.totalRaw), totalDisplay: String(ans.totalDisplay) };
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
    /* Expiry validates BEFORE any state mutation: a failed import must leave
     * the live queue, fees, and built envelope untouched (a throw after
     * assignment would clobber good state with an unusable envelope). */
    if (!env.tx.expiration || !Number.isFinite(Date.parse(env.tx.expiration + "Z"))) throw new Error("tb-bad-envelope: tx.expiration missing");
    if (Date.parse(env.tx.expiration + "Z") < Date.now()) throw new Error("tb-expired: envelope expired — re-base to continue (old signatures are dropped)");
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
    notify();
    return { ops: list(), signatures: _signatures.slice(), requiredAuths: _requiredAuths };
  }

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

  /** Sign with every distinct matching local WIF (append-only; same-pub re-sign
   * replaces its entry). Locked wallet throws tb-wallet-locked.
   * @returns {Promise<any>} */
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
      var sig = await /** @type {any} */ (globalThis.Crypto).signHash(digest, wifs[i].wif);
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

  /* Best-effort account name lookup; falls back to bare id plus a marker. */
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

  /* Format one raw amount slot; degrades to a labelled raw string, never blank. */
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
      rows.push({ label: "Voting account", value: no.voting_account ? await _nameOf(no.voting_account) : "—" });
      rows.push({ label: "Votes", value: String(((no.votes || []).length) + " selected") });
      rows.push({ label: "Witnesses / committee", value: String(no.num_witness == null ? "—" : no.num_witness) + " / " + String(no.num_committee == null ? "—" : no.num_committee) });
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
  TxBuilder.resolveAuths = resolveAuths;
  TxBuilder.signLocal = signLocal;
  TxBuilder.describe = describe;
  TxBuilder.wrapProposal = wrapProposal;
  TxBuilder.broadcastSigned = broadcastSigned;
  // feeAll / resolveAuths / buildUnsigned / signLocal / describe / wrapProposal /
  // exportJSON / importJSON / broadcastSigned land in Tasks 2-4+6 on this same global.
  if (typeof globalThis !== "undefined") { globalThis.TxBuilder = TxBuilder; }
})();

if (typeof module !== "undefined") { module.exports = TxBuilder; }
