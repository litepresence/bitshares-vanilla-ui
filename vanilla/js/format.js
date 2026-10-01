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

  return {
    formatAmount: formatAmount,
    parseAmount: parseAmount,
    formatPrice: formatPrice,
    parsePriceRatio: parsePriceRatio
  };
})();

/* Expose the single Format global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.Format === "undefined") { globalThis.Format = Format; }
if (typeof module !== "undefined") { module.exports = Format; }
