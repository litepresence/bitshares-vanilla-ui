/* ops-ui.js — recent-block operation-stats page (deferred matrix item C3).
 * Owns: #/ops — counts operation types across a bounded sample of the N most
 *   recent blocks (default 50, max 200) and renders an op-name table with
 *   counts + integer-math percentages + bars. Honest bounded scope: the page
 *   is labeled "recent-block sample, not chain-wide ranking" because no
 *   external index exists to rank against.
 * Consumes: Explorer.head/block (the ONLY chain readers — no new WS methods,
 *   no new read file; a cache helper is NOT justified: one-shot page, N<=200
 *   fresh reads per view, no shared state to keep), Chain.status (connect
 *   gate), Store (connection subscribe for auto-reconnect), TableRenderer
 *   (table shell — script-tag global). No wallet, no
 *   signing, no broadcasts. All percentages are BigInt integer math — no
 *   float, no Number() on money-adjacent values (counts are plain ints).
 * Globals/side effects: DOM under root only; global OpsUI. Generation
 *   counter tears down stale async work on route change (fees-ui.js pattern).
 * Refs: astro-ui/src/nanoeffects/TopOperations.ts:15-85 (ES-index ranking —
 *   deliberately NOT copied: an external Elasticsearch proxy is a dependency
 *   and fails the §4.5 anti-rot gate; vanilla samples recent blocks instead);
 *   astro-ui/src/components/BlockchainTopOperations.jsx:303-307 (table
 *   columns Type/Name/Quantity/% — shape reference only, no code, no pie
 *   chart, no recharts); vanilla/js/explorer.js:24-45 (OP_NAMES + VIRTUAL
 *   source — copied below with provenance; NOT exported by explorer.js).
 * Created by: deferred-matrix close-out (C3 top-operations stats).
 */
var OpsUI = (function () {
  "use strict";

  var gen = 0;
  var DEFAULT_N = 50; /* sample default (task bound) */
  var MAX_N = 200; /* sample ceiling (task bound) */
  var CONNECT_TIMEOUT_MS = 15000; /* slice-1 offline pattern */
  var CHUNK = 25; /* parallel block-fetch width (one shared socket) */
  var lastN = DEFAULT_N; /* sticky sample size for the session */

  /* Batch-9 i18n: display strings resolve via I18n.t with the pre-conversion
   * literal kept verbatim as enDefault (English-identical on any transport,
   * incl. file:// where dict fetch fails). Falls back to the default when
   * i18n.js failed to load: never blank, never throws. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Op index -> short name, FC_REFLECT order <- operations.hpp:56-133.
   * PROVENANCE: value-copy of the OP_NAMES table in vanilla/js/explorer.js
   * (lines 24-44), which cites bitshares-core operations.hpp:56-133. Copied
   * (not imported) because explorer.js does not export the table; any future
   * op added to the chain appears here as "unknown" via opLabel, never a
   * throw — same never-break-reads contract as Explorer._opRef. */
  var OP_NAMES = ["transfer", "limit_order_create", "limit_order_cancel", "call_order_update",
    "fill_order", "account_create", "account_update", "account_whitelist", "account_upgrade",
    "account_transfer", "asset_create", "asset_update", "asset_update_bitasset",
    "asset_update_feed_producers", "asset_issue", "asset_reserve", "asset_fund_fee_pool",
    "asset_settle", "asset_global_settle", "asset_publish_feed", "witness_create",
    "witness_update", "proposal_create", "proposal_update", "proposal_delete",
    "withdraw_permission_create", "withdraw_permission_update", "withdraw_permission_claim",
    "withdraw_permission_delete", "committee_member_create", "committee_member_update",
    "committee_member_update_global_parameters", "vesting_balance_create",
    "vesting_balance_withdraw", "worker_create", "custom", "assert", "balance_claim",
    "override_transfer", "transfer_to_blind", "blind_transfer", "transfer_from_blind",
    "asset_settle_cancel", "asset_claim_fees", "fba_distribute", "bid_collateral",
    "execute_bid", "asset_claim_pool", "asset_update_issuer", "htlc_create", "htlc_redeem",
    "htlc_redeemed", "htlc_extend", "htlc_refund", "custom_authority_create",
    "custom_authority_update", "custom_authority_delete", "ticket_create", "ticket_update",
    "liquidity_pool_create", "liquidity_pool_delete", "liquidity_pool_deposit",
    "liquidity_pool_withdraw", "liquidity_pool_exchange", "samet_fund_create",
    "samet_fund_delete", "samet_fund_update", "samet_fund_borrow", "samet_fund_repay",
    "credit_offer_create", "credit_offer_delete", "credit_offer_update",
    "credit_offer_accept", "credit_deal_repay", "credit_deal_expired",
    "liquidity_pool_update", "credit_deal_update", "limit_order_update"];
  /* PROVENANCE: value-copy of the VIRTUAL set in vanilla/js/explorer.js:45
   * (virtual execution events — never signed, shown with a marker only). */
  var VIRTUAL = { 4: 1, 42: 1, 44: 1, 46: 1, 51: 1, 53: 1, 74: 1 };

  /* clampN: bound a requested sample size to 1..MAX_N (default DEFAULT_N).
   * Params: n (anything). Returns a safe integer. Fails: never. */
  function clampN(n) {
    var v = parseInt(n, 10);
    if (!(v >= 1)) return DEFAULT_N;
    return Math.min(v, MAX_N);
  }

  /* opLabel: display name + virtual flag for an op index. Params: idx
   *   (number). Returns {name, virtual}. Unknown indexes yield "unknown"
   *   (never throw — a future op must not break this page). */
  function opLabel(idx) {
    if (idx >= 0 && idx < OP_NAMES.length) {
      return { name: OP_NAMES[idx], virtual: !!VIRTUAL[idx] };
    }
    return { name: "unknown", virtual: false };
  }

  /* pctTenths: share of count/total in tenths of a percent, integer math.
   * Params: count, total (non-negative ints). Returns a BigInt 0..1000
   *   (e.g. 205n = 20.5%). Zero total yields 0n (never divide by zero). */
  function pctTenths(count, total) {
    if (!(total > 0) || !(count > 0)) return 0n;
    return (BigInt(count) * 1000n) / BigInt(total);
  }

  /* fmtPct: tenths-of-a-percent BigInt -> "W.F%" display string. Params: t
   *   (BigInt). Returns a string. Fails: never. */
  function fmtPct(t) {
    var whole = t / 10n, frac = t % 10n;
    return whole.toString() + "." + frac.toString() + "%";
  }

  /* barPct: integer 0..100 share for the CSS bar width (presentation only —
   * the text cell carries the exact tenths value). Params: count, total.
   * Returns a Number. Fails: never. */
  function barPct(count, total) {
    if (!(total > 0) || !(count > 0)) return 0;
    return Number((BigInt(count) * 100n) / BigInt(total));
  }

  /* No local el — use DOM.el */
  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
/* clearRoot removed — use DOM.clear */
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w;
  }
  /* Inline error panel, never blank. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (msg.indexOf("not connected") !== -1 || msg.indexOf("not-connected") !== -1) {
      msg = "Network unavailable. Check Settings → Nodes and retry.";
    }
    var box = DOM.error(wrap, msg); return box;
  }
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text); return p;
  }

  /* Connect gate (fees-ui.js pattern): cold socket paints a connecting panel
   * with Retry and auto-reruns once on open (gen-guarded, hash-checked);
   * times out into the same panel with Retry. Returns true when the caller
   * must stop (waiting UI already shown). */
  function waitForOpen(doc, wrap, root, myGen, rerun) {
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state === "open") return false;
    showStatus(doc, wrap, "Connecting to network…");
    var ostat = showStatus(doc, wrap, "");
    var orow = DOM.el(doc, "div", null, "pools-offline-row");
    wrap.appendChild(orow);
    var retry = touchable(DOM.el(doc, "button", "Retry"));
    retry.type = "button"; orow.appendChild(retry);
    var ooff = null;
    try { ooff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { ooff = null; }
    var orerun = function () {
      if (!settled) { settled = true; try { off(); } catch (e) { /* gone */ } clearTimeout(timer); }
      if (myGen === gen) rerun();
    };
    if (ooff && typeof ooff.wire === "function") {
      try { ooff.wire(retry, ostat, orerun, t); } catch (e) { retry.addEventListener("click", orerun); }
    } else {
      retry.addEventListener("click", orerun);
    }
    var olink = null;
    if (ooff && typeof ooff.settingsLink === "function") {
      try { olink = ooff.settingsLink(doc, t); } catch (e) { olink = null; }
    }
    if (olink) orow.appendChild(olink);
    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    var settled = false, off = function () {};
    if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
      off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; try { off(); } catch (e) { /* listener already gone */ }
          clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) rerun();
        }
      });
    }
    var timer = setTimeout(function () {
      if (settled || myGen !== gen) return;
      settled = true; try { off(); } catch (e) { /* listener already gone */ }
    }, CONNECT_TIMEOUT_MS);
    /* Automated handshake on entry (shared Offline helper owns the throttle;
     * Retry is wired via Offline.wire above). */
    try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
    return true;
  }

  /* sampleRange: fetch Explorer.block for heights head-n+1..head in CHUNK-wide
   * parallel waves (one shared socket — unbounded fan-out stalls it).
   * Returns {blocks, skipped}: blocks in ascending height, skipped = failed
   * heights (logged as a note, never a throw — one missing block must not
   * blank the page). Stale generations bail between waves. */
  async function sampleRange(head, n, myGen) {
    var lo = Math.max(1, head - n + 1), heights = [], h;
    for (h = lo; h <= head; h++) heights.push(h);
    var blocks = [], skipped = 0, i, w;
    for (i = 0; i < heights.length; i += CHUNK) {
      if (myGen !== gen) return null;
      var wave = heights.slice(i, i + CHUNK);
      var rows = await Promise.all(wave.map(function (hh) {
        return Explorer.block(hh).then(function (b) { return b; }).catch(function () { return null; });
      }));
      for (w = 0; w < rows.length; w++) {
        if (rows[w]) blocks.push(rows[w]);
        else skipped += 1;
      }
    }
    if (myGen !== gen) return null;
    return { blocks: blocks, skipped: skipped, lo: lo, head: head };
  }

  /* renderTable: sorted op-count table with integer percentages + bars.
   * Params: doc, wrap, counts (idx->count map), total (op count). Dense
   * .node-table (theme-aware) inside a horizontal scroll region on phones
   * (principle #7); bars are inline divs on theme vars, no new CSS file.
   * TableRenderer pilot: the table shell comes from the shared renderer
   * (same Type/Operation/Count/Share titles, order, and right alignment on
   * Count/Share as the hand-built table it replaces — no keys, classes, or
   * clicks before, none added). The bar column and nowrap restore in one
   * post-pass from the row objects — moved, not dropped (textContent only).
   * Header literals stay plain (as before — no i18n keys minted here). */
  function renderTable(doc, wrap, counts, total) {
    var keys = Object.keys(counts).map(function (k) { return parseInt(k, 10); });
    keys.sort(function (a, b) { return counts[b] - counts[a]; });
    if (keys.length === 0) {
      wrap.appendChild(DOM.el(doc, "p", t("ops.no_ops_hint", "No operations in the sampled blocks — widen the sample or retry at the chain tip."), "muted"));
      return;
    }
    var scroller = DOM.el(doc, "div", null, "ops-scroll");
    scroller.style.overflowX = "auto";
    var rows = keys.map(function (idx) {
      var lab = opLabel(idx), c = counts[idx];
      return {
        type: String(idx),
        op: lab.name + (lab.virtual ? " (virtual)" : ""),
        count: String(c),
        share: fmtPct(pctTenths(c, total)),
        bar: "",
        width: barPct(c, total)
      };
    });
    var table = TableRenderer.render({
      columns: [
        { key: "type", title: "Type" },
        { key: "op", title: "Operation" },
        { key: "count", title: "Count", align: "right" },
        { key: "share", title: "Share", align: "right" },
        { key: "bar", title: "" }
      ],
      rows: rows,
      stickyFirstCol: true
    });
    try {
      var tb = table.getElementsByTagName("tbody")[0];
      var trs = tb ? tb.rows : [];
      for (var i = 0; i < trs.length && i < rows.length; i++) {
        (function (tr, r) {
          var cells = tr.cells;
          if (!cells || cells.length < 5) return;
          cells[0].style.whiteSpace = "nowrap";
          cells[2].style.whiteSpace = "nowrap";
          cells[3].style.whiteSpace = "nowrap";
          DOM.clear(cells[4]);
          var track = doc.createElement("div");
          track.style.minWidth = "80px"; track.style.background = "var(--bg)";
          track.style.border = "1px solid var(--border)"; track.style.borderRadius = "4px";
          var fill = doc.createElement("div");
          fill.style.width = r.width + "%"; fill.style.height = "12px";
          fill.style.background = "var(--accent)"; fill.style.borderRadius = "3px";
          fill.setAttribute("aria-hidden", "true");
          track.appendChild(fill); cells[4].appendChild(track);
        })(trs[i], rows[i]);
      }
    } catch (e) { /* strings stand without bars */ }
    scroller.appendChild(table); wrap.appendChild(scroller);
  }

  /* Route entry #/ops: honest scope note + sample-size form, then head read
   * and bounded block sample. Offline renders Retry + auto-reruns on
   * reconnect (waitForOpen above, gen-guarded). */
  function renderOps(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer ||
        typeof Explorer.head !== "function" || typeof Explorer.block !== "function") {
      wrap.appendChild(DOM.pageHead(doc, "Top operations", "fire"));
      showError(doc, wrap, "Explorer backend missing: js/explorer.js failed to load.");
      return;
    }
    wrap.appendChild(DOM.pageHead(doc, "Top operations", "fire"));
    wrap.appendChild(DOM.el(doc, "p",
      "Recent-block sample, not a chain-wide ranking: counts come from the N " +
      "most recent blocks read live from your connected node. No external index exists.",
      "muted"));
    var form = doc.createElement("form");
    var lab = doc.createElement("label");
    lab.textContent = t("ops.blocks_sampled_prefix", "Blocks sampled (1–") + MAX_N + "): ";
    var num = doc.createElement("input");
    num.type = "number"; num.min = "1"; num.max = String(MAX_N); num.value = String(lastN);
    num.setAttribute("inputmode", "numeric");
    num.setAttribute("aria-label", t("ops.blocks_sampled_aria", "Blocks sampled"));
    touchable(num); num.style.maxWidth = "120px";
    lab.appendChild(num); form.appendChild(lab);
    var apply = touchable(DOM.el(doc, "button", "Apply", "subtle-btn"));
    apply.type = "submit"; form.appendChild(apply);
    wrap.appendChild(form);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      lastN = clampN(num.value);
      if (myGen === gen) renderOps(root);
    });
    if (waitForOpen(doc, wrap, root, myGen, function () { renderOps(root); })) return;
    var n = lastN;
    var status = showStatus(doc, wrap, "Reading " + n + " most recent blocks…");
    Explorer.head().then(function (h) {
      if (myGen !== gen) return null;
      return sampleRange(h.head_block_number, n, myGen);
    }).then(function (res) {
      if (myGen !== gen || !res) return;
      status.textContent = "";
      var counts = {}, txs = 0, total = 0, b, t, o;
      for (b = 0; b < res.blocks.length; b++) {
        var txsArr = res.blocks[b].transactions || [];
        txs += txsArr.length;
        for (t = 0; t < txsArr.length; t++) {
          var ops = txsArr[t].ops || [];
          for (o = 0; o < ops.length; o++) {
            var idx = ops[o].type_idx;
            counts[idx] = (counts[idx] || 0) + 1;
            total += 1;
          }
        }
      }
      wrap.appendChild(DOM.el(doc, "p",
        "Sample: blocks " + res.lo + "–" + res.head + " (" + res.blocks.length +
        " blocks, " + txs + " transactions, " + total + " operations" +
        (res.skipped > 0 ? ", " + res.skipped + " block(s) unreadable — skipped" : "") + ").",
        "muted"));
      renderTable(doc, wrap, counts, total);
      var more = DOM.el(doc, "p", null, "muted");
      var a = doc.createElement("a");
      a.href = "#/explorer"; a.textContent = t("topops.back", "Back to Explorer");
      touchable(a); a.style.display = "inline-block";
      more.appendChild(a); wrap.appendChild(more);
    }).catch(function (e) {
      if (myGen !== gen) return;
      status.textContent = "";
      showError(doc, wrap, e, "Could not sample recent blocks.");
      var retry = touchable(DOM.el(doc, "button", "Retry"));
      retry.type = "button";
      retry.addEventListener("click", function () { if (myGen === gen) renderOps(root); });
      wrap.appendChild(retry);
    });
  }

  return { renderOps: renderOps,
    _test: { clampN: clampN, opLabel: opLabel, pctTenths: pctTenths, fmtPct: fmtPct,
      barPct: barPct, DEFAULT_N: DEFAULT_N, MAX_N: MAX_N } };
})();

if (typeof module !== "undefined") { module.exports = OpsUI; }
