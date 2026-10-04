#!/usr/bin/env node
/* case-normalize-test.js — chain case rules at the central lookups:
 * Account.resolve lowercases names, Asset.describe uppercases symbols
 * (ids pass through). Stdlib only: `node tooling/case-normalize-test.js`
 * (exit 0 = green). Chain is stubbed and captures params. No network. */
"use strict";
var assert = require("assert");

var seen = [];
global.Chain = {
  db: async function () { return 7; },
  call: async function (dbId, method, params) {
    seen.push({ method: method, params: params });
    if (method === "get_account_by_name") {
      if (params[0] === "alice") return { id: "1.2.10", name: "alice" };
      return null;
    }
    if (method === "lookup_asset_symbols") {
      if (params[0][0] === "BTS") return [{ id: "1.3.0", symbol: "BTS", precision: 5 }];
      return [null];
    }
    if (method === "get_accounts") return [{ id: params[0][0], name: "alice" }];
    if (method === "get_objects") return [{ id: params[0][0], symbol: "BTS", precision: 5 }];
    throw new Error("unexpected " + method);
  }
};
global.Explorer = undefined;

var passed = 0;
function eq(a, e, n) { assert.deepStrictEqual(a, e, n + " (got " + JSON.stringify(a) + ")"); passed++; }

(async function main() {
  const Account = require("../vanilla/js/api/account.js");
  const Asset = require("../vanilla/js/api/asset.js");
  const fails = [];

  // Account.resolve lowercases before the RPC.
  seen.length = 0;
  const a = await Account.resolve("ALICE");
  if (a.name !== "alice") fails.push("resolve upper -> alice");
  else console.log("PASS resolve uppercases down");
  const q = seen.find((c) => c.method === "get_account_by_name");
  if (!q || q.params[0] !== "alice") fails.push("RPC got lowercase name");
  else console.log("PASS get_account_by_name received lowercase");

  // Ids pass through (lowercase is identity, still routed by id).
  seen.length = 0;
  await Account.resolve("1.2.10");
  if (!seen.find((c) => c.method === "get_accounts")) fails.push("id must route to get_accounts");
  else console.log("PASS id routing untouched");

  // Asset.describe uppercases before the RPC.
  seen.length = 0;
  const s = await Asset.describe("bts");
  if (!s || s.symbol !== "BTS") fails.push("describe lower -> BTS");
  else console.log("PASS describe lowercases up");
  const lq = seen.find((c) => c.method === "lookup_asset_symbols");
  if (!lq || lq.params[0][0] !== "BTS") fails.push("RPC got uppercase symbol");
  else console.log("PASS lookup_asset_symbols received uppercase");

  // Ids pass through.
  seen.length = 0;
  await Asset.describe("1.3.0");
  if (!seen.find((c) => c.method === "get_objects")) fails.push("asset id must route to get_objects");
  else console.log("PASS asset id routing untouched");

  if (fails.length) { fails.forEach((f) => console.log("FAIL " + f)); process.exit(1); }
  console.log("case-normalize-test: passed, 0 failed");
})().catch((e) => { console.log("FAIL harness: " + (e && e.stack || e)); process.exit(1); });
