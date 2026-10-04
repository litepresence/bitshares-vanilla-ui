/* ExplorerBlocksDetail: block + transaction entity views for the explorer.
 * Owns: #/block/:height (header, prev/next nav, tx lines) and
 *   #/block/:height/:txIndex (op rows via the shared op renderer).
 * Consumes: Explorer.block/head/tx (read-only, via global), ExplorerAssets
 *   .opSection/accountLink (via the local delegate copies below),
 *   ExplorerUI._bumpGen/_isCurrent/_waitForOpen (gen counter + connect gate
 *   via the local copies below), DOM/touchable (script-tag globals).
 * Globals/side effects: DOM under the given root only; global
 *   ExplorerBlocksDetail only. No chain writes, no signing.
 * Split from: vanilla/js/views/explorer-blocks.js (mechanical move, zero
 *   behavior change — bodies byte-identical, tiny t/DOM/delegate copies
 *   follow the file's own per-file verbatim-copy convention; reached via
 *   the ExplorerBlocks facade so every caller works unchanged).
 * Created by: building-vanilla-slices skill, view-split task.
 */
var ExplorerBlocksDetail = (function () {
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

  /* Account-id shape (data copy of the explorer-ui.js regex — slice-3
   * account route target; logic lives in explorer-assets.js). */
  var ACCT_RE = /^1\.2\.\d+$/;

  /* Local fallback counter, used ONLY when explorer-ui.js failed to load
   * (impossible in the shipped app — script tags are load-bearing). In
   * practice every bump/check below reaches the shell's single counter, so
   * stale async work bails across routes instead of touching detached DOM. */
  var localGen = 0;

  /* Single generation counter (shell-owned): every route entry bumps it;
   * async continuations bail when their generation no longer matches. */
  function bumpGen() {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._bumpGen === "function") return ExplorerUI._bumpGen();
    localGen += 1;
    return localGen;
  }

  /* True while myGen is still the latest route entry. */
  function isCurrent(myGen) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._isCurrent === "function") return ExplorerUI._isCurrent(myGen);
    return myGen === localGen;
  }

  /* Connect gate (canonical implementation in explorer-ui.js): when the
   * socket is cold it paints the connecting/offline panel and returns true
   * (caller must stop). Falls through when the shell is missing — chain
   * calls then fail into the honest error panels below, never blank. */
  function waitForOpen(doc, wrap, root, myGen, rerun) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._waitForOpen === "function") {
      return ExplorerUI._waitForOpen(doc, wrap, root, myGen, rerun);
    }
    return false;
  }

  /* Op section renderer (canonical implementation in explorer-assets.js,
   * the generic object-panel owner). Falls back to a muted note — never
   * blank, never raw JSON. */
  function opSection(doc, op, ctx, label) {
    if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
        typeof ExplorerAssets.opSection === "function") {
      return ExplorerAssets.opSection(doc, op, ctx, label);
    }
    return DOM.el(doc, "p", t("explorer.op_unavailable", "Operation view unavailable."), "muted");
  }

  /* Account-id link (canonical implementation in explorer-assets.js). Falls
   * back to plain text. */
  function accountLink(doc, id, myGen) {
    if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
        typeof ExplorerAssets.accountLink === "function") {
      return ExplorerAssets.accountLink(doc, id, myGen);
    }
    return DOM.el(doc, "span", id);
  }

  /* No local el — use DOM.el */

  /* Touch target floor (principle #7): interactive elements are >=44px in
   * at least one dimension. */
/* clearRoot removed — use DOM.clear */

  /* Wide (viewport-gaps fix 2026-09-28): full-bleed stacked grid
   * ≥1200px; children span full width via app.css .wide contract. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  function anchor(doc, text, href) {
    var a = DOM.el(doc, "a", text);
    a.setAttribute("href", href);
    touchable(a);
    a.style.display = "inline-block";
    return a;
  }

  /* Copy-share-link row for an entity view (blocks, txs — account/asset
   * views carry their own verbatim copy in account-ui.js /
   * explorer-assets.js, same per-file convention as the el/touchable
   * copies above). Hash deep links the router already resolves (router.js:
   * #/block/:height, #/block/:height/:txIndex). Clipboard API with an
   * execCommand textarea fallback (file:// + older browsers); the result
   * reads inline via aria-live, never a dialog. textContent only.
   * Params: doc, hash ("#/…"). Returns the row div. Never throws. */
  function shareRow(doc, hash) {
    var row = DOM.el(doc, "div", null, "xplore-share");
    var btn = touchable(DOM.el(doc, "button", "Copy link", "subtle-btn"));
    btn.type = "button";
    var note = DOM.el(doc, "span", "", "muted");
    note.setAttribute("aria-live", "polite");
    row.appendChild(btn);
    row.appendChild(DOM.el(doc, "span", " "));
    row.appendChild(note);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      note.textContent = t("misc.copying", "Copying…");
      var url = "";
      try {
        if (typeof Explorer !== "undefined" && Explorer &&
            typeof Explorer.currentShareUrl === "function") {
          url = Explorer.currentShareUrl(hash);
        } else if (typeof location !== "undefined" && location.href) {
          url = location.href.split("#")[0] + hash;
        } else {
          url = hash;
        }
      } catch (e) { url = hash; }
      function done(ok) {
        btn.disabled = false;
        note.textContent = ok ? "Copied" : "Copy failed — long-press the address bar to copy";
      }
      function fallback() {
        try {
          var ta = doc.createElement("textarea");
          ta.value = url;
          doc.body.appendChild(ta);
          ta.select();
          var ok = false;
          try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
          try { ta.parentNode.removeChild(ta); } catch (e2) { /* gone */ }
          done(!!ok);
        } catch (e) { done(false); }
      }
      try {
        if (typeof navigator !== "undefined" && navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(url).then(function () { done(true); }, function () { fallback(); });
        } else {
          fallback();
        }
      } catch (e) { fallback(); }
    });
    return row;
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

  /* Witness cell: header/block witness values are 1.6.x witness ids — link
   * to the owning account (#/account/:name) once resolved, else raw text. */
  function witnessCell(doc, witnessId, myGen) {
    if (!witnessId) return "—";
    if (ACCT_RE.test(witnessId)) return accountLink(doc, witnessId, myGen);
    var s = DOM.el(doc, "span", witnessId);
    Explorer.resolveObject(witnessId).then(function (entry) {
      if (!isCurrent(myGen)) return;
      var obj = entry.object || {};
      var owner = obj.witness_account || obj.name;
      if (!owner || typeof Account === "undefined") return;
      Account.resolve(owner).then(function (a) {
        if (!isCurrent(myGen)) return;
        var link = anchor(doc, a.name, "#/account/" + a.name);
        link.title = witnessId;
        s.parentNode.replaceChild(link, s);
      }).catch(function () { /* raw id stands */ });
    }).catch(function () { /* raw id stands */ });
    return s;
  }

  /* Chain ISO timestamp -> localized full date + time (original Block.jsx
   * FormattedDate format="full" concept: full date, never the raw ISO on
   * screen). Returns display text; the caller keeps the raw ISO in the
   * title. Unparseable stamps fall back to the raw string (never blank).
   * Plain Intl only — no new i18n keys per punchlist rules. */
  function fmtFullDate(stamp) {
    var s = String(stamp || "—");
    var ms = NaN;
    try { ms = new Date(s).getTime(); } catch (e) { ms = NaN; }
    if (!isFinite(ms)) {
      try { ms = new Date(s + "Z").getTime(); } catch (e2) { ms = NaN; }
    }
    if (!isFinite(ms)) return s;
    try {
      return new Date(ms).toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });
    } catch (e) { /* older ICU without dateStyle/timeStyle: fall through */ }
    try { return new Date(ms).toLocaleString(); } catch (e2) { return s; }
  }

  /* #/block/:height: header (height, time, witness, irreversible badge) +
   * tx list (each -> #/block/:height/:txIndex with op-count + first-op
   * name chips). */
  function renderBlock(root, height) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = bumpGen();
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer) {
      showError(doc, wrap, t("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load."));
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderBlock(root, height); })) return;
    var h = parseInt(height, 10);
    if (!(h >= 1)) {
      wrap.appendChild(DOM.pageHead(doc, t("explorer.block_title", "Block"), "insight"));
      showError(doc, wrap, new Error("unknown-block"), t("explorer.unknown_block", "Unknown block."));
      return;
    }
    wrap.appendChild(DOM.pageHead(doc, t("explorer.block_prefix", "Block #") + h, "insight"));
    /* Block-jump input (original Block.jsx toggleInput/_onKeyDown concept):
     * height -> #/block/N. Plain literals only (no new i18n keys). Invalid
     * input flags aria-invalid instead of navigating anywhere. Built by a
     * function because the success/error paths below clear the wrap and must
     * re-add it (otherwise the pre-load row is wiped on paint). Batch-3 i18n: keyed. */
    function buildJump() {
      var jumpRow = DOM.el(doc, "div", null, "xplore-jump");
      jumpRow.appendChild(DOM.el(doc, "span", t("explorer.go_to_block_prefix", "Go to block: ")));
      var jumpInput = doc.createElement("input");
      jumpInput.type = "number";
      jumpInput.min = "1";
      jumpInput.step = "1";
      jumpInput.setAttribute("inputmode", "numeric");
      jumpInput.setAttribute("placeholder", t("explorer.height_ph", "height"));
      jumpInput.setAttribute("aria-label", t("explorer.block_height_aria", "Block height"));
      touchable(jumpInput);
      var jumpBtn = touchable(DOM.el(doc, "button", t("explorer.go", "Go")));
      jumpBtn.type = "button";
      jumpRow.appendChild(jumpInput);
      jumpRow.appendChild(jumpBtn);
      jumpBtn.addEventListener("click", function doJump() {
        var v = parseInt(jumpInput.value, 10);
        if (v >= 1) {
          try { location.hash = "#/block/" + v; return; } catch (e) { /* flag below */ }
        }
        jumpInput.setAttribute("aria-invalid", "true");
      });
      jumpInput.addEventListener("keydown", function (e) {
        if (e && e.key === "Enter") jumpBtn.click();
      });
      return jumpRow;
    }
    wrap.appendChild(buildJump());
    showStatus(doc, wrap, t("explorer.loading_block", "Loading block…"));
    Promise.all([Explorer.block(h), Explorer.head().catch(function () { return null; })])
      .then(function (pair) {
        if (!isCurrent(myGen)) return;
        var b = pair[0], head = pair[1];
        DOM.clear(wrap);
        wrap.appendChild(DOM.pageHead(doc, t("explorer.block_prefix", "Block #") + b.height, "insight"));
        wrap.appendChild(buildJump());
        /* Prev/next arrows (original Block.jsx _previousBlock/_nextBlock
         * concept: prev = height - 1, next = height + 1 clamped at head).
         * The height-1 link is the prev-minimum the punchlist requires (a
         * parent-hash row would also satisfy it; the backend strips that
         * field, so height navigation stands). A next past head renders an
         * honest muted note instead of a dead link. Batch-3 i18n: keyed. */
        var nav = DOM.el(doc, "div", null, "xplore-blocknav");
        if (b.height > 1) {
          nav.appendChild(anchor(doc, t("explorer.prev_block", "← Prev block"), "#/block/" + (b.height - 1)));
        } else {
          nav.appendChild(DOM.el(doc, "span", t("explorer.genesis_first_block", "← Genesis (first block)"), "muted"));
        }
        nav.appendChild(DOM.el(doc, "span", " "));
        var headNum = (head && typeof head.head_block_number === "number") ? head.head_block_number : null;
        if (headNum !== null && b.height >= headNum) {
          nav.appendChild(DOM.el(doc, "span", t("explorer.next_no_newer_block", "Next → (no newer block yet)"), "muted"));
        } else {
          var nx = anchor(doc, t("explorer.next", "Next →"), "#/block/" + (b.height + 1));
          if (headNum !== null) nx.title = t("explorer.head_prefix", "Head #") + headNum;
          nav.appendChild(nx);
        }
        wrap.appendChild(nav);
        wrap.appendChild(shareRow(doc, "#/block/" + b.height));
        var dl = DOM.el(doc, "dl", null, "xplore-fields");
        function row(t, node) {
          dl.appendChild(DOM.el(doc, "dt", t));
          var dd = doc.createElement("dd");
          if (typeof node === "string") dd.textContent = node;
          else if (node) dd.appendChild(node);
          dl.appendChild(dd);
        }
        /* Localized full date (original FormattedDate format="full"
         * concept): human string on screen, raw ISO kept in the title. */
        var timeSpan = DOM.el(doc, "span", fmtFullDate(b.timestamp || "—"));
        try { timeSpan.title = String(b.timestamp || ""); } catch (e) { /* text stands */ }
        row(t("explorer.time_row", "Time"), timeSpan);
        row(t("explorer.witness_row", "Witness"), witnessCell(doc, b.witness_account_id, myGen));
        row(t("explorer.txs_row", "Transactions"), String(b.tx_count));
        if (head && typeof head.last_irreversible_block_num === "number") {
          row(t("explorer.irreversible_row", "Irreversible"), b.height <= head.last_irreversible_block_num ? t("explorer.yes", "yes") : t("explorer.no_recent", "no (recent)"));
        }
        wrap.appendChild(dl);
        /* Return-to-top link (original Block.jsx scrollToTop concept): plain
         * button, smooth scroll with instant fallback. Batch-3 i18n: keyed. */
        var topBtn = touchable(DOM.el(doc, "button", t("explorer.return_to_top", "Return to top")));
        topBtn.type = "button";
        topBtn.addEventListener("click", function () {
          try {
            if (typeof window !== "undefined" && window.scrollTo) {
              window.scrollTo({ top: 0, behavior: "smooth" });
            } else if (doc.documentElement) {
              doc.documentElement.scrollTop = 0;
            }
          } catch (e) {
            try { window.scrollTo(0, 0); } catch (e2) { /* stood */ }
          }
        });
        if (b.transactions.length === 0) {
          wrap.appendChild(DOM.el(doc, "p", t("explorer.no_txs", "No transactions in this block.") + t("explorer.txs_hint", " Empty blocks carry no transactions — open another block from Recent blocks."), "muted"));
          wrap.appendChild(topBtn);
          return;
        }
        var ctx = { gen: myGen, root: root, tab: "blocks" };
        b.transactions.forEach(function (tx) {
          var line = DOM.el(doc, "div", null, "xplore-txline");
          line.appendChild(anchor(doc, t("explorer.tx_prefix", "Tx ") + tx.index + " (" + tx.op_count + " op" +
            (tx.op_count === 1 ? "" : "s") + ")", "#/block/" + b.height + "/" + tx.index));
          var chips = tx.ops.map(function (o) {
            return o.type_name + (o.virtual ? " (virtual)" : "");
          }).join(", ");
          line.appendChild(DOM.el(doc, "span", chips ? " — " + chips : "", "muted"));
          wrap.appendChild(line);
        });
        wrap.appendChild(topBtn);
        void ctx;
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        DOM.clear(wrap);
        wrap.appendChild(DOM.pageHead(doc, t("explorer.block_prefix", "Block #") + h, "insight"));
        wrap.appendChild(buildJump());
        showError(doc, wrap, e, t("explorer.unknown_block", "Unknown block."));
      });
  }

  /* #/block/:height/:txIndex: op rows with NAMED fields (never raw JSON). */
  function renderTx(root, height, txIndex) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = bumpGen();
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer) {
      showError(doc, wrap, t("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load."));
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderTx(root, height, txIndex); })) return;
    var h = parseInt(height, 10), ix = parseInt(txIndex, 10);
    wrap.appendChild(DOM.pageHead(doc, t("explorer.tx_title_prefix", "Transaction ") + h + " / " + txIndex, "insight"));
    if (!(h >= 1) || !(ix >= 0)) {
      showError(doc, wrap, new Error("unknown-tx"), t("explorer.unknown_tx", "Unknown transaction."));
      return;
    }
    showStatus(doc, wrap, t("explorer.loading_tx", "Loading transaction…"));
    Explorer.tx(h, ix).then(function (tx) {
      if (!isCurrent(myGen)) return;
      DOM.clear(wrap);
      wrap.appendChild(DOM.pageHead(doc, t("explorer.tx_title_prefix", "Transaction ") + tx.block + " / " + tx.index, "insight"));
      wrap.appendChild(anchor(doc, t("explorer.back_to_block_prefix", "← Block #") + tx.block, "#/block/" + tx.block));
      wrap.appendChild(shareRow(doc, "#/block/" + tx.block + "/" + tx.index));
      var ctx = { gen: myGen, root: root, tab: "blocks" };
      if (tx.ops.length === 0) wrap.appendChild(DOM.el(doc, "p", t("explorer.no_ops", "No operations in this transaction.") + t("explorer.ops_hint", " Nothing was enclosed — valid, not an error."), "muted"));
      tx.ops.forEach(function (op, k) {
        wrap.appendChild(opSection(doc, op, ctx, t("explorer.op_prefix", "Op ") + k));
      });
      if (tx.signatures.length > 0) {
        wrap.appendChild(DOM.el(doc, "h2", t("explorer.signatures_prefix", "Signatures (") + tx.signatures.length + ")"));
        var ul = doc.createElement("ul");
        tx.signatures.forEach(function (sig) {
          ul.appendChild(DOM.el(doc, "li", String(sig), "muted"));
        });
        wrap.appendChild(ul);
      }
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      DOM.clear(wrap);
      wrap.appendChild(DOM.pageHead(doc, t("explorer.tx_title_prefix", "Transaction ") + h + " / " + txIndex, "insight"));
      showError(doc, wrap, e, t("explorer.unknown_tx", "Unknown transaction."));
    });
  }

  return {
    renderBlock: renderBlock,
    renderTx: renderTx
  };
})();

if (typeof module !== "undefined") { module.exports = ExplorerBlocksDetail; }
