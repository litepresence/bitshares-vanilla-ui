#!/usr/bin/env node
/* prove-settle-17.cjs — testnet pin: force-settle dust of AFKTESTM11 is
 * consensus-IMPOSSIBLE right now, and the node says exactly why.
 *
 * Positive proof needs BOTH a working price feed AND a bitasset position:
 *   - feed: AFKTESTM11's bitasset carries 1 feed but NO usable median
 *     (current_feed.settlement_price is 0/0; the evaluator answers
 *     `insufficient feeds`, asset_evaluator.cpp:1179, code 37006);
 *     re-feeding (op-19) plus borrowing (op-3, slice-13 collateral flow)
 *     to mint a position is slice-13 territory, not smuggled in here.
 *   - position: the fixture holds 0 MPA and MPAs can NOT be manually
 *     issued (`!a.is_market_issued(): Cannot manually issue a
 *     market-issued asset`, asset_evaluator.cpp:344 — pinned by the
 *     attempt inside this task's investigation).
 * So this script pins the consensus answer with the REAL vanilla op-17
 * path (AssetOps.buildSettle + AssetOps.fee via get_required_fees +
 * Tx.buildTx + Tx.sign): settling 0.0025 AFKTESTM11 dust with no position
 * must fail with EXACTLY `insufficient feeds` (feed gate runs before the
 * balance gate). Reaching do_evaluate proves our bytes deserialized with
 * the field values we set. Exit 0 on that exact error; non-zero otherwise.
 * Rejected broadcasts never include, so no fee is charged.
 * UI follow-up: borrow-page settle form once slice-13 owns positions.
 *
 * Runs the unmodified vanilla sources in Node with a minimal stdlib WebSocket
 * polyfill (adapted from tooling/ws-probe.mjs). Secrets: reads
 * /workspace/tooling/testnet-lite-test-1.json and uses active_priv_wif ONLY
 * in the sign call — never printed or logged.
 *
 * Usage: node /workspace/tooling/prove-settle-17.cjs
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
const SYMBOL = "AFKTESTM11";
const ASSET_ID = "1.3.1850";
const AMOUNT_HUMAN = "0.0025";
const MPA_PRECISION = 4;
const FIXTURE = "/workspace/tooling/testnet-lite-test-1.json";
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
async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const fromId = fix.account_id;
  const wif = fix.active_priv_wif;
  if (!fromId || !wif) throw new Error("fixture missing account_id/active_priv_wif");
  const t0 = Date.now();
  const conn = await Chain.connect(NODE_URL, { timeoutMs: 25000 });
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: NODE_URL, chain_id_prefix: chainId.slice(0, 16) });
  const dbId = await Chain.db();
  const rows = await Chain.call(dbId, "lookup_asset_symbols", [[SYMBOL]]);
  const a = rows && rows[0];
  if (!a || a.id !== ASSET_ID) throw new Error("unexpected asset id: " + (a && a.id));
  if (a.issuer !== fromId) throw new Error("fixture is not the issuer: " + a.issuer);
  if (!a.bitasset_data_id) throw new Error("not a bitasset: " + SYMBOL);
  const raw = Format.parseAmount(AMOUNT_HUMAN, MPA_PRECISION);
  async function mpaBalance() {
    const bals = await Chain.call(await Chain.db(), "get_account_balances", [fromId, [a.id]]);
    for (const b of (bals || [])) {
      if (b.asset_id === a.id) return String(b.amount);
    }
    return "0";
  }
  log({ step: "before", symbol: SYMBOL, id: a.id, issuer: a.issuer,
    mpa_balance: await mpaBalance(), settle_human: AMOUNT_HUMAN, settle_raw: raw });
  // No feed + no position: pin the exact consensus answer (no broadcast
  // without learning; the rejection itself is the proof the bytes parse).
  const pair = AssetOps.buildSettle({
    accountId: fromId, assetId: a.id, amountHuman: AMOUNT_HUMAN, precision: MPA_PRECISION
  });
  if (pair[0] !== 17) throw new Error("builder op id wrong: " + pair[0]);
  const f = await AssetOps.fee(pair, "1.3.0");
  pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
  log({ step: "fee", amount: f.amount, asset_id: f.asset_id });
  const unsigned = await Tx.buildTx([pair]);
  const netId = await Chain.net();
  const signed = await Tx.sign(unsigned, wif);
  let answer;
  try {
    await Chain.call(netId, "broadcast_transaction", [signed]);
    answer = { accepted: true };
  } catch (e) {
    answer = { accepted: false, error: (e && e.message) || String(e) };
  }
  log({ step: "settle17", accepted: answer.accepted,
    error: (answer.error || "").slice(0, 300) });
  if (answer.accepted) throw new Error("UNEXPECTED: settle accepted (feed/position appeared?)");
  if (!/insufficient feeds/.test(answer.error || "")) {
    throw new Error("UNEXPECTED settle error (wanted `insufficient feeds`): " + (answer.error || "").slice(0, 200));
  }
  log({ step: "pinned", assert: "insufficient feeds (asset_evaluator.cpp:1179 do_evaluate)",
    also_blocked: "position: !a.is_market_issued() (asset_evaluator.cpp:344)" });
  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
