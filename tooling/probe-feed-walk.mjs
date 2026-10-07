#!/usr/bin/env node
/* probe-feed-walk.mjs — count op-19s for a given asset inside a publisher's
 * recent account history (the publisherPoints walk: 5 pages x 100, newest first).
 * Answers: are the producer's feeds for THIS asset reachable in the walk?
 * Stdlib only. Read-only, no keys.
 * Usage: node tooling/probe-feed-walk.mjs wss://api.bitshares.dev 1.2.581357 1.3.5650
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2] || "wss://api.bitshares.dev";
const account = process.argv[3] || "1.2.581357";
const assetId = process.argv[4] || "1.3.5650";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
function fail(e) { console.log("ERROR " + ((e && e.message) || e)); process.exit(1); }
const parsed = new URL(urlStr);
const isTls = parsed.protocol === "wss:";
const host = parsed.hostname;
const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
const path = (parsed.pathname || "/") + (parsed.search || "");
const overall = setTimeout(() => fail("timeout"), 60000);
overall.unref?.();
function buildFrame(op, p) {
  const need = p.length >= 126;
  const out = Buffer.alloc((need ? 4 : 2) + 4 + p.length);
  out[0] = 0x80 | op; let off = 2;
  if (need) { out[1] = 0x80 | 126; out.writeUInt16BE(p.length, 2); off = 4; }
  else out[1] = 0x80 | p.length;
  const mask = crypto.randomBytes(4); mask.copy(out, off); off += 4;
  for (let i = 0; i < p.length; i++) out[off + i] = p[i] ^ mask[i % 4];
  return out;
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
    const b0 = recv[0], b1 = recv[1], op = b0 & 15;
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
    const t = setTimeout(() => { pending.delete(id); j(new Error("timeout " + method)); }, 15000);
    pending.set(id, { r, j, t });
    sock.write(buildFrame(1, Buffer.from(JSON.stringify({ id, method: "call", params: [api, method, params] }), "utf8")));
  });
}
await rpc(1, "login", ["", ""]);
const hist = await rpc(1, "history", []);
let start = "1.11.0", pages = 0, total = 0, hits = [], oldest = null;
const seenOps = {};
for (let pg = 0; pg < 5; pg++) {
  const rows = await rpc(hist, "get_account_history", [account, "1.11.0", 100, start]);
  if (!rows || !rows.length) break;
  pages++;
  let firstId = null;
  for (const r of rows) {
    const o = Array.isArray(r) ? r[1] : r;
    if (!o || !o.op) continue;
    if (Array.isArray(r) && r[0] && firstId === null) firstId = null;
    total++;
    const t = o.op[0];
    seenOps[t] = (seenOps[t] || 0) + 1;
    if (t === 19 && o.op[1] && o.op[1].asset_id === assetId) {
      hits.push(o.block_time || "?");
    }
    if (o.id) oldest = o.id;
  }
  if (rows.length < 100) break;
  // page forward: start = last row id (inclusive -> dedupe next round like historyPaged)
  const last = rows[rows.length - 1];
  const lastObj = Array.isArray(last) ? last[1] : last;
  const lastId = (Array.isArray(last) && typeof last[0] === "string") ? last[0] : (lastObj && lastObj.id);
  if (!lastId || lastId === start) break;
  start = lastId;
}
console.log(JSON.stringify({ account, assetId, pages, total, hits_for_asset: hits.length, hit_times: hits.slice(0, 5), op_histogram: seenOps, oldest_seen: oldest }, null, 1));
clearTimeout(overall);
sock.destroy();
process.exit(0);
