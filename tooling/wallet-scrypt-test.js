#!/usr/bin/env node
/* Wallet v2 keystore test — scrypt KDF, verifier, HKDF, v1 migration.
 *
 * Proves (stdlib + node webcrypto only, exit 0 green / 1 red):
 *   1. ScryptKdf matches RFC 7914 vectors AND Node crypto.scryptSync at the
 *      production params (N=2^15, r=8, p=1) — the vendored port is real scrypt.
 *   2. create() writes a v2 envelope (scrypt + HKDF + verifier); unlock
 *      round-trips; fresh salt/hkdfSalt/iv per write.
 *   3. A wrong password is rejected by the timing-safe verifier.
 *   4. A tampered verifier => "wrong password"; a tampered ciphertext with an
 *      intact verifier => "corrupt wallet" (distinct outcomes).
 *   5. A legacy v1 (PBKDF2) envelope still unlocks, and is upgraded to v2
 *      in place; a rewrite failure leaves the working v1 envelope usable.
 *
 * Load order mirrors index.html: noble-classic -> scrypt -> crypto -> wallet.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const crypto = require("crypto");

const REPO = "/workspace";
vm.runInThisContext(fs.readFileSync(REPO + "/vanilla/js/sdk/vendor/noble-classic.js", "utf8"), { filename: "noble-classic.js" });
vm.runInThisContext(fs.readFileSync(REPO + "/vanilla/js/sdk/vendor/scrypt.js", "utf8"), { filename: "scrypt.js" });
vm.runInThisContext(fs.readFileSync(REPO + "/vanilla/js/sdk/data/brainkey-dict.js", "utf8"), { filename: "brainkey-dict.js" });
const Crypto = require(REPO + "/vanilla/js/sdk/crypto.js");
globalThis.Crypto = Crypto;
const Wallet = require(REPO + "/vanilla/js/api/wallet.js");

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); }
};

const LS_KEY = "bts-vanilla-wallet-v1";
const LOCKOUT_KEY = "bts-vanilla-lockout-v1";
const PW = "correct horse battery staple volume";
const BK = "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert algae all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor aroma around arrange arrest arrive arrow art artefact artist artisty";
const b64 = (u) => Buffer.from(u).toString("base64");
const fromB64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const enc = (s) => new TextEncoder().encode(s);

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}
async function rejects(fn, prefix, name) {
  try { await fn(); ok(false, name, "resolved instead of rejecting"); return null; }
  catch (e) { ok(e && typeof e.message === "string" && e.message.indexOf(prefix) === 0, name, e && e.message); return e; }
}

/* Build a v1 envelope by hand (PBKDF2-600k + AES-GCM) — the exact shape the
 * pre-v2 wallet wrote, so migration reads a real legacy artifact. */
function makeV1Envelope(password, plain) {
  const ITERATIONS = 600000;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(password), salt, ITERATIONS, 32, "sha256");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(plain), "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag(); // WebCrypto appends the tag to the ciphertext
  return {
    v: 1,
    salt: b64(salt),
    iterations: ITERATIONS,
    iv: b64(iv),
    data: b64(Buffer.concat([ct, tag]))
  };
}
const DUMMY_PLAIN = {
  brainkey: BK,
  keys: {
    owner: { wif: "5" + "a".repeat(50), pub: "BTS" + "b".repeat(50) },
    active: { wif: "5" + "c".repeat(50), pub: "BTS" + "d".repeat(50) },
    memo: { wif: "5" + "e".repeat(50), pub: "BTS" + "f".repeat(50) }
  },
  created: "2026-01-01T00:00:00.000Z"
};

(async function main() {
  /* 1. Scrypt KAT — RFC 7914 + Node cross-check at production params. */
  const rfc = [
    { P: "", S: "", N: 16, r: 1, p: 1, out: "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906" },
    { P: "password", S: "NaCl", N: 1024, r: 8, p: 16, out: "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640" },
    { P: "pleaseletmein", S: "SodiumChloride", N: 16384, r: 8, p: 1, out: "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887" }
  ];
  for (const v of rfc) {
    const got = Buffer.from(await ScryptKdf.derive(enc(v.P), enc(v.S), 64, { N: v.N, r: v.r, p: v.p })).toString("hex");
    ok(got === v.out, "RFC 7914 KAT N=" + v.N + " r=" + v.r + " p=" + v.p, got.slice(0, 16));
  }
  const saltProd = enc("0123456789abcdef");
  const ours = Buffer.from(await ScryptKdf.derive(enc("interop-password"), saltProd, 32, { N: 32768, r: 8, p: 1 })).toString("hex");
  const nodes = crypto.scryptSync(Buffer.from("interop-password"), saltProd, 32, { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString("hex");
  ok(ours === nodes, "vendored scrypt == node crypto.scryptSync (N=2^15,r=8,p=1)", ours.slice(0, 16));

  /* 2. v2 create/unlock round-trip + envelope shape + fresh randomness. */
  const keys = await Wallet.create(PW, BK);
  const s1 = JSON.stringify(keys);
  ok(keys && keys.active && keys.active.wif, "create returns keys");
  const env1 = JSON.parse(mem.get(LS_KEY));
  ok(env1.v === 2, "create writes a v2 envelope", "v=" + env1.v);
  ok(env1.kdf === "scrypt" && env1.N === 32768 && env1.r === 8 && env1.p === 1, "v2 stores scrypt params");
  ok(typeof env1.hkdfSalt === "string" && typeof env1.verifier === "string", "v2 stores hkdfSalt + verifier");
  ok(typeof env1.iterations === "undefined", "v2 does not carry the v1 iterations field");
  Wallet.lock();
  const keys2 = await Wallet.unlock(PW);
  ok(JSON.stringify(keys2) === s1, "v2 unlock round-trips identical keys");
  Wallet.lock();
  await Wallet.create(PW, BK); // same password+brainkey -> fresh salts/IV
  const env2 = JSON.parse(mem.get(LS_KEY));
  ok(env2.salt !== env1.salt && env2.hkdfSalt !== env1.hkdfSalt && env2.iv !== env1.iv,
    "each write uses a fresh salt/hkdfSalt/iv");
  Wallet.lock();

  /* 3+4. Verifier outcomes: wrong password, tampered verifier, tampered ct. */
  await rejects(() => Wallet.unlock("definitely not the password"), "wrong password", "wrong password rejected by verifier");
  Wallet.lock();
  mem.delete(LOCKOUT_KEY);
  const good = JSON.parse(mem.get(LS_KEY));
  const badVerifier = JSON.parse(JSON.stringify(good));
  const vb = fromB64(badVerifier.verifier); vb[0] ^= 0xff; badVerifier.verifier = b64(vb);
  mem.set(LS_KEY, JSON.stringify(badVerifier));
  await rejects(() => Wallet.unlock(PW), "wrong password", "tampered verifier => wrong password");
  Wallet.lock();
  mem.delete(LOCKOUT_KEY);
  const badCt = JSON.parse(JSON.stringify(good));
  const cb = fromB64(badCt.data); cb[0] ^= 0xff; badCt.data = b64(cb);
  mem.set(LS_KEY, JSON.stringify(badCt));
  await rejects(() => Wallet.unlock(PW), "corrupt wallet", "tampered ciphertext => corrupt wallet (verifier intact)");
  Wallet.lock();
  mem.delete(LOCKOUT_KEY);

  /* 5a. Legacy v1 envelope unlocks and is upgraded in place. */
  const v1 = makeV1Envelope(PW, DUMMY_PLAIN);
  mem.set(LS_KEY, JSON.stringify(v1));
  const migrated = await Wallet.unlock(PW);
  ok(migrated && migrated.active.wif === DUMMY_PLAIN.keys.active.wif, "v1 envelope unlocks");
  const after = JSON.parse(mem.get(LS_KEY));
  ok(after.v === 2, "v1 unlock auto-upgrades the envelope to v2", "v=" + after.v);
  Wallet.lock();
  mem.delete(LOCKOUT_KEY);
  const again = await Wallet.unlock(PW);
  ok(again && again.active.wif === DUMMY_PLAIN.keys.active.wif, "upgraded v2 envelope unlocks on the next try");
  Wallet.lock();
  mem.delete(LOCKOUT_KEY);

  /* 5b. A failed migration rewrite must leave the v1 envelope usable. */
  mem.set(LS_KEY, JSON.stringify(v1));
  Wallet.setBackend({
    getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: async (k, v) => { if (k === LS_KEY) throw new Error("disk full"); mem.set(k, String(v)); }
  });
  const survived = await Wallet.unlock(PW);
  ok(survived && survived.active.wif === DUMMY_PLAIN.keys.active.wif, "v1 unlocks even when the v2 rewrite fails");
  ok(JSON.parse(mem.get(LS_KEY)).v === 1, "failed migration leaves the v1 envelope in place");
  Wallet.lock();

  console.log("Wallet scrypt vectors: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL harness: " + (e && e.stack || e)); process.exit(1); });
