/* trade-core.js — exact DEX order math + chain send/prove primitives (leaf).
 * Owns: order math exact BigInt throughout (pow10 / quoteToBaseRaw /
 *   baseToQuoteRaw / ratioToDec — display decimals appear only at render),
 *   expiry presets + wire format (EXPIRATIONS + expiryWire + the expiry row
 *   builder renderExpiry, #1 Exchange.jsx mirror), fee primitives
 *   (balancesMap / feeAssetMeta / humanFee / marketPctLabel / marketFeeRaw /
 *   fetchMarketFeeOpts — market-fee math per BuySell.jsx:227-260, fail-silent
 *   nulls), and the send+prove path (headBlock / sendTx via
 *   broadcast_transaction_with_callback with broadcast_transaction fallback
 *   + order-book inclusion polling / snapshotIds / proveNewOrder /
 *   zero-fee createOp entries — Tx.broadcast is NEVER used here: its
 *   inclusion poll only matches op-0 transfers). Price input semantics
 *   (documented, unchanged): price P = BASE units per 1 QUOTE unit.
 * Consumes: Tx (OP ids, serializers, feeMulti, sign — never broadcast),
 *   Format (parseAmount/parsePriceRatio/formatAmount — the only money-math
 *   entry points), Account (balances), Chain (db/net/call), Store (network
 *   label via networkName? — no: networkName lives in trade-panels.js; this
 *   file reads Store only through the callers), Notify/NotifyHost (optional
 *   tx-confirmed toast supplement, guarded silent), Forms/DOM/touchable
 *   (renderExpiry row only), I18n.t via the local t() (Batch-2b contract).
 * Globals/side effects: none beyond the DOM row renderExpiry builds;
 *   global TradeCore only (+ module.exports). Called by TradePanels via
 *   qualified TradeCore.* calls (browser: classic <script> order — this
 *   file BEFORE trade-panels.js; node: required through module.require by
 *   the caller, tx.js precedent).
 * Split from: vanilla/js/views/trade-form.js (mechanical move, zero behavior
 *   change — bodies byte-identical).
 * Created by: view-split task res-split1.
 */
var TradeCore = (function () {
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

  /* Inline error panel that is never blank: any thrown value maps to text. */
  function showError(doc, wrap, e, fallback) {
    var err = null; /* created via DOM.error below */
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
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

  return {
    FEE_ASSET: FEE_ASSET,
    PRICE_PLACES: PRICE_PLACES,
    quoteToBaseRaw: quoteToBaseRaw,
    baseToQuoteRaw: baseToQuoteRaw,
    ratioToDec: ratioToDec,
    expiryWire: expiryWire,
    renderExpiry: renderExpiry,
    balancesMap: balancesMap,
    feeAssetMeta: feeAssetMeta,
    humanFee: humanFee,
    marketPctLabel: marketPctLabel,
    marketFeeRaw: marketFeeRaw,
    fetchMarketFeeOpts: fetchMarketFeeOpts,
    sendTx: sendTx,
    snapshotIds: snapshotIds,
    proveNewOrder: proveNewOrder,
    createOp: createOp
  };
})();

if (typeof globalThis !== "undefined") { globalThis.TradeCore = TradeCore; }

if (typeof module !== "undefined") { module.exports = TradeCore; }
