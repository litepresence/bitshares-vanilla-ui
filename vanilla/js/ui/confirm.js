/* ui/confirm.js — shared transaction-confirm builder.
 * Owns: div.confirm-dialog (h3 title + dl.confirm named rows + fee line +
 *   div.confirm-actions holding Back (btn-ghost) + Sign & Send buttons;
 *   Esc routes to onBack; returns the container for the caller to mount).
 * Consumes: DOM global (el/append — never reimplemented here; raw
 *   createElement fallback only when DOM is absent, e.g. Node without the
 *   shim), touchable() global for the 44px touch floor (guarded: skipped
 *   when absent, e.g. Node).
 * Side effects: creates DOM elements only; adds one doc-level keydown
 *   listener per show() (removed on Back/Send/Esc — never leaks across
 *   confirms). No storage, no network, no signing — the caller owns
 *   publish (buildTx + fresh-WIF sendAndProve + head-marked result).
 * Origin: Task 3.1 of docs/superpowers/plans/2026-10-04-shared-utilities-refactor.md;
 *   common subset of the locals in asset-ui.js (confirm ~line 185: named
 *   rows + fee + Back/Sign&Send), barter-ui.js (confirmPropose ~line 308:
 *   h3 + dl.confirm + Back btn-ghost), borrow-ui.js, credit-ui.js
 *   (confirmList/sendConfirm ~lines 160/232), htlc-ui.js, pool-ui.js
 *   (sendConfirm ~line 234), proposal-ui.js (confirmList/sendConfirm
 *   ~lines 145/237): title/rows/fee/Back/Send only. Unlock gates, status
 *   lines, and sendAndProve stay in the calling views.
 * No deps, ES5, works on file:// and http:// (classic script tag). */
var ConfirmDialog = (function () {
  /* Resolve the shared DOM helper without capturing it (script order in
   * index.html guarantees window.DOM exists before this file runs).
   * @return {object|null} DOM global or null when absent (Node without shim).
   * Failure: returns null — show() falls back to raw doc.createElement. */
  function dom() {
    if (typeof DOM !== "undefined" && DOM) return DOM;
    return null;
  }

  /* Apply the 44px touch floor when the helper exists.
   * @param {HTMLElement} el element to floor (may be null).
   * @return {HTMLElement} same element, possibly style-mutated.
   * Failure: no-op when touchable is absent (Node tests, minimal pages). */
  function floor(el) {
    if (el && typeof touchable === "function") touchable(el);
    return el;
  }

  /* Resolve the owner document: explicit cfg.doc first (Node tests), then
   * the browser global. Callers on real pages pass nothing — document wins.
   * @param {any} cfg show() config bag (may carry .doc).
   * @return {Document|null} usable document or null.
   * Failure: returns null when neither exists (show() throws honestly). */
  function docOf(cfg) {
    if (cfg && cfg.doc && typeof cfg.doc.createElement === "function") return cfg.doc;
    if (typeof document !== "undefined" && document) return document;
    return null;
  }

  /* Build one element via the shared helper, or raw when DOM is absent.
   * @param {Document} doc owner document.
   * @param {string} tag tag name.
   * @param {string|null} text textContent (null leaves it empty).
   * @param {string} cls optional className.
   * @return {HTMLElement} new detached element.
   * Failure: text null/undefined renders as empty text (never "null"). */
  function mk(doc, tag, text, cls) {
    var D = dom();
    var el;
    if (D) return D.el(doc, tag, text, cls);
    el = doc.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  /* Render the confirm subset: heading, named rows, fee line, Back + Send.
   * @param {any} cfg {title: string, rows: [[term, text, rawTitle?]...]
   *   (third element sets dd.title = raw, e.g. "raw 123" or "12345";
   *   [term, text] still valid — no title when absent),
   *   feeHuman: string (human fee line; skipped when null/undefined),
   *   feeTerm?: string (caller's already-keyed fee dt, e.g.
   *   t("borrow.fee", "Fee"); fallback "Fee" when absent),
   *   feeRawTitle?: string|null (raw fee integer for the fee dd title,
   *   principle #6: human terms with raw in title; no title when absent),
   *   onBack: function, onSend: function,
   *   doc?: Document (Node-test seam; browsers omit it),
   *   backLabel?: string (default "Back"), sendLabel?: string
   *   (default "Sign & Send") — translated labels ride in from the caller
   *   so this module carries no locale machinery.}
   * @return {HTMLElement} div.confirm-dialog (caller appends it; the
   *   returned node stays usable after Back/Send fire).
   * Failure: throws Error("confirm: no document") with no document;
   *   null/undefined rows render as an empty list (never throws). */
  function show(cfg) {
    cfg = cfg || {};
    var D = dom();
    var doc = docOf(cfg);
    var title = (cfg.title === undefined || cfg.title === null) ? "" : cfg.title;
    var rows = cfg.rows || [];
    var onBack = (typeof cfg.onBack === "function") ? cfg.onBack : function () {};
    var onSend = (typeof cfg.onSend === "function") ? cfg.onSend : function () {};
    var backLabel = (cfg.backLabel === undefined || cfg.backLabel === null) ? "Back" : cfg.backLabel;
    var sendLabel = (cfg.sendLabel === undefined || cfg.sendLabel === null) ? "Sign & Send" : cfg.sendLabel;
    var feeTerm = (cfg.feeTerm === undefined || cfg.feeTerm === null) ? "Fee" : cfg.feeTerm;
    var box;
    var list;
    var actions;
    var back;
    var send;
    var dd;
    var i;
    if (!doc) throw new Error("confirm: no document");
    box = mk(doc, "div", null, "confirm-dialog");
    box.appendChild(mk(doc, "h3", title));
    list = mk(doc, "dl", null, "confirm");
    for (i = 0; i < rows.length; i++) {
      list.appendChild(mk(doc, "dt", rows[i][0]));
      dd = mk(doc, "dd", rows[i][1]);
      if (rows[i][2]) dd.title = rows[i][2];
      list.appendChild(dd);
    }
    if (cfg.feeHuman !== undefined && cfg.feeHuman !== null) {
      list.appendChild(mk(doc, "dt", feeTerm));
      dd = mk(doc, "dd", cfg.feeHuman);
      if (cfg.feeRawTitle) dd.title = cfg.feeRawTitle;
      list.appendChild(dd);
    }
    if (D) D.append(box, list);
    else box.appendChild(list);
    actions = mk(doc, "div", null, "confirm-actions");
    back = floor(mk(doc, "button", backLabel, "btn-ghost"));
    back.type = "button";
    send = floor(mk(doc, "button", sendLabel));
    send.type = "button";
    if (D) D.append(actions, back, send);
    else { actions.appendChild(back); actions.appendChild(send); }
    if (D) D.append(box, actions);
    else box.appendChild(actions);

    /* One-shot Esc: Back exactly once, then detach (repeat Esc presses
     * after resolve are no-ops — the listener is gone). */
    function cleanup() {
      try {
        if (doc.removeEventListener) doc.removeEventListener("keydown", onKey);
      } catch (e) { /* listener is best-effort in minimal docs */ }
    }
    function onKey(e) {
      e = e || {};
      if (e.key === "Escape" || e.keyCode === 27) {
        cleanup();
        onBack();
      }
    }
    try {
      if (doc.addEventListener) doc.addEventListener("keydown", onKey);
    } catch (e) { /* confirm still works via the buttons */ }
    back.addEventListener("click", function () { cleanup(); onBack(); });
    send.addEventListener("click", function () { cleanup(); onSend(); });
    return box;
  }

  return {
    show: show
  };
})();

if (typeof window !== "undefined") /** @type {any} */ (window).ConfirmDialog = ConfirmDialog;
if (typeof module !== "undefined") module.exports = ConfirmDialog;
