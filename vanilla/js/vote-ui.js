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
 */
var VoteUI = (function () {
  "use strict";
  /* Batch-2c i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws.
   * Dynamic sentences keep their code structure (batch-2b precedent): only
   * complete static literals are wrapped, values and punctuation glue stay
   * raw, so every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
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

  /* Touch target floor (principle #7): interactive elements are >=44px in
   * at least one dimension. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
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
        var retry = touchable(el(doc, "button", t("vote.retry", "Retry")));
        retry.type = "button";
        retry.addEventListener("click", function () { renderVoting(root); });
        failed.appendChild(retry);
      }, 15000);
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
      return Account.resolve("1.2.0");
    }).then(function (me) {
      if (myGen !== gen) return;
      loadAll(root, doc, me, myGen);
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearRoot(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(el(doc, "h1", t("vote.title", "Voting")));
      showError(doc, failed, e, t("vote.load_account_failed", "Could not load your account."));
      showAccountPicker(doc, failed, root, myGen, "1.2.0");
    });
  }

  /* Unlock gate with return path: ENTRY no longer calls this (public
   * lists render locked); kept for the sign-time path — showConfirm's
   * wallet-locked error directs here via the wallet page. Same pattern as
   * transfer-ui.js renderUnlockPrompt. */
  function renderUnlockPrompt(doc, wrap, root, myGen) {
    wrap.appendChild(el(doc, "h1", t("vote.title", "Voting")));
    wrap.appendChild(el(doc, "p",
      t("vote.unlock_prompt", "Wallet is locked. Enter your password to manage your votes."), "muted"));
    var row = el(doc, "div", null, "xfer-field");
    var label = el(doc, "label", t("vote.password_label", "Password "));
    var input = doc.createElement("input");
    input.type = "password";
    input.setAttribute("autocomplete", "current-password");
    touchable(input);
    label.appendChild(input);
    row.appendChild(label);
    wrap.appendChild(row);
    var btn = touchable(el(doc, "button", t("vote.unlock", "Unlock")));
    btn.type = "button";
    wrap.appendChild(btn);
    var errBox = el(doc, "div", null, "error");
    errBox.setAttribute("aria-live", "polite");
    wrap.appendChild(errBox);
    btn.addEventListener("click", function () {
      errBox.textContent = "";
      btn.disabled = true;
      Promise.resolve()
        .then(function () { return Wallet.unlock(input.value); })
        .then(function () { if (myGen === gen) renderVoting(root); })
        .catch(function (e) {
          btn.disabled = false;
          errBox.textContent = (e && e.message) ? e.message : String(e || t("vote.unlock_failed", "Unlock failed"));
        });
    });
  }

  /* Fallback account picker (no wallet-bound account, or lookup failed):
   * name/id input + resolve, then load the view as that account. */
  function showAccountPicker(doc, wrap, root, myGen, preset) {
    var row = el(doc, "div", null, "xfer-field");
    var label = el(doc, "label", t("vote.vote_as_label", "Vote as (name or 1.2.N) "));
    var input = doc.createElement("input");
    input.type = "text";
    input.setAttribute("autocomplete", "off");
    input.value = preset || "";
    touchable(input);
    label.appendChild(input);
    row.appendChild(label);
    wrap.appendChild(row);
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
      var retry = touchable(el(doc, "button", t("vote.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () { renderVoting(root); });
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
        wrap.appendChild(el(doc, "p", t("vote.viewing_as", "Viewing as committee-account (1.2.0) — unlock to vote as yourself."), "muted"));
    } catch (e) { /* notice is display-only */ }

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
    wrap.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", t("vote.sign_publish", "Sign & Publish")));
    sendBtn.type = "button";
    wrap.appendChild(sendBtn);

    backBtn.addEventListener("click", function () { renderVoting(root); });
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
    if (!signWIF) throw new Error("wallet-locked");
    var txSigned = await Tx.sign(signed, signWIF);
    var netId = await Chain.net();
    var callbackId = (Math.random() * 4294967296) >>> 0;
    var via = "broadcast_transaction_with_callback";
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
    wrap.appendChild(back);
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
