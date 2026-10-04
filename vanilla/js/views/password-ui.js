/* password-ui.js — keystore password-change view (matrix C34).
 * Owns: #/wallet/password (verify current password -> re-encrypt the local
 *   keystore with the new password -> lock + unlock-with-new proof).
 *   KEYSTORE-LOCAL ONLY: this changes the AES-GCM envelope password in
 *   localStorage. It is NOT astro-ui's on-chain cloud-password op
 *   (ChangePassword.jsx builds an account_update broadcast) — no serializers,
 *   no broadcasts here by design. Re-encryption reuses Wallet.unlock +
 *   Wallet.create (which re-derives from the in-memory brainkey and writes a
 *   fresh random-salt envelope); keys never leave Wallet's memory-only state.
 * Consumes: Wallet.unlock/create/lock/isUnlocked/getBrainkey (js/wallet.js).
 *   No Chain, no Account, no Format (no amounts on screen).
 * Globals/side effects: DOM under root only; localStorage envelope rewrite
 *   via Wallet.create; global PasswordUI. Gen counter tears down stale async.
 * Refs: slice-02 keystore (PBKDF2-600k/AES-GCM, wallet.js:10-24);
 *   wallet-extension keystore discipline (verify-before-rewrite, #3).
 * Created by: deferred-matrix close-out (C30/C31/C34/C35 batch).
 */
var PasswordUI = (function () {
  "use strict";

  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. vars supports
   * %(name)s templates at a few asset/named-count labels. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  var gen = 0;
  /* No local el — use DOM.el */
  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
/* clearRoot removed — use DOM.clear */
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error line (aria-live so failures are announced). */
  function makeError(doc) {
    var err = DOM.el(doc, "div", null, "error"); err.setAttribute("aria-live", "polite"); return err;
  }
  /* Labeled password row via the shared Forms seam (Task 2.2):
   * identical contract — div.xfer-field > label(text + " ") > input. */
  function pwRow(doc, labelText, id) {
    var seam = Forms.labeledInput(doc, labelText + " ", {
      id: id, type: "password", autocomplete: "new-password" });
    seam.input.setAttribute("spellcheck", "false");
    return seam;
  }

  /* Backend guard: loud inline panel when js/wallet.js failed to load. */
  function backendMissing() {
    return (typeof Wallet === "undefined" || !Wallet);
  }

  /* Route entry. States: (1) no wallet stored -> honest pointer to
   * create/import; (2) form -> verify + re-encrypt + proof; (3) success panel
   * (wallet left LOCKED so no key material lingers past the proof). */
  function renderPassword(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.pageHead(doc, t("password.change_wallet_password", "Change wallet password"), "key"));
    if (backendMissing()) {
      var missing = makeError(doc);
      missing.textContent = t("password.wallet_backend_missing_js_wallet_js_failed_to", "Wallet backend missing: js/wallet.js failed to load.");
      wrap.appendChild(missing);
      return;
    }
    wrap.appendChild(DOM.el(doc, "p",
      "Changes the password that encrypts this device's wallet copy. " +
      "Your brainkey and keys do not change — only the local lock on them. " +
      "Nothing is broadcast; this never touches the chain.",
      "muted"));
    /* No-wallet probe: localStorage envelope absent -> point at create/import
     * instead of a password form that could only fail. */
    var hasWallet = true;
    try {
      if (typeof localStorage !== "undefined" &&
          !localStorage.getItem("bts-vanilla-wallet-v1")) hasWallet = false;
    } catch (e) { /* unreadable storage: let unlock surface it */ }
    if (!hasWallet) {
      wrap.appendChild(DOM.el(doc, "p", t("password.no_wallet_stored_on_this_device_yet_there_is", "No wallet stored on this device yet — there is no password to change."), "muted"));
      var p = DOM.el(doc, "p", null, "muted");
      [["#/create-wallet-brainkey", t("password.create_new_wallet", "Create new wallet")],
       ["#/existing-account", t("common.import_existing", "Import existing account")]].forEach(function (pr, i) {
        if (i > 0) p.appendChild(doc.createTextNode(" · "));
        var a = doc.createElement("a"); a.href = pr[0]; a.textContent = pr[1]; p.appendChild(a);
      });
      wrap.appendChild(p);
      return;
    }
    var cur = pwRow(doc, t("password.current_password", "Current password"), "pwcur-password");
    var nw = pwRow(doc, t("password.new_password", "New password"), "pwcur-new");
    var cf = pwRow(doc, t("password.confirm_new_password", "Confirm new password"), "pwcur-confirm");
    wrap.appendChild(cur.row); wrap.appendChild(nw.row); wrap.appendChild(cf.row);
    var btn = touchable(DOM.el(doc, "button", t("password.change_password", "Change password")));
    btn.id = "pwcur-do"; btn.type = "button"; wrap.appendChild(btn);
    var err = makeError(doc); wrap.appendChild(err);
    var ok = DOM.el(doc, "p", "", "xfer-ok");
    ok.setAttribute("aria-live", "polite"); wrap.appendChild(ok);
    btn.addEventListener("click", function () {
      err.textContent = ""; ok.textContent = "";
      /* H2: password locals + inputs are wiped on either outcome (the wipe
       * in catch runs before the stale-view bail — wiping never skipped). */
      var curPw = cur.input.value, newPw = nw.input.value, cfmPw = cf.input.value;
      if (!curPw) { err.textContent = t("password.enter_your_current_password", "Enter your current password."); return; }
      if (!newPw) { err.textContent = t("password.enter_a_new_password", "Enter a new password."); return; }
      if (newPw !== cfmPw) { err.textContent = t("password.new_passwords_do_not_match", "New passwords do not match."); return; }
      if (newPw === curPw) { err.textContent = t("password.the_new_password_is_the_same_as_the_current_o", "The new password is the same as the current one — nothing to change."); return; }
      btn.disabled = true; btn.textContent = t("password.verifying", "Verifying…");
      Promise.resolve()
        .then(function () { return Wallet.unlock(curPw); })
        .then(function () {
          if (myGen !== gen) throw new Error("stale-view");
          var bk = Wallet.getBrainkey();
          btn.textContent = t("password.re_encrypting", "Re-encrypting…");
          return Wallet.create(newPw, bk);
        })
        .then(function () {
          if (myGen !== gen) throw new Error("stale-view");
          /* Proof: lock, then unlock with the NEW password. Failure here
           * surfaces honestly — the envelope was rewritten, so a proof
           * failure is reported, never swallowed. */
          Wallet.lock();
          btn.textContent = t("password.verifying_new_password", "Verifying new password…");
          return Wallet.unlock(newPw);
        })
        .then(function () {
          if (myGen !== gen) return;
          Wallet.lock(); /* leave locked: no keys linger past the proof */
          btn.disabled = false; btn.textContent = t("password.change_password", "Change password");
          cur.input.value = ""; nw.input.value = ""; cf.input.value = "";
          curPw = null; newPw = null; cfmPw = null;
          ok.textContent = t("password.password_changed_and_verified_the_wallet_is_l", "Password changed and verified — the wallet is locked. Unlock with the new password to continue.");
        })
        .catch(function (e) {
          cur.input.value = ""; nw.input.value = ""; cf.input.value = "";
          curPw = null; newPw = null; cfmPw = null;
          if (myGen !== gen) return;
          btn.disabled = false; btn.textContent = t("password.change_password", "Change password");
          var msg = (e && e.message) ? e.message : String(e || t("password.password_change_failed", "Password change failed"));
          if (msg === "stale-view") return;
          if (msg.indexOf("wrong password") === 0) msg = t("password.current_password_is_incorrect_nothing_was_cha", "Current password is incorrect — nothing was changed.");
          err.textContent = msg;
        });
    });
    var back = DOM.el(doc, "p", null, "muted");
    var a = doc.createElement("a"); a.href = "#/wallet"; a.textContent = t("password.back_to_wallet_manager", "Back to Wallet manager");
    back.appendChild(a); wrap.appendChild(back);
  }

  return { renderPassword: renderPassword };
})();

if (typeof module !== "undefined") { module.exports = PasswordUI; }
