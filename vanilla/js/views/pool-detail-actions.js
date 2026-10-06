/* pool-detail-actions.js — #/pools/:id stake/swap/manage panels (op forms).
 *
 * What it owns: the stake boxes (stakeBoxes — op-61 deposit + op-62 withdraw
 *   with share previews), the inline swap box (swapInlineBox — op-63
 *   mini-form with quote + impact + slippage preview) and the manage boxes
 *   (manageBoxes — op-75 fee edit with withdrawal 0-only + op-60 owner delete
 *   with fee 0), all with NAMED-row confirms via the shared reviewSection.
 *   Leaf panels: no route entry, no chart/depth/history code (those stay in
 *   pool-detail-view.js, which calls these three via PoolDetailUI._actions
 *   at call time), no staleness tracking of its own.
 * Consumes: PoolUI._ui (field/reviewSection/amtText/pctText/touchable/el —
 *   pool-ui.js loads first), Pool (buildDeposit/buildWithdraw/buildExchange/
 *   buildUpdate/buildDelete/fee/quote/minReceive/pctUnitsToHuman/
 *   DEFAULT_SLIPPAGE_PCT), Format.parseAmount, Account. Tiny t/U/whoText/
 *   precOr5 copies are verbatim from pool-detail-view.js (vote-slate split
 *   precedent — no shared layer for two files). Side effects: DOM under the
 *   caller's box only; attaches PoolDetailUI._actions and republishes
 *   globalThis.PoolDetailUI. WIFs are JS values, never DOM.
 * Created by: task-res-split2 (pool-detail-ui.js responsibility split —
 *   stake/positions half; bodies moved verbatim). Facade: pool-detail-ui.js.
 */
var PoolDetailUI = (typeof globalThis !== "undefined" && globalThis.PoolDetailUI) ? globalThis.PoolDetailUI : ((typeof PoolDetailUI !== "undefined") ? PoolDetailUI : {});
PoolDetailUI._actions = PoolDetailUI._actions || {};
(function () {
  "use strict";

  /* Verbatim copy of pool-detail-view.js t (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Batch-2d i18n (slice-17 precedent): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. Dynamic sentences keep
   * their code structure (batch-2b precedent): only complete static literals and
   * word-bearing segments are wrapped, values and punctuation glue stay raw, so
   * every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Verbatim copy of pool-detail-view.js U (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Shared-_ui accessor: PoolUI._ui (pool-ui.js loads first); throws when the backend is missing. */
  function U() {
    if (typeof PoolUI === "undefined" || !PoolUI._ui) throw new Error(t("pool.backend_missing", "Pool backend missing: pool-ui.js failed to load."));
    return PoolUI._ui;
  }

  /* Verbatim copy of pool-detail-view.js whoText (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  function whoText(me) { return me.name + " (" + me.id + ")"; }

  /* Verbatim copy of pool-detail-view.js precOr5 (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  function precOr5(p) { return (p === null || p === undefined) ? 5 : p; }

  /* Verbatim copy of trade-panels.js networkName (:101-110 — Store-network helper; the trade and pool stacks share no layer, so the 8-line helper is duplicated per the split-part convention, never imported). */
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

  /**
   * Hundredths-of-a-percent int -> "X%" display via integer strings only.
   * WHY integer math (principle #6): Pool.quote answers impact_bp as a
   * money-derived int and chain percents are u16 hundredths — a binary float
   * (bp / 100) risks artefacts on money-adjacent values, while floor plus a
   * padded-then-trimmed remainder is exact. Shared by the swap impact row and
   * the preview market-fee pct label (both shapes are hundredths: 100 = 1%).
   * Producer (pool.js quote/minReceive) stays BigInt — this formats only.
   * @param {number} pct hundredths int (5 -> "0.05%", 50 -> "0.5%", 2000 -> "20%")
   * @returns {string} human percent label, never a float artefact
   */
  function pctHundredthsText(pct) {
    var p = Math.floor(Number(pct));
    if (!isFinite(p) || p < 0) p = 0;
    var whole = Math.floor(p / 100), rest = p % 100;
    if (rest === 0) return whole + "%";
    var frac = (rest < 10 ? "0" + rest : String(rest)).replace(/0+$/, "");
    return whole + "." + frac + "%";
  }
  function stakeBoxes(doc, box, r, uiGen) { /* op-61 deposit + op-62 withdraw with share previews */
    var u = U();
    var fA = u.field(doc, t("pool.amount_a_field", "Amount A"), { inputmode: "decimal", placeholder: "1.0" });
    var fB = u.field(doc, t("pool.amount_b_field", "Amount B"), { inputmode: "decimal", placeholder: "1.0" });
    box.appendChild(fA.row); box.appendChild(fB.row);
    /* Proportional auto-fill preview (pool-desk FIX 3): typing in one leg
     * auto-fills the other at pool ratio via Pool.stakeCounterpart (exact
     * BigInt FLOOR math — floor never over-asks the other leg past the ratio;
     * dust can floor to an honest zero and the share line below says so).
     * Last-edited-wins (the filling guard stops echo loops; a cleared field
     * mirror-clears its counterpart). Auto-fill is a PREVIEW only — the
     * Review-stake confirm below still shows the exact integers to sign,
     * never a silent substitution. Unstake (shares-only) is untouched. */
    box.appendChild(u.el(doc, "p", t("pool.stake_autofill_hint", "Type one amount — the other auto-fills at pool ratio."), "muted"));
    var ratioLine = u.el(doc, "p", "", "muted"); ratioLine.id = "pool-stake-ratio";
    box.appendChild(ratioLine);
    var shareLine = u.el(doc, "p", "", "muted"); shareLine.id = "pool-stake-shares";
    try { shareLine.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    box.appendChild(shareLine);
    /* Spot ratio line (B-per-A via the BigInt formatPrice path, 4-sf display
     * per the global price rule; empty pool -> honest enter-by-hand note,
     * never a crash). */
    try {
      var spotRaw = Format.formatPrice(String(r.balance_b_raw), precOr5(r.prec_b), String(r.balance_a_raw), precOr5(r.prec_a), 8);
      var spot = spotRaw;
      try {
        if (typeof Format.priceSig === "function") {
          var spsig = Format.priceSig(spotRaw);
          if (typeof spsig === "string" && spsig) spot = spsig;
        }
      } catch (e) { /* 8-place stands */ }
      ratioLine.textContent = t("pool.stake_ratio_row", "Ratio (spot)") + ": 1 " + (r.sym_a || r.asset_a_id) +
        " ≈ " + spot + " " + (r.sym_b || r.asset_b_id);
    } catch (e) {
      ratioLine.textContent = t("pool.stake_ratio_empty", "Pool is empty — enter both amounts by hand.");
    }
    /* LP share supply for the estimate below (Asset.describe join; null until
     * resolved or when offline — the share line says so honestly). */
    var shareSupply = null;
    shareLine.textContent = t("pool.stake_preview_need_both", "Enter both amounts for a share estimate.");
    try {
      if (typeof Asset !== "undefined" && Asset && typeof Asset.describe === "function") {
        Asset.describe(r.share_id).then(function (a) {
          if (a && a.supply_raw !== null && a.supply_raw !== undefined) shareSupply = String(a.supply_raw);
          refreshShare();
        }).catch(function () { /* need-both/unavailable note stands */ });
      }
    } catch (e) { /* note stands */ }
    /* refreshShare: share-out preview via Pool.shareOut (pool.js BigInt mint
     * math — min-of-ratios funded, max-raw virgin). Empty fields -> need-both
     * hint; offline supply -> unavailable note; unparsable/too-small amounts
     * -> check-amounts note. Never throws outward. */
    function refreshShare() {
      var aH = String(fA.input.value || "").trim(), bH = String(fB.input.value || "").trim();
      if (!aH || !bH) { shareLine.textContent = t("pool.stake_preview_need_both", "Enter both amounts for a share estimate."); return; }
      if (shareSupply === null) { shareLine.textContent = t("pool.stake_preview_unavailable", "Share estimate unavailable (offline)."); return; }
      try {
        var s = Pool.shareOut({ balanceA_raw: String(r.balance_a_raw), balanceB_raw: String(r.balance_b_raw),
          supply_raw: shareSupply,
          inA_raw: Format.parseAmount(aH, precOr5(r.prec_a)), inB_raw: Format.parseAmount(bH, precOr5(r.prec_b)) });
        var sh = u.amtText(s.share_raw, r.share_id, precOr5(r.prec_share), r.sym_share);
        shareLine.textContent = t("pool.stake_shares_row", "Est. LP shares") + ": " + sh.text;
        try { shareLine.title = t("account.raw_prefix", "raw ") + sh.raw; } catch (e2) { /* text stands */ }
      } catch (e) {
        shareLine.textContent = t("pool.stake_preview_bad", "Check the amounts — no share estimate.");
      }
    }
    var filling = false;
    /* fillFromA/fillFromB: one leg typed -> counterpart fills the other at
     * pool ratio (Pool.stakeCounterpart). Empty-pool (virgin) legs throw
     * "empty-pool" here — the typed value stands and both legs stay hand-set.
     * Params: none (reads its own input). Returns nothing. */
    function fillFromA() {
      if (filling) return;
      var aH = String(fA.input.value || "").trim();
      if (!aH) { fB.input.value = ""; refreshShare(); return; }
      try {
        var bH = Pool.stakeCounterpart({ srcHuman: aH, srcPrec: precOr5(r.prec_a), dstPrec: precOr5(r.prec_b),
          srcBalRaw: String(r.balance_a_raw), dstBalRaw: String(r.balance_b_raw) });
        filling = true; fB.input.value = bH; filling = false;
      } catch (e) { /* counterpart stands (virgin pool or bad input) */ }
      refreshShare();
    }
    function fillFromB() {
      if (filling) return;
      var bH2 = String(fB.input.value || "").trim();
      if (!bH2) { fA.input.value = ""; refreshShare(); return; }
      try {
        var aH2 = Pool.stakeCounterpart({ srcHuman: bH2, srcPrec: precOr5(r.prec_b), dstPrec: precOr5(r.prec_a),
          srcBalRaw: String(r.balance_b_raw), dstBalRaw: String(r.balance_a_raw) });
        filling = true; fA.input.value = aH2; filling = false;
      } catch (e) { /* counterpart stands (virgin pool or bad input) */ }
      refreshShare();
    }
    try {
      fA.input.addEventListener("input", fillFromA);
      fB.input.addEventListener("input", fillFromB);
    } catch (e) { /* fields stand without auto-fill */ }
    u.reviewSection(doc, box, uiGen, t("pool.review_stake", "Review stake"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildDeposit({ accountId: me.id, poolId: r.id, assetAId: r.asset_a_id, assetBId: r.asset_b_id,
          aHuman: fA.input.value.trim(), precA: precOr5(r.prec_a),
          bHuman: fB.input.value.trim(), precB: precOr5(r.prec_b) });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var lA = u.amtText(op.amount_a.amount, op.amount_a.asset_id, precOr5(r.prec_a), r.sym_a);
        var lB = u.amtText(op.amount_b.amount, op.amount_b.asset_id, precOr5(r.prec_b), r.sym_b);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.amount_a_field", "Amount A"),  lA.text, "raw " + lA.raw], [t("pool.amount_b_field", "Amount B"),  lB.text, "raw " + lB.raw],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  networkName()]];
      },
      title: t("pool.confirm_stake", "Confirm stake"), ok: function () { return t("pool.staked", "Staked (deposit broadcast)."); }, fail: t("pool.stake_failed", "Could not prepare the stake.") });
    var fS = u.field(doc, t("pool.shares_field", "LP shares"), { inputmode: "decimal", placeholder: "1.0" });
    box.appendChild(fS.row);
    u.reviewSection(doc, box, uiGen, t("pool.review_unstake", "Review unstake"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildWithdraw({ accountId: me.id, poolId: r.id, shareId: r.share_id,
          shareHuman: fS.input.value.trim(), precShare: precOr5(r.prec_share) });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var sh = u.amtText(op.share_amount.amount, op.share_amount.asset_id, precOr5(r.prec_share), r.sym_share);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.shares_field", "LP shares"),  sh.text, "raw " + sh.raw],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  networkName()]];
      },
      title: t("pool.confirm_unstake", "Confirm unstake"), ok: function () { return t("pool.unstaked", "Unstaked (withdraw broadcast)."); }, fail: t("pool.unstake_failed", "Could not prepare the unstake.") });
  }

  function swapInlineBox(doc, box, r, uiGen) { /* op-63 mini-form: quote + impact + slippage preview */
    var u = U();
    var fSell = u.field(doc, t("pool.sell_amount_field", "Sell amount"), { inputmode: "decimal", placeholder: "1.0" });
    try { fSell.input.id = "pool-swap-amount"; } catch (e) { /* fill skips */ }
    box.appendChild(fSell.row);
    var dir = doc.createElement("select"); u.touchable(dir);
    try { dir.id = "pool-swap-dir"; } catch (e) { /* fill skips */ }
    var oA = doc.createElement("option"); oA.value = "A"; oA.textContent = t("account.sell_prefix", "Sell ") + (r.sym_a || r.asset_a_id);
    var oB = doc.createElement("option"); oB.value = "B"; oB.textContent = t("account.sell_prefix", "Sell ") + (r.sym_b || r.asset_b_id);
    dir.appendChild(oA); dir.appendChild(oB); box.appendChild(dir);
    var fSlip = u.field(doc, t("pool.slippage_field", "Slippage %"), { value: Pool.DEFAULT_SLIPPAGE_PCT, inputmode: "decimal" });
    box.appendChild(fSlip.row);
    /* Live pre-review swap preview: amount/dir/slippage sit inert until
     * Review otherwise, so this answers Pool.quote + Pool.minReceive on every
     * edit (debounced, seq-guarded like trade-panels.js mountFeePreview — a
     * slow market-fee fetch must never overwrite a newer quote). BigInt only
     * (Format.parseAmount in, u.amtText out); empty/invalid input shows a
     * dash (never blank, never a raw integer as visible text). Read-only —
     * the Review path below still builds and signs the real op. */
    var quoteLine = u.el(doc, "p", t("pool.swap_preview_dash", "Quote (preview): —"), "muted");
    try { quoteLine.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    box.appendChild(quoteLine);
    var mktLine = u.el(doc, "p", t("pool.swap_mkt_preview_dash", "Market fee (preview): —"), "muted");
    try { mktLine.style.display = "none"; } catch (e) { /* shown on first fee */ }
    box.appendChild(mktLine);
    var seq = 0, timer = null, mktCache = {};
    /**
     * Receive-leg market-fee options for the preview row (get_assets flag
     * check: charge_market_fee bit 0x01; fee = min(max, out * pct / 10000)).
     * WHY a local Chain read, not TradeCore: the trade stack is not a
     * declared seam for this pool panel file, so the 10-line check is
     * duplicated per the split-part convention. Cached per asset id.
     * @param {string|null} assetId receive-leg asset id (null -> null)
     * @returns {Promise<any>} {pct, symbol, precision, maxRaw} or null (flag off / offline)
     */
    function recvFeeOpts(assetId) {
      if (!assetId) return Promise.resolve(null);
      if (!Object.prototype.hasOwnProperty.call(mktCache, assetId)) {
        mktCache[assetId] = (async function () {
          try {
            var rows = await Chain.call(await Chain.db(), "get_assets", [[assetId]]);
            var a = rows && rows[0];
            if (!a || !a.options || typeof a.precision !== "number" || !a.symbol) return null;
            if (!(Number(a.options.flags || 0) & 1)) return null;
            var maxRaw = (a.options.max_market_fee !== undefined && a.options.max_market_fee !== null)
              ? String(a.options.max_market_fee) : null;
            if (maxRaw === null || !/^\d+$/.test(maxRaw)) return null;
            return { pct: Math.floor(Number(a.options.market_fee_percent || 0)), symbol: a.symbol,
              precision: a.precision, maxRaw: maxRaw };
          } catch (e) { return null; }
        })();
      }
      return mktCache[assetId];
    }
    /**
     * min(maxRaw, amountRaw * pct / 10000) in integer strings (chain
     * market-fee shape, BigInt floor — never float for money).
     * @param {string} amountRaw quoted-out digit string
     * @param {number} pct fee hundredths int
     * @param {string} maxRaw cap digit string
     * @returns {string|null} fee raw, or null on bad input
     */
    function mktFeeRaw(amountRaw, pct, maxRaw) {
      try {
        if (typeof amountRaw !== "string" || !/^\d+$/.test(amountRaw)) return null;
        var p = Math.floor(Number(pct));
        if (!isFinite(p) || p <= 0) return "0";
        if (typeof maxRaw !== "string" || !/^\d+$/.test(maxRaw)) return null;
        var fee = (BigInt(amountRaw) * BigInt(p)) / 10000n;
        var max = BigInt(maxRaw);
        if (fee > max) fee = max;
        return fee.toString();
      } catch (e) { return null; }
    }
    /**
     * Render the receive-leg market-fee row for a quoted-out amount.
     * Null/zero quote -> dash with the pct label; flag-off/offline asset ->
     * row hidden (mountFeePreview fail-silent precedent). Never throws.
     * @param {string|null} recvRaw quoted-out raw (null on invalid quote)
     * @param {string|null} recvId receive-leg asset id
     * @param {number} s sequence token (stale paints return early)
     * @returns {void}
     */
    function paintMkt(recvRaw, recvId, s) {
      recvFeeOpts(recvId).then(function (opt) {
        if (s !== seq) return;
        if (!opt) {
          try { mktLine.style.display = "none"; } catch (e) { /* hidden stands */ }
          return;
        }
        try { mktLine.style.display = ""; } catch (e) { /* shown stands */ }
        var label = t("pool.swap_mkt_row", "Market fee") + " (" + pctHundredthsText(opt.pct) + ")";
        if (!recvRaw || !/[1-9]/.test(recvRaw)) {
          mktLine.textContent = label + ": —";
          try { mktLine.title = ""; } catch (e) { /* title best-effort */ }
          return;
        }
        var feeRaw = mktFeeRaw(recvRaw, opt.pct, opt.maxRaw);
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
        try { mktLine.title = "raw " + feeRaw; } catch (e) { /* title best-effort */ }
      }).catch(function () { /* preview best-effort: row keeps its state */ });
    }
    /**
     * Recompute the swap preview for the current inputs (debounced caller).
     * @param {number} s sequence token (stale runs return early)
     * @returns {void} Never throws outward — invalid input shows the dash.
     */
    function update(s) {
      timer = null;
      if (s !== seq) return;
      var sellH = String(fSell.input.value || "").trim();
      var sellIsA = dir.value === "A";
      var recvId = sellIsA ? r.asset_b_id : r.asset_a_id;
      var precRecv = precOr5(sellIsA ? r.prec_b : r.prec_a);
      var recvSym = sellIsA ? (r.sym_b || r.asset_b_id) : (r.sym_a || r.asset_a_id);
      if (!sellH) {
        quoteLine.textContent = t("pool.swap_preview_dash", "Quote (preview): —");
        try { quoteLine.title = ""; } catch (e) { /* title best-effort */ }
        paintMkt(null, recvId, s);
        return;
      }
      try {
        var sellRaw = Format.parseAmount(sellH, precOr5(sellIsA ? r.prec_a : r.prec_b));
        var q = Pool.quote({ balanceA_raw: String(r.balance_a_raw), balanceB_raw: String(r.balance_b_raw),
          sell_raw: sellRaw, sellIsA: sellIsA });
        var minRaw = Pool.minReceive(q.out_raw, fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT);
        if (s !== seq) return;
        var out = u.amtText(q.out_raw, recvId, precRecv, recvSym);
        var min = u.amtText(minRaw, recvId, precRecv, recvSym);
        quoteLine.textContent = t("pool.swap_preview", "Quote (preview): ") + out.text +
          " · " + t("pool.min_recv_row", "Min to receive") + ": " + min.text;
        try { quoteLine.title = "raw " + out.raw + " / min raw " + min.raw; } catch (e) { /* title best-effort */ }
        paintMkt(q.out_raw, recvId, s);
      } catch (e) {
        if (s !== seq) return;
        quoteLine.textContent = t("pool.swap_preview_dash", "Quote (preview): —");
        try { quoteLine.title = (e && e.message) ? e.message : ""; } catch (x) { /* gone */ }
        paintMkt(null, recvId, s);
      }
    }
    /* schedule: debounce the preview 400ms (mountFeePreview precedent;
     * resets on each keystroke; timers-unavailable keeps the last line). */
    function schedule() {
      try { if (timer !== null) clearTimeout(timer); } catch (e) { /* gone */ }
      seq++;
      var s = seq;
      try {
        timer = setTimeout(function () { update(s); }, 400);
      } catch (e) { /* timers unavailable: preview stands */ }
    }
    try {
      fSell.input.addEventListener("input", schedule);
      dir.addEventListener("change", schedule);
      fSlip.input.addEventListener("input", schedule);
    } catch (e) { /* preview stays dashed */ }
    schedule();
    u.reviewSection(doc, box, uiGen, t("pool.review_swap", "Review swap"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var sellIsA = dir.value === "A";
        var precSell = precOr5(sellIsA ? r.prec_a : r.prec_b);
        var sellRaw = Format.parseAmount(fSell.input.value.trim(), precSell);
        var q = Pool.quote({ balanceA_raw: r.balance_a_raw, balanceB_raw: r.balance_b_raw, sell_raw: sellRaw, sellIsA: sellIsA });
        var minRaw = Pool.minReceive(q.out_raw, fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT);
        var pair = Pool.buildExchange({ accountId: me.id, poolId: r.id,
          sellHuman: fSell.input.value.trim(), precSell: precSell,
          sellAssetId: sellIsA ? r.asset_a_id : r.asset_b_id,
          minRaw: minRaw, recvAssetId: sellIsA ? r.asset_b_id : r.asset_a_id });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me, q: q, minRaw: minRaw, sellIsA: sellIsA,
          prove: async function () {
            try { var cur = await Pool.get(r.id); return cur.balance_a_raw !== r.balance_a_raw ? cur : null; }
            catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        var precSell = precOr5(R.sellIsA ? r.prec_a : r.prec_b);
        var precRecv = precOr5(R.sellIsA ? r.prec_b : r.prec_a);
        var sell = u.amtText(op.amount_to_sell.amount, op.amount_to_sell.asset_id, precSell, R.sellIsA ? r.sym_a : r.sym_b);
        var min = u.amtText(R.minRaw, op.min_to_receive.asset_id, precRecv, R.sellIsA ? r.sym_b : r.sym_a);
        /* Quote-out formats like Min (principle #6): the same amtText call —
         * raw chain integer as visible text was the bug; raw stays in the
         * title only (ConfirmDialog renders r[2] as dd.title). */
        var out = u.amtText(R.q.out_raw, op.min_to_receive.asset_id, precRecv, R.sellIsA ? r.sym_b : r.sym_a);
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("account.sell_th", "Sell"),  sell.text, "raw " + sell.raw],
          [t("pool.quote_row", "Quote out (raw)"),  out.text, "raw " + out.raw], [t("pool.min_recv_row", "Min to receive"),  min.text, "raw " + min.raw],
          [t("pool.slippage_row", "Slippage"),  String(fSlip.input.value.trim() || Pool.DEFAULT_SLIPPAGE_PCT) + "%"],
          [t("pool.impact_row", "Price impact"),  pctHundredthsText(R.q.impact_bp)],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  networkName()]];
      },
      title: t("pool.confirm_swap", "Confirm swap"), ok: function () { return t("pool.swapped", "Swapped."); }, fail: t("pool.swap_failed", "Could not prepare the swap.") });
  }

  function manageBoxes(doc, box, r, uiGen) { /* op-75 fee edit (withdrawal 0-only) + op-60 owner delete (fee 0) */
    var u = U();
    var fT = u.field(doc, t("pool.taker_field", "New taker fee % (blank = keep)"), { inputmode: "decimal", placeholder: Pool.pctUnitsToHuman(r.taker_units) });
    box.appendChild(fT.row);
    var wSel = doc.createElement("select"); u.touchable(wSel);
    var wKeep = doc.createElement("option"); wKeep.value = ""; wKeep.textContent = t("pool_detail.s3", "Withdrawal fee: keep");
    var wZero = doc.createElement("option"); wZero.value = "0"; wZero.textContent = t("pool_detail.s4", "Withdrawal fee: set 0 (only allowed change)");
    wSel.appendChild(wKeep); wSel.appendChild(wZero); box.appendChild(wSel);
    u.reviewSection(doc, box, uiGen, t("credit.review_update", "Review update"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var t = String(fT.input.value).trim();
        var pair = Pool.buildUpdate({ accountId: me.id, poolId: r.id,
          takerHumanOrNull: t === "" ? null : t, withdrawalZeroOrNull: wSel.value === "" ? null : "0" });
        var op = pair[1];
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try {
              var cur = await Pool.get(r.id);
              if (op.taker_fee_percent !== null && op.taker_fee_percent !== undefined &&
                cur.taker_units !== op.taker_fee_percent) return null;
              if (op.withdrawal_fee_percent !== null && op.withdrawal_fee_percent !== undefined &&
                cur.withdrawal_units !== op.withdrawal_fee_percent) return null;
              return cur;
            } catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1], rows = [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)]];
        if (op.taker_fee_percent !== null && op.taker_fee_percent !== undefined)
          rows.push([t("pool.taker_row", "Taker fee"),  u.pctText(r.taker_units) + " → " + u.pctText(op.taker_fee_percent)]);
        if (op.withdrawal_fee_percent !== null && op.withdrawal_fee_percent !== undefined)
          rows.push([t("pool.withdrawal_row", "Withdrawal fee"),  u.pctText(r.withdrawal_units) + " → 0%"]);
        rows.push([t("misc.note", "Note"),  t("pool.withdrawal_zero_note", "Withdrawal fee can only be set to 0.")]);
        rows.push([t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw]); rows.push([t("borrow.network", "Network"),  networkName()]);
        return rows;
      },
      title: t("pool.confirm_update", "Confirm pool update"), ok: function () { return t("pool.updated", "Pool updated."); }, fail: t("credit.could_not_prepare_the_update", "Could not prepare the update.") });
    u.reviewSection(doc, box, uiGen, t("credit.review_delete", "Review delete"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var pair = Pool.buildDelete({ accountId: me.id, poolId: r.id });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me,
          prove: async function () {
            try { await Pool.get(r.id); return null; } catch (e) { return { gone: true }; } } };
      },
      rows: function (R, fee) {
        return [[ t("pool.pool_row", "Pool"), r.id], [t("account.card_account", "Account"),  whoText(R.me)],
          [t("pool.warning_row", "Warning"),  t("pool.delete_warning", "Delete is owner-only cleanup. Withdraw all liquidity first.")],
          [t("borrow.fee", "Fee"),  fee.text + " (expected 0)", "raw " + fee.raw], [t("borrow.network", "Network"),  networkName()]];
      },
      title: t("pool.confirm_delete", "Confirm pool delete"), ok: function () { return t("pool.deleted", "Pool deleted."); }, fail: t("credit.could_not_prepare_the_delete", "Could not prepare the delete."),
      /* WHY the gate: pool delete is owner-only cleanup that the chain rejects
       * while value sits inside — checkReady runs PoolUI._ui.deleteCheck
       * (poolId = r.id, shareId = r.share_id) at review click and the button
       * stays disabled until the pool reads empty. Never bypass: an enabled
       * delete on a non-empty pool builds a doomed tx. */
      checkReady: function () { return PoolUI._ui.deleteCheck(r.id, r.share_id); } });
  }
  PoolDetailUI._actions.stakeBoxes = stakeBoxes;
  PoolDetailUI._actions.swapInlineBox = swapInlineBox;
  PoolDetailUI._actions.manageBoxes = manageBoxes;
  if (typeof globalThis !== "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
})();

if (typeof module !== "undefined") { module.exports = PoolDetailUI; }
