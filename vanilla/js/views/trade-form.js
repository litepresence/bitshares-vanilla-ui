/* TradeForm: DEX buy/sell/scaled order forms + review + send (form side).
 *
 * What it owns: the Buy + Sell side-by-side panels mounted into the market
 * desk by market-desk.js (retro 2x3 row 1: Buy QUOTE | Sell QUOTE, each its
 * own grid cell rendering orderForm directly; the buy panel owns a
 * Buy/Scaled tab row reusing the .trade-tabs skin — Scaled swaps scaledForm
 * into the buy panel in place of the single form, Buy swaps back) plus the
 * confirm screens, up to the result screen. Both panels stay visible at
 * once, so every element id carries its side (trade-price-buy vs
 * trade-price-sell); P holds per-side input state (buy/sell/scaled +
 * scaledOpen) plus both mounts, and tab switches scrape the live DOM first
 * so typed values survive redraws. Order math (quoteToBaseRaw/
 * baseToQuoteRaw/scaledOrders) is exact BigInt throughout. The result screen itself (paintResult) lives in
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
   * the default when i18n.js failed to load: never blank, never throws.
   * vars (optional) fills %(name)s placeholders per the I18n contract. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof vars === "object") {
      try {
        return String(dflt).replace(/%\(([^)]+)\)s/g, function (m, name) {
          return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
        });
      } catch (e) { /* default below */ }
    }
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

  /* No local el — use DOM.el */

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
/* clearBox removed — use DOM.clear */

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
    var err = null; /* created via DOM.error below */
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
    err = DOM.error(wrap, msg);
    return err;
  }

  /* Status line for multi-step flows (signing → broadcasting → confirming). */
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text); return p;
  }

  /* Inline error slots live on each Forms-built field object as .err
   * (created at the call site right after Forms.labeledInput/labeledSelect,
   * same div.error + aria-live + display:none contract as the old fieldRow).
   * Unit-suffix rows (dexux-ref, opts.unit before): the input is reparented
   * into a span.unit-wrap with a textContent-only suffix span after
   * Forms.labeledInput nests it — textContent only, never read back. */

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

  /* Expiry select + custom datetime (shown only for SPECIFIC, like #1).
   * side namespaces the ids: both panels live at once (trade-expiry-buy vs
   * trade-expiry-sell). */
  function renderExpiry(doc, wrap, st, side) {
    var expF = Forms.labeledSelect(doc, t("trade.expiration", "Expiration "),
      EXPIRATIONS.map(function (p) { return [p.key, p.title]; }), st.key || "YEAR");
    var row = expF.row;
    var sel = expF.select;
    sel.id = "trade-expiry-" + side;
    var custom = doc.createElement("input");
    custom.type = "datetime-local";
    custom.id = "trade-expiry-custom-" + side;
    if (st.custom) custom.value = st.custom;
    custom.setAttribute("aria-label", t("trade.expiry_custom_label", "Custom expiration date and time"));
    touchable(custom);
    custom.style.display = (st.key === "SPECIFIC") ? "" : "none";
    row.appendChild(custom);
    var err = DOM.el(doc, "div", "", "error");
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

  /* Market-fee math (display-only, BigInt — never float for money).
   * Reference: bitshares-ui/app/components/Exchange/BuySell.jsx:227-260:
   *   fee = min(max_market_fee, amount * market_fee_percent / 10000),
   *   percent label = market_fee_percent / 100 + "%" (:243-246).
   * Only the RECEIVE leg carries a row (Buy shows the quote leg, Sell the
   * base leg — BuySell.jsx:495-502 isBid mapping; in this file's terms both
   * sides' receive leg is already recvRaw/recvAssetId). Charge flag bit:
   * asset_constants.js:3 charge_market_fee 0x01. Every helper here is
   * fail-silent (null, never throws) so an unreadable asset skips the row
   * instead of blanking or breaking the form. */

  /* marketPctLabel: hundredths int -> "X%" display (BuySell :243-246 shape:
   * pct/100 + "%", so 8 -> "0.08%", 200 -> "2%"). Params: pct number.
   * Returns string. Never throws (non-numbers yield "0%"). */
  function marketPctLabel(pct) {
    var p = Number(pct);
    if (!isFinite(p) || p < 0) p = 0;
    p = Math.floor(p);
    var whole = Math.floor(p / 100), rest = p % 100;
    if (rest === 0) return whole + "%";
    var frac = rest < 10 ? "0" + rest : String(rest);
    if (frac.charAt(frac.length - 1) === "0") frac = frac.charAt(0);
    return whole + "." + frac + "%";
  }

  /* marketFeeRaw: min(maxRaw, amountRaw * pct / 10000) in integer strings.
   * Params: amountRaw (int string), pct (hundredths int), maxRaw (int
   * string). Returns fee raw string, or null on bad input. Never throws. */
  function marketFeeRaw(amountRaw, pct, maxRaw) {
    try {
      if (typeof amountRaw !== "string" || !/^\d+$/.test(amountRaw)) return null;
      var p = Number(pct);
      if (!isFinite(p) || p <= 0) return "0";
      if (typeof maxRaw !== "string" || !/^\d+$/.test(maxRaw)) return null;
      var fee = (BigInt(amountRaw) * BigInt(Math.floor(p))) / 10000n;
      var max = BigInt(maxRaw);
      if (fee > max) fee = max;
      return fee.toString();
    } catch (e) { return null; }
  }

  /* fetchMarketFeeOpts: asset options for the market-fee row. Params:
   * assetId ("1.3.x"). Returns {pct, symbol, precision, maxRaw} when the
   * asset charges a market fee ((flags & 0x01) per asset_constants.js:3),
   * else null (flag off OR unreadable — both skip silently). Never throws. */
  async function fetchMarketFeeOpts(assetId) {
    try {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_assets", [[assetId]]);
      var a = rows && rows[0];
      if (!a || !a.options || typeof a.precision !== "number" || !a.symbol) return null;
      var flags = Number(a.options.flags || 0);
      if (!(flags & 1)) return null;
      var pct = Math.floor(Number(a.options.market_fee_percent || 0));
      var maxRaw = (a.options.max_market_fee !== undefined && a.options.max_market_fee !== null)
        ? String(a.options.max_market_fee) : null;
      if (maxRaw === null || !/^\d+$/.test(maxRaw)) return null;
      return { pct: pct, symbol: a.symbol, precision: a.precision, maxRaw: maxRaw };
    } catch (e) { return null; }
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

  /* --- Locked quote panels (try-before-you-buy, principle #9) -----------
   * Reference: bitshares-ui/app/components/Exchange/BuySell.jsx:518
   * (`disabled = noBalance || invalidPrice || invalidAmount` — only SUBMIT
   * gates; inputs/fee/total always live) + Exchange.jsx:2089-2210 (forms
   * render unconditionally; balance reads 0 logged out).
   * The helpers below let a LOCKED wallet see the same Buy/Sell/Scaled tabs
   * with live quotes. The password is asked ONLY at the review button
   * ("Unlock & review"), never to view the panels.
   *
   * QUOTE_PLACEHOLDER_SELLER: fee preview seller for locked quotes.
   * limit_order_create fees are account-invariant (flat fee schedule per op
   * type, answered by get_required_fees from the op shape + fee asset — the
   * seller id never changes the price; any valid 1.2.x id answers the same.
   * committee-account 1.2.0 always exists, so it is the honest placeholder).
   * Displayed fees go through Format (human string) with the raw integer in
   * the title attribute — never a raw integer as the visible text (#6). */
  var QUOTE_PLACEHOLDER_SELLER = "1.2.0";

  /* True when this tab state has no resolved wallet account (locked view).
   * Params: P tab state ({me} or null). Returns boolean. Never throws. */
  function isLockedView(P) {
    return !P || !P.me || !P.me.id;
  }

  /* Expiry wire string for fee previews: the selected expiry when valid,
   * otherwise the YEAR default. Previews must never throw on an empty
   * SPECIFIC custom date — the review path still validates strictly. */
  function previewExpiryWire(st) {
    try {
      return expiryWire(st);
    } catch (e) {
      return expiryWire({ key: "YEAR", custom: "" });
    }
  }

  /* Live three-way quote wiring: amount (QUOTE) <-> price (BASE per QUOTE)
   * <-> total (BASE), all in pure BigInt via Format.parseAmount /
   * Format.formatAmount + quoteToBaseRaw/baseToQuoteRaw — never floats.
   * - amount input (+ valid price) -> total
   * - price input: amount present -> total; else total present -> amount
   * - total input (+ valid price) -> amount
   * onPreview (optional) is called after every edit so the fee line stays
   * live. Guard flag prevents listener loops. Invalid input leaves the
   * sibling field untouched (no clobber, no blanking). */
  function wireThreeWay(doc, ctx, amountF, priceF, totalF, onPreview) {
    var qp = ctx.quotePrec, bp = ctx.basePrec;
    var guard = false;
    function notify() {
      if (typeof onPreview === "function") {
        try { onPreview(); } catch (e) { /* preview best-effort */ }
      }
    }
    function amountPriceToTotal() {
      if (guard) return;
      guard = true;
      try {
        var a = amountF.input.value.trim();
        var p = priceF.input.value.trim();
        if (a && p) {
          var aRaw = Format.parseAmount(a, qp);
          var r = Format.parsePriceRatio(p);
          var tRaw = quoteToBaseRaw(aRaw, r.num, r.den, qp, bp);
          totalF.input.value = Format.formatAmount(tRaw, bp);
        }
      } catch (e) { /* sibling stands */ }
      guard = false;
      notify();
    }
    function priceEdited() {
      if (guard) return;
      guard = true;
      try {
        var p2 = priceF.input.value.trim();
        var a2 = amountF.input.value.trim();
        var t2 = totalF.input.value.trim();
        if (p2 && a2) {
          var aRaw2 = Format.parseAmount(a2, qp);
          var r2 = Format.parsePriceRatio(p2);
          totalF.input.value = Format.formatAmount(
            quoteToBaseRaw(aRaw2, r2.num, r2.den, qp, bp), bp);
        } else if (p2 && t2 && !a2) {
          var tRaw2 = Format.parseAmount(t2, bp);
          var r3 = Format.parsePriceRatio(p2);
          amountF.input.value = Format.formatAmount(
            baseToQuoteRaw(tRaw2, r3.num, r3.den, qp, bp), qp);
        }
      } catch (e) { /* sibling stands */ }
      guard = false;
      notify();
    }
    function totalEdited() {
      if (guard) return;
      guard = true;
      try {
        var t3 = totalF.input.value.trim();
        var p3 = priceF.input.value.trim();
        if (t3 && p3) {
          var tRaw3 = Format.parseAmount(t3, bp);
          var r4 = Format.parsePriceRatio(p3);
          amountF.input.value = Format.formatAmount(
            baseToQuoteRaw(tRaw3, r4.num, r4.den, qp, bp), qp);
        }
      } catch (e) { /* sibling stands */ }
      guard = false;
      notify();
    }
    /* Click-to-fill path (market-book.js fillTradePrice sets the per-side
      * #trade-price-buy/#trade-price-sell inputs + fires input): the price
      * listener above recomputes the sibling, so book clicks fill the LOCKED
      * price field exactly like the unlocked one. */
    amountF.input.addEventListener("input", amountPriceToTotal);
    priceF.input.addEventListener("input", priceEdited);
    totalF.input.addEventListener("input", totalEdited);
    void doc;
  }

  /* Fee preview line for locked AND unlocked quotes. Builds the same op the
   * review path builds (createOp) with the real seller when known, otherwise
   * QUOTE_PLACEHOLDER_SELLER, then answers ONE get_required_fees via
   * Tx.feeMulti. Shows "Fee (preview): <human>" with the raw integer in the
   * title; empty/invalid quotes show an em-dash (never blank, never a raw
   * integer as visible text). Offline/node errors keep the dash + reason in
   * the title. Debounced: schedule() callers fire on every keystroke. */
  function mountFeePreview(doc, wrap, P, side, getVals) {
    var line = DOM.el(doc, "p", t("trade.fee_preview_dash", "Fee (preview): —"), "muted");
    line.id = "trade-fee-preview-" + side;
    wrap.appendChild(line);
    /* Market-fee row (BuySell.jsx:227-260 + :495-502): the RECEIVE leg's
     * asset (buy->quote, sell->base — fixed per side) carries the row. The
     * options fetch runs ONCE per mount (fail-silent -> the row stays
     * hidden); per-keystroke updates only redo the BigInt fee. Locked and
     * unlocked share this path — never blank (dash until a valid quote),
     * never throws. */
    var mktLine = DOM.el(doc, "p", t("trade.market_fee_preview_dash", "Market fee (preview): —"), "muted");
    mktLine.id = "trade-market-fee-" + side;
    try { mktLine.style.display = "none"; } catch (e) { /* shown on first fee */ }
    wrap.appendChild(mktLine);
    var mktOptsPromise = null;
    function mktOpts() {
      if (!mktOptsPromise) {
        var recvId = side === "buy" ? P.ctx.quote : P.ctx.base;
        mktOptsPromise = fetchMarketFeeOpts(recvId);
      }
      return mktOptsPromise;
    }
    /* paintMkt: render the market-fee row for a receive-leg raw amount
     * (null/zero -> dash with the pct label; no-fee/unreadable asset ->
     * row hidden). Params: recvRaw (int string or null). Never throws. */
    function paintMkt(recvRaw) {
      mktOpts().then(function (opt) {
        if (!opt) {
          try { mktLine.style.display = "none"; } catch (e) { /* hidden stands */ }
          return;
        }
        try { mktLine.style.display = ""; } catch (e) { /* shown stands */ }
        var label = t("trade.market_fee_label", "Market fee, %(pct)s", { pct: marketPctLabel(opt.pct) });
        if (!recvRaw || !/[1-9]/.test(recvRaw)) {
          mktLine.textContent = label + ": —";
          try { mktLine.title = ""; } catch (e) { /* title best-effort */ }
          return;
        }
        var feeRaw = marketFeeRaw(recvRaw, opt.pct, opt.maxRaw);
        if (feeRaw === null) {
          mktLine.textContent = label + ": —";
          return;
        }
        try {
          mktLine.textContent = label + ": " + Format.formatAmount(feeRaw, opt.precision) + " " + opt.symbol;
        } catch (e) {
          mktLine.textContent = label + ": —";
          return;
        }
        try { mktLine.title = feeRaw; } catch (e) { /* title best-effort */ }
      }).catch(function () { /* preview best-effort: row keeps its state */ });
    }
    var timer = null;
    /* schedule: debounce the fee preview 400ms (resets on each keystroke;
     * timers-unavailable keeps the last preview). Never throws. */
    function schedule() {
      try { if (timer !== null) clearTimeout(timer); } catch (e) { /* gone */ }
      try {
        timer = setTimeout(update, 400);
      } catch (e) { /* timers unavailable: preview stands */ }
    }
    async function update() {
      timer = null;
      var vals;
      try { vals = getVals(); }
      catch (e) { return; }
      var ctx = P.ctx;
      var a = (vals.amount || "").trim();
      var p = (vals.price || "").trim();
      if (!a || !p) {
        line.textContent = t("trade.fee_preview_dash", "Fee (preview): —");
        try { line.title = ""; } catch (e) { /* title best-effort */ }
        paintMkt(null);
        return;
      }
      try {
        var qp = ctx.quotePrec, bp = ctx.basePrec;
        var quoteRaw = Format.parseAmount(a, qp);
        if (!/[1-9]/.test(quoteRaw)) throw new Error("zero");
        var ratio = Format.parsePriceRatio(p);
        if (ratio.num <= 0n) throw new Error("zero price");
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
        if (!/[1-9]/.test(sellRaw) || !/[1-9]/.test(recvRaw)) throw new Error("dust");
        var seller = (P.me && P.me.id) ? P.me.id : QUOTE_PLACEHOLDER_SELLER;
        var expWire = previewExpiryWire({ key: vals.key, custom: vals.custom });
        var op = createOp(seller, sellAssetId, sellRaw, recvAssetId, recvRaw, expWire, !!vals.fok);
        var feeRes = await Tx.feeMulti([op], FEE_ASSET);
        var feeMeta = await feeAssetMeta(op[1].fee.asset_id);
        line.textContent = t("trade.fee_preview", "Fee (preview): ") + humanFee(feeRes.totalRaw, feeMeta);
        try { line.title = String(feeRes.totalRaw); } catch (e) { /* title best-effort */ }
        paintMkt(recvRaw);
      } catch (e) {
        line.textContent = t("trade.fee_preview_dash", "Fee (preview): —");
        try { line.title = (e && e.message) ? e.message : ""; } catch (x) { /* gone */ }
        paintMkt(null);
      }
    }
    schedule();
    return { line: line, schedule: schedule, update: update };
  }

  /* Spend-asset balance line. Locked: honest "0 <SYM>" + unlock hint (never
   * blank, never a real balance we cannot know). Unlocked: async spendable
   * balance via balancesMap, human via Format; failures stay honest inline. */
  function mountBalanceLine(doc, wrap, P, side) {
    var ctx = P.ctx;
    var sym = side === "buy" ? ctx.baseSym : ctx.quoteSym;
    var assetId = side === "buy" ? ctx.base : ctx.quote;
    var prec = side === "buy" ? ctx.basePrec : ctx.quotePrec;
    var line = DOM.el(doc, "p", "", "muted");
    wrap.appendChild(line);
    if (isLockedView(P)) {
      line.textContent = t("trade.balance_locked", "Balance: 0 " + sym + " — unlock for balances");
      return line;
    }
    line.textContent = t("trade.balance_loading", "Balance: loading…");
    balancesMap(P.me.id).then(function (bals) {
      var b = bals[assetId];
      var human = b ? Format.formatAmount(b.raw.toString(), b.precision) + " " + b.symbol
        : Format.formatAmount("0", prec) + " " + sym;
      line.textContent = t("trade.balance", "Balance: ") + human;
    }).catch(function (e) {
      line.textContent = t("trade.balance_fail", "Balance unavailable — will check at review.");
      try { line.title = (e && e.message) ? e.message : ""; } catch (x) { /* gone */ }
    });
    return line;
  }

  /* Password row for the locked "Unlock & review" button (same ids per side
   * as the old renderUnlock form shape so help docs keep reading true).
   * Returns refs. */
  function lockedPasswordRow(doc, wrap, side) {
    var f = Forms.labeledInput(doc, t("trade.password_label", "Password ") + " ", {
      id: "trade-unlock-password-" + side, type: "password"
    });
    f.err = DOM.el(doc, "div", "", "error");
    f.err.setAttribute("aria-live", "polite");
    f.err.style.display = "none";
    f.row.appendChild(f.err);
    wrap.appendChild(f.row);
    var errBox = DOM.el(doc, "div", null, "error");
    errBox.setAttribute("aria-live", "polite");
    wrap.appendChild(errBox);
    return { pwField: f, pwErr: errBox };
  }

  /* Locked "Unlock & review" click: preserves the quote inputs in st, unlocks
   * (password ONLY at signing per principle #9), resolves the wallet account,
   * keeps the panels' input state on P, then proceeds down the EXISTING
   * review path (reviewSingle -> paintConfirmSingle). Never clears inputs. */
  function unlockAndReviewSingle(doc, body, mount, P, side, st, refs, btn) {
    refs.pwErr.textContent = "";
    btn.disabled = true;
    var status = showStatus(doc, body, t("trade.unlocking", "Unlocking…"));
    var vals = {
      amount: st.amount, price: st.price, fok: st.fok,
      key: st.key, custom: st.custom
    };
    /* H2: password wiped from input + local once consumed (both outcomes). */
    var pw = refs.pwField.input.value;
    Promise.resolve()
      .then(function () { return Wallet.unlock(pw); })
      .then(function (r) { refs.pwField.input.value = ""; pw = null; return r; })
      .then(function () { return Account.myAccountId(); })
      .then(function (myId) { return Account.resolve(myId).then(function (me) { return { id: myId, name: me.name }; }); })
      .then(function (me) {
        P.me = me;
        try { body.removeChild(status); } catch (e) { /* gone */ }
        var status2 = showStatus(doc, body, t("trade.checking", "Checking balance and fee…"));
        return reviewSingle(P, side, vals).then(function (R) {
          paintConfirmSingle(doc, mount, P, side, R);
        }).catch(function (e) {
          try { body.removeChild(status2); } catch (x) { /* gone */ }
          throw e;
        });
      })
      .catch(function (e) {
        try { if (status.parentNode === body) body.removeChild(status); } catch (x) { /* gone */ }
        try { refs.pwField.input.value = ""; } catch (wipeErr) { /* input gone */ }
        pw = null;
        btn.disabled = false;
        refs.pwErr.textContent = (e && e.message) ? e.message : String(e || t("trade.unlock_failed", "Unlock failed"));
      });
  }

  /* Locked scaled "Unlock & review": same gate as single orders — unlock,
   * keep the scaled inputs on P.scaled, then run the existing reviewScaled
   * -> paintConfirmScaled path. */
  function unlockAndReviewScaled(doc, body, mount, P, spec, refs, btn) {
    refs.pwErr.textContent = "";
    btn.disabled = true;
    var status = showStatus(doc, body, t("trade.unlocking", "Unlocking…"));
    /* H2: password wiped from input + local once consumed (both outcomes). */
    var pw = refs.pwField.input.value;
    Promise.resolve()
      .then(function () { return Wallet.unlock(pw); })
      .then(function (r) { refs.pwField.input.value = ""; pw = null; return r; })
      .then(function () { return Account.myAccountId(); })
      .then(function (myId) { return Account.resolve(myId).then(function (me) { return { id: myId, name: me.name }; }); })
      .then(function (me) {
        P.me = me;
        try { body.removeChild(status); } catch (e) { /* gone */ }
        var status2 = showStatus(doc, body, t("trade.checking", "Checking balance and fee…"));
        return reviewScaled(P, spec).then(function (R) {
          paintConfirmScaled(doc, mount, P, R);
        }).catch(function (e) {
          try { body.removeChild(status2); } catch (x) { /* gone */ }
          throw e;
        });
      })
      .catch(function (e) {
        try { if (status.parentNode === body) body.removeChild(status); } catch (x) { /* gone */ }
        try { refs.pwField.input.value = ""; } catch (wipeErr) { /* input gone */ }
        pw = null;
        btn.disabled = false;
        refs.pwErr.textContent = (e && e.message) ? e.message : String(e || t("trade.unlock_failed", "Unlock failed"));
      });
  }

  /* Desk entry: renderDual(doc, buyMount, sellMount, ctx). Guards backends,
   * then paints TWO always-visible panels (retro 2x3 row 1: Buy QUOTE |
   * Sell QUOTE — reference docs/parity/original-buy-sell-2x3 shot): the
   * buy panel owns a Buy/Scaled tab row (existing .trade-tabs skin +
   * trade.tab_buy/trade.tab_scaled keys — Scaled swaps the scaled form into
   * the buy panel in place of the single form, Buy swaps back); the sell
   * panel always shows its single form. Locked wallets get full quote
   * panels in BOTH cells with live three-way quotes + fee previews + "0"
   * balances (commit 47a30bb contract); the unlock gate lives on each
   * panel's review button ("Unlock & review"), never on viewing. */
  function renderDual(doc, buyMount, sellMount, ctx) {
    if (!buyMount || !sellMount) return;
    DOM.clear(buyMount);
    DOM.clear(sellMount);
    if (typeof Tx === "undefined" || !Tx ||
        typeof Account === "undefined" || !Account ||
        typeof Wallet === "undefined" || !Wallet ||
        typeof Format === "undefined" || !Format ||
        typeof Chain === "undefined" || !Chain) {
      showError(doc, buyMount, t("trade.backend_missing", "Trade backend missing: js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load."));
      showError(doc, sellMount, t("trade.backend_missing", "Trade backend missing: js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load."));
      return;
    }
    if (!ctx || !ctx.base || !ctx.quote) {
      showError(doc, buyMount, t("trade.need_assets", "Trade panels need the market assets; reload the market."));
      return;
    }
    /* Fresh per-side input state (buy/sell/scaled + which buy-panel view).
     * paintSide scrapes the live DOM before every swap, so typed values
     * survive redraws; confirm Back paths repaint through paintSide too. */
    function freshP(me) {
      return {
        ctx: ctx, me: me, scaledOpen: false,
        buy: { amount: "", price: "", total: "", fok: false, key: "YEAR", custom: "" },
        sell: { amount: "", price: "", total: "", fok: false, key: "YEAR", custom: "" },
        scaled: { n: "3", low: "", high: "", total: "", side: "sell", key: "YEAR", custom: "" },
        mounts: { buy: buyMount, sell: sellMount }
      };
    }
    var unlocked = false;
    try {
      unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys;
    } catch (e) { unlocked = false; }
    if (!unlocked) {
      /* TRY-BEFORE-YOU-BUY: full quote panels while locked (same fields as
       * unlocked). The unlock gate lives on each review button. */
      var P0 = freshP(null);
      paintSide(doc, buyMount, P0, "buy");
      paintSide(doc, sellMount, P0, "sell");
      return;
    }
    buyMount.appendChild(DOM.el(doc, "p", t("trade.loading", "Loading trading…"), "muted"));
    sellMount.appendChild(DOM.el(doc, "p", t("trade.loading", "Loading trading…"), "muted"));
    Account.myAccountId().then(function (myId) {
      return Account.resolve(myId).then(function (me) {
        return { id: myId, name: me.name };
      });
    }).then(function (me) {
      var P = freshP(me);
      paintSide(doc, buyMount, P, "buy");
      paintSide(doc, sellMount, P, "sell");
    }).catch(function (e) {
      DOM.clear(buyMount);
      DOM.clear(sellMount);
      showError(doc, buyMount, e, t("trade.fail_account", "Could not load your account."));
      showError(doc, sellMount, e, t("trade.fail_account", "Could not load your account."));
    });
  }

  /* Per-side id namespace: both panels live at once, so every id carries
   * its side (trade-price-buy vs trade-price-sell). market-book.js
   * fillTradePrice targets the namespaced pair. */
  function sid(base, side) {
    return base + "-" + side;
  }

  /* Scrape one panel's live single-form inputs back into its state before a
   * repaint (tab swap), so typed values are never lost. Reads the current
   * DOM via the namespaced ids; missing nodes leave state untouched. */
  function scrapeSingle(mountEl, st, side) {
    function val(base) {
      try {
        var n = mountEl.querySelector("#" + sid(base, side));
        return n ? n.value : null;
      } catch (e) { return null; }
    }
    var v;
    v = val("trade-amount"); if (v !== null) st.amount = v;
    v = val("trade-price"); if (v !== null) st.price = v;
    v = val("trade-total"); if (v !== null) st.total = v;
    v = val("trade-expiry"); if (v !== null) st.key = v;
    v = val("trade-expiry-custom"); if (v !== null) st.custom = v;
    try {
      var f = mountEl.querySelector("#" + sid("trade-fok", side));
      if (f) st.fok = !!f.checked;
    } catch (e) { /* checkbox stands */ }
  }

  /* Scrape the live scaled-form inputs back into P.scaled before a repaint
   * (side change, tab swap). The scaled form only ever renders in the buy
   * panel, so its ids carry the buy side. */
  function scrapeScaled(mountEl, st) {
    function val(base) {
      try {
        var n = mountEl.querySelector("#" + sid(base, "buy"));
        return n ? n.value : null;
      } catch (e) { return null; }
    }
    var v;
    v = val("trade-n"); if (v !== null) st.n = v;
    v = val("trade-low"); if (v !== null) st.low = v;
    v = val("trade-high"); if (v !== null) st.high = v;
    v = val("trade-total"); if (v !== null) st.total = v;
    v = val("trade-expiry"); if (v !== null) st.key = v;
    v = val("trade-expiry-custom"); if (v !== null) st.custom = v;
    try {
      var s = mountEl.querySelector("#trade-scaled-side-buy");
      if (s) st.side = s.value;
    } catch (e) { /* side stands */ }
  }

  /* One panel paint. Buy panels get a Buy/Scaled tab row (existing
   * .trade-tabs skin); Scaled swaps the scaled form into the buy panel in
   * place of the single form, Buy swaps back — each swap scrapes the live
   * form first. Sell panels always show the single form. Confirm screens
   * paint into the same mount; Back returns here with P (both sides'
   * inputs) intact. */
  function paintSide(doc, mountEl, P, side) {
    DOM.clear(mountEl);
    if (side === "buy") {
      var bar = DOM.el(doc, "div", null, "trade-tabs");
      [["buy", t("trade.tab_buy", "Buy"), false], ["scaled", t("trade.tab_scaled", "Scaled"), true]].forEach(function (d) {
        var b = touchable(DOM.el(doc, "button", d[1]));
        b.type = "button";
        b.id = "trade-tab-" + d[0];
        var active = P.scaledOpen === d[2];
        b.setAttribute("aria-pressed", active ? "true" : "false");
        if (active) b.setAttribute("aria-current", "true");
        b.addEventListener("click", function () {
          if (P.scaledOpen === d[2]) return;
          if (P.scaledOpen) scrapeScaled(mountEl, P.scaled);
          else scrapeSingle(mountEl, P.buy, "buy");
          P.scaledOpen = d[2];
          paintSide(doc, mountEl, P, "buy");
        });
        bar.appendChild(b);
      });
      mountEl.appendChild(bar);
      /* Punchlist HIGH: BORROW entry on the buy form (BuySell.jsx:1476-1489
       * margin-short concept). The #/borrow desk owns the open-new-position
       * form — this link is the entry point, not a second form (same
       * single-home rationale as the faucet). Plain literals only. */
      (function borrowEntry() {
        var brow = DOM.el(doc, "p", null, "muted");
        var blink = doc.createElement("a");
        blink.href = "#/borrow";
        blink.textContent = t("trade.borrow_margin_link", "Borrow (margin)");
        blink.title = t("trade.borrow_margin_title", "Open a margin position on the borrow desk");
        brow.appendChild(blink);
        mountEl.appendChild(brow);
      })();
      if (P.scaledOpen) {
        scaledForm(doc, mountEl, mountEl, P);
        return;
      }
    }
    orderForm(doc, mountEl, mountEl, P, side);
  }

  /* Buy/Sell single-order form. Amount is in QUOTE units, total in BASE
   * units; price is BASE per QUOTE (BuySell.jsx amount/price/total trio).
   * The desk owns the panel heading (Buy QUOTE / Sell QUOTE h2), so no h3
   * here. Locked wallets see the SAME fields with live three-way quotes
   * (wireThreeWay) + fee preview (placeholder seller) + "0" balances; the
   * unlock gate lives on the button ("Unlock & review", per-side id
   * unlock-and-review-buy/sell). Review builds the op + live fee; confirm
   * signs. body and mount are the side's own panel mount (confirm replaces
   * just this panel; Back repaints it via paintSide with P intact). */
  function orderForm(doc, body, mount, P, side) {
    var ctx = P.ctx;
    var st = P[side];
    if (st.total === undefined || st.total === null) st.total = "";
    var locked = isLockedView(P);
    var amountF = Forms.labeledInput(doc, "Amount (" + ctx.quoteSym + ") " + " ", {
      id: sid("trade-amount", side), value: st.amount, placeholder: "0.00", inputmode: "decimal"
    });
    amountF.wrap = doc.createElement("span"); amountF.wrap.className = "unit-wrap";
    amountF.input.parentNode.insertBefore(amountF.wrap, amountF.input);
    amountF.wrap.appendChild(amountF.input);
    amountF.wrap.appendChild(DOM.el(doc, "span", ctx.quoteSym, "unit-suffix"));
    amountF.err = DOM.el(doc, "div", "", "error");
    amountF.err.setAttribute("aria-live", "polite");
    amountF.err.style.display = "none";
    amountF.row.appendChild(amountF.err);
    body.appendChild(amountF.row);
    var priceF = Forms.labeledInput(doc, "Price (" + ctx.baseSym + " per " + ctx.quoteSym + ") " + " ", {
      id: sid("trade-price", side), value: st.price, placeholder: "0.00", inputmode: "decimal"
    });
    priceF.wrap = doc.createElement("span"); priceF.wrap.className = "unit-wrap";
    priceF.input.parentNode.insertBefore(priceF.wrap, priceF.input);
    priceF.wrap.appendChild(priceF.input);
    priceF.wrap.appendChild(DOM.el(doc, "span", ctx.baseSym + " / " + ctx.quoteSym, "unit-suffix"));
    priceF.err = DOM.el(doc, "div", "", "error");
    priceF.err.setAttribute("aria-live", "polite");
    priceF.err.style.display = "none";
    priceF.row.appendChild(priceF.err);
    body.appendChild(priceF.row);
    var totalF = Forms.labeledInput(doc, "Total (" + ctx.baseSym + ") " + " ", {
      id: sid("trade-total", side), value: st.total, placeholder: "0.00", inputmode: "decimal"
    });
    totalF.wrap = doc.createElement("span"); totalF.wrap.className = "unit-wrap";
    totalF.input.parentNode.insertBefore(totalF.wrap, totalF.input);
    totalF.wrap.appendChild(totalF.input);
    totalF.wrap.appendChild(DOM.el(doc, "span", ctx.baseSym, "unit-suffix"));
    totalF.err = DOM.el(doc, "div", "", "error");
    totalF.err.setAttribute("aria-live", "polite");
    totalF.err.style.display = "none";
    totalF.row.appendChild(totalF.err);
    body.appendChild(totalF.row);
    mountBalanceLine(doc, body, P, side);
    /* LOW punchlist: lowest-ask / highest-bid helper line under each form.
     * The book owns the live best prices (market-book.js spread lines), so
     * the forms link there instead of duplicating a second price source. */
    body.appendChild(DOM.el(doc, "p", side === "buy" ? t("trade.lowest_ask_lives_in_the_order_book_above", "Lowest ask lives in the order book above — click an ask row to fill the price.") : t("trade.highest_bid_lives_in_the_order_book_above", "Highest bid lives in the order book above — click a bid row to fill the price."), "muted"));
    var fokBox = doc.createElement("input");
    fokBox.type = "checkbox";
    fokBox.id = sid("trade-fok", side);
    fokBox.checked = !!st.fok;
    var fokRow = Forms.fieldRow(doc, t("trade.fok_label", "Fill or kill "), fokBox);
    fokRow.appendChild(DOM.el(doc, "span",
      t("trade.fok_hint", " (cancel unless the whole order fills at once)"), "muted"));
    body.appendChild(fokRow);
    var exp = renderExpiry(doc, body, st, side);
    /* liveVals: scrape current form inputs (amount/price/fill-or-kill/
     * expiry) for the fee preview and review screen. */
    function liveVals() {
      return {
        amount: amountF.input.value, price: priceF.input.value,
        fok: fokBox.checked, key: exp.select.value, custom: exp.custom.value
      };
    }
    var feePrev = mountFeePreview(doc, body, P, side, liveVals);
    wireThreeWay(doc, ctx, amountF, priceF, totalF, feePrev.schedule);
    exp.select.addEventListener("change", feePrev.schedule);
    exp.custom.addEventListener("input", feePrev.schedule);
    fokBox.addEventListener("change", feePrev.schedule);
    /* If the user quoted via total+price (amount empty), derive the amount
     * with the same BigInt path before validation — never floats. */
    function resolveAmounts() {
      var a = amountF.input.value.trim();
      var tot = totalF.input.value.trim();
      var pr = priceF.input.value.trim();
      if (!a && tot && pr) {
        try {
          var tRaw = Format.parseAmount(tot, ctx.basePrec);
          var r = Format.parsePriceRatio(pr);
          a = Format.formatAmount(
            baseToQuoteRaw(tRaw, r.num, r.den, ctx.quotePrec, ctx.basePrec),
            ctx.quotePrec);
          amountF.input.value = a;
        } catch (e) { /* validation below reports it */ }
      }
      return a;
    }
    function saveState() {
      st.amount = amountF.input.value;
      st.price = priceF.input.value;
      st.total = totalF.input.value;
      st.fok = fokBox.checked;
      st.key = exp.select.value;
      st.custom = exp.custom.value;
    }
    if (locked) {
      var refs = lockedPasswordRow(doc, body, side);
      var unlockBtn = touchable(DOM.el(doc, "button", t("trade.unlock_review", "Unlock & review")));
      unlockBtn.id = sid("unlock-and-review", side);
      unlockBtn.type = "button";
      body.appendChild(unlockBtn);
      unlockBtn.addEventListener("click", function () {
        setFieldError(amountF, "");
        setFieldError(priceF, "");
        setFieldError(totalF, "");
        exp.err.style.display = "none";
        resolveAmounts();
        saveState();
        unlockAndReviewSingle(doc, body, mount, P, side, {
          amount: st.amount, price: st.price, fok: st.fok,
          key: st.key, custom: st.custom
        }, refs, unlockBtn);
      });
      return;
    }
    var reviewBtn = touchable(DOM.el(doc, "button", t("trade.review", "Review order")));
    reviewBtn.id = sid("trade-review", side);
    reviewBtn.type = "button";
    body.appendChild(reviewBtn);
    reviewBtn.addEventListener("click", function () {
      setFieldError(amountF, "");
      setFieldError(priceF, "");
      setFieldError(totalF, "");
      exp.err.style.display = "none";
      resolveAmounts();
      saveState();
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
        try { body.removeChild(status); } catch (x) { /* gone */ }
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
    /* Chain-state gate removed (owner directive): balances and fees are NOT
     * pre-checked client-side — the chain is the authority and its exact
     * rejection surfaces via showError on review/broadcast. Review proceeds
     * to confirm; chain validates on broadcast. */
    var ops = [createOp(P.me.id, sellAssetId, sellRaw, recvAssetId, recvRaw, expWire, vals.fok)];
    var unsigned = await Tx.buildTx(ops);
    var feeRes = await Tx.feeMulti(unsigned.operations, FEE_ASSET);
    var feeMeta = await feeAssetMeta(unsigned.operations[0][1].fee.asset_id);
    /* Market fee on the receive leg (BuySell.jsx:227-260, same row as the
     * preview): fail-silent — an unreadable asset yields no row, never a
     * blank and never a throw. */
    var mktFee = null;
    try {
      var mktOpt = await fetchMarketFeeOpts(recvAssetId);
      if (mktOpt) {
        var mktRaw = marketFeeRaw(recvRaw, mktOpt.pct, mktOpt.maxRaw);
        if (mktRaw !== null) {
          mktFee = {
            pct: mktOpt.pct, raw: mktRaw,
            human: Format.formatAmount(mktRaw, mktOpt.precision) + " " + mktOpt.symbol
          };
        }
      }
    } catch (e) { mktFee = null; }
    return {
      side: side, ratio: ratio, sellAssetId: sellAssetId, recvAssetId: recvAssetId,
      sellRaw: sellRaw, recvRaw: recvRaw, expWire: expWire, fok: !!vals.fok,
      unsigned: unsigned, feeRaw: feeRes.totalRaw, feeMeta: feeMeta, mktFee: mktFee
    };
  }

  /* Sell-side symbol for a tab (buy spends BASE, sell spends QUOTE). */
  function sellSym(side, ctx) {
    return side === "buy" ? ctx.baseSym : ctx.quoteSym;
  }

  /* Confirm screen. Row names follow #3's op-1 table (popup.js:5724-5731):
   * Seller / Sell (Amount to Sell) / Buy (Min to Receive) / Expiration /
   * Fill or Kill, plus the plan's Side / Price / Amount / Total / Fee rows.
   * Fee shows human with the raw integer in title (balances convention).
   * mount is the side's own panel mount (the sibling panel stays live);
   * Back repaints just this side via paintSide with P (both inputs) intact. */
  function paintConfirmSingle(doc, mount, P, side, R) {
    var ctx = P.ctx;
    DOM.clear(mount);
    mount.appendChild(DOM.el(doc, "h3", t("trade.confirm_title", "Confirm order")));
    var list = DOM.el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(DOM.el(doc, "dt", term));
      var dd = DOM.el(doc, "dd", text);
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
    if (R.mktFee) {
      row(t("trade.market_fee_label", "Market fee, %(pct)s", { pct: marketPctLabel(R.mktFee.pct) }),
        R.mktFee.human, R.mktFee.raw);
    }
    row(t("trade.row_expiration", "Expiration"), R.expWire);
    row(t("trade.row_fok", "Fill or Kill"), R.fok ? t("trade.yes", "Yes") : t("trade.no", "No"));
    row(t("trade.row_network", "Network"), networkName());
    mount.appendChild(list);
    mount.appendChild(DOM.el(doc, "p", t("trade.chain_hint", "Chain validates balances and fees on broadcast."), "muted"));
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
    var backBtn = touchable(DOM.el(doc, "button", t("trade.back", "Back")));
    backBtn.id = sid("trade-back", side);
    backBtn.type = "button";
    mount.appendChild(backBtn);
    var sendBtn = touchable(DOM.el(doc, "button", t("trade.sign_send", "Sign & Send")));
    sendBtn.id = sid("trade-send", side);
    sendBtn.type = "button";
    mount.appendChild(sendBtn);
    backBtn.addEventListener("click", function () { paintSide(doc, mount, P, side); });
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
            onBack: function () { paintSide(doc, mount, P, side); }
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
   * side, expiry. Renders ONLY in the buy panel (in place of the single
   * form while P.scaledOpen); every id carries the buy side so the sibling
   * sell panel never collides. Preview first (exact BigInt math), then ONE
   * multi-op tx. Locked wallets see the SAME fields (try-before-you-buy);
   * the preview button becomes "Unlock & review" (per-side id
   * unlock-and-review-buy) and unlocks before running the existing
   * reviewScaled path with inputs preserved. The side select scrapes the
   * live inputs before repainting so typed values survive the unit flip. */
  function scaledForm(doc, body, mount, P) {
    var ctx = P.ctx;
    var st = P.scaled;
    var lockedScaled = isLockedView(P);
    body.appendChild(DOM.el(doc, "h3", t("trade.scaled_title", "Scaled orders (one transaction)")));
    var sideF = Forms.labeledSelect(doc, t("trade.side_label", "Side "),
      [["sell", "Sell " + ctx.quoteSym + " (spend " + ctx.quoteSym + ")"],
       ["buy", "Buy " + ctx.quoteSym + " (spend " + ctx.baseSym + ")"]], st.side);
    var sideRow = sideF.row;
    var sideSel = sideF.select;
    sideSel.id = "trade-scaled-side-buy";
    body.appendChild(sideRow);
    var nF = Forms.labeledInput(doc, t("trade.count_label", "Order count (2-20) ") + " ", {
      id: sid("trade-n", "buy"), value: st.n, placeholder: "3", inputmode: "numeric"
    });
    nF.err = DOM.el(doc, "div", "", "error");
    nF.err.setAttribute("aria-live", "polite");
    nF.err.style.display = "none";
    nF.row.appendChild(nF.err);
    body.appendChild(nF.row);
    var priceUnit = ctx.baseSym + " / " + ctx.quoteSym;
    var lowF = Forms.labeledInput(doc, "Price low (" + ctx.baseSym + " per " + ctx.quoteSym + ") " + " ", {
      id: sid("trade-low", "buy"), value: st.low, placeholder: "0.00", inputmode: "decimal"
    });
    lowF.wrap = doc.createElement("span"); lowF.wrap.className = "unit-wrap";
    lowF.input.parentNode.insertBefore(lowF.wrap, lowF.input);
    lowF.wrap.appendChild(lowF.input);
    lowF.wrap.appendChild(DOM.el(doc, "span", priceUnit, "unit-suffix"));
    lowF.err = DOM.el(doc, "div", "", "error");
    lowF.err.setAttribute("aria-live", "polite");
    lowF.err.style.display = "none";
    lowF.row.appendChild(lowF.err);
    body.appendChild(lowF.row);
    var highF = Forms.labeledInput(doc, "Price high (" + ctx.baseSym + " per " + ctx.quoteSym + ") " + " ", {
      id: sid("trade-high", "buy"), value: st.high, placeholder: "0.00", inputmode: "decimal"
    });
    highF.wrap = doc.createElement("span"); highF.wrap.className = "unit-wrap";
    highF.input.parentNode.insertBefore(highF.wrap, highF.input);
    highF.wrap.appendChild(highF.input);
    highF.wrap.appendChild(DOM.el(doc, "span", priceUnit, "unit-suffix"));
    highF.err = DOM.el(doc, "div", "", "error");
    highF.err.setAttribute("aria-live", "polite");
    highF.err.style.display = "none";
    highF.row.appendChild(highF.err);
    body.appendChild(highF.row);
    var sellS = st.side === "buy" ? ctx.baseSym : ctx.quoteSym;
    var totalF = Forms.labeledInput(doc, "Total to sell (" + sellS + ") " + " ", {
      id: sid("trade-total", "buy"), value: st.total, placeholder: "0.00", inputmode: "decimal"
    });
    totalF.wrap = doc.createElement("span"); totalF.wrap.className = "unit-wrap";
    totalF.input.parentNode.insertBefore(totalF.wrap, totalF.input);
    totalF.wrap.appendChild(totalF.input);
    totalF.wrap.appendChild(DOM.el(doc, "span", sellS, "unit-suffix"));
    totalF.err = DOM.el(doc, "div", "", "error");
    totalF.err.setAttribute("aria-live", "polite");
    totalF.err.style.display = "none";
    totalF.row.appendChild(totalF.err);
    body.appendChild(totalF.row);
    sideSel.addEventListener("change", function () {
      scrapeScaled(mount, st);
      st.side = sideSel.value;
      paintSide(doc, mount, P, "buy");
    });
    var exp = renderExpiry(doc, body, st, "buy");
    if (lockedScaled) {
      var sellSym = st.side === "buy" ? ctx.baseSym : ctx.quoteSym;
      body.appendChild(DOM.el(doc, "p",
        t("trade.balance_locked", "Balance: 0 " + sellSym + " — unlock for balances"), "muted"));
      var sRefs = lockedPasswordRow(doc, body, "buy");
      var sUnlockBtn = touchable(DOM.el(doc, "button", t("trade.unlock_review", "Unlock & review")));
      sUnlockBtn.id = sid("unlock-and-review", "buy");
      sUnlockBtn.type = "button";
      body.appendChild(sUnlockBtn);
      sUnlockBtn.addEventListener("click", function () {
        [nF, lowF, highF, totalF].forEach(function (f) { setFieldError(f, ""); });
        exp.err.style.display = "none";
        st.n = nF.input.value;
        st.low = lowF.input.value;
        st.high = highF.input.value;
        st.total = totalF.input.value;
        st.side = sideSel.value;
        st.key = exp.select.value;
        st.custom = exp.custom.value;
        unlockAndReviewScaled(doc, body, mount, P, {
          n: st.n, low: st.low, high: st.high, total: st.total,
          side: st.side, key: st.key, custom: st.custom
        }, sRefs, sUnlockBtn);
      });
      return;
    }
    var prevBtn = touchable(DOM.el(doc, "button", t("trade.preview", "Preview scaled orders")));
    prevBtn.id = sid("trade-preview", "buy");
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

  /** Pure order math for the scaled preview: exact BigInt throughout.
   * Prices: common denominator D, step=(highD-lowD)/(N-1) floored, LAST price
   * pinned to highD exactly. Amounts: total/N floored per order, integer
   * remainder on the LAST order (sum == total exactly, no dust loss).
   * @param {any} P form pack ({ctx: {base, quote, basePrec, quotePrec}, me})
   * @param {any} spec {n, low, high, total, side}
   * @returns {any} {orders: [{priceNum, priceDen, sellRaw, recvRaw}], sellAssetId, recvAssetId} */
  function scaledOrders(P, spec) {
    var ctx = P.ctx;
    var n = Number(String(spec.n).trim());
    if (!/^\d+$/.test(String(spec.n).trim()) || n < 2 || n > 20) {
      throw new Error("Order count must be a whole number from 2 to 20.");
    }
    /* TYPE NOTE: exact-ratio math is BigInt end to end. TS 7 types
     * any-arithmetic as number, so the ratios need their real SHAPE
     * ({num, den} BigInts, matching Format.parsePriceRatio) to keep
     * D/lowD/highD and everything derived BigInt-clean. No shared
     * types.js yet (group 1 owns it); local annotation only. */
    /** @type {{num: bigint, den: bigint}} */
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

  /* Scaled review: preview math + ONE buildTx + ONE feeMulti over all N
   * ops (per-op fees summed + displayed). Chain-state gate removed (owner
   * directive): no client balance pre-check — chain validates on broadcast. */
  async function reviewScaled(P, spec) {
    var calc = scaledOrders(P, spec);
    var ctx = P.ctx;
    var expWire = expiryWire(spec);
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
   * the last row) + summed fee; ONE multi-op tx on Sign & Send. mount is the
   * buy panel's own mount; Back returns to the scaled form (P.scaledOpen
   * still true) with inputs intact. */
  function paintConfirmScaled(doc, mount, P, R) {
    var ctx = P.ctx;
    DOM.clear(mount);
    mount.appendChild(DOM.el(doc, "h3", "Confirm " + R.calc.orders.length + " scaled orders"));
    var table = doc.createElement("table");
    table.className = "node-table";
    var hr = doc.createElement("tr");
    ["#", t("trade.row_price", "Price"), t("trade.col_sell", "Sell"), t("trade.col_receive", "Receive")].forEach(function (h) {
      hr.appendChild(DOM.el(doc, "th", h));
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
      tr.appendChild(DOM.el(doc, "td", String(i + 1)));
      tr.appendChild(DOM.el(doc, "td", ratioToDec(o.priceNum, o.priceDen, PRICE_PLACES)));
      tr.appendChild(DOM.el(doc, "td",
        Format.formatAmount(o.sellRaw, sellP) + " " + sellS,
        "raw " + o.sellRaw));
      var recvCell = Format.formatAmount(o.recvRaw, recvP) + " " + recvS;
      if (i === R.calc.orders.length - 1) recvCell += " (includes remainder)";
      tr.appendChild(DOM.el(doc, "td", recvCell, "raw " + o.recvRaw));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    mount.appendChild(table);
    var list = DOM.el(doc, "dl", null, "xfer-confirm");
    function confirmRow(term, text, title) {
      list.appendChild(DOM.el(doc, "dt", term));
      var dd = DOM.el(doc, "dd", text);
      if (title) dd.title = title;
      list.appendChild(dd);
    }
    confirmRow(t("trade.row_seller", "Seller"), P.me.name + " (" + P.me.id + ")");
    confirmRow("Fee (total, " + R.calc.orders.length + " ops)", humanFee(R.feeRaw, R.feeMeta), R.feeRaw);
    confirmRow(t("trade.row_expiration", "Expiration"), R.expWire);
    confirmRow(t("trade.row_network", "Network"), networkName());
    mount.appendChild(list);
    mount.appendChild(DOM.el(doc, "p", t("trade.chain_hint", "Chain validates balances and fees on broadcast."), "muted"));
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
    var backBtn = touchable(DOM.el(doc, "button", t("trade.back", "Back")));
    backBtn.id = sid("trade-back", "buy");
    backBtn.type = "button";
    mount.appendChild(backBtn);
    var sendBtn = touchable(DOM.el(doc, "button", "Sign & Send (" + R.calc.orders.length + " orders)"));
    sendBtn.id = sid("trade-send", "buy");
    sendBtn.type = "button";
    mount.appendChild(sendBtn);
    backBtn.addEventListener("click", function () { paintSide(doc, mount, P, "buy"); });
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
            onBack: function () { paintSide(doc, mount, P, "buy"); }
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
    renderDual: renderDual
  };
})();

if (typeof module !== "undefined") { module.exports = TradeForm; }
