/* ui/unlock-confirm.js — shared confirm + unlock modal (trollbox audit follow-up).
 * Owns: ONE overlay holding ConfirmDialog review rows + fee + opt-in raw
 *   drill-down and (when locked) a password row; unlock via Wallet.unlock with wipe-on-both-outcomes;
 *   confirm-only mode when already unlocked. The password NEVER leaves this
 *   module: onUnlocked() carries no password argument — callers only learn
 *   "proceed". Replaces the ~12 hand-rolled inline unlock rows (trollbox-ui,
 *   transfer-preview/propose, trade-panels, credit/borrow/htlc/barter,
 *   prediction-flows, instant-trade, pool-ui) one view per round.
 * Consumes: Overlay.open (shell), ConfirmDialog.show (review rows),
 *   DOM global (el/append — raw createElement fallback only when DOM absent),
 *   touchable() global (guarded), Wallet.unlock (sole keystore), I18n.t via
 *   the local t() (guarded verbatim-English fallback, slice-17 pattern).
 *   No signing, no broadcasting, no chain calls — the caller owns publish.
 * Side effects: one overlay in doc.body per open; one hashchange listener
 *   per open (removed on close); moves focus to the password input (locked)
 *   and returns focus via Overlay on close.
 * Origin: docs/superpowers/plans/2026-10-07-unlock-confirm-modal.md
 *   (spec — trollbox login audit); AFK round expanded scope to all views.
 * No deps, ES5, works on file:// and http:// (classic script tag). */
var UnlockConfirm = (function () {
  "use strict";

  /* t: locale string with verbatim-English fallback (slice-17 pattern —
   * shared helper owns exactly 3 keys so all 12 future callers share one
   * glossary wording; op-specific title/rows/labels ride in from callers).
   * Params: key, dflt. Returns localized string. Fails: never (dflt). */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* dom: shared DOM helper without capturing it (script order guarantees
   * window.DOM before this file). Returns DOM global or null. */
  function dom() {
    if (typeof DOM !== "undefined" && DOM) return DOM;
    return null;
  }

  /* floor: 44px touch floor when the helper exists. Returns same element. */
  function floor(el) {
    try {
      if (el && typeof touchable === "function") touchable(el);
    } catch (e) { /* native size stands */ }
    return el;
  }

  /* mk: element via the shared helper, or raw when DOM is absent.
   * Params: doc, tag, text (null leaves empty), cls. Returns element. */
  function mk(doc, tag, text, cls) {
    var D = dom();
    var el;
    if (D) return D.el(doc, tag, text, cls);
    el = doc.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  /* docOf: owner document — explicit cfg.doc first (Node-test seam), then
   * the browser global. Returns document or null (open() throws honestly). */
  function docOf(cfg) {
    if (cfg && cfg.doc && typeof cfg.doc.createElement === "function") return cfg.doc;
    if (typeof document !== "undefined" && document) return document;
    return null;
  }

  /* hashTarget: who hears hashchange — window when present (router.js binds
   * there too), else the owner doc (Node-test seam). Returns target or null
   * (no route guard then — Esc/backdrop/close still dismiss). */
  function hashTarget(doc) {
    try {
      if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") return window;
    } catch (e) { /* doc below */ }
    try {
      if (doc && typeof doc.addEventListener === "function") return doc;
    } catch (e) { /* none */ }
    return null;
  }

  /* wallet: the sole keystore, or null when absent (open() throws honestly
   * so the caller can show the page-level backend error). */
  function wallet() {
    try {
      if (typeof Wallet !== "undefined" && Wallet && typeof Wallet.unlock === "function") return Wallet;
    } catch (e) { /* null below */ }
    return null;
  }

  /* Open the confirm + unlock modal.
   * @param {object} cfg {title: string, rows: [[term, text, rawTitle?]...],
 *   feeHuman?: string|null, feeTerm?: string, feeRawTitle?: string|null,
 *   rawJson?: string|null, rawObj?: any, rawLabel?: string (forwarded to
 *   ConfirmDialog's details.raw drill-down — the op the modal reviews,
 *   when the caller has it built; omitted when the op only exists
 *   post-unlock),
 *   needPassword: boolean (caller computes via Wallet.isUnlocked()),
   *   submitLabel?: string, cancelLabel?: string, errorFor?: function(err),
   *   onUnlocked: function (modal closed, password wiped — proceed to publish),
   *   onCancel?: function (any dismiss path, at most once),
   *   doc?: Document (Node-test seam), className?: string, returnFocus?}
   * @return {{close: function}} dismisses as cancel (onCancel once).
   * Failure: throws Error("unlock-confirm: ...") with no document, no
   *   Wallet backend, or no onUnlocked. Unlock failure never throws — it
   *   renders in-modal and stays open for retry. */
  function open(cfg) {
    cfg = cfg || {};
    var doc = docOf(cfg);
    if (!doc) throw new Error("unlock-confirm: no document");
    var W = wallet();
    if (!W) throw new Error("unlock-confirm: wallet backend missing");
    if (typeof cfg.onUnlocked !== "function") throw new Error("unlock-confirm: onUnlocked is required");
    var needPassword = !!cfg.needPassword;
    var onCancel = (typeof cfg.onCancel === "function") ? cfg.onCancel : function () {};
    var submitLabel = (cfg.submitLabel === undefined || cfg.submitLabel === null)
      ? t("unlockconfirm.unlock_post", "Unlock & post") : cfg.submitLabel;
    var cancelLabel = (cfg.cancelLabel === undefined || cfg.cancelLabel === null)
      ? t("unlockconfirm.cancel", "Back") : cfg.cancelLabel;

    /* settled: "" open, "ok" submitted, "bye" dismissed. Guards every path
     * so onCancel fires at most once and never after success. */
    var settled = "";
    var pending = false;
    var handle = null;
    var hashOn = null;
    var hashBy = null;

    /* Review block: the shared ConfirmDialog (title + named rows + fee +
     * Back/Send). Its onBack/onSend route into dismiss/submit below; its
     * Esc listener converges on the same settled flag as Overlay's. */
    var box = ConfirmDialog.show({
      title: (cfg.title === undefined || cfg.title === null) ? "" : cfg.title,
      rows: cfg.rows || [],
      feeHuman: (cfg.feeHuman === undefined) ? null : cfg.feeHuman,
      feeTerm: cfg.feeTerm,
      feeRawTitle: (cfg.feeRawTitle === undefined) ? null : cfg.feeRawTitle,
      rawJson: (cfg.rawJson === undefined) ? null : cfg.rawJson,
      rawObj: (cfg.rawObj === undefined) ? null : cfg.rawObj,
      rawLabel: cfg.rawLabel,
      backLabel: cancelLabel,
      sendLabel: submitLabel,
      doc: doc,
      onBack: function () { dismiss(); },
      onSend: function () { submit(); }
    });

    /* Send/Back buttons: ConfirmDialog's fixed tail (actions is box tail,
     * send is actions tail). Guarded — unresolved buttons only lose the
     * disabled-while-pending nicety; the pending flag still blocks doubles. */
    var sendBtn = null;
    try {
      var actions = box ? box.lastChild : null;
      var tail = actions ? actions.lastChild : null;
      var tag = "";
      try { tag = String((tail && tail.tagName) || "").toUpperCase(); } catch (e) { tag = ""; }
      sendBtn = (tag === "BUTTON") ? tail : null;
    } catch (e) { sendBtn = null; }

    /* Password block (locked mode only): label + input + inline error.
     * Inserted between the review list and the actions so the reading order
     * is review → password → buttons (insertBefore with append fallback for
     * minimal docs). */
    var pwInput = null;
    var pwErr = null;
    if (needPassword) {
      var D = dom();
      var pwWrap = mk(doc, "div", null, "xfer-field xfer-unlock-row");
      var pwLabelText = t("unlockconfirm.password", "Password");
      var lab = mk(doc, "label", pwLabelText + " ");
      pwInput = doc.createElement("input");
      pwInput.type = "password";
      try { pwInput.setAttribute("autocomplete", "current-password"); } catch (e) { /* label stands */ }
      try { pwInput.setAttribute("aria-label", pwLabelText); } catch (e) { /* label stands */ }
      try { pwInput.setAttribute("placeholder", pwLabelText); } catch (e) { /* label stands */ }
      floor(pwInput);
      lab.appendChild(pwInput);
      if (D) D.append(pwWrap, lab);
      else pwWrap.appendChild(lab);
      pwErr = mk(doc, "div", "", "error");
      try { pwErr.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      try { pwErr.style.display = "none"; } catch (e) { /* text stands */ }
      if (D) D.append(pwWrap, pwErr);
      else pwWrap.appendChild(pwErr);
      try {
        if (typeof box.insertBefore === "function" && box.lastChild) box.insertBefore(pwWrap, box.lastChild);
        else box.appendChild(pwWrap);
      } catch (e) {
        try { box.appendChild(pwWrap); } catch (e2) { /* review stands */ }
      }
    }

    var wrap = mk(doc, "div", null, "unlock-confirm-wrap");
    try { wrap.appendChild(box); } catch (e) { /* overlay shows bare box */ }

    /* wipe: clear the password input (belt — unmount drops it anyway).
     * Never throws. */
    function wipe() {
      try { if (pwInput) pwInput.value = ""; } catch (e) { /* gone */ }
    }

    /* showError: in-modal error line (never blank, never throws). */
    function showError(msg) {
      try {
        if (pwErr) {
          pwErr.textContent = msg || t("unlockconfirm.unlock_failed", "Unlock failed.");
          pwErr.style.display = "";
        }
      } catch (e) { /* review stands */ }
    }

    /* dismiss: any cancel path (buttons/Esc/backdrop/hashchange/close()).
     * Wipes, detaches, fires onCancel at most once — never after success. */
    function dismiss() {
      if (settled !== "") return;
      settled = "bye";
      wipe();
      detachHash();
      try { if (handle) handle.close(); } catch (e) { /* detached */ }
      onCancel();
    }

    /* submit: Send click. Empty password errors inline without an unlock
     * attempt; doubles blocked by the pending flag + disabled button.
     * Unlock runs through the sole keystore; the password local is nulled
     * on BOTH outcomes (H2). Success closes first, then fires onUnlocked
     * (caller never sees the password). Failure renders in-modal and the
     * modal stays open for retry. */
    function submit() {
      if (settled !== "" || pending) return;
      if (!needPassword) {
        settled = "ok";
        detachHash();
        try { if (handle) handle.close(); } catch (e) { /* detached */ }
        cfg.onUnlocked();
        return;
      }
      var pw = "";
      try { pw = pwInput ? (pwInput.value || "") : ""; } catch (e) { pw = ""; }
      if (!pw) {
        showError(t("unlockconfirm.empty_password", "Enter your wallet password."));
        try { if (pwInput && typeof pwInput.focus === "function") pwInput.focus(); } catch (e) { /* error stands */ }
        return;
      }
      pending = true;
      try { if (sendBtn) sendBtn.disabled = true; } catch (e) { /* flag blocks */ }
      try { if (pwErr) pwErr.style.display = "none"; } catch (e) { /* next paint */ }
      Promise.resolve()
        .then(function () { return W.unlock(pw); })
        .then(function () {
          pw = "";
          wipe();
          if (settled !== "") return;
          settled = "ok";
          pending = false;
          detachHash();
          try { if (handle) handle.close(); } catch (e) { /* detached */ }
          cfg.onUnlocked();
        })
        .catch(function (e) {
          pw = "";
          wipe();
          if (settled !== "") return;
          pending = false;
          try { if (sendBtn) sendBtn.disabled = false; } catch (e2) { /* flag governs */ }
          var msg = "";
          try {
            if (typeof cfg.errorFor === "function") msg = cfg.errorFor(e);
            else msg = (e && e.message) ? e.message : String(e || "");
          } catch (e3) { msg = ""; }
          showError(msg || t("unlockconfirm.unlock_failed", "Unlock failed."));
          try { if (pwInput && typeof pwInput.focus === "function") pwInput.focus(); } catch (e4) { /* error stands */ }
        });
    }

    /* detachHash: remove the route guard (every close path runs this). */
    function detachHash() {
      try {
        if (hashOn && hashBy && typeof hashOn.removeEventListener === "function") hashOn.removeEventListener("hashchange", hashBy);
      } catch (e) { /* listener is best-effort */ }
      hashOn = null;
      hashBy = null;
    }

    /* returnFocus rides through only when the caller set it: Overlay
     * distinguishes "absent" (return to opener) from explicit null (stay),
     * so an always-present key with undefined value would wrongly suppress
     * focus return. */
    var overlayCfg = {
      content: wrap,
      onClose: function () { dismiss(); }
    };
    if (cfg.className) overlayCfg.className = cfg.className;
    if (Object.prototype.hasOwnProperty.call(cfg, "returnFocus")) overlayCfg.returnFocus = cfg.returnFocus;
    handle = Overlay.open(overlayCfg);

    /* Route guard: a hashchange with the modal up dismisses as cancel (an
     * orphan overlay over a new page is never correct). In-flight unlock
     * resolving after a route leave still fires onUnlocked — callers with
     * mount generations (myGen !== gen) absorb it; the modal itself is gone
     * and the password already wiped. */
    try {
      var ht = hashTarget(doc);
      if (ht && typeof ht.addEventListener === "function") {
        hashOn = ht;
        hashBy = function () { dismiss(); };
        ht.addEventListener("hashchange", hashBy);
      }
    } catch (e) { hashOn = null; hashBy = null; }

    /* Focus: password input when locked (confirm's Back focus loses to this
     * on purpose — the next action is typing); confirm-only keeps
     * ConfirmDialog's Back focus. All guarded. */
    try {
      if (needPassword && pwInput && typeof pwInput.focus === "function") pwInput.focus();
    } catch (e) { /* tab order stands */ }

    return {
      /* close: caller-initiated dismiss (counts as cancel, fires once). */
      close: function () { dismiss(); }
    };
  }

  return { open: open };
})();

if (typeof window !== "undefined") /** @type {any} */ (window).UnlockConfirm = UnlockConfirm;
if (typeof module !== "undefined") module.exports = UnlockConfirm;
