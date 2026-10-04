/* prediction-helpers.js — pure prediction-market parsing + display math (leaf).
 * Owns: PMA description JSON (parsePMADescription), PMO org convention
 *   (PMO_TYPE / parsePMO / isSubAssetOf), validity bar (invalidReason),
 *   implied-probability math (toProbNum / clamp01 / probabilityFromPrice /
 *   probabilityFromBook / formatImplied / formatDecimal / gcd /
 *   formatFractional / formatAmerican + PROB_MAX_DEN), and settled / status /
 *   expiry derivation (settledOf / statusOf / expiryCellText — lazy
 *   Prediction global joins, never throws). No DOM, no chain reads, no login
 *   gate. Implied-probability inputs are HUMAN base-per-quote prices, never
 *   raw integers (same contract as the parent file).
 * Consumes: Prediction (lazy call-time global for the settled + countdown
 *   joins), I18n.t via the local t() (same Batch-2e contract as the parent:
 *   pre-conversion literal kept verbatim as enDefault).
 * Globals/side effects: global PredictionHelpers only (+ module.exports).
 *   Called by PredictionFlows + the PredictionUI facade (browser: classic
 *   <script> order — this file BEFORE prediction-flows.js; node: required
 *   through module.require by the caller, tx.js precedent).
 * Split from: vanilla/js/views/prediction-ui.js (mechanical move, zero
 *   behavior change — bodies byte-identical).
 * Created by: view-split task res-split1.
 */
var PredictionHelpers = (function () {
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

  /* Description JSON -> {main, condition, expiry} strings (never throws:
   * plain text / missing keys / bad JSON yield ""). Mirrors #1's
   * parseDescription + forPredictions.description convention. */
  function parsePMADescription(description) {
    var out = { main: "", condition: "", expiry: "" };
    if (typeof description !== "string" || !description) return out;
    var parsed = null;
    try { parsed = JSON.parse(description); } catch (e) { return { main: description, condition: "", expiry: "" }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { main: description, condition: "", expiry: "" };
    ["main", "condition", "expiry"].forEach(function (k) {
      if (typeof parsed[k] === "string") out[k] = parsed[k];
      else if (typeof parsed[k] === "number") out[k] = String(parsed[k]);
    });
    return out;
  }

  /* PMO org marker: description-JSON convention, never chain truth.
   * Ground truth verified from BTS-CM/pma source 2026-10-02 (reference-only,
   * never cloned). */
  var PMO_TYPE = "PMO/ORGANIZATION@1.0";

  /* parsePMO: asset description string -> normalized pmo_object or null.
   * NEVER throws (plain text / bad JSON / wrong shape yield null — the list
   * simply shows no org row, the detail falls back to the not-a-pma error).
   * Accepts EITHER {"pmo_object": {...}} alongside PMA-style keys OR a bare
   * org object {"type": "PMO/ORGANIZATION@1.0", ...}. A string-valued
   * pmo_object (JSON nested once more) is parsed one level deeper. Requires:
   * exact type match, identity object with a non-empty name string, a
   * governance object, and a present attestation (any string, empty allowed
   * — the org simply has nothing to show). Optional strings default to "".
   * Params: description (string). Returns the normalized object or null. */
  function parsePMO(description) {
    if (typeof description !== "string" || !description) return null;
    var parsed = null;
    try { parsed = JSON.parse(description); } catch (e) { return null; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    var cand = null;
    if (parsed.pmo_object !== undefined && parsed.pmo_object !== null) {
      cand = parsed.pmo_object;
      if (typeof cand === "string") {
        try { cand = JSON.parse(cand); } catch (e) { return null; }
      }
    } else if (parsed.type === PMO_TYPE) {
      cand = parsed;
    } else {
      return null;
    }
    if (!cand || typeof cand !== "object" || Array.isArray(cand)) return null;
    if (cand.type !== PMO_TYPE) return null;
    var ident = cand.identity, gov = cand.governance;
    if (!ident || typeof ident !== "object" || Array.isArray(ident)) return null;
    if (typeof ident.name !== "string" || !ident.name.trim()) return null;
    if (!gov || typeof gov !== "object" || Array.isArray(gov)) return null;
    if (cand.attestation === undefined || cand.attestation === null) return null;
    function str(v) { return (typeof v === "string") ? v : ""; }
    return {
      type: PMO_TYPE,
      identity: { name: ident.name, website: str(ident.website), manifest: str(ident.manifest) },
      governance: {
        resolution_policy: str(gov.resolution_policy),
        dispute_mechanism: str(gov.dispute_mechanism),
        onchain_account: str(gov.onchain_account)
      },
      attestation: (typeof cand.attestation === "string") ? cand.attestation : ""
    };
  }

  /* isSubAssetOf: "ORG.MARKET" belongs to "ORG" (parent prefix + dot).
   * Case-insensitive (symbols uppercase on chain; the form uppercases before
   * submit), trims, never throws. Params: sym, parent (strings). Returns bool.
   * ("ORG","ORG") is false (self is not its own child); ("ORGMKT","ORG") is
   * false (prefix without the dot is a different asset). */
  function isSubAssetOf(sym, parent) {
    var s = (sym === undefined || sym === null) ? "" : String(sym).trim().toUpperCase();
    var p = (parent === undefined || parent === null) ? "" : String(parent).trim().toUpperCase();
    if (!s || !p) return false;
    if (p.charAt(p.length - 1) === ".") p = p.slice(0, -1);
    if (!p) return false;
    var prefix = p + ".";
    return s.length > prefix.length && s.indexOf(prefix) === 0 &&
      /^[A-Z0-9.]+$/.test(s) && s.charAt(s.length - 1) !== ".";
  }

  /* Validity bar copied from #1 PredictionMarkets.jsx:75-102 (valid-date +
   * description lengths + market fee < 10%). Params: asset join row
   * {asset, bitasset}. Returns "" when valid, else a short reason. */
  function invalidReason(row) {
    var a = row.asset || {}, opts = a.options || {};
    var d = parsePMADescription(typeof opts.description === "string" ? opts.description : "");
    if (!d.condition || !d.main) return t("prediction.missing_condition_description", "missing condition/description");
    if (d.condition.length < 10 || d.main.length < 20) return t("prediction.description_too_short", "description too short");
    if (d.expiry) { var dt = new Date(d.expiry); if (dt instanceof Date && isNaN(dt.getTime())) return t("prediction.bad_expiry_date", "bad expiry date"); }
    if ((opts.market_fee_percent || 0) / 100 >= 10) return t("prediction.market_fee_10", "market fee ≥ 10%");
    return "";
  }

  /* Implied-probability math (display only, NOT money — plain Number is
   * allowed here; the single-format-module rule still holds: Format owns
   * raw↔human, and these take HUMAN base-per-quote price strings only,
   * never raw integers. PMA convention: price = backing per 1 share, so a
   * 0..1 price IS the YES probability; outside 0..1 is clamped, missing is
   * null (never 50%-by-default — no price means no probability). */
  var PROB_MAX_DEN = 100; /* fractional denominator cap */
  var PROB_EVEN_EPS = 1e-12; /* |p-0.5| below this renders Even, not ±100 */

  /* toProbNum: human price-ish input -> finite Number or NaN (never throws).
   * Params: x (string/number/null). Returns Number or NaN. */
  function toProbNum(x) {
    if (x === null || x === undefined || x === "") return NaN;
    var n = Number(x);
    return (typeof n === "number" && isFinite(n)) ? n : NaN;
  }

  /* clamp01: Number -> 0..1 clamped. Params: n (number, finite). Returns
   * 0 when n<0, 1 when n>1, else n. Fails: never (non-finite yields 0 —
   * callers gate NaN to null before reaching here). */
  function clamp01(n) {
    if (!(n >= 0)) return 0;
    if (n > 1) return 1;
    return n;
  }

  /* probabilityFromPrice: single human price -> 0..1 or null.
   * Params: price (string/number/null — backing per share, human).
   * Returns clamped 0..1, or null when there is no price (null/empty/
   * non-numeric/non-finite). Negative clamps to 0, >1 clamps to 1. */
  function probabilityFromPrice(price) {
    if (price === null || price === undefined || price === "") return null;
    var n = toProbNum(price);
    if (!isFinite(n)) return null;
    return clamp01(n);
  }

  /* probabilityFromBook: mid-price preferred, last-trade fallback.
   * Params: bid, ask, last (human price strings/numbers/null).
   * Returns {p, source, price} with source "mid"|"last", or null when
   * neither a mid (needs bid+ask finite >=0 with sum>0) nor a last exists.
   * Zero-sum books (0/0) fall through to last — a 0 mid from nothing would
   * be a lie. */
  function probabilityFromBook(bid, ask, last) {
    var b = toProbNum(bid), a = toProbNum(ask);
    if (isFinite(b) && isFinite(a) && b >= 0 && a >= 0 && (b + a) > 0) {
      return { p: clamp01((b + a) / 2), source: "mid", price: (b + a) / 2 };
    }
    var l = toProbNum(last);
    if (isFinite(l) && l >= 0) {
      return { p: clamp01(l), source: "last", price: l };
    }
    return null;
  }

  /* formatImplied: 0..1 -> "75.0%" (1 decimal). Params: p (0..1 finite).
   * Returns the percent string. Display math only (toFixed on 0..1 is not
   * money). */
  function formatImplied(p) {
    return (Number(p) * 100).toFixed(1) + "%";
  }

  /* formatDecimal: 0..1 -> "1.33" (2dp, = 1/p) or null when p<=0.
   * Params: p (0..1). Returns null at 0 (no finite odds — caller dashes),
   * "1.00" at 1. */
  function formatDecimal(p) {
    var n = Number(p);
    if (!(n > 0)) return null;
    return (1 / n).toFixed(2);
  }

  /* gcd: Euclidean GCD for non-negative safe ints. Params: a, b. Returns
   * the GCD (>=1 for positive inputs; 0 only when both are 0). */
  function gcd(a, b) {
    a = Math.abs(Math.floor(a)); b = Math.abs(Math.floor(b));
    while (b) { var tmp = a % b; a = b; b = tmp; }
    return a || 1;
  }

  /* formatFractional: 0..1 -> "1/3" ((1-p)/p reduced, den<=maxDen) or null
   * at the 0/1 edges (no finite odds — caller dashes). Params: p (0..1),
   * maxDen (default 100). Best-rational search over D=1..maxDen by closest
   * N/D to v=(1-p)/p, ties keep the smaller D; reduced via gcd. */
  function formatFractional(p, maxDen) {
    var n = Number(p);
    if (!(n > 0) || !(n < 1)) return null;
    var max = (maxDen === undefined || maxDen === null) ? PROB_MAX_DEN : Math.floor(maxDen);
    if (!(max >= 1)) max = PROB_MAX_DEN;
    var v = (1 - n) / n, bestN = 1, bestD = 1, bestErr = Infinity, d;
    for (d = 1; d <= max; d++) {
      var candN = Math.round(v * d), err = Math.abs(candN / d - v);
      if (err < bestErr - 1e-15) { bestErr = err; bestN = candN; bestD = d; }
      if (bestErr === 0) break;
    }
    var g = gcd(bestN, bestD);
    return (bestN / g) + "/" + (bestD / g);
  }

  /* formatAmerican: 0..1 -> "-300"/"+300"/evenLabel/"—" sentinel null.
   * Params: p (0..1), evenLabel (string shown at exactly 50%, default
   * "Even"). Returns null at the 0/1 edges (no finite odds), evenLabel
   * within PROB_EVEN_EPS of 0.5 (even money has no favorite — never
   * +100/-100), else "-"+rounded(100*p/(1-p)) for favorites (p>0.5) or
   * "+"+rounded(100*(1-p)/p) for underdogs. */
  function formatAmerican(p, evenLabel) {
    var n = Number(p);
    if (!(n > 0) || !(n < 1)) return null;
    var ev = (evenLabel === undefined || evenLabel === null) ? "Even" : String(evenLabel);
    if (Math.abs(n - 0.5) < PROB_EVEN_EPS) return ev;
    if (n > 0.5) return "-" + String(Math.round(100 * n / (1 - n)));
    return "+" + String(Math.round(100 * (1 - n) / n));
  }

  function settledOf(row) {
    var b = (row && row.bitasset) || {};
    try {
      if (typeof Prediction !== "undefined" && Prediction && typeof Prediction.isSettledBitasset === "function") {
        return !!Prediction.isSettledBitasset(b);
      }
    } catch (e) { /* fallback below */ }
    var fund = b.settlement_fund;
    if (fund !== undefined && fund !== null) {
      try { return BigInt(String(fund)) > 0n; } catch (e2) { return String(fund) !== "0"; }
    }
    return false;
  }

  /* Status for list filtering via the shared Prediction helper (#4 wins):
   * settled wins over expiry; expired = past expiry AND unsettled (awaiting
   * resolution); boundary expiry==now stays active. Missing/unparseable
   * expiry with no settlement => active. Params: row (scan row), nowMs.
   * Returns "active"|"expired"|"settled". Never throws. */
  function statusOf(row, nowMs) {
    var settled = settledOf(row);
    try {
      if (typeof Prediction !== "undefined" && Prediction && typeof Prediction.classifyStatus === "function") {
        var a = (row && row.asset) || {};
        var d = parsePMADescription((a.options || {}).description || "");
        return Prediction.classifyStatus({ expiryIso: d.expiry || "", nowMs: nowMs, settled: settled });
      }
    } catch (e) { /* fallback below */ }
    if (settled) return "settled";
    return "active";
  }

  /* Expiry countdown cell text (pure time math, never money): "expiry ISO
   * + countdown" e.g. "2026-12-31 (2d 3h)". No expiry => dash; unparseable
   * => raw ISO only. Params: expiryIso string, nowMs. Returns display string.
   * Never throws. */
  function expiryCellText(expiryIso, nowMs) {
    if (!expiryIso) return "—";
    try {
      if (typeof Prediction !== "undefined" && Prediction &&
          typeof Prediction.countdownParts === "function" && typeof Prediction.countdownText === "function") {
        var parts = Prediction.countdownParts(expiryIso, nowMs);
        var txt = Prediction.countdownText(parts);
        if (parts.state === "none") return expiryIso;
        return expiryIso + " (" + txt + ")";
      }
    } catch (e) { /* raw below */ }
    return expiryIso;
  }

  return {
    toProbNum: toProbNum,
    parsePMADescription: parsePMADescription,
    parsePMO: parsePMO,
    isSubAssetOf: isSubAssetOf,
    PMO_TYPE: PMO_TYPE,
    invalidReason: invalidReason,
    PROB_MAX_DEN: PROB_MAX_DEN,
    clamp01: clamp01,
    probabilityFromPrice: probabilityFromPrice,
    probabilityFromBook: probabilityFromBook,
    formatImplied: formatImplied,
    formatDecimal: formatDecimal,
    gcd: gcd,
    formatFractional: formatFractional,
    formatAmerican: formatAmerican,
    settledOf: settledOf,
    statusOf: statusOf,
    expiryCellText: expiryCellText
  };
})();

if (typeof globalThis !== "undefined") { globalThis.PredictionHelpers = PredictionHelpers; }

if (typeof module !== "undefined") { module.exports = PredictionHelpers; }
