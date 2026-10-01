#!/usr/bin/env node
/* Witness/committee serializer vectors (ops 20/21/29/30) — offline byte proofs.

 * What it owns: byte-exact checks that vanilla/js/api/tx.js serializes
 *   witness_create (op 20), witness_update (op 21),
 *   committee_member_create (op 29) and committee_member_update (op 30) in
 *   #4 FC_REFLECT field order with NO trailing extensions byte (witness.hpp
 *   :81/:84, committee_member.hpp:103-106 list exactly 4/5/3/4 fields;
 *   BJS operations.js witness_create/witness_update/committee_member_create
 *   /committee_member_update agree — fetched 2026-09-29), plus the loud
 *   guards (missing/non-string/oversize url, bad key/id) and both dispatch
 *   paths (serializeOperationData + serializeTransaction framing).
 * Consumes: vanilla/js/api/tx.js only (require — offline, no socket, no keys;
 *   the TEST pubkey below is public chain data, never a secret).
 * Side effects: none (prints PASS/FAIL lines, exit 0 green / 1 red).
 * Created by: witness serializers task (ops 20/21 + committee 29/30),
 *   mapping-chain-calls procedure (core ground truth, BJS on-demand fetch).

 * Chain truth (#4 wins):
 * - op 20 = (fee)(witness_account)(url)(block_signing_key), no extensions
 *   <- operations.hpp:76 + witness.hpp:81
 * - op 21 = (fee)(witness)(witness_account)(new_url?)(new_signing_key?),
 *   no extensions <- operations.hpp:77 + witness.hpp:84
 * - op 29 = (fee)(committee_member_account)(url), no extensions
 *   <- operations.hpp:85 + committee_member.hpp:103-104
 * - op 30 = (fee)(committee_member)(committee_member_account)(new_url?),
 *   no extensions <- operations.hpp:86 + committee_member.hpp:105-106
 * - url < GRAPHENE_MAX_URL_LENGTH (127 bytes, config.hpp:41) per
 *   witness.cpp:30-41 validate(); task step 6 note: "op 35" is
 *   custom_operation (operations.hpp:91 — generic payer/auths/id/data
 *   payload, no voting-page path builds it), so the committee join ships
 *   as op 29 (+ op 30 for pair completeness) and op 35 stays deferred.
 */
"use strict";
const Tx = require("/workspace/vanilla/js/api/tx.js");
const S = Tx._ser;

/* Public TEST key (chain data, not a secret — decodes to 33 raw bytes). */
const PUB = "TEST7MBQV4eYZLv95o3SkmBMYGJUbY7GmELD9JcLyJqBFvfGbf3oaQ";
const ACCT = "1.2.26833";
const WIT = "1.6.123";
const COM = "1.5.7";
const FEE = { amount: "100000", asset_id: "1.3.0" };

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}
function hex(u8) { return S.bytesToHex(u8); }
function eq(a, b) { return hex(a) === hex(b); }

(function main() {
  // 1. OP ids + names.
  ok(Tx.OP.witness_create === 20, "op id witness_create=20");
  ok(Tx.OP.witness_update === 21, "op id witness_update=21");
  ok(Tx.OP.committee_member_create === 29, "op id committee_member_create=29");
  ok(Tx.OP.committee_member_update === 30, "op id committee_member_update=30");

  // 2. op 20 bytes == manual parts (order + NO trailing extensions byte).
  const c20 = { fee: FEE, witness_account: ACCT, url: "https://example.com/w", block_signing_key: PUB };
  const got20 = S.serializeWitnessCreateOp(c20);
  const want20 = S.concatBytes([
    S.serializeAsset(FEE), S.serializeObjectId(ACCT),
    S.serializeString(c20.url), S.serializePublicKey(PUB)
  ]);
  ok(eq(got20, want20), "op20 exact bytes, no extensions tail",
    "got " + hex(got20) + " want " + hex(want20));
  ok(got20.length === want20.length, "op20 length has no hidden tail (" + got20.length + ")");

  // 3. op 21 full (both optionals present).
  const u21 = { fee: FEE, witness: WIT, witness_account: ACCT, new_url: "https://example.com/n", new_signing_key: PUB };
  const got21 = S.serializeWitnessUpdateOp(u21);
  const want21 = S.concatBytes([
    S.serializeAsset(FEE), S.serializeObjectId(WIT), S.serializeObjectId(ACCT),
    S.concatBytes([new Uint8Array([1]), S.serializeString(u21.new_url)]),
    S.concatBytes([new Uint8Array([1]), S.serializePublicKey(PUB)])
  ]);
  ok(eq(got21, want21), "op21 full bytes", "got " + hex(got21));

  // 4. op 21 both absent -> two bare 0x00 optionals, still no extensions.
  const u21e = { fee: FEE, witness: WIT, witness_account: ACCT };
  const got21e = S.serializeWitnessUpdateOp(u21e);
  const want21e = S.concatBytes([
    S.serializeAsset(FEE), S.serializeObjectId(WIT), S.serializeObjectId(ACCT),
    new Uint8Array([0]), new Uint8Array([0])
  ]);
  ok(eq(got21e, want21e), "op21 both-absent bytes", "got " + hex(got21e));

  // 5. op 21 url-only (key absent).
  const u21u = { fee: FEE, witness: WIT, witness_account: ACCT, new_url: "https://example.com/o" };
  const got21u = S.serializeWitnessUpdateOp(u21u);
  const want21u = S.concatBytes([
    S.serializeAsset(FEE), S.serializeObjectId(WIT), S.serializeObjectId(ACCT),
    S.concatBytes([new Uint8Array([1]), S.serializeString(u21u.new_url)]),
    new Uint8Array([0])
  ]);
  ok(eq(got21u, want21u), "op21 url-only bytes", "got " + hex(got21u));

  // 6. op 29 bytes == manual parts (no extensions tail).
  const c29 = { fee: FEE, committee_member_account: ACCT, url: "https://example.com/c" };
  const got29 = S.serializeCommitteeMemberCreateOp(c29);
  const want29 = S.concatBytes([
    S.serializeAsset(FEE), S.serializeObjectId(ACCT), S.serializeString(c29.url)
  ]);
  ok(eq(got29, want29), "op29 exact bytes, no extensions tail", "got " + hex(got29));

  // 7. op 30 with new_url, and absent.
  const m30 = { fee: FEE, committee_member: COM, committee_member_account: ACCT, new_url: "https://example.com/m" };
  const got30 = S.serializeCommitteeMemberUpdateOp(m30);
  const want30 = S.concatBytes([
    S.serializeAsset(FEE), S.serializeObjectId(COM), S.serializeObjectId(ACCT),
    S.concatBytes([new Uint8Array([1]), S.serializeString(m30.new_url)])
  ]);
  ok(eq(got30, want30), "op30 set-url bytes", "got " + hex(got30));
  const got30e = S.serializeCommitteeMemberUpdateOp(
    { fee: FEE, committee_member: COM, committee_member_account: ACCT });
  const want30e = S.concatBytes([
    S.serializeAsset(FEE), S.serializeObjectId(COM), S.serializeObjectId(ACCT),
    new Uint8Array([0])
  ]);
  ok(eq(got30e, want30e), "op30 absent-url bytes", "got " + hex(got30e));

  // 8. Loud guards (never silent defaults).
  function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
  ok(throws(() => S.serializeWitnessCreateOp(
    { fee: FEE, witness_account: ACCT, block_signing_key: PUB })), "op20 missing url throws");
  ok(throws(() => S.serializeWitnessCreateOp(
    { fee: FEE, witness_account: ACCT, url: "x".repeat(127), block_signing_key: PUB })), "op20 127B url throws");
  ok(!throws(() => S.serializeWitnessCreateOp(
    { fee: FEE, witness_account: ACCT, url: "x".repeat(126), block_signing_key: PUB })), "op20 126B url ok");
  ok(throws(() => S.serializeWitnessCreateOp(
    { fee: FEE, witness_account: ACCT, url: "https://ok.example", block_signing_key: "NOPE" })), "op20 bad key throws");
  ok(throws(() => S.serializeWitnessCreateOp(
    { fee: FEE, witness_account: "bad-id", url: "https://ok.example", block_signing_key: PUB })), "op20 bad id throws");
  ok(throws(() => S.serializeWitnessUpdateOp(
    { fee: FEE, witness: WIT, witness_account: ACCT, new_url: "y".repeat(200) })), "op21 oversize new_url throws");
  ok(throws(() => S.serializeCommitteeMemberCreateOp(
    { fee: FEE, committee_member_account: ACCT })), "op29 missing url throws");
  ok(throws(() => S.serializeCommitteeMemberUpdateOp(
    { fee: FEE, committee_member: COM, committee_member_account: ACCT, new_url: "z".repeat(127) })), "op30 127B url throws");

  // 9. Dispatch paths: nested-op recursion + top-level framing agree.
  [[20, c20], [21, u21], [29, c29], [30, m30]].forEach(([id, data]) => {
    const viaNested = S.serializeOperationData(id, data);
    const direct = id === 20 ? S.serializeWitnessCreateOp(data)
      : id === 21 ? S.serializeWitnessUpdateOp(data)
      : id === 29 ? S.serializeCommitteeMemberCreateOp(data)
      : S.serializeCommitteeMemberUpdateOp(data);
    ok(eq(viaNested, direct), "op" + id + " nested recursion == direct");
  });
  [20, 21, 29, 30].forEach((id) => {
    const data = id === 20 ? c20 : id === 21 ? u21 : id === 29 ? c29 : m30;
    const tx = {
      ref_block_num: 1, ref_block_prefix: 2,
      expiration: "2026-01-01T00:00:00",
      operations: [[id, data]], extensions: []
    };
    const got = S.serializeTransaction(tx);
    const expSecs = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000) >>> 0;
    const want = S.concatBytes([
      S.writeUint16LE(1), S.writeUint32LE(2), S.writeUint32LE(expSecs),
      S.varintUint32(1), S.varintUint32(id), S.serializeOperationData(id, data),
      S.varintUint32(0)
    ]);
    ok(eq(got, want), "op" + id + " tx framing (varint id + data, ext 0)");
  });
  ok(throws(() => S.serializeOperationData(35, {})), "op35 still undispatched (custom deferred)");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
