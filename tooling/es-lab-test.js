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
global.Chain = { db: function (m, p) {
  return Promise.resolve(p[0] === "committee-account" ? { id: "1.2.0" } : null);
} };
var EsLab = require("../vanilla/js/api/es-lab.js");

eq(EsLab.TEMPLATES.length, 7, "seven templates total");
var t = EsLab.byKey("holders-by-asset");
eq(t.index, "objects-balance", "holders index");
var built = EsLab.build(t, ["1.3.0", "25"]);
eq(built.body.sort, [{ balance: { order: "desc" } }], "holders sort desc");
eq(built.body.query.bool.must[0].match.asset_type.query, "1.3.0", "holders asset match");
var rows = EsLab.parse(t, { hits: { hits: [
  { _source: { owner_: "1.2.0", balance: 74900 } },
  { _source: { owner_: "", balance: 1 } }] } });
eq(rows, [{ owner: "1.2.0", balance: "74900" }], "holders parse drops empty owner, stringifies");
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
// runPaged honors caps with stubbed HistoryCap pages:
global.HistoryCap.esSearch = function (index, body, opts) {
  var page = (body.search_after ? 2 : 1);
  var hits = [];
  for (var i = 0; i < 500; i++) hits.push({ _source: { owner_: "1.2.0", balance: "1" }, sort: [i] });
  if (page === 2) hits = hits.slice(0, 3);
  return Promise.resolve({ hits: { hits: hits } });
};
EsLab.runPaged("balances-by-account", ["1.2.0", "25"], {}).then(function (rows) {
  eq(rows.length <= 1000, true, "paged rows capped at 2 pages");
  eq(rows.length, 503, "short second page stops the walk");
  return EsLab.resolveAccount("1.2.5");
}).then(function (id) {
  eq(id, "1.2.5", "id passes through");
  return EsLab.resolveAccount("committee-account");
}).then(function (id) {
  eq(id, "1.2.0", "name resolves via Chain");
  return EsLab.resolveAccount("no-such-name-xyz").then(function () { throw new Error("should-reject"); },
    function (e) { return e.message; });
}).then(function (msg) {
  eq(msg, "unknown account: no-such-name-xyz", "unknown name rejects named");
  console.log("es-lab-test: " + passed + " passed");
}, function (e) { console.error("PAGED-FAIL " + (e && e.message)); process.exit(1); });
