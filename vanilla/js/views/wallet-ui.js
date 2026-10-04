/* WalletUI: wallet lifecycle screens (manager, create, import).
 * Owns: DOM for /wallet, /create-wallet-brainkey, /existing-account routes only.
 * Consumes: Wallet.create/unlock/lock/isUnlocked/getBrainkey/importBrainkey/
 *   onLock/touch (js/wallet.js), Crypto.suggestBrainkey (js/crypto.js).
 * Globals/side effects: document DOM under the router's root element, global
 *   WalletUI. No network, no storage, no keys at rest — all key material stays
 *   inside Wallet's memory-only unlock state.
 * Created by: building-vanilla-slices skill, slice-02 Task 6.
 * Punchlist (wallet layout, login models, registration forms): create screen
 *   restacked into div.xfer-field rows (app.css section (a) stacks them —
 *   bare inline appends overlapped); Cancel button (history.back + #/wallet
 *   fallback); wallet public-name field when a stored wallet exists
 *   (label-only: single-slot keystore keeps no names — persisted under
 *   bts-vanilla-wallet-name-v1); custom-brainkey toggle + dictionary hint
 *   (BRAINKEY_DICT read-only, length-only fallback); password hint meter
 *   (rough local estimate, NOT a security rating); help links to the
 *   verified topics #/help/wallets + #/help/backups (help-ui.js TOPICS).
 *   Refs (concepts only): WalletCreate.jsx:168-270 (name/custom/cancel),
 *   PasswordConfirm.jsx:42-62 (8-char + match rule), BrainkeyInput.jsx:48-90
 *   (50-char / 16-word dictionary hint).
 * Punchlist MEDs (wallet/auth selector cards): existing-account options row
 *   (ExistingAccount.jsx:85-111 concept — BackupRestore subroutes
 *   import-backup/import-keys/brainkey/balance-claim + dashboard/wallet
 *   buttons when a wallet exists, own words). ROUTE CHECK vs router.js: only
 *   #/existing-account, #/wallet, #/wallet/password,
 *   #/create-wallet-brainkey, #/vesting, #/ exist — the four
 *   #/existing-account/* subroutes do NOT exist and are OMITTED (never
 *   linked); wallet.js has no .bin-decrypt or WIF-import entry point so
 *   those options are stated-unsupported, not linked; the brainkey form
 *   below IS this page's import path; balance-claim (op 37) lives at
 *   #/vesting (vesting-ui.js), the honest nearest target.
 *   Batch-3 i18n: the new strings in existingOptions are keyed via t()
 *   (were plain literals for the next i18n batch):
 *   "Ways in:", "Brainkey import (this page's form below)",
 *   "Create new wallet instead", "Wallet manager",
 *   "Have a .bin backup file or bare private keys instead? This wallet imports brainkeys only — .bin decrypt and WIF import are not supported. Nothing is uploaded anywhere.",
 *   "A wallet already exists on this device.",
 *   "Claim vesting balances", "Open the dashboard".
 */
var WalletUI = (function () {
  "use strict";

  /* Batch-2 tonight i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Clear all children of the router root. */
  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  /* New .wrap container appended to root. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);
    return wrap;
  }

  /* Inline error line (aria-live so screen readers announce failures). */
  function makeError(doc) {
    var err = doc.createElement("div");
    err.className = "error";
    err.setAttribute("aria-live", "polite");
    return err;
  }

  /* Set inline error text from any thrown value. Never leaves a blank error:
   * unknown shapes fall back to a generic message. Maps the import refusal
   * "no-chain-keys" to a human sentence naming the 0..9 look-ahead. */
  function setError(errEl, e) {
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || "Unexpected error");
    if (msg.indexOf("no-chain-keys") !== -1) {
      msg = "No account found on-chain for this brainkey " +
        "(checked sequences 0..9). Nothing was saved.";
    }
    errEl.textContent = msg;
  }

  /* Password input with the slice's input discipline. */
  function passwordField(doc, id) {
    var input = doc.createElement("input");
    input.id = id;
    input.type = "password";
    input.setAttribute("autocomplete", "new-password");
    input.setAttribute("spellcheck", "false");
    return input;
  }

  /* Brainkey textarea with the slice's input discipline. */
  function brainkeyField(doc, id, readOnly) {
    var area = doc.createElement("textarea");
    area.id = id;
    area.rows = 3;
    area.setAttribute("spellcheck", "false");
    area.setAttribute("autocomplete", "off");
    area.setAttribute("autocapitalize", "off");
    area.setAttribute("inputmode", "text");
    if (readOnly) area.readOnly = true;
    return area;
  }

  /* Labeled row: <label>text <field></label>. Kept for the single-field
   * manager/import screens (label-only contract: no div.xfer-field wrapper,
   * so Forms.fieldRow cannot express it — see fieldRow removal below). */
  function labeledRow(doc, labelText, field) {
    var label = doc.createElement("label");
    label.appendChild(doc.createTextNode(labelText + " "));
    label.appendChild(field);
    return label;
  }

  /* Stacked form rows (div.xfer-field > label(text + field)) build on
   * Forms.fieldRow directly at each create-screen call site (same DOM
   * contract as transfer-ui.js; app.css section (a) stacks them below
   * ~720px and grids them label|input above). */

  /* Muted paragraph of internal links (href + text pairs). */
  function helpPara(doc, pairs) {
    var p = doc.createElement("p");
    p.className = "muted";
    pairs.forEach(function (pr, i) {
      if (i > 0) p.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a");
      a.href = pr[0];
      a.textContent = pr[1];
      p.appendChild(a);
    });
    return p;
  }

  /* True when an encrypted wallet envelope is stored on this device.
   * Same key the keystore owns (wallet.js LS_KEY); password-ui.js already
   * probes it this way. try/catch: storage may be missing/blocked. */
  function hasStoredWallet() {
    try {
      if (typeof localStorage === "undefined") return false;
      return !!localStorage.getItem("bts-vanilla-wallet-v1");
    } catch (e) { return false; }
  }

  /* Rough client-side password hint. Length plus character-class breadth maps
   * to a word label and an approximate bits estimate (len * log2(pool)).
   * HONEST LABELING: a guessability hint only — NOT a security claim and NOT
   * a strength proof (no dictionary/pattern checks). Never blocks create. */
  function passwordHint(pw) {
    var suffix = " (rough local hint, not a security rating)";
    if (!pw) return "Enter 8 or more characters." + suffix;
    if (pw.length < 8) return "Too short — use 8 or more characters." + suffix;
    var pool = 26;
    var classes = 0;
    if (/[a-z]/.test(pw)) classes++;
    if (/[A-Z]/.test(pw)) { classes++; pool = 52; }
    if (/[0-9]/.test(pw)) { classes++; pool = pool === 52 ? 62 : 36; }
    if (/[^A-Za-z0-9]/.test(pw)) { classes++; pool = 94; }
    var bits = Math.round(pw.length * Math.log(pool) / Math.log(2));
    var label = bits < 40 ? "weak" : bits < 60 ? "fair" : bits < 80 ? "good" : "strong";
    if (classes < 2) label = "weak";
    return "Password hint: " + label + " (~" + bits + " bits)" + suffix;
  }

  /* Lazily built dictionary set for the brainkey hint. Reads the global word
 *   list crypto.js consumes (js/sdk/data/brainkey-dict.js); null when absent
   * (file:// with missing dict) so the hint degrades to length-only. */
  var _dictSet = null;
  var _dictTried = false;
  function dictSet() {
    if (_dictTried) return _dictSet;
    _dictTried = true;
    try {
      if (typeof BRAINKEY_DICT === "string" && BRAINKEY_DICT) {
        _dictSet = {};
        BRAINKEY_DICT.split(",").forEach(function (w) { _dictSet[w] = true; });
      }
    } catch (e) { _dictSet = null; }
    return _dictSet;
  }

  /* Brainkey validation hint (BrainkeyInput.jsx:48-90 concept, own words):
   * 50-char minimum, 16 words recommended, unknown words flagged. Hint only —
   * Wallet.create enforces the 50-char floor; nothing here blocks or claims. */
  function brainkeyHintText(bk) {
    var words = String(bk || "").trim().split(/\s+/).filter(function (w) { return !!w; });
    if (!words.length) return "Brainkey: waiting to generate… (50 characters minimum, 16 words recommended)";
    var chars = String(bk).length;
    var text = "Brainkey: " + chars + " characters (50 minimum) · " +
      words.length + " words (16 recommended)";
    var set = dictSet();
    if (set) {
      var unknown = 0;
      words.forEach(function (w) {
        var m = w.toLowerCase().match(/[a-z]+/);
        if (!m || !set[m[0]]) unknown++;
      });
      if (unknown > 0) text += " · " + unknown + " word(s) outside the dictionary (hint only)";
    }
    return text;
  }

  /* Submit-style button (click-only activation, never hover-dependent). */
  function actionButton(doc, id, text) {
    var btn = doc.createElement("button");
    btn.id = id;
    btn.type = "button";
    btn.textContent = text;
    return btn;
  }

  /* Unordered list of role pubkeys from a Wallet.keys-shaped object. */
  function pubkeyList(doc, keys) {
    var ul = doc.createElement("ul");
    ["owner", "active", "memo"].forEach(function (role) {
      var li = doc.createElement("li");
      li.textContent = role + ": " + (keys[role] ? keys[role].pub : "—");
      ul.appendChild(li);
    });
    return ul;
  }

  /* Nav links shared by all three screens. */
  function navLinks(doc, wrap, except) {
    var p = doc.createElement("p");
    var links = [
      ["#/wallet", "Wallet manager", "manager"],
      ["#/wallet/password", "Change password", "password"],
      ["#/create-wallet-brainkey", "Create new wallet", "create"],
      ["#/existing-account", "Import existing account", "import"]
    ];
    links.forEach(function (entry, i) {
      if (entry[2] === except) return;
      if (i > 0) p.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a");
      a.href = entry[0];
      a.textContent = entry[1];
      p.appendChild(a);
    });
    wrap.appendChild(p);
  }

  /* Backend guard: loud inline error when the Wallet global failed to load. */
  function backendMissing() {
    return (typeof Wallet === "undefined" || !Wallet);
  }

  /* Punchlist HIGH: wallet console summary card (WalletManager
   * WalletOptions concept: active-wallet + change/import/claims links).
   * Single-slot keystore: at most one wallet exists, so the "card" names
   * the stored wallet (bts-vanilla-wallet-name-v1 or "unnamed") + lock
   * state + the same manager links the footer carries. Sub-routes
   * (/wallet/create, /change, /import-keys, /balance-claims, /brainkey)
   * are NOT rebuilt: wallet.js has no .bin-decrypt or WIF-import entry
   * point, so those paths stay stated-unsupported links below, never
   * dead routes. Plain literals only. */
  function consoleCard(doc) {
    var box = doc.createElement("section");
    box.className = "wallet-console";
    var h = doc.createElement("h2");
    h.textContent = t("wallet.console_title", "Wallet console");
    box.appendChild(h);
    var name = null;
    try { name = localStorage.getItem("bts-vanilla-wallet-name-v1"); } catch (e) { name = null; }
    var stored = hasStoredWallet(), unlocked = false;
    try { unlocked = Wallet.isUnlocked(); } catch (e) { unlocked = false; }
    var line = doc.createElement("p");
    line.textContent = stored
      ? t("wallet.console_active_prefix", "Active wallet: ") + (name || t("wallet.console_unnamed", "unnamed")) + (unlocked ? t("wallet.console_unlocked_suffix", " (unlocked)") : t("wallet.console_locked_suffix", " (locked)"))
      : (t("wallet.console_empty", "No wallet on this device yet.") + t("wallet.console_hint", " Create one (#/create-wallet-brainkey) or import an existing account (#/existing-account) — links below."));
    box.appendChild(line);
    var links = doc.createElement("p");
    function link(href, text) {
      var a = doc.createElement("a");
      a.href = href;
      a.textContent = text;
      return a;
    }
    if (stored) {
      links.appendChild(link("#/vesting", t("wallet.console_claims", "Balance claims")));
      links.appendChild(doc.createTextNode(" · "));
      links.appendChild(link("#/wallet/password", t("wallet.console_change_password", "Change password")));
      links.appendChild(doc.createTextNode(" · "));
    }
    links.appendChild(link("#/existing-account", t("wallet.console_import_keys", "Import keys")));
    links.appendChild(doc.createTextNode(" · "));
    links.appendChild(link("#/create-wallet-brainkey", t("wallet.console_new_wallet", "New wallet")));
    box.appendChild(links);
    var note = doc.createElement("p");
    note.className = "muted";
    note.textContent = t("wallet.console_single_key_note", "Single-key wallet: .bin backup files and bare private keys (WIF) are not supported — brainkey import only.");
    box.appendChild(note);
    return box;
  }

  /** Manager/status screen: locked shows a password prompt; unlocked shows the
   * three role pubkeys, a Lock button, and a backup-brainkey revealer.
   * Params: none. Fails inline (wrong password, missing wallet, locked read).
   * @param {HTMLElement} root router mount element */
  function renderWallet(root) {
    var doc = root.ownerDocument;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    var h1 = doc.createElement("h1");
    h1.textContent = t("wallet.title", "Wallet");
    wrap.appendChild(h1);

    if (backendMissing()) {
      var missing = makeError(doc);
      missing.textContent = t("wallet.s1", "Wallet backend missing: js/wallet.js failed to load.");
      wrap.appendChild(missing);
      return;
    }

    wrap.appendChild(consoleCard(doc));

    if (Wallet.isUnlocked()) {
      Wallet.touch();
      var open = doc.createElement("p");
      open.textContent = t("wallet.s2", "Wallet is unlocked.");
      wrap.appendChild(open);
      wrap.appendChild(pubkeyList(doc, Wallet.keys || {}));
      /* Public keys only — WIFs and the brainkey NEVER enter a raw block. */
      var detKeys = doc.createElement("details");
      detKeys.className = "raw";
      var sumKeys = doc.createElement("summary");
      sumKeys.setAttribute("aria-label", t("wallet.show_public_keys_json", "Show public keys JSON"));
      detKeys.appendChild(sumKeys);
      var preKeys = doc.createElement("pre");
      try {
        var pubsOnly = {};
        ["owner", "active", "memo"].forEach(function (role) {
          pubsOnly[role] = Wallet.keys && Wallet.keys[role] ? Wallet.keys[role].pub : null;
        });
        preKeys.textContent = JSON.stringify(pubsOnly, null, 2);
      } catch (e) { preKeys.textContent = String(e && e.message || e); }
      detKeys.appendChild(preKeys);
      wrap.appendChild(detKeys);

      var lockBtn = actionButton(doc, "wallet-lock", "Lock");
      wrap.appendChild(lockBtn);
      var backupErr = makeError(doc);
      wrap.appendChild(backupErr);
      var showBtn = actionButton(doc, "wallet-backup", "Show backup brainkey");
      wrap.appendChild(showBtn);
      var backupArea = null;
      showBtn.addEventListener("click", function () {
        backupErr.textContent = "";
        try {
          var bk = Wallet.getBrainkey();
          if (!backupArea) {
            backupArea = brainkeyField(doc, "wallet-backup-text", true);
            wrap.appendChild(backupArea);
          }
          backupArea.value = bk;
        } catch (e) {
          setError(backupErr, e);
        }
      });
      lockBtn.addEventListener("click", function () {
        Wallet.lock();
        renderWallet(root);
      });
      try {
        Wallet.onLock(function () {
          if (root.isConnected) renderWallet(root);
        });
      } catch (e) { /* lock callback is best-effort; the button still locks */ }
    } else {
      var locked = doc.createElement("p");
      locked.textContent = t("wallet.s3", "Wallet is locked. Enter your password to unlock.");
      wrap.appendChild(locked);
      wrap.appendChild(labeledRow(doc, "Password", passwordField(doc, "wallet-password")));
      var unlockBtn = actionButton(doc, "wallet-unlock", "Unlock");
      wrap.appendChild(unlockBtn);
      var err = makeError(doc);
      wrap.appendChild(err);
      unlockBtn.addEventListener("click", function () {
        err.textContent = "";
        unlockBtn.disabled = true;
        /* H2: the password lives in a local + the input; both are wiped on
         * either outcome so nothing lingers in DOM or closure. */
        /** @type {HTMLInputElement | null} */
        var pwInput = /** @type {any} */ (doc.getElementById("wallet-password"));
        var pw = pwInput ? pwInput.value : "";
        Promise.resolve()
          .then(function () { return Wallet.unlock(pw); })
          .then(function () {
            if (pwInput) pwInput.value = "";
            pw = null;
            renderWallet(root);
          })
          .catch(function (e) {
            if (pwInput) pwInput.value = "";
            pw = null;
            unlockBtn.disabled = false;
            setError(err, e);
          });
      });
    }
    navLinks(doc, wrap, "manager");
  }

  /** Create screen: generated brainkey plus write-down checkbox gate, then
   * password plus confirm plus strength hint, then create/cancel. Wallet name
   * shows only when a stored wallet exists (WalletCreate.jsx:168-186
   * concept — single-slot keystore, so label-only with an overwrite warning).
   * Custom-brainkey toggle flips the textarea editable with a dictionary
   * hint (BrainkeyInput concept). All failures show inline.
   * @param {HTMLElement} root router mount element */
  function renderCreate(root) {
    var doc = root.ownerDocument;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(helpPara(doc, [
      ["#/help/wallets", "How wallets work"],
      ["#/help/backups", "How backups work"]
    ]));
    var h1 = doc.createElement("h1");
    h1.textContent = t("wallet.s4", "Create Wallet (Brainkey)");
    wrap.appendChild(h1);

    if (backendMissing() || typeof Crypto === "undefined") {
      var missing = makeError(doc);
      missing.textContent = t("wallet.s5", "Wallet backend missing: js/crypto.js or js/wallet.js failed to load.");
      wrap.appendChild(missing);
      return;
    }

    var hint = doc.createElement("p");
    hint.textContent = t("wallet.write_down_brainkey_keep_safe", "Write down your brainkey and keep it safe. Anyone with it can spend your funds.");
    wrap.appendChild(hint);

    var customMode = false;
    var bkArea = brainkeyField(doc, "create-brainkey", true);
    bkArea.placeholder = t("createaccount.generating_brainkey", "Generating brainkey…");
    bkArea.style.width = "100%";
    wrap.appendChild(Forms.fieldRow(doc, t("wallet.brainkey", "Brainkey") + " ", bkArea));
    var bkHint = doc.createElement("p");
    bkHint.className = "muted";
    bkHint.setAttribute("aria-live", "polite");
    bkHint.textContent = brainkeyHintText("");
    wrap.appendChild(bkHint);
    function refreshBkHint() { bkHint.textContent = brainkeyHintText(bkArea.value); }
    bkArea.addEventListener("input", refreshBkHint);

    var regenRow = doc.createElement("p");
    var genBtn = actionButton(doc, "create-regen", t("wallet.generate_new_brainkey", "Generate new brainkey"));
    genBtn.classList.add("touchable");
    regenRow.appendChild(genBtn);
    regenRow.appendChild(doc.createTextNode(" "));
    var customBtn = actionButton(doc, "create-custom", t("wallet.use_custom_brainkey_instead", "Use custom brainkey instead"));
    customBtn.classList.add("btn-ghost", "touchable");
    regenRow.appendChild(customBtn);
    wrap.appendChild(regenRow);
    var err = makeError(doc);
    wrap.appendChild(err);

    var checkRow = doc.createElement("div");
    checkRow.className = "xfer-field";
    var checkLabel = doc.createElement("label");
    var check = doc.createElement("input");
    check.id = "create-written";
    check.type = "checkbox";
    checkLabel.appendChild(check);
    checkLabel.appendChild(doc.createTextNode(t("wallet.wrote_it_down", " I wrote it down")));
    checkRow.appendChild(checkLabel);
    wrap.appendChild(checkRow);

    /* Public name (WalletCreate.jsx:168-186 concept): only when a wallet
     * already exists, since a fresh device needs no disambiguation. */
    var nameInput = null;
    if (hasStoredWallet()) {
      nameInput = doc.createElement("input");
      nameInput.id = "create-wallet-name";
      nameInput.type = "text";
      nameInput.value = "default";
      nameInput.setAttribute("spellcheck", "false");
      nameInput.setAttribute("autocomplete", "off");
      nameInput.addEventListener("input", function () {
        var v = nameInput.value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (v !== nameInput.value) nameInput.value = v;
      });
      wrap.appendChild(Forms.fieldRow(doc, t("wallet.wallet_name", "Wallet name") + " ", nameInput));
      var overwrite = doc.createElement("p");
      overwrite.className = "muted";
      overwrite.textContent = t("wallet.a_wallet_already_exists_on_this_device", "A wallet already exists on this device — ") +
        "creating replaces it. The name is only a label; this device keeps a single wallet.";
      wrap.appendChild(overwrite);
    }

    var pwInput = passwordField(doc, "create-password");
    wrap.appendChild(Forms.fieldRow(doc, t("wallet.password", "Password") + " ", pwInput));
    var pwMeter = doc.createElement("p");
    pwMeter.className = "muted";
    pwMeter.setAttribute("aria-live", "polite");
    pwMeter.textContent = passwordHint("");
    wrap.appendChild(pwMeter);
    pwInput.addEventListener("input", function () {
      pwMeter.textContent = passwordHint(pwInput.value);
    });
    var confirmInput = passwordField(doc, "create-confirm");
    wrap.appendChild(Forms.fieldRow(doc, t("wallet.confirm_password", "Confirm password") + " ", confirmInput));

    var actionRow = doc.createElement("p");
    var createBtn = actionButton(doc, "create-do", t("wallet.create_wallet", "Create wallet"));
    createBtn.classList.add("touchable");
    actionRow.appendChild(createBtn);
    actionRow.appendChild(doc.createTextNode(" "));
    var cancelBtn = actionButton(doc, "create-cancel", t("wallet.cancel", "Cancel"));
    cancelBtn.classList.add("btn-ghost", "touchable");
    actionRow.appendChild(cancelBtn);
    wrap.appendChild(actionRow);

    function generate() {
      err.textContent = "";
      customMode = false;
      bkArea.readOnly = true;
      bkArea.placeholder = t("createaccount.generating_brainkey", "Generating brainkey…");
      customBtn.style.display = "";
    /* TYPE NOTE: the global Crypto object collides with DOM lib's Crypto
     * interface (constructor type), so suggestBrainkey reads back missing;
     * the cast pins it to any. Local cast only, nothing to merge. */
      return (/** @type {any} */ (Crypto).suggestBrainkey)().then(function (bk) {
        bkArea.value = bk;
        refreshBkHint();
      }).catch(function (e) {
        setError(err, e);
      });
    }

    genBtn.addEventListener("click", function () { generate(); });
    customBtn.addEventListener("click", function () {
      customMode = true;
      bkArea.readOnly = false;
      bkArea.value = "";
      bkArea.placeholder = t("wallet.type_your_own_brainkey_words", "type your own brainkey words…");
      customBtn.style.display = "none";
      refreshBkHint();
      bkArea.focus();
    });
    cancelBtn.addEventListener("click", function () {
      try {
        if (typeof window !== "undefined" && window.history && window.history.length > 1) {
          window.history.back();
          return;
        }
      } catch (e) { /* fallback below */ }
      if (typeof location !== "undefined") location.hash = "#/wallet";
    });
    createBtn.addEventListener("click", function () {
      err.textContent = "";
      var bk = bkArea.value;
      /* H2: password locals + inputs are wiped on either outcome. The
       * brainkey textarea keeps its value by design (the user is writing
       * it down on this screen). */
      /** @type {HTMLInputElement | null} */
      var pwInput = /** @type {any} */ (doc.getElementById("create-password"));
      /** @type {HTMLInputElement | null} */
      var confirmInput = /** @type {any} */ (doc.getElementById("create-confirm"));
      var pw = pwInput ? pwInput.value : "";
      var confirm = confirmInput ? confirmInput.value : "";
      if (!check.checked) {
        err.textContent = t("wallet.s6", "Confirm you wrote the brainkey down first.");
        return;
      }
      if (customMode && String(bk || "").length < 50) {
        err.textContent = t("wallet.custom_brainkey_too_short_50_characters_minim", "Custom brainkey too short: 50 characters minimum after trimming.");
        return;
      }
      if (!pw) {
        err.textContent = t("wallet.s7", "Password required: enter a non-empty password.");
        return;
      }
      if (pw.length < 8) {
        err.textContent = t("wallet.password_must_be_8_characters_or_more", "Password must be 8 characters or more.");
        return;
      }
      if (pw !== confirm) {
        err.textContent = t("wallet.passwords_do_not_match", "Passwords do not match.");
        return;
      }
      var walletName = nameInput ? nameInput.value : "default";
      if (nameInput && !walletName) {
        err.textContent = t("wallet.wallet_name_required_use_letters_digits_dash", "Wallet name required: use letters, digits, dash or underscore.");
        return;
      }
      createBtn.disabled = true;
      Promise.resolve()
        .then(function () { return Wallet.create(pw, bk); })
        .then(function (keys) {
          if (pwInput) pwInput.value = "";
          if (confirmInput) confirmInput.value = "";
          pw = null; confirm = null; bk = null;
          try {
            if (typeof localStorage !== "undefined") {
              localStorage.setItem("bts-vanilla-wallet-name-v1", walletName);
            }
          } catch (e) { /* label is best-effort; the wallet itself is saved */ }
          clearRoot(root);
          var done = makeWrap(doc, root);
          var h2 = doc.createElement("h2");
          h2.textContent = t("wallet.wallet_created_back_it_up", "Wallet created — back it up");
          done.appendChild(h2);
          var saved = brainkeyField(doc, "create-backup-text", true);
          saved.value = bk;
          saved.style.width = "100%";
          done.appendChild(saved);
          done.appendChild(pubkeyList(doc, keys || {}));
          var toWallet = doc.createElement("a");
          toWallet.href = "#/wallet";
          toWallet.textContent = t("wallet.go_to_wallet_manager", "Go to wallet manager");
          done.appendChild(toWallet);
          done.appendChild(helpPara(doc, [
            ["#/help/backups", "How backups work"]
          ]));
        })
        .catch(function (e) {
          if (pwInput) pwInput.value = "";
          if (confirmInput) confirmInput.value = "";
          pw = null; confirm = null;
          createBtn.disabled = false;
          setError(err, e);
        });
    });

    navLinks(doc, wrap, "create");
    generate();
  }

  /* Existing-account options row (ExistingAccount.jsx:85-111 concept, own
   * words — NOT #1's subroutes). Targets verified in router.js; missing
   * subroutes (#/existing-account/import-backup, /import-keys, /brainkey,
   * /balance-claim) are omitted, never linked. .bin/WIF paths are
   * stated-unsupported (wallet.js has no such entry point). Params: doc.
   * Returns the options div. Fails: never — static links only. */
  function existingOptions(doc) {
    var box = doc.createElement("div");
    var ways = doc.createElement("p");
    ways.className = "muted";
    ways.appendChild(doc.createTextNode(t("wallet.ways_in", "Ways in: ")));
    var pairs = [
      ["#/create-wallet-brainkey", t("wallet.create_new_wallet_instead", "Create new wallet instead")],
      ["#/wallet", t("wallet.wallet_manager", "Wallet manager")]
    ];
    pairs.forEach(function (pr, i) {
      if (i > 0) ways.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a");
      a.href = pr[0];
      a.textContent = pr[1];
      ways.appendChild(a);
    });
    var self = doc.createElement("span");
    self.textContent = t("wallet.brainkey_import_this_page_form_below", " · Brainkey import (this page's form below)");
    ways.appendChild(self);
    box.appendChild(ways);
    var honesty = doc.createElement("p");
    honesty.className = "muted";
    honesty.textContent = t("wallet.have_a_bin_backup_file_or_bare_private_k", "Have a .bin backup file or bare private keys instead? This wallet imports brainkeys only — .bin decrypt and WIF import are not supported. Nothing is uploaded anywhere.");
    box.appendChild(honesty);
    /* Punchlist MED: ExistingAccountOptions help links (wallet-types /
     * backup-types concept). Plain literals, verified help topics. */
    (function optionHelp() {
      var hp = doc.createElement("p");
      hp.className = "muted";
      var hw = doc.createElement("a"); hw.href = "#/help/wallets"; hw.textContent = t("wallet.option_wallet_types", "Wallet types");
      hp.appendChild(hw);
      hp.appendChild(doc.createTextNode(" · "));
      var hb = doc.createElement("a"); hb.href = "#/help/backups"; hb.textContent = t("wallet.option_backup_types", "Backup types");
      hp.appendChild(hb);
      box.appendChild(hp);
    })();
    if (hasStoredWallet()) {
      var have = doc.createElement("p");
      have.className = "muted";
      have.appendChild(doc.createTextNode(t("wallet.a_wallet_already_exists_on_this_device_2", "A wallet already exists on this device. ")));
      var claim = doc.createElement("a");
      claim.href = "#/vesting";
      claim.textContent = t("wallet.claim_vesting_balances", "Claim vesting balances");
      have.appendChild(claim);
      have.appendChild(doc.createTextNode(" · "));
      var dash = doc.createElement("a");
      dash.href = "#/";
      dash.textContent = t("wallet.open_the_dashboard", "Open the dashboard");
      have.appendChild(dash);
      box.appendChild(have);
    }
    return box;
  }

  /** Import screen: brainkey textarea plus password, verified against the
   * chain (sequences 0..9) before anything is saved. Inline errors for
   * short brainkeys, chain failures, and unknown (no-chain-keys) brainkeys.
   * @param {HTMLElement} root router mount element */
  function renderImport(root) {
    var doc = root.ownerDocument;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    var h1 = doc.createElement("h1");
    h1.textContent = t("wallet.import_existing_account", "Import Existing Account");
    wrap.appendChild(h1);

    if (backendMissing() || typeof Crypto === "undefined") {
      var missing = makeError(doc);
      missing.textContent = t("wallet.s5", "Wallet backend missing: js/crypto.js or js/wallet.js failed to load.");
      wrap.appendChild(missing);
      return;
    }

    var hint = doc.createElement("p");
    hint.textContent = t("wallet.enter_brainkey_checked_chain", "Enter your brainkey. It is checked against the chain before anything is saved.");
    wrap.appendChild(hint);

    wrap.appendChild(existingOptions(doc));

    var bkArea = brainkeyField(doc, "import-brainkey", false);
    bkArea.placeholder = t("wallet.brainkey_words_placeholder", "brainkey words…");
    wrap.appendChild(bkArea);
    wrap.appendChild(labeledRow(doc, "Password", passwordField(doc, "import-password")));
    var importBtn = actionButton(doc, "import-do", "Verify and import");
    wrap.appendChild(importBtn);
    var err = makeError(doc);
    wrap.appendChild(err);

    importBtn.addEventListener("click", function () {
      err.textContent = "";
      var bk = bkArea.value;
      /* H2: same password wipe as unlock/create above. */
      /** @type {HTMLInputElement | null} */
      var pwInput = /** @type {any} */ (doc.getElementById("import-password"));
      var pw = pwInput ? pwInput.value : "";
      if (!pw) {
        err.textContent = t("wallet.s7", "Password required: enter a non-empty password.");
        return;
      }
      importBtn.disabled = true;
      importBtn.textContent = t("wallet.checking_chain", "Checking chain…");
      Promise.resolve()
        .then(function () { return Wallet.importBrainkey(bk, pw); })
        .then(function (keys) {
          if (pwInput) pwInput.value = "";
          pw = null; bk = null;
          clearRoot(root);
          var done = makeWrap(doc, root);
          var h2 = doc.createElement("h2");
          h2.textContent = t("wallet.account_found_wallet_imported", "Account found — wallet imported");
          done.appendChild(h2);
          done.appendChild(pubkeyList(doc, keys || {}));
          var toWallet = doc.createElement("a");
          toWallet.href = "#/wallet";
          toWallet.textContent = t("wallet.go_to_wallet_manager", "Go to wallet manager");
          done.appendChild(toWallet);
        })
        .catch(function (e) {
          if (pwInput) pwInput.value = "";
          pw = null;
          importBtn.disabled = false;
          importBtn.textContent = t("wallet.verify_and_import", "Verify and import");
          setError(err, e);
        });
    });

    navLinks(doc, wrap, "import");
  }

  return {
    renderWallet: renderWallet,
    renderCreate: renderCreate,
    renderImport: renderImport
  };
})();

if (typeof module !== "undefined") { module.exports = WalletUI; }
