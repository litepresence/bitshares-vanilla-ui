/* Credit: credit offers (1.21.x) + deals (1.22.x) + margin/call-order (1.8.x) reads, builders, rate math.
 * Same-T funds (1.20.x) live in builders/credit-samet.js (split OUT on the ~380-line cap — pre-authorized).
 * Owns: offer/deal list/by-owner/by-asset/by-borrower reads (symbols joined via lookup_asset_symbols), margin
 *   positions via the PROVEN method (ambiguity I: get_margin_positions first, get_call_orders_by_account
 *   fallback; see positionsMethod), seven builders for ops 3/69/70/71/72/73/76 ([opId, opData], zero
 *   fee for live fee-fill), THE ONLY fee-rate converters at denom 1M + TCR converters at divisor
 *   1000, integer credit-fee + duration helpers, fee via Tx.fee (filled IN PLACE — F-FEEFILL lesson),
 *   sendAndProve (vote-pattern). No DOM, no signing (WIF passes opaquely to Tx.sign) — views in
 *   credit-ui.js. Consumes: Chain.db/.call/.net, Tx.fee/.sign; exposes global Credit only.
 *   Created by: building-vanilla-slices skill, slice-13-credit plan Task 2.
 * CHAIN TRUTH (#4 wins): op ids <- operations.hpp:59/:125-133 (74 VIRTUAL never signed, 77 OUT slice-14);
 *   op-3 fields <- market.hpp:171-197 (NO expiration — MarketsActions' is stale); credit fields <-
 *   credit_offer.hpp:36-64/:70-82/:88-116/:135-157/:162-177/:215-228; FEE_RATE_DENOM=1000000 <-
 *   config.hpp:121 (#2's /10000 conflicts — rejected, ambiguity A); auto_repay 0/1/2 <-
 *   credit_offer.hpp:118-129; spaces 1.8/1.21/1.22 <- types.hpp:371/:384-385; reads <-
 *   database_api.hpp:538/:548/:591/:947-1010/:1027-1114 (all pageable). Shapes mirror #1
 *   CreditOfferActions.js:32-263 + BorrowModal.jsx:487-545 (Barter = slice-14 proposal UI, nothing
 *   here). TCR divisor 1000 <- BorrowModal.jsx:57-60 (display /1000) + :478-481 (build *1000),
 *   ambiguity G PROVEN (MCR reads /1000 at :157-167 agree). Rate math ports the SHAPE of #1
 *   CreateModal.jsx:374 + EditModal.jsx:471 + CreditDebtList:452-453, floats rewritten as string/BigInt
 *   math. Wire keys mirror #3 bitshares-api.js:2355-2382/:3436-3577 (canonical ONLY — stale
 *   offer_to_update/new_X/repay_period_seconds/offer_expiry_time NOT ported).
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings (op-3 deltas may be "-"-prefixed: negative
 *   debt = borrow-more, WARNED in views); rates RAW u32; TCR RAW u16. Number() NEVER touches money.
 * NAMED ERRORS: not-connected / unknown-offer / unknown-deal / unknown-account / unknown-asset /
 *   method-missing / rate-trap / tcr-unproven / same-tx-unproven / no-safe-position.
 */
var Credit = (function () {
  "use strict";
  /**
   * @typedef {import('./types.js').OpTuple} OpTuple
   * @typedef {import('./types.js').FeeAssetId} FeeAssetId
   * @typedef {import('./types.js').RawInt} RawInt
   * @typedef {import('./types.js').ChainObjectId} ChainObjectId
   */
  var CORE_ASSET = "1.3.0";
  /* #4 denom: u32 1000 = 0.1%, 10000 = 1% (config.hpp:121). TCR_DIVISOR 1000
   * proven Task-2 Step 1 (BorrowModal.jsx:57-60/:478-481, ambiguity G). */
  var FEE_RATE_DENOM = 1000000, TCR_DIVISOR = 1000;
  var OFFER_RE = /^1\.21\.\d+$/, DEAL_RE = /^1\.22\.\d+$/;
  var CALL_RE = /^1\.8\.\d+$/, ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var DIGITS_RE = /^\d+$/, SIGNED_RE = /^-?\d+$/;
  var PROVE_TIMEOUT_MS = 60000, PROVE_INTERVAL_MS = 2500;
  var PAGE_DEFAULT = 101, CALL_PAGE = 300; /* api_limit_get_credit_offers/samet (101); call_orders (300) */
  var AUTO_REPAY_WORDS = ["no auto-repayment", "repay in full only", "allow partial repayment"];
  var _marginForm = null; /* ambiguity-I probe cache: "margin" | "by-account" (see positionsMethod) */

  function _sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function _assertId(id, re, name) { if (typeof id !== "string" || !re.test(id)) throw new Error(name + " must match " + re + ", got: " + JSON.stringify(id)); }
  function _assertDigits(raw, name) { if (typeof raw !== "string" || !DIGITS_RE.test(raw)) throw new Error(name + " must be a digit string, got: " + JSON.stringify(raw)); }
  function _assertSigned(raw, name) { if (typeof raw !== "string" || !SIGNED_RE.test(raw)) throw new Error(name + " must be an integer string, got: " + JSON.stringify(raw)); }
  function _assertU32(n, name) { if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) throw new Error(name + " must be u32, got: " + JSON.stringify(n)); }
  function _assertU16(n, name) { if (!Number.isInteger(n) || n < 0 || n > 0xFFFF) throw new Error(name + " must be u16, got: " + JSON.stringify(n)); }
  function _isSocketError(e) { return /not connected|socket closed|connect timeout/i.test(String((e && e.message) || e || "")); }
  function _isMissingMethod(e) { return /unknown method|method not found|no method|bad method/i.test(String((e && e.message) || e || "")); }
  function _isUnknownAccount(e) { return /tied to an account|unknown account|no such account/i.test(String((e && e.message) || e || "")); }
  /* Numeric object-id compare (spaces equal in practice) — map determinism. */
  function _cmpIds(a, b) {
    var pa = a.split("."), pb = b.split(".");
    for (var i = 0; i < 3; i++) { var d = parseInt(pa[i], 10) - parseInt(pb[i], 10); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }
  /* One database-API round trip; socket failures -> "not-connected", else verbatim. */
  async function _dbCall(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); }
    catch (e) {
      if (_isSocketError(e)) throw new Error("not-connected");
      if (_isMissingMethod(e)) throw new Error("method-missing (" + method + ")");
      if (_isUnknownAccount(e)) throw new Error("unknown-account");
      throw e;
    }
  }  /* ISO "YYYY-MM-DDTHH:MM:SS" passthrough (Task-1 serializeTimestamp consumes it). */
  function _assertIso(s, name) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) || isNaN(Date.parse(s))) throw new Error(name + " must be ISO datetime");
    return s; }

  /* Integer percent core shared by rate (4 places, denom 1M) + TCR (3 places, divisor 1000) converters. */
  function _uToPct(u, places, max, name) {
    if (!Number.isInteger(u) || u < 0 || u > max) throw new Error(name + " out of range, got: " + JSON.stringify(u));
    var s = String(u);
    while (s.length < places + 1) s = "0" + s;
    var head = s.slice(0, -places).replace(/^0+(?=\d)/, ""), tail = s.slice(-places).replace(/0+$/, "");
    return tail ? head + "." + tail : head;
  }
  /* Human percent -> integer units at places decimals ("1.5" -> 150 at 2 places) via string math, never float. Fails on malformed input or range overflow. */
  function _pctToU(human, places, max, name) {
    var m = new RegExp("^(\\d+)(?:\\.(\\d{1," + places + "}))?$").exec(String(human).trim());
    if (!m) throw new Error("bad " + name + " (0-100, <=" + places + " decimals): " + JSON.stringify(human));
    var frac = m[2] || "";
    while (frac.length < places) frac += "0";
    var n = parseInt(((m[1] + frac).replace(/^0+(?=\d)/, "") || "0"), 10);
    if (n < 0 || n > max) throw new Error(name + " out of range: " + JSON.stringify(human));
    return n;
  }
  /* u32 fee-rate units <-> human percent ("1000" <-> "0.1"; pad-don't-float, slice-10 B1).
   * THE ONLY rate converters (human = units / 10000, string math). TCR u16 pair below it. */
  function rateUnitsToHuman(u) { return _uToPct(u, 4, FEE_RATE_DENOM, "rate-trap (rate exceeds 100%)"); }
  function rateHumanToUnits(human) { return _pctToU(human, 4, FEE_RATE_DENOM, "rate"); }
  /* TCR u16 <-> human percent at divisor 1000 ("1750" <-> "1.75"; ambiguity G proven). */
  function tcrUnitsToHuman(u) { return _uToPct(u, 3, 0xFFFF, "tcr units"); }
  function tcrHumanToUnits(human) { return _pctToU(human, 3, 0xFFFF, "TCR"); }
  /* Credit fee quote: ceil(amount * rate / DENOM) in BigInt (ports the SHAPE
   * of #1 CreditDebtList.jsx:452-453, floats rewritten). Used for accept/repay previews. */
  function creditFee(amount_raw, rate_units) {
    _assertDigits(amount_raw, "amount_raw"); _assertU32(rate_units, "rate_units");
    var a = BigInt(amount_raw), r = BigInt(rate_units), d = BigInt(FEE_RATE_DENOM);
    return ((a * r + d - 1n) / d).toString();
  }
  /** Seconds -> largest whole unit word ("259200" -> "3 days"); remainders stay seconds. No moment.
   * @param {any} seconds
   * @returns {string} */
  function durToHuman(seconds) {
    var s = typeof seconds === "string" ? parseInt(seconds, 10) : seconds;
    if (!Number.isInteger(s) || s < 0) throw new Error("seconds must be a non-negative integer");
    var units = [[604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
    for (var i = 0; i < units.length; i++) {
      if (s >= /** @type {number} */ (units[i][0]) && s % /** @type {number} */ (units[i][0]) === 0) { var n = s / /** @type {number} */ (units[i][0]); return n + " " + units[i][1] + (n === 1 ? "" : "s"); } }
    return s + " second" + (s === 1 ? "" : "s");
  }
  /* Human duration -> seconds ("3 days" / "3d" / "90 min" / "3600" / 3600). No humanize-duration. */
  function durToSeconds(human) {
    if (typeof human === "number" && Number.isInteger(human) && human >= 0) return human;
    var m = /^\s*(\d+)\s*([a-z]*)\s*$/i.exec(String(human));
    if (!m) throw new Error("bad duration: " + JSON.stringify(human));
    var n = parseInt(m[1], 10), u = m[2].toLowerCase();
    var mult = (u === "" || u === "s" || u.indexOf("sec") === 0) ? 1
      : (u === "m" || u.indexOf("min") === 0) ? 60
      : (u === "h" || u.indexOf("hour") === 0) ? 3600
      : (u === "d" || u.indexOf("day") === 0) ? 86400
      : (u === "w" || u.indexOf("week") === 0) ? 604800 : null;
    if (mult === null) throw new Error("bad duration unit: " + JSON.stringify(human));
    return n * mult;
  }
  /* auto_repay u8 -> plain word (Reference #7: 0/1/2). */
  function autoRepayWord(n) {
    if (n !== 0 && n !== 1 && n !== 2) throw new Error("auto_repay must be 0/1/2, got: " + JSON.stringify(n));
    return AUTO_REPAY_WORDS[n];
  }

  /* lookup_asset_symbols join: {sym, prec} per leg; misses degrade to bare ids (never a crash). */
  async function _joinAssets(rows, legs) {
    var ids = [], seen = {};
    rows.forEach(function (r) { legs.forEach(function (leg) { var id = r && r[leg]; if (typeof id === "string" && !seen[id]) { seen[id] = 1; ids.push(id); } }); });
    var byId = {};
    if (ids.length) { var objs = await _dbCall("lookup_asset_symbols", [ids]); (objs || []).forEach(function (a) { if (a && a.id) byId[a.id] = a; }); }
    return byId;
  }
  /* lookup_asset_symbols join -> {sym, prec} display pair (misses degrade to the bare id, never a crash). */
  function _legJoin(byId, id) {
    var a = byId[id] || {};
    return { sym: a.symbol || String(id), prec: (typeof a.precision === "number" ? a.precision : null) };
  }
  /* Raw offer -> plain row (amounts raw strings; maps kept RAW for the detail view). */
  function _normOffer(o) {
    if (!o || typeof o !== "object" || !o.id) throw new Error("unknown-offer");
    return { id: String(o.id), owner: String(o.owner_account), asset_id: String(o.asset_type), total_raw: String(o.total_balance),
      current_raw: String(o.current_balance), rate_units: o.fee_rate, max_dur_sec: o.max_duration_seconds,
      min_deal_raw: String(o.min_deal_amount), enabled: !!o.enabled, auto_disable_time: (o.auto_disable_time || null),
      collateral_raw: (o.acceptable_collateral || []), borrowers_raw: (o.acceptable_borrowers || []) };
  }
  /* Raw deal -> plain row (amounts raw strings; debt/collateral id+amount pairs per #4). */
  function _normDeal(d) {
    if (!d || typeof d !== "object" || !d.id) throw new Error("unknown-deal");
    return { id: String(d.id), borrower: String(d.borrower), offer_id: String(d.offer_id), offer_owner: String(d.offer_owner),
      debt_id: String(d.deal_debt_asset || d.debt_asset), debt_raw: String(d.deal_debt_amount !== undefined ? d.deal_debt_amount : d.debt_amount),
      coll_id: String(d.deal_collateral_asset || d.collateral_asset),
      coll_raw: String(d.deal_collateral_amount !== undefined ? d.deal_collateral_amount : d.collateral_amount),
      rate_units: d.fee_rate, repay_time: (d.latest_repay_time || null), auto_repay: d.auto_repay };
  }
  /* Single object read by 1.21.x / 1.22.x id. Unknown -> named error. Single offer / deal by id. */
  async function _getOne(id, re, kind, norm) {
    _assertId(id, re, "id");
    var rows = await _dbCall("get_objects", [[id]]);
    if (!rows || !rows[0]) throw new Error(kind + " (" + id + ")");
    return norm(rows[0]);
  }
  /* Single credit offer by 1.21.x id. Returns: the normalized row. Fails "unknown-offer". */
  async function offer(id) { return _getOne(id, OFFER_RE, "unknown-offer", _normOffer); }
  /* Single credit deal by 1.22.x id. Returns: the normalized row. Fails "unknown-deal". */
  async function deal(id) { return _getOne(id, DEAL_RE, "unknown-deal", _normDeal); }
  /* Offer lists (all three share one join path): list / by-owner / by-asset.
   * Assets join via lookup_asset_symbols; owner ids join via get_accounts
   * (batch, one round trip — names render as "name (id)", raw id in title).
   * Collateral leg ids join too so the table shows symbols, not bare 1.3.x.
   * Misses degrade honestly (bare id), never a crash. */
  async function _offerRows(rows) {
    var normed = rows.map(_normOffer), byId = await _joinAssets(normed, ["asset_id"]);
    /* Collateral leg join: flatten [[assetId, price]...] ids into the join. */
    try {
      var cids = [], seen = {};
      normed.forEach(function (r) { (r.collateral_raw || []).forEach(function (c) {
        var id = c && c[0]; if (typeof id === "string" && !seen[id]) { seen[id] = 1; cids.push(id); } }); });
      if (cids.length) {
        var cobjs = await _dbCall("lookup_asset_symbols", [cids]);
        (cobjs || []).forEach(function (a) { if (a && a.id && !byId[a.id]) byId[a.id] = a; });
      }
    } catch (e) { /* collateral symbols stay bare ids */ }
    /* Owner name join: batch get_accounts, id -> name. */
    var acctById = {};
    try {
      var oids = [], oseen = {};
      normed.forEach(function (r) { if (typeof r.owner === "string" && !oseen[r.owner]) { oseen[r.owner] = 1; oids.push(r.owner); } });
      if (oids.length) {
        var arows = await _dbCall("get_accounts", [oids]);
        (arows || []).forEach(function (a) { if (a && a.id) acctById[a.id] = a.name || a.id; });
      }
    } catch (e) { /* owner names stay bare ids */ }
    return normed.map(function (r) {
      var l = _legJoin(byId, r.asset_id); r.sym = l.sym; r.prec = l.prec;
      r.owner_name = acctById[r.owner] || r.owner;
      r.collateral_syms = (r.collateral_raw || []).map(function (c) {
        var id = c && c[0]; var a = (id && byId[id]) || {};
        return (a.symbol || String(id));
      });
      return r;
    });
  }
  /* Paged offer list + symbol join (plan: {limit?, startId?} -> rows). */
  async function offers(opts) {
    opts = opts || {};
    var limit = (opts.limit === undefined || opts.limit === null) ? PAGE_DEFAULT : opts.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_DEFAULT) throw new Error("limit must be 1-" + PAGE_DEFAULT);
    return _offerRows((await _dbCall("list_credit_offers", [limit, opts.startId || null])) || []);
  }
  /* Offers by owner name-or-id / by asset sym-or-id. */
  async function offersByOwner(nameOrId, opts) {
    opts = opts || {};
    return _offerRows((await _dbCall("get_credit_offers_by_owner", [String(nameOrId), opts.limit || null, opts.startId || null])) || []);
  }
  async function offersByAsset(symOrId, opts) {
    opts = opts || {};
    return _offerRows((await _dbCall("get_credit_offers_by_asset", [String(symOrId), opts.limit || null, opts.startId || null])) || []);
  }
  /* Deal queries (by offer / borrower / offer-owner) with debt+collateral joins.
   * Borrower ids join via get_accounts (batch) so tables render names. */
  async function _deals(method, key, opts) {
    opts = opts || {};
    var rows = (await _dbCall(method, [String(key), opts.limit || null, opts.startId || null])) || [];
    var normed = rows.map(_normDeal), byId = await _joinAssets(normed, ["debt_id", "coll_id"]);
    var acctById = {};
    try {
      var bids = [], bseen = {};
      normed.forEach(function (r) { [r.borrower, r.offer_owner].forEach(function (id) {
        if (typeof id === "string" && !bseen[id]) { bseen[id] = 1; bids.push(id); } }); });
      if (bids.length) {
        var arows = await _dbCall("get_accounts", [bids]);
        (arows || []).forEach(function (a) { if (a && a.id) acctById[a.id] = a.name || a.id; });
      }
    } catch (e) { /* borrower names stay bare ids */ }
    return normed.map(function (r) { var d = _legJoin(byId, r.debt_id), c = _legJoin(byId, r.coll_id);
      r.debt_sym = d.sym; r.debt_prec = d.prec; r.coll_sym = c.sym; r.coll_prec = c.prec;
      r.borrower_name = acctById[r.borrower] || r.borrower;
      r.offer_owner_name = acctById[r.offer_owner] || r.offer_owner; return r; });
  }
  /* Deals under one offer id (debt+collateral symbols joined). Params: offerId 1.21.x, opts {limit, startId}. */
  async function dealsByOffer(offerId, opts) { _assertId(offerId, OFFER_RE, "offerId"); return _deals("get_credit_deals_by_offer_id", offerId, opts); }
  /**
   * Deals by borrower name-or-id (debt+collateral symbols joined). Uses the
   * EXISTING database call get_credit_deals_by_borrower (#4
   * database_api.hpp:1069 "by the name or ID of a borrower account") — no
   * invented method. Name-or-id like offersByOwner, so no id assert; paging
   * via opts, chain-capped at api_limit_get_credit_offers (101).
   * @param {string} nameOrId borrower account name or 1.2.x id
   * @param {any} [opts] paging {limit, startId}
   * @returns {Promise<any[]>} normalized deal rows (borrower_name joined)
   */
  async function dealsByBorrower(nameOrId, opts) { return _deals("get_credit_deals_by_borrower", String(nameOrId), opts); }
  /* Raw call-order -> plain row (collateral/debt accept {amount,asset_id} or raw+id shapes). */
  function _normPos(c) {
    if (!c || typeof c !== "object" || !c.id) throw new Error("unknown-position");
    function leg(v, idKey) {
      if (v && typeof v === "object" && v.asset_id !== undefined) return { raw: String(v.amount), id: String(v.asset_id) };
      return { raw: String(v), id: String(c[idKey] || "") };
    }
    var coll = leg(c.collateral, "collateral_asset"), debt = leg(c.debt, "debt_asset");
    return { call_id: String(c.id), borrower: String(c.borrower), coll_raw: coll.raw, coll_id: coll.id,
      debt_raw: debt.raw, debt_id: debt.id, call_price: (c.call_price || null),
      tcr_units: (c.target_collateral_ratio === undefined ? null : c.target_collateral_ratio) };
  }
  /* Accepted margin-read form cache ("unprobed" until first positions call). */
  function positionsMethod() { return _marginForm || "unprobed"; }
  /* Margin positions for an account (ambiguity I: margin first, by-account fallback; never a crash). */
  async function positions(nameOrId) {
    var key = String(nameOrId);
    async function viaMargin() { return (await _dbCall("get_margin_positions", [key])) || []; }
    async function viaAccount() { return (await _dbCall("get_call_orders_by_account", [key, CALL_PAGE])) || []; }
    var raw;
    if (_marginForm === "by-account") { raw = await viaAccount(); }
    else {
      try { raw = await viaMargin(); _marginForm = "margin"; }
      catch (e) {
        if (String(e.message || "").indexOf("method-missing") !== 0) throw e;
        raw = await viaAccount(); _marginForm = "by-account";
      }
    }    var normed = raw.map(_normPos), byId = await _joinAssets(normed, ["coll_id", "debt_id"]);
    return normed.map(function (r) { var c = _legJoin(byId, r.coll_id), d = _legJoin(byId, r.debt_id);
      r.coll_sym = c.sym; r.coll_prec = c.prec; r.debt_sym = d.sym; r.debt_prec = d.prec; return r; });
  }

  /* Op-3 margin adjust. Delta legs SIGNED (negative debt = borrow-more, WARNED in views).
   * TCR null -> empty extensions; set -> {target_collateral_ratio} (Task-1 both-forms). NO expiration (#4 has none). */
  function buildCallUpdate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.collId, ASSET_RE, "collId"); _assertId(args.debtId, ASSET_RE, "debtId");
    _assertSigned(args.collRaw, "collRaw"); _assertSigned(args.debtRaw, "debtRaw");
    /** @type {any} */
    var ext = [];
    if (args.tcrUnitsOrNull !== null && args.tcrUnitsOrNull !== undefined && String(args.tcrUnitsOrNull) !== "") {
      _assertU16(args.tcrUnitsOrNull, "tcrUnitsOrNull");
      ext = { target_collateral_ratio: args.tcrUnitsOrNull };
    }
    return [3, { fee: { amount: "0", asset_id: CORE_ASSET }, funding_account: args.accountId,
      delta_collateral: { amount: args.collRaw, asset_id: args.collId },
      delta_debt: { amount: args.debtRaw, asset_id: args.debtId }, extensions: ext }];
  }
  /* Collateral map entries -> sorted [[assetId, price]] pairs (variant + serializer form; determinism). */
  function _sortCollateral(rows) {
    var pairs = (rows || []).map(function (r) {
      _assertId(r.assetId, ASSET_RE, "collateral assetId");
      var p = r.price || {};
      ["base", "quote"].forEach(function (side) {
        if (!p[side] || typeof p[side] !== "object") throw new Error("collateral price needs base+quote {amount, asset_id}");
        _assertDigits(String(p[side].amount), "price " + side); _assertId(String(p[side].asset_id), ASSET_RE, "price " + side); });
      return [r.assetId, { base: { amount: String(p.base.amount), asset_id: String(p.base.asset_id) },
        quote: { amount: String(p.quote.amount), asset_id: String(p.quote.asset_id) } }]; });
    pairs.sort(function (a, b) { return _cmpIds(a[0], b[0]); });
    return pairs;
  }
  /* Borrower map entries -> sorted [[accountId, maxRaw]] pairs. */
  function _sortBorrowers(rows) {
    var pairs = (rows || []).map(function (r) {
      _assertId(r.accountId, ACCOUNT_RE, "borrower accountId"); _assertDigits(String(r.maxRaw), "borrower maxRaw");
      return [r.accountId, String(r.maxRaw)];
    });
    pairs.sort(function (a, b) { return _cmpIds(a[0], b[0]); });
    return pairs;
  }
  /* Op-69 credit offer create (rate via rateHumanToUnits; maps sorted by id). */
  function buildOfferCreate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.assetId, ASSET_RE, "assetId");
    _assertDigits(args.balanceRaw, "balanceRaw"); _assertDigits(args.minDealRaw, "minDealRaw");
    if (BigInt(args.balanceRaw) <= 0n) throw new Error("balance must be > 0");
    if (BigInt(args.minDealRaw) <= 0n) throw new Error("min deal must be > 0");
    var maxDur = durToSeconds(args.maxDurSec);
    if (!(maxDur > 0)) throw new Error("max duration must be > 0");
    return [69, { fee: { amount: "0", asset_id: CORE_ASSET }, owner_account: args.accountId, asset_type: args.assetId, balance: args.balanceRaw,
      fee_rate: rateHumanToUnits(args.rateHuman), max_duration_seconds: maxDur, min_deal_amount: args.minDealRaw, enabled: !!args.enabled,
      auto_disable_time: _assertIso(args.autoDisableIso, "autoDisableIso"),
      acceptable_collateral: _sortCollateral(args.collateral), acceptable_borrowers: _sortBorrowers(args.borrowers), extensions: [] }];
  }
  /* Op-71 credit offer update (all-optional; unchanged fields stay null, never zero-filled). */
  function buildOfferUpdate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.offerId, OFFER_RE, "offerId");
    var changed = 0, out = { fee: { amount: "0", asset_id: CORE_ASSET }, owner_account: args.accountId, offer_id: args.offerId,
      delta_amount: null, fee_rate: null, max_duration_seconds: null, min_deal_amount: null, enabled: null,
      auto_disable_time: null, acceptable_collateral: null, acceptable_borrowers: null, extensions: [] };
    function has(v) { return v !== null && v !== undefined && String(v) !== ""; }
    if (has(args.deltaRawOrNull)) { _assertSigned(args.deltaRawOrNull, "deltaRawOrNull"); _assertId(args.deltaAssetId, ASSET_RE, "deltaAssetId");
      out.delta_amount = { amount: String(args.deltaRawOrNull), asset_id: args.deltaAssetId }; changed++; }
    if (has(args.rateHumanOrNull)) { out.fee_rate = rateHumanToUnits(args.rateHumanOrNull); changed++; }
    if (has(args.maxDurSecOrNull)) { var d = durToSeconds(args.maxDurSecOrNull); if (!(d > 0)) throw new Error("max duration must be > 0"); out.max_duration_seconds = d; changed++; }
    if (has(args.minDealRawOrNull)) { _assertDigits(args.minDealRawOrNull, "minDealRawOrNull"); out.min_deal_amount = String(args.minDealRawOrNull); changed++; }
    if (args.enabledOrNull === true || args.enabledOrNull === false) { out.enabled = args.enabledOrNull; changed++; }
    if (has(args.autoDisableIsoOrNull)) { out.auto_disable_time = _assertIso(args.autoDisableIsoOrNull, "autoDisableIsoOrNull"); changed++; }
    if (args.collateralOrNull !== null && args.collateralOrNull !== undefined) { out.acceptable_collateral = _sortCollateral(args.collateralOrNull); changed++; }
    if (args.borrowersOrNull !== null && args.borrowersOrNull !== undefined) { out.acceptable_borrowers = _sortBorrowers(args.borrowersOrNull); changed++; }
    if (!changed) throw new Error("update needs >= 1 field");
    return [71, out];
  }
  /* Op-70 credit offer delete (fee 0 observed live — shown explicitly in the confirm). */
  function buildOfferDelete(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.offerId, OFFER_RE, "offerId");
    return [70, { fee: { amount: "0", asset_id: CORE_ASSET }, owner_account: args.accountId, offer_id: args.offerId, extensions: [] }]; }
  /* Op-72 credit offer accept (spawns the deal — there is NO deal_create op).
   * autoRepayOrNull null -> empty extensions (proven first, ambiguity C); set 0/1/2 ->
   * {auto_repay} object form (Task-1 serializer supports both). */
  function buildAccept(args) {
    args = args || {};
    _assertId(args.borrowerId, ACCOUNT_RE, "borrowerId"); _assertId(args.offerId, OFFER_RE, "offerId");
    _assertId(args.borrowAssetId, ASSET_RE, "borrowAssetId"); _assertId(args.collId, ASSET_RE, "collId");
    _assertDigits(args.borrowRaw, "borrowRaw"); _assertDigits(args.collRaw, "collRaw");
    if (BigInt(args.borrowRaw) <= 0n) throw new Error("borrow amount must be > 0");
    if (BigInt(args.collRaw) <= 0n) throw new Error("collateral must be > 0");
    var minDur = durToSeconds(args.minDurSec);
    if (!(minDur > 0)) throw new Error("min duration must be > 0");
    /** @type {any} */
    var ext = [];
    if (args.autoRepayOrNull !== null && args.autoRepayOrNull !== undefined && String(args.autoRepayOrNull) !== "") {
      if (args.autoRepayOrNull !== 0 && args.autoRepayOrNull !== 1 && args.autoRepayOrNull !== 2) throw new Error("auto_repay must be 0/1/2");
      ext = { auto_repay: args.autoRepayOrNull };
    }
    return [72, { fee: { amount: "0", asset_id: CORE_ASSET }, borrower: args.borrowerId, offer_id: args.offerId,
      borrow_amount: { amount: args.borrowRaw, asset_id: args.borrowAssetId }, collateral: { amount: args.collRaw, asset_id: args.collId },
      max_fee_rate: rateHumanToUnits(args.maxRateHuman), min_duration_seconds: minDur, extensions: ext }];
  }
  /* Op-73 deal repay (repay_amount + credit_fee BOTH explicit). */
  function buildDealRepay(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.dealId, DEAL_RE, "dealId");
    _assertId(args.assetId, ASSET_RE, "assetId"); _assertDigits(args.repayRaw, "repayRaw"); _assertDigits(args.feeRaw, "feeRaw");
    if (BigInt(args.repayRaw) <= 0n) throw new Error("repay amount must be > 0");
    return [73, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, deal_id: args.dealId,
      repay_amount: { amount: args.repayRaw, asset_id: args.assetId }, credit_fee: { amount: args.feeRaw, asset_id: args.assetId }, extensions: [] }];
  }
  /* Op-76 deal update (wire field `account`, NOT borrower — #3's committee-account trap). */
  function buildDealUpdate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.dealId, DEAL_RE, "dealId");
    if (args.autoRepay !== 0 && args.autoRepay !== 1 && args.autoRepay !== 2) throw new Error("auto_repay must be 0/1/2, got: " + JSON.stringify(args.autoRepay));
    return [76, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, deal_id: args.dealId, auto_repay: args.autoRepay, extensions: [] }];
  }

  /* Live fee via Tx.fee (chain answers); opPair fee-filled IN PLACE. Returns {amount, asset_id}. */
  async function fee(opPair, feeAssetId) {
    if (!Array.isArray(opPair) || !Number.isInteger(opPair[0]) || !opPair[1]) throw new Error("opPair must be [opId, opData]");
    if (typeof Tx === "undefined" || !Tx.fee) throw new Error("tx-unavailable");
    var ans = await Tx.fee(opPair[0], opPair[1], feeAssetId || CORE_ASSET);
    opPair[1].fee = { amount: String(ans.amount), asset_id: ans.asset_id };
    return { amount: String(ans.amount), asset_id: ans.asset_id }; }
  /* Sign + send + prove (vote-pattern). Rejections carry sendRejected (safe retry); accepted-but-unproven does NOT. */
  async function sendAndProve(signedTx, wif, proveFn) {
    if (!signedTx || !Array.isArray(signedTx.operations) || !signedTx.operations.length) throw new Error("signedTx has no operations");
    if (!Tx.wifOk(wif)) throw new Error("wallet-locked");
    if (typeof proveFn !== "function") throw new Error("proveFn must be a function");
    if (typeof Tx === "undefined" || !Tx.signRouted) throw new Error("tx-unavailable");
    var routed = await Tx.signRouted(signedTx, wif, {});
    var txSigned = routed.signed;
    var via;
    if (routed.delegated) {
      /* Extension mode: the SW signed + broadcast behind approval — skip
       * the local broadcast; the prove loop below runs unchanged. */
      via = ((routed.proof && routed.proof.via) ? routed.proof.via : "extension") + "+extension";
    } else {
    var netId; try { netId = await Chain.net(); } catch (e) { throw new Error("not-connected"); }
    via = "broadcast_transaction_with_callback";
    var callbackId = (Math.random() * 4294967296) >>> 0;
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, txSigned]);
    } catch (e) {
      via = "broadcast_transaction";
      try { await Chain.call(netId, "broadcast_transaction", [txSigned]); } catch (e2) {
        e2.sendRejected = true;
        throw e2;
      }
    }
    }
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    for (;;) {
      var ok = null;
      try { ok = await proveFn(); } catch (e) { ok = null; }
      if (ok) return { via: via + "+re-read", proof: ok };
      if (Date.now() >= deadline) throw new Error("Sent (" + via + ") but the re-read proof was not observed within " +
        (PROVE_TIMEOUT_MS / 1000) + "s; check state before retrying (do NOT blindly rebroadcast).");
      await _sleep(PROVE_INTERVAL_MS);
    }
  }

  return { offer: offer, deal: deal, offers: offers, offersByOwner: offersByOwner, offersByAsset: offersByAsset,
    dealsByOffer: dealsByOffer, dealsByBorrower: dealsByBorrower,
    positions: positions, positionsMethod: positionsMethod,
    rateUnitsToHuman: rateUnitsToHuman, rateHumanToUnits: rateHumanToUnits,
    tcrUnitsToHuman: tcrUnitsToHuman, tcrHumanToUnits: tcrHumanToUnits,
    creditFee: creditFee, durToHuman: durToHuman, durToSeconds: durToSeconds, autoRepayWord: autoRepayWord,
    buildCallUpdate: buildCallUpdate,
    buildOfferCreate: buildOfferCreate, buildOfferUpdate: buildOfferUpdate, buildOfferDelete: buildOfferDelete,
    buildAccept: buildAccept, buildDealRepay: buildDealRepay, buildDealUpdate: buildDealUpdate,
    fee: fee, sendAndProve: sendAndProve,
    FEE_RATE_DENOM: FEE_RATE_DENOM, TCR_DIVISOR: TCR_DIVISOR };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.Credit === "undefined") { globalThis.Credit = Credit; }
if (typeof module !== "undefined") { module.exports = Credit; }
