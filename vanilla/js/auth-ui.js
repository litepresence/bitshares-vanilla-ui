/* auth-ui.js — login + registration views (stub-batch 2, matrix §A A10-A13).
 * Owns: /login (password -> Wallet.unlock, slice-02 path), /registration
 *   (choice hub), /registration/local (points at /create-wallet-brainkey),
 *   /registration/cloud (name-availability pre-check inline, faucet POST
 *   stays in create-account-ui.js). Thin views: no crypto, no key
 *   derivation, no faucet POST here — every action delegates to the proven
 *   slice-02 screens. Nothing is duplicated.
 * Consumes: Wallet (isUnlocked/unlock only), Account.resolve (read-only
 *   name lookup, same path as create-account-ui.js checkAvailability),
 *   Chain (status), Store (connection subscribe for the login gate).
 *   Global AuthUI only; gen counter tears down stale work.
 * Refs: App.jsx:542-553 (Login, RegistrationSelector, WalletRegistration,
 *   AccountRegistration); Login.jsx:20-108 (dual-model selector cards),
 *   WalletLogin.jsx:36-101 (.bin upload flow), AccountLogin.jsx:17-60
 *   (account+password cloud model), RegistrationSelector.jsx:60-108
 *   (local/cloud choice hub) — concepts only.
 * Punchlist (wallet layout, login models, registration forms):
 *   /login is two selector sections (Login.jsx concept): local unlock
 *   (the only key path this keystore supports) plus account-name lookup.
 *   .bin-file decrypt is NOT offered: wallet.js exposes create/unlock/
 *   lock/isUnlocked/getBrainkey/importBrainkey only — no backup-decrypt
 *   path exists, so the local card links to #/existing-account with the
 *   reason stated on screen. The cloud account+password key-derivation
 *   model (AccountLogin.jsx) is NOT implemented either: unlock takes a
 *   password alone, so the cloud card looks the name up and points at the
 *   local unlock (or brainkey import) instead — stated on screen, never
 *   silently. New strings are plain literals (no t() keys) so the
 *   slice-17 i18n gate stays green; a batch-2 translation pass owns them.
 * Punchlist MEDs (wallet/auth selector cards):
 *   (2) Login header selections + model-choice tooltips (Login.jsx:20-108
 *   + WalletHeaderSelection/AccountHeaderSelection concept: two selectable
 *   models with a recommended badge and per-model tooltip, own words).
 *   No new routes: each card keeps its form and gains a short inline hint
 *   (visible muted line + matching title attribute) paraphrasing
 *   tooltip.registration.walletModel / accountModel.
 *   (3) Registration dual cards (RegistrationSelector.jsx:60-108 +
 *   WalletBlockSelection/AccountBlockSelection concept: recommended badge
 *   + Security/Login-by/Back-up rows + Continue/Select buttons, own
 *   words). ROUTE CHECK vs router.js: #/registration/local,
 *   #/registration/cloud, #/create-account, #/existing-account all exist
 *   — both cards get Continue buttons to their pages, footer keeps the
 *   faucet/import links. No active-model toggle: both cards show Continue
 *   (no inactive state to track on a link hub). Values are vanilla-honest
 *   (local Login-by is password-on-device, NOT .bin-file; cloud Login-by
 *   is name lookup, NOT password-derived keys).
 *   (4) create-account-ui.js is FORBIDDEN (untouched): reverse
 *   restore-account/advanced-form links live here instead — renderCloud
 *   footer gains the #/existing-account restore link (natural: a visitor
 *   with an account needs the import path); renderRegistration footer
 *   already covers #/create-account + #/existing-account both ways.
 *   ZERO new t() keys (locales untouched so parallel rounds don't
 *   conflict) — every new string below is a plain literal for the next
 *   i18n batch:
 *   "Best security — stays in this browser. Move it with the brainkey backup.",
 *   "No login from anywhere with name + password here — find the name below, then unlock the local wallet above.",
 *   "Local wallet — keys on this device", "Recommended",
 *   "Security: High", "Login by: password on this device",
 *   "Back up: yes — write down the brainkey", "Continue",
 *   "Cloud-style account — name via the faucet", "Security: Medium",
 *   "Login by: account-name lookup (password-derived keys are not supported here)",
 *   "Back up: no file — the new account's brainkey is shown once at creation",
 *   "Register a new on-chain account (testnet faucet)",
 *   "Import an existing account (brainkey)",
 *   "Already have an account? Import it instead of registering.".
 * No amounts on screen: no Format vectors apply.
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
  /* Selector-card section: h2 title plus a muted explainer (Login.jsx:31-106
   * concept — two selectable models, own words, no #1 styling copied).
   * opts.hint (plain literal, MEDs) renders as a visible muted line plus a
   * matching title attribute — the model-choice tooltip with no new route.
   * Params: doc, wrap, title, body, opts. Returns the section. */
  function cardHead(doc, wrap, title, body, opts) {
    var s = doc.createElement("section");
    s.appendChild(el(doc, "h2", title));
    s.appendChild(el(doc, "p", body, "muted"));
    if (opts && opts.hint) {
      s.setAttribute("title", opts.hint);
      s.appendChild(el(doc, "p", opts.hint, "muted"));
    }
    wrap.appendChild(s);
    return s; }
  /* Touch-sized navigation button (same floor as fieldRow inputs). */
  function goButton(doc, id, text, hash) {
    var b = touchable(el(doc, "button", text));
    b.id = id; b.type = "button";
    b.addEventListener("click", function () {
      if (typeof location !== "undefined") location.hash = hash;
    });
    return b; }
  /* Plain-literal muted note (new punchlist strings stay out of t() so the
   * i18n drift gate stays green until the batch-2 translation pass). */
  function notePara(doc, text) {
    return el(doc, "p", text, "muted"); }

  /* /login — dual-model selector (Login.jsx:20-108 concept). Card A unlocks
   * the local wallet (the only key path Wallet supports); card B looks an
   * account name up read-only and points back at card A. Neither the .bin
   * upload (WalletLogin.jsx:36-101) nor the cloud password-key model
   * (AccountLogin.jsx:17-60) is reimplemented — reasons stated on screen. */
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
    /* Card A: local model — password straight into Wallet.unlock (wallet-ui.js
     * owns the same call; this view adds no new crypto path). */
    var cardA = cardHead(doc, wrap, t("auth.local_wallet_unlock_on_this_device", "Local wallet — unlock on this device"),
      "Uses the password you set when this wallet was created. Keys never leave this device.",
      { hint: "Best security — stays in this browser. Move it with the brainkey backup." });
    var f = fieldRow(doc, t("auth.password", "Password "), { id: "login-password", type: "password" });
    cardA.appendChild(f.row);
    var btn = touchable(el(doc, "button", t("auth.unlock", "Unlock")));
    btn.id = "login-do"; btn.type = "button"; cardA.appendChild(btn);
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
    /* .bin honesty note: wallet.js has no backup-decrypt entry point, so no
     * file picker is offered — the supported import path is the brainkey. */
    cardA.appendChild(notePara(doc, t("auth.have_a_bin_backup_file_instead_this_wallet_ke", "Have a .bin backup file instead? This wallet keeps one encrypted ") +
      "brainkey and cannot decrypt .bin files. Import the brainkey itself under Import existing account — " +
      "nothing is uploaded anywhere."));
    /* Card B: cloud/account model — name lookup only. The old UI derived keys
     * from account name + password; this keystore unlocks by password alone,
     * so lookup results point back at the local unlock (or brainkey import). */
    var cardB = cardHead(doc, wrap, t("auth.cloud_account_model_find_by_name", "Cloud / account model — find by name"),
      "Look an on-chain account up by name, then unlock the local wallet above " +
      "(or import its brainkey). Account-password key derivation from the old UI is not supported here.",
      { hint: "No login from anywhere with name + password here — find the name below, then unlock the local wallet above." });
    var g = fieldRow(doc, t("auth.account_name", "Account name "), { id: "login-account", type: "text", placeholder: "account-name", inputmode: "text" });
    cardB.appendChild(g.row);
    var lookBtn = touchable(el(doc, "button", t("auth.look_up_account", "Look up account")));
    lookBtn.id = "login-lookup"; lookBtn.type = "button"; cardB.appendChild(lookBtn);
    var out = el(doc, "div", "");
    out.id = "login-account-out";
    out.setAttribute("aria-live", "polite");
    cardB.appendChild(out);
    lookBtn.addEventListener("click", function () {
      setFieldError(g, ""); out.textContent = "";
      var name = String(g.input.value || "").trim().toLowerCase();
      g.input.value = name;
      if (!name) { setFieldError(g, t("auth.enter_an_account_name", "Enter an account name.")); return; }
      if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
        setFieldError(g, t("auth.account_lookup_unavailable_js_account_js_fail", "Account lookup unavailable: js/account.js failed to load."));
        return;
      }
      lookBtn.disabled = true;
      out.textContent = t("auth.looking_up", "Looking up “") + name + "”…";
      Promise.resolve().then(function () { return Account.resolve(name); })
        .then(function (acct) {
          if (myGen !== gen) return;
          lookBtn.disabled = false;
          out.textContent = "";
          var line = el(doc, "p", t("auth.found", "Found ") + (acct.name || name) + " (" + (acct.id || "unknown id") + "). " +
            "Unlock the local wallet above if it holds these keys, or import the brainkey.", "muted");
          out.appendChild(line);
          var p = el(doc, "p", null, "muted");
          var a = doc.createElement("a");
          a.href = "#/account/" + encodeURIComponent(acct.name || name);
          a.textContent = t("auth.open", "Open ") + (acct.name || name);
          p.appendChild(a);
          p.appendChild(doc.createTextNode(" · "));
          var b = doc.createElement("a");
          b.href = "#/existing-account";
          b.textContent = t("auth.import_existing_account", "Import existing account");
          p.appendChild(b);
          out.appendChild(p);
        })
        .catch(function (e) {
          if (myGen !== gen) return;
          lookBtn.disabled = false;
          var msg = (e && e.message) ? e.message : String(e || "Lookup failed");
          if (msg === "unknown-account" || msg.indexOf("unknown-account") !== -1) {
            setFieldError(g, t("auth.no_account_named", "No account named “") + name + t("auth.is_on_chain", "” is on-chain."));
          } else {
            setFieldError(g, msg);
          }
          out.textContent = "";
        });
    });
    wrap.appendChild(linkPara(doc, [
      ["#/create-wallet-brainkey", t("auth.no_wallet_yet_create_one", "No wallet yet? Create one")],
      ["#/existing-account", t("auth.import_existing_account", "Import existing account")]
    ]));
  }

  /* /registration — dual-card choice hub (RegistrationSelector.jsx:60-108 +
   * WalletBlockSelection/AccountBlockSelection concept: recommended badge +
   * Security/Login-by/Back-up rows + Continue buttons, own words, no #1
   * styling copied). Every button target verified in router.js. Both cards
   * show Continue (a link hub tracks no active model). Row values are
   * vanilla-honest per the header note. */
  function renderRegistration(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("auth.registration", "Registration")));
    wrap.appendChild(el(doc, "p", t("auth.pick_how_to_get_started_registration_itself_h", "Pick how to get started. Registration itself happens on the linked screens — this page only points."), "muted"));
    /* Local-wallet card: the recommended model (WalletHeaderSelection's
     * "recommended" badge concept). */
    var local = doc.createElement("section");
    local.appendChild(el(doc, "h2", "Local wallet — keys on this device"));
    var badge = doc.createElement("p");
    var star = doc.createElement("strong");
    star.textContent = "Recommended";
    badge.appendChild(star);
    local.appendChild(badge);
    ["Security: High",
     "Login by: password on this device",
     "Back up: yes — write down the brainkey"].forEach(function (line) {
      local.appendChild(el(doc, "p", line, "muted"));
    });
    local.appendChild(goButton(doc, "reg-card-local", "Continue", "#/registration/local"));
    wrap.appendChild(local);
    /* Cloud-style card: faucet-sponsored names, weaker security
     * (AccountBlockSelection's Medium concept). */
    var cloud = doc.createElement("section");
    cloud.appendChild(el(doc, "h2", "Cloud-style account — name via the faucet"));
    ["Security: Medium",
     "Login by: account-name lookup (password-derived keys are not supported here)",
     "Back up: no file — the new account's brainkey is shown once at creation"].forEach(function (line) {
      cloud.appendChild(el(doc, "p", line, "muted"));
    });
    cloud.appendChild(goButton(doc, "reg-card-cloud", "Continue", "#/registration/cloud"));
    wrap.appendChild(cloud);
    /* Direct shortcuts: faucet register + brainkey import (both exist). */
    var list = doc.createElement("ul");
    [["#/create-account", "Register a new on-chain account (testnet faucet)"],
     ["#/existing-account", "Import an existing account (brainkey)"]].forEach(function (pr) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.href = pr[0]; a.textContent = pr[1]; li.appendChild(a); list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  /* /registration/local — explainer + delegate to the slice-02 create screen.
   * An inline duplicate of the wallet-create form would rot beside
   * wallet-ui.js renderCreate, so this stays a link-out (buttons, not bare
   * links, for the touch floor) plus the verified help topics. */
  function renderLocal(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("auth.local_registration", "Local registration")));
    wrap.appendChild(el(doc, "p", t("auth.a_local_wallet_creates_a_brainkey_on_this_dev", "A local wallet creates a brainkey on this device and derives the owner, active and memo keys from it. Keys never leave the device; the wallet file is encrypted with your password."), "muted"));
    var row = el(doc, "p", null, null);
    row.appendChild(goButton(doc, "reg-local-create", t("auth.create_a_local_wallet", "Create a local wallet"), "#/create-wallet-brainkey"));
    row.appendChild(doc.createTextNode(" "));
    row.appendChild(goButton(doc, "reg-local-import", t("auth.import_existing_account", "Import existing account"), "#/existing-account"));
    row.appendChild(doc.createTextNode(" "));
    row.appendChild(goButton(doc, "reg-local-back", t("auth.back_to_registration", "Back to registration"), "#/registration"));
    wrap.appendChild(row);
    var hp = el(doc, "p", null, "muted");
    [["#/help/wallets", "How wallets work"], ["#/help/backups", "How backups work"]].forEach(function (pr, i) {
      if (i > 0) hp.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a"); a.href = pr[0]; a.textContent = pr[1]; hp.appendChild(a);
    });
    wrap.appendChild(hp);
  }

  /* /registration/cloud — inline name-availability pre-check (read-only,
   * same Account.resolve path as create-account-ui.js checkAvailability)
   * with the faucet POST left to #/create-account (duplicating the
   * register flow here would rot beside it). */
  function renderCloud(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("auth.cloud_registration", "Cloud registration")));
    wrap.appendChild(el(doc, "p", t("auth.cloud_style_registration_picks_an_account_nam", "Cloud-style registration picks an account name and registers it through the faucet, which pays the creation fee. On testnet this is free; on mainnet a faucet or registrar must sponsor the name."), "muted"));
    wrap.appendChild(notePara(doc, t("auth.registration_uses_the_testnet_faucet_switch_t", "Registration uses the testnet faucet — switch to testnet in Settings to register. ") +
      "Name checks work on either network."));
    var g = fieldRow(doc, t("auth.account_name", "Account name "), { id: "reg-cloud-name", type: "text", placeholder: "your-name", inputmode: "text" });
    wrap.appendChild(g.row);
    var checkBtn = touchable(el(doc, "button", t("auth.check_availability", "Check availability")));
    checkBtn.id = "reg-cloud-check"; checkBtn.type = "button"; wrap.appendChild(checkBtn);
    var out = el(doc, "p", t("auth.check_whether_the_name_is_free_before_registe", "Check whether the name is free before registering."), "muted");
    out.id = "reg-cloud-out";
    out.setAttribute("aria-live", "polite");
    wrap.appendChild(out);
    checkBtn.addEventListener("click", function () {
      setFieldError(g, "");
      var name = String(g.input.value || "").trim().toLowerCase();
      g.input.value = name;
      if (!name) { setFieldError(g, t("auth.enter_an_account_name", "Enter an account name.")); return; }
      if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
        setFieldError(g, t("auth.account_lookup_unavailable_js_account_js_fail", "Account lookup unavailable: js/account.js failed to load."));
        return;
      }
      checkBtn.disabled = true;
      out.textContent = t("auth.checking_name", "Checking name…");
      Promise.resolve().then(function () { return Account.resolve(name); })
        .then(function (acct) {
          if (myGen !== gen) return;
          checkBtn.disabled = false;
          out.textContent = "“" + name + t("auth.is_taken", "” is taken (") + (acct.id || "on-chain") + t("auth.pick_another_name", "). Pick another name.");
        })
        .catch(function (e) {
          if (myGen !== gen) return;
          checkBtn.disabled = false;
          var msg = (e && e.message) ? e.message : String(e || "Lookup failed");
          if (msg === "unknown-account" || msg.indexOf("unknown-account") !== -1) {
            out.textContent = "“" + name + t("auth.looks_available_continue_to_register_via_the", "” looks available — continue to Register via the faucet.");
          } else {
            out.textContent = t("auth.could_not_check_the_name", "Could not check the name: ") + msg;
          }
        });
    });
    var row = el(doc, "p", null, null);
    row.appendChild(goButton(doc, "reg-cloud-go", t("auth.register_via_the_faucet", "Register via the faucet"), "#/create-account"));
    row.appendChild(doc.createTextNode(" "));
    row.appendChild(goButton(doc, "reg-cloud-back", t("auth.back_to_registration", "Back to registration"), "#/registration"));
    wrap.appendChild(row);
    wrap.appendChild(linkPara(doc, [
      ["#/settings", "Settings — nodes"],
      ["#/create-account", t("auth.register_via_the_faucet", "Register via the faucet")]
    ]));
    /* MEDs (4): create-account-ui.js is forbidden, so the restore path lives
     * here — natural fit: a visitor who already has an account needs the
     * import page, not the faucet. Plain literal for the next i18n batch. */
    wrap.appendChild(linkPara(doc, [
      ["#/existing-account", "Already have an account? Import it instead of registering."]
    ]));
  }

  return { renderLogin: renderLogin, renderRegistration: renderRegistration,
    renderLocal: renderLocal, renderCloud: renderCloud };
})();

if (typeof module !== "undefined") { module.exports = AuthUI; }
