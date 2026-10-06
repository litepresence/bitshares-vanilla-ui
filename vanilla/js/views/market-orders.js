/* MarketOrders: my-open-orders + open-settlement rendering for the DEX desk.
 * Owns: typed-account preview row (Account input + Look up, public reads —
 *   locked + blank keeps the locked hint), loading state, order rows as table +
 *   phone cards with per-row raw JSON, Cancel buttons per row/card plus the
 *   cancel-all box (≥2 orders, unlocked auto-load only), the open-settlement
 *   tab (R1e: db get_settle_orders(assetId,100) <=300, price/amount/date table
 *   sorted by settlement_date via Market.sortSettles, empty->no_orders), and
 *   the fill-size tape histogram (dex-ux plot proposal 2: order-of-magnitude
 *   bins over fill integer amounts, canvas 2D, collapsible, mounted by
 *   MarketBook into the mkt-trades pane from already-fetched rows — no new
 *   chain call).
  *   Cancel CONFIRM/SEND/RESULT flows are owned by
  *   TradeUI (slice-06) — this file only mounts buttons + boxes and re-renders
  *   the list when TradeUI reports done. The op-77 Adjust (limit_order_update)
  *   form + review + send IS owned here (deferred-verdicts Q1 build order):
  *   per-row Adjust buttons paint orderUpdateBox into the same shared slot,
  *   with local send/fee/prove helpers (private copies of the trade-cancel.js
  *   originals per the same per-file convention, credited at each site).
 * Consumes: Market.myOrders/.settleOrders/.sortSettles (read-only fetch, via
 *   global — same as before the split), Wallet.isUnlocked (read-only gate,
 *   never modified), Format (formatAmount/formatPrice/settleEstimate — BigInt,
 *   8 places like Market), ctx.assets (quote/base id/symbol/precision +
 *   bitasset_data_id, never modified), TradeUI (cancel UI only, guarded —
 *   rows render without buttons when it failed to load).
 * Globals/side effects: DOM under the given parent element only; global
 *   MarketOrders only. showError/network/defaultMarket are private copies of
 *   the market-ui.js helpers (same per-file convention as transfer-ui.js) so
 *   error sentences stay byte-identical after the move. Integer discipline:
 *   the tape bins raw chain integer strings by digit count (no float, no
 *   division on money); Number() appears ONLY for canvas bar pixels,
 *   commented at the site.
 * Created by: building-vanilla-slices skill, slice-05 refactor (market-ui split).
 * Extended by: dex-ux plots task (AFK round — proposal 2 tape histogram,
 *   chain-history only, ES refused) + R1e open-settle tab.
 */
var MarketOrders = (function () {
  "use strict";

  var PRICE_PLACES = 8;

  /* Render generation: each render() call invalidates stale async
   * continuations (auto-load, prefill, typed lookups). */
  var _gen = 0;

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

  /* No local el — use DOM.el */

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  // using global touchable from js/utils/touchable.js

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

  /* Inline error panel (aria-live); chain error shapes map to sentences.
   * History fallback keeps its byte-identical message key and gains a linked
   * "Open Settings" action (HistoryNotice.actionLink, pure DOM). */
  function showError(doc, wrap, e, fallback) {
    var raw = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || "");
    var isHist = raw.indexOf("history-unavailable") !== -1;
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("bad-market") !== -1) {
      msg = "Unknown market. Check the QUOTE_BASE pair (e.g. " + defaultMarket() + ").";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("market.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("market.err_history", "History unavailable on this node (fills and charts need the history plugin).");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    }
    var err = DOM.error(wrap, msg);
    if (isHist) {
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          var link = HistoryNotice.actionLink(doc, t, "settings");
          if (link) wrap.appendChild(link);
        }
      } catch (e2) { /* error panel stands without the link */ }
    }
    return err;
  }

  /* My open orders, read-only: id, side, amount (for_sale in the sell asset,
   * market_object.hpp:50), market-oriented price; raw JSON per row. Wallets
   * get the auto-load below; anyone can type an account (name or 1.2.N) +
   * Look up to preview ITS orders via public get_limit_orders_by_account
   * (locked previews are display-only: no Cancel buttons). Blank + locked
   * keeps the Wallet-link hint — never a password field here. Moved
   * verbatim from the MarketUI fillOrders(state) body: state.doc is `doc`,
   * state.ordersBody is `parentEl`, state.assets is `ctx.assets`. */
  function render(doc, parentEl, ctx) {
    var assets = ctx.assets;
    var myGen = ++_gen;
    function live() { return myGen === _gen; }
    DOM.clear(parentEl);
    var unlocked = false;
    try {
      unlocked = typeof Wallet !== "undefined" && Wallet &&
        (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
    } catch (e) { unlocked = false; }
    /* Tabs: My orders | Settlement orders (R1e, mirrors #1 MyOpenOrders
     * activeTab my_orders/open_settlement). Settlement is public chain data
     * (no unlock) and lazy-loads on first open; My keeps the existing
     * auto-load below. Buttons stay >=44px. */
    var tabs = doc.createElement("div");
    tabs.className = "mkt-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("market.trades_toggle_label", "Recent or my trades"));
    var tabOrders = touchable(DOM.el(doc, "button", t("market.tab_orders", "My orders")));
    tabOrders.type = "button";
    tabOrders.className = "subtle-btn";
    tabOrders.setAttribute("role", "tab");
    var tabSettle = touchable(DOM.el(doc, "button", t("market.tab_settle", "Settlement orders")));
    tabSettle.type = "button";
    tabSettle.className = "subtle-btn";
    tabSettle.setAttribute("role", "tab");
    tabs.appendChild(tabOrders);
    tabs.appendChild(tabSettle);
    parentEl.appendChild(tabs);
    var myWrap = doc.createElement("div");
    myWrap.setAttribute("role", "tabpanel");
    parentEl.appendChild(myWrap);
    var settleWrap = doc.createElement("div");
    settleWrap.setAttribute("role", "tabpanel");
    settleWrap.style.display = "none";
    parentEl.appendChild(settleWrap);
    var settleLoaded = false;
    function paintTabs(isSettle) {
      tabOrders.setAttribute("aria-selected", isSettle ? "false" : "true");
      tabSettle.setAttribute("aria-selected", isSettle ? "true" : "false");
      tabOrders.setAttribute("aria-pressed", isSettle ? "false" : "true");
      tabSettle.setAttribute("aria-pressed", isSettle ? "true" : "false");
      myWrap.style.display = isSettle ? "none" : "";
      settleWrap.style.display = isSettle ? "" : "none";
    }
    tabOrders.addEventListener("click", function () { paintTabs(false); });
    tabSettle.addEventListener("click", function () {
      paintTabs(true);
      if (!settleLoaded) { settleLoaded = true; loadSettle(); }
    });
    paintTabs(false);
    /* Typed-account preview row (principle #9: reads never gate on unlock). */
    var acctRow = doc.createElement("div");
    var lab = DOM.el(doc, "span", t("account.card_account", "Account") + " ");
    var acctInput = doc.createElement("input");
    acctInput.type = "text";
    acctInput.setAttribute("placeholder", t("common.name_or_id_hint", "name or 1.2.N"));
    acctInput.setAttribute("aria-label", t("account.card_account", "Account"));
    acctInput.style.minHeight = "44px";
    acctInput.style.width = "12em";
    var viewBtn = touchable(DOM.el(doc, "button", t("referrals.look_up", "Look up")));
    viewBtn.type = "button";
    acctRow.appendChild(lab);
    acctRow.appendChild(acctInput);
    acctRow.appendChild(doc.createTextNode(" "));
    acctRow.appendChild(viewBtn);
    myWrap.appendChild(acctRow);
    var body = doc.createElement("div");
    myWrap.appendChild(body);
    /* lockedHint: locked-wallet empty state with a Wallet link. */
    function lockedHint() {
      DOM.clear(body);
      var hint = DOM.el(doc, "p", t("market.orders_locked", "Unlock your wallet to see your open orders on this market. "), "muted");
      var a = DOM.el(doc, "a", t("market.go_wallet", "Go to Wallet"));
      a.setAttribute("href", "#/wallet");
      a.className = "subtle-btn";
      hint.appendChild(a);
      body.appendChild(hint);
    }
    /* canCancelNow: cancel UI is available (unlocked AND the TradeUI
     * cancel backend is loaded). Returns boolean, never throws. */
    function canCancelNow() {
      return unlocked && typeof TradeUI !== "undefined" && TradeUI &&
        typeof TradeUI.orderCancelBox === "function" &&
        typeof TradeUI.cancelAllBox === "function";
    }
    /* paintOrders: my open orders as table + phone cards with per-row
     * cancel + adjust (TradeUI confirm / local update form both render into
     * the shared slot above the list). No-ops when live() is false. */
    function paintOrders(mine, canCancel) {
      if (!live()) return;
      var canUpdate = canUpdateNow();
      DOM.clear(body);
      if (mine.length === 0) {
        body.appendChild(DOM.el(doc, "p", t("market.no_orders", "No open orders on this market.") + t("market.place_order_hint", " Place one from the trade form on this page — it lists here until filled or cancelled."), "muted"));
        return;
      }
      /* rerender: full re-render after a cancel flow completes. */
      function rerender() { render(doc, parentEl, ctx); }
      /* Shared inline-confirm slot (one, above the list): Cancel buttons
       * paint TradeUI's confirm here so rows/cards stay put until done. */
      var cancelBox = doc.createElement("div");
      body.appendChild(cancelBox);
      if (canCancel && mine.length >= 2) {
        var allBox = doc.createElement("div");
        body.appendChild(allBox);
        TradeUI.cancelAllBox(doc, allBox, mine, assets, rerender);
      }
      var table = doc.createElement("table");
      table.className = "node-table";
      var thead = doc.createElement("thead");
      var hr = doc.createElement("tr");
      [t("market.col_order", "Order"), t("market.col_side", "Side"), t("market.th_amount", "Amount"), t("market.col_price", "Price")].forEach(function (h) { hr.appendChild(DOM.el(doc, "th", h)); });
      if (canCancel || canUpdate) hr.appendChild(DOM.el(doc, "th", t("market.col_action", "Action")));
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = doc.createElement("tbody");
      var cards = doc.createElement("div");
      cards.className = "node-cards orders-cards";
      mine.forEach(function (o) {
        var view = orderView(o, assets);
        var tr = doc.createElement("tr");
        tr.appendChild(DOM.el(doc, "td", view.id));
        tr.appendChild(DOM.el(doc, "td", view.side));
        tr.appendChild(DOM.el(doc, "td", view.amount));
        tr.appendChild(DOM.el(doc, "td", view.price));
        if (canCancel || canUpdate) {
          var td = doc.createElement("td");
          if (canCancel) td.appendChild(cancelButton(doc, o, assets, cancelBox, rerender));
          if (canUpdate) {
            if (canCancel) td.appendChild(doc.createTextNode(" "));
            td.appendChild(updateButton(doc, o, assets, cancelBox, rerender));
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        var card = doc.createElement("div");
        card.className = "node-card";
        card.appendChild(DOM.el(doc, "div", view.id + " · " + view.side));
        card.appendChild(DOM.el(doc, "div", view.amount));
        card.appendChild(DOM.el(doc, "div", view.price));
        if (canCancel) card.appendChild(cancelButton(doc, o, assets, cancelBox, rerender));
        if (canUpdate) card.appendChild(updateButton(doc, o, assets, cancelBox, rerender));
        var det = doc.createElement("details");
        det.className = "raw";
        var sum = doc.createElement("summary");
        sum.setAttribute("aria-label", t("market.raw_order", "Show raw order JSON"));
        sum.className = "subtle-btn";
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
      body.appendChild(scroller);
      body.appendChild(cards);
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
      body.appendChild(detAll);
    }
    /* Typed-account lookup: resolve the input (public read) and paint that
     * account's orders on this market. Locked previews stay display-only
     * (no Cancel buttons); unlocked keeps buttons. Blank + locked keeps
     * the hint; blank + unlocked reloads the wallet auto-load. */
    function loadTyped() {
      if (!live()) return;
      var v = acctInput.value.trim();
      if (!v) {
        if (!unlocked) lockedHint();
        else render(doc, parentEl, ctx);
        return;
      }
      DOM.clear(body);
      body.appendChild(DOM.el(doc, "p", t("market.loading_orders", "Loading your orders…"), "muted"));
      Promise.resolve().then(function () {
        if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
          throw new Error("account backend missing");
        }
        return Account.resolve(v);
      }).then(function (acct) {
        if (typeof Chain === "undefined" || !Chain || typeof Chain.db !== "function") {
          throw new Error("not connected");
        }
        return Chain.db().then(function (dbId) {
          return Chain.call(dbId, "get_limit_orders_by_account", [acct.id, 100]);
        });
      }).then(function (rows) {
        if (!live()) return;
        var mine = (rows || []).filter(function (o) { return isMine(o, assets); });
        paintOrders(mine, canCancelNow());
      }).catch(function (e) {
        if (!live()) return;
        DOM.clear(body);
        showError(doc, body, e, t("market.fail_orders", "Could not load your orders."));
      });
    }
    /* loadSettle: R1e open-settlement tab (public read, no unlock).
     * Resolves the market bitasset leg via isMarketAsset shape (quote bitasset
     * backed by base, or base bitasset backed by quote — market_utils.js:461),
     * then db get_settle_orders(assetId,100) (database_api.hpp:558, <=300),
     * sorted by settlement_date via Market.sortSettles. Price is the live
     * settlement estimate (global fund>0 uses settlement_price directly,
     * else Format.settleEstimate with the bitasset offset — same rule as the
     * desk strip); amount is balance human via Format; date via I18n.date.
     * Empty -> no_orders; non-bitasset market -> honest no_settle_market note.
     * Never throws outward (fails inline). */
    function loadSettle() {
      if (!live()) return;
      DOM.clear(settleWrap);
      settleWrap.appendChild(DOM.el(doc, "p", t("market.loading_settle", "Loading settlement orders…"), "muted"));
      Promise.resolve().then(async function () {
        if (typeof Chain === "undefined" || !Chain || typeof Chain.db !== "function") throw new Error("not connected");
        if (typeof Market === "undefined" || !Market || typeof Market.settleOrders !== "function") throw new Error("settle backend missing");
        var q = assets.quote, b = assets.base;
        var qBid = (q && q.bitasset_data_id) || null, bBid = (b && b.bitasset_data_id) || null;
        if (!qBid && !bBid) return { none: true };
        var dbId = await Chain.db();
        var bits = {};
        if (qBid) {
          var qo = await Chain.call(dbId, "get_objects", [[qBid]]);
          if (qo && qo[0]) bits.quote = qo[0];
        }
        if (bBid) {
          var bo = await Chain.call(dbId, "get_objects", [[bBid]]);
          if (bo && bo[0]) bits.base = bo[0];
        }
        var marketAssetId = null, bit = null, settledPrec = null, settledSym = null;
        var qBack = bits.quote && bits.quote.options && bits.quote.options.short_backing_asset;
        var bBack = bits.base && bits.base.options && bits.base.options.short_backing_asset;
        if (qBack === b.id) { marketAssetId = q.id; bit = bits.quote; settledPrec = q.precision; settledSym = q.symbol; }
        else if (bBack === q.id) { marketAssetId = b.id; bit = bits.base; settledPrec = b.precision; settledSym = b.symbol; }
        else return { none: true };
        var rows = await Market.settleOrders(marketAssetId, 100);
        var sorted = (typeof Market.sortSettles === "function") ? Market.sortSettles(rows) : (rows || []).slice();
        /* Live price for the tab: same rule as the desk strip (global fund>0
         * -> settlement_price; else offset estimate). Feed legs map by asset_id
         * onto the market legs; unmappable -> price "—", never guessed. */
        var price = "—", priceTitle = null;
        try {
          var fundStr = String(bit.settlement_fund !== undefined && bit.settlement_fund !== null ? bit.settlement_fund : "0");
          var isSettled = /^-?\d+$/.test(fundStr.trim()) ? BigInt(fundStr.trim()) > 0n : Number(bit.settlement_fund) > 0;
          var cur = bit.current_feed && bit.current_feed.settlement_price;
          var rawB = null, rawQ = null;
          if (cur && cur.base && cur.quote) {
            [cur.base, cur.quote].forEach(function (leg) {
              if (leg.asset_id === b.id) rawB = String(leg.amount);
              else if (leg.asset_id === q.id) rawQ = String(leg.amount);
            });
          }
          if (isSettled && bit.settlement_price && bit.settlement_price.base && bit.settlement_price.quote) {
            var sB = null, sQ = null;
            [bit.settlement_price.base, bit.settlement_price.quote].forEach(function (leg) {
              if (leg.asset_id === b.id) sB = String(leg.amount);
              else if (leg.asset_id === q.id) sQ = String(leg.amount);
            });
            if (sB !== null && sQ !== null) price = Format.formatPrice(sB, b.precision, sQ, q.precision, PRICE_PLACES);
          } else if (rawB !== null && rawQ !== null) {
            var offRaw = bit.options && bit.options.force_settlement_offset_percent;
            var off = (Number.isInteger(offRaw) && offRaw >= 0 && offRaw <= 0xFFFF) ? offRaw : 0;
            var baseIsCore = String(b.id) === "1.3.0";
            price = Format.settleEstimate(rawB, b.precision, rawQ, q.precision, off, baseIsCore, PRICE_PLACES);
            priceTitle = "offset " + String(off) + "/10000";
          }
          /* 4-sf display (global price rule); the "—" fallback and the
           * offset title above stand untouched. */
          if (price !== "—" && typeof Format.priceSig === "function") {
            try {
              var ssig = Format.priceSig(price);
              if (typeof ssig === "string" && ssig) price = ssig;
            } catch (e) { /* 8-place stands */ }
          }
        } catch (e) { price = "—"; }
        return { rows: sorted, price: price, priceTitle: priceTitle, assetId: marketAssetId, prec: settledPrec, sym: settledSym };
      }).then(function (R) {
        if (!live()) return;
        DOM.clear(settleWrap);
        if (!R || R.none) {
          settleWrap.appendChild(DOM.el(doc, "p", t("market.no_settle_market", "No bitasset in this market — no settlement orders."), "muted"));
          return;
        }
        paintSettle(R.rows, R.price, R.priceTitle, R.prec, R.sym);
      }).catch(function (e) {
        if (!live()) return;
        DOM.clear(settleWrap);
        showError(doc, settleWrap, e, t("market.fail_settle", "Could not load settlement orders."));
      });
    }
    /* paintSettle: price/amount/date table sorted by settlement_date (input
     * already sorted). Amount human via Format (raw in title, never bare);
     * date via I18n.date with raw fallback; price shared estimate with offset
     * title. The estimate wears a plain "est. " glue prefix (no new locale
     * key) in BOTH table cell and phone card so neither passes the offset
     * estimate off as a settlement; a true global settlement (priceTitle
     * null) stays bare, and the "—" fallback never takes the prefix. The
     * card price div carries the same offset title as the table cell.
      * Rows at the get_settle_orders limit (100) gain an honest first-page
      * note (market.settle_first100). Empty -> no_orders plus the no-cancel
      * note (market.settle_no_cancel): op-42 asset_settle_cancel is VIRTUAL
      * (validate() asserts !"Virtual operation", no evaluator), so the tab
      * never offers a cancel affordance — the note says why. Phone cards +
      * raw details mirror the my-orders pattern. No-ops when live() is false.
     * @param {Array} rows - sorted settle orders (Market.sortSettles output).
     * @param {string} price - shared settlement/estimate price string.
     * @param {string|null} priceTitle - offset title when price is an estimate.
     * @param {number} prec - settled asset precision for amount display.
     * @param {string} sym - settled asset symbol for amount display.
     * @returns {void} Renders in place. */
    function paintSettle(rows, price, priceTitle, prec, sym) {
      if (!live()) return;
      DOM.clear(settleWrap);
      if (!rows || rows.length === 0) {
        settleWrap.appendChild(DOM.el(doc, "p", t("market.no_orders", "No open orders on this market."), "muted"));
        /* WHY no cancel affordance anywhere on this tab: chain-doctor proved
         * op-42 asset_settle_cancel is VIRTUAL (validate() asserts
         * !"Virtual operation", no evaluator exists) — so NO cancel button
         * and NO tag-42 tx may ever be offered; this display-only note says
         * why instead of leaving a missing button unexplained. */
        settleWrap.appendChild(DOM.el(doc, "p", t("market.settle_no_cancel", "Settlement orders cannot be cancelled — they execute at settlement (after the asset's force-settlement delay)."), "muted"));
        return;
      }
      /* WHY: settleOrders fetches the first page only (assetId, 100 — the
       * get_settle_orders limit); a full page means more rows may exist, so
       * say so instead of implying completeness. */
      if (rows.length === 100) {
        settleWrap.appendChild(DOM.el(doc, "p", t("market.settle_first100", "Showing first 100 (get_settle_orders limit 100)"), "muted"));
      }
      /* WHY: price is the offset-adjusted settleEstimate whenever priceTitle
       * carries the offset — prefix "est. " there so the table never shows
       * an estimate as a settlement. Global settlement (title null) and the
       * "—" fallback stay bare. Plain glue, no math change. */
      var priceShown = (priceTitle && String(price) !== "—") ? "est. " + String(price) : String(price);
      var table = doc.createElement("table");
      table.className = "node-table";
      var thead = doc.createElement("thead");
      var hr = doc.createElement("tr");
      [t("market.col_price", "Price"), t("market.th_amount", "Amount"), t("market.th_settle_date", "Settlement date")].forEach(function (h) { hr.appendChild(DOM.el(doc, "th", h)); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = doc.createElement("tbody");
      var cards = doc.createElement("div");
      cards.className = "node-cards orders-cards";
      rows.forEach(function (r) {
        var bal = (r && r.balance) || {};
        var amtRaw = (bal.amount !== undefined && bal.amount !== null) ? String(bal.amount) : null;
        var amt = "—", amtTitle = null;
        if (amtRaw !== null && /^-?\d+$/.test(amtRaw) && typeof prec === "number") {
          try { amt = Format.formatAmount(amtRaw, prec) + (sym ? " " + sym : ""); amtTitle = "raw " + amtRaw; }
          catch (e) { amt = amtRaw; }
        } else if (amtRaw !== null) { amt = amtRaw; }
        var dateRaw = (r && r.settlement_date) ? String(r.settlement_date) : "—";
        var dateShown = dateRaw;
        try {
          if (dateRaw !== "—" && typeof I18n !== "undefined" && I18n && typeof I18n.date === "function") dateShown = I18n.date(dateRaw);
        } catch (e) { dateShown = dateRaw; }
        var tr = doc.createElement("tr");
        var tdP = DOM.el(doc, "td", priceShown);
        if (priceTitle) tdP.title = priceTitle;
        tr.appendChild(tdP);
        var tdA = DOM.el(doc, "td", String(amt));
        if (amtTitle) tdA.title = amtTitle;
        tr.appendChild(tdA);
        var tdD = DOM.el(doc, "td", String(dateShown));
        if (dateShown !== dateRaw) tdD.title = dateRaw;
        tr.appendChild(tdD);
        tbody.appendChild(tr);
        var card = doc.createElement("div");
        card.className = "node-card";
        var cardP = DOM.el(doc, "div", priceShown);
        if (priceTitle) cardP.title = priceTitle;
        card.appendChild(cardP);
        card.appendChild(DOM.el(doc, "div", String(amt)));
        card.appendChild(DOM.el(doc, "div", String(dateShown)));
        cards.appendChild(card);
      });
      table.appendChild(tbody);
      var scroller = doc.createElement("div");
      scroller.className = "orders-scroll";
      scroller.appendChild(table);
      settleWrap.appendChild(scroller);
      settleWrap.appendChild(cards);
      var detAll = doc.createElement("details");
      detAll.className = "raw";
      var sumAll = doc.createElement("summary");
      sumAll.setAttribute("aria-label", t("market.raw_orders", "Show raw orders JSON"));
      sumAll.className = "subtle-btn";
      touchable(sumAll);
      detAll.appendChild(sumAll);
      var preAll = doc.createElement("pre");
      try { preAll.textContent = JSON.stringify(rows, null, 2); }
      catch (e) { preAll.textContent = String(rows); }
      detAll.appendChild(preAll);
      settleWrap.appendChild(detAll);
    }
    viewBtn.addEventListener("click", loadTyped);
    if (!unlocked) {
      lockedHint();
      return;
    }
    /* Unlocked: prefill the wallet account id (convenience only); the
     * auto-load below is the unchanged wallet path (Market.myOrders). */
    try {
      if (typeof Account !== "undefined" && Account && typeof Account.myAccountId === "function") {
        Account.myAccountId().then(function (id) {
          if (!live()) return;
          if (!acctInput.value && id) acctInput.value = String(id);
        }).catch(function () { /* auto-load below stands */ });
      }
    } catch (e) { /* auto-load below stands */ }
    body.appendChild(DOM.el(doc, "p", t("market.loading_orders", "Loading your orders…"), "muted"));
    Market.myOrders().then(function (rows) {
      if (!live()) return;
      var mine = (rows || []).filter(function (o) { return isMine(o, assets); });
      paintOrders(mine, canCancelNow());
    }).catch(function (e) {
      if (!live()) return;
      DOM.clear(body);
      showError(doc, body, e, t("market.fail_orders", "Could not load your orders."));
    });
  }

  /* True for optional leading "-" followed by digits only (raw-int shape). */
  function isIntStr(s) {
    return typeof s === "string" && /^-?\d+$/.test(s);
  }

  /* Order of magnitude of a raw chain integer string = its digit count
   * (no float, no division: "95000" -> 5, "0"/"000" -> 1). Non-integer
   * input returns null (caller counts it as skipped, never binned). */
  function magnitude(intStr) {
    if (!isIntStr(intStr)) return null;
    var d = intStr.charAt(0) === "-" ? intStr.slice(1) : intStr;
    d = d.replace(/^0+(?=\d)/, "");
    if (d === "") return 1;
    return d.length;
  }

  /* Read a CSS custom property off <html> (theme-aware plot colors);
   * falls back headlessly. */
  function cssVar(name, fallback) {
    try {
      if (typeof getComputedStyle !== "undefined" && typeof document !== "undefined") {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) { /* fallback stands */ }
    return fallback;
  }

  /* DPR-aware canvas fit (plain duplicate of the market-book.js helper —
   * doctrine prefers duplication over a shared chart abstraction). Returns
   * {ctx, w, h} CSS pixels, or null when unusable. */
  function fitCanvas(canvas, cssH) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    var w = canvas.clientWidth;
    if (!w && canvas.parentNode && canvas.parentNode.clientWidth) {
      w = canvas.parentNode.clientWidth;
    }
    if (!w || w <= 0) w = 300;
    var dpr = 1;
    try {
      if (typeof window !== "undefined" && window.devicePixelRatio) {
        dpr = window.devicePixelRatio;
      }
    } catch (e) { dpr = 1; }
    canvas.style.width = "100%";
    canvas.style.height = cssH + "px";
    /* Pixel sizing below is Number() on layout pixels only — never money. */
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, cssH);
    return { ctx: ctx, w: w, h: cssH };
  }

  /* Fill-size tape histogram (dex-ux proposal 2). Source: the fill rows
   * Market.trades() already fetched via history get_fill_order_history
   * (chain-history ONLY — ES refused); each fill's pays/receives integer
   * amount is binned by order of magnitude (digit count of the integer
   * string — the proposal's exact math). Renders a collapsible
   * <details open> with a canvas 2D bar chart (counts per bin, max bin
   * highlighted) inside the caller's mkt-trades pane. Empty/unmappable
   * input -> honest muted sentence, never a blank box. Pure DOM from
   * caller-supplied rows: no fetching, no timers, no signing. */
  function renderTape(doc, parentEl, rows) {
    var list = Array.isArray(rows) ? rows : [];
    var counts = {}, i, binned = 0, skipped = 0, maxBin = null, maxCount = 0;
    for (i = 0; i < list.length; i++) {
      var raw = list[i] ? list[i].raw : null;
      var op = raw ? raw.op : null;
      if (Array.isArray(op)) op = op[1];
      var pays = op && op.pays && op.pays.amount !== undefined ? String(op.pays.amount) : null;
      var recv = op && op.receives && op.receives.amount !== undefined ? String(op.receives.amount) : null;
      var mp = magnitude(pays), mq = magnitude(recv);
      /* A fill's size class is the larger leg's magnitude (both legs are
       * raw chain integers; digit counts need no float division). */
      var m = null;
      if (mp !== null && mq !== null) m = mp > mq ? mp : mq;
      else if (mp !== null) m = mp;
      else if (mq !== null) m = mq;
      if (m === null) { skipped++; continue; }
      counts[m] = (counts[m] || 0) + 1;
      binned++;
      if (counts[m] > maxCount) { maxCount = counts[m]; maxBin = m; }
    }
    var det = doc.createElement("details");
    det.className = "plot mkt-tape";
    det.setAttribute("open", "");
    var sum = doc.createElement("summary");
    sum.setAttribute("aria-label", t("market_orders.tape_label", "Fill-size tape histogram"));
    touchable(sum);
    sum.textContent = t("market_orders.tape", "Fill-size tape");
    det.appendChild(sum);
    parentEl.appendChild(det);
    var bins = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    if (bins.length === 0) {
      det.appendChild(DOM.el(doc, "p",
        t("market_orders.tape_empty", "No fills to bin — tape empty.") + t("market_orders.tape_hint", " The tape fills as orders match on this market."), "muted"));
      return;
    }
    var note = DOM.el(doc, "p",
      t("market_orders.tape_note", "Fills binned by size") + ": " + String(binned) +
      " · 10^" + String(maxBin) + " " +
      t("market_orders.tape_largest", "largest bin") +
      (skipped > 0 ? " · " + String(skipped) + " " +
        t("market_orders.tape_skipped", "unmappable skipped") : ""),
      "muted");
    det.appendChild(note);
    var canvas = doc.createElement("canvas");
    canvas.className = "mkt-canvas";
    det.appendChild(canvas);
    var g = fitCanvas(canvas, 140);
    if (!g) return;
    var buy = cssVar("--buy", "#22d173");
    var accent = cssVar("--accent", "#007bff");
    var muted = cssVar("--muted", "#777777");
    var text = cssVar("--text", "#c5cbce");
    var n = bins.length;
    /* Bar geometry below is Number() on counts/layout pixels only. */
    var padL = 8, padR = 8, padT = 24, padB = 30;
    var plotW = g.w - padL - padR;
    var plotH = g.h - padT - padB;
    var slot = plotW / n;
    var bw = Math.max(2, slot * 0.62);
    var ctx = g.ctx;
    ctx.font = "10px system-ui, sans-serif";
    for (i = 0; i < n; i++) {
      var c = counts[bins[i]];
      var h = maxCount > 0 ? (c / maxCount) * plotH : 0;
      var bx = padL + i * slot + (slot - bw) / 2;
      var by = padT + (plotH - h);
      ctx.fillStyle = bins[i] === maxBin ? accent : buy;
      ctx.fillRect(bx, by, bw, h);
      ctx.fillStyle = text;
      ctx.textAlign = "center";
      ctx.fillText(String(c), bx + bw / 2, by - 3);
      ctx.fillStyle = muted;
      ctx.fillText("10^" + String(bins[i]), bx + bw / 2, padT + plotH + 12);
      ctx.textAlign = "left";
    }
    ctx.fillStyle = muted;
    ctx.textAlign = "right";
    ctx.fillText(t("market_orders.tape_max", "max") + " " + String(maxCount), g.w - 6, 15);
    ctx.textAlign = "left";
  }

  /* Per-row Adjust button: paints the local op-77 update form into the
   * shared box (order id 1.7.x shown there). Done callback re-renders. */
  function updateButton(doc, order, assets, box, rerender) {
    var b = touchable(DOM.el(doc, "button", t("market.adjust_button", "Adjust")));
    b.type = "button";
    b.className = "btn-ghost";
    b.setAttribute("aria-label", t("market.update_title", "Adjust order") + " " + String(order.id));
    b.addEventListener("click", function () {
      orderUpdateBox(doc, box, order, assets, rerender, null);
    });
    return b;
  }

  /* Update flow (op 77 limit_order_update, deferred-verdicts Q1): in-place
   * adjust form for the user's own open order. Prefills price/amount/expiry
   * from the 1.7.x object; Review sends only changed fields (the rest null);
   * shared ConfirmDialog rows (order id, old→new price, delta amount, old→new
   * expiry, live fee); unlock-at-sign; re-read proof. All-null is refused
   * inline (the node may reject it — spec open point — so the UI requires
   * >=1 changed field instead of spending a fee to find out).
   * @param {Document} doc owner document.
   * @param {HTMLElement} box shared slot the form/confirm/result paints into.
   * @param {object} order raw limit order (must be the wallet account's own).
   * @param {object} assets ctx.assets (quote/base id/symbol/precision).
   * @param {Function} onDone re-render callback (wired to a dismiss button).
   * @param {object|null} preset optional {price, amount, expiry} field
   *   overrides (confirm-back path keeps the user's edits).
   * @returns {void} Renders in place. */

  /* Fee asset for op-77 (core asset; testnet TEST shares the 1.3.0 id). */
  var UPDATE_FEE_ASSET = "1.3.0";

  /* Placeholder fee payer for paint-time fee quotes: op-77 fees are
   * account-invariant (flat schedule per op type via get_required_fees — the
   * payer id never changes the price; committee-account 1.2.0 always
   * exists). Same convention as trade-cancel.js QUOTE_PLACEHOLDER_PAYER:114;
   * display-only, doGo rebuilds with the real seller and re-runs feeMulti. */
  var UPDATE_QUOTE_PAYER = "1.2.0";

  var UPDATE_PROVE_TIMEOUT_MS = 30000;
  var UPDATE_PROVE_INTERVAL_MS = 2500;

  /* True when the Adjust flow can run (unlocked AND every global the update
   * path needs is loaded). Returns boolean, never throws. */
  function canUpdateNow() {
    try {
      var hasTx = typeof Tx !== "undefined" && Tx &&
        typeof Tx.buildTx === "function" && typeof Tx.feeMulti === "function" &&
        typeof Tx.signRouted === "function" &&
        Tx.OP && Tx.OP.limit_order_update === 77;
      var hasChain = typeof Chain !== "undefined" && Chain &&
        typeof Chain.db === "function" && typeof Chain.call === "function" &&
        typeof Chain.net === "function";
      var hasAcct = typeof Account !== "undefined" && Account &&
        typeof Account.myAccountId === "function";
      var hasFmt = typeof Format !== "undefined" && Format &&
        typeof Format.parseAmount === "function" &&
        typeof Format.parsePriceRatio === "function" &&
        typeof Format.formatAmount === "function";
      var hasUi = typeof Forms !== "undefined" && Forms &&
        typeof Forms.labeledInput === "function" &&
        typeof ConfirmDialog !== "undefined" && ConfirmDialog &&
        typeof ConfirmDialog.show === "function";
      var hasWallet = typeof Wallet !== "undefined" && Wallet;
      return !!(unlockedNow() && hasTx && hasChain && hasAcct && hasFmt && hasUi && hasWallet);
    } catch (e) { return false; }
  }

  /* Wallet-unlock read (same gate market-orders render uses, factored so the
   * update path does not depend on the render closure). */
  function unlockedNow() {
    try {
      return typeof Wallet !== "undefined" && Wallet &&
        (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
    } catch (e) { return false; }
  }

  /* Fee asset display meta for human fee lines (private copy of the
   * trade-cancel.js helper — same per-file convention as the market-ui
   * split, so this file never reaches into another view's locals). */
  function updateFeeAssetMeta(feeAssetId) {
    return Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_assets", [[feeAssetId]]);
    }).then(function (rows) {
      if (!rows || !rows[0] || typeof rows[0].precision !== "number") {
        throw new Error("bad-asset-shape for fee asset " + feeAssetId);
      }
      return { symbol: rows[0].symbol, precision: rows[0].precision };
    });
  }

  function updateHumanFee(totalRaw, meta) {
    return Format.formatAmount(String(totalRaw), meta.precision) + " " + meta.symbol;
  }

  /* Paint-time fee quote for an update op (display-only, never signed — same
   * throwaway-ops rationale as trade-cancel.js quoteFeeHuman: feeMulti fills
   * fees in place and buildTx pins a head block, both stale by send time).
   * Never rejects: any failure resolves the honest dash fallback. */
  function updateQuoteFeeHuman(ops) {
    var dash = t("settings.dash", "—");
    return Tx.buildTx(ops).then(function (unsigned) {
      return Tx.feeMulti(unsigned.operations, UPDATE_FEE_ASSET).then(function (feeRes) {
        return updateFeeAssetMeta(unsigned.operations[0][1].fee.asset_id).then(function (meta) {
          return { feeHuman: updateHumanFee(feeRes.totalRaw, meta), feeRaw: String(feeRes.totalRaw) };
        });
      });
    }).catch(function () {
      return { feeHuman: dash, feeRaw: null };
    });
  }

  /* Head block number for result screens (observation marker, not a txid —
   * same convention as the cancel flow). */
  function updateHeadBlock() {
    return Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_dynamic_global_properties", []);
    }).then(function (props) {
      return (props && props.head_block_number) || 0;
    });
  }

  function updateSleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* Broadcast with the same wire shape as the cancel flow (callback id +
   * signedTx, plain fallback), then prove via the caller's poll fn. */
  function updateSendTx(signed, prove) {
    return Chain.net().then(function (netId) {
      var callbackId = (Math.random() * 4294967296) >>> 0;
      var via = "broadcast_transaction_with_callback";
      return Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, signed]).catch(function () {
        via = "broadcast_transaction";
        return Chain.call(netId, "broadcast_transaction", [signed]);
      }).then(function () {
        return updateProveTx(prove, via);
      });
    });
  }

  /* Prove-only poll tail (same 30s budget as the cancel flow). Resolves
   * {found, head, via}; throws an honest do-NOT-rebroadcast error on
   * timeout. */
  function updateProveTx(prove, via) {
    var deadline = Date.now() + UPDATE_PROVE_TIMEOUT_MS;
    function round() {
      var found = null;
      return Promise.resolve().then(function () {
        return prove();
      }).then(function (f) {
        found = f;
        if (!found) {
          if (Date.now() >= deadline) {
            throw new Error("Sent (" + via + ") but the update was not observed within " +
              (UPDATE_PROVE_TIMEOUT_MS / 1000) + "s; check your orders before retrying " +
              "(do NOT blindly rebroadcast).");
          }
          return updateSleep(UPDATE_PROVE_INTERVAL_MS).then(round);
        }
        return updateHeadBlock().then(function (head) {
          return { found: found, head: head, via: via };
        });
      });
    }
    return round();
  }

  /* Seed the update form from the raw 1.7.x object, or null when the shape
   * is unusable (caller shows an honest error, never a half-seeded form).
   * for_sale's asset id IS sell_price.base.asset_id per #4
   * market_object.hpp:50,77,79 — the same convention orderView paints. */
  function updateSeeds(order, assets) {
    try {
      if (!order || typeof order.id !== "string" || !/^1\.7\.\d+$/.test(order.id)) return null;
      var q = assets.quote, b = assets.base;
      if (!q || !b || !q.id || !b.id) return null;
      var sp = order.sell_price;
      if (!sp || !sp.base || !sp.quote) return null;
      var sellId = sp.base.asset_id;
      var sellPrec = sellId === q.id ? q.precision : (sellId === b.id ? b.precision : null);
      var sellSym = sellId === q.id ? q.symbol : (sellId === b.id ? b.symbol : null);
      if (typeof sellPrec !== "number" || !sellSym) return null;
      var forSaleRaw = (order.for_sale !== undefined && order.for_sale !== null) ? String(order.for_sale) : null;
      if (forSaleRaw === null || !/^\d+$/.test(forSaleRaw)) return null;
      var cb = (sp.base.amount !== undefined && sp.base.amount !== null) ? String(sp.base.amount) : null;
      var cq = (sp.quote.amount !== undefined && sp.quote.amount !== null) ? String(sp.quote.amount) : null;
      if (cb === null || cq === null || !/^\d+$/.test(cb) || !/^\d+$/.test(cq)) return null;
      var view = orderView(order, assets);
      if (!view || view.price === "—") return null;
      var expiryWire = (order.expiration !== undefined && order.expiration !== null) ? String(order.expiration) : "";
      if (!expiryWire) return null;
      var seller = (order.seller !== undefined && order.seller !== null) ? String(order.seller) : null;
      return {
        id: String(order.id), seller: seller, pair: q.symbol + "/" + b.symbol,
        sellId: sellId, sellPrec: sellPrec, sellSym: sellSym, forSaleRaw: forSaleRaw,
        priceHuman: view.price, cb: cb, cbId: sp.base.asset_id, cq: cq, cqId: sp.quote.asset_id,
        expiryWire: expiryWire
      };
    } catch (e) { return null; }
  }

  /* New base leg for a changed price: cur_base * new_ratio / cur_ratio in
   * exact BigInt (orientation + quote leg preserved, floor — the same
   * rounding the place-order path uses). Equal values spelled differently
   * ("2.50" vs "2.5") scale to the identical leg, so respellings read as
   * unchanged. Throws on non-positive ratios (caller shows inline). */
  function updateScaleBaseLeg(curBase, curHuman, newHuman) {
    var c = Format.parsePriceRatio(curHuman);
    var n = Format.parsePriceRatio(newHuman);
    /* Explicit BigInt locals: Format is an any-typed global, so the chained
     * expression below would mix inferred number/any operands (TS2365) —
     * BigInt() of each ratio leg pins every operand to bigint first. */
    var curNum = BigInt(c.num), curDen = BigInt(c.den);
    var newNum = BigInt(n.num), newDen = BigInt(n.den);
    if (curNum <= 0n || newNum <= 0n) throw new Error("bad price");
    return (BigInt(curBase) * newNum * curDen / (newDen * curNum)).toString();
  }

  function orderUpdateBox(doc, box, order, assets, onDone, preset) {
    DOM.clear(box);
    if (typeof Tx === "undefined" || !Tx || typeof Chain === "undefined" || !Chain) {
      showError(doc, box, t("trade.cancel_backend", "Trade backend missing: js/tx.js failed to load."));
      return;
    }
    var seeds = updateSeeds(order, assets);
    if (!seeds) {
      showError(doc, box, t("market.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing."));
      return;
    }
    var id = seeds.id;
    function fieldVal(name, fallback) {
      if (preset && preset[name] !== undefined && preset[name] !== null) return String(preset[name]);
      return fallback;
    }
    var form = doc.createElement("div");
    form.className = "mkt-update-form";
    form.appendChild(DOM.el(doc, "h3", t("market.update_title", "Adjust order") + " " + id + "?"));
    var priceF = Forms.labeledInput(doc, t("market.update_price", "New price "),
      { type: "text", inputmode: "decimal", value: fieldVal("price", seeds.priceHuman) });
    priceF.input.setAttribute("aria-label", t("market.update_price", "New price "));
    var amountF = Forms.labeledInput(doc,
      t("market.update_amount", "Amount for sale (new total) ") + "(" + seeds.sellSym + ")",
      { type: "text", inputmode: "decimal", value: fieldVal("amount", Format.formatAmount(seeds.forSaleRaw, seeds.sellPrec)) });
    amountF.input.setAttribute("aria-label", t("market.update_amount", "Amount for sale (new total) "));
    var expVal = seeds.expiryWire.slice(0, 16);
    var expiryF = Forms.labeledInput(doc, t("market.update_expiry", "New expiration "),
      { type: "datetime-local", value: fieldVal("expiry", expVal) });
    expiryF.input.setAttribute("aria-label", t("market.update_expiry", "New expiration "));
    form.appendChild(priceF.row);
    form.appendChild(amountF.row);
    form.appendChild(expiryF.row);
    var err = DOM.el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite");
    err.style.display = "none";
    form.appendChild(err);
    function failInline(msg) {
      err.textContent = msg;
      err.style.display = "";
    }
    var row = doc.createElement("div");
    row.className = "confirm-actions";
    var back = touchable(DOM.el(doc, "button", t("trade.keep_order", "Keep order")));
    back.type = "button";
    back.classList.add("btn-ghost");
    back.addEventListener("click", function () { DOM.clear(box); });
    var review = touchable(DOM.el(doc, "button", t("market.update_review", "Review update")));
    review.type = "button";
    row.appendChild(back);
    row.appendChild(review);
    form.appendChild(row);
    box.appendChild(form);
    /* Read + validate the three fields into a changed-only op fragment.
     * Returns {newPrice, delta, newExpiry, priceHuman, deltaHuman, expiryWire}
     * with nulls for unchanged legs, or throws the inline message. */
    function readChanged() {
      var priceStr = String(priceF.input.value || "").trim();
      var amountStr = String(amountF.input.value || "").trim();
      var expiryStr = String(expiryF.input.value || "").trim();
      var newPrice = null, priceShown = null;
      if (priceStr !== "" && priceStr !== seeds.priceHuman) {
        var newBase;
        try {
          newBase = updateScaleBaseLeg(seeds.cb, seeds.priceHuman, priceStr);
        } catch (e) {
          throw new Error(t("market.update_bad_price", "Enter a price greater than zero."));
        }
        if (!/[1-9]/.test(newBase)) {
          throw new Error(t("market.update_bad_price", "Enter a price greater than zero."));
        }
        if (newBase !== seeds.cb) {
          newPrice = {
            base: { amount: newBase, asset_id: seeds.cbId },
            quote: { amount: seeds.cq, asset_id: seeds.cqId }
          };
          priceShown = seeds.priceHuman + " → " + priceStr;
        }
      }
      var delta = null, deltaShown = null, deltaRawTitle = null;
      if (amountStr !== "") {
        var newRaw;
        try {
          newRaw = Format.parseAmount(amountStr, seeds.sellPrec);
        } catch (e) {
          throw new Error(t("market.update_bad_amount", "Enter an amount greater than zero."));
        }
        if (!/[1-9]/.test(newRaw)) {
          throw new Error(t("market.update_bad_amount", "Enter an amount greater than zero."));
        }
        var diff = (BigInt(newRaw) - BigInt(seeds.forSaleRaw)).toString();
        if (diff !== "0") {
          delta = { amount: diff, asset_id: seeds.sellId };
          var neg = diff.charAt(0) === "-";
          var mag = neg ? diff.slice(1) : diff;
          deltaShown = (neg ? "−" : "+") + Format.formatAmount(mag, seeds.sellPrec) + " " + seeds.sellSym;
          deltaRawTitle = "raw " + diff;
        }
      }
      var newExpiry = null, expiryShown = null;
      if (expiryStr !== "" && expiryStr !== seeds.expiryWire.slice(0, 16)) {
        var wire = expiryStr + ":00";
        var ms = new Date(wire + "Z").getTime();
        if (!isFinite(ms)) {
          throw new Error(t("market.update_bad_expiry", "Enter an expiration in the future."));
        }
        if (ms < Date.now() + 60000) {
          throw new Error(t("market.update_bad_expiry", "Enter an expiration in the future."));
        }
        newExpiry = wire;
        expiryShown = seeds.expiryWire + " → " + wire;
      }
      if (newPrice === null && delta === null && newExpiry === null) {
        throw new Error(t("market.update_no_change", "No changes — edit price, amount, or expiration."));
      }
      return {
        newPrice: newPrice, delta: delta, newExpiry: newExpiry,
        priceShown: priceShown, deltaShown: deltaShown, deltaRawTitle: deltaRawTitle,
        expiryShown: expiryShown,
        expectPriceBase: newPrice ? String(newPrice.base.amount) : null,
        expectForSale: delta ? (BigInt(seeds.forSaleRaw) + BigInt(delta.amount)).toString() : null,
        expectExpiry: newExpiry
      };
    }
    review.addEventListener("click", function () {
      err.style.display = "none";
      var ch;
      try {
        ch = readChanged();
      } catch (e) {
        failInline((e && e.message) || t("common.unexpected_error", "Unexpected error"));
        return;
      }
      var pending = DOM.status(box, t("trade.checking_fee", "Checking fee…"));
      pending.className = "muted";
      Promise.resolve().then(function () {
        var paintOp = [Tx.OP.limit_order_update, {
          fee: { amount: 0, asset_id: UPDATE_FEE_ASSET },
          seller: UPDATE_QUOTE_PAYER,
          order: id,
          new_price: ch.newPrice,
          delta_amount_to_sell: ch.delta,
          new_expiration: ch.newExpiry,
          on_fill: null,
          extensions: []
        }];
        return updateQuoteFeeHuman([paintOp]);
      }).catch(function () {
        return { feeHuman: t("settings.dash", "—"), feeRaw: null };
      }).then(function (Q) {
        try { box.removeChild(pending); } catch (rm) { /* navigated away */ }
        var rows = [
          [t("trade.co_orderid", "Order ID"), id],
          [t("trade.co_market", "Market"), seeds.pair]
        ];
        if (ch.priceShown !== null) {
          rows.push([t("market.update_price_change", "Price (old → new)"), ch.priceShown,
            "raw " + seeds.cb + "/" + seeds.cq]);
        }
        if (ch.deltaShown !== null) rows.push([t("market.update_amount_change", "Amount change"), ch.deltaShown, ch.deltaRawTitle]);
        if (ch.expiryShown !== null) rows.push([t("market.update_expiry_change", "Expiration (old → new)"), ch.expiryShown]);
        var dlg = null;
        function doGo() {
          var btns = dlg.getElementsByTagName("button");
          var backBtn = btns[0], goBtn = btns[1];
          backBtn.disabled = true;
          goBtn.disabled = true;
          var status = DOM.status(box, t("trade.checking_fee", "Checking fee…"));
          status.className = "muted";
          var wif = (Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
          if (typeof Tx !== "undefined" && Tx && typeof Tx.wifOk === "function" ? !Tx.wifOk(wif) : !wif) {
            box.removeChild(status);
            showError(doc, box, new Error("wallet-locked"), t("common.wallet_locked", "Wallet is locked."));
            backBtn.disabled = false;
            goBtn.disabled = false;
            return;
          }
          Account.myAccountId().then(function (myId) {
            if (seeds.seller && seeds.seller !== myId) {
              throw new Error("Order " + id + " belongs to " + seeds.seller + ", not your account.");
            }
            var op = [Tx.OP.limit_order_update, {
              fee: { amount: 0, asset_id: UPDATE_FEE_ASSET },
              seller: myId,
              order: id,
              new_price: ch.newPrice,
              delta_amount_to_sell: ch.delta,
              new_expiration: ch.newExpiry,
              on_fill: null,
              extensions: []
            }];
            return Tx.buildTx([op]).then(function (unsigned) {
              return Tx.feeMulti(unsigned.operations, UPDATE_FEE_ASSET).then(function (feeRes) {
                return updateFeeAssetMeta(unsigned.operations[0][1].fee.asset_id).then(function (meta) {
                  return { unsigned: unsigned, feeRaw: feeRes.totalRaw, meta: meta };
                });
              });
            }).then(function (R) {
              return Tx.signRouted(R.unsigned, wif, {}).then(function (r) {
                if (r.delegated) {
                  status.textContent = t("market.update_broadcasting", "Broadcasting update…");
                  return updateProveTx(updateProveUpdated(myId, id, ch), r.proof.via + "+extension").then(function (res) {
                    return { res: res, R: R };
                  });
                }
                status.textContent = t("market.update_broadcasting", "Broadcasting update…");
                return updateSendTx(r.signed, updateProveUpdated(myId, id, ch)).then(function (res) {
                  return { res: res, R: R };
                });
              });
            });
          }).then(function (out) {
            DOM.clear(box);
            box.appendChild(DOM.el(doc, "h3", t("market.update_done", "Order updated") + " (" + id + ")"));
            var okText = (out.res.found && out.res.found.gone)
              ? "Order " + id + " left the book (filled or cancelled) after the update was included at head block #" +
                String(out.res.head) + " via " + out.res.via + "."
              : "Confirmed at head block #" + String(out.res.head) + " via " + out.res.via + ".";
            var okLine = DOM.el(doc, "p", okText, "xfer-ok");
            okLine.setAttribute("aria-live", "polite");
            box.appendChild(okLine);
            box.appendChild(DOM.el(doc, "p",
              "Update fee: " + updateHumanFee(out.R.feeRaw, out.R.meta) + ".", "muted"));
            var done = touchable(DOM.el(doc, "button", t("trade.back_orders", "Back to orders")));
            done.type = "button";
            done.classList.add("btn-ghost");
            done.addEventListener("click", function () { DOM.clear(box); onDone(); });
            box.appendChild(done);
          }).catch(function (e) {
            try { box.removeChild(status); } catch (rm) { /* already gone */ }
            showError(doc, box, e, t("market.fail_update", "Update failed."));
            backBtn.disabled = false;
            goBtn.disabled = false;
          });
        }
        dlg = ConfirmDialog.show({ title: t("market.update_title", "Adjust order") + " " + id + "?",
          rows: rows,
          feeHuman: Q.feeHuman, feeTerm: t("trade.row_fee", "Fee"), feeRawTitle: Q.feeRaw,
          backLabel: t("trade.keep_order", "Keep order"), sendLabel: t("market.confirm_adjust", "Confirm adjust"),
          doc: doc,
          onBack: function () { orderUpdateBox(doc, box, order, assets, onDone,
            { price: priceF.input.value, amount: amountF.input.value, expiry: expiryF.input.value }); },
          onSend: doGo });
        box.appendChild(dlg);
      });
    });
  }

  /* Prove-fn: true once the re-read order shows the updated legs (or the
   * order is gone from the book — filled/cancelled after inclusion, reported
   * honestly by the caller). Null while the old values still read. */
  function updateProveUpdated(myId, id, ch) {
    return function () {
      return Chain.db().then(function (dbId) {
        return Chain.call(dbId, "get_limit_orders_by_account", [myId, 100]);
      }).then(function (rows) {
        var found = null;
        (rows || []).forEach(function (o) {
          if (o && o.id === id) found = o;
        });
        if (!found) return { gone: true };
        if (ch.expectPriceBase !== null) {
          var sp = found.sell_price;
          if (!sp || !sp.base || String(sp.base.amount) !== String(ch.expectPriceBase)) return null;
        }
        if (ch.expectForSale !== null) {
          if (found.for_sale === undefined || found.for_sale === null ||
              String(found.for_sale) !== String(ch.expectForSale)) return null;
        }
        if (ch.expectExpiry !== null) {
          if (String(found.expiration) !== String(ch.expectExpiry)) return null;
        }
        return { updated: found };
      });
    };
  }

  /* Per-row Cancel button: paints TradeUI's inline confirm into the shared
   * box (order id 1.7.x shown there). Done callback re-renders this list. */
  function cancelButton(doc, order, assets, cancelBox, rerender) {
    var b = touchable(DOM.el(doc, "button", t("trade.cancel_button", "Cancel")));
    b.type = "button";
    b.className = "btn-ghost";
    b.setAttribute("aria-label", t("explorer.pill_cancel", "Cancel order") + " " + String(order.id));
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
   * (tail-per-head, 4-sf display via Format.priceSig, BigInt math beneath).
   * Unknown shapes stay honest. Display-only strings (paintOrders renders
   * text + raw-details proof); never inputs, never math. */
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
        /* 4-sf display (global price rule); "—" shapes skip it. */
        if (price !== "—" && typeof Format.priceSig === "function") {
          var osig = Format.priceSig(price);
          if (typeof osig === "string" && osig) price = osig;
        }
      }
    } catch (e) { price = "—"; }
    return { id: id, side: side, amount: amount, price: price };
  }

  return {
    render: render,
    renderTape: renderTape
  };
})();

if (typeof module !== "undefined") { module.exports = MarketOrders; }
