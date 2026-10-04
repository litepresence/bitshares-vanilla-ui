/* instant-trade-ui.js — QuickTrade dual SELL/RECEIVE convert flow with order walkthrough.
 * Owns: /instant-trade + /instant-trade/:marketID as the reference QuickTrade
 *   convert screen (dual SELL/RECEIVE panels + bare-glyph swap + per-side
 *   balances + order-walkthrough with effective/last price + depth note +
 *   fee display, then Review/Sign of
 *   ONE op-1 limit_order_create). Legacy QUOTE_BASE loader compat: a deep link
 *   like #/instant-trade/BTS_CNY auto-loads as sell=BTS receive=CNY (same
 *   SYM_SYM split as the old limit path, so the old auto-load does not
 *   regress). No new serializers. Consumes: Market, Tx, Format (only money
 *   entries), Wallet (unlock/WIF as JS value, never DOM), Account, Chain,
 *   Store. Global InstantTradeUI only; gen counter tears down stale work.
 * Refs (concepts only, never ported verbatim): QuickTrade.jsx:37-83 (sell/
 *   receive asset+amount state + active input), SellReceive.jsx (dual
 *   selectors + swap button, stacked under 850px), QuickTrade.jsx:837-944
 *   (quick_trade_details: effective price + your/feed/last price + liquidity/
 *   market/transaction fee rows), QuickTrade.jsx:1102-1137 (orders table
 *   columns id/seller/amount/price), QuickTradeHelper getOrders/getFees
 *   (walk bids until the amount is covered; market_fee_percent/100 label +
 *   min(max_fee, amount*pct/10000) + checkFeeStatusAsync). Confirm names <-
 *   popup.js:5724-5731; fill_or_kill=true <- QuickTrade.jsx:657 (convert
 *   takes liquidity now; old vanilla limit path used false — noted here).
 *   Expiry stays fixed 1-year (old path + QuickTrade 365-day shape).
 *   P = BASE per 1 QUOTE orientation is the desk's (trade-form.js); here the
 *   effective price is RECEIVE per 1 SELL (receive_human/sell_human).
 * Trade-form math: quoteToBaseRaw/baseToQuoteRaw + market-fee trio are
 *   DUPLICATED small below because TradeForm exposes only renderDual (no
 *   math exports) and index.html loads this file BEFORE trade-form.js — same
 *   doctrine as the old file's pow10/quoteToBaseRaw copy. Provenance:
 *   trade-form.js:199-218 (quote/base converters), :322-367 (pct label +
 *   fee raw + fetch opts).
 * Money: integer strings + BigInt until render, Format only (no Number/
 *   parseFloat on money; book human strings re-enter via parseAmount).
 *   Book levels come from Market.book (get_order_book human strings, already
 *   base-per-quote); the walk re-parses them to raw with each side's
 *   precision, so the effective price + table stay exact.
 * PUBLIC-FIRST: no wallet gate — pickers, book walk, effective price, both
 *   fee previews and the walkthrough table are all computable locked (fee
 *   preview uses placeholder seller 1.2.0, fees are account-invariant;
 *   balances read 0 locked with an honest hint). Password is asked ONLY at
 *   Sign & Send (sign-time gate + inline unlock). Locked previews act as
 *   committee-account 1.2.0 with balance checks skipped + warn; Sign forces
 *   unlock + Back re-review under the wallet account.
 * i18n (slice-17): every display string reuses an EXISTING en.json key with
 *   its verbatim default (instant.* + trade.* + market.* + swap.title), so
 *   check_i18n stays green with this file alone and no locale edits. New
 *   concepts (SELL/RECEIVE headers, Swap, effective-price suffix) compose
 *   those keys plus untranslatable symbols (asset codes, "->", em-dash).
 *   Batch-4 i18n: the deferred convert copy below is keyed via t().
 * Created by: stub-queue build (matrix row A31); rebuilt to the QuickTrade
 *   convert flow per slice-18 follow-up (single-file constraint).
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
  var PROVE_TIMEOUT_MS = 30000, PROVE_INTERVAL_MS = 2500, PRICE_PLACES = 6;
  var BOOK_LIMIT = 50, FEE_DEBOUNCE_MS = 400, WALK_ROWS_MAX = 10;
  /* No local el/clearRoot — use DOM.el, DOM.clear */
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    else if (msg.indexOf("wallet-locked") !== -1) msg = t("common.wallet_locked", "Wallet is locked.");
    else if (msg.indexOf("no-account") !== -1) msg = t("instant.no_on_chain_account_found_for_the_wallet_s_ac", "No on-chain account found for the wallet's active key.");
    else if (msg.indexOf("unknown-account") !== -1) msg = t("instant.unknown_market_asset", "Unknown market asset.");
    var err = DOM.error(wrap, msg);
    return err;
  }
  /* Status line for multi-step flows (loading → review → broadcast). */
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text);
    return p; }
  /* Labeled input row with its own inline error slot, via the shared Forms
   * seam (Task 2.2). opts.unit renders a unit suffix span after the input
   * (dexux-ref cue, textContent only). Structure is unchanged: label >
   * input (or label > span.unit-wrap > input + suffix), err div after. */
  function fieldRow(doc, labelText, opts) {
    opts = opts || {};
    var seam = Forms.labeledInput(doc, labelText + " ", {
      type: opts.type, id: opts.id, value: opts.value,
      placeholder: opts.placeholder, inputmode: opts.inputmode });
    var input = seam.input;
    if (opts.unit) {
      var wrap = doc.createElement("span"); wrap.className = "unit-wrap";
      var lab = seam.row.querySelector("label");
      lab.insertBefore(wrap, input);
      wrap.appendChild(input);
      wrap.appendChild(DOM.el(doc, "span", opts.unit, "unit-suffix"));
    }
    var err = DOM.el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite"); err.style.display = "none"; seam.row.appendChild(err);
    return { row: seam.row, input: input, err: err }; }
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
  /* QUOTE raw -> BASE raw at price num/den, BigInt floor (trade-form.js:199).
   * Duplicated (not imported): TradeForm exposes only renderDual and this
   * file loads before trade-form.js — see header. */
  function quoteToBaseRaw(quoteRaw, num, den, qp, bp) {
    if (num <= 0n || den <= 0n) throw new Error("Price must be greater than zero.");
    var n = BigInt(quoteRaw) * num, d = den, shift = bp - qp;
    if (shift >= 0) n = n * pow10(shift); else d = d * pow10(-shift);
    return (n / d).toString(); }
  /* BASE raw -> QUOTE raw at price num/den, BigInt floor (trade-form.js:210).
   * Same duplication note as quoteToBaseRaw. */
  function baseToQuoteRaw(baseRaw, num, den, qp, bp) {
    if (num <= 0n || den <= 0n) throw new Error("Price must be greater than zero.");
    var n = BigInt(baseRaw) * den, d = num, shift = qp - bp;
    if (shift >= 0) n = n * pow10(shift); else d = d * pow10(-shift);
    return (n / d).toString(); }
  void quoteToBaseRaw; void baseToQuoteRaw;
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
    var row = DOM.el(doc, "div", null, "xfer-field xfer-unlock-row");
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("autocomplete", "current-password");
    inp.setAttribute("placeholder", t("instant.password", "Password ")); inp.setAttribute("aria-label", t("instant.password", "Password "));
    touchable(inp); row.appendChild(inp);
    var b = touchable(DOM.el(doc, "button", t("instant.unlock", "Unlock"))); b.type = "button"; row.appendChild(b);
    parent.appendChild(row);
    b.addEventListener("click", function () { b.disabled = true;
      /* H2: wipe the password local + input on either outcome. */
      var pw = inp.value;
      Wallet.unlock(pw).then(function () { inp.value = ""; pw = null; if (onUnlock) onUnlock(); })
        .catch(function (e) { inp.value = ""; pw = null; b.disabled = false; showError(doc, parent, e, t("instant.unlock_failed", "Unlock failed")); });
    });
  }

  /* SELL_RECEIVE pair split (QuickTradeRouter.jsx:33-36 shape: head=sell,
   * tail=receive; identical SYM_SYM shape to the old QUOTE_BASE loader, so
   * #/instant-trade/BTS_CNY auto-loads as sell=BTS receive=CNY). Uppercase,
   * trims, rejects same-asset (Page404 in #1). Throws "bad-market". */
  function parsePair(marketID) {
    if (typeof marketID !== "string") throw new Error("bad-market");
    var parts = marketID.toUpperCase().split("_");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("bad-market");
    if (parts[0] === parts[1]) throw new Error("bad-market");
    return { sellSym: parts[0], receiveSym: parts[1] };
  }

  /* Resolve convert assets + stats/book. ctx carries sell/receive ids, syms,
   * precisions. Book orientation: base=receive, quote=sell, so each level's
   * price is RECEIVE per SELL and level.quote/level.base are the SELL/
   * RECEIVE human totals at that level. Stats use the same orientation, so
   * latest/bid/ask already read as receive-per-sell. Empty books and null
   * stats are VALID (walkthrough shows the empty note + dashes). */
  async function loadConvert(sellSym, receiveSym) {
    var am = await Market.assets(sellSym, receiveSym);
    var ctx = { sellId: am.quote.id, receiveId: am.base.id,
      sellSym: am.quote.symbol, receiveSym: am.base.symbol,
      sellPrec: am.quote.precision, receivePrec: am.base.precision };
    var stats = null, book = { bids: [], asks: [] };
    try { stats = await Market.stats(ctx.receiveId, ctx.sellId); } catch (e) { stats = null; }
    try { book = await Market.book(ctx.receiveId, ctx.sellId, BOOK_LIMIT); } catch (e) { book = { bids: [], asks: [] }; }
    return { ctx: ctx, stats: stats, book: book };
  }

  /* One book level -> raw pair. Level.quote is SELL human, level.base is
   * RECEIVE human (see loadConvert). Re-parses via Format (BigInt only);
   * returns null on unreadable levels (fail-silent: that level is skipped,
   * the walk never blanks on one bad row). */
  function parseLevelRaw(level, sellPrec, receivePrec) {
    try {
      var q = (level && level.quote !== undefined && level.quote !== null) ? String(level.quote) : "";
      var b = (level && level.base !== undefined && level.base !== null) ? String(level.base) : "";
      if (!q || !b) return null;
      var sellRaw = Format.parseAmount(q, sellPrec);
      var receiveRaw = Format.parseAmount(b, receivePrec);
      if (!/^\d+$/.test(sellRaw) || !/^\d+$/.test(receiveRaw)) return null;
      if (BigInt(sellRaw) <= 0n || BigInt(receiveRaw) <= 0n) return null;
      return { sellRaw: sellRaw, receiveRaw: receiveRaw,
        price: (level.displayPrice !== undefined && level.displayPrice !== null) ? String(level.displayPrice) : String(level.price || "") };
    } catch (e) { return null; }
  }

  /* Forward walk (QuickTradeHelper getOrders "sell" concept): cover sellRaw
   * with bids in order, taking each level's SELL up to its size and accruing
   * RECEIVE pro-rata (floor). Params: sellRaw int string, bids array,
   * precisions. Returns {rows, receiveRaw, covered, shortRaw}. Pure BigInt,
   * never throws on book shape (bad levels skipped). */
  function walkSellToReceive(sellRaw, bids, sellPrec, receivePrec) {
    var remaining = BigInt(sellRaw), totalReceive = 0n, rows = [], i, lv, takeSell, takeReceive;
    for (i = 0; i < (bids || []).length; i++) {
      if (remaining <= 0n) break;
      lv = parseLevelRaw(bids[i], sellPrec, receivePrec);
      if (!lv) continue;
      var levelSell = BigInt(lv.sellRaw), levelRecv = BigInt(lv.receiveRaw);
      takeSell = remaining < levelSell ? remaining : levelSell;
      takeReceive = (takeSell * levelRecv) / levelSell;
      rows.push({ price: lv.price, sellTake: takeSell.toString(), receiveTake: takeReceive.toString() });
      totalReceive += takeReceive;
      remaining -= takeSell;
    }
    return { rows: rows, receiveRaw: totalReceive.toString(),
      covered: remaining <= 0n, shortRaw: (remaining < 0n ? 0n : remaining).toString() };
  }

  /* Reverse walk (getOrders "receive" concept): cover receiveRaw, accruing
   * the SELL needed pro-rata (floor). Same purity/shape contract as forward. */
  function walkReceiveToSell(receiveRaw, bids, sellPrec, receivePrec) {
    var remaining = BigInt(receiveRaw), totalSell = 0n, rows = [], i, lv, takeRecv, takeSell;
    for (i = 0; i < (bids || []).length; i++) {
      if (remaining <= 0n) break;
      lv = parseLevelRaw(bids[i], sellPrec, receivePrec);
      if (!lv) continue;
      var levelSell = BigInt(lv.sellRaw), levelRecv = BigInt(lv.receiveRaw);
      takeRecv = remaining < levelRecv ? remaining : levelRecv;
      takeSell = (takeRecv * levelSell) / levelRecv;
      rows.push({ price: lv.price, sellTake: takeSell.toString(), receiveTake: takeRecv.toString() });
      totalSell += takeSell;
      remaining -= takeRecv;
    }
    return { rows: rows, sellRaw: totalSell.toString(),
      covered: remaining <= 0n, shortRaw: (remaining < 0n ? 0n : remaining).toString() };
  }

  /* Effective price human (RECEIVE per 1 SELL) from walked raw totals:
   * (receiveRaw/10^rp)/(sellRaw/10^sp), floored to PRICE_PLACES. BigInt only. */
  function effectiveHuman(sellRaw, receiveRaw, sellPrec, receivePrec) {
    var s = BigInt(sellRaw), r = BigInt(receiveRaw);
    if (s <= 0n || r <= 0n) throw new Error("bad walk totals");
    return ratioToDec(r * pow10(sellPrec), s * pow10(receivePrec), PRICE_PLACES);
  }

  /* Market-fee trio (trade-form.js:322-367, duplicated — TradeForm exports
   * only renderDual; see header). Display-only BigInt, fail-silent (null). */
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
  /* marketFeeRaw: market-fee for a receive amount (pct hundredths, capped at maxRaw).
   * WHY pure BigInt: percent math in float would drift money (principle #6).
   * Params amountRaw/pct/maxRaw (raw strings/number); returns raw string or null. */
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
  /* fetchMarketFeeOpts: read market-fee flag/pct/max for an asset id (one get_assets).
   * WHY null-open: non-fee assets simply hide the market-fee preview, never error.
   * Param assetId; returns {pct, symbol, precision, maxRaw} or null. */
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
  /* feeAssetMeta: symbol+precision for the fee preview asset (one get_assets).
   * WHY separate: fee display needs precision while Tx.feeMulti gives raw only.
   * Param feeAssetId; returns {symbol, precision}; throws bad-asset-shape. */
  async function feeAssetMeta(feeAssetId) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_assets", [[feeAssetId]]);
    if (!rows || !rows[0] || typeof rows[0].precision !== "number") throw new Error(t("instant.bad_asset_shape_for_fee_asset", "bad-asset-shape for fee asset"));
    return { symbol: rows[0].symbol, precision: rows[0].precision };
  }

  /* Route entry. Gates backends, waits for the shared socket (transfer-ui.js
   * connect-wait pattern), then paints the dual convert form.
   * PUBLIC-FIRST: no wallet gate — pickers + walkthrough render locked. */
  function renderInstant(root, marketID) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    if (typeof Tx === "undefined" || !Tx || typeof Market === "undefined" || !Market ||
        typeof Account === "undefined" || !Account || typeof Wallet === "undefined" || !Wallet ||
        typeof Format === "undefined" || !Format) {
      showError(doc, wrap, t("instant.trade_backend_missing_js_tx_js_js_market_js_j", "Trade backend missing: js/tx.js, js/market.js, js/account.js, js/wallet.js or js/format.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && Chain.status().state !== "open") {
      wrap.appendChild(DOM.pageHead(doc, t("instant.instant_trade", "Instant Trade"), "instant-trade"));
      wrap.appendChild(DOM.el(doc, "p", t("common.status_connecting", "Connecting to network…"), "muted"));
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
        DOM.clear(root);
        var failWrap = makeWrap(doc, root);
        failWrap.appendChild(DOM.pageHead(doc, t("instant.instant_trade", "Instant Trade"), "instant-trade"));
        showError(doc, failWrap, new Error("not connected"), t("common.network_unavailable_short", "Network unavailable."));
        var istat = DOM.el(doc, "p", "", "muted");
        try { istat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        failWrap.appendChild(istat);
        var irow = DOM.el(doc, "div", null, "pools-offline-row");
        failWrap.appendChild(irow);
        var iretry = touchable(DOM.el(doc, "button", t("fees.retry", "Retry"))); iretry.type = "button"; iretry.className = "btn-ghost";
        iretry.type = "button";
        irow.appendChild(iretry);
        var ioff = null;
        try { ioff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { ioff = null; }
        if (ioff && typeof ioff.wire === "function") {
          try { ioff.wire(iretry, istat, function () { renderInstant(root, marketID); }, t); } catch (e) { iretry.addEventListener("click", function () { renderInstant(root, marketID); }); }
        } else {
          iretry.addEventListener("click", function () { renderInstant(root, marketID); });
        }
        var ilink = null;
        if (ioff && typeof ioff.settingsLink === "function") {
          try { ilink = ioff.settingsLink(doc, t); } catch (e) { ilink = null; }
        }
        if (!ilink) {
          ilink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
          try { ilink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          ilink.className = "subtle-btn";
        }
        irow.appendChild(ilink);
      }, 15000);
      /* Automated handshake on entry (shared Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
      return;
    }
    var init = { sellSym: "", receiveSym: "", sellAmount: "", receiveAmount: "", activeInput: "sell", M: null, pairErr: "" };
    if (typeof marketID === "string" && marketID) {
      try {
        var pr = parsePair(marketID);
        init.sellSym = pr.sellSym; init.receiveSym = pr.receiveSym;
      } catch (e) {
        init.pairErr = t("instant.market_must_look_like_quote_base_e_g_bts_cny", "Market must look like QUOTE_BASE (e.g. BTS_CNY).");
      }
    }
    paintConvert(doc, root, myGen, init);
  }

  /* Dual convert screen: SELL panel + swap + RECEIVE panel, per-side balances,
   * Load/Quote, stats, order-walkthrough (effective price + fee display +
   * orders table) and Review. State P survives Back/re-renders. Everything
   * above Review is computable locked. */
  function paintConvert(doc, root, myGen, P) {
    if (myGen !== gen) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.pageHead(doc, t("instant.instant_trade", "Instant Trade"), "instant-trade"));
    if (!isUnlockedNow()) {
      var _v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
      wrap.appendChild(DOM.el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v.name, id: _v.id }), "muted"));
    }
    if (P.pairErr) {
      var pe = DOM.el(doc, "div", P.pairErr, "error");
      pe.setAttribute("aria-live", "polite"); wrap.appendChild(pe);
    }
    /* Duo layout (SellReceive.jsx concept: side-by-side wide, stacked narrow).
     * Inline flex (no stylesheet edit — this file owns its layout): wraps at
     * phone width, splits at desk width. */
    var duo = DOM.el(doc, "div", null, "it-duo");
    try {
      duo.style.display = "flex"; duo.style.flexWrap = "wrap";
      duo.style.gap = "12px"; duo.style.alignItems = "stretch";
    } catch (e) { /* layout still stacks without inline flex */ }
    var sellBox = DOM.el(doc, "div", null, "it-panel");
    var recvBox = DOM.el(doc, "div", null, "it-panel");
    try {
      sellBox.style.flex = "1 1 280px"; sellBox.style.minWidth = "0";
      recvBox.style.flex = "1 1 280px"; recvBox.style.minWidth = "0";
    } catch (e) { /* widths best-effort */ }
    sellBox.appendChild(DOM.el(doc, "h2", t("trade.col_sell", "Sell") + (P.sellSym ? " " + P.sellSym : "")));
    recvBox.appendChild(DOM.el(doc, "h2", t("trade.col_receive", "Receive") + (P.receiveSym ? " " + P.receiveSym : "")));
    var sellSymF = fieldRow(doc, t("instant.sell_asset_label", "Sell asset "), { id: "it-sell-sym", value: P.sellSym, placeholder: "BTS", inputmode: "text" });
    sellSymF.input.setAttribute("aria-label", t("instant.sell_asset_symbol_aria", "Sell asset symbol"));
    sellSymF.input.setAttribute("autocapitalize", "characters");
    sellBox.appendChild(sellSymF.row);
    var sellAmtF = fieldRow(doc, t("instant.amount_tpl", "Amount (%(sym)s) ", { sym: P.sellSym || "SELL" }), { id: "it-sell-amount", value: P.sellAmount, placeholder: "0.00", inputmode: "decimal", unit: P.sellSym || "SELL" });
    sellBox.appendChild(sellAmtF.row);
    var sellBal = DOM.el(doc, "p", t("trade.balance_locked", "Balance: 0 — unlock for balances") + (P.sellSym ? " " + P.sellSym : ""), "muted");
    sellBal.id = "it-sell-bal";
    try { sellBal.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    sellBox.appendChild(sellBal);
    var recvSymF = fieldRow(doc, t("instant.receive_asset_label", "Receive asset "), { id: "it-receive-sym", value: P.receiveSym, placeholder: "CNY", inputmode: "text" });
    recvSymF.input.setAttribute("aria-label", t("instant.receive_asset_symbol_aria", "Receive asset symbol"));
    recvSymF.input.setAttribute("autocapitalize", "characters");
    recvBox.appendChild(recvSymF.row);
    var recvAmtF = fieldRow(doc, t("instant.amount_tpl", "Amount (%(sym)s) ", { sym: P.receiveSym || "RECEIVE" }), { id: "it-receive-amount", value: P.receiveAmount, placeholder: "0.00", inputmode: "decimal", unit: P.receiveSym || "RECEIVE" });
    recvBox.appendChild(recvAmtF.row);
    var recvBal = DOM.el(doc, "p", t("trade.balance_locked", "Balance: 0 — unlock for balances") + (P.receiveSym ? " " + P.receiveSym : ""), "muted");
    recvBal.id = "it-receive-bal";
    try { recvBal.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    recvBox.appendChild(recvBal);
    var swapCell = DOM.el(doc, "div", null, "it-swap-cell");
    try { swapCell.style.display = "flex"; swapCell.style.alignItems = "center"; swapCell.style.justifyContent = "center"; } catch (e) { /* centered best-effort */ }
    var swapBtn = touchable(DOM.el(doc, "button", "⇄")); swapBtn.id = "it-swap"; swapBtn.type = "button"; swapBtn.className = "subtle-btn";
    swapBtn.setAttribute("aria-label", t("swap.title", "Swap"));
    /* Bare-glyph swap (SellReceive.jsx concept: Icon name="swap" with no
     * button chrome): transparent, accent ⇄ at ~1.5em. touchable() keeps the
     * 44px target (min-height) plus min-width below. Same id/handler/
     * aria-label — visual change only, no new strings. */
    try {
      swapBtn.style.background = "transparent"; swapBtn.style.border = "none";
      /* A11y delta 2026-10-01: tokens only — was var(--accent) with a
       * stale hardcoded fallback (pre-a11y accent, fails the hex grep). */
      swapBtn.style.color = "var(--accent)"; swapBtn.style.fontSize = "1.5em";
      swapBtn.style.minWidth = "44px"; swapBtn.style.cursor = "pointer"; swapBtn.style.padding = "0 8px";
    } catch (e) { /* glyph styling best-effort */ }
    swapCell.appendChild(swapBtn);
    duo.appendChild(sellBox); duo.appendChild(swapCell); duo.appendChild(recvBox);
    wrap.appendChild(duo);
    var loadBtn = touchable(DOM.el(doc, "button", t("instant.load_market", "Load market")));
    loadBtn.id = "it-load"; loadBtn.type = "button"; wrap.appendChild(loadBtn);
    var out = DOM.el(doc, "div"); out.id = "it-quote-out"; wrap.appendChild(out);
    var walkBox = DOM.el(doc, "div"); walkBox.id = "it-walk"; wrap.appendChild(walkBox);
    var reviewBtn = touchable(DOM.el(doc, "button", t("instant.review_order", "Review order")));
    reviewBtn.id = "it-review"; reviewBtn.type = "button"; wrap.appendChild(reviewBtn);
    var deskP = DOM.el(doc, "p", null, "muted"), deskA = doc.createElement("a");
    deskA.href = "#/market/" + ((P.sellSym || "BTS") + "_" + (P.receiveSym || "CNY"));
    deskA.textContent = t("instant.open_the_full_desk", "Open the full desk");
    deskP.appendChild(deskA); wrap.appendChild(deskP);

    function readSyms() {
      return { sell: (sellSymF.input.value || "").trim().toUpperCase(),
        receive: (recvSymF.input.value || "").trim().toUpperCase() };
    }
    function load() {
      setFieldError(sellSymF, ""); setFieldError(recvSymF, "");
      DOM.clear(out);
      var s = readSyms();
      P.sellSym = s.sell; P.receiveSym = s.receive;
      P.sellAmount = sellAmtF.input.value; P.receiveAmount = recvAmtF.input.value;
      if (!P.sellSym || !P.receiveSym) {
        var need = t("instant.enter_a_market_like_bts_cny", "Enter a market like BTS_CNY.");
        setFieldError(!P.sellSym ? sellSymF : recvSymF, need);
        showError(doc, out, need, t("instant.could_not_load_the_market", "Could not load the market."));
        return;
      }
      if (P.sellSym === P.receiveSym) {
        var same = t("instant.market_must_look_like_quote_base_e_g_bts_cny", "Market must look like QUOTE_BASE (e.g. BTS_CNY).");
        setFieldError(recvSymF, same);
        showError(doc, out, same, t("instant.could_not_load_the_market", "Could not load the market."));
        return;
      }
      loadBtn.disabled = true; swapBtn.disabled = true;
      var status = showStatus(doc, out, t("instant.loading_market", "Loading market…"));
      loadConvert(P.sellSym, P.receiveSym).then(function (M) {
        if (myGen !== gen) return;
        try { if (status.parentNode === out) out.removeChild(status); } catch (e) { /* gone */ }
        loadBtn.disabled = false; swapBtn.disabled = false;
        P.M = M; P.pairErr = "";
        paintLoadedConvert(doc, root, myGen, P);
      }).catch(function (e) {
        if (myGen !== gen) return;
        try { if (status.parentNode === out) out.removeChild(status); } catch (x) { /* gone */ }
        loadBtn.disabled = false; swapBtn.disabled = false;
        var msg = (e && e.message) ? e.message : String(e || t("instant.could_not_load_the_market", "Could not load the market."));
        if (msg === "bad-market" || msg === "bad-asset-shape") msg = t("instant.unknown_market_asset", "Unknown market asset.");
        setFieldError(sellSymF, msg); showError(doc, out, msg, t("instant.could_not_load_the_market", "Could not load the market."));
      });
    }
    loadBtn.addEventListener("click", load);
    swapBtn.addEventListener("click", function () {
      var s = sellSymF.input.value; sellSymF.input.value = recvSymF.input.value; recvSymF.input.value = s;
      var a = sellAmtF.input.value; sellAmtF.input.value = recvAmtF.input.value; recvAmtF.input.value = a;
      P.activeInput = (P.activeInput === "sell") ? "receive" : "sell";
      /* No _routeTo push (deviation from QuickTrade.jsx:107-128): keeping the
       * typed amounts in P beats a hash round-trip that would drop them. The
       * URL stays the entry pair; the panels hold the live swapped pair. */
      load();
    });
    reviewBtn.addEventListener("click", function () {
      setFieldError(sellAmtF, ""); setFieldError(recvAmtF, "");
      P.sellSym = (sellSymF.input.value || "").trim().toUpperCase();
      P.receiveSym = (recvSymF.input.value || "").trim().toUpperCase();
      P.sellAmount = sellAmtF.input.value; P.receiveAmount = recvAmtF.input.value;
      if (!P.M) { load(); return; }
      reviewBtn.disabled = true;
      var status = showStatus(doc, walkBox, t("instant.checking_balance_and_fee", "Checking balance and fee…"));
      reviewConvert(P).then(function (R) { if (myGen === gen) paintConfirm(doc, root, myGen, P, R); })
        .catch(function (e) {
          if (myGen !== gen) return;
          var msg = (e && e.message) ? e.message : String(e || t("instant.could_not_prepare_the_order", "Could not prepare the order."));
          if (msg.indexOf("bad amount") === 0 || msg.indexOf("too many decimals") === 0 || msg.indexOf("Amount must be") === 0 || msg.indexOf("Insufficient") === 0 || msg.indexOf("Price is too small") === 0) setFieldError(sellAmtF, msg);
          try { walkBox.removeChild(status); } catch (x) { /* gone */ }
          reviewBtn.disabled = false;
          showError(doc, walkBox, msg, t("instant.could_not_prepare_the_order", "Could not prepare the order."));
        });
    });
    if (P.sellSym && P.receiveSym && !P.M && !P.pairErr) load();
    else if (P.M) paintLoadedConvert(doc, root, myGen, P);
    else paintWalkEmpty(doc, walkBox, P);
  }

  /* Loaded section: stats line, per-side balances, live two-way walk wiring,
   * walkthrough table + fee previews. All computable locked. */
  function paintLoadedConvert(doc, root, myGen, P) {
    var wrap = root.firstChild;
    if (!wrap) return;
    var M = P.M, ctx = M.ctx;
    try {
      var heads = wrap.querySelectorAll(".it-panel h2");
      if (heads && heads[0]) heads[0].textContent = t("trade.col_sell", "Sell") + " " + ctx.sellSym;
      if (heads && heads[1]) heads[1].textContent = t("trade.col_receive", "Receive") + " " + ctx.receiveSym;
    } catch (e) { /* headers keep their entry labels */ }
    try {
      var deskA = wrap.querySelector("p.muted a");
      if (deskA) deskA.href = "#/market/" + ctx.sellSym + "_" + ctx.receiveSym;
    } catch (e) { /* desk link keeps its default pair */ }
    var walkBox = doc.getElementById("it-walk");
    if (!walkBox) return;
    DOM.clear(walkBox);
    /* Stats (receive-per-sell orientation; human visible, verbatim raw in
     * title — principle #6, same humanPrice path as the old limit view). */
    var latestH = (M.stats && M.stats.latest) ? humanPrice(M.stats.latest) : null;
    var bidH = (M.stats && M.stats.highestBid) ? humanPrice(M.stats.highestBid) : (M.book.bids && M.book.bids[0] ? humanPrice(M.book.bids[0].displayPrice) : null);
    var askH = (M.stats && M.stats.lowestAsk) ? humanPrice(M.stats.lowestAsk) : (M.book.asks && M.book.asks[0] ? humanPrice(M.book.asks[0].displayPrice) : null);
    var statsP = DOM.el(doc, "p", null, "muted");
    statsP.appendChild(doc.createTextNode(t("instant.latest", "Latest: ")));
    var latestSpan = DOM.el(doc, "span", latestH ? latestH.human : "—");
    if (latestH) { try { latestSpan.title = latestH.raw; } catch (e) { /* title best-effort */ } }
    statsP.appendChild(latestSpan);
    statsP.appendChild(doc.createTextNode(t("instant.best_bid", " · Best bid: ")));
    var bidSpan = DOM.el(doc, "span", bidH ? bidH.human : "—");
    if (bidH) { try { bidSpan.title = bidH.raw; } catch (e) { /* title best-effort */ } }
    statsP.appendChild(bidSpan);
    statsP.appendChild(doc.createTextNode(t("instant.best_ask", " · Best ask: ")));
    var askSpan = DOM.el(doc, "span", askH ? askH.human : "—");
    if (askH) { try { askSpan.title = askH.raw; } catch (e) { /* title best-effort */ } }
    statsP.appendChild(askSpan);
    walkBox.appendChild(statsP);
    walkBox.appendChild(DOM.el(doc, "p", t("instant.walkthrough_trade_prefix", "Trade ") + ctx.sellSym + " → " + ctx.receiveSym + t("instant.walkthrough_bids_mid", " — walkthrough uses bids (selling ") + ctx.sellSym + t("instant.walkthrough_paying_mid", " hits bids paying ") + ctx.receiveSym + ").", "muted"));
    if (!M.book.bids || M.book.bids.length === 0) walkBox.appendChild(DOM.el(doc, "p", t("instant.the_order_book_is_empty_type_a_price_manually", "The order book is empty — type a price manually."), "muted"));
    /* Per-side balances: locked 0 + hint (computable), unlocked real. */
    refreshBalances(doc, P, M);
    /* Walkthrough live region: effective price + fee display + orders table. */
    var effP = DOM.el(doc, "p", t("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): —"), "muted");
    effP.id = "it-effective";
    /* A11y delta 2026-10-01: walked totals replace text per keystroke — polite
     * live announces the effective price + fee previews without moving focus.
     * Table itself stays browsable (not live) to avoid row chatter. */
    try { effP.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    walkBox.appendChild(effP);
    /* Last-price walkthrough row (QuickTrade getPriceSection "last" concept):
     * dedicated row from the already-fetched ticker latest (latestH above),
     * receive-per-sell with both syms; dash when the ticker has no latest. */
    var lastP = DOM.el(doc, "p", null, "muted");
    lastP.id = "it-last";
    if (latestH) {
      lastP.textContent = t("instant.latest", "Latest: ") + latestH.human + " " + ctx.receiveSym + t("instant.per_mid", " per ") + ctx.sellSym;
      try { lastP.title = latestH.raw; } catch (e) { /* title best-effort */ }
    } else {
      lastP.textContent = t("instant.latest", "Latest: ") + "—";
    }
    walkBox.appendChild(lastP);
    /* Feed-price row OMITTED (honest, not blank): QuickTrade shows a feed
     * price only for bitasset markets (showFeedPrice: one leg's backing
     * asset is the other leg), fed from MarketsStore feedPrice. No clean
     * feed read exists in this file — loadConvert fetches ticker + book
     * only, and a bitasset current_feed lookup would be a new chain read —
     * so no feed row is rendered rather than a guessed one. */
    /* Liquidity note (QuickTrade getFeeSection "liquidity penalty" concept):
     * depth-derived slippage hint from the clean in-file book read (level
     * count + top-of-book via the same humanPrice path as the stats strip).
     * Static reference by design: the live effective-price row above moves
     * against this top-of-book quote as the typed amount walks deeper. */
    var liqP = DOM.el(doc, "p", null, "muted");
    liqP.id = "it-liquidity";
    var depthN = (M.book.bids || []).length;
    if (bidH && depthN > 0) {
      liqP.textContent = t("market.order_book", "Order book") + ": " + String(depthN) + t("instant.level_suffix", " level") + (depthN === 1 ? "" : "s") + t("instant.best_bid", " · Best bid: ") + bidH.human + " " + ctx.receiveSym + t("instant.per_mid", " per ") + ctx.sellSym;
      try { liqP.title = bidH.raw; } catch (e) { /* title best-effort */ }
    } else {
      liqP.textContent = t("market.order_book", "Order book") + ": —";
    }
    walkBox.appendChild(liqP);
    var feeP = DOM.el(doc, "p", t("trade.fee_preview_dash", "Fee (preview): —"), "muted");
    feeP.id = "it-fee-preview";
    try { feeP.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    walkBox.appendChild(feeP);
    var mktP = DOM.el(doc, "p", t("trade.market_fee_preview_dash", "Market fee (preview): —"), "muted");
    mktP.id = "it-mkt-fee";
    try { mktP.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    walkBox.appendChild(mktP);
    var tblWrap = DOM.el(doc, "div"); tblWrap.id = "it-walk-table";
    try { tblWrap.style.overflowX = "auto"; } catch (e) { /* scroll best-effort */ }
    walkBox.appendChild(tblWrap);
    wireWalkthrough(doc, P, M, effP, feeP, mktP, tblWrap);
  }

  /* Empty walkthrough before any book loads: never blank, never a raw int. */
  function paintWalkEmpty(doc, walkBox, P) {
    void P;
    DOM.clear(walkBox);
    walkBox.appendChild(DOM.el(doc, "p", t("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): —"), "muted"));
    var lastE = DOM.el(doc, "p", t("instant.latest", "Latest: ") + "—", "muted");
    lastE.id = "it-last-empty"; walkBox.appendChild(lastE);
    var liqE = DOM.el(doc, "p", t("market.order_book", "Order book") + ": —", "muted");
    liqE.id = "it-liquidity-empty"; walkBox.appendChild(liqE);
    walkBox.appendChild(DOM.el(doc, "p", t("trade.fee_preview_dash", "Fee (preview): —"), "muted"));
    walkBox.appendChild(DOM.el(doc, "p", t("trade.market_fee_preview_dash", "Market fee (preview): —"), "muted"));
    walkBox.appendChild(DOM.el(doc, "p", t("market.no_orders", "No open orders on this market.") + t("market.place_order_hint", " Place one from the trade form on this page — it lists here until filled or cancelled."), "muted"));
  }

  /* Per-side balance lines (locked 0 + hint; unlocked real via one balances
   * call feeding both sides). Never blank, never throws out. */
  function refreshBalances(doc, P, M) {
    var ctx = M.ctx;
    var sellBal = doc.getElementById("it-sell-bal");
    var recvBal = doc.getElementById("it-receive-bal");
    if (!sellBal || !recvBal) return;
    if (!isUnlockedNow()) {
      sellBal.textContent = t("trade.balance_locked", "Balance: 0 — unlock for balances") + " " + ctx.sellSym;
      recvBal.textContent = t("trade.balance_locked", "Balance: 0 — unlock for balances") + " " + ctx.receiveSym;
      return;
    }
    sellBal.textContent = t("trade.balance", "Balance: ") + "…";
    recvBal.textContent = t("trade.balance", "Balance: ") + "…";
    Account.myAccountId().then(function (myId) { return Account.balances(myId); })
      .then(function (bals) {
        var sm = null, rm = null;
        (bals || []).forEach(function (b) {
          if (b.asset_id === ctx.sellId) sm = b;
          if (b.asset_id === ctx.receiveId) rm = b;
        });
        try {
          sellBal.textContent = t("trade.balance", "Balance: ") +
            (sm ? Format.formatAmount(sm.raw, sm.precision) + " " + sm.symbol
              : Format.formatAmount("0", ctx.sellPrec) + " " + ctx.sellSym);
          recvBal.textContent = t("trade.balance", "Balance: ") +
            (rm ? Format.formatAmount(rm.raw, rm.precision) + " " + rm.symbol
              : Format.formatAmount("0", ctx.receivePrec) + " " + ctx.receiveSym);
        } catch (e) { /* lines keep their loading text */ }
      })
      .catch(function () {
        sellBal.textContent = t("trade.balance", "Balance: ") + "—";
        recvBal.textContent = t("trade.balance", "Balance: ") + "—";
      });
  }

  /* Live two-way walk wiring + fee previews. Editing SELL recomputes RECEIVE
   * via the forward walk; editing RECEIVE recomputes SELL via the reverse
   * walk (QuickTrade onSell/onReceiveAmountChange concept). Guard flag stops
   * listener loops; invalid input leaves the sibling untouched. Fee previews
   * debounce (placeholder seller locked) so every keystroke stays cheap. */
  function wireWalkthrough(doc, P, M, effP, feeP, mktP, tblWrap) {
    var ctx = M.ctx;
    var sellIn = doc.getElementById("it-sell-amount");
    var recvIn = doc.getElementById("it-receive-amount");
    if (!sellIn || !recvIn) return;
    var guard = false, feeTimer = null, mktOptsPromise = null;
    /* mktOpts: memoised market-fee opts for this convert (one fetch per load).
     * WHY memo: every keystroke preview would otherwise re-read the asset.
     * No params; returns the shared promise. */
    function mktOpts() {
      if (!mktOptsPromise) mktOptsPromise = fetchMarketFeeOpts(ctx.receiveId);
      return mktOptsPromise;
    }
    /* paintTable: render the walkthrough levels (human amounts, raw in titles).
     * WHY helper: both directions share this table; empty book shows honest muted.
     * Param rows (walk level list); no return. */
    function paintTable(rows) {
      DOM.clear(tblWrap);
      if (!rows || rows.length === 0) {
        tblWrap.appendChild(DOM.el(doc, "p", t("market.no_orders", "No open orders on this market.") + t("market.type_price_hint", " Type a price manually above, or place one from the full desk — it lists here once resting."), "muted"));
        return;
      }
      var table = doc.createElement("table");
      /* A11y delta 2026-10-01: thead + scope="col" — the router sweep only
       * covers .node-table/.pools-table/.xplore-scroll, so this classless
       * walkthrough table named nothing before (bare <tr> under <table>). */
      var thead = doc.createElement("thead");
      var head = doc.createElement("tr");
      [t("market.col_order", "Order"), t("market.col_price", "Price") + " (" + ctx.receiveSym + t("instant.per_mid", " per ") + ctx.sellSym + ")",
        t("instant.amount", "Amount") + " (" + ctx.sellSym + ")",
        t("instant.total", "Total") + " (" + ctx.receiveSym + ")"].forEach(function (h) {
        var th = doc.createElement("th"); th.textContent = h;
        try { th.setAttribute("scope", "col"); } catch (e) { /* text stands */ }
        head.appendChild(th);
      });
      thead.appendChild(head);
      table.appendChild(thead);
      var walkBody = doc.createElement("tbody");
      table.appendChild(walkBody);
      rows.slice(0, WALK_ROWS_MAX).forEach(function (r, i) {
        var tr = doc.createElement("tr");
        var c0 = doc.createElement("td"); c0.textContent = String(i + 1); tr.appendChild(c0);
        var ph = humanPrice(r.price);
        var c1 = doc.createElement("td"); c1.textContent = ph.human || "—";
        try { c1.title = ph.raw; } catch (e) { /* title best-effort */ }
        tr.appendChild(c1);
        var c2 = doc.createElement("td");
        try { c2.textContent = Format.formatAmount(r.sellTake, ctx.sellPrec) + " " + ctx.sellSym; }
        catch (e) { c2.textContent = "—"; }
        try { c2.title = r.sellTake; } catch (e) { /* title best-effort */ }
        tr.appendChild(c2);
        var c3 = doc.createElement("td");
        try { c3.textContent = Format.formatAmount(r.receiveTake, ctx.receivePrec) + " " + ctx.receiveSym; }
        catch (e) { c3.textContent = "—"; }
        try { c3.title = r.receiveTake; } catch (e) { /* title best-effort */ }
        tr.appendChild(c3);
        walkBody.appendChild(tr);
      });
      tblWrap.appendChild(table);
      tblWrap.appendChild(DOM.el(doc, "p", t("market.order_book", "Order book") + ": " + String(rows.length) + t("instant.level_suffix", " level") + (rows.length === 1 ? "" : "s") + t("instant.walk_suffix", " walk"), "muted"));
    }
    /* paintMkt: paint the market-fee preview line (hidden when the asset has none).
     * WHY best-effort: fee preview must never block typing; failures dash the line.
     * Param receiveRaw (raw string); no return. */
    function paintMkt(receiveRaw) {
      mktOpts().then(function (opt) {
        if (!opt) { try { mktP.style.display = "none"; } catch (e) { /* hidden stands */ } return; }
        try { mktP.style.display = ""; } catch (e) { /* shown stands */ }
        var label = t("trade.market_fee_label", "Market fee, %(pct)s", { pct: marketPctLabel(opt.pct) });
        if (!receiveRaw || !/[1-9]/.test(receiveRaw)) {
          mktP.textContent = label + ": —";
          try { mktP.title = ""; } catch (e) { /* title best-effort */ }
          return;
        }
        var feeRaw = marketFeeRaw(receiveRaw, opt.pct, opt.maxRaw);
        if (feeRaw === null) { mktP.textContent = label + ": —"; return; }
        try { mktP.textContent = label + ": " + Format.formatAmount(feeRaw, opt.precision) + " " + opt.symbol; }
        catch (e) { mktP.textContent = label + ": —"; return; }
        try { mktP.title = feeRaw; } catch (e) { /* title best-effort */ }
      }).catch(function () { /* preview best-effort */ });
    }
    function scheduleFee(sellRaw, receiveRaw) {
      try { if (feeTimer !== null) clearTimeout(feeTimer); } catch (e) { /* gone */ }
      try {
        feeTimer = setTimeout(function () { updateFee(sellRaw, receiveRaw); }, FEE_DEBOUNCE_MS);
      } catch (e) { /* timers unavailable: preview stands */ }
    }
    async function updateFee(sellRaw, receiveRaw) {
      feeTimer = null;
      if (!sellRaw || !receiveRaw || !/[1-9]/.test(sellRaw) || !/[1-9]/.test(receiveRaw)) {
        feeP.textContent = t("trade.fee_preview_dash", "Fee (preview): —");
        try { feeP.title = ""; } catch (e) { /* title best-effort */ }
        paintMkt(null);
        return;
      }
      try {
        var op = [Tx.OP.limit_order_create, {
          fee: { amount: 0, asset_id: FEE_ASSET }, seller: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0",
          amount_to_sell: { amount: String(sellRaw), asset_id: ctx.sellId },
          min_to_receive: { amount: String(receiveRaw), asset_id: ctx.receiveId },
          expiration: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, -5),
          fill_or_kill: true, extensions: [] }];
        var feeRes = await Tx.feeMulti([op], FEE_ASSET);
        var meta = await feeAssetMeta(FEE_ASSET);
        feeP.textContent = t("trade.fee_preview", "Fee (preview): ") + Format.formatAmount(String(feeRes.totalRaw), meta.precision) + " " + meta.symbol;
        try { feeP.title = String(feeRes.totalRaw); } catch (e) { /* title best-effort */ }
        paintMkt(receiveRaw);
      } catch (e) {
        feeP.textContent = t("trade.fee_preview_dash", "Fee (preview): —");
        try { feeP.title = (e && e.message) ? e.message : ""; } catch (x) { /* gone */ }
        paintMkt(null);
      }
    }
    function updateFromSell() {
      if (guard) return;
      guard = true;
      try {
        var a = sellIn.value.trim();
        if (!a) {
          effP.textContent = t("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): —");
          paintTable([]); scheduleFee(null, null);
          guard = false; return;
        }
        var sellRaw = Format.parseAmount(a, ctx.sellPrec);
        if (!/[1-9]/.test(sellRaw)) throw new Error("zero");
        var w = walkSellToReceive(sellRaw, M.book.bids, ctx.sellPrec, ctx.receivePrec);
        var recvHuman = Format.formatAmount(w.receiveRaw, ctx.receivePrec);
        recvIn.value = (/[1-9]/.test(w.receiveRaw)) ? recvHuman : "";
        P.sellAmount = a; P.receiveAmount = recvIn.value; P.activeInput = "sell";
        try {
          var eff = effectiveHuman(sellRaw, w.receiveRaw, ctx.sellPrec, ctx.receivePrec);
          effP.textContent = t("instant.price", "Price") + t("instant.effective_suffix", " (effective): ") + eff + " " + ctx.receiveSym + t("instant.per_mid", " per ") + ctx.sellSym;
          try { effP.title = w.receiveRaw + "/" + sellRaw; } catch (e) { /* title best-effort */ }
        } catch (e) {
          effP.textContent = t("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): —");
        }
        paintTable(w.rows);
        scheduleFee(sellRaw, w.receiveRaw);
      } catch (e) {
        effP.textContent = t("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): —");
        paintTable([]); scheduleFee(null, null);
      }
      guard = false;
    }
    /* updateFromReceive: mirror of updateFromSell (receive input drives the walk).
     * WHY separate: each direction parses its own side then walks pro-rata (floor);
     * the guard stops listener loops; invalid input leaves the sibling untouched.
     * No params, no return; failures dash price/table/fee. */
    function updateFromReceive() {
      if (guard) return;
      guard = true;
      try {
        var b = recvIn.value.trim();
        if (!b) {
          effP.textContent = t("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): —");
          paintTable([]); scheduleFee(null, null);
          guard = false; return;
        }
        var receiveRaw = Format.parseAmount(b, ctx.receivePrec);
        if (!/[1-9]/.test(receiveRaw)) throw new Error("zero");
        var w2 = walkReceiveToSell(receiveRaw, M.book.bids, ctx.sellPrec, ctx.receivePrec);
        var sellHuman = Format.formatAmount(w2.sellRaw, ctx.sellPrec);
        sellIn.value = (/[1-9]/.test(w2.sellRaw)) ? sellHuman : "";
        P.sellAmount = sellIn.value; P.receiveAmount = b; P.activeInput = "receive";
        try {
          var eff2 = effectiveHuman(w2.sellRaw, receiveRaw, ctx.sellPrec, ctx.receivePrec);
          effP.textContent = t("instant.price", "Price") + t("instant.effective_suffix", " (effective): ") + eff2 + " " + ctx.receiveSym + t("instant.per_mid", " per ") + ctx.sellSym;
          try { effP.title = receiveRaw + "/" + w2.sellRaw; } catch (e) { /* title best-effort */ }
        } catch (e) {
          effP.textContent = t("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): —");
        }
        paintTable(w2.rows);
        scheduleFee(w2.sellRaw, receiveRaw);
      } catch (e) {
        effP.textContent = t("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): —");
        paintTable([]); scheduleFee(null, null);
      }
      guard = false;
    }
    sellIn.addEventListener("input", function () { P.activeInput = "sell"; updateFromSell(); });
    recvIn.addEventListener("input", function () { P.activeInput = "receive"; updateFromReceive(); });
    /* Seed from entry amounts (deep link keeps amounts empty; swap seeds
     * swapped values via P). Default direction is SELL (QuickTrade starts
     * from the sell side). */
    if ((P.receiveAmount || "") && !(P.sellAmount || "")) updateFromReceive();
    else if ((P.sellAmount || "")) updateFromSell();
    else { paintTable([]); scheduleFee(null, null); }
  }

  /* Validate, balance-check, build unsigned op-1, live fee (ONE feeMulti).
   * Amounts stay integer strings. Source side follows P.activeInput (last
   * edited panel, QuickTrade activeInput concept); the other leg comes from
   * the book walk (never a price-ratio guess). Locked previews act as
   * committee-account 1.2.0 with balance checks skipped (honest warn on the
   * confirm); the Sign & Send gate requires unlock + a re-review under the
   * wallet account. */
  async function reviewConvert(P) {
    var M = P.M, ctx = M.ctx;
    var locked = !isUnlockedNow();
    var myId = locked ? (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" : await Account.myAccountId();
    var me = await Account.resolve(myId).then(function (a) { return { id: myId, name: a.name }; });
    var sellRaw, receiveRaw, walk;
    if (P.activeInput === "receive" && (P.receiveAmount || "").trim()) {
      try { receiveRaw = Format.parseAmount(P.receiveAmount.trim(), ctx.receivePrec); }
      catch (e) { throw new Error(e && e.message ? e.message : "bad amount"); }
      if (!/[1-9]/.test(receiveRaw)) throw new Error("Amount must be greater than zero.");
      walk = walkReceiveToSell(receiveRaw, M.book.bids, ctx.sellPrec, ctx.receivePrec);
      if (!walk.covered) throw new Error("Insufficient liquidity: the book covers only " + Format.formatAmount(walk.rows.reduce(function (acc, r) { return (BigInt(acc) + BigInt(r.receiveTake)).toString(); }, "0"), ctx.receivePrec) + " " + ctx.receiveSym + " of " + P.receiveAmount.trim() + " " + ctx.receiveSym + ".");
      sellRaw = walk.sellRaw;
    } else {
      try { sellRaw = Format.parseAmount((P.sellAmount || "").trim(), ctx.sellPrec); }
      catch (e) { throw new Error(e && e.message ? e.message : "bad amount"); }
      if (!/[1-9]/.test(sellRaw)) throw new Error("Amount must be greater than zero.");
      walk = walkSellToReceive(sellRaw, M.book.bids, ctx.sellPrec, ctx.receivePrec);
      if (!walk.covered) {
        var coveredSell = walk.rows.reduce(function (acc, r) { return (BigInt(acc) + BigInt(r.sellTake)).toString(); }, "0");
        throw new Error("Insufficient liquidity: the book covers only " + Format.formatAmount(coveredSell, ctx.sellPrec) + " " + ctx.sellSym + " of " + P.sellAmount.trim() + " " + ctx.sellSym + ".");
      }
      receiveRaw = walk.receiveRaw;
    }
    if (!/[1-9]/.test(sellRaw) || !/[1-9]/.test(receiveRaw)) throw new Error(t("instant.price_is_too_small_for_this_amount_one_leg_ro", "Price is too small for this amount: one leg rounds to zero."));
    var expWire = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, -5);
    var bals = await Account.balances(me.id), sellBal = null, feeHave = 0n;
    bals.forEach(function (b) {
      if (b.asset_id === ctx.sellId) sellBal = b;
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
      amount_to_sell: { amount: String(sellRaw), asset_id: ctx.sellId },
      min_to_receive: { amount: String(receiveRaw), asset_id: ctx.receiveId },
      expiration: expWire, fill_or_kill: true, extensions: [] }]];
    var unsigned = await Tx.buildTx(ops), feeRes = await Tx.feeMulti(unsigned.operations, FEE_ASSET);
    var feeMeta = await feeAssetMeta(FEE_ASSET);
    var feeRaw = BigInt(feeRes.totalRaw), sameAsset = (FEE_ASSET === ctx.sellId);
    var need = sameAsset ? BigInt(sellRaw) + feeRaw : feeRaw;
    if (!locked && (sameAsset ? BigInt(sellBal.raw) : feeHave) < need) {
      throw new Error("Insufficient " + feeMeta.symbol + " for the fee: need " + Format.formatAmount(need.toString(), feeMeta.precision) + " " + feeMeta.symbol + ".");
    }
    var effHuman;
    try { effHuman = effectiveHuman(sellRaw, receiveRaw, ctx.sellPrec, ctx.receivePrec); }
    catch (e) { effHuman = ""; }
    return {
      me: me, sellRaw: sellRaw, recvRaw: receiveRaw, expWire: expWire,
      unsigned: unsigned, feeRaw: feeRes.totalRaw, feeMeta: feeMeta,
      previewWarn: previewWarn, walkRows: walk.rows, effHuman: effHuman
    };
  }

  /* Confirm screen. Row names follow #3's op-1 table (popup.js:5724-5731),
   * same set as the desk; fee human, raw in title. Effective price replaces
   * the old limit-price row (receive-per-sell from the walk, raw ratio in
   * the title). */
  function paintConfirm(doc, root, myGen, P, R) {
    if (myGen !== gen) return;
    var M = P.M, ctx = M.ctx;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.pageHead(doc, t("instant.confirm_order", "Confirm order"), "instant-trade"));
    var list = DOM.el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(DOM.el(doc, "dt", term));
      var dd = DOM.el(doc, "dd", text); if (title) dd.title = title; list.appendChild(dd); }
    var sellHuman, recvHuman;
    try { sellHuman = Format.formatAmount(R.sellRaw, ctx.sellPrec); }
    catch (e) { sellHuman = R.sellRaw; }
    try { recvHuman = Format.formatAmount(R.recvRaw, ctx.receivePrec); }
    catch (e) { recvHuman = R.recvRaw; }
    row(t("instant.side_2", "Side"), t("trade.col_sell", "Sell") + " " + ctx.sellSym + " → " + t("trade.col_receive", "Receive") + " " + ctx.receiveSym);
    row(t("instant.seller", "Seller"), R.me.name + " (" + R.me.id + ")");
    row(t("instant.price", "Price") + t("instant.effective_paren", " (effective)"), (R.effHuman ? R.effHuman + " " + ctx.receiveSym + t("instant.per_mid", " per ") + ctx.sellSym : "—"), String(R.recvRaw) + "/" + String(R.sellRaw));
    row(t("instant.sell_amount_to_sell", "Sell (Amount to Sell)"), sellHuman + " " + ctx.sellSym, R.sellRaw);
    row(t("instant.buy_min_to_receive", "Buy (Min to Receive)"), recvHuman + " " + ctx.receiveSym, R.recvRaw);
    row(t("market.col_order", "Order") + t("instant.orders_walk_suffix", "s walk"), String((R.walkRows || []).length) + t("instant.level_suffix", " level") + (((R.walkRows || []).length === 1) ? "" : "s"));
    row(t("instant.fee", "Fee"), Format.formatAmount(String(R.feeRaw), R.feeMeta.precision) + " " + R.feeMeta.symbol, R.feeRaw);
    row(t("instant.expiration", "Expiration"), R.expWire + " (1 year)");
    row(t("instant.fill_or_kill", "Fill or Kill"), t("trade.yes", "Yes"));
    row(t("instant.network", "Network"), networkName());
    wrap.appendChild(list);
    if (R.previewWarn) wrap.appendChild(DOM.el(doc, "p", R.previewWarn, "error"));
    if (!isUnlockedNow()) wrap.appendChild(DOM.el(doc, "p", t("instant.locked_preview_note", "Wallet locked — preview only. Password is asked at Sign & Send, never to view."), "muted"));
    var backBtn = touchable(DOM.el(doc, "button", t("instant.back", "Back"))); backBtn.id = "it-back"; backBtn.type = "button"; backBtn.className = "btn-ghost"; wrap.appendChild(backBtn);
    var sendBtn = touchable(DOM.el(doc, "button", t("common.sign_send", "Sign & Send")));
    sendBtn.id = "it-send"; sendBtn.type = "button"; wrap.appendChild(sendBtn);
    backBtn.addEventListener("click", function () { if (myGen === gen) paintConvert(doc, root, myGen, P); });
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true; sendBtn.disabled = true;
      var status = showStatus(doc, wrap, t("instant.signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) { /* SIGN-TIME GATE: password asked only here — preview stays visible */
        wrap.removeChild(status);
        if (!wrap.querySelector || !wrap.querySelector(".xfer-sign-note")) {
          var note = DOM.el(doc, "p", t("instant.locked_sign_note", "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."), "muted");
          note.className = "muted xfer-sign-note"; wrap.appendChild(note);
        }
        unlockInline(doc, wrap, function () {
          wrap.appendChild(DOM.el(doc, "p", t("instant.unlocked_repreview_note", "Unlocked — press Back and review again so the order uses your account."), "muted"));
        });
        backBtn.disabled = false; sendBtn.disabled = false; return;
      }
      var before;
      Promise.resolve().then(function () { return snapshotIds(R.me.id); })
        .then(function (s) { before = s; return Tx.sign(R.unsigned, wif); })
        .then(function (signed) {
          status.textContent = t("common.status_broadcasting", "Broadcasting…");
          return sendTx(signed, proveNewOrder(R.me.id, before, ctx.sellId, R.sellRaw));
        })
        .then(function (res) {
          if (myGen !== gen) return;
          DOM.clear(root);
          var done = makeWrap(doc, root);
           done.appendChild(DOM.pageHead(doc, t("instant.order_placed", "Order placed"), "instant-trade"));
          done.appendChild(DOM.el(doc, "p", t("instant.order_prefix", "Order ") + res.found.id + t("instant.on_the_book_mid", " is on the book (") + ctx.sellSym + "/" + ctx.receiveSym + ")."));
          done.appendChild(DOM.el(doc, "p", t("instant.observed_head_prefix", "Observed at head block #") + String(res.head) + t("instant.via_mid", " via ") + res.via + ".", "muted"));
          var again = touchable(DOM.el(doc, "button", t("instant.trade_again", "Trade again")));
          again.id = "it-again"; again.type = "button"; done.appendChild(again);
          var deskP = DOM.el(doc, "p", null, "muted"), deskA = doc.createElement("a");
          deskA.href = "#/market/" + ctx.sellSym + "_" + ctx.receiveSym;
          deskA.textContent = t("instant.open_the_full_desk", "Open the full desk");
          deskP.appendChild(deskA); done.appendChild(deskP);
          again.addEventListener("click", function () {
            if (myGen === gen) paintConvert(doc, root, myGen, { sellSym: "", receiveSym: "", sellAmount: "", receiveAmount: "", activeInput: "sell", M: null, pairErr: "" });
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
