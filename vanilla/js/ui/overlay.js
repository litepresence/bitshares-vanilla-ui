/* ui/overlay.js — shared fixed full-viewport modal overlay.
 * Owns: overlay > panel shell, click-outside-to-close, Esc-to-close, focus
 *   to panel, single-fire onClose, idempotent close().
 * Consumes: DOM global (el — never reimplemented here; raw createElement
 *   fallback only when DOM is absent, e.g. Node without the shim).
 * Side effects: appends/removes one overlay in doc.body; adds/removes one
 *   doc-level keydown listener per open; moves focus to the panel.
 * Origin: Task 3.3 of docs/superpowers/plans/2026-10-04-shared-utilities-refactor.md;
 *   common subset of the credit-ui.js openLoanModal overlay (~line 406-438:
 *   backdrop click target===overlay, Escape key, role=dialog panel).
 *   Callers needing more (focus trap, return-focus) keep their own — this
 *   module ships the subset every modal needs, nothing else.
 * CSS contract: positioning/skin comes from vanilla/css/app.css
 *   .credit-loan-overlay/.credit-loan-panel (verified present); this module
 *   sets no inline positioning so no new CSS is needed.
 * No deps, ES5, works on file:// and http:// (classic script tag). */
var Overlay = (function () {
  /* Resolve the shared DOM helper without capturing it (script order in
   * index.html guarantees window.DOM exists before this file runs).
   * @return {object|null} DOM global or null when absent (Node without shim).
   * Failure: returns null — open() falls back to raw doc.createElement. */
  function dom() {
    if (typeof DOM !== "undefined" && DOM) return DOM;
    return null;
  }

  /* Resolve the owner document from the caller's content element.
   * @param {HTMLElement} content element to place inside the panel.
   * @return {Document|null} content.ownerDocument or the global document.
   * Failure: returns null when neither exists (open() throws honestly). */
  function resolveDoc(content) {
    if (content && content.ownerDocument) return content.ownerDocument;
    if (typeof document !== "undefined" && document) return document;
    return null;
  }

  /* Open a modal overlay around caller-built content.
   * @param {object} cfg {content: HTMLElement, onClose: function?,
   *   className: string?} — content is moved inside the panel (not cloned);
   *   onClose fires at most once, on any close path; className is an extra
   *   hook appended to the overlay (contract classes are always kept).
   * @return {{overlay: HTMLElement, close: function}} overlay is the
   *   backdrop element (attached to doc.body); close() detaches, removes
   *   listeners, fires onClose once — safe to call repeatedly.
   * Failure: throws when no document can be resolved; onClose missing means
   *   close paths only detach (never throws). */
  function open(cfg) {
    cfg = cfg || {};
    var doc = resolveDoc(cfg.content);
    if (!doc) throw new Error("Overlay.open: no document (pass content with ownerDocument)");
    var D = dom();
    var overlay;
    var panel;
    if (D) {
      overlay = D.el(doc, "div", null, "credit-loan-overlay");
      panel = D.el(doc, "div", null, "credit-loan-panel");
    } else {
      overlay = doc.createElement("div");
      overlay.className = "credit-loan-overlay";
      panel = doc.createElement("div");
      panel.className = "credit-loan-panel";
    }
    if (cfg.className) overlay.className += " " + cfg.className;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("tabindex", "-1");
    if (cfg.content) panel.appendChild(cfg.content);
    overlay.appendChild(panel);
    if (doc.body && typeof doc.body.appendChild === "function") doc.body.appendChild(overlay);
    var closed = false;
    var onClose = (typeof cfg.onClose === "function") ? cfg.onClose : null;
    /* Backdrop path: only a click whose target IS the overlay closes —
     * clicks inside the panel (target = content) bubble up but are ignored. */
    function onBackdrop(e) {
      if (e && e.target === overlay) close();
    }
    function onKey(e) {
      if (!e) return;
      if (e.key === "Escape" || e.keyCode === 27) close();
    }
    function close() {
      if (closed) return;
      closed = true;
      try { overlay.removeEventListener("click", onBackdrop); } catch (e) { /* once */ }
      try { doc.removeEventListener("keydown", onKey); } catch (e) { /* once */ }
      var parent = overlay.parentElement || overlay.parentNode;
      if (parent && typeof parent.removeChild === "function") parent.removeChild(overlay);
      if (onClose) onClose();
    }
    overlay.addEventListener("click", onBackdrop);
    if (typeof doc.addEventListener === "function") doc.addEventListener("keydown", onKey);
    try { if (typeof panel.focus === "function") panel.focus(); } catch (e) { /* tab order stands */ }
    return { overlay: overlay, close: close };
  }

  return {
    open: open
  };
})();

if (typeof window !== "undefined") /** @type {any} */ (window).Overlay = Overlay;
if (typeof module !== "undefined") module.exports = Overlay;
