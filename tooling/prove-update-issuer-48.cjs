#!/usr/bin/env node
/* prove-update-issuer-48.cjs — testnet pin: self-update of AFKTEST10 is
 * consensus-ILLEGAL, and the two keys fail differently.
 *
 * Positive proof is impossible without harm: moving AFKTEST10's issuer away
 * from lite-test-1 would strand the shared fixture (only the NEW issuer can
 * move it back), and minting a throwaway asset for a sacrificial transfer
 * costs 200.07 TEST in create fees (queried live 2026-09-30) against a
 * 38.49 TEST fixture balance. So this script pins the consensus behavior
 * with the REAL vanilla op-48 path (AssetOps.buildUpdateIssuer +
 * AssetOps.fee via get_required_fees + Tx.buildTx + Tx.sign) twice:
 *   (a) owner-signed self-update  -> EXACT `issuer != new_issuer` from
 *       asset_ops.cpp validate() (proves our bytes deserialized with the
 *       field values we set: issuer / asset_to_update / new_issuer parsed);
 *   (b) active-signed self-update -> the node's exact authority answer for
 *       an owner-gated op (recorded, whatever it is — documents whether
 *       validate or auth runs first).
 * FINDING (2026-09-30, head ~100989922): BOTH keys get the SAME
 * `issuer != new_issuer` assert — validate() runs BEFORE the authority
 * check on this node, so the owner-key rule is NOT observable here and
 * rests on #4 asset_ops.hpp:580-584 alone (get_required_owner_authorities
 * inserts issuer, active set empty). The bytes still prove themselves:
 * reaching validate() means the node deserialized our field values.
 * Exit 0 iff (a) matches the expected assert; (b) is logged verbatim.
 * Rejected broadcasts never include, so no fee is charged either way.
 *
 * Runs the unmodified vanilla sources in Node with a minimal stdlib WebSocket
 * polyfill (adapted from tooling/ws-probe.mjs). Secrets: reads
 * /workspace/tooling/testnet-lite-test-1.json and uses owner/active WIFs
 * ONLY in the sign calls — never printed or logged.
 *
 * Usage: node /workspace/tooling/prove-update-issuer-48.cjs
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
const SYMBOL = "AFKTEST10";
const ASSET_ID = "1.3.1849";
const AMOUNT_HUMAN = "0.1";
const CORE_PRECISION = 5;
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
  const ownerWif = fix.owner_priv_wif;
  const activeWif = fix.active_priv_wif;
  if (!fromId || !ownerWif || !activeWif) throw new Error("fixture missing account_id/owner_priv_wif/active_priv_wif");
  const conn = await Chain.connect(NODE_URL, { timeoutMs: 25000 });
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: NODE_URL, chain_id_prefix: chainId.slice(0, 16) });
  const dbId = await Chain.db();
  const rows = await Chain.call(dbId, "lookup_asset_symbols", [[SYMBOL]]);
  const a = rows && rows[0];
  if (!a || a.id !== ASSET_ID) throw new Error("unexpected asset id: " + (a && a.id));
  if (a.issuer !== fromId) throw new Error("fixture is not the issuer: " + a.issuer);
  log({ step: "before", symbol: SYMBOL, id: a.id, issuer: a.issuer });
  const pair = AssetOps.buildUpdateIssuer({
    issuerId: fromId, assetId: a.id, newIssuerId: fromId
  });
  if (pair[0] !== 48) throw new Error("builder op id wrong: " + pair[0]);
  const f = await AssetOps.fee(pair, "1.3.0");
  pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
  log({ step: "fee", amount: f.amount, asset_id: f.asset_id });
  const unsigned = await Tx.buildTx([pair]);
  const netId = await Chain.net();
  async function tryBroadcast(wif) {
    const signed = await Tx.sign(unsigned, wif);
    try {
      await Chain.call(netId, "broadcast_transaction", [signed]);
      return { accepted: true };
    } catch (e) {
      return { accepted: false, error: (e && e.message) || String(e) };
    }
  }
  const ownerR = await tryBroadcast(ownerWif);
  log({ step: "owner_signed_self_update", accepted: ownerR.accepted,
    error: ownerR.error || null });
  const activeR = await tryBroadcast(activeWif);
  log({ step: "active_signed_self_update", accepted: activeR.accepted,
    error: activeR.error || null });
  if (ownerR.accepted) throw new Error("UNEXPECTED: self-update accepted (consensus changed?)");
  if (!/issuer != new_issuer/.test(ownerR.error || "")) {
    throw new Error("UNEXPECTED owner error (wanted `issuer != new_issuer`): " + ownerR.error);
  }
  log({ step: "pinned", owner_assert: "issuer != new_issuer (asset_ops.cpp validate)",
    active_answer: activeR.accepted ? "accepted?!" : activeR.error });
  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
