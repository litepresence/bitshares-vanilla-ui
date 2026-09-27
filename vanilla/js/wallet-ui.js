/* WalletUI: wallet lifecycle screens (manager, create, import).
 * Owns: DOM for /wallet, /create-wallet-brainkey, /existing-account routes only.
 * Consumes: Wallet.create/unlock/lock/isUnlocked/getBrainkey/importBrainkey/
 *   onLock/touch (js/wallet.js), Crypto.suggestBrainkey (js/crypto.js).
 * Globals/side effects: document DOM under the router's root element, global
 *   WalletUI. No network, no storage, no keys at rest — all key material stays
 *   inside Wallet's memory-only unlock state.
 * Created by: building-vanilla-slices skill, slice-02 Task 6.
 */
var WalletUI = (function () {
  "use strict";

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

  /* Labeled row: <label>text <field></label>. */
  function labeledRow(doc, labelText, field) {
    var label = doc.createElement("label");
    label.appendChild(doc.createTextNode(labelText + " "));
    label.appendChild(field);
    return label;
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

  /* Manager/status screen: locked shows a password prompt; unlocked shows the
   * three role pubkeys, a Lock button, and a backup-brainkey revealer.
   * Params: none. Fails inline (wrong password, missing wallet, locked read). */
  function renderWallet(root) {
    var doc = root.ownerDocument;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    var h1 = doc.createElement("h1");
    h1.textContent = "Wallet";
    wrap.appendChild(h1);

    if (backendMissing()) {
      var missing = makeError(doc);
      missing.textContent = "Wallet backend missing: js/wallet.js failed to load.";
      wrap.appendChild(missing);
      return;
    }

    if (Wallet.isUnlocked()) {
      Wallet.touch();
      var open = doc.createElement("p");
      open.textContent = "Wallet is unlocked.";
      wrap.appendChild(open);
      wrap.appendChild(pubkeyList(doc, Wallet.keys || {}));
      /* Public keys only — WIFs and the brainkey NEVER enter a raw block. */
      var detKeys = doc.createElement("details");
      detKeys.className = "raw";
      var sumKeys = doc.createElement("summary");
      sumKeys.setAttribute("aria-label", "Show public keys JSON");
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
      locked.textContent = "Wallet is locked. Enter your password to unlock.";
      wrap.appendChild(locked);
      wrap.appendChild(labeledRow(doc, "Password", passwordField(doc, "wallet-password")));
      var unlockBtn = actionButton(doc, "wallet-unlock", "Unlock");
      wrap.appendChild(unlockBtn);
      var err = makeError(doc);
      wrap.appendChild(err);
      unlockBtn.addEventListener("click", function () {
        err.textContent = "";
        unlockBtn.disabled = true;
        var pw = doc.getElementById("wallet-password").value;
        Promise.resolve()
          .then(function () { return Wallet.unlock(pw); })
          .then(function () { renderWallet(root); })
          .catch(function (e) {
            unlockBtn.disabled = false;
            setError(err, e);
          });
      });
    }
    navLinks(doc, wrap, "manager");
  }

  /* Create screen: generated brainkey plus write-down checkbox gate, then
   * password plus confirm, then create. Success swaps to a backup view with
   * the brainkey and derived pubkeys. All failures show inline. */
  function renderCreate(root) {
    var doc = root.ownerDocument;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    var h1 = doc.createElement("h1");
    h1.textContent = "Create Wallet (Brainkey)";
    wrap.appendChild(h1);

    if (backendMissing() || typeof Crypto === "undefined") {
      var missing = makeError(doc);
      missing.textContent = "Wallet backend missing: js/crypto.js or js/wallet.js failed to load.";
      wrap.appendChild(missing);
      return;
    }

    var hint = doc.createElement("p");
    hint.textContent = "Write down your brainkey and keep it safe. " +
      "Anyone with it can spend your funds.";
    wrap.appendChild(hint);

    var bkArea = brainkeyField(doc, "create-brainkey", true);
    bkArea.placeholder = "Generating brainkey…";
    wrap.appendChild(bkArea);
    var genBtn = actionButton(doc, "create-regen", "Generate new brainkey");
    wrap.appendChild(genBtn);
    var err = makeError(doc);
    wrap.appendChild(err);

    var checkLabel = doc.createElement("label");
    var check = doc.createElement("input");
    check.id = "create-written";
    check.type = "checkbox";
    checkLabel.appendChild(check);
    checkLabel.appendChild(doc.createTextNode(" I wrote it down"));
    wrap.appendChild(checkLabel);

    wrap.appendChild(labeledRow(doc, "Password", passwordField(doc, "create-password")));
    wrap.appendChild(labeledRow(doc, "Confirm password", passwordField(doc, "create-confirm")));
    var createBtn = actionButton(doc, "create-do", "Create wallet");
    wrap.appendChild(createBtn);

    function generate() {
      err.textContent = "";
      bkArea.placeholder = "Generating brainkey…";
      return Crypto.suggestBrainkey().then(function (bk) {
        bkArea.value = bk;
      }).catch(function (e) {
        setError(err, e);
      });
    }

    genBtn.addEventListener("click", function () { generate(); });
    createBtn.addEventListener("click", function () {
      err.textContent = "";
      var bk = bkArea.value;
      var pw = doc.getElementById("create-password").value;
      var confirm = doc.getElementById("create-confirm").value;
      if (!check.checked) {
        err.textContent = "Confirm you wrote the brainkey down first.";
        return;
      }
      if (!pw) {
        err.textContent = "Password required: enter a non-empty password.";
        return;
      }
      if (pw !== confirm) {
        err.textContent = "Passwords do not match.";
        return;
      }
      createBtn.disabled = true;
      Promise.resolve()
        .then(function () { return Wallet.create(pw, bk); })
        .then(function (keys) {
          clearRoot(root);
          var done = makeWrap(doc, root);
          var h2 = doc.createElement("h2");
          h2.textContent = "Wallet created — back it up";
          done.appendChild(h2);
          var saved = brainkeyField(doc, "create-backup-text", true);
          saved.value = bk;
          done.appendChild(saved);
          done.appendChild(pubkeyList(doc, keys || {}));
          var toWallet = doc.createElement("a");
          toWallet.href = "#/wallet";
          toWallet.textContent = "Go to wallet manager";
          done.appendChild(toWallet);
        })
        .catch(function (e) {
          createBtn.disabled = false;
          setError(err, e);
        });
    });

    navLinks(doc, wrap, "create");
    generate();
  }

  /* Import screen: brainkey textarea plus password, verified against the
   * chain (sequences 0..9) before anything is saved. Inline errors for
   * short brainkeys, chain failures, and unknown (no-chain-keys) brainkeys. */
  function renderImport(root) {
    var doc = root.ownerDocument;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    var h1 = doc.createElement("h1");
    h1.textContent = "Import Existing Account";
    wrap.appendChild(h1);

    if (backendMissing() || typeof Crypto === "undefined") {
      var missing = makeError(doc);
      missing.textContent = "Wallet backend missing: js/crypto.js or js/wallet.js failed to load.";
      wrap.appendChild(missing);
      return;
    }

    var hint = doc.createElement("p");
    hint.textContent = "Enter your brainkey. It is checked against the chain " +
      "before anything is saved.";
    wrap.appendChild(hint);

    var bkArea = brainkeyField(doc, "import-brainkey", false);
    bkArea.placeholder = "brainkey words…";
    wrap.appendChild(bkArea);
    wrap.appendChild(labeledRow(doc, "Password", passwordField(doc, "import-password")));
    var importBtn = actionButton(doc, "import-do", "Verify and import");
    wrap.appendChild(importBtn);
    var err = makeError(doc);
    wrap.appendChild(err);

    importBtn.addEventListener("click", function () {
      err.textContent = "";
      var bk = bkArea.value;
      var pw = doc.getElementById("import-password").value;
      if (!pw) {
        err.textContent = "Password required: enter a non-empty password.";
        return;
      }
      importBtn.disabled = true;
      importBtn.textContent = "Checking chain…";
      Promise.resolve()
        .then(function () { return Wallet.importBrainkey(bk, pw); })
        .then(function (keys) {
          clearRoot(root);
          var done = makeWrap(doc, root);
          var h2 = doc.createElement("h2");
          h2.textContent = "Account found — wallet imported";
          done.appendChild(h2);
          done.appendChild(pubkeyList(doc, keys || {}));
          var toWallet = doc.createElement("a");
          toWallet.href = "#/wallet";
          toWallet.textContent = "Go to wallet manager";
          done.appendChild(toWallet);
        })
        .catch(function (e) {
          importBtn.disabled = false;
          importBtn.textContent = "Verify and import";
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
