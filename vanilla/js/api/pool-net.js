/* PoolNet: full pool-network graph data for the #/pools band.
 * Owns: fromSkeleton (pools.json legs -> {nodes, edges}), mergeLive
 *   (live Pool.list rows overlay the skeleton: new pools added, known
 *   deduped, chain legs win over stale skeleton legs), findPath (BFS
 *   asset hops, null when orphaned), loadAllBatched (paginate-all helper),
 *   filterGraph (none=full, single=star, both=union of stars), brandOf
 *   (symbol -> brand group; BTS 1.3.0 + committee smartcoins -> bts-blue),
 *   readExtraIds/writeExtraIds/reconcileExtraIds (localStorage cache of
 *   newly-discovered pool ids; chain re-validates every load, stale ids
 *   dropped — spec §2 step 3).
 * Consumes: vanilla/data/pools.json skeleton shape
 *   {pools: [{id, a, b, share, symA, symB, symShare, precA, precB, precShare}]}
 *   (Task 1, vanilla/data/pools.json) plus live rows
 *   {id, asset_a_id, asset_b_id, sym_a, sym_b, share_id?} (Task 4 Pool.list).
 *   No DOM, no signing. Makes no chain calls itself: callers pass a
 *   listFn into loadAllBatched (chain via Chain.db/call only at the edge).
 * Created by: pool-net Task 2 (plan docs/superpowers/plans/2026-10-06-pool-net-map.md);
 *   live merge + BFS path + batched load + cache by Task 3
 *   (spec docs/superpowers/specs/2026-10-06-pool-net-map-design.md §2).
 * CHAIN TRUTH (#4 wins): pool object id/asset_a/asset_b/share issuance <->
 *   liquidity_pool_object.hpp; BTS core = 1.3.0 literal (consensus, not a lookup).
 * PROVENANCE (bitshares-networks behavior-only, IDEA ONLY — never a dependency):
 *   squidKid-deluxe/bitshares-networks pools/pool_mapper.py proposed the brand-color
 *   node groups (see spec docs/superpowers/specs/2026-10-06-pool-net-map-design.md §4);
 *   hexes are re-tuned per theme at render time, never copied here.
 * MONEY DISCIPLINE (#6): this module carries ids + symbols only — no balances,
 *   no prices, no floats. Nothing to misplace a decimal in.
 */
var PoolNet = (function () {
  "use strict";

  /* Skeleton pool row as shipped in vanilla/data/pools.json.
   * @typedef {Object} SkelPool
   * @property {string} id Pool object id ("1.19.x").
   * @property {string} a Asset id of leg A ("1.3.x").
   * @property {string} b Asset id of leg B ("1.3.x").
   * @property {string} share Share-asset object id ("1.3.x").
   * @property {string} symA Leg A symbol (label only).
   * @property {string} symB Leg B symbol (label only).
   */

  /* Graph node: one asset.
   * @typedef {Object} PoolNetNode
   * @property {string} assetId Asset object id ("1.3.x").
   * @property {string} sym Display symbol (never translated).
   */

  /* Graph edge: one pool linking two assets.
   * @typedef {Object} PoolNetEdge
   * @property {string} poolId Pool object id ("1.19.x").
   * @property {string} a Asset id of leg A.
   * @property {string} b Asset id of leg B.
   * @property {string} share Share-asset object id.
   */

  /* Full/star/union graph.
   * @typedef {Object} PoolNetGraph
   * @property {PoolNetNode[]} nodes One entry per asset.
   * @property {PoolNetEdge[]} edges One entry per pool.
   */

  /* brandOf: map an asset symbol to its brand group. BTS + committee
   * smartcoins (bare USD/CNY/EUR/BTC/GOLD/SILVER — no dot) always return
   * "bts-blue" so the core stays BitShares blue in every theme (spec §4).
   * Unknown symbols fall through to "other" (rendered theme border grey).
   * @param {string} sym Asset symbol (byte-verbatim, never translated).
   * @returns {string} Brand group id.
   */
  function brandOf(sym) {
    sym = String(sym || "");
    if (sym === "BTS" || (/(USD|CNY|EUR|BTC|GOLD|SILVER)$/.test(sym) && sym.indexOf(".") === -1)) return "bts-blue";
    if (sym.indexOf("HONEST") !== -1) return "honest";
    if (sym.indexOf("GDEX") !== -1 || sym === "DEFI" || sym === "GAT") return "gdex";
    if (sym.indexOf("XBTSX") !== -1) return "xbtsx";
    if (sym.indexOf("BTWTY") !== -1 || sym.indexOf("TWENTIX") !== -1) return "btwty";
    if (sym.indexOf("CRUDE") !== -1) return "crude";
    if (sym.indexOf("IOB") !== -1) return "iob";
    if (sym === "NIUSHI" || sym === "NSNFT") return "grey";
    if (sym === "GOLDBACK" || sym === "QUINT" || sym === "BEOS") return "goldback";
    if (sym === "GOLD" || sym === "SILVER" || sym === "CNY 1.0" || sym.length === 3) return "blue3";
    return "other";
  }

  /* fromSkeleton: skeleton legs -> deduped {nodes, edges}. One node per
   * asset id (first symbol wins — legs agree by construction); one edge
   * per pool row.
   * @param {{pools?: SkelPool[]}} skel Parsed pools.json shape.
   * @returns {PoolNetGraph} Full graph.
   */
  function fromSkeleton(skel) {
    var nodes = {}, edges = [];
    var pools = (skel && skel.pools) || [];
    pools.forEach(function (p) {
      if (!nodes[p.a]) nodes[p.a] = { assetId: p.a, sym: p.symA };
      if (!nodes[p.b]) nodes[p.b] = { assetId: p.b, sym: p.symB };
      edges.push({ poolId: p.id, a: p.a, b: p.b, share: p.share });
    });
    return {
      nodes: Object.keys(nodes).map(function (k) { return nodes[k]; }),
      edges: edges
    };
  }

  /* Live pool row as returned by Pool.list (Task 4 shape: chain object
  * fields, symbols joined for labels only).
  * @typedef {Object} LivePoolRow
  * @property {string} id Pool object id ("1.19.x").
  * @property {string} asset_a_id Asset id of leg A ("1.3.x").
  * @property {string} asset_b_id Asset id of leg B ("1.3.x").
  * @property {string} [sym_a] Leg A symbol (label only).
  * @property {string} [sym_b] Leg B symbol (label only).
  * @property {string} [share_id] Share-asset object id ("1.3.x").
  */

  /* BFS path between two assets over pool edges.
  * @typedef {Object} PoolNetPath
  * @property {string[]} hops Asset ids from source to target, inclusive.
  * @property {string[]} pools Pool ids used, one per hop (length hops-1).
  */

  /* mergeLive: overlay live rows onto a skeleton graph. New pool ids are
  * added (with their assets as nodes); known pool ids are deduped. When a
  * live row's legs disagree with the shipped skeleton edge, the chain wins:
  * the edge legs are corrected in place (stale skeleton never overrides
  * chain — spec §2 step 3). Node symbols stay first-wins (labels agree by
  * construction; symbols are display-only, never chain truth).
  * @param {PoolNetGraph} g Skeleton graph (fromSkeleton output).
  * @param {Array<any>} liveRows Live Pool.list rows.
  * @returns {PoolNetGraph} Merged graph (new object; input untouched).
  */
  function mergeLive(g, liveRows) {
    var seen = {}, byPool = {}, nodes = {};
    var edges = (g && g.edges ? g.edges : []).slice();
    (g && g.nodes ? g.nodes : []).forEach(function (n) { nodes[n.assetId] = n; });
    edges.forEach(function (e) { seen[e.poolId] = 1; byPool[e.poolId] = e; });
    (liveRows || []).forEach(function (r) {
      var pid = String(r.id);
      var a = String(r.asset_a_id), b = String(r.asset_b_id);
      if (!nodes[a]) nodes[a] = { assetId: a, sym: r.sym_a || a };
      if (!nodes[b]) nodes[b] = { assetId: b, sym: r.sym_b || b };
      if (!seen[pid]) {
        seen[pid] = 1;
        var e = { poolId: pid, a: a, b: b, share: r.share_id || null };
        byPool[pid] = e;
        edges.push(e);
      } else {
        var known = byPool[pid];
        if (known && (known.a !== a || known.b !== b)) { known.a = a; known.b = b; }
      }
    });
    return {
      nodes: Object.keys(nodes).map(function (k) { return nodes[k]; }),
      edges: edges
    };
  }

  /* findPath: shortest asset path (BFS over pool edges) between two asset
  * ids. Used for the X<->Y highlight on the union view (spec §2 step 4).
  * Returns null when either endpoint sits in no pool (orphan verdict) or
  * no route connects them. A self-path returns one hop, no pools.
  * @param {PoolNetGraph} g Loaded graph.
  * @param {string} fromId Source asset id ("1.3.x").
  * @param {string} toId Target asset id ("1.3.x").
  * @returns {PoolNetPath|null} Hops + pools, or null when unconnected.
  */
  function findPath(g, fromId, toId) {
    fromId = String(fromId);
    toId = String(toId);
    if (fromId === toId) return { hops: [fromId], pools: [] };
    var adj = {};
    function link(x, y, poolId) {
      if (!adj[x]) adj[x] = [];
      adj[x].push({ to: y, poolId: poolId });
    }
    ((g && g.edges) || []).forEach(function (e) {
      link(e.a, e.b, e.poolId);
      link(e.b, e.a, e.poolId);
    });
    if (!adj[fromId] || !adj[toId]) return null;
    var prev = {};
    prev[fromId] = null;
    var queue = [fromId];
    while (queue.length) {
      var cur = queue.shift();
      if (cur === toId) break;
      (adj[cur] || []).forEach(function (hop) {
        if (!Object.prototype.hasOwnProperty.call(prev, hop.to)) {
          prev[hop.to] = { from: cur, poolId: hop.poolId };
          queue.push(hop.to);
        }
      });
    }
    if (!Object.prototype.hasOwnProperty.call(prev, toId)) return null;
    var hops = [toId], pools = [], step = toId;
    while (step !== fromId) {
      var p = prev[step];
      pools.unshift(p.poolId);
      step = p.from;
      hops.unshift(step);
    }
    return { hops: hops, pools: pools };
  }

  /* loadAllBatched: paginate a list-style chain fetch until a short page.
  * Pages are fetched with limit 100 (chain page convention); a page
  * shorter than the limit — including an empty first page — ends the walk.
  * Sync throws inside listFn surface as a rejected promise (honest
  * failure, never a half-merged graph).
  * @param {function((string|null)): Promise<Array<any>>} listFn Page
  *   fetcher: start pool id (null = first page) -> rows.
  * @param {number} [limit] Page size (default 100).
  * @returns {Promise<Array<any>>} All rows concatenated in page order.
  */
  function loadAllBatched(listFn, limit) {
    limit = limit || 100;
    var all = [];
    function page(startId) {
      return Promise.resolve().then(function () { return listFn(startId); }).then(function (rows) {
        rows = rows || [];
        all = all.concat(rows);
        if (rows.length < limit) return all;
        return page(rows[rows.length - 1].id);
      });
    }
    return page(null);
  }

  /* localStorage cache of newly-discovered pool ids (spec §2 step 3).
  * The shipped skeleton is immutable truth for structure; pools created
  * after ship time are remembered here so the next first paint already
  * knows them — but the chain re-validates every load and stale ids are
  * dropped (reconcileExtraIds rewrites the cache to exactly
  * live-minus-skeleton). All three helpers are node-safe: without
  * localStorage they behave as an empty cache (read []) / no-op (write).
  */
  var EXTRA_CACHE_KEY = "poolNet.extraIds.v1";

  /* readExtraIds: cached newly-discovered pool ids, or [] when no cache
  * (first run, private mode, or node test harness without localStorage).
  * Corrupt JSON reads as empty, never throws.
  * @returns {string[]} Cached pool ids ("1.19.x").
  */
  function readExtraIds() {
    try {
      if (typeof localStorage === "undefined") return [];
      var raw = localStorage.getItem(EXTRA_CACHE_KEY);
      if (!raw) return [];
      var ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return [];
      return ids.filter(function (x) { return typeof x === "string"; });
    } catch (e) { return []; }
  }

  /* writeExtraIds: persist newly-discovered pool ids (best-effort:
  * quota/private-mode failures are swallowed — the cache is a speedup,
  * never load-bearing; the next load re-derives it from chain).
  * @param {string[]} ids Pool ids to cache.
  * @returns {void}
  */
  function writeExtraIds(ids) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(EXTRA_CACHE_KEY, JSON.stringify(ids || []));
    } catch (e) { /* best-effort only */ }
  }

  /* reconcileExtraIds: re-validate the cache against a fresh live id set.
  * extra = live ids absent from the shipped skeleton; the cache is
  * rewritten to exactly that set, so pools deleted on chain drop out.
  * @param {string[]} skelIds Shipped skeleton pool ids ("1.19.x").
  * @param {string[]} liveIds Fresh live pool ids from loadAllBatched.
  * @returns {{added: string[], dropped: string[], extra: string[]}}
  *   added = newly cached, dropped = stale (no longer live), extra = full set.
  */
  function reconcileExtraIds(skelIds, liveIds) {
    var known = {}, live = {}, before = {};
    (skelIds || []).forEach(function (id) { known[String(id)] = 1; });
    (liveIds || []).forEach(function (id) { live[String(id)] = 1; });
    readExtraIds().forEach(function (id) { before[id] = 1; });
    var extra = Object.keys(live).filter(function (id) { return !known[id]; });
    var added = extra.filter(function (id) { return !before[id]; });
    var dropped = Object.keys(before).filter(function (id) { return !live[id]; });
    writeExtraIds(extra);
    return { added: added, dropped: dropped, extra: extra };
  }

  /* filterGraph: client-side view over one loaded graph (no extra RPC).
   * No selection -> full graph (returned by reference). Single id ->
   * star(id) = id + pools touching id + counter-assets (1 hop). Both ids ->
   * union of both stars.
   * @param {PoolNetGraph} g Loaded graph.
   * @param {{aId?: string|null, bId?: string|null}} [sel] Selection (asset ids).
   * @returns {PoolNetGraph} Subgraph (new object except the full-graph case).
   */
  function filterGraph(g, sel) {
    sel = sel || {};
    if (!sel.aId && !sel.bId) return g;
    var keepPools = {}, keepNodes = {};
    function star(x) {
      keepNodes[x] = 1;
      (g.edges || []).forEach(function (e) {
        if (e.a === x || e.b === x) {
          keepPools[e.poolId] = 1;
          keepNodes[e.a] = 1;
          keepNodes[e.b] = 1;
        }
      });
    }
    if (sel.aId) star(sel.aId);
    if (sel.bId) star(sel.bId);
    return {
      nodes: (g.nodes || []).filter(function (n) { return keepNodes[n.assetId]; }),
      edges: (g.edges || []).filter(function (e) { return keepPools[e.poolId]; })
    };
  }

  return {
    brandOf: brandOf,
    fromSkeleton: fromSkeleton,
    mergeLive: mergeLive,
    findPath: findPath,
    loadAllBatched: loadAllBatched,
    filterGraph: filterGraph,
    readExtraIds: readExtraIds,
    writeExtraIds: writeExtraIds,
    reconcileExtraIds: reconcileExtraIds,
    EXTRA_CACHE_KEY: EXTRA_CACHE_KEY
  };
})();
if (typeof module !== "undefined") { module.exports = PoolNet; }
if (typeof globalThis !== "undefined" && typeof globalThis.PoolNet === "undefined") { globalThis.PoolNet = PoolNet; }
