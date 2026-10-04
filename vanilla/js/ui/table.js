/* ui/table.js — shared table renderer (textContent-only, no hover-only UI).
 * Owns: table/thead/tbody construction for tabular views — one <td> per
 *   column per row, data-k attrs, data-rowkey keys, optional row classes and
 *   click+keyboard row activation.
 * Consumes: DOM global (el — never reimplemented here; raw
 *   doc.createElement fallback when DOM is absent, e.g. minimal test docs),
 *   global document at render time (set by the browser; tests set it to a
 *   fake doc). Sticky first column, striping, and uppercase headers come from
 *   the existing .node-table rules in vanilla/css/app.css (app.css:175-179
 *   sticky :first-child, :335-336 uppercase th, :598-600 striping) — no new
 *   CSS here. Right alignment uses inline style.textAlign (fees-ui.js
 *   moneyCell precedent); the .num class alternative only right-aligns
 *   inside table.pools-table (app.css:569), so it would silently misalign in
 *   other views.
 * Side effects: creates DOM elements + per-row listeners only; no storage,
 *   no network, no globals besides window.TableRenderer.
 * Origin: Task 3.4 of docs/superpowers/plans/2026-10-04-shared-utilities-refactor.md;
 *   extracts the thead/tbody pattern repeated in market-desk.js (paintFills),
 *   explorer-blocks.js (scrollTable), pool-ui.js (poolTable), and ~18 more
 *   view files (common subset only — sorting, links, and cards stay per-view).
 * No deps, ES5, works on file:// and http:// (classic script tag). */
var TableRenderer = (function () {
  /* Resolve the shared DOM helper without capturing it (script order in
   * index.html guarantees window.DOM exists before this file runs).
   * @return {object|null} DOM global or null when absent.
   * Failure: returns null — callers fall back to raw doc.createElement. */
  function dom() {
    if (typeof DOM !== "undefined" && DOM) return DOM;
    return null;
  }

  /* Cell/heading text for a plain-object row: null/undefined render as an
   * empty string (never "null"/"undefined"); content choice (dashes, links)
   * stays the caller's job — this renderer never invents display text.
   * @param {*} value raw cell value (rows are plain objects).
   * @return {string} textContent-safe string.
   * Failure: objects stringify via String() (never throws on plain data). */
  function cellText(value) {
    if (value === undefined || value === null) return "";
    return String(value);
  }

  /* Build one <th>: title via textContent, scope="col" (uppercase comes from
   * the existing .node-table th rule), right align when asked.
   * @param {Document} doc owner document.
   * @param {object|null} D DOM helper or null for the raw fallback.
   * @param {object} col column spec {key, title, align}.
   * @return {HTMLElement} th element (unattached).
   * Failure: missing title renders empty (never throws). */
  function headCell(doc, D, col) {
    var th = D ? D.el(doc, "th", cellText(col && col.title)) : doc.createElement("th");
    if (!D) th.textContent = cellText(col && col.title);
    th.setAttribute("scope", "col");
    if (col && col.align === "right") th.style.textAlign = "right";
    return th;
  }

  /* Build one <td>: value via textContent only, data-k = column key, right
   * align when asked.
   * @param {Document} doc owner document.
   * @param {object|null} D DOM helper or null for the raw fallback.
   * @param {object} row plain-object row.
   * @param {object} col column spec {key, title, align}.
   * @return {HTMLElement} td element (unattached).
   * Failure: missing key renders empty (never throws). */
  function bodyCell(doc, D, row, col) {
    var key = col ? col.key : "";
    var td = D ? D.el(doc, "td", cellText(row ? row[key] : "")) : doc.createElement("td");
    if (!D) td.textContent = cellText(row ? row[key] : "");
    td.setAttribute("data-k", cellText(key));
    if (col && col.align === "right") td.style.textAlign = "right";
    return td;
  }

  /* Wire click + keyboard activation on a row. Tabindex + Enter/Space keeps
   * the row operable on tap and keyboard (principle #7: no hover-only UI —
   * a real click listener, never mouseenter).
   * @param {HTMLElement} tr row element.
   * @param {object} row plain-object row passed to the handler.
   * @param {function} handler onRowClick(row, event).
   * Failure: no-op when addEventListener is absent (minimal docs). */
  function activatable(tr, row, handler) {
    if (!tr || typeof tr.addEventListener !== "function") return tr;
    tr.setAttribute("tabindex", "0");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", function (evt) { handler(row, evt); });
    tr.addEventListener("keydown", function (evt) {
      var key = evt ? evt.key : "";
      var code = evt ? evt.keyCode : 0;
      if (key === "Enter" || key === " " || code === 13 || code === 32) {
        if (key === " " && evt && typeof evt.preventDefault === "function") evt.preventDefault();
        handler(row, evt);
      }
    });
    return tr;
  }

  /* Render a table from column specs + plain-object rows.
   * @param {object} cfg {columns, rows, keyExtractor, rowClass, onRowClick,
   *   stickyFirstCol} — columns: [{key, title, align}] with align
   *   "left"/"right" (default left); rows: plain objects; keyExtractor(row)
   *   -> data-rowkey string (omitted when absent/null); rowClass(row) ->
   *   extra class string; onRowClick(row, event) per-row click + Enter/Space;
   *   stickyFirstCol: kept for call-site intent, default true — the sticky
   *   behavior is inherent to the .node-table class (app.css has no opt-out),
   *   so true and false render identically today (documented, not silent: a
   *   future opt-out class would land in CSS first).
   * @return {HTMLTableElement} <table class="node-table"> (unattached).
   * Failure: throws when no document is available (browser global or test
   *   fake); null/undefined cfg renders an empty table (never throws). */
  function render(cfg) {
    var doc = (typeof document !== "undefined" && document && document.createElement) ? document : null;
    if (!doc) throw new Error("TableRenderer.render: no document available");
    cfg = cfg || {};
    var D = dom();
    var columns = cfg.columns || [];
    var rows = cfg.rows || [];
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    var i;
    for (i = 0; i < columns.length; i++) {
      hr.appendChild(headCell(doc, D, columns[i]));
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    for (i = 0; i < rows.length; i++) {
      (function (row) {
        var tr = doc.createElement("tr");
        var k = (typeof cfg.keyExtractor === "function") ? cfg.keyExtractor(row) : null;
        if (k !== undefined && k !== null && k !== "") tr.setAttribute("data-rowkey", String(k));
        if (typeof cfg.rowClass === "function") {
          var extra = cfg.rowClass(row);
          if (extra) tr.className = String(extra);
        }
        var j;
        for (j = 0; j < columns.length; j++) {
          tr.appendChild(bodyCell(doc, D, row, columns[j]));
        }
        if (typeof cfg.onRowClick === "function") activatable(tr, row, cfg.onRowClick);
        tbody.appendChild(tr);
      })(rows[i]);
    }
    table.appendChild(tbody);
    return table;
  }

  return {
    render: render
  };
})();

if (typeof window !== "undefined") /** @type {any} */ (window).TableRenderer = TableRenderer;
if (typeof module !== "undefined") module.exports = TableRenderer;
