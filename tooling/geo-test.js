#!/usr/bin/env node
/* geo-test.js — unit vectors for the display-only geolocation module
 * (vanilla/js/api/geo.js). Stdlib only: `node tooling/geo-test.js`
 * (exit 0 = green). Covers extractHost, labelOf, providerOf shaping plus
 * lookup/details/provider against a stub fetch (no network), the
 * session-negative cache, and the localStorage success cache.
 * No network, no DOM, no deps.
 */
"use strict";
var assert = require("assert");
var Geo = require("../vanilla/js/api/geo.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function ok(v, name) {
  assert.ok(v, name);
  passed++;
}

var T = Geo._test;

/* extractHost — wss:// URL -> bare hostname. */
eq(T.extractHost("wss://api.bitshares.dev/ws"), "api.bitshares.dev", "host with path");
eq(T.extractHost("wss://node:8080"), "node", "host with port, no path");
eq(T.extractHost("ws://127.0.0.1:8090/x"), "127.0.0.1", "ws + ipv4 + port");
eq(T.extractHost("https://x.io"), "", "non-ws scheme rejected");
eq(T.extractHost(""), "", "empty -> empty");
eq(T.extractHost(null), "", "null -> empty, never throws");

/* labelOf — "City, Region" shaping, unknown never guessed. */
eq(T.labelOf({ success: true, location: { city: "Frankfurt", state: "Hesse" } }), "Frankfurt, Hesse", "city + state");
eq(T.labelOf({ success: true, location: { city: "Paris", state: "" } }), "Paris", "city only");
eq(T.labelOf({ success: true, location: { city: "", state: "Texas" } }), "Texas", "state only");
eq(T.labelOf({ success: true, location: { city: "", state: "" } }), null, "both empty -> null");
eq(T.labelOf({ success: true }), null, "missing location -> null");
eq(T.labelOf({ success: false, message: "private range" }), null, "fail status -> null");
eq(T.labelOf(null), null, "null -> null");
eq(T.labelOf("x"), null, "garbage -> null, never throws");

/* providerOf — ASN org preferred over registry company, first token kept. */
eq(T.providerOf({ success: true, asn: { org: "Amazon.com, Inc." }, company: { name: "Amazon" } }), "Amazon", "glued suffix trims to Amazon");
eq(T.providerOf({ success: true, asn: { org: "GitHub, Inc." }, company: {} }), "GitHub", "comma trims to GitHub");
eq(T.providerOf({ success: true, asn: { org: "Hetzner Online GmbH" }, company: {} }), "Hetzner", "space splits to Hetzner");
eq(T.providerOf({ success: true, asn: {}, company: { name: "Cloudflare" } }), "Cloudflare", "single token stands");
eq(T.providerOf({ success: true, asn: {}, company: {} }), null, "both empty -> null");
eq(T.providerOf({ success: false }), null, "fail -> null");
eq(T.providerOf(null), null, "null -> null, never throws");

/* Stub fetch harness (in-memory localStorage, no location global -> the
 * https-skip never triggers under node). */
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
var calls = [];
function stubFetch(url) {
  calls.push(url);
  var rec = { success: true, location: { city: "Ashburn", state: "Virginia" },
    asn: { org: "Amazon.com, Inc." }, company: { name: "Amazon" }, query: "1.2.3.4" };
  if (url.indexOf("privada.") !== -1) rec = { success: false, message: "private range" };
  if (url.indexOf("down.") !== -1) return Promise.reject(new Error("net down"));
  return Promise.resolve({ json: function () { return Promise.resolve(rec); } });
}

(async function main() {
  var fails = [];

  // lookup resolves the label through the stub.
  var l = await Geo.lookup("wss://node.geo.test/ws", stubFetch);
  if (l !== "Ashburn, Virginia") fails.push("lookup label (got " + JSON.stringify(l) + ")");
  else console.log("PASS lookup resolves City, Region (" + l + ")");

  // provider rides the same cached record: no second fetch.
  var n0 = calls.length;
  var p = await Geo.provider("wss://node.geo.test/ws", stubFetch);
  if (p !== "Amazon") fails.push("provider org (got " + JSON.stringify(p) + ")");
  else console.log("PASS provider resolves org");
  if (calls.length !== n0) fails.push("provider refetched (want cache hit)");
  else console.log("PASS provider shares the cached record (zero extra fetch)");

  // details() bundles both in one call.
  var d = await Geo.details("wss://other.geo.test/ws", stubFetch);
  if (!d || d.label !== "Ashburn, Virginia" || d.provider !== "Amazon") {
    fails.push("details bundle (got " + JSON.stringify(d) + ")");
  } else console.log("PASS details bundles label + provider");

  // Cache shape: normalized labels persisted, reused without fetch.
  var cached = null;
  try { cached = JSON.parse(store[Geo._test.cacheKey]); } catch (e) { cached = null; }
  if (!cached || !cached["other.geo.test"] || cached["other.geo.test"].provider !== "Amazon") {
    fails.push("cache persists normalized labels");
  } else console.log("PASS cache persists the normalized labels");
  var n1 = calls.length;
  await Geo.lookup("wss://other.geo.test/ws", function () { throw new Error("must not fetch"); });
  if (calls.length !== n1) fails.push("cache hit still fetched");
  else console.log("PASS cache hit performs zero fetches");

  // Failures resolve null and go session-negative (one attempt only).
  var f1 = await Geo.lookup("wss://down.geo.test/ws", stubFetch);
  var n2 = calls.length;
  var f2 = await Geo.lookup("wss://down.geo.test/ws", stubFetch);
  if (f1 !== null || f2 !== null) fails.push("failures must resolve null");
  else console.log("PASS failures resolve null");
  if (calls.length !== n2) fails.push("session-negative retry fetched again");
  else console.log("PASS session failures are not retried");

  // ipaddress.to "fail" status (private range) resolves null, honestly.
  var pv = await Geo.lookup("wss://privada.geo.test/ws", stubFetch);
  if (pv !== null) fails.push("private-range must be null (got " + JSON.stringify(pv) + ")");
  else console.log("PASS service fail status resolves null");

  // Bad URL never throws, never fetches.
  var n3 = calls.length;
  var b = await Geo.lookup("not-a-url", stubFetch);
  if (b !== null || calls.length !== n3) fails.push("bad url must be null without fetch");
  else console.log("PASS bad url resolves null without fetching");

  delete global.localStorage;
  if (fails.length) {
    fails.forEach(function (f) { console.log("FAIL " + f); });
    process.exit(1);
  }
  console.log("geo-test: " + passed + " sync passed + async green, 0 failed");
})().catch(function (e) { console.log("FAIL harness: " + (e && e.message)); process.exit(1); });
