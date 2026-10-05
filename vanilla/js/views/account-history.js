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

  /* 4-sig-fig price display (global price rule, Format.priceSig): open-order
   * prices read ps(); sell/buy amounts are NOT prices and stay untouched.
   * Guarded (format.js loads before views, but the table must never blank):
   * absent Format renders the 8-place string as today. No title exists on
   * the price cell today and none is added — raw legs ride the sell/buy
   * titles and the raw-orders JSON details block below. */
  function ps(s) {
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.priceSig === "function") {
        var sig = Format.priceSig(s);
        if (typeof sig === "string" && sig) return sig;
      }
    } catch (e) { /* today's string stands */ }
    return s;
  }

  /* Operation type -> i18n key (batch-2a; op 0 reuses transfer.title,
   * byte-identical "Transfer"). Tags 11..77 per the open-graphene spec
   * oracle (78 ops, tags 0-77); virtual-only tags (51/53 htlc-redeemed/
   * refund, 74 deal-expired) keep labels — history can contain them.
   * OP_LABELS stays the verbatim English source (still exported);
   * opLabel() resolves through t() at render time so locale switches
   * apply without a reload. */
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
    10: "account.op_asset_create",
    11: "account.op_asset_update",
    12: "account.op_smartcoin_update",
    13: "account.op_feed_producers_update",
    14: "account.op_asset_issue",
    15: "account.op_asset_burn",
    16: "account.op_fee_pool_fund",
    17: "account.op_asset_settle",
    18: "account.op_global_settle",
    19: "account.op_feed_publish",
    20: "account.op_witness_join",
    21: "account.op_witness_update",
    22: "account.op_proposal_create",
    23: "account.op_proposal_update",
    24: "account.op_proposal_delete",
    25: "account.op_debit_create",
    26: "account.op_debit_update",
    27: "account.op_debit_claim",
    28: "account.op_debit_delete",
    29: "account.op_committee_join",
    30: "account.op_committee_update",
    31: "account.op_params_update",
    32: "account.op_vesting_create",
    33: "account.op_vesting_withdraw",
    34: "account.op_worker_create",
    35: "account.op_custom_op",
    36: "account.op_assert_op",
    37: "account.op_balance_claim",
    38: "account.op_override_transfer",
    39: "account.op_blind_to",
    40: "account.op_blind_transfer",
    41: "account.op_blind_from",
    42: "account.op_settle_cancel",
    43: "account.op_claim_fees",
    44: "account.op_fba_distribute",
    45: "account.op_collateral_bid",
    46: "account.op_execute_bid",
    47: "account.op_claim_pool",
    48: "account.op_issuer_update",
    49: "account.op_htlc_create",
    50: "account.op_htlc_redeem",
    51: "account.op_htlc_redeemed",
    52: "account.op_htlc_extend",
    53: "account.op_htlc_refund",
    54: "account.op_authority_create",
    55: "account.op_authority_update",
    56: "account.op_authority_delete",
    57: "account.op_ticket_create",
    58: "account.op_ticket_update",
    59: "account.op_pool_create",
    60: "account.op_pool_delete",
    61: "account.op_pool_deposit",
    62: "account.op_pool_withdraw",
    63: "account.op_pool_swap",
    64: "account.op_samet_create",
    65: "account.op_samet_delete",
    66: "account.op_samet_update",
    67: "account.op_samet_borrow",
    68: "account.op_samet_repay",
    69: "account.op_offer_create",
    70: "account.op_offer_delete",
    71: "account.op_offer_update",
    72: "account.op_offer_accept",
    73: "account.op_deal_repay",
    74: "account.op_deal_expired",
    75: "account.op_pool_update",
    76: "account.op_deal_update",
    77: "account.op_order_update"
  };

  /* Operation type -> human label (spec verbatim, 0..77). The values are
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
    10: "Asset create",
    11: "Asset update",
    12: "Smartcoin update",
    13: "Feed producers update",
    14: "Asset issue",
    15: "Asset burn",
    16: "Fee pool fund",
    17: "Asset settle",
    18: "Global settle",
    19: "Feed publish",
    20: "Witness join",
    21: "Witness update",
    22: "Proposal create",
    23: "Proposal update",
    24: "Proposal delete",
    25: "Direct debit create",
    26: "Direct debit update",
    27: "Direct debit claim",
    28: "Direct debit delete",
    29: "Committee join",
    30: "Committee update",
    31: "Global parameters update",
    32: "Vesting create",
    33: "Vesting withdraw",
    34: "Worker create",
    35: "Custom operation",
    36: "Assert",
    37: "Balance claim",
    38: "Override transfer",
    39: "Transfer to blind",
    40: "Blind transfer",
    41: "Transfer from blind",
    42: "Settle cancel",
    43: "Claim fees",
    44: "FBA distribute",
    45: "Collateral bid",
    46: "Execute bid",
    47: "Claim pool",
    48: "Issuer update",
    49: "HTLC create",
    50: "HTLC redeem",
    51: "HTLC redeemed",
    52: "HTLC extend",
    53: "HTLC refund",
    54: "Authority create",
    55: "Authority update",
    56: "Authority delete",
    57: "Ticket create",
    58: "Ticket update",
    59: "Pool create",
    60: "Pool delete",
    61: "Pool deposit",
    62: "Pool withdraw",
    63: "Pool swap",
    64: "Same-T fund create",
    65: "Same-T fund delete",
    66: "Same-T fund update",
    67: "Same-T borrow",
    68: "Same-T repay",
    69: "Credit offer create",
    70: "Credit offer delete",
    71: "Credit offer update",
    72: "Credit accept",
    73: "Deal repay",
    74: "Deal expired",
    75: "Pool update",
    76: "Deal update",
    77: "Order update"
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
      price: ps(o.priceDisplay),
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
      meta.textContent = o.id + " @ " + ps(o.priceDisplay);
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
        (row._summary || (n === null ? t("account.unknown_operation", "Unknown operation") : opLabel(n)));
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
