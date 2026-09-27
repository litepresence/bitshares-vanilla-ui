/* SettingsPage: nodes page. Network toggle, node table+cards, probe, custom nodes, theme, locale. */
var SettingsPage = (function () {
  "use strict";

  /* Batch-1 i18n (slice-17 Task 2): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

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

  /* Status is tracked as a canonical id on data-status (up|connecting|down);
   * the visible text may be translated (settings.connecting/down are
   * load-bearing Spanish in es mode) so paintOfflineIfAllDown compares the
   * id below, never the translated text. */
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

  function render(rootEl) {
    var settings = Store.loadSettings();
    var nodes = allNodes(settings);

    while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);

    var wrap = rootEl.ownerDocument.createElement("div");
    wrap.className = "wrap";
    rootEl.appendChild(wrap);

    var h1 = rootEl.ownerDocument.createElement("h1");
    h1.textContent = t("settings.title", "Settings");
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
      var netLabel = (net === "testnet") ? t("settings.network_testnet", "testnet") : t("settings.network_mainnet", "mainnet");
      label.appendChild(rootEl.ownerDocument.createTextNode(" " + netLabel));
      netToggle.appendChild(label);
    });
    wrap.appendChild(netToggle);

    // Node table
    var table = rootEl.ownerDocument.createElement("table");
    table.className = "node-table";
    var thead = rootEl.ownerDocument.createElement("thead");
    var headRow = rootEl.ownerDocument.createElement("tr");
    ["", t("settings.th_node", "Node"), t("settings.th_latency", "Latency"), t("settings.th_status", "Status"), ""].forEach(function (t) {
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
      tdLat.textContent = t("settings.pending", "…");
      tr.appendChild(tdLat);

      var tdSt = rootEl.ownerDocument.createElement("td");
      tdSt.className = "node-status";
      tdSt.textContent = t("settings.pending", "…");
      tr.appendChild(tdSt);

      var tdAct = rootEl.ownerDocument.createElement("td");
      if (isCustom(url, settings)) {
        var rm = rootEl.ownerDocument.createElement("button");
        rm.type = "button";
        rm.className = "node-remove";
        rm.setAttribute("data-url", url);
        rm.textContent = t("settings.remove", "Remove");
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
      latSpan.textContent = t("settings.pending", "…");
      card.appendChild(latSpan);

      var stSpan = rootEl.ownerDocument.createElement("span");
      stSpan.className = "node-status";
      stSpan.textContent = t("settings.pending", "…");
      card.appendChild(stSpan);

      var selBtn = rootEl.ownerDocument.createElement("button");
      selBtn.type = "button";
      selBtn.className = "node-select";
      selBtn.setAttribute("data-url", url);
      selBtn.textContent = settings.activeNode === url ? t("settings.selected", "Selected") : t("settings.select", "Select");
      card.appendChild(selBtn);

      if (isCustom(url, settings)) {
        var rm2 = rootEl.ownerDocument.createElement("button");
        rm2.type = "button";
        rm2.className = "node-remove";
        rm2.setAttribute("data-url", url);
        rm2.textContent = t("settings.remove", "Remove");
        card.appendChild(rm2);
      }

      cards.appendChild(card);
    });
    wrap.appendChild(cards);

    // Probe-all button
    var probeBtn = rootEl.ownerDocument.createElement("button");
    probeBtn.id = "probe-all";
    probeBtn.type = "button";
    probeBtn.textContent = t("settings.probe_all", "Probe all");
    wrap.appendChild(probeBtn);

    // Offline panel (hidden unless all probes fail)
    var offline = rootEl.ownerDocument.createElement("div");
    offline.id = "offline-panel";
    offline.hidden = true;
    var offMsg = rootEl.ownerDocument.createElement("p");
    offMsg.textContent = t("settings.offline", "All nodes unreachable. Check your connection and retry.");
    offline.appendChild(offMsg);
    var retryBtn = rootEl.ownerDocument.createElement("button");
    retryBtn.id = "retry-btn";
    retryBtn.type = "button";
    retryBtn.textContent = t("settings.retry", "Retry");
    offline.appendChild(retryBtn);
    wrap.appendChild(offline);

    // Custom node add
    var customWrap = rootEl.ownerDocument.createElement("div");
    customWrap.className = "custom-node";
    var customInput = rootEl.ownerDocument.createElement("input");
    customInput.id = "custom-url";
    customInput.type = "text";
    customInput.setAttribute("inputmode", "url");
    customInput.placeholder = t("settings.custom_placeholder", "wss://…");
    customWrap.appendChild(customInput);
    var customAdd = rootEl.ownerDocument.createElement("button");
    customAdd.id = "custom-add";
    customAdd.type = "button";
    customAdd.textContent = t("settings.add", "Add");
    customWrap.appendChild(customAdd);
    var customError = rootEl.ownerDocument.createElement("div");
    customError.id = "custom-error";
    customError.className = "error";
    customError.setAttribute("aria-live", "polite");
    customWrap.appendChild(customError);
    wrap.appendChild(customWrap);

    // Theme selector
    var themeLabel = rootEl.ownerDocument.createElement("label");
    themeLabel.textContent = t("settings.theme_label", "Theme ");
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

    /* Locale switcher (slice-17 Task 2): mirrors the theme selector shape
     * (Reference #8). Option labels are the Reference-#7 display names;
     * stub locales (8) are suffixed " — in English" (honest marking) and
     * render English via the t() fallback chain. The visible "Language "
     * label stays a hardcoded English literal in this batch (no dict key
     * exists for it; converting it would churn all 10 dicts — queued for a
     * later per-view batch with its Task-1-style key). The failure line
     * below is likewise hardcoded: it is the ambiguity-E wording from the
     * plan, shown only when the dict fetch fails. */
    var localeLabel = rootEl.ownerDocument.createElement("label");
    localeLabel.textContent = "Language ";
    var localeSelect = rootEl.ownerDocument.createElement("select");
    localeSelect.id = "locale-select";
    var localeNames = {};
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.names === "function") localeNames = I18n.names();
    } catch (e) { localeNames = {}; }
    var localeCodes = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh"];
    var stubCodes = ["de", "fr", "it", "ja", "ko", "ru", "tr", "zh"];
    var currentLocale = "en";
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.locale === "function") currentLocale = I18n.locale();
    } catch (e) { currentLocale = "en"; }
    localeCodes.forEach(function (code) {
      var opt = rootEl.ownerDocument.createElement("option");
      opt.value = code;
      var name = localeNames[code] || code;
      opt.textContent = (stubCodes.indexOf(code) !== -1) ? name + " — in English" : name;
      if (currentLocale === code) opt.selected = true;
      localeSelect.appendChild(opt);
    });
    localeLabel.appendChild(localeSelect);
    wrap.appendChild(localeLabel);
    var localeError = rootEl.ownerDocument.createElement("div");
    localeError.id = "locale-error";
    localeError.className = "error";
    localeError.setAttribute("aria-live", "polite");
    wrap.appendChild(localeError);

    function paintOfflineIfAllDown() {
      var rows = tbody.querySelectorAll("tr");
      if (!rows.length) { offline.hidden = true; return; }
      var allDown = true;
      for (var k = 0; k < rows.length; k++) {
        if (rows[k].getAttribute("data-status") !== "down") { allDown = false; break; }
      }
      offline.hidden = !allDown;
    }

    function probeAll(nodes, tbody) {
      var i = 0;
      function next() {
        if (i >= nodes.length) { paintOfflineIfAllDown(); return; }
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
        customError.textContent = t("settings.err_wss", "Only wss:// URLs are allowed.");
        return;
      }
      customError.textContent = "";
      var cur = Store.loadSettings();
      var customs = Array.isArray(cur.customNodes) ? cur.customNodes.slice() : [];
      if (allNodes(cur).indexOf(v) !== -1) {
        customError.textContent = t("settings.err_dup", "Node already listed.");
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

    /* Events: locale select. Full router re-render on switch (ambiguity D:
     * cheap, plain, no subscriptions to rot — the whole shell + current
     * view re-renders, so no view keeps stale strings after rapid
     * switches). Failure (ambiguity E: file:// + uncached locale, offline
     * fetch reject) shows the honest fallback line and snaps the select
     * back — never a spinner, never blank. Pref write is owned by
     * I18n.setLocale (Store envelope + standalone fallback). */
    localeSelect.addEventListener("change", function () {
      var code = localeSelect.value;
      localeError.textContent = "";
      if (typeof I18n === "undefined" || !I18n || typeof I18n.setLocale !== "function") {
        localeError.textContent = "Locale unavailable offline — showing English.";
        try { localeSelect.value = currentLocale; } catch (e) { /* select keeps user pick */ }
        return;
      }
      I18n.setLocale(code).then(function (r) {
        if (!r || !r.ok) {
          localeError.textContent = "Locale unavailable offline — showing English.";
          try { localeSelect.value = I18n.locale(); } catch (e) { /* select keeps user pick */ }
          return;
        }
        currentLocale = I18n.locale();
        try {
          if (typeof App !== "undefined" && App && typeof App.localizeShell === "function") App.localizeShell();
        } catch (e) { /* shell keeps previous strings */ }
        try {
          if (typeof Router !== "undefined" && Router && typeof Router.start === "function") Router.start(rootEl);
          else render(rootEl);
        } catch (e) {
          try { render(rootEl); } catch (ignored) { /* view keeps previous strings */ }
        }
      });
    });

    // Initial latency pass
    probeAll(nodes, tbody);
  }

  return {render: render};
})();

if (typeof module !== "undefined") { module.exports = SettingsPage; }
