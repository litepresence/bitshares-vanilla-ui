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
var EsLab = require("../vanilla/js/api/es-lab.js");

eq(EsLab.TEMPLATES.length, 4, "four proven-shape templates");
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
console.log("es-lab-test: " + passed + " passed");
