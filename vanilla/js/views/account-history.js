/* account-history.js — account page orders + history sections.
 *
 * What it owns: OP_KEYS/OP_LABELS (op labels — AccountUI re-exports
 *   OP_LABELS so dashboard-ui.js keeps working), opTypeOf/opLabel/timeText,
 *   orderCells/renderOpenOrders (read-only table + phone cards; cancel
 *   lives on the market desk by design), renderHistory (time + label +
 *   raw-JSON details list). Consumes: TableRenderer (open-orders table
 *   shell), I18n.t (display strings) — script-tag globals guarded at call
 *   time. Globals/side effects: DOM under the given section element only;
 *   attaches AccountUI._history and republishes globalThis.AccountUI.
 *   Read-only. Split from account-ui.js (mechanical move, zero behavior
 *   change — called by AccountUI.showAccount via the facade registry).
 *   Facade: account-ui.js. Load order in index.html: account-portfolio.js,
 *   account-history.js, account-membership.js, account-ui.js (facade last).
 * Created by: split_responsibility.py account/market frontier.
 */
var AccountUI = (typeof globalThis !== "undefined" && globalThis.AccountUI) ? globalThis.AccountUI : ((typeof AccountUI !== "undefined") ? AccountUI : {});
AccountUI._history = AccountUI._history || {};
(function () {
  "use strict";

  /* Verbatim copy of account-ui.js t (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Batch-2a i18n: display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back
   * to the default when i18n.js failed to load: never blank, never throws.
   * vars fills %(name)s placeholders (Reference #6 shape); without I18n
   * the raw default returns unfilled — i18n.js is a local script tag,
   * absent only when the file itself is missing. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Verbatim copy of account-ui.js decFrac (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /** Decimal string -> {num, den} BigInts ("12.5" -> 125n/10n), or null on
   * any other shape. Integer-only; feeds exact BTS-value multiplication
   * (binary float for money is a bug, not a shortcut).
   * TYPE NOTE: explicit bigint return pins decFrac against tsc's evolving-any
   * inference (bare `var num` + try/catch reads back as number at the
   * multiply site). No shared vanilla/js/api/types.js exists yet (group 1
   * owns it); this local annotation stands alone, nothing to merge.
   * @param {any} s display decimal (string expected, anything coerced)
   * @returns {{num: bigint, den: bigint} | null} exact ratio, UNREDUCED */
  function decFrac(s) {
    if (typeof s !== "string") s = String(s === null || s === undefined ? "" : s);
    var m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
    if (!m) return null;
    var frac = m[2] || "";
    var num;
    try { num = BigInt(m[1] + frac); } catch (e) { return null; }
    var den = 1n, i;
    for (i = 0; i < frac.length; i++) den *= 10n;
    return { num: num, den: den };
  }

  /* Operation type -> i18n key (batch-2a; op 0 reuses transfer.title,
   * byte-identical "Transfer"). OP_LABELS stays the verbatim English
   * source (still exported); opLabel() resolves through t() at render
   * time so locale switches apply without a reload. */
  var OP_KEYS = {
    0: "transfer.title",
    1: "account.op_limit_create",
    2: "account.op_limit_cancel",
    3: "account.op_call_update",
    4: "account.op_fill",
    5: "account.op_account_create",
    6: "account.op_account_update",
    7: "account.op_whitelist",
    8: "account.op_upgrade",
    9: "account.op_account_transfer",
    10: "account.op_asset_create"
  };

  /* Operation type -> human label (spec verbatim, 0..10). The values are
   * the t() enDefaults (see OP_KEYS); the object stays exported raw. */
  var OP_LABELS = {
    0: "Transfer",
    1: "Limit order create",
    2: "Limit order cancel",
    3: "Call order update",
    4: "Fill order",
    5: "Account create",
    6: "Account update",
    7: "Account whitelist",
    8: "Account upgrade",
    9: "Account transfer",
    10: "Asset create"
  };

  /* Extract the numeric op type from a get_account_history row, or null
   * when the shape is unrecognized (caller falls back to a generic label). */
  function opTypeOf(row) {
    if (!row || typeof row !== "object") return null;
    if (Array.isArray(row.op) && typeof row.op[0] === "number") return row.op[0];
    if (typeof row.op_type === "number") return row.op_type;
    if (typeof row.type === "number") return row.type;
    return null;
  }

  /* Human label for an op type number; unknown numbers stay identifiable. */
  function opLabel(n) {
    if (typeof n === "number" && Object.prototype.hasOwnProperty.call(OP_LABELS, n)) {
      return t(OP_KEYS[n], OP_LABELS[n]);
    }
    return t("account.op_unknown", "Operation #%(n)s", {n: String(n)});
  }

  /* Best-effort time text for a history row: chain timestamp when present,
   * else the block number, else the row id. Never blank, never computed. */
  function timeText(row) {
    if (row.timestamp) return String(row.timestamp);
    if (row.time) return String(row.time);
    if (row.block_time) return String(row.block_time);
    if (row.block_num !== undefined && row.block_num !== null) {
      return t("account.block_prefix", "block #") + String(row.block_num);
    }
    if (row.id) return String(row.id);
    return t("settings.dash", "—");
  }

  /* Punchlist i18n note: NEW display strings in this portfolio block are
   * plain literals on purpose — tooling/check_i18n.py requires every t()
   * key to exist in all 10 locale dicts, and this single-file punchlist
   * cannot touch vanilla/locales/*.json (commit scope: this file only).
   * The next i18n batch converts these literals; until then the English
   * source stays visible instead of failing the gate. Reused t() calls
   * below cite pre-existing keys with byte-identical defaults only. */

  /* orderCells: one open order -> plain display-string row (TableRenderer
   * pilot: the cell math moved verbatim from the renderOpenOrders row builder
   * below — display + symbol + raw titles, never raw integers on screen. The
   * raw titles ride the row object; TableRenderer has no title contract, so
   * the render restores them in one post-pass — moved, not dropped).
   * Params: o (Account.openOrders row). Returns {sell, sellTitle, buy,
   * buyTitle, price, order} strings. Never throws. */
  function orderCells(o) {
    return {
      sell: o.sell.display + " " + o.sell.symbol,
      sellTitle: o.sell.raw,
      buy: o.buy.display + " " + o.buy.symbol,
      buyTitle: o.buy.raw,
      price: o.priceDisplay,
      order: o.id
    };
  }

  /* Open-orders section: table + phone cards, same patterns as balances.
   * Read-only by design (cancel lives on the market desk). Each row shows
   * what the order sells, what it asks at what price, plus id/expiration. */
  function renderOpenOrders(doc, section, orders) {
    if (!orders || orders.length === 0) {
      var empty = doc.createElement("p");
      empty.className = "muted";
      empty.textContent = t("account.s2", "No open orders.") + t("account.orders_hint", " Place one from the trade form on a market page — open orders list here until filled or cancelled.");
      section.appendChild(empty);
      return;
    }
    /* TableRenderer pilot: the table shell comes from the shared renderer
     * (same Sell/Buy/Price/Order titles, order, and left alignment as the
     * hand-built table it replaces — no keys, classes, or clicks before,
     * none added). Cards + raw details below are unchanged. */
    var rows = orders.map(orderCells);
    var table = TableRenderer.render({
      columns: [
        { key: "sell", title: t("account.sell_th", "Sell") },
        { key: "buy", title: t("account.buy_th", "Buy") },
        { key: "price", title: t("account.price_th", "Price") },
        { key: "order", title: t("account.order_th", "Order") }
      ],
      rows: rows,
      stickyFirstCol: true
    });
    /* Title pass: raw amounts ride the row objects (see orderCells) and land
     * back on the sell/buy cells here — same strings as before. */
    try {
      var bodies = table.getElementsByTagName("tbody");
      var trs = bodies.length ? bodies[0].rows : [];
      for (var ti = 0; ti < trs.length && ti < rows.length; ti++) {
        var cells = trs[ti].cells;
        if (cells && cells.length >= 2 && rows[ti]) {
          cells[0].title = rows[ti].sellTitle;
          cells[1].title = rows[ti].buyTitle;
        }
      }
    } catch (e) { /* table stands without raw titles */ }
    section.appendChild(table);

    var cards = doc.createElement("div");
    cards.className = "node-cards";
    orders.forEach(function (o) {
      var card = doc.createElement("div");
      card.className = "node-card";
      var line = doc.createElement("div");
      line.textContent = t("account.sell_prefix", "Sell ") + o.sell.display + " " + o.sell.symbol +
        t("account.for_mid", " for ") + o.buy.display + " " + o.buy.symbol;
      card.appendChild(line);
      var meta = doc.createElement("div");
      meta.className = "muted";
      meta.textContent = o.id + " @ " + o.priceDisplay;
      card.appendChild(meta);
      cards.appendChild(card);
    });
    section.appendChild(cards);
    var detOrd = doc.createElement("details");
    detOrd.className = "raw";
    var sumOrd = doc.createElement("summary");
    sumOrd.setAttribute("aria-label", t("account.orders_json_label", "Show raw orders JSON"));
    detOrd.appendChild(sumOrd);
    var preOrd = doc.createElement("pre");
    try { preOrd.textContent = JSON.stringify(orders, null, 2); }
    catch (e) { preOrd.textContent = String(orders); }
    detOrd.appendChild(preOrd);
    section.appendChild(detOrd);
  }

  /* History section: one row per op (time + label + raw JSON details).
   * Plain list (no table) so it is readable from 360px to 4K as-is. */
  function renderHistory(doc, section, rows) {
    if (!rows || rows.length === 0) {
      var empty = doc.createElement("p");
      empty.className = "muted";
      empty.textContent = t("account.s3", "No recent activity.") + t("account.activity_hint", " Transfers, orders, and fills list here once they happen.");
      section.appendChild(empty);
      return;
    }
    var ul = doc.createElement("ul");
    rows.forEach(function (row) {
      var li = doc.createElement("li");
      var n = opTypeOf(row);
      var head = doc.createElement("div");
      head.textContent = timeText(row) + " — " +
        (n === null ? t("account.unknown_operation", "Unknown operation") : opLabel(n));
      li.appendChild(head);
      var details = doc.createElement("details");
      details.className = "raw";
      var summary = doc.createElement("summary");
      summary.setAttribute("aria-label", t("account.op_json_label", "Show raw operation JSON"));
      details.appendChild(summary);
      var pre = doc.createElement("pre");
      try {
        pre.textContent = JSON.stringify(row);
      } catch (e) {
        pre.textContent = String(row);
      }
      details.appendChild(pre);
      li.appendChild(details);
      ul.appendChild(li);
    });
    section.appendChild(ul);
  }
  AccountUI._history.OP_LABELS = OP_LABELS;
  AccountUI._history.renderOpenOrders = renderOpenOrders;
  AccountUI._history.renderHistory = renderHistory;
  if (typeof globalThis !== "undefined") { globalThis.AccountUI = AccountUI; }
})();

if (typeof module !== "undefined") { module.exports = AccountUI; }
