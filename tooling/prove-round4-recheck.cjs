#!/usr/bin/env node
/* prove-round4-recheck.cjs — read-only late-funding + final-state check for round 4.
 *
 * What it owns: public reads ONLY (ZERO broadcasts, ZERO key usage — no WIF
 *   is ever read into a variable): TEST balances of the round-4 throwaway
 *   (argv id/name, public only) and fixture 1.2.26833, plus fixture
 *   membership + witness/committee + open dust orders + head block. Answers:
 *   did late faucet funding arrive, is the fixture upgraded (LTM sentinel),
 *   and what open orders exist for the op-77 leg?
 * Consumes: vanilla Chain via vm (same MiniWebSocket shape as
 *   prove-round4-faucet-ltm.cjs); account ids/names are public.
 * Secrets: NONE touched (read-only by design).
 * Created by: testnet proof round-4 task (2026-10-06).
 *
 * Usage: node /workspace/tooling/prove-round4-recheck.cjs [throwaway-id-or-name]
 * Exit 0 with JSON-lines dump; exit 1 on connect failure.
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
const CORE = "1.3.0";
const FIXTURE_ID = "1.2.26833"; // lite-test-1 (public id only)
const LTM_SENTINEL = "2106-02-07T06:28:15";
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

["sdk/vendor/noble-classic.js", "store.js", "sdk/chain.js"].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }

async function main() {
  const throwawayRef = process.argv[2] || null; // public id (1.2.x) or name — never keys
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
  log({ step: "head", head_block: head.head_block_number, head_time: head.time });
  if (throwawayRef) {
    let tid = throwawayRef;
    try {
      if (!/^1\.2\.\d+$/.test(throwawayRef)) {
        const looked = await Chain.call(dbId, "get_account_by_name", [throwawayRef]);
        tid = looked && looked.id ? looked.id : null;
      }
      if (tid) {
        const tb = await Chain.call(dbId, "get_account_balances", [tid, []]);
        log({ step: "throwaway", ref: throwawayRef, id: tid, balances: tb });
      } else {
        log({ step: "throwaway", ref: throwawayRef, onchain: null });
      }
    } catch (e) { log({ step: "throwaway", ref: throwawayRef, error: String((e && e.message) || e).slice(0, 160) }); }
  }
  const fb = await Chain.call(dbId, "get_account_balances", [FIXTURE_ID, []]);
  log({ step: "fixture", id: FIXTURE_ID, balances: fb });
  const accs = await Chain.call(dbId, "get_accounts", [[FIXTURE_ID]]);
  const mem = accs && accs[0] ? accs[0].membership_expiration_date : "missing";
  log({ step: "fixture_membership", membership: mem, is_ltm: mem === LTM_SENTINEL });
  const wit = await Chain.call(dbId, "get_witness_by_account", [FIXTURE_ID]);
  const com = await Chain.call(dbId, "get_committee_member_by_account", [FIXTURE_ID]);
  log({ step: "fixture_gov", witness: wit ? { id: wit.id, url: wit.url } : null, committee: com ? { id: com.id, url: com.url } : null });
  try {
    const workers = await Chain.call(dbId, "get_workers_by_account", [FIXTURE_ID]);
    log({ step: "fixture_workers", workers: (workers || []).map((w) => ({ id: w.id, name: w.name })) });
  } catch (e) { log({ step: "fixture_workers", error: String((e && e.message) || e).slice(0, 120) }); }
  try {
    const orders = await Chain.call(dbId, "get_limit_orders_by_account", [FIXTURE_ID, 100]);
    log({ step: "fixture_orders", orders: (orders || []).map((o) => ({ id: o.id, expiration: o.expiration })) });
  } catch (e) { log({ step: "fixture_orders", error: String((e && e.message) || e).slice(0, 120) }); }
  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
