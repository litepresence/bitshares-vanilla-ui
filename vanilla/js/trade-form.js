/* TradeForm: DEX buy/sell/scaled order forms + review + send (form side).
 *
 * What it owns: the `<section class="trade">` panels mounted into the market
 * desk by market-desk.js (Buy/Sell/Scaled tabs, confirm screens) up to the
 * result screen. Order math (quoteToBaseRaw/baseToQuoteRaw/scaledOrders) is
 * exact BigInt throughout. The result screen itself (paintResult) lives in
 * trade-cancel.js — both place flows call TradeCancel.paintResult (lazy
 * global, same file-load contract as the other slice-18 splits).
 * Consumes: Tx (OP 1/2 serializers, buildTx, feeMulti, sign — NEVER broadcast:
 * Tx.broadcast's inclusion poll only matches op-0 transfers, so this file sends
 * via Chain and proves inclusion with order-book reads instead), Format
 * (parseAmount/parsePriceRatio/formatAmount — the only money math entry points),
 * Wallet (isUnlocked/unlock/active WIF as a JS value, never in the DOM),
 * Account (myAccountId/resolve/balances), Chain (db/net/call), Store (network
 * label), Market (never modified; ctx comes from the desk).
 * Globals/side effects: DOM under the given mount only; global TradeForm
 * only. WIFs pass as JS values into Tx.sign — never into textContent/value.
 * Created by: building-vanilla-slices skill, slice-06-trading plan Task 2.
 * Reshaped by: slice-18 audit (trade-ui split — form side moved verbatim
 *   here; cancel boxes + paintResult live in trade-cancel.js; trade-ui.js
 *   keeps the stable TradeUI entries).
 *
 * Reference behavior: expiry presets + YEAR default <-
 * bitshares-ui/app/components/Exchange/Exchange.jsx:214-263 + :65-68;
 * create/cancel op shape <- app/actions/MarketsActions.js:566-626 (:596-612
 * create fields, :644-646 multi-op, :705+ cancel); confirm row names <-
 * wallet-extension/src/popup/popup.js:5724-5737 (Seller / Sell (Amount to
 * Sell) / Buy (Min to Receive) / Expiration / Fill or Kill; Fee Paying
 * Account / Order ID); scaled step=(upper-lower)/(N-1) <-
 * ScaledOrderTab.jsx:304-322; field order/bytes <- tx.js (op 1/2, #4 truth).
 * Price input semantics (chosen here, documented — #1 hides them in
 * MarketClasses): price P = BASE units per 1 QUOTE unit. Buy tab spends BASE
 * to buy QUOTE; Sell tab sells QUOTE for BASE. All conversions are BigInt
 * (floor); display decimals appear only at render.
 */
var TradeForm = (function () {
  "use strict";

  var FEE_ASSET = "1.3.0";
  var PROVE_TIMEOUT_MS = 30000;
  var PROVE_INTERVAL_MS = 2500;
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

  /* Expiry presets mirror #1 exactly (titles + YEAR default); durations are
   * plain ms offsets (#1 uses moment calendar adds — a 365-day YEAR is close
   * enough for an order expiry and is documented, not guessed, here). */
  var EXPIRATIONS = [
    { key: "HOUR", title: "1 hour", ms: 3600 * 1000 },
    { key: "12HOURS", title: "12 hours", ms: 12 * 3600 * 1000 },
    { key: "24HOURS", title: "24 hours", ms: 24 * 3600 * 1000 },
    { key: "7DAYS", title: "7 days", ms: 7 * 24 * 3600 * 1000 },
    { key: "MONTH", title: "30 days", ms: 30 * 24 * 3600 * 1000 },
    { key: "YEAR", title: "1 year", ms: 365 * 24 * 3600 * 1000 },
    { key: "SPECIFIC", title: "Specific" }
  ];

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

  function clearBox(box) {
    while (box.firstChild) box.removeChild(box.firstChild);
  }

  /* Promise pause between inclusion-probe polls (prove loop timing only). */
  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* 10n ** exp without Number (money-safe). */
  function pow10(exp) {
    var out = 1n, i;
    for (i = 0; i < exp; i++) out *= 10n;
    return out;
  }

  /* Inline error panel that is never blank: any thrown value maps to text. */
  function showError(doc, wrap, e, fallback) {
    var err = el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("market.err_unexpected", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) {
      msg = t("market.err_offline", "Network unavailable. Check Settings → Nodes and retry.");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("market.err_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
    return err;
  }

  /* Status line for multi-step flows (signing → broadcasting → confirming). */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted");
    p.setAttribute("aria-live", "polite");
    wrap.appendChild(p);
    return p;
  }

  /* Labeled input row with its own inline error slot. Returns refs.
   * opts.unit (dexux-ref): unit suffix label rendered in a span after the
   * input (e.g. "BTS", "BITUSD / BTS") — textContent only, never read back. */
  function fieldRow(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field");
    var label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input");
    input.type = opts.type || "text";
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    if (opts.id) input.id = opts.id;
    if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    if (opts.min !== undefined) input.setAttribute("min", opts.min);
    if (opts.max !== undefined) input.setAttribute("max", opts.max);
    touchable(input);
    var suffix = null;
    if (opts.unit) {
      var wrap = doc.createElement("span");
      wrap.className = "unit-wrap";
      wrap.appendChild(input);
      suffix = el(doc, "span", opts.unit, "unit-suffix");
      wrap.appendChild(suffix);
      label.appendChild(wrap);
    } else {
      label.appendChild(input);
    }
    row.appendChild(label);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite");
    err.style.display = "none";
    row.appendChild(err);
    return { row: row, input: input, err: err, suffix: suffix };
  }

  /* Show (or clear) the inline validation message under a field row. */
  function setFieldError(f, msg) {
    if (!msg) {
      f.err.textContent = "";
      f.err.style.display = "none";
      return;
    }
    f.err.textContent = msg;
    f.err.style.display = "";
  }

  /* Network label from Store (sole settings owner); mainnet when unreadable. */
  function networkName() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* QUOTE raw -> BASE raw at price num/den (base per quote), BigInt floor.
   * Precision shift is folded into numerator/denominator — never float. */
  function quoteToBaseRaw(quoteRaw, num, den, qp, bp) {
    if (num <= 0n || den <= 0n) throw new Error("Price must be greater than zero.");
    var n = BigInt(quoteRaw) * num;
    var d = den;
    var shift = bp - qp;
    if (shift >= 0) n = n * pow10(shift);
    else d = d * pow10(-shift);
    return (n / d).toString();
  }

  /* BASE raw -> QUOTE raw at price num/den (base per quote), BigInt floor. */
  function baseToQuoteRaw(baseRaw, num, den, qp, bp) {
    if (num <= 0n || den <= 0n) throw new Error("Price must be greater than zero.");
    var n = BigInt(baseRaw) * den;
    var d = num;
    var shift = qp - bp;
    if (shift >= 0) n = n * pow10(shift);
    else d = d * pow10(-shift);
    return (n / d).toString();
  }

  /* Exact BigInt ratio -> fixed-places decimal string (floor, for display). */
  function ratioToDec(num, den, places) {
    if (den <= 0n) throw new Error("bad price ratio");
    var v = (num * pow10(places) / den).toString();
    while (v.length <= places) v = "0" + v;
    return places === 0 ? v : v.slice(0, -places) + "." + v.slice(-places);
  }

  /* Expiry select + custom datetime (shown only for SPECIFIC, like #1). */
  function renderExpiry(doc, wrap, st) {
    var row = el(doc, "div", null, "xfer-field");
    var label = el(doc, "label", t("trade.expiration", "Expiration "));
    var sel = doc.createElement("select");
    sel.id = "trade-expiry";
    EXPIRATIONS.forEach(function (p) {
      var o = doc.createElement("option");
      o.value = p.key;
      o.textContent = p.title;
      if (p.key === (st.key || "YEAR")) o.selected = true;
      sel.appendChild(o);
    });
    touchable(sel);
    label.appendChild(sel);
    row.appendChild(label);
    var custom = doc.createElement("input");
    custom.type = "datetime-local";
    custom.id = "trade-expiry-custom";
    if (st.custom) custom.value = st.custom;
    custom.setAttribute("aria-label", t("trade.expiry_custom_label", "Custom expiration date and time"));
    touchable(custom);
    custom.style.display = (st.key === "SPECIFIC") ? "" : "none";
    row.appendChild(custom);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite");
    err.style.display = "none";
    row.appendChild(err);
    sel.addEventListener("change", function () {
      custom.style.display = (sel.value === "SPECIFIC") ? "" : "none";
      err.style.display = "none";
    });
    wrap.appendChild(row);
    return { select: sel, custom: custom, err: err };
  }

  /* Expiry state -> UTC wire string "YYYY-MM-DDTHH:MM:SS" (tx.js appends the
   * Z; timestamps, not money, so Date is allowed per plan). Custom must be at
   * least a minute in the future — a past date throws inline, never blank. */
  function expiryWire(st) {
    if (st.key !== "SPECIFIC") {
      var ms = 365 * 24 * 3600 * 1000;
      for (var i = 0; i < EXPIRATIONS.length; i++) {
        if (EXPIRATIONS[i].key === st.key && EXPIRATIONS[i].ms) ms = EXPIRATIONS[i].ms;
      }
      return new Date(Date.now() + ms).toISOString().slice(0, -5);
    }
    var t = new Date(st.custom).getTime();
    if (!isFinite(t)) throw new Error("Pick a custom expiration date and time.");
    if (t <= Date.now() + 60000) throw new Error("Custom expiration must be at least a minute in the future.");
    return new Date(t).toISOString().slice(0, -5);
  }

  /* Spendable balances as asset_id -> {raw BigInt, symbol, precision}. */
  async function balancesMap(myId) {
    var list = await Account.balances(myId);
    var map = {};
    (list || []).forEach(function (b) {
      map[b.asset_id] = { raw: BigInt(b.raw), symbol: b.symbol, precision: b.precision };
    });
    return map;
  }

  /* Fee asset display meta for human fee lines. */
  async function feeAssetMeta(feeAssetId) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_assets", [[feeAssetId]]);
    if (!rows || !rows[0] || typeof rows[0].precision !== "number") {
      throw new Error("bad-asset-shape for fee asset " + feeAssetId);
    }
    return { symbol: rows[0].symbol, precision: rows[0].precision };
  }

  /* Raw fee integer + asset meta -> human "1.23456 BTS" line (display only). */
  function humanFee(totalRaw, meta) {
    return Format.formatAmount(String(totalRaw), meta.precision) + " " + meta.symbol;
  }

  /* Head block number for result screens (observation marker, not a txid —
   * history rows carry none, same convention as transfer-ui.js). */
  async function headBlock() {
    var dbId = await Chain.db();
    var props = await Chain.call(dbId, "get_dynamic_global_properties", []);
    return (props && props.head_block_number) || 0;
  }

  /* Send a signed multi-op-capable tx, then prove it with a caller poll fn.
   * WHY not Tx.broadcast: its history poll only matches op-0 transfers; order
   * txs prove via get_limit_orders_by_account reads instead. Wire shape
   * (callback id + signedTx, plain fallback) matches tx.js broadcast. */
  async function sendTx(signed, prove) {
    var netId = await Chain.net();
    var callbackId = (Math.random() * 4294967296) >>> 0;
    var via = "broadcast_transaction_with_callback";
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, signed]);
    } catch (e) {
      via = "broadcast_transaction";
      await Chain.call(netId, "broadcast_transaction", [signed]);
    }
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      var found = null;
      try { found = await prove(); } catch (e) { found = null; }
      if (found) {
        var head = await headBlock();
        /* Slice-16 (F1d): tx-confirmed toast supplement (inline result
         * panels stay primary). Single shared point for all trade flows
         * (place/scaled/cancel/cancel-all); guarded silent to the host. */
        try {
          if (typeof NotifyHost !== "undefined" && NotifyHost &&
              typeof NotifyHost.mountToasts === "function") {
            try { NotifyHost.mountToasts(); } catch (e) { /* host best-effort */ }
          }
          if (typeof Notify !== "undefined" && Notify &&
              typeof Notify.txConfirmed === "function") {
            try { Notify.txConfirmed(head ? "head #" + String(head) : null); } catch (e) { /* silent */ }
          }
        } catch (e) { /* notify optional here */ }
        return { found: found, head: head, via: via };
      }
      await sleep(PROVE_INTERVAL_MS);
    }
    throw new Error("Sent (" + via + ") but the order was not observed within " +
      (PROVE_TIMEOUT_MS / 1000) + "s; check your orders before retrying " +
      "(do NOT blindly rebroadcast).");
  }

  /* Current order ids for an account (snapshot before send, diff after). */
  async function snapshotIds(myId) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_limit_orders_by_account", [myId, 100]);
    var set = {};
    (rows || []).forEach(function (o) { if (o && o.id) set[o.id] = true; });
    return set;
  }

  /* Prove-fn: first order that is new since `before`, sells `sellAssetId`,
   * and locks `sellRaw`. for_sale + sell leg match (identical duplicates are
   * ambiguous by nature — noted, not guessed around). */
  function proveNewOrder(myId, before, sellAssetId, sellRaw) {
    return async function () {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_limit_orders_by_account", [myId, 100]);
      for (var i = 0; i < (rows || []).length; i++) {
        var o = rows[i];
        if (!o || !o.id || before[o.id]) continue;
        var leg = o.sell_price && o.sell_price.base ? o.sell_price.base.asset_id : null;
        if (leg === sellAssetId && String(o.for_sale) === String(sellRaw)) return o;
      }
      return null;
    };
  }

  /* Zero-fee limit_order_create op entry for buildTx ([opId, opData] shape). */
  function createOp(seller, sellAssetId, sellRaw, recvAssetId, recvRaw, expWire, fok) {
    return [Tx.OP.limit_order_create, {
      fee: { amount: 0, asset_id: FEE_ASSET },
      seller: seller,
      amount_to_sell: { amount: String(sellRaw), asset_id: sellAssetId },
      min_to_receive: { amount: String(recvRaw), asset_id: recvAssetId },
      expiration: expWire,
      fill_or_kill: !!fok,
      extensions: []
    }];
  }

  /* Unlock gate with return path (same pattern as transfer/account): after a
   * successful unlock the panels render in place. */
  function renderUnlock(doc, mount, ctx) {
    clearBox(mount);
    mount.appendChild(el(doc, "p", t("trade.unlock_hint", "Unlock your wallet to trade on this market."), "muted"));
    var f = fieldRow(doc, t("trade.password_label", "Password "), { id: "trade-unlock-password", type: "password" });
    mount.appendChild(f.row);
    var btn = touchable(el(doc, "button", t("trade.unlock_button", "Unlock")));
    btn.id = "trade-unlock-do";
    btn.type = "button";
    mount.appendChild(btn);
    var errBox = el(doc, "div", null, "error");
    errBox.setAttribute("aria-live", "polite");
    mount.appendChild(errBox);
    btn.addEventListener("click", function () {
      errBox.textContent = "";
      btn.disabled = true;
      Promise.resolve()
        .then(function () { return Wallet.unlock(f.input.value); })
        .then(function () { renderPanels(doc, mount, ctx); })
        .catch(function (e) {
          btn.disabled = false;
          errBox.textContent = (e && e.message) ? e.message : String(e || t("trade.unlock_failed", "Unlock failed"));
        });
    });
  }

  /* Desk entry: renderPanels(doc, mount, ctx). Guards backends, gates on
   * unlock, resolves the wallet account, then paints the tabbed panels. */
  function renderPanels(doc, mount, ctx) {
    if (!mount) return;
    clearBox(mount);
    if (typeof Tx === "undefined" || !Tx ||
        typeof Account === "undefined" || !Account ||
        typeof Wallet === "undefined" || !Wallet ||
        typeof Format === "undefined" || !Format ||
        typeof Chain === "undefined" || !Chain) {
      showError(doc, mount, t("trade.backend_missing", "Trade backend missing: js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load."));
      return;
    }
    if (!ctx || !ctx.base || !ctx.quote) {
      showError(doc, mount, t("trade.need_assets", "Trade panels need the market assets; reload the market."));
      return;
    }
    var unlocked = false;
    try {
      unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys;
    } catch (e) { unlocked = false; }
    if (!unlocked) {
      renderUnlock(doc, mount, ctx);
      return;
    }
    mount.appendChild(el(doc, "p", t("trade.loading", "Loading trading…"), "muted"));
    Account.myAccountId().then(function (myId) {
      return Account.resolve(myId).then(function (me) {
        return { id: myId, name: me.name };
      });
    }).then(function (me) {
      paintTabs(doc, mount, {
        ctx: ctx, me: me, tab: "buy",
        buy: { amount: "", price: "", fok: false, key: "YEAR", custom: "" },
        sell: { amount: "", price: "", fok: false, key: "YEAR", custom: "" },
        scaled: { n: "3", low: "", high: "", total: "", side: "sell", key: "YEAR", custom: "" }
      });
    }).catch(function (e) {
      clearBox(mount);
      showError(doc, mount, e, t("trade.fail_account", "Could not load your account."));
    });
  }

  /* Tab bar + active panel. Input state survives tab switches and Back. */
  function paintTabs(doc, mount, P) {
    clearBox(mount);
    var ctx = P.ctx;
    mount.appendChild(el(doc, "p", "Trade " + ctx.quoteSym + " / " + ctx.baseSym, "muted"));
    var bar = el(doc, "div", null, "trade-tabs");
    [["buy", t("trade.tab_buy", "Buy")], ["sell", t("trade.tab_sell", "Sell")], ["scaled", t("trade.tab_scaled", "Scaled")]].forEach(function (d) {
      var b = touchable(el(doc, "button", d[1]));
      b.type = "button";
      b.id = "trade-tab-" + d[0];
      b.setAttribute("aria-pressed", P.tab === d[0] ? "true" : "false");
      if (P.tab === d[0]) b.setAttribute("aria-current", "true");
      b.addEventListener("click", function () {
        P.tab = d[0];
        paintTabs(doc, mount, P);
      });
      bar.appendChild(b);
    });
    mount.appendChild(bar);
    var body = doc.createElement("div");
    mount.appendChild(body);
    if (P.tab === "scaled") scaledForm(doc, body, mount, P);
    else orderForm(doc, body, mount, P, P.tab);
  }

  /* Buy/Sell single-order form. Amount is in QUOTE units; price is BASE per
   * QUOTE. Review builds the op + live fee; confirm signs and sends. */
  function orderForm(doc, body, mount, P, side) {
    var ctx = P.ctx;
    var st = P[side];
    body.appendChild(el(doc, "h3", (side === "buy" ? "Buy " : "Sell ") + ctx.quoteSym));
    var amountF = fieldRow(doc, "Amount (" + ctx.quoteSym + ") ", {
      id: "trade-amount", value: st.amount, placeholder: "0.00", inputmode: "decimal",
      unit: ctx.quoteSym
    });
    body.appendChild(amountF.row);
    var priceF = fieldRow(doc, "Price (" + ctx.baseSym + " per " + ctx.quoteSym + ") ", {
      id: "trade-price", value: st.price, placeholder: "0.00", inputmode: "decimal",
      unit: ctx.baseSym + " / " + ctx.quoteSym
    });
    body.appendChild(priceF.row);
    var fokRow = el(doc, "div", null, "xfer-field");
    var fokLabel = el(doc, "label", t("trade.fok_label", "Fill or kill "));
    var fokBox = doc.createElement("input");
    fokBox.type = "checkbox";
    fokBox.id = "trade-fok";
    fokBox.checked = !!st.fok;
    touchable(fokBox);
    fokLabel.appendChild(fokBox);
    fokRow.appendChild(fokLabel);
    fokRow.appendChild(el(doc, "span",
      t("trade.fok_hint", " (cancel unless the whole order fills at once)"), "muted"));
    body.appendChild(fokRow);
    var exp = renderExpiry(doc, body, st);
    var reviewBtn = touchable(el(doc, "button", t("trade.review", "Review order")));
    reviewBtn.id = "trade-review";
    reviewBtn.type = "button";
    body.appendChild(reviewBtn);
    reviewBtn.addEventListener("click", function () {
      setFieldError(amountF, "");
      setFieldError(priceF, "");
      exp.err.style.display = "none";
      st.amount = amountF.input.value;
      st.price = priceF.input.value;
      st.fok = fokBox.checked;
      st.key = exp.select.value;
      st.custom = exp.custom.value;
      reviewBtn.disabled = true;
      var status = showStatus(doc, body, t("trade.checking", "Checking balance and fee…"));
      reviewSingle(P, side, {
        amount: st.amount, price: st.price, fok: st.fok,
        key: st.key, custom: st.custom
      }).then(function (R) {
        paintConfirmSingle(doc, mount, P, side, R);
      }).catch(function (e) {
        var msg = (e && e.message) ? e.message : String(e || "Could not prepare the order.");
        if (msg.indexOf("bad amount") === 0 || msg.indexOf("too many decimals") === 0 ||
            msg.indexOf("Amount must be") === 0 || msg.indexOf("Insufficient") === 0) {
          setFieldError(amountF, msg);
        } else if (msg.indexOf("bad price") === 0 || msg.indexOf("Price must be") === 0) {
          setFieldError(priceF, msg);
        } else if (msg.indexOf("expiration") !== -1 || msg.indexOf("Custom expiration") === 0) {
          exp.err.textContent = msg;
          exp.err.style.display = "";
        }
        body.removeChild(status);
        reviewBtn.disabled = false;
        showError(doc, body, msg, t("trade.fail_prepare", "Could not prepare the order."));
      });
    });
  }

  /* Validate a single order, pre-check the spendable balance, build the
   * unsigned op and look the fee up live (ONE get_required_fees call via
   * feeMulti on the single op). Amounts stay integer strings; the price stays
   * a {num, den} fraction until render. */
  async function reviewSingle(P, side, vals) {
    var ctx = P.ctx;
    var qp = ctx.quotePrec, bp = ctx.basePrec;
    var quoteRaw;
    try {
      quoteRaw = Format.parseAmount(vals.amount, qp);
    } catch (e) {
      throw new Error(e && e.message ? e.message : "bad amount");
    }
    if (!/[1-9]/.test(quoteRaw)) throw new Error("Amount must be greater than zero.");
    var ratio;
    try {
      ratio = Format.parsePriceRatio(vals.price);
    } catch (e) {
      throw new Error(e && e.message ? e.message : "bad price");
    }
    if (ratio.num <= 0n) throw new Error("Price must be greater than zero.");
    var expWire = expiryWire(vals);
    var sellAssetId, recvAssetId, sellRaw, recvRaw;
    if (side === "buy") {
      sellAssetId = ctx.base;
      recvAssetId = ctx.quote;
      recvRaw = quoteRaw;
      sellRaw = quoteToBaseRaw(quoteRaw, ratio.num, ratio.den, qp, bp);
    } else {
      sellAssetId = ctx.quote;
      recvAssetId = ctx.base;
      sellRaw = quoteRaw;
      recvRaw = quoteToBaseRaw(quoteRaw, ratio.num, ratio.den, qp, bp);
    }
    if (!/[1-9]/.test(sellRaw) || !/[1-9]/.test(recvRaw)) {
      throw new Error("Price is too small for this amount: one leg rounds to zero.");
    }
    var bals = await balancesMap(P.me.id);
    var sellBal = bals[sellAssetId];
    if (!sellBal || sellBal.raw < BigInt(sellRaw)) {
      var have = sellBal
        ? Format.formatAmount(sellBal.raw.toString(), sellBal.precision) + " " + sellBal.symbol
        : "0 " + sellSym(side, ctx);
      throw new Error("Insufficient " + sellSym(side, ctx) + " balance: have " + have + ".");
    }
    var ops = [createOp(P.me.id, sellAssetId, sellRaw, recvAssetId, recvRaw, expWire, vals.fok)];
    var unsigned = await Tx.buildTx(ops);
    var feeRes = await Tx.feeMulti(unsigned.operations, FEE_ASSET);
    var feeMeta = await feeAssetMeta(unsigned.operations[0][1].fee.asset_id);
    var feeRaw = BigInt(feeRes.totalRaw);
    var feeBal = bals[unsigned.operations[0][1].fee.asset_id];
    var feeHave = feeBal ? feeBal.raw : 0n;
    var need = (unsigned.operations[0][1].fee.asset_id === sellAssetId)
      ? BigInt(sellRaw) + feeRaw : feeRaw;
    var haveBal = (unsigned.operations[0][1].fee.asset_id === sellAssetId)
      ? sellBal.raw : feeHave;
    if (haveBal < need) {
      throw new Error("Insufficient " + feeMeta.symbol + " for the fee: need " +
        humanFee(need.toString(), feeMeta) + ".");
    }
    return {
      side: side, ratio: ratio, sellAssetId: sellAssetId, recvAssetId: recvAssetId,
      sellRaw: sellRaw, recvRaw: recvRaw, expWire: expWire, fok: !!vals.fok,
      unsigned: unsigned, feeRaw: feeRes.totalRaw, feeMeta: feeMeta
    };
  }

  /* Sell-side symbol for a tab (buy spends BASE, sell spends QUOTE). */
  function sellSym(side, ctx) {
    return side === "buy" ? ctx.baseSym : ctx.quoteSym;
  }

  /* Confirm screen. Row names follow #3's op-1 table (popup.js:5724-5731):
   * Seller / Sell (Amount to Sell) / Buy (Min to Receive) / Expiration /
   * Fill or Kill, plus the plan's Side / Price / Amount / Total / Fee rows.
   * Fee shows human with the raw integer in title (balances convention). */
  function paintConfirmSingle(doc, mount, P, side, R) {
    var ctx = P.ctx;
    clearBox(mount);
    mount.appendChild(el(doc, "h3", t("trade.confirm_title", "Confirm order")));
    var list = el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(el(doc, "dt", term));
      var dd = el(doc, "dd", text);
      if (title) dd.title = title;
      list.appendChild(dd);
    }
    var sellHuman = Format.formatAmount(R.sellRaw,
      R.sellAssetId === ctx.base ? ctx.basePrec : ctx.quotePrec);
    var recvHuman = Format.formatAmount(R.recvRaw,
      R.recvAssetId === ctx.base ? ctx.basePrec : ctx.quotePrec);
    var sellS = R.sellAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
    var recvS = R.recvAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
    var priceHuman = ratioToDec(R.ratio.num, R.ratio.den, PRICE_PLACES) +
      " " + ctx.baseSym + " per " + ctx.quoteSym;
    row(t("trade.row_side", "Side"), (side === "buy" ? "Buy " : "Sell ") + ctx.quoteSym);
    row(t("trade.row_seller", "Seller"), P.me.name + " (" + P.me.id + ")");
    row(t("trade.row_price", "Price"), priceHuman, R.ratio.num.toString() + "/" + R.ratio.den.toString());
    row(t("trade.row_amount", "Amount"), (side === "buy" ? recvHuman : sellHuman) + " " + ctx.quoteSym);
    row(t("trade.row_total", "Total"), (side === "buy" ? sellHuman : recvHuman) + " " + ctx.baseSym);
    row(t("trade.row_sell", "Sell (Amount to Sell)"), sellHuman + " " + sellS, R.sellRaw);
    row(t("trade.row_buy", "Buy (Min to Receive)"), recvHuman + " " + recvS, R.recvRaw);
    row(t("trade.row_fee", "Fee"), humanFee(R.feeRaw, R.feeMeta), R.feeRaw);
    row(t("trade.row_expiration", "Expiration"), R.expWire);
    row(t("trade.row_fok", "Fill or Kill"), R.fok ? t("trade.yes", "Yes") : t("trade.no", "No"));
    row(t("trade.row_network", "Network"), networkName());
    mount.appendChild(list);
    /* The exact operation about to be signed (unsigned, no secrets).
     * Review bytes before Sign & Send. */
    var detOp = doc.createElement("details");
    detOp.className = "raw";
    var sumOp = doc.createElement("summary");
    sumOp.setAttribute("aria-label", t("trade.raw_op", "Show unsigned operation JSON"));
    detOp.appendChild(sumOp);
    var preOp = doc.createElement("pre");
    try { preOp.textContent = JSON.stringify(R.unsigned.operations, null, 2); }
    catch (e) { preOp.textContent = String(R.unsigned && R.unsigned.operations); }
    detOp.appendChild(preOp);
    mount.appendChild(detOp);
    var backBtn = touchable(el(doc, "button", t("trade.back", "Back")));
    backBtn.id = "trade-back";
    backBtn.type = "button";
    mount.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", t("trade.sign_send", "Sign & Send")));
    sendBtn.id = "trade-send";
    sendBtn.type = "button";
    mount.appendChild(sendBtn);
    backBtn.addEventListener("click", function () { paintTabs(doc, mount, P); });
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, mount, t("trade.signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) {
        mount.removeChild(status);
        showError(doc, mount, new Error("wallet-locked"), "Wallet is locked.");
        backBtn.disabled = false;
        return;
      }
      var before;
      Promise.resolve()
        .then(function () { return snapshotIds(P.me.id); })
        .then(function (s) {
          before = s;
          return Tx.sign(R.unsigned, wif);
        })
        .then(function (signed) {
          status.textContent = t("trade.s1", "Broadcasting…");
          return sendTx(signed, proveNewOrder(P.me.id, before, R.sellAssetId, R.sellRaw));
        })
        .then(function (res) {
          TradeCancel.paintResult(doc, mount, {
            title: t("trade.placed_title", "Order placed"),
            lines: [
              "Order " + res.found.id + " is on the book (" +
              pairLabel(ctx) + ").",
              "Observed at head block #" + String(res.head) + " via " + res.via + "."
            ],
            backLabel: t("trade.place_another", "Place another order"),
            onBack: function () { paintTabs(doc, mount, P); }
          });
          if (typeof P.ctx.refresh === "function") {
            try { P.ctx.refresh(); } catch (e) { /* desk refresh is best-effort */ }
          }
        })
        .catch(function (e) {
          mount.removeChild(status);
          showError(doc, mount, e, t("trade.fail_order", "Order failed."));
          backBtn.disabled = false;
          sendBtn.disabled = false;
        });
    });
  }

  /* Scaled form: N (2-20), priceLow, priceHigh, total in SELL-asset units,
   * side, expiry. Preview first (exact BigInt math), then ONE multi-op tx. */
  function scaledForm(doc, body, mount, P) {
    var ctx = P.ctx;
    var st = P.scaled;
    body.appendChild(el(doc, "h3", t("trade.scaled_title", "Scaled orders (one transaction)")));
    var sideRow = el(doc, "div", null, "xfer-field");
    var sideLabel = el(doc, "label", t("trade.side_label", "Side "));
    var sideSel = doc.createElement("select");
    [["sell", "Sell " + ctx.quoteSym + " (spend " + ctx.quoteSym + ")"],
     ["buy", "Buy " + ctx.quoteSym + " (spend " + ctx.baseSym + ")"]].forEach(function (o) {
      var opt = doc.createElement("option");
      opt.value = o[0];
      opt.textContent = o[1];
      if (o[0] === st.side) opt.selected = true;
      sideSel.appendChild(opt);
    });
    touchable(sideSel);
    sideLabel.appendChild(sideSel);
    sideRow.appendChild(sideLabel);
    body.appendChild(sideRow);
    var nF = fieldRow(doc, t("trade.count_label", "Order count (2-20) "), {
      id: "trade-n", value: st.n, placeholder: "3", inputmode: "numeric"
    });
    body.appendChild(nF.row);
    var priceUnit = ctx.baseSym + " / " + ctx.quoteSym;
    var lowF = fieldRow(doc, "Price low (" + ctx.baseSym + " per " + ctx.quoteSym + ") ", {
      id: "trade-low", value: st.low, placeholder: "0.00", inputmode: "decimal",
      unit: priceUnit
    });
    body.appendChild(lowF.row);
    var highF = fieldRow(doc, "Price high (" + ctx.baseSym + " per " + ctx.quoteSym + ") ", {
      id: "trade-high", value: st.high, placeholder: "0.00", inputmode: "decimal",
      unit: priceUnit
    });
    body.appendChild(highF.row);
    var sellS = st.side === "buy" ? ctx.baseSym : ctx.quoteSym;
    var totalF = fieldRow(doc, "Total to sell (" + sellS + ") ", {
      id: "trade-total", value: st.total, placeholder: "0.00", inputmode: "decimal",
      unit: sellS
    });
    body.appendChild(totalF.row);
    sideSel.addEventListener("change", function () {
      st.side = sideSel.value;
      paintTabs(doc, mount, P);
    });
    var exp = renderExpiry(doc, body, st);
    var prevBtn = touchable(el(doc, "button", t("trade.preview", "Preview scaled orders")));
    prevBtn.id = "trade-preview";
    prevBtn.type = "button";
    body.appendChild(prevBtn);
    prevBtn.addEventListener("click", function () {
      [nF, lowF, highF, totalF].forEach(function (f) { setFieldError(f, ""); });
      exp.err.style.display = "none";
      st.n = nF.input.value;
      st.low = lowF.input.value;
      st.high = highF.input.value;
      st.total = totalF.input.value;
      st.key = exp.select.value;
      st.custom = exp.custom.value;
      prevBtn.disabled = true;
      var status = showStatus(doc, body, t("trade.checking", "Checking balance and fee…"));
      reviewScaled(P, {
        n: st.n, low: st.low, high: st.high, total: st.total,
        side: st.side, key: st.key, custom: st.custom
      }).then(function (R) {
        paintConfirmScaled(doc, mount, P, R);
      }).catch(function (e) {
        var msg = (e && e.message) ? e.message : String(e || "Could not prepare scaled orders.");
        if (msg.indexOf("Order count") === 0) setFieldError(nF, msg);
        else if (msg.indexOf("bad price") === 0 || msg.indexOf("Price") === 0) {
          setFieldError(lowF, msg);
          setFieldError(highF, msg);
        } else if (msg.indexOf("bad amount") === 0 || msg.indexOf("too many decimals") === 0 ||
                   msg.indexOf("Total must be") === 0 || msg.indexOf("Insufficient") === 0) {
          setFieldError(totalF, msg);
        } else if (msg.indexOf("expiration") !== -1 || msg.indexOf("Custom expiration") === 0) {
          exp.err.textContent = msg;
          exp.err.style.display = "";
        }
        body.removeChild(status);
        prevBtn.disabled = false;
        showError(doc, body, msg, t("trade.fail_scaled_prepare", "Could not prepare scaled orders."));
      });
    });
  }

  /* Pure order math for the scaled preview: exact BigInt throughout.
   * Prices: common denominator D, step=(highD-lowD)/(N-1) floored, LAST price
   * pinned to highD exactly. Amounts: total/N floored per order, integer
   * remainder on the LAST order (sum == total exactly, no dust loss). */
  function scaledOrders(P, spec) {
    var ctx = P.ctx;
    var n = Number(String(spec.n).trim());
    if (!/^\d+$/.test(String(spec.n).trim()) || n < 2 || n > 20) {
      throw new Error("Order count must be a whole number from 2 to 20.");
    }
    var lowR, highR;
    try {
      lowR = Format.parsePriceRatio(spec.low);
      highR = Format.parsePriceRatio(spec.high);
    } catch (e) {
      throw new Error(e && e.message ? e.message : "bad price");
    }
    if (lowR.num <= 0n || highR.num <= 0n) throw new Error("Prices must be greater than zero.");
    var D = lowR.den * highR.den;
    var lowD = lowR.num * highR.den;
    var highD = highR.num * lowR.den;
    if (highD <= lowD) throw new Error("Price high must be above price low.");
    var sellAssetId = spec.side === "buy" ? ctx.base : ctx.quote;
    var recvAssetId = spec.side === "buy" ? ctx.quote : ctx.base;
    var sellPrec = spec.side === "buy" ? ctx.basePrec : ctx.quotePrec;
    var totalRaw;
    try {
      totalRaw = Format.parseAmount(spec.total, sellPrec);
    } catch (e) {
      throw new Error(e && e.message ? e.message : "bad amount");
    }
    if (!/[1-9]/.test(totalRaw)) throw new Error("Total must be greater than zero.");
    var total = BigInt(totalRaw);
    var per = total / BigInt(n);
    if (per <= 0n) throw new Error("Total is too small to split into " + n + " orders.");
    var stepNum = (highD - lowD) / BigInt(n - 1);
    var orders = [];
    for (var i = 0; i < n; i++) {
      var priceNum = (i === n - 1) ? highD : lowD + stepNum * BigInt(i);
      var sellRaw = (i === n - 1)
        ? (total - per * BigInt(n - 1)).toString()
        : per.toString();
      var recvRaw = spec.side === "buy"
        ? baseToQuoteRaw(sellRaw, priceNum, D, ctx.quotePrec, ctx.basePrec)
        : quoteToBaseRaw(sellRaw, priceNum, D, ctx.quotePrec, ctx.basePrec);
      if (!/[1-9]/.test(recvRaw)) {
        throw new Error("Order " + (i + 1) + " receives zero at its price; raise the total.");
      }
      orders.push({ priceNum: priceNum, priceDen: D, sellRaw: sellRaw, recvRaw: recvRaw });
    }
    return { orders: orders, sellAssetId: sellAssetId, recvAssetId: recvAssetId };
  }

  /* Scaled review: preview math + balance pre-check + ONE buildTx + ONE
   * feeMulti over all N ops (per-op fees summed + displayed). */
  async function reviewScaled(P, spec) {
    var calc = scaledOrders(P, spec);
    var ctx = P.ctx;
    var expWire = expiryWire(spec);
    var bals = await balancesMap(P.me.id);
    var sellBal = bals[calc.sellAssetId];
    var totalRaw = calc.orders.reduce(function (acc, o) { return acc + BigInt(o.sellRaw); }, 0n);
    if (!sellBal || sellBal.raw < totalRaw) {
      var s = calc.sellAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
      throw new Error("Insufficient " + s + " balance for the scaled total.");
    }
    var ops = calc.orders.map(function (o) {
      return createOp(P.me.id, calc.sellAssetId, o.sellRaw,
        calc.recvAssetId, o.recvRaw, expWire, false);
    });
    var unsigned = await Tx.buildTx(ops);
    var feeRes = await Tx.feeMulti(unsigned.operations, FEE_ASSET);
    var feeMeta = await feeAssetMeta(unsigned.operations[0][1].fee.asset_id);
    return {
      calc: calc, expWire: expWire, unsigned: unsigned,
      feeRaw: feeRes.totalRaw, feeMeta: feeMeta
    };
  }

  /* Scaled confirm: preview table (per-order price/amount, remainder note on
   * the last row) + summed fee; ONE multi-op tx on Sign & Send. */
  function paintConfirmScaled(doc, mount, P, R) {
    var ctx = P.ctx;
    clearBox(mount);
    mount.appendChild(el(doc, "h3", "Confirm " + R.calc.orders.length + " scaled orders"));
    var table = doc.createElement("table");
    table.className = "node-table";
    var hr = doc.createElement("tr");
    ["#", t("trade.row_price", "Price"), t("trade.col_sell", "Sell"), t("trade.col_receive", "Receive")].forEach(function (h) {
      hr.appendChild(el(doc, "th", h));
    });
    var thead = doc.createElement("thead");
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    var sellS = R.calc.sellAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
    var recvS = R.calc.recvAssetId === ctx.base ? ctx.baseSym : ctx.quoteSym;
    var sellP = R.calc.sellAssetId === ctx.base ? ctx.basePrec : ctx.quotePrec;
    var recvP = R.calc.recvAssetId === ctx.base ? ctx.basePrec : ctx.quotePrec;
    R.calc.orders.forEach(function (o, i) {
      var tr = doc.createElement("tr");
      tr.appendChild(el(doc, "td", String(i + 1)));
      tr.appendChild(el(doc, "td", ratioToDec(o.priceNum, o.priceDen, PRICE_PLACES)));
      tr.appendChild(el(doc, "td",
        Format.formatAmount(o.sellRaw, sellP) + " " + sellS,
        "raw " + o.sellRaw));
      var recvCell = Format.formatAmount(o.recvRaw, recvP) + " " + recvS;
      if (i === R.calc.orders.length - 1) recvCell += " (includes remainder)";
      tr.appendChild(el(doc, "td", recvCell, "raw " + o.recvRaw));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    mount.appendChild(table);
    var list = el(doc, "dl", null, "xfer-confirm");
    function confirmRow(term, text, title) {
      list.appendChild(el(doc, "dt", term));
      var dd = el(doc, "dd", text);
      if (title) dd.title = title;
      list.appendChild(dd);
    }
    confirmRow(t("trade.row_seller", "Seller"), P.me.name + " (" + P.me.id + ")");
    confirmRow("Fee (total, " + R.calc.orders.length + " ops)", humanFee(R.feeRaw, R.feeMeta), R.feeRaw);
    confirmRow(t("trade.row_expiration", "Expiration"), R.expWire);
    confirmRow(t("trade.row_network", "Network"), networkName());
    mount.appendChild(list);
    /* All N operations about to be signed (unsigned, no secrets). */
    var detOps = doc.createElement("details");
    detOps.className = "raw";
    var sumOps = doc.createElement("summary");
    sumOps.setAttribute("aria-label", t("trade.raw_ops", "Show unsigned operations JSON"));
    detOps.appendChild(sumOps);
    var preOps = doc.createElement("pre");
    try { preOps.textContent = JSON.stringify(R.unsigned.operations, null, 2); }
    catch (e) { preOps.textContent = String(R.unsigned && R.unsigned.operations); }
    detOps.appendChild(preOps);
    mount.appendChild(detOps);
    var backBtn = touchable(el(doc, "button", t("trade.back", "Back")));
    backBtn.id = "trade-back";
    backBtn.type = "button";
    mount.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", "Sign & Send (" + R.calc.orders.length + " orders)"));
    sendBtn.id = "trade-send";
    sendBtn.type = "button";
    mount.appendChild(sendBtn);
    backBtn.addEventListener("click", function () { paintTabs(doc, mount, P); });
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, mount, t("trade.signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) {
        mount.removeChild(status);
        showError(doc, mount, new Error("wallet-locked"), "Wallet is locked.");
        backBtn.disabled = false;
        return;
      }
      var before;
      Promise.resolve()
        .then(function () { return snapshotIds(P.me.id); })
        .then(function (s) {
          before = s;
          return Tx.sign(R.unsigned, wif);
        })
        .then(function (signed) {
          status.textContent = t("trade.s1", "Broadcasting…");
          return sendTx(signed, async function () {
            var dbId = await Chain.db();
            var rows = await Chain.call(dbId, "get_limit_orders_by_account", [P.me.id, 100]);
            var found = 0;
            for (var i = 0; i < (rows || []).length; i++) {
              if (rows[i] && rows[i].id && !before[rows[i].id]) found++;
            }
            return found >= R.calc.orders.length ? { count: found } : null;
          });
        })
        .then(function (res) {
          TradeCancel.paintResult(doc, mount, {
            title: R.calc.orders.length + " scaled orders placed",
            lines: [
              res.found.count + " new orders on the book (" + pairLabel(ctx) + ").",
              "Observed at head block #" + String(res.head) + " via " + res.via + "."
            ],
            backLabel: t("trade.place_more", "Place more orders"),
            onBack: function () { paintTabs(doc, mount, P); }
          });
          if (typeof P.ctx.refresh === "function") {
            try { P.ctx.refresh(); } catch (e) { /* best-effort */ }
          }
        })
        .catch(function (e) {
          mount.removeChild(status);
          showError(doc, mount, e, t("trade.fail_scaled", "Scaled orders failed."));
          backBtn.disabled = false;
          sendBtn.disabled = false;
        });
    });
  }

  /* QUOTE/BASE pair label for result lines (desk ctx symbols, verbatim). */
  function pairLabel(ctx) {
    return ctx.quoteSym + "/" + ctx.baseSym;
  }

  return {
    renderPanels: renderPanels
  };
})();

if (typeof module !== "undefined") { module.exports = TradeForm; }
