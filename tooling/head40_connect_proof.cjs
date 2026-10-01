/* head40_connect_proof.cjs — live connect proof for the 40-hex fix.
 *
 * What it owns: Chain.connect to testnet with the REAL vanilla/js/sdk/chain.js in
 *   Node (stdlib MiniWebSocket polyfill, same shape as the prove_* scripts),
 *   proving the bad-head-shape rejection is gone and the socket stays open.
 * Consumes: Chain.connect/db/call/status only. No fixture, no secrets.
 * Globals/side effects: polyfills globalThis.WebSocket + document stub.
 * Created by: 40-hex signing-restore task.
 *
 * Usage: node /workspace/tooling/head40_connect_proof.cjs
 * Exit 0 connected + stayed open (40-hex head observed), 1 otherwise.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const tls = require("tls");
const net = require("net");
const nodeCrypto = require("crypto");

const V = "/workspace/vanilla/js/";
const NODES = ["wss://testnet.xbts.io/ws", "wss://testnet.dex.trading/"];
const EXPECT_PREFIX = "39f5e2ede1f8bc1a";

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
    const req = `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n` +
      `Origin: http://${host}\r\n\r\n`;
    const expected = nodeCrypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    const sock = isTls
      ? tls.connect({ host, port, servername: host }, () => { try { sock.write(req); } catch (e) { this._fail(e); } })
      : net.connect({ host, port }, () => { try { sock.write(req); } catch (e) { this._fail(e); } });
    this._sock = sock;
    try { sock.setNoDelay(true); } catch (e) {}
    sock.once("error", (e) => this._fail(e));
    sock.on("data", (c) => { this._recv = Buffer.concat([this._recv, c]); try { this._pump(expected); } catch (e) { this._fail(e); } });
    sock.on("close", () => { this.readyState = 3; if (this.onclose) { try { this.onclose({}); } catch (e) {} } });
  }
  _fail(e) {
    if (this.readyState === 3) return;
    if (!this._hsDone) { this.readyState = 3; if (this.onerror) { try { this.onerror(e); } catch (x) {} } }
  }
  _emitText(text) { if (this.onmessage) { try { this.onmessage({ data: text }); } catch (e) {} } }
  _frame(opcode, fin, payload) {
    if (opcode === 0x9) { try { this._sock.write(buildFrame(0x0a, payload)); } catch (e) {} return; }
    if (opcode === 0x8) { try { this._sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch (e) {} return; }
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

["sdk/chain.js", "store.js"].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function tryNode(url) {
  const t0 = Date.now();
  let conn;
  try {
    conn = await Chain.connect(url, { timeoutMs: 25000 });
  } catch (e) {
    return { url, ok: false, error: String((e && e.message) || e) };
  }
  const st = Chain.status();
  const chainId = st.chainId || conn.chainId;
  if (!chainId || chainId.slice(0, 16) !== EXPECT_PREFIX) {
    try { Chain.disconnect(); } catch (e) {}
    return { url, ok: false, error: "chain-id mismatch: " + chainId };
  }
  const dbId = await Chain.db();
  const props = await Chain.call(dbId, "get_dynamic_global_properties", []);
  const idLen = props && props.head_block_id ? props.head_block_id.length : -1;
  const headOk = props && Number.isSafeInteger(props.head_block_number) && props.head_block_number > 0 &&
    typeof props.head_block_id === "string" && /^[0-9a-fA-F]{40}$/.test(props.head_block_id);
  // stay-open: 6s without close (heartbeat covers, no bad-head-shape drop)
  await sleep(6000);
  const st2 = Chain.status();
  const stayed = st2 && st2.state === "open";
  const out = {
    step: "connected", node: url, chain_id_prefix: chainId.slice(0, 16),
    latencyMs: conn.latencyMs, head_block: props.head_block_number,
    head_id_len: idLen, head_id_prefix: String(props.head_block_id || "").slice(0, 8),
    stayed_open_6s: stayed, state: st2.state, elapsedMs: Date.now() - t0,
  };
  try { Chain.disconnect(); } catch (e) {}
  await sleep(500);
  if (!headOk) return { url, ok: false, error: "head shape not 40-hex: " + JSON.stringify({ n: props.head_block_number, len: idLen }) };
  if (!stayed) return { url, ok: false, error: "did not stay open (state=" + st2.state + ")" };
  log(out);
  return { url, ok: true };
}

(async function main() {
  for (const url of NODES) {
    const r = await tryNode(url);
    if (r.ok) {
      console.log(JSON.stringify({ step: "done", result: "connect GREEN on " + url }));
      process.exit(0);
    } else {
      console.log(JSON.stringify({ step: "node_failed", node: url, error: r.error }));
      try { Chain.disconnect(); } catch (e) {}
      await sleep(1000);
    }
  }
  console.log(JSON.stringify({ step: "FAILED", error: "no testnet node connected" }));
  process.exit(1);
})().catch((e) => { console.log(JSON.stringify({ step: "FAILED", error: String((e && e.message) || e) })); process.exit(1); });
