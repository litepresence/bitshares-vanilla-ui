/* tx-hash-test.js — unit vectors for explorer bare-hash resolution
 * (api/explorer.js _isTxHash + _txHashQueries + _txHashBlock + recentTxById +
 * resolveTxHash). Stdlib only: `node tooling/tx-hash-test.js` (exit 0 = green).
 * No network (HistoryCap/Chain stubbed), no DOM, no deps.
 *
 * Provenance (verified, not assumed):
 * - Chain truth: get_recent_transaction_by_id(txid) returns
 *   optional<signed_transaction>, NO block coords (#4 database_api.hpp:200,
 *   "not known != not included"); transaction_id_type is ripemd160 = 40 hex
 *   (protocol/types.hpp:304 — 64-hex rejected here, unlike astro's looser
 *   /40|64/ gate in Explorer.ts:224).
 * - ES shape OBSERVED live 2026-10-02 (curl POST
 *   https://es.bitshares.dev/bitshares- star /_search — see comment on HIT):
 *   block context lives at _source.block_data.{block_num,block_time,trx_id}
 *   with the tx index at _source.operation_history.trx_in_block. The design's
 *   bare `trx_id[.keyword]` term/match shapes return ZERO hits on this
 *   mapping, so block_data.* leads the cascade; the astro-UI trio
 *   (Explorer.ts:231-235) rides last as forward-compat.
 * - Seam precedent: HistoryCap/Chain stubbed on globalThis per
 *   account-ops-test.js (explorer.js touches both globals at CALL time only,
 *   so require needs no globals).
 */
"use strict";
var assert = require("assert");
var Explorer = require("../vanilla/js/api/explorer.js");
assert.ok(Explorer && typeof Explorer.resolveTxHash === "function", "resolveTxHash exported");

var passed = 0;
function eq(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}

/* Real recent mainnet hash (public chain data, no user data): trx
 * 393704b7d1e84fa54f5e983c5e980f22edb31dd4 in block 114884983. */
var H = "393704b7d1e84fa54f5e983c5e980f22edb31dd4";

/* 1-12: _isTxHash vectors (strict 40-hex, no trim/fold — callers normalize). */
eq(Explorer._isTxHash(H), true, "isTxHash accepts 40-hex lower");
eq(Explorer._isTxHash(H.toUpperCase()), true, "isTxHash accepts 40-hex upper");
eq(Explorer._isTxHash("393704B7d1E84Fa54f5E983C5e980F22eDb31dD4"), true, "isTxHash accepts mixed case");
eq(Explorer._isTxHash(H.slice(0, 39)), false, "isTxHash rejects 39 chars");
eq(Explorer._isTxHash(H + "0"), false, "isTxHash rejects 41 chars");
eq(Explorer._isTxHash(H + H.slice(0, 24)), false, "isTxHash rejects 64-hex (not ripemd160)");
eq(Explorer._isTxHash("g" + H.slice(1)), false, "isTxHash rejects non-hex");
eq(Explorer._isTxHash(""), false, "isTxHash rejects empty");
eq(Explorer._isTxHash(" " + H), false, "isTxHash rejects padded (caller trims)");
eq(Explorer._isTxHash("0x" + H.slice(2)), false, "isTxHash rejects 0x prefix");
eq(Explorer._isTxHash(null), false, "isTxHash rejects null");
eq(Explorer._isTxHash(12345), false, "isTxHash rejects non-string");

/* 13-20: _txHashQueries exact DSL including fallback order. */
var bodies = Explorer._txHashQueries(H);
eq(bodies.length, 6, "queries cascade has 6 bodies");
eq(bodies.map(function (q) { return q.index; }),
  ["bitshares-*", "bitshares-*", "bitshares-*", "bitshares-*", "bitshares-*", "bitshares-*"],
  "queries all target the allowlisted ops index");
eq(bodies[0].body, { query: { term: { "block_data.trx_id.keyword": H } }, size: 5 },
  "queries[0] observed keyword term leads");
eq(bodies[1].body, { query: { term: { "block_data.trx_id": H } }, size: 5 },
  "queries[1] observed term fallback");
eq(bodies[2].body, { query: { match: { "block_data.trx_id": H } }, size: 5 },
  "queries[2] observed match fallback");
eq(bodies[3].body, { query: { term: { "trx_id.keyword": H } }, size: 5 },
  "queries[3] astro legacy keyword term");
eq(bodies[4].body, { query: { term: { trx_id: H } }, size: 5 },
  "queries[4] astro legacy term");
eq(bodies[5].body, { query: { match: { trx_id: H } }, size: 5 },
  "queries[5] astro legacy match trails");

/* OBSERVED 2026-10-02: POST https://es.bitshares.dev/bitshares- star/_search
 * {"size":1,"sort":[{"block_data.block_num":{"order":"desc"}}]} ->
 * hits[0] = {_index:"bitshares-2026-10",_id:"2.9.1425124148",_source:{...}}
 * with block_data:{block_num:114884983,block_time:"2026-10-02T23:04:51",
 * trx_id:"393704b7...dd4"} and operation_history:{trx_in_block:0,...}.
 * Same-hash probes: bare trx_id[.keyword] term/match -> 0 hits;
 * block_data.trx_id[.keyword] term/match -> 5 hits (one per op in the tx).
 * Fixture below keeps the observed nesting/names with operational values
 * intact (public chain data, no user data). */
var HIT = {
  _index: "bitshares-2026-10",
  _id: "2.9.1425124148",
  _source: {
    account_history: { id: "2.9.1425124148", account: "1.2.1853369",
      operation_id: "1.11.1398481156", sequence: 1020095 },
    operation_history: { trx_in_block: 0, op_in_trx: 0, virtual_op: 0,
      is_virtual: false, fee_payer: "1.2.1853369" },
    operation_type: 2,
    operation_id_num: 1398481156,
    block_data: { block_num: 114884983, block_time: "2026-10-02T23:04:51", trx_id: H }
  }
};

/* 21-30: _txHashBlock extractor on the observed shape + guards. */
eq(Explorer._txHashBlock(HIT), { block: 114884983, index: 0 }, "extractor reads observed block_data + trx_in_block");
eq(Explorer._txHashBlock(HIT._source), { block: 114884983, index: 0 }, "extractor accepts bare _source");
eq(Explorer._txHashBlock({ _source: { block_num: 7, trx_in_block: 3 } }),
  { block: 7, index: 3 }, "extractor accepts top-level block_num fallback");
eq(Explorer._txHashBlock({ _source: { block_number: 8, trx_in_block: 1 } }),
  { block: 8, index: 1 }, "extractor accepts block_number alias");
eq(Explorer._txHashBlock({ _source: { block_data: {}, operation_history: {} } }),
  null, "extractor null without coords (never guessed)");
eq(Explorer._txHashBlock({ _source: { block_data: { block_num: 0 },
  operation_history: { trx_in_block: 0 } } }), null, "extractor rejects block 0");
eq(Explorer._txHashBlock({ _source: { block_data: { block_num: "114884983" },
  operation_history: { trx_in_block: 0 } } }), null, "extractor rejects string block (strict)");
eq(Explorer._txHashBlock({ _source: { block_data: { block_num: 5 },
  operation_history: {} } }), null, "extractor null without tx index");
eq(Explorer._txHashBlock(null), null, "extractor null on null hit");
eq(Explorer._txHashBlock({}), null, "extractor null on empty hit");

/* WS signed_transaction fixture (database_api.hpp:200 shape: operations +
 * signatures, no block coords). */
var WS_TX = {
  operations: [[0, { from: "1.2.1", to: "1.2.2",
    amount: { amount: "100", asset_id: "1.3.0" } }]],
  signatures: ["1f2b3c"]
};

function stubChain(txOrThrow) {
  var seen = [];
  globalThis.Chain = {
    db: function () { return Promise.resolve(11); },
    call: function (api, method, params) {
      seen.push([api, method, params]);
      if (txOrThrow instanceof Error) return Promise.reject(txOrThrow);
      return Promise.resolve(txOrThrow);
    }
  };
  return seen;
}

(async () => {
  /* 31-35: ES hit with context resolves block + stops the cascade. */
  var esCalls = [];
  globalThis.HistoryCap = {
    esSearch: function (index, body) {
      esCalls.push([index, body]);
      return Promise.resolve({ hits: { hits: [HIT] } });
    }
  };
  var chainSeen = stubChain(new Error("must not reach WS"));
  var r = await Explorer.resolveTxHash(H);
  eq(r.status, "block", "ES hit with context resolves block status");
  eq([r.block, r.index], [114884983, 0], "ES hit yields observed block coords");
  eq(r.hash, H, "resolved hash echoed");
  eq(esCalls.length, 1, "cascade stops at first hit WITH context");
  eq(esCalls[0][1], bodies[0].body, "first fire is the observed keyword body");
  eq(chainSeen.length, 0, "WS untouched when ES resolves");

  /* 36-41: context-free ES hits exhaust the cascade, then WS maps. */
  esCalls = [];
  globalThis.HistoryCap = {
    esSearch: function (index, body) {
      esCalls.push(body);
      return Promise.resolve({ hits: { hits: [{ _source: { junk: 1 } }] } });
    }
  };
  chainSeen = stubChain(WS_TX);
  r = await Explorer.resolveTxHash(H.toUpperCase());
  eq(r.status, "tx", "context-free ES falls through to WS tx");
  eq(r.hash, H, "hash normalized to lowercase");
  eq(esCalls.length, 6, "all 6 cascade bodies fire before WS");
  eq(chainSeen, [[11, "get_recent_transaction_by_id", [H]]], "WS fallback exact method + params");
  eq(r.tx.ops[0].type_name, "transfer", "WS tx normalized to op rows");
  eq(r.tx.signatures, ["1f2b3c"], "WS signatures sliced through");

  /* 42-43: missing seam goes straight to WS. */
  delete globalThis.HistoryCap;
  chainSeen = stubChain(WS_TX);
  r = await Explorer.resolveTxHash(H);
  eq(r.status, "tx", "missing HistoryCap still resolves via WS");
  eq(chainSeen.length, 1, "WS called once with no seam");

  /* 44: es-disabled still falls back to WS (pref off skips ES, not lookup). */
  globalThis.HistoryCap = {
    esSearch: function () { return Promise.reject(new Error("es-disabled")); }
  };
  chainSeen = stubChain(WS_TX);
  r = await Explorer.resolveTxHash(H);
  eq(r.status, "tx", "es-disabled drops to WS fallback");

  /* 45: es-unavailable + WS null -> not-found (never throws). */
  globalThis.HistoryCap = {
    esSearch: function () { return Promise.reject(new Error("es-unavailable")); }
  };
  stubChain(null);
  r = await Explorer.resolveTxHash(H);
  eq(r.status, "not-found", "unknown hash resolves not-found");

  /* 46: cold socket -> offline (not-connected passes through). */
  delete globalThis.HistoryCap;
  stubChain(new Error("not-connected"));
  globalThis.Chain.db = function () { return Promise.reject(new Error("not-connected")); };
  r = await Explorer.resolveTxHash(H);
  eq(r.status, "offline", "cold socket resolves offline");

  /* 47-49: invalid inputs resolve invalid with zero chain traffic. */
  var traffic = 0;
  globalThis.HistoryCap = { esSearch: function () { traffic++; return Promise.resolve({}); } };
  stubChain(WS_TX);
  globalThis.Chain.call = function () { traffic++; return Promise.resolve(WS_TX); };
  eq((await Explorer.resolveTxHash("xyz")).status, "invalid", "junk resolves invalid");
  eq((await Explorer.resolveTxHash("")).status, "invalid", "empty resolves invalid");
  eq((await Explorer.resolveTxHash(H + "00")).status, "invalid", "42 chars resolves invalid");
  eq(traffic, 0, "invalid input fires no ES and no WS");

  /* 50: both seams missing -> offline (no Chain reads as a cold socket via
   * _dbCallInner's fail-closed not-connected mapping), still no throw. */
  delete globalThis.HistoryCap;
  delete globalThis.Chain;
  r = await Explorer.resolveTxHash(H);
  eq(r.status, "offline", "seamless resolve lands offline, never rejects");

  /* 51-53: recentTxById mapping direct. */
  globalThis.Chain = {
    db: function () { return Promise.resolve(11); },
    call: function () { return Promise.resolve(WS_TX); }
  };
  var t = await Explorer.recentTxById(H);
  eq([t.block, t.index], [null, null], "recentTxById carries no coords (location-less)");
  eq(t.ops[0].fields.amount.amount, "100", "recentTxById keeps raw op fields");
  globalThis.Chain.call = function () { return Promise.resolve(null); };
  try {
    await Explorer.recentTxById(H);
    assert.fail("null WS tx must reject");
  } catch (e) {
    eq(e.message, "tx-expired-or-unknown", "null WS tx maps to tx-expired-or-unknown");
  }
  delete globalThis.Chain;

  console.log("tx-hash-test: " + passed + " passed, 0 failed");
})().catch(function (e) {
  console.log("FAIL tx-hash-test: " + (e && e.stack || e));
  process.exit(1);
});
