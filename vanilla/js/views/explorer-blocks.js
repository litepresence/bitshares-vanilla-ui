/* ExplorerBlocks: blocks-tab view for the explorer + facade over the split
 *   modules (same global, same signatures — every caller works unchanged).
 * Owns: the Blocks tab table (recent + Older paging), its live-pulse feed,
 *   tip stats strip, and the shared table/format/stat helpers below; the
 *   tab stays here (not in a split module) because its nested closures
 *   share gen-guarded live state AND tooling pins this file's text
 *   (tooling/explorer-blocks-ago-test.js asserts the single ~150ms ticker,
 *   STALL/STALE lines, and stopLive/clearStatTick teardown in THIS file).
 * Split out (verbatim moves, zero behavior change — reached through the
 *   bridges below, always, in the shipped app):
 *   explorer-blocks-activity.js (ExplorerBlocksActivity: sentenceFor +
 *     pillFor/opAccount/orderNum and the private sentence builders),
 *   explorer-blocks-detail.js (ExplorerBlocksDetail: renderBlock/renderTx).
 *   Load order (index.html): activity, detail, then this file.
 * Consumes: Explorer.block/recentBlocks/tx/resolveObject (read-only, via
 *   global), Account.resolve (witness/account links), ExplorerAssets
 *   (accountLink — generic value rendering lives in
 *   explorer-assets.js), ExplorerUI._isCurrent (the single generation
 *   counter + connect gate live in explorer-ui.js).
 *   TableRenderer owns the blocks-table shell (script-tag global,
 *   index.html order); rowTr stays the live-prepend row builder.
 * Globals/side effects: DOM under the given parent/root only; global
 *   ExplorerBlocks only. Tiny DOM helpers (el/touchable/clearRoot/makeWrap/
 *   anchor/showError/showStatus/scrollTable) are private verbatim copies of
 *   the explorer-ui.js originals (same per-file convention as the market-ui
 *   split) so moved bodies stay byte-identical; stateful shares (gen,
 *   connect gate, op rendering) delegate via lazy globals because this file
 *   loads BEFORE explorer-ui.js / explorer-assets.js (index.html order) and
 *   must not touch them at load time. Split-module bridges resolve at call
 *   time through globalThis (never a bare cross-file global: globals.d.ts
 *   is owned by the parallel market-desk split, and a bare ref would fail
 *   the type gate with an undeclared name — globalThis indexing stays
 *   checkJs-clean with identical runtime behavior).
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
  var TIP_ROWS = 30; /* tip fetch: 20-row table + ~29 intervals for the strip */
  var TABLE_ROWS = 20; /* rows shown in the Recent blocks table */
  var STAT_N = 10; /* TRX/S + AVG + TRX/BLOCK window (task: avg over last 10) */

  /* Live-pulse subscription handle (single active blocks-tab feed): torn
   * down on route leave (gen guard), on Older paging, and on Retry so only
   * the tip view holds the Store "connection" listener. Null when idle. */
  var liveOff = null;

  /* Stats "N seconds ago" ticker handle (tip page only): cleared by stopLive
   * and by the tick itself once its generation goes stale. Null when idle. */
  var statTimer = null;

  /* Clear the ticker without touching the live feed (mismatch-branch use —
   * stopLive would re-enter the unsub running it). Never throws. */
  function clearStatTick() {
    try { if (statTimer !== null) clearInterval(statTimer); } catch (e) { /* gone */ }
    statTimer = null;
  }

  /* Drop the active live feed, if any. Params: none. Returns nothing.
   * Fails: never — a missing or throwing unsub is a no-op. Also clears the
   * stats "seconds ago" ticker (tip page only; paging pages never start it). */
  function stopLive() {
    try { if (liveOff) liveOff(); } catch (e) { /* listener gone */ }
    liveOff = null;
    try { if (statTimer !== null) clearInterval(statTimer); } catch (e) { /* timer gone */ }
    statTimer = null;
  }

  /* Decimal block-age shaping (pure, offline-testable): durations, not
   * money — display rounding via toFixed(1) is fine. Old UI never had
   * decimals (integer "N seconds ago"); this tenths display is NEW flash,
   * labeled honestly here. Params: nowMs + newestTs in epoch ms. Returns
   * e.g. "0.4 seconds ago". Clamps negatives/NaN to "0.0 seconds ago". */
  function agoTextAt(nowMs, newestTs) {
    var sec = 0;
    try {
      var d = (nowMs - newestTs) / 1000;
      if (isFinite(d)) sec = Math.max(0, d);
    } catch (e) { sec = 0; }
    if (!isFinite(sec)) sec = 0;
    return sec.toFixed(1) + " " + t("explorer.ago_many_suffix", "seconds ago");
  }

  /* Chain timestamps are UTC ("2026-10-01T21:30:00", usually naive = no Z
   * or offset). Date() parses naive stamps as LOCAL time, so west-of-UTC
   * viewers get future times and the age clamp pins "0.0" forever — the
   * stuck-stopwatch bug. Only strict ISO T-shapes are accepted (naive reads
   * as UTC); anything else yields null, never a guessed local parse.
   * Returns epoch ms or null (never throws). Unit-tested. */
  function parseChainTime(s) {
    if (typeof s !== "string" || !s) return null;
    try {
      var m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
      if (!m) return null;
      var ms = new Date(m[1] + (m[2] || "Z")).getTime();
      return isFinite(ms) ? ms : null;
    } catch (e) { return null; }
  }

  /* Freshness states (pure, unit-tested): the live line is a 4-state
   * signal, not binary. A head every ~3s reads Live; a gap past one
   * missed slot reads Stale (amber); past the stall line reads Stalled
   * (red); a closed socket reads Paused (muted — updates genuinely
   * stopped, not merely slow). Params: ageMs (Date.now()-newestTs),
   * open (socket). Returns "live"|"stale"|"stalled"|"paused". Top-level
   * (like agoTextAt) so the _test seam and the per-route closures share
   * one copy. */
  var STALE_MS = 6000;
  var STALL_MS = 15000;
  function freshState(ageMs, open) {
    if (!open) return "paused";
    if (!(ageMs >= 0) || !isFinite(ageMs)) return "live";
    if (ageMs > STALL_MS) return "stalled";
    if (ageMs > STALE_MS) return "stale";
    return "live";
  }

  /* Account-id shape (data copy of the explorer-ui.js regex — slice-3
   * account route target; logic lives in explorer-assets.js). KEPT here:
   * witnessCell below still needs it; the activity module carries its own
   * verbatim copy for opAccount. */
  var ACCT_RE = /^1\.2\.\d+$/;

  /* Local fallback counter, used ONLY when explorer-ui.js failed to load
   * (impossible in the shipped app — script tags are load-bearing). In
   * practice every bump/check below reaches the shell's single counter, so
   * stale async work bails across routes instead of touching detached DOM. */
  var localGen = 0;

  /* Single generation counter (shell-owned): async continuations bail
   * when their generation no longer matches. bumpGen/waitForOpen/opSection
   * live in explorer-blocks-detail.js now (only the entity views bump or
   * gate); the tab takes its generation from the router. isCurrent stays:
   * the live feed + witness links below still guard on it. */
  function isCurrent(myGen) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._isCurrent === "function") return ExplorerUI._isCurrent(myGen);
    return myGen === localGen;
  }

  /* Connect gate + op section renderer live in explorer-blocks-detail.js
   * now (only the entity views gate or render ops). What stays: */

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

  /* Split-module bridges (explorer-blocks-activity.js /
   * explorer-blocks-detail.js, script tags directly above this file):
   * resolved at CALL time through globalThis (never cached, never at
   * load), so script order can never strand a stale handle. In the shipped
   * app both modules are always loaded; the muted/error fallbacks below
   * run only when a script tag failed — never blank, never throws. */
  function activityApi() {
    try {
      if (typeof globalThis !== "undefined" && globalThis) {
        var M = globalThis["ExplorerBlocksActivity"];
        if (M) return M;
      }
    } catch (e) { /* null below */ }
    return null;
  }
  function detailApi() {
    try {
      if (typeof globalThis !== "undefined" && globalThis) {
        var M = globalThis["ExplorerBlocksDetail"];
        if (M) return M;
      }
    } catch (e) { /* null below */ }
    return null;
  }
  /* Op pill/sentence painters (bodies moved verbatim to the activity
   * module): identical rendering whenever it has loaded. The muted
   * fallbacks mirror sentenceFor's own "op ?" shapes. */
  function actPill(doc, op) {
    var A = activityApi();
    if (A && typeof A.pillFor === "function") return A.pillFor(doc, op);
    return DOM.el(doc, "span", "op ?", "xplore-pill xplore-pill-muted");
  }
  function actSentence(doc, op, myGen) {
    var A = activityApi();
    if (A && typeof A.sentenceFor === "function") return A.sentenceFor(doc, op, myGen);
    var fb = DOM.el(doc, "span", null, "xplore-act-sent");
    fb.appendChild(DOM.el(doc, "span", "op ? · #" + (op.block || "?")));
    return fb;
  }

  function anchor(doc, text, href) {
    var a = DOM.el(doc, "a", text);
    a.setAttribute("href", href);
    touchable(a);
    a.style.display = "inline-block";
    return a;
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

  /* Scrollable table shell (principle #7: dense tables scroll horizontally
   * on phones instead of squeezing; no new CSS — inline overflow only). */
  function scrollTable(doc, headers, rows) {
    var scroller = DOM.el(doc, "div", null, "xplore-scroll");
    scroller.style.overflowX = "auto";
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    headers.forEach(function (h) { hr.appendChild(DOM.el(doc, "th", h)); });
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

  /* Blocks table via the shared TableRenderer (TableRenderer pilot): the
   * table shell (thead/tbody, .node-table, scope cols, data-k cells) comes
   * from TableRenderer — same titles, order, and left alignment as the
   * scrollTable shape it replaces (no keys, classes, or clicks before, none
   * added). View-specific cells (height anchor, async witness link) restore
   * in one post-pass from the row objects — moved, not dropped (textContent
   * only, never innerHTML). Returns the same .xplore-scroll scroller
   * scrollTable returns, so the tip + Older-paging callers and the
   * live-prepend tbody lookup are unchanged. rowTr stays the live-prepend
   * row builder (same cells); scrollTable stays for the BiggestSample panel.
   * Params: doc, headers ([4] title strings), myGen (gen guard for the
   * witness links), rows ([{height, time, witness, txs}]). Never throws. */
  function blocksTable(doc, headers, myGen, rows) {
    var list = Array.isArray(rows) ? rows : [];
    var scroller = DOM.el(doc, "div", null, "xplore-scroll");
    scroller.style.overflowX = "auto";
    var table = TableRenderer.render({
      columns: [
        { key: "height", title: headers[0] },
        { key: "time", title: headers[1] },
        { key: "witness", title: headers[2] },
        { key: "txs", title: headers[3] }
      ],
      rows: list.map(function (r) {
        return {
          height: "#" + commas(r.height),
          time: r.time,
          witness: r.witness ? String(r.witness) : "—",
          txs: (r.txs === null || r.txs === undefined) ? "—" : String(r.txs)
        };
      }),
      stickyFirstCol: true
    });
    scroller.appendChild(table);
    try {
      var tb = table.getElementsByTagName("tbody")[0];
      var trs = tb ? tb.rows : [];
      for (var i = 0; i < trs.length && i < list.length; i++) {
        (function (tr, r) {
          var cells = tr.cells;
          if (!cells || cells.length < 4) return;
          DOM.clear(cells[0]);
          cells[0].appendChild(anchor(doc, "#" + commas(r.height), "#/block/" + r.height));
          var w = witnessCell(doc, r.witness, myGen);
          DOM.clear(cells[2]);
          if (typeof w === "string") cells[2].textContent = w;
          else if (w) cells[2].appendChild(w);
        })(trs[i], list[i]);
      }
    } catch (e) { /* string cells stand without links */ }
    return scroller;
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

  /* Thousands commas on a digit string (display only, string math — never
   * float; money itself still formats via Format before reaching here). */
  function commas(digits) {
    return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* Chain ISO timestamp -> "9:58:45 AM" (original Blocks.jsx:247-252
   * FormattedDate format="time" concept — locale time, never the raw ISO).
   * Unparseable stamps fall back to the raw string (never blank). */
  function fmtTime(stamp) {
    try {
      var v = new Date(stamp).getTime();
      if (!isFinite(v)) return String(stamp || "—");
      return new Date(v).toLocaleTimeString("en-US",
        { hour: "numeric", minute: "2-digit", second: "2-digit" });
    } catch (e) { return String(stamp || "—"); }
  }

  /* Re-trigger the live-line bump (CSS keyframe, candy-block pattern):
   * remove → reflow → add, so every new head visibly lands even when heads
   * arrive back-to-back. Never throws (the label still updates without it). */
  function bumpLive(liveEl) {
    try {
      if (!liveEl) return;
      liveEl.classList.remove("xplore-bump");
      void liveEl.offsetWidth;
      liveEl.classList.add("xplore-bump");
    } catch (e) { /* static label stands */ }
  }

  /* Two-decimal stat string or null (stats are counts/ratios, not money —
   * toFixed here is display rounding, never a money path). */
  function fmt2(n) {
    return (typeof n === "number" && isFinite(n)) ? n.toFixed(2) : null;
  }

  /* Raw supply int + precision -> "2,996,875,107 BTS" (commas on the integer
   * part, fraction trimmed when all zeros). Returns null when unformattable
   * (caller dashes). Raw stays in the caller's title. */
  function fmtSupply(raw, prec, sym) {
    try {
      if (raw === null || raw === undefined || typeof prec !== "number") return null;
      var h = Format.formatAmount(String(raw), prec).split(".");
      var frac = (h[1] || "").replace(/0+$/, "");
      return commas(h[0]) + (frac ? "." + frac : "") + " " + sym;
    } catch (e) { return null; }
  }

  /* One stats-grid cell: label (small caps) + value node (returned for live
   * repaints). Value starts as an honest dash, never blank. */
  function statCell(doc, label, valCls) {
    var cell = DOM.el(doc, "div", null, "xplore-stat");
    cell.appendChild(DOM.el(doc, "span", label, "xplore-stat-label"));
    var val = DOM.el(doc, "span", "—", "xplore-stat-val" + (valCls ? " " + valCls : ""));
    cell.appendChild(val);
    return { cell: cell, val: val };
  }

  /* Teal bar-strip for block intervals (canvas, no dependency). Color reads
   * the theme --accent token live (ref-ui blue reads teal like the
   * original); the "teal" fallback is a named color so no hex literal ever
   * lands in slice JS (audit check 5). Empty input leaves the canvas blank
   * (caller dashes the cell instead). TIME DIRECTION: input arrays are
   * newest-first, but bars draw oldest-left/newest-right (chart convention:
   * back-in-time reads leftward, newest enters at right and history marches
   * left on each head — drawing newest-first leftward read backwards).
   * TRACKABILITY: chain intervals are near-uniform (~3s), so a 1-slot shift
   * of packed same-height bars is invisible (aperture problem). Bars keep a
   * 4px gutter and callers cap the window, so each head-step marches
   * visibly leftward. */
  function drawBars(canvas, intervals) {
    try {
      var ctx = canvas.getContext("2d");
      var W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (!intervals || !intervals.length) return;
      var max = 0, i;
      for (i = 0; i < intervals.length; i++) if (intervals[i] > max) max = intervals[i];
      if (!(max > 0)) max = 1;
      var color = "teal";
      try {
        var css = getComputedStyle(document.documentElement).getPropertyValue("--accent");
        if (css && css.trim()) color = css.trim();
      } catch (e) { /* named fallback stands */ }
      var GAP = 4;
      var bw = Math.max(2, Math.floor((W - GAP * (intervals.length - 1)) / intervals.length));
      for (i = 0; i < intervals.length; i++) {
        var h = Math.max(2, Math.round(intervals[i] / max * (H - 4)));
        ctx.fillStyle = color;
        ctx.fillRect((intervals.length - 1 - i) * (bw + GAP), H - h, bw, h);
      }
    } catch (e) { /* blank strip stands — the numeric cells carry the data */ }
  }

  /* Stats over the newest-first row window [{height, ts(ms|null), txs}].
   * Consecutive heights only (a gap skips its interval — never guessed).
   * Returns {tps, avg, tpb} display strings or null each (caller dashes). */
  function computeStats(rows) {
    var tx = 0, i, ok = 0;
    for (i = 0; i < rows.length; i++) tx += (typeof rows[i].txs === "number" ? rows[i].txs : 0);
    var ivals = [];
    for (i = 0; i + 1 < rows.length; i++) {
      var a = rows[i], b = rows[i + 1];
      if (a.height === b.height + 1 && typeof a.ts === "number" && typeof b.ts === "number") {
        var s = (a.ts - b.ts) / 1000;
        if (s >= 0 && s < 3600) { ivals.push(s); ok++; }
      }
    }
    var tps = null, avg = null;
    if (ok > 0) {
      var span = 0;
      for (i = 0; i < ivals.length; i++) span += ivals[i];
      if (span > 0) tps = fmt2(tx / span);
      avg = fmt2((span / ivals.length) / 2) + "s";
      if (tps === null) tps = null;
    } else if (rows.length > 0) {
      tps = fmt2(0);
      avg = null;
    }
    return { tps: tps, avg: avg, tpb: rows.length ? fmt2(tx / rows.length) : null, intervals: ivals };
  }

  /* Op/activity sentences (amtSpan/pillFor/orderSentence/amtObj/opName/
   * sentenceFor) moved verbatim to explorer-blocks-activity.js — reached
   * via actPill/actSentence above. What stays below are the two PURE
   * helpers the _test seam needs standalone in Node (no DOM, no globals):
   * opAccount + orderNum, verbatim copies of the activity owners (the
   * activity module carries its own copies for the sentences — 20 lines
   * duplicated beats a cross-module seam for pure functions). */

  /* First 1.2.x account id found under the usual op field names (shallow
   * only — no guessing inside nested objects). Returns "" when none. */
  function opAccount(f) {
    if (!f || typeof f !== "object") return "";
    var keys = ["fee_paying_account", "seller", "from", "to", "account",
      "issuer", "payer", "owner", "worker_account", "witness_account",
      "committee_member_account", "registrar", "referrer", "payer_account",
      "authorizing_account", "account_to_upgrade", "from_account", "redeemer",
      "creator", "account_to_list"];
    for (var i = 0; i < keys.length; i++) {
      if (typeof f[keys[i]] === "string" && ACCT_RE.test(f[keys[i]])) return f[keys[i]];
    }
    return "";
  }

  /* Order instance number ("1.7.574981117" -> "574981117"): original
   * LimitOrderCancel.jsx:39 shows "#" + order.substring(4). Nonconforming
   * shapes fall back to the raw string (never blank). */
  function orderNum(id) {
    var s = String((id === undefined || id === null) ? "—" : id);
    if (/^1\.7\.\d+$/.test(s)) return s.substring(4);
    return s;
  }

  /* Blocks tab: recent-blocks table + "Older" paging by height decrement
   * (no infinite-scroll lib). Rows: height link, time, witness link, txs.
   * Tip view (oldest null) adds the LIVE pulse: the existing Chain block
   * feed (Store "connection" headBlock, same signal as the footer — zero
   * extra socket) prepends each new head row with a flash highlight and
   * refreshes the green live indicator. The one-shot load + Older paging +
   * Retry below stay as the stall fallback; feed-down never blanks. */
  /* fromQuery helpers (unit-tested): ?from=<height> page cursor for the
   * blocks table. parseFromHeight(raw) -> positive int or null (garbage
   * never pages); syncFromUrl(h) writes ?from=H (or strips it for the
   * tip) via replaceState — no re-render, no history spam. Both never
   * throw; unknown heights fall back to the tip downstream. */
  function parseFromHeight(raw) {
    try {
      var h = parseInt(String(raw), 10);
      if (Number.isInteger(h) && h > 0) return h;
    } catch (e) { /* null below */ }
    return null;
  }
  function syncFromUrl(h) {
    try {
      if (typeof location === "undefined" || !location.href) return;
      if (typeof history === "undefined" || typeof history.replaceState !== "function") return;
      var path = "#/explorer/blocks";
      try { path = String(location.hash || "").split("?")[0] || path; } catch (e) { /* default stands */ }
      var q = (typeof h === "number" && h > 0) ? ("?from=" + h) : "";
      history.replaceState(null, "", location.href.split("#")[0] + path + q);
    } catch (e) { /* URL stays; table unaffected */ }
  }
  function blocksTab(doc, body, root, myGen, oldest) {
    stopLive();
    /* Deep-link cursor (?from=<height>): a null oldest re-reads the query
     * so pasted links, reloads, and the stall Retry keep the page. Tab
     * clicks navigate to a clean hash (no query) so they always reset to
     * the live tip. Garbage heights fall back to the tip, never blank. */
    if (oldest === null || oldest === undefined) {
      try {
        var qq = (typeof Router !== "undefined" && Router && typeof Router.query === "function") ? (Router.query() || {}) : {};
        var ff = parseFromHeight(qq.from);
        if (ff !== null) oldest = ff;
      } catch (e) { /* tip below */ }
    }
    showStatus(doc, body, t("explorer.loading_blocks", "Loading blocks…"));
    function rowsFor(top) {
      if (top === null || top === undefined) return Explorer.recentBlocks(TIP_ROWS, true);
      var heights = [];
      for (var h = top - 1; h > top - 1 - RECENT_N && h >= 1; h--) heights.push(h);
      return Promise.all(heights.map(function (hh) {
        return Explorer.block(hh).then(function (b) {
          return { height: b.height, timestamp: b.timestamp, witness: b.witness_account_id, txs: b.tx_count };
        }).catch(function () { return null; });
      })).then(function (rows) { return rows.filter(function (r) { return !!r; }); });
    }
    /* Current chain head from the shared status (footer signal, no RPC).
     * Returns {state, head} or null when Chain is absent. */
    function chainHead() {
      try {
        if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
          var s = Chain.status() || {};
          return { state: s.state || "unknown", head: s.headBlock || null };
        }
      } catch (e) { /* fallback below */ }
      return null;
    }
    /* Paint the live indicator: flashing dot + one word, no block number
     * (the head already shows in the strip, stats, and table below — the
     * old line duplicated it). Params: liveEl, headNum (accepted, ignored;
     * kept so the six existing call sites need no edit). Never blank. */
    function paintLive(liveEl, headNum) {
      if (!liveEl) return;
      void headNum;
      var ch = chainHead();
      var open = !!(ch && ch.state === "open");
      paintFresh(liveEl, open ? "live" : "paused");
    }
    /* Paint a freshness state: dot + word in the state's color. The word
     * rides xplore-live-text (+25% size); the dot is 1.25rem (+25%).
     * Params: liveEl, state (freshState word). Never blank, never throws.
     * Change-gated: an unchanged state reuses the existing nodes (the 150ms
     * ticker must not rebuild DOM 6.7x/sec for an identical label). */
    function paintFresh(liveEl, state) {
      if (!liveEl) return;
      try {
        if (liveEl.getAttribute("data-state") === (state || "live") &&
            liveEl.getElementsByClassName("xplore-live-dot").length > 0) return;
        var words = {
          live: t("explorer.state_live", "Live"),
          stale: t("explorer.state_stale", "Stale"),
          stalled: t("explorer.state_stalled", "Stalled"),
          paused: t("explorer.state_paused", "Paused")
        };
        DOM.clear(liveEl);
        var dot = DOM.el(doc, "span", "●", "xplore-live-dot");
        dot.setAttribute("aria-hidden", "true");
        liveEl.appendChild(dot);
        liveEl.appendChild(DOM.el(doc, "span", " " + (words[state] || words.live), "xplore-live-text"));
        liveEl.setAttribute("data-state", state || "live");
      } catch (e) { /* prior paint stands */ }
    }
    /* One normalized row -> <tr> (same cells as the initial table:
     * "#1,234,567" height link, locale-time date, witness link, tx count). */
    function rowTr(r) {
      var tr = doc.createElement("tr");
      var n = (r.tx_count !== undefined) ? r.tx_count : r.txs;
      var cells = [anchor(doc, "#" + commas(r.height), "#/block/" + r.height),
        fmtTime(r.timestamp || "—"), witnessCell(doc, r.witness, myGen),
        (n === null || n === undefined) ? "—" : String(n)];
      cells.forEach(function (c) {
        var td = doc.createElement("td");
        if (typeof c === "string") td.textContent = c;
        else if (c) td.appendChild(c);
        tr.appendChild(td);
      });
      return tr;
    }
    /* Start the tip live feed: prepends new heads with a flash + refreshes
     * the indicator. Gen-guarded teardown on route leave. No extra socket.
     * onNew (optional) fires with each full new block AFTER the row
     * prepend, so the tip stats strip repaints under the same gen guard. */
    function startLive(tbody, liveEl, topBox, onNew) {
      if (typeof Store === "undefined" || !Store || typeof Store.subscribe !== "function") return;
      if (!tbody || !liveEl) return;
      var off = function () {};
      off = Store.subscribe("connection", function (st) {
        if (!isCurrent(myGen)) {
          try { off(); } catch (e) { /* gone */ }
          if (liveOff === off) liveOff = null;
          clearStatTick();
          return;
        }
        if (!st) return;
        if (st.state !== "open") {
          paintLive(liveEl, topBox.top);
          return;
        }
        var h = st.headBlock;
        if (typeof h !== "number" || !(h > topBox.top)) {
          if (typeof h === "number" && h > 0) paintLive(liveEl, Math.max(h, topBox.top));
          return;
        }
        paintLive(liveEl, h);
        bumpLive(liveEl);
        var gap = h - topBox.top;
        var want = (gap > 1 && gap <= 5)
          ? (function () { var a = []; for (var k = topBox.top + 1; k <= h; k++) a.push(k); return a; })()
          : [h];
        (function next(i) {
          if (i >= want.length) return;
          if (!isCurrent(myGen)) return;
          Explorer.block(want[i]).then(function (b) {
            if (!isCurrent(myGen)) return;
            if (!tbody.parentNode) return;
            var tr = rowTr({
              height: b.height, timestamp: b.timestamp,
              witness: b.witness_account_id, txs: b.tx_count
            });
            tr.className = "xplore-flash";
            if (tbody.firstChild) tbody.insertBefore(tr, tbody.firstChild);
            else tbody.appendChild(tr);
            /* Cap live rows at 30 (old-UI maxBlocks parity): heads prepend
             * forever, so trim from the bottom — unbounded tbody growth is
             * a slow leak that also drags scroll performance. */
            try {
              while (tbody.rows && tbody.rows.length > 30 && tbody.lastChild) {
                tbody.removeChild(tbody.lastChild);
              }
            } catch (e) { /* table stands */ }
            if (b.height > topBox.top) {
              topBox.top = b.height;
              paintLive(liveEl, topBox.top);
            }
            if (typeof onNew === "function") {
              try { onNew(b); } catch (e) { /* stats keep prior values */ }
            }
            next(i + 1);
          }).catch(function () {
            if (!isCurrent(myGen)) return;
            paintLive(liveEl, topBox.top);
            next(i + 1);
          });
        })(0);
      });
      liveOff = off;
    }
    /* "N.N seconds ago" label for a head timestamp (original BlockTimeAgo
     * concept, Blocks.jsx:23-48: green-when-fresh rides in CSS). Decimal
     * tenths are NEW flash — the old UI floored to integer seconds; thin
     * wrapper over the pure agoTextAt above so tooling vectors cover the
     * shaping offline. Tip updates stay push-driven (chain.js
     * set_block_applied_callback); this timer only repaints the label. */
    function agoText(newestTs) {
      var now = 0;
      try { now = Date.now(); } catch (e) { now = newestTs; }
      return agoTextAt(now, newestTs);
    }
    /* Activity rows (re)paint: clears the list host and renders up to 12
     * op rows (pill + sentence, async amount fills fail open per row).
     * Empty (not error) states explain instead of blanking — and a dead
     * history API says so explicitly (historyDown) instead of mimicking a
     * quiet chain. Never throws. */
    function paintActivity(doc, host, list, myGen, historyDown) {
      try { DOM.clear(host); } catch (e) { return; }
      if (!list || list.length === 0) {
        host.appendChild(DOM.el(doc, "p", historyDown
          ? t("explorer.history_down", "History unavailable on this node — switch nodes in Settings to see recent activity.")
          : (t("explorer.no_activity", "No recent activity.") + t("explorer.activity_hint", " New chain operations list here as they arrive.")), "muted"));
        if (historyDown) {
          try {
            if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
              var link = HistoryNotice.actionLink(doc, t, "settings");
              if (link) host.appendChild(link);
            }
          } catch (e2) { /* text mention stands without the anchor */ }
        }
        return;
      }
      list.slice(0, 12).forEach(function (op) {
        try {
          var row = DOM.el(doc, "div", null, "xplore-act-row");
          row.appendChild(actPill(doc, op));
          row.appendChild(actSentence(doc, op, myGen));
          host.appendChild(row);
        } catch (e) { /* row skipped, rest stand */ }
      });
    }
    /* Largest-in-sample panel (pure ranking over the tip's own rows/bodies —
     * get_dynamic_global_properties head + get_block_header_batch + get_block
     * already fetched them; database_api.hpp:229/:173/:182). Params: doc,
     * body (panel appended), rows (recentBlocks withBodies rows), headNum.
     * Uses GovAnalytics rankers + honest sample label when loaded; otherwise
     * identical local fallbacks (no behavior fork — same sort, same caps).
     * Txs rank by op count from body.transactions (Explorer.opsFromBody when
     * present, raw length otherwise). Never throws; empty input renders an
     * honest muted line. */
    function paintBiggestSample(doc, body, rows, headNum) {
      var list = Array.isArray(rows) ? rows : [];
      var G = (typeof GovAnalytics !== "undefined" && GovAnalytics) ? GovAnalytics : null;
      var label = G ? G.sampleLabel(list.length, headNum)
        : ("Largest in last " + list.length + " blocks — sample, not all-time.");
      var panel = DOM.el(doc, "div", null, "xplore-panel");
      panel.appendChild(DOM.el(doc, "div", "Largest blocks & transactions", "xplore-panel-h"));
      panel.appendChild(DOM.el(doc, "p", label, "muted"));
      if (list.length === 0) {
        panel.appendChild(DOM.el(doc, "p", "No blocks in this sample.", "muted"));
        body.appendChild(panel);
        return;
      }
      var topB = G ? G.biggestBlocks(list, 5) : list.slice().sort(function (a, b) {
        var ta = (a && typeof a.tx_count === "number") ? a.tx_count : -1;
        var tb = (b && typeof b.tx_count === "number") ? b.tx_count : -1;
        return tb - ta;
      }).slice(0, 5);
      var bRows = topB.map(function (r) {
        var n = (r.tx_count !== undefined && r.tx_count !== null) ? String(r.tx_count) : "—";
        return [anchor(doc, "#" + commas(r.height), "#/block/" + r.height), n];
      });
      panel.appendChild(scrollTable(doc, ["Block", "Transactions"], bRows));
      var txs = [];
      list.forEach(function (r) {
        var txArr = (r && r.body && Array.isArray(r.body.transactions)) ? r.body.transactions : [];
        for (var i = 0; i < txArr.length; i++) {
          var ops = txArr[i] && Array.isArray(txArr[i].operations) ? txArr[i].operations : [];
          txs.push({ height: r.height, txIndex: i, opCount: ops.length });
        }
      });
      txs.sort(function (a, b) {
        if (b.opCount !== a.opCount) return b.opCount - a.opCount;
        return (b.height || 0) - (a.height || 0);
      });
      var topT = (G ? G.biggestTxs(list.map(function (r) {
        return { height: r.height, body: r.body || null };
      }), 5) : txs.slice(0, 5));
      if (topT.length === 0) {
        panel.appendChild(DOM.el(doc, "p", "No transactions in this sample — empty blocks carry none.", "muted"));
      } else {
        var tRows = topT.map(function (x) {
          return [anchor(doc, "#" + x.height + " / tx " + x.txIndex, "#/block/" + x.height + "/" + x.txIndex),
            String(x.opCount)];
        });
        panel.appendChild(scrollTable(doc, ["Transaction", "Operations"], tRows));
      }
      body.appendChild(panel);
    }
    /* Tip stats strip + two-column activity/blocks layout (original
     * Blocks.jsx:305-504 stat rows + 507-602 activity/blocks pair — concepts
     * only: no React, no perfect-scrollbar). Every cell starts as an honest
     * dash; unreadable reads stay dashes, never guesses. Panel headers are
     * plain divs like the original's block-content-header, so the page keeps
     * exactly one h1 (the shell title, visually folded away in explorer-ui). */
    function paintTip(rows, hd, sets, sup, ops, historyDown) {
      DOM.clear(body);
      var topBox = { top: rows[0].height };
      var liveEl = DOM.el(doc, "p", null, "xplore-live");
      liveEl.setAttribute("aria-live", "polite");
      body.appendChild(liveEl);
      paintLive(liveEl, topBox.top);

      /* Newest-first stat rows (chain stamps parsed as UTC via
       * parseChainTime — naive stamps parsed local skew future and pin the
       * age at 0.0; unparseable stamps yield null and simply contribute no
       * interval — never guessed). */
      var data = rows.map(function (r) {
        return { height: r.height, ts: parseChainTime(r.timestamp), txs: (typeof r.tx_count === "number" ? r.tx_count : null) };
      });
      function stripIntervals() {
        var out = [];
        for (var i = 0; i + 1 < data.length; i++) {
          var a = data[i], b = data[i + 1];
          if (a.height === b.height + 1 && typeof a.ts === "number" && typeof b.ts === "number") {
            var s = (a.ts - b.ts) / 1000;
            if (s >= 0 && s < 3600) out.push(s);
          }
        }
        return out;
      }

      var headNum = (hd && typeof hd.head_block_number === "number") ? hd.head_block_number : rows[0].height;
      var statsBox = DOM.el(doc, "div", null, "xplore-stats");
      statsBox.setAttribute("aria-live", "off");
      var cCur = statCell(doc, t("explorer.stat_current", "Current block"));
      var cLast = statCell(doc, t("explorer.stat_last", "Last block"), "xplore-green");
      var cTps = statCell(doc, t("explorer.stat_tps", "Trx/s"));
      var cAvg = statCell(doc, t("explorer.stat_avg", "Average confirmation time"));
      var cWit = statCell(doc, t("explorer.stat_wit", "Active witnesses"), "xplore-green");
      var cCom = statCell(doc, t("explorer.stat_com", "Active committee members"), "xplore-green");
      var cTpb = statCell(doc, t("explorer.stat_tpb", "Trx/block"));
      var cMiss = statCell(doc, t("explorer.stat_missed", "Recently missed blocks"), "xplore-warn");
      var cSup = statCell(doc, t("explorer.stat_supply", "Current supply"), "xplore-sm");
      var cBt = statCell(doc, t("explorer.stat_blocktimes", "Block times"));
      var cTxc = statCell(doc, t("explorer.stat_tpb", "Trx/block"));
      var cStl = statCell(doc, t("explorer.stat_stealth", "Stealth supply"), "xplore-sm");
      [cCur, cLast, cTps, cAvg, cWit, cCom, cTpb, cMiss, cSup, cBt, cTxc, cStl].forEach(function (c) {
        statsBox.appendChild(c.cell);
      });
      body.appendChild(statsBox);

      /* Stall UI (honest, never frozen-looking): the freshness line owns
       * the label (paintFresh in the ticker below); ensureStall only adds
       * the Retry button once it appears (re-runs the tip load). Cleared
       * by the next head. */
      var retryBtn = null;
      function clearStall() {
        if (retryBtn && retryBtn.parentNode) {
          try { retryBtn.parentNode.removeChild(retryBtn); } catch (e) { /* gone */ }
        }
        retryBtn = null;
      }
      function ensureStall() {
        if (retryBtn) return;
        try {
          retryBtn = touchable(DOM.el(doc, "button", t("explorer.retry", "Retry")));
          retryBtn.type = "button";
          retryBtn.addEventListener("click", function () {
            stopLive();
            DOM.clear(body);
            blocksTab(doc, body, root, myGen, null);
          });
          body.insertBefore(retryBtn, statsBox.nextSibling);
        } catch (e) { /* label stands without retry */ }
      }

      var newestTs = { ts: (typeof data[0].ts === "number" ? data[0].ts : Date.now()) };
      function repaint() {
        if (!isCurrent(myGen)) return;
        cCur.val.textContent = "#" + commas(headNum);
        cCur.val.title = String(headNum);
        cLast.val.textContent = agoText(newestTs.ts);
        var st = computeStats(data.slice(0, STAT_N));
        cTps.val.textContent = st.tps !== null ? st.tps : "—";
        cAvg.val.textContent = st.avg !== null ? st.avg : "—";
        cTpb.val.textContent = st.tpb !== null ? st.tpb : "—";
        if (sets && typeof sets.witnesses === "number") cWit.val.textContent = String(sets.witnesses);
        if (sets && typeof sets.committee === "number") cCom.val.textContent = String(sets.committee);
        if (hd && typeof hd.recently_missed_count === "number") {
          cMiss.val.textContent = String(hd.recently_missed_count);
          cMiss.val.title = String(hd.recently_missed_count);
        }
        if (sup && sup.current_raw !== null && sup.current_raw !== undefined) {
          var s1 = fmtSupply(sup.current_raw, sup.precision, sup.symbol || "BTS");
          if (s1 !== null) { cSup.val.textContent = s1; cSup.val.title = String(sup.current_raw); }
        }
        if (sup && sup.stealth_raw !== null && sup.stealth_raw !== undefined) {
          var s2 = fmtSupply(sup.stealth_raw, sup.precision, sup.symbol || "BTS");
          if (s2 !== null) { cStl.val.textContent = s2; cStl.val.title = String(sup.stealth_raw); }
        }
        var ivals = stripIntervals().slice(0, 20);
        DOM.clear(cBt.val);
        if (ivals.length > 0) {
          var cv = doc.createElement("canvas");
          cv.width = 300; cv.height = 84;
          cv.className = "xplore-bars";
          cv.setAttribute("role", "img");
          cv.setAttribute("aria-label", t("explorer.stat_blocktimes", "Block times"));
          drawBars(cv, ivals);
          cBt.val.appendChild(cv);
        } else {
          cBt.val.textContent = "—";
        }
        /* TRX/BLOCK bar strip (original TransactionChart.jsx concept: one
         * column per recent block, newest-first like the interval strip;
         * repaints with the same gen-guarded repaint so the two strips shift
         * together on every head). Single accent token — per-count hues from
         * the original are deliberately omitted (no hex literals in slice
         * JS; tokens only per the audit). */
        DOM.clear(cTxc.val);
        var txVals = data.slice(0, 20).map(function (d) {
          return (typeof d.txs === "number" && d.txs >= 0) ? d.txs : 0;
        });
        var hasTx = txVals.some(function (v) { return v > 0; }) || txVals.length > 0;
        if (hasTx) {
          var cv2 = doc.createElement("canvas");
          cv2.width = 300; cv2.height = 84;
          cv2.className = "xplore-bars";
          cv2.setAttribute("role", "img");
          cv2.setAttribute("aria-label", t("explorer.stat_tpb", "Trx/block"));
          drawBars(cv2, txVals);
          cTxc.val.appendChild(cv2);
        } else {
          cTxc.val.textContent = "—";
        }
      }
      repaint();
      /* Freshness ticker (~150ms): the LAST BLOCK cell counts up in tenths
       * until the next head arrives, and the live line walks Live (green)
       * -> Stale past one missed slot (amber) -> Stalled past the stall
       * line (red, + Retry). No new polling — tip updates stay push-driven
       * via the Store connection feed; this repaints the label + live line
       * in place (other stat cells repaint on push only). Gen-guarded
       * self-clear; stopLive clears on leave. */
      try {
        clearStatTick();
        statTimer = setInterval(function () {
          if (!isCurrent(myGen)) { clearStatTick(); return; }
          /* Hidden tabs do no work: heads arrive on return via the push
           * feed + repaint below; the ticker only repaints the label. */
          try { if (typeof document !== "undefined" && document.hidden) return; } catch (e) { /* visible path below */ }
          try {
            var ago = agoText(newestTs.ts);
            if (cLast.val.textContent !== ago) cLast.val.textContent = ago;
          } catch (e) { /* next tick */ }
          try {
            var ch = chainHead();
            var open = !!(ch && ch.state === "open");
            var age = 0;
            try { age = Date.now() - newestTs.ts; } catch (e) { age = 0; }
            var state = freshState(age, open);
            paintFresh(liveEl, state);
            if (state === "stalled" || state === "paused") ensureStall();
            else clearStall();
          } catch (e) { /* next tick */ }
        }, 150);
      } catch (e) { /* static label stands */ }

      /* Two-column activity + blocks (side by side ≥1200px, stacked below). */
      var split = DOM.el(doc, "div", null, "xplore-split");
      var actPanel = DOM.el(doc, "div", null, "xplore-panel");
      actPanel.appendChild(DOM.el(doc, "div", t("explorer.recent_activity", "Recent activity"), "xplore-panel-h"));
      actPanel.appendChild(DOM.el(doc, "div", t("explorer.info_h", "INFO"), "xplore-subh"));
      /* Live activity list: starts as the initial recentOps window, then
       * every new head prepends its own ops (ZERO new RPCs — the body was
       * already fetched for the table) capped at 12. Previously the panel
       * painted once and went stale while blocks kept arriving. */
      var actOps = Array.isArray(ops) ? ops.slice(0, 12) : [];
      var actList = doc.createElement("div");
      actPanel.appendChild(actList);
      paintActivity(doc, actList, actOps, myGen, historyDown);
      function refreshActivity(fresh) {
        if (!isCurrent(myGen)) return;
        try {
          if (Array.isArray(fresh) && fresh.length) {
            actOps = fresh.concat(actOps).slice(0, 12);
            /* Incremental: prepend new rows, drop overflow from the bottom
             * (cap 12) — no full list rebuild per head. Same row cells as
             * paintActivity (pill + sentence, per-row fail-open). When the
             * panel holds the empty/history note instead of rows, fall back
             * to the full paint so the note never lingers under new rows. */
            var hasRows = false;
            try {
              hasRows = actList.getElementsByClassName("xplore-act-row").length > 0;
            } catch (e) { hasRows = false; }
            if (!hasRows) {
              paintActivity(doc, actList, actOps, myGen, historyDown);
              return;
            }
            for (var ri = fresh.length - 1; ri >= 0; ri--) {
              var nr = null;
              try {
                nr = DOM.el(doc, "div", null, "xplore-act-row");
                nr.appendChild(actPill(doc, fresh[ri]));
                nr.appendChild(actSentence(doc, fresh[ri], myGen));
              } catch (e) { nr = null; }
              if (!nr) continue;
              try {
                if (actList.firstChild) actList.insertBefore(nr, actList.firstChild);
                else actList.appendChild(nr);
              } catch (e2) { /* panel keeps prior rows */ }
            }
            try {
              while (actList.children && actList.children.length > 12 && actList.lastChild) {
                actList.removeChild(actList.lastChild);
              }
            } catch (e3) { /* extra rows stand */ }
          }
        } catch (e) { /* panel keeps prior rows */ }
      }
      split.appendChild(actPanel);
      var blkPanel = DOM.el(doc, "div", null, "xplore-panel");
      blkPanel.appendChild(DOM.el(doc, "div", t("explorer.recent_blocks", "Recent blocks"), "xplore-panel-h"));
      var shown = rows.slice(0, TABLE_ROWS);
      var scroller = blocksTable(doc, [t("explorer.th_height", "Block ID"), t("explorer.th_time", "Date"), t("explorer.th_witness", "Witness"), t("explorer.th_txs", "Transaction count")],
        myGen, shown.map(function (r) {
          return { height: r.height, time: fmtTime(r.timestamp || "—"), witness: r.witness, txs: r.tx_count };
        }));
      blkPanel.appendChild(scroller);
      split.appendChild(blkPanel);
      body.appendChild(split);

      /* Largest-in-sample panel (bounded recent-head walk, N<=50 — the SAME
       * rows/bodies the tip already fetched, zero new RPCs). Ranking is pure
       * (GovAnalytics.biggestBlocks/biggestTxs when loaded, local fallback
       * otherwise); the label ALWAYS reads "sample, not all-time" — biggest
       * blocks/txs are never presented as chain-wide records. Plain literals
       * only (no new i18n keys). Never fatal: malformed rows simply rank. */
      try {
        paintBiggestSample(doc, body, rows, rows[0].height);
      } catch (e) { /* stats + tables stand without it */ }

      var tbody = null;
      try { tbody = scroller.querySelector("tbody"); } catch (e) { tbody = null; }
      var oldestRow = shown[shown.length - 1];
      if (oldestRow && oldestRow.height > 1) {
        var older = touchable(DOM.el(doc, "button", t("explorer.older", "Older blocks")));
        older.type = "button";
        older.addEventListener("click", function () {
          stopLive();
          DOM.clear(body);
          blocksTab(doc, body, root, myGen, oldestRow.height);
          try { syncFromUrl(oldestRow.height); } catch (e) { /* URL stays */ }
        });
        body.appendChild(older);
      }
      if (tbody) startLive(tbody, liveEl, topBox, function (b) {
        var ms = parseChainTime(b.timestamp);
        headNum = b.height;
        data.unshift({ height: b.height, ts: (ms !== null ? ms : Date.now()), txs: b.tx_count });
        if (data.length > TIP_ROWS) data.length = TIP_ROWS;
        /* Stopwatch rule: the age counts from local head-ARRIVAL, not the
         * chain stamp. Witness clocks run fast and naive stamps parse
         * timezone-shifted, either of which lands newestTs in the future and
         * pins the label at 0.0 via the clamp (the stuck-stopwatch bug).
         * Receipt time always counts 0.0 -> ~3.0s to the next head. */
        newestTs.ts = Date.now();
        clearStall();
        bumpLive(liveEl);
        /* Live activity: feed this head's ops (fields intact via block().raw)
         * into the panel — no extra fetch. Guarded: older api without
         * opsFromBody simply skips (panel keeps the initial window). */
        try {
          if (typeof Explorer !== "undefined" && Explorer &&
              typeof Explorer.opsFromBody === "function") {
            refreshActivity(Explorer.opsFromBody(b.height, b.raw));
          }
        } catch (e) { /* panel keeps prior rows */ }
        repaint();
      });
    }
    rowsFor(oldest).then(function (rows) {
      if (!isCurrent(myGen)) return;
      DOM.clear(body);
      if (rows.length === 0) {
        body.appendChild(DOM.el(doc, "p", t("explorer.no_blocks", "No blocks found.") + t("explorer.blocks_hint", " The node returned nothing in this range — try Older blocks or check Settings → Nodes."), "muted"));
        return;
      }
      var isTip = (oldest === null || oldest === undefined);
      if (!isTip) {
        var scroller = blocksTable(doc, [t("explorer.th_height", "Block ID"), t("explorer.th_time", "Date"), t("explorer.th_witness", "Witness"), t("explorer.th_txs", "Transaction count")],
          myGen, rows.map(function (r) {
            return { height: r.height, time: fmtTime(r.timestamp || "—"), witness: r.witness,
              txs: (r.tx_count !== undefined) ? r.tx_count : r.txs };
          }));
        body.appendChild(scroller);
        var oldestRow = rows[rows.length - 1];
        if (oldestRow.height > 1) {
          var older = touchable(DOM.el(doc, "button", t("explorer.older", "Older blocks")));
          older.type = "button";
          older.addEventListener("click", function () {
            stopLive();
            DOM.clear(body);
            blocksTab(doc, body, root, myGen, oldestRow.height);
            try { syncFromUrl(oldestRow.height); } catch (e) { /* URL stays */ }
          });
          body.appendChild(older);
        }
        return;
      }
      /* Tip: secondary fail-open reads (head / active sets / BTS supply /
       * recent ops) join the block rows; any single failure dashes its cells
       * or empties the feed — the table below still paints. */
      function failOpen(p, fb) {
        try { return p.catch(function () { return fb; }); }
        catch (e) { return Promise.resolve(fb); }
      }
      var pHd = (typeof Explorer.head === "function") ? failOpen(Explorer.head(), null) : Promise.resolve(null);
      var pSets = (typeof Explorer.activeSets === "function") ? failOpen(Explorer.activeSets(), null) : Promise.resolve(null);
      var pSup = (typeof Explorer.btsSupply === "function") ? failOpen(Explorer.btsSupply(), null) : Promise.resolve(null);
      /* Perf: the tip's own recentBlocks pass already fetched these bodies
       * (withBodies above) — hand them to recentOps so the same top heights
       * are not fetched twice. Same render only, map is local. */
      var preBodies = {};
      try {
        (rows || []).forEach(function (r) {
          if (r && r.body && typeof r.height === "number") preBodies[r.height] = r.body;
        });
      } catch (e) { preBodies = {}; }
      /* History outage is tracked, not swallowed: an empty feed from a
       * dead history API must read as "unavailable", never as a quiet
       * chain. The flag settles before Promise.all resolves, so paintTip
       * always sees its final value. */
      var historyDown = false;
      var pOps = (typeof Explorer.recentOps === "function") ? Explorer.recentOps(12, 8, preBodies).then(function (r) {
        return r;
      }, function () { historyDown = true; return []; }) : Promise.resolve([]);
      Promise.all([pHd, pSets, pSup, pOps]).then(function (res) {
        if (!isCurrent(myGen)) return;
        paintTip(rows, res[0], res[1], res[2], res[3], historyDown);
      });
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      DOM.clear(body);
      showError(doc, body, e, t("explorer.blocks_failed", "Could not load blocks."));
      var retry = touchable(DOM.el(doc, "button", t("explorer.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () {
        stopLive();
        DOM.clear(body);
        blocksTab(doc, body, root, myGen, oldest);
      });
      body.appendChild(retry);
    });
  }

  /* #/block/:height + #/block/:height/:txIndex owners (moved verbatim
   * to explorer-blocks-detail.js): thin delegators — same global, same
   * signatures, every caller works unchanged. The error panel below fires
   * only when the detail script failed to load (impossible via the
   * load-bearing script tags): plain literals, no new i18n keys. */
  function detailMissing(root, label) {
    try {
      if (!root) return;
      var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) return;
      DOM.clear(root);
      DOM.error(root, label + " — reload the app and retry.");
    } catch (e) { /* nothing to paint on */ }
  }
  function renderBlock(root, height) {
    var M = detailApi();
    if (M && typeof M.renderBlock === "function") return M.renderBlock(root, height);
    detailMissing(root, "Block view unavailable");
  }

  /* #/block/:height/:txIndex: op rows with NAMED fields (never raw JSON). */
  function renderTx(root, height, txIndex) {
    var M = detailApi();
    if (M && typeof M.renderTx === "function") return M.renderTx(root, height, txIndex);
    detailMissing(root, "Transaction view unavailable");
  }

  return {
    blocksTab: blocksTab,
    renderBlock: renderBlock,
    renderTx: renderTx,
    _test: { agoTextAt: agoTextAt, parseChainTime: parseChainTime, freshState: freshState,
      sentenceFor: function (doc, op, myGen) { return activityApi().sentenceFor(doc, op, myGen); },
      pillFor: function (doc, op) { return activityApi().pillFor(doc, op); },
      opAccount: opAccount, orderNum: orderNum,
      parseFromHeight: parseFromHeight }
  };
})();

if (typeof module !== "undefined") { module.exports = ExplorerBlocks; }
