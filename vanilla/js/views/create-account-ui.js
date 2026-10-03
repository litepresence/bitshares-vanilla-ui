/* create-account-ui.js — faucet account-creation view (registrar flow).
 * Owns: /create-account (name availability check, faucet register, result panel
 *   with backup + save-to-wallet). Reuses the slice-2 faucet contract (proven for
 *   t9-vanilla-6742): POST {account:{name,owner_key,active_key,memo_key}}, then
 *   get_account_by_name verify. Keys derive seq0/1/2 like Wallet.create
 *   (wallet.js); saving goes through Wallet.create — nothing reinvented.
 * Consumes: Crypto (suggestBrainkey/normalizeBrainkey/brainPrivateKeyHex/
 *   keypairFromPrivateHex), Account.resolve (availability), Wallet.create, Chain,
 *   Store (network + connection subscribe). fetch + AbortController only.
 * Global CreateAccountUI only; gen counter tears down stale work. The brainkey
 *   shows once read-only for backup; WIFs never touch the DOM (public keys only).
 * Refs: faucet POST <- WalletActions.js:105-145; name UX <- AccountRegistration
 *   Form.jsx + astro CreateAccount.jsx; faucet proof <- slice-02 §3e
 *   (testnet-faucet.xbts.io ALIVE; old EU faucet dead, NOT used).
 * Scope (stated): testnet only. On mainnet the view stays honest (name check
 *   works; register disabled with a Settings pointer). No amounts here: the result
 *   shows object ids (1.2.N) and public keys only — never key material.
 * Created by: stub-queue build (matrix §A row A9).
 */
var CreateAccountUI = (function () {
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
  var FAUCET_URL = "https://testnet-faucet.xbts.io/api/v1/accounts";
  var FETCH_TIMEOUT_MS = 20000;
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
  /* Inline error panel, never blank: any thrown value maps to text. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("createaccount.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("createaccount.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  /* Status line for multi-step flows (checking → registering → verifying). */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite");
    wrap.appendChild(p); return p; }
  /* Labeled input row with its own inline error slot. */
  function fieldRow(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input"); input.type = opts.type || "text";
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    if (opts.id) input.id = opts.id;
    if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    touchable(input); label.appendChild(input); row.appendChild(label);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite"); err.style.display = "none"; row.appendChild(err);
    return { row: row, input: input, err: err }; }
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : t("createaccount.none", "none"); }
  /* Settings network (sole owner: Store); testnet enables the faucet. */
  function networkName() {
    try {
      var s = Store.loadSettings();
      if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
    } catch (e) { /* default stands */ }
    return "mainnet"; }
  /* Graphene name shape (port of the rule #1 enforces via ChainValidation:
   * lowercase, starts with a letter, [a-z0-9.-] inside, dot labels 1..63).
   * The faucet + get_account_by_name stay the final validators. */
  function nameFormatError(name) {
    if (!name) return t("createaccount.enter_an_account_name", "Enter an account name.");
    if (name.length > 63) return t("createaccount.account_names_are_at_most_63_characters", "Account names are at most 63 characters.");
    if (!/^[a-z][a-z0-9.\-]*$/.test(name)) return t("createaccount.lowercase_letters_only_starting_with_a_letter", "Lowercase letters only, starting with a letter (digits, dots and dashes allowed).");
    var labels = name.split(".");
    for (var i = 0; i < labels.length; i++) {
      if (!labels[i] || labels[i].length > 63) return t("createaccount.each_dot_separated_part_must_be_1_63_characte", "Each dot-separated part must be 1–63 characters.");
      if (labels[i].length > 1 && !/^[a-z][a-z0-9\-]*[a-z0-9]$/.test(labels[i])) return t("createaccount.each_dot_separated_part_must_start_with_a_let", "Each dot-separated part must start with a letter and end with a letter or digit.");
    }
    return null;
  }

  /** Route entry. Gates backends, waits for the shared socket (transfer-ui.js
   * connect-wait pattern), then paints the form.
   * @param {HTMLElement} root router mount element */
  function renderCreateAccount(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Crypto === "undefined" || !Crypto || typeof Account === "undefined" || !Account ||
        typeof Wallet === "undefined" || !Wallet) {
      showError(doc, wrap, t("createaccount.account_backend_missing_js_crypto_js_js_accou", "Account backend missing: js/crypto.js, js/account.js or js/wallet.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "h1", t("createaccount.create_account", "Create Account")));
      wrap.appendChild(el(doc, "p", t("createaccount.connecting_to_network", "Connecting to network…"), "muted"));
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderCreateAccount(root);
        }
      });
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        clearRoot(root);
        showError(doc, makeWrap(doc, root), new Error("not connected"), t("createaccount.network_unavailable", "Network unavailable."));
      }, 15000);
      return;
    }
    paintForm(doc, root, myGen, { name: "", checked: null, takenId: null, brainkey: "" });
  }

  /** Creation form: name + Check, brainkey (generated, read-only, regenable),
   * Register. State survives re-renders via P.
   * @param {Document} doc owner document
   * @param {HTMLElement} root router mount element
   * @param {number} myGen route generation (liveness token)
   * @param {any} P form state {name, brainkey, checked, takenId} */
  function paintForm(doc, root, myGen, P) {
    if (myGen !== gen) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root), testnet = networkName() === "testnet";
    wrap.appendChild(el(doc, "h1", t("createaccount.create_account", "Create Account")));
    wrap.appendChild(el(doc, "p", testnet
      ? "Register a new testnet account through the faucet (testnet network)."
      : "Registration uses the testnet faucet — switch to testnet in Settings to register. Name checks work on either network.", "muted"));
    /* Punchlist MED: CREATE ACCOUNT vs LOGIN selector card (original
     * create-account.png). This form below is the create path; #/login
     * unlocks an existing wallet. Plain literals only. */
    (function selectorCard() {
      var card = el(doc, "div", null, "ca-selector");
      card.appendChild(el(doc, "strong", t("createaccount.selector_this_form", "Create account (this form)")));
      card.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a");
      a.href = "#/login";
      a.textContent = t("createaccount.login_instead", "Login instead");
      touchable(a);
      card.appendChild(a);
      wrap.appendChild(card);
    })();
    var nameF = fieldRow(doc, t("createaccount.account_name", "Account name "), { id: "ca-name", value: P.name, placeholder: "your-name", inputmode: "text" });
    wrap.appendChild(nameF.row);
    var checkBtn = touchable(el(doc, "button", t("createaccount.check_availability", "Check availability")));
    checkBtn.id = "ca-check"; checkBtn.type = "button"; wrap.appendChild(checkBtn);
    var avail = el(doc, "p", availabilityText(P), "muted");
    avail.id = "ca-avail"; avail.setAttribute("aria-live", "polite"); wrap.appendChild(avail);
    wrap.appendChild(el(doc, "h3", t("createaccount.brainkey_back_it_up", "Brainkey (back it up)")));
    wrap.appendChild(el(doc, "p", t("createaccount.a_fresh_brainkey_is_generated_for_the_new_acc", "A fresh brainkey is generated for the new account. Write it down — it derives the owner, active and memo keys."), "muted"));
    var bkArea = doc.createElement("textarea");
    bkArea.id = "ca-brainkey"; bkArea.rows = 3; bkArea.readOnly = true; bkArea.style.width = "100%";
    bkArea.setAttribute("spellcheck", "false"); bkArea.setAttribute("autocomplete", "off");
    bkArea.placeholder = t("createaccount.generating_brainkey", "Generating brainkey…");
    if (P.brainkey) bkArea.value = P.brainkey;
    wrap.appendChild(bkArea);
    var regenBtn = touchable(el(doc, "button", t("createaccount.generate_new_brainkey", "Generate new brainkey")));
    regenBtn.id = "ca-regen"; regenBtn.type = "button"; wrap.appendChild(regenBtn);
    var regBtn = touchable(el(doc, "button", testnet ? t("createaccount.register_account", "Register account") : t("createaccount.register_account_testnet_only", "Register account (testnet only)")));
    regBtn.id = "ca-register"; regBtn.type = "button";
    if (!testnet) regBtn.disabled = true;
    wrap.appendChild(regBtn);
    var out = el(doc, "div"); wrap.appendChild(out);
    /* LOW punchlist: restore-your-account / advanced-form links on this page
     * (original create-account.png). Batch-3 i18n: keyed, existing routes only. */
    (function restoreLinks() {
      var p = el(doc, "p", null, "muted");
      var a = doc.createElement("a");
      a.href = "#/existing-account";
      a.textContent = t("createaccount.restore_your_account", "Restore your account");
      touchable(a);
      p.appendChild(a);
      p.appendChild(doc.createTextNode(" · "));
      var b = doc.createElement("a");
      b.href = "#/registration/cloud";
      b.textContent = t("createaccount.advanced_form", "Advanced form");
      touchable(b);
      p.appendChild(b);
      wrap.appendChild(p);
    })();
    /* Brainkey source matches the wallet create screen: Crypto.suggestBrainkey. */
    if (!P.brainkey) genBrainkey(doc, myGen, P, out);
    nameF.input.addEventListener("input", function () {
      P.name = nameF.input.value.trim().toLowerCase(); P.checked = null; P.takenId = null;
      avail.textContent = availabilityText(P);
    });
    regenBtn.addEventListener("click", function () {
      out.innerHTML = ""; bkArea.placeholder = t("createaccount.generating_brainkey", "Generating brainkey…"); bkArea.value = ""; P.brainkey = "";
      genBrainkey(doc, myGen, P, out);
    });
    checkBtn.addEventListener("click", function () {
      setFieldError(nameF, ""); out.innerHTML = "";
      P.name = nameF.input.value.trim().toLowerCase(); nameF.input.value = P.name;
      var bad = nameFormatError(P.name);
      if (bad) { setFieldError(nameF, bad); return; }
      checkBtn.disabled = true;
      var status = showStatus(doc, out, t("createaccount.checking_name", "Checking name…"));
      checkAvailability(P.name).then(function (r) {
        if (myGen !== gen) return;
        P.checked = r.free ? "free" : "taken"; P.takenId = r.id || null;
        avail.textContent = availabilityText(P);
        out.removeChild(status); checkBtn.disabled = false;
      }).catch(function (e) {
        if (myGen !== gen) return;
        out.removeChild(status); checkBtn.disabled = false;
        showError(doc, out, e, t("createaccount.could_not_check_the_name", "Could not check the name."));
      });
    });
    regBtn.addEventListener("click", function () {
      setFieldError(nameF, ""); out.innerHTML = "";
      P.name = nameF.input.value.trim().toLowerCase(); nameF.input.value = P.name;
      var bad = nameFormatError(P.name);
      if (bad) { setFieldError(nameF, bad); return; }
      if (!P.brainkey) { showError(doc, out, new Error(t("createaccount.err_brainkey_wait", "Wait for the brainkey to generate first.")), null); return; }
      checkBtn.disabled = true; regBtn.disabled = true;
      var status = showStatus(doc, out, t("createaccount.checking_name", "Checking name…"));
      /* Re-check right before registering: names are first-come, so a stale
       * "free" must never send a doomed POST. */
      checkAvailability(P.name).then(function (r) {
        if (myGen !== gen) return null;
        if (!r.free) {
          P.checked = "taken"; P.takenId = r.id || null; avail.textContent = availabilityText(P);
          throw new Error("Name is already taken" + (r.id ? " (" + r.id + ")" : "") + ".");
        }
        P.checked = "free"; avail.textContent = availabilityText(P);
        status.textContent = t("createaccount.registering_with_the_faucet", "Registering with the faucet…");
        return registerViaFaucet(P.name, P.brainkey);
      }).then(function (reg) { if (reg && myGen === gen) paintResult(doc, root, myGen, P, reg); })
        .catch(function (e) {
          if (myGen !== gen) return;
          try { out.removeChild(status); } catch (err) { /* already replaced */ }
          checkBtn.disabled = false; regBtn.disabled = false;
          showError(doc, out, e, t("createaccount.registration_failed", "Registration failed."));
        });
    });
  }

  /** Generate a fresh brainkey into P + the visible textarea.
   * TYPE NOTE: the global Crypto object collides with DOM lib's Crypto
   * interface (constructor type), so its wallet methods read back missing;
   * casts pin it to any. Local casts only, nothing to merge.
   * @param {Document} doc owner document
   * @param {number} myGen route generation (liveness token)
   * @param {any} P form state {name, brainkey, checked, takenId}
   * @param {HTMLElement} out output box for errors
   * @returns {void} */
  function genBrainkey(doc, myGen, P, out) {
    (/** @type {any} */ (Crypto).suggestBrainkey)().then(function (bk) {
      if (myGen !== gen) return;
      P.brainkey = bk;
      /** @type {HTMLTextAreaElement | null} */
      var area = /** @type {any} */ (doc.getElementById("ca-brainkey"));
      if (area) area.value = bk;
    }).catch(function (e) {
      if (myGen === gen) showError(doc, out, e, t("createaccount.could_not_generate_a_brainkey", "Could not generate a brainkey."));
    });
  }

  /* Availability line for the current check state (empty state included). */
  function availabilityText(P) {
    if (P.checked === "free") return "“" + P.name + "” is available.";
    if (P.checked === "taken") return "“" + P.name + "” is taken" + (P.takenId ? " (" + P.takenId + ")" : "") + ".";
    return t("createaccount.check_whether_the_name_is_free_before_registe", "Check whether the name is free before registering.");
  }

  /* Availability via get_account_by_name (Account.resolve): found = taken,
   * unknown-account = free. Other errors propagate (chain problem). */
  async function checkAvailability(name) {
    try {
      var a = await Account.resolve(name);
      return { free: false, id: a.id };
    } catch (e) {
      if (e && e.message === "unknown-account") return { free: true, id: null };
      throw e;
    }
  }

  /** Derive owner<-seq0, active<-seq1, memo<-seq2 (same roles as wallet.js
   * _deriveFreshKeys) and POST the #1 faucet shape. Returns
   * {name, id, pubs} after an on-chain verify.
   * @param {string} name account name to register
   * @param {string} brainkey normalized brainkey words
   * @returns {Promise<{name: string, id: string, pubs: any}>} faucet result */
  async function registerViaFaucet(name, brainkey) {
    var norm = (/** @type {any} */ (Crypto).normalizeBrainkey)(brainkey), pubs = {};
    var roles = [["owner", 0], ["active", 1], ["memo", 2]];
    for (var i = 0; i < roles.length; i++) {
      var privHex = await (/** @type {any} */ (Crypto).brainPrivateKeyHex)(norm, roles[i][1]);
      pubs[roles[i][0]] = (await (/** @type {any} */ (Crypto).keypairFromPrivateHex)(privHex)).pub;
    }
    var ctrl = null, timer = null;
    try {
      if (typeof AbortController !== "undefined") {
        ctrl = new AbortController();
        timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT_MS);
      }
      var res = await fetch(FAUCET_URL, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: { name: name, owner_key: pubs.owner, active_key: pubs.active, memo_key: pubs.memo } }),
        signal: ctrl ? ctrl.signal : undefined });
      var text = await res.text(), data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!res.ok) throw new Error("Faucet refused (HTTP " + res.status + "): " + ((data && data.error) ? String(data.error).slice(0, 200) : text.slice(0, 200)));
      if (data && data.error) throw new Error("Faucet error: " + String(data.error).slice(0, 200));
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("Faucet timed out after " + (FETCH_TIMEOUT_MS / 1000) + "s.");
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    /* On-chain verify: must now resolve (same bar as the t9-vanilla-6742 proof). */
    var acct = await Chain.call(await Chain.db(), "get_account_by_name", [name]);
    if (!acct || !acct.id) throw new Error(t("createaccount.faucet_said_created_but_the_account_is_not_on", "Faucet said created but the account is not on-chain yet; retry the name check."));
    return { name: acct.name || name, id: acct.id, pubs: pubs };
  }

  /* Result panel: name + id, the three public keys, brainkey backup, optional
   * save-to-wallet (password -> Wallet.create), link to the account page. */
  function paintResult(doc, root, myGen, P, reg) {
    if (myGen !== gen) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("createaccount.account_created", "Account created")));
    var list = el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(el(doc, "dt", term));
      var dd = el(doc, "dd", text); if (title) dd.title = title; list.appendChild(dd); }
    row(t("createaccount.account", "Account"), reg.name + " (" + reg.id + ")");
    row(t("createaccount.owner_key", "Owner key"), reg.pubs.owner);
    row(t("createaccount.active_key", "Active key"), reg.pubs.active);
    row(t("createaccount.memo_key", "Memo key"), reg.pubs.memo);
    row(t("createaccount.network", "Network"), networkName());
    wrap.appendChild(list);
    wrap.appendChild(el(doc, "p", t("createaccount.back_up_this_brainkey_it_is_the_only_way_to_r", "Back up this brainkey — it is the only way to recover the account."), "muted"));
    var saved = doc.createElement("textarea");
    saved.id = "ca-backup-text"; saved.rows = 3; saved.readOnly = true; saved.value = P.brainkey; saved.style.width = "100%";
    wrap.appendChild(saved);
    wrap.appendChild(el(doc, "h3", t("createaccount.save_to_this_wallet_optional", "Save to this wallet (optional)")));
    var pwF = fieldRow(doc, t("createaccount.password", "Password "), { id: "ca-password", type: "password" });
    wrap.appendChild(pwF.row);
    var saveBtn = touchable(el(doc, "button", t("createaccount.save_wallet_with_this_brainkey", "Save wallet with this brainkey")));
    saveBtn.id = "ca-save"; saveBtn.type = "button"; wrap.appendChild(saveBtn);
    var out = el(doc, "div"); wrap.appendChild(out);
    var acctP = el(doc, "p", null, "muted"), acctA = doc.createElement("a");
    acctA.href = "#/account/" + encodeURIComponent(reg.name);
    acctA.textContent = t("account.open_prefix", "Open ") + reg.name;
    acctP.appendChild(acctA); wrap.appendChild(acctP);
    saveBtn.addEventListener("click", function () {
      setFieldError(pwF, ""); out.innerHTML = "";
      if (!pwF.input.value) { setFieldError(pwF, t("createaccount.password_required_enter_a_non_empty_password", "Password required: enter a non-empty password.")); return; }
      saveBtn.disabled = true;
      var status = showStatus(doc, out, t("createaccount.saving_wallet", "Saving wallet…"));
      /* H2: wipe the password local + input on either outcome. */
      var pw = pwF.input.value;
      Promise.resolve().then(function () { return Wallet.create(pw, P.brainkey); })
        .then(function () {
          pwF.input.value = "";
          pw = null;
          if (myGen !== gen) return;
          out.removeChild(status);
          out.appendChild(el(doc, "p", t("createaccount.wallet_saved_the_account_keys_are_now_unlocke", "Wallet saved. The account keys are now unlocked on this device."), "muted"));
        })
        .catch(function (e) {
          pwF.input.value = "";
          pw = null;
          if (myGen !== gen) return;
          out.removeChild(status); saveBtn.disabled = false;
          showError(doc, out, e, t("createaccount.could_not_save_the_wallet", "Could not save the wallet."));
        });
    });
  }

  return { renderCreateAccount: renderCreateAccount };
})();

if (typeof module !== "undefined") { module.exports = CreateAccountUI; }
