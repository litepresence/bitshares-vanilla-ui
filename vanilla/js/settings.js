/* SettingsPage: nodes page. Network toggle, node table+cards, probe, custom nodes, theme. */
var SettingsPage = (function () {
  "use strict";

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

  function isCustom(url, settings) {
    return Array.isArray(settings.customNodes) && settings.customNodes.indexOf(url) !== -1;
  }

  function setRow(row, latencyText, statusText) {
    if (row) {
      var lat = row.querySelector(".latency");
      var st = row.querySelector(".node-status");
      if (lat) lat.textContent = latencyText;
      if (st) st.textContent = statusText;
    }
    var url = row ? row.getAttribute("data-url") : null;
    if (url && row && row.ownerDocument) {
      var card = row.ownerDocument.querySelector('.node-card[data-url="' + url + '"]');
      if (card) {
        var cLat = card.querySelector(".latency");
        var cSt = card.querySelector(".node-status");
        if (cLat) cLat.textContent = latencyText;
        if (cSt) cSt.textContent = statusText;
      }
    }
  }

  function render(rootEl) {
    var settings = Store.loadSettings();
    var nodes = allNodes(settings);

    while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);

    var wrap = rootEl.ownerDocument.createElement("div");
    wrap.className = "wrap";
    rootEl.appendChild(wrap);

    var h1 = rootEl.ownerDocument.createElement("h1");
    h1.textContent = "Settings";
    wrap.appendChild(h1);

    // Network toggle
    var netToggle = rootEl.ownerDocument.createElement("div");
    netToggle.id = "net-toggle";
    var networks = ["mainnet", "testnet"];
    networks.forEach(function (net) {
      var label = rootEl.ownerDocument.createElement("label");
      var radio = rootEl.ownerDocument.createElement("input");
      radio.type = "radio";
      radio.name = "network";
      radio.value = net;
      if (settings.network === net) radio.checked = true;
      label.appendChild(radio);
      label.appendChild(rootEl.ownerDocument.createTextNode(" " + net));
      netToggle.appendChild(label);
    });
    wrap.appendChild(netToggle);

    // Node table
    var table = rootEl.ownerDocument.createElement("table");
    table.className = "node-table";
    var thead = rootEl.ownerDocument.createElement("thead");
    var headRow = rootEl.ownerDocument.createElement("tr");
    ["", "Node", "Latency", "Status", ""].forEach(function (t) {
      var th = rootEl.ownerDocument.createElement("th");
      th.textContent = t;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = rootEl.ownerDocument.createElement("tbody");
    tbody.id = "node-rows";
    table.appendChild(tbody);

    nodes.forEach(function (url) {
      var tr = rootEl.ownerDocument.createElement("tr");
      tr.setAttribute("data-url", url);

      var tdSel = rootEl.ownerDocument.createElement("td");
      var sel = rootEl.ownerDocument.createElement("input");
      sel.type = "radio";
      sel.name = "node";
      sel.value = url;
      if (settings.activeNode === url) sel.checked = true;
      tdSel.appendChild(sel);
      tr.appendChild(tdSel);

      var tdUrl = rootEl.ownerDocument.createElement("td");
      tdUrl.textContent = url;
      tr.appendChild(tdUrl);

      var tdLat = rootEl.ownerDocument.createElement("td");
      tdLat.className = "latency";
      tdLat.textContent = "…";
      tr.appendChild(tdLat);

      var tdSt = rootEl.ownerDocument.createElement("td");
      tdSt.className = "node-status";
      tdSt.textContent = "…";
      tr.appendChild(tdSt);

      var tdAct = rootEl.ownerDocument.createElement("td");
      if (isCustom(url, settings)) {
        var rm = rootEl.ownerDocument.createElement("button");
        rm.type = "button";
        rm.className = "node-remove";
        rm.setAttribute("data-url", url);
        rm.textContent = "Remove";
        tdAct.appendChild(rm);
      }
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
    wrap.appendChild(table);

    // Mirrored cards (shown under 560px via CSS)
    var cards = rootEl.ownerDocument.createElement("div");
    cards.className = "node-cards";
    nodes.forEach(function (url) {
      var card = rootEl.ownerDocument.createElement("div");
      card.className = "node-card";
      card.setAttribute("data-url", url);

      var urlDiv = rootEl.ownerDocument.createElement("div");
      urlDiv.className = "node-card-url";
      urlDiv.textContent = url;
      card.appendChild(urlDiv);

      var latSpan = rootEl.ownerDocument.createElement("span");
      latSpan.className = "latency";
      latSpan.textContent = "…";
      card.appendChild(latSpan);

      var stSpan = rootEl.ownerDocument.createElement("span");
      stSpan.className = "node-status";
      stSpan.textContent = "…";
      card.appendChild(stSpan);

      var selBtn = rootEl.ownerDocument.createElement("button");
      selBtn.type = "button";
      selBtn.className = "node-select";
      selBtn.setAttribute("data-url", url);
      selBtn.textContent = settings.activeNode === url ? "Selected" : "Select";
      card.appendChild(selBtn);

      if (isCustom(url, settings)) {
        var rm2 = rootEl.ownerDocument.createElement("button");
        rm2.type = "button";
        rm2.className = "node-remove";
        rm2.setAttribute("data-url", url);
        rm2.textContent = "Remove";
        card.appendChild(rm2);
      }

      cards.appendChild(card);
    });
    wrap.appendChild(cards);

    // Probe-all button
    var probeBtn = rootEl.ownerDocument.createElement("button");
    probeBtn.id = "probe-all";
    probeBtn.type = "button";
    probeBtn.textContent = "Probe all";
    wrap.appendChild(probeBtn);

    // Offline panel (hidden unless all probes fail)
    var offline = rootEl.ownerDocument.createElement("div");
    offline.id = "offline-panel";
    offline.hidden = true;
    var offMsg = rootEl.ownerDocument.createElement("p");
    offMsg.textContent = "All nodes unreachable. Check your connection and retry.";
    offline.appendChild(offMsg);
    var retryBtn = rootEl.ownerDocument.createElement("button");
    retryBtn.id = "retry-btn";
    retryBtn.type = "button";
    retryBtn.textContent = "Retry";
    offline.appendChild(retryBtn);
    wrap.appendChild(offline);

    // Custom node add
    var customWrap = rootEl.ownerDocument.createElement("div");
    customWrap.className = "custom-node";
    var customInput = rootEl.ownerDocument.createElement("input");
    customInput.id = "custom-url";
    customInput.type = "text";
    customInput.setAttribute("inputmode", "url");
    customInput.placeholder = "wss://…";
    customWrap.appendChild(customInput);
    var customAdd = rootEl.ownerDocument.createElement("button");
    customAdd.id = "custom-add";
    customAdd.type = "button";
    customAdd.textContent = "Add";
    customWrap.appendChild(customAdd);
    var customError = rootEl.ownerDocument.createElement("div");
    customError.id = "custom-error";
    customError.className = "error";
    customError.setAttribute("aria-live", "polite");
    customWrap.appendChild(customError);
    wrap.appendChild(customWrap);

    // Theme selector
    var themeLabel = rootEl.ownerDocument.createElement("label");
    themeLabel.textContent = "Theme ";
    var themeSelect = rootEl.ownerDocument.createElement("select");
    themeSelect.id = "theme-select";
    ["original-blue", "light", "dark"].forEach(function (t) {
      var opt = rootEl.ownerDocument.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (settings.theme === t) opt.selected = true;
      themeSelect.appendChild(opt);
    });
    themeLabel.appendChild(themeSelect);
    wrap.appendChild(themeLabel);

    function paintOfflineIfAllDown() {
      var rows = tbody.querySelectorAll("tr");
      if (!rows.length) { offline.hidden = true; return; }
      var allDown = true;
      for (var k = 0; k < rows.length; k++) {
        var s = rows[k].querySelector(".node-status");
        if (!s || s.textContent !== "down") { allDown = false; break; }
      }
      offline.hidden = !allDown;
    }

    function probeAll(nodes, tbody) {
      var i = 0;
      function next() {
        if (i >= nodes.length) { paintOfflineIfAllDown(); return; }
        var url = nodes[i], row = tbody.querySelector('tr[data-url="' + url + '"]');
        setRow(row, "…", "connecting");
        Chain.probe(url, 6000).then(function (r) {
          setRow(row, r.latencyMs + "ms", r.chainId.slice(0, 8));
        }).catch(function () {
          setRow(row, "—", "down");
        }).then(function () { i++; next(); });
      }
      next();
    }

    function selectNode(url) {
      Store.saveSettings({activeNode: url});
      if (typeof Chain !== "undefined" && Chain && Chain.connect) {
        try { Chain.connect(url); } catch (e) { /* probe/badge carries the error */ }
      }
    }

    // Events: node radios
    Array.prototype.forEach.call(tbody.querySelectorAll('input[name="node"]'), function (r) {
      r.addEventListener("change", function () {
        if (r.checked) selectNode(r.value);
      });
    });

    // Events: card select buttons
    Array.prototype.forEach.call(cards.querySelectorAll(".node-select"), function (b) {
      b.addEventListener("click", function () {
        selectNode(b.getAttribute("data-url"));
      });
    });

    // Events: network toggle
    Array.prototype.forEach.call(netToggle.querySelectorAll('input[name="network"]'), function (r) {
      r.addEventListener("change", function () {
        if (!r.checked) return;
        var net = r.value;
        var first = (Store.DEFAULT_NODES && Store.DEFAULT_NODES[net] && Store.DEFAULT_NODES[net][0]) || nodes[0];
        Store.saveSettings({network: net, activeNode: first});
        if (typeof Chain !== "undefined" && Chain && Chain.connect) {
          try { Chain.connect(first); } catch (e) { /* offline panel carries the error */ }
        }
        render(rootEl);
      });
    });

    // Events: probe-all + retry
    probeBtn.addEventListener("click", function () {
      offline.hidden = true;
      probeAll(nodes, tbody);
    });
    retryBtn.addEventListener("click", function () {
      offline.hidden = true;
      probeAll(nodes, tbody);
    });

    // Events: custom add
    customAdd.addEventListener("click", function () {
      var v = customInput.value.trim();
      if (!/^wss:\/\//.test(v)) {
        customError.textContent = "Only wss:// URLs are allowed.";
        return;
      }
      customError.textContent = "";
      var cur = Store.loadSettings();
      var customs = Array.isArray(cur.customNodes) ? cur.customNodes.slice() : [];
      if (allNodes(cur).indexOf(v) !== -1) {
        customError.textContent = "Node already listed.";
        return;
      }
      customs.push(v);
      Store.saveSettings({customNodes: customs});
      render(rootEl);
    });

    // Events: custom remove (table + cards)
    Array.prototype.forEach.call(wrap.querySelectorAll(".node-remove"), function (b) {
      b.addEventListener("click", function () {
        var u = b.getAttribute("data-url");
        var cur = Store.loadSettings();
        var customs = (Array.isArray(cur.customNodes) ? cur.customNodes : []).filter(function (x) { return x !== u; });
        var patch = {customNodes: customs};
        if (cur.activeNode === u) {
          var fb = (Store.DEFAULT_NODES && Store.DEFAULT_NODES[cur.network] && Store.DEFAULT_NODES[cur.network][0]) || "";
          patch.activeNode = fb;
        }
        Store.saveSettings(patch);
        render(rootEl);
      });
    });

    // Events: theme select
    themeSelect.addEventListener("change", function () {
      var t = themeSelect.value;
      Store.saveSettings({theme: t});
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.setAttribute("data-theme", t);
      }
    });

    // Initial latency pass
    probeAll(nodes, tbody);
  }

  return {render: render};
})();

if (typeof module !== "undefined") { module.exports = SettingsPage; }
