/* SettingsPage: #/settings route orchestration (node list + preferences).
 * Owns: NOTHING built here — render() composes the SettingsNodes (node
 *   table/cards/probe/custom) and SettingsPrefs (network/theme/locale)
 *   sections, then wires every event handler. The wiring bodies are verbatim
 *   from the pre-split render; only the DOM construction moved out.
 * Consumes: Store.loadSettings/saveSettings (settings envelope), Chain
 *   (connect/probe via SettingsNodes), I18n/App/Router (locale switch only),
 *   SettingsNodes + SettingsPrefs (both scripts load first — index.html
 *   order is load-bearing).
 * Globals/side effects: DOM under the router root; global SettingsPage
 *   ({render}) consumed by router.js renderSettings. No key material.
 * Created by: building-vanilla-slices skill, slice-01-shell-settings plan;
 *   split into settings-nodes.js + settings-prefs.js in the slice-18 audit
 *   (render decomposed into named section builders regardless of size).
 */
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

  /* Route entry: compose node + preference sections, wire events, probe.
   * Params: rootEl (router #view child, cleared first). Sections append in
   *   old-UI order: title, network, node table + cards, probe + offline,
   *   custom, theme, locale. Fails: never (probe errors paint per-row). */
  function render(rootEl) {
    var doc = rootEl.ownerDocument;
    var settings = Store.loadSettings();
    var nodes = SettingsNodes.allNodes(settings);

    while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);

    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    rootEl.appendChild(wrap);

    var h1 = doc.createElement("h1");
    h1.textContent = t("settings.title", "Settings");
    wrap.appendChild(h1);

    var netToggle = SettingsPrefs.buildNetwork(doc, settings, t);
    wrap.appendChild(netToggle);

    var tbl = SettingsNodes.buildNodeTable(doc, settings, nodes, t);
    wrap.appendChild(tbl.table);
    var tbody = tbl.tbody;

    var cards = SettingsNodes.buildNodeCards(doc, settings, nodes, t);
    wrap.appendChild(cards);

    var probe = SettingsNodes.buildProbe(doc, t);
    wrap.appendChild(probe.probeBtn);
    wrap.appendChild(probe.offline);
    var offline = probe.offline;

    var custom = SettingsNodes.buildCustom(doc, t);
    wrap.appendChild(custom.wrap);
    var customInput = custom.customInput, customAdd = custom.customAdd, customError = custom.customError;

    var theme = SettingsPrefs.buildTheme(doc, settings, t);
    wrap.appendChild(theme.label);
    var themeSelect = theme.select;

    /* Locale switcher (slice-17 Task 2): builder owns the DOM + current tag;
     * the change handler below owns the switch (ambiguity D: full router
     * re-render, cheap and subscription-free; ambiguity E: honest fallback
     * line + snap-back on fetch failure — never a spinner, never blank). */
    var loc = SettingsPrefs.buildLocale(doc, t);
    wrap.appendChild(loc.label);
    wrap.appendChild(loc.error);
    var localeSelect = loc.select, localeError = loc.error, currentLocale = loc.currentLocale;

    // Events: node radios
    Array.prototype.forEach.call(tbody.querySelectorAll('input[name="node"]'), function (r) {
      r.addEventListener("change", function () {
        if (r.checked) SettingsNodes.selectNode(r.value);
      });
    });

    // Events: card select buttons
    Array.prototype.forEach.call(cards.querySelectorAll(".node-select"), function (b) {
      b.addEventListener("click", function () {
        SettingsNodes.selectNode(b.getAttribute("data-url"));
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
    probe.probeBtn.addEventListener("click", function () {
      offline.hidden = true;
      SettingsNodes.probeAll(nodes, tbody, offline, t);
    });
    probe.retryBtn.addEventListener("click", function () {
      offline.hidden = true;
      SettingsNodes.probeAll(nodes, tbody, offline, t);
    });

    // Events: custom add
    customAdd.addEventListener("click", function () {
      var v = customInput.value.trim();
      if (!/^wss:\/\//.test(v)) {
        customError.textContent = t("settings.err_wss", "Only wss:// URLs are allowed.");
        return;
      }
      /* M2: cap custom URL length (overlong URLs break row storage/lookup). */
      if (v.length > 256) {
        customError.textContent = t("settings.err_long", "URL too long: 256 characters maximum.");
        return;
      }
      customError.textContent = "";
      var cur = Store.loadSettings();
      var customs = Array.isArray(cur.customNodes) ? cur.customNodes.slice() : [];
      if (SettingsNodes.allNodes(cur).indexOf(v) !== -1) {
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
    SettingsNodes.probeAll(nodes, tbody, offline, t);
  }

  return {render: render};
})();

if (typeof module !== "undefined") { module.exports = SettingsPage; }
