/* es-lab-ui-test.js — vectors for the es-lab desk pure helpers (kind,
 * safe hrefs, deep links). Stdlib only: `node tooling/es-lab-ui-test.js`
 * (exit 0 = green). No network, no DOM — DOM rendering stays browser-gated
 * (api-lab precedent); _test hooks carry the unit-testable surface.
 */
"use strict";
var assert = require("assert");
var passed = 0;
function eq(a, e, n) { assert.strictEqual(a, e, n + " (got " + JSON.stringify(a) + ")"); passed++; }
function ok(c, n) { assert.ok(c, n); passed++; }
global.HistoryCap = { esAllowed: function () { return true; },
  esAvailable: function () { return null; },
  ES_INDEXES: ["bitshares-*", "objects-balance"] };
global.Explorer = require("../vanilla/js/api/explorer.js");
global.Format = require("../vanilla/js/api/format.js");
global.EsLab = require("../vanilla/js/api/es-lab.js");
global.I18n = { t: function (k, d) { return d; } };
var EsLabUI = require("../vanilla/js/views/es-lab-ui.js");
eq(EsLabUI._test.kindOf("holders-by-asset"), "holders", "holders kind");
eq(EsLabUI._test.kindOf("top-ops-agg"), "agg", "agg kind");
eq(EsLabUI._test.kindOf("fills-by-market"), "ops", "fills kind");
eq(EsLabUI._test.kindOf("()raw"), "raw", "console kind");
eq(EsLabUI._test.kindOf("nope"), "raw", "unknown key fails soft");
eq(EsLabUI._test.hrefFor("account", "1.2.0"), "#/account/1.2.0", "account href");
eq(EsLabUI._test.hrefFor("block", "100916767"), "#/block/100916767", "block href");
eq(EsLabUI._test.hrefFor("account", "1.2.0<script>"), null, "href rejects id chars");
eq(EsLabUI._test.hrefFor("moon", "1.2.0"), null, "href rejects kinds");
ok(EsLabUI._test.deepLinkFor("holders-by-asset", ["1.3.0", "25"]).indexOf("#/es-lab?q=") === 0, "deep link shape");
console.log("es-lab-ui-test: " + passed + " passed");
