/* PoolGraph: 2-layer pool-connection provenance map (orphan-pair scam check).
 * Owns: poolsForAsset (one_asset reads), buildGraph (L0=A,B; L1 cap 8 biggest-first;
 *   L2 up to 6 counters limit 3; nodes cap 25), findCorePath (BFS fewest-hops to 1.3.0,
 *   widest-min-edge tiebreak), layout (deterministic layered rings, the relax
 *   seed), relax (deterministic force-directed settle: repulsion + springs +
 *   gravity + walls, fixed iterations, zero randomness — networkx IDEA ONLY),
 *   drawGraph (DPR canvas, theme tokens, small halo labels, staggered rings, click
 *   hit-test to #/asset + #/pools, direct node dragging over session-only offsets).
 * Physics here is settled math, not animation: no timers, no random seeds, no
 *   rAF loop — same graph always settles to the same pixels (vector-proven).
 *   layout() stays the deterministic seed (and the drag-offset base); relax()
 *   output feeds drawGraph on both pages. A drag writes a plain {dx,dy} into
 *   a session Map (reset on data refresh) and repaints through drawGraph.
 *   Pointer events cover mouse + touch; touch-action:none applies only
 *   mid-drag so page scroll is untouched otherwise.
 * Consumes: Chain.db/.call (sole socket owner, _dbCall error contract mirrors pool.js);
 *   lookup_asset_symbols for sym join (misses degrade to bare ids). No DOM except the
 *   caller-provided canvas; no signing, no storage, no ES, no networkx. Global PoolGraph only.
 * Created by: building-vanilla-slices skill, pool-map task.
 * CHAIN TRUTH (#4 wins): get_liquidity_pools_by_one_asset(asset,limit,start,stats) <-
 *   database_api.hpp:769-773; by_asset_a/b <- :723/:746; list <- :701; pool object
 *   id/asset_a/asset_b/balance_a/balance_b (raw ints) <- liquidity_pool_object.hpp:44-60.
 *   BTS core = 1.3.0 literal (lookup_asset_symbols ["BTS"] would confirm; describe fallback
 *   unnecessary — id is consensus, symbol only labels).
 * PROVENANCE (bitshares-networks behavior-only, MATH IDEA ONLY — never a dependency, never imported):
 *   squidKid-deluxe/bitshares-networks pools/pool_mapper.py (pyvis + networkx full-pool
 *   network: BFS shortest-path pricing to BTS 1.3.0, edge-width by BTS value, hover
 *   balances/prices, drag-to-untangle) proposed the pool-connection map idea; this file
 *   ports the IDEA (layered rings + core-path highlight) to dependency-free canvas.
 *   Verified: dex-ux checkout has NO networkx (see docs/parity/dexux-networkx-verdict.md);
 *   no ES, no networkx/pyvis runtime here — chain only.
 * MONEY DISCIPLINE (#6): balances stay RAW digit strings; size = BigInt(a)+BigInt(b);
 *   Number() ONLY for canvas pixels (radii/angles), never money. RPC BUDGET: <=9 calls per
 *   buildGraph (2 L1 + <=6 L2 + 1 symbol join); failures -> honest partial (missing legs []),
 *   not-connected propagates only when ALL legs are offline.
 */
var PoolGraph = (function () {
  "use strict";
  var CORE_ID = "1.3.0", CORE_SYM = "BTS";
  var ASSET_RE = /^1\.3\.\d+$/;
  var L1_CAP = 8, L2_ASSETS = 6, L2_LIMIT = 3, NODE_CAP = 25;

  /* Batch-9 i18n: display strings resolve via I18n.t with the pre-conversion
   * literal kept verbatim as enDefault (English-identical on any transport,
   * incl. file:// where dict fetch fails). Falls back to the default when
   * i18n.js failed to load: never blank, never throws. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* _assertAsset: reject non-asset ids up front (throws). _isSocketError:
   * true for transport-level failures (caller maps to offline state). */
  function _assertAsset(id) { if (typeof id !== "string" || !ASSET_RE.test(id)) throw new Error("bad asset id: " + JSON.stringify(id)); }
  function _isSocketError(e) { return /not connected|socket closed|connect timeout|call timeout/i.test(String((e && e.message) || e || "")); }
  /* Missing-method shape: node lacks one_asset (older binary) or rejects params. -> [] fallback, never throws. */
  function _isMissingMethod(e) { return /method.*not.*found|unknown.*method|no.*method|invalid.*method|wrong.*api|not.*supported/i.test(String((e && e.message) || e || "")); }
  function _isParamError(e) { return /invalid param|wrong|argument|parameter|signature/i.test(String((e && e.message) || e || "")); }

  /* One database-API round trip; socket failures -> "not-connected", else rethrow verbatim (pool.js contract). */
  async function _dbCall(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); } catch (e) {
      if (_isSocketError(e)) throw new Error("not-connected");
      throw e;
    }
  }
  /* Raw pool -> minimal row (amounts stay raw strings). */
  function _normPool(p) {
    if (!p || typeof p !== "object" || !p.id) return null;
    return { id: String(p.id), asset_a_id: String(p.asset_a), asset_b_id: String(p.asset_b),
      balance_a_raw: String(p.balance_a), balance_b_raw: String(p.balance_b) };
  }
  /* Pool size for biggest-first: BigInt(a)+BigInt(b), 0n on malformed. */
  function _poolSize(r) {
    try {
      if (!/^\d+$/.test(r.balance_a_raw) || !/^\d+$/.test(r.balance_b_raw)) return 0n;
      return BigInt(r.balance_a_raw) + BigInt(r.balance_b_raw);
    } catch (e) { return 0n; }
  }
  /* Biggest-first sort (descending size), stable by pool id for determinism. */
  function _sortBiggest(rows) {
    return rows.slice().sort(function (a, b) {
      var sa = _poolSize(a), sb = _poolSize(b);
      if (sa !== sb) return sa > sb ? -1 : 1;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  }
  /* L1 selection: biggest-first, cap N (pure, tested). */
  function _selectL1(rows, cap) { return _sortBiggest(rows || []).slice(0, cap); }
  /* Funded-only edge rule (desk-map connects semantics: a line means a live
   * venue — an empty pool has no side to trade against, so it never becomes
   * an edge. Pure, tested via _test._funded). */
  function _funded(p) { try { return _poolSize(p) > 0n; } catch (e) { return false; } }
  /* L2 counter-asset pick: distinct ids touching L1 pools except A/B, in biggest-pool order, cap N (pure, tested). */
  function _pickL2Assets(l1pools, assetA, assetB, max) {
    var out = [], seen = {};
    seen[assetA] = 1; seen[assetB] = 1;
    var sorted = _sortBiggest(l1pools || []);
    for (var i = 0; i < sorted.length && out.length < max; i++) {
      var p = sorted[i];
      [p.asset_a_id, p.asset_b_id].forEach(function (id) {
        if (out.length >= max) return;
        if (!id || seen[id]) return;
        seen[id] = 1; out.push(id);
      });
    }
    return out;
  }

  /* Pools touching one asset (limit N). Missing-method/param -> [] (honest partial);
   * socket failure -> "not-connected" (caller decides partial vs offline). */
  async function poolsForAsset(assetId, limit) {
    _assertAsset(assetId);
    var lim = (limit === undefined || limit === null) ? 8 : limit;
    if (!Number.isInteger(lim) || lim < 1 || lim > 100) throw new Error("limit must be 1-100");
    var rows;
    try { rows = await _dbCall("get_liquidity_pools_by_one_asset", [assetId, lim]); }
    catch (e) {
      if (e && e.message === "not-connected") throw e;
      if (_isMissingMethod(e) || _isParamError(e)) return [];
      return [];
    }
    var out = [];
    (rows || []).forEach(function (p) { var r = _normPool(p); if (r) out.push(r); });
    return _sortBiggest(out).slice(0, lim);
  }

  /* Batched sym join (one lookup_asset_symbols for all ids; misses -> bare ids, never throws). */
  async function _symJoin(ids) {
    var map = {};
    var uniq = [];
    (ids || []).forEach(function (id) { if (id && !map[id]) { map[id] = String(id); uniq.push(id); } });
    if (!uniq.length) return map;
    try {
      var objs = await _dbCall("lookup_asset_symbols", [uniq]);
      (objs || []).forEach(function (a) { if (a && a.id && a.symbol) map[a.id] = String(a.symbol); });
    } catch (e) { /* bare ids stand */ }
    if (!map[CORE_ID] || map[CORE_ID] === CORE_ID) { try { map[CORE_ID] = CORE_SYM; } catch (e) {} }
    return map;
  }

  /* 2-layer graph from two asset ids. Returns {nodes:[{assetId,sym}], edges:[{poolId,a,b,sizeRaw}]}.
   * L0=A,B; L1=one_asset each cap 8 biggest-first; L2=up to 6 counters limit 3; nodes cap 25
   * (smallest L2 pools dropped first). Funded pools only (zero-size pools are
   * never edges — desk-map connects semantics). Partial on leg failures; throws not-connected only
   * when every pool fetch is offline. Never guesses symbols (bare ids stand).
   * Discovery is concurrent (same calls, timing only): L1 pair via one Promise.all,
   * L2 counters via one Promise.all (<=6 legs, <=8 total — no pool needed). Each leg
   * never rejects the batch (failure -> []); results merge back in deterministic
   * counters order before layout, so resolve order never changes the ring layout. */
  async function buildGraph(assetA, assetB, opts) {
    _assertAsset(assetA); _assertAsset(assetB);
    opts = opts || {};
    var cap = opts.cap || NODE_CAP;
    /* L1 legs run concurrently; per-leg guard maps failure -> {rows:[],offline} so
     * one leg never rejects the batch. Order is fixed (A then B) regardless of resolve order. */
    async function _safeL1(asset) {
      try { return { rows: await poolsForAsset(asset, 8), offline: false }; }
      catch (e) {
        if (e && e.message === "not-connected") return { rows: [], offline: true };
        return { rows: [], offline: false };
      }
    }
    var l1res = await Promise.all([_safeL1(assetA), _safeL1(assetB)]);
    var offline = (l1res[0].offline ? 1 : 0) + (l1res[1].offline ? 1 : 0);
    if (offline === 2) throw new Error("not-connected");
    var l1a = _selectL1(l1res[0].rows, L1_CAP), l1b = _selectL1(l1res[1].rows, L1_CAP);
    /* Funded-only (connects rule above): empty pools never enter the edge
     * set, so L2 counters derive from funded L1 only. */
    var l1 = l1a.concat(l1b).filter(_funded);
    var seenPool = {}, pools = [];
    l1.forEach(function (p) { if (!seenPool[p.id]) { seenPool[p.id] = 1; pools.push(p); } });
    var counters = _pickL2Assets(pools, assetA, assetB, L2_ASSETS);
    /* L2 legs run concurrently (<=6 at once); each leg resolves [] on failure
     * (offline leg skips like the old continue) so the batch never rejects.
     * Merge follows counters[] order — not resolve order — to keep layout deterministic. */
    async function _safeL2(asset) {
      try { return await poolsForAsset(asset, L2_LIMIT); }
      catch (e) { return []; }
    }
    var l2rows = await Promise.all(counters.map(function (id) { return _safeL2(id); }));
    for (var i = 0; i < l2rows.length; i++) {
      var l2sel = _selectL1(l2rows[i] || [], L2_LIMIT).filter(_funded);
      l2sel.forEach(function (p) { if (!seenPool[p.id]) { seenPool[p.id] = 1; pools.push(p); } });
    }
    /* Node-cap trim: drop smallest L2 pools (never L1) until nodes fit. */
    function nodeSet(list) { var s = {}; s[assetA] = 1; s[assetB] = 1; list.forEach(function (p) { s[p.asset_a_id] = 1; s[p.asset_b_id] = 1; }); return Object.keys(s); }
    var l1ids = {}; l1.forEach(function (p) { l1ids[p.id] = 1; });
    while (nodeSet(pools).length > cap) {
      var l2only = pools.filter(function (p) { return !l1ids[p.id]; });
      if (!l2only.length) break;
      var smallest = _sortBiggest(l2only)[l2only.length - 1];
      pools = pools.filter(function (p) { return p.id !== smallest.id; });
      delete seenPool[smallest.id];
    }
    var ids = nodeSet(pools);
    var syms = await _symJoin(ids);
    var nodes = ids.map(function (id) { return { assetId: id, sym: syms[id] || String(id) }; });
    nodes.sort(function (a, b) { return a.assetId < b.assetId ? -1 : 1; });
    var edges = pools.map(function (p) { return { poolId: p.id, a: p.asset_a_id, b: p.asset_b_id, sizeRaw: _poolSize(p).toString() }; });
    edges.sort(function (a, b) { return a.poolId < b.poolId ? -1 : 1; });
    return { nodes: nodes, edges: edges };
  }

  /* Shortest (fewest-hops) path to 1.3.0, tie-break widest bottleneck (min-edge).
   * Returns {hops:[ids], via:[poolIds]} or null (orphan — never guessed). Zero-hop when fromId is core. */
  function findCorePath(graph, fromId) {
    if (!graph || !Array.isArray(graph.edges)) return null;
    if (fromId === CORE_ID) return { hops: [CORE_ID], via: [] };
    var adj = {};
    (graph.edges || []).forEach(function (e) {
      if (!e || !e.a || !e.b) return;
      var sz = 0n; try { sz = BigInt(e.sizeRaw); } catch (x) { sz = 0n; }
      (adj[e.a] = adj[e.a] || []).push({ to: e.b, pool: e.poolId, size: sz });
      (adj[e.b] = adj[e.b] || []).push({ to: e.a, pool: e.poolId, size: sz });
    });
    if (!adj[fromId]) return null;
    var best = {}; /* id -> {hops, bottle, prev, via} */
    var queue = [{ id: fromId, hops: 0, bottle: null, prev: null, via: null }];
    best[fromId] = { hops: 0, bottle: null };
    function better(nw, cur) {
      if (!cur) return true;
      if (nw.hops !== cur.hops) return nw.hops < cur.hops;
      var nb = nw.bottle === null ? -1n : nw.bottle, cb = cur.bottle === null ? -1n : cur.bottle;
      return nb > cb;
    }
    var order = [];
    while (queue.length) {
      queue.sort(function (a, b) {
        if (a.hops !== b.hops) return a.hops - b.hops;
        var ab = a.bottle === null ? -1n : a.bottle, bb = b.bottle === null ? -1n : b.bottle;
        return ab > bb ? -1 : 1;
      });
      var cur = queue.shift();
      order.push(cur);
      if (cur.id === CORE_ID) break;
      var links = adj[cur.id] || [];
      for (var i = 0; i < links.length; i++) {
        var L = links[i];
        var nb = cur.bottle === null ? L.size : (L.size < cur.bottle ? L.size : cur.bottle);
        var cand = { id: L.to, hops: cur.hops + 1, bottle: nb, prev: cur.id, via: L.pool };
        if (better(cand, best[L.to])) {
          best[L.to] = { hops: cand.hops, bottle: cand.bottle, prev: cur.id, via: L.pool };
          queue.push(cand);
        }
      }
    }
    if (!best[CORE_ID] || best[CORE_ID].hops === undefined || best[CORE_ID].prev === undefined) return null;
    var hops = [CORE_ID], via = [], at = CORE_ID, guard = 0;
    while (at !== fromId && guard++ < 100) {
      var b = best[at];
      if (!b || !b.prev) return null;
      via.unshift(b.via); at = b.prev; hops.unshift(at);
    }
    return at === fromId ? { hops: hops, via: via } : null;
  }

  /* Node radius, pixels only: 5 + degree step, capped at 11 (~40% smaller than the
   * old 9 + 2*deg balls so labels breathe). Pure (tested for bounds). */
  var NODE_BASE_R = 5, NODE_DEG_STEP = 1.2, NODE_MAX_DEG = 5, NODE_MAX_R = 11;
  function _nodeRadius(deg) {
    var d = Number(deg) || 0;
    if (!(d > 0)) d = 0;
    if (d > NODE_MAX_DEG) d = NODE_MAX_DEG;
    return NODE_BASE_R + d * NODE_DEG_STEP;
  }
  /* Ring radii from the canvas min-dimension, minus an edge pad (max node radius +
   * label height + margin) so edge nodes never clip. Pure (tested for containment). */
  var EDGE_PAD = 30;
  function _ringRadii(w, h) {
    var m = Math.min(w || 300, h || 180);
    if (!(m > 0)) m = 180;
    var outer = Math.max(m / 2 - EDGE_PAD, m * 0.1);
    return { min: m, pad: EDGE_PAD, outer: outer, inner: outer * 0.58,
      center: Math.min(outer * 0.35, 20), maxNodeR: NODE_MAX_R };
  }
  /* Ring membership (L0 = center pair, L1 = their neighbours, L2 = rest, all sorted).
   * Shared by layout (positions) and drawGraph (label stagger). Pure. */
  function _rings(graph, assetA, assetB) {
    var adj = {};
    (graph.edges || []).forEach(function (e) {
      if (!e || !e.a || !e.b) return;
      (adj[e.a] = adj[e.a] || {})[e.b] = 1; (adj[e.b] = adj[e.b] || {})[e.a] = 1;
    });
    function neigh(id) { return adj[id] ? Object.keys(adj[id]) : []; }
    var l0 = assetA === assetB ? [assetA] : [assetA, assetB], inL0 = {};
    l0.forEach(function (id) { inL0[id] = 1; });
    var l1set = {};
    l0.forEach(function (id) { neigh(id).forEach(function (n) { if (!inL0[n]) l1set[n] = 1; }); });
    var l1 = Object.keys(l1set).sort(), inL1 = {};
    l1.forEach(function (id) { inL1[id] = 1; });
    var l2 = (graph.nodes || []).map(function (n) { return n.assetId; })
      .filter(function (id) { return !inL0[id] && !inL1[id]; }).sort();
    return { l0: l0, l1: l1, l2: l2 };
  }

  /* Deterministic layered rings: L0 center pair, L1 ring, L2 outer; angle by sorted index.
   * Returns {assetId:{x,y}} CSS pixels. Pure (tested for determinism). NO spring/physics
   * engine here (non-deterministic, untestable) — this is the initial arrangement; user
   * drag offsets apply on top at draw time and never feed back into layout. */
  function layout(graph, assetA, assetB, w, h) {
    w = w || 300; h = h || 180;
    var cx = w / 2, cy = h / 2;
    var rings = _rings(graph, assetA, assetB), rr = _ringRadii(w, h);
    var pos = {};
    pos[assetA] = { x: cx - rr.center, y: cy }; pos[assetB] = { x: cx + rr.center, y: cy };
    if (assetA === assetB) pos[assetA] = { x: cx, y: cy };
    function ring(ids, radius) {
      for (var i = 0; i < ids.length; i++) {
        var ang = -Math.PI / 2 + (i * 2 * Math.PI) / ids.length;
        pos[ids[i]] = { x: cx + radius * Math.cos(ang), y: cy + radius * Math.sin(ang) };
      }
    }
    if (rings.l1.length) ring(rings.l1, rr.inner);
    if (rings.l2.length) ring(rings.l2, rr.outer);
    (graph.nodes || []).forEach(function (n) { if (!pos[n.assetId]) pos[n.assetId] = { x: cx, y: cy }; });
    return pos;
  }

  /* Deterministic force relaxation (bitshares-networks pyvis-physics IDEA ONLY — same
   * doctrine as the rings: math ported, never a dependency, never imported).
   * layout() seeds (rings: pair center, layers outward); relax() settles to a
   * static equilibrium synchronously at paint time. Fixed RELAX_ITERS,
   * fixed cooling, index-ordered tiebreaks, zero randomness, zero timers, zero
   * animation: same graph in -> same pixels out, always (vector-proven —
   * this is what the old "no physics" note objected to, resolved by making
   * the physics deterministic rather than by refusing it).
   * Per iteration, all in CSS pixels (money never touches float — weights
   * come from raw-digit string lengths, never Number(sizeRaw)):
   *  - repulsion: every pair, F = k^2/d (Fruchterman-Reingold), displacement
   *    capped by temperature; d==0 separates along the deterministic
   *    golden-angle of the pair index (never NaN, never random)
   *  - springs: per edge toward rest, F = (d^2/k)*w with w = 0.5+digits/18
   *    from sizeRaw (log-weight: big pools pull harder)
   *  - gravity: weak center pull, x3 for the L0 pair (anchor: the
   *    provenance-map meaning — pair stays central, BTS prominent)
   *  - walls: soft push inside the pad, hard clamp at the end (nothing clips)
   * Cooling: temp k*0.4 * 0.94^iter. Cost: iters * pairs (150 * <=300 ≈ 1M
   * simple ops worst case, paint-time once, zero per-frame cost after).
   * Params: graph, seed ({id:{x,y}} from layout()), w, h (CSS px),
   *   opts {assetA, assetB} (L0 anchor, optional). Returns a NEW {id:{x,y}}
   *   (seed untouched). Degenerate graphs return the seed copy. Never throws. */
  var RELAX_ITERS = 150, RELAX_COOL = 0.94, RELAX_GRAV = 0.03, RELAX_L0_GRAV = 3;
  function _edgeWeight(sizeRaw) {
    var digits = 1;
    try {
      var s = String(sizeRaw === undefined || sizeRaw === null ? "" : sizeRaw).replace(/^0+/, "");
      digits = s.length || 1;
    } catch (e) { digits = 1; }
    return 0.5 + digits / 18;
  }
  /* Volume ramp: t in [0,1] -> grey-to-blue ink (owner 2026-10-07: color
   * replaces the old flat border grey. t windows live at the call site
   * (pool window 4–22, shared with the bands). Pure: parse failures fail
   * closed to grey. Verbatim twin lives in pool-net-paint.js — doctrine
   * prefers the duplication over a shared import for two files. */
  function _ramp(t, greyHex, blueHex) {
    function chan(h, i) { return parseInt(h.substr(i, 2), 16); }
    function rgb(h) {
      try {
        var s = String(h).trim();
        var m = /^#([0-9a-fA-F]{6})$/.exec(s);
        if (m) return [chan(m[1], 0), chan(m[1], 2), chan(m[1], 4)];
        var m3 = /^#([0-9a-fA-F]{3})$/.exec(s);
        if (m3) return [chan(m3[1].charAt(0) + m3[1].charAt(0), 0), chan(m3[1].charAt(1) + m3[1].charAt(1), 0), chan(m3[1].charAt(2) + m3[1].charAt(2), 0)];
        var mg = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
        if (mg) return [Number(mg[1]), Number(mg[2]), Number(mg[3])];
      } catch (e) { /* grey below */ }
      return null;
    }
    var g = rgb(greyHex), b = rgb(blueHex);
    if (!g || !b) return "rgb(117, 134, 150)";
    var k = Number(t);
    if (!(k > 0)) k = 0;
    if (k > 1) k = 1;
    function mix(i) { return Math.round(g[i] + (b[i] - g[i]) * k); }
    return "rgb(" + mix(0) + ", " + mix(1) + ", " + mix(2) + ")";
  }
  function relax(graph, seed, w, h, opts) {
    var pos = {};
    try {
      w = (typeof w === "number" && w > 0) ? w : 300;
      h = (typeof h === "number" && h > 0) ? h : 180;
      var ids = Object.keys(seed || {}).sort();
      if (!ids.length) return {};
      var i, j;
      for (i = 0; i < ids.length; i++) {
        var p0 = (seed && seed[ids[i]]) || {};
        pos[ids[i]] = { x: (typeof p0.x === "number" && isFinite(p0.x)) ? p0.x : w / 2,
          y: (typeof p0.y === "number" && isFinite(p0.y)) ? p0.y : h / 2 };
      }
      var n = ids.length;
      if (n < 2) return pos;
      var o = (opts && typeof opts === "object") ? opts : {};
      var inL0 = {};
      if (o.assetA) inL0[o.assetA] = 1;
      if (o.assetB) inL0[o.assetB] = 1;
      var deg = {};
      var edges = [];
      ((graph && graph.edges) || []).forEach(function (e) {
        if (!e || !pos[e.a] || !pos[e.b] || e.a === e.b) return;
        deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1;
        edges.push({ a: e.a, b: e.b, w: _edgeWeight(e.sizeRaw) });
      });
      var rad = {};
      ids.forEach(function (id) { rad[id] = _nodeRadius(deg[id] || 0); });
      var k = 0.5 * Math.sqrt((w * h) / n);
      if (!(k >= 24)) k = 24;
      if (!(k <= 60)) k = 60;
      var cx = w / 2, cy = h / 2, PAD = EDGE_PAD;
      var temp = k * 0.4;
      function clampX(x, r) { return x < PAD + r ? PAD + r : (x > w - PAD - r ? w - PAD - r : x); }
      function clampY(y, r) { return y < PAD + r ? PAD + r : (y > h - PAD - r ? h - PAD - r : y); }
      for (var iter = 0; iter < RELAX_ITERS; iter++) {
        var dx = {}, dy = {}, id;
        for (i = 0; i < n; i++) { dx[ids[i]] = 0; dy[ids[i]] = 0; }
        /* Repulsion, canonical pair order (deterministic). */
        for (i = 0; i < n; i++) {
          for (j = i + 1; j < n; j++) {
            var a = ids[i], b = ids[j];
            var ddx = pos[a].x - pos[b].x, ddy = pos[a].y - pos[b].y;
            var d = Math.sqrt(ddx * ddx + ddy * ddy), ux, uy;
            if (d > 0.01) { ux = ddx / d; uy = ddy / d; }
            else { var ang = ((i * 7 + j) * 2.399963); ux = Math.cos(ang); uy = Math.sin(ang); d = 0.01; }
            var fr = (k * k) / d;
            dx[a] += ux * fr; dy[a] += uy * fr;
            dx[b] -= ux * fr; dy[b] -= uy * fr;
          }
        }
        /* Springs along edges (log-weighted), then center gravity. */
        for (i = 0; i < edges.length; i++) {
          var e = edges[i];
          var ex = pos[e.a].x - pos[e.b].x, ey = pos[e.a].y - pos[e.b].y;
          var ed = Math.sqrt(ex * ex + ey * ey) || 0.01;
          var fa = (ed * ed / k) * e.w / ed;
          dx[e.a] -= ex * fa; dy[e.a] -= ey * fa;
          dx[e.b] += ex * fa; dy[e.b] += ey * fa;
        }
        for (i = 0; i < n; i++) {
          var id2 = ids[i];
          var pull = RELAX_GRAV * (inL0[id2] ? RELAX_L0_GRAV : 1);
          dx[id2] += (cx - pos[id2].x) * pull;
          dy[id2] += (cy - pos[id2].y) * pull;
        }
        /* Move simultaneously, capped by temperature; walls clamp. */
        for (i = 0; i < n; i++) {
          var id3 = ids[i];
          var mx = dx[id3], my = dy[id3];
          var ml = Math.sqrt(mx * mx + my * my);
          if (ml > temp && ml > 0) { mx = mx / ml * temp; my = my / ml * temp; }
          pos[id3].x = clampX(pos[id3].x + mx, rad[id3]);
          pos[id3].y = clampY(pos[id3].y + my, rad[id3]);
        }
        temp *= RELAX_COOL;
      }
      return pos;
    } catch (e) {
      /* Settle failure returns the seed copy (rings still draw) — a broken
       * relax must never blank the map. */
      try {
        var fb = {};
        Object.keys(seed || {}).forEach(function (id) {
          fb[id] = { x: seed[id].x, y: seed[id].y };
        });
        return fb;
      } catch (x) { return {}; }
    }
  }
  /* Desk physics driver (market-net Task 5 — physics ONLY; reworked
   * 2026-10-07 to the band's gesture-reaction model).
   * There is ONE physics here now: every render settles (the same
   * per-iteration math animates frame-by-frame via _liveStep — one relax
   * iteration verbatim, temp-capped — with a temp/cool/sleep schedule and a
   * 180-frame cap, then rests). The former "calm" preset, which painted the
   * settle-once equilibrium and ran ZERO live frames, is gone: two fidelities
   * behind one On/Off label is exactly why "Off" meant one thing on this
   * desk and another on the selector bands.
   * THE FLAG (S.react / readReact) is about GESTURES, shared with the band
   * through the same poolNetReact key: ON = a drag release re-energizes the
   * loop so neighbours react; OFF = gestures never wake it — you can still
   * drag nodes and the map stays exactly where you dropped it. Automatic
   * settles (mount, filter/pair change, resize) always run, so OFF never
   * leaves the desk map unarranged.
   * Presets come from PoolNetUI._physForTest() when the band module is
   * loaded (one shared preset shape), else the built-in FALLBACK so this
   * module stays standalone for headless tests. Force constants stay relax's
   * shipped values (k clamp 24..60, gravity, walls) — presets carry
   * RUN-CONTROL ONLY. Reduced-motion: auto runs stay frozen, an explicit
   * consent (the flip to ON) runs bounded (band wake policy verbatim, minus
   * the band's visibility observer — desk canvases paint while mounted).
   * Per-frame paints reuse drawGraph via the opts._pos seam (same painter,
   * colors, verdicts, hit-testing — no painter swap). Never throws outward. */
  var PHYS_KEY = "poolNetReact";
  var PHYS_FALLBACK = {
    lively: { temp0: 7, cool: 0.984, tempMin: 0.2, stillTol: 0.25, stillFrames: 120, minFrames: 60, maxFrames: 180 }
  };
  /* Session override from setReact (readReact prefers it over storage). */
  var _react = null;
  /* Preset table: band's live values when loaded, else the fallback.
   * Runtime lookup (never cached) so band load order never matters. */
  function _phys() {
    try {
      if (typeof PoolNetUI !== "undefined" && PoolNetUI && typeof PoolNetUI._physForTest === "function") {
        var p = PoolNetUI._physForTest();
        if (p && p.lively) return p;
      }
    } catch (e) { /* fallback stands */ }
    return PHYS_FALLBACK;
  }
  /* Default gesture reaction (storage decides via readReact; the shipped
   * default is ON, matching the band). */
  function _defaultReact() { return true; }
  /* Shared-key reader: in-memory setReact wins, then localStorage
   * poolNetReact ("0" = off), else ON. Storage failure keeps ON. The
   * RETIRED poolNetPhys preset key is never consulted. Never throws. */
  function readReact() {
    if (_react === true || _react === false) return _react;
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem(PHYS_KEY) === "0") return false;
    } catch (e) { /* ON stands */ }
    return true;
  }
  /* Shared-key writer for the pane switches (both desks call this).
   * Anything-not-false normalizes to ON. Returns the stored flag. */
  function setReact(on) {
    var v = (on === false) ? false : true;
    _react = v;
    try { if (typeof localStorage !== "undefined") localStorage.setItem(PHYS_KEY, v ? "1" : "0"); } catch (e) { /* memory-only */ }
    return v;
  }
  /* Reduced-motion probe (band precedent: guarded matchMedia, false headless). */
  function _reduced() {
    try {
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        return !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }
    } catch (e) { /* not reduced */ }
    return false;
  }
  /* One live frame: a single relax() iteration over geom IN PLACE (repulsion
   * k^2/d + golden-angle split, log-weighted springs, L0-anchored gravity,
   * temp-capped move, wall clamp — the relax body verbatim, temp-driven).
   * Params mirror relax(); temp is this frame's displacement cap.
   * Returns the frame's max displacement (sleep-gate input). Never throws. */
  function _liveStep(graph, geom, w, h, opts, temp) {
    try {
      w = (typeof w === "number" && w > 0) ? w : 300;
      h = (typeof h === "number" && h > 0) ? h : 180;
      if (!(temp > 0)) temp = 1;
      var ids = Object.keys(geom || {}).sort();
      var n = ids.length, i, j;
      if (n < 2) return 0;
      var o = (opts && typeof opts === "object") ? opts : {};
      var inL0 = {};
      if (o.assetA) inL0[o.assetA] = 1;
      if (o.assetB) inL0[o.assetB] = 1;
      var deg = {};
      var edges = [];
      ((graph && graph.edges) || []).forEach(function (e) {
        if (!e || !geom[e.a] || !geom[e.b] || e.a === e.b) return;
        deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1;
        edges.push({ a: e.a, b: e.b, w: _edgeWeight(e.sizeRaw) });
      });
      var rad = {};
      ids.forEach(function (id) { rad[id] = _nodeRadius(deg[id] || 0); });
      var k = 0.5 * Math.sqrt((w * h) / n);
      if (!(k >= 24)) k = 24;
      if (!(k <= 60)) k = 60;
      var cx = w / 2, cy = h / 2, PAD = EDGE_PAD;
      function clampX(x, r) { return x < PAD + r ? PAD + r : (x > w - PAD - r ? w - PAD - r : x); }
      function clampY(y, r) { return y < PAD + r ? PAD + r : (y > h - PAD - r ? h - PAD - r : y); }
      var dx = {}, dy = {};
      for (i = 0; i < n; i++) { dx[ids[i]] = 0; dy[ids[i]] = 0; }
      for (i = 0; i < n; i++) {
        for (j = i + 1; j < n; j++) {
          var a = ids[i], b = ids[j];
          var ddx = geom[a].x - geom[b].x, ddy = geom[a].y - geom[b].y;
          var d = Math.sqrt(ddx * ddx + ddy * ddy), ux, uy;
          if (d > 0.01) { ux = ddx / d; uy = ddy / d; }
          else { var ang = ((i * 7 + j) * 2.399963); ux = Math.cos(ang); uy = Math.sin(ang); d = 0.01; }
          var fr = (k * k) / d;
          dx[a] += ux * fr; dy[a] += uy * fr;
          dx[b] -= ux * fr; dy[b] -= uy * fr;
        }
      }
      for (i = 0; i < edges.length; i++) {
        var e = edges[i];
        var ex = geom[e.a].x - geom[e.b].x, ey = geom[e.a].y - geom[e.b].y;
        var ed = Math.sqrt(ex * ex + ey * ey) || 0.01;
        var fa = (ed * ed / k) * e.w / ed;
        dx[e.a] -= ex * fa; dy[e.a] -= ey * fa;
        dx[e.b] += ex * fa; dy[e.b] += ey * fa;
      }
      for (i = 0; i < n; i++) {
        var id2 = ids[i];
        var pull = RELAX_GRAV * (inL0[id2] ? RELAX_L0_GRAV : 1);
        dx[id2] += (cx - geom[id2].x) * pull;
        dy[id2] += (cy - geom[id2].y) * pull;
      }
      var maxStep = 0;
      for (i = 0; i < n; i++) {
        var id3 = ids[i];
        var mx = dx[id3], my = dy[id3];
        var ml = Math.sqrt(mx * mx + my * my);
        if (ml > temp && ml > 0) { mx = mx / ml * temp; my = my / ml * temp; }
        geom[id3].x = clampX(geom[id3].x + mx, rad[id3]);
        geom[id3].y = clampY(geom[id3].y + my, rad[id3]);
        var step = Math.sqrt(mx * mx + my * my);
        if (step > maxStep) maxStep = step;
      }
      return maxStep;
    } catch (e) { return 0; }
  }
  /* Synchronous headless loop (tests + wake settle): iterates _liveStep with
   * the one preset's schedule until the sleep gate or the 180-frame cap. The
   * former `mode !== "lively"` short-circuit (which delegated to relax() and
   * ran ZERO live frames for the retired "calm" preset) is gone: a render
   * always settles. Returns {pos, frames} (pos is a NEW map; seed untouched).
   * Never throws. */
  function _runLive(graph, seed, w, h, opts) {
    var P = _phys().lively || PHYS_FALLBACK.lively;
    var geom = {};
    try {
      Object.keys(seed || {}).forEach(function (id) {
        geom[id] = { x: seed[id].x, y: seed[id].y };
      });
    } catch (e) { return { pos: {}, frames: 0 }; }
    if (Object.keys(geom).length < 2) return { pos: geom, frames: 0 };
    var temp = P.temp0, stillN = 0, frames = 0, maxFrames = P.maxFrames || 180;
    while (frames < maxFrames) {
      var moved = _liveStep(graph, geom, w, h, opts, temp);
      temp = Math.max(temp * P.cool, P.tempMin);
      frames++;
      if (moved < P.stillTol) stillN++; else stillN = 0;
      if (stillN >= P.stillFrames && frames >= (P.minFrames || 0)) break;
    }
    return { pos: geom, frames: frames };
  }
  /* Wake the desk loop. ALWAYS re-seeds temp/still/frames (even when already
   * running — an early return here would starve later re-energizes, band wake
   * lesson verbatim). Reduced-motion AUTO wakes stay frozen; an EXPLICIT user
   * gesture (Physics flip) runs bounded. A running loop picks up fresh temp
   * next frame (no restart); a stopped loop (re)starts via _drive (headless
   * S without a canvas settles synchronously through _raf's sync fallback).
   * S shape: {graph, geom, w, h, opts, phys, temp, still, frames, running,
   * settled, reduced, dead?, forced?, canvas?, doc?, drawOpts?}. */
  function wake(S, explicit) {
    if (!S || S.dead) return;
    var P = _phys().lively;
    if (S.reduced && !explicit) return;
    /* Gesture reaction OFF: a drop must not move anything (the node already
     * followed the pointer — that is the drag handler, not physics). This
     * gate only refuses to START a loop; automatic settles pass through. */
    if (explicit && S.react === false) return;
    if (!S.geom || Object.keys(S.geom).length < 2) return;
    S.still = 0; S.frames = 0; S.temp = P.temp0;
    if (explicit) S.forced = true;
    if (S.running) return;
    S.running = true; S.settled = false;
    _drive(S);
  }
  /* Frame driver: one _liveStep + preset cool + optional repaint through the
   * existing drawGraph path (opts._pos seam), until the sleep gate or the
   * 180-frame cap. Superseded loops (canvas._graphLiveS moved on) stop. */
  function _drive(S) {
    function frame() {
      if (!S || S.dead) { if (S) S.running = false; return; }
      try {
        if (S.canvas && S.canvas._graphLiveS && S.canvas._graphLiveS !== S) { S.running = false; return; }
      } catch (e) { /* ownership stands */ }
      var P = _phys().lively;
      S.frames = (S.frames || 0) + 1;
      var moved = 0;
      try { moved = _liveStep(S.graph, S.geom, S.w, S.h, S.opts, S.temp); } catch (e) { moved = 0; }
      S.temp = Math.max(S.temp * P.cool, P.tempMin);
      if (S.canvas && S.doc) {
        try {
          var d = S.drawOpts || {};
          drawGraph(S.doc, S.canvas, S.graph,
            { assetA: d.assetA, assetB: d.assetB, highlightPools: d.highlightPools, nav: d.nav,
              kind: d.kind, meta: d.meta, routeDeskIds: d.routeDeskIds,
              _pos: S.geom });
        } catch (e) { /* next frame */ }
      }
      if (moved < P.stillTol) S.still = (S.still || 0) + 1; else S.still = 0;
      if ((P.maxFrames && (S.frames || 0) >= P.maxFrames) ||
          (S.still >= P.stillFrames && (S.frames || 0) >= (P.minFrames || 0))) {
        S.running = false; S.settled = true; S.forced = false;
        return;
      }
      S.settled = false;
      _raf(frame);
    }
    frame();
  }
  /* Stop a canvas's live loop (calm branch + teardown call this; a stopped
   * loop leaves the last painted frame standing). Never throws. */
  function stopLive(canvas) {
    try {
      if (canvas && canvas._graphLiveS) {
        try { canvas._graphLiveS.dead = true; canvas._graphLiveS.running = false; } catch (e) {}
      }
      if (canvas) { try { canvas._graphLiveS = null; } catch (e) {} }
    } catch (e) { /* stopped anyway */ }
  }
  /* The desk panes' entrypoint (redrawPoolMap). Every call paints once, then
   * settles with the one physics; under reduced-motion an AUTO call stops at
   * that painted (already relaxed) equilibrium and only an EXPLICIT consent —
   * flipping the switch ON — runs a bounded loop. The gesture flag gates
   * explicit wakes only, so an OFF desk map still re-arranges on a pair
   * change or resize. Stops any prior loop on the canvas first. */
  function drawLive(doc, canvas, graph, opts) {
    opts = opts || {};
    if (!canvas || !graph) return null;
    stopLive(canvas);
    var w = 300, h = 180;
    try {
      if (canvas.clientWidth) w = canvas.clientWidth;
      else if (canvas.parentNode && canvas.parentNode.clientWidth) w = canvas.parentNode.clientWidth;
    } catch (e) { /* 300 stands */ }
    if (!(w > 0)) w = 300;
    var assetA = opts.assetA, assetB = opts.assetB;
    var seed = {};
    try { seed = layout(graph, assetA, assetB, w, h); } catch (e) { seed = {}; }
    var geom = {};
    try {
      Object.keys(seed).forEach(function (id) { geom[id] = { x: seed[id].x, y: seed[id].y }; });
    } catch (e) { geom = {}; }
    var S = { graph: graph, geom: geom, w: w, h: h, opts: { assetA: assetA, assetB: assetB },
      react: readReact(), temp: 0, still: 0, frames: 0, running: false, settled: false,
      dead: false, reduced: _reduced(), forced: false,
      canvas: canvas, doc: doc,
      drawOpts: { assetA: assetA, assetB: assetB, highlightPools: opts.highlightPools || [],
        nav: opts.nav || null, kind: (opts.kind === "market") ? "market" : "pool",
        meta: opts.meta || null, routeDeskIds: opts.routeDeskIds || [] } };
    S.temp = _phys().lively.temp0;
    try { canvas._graphLiveS = S; } catch (e) { /* static paint below still stands */ }
    /* Every render paints first (so the frame is never blank), then settles:
     * the old "calm painted once and never animated" branch is gone. Under
     * reduced-motion an automatic render stays frozen (the relax equilibrium
     * it just painted IS the resting state); only an explicit consent
     * (flipping the switch ON) runs a bounded loop. */
    try {
      drawGraph(doc, canvas, graph, { assetA: assetA, assetB: assetB,
        highlightPools: opts.highlightPools || [], nav: opts.nav || null, hoverEdge: opts.hoverEdge || "",
        kind: (opts.kind === "market") ? "market" : "pool", meta: opts.meta || null,
        routeDeskIds: opts.routeDeskIds || [] });
    } catch (e) { /* note below carries it */ }
    if (S.reduced && !opts.explicit) { S.running = false; S.settled = true; return S; }
    wake(S, !!opts.explicit);
    return S;
  }
  /* Pair provenance vs BTS core (pure, unit-tested): direct = either leg
   * paired straight with BTS (1 hop); indirect = shortest connecting path
   * via pools (min hops of both legs); none = neither leg reaches BTS.
   * Params: graph, assetA, assetB. Returns {level, hops} where level is
   * "direct"|"indirect"|"none" and hops is the winning hop count
   * (0 when a leg IS BTS, null when none). A leg that is BTS itself counts
   * as direct. Never throws (bad graph -> none). */
  /* (provenanceStatus retired 2026-10-02: pair-level verdict superseded by
   * mapTheme's per-leg verdicts + texts. findCorePath stays — mapTheme,
   * market-desk, and pool-detail all build on it.) */

  /* _cssTok: theme token value or the fallback (headless-safe). */

  /* Map theme (pure, unit-tested): the full owner-spec verdict for one pair.
   * Legs read green/yellow/red by their OWN BTS status (direct ≤1 hop,
   * indirect n hops, orphan); BTS always blue; rest grey. Edges: the direct
   * leg↔leg pool and every pool on either leg's shortest BTS path glow
   * bold yellow; user highlight wins ties (soft glow); rest thin grey.
   * Texts: upper-left assetA, upper-right assetB (green connects / yellow
   * n-hops / red bold orphaned), lower-center pair verdict (green direct /
   * yellow n-hop reach / red bold orphaned), centered takeover (red bold
   * 1.5x) ONLY when no edges exist at all — disjoint-but-present maps show
   * three reds over the visible map instead. A===B collapses the pair
   * verdict (corners carry it). Symbols resolve from graph nodes, bare ids
   * stand. Returns {a, b, nodeColors, pathPools, legEdge, texts, takeover}.
   * Never throws (garbage -> all-orphan theme). */
  function legStatus(graph, id) {
    try {
      if (!id) return { level: "orphan", hops: null };
      if (String(id) === CORE_ID) return { level: "direct", hops: 0, via: [] };
      var p = findCorePath(graph, id);
      if (p && Array.isArray(p.hops) && p.hops.length >= 2) {
        var hops = p.hops.length - 1;
        return hops <= 1
          ? { level: "direct", hops: hops, via: p.via || [] }
          : { level: "indirect", hops: hops, via: p.via || [] };
      }
    } catch (e) { /* orphan below */ }
    return { level: "orphan", hops: null, via: [] };
  }
  function legDistance(graph, fromId, toId) {
    try {
      if (!fromId || !toId) return null;
      if (String(fromId) === String(toId)) return 0;
      var adj = {};
      ((graph && graph.edges) || []).forEach(function (e) {
        if (!e || !e.a || !e.b) return;
        (adj[e.a] = adj[e.a] || []).push(e.b);
        (adj[e.b] = adj[e.b] || []).push(e.a);
      });
      var seen = {}, q = [{ id: fromId, d: 0 }];
      seen[fromId] = 1;
      while (q.length) {
        var cur = q.shift();
        var nexts = adj[cur.id] || [];
        for (var i = 0; i < nexts.length; i++) {
          if (seen[nexts[i]]) continue;
          if (String(nexts[i]) === String(toId)) return cur.d + 1;
          seen[nexts[i]] = 1;
          q.push({ id: nexts[i], d: cur.d + 1 });
        }
      }
    } catch (e) { /* null below */ }
    return null;
  }
  function mapTheme(graph, assetA, assetB) {
    var sym = {};
    try {
      ((graph && graph.nodes) || []).forEach(function (n) {
        if (n && n.assetId) sym[n.assetId] = n.sym || n.assetId;
      });
    } catch (e) { /* bare ids stand */ }
    function S(id) { return sym[id] || String(id === undefined || id === null ? "?" : id); }
    var A = assetA, B = assetB;
    var stA = legStatus(graph, A), stB = legStatus(graph, B);
    var edges = (graph && Array.isArray(graph.edges)) ? graph.edges : [];
    var legEdge = null;
    if (A && B && String(A) !== String(B)) {
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i] || {};
        if ((String(e.a) === String(A) && String(e.b) === String(B)) ||
            (String(e.a) === String(B) && String(e.b) === String(A))) {
          legEdge = e.poolId || null;
          break;
        }
      }
    }
    var pathPools = [];
    [stA, stB].forEach(function (st) {
      (st.via || []).forEach(function (pid) {
        if (pid && pathPools.indexOf(pid) === -1) pathPools.push(pid);
      });
    });
    function legText(id, st) {
      var s = S(id);
      /* The core is not "connected to" anything — it IS the anchor. Calling
       * it "BTS connects to BTS" in green reads as a finding; the honest line
       * is an identity statement in core blue (owner 2026-10-08). */
      if (String(id) === CORE_ID) {
        return { text: t("pool.map_core_self", "BTS is BitShares core token"), color: "bts", bold: false };
      }
      if (st.level === "direct") {
        return { text: t("pool.map_a_ok", "{s} connects to BTS").split("{s}").join(s), color: "live", bold: false };
      }
      if (st.level === "indirect") {
        return { text: t("pool.map_a_hops", "{s} {n} hops to BTS").split("{s}").join(s).split("{n}").join(String(st.hops)), color: "warn", bold: false };
      }
      return { text: t("pool.map_a_orphan", "WARNING: {s} is orphaned!").split("{s}").join(s), color: "danger", bold: true };
    }
    var nodeColors = {};
    try {
      Object.keys(sym).forEach(function (id) {
        if (id === CORE_ID) { nodeColors[id] = "bts"; return; }
        if (String(id) === String(A)) {
          nodeColors[id] = stA.level === "direct" ? "pair-good" : (stA.level === "indirect" ? "pair-warn" : "pair-bad");
          return;
        }
        if (String(id) === String(B)) {
          nodeColors[id] = stB.level === "direct" ? "pair-good" : (stB.level === "indirect" ? "pair-warn" : "pair-bad");
          return;
        }
        nodeColors[id] = "other";
      });
    } catch (e) { /* partial map stands */ }
    var same = !!(A && B && String(A) === String(B));
    var bottom = null;
    if (!same) {
      var dist = legDistance(graph, A, B);
      if (legEdge) {
        bottom = { text: t("pool.map_pair_ok", "{a} connects to {b}").split("{a}").join(S(A)).split("{b}").join(S(B)), color: "live", bold: false };
      } else if (dist !== null && dist !== undefined) {
        bottom = { text: t("pool.map_pair_reach", "{a} reaches {b} in {n} hops").split("{a}").join(S(A)).split("{b}").join(S(B)).split("{n}").join(String(dist)), color: "warn", bold: false };
      } else {
        bottom = { text: t("pool.map_pair_orphan", "WARNING: assets are orphaned!"), color: "danger", bold: true };
      }
    }
    return {
      a: stA, b: stB, nodeColors: nodeColors, pathPools: pathPools, legEdge: legEdge,
      left: legText(A, stA), right: legText(B, stB), bottom: bottom,
      takeover: edges.length === 0,
      takeoverText: t("pool.map_takeover", "WARNING: These assets are orphaned from the liquidity pool network!")
    };
  }
  function _cssTok(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }
  /* DPR-aware canvas fit (market-book fitPlot contract: {ctx,w,h} CSS px, or null). */
  function _fit(canvas, cssH) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    var w = canvas.clientWidth;
    if (!w && canvas.parentNode && canvas.parentNode.clientWidth) w = canvas.parentNode.clientWidth;
    if (!w || w <= 0) w = 300;
    var dpr = 1;
    try { if (typeof window !== "undefined" && window.devicePixelRatio) dpr = window.devicePixelRatio; } catch (e) { dpr = 1; }
    canvas.style.width = "100%"; canvas.style.height = cssH + "px";
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, cssH);
    return { ctx: ctx, w: w, h: cssH };
  }

  /* Session-only drag offsets, keyed by asset id. The Map lives on the canvas (never
   * storage) and resets whenever the graph data changes (data refresh), while surviving
   * theme/resize repaints of the same data. */
  function _dataKey(graph, assetA, assetB) {
    var ids = ((graph && graph.nodes) || []).map(function (n) { return n.assetId; }).sort().join(",");
    var pools = ((graph && graph.edges) || []).map(function (e) { return e.poolId; }).sort().join(",");
    return String(assetA) + "|" + String(assetB) + "|" + ids + "|" + pools;
  }
  function _offsetsFor(canvas, graph, assetA, assetB) {
    var key = _dataKey(graph, assetA, assetB);
    try {
      if (!canvas._graphOffsets || canvas._graphDataKey !== key) {
        canvas._graphOffsets = new Map(); canvas._graphDataKey = key;
      }
      return canvas._graphOffsets;
    } catch (e) { return new Map(); }
  }
  /* Headless-safe rAF (falls back to sync when unavailable — no timers ever). */
  function _raf(fn) {
    try {
      if (typeof requestAnimationFrame !== "undefined") { requestAnimationFrame(fn); return; }
    } catch (e) { /* sync fallback */ }
    fn();
  }
  /* Drag repaint: re-runs the existing drawGraph path from cached state (no new timers). */
  function _repaint(canvas) {
    var st = null;
    try { st = canvas._graphRepaint; } catch (e) { return; }
    if (!st) return;
    drawGraph(st.doc, canvas, st.graph, st.opts);
  }

  /* Canvas slice renderer. opts {assetA, assetB, highlightPools}. Empty -> honest text on canvas.
   * Click: node -> #/asset/sym, edge midpoint -> #/pools/id. Canvas tabindex + Enter opens core/first.
   * Drag offsets (session-only, see _offsetsFor) shift nodes after layout; layout() itself
   * stays deterministic. */
  function drawGraph(doc, canvas, graph, opts) {
    opts = opts || {};
    if (!canvas) return null;
    var g = _fit(canvas, 180);
    if (!g) return null;
    var accent = _cssTok("--accent", "#007bff"), border = _cssTok("--border", "#2a2e39"),
      text = _cssTok("--text", "#c5cbce"), buy = _cssTok("--buy", "#26de81"),
      /* "Path" lines (the pair's own pool + its route to BTS): a desaturated
       * accent so they read as a soft blue-grey on any panel, with a glow in
       * the full accent. Resolved once per frame, never a token name. */
      pathCol = withAlpha(accent, 0.55),
      muted = _cssTok("--muted", "#758696"), warn = _cssTok("--warn", "#fbbc06"),
      danger = _cssTok("--danger", "#f74745"), live = _cssTok("--live", "#7bd500");
    var ctx = g.ctx, nodes = (graph && graph.nodes) || [], edges = (graph && graph.edges) || [];
    var assetA = opts.assetA, assetB = opts.assetB;
    /* kind: "pool" (default) paints the pool provenance map with its BTS
     * trust verdict; "market" paints a 24h FILLED-market web, which has no
     * orphan concept (a thin market web is normal, never a scam warning) and
     * gets a fills ramp + an explicit BTS route instead. Same painter, one
     * branch — the clean split is backend-side, the style stays shared. */
    var isMarket = (opts && opts.kind === "market");
    var hi = {};
    (opts.highlightPools || []).forEach(function (id) { hi[String(id)] = 1; });
    /* emptyLine: centered canvas message (no-data states). */
    function emptyLine(s) {
      ctx.fillStyle = muted; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(s, g.w / 2, g.h / 2); ctx.textAlign = "left";
    }
    if (!edges.length) {
      /* Markets: an honest empty, NEVER the red takeover banner. "No market
       * filled in 24h around these legs" is ordinary illiquidity; painting
       * it as a pool-orphan warning on a market desk would cry wolf. */
      if (isMarket) {
        try {
          ctx.fillStyle = muted; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
          ctx.fillText(t("market.map_hops_empty", "No market filled in the past 24 hours around these legs."), g.w / 2, g.h / 2);
          ctx.textAlign = "left";
        } catch (eME) { /* honest empty stands */ }
      } else {
      /* Takeover: truly empty legs — red, bold, 1.5x, centered both ways. */
      try {
        ctx.fillStyle = danger; ctx.font = "bold 18px system-ui, sans-serif"; ctx.textAlign = "center";
        try {
          ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.strokeText(t("pool.map_takeover", "WARNING: These assets are orphaned from the liquidity pool network!"), g.w / 2, g.h / 2);
        } catch (e) { /* halo best-effort */ }
        ctx.fillText(t("pool.map_takeover", "WARNING: These assets are orphaned from the liquidity pool network!"), g.w / 2, g.h / 2);
        ctx.textAlign = "left";
      } catch (e) { emptyLine("No pools touch these assets."); }
      }
      _wire(canvas, {}, [], doc);
      /* A11y: empty map is not interactive (no tabindex trap) but stays
       * named so the canvas text is exposed. */
      try { canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", t("pool.map_touch_aria", "Pool map. No pools touch these assets — pick a pair with a pool, or create one at #/pools.")); } catch (e) {}
      return { empty: true };
    }
    /* Live-loop seam (Task 5, one line): a caller-provided _pos map skips the
     * layout→relax seed and paints those positions through the identical
     * downstream path (offsets, verdicts, edges, labels, hit-test). Absent
     * _pos the calm settle-once path is byte-identical. */
    var base = (opts && opts._pos) ? opts._pos : relax(graph, layout(graph, assetA, assetB, g.w, g.h),
      g.w, g.h, { assetA: assetA, assetB: assetB });
    var offs = _offsetsFor(canvas, graph, assetA, assetB);
    var pos = {};
    Object.keys(base).forEach(function (id) {
      var o = null;
      try { o = offs.get(id); } catch (e) { o = null; }
      pos[id] = o ? { x: base[id].x + o.dx, y: base[id].y + o.dy } : { x: base[id].x, y: base[id].y };
    });
    try { canvas._graphBase = base; } catch (e) {}
    /* Nav mode is remembered so a later hover repaint navigates the same way.
     * The HOVER is NOT stored here: it lives on the canvas and drawGraph reads
     * it live. Storing a snapshot meant the map repainted one frame behind —
     * no yellow while hovering, then a stuck yellow after leaving. */
    try {
      canvas._graphNav = (opts && opts.nav) ? opts.nav : null;
      canvas._graphRepaint = { doc: doc, graph: graph, opts: opts };
    } catch (e) {}
    var symById = {}; nodes.forEach(function (n) { symById[n.assetId] = n.sym || n.assetId; });
    /* Map text contract: corner verdicts per leg + bottom pair verdict, all from one mapTheme call. */
    var theme = null;
    /* Markets carry no BTS-trust verdict: an "orphan" market pair is just an
     * illiquid pair, and painting it red would cry wolf. theme stays null,
     * which also silences the corner/bottom verdict text + takeover banner. */
    if (!isMarket) { try { theme = mapTheme(graph, assetA, assetB); } catch (e) { theme = null; } }
    /* Corner + bottom text painter (haloed like node labels; bold reds). */
    function cornerText(item, x, align, size) {
      if (!item || !item.text) return;
      try {
        /* "bts" is the core-identity ink (theme accent, BitShares blue in all
         * three themes) — the only non-verdict color on the corners. */
        var colormap = { live: live, warn: warn, danger: danger, bts: accent };
        ctx.font = (item.bold ? "bold " : "") + (size || 12) + "px system-ui, sans-serif";
        ctx.textAlign = align;
        try {
          ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.strokeText(item.text, x, item.y);
        } catch (e) { /* halo best-effort */ }
        ctx.fillStyle = colormap[item.color] || text;
        ctx.fillText(item.text, x, item.y);
        ctx.textAlign = "left";
      } catch (e) { /* map stands without this line */ }
    }
    if (theme && !theme.takeover) {
      cornerText({ text: theme.left.text, color: theme.left.color, bold: theme.left.bold, y: 14 }, 8, "left");
      cornerText({ text: theme.right.text, color: theme.right.color, bold: theme.right.bold, y: 14 }, g.w - 8, "right");
    }
    var hits = [];
    var pathSet = {};
    try {
      if (isMarket) {
        /* The "most-filled route to BTS" (MarketHops.routeToCore) is the
         * market counterpart of the pool map's own-line + BTS-route glow:
         * the structure you are here to read, so it is the only thing that
         * glows. No route -> no highlight, which is honest, not a warning. */
        (opts.routeDeskIds || []).forEach(function (id) { if (id) pathSet[String(id)] = 1; });
      } else {
        ((theme && theme.pathPools) || []).forEach(function (pid) { pathSet[String(pid)] = 1; });
        if (theme && theme.legEdge) pathSet[String(theme.legEdge)] = 1;
      }
    } catch (e) { /* plain edges stand */ }
    var deg = {}; edges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    var mids = [];
    /* Live hover from the canvas (single source of truth); an explicit
     * opts.hoverEdge still wins so a caller can paint a state directly. */
    var hoverEdge = "";
    try {
      if (opts && opts.hoverEdge != null) hoverEdge = String(opts.hoverEdge);
      else if (canvas && canvas._graphHoverEdge) hoverEdge = String(canvas._graphHoverEdge);
    } catch (e) { hoverEdge = ""; }
    edges.forEach(function (e) {
      var p = pos[e.a], q = pos[e.b];
      if (!p || !q) return;
      /* THE TRIANGLE (owner 2026-10-07): the pool joining the two desk legs
       * plus both legs' routes to BTS are ONE visual unit — the pools that
       * actually matter for this pair — so they all wear the same green.
       * They used to be bold yellow, which collided with the hover colour
       * and read as "something special" on every map.
       * YELLOW NOW MEANS HOVERED, and only that: the pointer is on this
       * line and a click opens it (pool on the swap desk, market on the
       * exchange desk). Hover wins over the triangle; everything else stays
       * thin grey. The user highlight keeps its soft glow. */
      var st = edgeStyle(e.poolId, hi, pathSet, hoverEdge);
      /* Base ink is the size ramp (owner 2026-10-07 — color replaced the
       * flat border grey; interaction tokens keep overriding). Window
       * 4–22 digits: live probe 2026-10-07 over 515 pools (bulk 8–22),
       * same window as the bands' pool mode so one blue means one size
       * everywhere. sizeRaw is the BigInt-sum digit string. */
      var baseT = 0;
      try {
        /* Pool: BigInt-sum digit length over 18 (window 4-22, the live probe
         * 2026-10-07 over 515 pools). Market: the 24h FILL COUNT digit length
         * over a short window (fills run 1 -> hundreds of thousands, so 3
         * decades span the real range). Counts only, never money — the same
         * grey-to-accent ramp, a window calibrated to its own quantity. */
        if (isMarket) {
          var fc = Number(e.fills);
          if (isFinite(fc) && fc > 0) {
            var fd = String(Math.floor(fc)).replace(/^0+/, "").length;
            baseT = fd <= 1 ? 0 : Math.min((fd - 1) / 3, 1);
          }
        } else {
          var rawS = String(e.sizeRaw == null ? "" : e.sizeRaw);
          if (/^\d+$/.test(rawS)) {
            var dd = rawS.replace(/^0+/, "").length;
            baseT = dd <= 4 ? 0 : Math.min((dd - 4) / 18, 1);
          }
        }
      } catch (e2) { baseT = 0; }
      var col = (st.color === "warn") ? warn : (st.color === "path" ? pathCol : _ramp(baseT, muted, accent));
      ctx.strokeStyle = col;
      ctx.lineWidth = st.width;
      /* The pair's own line + its route to BTS are the ONLY glowing lines, in
       * their own colour (owner: the glow is wanted, on these). The hovered
       * line never glows — yellow alone means "this one is live". */
      var glowing = (st.color === "path");
      if (glowing) {
        try { ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 12; } catch (e2) { /* glow best-effort */ }
      }
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      if (glowing) {
        try { ctx.restore(); } catch (e3) { /* state stands */ }
      }
      /* Both legs AND their symbols ride along: the swap desk navigates an
       * edge to the pool, the exchange desk to the ORDER BOOK for those two
       * legs — and a market id is symbol-based (QUOTE_BASE), not object-id
       * based, so the hit record has to carry what it needs. */
      mids.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, poolId: e.poolId,
        ax: p.x, ay: p.y, bx: q.x, by: q.y,
        a: e.a, b: e.b, aSym: symById[e.a] || String(e.a), bSym: symById[e.b] || String(e.b),
        /* fills ride the hit so the desk can show the 24h activity behind
         * the line (price provenance, spec §2 G3). Undefined for pools. */
        fills: (e.fills === undefined) ? null : e.fills });
    });
    var hits = [];
    var rings = _rings(graph, assetA, assetB), inL2 = {};
    rings.l2.forEach(function (id) { inL2[id] = 1; });
    nodes.forEach(function (n) {
      var p = pos[n.assetId];
      if (!p) return;
      var r = _nodeRadius(deg[n.assetId]); /* degree-sized, pixels only */
      /* Owner-spec nodes (from theme.nodeColors): BTS always theme-blue,
       * each leg green/yellow/red by its OWN BTS verdict, rest grey. */
      var ncol = (theme && theme.nodeColors && theme.nodeColors[n.assetId]) || "other";
      ctx.fillStyle = ncol === "bts" ? accent
        : (ncol === "pair-good" ? live : (ncol === "pair-warn" ? warn : (ncol === "pair-bad" ? danger : muted)));
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke();
      /* Small label with dark halo (strokeText under fillText) so it reads on any
       * theme; outer-ring labels sit BELOW the node, inner rings ABOVE (stagger). */
      var label = String(symById[n.assetId]).slice(0, 12);
      var ly = inL2[n.assetId] ? p.y + r + 11 : p.y - r - 4;
      ctx.font = "10px system-ui, sans-serif"; ctx.textAlign = "center";
      try {
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(label, p.x, ly);
      } catch (e) { /* halo best-effort */ }
      ctx.fillStyle = text;
      ctx.fillText(label, p.x, ly);
      ctx.textAlign = "left";
      hits.push({ x: p.x, y: p.y, r: r, assetId: n.assetId, sym: symById[n.assetId] });
    });
    if (theme && theme.bottom) {
      cornerText({ text: theme.bottom.text, color: theme.bottom.color, bold: theme.bottom.bold, y: g.h - 8 },
        g.w / 2, "center", 12);
    }
    /* Market hover caption: the PRICE PROVENANCE line (spec G3). The pools
     * map has no caption — its story is the corner verdicts — but a market
     * line's meaning is "this pair actually traded", so the hovered line
     * states the evidence: 24h fill count + the chain's own last price.
     * Reads nothing from ES beyond the count; price/volume arrive in
     * opts.meta keyed by desk id (the view's own chain ticker probe), and a
     * miss omits the price rather than inventing one. Never throws. */
    if (isMarket) {
      try {
        var hovMid = null;
        for (var mi = 0; mi < mids.length; mi++) {
          if (hoverEdge && String(mids[mi].poolId) === String(hoverEdge)) { hovMid = mids[mi]; break; }
        }
        if (hovMid) {
          var hm = (opts.meta && opts.meta[hovMid.poolId]) || null;
          var fillsTxt = (hm && hm.fills !== undefined && hm.fills !== null) ? String(hm.fills) : "?";
          var cap = t("market.map_edge_fills", "%(desk)s \u00b7 %(a)s\u2013%(b)s \u00b7 %(fills)s fills/24h", {
            desk: String(hovMid.poolId), a: String(hovMid.aSym || "?"), b: String(hovMid.bSym || "?"), fills: fillsTxt });
          if (hm && hm.latest !== undefined && hm.latest !== null && String(hm.latest) !== "") {
            var volTxt = null;
            try {
              if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function" &&
                  hm.volBasePrec !== undefined && hm.volBasePrec !== null && hm.volBaseRaw !== undefined) {
                volTxt = Format.formatAmount(String(hm.volBaseRaw || "0"), hm.volBasePrec) + " " + String(hm.symA || "");
              }
            } catch (eV) { volTxt = null; }
            cap += " " + t("market.map_edge_price", "@ %(price)s \u00b7 %(vol)s",
              { price: String(hm.latest), vol: volTxt || "\u2014" });
          }
          cornerText({ text: cap, color: "live", bold: false, y: g.h - 8 }, g.w / 2, "center", 12);
        }
      } catch (eC) { /* caption is best-effort */ }
    }
    /* Edge records keep their SEGMENT (ax..by) and both legs/symbols: the
     * line is the click target along its whole length, and the exchange desk
     * resolves the order book from the legs. Only the internal bookkeeping
     * keys are dropped here. */
    _wire(canvas, pos, hits.concat(mids.map(function (m) {
      return { edgeMid: true, x: m.x, y: m.y, poolId: m.poolId,
        ax: m.ax, ay: m.ay, bx: m.bx, by: m.by,
        a: m.a, b: m.b, aSym: m.aSym, bSym: m.bSym, fills: m.fills };
    })), doc);
    try { canvas.setAttribute("tabindex", "0"); } catch (e) {}
    /* A11y 2026-09-30: named canvas (keyboard Enter above). Router sweep
     * skips labeled canvases, so this specific label wins over its generic. */
    try {
      if (!canvas.getAttribute("aria-label")) {
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", isMarket
          ? t("market.map_aria", "Market network. Lines are markets that filled in the past 24 hours.")
          : t("pool.map_core_aria", "Pool map. Press Enter to open the core asset."));
      }
    } catch (e) {}
    /* Screen-reader twin for the corner verdicts (canvas text is invisible
     * to assistive tech): refresh the label with this render's verdicts. */
    try {
      if (theme && !theme.takeover) {
        var ariaBits = [];
        if (theme.left && theme.left.text) ariaBits.push(theme.left.text);
        if (theme.right && theme.right.text) ariaBits.push(theme.right.text);
        if (theme.bottom && theme.bottom.text) ariaBits.push(theme.bottom.text);
        if (ariaBits.length) {
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", ariaBits.join(" "));
        }
      }
    } catch (e) { /* generic label stands */ }
    try { if (!canvas._graphDrag) canvas.style.cursor = "pointer"; } catch (e) {}
    return { empty: false, nodes: hits.length, edges: mids.length };
  }

  /* navForHit: pure hit record -> hash string (no location write, so the
   * headless audit vectors can prove every edge/node target without a DOM).
   * Edge-mid hits (poolId, no sym) route to the swap desk #/pools/:id (raw
   * 1.19.x, router.js:272); node hits route to #/asset/:symbol
   * (encodeURIComponent so dots stay verbatim and slashes stay route-safe,
   * router.js:243). Null hit -> null (no navigation). Behavior of the
   * click/keydown handlers below is byte-identical to the inline strings
   * they replace.
   * @param {Object|null} h Hit record ({sym} or {edgeMid, poolId}).
   * @returns {string|null} Hash target, or null for a null hit. */
  function navForHit(h, nav) {
    if (!h) return null;
    if (h.edgeMid) {
      if (nav && nav.mode === "market") {
        var m = marketIdForEdge(h, nav);
        return m ? "#/market/" + m : null;
      }
      return "#/pools/" + String(h.poolId);
    }
    return "#/asset/" + encodeURIComponent(String(h.sym));
  }

  /* marketIdForEdge: the ORDER BOOK for the two assets an edge joins, as a
   * QUOTE_BASE id (the desk convention — quote is the URL head). Orientation
   * rule, in order: the desk's BASE leg stays the base when this edge touches
   * it (so "X per my base" reads the same as the desk you are on); else the
   * desk's QUOTE leg stays the quote; else the pool's own order. Never
   * invents a market: an unknown/empty leg yields null and the caller just
   * does not navigate.
   * @param {Object} h Edge-mid hit ({a, b, aSym, bSym}).
   * @param {{quoteAsset?: string, baseAsset?: string}} nav Desk legs (object ids).
   * @returns {string|null} QUOTE_BASE market id, or null. */
  function marketIdForEdge(h, nav) {
    try {
      var legA = String(h.a), legB = String(h.b);
      var symA = String(h.aSym), symB = String(h.bSym);
      var deskQuote = (nav && nav.quoteAsset != null) ? String(nav.quoteAsset) : null;
      var deskBase = (nav && nav.baseAsset != null) ? String(nav.baseAsset) : null;
      if (!symA || !symB || symA === symB) return null;
      var quote = "", base = "";
      var touchesBase = !!(deskBase && (legA === deskBase || legB === deskBase));
      var touchesQuote = !!(deskQuote && (legA === deskQuote || legB === deskQuote));
      if (touchesBase) {
        /* keep the desk's base leg as the base; the other leg quotes it */
        base = (legA === deskBase) ? symA : symB;
        quote = (legA === deskBase) ? symB : symA;
      } else if (touchesQuote) {
        /* keep the desk's quote leg as the quote; the other leg is the base */
        quote = (legA === deskQuote) ? symA : symB;
        base = (legA === deskQuote) ? symB : symA;
      } else {
        /* neither desk leg: the pool's own order, stated honestly */
        quote = symA; base = symB;
      }
      if (!quote || !base || quote === base) return null;
      return quote + "_" + base;
    } catch (e) { return null; }
  }

  /* edgeStyle: the ONE place a line's colour is decided (owner 2026-10-07).
   * Precedence, and only three states:
   *   HOVERED -> yellow ("warn"): this line is under your pointer and a click
   *     opens it. Nothing else is ever yellow.
   *   THE PAIR'S OWN LINE + ITS ROUTE TO BTS (the "path" set: the leg<->leg
   *     pool plus both legs' hops to BTS) -> bluish grey with a glow. It is
   *     the structure you are here to read, so it is the only thing that
   *     glows; it must not shout for attention, hence a desaturated accent.
   *   EVERYTHING ELSE -> the muted grey border colour.
   * Pure, so the audit vectors pin the contract.
   * @param {string} poolId Edge pool id.
   * @param {Object} hi Highlighted pools (user highlight).
   * @param {Object} pathSet The pair's own pool + its BTS route.
   * @param {string} hoverEdge Hovered pool id ("" when none).
   * @returns {{color: string, width: number}} token name + line width. */
  function edgeStyle(poolId, hi, pathSet, hoverEdge) {
    var id = String(poolId);
    if (hoverEdge && id === String(hoverEdge)) return { color: "warn", width: 3 };
    if ((pathSet && pathSet[id]) || (hi && hi[id])) return { color: "path", width: 2.5 };
    return { color: "ramp", width: 1.25 };
  }

  /* sizeT: pool-size parameter for the ramp — stripped digit length over
   * 14 (the bands' scale, so a given blue means the same thing on every
   * map). Counts only, never values — no floats on money.
   * @param {any} sizeRaw digit string (BigInt-sum shape from buildGraph).
   * @returns {number} t in [0,1]. Never throws. */

  /* withAlpha: a canvas-safe colour at reduced opacity, so the "path" lines
   * can read as a soft blue-grey on any panel without a per-theme token.
   * Parses #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() and returns the input
   * untouched when it cannot (never throws, never paints an invalid value —
   * an unparseable colour would silently fall back to black). */
  function withAlpha(color, alpha) {
    try {
      var c = String(color || "").trim();
      var m = /^#([0-9a-f]{3,8})$/i.exec(c);
      if (m) {
        var h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split("").map(function (x) { return x + x; }).join("");
        if (h.length !== 6 && h.length !== 8) return c;
        var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        var a0 = (h.length === 8) ? parseInt(h.slice(6, 8), 16) / 255 : 1;
        return "rgba(" + r + "," + g + "," + b + "," + (a0 * alpha).toFixed(3) + ")";
      }
      var rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
      if (rgb) {
        var parts = rgb[1].split(",").map(function (x) { return x.trim(); });
        if (parts.length >= 3) return "rgba(" + parts[0] + "," + parts[1] + "," + parts[2] + "," + alpha.toFixed(3) + ")";
      }
      return c;
    } catch (e) { return String(color || ""); }
  }

  /* EDGE_TOL: how close (CSS px) the pointer must be to a line to mean it.
   * The line is a hit TARGET across its whole length, not a dot at its
   * midpoint: people aim at the line they can see, so the whole segment is
   * clickable (the old midpoint-only test meant most clicks on a line did
   * nothing, or landed on a nearby node instead). */
  var EDGE_TOL = 8;

  /* segDist: distance from point (x,y) to segment (ax,ay)-(bx,by).
   * Pure math, unit-tested headless.
   * @returns {number} pixels (0 when the point is on the segment). */
  function segDist(x, y, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return Math.sqrt((x - ax) * (x - ax) + (y - ay) * (y - ay));
    var t = ((x - ax) * dx + (y - ay) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var px = ax + t * dx, py = ay + t * dy;
    return Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
  }

  /* hitAt: resolve a pointer position to the ONE thing it means — a node
   * inside its radius, else the nearest edge LINE within EDGE_TOL. Node wins
   * near a circle so dragging stays reliable (a line ends at its nodes).
   * Pure over a hit list, so the audit vectors prove it without a DOM.
   * @param {number} x CSS px. @param {number} y CSS px.
   * @param {Array<Object>} hits node + edgeMid records.
   * @param {number} [tol] edge tolerance override.
   * @returns {Object|null} the hit record, or null. */
  function hitAt(x, y, hits, tol) {
    var list = hits || [];
    var tolE = (typeof tol === "number") ? tol : EDGE_TOL;
    var best = null, bestD = 1e9, i, h, d;
    for (i = 0; i < list.length; i++) {
      h = list[i];
      if (!h || h.edgeMid) continue;
      d = Math.sqrt((h.x - x) * (h.x - x) + (h.y - y) * (h.y - y));
      if (d <= (h.r + 5) && d < bestD) { bestD = d; best = h; }
    }
    if (best) return best;
    for (i = 0; i < list.length; i++) {
      h = list[i];
      if (!h || !h.edgeMid || !h.ax || !h.bx) continue;
      d = segDist(x, y, h.ax, h.ay, h.bx, h.by);
      if (d <= tolE && d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  /* One-time wiring: click + Enter navigation (kept), node hover cursor, edge
   * hover highlight, and direct node dragging. Pointer events cover mouse + touch; touch-action:none applies ONLY
   * while a drag is active so page scroll is untouched otherwise. NO physics — a drag
   * writes a plain {dx,dy} offset into the session Map and repaints via drawGraph. */
  function _wire(canvas, pos, hits, doc) {
    void pos; void doc;
    /* Nearest node within its hit-test radius (edges excluded — same tol as click). */
    function nodeAt(x, y) {
      var best = null, bestD = 1e9;
      (canvas._graphHits || []).forEach(function (h) {
        if (!h || h.edgeMid) return;
        var dx = h.x - x, dy = h.y - y, d = Math.sqrt(dx * dx + dy * dy);
        if (d <= h.r + 5 && d < bestD) { bestD = d; best = h; }
      });
      return best;
    }
    /* CSS-pixel pointer position (null when unavailable). */
    function ptr(ev) {
      try {
        var box = canvas.getBoundingClientRect();
        return { x: ev.clientX - box.left, y: ev.clientY - box.top };
      } catch (e) { return null; }
    }
    try {
      if (canvas._graphWired) { canvas._graphHits = hits; return; }
      canvas._graphWired = true; canvas._graphHits = hits;
      canvas.addEventListener("click", function (ev) {
        try {
          if (canvas._graphSuppressClick) { canvas._graphSuppressClick = false; return; }
        } catch (e) {}
        var p = ptr(ev);
        if (!p) return;
        var best = hitAt(p.x, p.y, canvas._graphHits);
        if (!best) return;
        try {
          var target = navForHit(best, canvas._graphNav);
          if (target) window.location.hash = target;
        } catch (e) { /* navigation best-effort */ }
      });
      canvas.addEventListener("pointerdown", function (ev) {
        var p = ptr(ev);
        if (!p) return;
        var hit = nodeAt(p.x, p.y);
        if (!hit) return;
        try {
          canvas._graphDrag = { id: hit.assetId, moved: false, sx: p.x, sy: p.y };
          if (typeof canvas.setPointerCapture === "function") {
            try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
          }
          canvas.style.touchAction = "none";
          canvas.style.cursor = "grabbing";
        } catch (e) { try { canvas._graphDrag = null; } catch (x) {} }
      });
      canvas.addEventListener("pointermove", function (ev) {
        var drag = null;
        try { drag = canvas._graphDrag; } catch (e) {}
        if (drag) {
          var p = ptr(ev);
          if (!p) return;
          if (Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) > 4) drag.moved = true;
          var base = null, offs = null;
          try { base = canvas._graphBase; offs = canvas._graphOffsets; } catch (e) {}
          if (base && base[drag.id] && offs && typeof offs.set === "function") {
            offs.set(drag.id, { dx: p.x - base[drag.id].x, dy: p.y - base[drag.id].y });
          }
          try { if (canvas._graphRaf) return; canvas._graphRaf = true; } catch (e) {}
          _raf(function () {
            try { canvas._graphRaf = false; } catch (e) {}
            _repaint(canvas);
            try { canvas.style.cursor = "grabbing"; } catch (e) {}
          });
        } else {
          /* Hover: grab over a node, and an EDGE turns YELLOW under the
           * pointer (the selector bands' behavior, brought to the desk maps).
           * rAF-throttled — pointermove subsumes mousemove, and a repaint per
           * event would repaint the whole map per mouse sample.
           * Yellow means exactly one thing here: this line is clickable. */
          try { if (canvas._graphHoverRaf) return; canvas._graphHoverRaf = true; } catch (e) {}
          _raf(function () {
            var q = ptr(ev);
            try {
              canvas._graphHoverRaf = false;
              if (canvas._graphDrag) return;
              canvas.style.cursor = q && nodeAt(q.x, q.y) ? "grab" : "pointer";
              if (!q) return;
              var h = hitAt(q.x, q.y, canvas._graphHits);
              var edge = (h && h.edgeMid) ? String(h.poolId) : "";
              if (String(canvas._graphHoverEdge || "") === edge) return;
              canvas._graphHoverEdge = edge;
              _repaint(canvas);
            } catch (e) {}
          });
        }
      });
      /* Leaving the canvas clears the hover (a stale yellow line with no
       * pointer over it reads as a stuck selection). */
      canvas.addEventListener("pointerleave", function () {
        try {
          if (canvas._graphHoverRaf) { canvas._graphHoverRaf = false; }
          if (!canvas._graphHoverEdge) return;
          canvas._graphHoverEdge = "";
          _repaint(canvas);
        } catch (e) { /* hover stands */ }
      });
      /* Release the drag; a drag that moved suppresses the click that follows it.
       * A moved release re-energizes the lively loop explicitly (band wake
       * policy: the drop is a user gesture, so neighbors visibly react;
       * without this the release lands dead on a paused map). */
      function endDrag() {
        try {
          var moved = !!(canvas._graphDrag && canvas._graphDrag.moved);
          canvas._graphDrag = null;
          canvas.style.touchAction = "";
          canvas.style.cursor = "pointer";
          if (moved) canvas._graphSuppressClick = true;
          if (moved) {
            var liveS = null;
            try { liveS = canvas._graphLiveS; } catch (e) { liveS = null; }
            /* OFF = the mesh stays where it was dropped (wake() refuses an
             * explicit gesture anyway; stating it here keeps the promise
             * readable at the call site). */
            if (liveS && liveS.react !== false) wake(liveS, true);
          }
        } catch (e) {}
      }
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener("keydown", function (ev) {
        if (!ev || (ev.key !== "Enter" && ev.keyCode !== 13)) return;
        try {
          var hs = canvas._graphHits || [];
          var core = null, first = null;
          hs.forEach(function (h) { if (!h.edgeMid && !first) first = h; if (!h.edgeMid && h.assetId === CORE_ID) core = h; });
          var tgt = core || first;
          if (tgt) {
            var keyTarget = navForHit(tgt);
            if (keyTarget) { ev.preventDefault(); window.location.hash = keyTarget; }
          }
        } catch (e) { /* navigation best-effort */ }
      });
    } catch (e) { /* headless: hits stored, no listeners */ try { canvas._graphHits = hits; } catch (x) {} }
  }

  return { poolsForAsset: poolsForAsset, buildGraph: buildGraph, findCorePath: findCorePath,
    layout: layout, drawGraph: drawGraph, CORE_ID: CORE_ID,
    setReact: setReact, readReact: readReact, drawLive: drawLive, stopLive: stopLive,
    PHYS_KEY: PHYS_KEY,
    _physForTest: _phys, _defaultReactForTest: _defaultReact,
    _runLiveForTest: _runLive, _wakeForTest: wake, _stepForTest: _liveStep,
    _navForTest: navForHit,
    _hitAtForTest: hitAt,
    _segDistForTest: segDist,
    _marketIdForTest: marketIdForEdge,
    _edgeStyleForTest: edgeStyle,
    _rampForTest: _ramp,
    _withAlphaForTest: withAlpha,
    _test: { selectL1: _selectL1, pickL2: _pickL2Assets, poolSize: _poolSize, sortBiggest: _sortBiggest,
      funded: _funded,
      nodeRadius: _nodeRadius, ringRadii: _ringRadii, relax: relax, edgeWeight: _edgeWeight,
      mapTheme: mapTheme } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolGraph === "undefined") { globalThis.PoolGraph = PoolGraph; }
if (typeof module !== "undefined") { module.exports = PoolGraph; }
