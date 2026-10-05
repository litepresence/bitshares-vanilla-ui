#!/usr/bin/env node
/* history-summary-probe.mjs — live testnet re-read for history one-liners Task 6.
 * Exercises the REAL vanilla files (vanilla/js/api/format.js +
 * vanilla/js/api/account.js + vanilla/js/api/history-summary.js, whose facade
 * pulls history-families-{trade,pools,gov}.js via module.require) over a
 * stdlib-only WS client (framing copied from tooling/ws-probe.mjs, same repo).
 * Flow mirrors the account view exactly (account-ui.js:1330-1364):
 *   Account.history(id, 20) -> HistorySummary.enrich(rows, id).
 * Then asserts every row._summary contains no raw-integer run: strip dotted
 * object ids (1.2.x/1.3.x/1.7.x — identifiers may show raw per the design
 * spec §3) and decimal numbers first; any remaining \d{5,} run is a raw
 * money integer and FAILS the probe.
 * READS ONLY: get_chain_id, get_dynamic_global_properties,
 *   get_account_by_name, get_account_history, lookup_asset_symbols,
 *   get_accounts. No keys, no signing, no broadcast; fixture account
 *   lite-test-1 resolved live via get_account_by_name (never hardcoded id).
 * Usage: node tooling/history-summary-probe.mjs [wss-url] [account-name]
 *   defaults: wss://testnet.xbts.io/ws lite-test-1
 * Created by: history one-liners Task 6 (spec
 *   docs/superpowers/specs/2026-10-04-history-one-liners-design.md §5).
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(process.cwd() + "/tooling/");
const Format = require("../vanilla/js/api/format.js");
const Account = require("../vanilla/js/api/account.js");
const HistorySummary = require("../vanilla/js/api/history-summary.js");
const I18n = require("../vanilla/js/i18n.js");

/* Real locale path: seed the registry with the shipped en.json so summaries
 * interpolate through the app's own templates (test seam _seed/_setCurrent;
 * no transport, no DOM). */
I18n._seed("en", JSON.parse(fs.readFileSync("vanilla/locales/en.json", "utf8")));
I18n._setCurrent("en");
globalThis.I18n = I18n;

const urlStr = process.argv[2] || "wss://testnet.xbts.io/ws";
const acctName = process.argv[3] || "lite-test-1";
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

/* Unwrap one get_account_history row to its operation_history_object
 * (same shapes Account._historyPage tolerates: bare object or [seq, obj]
 * pair — tx-send.js pollHistoryForTransfer precedent). */
function unwrap(r) {
  if (Array.isArray(r)) {
    for (let i = 0; i < r.length; i++) {
      const c = r[i];
      if (c && typeof c === "object" && !Array.isArray(c) && c.op) return c;
    }
    if (r[1] && typeof r[1] === "object" && !Array.isArray(r[1])) return r[1];
    return null;
  }
  return (r && typeof r === "object") ? r : null;
}

/* Raw-money scan: dotted object ids and decimal amounts are legal
 * (identifiers may show raw — spec §3); anything left with 5+ digits is
 * a raw chain integer leaking into prose. */
function rawRuns(summary) {
  const scrubbed = String(summary)
    .replace(/\b\d+\.\d+\.\d+\b/g, " ")
    .replace(/\b\d+\.\d+\b/g, " ");
  const m = scrubbed.match(/\b\d{5,}\b/g);
  return m || [];
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
  const histId = await rpc(1, "history", []);

  /* Stub the sole socket owners the app data layers consume. */
  globalThis.Chain = {
    db: async () => dbId,
    history: async () => histId,
    call: (api, m, p) => rpc(api, m, p),
    status: () => ({})
  };
  globalThis.Format = Format;

  const chainId = await rpc(dbId, "get_chain_id", []);
  check("chain-id", /^[0-9a-f]{64}$/.test(chainId), chainId.slice(0, 8) + "…" + chainId.slice(-4));

  const props = await rpc(dbId, "get_dynamic_global_properties", []);
  const headNum = props && props.head_block_number;
  check("head-block", typeof headNum === "number" && headNum > 0,
    "#" + headNum + " @ " + (props && props.time));
  out.node = urlStr;
  out.head_block = headNum;

  const acct = await rpc(dbId, "get_account_by_name", [acctName]);
  check("fixture-resolve", !!(acct && acct.id), acctName + " -> " + (acct && acct.id));
  out.account = (acct && acct.id) + " (" + acctName + ")";

  /* The app path exactly: Account.history(id, 20) -> enrich(rows, id). */
  const raw = await Account.history(acct.id, 20);
  const rows = (Array.isArray(raw) ? raw : []).map(unwrap).filter(Boolean);
  check("history-rows", rows.length > 0, raw.length + " raw, " + rows.length + " objects");
  out.row_shape = Array.isArray(raw[0]) ? "pair" : "object";

  const enriched = await HistorySummary.enrich(rows, acct.id);
  const summed = enriched.filter((r) => typeof r._summary === "string" && r._summary);
  check("enrich-no-throw", enriched === rows, summed.length + "/" + rows.length + " rows summarized");
  out.samples = summed.slice(0, 5).map((r) => r._summary);

  const bad = [];
  summed.forEach((r) => {
    const runs = rawRuns(r._summary);
    if (runs.length) bad.push({ id: r.id, summary: r._summary, runs });
  });
  check("no-raw-integers", bad.length === 0,
    bad.length ? JSON.stringify(bad.slice(0, 3)) : summed.length + " summaries scanned");

  console.log(JSON.stringify({ url: urlStr, checks: out }, null, 1));
  try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {}
  sock.destroy();
  const failed = Object.values(out).some((v) => typeof v === "string" && v.indexOf("FAIL") === 0);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.log(JSON.stringify({ url: urlStr, error: e && e.message })); process.exit(1); });
