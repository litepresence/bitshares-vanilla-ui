/* history-summary.js — one-line human summaries for account-history rows.
 * Owns: enrich() (collect ids -> 2 batch joins over a chain-keyed
 *   asset-meta cache boot-seeded from PoolAssets on matching chain_id ->
 *   per-family summarizers -> row._summary), shared amount()/name()
 *   helpers. Label-only fallback for anything unrecognized; enrich never
 *   rejects (degraded rows render as today). No DOM, no signing.
 * Consumes: Chain.db/.call/.status, Format.formatAmount, PoolAssets (optional),
 *   I18n.t (guarded local copy). Exposes global HistorySummary.
 * Created by: history one-liners plan (spec docs/superpowers/specs/2026-10-04-history-one-liners-design.md). */
var HistorySummary = (function () {
  "use strict";
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }
  var ID_RE = /\b1\.(2|3|19)\.\d+\b/g;
  var _assetCache = {}; // "chainId|assetId" -> { sym, prec }

  /* Current chain id string, or null when unreadable (cache stays empty).
   * Accessor is Chain.status().chainId (cf. vanilla/js/sdk/chain.js
   * lastStatus + vanilla/js/api/signmode.js precedent); Chain or
   * Chain.status may be absent, hence the guards. Null falls back to a
   * "|id" cache key, still correct within a session. */
  function chainId() {
    try {
      if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function") {
        var st = Chain.status();
        if (st && typeof st.chainId === "string") return st.chainId;
      }
    } catch (e) { /* null below */ }
    return null;
  }
  /* Seed the cache from the generated table on matching chain only. */
  function seedFromTable(id) {
    try {
      if (typeof PoolAssets === "undefined" || !PoolAssets || !PoolAssets.assets) return;
      if (!id || PoolAssets.chain_id !== id) return;
      var table = PoolAssets.assets, k;
      for (k in table) {
        if (Object.prototype.hasOwnProperty.call(table, k) && table[k]) {
          _assetCache[id + "|" + k] = { sym: String(table[k].sym), prec: table[k].prec };
        }
      }
    } catch (e) { /* live joins cover */ }
  }
  /* Collect every 1.2.x/1.3.x/1.19.x id in the page payloads (generic pass). */
  function collect(rows) {
    var out = { acc: [], asset: [], pool: [] }, seen = {};
    (rows || []).forEach(function (r) {
      var s = "";
      try { s = JSON.stringify(r.op); } catch (e) { s = ""; }
      var m = s.match(ID_RE) || [];
      m.forEach(function (id) {
        if (seen[id]) return; seen[id] = 1;
        if (id.indexOf("1.2.") === 0) out.acc.push(id);
        else if (id.indexOf("1.3.") === 0) out.asset.push(id);
        else out.pool.push(id);
      });
    });
    return out;
  }
  /* Two batch joins; misses stay missing; never throws. */
  async function join(ids, id) {
    var assets = {}, names = {};
    try {
      if (ids.asset.length) {
        var uncached = ids.asset.filter(function (a) { return !(_assetCache[(id || "") + "|" + a]); });
        if (uncached.length) {
          var dbId = await Chain.db();
          var objs = await Chain.call(dbId, "lookup_asset_symbols", [uncached]);
          (objs || []).forEach(function (a) {
            if (a && a.id && typeof a.precision === "number") {
              _assetCache[(id || "") + "|" + a.id] = { sym: a.symbol || a.id, prec: a.precision };
            }
          });
        }
        ids.asset.forEach(function (a) {
          var hit = _assetCache[(id || "") + "|" + a];
          if (hit) assets[a] = hit;
        });
      }
    } catch (e) { /* assets stay missing */ }
    try {
      if (ids.acc.length) {
        var dbId2 = await Chain.db();
        var rows = await Chain.call(dbId2, "get_accounts", [ids.acc]);
        (rows || []).forEach(function (a) { if (a && a.id) names[a.id] = a.name || a.id; });
      }
    } catch (e) { /* names stay missing */ }
    return { assets: assets, names: names };
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
  /* Viewer-side test for tag 0: raw id match OR resolved-name match (the
   * viewed account may arrive in name form, so compare String(viewed)
   * against both p.from and J.names[p.from]). Identifier compare only.
   * @param {any} sideId payload account id. @param {any} viewed enrich's
   *   viewer (id or name form). @param {Object} names id->name join.
   * @returns {boolean} True when the side is the viewer. */
  function isSide(sideId, viewed, names) {
    if (sideId === undefined || sideId === null || viewed === undefined || viewed === null) return false;
    var v = String(viewed), s = String(sideId);
    if (v === s) return true;
    if (names && names[s] && v === String(names[s])) return true;
    return false;
  }
  /* Signed {amount, asset_id} -> "+1.00000 BTS" / "-5.0000 USD" for tag 3
   * deltas (share_type is signed int64; delta_debt may be negative to issue
   * new debt — market.hpp:190). Minus is U+2212 per brief. Em dash on any
   * miss, never raw. @param {any} leg payload asset object.
   * @param {Object} assets asset join. @returns {string} Signed display. */
  function signed(leg, assets) {
    var dash = t("settings.dash", "—");
    if (!leg || leg.amount === undefined || leg.amount === null || !leg.asset_id) return dash;
    var raw = String(leg.amount);
    var neg = raw.charAt(0) === "-";
    var mag = neg ? raw.slice(1) : raw;
    var meta = (assets || {})[String(leg.asset_id)];
    if (!meta || typeof meta.prec !== "number" || !/^\d+$/.test(mag)) return dash;
    try { return (neg ? "−" : "+") + Format.formatAmount(mag, meta.prec) + " " + meta.sym; }
    catch (e) { return dash; }
  }
  /* Op tag number from a history row (same shapes as opTypeOf). */
  function tagOf(row) {
    if (!row || typeof row !== "object") return null;
    if (Array.isArray(row.op) && typeof row.op[0] === "number") return row.op[0];
    if (typeof row.op_type === "number") return row.op_type;
    if (typeof row.type === "number") return row.type;
    return null;
  }
  /* Family summarizers (Tasks 3-5 table): payload + joins + viewer ->
   * human one-liner, or null when the payload is unusable (caller keeps the
   * op label). Field paths verified against reference #4
   * (bitshares-core/libraries/protocol); #4 wins conflicts — notably tag 77
   * limit_order_update carries seller/order + optional new_price/delta, NOT
   * tag 1's sell/buy legs, so it summarizes the order id only. */
  /* Tag 0 transfer (transfer.hpp:45): direction vs the viewer, id or name
   * form; strangers see the generic three-party line. */
  function sumTransfer(p, J, viewed) {
    if (!p || !p.amount || p.from === undefined || p.to === undefined) return null;
    var amt = amount(p.amount, J.assets);
    var fromIs = isSide(p.from, viewed, J.names);
    var toIs = isSide(p.to, viewed, J.names);
    if (fromIs && !toIs) {
      return t("account.sum_transfer_send", "Sent %(amount)s to %(to)s",
        { amount: amt, to: name(p.to, J.names) });
    }
    if (toIs && !fromIs) {
      return t("account.sum_transfer_recv", "Received %(amount)s from %(from)s",
        { amount: amt, from: name(p.from, J.names) });
    }
    return t("account.sum_transfer", "Transfer %(amount)s from %(from)s to %(to)s",
      { amount: amt, from: name(p.from, J.names), to: name(p.to, J.names) });
  }
  /* Tag 1 limit_order_create (market.hpp:72): sell leg + minimum buy leg. */
  function sumOrderCreate(p, J) {
    if (!p || !p.amount_to_sell || !p.min_to_receive) return null;
    return t("account.sum_order_create", "Offered %(sell)s for at least %(buy)s",
      { sell: amount(p.amount_to_sell, J.assets), buy: amount(p.min_to_receive, J.assets) });
  }
  /* Tag 2 limit_order_cancel (market.hpp:145): order id stays raw (1.7.x
   * ids are identifiers, and the id join only covers 1.2/1.3/1.19). */
  function sumOrderCancel(p) {
    if (!p || !p.order) return null;
    return t("account.sum_order_cancel", "Cancelled order %(order)s", { order: String(p.order) });
  }
  /* Tag 77 limit_order_update (market.hpp:117): order id only (see note). */
  function sumOrderUpdate(p) {
    if (!p || !p.order) return null;
    return t("account.sum_order_update", "Updated order %(order)s", { order: String(p.order) });
  }
  /* Tag 3 call_order_update (market.hpp:171): SIGNED collateral/debt legs. */
  function sumCallUpdate(p, J) {
    if (!p || !p.delta_collateral || !p.delta_debt) return null;
    return t("account.sum_call_update", "Adjusted position: %(coll)s collateral, %(debt)s debt",
      { coll: signed(p.delta_collateral, J.assets), debt: signed(p.delta_debt, J.assets) });
  }
  /* Tag 4 fill_order, virtual (market.hpp:206): pays/receives legs. */
  function sumFill(p, J) {
    if (!p || !p.pays || !p.receives) return null;
    return t("account.sum_fill", "Filled: paid %(pays)s, received %(receives)s",
      { pays: amount(p.pays, J.assets), receives: amount(p.receives, J.assets) });
  }
  /* Tag 19 asset_publish_feed (asset_ops.hpp:462): symbol from the asset
   * join (payload carries the bare asset_id), publisher named. */
  function sumFeed(p, J) {
    if (!p || !p.publisher || !p.asset_id) return null;
    var meta = (J.assets || {})[String(p.asset_id)];
    return t("account.sum_feed", "Feed published for %(asset)s by %(publisher)s",
      { asset: meta ? meta.sym : String(p.asset_id), publisher: name(p.publisher, J.names) });
  }
  /* Tag 6 account_update (account.hpp:136): account only; no field claims
   * beyond it (options/authorities changes render in raw JSON). */
  function sumAccountUpdate(p, J) {
    if (!p || !p.account) return null;
    return t("account.sum_account_update", "Account updated: %(account)s",
      { account: name(p.account, J.names) });
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
  /* Family dispatch table is filled by Tasks 3-5; unknown -> no summary. */
  var SUMMARIZERS = {
    0: sumTransfer,
    1: sumOrderCreate,
    2: sumOrderCancel,
    77: sumOrderUpdate,
    3: sumCallUpdate,
    4: sumFill,
    19: sumFeed,
    6: sumAccountUpdate,
    59: sumPoolCreate,
    60: sumPoolDelete,
    61: sumPoolDeposit,
    62: sumPoolWithdraw,
    63: sumPoolSwap,
    75: sumPoolUpdate,
    10: sumAssetCreate,
    11: sumAssetUpdate,
    48: sumIssuerUpdate,
    12: sumSmartcoinUpdate,
    13: sumFeedProducers,
    14: sumAssetIssue,
    15: sumAssetBurn,
    16: sumFeePoolFund,
    17: sumAssetSettle,
    18: sumGlobalSettle,
    42: sumSettleCancel,
    43: sumClaimFees,
    47: sumClaimFees,
    64: sumSametCreate,
    65: sumSametDelete,
    66: sumSametUpdate,
    67: sumSametBorrow,
    68: sumSametRepay,
    69: sumOfferCreate,
    70: sumOfferDelete,
    71: sumOfferUpdate,
    72: sumOfferAccept,
    73: sumDealRepay,
    74: sumDealExpired,
    76: sumDealUpdate,
    25: sumDebitCreate,
    26: sumDebitUpdate,
    27: sumDebitClaim,
    28: sumDebitDelete
  };
  /* Enrich rows in place (adds _summary); never rejects. */
  async function enrich(rows, viewedAcctId) {
    try {
      var id = chainId();
      seedFromTable(id);
      var ids = collect(rows);
      var J = await join(ids, id);
      (rows || []).forEach(function (r) {
        try {
          var tag = tagOf(r);
          var fn = (tag !== null && SUMMARIZERS[tag]) || null;
          if (fn) {
            var s = fn(r.op && r.op[1], J, viewedAcctId);
            if (typeof s === "string" && s) r._summary = s;
          }
        } catch (e) { /* label-only fallback stands */ }
      });
    } catch (e) { /* rows render as today */ }
    return rows;
  }
  return { enrich: enrich, _test: { collect: collect, amount: amount, name: name, tagOf: tagOf, SUMMARIZERS: SUMMARIZERS } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.HistorySummary === "undefined") { globalThis.HistorySummary = HistorySummary; }
if (typeof module !== "undefined") { module.exports = HistorySummary; }
