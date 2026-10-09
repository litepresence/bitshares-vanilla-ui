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

  /* HistoryCap seam (the ONLY raw-ES path). Classic-script global in the
   * browser, globalThis preload in node suites. Missing => null => scanSeed
   * rejects and the view shows the honest reason; never a direct fetch. */
  function _historyCap() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.esSearch === "function") return HistoryCap;
    } catch (e) { /* fall through to globalThis */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.HistoryCap && typeof globalThis.HistoryCap.esSearch === "function") return globalThis.HistoryCap;
    } catch (e) { /* no seam */ }
    return null;
  }

  /* ES pref gate (esEnabled; missing HistoryCap reads as ON, then
   * scanSeed rejects on the missing seam anyway). */
  function _esOn() {
    try {
      var HC = _historyCap();
      if (HC && typeof HC.esAllowed === "function") return HC.esAllowed() !== false;
    } catch (e) { /* ON stands */ }
    return true;
  }

  /**
   * esQuery: one seed's indexed history for a set of ops, newest first.
   * account_history.account is an exact id term (verified 2026-10-08).
   * @param {string} seedId 1.2.x account id.
   * @param {number[]} opIds Operation types to request.
   * @param {Array<*>} [searchAfter] Previous page's last sort, verbatim.
   * @returns {Object} ES query body.
   */
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

  /**
   * scanSeed: paged walk of one account's indexed history, capped.
   * Resolves {hits, scanned, truncated}; rejects "es-disabled" /
   * "es-unavailable" / "bad-account-id" so the view can say WHY. A page that
   * fails mid-walk keeps what it fetched and reports truncated (the candle
   * deep walk's honesty rule).
   * @param {string} seedId 1.2.x account id.
   * @param {number[]} opIds Ops to request (opUnion).
   * @param {{cap?:number, maxPages?:number, timeoutMs?:number}} [opts]
   * @returns {Promise<{hits:Array, scanned:number, truncated:boolean}>}
   */
  function scanSeed(seedId, opIds, opts) {
    opts = opts || {};
    var cap = opts.cap === undefined ? SCAN_CAP : Math.max(1, Math.floor(opts.cap));
    var maxPages = opts.maxPages === undefined ? SCAN_MAX_PAGES : Math.max(1, Math.floor(opts.maxPages));
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
      /* A mid-walk failure keeps the pages already fetched (the map still
       * draws) and reports truncation; only a page-1 failure rejects so the
       * view can show the reason. This settles ITSELF rather than calling
       * finish(): finish() guards on done, and fail() already claimed it. */
      function fail(e) {
        if (done) return;
        done = true;
        if (hits.length) {
          truncated = true;
          resolve({ hits: hits, scanned: hits.length, truncated: true });
          return;
        }
        reject(e instanceof Error ? e : new Error("es-unavailable"));
      }
      function page() {
        if (done) return;
        if (pages >= maxPages) { truncated = true; finish(); return; }
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

  /* Chunked get_objects: the chain caps arrays it will take, so ids go in
   * slices of 100 and the slices run in order. */
  var OBJECT_CHUNK = 100;
  function fetchObjects(ids) {
    var steps = [];
    for (var i = 0; i < ids.length; i += OBJECT_CHUNK) steps.push(ids.slice(i, i + OBJECT_CHUNK));
    return steps.reduce(function (p, chunk) {
      return p.then(function (acc) {
        return Chain.db().then(function (api) { return Chain.call(api, "get_objects", [chunk]); })
          .then(function (rows) { return acc.concat(rows || []); });
      });
    }, Promise.resolve([]));
  }

  /**
   * creditOwners: op 72 names a borrower + offer_id and op 73/76 an account
   * + deal_id, so the LENDER is the offer owner (deal -> offer -> owner).
   * One chunked get_objects pass each way. Missing objects land in
   * `missing` — the caller drops those lines and says so. Never guesses.
   * @param {{offerId?:string[], dealId?:string[]}} refs Referenced ids.
   * @returns {Promise<{offer:Object, deal:Object, missing:string[],
   *   viaIndex:{offers:number, deals:number}}>} viaIndex counts how many
   *   owners came from the index rather than a live chain object.
   */
  function creditOwners(refs) {
    refs = refs || {};
    var offerIds = (refs.offerId || []).filter(function (v) { return /^1\.21\.\d+$/.test(String(v)); });
    var dealIds = (refs.dealId || []).filter(function (v) { return /^1\.22\.\d+$/.test(String(v)); });
    var out = { offer: {}, deal: {}, missing: [], viaIndex: { offers: 0, deals: 0 } };
    if (!offerIds.length && !dealIds.length) return Promise.resolve(out);
    return fetchObjects(offerIds.concat(dealIds)).then(function (rows) {
      var dealOffer = {};
      (rows || []).forEach(function (o) {
        if (!o || !o.id) return;
        var id = String(o.id);
        /* credit_offer_object carries owner_account, NOT owner (verified live
         * 2026-10-09 against 1.21.79: {"owner_account":"1.2.1809211",...}).
         * Reading `owner` here reported every credit line missing. `owner` is
         * accepted as a fallback for index/shape drift. */
        if (/^1\.21\./.test(id)) {
          var own = o.owner_account || o.owner;
          if (own) out.offer[id] = String(own);
        } else if (/^1\.22\./.test(id)) {
          if (o.offer_id) dealOffer[id] = String(o.offer_id);
        }
      });
      var wanted = [];
      Object.keys(dealOffer).forEach(function (d) {
        if (out.offer[dealOffer[d]]) return;   // the offer came back in the first pass
        if (wanted.indexOf(dealOffer[d]) === -1) wanted.push(dealOffer[d]);
      });
      return fetchObjects(wanted).then(function (offers) {
        (offers || []).forEach(function (o) {
          if (!o || !o.id) return;
          var own = o.owner_account || o.owner;
          if (own) out.offer[String(o.id)] = String(own);
        });
        Object.keys(dealOffer).forEach(function (d) {
          var own = out.offer[dealOffer[d]];
          if (own) out.deal[d] = own;
        });
        /* Anything the chain could not answer (deleted object) gets one
         * index pass before it is called missing — see creditIndexOwners. */
        var stillMissingDeals = dealIds.filter(function (d) { return !out.deal[d]; });
        var stillMissingOffers = offerIds.filter(function (id) { return !out.offer[id]; });
        return creditIndexOwners({ offerId: stillMissingOffers, dealId: stillMissingDeals })
          .then(function (idx) {
            Object.keys(idx.deal).forEach(function (d) { if (!out.deal[d]) out.deal[d] = idx.deal[d]; });
            Object.keys(idx.offer).forEach(function (id) { if (!out.offer[id]) out.offer[id] = idx.offer[id]; });
            out.viaIndex = idx.viaIndex;
            /* Sweep the REQUESTED ids, not just the ones a pass returned: a
             * reference nobody can resolve must be REPORTED, never silently
             * dropped and never drawn with a guessed counterparty. */
            dealIds.forEach(function (d) { if (!out.deal[d]) out.missing.push(d); });
            offerIds.forEach(function (id) { if (!out.offer[id]) out.missing.push(id); });
            return out;
          });
      });
    }).catch(function () {
      /* A failed join resolves NO owners: every reference is reported
       * missing rather than guessed, and the lines are dropped. */
      offerIds.concat(dealIds).forEach(function (id) { out.missing.push(id); });
      return out;
    });
  }

  /* creditIndexOwners: resolve references the chain can NO LONGER answer.
   *
   * Why this exists (measured 2026-10-09): credit offers and deals are
   * deleted objects — `get_objects(["1.22.209"])` returns [null] on a live
   * node — while their operations live on forever in the history index. For
   * account 1.2.1804436 that left 49 of 52 credit lines unresolvable, i.e.
   * the Credit class drew almost nothing.
   *
   * The index can answer, because the create operation carries the id it
   * minted (both term-filterable, verified live 2026-10-09):
   *   op 69 (offer create): result_object.data_string = the offer id,
   *                          op_object.owner_account = the lender
   *   op 72 (offer accept): result_object.data_object.new_objects[0] = the
   *                          DEAL id, plus op_object.offer_id (the offer it
   *                          came from) and data_object.impacted_accounts[0]
   *                          (the lender)
   * One query per kind, with a terms filter over every referenced id, so the
   * whole batch costs two requests. Every line resolved this way is reported
   * as `viaIndex` so the page can disclose it — the lender is read from an
   * immutable operation, not guessed, but it is still not the live object.
   * @param {{offerId?:string[], dealId?:string[]}} refs Referenced ids.
   * @returns {Promise<{offer:Object, deal:Object, viaIndex:Object}>}
   */
  function creditIndexOwners(refs) {
    refs = refs || {};
    var dealIds = (refs.dealId || []).filter(function (v) { return /^1\.22\.\d+$/.test(String(v)); });
    var offerIds = (refs.offerId || []).filter(function (v) { return /^1\.21\.\d+$/.test(String(v)); });
    var out = { offer: {}, deal: {}, viaIndex: { offers: 0, deals: 0 } };
    if (!dealIds.length && !offerIds.length) return Promise.resolve(out);
    var HC = _historyCap();
    if (!HC || !_esOn()) return Promise.resolve(out);
    /* deal -> {offerId, lender} straight off the accept operation. */
    var dealQuery = {
      track_total_hits: false,
      size: ES_SIZE,
      _source: ["operation_history", "operation_type"],
      query: { bool: { filter: [
        { term: { operation_type: 72 } },
        { terms: { "operation_history.operation_result_object.data_object.new_objects.keyword": dealIds } } ] } }
    };
    /* offer -> lender straight off the create operation. */
    var offerQuery = {
      track_total_hits: false,
      size: ES_SIZE,
      _source: ["operation_history", "operation_type"],
      query: { bool: { filter: [
        { term: { operation_type: 69 } },
        { terms: { "operation_history.operation_result_object.data_string.keyword": offerIds } } ] } }
    };
    var step = function (q) {
      try { return HC.esSearch("bitshares-*", q, { timeoutMs: 10000 }); }
      catch (e) { return Promise.reject(e); }
    };
    return Promise.all([dealIds.length ? step(dealQuery).catch(function () { return null; }) : null,
      offerIds.length ? step(offerQuery).catch(function () { return null; }) : null])
      .then(function (both) {
        var dealRes = both[0], offerRes = both[1];
        var seenDeal = {}, seenOffer = {};
        if (dealRes && dealRes.hits) {
          (dealRes.hits.hits || []).forEach(function (h) {
            var s = (h && h._source) || {};
            var oh = s.operation_history || {};
            var oo = oh.op_object || {};
            var res = oh.operation_result_object || {};
            var data = res.data_object || {};
            var created = Array.isArray(data.new_objects) ? data.new_objects : [];
            var impacted = Array.isArray(data.impacted_accounts) ? data.impacted_accounts : [];
            var lender = acct(impacted[0]);
            var offer = String(oo.offer_id || "");
            for (var i = 0; i < created.length; i++) {
              var dealId = String(created[i] || "");
              if (!/^1\.22\.\d+$/.test(dealId) || seenDeal[dealId]) continue;
              seenDeal[dealId] = 1;
              if (lender && /^1\.21\.\d+$/.test(offer)) {
                out.deal[dealId] = lender;
                if (!out.offer[offer]) out.offer[offer] = lender;
                out.viaIndex.deals++;
              } else if (lender) {
                /* the accept op gave us no offer id: keep the lender under a
                 * per-deal key so the caller can still draw the line */
                out.deal[dealId] = lender;
                out.viaIndex.deals++;
              }
            }
          });
        }
        if (offerRes && offerRes.hits) {
          (offerRes.hits.hits || []).forEach(function (h) {
            var s = (h && h._source) || {};
            var oh = s.operation_history || {};
            var oo = oh.op_object || {};
            var lender = acct(oo.owner_account);
            if (!lender) return;
            var created = String((oh.operation_result_object || {}).data_string || "");
            if (!/^1\.21\.\d+$/.test(created) || seenOffer[created]) return;
            seenOffer[created] = 1;
            if (!out.offer[created]) { out.offer[created] = lender; out.viaIndex.offers++; }
          });
        }
        return out;
      })
      .catch(function () { return out; });   /* index down => stay honest, draw less */
  }

  /**
   * collectRefs: route a pending credit edge's reference into the join set.
   * @param {AccountNetEdge} edge Edge carrying refs.
   * @param {{offerId:string[], dealId:string[]}} refs Accumulator (mutated).
   * @returns {void}
   */
  function collectRefs(edge, refs) {
    if (!edge || !edge.refs) return;
    if (edge.refs.offerId && refs.offerId.indexOf(edge.refs.offerId) === -1) refs.offerId.push(edge.refs.offerId);
    if (edge.refs.dealId && refs.dealId.indexOf(edge.refs.dealId) === -1) refs.dealId.push(edge.refs.dealId);
  }

  /**
   * gather: seeds -> scan -> classify -> credit join -> aggregate. Seeds are
   * scanned SEQUENTIALLY (the index is a courtesy) and opts.onSeed fires
   * after each so the page can paint as results land. One seed failing is
   * reported in `unknown` and never blanks the others.
   * @param {string[]} seedNames Raw names or ids typed by the user.
   * @param {string[]} enabledIds Enabled class ids.
   * @param {{onSeed?:Function, nodeCap?:number, edgeCap?:number,
   *   cap?:number, timeoutMs?:number}} [opts]
   * @returns {Promise<{graph:AccountNetGraph, seeds:Array, unknown:string[], stats:Object}>}
   */
  function gather(seedNames, enabledIds, opts) {
    opts = opts || {};
    var en = enabled(enabledIds);
    var ops = opUnion(enabledIds);
    var names = (seedNames || []).map(function (s) { return String(s).trim(); })
      .filter(function (s) { return s.length; }).slice(0, MAX_SEEDS);
    var seeds = [], unknown = [], all = [], seen = {}, refs = { offerId: [], dealId: [] };
    var stats = { scanned: 0, truncated: false, droppedSelf: 0, droppedShape: 0, needsJoin: 0 };
    function resolveOne(n) {
      if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
        return Promise.reject(new Error("unknown-account"));
      }
      return Account.resolve(n);
    }
    return names.reduce(function (p, n) {
      return p.then(function () {
        return resolveOne(n).then(function (r) {
          if (!r || !r.id || seen[r.id]) return null;
          seen[r.id] = 1;
          seeds.push({ id: r.id, name: r.name || n });
          return scanSeed(r.id, ops, opts).then(function (res) {
            stats.scanned += res.scanned;
            if (res.truncated) stats.truncated = true;
            var perSeed = {};
            res.hits.forEach(function (hit) {
              /* Per-party duplicates: one op, two docs when both ends are
               * seeds. Dedupe WITHIN this seed's page set. */
              var dk = dedupeKey(hit);
              if (dk) { if (perSeed[dk]) return; perSeed[dk] = 1; }
              var got = classify(hit, { enabled: en, seedId: r.id });
              if (got.skip === "self") stats.droppedSelf++;
              else if (got.skip === "shape") stats.droppedShape++;
              else if (got.skip === "needs-join") { stats.needsJoin++; all.push(got.edge); collectRefs(got.edge, refs); }
              else if (got.edge) all.push(got.edge);
            });
            if (typeof opts.onSeed === "function") { try { opts.onSeed(seeds.slice(), stats); } catch (e) { /* painter is optional */ } }
            return null;
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
          if (!own) return;                    /* unresolvable => dropped, counted as missing */
          if (!e.to) e.to = own; else if (!e.from) e.from = own;
          if (!e.from || !e.to || e.from === e.to) return;
          edges.push(e);
        });
        var graph = buildGraph(edges, seeds, { scanned: stats.scanned,
          droppedSelf: stats.droppedSelf, droppedShape: stats.droppedShape,
          needsJoin: stats.needsJoin, scanCapHit: stats.truncated,
          nodeCap: opts.nodeCap, edgeCap: opts.edgeCap });
        graph.stats.missingCredit = owners.missing.length;
        graph.stats.creditViaIndex = owners.viaIndex || { offers: 0, deals: 0 };
        graph.stats.unknown = unknown.slice();
        graph.stats.truncated = stats.truncated;
        return { graph: graph, seeds: seeds, unknown: unknown, stats: graph.stats };
      });
  }

  return {
    CLASSES: CLASSES, DEFAULT_CLASSES: DEFAULT_CLASSES,
    ES_SIZE: ES_SIZE, ES_SIZE_CEILING: ES_SIZE_CEILING,
    SCAN_CAP: SCAN_CAP, SCAN_MAX_PAGES: SCAN_MAX_PAGES,
    SCAN_TIMEOUT_MS: SCAN_TIMEOUT_MS, NODE_CAP: NODE_CAP, EDGE_CAP: EDGE_CAP,
    MAX_SEEDS: MAX_SEEDS,
    enabled: enabled, opUnion: opUnion, classify: classify, edgeKey: edgeKey,
    dedupeKey: dedupeKey, buildGraph: buildGraph, esQuery: esQuery,
    scanSeed: scanSeed, creditOwners: creditOwners, gather: gather,
    _test: { EXTRACT: EXTRACT, CLASS_BY_OP: CLASS_BY_OP, amountOf: amountOf, acct: acct }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNet === "undefined") { globalThis.AccountNet = AccountNet; }
if (typeof module !== "undefined") { module.exports = AccountNet; }
