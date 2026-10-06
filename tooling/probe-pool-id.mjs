#!/usr/bin/env node
/* probe-pool-id.mjs — list one liquidity pool id for headless verification.
 * Stdlib only (same hand-rolled WS framing as probe-discrete-fills.mjs).
 * Usage: node tooling/probe-pool-id.mjs wss://testnet.xbts.io/ws [limit]
 * Prints {pool, asset_a_id, asset_b_id, share_asset} for the first pool.
 * Created by: discrete-timescale plan Task 7 (parity evidence).
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2];
const LIMIT = Number(process.argv[3] || 5);
if (!urlStr) { console.log(JSON.stringify({ error: "missing url argument" })); process.exit(1); }
const parsed = new URL(urlStr);
const isTls = parsed.protocol === "wss:";
const host = parsed.hostname;
const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
const path = (parsed.pathname || "/") + (parsed.search || "");

function fail(err) {
  console.log(JSON.stringify({ url: urlStr, error: String((err && err.message) || err) }));
  process.exit(1);
}

const sock = (isTls ? tls.connect(port, host, { servername: host }) : net.connect(port, host));
sock.on("error", fail);
const key = crypto.randomBytes(16).toString("base64");
let buf = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
let textBuf = "";

sock.on("connect", () => {
  sock.write(
    "GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\nUpgrade: websocket\r\n" +
    "Connection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n"
  );
});

function sendFrame(obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const mask = crypto.randomBytes(4);
  const head = Buffer.alloc(6);
  head[0] = 0x81;
  head[1] = 0x80 | data.length;
  for (let i = 0; i < 4; i++) head[2 + i] = mask[i];
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  sock.write(Buffer.concat([head, masked]));
}

function call(api, method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sendFrame({ id, method: "call", params: [api, method, params] });
  });
}

let upgraded = false;
sock.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  if (!upgraded) {
    const s = buf.toString("latin1");
    const ix = s.indexOf("\r\n\r\n");
    if (ix === -1) return;
    if (!s.startsWith("HTTP/1.1 101")) fail(new Error("no 101 upgrade"));
    buf = buf.slice(ix + 4);
    upgraded = true;
    main().catch(fail);
    return;
  }
  while (buf.length >= 2) {
    const b0 = buf[0];
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return;
      const hi = buf.readUInt32BE(2), lo = buf.readUInt32BE(6);
      if (hi !== 0 || lo > 16 * 1024 * 1024) fail(new Error("frame too large"));
      len = lo;
      off = 10;
    }
    const maskOff = masked ? 4 : 0;
    if (buf.length < off + maskOff + len) return;
    let payload = buf.slice(off + maskOff, off + maskOff + len);
    if (masked) {
      const mask = buf.slice(off, off + 4);
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
      payload = out;
    }
    buf = buf.slice(off + maskOff + len);
    if (b0 === 0x8a) continue;
    if (b0 !== 0x81) continue;
    textBuf += payload.toString("utf8");
    let msg;
    try { msg = JSON.parse(textBuf); textBuf = ""; }
    catch (e) { continue; }
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p.resolve(msg); }
  }
});

async function main() {
  await call(1, "login", ["", ""]);
  const dbId = (await call(1, "database", [])).result;
  /* database_api.hpp:701 list_liquidity_pools(limit, start_id, ...). */
  const res = await call(dbId, "list_liquidity_pools", [LIMIT, null]);
  if (res.error) throw new Error("list_liquidity_pools: " + JSON.stringify(res.error));
  const pools = (res.result || []).map((p) => ({
    pool: p.id, asset_a_id: p.asset_a, asset_b_id: p.asset_b, share: p.share_asset
  }));
  /* Swap-activity signal per pool (chain get_liquidity_pool_history, limit 1:
   * the same read PoolHistory.chainSwaps uses — proves which pools have a
   * tape worth plotting before opening the desk). */
  const histId = (await call(1, "history", [])).result;
  for (const p of pools) {
    try {
      const hr = await call(histId, "get_liquidity_pool_history", [p.pool, null, null, 5]);
      const rows = Array.isArray(hr.result) ? hr.result : [];
      let ex = 0;
      rows.forEach((h) => {
        try {
          /* Same shape chainSwaps reads: row.op.op = [code, body]. */
          const o = (h && h.op) || {};
          const inner = o.op || [];
          if (Array.isArray(inner) && inner[0] === 63) ex++;
        } catch (e) { /* skip */ }
      });
      p.swaps5 = rows.length + "rows/" + ex + "xchg";
    } catch (e) { p.swaps5 = "call-failed"; }
  }
  console.log(JSON.stringify({ url: urlStr, pools }, null, 2));
  sock.end();
  process.exit(0);
}

const overallTimer = setTimeout(() => fail(new Error("overall timeout")), 25000);
overallTimer.unref?.();
