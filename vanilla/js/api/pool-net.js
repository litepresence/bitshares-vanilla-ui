/* PoolNet: full pool-network graph data for the #/pools band.
 * Owns: fromSkeleton (pools.json legs -> {nodes, edges}), filterGraph
 *   (none=full, single=star, both=union of stars), brandOf (symbol ->
 *   brand group; BTS 1.3.0 + committee smartcoins -> bts-blue).
 * Consumes: vanilla/data/pools.json skeleton shape
 *   {pools: [{id, a, b, share, symA, symB, symShare, precA, precB, precShare}]}
 *   (Task 1, vanilla/data/pools.json). No DOM, no signing, no storage.
 *   No chain calls in this task (pure fns) — live merge + BFS path land in Task 3.
 * Created by: pool-net Task 2 (plan docs/superpowers/plans/2026-10-06-pool-net-map.md).
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

  return { brandOf: brandOf, fromSkeleton: fromSkeleton, filterGraph: filterGraph };
})();
if (typeof module !== "undefined") { module.exports = PoolNet; }
if (typeof globalThis !== "undefined" && typeof globalThis.PoolNet === "undefined") { globalThis.PoolNet = PoolNet; }
