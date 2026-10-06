#!/usr/bin/env node
/* prove-op77-update.cjs — testnet proof for op-77 limit_order_update.
 *
 * What it owns: connect to testnet, re-read the fixture's own open orders,
 * and — ONLY if the fixture already has an open order plus fee dust —
 * submit an expiry-only update (new_expiration, no funds move) built by the
 * REAL vanilla path (zero-placeholder op + Tx.buildTx + Tx.feeMulti via
 * get_required_fees + Tx.sign), then prove inclusion by re-reading the
 * order. Otherwise it records PROOF-BLOCKED honestly and moves nothing.
 * Verdict source: docs/parity/deferred-verdicts.md Q1 (IMPLEMENT, in-place
 * update; send >=1 changed field — an expiry-only update qualifies).
 *
 * Runs the unmodified vanilla sources in Node with a minimal stdlib
 * WebSocket polyfill (adapted from tooling/ws-probe.mjs, same shape as
 * tooling/prove-settle-17.cjs). Secrets: reads
 * /workspace/tooling/testnet-lite-test-1.json and uses active_priv_wif ONLY
 * in the sign call — never printed or logged. Testnet ONLY, never mainnet.
 *
 * Exit codes: 0 = inclusion proved (or evaluator rejection pinned with the
 * exact node error — byte-proof per the porting-op-serializers contract);
 * 2 = PROOF-BLOCKED (no open order / no fee dust / no network), nothing
 * sent; 1 = unexpected failure.
 *
 * Usage: node /workspace/tooling/prove-op77-update.cjs
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const tls = require("tls");
const net = require("net");
const nodeCrypto = require("crypto");
const V = "/workspace/vanilla/js/";
const NODE_URL = "wss://testnet.xbts.io/ws";
const EXPECT_CHAIN = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
const FIXTURE = "/workspace/tooling/testnet-lite-test-1.json";
const FEE_ASSET = "1.3.0";
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
  "api/format.js", "sdk/crypto.js", "api/account.js", "api/tx.js", "api/tx-send.js",
  "api/explorer.js", "api/asset.js", "builders/asset-ops.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});
function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const fromId = fix.account_id;
  const wif = fix.active_priv_wif;
  if (!fromId || !wif) throw new Error("fixture missing account_id/active_priv_wif");
  let conn;
  try {
    conn = await Chain.connect(NODE_URL, { timeoutMs: 25000 });
  } catch (e) {
    log({ step: "PROOF-BLOCKED", reason: "no network route to testnet from this host",
      node: NODE_URL, error: (e && e.message) || String(e) });
    process.exit(2);
  }
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: NODE_URL, chain_id_prefix: chainId.slice(0, 16) });
  const dbId = await Chain.db();
  const orders = await Chain.call(dbId, "get_limit_orders_by_account", [fromId, 100]);
  const mine = (orders || []).filter((o) => o && o.id && /^1\.7\.\d+$/.test(String(o.id)));
  log({ step: "orders", account: fromId, open_orders: mine.map((o) => o.id) });
  if (mine.length === 0) {
    log({ step: "PROOF-BLOCKED", reason: "fixture account has no open orders to update (dust update needs a fixture-owned 1.7.x)",
      account: fromId });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(2);
  }
  const bals = await Chain.call(dbId, "get_account_balances", [fromId, [FEE_ASSET]]);
  let feeBal = "0";
  for (const b of (bals || [])) {
    if (b.asset_id === FEE_ASSET) feeBal = String(b.amount);
  }
  if (!/^\d+$/.test(feeBal) || BigInt(feeBal) < 100000n) {
    log({ step: "PROOF-BLOCKED", reason: "fixture lacks fee dust for an op-77 fee",
      account: fromId, fee_balance_raw: feeBal, fee_asset: FEE_ASSET });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(2);
  }
  // Least-invasive real update: push this order's expiration 30 days out.
  // No funds move; exactly one optional is set (>=1 changed field rule).
  const target = mine[0];
  const oldExp = String(target.expiration);
  const oldMs = new Date(oldExp + "Z").getTime();
  if (!isFinite(oldMs)) throw new Error("order has unparseable expiration: " + oldExp);
  const newWire = new Date(oldMs + 30 * 24 * 3600 * 1000).toISOString().slice(0, -5);
  log({ step: "target", order: target.id, seller: target.seller,
    old_expiration: oldExp, new_expiration: newWire, fee_balance_raw: feeBal });
  const pair = [Tx.OP.limit_order_update, {
    fee: { amount: 0, asset_id: FEE_ASSET },
    seller: fromId,
    order: String(target.id),
    new_price: null,
    delta_amount_to_sell: null,
    new_expiration: newWire,
    on_fill: null,
    extensions: []
  }];
  if (pair[0] !== 77) throw new Error("builder op id wrong: " + pair[0]);
  const unsigned = await Tx.buildTx([pair]);
  const feeRes = await Tx.feeMulti(unsigned.operations, FEE_ASSET);
  log({ step: "fee", total_raw: feeRes.totalRaw, display: feeRes.totalDisplay });
  const signed = await Tx.sign(unsigned, wif);
  const netId = await Chain.net();
  let answer;
  try {
    await Chain.call(netId, "broadcast_transaction", [signed]);
    answer = { accepted: true };
  } catch (e) {
    answer = { accepted: false, error: (e && e.message) || String(e) };
  }
  log({ step: "broadcast77", accepted: answer.accepted,
    error: (answer.error || "").slice(0, 300) });
  if (!answer.accepted) {
    // A validate/evaluate-stage rejection with the exact node error still
    // proves the bytes deserialized (evaluator cites live in market_evaluator).
    log({ step: "node-answer", assert: "bytes reached the evaluator; exact error above" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(1);
  }
  const deadline = Date.now() + 30000;
  let proved = null, head = 0;
  while (Date.now() < deadline) {
    const rows = await Chain.call(await Chain.db(), "get_limit_orders_by_account", [fromId, 100]);
    const cur = (rows || []).find((o) => o && o.id === String(target.id));
    if (!cur) { proved = { gone: true }; break; }
    if (String(cur.expiration) === newWire) { proved = { updated: true }; break; }
    await sleep(2500);
  }
  const props = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
  head = (props && props.head_block_number) || 0;
  log({ step: "proved", result: proved, head_block: head,
    order: String(target.id), old_expiration: oldExp, new_expiration: newWire,
    fee_raw: feeRes.totalRaw, fee_display: feeRes.totalDisplay });
  if (!proved) throw new Error("update broadcast but new expiration not observed within 30s");
  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
