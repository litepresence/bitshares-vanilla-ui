/* ApiLab: curated WebSocket API catalog for the #/api-lab node prober.
 * Owns: the method catalog (group/login/method/params/tier per entry),
 *   param coercion (curated strings -> typed RPC params), and run() — the
 *   single call path the desk uses. No DOM, no signing, no key material.
 * Consumes: Chain.call (sole socket owner — generic login(entry.login) then
 *   the method, so database/history/network_node/network_broadcast/custom
 *   all flow through the shared socket; no second connection ever).
 * Globals/side effects: exposes global ApiLab only.
 * Created by: api-lab design 2026-10-03 (Option B), AFK build.
 *
 * CHAIN TRUTH (#4 wins; verified 2026-10-03 against the sparse checkout):
 * - database_api.hpp: get_objects:92, get_chain_id:224, get_config:219,
 *   get_dynamic_global_properties:229, get_block:182, get_transaction:190,
 *   get_recent_transaction_by_id:200, get_accounts:287, get_account_by_name:326,
 *   lookup_account_names:342, lookup_accounts:357, get_account_balances:371,
 *   get_account_count:402, get_assets:425, lookup_asset_symbols:444,
 *   get_asset_count:450, get_limit_orders:475, get_order_book:636,
 *   get_ticker:618, get_top_markets:646, get_witnesses:1129,
 *   get_committee_members:1164, get_required_fees:1313.
 * - api.hpp: history_api get_account_history:89,
 *   get_relative_account_history:167 (login "history");
 *   network_broadcast_api broadcast_transaction:352 (login
 *   "network_broadcast"); network_node_api get_info:401,
 *   get_connected_peers:412 (login "network_node").
 * - No debug_api class exists in api.hpp (classes: history/block/
 *   network_broadcast/network_node/crypto/asset/orders/custom_operations) —
 *   so the debug tier probes login "debug" and surfaces the node's real
 *   rejection instead of inventing methods. #1 Console.jsx:7-22 eval box is
 *   the anti-pattern: never eval, never expose wallet/debug handles.
 * MONEY DISCIPLINE (#6): params/results stay raw here; the VIEW adds human
 *   hints via Format — this file formats nothing.
 */
var ApiLab = (function () {
  "use strict";

  /* Param types: string (free text), uint (non-negative integer string),
   * bool, json (any JSON value, parsed verbatim), strlist (JSON array of
   * strings — one input box holding e.g. ["1.2.0"]). One box per param keeps
   * the desk dependency-free; strlist/json accept pasted arrays. */
  var GROUPS = ["Database", "History", "Network", "Debug"];

  /* Tier labels for the desk gate. read/fee run free; broadcast needs unlock
   * + per-call confirm (Transfer precedent); debug runs free but is expected
   * to fail on public nodes — the failure is the honest result. */
  var TIERS = { read: "read", fee: "fee", broadcast: "broadcast", debug: "debug" };

  /* P: one param descriptor. Params: name, type, o (optional extras:
   * required, example, hint, max). Returns the descriptor. Fails: never. */
  function P(name, type, o) {
    var e = o || {};
    return { name: name, type: type, required: e.required !== false,
      example: e.example || "", hint: e.hint || "", max: e.max || null };
  }

  /* METHODS: the curated catalog. login is the exact login-API name sent on
   * the shared socket (Chain.call(1, login, [])). Broadcast entries never
   * auto-run from a deep link (the desk enforces prefill+lock). */
  var METHODS = [
    { group: "Database", login: "database", method: "get_chain_id",
      tier: TIERS.read, src: "database_api.hpp:224",
      desc: "Chain ID of the connected node (matches wallet config).",
      params: [] },
    { group: "Database", login: "database", method: "get_dynamic_global_properties",
      tier: TIERS.read, src: "database_api.hpp:229",
      desc: "Head block, time, participation — the chain pulse.",
      params: [] },
    { group: "Database", login: "database", method: "get_config",
      tier: TIERS.read, src: "database_api.hpp:219",
      desc: "Chain constants (fees scale, percent bases).",
      params: [] },
    { group: "Database", login: "database", method: "get_block",
      tier: TIERS.read, src: "database_api.hpp:182",
      desc: "One signed block by height.",
      params: [P("block_num", "uint", { example: "100916767",
        hint: "Positive block height." })] },
    { group: "Database", login: "database", method: "get_transaction",
      tier: TIERS.read, src: "database_api.hpp:190",
      desc: "One processed transaction by block + index in block.",
      params: [P("block_num", "uint", { example: "100916767" }),
        P("trx_in_block", "uint", { example: "0" })] },
    { group: "Database", login: "database", method: "get_recent_transaction_by_id",
      tier: TIERS.read, src: "database_api.hpp:200",
      desc: "Recent transaction by ID (40-hex ripemd160, NOT 64).",
      params: [P("txid", "string", { example: "9b3ed9b6d2656687ec49f8ff4ce023f9c5436e58",
        hint: "40 hex chars." })] },
    { group: "Database", login: "database", method: "get_objects",
      tier: TIERS.read, src: "database_api.hpp:92",
      desc: "Any objects by 1.x.y / 2.x.y IDs.",
      params: [P("ids", "strlist", { example: '["1.2.0","1.3.0"]',
        hint: "JSON array of object IDs." })] },
    { group: "Database", login: "database", method: "get_account_by_name",
      tier: TIERS.read, src: "database_api.hpp:326",
      desc: "Account lookup — the canonical name search (not get_account).",
      params: [P("name", "string", { example: "committee-account" })] },
    { group: "Database", login: "database", method: "get_accounts",
      tier: TIERS.read, src: "database_api.hpp:287",
      desc: "Batch account fetch by name-or-ID list.",
      params: [P("names_or_ids", "strlist", { example: '["committee-account","1.2.5"]' })] },
    { group: "Database", login: "database", method: "lookup_account_names",
      tier: TIERS.read, src: "database_api.hpp:342",
      desc: "Exact-name batch lookup (semantics identical to get_objects).",
      params: [P("names", "strlist", { example: '["committee-account"]' })] },
    { group: "Database", login: "database", method: "lookup_accounts",
      tier: TIERS.read, src: "database_api.hpp:357",
      desc: "Prefix search for account names.",
      params: [P("lower_bound_name", "string", { example: "committee" }),
        P("limit", "uint", { example: "10", max: 1000 })] },
    { group: "Database", login: "database", method: "get_account_balances",
      tier: TIERS.read, src: "database_api.hpp:371",
      desc: "Raw balances for an account (raw integers — see hint line).",
      params: [P("account", "string", { example: "committee-account" }),
        P("assets", "strlist", { example: '["1.3.0"]' })] },
    { group: "Database", login: "database", method: "get_account_count",
      tier: TIERS.read, src: "database_api.hpp:402",
      desc: "Total registered accounts (plain int, never money).",
      params: [] },
    { group: "Database", login: "database", method: "get_assets",
      tier: TIERS.read, src: "database_api.hpp:425",
      desc: "Batch asset fetch by symbol-or-ID list.",
      params: [P("symbols_or_ids", "strlist", { example: '["BTS","1.3.0"]' })] },
    { group: "Database", login: "database", method: "lookup_asset_symbols",
      tier: TIERS.read, src: "database_api.hpp:444",
      desc: "Exact-symbol batch lookup.",
      params: [P("symbols_or_ids", "strlist", { example: '["BTS"]' })] },
    { group: "Database", login: "database", method: "get_asset_count",
      tier: TIERS.read, src: "database_api.hpp:450",
      desc: "Total assets (plain int).",
      params: [] },
    { group: "Database", login: "database", method: "get_limit_orders",
      tier: TIERS.read, src: "database_api.hpp:475",
      desc: "Order book slice for asset pair A/B.",
      params: [P("a", "string", { example: "1.3.0" }),
        P("b", "string", { example: "1.3.121" }),
        P("limit", "uint", { example: "10", max: 100 })] },
    { group: "Database", login: "database", method: "get_order_book",
      tier: TIERS.read, src: "database_api.hpp:636",
      desc: "Aggregated bids/asks for base/quote symbols.",
      params: [P("base", "string", { example: "BTS" }),
        P("quote", "string", { example: "USD" }),
        P("limit", "uint", { example: "10", max: 100 })] },
    { group: "Database", login: "database", method: "get_ticker",
      tier: TIERS.read, src: "database_api.hpp:618",
      desc: "24h ticker for base/quote symbols.",
      params: [P("base", "string", { example: "BTS" }),
        P("quote", "string", { example: "USD" })] },
    { group: "Database", login: "database", method: "get_top_markets",
      tier: TIERS.read, src: "database_api.hpp:646",
      desc: "Top markets by volume (bounded limit).",
      params: [P("limit", "uint", { example: "10", max: 100 })] },
    { group: "Database", login: "database", method: "get_witnesses",
      tier: TIERS.read, src: "database_api.hpp:1129",
      desc: "Witness objects by ID list.",
      params: [P("ids", "strlist", { example: '["1.6.1"]' })] },
    { group: "Database", login: "database", method: "get_committee_members",
      tier: TIERS.read, src: "database_api.hpp:1164",
      desc: "Committee members by ID list.",
      params: [P("ids", "strlist", { example: '["1.5.0"]' })] },
    { group: "Database", login: "database", method: "get_required_fees",
      tier: TIERS.fee, src: "database_api.hpp:1313",
      desc: "Fee preview for operations (the ONLY fee source — #3720). Paste operations JSON.",
      params: [P("ops", "json", { example: "[[0,{\"from\":\"1.2.0\",\"to\":\"1.2.5\",\"amount\":{\"amount\":\"100000\",\"asset_id\":\"1.3.0\"}}]]",
        hint: "JSON array of [op_id, op_data] pairs." }),
        P("asset_id", "string", { example: "1.3.0" })] },
    { group: "History", login: "history", method: "get_account_history",
      tier: TIERS.read, src: "api.hpp:89",
      desc: "Account history page (most-recent-first).",
      params: [P("account", "string", { example: "1.2.0" }),
        P("stop", "string", { example: "1.11.0",
          hint: "Stop object ID (1.11.0 = genesis)." }),
        P("limit", "uint", { example: "10", max: 100 }),
        P("start", "string", { example: "1.11.0",
          hint: "Start object ID (1.11.0 = latest)." })] },
    { group: "History", login: "history", method: "get_relative_account_history",
      tier: TIERS.read, src: "api.hpp:167",
      desc: "Account history by sequence offset.",
      params: [P("account", "string", { example: "1.2.0" }),
        P("stop", "uint", { example: "0" }),
        P("limit", "uint", { example: "10", max: 100 }),
        P("start", "uint", { example: "0", hint: "0 = most recent." })] },
    { group: "Network", login: "network_node", method: "get_info",
      tier: TIERS.read, src: "api.hpp:401",
      desc: "P2P network info (often restricted on public nodes).",
      params: [] },
    { group: "Network", login: "network_node", method: "get_connected_peers",
      tier: TIERS.read, src: "api.hpp:412",
      desc: "Peer list (often restricted on public nodes).",
      params: [] },
    { group: "Network", login: "network_broadcast", method: "broadcast_transaction",
      tier: TIERS.broadcast, src: "api.hpp:352",
      desc: "Broadcast a SIGNED transaction. Paste full signed-tx JSON; needs unlock + confirm.",
      params: [P("trx", "json", { example: "{\"ref_block_num\":1,\"ref_block_prefix\":1,\"expiration\":\"2026-01-01T00:00:00\",\"signatures\":[],\"operations\":[]}",
        hint: "Full signed transaction object." })] },
    { group: "Debug", login: "debug", method: "(login probe)",
      tier: TIERS.debug, src: "api.hpp (no debug_api class — probe only)",
      desc: "Availability probe: attempts the debug login most public nodes reject. The rejection IS the result.",
      params: [] }
  ];

  /* byMethod: find one entry by method name + login. Params: method, login.
   * Returns the entry or null. Fails: never throws. */
  function byMethod(method, login) {
    for (var i = 0; i < METHODS.length; i++) {
      if (METHODS[i].method === method && METHODS[i].login === login) return METHODS[i];
    }
    for (var j = 0; j < METHODS.length; j++) {
      if (METHODS[j].method === method) return METHODS[j];
    }
    return null;
  }

  /* defaults: example values per param (deep-link/prefill helper).
   * Params: entry. Returns a string array aligned with entry.params. */
  function defaults(entry) {
    return (entry.params || []).map(function (p) { return p.example || ""; });
  }

  /* coerce: curated strings -> typed RPC params. Params: entry, values
   * (string array aligned with entry.params). Returns the typed array.
   * Fails: throws a named Error (uint/bool/json/strlist shape problems). */
  function coerce(entry, values) {
    var out = [];
    var ps = entry.params || [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var v = (values && i < values.length && typeof values[i] === "string") ? values[i] : "";
      if ((!v || !v.length) && p.required) throw new Error("missing: " + p.name);
      if (!v || !v.length) {
        out.push(p.type === "strlist" ? [] : p.type === "json" ? null : p.type === "uint" ? 0 : p.type === "bool" ? false : "");
        continue;
      }
      if (p.type === "uint") {
        if (!/^[0-9]+$/.test(v)) throw new Error("bad uint: " + p.name);
        var n = parseInt(v, 10);
        if (p.max !== null && n > p.max) throw new Error("over max " + p.max + ": " + p.name);
        out.push(n);
      } else if (p.type === "bool") {
        if (v !== "true" && v !== "false") throw new Error("bad bool: " + p.name);
        out.push(v === "true");
      } else if (p.type === "json" || p.type === "strlist") {
        var parsed;
        try { parsed = JSON.parse(v); } catch (e) { throw new Error("bad JSON: " + p.name); }
        if (p.type === "strlist") {
          if (!Array.isArray(parsed)) throw new Error("need array: " + p.name);
        }
        out.push(parsed);
      } else {
        out.push(v);
      }
    }
    return out;
  }

  /* run: execute one catalog entry on the shared socket. Params: entry,
   * values (curated string array). Returns a Promise for the raw result.
   * Fails: rejects with the node's error (or not-connected/timeout). The
   * debug probe resolves its login attempt — rejection surfaces verbatim. */
  function run(entry, values) {
    var params = coerce(entry, values);
    if (entry.login === "debug" && entry.method === "(login probe)") {
      return Chain.call(1, "debug", []);
    }
    return Chain.call(1, entry.login, []).then(function (apiId) {
      return Chain.call(apiId, entry.method, params);
    });
  }

  return { GROUPS: GROUPS, TIERS: TIERS, METHODS: METHODS,
    byMethod: byMethod, defaults: defaults, coerce: coerce, run: run };
})();
