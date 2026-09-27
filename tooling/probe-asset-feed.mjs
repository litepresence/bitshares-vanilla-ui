#!/usr/bin/env node
/* probe-asset-feed.mjs — one-off read-only chain probe for slice-10 B1 reconcile.
 * Stdlib only (TLS + hand-rolled RFC6455 framing, copied from ws-probe.mjs).
 * No keys, no signing, no broadcast — pure reads.
 * Usage: node tooling/probe-asset-feed.mjs wss://testnet.xbts.io/ws AFKTESTM11
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2] || "wss://testnet.xbts.io/ws";
const symbol = process.argv[3] || "AFKTESTM11";
const OVERALL_TIMEOUT_MS = 30000;
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
  await rpc(1, "login", ["", ""]);
  const dbId = await rpc(1, "database", []);
  const chainId = await rpc(dbId, "get_chain_id", []);
  const found = await rpc(dbId, "lookup_asset_symbols", [[symbol]]);
  const asset = found && found[0];
  if (!asset) { console.log(JSON.stringify({ url: urlStr, chainId, symbol, found: false })); sock.destroy(); process.exit(0); }
  const want = [];
  if (asset.bitasset_data_id) want.push(asset.bitasset_data_id);
  if (asset.dynamic_asset_data_id) want.push(asset.dynamic_asset_data_id);
  const objs = want.length ? await rpc(dbId, "get_objects", [want]) : [];
  let bi = 0;
  const bitasset = asset.bitasset_data_id ? objs[bi++] : null;
  const dynamic = asset.dynamic_asset_data_id ? objs[bi++] : null;
  const out = {
    url: urlStr, chainId, symbol,
    asset_id: asset.id, precision: asset.precision, issuer: asset.issuer,
    bitasset_data_id: asset.bitasset_data_id || null,
    bitasset_options: bitasset ? bitasset.options : null,
    current_feed: bitasset ? bitasset.current_feed : null,
    current_supply: dynamic ? dynamic.current_supply : null,
  };
  clearTimeout(overallTimer);
  console.log(JSON.stringify(out, null, 1));
  try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {}
  sock.destroy();
  process.exit(0);
}
main().catch(fail);
