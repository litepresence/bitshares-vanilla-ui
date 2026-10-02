/* Explorer: read-only chain-explorer data layer (head, blocks, transactions,
 *   assets, feeds, object resolution, search dispatch).
 * Owns: all explorer chain reads + normalization to plain JSON. No rendering,
 *   no signing, no broadcast, no serializer — reads only.
 * Consumes: Chain.db/.call (sole socket owner), Account.resolve (search only).
 * Globals/side effects: exposes global Explorer only; no DOM, no key material.
 * Created by: building-vanilla-slices skill, slice-09-explorer plan Task 1.
 * Chain truth (#4 wins; see slice-09 plan References): database_api.hpp
 *   (get_objects, block/tx getters, global props, asset reads); feeds via
 *   asset.bitasset_data_id + get_objects (wallet.hpp:280); op enum 0-77
 *   (operations.hpp:56-133); space 1.x.y protocol + 2.x.y implementation
 *   (protocol/types.hpp:297-299,361-386; chain/types.hpp implementation list:
 *   2.3.x asset_dynamic_data, 2.4.x asset_bitasset_data).
 * Money discipline (#6): amount/price/percent leaves stay RAW strings until
 *   the view formats them via Format — no Number(), no float math, ever.
 */
var Explorer = (function () {
  "use strict";

  var RECENT_MAX = 50; /* recentBlocks cap (plan) */
  var ASSETS_PAGE = 25; /* asset page default (#1 Assets.jsx 25/page) */
  var ASSETS_PAGE_MAX = 100; /* rows-per-page ceiling (10/25/50/100 punchlist) */
  var OBJECT_RE = /^([12])\.(\d+)\.(\d+)$/;
  var ASSET_ID_RE = /^1\.3\.\d+$/;
  var TXHASH_RE = /^[0-9a-fA-F]{40}$/; /* transaction_id_type is ripemd160
    * (chain.js assertPropsShape: 40 hex, NOT 64 — types.hpp:304) */

  /* Op index -> short name, FC_REFLECT order <- operations.hpp:56-133. */
  var OP_NAMES = ["transfer", "limit_order_create", "limit_order_cancel", "call_order_update",
    "fill_order", "account_create", "account_update", "account_whitelist", "account_upgrade",
    "account_transfer", "asset_create", "asset_update", "asset_update_bitasset",
    "asset_update_feed_producers", "asset_issue", "asset_reserve", "asset_fund_fee_pool",
    "asset_settle", "asset_global_settle", "asset_publish_feed", "witness_create",
    "witness_update", "proposal_create", "proposal_update", "proposal_delete",
    "withdraw_permission_create", "withdraw_permission_update", "withdraw_permission_claim",
    "withdraw_permission_delete", "committee_member_create", "committee_member_update",
    "committee_member_update_global_parameters", "vesting_balance_create",
    "vesting_balance_withdraw", "worker_create", "custom", "assert", "balance_claim",
    "override_transfer", "transfer_to_blind", "blind_transfer", "transfer_from_blind",
    "asset_settle_cancel", "asset_claim_fees", "fba_distribute", "bid_collateral",
    "execute_bid", "asset_claim_pool", "asset_update_issuer", "htlc_create", "htlc_redeem",
    "htlc_redeemed", "htlc_extend", "htlc_refund", "custom_authority_create",
    "custom_authority_update", "custom_authority_delete", "ticket_create", "ticket_update",
    "liquidity_pool_create", "liquidity_pool_delete", "liquidity_pool_deposit",
    "liquidity_pool_withdraw", "liquidity_pool_exchange", "samet_fund_create",
    "samet_fund_delete", "samet_fund_update", "samet_fund_borrow", "samet_fund_repay",
    "credit_offer_create", "credit_offer_delete", "credit_offer_update",
    "credit_offer_accept", "credit_deal_repay", "credit_deal_expired",
    "liquidity_pool_update", "credit_deal_update", "limit_order_update"];
  var VIRTUAL = { 4: 1, 42: 1, 44: 1, 46: 1, 51: 1, 53: 1, 74: 1 }; /* VIRTUAL ops */
  var SPACE = {"1.0": "null", "1.1": "base", "1.2": "account", "1.3": "asset",
    "1.4": "force_settlement", "1.5": "committee_member", "1.6": "witness",
    "1.7": "limit_order", "1.8": "call_order", "1.9": "custom", "1.10": "proposal",
    "1.11": "operation_history", "1.12": "withdraw_permission", "1.13": "vesting_balance",
    "1.14": "worker", "1.15": "balance", "1.16": "htlc", "1.17": "custom_authority",
    "1.18": "ticket", "1.19": "liquidity_pool", "1.20": "samet_fund",
    "1.21": "credit_offer", "1.22": "credit_deal",
    "2.0": "global_property", "2.1": "dynamic_global_property", "2.2": "reserved",
    "2.3": "asset_dynamic_data", "2.4": "asset_bitasset_data", "2.5": "account_balance",
    "2.6": "account_statistics", "2.7": "transaction_history", "2.8": "block_summary",
    "2.9": "account_history", "2.10": "blinded_balance", "2.11": "chain_property",
    "2.12": "witness_schedule", "2.13": "budget_record", "2.14": "special_authority",
    "2.15": "buyback", "2.16": "fba_accumulator", "2.17": "collateral_bid",
    "2.18": "credit_deal_summary"};

  /* In-flight RPC memo, keyed by method+params (perf: the blocks tip
   *   fires same-tick bursts — head/recent/ops each fetch dynamic_global,
   *   per-row amount/account joins repeat ids. One socket write per key per
   *   tick, never two. Pending ONLY: entries delete on settle, so no
   *   completed data is ever cached here (blocks bodies are shared per-render
   *   via withBodies/preloaded, never across renders). Same promise shared,
   *   behavior identical. */
  var _inflight = {};
  function _key(method, params) {
    try { return method + "|" + JSON.stringify(params || []); }
    catch (e) { return method + "|" + String(params); }
  }

  /* One database-API round trip; "not-connected" when no socket is open. */
  async function _dbCall(method, params) {
    var k = _key(method, params);
    if (Object.prototype.hasOwnProperty.call(_inflight, k)) {
      return _inflight[k];
    }
    var p = _dbCallInner(method, params);
    _inflight[k] = p;
    p.then(function () { delete _inflight[k]; },
      function () { delete _inflight[k]; });
    return p;
  }

  /* Inner database-API round trip (unchanged contract — see _dbCall). */
  async function _dbCallInner(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); } catch (e) {
      var m = (e && e.message) ? e.message : String(e || "");
      if (m.indexOf("not connected") !== -1) throw new Error("not-connected");
      throw e;
    }
  }

  /* Op index -> {type_idx, type_name, virtual}; unknown indexes yield
   * "unknown" (never throw — a future op must not break reads). */
  function _opRef(idx) {
    var i = (typeof idx === "number") ? idx : parseInt(idx, 10);
    if (!(i >= 0) || i >= OP_NAMES.length) return { type_idx: idx, type_name: "unknown", virtual: false };
    return { type_idx: i, type_name: OP_NAMES[i], virtual: !!VIRTUAL[i] };
  }

  /* Chain head + irreversibility anchor (heights verbatim plain ints).
   * The chain sends the head time as `time` (dynamic_global_property_object,
   * global_property_object.hpp:68); `head_block_time` is kept as a fallback
   * for node variance. recently_missed_count rides the same object
   * (dynamic_global_property_object) — verbatim when present, null when the
   * node omits it (the view renders an honest dash, never a guess). */
  async function head() {
    var g = await _dbCall("get_dynamic_global_properties", []);
    var t = (g && g.time !== undefined && g.time !== null) ? g.time : g.head_block_time;
    var missed = (g && g.recently_missed_count !== undefined && g.recently_missed_count !== null)
      ? g.recently_missed_count : null;
    return { head_block_number: g.head_block_number, head_block_time: t,
      last_irreversible_block_num: g.last_irreversible_block_num,
      recently_missed_count: missed };
  }

  /* Normalize one batch element to a header. The node returns
   * map<uint32_t, header> (database_api.hpp:173), which serializes over
   * JSON-RPC as [height, header] PAIRS (fc map encoding); bare headers and
   * dict rows are accepted defensively. Returns the header or null. */
  function _asHeader(x) {
    if (!x) return null;
    if (Array.isArray(x)) {
      if (x.length === 2 && x[1] && typeof x[1] === "object") return x[1];
      if (x.length === 1 && x[0] && typeof x[0] === "object") return x[0];
      return null;
    }
    if (typeof x === "object" && x.timestamp !== undefined) return x;
    return null;
  }

  /* Newest-first [{height, timestamp, witness, tx_count}]. Params: count
   * 1..50 (default 20). Batch method with per-height fallback. Block headers
   * carry no tx count, so counts are filled per displayed row via get_block
   * (parallel; any single failure -> null, never a throw). withBodies
   * (optional, default false — perf): when true each row also carries `body`
   * (the fetched full block, null when its fetch failed) so the caller can
   * hand the same bodies to recentOps' preloaded map instead of re-fetching
   * the same top heights (the tip used to fetch them twice). Same render
   * only — bodies are never stored across calls. */
  async function recentBlocks(count, withBodies) {
    var n = parseInt(count, 10);
    if (!(n >= 1)) n = 20;
    n = Math.min(n, RECENT_MAX);
    var wantBodies = withBodies === true;
    var top = (await _dbCall("get_dynamic_global_properties", [])).head_block_number;
    var heights = [], h, i;
    for (h = Math.max(1, top - n + 1); h <= top; h++) heights.push(h);
    var batch = null;
    try { batch = await _dbCall("get_block_header_batch", [heights]); } catch (e) {
      if (e && e.message === "not-connected") throw e;
      batch = null;
    }
    var rows = [];
    if (batch) {
      var byPos = Array.isArray(batch) && batch.length === heights.length;
      for (i = 0; i < heights.length; i++) {
        var raw = byPos ? batch[i] : (batch[heights[i]] || batch[String(heights[i])]);
        var hdr = _asHeader(raw);
        if (hdr) rows.push({ height: heights[i], timestamp: hdr.timestamp, witness: hdr.witness,
          tx_count: null });
      }
    } else {
      for (i = 0; i < heights.length; i++) {
        var b = await _dbCall("get_block_header", [heights[i]]);
        if (b) rows.push({ height: heights[i], timestamp: b.timestamp, witness: b.witness,
          tx_count: null });
      }
    }
    var counts = await Promise.all(rows.map(function (r) {
      return _dbCall("get_block", [r.height]).then(function (blk) {
        if (wantBodies) r.body = blk || null;
        return (blk && Array.isArray(blk.transactions)) ? blk.transactions.length : null;
      }).catch(function (e) {
        if (wantBodies) r.body = null;
        if (e && e.message === "not-connected") throw e;
        return null;
      });
    }));
    for (i = 0; i < rows.length; i++) rows[i].tx_count = counts[i];
    return rows.reverse();
  }

  /* Active governance sets from the 2.0.0 global property object
   * (chain/global_property_object.hpp:48-49: active_witnesses is a
   * flat_set<witness_id_type>, active_committee_members a vector of
   * committee ids). Read method is get_objects — the same call Vote.lists
   * and resolveObject already use, no new chain surface. Returns
   * {witnesses: number|null, committee: number|null} (null when the node
   * omits either field — the view dashes, never guesses). */
  async function activeSets() {
    var rows = await _dbCall("get_objects", [["2.0.0"]]);
    var g = (rows && rows[0]) || {};
    return {
      witnesses: Array.isArray(g.active_witnesses) ? g.active_witnesses.length : null,
      committee: Array.isArray(g.active_committee_members) ? g.active_committee_members.length : null
    };
  }

  /* BTS money supply from the existing asset() join (lookup_asset_symbols +
   * get_objects + get_assets — no new methods). Returns {symbol, precision,
   * current_raw, stealth_raw} with raw integer strings (Format at render).
   * Null raws when the dynamic join is missing — the view dashes. */
  async function btsSupply() {
    var j = await asset("BTS"); /* throws unknown-asset when missing */
    var dyn = j.dynamic || {};
    return {
      symbol: (j.asset && j.asset.symbol) || "BTS",
      precision: (j.asset && typeof j.asset.precision === "number") ? j.asset.precision : null,
      current_raw: (dyn.current_supply !== undefined && dyn.current_supply !== null)
        ? String(dyn.current_supply) : null,
      stealth_raw: (dyn.confidential_supply !== undefined && dyn.confidential_supply !== null)
        ? String(dyn.confidential_supply) : null
    };
  }

  /* Newest-first ops with FIELDS for the activity feed (the block() view
   * above strips fields to type refs; the feed needs amounts/accounts).
   * Same two methods recentBlocks/block already use
   * (get_dynamic_global_properties + get_block) — no new chain surface.
   * Params: maxOps (default 10), maxBlocks scanned newest-first (default 8),
   * preloaded (optional {height: body} — bodies fetched by the caller's own
   * recentBlocks(withBodies) pass; heights found there skip get_block, so the
   * tip no longer fetches the same top blocks twice. Same render only).
   * Returns [{block, tx, op, type_idx, type_name, virtual, fields}]. Gaps
   * (null blocks) are skipped, never thrown. */
  async function recentOps(maxOps, maxBlocks, preloaded) {
    var mo = parseInt(maxOps, 10);
    if (!(mo >= 1)) mo = 10;
    mo = Math.min(mo, 20);
    var mb = parseInt(maxBlocks, 10);
    if (!(mb >= 1)) mb = 8;
    mb = Math.min(mb, 12);
    var top = (await _dbCall("get_dynamic_global_properties", [])).head_block_number;
    var out = [];
    var pre = (preloaded && typeof preloaded === "object") ? preloaded : null;
    for (var h = top; h >= 1 && h > top - mb && out.length < mo; h--) {
      var blk;
      if (pre && Object.prototype.hasOwnProperty.call(pre, h) && pre[h]) {
        blk = pre[h];
      } else {
        try { blk = await _dbCall("get_block", [h]); } catch (e) {
          if (e && e.message === "not-connected") throw e;
          continue;
        }
      }
      if (!blk || !Array.isArray(blk.transactions)) continue;
      for (var ti = 0; ti < blk.transactions.length && out.length < mo; ti++) {
        var ops = Array.isArray(blk.transactions[ti].operations)
          ? blk.transactions[ti].operations : [];
        for (var oi = 0; oi < ops.length && out.length < mo; oi++) {
          var o = ops[oi];
          var ref = _opRef(Array.isArray(o) ? o[0] : o.type);
          out.push({ block: h, tx: ti, op: oi,
            type_idx: ref.type_idx, type_name: ref.type_name, virtual: ref.virtual,
            fields: Array.isArray(o) ? o[1] : o });
        }
      }
    }
    return out;
  }

  /* Op rows from ONE block body (pure shaping, no chain calls): the same
   * extraction recentOps runs per height, factored so the live tip can feed
   * new heads into the activity panel with ZERO new RPCs (the body was
   * already fetched for the table). Params: height (number), transactions
   * (raw block.transactions array or falsy). Returns [{block, tx, op,
   * type_idx, type_name, virtual, fields}], capped internally at 20 rows.
   * Gaps/malformed shapes yield [] — never throws. Unit-tested. */
  function opsFromBody(height, transactions) {
    var out = [];
    try {
      var txs = Array.isArray(transactions) ? transactions : [];
      for (var ti = 0; ti < txs.length && out.length < 20; ti++) {
        var ops = (txs[ti] && Array.isArray(txs[ti].operations)) ? txs[ti].operations : [];
        for (var oi = 0; oi < ops.length && out.length < 20; oi++) {
          var o = ops[oi];
          var ref = _opRef(Array.isArray(o) ? o[0] : o.type);
          out.push({ block: height, tx: ti, op: oi,
            type_idx: ref.type_idx, type_name: ref.type_name, virtual: ref.virtual,
            fields: Array.isArray(o) ? o[1] : o });
        }
      }
    } catch (e) { /* [] stands */ }
    return out;
  }

  /* Full block with per-tx op rows (height attached client-side, #1 :39
   * pattern). Fails "unknown-block" on null/node error (never crash).
   * Carries `raw` (original transactions array) so live consumers can run
   * opsFromBody with no second fetch. */
  async function block(height) {
    var h = parseInt(height, 10);
    if (!(h >= 1)) throw new Error("unknown-block");
    var b;
    try { b = await _dbCall("get_block", [h]); } catch (e) {
      if (e && e.message === "not-connected") throw e;
      throw new Error("unknown-block");
    }
    if (!b) throw new Error("unknown-block");
    var txs = Array.isArray(b.transactions) ? b.transactions : [];
    return { height: h, timestamp: b.timestamp || "", witness_account_id: b.witness || "",
      tx_count: txs.length, raw: txs,
      transactions: txs.map(function (t, i) {
        var ops = Array.isArray(t.operations) ? t.operations : [];
        return { index: i, op_count: ops.length,
          ops: ops.map(function (o) { return _opRef(Array.isArray(o) ? o[0] : o.type); }) };
      }) };
  }

  /* One processed tx; fields is the RAW op JSON (humanization is the view's
   * job). Fails "unknown-tx" on null/node error. */
  async function tx(height, index) {
    var h = parseInt(height, 10), ix = parseInt(index, 10);
    if (!(h >= 1) || !(ix >= 0)) throw new Error("unknown-tx");
    var t;
    try { t = await _dbCall("get_transaction", [h, ix]); } catch (e) {
      if (e && e.message === "not-connected") throw e;
      throw new Error("unknown-tx");
    }
    if (!t) throw new Error("unknown-tx");
    var ops = Array.isArray(t.operations) ? t.operations : [];
    return { block: h, index: ix,
      ops: ops.map(function (o) {
        var ref = _opRef(Array.isArray(o) ? o[0] : o.type);
        return { type_idx: ref.type_idx, type_name: ref.type_name, virtual: ref.virtual,
          fields: Array.isArray(o) ? o[1] : o };
      }),
      signatures: Array.isArray(t.signatures) ? t.signatures.slice() : [] };
  }

  /* One asset-list page (raw extended_asset_objects). lower: bound symbol
   * ("" from top); limit 1..100 (default 25). */
  function assetsPage(lower, limit) {
    var lim = parseInt(limit, 10);
    if (!(lim >= 1)) lim = ASSETS_PAGE;
    return _dbCall("list_assets", [typeof lower === "string" ? lower : "", Math.min(lim, ASSETS_PAGE_MAX)]);
  }

  /* One asset + bitasset/dynamic joins. Absent bitasset_data_id yields
   * {is_smartcoin: false} (NOT error). Fails "unknown-asset" on null. */
  async function asset(symbolOrId) {
    if (typeof symbolOrId !== "string" || !symbolOrId) throw new Error("unknown-asset");
    var found = null;
    if (ASSET_ID_RE.test(symbolOrId)) {
      var byId = await _dbCall("get_objects", [[symbolOrId]]);
      found = byId && byId[0];
    } else {
      var rows = await _dbCall("lookup_asset_symbols", [[symbolOrId]]);
      found = rows && rows[0];
    }
    if (!found) throw new Error("unknown-asset");
    var out = { asset: found, bitasset: null, dynamic: null, is_smartcoin: !!found.bitasset_data_id };
    var want = [];
    if (found.bitasset_data_id) want.push(found.bitasset_data_id);
    if (found.dynamic_asset_data_id) want.push(found.dynamic_asset_data_id);
    if (want.length === 0) return out;
    var objs = await _dbCall("get_objects", [want]), k = 0;
    if (found.bitasset_data_id) out.bitasset = (objs || [])[k++] || null;
    if (found.dynamic_asset_data_id) out.dynamic = (objs || [])[k++] || null;
    return out;
  }

  /* Price-pair + precision lookup shared by feeds(): raw settlement/feed
   * pairs stay verbatim; precisions of both sides attached for
   * Format.formatPrice. Non-MPAs yield null feed fields (NOT error). */
  async function feeds(symbols) {
    var list = Array.isArray(symbols) ? symbols : [symbols];
    var joins = [], quoteIds = [], seen = {}, i;
    for (i = 0; i < list.length; i++) {
      var j = await asset(list[i]); /* throws unknown-asset when missing */
      joins.push(j);
      var ba0 = j.bitasset, cf0 = ba0 && ba0.current_feed;
      var s0 = (cf0 && cf0.settlement_price) || (ba0 && ba0.settlement_price);
      var qid = s0 && s0.quote && s0.quote.asset_id;
      if (typeof qid === "string" && !seen[qid]) { seen[qid] = 1; quoteIds.push(qid); }
    }
    var precById = {};
    if (quoteIds.length > 0) {
      var qrows = await _dbCall("get_assets", [quoteIds]);
      for (i = 0; i < (qrows || []).length; i++) {
        if (qrows[i]) precById[qrows[i].id] = qrows[i].precision;
      }
    }
    return joins.map(function (jj) {
      var a = jj.asset, ba = jj.bitasset;
      if (!jj.is_smartcoin || !ba) {
        return { symbol: a.symbol, asset_id: a.id, precision: a.precision, is_smartcoin: false,
          settlement_raw: null, feed_raw: null, mssr_hundredths: null, mcr: null,
          feed_lifetime_sec: null, min_feeds: null, base_precision: a.precision,
          quote_precision: null };
      }
      var cf = ba.current_feed || null; /* ambiguity A: prefer current_feed */
      var settle = (cf && cf.settlement_price) || ba.settlement_price || null;
      var q2 = settle && settle.quote && settle.quote.asset_id;
      var opts = ba.options || {};
      return { symbol: a.symbol, asset_id: a.id, precision: a.precision, is_smartcoin: true,
        settlement_raw: settle, feed_raw: cf ? (cf.settlement_price || null) : null,
        mssr_hundredths: (cf && cf.maximum_short_squeeze_ratio !== undefined)
          ? cf.maximum_short_squeeze_ratio : (ba.current_max_short_squeeze_ratio ?? null),
        mcr: (cf && cf.maintenance_collateral_ratio !== undefined)
          ? cf.maintenance_collateral_ratio : (ba.current_maintenance_collateralization ?? null),
        feed_lifetime_sec: opts.feed_lifetime_sec !== undefined ? opts.feed_lifetime_sec : null,
        min_feeds: opts.minimum_feeds !== undefined ? opts.minimum_feeds : null,
        base_precision: a.precision,
        quote_precision: (typeof q2 === "string" && precById[q2] !== undefined) ? precById[q2] : null };
    });
  }

  /* Any 1.x.y or 2.x.y id -> {id, space, type, typeName, object};
   * 1.11.x rows also carry op {type_idx, type_name, virtual, fields}.
   * Space 1 is protocol objects, space 2 is implementation objects
   * (chain/types.hpp: global_property 2.0.x … asset_dynamic_data 2.3.x,
   * asset_bitasset_data 2.4.x …). Supply joins resolve 2.3.x dynamics and
   * 2.4.x bitassets through this same get_objects flow. Fails
   * "unknown-object" on bad ids/null rows; "not-connected" passes through. */
  async function resolveObject(id) {
    var m = (typeof id === "string") ? id.match(OBJECT_RE) : null;
    if (!m) throw new Error("unknown-object");
    var rows = await _dbCall("get_objects", [[id]]);
    var obj = rows && rows[0];
    if (!obj) throw new Error("unknown-object");
    /* OBJECT_RE captures the space: m[1] is space (1|2), m[2] is the TYPE,
     * m[3] the instance (protocol_ids=1, implementation_ids=2,
     * types.hpp:297-299 + chain/types.hpp implementation list). */
    var space = parseInt(m[1], 10), type = parseInt(m[2], 10);
    var entry = { id: id, space: space, type: type,
      typeName: SPACE[space + "." + type] || "unknown", object: obj };
    if (space === 1 && type === 11 && Array.isArray(obj.op)) {
      var ref = _opRef(obj.op[0]);
      entry.op = { type_idx: ref.type_idx, type_name: ref.type_name, virtual: ref.virtual,
        fields: obj.op[1] };
    }
    return entry;
  }

  /* Search-input classifier (pure, offline-testable, no chain calls): maps
   * raw box text to the route the shell should take. Branch order matters —
   * first match wins. "1.2.x" stays kind object (the shell's routeObject
   * redirects those to #/account/:name, 1.3.x to #/asset/:symbol — same
   * account-first outcome as search(), never a competing answer). A bare
   * "BTS" or "alice" is kind text: resolution order there is account first,
   * then asset symbol (search() below) — documented, never guessed in this
   * helper. A 40-hex string is kind txhash, resolved by resolveTxHash()
   * below (ES block context first, WS location-less fallback — never a
   * guessed block).
   * Params: q (any, stringified + trimmed). Returns {kind, ...}: block
   * {height}, object {id}, txhash {id}, text {text}, empty {}. Fails: never. */
  function classifySearchInput(q) {
    var s = (typeof q === "string") ? q.trim() : String(q === undefined || q === null ? "" : q).trim();
    if (!s) return { kind: "empty" };
    if (/^\d+$/.test(s)) {
      var h = parseInt(s, 10);
      if (h >= 1) return { kind: "block", height: h };
      return { kind: "text", text: s };
    }
    if (OBJECT_RE.test(s)) return { kind: "object", id: s };
    if (TXHASH_RE.test(s)) return { kind: "txhash", id: s };
    return { kind: "text", text: s };
  }

  /* Absolute share URL for a hash deep link the router already resolves
   * (router.js: #/block/:height, #/block/:height/:txIndex, #/account/:name,
   * #/asset/:symbol — every share target below is one of these, never a new
   * route). Params: base (page origin without hash, may be "" under node),
   * hash ("#/…"). Returns base + hash. Pure — unit-tested. */
  function shareUrl(base, hash) {
    return String(base || "") + String(hash || "");
  }

  /* Current page origin + hash (the clipboard payload). Params: hash. Returns
   * the absolute URL string. Fails: never — missing location yields the bare
   * hash (still a working deep link once pasted after the origin). */
  function currentShareUrl(hash) {
    var base = "";
    try {
      if (typeof location !== "undefined" && location && typeof location.href === "string") {
        base = location.href.split("#")[0];
      }
    } catch (e) { base = ""; }
    return shareUrl(base, hash);
  }

  /* lookup_accounts pair-shape normalizer (pure, unit-tested): the node
   * answers the #4 map<string,account_id> (database_api.hpp:357-359) over
   * JSON-RPC as [name, id] PAIRS (same fc map encoding as _asHeader's
   * [height, header] pairs above); some nodes answer a plain object instead.
   * Params: raw (anything), limit (cap). Returns [{name, id}] (possibly []).
   * Fails: never — garbage yields []. */
  function normSuggestPairs(raw, limit) {
    var out = [], lim = parseInt(limit, 10);
    if (!(lim >= 1)) lim = 8;
    lim = Math.min(lim, 20);
    try {
      if (Array.isArray(raw)) {
        for (var i = 0; i < raw.length && out.length < lim; i++) {
          var p = raw[i];
          if (Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "string") {
            out.push({ name: p[0], id: p[1] });
          } else if (p && typeof p === "object" && typeof p.name === "string") {
            out.push({ name: p.name, id: String(p.id || "") });
          }
        }
      } else if (raw && typeof raw === "object") {
        var keys = Object.keys(raw);
        for (var k = 0; k < keys.length && out.length < lim; k++) {
          if (typeof raw[keys[k]] === "string") out.push({ name: keys[k], id: raw[keys[k]] });
        }
      }
    } catch (e) { /* [] stands */ }
    return out;
  }

  /* Account-name typeahead (read-only): lookup_accounts(prefix, limit) per
   * #4 database_api.hpp:357-359 (lower_bound_name + limit; bitshares-ui's
   * own accountApi.js:8 calls it the same way). Returns [{name, id}] (possibly
   * [] on offline/error — the caller fails open, never blocks submit). */
  function suggestAccounts(prefix, limit) {
    var p = (typeof prefix === "string") ? prefix : "";
    var lim = parseInt(limit, 10);
    if (!(lim >= 1)) lim = 8;
    lim = Math.min(lim, 20);
    if (!p) return Promise.resolve([]);
    return _dbCall("lookup_accounts", [p, lim]).then(function (rows) {
      return normSuggestPairs(rows, lim);
    }, function () { return []; });
  }

  /* Asset-symbol typeahead (read-only): there is NO lookup_assets method on
   * #4 — the honest pair is list_assets(lower_bound_symbol, limit)
   * (database_api.hpp:435, prefix paging; bitshares-ui AssetActions.js:541
   * pages it the same way) for prefix matches, with lookup_asset_symbols
   * reserved for exact symbols (search() below keeps that). Symbols are
   * UPPERCASE on chain, so a lowercase prefix would sort past them
   * (ASCII): both the raw and uppercased prefixes are queried and merged by
   * id. Returns [{symbol, id}] (possibly []). */
  function suggestAssets(prefix, limit) {
    var p = (typeof prefix === "string") ? prefix : "";
    var lim = parseInt(limit, 10);
    if (!(lim >= 1)) lim = 8;
    lim = Math.min(lim, 20);
    if (!p) return Promise.resolve([]);
    var variants = [p], up = p.toUpperCase();
    if (up !== p) variants.push(up);
    return Promise.all(variants.map(function (v) {
      return _dbCall("list_assets", [v, lim]).then(function (rows) { return rows || []; },
        function () { return []; });
    })).then(function (pages) {
      var seen = {}, out = [];
      pages.forEach(function (rows) {
        (rows || []).forEach(function (a) {
          if (!a || typeof a.id !== "string" || out.length >= lim) return;
          if (seen[a.id]) return;
          seen[a.id] = 1;
          out.push({ symbol: String(a.symbol || a.id), id: a.id });
        });
      });
      return out;
    });
  }

  /* Search dispatch: 1.x.y -> object; else account (Account.resolve); else
   * asset symbol (upper/lower variants, no fuzzy lib). Fails
   * "unknown-object"; "not-connected" passes through. */
  async function search(q) {
    var s = (typeof q === "string") ? q.trim() : "";
    if (!s) throw new Error("unknown-object");
    if (OBJECT_RE.test(s)) {
      var r = await resolveObject(s);
      r.kind = "object";
      return r;
    }
    if (typeof Account !== "undefined" && Account.resolve) {
      try {
        var a = await Account.resolve(s);
        return { kind: "account", id: a.id, name: a.name };
      } catch (e) {
        if (e && (e.message === "not-connected" || e.message === "not connected")) {
          throw new Error("not-connected");
        }
      }
    }
    var tries = [], seen2 = {}, i;
    [s, s.toUpperCase(), s.toLowerCase()].forEach(function (v) {
      if (!seen2[v]) { seen2[v] = 1; tries.push(v); }
    });
    var rows = await _dbCall("lookup_asset_symbols", [tries]);
    for (i = 0; i < (rows || []).length; i++) {
      if (rows[i]) return { kind: "asset", id: rows[i].id, symbol: rows[i].symbol };
    }
    throw new Error("unknown-object");
  }

  /* 40-hex ripemd160 validation (pure, unit-tested): transaction_id_type is
   * ripemd160 (chain.js assertPropsShape: 40 hex, NOT 64 — types.hpp:304).
   * Strict: no trim, no case fold here — callers normalize first. Params: s
   * (any). Returns boolean. Fails: never. */
  function _isTxHash(s) {
    return typeof s === "string" && TXHASH_RE.test(s);
  }

  /* ES query cascade for one hash (pure, unit-tested — exact DSL including
   * fire order). OBSERVED live 2026-10-02 (curl POST
   * es.bitshares.dev/bitshares-index/_search, trx 393704b7d1e84fa54f5e983c5e980
   * f22edb31dd4 in block 114884983): block context lives at
   * _source.block_data.{block_num,block_time,trx_id} with the tx index at
   * _source.operation_history.trx_in_block — the bare `trx_id[.keyword]`
   * term/match shapes return ZERO hits on this mapping, so the observed
   * block_data shapes lead. The astro-UI trio (Explorer.ts:231-235, bare
   * trx_id fields) rides last as forward-compat in case the mapping ever
   * flattens. Every body is bounded (size 5, never match_all). Params: hash
   * (normalized 40-hex string). Returns [{index, body}] in fire order.
   * Fails: never. */
  function _txHashQueries(hash) {
    var h = String(hash);
    return [
      { index: "bitshares-*", body: { query: { term: { "block_data.trx_id.keyword": h } }, size: 5 } },
      { index: "bitshares-*", body: { query: { term: { "block_data.trx_id": h } }, size: 5 } },
      { index: "bitshares-*", body: { query: { match: { "block_data.trx_id": h } }, size: 5 } },
      { index: "bitshares-*", body: { query: { term: { "trx_id.keyword": h } }, size: 5 } },
      { index: "bitshares-*", body: { query: { term: { trx_id: h } }, size: 5 } },
      { index: "bitshares-*", body: { query: { match: { trx_id: h } }, size: 5 } }
    ];
  }

  /* Block-coord extractor for one ES hit (pure, unit-tested): returns
   * {block, index} or null. OBSERVED fields (see _txHashQueries):
   * block_data.block_num + operation_history.trx_in_block; top-level
   * block_num / block_number / trx_in_block accepted defensively. Guards:
   * block integer >= 1, index integer >= 0 — anything else is null, never a
   * guessed link. Params: hit (ES hit or bare _source). Fails: never. */
  function _txHashBlock(hit) {
    try {
      var src = (hit && hit._source) ? hit._source : null;
      if (!src && hit && hit.block_data) src = hit;
      if (!src || typeof src !== "object") return null;
      var bd = (src.block_data && typeof src.block_data === "object") ? src.block_data : {};
      var oh = (src.operation_history && typeof src.operation_history === "object")
        ? src.operation_history : {};
      var b = bd.block_num;
      if (!(b >= 1) || Math.floor(b) !== b) {
        b = src.block_num;
        if (!(b >= 1) || Math.floor(b) !== b) {
          b = src.block_number;
          if (!(b >= 1) || Math.floor(b) !== b) return null;
        }
      }
      var ix = oh.trx_in_block;
      if (!(ix >= 0) || Math.floor(ix) !== ix) {
        ix = src.trx_in_block;
        if (!(ix >= 0) || Math.floor(ix) !== ix) return null;
      }
      return { block: b, index: ix };
    } catch (e) { return null; }
  }

  /* HistoryCap seam (market-fills-history.js _historyCap pattern): the ONLY
   * raw-ES gateway is HistoryCap.esSearch — this module never fetches. Null
   * when the seam is absent (caller goes WS). Never throws. */
  function _historyCap() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap &&
        typeof HistoryCap.esSearch === "function") return HistoryCap;
    } catch (e) { /* globalThis below */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.HistoryCap &&
        typeof globalThis.HistoryCap.esSearch === "function") return globalThis.HistoryCap;
    } catch (e2) { /* null below */ }
    return null;
  }

  /* One recent tx by id (WS fallback — location-less by chain design:
   * get_recent_transaction_by_id returns optional<signed_transaction> (#4
   * database_api.hpp:200, "not known != not included"), NO block coords.
   * Normalized like tx() ({ops, signatures}) so the view renders it with no
   * block link. Fails "tx-expired-or-unknown" on null/node error/bad input
   * (the views already map that key); "not-connected" passes through. */
  async function recentTxById(hash) {
    var h = (typeof hash === "string") ? hash.trim().toLowerCase() : "";
    if (!_isTxHash(h)) throw new Error("tx-expired-or-unknown");
    var t;
    try { t = await _dbCall("get_recent_transaction_by_id", [h]); } catch (e) {
      if (e && e.message === "not-connected") throw e;
      throw new Error("tx-expired-or-unknown");
    }
    if (!t) throw new Error("tx-expired-or-unknown");
    var ops = Array.isArray(t.operations) ? t.operations : [];
    return { hash: h, block: null, index: null,
      ops: ops.map(function (o) {
        var ref = _opRef(Array.isArray(o) ? o[0] : o.type);
        return { type_idx: ref.type_idx, type_name: ref.type_name, virtual: ref.virtual,
          fields: Array.isArray(o) ? o[1] : o };
      }),
      signatures: Array.isArray(t.signatures) ? t.signatures.slice() : [] };
  }

  /* Bare-hash resolution (never throws — every path resolves to a renderable
   * state the submit handler paints):
   *   {status:"block", block, index} — ES hit WITH block context (deep link);
   *   {status:"tx", tx} — WS location-less tx (render WITHOUT a block link);
   *   {status:"not-found"} — neither knew it (keyed notice + settings link);
   *   {status:"offline"} — socket cold (offline panel);
   *   {status:"invalid"} — not 40-hex (same notice as not-found).
   * The ES cascade stops at the first hit carrying block coords; any
   * esSearch reject (es-disabled/es-unavailable) drops straight to the WS
   * fallback — further ES tries would fail the same way. */
  async function resolveTxHash(hash) {
    var h = (typeof hash === "string") ? hash.trim().toLowerCase() : "";
    if (!_isTxHash(h)) return { status: "invalid", hash: String(hash || "") };
    var HC = _historyCap();
    if (HC) {
      var bodies = _txHashQueries(h), i, k;
      for (i = 0; i < bodies.length; i++) {
        var data = null;
        try { data = await HC.esSearch(bodies[i].index, bodies[i].body); }
        catch (e) { break; }
        var hits = (data && data.hits && data.hits.hits) || [];
        for (k = 0; k < hits.length; k++) {
          var loc = _txHashBlock(hits[k]);
          if (loc) return { status: "block", block: loc.block, index: loc.index, hash: h };
        }
      }
    }
    try {
      var t = await recentTxById(h);
      return { status: "tx", hash: h, tx: t };
    } catch (e) {
      if (e && e.message === "not-connected") return { status: "offline", hash: h };
      return { status: "not-found", hash: h };
    }
  }

  return { head: head, recentBlocks: recentBlocks, block: block, tx: tx,
    assetsPage: assetsPage, activeSets: activeSets, btsSupply: btsSupply,
    recentOps: recentOps, opsFromBody: opsFromBody,
    asset: asset, feeds: feeds, resolveObject: resolveObject, search: search,
    classifySearchInput: classifySearchInput, shareUrl: shareUrl,
    currentShareUrl: currentShareUrl, suggestAccounts: suggestAccounts,
    suggestAssets: suggestAssets, _normSuggestPairs: normSuggestPairs,
    recentTxById: recentTxById, resolveTxHash: resolveTxHash,
    _isTxHash: _isTxHash, _txHashQueries: _txHashQueries,
    _txHashBlock: _txHashBlock };
})();

if (typeof module !== "undefined") { module.exports = Explorer; }
