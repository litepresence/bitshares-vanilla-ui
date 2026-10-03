/* EsLabResults: result-pane rendering for the #/es-lab desk (parsed tables +
 * honest panels). Owns: per-kind tables (ops/holders/agg), the empty-result
 * line, and the failure panels (disabled/unavailable/timeout/shape/offline).
 * The raw JSON <pre> stays owned by the desk shell (es-lab-ui.js) — raw is
 * always shown, parsed tables never replace it.
 * Consumes: Format.formatAmount (holder balances + asset precision, raw in
 *   title), I18n.t (verbatim en defaults). No Chain, no fetch, no store.
 * Globals/side effects: global EsLabResults only; DOM only inside the box
 *   handed in. textContent-only insertion (index strings never reach HTML).
 * Created by: es-lab design 2026-10-03 Task 6 (desk split — shell renders,
 *   this file explains). Refs: holdersSection
 *   (views/explorer-assets.js:868-956 — table + unavailable-notice pattern).
 */
var EsLabResults = (function () {
  "use strict";

  var ID_RE = /^[0-9.]+$/;

  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function touchable(n) { try { n.style.minHeight = "44px"; } catch (e) { /* stands */ } return n; }

  /* HINTS: human-reading line per kind (principle #6 — raw stays raw, the
   * hint tells the reader how to read it). */
  var HINTS = {
    ops: ["eslab.hint_ops", "Times are block times (UTC); type ids map via the operation table."],
    holders: ["eslab.hint_holders", "Balances are raw integers — divide by the asset precision."],
    agg: ["eslab.hint_agg", "Counts over the window; shares are exact integer-math percents."]
  };
  var GENERIC_HINT = ["eslab.hint_generic", "Raw index JSON below, untouched. Balances are raw integers — divide by asset precision; percent fields are hundredths of a percent (2000 = 20%)."];

  /* link: safe in-app anchor for addressing ids. Params: doc, kind
   * ("account"|"block"), id. Returns <a> or plain-text span. Fails: never
   * (non-addressing ids render as inert text — never linked). */
  function link(doc, kind, id) {
    var href = null;
    if (typeof id === "string" && ID_RE.test(id)) {
      href = (kind === "account") ? ("#/account/" + id) : (kind === "block" ? ("#/block/" + id) : null);
    }
    if (!href) {
      var s = el(doc, "span", (id === null || id === undefined) ? "?" : String(id), null);
      return s;
    }
    var a = doc.createElement("a");
    a.href = href;
    a.textContent = id;
    return a;
  }

  /* table: node-table shell with header row. Params: doc, heads array.
   * Returns {table, tbody}. Fails: never. */
  function table(doc, heads) {
    var scroller = el(doc, "div", null, "xplore-scroll");
    try { scroller.style.overflowX = "auto"; } catch (e) { /* stands */ }
    var tb = doc.createElement("table");
    tb.className = "node-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    heads.forEach(function (h) { hr.appendChild(el(doc, "th", h, null)); });
    thead.appendChild(hr);
    tb.appendChild(thead);
    var body = doc.createElement("tbody");
    tb.appendChild(body);
    scroller.appendChild(tb);
    return { wrap: scroller, tbody: body };
  }

  /* fmtBalance: human balance cell. Params: doc, raw string, prec (number
   * or null). Returns the <td> (formatted + raw title, or raw + unknown
   * title when precision is missing). Fails: never. */
  function fmtBalance(doc, raw, prec) {
    var td = doc.createElement("td");
    if (typeof prec === "number") {
      try {
        td.textContent = Format.formatAmount(String(raw), prec);
        td.title = String(raw);
        return td;
      } catch (e) { /* raw below */ }
    }
    td.textContent = String(raw);
    td.title = t("eslab.prec_unknown", "Precision unknown — raw integer.");
    return td;
  }

  /* settingsLink: action link to Settings (every honest panel offers the
   * fix, never just the complaint). */
  function settingsLink(doc) {
    var a = doc.createElement("a");
    a.href = "#/settings";
    a.textContent = t("eslab.settings_link", "Open Settings");
    try { a.style.display = "inline-flex"; a.style.alignItems = "center"; a.style.minHeight = "44px"; } catch (e) { /* stands */ }
    return a;
  }

  /* panel: honest-failure box (notice + optional retry + settings link).
   * Params: doc, box, msgKey/dflt, onRetry (fn or null). */
  function panel(doc, box, key, dflt, onRetry) {
    box.appendChild(el(doc, "p", t(key, dflt), "muted"));
    var row = el(doc, "p", null, null);
    if (typeof onRetry === "function") {
      var rb = touchable(el(doc, "button", t("eslab.retry", "Retry")));
      rb.type = "button";
      rb.addEventListener("click", onRetry);
      row.appendChild(rb);
      try { rb.style.marginRight = "8px"; } catch (e) { /* stands */ }
    }
    row.appendChild(settingsLink(doc));
    box.appendChild(row);
  }

  /* render: fill the result box. Params: doc, box, entry, outcome, ctx.
   * outcome: {ok:true, kind, rows} | {ok:false, error}. ctx: {precMap
   * (assetId->prec|null), onRetry (fn|null), setHint (fn)}. Never throws;
   * every path lands SOMETHING (belt-and-braces — the desk must never show
   * a silently empty box). */
  function render(doc, box, entry, outcome, ctx) {
    ctx = ctx || {};
    function hint(pair) {
      try { if (typeof ctx.setHint === "function") ctx.setHint(t(pair[0], pair[1])); } catch (e) { /* hint stands */ }
    }
    try {
      if (!outcome || !outcome.ok) {
        var msg = (outcome && outcome.error && outcome.error.message) || String((outcome && outcome.error) || "");
        var retry = (typeof ctx.onRetry === "function") ? ctx.onRetry : null;
        if (msg === "es-disabled") { panel(doc, box, "eslab.disabled_notice", "Community history is off — enable it in Settings to run index queries.", null); hint(GENERIC_HINT); return; }
        if (msg === "es-unavailable" || msg === "es-timeout") { panel(doc, box, "eslab.unavailable_notice", "Index unreachable. Check your connection and retry, or review Settings.", retry); hint(GENERIC_HINT); return; }
        if (msg === "not-connected") { panel(doc, box, "eslab.no_socket", "Wallet is offline — connect a node in Settings to resolve account names (or type a 1.2.x id).", null); hint(GENERIC_HINT); return; }
        if (msg && msg.indexOf("es-shape") === 0) { panel(doc, box, "eslab.shape_notice", "Index returned an unexpected shape — raw JSON below, nothing parsed.", retry); hint(GENERIC_HINT); return; }
        box.appendChild(el(doc, "p", msg || t("eslab.unavailable_notice", "Index unreachable. Check your connection and retry, or review Settings."), "error"));
        if (retry) {
          var row = el(doc, "p", null, null);
          var rb = touchable(el(doc, "button", t("eslab.retry", "Retry")));
          rb.type = "button";
          rb.addEventListener("click", retry);
          row.appendChild(rb);
          box.appendChild(row);
        }
        hint(GENERIC_HINT);
        return;
      }
      var kind = outcome.kind || (entry && entry.kind) || "raw";
      var rows = Array.isArray(outcome.rows) ? outcome.rows : [];
      if (kind === "raw" || !rows) { hint(GENERIC_HINT); return; }
      if (!rows.length) {
        box.appendChild(el(doc, "p", t("eslab.no_rows", "0 rows — the index returned nothing for this query."), "muted"));
        hint(HINTS[kind] || GENERIC_HINT);
        return;
      }
      if (kind === "ops") {
        var ot = table(doc, ["Time (UTC)", "Block", "Op"]);
        rows.forEach(function (r) {
          var tr = doc.createElement("tr");
          tr.appendChild(el(doc, "td", r.time || "?", null));
          var tdB = doc.createElement("td");
          tdB.appendChild(link(doc, "block", (r.block === null || r.block === undefined) ? null : String(r.block)));
          tr.appendChild(tdB);
          tr.appendChild(el(doc, "td", (r.name || "?") + (r.type === null ? "" : " (" + r.type + ")"), null));
          ot.tbody.appendChild(tr);
        });
        box.appendChild(ot.wrap);
        hint(HINTS.ops);
        return;
      }
      if (kind === "holders") {
        var precMap = (ctx.precMap && typeof ctx.precMap === "object") ? ctx.precMap : {};
        var ht = table(doc, ["Account", "Balance"]);
        rows.forEach(function (r) {
          var tr = doc.createElement("tr");
          var tdA = doc.createElement("td");
          tdA.appendChild(link(doc, "account", r.owner));
          tr.appendChild(tdA);
          var prec = Object.prototype.hasOwnProperty.call(precMap, r.asset) ? precMap[r.asset] : null;
          tr.appendChild(fmtBalance(doc, r.balance, (typeof prec === "number") ? prec : null));
          ht.tbody.appendChild(tr);
        });
        box.appendChild(ht.wrap);
        hint(HINTS.holders);
        return;
      }
      if (kind === "agg") {
        var at = table(doc, ["Type", "Count", "Share"]);
        rows.forEach(function (r) {
          var tr = doc.createElement("tr");
          tr.appendChild(el(doc, "td", (r.name || "?") + " (" + r.type + ")", null));
          tr.appendChild(el(doc, "td", String(r.count), null));
          tr.appendChild(el(doc, "td", r.share, null));
          at.tbody.appendChild(tr);
        });
        box.appendChild(at.wrap);
        hint(HINTS.agg);
        return;
      }
      hint(GENERIC_HINT);
    } catch (e) {
      try {
        while (box.firstChild) box.removeChild(box.firstChild);
        panel(doc, box, "eslab.shape_notice", "Index returned an unexpected shape — raw JSON below, nothing parsed.", null);
      } catch (e2) { /* box stands */ }
    }
  }

  return { render: render };
})();

if (typeof module !== "undefined") { module.exports = EsLabResults; }
