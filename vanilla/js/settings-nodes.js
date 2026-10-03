/* SettingsNodes: node-list section of the #/settings page.
 * Owns: the node URL join (defaults + customs, de-duplicated), the node
 *   table + mirrored phone cards, the probe-all/offline row-state machine,
 *   the custom-node add block, and node selection (Store + Chain.connect).
 *   Builds DOM only — event wiring + page orchestration live in settings.js
 *   (SettingsPage.render passes `t` in; this file never reads I18n itself).
 * Consumes: Store.loadSettings/saveSettings/DEFAULT_NODES (node list +
 *   active node), Chain.probe/connect (latency sort lives here; the badge in
 *   app.js reads the same probe shape), document elements callers pass in.
 * Globals/side effects: DOM nodes it returns (appended by the caller under
 *   the router root); global SettingsNodes only. No storage writes except
 *   via Store.saveSettings in selectNode (same as before the split).
 * Created by: building-vanilla-slices skill, slice-18 audit (settings split).
 *   Bodies moved verbatim from js/settings.js render/allNodes/isCustom/
 *   setRow/probeAll/selectNode; only the closure variables became params.
 */
var SettingsNodes = (function () {
  "use strict";

  /* Defaults + customs joined, de-duplicated, order-stable (defaults first).
   * Params: settings (Store.loadSettings shape: {network, customNodes}).
   * Returns: array of wss:// URL strings. Fails: never (garbage entries drop). */
  function allNodes(settings) {
    var defaults = (Store.DEFAULT_NODES && Store.DEFAULT_NODES[settings.network]) || [];
    var customs = Array.isArray(settings.customNodes) ? settings.customNodes : [];
    var seen = {};
    var out = [];
    defaults.concat(customs).forEach(function (u) {
      if (typeof u !== "string" || !u) return;
      if (seen[u]) return;
      seen[u] = true;
      out.push(u);
    });
    return out;
  }

  /* True when the URL came from the user's custom list (gets a Remove button).
   * Params: url string, settings (Store shape). Returns: boolean. */
  function isCustom(url, settings) {
    return Array.isArray(settings.customNodes) && settings.customNodes.indexOf(url) !== -1;
  }

  /* M2: row lookup by getAttribute compare — URLs are never interpolated
   * into a selector (a quote in a custom URL broke querySelector). Params:
   * tbody, url string. Returns the tr or null. Fails: never throws. */
  function findRow(tbody, url) {
    if (!tbody || typeof tbody.querySelectorAll !== "function") return null;
    var rows = tbody.querySelectorAll("tr");
    for (var k = 0; k < rows.length; k++) {
      try {
        if (rows[k].getAttribute("data-url") === url) return rows[k];
      } catch (e) { /* next row */ }
    }
    return null;
  }

  /* Paint one table row AND its mirrored phone card with the same
   * latency/status text. Status is tracked as a canonical id on data-status
   * (up|connecting|down plus health ids stale|suspect|forked — the offline
   * panel treats anything-not-up as unusable EXCEPT it only shows when every
   * row is exactly "down"; the visible text may be translated (settings.
   * connecting/down are load-bearing Spanish in es mode) so
   * paintOfflineIfAllDown compares the id below, never the translated text.
   * Params: row (tr, may be null — no-op except the card lookup needs its
   *   data-url), latencyText/statusText strings, statusId (canonical,
   *   optional), titleText (tooltip, optional — clears stale titles when
   *   omitted). Fails: never (missing cells are skipped). */
  function setRow(row, latencyText, statusText, statusId, titleText) {
    if (row) {
      var lat = row.querySelector(".latency");
      var st = row.querySelector(".node-status");
      if (lat) lat.textContent = latencyText;
      if (st) st.textContent = statusText;
      if (statusId) row.setAttribute("data-status", statusId);
      if (titleText) row.setAttribute("title", titleText);
      else { try { row.removeAttribute("title"); } catch (titleErr) { /* keeps prior */ } }
    }
    var url = null;
    try { url = row ? row.getAttribute("data-url") : null; } catch (attrErr) { url = null; }
    if (url && row && row.ownerDocument) {
      /* M2: card lookup by getAttribute compare, same rule as findRow. */
      var cards = row.ownerDocument.querySelectorAll(".node-card");
      for (var c = 0; c < cards.length; c++) {
        var card = cards[c], cu = null;
        try { cu = card.getAttribute("data-url"); } catch (ce) { cu = null; }
        if (cu !== url) continue;
        var cLat = card.querySelector(".latency");
        var cSt = card.querySelector(".node-status");
        if (cLat) cLat.textContent = latencyText;
        if (cSt) cSt.textContent = statusText;
        if (statusId) card.setAttribute("data-status", statusId);
        if (titleText) card.setAttribute("title", titleText);
        else { try { card.removeAttribute("title"); } catch (ctErr) { /* keeps prior */ } }
      }
    }
  }

  /* Node table (desktop): radio-select column + URL + latency + status +
   * Remove for customs. Wiring (radios, remove buttons) stays in settings.js.
   * Params: doc, settings (for activeNode/customs), nodes (allNodes list),
   *   t (settings.js i18n lookup). Returns: {table, tbody}. */
  function buildNodeTable(doc, settings, nodes, t) {
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var headRow = doc.createElement("tr");
    ["", t("settings.th_node", "Node"), t("settings.th_latency", "Latency"), t("settings.th_status", "Status"), ""].forEach(function (t) {
      var th = doc.createElement("th");
      th.textContent = t;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    tbody.id = "node-rows";
    table.appendChild(tbody);

    nodes.forEach(function (url) {
      var tr = doc.createElement("tr");
      tr.setAttribute("data-url", url);

      var tdSel = doc.createElement("td");
      var sel = doc.createElement("input");
      sel.type = "radio";
      sel.name = "node";
      sel.value = url;
      if (settings.activeNode === url) sel.checked = true;
      tdSel.appendChild(sel);
      tr.appendChild(tdSel);

      var tdUrl = doc.createElement("td");
      tdUrl.textContent = url;
      tr.appendChild(tdUrl);

      var tdLat = doc.createElement("td");
      tdLat.className = "latency";
      tdLat.textContent = t("settings.pending", "…");
      tr.appendChild(tdLat);

      var tdSt = doc.createElement("td");
      var stSpan = doc.createElement("span");
      stSpan.className = "node-status";
      stSpan.textContent = t("settings.pending", "…");
      tdSt.appendChild(stSpan);
      /* History pill (Phase 3): second span in the Status cell — painted by
       * paintHistory from HistoryCap (snapshot at build, live after probe).
       * setRow's .node-status lookup is unaffected (class moved to the span). */
      var histSpan = doc.createElement("span");
      histSpan.className = "node-history";
      tdSt.appendChild(histSpan);
      tr.appendChild(tdSt);

      var tdAct = doc.createElement("td");
      if (isCustom(url, settings)) {
        var rm = doc.createElement("button");
        rm.type = "button";
        rm.className = "node-remove";
        rm.setAttribute("data-url", url);
        rm.textContent = t("settings.remove", "Remove");
        tdAct.appendChild(rm);
      }
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
      paintHistory(tr, url, t);
    });
    return { table: table, tbody: tbody };
  }

  /* Mirrored phone cards (shown under 560px via CSS): same rows as the
   * table, Select button instead of the radio. Wiring stays in settings.js.
   * Params/returns: same shape as buildNodeTable (returns the cards div). */
  function buildNodeCards(doc, settings, nodes, t) {
    var cards = doc.createElement("div");
    cards.className = "node-cards";
    nodes.forEach(function (url) {
      var card = doc.createElement("div");
      card.className = "node-card";
      card.setAttribute("data-url", url);

      var urlDiv = doc.createElement("div");
      urlDiv.className = "node-card-url";
      urlDiv.textContent = url;
      card.appendChild(urlDiv);

      var latSpan = doc.createElement("span");
      latSpan.className = "latency";
      latSpan.textContent = t("settings.pending", "…");
      card.appendChild(latSpan);

      var stSpan = doc.createElement("span");
      stSpan.className = "node-status";
      stSpan.textContent = t("settings.pending", "…");
      card.appendChild(stSpan);

      var histSpan = doc.createElement("span");
      histSpan.className = "node-history";
      card.appendChild(histSpan);

      var selBtn = doc.createElement("button");
      selBtn.type = "button";
      selBtn.className = "node-select";
      selBtn.setAttribute("data-url", url);
      selBtn.textContent = settings.activeNode === url ? t("settings.selected", "Selected") : t("settings.select", "Select");
      card.appendChild(selBtn);

      if (isCustom(url, settings)) {
        var rm2 = doc.createElement("button");
        rm2.type = "button";
        rm2.className = "node-remove";
        rm2.setAttribute("data-url", url);
        rm2.textContent = t("settings.remove", "Remove");
        card.appendChild(rm2);
      }

      cards.appendChild(card);
      paintHistory(card, url, t);
    });
    return cards;
  }

  /* Probe-all button + offline panel (hidden unless every probe fails).
   * Wiring stays in settings.js. Params: doc, t. Returns:
   *   {probeBtn, offline, retryBtn}. */
  function buildProbe(doc, t) {
    var probeBtn = doc.createElement("button");
    probeBtn.id = "probe-all";
    probeBtn.type = "button";
    probeBtn.textContent = t("settings.probe_all", "Ping all");

    var offline = doc.createElement("div");
    offline.id = "offline-panel";
    offline.hidden = true;
    var offMsg = doc.createElement("p");
    offMsg.textContent = t("settings.offline", "All nodes unreachable. Check your connection and retry.");
    offline.appendChild(offMsg);
    var retryBtn = doc.createElement("button");
    retryBtn.id = "retry-btn";
    retryBtn.type = "button";
    retryBtn.textContent = t("settings.retry", "Retry");
    offline.appendChild(retryBtn);
    return { probeBtn: probeBtn, offline: offline, retryBtn: retryBtn };
  }

  /* textContent-only element helper (user/chain strings never reach HTML).
   * Params: doc, tag string, text (or null), cls (optional). Returns Element. */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Opt-in discovery block: button + privacy note + progress + results.
   * Running/cancel/result-fill wiring stays in settings.js (it owns the
   * custom-add path the per-row Add buttons reuse). Params: doc, t.
   * Returns {wrap, btn, cancel, progress, list, note}. */
  function buildDiscover(doc, t) {
    var wrap = doc.createElement("div");
    wrap.className = "node-discover";
    var btn = doc.createElement("button");
    btn.id = "discover-btn";
    btn.type = "button";
    btn.textContent = t("settings.discover", "Find nodes");
    wrap.appendChild(btn);
    var cancel = doc.createElement("button");
    cancel.id = "discover-cancel";
    cancel.type = "button";
    cancel.textContent = t("settings.discover_cancel", "Cancel");
    cancel.hidden = true;
    wrap.appendChild(cancel);
    var note = el(doc, "p",
      t("settings.discover_note", "Optional: searches GitHub for node lists, then probes what it finds. GitHub and probed nodes see your network address. Results are candidates for your review — nothing is added automatically."), "muted");
    wrap.appendChild(note);
    var progress = doc.createElement("p");
    progress.className = "muted";
    progress.setAttribute("aria-live", "polite");
    wrap.appendChild(progress);
    var list = doc.createElement("div");
    list.className = "node-discover-list";
    wrap.appendChild(list);
    return { wrap: wrap, btn: btn, cancel: cancel, progress: progress, list: list, note: note };
  }

  /* One candidate row: url + health pill + source repos + Add button.
   * Params: doc, t, row ({url, sources[], latencyMs, status}), onAdd(url).
   * Returns the row element. Never throws. */
  function discoverRow(doc, t, row, onAdd) {
    var d = doc.createElement("div");
    d.className = "node-discover-row";
    var url = doc.createElement("div");
    url.textContent = row.url;
    d.appendChild(url);
    var meta = doc.createElement("div");
    meta.className = "muted";
    var bits = [];
    try {
      bits.push((row.latencyMs === null || row.latencyMs === undefined) ? "—" : (row.latencyMs + "ms"));
      bits.push(row.status || "DOWN");
      if (row.sources && row.sources.length) bits.push(row.sources.slice(0, 2).join(", "));
    } catch (e) { /* url stands alone */ }
    meta.textContent = bits.join(" · ");
    d.appendChild(meta);
    var add = doc.createElement("button");
    add.type = "button";
    add.textContent = t("settings.add", "Add");
    try { add.style.minHeight = "44px"; } catch (e) { /* native stands */ }
    add.addEventListener("click", function () {
      try { onAdd(row.url); } catch (e) { /* custom path carries the error */ }
    });
    d.appendChild(add);
    return d;
  }
  function buildCustom(doc, t) {
    var customWrap = doc.createElement("div");
    customWrap.className = "custom-node";
    var customInput = doc.createElement("input");
    customInput.id = "custom-url";
    customInput.type = "text";
    customInput.setAttribute("inputmode", "url");
    customInput.placeholder = t("settings.custom_placeholder", "wss://…");
    customWrap.appendChild(customInput);
    var customAdd = doc.createElement("button");
    customAdd.id = "custom-add";
    customAdd.type = "button";
    customAdd.textContent = t("settings.add_node", "Add node");
    customWrap.appendChild(customAdd);
    var customError = doc.createElement("div");
    customError.id = "custom-error";
    customError.className = "error";
    customError.setAttribute("aria-live", "polite");
    customWrap.appendChild(customError);
    return { wrap: customWrap, customInput: customInput, customAdd: customAdd, customError: customError };
  }

  /* Show the offline panel only when EVERY row is down (compares the
   * canonical data-status id, never translated text — see setRow).
   * Params: tbody (rows carry data-status), offline (panel toggled hidden).
   * Fails: never (empty table hides the panel). */
  function paintOfflineIfAllDown(tbody, offline) {
    var rows = tbody.querySelectorAll("tr");
    if (!rows.length) { offline.hidden = true; return; }
    var allDown = true;
    for (var k = 0; k < rows.length; k++) {
      if (rows[k].getAttribute("data-status") !== "down") { allDown = false; break; }
    }
    offline.hidden = !allDown;
  }

  /* Probe history (latencyTEST.py round-history idea, collapsed to data):
   * last HIST_MAX snapshots per node URL in localStorage
   * ({t, ms, age, part, status}), pruned to 7 days on read. Feeds the
   * "last good" line in row tooltips. Never throws; storage failure means
   * no history, never a broken table. */
  var HIST_KEY = "bts-vanilla-node-health-v1";
  var HIST_MAX = 12;
  var HIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  function readHist() {
    try {
      if (typeof localStorage === "undefined") return {};
      var raw = localStorage.getItem(HIST_KEY);
      if (!raw) return {};
      var d = JSON.parse(raw);
      return (d && typeof d === "object") ? d : {};
    } catch (e) { return {}; }
  }
  function pushSample(url, sample) {
    if (typeof url !== "string" || !url) return;
    try {
      if (typeof localStorage === "undefined") return;
      var d = readHist();
      var list = Array.isArray(d[url]) ? d[url] : [];
      list.push({ t: Date.now(),
        ms: (sample && typeof sample.ms === "number") ? sample.ms : null,
        age: (sample && typeof sample.age === "number") ? sample.age : null,
        part: (sample && typeof sample.part === "number") ? sample.part : null,
        status: (sample && typeof sample.status === "string") ? sample.status : "down" });
      var cutoff = Date.now() - HIST_TTL_MS;
      list = list.filter(function (s) { return s && typeof s.t === "number" && s.t >= cutoff; });
      if (list.length > HIST_MAX) list = list.slice(list.length - HIST_MAX);
      d[url] = list;
      var urls = Object.keys(d);
      if (urls.length > 60) {
        urls.slice(0, urls.length - 60).forEach(function (k) { delete d[k]; });
      }
      localStorage.setItem(HIST_KEY, JSON.stringify(d));
    } catch (e) { /* history best-effort */ }
  }
  /* Newest GOOD sample for a URL, or null. Params: url string.
   * Returns {t, ms} or null. Never throws. */
  function lastGood(url) {
    try {
      var list = readHist()[url];
      if (!Array.isArray(list)) return null;
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i] && list[i].status === "GOOD" && typeof list[i].t === "number") {
          return { t: list[i].t, ms: list[i].ms };
        }
      }
    } catch (e) { /* null below */ }
    return null;
  }
  /* Minutes-since text for a last-good stamp (whole minutes, floor).
   * Params: t epoch ms (or null). Returns e.g. "5m ago" or null. */
  function agoMinutes(t) {
    if (!(typeof t === "number" && isFinite(t))) return null;
    var m = Math.floor(Math.max(0, Date.now() - t) / 60000);
    return (m < 1) ? "just now" : (m + "m ago");
  }

  /* histInfo: pure history-pill content (unit-tested). Params: t, h (the
   *   true/false/null from HistoryCap.nodeHistory). Returns {text, cls}:
   *   leading space + parens wrap the keyed label in code (batch-2b glue
   *   precedent — keys stay clean "History"/"No history", layout owns the
   *   separator); unknown renders "" (nothing shown, never a "?").
   *   Never throws. */
  function histInfo(t, h) {
    try {
      if (h === true) return {text: " (" + t("settings.hist_yes", "History") + ")", cls: "node-history yes"};
      if (h === false) return {text: " (" + t("settings.hist_no", "No history") + ")", cls: "node-history no"};
    } catch (e) { /* empty below */ }
    return {text: "", cls: "node-history"};
  }

  /* latencyText: pure latency-cell content (unit-tested). Params: t (the
   *   injected settings lookup), ms (probe latency number), ageS (r.headAgeS
   *   seconds, or null/unknown). Returns "NNNms · X.Xs" — the age segment
   *   goes through the keyed settings.age_s template ("%(n)ss", unit owned
   *   by the template so translators can reposition it), substituted here by
   *   split/join because the injected t is the 2-arg settings.js wrapper
   *   that drops vars (same workaround as pool-graph.js map labels).
   *   Missing/non-finite age renders latency only, never a dangling "·".
   *   Cards need no special case: setRow mirrors .latency to them. Fails:
   *   never (a throwing t still returns the bare latency). */
  function latencyText(t, ms, ageS) {
    var base = ms + "ms";
    try {
      if (typeof ageS === "number" && isFinite(ageS)) {
        var seg = String(t("settings.age_s", "%(n)ss")).split("%(n)s").join(ageS.toFixed(1));
        return base + " · " + seg;
      }
    } catch (e) { /* base stands */ }
    return base;
  }

  /* paintHistory: paint the .node-history span in a row + its mirrored card.
   * Params: row (tr or null), url, t. Reads HistoryCap live-then-snapshot
   * (guarded — absent HistoryCap paints unknown, never throws). Called at
   * build (snapshot truth) and after every probe (live truth). Fails: never. */
  function paintHistory(row, url, t) {
    var info = histInfo(t, null);
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.nodeHistory === "function") {
        info = histInfo(t, HistoryCap.nodeHistory(url));
      }
    } catch (e) { /* unknown stands */ }
    function one(node) {
      try {
        if (!node || typeof node.querySelector !== "function") return;
        var s = node.querySelector(".node-history");
        if (s) { s.textContent = info.text; s.className = info.cls; }
      } catch (e) { /* this node stands */ }
    }
    one(row);
    try {
      var doc = row && row.ownerDocument ? row.ownerDocument : null;
      if (!doc || typeof doc.querySelectorAll !== "function") return;
      var cards = doc.querySelectorAll(".node-card");
      for (var c = 0; c < cards.length; c++) {
        var cu = null;
        try { cu = cards[c].getAttribute("data-url"); } catch (ce) { cu = null; }
        if (cu === url) one(cards[c]);
      }
    } catch (e) { /* row paint stands */ }
  }

  /* Sequential health probe over the node list (one socket at a time —
   * parallel probes race the shared Chain socket). Rows paint connecting →
   * a taxonomy pill (GOOD/STALE/SUSPECT/FORKED/mismatch/TIMEOUT/DOWN —
   * latencyTEST.py buckets, thresholds documented in Chain.classifyHealth)
   * with a tooltip of head age, participation, irreversible lag, chain
   * prefix and last-good; list order is preserved (latency sort untouched).
   * Params: nodes (URL list), tbody (rows looked up by data-url),
   *   offline (panel), t (status strings). Fails: never (per-row catch). */
  function probeAll(nodes, tbody, offline, t) {
    var i = 0;
    /* Detail tooltip for a reached node (single source for row + card).
     * Params: r (enriched probe result), prefix (chain8), extra (last-good
     * line or ""). Returns a short multi-fact string. Never throws. */
    function detailText(r, prefix, extra) {
      var bits = [];
      try {
        if (r && typeof r.headBlock === "number") bits.push("head " + r.headBlock);
        bits.push("age " + ((r && typeof r.headAgeS === "number") ? r.headAgeS.toFixed(1) + "s" : "—"));
        bits.push("participation " + ((r && typeof r.participation === "number") ? r.participation.toFixed(1) + "%" : "—"));
        bits.push("irreversible lag " + ((r && typeof r.irrevLag === "number") ? r.irrevLag : "—"));
        bits.push("chain " + (prefix || "—"));
        if (extra) bits.push(extra);
      } catch (e) { /* partial bits stand */ }
      return bits.join(" · ");
    }
    /* Next pending row: paint connecting, probe, paint the outcome, step.
     * Ends by repainting the offline panel (paintOfflineIfAllDown). */
    function next() {
      if (i >= nodes.length) { paintOfflineIfAllDown(tbody, offline); return; }
      var url = nodes[i], row = findRow(tbody, url);
      setRow(row, t("settings.pending", "…"), t("settings.connecting", "connecting"), "connecting");
      Chain.probe(url, 6000).then(function (r) {
        /* H1: a probe hit on the wrong chain paints as a mismatch (down),
         * never as a healthy row — selecting it would sign wrong-chain. */
        var mismatch = false;
        try {
          var st = Store.loadSettings();
          var exp = Store.CHAIN_IDS && Store.CHAIN_IDS[st.network];
          if (exp && r && r.chainId &&
              String(r.chainId).toLowerCase() !== String(exp).toLowerCase()) mismatch = true;
        } catch (pinErr) { mismatch = false; }
        var prefix = "";
        try { prefix = String(r.chainId || "").slice(0, 8); } catch (sliceErr) { prefix = ""; }
        if (mismatch) {
          pushSample(url, { ms: r.latencyMs, status: "WRONG-CHAIN" });
          setRow(row, latencyText(t, r.latencyMs, r.headAgeS), "mismatch " + prefix, "down",
            detailText(r, prefix, "wrong chain for this network"));
          /* History truth is recorded even for mismatches (the probe found
           * it) — the row is unselectable anyway, the pill stays honest. */
          try {
            if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.update === "function") {
              HistoryCap.update(url, r.hasHistory === true);
            }
          } catch (capErr) { /* snapshot stands */ }
          paintHistory(row, url, t);
        } else {
          var v = { status: "GOOD", detail: "ok" };
          try {
            if (typeof Chain !== "undefined" && Chain && typeof Chain.classifyHealth === "function") {
              v = Chain.classifyHealth({ latencyMs: r.latencyMs, chainOk: true,
                headAgeS: r.headAgeS, participation: r.participation, irrevLag: r.irrevLag });
            }
          } catch (clErr) { v = { status: "GOOD", detail: "ok" }; }
          pushSample(url, { ms: r.latencyMs, age: r.headAgeS, part: r.participation, status: v.status });
          var pill = {
            "GOOD": t("settings.node_good", "Good"),
            "STALE": t("settings.node_stale", "Stale"),
            "SUSPECT": t("settings.node_suspect", "Suspect"),
            "FORKED": t("settings.node_forked", "Forked"),
            "WRONG-CHAIN": "mismatch " + prefix
          }[v.status] || t("settings.node_good", "Good");
          var id = (v.status === "GOOD") ? "up"
            : (v.status === "STALE") ? "stale"
            : (v.status === "SUSPECT") ? "suspect"
            : (v.status === "FORKED") ? "forked" : "up";
          var lg = lastGood(url);
          var extra = "";
          if (v.status !== "GOOD" && lg) {
            var ago = agoMinutes(lg.t);
            if (ago) extra = "last good " + ago;
          }
          setRow(row, latencyText(t, r.latencyMs, r.headAgeS), (v.status === "GOOD") ? prefix : (pill + " · " + prefix),
            id, detailText(r, prefix, extra));
          /* Live history truth overwrites the snapshot (Phase-1 matrix). */
          try {
            if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.update === "function") {
              HistoryCap.update(url, r.hasHistory === true);
            }
          } catch (capErr) { /* snapshot stands */ }
          paintHistory(row, url, t);
        }
      }).catch(function (e) {
        var timeout = !!(e && typeof e.message === "string" && e.message.indexOf("timeout") !== -1);
        pushSample(url, { ms: null, status: timeout ? "TIMEOUT" : "DOWN" });
        var lg = lastGood(url);
        var extra = "";
        if (lg) { var ago = agoMinutes(lg.t); if (ago) extra = "last good " + ago; }
        setRow(row, t("settings.dash", "—"),
          timeout ? t("settings.node_timeout", "Timeout") : t("settings.down", "down"),
          "down", extra || undefined);
        /* No probe data — snapshot (or unknown) stands, still repaint so a
         * retried-then-failed row never shows a stale live pill. */
        paintHistory(row, url, t);
      }).then(function () { i++; next(); });
    }
    next();
  }

  /* Persist the active node and reconnect the shared socket now (the badge
   * + next probe pass carry any error — never a throw here).
   * Params: url string. Fails: never (connect errors are swallowed). */
  function selectNode(url) {
    Store.saveSettings({activeNode: url});
    if (typeof Chain !== "undefined" && Chain && Chain.connect) {
      try { Chain.connect(url); } catch (e) { /* probe/badge carries the error */ }
    }
  }

  return {
    allNodes: allNodes,
    isCustom: isCustom,
    findRow: findRow,
    setRow: setRow,
    buildNodeTable: buildNodeTable,
    buildNodeCards: buildNodeCards,
    buildProbe: buildProbe,
    buildCustom: buildCustom,
    buildDiscover: buildDiscover,
    discoverRow: discoverRow,
    paintOfflineIfAllDown: paintOfflineIfAllDown,
    probeAll: probeAll,
    selectNode: selectNode,
    _test: { readHist: readHist, pushSample: pushSample, lastGood: lastGood, agoMinutes: agoMinutes, histInfo: histInfo, latencyText: latencyText }
  };
})();

if (typeof module !== "undefined") { module.exports = SettingsNodes; }
