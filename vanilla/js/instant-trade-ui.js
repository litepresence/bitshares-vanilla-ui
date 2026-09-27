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
 * Created by: stub-queue build (matrix §A row A31).
 */
var InstantTradeUI = (function () {
  "use strict";
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
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (msg.indexOf("not connected") !== -1) msg = "Network unavailable. Check Settings → Nodes and retry.";
    else if (msg.indexOf("wallet-locked") !== -1) msg = "Wallet is locked.";
    else if (msg.indexOf("no-account") !== -1) msg = "No on-chain account found for the wallet's active key.";
    else if (msg.indexOf("unknown-account") !== -1) msg = "Unknown market asset.";
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  /* Status line for multi-step flows (loading → review → broadcast). */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite");
    wrap.appendChild(p); return p; }
  /* Labeled input row with its own inline error slot. */
  function fieldRow(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input"); input.type = opts.type || "text";
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    if (opts.id) input.id = opts.id;
    if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    touchable(input); label.appendChild(input); row.appendChild(label);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite"); err.style.display = "none"; row.appendChild(err);
    return { row: row, input: input, err: err }; }
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : "none"; }
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
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  /* Route entry. Gates backends, waits for the shared socket (transfer-ui.js
   * connect-wait pattern), unlock-gates, then paints the single-screen form. */
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
      showError(doc, wrap, "Trade backend missing: js/tx.js, js/market.js, js/account.js, js/wallet.js or js/format.js failed to load.");
      return;
    }
    if (typeof Chain !== "undefined" && Chain && Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "h1", "Instant Trade"));
      wrap.appendChild(el(doc, "p", "Connecting to network…", "muted"));
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
        showError(doc, makeWrap(doc, root), new Error("not connected"), "Network unavailable.");
      }, 15000);
      return;
    }
    if (typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked()) {
      clearRoot(root);
      var w0 = makeWrap(doc, root);
      w0.appendChild(el(doc, "h1", "Instant Trade"));
      w0.appendChild(el(doc, "p", "Unlock your wallet to trade.", "muted"));
      var f = fieldRow(doc, "Password ", { id: "it-unlock-password", type: "password" });
      w0.appendChild(f.row);
      var btn = touchable(el(doc, "button", "Unlock"));
      btn.id = "it-unlock-do"; btn.type = "button"; w0.appendChild(btn);
      var errBox = el(doc, "div", null, "error");
      errBox.setAttribute("aria-live", "polite"); w0.appendChild(errBox);
      btn.addEventListener("click", function () {
        errBox.textContent = ""; btn.disabled = true;
        Promise.resolve().then(function () { return Wallet.unlock(f.input.value); })
          .then(function () { if (myGen === gen) renderInstant(root, marketID); })
          .catch(function (e) {
            if (myGen !== gen) return;
            btn.disabled = false;
            errBox.textContent = (e && e.message) ? e.message : String(e || "Unlock failed");
          });
      });
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
    wrap.appendChild(el(doc, "h1", "Instant Trade"));
    wrap.appendChild(el(doc, "p", "Pick a market, choose a side, enter an amount. The price fills from the order book; review and sign one limit order.", "muted"));
    var mktF = fieldRow(doc, "Market (QUOTE_BASE) ", { id: "it-market", value: P.marketID, placeholder: "BTS_CNY", inputmode: "text" });
    wrap.appendChild(mktF.row);
    var sideRow = el(doc, "div", null, "xfer-field"), sideLabel = el(doc, "label", "Side ");
    var sideSel = doc.createElement("select");
    [["buy", "Buy QUOTE (spend BASE)"], ["sell", "Sell QUOTE (receive BASE)"]].forEach(function (o) {
      var opt = doc.createElement("option"); opt.value = o[0]; opt.textContent = o[1];
      if (o[0] === P.side) opt.selected = true;
      sideSel.appendChild(opt);
    });
    touchable(sideSel); sideLabel.appendChild(sideSel); sideRow.appendChild(sideLabel);
    wrap.appendChild(sideRow);
    var loadBtn = touchable(el(doc, "button", "Load market"));
    loadBtn.id = "it-load"; loadBtn.type = "button"; wrap.appendChild(loadBtn);
    var out = el(doc, "div"); wrap.appendChild(out);
    function load() {
      setFieldError(mktF, ""); out.innerHTML = "";
      P.marketID = mktF.input.value.trim(); P.side = sideSel.value;
      if (!P.marketID) { setFieldError(mktF, "Enter a market like BTS_CNY."); return; }
      loadBtn.disabled = true;
      var status = showStatus(doc, out, "Loading market…");
      loadMarket(P.marketID).then(function (M) {
        if (myGen !== gen) return;
        P.M = M; paintLoaded(doc, root, myGen, P);
      }).catch(function (e) {
        if (myGen !== gen) return;
        out.removeChild(status); loadBtn.disabled = false;
        var msg = (e && e.message) ? e.message : String(e || "Could not load the market.");
        if (msg === "bad-market") msg = "Market must look like QUOTE_BASE (e.g. BTS_CNY).";
        setFieldError(mktF, msg); showError(doc, out, msg, "Could not load the market.");
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
    box.appendChild(el(doc, "p", "Trade " + ctx.quoteSym + " / " + ctx.baseSym + " — " + (P.side === "buy" ? "Buy " + ctx.quoteSym : "Sell " + ctx.quoteSym), "muted"));
    box.appendChild(el(doc, "p", "Latest: " + (M.stats && M.stats.latest ? M.stats.latest : "—") + " · Best bid: " + (M.bestBid || "—") + " · Best ask: " + (M.bestAsk || "—"), "muted"));
    if (!M.bestBid && !M.bestAsk) box.appendChild(el(doc, "p", "The order book is empty — type a price manually.", "muted"));
    if (!P.price) P.price = P.side === "buy" ? (M.bestAsk || "") : (M.bestBid || "");
    var amountF = fieldRow(doc, "Amount (" + ctx.quoteSym + ") ", { id: "it-amount", value: P.amount, placeholder: "0.00", inputmode: "decimal" });
    box.appendChild(amountF.row);
    var priceF = fieldRow(doc, "Price (" + ctx.baseSym + " per " + ctx.quoteSym + ") ", { id: "it-price", value: P.price, placeholder: "0.00", inputmode: "decimal" });
    box.appendChild(priceF.row);
    var reviewBtn = touchable(el(doc, "button", "Review order"));
    reviewBtn.id = "it-review"; reviewBtn.type = "button"; box.appendChild(reviewBtn);
    reviewBtn.addEventListener("click", function () {
      setFieldError(amountF, ""); setFieldError(priceF, "");
      P.amount = amountF.input.value; P.price = priceF.input.value;
      reviewBtn.disabled = true;
      var status = showStatus(doc, box, "Checking balance and fee…");
      reviewOrder(P, M).then(function (R) { if (myGen === gen) paintConfirm(doc, root, myGen, P, M, R); })
        .catch(function (e) {
          if (myGen !== gen) return;
          var msg = (e && e.message) ? e.message : String(e || "Could not prepare the order.");
          if (msg.indexOf("bad amount") === 0 || msg.indexOf("too many decimals") === 0 || msg.indexOf("Amount must be") === 0 || msg.indexOf("Insufficient") === 0) setFieldError(amountF, msg);
          else if (msg.indexOf("bad price") === 0 || msg.indexOf("Price must be") === 0) setFieldError(priceF, msg);
          box.removeChild(status); reviewBtn.disabled = false;
          showError(doc, box, msg, "Could not prepare the order.");
        });
    });
  }

  /* Validate, balance-check, build unsigned op-1, live fee (ONE feeMulti).
   * Amounts stay integer strings. */
  async function reviewOrder(P, M) {
    var ctx = M.ctx, qp = ctx.quotePrec, bp = ctx.basePrec;
    var myId = await Account.myAccountId();
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
    if (!/[1-9]/.test(sellRaw) || !/[1-9]/.test(recvRaw)) throw new Error("Price is too small for this amount: one leg rounds to zero.");
    var bals = await Account.balances(me.id), sellBal = null, feeHave = 0n;
    bals.forEach(function (b) {
      if (b.asset_id === sellAssetId) sellBal = b;
      if (b.asset_id === FEE_ASSET) feeHave = BigInt(b.raw);
    });
    if (!sellBal || BigInt(sellBal.raw) < BigInt(sellRaw)) {
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
    if (!feeRows || !feeRows[0] || typeof feeRows[0].precision !== "number") throw new Error("bad-asset-shape for fee asset");
    var feeMeta = { symbol: feeRows[0].symbol, precision: feeRows[0].precision };
    var feeRaw = BigInt(feeRes.totalRaw), sameAsset = unsigned.operations[0][1].fee.asset_id === sellAssetId;
    var need = sameAsset ? BigInt(sellRaw) + feeRaw : feeRaw;
    if ((sameAsset ? BigInt(sellBal.raw) : feeHave) < need) {
      throw new Error("Insufficient " + feeMeta.symbol + " for the fee: need " + Format.formatAmount(need.toString(), feeMeta.precision) + " " + feeMeta.symbol + ".");
    }
    return {
      me: me, ratio: ratio, sellAssetId: sellAssetId, recvAssetId: recvAssetId,
      sellRaw: sellRaw, recvRaw: recvRaw, expWire: expWire,
      unsigned: unsigned, feeRaw: feeRes.totalRaw, feeMeta: feeMeta
    };
  }

  /* Confirm screen. Row names follow #3's op-1 table (popup.js:5724-5731),
   * same set as the desk (trade-form.js:589-622); fee human, raw in title. */
  function paintConfirm(doc, root, myGen, P, M, R) {
    if (myGen !== gen) return;
    var ctx = M.ctx;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", "Confirm order"));
    var list = el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(el(doc, "dt", term));
      var dd = el(doc, "dd", text); if (title) dd.title = title; list.appendChild(dd); }
    var sellHuman = Format.formatAmount(R.sellRaw, R.sellAssetId === ctx.base ? ctx.basePrec : ctx.quotePrec);
    var recvHuman = Format.formatAmount(R.recvRaw, R.recvAssetId === ctx.base ? ctx.basePrec : ctx.quotePrec);
    var sellS = R.sellAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
    var recvS = R.recvAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
    row("Side", (P.side === "buy" ? "Buy " : "Sell ") + ctx.quoteSym);
    row("Seller", R.me.name + " (" + R.me.id + ")");
    row("Price", ratioToDec(R.ratio.num, R.ratio.den, PRICE_PLACES) + " " + ctx.baseSym + " per " + ctx.quoteSym, R.ratio.num.toString() + "/" + R.ratio.den.toString());
    row("Amount", (P.side === "buy" ? recvHuman : sellHuman) + " " + ctx.quoteSym);
    row("Total", (P.side === "buy" ? sellHuman : recvHuman) + " " + ctx.baseSym);
    row("Sell (Amount to Sell)", sellHuman + " " + sellS, R.sellRaw);
    row("Buy (Min to Receive)", recvHuman + " " + recvS, R.recvRaw);
    row("Fee", Format.formatAmount(String(R.feeRaw), R.feeMeta.precision) + " " + R.feeMeta.symbol, R.feeRaw);
    row("Expiration", R.expWire + " (1 year)");
    row("Fill or Kill", "No");
    row("Network", networkName());
    wrap.appendChild(list);
    var backBtn = touchable(el(doc, "button", "Back"));
    backBtn.id = "it-back"; backBtn.type = "button"; wrap.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", "Sign & Send"));
    sendBtn.id = "it-send"; sendBtn.type = "button"; wrap.appendChild(sendBtn);
    backBtn.addEventListener("click", function () { if (myGen === gen) paintTrade(doc, root, myGen, P); });
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true; sendBtn.disabled = true;
      var status = showStatus(doc, wrap, "Signing…");
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) {
        wrap.removeChild(status); showError(doc, wrap, new Error("wallet-locked"), "Wallet is locked.");
        backBtn.disabled = false; return;
      }
      var before;
      Promise.resolve().then(function () { return snapshotIds(R.me.id); })
        .then(function (s) { before = s; return Tx.sign(R.unsigned, wif); })
        .then(function (signed) {
          status.textContent = "Broadcasting…";
          return sendTx(signed, proveNewOrder(R.me.id, before, R.sellAssetId, R.sellRaw));
        })
        .then(function (res) {
          if (myGen !== gen) return;
          clearRoot(root);
          var done = makeWrap(doc, root);
          done.appendChild(el(doc, "h1", "Order placed"));
          done.appendChild(el(doc, "p", "Order " + res.found.id + " is on the book (" + ctx.quoteSym + "/" + ctx.baseSym + ")."));
          done.appendChild(el(doc, "p", "Observed at head block #" + String(res.head) + " via " + res.via + ".", "muted"));
          var again = touchable(el(doc, "button", "Trade again"));
          again.id = "it-again"; again.type = "button"; done.appendChild(again);
          var deskP = el(doc, "p", null, "muted"), deskA = doc.createElement("a");
          deskA.href = "#/market/" + ctx.quoteSym + "_" + ctx.baseSym;
          deskA.textContent = "Open the full desk";
          deskP.appendChild(deskA); done.appendChild(deskP);
          again.addEventListener("click", function () {
            if (myGen === gen) paintTrade(doc, root, myGen, { marketID: "", side: "buy", amount: "", price: "", M: null });
          });
        })
        .catch(function (e) {
          if (myGen !== gen) return;
          wrap.removeChild(status); showError(doc, wrap, e, "Order failed.");
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
