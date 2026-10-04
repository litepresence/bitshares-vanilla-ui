/* notify-host.js — toast-stack host + market-desk bell + shared row helpers.
 * Owns: the single #toast-stack host (create-once on document.body, one
 *   Notify.subscribe listener, snapshot repaint incl. overflow line), the
 *   bellFor(quote, base) market-desk entry point, shared el/touchable row
 *   helpers, and an own gen + mark()/live() two-counter guard so #/alerts
 *   async fills die with stale renders (pool-detail-ui.js precedent: the view
 *   checks its own gen AND the host uiGen).
 * Consumes: Notify (queue reads — guarded; host no-ops without it),
 *   NotifyRules (hasAny indicator; falls back to Notify.hasAny when the
 *   rules file is absent). No Chain/Tx, no amounts, no precisions.
 * Globals/side effects: one #toast-stack div + one queue subscriber;
 *   global NotifyHost only (+ module.exports).
 * Created by: building-vanilla-slices skill, slice-16 cap-breach split —
 *   host half moved behavior-identically OUT of notify-ui.js (the #/alerts
 *   renderer keeps rule CRUD + form + permission + toggles only).
 * Reference shapes (bitshares-ui, read-only): ExchangeHeader.jsx:210-232
 *   (bell + has-alerts indicator); popup.js:174,736-748 (#3 toast shape).
 * Deliberate deviations (inherited): bell links to #/alerts instead of
 *   opening a modal; host positioning inline stays as the pre-CSS fallback
 *   (card skin lives in css/app.css). Timers are wall-clock (Notify owns
 *   them); this renderer just paints snapshots, so sticky errors stay until
 *   tapped. Nothing is hover-only.
 */
var NotifyHost = (function () {
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
  var _unsub = null;
  /* No local el — use DOM.el */
  /* mark: open a new host generation (the view calls this per render).
   * live: true only for the current generation (stale async work dies). */
  function mark() { return ++gen; }
  function live(uiGen) { return uiGen === gen; }
  /* Pair indicator: NotifyRules first, Notify fallback (mixed loads). */
  function _hasAny(q, b) {
    try {
      if (typeof NotifyRules !== "undefined" && NotifyRules &&
          typeof NotifyRules.hasAny === "function") return !!NotifyRules.hasAny(q, b);
      if (typeof Notify !== "undefined" && Notify &&
          typeof Notify.hasAny === "function") return !!Notify.hasAny(q, b);
    } catch (e) { /* indicator best-effort */ }
    return false;
  }
  /* mountToasts: create the single #toast-stack host on first use and arm
   * the one queue subscriber. Safe to call on every render; later calls
   * only repaint. Auto-dismiss lives in Notify (wall-clock timers); this
   * renderer just paints the snapshot, so sticky errors stay until tapped. */
  function mountToasts() {
    if (typeof document === "undefined") return null;
    var host = document.getElementById("toast-stack");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-stack";
      host.className = "toast-stack";
      host.setAttribute("aria-live", "polite");
      /* Layout inline so the stack positions even before the css append
       * lands; retro skin comes from the stylesheet. */
      host.style.position = "fixed";
      host.style.right = "12px";
      host.style.bottom = "12px";
      host.style.zIndex = "9999";
      host.style.display = "flex";
      host.style.flexDirection = "column";
      host.style.gap = "8px";
      host.style.maxWidth = "min(360px, calc(100vw - 24px))";
      document.body.appendChild(host);
    }
    if (!_unsub && typeof Notify !== "undefined" && Notify &&
        typeof Notify.subscribe === "function") {
      try { _unsub = Notify.subscribe(function () { paintToasts(); }); } catch (e) { _unsub = null; }
    }
    paintToasts();
    return host;
  }
  /* paintToasts: full snapshot repaint (queue is <= 5 visible by design). */
  function paintToasts() {
    if (typeof document === "undefined") return;
    var host = document.getElementById("toast-stack");
    if (!host || typeof Notify === "undefined" || !Notify) return;
    DOM.clear(host);
    var items = [];
    try { items = Notify.list() || []; } catch (e) { items = []; }
    items.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "toast toast-" + String(item.level || "info");
      /* Card skin lives in css/app.css (.toast + level stripes). No inline
       * border/padding/background here so the stylesheet wins without
       * !important; host positioning inline above stays as pre-CSS fallback. */
      var head = DOM.el(document, "div", null, "toast-head");
      if (item.title) head.appendChild(DOM.el(document, "strong", item.title));
      var x = touchable(DOM.el(document, "button", "×", "toast-x subtle-btn"));
      x.type = "button";
      x.setAttribute("aria-label", t("notify.dismiss", "Dismiss notification"));
      x.addEventListener("click", function () {
        try { Notify.dismiss(item.id); } catch (e) { /* host still repaints */ }
      });
      head.appendChild(x);
      card.appendChild(head);
      if (item.body) card.appendChild(DOM.el(document, "div", item.body, "toast-body"));
      /* Tap-to-dismiss anywhere on the card; nothing is hover-only. */
      card.addEventListener("click", function (ev) {
        if (ev.target === x) return;
        try { Notify.dismiss(item.id); } catch (e) { /* repaint follows */ }
      });
      host.appendChild(card);
    });
    var more = 0;
    try { more = Notify.overflow() || 0; } catch (e) { more = 0; }
    if (more > 0) host.appendChild(DOM.el(document, "div", "+" + String(more) + t("notify.more_suffix", " more"), "muted"));
  }
  /* bellFor: market-desk entry point (Reference #6 shape, link flavour).
   * Indicator class when the pair has rules; links to #/alerts (NOT a
   * modal — recorded deviation). Null without a DOM (headless-safe). */
  function bellFor(quote, base) {
    if (typeof document === "undefined") return null;
    var q = String(quote || "").trim().toUpperCase();
    var b = String(base || "").trim().toUpperCase();
var a = touchable(DOM.el(document, "a", "", "mkt-bell subtle-btn"));
      a.setAttribute("href", "#/alerts");
      a.setAttribute("aria-label", t("notify.bell", "Price Alert"));
      a.setAttribute("title", t("notify.bell", "Price Alert"));
    var on = (q && b) ? _hasAny(q, b) : false;
    /* Icon wiring (alarm.svg = #1's bell affordance; ExchangeHeader.jsx:210-232
     * shape kept: link to #/alerts + has-alerts indicator class). Synchronous
     * <img> — the _hasAny toggle + repaint logic below is byte-identical in
     * behavior; without Icon the previous 🔔 text remains (never blank). */
    try {
      if (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function") {
        a.appendChild(Icon.img("alarm", "bell-icon", ""));
        if (on) {
          var dot = DOM.el(document, "span", "●", "bell-dot");
          dot.setAttribute("aria-hidden", "true");
          a.appendChild(dot);
        }
      } else {
        a.textContent = on ? "🔔●" : "🔔";
      }
    } catch (e) {
      try { a.textContent = on ? "🔔●" : "🔔"; } catch (e2) { /* bell keeps href */ }
    }
    if (on) a.className = "mkt-bell has-alerts";
    return a;
  }
  return {
    el: DOM.el, mark: mark, live: live,
    mountToasts: mountToasts, paintToasts: paintToasts, bellFor: bellFor
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.NotifyHost === "undefined") { globalThis.NotifyHost = NotifyHost; }
if (typeof module !== "undefined") { module.exports = NotifyHost; }
