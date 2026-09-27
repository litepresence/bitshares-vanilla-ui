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
 *   (operations.hpp:56-133); space 1.x.y (types.hpp:361-386).
 * Money discipline (#6): amount/price/percent leaves stay RAW strings until
 *   the view formats them via Format — no Number(), no float math, ever.
 */
var Explorer = (function () {
  "use strict";

  var RECENT_MAX = 50; /* recentBlocks cap (plan) */
  var ASSETS_PAGE = 25; /* asset page size (#1 Assets.jsx 25/page) */
  var OBJECT_RE = /^1\.(\d+)\.(\d+)$/;
  var ASSET_ID_RE = /^1\.3\.\d+$/;

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
    "1.21": "credit_offer", "1.22": "credit_deal"};

  /* One database-API round trip; "not-connected" when no socket is open. */
  async function _dbCall(method, params) {
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
   * for node variance. */
  async function head() {
    var g = await _dbCall("get_dynamic_global_properties", []);
    var t = (g && g.time !== undefined && g.time !== null) ? g.time : g.head_block_time;
    return { head_block_number: g.head_block_number, head_block_time: t,
      last_irreversible_block_num: g.last_irreversible_block_num };
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
   * (parallel; any single failure -> null, never a throw). */
  async function recentBlocks(count) {
    var n = parseInt(count, 10);
    if (!(n >= 1)) n = 20;
    n = Math.min(n, RECENT_MAX);
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
        return (blk && Array.isArray(blk.transactions)) ? blk.transactions.length : null;
      }).catch(function (e) {
        if (e && e.message === "not-connected") throw e;
        return null;
      });
    }));
    for (i = 0; i < rows.length; i++) rows[i].tx_count = counts[i];
    return rows.reverse();
  }

  /* Full block with per-tx op rows (height attached client-side, #1 :39
   * pattern). Fails "unknown-block" on null/node error (never crash). */
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
      tx_count: txs.length,
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
   * ("" from top); limit 1..25. */
  function assetsPage(lower, limit) {
    var lim = parseInt(limit, 10);
    if (!(lim >= 1)) lim = ASSETS_PAGE;
    return _dbCall("list_assets", [typeof lower === "string" ? lower : "", Math.min(lim, ASSETS_PAGE)]);
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

  /* Any 1.x.y id -> {id, space, type, typeName, object}; 1.11.x rows also
   * carry op {type_idx, type_name, virtual, fields}. Fails "unknown-object". */
  async function resolveObject(id) {
    var m = (typeof id === "string") ? id.match(OBJECT_RE) : null;
    if (!m) throw new Error("unknown-object");
    var rows = await _dbCall("get_objects", [[id]]);
    var obj = rows && rows[0];
    if (!obj) throw new Error("unknown-object");
    /* OBJECT_RE hardcodes the leading space: m[1] is the TYPE, m[2] the
     * instance (space is literal 1, types.hpp:361-386). */
    var space = 1, type = parseInt(m[1], 10);
    var entry = { id: id, space: space, type: type,
      typeName: SPACE[space + "." + type] || "unknown", object: obj };
    if (space === 1 && type === 11 && Array.isArray(obj.op)) {
      var ref = _opRef(obj.op[0]);
      entry.op = { type_idx: ref.type_idx, type_name: ref.type_name, virtual: ref.virtual,
        fields: obj.op[1] };
    }
    return entry;
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

  return { head: head, recentBlocks: recentBlocks, block: block, tx: tx,
    assetsPage: assetsPage,
    asset: asset, feeds: feeds, resolveObject: resolveObject, search: search };
})();

if (typeof module !== "undefined") { module.exports = Explorer; }
