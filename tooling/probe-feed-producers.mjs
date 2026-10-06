#!/usr/bin/env node
/* probe-feed-producers.mjs — read-only chain verification for the feed-history slice.
 * Confirms producersFor() assumptions on a live node: asset options.flags
 * (witness_fed 0x80 / committee_fed 0x100), bitasset_data.feeds map shape
 * (publisher 1.2.N -> [time, price_feed]), get_witness_by_account for badges,
 * one get_account_history page (op-19 walk source), get_fill_order_history
 * (exchange overlay source), get_liquidity_pools_by_both_assets (pool overlay).
 * Stdlib only (TLS + hand-rolled RFC6455 framing, copied from ws-probe.mjs).
 * No keys, no signing, no broadcast — pure reads.
 * Usage: node tooling/probe-feed-producers.mjs wss://testnet.xbts.io/ws AFKTESTM11
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2] || "wss://testnet.xbts.io/ws";
const symbol = (process.argv[3] || "AFKTESTM11").toUpperCase();
const OVERALL_TIMEOUT_MS = 45000;
const CALL_TIMEOUT_MS = 15000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function fail(err) {
  console.log(JSON.stringify({ error: (err && err.message) ? err.message : String(err) }));
  process.exit(1);
}

let parsed;
try { parsed = new URL(urlStr); } catch (e) { fail(e); }
const isTls = parsed.protocol === "wss:";
const host = parsed.hostname;
const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
const path = (parsed.pathname || "/") + (parsed.search || "");
const overallTimer = setTimeout(() => fail(new Error("overall timeout")), OVERALL_TIMEOUT_MS);
overallTimer.unref?.();

function openSocket() {
  return new Promise((resolve, reject) => {
    let sock;
    const onError = (e) => { try { sock.destroy(); } catch {} reject(e); };
    if (isTls) sock = tls.connect({ host, port, servername: host }, () => { sock.removeListener("error", onError); resolve(sock); });
    else sock = net.connect({ host, port }, () => { sock.removeListener("error", onError); resolve(sock); });
    sock.once("error", onError);
  });
}

function buildFrame(opcode, payload) {
  const len = payload.length;
  let headerLen = 2, ext = null;
  if (len >= 126 && len < 65536) { headerLen += 2; ext = Buffer.alloc(2); ext.writeUInt16BE(len, 0); }
  else if (len >= 65536) { headerLen += 8; ext = Buffer.alloc(8); ext.writeBigUInt64BE(BigInt(len), 0); }
  headerLen += 4;
  const out = Buffer.alloc(headerLen + len);
  out[0] = 0x80 | (opcode & 0x0f);
  out[1] = len < 126 ? (0x80 | len) : len < 65536 ? (0x80 | 126) : (0x80 | 127);
  let off = 2;
  if (ext) { ext.copy(out, off); off += ext.length; }
  const mask = crypto.randomBytes(4);
  mask.copy(out, off); off += 4;
  for (let i = 0; i < len; i++) out[off + i] = payload[i] ^ mask[i % 4];
  return out;
}

async function main() {
  const sock = await openSocket();
  sock.setNoDelay(true);
  let recv = Buffer.alloc(0), handshakeDone = false, hsRes, hsRej;
  const handshakeP = new Promise((res, rej) => { hsRes = res; hsRej = rej; });
  let fragOpcode = null, fragParts = [];
  const pending = new Map();
  let nextId = 1;
  function emitText(text) {
    let msg; try { msg = JSON.parse(text); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.reject(new Error("rpc error: " + JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
  function handleFrame(opcode, fin, payload) {
    if (opcode === 0x9) { try { sock.write(buildFrame(0x0a, payload)); } catch {} return; }
    if (opcode === 0x8) { try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {} return; }
    if (opcode === 0x0a) return;
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) {
        if (fragOpcode === null) emitText(payload.toString("utf8"));
        else { fragParts.push(payload); const f = Buffer.concat(fragParts); fragParts = []; fragOpcode = null; emitText(f.toString("utf8")); }
      } else { fragOpcode = opcode; fragParts = [payload]; }
      return;
    }
    if (opcode === 0x0) { fragParts.push(payload); if (fin) { const f = Buffer.concat(fragParts); fragParts = []; fragOpcode = null; emitText(f.toString("utf8")); } }
  }
  function pump() {
    if (!handshakeDone) {
      const idx = recv.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const head = recv.slice(0, idx).toString("latin1");
      recv = recv.slice(idx + 4);
      const m = head.split("\r\n")[0].match(/^HTTP\/\d\.\d\s+(\d+)/);
      if (!m || Number(m[1]) !== 101) { hsRej(new Error("handshake failed")); return; }
      const am = head.match(/sec-websocket-accept:\s*(\S+)/i);
      const exp = crypto.createHash("sha1").update(wsKey + WS_GUID).digest("base64");
      if (!am || am[1].trim() !== exp) { hsRej(new Error("bad accept")); return; }
      handshakeDone = true; hsRes();
    }
    for (;;) {
      if (recv.length < 2) return;
      const b0 = recv[0], b1 = recv[1], fin = (b0 >> 7) & 1, opcode = b0 & 0x0f, masked = (b1 >> 7) & 1;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (recv.length < 4) return; len = recv.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (recv.length < 10) return; len = Number(recv.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (recv.length < off + 4) return; mask = recv.slice(off, off + 4); off += 4; }
      if (recv.length < off + len) return;
      let payload = recv.slice(off, off + len);
      if (mask) { const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mask[i % 4]; payload = u; }
      recv = recv.slice(off + len);
      handleFrame(opcode, fin, payload);
    }
  }
  sock.on("data", (c) => { recv = Buffer.concat([recv, c]); try { pump(); } catch (e) { if (!handshakeDone) hsRej(e); } });
  sock.on("error", () => {});
  const wsKey = crypto.randomBytes(16).toString("base64");
  sock.write(`GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${wsKey}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`);
  pump();
  await handshakeP;
  function rpc(apiId, method, params) {
    const id = nextId++;
    const body = JSON.stringify({ id, method: "call", params: [apiId, method, params || []] });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("call timeout: " + method)); }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try { sock.write(buildFrame(0x1, Buffer.from(body, "utf8"))); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }
  const out = { url: urlStr, symbol };
  await rpc(1, "login", ["", ""]);
  const dbId = await rpc(1, "database", []);
  out.chainId = await rpc(dbId, "get_chain_id", []);
  const found = await rpc(dbId, "lookup_asset_symbols", [[symbol]]);
  const asset = found && found[0];
  if (!asset) { out.found = false; throw new Error("asset not found"); }
  out.asset_id = asset.id;
  out.flags = asset.options && asset.options.flags;
  out.witness_fed = (out.flags & 128) !== 0;
  out.committee_fed = (out.flags & 256) !== 0;
  const bit = asset.bitasset_data_id
    ? (await rpc(dbId, "get_objects", [[asset.bitasset_data_id]]))[0]
    : null;
  const feeds = (bit && bit.feeds) || [];
  out.feed_count = feeds.length;
  out.feed_publishers = feeds.map((f) => ({ id: f[0], time: f[1] && f[1][0] }));
  const first = feeds[0] && feeds[0][1] && feeds[0][1][1];
  if (first && first.settlement_price) {
    out.sample_settlement = {
      base: first.settlement_price.base,
      quote: first.settlement_price.quote,
    };
  }
  if (out.feed_publishers.length) {
    try {
      const w = await rpc(dbId, "get_witness_by_account", [out.feed_publishers[0].id]);
      out.first_publisher_witness = !!w;
    } catch (e) { out.first_publisher_witness = "query-failed"; }
    let histId = null;
    try { histId = await rpc(1, "history", []); } catch (e) { histId = null; }
    out.history_api = !!histId;
    if (histId) {
      try {
        const rows = await rpc(histId, "get_account_history", [out.feed_publishers[0].id, "1.11.0", 5, "1.11.0"]);
        const ops = (rows || []).map((r) => {
          const o = Array.isArray(r) ? r[1] : r;
          return o && o.op ? o.op[0] : null;
        });
        out.first_publisher_recent_ops = ops;
      } catch (e) { out.first_publisher_recent_ops = "query-failed"; }
    }
  }
  const backing = bit && bit.options && bit.options.short_backing_asset;
  out.backing = backing || null;
  if (backing) {
    try {
      const fills = await rpc(dbId, "get_fill_order_history", [asset.id, backing, 3]);
      out.exchange_fills = (fills || []).length;
    } catch (e) { out.exchange_fills = "query-failed"; }
    try {
      const pools = await rpc(dbId, "get_liquidity_pools_by_both_assets", [asset.id, backing, 10, "1.19.0"]);
      out.pools = (pools || []).map((p) => p.id);
    } catch (e) { out.pools = "query-failed"; }
  }
  clearTimeout(overallTimer);
  console.log(JSON.stringify(out, null, 1));
  try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {}
  sock.destroy();
  process.exit(0);
}
main().catch(fail);
