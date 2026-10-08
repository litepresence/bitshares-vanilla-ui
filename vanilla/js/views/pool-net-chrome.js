/* NetChrome: pool-network band furniture (DOM builders only, no loop).
 * Owns: band element bundle (buildChrome: status line, canvas attrs,
 *   hover/verdict lines, brand legend, <details> table twin, Physics
 *   switch + stage), paintSwitch/setPhys, verdict/legend/twin painters,
 *   tap-card text (nodeCard/edgeCard), status writer. All builders take
 *   (doc, mk, t, touchable, S, callbacks) — no redesign, moved verbatim
 *   from PoolNetUI.mount. Repaint/physics go through callbacks (renderFn)
 *   and sibling globals (NetPaint layout/palette, PoolNetPhys preset+wake,
 *   NetGestures nav); data-load + selection flow stay in the composer.
 * Consumes: DOM builders via mk (composer-owned), I18n via t (composer
 *   param — never reimplemented here), Format/TableRenderer/PoolNet as
 *   classic-script globals (same guards as before). S shape: see
 *   PoolNetState in pool-net-phys.js. No new display strings (moved verbatim).
 * Created by: pool-net-ui split (mechanical move from pool-net-ui.js,
 *   zero behavior change). Exposes global NetChrome.
 */
var NetChrome = (function () {
  "use strict";

  /* BTS core id: consensus literal (1.3.0 on both chains) — hopsText treats
   * the core as directly paired. Same literal as phys/paint/gestures. */
  var CORE_ID = "1.3.0";
  /* Table-twin row cap, honest count note past it (moved verbatim). */
  var TWIN_CAP = 200;

  function setStatus(els, text) {
    try { els.statusEl.textContent = text; } catch (e) { /* stands */ }
  }

  /* Human balance at render (Format only; raw digit string when the
   * precision join missed — never a float, never blank). */
  function humanBal(raw, prec) {
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function" &&
        typeof prec === "number" && prec >= 0 && prec <= 12) return Format.formatAmount(raw, prec);
    } catch (e) { /* raw below */ }
    return String(raw);
  }

  /* isMarket: injected volume graph (desk map) — pool-only chrome
   * (brands, BTS hops, pool cards) stands down; market cards/status/twin
   * take over. Reads the mount opts the composer already stores on state. */
  function isMarket(S) {
    try { return !!(S && S.navOpts && S.navOpts.mode === "market"); }
    catch (e) { return false; }
  }

  function poolCount(S, assetId) {
    var n = 0;
    (S.view.edges || []).forEach(function (e) { if (e.a === assetId || e.b === assetId) n++; });
    return n;
  }

  function symOf(S, id) {
    var nodes = (S.full.nodes || []);
    for (var i = 0; i < nodes.length; i++) {
      if (String(nodes[i].assetId) === String(id)) return nodes[i].sym || String(id);
    }
    return String(id);
  }

  function hopsText(S, t, assetId) {
    if (String(assetId) === CORE_ID) return t("pool_net.direct", "paired with BTS");
    var p = null;
    try {
      if (typeof PoolNet !== "undefined" && PoolNet.findPath) p = PoolNet.findPath(S.full, assetId, CORE_ID);
    } catch (e) { p = null; }
    if (p && p.hops && p.hops.length >= 2) {
      var hops = p.hops.length - 1;
      return hops <= 1 ? t("pool_net.direct", "paired with BTS")
        : t("pool_net.hops", "%(n)s hops to BTS", { n: String(hops) });
    }
    return t("pool_net.orphan", "orphaned from BTS");
  }

  function nodeCard(S, t, assetId, sym) {
    if (isMarket(S)) {
      /* Markets count MARKETS (lines), pools count POOLS — the same number
       * word, but never interchangeable: a market selector answering "how
       * many pools touch this" would answer a different question. */
      return t("market_net.node_card", "%(sym)s (%(id)s) · %(n)s markets", {
        sym: String(sym), id: String(assetId), n: String(poolCount(S, assetId))
      });
    }
    return t("pool_net.node_card", "%(sym)s (%(id)s) · %(n)s pools · %(hops)s", {
      sym: String(sym), id: String(assetId), n: String(poolCount(S, assetId)), hops: hopsText(S, t, assetId)
    });
  }

  /* volText: the 24h volume line for a market edge, "SYM 1.234 + SYM 56.78".
   * Chain-owned raw volume scaled by Format at RENDER (never a float on the
   * raw value); a missing leg reads an em dash rather than a raw integer, so
   * a chain integer can never reach the screen. */
  function volText(m) {
    var a = humanBal(m.volBaseRaw, m.volBasePrec), b = humanBal(m.volQuoteRaw, m.volQuotePrec);
    var dash = "\u2014";
    return (a === "\u2014" && b === "\u2014") ? dash : (a + " " + (m.symA || "?") + " + " + b + " " + (m.symB || "?"));
  }

  function edgeCard(S, t, poolId) {
    if (isMarket(S)) {
      var m = S.meta[poolId] || {};
      /* PRICE PROVENANCE (spec G3): what makes this line trustworthy is
       * stated on the line itself — the 24h FILL COUNT (why it exists) and
       * the chain's own last price + 24h volume (why you would use it).
       * Either part is omitted when unknown; neither is ever invented. */
      var label;
      if (m.fills !== undefined && m.fills !== null && String(m.fills) !== "") {
        label = t("market_net.edge_card_fills", "%(desk)s · %(a)s–%(b)s · %(fills)s fills/24h", {
          desk: String(poolId), a: String(m.symA || "?"), b: String(m.symB || "?"), fills: String(m.fills)
        });
      } else {
        label = t("market_net.edge_card", "%(desk)s · %(a)s–%(b)s · %(vol)s", {
          desk: String(poolId), a: String(m.symA || "?"), b: String(m.symB || "?"), vol: volText(m)
        });
      }
      var tail = [];
      if (m.latest !== undefined && m.latest !== null && String(m.latest) !== "") tail.push(String(m.latest));
      if (m.volBaseRaw !== undefined && m.volBaseRaw !== null && String(m.volBaseRaw) !== "") tail.push(volText(m));
      if (tail.length) {
        label += " " + t("market_net.edge_card_price", "@ %(price)s", { price: tail.join(" · ") });
      }
      return label;
    }
    var m = S.meta[poolId] || {};
    var a = m.sym_a || "?", b = m.sym_b || "?";
    if (m.balance_a_raw !== undefined && m.balance_b_raw !== undefined) {
      return t("pool_net.edge_card", "%(pool)s · %(a)s–%(b)s · %(ba)s %(sa)s + %(bb)s %(sb)s", {
        pool: String(poolId), a: String(a), b: String(b),
        ba: humanBal(m.balance_a_raw, m.prec_a), sa: String(a),
        bb: humanBal(m.balance_b_raw, m.prec_b), sb: String(b)
      });
    }
    return t("pool_net.edge_nobal", "%(pool)s · %(a)s–%(b)s", { pool: String(poolId), a: String(a), b: String(b) });
  }

  function paintSwitch(S, els, t) {
    var on = S.react !== false;
    try {
      els.physSwitch.setAttribute("role", "switch");
      els.physSwitch.setAttribute("aria-checked", on ? "true" : "false");
      els.physSwitch.setAttribute("aria-label", t("pool_net.phys", "Physics"));
    } catch (e) { /* state stands */ }
    /* No visible On/Off word (owner 2026-10-07): the knob's side and the
     * accent color carry it visually, and role="switch" + aria-checked carry
     * it to assistive tech. Nothing to paint here. */
  }

  /* setReact: the band switch. ON = gestures wake the simulation again
   * (re-spread + a bounded settle — the flip IS consent to motion, and a
   * parked equilibrium has no forces to work with, so the flip re-runs the
   * fresh-load spread instead of nudging). OFF = gestures never wake it:
   * the running loop is stopped and residual velocity is dropped so
   * nothing drifts later, and the current layout is KEPT (no re-spread —
   * flipping off must not teleport the mesh the user was reading).
   * @param {PoolNetState} S Band state.
   * @param {Object} els Chrome bundle (repainted here).
   * @param {Function} t I18n wrapper.
   * @param {boolean} on true = gestures react. Never throws. */
  function setReact(S, els, t, on) {
    var next = (on === false) ? false : true;
    S.react = next;
    try {
      var PP = (typeof PoolNetPhys !== "undefined") ? PoolNetPhys : null;
      if (PP && typeof PP.writeReact === "function") PP.writeReact(next);
      else if (typeof localStorage !== "undefined") localStorage.setItem("poolNetReact", next ? "1" : "0");
    } catch (e) { /* memory-only session */ }
    paintSwitch(S, els, t);
    if (next) {
      try {
        if (S.view && S.view.nodes && S.view.nodes.length > 1) {
          S.geom = NetPaint.circleLayout(S.view.nodes, S.W, S.H);
          S.vel = {};
        }
      } catch (e) { /* positions stand */ }
      try {
        if (typeof PoolNetPhys !== "undefined" && PoolNetPhys && typeof PoolNetPhys._wakeForTest === "function") {
          PoolNetPhys._wakeForTest(S, true);
        }
      } catch (e) { /* loop stands */ }
    } else {
      /* Stop now, drop leftover velocity: a mesh that has just been parked
       * must not drift on the next automatic wake. */
      try { S.running = false; S.forced = false; } catch (e) { /* stopped anyway */ }
      try { if (typeof PoolNetPhys !== "undefined" && PoolNetPhys && typeof PoolNetPhys.cancel === "function") PoolNetPhys.cancel(S.raf); } catch (e) { /* stopped anyway */ }
      try { S.raf = 0; S.vel = {}; } catch (e) { /* velocity stands */ }
      try { if (typeof S.paint === "function") S.paint(S); } catch (e) { /* paint stands */ }
    }
    return S.react;
  }


  /* Build the band furniture into wrap; returns the els bundle (or null
   * when the stage cannot be assembled — the composer returns its idle api).
   * @param {Document} doc Owner document. @param {Function} mk (tag,text,cls)->el.
   * @param {Function} t I18n wrapper. @param {Function|null} touchFn touchable or null.
   * @param {Object} S Band state (PoolNetState; canvas/phys fields read+written).
   * @param {HTMLElement} wrap Band body element. */
  function buildChrome(doc, mk, t, touchFn, S, wrap) {
    var els = {
      statusEl: null, canvas: null, hoverEl: null, verdictEl: null, legendEl: null,
      twin: null, twinSummary: null, twinBox: null,
      physBar: null, physLabel: null, physSwitch: null, physTrack: null,
      physKnob: null,
      stage: null
    };
    els.statusEl = mk("p", t("pool_net.loading", "Loading network…"), "muted");
    try { els.statusEl.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    var canvas = null;
    try { canvas = doc.createElement("canvas"); } catch (e) { canvas = null; }
    if (!canvas) {
      try { wrap.appendChild(els.statusEl); } catch (e2) { /* stands */ }
      return null;
    }
    els.canvas = canvas;
    try {
      canvas.className = "pool-net-canvas";
      canvas.setAttribute("tabindex", "0");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", isMarket(S)
        ? t("market_net.canvas_label", "Market network map. Press Enter to open the market.")
        : t("pool_net.canvas_label", "Pool network map. Press Enter to open BTS."));
    } catch (e) { /* stub canvas */ }
    els.hoverEl = mk("div", "", "pool-net-hover");
    try { els.hoverEl.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    els.verdictEl = mk("p", "", "pool-net-verdict");
    els.legendEl = mk("div", null, "pool-net-legend");
    try {
      els.twin = doc.createElement("details");
      els.twin.className = "pool-net-twin";
    } catch (e) { els.twin = null; }
    els.twinSummary = mk("summary", t("pool_net.twin", "Pool rows (%(n)s)", { n: "0" }));
    els.twinBox = mk("div", null, "pool-net-twinbox");
    /* Physics switch: ONE labeled on/off control, and it is about GESTURES,
     * not fidelity (owner 2026-10-07 — there is only one physics). ON = a
     * touch re-wakes it: flipping re-spreads from the circle seed (a parked
     * equilibrium has ~zero forces, so the flip re-runs the fresh-load
     * spread) and settles, and every later drag release re-energizes it.
     * OFF = gestures never wake it — you can drag nodes and the mesh stays
     * exactly where you put it (no settle, no spring reaction, no throw);
     * the flip stops the running loop and drops residual velocity.
     * Automatic wakes (load/filter/resize) settle either way, so OFF never
     * leaves the map unarranged for a new filter. Flipping persists
     * poolNetReact. Pan/zoom (scale/ox/oy) are untouched. Native <button>
     * gives Space/Enter keyboard handling; role="switch" + aria-checked
     * exposes state to assistive tech. No tooltip, no hint line, and no
     * visible On/Off word — the knob's side plus aria-checked are the whole
     * label (owner 2026-10-07). */
    els.physBar = mk("div", null, "pool-net-phys");
    els.physLabel = mk("span", t("pool_net.phys", "Physics"), "pool-net-physlabel");
    els.physSwitch = mk("button", null, "pool-net-physwitch");
    try {
      els.physSwitch.type = "button";
      /* The button is the 44x44 HIT AREA (touchable enforces that floor);
       * the visible pill is the track inside it, so the control reads small
       * without shrinking the touch target below the platform minimum. */
      els.physTrack = mk("span", null, "pool-net-phystrack");
      els.physKnob = mk("span", null, "pool-net-physknob");
      els.physTrack.appendChild(els.physKnob);
      els.physSwitch.appendChild(els.physTrack);
      if (typeof touchFn === "function") { touchFn(els.physSwitch); }
      paintSwitch(S, els, t);
    } catch (e) { /* labels stand */ }
    try {
      els.physSwitch.addEventListener("click", function () {
        setReact(S, els, t, S.react === false);
      });
    } catch (e) { /* flag stands */ }
    try {
      els.physBar.appendChild(els.physLabel);
      els.physBar.appendChild(els.physSwitch);
      /* Stage: relative-positioned wrapper so the Physics switch overlays
       * the canvas lower-left (owner call) instead of sitting above the
       * band. Canvas keeps its in-flow size; the switch floats over art. */
      els.stage = mk("div", null, "pool-net-stage");
      els.stage.appendChild(canvas);
      els.stage.appendChild(els.physBar);
      wrap.appendChild(els.statusEl);
      wrap.appendChild(els.stage);
      wrap.appendChild(els.hoverEl);
      wrap.appendChild(els.verdictEl);
      wrap.appendChild(els.legendEl);
      if (els.twin) { els.twin.appendChild(els.twinSummary); els.twin.appendChild(els.twinBox); wrap.appendChild(els.twin); }
    } catch (e) { return null; }
    return els;
  }

  function paintVerdict(S, els, t) {
    var sel = S.sel, text = "";
    var nPools = (S.view.edges || []).length, nAssets = (S.view.nodes || []).length;
    if (isMarket(S)) {
      /* No route fiction: market graphs carry no pool path data, so a
       * dual selection reads as full counts, never "no route". */
      var onlyM = (sel.aId && !sel.bId) || (!sel.aId && sel.bId) ? (sel.aId || sel.bId) : null;
      if (onlyM) {
        text = t("market_net.verdict_star", "Markets touching %(s)s: %(n)s", {
          s: symOf(S, onlyM), n: String(nPools)
        });
      } else {
        text = t("market_net.verdict_full", "%(markets)s markets · %(assets)s assets", {
          markets: String(nPools), assets: String(nAssets)
        });
      }
    } else if (!sel.aId && !sel.bId) {
      text = t("pool_net.verdict_full", "%(pools)s pools · %(assets)s assets", {
        pools: String(nPools), assets: String(nAssets)
      });
    } else if (sel.aId && sel.bId && String(sel.aId) !== String(sel.bId)) {
      if (S.pathFull && S.pathFull.hops) {
        var hops = S.pathFull.hops.length - 1;
        if (isMarket(S)) {
          /* A pair's market route is the fills-weighted one the band glows
           * (pathSet), which lives on the selection path — read it so the
           * verdict line and the glow can never disagree. */
          text = t("market_net.verdict_path", "%(a)s reaches %(b)s in %(n)s filled markets", {
            a: symOf(S, sel.aId), b: symOf(S, sel.bId), n: String(hops)
          });
        } else {
        text = t("pool_net.verdict_path", "%(a)s reaches %(b)s in %(n)s hops", {
          a: symOf(S, sel.aId), b: symOf(S, sel.bId), n: String(hops)
        });
        }
      } else if (isMarket(S)) {
        text = t("market_net.verdict_no_path", "No filled-market route between %(a)s and %(b)s", {
          a: symOf(S, sel.aId), b: symOf(S, sel.bId)
        });
      } else {
        text = t("pool_net.verdict_orphan", "No route between %(a)s and %(b)s", {
          a: symOf(S, sel.aId), b: symOf(S, sel.bId)
        });
      }
    } else {
      var only = sel.aId || sel.bId;
      text = t("pool_net.verdict_star", "Pools touching %(s)s: %(n)s", {
        s: symOf(S, only), n: String(nPools)
      });
    }
    try {
      els.verdictEl.textContent = text;
      var prompt = isMarket(S)
        ? t("market_net.prompt", "Tap a node for the asset, a line for the market.")
        : t("pool_net.prompt", "Tap a node for the asset, a line for the pool.");
      S.canvas.setAttribute("aria-label", text + " " + prompt);
    } catch (e) { /* text stands */ }
  }

  /* Brand legend chips: ON/OFF FILTERS the graph (owner 2026-10-07). Turning a
   * brand off removes its nodes and every edge touching them from the plot,
   * the physics and the twin, and turning it back on springs those nodes into
   * the mesh. Previously the chip only dimmed the group to 15% opacity, so
   * "off" nodes still moved, still caught clicks and still sat in the table.
   * Display-only in the sense that matters: no chain call, nothing is
   * resolved, and the state is session-only (a reload shows every brand).
   * @param {Function} renderFn (S)->void repaint (composer-owned render).
   * @param {Function} [onToggle] (S, group, hidden)->void so the composer can
   *   re-filter and wake the loop. Absent = repaint only (headless). */
  /* Ramp key: grey-to-blue edge scale (owner 2026-10-07 — color replaced
   * thickness, so the scale needs its legend). Swatches are CSS classes
   * (.pool-net-sw.ramp-lo/hi track --muted/--accent), never resolved hex —
   * the key cannot disagree with the canvas ink. One label per mode.
   * @returns {void}. Never throws. */
  function appendRamp(doc, mk, t, els, market) {
    try {
      var row = mk("span", null, "pool-net-ramp");
      var lo = doc.createElement("span");
      lo.className = "pool-net-sw ramp-lo";
      var hi = doc.createElement("span");
      hi.className = "pool-net-sw ramp-hi";
      row.appendChild(lo);
      row.appendChild(hi);
      var lab = market
        ? t("market_net.ramp", "24h volume: low → high")
        : t("pool_net.ramp", "Pool size: small → large");
      row.appendChild(mk("span", lab, null));
      try { row.setAttribute("aria-label", lab); } catch (e) { /* text stands */ }
      els.legendEl.appendChild(row);
    } catch (e) { /* legend stands without the key */ }
  }

  function rebuildLegend(doc, mk, t, S, els, renderFn, onToggle) {
    /* Market graphs have no brands (pool groupings) — the row skips chips
     * but keeps the ramp key (volume meaning needs its legend too). */
    if (isMarket(S)) { appendRamp(doc, mk, t, els, true); return; }
    try {
      var D = null;
      try { if (typeof DOM !== "undefined" && DOM) D = DOM; } catch (e) { D = null; }
      if (D) D.clear(els.legendEl);
      else { while (els.legendEl.firstChild) els.legendEl.removeChild(els.legendEl.firstChild); }
    } catch (e) { return; }
    /* Chips come from the FULL graph, never the filtered view: a hidden brand
     * must keep its chip, or turning it off would delete the only control that
     * could turn it back on (measured — the chip disappeared with the nodes). */
    var seen = {};
    var src = (S.full && S.full.nodes && S.full.nodes.length) ? S.full.nodes : ((S.view && S.view.nodes) || []);
    src.forEach(function (n) { if (n) seen[NetPaint.brandOf(n.sym)] = 1; });
    var groups = Object.keys(seen).sort();
    if (!groups.length) return;
    try { els.legendEl.appendChild(mk("span", t("pool_net.legend", "Brands") + " ", "muted")); } catch (e) { /* chips stand */ }
    groups.forEach(function (gr) {
      var chip = null;
      try {
        chip = doc.createElement("button");
        chip.type = "button";
        var hidden = !!S.hide[gr];
        chip.className = "pool-net-chip" + (hidden ? " pool-net-dim" : "");
        chip.setAttribute("aria-pressed", hidden ? "false" : "true");
        var sw = doc.createElement("span");
        sw.className = "pool-net-sw";
        sw.style.background = NetPaint.brandFill(gr);
        chip.appendChild(sw);
        chip.appendChild(doc.createTextNode(gr));
      } catch (e) { chip = null; }
      if (!chip) return;
      (function (group, el) {
        el.addEventListener("click", function () {
          try {
            if (S.hide[group]) delete S.hide[group];
            else S.hide[group] = 1;
            var off = !!S.hide[group];
            el.setAttribute("aria-pressed", off ? "false" : "true");
            try {
              if (el.className !== undefined) {
                el.className = "pool-net-chip" + (off ? " pool-net-dim" : "");
              }
            } catch (e2) { /* state stands */ }
            /* The composer re-filters the graph, re-seeds the newcomers and
             * wakes the loop — a bare repaint would only redraw the same
             * graph, which is exactly the "does nothing" this replaces. */
            if (typeof onToggle === "function") {
              try { onToggle(S, group, off); return; } catch (e3) { /* fall back */ }
            }
            renderFn(S);
          } catch (e2) { /* legend stands */ }
        });
      })(gr, chip);
      try { els.legendEl.appendChild(chip); } catch (e) { /* next chip */ }
    });
    appendRamp(doc, mk, t, els, isMarket(S));
  }

  /* Screen-reader table twin (spec §6): the same pool rows as the canvas
   * in a collapsed <details> — the canvas is never the only source. Rows
   * navigate to #/pools/:id on tap/Enter via TableRenderer when present,
   * else plain linked rows. Capped with an honest count note. */
  function rebuildTwin(doc, mk, t, S, els, navOpts) {
    try {
      var D = null;
      try { if (typeof DOM !== "undefined" && DOM) D = DOM; } catch (e) { D = null; }
      if (D) D.clear(els.twinBox);
      else { while (els.twinBox.firstChild) els.twinBox.removeChild(els.twinBox.firstChild); }
    } catch (e) { return; }
    var edges = (S.view.edges || []).slice().sort(function (a, b) {
      return String(a.poolId) < String(b.poolId) ? -1 : 1;
    });
    try {
      els.twinSummary.textContent = isMarket(S)
        ? t("market_net.twin", "Market rows (%(n)s)", { n: String(edges.length) })
        : t("pool_net.twin", "Pool rows (%(n)s)", { n: String(edges.length) });
    } catch (e) { /* summary stands */ }
    if (!edges.length) return;
    var shown = edges.slice(0, TWIN_CAP);
    function goPool(pid) {
      var dest = NetGestures.resolveNav({ edgeMid: true, poolId: pid }, navOpts);
      if (typeof dest === "string" && dest) NetGestures.navigate(/** @type {string} */ (dest));
    }
    var TR = null;
    try { TR = (typeof TableRenderer !== "undefined" && TableRenderer) ? TableRenderer : null; } catch (e) { TR = null; }
    var built = false;
    if (TR && typeof TR.render === "function") {
      try {
        var rows = shown.map(function (e) {
          var m = S.meta[e.poolId] || {};
          return { pool: e.poolId, a: m.sym_a || e.a, b: m.sym_b || e.b };
        });
        var table = TR.render({
          columns: [
            { key: "pool", title: isMarket(S) ? t("market_net.col_market", "Market") : t("pool_net.col_pool", "Pool") },
            { key: "a", title: t("pool_net.col_a", "Asset 1") },
            { key: "b", title: t("pool_net.col_b", "Asset 2") }
          ],
          rows: rows,
          keyExtractor: function (r) { return r.pool; },
          onRowClick: function (r) { goPool(r.pool); }
        });
        els.twinBox.appendChild(table);
        built = true;
      } catch (e) { built = false; }
    }
    if (!built) {
      try {
        var tableF = doc.createElement("table");
        tableF.className = "node-table";
        var thead = doc.createElement("thead");
        var hr = doc.createElement("tr");
        [isMarket(S) ? t("market_net.col_market", "Market") : t("pool_net.col_pool", "Pool"), t("pool_net.col_a", "Asset 1"), t("pool_net.col_b", "Asset 2")].forEach(function (h) {
          var th = doc.createElement("th");
          th.textContent = h;
          try { th.setAttribute("scope", "col"); } catch (e2) { /* stands */ }
          hr.appendChild(th);
        });
        thead.appendChild(hr);
        tableF.appendChild(thead);
        var tbody = doc.createElement("tbody");
        shown.forEach(function (e) {
          var m = S.meta[e.poolId] || {};
          var tr = doc.createElement("tr");
          var tdP = doc.createElement("td");
          var link = doc.createElement("a");
          try {
            var href = NetGestures.resolveNav({ edgeMid: true, poolId: e.poolId }, navOpts);
            if (typeof href === "string" && href) link.setAttribute("href", /** @type {string} */ (href));
          } catch (e2) { /* text stands */ }
          link.textContent = e.poolId;
          tdP.appendChild(link);
          var tdA = doc.createElement("td");
          tdA.textContent = m.sym_a || e.a;
          var tdB = doc.createElement("td");
          tdB.textContent = m.sym_b || e.b;
          tr.appendChild(tdP);
          tr.appendChild(tdA);
          tr.appendChild(tdB);
          tbody.appendChild(tr);
        });
        tableF.appendChild(tbody);
        els.twinBox.appendChild(tableF);
      } catch (e) { /* twin stands empty */ }
    }
    if (edges.length > shown.length) {
      try {
        els.twinBox.appendChild(mk("p",
          isMarket(S)
            ? t("market_net.twin_more", "Showing %(shown)s of %(n)s markets — narrow the filter to see fewer.", {
              shown: String(shown.length), n: String(edges.length)
            })
            : t("pool_net.twin_more", "Showing %(shown)s of %(n)s pools — narrow the filter to see fewer.", {
              shown: String(shown.length), n: String(edges.length)
            }), "muted"));
      } catch (e) { /* table stands */ }
    }
  }

  return {
    build: buildChrome,
    verdict: paintVerdict,
    legend: rebuildLegend,
    twin: rebuildTwin,
    status: setStatus,
    nodeCard: nodeCard,
    edgeCard: edgeCard,
    setReact: setReact,
    paintSwitch: paintSwitch
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.NetChrome === "undefined") { globalThis.NetChrome = NetChrome; }
if (typeof module !== "undefined") { module.exports = NetChrome; }
