/* PoolGraph: 2-layer pool-connection provenance map (orphan-pair scam check).
 * Owns: poolsForAsset (one_asset reads), buildGraph (L0=A,B; L1 cap 8 biggest-first;
 *   L2 up to 6 counters limit 3; nodes cap 25), findCorePath (BFS fewest-hops to 1.3.0,
 *   widest-min-edge tiebreak), layout (deterministic layered rings, no physics/random),
 *   drawGraph (DPR canvas, theme tokens, click hit-test to #/asset + #/pools).
 * Consumes: Chain.db/.call (sole socket owner, _dbCall error contract mirrors pool.js);
 *   lookup_asset_symbols for sym join (misses degrade to bare ids). No DOM except the
 *   caller-provided canvas; no signing, no storage, no ES, no networkx. Global PoolGraph only.
 * Created by: building-vanilla-slices skill, pool-map task.
 * CHAIN TRUTH (#4 wins): get_liquidity_pools_by_one_asset(asset,limit,start,stats) <-
 *   database_api.hpp:769-773; by_asset_a/b <- :723/:746; list <- :701; pool object
 *   id/asset_a/asset_b/balance_a/balance_b (raw ints) <- liquidity_pool_object.hpp:44-60.
 *   BTS core = 1.3.0 literal (lookup_asset_symbols ["BTS"] would confirm; describe fallback
 *   unnecessary — id is consensus, symbol only labels).
 * PROVENANCE (dex-ux behavior-only, MATH IDEA ONLY — never a dependency, never imported):
 *   reference/bitshares-dex-ux networkx pool-connection plots proposed the 2-layer provenance
 *   map idea; this file ports the IDEA (layered rings + core-path highlight) to dependency-free
 *   canvas. Verified absent from the dex-ux checkout: no ES, no networkx runtime — chain only.
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
   * (smallest L2 pools dropped first). Partial on leg failures; throws not-connected only
   * when every pool fetch is offline. Never guesses symbols (bare ids stand). */
  async function buildGraph(assetA, assetB, opts) {
    _assertAsset(assetA); _assertAsset(assetB);
    opts = opts || {};
    var cap = opts.cap || NODE_CAP;
    var l1a = [], l1b = [], offline = 0;
    try { l1a = await poolsForAsset(assetA, 8); } catch (e) { if (e && e.message === "not-connected") offline++; else l1a = []; }
    try { l1b = await poolsForAsset(assetB, 8); } catch (e) { if (e && e.message === "not-connected") offline++; else l1b = []; }
    if (offline === 2) throw new Error("not-connected");
    l1a = _selectL1(l1a, L1_CAP); l1b = _selectL1(l1b, L1_CAP);
    var l1 = l1a.concat(l1b);
    var seenPool = {}, pools = [];
    l1.forEach(function (p) { if (!seenPool[p.id]) { seenPool[p.id] = 1; pools.push(p); } });
    var counters = _pickL2Assets(pools, assetA, assetB, L2_ASSETS);
    for (var i = 0; i < counters.length; i++) {
      var rows = [];
      try { rows = await poolsForAsset(counters[i], L2_LIMIT); }
      catch (e) { if (e && e.message === "not-connected") continue; rows = []; }
      rows = _selectL1(rows, L2_LIMIT);
      rows.forEach(function (p) { if (!seenPool[p.id]) { seenPool[p.id] = 1; pools.push(p); } });
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

  /* Deterministic layered rings: L0 center pair, L1 ring, L2 outer; angle by sorted index.
   * Returns {assetId:{x,y}} CSS pixels. Pure (tested for determinism). */
  function layout(graph, assetA, assetB, w, h) {
    w = w || 300; h = h || 180;
    var cx = w / 2, cy = h / 2, R = Math.min(w, h);
    var adj = {};
    (graph.edges || []).forEach(function (e) {
      (adj[e.a] = adj[e.a] || {})[e.b] = 1; (adj[e.b] = adj[e.b] || {})[e.a] = 1;
    });
    /* neigh: adjacent asset ids for one node id (empty when absent). */
    function neigh(id) { return adj[id] ? Object.keys(adj[id]) : []; }
    var l0 = [assetA, assetB], inL0 = {}; l0.forEach(function (id) { inL0[id] = 1; });
    var l1set = {};
    l0.forEach(function (id) { neigh(id).forEach(function (n) { if (!inL0[n]) l1set[n] = 1; }); });
    var l1 = Object.keys(l1set).sort(), inL1 = {}; l1.forEach(function (id) { inL1[id] = 1; });
    var l2 = (graph.nodes || []).map(function (n) { return n.assetId; })
      .filter(function (id) { return !inL0[id] && !inL1[id]; }).sort();
    var pos = {};
    var r0 = R * 0.09;
    pos[assetA] = { x: cx - r0, y: cy }; pos[assetB] = { x: cx + r0, y: cy };
    if (assetA === assetB) pos[assetA] = { x: cx, y: cy };
    function ring(ids, radius) {
      for (var i = 0; i < ids.length; i++) {
        var ang = -Math.PI / 2 + (i * 2 * Math.PI) / ids.length;
        pos[ids[i]] = { x: cx + radius * Math.cos(ang), y: cy + radius * Math.sin(ang) };
      }
    }
    if (l1.length) ring(l1, R * 0.24);
    if (l2.length) ring(l2, R * 0.40);
    (graph.nodes || []).forEach(function (n) { if (!pos[n.assetId]) pos[n.assetId] = { x: cx, y: cy }; });
    return pos;
  }

  /* _cssTok: theme token value or the fallback (headless-safe). */
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

  /* Canvas slice renderer. opts {assetA, assetB, highlightPools}. Empty -> honest text on canvas.
   * Click: node -> #/asset/sym, edge midpoint -> #/pools/id. Canvas tabindex + Enter opens core/first. */
  function drawGraph(doc, canvas, graph, opts) {
    opts = opts || {};
    if (!canvas) return null;
    var g = _fit(canvas, 180);
    if (!g) return null;
    var accent = _cssTok("--accent", "#007bff"), border = _cssTok("--border", "#2a2e39"),
      text = _cssTok("--text", "#c5cbce"), buy = _cssTok("--buy", "#26de81"),
      muted = _cssTok("--muted", "#758696");
    var ctx = g.ctx, nodes = (graph && graph.nodes) || [], edges = (graph && graph.edges) || [];
    var assetA = opts.assetA, assetB = opts.assetB;
    var hi = {};
    (opts.highlightPools || []).forEach(function (id) { hi[String(id)] = 1; });
    /* emptyLine: centered canvas message (no-data states). */
    function emptyLine(s) {
      ctx.fillStyle = muted; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(s, g.w / 2, g.h / 2); ctx.textAlign = "left";
    }
    if (!edges.length) { emptyLine("No pools touch these assets."); _wire(canvas, {}, [], doc); return { empty: true }; }
    var pos = layout(graph, assetA, assetB, g.w, g.h);
    var symById = {}; nodes.forEach(function (n) { symById[n.assetId] = n.sym || n.assetId; });
    var deg = {}; edges.forEach(function (e) { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });
    var mids = [];
    edges.forEach(function (e) {
      var p = pos[e.a], q = pos[e.b];
      if (!p || !q) return;
      var hot = !!hi[String(e.poolId)];
      ctx.strokeStyle = hot ? buy : border; ctx.lineWidth = hot ? 2.5 : 1.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      mids.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, poolId: e.poolId });
    });
    var hits = [];
    nodes.forEach(function (n) {
      var p = pos[n.assetId];
      if (!p) return;
      var r = 9 + Math.min(deg[n.assetId] || 0, 5) * 2; /* degree-sized, pixels only */
      var isCore = n.assetId === CORE_ID, isL0 = n.assetId === assetA || n.assetId === assetB;
      ctx.fillStyle = isCore ? buy : (isL0 ? accent : muted);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = text; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(String(symById[n.assetId]).slice(0, 12), p.x, p.y - r - 3);
      ctx.textAlign = "left";
      hits.push({ x: p.x, y: p.y, r: r, assetId: n.assetId, sym: symById[n.assetId] });
    });
    if (!Object.keys(hi).length) {
      ctx.fillStyle = muted; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("No BTS path — treat pair as unverified.", g.w / 2, g.h - 8); ctx.textAlign = "left";
    }
    _wire(canvas, pos, hits.concat(mids.map(function (m) { return { edgeMid: true, x: m.x, y: m.y, poolId: m.poolId }; })), doc);
    try { canvas.setAttribute("tabindex", "0"); } catch (e) {}
    try { canvas.style.cursor = "pointer"; } catch (e) {}
    return { empty: false, nodes: hits.length, edges: mids.length };
  }

  /* One-time click + Enter wiring (canvas has no per-node hover — hit-test instead). */
  function _wire(canvas, pos, hits, doc) {
    void pos; void doc;
    try {
      if (canvas._graphWired) { canvas._graphHits = hits; return; }
      canvas._graphWired = true; canvas._graphHits = hits;
      canvas.addEventListener("click", function (ev) {
        var box = null, x = 0, y = 0;
        try { box = canvas.getBoundingClientRect(); x = (ev.clientX - box.left); y = (ev.clientY - box.top); } catch (e) { return; }
        var best = null, bestD = 1e9;
        (canvas._graphHits || []).forEach(function (h) {
          var dx = h.x - x, dy = h.y - y, d = Math.sqrt(dx * dx + dy * dy);
          var tol = h.edgeMid ? 12 : (h.r + 5);
          if (d <= tol && d < bestD) { bestD = d; best = h; }
        });
        if (!best) return;
        try {
          if (best.edgeMid) window.location.hash = "#/pools/" + best.poolId;
          else window.location.hash = "#/asset/" + encodeURIComponent(best.sym);
        } catch (e) { /* navigation best-effort */ }
      });
      canvas.addEventListener("keydown", function (ev) {
        if (!ev || (ev.key !== "Enter" && ev.keyCode !== 13)) return;
        try {
          var hs = canvas._graphHits || [];
          var core = null, first = null;
          hs.forEach(function (h) { if (!h.edgeMid && !first) first = h; if (!h.edgeMid && h.assetId === CORE_ID) core = h; });
          var tgt = core || first;
          if (tgt) { ev.preventDefault(); window.location.hash = "#/asset/" + encodeURIComponent(tgt.sym); }
        } catch (e) { /* navigation best-effort */ }
      });
    } catch (e) { /* headless: hits stored, no listeners */ try { canvas._graphHits = hits; } catch (x) {} }
  }

  return { poolsForAsset: poolsForAsset, buildGraph: buildGraph, findCorePath: findCorePath,
    layout: layout, drawGraph: drawGraph, CORE_ID: CORE_ID,
    _test: { selectL1: _selectL1, pickL2: _pickL2Assets, poolSize: _poolSize, sortBiggest: _sortBiggest } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolGraph === "undefined") { globalThis.PoolGraph = PoolGraph; }
if (typeof module !== "undefined") { module.exports = PoolGraph; }
