/* Pool: liquidity-pool (1.19.x) reads + op-data builders + CPMM math.
 * Owns: get/list/mine + history (honest degrade), six builders for ops
 *   59/60/61/62/63/75 ([opId, opData], zero-placeholder fee for live
 *   fee-fill), CPMM quote/slippage, share-mint estimates (shareOut; the
  *   withdraw leg proves via Pool.get re-read, so shareBack was deleted in
  *   the slice-18 audit — zero callers), depth points, x·y=k curve points
  *   (dex-ux plot proposal 5 — BigInt port of falcon_app.py:167-202),
 *   the ONLY percent converters (u16 <-> human), fee via Tx.fee (filled IN
 *   PLACE — slice-11 F-FEEFILL lesson), sendAndProve (vote-pattern). No DOM,
 *   no key handling (WIF passes opaquely to Tx.sign) — views live in
 *   pool-ui.js. Consumes: Chain.db/.history/.call/.net, Tx.fee/.sign,
 *   Format.parseAmount/parsePriceRatio, Account.resolve (mine only); exposes global Pool only.
 *   Created by: building-vanilla-slices skill, slice-12-pools plan Task 2.
 * CHAIN TRUTH (#4 wins): op ids <- operations.hpp:115-119/:131; fields +
 *   payers <- liquidity_pool.hpp:34-88/:94-152; traps (a<b, pct <= 10000,
 *   withdrawal->0-only) <- liquidity_pool.cpp:30-77; virgin mint = max(raw)
 *   <- evaluator deposit branch (see shareOut); object (NO owner field) <-
 *   liquidity_pool_object.hpp:44-60; reads <- database_api.hpp:683-856;
 *   history on history_api <- api.hpp:69/:266-300 (range (stop,start],
 *   codes 59-63); 10000 = 100% <- config.hpp:102-103. Reads mirror #1
 *   PoolmartActions.js :21-33/:132-135/:229 + symbol join; create/delete
 *   fields mirror #1 CreatePoolModal.jsx:90-117 + DeletePoolModal.jsx:37-39.
 *   Keys mirror #3 bitshares-api.js :3277-3356/:1733-1755 (canonical ONLY).
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings; CPMM/slippage/
 *   share math in BigInt; percents RAW u16. Number() ONLY for depth labels +
 *   impact_bp (market-ui.js:34 precedent). FEES: header fee_params are
 *   STALE-UNTIL-OBSERVED (#3720: live get_required_fees wins — op-75 seen at
 *   0.10000 TEST, not 1 BTS). Tickets 57/58 OUT (slice 14). Share zero-supply
 *   gates live in VIEWS; builders check wire traps only.
 * NAMED ERRORS: not-connected / unknown-pool / unknown-account / history-unavailable /
 *   empty-pool / order-trap / zero-trap / insufficient-share / share-preconditions-unproven.
 */
var Pool = (function () {
  "use strict";
  /**
   * @typedef {import('./types.js').OpTuple} OpTuple
   * @typedef {import('./types.js').FeeAssetId} FeeAssetId
   * @typedef {import('./types.js').RawInt} RawInt
   * @typedef {import('./types.js').TopMarketRow} TopMarketRow
   */
  var CORE_ASSET = "1.3.0";
  var POOL_RE = /^1\.19\.\d+$/, ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var DIGITS_RE = /^\d+$/;
  var PROVE_TIMEOUT_MS = 60000, PROVE_INTERVAL_MS = 2500;
  var PAGE_DEFAULT = 10, POOL_START = "1.19.0";
  var DEFAULT_SLIPPAGE_PCT = "0.5"; /* human percent; views display it, minReceive applies it */
  var _listForm = null; /* ambiguity-B probe cache: "2-arg" | "3-arg" (see listForm) */

  function _sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function _assertId(id, re, name) { if (typeof id !== "string" || !re.test(id)) throw new Error(name + " must match " + re + ", got: " + JSON.stringify(id)); }
  function _assertDigits(raw, name) { if (typeof raw !== "string" || !DIGITS_RE.test(raw)) throw new Error(name + " must be a digit string, got: " + JSON.stringify(raw)); }
  function _assertU16(n, name) { if (!Number.isInteger(n) || n < 0 || n > 0xFFFF) throw new Error(name + " must be u16, got: " + JSON.stringify(n)); }
  function _assertPrecision(p, name) { if (!Number.isInteger(p) || p < 0 || p > 12) throw new Error((name || "precision") + " must be 0-12, got: " + JSON.stringify(p)); }
  function _needFormat() { if (typeof Format === "undefined" || !Format.parseAmount) throw new Error("format-unavailable (format.js first)"); }
  function _isSocketError(e) { return /not connected|socket closed|connect timeout/i.test(String((e && e.message) || e || "")); }
  function _isParamError(e) { return /invalid param|wrong|argument|parameter|signature/i.test(String((e && e.message) || e || "")); }
  /* Numeric object-id compare (instance-major; spaces equal in practice). */
  function _cmpIds(a, b) {
    var pa = a.split("."), pb = b.split(".");
    for (var i = 0; i < 3; i++) { var d = parseInt(pa[i], 10) - parseInt(pb[i], 10); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }
  /* One database-API round trip; socket failures -> "not-connected", else rethrow verbatim. */
  async function _dbCall(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); } catch (e) {
      if (_isSocketError(e)) throw new Error("not-connected");
      throw e;
    }
  }
  /* Name-or-id -> 1.2.N id via Account.resolve (id-only when unloaded). Fails "unknown-account". */
  async function _resolveAccountId(input) {
    if (typeof input === "string" && ACCOUNT_RE.test(input)) return input;
    if (typeof Account !== "undefined" && Account.resolve) {
      try { return (await Account.resolve(input)).id; } catch (e) { throw new Error("unknown-account"); }
    }
    throw new Error("unknown-account");
  }

  /* u16 hundredths -> human percent label ("150" -> "1.5"). THE ONLY "/ 100" divider. */
  function pctUnitsToHuman(u) {
    _assertU16(u, "percent units");
    var s = String(u);
    while (s.length < 3) s = "0" + s;    var head = s.slice(0, -2).replace(/^0+(?=\d)/, ""), tail = s.slice(-2).replace(/0+$/, "");
    return tail ? head + "." + tail : head;
  }
  /* Human percent -> u16 hundredths ("1.5" -> 150) via string math (slice-10 B1: pad, never float). */
  function pctHumanToUnits(human) {
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(human).trim());
    if (!m) throw new Error("bad percent (0-100, <=2 decimals): " + JSON.stringify(human));
    var frac = m[2] || "";
    while (frac.length < 2) frac += "0";
    var n = parseInt(((m[1] + frac).replace(/^0+(?=\d)/, "") || "0"), 10);
    if (n < 0 || n > 10000) throw new Error("percent out of range 0-100: " + JSON.stringify(human));
    return n;
  }

  /* Raw pool object -> plain row (amounts stay raw strings; owner null — the object carries none). */
  function _normPool(p) {
    if (!p || typeof p !== "object" || !p.id) throw new Error("unknown-pool");
    return { id: String(p.id), asset_a_id: String(p.asset_a), asset_b_id: String(p.asset_b),
      share_id: String(p.share_asset), balance_a_raw: String(p.balance_a), balance_b_raw: String(p.balance_b),
      taker_units: p.taker_fee_percent, withdrawal_units: p.withdrawal_fee_percent,
      owner: (typeof p.owner === "string" ? p.owner : null) };
  }
  /* lookup_asset_symbols join for display symbols/precisions (Reference #14 shape); misses degrade to bare ids. */
  async function _join(pools) {
    var ids = [], seen = {};
    pools.forEach(function (p) {
      if (!p) return;
      [p.asset_a, p.asset_b, p.share_asset].forEach(function (id) {
        if (typeof id === "string" && !seen[id]) { seen[id] = 1; ids.push(id); }
      });
    });
    var byId = {};
    if (ids.length) {
      var objs = await _dbCall("lookup_asset_symbols", [ids]);
      (objs || []).forEach(function (a) { if (a && a.id) byId[a.id] = a; });
    }
    var rows = [];
    pools.forEach(function (p) {
      if (!p) return;
      var r = _normPool(p);
      /* Joined-asset leg -> {sym, prec} display pair (misses degrade to the bare id, never a crash). */
      function leg(id) { var a = byId[id] || {}; return { sym: a.symbol || String(id), prec: (typeof a.precision === "number" ? a.precision : null) }; }
      var A = leg(p.asset_a), B = leg(p.asset_b), S = leg(p.share_asset);
      r.sym_a = A.sym; r.prec_a = A.prec; r.sym_b = B.sym; r.prec_b = B.prec; r.sym_share = S.sym; r.prec_share = S.prec;
      rows.push(r);
    });
    return rows;
  }

  /* Single pool by 1.19.x id, symbols joined like list rows (callers use
   * sym_a/asset_a_id interchangeably with fallbacks — joined is a superset).
   * Unknown id -> "unknown-pool" (never a raw RPC dump). */
  async function get(id) {
    _assertId(id, POOL_RE, "id");
    var rows = await _dbCall("get_objects", [[id]]);
    if (!rows || !rows[0]) throw new Error("unknown-pool (" + id + ")");
    return (await _join([rows[0]]))[0];
  }
  /* list_liquidity_pools arg-form probe (ambiguity B): header 2-arg first, #2's 3-arg on param rejection. */
  async function _listRaw(limit, startId) {
    if (_listForm === "3-arg") return _dbCall("list_liquidity_pools", [limit, startId, false]);
    try { var r = await _dbCall("list_liquidity_pools", [limit, startId]); _listForm = "2-arg"; return r; }
    catch (e) {
      if (_isSocketError(e) || !_isParamError(e) || _listForm) throw e;
      var r2 = await _dbCall("list_liquidity_pools", [limit, startId, false]); _listForm = "3-arg"; return r2;
    }
  }
  /* Accepted list_liquidity_pools form cache ("unprobed" until first unfiltered list). */
  function listForm() { return _listForm || "unprobed"; }
  /* Pool list with #1's method switch (Reference #14): both/one/none + share; symbols joined for display. */
  async function list(opts) {
    opts = opts || {};
    var limit = (opts.limit === undefined || opts.limit === null) ? PAGE_DEFAULT : opts.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be 1-100");
    var startId = opts.startId || POOL_START;
    _assertId(startId, POOL_RE, "startId");
    var pools;
    if (opts.share) { _assertId(opts.share, ASSET_RE, "share"); pools = await _dbCall("get_liquidity_pools_by_share_asset", [[opts.share], false]); }
    else if (opts.assetA && opts.assetB) { pools = await _dbCall("get_liquidity_pools_by_both_assets", [opts.assetA, opts.assetB, limit, startId]); }
    else if (opts.assetA) { pools = await _dbCall("get_liquidity_pools_by_asset_a", [opts.assetA, limit, startId]); }
    else if (opts.assetB) { pools = await _dbCall("get_liquidity_pools_by_asset_b", [opts.assetB, limit, startId]); }
    else { pools = await _listRaw(limit, startId); }
    return _join(pools || []);
  }
  /* Owner's pools (my-pools section). #1 passes the account NAME (#1 :229); names resolve via Account. */
  async function mine(accountNameOrId) {
    return _join((await _dbCall("get_liquidity_pools_by_owner", [await _resolveAccountId(accountNameOrId)])) || []);
  }
  /* Raw history row -> plain row (object fields unconfirmed in the sparse checkout — Task 4 records the shape). */
  function _normHist(o) {
    o = o || {};
    var op = (o.operation_type !== undefined ? o.operation_type : (o.op_type !== undefined ? o.op_type : (o.op !== undefined ? o.op : null)));
    return { seq: (o.sequence === undefined ? null : o.sequence), block_time: (o.block_time || o.time || null), op_type: op, raw: o };
  }
  /* Pool history (codes 59-63) via history api, db fallback; neither -> "history-unavailable" (slice-5 pattern). */
  async function history(poolId, limit) {
    _assertId(poolId, POOL_RE, "poolId");
    var lim = (limit === undefined || limit === null) ? 100 : limit;
    if (!Number.isInteger(lim) || lim < 1 || lim > 500) throw new Error("limit must be 1-500");
    var params = [poolId, null, null, lim], rows = null;
    try { rows = await Chain.call(await Chain.history(), "get_liquidity_pool_history", params); }
    catch (e) { if (_isSocketError(e)) throw new Error("not-connected"); }
    if (rows === null) { try { rows = await _dbCall("get_liquidity_pool_history", params); } catch (e) { if (_isSocketError(e)) throw new Error("not-connected"); } }
    if (rows === null) throw new Error("history-unavailable");
    return (rows || []).map(_normHist);
  }

  /* CPMM quote: out = floor(sell * BalOut / (BalIn + sell)) in BigInt (never float) + impact vs mid in bp. */
  function quote(args) {
    args = args || {};
    _assertDigits(args.balanceA_raw, "balanceA_raw"); _assertDigits(args.balanceB_raw, "balanceB_raw"); _assertDigits(args.sell_raw, "sell_raw");
    var balA = BigInt(args.balanceA_raw), balB = BigInt(args.balanceB_raw), sell = BigInt(args.sell_raw);
    if (balA <= 0n || balB <= 0n) throw new Error("empty-pool");
    if (sell <= 0n) throw new Error("sell_raw must be > 0");
    var balIn = args.sellIsA ? balA : balB, balOut = args.sellIsA ? balB : balA;
    var out = (sell * balOut) / (balIn + sell);    var num = sell * balOut - out * balIn, den = sell * balOut; /* (mid-exec)/mid, integer */
    var impact_bp = Number((num * 10000n * 10n / den + 5n) / 10n); /* display int only */
    return { out_raw: out.toString(), impact_bp: impact_bp };
  }
  /* Slippage haircut: floor(quote * (1 - s)) in integer math (ambiguity-F formula). s human percent, default 0.5. */
  function minReceive(quote_raw, slippagePctHuman) {
    _assertDigits(quote_raw, "quote_raw");
    _needFormat();
    var s = (slippagePctHuman === undefined || slippagePctHuman === null || String(slippagePctHuman) === "") ? DEFAULT_SLIPPAGE_PCT : String(slippagePctHuman);
    if (!/^(\d+)(?:\.(\d+))?$/.test(s.trim())) throw new Error("bad slippage percent: " + JSON.stringify(slippagePctHuman));
    var r = Format.parsePriceRatio(s.trim()); /* exact decimal ratio; the *100 scale below turns s% into s/100 */
    if (r.num > r.den * 100n) throw new Error("slippage must be 0-100");
    var den100 = r.den * 100n; /* s% -> s/100: scale the exact decimal ratio, never float */
    return ((BigInt(quote_raw) * (den100 - r.num)) / den100).toString();
  }
  /* LP mint estimate: min-of-ratios once funded (#1 PoolStakeModal shape, integer);
   * virgin pool -> max(inA_raw, inB_raw): the chain mints max(amount_a, amount_b)
   * in RAW units (evaluator deposit branch; proven on 1.19.66 100000/10000->100000
   * and 1.19.67 40000/90000->90000 — geometric mean disproven, Task-4 probe). */
  function shareOut(args) {
    args = args || {};
    _assertDigits(args.balanceA_raw, "balanceA_raw"); _assertDigits(args.balanceB_raw, "balanceB_raw"); _assertDigits(args.supply_raw, "supply_raw");
    _assertDigits(args.inA_raw, "inA_raw"); _assertDigits(args.inB_raw, "inB_raw");
    var balA = BigInt(args.balanceA_raw), balB = BigInt(args.balanceB_raw), supply = BigInt(args.supply_raw);
    var inA = BigInt(args.inA_raw), inB = BigInt(args.inB_raw);
    if (inA <= 0n || inB <= 0n) throw new Error("deposit amounts must be > 0");
    var s;    if (supply <= 0n || balA <= 0n || balB <= 0n) s = inA > inB ? inA : inB;
    else { var s1 = (inA * supply) / balA, s2 = (inB * supply) / balB; s = s1 < s2 ? s1 : s2; }
    if (s <= 0n) throw new Error("deposit-too-small (rounds to zero shares)");
    return { share_raw: s.toString() };
  }
  /* CPMM depth points 0->99% both sides (#2 SimpleSwap depth SHAPE, integer-first; pct is a display pixel). */
  function depthPoints(args, n) {
    args = args || {};
    _assertDigits(args.balanceA_raw, "balanceA_raw"); _assertDigits(args.balanceB_raw, "balanceB_raw");
    var steps = (n === undefined || n === null) ? 25 : n;
    if (!Number.isInteger(steps) || steps < 1 || steps > 100) throw new Error("n must be 1-100");
    var balA = BigInt(args.balanceA_raw), balB = BigInt(args.balanceB_raw);
    if (balA <= 0n || balB <= 0n) throw new Error("empty-pool");
    /* One CPMM depth side: steps points from 1%..99% of balIn (pct is a display label only; sell/out stay raw strings). */
    function side(balIn, balOut) {
      var pts = [], i;
      for (i = 1; i <= steps; i++) {
        var pct = Math.floor((i * 99) / steps) || 1; /* display label only (market-ui.js:34 precedent) */
        var sell = (balIn * BigInt(pct)) / 100n;
        pts.push({ pct: pct, sell_raw: sell.toString(), out_raw: ((sell * balOut) / (balIn + sell)).toString() });
      }
      return pts;
    }
    return { aToB: side(balA, balB), bToA: side(balB, balA) };
  }

  /* x·y=k reserve curve (dex-ux plot proposal 5 — formulas ported from
   * reference/bitshares-dex-ux/falcon_app.py:167-202 `pool()` + asks loop:
   * x_start*y_start = k, x1 = x_start+delta_x, y1 = k/x1 — floating point
   * there becomes BigInt here; never imported, math only).
   * k = A*B; step s = A/100n (1n floor for dust pools where A < 100);
   * points (A+i*s, k/(A+i*s)) for i in 1..99 (integer-division floors);
   * the current point (A,B) returns separately for marking. Human scaling
   * happens only at render via Format. Throws "empty-pool" on zero balances. */
  function curvePoints(args) {
    args = args || {};
    _assertDigits(args.balanceA_raw, "balanceA_raw"); _assertDigits(args.balanceB_raw, "balanceB_raw");
    var balA = BigInt(args.balanceA_raw), balB = BigInt(args.balanceB_raw);
    if (balA <= 0n || balB <= 0n) throw new Error("empty-pool");
    var k = balA * balB, s = balA / 100n, i;
    if (s <= 0n) s = 1n; /* dust pool: keep the walk moving one raw unit at a time */
    var pts = [];
    for (i = 1; i <= 99; i++) {
      var x = balA + BigInt(i) * s;
      pts.push({ x_raw: x.toString(), y_raw: (k / x).toString() });
    }
    return { k_raw: k.toString(), step_raw: s.toString(), points: pts,
      current: { x_raw: balA.toString(), y_raw: balB.toString() } };
  }

  /* Op-59 create. SORTS (a,b) by id (ambiguity E); pair.sorted exposes the orientation for the confirm. */
  function buildCreate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.shareId, ASSET_RE, "shareId");
    _assertId(args.assetAId, ASSET_RE, "assetAId"); _assertId(args.assetBId, ASSET_RE, "assetBId");
    if (args.assetAId === args.assetBId) throw new Error("order-trap (asset_a must differ from asset_b)");
    if (args.shareId === args.assetAId || args.shareId === args.assetBId) throw new Error("share-preconditions-unproven (share asset must differ from both legs)");
    var taker = pctHumanToUnits(args.takerHuman), wd = pctHumanToUnits(args.withdrawalHuman);
    var a = args.assetAId, b = args.assetBId;
    if (_cmpIds(a, b) > 0) { var t = a; a = b; b = t; }
    var opData = { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId,
      asset_a: a, asset_b: b, share_asset: args.shareId,
      taker_fee_percent: taker, withdrawal_fee_percent: wd, extensions: [] };
    var pair = [59, opData];
    /** @type {any} */ (pair).sorted = { a: a, b: b }; /* non-index prop: invisible to JSON/serializers, read by the confirm */
    return pair;
  }
  /* Op-61 deposit/stake. Leg ids REQUIRED (chain enforces a<b order) — views source them from Pool.get. */
  function buildDeposit(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.poolId, POOL_RE, "poolId");
    _assertId(args.assetAId, ASSET_RE, "assetAId"); _assertId(args.assetBId, ASSET_RE, "assetBId");
    if (_cmpIds(args.assetAId, args.assetBId) >= 0) throw new Error("order-trap (deposit legs must arrive asset_a < asset_b by id — orient via Pool.get)");
    _assertPrecision(args.precA, "precA"); _assertPrecision(args.precB, "precB");
    _needFormat();
    var aRaw = Format.parseAmount(args.aHuman, args.precA), bRaw = Format.parseAmount(args.bHuman, args.precB);
    if (BigInt(aRaw) <= 0n || BigInt(bRaw) <= 0n) throw new Error("deposit amounts must be > 0");
    return [61, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, pool: args.poolId,
      amount_a: { amount: aRaw, asset_id: args.assetAId }, amount_b: { amount: bRaw, asset_id: args.assetBId }, extensions: [] }];
  }
  /* Op-62 withdraw/unstake. Zero share -> "insufficient-share" (chain rule share_amount > 0, client-gated). */
  function buildWithdraw(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.poolId, POOL_RE, "poolId");
    _assertId(args.shareId, ASSET_RE, "shareId");
    _assertPrecision(args.precShare, "precShare");
    _needFormat();
    var raw = Format.parseAmount(args.shareHuman, args.precShare);
    if (BigInt(raw) <= 0n) throw new Error("insufficient-share (share amount must be > 0)");
    return [62, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, pool: args.poolId,
      share_amount: { amount: raw, asset_id: args.shareId }, extensions: [] }];
  }
  /* Op-63 exchange/swap. min comes from minReceive (builder takes RAW min, never computes slippage itself). */
  function buildExchange(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.poolId, POOL_RE, "poolId");
    _assertId(args.sellAssetId, ASSET_RE, "sellAssetId"); _assertId(args.recvAssetId, ASSET_RE, "recvAssetId");
    if (args.sellAssetId === args.recvAssetId) throw new Error("order-trap (sell asset must differ from receive asset)");
    _assertPrecision(args.precSell, "precSell");
    _assertDigits(args.minRaw, "minRaw");
    _needFormat();
    var sellRaw = Format.parseAmount(args.sellHuman, args.precSell);
    if (BigInt(sellRaw) <= 0n) throw new Error("sell amount must be > 0");
    return [63, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, pool: args.poolId,
      amount_to_sell: { amount: sellRaw, asset_id: args.sellAssetId },
      min_to_receive: { amount: args.minRaw, asset_id: args.recvAssetId }, extensions: [] }];
  }
  /* Op-75 update (fee edit ONLY). Withdrawal accepts 0-or-omit — nonzero throws "zero-trap" (ambiguity D gate). */
  function buildUpdate(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.poolId, POOL_RE, "poolId");
    var taker = null, wd = null, changed = 0;
    if (args.takerHumanOrNull !== null && args.takerHumanOrNull !== undefined && String(args.takerHumanOrNull) !== "") { taker = pctHumanToUnits(args.takerHumanOrNull); changed++; }
    if (args.withdrawalZeroOrNull !== null && args.withdrawalZeroOrNull !== undefined && String(args.withdrawalZeroOrNull) !== "") {
      var u = pctHumanToUnits(String(args.withdrawalZeroOrNull));
      if (u !== 0) throw new Error("zero-trap (withdrawal_fee_percent accepts 0-or-omit only)");
      wd = 0; changed++;
    }
    if (!changed) throw new Error("update needs >= 1 field (taker and/or withdrawal->0)");
    return [75, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, pool: args.poolId,
      taker_fee_percent: taker, withdrawal_fee_percent: wd, extensions: [] }];
  }
  /* Op-60 delete (owner-only cleanup; fee 0 observed live — the zero fee row is shown explicitly in the confirm). */
  function buildDelete(args) {
    args = args || {};
    _assertId(args.accountId, ACCOUNT_RE, "accountId"); _assertId(args.poolId, POOL_RE, "poolId");
    return [60, { fee: { amount: "0", asset_id: CORE_ASSET }, account: args.accountId, pool: args.poolId, extensions: [] }];
  }

  /* Live fee via Tx.fee (chain answers); opPair fee-filled IN PLACE. Returns {amount, asset_id}. */
  async function fee(opPair, feeAssetId) {
    if (!Array.isArray(opPair) || !Number.isInteger(opPair[0]) || !opPair[1]) throw new Error("opPair must be [opId, opData]");
    if (typeof Tx === "undefined" || !Tx.fee) throw new Error("tx-unavailable");
    var ans = await Tx.fee(opPair[0], opPair[1], feeAssetId || CORE_ASSET);
    opPair[1].fee = { amount: String(ans.amount), asset_id: ans.asset_id };
    return { amount: String(ans.amount), asset_id: ans.asset_id };
  }
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

  return { get: get, list: list, mine: mine, history: history, listForm: listForm,
    quote: quote, minReceive: minReceive, shareOut: shareOut, depthPoints: depthPoints, curvePoints: curvePoints,
    buildCreate: buildCreate, buildDeposit: buildDeposit, buildWithdraw: buildWithdraw,
    buildExchange: buildExchange, buildUpdate: buildUpdate, buildDelete: buildDelete, fee: fee, sendAndProve: sendAndProve,
    pctUnitsToHuman: pctUnitsToHuman, pctHumanToUnits: pctHumanToUnits, DEFAULT_SLIPPAGE_PCT: DEFAULT_SLIPPAGE_PCT };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.Pool === "undefined") { globalThis.Pool = Pool; }
if (typeof module !== "undefined") { module.exports = Pool; }
