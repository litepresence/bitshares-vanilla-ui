/* history-notice.js — shared history-fallback action link builder.
 * Owns: the pure-DOM "Open Settings" (/ "Open help") anchor appended after
 *   history-unavailable error panels (dashboard, account, market picker/desk/
 *   orders, explorer activity, pool swap/detail). Message text stays with the
 *   callers (existing i18n keys reused byte-identical); this module only adds
 *   the linked action, never the sentence.
 * Consumes: caller-provided doc (document) + t(key, dflt) i18n function.
 *   Side effects: none beyond the returned element (no fetch, no Chain/Store
 *   calls — callers gate on HistoryCap/Chain; builder is pure DOM).
 * Globals: HistoryNotice only (module.exports for node tests).
 * Created by: building-vanilla-slices skill, history-notice round
 *   (AGENTS.md §7 rule 8; zero-deps, format.js N/A — no money here).
 * Help href note: no dedicated ES/community article id exists in help-ui.js
 *   TOPICS (the Elastic/ES directory lives on the #/help index,
 *   help-ui.js:711-713 SECTIONS) — so "help-es" points at "#/help".
 */
var HistoryNotice = (function () {
  "use strict";

  /**
   * Link kinds: href + i18n key + English default per kind.
   * "settings" routes to the node switcher; "help-es" routes to the help
   * index that hosts the Elastic/ES directory (help-ui.js:711-713).
   * @type {Object<string, {href: string, key: string, dflt: string}>}
   */
  var KINDS = {
    settings: {href: "#/settings", key: "notice.open_settings", dflt: "Open Settings"},
    "help-es": {href: "#/help", key: "notice.open_help", dflt: "Open help"}
  };

  /**
   * Build the history-fallback action anchor for a kind.
   * Pure DOM: creates one <a>, labels it via t(key, dflt), points it at the
   * kind href, and tags it "hist-notice-link touchable" (touchable here is a
   * class token for forward-compat styling; the 44px floor is also applied
   * inline best-effort since no .touchable rule exists in app.css — the
   * per-file touchable() JS helper is the actual floor today).
   * Never sets message text — only the link label.
   * @param {any} doc Document (must expose createElement).
   * @param {any} t I18n translate fn (key, dflt) -> string; defaults used when missing.
   * @param {string} kind "settings" or "help-es".
   * @returns {any} The <a> element, or null for unknown kind / bad doc.
   */
  function actionLink(doc, t, kind) {
    var spec = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
    if (!spec) return null;
    if (!doc || typeof doc.createElement !== "function") return null;
    var a;
    try {
      a = doc.createElement("a");
    } catch (e) {
      return null;
    }
    if (!a) return null;
    var label = spec.dflt;
    try {
      if (typeof t === "function") label = t(spec.key, spec.dflt);
    } catch (e) {
      label = spec.dflt;
    }
    try {
      a.textContent = String(label);
    } catch (e) {
      try { a.textContent = spec.dflt; } catch (e2) { /* label best-effort */ }
    }
    try {
      if (typeof a.setAttribute === "function") a.setAttribute("href", spec.href);
      else a.href = spec.href;
    } catch (e) {
      try { a.href = spec.href; } catch (e2) { /* href best-effort */ }
    }
    try {
      a.className = "hist-notice-link touchable";
    } catch (e) { /* class best-effort */ }
    try {
      if (typeof a.setAttribute === "function") a.setAttribute("class", "hist-notice-link touchable");
    } catch (e) { /* fake-doc mirror best-effort */ }
    try {
      if (a.style) a.style.minHeight = "44px";
    } catch (e) { /* touch floor best-effort (no .touchable CSS rule exists) */ }
    return a;
  }

  return {actionLink: actionLink};
})();
if (typeof module !== "undefined") { module.exports = HistoryNotice; }
