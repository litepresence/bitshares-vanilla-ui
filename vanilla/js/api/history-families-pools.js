/* history-families-pools.js — Task 4 pool/asset/credit/Same-T/debit summarizers
 * (pools 59-63/75, assets 10-18/42/43/47/48, Same-T 64-68, credit 69-76,
 * debit 25-28).
 * Owns: the 34 per-tag summarizers + verbatim copies of the t/amount/name/
 *   sym/bare helpers they call (same per-file convention as the market-desk
 *   splits: duplicated so moved bodies stay byte-identical — doctrine prefers
 *   duplication over a shared helper abstraction). Field-path conflicts with
 *   the brief travel with the bodies below (#4 wins, Task 3 tag-77 style).
 *   Attaches its entries to HistorySummary.SUMMARIZERS (created here if
 *   absent); the history-summary.js facade (tagged AFTER this file) keeps the
 *   registry by reference. No DOM, no signing.
 * Consumes: Format.formatAmount, I18n.t (both via the local verbatim copies).
 *   Globals/side effects: attaches HistorySummary.SUMMARIZERS[*] and
 *   republishes globalThis.HistorySummary.
 * Split from history-summary.js by tooling/split_history_summary.py (mechanical
 *   move, zero behavior change). Facade: history-summary.js. */
var HistorySummary = (typeof globalThis !== "undefined" && globalThis.HistorySummary) ? globalThis.HistorySummary : ((typeof HistorySummary !== "undefined") ? HistorySummary : {});
HistorySummary.SUMMARIZERS = HistorySummary.SUMMARIZERS || {};
(function () {
  "use strict";

  /* Verbatim copies of history-summary.js t/amount/name/sym/bare (same per-file convention as the market-desk splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared helper abstraction. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* {amount, asset_id} -> human string or em dash (never raw). */
  function amount(leg, assets) {
    if (!leg || leg.amount === undefined || leg.amount === null || !leg.asset_id) return t("settings.dash", "—");
    var meta = (assets || {})[String(leg.asset_id)];
    if (!meta || typeof meta.prec !== "number" || !/^-?\d+$/.test(String(leg.amount))) return t("settings.dash", "—");
    try { return Format.formatAmount(String(leg.amount), meta.prec) + " " + meta.sym; }
    catch (e) { return t("settings.dash", "—"); }
  }

  /* Account id -> name or raw id (identifiers may show raw; money may not). */
  function name(id, names) { return (names && names[id]) || String(id); }

  /* Asset id -> symbol or raw id (symbols come from the asset join;
   * identifiers may show raw; money may not). @param {any} id asset id.
   * @param {Object} assets asset join. @returns {string} Symbol or raw id. */
  function sym(id, assets) {
    var meta = (assets || {})[String(id)];
    return meta ? meta.sym : String(id);
  }

  /* Bare integer + separate asset id -> human string or em dash (never raw).
   * For fee-pool funding and SameT balances the chain stores a bare share_type
   * plus an asset id in another field; pair them explicitly here instead of
   * guessing. @param {any} raw bare integer (string or number).
   * @param {any} id asset id. @param {Object} assets asset join.
   * @returns {string} Human amount or em dash. */
  function bare(raw, id, assets) {
    if (raw === undefined || raw === null || id === undefined || id === null) {
      return t("settings.dash", "—");
    }
    return amount({ amount: String(raw), asset_id: String(id) }, assets);
  }

  /* Task 4 families below. Field paths verified against reference #4
   * (bitshares-core/libraries/protocol); #4 wins conflicts:
   * - samet borrow (samet_fund.hpp:94-107) carries borrower/fund_id/
   *   borrow_amount with NO collateral leg, and repay (samet_fund.hpp:113-127)
   *   carries account/fund_id/repay_amount + fund_fee, also no collateral —
   *   so samet templates show the fund id only. The brief's
   *   "Borrowed %(amount)s against %(coll)s (fund %(fund)s)" example describes
   *   credit accept (tag 72, credit_offer.hpp:135-157), not samet.
   * - debit ops have no p.from field; all four tags use withdraw_from_account
   *   (withdraw_permission.hpp:50-167). Claim renders amount_to_withdraw (not
   *   withdrawal_limit) and needs no account var.
   * - tag 15 is asset_reserve_operation (operations.hpp:71); the op label
   *   calls it a burn, hence the sum_asset_burn key.
   * - fee-pool funding (asset_ops.hpp:322-334): amount is CORE asset
   *   ("core asset" comment), so it pairs with 1.3.0 explicitly — never with
   *   p.asset_id, which names the funded pool's asset.
   * - pool withdraw (liquidity_pool.hpp:114-125): the payload carries NO pool
   *   share id, so the share symbol comes from the amount's own asset_id.
   * - issuer update (asset_ops.hpp:565-586): %(issuer)s is new_issuer (the
   *   operation's point); p.issuer is the old fee-payer.
   * - tags 43 + 47 share sum_claim_fees (both carry amount_to_claim; 47's is
   *   core BTS per asset_ops.hpp:601-615). Pool/offer/deal/fund/permission ids
   *   (1.12/1.19-1.22.x) render raw — identifiers may show raw; money never. */
  /* Tag 59 pool_create (liquidity_pool.hpp:34-48): asset ids -> symbols. */
  function sumPoolCreate(p, J) {
    if (!p || !p.asset_a || !p.asset_b) return null;
    return t("account.sum_pool_create", "Created pool %(a)s / %(b)s",
      { a: sym(p.asset_a, J.assets), b: sym(p.asset_b, J.assets) });
  }

  /* Tag 60 pool_delete (liquidity_pool.hpp:56-67): pool id stays raw. */
  function sumPoolDelete(p) {
    if (!p || !p.pool) return null;
    return t("account.sum_pool_delete", "Deleted pool %(pool)s", { pool: String(p.pool) });
  }

  /* Tag 61 pool_deposit (liquidity_pool.hpp:94-110): both staked legs. */
  function sumPoolDeposit(p, J) {
    if (!p || !p.pool || !p.amount_a || !p.amount_b) return null;
    return t("account.sum_pool_deposit", "Staked %(a)s + %(b)s in pool %(pool)s",
      { a: amount(p.amount_a, J.assets), b: amount(p.amount_b, J.assets), pool: String(p.pool) });
  }

  /* Tag 62 pool_withdraw (liquidity_pool.hpp:114-125): share leg carries its
   * own (share) asset_id. */
  function sumPoolWithdraw(p, J) {
    if (!p || !p.pool || !p.share_amount) return null;
    return t("account.sum_pool_withdraw", "Unstaked %(shares)s from pool %(pool)s",
      { shares: amount(p.share_amount, J.assets), pool: String(p.pool) });
  }

  /* Tag 63 pool_exchange (liquidity_pool.hpp:138-150): sell + minimum leg. */
  function sumPoolSwap(p, J) {
    if (!p || !p.pool || !p.amount_to_sell || !p.min_to_receive) return null;
    return t("account.sum_pool_swap", "Swapped %(sell)s → at least %(buy)s in pool %(pool)s",
      { sell: amount(p.amount_to_sell, J.assets), buy: amount(p.min_to_receive, J.assets),
        pool: String(p.pool) });
  }

  /* Tag 75 pool_update (liquidity_pool.hpp:74-86): pool id only. */
  function sumPoolUpdate(p) {
    if (!p || !p.pool) return null;
    return t("account.sum_pool_update", "Updated pool %(pool)s", { pool: String(p.pool) });
  }

  /* Tag 10 asset_create (asset_ops.hpp:192-226): symbol is inline, no join. */
  function sumAssetCreate(p) {
    if (!p || typeof p.symbol !== "string" || !p.symbol) return null;
    return t("account.sum_asset_create", "Created asset %(symbol)s", { symbol: p.symbol });
  }

  /* Tag 11 asset_update (asset_ops.hpp:351-382): symbol via join. */
  function sumAssetUpdate(p, J) {
    if (!p || !p.asset_to_update) return null;
    return t("account.sum_asset_update", "Updated asset %(asset)s",
      { asset: sym(p.asset_to_update, J.assets) });
  }

  /* Tag 48 issuer_update (asset_ops.hpp:565-586): new issuer named. */
  function sumIssuerUpdate(p, J) {
    if (!p || !p.asset_to_update || !p.new_issuer) return null;
    return t("account.sum_issuer_update", "New issuer for %(asset)s: %(issuer)s",
      { asset: sym(p.asset_to_update, J.assets), issuer: name(p.new_issuer, J.names) });
  }

  /* Tag 12 smartcoin_update (asset_ops.hpp:398-411): symbol via join. */
  function sumSmartcoinUpdate(p, J) {
    if (!p || !p.asset_to_update) return null;
    return t("account.sum_smartcoin_update", "Updated smartcoin %(asset)s",
      { asset: sym(p.asset_to_update, J.assets) });
  }

  /* Tag 13 feed_producers (asset_ops.hpp:430-443): count of the new set. */
  function sumFeedProducers(p, J) {
    if (!p || !p.asset_to_update || p.new_feed_producers === undefined || p.new_feed_producers === null) {
      return null;
    }
    var list = p.new_feed_producers, n;
    if (Object.prototype.toString.call(list) === "[object Array]") n = list.length;
    else if (typeof list === "object") {
      n = 0;
      for (var k in list) { if (Object.prototype.hasOwnProperty.call(list, k)) n++; }
    } else return null;
    return t("account.sum_feed_producers", "Set %(n)s feed producers for %(asset)s",
      { n: String(n), asset: sym(p.asset_to_update, J.assets) });
  }

  /* Tag 14 asset_issue (asset_ops.hpp:485-505): amount leg + recipient. */
  function sumAssetIssue(p, J) {
    if (!p || !p.asset_to_issue || !p.issue_to_account) return null;
    return t("account.sum_asset_issue", "Issued %(amount)s to %(to)s",
      { amount: amount(p.asset_to_issue, J.assets), to: name(p.issue_to_account, J.names) });
  }

  /* Tag 15 asset_reserve (asset_ops.hpp:513-524, labeled a burn). */
  function sumAssetBurn(p, J) {
    if (!p || !p.amount_to_reserve) return null;
    return t("account.sum_asset_burn", "Burned %(amount)s",
      { amount: amount(p.amount_to_reserve, J.assets) });
  }

  /* Tag 16 fee_pool_fund (asset_ops.hpp:322-334): bare CORE amount + pool asset. */
  function sumFeePoolFund(p, J) {
    if (!p || p.asset_id === undefined || p.asset_id === null ||
        p.amount === undefined || p.amount === null) return null;
    return t("account.sum_fee_pool_fund", "Funded fee pool of %(asset)s with %(amount)s",
      { asset: sym(p.asset_id, J.assets), amount: bare(p.amount, "1.3.0", J.assets) });
  }

  /* Tag 17 asset_settle (asset_ops.hpp:267-288): settlement amount leg. */
  function sumAssetSettle(p, J) {
    if (!p || !p.amount) return null;
    return t("account.sum_asset_settle", "Requested settlement of %(amount)s",
      { amount: amount(p.amount, J.assets) });
  }

  /* Tag 18 global_settle (asset_ops.hpp:238-250): settled asset via join. */
  function sumGlobalSettle(p, J) {
    if (!p || !p.asset_to_settle) return null;
    return t("account.sum_global_settle", "Globally settled %(asset)s",
      { asset: sym(p.asset_to_settle, J.assets) });
  }

  /* Tag 42 settle_cancel, virtual (asset_ops.hpp:293-317): amount leg. */
  function sumSettleCancel(p, J) {
    if (!p || !p.amount) return null;
    return t("account.sum_settle_cancel", "Cancelled settlement of %(amount)s",
      { amount: amount(p.amount, J.assets) });
  }

  /* Tags 43 claim_fees (asset_ops.hpp:529-553) + 47 claim_pool
   * (asset_ops.hpp:601-615): claimed-fees leg (47's is core BTS). */
  function sumClaimFees(p, J) {
    if (!p || !p.amount_to_claim) return null;
    return t("account.sum_claim_fees", "Claimed %(amount)s in fees",
      { amount: amount(p.amount_to_claim, J.assets) });
  }

  /* Tag 64 samet_create (samet_fund.hpp:36-50): bare balance + asset type. */
  function sumSametCreate(p, J) {
    if (!p || p.asset_type === undefined || p.asset_type === null ||
        p.balance === undefined || p.balance === null) return null;
    return t("account.sum_samet_create", "Created SameT fund with %(amount)s",
      { amount: bare(p.balance, p.asset_type, J.assets) });
  }

  /* Tag 65 samet_delete (samet_fund.hpp:56-68): fund id stays raw. */
  function sumSametDelete(p) {
    if (!p || !p.fund_id) return null;
    return t("account.sum_samet_delete", "Deleted SameT fund %(fund)s", { fund: String(p.fund_id) });
  }

  /* Tag 66 samet_update (samet_fund.hpp:74-88): fund id only. */
  function sumSametUpdate(p) {
    if (!p || !p.fund_id) return null;
    return t("account.sum_samet_update", "Updated SameT fund %(fund)s", { fund: String(p.fund_id) });
  }

  /* Tag 67 samet_borrow (samet_fund.hpp:94-107): borrow leg + fund id. */
  function sumSametBorrow(p, J) {
    if (!p || !p.fund_id || !p.borrow_amount) return null;
    return t("account.sum_samet_borrow", "Borrowed %(amount)s from fund %(fund)s",
      { amount: amount(p.borrow_amount, J.assets), fund: String(p.fund_id) });
  }

  /* Tag 68 samet_repay (samet_fund.hpp:113-127): repay leg + fund id. */
  function sumSametRepay(p, J) {
    if (!p || !p.fund_id || !p.repay_amount) return null;
    return t("account.sum_samet_repay", "Repaid %(amount)s to fund %(fund)s",
      { amount: amount(p.repay_amount, J.assets), fund: String(p.fund_id) });
  }

  /* Tag 69 offer_create (credit_offer.hpp:36-64): offer asset via join. */
  function sumOfferCreate(p, J) {
    if (!p || p.asset_type === undefined || p.asset_type === null) return null;
    return t("account.sum_offer_create", "Created credit offer in %(asset)s",
      { asset: sym(p.asset_type, J.assets) });
  }

  /* Tag 70 offer_delete (credit_offer.hpp:70-82): offer id stays raw. */
  function sumOfferDelete(p) {
    if (!p || !p.offer_id) return null;
    return t("account.sum_offer_delete", "Deleted offer %(offer)s", { offer: String(p.offer_id) });
  }

  /* Tag 71 offer_update (credit_offer.hpp:88-116): offer id only. */
  function sumOfferUpdate(p) {
    if (!p || !p.offer_id) return null;
    return t("account.sum_offer_update", "Updated offer %(offer)s", { offer: String(p.offer_id) });
  }

  /* Tag 72 offer_accept (credit_offer.hpp:135-157): borrow + collateral legs. */
  function sumOfferAccept(p, J) {
    if (!p || !p.offer_id || !p.borrow_amount || !p.collateral) return null;
    return t("account.sum_offer_accept", "Borrowed %(amount)s against %(coll)s (offer %(offer)s)",
      { amount: amount(p.borrow_amount, J.assets), coll: amount(p.collateral, J.assets),
        offer: String(p.offer_id) });
  }

  /* Tag 73 deal_repay (credit_offer.hpp:163-177): repay leg + deal id. */
  function sumDealRepay(p, J) {
    if (!p || !p.deal_id || !p.repay_amount) return null;
    return t("account.sum_deal_repay", "Repaid %(amount)s on deal %(deal)s",
      { amount: amount(p.repay_amount, J.assets), deal: String(p.deal_id) });
  }

  /* Tag 74 deal_expired, virtual (credit_offer.hpp:184-209): deal id only. */
  function sumDealExpired(p) {
    if (!p || !p.deal_id) return null;
    return t("account.sum_deal_expired", "Deal %(deal)s expired", { deal: String(p.deal_id) });
  }

  /* Tag 76 deal_update (credit_offer.hpp:216-228): deal id only. */
  function sumDealUpdate(p) {
    if (!p || !p.deal_id) return null;
    return t("account.sum_deal_update", "Updated deal %(deal)s", { deal: String(p.deal_id) });
  }

  /* Tag 25 debit_create (withdraw_permission.hpp:50-70): limit + grantee. */
  function sumDebitCreate(p, J) {
    if (!p || !p.authorized_account || !p.withdrawal_limit) return null;
    return t("account.sum_debit_create", "Authorized %(amount)s debit for %(to)s",
      { amount: amount(p.withdrawal_limit, J.assets), to: name(p.authorized_account, J.names) });
  }

  /* Tag 26 debit_update (withdraw_permission.hpp:83-105): new limit + grantee. */
  function sumDebitUpdate(p, J) {
    if (!p || !p.authorized_account || !p.withdrawal_limit) return null;
    return t("account.sum_debit_update", "Updated %(amount)s debit for %(to)s",
      { amount: amount(p.withdrawal_limit, J.assets), to: name(p.authorized_account, J.names) });
  }

  /* Tag 27 debit_claim (withdraw_permission.hpp:120-143): withdrawn leg. */
  function sumDebitClaim(p, J) {
    if (!p || !p.amount_to_withdraw) return null;
    return t("account.sum_debit_claim", "Claimed %(amount)s debit",
      { amount: amount(p.amount_to_withdraw, J.assets) });
  }

  /* Tag 28 debit_delete (withdraw_permission.hpp:153-167): permission id raw. */
  function sumDebitDelete(p) {
    if (!p || !p.withdrawal_permission) return null;
    return t("account.sum_debit_delete", "Deleted debit permission %(perm)s",
      { perm: String(p.withdrawal_permission) });
  }

  HistorySummary.SUMMARIZERS[59] = sumPoolCreate;
  HistorySummary.SUMMARIZERS[60] = sumPoolDelete;
  HistorySummary.SUMMARIZERS[61] = sumPoolDeposit;
  HistorySummary.SUMMARIZERS[62] = sumPoolWithdraw;
  HistorySummary.SUMMARIZERS[63] = sumPoolSwap;
  HistorySummary.SUMMARIZERS[75] = sumPoolUpdate;
  HistorySummary.SUMMARIZERS[10] = sumAssetCreate;
  HistorySummary.SUMMARIZERS[11] = sumAssetUpdate;
  HistorySummary.SUMMARIZERS[48] = sumIssuerUpdate;
  HistorySummary.SUMMARIZERS[12] = sumSmartcoinUpdate;
  HistorySummary.SUMMARIZERS[13] = sumFeedProducers;
  HistorySummary.SUMMARIZERS[14] = sumAssetIssue;
  HistorySummary.SUMMARIZERS[15] = sumAssetBurn;
  HistorySummary.SUMMARIZERS[16] = sumFeePoolFund;
  HistorySummary.SUMMARIZERS[17] = sumAssetSettle;
  HistorySummary.SUMMARIZERS[18] = sumGlobalSettle;
  HistorySummary.SUMMARIZERS[42] = sumSettleCancel;
  HistorySummary.SUMMARIZERS[43] = sumClaimFees;
  HistorySummary.SUMMARIZERS[47] = sumClaimFees;
  HistorySummary.SUMMARIZERS[64] = sumSametCreate;
  HistorySummary.SUMMARIZERS[65] = sumSametDelete;
  HistorySummary.SUMMARIZERS[66] = sumSametUpdate;
  HistorySummary.SUMMARIZERS[67] = sumSametBorrow;
  HistorySummary.SUMMARIZERS[68] = sumSametRepay;
  HistorySummary.SUMMARIZERS[69] = sumOfferCreate;
  HistorySummary.SUMMARIZERS[70] = sumOfferDelete;
  HistorySummary.SUMMARIZERS[71] = sumOfferUpdate;
  HistorySummary.SUMMARIZERS[72] = sumOfferAccept;
  HistorySummary.SUMMARIZERS[73] = sumDealRepay;
  HistorySummary.SUMMARIZERS[74] = sumDealExpired;
  HistorySummary.SUMMARIZERS[76] = sumDealUpdate;
  HistorySummary.SUMMARIZERS[25] = sumDebitCreate;
  HistorySummary.SUMMARIZERS[26] = sumDebitUpdate;
  HistorySummary.SUMMARIZERS[27] = sumDebitClaim;
  HistorySummary.SUMMARIZERS[28] = sumDebitDelete;
  if (typeof globalThis !== "undefined") { globalThis.HistorySummary = HistorySummary; }
})();

if (typeof module !== "undefined") { module.exports = HistorySummary; }
