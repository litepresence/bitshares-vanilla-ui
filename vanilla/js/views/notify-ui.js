/* notify-ui.js — #/alerts view (rule CRUD + permission + toggles).
 * Owns: the #/alerts renderer (rule list grouped by pair, add-rule form with
 *   latest-price + precision validation, permission section with honest
 *   unsupported/denied fallback, settings-delegated toggles). Toast-stack
 *   hosting, the market-desk bell, and shared el/touchable helpers live in
 *   notify-host.js (cap-breach split, behavior-identical move); this view
 *   consumes them and keeps thin mountToasts/bellFor aliases so existing
 *   callers keep working.
 * Consumes: Notify (queue/prefs/browser gate — never touches Chain/Tx),
 *   NotifyRules (rule CRUD + engine + sweep), NotifyHost (el/touchable,
 *   mountToasts, two-counter live mark), Market (best-effort latest-price +
 *   precisions, guarded so a missing or offline backend degrades to
 *   "waiting for price", never a crash).
 * Globals/side effects: DOM under the router root; per-render async fills are
 *   gen-guarded (own gen) AND host-guarded (NotifyHost.mark/live two-counter,
 *   pool-detail-ui.js precedent) so a stale route never paints. Global
 *   NotifyUI only (+ mountToasts/bellFor back-compat aliases).
 * Created by: building-vanilla-slices skill, slice-16-notify plan Task 2.
 * Reference shapes (bitshares-ui, read-only): PriceAlert.jsx:82-101,160-233
 *   (CRUD + validation WORDS); Exchange.jsx:134-179 (pair tag/filter);
 *   ExchangeHeader.jsx:210-232 (bell + has-alerts indicator);
 *   PriceAlertNotifications.jsx:70-148 (30s toast WORDS); SettingsStore
 *   :121-126 + SettingsEntry.jsx:115-171 (toggle WORDS); popup.js:174,736-748
 *   (#3 toast shape). Deliberate deviations: standalone #/alerts route (no
 *   such route in #1 — a home for phone/non-Exchange flows); bell links to
 *   #/alerts instead of opening a modal; browser notes default OFF, asked
 *   for ONLY from an explicit click. Timers are wall-clock: alerts never
 *   fire while the page is closed (stated in the view, never faked).
 * MONEY DISCIPLINE (#6): thresholds render as verbatim display strings;
 *   comparisons go through NotifyRules.compare only. No Number()/parseFloat here.
 */
var NotifyUI = (function () {
  "use strict";
  /* Batch-2c i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws.
   * Dynamic sentences keep their code structure (batch-2b precedent): only
   * complete static literals are wrapped, values and punctuation glue stay
   * raw, so every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  var gen = 0;
  var LAST_KEY = "bts-vanilla-last-market-v1";
  /* Slice-16 (F3): connection listener for the #/alerts auto-refresh.
   * One subscription at a time; replaced on every render, gen-guarded. */
  var _connUnsub = null;

  /* Host/rules accessors (script order: notify-host.js + notify-rules.js load
   * before this file; backend() below turns absence into honest notes). */
  function H() {
    return (typeof NotifyHost !== "undefined" && NotifyHost) ? NotifyHost : null;
  }
  function R() {
    return (typeof NotifyRules !== "undefined" && NotifyRules) ? NotifyRules : null;
  }

  /* Last-viewed market id (own key in market-ui.js); null when absent. */
  function loadLast() {
    try {
      if (typeof localStorage === "undefined") return null;
      var v = localStorage.getItem(LAST_KEY);
      return (typeof v === "string" && v) ? v : null;
    } catch (e) { return null; }
  }

  /* Best-effort latest human price + precisions for a pair. Never throws;
   * null-latest means "waiting for price" downstream (engine never fires). */
  async function pairMeta(quote, base) {
    try {
      if (typeof Market === "undefined" || !Market) return { latest: null };
      var assets = await Market.assets(quote, base);
      if (!assets || !assets.quote || !assets.base) return { latest: null };
      var st = await Market.stats(assets.base.id, assets.quote.id);
      return {
        latest: (st && st.latest !== undefined && st.latest !== null) ? String(st.latest) : null,
        basePrec: assets.base.precision, quotePrec: assets.quote.precision
      };
    } catch (e) { return { latest: null }; }
  }

  /* Group stored rules by QUOTE_BASE, preserving insertion order. */
  function groups(rules) {
    var out = [], seen = {};
    (rules || []).forEach(function (r) {
      var k = String(r.quote) + "_" + String(r.base);
      if (!seen[k]) { seen[k] = { key: k, quote: r.quote, base: r.base, rows: [] }; out.push(seen[k]); }
      seen[k].rows.push(r);
    });
    return out;
  }

  /* Direction WORDS (locale-en exchange.price_alert block, English-first). */
  function dirWord(type) { return type === "1" ? t("notify.higher", "Higher Than") : t("notify.lower", "Lower Than"); }

  /* Route entry: #/alerts — rule CRUD + permission + delegated toggles. */
  function render(root) {
    if (!root) return;
    var myGen = ++gen;
    var doc = root.ownerDocument || document;
    while (root.firstChild) root.removeChild(root.firstChild);
    var host = H(), RL = R();
    var wrap = doc.createElement("div");
    wrap.className = "wrap alerts-view";
    root.appendChild(wrap);
    if (typeof Notify === "undefined" || !Notify || !host || !RL) {
      var what = (typeof Notify === "undefined" || !Notify) ? "notify.js"
        : (!RL ? "notify-rules.js" : "notify-host.js");
      var miss = doc.createElement("p");
      miss.className = "muted";
      miss.textContent = t("notify.backend_prefix", "Alerts backend missing: ") + what + t("notify.backend_suffix", " failed to load.");
      wrap.appendChild(miss);
      return;
    }
    var N = Notify;
    var el = host.el, touchable = host.touchable;
    var uiGen = host.mark();
    wrap.appendChild(el(doc, "h1", t("notify.title", "Price Alerts")));
    var honesty = t("notify.honesty", "Rules are checked while this page is open. Timers die with the page — alerts never fire while the app is closed.");
    wrap.appendChild(el(doc, "p", honesty, "muted"));
    host.mountToasts();
    var live = function () { return myGen === gen; };
    /* Slice-16 (F1c): stale-pair sweep on #/alerts entry. The sync
     * resolver keeps every rule (returns true) when there is no evidence
     * the pair is dead — resolver failure never silent-deletes; the async
     * pairMeta path below owns the "pair unresolved" badge. A future sync
     * asset cache can replace this predicate without touching callers. */
    try {
      if (RL && typeof RL.sweepStale === "function") {
        try { RL.sweepStale(function () { return true; }); } catch (e) { /* keep all */ }
      }
    } catch (e) { /* sweep best-effort */ }

    /* Rule list grouped by pair, per-rule delete (>= 44px). */
    var listBox = el(doc, "div", null, "alerts-list");
    wrap.appendChild(listBox);
    function drawList() {
      if (!live()) return;
      while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
      var rs = [];
      try { rs = RL.rules() || []; } catch (e) { rs = []; }
      if (rs.length === 0) {
        listBox.appendChild(el(doc, "p",
          t("notify.empty_list", "No price alerts yet. Use Add rule below to watch a market."), "muted"));
        return;
      }
      groups(rs).forEach(function (g) {
        listBox.appendChild(el(doc, "h2",
          g.quote + "/" + g.base + " (" + String(g.rows.length) + ")"));
        g.rows.forEach(function (r) {
          var row = doc.createElement("div");
          row.className = "alert-row";
          row.appendChild(el(doc, "span",
            dirWord(r.type) + " " + String(r.price)));
          var latest = el(doc, "span", t("notify.waiting", "waiting for price"), "muted");
          row.appendChild(latest);
          if (r.unresolvedSince) {
            row.appendChild(el(doc, "span", t("notify.unresolved", "pair unresolved"), "badge"));
          }
          var del = touchable(el(doc, "button", t("notify.delete", "Delete")));
          del.type = "button";
          del.setAttribute("aria-label", t("notify.delete_aria_prefix", "Delete alert ") + dirWord(r.type) + " " + String(r.price));
          del.addEventListener("click", function () {
            try { RL.removeRule(r.key); } catch (e) { /* list repaints */ }
            drawList();
          });
          row.appendChild(del);
          listBox.appendChild(row);
          pairMeta(g.quote, g.base).then(function (m) {
            if (!live() || !host.live(uiGen)) return;
            if (m.latest) latest.textContent = t("notify.latest_prefix", "latest ") + m.latest;
          });
        });
      });
    }
    drawList();
    /* Slice-16 (F3): sibling auto-reconnect subscribe (Store.subscribe
     * pattern, same as account-ui/market-ui). Rows rendered pre-connect
     * say "waiting for price"; on open they refresh via drawList (which
     * re-runs pairMeta). Gen-guarded; one subscription at a time. */
    try {
      if (typeof Store !== "undefined" && Store &&
          typeof Store.subscribe === "function") {
        try {
          if (_connUnsub) { try { _connUnsub(); } catch (e) { /* gone */ } _connUnsub = null; }
        } catch (e) { /* reset best-effort */ }
        try {
          _connUnsub = Store.subscribe("connection", function (st) {
            if (myGen !== gen || !host.live(uiGen)) return;
            if (st && st.state === "open") { try { drawList(); } catch (e) { /* never break */ } }
          });
        } catch (e) { /* reconnect refresh best-effort */ }
      }
    } catch (e) { /* offline panel path unaffected */ }

    /* Add-rule form (pair defaults to the last-viewed market). */
    wrap.appendChild(el(doc, "h2", t("notify.add_rule", "Add rule")));
    var form = doc.createElement("div");
    form.className = "alert-form";
    wrap.appendChild(form);
    var last = loadLast(), lq = "", lb = "";
    if (last && last.indexOf("_") !== -1) {
      var lp = last.split("_");
      lq = lp[0] || ""; lb = lp[1] || "";
    }
    function field(label, value, mode) {
      var lab = doc.createElement("label");
      lab.appendChild(el(doc, "span", label));
      var inp = doc.createElement("input");
      inp.value = value || "";
      if (mode) inp.setAttribute("inputmode", mode);
      touchable(inp);
      lab.appendChild(inp);
      form.appendChild(lab);
      return inp;
    }
    var inQ = field(t("notify.quote_label", "Quote"), lq, null);
    var inB = field(t("notify.base_label", "Base"), lb, null);
    var dirLab = doc.createElement("label");
    dirLab.appendChild(el(doc, "span", t("notify.dir_label", "Alert me when")));
    var dirSel = doc.createElement("select");
    touchable(dirSel);
    [["1", t("notify.higher", "Higher Than")], ["2", t("notify.lower", "Lower Than")]].forEach(function (o) {
      var op = doc.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      dirSel.appendChild(op);
    });
    dirLab.appendChild(dirSel);
    form.appendChild(dirLab);
    var inP = field(t("notify.price_label", "Price"), "", "decimal");
    var err = el(doc, "p", "", "error");
    err.setAttribute("aria-live", "polite");
    form.appendChild(err);
    var add = touchable(el(doc, "button", t("notify.add_rule", "Add rule")));
    add.type = "button";
    form.appendChild(add);
    add.addEventListener("click", async function () {
      if (!live()) return;
      err.textContent = "";
      var q = inQ.value.trim().toUpperCase(), b = inB.value.trim().toUpperCase();
      var price = inP.value.trim(), type = dirSel.value;
      if (!q || !b || q === b) { err.textContent = t("notify.symbols_needed", "Enter two different symbols, e.g. BTS and USD."); return; }
      if (!/^\d+(?:\.\d+)?$/.test(price)) { err.textContent = t("notify.price_hint", "Enter a price like 1.234."); return; }
      var meta = await pairMeta(q, b);
      if (!live()) return;
      /* Precision cap (ambiguity B): max(basePrec, quotePrec), both resolved. */
      if (typeof meta.basePrec === "number" && typeof meta.quotePrec === "number") {
        var cap = meta.basePrec > meta.quotePrec ? meta.basePrec : meta.quotePrec;
        var dot = price.indexOf(".");
        if (dot !== -1 && price.length - dot - 1 > cap) {
          err.textContent = t("notify.too_many_prefix", "Too many decimals for this pair (max ") + String(cap) + ").";
          return;
        }
      }
      /* Latest-price validation (PriceAlert.jsx:83-95 WORDS): only when the
       * feed has a price; otherwise the rule is stored with a waiting note. */
      if (meta.latest) {
        try {
          var c = RL.compare(meta.latest, price);
          if (type === "1" && c >= 0) {
            err.textContent = t("notify.higher_check_prefix", "Higher Than alerts must be above the latest price (latest ") + meta.latest + ").";
            return;
          }
          if (type === "2" && c <= 0) {
            err.textContent = t("notify.lower_check_prefix", "Lower Than alerts must be below the latest price (latest ") + meta.latest + ").";
            return;
          }
        } catch (e) { err.textContent = t("notify.compare_failed", "Could not compare against the latest price."); return; }
      }
      try {
        RL.addRule({ quote: q, base: b, type: type, price: price,
          basePrec: meta.basePrec, quotePrec: meta.quotePrec });
      } catch (e) { err.textContent = t("notify.save_failed", "Could not save this rule (check the price)."); return; }
      inP.value = "";
      drawList();
      host.mountToasts();
    });

    /* Permission section: explicit opt-in only, honest skip reasons. */
    wrap.appendChild(el(doc, "h2", t("notify.browser_h2", "Browser notifications")));
    var permBox = el(doc, "div", null, "alerts-perm");
    wrap.appendChild(permBox);
    function skipLine() {
      var r = null;
      try { r = N.notifyBrowser("probe", "probe"); } catch (e) { r = null; }
      var reason = (r && r.skipped) || "disabled";
      var words = { disabled: t("notify.skip_disabled", "Browser notifications are off."),
        unsupported: t("notify.skip_unsupported", "This browser or page (http/file) does not support notifications."),
        denied: t("notify.skip_denied", "Notifications are blocked — allow them in the browser site settings."),
        default: t("notify.skip_default", "Permission not granted yet — use the button above."),
        error: t("notify.skip_error", "Notifications failed to show.") };
      return (words[reason] || words.disabled) + t("notify.toasts_note", " Toasts still work in-app.");
    }
    function drawPerm() {
      if (!live()) return;
      while (permBox.firstChild) permBox.removeChild(permBox.firstChild);
      var prefs = null;
      try { prefs = N.prefs(); } catch (e) { prefs = { browser: false }; }
      var btn = touchable(el(doc, "button",
        prefs && prefs.browser ? t("notify.browser_on", "Browser notifications on") : t("notify.browser_enable", "Enable browser notifications")));
      btn.type = "button";
      btn.addEventListener("click", async function () {
        if (!live()) return;
        try { await N.enableBrowser(); } catch (e) { /* reason line below */ }
        if (live()) { drawPerm(); drawToggles(); }
      });
      permBox.appendChild(btn);
      permBox.appendChild(el(doc, "p", skipLine(), "muted"));
    }
    drawPerm();

    /* Settings delegation: the two notification toggles live here by calling
     * Notify prefs directly — no forked settings state (LINK-OUT honoring). */
    wrap.appendChild(el(doc, "h2", t("notify.settings_h2", "Notification settings")));
    var togBox = el(doc, "div", null, "alerts-toggles");
    wrap.appendChild(togBox);
    function drawToggles() {
      if (!live()) return;
      while (togBox.firstChild) togBox.removeChild(togBox.firstChild);
      var prefs = null;
      try { prefs = N.prefs(); } catch (e) { prefs = { browser: false, transferToMe: true }; }
      var bLab = doc.createElement("label");
      var bBox = doc.createElement("input");
      bBox.type = "checkbox";
      bBox.checked = !!(prefs && prefs.browser);
      touchable(bBox);
      bLab.appendChild(bBox);
      bLab.appendChild(el(doc, "span", t("notify.allow_browser", "Allow browser notifications")));
      togBox.appendChild(bLab);
      bBox.addEventListener("change", async function () {
        if (!live()) return;
        try {
          if (bBox.checked) await N.enableBrowser();
          else N.setPrefs({ browser: false });
        } catch (e) { /* toggles repaint */ }
        if (live()) { drawPerm(); drawToggles(); }
      });
      var tLab = doc.createElement("label");
      var tBox = doc.createElement("input");
      tBox.type = "checkbox";
      tBox.checked = !(prefs && prefs.transferToMe === false);
      touchable(tBox);
      tLab.appendChild(tBox);
      tLab.appendChild(el(doc, "span", t("notify.transfer_toggle", "Notify me about incoming transfers")));
      togBox.appendChild(tLab);
      tBox.addEventListener("change", function () {
        try { N.setPrefs({ transferToMe: !!tBox.checked }); } catch (e) { /* repaint */ }
      });
    }
    drawToggles();
  }

  /* Back-compat shims: surgical callers now prefer NotifyHost.mountToasts /
   * NotifyHost.bellFor directly. These delegates stay so any missed reference
   * keeps working (forward, never fork). */
  function mountToasts() {
    var h = H();
    return h ? h.mountToasts() : null;
  }
  function bellFor(quote, base) {
    var h = H();
    return h ? h.bellFor(quote, base) : null;
  }

  return { render: render, mountToasts: mountToasts, bellFor: bellFor };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.NotifyUI === "undefined") { globalThis.NotifyUI = NotifyUI; }
if (typeof module !== "undefined") { module.exports = NotifyUI; }
