#!/usr/bin/env node
/* probe-pool-virgin-read.mjs — read-only baseline for slice-12 Task-4 (b).
 * Reads pool 1.19.66 (virgin-mint anomaly: predicted 31622, chain minted
 * 100000 for inA=100000/inB=10000) + fixture account balances + share supply.
 * Stdlib only (TLS + hand-rolled RFC6455, copied from ws-probe.mjs). No keys.
 * Usage: node tooling/probe-pool-virgin-read.mjs [wss-url] [pool-id]
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const urlStr = process.argv[2] || "wss://testnet.xbts.io/ws";
const poolId = process.argv[3] || "1.19.66";
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
      const m = head.split("\r\n")[0].match(/^HTTP\/\d\.\d\s+(\d+)/);
      if (!m || Number(m[1]) !== 101) { hsRej(new Error("handshake failed")); return; }
      hsDone = true; hsRes();
    }
    for (;;) {
      if (recv.length < 2) return;
      const b0 = recv[0], b1 = recv[1], fin = (b0 >> 7) & 1, op = b0 & 0x0f, masked = (b1 >> 7) & 1;
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
  let histId = null;
  try { histId = await rpc(1, "history", []); } catch (e) { histId = null; }
  const chainId = await rpc(dbId, "get_chain_id", []);
  const props = await rpc(dbId, "get_dynamic_global_properties", []);
  const poolRows = await rpc(dbId, "get_objects", [[poolId]]);
  const pool = poolRows && poolRows[0];
  let shareAsset = null, shareDyn = null, legA = null, legB = null;
  if (pool) {
    const ids = [pool.asset_a, pool.asset_b, pool.share_asset];
    const assets = await rpc(dbId, "lookup_asset_symbols", [[]]).catch(() => null);
    void assets;
    const got = await rpc(dbId, "get_assets", [ids]);
    legA = got && got[0]; legB = got && got[1]; shareAsset = got && got[2];
    if (shareAsset && shareAsset.dynamic_asset_data_id) {
      const d = await rpc(dbId, "get_objects", [[shareAsset.dynamic_asset_data_id]]);
      shareDyn = d && d[0];
    }
  }
  let hist = null, histErr = null;
  if (histId) {
    try { hist = await rpc(histId, "get_liquidity_pool_history", [poolId, null, null, 50]); }
    catch (e) { histErr = String((e && e.message) || e).slice(0, 300); }
  }
  let histDb = null, histDbErr = null;
  try { histDb = await rpc(dbId, "get_liquidity_pool_history", [poolId, null, null, 5]); }
  catch (e) { histDbErr = String((e && e.message) || e).slice(0, 300); }
  // Fixture account (public id only — no secrets here).
  const acct = await rpc(dbId, "get_accounts", [["1.2.26833"]]).catch(() => null);
  const bals = await rpc(dbId, "get_account_balances", ["1.2.26833", []]).catch(() => null);
  const out = {
    url: urlStr, chainId, head_block_number: props.head_block_number, head_time: props.time,
    poolId, pool, legA: legA && { id: legA.id, symbol: legA.symbol, precision: legA.precision },
    legB: legB && { id: legB.id, symbol: legB.symbol, precision: legB.precision },
    share: shareAsset && { id: shareAsset.id, symbol: shareAsset.symbol, precision: shareAsset.precision },
    share_current_supply: shareDyn ? shareDyn.current_supply : null,
    history_via_history_api: hist, history_error: histErr,
    history_via_db: histDb, history_db_error: histDbErr,
    account: acct && acct[0] && { id: acct[0].id, name: acct[0].name },
    balances: bals,
  };
  console.log(JSON.stringify(out, null, 1));
  try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {}
  sock.destroy();
  process.exit(0);
}
main().catch((e) => { console.log(JSON.stringify({ error: (e && e.message) || String(e) })); process.exit(1); });
