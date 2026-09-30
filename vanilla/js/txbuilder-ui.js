/* txbuilder-ui.js — #/txbuilder desk (DOM only; state lives in txbuilder.js).
 *
 * What it owns: queue cards with human dl rows + raw-JSON details + Remove,
 * fees pane, authorities pane, Direct/Proposal send-choice radio, export/import
 * panes, review-then-sign result rendering, header badge count subscription.
 * Consumes: TxBuilder (state/describe/feeAll/resolveAuths/buildUnsigned/
 * signLocal/exportJSON/importJSON), Wallet.isUnlocked (gate only), Chain.status
 * (chain-id line). No keys, no WIFs, no secrets in the DOM ever.
 * Created by: TxBuilder plan 2026-09-30, Task 5.
 */
var TxBuilderUI = (typeof globalThis !== "undefined" && globalThis.TxBuilderUI) ? globalThis.TxBuilderUI : ((typeof TxBuilderUI !== "undefined") ? TxBuilderUI : {});
(function () {
  "use strict";

  /* Batch i18n (slice-17 precedent): display strings resolve via I18n.t
   * with the pre-conversion literal kept verbatim as enDefault
   * (English-identical on any transport, incl. file:// where dict fetch
   * fails). Falls back to the default when i18n.js failed to load: never
   * blank, never throws. vars fills %(name)s placeholders; without I18n
   * the raw default returns unfilled. Dynamic sentences keep their code
   * structure: only complete static literals and word-bearing segments
   * are wrapped, values and punctuation glue stay raw. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* el: build one element with an optional class and text label.
   * Params: tag (string), cls (string or ""), text (string, optional).
   * Returns the new element. Fails: never throws on bad text (String-coerced
   * via textContent assignment). */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (typeof text !== "undefined" && text !== null) n.textContent = text;
    return n;
  }

  /* dlRow: append one labelled value row to a dl element.
   * Params: dl (element), label/value (strings), title (raw-value tooltip,
   * optional). Returns nothing. Fails: never — missing dl is a no-op. */
  function dlRow(dl, label, value, title) {
    if (!dl) return;
    var dt = document.createElement("dt"); dt.textContent = label;
    var dd = document.createElement("dd"); dd.textContent = value;
    if (title) dd.title = title;
    dl.appendChild(dt); dl.appendChild(dd);
  }

  /* Render one queued op card: title + human rows + raw details + Remove.
   * Params: wrap (element receiving the card), entry ({key, opId, opData,
   * source} from TxBuilder.list()). Returns a promise (describe is async).
   * Fails: never throws — describe errors render as an Error row. */
  async function renderCard(wrap, entry) {
    var card = el("div", "card tb-card");
    var h = el("h3", null, (entry.source || ("op " + entry.opId)));
    card.appendChild(h);
    var dl = el("dl", "dl");
    card.appendChild(dl);
    try {
      var rows = await TxBuilder.describe(entry.opId, entry.opData);
      rows.forEach(function (r) { dlRow(dl, r.label, r.value, r.title); });
    } catch (e) { dlRow(dl, t("txbuilder.error_label", "Error"), String((e && e.message) || e)); }
    var det = document.createElement("details");
    var sum = document.createElement("summary"); sum.textContent = t("txbuilder.raw_summary", "Raw operation JSON");
    var pre = document.createElement("pre"); pre.textContent = JSON.stringify([entry.opId, entry.opData], null, 2);
    try { pre.style.whiteSpace = "pre-wrap"; pre.style.wordBreak = "break-word"; } catch (e) { /* native pre stands */ }
    det.appendChild(sum); det.appendChild(pre); card.appendChild(det);
    var rm = el("button", "btn danger", t("txbuilder.remove", "Remove"));
    rm.setAttribute("type", "button");
    rm.addEventListener("click", function () { TxBuilder.removeOp(entry.key); renderDesk(wrap); });
    card.appendChild(rm);
    wrap.appendChild(card);
  }

  /* Full desk: queue | fees+auths grid, send choice, export/import.
   * Params: root (route container, emptied first). Returns a promise
   * (awaits one renderCard per queued op). Fails: never throws — fee/auth/
   * export failures render inline in their own panes. */
  async function renderDesk(root) {
    root.innerHTML = "";
    var wrap = el("div", "wrap wide"); root.appendChild(wrap);
    wrap.appendChild(el("h2", null, t("txbuilder.title", "Transaction Builder")));
    var st = TxBuilder.state();
    if (!st.ops.length) {
      var empty = el("p", "empty", t("txbuilder.empty", "No operations queued. Build one from Transfer, Voting, or Pools — each confirm screen offers Add to TxBuilder — then review it here."));
      wrap.appendChild(empty);
      var links = el("p", null, "");
      [[ "#/transfer", t("txbuilder.link_transfer", "Transfer") ], [ "#/voting", t("txbuilder.link_voting", "Voting") ], [ "#/pools", t("txbuilder.link_pools", "Pools") ]].forEach(function (pair) {
        var a = document.createElement("a"); a.href = pair[0]; a.textContent = pair[1]; a.style.marginRight = "12px";
        try { a.style.display = "inline-block"; a.style.padding = "10px 12px"; } catch (e) { /* native link stands */ }
        links.appendChild(a);
      });
      wrap.appendChild(links);
      return;
    }
    var grid = el("div", "tb-grid"); wrap.appendChild(grid);
    try {
      grid.style.display = "grid"; grid.style.gap = "12px";
      grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(280px, 1fr))";
    } catch (e) { /* class-only stacking stands */ }
    var qcol = el("div", "tb-col"); qcol.appendChild(el("h3", null, t("txbuilder.queue_tpl", "Queue (%(n)s)", { n: st.ops.length })));
    grid.appendChild(qcol);
    for (var i = 0; i < st.ops.length; i++) { await renderCard(qcol, st.ops[i]); }
    var scol = el("div", "tb-col"); grid.appendChild(scol);
    var feeBtn = el("button", "btn", t("txbuilder.quote_fees", "Quote fees"));
    feeBtn.setAttribute("type", "button");
    var feeOut = el("p", "tb-fees", st.fees ? (t("txbuilder.total_prefix", "Total ") + st.fees.totalDisplay) : t("txbuilder.fees_pending", "Fees not quoted yet."));
    feeBtn.addEventListener("click", async function () {
      feeBtn.disabled = true;
      try { var f = await TxBuilder.feeAll(); feeOut.textContent = t("txbuilder.fees_total_tpl", "Total %(total)s (%(raw)s raw)", { total: f.totalDisplay, raw: f.totalRaw }); }
      catch (e) { feeOut.textContent = t("txbuilder.fee_error_prefix", "Fee error: ") + String((e && e.message) || e); }
      feeBtn.disabled = false;
    });
    scol.appendChild(feeBtn);
    scol.appendChild(feeOut);
    var authBtn = el("button", "btn", t("txbuilder.resolve_auths", "Resolve authorities"));
    authBtn.setAttribute("type", "button");
    var authOut = el("div", "tb-auths");
    authBtn.addEventListener("click", async function () {
      authBtn.disabled = true; authOut.innerHTML = "";
      try {
        var rows = await TxBuilder.resolveAuths();
        rows.forEach(function (r) {
          authOut.appendChild(el("p", null, (r.missing ? "… " : "✓ ") + r.accountName + " (" + r.accountId + ") — " + r.level + t("txbuilder.threshold_mid", " threshold ") + r.threshold + (r.missing ? t("txbuilder.unsigned_mid", " — unsigned for ") + r.accountName + t("txbuilder.no_key_suffix", " (no local key)") : t("txbuilder.key_ok_suffix", " — key available")) + (r.note ? " [" + r.note + "]" : "")));
        });
      } catch (e) { authOut.appendChild(el("p", "error", t("txbuilder.auth_error_prefix", "Auth error: ") + String((e && e.message) || e))); }
      authBtn.disabled = false;
    });
    scol.appendChild(authBtn); scol.appendChild(authOut);
    var chainP = el("p", "muted", t("txbuilder.chain_prefix", "Chain: ") + (st.chainId ? st.chainId.slice(0, 8) : t("txbuilder.chain_pending", "not built yet")));
    scol.appendChild(chainP);
    var expBtn = el("button", "btn", t("txbuilder.export_btn", "Export JSON"));
    expBtn.setAttribute("type", "button");
    var expArea = document.createElement("textarea"); expArea.rows = 6; expArea.placeholder = t("txbuilder.export_ph", "Export payload appears here");
    try { expArea.style.width = "100%"; expArea.style.maxWidth = "100%"; expArea.style.boxSizing = "border-box"; } catch (e) { /* native area stands */ }
    expBtn.addEventListener("click", async function () {
      try { if (!st.built) await TxBuilder.buildUnsigned(); expArea.value = TxBuilder.exportJSON(); }
      catch (e) { expArea.value = t("txbuilder.export_error_prefix", "Export error: ") + String((e && e.message) || e); }
    });
    scol.appendChild(expBtn); scol.appendChild(expArea);
    var impArea = document.createElement("textarea"); impArea.rows = 6; impArea.placeholder = t("txbuilder.import_ph", "Paste an export payload, then Import");
    try { impArea.style.width = "100%"; impArea.style.maxWidth = "100%"; impArea.style.boxSizing = "border-box"; } catch (e) { /* native area stands */ }
    var impBtn = el("button", "btn", t("txbuilder.import_btn", "Import JSON"));
    impBtn.setAttribute("type", "button");
    impBtn.addEventListener("click", function () {
      try { TxBuilder.importJSON(impArea.value); renderDesk(root); }
      catch (e) { impArea.value = t("txbuilder.import_error_prefix", "Import error: ") + String((e && e.message) || e); }
    });
    scol.appendChild(impArea); scol.appendChild(impBtn);
  }

  /* Header badge: count only, hidden at 0, links to the desk.
   * Params: none (queries .topbar/header/body once, then subscribes).
   * Returns nothing. Fails: never throws — missing TxBuilder is a silent
   * no-op so routes render without the composer loaded. */
  function mountBadge() {
    if (document.getElementById("tb-badge") || typeof TxBuilder === "undefined") return;
    var bar = document.querySelector(".topbar") || document.querySelector("header") || document.body;
    var a = document.createElement("a");
    a.id = "tb-badge"; a.href = "#/txbuilder"; a.style.display = "none";
    try {
      a.style.minHeight = "44px"; a.style.display = "none";
      a.style.alignItems = "center"; a.style.padding = "0 8px";
    } catch (e) { /* native link stands */ }
    bar.appendChild(a);
    function paint(s) {
      try {
        a.style.display = s.ops.length ? "inline-flex" : "none";
        a.textContent = t("txbuilder.badge_tpl", "TxBuilder (%(n)s)", { n: s.ops.length });
      } catch (e) { /* badge keeps prior state */ }
    }
    TxBuilder.subscribe(paint);
    try { paint(TxBuilder.state()); } catch (e) { /* subscription paints next */ }
  }

  /* renderDeskInto: router-facing alias (keeps the route entry one line).
   * Params: root (route container passed through to renderDesk).
   * Returns the renderDesk promise (fire-and-forget at the call site).
   * Fails: same as renderDesk — never throws. */
  function renderDeskInto(root) { renderDesk(root); }

  TxBuilderUI.renderDesk = renderDeskInto;
  TxBuilderUI.mountBadge = mountBadge;
  if (typeof globalThis !== "undefined") { globalThis.TxBuilderUI = TxBuilderUI; }
})();

if (typeof module !== "undefined") { module.exports = TxBuilderUI; }
