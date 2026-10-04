/* ExplorerUI: the explorer shell (search + tabs + deep-link dispatch).
 * Owns: DOM for #/explorer (ref-order tabs + feeds extra), the global search
 *   box, the head strip, the 1.x.y inline object panel slot, the single
 *   generation counter + connect-gate teardown, and the route entry points
 *   (renderExplorer/renderBlock/renderTx/renderAsset — router.js calls
 *   these names, unchanged by the split). Block views delegate to
 *   ExplorerBlocks, asset/feed/object views to ExplorerAssets (lazy globals:
 *   both files load BEFORE this one — index.html order — so they exist by
 *   the time any route renders; guards paint honest panels if not).
 * Consumes: Explorer.head/resolveObject/search (read-only, via global) and
 *   ExplorerBlocks.blocksTab/renderBlock/renderTx +
 *   ExplorerAssets.assetsTab/feedsTab/renderAsset/renderObjectPanel.
 * Globals/side effects: DOM under the router root, global ExplorerUI only.
 *   Generation counter invalidates stale async work after teardown (same
 *   pattern as vote-ui.js: every route entry bumps `gen`; continuations bail
 *   when their generation no longer matches; the single connect listener
 *   unsubscribes on settle). MONEY DISCIPLINE (principle #6) lives in
 *   explorer-assets.js — this shell formats no money (heights are plain
 *   ints, time is the chain ISO string, already human).
 * Created by: building-vanilla-slices skill, slice-09-explorer plan Task 2;
 *   split into explorer-blocks.js + explorer-assets.js by the slice-9 repair
 *   (behavior-preserving §3.7 split — dispatch + delegates only).
 *
 * CHAIN TRUTH (from the slice-09 plan References; #4 wins):
 * - Block/tx getters: database_api.hpp:162-200; heights are plain ints
 *   (never money); unknown height/tx throws named errors -> empty states.
 * - Object space 1.x.y: types.hpp:361-386 (1.2 account, 1.3 asset, ...).
 */
var ExplorerUI = (function () {
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


  var CONNECT_TIMEOUT_MS = 15000; /* slice-1 offline pattern */
  /* Ref tab order (Explorer.jsx:18-64): blocks/assets/pools/accounts/
   * witnesses/committee/markets/fees — plus vanilla's feeds extra (kept as
   * documented superset, last). Labels capitalize from ids except "blocks",
   * which reads "Blockchain" via tabLabel below. */
  var TABS = ["blocks", "assets", "pools", "accounts", "witnesses",
    "committee", "markets", "fees", "feeds"];

  /* Tab label: the "blocks" subtab reads "Blockchain" (ref #1 Blocks tab
   * parity + user rename) via i18n; every other id capitalizes as before.
   * Params: id (tab id string). Returns the button label. Fails: never. */
  function tabLabel(id) {
    if (id === "blocks") return t("explorer.tab_blocks", "Blockchain");
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  /* Generation counter: every route entry bumps it; async continuations
   * capture their generation and bail when it no longer matches. Single
   * owner for all three explorer files, so cross-route stale work (e.g. a
   * block-view amount span resolving after navigating to an asset) bails
   * instead of touching detached DOM. */
  var gen = 0;
  /* Inline object panel target: exotic 1.x.y links set this and re-render
   * #/explorer instead of inventing new routes (see routeObject). */
  var pendingObject = null;
  var pendingTab = "blocks";

  /* Shell-owned counter access for explorer-blocks.js / explorer-assets.js
   * (they load first, so all lookups are lazy call-time globals). */
  function bumpGen() {
    gen += 1;
    return gen;
  }

  function isCurrent(myGen) {
    return myGen === gen;
  }

  /* Stash an exotic 1.x.y id for the inline object panel (set by
   * ExplorerAssets.objectLink, consumed by renderExplorer). */
  function setPending(id, tab) {
    pendingObject = id;
    pendingTab = (typeof tab === "string" && tab) ? tab : "blocks";
  }

  /* No local el — use DOM.el */

  /* Touch target floor (principle #7): interactive elements are >=44px in
   * at least one dimension. */
/* clearRoot removed — use DOM.clear */

  /* Shell title (original Blocks.jsx renders NO h1 — tabs sit directly
   * under the header; vanilla keeps exactly one h1 for a11y but folds it
   * visually away via .xplore-sr so spacing matches the original). */
  function shellTitle(doc) {
    var h = DOM.pageHead(doc, t("explorer.title", "Explore"), "insight");
    h.className = "xplore-sr";
    return h;
  }

  /* Wide (viewport-gaps fix 2026-09-28): full-bleed stacked grid
   * ≥1200px; children span full width via app.css .wide contract. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  /* Inline error panel that is never blank: thrown values map to human
   * sentences; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var box = null; /* created via DOM.error below — use DOM.el, DOM.clear */
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("unknown-block") !== -1) msg = t("explorer.unknown_block", "Unknown block.");
    else if (msg.indexOf("unknown-tx") !== -1) msg = t("explorer.unknown_tx", "Unknown transaction.");
    else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || t("explorer.unknown_asset", "Unknown asset.");
    else if (msg.indexOf("unknown-object") !== -1) msg = fallback || (t("explorer.not_found", "Nothing found for that search.") + " Check the id shape (1.x.x) or name spelling and retry.");
    else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = t("explorer.tx_expired", "Transaction hash lookup covers recent transactions only — this one is expired or unknown.");
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    }
    box = DOM.error(wrap, msg);
    return box;
  }

  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text);
    return p;
  }

  /* Wait-for-connection gate (slice-5 race repair precedent, same shape as
   * account-ui.js renderAccount): when the socket is cold, show a
   * connecting panel, re-run `rerun` once on open, and time out into an
   * offline panel with Retry. Returns true when the caller must stop
   * (waiting or timed-out UI already shown). Canonical implementation —
   * explorer-blocks.js / explorer-assets.js delegate here via _waitForOpen. */
  function waitForOpen(doc, wrap, root, myGen, rerun) {
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state === "open") return false;
    wrap.appendChild(shellTitle(doc));
    wrap.appendChild(DOM.el(doc, "p", t("common.status_connecting", "Connecting to network…"), "muted"));
    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    var settled = false;
    var off = function () {};
    if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
      off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) rerun();
        }
      });
    }
    var timer = setTimeout(function () {
      if (settled || myGen !== gen) return;
      settled = true; off();
      if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
      DOM.clear(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(shellTitle(doc));
      showError(doc, failed, new Error("not-connected"), t("explorer.offline_short", "Network unavailable."));
      var xstat = DOM.el(doc, "p", "", "muted");
      try { xstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      failed.appendChild(xstat);
      var xrow = DOM.el(doc, "div", null, "pools-offline-row");
      failed.appendChild(xrow);
      var retry = touchable(DOM.el(doc, "button", t("explorer.retry", "Retry")));
      retry.type = "button";
      xrow.appendChild(retry);
      var xoff = null;
      try { xoff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { xoff = null; }
      if (xoff && typeof xoff.wire === "function") {
        try { xoff.wire(retry, xstat, rerun, t); } catch (e) { retry.addEventListener("click", function () { rerun(); }); }
      } else {
        retry.addEventListener("click", function () { rerun(); });
      }
      var xlink = null;
      if (xoff && typeof xoff.settingsLink === "function") {
        try { xlink = xoff.settingsLink(doc, t); } catch (e) { xlink = null; }
      }
      if (!xlink) {
        xlink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
        try { xlink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
        touchable(xlink);
      }
      xrow.appendChild(xlink);
    }, CONNECT_TIMEOUT_MS);
    /* Automated handshake on entry (shared Offline helper owns the throttle). */
    try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
    return true;
  }

  /* Head strip: "Head #N · time · irreversible #M". Heights are plain ints
   * (never money); time is the chain ISO string (already human). */
  function loadHeadStrip(doc, box, myGen) {
    Explorer.head().then(function (h) {
      if (myGen !== gen) return;
      DOM.clear(box);
      box.appendChild(DOM.el(doc, "p",
        t("explorer.head_prefix", "Head #") + h.head_block_number + " · " + h.head_block_time +
        t("explorer.head_lib", " · irreversible #") + h.last_irreversible_block_num, "muted"));
    }).catch(function () {
      if (myGen !== gen) return;
      DOM.clear(box);
      box.appendChild(DOM.el(doc, "p", t("explorer.head_unavailable", "Head block unavailable."), "muted"));
    });
  }

  /* Honest panel when a same-slice file failed to load (impossible in the
   * shipped app — script tags are load-bearing). */
  function missingView(root, title, file) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.pageHead(doc, title, "insight"));
    showError(doc, wrap, t("explorer.view_missing_prefix", "Explorer view missing: ") + file + t("explorer.view_missing_suffix", " failed to load."));
  }

  /* #/explorer + #/explorer/:tab (ref order + feeds extra; unknown tab
   * falls back to Blocks with a note, never blank). Shell: search box,
   * tabs, head strip, tab body, pending inline-object panel. Tab bodies
   * delegate to ExplorerBlocks / ExplorerAssets / ExplorerTabs (lazy
   * globals). */
  function renderExplorer(root, tab) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    var want = (typeof tab === "string" && TABS.indexOf(tab) !== -1) ? tab : "blocks";
    var noted = (typeof tab === "string" && tab && TABS.indexOf(tab) === -1) ? tab : null;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer ||
        typeof Format === "undefined" || !Format) {
      showError(doc, wrap, t("explorer.backend_missing", "Explorer backend missing: js/explorer.js or js/format.js failed to load."));
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderExplorer(root, want); })) return;

    wrap.appendChild(shellTitle(doc));
    if (noted) wrap.appendChild(DOM.el(doc, "p", t("explorer.unknown_tab_prefix", "Unknown tab “") + noted + t("explorer.unknown_tab_suffix", "” — showing Blockchain."), "muted"));

    /* Search: single box, 1.x.y / account / symbol / tx hash,
     * keyboard-submit. Typeahead (plain literals only, no new t() keys —
     * check_i18n stays green): account names via Explorer.suggestAccounts
     * (lookup_accounts, #4 database_api.hpp:357) + asset symbols via
     * Explorer.suggestAssets (list_assets prefix paging,
     * database_api.hpp:435 — there is NO lookup_assets method, #4 wins).
     * Numeric input jumps straight to #/block/:height; object ids ride the
     * existing routeObject dispatch; 40-hex tx hashes resolve via
     * Explorer.resolveTxHash (ES block_data.trx_id context first, WS
     * location-less fallback — never a guessed block). Suggestions fail
     * open (offline/error clears the listbox; submit still works). Listbox
     * is buttons only: tap + arrow-key + Enter/Escape, textContent-only,
     * no hover UI. */
    var form = doc.createElement("form");
    form.className = "xplore-search";
    var input = doc.createElement("input");
    input.type = "search";
    input.setAttribute("placeholder", t("explorer.search_ph", "Search: 1.x.y, account, or asset symbol"));
    input.setAttribute("aria-label", t("explorer.search_aria", "Search blocks, accounts, assets"));
    input.setAttribute("autocomplete", "off");
    touchable(input);
    input.style.minWidth = "220px";
    form.appendChild(input);
    var go = touchable(DOM.el(doc, "button", t("explorer.search", "Search")));
    go.type = "submit";
    form.appendChild(go);
    var msg = DOM.el(doc, "div", "", "error");
    msg.setAttribute("aria-live", "polite");
    wrap.appendChild(form);
    var suggestBox = DOM.el(doc, "div", null, "xplore-suggest");
    suggestBox.setAttribute("role", "listbox");
    suggestBox.setAttribute("aria-label", t("explorer.search_suggestions_aria", "Search suggestions"));
    wrap.appendChild(suggestBox);
    wrap.appendChild(msg);
    /* Hash-path result host (txhash submit only): the WS location-less panel
     * and the keyed not-found notice paint here, never in msg (msg stays
     * the text-search error slot). Cleared on every submit. */
    var hashBox = DOM.el(doc, "div", null, "xplore-hash");
    hashBox.setAttribute("aria-live", "polite");
    wrap.appendChild(hashBox);
    /* Clear the hash-path host (never throws — a detached host is a no-op). */
    function clearHashBox() {
      try { DOM.clear(hashBox); } catch (e) { /* host gone */ }
    }
    var sugTimer = null, sugItems = [], sugActive = -1;
    /* Clear the suggestion listbox (timer-safe, never throws). */
    function clearSuggest() {
      sugItems = [];
      sugActive = -1;
      try { DOM.clear(suggestBox); } catch (e) { /* gone */ }
    }
    /* Paint one suggestion button (textContent only, touch-sized). */
    function suggestBtn(label, hash) {
      var b = touchable(DOM.el(doc, "button", label, "xplore-suggest-row"));
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", "false");
      b.addEventListener("click", function () {
        clearSuggest();
        if (typeof location !== "undefined") location.hash = hash;
      });
      return b;
    }
    /* Mark the active keyboard row (aria-selected follows focus). */
    function paintSuggestActive() {
      for (var si = 0; si < sugItems.length; si++) {
        try { sugItems[si].setAttribute("aria-selected", si === sugActive ? "true" : "false"); } catch (e) { /* row stands */ }
      }
    }
    /* Debounced typeahead: text-kind input of length ≥1 fires both
     * suggesters in parallel; anything else clears. Gen-guarded. */
    function runSuggest() {
      if (myGen !== gen) return;
      var q = input.value;
      var cls = { kind: "text", text: (typeof q === "string" ? q.trim() : "") };
      try {
        if (typeof Explorer !== "undefined" && Explorer &&
            typeof Explorer.classifySearchInput === "function") {
          cls = Explorer.classifySearchInput(q);
        }
      } catch (e) { /* text path below */ }
      if (cls.kind !== "text" || !cls.text) { clearSuggest(); return; }
      if (typeof Explorer === "undefined" || !Explorer ||
          typeof Explorer.suggestAccounts !== "function" ||
          typeof Explorer.suggestAssets !== "function") return;
      var snap = myGen;
      Promise.all([
        Explorer.suggestAccounts(cls.text, 5).catch(function () { return []; }),
        Explorer.suggestAssets(cls.text, 5).catch(function () { return []; })
      ]).then(function (pair) {
        if (snap !== gen) return;
        if (input.value !== q) return;
        clearSuggest();
        var accs = pair[0] || [], ass = pair[1] || [];
        accs.slice(0, 5).forEach(function (a) {
          if (!a || typeof a.name !== "string") return;
          sugItems.push(suggestBtn(a.name + " (" + a.id + ")",
            "#/account/" + encodeURIComponent(a.name)));
        });
        ass.slice(0, 5).forEach(function (a) {
          if (!a || typeof a.symbol !== "string") return;
          sugItems.push(suggestBtn(a.symbol + " (" + a.id + ")",
            "#/asset/" + encodeURIComponent(a.symbol)));
        });
        sugItems = sugItems.slice(0, 8);
        sugItems.forEach(function (b) { suggestBox.appendChild(b); });
        paintSuggestActive();
      });
    }
    input.addEventListener("input", function () {
      try { if (sugTimer !== null) clearTimeout(sugTimer); } catch (e) { /* fallen */ }
      sugTimer = setTimeout(runSuggest, 200);
    });
    input.addEventListener("keydown", function (e) {
      if (!e || !sugItems.length) {
        if (e && e.key === "Escape") clearSuggest();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        sugActive = (sugActive + 1) % sugItems.length;
        paintSuggestActive();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        sugActive = (sugActive - 1 + sugItems.length) % sugItems.length;
        paintSuggestActive();
      } else if (e.key === "Enter" && sugActive >= 0 && sugActive < sugItems.length) {
        e.preventDefault();
        try { sugItems[sugActive].click(); } catch (err) { /* button stands */ }
      } else if (e.key === "Escape") {
        clearSuggest();
      }
    });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      msg.textContent = "";
      clearSuggest();
      clearHashBox();
      var q = input.value;
      var cls = { kind: "text" };
      try {
        if (typeof Explorer !== "undefined" && Explorer &&
            typeof Explorer.classifySearchInput === "function") {
          cls = Explorer.classifySearchInput(q);
        }
      } catch (e) { cls = { kind: "text" }; }
      if (cls.kind === "empty") {
        msg.textContent = t("explorer.search_empty_hint", "Type a block number, object id, account, or asset symbol.");
        return;
      }
      if (cls.kind === "block") {
        if (typeof location !== "undefined") location.hash = "#/block/" + cls.height;
        return;
      }
      if (cls.kind === "txhash") {
        /* Phase 6.1 hash path (phase-06-es-design.md #1): ES block context
         * -> #/block/:h/:ix (ExplorerBlocks.renderTx reused unchanged, block
         * link included); WS location-less tx -> inline panel WITHOUT a
         * block link (never guessed); neither -> keyed notice + Settings
         * link. resolveTxHash never rejects; the trailing catch is
         * belt-and-braces. Gen-guarded like the text path below. */
        go.disabled = true;
        showStatus(doc, hashBox, t("explorer.loading_tx", "Loading transaction…"));
        Explorer.resolveTxHash(cls.id).then(function (res) {
          if (myGen !== gen) return;
          go.disabled = false;
          if (res && res.status === "block") {
            if (typeof location !== "undefined") {
              location.hash = "#/block/" + res.block + "/" + res.index;
            }
            return;
          }
          if (res && res.status === "tx" && res.tx) {
            paintTxHash(doc, hashBox, myGen, root, want, res.hash, res.tx);
            return;
          }
          if (res && res.status === "offline") {
            clearHashBox();
            showError(doc, hashBox, new Error("not-connected"),
              t("explorer.offline_short", "Network unavailable."));
            return;
          }
          clearHashBox();
          var box = DOM.el(doc, "div", null, "error");
          box.setAttribute("aria-live", "polite");
          box.textContent = t("explorer.tx_not_found",
            "Transaction not found on this node or the community index.");
          hashBox.appendChild(box);
          try {
            if (typeof HistoryNotice !== "undefined" && HistoryNotice &&
                typeof HistoryNotice.actionLink === "function") {
              var link = HistoryNotice.actionLink(doc, t, "settings");
              if (link) hashBox.appendChild(link);
            }
          } catch (e2) { /* notice stands without the link */ }
        }).catch(function (e) {
          if (myGen !== gen) return;
          go.disabled = false;
          clearHashBox();
          showError(doc, hashBox, e, t("common.unexpected_error", "Unexpected error"));
        });
        return;
      }
      go.disabled = true;
      Explorer.search(q).then(function (res) {
        if (myGen !== gen) return;
        go.disabled = false;
        if (res.kind === "account") {
          if (typeof location !== "undefined") location.hash = "#/account/" + res.name;
        } else if (res.kind === "asset") {
          if (typeof location !== "undefined") location.hash = "#/asset/" + res.symbol;
        } else {
          routeObject(res, root, want);
        }
      }).catch(function (e) {
        if (myGen !== gen) return;
        go.disabled = false;
        showError(doc, msg, e, (t("explorer.not_found", "Nothing found for that search.") + " Check the id shape (1.x.x) or name spelling and retry."));
      });
    });

    /* Tabs: real buttons (keyboard + touch, never hover-only). */
    var bar = DOM.el(doc, "div", null, "xplore-tabs");
    bar.setAttribute("role", "tablist");
    TABS.forEach(function (t) {
      var b = touchable(DOM.el(doc, "button", tabLabel(t),
        want === t ? "xplore-tab active" : "xplore-tab"));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", want === t ? "true" : "false");
      b.addEventListener("click", function () {
        pendingObject = null;
        if (typeof location !== "undefined") location.hash = "#/explorer/" + t;
        else renderExplorer(root, t);
      });
      bar.appendChild(b);
    });
    wrap.appendChild(bar);

    var headBox = DOM.el(doc, "div", null, "xplore-head");
    wrap.appendChild(headBox);
    loadHeadStrip(doc, headBox, myGen);

    /* Inline deep-link panel (exotic 1.x.y results land here). */
    if (pendingObject) {
      var id = pendingObject;
      pendingObject = null;
      var panel = DOM.el(doc, "div", null, "xplore-object");
      wrap.appendChild(panel);
      showStatus(doc, panel, t("explorer.loading_prefix", "Loading ") + id + "…");
      Explorer.resolveObject(id).then(function (entry) {
        if (myGen !== gen) return;
        DOM.clear(panel);
        if (typeof ExplorerAssets === "undefined" || !ExplorerAssets ||
            typeof ExplorerAssets.renderObjectPanel !== "function") {
          showError(doc, panel, t("explorer.object_missing", "Explorer object view missing: js/explorer-assets.js failed to load."));
          return;
        }
        panel.appendChild(ExplorerAssets.renderObjectPanel(doc, entry, { gen: myGen, root: root, tab: want }));
      }).catch(function (e) {
        if (myGen !== gen) return;
        DOM.clear(panel);
        showError(doc, panel, e, t("explorer.object_failed_prefix", "Could not load ") + id + ".");
      });
    }

    var body = DOM.el(doc, "div", null, "xplore-body");
    wrap.appendChild(body);
    if (want === "blocks") {
      if (typeof ExplorerBlocks !== "undefined" && ExplorerBlocks &&
          typeof ExplorerBlocks.blocksTab === "function") {
        ExplorerBlocks.blocksTab(doc, body, root, myGen, null);
      } else {
        showError(doc, body, t("explorer.blocks_missing", "Explorer blocks view missing: js/explorer-blocks.js failed to load."));
      }
    } else if (want === "assets") {
      if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
          typeof ExplorerAssets.assetsTab === "function") {
        ExplorerAssets.assetsTab(doc, body, root, myGen, "", []);
      } else {
        showError(doc, body, t("explorer.assets_missing", "Explorer assets view missing: js/explorer-assets.js failed to load."));
      }
    } else if (want === "feeds") {
      if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
          typeof ExplorerAssets.feedsTab === "function") {
        ExplorerAssets.feedsTab(doc, body, root, myGen);
      } else {
        showError(doc, body, t("explorer.feeds_missing", "Explorer feeds view missing: js/explorer-assets.js failed to load."));
      }
    } else {
      /* Ref-parity tabs (ExplorerTabs owns bodies; missing file -> honest
       * panel, never blank). live() closes over the shell gen counter. */
      if (typeof ExplorerTabs === "undefined" || !ExplorerTabs) {
        showError(doc, body, t("explorer.tabs_missing", "Explorer tabs view missing: js/explorer-tabs.js failed to load."));
        return;
      }
      var fns = {
        pools: "poolsTab", accounts: "accountsTab", witnesses: "witnessesTab",
        committee: "committeeTab", markets: "marketsTab", fees: "feesTab"
      };
      var fn = fns[want];
      if (typeof fn === "string" && typeof ExplorerTabs[fn] === "function") {
        try {
          ExplorerTabs[fn](doc, body, function () { return myGen === gen; });
        } catch (e) {
          showError(doc, body, e, t("common.unexpected_error", "Unexpected error"));
        }
      } else {
        showError(doc, body, t("common.unexpected_error", "Unexpected error"));
      }
    }
  }

  /* Location-less tx panel (hash path only): the WS fallback returns the
   * tx WITHOUT block coords (chain design, database_api.hpp:200), so this
   * panel carries NO block link — only the existing unknown-block honesty
   * note (never a guessed deep link). Op rows reuse ExplorerAssets.opSection
   * via the same lazy-global guard explorer-blocks.js uses; signatures reuse
   * the existing prefix key. Params: doc, host, myGen, root, tab, hash,
   * tx (Explorer.recentTxById shape). Never throws. */
  function paintTxHash(doc, host, myGen, root, tab, hash, tx) {
    try { DOM.clear(host); } catch (e) { return; }
    try {
      host.appendChild(DOM.el(doc, "h2",
        t("explorer.tx_title_prefix", "Transaction ") + hash));
      host.appendChild(DOM.el(doc, "p", t("explorer.unknown_block", "Unknown block."), "muted"));
      var ctx = { gen: myGen, root: root, tab: tab };
      var ops = (tx && Array.isArray(tx.ops)) ? tx.ops : [];
      if (ops.length === 0) {
        host.appendChild(DOM.el(doc, "p", t("explorer.no_ops", "No operations in this transaction.") +
          t("explorer.ops_hint", " Nothing was enclosed — valid, not an error."), "muted"));
      }
      ops.forEach(function (op, k) {
        var label = t("explorer.op_prefix", "Op ") + k;
        try {
          if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
              typeof ExplorerAssets.opSection === "function") {
            host.appendChild(ExplorerAssets.opSection(doc, op, ctx, label));
            return;
          }
        } catch (e) { /* fallback below */ }
        host.appendChild(DOM.el(doc, "p",
          t("explorer.op_unavailable", "Operation view unavailable."), "muted"));
      });
      var sigs = (tx && Array.isArray(tx.signatures)) ? tx.signatures : [];
      if (sigs.length > 0) {
        host.appendChild(DOM.el(doc, "h2",
          t("explorer.signatures_prefix", "Signatures (") + sigs.length + ")"));
        var ul = doc.createElement("ul");
        sigs.forEach(function (sig) {
          ul.appendChild(DOM.el(doc, "li", String(sig), "muted"));
        });
        host.appendChild(ul);
      }
    } catch (e) {
      try { showError(doc, host, e, t("common.unexpected_error", "Unexpected error")); }
      catch (e2) { /* panel stands */ }
    }
  }

  /* Search/object dispatch shared by the search box and objectLink: 1.2.x
   * -> #/account/:name, 1.3.x -> #/asset/:symbol, 1.11.x with block coords
   * -> owning #/block/:height/:txIndex, everything else -> inline panel. */
  function routeObject(entry, root, tab) {
    if (entry.space === 1 && entry.type === 2 && entry.object && entry.object.name) {
      if (typeof location !== "undefined") location.hash = "#/account/" + entry.object.name;
      return;
    }
    if (entry.space === 1 && entry.type === 3 && entry.object && entry.object.symbol) {
      if (typeof location !== "undefined") location.hash = "#/asset/" + entry.object.symbol;
      return;
    }
    if (entry.space === 1 && entry.type === 11 && entry.object &&
        typeof entry.object.block_num === "number" && typeof entry.object.trx_in_block === "number") {
      if (typeof location !== "undefined") {
        location.hash = "#/block/" + entry.object.block_num + "/" + entry.object.trx_in_block;
      }
      return;
    }
    pendingObject = entry.id;
    pendingTab = tab;
    renderExplorer(root, tab);
  }

  /* Route entry points (router.js calls these — same names as before the
   * split): thin delegation to the owning file, so the router is untouched.
   * Missing-file fallbacks paint honest panels, never blank. */
  function renderBlock(root, height) {
    if (typeof ExplorerBlocks !== "undefined" && ExplorerBlocks &&
        typeof ExplorerBlocks.renderBlock === "function") {
      ExplorerBlocks.renderBlock(root, height);
      return;
    }
    missingView(root, "Block", "js/views/explorer-blocks.js");
  }

  function renderTx(root, height, txIndex) {
    if (typeof ExplorerBlocks !== "undefined" && ExplorerBlocks &&
        typeof ExplorerBlocks.renderTx === "function") {
      ExplorerBlocks.renderTx(root, height, txIndex);
      return;
    }
    missingView(root, "Transaction", "js/views/explorer-blocks.js");
  }

  function renderAsset(root, symbol) {
    if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
        typeof ExplorerAssets.renderAsset === "function") {
      ExplorerAssets.renderAsset(root, symbol);
      return;
    }
    missingView(root, "Asset", "js/views/explorer-assets.js");
  }

  var api = {
    renderExplorer: renderExplorer,
    renderBlock: renderBlock,
    renderTx: renderTx,
    renderAsset: renderAsset,
    _bumpGen: bumpGen,
    _isCurrent: isCurrent,
    _waitForOpen: waitForOpen,
    _setPending: setPending
  };
  /* Display-math helpers moved verbatim to explorer-assets.js; re-export the
   * live reference so headless testers see identical functions. */
  if (typeof ExplorerAssets !== "undefined" && ExplorerAssets && ExplorerAssets._test) {
    api._test = ExplorerAssets._test;
  } else {
    api._test = {
      pctHundredths: function () { return ""; },
      ratio1000: function () { return ""; },
      lifetimeText: function (r) { return String(r); }
    };
  }
  return api;
})();

if (typeof module !== "undefined") { module.exports = ExplorerUI; }
