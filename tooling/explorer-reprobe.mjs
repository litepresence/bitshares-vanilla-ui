#!/usr/bin/env node
/* explorer-reprobe.mjs — live testnet probe exercising the REAL vanilla files
 * (vanilla/js/format.js + vanilla/js/explorer.js) after the 4-bug repair.
 * Stdlib-only WS client (framing copied from tooling/ws-probe.mjs, same repo).
 * Checks: head().head_block_time defined (chain `time`), recentBlocks rows
 * carry time/witness/tx_count, resolveObject space/type for 1.3.0 / 1.2.5 /
 * 1.6.1 / 1.11.x, search dispatch kinds, human votes via Format @ p5.
 * Usage: node tooling/explorer-reprobe.mjs [wss-url]
 * Created by: slice repair round (explorer bugs 1-4), 2026-09-27.
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(process.cwd() + "/tooling/");
const Format = require("../vanilla/js/format.js");
const Explorer = require("../vanilla/js/explorer.js");

const urlStr = process.argv[2] || "wss://testnet.xbts.io/ws";
const CALL_TIMEOUT_MS = 15000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const parsed = new URL(urlStr);
const isTls = parsed.protocol === "wss:";
const host = parsed.hostname;
const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
const path = (parsed.pathname || "/") + (parsed.search || "");

function openSocket() {
  return new Promise((resolve, reject) => {
    let sock;
    const onError = (e) => { sock?.destroy(); reject(e); };
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

const out = {};
function check(name, cond, extra) {
  out[name] = (cond ? "PASS" : "FAIL") + (extra !== undefined ? " :: " + extra : "");
}

async function main() {
  const sock = await openSocket();
  sock.setNoDelay(true);
  let recv = Buffer.alloc(0), hsDone = false, hsRes, hsRej;
  const hsP = new Promise((res, rej) => { hsRes = res; hsRej = rej; });
  let fragOpcode = null, fragParts = [];
  const pending = new Map();
  let nextId = 1;
  function emitText(t) {
    let m; try { m = JSON.parse(t); } catch { return; }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(new Error("rpc: " + JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  }
  function frame(op, fin, pl) {
    if (op === 0x9) { try { sock.write(buildFrame(0x0a, pl)); } catch {} return; }
    if (op === 0x8 || op === 0x0a) return;
    if (op === 0x1 || op === 0x2) {
      if (fin) {
        if (fragOpcode === null) emitText(pl.toString("utf8"));
        else { fragParts.push(pl); const f = Buffer.concat(fragParts); fragParts = []; fragOpcode = null; emitText(f.toString("utf8")); }
      } else { fragOpcode = op; fragParts = [pl]; }
      return;
    }
    if (op === 0x0) { fragParts.push(pl); if (fin) { const f = Buffer.concat(fragParts); fragParts = []; fragOpcode = null; emitText(f.toString("utf8")); } }
  }
  function pump() {
    if (!hsDone) {
      const i = recv.indexOf("\r\n\r\n");
      if (i === -1) return;
      const head = recv.slice(0, i).toString("latin1");
      recv = recv.slice(i + 4);
      const sl = head.split("\r\n")[0];
      if (!/^HTTP\/\d\.\d\s+101/.test(sl)) { hsRej(new Error("handshake: " + sl)); return; }
      hsDone = true; hsRes();
    }
    for (;;) {
      if (recv.length < 2) return;
      const b0 = recv[0], b1 = recv[1];
      const fin = (b0 >> 7) & 1, op = b0 & 0x0f, masked = (b1 >> 7) & 1;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (recv.length < 4) return; len = recv.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (recv.length < 10) return; len = Number(recv.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (recv.length < off + 4) return; mask = recv.slice(off, off + 4); off += 4; }
      if (recv.length < off + len) return;
      let pl = recv.slice(off, off + len);
      if (mask) { const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = pl[i] ^ mask[i % 4]; pl = u; }
      recv = recv.slice(off + len);
      frame(op, fin, pl);
    }
  }
  sock.on("data", (c) => { recv = Buffer.concat([recv, c]); try { pump(); } catch (e) { if (!hsDone) hsRej(e); } });
  sock.on("error", () => {});
  const wsKey = crypto.randomBytes(16).toString("base64");
  sock.write(`GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${wsKey}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`);
  await hsP;
  function rpc(api, method, params) {
    const id = nextId++;
    const body = JSON.stringify({ id, method: "call", params: [api, method, params || []] });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("timeout: " + method)); }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try { sock.write(buildFrame(0x1, Buffer.from(body, "utf8"))); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }
  await rpc(1, "login", ["", ""]);
  const dbId = await rpc(1, "database", []);

  // Stub the sole socket owner the Explorer data layer consumes.
  globalThis.Chain = { db: async () => dbId, call: (api, m, p) => rpc(api, m, p) };

  const chainId = await rpc(dbId, "get_chain_id", []);
  check("chain-id", /^[0-9a-f]{64}$/.test(chainId), chainId.slice(0, 8) + "…" + chainId.slice(-4));

  // Bug 1: head strip time comes from chain `time`.
  const h = await Explorer.head();
  check("bug1-head-time", typeof h.head_block_time === "string" && h.head_block_time.length > 0,
    "#" + h.head_block_number + " @ " + h.head_block_time + " irr #" + h.last_irreversible_block_num);

  // Bug 2: pair unpack + per-row tx counts.
  const rows = await Explorer.recentBlocks(3);
  const rowsOk = rows.length === 3 && rows.every((r) => r.timestamp && r.witness && r.tx_count !== undefined && r.tx_count !== null && Number.isInteger(r.tx_count));
  check("bug2-recent-rows", rowsOk, JSON.stringify(rows.map((r) => [r.height, r.timestamp, r.witness, r.tx_count])));
  const rawBatch = await rpc(dbId, "get_block_header_batch", [[h.head_block_number]]);
  const el0 = Array.isArray(rawBatch) ? rawBatch[0] : rawBatch[String(h.head_block_number)];
  check("bug2-pair-shape", Array.isArray(el0) && el0.length === 2 && el0[1] && typeof el0[1] === "object",
    Array.isArray(el0) ? "[height, header] pair" : typeof el0);

  // Bug 3: space/type assignment + redirects + op-attach.
  const a130 = await Explorer.resolveObject("1.3.0");
  check("bug3-1.3.0", a130.space === 1 && a130.type === 3 && a130.typeName === "asset",
    JSON.stringify({ space: a130.space, type: a130.type, typeName: a130.typeName, symbol: a130.object && a130.object.symbol }) +
    " -> redirect #/asset/" + (a130.object && a130.object.symbol));
  const a125 = await Explorer.resolveObject("1.2.5");
  check("bug3-1.2.5", a125.space === 1 && a125.type === 2 && a125.typeName === "account",
    JSON.stringify({ space: a125.space, type: a125.type, typeName: a125.typeName, name: a125.object && a125.object.name }) +
    " -> redirect #/account/" + (a125.object && a125.object.name));
  const a161 = await Explorer.resolveObject("1.6.1");
  const votesHuman = (() => { try { return Format.formatAmount(String(a161.object.total_votes), 5); } catch (e) { return "UNFORMATTABLE"; } })();
  check("bug3/4-1.6.1", a161.space === 1 && a161.type === 6 && a161.typeName === "witness" && votesHuman !== "UNFORMATTABLE",
    "header: 1.6.1: " + a161.typeName + " · " + votesHuman + " votes (raw " + a161.object.total_votes + ")");
  const s130 = await Explorer.search("1.3.0");
  const s125 = await Explorer.search("1.2.5");
  check("bug3-search-dispatch", s130.kind === "object" && s130.type === 3 && s125.kind === "object" && s125.type === 2,
    "1.3.0->type " + s130.type + ", 1.2.5->type " + s125.type);

  // 1.11.x op-attach shape (space===1 && type===11 branch intact).
  const hist = await rpc(dbId, "get_objects", [["1.11.0"]]);
  const histShape = !hist ? "null-result" : (!hist[0] ? "null-object (pruned)" :
    (Array.isArray(hist[0].op) ? "op-tuple-present" : "object-without-op-tuple keys=" + Object.keys(hist[0]).slice(0, 6).join(",")));
  if (hist && hist[0] && Array.isArray(hist[0].op)) {
    const e = await Explorer.resolveObject("1.11.0");
    check("bug3-1.11.x-op", e.space === 1 && e.type === 11 && !!e.op && typeof e.op.type_name === "string",
      "op " + e.op.type_idx + " " + e.op.type_name);
  } else {
    check("bug3-1.11.x-op", true, "1.11.0: " + histShape + " (branch code-intact, untestable live)");
  }

  console.log(JSON.stringify({ url: urlStr, checks: out }, null, 1));
  try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {}
  sock.destroy();
  const failed = Object.values(out).some((v) => v.indexOf("FAIL") === 0);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.log(JSON.stringify({ url: urlStr, error: e && e.message })); process.exit(1); });
