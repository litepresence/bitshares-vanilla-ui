/* accounts-ui.js — account manager / list view (stub-batch 2, matrix §A row A3).
 * Owns: /accounts (wallet-account card, name lookup, manage links). Shows which
 *   on-chain account the unlocked wallet controls (Account.myAccountId, proven
 *   slice-02/03) plus a name->account-page lookup box. Balance/order/history
 *   detail stays on /account/:name (slice-03) — this view links there, never
 *   duplicates it. Unlock goes through Wallet.unlock only; no crypto here.
 * Consumes: Account (myAccountId/resolve), Wallet (isUnlocked/unlock),
 *   Chain (status), Store (connection subscribe). Side effects: global
 *   AccountsUI only; gen counter tears down stale work (unlock/connect races).
 *   No amounts on screen: ids + names only, so no Format vectors apply.
 * I18n.t (display strings with verbatim en defaults — batch-2a i18n).
 * Refs: App.jsx:512 (DashboardAccountsOnly); no astro equiv (matrix A3).
 * Created by: stub-queue build (matrix §A STUB queue, batch 2).
 */
var AccountsUI = (function () {
  "use strict";
  var gen = 0;
  /* Batch-2a i18n: display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back
   * to the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }
  /* textContent-only element (user/chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("transfer.err_unexpected", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("transfer.err_network", "Network unavailable. Check Settings → Nodes and retry.");
    else if (msg.indexOf("wallet-locked") !== -1) msg = t("transfer.err_locked", "Wallet is locked.");
    else if (msg.indexOf("no-account") !== -1) msg = t("transfer.err_no_account", "No on-chain account found for the wallet's active key.");
    else if (msg.indexOf("unknown-account") !== -1) msg = t("account.unknown_name", "Unknown account name.");
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
    if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    touchable(input); label.appendChild(input); row.appendChild(label);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite"); err.style.display = "none"; row.appendChild(err);
    return { row: row, input: input, err: err }; }
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : "none"; }
  /* Internal link paragraph (href + text pairs). */
  function linkPara(doc, pairs) {
    var p = el(doc, "p", null, "muted");
    pairs.forEach(function (pr, i) {
      if (i > 0) p.appendChild(doc.createTextNode(" · "));
      var a = doc.createElement("a"); a.href = pr[0]; a.textContent = pr[1]; p.appendChild(a);
    });
    return p; }

  /* Route entry. Gates backends, waits for the shared socket (transfer-ui.js
   * connect-wait pattern), then paints wallet card + lookup + manage links. */
  function renderAccounts(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Account === "undefined" || !Account || typeof Wallet === "undefined" || !Wallet) {
      showError(doc, wrap, t("account.manager_backend_missing", "Account backend missing: js/account.js or js/wallet.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "h1", t("account.manager_title", "Accounts")));
      wrap.appendChild(el(doc, "p", t("transfer.connecting", "Connecting to network…"), "muted"));
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderAccounts(root);
        }
      });
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        clearRoot(root);
        var failWrap = makeWrap(doc, root);
        failWrap.appendChild(el(doc, "h1", t("account.manager_title", "Accounts")));
        showError(doc, failWrap, new Error("not connected"), t("transfer.network_unavailable_short", "Network unavailable."));
        var acstat = el(doc, "p", "", "muted");
        try { acstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        failWrap.appendChild(acstat);
        var acrow = el(doc, "div", null, "pools-offline-row");
        failWrap.appendChild(acrow);
        var acretry = touchable(el(doc, "button", t("fees.retry", "Retry")));
        acretry.type = "button";
        acretry.classList.add("btn-ghost");
        acrow.appendChild(acretry);
        var acoff = null;
        try { acoff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { acoff = null; }
        if (acoff && typeof acoff.wire === "function") {
          try { acoff.wire(acretry, acstat, function () { renderAccounts(root); }, t); } catch (e) { acretry.addEventListener("click", function () { renderAccounts(root); }); }
        } else {
          acretry.addEventListener("click", function () { renderAccounts(root); });
        }
        var aclink = null;
        if (acoff && typeof acoff.settingsLink === "function") {
          try { aclink = acoff.settingsLink(doc, t); } catch (e) { aclink = null; }
        }
        if (!aclink) {
          aclink = el(doc, "a", t("notice.open_settings", "Open Settings"));
          try { aclink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          touchable(aclink);
          aclink.classList.add("subtle-btn");
        }
        acrow.appendChild(aclink);
      }, 15000);
      /* Automated handshake on entry (shared Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
      return;
    }
    paintAccounts(doc, root, myGen);
  }

  /* Wallet card (unlocked: resolve + show; locked: unlock form), lookup box,
   * manage links. Re-renders on unlock via renderAccounts. */
  function paintAccounts(doc, root, myGen) {
    if (myGen !== gen) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("account.manager_title", "Accounts")));
    var unlocked = false;
    try { unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys; }
    catch (e) { unlocked = false; }
    wrap.appendChild(el(doc, "h3", t("account.this_wallet", "This wallet")));
    if (!unlocked) {
      wrap.appendChild(el(doc, "p", t("account.unlock_to_see", "Unlock your wallet to see which on-chain account it controls."), "muted"));
      /* G8: one-line pointer to the public lookup below (the locked card is
       * otherwise a dead end for browsing). Button scrolls to + focuses the
       * lookup input — no hash change, so the router never fires. */
      var crossBtn = touchable(el(doc, "button", t("account.lookup_title", "Look up an account")));
      crossBtn.type = "button"; crossBtn.classList.add("subtle-btn"); wrap.appendChild(crossBtn);
      crossBtn.addEventListener("click", function () {
        var box = doc.getElementById("accts-lookup");
        if (box) {
          try { if (box.scrollIntoView) box.scrollIntoView(); } catch (e) { /* focus still helps */ }
          try { box.focus(); } catch (e) { /* display-only */ }
        }
      });
      var f = fieldRow(doc, t("account.password_label", "Password "), { id: "accts-unlock-password", type: "password" });
      wrap.appendChild(f.row);
      var btn = touchable(el(doc, "button", t("account.s6", "Unlock")));
      btn.id = "accts-unlock-do"; btn.type = "button"; wrap.appendChild(btn);
      var errBox = el(doc, "div", null, "error");
      errBox.setAttribute("aria-live", "polite"); wrap.appendChild(errBox);
      /* Punchlist MED: logged-out LoginSelector row (DashboardAccountsOnly
       * concept): CREATE ACCOUNT + LOGIN shortcuts beside the unlock form.
       * Plain literals only, existing routes only. */
      (function gateRow() {
        var p = el(doc, "p", null, "muted");
        var c = touchable(el(doc, "a", t("account.gate_create_account", "Create account")));
        c.href = "#/create-account";
        c.classList.add("subtle-btn");
        p.appendChild(c);
        p.appendChild(doc.createTextNode(" · "));
        var l = touchable(el(doc, "a", t("account.gate_login", "Login")));
        l.href = "#/login";
        l.classList.add("subtle-btn");
        p.appendChild(l);
        wrap.appendChild(p);
      })();
      btn.addEventListener("click", function () {
        errBox.textContent = ""; btn.disabled = true;
        /* H2: wipe the password local + input on either outcome. */
        var pw = f.input.value;
        Promise.resolve().then(function () { return Wallet.unlock(pw); })
          .then(function () {
            f.input.value = "";
            pw = null;
            if (myGen === gen) renderAccounts(root);
          })
          .catch(function (e) {
            f.input.value = "";
            pw = null;
            if (myGen !== gen) return;
            btn.disabled = false;
            errBox.textContent = (e && e.message) ? e.message : t("transfer.unlock_failed", "Unlock failed");
          });
      });
    } else {
      var card = el(doc, "div"); card.id = "accts-wallet-card";
      card.appendChild(el(doc, "p", t("account.resolving", "Resolving the wallet account…"), "muted"));
      wrap.appendChild(card);
      resolveWalletAccount(doc, myGen, card);
    }
    wrap.appendChild(el(doc, "h3", t("account.lookup_title", "Look up an account")));
    wrap.appendChild(el(doc, "p", t("account.lookup_hint", "Public data — no unlock needed. Opens the full account page (balances, orders, history)."), "muted"));
    var nameF = fieldRow(doc, t("account.lookup_label", "Account name "), { id: "accts-lookup", placeholder: t("account.lookup_placeholder", "account-name"), inputmode: "text" });
    wrap.appendChild(nameF.row);
    var goBtn = touchable(el(doc, "button", t("account.open_account", "Open account page")));
    goBtn.id = "accts-open"; goBtn.type = "button"; wrap.appendChild(goBtn);
    goBtn.addEventListener("click", function () {
      var name = nameF.input.value.trim().toLowerCase();
      if (!name) { setFieldError(nameF, t("account.enter_name", "Enter an account name.")); return; }
      setFieldError(nameF, "");
      if (typeof location !== "undefined") location.hash = "#/account/" + encodeURIComponent(name);
    });
    /* Locked view-as affordance (view-as task 3): View-as validates the same
     * lookup value via ViewingAs.set (header + dashboard follow through the
     * ViewingAs subscription, no reload); Reset restores committee-account
     * via ViewingAs.clear. Same field error slot (no new strings, no new
     * route). ViewingAs missing -> network_error (feature unavailable). */
    var viewBtn = touchable(el(doc, "button", t("viewing.dialog_open", "View as this account")));
    viewBtn.type = "button"; viewBtn.classList.add("btn-ghost"); wrap.appendChild(viewBtn);
    viewBtn.addEventListener("click", function () {
      var name = nameF.input.value.trim().toLowerCase();
      if (!name) { setFieldError(nameF, t("account.enter_name", "Enter an account name.")); return; }
      setFieldError(nameF, "");
      viewBtn.disabled = true;
      Promise.resolve().then(function () {
        if (typeof ViewingAs === "undefined" || !ViewingAs || typeof ViewingAs.set !== "function") throw new Error("network_error");
        return ViewingAs.set(name);
      }).then(function () {
        viewBtn.disabled = false;
      }).catch(function (e) {
        viewBtn.disabled = false;
        var m = (e && e.message) ? e.message : "";
        if (m.indexOf("unknown-account") !== -1) setFieldError(nameF, t("viewing.unknown_account", "Unknown account name."));
        else setFieldError(nameF, t("viewing.network_error", "Network unavailable. Check Settings → Nodes and retry."));
      });
    });
    var resetLine = el(doc, "p", null, "muted");
    var resetBtn = touchable(el(doc, "button", t("viewing.dialog_reset", "Reset to committee-account")));
    resetBtn.type = "button"; resetBtn.classList.add("btn-ghost"); resetLine.appendChild(resetBtn);
    wrap.appendChild(resetLine);
    resetBtn.addEventListener("click", function () {
      setFieldError(nameF, "");
      try {
        if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.clear === "function") ViewingAs.clear();
      } catch (e) { /* default stands */ }
    });
    wrap.appendChild(el(doc, "h3", t("account.manage", "Manage")));
    wrap.appendChild(linkPara(doc, [
      ["#/create-wallet-brainkey", t("account.create_wallet", "Create new wallet")],
      ["#/existing-account", t("account.import_account", "Import existing account")],
      ["#/create-account", t("account.register_account", "Register a new on-chain account")],
      ["#/wallet", t("account.wallet_manager", "Wallet manager")]
    ]));
    /* LOW punchlist: restore-your-account / advanced-form links (logged-out).
     * Both targets exist — batch-3-keyed, no new routes. */
    (function restoreLinks() {
      var p = el(doc, "p", null, "muted");
      var a = touchable(el(doc, "a", t("account.restore_your_account", "Restore your account")));
      a.href = "#/existing-account";
      a.classList.add("subtle-btn");
      p.appendChild(a);
      p.appendChild(doc.createTextNode(" · "));
      var b = touchable(el(doc, "a", t("account.advanced_form", "Advanced form")));
      b.href = "#/create-account";
      b.classList.add("subtle-btn");
      p.appendChild(b);
      wrap.appendChild(p);
    })();
  }

  /* Fill the wallet card: active-key account id -> name. Empty states for
   * no-account / lookup failure (never blank, never throws out). */
  function resolveWalletAccount(doc, myGen, card) {
    Promise.resolve().then(function () { return Account.myAccountId(); })
      .then(function (id) { return Account.resolve(id).then(function (a) { return { id: id, name: a.name }; }); })
      .then(function (found) {
        if (myGen !== gen) return;
        while (card.firstChild) card.removeChild(card.firstChild);
        var list = el(doc, "dl", null, "xfer-confirm");
        function row(term, text) {
          list.appendChild(el(doc, "dt", term)); list.appendChild(el(doc, "dd", text)); }
        row(t("account.card_account", "Account"), found.name + " (" + found.id + ")");
        card.appendChild(list);
        var p = el(doc, "p", null, "muted"), a = doc.createElement("a");
        a.href = "#/account/" + encodeURIComponent(found.name);
        a.textContent = t("account.open_prefix", "Open ") + found.name;
        p.appendChild(a); card.appendChild(p);
      })
      .catch(function (e) {
        if (myGen !== gen) return;
        while (card.firstChild) card.removeChild(card.firstChild);
        var msg = (e && e.message) ? e.message : t("account.lookup_failed", "Lookup failed");
        if (msg === "no-account") {
          card.appendChild(el(doc, "p", t("account.no_account_yet", "The wallet is unlocked but its active key controls no on-chain account yet. Register one or import a funded brainkey."), "muted"));
          card.appendChild(linkPara(doc, [
            ["#/create-account", t("account.register_short", "Register a new account")],
            ["#/existing-account", t("account.import_account", "Import existing account")]
          ]));
        } else {
          showError(doc, card, e, t("account.resolve_failed", "Could not resolve the wallet account."));
        }
      });
  }

  return { renderAccounts: renderAccounts };
})();

if (typeof module !== "undefined") { module.exports = AccountsUI; }
