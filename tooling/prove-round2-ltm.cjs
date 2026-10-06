#!/usr/bin/env node
/* prove-round2-ltm.cjs — LTM-set pre-read (ops 8/20/21/29/30) + EXACTLY ONE patient faucet attempt.
 *
 * What it owns: read-only fixture re-read (balance, membership, op-8 raw fee
 *   via DIRECT get_required_fees — bypassing the Tx.fee 5-unit guard so the
 *   exact consensus fee is recorded — witness/committee nulls) + ONE faucet
 *   POST for a FRESH throwaway name (never the fixture name) with fresh noble
 *   keys. ZERO broadcasts, ZERO fixture-key usage (WIFs never read into a
 *   variable — only account_id/pubs touched).
 * Consumes: vanilla Chain (vm-loaded, same MiniWebSocket shape as
 *   prove_witness_create_20.cjs) + Crypto.keypairFromPrivateHex for fresh keys.
 * Secrets: throwaway privkeys live in /tmp file (600-perms, saved BEFORE POST
 *   so a timeout never loses keys) + memory only; shredded after (overwrite +
 *   unlink); NEVER printed, NEVER committed.
 * Created by: testnet proof round-2 task (2026-10-06).
 *
 * Faucet discipline (precedent git show 75231c3): ONE attempt, 90s timeout,
 *   keys saved before POST, respect any rate-limit with quiet STOP — never
 *   work around anti-spam (no retry, no proxy, no second name).
 *
 * Usage: node /workspace/tooling/prove-round2-ltm.cjs
 * Exit 3 = STOP (expected: unaffordable or faucet refused); exit 1 = failure.
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
const DUST_RESERVE_RAW = 100000n;
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

["sdk/vendor/noble-classic.js", "store.js", "sdk/chain.js", "sdk/crypto.js"].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const accountId = fix.account_id, accountName = fix.account_name; // public only from here on
  let connNode = null, conn = null, lastErr = null;
  for (const url of NODES) {
    try { conn = await Chain.connect(url, { timeoutMs: 25000 }); connNode = url; break; }
    catch (e) { lastErr = e; try { Chain.disconnect(); } catch (x) {} }
  }
  if (!conn) throw new Error("all testnet nodes unreachable: " + ((lastErr && lastErr.message) || lastErr));
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: connNode, chain_id_prefix: chainId.slice(0, 16) });

  const dbId = await Chain.db();
  const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
  const accs = await Chain.call(dbId, "get_accounts", [[accountId]]);
  const acc = accs && accs[0];
  const membership = acc ? String(acc.membership_expiration_date) : "missing";
  const bals = await Chain.call(dbId, "get_account_balances", [accountId, [CORE]]);
  let balRaw = "0";
  for (const b of (bals || [])) if (b.asset_id === CORE) balRaw = String(b.amount);
  const wit = await Chain.call(dbId, "get_witness_by_account", [accountId]);
  const com = await Chain.call(dbId, "get_committee_member_by_account", [accountId]);
  log({
    step: "pre_read", head_block: head.head_block_number, head_time: head.time,
    account: accountName + " (" + accountId + ")", test_balance_raw: balRaw,
    membership, witness: wit ? wit.id : null, committee: com ? com.id : null
  });

  // Op-8 raw fee, DIRECT (bypasses the Tx.fee 5-unit guard so the exact
  // consensus fee is recorded — the guard message alone is not a number).
  const fees = await Chain.call(dbId, "get_required_fees",
    [[ [8, { fee: { amount: 0, asset_id: CORE }, account_to_upgrade: accountId, upgrade_to_lifetime_member: true } ] ], CORE]);
  const fee8 = fees && fees[0] ? String(fees[0].amount) : "MISSING";
  const affordable = BigInt(balRaw) >= BigInt(fee8) + DUST_RESERVE_RAW;
  log({
    step: "op8_fee", fee_raw: fee8, fee_human_TEST: fee8 === "MISSING" ? null : (BigInt(fee8) / 100000n).toString() + "." + (BigInt(fee8) % 100000n).toString().padStart(5, "0"),
    balance_raw: balRaw, dust_reserve_raw: DUST_RESERVE_RAW.toString(),
    shortfall_raw: fee8 === "MISSING" ? null : (BigInt(fee8) + DUST_RESERVE_RAW - BigInt(balRaw)).toString(),
    affordable
  });
  if (affordable) {
    log({ step: "UNEXPECTED", reason: "fixture can afford op-8 — upgrade path open (not expected per task brief); STOPPING without broadcast, upgrade is a separate signed step" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }

  // ---- EXACTLY ONE patient faucet attempt (fresh throwaway, never the fixture) ----
  const tag = nodeCrypto.randomBytes(2).toString("hex");
  const tname = "r2fund-" + tag;
  const Crypto = globalThis.Crypto;
  const keys = {};
  for (const role of ["owner", "active", "memo"]) {
    const privHex = nodeCrypto.randomBytes(32).toString("hex");
    const kp = await Crypto.keypairFromPrivateHex(privHex, "TEST");
    keys[role] = kp; // {wif, pub} — memory + /tmp file ONLY, never logged
  }
  const tmpFile = "/tmp/r2-faucet-" + tname + ".json";
  fs.writeFileSync(tmpFile, JSON.stringify({ name: tname, keys }, null, 1), { mode: 0o600 });
  log({ step: "faucet_keys_saved", file: tmpFile, mode: "600", name: tname, owner_pub: keys.owner.pub, active_pub: keys.active.pub, memo_pub: keys.memo.pub });
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
  log({ step: "faucet_post", url: FAUCET_URL, name: tname, http_status: httpStatus, body: httpBody, error: httpErr });
  // On-chain verify (public read, no keys).
  let onchain = null;
  try {
    const looked = await Chain.call(dbId, "get_account_by_name", [tname]);
    onchain = looked ? { id: looked.id, owner_match: !!(looked.owner && looked.owner.key_auths && looked.owner.key_auths[0] && looked.owner.key_auths[0][0] === keys.owner.pub) } : null;
  } catch (e) { onchain = { error: String((e && e.message) || e).slice(0, 160) }; }
  log({ step: "faucet_verify", name: tname, onchain });
  // Shred the /tmp key file (overwrite + unlink).
  try {
    const st = fs.statSync(tmpFile);
    fs.writeFileSync(tmpFile, "0".repeat(st.size));
    fs.unlinkSync(tmpFile);
    log({ step: "faucet_cleanup", file: tmpFile, shredded: true });
  } catch (e) { log({ step: "faucet_cleanup", file: tmpFile, shredded: false, error: String((e && e.message) || e).slice(0, 120) }); }

  log({ step: "STOP", reason: "op-8 unaffordable; single faucet attempt recorded above; no workaround attempted, nothing broadcast, fixture untouched" });
  try { Chain.disconnect(); } catch (e) {}
  process.exit(3);
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
