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
 *   Batch-3 i18n: the new strings below are keyed via t() (were plain
 *   literals for the next i18n batch):
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
  /* No local el/clearRoot — use DOM.el, DOM.clear */
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    var err = DOM.error(wrap, msg);
    return err;
  }
  /* Labeled input row with its own inline error slot (Forms builds the
   * row; the err div stays per-view — Forms.fieldRow returns row only). */
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
    var p = DOM.el(doc, "p", null, "muted");
    pairs.forEach(function (pr, i) {
      if (i > 0) p.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a"); a.href = pr[0]; a.textContent = pr[1]; a.className = "subtle-btn"; touchable(a); p.appendChild(a);
    });
    return p; }
  /* Selector-card section: h2 title plus a muted explainer (Login.jsx:31-106
   * concept — two selectable models, own words, no #1 styling copied).
   * opts.hint (plain literal, MEDs) renders as a visible muted line plus a
   * matching title attribute — the model-choice tooltip with no new route.
   * Params: doc, wrap, title, body, opts. Returns the section. */
  function cardHead(doc, wrap, title, body, opts) {
    var s = doc.createElement("section");
    DOM.append(s, DOM.el(doc, "h2", title));
    DOM.append(s, DOM.el(doc, "p", body, "muted"));
    if (opts && opts.hint) {
      s.setAttribute("title", opts.hint);
      DOM.append(s, DOM.el(doc, "p", opts.hint, "muted"));
    }
    DOM.append(wrap, s);
    return s; }
  /* Touch-sized navigation button (same floor as fieldRow inputs). */
  function goButton(doc, id, text, hash, variant) {
    var b = touchable(DOM.el(doc, "button", text));
    b.id = id; b.type = "button";
    if (variant) b.className = variant;
    b.addEventListener("click", function () {
      if (typeof location !== "undefined") location.hash = hash;
    });
    return b; }
  /* Plain-literal muted note (new punchlist strings stay out of t() so the
   * i18n drift gate stays green until the batch-2 translation pass). */
  function notePara(doc, text) {
    return DOM.el(doc, "p", text, "muted"); }

  /* Signing + Connected-sites section (relocated from Settings — owner
   *   directive: Login owns the route display + pin + warning + sites;
   *   SettingsPrefs.buildSigning stays the shared builder, DOM only).
   *   Radio changes persist + re-mount the login signing block (mode line,
   *   warning, and effective route follow the envelope); the allowlist fills
   *   async below (empty note stands when the extension store is absent).
   *   No new strings — reuses settings.sign_* keys only. Params: doc, wrap,
   *   root (router #view child, re-rendered on pin/revoke). Returns the
   *   sign-block element or null. Never throws. */
  function mountSigning(doc, wrap, root) {
    try {
      if (typeof SettingsPrefs === "undefined" || !SettingsPrefs ||
          typeof SettingsPrefs.buildSigning !== "function") return null;
      var settings = {};
      try {
        if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
          settings = Store.loadSettings() || {};
        }
      } catch (e) { settings = {}; }
      var sign = SettingsPrefs.buildSigning(doc, settings, t);
      wrap.appendChild(sign.wrap);
      var signRadios = sign.radios, signList = sign.listBox, signEmpty = sign.emptyNote;
      /* Events: signing pin (persist + re-mount login — the mode line,
       * warning, and effective route all follow the envelope). */
      ["auto", "extension", "browser"].forEach(function (v) {
        try {
          if (signRadios && signRadios[v]) {
            signRadios[v].addEventListener("change", function () {
              if (!signRadios[v].checked) return;
              try {
                if (typeof Store !== "undefined" && Store && typeof Store.saveSettings === "function") {
                  Store.saveSettings({ signing: v });
                }
              } catch (e) { /* select keeps pick */ }
              renderLogin(root);
            });
          }
        } catch (e) { /* radio stands unpinned */ }
      });
      /* Connected sites (Tier 2 allowlist): read from the persistent
       * extension store; each row names the origin + bound account ids with a
       * per-origin Revoke (removes the binding — next request prompts again).
       * Absent store (plain web) keeps the empty note: no sites, honestly. */
      (function fillSites() {
        var store = null;
        try {
          if (typeof chrome !== "undefined" && chrome && chrome.storage && chrome.storage.local) {
            store = chrome.storage.local;
          } else if (typeof browser !== "undefined" && browser && browser.storage && browser.storage.local) {
            store = browser.storage.local;
          }
        } catch (e) { store = null; }
        if (!store) return;
        try {
          store.get(["vb-allowlist-v1"], function (items) {
            try {
              var denied = false;
              try {
                var ns = (typeof chrome !== "undefined" && chrome) ||
                  (typeof browser !== "undefined" && browser);
                if (ns && ns.runtime && ns.runtime.lastError) denied = true;
              } catch (e) { denied = true; }
              if (denied) return;
              var a = items ? items["vb-allowlist-v1"] : null;
              if (!a || typeof a !== "object") return;
              var origins = Object.keys(a);
              if (!origins.length) return;
              while (signEmpty.firstChild) signEmpty.removeChild(signEmpty.firstChild);
              try { signEmpty.parentNode.removeChild(signEmpty); } catch (e) { /* note stands empty */ }
              origins.forEach(function (origin) {
                var entry = a[origin] || {};
                var ids = Array.isArray(entry.allowedAccountIds) ? entry.allowedAccountIds : [];
                var row = doc.createElement("div");
                row.className = "sign-site-row";
                var name = doc.createElement("div");
                name.textContent = origin;
                row.appendChild(name);
                var sub = doc.createElement("div");
                sub.className = "muted";
                sub.textContent = ids.join(", ") || t("settings.sign_sites_empty", "No sites approved yet — approvals appear here with per-site revoke.");
                row.appendChild(sub);
                var revoke = doc.createElement("button");
                revoke.type = "button";
                revoke.textContent = t("settings.sign_revoke", "Revoke");
                try { revoke.style.minHeight = "44px"; } catch (e) { /* native stands */ }
                revoke.addEventListener("click", function () {
                  revoke.disabled = true;
                  try {
                    store.get(["vb-allowlist-v1"], function (items2) {
                      try {
                        var a2 = items2 ? items2["vb-allowlist-v1"] : null;
                        if (a2 && typeof a2 === "object" && a2[origin]) {
                          delete a2[origin];
                          var o = {};
                          o["vb-allowlist-v1"] = a2;
                          store.set(o, function () { renderLogin(root); });
                          return;
                        }
                      } catch (e) { /* fall through to rerender */ }
                      renderLogin(root);
                    });
                  } catch (e) { renderLogin(root); }
                });
                row.appendChild(revoke);
                signList.appendChild(row);
              });
            } catch (e) { /* empty note stands */ }
          });
        } catch (e) { /* empty note stands */ }
      })();
      return sign.wrap;
    } catch (e) { return null; }
  }

  /* Card C: shared / multisig accounts (multisig-ux skill, login spec).
   * Static text + two links only: no password field, no key handling, no
   * chain call. Mounted in locked, unlocked, and post-unlock branches so
   * co-owners always find the propose -> share-id -> approve story.
   * Params: doc, wrap. Returns the section. Never throws. */
  function multisigCard(doc, wrap) {
    var s = doc.createElement("section");
    DOM.append(s, DOM.el(doc, "h2", t("auth.multisig_title", "Shared / multisig accounts")));
    DOM.append(s, DOM.el(doc, "p",
      t("auth.multisig_body", "This wallet holds one key. Shared accounts need proposals + co-owner approvals, coordinated by proposal id (1.10.N). Browsing is public; only signing needs the password."),
      "muted"));
    var steps = doc.createElement("ul");
    [t("auth.multisig_step_propose", "Propose the operation (Transfer has Send/Propose; assets, barter and borrowing link to proposals)."),
     t("auth.multisig_step_share", "Share the 1.10.N proposal id with co-owners."),
     t("auth.multisig_step_approve", "Co-owners approve (op 23) on the proposal page, or co-sign via the transaction builder.")].forEach(function (line) {
      var li = doc.createElement("li");
      li.textContent = line;
      steps.appendChild(li);
    });
    s.appendChild(steps);
    s.appendChild(linkPara(doc, [
      ["#/proposals", t("auth.multisig_open_proposals", "View proposals")],
      ["#/txbuilder", t("auth.multisig_open_txbuilder", "Open transaction builder")]
    ]));
    DOM.append(wrap, s);
    return s;
  }

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
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    DOM.append(wrap, DOM.pageHead(doc, t("auth.login", "Login"), "lock-blue"));
    if (walletMissing(doc, wrap)) return;
    var unlocked = false;
    try { unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys; }
    catch (e) { unlocked = false; }
    if (unlocked) {
      DOM.append(wrap, DOM.el(doc, "p", t("auth.your_wallet_is_already_unlocked_on_this_devic", "Your wallet is already unlocked on this device."), "muted"));
      DOM.append(wrap, linkPara(doc, [
        ["#/accounts", t("auth.open_accounts", "Open accounts")],
        ["#/wallet", t("auth.wallet_manager", "Wallet manager")]
      ]));
      multisigCard(doc, wrap);
      mountSigning(doc, wrap, root);
      /* View-as lives here now (owner relocation from Settings): inline
       * section, self-wiring (Go/Reset owned by the builder, no login
       * wiring needed). Visible regardless of lock state, always last. */
      try {
        if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.renderSection === "function") {
          wrap.appendChild(ViewingAs.renderSection(doc));
        }
      } catch (e) { /* login stands without viewing */ }
      return;
    }
    /* Card A: local model — password straight into Wallet.unlock (wallet-ui.js
     * owns the same call; this view adds no new crypto path). */
    var cardA = cardHead(doc, wrap, t("auth.local_wallet_unlock_on_this_device", "Local wallet — unlock on this device"),
      "Uses the password you set when this wallet was created. Keys never leave this device.",
      { hint: t("auth.best_security_stays_in_this_browser_move", "Best security — stays in this browser. Move it with the brainkey backup.") });
    var f = Forms.labeledInput(doc, t("auth.password", "Password ") + " ", { id: "login-password", type: "password" });
    f.err = DOM.el(doc, "div", "", "error");
    f.err.setAttribute("aria-live", "polite"); f.err.style.display = "none"; f.row.appendChild(f.err);
    DOM.append(cardA, f.row);
    var btn = touchable(DOM.el(doc, "button", t("auth.unlock", "Unlock")));
    btn.id = "login-do"; btn.type = "button"; DOM.append(cardA, btn);
    btn.addEventListener("click", function () {
      setFieldError(f, ""); btn.disabled = true;
      if (!f.input.value) { setFieldError(f, t("auth.password_required_enter_a_non_empty_password", "Password required: enter a non-empty password.")); btn.disabled = false; return; }
      /* H2: wipe the password local + input on either outcome. */
      var pw = f.input.value;
      Promise.resolve().then(function () { return Wallet.unlock(pw); })
        .then(function () {
          f.input.value = "";
          pw = null;
          if (myGen !== gen) return;
          DOM.clear(root);
          var done = makeWrap(doc, root);
           DOM.append(done, DOM.pageHead(doc, t("auth.login", "Login"), "lock-blue"));
          DOM.append(done, DOM.el(doc, "p", t("auth.wallet_unlocked", "Wallet unlocked."), "muted"));
          DOM.append(done, linkPara(doc, [
            ["#/accounts", t("auth.open_accounts", "Open accounts")],
            ["#/wallet", t("auth.wallet_manager", "Wallet manager")]
          ]));
          /* Post-unlock transient: same mounts as both main branches —
           * signing block + viewing-as stay visible regardless of lock
           * state (third render path, no re-invoke to keep the success
           * message + links; password wipe above untouched). */
          multisigCard(doc, done);
          mountSigning(doc, done, root);
          try {
            if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.renderSection === "function") {
              done.appendChild(ViewingAs.renderSection(doc));
            }
          } catch (e) { /* login stands without viewing */ }
        })
        .catch(function (e) {
          f.input.value = "";
          pw = null;
          if (myGen !== gen) return;
          btn.disabled = false;
          setFieldError(f, (e && e.message) ? e.message : String(e || t("common.unlock_failed", "Unlock failed.")));
        });
    });
    /* .bin honesty note: wallet.js has no backup-decrypt entry point, so no
     * file picker is offered — the supported import path is the brainkey. */
    DOM.append(cardA, notePara(doc, t("auth.have_a_bin_backup_file_instead_this_wallet_ke", "Have a .bin backup file instead? This wallet keeps one encrypted ") +
      "brainkey and cannot decrypt .bin files. Import the brainkey itself under Import existing account — " +
      "nothing is uploaded anywhere."));
    /* Card B: cloud/account model — name lookup only. The old UI derived keys
     * from account name + password; this keystore unlocks by password alone,
     * so lookup results point back at the local unlock (or brainkey import). */
    var cardB = cardHead(doc, wrap, t("auth.cloud_account_model_find_by_name", "Cloud / account model — find by name"),
      "Look an on-chain account up by name, then unlock the local wallet above " +
      "(or import its brainkey). Account-password key derivation from the old UI is not supported here.",
      { hint: t("auth.no_login_from_anywhere_with_name_password", "No login from anywhere with name + password here — find the name below, then unlock the local wallet above.") });
    var g = Forms.labeledInput(doc, t("common.account_name", "Account name ") + " ", { id: "login-account", type: "text", placeholder: "account-name", inputmode: "text" });
    g.err = DOM.el(doc, "div", "", "error");
    g.err.setAttribute("aria-live", "polite"); g.err.style.display = "none"; g.row.appendChild(g.err);
    DOM.append(cardB, g.row);
    var lookBtn = touchable(DOM.el(doc, "button", t("auth.look_up_account", "Look up account")));
    lookBtn.id = "login-lookup"; lookBtn.type = "button"; DOM.append(cardB, lookBtn);
    var out = DOM.el(doc, "div", "");
    out.id = "login-account-out";
    out.setAttribute("aria-live", "polite");
    DOM.append(cardB, out);
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
          var line = DOM.el(doc, "p", t("auth.found", "Found ") + (acct.name || name) + " (" + (acct.id || "unknown id") + "). " +
            "Unlock the local wallet above if it holds these keys, or import the brainkey.", "muted");
          DOM.append(out, line);
          var p = DOM.el(doc, "p", null, "muted");
          var a = doc.createElement("a");
          a.href = "#/account/" + encodeURIComponent(acct.name || name);
          a.textContent = t("auth.open", "Open ") + (acct.name || name);
          DOM.append(p, a);
          p.appendChild(doc.createTextNode(" · "));
          var b = doc.createElement("a");
          b.href = "#/existing-account";
          b.textContent = t("common.import_existing", "Import existing account");
          DOM.append(p, b);
          DOM.append(out, p);
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
    DOM.append(wrap, linkPara(doc, [
      ["#/create-wallet-brainkey", t("auth.no_wallet_yet_create_one", "No wallet yet? Create one")],
      ["#/existing-account", t("common.import_existing", "Import existing account")]
    ]));
    multisigCard(doc, wrap);
    mountSigning(doc, wrap, root);
    /* View-as (locked branch): same mount as the unlocked branch above —
     * visible regardless of lock state, always last. */
    try {
      if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.renderSection === "function") {
        wrap.appendChild(ViewingAs.renderSection(doc));
      }
    } catch (e) { /* login stands without viewing */ }
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
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    DOM.append(wrap, DOM.pageHead(doc, t("auth.registration", "Registration"), "create_account"));
    DOM.append(wrap, DOM.el(doc, "p", t("auth.pick_how_to_get_started_registration_itself_h", "Pick how to get started. Registration itself happens on the linked screens — this page only points."), "muted"));
    /* Local-wallet card: the recommended model (WalletHeaderSelection's
     * "recommended" badge concept). */
    var local = doc.createElement("section");
    DOM.append(local, DOM.el(doc, "h2", t("auth.local_wallet_keys_on_this_device", "Local wallet — keys on this device")));
    var badge = doc.createElement("p");
    var star = doc.createElement("strong");
    star.textContent = t("auth.recommended", "Recommended");
    DOM.append(badge, star);
    DOM.append(local, badge);
    [t("auth.security_high", "Security: High"),
     t("auth.login_by_password_on_this_device", "Login by: password on this device"),
     t("auth.back_up_yes_write_down_the_brainkey", "Back up: yes — write down the brainkey")].forEach(function (line) {
      DOM.append(local, DOM.el(doc, "p", line, "muted"));
    });
    DOM.append(local, goButton(doc, "reg-card-local", t("auth.continue", "Continue"), "#/registration/local", null));
    DOM.append(wrap, local);
    /* Cloud-style card: faucet-sponsored names, weaker security
     * (AccountBlockSelection's Medium concept). */
    var cloud = doc.createElement("section");
    DOM.append(cloud, DOM.el(doc, "h2", t("auth.cloud_style_account_name_via_the_faucet", "Cloud-style account — name via the faucet")));
    [t("auth.security_medium", "Security: Medium"),
     t("auth.login_by_account_name_lookup_password_der", "Login by: account-name lookup (password-derived keys are not supported here)"),
     t("auth.back_up_no_file_the_new_account_s_brainke", "Back up: no file — the new account's brainkey is shown once at creation")].forEach(function (line) {
      DOM.append(cloud, DOM.el(doc, "p", line, "muted"));
    });
    DOM.append(cloud, goButton(doc, "reg-card-cloud", t("auth.continue", "Continue"), "#/registration/cloud", null));
    DOM.append(wrap, cloud);
    /* Direct shortcuts: faucet register + brainkey import (both exist). */
    var list = doc.createElement("ul");
    [["#/create-account", t("auth.register_a_new_on_chain_account_testnet_fauce", "Register a new on-chain account (testnet faucet)")],
     ["#/existing-account", t("auth.import_an_existing_account_brainkey", "Import an existing account (brainkey)")]].forEach(function (pr) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.href = pr[0]; a.textContent = pr[1]; DOM.append(li, a); DOM.append(list, li);
    });
    DOM.append(wrap, list);
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
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    DOM.append(wrap, DOM.pageHead(doc, t("auth.local_registration", "Local registration"), "create_account"));
    DOM.append(wrap, DOM.el(doc, "p", t("auth.a_local_wallet_creates_a_brainkey_on_this_dev", "A local wallet creates a brainkey on this device and derives the owner, active and memo keys from it. Keys never leave the device; the wallet file is encrypted with your password."), "muted"));
    var row = DOM.el(doc, "p", null, null);
    DOM.append(row, goButton(doc, "reg-local-create", t("auth.create_a_local_wallet", "Create a local wallet"), "#/create-wallet-brainkey", null));
    row.appendChild(doc.createTextNode(" "));
    DOM.append(row, goButton(doc, "reg-local-import", t("common.import_existing", "Import existing account"), "#/existing-account", null));
    row.appendChild(doc.createTextNode(" "));
    DOM.append(row, goButton(doc, "reg-local-back", t("auth.back_to_registration", "Back to registration"), "#/registration", "btn-ghost"));
    DOM.append(wrap, row);
    var hp = DOM.el(doc, "p", null, "muted");
    [["#/help/wallets", "How wallets work"], ["#/help/backups", "How backups work"]].forEach(function (pr, i) {
      if (i > 0) hp.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a"); a.href = pr[0]; a.textContent = pr[1]; DOM.append(hp, a);
    });
    DOM.append(wrap, hp);
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
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    DOM.append(wrap, DOM.pageHead(doc, t("auth.cloud_registration", "Cloud registration"), "create_account"));
    DOM.append(wrap, DOM.el(doc, "p", t("auth.cloud_style_registration_picks_an_account_nam", "Cloud-style registration picks an account name and registers it through the faucet, which pays the creation fee. On testnet this is free; on mainnet a faucet or registrar must sponsor the name."), "muted"));
    DOM.append(wrap, notePara(doc, t("auth.registration_uses_the_testnet_faucet_switch_t", "Registration uses the testnet faucet — switch to testnet in Settings to register. ") +
      "Name checks work on either network."));
    var g = Forms.labeledInput(doc, t("common.account_name", "Account name ") + " ", { id: "reg-cloud-name", type: "text", placeholder: "your-name", inputmode: "text" });
    g.err = DOM.el(doc, "div", "", "error");
    g.err.setAttribute("aria-live", "polite"); g.err.style.display = "none"; g.row.appendChild(g.err);
    DOM.append(wrap, g.row);
    var checkBtn = touchable(DOM.el(doc, "button", t("auth.check_availability", "Check availability")));
    checkBtn.id = "reg-cloud-check"; checkBtn.type = "button"; DOM.append(wrap, checkBtn);
    var out = DOM.el(doc, "p", t("auth.check_whether_the_name_is_free_before_registe", "Check whether the name is free before registering."), "muted");
    out.id = "reg-cloud-out";
    out.setAttribute("aria-live", "polite");
    DOM.append(wrap, out);
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
    var row = DOM.el(doc, "p", null, null);
    DOM.append(row, goButton(doc, "reg-cloud-go", t("auth.register_via_the_faucet", "Register via the faucet"), "#/create-account", null));
    row.appendChild(doc.createTextNode(" "));
    DOM.append(row, goButton(doc, "reg-cloud-back", t("auth.back_to_registration", "Back to registration"), "#/registration", "btn-ghost"));
    DOM.append(wrap, row);
    DOM.append(wrap, linkPara(doc, [
      ["#/settings", "Settings — nodes"],
      ["#/create-account", t("auth.register_via_the_faucet", "Register via the faucet")]
    ]));
    /* MEDs (4): create-account-ui.js is forbidden, so the restore path lives
     * here — natural fit: a visitor who already has an account needs the
     * import page, not the faucet. Batch-3 i18n: keyed via t(). */
    DOM.append(wrap, linkPara(doc, [
      ["#/existing-account", t("auth.already_have_an_account_import_it_instead", "Already have an account? Import it instead of registering.")]
    ]));
  }

  return { renderLogin: renderLogin, renderRegistration: renderRegistration,
    renderLocal: renderLocal, renderCloud: renderCloud };
})();

if (typeof module !== "undefined") { module.exports = AuthUI; }