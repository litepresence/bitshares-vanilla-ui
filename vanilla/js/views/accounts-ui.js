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
  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    else if (msg.indexOf("wallet-locked") !== -1) msg = t("common.wallet_locked", "Wallet is locked.");
    else if (msg.indexOf("no-account") !== -1) msg = t("transfer.err_no_account", "No on-chain account found for the wallet's active key.");
    else if (msg.indexOf("unknown-account") !== -1) msg = t("account.unknown_name", "Unknown account name.");
    var err = DOM.error(wrap, msg);
    return err;
  }
  /* Labeled input row with its own inline error slot (Forms builds the
   * row; the err div stays per-view — Forms.fieldRow returns row only). */
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : "none"; }
  /* Internal link paragraph (href + text pairs). */
  function linkPara(doc, pairs) {
    var p = DOM.el(doc, "p", null, "muted");
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
    DOM.clear(root);
    var wrap = DOM.append(root, DOM.el(doc, "div", null, "wrap"));
    if (typeof Account === "undefined" || !Account || typeof Wallet === "undefined" || !Wallet) {
      showError(doc, wrap, t("account.manager_backend_missing", "Account backend missing: js/account.js or js/wallet.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && Chain.status().state !== "open") {
      DOM.append(wrap, DOM.pageHead(doc, t("account.manager_title", "Accounts"), "user"));
      DOM.append(wrap, DOM.el(doc, "p", t("common.status_connecting", "Connecting to network…"), "muted"));
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
        DOM.clear(root);
        var failWrap = DOM.append(root, DOM.el(doc, "div", null, "wrap"));
        DOM.append(failWrap, DOM.pageHead(doc, t("account.manager_title", "Accounts"), "user"));
        showError(doc, failWrap, new Error("not connected"), t("transfer.network_unavailable_short", "Network unavailable."));
        var acstat = DOM.el(doc, "p", "", "muted");
        try { acstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        DOM.append(failWrap, acstat);
        var acrow = DOM.el(doc, "div", null, "pools-offline-row");
        DOM.append(failWrap, acrow);
        var acretry = touchable(DOM.el(doc, "button", t("fees.retry", "Retry")));
        acretry.type = "button";
        acretry.classList.add("btn-ghost");
        DOM.append(acrow, acretry);
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
          aclink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
          try { aclink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          touchable(aclink);
          aclink.classList.add("subtle-btn");
        }
        DOM.append(acrow, aclink);
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
    DOM.clear(root);
    var wrap = DOM.append(root, DOM.el(doc, "div", null, "wrap"));
    DOM.append(wrap, DOM.pageHead(doc, t("account.manager_title", "Accounts"), "user"));
    var unlocked = false;
    try { unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys; }
    catch (e) { unlocked = false; }
    DOM.append(wrap, DOM.el(doc, "h2", t("account.this_wallet", "This wallet")));
    if (!unlocked) {
      DOM.append(wrap, DOM.el(doc, "p", t("account.unlock_to_see", "Unlock your wallet to see which on-chain account it controls."), "muted"));
      /* G8: one-line pointer to the public lookup below (the locked card is
       * otherwise a dead end for browsing). Button scrolls to + focuses the
       * lookup input — no hash change, so the router never fires. */
      var crossBtn = touchable(DOM.el(doc, "button", t("account.lookup_title", "Look up an account")));
      crossBtn.type = "button"; crossBtn.classList.add("subtle-btn"); DOM.append(wrap, crossBtn);
      crossBtn.addEventListener("click", function () {
        var box = doc.getElementById("accts-lookup");
        if (box) {
          try { if (box.scrollIntoView) box.scrollIntoView(); } catch (e) { /* focus still helps */ }
          try { box.focus(); } catch (e) { /* display-only */ }
        }
      });
      var f = Forms.labeledInput(doc, t("account.password_label", "Password ") + " ", { id: "accts-unlock-password", type: "password" });
      f.err = DOM.el(doc, "div", "", "error");
      f.err.setAttribute("aria-live", "polite"); f.err.style.display = "none"; f.row.appendChild(f.err);
      DOM.append(wrap, f.row);
      var btn = touchable(DOM.el(doc, "button", t("account.s6", "Unlock")));
      btn.id = "accts-unlock-do"; btn.type = "button"; DOM.append(wrap, btn);
      var errBox = DOM.el(doc, "div", null, "error");
      errBox.setAttribute("aria-live", "polite"); DOM.append(wrap, errBox);
      /* Punchlist MED: logged-out LoginSelector row (DashboardAccountsOnly
       * concept): CREATE ACCOUNT + LOGIN shortcuts beside the unlock form.
       * Plain literals only, existing routes only. */
      (function gateRow() {
        var p = DOM.el(doc, "p", null, "muted");
        var c = touchable(DOM.el(doc, "a", t("account.gate_create_account", "Create account")));
        c.href = "#/create-account";
        c.classList.add("subtle-btn");
        DOM.append(p, c);
        p.appendChild(doc.createTextNode(" · "));
        var l = touchable(DOM.el(doc, "a", t("account.gate_login", "Login")));
        l.href = "#/login";
        l.classList.add("subtle-btn");
        DOM.append(p, l);
        DOM.append(wrap, p);
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
      var card = DOM.el(doc, "div"); card.id = "accts-wallet-card";
      DOM.append(card, DOM.el(doc, "p", t("account.resolving", "Resolving the wallet account…"), "muted"));
      DOM.append(wrap, card);
      resolveWalletAccount(doc, myGen, card);
    }
    DOM.append(wrap, DOM.el(doc, "h2", t("account.lookup_title", "Look up an account")));
    DOM.append(wrap, DOM.el(doc, "p", t("account.lookup_hint", "Public data — no unlock needed. Opens the full account page (balances, orders, history)."), "muted"));
    var nameF = Forms.labeledInput(doc, t("account.lookup_label", "Account name ") + " ", { id: "accts-lookup", placeholder: t("account.lookup_placeholder", "account-name"), inputmode: "text" });
    nameF.err = DOM.el(doc, "div", "", "error");
    nameF.err.setAttribute("aria-live", "polite"); nameF.err.style.display = "none"; nameF.row.appendChild(nameF.err);
    DOM.append(wrap, nameF.row);
    var goBtn = touchable(DOM.el(doc, "button", t("account.open_account", "Open account page")));
    goBtn.id = "accts-open"; goBtn.type = "button"; DOM.append(wrap, goBtn);
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
    var viewBtn = touchable(DOM.el(doc, "button", t("viewing.dialog_open", "View as")));
    viewBtn.type = "button"; viewBtn.classList.add("btn-ghost"); DOM.append(wrap, viewBtn);
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
        else setFieldError(nameF, t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry."));
      });
    });
    var resetLine = DOM.el(doc, "p", null, "muted");
    var resetBtn = touchable(DOM.el(doc, "button", t("viewing.dialog_reset", "Reset")));
    resetBtn.type = "button"; resetBtn.classList.add("btn-ghost"); DOM.append(resetLine, resetBtn);
    DOM.append(wrap, resetLine);
    resetBtn.addEventListener("click", function () {
      setFieldError(nameF, "");
      try {
        if (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.clear === "function") ViewingAs.clear();
      } catch (e) { /* default stands */ }
    });
    DOM.append(wrap, DOM.el(doc, "h2", t("account.manage", "Manage")));
    DOM.append(wrap, linkPara(doc, [
      ["#/create-wallet-brainkey", t("account.create_wallet", "Create new wallet")],
      ["#/existing-account", t("account.import_account", "Import existing account")],
      ["#/create-account", t("account.register_account", "Register a new on-chain account")],
      ["#/wallet", t("account.wallet_manager", "Wallet manager")]
    ]));
    /* LOW punchlist: restore-your-account / advanced-form links (logged-out).
     * Both targets exist — batch-3-keyed, no new routes. */
    (function restoreLinks() {
      var p = DOM.el(doc, "p", null, "muted");
      var a = touchable(DOM.el(doc, "a", t("account.restore_your_account", "Restore your account")));
      a.href = "#/existing-account";
      a.classList.add("subtle-btn");
      DOM.append(p, a);
      p.appendChild(doc.createTextNode(" · "));
      var b = touchable(DOM.el(doc, "a", t("account.advanced_form", "Advanced form")));
      b.href = "#/create-account";
      b.classList.add("subtle-btn");
      DOM.append(p, b);
      DOM.append(wrap, p);
    })();
  }

  /* Fill the wallet card: active-key account id -> name. Empty states for
   * no-account / lookup failure (never blank, never throws out). */
  function resolveWalletAccount(doc, myGen, card) {
    Promise.resolve().then(function () { return Account.myAccountId(); })
      .then(function (id) { return Account.resolve(id).then(function (a) { return { id: id, name: a.name }; }); })
      .then(function (found) {
        if (myGen !== gen) return;
        DOM.clear(card);
        var list = DOM.el(doc, "dl", null, "xfer-confirm");
        function row(term, text) {
          DOM.append(list, DOM.el(doc, "dt", term)); DOM.append(list, DOM.el(doc, "dd", text)); }
        row(t("account.card_account", "Account"), found.name + " (" + found.id + ")");
        DOM.append(card, list);
        var p = DOM.el(doc, "p", null, "muted"), a = doc.createElement("a");
        a.href = "#/account/" + encodeURIComponent(found.name);
        a.textContent = t("account.open_prefix", "Open ") + found.name;
        DOM.append(p, a); DOM.append(card, p);
      })
      .catch(function (e) {
        if (myGen !== gen) return;
        DOM.clear(card);
        var msg = (e && e.message) ? e.message : t("account.lookup_failed", "Lookup failed");
        if (msg === "no-account") {
          DOM.append(card, DOM.el(doc, "p", t("account.no_account_yet", "The wallet is unlocked but its active key controls no on-chain account yet. Register one or import a funded brainkey."), "muted"));
          DOM.append(card, linkPara(doc, [
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