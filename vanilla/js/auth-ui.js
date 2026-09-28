/* auth-ui.js — login + registration views (stub-batch 2, matrix §A A10-A13).
 * Owns: /login (password -> Wallet.unlock, slice-02 path), /registration
 *   (choice hub), /registration/local (points at /create-wallet-brainkey),
 *   /registration/cloud (points at /create-account faucet flow). Thin views:
 *   no crypto, no key derivation, no faucet POST here — every action
 *   delegates to the proven slice-02 screens. Nothing is duplicated.
 * Consumes: Wallet (isUnlocked/unlock only), Chain (status), Store
 *   (connection subscribe for the login gate). Global AuthUI only; gen
 *   counter tears down stale work.
 * Refs: App.jsx:542-553 (Login, RegistrationSelector, WalletRegistration,
 *   AccountRegistration); astro create_account.astro (form only — Beet
 *   signing NOT copied). No amounts on screen: no Format vectors apply.
 * Created by: stub-queue build (matrix §A STUB queue, batch 2).
 */
var AuthUI = (function () {
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
  /* textContent-only element (user/chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  /* Touch floor (#7): interactive elements >= 44px one dimension. */
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("auth.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("auth.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  /* Labeled input row with its own inline error slot. */
  function fieldRow(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input"); input.type = opts.type || "text";
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    if (opts.id) input.id = opts.id;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    touchable(input); label.appendChild(input); row.appendChild(label);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite"); err.style.display = "none"; row.appendChild(err);
    return { row: row, input: input, err: err }; }
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : t("auth.none", "none"); }
  /* Backend guard: loud inline error when Wallet failed to load. */
  function walletMissing(doc, wrap) {
    if (typeof Wallet === "undefined" || !Wallet) {
      showError(doc, wrap, t("auth.wallet_backend_missing_js_wallet_js_failed_to", "Wallet backend missing: js/wallet.js failed to load."));
      return true;
    }
    return false; }
  /* Internal link paragraph (href + text pairs). */
  function linkPara(doc, pairs) {
    var p = el(doc, "p", null, "muted");
    pairs.forEach(function (pr, i) {
      if (i > 0) p.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a"); a.href = pr[0]; a.textContent = pr[1]; p.appendChild(a);
    });
    return p; }

  /* /login — password form straight into Wallet.unlock (wallet-ui.js owns
   * the same call; this view adds no new crypto path). */
  function renderLogin(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("auth.login", "Login")));
    if (walletMissing(doc, wrap)) return;
    var unlocked = false;
    try { unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys; }
    catch (e) { unlocked = false; }
    if (unlocked) {
      wrap.appendChild(el(doc, "p", t("auth.your_wallet_is_already_unlocked_on_this_devic", "Your wallet is already unlocked on this device."), "muted"));
      wrap.appendChild(linkPara(doc, [
        ["#/accounts", t("auth.open_accounts", "Open accounts")],
        ["#/wallet", t("auth.wallet_manager", "Wallet manager")]
      ]));
      return;
    }
    wrap.appendChild(el(doc, "p", t("auth.enter_your_wallet_password_to_unlock_the_keys", "Enter your wallet password to unlock the keys stored on this device."), "muted"));
    var f = fieldRow(doc, t("auth.password", "Password "), { id: "login-password", type: "password" });
    wrap.appendChild(f.row);
    var btn = touchable(el(doc, "button", t("auth.unlock", "Unlock")));
    btn.id = "login-do"; btn.type = "button"; wrap.appendChild(btn);
    btn.addEventListener("click", function () {
      setFieldError(f, ""); btn.disabled = true;
      if (!f.input.value) { setFieldError(f, t("auth.password_required_enter_a_non_empty_password", "Password required: enter a non-empty password.")); btn.disabled = false; return; }
      Promise.resolve().then(function () { return Wallet.unlock(f.input.value); })
        .then(function () {
          if (myGen !== gen) return;
          clearRoot(root);
          var done = makeWrap(doc, root);
          done.appendChild(el(doc, "h1", t("auth.login", "Login")));
          done.appendChild(el(doc, "p", t("auth.wallet_unlocked", "Wallet unlocked."), "muted"));
          done.appendChild(linkPara(doc, [
            ["#/accounts", t("auth.open_accounts", "Open accounts")],
            ["#/wallet", t("auth.wallet_manager", "Wallet manager")]
          ]));
        })
        .catch(function (e) {
          if (myGen !== gen) return;
          btn.disabled = false;
          setFieldError(f, (e && e.message) ? e.message : String(e || t("auth.unlock_failed", "Unlock failed")));
        });
    });
    wrap.appendChild(linkPara(doc, [
      ["#/create-wallet-brainkey", t("auth.no_wallet_yet_create_one", "No wallet yet? Create one")],
      ["#/existing-account", t("auth.import_existing_account", "Import existing account")]
    ]));
  }

  /* /registration — choice hub. Every option links at the proven screens. */
  function renderRegistration(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("auth.registration", "Registration")));
    wrap.appendChild(el(doc, "p", t("auth.pick_how_to_get_started_registration_itself_h", "Pick how to get started. Registration itself happens on the linked screens — this page only points."), "muted"));
    var list = doc.createElement("ul");
    [["#/registration/local", t("auth.local_wallet_create_keys_on_this_device", "Local wallet — create keys on this device")],
     ["#/registration/cloud", t("auth.cloud_style_account_register_a_name_via_the_f", "Cloud-style account — register a name via the faucet")],
     ["#/create-account", t("auth.register_a_new_on_chain_account_testnet_fauce", "Register a new on-chain account (testnet faucet)")],
     ["#/existing-account", t("auth.import_an_existing_account_brainkey", "Import an existing account (brainkey)")]].forEach(function (pr) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.href = pr[0]; a.textContent = pr[1]; li.appendChild(a); list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  /* /registration/local — explainer + delegate to the slice-02 create screen. */
  function renderLocal(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("auth.local_registration", "Local registration")));
    wrap.appendChild(el(doc, "p", t("auth.a_local_wallet_creates_a_brainkey_on_this_dev", "A local wallet creates a brainkey on this device and derives the owner, active and memo keys from it. Keys never leave the device; the wallet file is encrypted with your password."), "muted"));
    wrap.appendChild(linkPara(doc, [
      ["#/create-wallet-brainkey", t("auth.create_a_local_wallet", "Create a local wallet")],
      ["#/existing-account", t("auth.import_existing_account", "Import existing account")],
      ["#/registration", t("auth.back_to_registration", "Back to registration")]
    ]));
  }

  /* /registration/cloud — explainer + delegate to the faucet create screen. */
  function renderCloud(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("auth.cloud_registration", "Cloud registration")));
    wrap.appendChild(el(doc, "p", t("auth.cloud_style_registration_picks_an_account_nam", "Cloud-style registration picks an account name and registers it through the faucet, which pays the creation fee. On testnet this is free; on mainnet a faucet or registrar must sponsor the name."), "muted"));
    wrap.appendChild(linkPara(doc, [
      ["#/create-account", t("auth.register_via_the_faucet", "Register via the faucet")],
      ["#/registration", t("auth.back_to_registration", "Back to registration")]
    ]));
  }

  return { renderLogin: renderLogin, renderRegistration: renderRegistration,
    renderLocal: renderLocal, renderCloud: renderCloud };
})();

if (typeof module !== "undefined") { module.exports = AuthUI; }
