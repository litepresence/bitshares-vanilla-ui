/* EsLabUI: the #/es-lab community-index browser desk (Swagger feel, retro skin).
 * Owns: DOM for #/es-lab — template pulldown (optgroups per catalog group)
 *   + search, curated boxes, raw-DSL mirror (both directions via
 *   EsLab.fromBody), Run/Reset/Copy-link, result pane (raw <pre> here +
 *   parsed tables/honest panels via EsLabResults), in-session history,
 *   deep-link read/write via Router.query + replaceState (no re-render),
 *   account-name resolution at Run (EsLab.resolveAccount — reads only,
 *   never gates the desk).
 * Consumes: EsLab (catalog/build/fromBody — shapes), EsLabRun (resolve +
 *   run/runPaged — transport is HistoryCap inside, the ONLY ES path), HistoryCap.esAllowed/esAvailable
 *   (pref gate + reachability strip), Router.query (deep link),
 *   I18n.t (verbatim en defaults, slice-17 precedent).
 * Globals/side effects: DOM under the router root only; global EsLabUI;
 *   per-session sticky selection (never persisted). Generation counter tears
 *   down stale async work on route change (api-lab-ui.js pattern).
 *   textContent-only insertion throughout (index strings never reach HTML).
 * Created by: es-lab design 2026-10-03 (api-lab twin), AFK build.
 * Refs: api-lab-ui.js (desk structure mirrored 1:1 — same helpers, same
 *   card/mirror/history/link patterns); holdersSection
 *   (views/explorer-assets.js:868-956 — honest-panel precedent);
 *   market-fills-history.js:168-211 (paged-run caps, owned by EsLab).
 * STYLING CUES (from the api-lab desk, kept identical): stacked
 *   label-over-box rows, 100%-width ≤560px inline styles (no new CSS file —
 *   doctrine), ≥44px touch targets, muted meta lines, raw <pre> with
 *   pre-wrap/break-word, card + wrap-wide shell.
 */
var EsLabUI = (function () {
  "use strict";

  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  var gen = 0;
  var HISTORY_MAX = 20;
  var RAW_KEY = "()raw";
  var ID_RE = /^[0-9.]+$/;
  var ACCOUNT_RE = /^1\.2\.\d+$/;
  var callLog = []; /* in-session runs, newest first */
  var lastQ = null; /* sticky selection (template key) for the session */

  /* indexes: allowlisted index names for the raw console picker.
   * HistoryCap owns the list; the fallback mirrors it (kept in sync by
   * the Task 7 audit — never extended here). */
  function indexes() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap &&
          Array.isArray(HistoryCap.ES_INDEXES) && HistoryCap.ES_INDEXES.length) {
        return HistoryCap.ES_INDEXES.slice();
      }
    } catch (e) { /* fallback below */ }
    return ["bitshares-*", "objects-balance"];
  }

  /* isRaw: the raw-console pseudo-entry check. Params: key. Returns bool. */
  function isRaw(key) { return key === RAW_KEY; }

  /* kindOf: renderer kind for a key. Params: key. Returns
   * ops|holders|agg|raw (raw for the console + unknown keys — fail soft). */
  function kindOf(key) {
    try {
      if (isRaw(key)) return "raw";
      var tpl = EsLab.byKey(key);
      if (tpl && tpl.kind) return tpl.kind;
    } catch (e) { /* raw below */ }
    return "raw";
  }

  /* hrefFor: safe in-app link for a row cell. Params: kind ("account" |
   * "block"), id string. Returns the hash URL or null when the id has
   * non-addressing characters (never link attacker-shaped strings). */
  function hrefFor(kind, id) {
    if (typeof id !== "string" || !ID_RE.test(id)) return null;
    if (kind === "account") return "#/account/" + id;
    if (kind === "block") return "#/block/" + id;
    return null;
  }

  /* deepLinkFor: shareable #/es-lab URL (pure — unit-tested). Params: key,
   * values (string array). Returns the hash string. Fails: never throws. */
  function deepLinkFor(key, values) {
    var base = "#/es-lab?q=" + encodeURIComponent(key || "");
    try { base += "&params=" + encodeURIComponent(JSON.stringify(values || [])); }
    catch (e) { /* key-only link stands */ }
    return base;
  }

  /* No local el — use DOM.el */
  /* clearRoot removed — use DOM.clear */

  /* showError: inline error panel, never blank. Same contract as api-lab. */
  function showError(doc, wrap, e) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || "Unexpected error");
    var box = DOM.error(wrap, msg); return box;
  }

  /* entryKey: stable identity for selection/history/deep-link (the catalog
   * key itself — unique by construction). */
  function entryKey(e) { return e.key; }

  /* findEntry: parse a deep-link q value. Params: key string. Returns the
   * template, the RAW pseudo-entry, or null. Fails: never throws. */
  function findEntry(key) {
    if (!key) return null;
    if (isRaw(key)) return { key: RAW_KEY, group: "Raw console", kind: "raw",
      title: t("eslab.console_option", "Raw console (custom JSON)"),
      desc: t("eslab.raw_dsl", "Raw query JSON (mirrors the boxes)"), fields: [] };
    try { return EsLab.byKey(key); } catch (e) { return null; }
  }

  /* readCurated: curated box values in field order. */
  function readCurated(inputEls) {
    return inputEls.map(function (n) { return n ? n.value : ""; });
  }

  /* renderDesk: full browser desk. Params: root. Entry from sticky selection
   * or deep link (?q=key&params=<json array>). Read templates auto-run from
   * deep links; the raw console prefills and waits. */
  function renderDesk(root) {
    var myGen = gen;
    var doc = (typeof document !== "undefined") ? document : null;
    if (!doc || !root) return;
    DOM.clear(root);
    var wrap = DOM.el(doc, "div", null, "wrap wide"); root.appendChild(wrap);

    wrap.appendChild(DOM.pageHead(doc, t("eslab.title", "ES Lab"), "zoom"));
    wrap.appendChild(DOM.el(doc, "p",
      t("eslab.subtitle", "Search the community index by hand: pick a query, fill the boxes, read parsed rows + raw JSON. Reads only — nothing here can move funds."),
      "muted"));
    wrap.appendChild(DOM.el(doc, "p",
      t("eslab.mainnet_only", "Community index covers mainnet only — testnet accounts and new objects may be missing."),
      "muted"));
    var strip = DOM.el(doc, "p", "", "muted");
    wrap.appendChild(strip);

    /* paintStrip: reachability line from best-knowledge state. Never throws. */
    function paintStrip() {
      var s = null;
      try {
        if (typeof HistoryCap !== "undefined" && HistoryCap &&
            typeof HistoryCap.esAvailable === "function") s = HistoryCap.esAvailable();
      } catch (e) { s = null; }
      strip.textContent = (s === true) ? t("eslab.reach_ok", "Index: reachable") :
        (s === false) ? t("eslab.reach_bad", "Index: unreachable") :
        t("eslab.reach_unknown", "Index: not probed yet");
    }
    paintStrip();

    /* Deep link: ?q=key &params=<json array of curated strings>. */
    var q = {};
    try {
      if (typeof Router !== "undefined" && Router && typeof Router.query === "function") q = Router.query() || {};
    } catch (e) { q = {}; }
    var startEntry = (lastQ && findEntry(lastQ)) || null;
    var startVals = null;
    if (q.q && findEntry(q.q)) {
      startEntry = findEntry(q.q);
      if (q.params) {
        try {
          var pv = JSON.parse(q.params);
          if (Array.isArray(pv)) startVals = pv.map(function (v) {
            return (typeof v === "string") ? v : JSON.stringify(v);
          });
        } catch (e) { startVals = null; }
      }
    }
    if (!startEntry) startEntry = EsLab.byKey("fills-by-market");

    /* Template pulldown with group optgroups + filter box. */
    var pickRow = DOM.el(doc, "p", null, null);
    var filter = DOM.el(doc, "input", null, null);
    filter.type = "search"; filter.placeholder = t("eslab.filter", "Filter templates…");
    filter.setAttribute("aria-label", t("eslab.filter", "Filter templates…"));
    var sel = DOM.el(doc, "select", null, null);
    sel.setAttribute("aria-label", t("eslab.template", "Query template"));
    sel.classList.add("touchable");
    pickRow.appendChild(filter); pickRow.appendChild(sel); wrap.appendChild(pickRow);

    function allEntries() {
      var list = EsLab.TEMPLATES.slice();
      list.push({ key: RAW_KEY, group: "Raw console", kind: "raw",
        title: t("eslab.console_option", "Raw console (custom JSON)"), fields: [] });
      return list;
    }

    function fillPick(ftext) {
      DOM.clear(sel);
      var ft = (ftext || "").toLowerCase();
      EsLab.GROUPS.concat(["Raw console"]).forEach(function (g) {
        var og = doc.createElement("optgroup"); og.label = g;
        var any = false;
        allEntries().forEach(function (e) {
          if (e.group !== g) return;
          var label = (e.key === RAW_KEY) ? e.title : (e.title + "  [" + e.index + "]");
          if (ft && (e.key.toLowerCase().indexOf(ft) === -1 &&
              String(label).toLowerCase().indexOf(ft) === -1)) return;
          var o = doc.createElement("option");
          o.value = e.key;
          o.textContent = label;
          if (startEntry && e.key === startEntry.key) o.selected = true;
          og.appendChild(o); any = true;
        });
        if (any) sel.appendChild(og);
      });
    }
    fillPick("");
    filter.addEventListener("input", function () { fillPick(filter.value); });

    var card = DOM.el(doc, "div", null, "card"); wrap.appendChild(card);
    var entry = startEntry;
    var inputEls = [];
    var rawBox = null, rawIndexSel = null, resultPre = null, hintP = null, histBox = null;
    var tablesBox = null;
    var rawOverride = false; /* raw edited since last curated sync — Run sends it verbatim */
    var lastGood = null; /* last runnable body text (mirror keeps it while boxes are invalid) */

    /* renderForm: template card body for the current entry. */
    function renderForm(prefill) {
      DOM.clear(card);
      inputEls = [];
      rawOverride = false;
      lastGood = null;
      card.appendChild(DOM.el(doc, "h2", entry.title || entry.key, null));
      card.appendChild(DOM.el(doc, "p", entry.desc || "", "muted"));
      if (!isRaw(entry.key)) {
        card.appendChild(DOM.el(doc, "p", entry.index + "  ·  " + (entry.sourceRef || ""), "muted"));
      }
      if (isRaw(entry.key)) {
        var idxLab = DOM.el(doc, "label", t("eslab.raw_index", "Index"), null);
        try { idxLab.style.display = "block"; idxLab.style.margin = "10px 0 2px"; } catch (e) { /* stands */ }
        rawIndexSel = doc.createElement("select");
        indexes().forEach(function (ix) {
          var o = doc.createElement("option"); o.value = ix; o.textContent = ix;
          rawIndexSel.appendChild(o);
        });
        if (prefill && prefill[0]) { try { rawIndexSel.value = prefill[0]; } catch (e2) { /* first stands */ } }
        rawIndexSel.classList.add("touchable");
        try { rawIndexSel.style.display = "block"; rawIndexSel.style.marginTop = "4px"; } catch (e) { /* stands */ }
        idxLab.appendChild(rawIndexSel);
        card.appendChild(idxLab);
      }
      (entry.fields || []).forEach(function (p, i) {
        var lab = DOM.el(doc, "label", p.name + (p.required ? " *" : "") + (p.hint ? " — " + p.hint : ""), null);
        try { lab.style.display = "block"; lab.style.margin = "10px 0 2px"; } catch (e) { /* stands */ }
        var inp;
        if (p.type === "json" || p.type === "strlist") {
          inp = doc.createElement("textarea");
          inp.rows = 3;
          inp.value = (prefill && prefill[i] !== undefined) ? prefill[i] : (p.example || "");
        } else {
          inp = doc.createElement("input");
          inp.type = "text";
          if (p.type === "uint") { try { inp.setAttribute("inputmode", "numeric"); } catch (e) { /* stands */ } }
          inp.placeholder = p.example || "";
          inp.value = (prefill && prefill[i] !== undefined) ? prefill[i] : "";
          if (!inp.value && p.example && entry.key === "holders-by-asset") inp.value = p.example;
        }
        inp.classList.add("touchable");
        try { inp.style.display = "block"; inp.style.width = "100%"; inp.style.maxWidth = "560px"; inp.style.boxSizing = "border-box"; inp.style.marginTop = "4px"; } catch (e) { /* stands */ }
        lab.appendChild(inp);
        card.appendChild(lab);
        inputEls.push(inp);
      });
      var rawLab = DOM.el(doc, "label", isRaw(entry.key) ?
        t("eslab.raw_body", "Query body JSON") :
        t("eslab.raw_dsl", "Raw query JSON (mirrors the boxes)"), "subtle-btn");
      rawBox = doc.createElement("textarea"); rawBox.rows = isRaw(entry.key) ? 8 : 4;
      try { rawLab.style.display = "block"; rawLab.style.margin = "10px 0 2px";
        rawBox.style.display = "block"; rawBox.style.width = "100%"; rawBox.style.maxWidth = "560px";
        rawBox.style.boxSizing = "border-box"; rawBox.style.marginTop = "4px";
        rawBox.style.fontFamily = "monospace"; } catch (e) { /* stands */ }
      rawLab.classList.add("touchable");
      if (isRaw(entry.key)) {
        rawBox.value = (prefill && prefill[1] !== undefined) ? prefill[1] :
          "{\n  \"size\": 10,\n  \"query\": { \"match_all\": {} }\n}";
        rawBox.removeAttribute("data-bad");
      } else {
        syncRaw();
      }
      rawLab.appendChild(rawBox); card.appendChild(rawLab);
      inputEls.forEach(function (inp) {
        inp.addEventListener("input", syncRaw);
        inp.addEventListener("change", syncRaw);
      });
      if (!isRaw(entry.key)) rawBox.addEventListener("input", syncCurated);

      var btnRow = DOM.el(doc, "p", null, null);
      var runB = DOM.el(doc, "button", t("eslab.run", "Run"));
      runB.type = "button";
      runB.classList.add("touchable");
      var resetB = DOM.el(doc, "button", t("eslab.reset", "Reset"));
      resetB.type = "button";
      resetB.classList.add("btn-ghost", "touchable");
      var copyB = DOM.el(doc, "button", t("eslab.copy_link", "Copy link"));
      copyB.type = "button";
      copyB.classList.add("btn-ghost", "touchable");
      try { resetB.style.marginLeft = "8px"; copyB.style.marginLeft = "8px"; } catch (e) { /* stands */ }
      runB.addEventListener("click", onRun);
      resetB.addEventListener("click", function () { if (myGen === gen) renderForm(null); });
      copyB.addEventListener("click", function () {
        var link = deepLinkFor(entry.key, readCurated(inputEls));
        try {
          var full = String(window.location).split("#")[0] + link;
          if (doc.defaultView && doc.defaultView.navigator && doc.defaultView.navigator.clipboard) {
            doc.defaultView.navigator.clipboard.writeText(full);
          }
        } catch (e) { /* clipboard unavailable — link is in the bar */ }
        showResult({ ok: true, raw: { note: t("eslab.link_copied", "Shareable link ready (also in the address bar after Run)."), link: link } }, true);
      });
      btnRow.appendChild(runB); btnRow.appendChild(resetB); btnRow.appendChild(copyB);
      card.appendChild(btnRow);

      tablesBox = DOM.el(doc, "div", null, null);
      card.appendChild(tablesBox);

      resultPre = DOM.el(doc, "pre", t("eslab.no_result", "No result yet — fill the boxes and press Run."), null);
      try { resultPre.style.whiteSpace = "pre-wrap"; resultPre.style.wordBreak = "break-word"; } catch (e) { /* stands */ }
      card.appendChild(resultPre);
      hintP = DOM.el(doc, "p", "", "muted"); card.appendChild(hintP);

      histBox = DOM.el(doc, "div", null, null);
      card.appendChild(histBox);
      renderHistory();
    }

    /* syncRaw: curated boxes -> raw mirror. Success shows the runnable
     * body; failure keeps the last runnable body (or {} before the first
     * one) and flags data-bad — the mirror always answers "what will Run
     * send", never echoes invalid boxes. Never throws. */
    function syncRaw() {
      if (!rawBox || isRaw(entry.key)) return;
      var vals = readCurated(inputEls);
      try {
        rawBox.value = JSON.stringify(EsLab.build(entry, vals).body, null, 2);
        rawBox.removeAttribute("data-bad");
        rawOverride = false;
        lastGood = rawBox.value;
      } catch (e) {
        rawBox.value = (lastGood !== null) ? lastGood : "{}";
        rawBox.setAttribute("data-bad", (e && e.message) || "bad params");
        rawOverride = false;
      }
    }

    /* syncCurated: raw mirror -> curated boxes via EsLab.fromBody.
     * Unrecognized bodies keep the raw override flag (Run sends verbatim). */
    function syncCurated() {
      if (!rawBox || isRaw(entry.key)) return;
      var parsed;
      try { parsed = JSON.parse(rawBox.value); } catch (e) { rawOverride = true; return; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { rawOverride = true; return; }
      var back = null;
      try { back = EsLab.fromBody(entry, parsed); } catch (e) { back = null; }
      if (!back) { rawOverride = true; return; }
      for (var i = 0; i < inputEls.length && i < back.length; i++) {
        inputEls[i].value = back[i];
      }
      rawBox.removeAttribute("data-bad");
      rawOverride = false;
    }

    /* showResult: raw <pre> always + parsed tables/honest panels via
     * EsLabResults (missing renderer degrades to raw-only — the stub
     * contract). Params: outcome {ok, kind, rows, json/raw, error,
     * precMap}, isNote. */
    function showResult(outcome, isNote) {
      if (!resultPre) return;
      try {
        resultPre.textContent = JSON.stringify(outcome.ok ?
          (outcome.json === undefined ? outcome.raw : outcome.json) :
          { error: (outcome.error && outcome.error.message) || String(outcome.error) }, null, 2);
      } catch (e) { resultPre.textContent = String(outcome.json || outcome.raw || outcome.error); }
      if (tablesBox) { DOM.clear(tablesBox); }
      if (!isNote) {
        try {
          if (typeof EsLabResults !== "undefined" && EsLabResults &&
              typeof EsLabResults.render === "function" && tablesBox) {
            EsLabResults.render(doc, tablesBox, entry, outcome, { precMap: outcome.precMap || null,
              onRetry: function () { if (myGen === gen) onRun(); },
              setHint: function (s) { if (hintP) hintP.textContent = s; } });
          }
        } catch (e) { /* raw pre above still stands */ }
      } else if (hintP) { hintP.textContent = ""; }
      paintStrip();
    }

    /* renderHistory: in-session run buttons (re-load entry+params). */
    function renderHistory() {
      if (!histBox) return;
      DOM.clear(histBox);
      if (!callLog.length) return;
      histBox.appendChild(DOM.el(doc, "h4", t("eslab.history", "This session")));
      callLog.forEach(function (h) {
        var b = DOM.el(doc, "button", h.label, null);
        b.type = "button";
        b.addEventListener("click", function () {
          var e = findEntry(h.key);
          if (!e || myGen !== gen) return;
          entry = e; lastQ = h.key;
          sel.value = h.key;
          renderForm(h.vals);
        });
        histBox.appendChild(b);
      });
    }

    function pushHistory(label, key, vals) {
      callLog.unshift({ label: label, key: key, vals: vals });
      if (callLog.length > HISTORY_MAX) callLog.length = HISTORY_MAX;
      renderHistory();
    }

    /* accountField: index of the "account" field, or -1. */
    function accountField() {
      var fs = entry.fields || [];
      for (var i = 0; i < fs.length; i++) if (fs[i].name === "account") return i;
      return -1;
    }

    /* onRun: resolve names, then execute. Raw console sends its body verbatim. */
    function onRun() {
      if (myGen !== gen) return;
      if (isRaw(entry.key)) {
        var idx = rawIndexSel ? rawIndexSel.value : indexes()[0];
        var parsed;
        try { parsed = JSON.parse(rawBox.value); } catch (e) {
          showError(doc, card, new Error(t("eslab.bad_json", "Bad JSON — fix the raw body; nothing was sent.")));
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          showError(doc, card, new Error(t("eslab.bad_json", "Bad JSON — fix the raw body; nothing was sent.")));
          return;
        }
        doRawRun(idx, parsed, [idx, rawBox.value]);
        return;
      }
      var vals = readCurated(inputEls);
      var ai = accountField();
      if (ai !== -1 && vals[ai] && !ACCOUNT_RE.test(vals[ai])) {
        var note = DOM.el(doc, "p", t("eslab.resolving", "Resolving account name…"), "muted");
        note.setAttribute("aria-live", "polite"); card.appendChild(note);
        EsLabRun.resolveAccount(vals[ai]).then(function (id) {
          if (myGen !== gen) return;
          try { note.remove(); } catch (e) { /* stands */ }
          vals[ai] = id;
          try { if (inputEls[ai]) inputEls[ai].value = id; } catch (e2) { /* stands */ }
          syncRaw();
          doRun(vals);
        }).catch(function (e) {
          if (myGen !== gen) return;
          try { note.remove(); } catch (e2) { /* stands */ }
          showError(doc, card, new Error(t("eslab.unknown_account", "Unknown account — use a 1.2.x id or check spelling.")));
        });
        return;
      }
      /* Raw override: user hand-edited the DSL into an unrecognized shape —
       * send it verbatim against this template's index (never re-coerced). */
      if (rawOverride) {
        var over;
        try { over = JSON.parse(rawBox.value); } catch (e) {
          showError(doc, card, new Error(t("eslab.bad_json", "Bad JSON — fix the raw body; nothing was sent.")));
          return;
        }
        if (!over || typeof over !== "object" || Array.isArray(over)) {
          showError(doc, card, new Error(t("eslab.bad_json", "Bad JSON — fix the raw body; nothing was sent.")));
          return;
        }
        doRawRun(entry.index, over, vals);
        return;
      }
      doRun(vals);
    }

    /* wantFor: row cap for paged runs (holder lookups stop at the asked
     * limit — no extra page fetch; scans take the full 1000). */
    function wantFor(vals) {
      if (entry.key === "holders-by-asset" || entry.key === "balances-by-account") {
        var fs = entry.fields || [];
        for (var i = 0; i < fs.length; i++) {
          if (fs[i].name === "limit" && vals[i] && /^[0-9]+$/.test(vals[i])) {
            return Math.min(parseInt(vals[i], 10), 100);
          }
        }
      }
      return 1000;
    }

    /* withPrecisions: desk-side wrapper (gen-safety + fail-soft at the call
     * site). The lookup itself is EsLabRun.precMap (socket reads live in
     * the run layer). Params: vals, rows, done(precMap). Never throws. */
    function withPrecisions(vals, rows, done) {
      function empty() { try { done({}); } catch (e) { /* stands */ } }
      if (kindOf(entry.key) !== "holders") { empty(); return; }
      var P = null;
      try {
        P = (typeof EsLabRun !== "undefined" && EsLabRun &&
          typeof EsLabRun.precMap === "function") ? EsLabRun.precMap(entry.key, vals, rows) : null;
      } catch (e) { P = null; }
      if (!P) { empty(); return; }
      P.then(function (map) {
        if (myGen !== gen) return;
        try { done(map || {}); } catch (e) { /* stands */ }
      }, function () {
        if (myGen !== gen) return;
        empty();
      });
    }

    /* doRun: template run (paged for row kinds, single for agg) + deep-link
     * the URL (replaceState: no re-render) + history push. */
    function doRun(vals) {
      var running = DOM.el(doc, "p", t("eslab.running", "Running…"), "muted");
      running.setAttribute("aria-live", "polite"); card.appendChild(running);
      var call = (entry.kind === "agg") ?
        EsLabRun.run(entry.key, vals, {}) :
        EsLabRun.runPaged(entry.key, vals, { want: wantFor(vals) });
      call.then(function (res) {
        if (myGen !== gen) return;
        try { running.remove(); } catch (e) { /* stands */ }
        withPrecisions(vals, res.rows, function (precMap) {
          if (myGen !== gen) return;
          showResult({ ok: true, kind: entry.kind, rows: res.rows, json: res.json, precMap: precMap }, false);
          try {
            var wh = (typeof window !== "undefined") ? window.history : null;
            if (wh && wh.replaceState) wh.replaceState(null, "", deepLinkFor(entry.key, vals));
          } catch (e) { /* URL stands */ }
          pushHistory(entry.title || entry.key, entry.key, vals.slice());
        });
      }).catch(function (e) {
        if (myGen !== gen) return;
        try { running.remove(); } catch (e2) { /* stands */ }
        showResult({ ok: false, error: e }, false);
      });
    }

    /* doRawRun: verbatim body against an index (console + override path).
     * Task 6 renders parsed rows where possible; this stub shows raw. */
    function doRawRun(index, body, vals) {
      var running = DOM.el(doc, "p", t("eslab.running", "Running…"), "muted");
      running.setAttribute("aria-live", "polite"); card.appendChild(running);
      var HC = null;
      try {
        if (typeof HistoryCap !== "undefined" && HistoryCap &&
            typeof HistoryCap.esSearch === "function") HC = HistoryCap;
      } catch (e) { HC = null; }
      if (!HC) {
        try { running.remove(); } catch (e) { /* stands */ }
        showResult({ ok: false, error: new Error("es-unavailable") }, false);
        return;
      }
      HC.esSearch(index, body, { timeoutMs: 15000 }).then(function (json) {
        if (myGen !== gen) return;
        try { running.remove(); } catch (e) { /* stands */ }
        showResult({ ok: true, kind: "raw", rows: null, json: json }, false);
        try {
          var wh = (typeof window !== "undefined") ? window.history : null;
          if (wh && wh.replaceState) wh.replaceState(null, "", deepLinkFor(RAW_KEY, vals));
        } catch (e) { /* URL stands */ }
        pushHistory(t("eslab.console_option", "Raw console (custom JSON)"), RAW_KEY, vals.slice());
      }).catch(function (e) {
        if (myGen !== gen) return;
        try { running.remove(); } catch (e2) { /* stands */ }
        showResult({ ok: false, error: e }, false);
      });
    }

    sel.addEventListener("change", function () {
      var e = findEntry(sel.value);
      if (!e || myGen !== gen) return;
      entry = e; lastQ = entryKey(e);
      renderForm(null);
    });

    lastQ = entry.key;
    renderForm(startVals);
    /* Deep-link auto-run (spec §6.5): read templates execute on entry so
     * shareable links show results, not just prefilled boxes. Safe: reads
     * only, no signing path exists on this desk. Raw console always waits. */
    if (q.q && startEntry && !isRaw(startEntry.key) && myGen === gen) {
      onRun();
    }
  }

  /* renderLab: route entry — bumps gen, delegates to renderDesk. */
  function renderLab(root) {
    gen += 1;
    renderDesk(root);
  }

  return { renderLab: renderLab,
    _test: { kindOf: kindOf, hrefFor: hrefFor, deepLinkFor: deepLinkFor, RAW_KEY: RAW_KEY } };
})();

if (typeof module !== "undefined") { module.exports = EsLabUI; }
