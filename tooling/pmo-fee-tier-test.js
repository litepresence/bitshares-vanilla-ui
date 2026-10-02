/* pmo-fee-tier-test.js — unit vectors for PMO parsing + asset-create fee tiers.
 * Stdlib only: `node tooling/pmo-fee-tier-test.js` (exit 0 = green).
 * Covers PredictionUI._test (parsePMO/isSubAssetOf) and AssetUI._test
 * (feeTierForSymbol/isSubAssetOf/pmoTemplate), plus one Format money vector
 * proving the tier-param display path stays integer-exact.
 * GROUND TRUTH (BTS-CM/pma source 2026-10-02, reference-only, never cloned):
 * pmo_object = {type:"PMO/ORGANIZATION@1.0", identity:{name,website,manifest},
 * governance:{resolution_policy,dispute_mechanism,onchain_account},
 * attestation}. FEE TRUTH: NO PMO discount exists — op-10 fees tier by FULL
 * symbol length (symbol3/symbol4/long_symbol params + price_per_kbyte data
 * fee, slice-10 live vectors). No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var PredictionUI = require("../vanilla/js/views/prediction-ui.js");
var AssetUI = require("../vanilla/js/views/asset-ui.js");
var Format = require("../vanilla/js/api/format.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function deep(actual, expected, name) {
  assert.deepStrictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
}

var P = PredictionUI._test, A = AssetUI._test;
eq(P.PMO_TYPE, "PMO/ORGANIZATION@1.0", "PMO type tag");

function fullOrg() {
  return { type: "PMO/ORGANIZATION@1.0",
    identity: { name: "House Seven", website: "https://house.example", manifest: "ipfs://abc" },
    governance: { resolution_policy: "majority", dispute_mechanism: "arb", onchain_account: "house-seven" },
    attestation: "sig:deadbeef" };
}

/* parsePMO VALID: pmo_object alongside PMA-style keys. */
deep(P.parsePMO(JSON.stringify({ main: "House Seven markets", pmo_object: fullOrg() })),
  fullOrg(), "valid nested pmo_object alongside main");

/* parsePMO VALID: bare org object (type at top level). */
deep(P.parsePMO(JSON.stringify(fullOrg())), fullOrg(), "valid bare org object");

/* parsePMO VALID: pmo_object stringified one level deeper (nested). */
deep(P.parsePMO(JSON.stringify({ main: "x", pmo_object: JSON.stringify(fullOrg()) })),
  fullOrg(), "valid doubly-nested pmo_object string");

/* parsePMO VALID: minimal org (empty optionals stand, attestation empty ok). */
deep(P.parsePMO(JSON.stringify({ type: "PMO/ORGANIZATION@1.0",
    identity: { name: "H" }, governance: {}, attestation: "" })),
  { type: "PMO/ORGANIZATION@1.0",
    identity: { name: "H", website: "", manifest: "" },
    governance: { resolution_policy: "", dispute_mechanism: "", onchain_account: "" },
    attestation: "" }, "valid minimal org, optionals default to empty");

/* parsePMO MISSING -> null (fail-soft, never throws). */
eq(P.parsePMO(""), null, "missing: empty string");
eq(P.parsePMO(null), null, "missing: null");
eq(P.parsePMO(undefined), null, "missing: undefined");
eq(P.parsePMO("just a plain description"), null, "missing: plain text");
eq(P.parsePMO(JSON.stringify({ main: "desc", condition: "x wins", expiry: "2030-01-01" })),
  null, "missing: PMA description has no pmo_object");

/* parsePMO INVALID -> null. */
eq(P.parsePMO("{not json"), null, "invalid: bad JSON");
eq(P.parsePMO("[1,2]"), null, "invalid: array");
eq(P.parsePMO("42"), null, "invalid: bare number parses non-object");
eq(P.parsePMO(JSON.stringify({ type: "PMO/WRONG@9.9", identity: { name: "H" }, governance: {}, attestation: "" })),
  null, "invalid: wrong type tag");
eq(P.parsePMO(JSON.stringify({ pmo_object: { type: "PMO/ORGANIZATION@1.0",
    identity: {}, governance: {}, attestation: "" } })),
  null, "invalid: identity without name");
eq(P.parsePMO(JSON.stringify({ pmo_object: { type: "PMO/ORGANIZATION@1.0",
    identity: { name: "   " }, governance: {}, attestation: "" } })),
  null, "invalid: blank name");
eq(P.parsePMO(JSON.stringify({ pmo_object: { type: "PMO/ORGANIZATION@1.0",
    identity: { name: "H" }, attestation: "" } })),
  null, "invalid: governance missing");
eq(P.parsePMO(JSON.stringify({ pmo_object: { type: "PMO/ORGANIZATION@1.0",
    identity: { name: "H" }, governance: {} } })),
  null, "invalid: attestation absent");
eq(P.parsePMO(JSON.stringify({ pmo_object: 42 })), null, "invalid: pmo_object non-object");
eq(P.parsePMO(JSON.stringify({ pmo_object: "{bad json" })), null, "invalid: nested string bad JSON");

/* feeTierForSymbol: boundaries 3/4/5+ (FULL length incl. dots — no discount). */
eq(A.feeTierForSymbol("ABC"), "symbol3", "tier len 3 -> symbol3");
eq(A.feeTierForSymbol("ABCD"), "symbol4", "tier len 4 -> symbol4");
eq(A.feeTierForSymbol("ABCDE"), "long_symbol", "tier len 5 -> long_symbol");
eq(A.feeTierForSymbol("ORG.MARKET1"), "long_symbol", "tier dotted sub-asset by full length");
eq(A.feeTierForSymbol("ORG.A"), "long_symbol", "tier short parent + dot + child still full length");
eq(A.feeTierForSymbol("AB"), null, "tier len 2 -> null (chain minimum 3)");
eq(A.feeTierForSymbol(""), null, "tier empty -> null");
eq(A.feeTierForSymbol("  abcd  "), "symbol4", "tier trims + uppercases");

/* isSubAssetOf (both homes agree — same contract, value-copied). */
[A, P].forEach(function (T, i) {
  var tag = (i === 0 ? "asset" : "prediction") + ": ";
  eq(T.isSubAssetOf("ORG.MKT", "ORG"), true, tag + "direct child");
  eq(T.isSubAssetOf("ORG.MKT.SUB", "ORG"), true, tag + "grandchild still under org");
  eq(T.isSubAssetOf("ORG.MKT", "ORG.MKT"), false, tag + "self is not its own child");
  eq(T.isSubAssetOf("ORGMKT", "ORG"), false, tag + "prefix without dot is false");
  eq(T.isSubAssetOf("ORG", "ORG"), false, tag + "bare org symbol is false");
  eq(T.isSubAssetOf("org.mkt", "org"), true, tag + "case-insensitive");
  eq(T.isSubAssetOf("ORG.", "ORG"), false, tag + "trailing dot is false");
  eq(T.isSubAssetOf("", "ORG"), false, tag + "empty child is false");
  eq(T.isSubAssetOf("ORG.MKT", ""), false, tag + "empty parent is false");
});

/* pmoTemplate: blank starter the issuer completes (empty name does NOT
 * parse — same rule as on-chain rows); with name+main filled it parses. */
(function template() {
  var tpl = A.pmoTemplate();
  ok(typeof tpl === "string" && tpl.length > 0, "template is a non-empty string");
  eq(P.parsePMO(tpl), null, "blank template is not yet an org (no name)");
  var filled = JSON.parse(tpl);
  filled.main = "House Seven markets";
  filled.pmo_object.identity.name = "House Seven";
  var back = P.parsePMO(JSON.stringify(filled));
  ok(back !== null, "completed template parses as a PMO");
  eq(back.type, "PMO/ORGANIZATION@1.0", "template type tag exact");
  eq(back.identity.name, "House Seven", "completed name survives");
})();

/* Money path: schedule tier params display via Format only (integer-exact). */
eq(Format.formatAmount("200000000", 5), "2000.00000", "symbol4-scale param integer-exact");
eq(Format.formatAmount("2000000000", 5), "20000.00000", "symbol3-scale param integer-exact");

console.log("pmo-fee-tier-test: " + passed + " passed");
