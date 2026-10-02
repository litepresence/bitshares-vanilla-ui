#!/usr/bin/env node
/* account-ops-test: unit vectors for Account._opsArgs + Account.opsFiltered.
 * Stdlib only (plain asserts, no network). Exit 0 = all pass, 1 = any failure.
 * Provenance: verified method signature triangulated per mapping-chain-calls —
 *   #4 api.hpp:146-152 [account, op_type:int64, start, stop, limit];
 *   astro-ui DexLiveOrderBook.ts:92-98 + MarketTradeHistory.ts:142-148
 *     [accountId, 4, "1.11.0", "1.11.0", 50];
 *   live sweep tooling/history-probe.mjs:385 ["1.2.0", 0, "1.11.0",
 *     "1.11.0", 1] → ok on all 9 nodes (2026-10-02).
 * Seam: account.js touches Chain only at CALL time, so require needs no
 *   globals; each opsFiltered case installs its own globalThis.Chain stub. */
"use strict";
var Account = require("/workspace/vanilla/js/api/account.js");
var pass = 0, fail = 0;
function eq(got, want, name) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; }
  else { fail++; console.log("FAIL " + name + "\n got " + JSON.stringify(got) + "\n want " + JSON.stringify(want)); }
}
function throwsCode(fn, code, name) {
  try {
    fn();
  } catch (e) {
    eq(e && e.message, code, name);
    return;
  }
  fail++;
  console.log("FAIL " + name + "\n want throw " + code + ", nothing thrown");
}
async function rejectsCode(promiseFn, code, name) {
  try {
    await promiseFn();
  } catch (e) {
    eq(e && e.message, code, name);
    return;
  }
  fail++;
  console.log("FAIL " + name + "\n want reject " + code + ", resolved");
}

/* 1: single op [0], defaults (limit 20, start/stop 1.11.0). */
eq(Account._opsArgs("1.2.5", [0]), [["1.2.5", 0, "1.11.0", "1.11.0", 20]], "opsArgs single transfer defaults");

/* 2: multi-op [0,4] preserves order, one arg array per type. */
eq(Account._opsArgs("1.2.5", [0, 4], 50),
  [["1.2.5", 0, "1.11.0", "1.11.0", 50], ["1.2.5", 4, "1.11.0", "1.11.0", 50]],
  "opsArgs multi-op fan-out");

/* 3: limit clamps to the node cap (100, application.hpp:49). */
eq(Account._opsArgs("1.2.5", [4], 500), [["1.2.5", 4, "1.11.0", "1.11.0", 100]], "opsArgs limit clamps to 100");

/* 4: limit floors at 1 and drops fractions. */
eq(Account._opsArgs("1.2.5", [4], 0), [["1.2.5", 4, "1.11.0", "1.11.0", 1]], "opsArgs limit 0 clamps to 1");
eq(Account._opsArgs("1.2.5", [4], 20.7), [["1.2.5", 4, "1.11.0", "1.11.0", 20]], "opsArgs limit floors");

/* 5: explicit start cursor lands in position [2] (start BEFORE stop). */
eq(Account._opsArgs("1.2.5", [0], 10, "1.11.42"), [["1.2.5", 0, "1.11.42", "1.11.0", 10]], "opsArgs start cursor");

/* 6-13: bad inputs throw bad-args (never partial output, never network). */
throwsCode(function () { Account._opsArgs("1.2.5", []); }, "bad-args", "opsArgs rejects empty opTypes");
throwsCode(function () { Account._opsArgs("1.2.5", "0"); }, "bad-args", "opsArgs rejects non-array opTypes");
throwsCode(function () { Account._opsArgs("1.2.5", [1.5]); }, "bad-args", "opsArgs rejects fractional op");
throwsCode(function () { Account._opsArgs("1.2.5", ["4"]); }, "bad-args", "opsArgs rejects string op");
throwsCode(function () { Account._opsArgs("1.2.5", [0, NaN]); }, "bad-args", "opsArgs rejects NaN op");
throwsCode(function () { Account._opsArgs("", [0]); }, "bad-args", "opsArgs rejects empty account");
throwsCode(function () { Account._opsArgs("1.2.5", [0], 10, "nope"); }, "bad-args", "opsArgs rejects bad start");
throwsCode(function () { Account._opsArgs("1.2.5", [0], "20"); }, "bad-args", "opsArgs rejects string limit");

(async () => {
  /* 14: single-type call — exact method name + arg order, no network. */
  var seen = [];
  globalThis.Chain = {
    history: function () { return Promise.resolve(7); },
    call: async function () {
      var a = Array.prototype.slice.call(arguments);
      seen.push(a);
      return [{ id: "1.11.9", op: [0, {}] }, { id: "1.11.5", op: [0, {}] }];
    }
  };
  var rows = await Account.opsFiltered("1.2.5", [0], 20);
  eq(seen.length, 1, "opsFiltered single type issues one call");
  eq(seen[0] && seen[0][1], "get_account_history_operations", "opsFiltered method name");
  eq(seen[0] && seen[0][2], ["1.2.5", 0, "1.11.0", "1.11.0", 20], "opsFiltered arg order");
  eq(rows.map(function (r) { return r.id; }), ["1.11.9", "1.11.5"], "opsFiltered newest-first passthrough");

  /* 15-16: multi-type merge sorts newest-first across streams. */
  globalThis.Chain = {
    history: function () { return Promise.resolve(7); },
    call: async function (api, method, params) {
      if (params[1] === 0) return [{ id: "1.11.9", op: [0, {}] }, { id: "1.11.5", op: [0, {}] }];
      return [{ id: "1.11.7", op: [4, {}] }];
    }
  };
  var merged = await Account.opsFiltered("1.2.5", [0, 4], 10);
  eq(merged.map(function (r) { return r.id; }), ["1.11.9", "1.11.7", "1.11.5"], "opsFiltered merges newest-first");
  eq(merged.length, 3, "opsFiltered keeps all rows");

  /* 17: empty + nullish per-type results yield []. */
  globalThis.Chain = {
    history: function () { return Promise.resolve(7); },
    call: async function (api, method, params) { return params[1] === 0 ? [] : null; }
  };
  eq(await Account.opsFiltered("1.2.5", [0, 4]), [], "opsFiltered empty/nullish yields []");

  /* 18: non-array shape maps to history-unavailable (same catch family as history()). */
  globalThis.Chain = {
    history: function () { return Promise.resolve(7); },
    call: async function () { return { weird: 1 }; }
  };
  await rejectsCode(function () { return Account.opsFiltered("1.2.5", [0]); }, "history-unavailable", "opsFiltered weird shape");

  /* 19: call rejection maps to history-unavailable. */
  globalThis.Chain = {
    history: function () { return Promise.resolve(7); },
    call: async function () { throw new Error("boom"); }
  };
  await rejectsCode(function () { return Account.opsFiltered("1.2.5", [0]); }, "history-unavailable", "opsFiltered call reject");

  /* 20: missing history api maps to history-unavailable. */
  globalThis.Chain = {
    history: function () { return Promise.reject(new Error("no api")); },
    call: async function () { throw new Error("must not be called"); }
  };
  await rejectsCode(function () { return Account.opsFiltered("1.2.5", [0]); }, "history-unavailable", "opsFiltered history reject");

  /* 21: bad args reject pre-network (no Chain.call issued). */
  var calls = [];
  globalThis.Chain = {
    history: function () { return Promise.resolve(7); },
    call: async function () { calls.push(1); return []; }
  };
  await rejectsCode(function () { return Account.opsFiltered("", [0]); }, "bad-args", "opsFiltered bad account pre-network");
  await rejectsCode(function () { return Account.opsFiltered("1.2.5", []); }, "bad-args", "opsFiltered empty types pre-network");
  eq(calls.length, 0, "opsFiltered bad args issue no calls");

  console.log("account-ops-test: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  fail++;
  console.log("FAIL harness\n " + ((e && e.stack) || e));
  console.log("account-ops-test: " + pass + " passed, " + fail + " failed");
  process.exit(1);
});
