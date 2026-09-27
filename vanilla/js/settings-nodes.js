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

  /* Paint one table row AND its mirrored phone card with the same
   * latency/status text. Status is tracked as a canonical id on data-status
   * (up|connecting|down); the visible text may be translated (settings.
   * connecting/down are load-bearing Spanish in es mode) so
   * paintOfflineIfAllDown compares the id below, never the translated text.
   * Params: row (tr, may be null — no-op except the card lookup needs its
   *   data-url), latencyText/statusText strings, statusId ("up"|"connecting"|
   *   "down", optional). Fails: never (missing cells are skipped). */
  function setRow(row, latencyText, statusText, statusId) {
    if (row) {
      var lat = row.querySelector(".latency");
      var st = row.querySelector(".node-status");
      if (lat) lat.textContent = latencyText;
      if (st) st.textContent = statusText;
      if (statusId) row.setAttribute("data-status", statusId);
    }
    var url = row ? row.getAttribute("data-url") : null;
    if (url && row && row.ownerDocument) {
      var card = row.ownerDocument.querySelector('.node-card[data-url="' + url + '"]');
      if (card) {
        var cLat = card.querySelector(".latency");
        var cSt = card.querySelector(".node-status");
        if (cLat) cLat.textContent = latencyText;
        if (cSt) cSt.textContent = statusText;
        if (statusId) card.setAttribute("data-status", statusId);
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
      tdSt.className = "node-status";
      tdSt.textContent = t("settings.pending", "…");
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
    probeBtn.textContent = t("settings.probe_all", "Probe all");

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

  /* Custom-node add block: wss:// input + Add + inline error line.
   * Validation + wiring stay in settings.js. Params: doc, t. Returns:
   *   {wrap, customInput, customAdd, customError}. */
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
    customAdd.textContent = t("settings.add", "Add");
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

  /* Sequential latency probe over the node list (one socket at a time —
   * parallel probes race the shared Chain socket). Rows paint connecting →
   * up (chain-id prefix + ms) or down; the offline panel refreshes at the
   * end. Params: nodes (URL list), tbody (rows looked up by data-url),
   *   offline (panel), t (status strings). Fails: never (per-row catch). */
  function probeAll(nodes, tbody, offline, t) {
    var i = 0;
    /* Next pending row: paint connecting, probe, paint the outcome, step.
     * Ends by repainting the offline panel (paintOfflineIfAllDown). */
    function next() {
      if (i >= nodes.length) { paintOfflineIfAllDown(tbody, offline); return; }
      var url = nodes[i], row = tbody.querySelector('tr[data-url="' + url + '"]');
      setRow(row, t("settings.pending", "…"), t("settings.connecting", "connecting"), "connecting");
      Chain.probe(url, 6000).then(function (r) {
        setRow(row, r.latencyMs + "ms", r.chainId.slice(0, 8), "up");
      }).catch(function () {
        setRow(row, t("settings.dash", "—"), t("settings.down", "down"), "down");
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
    setRow: setRow,
    buildNodeTable: buildNodeTable,
    buildNodeCards: buildNodeCards,
    buildProbe: buildProbe,
    buildCustom: buildCustom,
    paintOfflineIfAllDown: paintOfflineIfAllDown,
    probeAll: probeAll,
    selectNode: selectNode
  };
})();

if (typeof module !== "undefined") { module.exports = SettingsNodes; }
