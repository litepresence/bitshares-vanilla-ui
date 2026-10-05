/* history-families-trade.js — Task 3 daily-eight summarizers (transfer direction,
 * limit orders 1/2/77, call update 3, fill 4, feed 19, account update 6).
 * Owns: sumTransfer/sumOrderCreate/sumOrderCancel/sumOrderUpdate/sumCallUpdate/
 *   sumFill/sumFeed/sumAccountUpdate + verbatim copies of the t/amount/name/
 *   isSide/signed helpers they call (same per-file convention as the
 *   market-desk splits: duplicated so moved bodies stay byte-identical —
 *   doctrine prefers duplication over a shared helper abstraction).
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

  /* Verbatim copies of history-summary.js t/amount/name/isSide/signed (same per-file convention as the market-desk splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared helper abstraction. */
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

  HistorySummary.SUMMARIZERS[0] = sumTransfer;
  /* Tag 38 override_transfer (transfer.hpp:77-100, reflected
   * transfer.hpp:107 with (fee)(issuer)(from)(to)(amount)(memo)(extensions)):
   * same from/to/amount shape as tag 0 plus the issuer leg, so the transfer
   * summarizer applies verbatim — zero new keys. Task 6 leftover. */
  HistorySummary.SUMMARIZERS[38] = sumTransfer;
  HistorySummary.SUMMARIZERS[1] = sumOrderCreate;
  HistorySummary.SUMMARIZERS[2] = sumOrderCancel;
  HistorySummary.SUMMARIZERS[77] = sumOrderUpdate;
  HistorySummary.SUMMARIZERS[3] = sumCallUpdate;
  HistorySummary.SUMMARIZERS[4] = sumFill;
  HistorySummary.SUMMARIZERS[19] = sumFeed;
  HistorySummary.SUMMARIZERS[6] = sumAccountUpdate;
  if (typeof globalThis !== "undefined") { globalThis.HistorySummary = HistorySummary; }
})();

if (typeof module !== "undefined") { module.exports = HistorySummary; }
