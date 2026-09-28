/* ExplorerUI: the explorer shell (search + tabs + deep-link dispatch).
 * Owns: DOM for #/explorer (+blocks|assets|feeds tabs), the global search
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
  var TABS = ["blocks", "assets", "feeds"];

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
    var box = el(doc, "div", null, "error");
    box.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message : String(e || fallback || t("explorer.unexpected", "Unexpected error"));
    if (msg.indexOf("unknown-block") !== -1) msg = t("explorer.unknown_block", "Unknown block.");
    else if (msg.indexOf("unknown-tx") !== -1) msg = t("explorer.unknown_tx", "Unknown transaction.");
    else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || t("explorer.unknown_asset", "Unknown asset.");
    else if (msg.indexOf("unknown-object") !== -1) msg = fallback || t("explorer.not_found", "Nothing found for that search.");
    else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = t("explorer.tx_expired", "Transaction hash lookup covers recent transactions only — this one is expired or unknown.");
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = t("explorer.offline", "Network unavailable. Check Settings → Nodes and retry.");
    }
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

  /* Wait-for-connection gate (slice-5 race repair precedent, same shape as
   * account-ui.js renderAccount): when the socket is cold, show a
   * connecting panel, re-run `rerun` once on open, and time out into an
   * offline panel with Retry. Returns true when the caller must stop
   * (waiting or timed-out UI already shown). Canonical implementation —
   * explorer-blocks.js / explorer-assets.js delegate here via _waitForOpen. */
  function waitForOpen(doc, wrap, root, myGen, rerun) {
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state === "open") return false;
    wrap.appendChild(el(doc, "h1", t("explorer.title", "Explorer")));
    wrap.appendChild(el(doc, "p", t("explorer.connecting", "Connecting to network…"), "muted"));
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
      clearRoot(root);
      var failed = makeWrap(doc, root);
      failed.appendChild(el(doc, "h1", t("explorer.title", "Explorer")));
      showError(doc, failed, new Error("not-connected"), t("explorer.offline_short", "Network unavailable."));
      var retry = touchable(el(doc, "button", t("explorer.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () { rerun(); });
      failed.appendChild(retry);
    }, CONNECT_TIMEOUT_MS);
    return true;
  }

  /* Head strip: "Head #N · time · irreversible #M". Heights are plain ints
   * (never money); time is the chain ISO string (already human). */
  function loadHeadStrip(doc, box, myGen) {
    Explorer.head().then(function (h) {
      if (myGen !== gen) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(el(doc, "p",
        t("explorer.head_prefix", "Head #") + h.head_block_number + " · " + h.head_block_time +
        t("explorer.head_lib", " · irreversible #") + h.last_irreversible_block_num, "muted"));
    }).catch(function () {
      if (myGen !== gen) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(el(doc, "p", t("explorer.head_unavailable", "Head block unavailable."), "muted"));
    });
  }

  /* Honest panel when a same-slice file failed to load (impossible in the
   * shipped app — script tags are load-bearing). */
  function missingView(root, title, file) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", title));
    showError(doc, wrap, t("explorer.view_missing_prefix", "Explorer view missing: ") + file + t("explorer.view_missing_suffix", " failed to load."));
  }

  /* #/explorer + #/explorer/:tab (blocks|assets|feeds; unknown tab falls
   * back to Blocks with a note, never blank). Shell: search box, tabs,
   * head strip, tab body, pending inline-object panel. Tab bodies delegate
   * to ExplorerBlocks / ExplorerAssets (lazy globals). */
  function renderExplorer(root, tab) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    var want = (typeof tab === "string" && TABS.indexOf(tab) !== -1) ? tab : "blocks";
    var noted = (typeof tab === "string" && tab && TABS.indexOf(tab) === -1) ? tab : null;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer ||
        typeof Format === "undefined" || !Format) {
      showError(doc, wrap, t("explorer.backend_missing", "Explorer backend missing: js/explorer.js or js/format.js failed to load."));
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderExplorer(root, want); })) return;

    wrap.appendChild(el(doc, "h1", t("explorer.title", "Explorer")));
    if (noted) wrap.appendChild(el(doc, "p", t("explorer.unknown_tab_prefix", "Unknown tab “") + noted + t("explorer.unknown_tab_suffix", "” — showing Blocks."), "muted"));

    /* Search: single box, 1.x.y / account / symbol, keyboard-submit. */
    var form = doc.createElement("form");
    form.className = "xplore-search";
    var input = doc.createElement("input");
    input.type = "search";
    input.setAttribute("placeholder", t("explorer.search_ph", "Search: 1.x.y, account, or asset symbol"));
    input.setAttribute("aria-label", t("explorer.search_aria", "Search blocks, accounts, assets"));
    touchable(input);
    input.style.minWidth = "220px";
    form.appendChild(input);
    var go = touchable(el(doc, "button", t("explorer.search", "Search")));
    go.type = "submit";
    form.appendChild(go);
    var msg = el(doc, "div", "", "error");
    msg.setAttribute("aria-live", "polite");
    wrap.appendChild(form);
    wrap.appendChild(msg);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      msg.textContent = "";
      var q = input.value;
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
        showError(doc, msg, e, t("explorer.not_found", "Nothing found for that search."));
      });
    });

    /* Tabs: real buttons (keyboard + touch, never hover-only). */
    var bar = el(doc, "div", null, "xplore-tabs");
    bar.setAttribute("role", "tablist");
    TABS.forEach(function (t) {
      var b = touchable(el(doc, "button", t.charAt(0).toUpperCase() + t.slice(1),
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

    var headBox = el(doc, "div", null, "xplore-head");
    wrap.appendChild(headBox);
    loadHeadStrip(doc, headBox, myGen);

    /* Inline deep-link panel (exotic 1.x.y results land here). */
    if (pendingObject) {
      var id = pendingObject;
      pendingObject = null;
      var panel = el(doc, "div", null, "xplore-object");
      wrap.appendChild(panel);
      showStatus(doc, panel, t("explorer.loading_prefix", "Loading ") + id + "…");
      Explorer.resolveObject(id).then(function (entry) {
        if (myGen !== gen) return;
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        if (typeof ExplorerAssets === "undefined" || !ExplorerAssets ||
            typeof ExplorerAssets.renderObjectPanel !== "function") {
          showError(doc, panel, t("explorer.object_missing", "Explorer object view missing: js/explorer-assets.js failed to load."));
          return;
        }
        panel.appendChild(ExplorerAssets.renderObjectPanel(doc, entry, { gen: myGen, root: root, tab: want }));
      }).catch(function (e) {
        if (myGen !== gen) return;
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        showError(doc, panel, e, t("explorer.object_failed_prefix", "Could not load ") + id + ".");
      });
    }

    var body = el(doc, "div", null, "xplore-body");
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
    } else {
      if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
          typeof ExplorerAssets.feedsTab === "function") {
        ExplorerAssets.feedsTab(doc, body, root, myGen);
      } else {
        showError(doc, body, t("explorer.feeds_missing", "Explorer feeds view missing: js/explorer-assets.js failed to load."));
      }
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
    missingView(root, "Block", "js/explorer-blocks.js");
  }

  function renderTx(root, height, txIndex) {
    if (typeof ExplorerBlocks !== "undefined" && ExplorerBlocks &&
        typeof ExplorerBlocks.renderTx === "function") {
      ExplorerBlocks.renderTx(root, height, txIndex);
      return;
    }
    missingView(root, "Transaction", "js/explorer-blocks.js");
  }

  function renderAsset(root, symbol) {
    if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
        typeof ExplorerAssets.renderAsset === "function") {
      ExplorerAssets.renderAsset(root, symbol);
      return;
    }
    missingView(root, "Asset", "js/explorer-assets.js");
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
