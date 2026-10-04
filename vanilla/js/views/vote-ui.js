/* vote-ui.js — the #/voting governance screen (witnesses, committee, workers).
 *
 * What it owns: DOM for the /voting route only — account strip, proxy picker,
 * three slate tabs with search, publish confirm (named rows), result panel.
 * Reads via Vote.lists/currentVotes/fee (this file signs NOTHING through
 * Vote); signing/broadcast reuse Tx.sign + a local op-6 send (Tx.broadcast's
 * history poll only matches op-0 transfers — same reason trade-ui.js sends
 * locally, see its sendTx header).
 * Consumes: Vote (lists, currentVotes, fee, PROXY_TO_SELF), Account.resolve/
 *   myAccountId, Wallet.isUnlocked/unlock/keys, Tx.fee fallback/buildTx/sign,
 *   Format.formatAmount, Chain.db/call/status/net, Store.loadSettings/
 *   subscribe (connect wait, same pattern as transfer-ui.js).
 * Globals/side effects: DOM under the router root, global VoteUI only.
 *   WIFs pass as JS values into Tx.sign — never into the DOM. Generation
 *   counter invalidates stale async work after teardown (see teardown note).
 *   Slate state + list rows live in js/vote-slate.js (VoteSlate global,
 *   slice-18 split — bodies moved verbatim; this file keeps routing, proxy
 *   fetch, publish, and result screens).
 * Created by: building-vanilla-slices skill, slice-08-voting plan Task 3.
 *
 * CHAIN TRUTH (from the slice-08 plan References; #4 wins):
 * - Vote tx is op 6 account_update; voting sets ONLY new_options
 *   (protocol/account.hpp:151-162; serializer tx.js serializeAccountUpdateOp).
 * - new_options {memo_key UNCHANGED from the account, voting_account,
 *   num_witness, num_committee, votes sorted} (protocol/account.hpp:39-59).
 * - No-proxy publish uses the "1.2.5" proxy-to-self sentinel (protocol/
 *   config.hpp:150; #1 AccountVoting.jsx:290). RETRY RULE (recorded
 *   ambiguity, plan Task 4): if the node rejects the SEND with 1.2.5, retry
 *   ONCE with the voter's own id — send-rejection only, never after the
 *   node accepted the tx (rebroadcasting an accepted tx risks a double
 *   vote-publish). The result panel reports which mode the chain accepted.
 * - num_witness/committee count witness/committee votes only; worker votes
 *   never count (account.hpp:50-55). Enforced by construction below.
 * - Slate tabs disable while a proxy is set (Reference #18: #1
 *   Voting/Witnesses.jsx:78-90 hasProxy pattern); the proxy's own slate
 *   shows read-only instead.
 * - Stale votes (expired workers, legacy vote_against) are dropped by
 *   construction: the published slate is built ONLY from live list rows +
 *   the current checkboxes, never by echoing the old on-chain votes array
 *   (equivalent of #1 AccountVoting.jsx:304-325 stripping).
 * - Confirm dialog shows NAMED rows (proxy, added/removed names per tab,
 *   counts, fee) — never raw JSON.stringify (beats #3 popup.js:5764-5770).
 * MONEY DISCIPLINE (principle #6): total_votes / daily_pay stay raw-int
 *   strings until Format.formatAmount(raw, 5) at render; share-% is integer
 *   hundredths math (basis GRAPHENE_100_PERCENT=10000, config.hpp:102-103):
 *   share_bp = total * 10000 / supply via BigInt, formatted without float.
 *
 * PUNCHLIST 2026-09-29 (#/voting HIGHs — joins/lock entry, budget line):
 * - Join-as-witness / Update-witness / Join-committee ENTRY buttons live
 *   below (gov row + inline forms + named-row confirms). The flows are
 *   op-6-flavored: they reuse the vote-publish idioms (Vote.* reads for
 *   prefill, Tx.fee live chain estimate via get_required_fees, Tx.buildTx
 *   envelope, fresh-WIF sign gate so the password is asked ONLY at sign).
 *   BROADCAST IS LIVE: witness_create (op 20) / witness_update (op 21) /
 *   committee_member_create (op 29) / committee_member_update (op 30)
 *   serialize in tx.js (FC field order per witness.hpp:81/:84 and
 *   committee_member.hpp:103-106, no extensions field; testnet
 *   evaluator-reached proof in tooling/prove_witness_update_f1.cjs), so
 *   the sign step sends for real and proves by re-reading the created
 *   object (create: object exists; update: url matches). Full inclusion
 *   needs an LTM payer (witness_evaluator.cpp:35 /
 *   committee_member_evaluator.cpp:37 assert is_lifetime_member); a basic
 *   account gets the node's message inline, never a silent failure.
 *   Join data (url, block_signing_key) rides the gov op itself, never an
 *   op-6 new_options (protocol/account.hpp:39-59 has no such fields).
 *   Field shapes follow #3 bitshares-api.js:2621+ (op 20/21) and :2775+
 *   (op 29), cross-read with #2 WitnessCommittee.jsx and BJS
 *   operations.js witness_create/witness_update/committee_member_create.
 * - CREATE LOCK is a plain link to #/tickets: amount prefill is NOT trivial
 *   (router currentPath strips query strings and ticket-ui.js parses no
 *   hash params — wiring prefill would touch router/ticket-ui, outside
 *   this punchlist's file scope), so the entry links without prefill.
 * - WORKER BUDGET: the per-day cap reads cleanly off 2.0.0 parameters
 *   (same get_objects call Vote.lists already makes); the TOTAL needs the
 *   budget-record object whose id is not cleanly derivable here, so total
 *   renders as a dash and stays deferred (recorded here).
 * - I18N NOTE: new labels below are plain literals (no new t() keys —
 *   locale dicts are outside this punchlist's file scope, and check_i18n
 *   requires every t() default to already exist in en.json). A later i18n
 *   batch should key them; check_i18n stays green meanwhile.
 */
var VoteUI = (function () {
  "use strict";
  /* Batch-2c i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws.
   * Dynamic sentences keep their code structure (batch-2b precedent): only
   * complete static literals are wrapped, values and punctuation glue stay
   * raw, so every default below is byte-verbatim in the HEAD blob. vars
   * fills %(name)s placeholders; without I18n the raw default returns
   * unfilled. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }


  var PROXY_SENTINEL = "1.2.5";
  var CORE_ASSET = "1.3.0";
  var CORE_PRECISION_FALLBACK = 5;
  var PROVE_TIMEOUT_MS = 30000;
  var PROVE_INTERVAL_MS = 2500;

  /* Generation counter: every renderVoting bumps it; async continuations
   * capture their generation and bail when it no longer matches. The router
   * reuses the same #view element across routes, so teardown = abandoning
   * the old generation (plus unsubscribing the connect listener). No
   * timers survive: the connect wait clears its timeout on settle. */
  var gen = 0;

  /* Create an element with optional text + class (textContent only — user
   * and chain strings never reach innerHTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  /* Wide (viewport-gaps fix 2026-09-28): full-bleed stacked grid
   * ≥1200px; children span full width via app.css .wide contract. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* Inline error panel that is never blank: thrown values map to human
   * sentences; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var box = el(doc, "div", null, "error");
    box.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("vote.unexpected", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) msg = fallback || t("vote.unknown_account", "Unknown account.");
    else if (msg.indexOf("no-account") !== -1) msg = t("vote.no_account", "No on-chain account found for the wallet's active key. Enter an account name below.");
    else if (msg.indexOf("wallet-locked") !== -1) msg = t("vote.wallet_locked", "Wallet is locked.");
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = t("vote.offline", "Network unavailable. Check Settings → Nodes and retry.");
    } else if (msg.indexOf("empty-list") !== -1) msg = t("vote.empty_list", "The node returned no witnesses or committee members.");
    box.textContent = msg;
    wrap.appendChild(box);
    return box;
  }

  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted");
    p.setAttribute("aria-live", "polite");
    wrap.appendChild(p);
    return p;
  }

  /* Route entry: renderVoting(root). Waits for the shared connection, then
   * renders governance LISTS publicly (gate-repair): locked viewers browse as
   * the committee-account 1.2.0 default; the password gate lives ONLY at
   * Publish-sign time (showConfirm WIF check + sendAndProve wallet-locked). */
  function renderVoting(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Vote === "undefined" || !Vote ||
        typeof Tx === "undefined" || !Tx ||
        typeof Account === "undefined" || !Account ||
        typeof Wallet === "undefined" || !Wallet ||
        typeof Format === "undefined" || !Format) {
      showError(doc, wrap, t("vote.backend_missing", "Voting backend missing: js/vote.js, js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "h1", t("vote.title", "Voting")));
      wrap.appendChild(el(doc, "p", t("vote.connecting", "Connecting to network…"), "muted"));
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderVoting(root);
        }
      });
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        if (myGen !== gen) return;
        clearRoot(root);
        var failed = makeWrap(doc, root);
        failed.appendChild(el(doc, "h1", t("vote.title", "Voting")));
        showError(doc, failed, new Error("not-connected"), t("vote.offline_short", "Network unavailable."));
        var vstat = el(doc, "p", "", "muted");
        try { vstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        failed.appendChild(vstat);
        var vrow = el(doc, "div", null, "pools-offline-row");
        failed.appendChild(vrow);
var retry = touchable(el(doc, "button", t("vote.retry", "Retry"))); retry.type = "button"; retry.className = "btn-ghost";
      vrow.appendChild(retry);
        var voff = null;
        try { voff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { voff = null; }
        if (voff && typeof voff.wire === "function") {
          try { voff.wire(retry, vstat, function () { renderVoting(root); }, t); } catch (e) { retry.addEventListener("click", function () { renderVoting(root); }); }
        } else {
          retry.addEventListener("click", function () { renderVoting(root); });
        }
        var vlink = null;
        if (voff && typeof voff.settingsLink === "function") {
          try { vlink = voff.settingsLink(doc, t); } catch (e) { vlink = null; }
        }
        if (!vlink) {
          vlink = el(doc, "a", t("notice.open_settings", "Open Settings"));
          try { vlink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          vlink.className = "subtle-btn";
        }
        vrow.appendChild(vlink);
      }, 15000);
      /* Automated handshake on entry (shared Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
      return;
    }
    /* No entry unlock gate: public lists render locked. Resolve the
     * wallet account when unlocked, else preview as committee-account 1.2.0.
     * myAccountId is null-tolerant here (fallback); it stays loud only at
     * sign time (sendAndProve throws wallet-locked). */
    wrap.appendChild(el(doc, "p", t("vote.loading", "Loading governance data…"), "muted"));
    Account.myAccountId().then(function (id) {
      return Account.resolve(id);
    }).catch(function () {
      return Account.resolve((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0");
    }).then(function (me) {
      if (myGen !== gen) return;
      loadAll(root, doc, me, myGen);
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearRoot(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(el(doc, "h1", t("vote.title", "Voting")));
      showError(doc, failed, e, t("vote.load_account_failed", "Could not load your account."));
      showAccountPicker(doc, failed, root, myGen, (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0");
    });
  }

  /* Fallback account picker (no wallet-bound account, or lookup failed):
   * name/id input + resolve, then load the view as that account. */
  function showAccountPicker(doc, wrap, root, myGen, preset) {
    var pickerF = Forms.labeledInput(doc, t("vote.vote_as_label", "Vote as (name or 1.2.N) "),
      { value: preset || "", autocomplete: "off" });
    wrap.appendChild(pickerF.row);
    var input = pickerF.input;
    var btn = touchable(el(doc, "button", t("vote.load_votes", "Load votes")));
    btn.type = "button";
    wrap.appendChild(btn);
    var errBox = el(doc, "div", null, "error");
    errBox.setAttribute("aria-live", "polite");
    wrap.appendChild(errBox);
    btn.addEventListener("click", function () {
      errBox.textContent = "";
      btn.disabled = true;
      Account.resolve(input.value.trim()).then(function (acct) {
        btn.disabled = false;
        if (myGen === gen) { clearRoot(root); loadAll(root, doc, acct, myGen); }
      }).catch(function (e) {
        btn.disabled = false;
        errBox.textContent = (e && e.message) ? t("vote.unknown_account", "Unknown account.") : String(e || t("vote.unknown_account", "Unknown account."));
      });
    });
  }

  /* Load lists + current slate + chain supply, then show the view. Workers
   * MAY be empty (valid on testnets — renders an empty state, never throws
   * beyond Vote.lists' own empty-list rule for witnesses+committee). */
  async function loadAll(root, doc, me, myGen) {
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "p", t("vote.loading", "Loading governance data…"), "muted"));
    try {
      var lists = await Vote.lists();
      if (myGen !== gen) return;
      var slate = await Vote.currentVotes(me.id);
      if (myGen !== gen) return;
      var supplyRaw = await chainSupplyRaw();
      if (myGen !== gen) return;
      clearRoot(root);
      showView(doc, makeWrap(doc, root), root, me, lists, slate, supplyRaw, myGen);
    } catch (e) {
      if (myGen !== gen) return;
      clearRoot(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(el(doc, "h1", t("vote.title", "Voting")));
      showError(doc, failed, e, t("vote.load_failed", "Could not load governance data."));
var retry = touchable(el(doc, "button", t("vote.retry", "Retry"))); retry.type = "button"; retry.className = "btn-ghost";
      failed.appendChild(retry);
    }
  }

  /* Chain BTS/TEST supply for share-% (best-effort: "" hides the % part,
   * weights still render human — a missing denominator is display-only). */
  async function chainSupplyRaw() {
    try {
      var dbId = await Chain.db();
      var props = await Chain.call(dbId, "get_dynamic_global_properties", []);
      if (props && props.current_supply !== undefined && props.current_supply !== null) {
        return String(props.current_supply);
      }
    } catch (e) { /* fall through to "" */ }
    return "";
  }

  /* Main view: account strip + proxy picker + tabs + publish/reset. */
  function showView(doc, wrap, root, me, lists, slate, supplyRaw, myGen) {
    var st = VoteSlate.newState(me, lists, slate);
    st.supply = supplyRaw || "";

    wrap.appendChild(el(doc, "h1", t("vote.title", "Voting")));
    var meLine = el(doc, "p", null, "muted");
    meLine.textContent = t("vote.voting_as", "Voting as: ") + me.name + " (" + me.id + ")";
    wrap.appendChild(meLine);
    /* Public-preview notice: locked viewers see the committee-account slate
     * until they unlock and vote as themselves. */
    try {
      var lockedView = (typeof Wallet === "undefined" || typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked());
      if (lockedView || (me && me.id === "1.2.0"))
        wrap.appendChild(el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: me.name, id: me.id }), "muted"));
    } catch (e) { /* notice is display-only */ }

    /* Punchlist gov row (see header): join entries + lock link + budget.
     * Painted once here (refresh() below repaints proxy/tabs/list/actions
     * only, so an open join form survives slate checkbox toggles). */
    var govRow = el(doc, "div", null, "vote-gov-row");
    govRow.style.display = "flex";
    govRow.style.flexWrap = "wrap";
    govRow.style.gap = "8px";
    var joinWBtn = touchable(el(doc, "button", t("vote.join_as_witness", "Join as witness")));
    joinWBtn.type = "button";
    var updWBtn = touchable(el(doc, "button", t("vote.update_witness", "Update witness")));
    updWBtn.type = "button";
    var joinCBtn = touchable(el(doc, "button", t("vote.join_committee", "Join committee")));
    joinCBtn.type = "button";
    var lockLink = el(doc, "a", t("vote.increase_voting_power_create_lock", "Increase voting power (create lock)"));
    lockLink.setAttribute("href", "#/tickets");
    lockLink.style.display = "inline-block";
    lockLink.style.alignSelf = "center";
    lockLink.className = "subtle-btn";
    govRow.appendChild(joinWBtn);
    govRow.appendChild(updWBtn);
    govRow.appendChild(joinCBtn);
    govRow.appendChild(lockLink);
    wrap.appendChild(govRow);
    var budgetLine = el(doc, "p", t("vote.worker_budget_loading", "Worker budget: loading…"), "muted");
    budgetLine.setAttribute("aria-live", "polite");
    wrap.appendChild(budgetLine);
    /* Punchlist MED: hide-legacy-proposals toggle (Workers.jsx:129,153
     * concept). Always-on honest checkbox: worker lists come from
     * get_all_workers(false), so expired rows are excluded by construction
     * (vote.js lists()) — there is nothing to unhide. Plain literals only. */
    (function legacyToggle() {
      var lab = doc.createElement("label");
      var box = doc.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      box.disabled = true;
      box.setAttribute("aria-disabled", "true");
      touchable(box);
      lab.appendChild(box);
      lab.appendChild(doc.createTextNode(t("vote.hide_legacy_label", " Hide legacy proposals (always on — expired workers are excluded at fetch)")));
      lab.title = t("vote.hide_legacy_title", "Worker lists come from get_all_workers(false); expired rows never arrive.");
      wrap.appendChild(lab);
    })();
    var joinBox = el(doc, "div", null, "vote-join");
    wrap.appendChild(joinBox);
    fillBudget(doc, budgetLine, myGen);
    joinWBtn.addEventListener("click", function () { renderJoinWitness(doc, joinBox, root, st, myGen, false); });
    updWBtn.addEventListener("click", function () { renderJoinWitness(doc, joinBox, root, st, myGen, true); });
    joinCBtn.addEventListener("click", function () { renderJoinCommittee(doc, joinBox, root, st, myGen); });

    /* Governance analytics (bounded reads only — GovAnalytics): funding
     * shares, active/standby splits, top voters + proxy-vote matrix. Paints
     * best-effort below the join entries; every failure renders an honest
     * dash/unavailable line, never blank, never fatal. Plain literals only
     * (no new i18n keys — locale dicts outside this change's scope). */
    var analyticsBox = el(doc, "div", null, "vote-analytics");
    wrap.appendChild(analyticsBox);
    renderAnalytics(doc, analyticsBox, st, myGen);

    var proxyBox = el(doc, "div", null, "vote-proxy");
    wrap.appendChild(proxyBox);
    var tabsBar = el(doc, "div", null, "vote-tabs");
    tabsBar.setAttribute("role", "tablist");
    wrap.appendChild(tabsBar);
    var listBox = el(doc, "div", null, "vote-list");
    wrap.appendChild(listBox);
    var actionBar = el(doc, "div", null, "vote-actions");
    wrap.appendChild(actionBar);

    /* Repaint proxy line + tabs + list + actions for this generation (stale
     * generations bail — the router reuses #view across routes, so a late
     * proxy-slate fetch must not paint over the next page). */
    function refresh() {
      if (myGen !== gen) return;
      renderProxy(doc, proxyBox, root, st, myGen, refresh);
      VoteSlate.renderTabs(doc, tabsBar, st, refresh);
      VoteSlate.renderList(doc, listBox, st, refresh);
      renderActions(doc, actionBar, root, st, myGen);
    }

    /* When a proxy is set, fetch its slate once for the read-only note
     * (best-effort: failures render "proxy votes unavailable", never fatal;
     * empty slate renders the "proxy has no votes" empty state). */
    if (st.draft.proxyId !== PROXY_SENTINEL) {
      Vote.currentVotes(st.draft.proxyId).then(function (ps) {
        if (myGen !== gen) return;
        st.proxySlate = ps;
        refresh();
      }).catch(function () {
        if (myGen !== gen) return;
        st.proxySlate = { votes: [], byType: { committee: [], witness: [], worker: [] }, voting_account_name: "" };
        refresh();
      });
    }
    refresh();
  }

  /* Proxy picker: text input with keyboard-friendly search results (a real
   * list of buttons — no hover-only dropdown) + Set/Remove. Setting a proxy
   * disables the slate below; removing restores the sentinel. */
  function renderProxy(doc, box, root, st, myGen, refresh) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var hasProxy = st.draft.proxyId !== PROXY_SENTINEL;
    var line = el(doc, "p", null, hasProxy ? "" : "muted");
    line.textContent = hasProxy
      ? t("vote.proxy_prefix", "Proxy: ") + (st.proxyName || st.draft.proxyId) + t("vote.proxy_follows", " — your stake follows this account; the slate below is read-only.")
      : t("vote.proxy_none", "Proxy: none — voting directly.");
    box.appendChild(line);
    /* LOW punchlist: proxy help "?" link to /help/voting (AccountVoting
     * concept). Batch-3 i18n: keyed, no new route. */
    (function proxyHelp() {
      var p = el(doc, "p", null, "muted");
      var q = doc.createElement("a");
      q.href = "#/help/voting";
      q.textContent = t("vote.what_is_a_proxy", "? What is a proxy?");
      q.title = t("vote.proxies_follow_another_account_s_slate_re", "Proxies follow another account's slate — read how voting works before setting one.");
      q.className = "subtle-btn";
      p.appendChild(q);
      box.appendChild(p);
    })();
    if (hasProxy && st.proxySlate) {
      var n = (st.proxySlate.votes || []).length;
      box.appendChild(el(doc, "p", n === 0
        ? t("vote.proxy_empty", "This proxy has no votes set.")
        : t("vote.proxy_votes_prefix", "This proxy votes ") + n + t("vote.proxy_votes_suffix", " item(s)."), "muted"));
    }
    var row = el(doc, "div", null, "vote-proxy-row");
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "8px";
    var input = doc.createElement("input");
    input.type = "text";
    input.setAttribute("placeholder", t("vote.proxy_ph", "proxy account name or 1.2.N"));
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-label", t("vote.proxy_aria", "Proxy account"));
    touchable(input);
    input.style.flex = "1 1 200px";
    row.appendChild(input);
    var setBtn = touchable(el(doc, "button", t("vote.set_proxy", "Set proxy")));
    setBtn.type = "button";
    row.appendChild(setBtn);
    var rmBtn = touchable(el(doc, "button", t("vote.remove_proxy", "Remove proxy")));
    rmBtn.type = "button";
    rmBtn.className = "btn-ghost";
    rmBtn.disabled = !hasProxy;
    row.appendChild(rmBtn);
    box.appendChild(row);
    var hits = el(doc, "div", null, "vote-proxy-hits");
    hits.style.display = "flex";
    hits.style.flexWrap = "wrap";
    hits.style.gap = "8px";
    box.appendChild(hits);
    var msg = el(doc, "div", "", "error");
    msg.setAttribute("aria-live", "polite");
    box.appendChild(msg);

    /* Live search: resolve the typed value; a hit renders as a button that
     * fills the input (keyboard- and touch-friendly, never hover-only). */
    var timer = null;
    input.addEventListener("input", function () {
      msg.textContent = "";
      while (hits.firstChild) hits.removeChild(hits.firstChild);
      var v = input.value.trim();
      if (!v) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        Account.resolve(v).then(function (acct) {
          if (myGen !== gen) return;
          if (input.value.trim() !== v) return;
          while (hits.firstChild) hits.removeChild(hits.firstChild);
          var pick = touchable(el(doc, "button", acct.name + " (" + acct.id + ")"));
          pick.type = "button";
          pick.className = "subtle-btn";
          pick.addEventListener("click", function () {
            input.value = acct.name;
            while (hits.firstChild) hits.removeChild(hits.firstChild);
          });
          hits.appendChild(pick);
        }).catch(function () { /* no hit yet — silent until Set is pressed */ });
      }, 300);
    });

    setBtn.addEventListener("click", function () {
      var v = input.value.trim();
      if (!v) { msg.textContent = t("vote.proxy_needed", "Enter a proxy account name or id."); return; }
      setBtn.disabled = true;
      Account.resolve(v).then(function (acct) {
        st.draft.proxyId = acct.id;
        st.proxyName = acct.name;
        st.proxySlate = null;
        Vote.currentVotes(acct.id).then(function (ps) {
          if (myGen === gen) { st.proxySlate = ps; refresh(); }
        }).catch(function () {
          if (myGen === gen) {
            st.proxySlate = { votes: [], byType: { committee: [], witness: [], worker: [] }, voting_account_name: "" };
            refresh();
          }
        });
        refresh();
      }).catch(function () {
        setBtn.disabled = false;
        msg.textContent = t("vote.unknown_account", "Unknown account.");
      });
    });

    rmBtn.addEventListener("click", function () {
      st.draft.proxyId = PROXY_SENTINEL;
      st.proxyName = "";
      st.proxySlate = null;
      refresh();
    });
  }

  /* Publish + Reset bar: Publish disabled unless VoteSlate.isChanged (the
   * slate matches the chain — no changes to publish); Reset re-renders the
   * route, dropping the draft. Publish opens the named-row confirm.
   * Params: doc, bar (emptied first), root (route root), st (slate state),
   *   myGen (generation guard). Returns nothing. */
  function renderActions(doc, bar, root, st, myGen) {
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    var changed = VoteSlate.isChanged(st);
    var pub = touchable(el(doc, "button", t("vote.publish", "Publish votes")));
    pub.type = "button";
    pub.disabled = !changed;
    var reset = touchable(el(doc, "button", t("vote.reset", "Reset")));
    reset.type = "button";
    reset.className = "btn-ghost";
    reset.disabled = !changed;
    bar.appendChild(pub);
    bar.appendChild(reset);
    if (!changed) {
      bar.appendChild(el(doc, "p", t("vote.in_sync", "Slate matches the chain — no changes to publish."), "muted"));
    }
    reset.addEventListener("click", function () {
      st.draft.proxyId = st.published.proxyId;
      st.draft.witness = {};
      Object.keys(st.published.witness).forEach(function (v) { st.draft.witness[v] = true; });
      st.draft.committee = {};
      Object.keys(st.published.committee).forEach(function (v) { st.draft.committee[v] = true; });
      st.draft.worker = {};
      Object.keys(st.published.worker).forEach(function (v) { st.draft.worker[v] = true; });
      st.proxyName = "";
      st.proxySlate = null;
      renderVoting(root);
    });
    pub.addEventListener("click", function () {
      preparePublish(doc, root, st, myGen);
    });
  }

  /* Build new_options from the draft slate + live fee, then confirm.
   * memo_key is re-read from the account (unchanged); votes combine all
   * three tabs; counts cover witnesses/committee only. */
  async function preparePublish(doc, root, st, myGen) {
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("vote.confirm_title", "Confirm votes")));
    var status = showStatus(doc, wrap, t("vote.estimating_fee", "Estimating fee…"));
    try {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_accounts", [[st.me.id]]);
      if (myGen !== gen) return;
      if (!rows || !rows[0] || !rows[0].options) throw new Error("unknown-account");
      var memoKey = rows[0].options.memo_key;
      if (!memoKey) throw new Error(t("vote.no_memo", "Account has no memo key."));
      var witness = Object.keys(st.draft.witness).sort();
      var committee = Object.keys(st.draft.committee).sort();
      var worker = Object.keys(st.draft.worker).sort();
      var newOptions = {
        memo_key: memoKey,
        voting_account: st.draft.proxyId || PROXY_SENTINEL,
        num_witness: witness.length,
        num_committee: committee.length,
        votes: witness.concat(committee, worker)
      };
      var feeRaw = await Vote.fee(st.me.id, newOptions, CORE_ASSET);
      if (myGen !== gen) return;
      var feePrec = await feePrecision(dbId, CORE_ASSET);
      if (myGen !== gen) return;
      var network = "mainnet";
      try {
        if (typeof Store !== "undefined" && Store.loadSettings) {
          network = Store.loadSettings().network || network;
        }
      } catch (e) { /* default stands */ }
      clearRoot(root);
      showConfirm(doc, makeWrap(doc, root), root, st, myGen,
        newOptions, String(feeRaw), feePrec, network);
    } catch (e) {
      if (myGen !== gen) return;
      clearRoot(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(el(doc, "h1", t("vote.confirm_title", "Confirm votes")));
      showError(doc, failed, e, t("vote.prepare_failed", "Could not prepare the vote."));
      var back = touchable(el(doc, "button", t("vote.back_to_voting", "Back to voting")));
      back.type = "button";
      back.addEventListener("click", function () { renderVoting(root); });
      failed.appendChild(back);
    }
  }

  /* Fee-asset precision for the human fee line (one get_assets read;
   * falls back to core p5 — display-only, the raw fee is untouched). */
  async function feePrecision(dbId, assetId) {
    try {
      var rows = await Chain.call(dbId, "get_assets", [[assetId]]);
      if (rows && rows[0] && typeof rows[0].precision === "number") return rows[0].precision;
    } catch (e) { /* fallback stands */ }
    return CORE_PRECISION_FALLBACK;
  }

  /* Confirm screen: NAMED rows only — proxy, added/removed names per tab,
   * final counts, human fee + network. No raw JSON anywhere.
   * SIGN GATE (gate-repair): Publish is the ONLY password gate on this
   * route — the Send handler below requires the unlocked WIF; reads and
   * slate preview stay public. */
  function showConfirm(doc, wrap, root, st, myGen, newOptions, feeRaw, feePrec, network) {
    var hasProxy = newOptions.voting_account !== PROXY_SENTINEL;
    wrap.appendChild(el(doc, "h1", t("vote.confirm_title", "Confirm votes")));
    var list = el(doc, "dl", null, "vote-confirm");
    function row(term, text, title) {
      var dt = el(doc, "dt", term);
      var dd = el(doc, "dd", text);
      if (title) dd.title = title;
      list.appendChild(dt);
      list.appendChild(dd);
    }
    row(t("vote.account_row", "Account"), st.me.name + " (" + st.me.id + ")");
    row(t("vote.proxy_row", "Proxy"), hasProxy
      ? (st.proxyName || st.draft.proxyId) + " (" + newOptions.voting_account + ")"
      : t("vote.directly", "none — voting directly"));
    ["witness", "committee", "worker"].forEach(function (tab) {
      var d = VoteSlate.diffNames(st, tab);
      var label = tab.charAt(0).toUpperCase() + tab.slice(1);
      var finalCount = Object.keys(st.draft[tab]).length;
      var text = t("vote.row_final", "final: ") + finalCount;
      if (d.added.length) text += " · + " + d.added.join(", ");
      if (d.removed.length) text += " · − " + d.removed.join(", ");
      if (!d.added.length && !d.removed.length) text += t("vote.row_unchanged", " (unchanged)");
      row(label + t("vote.conf_votes", " votes"), text);
    });
    var feeHuman;
    try {
      feeHuman = Format.formatAmount(feeRaw, feePrec);
    } catch (e) { feeHuman = feeRaw; }
    row(t("vote.fee_row", "Fee"), feeHuman + t("vote.fee_core", " (core)"), feeRaw);
    row(t("vote.network_row", "Network"), network);
    wrap.appendChild(list);
    /* Sign-time notice while locked: lists above stay browsable, only
     * Sign & Publish needs the password. */
    try {
      if (typeof Wallet === "undefined" || typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked())
        wrap.appendChild(el(doc, "p", t("vote.locked_sign_note", "Wallet is locked — browsing is public; unlock to sign."), "muted"));
    } catch (e) { /* notice is display-only */ }

    var backBtn = touchable(el(doc, "button", t("vote.back", "Back")));
    backBtn.type = "button";
    backBtn.className = "btn-ghost";
    wrap.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", t("vote.sign_publish", "Sign & Publish")));
    sendBtn.type = "button";
    wrap.appendChild(sendBtn);

    backBtn.addEventListener("click", function () { renderVoting(root); });
    /* TxBuilder outlet (additive): queue the [6, opData] without
     * broadcasting. One-shot Sign & Publish above is untouched — the opData
     * shape mirrors buildSigned (raw fee string, CORE_ASSET, new_options)
     * and passes as JS values only. */
    try {
      if (typeof TxBuilder !== "undefined" && TxBuilder && typeof TxBuilder.addOp === "function") {
        var tbVote = touchable(el(doc, "button", t("txbuilder.add_vote", "Add vote to TxBuilder")));
        tbVote.type = "button";
        tbVote.addEventListener("click", function () {
          var tbWho = ((st && st.me && (st.me.name || st.me.id)) || "?");
          var tbSrc = "vote:" + tbWho + " slate";
          TxBuilder.addOp(6, { fee: { amount: feeRaw, asset_id: CORE_ASSET }, account: st.me.id, new_options: newOptions }, tbSrc);
          try {
            if (typeof Notify !== "undefined" && Notify && typeof Notify.push === "function") {
              Notify.push("info", t("txbuilder.added_title", "Added to TxBuilder"), t("txbuilder.added_body_tpl", "%(src)s (op %(op)s) — %(n)s in queue", { src: tbSrc, op: 6, n: TxBuilder.count() }), {});
            }
          } catch (e2) { /* toast optional; the desk badge is the record */ }
          location.hash = "#/txbuilder";
        });
        wrap.appendChild(tbVote);
      }
    } catch (e) { /* outlet never breaks the one-shot path */ }
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, wrap, t("vote.signing", "Signing…"));
      var activeWIF = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!activeWIF) {
        wrap.removeChild(status);
        showError(doc, wrap, new Error("wallet-locked"), t("vote.wallet_locked", "Wallet is locked."));
        backBtn.disabled = false;
        return;
      }
      publishWithRetry(st, newOptions, feeRaw, function (text) {
        status.textContent = text;
      }).then(function (res) {
        if (myGen !== gen) return;
        clearRoot(root);
        showResult(doc, makeWrap(doc, root), root, st, null, res);
      }).catch(function (e) {
        if (myGen !== gen) return;
        wrap.removeChild(status);
        showError(doc, wrap, (e && e.message) ? e.message : String(e || t("vote.publish_fallback", "Publish failed")), t("vote.publish_failed", "Vote publish failed."));
        backBtn.disabled = false;
      });
    });
  }

  /* Publish with the proxy-vs-self retry rule: default voting_account is
   * the 1.2.5 sentinel; if the node rejects the SEND, rebuild once with the
   * voter's own id and resend. Retry happens ONLY on send-rejection (the
   * node never saw a valid tx); once a send is accepted, inclusion is
   * proven by re-reading the slate — never by rebroadcasting. Returns
   * {blockNum, via, retried} where blockNum is the observed head block
   * (observation marker, same convention as transfer-ui result). */
  async function publishWithRetry(st, newOptions, feeRaw, onStep) {
    var attempt = await buildSigned(st.me.id, newOptions, feeRaw);
    try {
      onStep(t("vote.broadcasting", "Broadcasting…"));
      var proof = await sendAndProve(st, attempt, newOptions);
      return { blockNum: proof.head, via: proof.via, retried: false };
    } catch (e) {
      var sendRejected = e && e.sendRejected === true;
      var isSentinel = (newOptions.voting_account || PROXY_SENTINEL) === PROXY_SENTINEL;
      if (!sendRejected || !isSentinel) throw e;
      onStep(t("vote.retry_self", "Node rejected the 1.2.5 proxy mode — retrying once as self…"));
      var selfOptions = {
        memo_key: newOptions.memo_key,
        voting_account: st.me.id,
        num_witness: newOptions.num_witness,
        num_committee: newOptions.num_committee,
        votes: newOptions.votes
      };
      var retry = await buildSigned(st.me.id, selfOptions, feeRaw);
      var proof2 = await sendAndProve(st, retry, selfOptions);
      return { blockNum: proof2.head, via: proof2.via, retried: true };
    }
  }

  /* Fill the fee, build the op-6 envelope. Fee asset is 1.3.0 (core);
   * amount stays a raw-int string throughout. Signing happens in
   * sendAndProve (fresh WIF read there) so the retry path re-signs the
   * rebuilt envelope rather than reusing bytes. */
  async function buildSigned(accountId, newOptions, feeRaw) {
    var opData = {
      fee: { amount: feeRaw, asset_id: CORE_ASSET },
      account: accountId,
      new_options: newOptions
    };
    return Tx.buildTx([[6, opData]]);
  }

  /* Send a signed op-6 tx (callback wire shape + plain fallback, same as
   * tx.js broadcast), then prove by re-reading the on-chain slate until it
   * matches the intended votes + proxy. Send-rejections throw with
   * sendRejected=true so the caller can apply the retry rule. */
  async function sendAndProve(st, signed, intendedOptions) {
    var signWIF = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
    if (typeof Tx !== "undefined" && Tx && typeof Tx.wifOk === "function" ? !Tx.wifOk(signWIF) : !signWIF) {
      throw new Error("wallet-locked");
    }
    var routed = await Tx.signRouted(signed, signWIF, {});
    var txSigned = routed.signed;
    var via;
    if (routed.delegated) {
      /* Extension mode: the SW signed + broadcast behind approval. */
      via = ((routed.proof && routed.proof.via) ? routed.proof.via : "extension") + "+extension";
    } else {
    var netId = await Chain.net();
    var callbackId = (Math.random() * 4294967296) >>> 0;
    via = "broadcast_transaction_with_callback";
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, txSigned]);
    } catch (e) {
      /* Callback method missing or send rejected: one plain-broadcast
       * attempt. A rejected tx never applies, so this is not a double-send;
       * both rejections surface as sendRejected for the retry rule. */
      via = "broadcast_transaction";
      try {
        await Chain.call(netId, "broadcast_transaction", [txSigned]);
      } catch (e2) {
        e2.sendRejected = true;
        throw e2;
      }
    }
    }
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      var cur = null;
      try { cur = await Vote.currentVotes(st.me.id); } catch (e2) { cur = null; }
      if (cur && slateMatches(cur, intendedOptions)) {
        return { head: await headBlock(), via: via + "+slate-read" };
      }
      await sleep(PROVE_INTERVAL_MS);
    }
    throw new Error(t("vote.sent_prefix", "Sent (") + via + t("vote.sent_middle", ") but the new slate was not observed within ") +
      (PROVE_TIMEOUT_MS / 1000) + t("vote.sent_suffix", "s; check #/voting before retrying ") +
      t("vote.sent_note", "(do NOT blindly rebroadcast)."));
  }

  /* Intended-vs-on-chain slate comparison (sorted vote arrays + proxy). */
  function slateMatches(cur, intended) {
    var want = (intended.votes || []).slice().sort();
    var got = (cur.votes || []).slice().sort();
    if (want.length !== got.length) return false;
    for (var i = 0; i < want.length; i++) if (want[i] !== got[i]) return false;
    return (cur.voting_account || PROXY_SENTINEL) === (intended.voting_account || PROXY_SENTINEL);
  }

  /* Head block number for result screens (observation marker, not a txid —
   * history rows carry none, same convention as transfer-ui.js). */
  async function headBlock() {
    var dbId = await Chain.db();
    var props = await Chain.call(dbId, "get_dynamic_global_properties", []);
    return (props && props.head_block_number) || 0;
  }

  /* Result screen: observed head block # or the node error inline — never
   * blank, never a fabricated txid. Reports which proxy mode the chain
   * accepted (the retry-rule outcome Task 4 records). */
  function showResult(doc, wrap, root, st, errText, res) {
    wrap.appendChild(el(doc, "h1", errText ? t("vote.result_failed", "Vote failed") : t("vote.result_ok", "Votes published")));
    if (errText) {
      showError(doc, wrap, errText, t("vote.publish_failed", "Vote publish failed."));
    } else {
      var ok = el(doc, "p", t("vote.observed_prefix", "Observed at head block #") + String(res.blockNum) +
        " (" + res.via + ").", "xfer-ok");
      ok.setAttribute("aria-live", "polite");
      wrap.appendChild(ok);
      wrap.appendChild(el(doc, "p",
        res.retried
          ? t("vote.retried_prefix", "The node rejected proxy mode 1.2.5, so the vote was published as self (voting_account ") + st.me.id + ")."
          : t("vote.direct_note", "Published voting directly (voting_account 1.2.5)."), "muted"));
    }
    var back = touchable(el(doc, "a", t("vote.back_to_voting", "Back to voting")));
    back.setAttribute("href", "#/voting");
    back.className = "subtle-btn";
    wrap.appendChild(back);
  }

  /* Worker-budget line (best-effort read-only): the per-day cap off 2.0.0
   * parameters, formatted at core p5; total stays a dash (budget-record id
   * not cleanly derivable — deferred, see header). Never fatal: a missing
   * Chain global or a failed read renders dashes, never a throw.
   * Params: doc, line (mutated in place), myGen (generation guard). */
  function fillBudget(doc, line, myGen) {
    if (typeof Chain === "undefined" || !Chain || typeof Chain.db !== "function") {
      line.textContent = t("vote.worker_budget", "Worker budget: —");
      return;
    }
    Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_objects", [["2.0.0"]]);
    }).then(function (rows) {
      if (myGen !== gen) return;
      var params = rows && rows[0] && rows[0].parameters;
      var raw = params ? params.worker_budget_per_day : null;
      var human = null;
      if (raw !== undefined && raw !== null && /^\d+$/.test(String(raw))) {
        try { human = Format.formatAmount(String(raw), CORE_PRECISION_FALLBACK); } catch (e) { human = null; }
      }
      line.textContent = human
        ? "Worker budget: " + human + " (core)/day · Total: —"
        : "Worker budget: —";
    }).catch(function () {
      if (myGen !== gen) return;
      line.textContent = t("vote.worker_budget", "Worker budget: —");
    });
  }

  /* Governance analytics section (GovAnalytics joins — all bounded, see that
   * file's header for the #4 citations). Renders, in order: active/standby
   * splits (from the already-loaded lists snapshot — zero new RPCs), worker
   * funding shares (live workers + 2.0.0 per-day cap), top voters by vp_active
   * (one get_top_voters, N=10), and the proxy-vote matrix (top-10 voters x
   * top-10 witnesses + top-10 committee, one batched get_accounts). Voting
   * power (vp_active) is a unitless uint64 — rendered as a plain integer with
   * thousands commas, NEVER via Format.formatAmount (that would mislabel it
   * as core money). Worker pay IS core money (Format p5) and funding % is
   * GovAnalytics.fundingShare (exact BigInt). Every sub-panel fails open with
   * an honest line. Plain literals only (no new i18n keys). Params: doc, box
   * (emptied by nobody — appended once), st (lists snapshot), myGen. */
  function renderAnalytics(doc, box, st, myGen) {
    if (typeof GovAnalytics === "undefined" || !GovAnalytics) return;
    box.appendChild(el(doc, "h2", "Governance analytics"));
    /* Splits: zero new RPCs (st.lists already carries the active flags). */
    try {
      var w = GovAnalytics.splitCounts(st.lists.witnesses);
      var c = GovAnalytics.splitCounts(st.lists.committee);
      box.appendChild(el(doc, "p",
        "Active splits — witnesses: " + w.active + " active / " + w.standby +
        " standby (" + w.total + " total) · committee: " + c.active +
        " active / " + c.standby + " standby (" + c.total + " total).", "muted"));
    } catch (e) { box.appendChild(el(doc, "p", "Active splits unavailable.", "muted")); }
    /* Worker funding shares (best-effort live join). */
    var fundP = el(doc, "p", "Worker funding: loading…", "muted");
    box.appendChild(fundP);
    GovAnalytics.workerFunding().then(function (fr) {
      if (myGen !== gen) return;
      while (fundP.firstChild) fundP.removeChild(fundP.firstChild);
      var rows = GovAnalytics.fundingRows(fr.workers).slice(0, 10);
      var head = "Worker funding (pay/day share of " +
        (fr.budgetRaw ? fundHuman(fr.budgetRaw) + " (core)/day" : "unknown budget") + "):";
      fundP.textContent = head;
      if (rows.length === 0) {
        box.appendChild(el(doc, "p", "No live workers on chain — valid, not an error.", "muted"));
        return;
      }
      var table = doc.createElement("table");
      table.className = "node-table";
      var thead = doc.createElement("thead");
      var hr = doc.createElement("tr");
      ["Worker", "Pay/day", "Share"].forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = doc.createElement("tbody");
      rows.forEach(function (r) {
        var tr = doc.createElement("tr");
        tr.appendChild(el(doc, "td", (r.name || r.id) + " (" + r.id + ")"));
        var payHuman;
        try {
          payHuman = Format.formatAmount(String((r.extra || {}).daily_pay_raw || "0"), CORE_PRECISION_FALLBACK);
        } catch (e2) { payHuman = String((r.extra || {}).daily_pay_raw || "0"); }
        tr.appendChild(el(doc, "td", payHuman));
        tr.appendChild(el(doc, "td", GovAnalytics.fundingShare((r.extra || {}).daily_pay_raw, fr.budgetRaw)));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      /* Insert the table right after the heading line. */
      if (fundP.nextSibling) box.insertBefore(table, fundP.nextSibling);
      else box.appendChild(table);
      var totalHuman;
      try { totalHuman = Format.formatAmount(fr.totalPayRaw, CORE_PRECISION_FALLBACK); }
      catch (e3) { totalHuman = fr.totalPayRaw; }
      var totLine = el(doc, "p",
        "Total requested: " + totalHuman + " (core)/day" +
        (fr.budgetRaw ? " (" + GovAnalytics.fundingShare(fr.totalPayRaw, fr.budgetRaw) + " of budget)" : "") +
        " — top 10 shown.", "muted");
      if (table.nextSibling) box.insertBefore(totLine, table.nextSibling);
      else box.appendChild(totLine);
    }).catch(function (e) {
      if (myGen !== gen) return;
      fundP.textContent = t("vote.funding_unavailable_prefix", "Worker funding unavailable (") +
        ((e && e.message) || "read failed") + ").";
    });
    /* Top voters + proxy-vote matrix (best-effort bounded join). */
    var topP = el(doc, "p", "Top voters: loading…", "muted");
    box.appendChild(topP);
    GovAnalytics.proxyMatrix(10, 10, 10).then(function (mx) {
      if (myGen !== gen) return;
      topP.textContent = t("vote.top_voters_note", "Top 10 voters by voting power (get_top_voters — sample, not a full proxy census):");
      if (mx.voters.length === 0) {
        box.appendChild(el(doc, "p", "No top voters returned.", "muted"));
        return;
      }
      var vt = doc.createElement("table");
      vt.className = "node-table";
      var vh = doc.createElement("thead");
      var vr = doc.createElement("tr");
      ["Voter", "Voting power", "Proxy"].forEach(function (h) { vr.appendChild(el(doc, "th", h)); });
      vh.appendChild(vr);
      vt.appendChild(vh);
      var vb = doc.createElement("tbody");
      mx.voters.forEach(function (v) {
        var tr = doc.createElement("tr");
        tr.appendChild(el(doc, "td", v.name + " (" + v.id + ")"));
        tr.appendChild(el(doc, "td", commas(v.vpRaw)));
        tr.appendChild(el(doc, "td", v.proxy && v.proxy !== PROXY_SENTINEL ? v.proxy : "—"));
        vb.appendChild(tr);
      });
      vt.appendChild(vb);
      box.appendChild(vt);
      /* Matrix: rows = voters, columns = top candidates (W = witness votes,
       * C = committee votes). "✓" = the voter's on-chain slate contains that
       * vote id; "·" = absent. Read-only, keyboard-scrollable region. */
      box.appendChild(el(doc, "p",
        "Proxy-vote matrix (rows: top-10 voters; columns: top-10 witnesses + top-10 committee by weight) — ✓ means the voter's slate carries that vote.", "muted"));
      var scroller = doc.createElement("div");
      scroller.style.overflowX = "auto";
      var mt = doc.createElement("table");
      mt.className = "node-table";
      var mh = doc.createElement("thead");
      var mhr = doc.createElement("tr");
      mhr.appendChild(el(doc, "th", "Voter \\ candidate"));
      var cands = mx.candidates.witness.concat(mx.candidates.committee);
      cands.forEach(function (cid, i) {
        var kind = i < mx.candidates.witness.length ? "W" : "C";
        mhr.appendChild(el(doc, "th", kind + ":" + cid));
      });
      mh.appendChild(mhr);
      mt.appendChild(mh);
      var mb = doc.createElement("tbody");
      mx.matrix.forEach(function (row) {
        var tr = doc.createElement("tr");
        var who = null;
        for (var k = 0; k < mx.voters.length; k++) {
          if (mx.voters[k].id === row.voter) { who = mx.voters[k]; break; }
        }
        tr.appendChild(el(doc, "td", (who ? who.name : row.voter)));
        cands.forEach(function (cid) {
          tr.appendChild(el(doc, "td", row.cells[cid] ? "✓" : "·"));
        });
        mb.appendChild(tr);
      });
      mt.appendChild(mb);
      scroller.appendChild(mt);
      box.appendChild(scroller);
    }).catch(function (e) {
      if (myGen !== gen) return;
      var m = (e && e.message) || "";
      topP.textContent = m === "unavailable"
        ? "Top voters unavailable on this node (no get_top_voters) — switch nodes in Settings to see them."
        : "Top voters unavailable (" + (m || "read failed") + ").";
    });
  }

  /* Thousands commas on a digit string (display only — vp/power counts, never
   * money; money still formats via Format before reaching here). */
  function commas(digits) {
    return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* Core-money human for the funding heading (Format p5; raw fallback). */
  function fundHuman(raw) {
    try { return Format.formatAmount(String(raw), CORE_PRECISION_FALLBACK); }
    catch (e) { return String(raw); }
  }

  /* Join/Update-witness entry form (reference Witnesses.jsx:57-66 +
   * JoinWitnessesModal field set: account, url, block signing key).
   * Reads stay public; the fee is a live chain estimate; the password gate
   * lives ONLY at Sign (showJoinConfirm below). Update mode offers a
   * "Load current" prefill via Vote.getWitnessByAccount; a missing object
   * points at Join instead of failing silently.
   * Params: doc, box (emptied first), root (route root for Back), st
   *   (needs me), myGen (generation guard), isUpdate bool. */
  function renderJoinWitness(doc, box, root, st, myGen, isUpdate) {
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el(doc, "h2", isUpdate ? t("vote.update_witness", "Update witness") : t("vote.join_as_witness", "Join as witness")));
    var acctF = Forms.labeledInput(doc, t("vote.account_row", "Account") + " ", { value: st.me.name, placeholder: t("vote.name_or_1_2_n", "name or 1.2.N"), autocomplete: "off" });
    box.appendChild(acctF.row);
    var urlF = Forms.labeledInput(doc, t("vote.url", "URL") + " ", { value: "", placeholder: "https://example.com", autocomplete: "off" });
    box.appendChild(urlF.row);
    var keyF = Forms.labeledInput(doc, t("vote.block_signing_key", "Block signing key") + " ", { value: "", placeholder: "BTS…", autocomplete: "off" });
    box.appendChild(keyF.row);
    var acctIn = acctF.input, urlIn = urlF.input, keyIn = keyF.input;
    var msg = el(doc, "div", "", "error");
    msg.setAttribute("aria-live", "polite");
    box.appendChild(msg);
    if (isUpdate) {
      var reload = touchable(el(doc, "button", t("vote.load_current", "Load current")));
      reload.type = "button";
      box.appendChild(reload);
      reload.addEventListener("click", function () {
        msg.textContent = "";
        reload.disabled = true;
        Account.resolve(acctIn.value.trim() || st.me.id).then(function (acct) {
          return Vote.getWitnessByAccount(acct.id);
        }).then(function (w) {
          reload.disabled = false;
          if (myGen !== gen) return;
          if (!w) { msg.textContent = t("vote.no_witness_object_for_this_account_use_join_a", "No witness object for this account — use Join as witness instead."); return; }
          urlIn.value = w.url || "";
          keyIn.value = w.signing_key || "";
        }).catch(function (e) {
          reload.disabled = false;
          msg.textContent = (e && e.message) ? e.message : t("vote.lookup_failed", "Lookup failed.");
        });
      });
    }
    var review = touchable(el(doc, "button", isUpdate ? t("vote.review_update", "Review update") : t("vote.review_join", "Review join")));
    review.type = "button";
    box.appendChild(review);
    review.addEventListener("click", function () {
      msg.textContent = "";
      /* Reference JoinWitnessesModal lowercases + sanitizes the url. */
      var url = urlIn.value.trim().toLowerCase();
      var signingKey = keyIn.value.trim();
      if (!url) { msg.textContent = t("vote.enter_a_url", "Enter a URL."); return; }
      if (!signingKey || signingKey.length < 20) { msg.textContent = t("vote.enter_the_block_signing_public_key", "Enter the block signing public key."); return; }
      review.disabled = true;
      var opId = isUpdate ? 21 : 20;
      Account.resolve(acctIn.value.trim() || st.me.id).then(function (acct) {
        var opData = isUpdate
          ? { fee: { amount: "0", asset_id: CORE_ASSET }, witness: "", witness_account: acct.id, new_url: url, new_signing_key: signingKey }
          : { fee: { amount: "0", asset_id: CORE_ASSET }, witness_account: acct.id, url: url, block_signing_key: signingKey };
        var shaped = isUpdate
          ? Vote.getWitnessByAccount(acct.id).then(function (w) {
              if (!w) throw new Error(t("vote.no_witness_object_for_this_account_use_join_a", "No witness object for this account — use Join as witness instead."));
              opData.witness = w.id;
              return { acct: acct, opData: opData };
            })
          : Promise.resolve({ acct: acct, opData: opData });
        return shaped;
      }).then(function (ctx) {
        /* Tx.fee is a pure chain get_required_fees call; the node also
         * validates the account/key shape here, so bad input fails
         * honestly at review (before anything is signed). */
        return Tx.fee(opId, ctx.opData, CORE_ASSET).then(function (fee) {
          ctx.opData.fee = { amount: String(fee.amount), asset_id: fee.asset_id || CORE_ASSET };
          return { acct: ctx.acct, opData: ctx.opData, feeRaw: String(fee.amount) };
        });
      }).then(function (ctx) {
        review.disabled = false;
        if (myGen !== gen) return;
        showJoinConfirm(doc, box, root, st, myGen, {
          kind: "witness", opId: opId, isUpdate: isUpdate,
          account: ctx.acct, opData: ctx.opData, feeRaw: ctx.feeRaw
        });
      }).catch(function (e) {
        review.disabled = false;
        msg.textContent = (e && e.message) ? e.message : t("vote.could_not_prepare_the_join", "Could not prepare the join.");
      });
    });
  }

  /* Join-committee entry form (reference Committee.jsx:47 +
   * JoinCommitteeModal field set: account, url). No update mode exists in
   * the reference, so none is offered here. Same public-reads / live-fee /
   * sign-gate contract as renderJoinWitness. */
  function renderJoinCommittee(doc, box, root, st, myGen) {
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el(doc, "h2", t("vote.join_committee", "Join committee")));
    var acctF = Forms.labeledInput(doc, t("vote.account_row", "Account") + " ", { value: st.me.name, placeholder: t("vote.name_or_1_2_n", "name or 1.2.N"), autocomplete: "off" });
    box.appendChild(acctF.row);
    var urlF = Forms.labeledInput(doc, t("vote.url", "URL") + " ", { value: "", placeholder: "https://example.com", autocomplete: "off" });
    box.appendChild(urlF.row);
    var acctIn = acctF.input, urlIn = urlF.input;
    var msg = el(doc, "div", "", "error");
    msg.setAttribute("aria-live", "polite");
    box.appendChild(msg);
    var review = touchable(el(doc, "button", t("vote.review_join", "Review join")));
    review.type = "button";
    box.appendChild(review);
    review.addEventListener("click", function () {
      msg.textContent = "";
      var url = urlIn.value.trim().toLowerCase();
      if (!url) { msg.textContent = t("vote.enter_a_url", "Enter a URL."); return; }
      review.disabled = true;
      Account.resolve(acctIn.value.trim() || st.me.id).then(function (acct) {
        var opData = { fee: { amount: "0", asset_id: CORE_ASSET }, committee_member_account: acct.id, url: url };
        return Tx.fee(29, opData, CORE_ASSET).then(function (fee) {
          opData.fee = { amount: String(fee.amount), asset_id: fee.asset_id || CORE_ASSET };
          return { acct: acct, opData: opData, feeRaw: String(fee.amount) };
        });
      }).then(function (ctx) {
        review.disabled = false;
        if (myGen !== gen) return;
        showJoinConfirm(doc, box, root, st, myGen, {
          kind: "committee", opId: 29, isUpdate: false,
          account: ctx.acct, opData: ctx.opData, feeRaw: ctx.feeRaw
        });
      }).catch(function (e) {
        review.disabled = false;
        msg.textContent = (e && e.message) ? e.message : t("vote.could_not_prepare_the_join", "Could not prepare the join.");
      });
    });
  }

  /* Named-row confirm for a join op (same idiom as showConfirm: dl rows,
   * human fee, locked-sign note; password gate ONLY at Send).
   * Params: doc, box (emptied first), root, st (form re-render on Back),
   *   myGen, spec {kind, opId, isUpdate, account {id,name}, opData, feeRaw}. */
  function showJoinConfirm(doc, box, root, st, myGen, spec) {
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el(doc, "h2", spec.isUpdate ? t("vote.confirm_witness_update_op_21", "Confirm witness update (op 21)")
      : (spec.kind === "witness" ? "Confirm witness join (op 20)" : "Confirm committee join (op 29)")));
    var list = el(doc, "dl", null, "vote-confirm");
    function row(term, text, title) {
      var dt = el(doc, "dt", term);
      var dd = el(doc, "dd", text);
      if (title) dd.title = title;
      list.appendChild(dt);
      list.appendChild(dd);
    }
    row(t("vote.account_row", "Account"), spec.account.name + " (" + spec.account.id + ")");
    row(t("vote.role", "Role"), spec.kind === "witness" ? t("vote.witness", "Witness") : t("vote.committee_member", "Committee member"));
    row(t("vote.url", "URL"), spec.kind === "witness"
      ? (spec.isUpdate ? spec.opData.new_url : spec.opData.url)
      : spec.opData.url);
    if (spec.kind === "witness") {
      var k = spec.isUpdate ? spec.opData.new_signing_key : spec.opData.block_signing_key;
      row(t("vote.signing_key", "Signing key"), k.length > 18 ? k.slice(0, 12) + "…" + k.slice(-6) : k, k);
    }
    var feeHuman;
    try {
      feeHuman = Format.formatAmount(spec.feeRaw, CORE_PRECISION_FALLBACK);
    } catch (e) { feeHuman = spec.feeRaw; }
    row(t("vote.fee_row", "Fee"), feeHuman + t("vote.fee_core", " (core)"), spec.feeRaw);
    var network = "mainnet";
    try {
      if (typeof Store !== "undefined" && Store.loadSettings) {
        network = Store.loadSettings().network || network;
      }
    } catch (e) { /* default stands */ }
    row(t("vote.network_row", "Network"), network);
    box.appendChild(list);
    try {
      if (typeof Wallet === "undefined" || typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked())
        box.appendChild(el(doc, "p", t("vote.locked_sign_note", "Wallet is locked — browsing is public; unlock to sign."), "muted"));
    } catch (e) { /* notice is display-only */ }

    var backBtn = touchable(el(doc, "button", t("vote.back", "Back")));
    backBtn.type = "button";
    backBtn.className = "btn-ghost";
    box.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", spec.isUpdate ? t("vote.sign_update", "Sign & Update") : t("vote.sign_join", "Sign & Join")));
    sendBtn.type = "button";
    box.appendChild(sendBtn);

    backBtn.addEventListener("click", function () {
      if (spec.kind === "witness") renderJoinWitness(doc, box, root, st, myGen, spec.isUpdate);
      else renderJoinCommittee(doc, box, root, st, myGen);
    });
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, box, t("vote.signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) {
        box.removeChild(status);
        showError(doc, box, new Error("wallet-locked"), t("vote.wallet_locked", "Wallet is locked."));
        backBtn.disabled = false;
        return;
      }
      sendJoinAndProve(spec, wif, function (text) {
        status.textContent = text;
      }).then(function (res) {
        if (myGen !== gen) return;
        while (box.firstChild) box.removeChild(box.firstChild);
        showJoinResult(doc, box, spec, null, res);
      }).catch(function (e) {
        if (myGen !== gen) return;
        box.removeChild(status);
        showError(doc, box, (e && e.message) ? e.message : String(e || t("vote.join_failed_2", "Join failed")), t("vote.join_failed", "Join failed."));
        backBtn.disabled = false;
      });
    });
  }

  /* Join broadcast (vote-publish wiring, other op): envelope via Tx.buildTx,
   * sign with the FRESH wif (never stored), callback/plain fallback, then
   * prove by re-reading the affected object (create: object exists; update:
   * url matches). Node rejections (e.g. the LTM-membership assert on ops
   * 20/29 for basic accounts) surface inline with the node's own message.
   * Returns {blockNum, via, obj} where blockNum is the observed head block. */
  async function sendJoinAndProve(spec, wif, onStep) {
    if (typeof Tx !== "undefined" && Tx && typeof Tx.wifOk === "function" ? !Tx.wifOk(wif) : !wif) {
      throw new Error("wallet-locked");
    }
    var unsigned = await Tx.buildTx([[spec.opId, spec.opData]]);
    var routed = await Tx.signRouted(unsigned, wif, {});
    var txSigned = routed.signed;
    onStep(t("vote.broadcasting", "Broadcasting…"));
    var via;
    if (routed.delegated) {
      /* Extension mode: the SW signed + broadcast behind approval. */
      via = ((routed.proof && routed.proof.via) ? routed.proof.via : "extension") + "+extension";
    } else {
    var netId = await Chain.net();
    var callbackId = (Math.random() * 4294967296) >>> 0;
    via = "broadcast_transaction_with_callback";
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, txSigned]);
    } catch (e) {
      via = "broadcast_transaction";
      await Chain.call(netId, "broadcast_transaction", [txSigned]);
    }
    }
    var wantUrl = spec.kind === "witness"
      ? (spec.isUpdate ? spec.opData.new_url : spec.opData.url)
      : spec.opData.url;
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      var cur = null;
      try {
        cur = spec.kind === "witness"
          ? await Vote.getWitnessByAccount(spec.account.id)
          : await Vote.getCommitteeMemberByAccount(spec.account.id);
      } catch (e2) { cur = null; }
      if (cur && cur.id && (spec.isUpdate !== true || cur.url === wantUrl)) {
        return { head: await headBlock(), via: via + "+object-read", obj: cur.id };
      }
      await sleep(PROVE_INTERVAL_MS);
    }
    throw new Error(t("vote.sent_prefix", "Sent (") + via + t("vote.but_the_new_object_was_not_observed_within", ") but the new object was not observed within ") +
      (PROVE_TIMEOUT_MS / 1000) + "s; check #/voting before retrying (do NOT blindly rebroadcast).");
  }

  /* Join result: observed head block + object id, or the node error inline
   * (e.g. the LTM-membership message for basic accounts on ops 20/29) —
   * never blank, never a fabricated txid.
   * Params: doc, box (emptied by the caller), spec, errText (null |
   *   message), res. */
  function showJoinResult(doc, box, spec, errText, res) {
    if (errText) {
      box.appendChild(el(doc, "h2", t("vote.join_failed_2", "Join failed")));
      showError(doc, box, errText, t("vote.join_failed", "Join failed."));
    } else {
      box.appendChild(el(doc, "h2", spec.isUpdate ? t("vote.witness_updated", "Witness updated") : t("vote.join_published", "Join published")));
      var ok = el(doc, "p", t("vote.observed_prefix", "Observed at head block #") + String(res.head) +
        " (" + res.via + "). Object " + res.obj + ".", "xfer-ok");
      ok.setAttribute("aria-live", "polite");
      box.appendChild(ok);
    }
    var back = touchable(el(doc, "a", t("vote.back_to_voting", "Back to voting")));
    back.setAttribute("href", "#/voting");
    back.className = "subtle-btn";
    box.appendChild(back);
  }

  return {
    renderVoting: renderVoting,
    /* Headless-test seam: slate math now lives in VoteSlate (slice-18
     * split) — these aliases keep the old VoteUI._test import path working;
     * slateMatches stays local (publish proof, never moved). */
    _test: {
      sharePct: VoteSlate.sharePct,
      humanWeight: VoteSlate.humanWeight,
      sameSet: VoteSlate.sameSet,
      isChanged: VoteSlate.isChanged,
      slateMatches: slateMatches
    }
  };
})();

if (typeof module !== "undefined") { module.exports = VoteUI; }
