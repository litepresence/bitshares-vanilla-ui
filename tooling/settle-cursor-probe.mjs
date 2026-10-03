#!/usr/bin/env node
/* settle-cursor-probe.mjs — live cursor semantics of get_settle_orders_by_account.
 * Provenance: framing copied from tooling/history-probe.mjs (stdlib-only RFC 6455
 *   hand-rolled WS: TCP/TLS -> WS upgrade -> login -> resolve "database" api id).
 *   Signature ground truth = reference/bitshares-core/libraries/app/include/graphene/app/
 *     database_api.hpp:569-571:
 *       get_settle_orders_by_account(account_name_or_id, start force_settlement_id_type, limit)
 *     hpp:563 note: "Force settlement objects(1.4.X) before this ID will be skipped
 *       in results. Pagination purposes." + ordered earliest settlement_date to latest.
 *     Caps: api_limit_get_settle_orders = 300 (application.hpp:70); current code
 *       vanilla/js/api/market.js mySettlements passes start="1.4.0" first-page-only.
 *   Market-wide harvest precedent = astro-ui FullSmartcoin.ts:62
 *     get_settle_orders [assetID, 100].
 * Flow per node: connect -> login ["",""] -> database api id ->
 *   lookup_asset_symbols([USD,CNY,EUR,GOLD,SILVER,bitUSD,bitCNY]) ->
 *   get_settle_orders [assetId, 100] (up to 5 assets) to HARVEST owner 1.2.x ids ->
 *   get_settle_orders_by_account(owner, "1.4.0", 10) [P0] ->
 *   if P0 non-empty with ids: P_high=(owner,maxId,10), P_low=(owner,minId,10),
 *     P_beyond=(owner,"1.4."+(max+100000),10) to decide direction:
 *     - "after/forward" (skip-before, hpp literal): P_low ~= P0, P_high = tail, P_beyond = [].
 *     - "backward/at-or-before" (get_account_history-style): P_high ~= P0, P_low = prefix.
 *     Overlapping vs disjoint pages decide it. Inclusive vs exclusive decided by
 *     whether the start id itself reappears in its own page.
 *   Fallback when harvest is empty: committee-account + "1.2.0" by_account P0.
 * Usage: node tooling/settle-cursor-probe.mjs
 * Runtime: node >= 18 (stdlib only: tls/net/crypto). Sequential, ~8s call timeouts.
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const PER_NODE_TIMEOUT_MS = 60000;
const CALL_TIMEOUT_MS = 8000;

const MAINNET_NODES = [
  "wss://api.bitshares.dev/ws",
  "wss://dex.iobanker.com/ws",
  "wss://node.xbts.io/ws",
];
const TESTNET_NODES = ["wss://testnet.xbts.io/ws"];
const HARVEST_SYMBOLS = ["USD", "CNY", "EUR", "GOLD", "SILVER", "BTC", "ETH"];

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
  headerLen += 4;
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
      if (opcode === 0x8 || opcode === 0x0a) return;
      if (opcode === 0x1 || opcode === 0x2) {
        if (fin) emitText(payload.toString("utf8"));
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
          if (big > BigInt(Number.MAX_SAFE_INTEGER)) return;
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
  return s.length > 220 ? s.slice(0, 217) + "..." : s;
}

function settleNum(id) {
  const m = /^1\.4\.(\d+)$/.exec(String(id || ""));
  return m ? Number(m[1]) : null;
}

function idsOf(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => r && r.id)
    .filter((x) => typeof x === "string");
}

function ownersOf(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const o = r && (r.owner || r.owner_account || r.account);
    if (typeof o === "string" && /^1\.2\.\d+$/.test(o) && !out.includes(o)) out.push(o);
  }
  return out;
}

async function probeNode(urlStr) {
  const started = Date.now();
  const calls = [];
  const rec = (label, args, outcome) => calls.push({ label, args, ...outcome });
  let conn = null;
  try {
    conn = await connect(urlStr, PER_NODE_TIMEOUT_MS);
  } catch (e) {
    return { node: urlStr, connectError: shortErr(e), latencyMs: Date.now() - started, calls, verdict: "NODE-DOWN" };
  }
  const { rpc, close } = conn;
  try {
    await rpc(1, "login", ["", ""]);
    const dbId = await rpc(1, "database", []);
    // Resolve MPA ids via symbols (chain-portable; raw ids differ testnet/mainnet).
    let symRows = null;
    try {
      symRows = await rpc(dbId, "lookup_asset_symbols", [HARVEST_SYMBOLS]);
      rec("lookup_asset_symbols", HARVEST_SYMBOLS, {
        ok: true,
        count: Array.isArray(symRows) ? symRows.filter(Boolean).length : 0,
        detail: (Array.isArray(symRows) ? symRows : []).filter(Boolean).map((a) => a.symbol + "=" + a.id),
      });
    } catch (e) {
      rec("lookup_asset_symbols", HARVEST_SYMBOLS, { ok: false, error: shortErr(e) });
    }
    const assetIds = (Array.isArray(symRows) ? symRows : [])
      .filter((a) => a && typeof a.id === "string" && /^1\.3\.\d+$/.test(a.id))
      .map((a) => ({ symbol: a.symbol, id: a.id }))
      .slice(0, 5);
    // Market-wide harvest: get_settle_orders [assetId, 100].
    const harvestedOwners = [];
    const harvestedSettleIds = [];
    for (const a of assetIds) {
      try {
        const rows = await rpc(dbId, "get_settle_orders", [a.id, 100]);
        const ids = idsOf(rows);
        const owners = ownersOf(rows);
        for (const o of owners) if (!harvestedOwners.includes(o)) harvestedOwners.push(o);
        for (const i of ids) if (!harvestedSettleIds.includes(i)) harvestedSettleIds.push(i);
        rec("get_settle_orders", [a.id, 100], {
          ok: true,
          count: Array.isArray(rows) ? rows.length : 0,
          ids: ids.slice(0, 12),
          owners: owners.slice(0, 8),
          asset: a.symbol,
        });
      } catch (e) {
        rec("get_settle_orders", [a.id, 100], { ok: false, error: shortErr(e), asset: a.symbol });
      }
      if (harvestedOwners.length >= 4) break;
    }
    // By-account probes: harvested owners first, then committee fallbacks.
    const candidates = [...harvestedOwners.slice(0, 3)];
    if (!candidates.includes("1.2.0")) candidates.push("1.2.0");
    const byAccountPages = [];
    let probeOwner = null;
    let p0 = null;
    for (const cand of candidates) {
      try {
        const rows = await rpc(dbId, "get_settle_orders_by_account", [cand, "1.4.0", 10]);
        const ids = idsOf(rows);
        const owners = ownersOf(rows);
        rec("get_settle_orders_by_account", [cand, "1.4.0", 10], {
          ok: true,
          count: Array.isArray(rows) ? rows.length : 0,
          ids,
          owners,
        });
        if (p0 === null && Array.isArray(rows) && rows.length > 0) {
          p0 = rows;
          probeOwner = cand;
        }
        byAccountPages.push({ cand, ids });
        if (p0 !== null) break; // stop at first owner WITH settlements; rest is cursor work
      } catch (e) {
        rec("get_settle_orders_by_account", [cand, "1.4.0", 10], { ok: false, error: shortErr(e) });
      }
    }
    // Also try name form once (cheap alias check) if nothing found yet.
    if (p0 === null) {
      try {
        const rows = await rpc(dbId, "get_settle_orders_by_account", ["committee-account", "1.4.0", 10]);
        rec("get_settle_orders_by_account", ["committee-account", "1.4.0", 10], {
          ok: true,
          count: Array.isArray(rows) ? rows.length : 0,
          ids: idsOf(rows),
          owners: ownersOf(rows),
        });
        if (Array.isArray(rows) && rows.length > 0) {
          p0 = rows;
          probeOwner = "committee-account";
        }
      } catch (e) {
        rec("get_settle_orders_by_account", ["committee-account", "1.4.0", 10], {
          ok: false,
          error: shortErr(e),
        });
      }
    }
    let cursor = null;
    if (p0 !== null && probeOwner !== null) {
      const p0ids = idsOf(p0);
      const nums = p0ids.map(settleNum).filter((n) => n !== null);
      const minN = Math.min(...nums);
      const maxN = Math.max(...nums);
      const minId = "1.4." + minN;
      const maxId = "1.4." + maxN;
      const beyondId = "1.4." + (maxN + 100000);
      const pages = { p0: p0ids };
      for (const [tag, start] of [["P_high", maxId], ["P_low", minId], ["P_beyond", beyondId]]) {
        try {
          const rows = await rpc(dbId, "get_settle_orders_by_account", [probeOwner, start, 10]);
          const ids = idsOf(rows);
          pages[tag] = ids;
          rec("get_settle_orders_by_account", [probeOwner, start, 10], {
            ok: true,
            count: Array.isArray(rows) ? rows.length : 0,
            ids,
            tag,
          });
        } catch (e) {
          pages[tag] = null;
          rec("get_settle_orders_by_account", [probeOwner, start, 10], {
            ok: false,
            error: shortErr(e),
            tag,
          });
        }
      }
      const set = (a) => new Set(Array.isArray(a) ? a : []);
      const p0s = set(pages.p0);
      const hiS = set(pages.P_high);
      const loS = set(pages.P_low);
      const beS = set(pages.P_beyond);
      const overlap = (a, b) => [...a].filter((x) => b.has(x));
      cursor = {
        owner: probeOwner,
        p0: pages.p0,
        P_high_start: maxId,
        P_high: pages.P_high,
        P_low_start: minId,
        P_low: pages.P_low,
        P_beyond_start: beyondId,
        P_beyond: pages.P_beyond,
        p0_contains_maxStart: p0s.has(maxId),
        p_high_contains_ownStart: hiS.has(maxId),
        p_low_contains_ownStart: loS.has(minId),
        overlap_p0_high: overlap(p0s, hiS),
        overlap_p0_low: overlap(p0s, loS),
        beyond_empty: beS.size === 0,
      };
      // Direction decision (set-overlap, order-agnostic — chain orders by date, not id).
      // hpp literal "objects before start are skipped" predicts: P_low ~= P0,
      // P_high = tail subset containing maxId, P_beyond = [].
      // Backward/at-or-before predicts the mirror: P_high ~= P0, P_low = prefix.
      const p0eq = (s) => s !== null && s.size === p0s.size && overlap(p0s, s).length === p0s.size;
      if (pages.P_high !== null && pages.P_low !== null && pages.P_beyond !== null) {
        if (p0eq(loS) && !p0eq(hiS) && hiS.size > 0 && hiS.size < p0s.size + 1 && beS.size === 0) {
          cursor.direction = "after/forward (skip-before)";
          cursor.inclusive = hiS.has(maxId) ? "inclusive (start id reappears)" : "exclusive (start id excluded)";
        } else if (p0eq(hiS) && !p0eq(loS)) {
          cursor.direction = "backward/at-or-before";
          cursor.inclusive = loS.has(minId) ? "inclusive" : "exclusive";
        } else if (beS.size === 0 && p0eq(loS) && p0eq(hiS) && p0s.size <= 10) {
          cursor.direction = "after/forward-single-page (P0 fits in one page; beyond empty agrees with skip-before)";
          cursor.inclusive = "undetermined (single page — use recipe below to pin inclusive/exclusive)";
        } else {
          cursor.direction = "MIXED/UNCLEAR (see overlap sets)";
        }
      } else {
        cursor.direction = "UNVERIFIABLE (a cursor call errored)";
      }
    }
    const latencyMs = Date.now() - started;
    close();
    return {
      node: urlStr,
      latencyMs,
      calls,
      harvestedOwners,
      harvestedSettleIds: harvestedSettleIds.slice(0, 20),
      cursor,
      verdict: cursor ? cursor.direction : "UNVERIFIABLE (no account with settlements found)",
    };
  } catch (e) {
    try {
      close();
    } catch {}
    return { node: urlStr, connectError: shortErr(e), latencyMs: Date.now() - started, calls, verdict: "NODE-ERROR" };
  }
}

async function main() {
  const out = { date: new Date().toISOString(), mainnet: [], testnet: [] };
  for (const u of MAINNET_NODES) {
    process.stderr.write(`probing ${u} ...\n`);
    const r = await probeNode(u);
    out.mainnet.push(r);
    process.stderr.write(`  verdict=${r.verdict} owners=${(r.harvestedOwners || []).length}\n`);
  }
  for (const u of TESTNET_NODES) {
    process.stderr.write(`probing ${u} ...\n`);
    const r = await probeNode(u);
    out.testnet.push(r);
    process.stderr.write(`  verdict=${r.verdict} owners=${(r.harvestedOwners || []).length}\n`);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: String((e && e.message) || e) }));
  process.exit(1);
});
