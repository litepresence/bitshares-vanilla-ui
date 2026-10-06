"use strict";
/* asset-describe-test: regression for the feed-slice bitasset_data_id crash.
 * Asset.describe must work through the Explorer.asset join branch (the one
 * the app always takes), where no `found` local exists — only join.asset.
 * Stdlib only (stub globals, no network). Exit 0 = pass, 1 = fail. */
globalThis.Explorer = {
  asset: async function (symbolOrId) {
    return {
      asset: { id: "1.3.5650", symbol: "HONEST.BTC", precision: 8, issuer: "1.2.0", options: {}, bitasset_data_id: "2.4.1" },
      bitasset: { options: { short_backing_asset: "1.3.0", feed_lifetime_sec: 86400, minimum_feeds: 1 }, current_feed: null },
      dynamic: { current_supply: "0" },
      is_smartcoin: true
    };
  }
};
globalThis.Chain = { db: async function () { return 1; }, call: async function () { return []; } };
var Asset = require("/workspace/vanilla/js/api/asset.js");
var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}
(async function () {
  var r = await Asset.describe("HONEST.BTC");
  eq(r.bitasset_data_id, "2.4.1", "explorer branch exposes bitasset_data_id");
  eq(r.is_smartcoin, true, "smartcoin flagged");
  if (fail) { console.log(pass + " pass " + fail + " fail"); process.exit(1); }
  console.log("all pass");
})().catch(function (e) { console.log("FAIL threw: " + (e && e.message || e)); process.exit(1); });
