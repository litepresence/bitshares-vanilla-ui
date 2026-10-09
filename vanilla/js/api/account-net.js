/* AccountNet: account-to-account edge graph data (pure adapter, no DOM).
 * Owns: (1) the op-class table — which indexed operations describe a flow
 *   or a relation BETWEEN TWO ACCOUNTS; (2) the per-hit edge extractor with
 *   strict field validation; (3) per-party dedupe + per-asset aggregation
 *   into the {nodes, edges} shape the shipped network canvas consumes;
 *   (4) the paged ES walk over a seed's indexed history and the chain join
 *   that resolves a credit line's counter-offer owner. Every rule about
 *   "what counts as an edge" exists exactly once, here.
 * Consumes: HistoryCap.esSearch (the ONLY raw-ES seam — a direct fetch here
 *   is forbidden by the centralization rule), Chain.db/Chain.call
 *   (get_objects for the credit owner join), Account.resolve (seed ids),
 *   Format is NOT used here (amounts stay raw; the view renders them).
 *   Side effects: one HTTPS POST per page to the community index + chain
 *   reads, both lazy and best-effort. No signing, no storage, no tx build.
 *   Global AccountNet (also declared in globals.d.ts for the tsc gate).
 * MONEY DISCIPLINE: every amount stays a raw digit string. Aggregation sums
 *   BigInt per ASSET; two assets are never added together, and nothing here
 *   runs an amount through Number().
 * ES TRUTH (probed live 2026-10-08 against es.bitshares.dev, index
 * bitshares-*; the full probe record is in docs/parity/account-network.md):
 *   - account_history.account holds the account ID, and every operation is
 *     indexed ONCE PER PARTY (a transfer A->B yields two docs), so a scan
 *     must dedupe by block_num + account_history.operation_id.
 *   - the index's operation_type numbering disagrees with Tx.OP for
 *     10/11/22/23/39 (index 10 is asset_create, not min_to_receiver), so
 *     every extractor validates its expected field names and a mismatch is a
 *     counted skip — an op number alone never decides what a doc is.
 *   - `size` above 10000 returns HTTP 200 with ZERO hits, so ES_SIZE is
 *     pinned at the ceiling and depth comes from search_after paging.
 *   The transport half (ES walk, credit join, gather) lives in
 *   account-net-es.js and is re-exported here, so callers keep one import.
 * Created by: account-network spec (docs/superpowers/specs/
 *   2026-10-09-account-network-design.md), plan Task 1-3, brainstorm+audit
 *   with owner.
 */

/**
 * One account-to-account edge, as extracted from an indexed operation.
 * @typedef {Object} AccountNetEdge
 * @property {string} cls Class id (transfer/credit/override/debit/htlc/vesting).
 * @property {"flow"|"relation"} kind Flow (value moved) or relation (authority).
 * @property {string|null} from Sender/owner account id (null until the credit join fills it).
 * @property {string|null} to Recipient/borrower account id (null until joined).
 * @property {string|null} amountRaw Raw integer string; null when the op carries none.
 * @property {string|null} assetId 1.3.x asset of amountRaw.
 * @property {string|null} time ISO block time.
 * @property {number|null} blockNum Block height.
 * @property {number|null} opId account_history.operation_id (the dedupe partner).
 * @property {number} opType Indexed operation type.
 * @property {{offerId?:string, dealId?:string}|null} refs Pending credit join.
 */

/**
 * classify() result: either a complete edge, or a skip reason (with the
 * partial edge attached for the credit "needs-join" case).
 * @typedef {Object} AccountNetClassify
 * @property {AccountNetEdge} [edge] The extracted edge (absent on a plain skip).
 * @property {string} [skip] shape | unknown-op | disabled | no-endpoint | self | needs-join.
 */

/**
 * The aggregated graph handed to PoolNetUI.mount.
 * @typedef {Object} AccountNetGraph
 * @property {Array<{assetId:string, sym:?string, seeded:boolean, degree:number,
 *   count:number, weightRaw:string}>} nodes Node records (sym = account name).
 * @property {Array<{a:string, b:string, poolId:string, cls:string, kind:string,
 *   count:number, perAsset:Object<string,string>, weightRaw:string,
 *   firstSeen:?string, lastSeen:?string}>} edges Edge records; perAsset maps
 *   assetId -> raw digit string (never summed across assets).
 * @property {Object} stats Counters + caps for the page's honesty line.
 */
var AccountNet = (function () {
  "use strict";

  /* Page size 1000, NOT the index's 10000 ceiling: a whale account's 10k-hit
   * page measured 1.8MB (transfer+credit) to ~4MB wide-source, while a
   * 1000-hit page is ~0.9MB — and a cap smaller than a page would make the
   * search_after walk unreachable dead code. 10000 stays the documented hard
   * ceiling we never cross (measured: above it ES answers 200 with 0 hits). */
  var ES_SIZE = 1000;
  var ES_SIZE_CEILING = 10000;
  var SCAN_CAP = 5000;      // hits kept per seed (spans up to 5 pages)
  var SCAN_MAX_PAGES = 6;
  var SCAN_TIMEOUT_MS = 30000;
  var NODE_CAP = 40;        // counterparties shown besides the seeds
  var EDGE_CAP = 400;
  var MAX_SEEDS = 12;

  /* Op classes. `kind` is load-bearing honesty: a line that is not a
   * movement of value (a direct-debit permission, vesting authority) must
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

  /** @type {Object<string,string>} op id -> class id (built, never hand-kept). */
  var CLASS_BY_OP = {};
  Object.keys(CLASSES).forEach(function (id) {
    CLASSES[id].ops.forEach(function (op) { CLASS_BY_OP[String(op)] = id; });
  });

  /* Per-op extraction table. Each entry returns the two account ids and the
   * amount leg for THAT op's real indexed field shape (probed 2026-10-08);
   * null means "this doc has no counterpart pair" and classify() then
   * reports shape (fields missing) or no-endpoint (op has no extractor).
   * Ops deliberately WITHOUT an extractor, because they name one account
   * only: credit 69/70/71 (offer lifecycle), credit 76 (auto-repay flag),
   * htlc 50 (redeem: htlc_id + redeemer), htlc 52 (extend: update_issuer).
   * They ride along in the query because the class ships them together, and
   * they are NOT counted as errors — they simply have no line to draw. */
  var EXTRACT = {
    0: function (o) { return leg(o, "from", "to", o.amount_); },              // transfer
    38: function (o) { return leg(o, "from", "to", o.amount_); },             // override_transfer
    72: function (o) { return pending(o, "offerId", o.offer_id, "borrower", "to", o.borrow_amount); },
    73: function (o) { return pending(o, "dealId", o.deal_id, "account", "from", o.repay_amount); },
    25: function (o) { return leg(o, "withdraw_from_account", "authorized_account", o.withdrawal_limit); },
    26: function (o) { return leg(o, "withdraw_from_account", "authorized_account", o.withdrawal_limit); },
    27: function (o) { return leg(o, "withdraw_from_account", "withdraw_to_account", o.amount_to_withdraw); },
    28: function (o) { return leg(o, "withdraw_from_account", "authorized_account", o.withdrawal_limit); },
    49: function (o) { return leg(o, "from", "to", o.amount_); },              // htlc create
    51: function (o) { return leg(o, "from", "to", o.amount_); },              // htlc update w/ preimage
    34: function (o) { return leg(o, "initializer", "owner_", null); }        // vesting authority
  };

  /**
   * Strict 1.2.x account id reader. Anything else (a name, a pool id, an
   * asset id, an object) is rejected: an edge endpoint must be an account.
   * @param {*} v Raw field value.
   * @returns {string|null} Canonical account id, or null.
   */
  function acct(v) {
    var s = v === undefined || v === null ? "" : String(v);
    return /^1\.2\.\d+$/.test(s) ? s : null;
  }

  /**
   * One indexed amount leg -> {raw, assetId}, or null when it is not a
   * clean unsigned integer over a real asset id. A negative or malformed
   * amount contributes NOTHING (never a zero, never a float).
   * @param {*} leg {amount, asset_id} as indexed.
   * @returns {{raw:string, assetId:string}|null}
   */
  function amountOf(leg) {
    if (!leg || typeof leg !== "object") return null;
    var a = String(leg.amount === undefined ? "" : leg.amount);
    var id = String(leg.asset_id === undefined ? "" : leg.asset_id);
    if (!/^\d+$/.test(a) || !/^1\.3\.\d+$/.test(id)) return null;
    return { raw: a, assetId: id };
  }

  /**
   * Straight two-account edge (both ends named by the op itself).
   * @param {Object} o op_object.
   * @param {string} fromKey @param {string} toKey Field names.
   * @param {*} amountLeg Amount leg for this op (may be null).
   * @returns {{from:string,to:string,amountRaw:?string,assetId:?string}|null}
   */
  function leg(o, fromKey, toKey, amountLeg) {
    var f = acct(o[fromKey]), t = acct(o[toKey]);
    if (!f || !t) return null;
    var amt = amountOf(amountLeg);
    return { from: f, to: t, amountRaw: amt ? amt.raw : null, assetId: amt ? amt.assetId : null };
  }

  /**
   * A credit line names the borrower (or the repaying account) plus a
   * reference; the LENDER arrives later from the chain join (creditOwners),
   * so this returns which end is known rather than guessing the other.
   * @param {Object} o op_object.
   * @param {string} refKey "offerId"|"dealId"
   * @param {*} refVal Referenced object id.
   * @param {string} whoKey Field naming the known account.
   * @param {string} slot Which end the known account sits on ("from"/"to").
   * @param {*} amountLeg Amount leg for this op.
   * @returns {{known:string,slot:string,refs:Object,amountRaw:?string,assetId:?string}|null}
   */
  function pending(o, refKey, refVal, whoKey, slot, amountLeg) {
    var who = acct(o[whoKey]);
    var ref = String(refVal === undefined ? "" : refVal);
    if (!who || !/^1\.2[12]\.\d+$/.test(ref)) return null;
    var amt = amountOf(amountLeg);
    var refs = {};
    refs[refKey] = ref;
    return { known: who, slot: slot, refs: refs,
      amountRaw: amt ? amt.raw : null, assetId: amt ? amt.assetId : null };
  }

  /**
   * enabled: class-id set -> lookup object for classify().
   * @param {string[]|null} ids Class ids; null/empty means the defaults.
   * @returns {Object<string,boolean>}
   */
  function enabled(ids) {
    var out = {};
    /* null/undefined means "no opinion" (defaults apply); an explicit []
     * means the caller turned EVERYTHING off, which must not silently
     * become the defaults. */
    var list = (ids === null || ids === undefined) ? DEFAULT_CLASSES : ids;
    (Array.isArray(list) ? list : []).forEach(function (id) {
      if (CLASSES[id]) out[id] = true;
    });
    return out;
  }

  /**
   * opUnion: the op ids a scan must request for a class selection.
   * @param {string[]|null} ids Class ids; null/empty means the defaults.
   * @returns {number[]} Deduped, ascending op ids.
   * @throws {Error} "class-union-too-big" above OP_UNION_CAP.
   */
  function opUnion(ids) {
    var seen = {}, out = [];
    (ids && ids.length ? ids : DEFAULT_CLASSES).forEach(function (id) {
      var c = CLASSES[id];
      if (!c) return;
      c.ops.forEach(function (op) {
        var k = String(op);
        if (!seen[k]) { seen[k] = 1; out.push(op); }
      });
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  /**
   * classify: one indexed hit -> one edge, or a counted skip reason.
   * Never throws; a malformed doc is a skip, never a guess.
   * @param {Object} hit An ES hit ({_source:...}).
   * @param {{enabled?:Object, seedId?:string}} [opts]
   * @returns {AccountNetClassify} `skip` is one of shape | unknown-op |
   *   disabled | no-endpoint | self | needs-join. "needs-join" carries the
   *   partial edge (credit lines) so the caller can route it to creditOwners().
   */
  function classify(hit, opts) {
    try {
      opts = opts || {};
      var en = opts.enabled || enabled(null);
      var s = hit && hit._source;
      if (!s || typeof s !== "object") return { skip: "shape" };
      var opType = Number(s.operation_type);
      if (!isFinite(opType)) return { skip: "shape" };
      var cls = CLASS_BY_OP[String(opType)];
      if (!cls) return { skip: "unknown-op" };
      if (!en[cls]) return { skip: "disabled" };
      var fn = EXTRACT[opType];
      if (!fn) return { skip: "no-endpoint" };
      var oo = (s.operation_history || {}).op_object;
      if (!oo || typeof oo !== "object") return { skip: "shape" };
      var got = fn(oo);
      if (!got) return { skip: "shape" };
      var bd = s.block_data || {};
      var ah = s.account_history || {};
      var edge = {
        cls: cls, kind: CLASSES[cls].kind, opType: opType,
        from: null, to: null,
        amountRaw: got.amountRaw, assetId: got.assetId,
        refs: got.refs || null,
        time: bd.block_time || null,
        blockNum: bd.block_num === undefined || bd.block_num === null ? null : Number(bd.block_num),
        opId: ah.operation_id === undefined || ah.operation_id === null ? null : Number(ah.operation_id)
      };
      if (got.known) edge[got.slot] = got.known;
      else { edge.from = got.from; edge.to = got.to; }
      /* A credit line stays incomplete until creditOwners() fills the other
       * end; report it rather than dropping a real operation. */
      if (!edge.from || !edge.to) return { skip: "needs-join", edge: edge };
      if (edge.from === edge.to) return { skip: "self" };
      return { edge: edge };
    } catch (e) { return { skip: "shape" }; }
  }

  /**
   * edgeKey: the aggregation identity of an edge (direction + class).
   * @param {AccountNetEdge} e
   * @returns {string} "from|to|cls"
   */
  function edgeKey(e) {
    return String(e && e.from) + "|" + String(e && e.to) + "|" + String(e && e.cls);
  }

  /**
   * dedupeKey: the index stores ONE DOC PER PARTY (measured), so the same
   * operation arrives twice when both ends are seeds. block_num +
   * operation_id is stable across those copies.
   * @param {Object} hit An ES hit.
   * @returns {string|null} "block|opId", or null when the doc carries neither.
   */
  function dedupeKey(hit) {
    try {
      var s = (hit && hit._source) || {};
      var b = (s.block_data || {}).block_num;
      var o = (s.account_history || {}).operation_id;
      if (b === undefined || b === null || o === undefined || o === null) return null;
      return String(b) + "|" + String(o);
    } catch (e) { return null; }
  }

  /**
   * addRaw: BigInt addition of two raw digit strings. A malformed leg adds
   * nothing (never a zero, never a float round-trip).
   * @param {string} a Current raw digit string.
   * @param {string} b Added raw digit string.
   * @returns {string} Summed raw digit string.
   */
  function addRaw(a, b) {
    if (typeof a !== "string" || !/^\d+$/.test(a)) return "0";
    if (typeof b !== "string" || !/^\d+$/.test(b)) return a;
    try { return (BigInt(a) + BigInt(b)).toString(); } catch (e) { return a; }
  }

  /**
   * buildGraph: extracted edges -> the {nodes, edges} shape
   * PoolNetUI.mount consumes (node.assetId/node.sym, edge.a/edge.b/edge.poolId).
   * Pure. Seeds always survive the node cap; every cap that bites is
   * reported in stats.caps so the page can say so.
   * @param {AccountNetEdge[]} edges Extracted edges (join already applied).
   * @param {Array<{id:string,name:string}>} seeds Resolved seed accounts.
   * @param {{nodeCap?:number, edgeCap?:number, scanned?:number, scanCapHit?:boolean,
   *   droppedSelf?:number, droppedShape?:number, needsJoin?:number}} [opts]
   * @returns {AccountNetGraph}
   */
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
          count: 0, perAsset: {}, firstSeen: null, lastSeen: null, weightRaw: "0" };
        order.push(k);
      }
      cur.count++;
      if (e.assetId && typeof e.amountRaw === "string" && /^\d+$/.test(e.amountRaw)) {
        cur.perAsset[e.assetId] = addRaw(cur.perAsset[e.assetId] || "0", e.amountRaw);
      }
      if (e.time) {
        if (!cur.firstSeen || e.time < cur.firstSeen) cur.firstSeen = e.time;
        if (!cur.lastSeen || e.time > cur.lastSeen) cur.lastSeen = e.time;
      }
    });
    /* Weight for ranking: the LARGEST single asset sum (digit-length
     * comparison on raw strings), never a sum across assets. */
    order.forEach(function (k) {
      var e = byKey[k], best = "0", bestLen = 0;
      Object.keys(e.perAsset).forEach(function (aid) {
        var v = e.perAsset[aid];
        var len = v.replace(/^0+/, "").length;
        if (len > bestLen) { best = v; bestLen = len; }
      });
      e.weightRaw = best;
    });
    var ranked = order.slice().sort(function (x, y) {
      var ea = byKey[x], eb = byKey[y];
      if (eb.count !== ea.count) return eb.count - ea.count;
      return eb.weightRaw.length - ea.weightRaw.length;
    });
    var caps = { nodeCapHit: false, edgeCapHit: false, scanCapHit: !!opts.scanCapHit };
    var kept = ranked.slice(0, edgeCap);
    if (kept.length < ranked.length) caps.edgeCapHit = true;
    var degree = {}, weight = {};
    kept.forEach(function (k) {
      var e = byKey[k];
      [e.a, e.b].forEach(function (id) {
        degree[id] = (degree[id] || 0) + 1;
        try { weight[id] = (BigInt(weight[id] || "0") + BigInt(e.weightRaw || "0")).toString(); } catch (x) { /* keep 0 */ }
      });
    });
    var others = Object.keys(degree).filter(function (id) { return !seedIds[id]; })
      .sort(function (a, b) {
        if (degree[b] !== degree[a]) return degree[b] - degree[a];
        if (weight[b].length !== weight[a].length) return weight[b].length - weight[a].length;
        return weight[b] > weight[a] ? 1 : (weight[b] < weight[a] ? -1 : 0);
      });
    /* NODE_CAP is counterparties BESIDE the seeds: the seeds are the point of
     * the draw and always survive (spec: "seeds always + top NODE_CAP
     * counterparties"). */
    var shown = others.slice(0, Math.max(0, nodeCap));
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

  /* The transport half (ES walk, credit join, gather) lives in
   * account-net-es.js and is attached here so callers keep ONE import.
   * Resolved at call time: in the browser the script tag loads it first; in
   * node suites module.require pulls it in on first use, which is after this
   * module finished loading (no cycle). A missing half rejects with an
   * honest error instead of throwing a TypeError at the call site. */
  function _esPart() {
    try {
      if (typeof AccountNetES !== "undefined" && AccountNetES) return AccountNetES;
    } catch (e) { /* fall through */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.AccountNetES) return globalThis.AccountNetES;
    } catch (e2) { /* fall through */ }
    /* Node suites require() this file directly while the browser loads the
     * sibling via <script> order. Same seam-cast tx.js / pool-net-ui.js use:
     * checkJs runs browser libs, so a bare require() would be TS2591. */
    try {
      if (typeof module !== "undefined" && module && /** @type {any} */ (module).require) {
        return /** @type {any} */ (module).require("/workspace/vanilla/js/api/account-net-es.js");
      }
    } catch (e3) { /* not loadable here */ }
    return null;
  }
  function _delegate(name) {
    return function () {
      var part = _esPart();
      if (!part || typeof part[name] !== "function") {
        if (name === "gather") return Promise.reject(new Error("es-unavailable"));
        throw new Error("account-net-es-missing:" + name);
      }
      return part[name].apply(null, arguments);
    };
  }

  return {
    CLASSES: CLASSES, DEFAULT_CLASSES: DEFAULT_CLASSES,
    ES_SIZE: ES_SIZE, ES_SIZE_CEILING: ES_SIZE_CEILING,
    SCAN_CAP: SCAN_CAP, SCAN_MAX_PAGES: SCAN_MAX_PAGES,
    SCAN_TIMEOUT_MS: SCAN_TIMEOUT_MS, NODE_CAP: NODE_CAP, EDGE_CAP: EDGE_CAP,
    MAX_SEEDS: MAX_SEEDS,
    enabled: enabled, opUnion: opUnion, classify: classify, edgeKey: edgeKey,
    dedupeKey: dedupeKey, buildGraph: buildGraph,
    esQuery: _delegate("esQuery"),
    scanSeed: _delegate("scanSeed"), creditOwners: _delegate("creditOwners"),
    creditIndexOwners: _delegate("creditIndexOwners"), gather: _delegate("gather"),
    _test: { EXTRACT: EXTRACT, CLASS_BY_OP: CLASS_BY_OP, amountOf: amountOf, acct: acct }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNet === "undefined") { globalThis.AccountNet = AccountNet; }
if (typeof module !== "undefined") { module.exports = AccountNet; }
