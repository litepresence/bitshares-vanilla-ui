/* market-desk-panels.js — DEX desk book + trades panes (DOM rendering).
 *
 * What it owns: paintBook (grouped/exact bids+asks), renderMyTrades
 *   (live/fills pane + locked hint), paintDeepButton/paintBackButton
 *   (lazy-deep backfill entry/exit), deepenOnce (chain-first candle
 *   backfill trigger). Consumes: MarketDesk._fill.fill (refill after
 *   deep/back actions — late-bound at call time), MarketBook/MarketOrders/
 *   MarketInd/DOM. Globals/side effects: DOM under caller-provided bodies
 *   only; attaches MarketDesk._panels and republishes globalThis.MarketDesk.
 *   No signing. Split from market-desk.js (mechanical move, zero behavior
 *   change — called by the facade showDesk + fill via the registry).
 *   Facade: market-desk.js.
 * Created by: split_responsibility.py account/market frontier.
 */
var MarketDesk = (typeof globalThis !== "undefined" && globalThis.MarketDesk) ? globalThis.MarketDesk : ((typeof MarketDesk !== "undefined") ? MarketDesk : {});
MarketDesk._panels = MarketDesk._panels || {};
(function () {
  "use strict";

  /* Verbatim copy of market-desk.js t (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
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

  /* No local el/clearRoot — use DOM.el, DOM.clear */

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */

  /* Verbatim copy of market-desk.js showError (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
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

  /* Verbatim copy of market-desk.js rawDetails (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Raw-JSON <details> block for a section ( P R O O F, not decoration).
   * Triangle-only summary per the shared details.raw contract in app.css. */
  function rawDetails(doc, section, label, value) {
    var d = doc.createElement("details");
    d.className = "raw";
    var s = doc.createElement("summary");
    s.setAttribute("aria-label", label || t("market.raw_fallback", "Show raw JSON"));
    touchable(s);
    d.appendChild(s);
    var pre = doc.createElement("pre");
    try {
      pre.textContent = JSON.stringify(value, null, 2);
    } catch (e) {
      pre.textContent = String(value);
    }
    d.appendChild(pre);
    section.appendChild(d);
  }

  /* Verbatim copy of market-desk.js defaultMarket (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Canonical default market per bitshares-ui/app/branding.js:98-108. */
  function defaultMarket() {
    return network() === "testnet" ? "USD_TEST" : "BTS_CNY";
  }

  /* Verbatim copy of market-desk.js network (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
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

  /* My-trades pane (mirrors #1 myMarketHistory, Exchange.jsx:2583-2616 +
   * MarketHistory.jsx:159-204): the wallet account's fill_order ops (op 4,
   * protocol/operations.hpp:60) filtered to this QUOTE_BASE pair
   * (pays/receives touch both legs, MarketHistory.jsx:176-184). Anyone can
   * type an account (name or 1.2.N) + Look up to preview ITS fills via
   * public Account.history; blank + locked keeps the Wallet-link hint
   * (principle #9: reads never gate on unlock, but MY fills need a key).
   * Unlocked prefills the wallet account; the wallet auto-load is unchanged.
   * Amounts/prices go through Format (BigInt, 8 places like Market.trades)
   * — never raw integers (#6). */
  /* paintDeepButton: "Load deeper history" under the recent-trades list
   * (Phase 7 B1 UI). One-shot 7-day window via Market.tradesDeep (same
   * envelope as trades(), so renderTrades is reused verbatim). Success
   * stores state.deepRows and paints the deep view, which SURVIVES the 15s
   * refill loop (fill() re-renders deepRows instead of refetching — without
   * this the loop clobbers deep rows within seconds and in-flight fetches
   * resolve into a stale host). "Back to live" clears the flag and
   * refills. Failure appends the mapped error with the Round-1 Settings
   * link and re-arms for retry. Gen-guarded by market id like live() below.
   * Params: doc, state, b/q (asset {id, symbol}). Fails: never (fetch
   * errors render inline). */
  function paintDeepButton(doc, state, b, q) {
    var host = state.recentBody || state.tradesBody;
    if (!host) return;
    try { if (state.deepBtn && state.deepBtn.parentNode) state.deepBtn.parentNode.removeChild(state.deepBtn); } catch (e) { /* refetch stands */ }
    state.deepBtn = null;
    if (state.deepRows) { paintBackButton(doc, state); return; }
    if (typeof Market === "undefined" || !Market || typeof Market.tradesDeep !== "function") return;
    var btn = touchable(DOM.el(doc, "button", t("market.load_deeper", "Load deeper history")));
    btn.type = "button";
    state.deepBtn = btn;
    host.appendChild(btn);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      Market.tradesDeep(b.id, q.id, { days: 7, limit: 100 }).then(function (deep) {
        try {
          if (String((typeof location !== "undefined" && location.hash) || "").toUpperCase().indexOf(state.id) === -1) return;
        } catch (e) { /* headless: hash guard skipped */ }
        state.deepRows = deep;
        MarketBook.renderTrades(doc, host, { rows: deep, quoteSymbol: q.symbol });
        paintBackButton(doc, state);
        renderMyTrades(doc, state);
        MarketInd.maybeDraw(state);
      }).catch(function (e) {
        showError(doc, host, e, t("market.fail_trades", "Could not load recent trades."));
        try { host.appendChild(btn); } catch (e2) { /* error stands */ }
        btn.disabled = false;
        renderMyTrades(doc, state);
      });
    });
  }

  /* paintBackButton: leaves the deep view ("Back to live trades" clears
   * state.deepRows and refills the live 30). Params: doc, state. The desk
   * re-renders deep rows on every refill while the flag stands, so this is
   * the only exit — no auto-expiry, no surprise reverts. Never throws. */
  function paintBackButton(doc, state) {
    var host = state.recentBody || state.tradesBody;
    if (!host) return;
    try { if (state.deepBtn && state.deepBtn.parentNode) state.deepBtn.parentNode.removeChild(state.deepBtn); } catch (e) { /* refetch stands */ }
    state.deepBtn = null;
    var back = touchable(DOM.el(doc, "button", t("market.back_to_live", "Back to live trades")));
    back.type = "button";
    state.deepBtn = back;
    host.appendChild(back);
    back.addEventListener("click", function () {
      state.deepRows = null;
      state.deepBtn = null;
      try { MarketDesk._fill.fill(state); } catch (e) { /* refill carries errors */ }
    });
  }

  function renderMyTrades(doc, state) {
    var host = state.myBody || state.tradesBody;
    var assets = state.assets;
    if (!host || !assets) return;
    DOM.clear(host);
    var tok = (state._myGen = (state._myGen || 0) + 1);
    /* live: this my-trades render is still current (generation token
     * matches and the desk hash is still on this market). Stale async
     * fills must not paint. */
    function live() {
      if (tok !== state._myGen) return false;
      try {
        if (String((typeof location !== "undefined" && location.hash) || "").toUpperCase().indexOf(state.id) === -1) return false;
      } catch (e) { /* headless: hash guard skipped */ }
      return true;
    }
    var unlocked = false;
    try {
      unlocked = typeof Wallet !== "undefined" && Wallet &&
        (typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys);
    } catch (e) { unlocked = false; }
    /* Typed-account preview row (public reads only). */
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
    host.appendChild(acctRow);
    var myBody = doc.createElement("div");
    host.appendChild(myBody);
    /* lockedHint: locked-wallet empty state with a Wallet link. */
    function lockedHint() {
      DOM.clear(myBody);
      var hint = DOM.el(doc, "p", t("market.my_trades_locked", "Unlock your wallet to see your fills on this market. "), "muted");
      var a = DOM.el(doc, "a", t("market.go_wallet", "Go to Wallet"));
      a.setAttribute("href", "#/wallet");
      touchable(a);
      hint.appendChild(a);
      myBody.appendChild(hint);
    }
    var q = assets.quote, b = assets.base;
    /* Same op-4 pair filter as the old auto-load below
     * (MarketHistory.jsx:176-184): fill ops whose pays/receives legs touch
     * both market assets. */
    function pairFills(rows) {
      var fills = [];
      (rows || []).forEach(function (r) {
        var tup = r ? r.op : null;
        var opId = null, op = null;
        if (Array.isArray(tup)) { opId = tup[0]; op = tup[1]; }
        else if (r && r.operation_type !== undefined) { opId = r.operation_type; op = r; }
        else if (r && r.op_type !== undefined) { opId = r.op_type; op = r; }
        if (opId !== 4 || !op) return;
        var pays = op.pays || null, recv = op.receives || null;
        if (!pays || !recv || !pays.asset_id || !recv.asset_id) return;
        var hasQ = pays.asset_id === q.id || recv.asset_id === q.id;
        var hasB = pays.asset_id === b.id || recv.asset_id === b.id;
        if (!hasQ || !hasB) return;
        fills.push({ row: r, op: op });
      });
      return fills;
    }
    /* fillCells: one pair-fill -> plain display-string row {block, price,
     * amount} (TableRenderer pilot: the cell math moved verbatim from the
     * paintFills row builder below — Format math untouched, honest dashes
     * stand; the phone cards reuse the same triple). Params: f ({row, op}).
     * Returns {block, price, amount} strings. Never throws. */
    function fillCells(f) {
      var blk = f.row.block_num !== undefined && f.row.block_num !== null ? String(f.row.block_num) : (f.row.block_time || f.row.time || "—");
      var price = "—", amt = "—";
      try {
        var fp = f.op.fill_price || null;
        if (fp && fp.base && fp.quote && /^-?\d+$/.test(String(fp.base.amount)) && /^-?\d+$/.test(String(fp.quote.amount))) {
          var rawB = fp.base.asset_id === b.id ? String(fp.base.amount) : (fp.quote.asset_id === b.id ? String(fp.quote.amount) : null);
          var rawQ = fp.base.asset_id === q.id ? String(fp.base.amount) : (fp.quote.asset_id === q.id ? String(fp.quote.amount) : null);
          if (rawB !== null && rawQ !== null) {
            price = Format.formatPrice(rawB, b.precision, rawQ, q.precision, 8);
          }
        }
        var qLeg = f.op.pays && f.op.pays.asset_id === q.id ? f.op.pays : (f.op.receives && f.op.receives.asset_id === q.id ? f.op.receives : null);
        if (qLeg && /^-?\d+$/.test(String(qLeg.amount))) {
          amt = Format.formatAmount(String(qLeg.amount), q.precision) + " " + q.symbol;
        }
      } catch (e) { /* honest dashes stand */ }
      return { block: String(blk), price: String(price), amount: String(amt) };
    }
    /* paintFills: op-4 pair fills for the typed/unlocked account as a
     * table (empty -> honest hint). No-ops when live() is false. */
    function paintFills(fills) {
      if (!live()) return;
      DOM.clear(myBody);
      if (fills.length === 0) {
        myBody.appendChild(DOM.el(doc, "p", t("market.no_my_trades", "No fills for your account on this market.") + t("market.my_trades_hint", " Place an order from the Buy/Sell panels — unlock the wallet to see your fills."), "muted"));
        return;
      }
      var shown = fills.slice(0, 30);
      var rows = shown.map(fillCells);
      /* TableRenderer pilot: the table shell comes from the shared renderer
       * (same Block/Price/Amount titles, order, and left alignment as the
       * hand-built table it replaces — no keys, classes, or clicks before,
       * none added). Cards + scroller + raw details below are unchanged. */
      var table = TableRenderer.render({
        columns: [
          { key: "block", title: t("market.th_block", "Block") },
          { key: "price", title: t("market.th_price", "Price") },
          { key: "amount", title: t("market.th_amount", "Amount") }
        ],
        rows: rows,
        stickyFirstCol: true
      });
      var cards = doc.createElement("div");
      cards.className = "node-cards trades-cards";
      shown.forEach(function (f, i) {
        var card = doc.createElement("div");
        card.className = "node-card";
        card.appendChild(DOM.el(doc, "div", "#" + rows[i].block));
        card.appendChild(DOM.el(doc, "div", rows[i].price));
        card.appendChild(DOM.el(doc, "div", rows[i].amount));
        cards.appendChild(card);
      });
      var scroller = doc.createElement("div");
      scroller.className = "trades-scroll";
      scroller.appendChild(table);
      myBody.appendChild(scroller);
      myBody.appendChild(cards);
      rawDetails(doc, myBody, t("market.raw_my_fills", "Raw my fills"), shown.map(function (f) { return f.row; }));
    }
    /* Typed-account lookup: resolve the input, then paint that account's
     * fills for this pair via public Account.history. Blank + locked keeps
     * the hint; blank + unlocked reloads the wallet auto-load. */
    function loadTyped() {
      if (!live()) return;
      var v = acctInput.value.trim();
      if (!v) {
        if (tok !== state._myGen) return;
        if (!unlocked) lockedHint();
        else renderMyTrades(doc, state);
        return;
      }
      DOM.clear(myBody);
      myBody.appendChild(DOM.el(doc, "p", t("market.loading_my_trades", "Loading your fills…"), "muted"));
      Promise.resolve().then(function () {
        if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
          throw new Error("account backend missing");
        }
        return Account.resolve(v);
      }).then(function (acct) {
        return Account.history(acct.id, 100);
      }).then(function (rows) {
        if (!live()) return;
        paintFills(pairFills(rows || []));
      }).catch(function (e) {
        if (!live()) return;
        DOM.clear(myBody);
        showError(doc, myBody, e, t("market.fail_my_trades", "Could not load your fills."));
      });
    }
    viewBtn.addEventListener("click", loadTyped);
    if (!unlocked) {
      lockedHint();
      return;
    }
    /* Unlocked: prefill the wallet account id (convenience only); the
     * auto-load below is the unchanged wallet path. */
    try {
      if (typeof Account !== "undefined" && Account && typeof Account.myAccountId === "function") {
        Account.myAccountId().then(function (id) {
          if (tok !== state._myGen) return;
          if (!acctInput.value && id) acctInput.value = String(id);
        }).catch(function () { /* auto-load below stands */ });
      }
    } catch (e) { /* auto-load below stands */ }
    myBody.appendChild(DOM.el(doc, "p", t("market.loading_my_trades", "Loading your fills…"), "muted"));
    Account.myAccountId().then(function (myId) {
      return Account.history(myId, 100).then(function (rows) {
        return { myId: myId, rows: rows || [] };
      });
    }).then(function (found) {
      if (!live()) return;
      paintFills(pairFills(found.rows));
    }).catch(function (e) {
      if (!live()) return;
      DOM.clear(myBody);
      showError(doc, myBody, e, t("market.fail_my_trades", "Could not load your fills."));
    });
  }

  /* Lazy-deep backfill (2026-10-01 audit): after the chain-first candle
   * paint, fetch the background ES buckets ONCE per pair+bucket, then re-run
   * the chain candles (which merge the cache under fresh authority) and
   * repaint with the "deep" note. Interval refreshes and live-tip polls never
   * call this — they stay chain-only, so an idle desk costs ~0 ES bytes
   * after the first deepen. Params: state (desk), b/q asset rows. Returns
   * nothing. Never throws outward. */
  function deepenOnce(state, b, q) {
    try {
      /* Count-aware key: changing the candle window must re-deepen (the old
       * pair+bucket key reused a stale-window ES merge after count edits). */
      var deepCount = 2000;
      try { if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) deepCount = MarketInd.CANDLE_COUNT; } catch (e) { /* default stands */ }
      var key = b.id + "|" + q.id + "|" + state.bucket + "|" + deepCount;
      if (state.deepKey === key || state._deepFlight === key) return;
      if (typeof Market === "undefined" || !Market || typeof Market.deepen !== "function") return;
      state._deepFlight = key;
      Market.deepen(b.id, q.id, state.bucket).then(function (d) {
        if (state._deepFlight === key) state._deepFlight = null;
        if (!d) return;
        var nowKey = b.id + "|" + q.id + "|" + state.bucket + "|" + deepCount;
        if (nowKey !== key) return; // bucket/pair/count moved on mid-flight
        try {
          if (String((typeof location !== "undefined" && location.hash) || "").toUpperCase().indexOf(state.id) === -1) return;
        } catch (e) { /* headless: keep going */ }
        state.deepKey = key;
        var count = 2000;
        try { if (typeof MarketInd !== "undefined" && MarketInd && MarketInd.CANDLE_COUNT) count = MarketInd.CANDLE_COUNT; } catch (e) { /* default stands */ }
        Market.candles(b.id, q.id, state.bucket, count).then(function (c2) {
          var k2 = b.id + "|" + q.id + "|" + state.bucket + "|" + count;
          if (k2 !== key) return;
          try {
            if (String((typeof location !== "undefined" && location.hash) || "").toUpperCase().indexOf(state.id) === -1) return;
          } catch (e) { /* headless: keep going */ }
          /* Newest paint wins (see refreshTip): deepen completion invalidates
           * older in-flight tips before its own synchronous paint. */
          try { state.tipSeq = (state.tipSeq || 0) + 1; } catch (e) { /* seq best-effort */ }
          state.candles = c2;
          try { state.deep = !!(c2 && c2.deep); } catch (err) { state.deep = false; }
          try { MarketInd.maybeDraw(state); } catch (err) { /* chart best-effort */ }
          /* paintNote rides state (module scope cannot see the nested
           * closure); missing means a torn-down desk — never throws. */
          try { if (typeof state.paintNote === "function") state.paintNote(); } catch (err) { /* note best-effort */ }
        }).catch(function () { /* chain paint stands */ });
      }).catch(function () {
        if (state._deepFlight === key) state._deepFlight = null;
      });
    } catch (e) { /* deep is best-effort */ }
  }

  /* paintBook: render bids/asks from the cached get_order_book pair.
   * Applies state.groupDec (null = exact) via MarketBook.groupBook
   * (client-side floor bucketing — no refetch, no new WS method, no ES) and
   * paints through MarketBook.renderSplit (depth bars follow the grouped
   * rows; the returned depth is cached for charts). Grouping faults fall
   * back to the exact book — the lists never blank. No-op without a cached
   * pair or assets. Params: (doc, state). Never throws outward. */
  function paintBook(doc, state) {
    try {
      if (!state || !state.bookRaw || !state.assets) return;
      if (!state.bidsBody || !state.asksBody || !state.spreadLine) return;
      if (typeof MarketBook === "undefined" || !MarketBook ||
          typeof MarketBook.renderSplit !== "function") return;
      var grouped = state.bookRaw;
      try {
        if (state.groupDec !== null && state.groupDec !== undefined &&
            typeof MarketBook.groupBook === "function") {
          grouped = MarketBook.groupBook(state.bookRaw, state.groupDec);
        }
      } catch (e) { grouped = state.bookRaw; /* exact book stands */ }
      state.bookDepth = MarketBook.renderSplit(doc, state.bidsBody, state.asksBody, {
        book: grouped, basePrec: state.assets.base.precision, quotePrec: state.assets.quote.precision,
        baseSymbol: state.assets.base.symbol, quoteSymbol: state.assets.quote.symbol,
        spreadLine: state.spreadLine, logVol: !!state.depthLogY
      });
    } catch (e) { /* book cells keep their previous paint */ }
  }
  MarketDesk._panels.paintDeepButton = paintDeepButton;
  MarketDesk._panels.paintBackButton = paintBackButton;
  MarketDesk._panels.renderMyTrades = renderMyTrades;
  MarketDesk._panels.deepenOnce = deepenOnce;
  MarketDesk._panels.paintBook = paintBook;
  if (typeof globalThis !== "undefined") { globalThis.MarketDesk = MarketDesk; }
})();

if (typeof module !== "undefined") { module.exports = MarketDesk; }
