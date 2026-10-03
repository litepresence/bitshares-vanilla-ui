/* prediction-ui.js — #/prediction + #/prediction/:market honest-scope views.
 * Owns: PMA LIST (bounded list_assets scan + symbol search, Active/Expired/
 *   My/Open/Settled/All filter, hide-unknown-houses + hide-invalid-assets
 *   client filters, expiry countdown text + manual Refresh) and PORTFOLIO
 *   (PMA holdings from Account.balances joined to scan rows + avg-cost from
 *   fill history via Prediction.costBasisFromFills + current mid/feed vs
 *   cost via Format (human terms, raw in title) + op-17 settle per settled
 *   holding with fee via get_required_fees, unlock-at-sign, confirm rows)
 *   and PMA detail (issuer, settlement status/price, feed) with implied-
 *   probability panel (mid-price, last-trade fallback, honest empty — never
 *   50%-by-default; Implied%/Decimal/Fractional/American via the pure
 *   helpers below, exposed on _test) plus quick-position Buy-YES/Buy-NO
 *   links into the existing #/instant-trade/SELL_RECEIVE flow (orientation
 *   IS the preset — instant-trade takes no side param, documented at the
 *   call site) and deep-links into the existing #/market/QUOTE_BASE desk
 *   for YES/NO positioning. LIST columns per row: Asset / Description / Condition /
 *   Expiry / Validity / House / Market confidence / Predicted likelihood /
 *   Market (desk link, asset-page fallback) / Details (-> #/prediction/:id).
 *   PMO ORGANIZATIONS: a second section lists parent org assets (description
 *   carries pmo_object, BTS-CM/pma convention, reference-only) with
 *   scanned-range sub-asset counts + active/expired PMA tallies; an org
 *   symbol in #/prediction/:market renders the org detail (identity /
 *   governance / attestation + its markets + create-sub-asset entry).
 *   Expiry / Validity / House / Market confidence / Predicted likelihood /
 *   Market (desk link, asset-page fallback) / Details (-> #/prediction/:id).
 *   Description trio parses the scan row's options.description JSON only
 *   (dash when unreadable — no new chain reads); validity is invalidReason()
 *   or dash; Market targets verified routes (router.js /market/:marketID,
 *   /asset/:symbol); Details targets /prediction/:market. Positions ARE
 *   limit orders on the pair, so NO new serializers, no signing, no fee
 *   math in this file. All reads public, no login gate.
 * Consumes: Explorer (assetsPage/asset/feeds joins), Asset.describe,
 *   Format (amount/price display only), Chain (backing-symbol lookup),
 *   Store ("connection" resubscribe). Globals/side effects: exposes global
 *   PredictionUI only; DOM under the given root; Store subscriptions dropped
 *   on every entry (generation counter).
 * Refs: #1 PredictionMarkets.jsx list concepts only — description/condition/
 *   expiry + market button per row (:368-419 open/past filter + search,
 *   :492-618 overview section + OverviewTable columns); opinions ARE
 *   orderbook rows :104-160 (NOT copied — detail links to the live desk);
 *   resolve = global_settle :341-372 — NOT reimplemented, issuer-only
 *   signing lives in AssetManage);
 *   PMAssetsContainer.jsx:121-127 (_isPredictionMarket = bitasset_data
 *   .is_prediction_market; :92-104 whitelist comes from an on-chain config
 *   asset that testnet does not publish, so no whitelist here — bounded
 *   scan instead); OverviewTable (:384-402 ticker per row — NOT copied,
 *   detail links to the live desk instead); #2 has no prediction page;
 *   slice-10 PMA support: asset-ops.js builders (op-10 +
 *   is_prediction_market:true) + tx.js:913-929 serializer.
 * Created by: stub-queue build (matrix §A row A30, LAST stub group).
 * CHAIN TRUTH (#4 wins): list_assets <- database_api.hpp; bitasset objects
 *   carry is_prediction_market + settlement_fund (protocol/asset.hpp);
 *   description JSON {main, condition, expiry} is a #1 convention
 *   (asset_utils.js parseDescription), parsed defensively, never trusted.
 *   PMO pmo_object {type:"PMO/ORGANIZATION@1.0", identity:{name,website,
 *   manifest}, governance:{resolution_policy,dispute_mechanism,
 *   onchain_account}, attestation} is a BTS-CM/pma description convention
 *   (verified from source 2026-10-02, reference-only, never cloned): NO new
 *   WS methods, NO fee discount — sub-assets are cheap only via the op-10
 *   symbol-length fee tiers (see asset-ui.js feeTierForSymbol + slice-10
 *   delta). Parsed fail-soft (null), never trusted.
 */
var PredictionUI = (function () {
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
  var SCAN_PAGES = 8, PAGE_SIZE = 25; /* bounded: 200 assets max per entry */
  var openSubs = [];
  function dropOpenSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }

  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(box) { while (box.firstChild) box.removeChild(box.firstChild); }

  function missingBackends() {
    var need = ["Explorer", "Asset", "Format", "Chain", "Store"], miss = null;
    need.forEach(function (g) { if (typeof globalThis[g] === "undefined") miss = g; });
    return miss;
  }
  function showError(doc, wrap, e, fallback) {
    var m = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("prediction.unexpected_error", "Unexpected error"));
    var map = [["not-connected", t("prediction.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.")],
      ["unknown-asset", t("prediction.asset_not_found_on_this_network", "Asset not found on this network.")],
      ["not-a-pma", t("prediction.that_asset_is_not_a_prediction_market_no_is_p", "That asset is not a prediction market (no is_prediction_market flag).")]];
    if (m.indexOf("not connected") !== -1) m = map[0][1];
    for (var i = 0; i < map.length; i++) if (m.indexOf(map[i][0]) !== -1) { m = map[i][1]; break; }
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function retryButton(doc, wrap, retryFn) {
    var b = touchable(el(doc, "button", t("prediction.retry", "Retry"))); b.type = "button";
    b.addEventListener("click", retryFn); wrap.appendChild(b);
  }
  function autoRetryOnOpen(myGen, retryFn) {
    try {
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (myGen !== gen) { settled = true; try { off(); } catch (e) {} return; }
        if (st && st.state === "open") {
          settled = true; try { off(); } catch (e) {}
          if (typeof location === "undefined" || location.hash === hashAtEntry) retryFn();
        }
      });
      openSubs.push(off);
    } catch (e) { /* manual Retry remains */ }
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

  /* Bounded asset scan core: list_assets pages ("" bound, PAGE_SIZE) then
   * ONE batched get_objects for bitasset_data_ids, keeping rows whose
   * bitasset has is_prediction_market === true. Returns {seen (every
   * scanned asset, PMAs AND plain assets), rows (PMA rows), scanned,
   * truncated}. Fails "not-connected". No efficient chain query exists (#1
   * paginates ALL assets the same way), so the bound + symbol search below
   * are the honest scope. scanPMAs/scanPMOs below are thin filters over
   * this — one paging loop, never two scans per entry. */
  async function scanAssets() {
    var seen = [], lower = "", pages = 0, truncated = false;
    for (;;) {
      var page = await Explorer.assetsPage(lower, PAGE_SIZE);
      if (!page || !page.length) break;
      seen = seen.concat(page);
      pages++;
      lower = page[page.length - 1].symbol;
      if (page.length < PAGE_SIZE || pages >= SCAN_PAGES) {
        if (page.length === PAGE_SIZE && pages >= SCAN_PAGES) truncated = true;
        break;
      }
    }
    var want = [], byBitId = {};
    seen.forEach(function (a) {
      if (a && a.bitasset_data_id) { want.push(a.bitasset_data_id); byBitId[a.bitasset_data_id] = a; }
    });
    var rows = [];
    if (want.length) {
      var dbId = await Chain.db();
      var objs = await Chain.call(dbId, "get_objects", [want]);
      (objs || []).forEach(function (b) {
        if (b && b.is_prediction_market === true && byBitId[b.id]) {
          rows.push({ asset: byBitId[b.id], bitasset: b });
        }
      });
    }
    return { seen: seen, rows: rows, scanned: seen.length, truncated: truncated };
  }

  /* scanPMAs: PMA rows from the shared scan core (behavior-identical to the
   * old inline scanPMAs — same pages, same join, same shape). Returns
   * {rows, scanned, truncated}. */
  async function scanPMAs() {
    var r = await scanAssets();
    return { rows: r.rows, scanned: r.scanned, truncated: r.truncated };
  }

  /* scanPMOs: parent org assets + per-org tallies from the SAME bounded scan
   * (no extra paging loop). An org is any scanned asset whose
   * options.description parses via parsePMO. Per org: subCount (scanned
   * symbols that are children via isSubAssetOf, ANY asset type) + active /
   * expired (child PMA rows split by settledOf). Returns {orgs, rows (PMA
   * rows, so list callers keep one scan), scanned, truncated}. Tallies
   * cover the scanned range only — the note says so, never the whole chain. */
  async function scanPMOs() {
    var base = await scanAssets();
    var orgs = [];
    base.seen.forEach(function (a) {
      if (!a) return;
      var pmo = parsePMO((a.options || {}).description || "");
      if (pmo) orgs.push({ asset: a, pmo: pmo, subCount: 0, active: 0, expired: 0 });
    });
    orgs.forEach(function (o) {
      var parent = (o.asset && o.asset.symbol) || "";
      var subs = 0, active = 0, expired = 0;
      base.seen.forEach(function (a) {
        if (a && isSubAssetOf(a.symbol || "", parent)) subs++;
      });
      base.rows.forEach(function (row) {
        if (row.asset && isSubAssetOf(row.asset.symbol || "", parent)) {
          if (settledOf(row)) expired++;
          else active++;
        }
      });
      o.subCount = subs;
      o.active = active;
      o.expired = expired;
    });
    return { orgs: orgs, rows: base.rows, scanned: base.scanned, truncated: base.truncated };
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

  /* One LIST row: Asset / Description / Condition / Expiry / Validity /
   * House / Market confidence / Predicted likelihood / Market / Details.
   * The description trio comes from the scan row's options.description JSON
   * only (parsePMADescription, #1 asset_utils.js convention) — dash when
   * unreadable, never a new chain read. Validity is invalidReason() or
   * dash. Market targets the live #/market/QUOTE_BASE desk when the backing
   * symbol resolved, else the #/asset/SYMBOL page (both routes verified in
   * router.js: /market/:marketID + /asset/:symbol); Details targets
   * #/prediction/SYMBOL (/prediction/:market). Enrich gaps (house,
   * confidence, likelihood) show "—", never raw integers, never throw. */
  function appendRow(doc, tbody, row, filter, enrich, nowMs, mySet) {
    var a = row.asset, d = parsePMADescription((a.options || {}).description || "");
    var settled = settledOf(row);
    var st = statusOf(row, nowMs);
    if (filter === "open" && settled) return false;
    if (filter === "settled" && !settled) return false;
    if (filter === "active" && st !== "active") return false;
    if (filter === "expired" && st !== "expired") return false;
    if (filter === "my") {
      var id = a.id || "";
      if (!mySet || !mySet[id]) return false;
    }
    enrich = enrich || {};
    var tr = doc.createElement("tr");
    function cell(text) { var td = doc.createElement("td"); td.textContent = text; return td; }
    function linkCell(href, label) {
      var td = doc.createElement("td");
      var link = doc.createElement("a"); link.href = href; link.textContent = label;
      touchable(link); td.appendChild(link);
      return td;
    }
    var sym = a.symbol || a.id;
    tr.appendChild(cell(sym || "—"));
    tr.appendChild(cell(d.main || "—"));
    tr.appendChild(cell(d.condition || "—"));
    tr.appendChild(cell(expiryCellText(d.expiry || "", nowMs)));
    tr.appendChild(cell(invalidReason(row) || "—"));
    tr.appendChild(cell(enrich.house || "—"));
    tr.appendChild(cell(enrich.conf || "—"));
    tr.appendChild(cell(enrich.like || "—"));
    if (sym) {
      if (enrich.backSym) {
        tr.appendChild(linkCell("#/market/" + encodeURIComponent(sym) + "_" +
          encodeURIComponent(enrich.backSym), t("borrow.market", "Market")));
      } else {
        tr.appendChild(linkCell("#/asset/" + encodeURIComponent(sym),
          t("borrow.market", "Market")));
      }
      tr.appendChild(linkCell("#/prediction/" + encodeURIComponent(sym),
        t("prediction.details", "Details")));
    } else {
      tr.appendChild(cell("—"));
      tr.appendChild(cell("—"));
    }
    tbody.appendChild(tr);
    return true;
  }

  /* #/prediction — list. Search filters scanned rows; the symbol box resolves
   * one asset directly (covers PMAs outside the scan bound). */
  function renderList(root) {
    if (!root) return;
    var doc = root.ownerDocument || document, myGen = ++gen, miss = missingBackends();
    dropOpenSubs();
    clearBox(root);
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", t("prediction.prediction_markets", "Prediction Markets")));
    wrap.appendChild(el(doc, "p", t("prediction.prediction_market_assets_yes_no_shares_positi", "Prediction-market assets (YES/NO shares). Positions are ordinary limit orders on the asset's market — open a market below and trade from the desk."), "muted"));
    /* PMO org section (parent assets group markets; tallies cover the same
     * bounded scan as the PMA list below — scanPMOs returns both, one scan).
     * Painted by paintOrgs() once the scan lands; empty state is an honest
     * row, never a blank. */
    wrap.appendChild(el(doc, "h2", t("prediction.pmo_section", "Organizations (PMO)")));
    wrap.appendChild(el(doc, "p", t("prediction.pmo_note", "Parent organization assets group prediction markets. Counts cover the scanned range below."), "muted"));
    var orgTableWrap = el(doc, "div", null, "table-scroll prediction-scroll"); wrap.appendChild(orgTableWrap);
    var orgNote = el(doc, "p", "", "muted"); wrap.appendChild(orgNote);
    if (miss) { showError(doc, wrap, "Prediction backend missing: " + miss + " failed to load."); return; }
    var self = function () { if (myGen === gen) renderList(root); };

    var toolbar = el(doc, "div", null, "toolbar"); wrap.appendChild(toolbar);
    var search = doc.createElement("input");
    search.type = "search"; search.placeholder = t("prediction.filter_by_symbol_or_condition", "Filter by symbol or condition…");
    search.setAttribute("aria-label", t("prediction.filter_prediction_markets", "Filter prediction markets")); touchable(search);
    toolbar.appendChild(search);
    var filterSel = doc.createElement("select");
    filterSel.setAttribute("aria-label", t("prediction.open_or_settled_filter", "Open or settled filter")); touchable(filterSel);
    [["active", t("prediction.active", "Active")], ["expired", t("prediction.expired", "Expired")], ["my", t("prediction.my", "My")], ["open", t("prediction.open", "Open")], ["settled", t("prediction.settled", "Settled")], ["all", t("prediction.all", "All")]].forEach(function (pr) {
      var o = doc.createElement("option"); o.value = pr[0]; o.textContent = pr[1]; filterSel.appendChild(o);
    });
    filterSel.value = "active";
    toolbar.appendChild(filterSel);
    var refreshBtn = touchable(el(doc, "button", t("prediction.refresh", "Refresh"))); refreshBtn.type = "button";
    refreshBtn.setAttribute("aria-label", t("prediction.refresh", "Refresh"));
    toolbar.appendChild(refreshBtn);
    var sym = doc.createElement("input");
    sym.type = "text"; sym.placeholder = t("prediction.look_up_symbol_or_1_3_x_id", "Look up symbol or 1.3.x id…");
    sym.setAttribute("aria-label", t("prediction.look_up_a_prediction_asset_directly", "Look up a prediction asset directly")); touchable(sym);
    toolbar.appendChild(sym);
    var go = touchable(el(doc, "button", t("prediction.open", "Open"))); go.type = "button"; toolbar.appendChild(go);
    go.addEventListener("click", function () {
      var v = (sym.value || "").trim();
      if (v) location.hash = "#/prediction/" + encodeURIComponent(v);
    });
    /* MED create button (#1 PredictionMarkets.jsx create_market modal entry):
     * vanilla creates under the existing #/assets/create PMA tab (verified:
     * router.js maps /assets/create -> AssetUI.renderCreate, which draws a
     * PMA tab locking is_prediction_market ON). Batch-3 i18n: keyed. */
    var mk = touchable(el(doc, "button", t("prediction.create_prediction_market", "Create prediction market"))); mk.type = "button";
    toolbar.appendChild(mk);
    mk.addEventListener("click", function () { location.hash = "#/assets/create"; });
    /* PMO create entry: orgs are plain UIAs whose description carries the
     * pmo_object — the template button lives on #/assets/create (asset-ui.js
     * prefill), so this just navigates there like the PMA button above. */
    var mkOrg = touchable(el(doc, "button", t("prediction.pmo_create_org", "Create organization (PMO)"))); mkOrg.type = "button";
    toolbar.appendChild(mkOrg);
    mkOrg.addEventListener("click", function () { location.hash = "#/assets/create"; });
    /* MED client-side toggles (#1 PredictionMarkets.jsx:37-38 defaults ON,
     * :378-400 _filterMarkets): unknown house = issuer name unresolvable on
     * this network; invalid = invalidReason() non-empty. Batch-3 i18n: keyed. */
    var toggleRow = el(doc, "div", null, "toolbar"); wrap.appendChild(toggleRow);
    function checkBox(labelText, checked) {
      var lab = doc.createElement("label");
      var box = doc.createElement("input"); box.type = "checkbox"; box.checked = !!checked;
      touchable(box); lab.appendChild(box);
      lab.appendChild(doc.createTextNode(" " + labelText));
      toggleRow.appendChild(lab);
      return box;
    }
    var chkU = checkBox(t("prediction.hide_unknown_houses", "Hide unknown houses"), true);
    var chkI = checkBox(t("prediction.hide_invalid_assets", "Hide invalid assets"), true);
    wrap.appendChild(el(doc, "p", t("prediction.new_markets_are_created_under_assets_", "New markets are created under Assets → Create → PMA tab (#/assets/create). Unknown house = issuer name not resolvable on this network."), "muted"));

    var status = showStatus(doc, wrap, t("prediction.scanning_assets_for_prediction_markets", "Scanning assets for prediction markets…"));
    var tableWrap = el(doc, "div", null, "table-scroll prediction-scroll"); wrap.appendChild(tableWrap);
    var note = el(doc, "p", "", "muted"); wrap.appendChild(note);
    var createP = el(doc, "p", "", "muted"); wrap.appendChild(createP);
    var ca = doc.createElement("a"); ca.href = "#/assets/create"; ca.textContent = t("prediction.create_one_under_assets_create_pma_tab", "Create one under Assets → Create (PMA tab)");
    createP.textContent = t("prediction.scan_prefix", "No market you expected? The scan covers the first ") + (SCAN_PAGES * PAGE_SIZE) +
      t("prediction.scan_suffix", " assets — use the lookup box above, or ");
    createP.appendChild(ca); createP.appendChild(doc.createTextNode("."));

    var cache = { rows: [], orgs: [], scanned: 0, truncated: false };
    /* My-filter wallet join (created-or-holding by the WALLET account, not
     * the portfolio viewing account). Loads once on first My selection:
     * myAccountId (needs unlock — locked stays empty honest) + balances +
     * issuedBy (PMA-only). Set maps 1.3.x -> true. Never throws past the
     * loading flag (failures leave an empty loaded set, paint shows the
     * locked/empty hint, never a crash). */
    var myState = { loaded: false, loading: false, id: null, name: null, set: null, locked: false };
    function ensureMy(done) {
      if (myState.loaded || myState.loading) { if (typeof done === "function") { try { done(); } catch (e) {} } return; }
      myState.loading = true;
      Promise.resolve().then(async function () {
        var myId;
        try {
          myId = await Account.myAccountId();
        } catch (e) {
          myState.loading = false; myState.loaded = true; myState.locked = true; myState.set = {};
          return;
        }
        var me = await Account.resolve(myId);
        var bals = await Account.balances(me.id);
        var issued = [];
        try { issued = await Asset.issuedBy(me.id); } catch (e) { issued = []; }
        var set = {};
        (bals || []).forEach(function (b) { if (b && b.asset_id) set[b.asset_id] = true; });
        (issued || []).forEach(function (r) {
          if (r && r.id && r.is_prediction_market) set[r.id] = true;
        });
        /* Restrict to scanned PMA ids (bounded scan is the honest scope —
         * holdings outside the bound have no row to show, never a fake row). */
        var scannedIds = {};
        (cache.rows || []).forEach(function (row) {
          if (row && row.asset && row.asset.id) scannedIds[row.asset.id] = true;
        });
        var pruned = {};
        Object.keys(set).forEach(function (id) { if (scannedIds[id]) pruned[id] = true; });
        /* Issued PMAs outside the scan bound still count (created by me) —
         * re-add issued ids even when unscanned (their row is missing, so
         * paint still shows 0 — honest, never a fake row; the set keeps the
         * created intent for future scans). */
        (issued || []).forEach(function (r) {
          if (r && r.id && r.is_prediction_market) pruned[r.id] = true;
        });
        myState.id = me.id; myState.name = me.name; myState.set = pruned;
        myState.loading = false; myState.loaded = true; myState.locked = false;
      }).catch(function () {
        myState.loading = false; myState.loaded = true; myState.set = {};
      }).then(function () {
        if (typeof done === "function") { try { done(); } catch (e) {} }
        if (myGen === gen && filterSel.value === "my") paint();
      });
    }
    /* Portfolio + settle helpers (borrow-ui margin/CR patterns mirrored:
     * viewing-as default, sign-at-sign only, named-row confirms, head-block
     * observation marker). Reads need no login; keys only at Sign & Send. */
    var VIEWING_AS_ID = "1.2.0";
    function isUnlockedNow() {
      try {
        if (typeof Wallet !== "undefined" && typeof Wallet.isUnlocked === "function") return !!Wallet.isUnlocked();
        return !!(typeof Wallet !== "undefined" && Wallet.keys);
      } catch (e) { return false; }
    }
    function confirmListP(rows) {
      var list = el(doc, "dl", null, "xfer-confirm");
      rows.forEach(function (r) {
        list.appendChild(el(doc, "dt", r[0]));
        var dd = el(doc, "dd", r[1]); if (r[2]) dd.title = r[2]; list.appendChild(dd);
      });
      return list;
    }
    function pField(labelText, opts) {
      opts = opts || {};
      var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
      var input = doc.createElement("input");
      if (opts.type) input.type = opts.type; if (opts.value !== undefined) input.value = opts.value;
      if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
      if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
      touchable(input); label.appendChild(input); row.appendChild(label); return { row: row, input: input };
    }
    function unlockInlineP(parent, onUnlock) {
      if (parent.querySelector && parent.querySelector(".xfer-unlock-row")) return;
      var row = el(doc, "div", null, "xfer-field xfer-unlock-row");
      var inp = doc.createElement("input");
      inp.type = "password"; inp.setAttribute("autocomplete", "current-password");
      inp.setAttribute("placeholder", t("borrow.password", "password"));
      inp.setAttribute("aria-label", t("borrow.password", "password"));
      touchable(inp); row.appendChild(inp);
      var b = touchable(el(doc, "button", t("borrow.unlock", "Unlock"))); b.type = "button"; row.appendChild(b);
      parent.appendChild(row);
      b.addEventListener("click", function () {
        b.disabled = true;
        var pw = inp.value;
        Wallet.unlock(pw).then(function () { inp.value = ""; pw = null; if (onUnlock) onUnlock(); })
          .catch(function (e) { inp.value = ""; pw = null; b.disabled = false; showError(doc, parent, e, t("borrow.unlock_failed", "Unlock failed.")); });
      });
    }
    function signGateLockedP(out, sendBtn, backBtn) {
      if (!out.querySelector || !out.querySelector(".xfer-sign-note")) {
        var noteP = el(doc, "p", t("borrow.locked_sign_note", "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."), "muted");
        noteP.className = "muted xfer-sign-note"; out.appendChild(noteP);
      }
      unlockInlineP(out, function () {
        out.appendChild(el(doc, "p", t("borrow.unlocked_rereview_note", "Unlocked — press Back and re-run Review so the transaction uses your account."), "muted"));
      });
      sendBtn.disabled = false; backBtn.disabled = false;
    }
    async function headBlockP() {
      return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
    }
    /* Portfolio section: PMA holdings for a viewing account (default wallet
     * when unlocked, else committee-account 1.2.0 while locked with an honest
     * notice — reads need no login, keys only at Sign & Send). Holdings join
     * Account.balances to the bounded scan rows; avg cost replays
     * Account.historyPaged fills via Prediction.costBasisFromFills
     * (chain-history only, ES refused); current uses settlement_price raw
     * legs when settled (Format.valueFromFeedRaw, precisions cancel) else
     * ticker latest mid-human (Format.valueFromMidHuman); PnL via
     * Format.pnlRaw (human terms, raw in title). Settle per settled holding
     * via AssetOps.buildSettle (op-17) + fee via get_required_fees,
     * unlock-at-sign, named-row confirm, broadcast live with balances
     * re-read proof (code-live when no holder fixture funds — tester-queued,
     * never fabricated). textContent only. */
    wrap.appendChild(el(doc, "h2", t("prediction.portfolio", "Portfolio")));
    if (!isUnlockedNow()) {
      wrap.appendChild(el(doc, "p", t("borrow.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as your account."), "muted"));
    }
    wrap.appendChild(el(doc, "p", t("prediction.portfolio_hint", "Holdings are PMA balances joined to the scan; avg cost replays fill history (chain-history only)."), "muted"));
    wrap.appendChild(el(doc, "p", t("prediction.filter_hint", "Active = unexpired and unsettled (closing soon first); Expired = past expiry awaiting resolution; My = created or held by the wallet account."), "muted"));
    var pfAccount = pField(t("borrow.account", "Account"), !isUnlockedNow()
      ? { placeholder: t("borrow.blank_wallet_account", "blank = wallet account"), value: VIEWING_AS_ID }
      : { placeholder: t("borrow.blank_wallet_account", "blank = wallet account") });
    wrap.appendChild(pfAccount.row);
    if (!isUnlockedNow()) wrap.appendChild(el(doc, "p", t("borrow.locked_preview_note", "Wallet locked — preview only. Password is asked at Sign & Send, never to view."), "muted"));
    var pfLoad = touchable(el(doc, "button", t("prediction.load_portfolio", "Load portfolio"))); pfLoad.type = "button";
    wrap.appendChild(pfLoad);
    var pfBox = el(doc, "div"); wrap.appendChild(pfBox);
    var pfConfirm = el(doc, "div", null, "xfer-out"); wrap.appendChild(pfConfirm);
    var portfolio = { lastAccountId: null, rescan: function () {
      if (portfolio.lastAccountId && myGen === gen) pfLoad.click();
    } };
    Account.myAccountId().then(function (id) {
      if (myGen === gen && !pfAccount.input.value) pfAccount.input.value = id;
    }).catch(function () { /* locked: 1.2.0 default stands */ });
    pfLoad.addEventListener("click", function () {
      if (myGen !== gen) return;
      pfLoad.disabled = true;
      clearBox(pfBox); clearBox(pfConfirm);
      showStatus(doc, pfBox, t("prediction.loading_portfolio", "Loading portfolio…"));
      Promise.resolve().then(async function () {
        var input = (pfAccount.input.value || "").trim();
        var me = input ? await Account.resolve(input)
          : await Account.resolve(await Account.myAccountId().catch(function () { return VIEWING_AS_ID; }));
        var bals = await Account.balances(me.id);
        var byId = {};
        (cache.rows || []).forEach(function (r) {
          if (r && r.asset && r.asset.id) byId[r.asset.id] = r;
        });
        var holdings = (bals || []).filter(function (b) { return b && byId[b.asset_id]; }).map(function (b) {
          return { balance: b, row: byId[b.asset_id] };
        });
        if (!holdings.length) return { me: me, holdings: [], historyFlat: [], backingMeta: {} };
        var walk = null;
        try { walk = await Account.historyPaged(me.id, 100, 5); }
        catch (e) { walk = { rows: [], truncated: false }; }
        var historyFlat = (walk && walk.rows) ? walk.rows : [];
        var historyUnavailable = !walk || walk.rows === undefined;
        /* Backing precisions/symbols for unique backing ids (one batched read). */
        var needBack = {}, needList = [];
        holdings.forEach(function (h) {
          var b = (h.row.bitasset) || {};
          var backId = b.short_backing_asset ||
            (h.row.asset.options && h.row.asset.options.core_exchange_rate &&
             h.row.asset.options.core_exchange_rate.base && h.row.asset.options.core_exchange_rate.base.asset_id) || null;
          h.backingId = backId;
          if (backId && !needBack[backId]) { needBack[backId] = true; needList.push(backId); }
        });
        var backingMeta = {};
        if (needList.length) {
          try {
            var dbId = await Chain.db();
            var metas = await Chain.call(dbId, "get_assets", [needList]);
            (metas || []).forEach(function (m, i) {
              if (m && m.id) backingMeta[m.id] = { precision: m.precision, symbol: m.symbol };
            });
          } catch (e) { /* dashes stand */ }
        }
        /* Ticker mids per holding (best-effort, one call each — bounded by holdings count). */
        var mids = {};
        try {
          var dbId2 = await Chain.db();
          for (var ti = 0; ti < holdings.length; ti++) {
            var hh = holdings[ti];
            if (!hh.backingId || !hh.balance || !hh.balance.asset_id) continue;
            try {
              var tk = await Chain.call(dbId2, "get_ticker", [hh.backingId, hh.balance.asset_id]);
              if (tk && tk.latest !== undefined && tk.latest !== null && String(tk.latest) !== "") {
                mids[hh.balance.asset_id] = String(tk.latest);
              }
            } catch (e) { /* dash stands */ }
          }
        } catch (e) { /* dashes stand */ }
        return { me: me, holdings: holdings, historyFlat: historyFlat,
          historyUnavailable: historyUnavailable, backingMeta: backingMeta, mids: mids };
      }).then(function (R) {
        if (myGen !== gen) return;
        clearBox(pfBox);
        portfolio.lastAccountId = R.me.id;
        if (!R.holdings.length) {
          pfBox.appendChild(el(doc, "p", t("prediction.no_holdings", "No prediction-market holdings for this account."), "muted"));
          pfLoad.disabled = false;
          return;
        }
        if (R.historyUnavailable) pfBox.appendChild(el(doc, "p", t("prediction.history_unavailable", "History unavailable — avg cost shows dashes."), "muted"));
        var table = doc.createElement("table"); table.className = "node-table";
        var thead = doc.createElement("thead"), hr = doc.createElement("tr");
        [t("prediction.hdr_asset", "Asset"), t("prediction.balance", "Balance"), t("prediction.avg_cost", "Avg cost"), t("prediction.current", "Current"), t("prediction.pnl", "PnL"), t("prediction.settle", "Settle")].forEach(function (h) {
          var th = doc.createElement("th"); th.textContent = h; th.setAttribute("scope", "col"); hr.appendChild(th);
        });
        thead.appendChild(hr); table.appendChild(thead);
        var tbody = doc.createElement("tbody"); table.appendChild(tbody);
        R.holdings.forEach(function (h) {
          var bal = h.balance, row = h.row;
          var pmaPrec = (typeof bal.precision === "number") ? bal.precision : null;
          var backMeta = (h.backingId && R.backingMeta[h.backingId]) || null;
          var backPrec = backMeta && typeof backMeta.precision === "number" ? backMeta.precision : null;
          var backSym = (backMeta && backMeta.symbol) || h.backingId || "—";
          var holdingRaw = String(bal.raw);
          var settled = settledOf(row);
          /* Avg cost via fill replay (chain-history only). */
          var avgPerHuman = null, avgTitle = null, costRaw = null, costMixed = false, zeroCost = false;
          try {
            if (typeof Prediction !== "undefined" && Prediction && typeof Prediction.costBasisFromFills === "function" &&
                typeof Format !== "undefined" && Format && typeof Format.costForHolding === "function") {
              var cb = Prediction.costBasisFromFills(R.historyFlat || [], bal.asset_id);
              if (cb.mixed) { costMixed = true; }
              else if (cb.receivedRaw === "0") { zeroCost = true; costRaw = "0"; avgPerHuman = "0"; avgTitle = t("prediction.zero_cost", "zero-cost (no fills)"); }
              else if (pmaPrec !== null && backPrec !== null) {
                costRaw = Format.costForHolding(holdingRaw, cb.receivedRaw, cb.paidRaw);
                try { avgPerHuman = Format.formatPrice(cb.paidRaw, backPrec, cb.receivedRaw, pmaPrec, 8); }
                catch (e) { avgPerHuman = null; }
                avgTitle = "raw cost " + costRaw + " / received " + cb.receivedRaw;
              }
            }
          } catch (e) { avgPerHuman = null; costRaw = null; }
          if (R.historyUnavailable) { avgPerHuman = null; costRaw = null; }
          if (costMixed) { avgPerHuman = null; costRaw = null; }
          /* Current via settlement legs when settled, else ticker mid, else feed legs. */
          var curPerHuman = null, curRaw = null, curSrc = null;
          try {
            var b = row.bitasset || {};
            if (settled && b.settlement_price && b.settlement_price.base && b.settlement_price.quote) {
              var sp = b.settlement_price;
              var legs = null;
              if (sp.base.asset_id === bal.asset_id && sp.quote.asset_id === h.backingId) {
                legs = { pmaRaw: String(sp.base.amount), backRaw: String(sp.quote.amount) };
              } else if (sp.quote.asset_id === bal.asset_id && sp.base.asset_id === h.backingId) {
                legs = { pmaRaw: String(sp.quote.amount), backRaw: String(sp.base.amount) };
              }
              if (legs && /^\d+$/.test(legs.pmaRaw) && /^\d+$/.test(legs.backRaw) && legs.pmaRaw !== "0") {
                curRaw = Format.valueFromFeedRaw(holdingRaw, legs.pmaRaw, legs.backRaw);
                if (pmaPrec !== null && backPrec !== null) {
                  try { curPerHuman = Format.formatPrice(legs.backRaw, backPrec, legs.pmaRaw, pmaPrec, 8); }
                  catch (e) { curPerHuman = null; }
                }
                curSrc = "settlement";
              }
            }
            if (curRaw === null && R.mids && R.mids[bal.asset_id] && pmaPrec !== null && backPrec !== null) {
              var midH = R.mids[bal.asset_id];
              if (/^\d+(\.\d+)?$/.test(midH)) {
                curRaw = Format.valueFromMidHuman(holdingRaw, pmaPrec, backPrec, midH);
                curPerHuman = midH; curSrc = "mid";
              }
            }
            if (curRaw === null && b.current_feed && b.current_feed.settlement_price) {
              var fsp = b.current_feed.settlement_price;
              var fl = null;
              if (fsp.base && fsp.quote && fsp.base.asset_id === bal.asset_id && fsp.quote.asset_id === h.backingId) {
                fl = { pmaRaw: String(fsp.base.amount), backRaw: String(fsp.quote.amount) };
              } else if (fsp.base && fsp.quote && fsp.quote.asset_id === bal.asset_id && fsp.base.asset_id === h.backingId) {
                fl = { pmaRaw: String(fsp.quote.amount), backRaw: String(fsp.base.amount) };
              }
              if (fl && /^\d+$/.test(fl.pmaRaw) && /^\d+$/.test(fl.backRaw) && fl.pmaRaw !== "0") {
                curRaw = Format.valueFromFeedRaw(holdingRaw, fl.pmaRaw, fl.backRaw);
                if (pmaPrec !== null && backPrec !== null) {
                  try { curPerHuman = Format.formatPrice(fl.backRaw, backPrec, fl.pmaRaw, pmaPrec, 8); }
                  catch (e) { curPerHuman = null; }
                }
                curSrc = "feed";
              }
            }
          } catch (e) { curRaw = null; curPerHuman = null; }
          /* PnL gross (fee 0 live — fee shows in the settle confirm; fee-aware
           * math proven in vectors via Format.pnlRaw with nonzero fee). */
          var pnlRawS = null, pnlHuman = null;
          try {
            if (curRaw !== null && costRaw !== null && backPrec !== null) {
              pnlRawS = Format.pnlRaw(curRaw, costRaw, "0");
              pnlHuman = Format.formatAmount(pnlRawS, backPrec) + " " + backSym;
            }
          } catch (e) { pnlRawS = null; pnlHuman = null; }
          var tr = doc.createElement("tr");
          function moneyCell(human, raw, sym) {
            var td = doc.createElement("td");
            td.textContent = (human === null || human === undefined) ? "—" : human;
            if (raw !== null && raw !== undefined) td.title = t("account.raw_prefix", "raw ") + raw;
            return td;
          }
          var balHuman = null;
          try { balHuman = (pmaPrec !== null) ? Format.formatAmount(holdingRaw, pmaPrec) + " " + (bal.symbol || "") : holdingRaw; }
          catch (e) { balHuman = holdingRaw; }
          tr.appendChild(moneyCell(balHuman, holdingRaw));
          var avgShow = null, avgT = avgTitle;
          if (costMixed) { avgShow = "—"; avgT = t("prediction.mixed_cost", "mixed cost assets"); }
          else if (avgPerHuman !== null && backPrec !== null) { avgShow = avgPerHuman + " " + backSym; }
          else if (zeroCost) { avgShow = "0 " + backSym; }
          else { avgShow = "—"; if (!avgT) avgT = t("prediction.history_unavailable", "History unavailable — avg cost shows dashes."); }
          var avgTd = moneyCell(avgShow === "—" ? "—" : avgShow, costRaw);
          if (avgT) avgTd.title = avgT;
          tr.appendChild(avgTd);
          var curShow = (curPerHuman !== null) ? curPerHuman + " " + backSym + (curSrc ? " (" + curSrc + ")" : "") : "—";
          var curTd = moneyCell(curShow === "—" ? "—" : curShow, curRaw);
          if (curRaw === null) curTd.title = t("prediction.no_price", "no price");
          tr.appendChild(curTd);
          var pnlTd = null;
          if (pnlHuman !== null) {
            pnlTd = doc.createElement("td");
            var prefix = (pnlRawS && pnlRawS.charAt(0) === "-") ? "" : "+";
            pnlTd.textContent = prefix + pnlHuman;
            pnlTd.title = t("account.raw_prefix", "raw ") + pnlRawS;
            try {
              if (pnlRawS && pnlRawS.charAt(0) === "-") pnlTd.className = "cr-danger";
              else pnlTd.className = "cr-safe";
            } catch (e) { /* text stands */ }
          } else {
            pnlTd = moneyCell("—", null);
          }
          tr.appendChild(pnlTd);
          var actTd = doc.createElement("td");
          if (settled && holdingRaw !== "0" && pmaPrec !== null) {
            var sb = touchable(el(doc, "button", t("prediction.settle", "Settle"))); sb.type = "button";
            (function (hold, btn) {
              btn.addEventListener("click", function () { settleReview(R.me, hold, btn); });
            })(h, sb);
            actTd.appendChild(sb);
          } else {
            actTd.textContent = "—";
          }
          tr.appendChild(actTd);
          /* Stash computed legs for settleReview (no re-read needed). */
          h._pnl = { holdingRaw: holdingRaw, pmaPrec: pmaPrec, backPrec: backPrec, backSym: backSym,
            costRaw: costRaw, curRaw: curRaw, pnlRaw: pnlRawS, settled: settled };
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); pfBox.appendChild(table);
        var cards = el(doc, "div", null, "node-cards");
        R.holdings.forEach(function (h) {
          var c = el(doc, "div", null, "node-card");
          var p = h._pnl || {};
          var sym = (h.balance && h.balance.symbol) || (h.balance && h.balance.asset_id) || "—";
          c.appendChild(el(doc, "div", sym + " " + (h.balance ? h.balance.display || "" : "")));
          c.appendChild(el(doc, "div", "PnL " + (p.pnlRaw !== null && p.pnlRaw !== undefined && p.backPrec !== null
            ? (function () { try { return Format.formatAmount(p.pnlRaw, p.backPrec) + " " + (p.backSym || ""); } catch (e) { return "—"; } })()
            : "—")));
          cards.appendChild(c);
        });
        pfBox.appendChild(cards);
        pfLoad.disabled = false;
      }).catch(function (e) {
        if (myGen !== gen) return;
        clearBox(pfBox);
        showError(doc, pfBox, e, t("prediction.could_not_load_portfolio", "Could not load the portfolio."));
        pfLoad.disabled = false;
      });
    });
    /* Settle review + broadcast for one settled holding (op-17 force-settle).
     * Amount = full holding human (round-trips via parseAmount); fee via
     * AssetOps.fee (get_required_fees, 1.3.0 deferred); unlock-at-sign;
     * named-row confirm; send via AssetOps.sendAndProve with balances
     * re-read proof (holding reduced or gone). Live ONLY on a holder
     * fixture — otherwise code-live, tester-queued, never fabricated. */
    function settleReview(me, h, btn) {
      clearBox(pfConfirm);
      showStatus(doc, pfConfirm, t("borrow.resolving_and_estimating_fee", "Resolving and estimating fee…"));
      if (btn) btn.disabled = true;
      Promise.resolve().then(async function () {
        var bal = h.balance;
        var pmaPrec = (typeof bal.precision === "number") ? bal.precision : null;
        if (pmaPrec === null) {
          var dinfo = await Asset.describe(bal.asset_id);
          pmaPrec = dinfo.precision;
        }
        var holdingRaw = String(bal.raw);
        var amountHuman = Format.formatAmount(holdingRaw, pmaPrec);
        if (typeof AssetOps === "undefined" || !AssetOps.buildSettle) throw new Error("asset-unavailable");
        var pair = AssetOps.buildSettle({ accountId: me.id, assetId: bal.asset_id,
          amountHuman: amountHuman, precision: pmaPrec });
        var fee = await AssetOps.fee(pair, "1.3.0");
        return { pair: pair, fee: fee, holdingRaw: holdingRaw, pmaPrec: pmaPrec, amountHuman: amountHuman };
      }).then(function (S) {
        if (myGen !== gen) return;
        Asset.describe(S.fee.asset_id).then(function (fa) { return fa; }).catch(function () { return null; })
        .then(function (fa) {
          if (myGen !== gen) return;
          var feeHuman = fa ? Format.formatAmount(String(S.fee.amount), fa.precision) + " " + fa.symbol : String(S.fee.amount);
          clearBox(pfConfirm);
          pfConfirm.appendChild(el(doc, "h3", t("prediction.confirm_settle", "Confirm settle")));
          pfConfirm.appendChild(confirmListP([
            [t("borrow.account", "Account"), me.name + " (" + me.id + ")"],
            [t("prediction.asset", "Asset"), (h.balance.symbol || h.balance.asset_id) + " (" + h.balance.asset_id + ")"],
            [t("confirm.amount", "Amount"), S.amountHuman + " " + (h.balance.symbol || ""), "raw " + S.holdingRaw],
            [t("borrow.fee", "Fee"), feeHuman, "raw " + String(S.fee.amount)],
            [t("borrow.network", "Network"), "testnet"]]));
          pfConfirm.appendChild(el(doc, "p", t("borrow.fee_asset_note", "Fee asset 1.3.0 (switching deferred)."), "muted"));
          var back = touchable(el(doc, "button", t("borrow.back", "Back"))); back.type = "button";
          var send = touchable(el(doc, "button", t("borrow.sign_send", "Sign & Send"))); send.type = "button";
          pfConfirm.appendChild(back); pfConfirm.appendChild(send);
          back.addEventListener("click", function () { clearBox(pfConfirm); if (btn) btn.disabled = false; });
          send.addEventListener("click", function () {
            if (myGen !== gen) return;
            send.disabled = true; back.disabled = true;
            var st = showStatus(doc, pfConfirm, t("borrow.broadcasting", "Broadcasting…"));
            var wif = (typeof Wallet !== "undefined" && Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
            if (!wif) { pfConfirm.removeChild(st); signGateLockedP(pfConfirm, send, back); return; }
            Tx.buildTx([S.pair]).then(function (unsigned) {
              return AssetOps.sendAndProve(unsigned, wif, async function () {
                try {
                  var bals = await Account.balances(me.id);
                  var found = null;
                  for (var i = 0; i < (bals || []).length; i++) {
                    if (bals[i] && bals[i].asset_id === h.balance.asset_id) { found = bals[i]; break; }
                  }
                  if (!found) return { gone: true };
                  try {
                    if (BigInt(String(found.raw)) < BigInt(S.holdingRaw)) return found;
                  } catch (e) { return null; }
                } catch (e) { return null; }
                return null;
              });
            }).then(async function (res) {
              if (myGen !== gen) return;
              clearBox(pfConfirm);
              pfConfirm.appendChild(el(doc, "p", t("prediction.settle_broadcast", "Settle broadcast."), "xfer-ok"));
              pfConfirm.appendChild(el(doc, "p", t("borrow.observed_at_head_block", "Observed at head block #") + String(await headBlockP()) + " (" + res.via + ").", "muted"));
              if (btn) btn.disabled = false;
            }).catch(function (e) {
              if (myGen !== gen) return;
              try { pfConfirm.removeChild(st); } catch (ee) { /* status stands */ }
              showError(doc, pfConfirm, e, t("borrow.failed_check_state_before_retrying_do_not_bli", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
              send.disabled = false; back.disabled = false;
            });
          });
        });
      }).catch(function (e) {
        if (myGen !== gen) return;
        clearBox(pfConfirm);
        showError(doc, pfConfirm, e, t("prediction.could_not_prepare_settle", "Could not prepare the settle."));
        if (btn) btn.disabled = false;
      });
    }
    /* paintOrgs: one row per org — Organization / Name / Markets (scanned
     * sub-asset count) / Active / Expired / Details. Counts are display
     * strings of small ints (never chain money), Details targets
     * #/prediction/SYMBOL which branches to the org view. Never throws. */
    function paintOrgs() {
      clearBox(orgTableWrap);
      var table = doc.createElement("table"); table.className = "node-table";
      var thead = doc.createElement("thead"), hr = doc.createElement("tr");
      [t("prediction.pmo_org", "Organization"), t("prediction.pmo_name", "Name"), t("prediction.pmo_markets", "Markets"), t("prediction.pmo_active", "Active"), t("prediction.pmo_expired", "Expired"), t("prediction.details", "Details")].forEach(function (h) {
        var th = doc.createElement("th"); th.textContent = h; th.setAttribute("scope", "col"); hr.appendChild(th);
      });
      thead.appendChild(hr); table.appendChild(thead);
      var tbody = doc.createElement("tbody"); table.appendChild(tbody);
      (cache.orgs || []).forEach(function (o) {
        var tr = doc.createElement("tr");
        function cell(text) { var td = doc.createElement("td"); td.textContent = text; return td; }
        var sym = (o.asset && o.asset.symbol) || (o.asset && o.asset.id) || "—";
        tr.appendChild(cell(sym));
        tr.appendChild(cell((o.pmo && o.pmo.identity && o.pmo.identity.name) || "—"));
        tr.appendChild(cell(String(o.subCount || 0)));
        tr.appendChild(cell(String(o.active || 0)));
        tr.appendChild(cell(String(o.expired || 0)));
        var td = doc.createElement("td");
        if (sym !== "—") {
          var link = doc.createElement("a");
          link.href = "#/prediction/" + encodeURIComponent(sym);
          link.textContent = t("prediction.details", "Details");
          touchable(link); td.appendChild(link);
        } else { td.textContent = "—"; }
        tr.appendChild(td);
        tbody.appendChild(tr);
      });
      if (!(cache.orgs || []).length) {
        var tr0 = doc.createElement("tr"), td0 = doc.createElement("td");
        td0.colSpan = 6;
        td0.textContent = t("prediction.pmo_no_orgs", "No organization assets in the scanned range.");
        tr0.appendChild(td0); tbody.appendChild(tr0);
      }
      table.appendChild(tbody);
      orgTableWrap.appendChild(table);
      orgNote.textContent = t("prediction.org_scanned_prefix", "Scanned ") + cache.scanned + t("prediction.org_found_mid", " assets, found ") + (cache.orgs || []).length +
        t("prediction.org_unit", " organization") + ((cache.orgs || []).length === 1 ? "" : "s") +
        (cache.truncated ? t("prediction.scan_bound_suffix", " (scan bound reached — lookup finds the rest).") : ".");
    }
    /* Per-asset enrichment from clean reads only (dash otherwise): house =
     * issuer name via Account.resolve, confidence/likelihood = get_ticker
     * (backing, asset), desk backing symbol via backingSymbol. Entries:
     * {done, house, conf, like, backSym}. Filled once per asset; paint
     * re-runs when a fill lands (gen-guarded). */
    var enrichCache = {};
    function enrichKey(row) {
      var a = row && row.asset;
      return (a && (a.id || a.symbol)) || "";
    }
    function cleanNum(s) {
      return typeof s === "string" && /^\d+(\.\d+)?$/.test(s) && s !== "0" && s !== "1" &&
        s !== "NaN" && s !== "-NaN";
    }
    /* enrichRow: house/confidence/likelihood/backing for one PMA row (3 best-effort reads).
     * WHY all-dash fallback: issuer/ticker/backing gaps must not blank the list row.
     * Param row (scan row); returns {done, house, conf, like, backSym}. */
    async function enrichRow(row) {
      var out = { done: true, house: null, conf: null, like: null, backSym: null };
      var a = row.asset || {}, b = row.bitasset || {};
      try {
        if (a.issuer) {
          var acc = await Account.resolve(a.issuer);
          if (acc && acc.name) out.house = acc.name;
        }
      } catch (e) { /* unknown house stands */ }
      var backId = b.short_backing_asset ||
        (a.options && a.options.core_exchange_rate && a.options.core_exchange_rate.base &&
          a.options.core_exchange_rate.base.asset_id) || null;
      if (backId) {
        try { out.backSym = await backingSymbol(backId); } catch (e) { /* dash stands */ }
      }
      if (backId && a.id && out.backSym) {
        try {
          var dbId = await Chain.db();
          var tk = await Chain.call(dbId, "get_ticker", [backId, a.id]);
          if (tk && typeof tk === "object") {
            if (cleanNum(tk.quote_volume)) out.conf = String(tk.quote_volume) + " " + out.backSym;
            if (cleanNum(tk.latest)) {
              var pct = Number(tk.latest) * 100;
              if (isFinite(pct)) out.like = pct.toPrecision(3) + "%";
            }
          }
        } catch (e) { /* dashes stand */ }
      }
      return out;
    }
    function fillEnrich() {
      (cache.rows || []).forEach(function (row) {
        var k = enrichKey(row);
        if (!k || enrichCache[k]) return;
        enrichCache[k] = { done: false, house: null, conf: null, like: null, backSym: null };
        enrichRow(row).then(function (e) {
          if (myGen !== gen) return;
          enrichCache[k] = e;
          paint();
        }).catch(function () {
          if (myGen !== gen) return;
          enrichCache[k] = { done: true, house: null, conf: null, like: null, backSym: null };
          paint();
        });
      });
    }
    function paint() {
      clearBox(tableWrap);
      var q = (search.value || "").toUpperCase(), f = filterSel.value;
      var hideU = !!(chkU && chkU.checked), hideI = !!(chkI && chkI.checked);
      var nowMs = Date.now();
      var table = doc.createElement("table"); table.className = "node-table";
      var thead = doc.createElement("thead"), hr = doc.createElement("tr");
      /* LIST columns (#1 OverviewTable concepts: description + condition +
       * expiry + market button per row, plus validity label + Details link;
       * scan enrichment kept alongside as confidence/likelihood). Headers
       * reuse existing dict keys only (no locale drift — see check_i18n). */
      [t("prediction.hdr_asset", "Asset"), t("explorer.description", "Description"), t("prediction.hdr_condition", "Condition"), t("prediction.hdr_expiry", "Expiry"), t("prediction.hdr_validity", "Validity"), t("prediction.house", "House"), t("prediction.market_confidence", "Market confidence"), t("prediction.predicted_likelihood", "Predicted likelihood"), t("borrow.market", "Market"), t("prediction.details", "Details")].forEach(function (h) {
        var th = doc.createElement("th"); th.textContent = h; th.setAttribute("scope", "col"); hr.appendChild(th);
      });
      thead.appendChild(hr); table.appendChild(thead);
      var tbody = doc.createElement("tbody"); table.appendChild(tbody);
      var shown = 0;
      var rows = cache.rows || [];
      /* Active closes soon first (expiry ascending, missing last). Expired
       * keeps scan order (past-expiry awaiting resolution, oldest first is
       * scan order — no extra sort claimed). */
      if (f === "active" && typeof Prediction !== "undefined" && Prediction && typeof Prediction.sortClosingSoon === "function") {
        try {
          rows = Prediction.sortClosingSoon(rows.map(function (r) {
            var aa = (r && r.asset) || {};
            var dd = parsePMADescription((aa.options || {}).description || "");
            return { __row: r, expiryIso: dd.expiry || "", expiry: dd.expiry || "" };
          })).map(function (x) { return x.__row; });
        } catch (e) { rows = cache.rows || []; }
      }
      var mySet = (myState && myState.loaded && myState.set) ? myState.set : null;
      /* My without a loaded wallet set: trigger the wallet join once, paint
       * the loading row meanwhile (reads need no login, but "My" needs the
       * wallet account id, which needs unlock — locked stays empty honest). */
      if (f === "my" && !mySet && !myState.loading) {
        ensureMy(function () { if (myGen === gen) paint(); });
      }
      rows.forEach(function (row) {
        var a = row.asset, d = parsePMADescription((a.options || {}).description || "");
        if (q && ((a.symbol || "") + " " + d.condition + " " + d.main).toUpperCase().indexOf(q) === -1) return;
        if (hideI && invalidReason(row)) return;
        var k = enrichKey(row), en = enrichCache[k] || { done: false };
        if (hideU && en.done && !en.house) return;
        if (appendRow(doc, tbody, row, f, en.done ? en : {}, nowMs, mySet)) shown++;
      });
      if (!shown) {
        var tr = doc.createElement("tr"), td = doc.createElement("td");
        td.colSpan = 10;
        if (f === "my" && !mySet) {
          td.textContent = myState.loading
            ? t("prediction.loading_portfolio", "Loading portfolio…")
            : t("prediction.my_locked_hint", "Unlock the wallet to see your markets (created or held by the wallet account).");
        } else {
          td.textContent = cache.rows.length
            ? t("prediction.no_match_filter", "No prediction markets match this filter.")
            : t("prediction.no_pma_in_range", "No prediction-market assets in the scanned range. Try the lookup box above.");
        }
        tr.appendChild(td); tbody.appendChild(tr);
      }
      tableWrap.appendChild(table);
      note.textContent = t("prediction.scanned_note", "Scanned %(scanned)s assets, found %(found)s prediction markets%(trunc)s.", {
        scanned: String(cache.scanned), found: String(cache.rows.length),
        trunc: cache.truncated ? " (scan bound reached — lookup finds the rest)." : "."
      });
      fillEnrich();
    }
    search.addEventListener("input", paint);
    filterSel.addEventListener("change", paint);
    chkU.addEventListener("change", paint);
    chkI.addEventListener("change", paint);
    refreshBtn.addEventListener("click", function () {
      if (myGen !== gen) return;
      refreshBtn.disabled = true;
      status.textContent = t("prediction.scanning_assets_for_prediction_markets", "Scanning assets for prediction markets…");
      clearBox(tableWrap);
      scanPMOs().then(function (r) {
        if (myGen !== gen) return;
        cache = r;
        enrichCache = {};
        myState = { loaded: false, loading: false, id: null, name: null, set: null, locked: false };
        status.textContent = "";
        refreshBtn.disabled = false;
        paintOrgs();
        paint();
        if (portfolio && typeof portfolio.rescan === "function") portfolio.rescan();
      }).catch(function (e) {
        if (myGen !== gen) return;
        status.textContent = "";
        refreshBtn.disabled = false;
        showError(doc, wrap, e, t("prediction.could_not_load_prediction_markets", "Could not load prediction markets."));
      });
    });

    scanPMOs().then(function (r) {
      if (myGen !== gen) return;
      cache = r;
      status.textContent = "";
      paintOrgs();
      paint();
    }).catch(function (e) {
      if (myGen !== gen) return;
      status.textContent = "";
      showError(doc, wrap, e, t("prediction.could_not_load_prediction_markets", "Could not load prediction markets."));
      retryButton(doc, wrap, self);
      autoRetryOnOpen(myGen, self);
    });
    autoRetryOnOpen(myGen, self);
  }

  /* Backing-asset symbol for a 1.3.x id (degrades to the bare id, never a
   * crash). Params: id. Returns symbol string. */
  async function backingSymbol(id) {
    try {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_assets", [[id]]);
      if (rows && rows[0] && rows[0].symbol) return rows[0].symbol;
    } catch (e) { /* bare id below */ }
    return id;
  }

  /* renderOrgDetail: #/prediction/:market when the asset is a PMO parent
   * (description parses via parsePMO, NOT is_prediction_market). Shows
   * identity / governance / attestation (textContent only, dash when empty),
   * the scanned-range markets list (child PMA rows with settlement state +
   * Details links), and the create-sub-asset entry (-> #/assets/create?sub=
   * PARENT, which prefills the symbol with the parent prefix + dot). Reads
   * are the same bounded scanPMOs (list_assets + get_objects — no new WS
   * methods); no signing, no fee math here. Params: doc, wrap (cleared on
   * entry), info (Asset.describe join), pmo (normalized), myGen. Never throws
   * past the header (load failures paint the honest empty + Retry via the
   * caller's catch — this function owns its own status line instead). */
  function renderOrgDetail(doc, wrap, info, pmo, myGen) {
    clearBox(wrap);
    wrap.appendChild(el(doc, "h1", "Organization: " + info.symbol));
    var ident = (pmo && pmo.identity) || {}, gov = (pmo && pmo.governance) || {};
    function dash(s) { return (typeof s === "string" && s) ? s : "—"; }
    var dl = doc.createElement("dl");
    function row(k, v) {
      var dt = doc.createElement("dt"); dt.textContent = k; dl.appendChild(dt);
      var dd = doc.createElement("dd"); dd.textContent = v; dl.appendChild(dd);
    }
    row(t("prediction.asset", "Asset"), info.symbol + " (" + info.id + ")");
    row(t("prediction.issuer", "Issuer"), (info.issuer_name || info.issuer_id || "—"));
    row(t("prediction.pmo_name", "Name"), dash(ident.name));
    if (ident.website) row(t("prediction.pmo_identity", "Identity"), dash(ident.website));
    if (ident.manifest) row(t("prediction.pmo_identity", "Identity"), dash(ident.manifest));
    row(t("prediction.pmo_governance", "Governance"), dash(gov.resolution_policy));
    if (gov.dispute_mechanism) row(t("prediction.pmo_governance", "Governance"), dash(gov.dispute_mechanism));
    if (gov.onchain_account) row(t("prediction.pmo_governance", "Governance"), dash(gov.onchain_account));
    row(t("prediction.pmo_attestation", "Attestation"), dash(pmo ? pmo.attestation : ""));
    wrap.appendChild(dl);

    wrap.appendChild(el(doc, "h3", t("prediction.pmo_sub_markets", "Markets under this organization")));
    var subStatus = showStatus(doc, wrap, t("prediction.scanning_assets_for_prediction_markets", "Scanning assets for prediction markets…"));
    var subWrap = el(doc, "div", null, "table-scroll prediction-scroll"); wrap.appendChild(subWrap);
    var sub = doc.createElement("a");
    sub.href = "#/assets/create?sub=" + encodeURIComponent(info.symbol);
    sub.textContent = t("prediction.pmo_create_sub", "Create sub-asset");
    touchable(sub); wrap.appendChild(sub);
    var more = el(doc, "p", "", "muted"); wrap.appendChild(more);
    var a1 = doc.createElement("a"); a1.href = "#/asset/" + encodeURIComponent(info.symbol);
    a1.textContent = t("prediction.asset_detail", "Asset detail"); more.appendChild(a1);
    more.appendChild(doc.createTextNode(" · "));
    var a2 = doc.createElement("a"); a2.href = "#/prediction";
    a2.textContent = t("prediction.all_prediction_markets", "All prediction markets"); more.appendChild(a2);

    scanPMOs().then(function (r) {
      if (myGen !== gen) return;
      subStatus.textContent = "";
      var table = doc.createElement("table"); table.className = "node-table";
      var thead = doc.createElement("thead"), hr = doc.createElement("tr");
      [t("prediction.hdr_asset", "Asset"), t("prediction.hdr_condition", "Condition"), t("prediction.hdr_expiry", "Expiry"), t("prediction.settlement", "Settlement"), t("prediction.details", "Details")].forEach(function (h) {
        var th = doc.createElement("th"); th.textContent = h; th.setAttribute("scope", "col"); hr.appendChild(th);
      });
      thead.appendChild(hr); table.appendChild(thead);
      var tbody = doc.createElement("tbody"); table.appendChild(tbody);
      var shown = 0;
      (r.rows || []).forEach(function (prow) {
        if (!prow.asset || !isSubAssetOf(prow.asset.symbol || "", info.symbol)) return;
        var d = parsePMADescription((prow.asset.options || {}).description || "");
        var tr = doc.createElement("tr");
        function cell(text) { var td = doc.createElement("td"); td.textContent = text; return td; }
        var sym = prow.asset.symbol || prow.asset.id || "—";
        tr.appendChild(cell(sym));
        tr.appendChild(cell(d.condition || "—"));
        tr.appendChild(cell(d.expiry || "—"));
        tr.appendChild(cell(settledOf(prow) ? t("prediction.settled", "Settled") : t("prediction.open", "Open")));
        var td = doc.createElement("td");
        var link = doc.createElement("a");
        link.href = "#/prediction/" + encodeURIComponent(sym);
        link.textContent = t("prediction.details", "Details");
        touchable(link); td.appendChild(link); tr.appendChild(td);
        tbody.appendChild(tr);
        shown++;
      });
      if (!shown) {
        var tr0 = doc.createElement("tr"), td0 = doc.createElement("td");
        td0.colSpan = 5;
        td0.textContent = t("prediction.pmo_no_subs", "No markets under this organization in the scanned range.");
        tr0.appendChild(td0); tbody.appendChild(tr0);
      }
      subWrap.appendChild(table);
    }).catch(function () {
      if (myGen !== gen) return;
      subStatus.textContent = t("prediction.could_not_load_prediction_markets", "Could not load prediction markets.");
    });
  }

  /* #/prediction/:market — detail. Issuer, settlement status/price, feed via
   * Explorer.feeds; YES/NO positioning deep-links to #/market/QUOTE_BASE
   * (positions ARE limit orders on the pair — no serializers here). A
   * non-PMA asset whose description parses as a PMO renders the org detail
   * instead (same route — orgs group markets, they are not markets). */
  function renderDetail(root, market) {
    if (!root) return;
    var doc = root.ownerDocument || document, myGen = ++gen, miss = missingBackends();
    dropOpenSubs();
    clearBox(root);
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    var key = (market !== undefined && market !== null) ? String(market) : "";
    try { key = decodeURIComponent(key); } catch (e) { /* raw key stands */ }
    wrap.appendChild(el(doc, "h1", "Prediction Market" + (key ? ": " + key : "")));
    if (miss) { showError(doc, wrap, "Prediction backend missing: " + miss + " failed to load."); return; }
    if (!key) { showError(doc, wrap, "unknown-asset", t("prediction.no_market_given", "No market given.")); return; }
    var self = function () { if (myGen === gen) renderDetail(root, market); };
    var status = showStatus(doc, wrap, "Loading " + key + "…");

    Asset.describe(key).then(function (info) {
      if (myGen !== gen) return;
      if (!info.is_prediction_market) {
        /* PMO branch (same route): a plain asset carrying pmo_object is a
         * parent org, not a market — render the org view. Anything else
         * keeps the not-a-pma error (showError maps it honestly). */
        var org = parsePMO(info.description || "");
        if (!org) throw new Error("not-a-pma");
        renderOrgDetail(doc, wrap, info, org, myGen);
        return null;
      }
      return Explorer.feeds([info.symbol]).then(function (feeds) {
        if (myGen !== gen) return;
        var feed = (feeds && feeds[0]) || null;
        var backId = (info.bitasset && info.bitasset.short_backing_asset) || "1.3.0";
        return backingSymbol(backId).then(function (backSym) {
          if (myGen !== gen) return;
          clearBox(wrap);
          wrap.appendChild(el(doc, "h1", "Prediction Market: " + info.symbol));
          var d = parsePMADescription(info.description || "");
          if (d.main) wrap.appendChild(el(doc, "p", d.main));
          if (d.condition) wrap.appendChild(el(doc, "p", "Condition: " + d.condition));
          if (d.expiry) wrap.appendChild(el(doc, "p", "Expiry: " + d.expiry));

          var dl = doc.createElement("dl");
          function row(k, v) {
            var dt = doc.createElement("dt"); dt.textContent = k; dl.appendChild(dt);
            var dd = doc.createElement("dd"); dd.textContent = v; dl.appendChild(dd);
          }
          row(t("prediction.asset", "Asset"), info.symbol + " (" + info.id + ")");
          row(t("prediction.issuer", "Issuer"), (info.issuer_name || info.issuer_id || "—"));
          row(t("prediction.backing_asset", "Backing asset"), backSym);
          if (info.supply_raw !== null && info.supply_raw !== undefined) {
            try { row(t("prediction.current_supply", "Current supply"), Format.formatAmount(info.supply_raw, info.precision) + " " + info.symbol); }
            catch (e) { row(t("prediction.current_supply", "Current supply"), String(info.supply_raw)); }
          }
          /* Settlement status: settlement_fund > 0 means globally settled
           * (#1 _filterMarkets :419-421). Asset.describe does not join the
           * fund, so re-read the bitasset object via Explorer.asset. */
          Explorer.asset(info.symbol).then(function (join) {
            if (myGen !== gen) return;
            var b = (join && join.bitasset) || {};
            var fund = (b.settlement_fund !== undefined && b.settlement_fund !== null) ? String(b.settlement_fund) : "0";
            var isSettled = false;
            try { isSettled = BigInt(fund) > 0n; } catch (e) { isSettled = fund !== "0"; }
            var sRow = doc.createElement("dt"); sRow.textContent = t("prediction.settlement", "Settlement");
            dl.appendChild(sRow);
            var sVal = doc.createElement("dd");
            sVal.textContent = isSettled ? t("prediction.settled_global_settlement_executed", "Settled (global settlement executed)") : t("prediction.open_not_settled", "Open (not settled)");
            dl.appendChild(sVal);
            if (isSettled) {
              var fRow = doc.createElement("dt"); fRow.textContent = t("prediction.settlement_fund", "Settlement fund");
              dl.appendChild(fRow);
              var fVal = doc.createElement("dd");
              try { fVal.textContent = Format.formatAmount(fund, info.precision) + " " + info.symbol; }
              catch (e) { fVal.textContent = fund; }
              dl.appendChild(fVal);
            }
          }).catch(function () { /* status row stays absent, never a crash */ });

          /* Feed / settlement price: raw pair + human string with BOTH
           * precisions (principle #6 — Format.formatPrice, never raw). */
          if (feed && feed.settlement_raw) {
            var sp = feed.settlement_raw, base = sp.base || sp.quote, quote = sp.quote || sp.base;
            var qp = (feed.quote_precision === null || feed.quote_precision === undefined)
              ? feed.base_precision : feed.quote_precision;
            /* Zero/missing legs mean an empty default feed, not a price. */
            var usable = base && quote && base.amount !== undefined && base.amount !== null &&
              quote.amount !== undefined && quote.amount !== null &&
              String(base.amount) !== "0" && String(quote.amount) !== "0";
            var human = null;
            if (usable) {
              try {
                human = Format.formatPrice(String(base.amount), feed.base_precision,
                  String(quote.amount), qp, 6);
              } catch (e) { human = null; }
            }
            row(t("prediction.settlement_price", "Settlement price"), human !== null ? (human + " " + backSym + " per " + info.symbol) : "No usable feed published");
          } else {
            row(t("prediction.settlement_price", "Settlement price"), "No feed published");
          }
          wrap.appendChild(dl);

          /* Implied-probability panel: mid-price preferred, last-trade
           * fallback, honest empty when neither exists (never 50% default).
           * Reads the same [backing, PMA] orientation as the list
           * enrichment (get_ticker [backId, info.id] latest = backing per
           * share). Paints loading first, then updates in place when the
           * ticker/book resolve (gen-guarded) — that update IS the
           * live-updating. textContent only. */
          var probH = el(doc, "h3", t("prediction.probability", "Implied probability"));
          wrap.appendChild(probH);
          var probBox = el(doc, "div", null, "prob-panel");
          wrap.appendChild(probBox);
          var probStatus = el(doc, "p", t("prediction.prob_loading", "Loading market price..."), "muted");
          probStatus.setAttribute("aria-live", "polite");
          probBox.appendChild(probStatus);
          /* paintProb: render one resolved probability (or the empty state).
           * WHY helper: single paint path for mid/last/empty, textContent
           * only. Params: res ({p, source, price} or null). No return. */
          function paintProb(res) {
            if (myGen !== gen) return;
            clearBox(probBox);
            if (!res) {
              probBox.appendChild(el(doc, "p",
                t("prediction.prob_no_price", "No market price yet - probability unavailable."), "muted"));
              return;
            }
            var evenLabel = t("prediction.even", "Even");
            var dl2 = doc.createElement("dl");
            function prow(k, v) {
              var dt = doc.createElement("dt"); dt.textContent = k; dl2.appendChild(dt);
              var dd = doc.createElement("dd"); dd.textContent = v; dl2.appendChild(dd);
            }
            prow(t("prediction.prob_implied", "Implied chance"), formatImplied(res.p));
            var dec = formatDecimal(res.p);
            prow(t("prediction.prob_decimal", "Decimal odds"), dec === null ? "—" : dec);
            var fr = formatFractional(res.p);
            prow(t("prediction.prob_fractional", "Fractional odds"), fr === null ? "—" : fr);
            var am = formatAmerican(res.p, evenLabel);
            prow(t("prediction.prob_american", "American odds"), am === null ? "—" : am);
            probBox.appendChild(dl2);
            var srcKey = res.source === "mid" ? "prediction.prob_source_mid" : "prediction.prob_source_last";
            var srcDflt = res.source === "mid" ? "Mid-price %(price)s" : "Last price %(price)s";
            var srcPrice = (typeof res.price === "number" && isFinite(res.price)) ? String(res.price) : "—";
            probBox.appendChild(el(doc, "p", t(srcKey, srcDflt, { price: srcPrice }), "muted"));
          }
          /* Resolve the market price: book top for the mid, ticker for the
           * fallback. Chain direct (no new Market global — this file owns no
           * Market dependency); failures resolve nullish so paintProb shows
           * the honest empty, never a throw. */
          (function fetchProb() {
            var dbP;
            try { dbP = Chain.db(); } catch (e) { paintProb(null); return; }
            dbP.then(function (dbId) {
              if (myGen !== gen) return null;
              var tkP = Chain.call(dbId, "get_ticker", [backId, info.id]).catch(function () { return null; });
              var bkP = Chain.call(dbId, "get_order_book", [backId, info.id, 10]).catch(function () { return null; });
              return Promise.all([tkP, bkP]);
            }).then(function (pair) {
              if (myGen !== gen || !pair) return;
              var tk = pair[0], bk = pair[1];
              var last = (tk && (tk.latest !== undefined && tk.latest !== null)) ? tk.latest : null;
              var bid = null, ask = null;
              try {
                if (bk && bk.bids && bk.bids[0] && bk.bids[0].price !== undefined && bk.bids[0].price !== null) bid = bk.bids[0].price;
              } catch (e) { bid = null; }
              try {
                if (bk && bk.asks && bk.asks[0] && bk.asks[0].price !== undefined && bk.asks[0].price !== null) ask = bk.asks[0].price;
              } catch (e) { ask = null; }
              if ((bid === null || bid === undefined) && tk) {
                bid = (tk.highest_bid !== undefined && tk.highest_bid !== null) ? tk.highest_bid
                  : ((tk.highestBid !== undefined && tk.highestBid !== null) ? tk.highestBid : null);
              }
              if ((ask === null || ask === undefined) && tk) {
                ask = (tk.lowest_ask !== undefined && tk.lowest_ask !== null) ? tk.lowest_ask
                  : ((tk.lowestAsk !== undefined && tk.lowestAsk !== null) ? tk.lowestAsk : null);
              }
              paintProb(probabilityFromBook(bid, ask, last));
            }).catch(function () { paintProb(null); });
          })();

          /* Quick-position via Instant Trade. GAP (documented, never faked):
           * InstantTradeUI.renderInstant(root, marketID) takes ONLY a
           * SELL_RECEIVE pair (instant-trade-ui.js parsePair — no side/query
           * param), so the market DIRECTION is the preset: Buy-YES spends
           * backing (sell=backing receive=shares), Buy-NO spends shares
           * (sell=shares receive=backing). No side flag is invented in the
           * URL — orientation carries the intent, stated in the hint below. */
          var qh = el(doc, "h3", t("prediction.quick_position", "Quick position via Instant Trade"));
          wrap.appendChild(qh);
          wrap.appendChild(el(doc, "p",
            t("prediction.quick_position_hint", "Direction sets the convert side: YES spends backing, NO spends shares. Instant Trade has no side parameter, so the market direction is the preset."), "muted"));
          var qrow = el(doc, "div", null, "toolbar");
          wrap.appendChild(qrow);
          function quickLink(label, sellSym, recvSym) {
            var link = doc.createElement("a");
            link.href = "#/instant-trade/" + encodeURIComponent(sellSym) + "_" + encodeURIComponent(recvSym);
            link.textContent = label;
            touchable(link);
            link.style.display = "inline-block";
            qrow.appendChild(link);
            return link;
          }
          quickLink(t("prediction.buy_yes", "Buy YES"), backSym, info.symbol);
          quickLink(t("prediction.buy_no", "Buy NO"), info.symbol, backSym);

          var h = el(doc, "h3", t("prediction.take_a_position", "Take a position")); wrap.appendChild(h);
          wrap.appendChild(el(doc, "p", "YES and NO are ordinary limit orders on the " +
            info.symbol + " / " + backSym + " market. You trade from the desk — nothing here signs.", "muted"));
          var desk = doc.createElement("a");
          desk.href = "#/market/" + encodeURIComponent(info.symbol) + "_" + encodeURIComponent(backSym);
          desk.textContent = t("account.open_prefix", "Open ") + info.symbol + " / " + backSym + t("prediction.desk_suffix", " desk");
          touchable(desk); wrap.appendChild(desk);
          var more = el(doc, "p", "", "muted"); wrap.appendChild(more);
          var a1 = doc.createElement("a"); a1.href = "#/asset/" + encodeURIComponent(info.symbol);
          a1.textContent = t("prediction.asset_detail", "Asset detail"); more.appendChild(a1);
          more.appendChild(doc.createTextNode(" · "));
          var a2 = doc.createElement("a"); a2.href = "#/prediction";
          a2.textContent = t("prediction.all_prediction_markets", "All prediction markets"); more.appendChild(a2);
        });
      });
    }).catch(function (e) {
      if (myGen !== gen) return;
      status.textContent = "";
      showError(doc, wrap, e, t("prediction.could_not_load_this_prediction_market", "Could not load this prediction market."));
      retryButton(doc, wrap, self);
      autoRetryOnOpen(myGen, self);
    });
    autoRetryOnOpen(myGen, self);
  }

  return {
    renderList: renderList,
    renderDetail: renderDetail,
    _test: {
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
      formatAmerican: formatAmerican
    }
  };
})();

if (typeof module !== "undefined") { module.exports = PredictionUI; }
