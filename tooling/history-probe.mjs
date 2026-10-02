#!/usr/bin/env node
/* history-probe.mjs — stdlib-only history_api capability sweep (RFC 6455, hand-rolled).
 * Provenance: framing copied from tooling/ws-probe.mjs (slice-01, scratch-written,
 *   no deps); method list + params triangulated per mapping-chain-calls skill:
 *   #4 ground truth = reference/bitshares-core/libraries/app/include/graphene/app/api.hpp
 *     history_api class (lines 69-592: get_account_history, get_account_history_operations,
 *     get_relative_account_history, get_fill_order_history, get_market_history,
 *     get_market_history_buckets, get_asset_holders, get_asset_holders_count) and
 *     database_api.hpp (get_trade_history lives on the DATABASE api, not history —
 *     we still probe it on the history api id as requested and record honestly).
 *   Node lists curated from vanilla/js/store.js DEFAULT_NODES (read 2026-10-02).
 * Flow per node: TCP/TLS -> WS upgrade -> login ["",""] -> resolve "database" AND
 *   "history" api ids (history fail-soft: reject/timeout => hasHistory=false, probe
 *   still counts) -> if history, call each method with minimal safe params.
 * Usage:
 *   node tooling/history-probe.mjs                      # both lists, writes default JSON
 *   node tooling/history-probe.mjs --mainnet-only       # mainnet list only (stdout+file)
 *   node tooling/history-probe.mjs --testnet-only       # testnet list only
 *   node tooling/history-probe.mjs --out /tmp/x.json    # custom output path
 * Runtime: node >= 18 (stdlib only: tls/net/crypto/fs). Sequential per node.
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const PER_NODE_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 5000;
const HISTORY_RESOLVE_TIMEOUT_MS = 4000;

// Curated node lists — copy of vanilla/js/store.js DEFAULT_NODES (2026-10-02).
// Source of truth stays in store.js; this copy is probe-time data, not a fork.
const MAINNET_NODES = [
  "wss://api.bitshares.dev/ws",
  "wss://dex.iobanker.com/ws",
  "wss://node.xbts.io/ws",
  "wss://public.xbts.io/ws",
  "wss://cloud.xbts.io/ws",
  "wss://api.bts.mobi/ws",
  "wss://api.dex.trading/ws",
];
const TESTNET_NODES = ["wss://testnet.xbts.io/ws", "wss://testnet.dex.trading/"];

const DEFAULT_OUT = "tooling/history-capabilities-2026-10-02.json";

// Minimal safe params. Account 1.2.0 (committee-account) exists on both chains;
// assets 1.3.0/1.3.1 are the first two assets so fill/market/trade calls return
// [] (ok) instead of unknown-asset errors when the method exists.
function isoNoMs(sec) {
  return new Date(sec * 1000).toISOString().slice(0, -5);
}

function buildFrame(opcode, payload) {
  const len = payload.length;
  let headerLen = 2;
  let ext = null;
  if (len >= 126 && len < 65536) {
    headerLen += 2;
    ext = Buffer.alloc(2);
    ext.writeUInt16BE(len, 0);
  } else if (len >= 65536) {
    headerLen += 8;
    ext = Buffer.alloc(8);
    ext.writeBigUInt64BE(BigInt(len), 0);
  }
  headerLen += 4; // client mask
  const out = Buffer.alloc(headerLen + len);
  out[0] = 0x80 | (opcode & 0x0f);
  if (len < 126) out[1] = 0x80 | len;
  else if (len < 65536) out[1] = 0x80 | 126;
  else out[1] = 0x80 | 127;
  let off = 2;
  if (ext) {
    ext.copy(out, off);
    off += ext.length;
  }
  const mask = crypto.randomBytes(4);
  mask.copy(out, off);
  off += 4;
  for (let i = 0; i < len; i++) out[off + i] = payload[i] ^ mask[i % 4];
  return out;
}

function connect(urlStr, perNodeMs) {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error("url must start with ws:// or wss://, got " + parsed.protocol);
  }
  const isTls = parsed.protocol === "wss:";
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
  const wsPath = (parsed.pathname || "/") + (parsed.search || "");

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let sock = null;
    let recv = Buffer.alloc(0);
    let hsDone = false;
    let hsResolve;
    let hsReject;
    const hsP = new Promise((res, rej) => {
      hsResolve = res;
      hsReject = rej;
    });
    const pending = new Map();
    let nextId = 1;
    let settled = false;

    const overallTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          sock?.destroy();
        } catch {}
        reject(new Error("per-node timeout after " + perNodeMs + "ms"));
      }
    }, perNodeMs);
    if (overallTimer.unref) overallTimer.unref();

    function emitText(text) {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error !== undefined) p.reject(new Error("rpc error: " + JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    }

    function handleFrame(opcode, fin, payload) {
      if (opcode === 0x9) {
        try {
          sock.write(buildFrame(0x0a, payload));
        } catch {}
        return;
      }
      if (opcode === 0x8) return;
      if (opcode === 0x0a) return;
      if (opcode === 0x1 || opcode === 0x2) {
        if (fin) emitText(payload.toString("utf8"));
        return;
      }
    }

    function pump() {
      if (!hsDone) {
        const idx = recv.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const head = recv.slice(0, idx).toString("latin1");
        recv = recv.slice(idx + 4);
        const statusLine = head.split("\r\n")[0];
        const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
        const code = m ? Number(m[1]) : 0;
        if (code !== 101) {
          hsReject(new Error("handshake failed: " + statusLine));
          return;
        }
        hsDone = true;
        hsResolve();
      }
      for (;;) {
        if (recv.length < 2) return;
        const b0 = recv[0];
        const b1 = recv[1];
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
          if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
            hsDone ? undefined : hsReject(new Error("frame too large"));
            return;
          }
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

    function openSocket() {
      return new Promise((res, rej) => {
        let s;
        const onError = (e) => {
          try {
            s?.destroy();
          } catch {}
          rej(e);
        };
        if (isTls) {
          s = tls.connect({ host, port, servername: host }, () => {
            s.removeListener("error", onError);
            res(s);
          });
        } else {
          s = net.connect({ host, port }, () => {
            s.removeListener("error", onError);
            res(s);
          });
        }
        s.once("error", onError);
      });
    }

    function rpc(apiId, method, params, timeoutMs) {
      const id = nextId++;
      const body = JSON.stringify({ id, method: "call", params: [apiId, method, params || []] });
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error("call timeout: " + method));
        }, timeoutMs || CALL_TIMEOUT_MS);
        if (timer.unref) timer.unref();
        pending.set(id, { resolve: res, reject: rej, timer });
        try {
          sock.write(buildFrame(0x1, Buffer.from(body, "utf8")));
        } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          rej(e);
        }
      });
    }

    function close() {
      settled = true;
      clearTimeout(overallTimer);
      for (const [, p] of pending) clearTimeout(p.timer);
      pending.clear();
      try {
        sock?.write(buildFrame(0x8, Buffer.alloc(0)));
      } catch {}
      try {
        sock?.destroy();
      } catch {}
    }

    (async () => {
      sock = await openSocket();
      sock.setNoDelay(true);
      sock.on("data", (chunk) => {
        recv = Buffer.concat([recv, chunk]);
        try {
          pump();
        } catch (e) {
          if (!hsDone) hsReject(e);
        }
      });
      sock.on("error", () => {});
      const wsKey = crypto.randomBytes(16).toString("base64");
      const req =
        `GET ${wsPath} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${wsKey}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        `Origin: http://${host}\r\n\r\n`;
      sock.write(req);
      pump();
      await hsP;
      resolve({ rpc, close, t0 });
    })().catch((e) => {
      if (!settled) {
        settled = true;
        clearTimeout(overallTimer);
        try {
          sock?.destroy();
        } catch {}
        reject(e);
      }
    });
  });
}

function shortErr(e) {
  const s = e && e.message ? e.message : String(e);
  return s.length > 180 ? s.slice(0, 177) + "..." : s;
}

async function probeNode(urlStr) {
  const started = Date.now();
  let conn = null;
  try {
    conn = await connect(urlStr, PER_NODE_TIMEOUT_MS);
  } catch (e) {
    return { hasHistory: false, latencyMs: Date.now() - started, connectError: shortErr(e), methods: {} };
  }
  const { rpc, close } = conn;
  const result = { hasHistory: false, latencyMs: 0, methods: {} };
  try {
    await rpc(1, "login", ["", ""]);
    const dbId = await rpc(1, "database", []);
    let histId = null;
    try {
      histId = await rpc(1, "history", [], HISTORY_RESOLVE_TIMEOUT_MS);
    } catch (e) {
      result.historyError = shortErr(e);
      result.hasHistory = false;
      result.latencyMs = Date.now() - started;
      close();
      return result;
    }
    if (histId === null || histId === undefined) {
      result.historyError = "history api id null";
      result.hasHistory = false;
      result.latencyMs = Date.now() - started;
      close();
      return result;
    }
    result.hasHistory = true;
    result.historyApiId = histId;

    const nowSec = Math.floor(Date.now() / 1000);
    const startIso = isoNoMs(nowSec - 7 * 86400);
    const endIso = isoNoMs(nowSec);

    // Buckets first: its result picks the bucket for get_market_history.
    let bucket = 3600;
    try {
      const buckets = await rpc(histId, "get_market_history_buckets", []);
      result.bucketsOffered = Array.isArray(buckets) ? buckets : [];
      result.methods.get_market_history_buckets = "ok";
      if (Array.isArray(buckets) && buckets.length) {
        bucket = buckets.includes(3600) ? 3600 : buckets[0];
      }
    } catch (e) {
      result.methods.get_market_history_buckets = "error:" + shortErr(e);
    }

    // Asset-pair discovery: symbols are chain-portable, raw IDs are not
    // (mainnet 1.3.1 does not resolve; testnet differs). Use the first two
    // symbols the node itself resolves so fill/market/trade errors, if any,
    // signal method absence — never a bad asset param. Provenance: same
    // lookup_asset_symbols pattern as tooling/market-buckets-probe.mjs.
    let assetA = "BTS";
    let assetB = "USD";
    try {
      const found = await rpc(dbId, "lookup_asset_symbols", [["BTS", "USD", "CNY", "TEST"]]);
      const ids = (Array.isArray(found) ? found : []).filter(Boolean).map((a) => a.id);
      if (ids.length >= 2) {
        assetA = ids[0];
        assetB = ids[1];
      }
      result.marketPair = [assetA, assetB];
    } catch (e) {
      result.marketPair = [assetA, assetB, "lookup-fallback:" + shortErr(e)];
    }

    const calls = [
      // op-history IDs live in space 1/type 11 ("1.11.0"); "0.0.0" asserts.
      // Provenance: wallet-extension/src/lib/bitshares-api.js:473,
      // astro-ui/src/nanoeffects/DexLiveOrderBook.ts:92-98.
      ["get_account_history", ["1.2.0", "1.11.0", 1, "1.11.0"]],
      ["get_relative_account_history", ["1.2.0", 0, 1, 0]],
      ["get_account_history_operations", ["1.2.0", 0, "1.11.0", "1.11.0", 1]],
      ["get_fill_order_history", [assetA, assetB, 1]],
      // NOTE: get_trade_history is a DATABASE api method per #4
      // database_api.hpp:662 (astro-ui calls it on db_api too:
      // DexLiveOrderBook.ts:86). Probed here on the history api id per
      // sweep spec — "Method not found" is the honest expected signal;
      // the supplementary databaseApi check below shows live availability.
      ["get_trade_history", [assetA, assetB, endIso, startIso, 1]],
      ["get_market_history", [assetA, assetB, bucket, startIso, endIso]],
      ["get_asset_holders", ["1.3.0", 0, 1]],
      ["get_asset_holders_count", ["1.3.0"]],
    ];
    for (const [method, params] of calls) {
      try {
        await rpc(histId, method, params);
        result.methods[method] = "ok";
      } catch (e) {
        result.methods[method] = "error:" + shortErr(e);
      }
    }
    // Supplementary (not part of the required methods map): the true homes
    // of get_trade_history (database_api) and get_asset_holders* (history_api
    // per api.hpp:573-581 — re-tried here on database to localize the gap).
    result.databaseApi = {};
    for (const [method, params] of [
      ["get_trade_history", [assetA, assetB, endIso, startIso, 1]],
      ["get_asset_holders", ["1.3.0", 0, 1]],
      ["get_asset_holders_count", ["1.3.0"]],
    ]) {
      try {
        await rpc(dbId, method, params);
        result.databaseApi[method] = "ok";
      } catch (e) {
        result.databaseApi[method] = "error:" + shortErr(e);
      }
    }
    result.latencyMs = Date.now() - started;
    close();
    return result;
  } catch (e) {
    result.connectError = shortErr(e);
    result.latencyMs = Date.now() - started;
    try {
      close();
    } catch {}
    return result;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let only = "all";
  let out = DEFAULT_OUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mainnet-only") only = "mainnet";
    else if (args[i] === "--testnet-only") only = "testnet";
    else if (args[i] === "--out" && args[i + 1]) {
      out = args[++i];
    }
  }
  const outPath = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
  const data = { date: new Date().toISOString().slice(0, 10), mainnet: {}, testnet: {} };

  const runList = async (list, key) => {
    for (const url of list) {
      process.stderr.write(`probing ${url} ...\n`);
      const r = await probeNode(url);
      data[key][url] = r;
      process.stderr.write(`  hasHistory=${r.hasHistory} methods=${Object.keys(r.methods).length}\n`);
    }
  };

  if (only === "all" || only === "mainnet") await runList(MAINNET_NODES, "mainnet");
  if (only === "all" || only === "testnet") await runList(TESTNET_NODES, "testnet");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n");
  console.log(JSON.stringify({ wrote: outPath, nodes: Object.keys(data.mainnet).length + Object.keys(data.testnet).length }));
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: String((e && e.message) || e) }));
  process.exit(1);
});
