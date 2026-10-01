#!/usr/bin/env node
/* prove-trollbox-post.cjs — testnet proof: exactly ONE op-35 trollbox post (sub-id 9199,
 * value <= 200 bytes) from the lite-test-1 fixture via the REAL vanilla path (Trollbox.buildPost
 * + Tx.fee via get_required_fees + Tx.buildTx + Tx.sign + broadcast), then storage read-back
 * match via Trollbox.fetchChannelMessages (get_storage_info pager).
 *
 * Runs the unmodified vanilla sources in Node with the stdlib WebSocket polyfill shared by
 * tooling/prove-feepool-fund-16.cjs (copied lines, same handshake). Secrets: reads
 * /workspace/tooling/testnet-lite-test-1.json and uses active_priv_wif ONLY in the sign call.
 * ONE post attempt only — a broadcast failure exits non-zero with NO retry loop (re-running
 * this script would post again, so a FAILED run is investigated before any re-run).
 * Exit 0 = posted + read back + content match; exit 3 = STOP (funds short or no plugin node:,
 * tester-queued, zero cost); exit 1 = failure.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const tls = require("tls");
const net = require("net");
const nodeCrypto = require("crypto");
const V = "/workspace/vanilla/js/";
const FIXTURE = "/workspace/tooling/testnet-lite-test-1.json";
const NODES = ["wss://testnet.xbts.io/ws", "wss://testnet.dex.trading/"];
const EXPECT_CHAIN = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
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
["sdk/vendor/noble-classic.js", "sdk/data/brainkey-dict.js", "store.js", "sdk/chain.js",
  "api/format.js", "sdk/crypto.js", "api/account.js", "api/tx.js", "api/tx-send.js",
  "builders/trollbox.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});
function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const fromId = fix.account_id;
  const fromName = fix.account_name;
  const wif = fix.active_priv_wif;
  if (!fromId || !wif) throw new Error("fixture missing account_id/active_priv_wif");
  const t0 = Date.now();
  // Connect (primary, then fallback). Chain-id pinned like all prove scripts.
  let connNode = null, conn = null, lastErr = null;
  for (const url of NODES) {
    try {
      conn = await Chain.connect(url, { timeoutMs: 25000 });
      connNode = url;
      break;
    } catch (e) { lastErr = e; try { Chain.disconnect(); } catch (x) {} }
  }
  if (!conn) throw new Error("all testnet nodes unreachable: " + ((lastErr && lastErr.message) || lastErr));
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: connNode, chain_id_prefix: chainId.slice(0, 16) });
  // STOP gate 1: fixture funds. Custom-op fee ~= 1 TEST (100000 + kbyte surcharge);
  // require >= 2 TEST so one post + margin never strands the fixture.
  const dbId = await Chain.db();
  const bals = await Chain.call(dbId, "get_account_balances", [fromId, []]);
  let testRaw = 0n;
  for (const b of (bals || [])) {
    if (b && b.asset_id === "1.3.0") { try { testRaw = BigInt(String(b.amount)); } catch (e) {} }
  }
  log({ step: "balance", account: fromName + " (" + fromId + ")", test_raw: testRaw.toString() });
  if (testRaw < 200000n) {
    log({ step: "STOP", reason: "fixture funds short (< 2.00000 TEST); broadcast tester-queued, zero cost, nothing spent" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }
  // Probe the custom_operations plugin on THIS node (reads need it; broadcast works from any).
  let probe = null;
  try { probe = await Trollbox.probe(); } catch (e) { probe = { supported: false, reason: "error" }; }
  log({ step: "probe", supported: !!(probe && probe.supported), reason: (probe && probe.reason) || null });
  if (!(probe && probe.supported)) {
    log({ step: "STOP", reason: "custom_operations plugin unavailable on " + connNode + "; broadcast tester-queued, zero cost, nothing spent" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }
  // Live byte budget + build exactly ONE post (short text -> JSON value <= 200 bytes).
  const maxBytes = await Trollbox.fetchMaxMessageBytes();
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const text = "vanilla trollbox probe " + stamp;
  const built = Trollbox.buildPost({ payerId: fromId, username: fromName, channel: "general", lang: "en", text, maxBytes });
  const valueBytes = Trollbox.utf8Length(JSON.stringify({ v: 1, ch: "general", u: fromName, ln: "en", text }));
  log({ step: "built", catalog: built.catalog, key: built.key, value_bytes: valueBytes, budget: maxBytes });
  if (valueBytes > 200) throw new Error("fixture text too long for the <=200-byte single-post rule: " + valueBytes);
  const fee = await Tx.fee(Trollbox.CUSTOM_OP_ID, built.opData, "1.3.0");
  built.opData.fee = { amount: fee.amount, asset_id: fee.asset_id };
  log({ step: "fee", amount: String(fee.amount), asset_id: fee.asset_id,
    fee_human: Format.formatAmount(String(fee.amount), 5) });
  const unsigned = await Tx.buildTx([[Trollbox.CUSTOM_OP_ID, built.opData]]);
  const signed = await Tx.sign(unsigned, wif);
  // Single broadcast (callback-first, plain fallback) + storage read-back proof.
  const netId = await Chain.net();
  let via = "broadcast_transaction_with_callback";
  try {
    await Chain.call(netId, "broadcast_transaction_with_callback", [(Math.random() * 4294967296) >>> 0, signed]);
  } catch (e) {
    via = "broadcast_transaction";
    await Chain.call(netId, "broadcast_transaction", [signed]);
  }
  log({ step: "sent", via });
  const customId = await Chain.custom();
  const deadline = Date.now() + 45000;
  let found = null;
  while (Date.now() < deadline) {
    try {
      // Direct catalog+key lookup (#4 api.hpp note 1d) — NOT the channel
      // pager (first page holds the oldest 100 rows, would miss our key).
      const rows = await Chain.call(customId, "get_storage_info", [null, built.catalog, built.key, 1]);
      if (rows && rows.length) { found = Trollbox.decodeTrollboxValue(rows[0]); if (found) { found.id = rows[0].id; found.displayAuthor = found.author; } }
    } catch (e) { found = null; }
    if (found) break;
    await sleep(2500);
  }
  if (!found) throw new Error("broadcast accepted but the message key was not read back within 45s; check the channel before retrying (do NOT blindly rebroadcast)");
  const match = found.text === text && (found.author === fromName || found.displayAuthor === fromName);
  log({ step: "readback", storage_id: found.id, catalog: found.catalog, key: found.key,
    author: found.displayAuthor, text_match: found.text === text, author_match: (found.author === fromName || found.displayAuthor === fromName),
    via: via + "+storage-readback", elapsedMs: Date.now() - t0 });
  if (!match) throw new Error("read-back content mismatch (not counted)");
  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
