/* Account: read-only account data layer (resolve, balances, history, my-account,
 *   equity replay).
 * Owns: BitShares account lookups and balance joining; no rendering, no signing.
 * Consumes: Chain.db/.history/.call, Format.formatAmount, Wallet.keys/
 *   .isUnlocked/.getBrainkey (in-memory unlocked keys), Crypto.
 *   brainPrivateKeyHex/.keypairFromPrivateHex (active seq1 pub derivation).
 * Globals/side effects: exposes global Account only; no DOM, no storage writes.
 * Created by: building-vanilla-slices skill, slice-03 Task 3.
 * Extended by: dex-ux plots task (AFK round — proposal 4 equity replay:
 *   historyPaged + replayEquity + equity; chain-history ONLY, ES refused).
 */
"use strict";

var Account = (function () {
  /**
   * @typedef {import('./types.js').ChainObjectId} ChainObjectId
   * @typedef {import('./types.js').RawInt} RawInt
   * @typedef {import('./types.js').HumanAmount} HumanAmount
   * @namespace Account
   */
  var ID_RE = /^1\.2\.\d+$/;
  var FIRST_HISTORY_OP = "1.11.0";

  /* True when the string is an account object id (1.2.N). */
  function _isId(s) {
    return typeof s === "string" && ID_RE.test(s);
  }

  /* In-flight resolve memo (perf: per-row account links fire same-tick
   *   bursts for repeat ids — one RPC per id per tick, never two. Pending
   *   only: entries clear on settle, so no completed data is ever cached
   *   (renames stay fresh). Same promise shared, behavior identical. */
  var _resolvePending = {};

  /* Resolve an account name or 1.2.N id to {id, name}.
   * Params: nameOrId non-empty string.
   * Returns: Promise of {id, name}.
   * Fails: "unknown-account" when the node returns null/empty. */
  async function resolve(nameOrId) {
    if (typeof nameOrId !== "string" || !nameOrId) {
      throw new Error("unknown-account");
    }
    var key = nameOrId;
    if (Object.prototype.hasOwnProperty.call(_resolvePending, key)) {
      return _resolvePending[key];
    }
    var p = _resolveInner(nameOrId);
    _resolvePending[key] = p;
    /* Clear on settle (both paths — a rejected entry must never poison). */
    p.then(function () { delete _resolvePending[key]; },
      function () { delete _resolvePending[key]; });
    return p;
  }

  /* Inner resolve body (unchanged contract — see resolve above). */
  async function _resolveInner(nameOrId) {
    var dbId = await Chain.db();
    if (_isId(nameOrId)) {
      var rows = await Chain.call(dbId, "get_accounts", [[nameOrId]]);
      if (!rows || !rows[0]) throw new Error("unknown-account");
      return { id: rows[0].id, name: rows[0].name };
    }
    var acct = await Chain.call(dbId, "get_account_by_name", [nameOrId]);
    if (!acct) throw new Error("unknown-account");
    return { id: acct.id, name: acct.name };
  }

  /* List spendable balances for an account id with human display strings.
   * Params: id account id string ("1.2.N").
   * Returns: Promise of [{asset_id, symbol, precision, raw, display}],
   *   where raw is the integer-amount string and display is
   *   Format.formatAmount(raw, precision). Empty balances yield [].
   * Fails: "bad-asset-shape" when any asset lacks a numeric precision. */
  async function balances(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_account_balances", [id, []]);
    if (!rows || rows.length === 0) return [];
    var ids = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var aid = rows[i].asset_id;
      if (typeof aid === "string") ids.push(aid);
    }
    if (ids.length === 0) return [];
    var assets = await Chain.call(dbId, "get_assets", [ids]);
    var byId = {};
    for (i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a) continue;
      if (typeof a.precision !== "number") throw new Error("bad-asset-shape");
      byId[a.id] = a;
    }
    var out = [];
    for (i = 0; i < rows.length; i++) {
      var e = rows[i];
      var assetId = e.asset_id;
      var meta = byId[assetId];
      if (!meta) throw new Error("bad-asset-shape");
      if (typeof meta.precision !== "number") throw new Error("bad-asset-shape");
      var raw = String(e.amount !== undefined ? e.amount : e.balance);
      out.push({
        asset_id: assetId,
        symbol: meta.symbol,
        precision: meta.precision,
        raw: raw,
        display: Format.formatAmount(raw, meta.precision)
      });
    }
    return out;
  }

  /* In-flight history-api-id memo (perf: history() + historyPaged() fire
   *   together on every account load — one "history" RPC per tick, never two.
   *   Pending only: cleared on settle, the resolved id still caches in
   *   Chain (sole owner). Behavior identical. */
  var _histIdPending = null;
  function _histId() {
    if (_histIdPending) return _histIdPending;
    _histIdPending = Chain.history();
    _histIdPending.then(function () { _histIdPending = null; },
      function () { _histIdPending = null; });
    return _histIdPending;
  }

  /* Fetch raw operation history for an account id (newest first, opaque rows).
   * Params: id account id string; limit positive int (default 20).
   * Returns: Promise of the raw get_account_history array.
   * Fails: "history-unavailable" when the history plugin/api is missing. */
  async function history(id, limit) {
    if (limit === undefined) limit = 20;
    var histId;
    try {
      histId = await _histId();
    } catch (e) {
      throw new Error("history-unavailable");
    }
    var rows;
    try {
      rows = await Chain.call(histId, "get_account_history", [id, FIRST_HISTORY_OP, limit, FIRST_HISTORY_OP]);
    } catch (e) {
      throw new Error("history-unavailable");
    }
    return rows;
  }

  /* Paged-walk bounds (dex-ux plot proposal 4 cost cap: <=5 pages x 100;
   * stops early on an empty or short page). */
  var HISTORY_PAGE = 100, HISTORY_MAX_PAGES = 5;
  var HIST_ID_RE = /^1\.11\.\d+$/;
  var INT_RE = /^\d+$/;

  /* Unwrap one get_account_history row to its operation_history_object.
   * Nodes return either the object or a [seq, object] pair (tx-send.js
   * pollHistoryForTransfer handles both); the object carries .op/.block_num.
   * Params: r raw row. Returns the object or null. */
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

  /* History-object id ("1.11.N") from either row shape, or null when the
   * shape is unrecognized (caller stops paging — never guesses). */
  function _histRowId(r, entry) {
    if (entry && typeof entry.id === "string" && HIST_ID_RE.test(entry.id)) return entry.id;
    if (Array.isArray(r) && typeof r[0] === "string" && HIST_ID_RE.test(r[0])) return r[0];
    return null;
  }

  /* One get_account_history page — the SAME WS method Account.history uses
   * (no new chain methods enter with paging); only `start` varies, `stop`
   * stays the earliest id. Params: id account id; limit 1-100; start "1.11.x".
   * Returns the raw row array (possibly empty). Fails "history-unavailable". */
  async function _historyPage(id, limit, start) {
    var histId;
    try {
      histId = await _histId();
    } catch (e) {
      throw new Error("history-unavailable");
    }
    var rows;
    try {
      rows = await Chain.call(histId, "get_account_history", [id, FIRST_HISTORY_OP, limit, start]);
    } catch (e) {
      throw new Error("history-unavailable");
    }
    return rows || [];
  }

  /* Paged history walk (dex-ux plot proposal 4 source — vanilla/notes/
   * dexux-plots.md section 4; chain-history ONLY, ES refused). Start ids are
   * inclusive on most nodes, so a leading duplicate of the previous page's
   * tail is dropped. Params: id account id string; perPage/maxPages optional
   * positive ints (defaults 100/5, hard caps 100/5 — the proposal's cost
   * bound). Returns {pages, rows, truncated}: pages newest-first raw arrays,
   * rows the deduped flat newest-first list, truncated true when the cap
   * stopped a walk whose last raw page was full (older history exists but
   * was not replayed — the view says so). */
  async function historyPaged(id, perPage, maxPages) {
    if (typeof id !== "string" || !id) throw new Error("unknown-account");
    var per = (perPage === undefined || perPage === null) ? HISTORY_PAGE : perPage;
    var max = (maxPages === undefined || maxPages === null) ? HISTORY_MAX_PAGES : maxPages;
    if (!Number.isInteger(per) || per < 1 || per > 100) throw new Error("perPage must be 1-100");
    if (!Number.isInteger(max) || max < 1 || max > 5) throw new Error("maxPages must be 1-5");
    var pages = [], flat = [], start = FIRST_HISTORY_OP, lastTailId = null, p;
    for (p = 0; p < max; p++) {
      var raw = await _historyPage(id, per, start);
      if (!raw || raw.length === 0) break;
      var rawLen = raw.length, rows = raw;
      if (lastTailId !== null) {
        var firstId = _histRowId(rows[0], _unwrapHist(rows[0]));
        if (firstId !== null && firstId === lastTailId) {
          rows = rows.slice(1);
          if (rows.length === 0) break;
        }
      }
      pages.push(rows);
      var i, tailId = lastTailId;
      for (i = 0; i < rows.length; i++) {
        flat.push(rows[i]);
        var rid = _histRowId(rows[i], _unwrapHist(rows[i]));
        if (rid) tailId = rid;
      }
      if (rawLen < per) break; /* short raw page: reached the oldest event */
      if (!tailId) break; /* no ids to page with — return what we have */
      lastTailId = tailId;
      start = tailId;
    }
    var truncated = pages.length === max && pages[max - 1].length === per;
    return { pages: pages, rows: flat, truncated: truncated };
  }

  /* Node cap for get_account_history_operations (reference #4 ground truth:
   * api.hpp:146-152 limit param; default cap application.hpp:49
   * api_limit_get_account_history_operations = 100). */
  var OPS_LIMIT_MAX = 100, OPS_LIMIT_DEFAULT = 20;

  /* Build the WS params for get_account_history_operations, one arg array per
   * op type (pure: no network, no globals — the unit-test seam).
   * Verified signature (all three sources agree, 2026-10-02):
   *   #4 api.hpp:146-152 [account_name_or_id, operation_type:int64,
   *     start:1.11.x, stop:1.11.x, limit] (start BEFORE stop — the reverse of
   *     get_account_history's [account, stop, limit, start], api.hpp:89-94);
   *   astro-ui DexLiveOrderBook.ts:92-98 + MarketTradeHistory.ts:142-148
   *     [accountId, 4, "1.11.0", "1.11.0", 50] (single int type);
   *   live sweep tooling/history-probe.mjs:385 ["1.2.0", 0, "1.11.0",
   *     "1.11.0", 1] → ok on all 9 nodes.
   * The sibling get_account_history_by_operations (api.hpp:128-133) takes a
   * flat_set of types in ONE call, but the live sweep never probed it, so the
   * verified singular method + one call per type wins (live beats header).
   * Params: accountId non-empty string (name or 1.2.N — the method accepts
   *   both); opTypes non-empty array of safe ints (0 = transfer,
   *   1 = limit_order_create, 4 = fill_order, ...); limit per-type max rows
   *   (default 20, floored, clamped 1-100 to the node cap); start most-recent
   *   cursor "1.11.N" (default FIRST_HISTORY_OP = genesis page); stop stays
   *   FIRST_HISTORY_OP (earliest — mirrors history()).
   * Returns: array of [accountId, opType, start, stop, limit] arrays, one per
   *   op type in input order.
   * Fails: Error("bad-args") on any malformed input (never partial output).
   *   "bad-args" is a code prefix for callers to map — never displayed raw. */
  function _opsArgs(accountId, opTypes, limit, start) {
    if (typeof accountId !== "string" || !accountId) throw new Error("bad-args");
    if (!Array.isArray(opTypes) || opTypes.length === 0) throw new Error("bad-args");
    var i;
    for (i = 0; i < opTypes.length; i++) {
      if (!Number.isSafeInteger(opTypes[i])) throw new Error("bad-args");
    }
    var lim = (limit === undefined || limit === null) ? OPS_LIMIT_DEFAULT : limit;
    if (typeof lim !== "number" || !isFinite(lim)) throw new Error("bad-args");
    lim = Math.floor(lim);
    if (lim < 1) lim = 1;
    if (lim > OPS_LIMIT_MAX) lim = OPS_LIMIT_MAX;
    var st = (start === undefined || start === null) ? FIRST_HISTORY_OP : start;
    if (typeof st !== "string" || !HIST_ID_RE.test(st)) throw new Error("bad-args");
    var out = [];
    for (i = 0; i < opTypes.length; i++) {
      out.push([accountId, opTypes[i], st, FIRST_HISTORY_OP, lim]);
    }
    return out;
  }

  /* Numeric 1.11.N sequence of a filtered-ops row for the newest-first merge
   * (same unwrap/id helpers as historyPaged: objects carry .id, pair-shaped
   * rows tolerated). Returns the sequence int, or -1 when the row carries no
   * recognizable id (sorts last — never drops data). */
  function _opsSeq(r) {
    var id = _histRowId(r, _unwrapHist(r));
    if (!id) return -1;
    var n = parseInt(id.slice(5), 10);
    return Number.isSafeInteger(n) ? n : -1;
  }

  /* Fetch account history filtered by operation type (transfer-only lists,
   * fill-only trade views — the astro-ui DexLiveOrderBook.ts:92-98 use).
   * One get_account_history_operations call per op type (the method takes a
   * SINGLE int64 type, api.hpp:146-152), merged newest-first by 1.11.N id.
   * Single round only, no multi-page walk: K type-streams would need K
   * parallel start-cursors plus a merge — unbounded cost for a filter view;
   * callers needing depth use historyPaged(). Per-type limit = the clamped
   * limit (node cap 100), so multi-type results hold up to K*limit rows.
   * Params: accountId non-empty string; opTypes non-empty array of safe
   *   ints; limit per-type max (default 20, clamped 1-100 — see _opsArgs).
   * Returns: Promise of the raw row array, newest first — same envelope as
   *   history() (operation_history_objects; rows without a parseable 1.11 id
   *   sort last, preserved).
   * Fails: Error("bad-args") on malformed args (pre-network, from _opsArgs);
   *   Error("history-unavailable") when the history api is missing, any call
   *   rejects, or any per-type result is a non-array shape — the SAME catch
   *   mapping as history() (nullish per-type results count as [], mirroring
   *   _historyPage's `rows || []`). Codes are caller-mapped, never displayed. */
  async function opsFiltered(accountId, opTypes, limit) {
    var argSets = _opsArgs(accountId, opTypes, limit);
    var histId;
    try {
      histId = await _histId();
    } catch (e) {
      throw new Error("history-unavailable");
    }
    var results;
    try {
      results = await Promise.all(argSets.map(function (a) {
        return Chain.call(histId, "get_account_history_operations", a);
      }));
    } catch (e) {
      throw new Error("history-unavailable");
    }
    var merged = [], i, k;
    for (i = 0; i < results.length; i++) {
      var rows = results[i];
      if (rows === null || rows === undefined) continue;
      if (!Array.isArray(rows)) throw new Error("history-unavailable");
      for (k = 0; k < rows.length; k++) merged.push(rows[k]);
    }
    var decorated = merged.map(function (r, idx) { return { r: r, i: idx, s: _opsSeq(r) }; });
    decorated.sort(function (a, b) {
      if (a.s !== b.s) return b.s - a.s;
      return a.i - b.i;
    });
    return decorated.map(function (d) { return d.r; });
  }

  /* One signed raw-integer leg into the per-asset accumulator.
   * Params: acc {assetId: {total: bigint, per: {seriesIdx: bigint}}},
   * assetId string, raw digit string, sign +1n|-1n, seriesIdx chronological
   * page index. Returns true when applied, false on malformed input
   * (caller counts the op skipped — never throws on chain data). */
  function _legAdd(acc, assetId, raw, sign, seriesIdx) {
    if (typeof assetId !== "string" || !assetId) return false;
    if (typeof raw !== "string") raw = String(raw);
    if (!INT_RE.test(raw)) return false;
    var d;
    try {
      d = BigInt(raw) * sign;
    } catch (e) {
      return false;
    }
    if (d === 0n) return true; /* zero legs apply trivially; the op still counts */
    var e = acc[assetId];
    if (!e) e = acc[assetId] = { total: 0n, per: {} };
    e.total += d;
    e.per[seriesIdx] = (e.per[seriesIdx] || 0n) + d;
    return true;
  }

  /* Signed raw legs for one history op tuple, filtered to the viewed account
   * (legs for other accounts yield [] — seen but contributing nothing; null
   * means out of scope entirely). Fee legs use the op's own fee asset (never
   * assumed). Numeric codes are what nodes emit; the two string aliases
   * mirror NotifyRules._opKind. Amount shapes mirror the #4 headers
   * (transfer.hpp:45-67, market.hpp:206-233, liquidity_pool.hpp:94-152). */
  function _equityLegs(code, body, accountId) {
    function assetOf(a) {
      if (!a || typeof a !== "object") return null;
      if (typeof a.asset_id !== "string") return null;
      if (a.amount === undefined || a.amount === null) return null;
      return { asset_id: a.asset_id, raw: String(a.amount) };
    }
    if (code === 0 || code === "transfer" || code === 38 || code === "override_transfer") {
      var out = [];
      var amt = assetOf(body.amount), fee = assetOf(body.fee);
      var from = body.from !== undefined ? String(body.from) : null;
      var to = body.to !== undefined ? String(body.to) : null;
      if (amt && to === accountId) out.push({ asset_id: amt.asset_id, raw: amt.raw, sign: 1n });
      if (amt && from === accountId) {
        out.push({ asset_id: amt.asset_id, raw: amt.raw, sign: -1n });
        var payer = (code === 38 || code === "override_transfer")
          ? (body.issuer !== undefined ? String(body.issuer) : null) : from;
        if (fee && payer === accountId) out.push({ asset_id: fee.asset_id, raw: fee.raw, sign: -1n });
      }
      return out;
    }
    if (code === 4 || code === "fill_order") {
      if (body.account_id !== undefined && String(body.account_id) !== accountId) return [];
      var legs = [];
      var recv = assetOf(body.receives), pays = assetOf(body.pays), f = assetOf(body.fee);
      if (recv) legs.push({ asset_id: recv.asset_id, raw: recv.raw, sign: 1n });
      if (pays) legs.push({ asset_id: pays.asset_id, raw: pays.raw, sign: -1n });
      if (f) legs.push({ asset_id: f.asset_id, raw: f.raw, sign: -1n });
      return legs;
    }
    if (code === 61 || code === 62 || code === 63) {
      if (body.account !== undefined && String(body.account) !== accountId) return [];
      var pl = [];
      var pf = assetOf(body.fee);
      if (code === 61) {
        var aa = assetOf(body.amount_a), ab = assetOf(body.amount_b);
        if (aa) pl.push({ asset_id: aa.asset_id, raw: aa.raw, sign: -1n });
        if (ab) pl.push({ asset_id: ab.asset_id, raw: ab.raw, sign: -1n });
      } else if (code === 62) {
        var sh = assetOf(body.share_amount);
        if (sh) pl.push({ asset_id: sh.asset_id, raw: sh.raw, sign: -1n });
      } else {
        var sell = assetOf(body.amount_to_sell), floor = assetOf(body.min_to_receive);
        if (sell) pl.push({ asset_id: sell.asset_id, raw: sell.raw, sign: -1n });
        if (floor) pl.push({ asset_id: floor.asset_id, raw: floor.raw, sign: 1n });
      }
      if (pf) pl.push({ asset_id: pf.asset_id, raw: pf.raw, sign: -1n });
      return pl;
    }
    return null;
  }

  /* Replay balance-affecting ops as signed per-asset integer deltas
   * (dex-ux plot proposal 4 math — Map(assetId → BigInt); integers until
   * the view's Format.formatAmount at render; pool legs per _equityLegs).
   * Unit-mixed pages stay per-asset — assets are NEVER summed across
   * precisions (the view plots one series per asset). Params: pages
   * newest-first raw page arrays (historyPaged shape); accountId "1.2.N".
   * Returns {totals, counted, skipped}: totals maps assetId →
   * {total_raw, perPage_raw} with perPage_raw in CHRONOLOGICAL order
   * (index 0 = oldest page — the sparkline's x). */
  function replayEquity(pages, accountId) {
    var acc = {}, counted = 0, skipped = 0, pi, i, li;
    pages = Array.isArray(pages) ? pages : [];
    var n = pages.length;
    for (pi = 0; pi < n; pi++) {
      var rows = Array.isArray(pages[pi]) ? pages[pi] : [];
      var seriesIdx = n - 1 - pi; /* chronological x: oldest page first */
      for (i = 0; i < rows.length; i++) {
        var entry = _unwrapHist(rows[i]);
        if (!entry || !Array.isArray(entry.op) || entry.op.length < 2) {
          skipped++;
          continue;
        }
        var legs = _equityLegs(entry.op[0], entry.op[1] || {}, String(accountId));
        if (!legs) {
          skipped++;
          continue;
        }
        var applied = 0;
        for (li = 0; li < legs.length; li++) {
          if (_legAdd(acc, legs[li].asset_id, legs[li].raw, legs[li].sign, seriesIdx)) applied++;
        }
        if (applied > 0) counted++;
        else skipped++;
      }
    }
    var totals = {}, ids = Object.keys(acc), k, s;
    for (k = 0; k < ids.length; k++) {
      var e = acc[ids[k]], perPage = [];
      for (s = 0; s < n; s++) perPage.push((e.per[s] || 0n).toString());
      totals[ids[k]] = { total_raw: e.total.toString(), perPage_raw: perPage };
    }
    return { totals: totals, counted: counted, skipped: skipped };
  }

  /* Fetch + replay + join symbols/precisions for the equity sparkline
   * (proposal 4 host data). WS methods: get_account_history (historyPaged) +
   * get_assets (same join as balances()) — no new chain methods. Params:
   * accountId "1.2.N". Returns {assets, pagesFetched, eventsSeen, counted,
   * skipped, truncated}: assets sorted by descending |total| as [{asset_id,
   * symbol, precision, total_raw, perPage_raw}]; precision null + bare id on
   * join miss (honest degrade, never throws).
   * Fails "history-unavailable" / "unknown-account" (id shape). */
  async function equity(accountId) {
    if (typeof accountId !== "string" || !ID_RE.test(accountId)) throw new Error("unknown-account");
    var walk = await historyPaged(accountId, HISTORY_PAGE, HISTORY_MAX_PAGES);
    var rep = replayEquity(walk.pages, accountId);
    var ids = Object.keys(rep.totals), byId = {};
    if (ids.length) {
      var dbId = await Chain.db();
      var assets = await Chain.call(dbId, "get_assets", [ids]);
      (assets || []).forEach(function (a) {
        if (a && a.id) byId[a.id] = a;
      });
    }
    var out = ids.map(function (id) {
      var meta = byId[id] || {};
      return { asset_id: id,
        symbol: (meta.symbol || id),
        precision: (typeof meta.precision === "number" ? meta.precision : null),
        total_raw: rep.totals[id].total_raw,
        perPage_raw: rep.totals[id].perPage_raw };
    });
    out.sort(function (x, y) { /* descending |total| (BigInt compare, never float) */
      var ax = BigInt(x.total_raw), bx = BigInt(y.total_raw);
      ax = ax < 0n ? -ax : ax;
      bx = bx < 0n ? -bx : bx;
      return ax === bx ? 0 : (ax > bx ? -1 : 1);
    });
    var eventsSeen = 0, p;
    for (p = 0; p < walk.pages.length; p++) eventsSeen += walk.pages[p].length;
    return { assets: out, pagesFetched: walk.pages.length, eventsSeen: eventsSeen,
      counted: rep.counted, skipped: rep.skipped, truncated: walk.truncated };
  }

  /** Return the account id bound to the unlocked wallet's active (seq1) key.
   * Params: none (reads Wallet in-memory keys + brainkey).
   * Returns: Promise of the account id string.
   * Fails: "wallet-locked" unless unlocked; "no-account" when the active
   *   pub has no key reference on chain.
   * @returns {Promise<string>} */
  async function myAccountId() {
    var unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys;
    if (!unlocked || !Wallet.keys) throw new Error("wallet-locked");
    var brainkey = Wallet.getBrainkey();
    var privHex = await /** @type {any} */ (Crypto).brainPrivateKeyHex(brainkey, 1);
    var kp = await /** @type {any} */ (Crypto).keypairFromPrivateHex(privHex);
    var dbId = await Chain.db();
    var refs = await Chain.call(dbId, "get_key_references", [[kp.pub]]);
    if (refs && refs[0] && refs[0][0]) return refs[0][0];
    throw new Error("no-account");
  }

  /* List open limit orders for ANY account id — public chain data, no wallet
   * needed (mirrors #1, where only cancel requires ownership).
   * Params: id account id string ("1.2.N").
   * Returns: Promise of [{id, expiration, sell:{...}, buy:{...}, priceDisplay}]
   *   with human display strings (base-per-quote, Format helpers). Empty book
   *   yields [] (renders an empty state downstream, never throws). */
  async function openOrders(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_limit_orders_by_account", [id, 100]);
    if (!rows || rows.length === 0) return [];
    var ids = {}, i, sp;
    for (i = 0; i < rows.length; i++) {
      sp = rows[i].sell_price || {};
      if (sp.base && sp.base.asset_id) ids[sp.base.asset_id] = 1;
      if (sp.quote && sp.quote.asset_id) ids[sp.quote.asset_id] = 1;
    }
    var assets = await Chain.call(dbId, "get_assets", [Object.keys(ids)]);
    var byId = {};
    for (i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a) continue;
      if (typeof a.precision !== "number") throw new Error("bad-asset-shape");
      byId[a.id] = a;
    }
    function leg(side) {
      var meta = byId[side.asset_id];
      if (!meta || typeof meta.precision !== "number") throw new Error("bad-asset-shape");
      var raw = String(side.amount);
      return {asset_id: side.asset_id, symbol: meta.symbol, precision: meta.precision,
        raw: raw, display: Format.formatAmount(raw, meta.precision)};
    }
    var out = [];
    for (i = 0; i < rows.length; i++) {
      var sell = leg(rows[i].sell_price.base), buy = leg(rows[i].sell_price.quote);
      out.push({id: rows[i].id, expiration: rows[i].expiration, sell: sell, buy: buy,
        priceDisplay: Format.formatPrice(sell.raw, sell.precision, buy.raw, buy.precision, 8)});
    }
    return out;
  }

  return {
    resolve: resolve,
    balances: balances,
    history: history,
    historyPaged: historyPaged,
    opsFiltered: opsFiltered,
    _opsArgs: _opsArgs,
    replayEquity: replayEquity,
    equity: equity,
    openOrders: openOrders,
    myAccountId: myAccountId
  };
})();

if (typeof module !== "undefined") { module.exports = Account; }
