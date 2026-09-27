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
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (msg.indexOf("not connected") !== -1) msg = "Network unavailable. Check Settings → Nodes and retry.";
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
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : "none"; }
  /* Backend guard: loud inline error when Wallet failed to load. */
  function walletMissing(doc, wrap) {
    if (typeof Wallet === "undefined" || !Wallet) {
      showError(doc, wrap, "Wallet backend missing: js/wallet.js failed to load.");
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
    wrap.appendChild(el(doc, "h1", "Login"));
    if (walletMissing(doc, wrap)) return;
    var unlocked = false;
    try { unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys; }
    catch (e) { unlocked = false; }
    if (unlocked) {
      wrap.appendChild(el(doc, "p", "Your wallet is already unlocked on this device.", "muted"));
      wrap.appendChild(linkPara(doc, [
        ["#/accounts", "Open accounts"],
        ["#/wallet", "Wallet manager"]
      ]));
      return;
    }
    wrap.appendChild(el(doc, "p", "Enter your wallet password to unlock the keys stored on this device.", "muted"));
    var f = fieldRow(doc, "Password ", { id: "login-password", type: "password" });
    wrap.appendChild(f.row);
    var btn = touchable(el(doc, "button", "Unlock"));
    btn.id = "login-do"; btn.type = "button"; wrap.appendChild(btn);
    btn.addEventListener("click", function () {
      setFieldError(f, ""); btn.disabled = true;
      if (!f.input.value) { setFieldError(f, "Password required: enter a non-empty password."); btn.disabled = false; return; }
      Promise.resolve().then(function () { return Wallet.unlock(f.input.value); })
        .then(function () {
          if (myGen !== gen) return;
          clearRoot(root);
          var done = makeWrap(doc, root);
          done.appendChild(el(doc, "h1", "Login"));
          done.appendChild(el(doc, "p", "Wallet unlocked.", "muted"));
          done.appendChild(linkPara(doc, [
            ["#/accounts", "Open accounts"],
            ["#/wallet", "Wallet manager"]
          ]));
        })
        .catch(function (e) {
          if (myGen !== gen) return;
          btn.disabled = false;
          setFieldError(f, (e && e.message) ? e.message : String(e || "Unlock failed"));
        });
    });
    wrap.appendChild(linkPara(doc, [
      ["#/create-wallet-brainkey", "No wallet yet? Create one"],
      ["#/existing-account", "Import existing account"]
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
    wrap.appendChild(el(doc, "h1", "Registration"));
    wrap.appendChild(el(doc, "p", "Pick how to get started. Registration itself happens on the linked screens — this page only points.", "muted"));
    var list = doc.createElement("ul");
    [["#/registration/local", "Local wallet — create keys on this device"],
     ["#/registration/cloud", "Cloud-style account — register a name via the faucet"],
     ["#/create-account", "Register a new on-chain account (testnet faucet)"],
     ["#/existing-account", "Import an existing account (brainkey)"]].forEach(function (pr) {
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
    wrap.appendChild(el(doc, "h1", "Local registration"));
    wrap.appendChild(el(doc, "p", "A local wallet creates a brainkey on this device and derives the owner, active and memo keys from it. Keys never leave the device; the wallet file is encrypted with your password.", "muted"));
    wrap.appendChild(linkPara(doc, [
      ["#/create-wallet-brainkey", "Create a local wallet"],
      ["#/existing-account", "Import existing account"],
      ["#/registration", "Back to registration"]
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
    wrap.appendChild(el(doc, "h1", "Cloud registration"));
    wrap.appendChild(el(doc, "p", "Cloud-style registration picks an account name and registers it through the faucet, which pays the creation fee. On testnet this is free; on mainnet a faucet or registrar must sponsor the name.", "muted"));
    wrap.appendChild(linkPara(doc, [
      ["#/create-account", "Register via the faucet"],
      ["#/registration", "Back to registration"]
    ]));
  }

  return { renderLogin: renderLogin, renderRegistration: renderRegistration,
    renderLocal: renderLocal, renderCloud: renderCloud };
})();

if (typeof module !== "undefined") { module.exports = AuthUI; }
