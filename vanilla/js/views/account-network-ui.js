/* AccountNetworkUI: the #/account-network page — accounts as nodes, their
 * account-to-account flows as arrowed lines.
 * Owns: the page shell — seed input + go button, the op-class chips, the
 *   status line (what was scanned, what was skipped, what was capped), the
 *   detail line (tap a line), the legend, and the <details> table twin; plus
 *   the mount of the shared network canvas in account mode. DATA ONLY: this
 *   page never builds, signs or broadcasts anything.
 * Consumes: AccountNet (gather/classify tables — all graph rules live
 *   there), AccountNetworkDepthUI (depth selector + overlaid Ring 1/Ring 2
 *   pills; prefs/hash/stale stay here), PoolNetUI.mount (physics, zoom/pan,
 *   drag, tap, keyboard, resize, IntersectionObserver, reduced-motion),
 *   Account.resolve + Credit (inside AccountNet), Asset.describe for
 *   symbols/precisions, Format for human amounts AT RENDER, TableRenderer,
 *   DOM.*, Router.query, I18n.t, localStorage (recent seeds only).
 * Side effects: one lazy ES scan + chain reads per explicit draw (never on
 *   boot), a canvas rAF loop owned by PoolNetUI, and listeners drained by
 *   _cleanups on route leave. Global AccountNetworkUI.
 * MONEY DISCIPLINE: amounts arrive as raw digit strings keyed by asset and
 *   are formatted once, here, with each asset's own precision. Two assets are
 *   never added together — the label shows the largest one plus "+N more".
 * UX FLOOR: the single h1 comes from DOM.pageHead; the seed input and every
 *   control carry an aria-label; chips are >=44px; colours come from theme
 *   tokens via the painter (classToken), never hardcoded hex.
 * Created by: account-network spec (docs/superpowers/specs/
 *   2026-10-09-account-network-design.md), plan Task 5.
 */
var AccountNetworkUI = (function () {
  "use strict";

  var _cleanups = [];
  var _gen = 0;        /* render generation: bumped per render/cleanup */
  var _drawSeq = 0;    /* draw generation: bumped per press, cancels stale draws */
  var SEEDS_KEY = "accountNet.seeds.v1";
  var CLASSES_KEY = "accountNet.classes.v1";

  /* The WORDS live in account-network-copy.js (pure builders + i18n); this
   * file owns the WIDGETS. Guarded accessor, so a missing script degrades to
   * the inline defaults below instead of throwing at render time. */
  function copy() {
    try {
      if (typeof AccountNetworkCopy !== "undefined" && AccountNetworkCopy) return AccountNetworkCopy;
    } catch (e) { /* fall through */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.AccountNetworkCopy) return globalThis.AccountNetworkCopy;
    } catch (e2) { /* fall through */ }
    try {
      if (typeof module !== "undefined" && module && /** @type {any} */ (module).require) {
        return /** @type {any} */ (module).require("/workspace/vanilla/js/views/account-network-copy.js");
      }
    } catch (e3) { /* not loadable here */ }
    return null;
  }
  var COPY = copy();
  /** @type {string} */
  var SEEDS_KEY = String((COPY && COPY.SEEDS_KEY) || "accountNet.seeds.v1");
  /** @type {string} */
  var CLASSES_KEY = String((COPY && COPY.CLASSES_KEY) || "accountNet.classes.v1");

  /**
   * nodeTarget: a tapped node re-seeds THIS map with the node's account id
   * (owner call) — the deep link auto-draws after the node opens, so a tap
   * walks the graph one account at a time. Pure: a hash string, or null when
   * the hit names no account. Module scope (not render scope) so vectors can
   * pin it.
   * @param {Object} hit Engine hit ({assetId}).
   * @param {string[]} classes Enabled class ids.
   * @param {{depth:number,ring1:number,ring2:number}} [dd] Depth prefs.
   * @returns {string|null} Hash target, or null.
   */
  function nodeTarget(hit, classes, dd) {
    try {
      var id = hit && hit.assetId ? String(hit.assetId) : "";
      if (!/^1\.2\.\d+$/.test(id)) return null;
      var C = copy();
      var d = dd || { depth: 1, ring1: 40, ring2: 8 };
      if (C && typeof C.hashForDepth === "function") {
        return C.hashForDepth([id], classes || [], d.depth, d.ring1, d.ring2);
      }
      return "#/account-network?seeds=" + encodeURIComponent(id) +
        "&classes=" + encodeURIComponent((classes || []).join(",")) +
        "&depth=" + encodeURIComponent(String(d.depth === 2 ? 2 : 1)) +
        "&ring1=" + encodeURIComponent(String(d.ring1 || 40)) +
        "&ring2=" + encodeURIComponent(String(d.ring2 || 8));
    } catch (eT) { return null; }
  }

  /**
   * depthUI: the AccountNetworkDepthUI widget module (depth selector + ring
   * pills). A missing script degrades to no pills — prefs, hash and the
   * depth gather still work, because those live here and in the copy module.
   * Reads the global off globalThis (no bare name: the Task 5 wiring owns
   * the globals.d.ts declaration).
   * @returns {any} The widget module, or null when it is not loadable here.
   */
  function depthUI() {
    try {
      var g = (typeof globalThis !== "undefined") ? globalThis : null;
      if (g && /** @type {any} */ (g).AccountNetworkDepthUI) return /** @type {any} */ (g).AccountNetworkDepthUI;
    } catch (e) { /* fall through */ }
    return null;
  }

  /* localStorage reads for the seeds box and the class selection (the copy
   * module only READS the saved selection; writes stay here, with the page). */
  function _lsGet(key) {
    try { return (typeof localStorage !== "undefined") ? localStorage.getItem(key) : null; }
    catch (e) { return null; }
  }
  function _lsSet(key, val) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(key, val); } catch (e) { /* session only */ }
  }

  /** Localized string (mirrors the copy module's own wrapper).
   *  @param {string} key @param {string} dflt @param {Object} [vars]
   *  @returns {string} */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") {
      return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
        return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
      });
    }
    return dflt;
  }

  /* ------------------------------------------------------------------ */
  /* page render                                                          */
  /* ------------------------------------------------------------------ */

  function cleanup() {
    var fns = _cleanups;
    _cleanups = [];
    for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) { /* keep draining */ } }
  }

  function _el(doc, tag, text, cls) {
    try {
      if (typeof DOM !== "undefined" && DOM && typeof DOM.el === "function") return DOM.el(doc, tag, text, cls);
    } catch (e) { /* raw DOM below */ }
    var el = doc.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  function _clear(node) {
    try {
      if (typeof DOM !== "undefined" && DOM && typeof DOM.clear === "function") { DOM.clear(node); return; }
    } catch (e) { /* raw DOM below */ }
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /* 44px touch floor via the shared global (same call the market/pool desks
   * use); a stub host without it just keeps its own box. */
  function _touch(el) {
    try {
      if (typeof touchable === "function") { touchable(/** @type {any} */ (el)); return el; }
    } catch (e) { /* cosmetic */ }
    return el;
  }

  /**
   * renderAccountNetwork(root): build the shell and mount the canvas.
   * Reads seeds/classes from the hash (then the saved values), and only
   * fetches when the user presses go — the page never scans on boot.
   * @param {Element} root Router-provided mount point.
   * @returns {void} Never throws.
   */
  function renderAccountNetwork(root) {
    try {
      if (!root) return;
      var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) return;
      cleanup();
      _gen++;
      var gen = _gen;

      /* Clear the router mount FIRST (the shared convention every view in
       * this app follows): the router hands us #view with the previous page
       * still in it, so appending without clearing stacks this page UNDER the
       * stale view — arriving from the Labs TOC left the TOC's heading and
       * cards on screen above ours (fixed 2026-10-09). */
      _clear(root);

      /* mkt-wrap, not the plain 720px .wrap: this is a dense graph view that
       * reuses the pool-net canvas engine, so it earns the wide cap the same
       * way the market desk does (principle #7 — wide screens must not strand
       * a 4K monitor in whitespace; viewport-audit A3 flagged 42% at desk
       * width before this, 2026-10-09). No new CSS: mkt-wrap already exists. */
      var wrap = _el(doc, "div", null, "wrap mkt-wrap");
      root.appendChild(wrap);
      /* pageHead BUILDS AND RETURNS the h1 — its return value must be
       * appended, or the page renders with no heading at all (the icon fix
       * for "connected" was invisible while this was the case). */
      var head = null;
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.pageHead === "function") {
          head = DOM.pageHead(doc, t("account_net.title", "Account Network"), "connected");
        }
      } catch (eHead) { head = null; }
      if (head) wrap.appendChild(head);
      else wrap.appendChild(_el(doc, "h1", t("account_net.title", "Account Network")));
      wrap.appendChild(_el(doc, "p", t("account_net.intro",
        "Enter one or more accounts to see who they send to, lend to and borrow from. "
        + "Read from the community history index; nothing is signed and nothing is stored."),
        "muted"));

      var seedInput = _el(doc, "input", null, "an-seeds");
      try {
        seedInput.setAttribute("type", "text");
        seedInput.setAttribute("id", "an-seeds");
        seedInput.setAttribute("aria-label", t("account_net.seeds_label", "Accounts to map"));
        seedInput.setAttribute("placeholder", t("account_net.seeds_placeholder", "committee-account, alice, 1.2.42"));
        seedInput.setAttribute("autocomplete", "off");
      } catch (e) { /* stub element */ }
      _touch(seedInput);
      var goBtn = _el(doc, "button", t("account_net.go", "Draw network"), "an-go primary");
      try { goBtn.setAttribute("type", "button"); } catch (e2) { /* stub */ }
      _touch(goBtn);

      var controls = _el(doc, "div", null, "an-controls");
      controls.appendChild(seedInput);
      controls.appendChild(goBtn);
      wrap.appendChild(controls);

      var chipsBox = _el(doc, "div", null, "an-chips");
      chipsBox.setAttribute && chipsBox.setAttribute("role", "group");
      wrap.appendChild(chipsBox);

      var status = _el(doc, "p", t("account_net.idle", "Nothing drawn yet."), "muted an-status");
      wrap.appendChild(status);
      var detail = _el(doc, "p", COPY.detailText({ edge: null }), "an-detail");
      wrap.appendChild(detail);

      var graphHost = _el(doc, "div", null, "an-graph");
      wrap.appendChild(graphHost);
      var twin = _el(doc, "details", null, "an-twin");
      var summary = _el(doc, "summary", t("account_net.twin_summary", "Table view (accessible)"));
      twin.appendChild(summary);
      var twinBody = _el(doc, "div", null, "an-twin-body");
      twin.appendChild(twinBody);
      wrap.appendChild(twin);

      /* ---- state ---- */
      var fromHash = COPY.parseHash(typeof location !== "undefined" ? location.hash : "");
      /* Depth prefs: the hash wins when it names a depth (a shared 2-hop
       * link must open as one); otherwise the saved prefs stand, else the
       * policy defaults. The widget re-sanitizes on mount. */
      var depthInit = null;
      try { depthInit = COPY.readDepthPrefs(); } catch (eDepth) { depthInit = null; }
      try {
        if (typeof location !== "undefined" && location && /[?&]depth=/.test(String(location.hash || ""))) {
          depthInit = COPY.parseDepth(location.hash);
        }
      } catch (eDepthHash) { /* saved prefs stand */ }
      if (!depthInit || typeof depthInit !== "object") depthInit = { depth: 1, ring1: 40, ring2: 8 };
      var state = {
        seeds: fromHash.seeds.length ? fromHash.seeds : COPY.parseSeeds(_lsGet(SEEDS_KEY)),
        classes: fromHash.classes.length ? fromHash.classes : null,
        depth: depthInit,
        names: {}, assets: {}, graph: null, net: null, busy: false
      };
      seedInput.value = state.seeds.join(", ");

      var chips = COPY.chipModel();
      if (state.classes) {
        chips.forEach(function (c) { c.on = state.classes.indexOf(c.id) !== -1; });
      }
      function activeClasses() {
        return chips.filter(function (c) { return c.on; }).map(function (c) { return c.id; });
      }
      function paintChips() {
        _clear(chipsBox);
        chips.forEach(function (c) {
          var lab = _el(doc, "label", null, "an-chip");
          var box = _el(doc, "input", null, null);
          try {
            box.setAttribute("type", "checkbox");
            box.checked = !!c.on;
            box.setAttribute("aria-label", c.label + " — " + c.help);
          } catch (e) { box.checked = !!c.on; }
          var text = _el(doc, "span", c.label);
          lab.appendChild(box);
          lab.appendChild(text);
          _touch(lab);
          try {
            box.addEventListener("change", function () {
              c.on = !!box.checked;
              _lsSet(CLASSES_KEY, JSON.stringify(activeClasses()));
              syncHash();
            });
          } catch (eEv) { /* stub element */ }
          lab.title = c.help;
          chipsBox.appendChild(lab);
        });
      }
      /* URL sync. history.replaceState, NOT location.hash: a hash write
       * fires hashchange, the router re-renders this very route, and the
       * in-flight draw paints into detached nodes (the page just sat on
       * "Reading..."). replaceState keeps the shareable URL without
       * re-entering the router; the location.hash write stays only as the
       * fallback for hosts without the History API. */
      function syncHash() {
        try {
          var dd = (state && state.depth) || { depth: 1, ring1: 40, ring2: 8 };
          var next = COPY.hashForDepth(state.seeds, activeClasses(), dd.depth, dd.ring1, dd.ring2);
          try {
            if (typeof location === "undefined") return;
            if (location.hash === next) return;
            if (typeof history !== "undefined" && history && typeof history.replaceState === "function") {
              history.replaceState(null, "", next);
              return;
            }
          } catch (eHist) { /* fall through */ }
          if (typeof location !== "undefined") location.hash = next;
        } catch (e) { /* keep the current url */ }
      }

      /* ---- depth selector + ring pills (AccountNetworkDepthUI) ---- */
      var drawn = null;   /* what the map on screen was drawn with; null = nothing drawn yet */
      var depthWidget = null;
      /**
       * onDepthChange: a depth/ring edit is already persisted (the widget did
       * that) — re-sync the shareable hash and mark the on-screen map stale.
       * Never auto-scans: a depth-2 draw is the expensive mode, so the user
       * re-draws when ready.
       * @param {{depth:number, ring1:number, ring2:number}} next Committed widget state.
       * @returns {void}
       */
      function onDepthChange(next) {
        state.depth = { depth: next.depth, ring1: next.ring1, ring2: next.ring2 };
        syncHash();
        if (drawn && (drawn.depth !== next.depth || drawn.ring1 !== next.ring1 || drawn.ring2 !== next.ring2)) {
          try { status.textContent = COPY.staleSettingsText(); } catch (eStale) { /* facts stand */ }
        }
      }
      (function mountDepth() {
        var DUI = depthUI();
        if (!DUI || typeof DUI.mount !== "function") return;
        try {
          depthWidget = DUI.mount(doc, {
            controlsRow: controls,
            graphHost: graphHost,
            fallbackHost: wrap,
            fallbackBefore: twin,
            initial: depthInit,
            onChange: onDepthChange
          });
        } catch (eMount) { depthWidget = null; }
        if (depthWidget && typeof depthWidget.get === "function") {
          try { state.depth = depthWidget.get(); } catch (eGet) { /* prefs stand */ }
        }
        if (depthWidget && typeof depthWidget.destroy === "function") {
          _cleanups.push(depthWidget.destroy);
        }
      })();

      /* ---- asset + account name lookup (display only) ---- */
      function loadAssets(ids) {
        var out = {};
        if (!ids.length) return Promise.resolve(out);
        var need = {};
        ids.forEach(function (id) { if (!state.assets[id]) need[id] = 1; });
        var keys = Object.keys(need);
        if (!keys.length) return Promise.resolve(out);
        var steps = [];
        for (var i = 0; i < keys.length; i += 100) steps.push(keys.slice(i, i + 100));
        return steps.reduce(function (p, chunk) {
          return p.then(function () {
            if (typeof Chain === "undefined" || !Chain || typeof Chain.db !== "function") return null;
            return Chain.db().then(function (api) { return Chain.call(api, "get_assets", [chunk]); })
              .then(function (rows) {
                (rows || []).forEach(function (a) {
                  if (!a || !a.id) return;
                  var sym = a.symbol || a.id;
                  try {
                    if (typeof Asset !== "undefined" && Asset && typeof Asset.symbolFor === "function") {
                      sym = Asset.symbolFor(a) || sym;
                    }
                  } catch (e) { /* id fallback */ }
                  out[String(a.id)] = { sym: sym, prec: (typeof a.precision === "number") ? a.precision : 0 };
                });
                return null;
              }).catch(function () { return null; });
          });
        }, Promise.resolve(null)).then(function () { return out; });
      }
      function loadNames(ids) {
        var out = {};
        var missing = ids.filter(function (id) { return !state.names[id]; });
        if (!missing.length || typeof Chain === "undefined" || !Chain || typeof Chain.db !== "function") {
          return Promise.resolve(out);
        }
        return Chain.db().then(function (api) { return Chain.call(api, "get_accounts", [missing]); })
          .then(function (rows) {
            (rows || []).forEach(function (a) { if (a && a.id) out[String(a.id)] = a.name || a.id; });
            return out;
          }).catch(function () { return out; });
      }
      function gatherAssetIds(graph) {
        var set = {};
        (graph && graph.edges ? graph.edges : []).forEach(function (e) {
          Object.keys(e.perAsset || {}).forEach(function (id) { set[id] = 1; });
        });
        return Object.keys(set);
      }

      /* ---- painting the results ---- */
      function paintGraph(res) {
        var graph = res.graph;
        state.graph = graph;
        return Promise.all([
          loadNames(graph.nodes.map(function (n) { return n.assetId; })),
          loadAssets(gatherAssetIds(graph))
        ]).then(function (loaded) {
          if (gen !== _gen) return;
          loaded[0] && Object.keys(loaded[0]).forEach(function (k) { state.names[k] = loaded[0][k]; });
          loaded[1] && Object.keys(loaded[1]).forEach(function (k) { state.assets[k] = loaded[1][k]; });
          graph.nodes.forEach(function (n) { if (!n.sym) n.sym = state.names[n.assetId] || n.assetId; });
          status.textContent = COPY.statusText({ seeds: res.seeds, unknown: res.unknown, stats: res.stats });
          drawn = { depth: state.depth.depth, ring1: state.depth.ring1, ring2: state.depth.ring2 };
          paintTwin(graph);
          if (typeof PoolNetUI !== "undefined" && PoolNetUI && typeof PoolNetUI.mount === "function") {
            if (state.net && typeof state.net.destroy === "function") { try { state.net.destroy(); } catch (e) {} }
            state.net = PoolNetUI.mount(doc, graphHost, function () {
              return { a: null, b: null, s: state.seeds.join(", ") };
            }, {
              mode: "account", graph: graph,
              arrows: true,
              /* Account names read at 13px (owner call — 10px pool labels
               * are too small on an account map); pool/market maps keep 10px
               * because they never set this opt. */
              labelPx: 13,
              edgeClassOf: function (e) { return COPY.classToken(e.cls); },
              /* Seeds read as the subject, counterparties as context. The
               * pool brand palette would paint every account the same alert
               * red (it keys off symbol-like names), which reads as a
               * warning about each account rather than about the map. */
              nodeFillOf: function (n) { return n && n.seeded ? "accent" : "muted"; },
              /* Node taps re-seed THIS map with the node's account id: the
               * deep link auto-draws after the node opens, so a tap walks
               * the graph one account at a time. */
              navNode: function (hit) {
                var dd = (state && state.depth) || { depth: 1, ring1: 40, ring2: 8 };
                return nodeTarget(hit, activeClasses(), dd);
              },
              /* Edge taps SELECT, they do not navigate: the account page's
               * history filter cannot open a credit line honestly, so the
               * detail line is the honest place for it. */
              navEdge: function (hit) {
                var found = (graph.edges || []).filter(function (e) { return e.poolId === hit.poolId; })[0];
                detail.textContent = COPY.detailText({ edge: found || null, names: state.names, assets: state.assets });
                return null;
              }
            });
          } else {
            graphHost.appendChild(_el(doc, "p", t("account_net.canvas_missing",
              "The network canvas is unavailable in this build; the table below still lists every line."), "muted"));
          }
          /* The canvas mount cleared the graph host — re-home the SAME pill
           * nodes (stage overlay when one exists, normal-flow fallback
           * otherwise), so the pills survive every re-draw. */
          try { if (depthWidget && typeof depthWidget.place === "function") depthWidget.place(); }
          catch (ePlace) { /* pills stand where they are */ }
        });
      }

      function paintTwin(graph) {
        _clear(twinBody);
        var rows = COPY.twinRows(graph, state.names, state.assets);
        if (!rows.length) {
          twinBody.appendChild(_el(doc, "p", t("account_net.twin_empty",
            "No lines between these accounts in the indexed operations scanned."), "muted"));
          return;
        }
        var tableHost = _el(doc, "div", null, "an-table");
        twinBody.appendChild(tableHost);
        var cols = COPY.twinColumns();
        /* TableRenderer.render(cfg) RETURNS a table element (it takes no host);
         * the caller appends it. One call site, no local table builder. */
        try {
          if (typeof TableRenderer !== "undefined" && TableRenderer && typeof TableRenderer.render === "function") {
            tableHost.appendChild(TableRenderer.render({
              columns: cols,
              rows: rows,
              keyExtractor: function (r) { return r.rowkey; },
              stickyFirstCol: true
            }));
            return;
          }
        } catch (e) { /* plain table below */ }
        var table = _el(doc, "table", null, null);
        var thead = _el(doc, "thead");
        var htr = _el(doc, "tr");
        cols.forEach(function (c) {
          var th = _el(doc, "th", c.title);
          try { th.setAttribute("scope", "col"); } catch (e) { /* stub */ }
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);
        var tbody = _el(doc, "tbody");
        rows.forEach(function (r) {
          var tr = _el(doc, "tr");
          cols.forEach(function (c) { tr.appendChild(_el(doc, "td", r[c.key])); });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableHost.appendChild(table);
      }

      /* chainOpen: a name has to be resolved against a live node, and a deep
       * link fires long before one is open (the same gate referrals-ui.js
       * uses). Draws made too early failed as "account not found", which is a
       * lie — the account exists, the socket was not up yet. */
      function chainOpen() {
        try {
          if (typeof Chain === "undefined" || !Chain || typeof Chain.status !== "function") return true;
          var st = Chain.status();
          return !st || st.state === "open";
        } catch (e) { return true; }
      }
      var _waitSub = false;
      function drawWhenOpen() {
        if (chainOpen()) { draw(); return; }
        status.textContent = t("common.status_connecting", "Connecting to network…");
        if (_waitSub) return;
        _waitSub = true;
        try {
          if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
            var off = Store.subscribe("connection", function (st) {
              if (st && st.state !== "open") return;
              _waitSub = false;
              try { if (typeof off === "function") off(); } catch (e) { /* single-shot */ }
              draw();
            });
            _cleanups.push(function () {
              _waitSub = false;
              try { if (typeof off === "function") off(); } catch (e) { /* already gone */ }
            });
          }
        } catch (e) { /* no subscription seam: the button retries */ }
      }

      function draw() {
        var seeds = COPY.parseSeeds(seedInput.value);
        if (!seeds.length) {
          status.textContent = t("account_net.need_seeds", "Enter at least one account to map.");
          return;
        }
        state.seeds = seeds;
        _lsSet(SEEDS_KEY, JSON.stringify(seeds));
        syncHash();
        var classes = activeClasses();
        if (!classes.length) {
          status.textContent = t("account_net.need_class", "Turn on at least one kind of line to draw.");
          return;
        }
        state.busy = true;
        status.textContent = t("account_net.scanning", "Reading the community index…");
        detail.textContent = COPY.detailText({ edge: null });
        _drawSeq++;
        var myDraw = _drawSeq;
        var dd = (state && state.depth) || { depth: 1, ring1: 40, ring2: 8 };
        AccountNet.gather(seeds, classes, { depth: dd.depth, ring1: dd.ring1, ring2: dd.ring2 }).then(function (res) {
          if (myDraw !== _drawSeq) return;      /* a newer press won */
          state.busy = false;
          return paintGraph(res);
        }).catch(function (e) {
          if (myDraw !== _drawSeq) return;
          state.busy = false;
          status.textContent = COPY.esErrorText(String((e && e.message) || e));
        });
      }

      paintChips();
      /* A deep link carries an explicit request ("show me this map"), so it
       * draws once on arrival; a bare visit (seeds only in localStorage) stays
       * idle and never scans until the user asks. */
      if (fromHash.seeds.length) {
        try { drawWhenOpen(); } catch (eAuto) { /* the go button still works */ }
      }
      try {
        goBtn.addEventListener("click", function () { drawWhenOpen(); });
        seedInput.addEventListener("keydown", function (ev) {
          if (ev && ev.key === "Enter") { try { ev.preventDefault(); } catch (e) {} drawWhenOpen(); }
        });
      } catch (eEv) { /* stub element */ }

      _cleanups.push(cleanup);
      _cleanups.push(function () {
        if (state.net && typeof state.net.destroy === "function") { try { state.net.destroy(); } catch (e) {} }
      });
    } catch (e) {
      /* A torn-down route or a stub host must never blank the app. */
      try { cleanup(); } catch (e2) { /* nothing to clean */ }
    }
  }

  return {
    renderAccountNetwork: renderAccountNetwork,
    /* Vectors drive the copy module's pure builders (the single place the
     * sentences live) through the same accessors the page uses. */
    _test: {
      parseSeeds: function (v) { return copy().parseSeeds(v); },
      nodeTarget: function (h, c, d) { return nodeTarget(h, c, d); },
      chipModel: function () { return copy().chipModel(); },
      classToken: function (v) { return copy().classToken(v); },
      parseHash: function (v) { return copy().parseHash(v); },
      hashFor: function (a, b) { return copy().hashFor(a, b); },
      parseDepth: function (v) { return copy().parseDepth(v); },
      hashForDepth: function (a, b, c, d, e) { return copy().hashForDepth(a, b, c, d, e); },
      readDepthPrefs: function () { return copy().readDepthPrefs(); },
      writeDepthPrefs: function (a, b, c) { return copy().writeDepthPrefs(a, b, c); },
      depthLabel: function (v) { return copy().depthLabel(v); },
      ringLabel: function (v) { return copy().ringLabel(v); },
      statusText: function (v) { return copy().statusText(v); },
      detailText: function (v) { return copy().detailText(v); },
      twinRows: function (a, b, c) { return copy().twinRows(a, b, c); },
      twinColumns: function () { return copy().twinColumns(); },
      amountsText: function (a, b) { return copy().amountsText(a, b); },
      esErrorText: function (v) { return copy().esErrorText(v); }
    }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNetworkUI === "undefined") { globalThis.AccountNetworkUI = AccountNetworkUI; }
if (typeof module !== "undefined") { module.exports = AccountNetworkUI; }
