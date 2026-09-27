/* pool-swap-ui.js — #/swap simple single-pool swap page (slippage + quote wiring).
 * Owns: sell/buy asset pickers (pool-aware: only pairs with a pool list; single
 *   pool auto-selected, multi-pool pairs disambiguated explicitly), sell amount,
 *   live CPMM quote + impact + per-leg fee note, slippage % input (default 0.5%,
 *   editable 0.1-5%), min_to_receive preview, live Tx.fee, NAMED-row confirm,
 *   broadcast + prove by pool-balance delta + history row. Single pool only —
 *   NO multi-hop routing (recorded boundary). Quote/slippage math lives in
 *   pool.js (Pool.quote/minReceive); this file only wires inputs to it.
 * Consumes: PoolUI._ui (shared DOM/confirm helpers — pool-ui.js loads first),
 *   Pool (quote/minReceive/buildExchange/fee/sendAndProve/list/get/history),
 *   Format (parseAmount/formatAmount only), Account, Asset.describe, Wallet,
 *   Chain/Store (via _ui routeReady). WIFs are JS values, never DOM.
 * Globals/side effects: DOM under the router root; global PoolSwapUI only; own
 *   gen counter (stale continuations bail; teardown on every entry).
 * Created by: building-vanilla-slices skill, slice-12-pools plan Task 3
 *   (pre-authorized split: pool-ui.js would breach ~380 lines otherwise).
 * CHAIN TRUTH (#4 wins): op 63 liquidity_pool_exchange <- protocol/
 *   liquidity_pool.hpp:138-152; min_to_receive = floor(quote * (1 - slippage))
 *   in integer math (ambiguity F); #2 SimpleSwap has NO slippage control —
 *   vanilla adds it (both quote and min shown in the confirm).
 */
var PoolSwapUI = (function () {
  "use strict";
  var gen = 0;
  function U() {
    if (typeof PoolUI === "undefined" || !PoolUI._ui) throw new Error("Pool backend missing: pool-ui.js failed to load.");
    return PoolUI._ui;
  }
  function live(myGen, uiGen) { /* both counters live (debit-ui two-counter precedent) */
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  function whoText(me) { return me.name + " (" + me.id + ")"; }
  /* Route entry: #/swap — pick a pair, pick its pool, quote, confirm, send. */
  function renderSwap(root) {
    if (!root) return;
    var u = U(), retry = function () { renderSwap(root); };
    var ctx = u.routeReady(root, "Swap", retry);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen, wrap = ctx.wrap;
    wrap.appendChild(u.el(doc, "p", "Single-pool swap (one op-63). No multi-hop routing.", "muted"));
    var fSell = u.field(doc, "Sell asset", { value: "BTS" });
    var fBuy = u.field(doc, "Buy asset", { placeholder: "CNY" });
    var fAmt = u.field(doc, "Sell amount", { inputmode: "decimal", placeholder: "1.0" });
    var fSlip = u.field(doc, "Slippage %", { value: Pool.DEFAULT_SLIPPAGE_PCT, inputmode: "decimal" });
    [fSell, fBuy, fAmt, fSlip].forEach(function (f) { wrap.appendChild(f.row); });
    var find = u.touchable(u.el(doc, "button", "Find pools")); find.type = "button"; wrap.appendChild(find);
    var pickBox = u.el(doc, "div"); wrap.appendChild(pickBox);
    var quoteBox = u.el(doc, "div"); wrap.appendChild(quoteBox);
    var actionBox = u.el(doc, "div"); wrap.appendChild(actionBox);
    find.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; find.disabled = true;
      u.clearBox(pickBox); u.clearBox(quoteBox); u.clearBox(actionBox);
      u.showStatus(doc, pickBox, "Resolving assets and pools…");
      Promise.resolve().then(async function () {
        var s = await Asset.describe(fSell.input.value.trim() || "BTS");
        var b = await Asset.describe(fBuy.input.value.trim());
        if (s.id === b.id) throw new Error("order-trap (sell asset must differ from receive asset)");
        var a = s.id < b.id ? s : b, c = s.id < b.id ? b : s;
        var rows = await Pool.list({ assetA: a.id, assetB: c.id, limit: 10 });
        return { sell: s, buy: b, rows: rows };
      }).then(function (found) {
        if (!live(myGen, uiGen)) return; u.clearBox(pickBox);
        if (!found.rows.length) {
          pickBox.appendChild(u.el(doc, "p", "No pool exists for " + found.sell.symbol + "/" + found.buy.symbol + ".", "muted"));
          return;
        }
        var sel = doc.createElement("select"); u.touchable(sel);
        found.rows.forEach(function (r, i) {
          var o = doc.createElement("option"); o.value = r.id;
          o.textContent = r.id + " (" + r.sym_a + "/" + r.sym_b + ")";
          sel.appendChild(o);
        });
        var row = u.el(doc, "div", null, "xfer-field");
        row.appendChild(u.el(doc, "span", found.rows.length > 1 ? "Pool (several exist — pick one): " : "Pool: "));
        row.appendChild(sel); pickBox.appendChild(row);
        var quoteBtn = u.touchable(u.el(doc, "button", "Quote")); quoteBtn.type = "button"; pickBox.appendChild(quoteBtn);
        quoteBtn.addEventListener("click", function () {
          if (!live(myGen, uiGen)) return;
          quoteFor(doc, u, myGen, uiGen, quoteBox, actionBox, found, sel.value,
            fAmt.input.value.trim(), fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT);
        });
      }).catch(function (e) {
        if (!live(myGen, uiGen)) return; u.clearBox(pickBox); u.showError(doc, pickBox, e, "Could not find pools.");
      }).then(function () { find.disabled = false; });
    });
  }
  function slipOk(s) { /* slippage gate: 0.1-5% human, string math only */
    var m = /^(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
    if (!m) return false;
    var whole = parseInt(m[1], 10), frac = m[2] || "";
    if (whole > 5 || (whole === 5 && frac.replace(/0+$/, "") !== "")) return false;
    if (whole === 0 && frac.replace(/0+$/, "") === "") return false;
    if (whole === 0 && frac.length && parseInt((frac + "00").slice(0, 2), 10) < 10) return false;
    return frac.length <= 2;
  }
  function quoteFor(doc, u, myGen, uiGen, quoteBox, actionBox, found, poolId, amtHuman, slipHuman) {
    u.clearBox(quoteBox); u.clearBox(actionBox);
    u.showStatus(doc, quoteBox, "Quoting…");
    Promise.resolve().then(async function () {
      if (!slipOk(slipHuman)) throw new Error("bad slippage (0.1-5%, <=2 decimals): " + slipHuman);
      var pool = await Pool.get(poolId);
      var joined = (await Pool.list({ share: pool.share_id }))[0] || null;
      var r = joined || pool;
      var sellIsA = (found.sell.id === r.asset_a_id);
      if (found.sell.id !== r.asset_a_id && found.sell.id !== r.asset_b_id)
        throw new Error("order-trap (sell asset is not in this pool)");
      var precSell = sellIsA ? r.prec_a : r.prec_b;
      var precRecv = sellIsA ? r.prec_b : r.prec_a;
      if (precSell === null || precSell === undefined) precSell = 5;
      if (precRecv === null || precRecv === undefined) precRecv = 5;
      var sellRaw = Format.parseAmount(amtHuman, precSell);
      var q = Pool.quote({ balanceA_raw: r.balance_a_raw, balanceB_raw: r.balance_b_raw, sell_raw: sellRaw, sellIsA: sellIsA });
      var minRaw = Pool.minReceive(q.out_raw, slipHuman);
      return { r: r, sellIsA: sellIsA, precSell: precSell, precRecv: precRecv, sellRaw: sellRaw, q: q, minRaw: minRaw };
    }).then(function (Q) {
      if (!live(myGen, uiGen)) return; u.clearBox(quoteBox);
      var recvHuman = Format.formatAmount(Q.minRaw, Q.precRecv);
      var sellHuman = Format.formatAmount(Q.sellRaw, Q.precSell);
      quoteBox.appendChild(u.el(doc, "p",
        "Quote: " + sellHuman + " " + found.sell.symbol + " → ~" + recvHuman + " " + found.buy.symbol +
        " (min, " + slipHuman + "% slip). Impact " + (Q.q.impact_bp / 100) + "%.", "muted"));
      quoteBox.lastChild.title = "quote raw " + Q.q.out_raw + "; min raw " + Q.minRaw;
      var perLeg = u.el(doc, "p", "Pool legs: " + (Q.r.sym_a || Q.r.asset_a_id) + " / " + (Q.r.sym_b || Q.r.asset_b_id) +
        " — market fees apply per asset settings; pool taker " + Pool.pctUnitsToHuman(Q.r.taker_units) + "%.", "muted");
      quoteBox.appendChild(perLeg);
      u.reviewSection(doc, actionBox, uiGen, "Review swap", {
        build: async function () {
          var me = await Account.resolve(await Account.myAccountId());
          var pair = Pool.buildExchange({ accountId: me.id, poolId: Q.r.id,
            sellHuman: amtHuman, precSell: Q.precSell, sellAssetId: found.sell.id,
            minRaw: Q.minRaw, recvAssetId: found.buy.id });
          return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
            prove: async function () {
              try {
                var cur = await Pool.get(Q.r.id);
                if (cur.balance_a_raw !== Q.r.balance_a_raw || cur.balance_b_raw !== Q.r.balance_b_raw) return cur;
              } catch (e) { return null; }
              try {
                var rows = await Pool.history(Q.r.id, 5);
                if (rows.some(function (h) { return h.op_type === 63; })) return { historyRow: true };
              } catch (e) { /* balance delta above is the proof */ }
              return null; } };
        },
        rows: function (R, fee) {
          var op = R.pair[1];
          return [["Pool", Q.r.id + " (" + (Q.r.sym_a || Q.r.asset_a_id) + "/" + (Q.r.sym_b || Q.r.asset_b_id) + ")"],
            ["Account", whoText(R.me)],
            ["Sell", sellHuman + " " + found.sell.symbol, "raw " + op.amount_to_sell.amount],
            ["Quote out (raw)", Q.q.out_raw],
            ["Min to receive", recvHuman + " " + found.buy.symbol, "raw " + Q.minRaw],
            ["Slippage", slipHuman + "%"], ["Price impact", (Q.q.impact_bp / 100) + "%"],
            ["Fee", fee.text, "raw " + fee.raw], ["Network", "testnet"]];
        },
        title: "Confirm swap", ok: function () { return "Swapped."; }, fail: "Could not prepare the swap." });
    }).catch(function (e) {
      if (!live(myGen, uiGen)) return; u.clearBox(quoteBox); u.showError(doc, quoteBox, e, "Could not quote the swap.");
    });
  }
  return { renderSwap: renderSwap };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolSwapUI === "undefined") { globalThis.PoolSwapUI = PoolSwapUI; }
if (typeof module !== "undefined") { module.exports = PoolSwapUI; }
