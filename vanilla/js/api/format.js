/* Format: string-math asset amount formatting (principle #6).
 * Owns: raw integer string <-> display decimal conversions, plus exact
 * decimal price strings -> {num, den} BigInt ratios (receive-side math
 * stays sell_raw * num / den, floored — never float).
 * Consumes: nothing. Side effects: none (pure functions).
 * Globals: exposes single `Format` global; Node guard via module.exports.
 * Created by: building-vanilla-slices skill, slice-03-account plan Task 1;
 * parsePriceRatio added by slice-06-trading plan Task 1.
 * NOTE: string ops only — no binary float for money, ever.
 */
var Format = (function () {
  "use strict";

  /* Precision guard: chain precisions are integers 0..12 (asset precision
   * range; Format never pads beyond it). Throws named "bad precision" —
   * never coerces strings/NaN/Infinity (which would loop or mis-pad). */
  function _assertPrecision(p) {
    if (!Number.isInteger(p) || p < 0 || p > 12) throw new Error("bad precision: " + JSON.stringify(p));
  }

  /* Raw-int guard: unsigned digit strings (or safe-int/bigint >= 0).
   * Throws named "bad amount" — never lets BigInt throw raw to the UI. */
  function _toBigInt(raw, name) {
    if (typeof raw === "bigint") {
      if (raw < 0n) throw new Error("bad amount: " + String(name));
      return raw;
    }
    if (typeof raw === "number") {
      if (!Number.isSafeInteger(raw) || raw < 0) throw new Error("bad amount: " + JSON.stringify(raw));
      return BigInt(raw);
    }
    if (typeof raw === "string" && /^\d+$/.test(raw)) {
      try { return BigInt(raw); } catch (e) { throw new Error("bad amount: " + raw.slice(0, 32)); }
    }
    throw new Error("bad amount: " + String(raw).slice(0, 32));
  }

  /* formatAmount: raw chain integer string + asset precision -> display string
   * with full precision digits. Params: raw (string|number|bigint), precision (number).
   * Returns display string. Throws on non-digit input. */
  function formatAmount(raw, precision) {
    _assertPrecision(precision);
    if (typeof raw !== "string") raw = String(raw);
    var neg = raw.charAt(0) === "-";
    if (neg) raw = raw.slice(1);
    if (!/^\d+$/.test(raw)) throw new Error("bad amount: " + raw);
    if (precision === 0) return (neg ? "-" : "") + raw;
    while (raw.length <= precision) raw = "0" + raw;
    return (neg ? "-" : "") + raw.slice(0, raw.length - precision) + "." + raw.slice(raw.length - precision);
  }

  /* parseAmount: display decimal string + asset precision -> raw integer string.
   * Params: str (string), precision (number). Returns integer string.
   * Throws on malformed input or excess decimals. */
  function parseAmount(str, precision) {
    _assertPrecision(precision);
    str = String(str).trim();
    var m = /^(\d+)(?:\.(\d+))?$/.exec(str);
    if (!m) throw new Error("bad amount: " + str);
    var frac = m[2] || "";
    if (frac.length > precision) throw new Error("too many decimals for precision " + precision);
    while (frac.length < precision) frac += "0";
    var out = (m[1] + frac).replace(/^0+(?=\d)/, "");
    return out === "" ? "0" : out;
  }

  /* formatPrice: raw base/quote integer pair -> human decimal string with
   *   both precisions applied (base_per_quote = base_raw/10^basePrec divided by
   *   quote_raw/10^quotePrec, rounded half-up to `places`). Params: baseRaw,
   *   basePrec, quoteRaw, quotePrec, places (places >= 0). Returns the decimal
   *   string. Throws on zero quote amount or negative places. Integer-only
   *   BigInt math — never binary float for money. */
  function formatPrice(baseRaw, basePrec, quoteRaw, quotePrec, places) {
    _assertPrecision(basePrec);
    _assertPrecision(quotePrec);
    if (!Number.isInteger(places) || places < 0 || places > 18) throw new Error("bad places: " + JSON.stringify(places));
    var b = _toBigInt(baseRaw, "base"), q = _toBigInt(quoteRaw, "quote");
    if (q === 0n) throw new Error("zero quote amount");
    var num = b * (10n ** BigInt(quotePrec)) * (10n ** BigInt(places));
    var den = q * (10n ** BigInt(basePrec));
    var rounded = (num * 10n / den + 5n) / 10n; // round-half-up at places+1
    var s = rounded.toString();
    while (s.length <= places) s = "0" + s;
    return places === 0 ? s : s.slice(0, -places) + "." + s.slice(-places);
  }

  /* parsePriceRatio: display decimal price string -> exact {num, den} BigInt
   * ratio. Params: str (string, e.g. "100.5"). Returns {num: BigInt,
   * den: BigInt} with den = 10^fracLen, UNREDUCED ("100.5" -> 1005n/10n).
   * Callers compute receive amounts as sell_raw * num / den (BigInt floor).
   * Throws on empty input, negatives, or any shape outside digits[.digits]
   * (no exponent, no second dot, no bare dot, no trailing dot). */
  function parsePriceRatio(str) {
    var s = String(str).trim();
    var m = /^(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new Error("bad price: " + String(str));
    var frac = m[2] || "";
    if (frac.length > 18) throw new Error("bad price: too many decimals");
    var num;
    try { num = BigInt(m[1] + frac); } catch (e) { throw new Error("bad price: " + String(str).slice(0, 32)); }
    return { num: num, den: 10n ** BigInt(frac.length) };
  }

  /* pct1: share of count/total as a 1-decimal percent string, integer math.
   * Params: count, total (non-negative safe ints). Returns e.g. "20.0%"
   *   for 1/5, "33.3%" for 1/3 (truncated, never float-rounded money —
   *   display shares only, never amounts). Zero total or zero count yields
   *   "0.0%" (never divide by zero). Throws "bad amount" on negatives or
   *   non-integers. Added for the R1c ranked-ops page (donut + table share
   *   one formatter); hand-rolled SVG arcs consume the same tenths below. */
  function pct1(count, total) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("bad amount: " + JSON.stringify(count));
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("bad amount: " + JSON.stringify(total));
    if (!(total > 0) || !(count > 0)) return "0.0%";
    var tenths = (BigInt(count) * 1000n) / BigInt(total); // tenths of a percent
    return (tenths / 10n).toString() + "." + (tenths % 10n).toString() + "%";
  }

  /* _assertOffset: u16 chain percent (0..65535, force_settlement_offset_percent
   * range; live values are 0..few hundred). Throws named "bad offset" —
   * never coerces strings/NaN (which would mis-price settlement). */
  function _assertOffset(n) {
    if (!Number.isInteger(n) || n < 0 || n > 0xFFFF) throw new Error("bad offset: " + JSON.stringify(n));
  }

  /* _assertMcr: u16 maintenance ratio units (0..65535, divisor 1000).
   * Throws named "bad mcr" — never coerces. */
  function _assertMcr(n) {
    if (!Number.isInteger(n) || n < 0 || n > 0xFFFF) throw new Error("bad mcr: " + JSON.stringify(n));
  }

  /* settleEstimate: offset-adjusted settlement estimate, exact BigInt math.
   * Ports #1 ExchangeHeader.jsx:190-198 (wins over astro's offset-less dialog
   * per #4 asset_ops.hpp force-settlement comment: the chain settles at feed
   * with an offset in the margin position's favor).
   * Params: baseRaw (digit string, market-base leg of current_feed
   *   settlement_price), basePrec (0..12), quoteRaw, quotePrec, offsetPercent
   *   (u16, bitasset.options.force_settlement_offset_percent), baseIsCore
   *   (boolean, true when the MARKET base id is 1.3.0), places (0..18).
   * Formula: feedReal = baseHuman/quoteHuman; if baseIsCore:
   *   settle = feedReal/(1+offset/10000) else settle = feedReal*(1+offset/10000).
   * Exact form: baseIsCore ? b*10^qPrec*10^places*10000 / (q*10^bPrec*(10000+off))
   *   : b*10^qPrec*10^places*(10000+off) / (q*10^bPrec*10000), half-up at places.
   * Returns the decimal string. Throws on zero quote, bad precisions/offset.
   * Globally-settled assets (settlement_fund>0) do NOT call this — callers use
   * formatPrice on bitasset.settlement_price directly (same object, zero math). */
  function settleEstimate(baseRaw, basePrec, quoteRaw, quotePrec, offsetPercent, baseIsCore, places) {
    _assertPrecision(basePrec);
    _assertPrecision(quotePrec);
    if (!Number.isInteger(places) || places < 0 || places > 18) throw new Error("bad places: " + JSON.stringify(places));
    _assertOffset(offsetPercent);
    var b = _toBigInt(baseRaw, "base"), q = _toBigInt(quoteRaw, "quote");
    if (q === 0n) throw new Error("zero quote amount");
    var off = BigInt(offsetPercent);
    var numF = baseIsCore ? 10000n : (10000n + off);
    var denF = baseIsCore ? (10000n + off) : 10000n;
    var num = b * (10n ** BigInt(quotePrec)) * (10n ** BigInt(places)) * numF;
    var den = q * (10n ** BigInt(basePrec)) * denF;
    var rounded = (num * 10n / den + 5n) / 10n;
    var s = rounded.toString();
    while (s.length <= places) s = "0" + s;
    return places === 0 ? s : s.slice(0, -places) + "." + s.slice(-places);
  }

  /* collateralNumDen: exact CR numerator/denominator as decimal strings.
   * Ports the SHAPE of #1 BorrowModal.jsx:572-604 = MarginPosition.jsx:79-97
   * (feedPrice=1/get_asset_price(quoteRaw,backing,baseRaw,debt);
   * CR=humanCollateral/(humanDebt/feedPrice)) with precisions cancelled:
   * CR = collRaw*feedBaseRaw / (feedQuoteRaw*debtRaw). All four legs are raw
   * chain integer strings; feed legs must match (quote=collateral asset,
   * base=debt asset — callers verify asset_ids, never guessed here).
   * Params: collRaw, feedBaseRaw, feedQuoteRaw, debtRaw (digit strings;
   *   collRaw may be "0", the other three must be >0). Returns {num, den}
   *   decimal strings (BigInt, unreduced). Throws on bad/zero inputs. */
  function collateralNumDen(collRaw, feedBaseRaw, feedQuoteRaw, debtRaw) {
    var c = _toBigInt(collRaw, "collateral"), fb = _toBigInt(feedBaseRaw, "feedBase"),
        fq = _toBigInt(feedQuoteRaw, "feedQuote"), d = _toBigInt(debtRaw, "debt");
    if (fb === 0n || fq === 0n || d === 0n) throw new Error("zero feed/debt leg");
    return { num: (c * fb).toString(), den: (fq * d).toString() };
  }

  /* formatRatio2dp: exact round(num/den, 2dp) -> "X.XX" (half-up, BigInt).
   * Params: numStr, denStr (digit strings, den >0). Returns the decimal string.
   * Exact form: scaled100 = (2*num*100 + den)/(2*den) = (num*200+den)/(2*den),
   * then "scaled100/100" with two frac digits. Throws on bad/zero inputs. */
  function formatRatio2dp(numStr, denStr) {
    var num = _toBigInt(numStr, "num"), den = _toBigInt(denStr, "den");
    if (den === 0n) throw new Error("zero denominator");
    var scaled100 = (num * 200n + den) / (2n * den);
    var s = scaled100.toString();
    while (s.length < 3) s = "0" + s;
    return s.slice(0, -2) + "." + s.slice(-2);
  }

  /* formatRatioPct2dp: exact round(num/den*100, 2dp) -> "Y.YY" (half-up).
   * Params/throws: same as formatRatio2dp. Exact form:
   * scaled = (num*20000+den)/(2*den) (= round(num/den*10000)), then "/100". */
  function formatRatioPct2dp(numStr, denStr) {
    var num = _toBigInt(numStr, "num"), den = _toBigInt(denStr, "den");
    if (den === 0n) throw new Error("zero denominator");
    var scaled = (num * 20000n + den) / (2n * den);
    var s = scaled.toString();
    while (s.length < 3) s = "0" + s;
    return s.slice(0, -2) + "." + s.slice(-2);
  }

  /* ratioBelowMcr: exact CR < MCR compare (no float). Params: numStr, denStr
   * (from collateralNumDen), mcrUnits (u16, current_feed
   * maintenance_collateral_ratio). Returns boolean: num*1000 < mcr*den.
   * Boundary is EXCLUSIVE (cr == mcr is safe, not danger — matches #1
   * BorrowModal < checks). Throws on bad inputs. */
  function ratioBelowMcr(numStr, denStr, mcrUnits) {
    _assertMcr(mcrUnits);
    var num = _toBigInt(numStr, "num"), den = _toBigInt(denStr, "den");
    if (den === 0n) throw new Error("zero denominator");
    return num * 1000n < BigInt(mcrUnits) * den;
  }

  /* ratioBelowMcrPlusHalf: exact CR < MCR+0.5 compare (warning band edge).
   * MCR+0.5 = (mcrUnits+500)/1000, so the test is num*1000 < (mcr+500)*den.
   * Callers show danger when ratioBelowMcr is true, warning when this is true
   * but danger is false, safe otherwise (matches #1 close_maintenance when
   * CR < MCR+0.5 but >= MCR). Boundary EXCLUSIVE (cr == mcr+0.5 is safe). */
  function ratioBelowMcrPlusHalf(numStr, denStr, mcrUnits) {
    _assertMcr(mcrUnits);
    var num = _toBigInt(numStr, "num"), den = _toBigInt(denStr, "den");
    if (den === 0n) throw new Error("zero denominator");
    return num * 1000n < BigInt(mcrUnits + 500) * den;
  }

  /* mcrUnitsToHuman: u16 maintenance units -> human percent string at divisor
   * 1000 ("1750" -> "1.75"). Trims trailing zeros, never float. Throws on
   * out-of-range input. Format twin of Credit.tcrUnitsToHuman so CR display
   * never leaves format.js. */
  function mcrUnitsToHuman(u) {
    _assertMcr(u);
    var s = String(u);
    while (s.length < 4) s = "0" + s;
    var head = s.slice(0, -3).replace(/^0+(?=\d)/, ""), tail = s.slice(-3).replace(/0+$/, "");
    return tail ? head + "." + tail : head;
  }

  /* nominalNumDen: honest fallback ratio (collateral units per debt unit) when
   * no verifiable feed exists (prediction market, missing/inverted/zero leg).
   * CR-nominal = collRaw*10^debtPrec / (debtRaw*10^collPrec), exact BigInt.
   * Params: collRaw (may be "0"), collPrec, debtRaw (>0), debtPrec (0..12).
   * Returns {num, den} decimal strings. Throws on bad/zero debt. Display via
   * formatRatio2dp; callers label it nominal, never the margin ratio. */
  function nominalNumDen(collRaw, collPrec, debtRaw, debtPrec) {
    _assertPrecision(collPrec);
    _assertPrecision(debtPrec);
    var c = _toBigInt(collRaw, "collateral"), d = _toBigInt(debtRaw, "debt");
    if (d === 0n) throw new Error("zero debt leg");
    return { num: (c * (10n ** BigInt(debtPrec))).toString(), den: (d * (10n ** BigInt(collPrec))).toString() };
  }

  /* costForHolding: backing-raw cost basis for a PMA holding from fill totals.
   * Ports the average-cost shape (paid/received * holding, floored) with
   * precisions cancelled: costRaw = holdingRaw * paidRaw / receivedRaw, all
   * three legs RAW digit strings (holding + received in PMA units, paid in
   * backing units). Zero received (airdrop/transfer, no fills) yields "0"
   * (zero-cost: the holding is all profit — callers label it, never divide
   * by zero). Zero holding yields "0". Exact BigInt floor, never float.
   * Params: holdingRaw, receivedRaw, paidRaw (digit strings, may be "0").
   * Returns costRaw digit string. Throws on bad (non-digit) inputs. */
  function costForHolding(holdingRaw, receivedRaw, paidRaw) {
    var h = _toBigInt(holdingRaw, "holding"), r = _toBigInt(receivedRaw, "received"),
        p = _toBigInt(paidRaw, "paid");
    if (h === 0n || r === 0n) return "0";
    return ((h * p) / r).toString();
  }

  /* valueFromFeedRaw: backing-raw current value from a settlement/feed raw
   * pair (precisions cancel, same proof as costForHolding: holdingHuman *
   * (quoteHuman/baseHuman) in backing units = holdingRaw*quoteRaw/baseRaw).
   * Ports #4 settlement_price legs (base = PMA, quote = backing per
   * buildFeed leg convention asset_ops.cpp:178 + asset.cpp:266). Exact
   * BigInt floor, never float.
   * Params: holdingRaw, feedBaseRaw (PMA leg), feedQuoteRaw (backing leg),
   *   all digit strings. Returns currentRaw digit string. Throws on zero
   *   base or bad inputs. */
  function valueFromFeedRaw(holdingRaw, feedBaseRaw, feedQuoteRaw) {
    var h = _toBigInt(holdingRaw, "holding"), b = _toBigInt(feedBaseRaw, "feedBase"),
        q = _toBigInt(feedQuoteRaw, "feedQuote");
    if (b === 0n) throw new Error("zero feed base leg");
    if (h === 0n) return "0";
    return ((h * q) / b).toString();
  }

  /* valueFromMidHuman: backing-raw current value from a human mid price
   * (ticker latest, backing per PMA, e.g. "0.95"). Exact form:
   * currentRaw = holdingRaw * num * 10^backingPrec / (den * 10^pmaPrec),
   * where {num, den} = parsePriceRatio(midHuman) (unreduced). Integer-only
   * BigInt floor, never binary float. Params: holdingRaw digit string,
   * pmaPrec/backingPrec 0..12, midHuman decimal string. Returns currentRaw
   * digit string. Throws on bad inputs. */
  function valueFromMidHuman(holdingRaw, pmaPrec, backingPrec, midHuman) {
    _assertPrecision(pmaPrec);
    _assertPrecision(backingPrec);
    var h = _toBigInt(holdingRaw, "holding");
    if (h === 0n) return "0";
    var ratio = parsePriceRatio(midHuman);
    var num = (h * ratio.num * (10n ** BigInt(backingPrec)));
    var den = (ratio.den * (10n ** BigInt(pmaPrec)));
    if (den === 0n) throw new Error("zero price denominator");
    return (num / den).toString();
  }

  /* pnlRaw: signed backing-raw unrealised PnL (current - cost - fee, all
   * backing-raw digit strings; fee defaults "0"). Exact BigInt, may return
   * a "-" prefixed string for a loss (formatAmount renders it). Params:
   * currentRaw, costRaw, feeRawOrZero. Returns signed decimal string.
   * Throws on bad inputs. */
  function pnlRaw(currentRaw, costRaw, feeRaw) {
    var c = _toBigInt(currentRaw, "current"), k = _toBigInt(costRaw, "cost");
    var f = (feeRaw === undefined || feeRaw === null) ? 0n : _toBigInt(feeRaw, "fee");
    return (c - k - f).toString();
  }

  return {
    formatAmount: formatAmount,
    parseAmount: parseAmount,
    formatPrice: formatPrice,
    parsePriceRatio: parsePriceRatio,
    pct1: pct1,
    settleEstimate: settleEstimate,
    collateralNumDen: collateralNumDen,
    nominalNumDen: nominalNumDen,
    formatRatio2dp: formatRatio2dp,
    formatRatioPct2dp: formatRatioPct2dp,
    ratioBelowMcr: ratioBelowMcr,
    ratioBelowMcrPlusHalf: ratioBelowMcrPlusHalf,
    mcrUnitsToHuman: mcrUnitsToHuman,
    costForHolding: costForHolding,
    valueFromFeedRaw: valueFromFeedRaw,
    valueFromMidHuman: valueFromMidHuman,
    pnlRaw: pnlRaw
  };
})();

/* Expose the single Format global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.Format === "undefined") { globalThis.Format = Format; }
if (typeof module !== "undefined") { module.exports = Format; }
