#!/usr/bin/env node
/* Wallet storage-seam round-trip test (stdlib + node webcrypto only).
 * Proves: (1) default backend path is web-identical (create -> lock ->
 * unlock -> same keys; wrong password fails; envelope persisted);
 * (2) an injected ASYNC backend works end to end (extension path);
 * (3) unlock rate-limit delays consecutive failures + persists a stamp.
 * Exit 0 green, 1 red. */
"use strict";
const fs = require("fs");
const vm = require("vm");

vm.runInThisContext(fs.readFileSync("/workspace/vanilla/js/sdk/vendor/noble-classic.js", "utf8"), { filename: "noble-classic.js" });
vm.runInThisContext(fs.readFileSync("/workspace/vanilla/js/sdk/vendor/scrypt.js", "utf8"), { filename: "scrypt.js" });
vm.runInThisContext(fs.readFileSync("/workspace/vanilla/js/sdk/data/brainkey-dict.js", "utf8"), { filename: "brainkey-dict.js" });
const Crypto = require("/workspace/vanilla/js/sdk/crypto.js");
globalThis.Crypto = Crypto;
const Wallet = require("/workspace/vanilla/js/api/wallet.js");

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const BK = "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert algae all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor aroma around arrange arrest arrive arrow art artefact artist artisty";
const PW = "correct horse battery staple volume";

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

(async function main() {
  // 1. default backend round-trip. (Snapshot strings immediately: lock()
  // zero-fills the live key object, so live refs must never be compared.)
  const keys = await Wallet.create(PW, BK);
  const s1 = JSON.stringify(keys);
  ok(keys && keys.active && keys.active.wif && keys.active.pub, "create returns keys");
  ok(mem.has("bts-vanilla-wallet-v1"), "envelope persisted (default backend)");
  Wallet.lock();
  ok(!Wallet.isUnlocked(), "locked");
  const keys2 = await Wallet.unlock(PW);
  ok(JSON.stringify(keys2) === s1, "unlock round-trips identical keys");
  Wallet.lock();
  let wrong = null;
  try { await Wallet.unlock("wrong password here"); } catch (e) { wrong = e && e.message; }
  ok(wrong && wrong.indexOf("wrong password") === 0, "wrong password fails", wrong);

  // 2. injected async backend.
  const box = new Map();
  Wallet.setBackend({
    getItem: async (k) => (box.has(k) ? box.get(k) : null),
    setItem: async (k, v) => { box.set(k, String(v)); },
  });
  let badBackend = null;
  try { Wallet.setBackend({}); } catch (e) { badBackend = e && e.message; }
  ok(badBackend && badBackend.indexOf("bad storage backend") === 0, "setBackend validates shape");
  const k3 = await Wallet.create(PW, BK);
  const s3 = JSON.stringify(k3);
  ok(box.has("bts-vanilla-wallet-v1"), "async backend stores envelope");
  ok(box.get("bts-vanilla-wallet-v1") !== mem.get("bts-vanilla-wallet-v1"), "async ciphertext differs (fresh salt/iv)");
  Wallet.lock();
  const k4 = await Wallet.unlock(PW);
  ok(JSON.stringify(k4) === s3, "async backend round-trips identical keys");
  Wallet.lock();

  // 3. rate-limit: consecutive failures are delayed + stamped. (Clear the
  // persisted stamp first so this step measures the DELAY mechanism rather
  // than tripping the stamp short-circuit from the step above.)
  // 3. rate-limit: consecutive failures persist count + stamp, and the
  // second failure requests the backoff delay (call-count + stamp asserts —
  // no wall-clock deltas; timing is flaky under load).
  box.delete("bts-vanilla-lockout-v1");
  await Wallet.unlock(PW);
  Wallet.lock();
  box.delete("bts-vanilla-lockout-v1");
  let firstMsg = null;
  try {
    await Wallet.unlock("nope-1");
    ok(false, "first wrong password must reject", "resolved instead of rejecting");
  } catch (e) {
    firstMsg = e && e.message;
    ok(firstMsg && firstMsg.indexOf("wrong password") === 0, "first failure reports wrong password", firstMsg);
  }
  let stamp1 = null;
  try {
    stamp1 = JSON.parse(box.get("bts-vanilla-lockout-v1"));
    ok(stamp1 && stamp1.failCount === 1, "first failure persists failCount 1", JSON.stringify(stamp1));
    ok(stamp1 && typeof stamp1.until === "number" && stamp1.until > 0, "first failure stamps a future until", JSON.stringify(stamp1));
  } catch (e) {
    ok(false, "first lockout stamp parses as JSON", e && e.message);
  }
  box.delete("bts-vanilla-lockout-v1"); // isolate the delay mechanism
  const realSetTimeout = globalThis.setTimeout;
  let delayCalls = 0;
  let delayMs = [];
  globalThis.setTimeout = function (fn, ms) { delayCalls++; delayMs.push(ms); return realSetTimeout(fn, ms); };
  let lateMsg = null;
  try {
    await Wallet.unlock("nope-2");
    ok(false, "second wrong password must reject", "resolved instead of rejecting");
  } catch (e) {
    lateMsg = e && e.message;
    ok(lateMsg && lateMsg.indexOf("wrong password") === 0, "delayed failure still reports wrong password", lateMsg);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  ok(delayCalls >= 1, "second consecutive failure requests a backoff delay", delayCalls + " delay calls");
  ok(delayMs.some((m) => m >= 1000), "backoff delay requested >=1000ms", JSON.stringify(delayMs));
  let stamp2 = null;
  try {
    stamp2 = JSON.parse(box.get("bts-vanilla-lockout-v1"));
    ok(stamp2 && stamp2.failCount === 2, "second failure persists failCount 2", JSON.stringify(stamp2));
  } catch (e) {
    ok(false, "second lockout stamp parses as JSON", e && e.message);
  }
  // And the stamp path short-circuits while a lockout is recorded.
  let stampMsg = null;
  try { await Wallet.unlock("nope-3"); } catch (e) { stampMsg = e && e.message; }
  ok(stampMsg && stampMsg.indexOf("locked out") === 0, "persisted stamp short-circuits", stampMsg);
  ok(box.has("bts-vanilla-lockout-v1"), "lockout stamp persisted", "missing bts-vanilla-lockout-v1");

  console.log("Wallet seam vectors: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL harness: " + (e && e.stack || e)); process.exit(1); });
