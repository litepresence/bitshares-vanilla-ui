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

  /* Wide (viewport-gaps fix 2026-09-28): full-bleed stacked grid
   * ≥1200px; children span full width via app.css .wide contract. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
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
    else if (msg.indexOf("unknown-object") !== -1) msg = fallback || (t("explorer.not_found", "Nothing found for that search.") + " Check the id shape (1.x.x) or name spelling and retry.");
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
    table.className = "node-table";
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
    var cell = el(doc, "div", null, "xplore-stat");
    cell.appendChild(el(doc, "span", label, "xplore-stat-label"));
    var val = el(doc, "span", "—", "xplore-stat-val" + (valCls ? " " + valCls : ""));
    cell.appendChild(val);
    return { cell: cell, val: val };
  }

  /* Teal bar-strip for block intervals (canvas, no dependency). Color reads
   * the theme --accent token live (ref-ui blue reads teal like the
   * original); the "teal" fallback is a named color so no hex literal ever
   * lands in slice JS (audit check 5). Empty input leaves the canvas blank
   * (caller dashes the cell instead). */
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
      var bw = Math.max(2, Math.floor(W / intervals.length) - 2);
      for (i = 0; i < intervals.length; i++) {
        var h = Math.max(2, Math.round(intervals[i] / max * (H - 4)));
        ctx.fillStyle = color;
        ctx.fillRect(i * (bw + 2), H - h, bw, h);
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

  /* Amount leaf -> span that fills in human text once the asset precision
   * resolves (same pattern as explorer-render.js amountSpan, local so this
   * file needs no new cross-module surface). Raw int + "(raw)" meanwhile,
   * raw in the title always. */
  function amtSpan(doc, raw, assetId, myGen) {
    var s = el(doc, "span", String(raw) + t("explorer.raw_mark", " (raw)"));
    s.title = String(raw) + " " + assetId;
    if (typeof Explorer === "undefined" || !Explorer || typeof Explorer.asset !== "function") return s;
    Explorer.asset(assetId).then(function (j) {
      if (!isCurrent(myGen)) return;
      try {
        s.textContent = Format.formatAmount(String(raw), j.asset.precision) + " " + j.asset.symbol;
        s.title = String(raw);
      } catch (e) { s.textContent = String(raw) + " " + assetId; }
    }).catch(function () {
      if (!isCurrent(myGen)) return;
      s.textContent = String(raw) + " " + assetId;
    });
    return s;
  }

  /* Activity pill for one op: PLACE ORDER (warn orange) / CANCEL (danger
   * red) / TRANSFER (accent) / known others muted with the spaced type name
   * / unknown "op <id>" muted (never blank, never throws). Uppercase rides
   * in CSS for known labels; the unknown id keeps its literal "op N" shape. */
  function pillFor(doc, op) {
    var idx = (typeof op.type_idx === "number") ? op.type_idx : parseInt(op.type_idx, 10);
    var known = (typeof op.type_name === "string" && op.type_name && op.type_name !== "unknown");
    if (idx === 1) return el(doc, "span", t("explorer.pill_place", "Place order"), "xplore-pill xplore-pill-place");
    if (idx === 2) return el(doc, "span", t("explorer.pill_cancel", "Cancel order"), "xplore-pill xplore-pill-cancel");
    if (idx === 0) return el(doc, "span", t("explorer.pill_transfer", "Transfer"), "xplore-pill xplore-pill-transfer");
    if (known) return el(doc, "span", String(op.type_name).replace(/_/g, " "), "xplore-pill xplore-pill-muted");
    return el(doc, "span", "op " + (isFinite(idx) ? idx : "?"), "xplore-pill xplore-pill-muted xplore-pill-raw");
  }

  /* First 1.2.x account id found under the usual op field names (shallow
   * only — no guessing inside nested objects). Returns "" when none. */
  function opAccount(f) {
    if (!f || typeof f !== "object") return "";
    var keys = ["fee_paying_account", "seller", "from", "to", "account",
      "issuer", "payer", "owner", "worker_account", "witness_account",
      "committee_member_account", "registrar", "referrer", "payer_account"];
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

  /* Limit-order sentence in the original shape (LimitOrderCreate.jsx:90-122
   * concept: "placed order to buy <amount> at <price> <sym/sym>"). Buy/sell
   * follows the no-prefs default of the original's market-direction test
   * (isBid = selling the lower-instance asset — getMarketName orders by
   * instance id, inverted falsy until the viewer picks a market): sellN <
   * buyN reads "buy", else "sell". Amount + price resolve human via
   * Explorer.asset + Format (integer-only Format.formatPrice, 8 places
   * trimmed); raw meanwhile, raw in the title. No block suffix — the
   * original rows carry no block number either. */
  function orderSentence(doc, f, myGen) {
    var sent = el(doc, "span", null, "xplore-act-sent");
    var sell = (f.amount_to_sell && typeof f.amount_to_sell === "object") ? f.amount_to_sell : {};
    var buy = (f.min_to_receive && typeof f.min_to_receive === "object") ? f.min_to_receive : {};
    var sellId = String(sell.asset_id || ""), buyId = String(buy.asset_id || "");
    var sellN = parseInt(sellId.split(".")[2] || "x", 10);
    var buyN = parseInt(buyId.split(".")[2] || "x", 10);
    var isBuy = (isFinite(sellN) && isFinite(buyN)) ? (sellN < buyN) : false;
    sent.appendChild(accountLink(doc, String(f.seller || opAccount(f) || "—"), myGen));
    sent.appendChild(el(doc, "span", isBuy ? " placed order to buy " : " placed order to sell "));
    var amtRaw0 = String((isBuy ? buy.amount : sell.amount) ?? "—");
    var amtPh = el(doc, "span", amtRaw0 + t("explorer.raw_mark", " (raw)"));
    amtPh.title = amtRaw0;
    sent.appendChild(amtPh);
    sent.appendChild(el(doc, "span", " at "));
    var pricePh = el(doc, "span", "…");
    sent.appendChild(pricePh);
    sent.appendChild(el(doc, "span", " "));
    sent.appendChild(el(doc, "span", (sellId || "?") + "/" + (buyId || "?")));
    if (!sellId || !buyId || typeof Explorer === "undefined" || !Explorer ||
        typeof Explorer.asset !== "function") return sent;
    var pairPh = sent.lastChild;
    Promise.all([Explorer.asset(sellId).catch(function () { return null; }),
      Explorer.asset(buyId).catch(function () { return null; })]).then(function (pair) {
      if (!isCurrent(myGen)) return;
      try {
        var sJ = pair[0], bJ = pair[1];
        if (!sJ || !bJ || !sJ.asset || !bJ.asset) return;
        var sP = sJ.asset.precision, bP = bJ.asset.precision;
        var sS = sJ.asset.symbol, bS = bJ.asset.symbol;
        if (typeof sP !== "number" || typeof bP !== "number") return;
        var amtRaw = String(isBuy ? buy.amount : sell.amount);
        amtPh.textContent = Format.formatAmount(amtRaw, isBuy ? bP : sP) + " " + (isBuy ? bS : sS);
        amtPh.title = amtRaw;
        var px = isBuy
          ? Format.formatPrice(String(sell.amount), sP, String(buy.amount), bP, 8)
          : Format.formatPrice(String(buy.amount), bP, String(sell.amount), sP, 8);
        px = px.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
        pricePh.textContent = px;
        pricePh.title = isBuy
          ? (String(sell.amount) + " " + sellId + " / " + String(buy.amount) + " " + buyId)
          : (String(buy.amount) + " " + buyId + " / " + String(sell.amount) + " " + sellId);
        pairPh.textContent = isBuy ? (sS + "/" + bS) : (bS + "/" + sS);
      } catch (e) { /* raw placeholders stand */ }
    });
    return sent;
  }

  /* Amount object {amount, asset_id} -> human span (raw meanwhile, raw in
   * title via amtSpan). Nonconforming shapes yield a muted dash (never
   * blank, never throws). */
  function amtObj(doc, o, myGen) {
    if (o && typeof o === "object" && typeof o.asset_id === "string") {
      return amtSpan(doc, String(o.amount), o.asset_id, myGen);
    }
    return el(doc, "span", "—", "muted");
  }

  /* Proposed-op index -> name via explorer.js OP_NAMES when present (that
   * module owns the 78-entry table — this file must not duplicate it).
   * Falls back to "op N" when OP_NAMES is absent (never blank, never
   * throws). */
  function opName(idx) {
    var i = (typeof idx === "number") ? idx : parseInt(idx, 10);
    try {
      if (typeof Explorer !== "undefined" && Explorer && Array.isArray(Explorer.OP_NAMES) &&
          typeof Explorer.OP_NAMES[i] === "string" && Explorer.OP_NAMES[i]) {
        return Explorer.OP_NAMES[i];
      }
    } catch (e) { /* fallback below */ }
    return "op " + (isFinite(i) ? i : "?");
  }

  /* One activity sentence (account + action + amounts, original Operation
   * wording: "placed order to buy/sell <amount> at <price> <pair>",
   * "cancelled order #<n>"). Top-10 op types by chain frequency carry full
   * sentences here (0 transfer, 1/2 limit orders, 3 margin update, 4 fill,
   * 5 account create, 6 account update, 14 asset issue, 19 feed publish,
   * 22 proposal create — names via op.type_name / opName, amounts via
   * amtSpan/Format). Static glue stays plain English (batch-2b:
   * dynamic sentences keep code structure; only the pill labels above carry
   * i18n keys). Accounts resolve to name links via the shared accountLink
   * (raw id meanwhile); amounts resolve human via amtSpan/orderSentence
   * (raw meanwhile, raw in title). Known shapes carry no block suffix, like
   * the original rows; unknown shapes fall back to "op <id> · block #h" —
   * never blank, never throws. */
  function sentenceFor(doc, op, myGen) {
    var sent = el(doc, "span", null, "xplore-act-sent");
    try {
      var f = (op.fields && typeof op.fields === "object") ? op.fields : {};
      var idx = (typeof op.type_idx === "number") ? op.type_idx : parseInt(op.type_idx, 10);
      var blkLink = anchor(doc, "#" + op.block, "#/block/" + op.block);
      blkLink.title = t("explorer.block_prefix", "Block #") + op.block;
      if (idx === 0 && f.amount && typeof f.amount.asset_id === "string") {
        sent.appendChild(accountLink(doc, String(f.from || opAccount(f) || "—"), myGen));
        sent.appendChild(el(doc, "span", " transferred "));
        sent.appendChild(amtSpan(doc, String(f.amount.amount), f.amount.asset_id, myGen));
        sent.appendChild(el(doc, "span", " to "));
        sent.appendChild(accountLink(doc, String(f.to || "—"), myGen));
        return sent;
      }
      if (idx === 1 && f.amount_to_sell && f.min_to_receive) {
        return orderSentence(doc, f, myGen);
      }
      if (idx === 2) {
        sent.appendChild(accountLink(doc, String(f.fee_paying_account || opAccount(f) || "—"), myGen));
        sent.appendChild(el(doc, "span", " cancelled order #" + orderNum(f.order)));
        return sent;
      }
      if (idx === 3) {
        sent.appendChild(accountLink(doc, String(f.funding_account || opAccount(f) || "—"), myGen));
        sent.appendChild(el(doc, "span", t("explorer.updated_margin_position", " updated margin position")));
        if (f.delta_collateral && typeof f.delta_collateral === "object") {
          sent.appendChild(el(doc, "span", t("explorer.collateral_prefix", " (+collateral ")));
          sent.appendChild(amtObj(doc, f.delta_collateral, myGen));
          sent.appendChild(el(doc, "span", ")"));
        }
        if (f.delta_debt && typeof f.delta_debt === "object") {
          sent.appendChild(el(doc, "span", t("explorer.debt_prefix", " (+debt ")));
          sent.appendChild(amtObj(doc, f.delta_debt, myGen));
          sent.appendChild(el(doc, "span", ")"));
        }
        return sent;
      }
      if (idx === 4) {
        sent.appendChild(accountLink(doc, String(f.account_id || opAccount(f) || "—"), myGen));
        sent.appendChild(el(doc, "span", t("explorer.filled_order_prefix", " filled order: ")));
        sent.appendChild(amtObj(doc, f.pays, myGen));
        sent.appendChild(el(doc, "span", " → "));
        sent.appendChild(amtObj(doc, f.receives, myGen));
        return sent;
      }
      if (idx === 5) {
        sent.appendChild(accountLink(doc, String(f.registrar || opAccount(f) || "—"), myGen));
        sent.appendChild(el(doc, "span", t("explorer.created_account_prefix", " created account ") + String(f.name || "—")));
        return sent;
      }
      if (idx === 6) {
        sent.appendChild(accountLink(doc, String(f.account || opAccount(f) || "—"), myGen));
        sent.appendChild(el(doc, "span", t("explorer.updated_account", " updated account")));
        return sent;
      }
      if (idx === 14) {
        sent.appendChild(accountLink(doc, String(f.issuer || opAccount(f) || "—"), myGen));
        sent.appendChild(el(doc, "span", t("explorer.issued_mid", " issued ")));
        sent.appendChild(amtObj(doc, f.asset_to_issue, myGen));
        sent.appendChild(el(doc, "span", t("explorer.to_mid", " to ")));
        sent.appendChild(accountLink(doc, String(f.issue_to_account || "—"), myGen));
        return sent;
      }
      if (idx === 19) {
        sent.appendChild(accountLink(doc, String(f.publisher || opAccount(f) || "—"), myGen));
        sent.appendChild(el(doc, "span", t("explorer.published_feed_for_prefix", " published feed for ") + String(f.asset_id || "—")));
        return sent;
      }
      if (idx === 22) {
        sent.appendChild(accountLink(doc, String(f.fee_paying_account || opAccount(f) || "—"), myGen));
        var pops = Array.isArray(f.proposed_ops) ? f.proposed_ops : [];
        var names = pops.map(function (p) {
          var pi = Array.isArray(p) ? p[0] : (p && (p.type !== undefined ? p.type : p.op));
          return opName(pi).replace(/_/g, " ");
        }).join(", ");
        sent.appendChild(el(doc, "span", t("explorer.proposed_prefix", " proposed ") + pops.length + t("explorer.operation_mid", " operation") +
          (pops.length === 1 ? "" : "s") + (names ? " (" + names + ")" : "")));
        return sent;
      }
      var who = opAccount(f);
      if (who) sent.appendChild(accountLink(doc, who, myGen));
      else sent.appendChild(el(doc, "span", (typeof op.type_name === "string" && op.type_name !== "unknown")
        ? op.type_name.replace(/_/g, " ") : "op " + (isFinite(idx) ? idx : "?")));
      if (who) {
        sent.appendChild(el(doc, "span", " " + ((typeof op.type_name === "string" && op.type_name !== "unknown")
          ? op.type_name.replace(/_/g, " ") : "op " + (isFinite(idx) ? idx : "?"))));
      }
      sent.appendChild(el(doc, "span", " · "));
      sent.appendChild(blkLink);
      return sent;
    } catch (e) {
      while (sent.firstChild) sent.removeChild(sent.firstChild);
      sent.appendChild(el(doc, "span", "op ? · #" + (op.block || "?")));
      return sent;
    }
  }

  /* Blocks tab: recent-blocks table + "Older" paging by height decrement
   * (no infinite-scroll lib). Rows: height link, time, witness link, txs.
   * Tip view (oldest null) adds the LIVE pulse: the existing Chain block
   * feed (Store "connection" headBlock, same signal as the footer — zero
   * extra socket) prepends each new head row with a flash highlight and
   * refreshes the green live indicator. The one-shot load + Older paging +
   * Retry below stay as the stall fallback; feed-down never blanks. */
  function blocksTab(doc, body, root, myGen, oldest) {
    stopLive();
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
    /* Paint the live indicator: green "Live • Block #N" when open, muted
     * "Paused • Block #N" otherwise. Params: liveEl, headNum. Never blank. */
    function paintLive(liveEl, headNum) {
      if (!liveEl) return;
      var ch = chainHead();
      var open = !!(ch && ch.state === "open");
      var n = (typeof headNum === "number" && headNum > 0) ? headNum
        : (ch && typeof ch.head === "number" && ch.head > 0 ? ch.head : null);
      var shown = (n !== null) ? "#" + commas(n) : "";
      var label = n !== null
        ? (open ? t("explorer.live_prefix", "Live • Block #") + commas(n)
          : t("explorer.paused_prefix", "Paused • Block #") + commas(n))
        : (open ? t("explorer.live_prefix", "Live • Block #").replace(/ ?#$/, "")
          : t("explorer.paused_prefix", "Paused • Block #").replace(/ ?#$/, ""));
      void shown;
      while (liveEl.firstChild) liveEl.removeChild(liveEl.firstChild);
      var dot = el(doc, "span", "●", "xplore-live-dot");
      dot.setAttribute("aria-hidden", "true");
      liveEl.appendChild(dot);
      liveEl.appendChild(el(doc, "span", " " + label));
      liveEl.setAttribute("data-state", open ? "live" : "paused");
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
    /* "N seconds ago" label for a head timestamp (original BlockTimeAgo
     * concept, Blocks.jsx:23-48: green-when-fresh rides in CSS). */
    function agoText(newestTs) {
      var sec = 0;
      try { sec = Math.max(0, Math.round((Date.now() - newestTs) / 1000)); } catch (e) { sec = 0; }
      if (sec <= 1) return t("explorer.ago_one", "1 second ago");
      return sec + " " + t("explorer.ago_many_suffix", "seconds ago");
    }
    /* Tip stats strip + two-column activity/blocks layout (original
     * Blocks.jsx:305-504 stat rows + 507-602 activity/blocks pair — concepts
     * only: no React, no perfect-scrollbar). Every cell starts as an honest
     * dash; unreadable reads stay dashes, never guesses. Panel headers are
     * plain divs like the original's block-content-header, so the page keeps
     * exactly one h1 (the shell title, visually folded away in explorer-ui). */
    function paintTip(rows, hd, sets, sup, ops) {
      while (body.firstChild) body.removeChild(body.firstChild);
      var topBox = { top: rows[0].height };
      var liveEl = el(doc, "p", null, "xplore-live");
      liveEl.setAttribute("aria-live", "polite");
      body.appendChild(liveEl);
      paintLive(liveEl, topBox.top);

      /* Newest-first stat rows (timestamps parsed once; unparseable stamps
       * yield null and simply contribute no interval — never guessed). */
      var data = rows.map(function (r) {
        var ms = null;
        try { var v = new Date(r.timestamp).getTime(); if (isFinite(v)) ms = v; } catch (e) { ms = null; }
        return { height: r.height, ts: ms, txs: (typeof r.tx_count === "number" ? r.tx_count : null) };
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
      var statsBox = el(doc, "div", null, "xplore-stats");
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

      /* Stall UI (honest, never frozen-looking): when the head stops
       * advancing for >15s the live line flips to paused and a Retry button
       * appears (re-runs the tip load). Cleared by the next head. */
      var retryBtn = null;
      function clearStall() {
        if (retryBtn && retryBtn.parentNode) {
          try { retryBtn.parentNode.removeChild(retryBtn); } catch (e) { /* gone */ }
        }
        retryBtn = null;
      }
      function ensureStall(top) {
        if (retryBtn) return;
        try {
          paintLive(liveEl, top);
          if (liveEl) liveEl.setAttribute("data-state", "paused");
        } catch (e) { /* label stands */ }
        retryBtn = touchable(el(doc, "button", t("explorer.retry", "Retry")));
        retryBtn.type = "button";
        retryBtn.addEventListener("click", function () {
          stopLive();
          while (body.firstChild) body.removeChild(body.firstChild);
          blocksTab(doc, body, root, myGen, null);
        });
        body.insertBefore(retryBtn, statsBox.nextSibling);
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
        var ivals = stripIntervals();
        while (cBt.val.firstChild) cBt.val.removeChild(cBt.val.firstChild);
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
        while (cTxc.val.firstChild) cTxc.val.removeChild(cTxc.val.firstChild);
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
      /* Freshness ticker (1s): the LAST BLOCK cell counts up until the next
       * head arrives, and trips the stall UI past 15s without a head.
       * Gen-guarded self-clear; stopLive clears on leave. */
      try {
        clearStatTick();
        statTimer = setInterval(function () {
          if (!isCurrent(myGen)) { clearStatTick(); return; }
          try { cLast.val.textContent = agoText(newestTs.ts); } catch (e) { /* next tick */ }
          try {
            var stalled = (Date.now() - newestTs.ts) > 15000;
            if (stalled) ensureStall(headNum);
            else clearStall();
          } catch (e) { /* next tick */ }
        }, 1000);
      } catch (e) { /* static label stands */ }

      /* Two-column activity + blocks (side by side ≥1200px, stacked below). */
      var split = el(doc, "div", null, "xplore-split");
      var actPanel = el(doc, "div", null, "xplore-panel");
      actPanel.appendChild(el(doc, "div", t("explorer.recent_activity", "Recent activity"), "xplore-panel-h"));
      actPanel.appendChild(el(doc, "div", t("explorer.info_h", "INFO"), "xplore-subh"));
      if (!ops || ops.length === 0) {
        actPanel.appendChild(el(doc, "p", t("explorer.no_activity", "No recent activity.") + t("explorer.activity_hint", " New chain operations list here as they arrive."), "muted"));
      } else {
        (ops || []).slice(0, 12).forEach(function (op) {
          var row = el(doc, "div", null, "xplore-act-row");
          row.appendChild(pillFor(doc, op));
          row.appendChild(sentenceFor(doc, op, myGen));
          actPanel.appendChild(row);
        });
      }
      split.appendChild(actPanel);
      var blkPanel = el(doc, "div", null, "xplore-panel");
      blkPanel.appendChild(el(doc, "div", t("explorer.recent_blocks", "Recent blocks"), "xplore-panel-h"));
      var shown = rows.slice(0, TABLE_ROWS);
      var tableRows = shown.map(function (r) {
        var n = r.tx_count;
        return [anchor(doc, "#" + commas(r.height), "#/block/" + r.height),
          fmtTime(r.timestamp || "—"), witnessCell(doc, r.witness, myGen),
          (n === null || n === undefined) ? "—" : String(n)];
      });
      var scroller = scrollTable(doc, [t("explorer.th_height", "Block ID"), t("explorer.th_time", "Date"), t("explorer.th_witness", "Witness"), t("explorer.th_txs", "Transaction count")], tableRows);
      blkPanel.appendChild(scroller);
      split.appendChild(blkPanel);
      body.appendChild(split);

      var tbody = null;
      try { tbody = scroller.querySelector("tbody"); } catch (e) { tbody = null; }
      var oldestRow = shown[shown.length - 1];
      if (oldestRow && oldestRow.height > 1) {
        var older = touchable(el(doc, "button", t("explorer.older", "Older blocks")));
        older.type = "button";
        older.addEventListener("click", function () {
          stopLive();
          while (body.firstChild) body.removeChild(body.firstChild);
          blocksTab(doc, body, root, myGen, oldestRow.height);
        });
        body.appendChild(older);
      }
      if (tbody) startLive(tbody, liveEl, topBox, function (b) {
        var ms = null;
        try { var v = new Date(b.timestamp).getTime(); if (isFinite(v)) ms = v; } catch (e) { ms = null; }
        headNum = b.height;
        data.unshift({ height: b.height, ts: ms, txs: b.tx_count });
        if (data.length > TIP_ROWS) data.length = TIP_ROWS;
        if (ms !== null) newestTs.ts = ms;
        else newestTs.ts = Date.now();
        clearStall();
        bumpLive(liveEl);
        repaint();
      });
    }
    rowsFor(oldest).then(function (rows) {
      if (!isCurrent(myGen)) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      if (rows.length === 0) {
        body.appendChild(el(doc, "p", t("explorer.no_blocks", "No blocks found.") + t("explorer.blocks_hint", " The node returned nothing in this range — try Older blocks or check Settings → Nodes."), "muted"));
        return;
      }
      var isTip = (oldest === null || oldest === undefined);
      if (!isTip) {
        var tableRows = rows.map(function (r) {
          var n = (r.tx_count !== undefined) ? r.tx_count : r.txs;
          return [anchor(doc, "#" + commas(r.height), "#/block/" + r.height),
            fmtTime(r.timestamp || "—"), witnessCell(doc, r.witness, myGen),
            (n === null || n === undefined) ? "—" : String(n)];
        });
        var scroller = scrollTable(doc, [t("explorer.th_height", "Block ID"), t("explorer.th_time", "Date"), t("explorer.th_witness", "Witness"), t("explorer.th_txs", "Transaction count")], tableRows);
        body.appendChild(scroller);
        var oldestRow = rows[rows.length - 1];
        if (oldestRow.height > 1) {
          var older = touchable(el(doc, "button", t("explorer.older", "Older blocks")));
          older.type = "button";
          older.addEventListener("click", function () {
            stopLive();
            while (body.firstChild) body.removeChild(body.firstChild);
            blocksTab(doc, body, root, myGen, oldestRow.height);
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
      var pOps = (typeof Explorer.recentOps === "function") ? failOpen(Explorer.recentOps(12, 8, preBodies), []) : Promise.resolve([]);
      Promise.all([pHd, pSets, pSup, pOps]).then(function (res) {
        if (!isCurrent(myGen)) return;
        paintTip(rows, res[0], res[1], res[2], res[3]);
      });
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      showError(doc, body, e, t("explorer.blocks_failed", "Could not load blocks."));
      var retry = touchable(el(doc, "button", t("explorer.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () {
        stopLive();
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
    /* Block-jump input (original Block.jsx toggleInput/_onKeyDown concept):
     * height -> #/block/N. Plain literals only (no new i18n keys). Invalid
     * input flags aria-invalid instead of navigating anywhere. Built by a
     * function because the success/error paths below clear the wrap and must
     * re-add it (otherwise the pre-load row is wiped on paint). Batch-3 i18n: keyed. */
    function buildJump() {
      var jumpRow = el(doc, "div", null, "xplore-jump");
      jumpRow.appendChild(el(doc, "span", t("explorer.go_to_block_prefix", "Go to block: ")));
      var jumpInput = doc.createElement("input");
      jumpInput.type = "number";
      jumpInput.min = "1";
      jumpInput.step = "1";
      jumpInput.setAttribute("placeholder", t("explorer.height_ph", "height"));
      jumpInput.setAttribute("aria-label", t("explorer.block_height_aria", "Block height"));
      touchable(jumpInput);
      var jumpBtn = touchable(el(doc, "button", t("explorer.go", "Go")));
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
        while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
        wrap.appendChild(el(doc, "h1", t("explorer.block_prefix", "Block #") + b.height));
        wrap.appendChild(buildJump());
        /* Prev/next arrows (original Block.jsx _previousBlock/_nextBlock
         * concept: prev = height - 1, next = height + 1 clamped at head).
         * The height-1 link is the prev-minimum the punchlist requires (a
         * parent-hash row would also satisfy it; the backend strips that
         * field, so height navigation stands). A next past head renders an
         * honest muted note instead of a dead link. Batch-3 i18n: keyed. */
        var nav = el(doc, "div", null, "xplore-blocknav");
        if (b.height > 1) {
          nav.appendChild(anchor(doc, t("explorer.prev_block", "← Prev block"), "#/block/" + (b.height - 1)));
        } else {
          nav.appendChild(el(doc, "span", t("explorer.genesis_first_block", "← Genesis (first block)"), "muted"));
        }
        nav.appendChild(el(doc, "span", " "));
        var headNum = (head && typeof head.head_block_number === "number") ? head.head_block_number : null;
        if (headNum !== null && b.height >= headNum) {
          nav.appendChild(el(doc, "span", t("explorer.next_no_newer_block", "Next → (no newer block yet)"), "muted"));
        } else {
          var nx = anchor(doc, t("explorer.next", "Next →"), "#/block/" + (b.height + 1));
          if (headNum !== null) nx.title = t("explorer.head_prefix", "Head #") + headNum;
          nav.appendChild(nx);
        }
        wrap.appendChild(nav);
        var dl = el(doc, "dl", null, "xplore-fields");
        function row(t, node) {
          dl.appendChild(el(doc, "dt", t));
          var dd = doc.createElement("dd");
          if (typeof node === "string") dd.textContent = node;
          else if (node) dd.appendChild(node);
          dl.appendChild(dd);
        }
        /* Localized full date (original FormattedDate format="full"
         * concept): human string on screen, raw ISO kept in the title. */
        var timeSpan = el(doc, "span", fmtFullDate(b.timestamp || "—"));
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
        var topBtn = touchable(el(doc, "button", t("explorer.return_to_top", "Return to top")));
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
          wrap.appendChild(el(doc, "p", t("explorer.no_txs", "No transactions in this block.") + t("explorer.txs_hint", " Empty blocks carry no transactions — open another block from Recent blocks."), "muted"));
          wrap.appendChild(topBtn);
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
        wrap.appendChild(topBtn);
        void ctx;
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
        wrap.appendChild(el(doc, "h1", t("explorer.block_prefix", "Block #") + h));
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
      if (tx.ops.length === 0) wrap.appendChild(el(doc, "p", t("explorer.no_ops", "No operations in this transaction.") + t("explorer.ops_hint", " Nothing was enclosed — valid, not an error."), "muted"));
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
