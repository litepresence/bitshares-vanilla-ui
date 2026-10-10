/* AccountNetworkCopy: every user-visible string this page renders, as pure
 * builders.
 * Owns: seed parsing, the class-chip model, the canvas colour mapping, the
 * hash round-trip, the honesty status line, the detail line, the table-twin
 * rows/columns, and the index-state copy. All of it pure — no DOM, no chain,
 * no storage — so the i18n drift gate can check every sentence and the
 * vectors can pin the honesty wording.
 * Consumes: Format (human amounts, at render), AccountNet (class table and
 * caps), I18n via the local t(). Reads localStorage for the saved class
 * selection (a read, never a write: the page owns persistence).
 * MONEY DISCIPLINE: raw digit strings in, human strings out, one asset's
 * precision at a time; two assets are never added together.
 * Split from account-network-ui.js 2026-10-09 for readability (§3.7): this
 * file owns the WORDS, the view owns the WIDGETS. The view consumes it
 * through a guarded accessor, so a missing script degrades to defaults.
 * Global AccountNetworkCopy.
 */
var AccountNetworkCopy = (function () {
  "use strict";

  var SEEDS_KEY = "accountNet.seeds.v1";
  var CLASSES_KEY = "accountNet.classes.v1";
  var DEPTH_KEY = "accountNet.depth.v1";

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

  /* The depth policy module, resolved at CALL time with the same guarded
   * pattern account-net-es.js uses (globalThis first, then module.require,
   * then null => literal fallbacks). The copy module must never throw when
   * the policy script is missing — words still render with depth 1.
   * @returns {any} AccountNetDepth, or null when it is not loadable here. */
  function depthPolicy() {
    try {
      if (typeof AccountNetDepth !== "undefined" && AccountNetDepth) return AccountNetDepth;
    } catch (e) { /* fall through */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.AccountNetDepth) return globalThis.AccountNetDepth;
    } catch (e2) { /* fall through */ }
    try {
      if (typeof module !== "undefined" && module && /** @type {any} */ (module).require) {
        return /** @type {any} */ (module).require("/workspace/vanilla/js/api/account-net-depth.js");
      }
    } catch (e3) { /* not loadable here */ }
    return null;
  }

  /**
   * depthOr: normalize depth through the policy, falling back to 1.
   * @param {any} D AccountNetDepth or null.
   * @param {*} v Raw depth value.
   * @returns {number} 1 or 2.
   */
  function depthOr(D, v) {
    try {
      if (D && typeof D.normalizeDepth === "function") return D.normalizeDepth(v);
    } catch (e) { /* fallback below */ }
    var n = Math.floor(Number(v));
    return (n === 1 || n === 2) ? n : 1;
  }

  /**
   * ring1Or: normalize the Ring 1 count, falling back to 40 (1..40).
   * @param {any} D AccountNetDepth or null.
   * @param {*} v Raw ring-1 value.
   * @returns {number} 1..40.
   */
  function ring1Or(D, v) {
    try {
      if (D && typeof D.normalizeRing1 === "function") return D.normalizeRing1(v);
    } catch (e) { /* fallback below */ }
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return 40;
    if (n < 1) return 1;
    if (n > 40) return 40;
    return n;
  }

  /**
   * ring2Or: normalize the Ring 2 count, falling back to 8 (1..8).
   * @param {any} D AccountNetDepth or null.
   * @param {*} v Raw ring-2 value.
   * @returns {number} 1..8.
   */
  function ring2Or(D, v) {
    try {
      if (D && typeof D.normalizeRing2 === "function") return D.normalizeRing2(v);
    } catch (e) { /* fallback below */ }
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return 8;
    if (n < 1) return 1;
    if (n > 8) return 8;
    return n;
  }

  /**
   * parseDepth: read the depth + ring params out of a shareable hash.
   * Absent params yield the policy defaults (depth 1, ring1 40, ring2 8);
   * out-of-range values normalize the same way the gather path does.
   * @param {string} hash location.hash (or any string).
   * @returns {{depth:number, ring1:number, ring2:number}} In exactly this key order.
   */
  function parseDepth(hash) {
    var D = depthPolicy();
    var rawDepth, rawRing1, rawRing2;
    var s = String(hash === undefined || hash === null ? "" : hash);
    var qi = s.indexOf("?");
    if (qi !== -1) {
      s.slice(qi + 1).split("&").forEach(function (part) {
        var eqi = part.indexOf("=");
        if (eqi === -1) return;
        var k = "", v = "";
        try { k = decodeURIComponent(part.slice(0, eqi)); } catch (e) { k = part.slice(0, eqi); }
        try { v = decodeURIComponent(part.slice(eqi + 1)); } catch (e2) { v = part.slice(eqi + 1); }
        if (k === "depth") rawDepth = v;
        else if (k === "ring1") rawRing1 = v;
        else if (k === "ring2") rawRing2 = v;
      });
    }
    return { depth: depthOr(D, rawDepth), ring1: ring1Or(D, rawRing1), ring2: ring2Or(D, rawRing2) };
  }

  /**
   * hashForDepth: the shareable URL contract with depth + ring params, so a
   * 2-hop map links back to itself. Coexists with hashFor (which stays
   * depth-free); parseDepth reads either shape.
   * @param {string[]} seeds @param {string[]} classes
   * @param {*} depth @param {*} ring1 @param {*} ring2 Raw prefs (normalized).
   * @returns {string} Hash target for the current state.
   */
  function hashForDepth(seeds, classes, depth, ring1, ring2) {
    var D = depthPolicy();
    return "#/account-network?seeds=" + encodeURIComponent((seeds || []).join(",")) +
      "&classes=" + encodeURIComponent((classes || []).join(",")) +
      "&depth=" + encodeURIComponent(String(depthOr(D, depth))) +
      "&ring1=" + encodeURIComponent(String(ring1Or(D, ring1))) +
      "&ring2=" + encodeURIComponent(String(ring2Or(D, ring2)));
  }

  /**
   * readDepthPrefs: the saved depth prefs ({depth, ring1, ring2} JSON under
   * DEPTH_KEY). A missing entry, bad JSON, or out-of-range value yields the
   * policy defaults — never throws, never returns a partial object.
   * @returns {{depth:number, ring1:number, ring2:number}} In exactly this key order.
   */
  function readDepthPrefs() {
    var D = depthPolicy();
    var raw = null;
    try { raw = JSON.parse(_lsGet(DEPTH_KEY) || ""); } catch (e) { raw = null; }
    if (!raw || typeof raw !== "object") return { depth: 1, ring1: 40, ring2: 8 };
    return { depth: depthOr(D, raw.depth), ring1: ring1Or(D, raw.ring1), ring2: ring2Or(D, raw.ring2) };
  }

  /**
   * writeDepthPrefs: persist the depth prefs (normalized first, so storage
   * never holds an out-of-range value). Session-only when storage is absent.
   * @param {*} depth @param {*} ring1 @param {*} ring2 Raw prefs.
   * @returns {void}
   */
  function writeDepthPrefs(depth, ring1, ring2) {
    var D = depthPolicy();
    _lsSet(DEPTH_KEY, JSON.stringify(
      { depth: depthOr(D, depth), ring1: ring1Or(D, ring1), ring2: ring2Or(D, ring2) }));
  }

  /**
   * depthLabel: "1 hop" vs "2 hops" (two keys, not a plural engine — the
   * detail line's "1 ops" lesson).
   * @param {*} depth Raw depth.
   * @returns {string}
   */
  function depthLabel(depth) {
    var d = depthOr(depthPolicy(), depth);
    if (d === 2) return t("account_net.depth_2", "2 hops");
    return t("account_net.depth_1", "1 hop");
  }

  /**
   * ringLabel: which neighbor ring a count belongs to.
   * @param {*} which Raw ring number (1 or 2; anything else reads as ring 1).
   * @returns {string}
   */
  function ringLabel(which) {
    if (Math.floor(Number(which)) === 2) return t("account_net.ring2_label", "Ring 2");
    return t("account_net.ring1_label", "Ring 1");
  }

  /**
   * depthFieldLabel: the depth control's own label (Task 4 owns the widget;
   * the word lives here so the drift gate checks it).
   * @returns {string}
   */
  function depthFieldLabel() {
    return t("account_net.depth_label", "Depth");
  }

  /**
   * staleSettingsText: shown when saved depth/neighbor prefs differ from the
   * drawn map — the map on screen is honest but stale until re-drawn.
   * @returns {string}
   */
  function staleSettingsText() {
    return t("account_net.stale_settings", "Depth or neighbor settings changed — press Draw network.");
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
    /* The map scope up front: a 2-hop map and a 1-hop map are different
     * claims about the same seeds, so the depth always reads out. */
    var mapDepth = depthOr(depthPolicy(), st.depth);
    bits.push(t("account_net.status_depth", "%(depth)s map", { depth: depthLabel(mapDepth) }));
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
    /* Depth-2 expansion honesty. Shown only at depth 2: at depth 1 nothing
     * was eligible for expansion, so the retained count is not news (Task 2
     * reports it as `unexpanded`, but surfacing it would read like a skip).
     * The expanded list names ATTEMPTED expansions — an id stays listed even
     * when its scan failed or contributed nothing (Task 2 semantics). */
    if (mapDepth >= 2) {
      if (st.expanded && st.expanded.length) {
        bits.push(t("account_net.status_expanded", "expanded: %(names)s",
          { names: st.expanded.join(", ") }));
      }
      if (Number(st.unexpanded) > 0) {
        bits.push(t("account_net.status_unexpanded", "%(n)s direct counterparties unexpanded",
          { n: String(st.unexpanded) }));
      }
      if (Number(st.expansionScanned) > 0) {
        bits.push(t("account_net.status_expansion_scanned", "%(n)s indexed operations from expansions",
          { n: String(st.expansionScanned) }));
      }
    }
    if (st.expansionTruncated) {
      bits.push(t("account_net.status_expansion_truncated",
        "expansion scans truncated to newest operations"));
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
   *   amount:string, count:string, span:string, depth:string}>} TableRenderer row objects.
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
        span: (e.firstSeen || "—") + " → " + (e.lastSeen || "—"),
        depth: depthLabel(e && e.depth)
      });
    });
    return out;
  }

  /**
   * twinColumns: the twin's header in TableRenderer's column shape
   * ({key, title}); the keys are exactly the twinRows field names, because
   * the renderer reads cells BY KEY (a mismatch renders a blank column).
   * The hop column stays LAST, so existing columns keep their order.
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
      { key: "span", title: t("account_net.twin_span", "First → last") },
      { key: "depth", title: t("account_net.twin_depth", "Hop") }
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

  return {
    parseSeeds: parseSeeds, chipModel: chipModel, classToken: classToken,
    parseHash: parseHash, hashFor: hashFor, parseDepth: parseDepth,
    hashForDepth: hashForDepth, readDepthPrefs: readDepthPrefs,
    writeDepthPrefs: writeDepthPrefs, depthLabel: depthLabel,
    ringLabel: ringLabel, depthFieldLabel: depthFieldLabel,
    staleSettingsText: staleSettingsText, statusText: statusText,
    detailText: detailText, twinRows: twinRows, twinColumns: twinColumns,
    amountsText: amountsText, esErrorText: esErrorText,
    SEEDS_KEY: SEEDS_KEY, CLASSES_KEY: CLASSES_KEY, DEPTH_KEY: DEPTH_KEY
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNetworkCopy === "undefined") { globalThis.AccountNetworkCopy = AccountNetworkCopy; }
if (typeof module !== "undefined") { module.exports = AccountNetworkCopy; }
