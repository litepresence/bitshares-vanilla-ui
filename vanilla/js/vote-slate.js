/* VoteSlate: vote-slate state core + slate list rendering for #/voting.
 * Owns: the draft-vs-published slate state (newState, set diffs, dirty
 *   check, name joins) and the per-tab searchable list (renderTabs,
 *   renderList/draw, rowCard with human weights). Pure state + DOM rows —
 *   NO proxy fetching, NO publish, NO signing (those stay in vote-ui.js,
 *   which calls in here and passes refresh callbacks down).
 * Consumes: Format.formatAmount (human weights at core precision; the view
 *   passes nothing — Format is a global, same as before the split),
 *   document elements callers pass in. Tiny el/touchable are private
 *   verbatim copies of the vote-ui.js originals (same per-file convention
 *   as the explorer split) so moved bodies stay byte-identical.
 * Globals/side effects: DOM rows it returns/appends under the caller's
 *   boxes only; global VoteSlate only. No storage, no keys, no chain I/O.
 * Created by: building-vanilla-slices skill, slice-18 audit (vote-ui split).
 *   Bodies moved verbatim from js/vote-ui.js (sharePct/humanWeight +
 *   newState→diffNames + renderTabs/renderList/rowCard); sharePct/
 *   humanWeight moved too because rowCard's weight cells depend on them
 *   (VoteUI._test points at these copies — same functions, new home).
 *
 * CHAIN TRUTH (moved with the bodies): num_witness/committee count
 *   witness/committee votes only, worker votes never count
 *   (protocol/account.hpp:50-55) — enforced by construction in newState
 *   (separate per-type sets, never one shared set).
 */
var VoteSlate = (function () {
  "use strict";

  /* Proxy-to-self sentinel: voting_account == this means "no proxy, my
   * slate counts" (protocol/config.hpp:150; #1 AccountVoting.jsx:290).
   * Verbatim copy of vote-ui.js's const (deliberate duplication, §4.5.5 —
   * no shared-const layer for two files). */
  var PROXY_SENTINEL = "1.2.5";
  /* Core precision fallback for weight cells (GRAPHENE core p5). Same copy
   * note as PROXY_SENTINEL. */
  var CORE_PRECISION_FALLBACK = 5;

  /* Create an element with optional text + class (textContent only — user
   * and chain strings never reach innerHTML). Verbatim copy of vote-ui.js. */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch target floor (principle #7): interactive elements are >=44px in
   * at least one dimension. Verbatim copy of vote-ui.js. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  /* Raw core-precision int string -> "12.34%" via integer hundredths math.
   * Params: totalRaw digit string, supplyRaw digit string (chain supply).
   * Returns "" when the supply is missing/zero (column renders "—").
   * Fails: never (garbage in yields "", never a throw). */
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
   * decimal, same convention as balances) plus integer share-%.
   * Params: totalRaw digit string, supplyRaw digit string ("" hides the %
   *   part — a missing denominator is display-only, weights still render).
   * Returns: human string, never blank. Fails: never (Format errors fall
   *   back to the raw string). */
  function humanWeight(totalRaw, supplyRaw) {
    var human;
    try {
      human = Format.formatAmount(String(totalRaw), CORE_PRECISION_FALLBACK);
    } catch (e) { human = String(totalRaw); }
    var pct = sharePct(String(totalRaw), supplyRaw);
    return pct ? human + " (" + pct + ")" : human;
  }

  /* Fresh slate state for one account + lists snapshot. `published` is the
   * last on-chain snapshot (dirty baseline); `draft` is the
   * checkbox/proxy working copy. Sets hold vote_id strings ("t:i").
   * Teardown: the state object is closed over by one render generation
   * only; navigation bumps vote-ui.js's gen, so stale handlers/async work
   * bail via the myGen check and the whole state is garbage-collected — no
   * global stores, no listeners survive.
   * Params: me (resolved account {id, name}), lists (Vote.lists shape),
   *   slate (Vote.currentVotes shape). Returns: the state object. */
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

  /* Vote-id -> list entry map over all three tabs (name joins for the
   * confirm dialog read through this). Params: lists (Vote.lists shape).
   * Returns: {vote_id: entry}. Fails: never (entries without vote_id skip). */
  function indexByVoteId(lists) {
    var map = {};
    var all = (lists.witnesses || []).concat(lists.committee || [], lists.workers || []);
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].vote_id) map[all[i].vote_id] = all[i];
    }
    return map;
  }

  /* Set cardinality (sets are plain objects — no Set, file:// safe).
   * Params: s (vote-id set object). Returns: non-negative int. */
  function setSize(s) {
    return Object.keys(s).length;
  }

  /* Set equality by key membership (order-free — checkbox order is UI
   * noise, never slate state). Params: a, b (vote-id set objects).
   * Returns: boolean. */
  function sameSet(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (!b[ka[i]]) return false;
    return true;
  }

  /* Dirty check: proxy differs OR any tab's set differs from published.
   * Params: st (newState shape). Returns: boolean (drives Publish/Reset
   *   enablement in vote-ui.js renderActions). */
  function isChanged(st) {
    return st.draft.proxyId !== st.published.proxyId ||
      !sameSet(st.draft.witness, st.published.witness) ||
      !sameSet(st.draft.committee, st.published.committee) ||
      !sameSet(st.draft.worker, st.published.worker);
  }

  /* Vote-id -> "Name (1.6.N)" for confirm rows (falls back to the object
   * id, then the bare vote_id — never blank). Params: st (needs byVoteId),
   *   voteId string. Returns: display string. */
  function voteName(st, voteId) {
    var e = st.byVoteId[voteId];
    if (e && e.name) return e.name + " (" + e.id + ")";
    if (e) return e.id;
    return voteId;
  }

  /* Added/removed display names for one tab (confirm dialog rows).
   * Params: st (needs published/draft/byVoteId), tab ("witness"|
   *   "committee"|"worker"). Returns: {added[], removed[]} (sorted). */
  function diffNames(st, tab) {
    var p = st.published[tab], d = st.draft[tab];
    var added = [], removed = [];
    Object.keys(d).forEach(function (v) { if (!p[v]) added.push(voteName(st, v)); });
    Object.keys(p).forEach(function (v) { if (!d[v]) removed.push(voteName(st, v)); });
    added.sort();
    removed.sort();
    return { added: added, removed: removed };
  }

  /* Slate tab bar (Witnesses/Committee/Workers with draft counts).
   * Params: doc, bar (emptied first), st (tab + draft sets), refresh
   *   (vote-ui.js re-render closure). Returns nothing. */
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
   * human via Format p5 + integer share-%.
   * Params: doc, box (emptied first: search input + rows container), st
   *   (tab + lists + search text), refresh (re-render closure for checkbox
   *   toggles). Returns nothing. */
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

    /* Repaint the rows for the current search text (case-insensitive
     * name/id substring; empty states distinguish "no workers on chain"
     * from "no search matches" — never blank, never a throw). */
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
   * Workers add daily pay (human p5), dates, and for/against weights.
   * Checkboxes disable under a proxy (read-only slate — the proxy's votes
   * count, not the boxes). Params: doc, st (tab + draft sets + supply),
   *   e (list entry), hasProxy bool, refresh (closure). Returns: the card. */
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

  return {
    newState: newState,
    indexByVoteId: indexByVoteId,
    setSize: setSize,
    sameSet: sameSet,
    isChanged: isChanged,
    voteName: voteName,
    diffNames: diffNames,
    sharePct: sharePct,
    humanWeight: humanWeight,
    renderTabs: renderTabs,
    renderList: renderList,
    rowCard: rowCard
  };
})();

if (typeof module !== "undefined") { module.exports = VoteSlate; }
