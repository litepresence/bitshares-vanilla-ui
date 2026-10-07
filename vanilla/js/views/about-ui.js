/* about-ui.js — the marketing-layered About page (#/about).
 * Owns: static DOM for the About route (hero + CTAs + six philosophy
 *   blocks + honest-limits block + links row + making-of story with the
 *   lazy build-dialog archive). Consumes: I18n.t via the
 *   local t() fallback (verbatim English defaults, slice-17 batch pattern);
 *   window.BuildDialog (lazy asset, 413-exchange fallback) and Router
 *   (deep-link ?dialog=N, read on render only). No chain, no wallet, no
 *   amounts — no Format vectors apply, no failure modes: the page renders
 *   with the node down (which is the pitch).
 *   Styling reuses .wrap/.menu-grid/.menu-card plus .bd-* archive rules.
 *   Globals/side effects: DOM under the router root; single global AboutUI
 *   (+ module.exports). Static renders + one lazy script inject.
 * Created by: building-vanilla-slices skill, about spec
 *   (docs/superpowers/specs/2026-10-04-about-design.md).
 * Copy bounds: AGENTS.md §3.8 — no fabricated stats, volumes, or counts;
 *   the only live things here are links to live pages. */
var AboutUI = (function () {
  "use strict";

  /* Batch-pattern i18n (slice-17 precedent): display strings resolve via
   * I18n.t with the pre-conversion literal kept verbatim as enDefault.
   * Falls back to the default when i18n.js failed to load: never blank,
   * never throws. Supports %(name)s interpolation via vars object. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* cta: one full-card link button. Params: doc, href, label. Returns the
   * anchor. Never throws. */
  function cta(doc, href, label) {
    var a = doc.createElement("a");
    a.className = "menu-card";
    a.setAttribute("href", href);
    var b = doc.createElement("b");
    b.textContent = label;
    a.appendChild(b);
    return a;
  }

  /* buildDialogTotal: live exchange count when the asset script loaded,
   * else DIALOG_FALLBACK_TOTAL. The archive grows every time
   * tooling/collate_vanilla_prompts.py runs, so this constant is only the
   * pre-load bound — every visible count reads buildDialogTotal() instead
   * of a literal, which is what let "413 / 14 sessions" rot into all 12
   * locale dicts. Params: none. Returns integer. */
  var DIALOG_FALLBACK_TOTAL = 739;

  /* dialogNumber: parse Router.query() into a 1-based exchange number.
   * Params: q (object, possibly {}). Returns integer or null. Bounds come
   * from window.BuildDialog when loaded, else DIALOG_FALLBACK_TOTAL. */
  function dialogNumber(q) {
    var raw = q && q.dialog;
    var n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return null;
    if (n > buildDialogTotal()) return null;
    return n;
  }

  /* matchExchange: plain case-insensitive substring over user+reply.
   * Params: entry ({user, reply}), needle (string). Returns boolean.
   * Empty needle matches everything (clear-box state). Never throws. */
  function matchExchange(entry, needle) {
    if (!needle) return true;
    var hay = ((entry && entry.user) || "") + "\n" + ((entry && entry.reply) || "");
    return hay.toLowerCase().indexOf(String(needle).toLowerCase()) !== -1;
  }

  function buildDialogTotal() {
    try {
      if (typeof window !== "undefined" && window) {
        var live = /** @type {any} */ (window).BuildDialog;
        if (live && live.length) return live.length;
      }
    } catch (e) { /* fallback below */ }
    return DIALOG_FALLBACK_TOTAL;
  }

  /* Build-dialog lazy loader (index.html frozen — dynamic script like the
   * pool-graph precedent; relative URL only, never CDN). Params: cb(bool).
   * Returns nothing. Never throws. */
  var _bdLoading = false, _bdWaiters = [];
  function ensureBuildDialog(cb) {
    try {
      if (typeof window !== "undefined" && window) {
        var live = /** @type {any} */ (window).BuildDialog;
        if (live && live.length) { cb(true); return; }
      }
    } catch (e) { /* load below */ }
    if (typeof document === "undefined") { try { cb(false); } catch (e2) {} return; }
    _bdWaiters.push(cb);
    if (_bdLoading) return;
    _bdLoading = true;
    try {
      var s = document.createElement("script");
      s.src = "assets/build-dialog.js";
      s.async = true;
      s.onload = function () {
        _bdLoading = false;
        var w = _bdWaiters; _bdWaiters = [];
        w.forEach(function (f) { try { f(true); } catch (e) {} });
      };
      s.onerror = function () {
        _bdLoading = false;
        var w = _bdWaiters; _bdWaiters = [];
        w.forEach(function (f) { try { f(false); } catch (e) {} });
      };
      (document.head || document.getElementsByTagName("head")[0] || document.documentElement).appendChild(s);
    } catch (e) {
      _bdLoading = false;
      var w = _bdWaiters; _bdWaiters = [];
      w.forEach(function (f) { try { f(false); } catch (e2) {} });
    }
  }

  /* exchangeDetails: one collapsible exchange (<details id="bd-N">).
   * Params: doc, entry ({n, user, reply, session, time}). Returns the
   * element. The permalink is a plain anchor (hash updates natively on
   * click only — no JS navigation on render, hence no render loop).
   * All strings via textContent — never innerHTML. Never throws. */
  function exchangeDetails(doc, entry) {
    var d = doc.createElement("details");
    d.className = "bd-details";
    try {
      d.setAttribute("id", "bd-" + entry.n);
      d.setAttribute("data-n", String(entry.n));
    } catch (e) { /* ids stand */ }
    var s = doc.createElement("summary");
    s.textContent = "#" + entry.n + " · " + entry.session + " · " + entry.time;
    d.appendChild(s);
    d.appendChild(DOM.el(doc, "p", entry.user));
    if (entry.reply) d.appendChild(DOM.el(doc, "p", entry.reply));
    else d.appendChild(DOM.el(doc, "p",
      t("about.dlg_no_reply", "No reply recorded — the next prompt followed immediately."), "muted"));
    var pl = doc.createElement("a");
    try {
      pl.setAttribute("href", "#/about?dialog=" + entry.n);
    } catch (e2) { /* link stands */ }
    pl.textContent = "#" + entry.n;
    d.appendChild(pl);
    return d;
  }

  /* renderAbout: #/about — hero, CTAs, philosophy, limits, links,
   * making-of story, lazy build-dialog archive. A missing root is a no-op.
   * @param {HTMLElement} root router mount element.
   * @returns {void} */
  function renderAbout(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    DOM.clear(root);
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);
    DOM.append(wrap,
      DOM.pageHead(doc, t("about.hero_title", "BitShares, in your browser. Nothing to install."), "info-circle-o"),
      DOM.el(doc, "p",
        t("about.hero_lede", "A wallet for the BitShares blockchain — markets, accounts, governance, and exploration — running as plain web files. No framework, no installer, no account with us. Your keys never leave this browser."),
        "muted"));
    var grid = doc.createElement("div");
    grid.className = "menu-grid";
    DOM.append(grid,
      cta(doc, "#/market/BTS_USD", t("about.cta_trade", "Open the exchange")),
      cta(doc, "#/help", t("about.cta_guides", "Read the guides")));
    DOM.append(wrap, grid);
    DOM.append(wrap,
      DOM.el(doc, "h2", t("about.s1_title", "Your keys never leave this browser")),
      DOM.el(doc, "p",
        t("about.s1_body", "Accounts live in an encrypted vault on your device, and every transaction is signed locally before broadcast. The nodes you connect to never see your secrets — which is also why backups are yours alone: lose the brainkey and nobody can recover your funds.")));
    DOM.append(wrap,
      DOM.el(doc, "h2", t("about.s2_title", "Trade on the real order book")),
      DOM.el(doc, "p",
        t("about.s2_body", "Order books, liquidity pools, swaps, borrowing, credit, prediction markets, and voting all settle on-chain. What you see is the chain itself — books you can trade against, not pictures of books.")));
    DOM.append(wrap,
      DOM.el(doc, "h2", t("about.s3_title", "Runs for years with no updates")),
      DOM.el(doc, "p",
        t("about.s3_body", "The wallet it replaces died under a hundred stale packages and a toolchain nobody can reproduce. Built to avoid release-cycle dependencies: no framework, no package manager, no build step — the smallest thing that can still run in a browser a decade from now.")));
    DOM.append(wrap,
      DOM.el(doc, "h2", t("about.s4_title", "Same pages, live updates")),
      DOM.el(doc, "p",
        t("about.s4_body", "Returning users feel at home instantly — the same pages, panels, and words as the classic wallet — while balances, books, and connection status update live in place. Forgiving search across markets, accounts, and assets, three themes, and layouts that work from a 360px phone to a 4K trading desk.")));
    DOM.append(wrap,
      DOM.el(doc, "h2", t("about.s5_title", "Numbers you can trust")),
      DOM.el(doc, "p",
        t("about.s5_body", "The chain speaks integers; you never see them. Every amount sits at its asset's decimals, every percent at its true value, and every fee is read from the live chain before you sign.")));
    DOM.append(wrap,
      DOM.el(doc, "h2", t("about.s6_title", "Honest limits")),
      DOM.el(doc, "p",
        t("about.s6_body", "Gateways are custodians holding your outside coins — read their terms as the custody deal it is. The history index is run by the community, not by this wallet. Some features have no testnet data by nature, and there is no in-app news feed by decision. Where this wallet cannot know, it says so instead of guessing.")));
    DOM.append(wrap,
      DOM.el(doc, "h2", t("about.links_title", "Go further")));
    var ul = doc.createElement("ul");
    [["#/help", t("help.help", "Help")],
     ["#/community", t("help.community_title", "Community")],
     ["https://github.com/litepresence/bitshares-vanilla-ui", t("about.link_source", "Source code")]].forEach(function (pair) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.setAttribute("href", pair[0]);
      a.textContent = pair[1];
      if (pair[0].indexOf("https://") === 0) {
        try { a.target = "_blank"; a.rel = "noopener"; } catch (e) { /* same-tab fallback */ }
      }
      li.appendChild(a); ul.appendChild(li);
    });
    DOM.append(wrap, ul);
    DOM.append(wrap,
      DOM.el(doc, "h2", t("about.making_title", "Making of this wallet")),
      DOM.el(doc, "p",
        t("about.making_body", "What follows is the original build story: every prompt that created this wallet, from \"acquire bitshares-ui\" on 26 September 2026 to the issue-1 fix on 3 October, with the builders' replies — preserved unedited. It records the decisions this wallet stands on: walking away from another React uplift after issue #3583 and its thousand-hour trap, so this wallet depends on nothing with a release cycle; signing every transaction locally like the old wallet instead of outsourcing it; three themes with the classic look as default; numbers in human terms, never raw chain integers; phone-first layouts from the first slice; and fees read from the live chain, never estimated. Read it as history: this is how the wallet got built.")));
    /* Collapsed build-dialog archive. First expansion injects the asset
     * script once (data-bd flag on the box); load error writes the
     * unavailable line. Deep-link ?dialog=N expands + scrolls on render. */
    var bdBox = doc.createElement("details");
    bdBox.className = "bd-archive";
    var bdSum = doc.createElement("summary");
    bdSum.textContent = t("about.dlg_heading_c", "Full build dialog (%(total)s)", { total: buildDialogTotal() });
    bdBox.appendChild(bdSum);
    var searchRow = doc.createElement("div");
    searchRow.className = "bd-search";
    var field = doc.createElement("input");
    var ph = t("about.dlg_search_ph", "Filter exchanges…");
    try {
      field.setAttribute("type", "search");
      field.setAttribute("aria-label", ph);
    } catch (e) { /* unlabelled filter stands */ }
    try { field.placeholder = ph; } catch (e2) { /* placeholder stands */ }
    var clearBtn = DOM.el(doc, "button", t("about.dlg_search_clear", "Clear"));
    try { clearBtn.setAttribute("type", "button"); } catch (e3) { /* submit default stands */ }
    var status = DOM.el(doc, "p", "", "muted");
    DOM.append(searchRow, field, clearBtn, status);
    bdBox.appendChild(searchRow);
    var bdList = doc.createElement("div");
    bdBox.appendChild(bdList);
    DOM.append(wrap, bdBox);
    DOM.append(wrap,
      DOM.el(doc, "p", t("about.dlg_noscript", "This archive needs JavaScript; the same text lives in docs/vanilla-ui-dialog.md in the source repo."), "muted"));
    /* Deep link: ?dialog=N read on render only (never navigated to here,
     * so no render loop). Guard mirrors the I18n guard in t(). */
    var query = {};
    try {
      if (typeof Router !== "undefined" && Router && typeof Router.query === "function") query = Router.query() || {};
    } catch (e4) { query = {}; }
    var target = dialogNumber(query);
    /* R12: bad-link feedback — query.dialog present but out of range / non-numeric */
    if (query && query.dialog && target === null) {
      try { status.textContent = t("about.dlg_bad_link", "Invalid exchange number. Valid range: 1–%(total)s.", { total: buildDialogTotal() }); } catch (e) { /* status stands */ }
    }
    /* fillArchive: build day groups + wire filter + honour deep link.
     * Params: ok (asset usable), deep (exchange number or null).
     * Returns nothing. Never throws (archive degrades to status line). */
    function fillArchive(ok, deep) {
      var asset = null;
      try {
        if (typeof window !== "undefined" && window) asset = /** @type {any} */ (window).BuildDialog;
      } catch (e) { asset = null; }
      if (!ok || !asset || !asset.length) {
        try {
          bdBox.setAttribute("data-bd", "error");
          status.textContent = t("about.dlg_unavailable", "Build-dialog archive unavailable.");
        } catch (e2) { /* collapsed box stands */ }
        return;
      }
      try {
        bdBox.setAttribute("data-bd", "ready");
        bdSum.textContent = t("about.dlg_heading_c", "Full build dialog (%(total)s)", { total: asset.length });
      } catch (e3) { /* stale count stands */ }
      var index = [], groups = [], lastDay = null, cur = null, i, entry, day, d;
      for (i = 0; i < asset.length; i++) {
        entry = asset[i];
        try { day = String(entry.time || "").slice(0, 10) || "?"; } catch (e4) { day = "?"; }
        if (day !== lastDay) {
          lastDay = day;
          cur = { day: day, head: null, wrap: null };
          try {
            cur.head = DOM.el(doc, "h3", day, "bd-day muted");
            cur.wrap = doc.createElement("div");
            DOM.append(bdList, cur.head, cur.wrap);
          } catch (e5) { cur = null; }
          if (cur) groups.push(cur);
        }
        if (!cur) continue;
        try {
          d = exchangeDetails(doc, entry);
          cur.wrap.appendChild(d);
          index.push({ entry: entry, box: d, day: day, hit: true });
        } catch (e6) { /* one bad entry never kills the archive */ }
      }
      /* applyFilter: hide non-matching exchanges + emptied day groups,
       * refresh the Showing x/y line. Params: none. Never throws. */
      function applyFilter() {
        var needle = "";
        try { needle = field.value || ""; } catch (e) { needle = ""; }
        var shown = 0, g, k, item, n;
        for (k = 0; k < index.length; k++) {
          item = index[k];
          try { item.hit = matchExchange(item.entry, needle); } catch (e2) { item.hit = true; }
          try { item.box.style.display = item.hit ? "" : "none"; } catch (e3) { /* shown stands */ }
          if (item.hit) shown++;
        }
        for (g = 0; g < groups.length; g++) {
          n = 0;
          for (k = 0; k < index.length; k++) if (index[k].day === groups[g].day && index[k].hit) n++;
          try {
            groups[g].head.style.display = n ? "" : "none";
            groups[g].wrap.style.display = n ? "" : "none";
            if (n) groups[g].head.textContent = groups[g].day + " (" + n + ")";
          } catch (e4) { /* group stands */ }
        }
        try {
          var base = t("about.dlg_showing_c", "Showing %(shown)s / %(total)s", { shown: shown, total: index.length });
          if (shown === 0 && needle) base += " — " + t("about.dlg_no_match", "No matching exchanges. Clear the search to see everything.");
          status.textContent = base;
        } catch (e5) { /* count stands */ }
      }
      try {
        field.addEventListener("input", applyFilter);
        clearBtn.addEventListener("click", function () {
          try { field.value = ""; } catch (e) { /* cleared below */ }
          applyFilter();
          try { field.focus(); } catch (e2) { /* focus stands */ }
        });
      } catch (e7) { /* unfiltered list stands */ }
      applyFilter();
      if (deep) {
        for (i = 0; i < index.length; i++) {
          if (index[i].entry && index[i].entry.n === deep) {
            try {
              index[i].box.open = true;
              if (typeof index[i].box.scrollIntoView === "function") index[i].box.scrollIntoView();
            } catch (e8) { /* unexpanded target stands */ }
            break;
          }
        }
      }
    }
    /* expandOnce: first-open asset fetch (guard flag lives on the box).
     * Guard covers loading/ready/error alike: error persists until re-render by design (no retry).
     * Params: none. Returns nothing. Never throws. */
    function expandOnce() {
      try {
        if (bdBox.getAttribute("data-bd")) return;
        bdBox.setAttribute("data-bd", "loading");
      } catch (e) { return; }
      ensureBuildDialog(function (ok) { fillArchive(ok, target); });
    }
    try {
      bdBox.addEventListener("toggle", function () { if (bdBox.open) expandOnce(); });
    } catch (e5) { /* manual toggle stands */ }
    if (target) {
      try { bdBox.open = true; } catch (e6) { /* collapsed stands */ }
      expandOnce();
    }
  }

  return { renderAbout: renderAbout, _test: { dialogNumber: dialogNumber, matchExchange: matchExchange, buildDialogTotal: buildDialogTotal } };
})();

if (typeof module !== "undefined") { module.exports = AboutUI; }