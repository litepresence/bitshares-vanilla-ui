/* pool-rebucket-count-test.js — the pool chart rebucket honors the live count.
 *
 * Regression pins (audit 2026-10-08): rebucket() merged ES buckets under a
 * hardcoded 2000 cap (truncating a 5000-wide request) and its count note
 * stated swaps only, never plotted buckets. Both now follow the shared
 * candle-count input. Source contracts (pool-detail-view.js cannot be
 * required in node — explorer-assets-filter-test.js precedent). No network,
 * no DOM, no deps. Run: node tooling/pool-rebucket-count-test.js */
"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");

var passed = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  passed++;
}

var SRC = fs.readFileSync(
  path.join(__dirname, "..", "vanilla", "js", "views", "pool-detail-view.js"), "utf8");

/* 1. The ES merge cap is the live window, never a literal. */
ok(SRC.indexOf("mergeDeep(chainBuckets, P.esBuckets, pnMerge)") !== -1,
  "rebucket merges ES under the live count variable");
ok(SRC.indexOf("mergeDeep(chainBuckets, P.esBuckets, 2000)") === -1,
  "no hardcoded 2000 merge cap remains in rebucket");

/* 2. The count note states plotted AND requested buckets (keyed). */
ok(SRC.indexOf('t("pool_detail.candle_count_partial"') !== -1,
  "shortfall note keyed pool_detail.candle_count_partial");
ok(SRC.indexOf('t("pool_detail.candle_count"') !== -1,
  "full-window note keyed pool_detail.candle_count");

/* 3. Trailing slice still honors the live input. */
ok(/buckets\.slice\(buckets\.length - pn\)/.test(SRC),
  "trailing slice uses the live count variable");

console.log("pool-rebucket-count: " + passed + " passed");
