/* ExplorerBlocks: block + transaction views for the explorer.
 * Owns: the Blocks tab table (recent + Older paging), #/block/:height, and
 *   #/block/:height/:txIndex (op rows via the shared op renderer).
 * Consumes: Explorer.block/recentBlocks/tx/resolveObject (read-only, via
 *   global), Account.resolve (witness/account links), ExplorerAssets
 *   (opSection/accountLink — generic value rendering lives in
 *   explorer-assets.js), ExplorerUI._bumpGen/_isCurrent/_waitForOpen (the
 *   single generation counter + connect gate live in explorer-ui.js).
 * Globals/side effects: DOM under the given parent/root only; global
 *   ExplorerBlocks only. Tiny DOM helpers (el/touchable/clearRoot/makeWrap/
 *   anchor/showError/showStatus/scrollTable) are private verbatim copies of
 *   the explorer-ui.js originals (same per-file convention as the market-ui
 *   split) so moved bodies stay byte-identical; stateful shares (gen,
 *   connect gate, op rendering) delegate via lazy globals because this file
 *   loads BEFORE explorer-ui.js / explorer-assets.js (index.html order) and
 *   must not touch them at load time.
 * Created by: building-vanilla-slices skill, slice-09 repair (explorer-ui split).
 */
var ExplorerBlocks = (function () {
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


  var RECENT_N = 20; /* blocks per page */

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
    return el(doc, "p", t("explorer.op_unavailable", "Operation view unavailable."), "muted");
  }

  /* Account-id link (canonical implementation in explorer-assets.js). Falls
   * back to plain text. */
  function accountLink(doc, id, myGen) {
    if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
        typeof ExplorerAssets.accountLink === "function") {
      return ExplorerAssets.accountLink(doc, id, myGen);
    }
    return el(doc, "span", id);
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

  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);
    return wrap;
  }

  function anchor(doc, text, href) {
    var a = el(doc, "a", text);
    a.setAttribute("href", href);
    touchable(a);
    a.style.display = "inline-block";
    return a;
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

  /* Scrollable table shell (principle #7: dense tables scroll horizontally
   * on phones instead of squeezing; no new CSS — inline overflow only). */
  function scrollTable(doc, headers, rows) {
    var scroller = el(doc, "div", null, "xplore-scroll");
    scroller.style.overflowX = "auto";
    var table = doc.createElement("table");
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    headers.forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = doc.createElement("tbody");
    rows.forEach(function (cells) {
      var tr = doc.createElement("tr");
      cells.forEach(function (c) {
        var td = doc.createElement("td");
        if (typeof c === "string") td.textContent = c;
        else if (c) td.appendChild(c);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    scroller.appendChild(table);
    return scroller;
  }

  /* Witness cell: header/block witness values are 1.6.x witness ids — link
   * to the owning account (#/account/:name) once resolved, else raw text. */
  function witnessCell(doc, witnessId, myGen) {
    if (!witnessId) return "—";
    if (ACCT_RE.test(witnessId)) return accountLink(doc, witnessId, myGen);
    var s = el(doc, "span", witnessId);
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

  /* Blocks tab: recent-blocks table + "Older" paging by height decrement
   * (no infinite-scroll lib). Rows: height link, time, witness link, txs. */
  function blocksTab(doc, body, root, myGen, oldest) {
    showStatus(doc, body, t("explorer.loading_blocks", "Loading blocks…"));
    function rowsFor(top) {
      if (top === null || top === undefined) return Explorer.recentBlocks(RECENT_N);
      var heights = [];
      for (var h = top - 1; h > top - 1 - RECENT_N && h >= 1; h--) heights.push(h);
      return Promise.all(heights.map(function (hh) {
        return Explorer.block(hh).then(function (b) {
          return { height: b.height, timestamp: b.timestamp, witness: b.witness_account_id, txs: b.tx_count };
        }).catch(function () { return null; });
      })).then(function (rows) { return rows.filter(function (r) { return !!r; }); });
    }
    rowsFor(oldest).then(function (rows) {
      if (!isCurrent(myGen)) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      if (rows.length === 0) {
        body.appendChild(el(doc, "p", t("explorer.no_blocks", "No blocks found."), "muted"));
        return;
      }
      var tableRows = rows.map(function (r) {
        /* Recent path yields tx_count (null -> "—"); Older path yields txs. */
        var n = (r.tx_count !== undefined) ? r.tx_count : r.txs;
        return [anchor(doc, "#" + r.height, "#/block/" + r.height),
          r.timestamp || "—", witnessCell(doc, r.witness, myGen),
          (n === null || n === undefined) ? "—" : String(n)];
      });
      body.appendChild(scrollTable(doc, [t("explorer.th_height", "Height"), t("explorer.th_time", "Time"), t("explorer.th_witness", "Witness"), t("explorer.th_txs", "Txs")], tableRows));
      var oldestRow = rows[rows.length - 1];
      if (oldestRow.height > 1) {
        var older = touchable(el(doc, "button", t("explorer.older", "Older blocks")));
        older.type = "button";
        older.addEventListener("click", function () {
          while (body.firstChild) body.removeChild(body.firstChild);
          blocksTab(doc, body, root, myGen, oldestRow.height);
        });
        body.appendChild(older);
      }
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      showError(doc, body, e, t("explorer.blocks_failed", "Could not load blocks."));
      var retry = touchable(el(doc, "button", t("explorer.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () {
        while (body.firstChild) body.removeChild(body.firstChild);
        blocksTab(doc, body, root, myGen, oldest);
      });
      body.appendChild(retry);
    });
  }

  /* #/block/:height: header (height, time, witness, irreversible badge) +
   * tx list (each -> #/block/:height/:txIndex with op-count + first-op
   * name chips). */
  function renderBlock(root, height) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = bumpGen();
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer) {
      showError(doc, wrap, t("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load."));
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderBlock(root, height); })) return;
    var h = parseInt(height, 10);
    if (!(h >= 1)) {
      wrap.appendChild(el(doc, "h1", t("explorer.block_title", "Block")));
      showError(doc, wrap, new Error("unknown-block"), t("explorer.unknown_block", "Unknown block."));
      return;
    }
    wrap.appendChild(el(doc, "h1", t("explorer.block_prefix", "Block #") + h));
    showStatus(doc, wrap, t("explorer.loading_block", "Loading block…"));
    Promise.all([Explorer.block(h), Explorer.head().catch(function () { return null; })])
      .then(function (pair) {
        if (!isCurrent(myGen)) return;
        var b = pair[0], head = pair[1];
        while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
        wrap.appendChild(el(doc, "h1", t("explorer.block_prefix", "Block #") + b.height));
        var dl = el(doc, "dl", null, "xplore-fields");
        function row(t, node) {
          dl.appendChild(el(doc, "dt", t));
          var dd = doc.createElement("dd");
          if (typeof node === "string") dd.textContent = node;
          else if (node) dd.appendChild(node);
          dl.appendChild(dd);
        }
        row(t("explorer.time_row", "Time"), b.timestamp || "—");
        row(t("explorer.witness_row", "Witness"), witnessCell(doc, b.witness_account_id, myGen));
        row(t("explorer.txs_row", "Transactions"), String(b.tx_count));
        if (head && typeof head.last_irreversible_block_num === "number") {
          row(t("explorer.irreversible_row", "Irreversible"), b.height <= head.last_irreversible_block_num ? t("explorer.yes", "yes") : t("explorer.no_recent", "no (recent)"));
        }
        wrap.appendChild(dl);
        if (b.transactions.length === 0) {
          wrap.appendChild(el(doc, "p", t("explorer.no_txs", "No transactions in this block."), "muted"));
          return;
        }
        var ctx = { gen: myGen, root: root, tab: "blocks" };
        b.transactions.forEach(function (tx) {
          var line = el(doc, "div", null, "xplore-txline");
          line.appendChild(anchor(doc, t("explorer.tx_prefix", "Tx ") + tx.index + " (" + tx.op_count + " op" +
            (tx.op_count === 1 ? "" : "s") + ")", "#/block/" + b.height + "/" + tx.index));
          var chips = tx.ops.map(function (o) {
            return o.type_name + (o.virtual ? " (virtual)" : "");
          }).join(", ");
          line.appendChild(el(doc, "span", chips ? " — " + chips : "", "muted"));
          wrap.appendChild(line);
        });
        void ctx;
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
        wrap.appendChild(el(doc, "h1", t("explorer.block_prefix", "Block #") + h));
        showError(doc, wrap, e, t("explorer.unknown_block", "Unknown block."));
      });
  }

  /* #/block/:height/:txIndex: op rows with NAMED fields (never raw JSON). */
  function renderTx(root, height, txIndex) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = bumpGen();
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer) {
      showError(doc, wrap, t("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load."));
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderTx(root, height, txIndex); })) return;
    var h = parseInt(height, 10), ix = parseInt(txIndex, 10);
    wrap.appendChild(el(doc, "h1", t("explorer.tx_title_prefix", "Transaction ") + h + " / " + txIndex));
    if (!(h >= 1) || !(ix >= 0)) {
      showError(doc, wrap, new Error("unknown-tx"), t("explorer.unknown_tx", "Unknown transaction."));
      return;
    }
    showStatus(doc, wrap, t("explorer.loading_tx", "Loading transaction…"));
    Explorer.tx(h, ix).then(function (tx) {
      if (!isCurrent(myGen)) return;
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(el(doc, "h1", t("explorer.tx_title_prefix", "Transaction ") + tx.block + " / " + tx.index));
      wrap.appendChild(anchor(doc, t("explorer.back_to_block_prefix", "← Block #") + tx.block, "#/block/" + tx.block));
      var ctx = { gen: myGen, root: root, tab: "blocks" };
      if (tx.ops.length === 0) wrap.appendChild(el(doc, "p", t("explorer.no_ops", "No operations in this transaction."), "muted"));
      tx.ops.forEach(function (op, k) {
        wrap.appendChild(opSection(doc, op, ctx, t("explorer.op_prefix", "Op ") + k));
      });
      if (tx.signatures.length > 0) {
        wrap.appendChild(el(doc, "h3", t("explorer.signatures_prefix", "Signatures (") + tx.signatures.length + ")"));
        var ul = doc.createElement("ul");
        tx.signatures.forEach(function (sig) {
          ul.appendChild(el(doc, "li", String(sig), "muted"));
        });
        wrap.appendChild(ul);
      }
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(el(doc, "h1", t("explorer.tx_title_prefix", "Transaction ") + h + " / " + txIndex));
      showError(doc, wrap, e, t("explorer.unknown_tx", "Unknown transaction."));
    });
  }

  return {
    blocksTab: blocksTab,
    renderBlock: renderBlock,
    renderTx: renderTx
  };
})();

if (typeof module !== "undefined") { module.exports = ExplorerBlocks; }
