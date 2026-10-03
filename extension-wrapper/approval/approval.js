/* Approval page: human consent for Tier 2 signing (P3).
 * Owns: intent render (origin/wallet-self label, account, chain, per-op
 *   field tables from the SW-enriched journal receipt), 60s countdown
 *   display, optional password (only when the SW session is locked),
 *   remember-checkbox (dApp origins only — wallet-self always prompts),
 *   Approve/Deny dispatch, result panel (broadcast proof or denial reason).
 * Trust: this page runs in the extension origin; it renders ONLY the
 *   journal receipt fetched from the SW (never page-supplied data) and the
 *   SW re-validates shape pre-sign. Closing the tab without deciding
 *   denies (SW onTabRemoved) — closing is never consent.
 * Consumes: chrome/browser.runtime messaging (vb-intent-get/vb-approve/
 *   vb-deny/vb-session-state), I18n.t (guarded en defaults; approval.*
 *   keys land in vanilla/locales via the Tier 2 i18n batch), vanilla
 *   themes.css/app.css (retro familiarity — same look as in-page confirms).
 *   No key material held past the approve call (password local wiped on
 *   either outcome, same H2 discipline as the wallet unlock boxes).
 * Globals/side effects: DOM under #view only. No module export (page entry).
 * Created by: extension Tier 2 build (P3 batch).
 */
(function () {
  "use strict";

  /* Display strings resolve via I18n.t with the pre-conversion literal kept
   * verbatim as enDefault (slice-17 batch-2b precedent). Falls back to the
   * default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function touchable(n) {
    try { n.style.minHeight = "44px"; } catch (e) { /* native stands */ }
    return n;
  }

  function ext() {
    try {
      if (typeof browser !== "undefined" && browser && browser.runtime) return browser;
      if (typeof chrome !== "undefined" && chrome && chrome.runtime) return chrome;
    } catch (e) { /* null below */ }
    return null;
  }

  /* send: one SW round-trip ({type...} -> reply or null on channel loss).
   * Params: msg object. Returns a Promise for the reply payload (rejects
   * with the SW error text). Never throws sync. */
  function send(msg) {
    return new Promise(function (resolve, reject) {
      var e = ext();
      if (!e || !e.runtime || typeof e.runtime.sendMessage !== "function") {
        reject(new Error(t("approval.no_runtime", "Extension runtime missing.")));
        return;
      }
      try {
        e.runtime.sendMessage(msg, function (reply) {
          try {
            if (e.runtime && e.runtime.lastError) {
              reject(new Error(e.runtime.lastError.message || "extension error"));
              return;
            }
          } catch (x) { /* reply below */ }
          if (!reply || typeof reply !== "object") {
            reject(new Error(t("approval.no_reply", "No reply from the signer.")));
            return;
          }
          if (reply.ok) resolve(reply.payload === undefined ? null : reply.payload);
          else reject(new Error((reply.error && String(reply.error)) ||
            t("approval.denied", "Denied.")));
        });
      } catch (x) { reject(x); }
    });
  }

  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function showError(doc, wrap, text) {
    var err = el(doc, "div", text, "error");
    try { err.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    wrap.appendChild(err);
  }

  /* Countdown paint: seconds left of the 60s approval window from the
   * intent createdAt. Display only — the SW alarm is the real deadline. */
  function paintCountdown(doc, host, createdAt, timerState) {
    try {
      var left = 60 - Math.floor(Math.max(0, Date.now() - createdAt) / 1000);
      if (left < 0) left = 0;
      host.textContent = t("approval.expires_in", "Expires in ") + left + "s";
      if (left <= 0 && !timerState.done) {
        timerState.done = true;
        try { clearInterval(timerState.timer); } catch (e) { /* stopped */ }
      }
    } catch (e) { /* countdown best-effort */ }
  }

  function renderIntent(doc, root, intent, unlocked) {
    clearRoot(root);
    var wrap = el(doc, "div", null, "wrap");
    root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", t("approval.title", "Approve signature")));
    var who = intent.walletSelf
      ? t("approval.wallet_title", "This wallet requests a signature")
      : t("approval.site_prefix", "Site: ") + intent.origin;
    wrap.appendChild(el(doc, "p", who, "muted"));
    var acct = el(doc, "p", t("approval.account", "Account: ") + intent.accountId, "muted");
    wrap.appendChild(acct);
    try {
      var chainShort = String(intent.chainId || "").slice(0, 8).toUpperCase();
      if (chainShort) {
        wrap.appendChild(el(doc, "p", t("approval.chain", "Chain: ") + chainShort, "muted"));
      }
    } catch (e) { /* chain line best-effort */ }
    (intent.enriched && Array.isArray(intent.enriched.ops) ? intent.enriched.ops : []).forEach(function (op) {
      wrap.appendChild(el(doc, "h2", "op " + op.id + ": " + (op.name || ("Operation " + op.id))));
      var dl = el(doc, "dl", null, "xfer-confirm");
      (Array.isArray(op.fields) ? op.fields : []).forEach(function (f) {
        dl.appendChild(el(doc, "dt", String(f.k)));
        dl.appendChild(el(doc, "dd", String(f.v)));
      });
      if (!dl.firstChild) dl.appendChild(el(doc, "dd", t("approval.no_fields", "No displayable fields.")));
      wrap.appendChild(dl);
    });
    var countNote = el(doc, "p", "", "muted");
    try { countNote.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    wrap.appendChild(countNote);
    var timerState = { done: false, timer: null };
    paintCountdown(doc, countNote, intent.createdAt, timerState);
    try {
      timerState.timer = setInterval(function () {
        paintCountdown(doc, countNote, intent.createdAt, timerState);
      }, 1000);
    } catch (e) { /* static note stands */ }
    var out = el(doc, "div", null, "xfer-out");
    wrap.appendChild(out);
    if (intent.status !== "pending") {
      /* Settled before render (timeout raced the tab): show the outcome,
       * offer Close only — no decision buttons on a dead intent. */
      finish(intent.status === "approved", intent.proof || intent.error, true);
      return;
    }
    var rememberRow = null, rememberBox = null;
    if (!intent.walletSelf) {
      rememberRow = el(doc, "div", null, "xfer-field");
      var rlab = el(doc, "label", "");
      rememberBox = doc.createElement("input");
      rememberBox.type = "checkbox";
      rememberBox.checked = true;
      touchable(rememberBox);
      rlab.appendChild(rememberBox);
      rlab.appendChild(el(doc, "span", " " + t("approval.remember", "Remember this account for this site")));
      rememberRow.appendChild(rlab);
      wrap.appendChild(rememberRow);
    }
    var pwInput = null;
    if (!unlocked) {
      wrap.appendChild(el(doc, "p",
        t("approval.locked_note", "Session is locked — enter your wallet password to approve."), "muted"));
      pwInput = doc.createElement("input");
      pwInput.type = "password";
      pwInput.setAttribute("autocomplete", "current-password");
      pwInput.setAttribute("aria-label", t("approval.password", "Password"));
      touchable(pwInput);
      wrap.appendChild(pwInput);
    }
    var row = el(doc, "div", null, "pools-offline-row");
    wrap.appendChild(row);
    var approve = touchable(el(doc, "button", t("approval.approve", "Approve")));
    approve.type = "button";
    var deny = touchable(el(doc, "button", t("approval.deny", "Deny")));
    deny.type = "button";
    row.appendChild(approve);
    row.appendChild(deny);

    /* finish: decision sent — replace the form with the outcome + Close.
     * Params: ok bool, detail (proof object or error text), settledAlready
     * (skip re-sending when the intent was already dead on arrival). */
    function finish(ok2, detail, silent) {
      try { timerState.done = true; clearInterval(timerState.timer); } catch (e) { /* stopped */ }
      clearRoot(root);
      var w2 = el(doc, "div", null, "wrap");
      root.appendChild(w2);
      w2.appendChild(el(doc, "h1", t("approval.title", "Approve signature")));
      if (ok2) {
        var via = "";
        try { via = detail && detail.via ? String(detail.via) : ""; } catch (e) { via = ""; }
        w2.appendChild(el(doc, "p",
          t("approval.approved", "Approved and broadcast.") + (via ? " (" + via + ")" : ""), "xfer-ok"));
      } else {
        showError(doc, w2, (detail && detail.via) ? JSON.stringify(detail) :
          t("approval.denied", "Denied.") + (detail ? " " + String(detail) : ""));
      }
      var close = touchable(el(doc, "button", t("approval.close", "Close")));
      close.type = "button";
      close.addEventListener("click", function () {
        try { window.close(); } catch (e) { /* user closes manually */ }
      });
      w2.appendChild(close);
      if (!silent) {
        try { if (pwInput) pwInput.value = ""; } catch (e) { /* wiped above */ }
      }
    }

    approve.addEventListener("click", function () {
      approve.disabled = true;
      deny.disabled = true;
      var pw = "";
      try { pw = pwInput ? pwInput.value : ""; } catch (e) { pw = ""; }
      try { if (pwInput) pwInput.value = ""; } catch (e) { /* wiped */ }
      var remember = false;
      try { remember = rememberBox ? (rememberBox.checked === true) : false; } catch (e) { remember = false; }
      send({ type: "vb-approve", intentId: intent.id, password: pw, remember: remember }).then(
        function (proof) { pw = null; finish(true, proof, false); },
        function (e) { pw = null; finish(false, (e && e.message) || String(e), false); });
    });
    deny.addEventListener("click", function () {
      approve.disabled = true;
      deny.disabled = true;
      try { if (pwInput) pwInput.value = ""; } catch (e) { /* wiped */ }
      send({ type: "vb-deny", intentId: intent.id }).then(
        function () { finish(false, t("approval.denied", "Denied."), false); },
        function () { finish(false, t("approval.denied", "Denied."), false); });
    });
  }

  /* Boot: theme (extension-origin settings, best-effort), hash intent id,
   * session state, intent fetch, render. Every failure paints honestly —
   * this page never blanks. */
  function boot() {
    if (typeof document === "undefined") return;
    var doc = document;
    var root = doc.getElementById("view");
    if (!root) return;
    try {
      var raw = null;
      try {
        if (typeof localStorage !== "undefined") {
          raw = localStorage.getItem("bts-vanilla-settings-v1");
        }
      } catch (e) { raw = null; }
      if (raw) {
        var s = JSON.parse(raw);
        if (s && typeof s.theme === "string" && s.theme) {
          doc.documentElement.setAttribute("data-theme", s.theme);
        }
      }
    } catch (e) { /* default theme stands */ }
    var intentId = "";
    try {
      intentId = String((typeof location !== "undefined" && location.hash) || "").replace(/^#/, "");
    } catch (e) { intentId = ""; }
    if (!intentId) {
      showError(doc, root, t("approval.unknown_intent", "No approval request found."));
      return;
    }
    root.appendChild(el(doc, "p", t("approval.loading", "Loading approval…"), "muted"));
    send({ type: "vb-session-state" }).then(function (st) {
      return send({ type: "vb-intent-get", intentId: intentId }).then(function (intent) {
        renderIntent(doc, root, intent, !!(st && st.unlocked));
      });
    }).catch(function (e) {
      clearRoot(root);
      showError(doc, root, (e && e.message) || String(e),
        t("approval.load_failed", "Could not load the approval."));
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
})();
