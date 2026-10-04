/* ApiLabUI: the #/api-lab node-prober desk (Swagger feel, retro skin).
 * Owns: DOM for #/api-lab — advanced-use gate modal, method pulldown
 *   (optgroups per catalog group) + search, curated param boxes, raw-JSON
 *   mirror (both directions), Run/Reset/Copy-link, result pane (raw <pre> +
 *   human-hint line), in-session history, deep-link read/write via
 *   Router.query + replaceState (no re-render), broadcast unlock+confirm.
 * Consumes: ApiLab (catalog/coerce/run — the ONLY chain path, via
 *   Chain.call inside), Chain.status (connect gate + connection strip),
 *   Store (connection subscribe for auto-rerun), Router.query (deep link),
 *   Wallet.isUnlocked (broadcast gate only — reads never gate on unlock),
 *   I18n.t (verbatim en defaults, slice-17 precedent).
 * Globals/side effects: DOM under the router root only; global ApiLabUI;
 *   per-session gate flags (never persisted — a fresh visit always warns).
 *   Generation counter tears down stale async work on route change
 *   (fees-ui.js pattern). textContent-only insertion throughout (chain
 *   strings never reach HTML).
 * Created by: api-lab design 2026-10-03 (Option B), AFK build.
 * Refs: Console.jsx:7-22 (eval anti-pattern — never copied); ops-ui.js
 *   waitForOpen/showError (connect-gate pattern); database_api.hpp + api.hpp
 *   line refs live in api-lab.js (the catalog owns provenance).
 */
var ApiLabUI = (function () {
  "use strict";

  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  var gen = 0;
  var CONNECT_TIMEOUT_MS = 15000;
  var HISTORY_MAX = 20;
  var gateOk = false; /* per-session advanced-use ack (never persisted) */
  var escalated = {}; /* per-session per-tier escalation ack */
  var callLog = []; /* in-session runs, newest first */
  var lastN = null; /* sticky selection {login, method} for the session */

  /* Per-method human-hint text (principle #6): raw stays raw; the hint tells
   * the reader how to read it. Unknown shapes get the generic line. */
  var HINTS = {
    get_account_balances: "Amounts are raw integers — divide by the asset precision (BTS: 5).",
    get_named_account_balances: "Amounts are raw integers — divide by the asset precision.",
    get_vested_balances: "Amounts are raw integers — divide by the asset precision.",
    get_required_fees: "Fees are raw integers in the fee asset — divide by its precision.",
    get_ticker: "Prices are raw ratios — see base/quote precisions.",
    get_24_volume: "Volumes are raw ratios — see base/quote precisions.",
    get_order_book: "Order amounts/prices are raw integers — see asset precisions.",
    get_trade_history: "Fill amounts/prices are raw integers — see asset precisions.",
    get_fill_order_history: "Fill amounts are raw integers — see asset precisions.",
    get_market_history: "OHLCV open/high/low/close/volume are raw integers — see asset precisions.",
    get_full_accounts: "Bundle carries raw balances, orders, and proposals — amounts are integers.",
    get_asset_holders: "Balances are raw integers — divide by the asset precision.",
    get_dynamic_global_properties: "Head block + chain time; participation is a bitmask share.",
    get_account_history: "History entries carry raw op payloads — amounts are integers."
  };
  var GENERIC_HINT = "Raw node JSON above, untouched. Integer amounts divide by asset precision; percent fields are hundredths of a percent (2000 = 20%).";

  /* showError: inline error panel, never blank. Same contract as ops-ui. */
  function showError(doc, wrap, e) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || "Unexpected error");
    if (msg.indexOf("not connected") !== -1 || msg.indexOf("not-connected") !== -1) {
      msg = "Network unavailable. Check Settings → Nodes and retry.";
    }
    var box = DOM.error(wrap, msg);
    return box;
  }

  /* waitForOpen: connect gate (ops-ui.js pattern) — cold socket paints a
   * connecting panel with Retry and auto-reruns once on open. */
  function waitForOpen(doc, wrap, root, myGen, rerun) {
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state === "open") return false;
    DOM.status(wrap, t("apilab.connecting", "Connecting to network…")).className = "muted";
    var astat = DOM.el(doc, "p", "", "muted");
    try { astat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    DOM.append(wrap, astat);
    var arow = DOM.el(doc, "div", null, "pools-offline-row");
    DOM.append(wrap, arow);
    var retry = DOM.el(doc, "button", t("apilab.retry", "Retry"));
    retry.classList.add("touchable");
    retry.type = "button"; DOM.append(arow, retry);
    var aoff = null;
    try { aoff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { aoff = null; }
    var arerun = function () {
      if (!settled) { settled = true; try { off(); } catch (e) { /* gone */ } clearTimeout(timer); }
      if (myGen === gen) rerun();
    };
    if (aoff && typeof aoff.wire === "function") {
      try { aoff.wire(retry, astat, arerun, t); } catch (e) { retry.addEventListener("click", arerun); }
    } else {
      retry.addEventListener("click", arerun);
    }
    var alink = null;
    if (aoff && typeof aoff.settingsLink === "function") {
      try { alink = aoff.settingsLink(doc, t); } catch (e) { alink = null; }
    }
    if (!alink) {
      alink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
      try { alink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
      alink.classList.add("touchable");
    }
    DOM.append(arow, alink);
    var settled = false, off = function () {};
    if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
      off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; try { off(); } catch (e) { /* gone */ }
          clearTimeout(timer);
          rerun();
        }
      });
    }
    var timer = setTimeout(function () {
      if (settled || myGen !== gen) return;
      settled = true; try { off(); } catch (e) { /* gone */ }
    }, CONNECT_TIMEOUT_MS);
    /* Automated handshake on entry (shared Offline helper owns the throttle;
     * Retry is wired via Offline.wire above). */
    try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
    return true;
  }

  /* entryKey: stable identity for selection/history/deep-link. */
  function entryKey(e) { return e.login + "::" + e.method; }

  /* findEntry: parse "login::method" or bare method (first match). */
  function findEntry(key) {
    if (!key) return null;
    var parts = String(key).split("::");
    if (parts.length === 2) return ApiLab.byMethod(parts[1], parts[0]);
    return ApiLab.byMethod(parts[0], null);
  }

  /* syncRawFromCurated: serialize curated boxes -> raw mirror. Never throws
   * (coercion errors surface as raw-text + Run reports them). */
  function readCurated(inputEls, entry) {
    return inputEls.map(function (n) { return n ? n.value : ""; });
  }

  /* needsEscalation: broadcast/debug tiers need the per-session escalation
   * ack on top of the entry gate. Params: entry. Returns boolean. */
  function needsEscalation(entry) {
    if (!entry) return false;
    if (entry.tier === ApiLab.TIERS.broadcast || entry.tier === ApiLab.TIERS.debug) {
      return !escalated[entry.tier];
    }
    return false;
  }

  /* renderGate: the advanced-use modal. Params: doc, wrap, root, myGen,
   * onAck (continuation). Per-session only — never written to storage. */
  function renderGate(doc, wrap, root, myGen, onAck, tier) {
    DOM.clear(wrap);
    var box = DOM.el(doc, "div", null, "card");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-label", t("apilab.gate_title", "Advanced tool — confirm you understand"));
    DOM.append(box, DOM.el(doc, "h1", t("apilab.gate_title", "Advanced tool — confirm you understand")));
    var body = tier === "broadcast"
      ? t("apilab.gate_broadcast", "Broadcasting sends a REAL signed transaction on the connected chain. Only proceed if you built and reviewed the transaction yourself and you know which chain (mainnet or testnet) you are on.")
      : tier === "debug"
      ? t("apilab.gate_debug", "Debug and node-maintenance calls are usually DISABLED on public API nodes. Expect rejections — the rejection is the honest result, not a bug in this page.")
      : t("apilab.gate_body", "This page sends hand-built API calls to a public node and shows raw chain JSON. Reads are safe; broadcasts move real funds. Only proceed if you know what you are doing.");
    DOM.append(box, DOM.el(doc, "p", body));
    var row = DOM.el(doc, "p", null, null);
    var ack = DOM.el(doc, "button", t("apilab.gate_ack", "I understand — open the API lab"));
    ack.type = "button";
    ack.classList.add("touchable");
    var back = DOM.el(doc, "a", t("apilab.gate_back", "Back to Explorer"));
    back.href = "#/explorer";
    back.classList.add("btn-ghost", "touchable");
    try { back.style.display = "inline-flex"; back.style.alignItems = "center"; back.style.marginLeft = "12px"; } catch (e) { /* stands */ }
    ack.addEventListener("click", function () {
      if (myGen !== gen) return;
      if (tier) escalated[tier] = true; else gateOk = true;
      onAck();
    });
    DOM.append(row, ack); DOM.append(row, back); DOM.append(box, row);
    DOM.append(wrap, box);
  }

  /* renderDesk: full prober desk. Params: root. Entry from sticky selection
   * or deep link (?by=login::method&params=<json>). Broadcast deep links
   * load prefilled + locked (never auto-run). */
  function renderDesk(root) {
    var myGen = gen;
    var doc = (typeof document !== "undefined") ? document : null;
    if (!doc || !root) return;
    DOM.clear(root);
    var wrap = DOM.append(root, DOM.el(doc, "div", null, "wrap wide"));

    function proceed() { if (myGen === gen) renderDesk(root); }
    if (!gateOk) { renderGate(doc, wrap, root, myGen, proceed, null); return; }
    if (waitForOpen(doc, wrap, root, myGen, proceed)) return;

    DOM.append(wrap, DOM.el(doc, "h1", t("apilab.title", "API Lab")));
    DOM.append(wrap, DOM.el(doc, "p",
      t("apilab.subtitle", "Probe the connected node by hand: pick a method, fill the boxes, read raw JSON. Reads are safe; broadcast moves real funds."),
      "muted"));
    var st = { state: "unknown", node: null };
    try { st = Chain.status() || st; } catch (e) { /* strip stands */ }
    var strip = DOM.el(doc, "p",
      t("apilab.connected_to", "Connected node: ") + (st.node || "?"), "muted");
    DOM.append(wrap, strip);

    /* Deep link: ?by=login::method &params=<json array>. */
    var q = {};
    try {
      if (typeof Router !== "undefined" && Router && typeof Router.query === "function") q = Router.query() || {};
    } catch (e) { q = {}; }
    var startEntry = (lastN && findEntry(lastN)) || null;
    var startVals = null;
    if (q.by && findEntry(q.by)) {
      startEntry = findEntry(q.by);
      if (q.params) {
        try {
          var pv = JSON.parse(q.params);
          if (Array.isArray(pv)) startVals = pv.map(function (v) {
            return (typeof v === "string") ? v : JSON.stringify(v);
          });
        } catch (e) { startVals = null; }
      }
    }
    if (!startEntry) startEntry = ApiLab.byMethod("get_account_by_name", "database") || ApiLab.METHODS[0];

    /* Method pulldown with group optgroups + filter box. */
    var pickRow = DOM.el(doc, "p", null, null);
    var filter = DOM.el(doc, "input", null, null);
    filter.type = "search"; filter.placeholder = t("apilab.filter", "Filter methods…");
    filter.setAttribute("aria-label", t("apilab.filter", "Filter methods…"));
    var sel = DOM.el(doc, "select", null, null);
    sel.setAttribute("aria-label", t("apilab.method", "API method"));
    sel.classList.add("touchable");
    DOM.append(pickRow, filter); DOM.append(pickRow, sel); DOM.append(wrap, pickRow);

    function fillPick(ftext) {
      DOM.clear(sel);
      var ft = (ftext || "").toLowerCase();
      ApiLab.GROUPS.forEach(function (g) {
        var og = doc.createElement("optgroup"); og.label = g;
        var any = false;
        ApiLab.METHODS.forEach(function (e) {
          if (e.group !== g) return;
          if (ft && e.method.toLowerCase().indexOf(ft) === -1) return;
          var o = doc.createElement("option");
          o.value = entryKey(e);
          o.textContent = e.method + "  [" + e.tier + "]";
          if (startEntry && entryKey(e) === entryKey(startEntry)) o.selected = true;
          og.appendChild(o); any = true;
        });
        if (any) sel.appendChild(og);
      });
    }
    fillPick("");
    filter.addEventListener("input", function () { fillPick(filter.value); });

    var card = DOM.el(doc, "div", null, "card"); DOM.append(wrap, card);
    var entry = startEntry;
    var inputEls = [];
    var rawBox = null, resultPre = null, hintP = null, histBox = null;

    /* renderForm: method card body for the current entry. */
    function renderForm(prefill) {
      DOM.clear(card);
      inputEls = [];
      DOM.append(card, DOM.el(doc, "h2", entry.method, null));
      DOM.append(card, DOM.el(doc, "p", entry.desc || "", "muted"));
      var meta = DOM.el(doc, "p", (entry.login || "") + "  ·  " + (entry.src || "") + "  ·  tier: " + entry.tier, "muted");
      DOM.append(card, meta);
      (entry.params || []).forEach(function (p, i) {
        var lab = DOM.el(doc, "label", p.name + (p.required ? " *" : "") + (p.hint ? " — " + p.hint : ""), null);
        /* Stacked rows (Swagger feel): label text on its own line, box below.
         * Inline styles only — no new CSS file (doctrine). */
        try { lab.style.display = "block"; lab.style.margin = "10px 0 2px"; } catch (e) { /* stands */ }
        var inp;
        if (p.type === "bool") {
          inp = doc.createElement("select");
          if (!p.required) {
            var bo = doc.createElement("option"); bo.value = ""; bo.textContent = "—";
            inp.appendChild(bo);
          }
          var to = doc.createElement("option"); to.value = "true"; to.textContent = "true";
          var fo = doc.createElement("option"); fo.value = "false"; fo.textContent = "false";
          inp.appendChild(to); inp.appendChild(fo);
          inp.value = (prefill && prefill[i]) || p.example || (p.required ? "false" : "");
        } else if (p.type === "json" || p.type === "strlist") {
          inp = doc.createElement("textarea");
          inp.rows = 3;
          inp.value = (prefill && prefill[i] !== undefined) ? prefill[i] : (p.example || "");
        } else {
          inp = doc.createElement("input");
          inp.type = "text";
          if (p.type === "uint" || p.type === "int") { try { inp.inputMode = "numeric"; } catch (e) { /* stands */ } }
          inp.placeholder = p.example || "";
          inp.value = (prefill && prefill[i] !== undefined) ? prefill[i] : "";
          if (!inp.value && p.example && (entry.method === "get_account_by_name" || entry.method === "get_chain_id")) inp.value = p.example;
        }
        inp.classList.add("touchable");
        try { inp.style.display = "block"; inp.style.width = "100%"; inp.style.maxWidth = "560px"; inp.style.boxSizing = "border-box"; inp.style.marginTop = "4px"; } catch (e) { /* stands */ }
        lab.appendChild(inp);
        DOM.append(card, lab);
        inputEls.push(inp);
      });
      var rawLab = DOM.el(doc, "label", t("apilab.raw_params", "Raw params JSON (mirrors the boxes)"), "subtle-btn");
      rawBox = doc.createElement("textarea"); rawBox.rows = 3;
      try { rawLab.style.display = "block"; rawLab.style.margin = "10px 0 2px";
        rawBox.style.display = "block"; rawBox.style.width = "100%"; rawBox.style.maxWidth = "560px";
        rawBox.style.boxSizing = "border-box"; rawBox.style.marginTop = "4px"; } catch (e) { /* stands */ }
      rawLab.classList.add("touchable");
      rawLab.appendChild(rawBox); DOM.append(card, rawLab);
      syncRaw();
      inputEls.forEach(function (inp) {
        inp.addEventListener("input", syncRaw);
        inp.addEventListener("change", syncRaw);
      });
      rawBox.addEventListener("input", syncCurated);

      var btnRow = DOM.el(doc, "p", null, null);
      var runB = DOM.el(doc, "button", t("apilab.run", "Run"));
      runB.type = "button";
      runB.classList.add("touchable");
      var resetB = DOM.el(doc, "button", t("apilab.reset", "Reset"));
      resetB.type = "button";
      resetB.classList.add("btn-ghost", "touchable");
      var copyB = DOM.el(doc, "button", t("apilab.copy_link", "Copy link"));
      copyB.type = "button";
      copyB.classList.add("btn-ghost", "touchable");
      try { resetB.style.marginLeft = "8px"; copyB.style.marginLeft = "8px"; } catch (e) { /* stands */ }
      runB.addEventListener("click", onRun);
      resetB.addEventListener("click", function () { if (myGen === gen) renderForm(null); });
      copyB.addEventListener("click", function () {
        var link = deepLink();
        try {
          if (doc.defaultView && doc.defaultView.navigator && doc.defaultView.navigator.clipboard) {
            doc.defaultView.navigator.clipboard.writeText(link);
          }
        } catch (e) { /* clipboard unavailable — link is in the bar */ }
        try { window.location.hash; } catch (e2) { /* no-op */ }
        showResult({ ok: true, result: { note: "shareable link (also in the address bar after Run)", link: link } }, true);
      });
      DOM.append(btnRow, runB); DOM.append(btnRow, resetB); DOM.append(btnRow, copyB);
      DOM.append(card, btnRow);

      resultPre = DOM.el(doc, "pre", t("apilab.no_result", "No result yet — fill the boxes and press Run."), null);
      try { resultPre.style.whiteSpace = "pre-wrap"; resultPre.style.wordBreak = "break-word"; } catch (e) { /* stands */ }
      DOM.append(card, resultPre);
      hintP = DOM.el(doc, "p", "", "muted"); DOM.append(card, hintP);

      histBox = DOM.el(doc, "div", null, null);
      DOM.append(card, histBox);
      renderHistory();
    }

    /* syncRaw: curated boxes -> raw mirror. */
    function syncRaw() {
      if (!rawBox) return;
      var vals = readCurated(inputEls, entry);
      try {
        rawBox.value = JSON.stringify(ApiLab.coerce(entry, vals), null, 2);
        rawBox.removeAttribute("data-bad");
      } catch (e) {
        rawBox.value = JSON.stringify(vals);
        rawBox.setAttribute("data-bad", (e && e.message) || "bad params");
      }
    }

    /* syncCurated: raw mirror -> curated boxes (best effort). */
    function syncCurated() {
      if (!rawBox) return;
      var parsed;
      try { parsed = JSON.parse(rawBox.value); } catch (e) { return; }
      if (!Array.isArray(parsed)) return;
      for (var i = 0; i < inputEls.length && i < parsed.length; i++) {
        var v = parsed[i];
        inputEls[i].value = (typeof v === "string") ? v : JSON.stringify(v);
      }
      rawBox.removeAttribute("data-bad");
    }

    /* deepLink: shareable #/api-lab URL for the current entry+params. */
    function deepLink() {
      var vals = readCurated(inputEls, entry);
      var base = "#/api-lab?by=" + encodeURIComponent(entryKey(entry));
      try { base += "&params=" + encodeURIComponent(JSON.stringify(vals)); }
      catch (e) { /* boxes stand without params */ }
      return base;
    }

    /* showResult: raw JSON <pre> + hint line. Params: outcome, isNote. */
    function showResult(outcome, isNote) {
      if (!resultPre) return;
      try {
        resultPre.textContent = JSON.stringify(outcome.ok ? outcome.result : { error: (outcome.error && outcome.error.message) || String(outcome.error) }, null, 2);
      } catch (e) { resultPre.textContent = String(outcome.result || outcome.error); }
      if (hintP) hintP.textContent = isNote ? "" : (HINTS[entry.method] || GENERIC_HINT);
    }

    /* renderHistory: in-session run buttons (re-load entry+params). */
    function renderHistory() {
      if (!histBox) return;
      DOM.clear(histBox);
      if (!callLog.length) return;
      DOM.append(histBox, DOM.el(doc, "h4", t("apilab.history", "This session")));
      callLog.forEach(function (h) {
        var b = DOM.el(doc, "button", h.label, null);
        b.type = "button";
        b.addEventListener("click", function () {
          var e = findEntry(h.key);
          if (!e || myGen !== gen) return;
          entry = e; lastN = h.key;
          sel.value = h.key;
          renderForm(h.vals);
        });
        DOM.append(histBox, b);
      });
    }

    function pushHistory(label, key, vals) {
      callLog.unshift({ label: label, key: key, vals: vals });
      if (callLog.length > HISTORY_MAX) callLog.length = HISTORY_MAX;
      renderHistory();
    }

    /* onRun: tier gates then execute. Broadcast needs unlock + inline
     * confirm; debug/broadcast need the escalation ack first. */
    function onRun() {
      if (myGen !== gen) return;
      if (needsEscalation(entry)) {
        renderGate(doc, wrap, root, myGen, proceed, entry.tier);
        return;
      }
      var vals = readCurated(inputEls, entry);
      if (entry.tier === ApiLab.TIERS.broadcast) {
        var unlocked = false;
        try { unlocked = (typeof Wallet !== "undefined" && Wallet && typeof Wallet.isUnlocked === "function") ? Wallet.isUnlocked() : false; }
        catch (e) { unlocked = false; }
        if (!unlocked) {
          showError(doc, card, new Error(t("apilab.locked", "Wallet is locked — unlock first (top-bar lock), then confirm this broadcast.")));
          var go = DOM.el(doc, "p", null, null);
          var a = doc.createElement("a"); a.href = "#/login";
          a.textContent = t("apilab.go_login", "Go to Login");
          try { a.style.display = "inline-flex"; a.style.alignItems = "center"; a.style.minHeight = "44px"; } catch (e2) { /* stands */ }
          DOM.append(go, a); DOM.append(card, go);
          return;
        }
        var box = DOM.el(doc, "div", null, "card");
        DOM.append(box, DOM.el(doc, "h4", t("apilab.confirm_broadcast", "Confirm broadcast (real transaction)")));
        var pre = DOM.el(doc, "pre", null, null);
        try {
          pre.textContent = JSON.stringify(ApiLab.coerce(entry, vals), null, 2);
          pre.style.whiteSpace = "pre-wrap"; pre.style.wordBreak = "break-word";
        } catch (e) { pre.textContent = vals.join(", "); }
        DOM.append(box, pre);
        var row = DOM.el(doc, "p", null, null);
        var yes = DOM.el(doc, "button", t("apilab.confirm_yes", "Broadcast now"));
        yes.type = "button";
        yes.classList.add("touchable");
        var no = DOM.el(doc, "button", t("apilab.confirm_no", "Cancel"));
        no.type = "button";
        no.classList.add("btn-ghost", "touchable");
        try { no.style.marginLeft = "8px"; } catch (e) { /* stands */ }
        no.addEventListener("click", function () { try { box.remove(); } catch (e) { /* stands */ } });
        yes.addEventListener("click", function () {
          try { box.remove(); } catch (e) { /* stands */ }
          doRun(vals);
        });
        DOM.append(row, yes); DOM.append(row, no); DOM.append(box, row);
        DOM.append(card, box);
        return;
      }
      doRun(vals);
    }

    /* doRun: execute + render + deep-link the URL (replaceState: no
     * re-render) + history push. Broadcast deep links were prefilled+locked
     * by construction (we never auto-run on entry). */
    function doRun(vals) {
      var running = DOM.el(doc, "p", t("apilab.running", "Running…"), "muted");
      running.setAttribute("aria-live", "polite"); DOM.append(card, running);
      ApiLab.run(entry, vals).then(function (res) {
        if (myGen !== gen) return;
        try { running.remove(); } catch (e) { /* stands */ }
        showResult({ ok: true, result: res }, false);
        try {
          var wh = (typeof window !== "undefined") ? window.history : null;
          if (wh && wh.replaceState) wh.replaceState(null, "", deepLink());
        } catch (e) { /* URL stands */ }
        pushHistory(entry.method, entryKey(entry), vals.slice());
      }).catch(function (e) {
        if (myGen !== gen) return;
        try { running.remove(); } catch (e2) { /* stands */ }
        showResult({ ok: false, error: e }, false);
      });
    }

    sel.addEventListener("change", function () {
      var e = findEntry(sel.value);
      if (!e || myGen !== gen) return;
      entry = e; lastN = entryKey(e);
      if (needsEscalation(entry)) {
        renderGate(doc, wrap, root, myGen, proceed, entry.tier);
        return;
      }
      renderForm(null);
    });

    lastN = entryKey(entry);
    renderForm(startVals);
  }

  /* renderLab: route entry — bumps gen, delegates to renderDesk. */
  function renderLab(root) {
    gen += 1;
    renderDesk(root);
  }

  return { renderLab: renderLab };
})();