#!/usr/bin/env node
/* probe-history-row.mjs — dump raw get_account_history rows verbatim.
 * Diagnostic for feed-history: which timestamp fields do history rows carry?
 * Stdlib only. Read-only, no keys.
 * Usage: node tooling/probe-history-row.mjs wss://api.bitshares.dev 1.2.581357
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2] || "wss://api.bitshares.dev";
const account = process.argv[3] || "1.2.581357";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
function fail(e) { console.log("ERROR " + ((e && e.message) || e)); process.exit(1); }
const parsed = new URL(urlStr);
const isTls = parsed.protocol === "wss:";
const host = parsed.hostname;
const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
const path = (parsed.pathname || "/") + (parsed.search || "");
const overall = setTimeout(() => fail("timeout"), 30000);
overall.unref?.();
function buildFrame(op, p) {
  const out = Buffer.alloc(6 + p.length);
  out[0] = 0x80 | op; out[1] = 0x80 | (p.length < 126 ? p.length : 126);
  let off = 2;
  if (p.length >= 126) { out[1] = 0x80 | 126; out.writeUInt16BE(p.length, 2); off = 4; }
  const mask = crypto.randomBytes(4); mask.copy(out, off); off += 4;
  const f = Buffer.alloc(6 + p.length);
  f[0] = out[0]; f[1] = out[1];
  if (p.length >= 126) { out.slice(2, 4).copy(f, 2); }
  for (let i = 0; i < p.length; i++) f[off + i] = p[i] ^ mask[i % 4];
  mask.copy(f, off - 4);
  return f;
}
const sock = await (isTls
  ? new Promise((res, rej) => { const s = tls.connect({ host, port, servername: host }, () => res(s)); s.once("error", rej); })
  : new Promise((res, rej) => { const s = net.connect({ host, port }, () => res(s)); s.once("error", rej); }));
let recv = Buffer.alloc(0), done = false, hsRes, hsRej;
const hsP = new Promise((a, b) => { hsRes = a; hsRej = b; });
const pending = new Map(); let nid = 1;
function emit(t) {
  let m; try { m = JSON.parse(t); } catch { return; }
  if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t); m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result); }
}
function pump() {
  if (!done) {
    const i = recv.indexOf("\r\n\r\n");
    if (i === -1) return;
    recv = recv.slice(i + 4); done = true; hsRes(); return;
  }
  for (;;) {
    if (recv.length < 2) return;
    const b0 = recv[0], b1 = recv[1], op = b0 & 15, fin = b0 >> 7;
    let len = b1 & 127, off = 2;
    if (len === 126) { len = recv.readUInt16BE(2); off = 4; }
    if (recv.length < off + len) return;
    const pl = recv.slice(off, off + len); recv = recv.slice(off + len);
    if (op === 9) { try { sock.write(buildFrame(10, pl)); } catch {} continue; }
    if (op === 8 || op === 10) continue;
    emit(pl.toString("utf8"));
  }
}
sock.on("data", (c) => { recv = Buffer.concat([recv, c]); try { pump(); } catch (e) { if (!done) hsRej(e); } });
const key = crypto.randomBytes(16).toString("base64");
sock.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
pump();
await hsP;
function rpc(api, method, params) {
  const id = nid++;
  return new Promise((r, j) => {
    const t = setTimeout(() => { pending.delete(id); j(new Error("timeout " + method)); }, 12000);
    pending.set(id, { r, j, t });
    sock.write(buildFrame(1, Buffer.from(JSON.stringify({ id, method: "call", params: [api, method, params] }), "utf8")));
  });
}
await rpc(1, "login", ["", ""]);
const db = await rpc(1, "database", []);
const hist = await rpc(1, "history", []);
const rows = await rpc(hist, "get_account_history", [account, "1.11.0", 2, "1.11.0"]);
console.log("ROWCOUNT " + (rows || []).length);
(rows || []).forEach((r, i) => {
  const o = Array.isArray(r) ? r[1] : r;
  console.log("--- row " + i + " keys: " + Object.keys(o || {}).join(","));
  console.log("op0=" + (o && o.op && o.op[0]) + " id=" + (o && o.id) + " block=" + (o && o.block_num));
  console.log("time=" + (o && o.time) + " block_time=" + (o && o.block_time) + " timestamp=" + (o && o.timestamp));
  if (o && o.op && o.op[0] === 19 && o.op[1] && o.op[1].feed) {
    console.log("feed settle=" + JSON.stringify(o.op[1].feed.settlement_price) + " asset=" + o.op[1].asset_id);
  }
});
clearTimeout(overall);
sock.destroy();
process.exit(0);
