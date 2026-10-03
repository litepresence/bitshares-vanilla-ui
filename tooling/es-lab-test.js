/* es-lab-test.js — vectors for the es-lab catalog (build bodies + parse).
 * Stdlib only: `node tooling/es-lab-test.js` (exit 0 = green). No network,
 * no DOM. HistoryCap/Explorer/Format are stubbed except where required real.
 */
"use strict";
var assert = require("assert");
var passed = 0;
function eq(a, e, n) { assert.deepStrictEqual(a, e, n + " (got " + JSON.stringify(a) + ")"); passed++; }

global.HistoryCap = { esSearch: function () { return Promise.reject(new Error("no-net-in-unit")); },
  esAllowed: function () { return true; } };
global.Explorer = require("../vanilla/js/api/explorer.js");
global.Format = require("../vanilla/js/api/format.js");
global.Chain = { db: function () { return Promise.resolve(1); },
  call: function (id, m, p) {
    if (m === "get_objects") {
      return Promise.resolve((p[0] || []).map(function (x) {
        return (x === "1.3.0" || x === "1.3.121") ? { id: x, precision: (x === "1.3.0" ? 5 : 4) } : null;
      }));
    }
    return Promise.resolve(p[0] === "committee-account" ? { id: "1.2.0" } : null);
  } };
global.EsLab = require("../vanilla/js/api/es-lab.js");
var EsLab = global.EsLab;
var EsLabRun = require("../vanilla/js/api/es-lab-run.js");

eq(EsLab.TEMPLATES.length, 7, "seven templates total");
var t = EsLab.byKey("holders-by-asset");
eq(t.index, "objects-balance", "holders index");
var built = EsLab.build(t, ["1.3.0", "25"]);
eq(built.body.sort, [{ balance: { order: "desc" } }], "holders sort desc");
eq(built.body.query.bool.must[0].match.asset_type.query, "1.3.0", "holders asset match");
var rows = EsLab.parse(t, { hits: { hits: [
  { _source: { owner_: "1.2.0", balance: 74900, asset_type: "1.3.0" } },
  { _source: { owner_: "", balance: 1, asset_type: "1.3.0" } }] } });
eq(rows, [{ owner: "1.2.0", balance: "74900", asset: "1.3.0" }], "holders parse keeps asset, drops empty owner");
var agg = EsLab.parse(EsLab.byKey("top-ops-agg"),
  { aggregations: { by_op_type: { buckets: [{ key: 0, doc_count: 3 }, { key: 4, doc_count: 1 }] } } });
eq(agg[0], { type: 0, name: "transfer", count: 3, share: "75.0%" }, "agg row names via opName");
eq(agg[1].name, "fill_order", "agg virtual op named");
var threw = null;
try { EsLab.build(t, ["", "25"]); } catch (e) { threw = e.message; }
eq(threw, "missing: asset", "missing required throws named");
var ob = EsLab.build(EsLab.byKey("ops-by-account"), ["1.2.0", "", "10"]);
eq(ob.body.query.bool.must[0].term["account_history.account"], "1.2.0", "account exact term");
var br = EsLab.build(EsLab.byKey("block-range"), ["100916767", "100916768", "", "10"]);
eq(br.body.query.bool.filter[0].range["block_data.block_num"].gte, 100916767, "range gte bound");
eq(br.body.query.bool.filter[0].range["block_data.block_num"].lte, 100916768, "range lte bound");
var bal = EsLab.build(EsLab.byKey("balances-by-account"), ["1.2.0", "25"]);
eq(bal.index, "objects-balance", "balances index");
eq(bal.body.query.bool.must[0].match.owner_.query, "1.2.0", "owner_ match");
// fromBody round-trips (raw-mirror reverse direction):
function rt(key, vals) { return EsLab.fromBody(EsLab.byKey(key), EsLab.build(EsLab.byKey(key), vals).body); }
eq(rt("holders-by-asset", ["1.3.1849", "10"]), ["1.3.1849", "10"], "holders round-trip");
eq(rt("fills-by-market", ["1.3.0", "1.3.121"]), ["1.3.0", "1.3.121"], "fills round-trip (ids, not symbols)");
eq(rt("pool-swaps", ["1.19.66"]), ["1.19.66"], "swaps round-trip");
eq(rt("top-ops-agg", ["7"]), ["7"], "agg round-trip");
eq(rt("ops-by-account", ["1.2.0", "", "10"]), ["1.2.0", "", "10"], "account round-trip");
eq(rt("block-range", ["100", "200", ""]), ["100", "200", ""], "range round-trip");
eq(rt("balances-by-account", ["1.2.5", "25"]), ["1.2.5", "25"], "balances round-trip");
eq(EsLab.fromBody(EsLab.byKey("holders-by-asset"), {}), null, "foreign body -> null");
eq(EsLab.fromBody(null, {}), null, "null template -> null");
// runPaged honors caps with stubbed HistoryCap pages:
global.HistoryCap.esSearch = function (index, body, opts) {
  var page = (body.search_after ? 2 : 1);
  var hits = [];
  for (var i = 0; i < 500; i++) hits.push({ _source: { owner_: "1.2.0", balance: "1" }, sort: [i] });
  if (page === 2) hits = hits.slice(0, 3);
  return Promise.resolve({ hits: { hits: hits } });
};
EsLabRun.runPaged("balances-by-account", ["1.2.0", "25"], {}).then(function (res) {
  eq(res.rows.length <= 1000, true, "paged rows capped at 2 pages");
  eq(res.rows.length, 503, "short second page stops the walk");
  eq(typeof res.json, "object", "raw json travels with rows");
  return EsLabRun.resolveAccount("1.2.5");
}).then(function (id) {
  eq(id, "1.2.5", "id passes through");
  return EsLabRun.resolveAccount("committee-account");
}).then(function (id) {
  eq(id, "1.2.0", "name resolves via Chain");
  return EsLabRun.resolveAccount("no-such-name-xyz").then(function () { throw new Error("should-reject"); },
    function (e) { return e.message; });
}).then(function (msg) {
  eq(msg, "unknown account: no-such-name-xyz", "unknown name rejects named");
  var realDb = global.Chain.db;
  global.Chain.db = function () { return Promise.reject(new Error("not connected")); };
  return EsLabRun.resolveAccount("some-name").then(function () { throw new Error("should-reject"); },
    function (e) { global.Chain.db = realDb; return e.message; });
}).then(function (msg) {
  eq(msg, "not-connected", "socket failure surfaces, never mislabeled unknown");
  return EsLabRun.precMap("holders-by-asset", ["1.3.0"], []);
}).then(function (map) {
  eq(map, { "1.3.0": 5 }, "single-asset precision map");
  return EsLabRun.precMap("balances-by-account", ["1.2.0"],
    [{ owner: "1.2.0", balance: "1", asset: "1.3.0" },
     { owner: "1.2.0", balance: "2", asset: "9.9.9" },
     { owner: "1.2.0", balance: "3", asset: "1.3.121" }]);
}).then(function (map) {
  eq(map, { "1.3.0": 5, "1.3.121": 4 }, "one round trip, unknown assets skipped");
  return EsLabRun.precMap("top-ops-agg", ["7"], []);
}).then(function (map) {
  eq(map, {}, "non-holder kind skips lookup");
  console.log("es-lab-test: " + passed + " passed");
}, function (e) { console.error("PAGED-FAIL " + (e && e.message)); process.exit(1); });
