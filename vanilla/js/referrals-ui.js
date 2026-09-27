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
  var gen = 0;
  var ID_RE = /^1\.2\.\d+$/;
  /* textContent-only element (chain/user strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (msg.indexOf("unknown-account") !== -1) msg = fallback || "Unknown account.";
    else if (msg.indexOf("not connected") !== -1 || msg.indexOf("not-connected") !== -1) msg = "Network unavailable. Check Settings → Nodes and retry.";
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
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
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", "Referrals"));
    wrap.appendChild(el(doc, "p",
      "Who registered and referred an account, the fee-split percents, and any pending cashback. " +
      "Read-only: referral COUNTS need an off-chain history service the reference UI used, so counts are not shown here.",
      "muted"));
    if (typeof Chain === "undefined" || !Chain) {
      showError(doc, wrap, "Chain backend missing: js/chain.js failed to load.");
      return;
    }
    if (Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", "Connecting to network…", "muted"));
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
      return;
    }
    var row = el(doc, "div", null, "xfer-field");
    var label = el(doc, "label", "Account ");
    var input = doc.createElement("input");
    input.id = "ref-lookup"; input.type = "text";
    input.setAttribute("placeholder", "account name or 1.2.N");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    touchable(input); label.appendChild(input); row.appendChild(label);
    wrap.appendChild(row);
    var go = touchable(el(doc, "button", "Look up"));
    go.id = "ref-go"; go.type = "button"; wrap.appendChild(go);
    var mine = touchable(el(doc, "button", "Use my account"));
    mine.id = "ref-mine"; mine.type = "button"; wrap.appendChild(mine);
    var err = el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err);
    var body = doc.createElement("div"); wrap.appendChild(body);
    function fail(e, fallback) {
      err.textContent = "";
      var msg = (e && e.message) ? e.message : String(e || fallback || "Lookup failed");
      if (msg.indexOf("unknown-account") !== -1) msg = fallback || "Unknown account.";
      else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) msg = "Network unavailable. Check Settings → Nodes and retry.";
      else if (msg.indexOf("wallet-locked") !== -1) msg = "Wallet is locked — enter the name manually instead.";
      else if (msg.indexOf("no-account") !== -1) msg = "The unlocked wallet controls no on-chain account yet.";
      err.textContent = msg;
    }
    go.addEventListener("click", function () {
      var v = input.value.trim().toLowerCase();
      if (!v) { err.textContent = "Enter an account name or 1.2.N id."; return; }
      err.textContent = "";
      paint(doc, body, myGen, v, fail);
    });
    mine.addEventListener("click", function () {
      err.textContent = "";
      if (typeof Account === "undefined" || !Account || typeof Account.myAccountId !== "function") {
        err.textContent = "Account backend missing: js/account.js failed to load."; return;
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
    while (body.firstChild) body.removeChild(body.firstChild);
    body.appendChild(el(doc, "p", "Loading " + nameOrId + "…", "muted"));
    var acct;
    try { acct = await fetchAccount(nameOrId); }
    catch (e) {
      if (myGen !== gen) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      fail(e, "Unknown account: " + nameOrId + ".");
      return;
    }
    if (myGen !== gen) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    body.appendChild(el(doc, "h3", (acct.name || nameOrId) + " (" + acct.id + ")"));
    paintParties(doc, body, myGen, acct);
    paintPercents(doc, body, acct);
    paintCashback(doc, body, myGen, acct);
    paintVesting(doc, body, myGen, acct);
  }

  /* Registrar / referrer / lifetime-referrer ids -> linked names. */
  async function paintParties(doc, body, myGen, acct) {
    var box = doc.createElement("section");
    box.appendChild(el(doc, "h3", "Registrar & referrer"));
    var loading = el(doc, "p", "Resolving names…", "muted");
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
      box.appendChild(el(doc, "p", "No registrar or referrer recorded for this account.", "muted"));
      return;
    }
    var dl = el(doc, "dl", null, "xplore-fields");
    [["Registrar", acct.registrar], ["Referrer", acct.referrer],
     ["Lifetime referrer", acct.lifetime_referrer]].forEach(function (pr) {
      if (!pr[1]) return;
      dl.appendChild(el(doc, "dt", pr[0]));
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
    box.appendChild(el(doc, "h3", "Fee split"));
    var have = (acct.network_fee_percentage !== undefined) ||
      (acct.lifetime_referrer_fee_percentage !== undefined) ||
      (acct.referrer_rewards_percentage !== undefined);
    if (!have) {
      box.appendChild(el(doc, "p", "No fee-split fields returned for this account.", "muted"));
      body.appendChild(box);
      return;
    }
    var dl = el(doc, "dl", null, "xplore-fields");
    function row(term, raw, human, note) {
      dl.appendChild(el(doc, "dt", term));
      var dd = el(doc, "dd", human);
      dd.title = "raw " + String(raw) + (note ? " — " + note : "");
      dl.appendChild(dd);
    }
    if (acct.network_fee_percentage !== undefined)
      row("Network share", acct.network_fee_percentage, pctHuman(acct.network_fee_percentage), "of every fee");
    if (acct.lifetime_referrer_fee_percentage !== undefined)
      row("Lifetime-referrer share", acct.lifetime_referrer_fee_percentage, pctHuman(acct.lifetime_referrer_fee_percentage), "of every fee");
    if (acct.referrer_rewards_percentage !== undefined)
      row("Referrer reward", acct.referrer_rewards_percentage, pctHuman(acct.referrer_rewards_percentage) + " of the referrer slice", "share of the remainder after network + lifetime cuts");
    box.appendChild(dl);
    body.appendChild(box);
  }

  /* Pending cashback from the statistics object (core units -> human). */
  async function paintCashback(doc, body, myGen, acct) {
    var box = doc.createElement("section");
    box.appendChild(el(doc, "h3", "Pending cashback"));
    var loading = el(doc, "p", "Loading statistics…", "muted");
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
      var dl = el(doc, "dl", null, "xplore-fields");
      [["Pending fees", st.pending_fees], ["Pending vested fees", st.pending_vested_fees]].forEach(function (pr) {
        dl.appendChild(el(doc, "dt", pr[0]));
        var raw = (pr[1] !== undefined && pr[1] !== null) ? String(pr[1]) : "0";
        var human = raw;
        try {
          if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function")
            human = Format.formatAmount(raw, prec);
        } catch (e) { human = raw; }
        var dd = el(doc, "dd", human);
        dd.title = "raw " + raw;
        dl.appendChild(dd);
      });
      box.appendChild(dl);
    } catch (e) {
      if (myGen !== gen) return;
      box.removeChild(loading);
      box.appendChild(el(doc, "p", "No cashback statistics available for this account.", "muted"));
    }
  }

  /* Vesting balances for the account; empty state when none/unavailable. */
  async function paintVesting(doc, body, myGen, acct) {
    var box = doc.createElement("section");
    box.appendChild(el(doc, "h3", "Vesting balances"));
    var loading = el(doc, "p", "Loading vesting balances…", "muted");
    box.appendChild(loading); body.appendChild(box);
    try {
      var rows = await dbCall("get_vesting_balances", [acct.id]);
      if (myGen !== gen) return;
      box.removeChild(loading);
      if (!rows || rows.length === 0) {
        box.appendChild(el(doc, "p", "No vesting balances for this account.", "muted"));
        return;
      }
      var ul = doc.createElement("ul");
      rows.forEach(function (v) {
        var li = doc.createElement("li");
        var bal = v && v.balance;
        li.textContent = v && v.id
          ? v.id + (bal ? " · " + String(bal.amount) + " of " + bal.asset_id : "")
          : JSON.stringify(v);
        if (bal && bal.amount !== undefined) li.title = "raw " + String(bal.amount);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    } catch (e) {
      if (myGen !== gen) return;
      box.removeChild(loading);
      box.appendChild(el(doc, "p", "Vesting balances unavailable on this node.", "muted"));
    }
  }

  return { renderReferrals: renderReferrals };
})();

if (typeof module !== "undefined") { module.exports = ReferralsUI; }
