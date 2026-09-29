#!/usr/bin/env node
/* Throwaway: show node buckets are non-linear (gaps skipped). Copies
 * tooling/ws-probe.mjs framing, adds history calls. Output: JSON summary. */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2] || "wss://api.bitshares.dev/ws";
const CALL_TIMEOUT_MS = 15000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
let parsed = new URL(urlStr);
const isTls = parsed.protocol === "wss:";
const host = parsed.hostname;
const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
const path = (parsed.pathname || "/") + (parsed.search || "");

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
  const mask = crypto.randomBytes(4);
  mask.copy(out, off); off += 4;
  for (let i = 0; i < len; i++) out[off + i] = payload[i] ^ mask[i % 4];
  return out;
}

async function main() {
  const sock = await new Promise((res, rej) => {
    let s;
    if (isTls) s = tls.connect({ host, port, servername: host }, () => res(s));
    else s = net.connect({ host, port }, () => res(s));
    s.once("error", rej);
  });
  let recv = Buffer.alloc(0), hsDone = false, hsRes, hsRej;
  const hsP = new Promise((a, b) => { hsRes = a; hsRej = b; });
  const pending = new Map(); let nextId = 1;
  function emit(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    }
  }
  function pump() {
    if (!hsDone) {
      const i = recv.indexOf("\r\n\r\n"); if (i === -1) return;
      const head = recv.slice(0, i).toString("latin1"); recv = recv.slice(i + 4);
      if (!/^HTTP\/\d\.\d\s+101/.test(head.split("\r\n")[0])) { hsRej(new Error("hs: " + head.split("\r\n")[0])); return; }
      hsDone = true; hsRes();
    }
    for (;;) {
      if (recv.length < 2) return;
      const b0 = recv[0], b1 = recv[1], fin = b0 >> 7, op = b0 & 0x0f;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (recv.length < 4) return; len = recv.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (recv.length < 10) return; len = Number(recv.readBigUInt64BE(2)); off = 10; }
      const masked = (b1 >> 7) & 1; let mask = null;
      if (masked) { if (recv.length < off + 4) return; mask = recv.slice(off, off + 4); off += 4; }
      if (recv.length < off + len) return;
      let p = recv.slice(off, off + len);
      if (mask) { const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = p[i] ^ mask[i % 4]; p = u; }
      recv = recv.slice(off + len);
      if (op === 0x1 || op === 0x2) emit(p.toString("utf8"));
      else if (op === 0x9) try { sock.write(buildFrame(0x0a, p)); } catch {}
    }
  }
  sock.on("data", c => { recv = Buffer.concat([recv, c]); try { pump(); } catch (e) { if (!hsDone) hsRej(e); } });
  const key = crypto.randomBytes(16).toString("base64");
  sock.write(`GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`);
  pump(); await hsP;
  function rpc(api, method, params) {
    const id = nextId++;
    const body = JSON.stringify({ id, method: "call", params: [api, method, params || []] });
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { pending.delete(id); rej(new Error("timeout " + method)); }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve: res, reject: rej, timer });
      sock.write(buildFrame(0x1, Buffer.from(body)));
    });
  }
  const out = { url: urlStr };
  await rpc(1, "login", ["", ""]);
  const dbId = await rpc(1, "database", []);
  let histId = null;
  try { histId = await rpc(1, "history", []); } catch (e) { out.historyError = String(e.message || e); }
  out.historyApi = histId;
  const assets = await rpc(dbId, "lookup_asset_symbols", [["BTS", "CNY"]]);
  const q = assets[0], b = assets[1];
  out.pair = { quote: q && q.symbol + "/" + q.id, base: b && b.symbol + "/" + b.id };
  let buckets = [];
  try { buckets = await rpc(histId, "get_market_history_buckets", []); } catch (e) { out.bucketsError = String(e.message || e); }
  out.bucketsOffered = buckets;
  const bucket = buckets.includes(3600) ? 3600 : Math.max(...buckets);
  const count = 200, nowSec = Math.floor(Date.now() / 1000);
  const endSlot = Math.floor(nowSec / bucket) * bucket;
  const startSlot = endSlot - (count - 1) * bucket;
  const iso = s => new Date(s * 1000).toISOString().slice(0, -5);
  const rows = await rpc(histId, "get_market_history", [b.id, q.id, bucket, iso(startSlot), iso(endSlot + bucket)]);
  out.request = { base: b.id, quote: q.id, bucket, count, start: iso(startSlot), end: iso(endSlot + bucket) };
  out.rowsReturned = rows.length;
  const slots = rows.map(r => {
    const t = Date.parse(r.key.open); return Math.floor(Math.floor(t / 1000) / bucket) * bucket;
  }).sort((a, b2) => a - b2);
  out.oldestRow = slots.length ? new Date(slots[0] * 1000).toISOString() : null;
  out.newestRow = slots.length ? new Date(slots[slots.length - 1] * 1000).toISOString() : null;
  // gap analysis over expected grid
  const have = new Set(slots);
  let missing = 0; const firstGaps = [];
  for (let s = startSlot; s <= endSlot; s += bucket) {
    if (!have.has(s)) { missing++; if (firstGaps.length < 5) firstGaps.push(new Date(s * 1000).toISOString()); }
  }
  out.expectedSlots = count; out.missingSlots = missing; out.firstMissing = firstGaps;
  out.dupes = rows.length - new Set(slots).size;
  console.log(JSON.stringify(out, null, 2));
  sock.destroy(); process.exit(0);
}
main().catch(e => { console.log(JSON.stringify({ error: String(e && e.message || e) })); process.exit(1); });
