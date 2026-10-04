/* referrals-ui.js — read-only referrer/registrar display (matrix C30).
 * Owns: #/referrals (account lookup -> registrar, referrer, lifetime
 *   referrer with names + fee-split percents, pending cashback from the
 *   statistics object, vesting balances where the node returns any).
 *   Reads only: get_account_by_name / get_accounts / get_objects /
 *   get_vesting_balances. No signing, no broadcasts, no ES-wrapper calls
 *   (reference #1's AccountReferralsTable leans on an off-chain ES endpoint
 *   for referral COUNTS — this page shows what the chain itself returns and
 *   says plainly that counts are unavailable).
 * Consumes: Chain.db/.call (sole socket owner), Account.resolve (name<->id,
 *   guarded), Wallet/Account for the my-account shortcut (guarded), Format
 *   (pending-fee display only). Percent fields are uint16 hundredths of a
 *   percent (config.hpp GRAPHENE_100_PERCENT=10000): raw 100 -> "1%".
 * Globals/side effects: DOM under root only; global ReferralsUI. Gen counter
 *   tears down stale lookups + reconnect work.
 * Refs: bitshares-ui AccountMembership.jsx:57-71 (name resolution + fee-split
 *   math), AccountReferralsTable.jsx:66-89 (ES-wrapper counts — NOT copied,
 *   stated as unavailable); #4 account_object.hpp:201-206 (percent fields),
 *   account_statistics_object (pending_fees/pending_vested_fees),
 *   database_api.hpp:397 (get_vesting_balances), :326 (get_account_by_name).
 * Created by: deferred-matrix close-out (C30/C31/C34/C35 batch).
 */
var ReferralsUI = (function () {
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
  var ID_RE = /^1\.2\.\d+$/;
  /* No local el — use DOM.el */
  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
/* clearRoot removed — use DOM.clear */
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("referrals.unexpected_error", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) msg = fallback || t("referrals.unknown_account", "Unknown account.");
    else if (msg.indexOf("not connected") !== -1 || msg.indexOf("not-connected") !== -1) msg = t("referrals.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    var err = DOM.error(wrap, msg); return err;
  }
  /* Hundredths-of-a-percent uint16 -> human "x.yy%" string (integer math:
   * raw 100 -> "1%", raw 150 -> "1.5%", raw 2000 -> "20%"). */
  function pctHuman(raw) {
    var n = Number(raw);
    if (!isFinite(n) || n < 0) return String(raw);
    var whole = Math.floor(n / 100), frac = n % 100;
    if (frac === 0) return whole + "%";
    var fs = (frac < 10 ? "0" + frac : String(frac)).replace(/0$/, "");
    return whole + "." + fs + "%";
  }

  /* One database-API round trip; "not-connected" when no socket is open. */
  async function dbCall(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); } catch (e) {
      var m = (e && e.message) ? e.message : String(e || "");
      if (m.indexOf("not connected") !== -1) throw new Error("not-connected");
      throw e;
    }
  }

  /* Full account object for a name or 1.2.N id. Fails "unknown-account". */
  async function fetchAccount(nameOrId) {
    var rows;
    if (ID_RE.test(nameOrId)) {
      rows = await dbCall("get_accounts", [[nameOrId]]);
      if (!rows || !rows[0]) throw new Error("unknown-account");
      return rows[0];
    }
    var acct = await dbCall("get_account_by_name", [nameOrId]);
    if (!acct) throw new Error("unknown-account");
    return acct;
  }

  /* Route entry: lookup box + results section. Offline waits for connect
   * (transfer-ui.js pattern, gen-guarded); every sub-fetch fails inline so
   * one missing piece never blanks the rest. */
  function renderReferrals(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.el(doc, "h1", t("referrals.referrals", "Referrals")));
    wrap.appendChild(DOM.el(doc, "p", t("referrals.intro", "Who registered and referred an account, the fee-split percents, and any pending cashback. Read-only: referral COUNTS need an off-chain history service the reference UI used, so counts are not shown here."),
      "muted"));
    if (typeof Chain === "undefined" || !Chain) {
      showError(doc, wrap, t("referrals.chain_backend_missing_js_chain_js_failed_to_l", "Chain backend missing: js/chain.js failed to load."));
      return;
    }
    if (Chain.status().state !== "open") {
      wrap.appendChild(DOM.el(doc, "p", t("referrals.connecting_to_network", "Connecting to network…"), "muted"));
      var rstat = DOM.el(doc, "p", "", "muted");
      try { rstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      wrap.appendChild(rstat);
      var rrow = DOM.el(doc, "div", null, "pools-offline-row");
      wrap.appendChild(rrow);
      var rtry = touchable(DOM.el(doc, "button", t("fees.retry", "Retry")));
      rtry.type = "button";
      rrow.appendChild(rtry);
      var roff = null;
      try { roff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { roff = null; }
      var rrender = function () { renderReferrals(root); };
      if (roff && typeof roff.wire === "function") {
        try { roff.wire(rtry, rstat, rrender, t); } catch (e) { rtry.addEventListener("click", rrender); }
      } else {
        rtry.addEventListener("click", rrender);
      }
      var rlink = null;
      if (roff && typeof roff.settingsLink === "function") {
        try { rlink = roff.settingsLink(doc, t); } catch (e) { rlink = null; }
      }
      if (!rlink) {
        rlink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
        try { rlink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
        touchable(rlink);
      }
      rrow.appendChild(rlink);
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = function () {};
      if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
        off = Store.subscribe("connection", function (st) {
          if (settled || myGen !== gen) return;
          if (st && st.state === "open") {
            settled = true; try { off(); } catch (e) {}
            if (typeof location === "undefined" || location.hash === hashAtEntry) renderReferrals(root);
          }
        });
      }
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; try { off(); } catch (e) {}
      }, 15000);
      /* Automated handshake on entry (shared Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
      return;
    }
    var row = DOM.el(doc, "div", null, "xfer-field");
    var label = DOM.el(doc, "label", t("referrals.account", "Account "));
    var input = doc.createElement("input");
    input.id = "ref-lookup"; input.type = "text";
    input.setAttribute("placeholder", t("referrals.account_name_or_1_2_n", "account name or 1.2.N"));
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    touchable(input); label.appendChild(input); row.appendChild(label);
    wrap.appendChild(row);
    var go = touchable(DOM.el(doc, "button", t("referrals.look_up", "Look up")));
    go.id = "ref-go"; go.type = "button"; wrap.appendChild(go);
    var mine = touchable(DOM.el(doc, "button", t("referrals.use_my_account", "Use my account")));
    mine.id = "ref-mine"; mine.type = "button"; wrap.appendChild(mine);
    var err = DOM.el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err);
    var body = doc.createElement("div"); wrap.appendChild(body);
    function fail(e, fallback) {
      err.textContent = "";
      var msg = (e && e.message) ? e.message : String(e || fallback || t("referrals.lookup_failed", "Lookup failed"));
      if (msg.indexOf("unknown-account") !== -1) msg = fallback || t("referrals.unknown_account", "Unknown account.");
      else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) msg = t("referrals.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
      else if (msg.indexOf("wallet-locked") !== -1) msg = t("referrals.wallet_is_locked_enter_the_name_manually_inst", "Wallet is locked — enter the name manually instead.");
      else if (msg.indexOf("no-account") !== -1) msg = t("referrals.the_unlocked_wallet_controls_no_on_chain_acco", "The unlocked wallet controls no on-chain account yet.");
      err.textContent = msg;
    }
    go.addEventListener("click", function () {
      var v = input.value.trim().toLowerCase();
      if (!v) { err.textContent = t("referrals.enter_an_account_name_or_1_2_n_id", "Enter an account name or 1.2.N id."); return; }
      err.textContent = "";
      paint(doc, body, myGen, v, fail);
    });
    mine.addEventListener("click", function () {
      err.textContent = "";
      if (typeof Account === "undefined" || !Account || typeof Account.myAccountId !== "function") {
        err.textContent = t("referrals.account_backend_missing_js_account_js_failed", "Account backend missing: js/account.js failed to load."); return;
      }
      mine.disabled = true;
      Promise.resolve().then(function () { return Account.myAccountId(); })
        .then(function (id) { return Account.resolve(id); })
        .then(function (a) {
          if (myGen !== gen) return;
          mine.disabled = false; input.value = a.name;
          paint(doc, body, myGen, a.name, fail);
        })
        .catch(function (e) { if (myGen === gen) { mine.disabled = false; fail(e); } });
    });
  }

  /* Fill the results box for one account: parties, percents, cashback, vesting.
   * Each block fails inline (empty state), never wiping the others. */
  async function paint(doc, body, myGen, nameOrId, fail) {
    DOM.clear(body);
    body.appendChild(DOM.el(doc, "p", "Loading " + nameOrId + "…", "muted"));
    var acct;
    try { acct = await fetchAccount(nameOrId); }
    catch (e) {
      if (myGen !== gen) return;
      DOM.clear(body);
      fail(e, "Unknown account: " + nameOrId + ".");
      return;
    }
    if (myGen !== gen) return;
    DOM.clear(body);
    body.appendChild(DOM.el(doc, "h3", (acct.name || nameOrId) + " (" + acct.id + ")"));
    paintParties(doc, body, myGen, acct);
    paintPercents(doc, body, acct);
    paintCashback(doc, body, myGen, acct);
    paintVesting(doc, body, myGen, acct);
  }

  /* Registrar / referrer / lifetime-referrer ids -> linked names. */
  async function paintParties(doc, body, myGen, acct) {
    var box = doc.createElement("section");
    box.appendChild(DOM.el(doc, "h3", t("referrals.registrar_referrer", "Registrar & referrer")));
    var loading = DOM.el(doc, "p", t("referrals.resolving_names", "Resolving names…"), "muted");
    box.appendChild(loading); body.appendChild(box);
    var ids = [acct.registrar, acct.referrer, acct.lifetime_referrer].filter(function (x) {
      return typeof x === "string" && !!x;
    });
    var names = {};
    try {
      var rows = ids.length ? await dbCall("get_accounts", [ids]) : [];
      (rows || []).forEach(function (r) { if (r && r.id) names[r.id] = r.name; });
    } catch (e) { /* ids still shown below */ }
    if (myGen !== gen) return;
    box.removeChild(loading);
    if (!ids.length) {
      box.appendChild(DOM.el(doc, "p", t("referrals.no_registrar_or_referrer_recorded_for_this_ac", "No registrar or referrer recorded for this account.") + t("referrals.faucet_hint", " Faucet-created accounts normally carry one."), "muted"));
      return;
    }
    var dl = DOM.el(doc, "dl", null, "xplore-fields");
    [[t("referrals.registrar", "Registrar"), acct.registrar], [t("referrals.referrer", "Referrer"), acct.referrer],
     [t("referrals.lifetime_referrer", "Lifetime referrer"), acct.lifetime_referrer]].forEach(function (pr) {
      if (!pr[1]) return;
      dl.appendChild(DOM.el(doc, "dt", pr[0]));
      var dd = doc.createElement("dd");
      var a = doc.createElement("a");
      var nm = names[pr[1]];
      a.href = nm ? "#/account/" + encodeURIComponent(nm) : "#/account/" + encodeURIComponent(pr[1]);
      a.textContent = nm ? nm + " (" + pr[1] + ")" : pr[1];
      dd.appendChild(a); dl.appendChild(dd);
    });
    box.appendChild(dl);
  }

  /* Fee-split percent fields, raw + human (never raw alone). */
  function paintPercents(doc, body, acct) {
    var box = doc.createElement("section");
    box.appendChild(DOM.el(doc, "h3", t("referrals.fee_split", "Fee split")));
    var have = (acct.network_fee_percentage !== undefined) ||
      (acct.lifetime_referrer_fee_percentage !== undefined) ||
      (acct.referrer_rewards_percentage !== undefined);
    if (!have) {
      box.appendChild(DOM.el(doc, "p", t("referrals.no_fee_split_fields_returned_for_this_account", "No fee-split fields returned for this account.") + t("referrals.node_hint", " The node omitted them — retry or try another node."), "muted"));
      body.appendChild(box);
      return;
    }
    var dl = DOM.el(doc, "dl", null, "xplore-fields");
    function row(term, raw, human, note) {
      dl.appendChild(DOM.el(doc, "dt", term));
      var dd = DOM.el(doc, "dd", human);
      dd.title = t("account.raw_prefix", "raw ") + String(raw) + (note ? " — " + note : "");
      dl.appendChild(dd);
    }
    if (acct.network_fee_percentage !== undefined)
      row(t("referrals.network_share", "Network share"), acct.network_fee_percentage, pctHuman(acct.network_fee_percentage), "of every fee");
    if (acct.lifetime_referrer_fee_percentage !== undefined)
      row(t("referrals.lifetime_referrer_share", "Lifetime-referrer share"), acct.lifetime_referrer_fee_percentage, pctHuman(acct.lifetime_referrer_fee_percentage), "of every fee");
    if (acct.referrer_rewards_percentage !== undefined)
      row(t("referrals.referrer_reward", "Referrer reward"), acct.referrer_rewards_percentage, pctHuman(acct.referrer_rewards_percentage) + " of the referrer slice", "share of the remainder after network + lifetime cuts");
    box.appendChild(dl);
    body.appendChild(box);
  }

  /* Pending cashback from the statistics object (core units -> human). */
  async function paintCashback(doc, body, myGen, acct) {
    var box = doc.createElement("section");
    box.appendChild(DOM.el(doc, "h3", t("referrals.pending_cashback", "Pending cashback")));
    var loading = DOM.el(doc, "p", t("referrals.loading_statistics", "Loading statistics…"), "muted");
    box.appendChild(loading); body.appendChild(box);
    try {
      if (!acct.statistics) throw new Error("no-statistics");
      var objs = await dbCall("get_objects", [[acct.statistics]]);
      var st = objs && objs[0];
      if (!st) throw new Error("no-statistics");
      var prec = 5;
      try {
        var core = await dbCall("get_assets", [["1.3.0"]]);
        if (core && core[0] && typeof core[0].precision === "number") prec = core[0].precision;
      } catch (e) { /* precision 5 stands */ }
      if (myGen !== gen) return;
      box.removeChild(loading);
      var dl = DOM.el(doc, "dl", null, "xplore-fields");
      [[t("referrals.pending_fees", "Pending fees"), st.pending_fees], [t("referrals.pending_vested_fees", "Pending vested fees"), st.pending_vested_fees]].forEach(function (pr) {
        dl.appendChild(DOM.el(doc, "dt", pr[0]));
        var raw = (pr[1] !== undefined && pr[1] !== null) ? String(pr[1]) : "0";
        var human = raw;
        try {
          if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function")
            human = Format.formatAmount(raw, prec);
        } catch (e) { human = raw; }
        var dd = DOM.el(doc, "dd", human);
        dd.title = t("account.raw_prefix", "raw ") + raw;
        dl.appendChild(dd);
      });
      box.appendChild(dl);
    } catch (e) {
      if (myGen !== gen) return;
      box.removeChild(loading);
      box.appendChild(DOM.el(doc, "p", t("referrals.no_cashback_statistics_available_for_this_acc", "No cashback statistics available for this account."), "muted"));
    }
  }

  /* Vesting balances for the account; empty state when none/unavailable. */
  async function paintVesting(doc, body, myGen, acct) {
    var box = doc.createElement("section");
    box.appendChild(DOM.el(doc, "h3", t("referrals.vesting_balances", "Vesting balances")));
    var loading = DOM.el(doc, "p", t("referrals.loading_vesting_balances", "Loading vesting balances…"), "muted");
    box.appendChild(loading); body.appendChild(box);
    try {
      var rows = await dbCall("get_vesting_balances", [acct.id]);
      if (myGen !== gen) return;
      box.removeChild(loading);
      if (!rows || rows.length === 0) {
        box.appendChild(DOM.el(doc, "p", t("referrals.no_vesting_balances_for_this_account", "No vesting balances for this account.") + t("vesting.balances_hint", " Balances appear after a transfer with a vesting policy lands here."), "muted"));
        return;
      }
      var ul = doc.createElement("ul");
      rows.forEach(function (v) {
        var li = doc.createElement("li");
        var bal = v && v.balance;
        li.textContent = v && v.id
          ? v.id + (bal ? " · " + String(bal.amount) + " of " + bal.asset_id : "")
          : JSON.stringify(v);
        if (bal && bal.amount !== undefined) li.title = t("account.raw_prefix", "raw ") + String(bal.amount);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    } catch (e) {
      if (myGen !== gen) return;
      box.removeChild(loading);
      box.appendChild(DOM.el(doc, "p", t("referrals.vesting_balances_unavailable_on_this_node", "Vesting balances unavailable on this node."), "muted"));
    }
  }

  return { renderReferrals: renderReferrals };
})();

if (typeof module !== "undefined") { module.exports = ReferralsUI; }
