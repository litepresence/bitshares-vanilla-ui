#!/usr/bin/env node
/* probe-discrete-fills.mjs — verify the Discrete timescale chain path live.
 * Calls the EXACT methods MarketFills.chainFills uses (history api
 * get_fill_order_history, api.hpp:212) plus get_market_history_buckets
 * (bucket-list regression: the numeric radios must survive Discrete).
 * Stdlib only (RFC 6455 framing hand-rolled, ws-probe.mjs pattern).
 * Usage: node tooling/probe-discrete-fills.mjs wss://testnet.xbts.io/ws
 * Exit 0 with a JSON summary; exit 1 on transport failure.
 * Created by: discrete-timescale plan Task 7 (parity evidence).
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2];
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
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
const queue = [];

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
  head.writeUInt16BE(0, 2);
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
let textBuf = "";
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
    if (b0 === 0x8a) continue; /* pong */
    if (b0 !== 0x81) continue;
    textBuf += payload;
    let msg;
    try { msg = JSON.parse(textBuf); textBuf = ""; }
    catch (e) { continue; }
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p.resolve(msg); }
  }
});

async function main() {
  const out = { url: urlStr };
  const login = await call(1, "login", ["", ""]);
  if (login.error) throw new Error("login: " + JSON.stringify(login.error));
  const dbId = (await call(1, "database", [])).result;
  const histId = (await call(1, "history", [])).result;
  out.dbApi = dbId; out.histApi = histId;
  if (typeof histId !== "number") throw new Error("no history api (fills need the history plugin)");
  /* Resolve candidate symbols to ids (same lookup the desk uses). */
  const syms = process.argv[3] ? process.argv[3].split(",") : ["USD_TEST", "BTS_TEST", "TEST", "BTS", "CNY_TEST"];
  const rows = (await call(dbId, "lookup_asset_symbols", [syms])).result || [];
  out.assets = {};
  rows.forEach((r) => { if (r && r.symbol && r.id) out.assets[r.symbol] = { id: r.id, precision: r.precision }; });
  /* Bucket list regression: numeric radios must still be offered. */
  out.buckets = (await call(histId, "get_market_history_buckets", [])).result;
  /* Discrete path: raw fills for the first resolvable pair (limit 10). */
  const ids = Object.values(out.assets).map((a) => a.id);
  out.fills = null;
  if (ids.length >= 2) {
    const fr = await call(histId, "get_fill_order_history", [ids[0], ids[1], 10]);
    if (fr.error) out.fills = { pair: [ids[0], ids[1]], error: fr.error };
    else {
      const fills = fr.result || [];
      out.fills = {
        pair: [ids[0], ids[1]], count: fills.length,
        sample: fills.length ? {
          time: fills[0].time || fills[0].block_time || null,
          pays: fills[0].op && (fills[0].op[1] || fills[0].op).pays,
          receives: fills[0].op && (fills[0].op[1] || fills[0].op).receives
        } : null
      };
    }
  }
  console.log(JSON.stringify(out, null, 2));
  sock.end();
  process.exit(0);
}

const overallTimer = setTimeout(() => fail(new Error("overall timeout")), 25000);
overallTimer.unref?.();
