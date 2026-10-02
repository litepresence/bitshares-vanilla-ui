/* Prediction: pure PMA status/countdown/cost-basis helpers (no DOM, no socket).
 * Owns: settlement detection via bitasset settlement_price null-check (#4
 *   wins), Active/Expired/Settled classification with boundary expiry==now
 *   staying Active, closing-soon sort, expiry countdown parts/text (pure
 *   time math, never money), fill-history cost-basis sums (integer-string
 *   BigInt only; display conversions stay in Format). No reads, no signing.
 * Consumes: nothing (Format only at the caller's display layer, never here
 *   — this file stays dependency-free so node vectors require it alone).
 * Globals/side effects: exposes global Prediction only; Node guard via
 *   module.exports. Created by: prediction-portfolio task 2026-10-02.
 * CHAIN TRUTH (#4 wins): is_globally_settled() = !settlement_price.is_null()
 *   <- chain/asset_object.hpp:299 (price object with both legs nonzero).
 *   #1 uses settlement_fund>0 only (PredictionMarkets.jsx:419, Asset.jsx:815);
 *   #2 uses price-nonzero AND fund-nonzero (Smartcoins.jsx:221-228); #4's
 *   price null-check wins — fund>0 is kept as a corroborating OR (a settled
 *   market always has both; a node omitting one leg must not hide it).
 *   fill_order legs (pays/receives/fill_price) <- protocol/market.hpp:206-220
 *   + FC :305-306; get_account_history pages via Account.historyPaged (same
 *   WS method, no new chain surface); ticker latest = base-per-quote human
 *   (market.js header) with base=backing quote=PMA for the desk pair.
 */
var Prediction = (function () {
  "use strict";

  var INT_RE = /^\d+$/;

  /* True for digit-only raw-int strings (unsigned; chain amounts >= 0). */
  function _isIntStr(s) {
    return typeof s === "string" && INT_RE.test(s);
  }

  /* Bitasset settled? #4 wins: settlement_price non-null with both legs
   * nonzero. Fund>0 corroborates (OR): #1's lone signal, #2's second half.
   * Params: bitasset object or null. Returns boolean, never throws. */
  function isSettledBitasset(b) {
    try {
      if (!b || typeof b !== "object") return false;
      var sp = b.settlement_price;
      if (sp && typeof sp === "object") {
        var base = sp.base, quote = sp.quote;
        var bAmt = base && base.amount !== undefined && base.amount !== null ? String(base.amount) : null;
        var qAmt = quote && quote.amount !== undefined && quote.amount !== null ? String(quote.amount) : null;
        if (_isIntStr(bAmt) && _isIntStr(qAmt) && bAmt !== "0" && qAmt !== "0") return true;
      }
      var fund = b.settlement_fund;
      if (fund !== undefined && fund !== null) {
        var f = String(fund);
        if (_isIntStr(f) && f !== "0" && BigInt(f) > 0n) return true;
        /* Numeric fund (node JSON number, safe-int only). */
        if (typeof fund === "number" && Number.isSafeInteger(fund) && fund > 0) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /* Parse an expiry ISO string to ms, or null when missing/unparseable.
   * Params: expiryIso string or falsy. Returns ms number or null. */
  function expiryMs(expiryIso) {
    if (typeof expiryIso !== "string" || !expiryIso) return null;
    var ms = Date.parse(expiryIso);
    return Number.isFinite(ms) ? ms : null;
  }

  /* Status for one PMA row: "settled" wins over expiry; "expired" only when
   * past expiry AND unsettled; boundary expiry==now stays "active" (strict
   * <, never <=). Missing/unparseable expiry with no settlement => "active"
   * (no date to be past). Params: {expiryIso, nowMs, settled boolean}.
   * Returns the status string. Never throws. */
  function classifyStatus(args) {
    try {
      args = args || {};
      if (args.settled === true) return "settled";
      var now = (typeof args.nowMs === "number" && Number.isFinite(args.nowMs)) ? args.nowMs : Date.now();
      var exp = expiryMs(args.expiryIso);
      if (exp === null) return "active";
      return (exp < now) ? "expired" : "active";
    } catch (e) {
      return "active";
    }
  }

  /* Closing-soon sort: ascending expiry ms, missing/unparseable last (stable,
   * input untouched). Params: rows array with .expiryIso or .expiry string.
   * Returns a NEW sorted array. Never throws. */
  function sortClosingSoon(rows) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    function key(r) {
      var v = null;
      if (r && typeof r === "object") v = (r.expiryIso !== undefined && r.expiryIso !== null) ? r.expiryIso : r.expiry;
      var ms = expiryMs(typeof v === "string" ? v : "");
      return ms;
    }
    list.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      if (ka === null && kb === null) return 0;
      if (ka === null) return 1;
      if (kb === null) return -1;
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return 0;
    });
    return list;
  }

  /* Countdown parts for an expiry ISO at nowMs (pure time math, never money).
   * Params: expiryIso string, nowMs number (defaults Date.now()).
   * Returns {state ("none"|"expired"|"now"|"future"), diffMs, days, hours,
   *   mins, secs}. "none" when no parseable expiry; "now" when diff==0;
   *   "expired" when diff<0; "future" otherwise. Never throws. */
  function countdownParts(expiryIso, nowMs) {
    try {
      var now = (typeof nowMs === "number" && Number.isFinite(nowMs)) ? nowMs : Date.now();
      var exp = expiryMs(expiryIso);
      if (exp === null) return { state: "none", diffMs: 0, days: 0, hours: 0, mins: 0, secs: 0 };
      var diff = exp - now;
      if (diff === 0) return { state: "now", diffMs: 0, days: 0, hours: 0, mins: 0, secs: 0 };
      if (diff < 0) {
        var ago = -diff, s = Math.floor(ago / 1000);
        return { state: "expired", diffMs: diff,
          days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600),
          mins: Math.floor((s % 3600) / 60), secs: s % 60 };
      }
      var f = Math.floor(diff / 1000);
      return { state: "future", diffMs: diff,
        days: Math.floor(f / 86400), hours: Math.floor((f % 86400) / 3600),
        mins: Math.floor((f % 3600) / 60), secs: f % 60 };
    } catch (e) {
      return { state: "none", diffMs: 0, days: 0, hours: 0, mins: 0, secs: 0 };
    }
  }

  /* Shaping for countdown parts (English time units, deterministic for
   * vectors; the view wraps it in t() labels). Rules: none->"No expiry";
   * now->"Closes now"; expired->"Expired … ago" with the largest nonzero
   * unit (e.g. "Expired 2d ago", "Expired 3h ago", "Expired 5m ago",
   * "Expired 10s ago"); future-> largest two units ("2d 3h", "3h 5m",
   * "5m 10s", "10s", "1d"). Zero-past with all units zero (sub-second
   * future) shapes "1s"? No: future diff<1000ms has secs 0 -> "0s". Keep
   * honest: "<1s" never invented; "0s" stands for sub-second futures.
   * Params: parts from countdownParts(). Returns the string. Never throws. */
  function countdownText(parts) {
    try {
      parts = parts || {};
      if (parts.state === "none") return "No expiry";
      if (parts.state === "now") return "Closes now";
      function two(d, h, m, s) {
        if (d > 0) return h > 0 ? d + "d " + h + "h" : d + "d";
        if (h > 0) return m > 0 ? h + "h " + m + "m" : h + "h";
        if (m > 0) return s > 0 ? m + "m " + s + "s" : m + "m";
        return s + "s";
      }
      var body = two(parts.days || 0, parts.hours || 0, parts.mins || 0, parts.secs || 0);
      if (parts.state === "expired") return "Expired " + body + " ago";
      return body;
    } catch (e) {
      return "No expiry";
    }
  }

  /* Unwrap one get_account_history row to its operation_history_object
   * (nodes return either the object or a [seq, object] pair — same rule as
   * Account._unwrapHist, duplicated per doctrine). Params: r raw row.
   * Returns the object or null. */
  function _unwrapHist(r) {
    if (Array.isArray(r)) {
      var i, c;
      for (i = 0; i < r.length; i++) {
        c = r[i];
        if (c && typeof c === "object" && !Array.isArray(c) && c.op) return c;
      }
      if (r[1] && typeof r[1] === "object" && !Array.isArray(r[1])) return r[1];
      return null;
    }
    return (r && typeof r === "object") ? r : null;
  }

  /* Cost basis from fill history for one PMA (integer-string BigInt sums,
   * no float). Accepts raw history rows (either envelope) OR unwrapped
   * fill bodies; non-fill ops and malformed legs are skipped (never throw
   * on chain data). Buys (receives PMA) add received+paid; sells (pays PMA)
   * subtract to net (proceeds in the same cost asset). Mixed cost assets
   * (buys paid in >1 asset, or sells proceeds in a different asset than
   * buys) set mixed=true — the caller dashes the avg (never guesses an FX).
   * Net <=0 with a live holding means the holding came from non-fill paths
   * (transfer/issue): receivedRaw/paidRaw return "0" (zero-cost, all profit).
   * Params: rows array, pmaAssetId "1.3.x". Returns {receivedRaw, paidRaw,
   *   paidAssetId (or null), mixed, fillsCount, buysCount, sellsCount}. */
  function costBasisFromFills(rows, pmaAssetId) {
    var receivedBuys = 0n, paidBuys = 0n, soldPma = 0n, proceedsSells = 0n;
    var paidAssetId = null, proceedsAssetId = null, mixed = false;
    var fillsCount = 0, buysCount = 0, sellsCount = 0;
    try {
      if (!Array.isArray(rows) || typeof pmaAssetId !== "string" || !pmaAssetId) {
        return { receivedRaw: "0", paidRaw: "0", paidAssetId: null, mixed: false,
          fillsCount: 0, buysCount: 0, sellsCount: 0 };
      }
      for (var i = 0; i < rows.length; i++) {
        var body = null, entry = _unwrapHist(rows[i]);
        if (entry && Array.isArray(entry.op) && entry.op.length >= 2) {
          var code = entry.op[0];
          if (code !== 4 && code !== "fill_order") continue;
          body = entry.op[1] || {};
        } else if (rows[i] && typeof rows[i] === "object" && !Array.isArray(rows[i]) &&
            rows[i].pays && rows[i].receives) {
          body = rows[i];
        } else {
          continue;
        }
        var pays = body.pays, receives = body.receives;
        if (!pays || !receives || typeof pays.asset_id !== "string" ||
            typeof receives.asset_id !== "string") continue;
        var payRaw = String(pays.amount), recvRaw = String(receives.amount);
        if (!_isIntStr(payRaw) || !_isIntStr(recvRaw)) continue;
        var payAmt, recvAmt;
        try { payAmt = BigInt(payRaw); recvAmt = BigInt(recvRaw); } catch (e) { continue; }
        if (payAmt === 0n && recvAmt === 0n) { fillsCount++; continue; }
        if (receives.asset_id === pmaAssetId && pays.asset_id !== pmaAssetId) {
          fillsCount++; buysCount++;
          receivedBuys += recvAmt; paidBuys += payAmt;
          if (paidAssetId === null) paidAssetId = pays.asset_id;
          else if (paidAssetId !== pays.asset_id) mixed = true;
        } else if (pays.asset_id === pmaAssetId && receives.asset_id !== pmaAssetId) {
          fillsCount++; sellsCount++;
          soldPma += payAmt; proceedsSells += recvAmt;
          if (proceedsAssetId === null) proceedsAssetId = receives.asset_id;
          else if (proceedsAssetId !== receives.asset_id) mixed = true;
          if (paidAssetId !== null && proceedsAssetId !== null && paidAssetId !== proceedsAssetId) mixed = true;
        } else {
          continue;
        }
      }
      var netReceived = receivedBuys - soldPma;
      var netPaid = paidBuys - proceedsSells;
      if (netReceived <= 0n) {
        return { receivedRaw: "0", paidRaw: "0", paidAssetId: paidAssetId, mixed: mixed,
          fillsCount: fillsCount, buysCount: buysCount, sellsCount: sellsCount };
      }
      if (netPaid < 0n) netPaid = 0n;
      if (mixed) {
        return { receivedRaw: netReceived.toString(), paidRaw: netPaid.toString(),
          paidAssetId: paidAssetId, mixed: true,
          fillsCount: fillsCount, buysCount: buysCount, sellsCount: sellsCount };
      }
      return { receivedRaw: netReceived.toString(), paidRaw: netPaid.toString(),
        paidAssetId: paidAssetId, mixed: false,
        fillsCount: fillsCount, buysCount: buysCount, sellsCount: sellsCount };
    } catch (e) {
      return { receivedRaw: "0", paidRaw: "0", paidAssetId: null, mixed: false,
        fillsCount: 0, buysCount: 0, sellsCount: 0 };
    }
  }

  return {
    isSettledBitasset: isSettledBitasset,
    expiryMs: expiryMs,
    classifyStatus: classifyStatus,
    sortClosingSoon: sortClosingSoon,
    countdownParts: countdownParts,
    countdownText: countdownText,
    costBasisFromFills: costBasisFromFills
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.Prediction === "undefined") { globalThis.Prediction = Prediction; }
if (typeof module !== "undefined") { module.exports = Prediction; }
