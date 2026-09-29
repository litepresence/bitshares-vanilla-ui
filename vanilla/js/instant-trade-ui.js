/* instant-trade-ui.js — simple buy/sell view (slice-6 limit-order path, simpler form).
 * Owns: /instant-trade + /instant-trade/:marketID (market pick, side, amount, review,
 *   done). Price pre-fills from the book best (buy = lowest ask, sell = highest bid),
 *   then ONE op-1 via Tx.buildTx + Tx.feeMulti + Tx.sign + Chain broadcast with
 *   get_limit_orders_by_account proof. No new serializers. Consumes: Market, Tx,
 *   Format (only money entries), Wallet (unlock/WIF as JS value, never DOM), Account,
 *   Chain, Store. Global InstantTradeUI only; gen counter tears down stale work.
 * Refs: App.jsx:639-648 (QUOTE_BASE per MarketRow.jsx:70); QuickTrade.jsx +
 *   QuickTradeHelper.js; confirm names <- popup.js:5724-5731; astro
  *   instant_trade.astro (Beet signing NOT copied). Deviations: fixed 1-year expiry,
  *   fill_or_kill=false, single orders only (scaled stays on the desk). P = BASE per
  *   1 QUOTE (trade-form.js). Money: integer strings + BigInt until render, Format only.
  * PUBLIC-FIRST (gate repair): no wallet gate — market/stats/book-best quote
  *   renders locked; review previews as committee-account 1.2.0 with a viewing
  *   notice (balance checks need the wallet, so they are skipped locked with an
  *   honest warning). Password is asked only at Sign & Send (sign-time gate +
  *   inline unlock).
  * Created by: stub-queue build (matrix §A row A31).
 */
var InstantTradeUI = (function () {
  "use strict";

  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. vars supports
   * %(name)s templates at a few asset/named-count labels. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  var gen = 0;
  var FEE_ASSET = "1.3.0";
  var PROVE_TIMEOUT_MS = 30000, PROVE_INTERVAL_MS = 2500, PRICE_PLACES = 8;
  /* textContent-only element (user/chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  /* Touch floor (#7): interactive elements >= 44px one dimension. */
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("instant.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("instant.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    else if (msg.indexOf("wallet-locked") !== -1) msg = t("instant.wallet_is_locked", "Wallet is locked.");
    else if (msg.indexOf("no-account") !== -1) msg = t("instant.no_on_chain_account_found_for_the_wallet_s_ac", "No on-chain account found for the wallet's active key.");
    else if (msg.indexOf("unknown-account") !== -1) msg = t("instant.unknown_market_asset", "Unknown market asset.");
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  /* Status line for multi-step flows (loading → review → broadcast). */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite");
    wrap.appendChild(p); return p; }
  /* Labeled input row with its own inline error slot. opts.unit renders a
   * unit suffix span after the input (dexux-ref cue, textContent only). */
  function fieldRow(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input"); input.type = opts.type || "text";
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    if (opts.id) input.id = opts.id;
    if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    touchable(input);
    if (opts.unit) {
      var wrap = doc.createElement("span"); wrap.className = "unit-wrap";
      wrap.appendChild(input);
      wrap.appendChild(el(doc, "span", opts.unit, "unit-suffix"));
      label.appendChild(wrap);
    } else {
      label.appendChild(input);
    }
    row.appendChild(label);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite"); err.style.display = "none"; row.appendChild(err);
    return { row: row, input: input, err: err }; }
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : t("instant.none", "none"); }
  /* Network label from Store (sole settings owner); mainnet when unreadable. */
  function networkName() {
    try {
      var s = Store.loadSettings();
      if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
    } catch (e) { /* default stands */ }
    return "mainnet"; }
  /* 10n ** exp without Number (money-safe; same helper as trade-form.js). */
  function pow10(exp) { var out = 1n, i; for (i = 0; i < exp; i++) out *= 10n; return out; }
  /* QUOTE raw -> BASE raw at price num/den, BigInt floor (trade-form.js:162). */
  function quoteToBaseRaw(quoteRaw, num, den, qp, bp) {
    if (num <= 0n || den <= 0n) throw new Error("Price must be greater than zero.");
    var n = BigInt(quoteRaw) * num, d = den, shift = bp - qp;
    if (shift >= 0) n = n * pow10(shift); else d = d * pow10(-shift);
    return (n / d).toString(); }
  /* Exact BigInt ratio -> fixed-places decimal string (floor, display only). */
  function ratioToDec(num, den, places) {
    if (den <= 0n) throw new Error("bad price ratio");
    var v = (num * pow10(places) / den).toString();
    while (v.length <= places) v = "0" + v;
    return places === 0 ? v : v.slice(0, -places) + "." + v.slice(-places); }
  /* Chain price string (human base-per-quote, any precision) -> normalized
   * PRICE_PLACES human decimals via Format.parsePriceRatio + ratioToDec
   * (BigInt only, never float). Returns {human, raw}: human for display,
   * raw (verbatim chain string) for the title attribute (principle #6).
   * WHY: get_ticker/get_order_book price strings arrive full-precision
   * (audit saw 18-decimal raws on screen); inputs + stats must show the
   * trimmed human, never the verbatim long string. Never throws. */
  function humanPrice(str) {
    var raw = (str === undefined || str === null) ? "" : String(str);
    if (!raw) return { human: "", raw: raw };
    try {
      var r = Format.parsePriceRatio(raw);
      if (!r || r.den <= 0n || r.num <= 0n) return { human: raw, raw: raw };
      return { human: ratioToDec(r.num, r.den, PRICE_PLACES), raw: raw };
    } catch (e) { return { human: raw, raw: raw }; } }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  /* Default viewing account while locked: committee-account 1.2.0 (a public
   * chain object on testnet+mainnet, verified live 2026-09-28). Quotes stay
   * public under it; signing gates at Sign & Send. Never throws. */
  var VIEWING_AS_ID = "1.2.0", VIEWING_AS_NAME = "committee-account";
  function isUnlockedNow() {
    try {
      if (typeof Wallet !== "undefined" && typeof Wallet.isUnlocked === "function") return !!Wallet.isUnlocked();
      return !!(typeof Wallet !== "undefined" && Wallet.keys);
    } catch (e) { return false; }
  }
  function unlockInline(doc, parent, onUnlock) { /* in-place password row (no route re-render, so previews survive) */
    if (parent.querySelector && parent.querySelector(".xfer-unlock-row")) return;
    var row = el(doc, "div", null, "xfer-field xfer-unlock-row");
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("autocomplete", "current-password");
    inp.setAttribute("placeholder", t("instant.password", "Password ")); inp.setAttribute("aria-label", t("instant.password", "Password "));
    touchable(inp); row.appendChild(inp);
    var b = touchable(el(doc, "button", t("instant.unlock", "Unlock"))); b.type = "button"; row.appendChild(b);
    parent.appendChild(row);
    b.addEventListener("click", function () { b.disabled = true;
      Wallet.unlock(inp.value).then(function () { inp.value = ""; if (onUnlock) onUnlock(); })
        .catch(function (e) { b.disabled = false; showError(doc, parent, e, t("instant.unlock_failed", "Unlock failed")); });
    });
  }

  /* Route entry. Gates backends, waits for the shared socket (transfer-ui.js
   * connect-wait pattern), then paints the single-screen form.
   * PUBLIC-FIRST: no wallet gate — the quote form renders locked. */
  function renderInstant(root, marketID) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Tx === "undefined" || !Tx || typeof Market === "undefined" || !Market ||
        typeof Account === "undefined" || !Account || typeof Wallet === "undefined" || !Wallet ||
        typeof Format === "undefined" || !Format) {
      showError(doc, wrap, t("instant.trade_backend_missing_js_tx_js_js_market_js_j", "Trade backend missing: js/tx.js, js/market.js, js/account.js, js/wallet.js or js/format.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "h1", t("instant.instant_trade", "Instant Trade")));
      wrap.appendChild(el(doc, "p", t("instant.connecting_to_network", "Connecting to network…"), "muted"));
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderInstant(root, marketID);
        }
      });
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        clearRoot(root);
        showError(doc, makeWrap(doc, root), new Error("not connected"), t("instant.network_unavailable", "Network unavailable."));
      }, 15000);
      return;
    }
    paintTrade(doc, root, myGen, { marketID: (typeof marketID === "string" && marketID) ? marketID : "", side: "buy", amount: "", price: "", M: null });
  }

  /* Single-screen form: market + side + Load; once loaded, stats + amount +
   * price (book-best prefill) + Review. State P survives Back/re-renders. */
  function paintTrade(doc, root, myGen, P) {
    if (myGen !== gen) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("instant.instant_trade", "Instant Trade")));
    if (!isUnlockedNow()) wrap.appendChild(el(doc, "p", t("instant.viewing_as", "Viewing as committee-account (1.2.0) — unlock to trade as your account."), "muted"));
    wrap.appendChild(el(doc, "p", t("instant.pick_a_market_choose_a_side_enter_an_amount_t", "Pick a market, choose a side, enter an amount. The price fills from the order book; review and sign one limit order."), "muted"));
    /* Order-type strip (dexux-ref LIMIT/SCALED shape): this view is
     * limit-only, so LIMIT is the active tab and SCALED links to the full
     * desk (existing route, no behavior change to the form itself). */
    var tabs = el(doc, "div", null, "order-tabs");
    tabs.appendChild(el(doc, "span", t("instant.limit", "Limit"), "order-tab-active"));
    var scaledLink = doc.createElement("a");
    scaledLink.textContent = t("instant.scaled", "Scaled");
    scaledLink.setAttribute("href", "#/market/" + (P.marketID || "BTS_CNY"));
    tabs.appendChild(scaledLink);
    wrap.appendChild(tabs);
    var mktF = fieldRow(doc, t("instant.market_quote_base", "Market (QUOTE_BASE) "), { id: "it-market", value: P.marketID, placeholder: "BTS_CNY", inputmode: "text" });
    wrap.appendChild(mktF.row);
    var sideRow = el(doc, "div", null, "xfer-field"), sideLabel = el(doc, "label", t("instant.side", "Side "));
    var sideSel = doc.createElement("select");
    [["buy", t("instant.buy_quote_spend_base", "Buy QUOTE (spend BASE)")], ["sell", t("instant.sell_quote_receive_base", "Sell QUOTE (receive BASE)")]].forEach(function (o) {
      var opt = doc.createElement("option"); opt.value = o[0]; opt.textContent = o[1];
      if (o[0] === P.side) opt.selected = true;
      sideSel.appendChild(opt);
    });
    touchable(sideSel); sideLabel.appendChild(sideSel); sideRow.appendChild(sideLabel);
    wrap.appendChild(sideRow);
    var loadBtn = touchable(el(doc, "button", t("instant.load_market", "Load market")));
    loadBtn.id = "it-load"; loadBtn.type = "button"; wrap.appendChild(loadBtn);
    var out = el(doc, "div"); wrap.appendChild(out);
    function load() {
      setFieldError(mktF, ""); out.innerHTML = "";
      P.marketID = mktF.input.value.trim(); P.side = sideSel.value;
      if (!P.marketID) { setFieldError(mktF, t("instant.enter_a_market_like_bts_cny", "Enter a market like BTS_CNY.")); return; }
      loadBtn.disabled = true;
      var status = showStatus(doc, out, t("instant.loading_market", "Loading market…"));
      loadMarket(P.marketID).then(function (M) {
        if (myGen !== gen) return;
        try { if (status.parentNode === out) out.removeChild(status); } catch (e) { /* gone */ }
        loadBtn.disabled = false;
        P.M = M; paintLoaded(doc, root, myGen, P);
      }).catch(function (e) {
        if (myGen !== gen) return;
        out.removeChild(status); loadBtn.disabled = false;
        var msg = (e && e.message) ? e.message : String(e || t("instant.could_not_load_the_market", "Could not load the market."));
        if (msg === "bad-market") msg = t("instant.market_must_look_like_quote_base_e_g_bts_cny", "Market must look like QUOTE_BASE (e.g. BTS_CNY).");
        setFieldError(mktF, msg); showError(doc, out, msg, t("instant.could_not_load_the_market", "Could not load the market."));
      });
    }
    loadBtn.addEventListener("click", load);
    sideSel.addEventListener("change", function () { P.side = sideSel.value; P.price = ""; });
    if (P.marketID && !P.M) load();
    else if (P.M) paintLoaded(doc, root, myGen, P);
  }

  /* Resolve market assets + stats/book. bestBid/bestAsk are human strings. */
  async function loadMarket(marketID) {
    var pair = Market.parseId(marketID), am = await Market.assets(pair.quote, pair.base);
    var ctx = { quote: am.quote.id, base: am.base.id, quoteSym: am.quote.symbol, baseSym: am.base.symbol, quotePrec: am.quote.precision, basePrec: am.base.precision };
    var stats = null, book = { bids: [], asks: [] };
    try { stats = await Market.stats(ctx.base, ctx.quote); } catch (e) { stats = null; }
    try { book = await Market.book(ctx.base, ctx.quote, 5); } catch (e) { book = { bids: [], asks: [] }; }
    return { ctx: ctx, stats: stats,
      bestBid: (book.bids && book.bids[0]) ? book.bids[0].displayPrice : null,
      bestAsk: (book.asks && book.asks[0]) ? book.asks[0].displayPrice : null };
  }

  /* Loaded section: stats line, empty-book note, amount + price + Review. */
  function paintLoaded(doc, root, myGen, P) {
    var wrap = root.firstChild;
    if (!wrap) return;
    var old = doc.getElementById("it-loaded");
    if (old) old.parentNode.removeChild(old);
    var box = el(doc, "div"); box.id = "it-loaded"; wrap.appendChild(box);
    var M = P.M, ctx = M.ctx;
    try {
      var sLink = wrap.querySelector(".order-tabs a");
      if (sLink) sLink.setAttribute("href", "#/market/" + ctx.quoteSym + "_" + ctx.baseSym);
    } catch (e) { /* strip keeps its default desk link */ }
    box.appendChild(el(doc, "p", "Trade " + ctx.quoteSym + " / " + ctx.baseSym + " — " + (P.side === "buy" ? "Buy " + ctx.quoteSym : "Sell " + ctx.quoteSym), "muted"));
    /* Principle #6: chain price strings arrive full-precision — normalize via
     * Format (human visible, verbatim raw in title), never raw on screen. */
    var latestH = (M.stats && M.stats.latest) ? humanPrice(M.stats.latest) : null;
    var bidH = M.bestBid ? humanPrice(M.bestBid) : null;
    var askH = M.bestAsk ? humanPrice(M.bestAsk) : null;
    var statsP = el(doc, "p", null, "muted");
    statsP.appendChild(doc.createTextNode("Latest: "));
    var latestSpan = el(doc, "span", latestH ? latestH.human : "—");
    if (latestH) { try { latestSpan.title = latestH.raw; } catch (e) { /* title best-effort */ } }
    statsP.appendChild(latestSpan);
    statsP.appendChild(doc.createTextNode(" · Best bid: "));
    var bidSpan = el(doc, "span", bidH ? bidH.human : "—");
    if (bidH) { try { bidSpan.title = bidH.raw; } catch (e) { /* title best-effort */ } }
    statsP.appendChild(bidSpan);
    statsP.appendChild(doc.createTextNode(" · Best ask: "));
    var askSpan = el(doc, "span", askH ? askH.human : "—");
    if (askH) { try { askSpan.title = askH.raw; } catch (e) { /* title best-effort */ } }
    statsP.appendChild(askSpan);
    box.appendChild(statsP);
    if (!M.bestBid && !M.bestAsk) box.appendChild(el(doc, "p", t("instant.the_order_book_is_empty_type_a_price_manually", "The order book is empty — type a price manually."), "muted"));
    if (!P.price) P.price = P.side === "buy" ? (askH ? askH.human : "") : (bidH ? bidH.human : "");
    var amountF = fieldRow(doc, t("instant.amount_tpl", "Amount (%(sym)s) ", { sym: ctx.quoteSym }), { id: "it-amount", value: P.amount, placeholder: "0.00", inputmode: "decimal", unit: ctx.quoteSym });
    box.appendChild(amountF.row);
    var priceF = fieldRow(doc, t("instant.price_tpl", "Price (%(base)s per %(quote)s) ", { base: ctx.baseSym, quote: ctx.quoteSym }), { id: "it-price", value: P.price, placeholder: "0.00", inputmode: "decimal", unit: ctx.baseSym + " / " + ctx.quoteSym });
    box.appendChild(priceF.row);
    var reviewBtn = touchable(el(doc, "button", t("instant.review_order", "Review order")));
    reviewBtn.id = "it-review"; reviewBtn.type = "button"; box.appendChild(reviewBtn);
    reviewBtn.addEventListener("click", function () {
      setFieldError(amountF, ""); setFieldError(priceF, "");
      P.amount = amountF.input.value; P.price = priceF.input.value;
      reviewBtn.disabled = true;
      var status = showStatus(doc, box, t("instant.checking_balance_and_fee", "Checking balance and fee…"));
      reviewOrder(P, M).then(function (R) { if (myGen === gen) paintConfirm(doc, root, myGen, P, M, R); })
        .catch(function (e) {
          if (myGen !== gen) return;
          var msg = (e && e.message) ? e.message : String(e || t("instant.could_not_prepare_the_order", "Could not prepare the order."));
          if (msg.indexOf("bad amount") === 0 || msg.indexOf("too many decimals") === 0 || msg.indexOf("Amount must be") === 0 || msg.indexOf("Insufficient") === 0) setFieldError(amountF, msg);
          else if (msg.indexOf("bad price") === 0 || msg.indexOf("Price must be") === 0) setFieldError(priceF, msg);
          box.removeChild(status); reviewBtn.disabled = false;
          showError(doc, box, msg, t("instant.could_not_prepare_the_order", "Could not prepare the order."));
        });
    });
  }

  /* Validate, balance-check, build unsigned op-1, live fee (ONE feeMulti).
   * Amounts stay integer strings. Locked previews act as committee-account
   * 1.2.0 with balance checks skipped (honest warn on the confirm); the
   * Sign & Send gate requires unlock + a re-review under the wallet account. */
  async function reviewOrder(P, M) {
    var ctx = M.ctx, qp = ctx.quotePrec, bp = ctx.basePrec;
    var locked = !isUnlockedNow();
    var myId = locked ? VIEWING_AS_ID : await Account.myAccountId();
    var me = await Account.resolve(myId).then(function (a) { return { id: myId, name: a.name }; });
    var quoteRaw;
    try { quoteRaw = Format.parseAmount(P.amount, qp); }
    catch (e) { throw new Error(e && e.message ? e.message : "bad amount"); }
    if (!/[1-9]/.test(quoteRaw)) throw new Error("Amount must be greater than zero.");
    var ratio;
    try { ratio = Format.parsePriceRatio(P.price); }
    catch (e) { throw new Error(e && e.message ? e.message : "bad price"); }
    if (ratio.num <= 0n) throw new Error("Price must be greater than zero.");
    var expWire = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, -5);
    var sellAssetId = P.side === "buy" ? ctx.base : ctx.quote;
    var recvAssetId = P.side === "buy" ? ctx.quote : ctx.base;
    var sellRaw = P.side === "buy" ? quoteToBaseRaw(quoteRaw, ratio.num, ratio.den, qp, bp) : quoteRaw;
    var recvRaw = P.side === "buy" ? quoteRaw : quoteToBaseRaw(quoteRaw, ratio.num, ratio.den, qp, bp);
    if (!/[1-9]/.test(sellRaw) || !/[1-9]/.test(recvRaw)) throw new Error(t("instant.price_is_too_small_for_this_amount_one_leg_ro", "Price is too small for this amount: one leg rounds to zero."));
    var bals = await Account.balances(me.id), sellBal = null, feeHave = 0n;
    bals.forEach(function (b) {
      if (b.asset_id === sellAssetId) sellBal = b;
      if (b.asset_id === FEE_ASSET) feeHave = BigInt(b.raw);
    });
    var previewWarn = null;
    if (locked) {
      previewWarn = t("instant.preview_balances_note", "Previewing as committee-account (1.2.0) — balances not checked. Unlock to validate yours before signing.");
    } else if (!sellBal || BigInt(sellBal.raw) < BigInt(sellRaw)) {
      throw new Error("Insufficient balance: have " + (sellBal ? Format.formatAmount(sellBal.raw, sellBal.precision) + " " + sellBal.symbol : "0") + ".");
    }
    var ops = [[Tx.OP.limit_order_create, {
      fee: { amount: 0, asset_id: FEE_ASSET }, seller: me.id,
      amount_to_sell: { amount: String(sellRaw), asset_id: sellAssetId },
      min_to_receive: { amount: String(recvRaw), asset_id: recvAssetId },
      expiration: expWire, fill_or_kill: false, extensions: [] }]];
    var unsigned = await Tx.buildTx(ops), feeRes = await Tx.feeMulti(unsigned.operations, FEE_ASSET);
    var dbId = await Chain.db();
    var feeRows = await Chain.call(dbId, "get_assets", [[unsigned.operations[0][1].fee.asset_id]]);
    if (!feeRows || !feeRows[0] || typeof feeRows[0].precision !== "number") throw new Error(t("instant.bad_asset_shape_for_fee_asset", "bad-asset-shape for fee asset"));
    var feeMeta = { symbol: feeRows[0].symbol, precision: feeRows[0].precision };
    var feeRaw = BigInt(feeRes.totalRaw), sameAsset = unsigned.operations[0][1].fee.asset_id === sellAssetId;
    var need = sameAsset ? BigInt(sellRaw) + feeRaw : feeRaw;
    if (!locked && (sameAsset ? BigInt(sellBal.raw) : feeHave) < need) {
      throw new Error("Insufficient " + feeMeta.symbol + " for the fee: need " + Format.formatAmount(need.toString(), feeMeta.precision) + " " + feeMeta.symbol + ".");
    }
    return {
      me: me, ratio: ratio, sellAssetId: sellAssetId, recvAssetId: recvAssetId,
      sellRaw: sellRaw, recvRaw: recvRaw, expWire: expWire,
      unsigned: unsigned, feeRaw: feeRes.totalRaw, feeMeta: feeMeta,
      previewWarn: previewWarn
    };
  }

  /* Confirm screen. Row names follow #3's op-1 table (popup.js:5724-5731),
   * same set as the desk (trade-form.js:589-622); fee human, raw in title. */
  function paintConfirm(doc, root, myGen, P, M, R) {
    if (myGen !== gen) return;
    var ctx = M.ctx;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("instant.confirm_order", "Confirm order")));
    var list = el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(el(doc, "dt", term));
      var dd = el(doc, "dd", text); if (title) dd.title = title; list.appendChild(dd); }
    var sellHuman = Format.formatAmount(R.sellRaw, R.sellAssetId === ctx.base ? ctx.basePrec : ctx.quotePrec);
    var recvHuman = Format.formatAmount(R.recvRaw, R.recvAssetId === ctx.base ? ctx.basePrec : ctx.quotePrec);
    var sellS = R.sellAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
    var recvS = R.recvAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
    row(t("instant.side_2", "Side"), (P.side === "buy" ? "Buy " : "Sell ") + ctx.quoteSym);
    row(t("instant.seller", "Seller"), R.me.name + " (" + R.me.id + ")");
    row(t("instant.price", "Price"), ratioToDec(R.ratio.num, R.ratio.den, PRICE_PLACES) + " " + ctx.baseSym + " per " + ctx.quoteSym, R.ratio.num.toString() + "/" + R.ratio.den.toString());
    row(t("instant.amount", "Amount"), (P.side === "buy" ? recvHuman : sellHuman) + " " + ctx.quoteSym);
    row(t("instant.total", "Total"), (P.side === "buy" ? sellHuman : recvHuman) + " " + ctx.baseSym);
    row(t("instant.sell_amount_to_sell", "Sell (Amount to Sell)"), sellHuman + " " + sellS, R.sellRaw);
    row(t("instant.buy_min_to_receive", "Buy (Min to Receive)"), recvHuman + " " + recvS, R.recvRaw);
    row(t("instant.fee", "Fee"), Format.formatAmount(String(R.feeRaw), R.feeMeta.precision) + " " + R.feeMeta.symbol, R.feeRaw);
    row(t("instant.expiration", "Expiration"), R.expWire + " (1 year)");
    row(t("instant.fill_or_kill", "Fill or Kill"), t("instant.no", "No"));
    row(t("instant.network", "Network"), networkName());
    wrap.appendChild(list);
    if (R.previewWarn) wrap.appendChild(el(doc, "p", R.previewWarn, "error"));
    if (!isUnlockedNow()) wrap.appendChild(el(doc, "p", t("instant.locked_preview_note", "Wallet locked — preview only. Password is asked at Sign & Send, never to view."), "muted"));
    var backBtn = touchable(el(doc, "button", t("instant.back", "Back")));
    backBtn.id = "it-back"; backBtn.type = "button"; wrap.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", t("instant.sign_send", "Sign & Send")));
    sendBtn.id = "it-send"; sendBtn.type = "button"; wrap.appendChild(sendBtn);
    backBtn.addEventListener("click", function () { if (myGen === gen) paintTrade(doc, root, myGen, P); });
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true; sendBtn.disabled = true;
      var status = showStatus(doc, wrap, t("instant.signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) { /* SIGN-TIME GATE: password asked only here — preview stays visible */
        wrap.removeChild(status);
        if (!wrap.querySelector || !wrap.querySelector(".xfer-sign-note")) {
          var note = el(doc, "p", t("instant.locked_sign_note", "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."), "muted");
          note.className = "muted xfer-sign-note"; wrap.appendChild(note);
        }
        unlockInline(doc, wrap, function () {
          wrap.appendChild(el(doc, "p", t("instant.unlocked_repreview_note", "Unlocked — press Back and review again so the order uses your account."), "muted"));
        });
        backBtn.disabled = false; sendBtn.disabled = false; return;
      }
      var before;
      Promise.resolve().then(function () { return snapshotIds(R.me.id); })
        .then(function (s) { before = s; return Tx.sign(R.unsigned, wif); })
        .then(function (signed) {
          status.textContent = t("instant.broadcasting", "Broadcasting…");
          return sendTx(signed, proveNewOrder(R.me.id, before, R.sellAssetId, R.sellRaw));
        })
        .then(function (res) {
          if (myGen !== gen) return;
          clearRoot(root);
          var done = makeWrap(doc, root);
          done.appendChild(el(doc, "h1", t("instant.order_placed", "Order placed")));
          done.appendChild(el(doc, "p", "Order " + res.found.id + " is on the book (" + ctx.quoteSym + "/" + ctx.baseSym + ")."));
          done.appendChild(el(doc, "p", "Observed at head block #" + String(res.head) + " via " + res.via + ".", "muted"));
          var again = touchable(el(doc, "button", t("instant.trade_again", "Trade again")));
          again.id = "it-again"; again.type = "button"; done.appendChild(again);
          var deskP = el(doc, "p", null, "muted"), deskA = doc.createElement("a");
          deskA.href = "#/market/" + ctx.quoteSym + "_" + ctx.baseSym;
          deskA.textContent = t("instant.open_the_full_desk", "Open the full desk");
          deskP.appendChild(deskA); done.appendChild(deskP);
          again.addEventListener("click", function () {
            if (myGen === gen) paintTrade(doc, root, myGen, { marketID: "", side: "buy", amount: "", price: "", M: null });
          });
        })
        .catch(function (e) {
          if (myGen !== gen) return;
          wrap.removeChild(status); showError(doc, wrap, e, t("instant.order_failed", "Order failed."));
          backBtn.disabled = false; sendBtn.disabled = false;
        });
    });
  }

  /* Order ids snapshot before send (diffed after). */
  async function snapshotIds(myId) {
    var rows = await Chain.call(await Chain.db(), "get_limit_orders_by_account", [myId, 100]);
    var set = {};
    (rows || []).forEach(function (o) { if (o && o.id) set[o.id] = true; });
    return set;
  }
  /* Prove-fn: first new order selling sellAssetId locking sellRaw (trade-form.js:327). */
  function proveNewOrder(myId, before, sellAssetId, sellRaw) {
    return async function () {
      var rows = await Chain.call(await Chain.db(), "get_limit_orders_by_account", [myId, 100]);
      for (var i = 0; i < (rows || []).length; i++) {
        var o = rows[i];
        if (!o || !o.id || before[o.id]) continue;
        var leg = o.sell_price && o.sell_price.base ? o.sell_price.base.asset_id : null;
        if (leg === sellAssetId && String(o.for_sale) === String(sellRaw)) return o;
      }
      return null;
    };
  }
  /* Send a signed order tx, prove via the caller poll fn (tx.js wire shape). */
  async function sendTx(signed, prove) {
    var netId = await Chain.net(), callbackId = (Math.random() * 4294967296) >>> 0;
    var via = "broadcast_transaction_with_callback";
    try { await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, signed]); }
    catch (e) { via = "broadcast_transaction"; await Chain.call(netId, "broadcast_transaction", [signed]); }
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      var found = null;
      try { found = await prove(); } catch (e) { found = null; }
      if (found) {
        var props = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
        return { found: found, head: (props && props.head_block_number) || 0, via: via };
      }
      await sleep(PROVE_INTERVAL_MS);
    }
    throw new Error("Sent (" + via + ") but the order was not observed within " + (PROVE_TIMEOUT_MS / 1000) + "s; check your orders before retrying (do NOT blindly rebroadcast).");
  }

  return { renderInstant: renderInstant };
})();

if (typeof module !== "undefined") { module.exports = InstantTradeUI; }
