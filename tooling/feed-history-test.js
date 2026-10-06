"use strict";
var FeedHistory = require("/workspace/vanilla/js/api/feed-history.js");
var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}
eq(typeof FeedHistory.medianOf, "function", "medianOf exists");
eq(FeedHistory.medianOf(["1.5", "1.7", "1.6"]), "1.6", "median of 3");
eq(FeedHistory.medianOf([]), null, "median empty -> null");
eq(FeedHistory.normToBackingPerMpa("2", true), "0.5", "flipped inverts");
eq(FeedHistory.badgeFor({ witnessHit: true }, { witnessFed: true }), "witness", "witness badge");
eq(FeedHistory.badgeFor({}, { witnessFed: false }), "producer", "default producer");
eq(FeedHistory.isFeedOp({ op: [19, { asset_id: "1.3.5" }] }, "1.3.5"), true, "op19 match");
eq(FeedHistory.isFeedOp({ op: [19, { asset_id: "1.3.5" }] }, "1.3.9"), false, "op19 asset mismatch");
eq(FeedHistory.isFeedOp({ op: [0, {}] }, "1.3.5"), false, "non-19 rejected");
eq(FeedHistory.fillToBackingPerMpa({ base: "2", quote: "1" }, false), "2", "fill straight");
eq(FeedHistory.fillToBackingPerMpa({ base: "2", quote: "1" }, true), "0.5", "fill flipped");
if (fail) { console.log(pass + " pass " + fail + " fail"); process.exit(1); }
console.log("all pass");
