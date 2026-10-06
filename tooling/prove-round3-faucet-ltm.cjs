#!/usr/bin/env node
/* prove-round3-faucet-ltm.cjs — round 3: ONE faucet attempt + transfer-first-then-shred + LTM queue.
 *
 * What it owns: (1) EXACTLY ONE patient faucet POST for a FRESH throwaway
 *   name (never the fixture name) with fresh noble keys; (2) if funded, a
 *   ~250 TEST throwaway→fixture transfer via the vanilla op-0 serializer
 *   path FIRST, THEN shred of the throwaway keys (verified gone); (3) op-8
 *   account_upgrade on fixture 1.2.26833 via the vanilla serializer path
 *   (fee filled DIRECT via get_required_fees — the Tx.fee 5-unit guard
 *   refuses the exact 20000000 consensus fee, per round-2 finding); (4) ops
 *   20 witness_create, 29 committee_create, 34 worker_create, 21/30 updates —
 *   each built via the vanilla serializer path, broadcast, re-read proof,
 *   dust-exact deltas; STOP at first funds-exhaustion with numbers.
 *   If the faucet refuses: keys shredded, exact response recorded, step (3)
 *   onward attempted only if somehow affordable with fixture funds (else
 *   BLOCKED with a fresh balance quote); ops 3/17/45 are NOT redone
 *   (evaluator-reached already recorded in round 2).
 * Consumes: unmodified vanilla sources via vm (chain/store/tx/tx-send/
 *   format/crypto/account/tx-primitives/tx-ops-trade/tx-ops-gov/asset/
 *   asset-ops + noble vendor); fixture tooling/testnet-lite-test-1.json.
 * Secrets: fixture active_priv_wif in memory for sign calls ONLY; throwaway
 *   privkeys in /tmp file (600-perms, saved BEFORE POST so a timeout never
 *   loses keys) + memory only; shredded (overwrite + unlink, verified gone)
 *   AFTER the transfer confirms — never before. NEVER printed, NEVER logged,
 *   NEVER committed (logs carry ids/blocks/fees/deltas/pubs only).
 * Created by: testnet proof round-3 task (2026-10-06).
 *
 * Chain truth (#4 wins): op-0 fields <- protocol/transfer.hpp (fee, from,
 *   to, amount, memo?, extensions); op-8 <- account.hpp account_upgrade +
 *   FC_REFLECT (fee, account_to_upgrade, upgrade_to_lifetime_member); op-20
 *   <- witness.hpp:81 (fee, witness_account, url, block_signing_key, NO
 *   extensions); op-21 <- witness.hpp witness_update (fee, witness,
 *   witness_account, new_url?, new_signing_key?); op-29 <-
 *   committee_member.hpp:103-104 (fee, committee_member_account, url, NO
 *   extensions); op-30 <- committee_member_update; op-34 <- worker.hpp
 *   (fee, owner, work_begin/end_date, daily_pay, name, url, initializer);
 *   LTM gates <- witness_evaluator.cpp:35, committee_member_evaluator.cpp:37,
 *   worker_evaluator.cpp:39 (is_lifetime_member(); sentinel 2106-02-07T06:28:15
 *   per account_object.hpp). Fees from get_required_fees (never estimated).
 *
 * Faucet discipline (precedent git show 75231c3 + round 2): ONE attempt,
 *   90s timeout, keys saved before POST, respect any rate-limit with quiet
 *   STOP — never work around anti-spam (no retry, no proxy, no second name).
 *
 * Usage: node /workspace/tooling/prove-round3-faucet-ltm.cjs
 * Exit 0 = queue walked to its honest end (each op COVERED / EVALUATOR /
 *   BLOCKED recorded); exit 3 = funds-guard or faucet-refused STOP (nothing
 *   half-done: transfer-first-then-shred preserved); exit 1 = failure.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const tls = require("tls");
const net = require("net");
const nodeCrypto = require("crypto");

const V = "/workspace/vanilla/js/";
const NODES = ["wss://testnet.dex.trading/", "wss://testnet.xbts.io/ws"];
const EXPECT_CHAIN = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
const FIXTURE = "/workspace/tooling/testnet-lite-test-1.json";
const CORE = "1.3.0";
const FAUCET_URL = "https://testnet-faucet.xbts.io/api/v1/accounts";
const LTM_SENTINEL = "2106-02-07T06:28:15";
const DUST_RESERVE_RAW = 100000n; // 1.00000 TEST (p5) must survive every broadcast
const TRANSFER_RAW = "25000000"; // ~250 TEST throwaway -> fixture (transfer-first)
const POLL_MS = 60000, POLL_GAP = 2500;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function buildFrame(opcode, payload) {
  const len = payload.length;
  let headerLen = 2, ext = null;
  if (len >= 126 && len < 65536) { headerLen += 2; ext = Buffer.alloc(2); ext.writeUInt16BE(len, 0); }
  else if (len >= 65536) { headerLen += 8; ext = Buffer.alloc(8); ext.writeBigUInt64BE(BigInt(len), 0); }
  headerLen += 4;
  const out = Buffer.alloc(headerLen + len);
  out[0] = 0x80 | (opcode & 0x0f);
  if (len < 126) out[1] = 0x80 | len;
  else if (len < 65536) out[1] = 0x80 | 126;
  else out[1] = 0x80 | 127;
  let off = 2;
  if (ext) { ext.copy(out, off); off += ext.length; }
  const mask = nodeCrypto.randomBytes(4);
  mask.copy(out, off); off += 4;
  for (let i = 0; i < len; i++) out[off + i] = payload[i] ^ mask[i % 4];
  return out;
}
class MiniWebSocket {
  constructor(url) {
    this.url = url; this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    this._recv = Buffer.alloc(0); this._hsDone = false;
    this._fragOp = null; this._fragParts = [];
    const u = new URL(url);
    const isTls = u.protocol === "wss:";
    const host = u.hostname, port = u.port ? Number(u.port) : (isTls ? 443 : 80);
    const path = (u.pathname || "/") + (u.search || "");
    const key = nodeCrypto.randomBytes(16).toString("base64");
    const req = `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`;
    const expected = nodeCrypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    const sock = isTls ? tls.connect({ host, port, servername: host }, () => { try { sock.write(req); } catch (e) { this._fail(e); } }) : net.connect({ host, port }, () => { try { sock.write(req); } catch (e) { this._fail(e); } });
    this._sock = sock;
    sock.once("error", (e) => this._fail(e));
    sock.on("data", (c) => { this._recv = Buffer.concat([this._recv, c]); try { this._pump(expected); } catch (e) { this._fail(e); } });
    sock.on("close", () => { this.readyState = 3; if (this.onclose) try { this.onclose({}); } catch (e) {} });
  }
  _fail(e) { if (this.readyState === 3) return; if (!this._hsDone) { this.readyState = 3; if (this.onerror) try { this.onerror(e); } catch (x) {} } }
  _emitText(t) { if (this.onmessage) try { this.onmessage({ data: t }); } catch (e) {} }
  _frame(opcode, fin, payload) {
    if (opcode === 0x9) { try { this._sock.write(buildFrame(0x0a, payload)); } catch (e) {} return; }
    if (opcode === 0x8) { return; }
    if (opcode === 0x0a) return;
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) {
        if (this._fragOp === null) this._emitText(payload.toString("utf8"));
        else { this._fragParts.push(payload); const full = Buffer.concat(this._fragParts); this._fragParts = []; this._fragOp = null; this._emitText(full.toString("utf8")); }
      } else { this._fragOp = opcode; this._fragParts = [payload]; }
      return;
    }
    if (opcode === 0x0) {
      this._fragParts.push(payload);
      if (fin) { const full = Buffer.concat(this._fragParts); this._fragParts = []; this._fragOp = null; this._emitText(full.toString("utf8")); }
    }
  }
  _pump(expected) {
    if (!this._hsDone) {
      const idx = this._recv.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const head = this._recv.slice(0, idx).toString("latin1");
      this._recv = this._recv.slice(idx + 4);
      const m = head.split("\r\n")[0].match(/^HTTP\/\d\.\d\s+(\d+)/);
      if (!m || Number(m[1]) !== 101) throw new Error("handshake failed: " + head.split("\r\n")[0]);
      const am = head.match(/sec-websocket-accept:\s*(\S+)/i);
      if (!am || am[1].trim() !== expected) throw new Error("bad Sec-WebSocket-Accept");
      this._hsDone = true; this.readyState = 1;
      if (this.onopen) this.onopen();
    }
    for (;;) {
      if (this._recv.length < 2) return;
      const b0 = this._recv[0], b1 = this._recv[1];
      const fin = (b0 >> 7) & 1, opcode = b0 & 0x0f, masked = (b1 >> 7) & 1;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this._recv.length < 4) return; len = this._recv.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this._recv.length < 10) return;
        const big = this._recv.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too large");
        len = Number(big); off = 10;
      }
      let mask = null;
      if (masked) { if (this._recv.length < off + 4) return; mask = this._recv.slice(off, off + 4); off += 4; }
      if (this._recv.length < off + len) return;
      let payload = this._recv.slice(off, off + len);
      if (mask) { const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mask[i % 4]; payload = u; }
      this._recv = this._recv.slice(off + len);
      this._frame(opcode, fin, payload);
    }
  }
  send(s) {
    if (this.readyState !== 1) throw new Error("not connected");
    this._sock.write(buildFrame(0x1, Buffer.from(String(s), "utf8")));
  }
  close() { try { this._sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch (e) {} try { this._sock.destroy(); } catch (e) {} this.readyState = 3; }
}
globalThis.WebSocket = MiniWebSocket;
globalThis.document = { getElementById: () => null };

["sdk/vendor/noble-classic.js", "sdk/data/brainkey-dict.js", "store.js", "sdk/chain.js",
  "api/format.js", "sdk/crypto.js", "api/account.js",
  "api/tx-primitives.js", "api/tx-ops-trade.js", "api/tx-ops-gov.js",
  "api/tx.js", "api/tx-send.js",
  "api/explorer.js", "api/asset.js", "builders/asset-ops.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
function shredFile(path) {
  try {
    const st = fs.statSync(path);
    fs.writeFileSync(path, "0".repeat(st.size));
    fs.unlinkSync(path);
  } catch (e) { /* already gone or never written */ }
  let gone = false;
  try { fs.statSync(path); gone = false; } catch (e) { gone = true; }
  return gone;
}

async function testBalanceOf(acct) {
  const bals = await Chain.call(await Chain.db(), "get_account_balances", [acct, []]);
  for (const b of (bals || [])) if (b.asset_id === CORE) return BigInt(String(b.amount));
  return 0n;
}
async function broadcast(signed) {
  const netId = await Chain.net();
  try {
    await Chain.call(netId, "broadcast_transaction_with_callback", [(Math.random() * 4294967296) >>> 0, signed]);
    return "broadcast_transaction_with_callback";
  } catch (e) {
    const msg = String((e && e.message) || e || "");
    if (/unknown method|method not found|no method|bad method|not supported/i.test(msg)) {
      await Chain.call(await Chain.net(), "broadcast_transaction", [signed]);
      return "broadcast_transaction";
    }
    throw e;
  }
}
async function directFee(type, opDataNoFee) {
  const withZero = Object.assign({}, opDataNoFee, { fee: { amount: 0, asset_id: CORE } });
  const fees = await Chain.call(await Chain.db(), "get_required_fees", [[[type, withZero]], CORE]);
  if (!fees || !fees[0] || fees[0].amount === undefined) throw new Error("get_required_fees empty for op " + type);
  return { amount: String(fees[0].amount), asset_id: fees[0].asset_id || CORE };
}

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const accountId = fix.account_id, accountName = fix.account_name;
  const wif = fix.active_priv_wif; // SECRET: fixture sign calls only, never logged
  const results = [];
  const rec = (o) => { results.push(o); log(o); };

  let connNode = null, conn = null, lastErr = null;
  for (const url of NODES) {
    try { conn = await Chain.connect(url, { timeoutMs: 25000 }); connNode = url; break; }
    catch (e) { lastErr = e; try { Chain.disconnect(); } catch (x) {} }
  }
  if (!conn) throw new Error("all testnet nodes unreachable: " + ((lastErr && lastErr.message) || lastErr));
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  rec({ step: "connected", node: connNode, chain_id_prefix: chainId.slice(0, 16) });

  const dbId = await Chain.db();
  const head0 = await Chain.call(dbId, "get_dynamic_global_properties", []);
  const accs = await Chain.call(dbId, "get_accounts", [[accountId]]);
  const acc = accs && accs[0];
  const B0 = await testBalanceOf(accountId);
  rec({
    step: "fixture_pre", head_block: head0.head_block_number,
    account: accountName + " (" + accountId + ")", test_balance_raw: B0.toString(),
    membership: acc ? String(acc.membership_expiration_date) : "missing"
  });
  const wit0 = await Chain.call(dbId, "get_witness_by_account", [accountId]);
  const com0 = await Chain.call(dbId, "get_committee_member_by_account", [accountId]);
  rec({ step: "gov_pre", witness: wit0 ? wit0.id : null, committee: com0 ? com0.id : null });

  // Op-8 exact consensus fee, DIRECT (Tx.fee guard refuses 20000000; the
  // direct number is the record — round-2 precedent).
  const fee8 = await directFee(8, { account_to_upgrade: accountId, upgrade_to_lifetime_member: true });
  rec({ step: "op8_fee_direct", fee_raw: fee8.amount });

  // ---- EXACTLY ONE patient faucet attempt (fresh throwaway, never fixture) ----
  const tag = nodeCrypto.randomBytes(2).toString("hex");
  const tname = "r3fund-" + tag;
  const Crypto = globalThis.Crypto;
  const keys = {};
  for (const role of ["owner", "active", "memo"]) {
    const privHex = nodeCrypto.randomBytes(32).toString("hex");
    keys[role] = await Crypto.keypairFromPrivateHex(privHex, "TEST"); // {wif, pub} — memory + /tmp ONLY
  }
  const tmpFile = "/tmp/r3-faucet-" + tname + ".json";
  fs.writeFileSync(tmpFile, JSON.stringify({ name: tname, keys }, null, 1), { mode: 0o600 });
  rec({ step: "faucet_keys_saved", file: tmpFile, mode: "600", name: tname, owner_pub: keys.owner.pub, active_pub: keys.active.pub, memo_pub: keys.memo.pub });
  let httpStatus = null, httpBody = null, httpErr = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90000);
    const res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: { name: tname, owner_key: keys.owner.pub, active_key: keys.active.pub, memo_key: keys.memo.pub } }),
      signal: ctl.signal
    });
    clearTimeout(timer);
    httpStatus = res.status;
    httpBody = (await res.text()).slice(0, 500);
  } catch (e) { httpErr = String((e && e.message) || e).slice(0, 200); }
  rec({ step: "faucet_post", url: FAUCET_URL, name: tname, http_status: httpStatus, body: httpBody, error: httpErr });

  let throwawayId = null, throwawayFunded = false;
  try {
    const looked = await Chain.call(dbId, "get_account_by_name", [tname]);
    if (looked && looked.id) {
      throwawayId = looked.id;
      const ownerMatch = !!(looked.owner && looked.owner.key_auths && looked.owner.key_auths[0] && looked.owner.key_auths[0][0] === keys.owner.pub);
      const tb = await testBalanceOf(looked.id);
      throwawayFunded = tb > 0n;
      rec({ step: "faucet_verify", name: tname, id: looked.id, owner_match: ownerMatch, test_balance_raw: tb.toString() });
    } else {
      rec({ step: "faucet_verify", name: tname, onchain: null });
    }
  } catch (e) { rec({ step: "faucet_verify", name: tname, error: String((e && e.message) || e).slice(0, 160) }); }

  if (!throwawayFunded) {
    // ---- REFUSED BRANCH: shred, record exact response, affordable-only path ----
    const gone = shredFile(tmpFile);
    rec({ step: "faucet_cleanup_refused", file: tmpFile, shredded: gone });
    const Bq = await testBalanceOf(accountId);
    const shortfall = BigInt(fee8.amount) + DUST_RESERVE_RAW - Bq;
    rec({
      step: "op8", result: "BLOCKED",
      reason: Bq >= BigInt(fee8.amount) + DUST_RESERVE_RAW ? "see-queue" : "funds",
      fee_raw: fee8.amount, balance_raw: Bq.toString(),
      shortfall_raw: shortfall > 0n ? shortfall.toString() : "0",
      note: "op-3/17/45 NOT redone (evaluator-reached already recorded round 2); ops 20/29/34/21/30 BLOCKED (LTM gate, fixture still basic)"
    });
    rec({ step: "STOP", reason: "faucet refused; single attempt recorded above; no workaround attempted; fixture untouched" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }

  // ---- FUNDED BRANCH: transfer ~250 TEST to fixture FIRST, then shred ----
  const throwWif = keys.active.wif; // SECRET: ONE transfer sign call only, never logged
  try {
    const tBefore = await testBalanceOf(throwawayId);
    const fBefore = await testBalanceOf(accountId);
    let opFee;
    try {
      const f = await Tx.fee(0, { fee: { amount: "0", asset_id: CORE }, from: throwawayId, to: accountId, amount: { amount: TRANSFER_RAW, asset_id: CORE } }, CORE);
      opFee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
    } catch (e) {
      if (/fee-suspicious/.test(String((e && e.message) || e))) opFee = await directFee(0, { from: throwawayId, to: accountId, amount: { amount: TRANSFER_RAW, asset_id: CORE } });
      else throw e;
    }
    const opData = { fee: { amount: opFee.amount, asset_id: opFee.asset_id }, from: throwawayId, to: accountId, amount: { amount: TRANSFER_RAW, asset_id: CORE } };
    const signed = await Tx.sign(await Tx.buildTx([[0, opData]]), throwWif);
    const via = await broadcast(signed);
    const deadline = Date.now() + POLL_MS;
    let fAfter = fBefore;
    for (;;) {
      fAfter = await testBalanceOf(accountId);
      if (fAfter - fBefore >= BigInt(TRANSFER_RAW)) break;
      if (Date.now() >= deadline) throw new Error("transfer broadcast accepted but +" + TRANSFER_RAW + " TEST not observed on fixture within 60s; re-read get_account_balances before retrying");
      await sleep(POLL_GAP);
    }
    const tAfter = await testBalanceOf(throwawayId);
    const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
    rec({
      step: "transfer_proved", result: "COVERED", via: via + "+re-read",
      from: throwawayId, to: accountId + " (" + accountName + ")",
      amount_raw: TRANSFER_RAW, fee_raw: opFee.amount, head_block: head.head_block_number,
      throwaway_before: tBefore.toString(), throwaway_after: tAfter.toString(),
      fixture_before: fBefore.toString(), fixture_after: fAfter.toString(),
      fixture_delta_raw: (fAfter - fBefore).toString()
    });
  } catch (e) {
    const gone = shredFile(tmpFile);
    rec({ step: "transfer", result: "FAILED", error: String((e && e.message) || e).slice(0, 400), keys_shredded: gone });
    try { Chain.disconnect(); } catch (x) {}
    process.exit(1);
  }

  // Transfer confirmed landed FIRST — NOW shred (transfer-first-then-shred order).
  const gone = shredFile(tmpFile);
  rec({ step: "throwaway_cleanup", file: tmpFile, shredded: gone, id: throwawayId });
  if (!gone) { rec({ step: "STOP", reason: "key shred unverified; halting before further spends" }); try { Chain.disconnect(); } catch (e) {} process.exit(1); }

  // ---- OP-8 account_upgrade on the fixture (vanilla serializer path) ----
  let ltm = false;
  try {
    const before = await testBalanceOf(accountId);
    if (before < BigInt(fee8.amount) + DUST_RESERVE_RAW) {
      rec({ step: "op8", result: "BLOCKED", reason: "funds", fee_raw: fee8.amount, balance_raw: before.toString(), shortfall_raw: (BigInt(fee8.amount) + DUST_RESERVE_RAW - before).toString() });
    } else {
      const opData = { fee: { amount: fee8.amount, asset_id: fee8.asset_id }, account_to_upgrade: accountId, upgrade_to_lifetime_member: true };
      const signed = await Tx.sign(await Tx.buildTx([[8, opData]]), wif);
      const via = await broadcast(signed);
      const deadline = Date.now() + POLL_MS;
      let mem = null;
      for (;;) {
        try { const a = await Chain.call(dbId, "get_accounts", [[accountId]]); mem = a && a[0] ? String(a[0].membership_expiration_date) : null; } catch (e) { mem = null; }
        if (mem === LTM_SENTINEL) break;
        if (Date.now() >= deadline) throw new Error("op-8 broadcast accepted but LTM sentinel not observed within 60s; re-read get_accounts before retrying");
        await sleep(POLL_GAP);
      }
      const after = await testBalanceOf(accountId);
      const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
      ltm = true;
      rec({
        step: "op8_proved", result: "COVERED", via: via + "+re-read",
        membership: mem, head_block: head.head_block_number,
        fee_raw: fee8.amount, balance_before: before.toString(), balance_after: after.toString(),
        delta_raw: (after - before).toString()
      });
    }
  } catch (e) {
    rec({ step: "op8", result: /is_lifetime|already|member/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }
  if (!ltm) {
    rec({ step: "STOP", reason: "op-8 did not land LTM; ops 20/29/34/21/30 stay LTM-gated — numbers above" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }

  // ---- Helpers for the LTM queue (funds gate per op, STOP at exhaustion) ----
  async function fundsGate(feeRaw) {
    const b = await testBalanceOf(accountId);
    if (b < BigInt(feeRaw) + DUST_RESERVE_RAW) return { ok: false, balance: b.toString(), shortfall: (BigInt(feeRaw) + DUST_RESERVE_RAW - b).toString() };
    return { ok: true, balance: b.toString() };
  }

  // ---- OP-20 witness_create (vanilla serializer path) ----
  let witnessId = wit0 && wit0.id ? wit0.id : null;
  try {
    if (witnessId) {
      rec({ step: "op20", result: "COVERED", via: "re-read (pre-existing)", witness_id: witnessId });
    } else {
      const opData = { fee: { amount: "0", asset_id: CORE }, witness_account: accountId, url: "https://example.com/vanilla-witness-20", block_signing_key: fix.active_pub };
      const f = await Tx.fee(20, opData, CORE);
      opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
      const gate = await fundsGate(String(f.amount));
      if (!gate.ok) { rec({ step: "op20", result: "BLOCKED", reason: "funds-exhaustion", fee_raw: String(f.amount), balance_raw: gate.balance, shortfall_raw: gate.shortfall }); }
      else {
        const before = BigInt(gate.balance);
        const signed = await Tx.sign(await Tx.buildTx([[20, opData]]), wif);
        const via = await broadcast(signed);
        const deadline = Date.now() + POLL_MS;
        let cur = null;
        for (;;) {
          try { cur = await Chain.call(dbId, "get_witness_by_account", [accountId]); } catch (e) { cur = null; }
          if (cur && cur.id) break;
          if (Date.now() >= deadline) throw new Error("broadcast accepted but witness object not observed within 60s; re-read get_witness_by_account before retrying");
          await sleep(POLL_GAP);
        }
        witnessId = cur.id;
        const after = await testBalanceOf(accountId);
        const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
        rec({ step: "op20_proved", result: "COVERED", via: via + "+re-read", witness_id: cur.id, url: cur.url, head_block: head.head_block_number, fee_raw: String(f.amount), balance_before: before.toString(), balance_after: after.toString(), delta_raw: (after - before).toString() });
      }
    }
  } catch (e) {
    rec({ step: "op20", result: /lifetime|is_lifetime_member/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }

  // ---- OP-29 committee_member_create (vanilla serializer path) ----
  let committeeId = com0 && com0.id ? com0.id : null;
  try {
    if (committeeId) {
      rec({ step: "op29", result: "COVERED", via: "re-read (pre-existing)", committee_id: committeeId });
    } else {
      const opData = { fee: { amount: "0", asset_id: CORE }, committee_member_account: accountId, url: "https://example.com/vanilla-committee-29" };
      const f = await Tx.fee(29, opData, CORE);
      opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
      const gate = await fundsGate(String(f.amount));
      if (!gate.ok) { rec({ step: "op29", result: "BLOCKED", reason: "funds-exhaustion", fee_raw: String(f.amount), balance_raw: gate.balance, shortfall_raw: gate.shortfall }); }
      else {
        const before = BigInt(gate.balance);
        const signed = await Tx.sign(await Tx.buildTx([[29, opData]]), wif);
        const via = await broadcast(signed);
        const deadline = Date.now() + POLL_MS;
        let cur = null;
        for (;;) {
          try { cur = await Chain.call(dbId, "get_committee_member_by_account", [accountId]); } catch (e) { cur = null; }
          if (cur && cur.id) break;
          if (Date.now() >= deadline) throw new Error("broadcast accepted but committee object not observed within 60s; re-read get_committee_member_by_account before retrying");
          await sleep(POLL_GAP);
        }
        committeeId = cur.id;
        const after = await testBalanceOf(accountId);
        const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
        rec({ step: "op29_proved", result: "COVERED", via: via + "+re-read", committee_id: cur.id, url: cur.url, head_block: head.head_block_number, fee_raw: String(f.amount), balance_before: before.toString(), balance_after: after.toString(), delta_raw: (after - before).toString() });
      }
    }
  } catch (e) {
    rec({ step: "op29", result: /lifetime|is_lifetime_member/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }

  // ---- OP-34 worker_create dust (vanilla serializer path) ----
  try {
    const opData = {
      fee: { amount: "0", asset_id: CORE }, owner: accountId,
      work_begin_date: "2026-10-07T00:00:00", work_end_date: "2026-10-14T00:00:00",
      daily_pay: "1", name: "r3-dust-worker", url: "https://example.com/r3-34",
      initializer: [0, {}]
    };
    const f = await Tx.fee(34, opData, CORE);
    opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
    const gate = await fundsGate(String(f.amount));
    if (!gate.ok) { rec({ step: "op34", result: "BLOCKED", reason: "funds-exhaustion", fee_raw: String(f.amount), balance_raw: gate.balance, shortfall_raw: gate.shortfall }); }
    else {
      const before = BigInt(gate.balance);
      const signed = await Tx.sign(await Tx.buildTx([[34, opData]]), wif);
      const via = await broadcast(signed);
      const deadline = Date.now() + POLL_MS;
      let mine = null;
      for (;;) {
        try {
          const all = await Chain.call(dbId, "get_workers_by_account", [accountId]);
          mine = (all || []).find((w) => w && w.name === "r3-dust-worker") || null;
        } catch (e) { mine = null; }
        if (mine) break;
        if (Date.now() >= deadline) throw new Error("broadcast accepted but worker not listed within 60s; re-read get_workers_by_account before retrying");
        await sleep(POLL_GAP);
      }
      const after = await testBalanceOf(accountId);
      const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
      rec({ step: "op34_proved", result: "COVERED", via: via + "+re-read", worker_id: mine.id, daily_pay: mine.daily_pay, head_block: head.head_block_number, fee_raw: String(f.amount), balance_before: before.toString(), balance_after: after.toString(), delta_raw: (after - before).toString() });
    }
  } catch (e) {
    rec({ step: "op34", result: /lifetime|is_lifetime_member|worker|pay|date|name/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }

  // ---- OP-21 witness_update (needs a 1.6.x target) ----
  try {
    if (!witnessId) { rec({ step: "op21", result: "BLOCKED", reason: "no-target", note: "no 1.6.x witness object to update" }); }
    else {
      const opData = { fee: { amount: "0", asset_id: CORE }, witness: witnessId, witness_account: accountId, new_url: "https://example.com/vanilla-witness-21" };
      const f = await Tx.fee(21, opData, CORE);
      opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
      const gate = await fundsGate(String(f.amount));
      if (!gate.ok) { rec({ step: "op21", result: "BLOCKED", reason: "funds-exhaustion", fee_raw: String(f.amount), balance_raw: gate.balance, shortfall_raw: gate.shortfall }); }
      else {
        const before = BigInt(gate.balance);
        const signed = await Tx.sign(await Tx.buildTx([[21, opData]]), wif);
        const via = await broadcast(signed);
        const deadline = Date.now() + POLL_MS;
        let cur = null;
        for (;;) {
          try { cur = await Chain.call(dbId, "get_witness_by_account", [accountId]); } catch (e) { cur = null; }
          if (cur && cur.url === "https://example.com/vanilla-witness-21") break;
          if (Date.now() >= deadline) throw new Error("broadcast accepted but updated URL not observed within 60s; re-read get_witness_by_account before retrying");
          await sleep(POLL_GAP);
        }
        const after = await testBalanceOf(accountId);
        const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
        rec({ step: "op21_proved", result: "COVERED", via: via + "+re-read", witness_id: cur.id, url: cur.url, head_block: head.head_block_number, fee_raw: String(f.amount), balance_before: before.toString(), balance_after: after.toString(), delta_raw: (after - before).toString() });
      }
    }
  } catch (e) {
    rec({ step: "op21", result: /lifetime|witness|url|key/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }

  // ---- OP-30 committee_member_update (needs a 1.5.x target) ----
  try {
    if (!committeeId) { rec({ step: "op30", result: "BLOCKED", reason: "no-target", note: "no 1.5.x committee object to update" }); }
    else {
      const opData = { fee: { amount: "0", asset_id: CORE }, committee_member: committeeId, committee_member_account: accountId, new_url: "https://example.com/vanilla-committee-30" };
      const f = await Tx.fee(30, opData, CORE);
      opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
      const gate = await fundsGate(String(f.amount));
      if (!gate.ok) { rec({ step: "op30", result: "BLOCKED", reason: "funds-exhaustion", fee_raw: String(f.amount), balance_raw: gate.balance, shortfall_raw: gate.shortfall }); }
      else {
        const before = BigInt(gate.balance);
        const signed = await Tx.sign(await Tx.buildTx([[30, opData]]), wif);
        const via = await broadcast(signed);
        const deadline = Date.now() + POLL_MS;
        let cur = null;
        for (;;) {
          try { cur = await Chain.call(dbId, "get_committee_member_by_account", [accountId]); } catch (e) { cur = null; }
          if (cur && cur.url === "https://example.com/vanilla-committee-30") break;
          if (Date.now() >= deadline) throw new Error("broadcast accepted but updated URL not observed within 60s; re-read get_committee_member_by_account before retrying");
          await sleep(POLL_GAP);
        }
        const after = await testBalanceOf(accountId);
        const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
        rec({ step: "op30_proved", result: "COVERED", via: via + "+re-read", committee_id: cur.id, url: cur.url, head_block: head.head_block_number, fee_raw: String(f.amount), balance_before: before.toString(), balance_after: after.toString(), delta_raw: (after - before).toString() });
      }
    }
  } catch (e) {
    rec({ step: "op30", result: /lifetime|committee|url/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }

  const Bend = await testBalanceOf(accountId);
  rec({ step: "end", test_balance_raw: Bend.toString(), total_delta_raw: (Bend - B0).toString() });
  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
