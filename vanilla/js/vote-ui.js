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
      : String(e || fallback || "Unexpected error");
    if (msg.indexOf("unknown-account") !== -1) msg = fallback || "Unknown account.";
    else if (msg.indexOf("no-account") !== -1) msg = "No on-chain account found for the wallet's active key. Enter an account name below.";
    else if (msg.indexOf("wallet-locked") !== -1) msg = "Wallet is locked.";
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = "Network unavailable. Check Settings → Nodes and retry.";
    } else if (msg.indexOf("empty-list") !== -1) msg = "The node returned no witnesses or committee members.";
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

  /* Raw core-precision int string -> "12.34%" via integer hundredths math.
   * Params: totalRaw digit string, supplyRaw digit string (chain supply).
   * Returns "" when the supply is missing/zero (column renders "—"). */
  function sharePct(totalRaw, supplyRaw) {
    if (!/^\d+$/.test(String(totalRaw || "")) || !/^\d+$/.test(String(supplyRaw || ""))) return "";
    var supply = BigInt(supplyRaw);
    if (supply === 0n) return "";
    var bp = (BigInt(totalRaw) * 10000n) / supply;
    var whole = (bp / 100n).toString();
    var frac = (bp % 100n).toString().padStart(2, "0");
    return whole + "." + frac + "%";
  }

  /* Human weight cell: "1,234.56789" style via Format (no grouping — plain
   * decimal, same convention as balances) plus integer share-%. */
  function humanWeight(totalRaw, supplyRaw) {
    var human;
    try {
      human = Format.formatAmount(String(totalRaw), CORE_PRECISION_FALLBACK);
    } catch (e) { human = String(totalRaw); }
    var pct = sharePct(String(totalRaw), supplyRaw);
    return pct ? human + " (" + pct + ")" : human;
  }

  /* Route entry: renderVoting(root). Waits for the shared connection, gates
   * on unlock, resolves the voting account, loads lists + slate, shows view. */
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
      showError(doc, wrap, "Voting backend missing: js/vote.js, js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load.");
      return;
    }
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "h1", "Voting"));
      wrap.appendChild(el(doc, "p", "Connecting to network…", "muted"));
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
        failed.appendChild(el(doc, "h1", "Voting"));
        showError(doc, failed, new Error("not-connected"), "Network unavailable.");
        var retry = touchable(el(doc, "button", "Retry"));
        retry.type = "button";
        retry.addEventListener("click", function () { renderVoting(root); });
        failed.appendChild(retry);
      }, 15000);
      return;
    }
    if (typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked()) {
      renderUnlockPrompt(doc, wrap, root, myGen);
      return;
    }
    wrap.appendChild(el(doc, "p", "Loading governance data…", "muted"));
    Account.myAccountId().then(function (id) {
      return Account.resolve(id);
    }).then(function (me) {
      if (myGen !== gen) return;
      loadAll(root, doc, me, myGen);
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearRoot(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(el(doc, "h1", "Voting"));
      showError(doc, failed, e, "Could not load your account.");
      showAccountPicker(doc, failed, root, myGen, "");
    });
  }

  /* Unlock gate with return path: after unlock, re-render this route (same
   * pattern as transfer-ui.js renderUnlockPrompt). */
  function renderUnlockPrompt(doc, wrap, root, myGen) {
    wrap.appendChild(el(doc, "h1", "Voting"));
    wrap.appendChild(el(doc, "p",
      "Wallet is locked. Enter your password to manage your votes.", "muted"));
    var row = el(doc, "div", null, "xfer-field");
    var label = el(doc, "label", "Password ");
    var input = doc.createElement("input");
    input.type = "password";
    input.setAttribute("autocomplete", "current-password");
    touchable(input);
    label.appendChild(input);
    row.appendChild(label);
    wrap.appendChild(row);
    var btn = touchable(el(doc, "button", "Unlock"));
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
          errBox.textContent = (e && e.message) ? e.message : String(e || "Unlock failed");
        });
    });
  }

  /* Fallback account picker (no wallet-bound account, or lookup failed):
   * name/id input + resolve, then load the view as that account. */
  function showAccountPicker(doc, wrap, root, myGen, preset) {
    var row = el(doc, "div", null, "xfer-field");
    var label = el(doc, "label", "Vote as (name or 1.2.N) ");
    var input = doc.createElement("input");
    input.type = "text";
    input.setAttribute("autocomplete", "off");
    input.value = preset || "";
    touchable(input);
    label.appendChild(input);
    row.appendChild(label);
    wrap.appendChild(row);
    var btn = touchable(el(doc, "button", "Load votes"));
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
        errBox.textContent = (e && e.message) ? "Unknown account." : String(e || "Unknown account.");
      });
    });
  }

  /* Load lists + current slate + chain supply, then show the view. Workers
   * MAY be empty (valid on testnets — renders an empty state, never throws
   * beyond Vote.lists' own empty-list rule for witnesses+committee). */
  async function loadAll(root, doc, me, myGen) {
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "p", "Loading governance data…", "muted"));
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
      failed.appendChild(el(doc, "h1", "Voting"));
      showError(doc, failed, e, "Could not load governance data.");
      var retry = touchable(el(doc, "button", "Retry"));
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

  /* Slate state: `published` is the last on-chain snapshot (dirty baseline);
   * `draft` is the checkbox/proxy working copy. Sets hold vote_id strings
   * ("t:i"). isChanged = proxy differs OR any set differs. Teardown: the
   * state object is closed over by this render generation only; navigation
   * bumps `gen`, so stale handlers/async work bail via the myGen check and
   * the whole state is garbage-collected — no global stores, no listeners
   * survive (the single Store.subscribe above unsubscribes on settle). */
  function newState(me, lists, slate) {
    function setOf(arr) {
      var s = {};
      for (var i = 0; i < (arr || []).length; i++) s[arr[i]] = true;
      return s;
    }
    var proxyId = slate.voting_account || PROXY_SENTINEL;
    return {
      me: me,
      lists: lists,
      supply: "",
      tab: "witness",
      search: { witness: "", committee: "", worker: "" },
      published: {
        proxyId: proxyId,
        witness: setOf(slate.byType.witness),
        committee: setOf(slate.byType.committee),
        worker: setOf(slate.byType.worker)
      },
      draft: {
        proxyId: proxyId,
        witness: setOf(slate.byType.witness),
        committee: setOf(slate.byType.committee),
        worker: setOf(slate.byType.worker)
      },
      byVoteId: indexByVoteId(lists),
      proxySlate: null
    };
  }

  function indexByVoteId(lists) {
    var map = {};
    var all = (lists.witnesses || []).concat(lists.committee || [], lists.workers || []);
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].vote_id) map[all[i].vote_id] = all[i];
    }
    return map;
  }

  function setSize(s) {
    return Object.keys(s).length;
  }

  function sameSet(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (!b[ka[i]]) return false;
    return true;
  }

  function isChanged(st) {
    return st.draft.proxyId !== st.published.proxyId ||
      !sameSet(st.draft.witness, st.published.witness) ||
      !sameSet(st.draft.committee, st.published.committee) ||
      !sameSet(st.draft.worker, st.published.worker);
  }

  function voteName(st, voteId) {
    var e = st.byVoteId[voteId];
    if (e && e.name) return e.name + " (" + e.id + ")";
    if (e) return e.id;
    return voteId;
  }

  function diffNames(st, tab) {
    var p = st.published[tab], d = st.draft[tab];
    var added = [], removed = [];
    Object.keys(d).forEach(function (v) { if (!p[v]) added.push(voteName(st, v)); });
    Object.keys(p).forEach(function (v) { if (!d[v]) removed.push(voteName(st, v)); });
    added.sort();
    removed.sort();
    return { added: added, removed: removed };
  }

  /* Main view: account strip + proxy picker + tabs + publish/reset. */
  function showView(doc, wrap, root, me, lists, slate, supplyRaw, myGen) {
    var st = newState(me, lists, slate);
    st.supply = supplyRaw || "";

    wrap.appendChild(el(doc, "h1", "Voting"));
    var meLine = el(doc, "p", null, "muted");
    meLine.textContent = "Voting as: " + me.name + " (" + me.id + ")";
    wrap.appendChild(meLine);

    var proxyBox = el(doc, "div", null, "vote-proxy");
    wrap.appendChild(proxyBox);
    var tabsBar = el(doc, "div", null, "vote-tabs");
    tabsBar.setAttribute("role", "tablist");
    wrap.appendChild(tabsBar);
    var listBox = el(doc, "div", null, "vote-list");
    wrap.appendChild(listBox);
    var actionBar = el(doc, "div", null, "vote-actions");
    wrap.appendChild(actionBar);

    function refresh() {
      if (myGen !== gen) return;
      renderProxy(doc, proxyBox, root, st, myGen, refresh);
      renderTabs(doc, tabsBar, st, refresh);
      renderList(doc, listBox, st, refresh);
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
      ? "Proxy: " + (st.proxyName || st.draft.proxyId) + " — your stake follows this account; the slate below is read-only."
      : "Proxy: none — voting directly.";
    box.appendChild(line);
    if (hasProxy && st.proxySlate) {
      var n = (st.proxySlate.votes || []).length;
      box.appendChild(el(doc, "p", n === 0
        ? "This proxy has no votes set."
        : "This proxy votes " + n + " item(s).", "muted"));
    }
    var row = el(doc, "div", null, "vote-proxy-row");
    row.style.display = "flex";
    row.style.flexWrap = "wrap";
    row.style.gap = "8px";
    var input = doc.createElement("input");
    input.type = "text";
    input.setAttribute("placeholder", "proxy account name or 1.2.N");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-label", "Proxy account");
    touchable(input);
    input.style.flex = "1 1 200px";
    row.appendChild(input);
    var setBtn = touchable(el(doc, "button", "Set proxy"));
    setBtn.type = "button";
    row.appendChild(setBtn);
    var rmBtn = touchable(el(doc, "button", "Remove proxy"));
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
      if (!v) { msg.textContent = "Enter a proxy account name or id."; return; }
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
        msg.textContent = "Unknown account.";
      });
    });

    rmBtn.addEventListener("click", function () {
      st.draft.proxyId = PROXY_SENTINEL;
      st.proxyName = "";
      st.proxySlate = null;
      refresh();
    });
  }

  function renderTabs(doc, bar, st, refresh) {
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    var tabs = [
      ["witness", "Witnesses (" + setSize(st.draft.witness) + ")"],
      ["committee", "Committee (" + setSize(st.draft.committee) + ")"],
      ["worker", "Workers (" + setSize(st.draft.worker) + ")"]
    ];
    tabs.forEach(function (t) {
      var b = touchable(el(doc, "button", t[1], st.tab === t[0] ? "vote-tab active" : "vote-tab"));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", st.tab === t[0] ? "true" : "false");
      b.addEventListener("click", function () { st.tab = t[0]; refresh(); });
      bar.appendChild(b);
    });
  }

  /* One tab's searchable list. Rows are wrapping flex cards (phone stacks,
   * desktop spreads) — no fixed pixel widths, no hover-only UI. Weights are
   * human via Format p5 + integer share-%. */
  function renderList(doc, box, st, refresh) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var hasProxy = st.draft.proxyId !== PROXY_SENTINEL;
    var entries = st.tab === "witness" ? st.lists.witnesses
      : st.tab === "committee" ? st.lists.committee : st.lists.workers;
    entries = entries || [];

    var search = doc.createElement("input");
    search.type = "search";
    search.setAttribute("placeholder", "Search " + st.tab + "…");
    search.setAttribute("aria-label", "Search " + st.tab);
    search.value = st.search[st.tab] || "";
    touchable(search);
    search.style.width = "100%";
    search.style.boxSizing = "border-box";
    box.appendChild(search);
    var rowsBox = el(doc, "div", null, "vote-rows");
    box.appendChild(rowsBox);

    function draw() {
      while (rowsBox.firstChild) rowsBox.removeChild(rowsBox.firstChild);
      var q = (search.value || "").trim().toLowerCase();
      var shown = entries.filter(function (e) {
        if (!q) return true;
        return (e.name || "").toLowerCase().indexOf(q) !== -1 ||
          (e.id || "").toLowerCase().indexOf(q) !== -1;
      });
      if (entries.length === 0) {
        rowsBox.appendChild(el(doc, "p",
          st.tab === "worker"
            ? "No workers found. Testnets often have none — this is valid, not an error."
            : "Nothing in this list.", "muted"));
        return;
      }
      if (shown.length === 0) {
        rowsBox.appendChild(el(doc, "p", "No matches for this search.", "muted"));
        return;
      }
      shown.forEach(function (e) {
        rowsBox.appendChild(rowCard(doc, st, e, hasProxy, refresh));
      });
    }

    search.addEventListener("input", draw);
    draw();
  }

  /* One slate row: vote checkbox + name/id + active marker + human weight.
   * Workers add daily pay (human p5), dates, and for/against weights. */
  function rowCard(doc, st, e, hasProxy, refresh) {
    var card = el(doc, "div", null, "vote-row");
    card.style.display = "flex";
    card.style.flexWrap = "wrap";
    card.style.gap = "8px";
    card.style.alignItems = "center";
    var box = doc.createElement("input");
    box.type = "checkbox";
    box.checked = !!st.draft[st.tab === "witness" ? "witness" : st.tab === "committee" ? "committee" : "worker"][e.vote_id];
    box.disabled = hasProxy;
    box.setAttribute("aria-label", "Vote for " + (e.name || e.id));
    touchable(box);
    box.addEventListener("change", function () {
      var set = st.draft[st.tab === "witness" ? "witness" : st.tab === "committee" ? "committee" : "worker"];
      if (box.checked) set[e.vote_id] = true;
      else delete set[e.vote_id];
      refresh();
    });
    card.appendChild(box);
    var main = el(doc, "div", null, "vote-row-main");
    main.style.flex = "1 1 200px";
    var title = el(doc, "strong", (e.name || "(unnamed)") + " ");
    main.appendChild(title);
    main.appendChild(el(doc, "span", e.id + (e.active ? " ● active" : ""), "muted"));
    card.appendChild(main);
    var weight = el(doc, "div", humanWeight(e.total_raw, st.supply), "vote-weight");
    weight.title = String(e.total_raw);
    card.appendChild(weight);
    if (st.tab === "worker") {
      var pay;
      try {
        pay = Format.formatAmount(String(e.extra.daily_pay_raw || "0"), CORE_PRECISION_FALLBACK);
      } catch (err) { pay = String(e.extra.daily_pay_raw || "0"); }
      var sub = el(doc, "div",
        "Pay/day " + pay + " · " + (e.extra.work_begin_date || "?") + " → " +
        (e.extra.work_end_date || "?") + " · for " +
        humanWeight(e.total_raw, st.supply) + " / against " +
        humanWeight(e.extra.total_against_raw || "0", st.supply), "muted");
      sub.style.flex = "1 1 100%";
      card.appendChild(sub);
    }
    return card;
  }

  function renderActions(doc, bar, root, st, myGen) {
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    var changed = isChanged(st);
    var pub = touchable(el(doc, "button", "Publish votes"));
    pub.type = "button";
    pub.disabled = !changed;
    var reset = touchable(el(doc, "button", "Reset"));
    reset.type = "button";
    reset.disabled = !changed;
    bar.appendChild(pub);
    bar.appendChild(reset);
    if (!changed) {
      bar.appendChild(el(doc, "p", "Slate matches the chain — no changes to publish.", "muted"));
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
    wrap.appendChild(el(doc, "h1", "Confirm votes"));
    var status = showStatus(doc, wrap, "Estimating fee…");
    try {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_accounts", [[st.me.id]]);
      if (myGen !== gen) return;
      if (!rows || !rows[0] || !rows[0].options) throw new Error("unknown-account");
      var memoKey = rows[0].options.memo_key;
      if (!memoKey) throw new Error("Account has no memo key.");
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
      failed.appendChild(el(doc, "h1", "Confirm votes"));
      showError(doc, failed, e, "Could not prepare the vote.");
      var back = touchable(el(doc, "button", "Back to voting"));
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
   * final counts, human fee + network. No raw JSON anywhere. */
  function showConfirm(doc, wrap, root, st, myGen, newOptions, feeRaw, feePrec, network) {
    var hasProxy = newOptions.voting_account !== PROXY_SENTINEL;
    wrap.appendChild(el(doc, "h1", "Confirm votes"));
    var list = el(doc, "dl", null, "vote-confirm");
    function row(term, text, title) {
      var dt = el(doc, "dt", term);
      var dd = el(doc, "dd", text);
      if (title) dd.title = title;
      list.appendChild(dt);
      list.appendChild(dd);
    }
    row("Account", st.me.name + " (" + st.me.id + ")");
    row("Proxy", hasProxy
      ? (st.proxyName || st.draft.proxyId) + " (" + newOptions.voting_account + ")"
      : "none — voting directly");
    ["witness", "committee", "worker"].forEach(function (tab) {
      var d = diffNames(st, tab);
      var label = tab.charAt(0).toUpperCase() + tab.slice(1);
      var finalCount = Object.keys(st.draft[tab]).length;
      var text = "final: " + finalCount;
      if (d.added.length) text += " · + " + d.added.join(", ");
      if (d.removed.length) text += " · − " + d.removed.join(", ");
      if (!d.added.length && !d.removed.length) text += " (unchanged)";
      row(label + " votes", text);
    });
    var feeHuman;
    try {
      feeHuman = Format.formatAmount(feeRaw, feePrec);
    } catch (e) { feeHuman = feeRaw; }
    row("Fee", feeHuman + " (core)", feeRaw);
    row("Network", network);
    wrap.appendChild(list);

    var backBtn = touchable(el(doc, "button", "Back"));
    backBtn.type = "button";
    wrap.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", "Sign & Publish"));
    sendBtn.type = "button";
    wrap.appendChild(sendBtn);

    backBtn.addEventListener("click", function () { renderVoting(root); });
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, wrap, "Signing…");
      var activeWIF = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!activeWIF) {
        wrap.removeChild(status);
        showError(doc, wrap, new Error("wallet-locked"), "Wallet is locked.");
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
        showError(doc, wrap, (e && e.message) ? e.message : String(e || "Publish failed"), "Vote publish failed.");
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
      onStep("Broadcasting…");
      var proof = await sendAndProve(st, attempt, newOptions);
      return { blockNum: proof.head, via: proof.via, retried: false };
    } catch (e) {
      var sendRejected = e && e.sendRejected === true;
      var isSentinel = (newOptions.voting_account || PROXY_SENTINEL) === PROXY_SENTINEL;
      if (!sendRejected || !isSentinel) throw e;
      onStep("Node rejected the 1.2.5 proxy mode — retrying once as self…");
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
    throw new Error("Sent (" + via + ") but the new slate was not observed within " +
      (PROVE_TIMEOUT_MS / 1000) + "s; check #/voting before retrying " +
      "(do NOT blindly rebroadcast).");
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
    wrap.appendChild(el(doc, "h1", errText ? "Vote failed" : "Votes published"));
    if (errText) {
      showError(doc, wrap, errText, "Vote publish failed.");
    } else {
      var ok = el(doc, "p", "Observed at head block #" + String(res.blockNum) +
        " (" + res.via + ").", "xfer-ok");
      ok.setAttribute("aria-live", "polite");
      wrap.appendChild(ok);
      wrap.appendChild(el(doc, "p",
        res.retried
          ? "The node rejected proxy mode 1.2.5, so the vote was published as self (voting_account " + st.me.id + ")."
          : "Published voting directly (voting_account 1.2.5).", "muted"));
    }
    var back = touchable(el(doc, "a", "Back to voting"));
    back.setAttribute("href", "#/voting");
    wrap.appendChild(back);
  }

  return {
    renderVoting: renderVoting,
    _test: {
      sharePct: sharePct,
      humanWeight: humanWeight,
      sameSet: sameSet,
      isChanged: isChanged,
      slateMatches: slateMatches
    }
  };
})();

if (typeof module !== "undefined") { module.exports = VoteUI; }
