/* MarketOrders: my-open-orders rendering for the DEX desk (display + cancel).
 * Owns: locked hint with Wallet link, loading state, order rows as table +
 *   phone cards with per-row raw JSON, Cancel buttons per row/card plus the
 *   cancel-all box (≥2 orders). Cancel CONFIRM/SEND/RESULT flows are owned by
 *   TradeUI (slice-06) — this file only mounts buttons + boxes and re-renders
 *   the list when TradeUI reports done.
 * Consumes: Market.myOrders (read-only fetch, via global — same as before
 *   the split), Wallet.isUnlocked (read-only gate, never modified), Format
 *   (formatAmount/formatPrice — BigInt, 8 places like Market), ctx.assets
 *   (quote/base id/symbol/precision, never modified), TradeUI (cancel UI only,
 *   guarded — rows render without buttons when it failed to load).
 * Globals/side effects: DOM under the given parent element only; global
 *   MarketOrders only. showError/network/defaultMarket are private copies of
 *   the market-ui.js helpers (same per-file convention as transfer-ui.js) so
 *   error sentences stay byte-identical after the move.
 * Created by: building-vanilla-slices skill, slice-05 refactor (market-ui split).
 */
var MarketOrders = (function () {
  "use strict";

  var PRICE_PLACES = 8;

  /* Batch-2b i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Element helper: textContent only, user/chain strings never reach HTML. */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  /* Network from Store (sole settings owner); mainnet when unreadable. */
  function network() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* Canonical default market per bitshares-ui/app/branding.js:98-108. */
  function defaultMarket() {
    return network() === "testnet" ? "USD_TEST" : "BTS_CNY";
  }

  /* Inline error panel (aria-live); chain error shapes map to sentences. */
  function showError(doc, wrap, e, fallback) {
    var err = el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("market.err_unexpected", "Unexpected error"));
    if (msg.indexOf("bad-market") !== -1) {
      msg = "Unknown market. Check the QUOTE_BASE pair (e.g. " + defaultMarket() + ").";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("market.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("market.err_history", "History unavailable on this node (fills and charts need the history plugin).");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("market.err_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("market.err_offline", "Network unavailable. Check Settings → Nodes and retry.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
    return err;
  }

  /* My open orders, read-only: id, side, amount (for_sale in the sell asset,
   * market_object.hpp:50), market-oriented price; raw JSON per row. Locked
   * wallets get a hint with a link — never a password field here. Moved
   * verbatim from the MarketUI fillOrders(state) body: state.doc is `doc`,
   * state.ordersBody is `parentEl`, state.assets is `ctx.assets`. */
  function render(doc, parentEl, ctx) {
    var assets = ctx.assets;
    while (parentEl.firstChild) parentEl.removeChild(parentEl.firstChild);
    var unlocked = false;
    try {
      unlocked = typeof Wallet !== "undefined" && Wallet &&
        (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
    } catch (e) { unlocked = false; }
    if (!unlocked) {
      var hint = el(doc, "p", t("market.orders_locked", "Unlock your wallet to see your open orders on this market. "), "muted");
      var a = el(doc, "a", t("market.go_wallet", "Go to Wallet"));
      a.setAttribute("href", "#/wallet");
      touchable(a);
      hint.appendChild(a);
      parentEl.appendChild(hint);
      return;
    }
    parentEl.appendChild(el(doc, "p", t("market.loading_orders", "Loading your orders…"), "muted"));
    Market.myOrders().then(function (rows) {
      while (parentEl.firstChild) parentEl.removeChild(parentEl.firstChild);
      var mine = (rows || []).filter(function (o) { return isMine(o, assets); });
      if (mine.length === 0) {
        parentEl.appendChild(el(doc, "p", t("market.no_orders", "No open orders on this market."), "muted"));
        return;
      }
      var canCancel = typeof TradeUI !== "undefined" && TradeUI &&
        typeof TradeUI.orderCancelBox === "function" &&
        typeof TradeUI.cancelAllBox === "function";
      function rerender() { render(doc, parentEl, ctx); }
      /* Shared inline-confirm slot (one, above the list): Cancel buttons
       * paint TradeUI's confirm here so rows/cards stay put until done. */
      var cancelBox = doc.createElement("div");
      parentEl.appendChild(cancelBox);
      if (canCancel && mine.length >= 2) {
        var allBox = doc.createElement("div");
        parentEl.appendChild(allBox);
        TradeUI.cancelAllBox(doc, allBox, mine, assets, rerender);
      }
      var table = doc.createElement("table");
      table.className = "node-table";
      var thead = doc.createElement("thead");
      var hr = doc.createElement("tr");
      [t("market.col_order", "Order"), t("market.col_side", "Side"), t("market.th_amount", "Amount"), t("market.col_price", "Price")].forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
      if (canCancel) hr.appendChild(el(doc, "th", t("market.col_action", "Action")));
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = doc.createElement("tbody");
      var cards = doc.createElement("div");
      cards.className = "node-cards orders-cards";
      mine.forEach(function (o) {
        var view = orderView(o, assets);
        var tr = doc.createElement("tr");
        tr.appendChild(el(doc, "td", view.id));
        tr.appendChild(el(doc, "td", view.side));
        tr.appendChild(el(doc, "td", view.amount));
        tr.appendChild(el(doc, "td", view.price));
        if (canCancel) {
          var td = doc.createElement("td");
          td.appendChild(cancelButton(doc, o, assets, cancelBox, rerender));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        var card = doc.createElement("div");
        card.className = "node-card";
        card.appendChild(el(doc, "div", view.id + " · " + view.side));
        card.appendChild(el(doc, "div", view.amount));
        card.appendChild(el(doc, "div", view.price));
        if (canCancel) card.appendChild(cancelButton(doc, o, assets, cancelBox, rerender));
        var det = doc.createElement("details");
        det.className = "raw";
        var sum = doc.createElement("summary");
        sum.setAttribute("aria-label", t("market.raw_order", "Show raw order JSON"));
        touchable(sum);
        det.appendChild(sum);
        var pre = doc.createElement("pre");
        try { pre.textContent = JSON.stringify(o, null, 2); }
        catch (e) { pre.textContent = String(o); }
        det.appendChild(pre);
        card.appendChild(det);
        cards.appendChild(card);
      });
      table.appendChild(tbody);
      /* Fixed-height scroll region (desk-grid.css: 8-row fold, sticky thead);
       * long order lists scroll in place instead of stretching the desk. */
      var scroller = doc.createElement("div");
      scroller.className = "orders-scroll";
      scroller.appendChild(table);
      parentEl.appendChild(scroller);
      parentEl.appendChild(cards);
      var detAll = doc.createElement("details");
      detAll.className = "raw";
      var sumAll = doc.createElement("summary");
      sumAll.setAttribute("aria-label", t("market.raw_orders", "Show raw orders JSON"));
      touchable(sumAll);
      detAll.appendChild(sumAll);
      var preAll = doc.createElement("pre");
      try { preAll.textContent = JSON.stringify(mine, null, 2); }
      catch (e) { preAll.textContent = String(mine); }
      detAll.appendChild(preAll);
      parentEl.appendChild(detAll);
    }).catch(function (e) {
      while (parentEl.firstChild) parentEl.removeChild(parentEl.firstChild);
      showError(doc, parentEl, e, t("market.fail_orders", "Could not load your orders."));
    });
  }

  /* Per-row Cancel button: paints TradeUI's inline confirm into the shared
   * box (order id 1.7.x shown there). Done callback re-renders this list. */
  function cancelButton(doc, order, assets, cancelBox, rerender) {
    var b = touchable(el(doc, "button", t("trade.cancel_button", "Cancel")));
    b.type = "button";
    b.setAttribute("aria-label", "Cancel order " + String(order.id));
    b.addEventListener("click", function () {
      TradeUI.orderCancelBox(doc, cancelBox, order, assets, rerender);
    });
    return b;
  }

  /* True when the raw limit order touches both market assets (either leg). */
  function isMine(o, assets) {
    if (!o || !o.sell_price || !o.sell_price.base || !o.sell_price.quote) return true;
    var ids = [o.sell_price.base.asset_id, o.sell_price.quote.asset_id];
    return ids.indexOf(assets.quote.id) !== -1 || ids.indexOf(assets.base.id) !== -1;
  }

  /* Human row for a raw limit order: side from the sell leg (Exchange.jsx
   * bid/ask convention), for_sale in the sell asset, price in market terms
   * (tail-per-head, PRICE_PLACES, BigInt). Unknown shapes stay honest. */
  function orderView(o, assets) {
    var q = assets.quote, b = assets.base;
    var id = (o && o.id) ? String(o.id) : "—";
    if (!o || !o.sell_price || !o.sell_price.base || !o.sell_price.quote) {
      return { id: id, side: "—", amount: "—", price: "—" };
    }
    var sp = o.sell_price;
    var sellId = sp.base.asset_id;
    var side = sellId === q.id ? "Sell " + q.symbol : (sellId === b.id ? "Buy " + q.symbol : "—");
    var sellPrec = sellId === q.id ? q.precision : (sellId === b.id ? b.precision : null);
    var amount = "—";
    if (o.for_sale !== undefined && o.for_sale !== null && typeof sellPrec === "number") {
      try {
        var sym = sellId === q.id ? q.symbol : b.symbol;
        amount = Format.formatAmount(String(o.for_sale), sellPrec) + " " + sym;
      } catch (e) { amount = String(o.for_sale); }
    } else if (o.for_sale !== undefined && o.for_sale !== null) {
      amount = String(o.for_sale);
    }
    var price = "—";
    try {
      var bb = sp.base.amount !== undefined ? String(sp.base.amount) : null;
      var qq = sp.quote.amount !== undefined ? String(sp.quote.amount) : null;
      if (bb !== null && qq !== null && /^-?\d+$/.test(bb) && /^-?\d+$/.test(qq)) {
        if (sp.base.asset_id === b.id && sp.quote.asset_id === q.id) {
          price = Format.formatPrice(bb, b.precision, qq, q.precision, PRICE_PLACES);
        } else if (sp.base.asset_id === q.id && sp.quote.asset_id === b.id) {
          price = Format.formatPrice(qq, b.precision, bb, q.precision, PRICE_PLACES);
        }
      }
    } catch (e) { price = "—"; }
    return { id: id, side: side, amount: amount, price: price };
  }

  return {
    render: render
  };
})();

if (typeof module !== "undefined") { module.exports = MarketOrders; }
