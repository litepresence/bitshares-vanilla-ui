#!/usr/bin/env node
/* generate_pool_skeleton.mjs — full pool-leg skeleton generator for the pool-net map.
 * Owns: paging live list_liquidity_pools + chunked lookup_asset_symbols joins,
 *   and emitting data-only vanilla/data/pools.json to stdout.
 * Consumes: one reachable WS node (argv[2] when given, else the first two
 *   mainnet defaults from Store.DEFAULT_NODES.mainnet with one retry before
 *   failing); nothing else. Side effects: stdout gets the generated JSON,
 *   stderr gets progress/counts; non-zero exit when all nodes fail (fails
 *   honestly offline — the last shipped skeleton still stands).
 * WS framing is an inline ~30-line stdlib-only handshake following the
 *   tooling/generate_pool_assets.mjs pattern (TCP/TLS + HTTP Upgrade +
 *   RFC6455 masked client frames); that file is standalone with no exports,
 *   so the handshake is duplicated here rather than imported. node: imports only.
 * Regenerate: node tooling/generate_pool_skeleton.mjs wss://api.bts.mobi/ws > vanilla/data/pools.json
 * Shape: {pools: [{id, a, b, share, symA, symB, symShare, precA, precB, precShare}], captured_at}
 *   sorted by pool numeric id. Ids/legs/syms are issuance-immutable; balances
 *   and fees are live-only and never enter this file.
 */
import tls from "node:tls";
import net from "node:net";
import crypto from "node:crypto";

/* First two mainnet defaults from the app's settings (provenance:
 * vanilla/js/store.js Store.DEFAULT_NODES.mainnet). First tried, second
 * is the single retry before failing. An explicit argv[2] node replaces
 * the list (testnet probes, single-node runs). */
const DEFAULT_NODES = ["wss://api.bts.mobi/ws", "wss://api.bitshares.dev/ws"];
const PAGE = 100;
const SYM_CHUNK = 100;
const POOL_START = "1.19.0";
const CALL_TIMEOUT_MS = 15000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Print a fatal message on stderr and exit non-zero.
 * @param {string} msg reason to report
 * @returns {never} never returns
 */
function usageError(msg) {
  console.error("generate_pool_skeleton: " + msg);
  process.exit(1);
}

/**
 * Build one masked RFC6455 client frame.
 * @param {number} opcode WS opcode (0x1 text, 0x8 close, 0x9/0xa ping/pong)
 * @param {Buffer} payload raw payload bytes
 * @returns {Buffer} framed bytes ready to write
 */
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

/**
 * Open one WS JSON-RPC session against a ws:// or wss:// URL.
 * @param {string} urlStr node URL
 * @returns {Promise<{rpc: function, close: function}>} session handle; rpc(apiId, method, params) resolves the result
 */
function connect(urlStr) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    const isTls = parsed.protocol === "wss:";
    const host = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
    const path = (parsed.pathname || "/") + (parsed.search || "");
    let sock;
    const onError = (e) => {
      try {
        sock.destroy();
      } catch {
        /* already gone */
      }
      reject(e);
    };
    if (isTls) {
      sock = tls.connect({ host, port, servername: host }, onOpen);
      sock.once("error", onError);
    } else {
      sock = net.connect({ host, port }, onOpen);
      sock.once("error", onError);
    }

    function onOpen() {
      sock.removeListener("error", onError);
      sock.on("error", () => {});
      let recv = Buffer.alloc(0);
      let handshakeDone = false;
      let fragParts = null;
      const pending = new Map();
      let nextId = 1;

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
          if (msg.error) p.reject(new Error("rpc error: " + JSON.stringify(msg.error)));
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
          if (fin) {
            if (fragParts) {
              fragParts.push(payload);
              const full = Buffer.concat(fragParts);
              fragParts = null;
              emitText(full.toString("utf8"));
            } else emitText(payload.toString("utf8"));
          } else fragParts = [payload];
          return;
        }
        if (opcode === 0x0) {
          fragParts = fragParts || [];
          fragParts.push(payload);
          if (fin) {
            const full = Buffer.concat(fragParts);
            fragParts = null;
            emitText(full.toString("utf8"));
          }
        }
      }

      function pump(handshake) {
        if (!handshakeDone) {
          const idx = recv.indexOf("\r\n\r\n");
          if (idx === -1) return;
          const head = recv.slice(0, idx).toString("latin1");
          recv = recv.slice(idx + 4);
          const m = head.split("\r\n")[0].match(/^HTTP\/\d\.\d\s+(\d+)/);
          if (!m || Number(m[1]) !== 101) {
            handshake.reject(new Error("handshake failed: " + head.split("\r\n")[0]));
            return;
          }
          const accept = head.match(/sec-websocket-accept:\s*(\S+)/i);
          const expected = crypto.createHash("sha1").update(wsKey + WS_GUID).digest("base64");
          if (!accept || accept[1].trim() !== expected) {
            handshake.reject(new Error("bad Sec-WebSocket-Accept"));
            return;
          }
          handshakeDone = true;
          handshake.resolve();
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

      let handshakeResolve;
      let handshakeReject;
      const handshakeP = new Promise((res, rej) => {
        handshakeResolve = res;
        handshakeReject = rej;
      });
      const wsKey = crypto.randomBytes(16).toString("base64");
      sock.on("data", (chunk) => {
        recv = Buffer.concat([recv, chunk]);
        try {
          pump({ resolve: handshakeResolve, reject: handshakeReject });
        } catch (e) {
          if (!handshakeDone) handshakeReject(e);
        }
      });
      sock.on("close", () => {
        if (!handshakeDone) handshakeReject(new Error("socket closed during handshake"));
      });
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: ${host}:${port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${wsKey}\r\n` +
          `Sec-WebSocket-Version: 13\r\n` +
          `Origin: http://${host}\r\n\r\n`
      );
      handshakeP.then(
        () => {
          /**
           * One JSON-RPC call on an already-open session.
           * @param {number} apiId API id from login/database
           * @param {string} method database API method
           * @param {Array} params method params
           * @returns {Promise<any>} RPC result
           */
          function rpc(apiId, method, params) {
            const id = nextId++;
            const body = JSON.stringify({ id, method: "call", params: [apiId, method, params || []] });
            return new Promise((res, rej) => {
              const timer = setTimeout(() => {
                pending.delete(id);
                rej(new Error("call timeout: " + method));
              }, CALL_TIMEOUT_MS);
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
          resolve({
            rpc,
            close() {
              try {
                sock.write(buildFrame(0x8, Buffer.alloc(0)));
              } catch {}
              try {
                sock.destroy();
              } catch {}
            }
          });
        },
        (e) => {
          try {
            sock.destroy();
          } catch {}
          reject(e);
        }
      );
    }
  });
}

/**
 * True for chain "I don't take those params" rejections (arg-form probe signal).
 * @param {any} e rejection
 * @returns {boolean} whether the call failed on params, not transport
 */
function isParamError(e) {
  return /invalid param|wrong|argument|parameter|signature/i.test(String((e && e.message) || e || ""));
}

/**
 * Advance one past a pool id for >= start_id paging.
 * @param {string} id pool id "1.19.N"
 * @returns {string} "1.19.(N+1)"
 */
function bumpPoolId(id) {
  const parts = String(id).split(".");
  return parts[0] + "." + parts[1] + "." + (parseInt(parts[2], 10) + 1);
}

/**
 * Numeric instance compare for pool ids ("1.19.9" < "1.19.10").
 * @param {string} a pool id
 * @param {string} b pool id
 * @returns {number} negative/zero/positive
 */
function cmpPoolId(a, b) {
  return parseInt(String(a).split(".")[2], 10) - parseInt(String(b).split(".")[2], 10);
}

/**
 * Page the whole liquidity-pool table and join asset symbols/precisions.
 * @param {string} url node URL
 * @returns {Promise<string>} pools.json document (stdout payload)
 */
async function generate(url) {
  const { rpc, close } = await connect(url);
  try {
    await rpc(1, "login", ["", ""]);
    const dbId = await rpc(1, "database", []);

    /* list_liquidity_pools arg-form probe (same ambiguity as Pool._listRaw
     * in vanilla/js/api/pool.js): header 2-arg first, 3-arg on param
     * rejection. The winning form pages the whole table. */
    let use3Arg = false;
    try {
      await rpc(dbId, "list_liquidity_pools", [PAGE, POOL_START]);
    } catch (e) {
      if (!isParamError(e)) throw e;
      await rpc(dbId, "list_liquidity_pools", [PAGE, POOL_START, false]);
      use3Arg = true;
    }

    const pools = [];
    let start = POOL_START;
    for (;;) {
      const args = use3Arg ? [PAGE, start, false] : [PAGE, start];
      const page = await rpc(dbId, "list_liquidity_pools", args);
      if (!Array.isArray(page)) throw new Error("list_liquidity_pools returned non-array");
      for (const p of page) pools.push(p);
      if (page.length < PAGE) break;
      const next = bumpPoolId(page[page.length - 1].id);
      if (parseInt(next.split(".")[2], 10) <= parseInt(start.split(".")[2], 10))
        throw new Error("paging did not advance at " + start);
      start = next;
    }

    /* Union of leg + share asset ids, then one lookup_asset_symbols per
     * <=100-id chunk (chain cap). Misses degrade to bare ids with null
     * precision — never a crash, never a guess at the symbol. */
    const union = [];
    const seen = new Set();
    for (const p of pools) {
      for (const id of [p.asset_a, p.asset_b, p.share_asset]) {
        if (typeof id === "string" && !seen.has(id)) {
          seen.add(id);
          union.push(id);
        }
      }
    }
    const byId = {};
    for (let i = 0; i < union.length; i += SYM_CHUNK) {
      const chunk = union.slice(i, i + SYM_CHUNK);
      const objs = await rpc(dbId, "lookup_asset_symbols", [chunk]);
      (objs || []).forEach((a, j) => {
        if (a && typeof a.symbol === "string" && Number.isInteger(a.precision)) {
          byId[chunk[j]] = { sym: a.symbol, prec: a.precision };
        }
      });
    }

    const rows = pools
      .filter((p) => p && typeof p.id === "string" && typeof p.asset_a === "string" &&
        typeof p.asset_b === "string" && typeof p.share_asset === "string")
      .map((p) => {
        const A = byId[p.asset_a] || { sym: p.asset_a, prec: null };
        const B = byId[p.asset_b] || { sym: p.asset_b, prec: null };
        const S = byId[p.share_asset] || { sym: p.share_asset, prec: null };
        return { id: p.id, a: p.asset_a, b: p.asset_b, share: p.share_asset,
          symA: A.sym, symB: B.sym, symShare: S.sym,
          precA: A.prec, precB: B.prec, precShare: S.prec };
      })
      .sort((x, y) => cmpPoolId(x.id, y.id));

    console.error(`generate_pool_skeleton: ${rows.length} pools, ${Object.keys(byId).length}/${union.length} symbols via ${url}`);
    return JSON.stringify({ pools: rows, captured_at: new Date().toISOString() }) + "\n";
  } finally {
    close();
  }
}

async function main() {
  const argNode = process.argv[2];
  const nodes = argNode ? [argNode] : DEFAULT_NODES.slice();
  const errors = [];
  for (const url of nodes) {
    try {
      console.error("connect", url);
      process.stdout.write(await generate(url));
      process.exit(0);
    } catch (e) {
      errors.push(url + ": " + ((e && e.message) || String(e)));
      console.error("generate_pool_skeleton: " + url + " failed (" + ((e && e.message) || e) + "), trying next");
    }
  }
  usageError("all nodes failed: " + errors.join(" | "));
}

main();
