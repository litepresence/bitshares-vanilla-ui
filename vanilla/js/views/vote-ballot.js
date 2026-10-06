/* vote-ballot.js — #/voting ballot core (route entry + proxy + publish).
 *
 * What it owns: the voting route entry (renderVoting + connect wait +
 * account resolve), the ballot view (account strip, proxy picker, slate tabs
 * via VoteSlate, publish/reset bar), the op-6 publish path (preparePublish,
 * feePrecision, showConfirm with NAMED rows, publishWithRetry with the
 * proxy-vs-self retry rule, buildSigned, sendAndProve) and the publish proof
 * helpers (slateMatches, headBlock, showResult). Governance side panels
 * (budget line, analytics, join-witness/committee entries) live in
 * vote-gov.js and are called via VoteUI._gov at call time.
 * Consumes: Vote (lists, currentVotes, fee), VoteUI._gov (panels, late-bound),
 *   VoteSlate (draft state + list rows), Account.resolve/myAccountId,
 *   Wallet.isUnlocked/unlock/keys, Tx.fee/buildTx/sign, Format.formatAmount,
 *   Chain.db/call/status, Store.subscribe, ViewingAs, Offline, DOM, Forms.
 * Globals/side effects: DOM under the router root; attaches VoteUI._ballot
 *   ({renderVoting, isLive, slateMatches}) on the shared VoteUI registry and
 *   republishes globalThis.VoteUI. WIFs pass as JS values into Tx.sign —
 *   never into the DOM. Generation counter (isLive) invalidates stale async
 *   work after teardown; vote-gov.js reads it via isLive (sole writer here).
 * Created by: task-res-split2 (vote-ui.js responsibility split — balloting
 *   half; bodies moved verbatim, only VoteUI._gov call sites rewritten).
 *   Facade: vote-ui.js (thin, identical surface). Load order in index.html:
 *   vote-slate.js, vote-gov.js, vote-ballot.js, vote-ui.js (facade last;
 *   gov/ballot bind at call time, so gov/ballot order is free).
 * Pre-split vote-ui.js header (CHAIN TRUTH, MONEY DISCIPLINE, PUNCHLIST
 *   2026-09-29): preserved verbatim in git history of vote-ui.js.
 */
var VoteUI = (typeof globalThis !== "undefined" && globalThis.VoteUI) ? globalThis.VoteUI : ((typeof VoteUI !== "undefined") ? VoteUI : {});
VoteUI._ballot = VoteUI._ballot || {};
(function () {
  "use strict";

  /* Generation liveness for both halves: true while myGen is the latest
   * renderVoting generation. vote-gov.js consults this instead of keeping
   * its own counter (it never writes — sole writer is renderVoting here). */
  function ballotLive(myGen) { return myGen === gen; }

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
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) msg = fallback || t("common.unknown_account", "Unknown account.");
    else if (msg.indexOf("no-account") !== -1) msg = t("vote.no_account", "No on-chain account found for the wallet's active key. Enter an account name below.");
    else if (msg.indexOf("wallet-locked") !== -1) msg = t("common.wallet_locked", "Wallet is locked.");
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
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
      wrap.appendChild(DOM.pageHead(doc, t("vote.title", "Voting"), "voting"));
      wrap.appendChild(el(doc, "p", t("common.status_connecting", "Connecting to network…"), "muted"));
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
        failed.appendChild(DOM.pageHead(doc, t("vote.title", "Voting"), "voting"));
        showError(doc, failed, new Error("not-connected"), t("common.network_unavailable_short", "Network unavailable."));
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
      failed.appendChild(DOM.pageHead(doc, t("vote.title", "Voting"), "voting"));
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
        errBox.textContent = (e && e.message) ? t("common.unknown_account", "Unknown account.") : String(e || t("common.unknown_account", "Unknown account."));
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
      failed.appendChild(DOM.pageHead(doc, t("vote.title", "Voting"), "voting"));
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

    wrap.appendChild(DOM.pageHead(doc, t("vote.title", "Voting"), "voting"));
    /* Ballot intro (keyed vote.ballot_intro): one honest framing line — stake
     * elects witnesses/committee and funds workers (glossary terms), and the
     * counts/shares below are labeled live chain reads, never estimates.
     * Static text, no chain data; sits directly under the h1 so screen
     * readers meet context before the account strip. */
    wrap.appendChild(el(doc, "p", t("vote.ballot_intro", "Your stake elects witnesses and committee and funds workers — all counts and shares below are live chain reads."), "muted"));
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
    VoteUI._gov.fillBudget(doc, budgetLine, myGen);
    joinWBtn.addEventListener("click", function () { VoteUI._gov.renderJoinWitness(doc, joinBox, root, st, myGen, false); });
    updWBtn.addEventListener("click", function () { VoteUI._gov.renderJoinWitness(doc, joinBox, root, st, myGen, true); });
    joinCBtn.addEventListener("click", function () { VoteUI._gov.renderJoinCommittee(doc, joinBox, root, st, myGen); });

    /* Governance analytics (bounded reads only — GovAnalytics): funding
     * shares, active/standby splits, top voters + proxy-vote matrix. Paints
     * best-effort below the join entries; every failure renders an honest
     * dash/unavailable line, never blank, never fatal. Plain literals only
     * (no new i18n keys — locale dicts outside this change's scope). */
    var analyticsBox = el(doc, "div", null, "vote-analytics");
    wrap.appendChild(analyticsBox);
    VoteUI._gov.renderAnalytics(doc, analyticsBox, st, myGen);

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
      ? t("vote.proxy_prefix", "Proxy: ") + (st.proxyName || st.draft.proxyId) + t("vote.proxy_follows", " — your stake follows this account; the vote slate below is read-only.")
      : t("vote.proxy_none", "Proxy: none — voting directly.");
    box.appendChild(line);
    /* LOW punchlist: proxy help "?" link to /help/voting (AccountVoting
     * concept). Batch-3 i18n: keyed, no new route. */
    (function proxyHelp() {
      var p = el(doc, "p", null, "muted");
      var q = doc.createElement("a");
      q.href = "#/help/voting";
      q.textContent = t("vote.what_is_a_proxy", "? What is a proxy?");
      q.title = t("vote.proxies_follow_another_account_s_slate_re", "Proxies follow another account's vote slate — read how voting works before setting one.");
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
        msg.textContent = t("common.unknown_account", "Unknown account.");
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
      bar.appendChild(el(doc, "p", t("vote.in_sync", "Vote slate matches the chain — no changes to publish."), "muted"));
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
    wrap.appendChild(DOM.pageHead(doc, t("vote.confirm_title", "Confirm votes"), "voting"));
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
      failed.appendChild(DOM.pageHead(doc, t("vote.confirm_title", "Confirm votes"), "voting"));
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
    wrap.appendChild(DOM.pageHead(doc, t("vote.confirm_title", "Confirm votes"), "voting"));
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
      var status = showStatus(doc, wrap, t("common.status_signing", "Signing…"));
      var activeWIF = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!activeWIF) {
        wrap.removeChild(status);
        showError(doc, wrap, new Error("wallet-locked"), t("common.wallet_locked", "Wallet is locked."));
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
      onStep(t("common.status_broadcasting", "Broadcasting…"));
      var proof = await sendAndProve(st, attempt, newOptions);
      return { blockNum: proof.head, via: proof.via, retried: false };
    } catch (e) {
      var sendRejected = e && e.sendRejected === true;
      var isSentinel = (newOptions.voting_account || PROXY_SENTINEL) === PROXY_SENTINEL;
      if (!sendRejected || !isSentinel) throw e;
      onStep(t("vote.retry_self", "Node rejected the %(mode)s proxy mode — retrying once as self…", { mode: PROXY_SENTINEL }));
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
    wrap.appendChild(DOM.pageHead(doc, errText ? t("vote.result_failed", "Vote failed") : t("vote.result_ok", "Votes published"), "voting"));
    if (errText) {
      showError(doc, wrap, errText, t("vote.publish_failed", "Vote publish failed."));
    } else {
      var ok = el(doc, "p", t("vote.observed_prefix", "Observed at head block #") + String(res.blockNum) +
        " (" + res.via + ").", "xfer-ok");
      ok.setAttribute("aria-live", "polite");
      wrap.appendChild(ok);
      wrap.appendChild(el(doc, "p",
        res.retried
          ? t("vote.retried_prefix", "The node rejected proxy mode %(mode)s, so the vote was published as self (voting_account %(id)s).", { mode: PROXY_SENTINEL, id: st.me.id })
          : t("vote.direct_note", "Published voting directly (voting_account %(id)s).", { id: PROXY_SENTINEL }), "muted"));
    }
    var back = touchable(el(doc, "a", t("vote.back_to_voting", "Back to voting")));
    back.setAttribute("href", "#/voting");
    back.className = "subtle-btn";
    wrap.appendChild(back);
  }
  VoteUI._ballot.renderVoting = renderVoting;
  VoteUI._ballot.isLive = ballotLive;
  VoteUI._ballot.slateMatches = slateMatches;
  if (typeof globalThis !== "undefined") { globalThis.VoteUI = VoteUI; }
})();

if (typeof module !== "undefined") { module.exports = VoteUI; }
