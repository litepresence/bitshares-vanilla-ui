#!/usr/bin/env node
/* ws-probe.mjs — stdlib-only BitShares WS handshake probe (RFC 6455, hand-rolled).
 * Provenance: written from scratch for slice-01 Task 9; no deps, no vendored code.
 * Flow: TCP/TLS connect -> HTTP Upgrade handshake -> login -> database ->
 *   get_chain_id + get_dynamic_global_properties. Prints one JSON line.
 * Usage: node tooling/ws-probe.mjs wss://testnet.xbts.io/ws
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2];
const OVERALL_TIMEOUT_MS = 20000;
const CALL_TIMEOUT_MS = 12000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function fail(url, err) {
  const msg = err && err.message ? err.message : String(err);
  console.log(JSON.stringify({ url, error: msg }));
  process.exit(1);
}

if (!urlStr) {
  console.log(JSON.stringify({ url: null, error: "missing url argument" }));
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(urlStr);
} catch (e) {
  fail(urlStr, e);
}
if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
  fail(urlStr, new Error("url must start with ws:// or wss://, got " + parsed.protocol));
}

const isTls = parsed.protocol === "wss:";
const host = parsed.hostname;
const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
const path = (parsed.pathname || "/") + (parsed.search || "");
const t0 = Date.now();

const overallTimer = setTimeout(() => {
  fail(urlStr, new Error("overall timeout after " + OVERALL_TIMEOUT_MS + "ms"));
}, OVERALL_TIMEOUT_MS);
overallTimer.unref?.();

function openSocket() {
  return new Promise((resolve, reject) => {
    let sock;
    const onError = (e) => { sock?.destroy(); reject(e); };
    if (isTls) {
      sock = tls.connect({ host, port, servername: host }, () => {
        sock.removeListener("error", onError);
        resolve(sock);
      });
    } else {
      sock = net.connect({ host, port }, () => {
        sock.removeListener("error", onError);
        resolve(sock);
      });
    }
    sock.once("error", onError);
  });
}

// ---- WS framing (client side) ----
function buildFrame(opcode, payload, { fin = true, masked = true } = {}) {
  const len = payload.length;
  let headerLen = 2;
  let ext = null;
  if (len < 126) {
    // no ext
  } else if (len < 65536) {
    headerLen += 2;
    ext = Buffer.alloc(2);
    ext.writeUInt16BE(len, 0);
  } else {
    headerLen += 8;
    ext = Buffer.alloc(8);
    ext.writeBigUInt64BE(BigInt(len), 0);
  }
  if (masked) headerLen += 4;
  const out = Buffer.alloc(headerLen + len);
  out[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  if (len < 126) out[1] = (masked ? 0x80 : 0x00) | len;
  else if (len < 65536) out[1] = (masked ? 0x80 : 0x00) | 126;
  else out[1] = (masked ? 0x80 : 0x00) | 127;
  let off = 2;
  if (ext) { ext.copy(out, off); off += ext.length; }
  let mask = null;
  if (masked) {
    mask = crypto.randomBytes(4);
    mask.copy(out, off);
    off += 4;
    for (let i = 0; i < len; i++) out[off + i] = payload[i] ^ mask[i % 4];
  } else {
    payload.copy(out, off);
  }
  return out;
}

async function main() {
  const sock = await openSocket();
  sock.setNoDelay(true);

  let recv = Buffer.alloc(0);
  let handshakeDone = false;
  let handshakeResolve, handshakeReject;
  const handshakeP = new Promise((res, rej) => { handshakeResolve = res; handshakeReject = rej; });

  // Fragmentation + dispatch state
  let fragOpcode = null;
  let fragParts = [];
  const pending = new Map();
  let nextId = 1;

  function emitText(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error("rpc error: " + JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }

  function handleFrame(opcode, fin, payload) {
    if (opcode === 0x9) { // ping -> pong
      try { sock.write(buildFrame(0x0a, payload)); } catch {}
      return;
    }
    if (opcode === 0x8) { // close
      try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {}
      return;
    }
    if (opcode === 0x0a) return; // pong: ignore
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) {
        if (fragOpcode === null) emitText(payload.toString("utf8"));
        else { fragParts.push(payload); const full = Buffer.concat(fragParts); fragParts = []; fragOpcode = null; emitText(full.toString("utf8")); }
      } else {
        fragOpcode = opcode;
        fragParts = [payload];
      }
      return;
    }
    if (opcode === 0x0) { // continuation
      fragParts.push(payload);
      if (fin) { const full = Buffer.concat(fragParts); fragParts = []; fragOpcode = null; emitText(full.toString("utf8")); }
    }
  }

  function pump() {
    if (!handshakeDone) {
      const idx = recv.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const head = recv.slice(0, idx).toString("latin1");
      recv = recv.slice(idx + 4);
      const statusLine = head.split("\r\n")[0];
      const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
      const code = m ? Number(m[1]) : 0;
      if (code !== 101) {
        handshakeReject(new Error("handshake failed: " + statusLine));
        return;
      }
      const acceptMatch = head.match(/sec-websocket-accept:\s*(\S+)/i);
      const expected = crypto.createHash("sha1").update(wsKey + WS_GUID).digest("base64");
      if (!acceptMatch || acceptMatch[1].trim() !== expected) {
        handshakeReject(new Error("bad Sec-WebSocket-Accept"));
        return;
      }
      handshakeDone = true;
      handshakeResolve();
    }
    // parse server frames (usually unmasked; tolerate masked)
    for (;;) {
      if (recv.length < 2) return;
      const b0 = recv[0], b1 = recv[1];
      const fin = (b0 >> 7) & 1;
      const opcode = b0 & 0x0f;
      const masked = (b1 >> 7) & 1;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (recv.length < 4) return;
        len = recv.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (recv.length < 10) return;
        const big = recv.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too large");
        len = Number(big);
        off = 10;
      }
      let mask = null;
      if (masked) {
        if (recv.length < off + 4) return;
        mask = recv.slice(off, off + 4);
        off += 4;
      }
      if (recv.length < off + len) return;
      let payload = recv.slice(off, off + len);
      if (mask) {
        const u = Buffer.alloc(len);
        for (let i = 0; i < len; i++) u[i] = payload[i] ^ mask[i % 4];
        payload = u;
      }
      recv = recv.slice(off + len);
      handleFrame(opcode, fin, payload);
    }
  }

  sock.on("data", (chunk) => {
    recv = Buffer.concat([recv, chunk]);
    try { pump(); } catch (e) { handshakeDone ? undefined : handshakeReject(e); }
  });
  sock.on("error", () => {});
  sock.on("close", () => {
    if (!handshakeDone) handshakeReject(new Error("socket closed during handshake"));
  });

  // Opening handshake
  const wsKey = crypto.randomBytes(16).toString("base64");
  const req =
    `GET ${path} HTTP/1.1\r\n` +
    `Host: ${host}:${port}\r\n` +
    `Upgrade: websocket\r\n` +
    `Connection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${wsKey}\r\n` +
    `Sec-WebSocket-Version: 13\r\n` +
    `Origin: http://${host}\r\n\r\n`;
  sock.write(req);
  pump();
  await handshakeP;

  function rpc(apiId, method, params) {
    const id = nextId++;
    const body = JSON.stringify({ id, method: "call", params: [apiId, method, params || []] });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("call timeout: " + method)); }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        sock.write(buildFrame(0x1, Buffer.from(body, "utf8")));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      }
    });
  }

  const loginRes = await rpc(1, "login", ["", ""]);
  void loginRes;
  const dbId = await rpc(1, "database", []);
  const ids = (process.argv[3] || "1.2.0,1.2.1,1.2.2,1.2.3,1.2.4,1.2.5,1.2.6").split(",");
  const objs = await rpc(dbId, "get_objects", [ids]);
  console.log(JSON.stringify(objs.map((o) => (o ? o.id + "=" + o.name : "null"))));
  sock.destroy();
  clearTimeout(overallTimer);
}

main().catch((e) => fail(urlStr, e));
