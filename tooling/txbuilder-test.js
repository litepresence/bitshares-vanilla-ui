#!/usr/bin/env node
/* txbuilder-test.js — offline unit proofs for the TxBuilder composer.
 *
 * What it owns: stdlib-only checks that vanilla/js/api/txbuilder.js implements
 *   the plan contract (state core + fee/build/export/import + auth/sign
 *   honesty + describe rows + wrap/broadcast shapes) with zero network,
 *   zero keys, zero floats on money. Every vector mirrors
 *   docs/superpowers/plans/2026-09-30-txbuilder.md Tasks 1/2/3/4/6/8
 *   (TB1 state, TB2 envelope, TB3 auth, TB4 describe, TB6 wrap/broadcast,
 *   TB8 offline round-trip + leak scan).
 * Consumes: vanilla/js/api/txbuilder.js (require — offline; stubbed globals
 *   Tx/Chain/Wallet/Account/Format/Proposal/Crypto only, no socket).
 * Side effects: none (prints PASS lines, exit 0 green / 1 red).
 * Created by: TxBuilder test-commit task 2026-09-30 (reconstructs the eight
 *   /tmp plan vectors lost on reboot into one committed suite).
 */
"use strict";

const PATH = "/workspace/vanilla/js/api/txbuilder.js";
const CHAIN_ID = "4018d784aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SIG_HEX = "ab".repeat(65); // 130 hex chars — import envelope shape

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; /* console.log("ok " + name); */ }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}
function throwsRe(fn, re, name) {
  try { fn(); } catch (e) {
    ok(re.test(e && e.message || ""), name, "got: " + (e && e.message));
    return;
  }
  ok(false, name, "did not throw");
}
async function throwsAsyncRe(fn, re, name) {
  try { await fn(); } catch (e) {
    ok(re.test(e && e.message || ""), name, "got: " + (e && e.message));
    return;
  }
  ok(false, name, "did not throw");
}

/* fresh: drop the require cache + global singleton so each section starts
 * from zero ops / zero derived state. Returns the re-required TxBuilder.
 * (txbuilder.js re-augments the same global object with fresh closures,
 * so this truly resets _ops/_ctr/_fees/_built.) */
function fresh() {
  try { delete require.cache[require.resolve(PATH)]; } catch (e) { /* first load */ }
  try { delete globalThis.TxBuilder; } catch (e) { /* keep */ }
  return require(PATH);
}
function setBaseTx() {
  globalThis.Tx = { _ser: {} };
}
const T0_OP = { fee: { amount: "0", asset_id: "1.3.0" }, from: "1.2.17", to: "1.2.20", amount: { amount: "150000", asset_id: "1.3.0" }, extensions: [] };

async function sectionState() {
  // TB1 state core (plan Task 1 Step 1 + guards Step 4).
  setBaseTx();
  const B = fresh();
  ok(typeof B.addOp === "function", "state: addOp exists");
  const k = B.addOp(0, T0_OP, "transfer:alice->bob 1.5 TEST");
  ok(typeof k === "string" && k.slice(0, 3) === "tb-", "state: key shape tb-*, got " + k);
  ok(B.count() === 1, "state: count 1");
  throwsRe(() => B.addOp("x", {}, "bad"), /tb-bad-op/, "state: bad opId throws tb-bad-op");
  throwsRe(() => B.addOp(0, null, "bad"), /tb-bad-op/, "state: null opData throws tb-bad-op");
  throwsRe(() => B.addOp(0, T0_OP, ""), /tb-bad-op/, "state: empty source throws tb-bad-op");
  // Serializer guard: no Tx._ser -> tb-unknown-op.
  const savedTx = globalThis.Tx;
  globalThis.Tx = {};
  throwsRe(() => B.addOp(0, T0_OP, "t"), /tb-unknown-op/, "state: missing serializer throws tb-unknown-op");
  globalThis.Tx = savedTx;

  // Guards (plan Task 1 Step 4 second vector).
  B.clear();
  const k2 = B.addOp(6, { fee: { amount: "0", asset_id: "1.3.0" }, account: "1.2.17", new_options: {} }, "vote:test");
  B.setFeeAsset("1.3.7");
  ok(B.state().feeAssetId === "1.3.7", "state: fee asset set to 1.3.7");
  B.setFeeAsset("1.3.0");
  ok(B.removeOp(k2) === true && B.count() === 0, "state: removeOp true + count 0");
  ok(B.removeOp("tb-9999-nope") === false, "state: remove unknown returns false");
  const off = B.subscribe(function () {});
  ok(typeof off === "function", "state: subscribe returns off");
  off();
  throwsRe(() => B.subscribe("x"), /tb-bad-op/, "state: subscribe non-fn throws tb-bad-op");
  throwsRe(() => B.setFeeAsset("1.2.3"), /tb-bad-asset/, "state: bad fee asset throws tb-bad-asset");

  // Invalidation: derived answers reset to null on every mutation.
  globalThis.Tx = {
    _ser: {},
    feeMulti: async function (pairs, feeAssetId) {
      pairs.forEach(function (p) { p[1].fee = { amount: "100", asset_id: feeAssetId }; });
      return { perOp: pairs.map(function (p) { return p[1].fee; }), totalRaw: String(100 * pairs.length), totalDisplay: "x" };
    },
    buildTx: async function (pairs) {
      return { ref_block_num: 1, ref_block_prefix: 2, expiration: "2099-01-01T00:00:30", operations: pairs, extensions: [] };
    }
  };
  globalThis.Chain = { status: function () { return { chainId: CHAIN_ID }; } };
  B.clear();
  B.addOp(0, T0_OP, "t");
  await B.feeAll();
  ok(B.state().fees !== null, "state: fees filled after feeAll");
  await B.buildUnsigned();
  ok(B.state().built !== null, "state: built filled after buildUnsigned");
  B.addOp(0, T0_OP, "t2");
  ok(B.state().fees === null && B.state().built === null, "state: addOp invalidates fees+built");
  await B.feeAll(); await B.buildUnsigned();
  B.setFeeAsset("1.3.1");
  ok(B.state().fees === null && B.state().built === null, "state: setFeeAsset invalidates");
  B.setFeeAsset("1.3.0");
  await B.feeAll(); await B.buildUnsigned();
  const firstKey = B.list()[0].key;
  B.removeOp(firstKey);
  ok(B.state().fees === null && B.state().built === null, "state: removeOp invalidates");
  // Subscribe fires on mutation.
  let seen = 0;
  const off2 = B.subscribe(function () { seen++; });
  B.addOp(0, T0_OP, "t3");
  ok(seen >= 1, "state: subscribe fires on addOp");
  off2();
  B.clear();
  ok(B.count() === 0 && B.state().fees === null && B.state().built === null, "state: clear empties + invalidates");
  console.log("TB1-OK state core");
}

async function sectionEnvelope() {
  // TB2 envelope (plan Task 2 Step 1 + negatives Step 4, TB8 offline leak/round-trip).
  const B = fresh();
  globalThis.Tx = {
    _ser: {},
    feeMulti: async function (pairs, feeAssetId) {
      pairs.forEach(function (p) { p[1].fee = { amount: "100", asset_id: feeAssetId }; });
      return { perOp: pairs.map(function (p) { return p[1].fee; }), totalRaw: String(100 * pairs.length), totalDisplay: "0.00100" };
    },
    buildTx: async function (pairs) {
      return { ref_block_num: 1234, ref_block_prefix: 5678, expiration: "2099-09-30T12:01:00", operations: pairs, extensions: [] };
    }
  };
  globalThis.Chain = { status: function () { return { chainId: CHAIN_ID }; } };
  B.clear();
  B.addOp(0, T0_OP, "transfer:t");
  const f = await B.feeAll();
  ok(f.totalRaw === "100", "envelope: totalRaw 100, got " + f.totalRaw);
  const tx = await B.buildUnsigned();
  ok(tx.operations.length === 1, "envelope: 1 op built");
  const s = B.exportJSON();
  const env = JSON.parse(s);
  ok(env.app === "bts-vanilla-txbuilder" && env.v === 1, "envelope: app/v header");
  ok(!/wif|brainkey|password/i.test(s), "envelope: no secret substrings");
  B.clear();
  const back = B.importJSON(s);
  ok(back.ops.length === 1, "envelope: import restores 1 op");
  // Byte-identity across clear+import (TB8 offline vector).
  const hex1 = JSON.stringify(tx.operations);
  const hex2 = JSON.stringify(B.state().built.operations);
  ok(hex1 === hex2, "envelope: round-trip byte-identical");
  // fees-shape bridge: shipped Tx.feeMulti answers {fees,...} (tx-send.js) —
  // composer accepts both shapes (T8 live-exposed fix).
  const B2 = fresh();
  globalThis.Tx = {
    _ser: {},
    feeMulti: async function (pairs, feeAssetId) {
      pairs.forEach(function (p) { p[1].fee = { amount: "7", asset_id: feeAssetId }; });
      return { fees: pairs.map(function (p) { return p[1].fee; }), totalRaw: "7", totalDisplay: "y" };
    },
    buildTx: async function (pairs) {
      return { ref_block_num: 1, ref_block_prefix: 2, expiration: "2099-01-01T00:00:30", operations: pairs, extensions: [] };
    }
  };
  globalThis.Chain = { status: function () { return { chainId: CHAIN_ID }; } };
  B2.clear();
  B2.addOp(0, T0_OP, "t");
  const f2 = await B2.feeAll();
  ok(f2.totalRaw === "7" && Array.isArray(f2.perOp), "envelope: {fees} shape bridged to perOp");
  console.log("TB8-FEESHAPE-OK");

  // Negatives (plan Task 2 Step 4).
  const B3 = fresh();
  setBaseTx();
  globalThis.Chain = { status: function () { return { chainId: CHAIN_ID }; } };
  B3.clear();
  throwsRe(() => B3.exportJSON(), /tb-nothing-to-export|tb-empty/, "envelope: export empty throws tb-nothing-to-export");
  throwsRe(() => B3.importJSON("not json"), /tb-bad-envelope/, "envelope: non-JSON throws tb-bad-envelope");
  throwsRe(() => B3.importJSON(JSON.stringify({ app: "x", v: 9 })), /tb-bad-envelope/, "envelope: app/v mismatch throws tb-bad-envelope");
  await throwsAsyncRe(() => B3.feeAll(), /tb-empty/, "envelope: feeAll empty throws tb-empty");
  await throwsAsyncRe(() => B3.buildUnsigned(), /tb-empty/, "envelope: buildUnsigned empty throws tb-empty");

  // Expired envelope guard.
  const B4 = fresh();
  globalThis.Tx = {
    _ser: {},
    feeMulti: async function (pairs, id) { pairs.forEach(function (p) { p[1].fee = { amount: "100", asset_id: id }; }); return { perOp: pairs.map(function (p) { return p[1].fee; }), totalRaw: "100", totalDisplay: "x" }; },
    buildTx: async function (pairs) { return { ref_block_num: 1, ref_block_prefix: 2, expiration: "2099-01-01T00:00:30", operations: pairs, extensions: [] }; }
  };
  globalThis.Chain = { status: function () { return { chainId: CHAIN_ID }; } };
  B4.clear();
  B4.addOp(0, T0_OP, "t");
  await B4.feeAll(); await B4.buildUnsigned();
  const good = B4.exportJSON();
  const expiredEnv = JSON.parse(good);
  expiredEnv.tx.expiration = "2020-01-01T00:00:00";
  throwsRe(() => B4.importJSON(JSON.stringify(expiredEnv)), /tb-expired/, "envelope: expired throws tb-expired");
  // Chain-mismatch guard.
  globalThis.Chain = { status: function () { return { chainId: "deadbeefbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }; } };
  throwsRe(() => B4.importJSON(good), /tb-chain-mismatch/, "envelope: wrong chain throws tb-chain-mismatch");
  globalThis.Chain = { status: function () { return { chainId: CHAIN_ID }; } };
  // Ops-drift guard.
  const driftEnv = JSON.parse(good);
  driftEnv.tx.operations.push([0, JSON.parse(JSON.stringify(T0_OP))]);
  throwsRe(() => B4.importJSON(JSON.stringify(driftEnv)), /tb-ops-drift/, "envelope: ops drift throws tb-ops-drift");
  console.log("TB2-OK envelope");
}

async function sectionAuth() {
  // TB3 auth (plan Task 3 Step 1 + missing-key honesty Step 4).
  const B = fresh();
  globalThis.Tx = { _ser: { serializeTransaction: function () { return new Uint8Array([9]); }, hexToBytes: function () { return new Uint8Array([1, 2]); } } };
  globalThis.Chain = {
    db: async function () { return 1; },
    call: async function (id, method) {
      if (method === "get_objects") return [{ id: "1.2.17", name: "alice",
        owner: { weight_threshold: 1, account_auths: [], key_auths: [["BTSOwnerPub", 1]] },
        active: { weight_threshold: 1, account_auths: [], key_auths: [["BTSActivePub", 1]] } }];
      throw new Error("unexpected " + method);
    },
    status: function () { return { chainId: "abcd" }; }
  };
  globalThis.Wallet = { keys: { owner: { wif: "ownerWIF", pub: "BTSOwnerPub" }, active: { wif: "activeWIF", pub: "BTSActivePub" } } };
  B.clear();
  B.addOp(0, T0_OP, "transfer:t");
  const rows = await B.resolveAuths();
  ok(rows.length === 1 && rows[0].missing === false, "auth: threshold met missing:false, got " + JSON.stringify(rows));
  ok(rows[0].accountId === "1.2.17" && rows[0].level === "active", "auth: row account+level");
  // Locked wallet: signLocal throws tb-wallet-locked (no crypto touched).
  const blocked = fresh();
  globalThis.Tx = { _ser: {} };
  globalThis.Chain = { status: function () { return { chainId: "abcd" }; }, db: async function () { return 1; }, call: async function () { return []; } };
  globalThis.Wallet = { keys: null };
  blocked.clear();
  blocked.addOp(0, T0_OP, "t");
  await throwsAsyncRe(() => blocked.signLocal(), /tb-wallet-locked/, "auth: locked wallet throws tb-wallet-locked");

  // Missing-key honesty: empty wallet yields all-missing rows, never throws.
  const Bm = fresh();
  globalThis.Tx = { _ser: { serializeTransaction: function () { return "x"; }, hexToBytes: function () { return "y"; } } };
  globalThis.Chain = {
    db: async function () { return 1; },
    call: async function (id, method) {
      if (method === "get_objects") return [{ id: "1.2.99", name: "bob",
        owner: { weight_threshold: 1, account_auths: [], key_auths: [["BTSRemote", 1]] },
        active: { weight_threshold: 1, account_auths: [], key_auths: [["BTSRemote", 1]] } }];
      return null;
    },
    status: function () { return { chainId: "abcd" }; }
  };
  globalThis.Wallet = { keys: null };
  Bm.clear();
  Bm.addOp(0, { fee: { amount: "0", asset_id: "1.3.0" }, from: "1.2.99", to: "1.2.20", amount: { amount: "1", asset_id: "1.3.0" }, extensions: [] }, "t");
  const rm = await Bm.resolveAuths();
  ok(rm.length >= 1 && rm[0].missing === true, "auth: empty wallet yields all-missing rows");
  console.log("TB3-OK auth + TB3-MISSING-OK");
}

async function sectionDescribe() {
  // TB4 describe (plan Task 4 Step 1 + precision-fallback Step 4, TB8 T5 vectors live here too).
  const B = fresh();
  globalThis.Tx = { _ser: {} };
  globalThis.Account = { resolve: async function (id) { return { name: "alice", id: id }; } };
  globalThis.Chain = { db: async function () { return 1; },
    call: async function (id, m) { if (m === "get_assets") return [{ id: "1.3.0", precision: 5, symbol: "TEST" }]; throw new Error(m); } };
  globalThis.Format = { formatAmount: function () { return "1.50000 TEST"; }, formatPrice: function () { return "1.0"; } };
  const rows = await B.describe(0, T0_OP);
  ok(rows.some(function (r) { return r.label === "Amount" && /1\.50000/.test(r.value); }), "describe: op-0 Amount human, got " + JSON.stringify(rows));
  ok(rows.some(function (r) { return r.label === "Operation" && /Transfer/.test(r.value); }), "describe: op-0 title Transfer");
  const fb = await B.describe(999, { fee: { amount: "0", asset_id: "1.3.0" } });
  ok(/not yet described/.test(fb[0].value), "describe: unknown op honest fallback");
  // Pilot titles 6 + 61 present.
  globalThis.Chain = { db: async function () { return 1; }, call: async function () { return []; } };
  const r6 = await B.describe(6, { fee: { amount: "0", asset_id: "1.3.0" }, account: "1.2.17", new_options: { voting_account: "1.2.5", votes: [], num_witness: 0, num_committee: 0 } });
  ok(/Account update/.test(r6[0].value), "describe: op-6 title Account update");
  const r61 = await B.describe(61, { fee: { amount: "0", asset_id: "1.3.0" }, account: "1.2.17", pool: "1.19.1", amount_a: { amount: "1", asset_id: "1.3.0" }, amount_b: { amount: "1", asset_id: "1.3.0" } });
  ok(/Pool deposit/.test(r61[0].value), "describe: op-61 title Pool deposit");
  // Precision fallback: asset read down -> labelled unresolved, never blank.
  globalThis.Account = { resolve: async function () { throw new Error("down"); } };
  globalThis.Chain = { db: async function () { return 1; }, call: async function () { throw new Error("asset down"); } };
  globalThis.Format = { formatAmount: function (r, p) { return r + "@" + p; } };
  const rf = await B.describe(0, { fee: { amount: "5", asset_id: "1.3.0" }, from: "1.2.1", to: "1.2.2", amount: { amount: "9", asset_id: "1.3.0" }, extensions: [] });
  const amt = rf.filter(function (x) { return x.label === "Amount"; })[0];
  ok(amt && /unresolved/.test(amt.value), "describe: precision fallback labels unresolved, got " + (amt && amt.value));
  console.log("TB4-OK describe + TB4-FALLBACK-OK");
}

async function sectionWrap() {
  // TB6 wrap/broadcast (plan Task 6 Step 1 + fallback Step 4).
  const B = fresh();
  globalThis.Tx = { _ser: {} };
  globalThis.Proposal = { buildCreate: function (a) { return [22, { fee_paying_account: a.feePayerId, proposed_ops: a.innerOps.map(function (p) { return { op: p }; }) }]; } };
  globalThis.Chain = { db: async function () { return 1; }, net: async function () { return 2; },
    call: async function (id, m) { if (m === "broadcast_transaction_with_callback") return true; throw new Error("no " + m); },
    status: function () { return { chainId: "c" }; } };
  B.clear();
  B.addOp(0, { fee: { amount: "0", asset_id: "1.3.0" }, from: "1.2.17", to: "1.2.20", amount: { amount: "10", asset_id: "1.3.0" }, extensions: [] }, "t");
  const w = B.wrapProposal({ feePayerId: "1.2.17", expirationIso: "2026-10-01T12:00:00", reviewPeriodSecOrNull: null });
  ok(w[0] === 22 && w[1].proposed_ops.length === 1, "wrap: outer 22 with 1 inner");
  throwsRe(() => B.wrapProposal({ feePayerId: "bad", expirationIso: "2026-10-01T12:00:00" }), /tb-bad-op/, "wrap: bad feePayer throws tb-bad-op");
  throwsRe(() => B.wrapProposal({ feePayerId: "1.2.17", expirationIso: "not-a-date" }), /tb-bad-op/, "wrap: bad expiration throws tb-bad-op");
  // Transport fallback + long-tail wording (plan Task 6 Step 4 second vector).
  const calls = [];
  globalThis.Chain = { net: async function () { return 2; },
    call: async function (id, m) { calls.push(m); if (m === "broadcast_transaction_with_callback") throw new Error("node rejects method"); return true; },
    status: function () { return { chainId: "c" }; } };
  const r = await B.broadcastSigned({ operations: [[99, { fee: { amount: "1", asset_id: "1.3.0" } }]], signatures: ["aa"] }, {});
  ok(r.via === "broadcast_transaction", "broadcast: fallback via broadcast_transaction, got " + r.via);
  ok(/not proven/.test(r.perOp[0].status), "broadcast: long-tail accepted-but-unproven wording");
  // Per-op prover observed path.
  globalThis.Chain = { net: async function () { return 2; },
    call: async function () { return true; }, status: function () { return { chainId: "c" }; } };
  const r2 = await B.broadcastSigned({ operations: [[0, { x: 1 }]], signatures: ["aa"] }, { 0: async function () { return true; } });
  ok(r2.perOp[0].status === "observed", "broadcast: prover true -> observed");
  // Negatives: empty + sigless.
  await throwsAsyncRe(() => B.broadcastSigned({ operations: [], signatures: [] }, {}), /tb-empty/, "broadcast: empty ops throws tb-empty");
  await throwsAsyncRe(() => B.broadcastSigned({ operations: [[0, {}]], signatures: [] }, {}), /tb-empty/, "broadcast: sigless throws tb-empty");
  console.log("TB6-OK wrap/broadcast + TB6-FALLBACK-OK");
}

(async function main() {
  try {
    await sectionState();
    await sectionEnvelope();
    await sectionAuth();
    await sectionDescribe();
    await sectionWrap();
  } catch (e) {
    fail++;
    console.log("FAIL harness exception :: " + (e && e.stack || e));
  }
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
