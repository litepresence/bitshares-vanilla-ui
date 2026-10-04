/* SettingsPage: #/settings route orchestration (node list + preferences).
 * Owns: NOTHING built here — render() composes the SettingsNodes (node
 *   table/cards/probe/custom) and SettingsPrefs (theme/locale)
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
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") {
      return dflt.replace(/%\(([^)]+)\)s/g, function (m, n) {
        return (vars[n] !== undefined) ? String(vars[n]) : m;
      });
    }
    return dflt;
  }

  /* Route entry: compose node + preference sections, wire events, probe.
   * Params: rootEl (router #view child, cleared first). Sections append in
   *   old-UI order: title, node table + cards (with history pills),
   *   probe + offline, custom, testnet note (testnet only), community-history
   *   switch, theme, locale. Fails: never (probe errors paint per-row). */
  function render(rootEl) {
    var doc = rootEl.ownerDocument;
    var settings = Store.loadSettings();
    var nodes = SettingsNodes.allNodes(settings);

    while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);

    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    rootEl.appendChild(wrap);

    wrap.appendChild(DOM.pageHead(doc, t("settings.title", "Settings"), "cog"));

    var tbl = SettingsNodes.buildNodeTable(doc, settings, nodes, t);
    wrap.appendChild(tbl.table);
    var tbody = tbl.tbody;

    var cards = SettingsNodes.buildNodeCards(doc, settings, nodes, t);
    wrap.appendChild(cards);

    var probe = SettingsNodes.buildProbe(doc, t);
    var offline = probe.offline;

    var custom = SettingsNodes.buildCustom(doc, t);
    var customInput = custom.customInput, customAdd = custom.customAdd, customError = custom.customError;

    /* Opt-in discovery (explicit button only — never automatic): background
     * sweep with progress + cancel; results are review candidates, Add
     * reuses the custom path above (same validation, same storage). */
    var disc = SettingsNodes.buildDiscover(doc, t);

    /* Node ops row (owner: one line on desktop): probe-all + custom add +
     * discover button share a flex row ≥720px and stack below it. The
     * discover note/progress/results + offline panel stay full-width under
     * the row (results need the width). */
    var opsRow = doc.createElement("div");
    opsRow.className = "node-ops-row";
    opsRow.appendChild(probe.probeBtn);
    opsRow.appendChild(custom.wrap);
    try {
      var discBtns = doc.createElement("div");
      discBtns.className = "node-discover-btns";
      discBtns.appendChild(disc.btn);
      discBtns.appendChild(disc.cancel);
      opsRow.appendChild(discBtns);
    } catch (e) { opsRow.appendChild(disc.btn); }
    wrap.appendChild(opsRow);
    wrap.appendChild(probe.offline);
    /* Geo note first: it footnotes the Location/Provider columns higher on
     * the page; the Find-nodes note follows its own button block below. */
    try {
      if (typeof SettingsNodes !== "undefined" && SettingsNodes &&
          typeof SettingsNodes.buildGeoNote === "function") {
        wrap.appendChild(SettingsNodes.buildGeoNote(doc, t));
      }
    } catch (e) { /* note best-effort; the table works without it */ }
    wrap.appendChild(disc.note);
    wrap.appendChild(disc.progress);
    wrap.appendChild(disc.list);

    /* Testnet honesty (Phase 3): node history works on testnet, but the
     * community index covers mainnet only — index-powered surfaces stay
     * unavailable there (sweep 2026-10-02: both testnet nodes serve the
     * history api id; ES has no testnet data). Plain p.muted, no banner
     * chrome — the shell owns the one global warn-banner. */
    if (settings.network === "testnet") {
      var testnetNote = doc.createElement("p");
      testnetNote.className = "muted";
      testnetNote.setAttribute("aria-live", "polite");
      testnetNote.textContent = t("settings.testnet_hist", "Testnet: node history works here, but the community index covers mainnet only — index-powered features are unavailable.");
      wrap.appendChild(testnetNote);
    }

    /* Community-history switch (Phase 3): persists esEnabled; views read it
     * live via HistoryCap.esAllowed — no reconnect, no re-render needed. */
    var hist = SettingsPrefs.buildHistory(doc, settings, t);
    wrap.appendChild(hist.wrap);
    var esBox = hist.checkbox;

    /* Signing section (Tier 2): route display + pin + warning + sites.
     * Radio changes persist + rerender (mode display + badge follow the
     * envelope); the allowlist fills async below (empty note stands when
     * the extension store is absent — web builds show no sites). */
    var sign = SettingsPrefs.buildSigning(doc, settings, t);
    wrap.appendChild(sign.wrap);
    var signRadios = sign.radios, signList = sign.listBox, signEmpty = sign.emptyNote;

    var themeHead = doc.createElement("h2");
    themeHead.textContent = t("settings.theme_title", "Theme");
    wrap.appendChild(themeHead);
    var theme = SettingsPrefs.buildTheme(doc, settings, t);
    wrap.appendChild(theme.label);
    var themeSelect = theme.select;

    /* Locale switcher (slice-17 Task 2): builder owns the DOM + current tag;
     * the change handler below owns the switch (ambiguity D: full router
     * re-render, cheap and subscription-free; ambiguity E: honest fallback
     * line + snap-back on fetch failure — never a spinner, never blank). */
    var locHead = doc.createElement("h2");
    locHead.textContent = t("settings.language_title", "Language");
    wrap.appendChild(locHead);
    var loc = SettingsPrefs.buildLocale(doc, t);
    wrap.appendChild(loc.label);
    wrap.appendChild(loc.error);
    var localeSelect = loc.select, localeError = loc.error, currentLocale = loc.currentLocale;

    /* Locked view-as section (exactly one, always last): the settings route
     * clears its root first, so re-renders replace, never accumulate. The
     * header account button navigates here (app.js goToViewingAs). */
    try {
      if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.renderSection === "function") {
        wrap.appendChild(ViewingAs.renderSection(doc));
      }
    } catch (e) { /* settings stand without viewing */ }

    /* Card Select/Selected labels go stale without a rerender (radios flip
     * natively). Refresh after every selection; full render only when the
     * network flipped (testnet note visibility). Params: none (closure).
     * Returns nothing. Never throws. */
    function refreshSelectLabels() {
      var active = "";
      try { active = Store.loadSettings().activeNode || ""; } catch (e) { /* labels stand */ }
      Array.prototype.forEach.call(cards.querySelectorAll(".node-select"), function (b) {
        var on = false;
        try { on = b.getAttribute("data-url") === active; } catch (e) { /* keep */ }
        b.textContent = on ? t("settings.selected", "Selected") : t("settings.select", "Select");
      });
    }

    // Events: node radios (selection may flip networks -> rerender then)
    Array.prototype.forEach.call(tbody.querySelectorAll('input[name="node"]'), function (r) {
      r.addEventListener("change", function () {
        if (!r.checked) return;
        try {
          SettingsNodes.selectNode(r.value).then(function (flipped) {
            try { refreshSelectLabels(); } catch (e) { /* labels stand */ }
            if (flipped) render(rootEl);
          });
        } catch (e) { /* selection stands */ }
      });
    });

    // Events: card select buttons (selection may flip networks -> rerender then)
    Array.prototype.forEach.call(cards.querySelectorAll(".node-select"), function (b) {
      b.addEventListener("click", function () {
        try {
          SettingsNodes.selectNode(b.getAttribute("data-url")).then(function (flipped) {
            try { refreshSelectLabels(); } catch (e) { /* labels stand */ }
            if (flipped) render(rootEl);
          });
        } catch (e) { /* selection stands */ }
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
      Store.saveSettings({ customNodes: customs, hiddenNodes: SettingsNodes.unhideNode(cur.hiddenNodes, v) });
      render(rootEl);
    });

    // Events: discovery run + cancel (guarded: engine absent = button dead-ends honestly)
    (function () {
      var running = false, cancelled = false;
      disc.btn.addEventListener("click", function () {
        if (running) return;
        if (typeof NodeDiscover === "undefined" || !NodeDiscover || typeof NodeDiscover.run !== "function") {
          disc.progress.textContent = t("settings.discover_unavailable", "Discovery unavailable in this build.");
          return;
        }
        running = true; cancelled = false;
        disc.btn.disabled = true;
        disc.cancel.hidden = false;
        while (disc.list.firstChild) disc.list.removeChild(disc.list.firstChild);
        var cur = Store.loadSettings();
        var known = {
          mainnet: (Store.DEFAULT_NODES && Store.DEFAULT_NODES.mainnet) || [],
          testnet: (Store.DEFAULT_NODES && Store.DEFAULT_NODES.testnet) || [],
          customs: Array.isArray(cur.customNodes) ? cur.customNodes : []
        };
        NodeDiscover.run({
          known: known,
          isCancelled: function () { return cancelled; },
          onProgress: function (m) {
            try {
              var s = String(m);
              if (s === "repos") s = t("settings.discover_searching", "Searching GitHub…");
              else if (s === "repo") s = t("settings.discover_reading", "Reading node lists…");
              else if (s === "probe") s = t("settings.discover_probing", "Probing candidates…");
              else if (/^\d+\/\d+$/.test(s)) s = t("settings.discover_checking", "Checking") + " " + s;
              disc.progress.textContent = s;
            } catch (e) { /* progress stands */ }
          }
        }).then(function (rows) {
          running = false;
          try { disc.btn.disabled = false; disc.cancel.hidden = true; } catch (e) {}
          try {
            while (disc.list.firstChild) disc.list.removeChild(disc.list.firstChild);
            if (!rows || !rows.length) {
              disc.progress.textContent = t("settings.discover_none", "No new nodes found — the curated list stands.");
              return;
            }
            disc.progress.textContent = t("settings.discover_found", "Candidates for review (nothing added yet):");
            rows.forEach(function (row) {
              disc.list.appendChild(SettingsNodes.discoverRow(doc, t, row, function (url) {
                try { customInput.value = url; customAdd.click(); } catch (e) { /* custom path carries it */ }
              }));
            });
          } catch (e) { /* results stand */ }
        });
      });
      disc.cancel.addEventListener("click", function () {
        cancelled = true;
        try { disc.progress.textContent = t("settings.discover_cancelled", "Cancelled — partial results kept."); } catch (e) {}
        try { disc.btn.disabled = false; disc.cancel.hidden = true; } catch (e) {}
      });
    })();

    // Events: node remove (table + cards) — confirm first via the shared
    // Overlay + ConfirmDialog builders, then hide/unlist + fallback + render.
    Array.prototype.forEach.call(wrap.querySelectorAll(".node-remove"), function (b) {
      b.addEventListener("click", function () {
        var u = b.getAttribute("data-url");
        var cur = Store.loadSettings();
        var customs = Array.isArray(cur.customNodes) ? cur.customNodes.slice() : [];
        var hidden = Array.isArray(cur.hiddenNodes) ? cur.hiddenNodes.slice() : [];
        var isC = customs.indexOf(u) !== -1;
        var patch = {
          customNodes: isC ? customs.filter(function (x) { return x !== u; }) : customs,
          hiddenNodes: isC ? hidden : SettingsNodes.hideNode(hidden, u)
        };
        var fb = "";
        if (cur.activeNode === u) {
          var rest = SettingsNodes.allNodes({ network: cur.network, customNodes: patch.customNodes, hiddenNodes: patch.hiddenNodes });
          patch.activeNode = rest[0] || "";
          fb = patch.activeNode;
        }
        function apply() {
          Store.saveSettings(patch);
          render(rootEl);
        }
        /* Shared builders missing (script order guarantees them in the
         * bundle — this is fail-open paranoia): fall back to immediate
         * removal, today's behavior. */
        if (typeof Overlay === "undefined" || typeof ConfirmDialog === "undefined") {
          apply();
          return;
        }
        var rows = [
          [t("settings.th_node", "Node"), u],
          [t("settings.confirm_remove_action", "Action"),
            isC ? t("settings.confirm_remove_unlist", "Remove from my list")
              : t("settings.confirm_remove_hide", "Hide this node (stays hidden until re-added)")]
        ];
        if (cur.activeNode === u) {
          var dest = fb;
          try {
            dest = fb || String(t("settings.dash", "—"));
          } catch (e) { dest = fb || "—"; }
          rows.push([t("settings.confirm_remove_result", "Result"),
            t("settings.confirm_remove_switch", "Active node moves to %(node)s", { node: dest })]);
        }
        var dlg = null, box = null;
        function closeBox() {
          try { if (box && typeof box.close === "function") box.close(); } catch (e) { /* detached stands */ }
        }
        try {
          dlg = ConfirmDialog.show({
            title: t("settings.confirm_remove_title", "Remove node?"),
            rows: rows,
            backLabel: t("settings.confirm_back", "Back"),
            sendLabel: t("settings.remove", "Remove"),
            onBack: function () { closeBox(); },
            onSend: function () { closeBox(); apply(); }
          });
          box = Overlay.open({ content: dlg });
        } catch (e) {
          closeBox();
          apply();
        }
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

    // Events: community-history toggle (persist only — views read esAllowed
    // live on next history call, so no reconnect or re-render is needed).
    esBox.addEventListener("change", function () {
      try { Store.saveSettings({esEnabled: esBox.checked === true}); }
      catch (e) { /* pref write failed — box keeps user pick, next load reseeds */ }
    });

    /* Events: signing pin (persist + rerender — the mode line, warning,
     * badge, and effective route all follow the envelope). */
    ["auto", "extension", "browser"].forEach(function (v) {
      try {
        if (signRadios && signRadios[v]) {
          signRadios[v].addEventListener("change", function () {
            if (!signRadios[v].checked) return;
            try { Store.saveSettings({ signing: v }); } catch (e) { /* select keeps pick */ }
            render(rootEl);
          });
        }
      } catch (e) { /* radio stands unpinned */ }
    });

    /* Connected sites (Tier 2 allowlist): read from the persistent
     * extension store; each row names the origin + bound account ids with a
     * per-origin Revoke (removes the binding — next request prompts again).
     * Absent store (plain web) keeps the empty note: no sites, honestly. */
    (function fillSites() {
      var store = null;
      try {
        if (typeof chrome !== "undefined" && chrome && chrome.storage && chrome.storage.local) {
          store = chrome.storage.local;
        } else if (typeof browser !== "undefined" && browser && browser.storage && browser.storage.local) {
          store = browser.storage.local;
        }
      } catch (e) { store = null; }
      if (!store) return;
      try {
        store.get(["vb-allowlist-v1"], function (items) {
          try {
            var denied = false;
            try {
              var ns = (typeof chrome !== "undefined" && chrome) ||
                (typeof browser !== "undefined" && browser);
              if (ns && ns.runtime && ns.runtime.lastError) denied = true;
            } catch (e) { denied = true; }
            if (denied) return;
            var a = items ? items["vb-allowlist-v1"] : null;
            if (!a || typeof a !== "object") return;
            var origins = Object.keys(a);
            if (!origins.length) return;
            while (signEmpty.firstChild) signEmpty.removeChild(signEmpty.firstChild);
            try { signEmpty.parentNode.removeChild(signEmpty); } catch (e) { /* note stands empty */ }
            origins.forEach(function (origin) {
              var entry = a[origin] || {};
              var ids = Array.isArray(entry.allowedAccountIds) ? entry.allowedAccountIds : [];
              var row = doc.createElement("div");
              row.className = "sign-site-row";
              var name = doc.createElement("div");
              name.textContent = origin;
              row.appendChild(name);
              var sub = doc.createElement("div");
              sub.className = "muted";
              sub.textContent = ids.join(", ") || t("settings.sign_sites_empty", "No sites approved yet — approvals appear here with per-site revoke.");
              row.appendChild(sub);
              var revoke = doc.createElement("button");
              revoke.type = "button";
              revoke.textContent = t("settings.sign_revoke", "Revoke");
              try { revoke.style.minHeight = "44px"; } catch (e) { /* native stands */ }
              revoke.addEventListener("click", function () {
                revoke.disabled = true;
                try {
                  store.get(["vb-allowlist-v1"], function (items2) {
                    try {
                      var a2 = items2 ? items2["vb-allowlist-v1"] : null;
                      if (a2 && typeof a2 === "object" && a2[origin]) {
                        delete a2[origin];
                        var o = {};
                        o["vb-allowlist-v1"] = a2;
                        store.set(o, function () { render(rootEl); });
                        return;
                      }
                    } catch (e) { /* fall through to rerender */ }
                    render(rootEl);
                  });
                } catch (e) { render(rootEl); }
              });
              row.appendChild(revoke);
              signList.appendChild(row);
            });
          } catch (e) { /* empty note stands */ }
        });
      } catch (e) { /* empty note stands */ }
    })();

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
        localeError.textContent = t("settings.locale_unavailable", "Locale unavailable offline — showing English.");
        try { localeSelect.value = currentLocale; } catch (e) { /* select keeps user pick */ }
        return;
      }
      I18n.setLocale(code).then(function (r) {
        if (!r || !r.ok) {
          localeError.textContent = t("settings.locale_unavailable", "Locale unavailable offline — showing English.");
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
