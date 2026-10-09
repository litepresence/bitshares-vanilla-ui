/* AccountNetworkUI: the #/account-network page — accounts as nodes, their
 * account-to-account flows as arrowed lines.
 * Owns: the page shell — seed input + go button, the op-class chips, the
 *   status line (what was scanned, what was skipped, what was capped), the
 *   detail line (tap a line), the legend, and the <details> table twin; plus
 *   the mount of the shared network canvas in account mode. DATA ONLY: this
 *   page never builds, signs or broadcasts anything.
 * Consumes: AccountNet (gather/classify tables — all graph rules live
 *   there), PoolNetUI.mount (physics, zoom/pan, drag, tap, keyboard,
 *   resize, IntersectionObserver, reduced-motion), Account.resolve + Credit
 *   (inside AccountNet), Asset.describe for symbols/precisions, Format for
 *   human amounts AT RENDER, TableRenderer, DOM.*, Router.query, I18n.t,
 *   localStorage (recent seeds only).
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

  /**
   * Localized string with the repo's inline-substitution fallback (so a
   * headless/test render still produces the English sentence).
   * @param {string} key i18n key.
   * @param {string} dflt English default (must equal en.json byte-for-byte).
   * @param {Object<string,(string|number)>} [vars] %(name)s substitutions.
   * @returns {string}
   */
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

  function _lsGet(key) {
    try { return (typeof localStorage !== "undefined") ? localStorage.getItem(key) : null; }
    catch (e) { return null; }
  }
  function _lsSet(key, val) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(key, val); } catch (e) { /* session only */ }
  }

  /**
   * parseSeeds: the seed box is free text — comma, space, semicolon or
   * newline separated names/ids, deduped, capped at AccountNet.MAX_SEEDS.
   * @param {string} raw Box contents.
   * @returns {string[]} Seed tokens in typed order.
   */
  function parseSeeds(raw) {
    return String(raw === undefined || raw === null ? "" : raw)
      .split(/[\s,;]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; })
      .filter(function (s, i, a) { return a.indexOf(s) === i; })
      .slice(0, AccountNet.MAX_SEEDS);
  }

  /**
   * chipModel: one row of toggles, one per op class, with the honest kind
   * (a relation line is not a movement of value) and a one-line help.
   * @returns {Array<{id:string, kind:string, label:string, help:string, on:boolean}>}
   */
  /* Per-class help. Written here (not per call site) so the chip row and the
   * legend always say the same thing, and so a stale translation cannot leave
   * a toggle with no explanation at all. */
  var CLASS_HELP = {
    transfer: "Direct account-to-account transfers.",
    credit: "Credit offers accepted and repaid.",
    override: "Transfers whose fee the asset issuer pays.",
    debit: "Direct-debit permissions and withdrawals.",
    htlc: "Hash time-locked contracts and their updates.",
    vesting: "Vesting balances a third party administers."
  };

  function chipModel() {
    var saved = _lsGet(CLASSES_KEY);
    var picked = null;
    if (saved) {
      try { picked = JSON.parse(saved); } catch (e) { picked = null; }
    }
    var ids = (Array.isArray(picked) && picked.length) ? picked : AccountNet.DEFAULT_CLASSES;
    return Object.keys(AccountNet.CLASSES).map(function (id) {
      var c = AccountNet.CLASSES[id];
      return {
        id: id, kind: c.kind,
        label: t("account_net.class_" + id, id),
        help: t("account_net.class_" + id + "_help", CLASS_HELP[id] || ""),
        on: ids.indexOf(id) !== -1
      };
    });
  }

  /**
   * classToken: the canvas ink token for an edge class. Relations stay muted
   * so a permission line never reads like a payment.
   * @param {string} cls Class id.
   * @returns {string} Token name the painter resolves.
   */
  function classToken(cls) {
    switch (cls) {
      case "transfer": return "accent";
      case "credit": return "buy";
      case "override": return "muted";
      case "htlc": return "sell";
      case "debit": return "warn";
      case "vesting": return "muted";
      default: return "muted";
    }
  }

  /**
   * parseHash / hashFor: the page's shareable URL contract
   * (#/account-network?seeds=a,b&classes=transfer). Unknown params are
   * ignored and a malformed hash yields empty lists rather than throwing.
   * @param {string} hash location.hash (or any string).
   * @returns {{seeds:string[], classes:string[]}}
   */
  function parseHash(hash) {
    var out = { seeds: [], classes: [] };
    var s = String(hash === undefined || hash === null ? "" : hash);
    var qi = s.indexOf("?");
    if (qi === -1) return out;
    s.slice(qi + 1).split("&").forEach(function (part) {
      var eqi = part.indexOf("=");
      if (eqi === -1) return;
      var k = "", v = "";
      try { k = decodeURIComponent(part.slice(0, eqi)); } catch (e) { k = part.slice(0, eqi); }
      try { v = decodeURIComponent(part.slice(eqi + 1)); } catch (e2) { v = part.slice(eqi + 1); }
      if (k === "seeds") out.seeds = parseSeeds(v);
      else if (k === "classes") {
        out.classes = v.split(",").map(function (x) { return x.trim(); })
          .filter(function (x) { return x.length; });
      }
    });
    return out;
  }

  /**
   * hashFor: the inverse of parseHash, with values encoded.
   * @param {string[]} seeds @param {string[]} classes
   * @returns {string} Hash target for the current state.
   */
  function hashFor(seeds, classes) {
    return "#/account-network?seeds=" + encodeURIComponent((seeds || []).join(",")) +
      "&classes=" + encodeURIComponent((classes || []).join(","));
  }

  /**
   * assetLabel / humanAmount: symbol + precision for an asset id.
   * @param {string} assetId @param {Object<string,{sym:string, prec:number}>} assets
   * @returns {{sym:string, prec:number}}
   */
  function assetLabel(assetId, assets) {
    var a = assets && assets[assetId];
    return { sym: (a && a.sym) ? a.sym : assetId,
      prec: (a && typeof a.prec === "number") ? a.prec : 0 };
  }

  /**
   * humanAmount: raw integer string -> human string, at render, with THIS
   * asset's precision. Never touches another asset's scale.
   * @param {string} raw @param {string} assetId @param {Object} assets
   * @returns {string}
   */
  function humanAmount(raw, assetId, assets) {
    var lab = assetLabel(assetId, assets);
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function") {
        return Format.formatAmount(raw, lab.prec) + " " + lab.sym;
      }
    } catch (e) { /* fall through to the raw echo */ }
    return String(raw) + " " + lab.sym;
  }

  /**
   * amountsText: the largest asset in human terms plus "+N more" for the
   * rest. Two assets are never summed — they are not comparable quantities.
   * @param {Object<string,string>} perAsset assetId -> raw digit string.
   * @param {Object} assets Symbol/precision lookup.
   * @returns {string}
   */
  function amountsText(perAsset, assets) {
    var ids = Object.keys(perAsset || {});
    if (!ids.length) return t("account_net.no_amount", "no amount");
    var best = ids[0], bestLen = -1;
    ids.forEach(function (id) {
      var len = String(perAsset[id]).replace(/^0+/, "").length;
      if (len > bestLen) { bestLen = len; best = id; }
    });
    var head = humanAmount(perAsset[best], best, assets);
    var more = ids.length - 1;
    if (more <= 0) return head;
    return head + t("account_net.more_assets", " + %(n)s more", { n: more });
  }

  /**
   * statusText: the honesty line. It states the scanned op count, the graph
   * size, and EVERY limit that bit (window, node/edge cap, skipped entries,
   * unresolvable credit lines, unknown seeds). A clean run stays short — a
   * wall of "0 skipped" is noise, not honesty.
   * @param {{seeds:Array, unknown:string[], stats:Object}} res Gather result.
   * @returns {string}
   */
  function statusText(res) {
    var st = (res && res.stats) || {};
    var seeds = (res && res.seeds) || [];
    var unknown = (res && res.unknown) || [];
    var bits = [];
    var names = seeds.map(function (s) { return s.name || s.id; }).join(", ");
    if (names) bits.push(names);
    bits.push(t("account_net.status_scanned", "%(scanned)s indexed operations from %(n)s account(s)",
      { scanned: String(st.scanned || 0), n: String(seeds.length) }));
    bits.push(t("account_net.status_graph", "%(nodes)s accounts · %(edges)s lines",
      { nodes: String(st.nodes || 0), edges: String(st.edges || 0) }));
    if (st.truncated) {
      bits.push(t("account_net.status_truncated", "newest %(n)s operations per account",
        { n: String(AccountNet.SCAN_CAP) }));
    }
    if (st.caps && st.caps.nodeCapHit) {
      bits.push(t("account_net.status_node_cap", "top %(n)s counterparties shown",
        { n: String(AccountNet.NODE_CAP) }));
    }
    if (st.caps && st.caps.edgeCapHit) {
      bits.push(t("account_net.status_edge_cap", "top %(n)s lines shown", { n: String(AccountNet.EDGE_CAP) }));
    }
    if (st.droppedSelf) {
      bits.push(t("account_net.status_self", "%(n)s self-transfers skipped", { n: String(st.droppedSelf) }));
    }
    if (st.droppedShape) {
      bits.push(t("account_net.status_shape", "%(n)s unreadable entries skipped", { n: String(st.droppedShape) }));
    }
    var via = st.creditViaIndex || {};
    if (via.offers || via.deals) {
      bits.push(t("account_net.status_credit_index",
        "%(n)s credit lines resolved from the index (their offer or deal object is gone from chain)",
        { n: String((via.offers || 0) + (via.deals || 0)) }));
    }
    if (st.missingCredit) {
      bits.push(t("account_net.status_credit_missing",
        "%(n)s credit lines skipped (offer or deal not found on chain)", { n: String(st.missingCredit) }));
    }
    if (unknown.length) {
      bits.push(t("account_net.status_unknown", "not found: %(names)s", { names: unknown.join(", ") }));
    }
    return bits.join(" · ");
  }

  /**
   * detailText: what the user tapped. Names both ends, the amount(s), the op
   * count, the flow/relation kind and the time span.
   * @param {{edge:?Object, names?:Object, assets?:Object}} arg edge=null
   *   renders the idle hint; names/assets are optional (empty maps are fine).
   * @returns {string}
   */
  function detailText(arg) {
    var e = arg && arg.edge;
    if (!e) return t("account_net.detail_hint", "Tap a line for its detail; tap an account to open it.");
    var names = (arg && arg.names) || {}, assets = (arg && arg.assets) || {};
    var kindWord = t(e.kind === "relation" ? "account_net.kind_relation" : "account_net.kind_flow",
      e.kind === "relation" ? "relation" : "flow");
    /* Two keys, not a plural engine: "1 ops" was the alternative and it
     * reads like a bug. The count decides the key, a translator picks both
     * forms (some languages need more than two). */
    var vars = { from: names[e.a] || e.a, to: names[e.b] || e.b,
      class: t("account_net.class_" + e.cls, e.cls),
      amount: amountsText(e.perAsset, assets), count: String(e.count || 0), kind: kindWord };
    var head = (e.count === 1)
      ? t("account_net.detail_line_one", "%(from)s → %(to)s · %(class)s · %(amount)s · %(count)s op · %(kind)s", vars)
      : t("account_net.detail_line", "%(from)s → %(to)s · %(class)s · %(amount)s · %(count)s ops · %(kind)s", vars);
    if (!e.firstSeen || !e.lastSeen) return head;
    return head + " " + t("account_net.detail_span", "%(first)s → %(last)s",
      { first: e.firstSeen, last: e.lastSeen });
  }

  /**
   * twinRows: the accessible table twin — one row per edge, so the canvas is
   * never the only source of truth.
   * @param {Object} graph @param {Object<string,string>} names @param {Object} assets
   * @returns {Array<{rowkey:string, from:string, to:string, cls:string, kind:string,
   *   amount:string, count:string, span:string}>} TableRenderer row objects.
   */
  function twinRows(graph, names, assets) {
    var out = [];
    var g = graph || {};
    /* Node syms first (the graph already resolved them), then the name map,
     * then the raw id — a table row must never show a bare id when the canvas
     * above it shows a name. */
    var symById = {};
    (g.nodes || []).forEach(function (n) { if (n && n.assetId) symById[n.assetId] = n.sym; });
    function who(id) { return (names && names[id]) || symById[id] || id; }
    (g.edges || []).forEach(function (e) {
      out.push({
        rowkey: e.poolId,
        from: who(e.a),
        to: who(e.b),
        cls: t("account_net.class_" + e.cls, e.cls),
        kind: t(e.kind === "relation" ? "account_net.kind_relation" : "account_net.kind_flow",
          e.kind === "relation" ? "relation" : "flow"),
        amount: amountsText(e.perAsset, assets),
        count: String(e.count || 0),
        span: (e.firstSeen || "—") + " → " + (e.lastSeen || "—")
      });
    });
    return out;
  }

  /**
   * twinColumns: the twin's header in TableRenderer's column shape
   * ({key, title}); the keys are exactly the twinRows field names, because
   * the renderer reads cells BY KEY (a mismatch renders a blank column).
   * @returns {Array<{key:string, title:string}>}
   */
  function twinColumns() {
    return [
      { key: "from", title: t("account_net.twin_from", "From") },
      { key: "to", title: t("account_net.twin_to", "To") },
      { key: "cls", title: t("account_net.twin_class", "Kind") },
      { key: "kind", title: t("account_net.twin_relation", "Flow/relation") },
      { key: "amount", title: t("account_net.twin_amount", "Amount") },
      { key: "count", title: t("account_net.twin_count", "Ops") },
      { key: "span", title: t("account_net.twin_span", "First → last") }
    ];
  }

  /**
   * esErrorText: the index states. Says what happened and what to do; never
   * invents an empty graph or a "no transfers" claim the chain never made.
   * @param {string} code Error code from AccountNet.
   * @returns {string}
   */
  function esErrorText(code) {
    var c = String(code === undefined || code === null ? "" : code);
    if (/disabled/i.test(c)) {
      return t("account_net.es_disabled",
        "The community index is switched off. Turn it on in Settings to draw this map.");
    }
    if (/bad-account-id|unknown-account/i.test(c)) {
      return t("account_net.es_bad_account", "That name is not an account on this chain.");
    }
    return t("account_net.es_unavailable", "The community index is not reachable right now. Try again in a moment.");
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

      var wrap = _el(doc, "div", null, "wrap");
      root.appendChild(wrap);
      try {
        if (typeof DOM !== "undefined" && DOM && typeof DOM.pageHead === "function") {
          DOM.pageHead(doc, t("account_net.title", "Account Network"), "share-alt");
        } else {
          wrap.appendChild(_el(doc, "h1", t("account_net.title", "Account Network")));
        }
      } catch (eHead) {
        wrap.appendChild(_el(doc, "h1", t("account_net.title", "Account Network")));
      }
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
      var detail = _el(doc, "p", detailText({ edge: null }), "an-detail");
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
      var fromHash = parseHash(typeof location !== "undefined" ? location.hash : "");
      var state = {
        seeds: fromHash.seeds.length ? fromHash.seeds : parseSeeds(_lsGet(SEEDS_KEY)),
        classes: fromHash.classes.length ? fromHash.classes : null,
        names: {}, assets: {}, graph: null, net: null, busy: false
      };
      seedInput.value = state.seeds.join(", ");

      var chips = chipModel();
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
          var next = hashFor(state.seeds, activeClasses());
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
          status.textContent = statusText({ seeds: res.seeds, unknown: res.unknown, stats: res.stats });
          paintTwin(graph);
          if (typeof PoolNetUI !== "undefined" && PoolNetUI && typeof PoolNetUI.mount === "function") {
            if (state.net && typeof state.net.destroy === "function") { try { state.net.destroy(); } catch (e) {} }
            state.net = PoolNetUI.mount(doc, graphHost, function () {
              return { a: null, b: null, s: state.seeds.join(", ") };
            }, {
              mode: "account", graph: graph,
              arrows: true,
              edgeClassOf: function (e) { return classToken(e.cls); },
              /* Seeds read as the subject, counterparties as context. The
               * pool brand palette would paint every account the same alert
               * red (it keys off symbol-like names), which reads as a
               * warning about each account rather than about the map. */
              nodeFillOf: function (n) { return n && n.seeded ? "accent" : "muted"; },
              navNode: function (hit) {
                var name = hit && (hit.sym || (hit.assetId && state.names[hit.assetId]));
                return name ? "#/account/" + name : null;
              },
              /* Edge taps SELECT, they do not navigate: the account page's
               * history filter cannot open a credit line honestly, so the
               * detail line is the honest place for it. */
              navEdge: function (hit) {
                var found = (graph.edges || []).filter(function (e) { return e.poolId === hit.poolId; })[0];
                detail.textContent = detailText({ edge: found || null, names: state.names, assets: state.assets });
                return null;
              }
            });
          } else {
            graphHost.appendChild(_el(doc, "p", t("account_net.canvas_missing",
              "The network canvas is unavailable in this build; the table below still lists every line."), "muted"));
          }
        });
      }

      function paintTwin(graph) {
        _clear(twinBody);
        var rows = twinRows(graph, state.names, state.assets);
        if (!rows.length) {
          twinBody.appendChild(_el(doc, "p", t("account_net.twin_empty",
            "No lines between these accounts in the indexed operations scanned."), "muted"));
          return;
        }
        var tableHost = _el(doc, "div", null, "an-table");
        twinBody.appendChild(tableHost);
        var cols = twinColumns();
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
        var seeds = parseSeeds(seedInput.value);
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
        detail.textContent = detailText({ edge: null });
        _drawSeq++;
        var myDraw = _drawSeq;
        AccountNet.gather(seeds, classes, {}).then(function (res) {
          if (myDraw !== _drawSeq) return;      /* a newer press won */
          state.busy = false;
          return paintGraph(res);
        }).catch(function (e) {
          if (myDraw !== _drawSeq) return;
          state.busy = false;
          status.textContent = esErrorText(String((e && e.message) || e));
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
    _test: { parseSeeds: parseSeeds, chipModel: chipModel, classToken: classToken,
      parseHash: parseHash, hashFor: hashFor, statusText: statusText,
      detailText: detailText, twinRows: twinRows, twinColumns: twinColumns,
      amountsText: amountsText, esErrorText: esErrorText }
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNetworkUI === "undefined") { globalThis.AccountNetworkUI = AccountNetworkUI; }
if (typeof module !== "undefined") { module.exports = AccountNetworkUI; }
