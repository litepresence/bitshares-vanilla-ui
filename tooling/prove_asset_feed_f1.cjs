/* prove_asset_feed_f1.cjs — F1 testnet proof: publish a price feed on
 * AFKTESTM11 (1.3.1850) via the REAL vanilla Asset.buildFeed path (corrected
 * legs: settlement.base == CER.base == MPA id, per bitshares-core
 * protocol/asset_ops.cpp:178 + asset.cpp:266) and re-read it.
 *
 * Runs the unmodified vanilla sources (chain/format/store/crypto/account/
 * tx/asset + vendored noble) in Node with a minimal stdlib WebSocket
 * polyfill (tls/net + RFC6455 framing, adapted from tooling/ws-probe.mjs).
 * Secrets: reads /workspace/tooling/testnet-lite-test-1.json via file and
 * uses active_priv_wif ONLY in the sign call — never printed or logged.
 *
 * Usage: node /workspace/tooling/prove_asset_feed_f1.cjs
 * Exit 0 on accepted-broadcast + re-read match; non-zero otherwise.
 */
"use strict";

const fs = require("fs");
const vm = require("vm");
const tls = require("tls");
const net = require("net");
const nodeCrypto = require("crypto");

const V = "/workspace/vanilla/js/";
const NODE_URL = "wss://testnet.xbts.io/ws";
const EXPECT_CHAIN = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
const SYMBOL = "AFKTESTM11";
const FIXTURE = "/workspace/tooling/testnet-lite-test-1.json";

/* ---- Minimal WebSocket client (client-masked text frames; ping->pong) ---- */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
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
  const mask = nodeCrypto.randomBytes(4);
  mask.copy(out, off); off += 4;
  for (let i = 0; i < len; i++) out[off + i] = payload[i] ^ mask[i % 4];
  return out;
}
class MiniWebSocket {
  constructor(url) {
    this.url = url; this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    this._recv = Buffer.alloc(0); this._hsDone = false;
    this._fragOp = null; this._fragParts = [];
    const u = new URL(url);
    const isTls = u.protocol === "wss:";
    const host = u.hostname, port = u.port ? Number(u.port) : (isTls ? 443 : 80);
    const path = (u.pathname || "/") + (u.search || "");
    const key = nodeCrypto.randomBytes(16).toString("base64");
    const req = `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n` +
      `Origin: http://${host}\r\n\r\n`;
    const expected = nodeCrypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    const sock = isTls
      ? tls.connect({ host, port, servername: host }, () => { try { sock.write(req); } catch (e) { this._fail(e); } })
      : net.connect({ host, port }, () => { try { sock.write(req); } catch (e) { this._fail(e); } });
    this._sock = sock;
    try { sock.setNoDelay(true); } catch (e) { /* noop */ }
    sock.once("error", (e) => this._fail(e));
    sock.on("data", (c) => { this._recv = Buffer.concat([this._recv, c]); try { this._pump(expected); } catch (e) { this._fail(e); } });
    sock.on("close", () => { this.readyState = 3; if (this.onclose) { try { this.onclose({}); } catch (e) {} } });
  }
  _fail(e) {
    if (this.readyState === 3) return;
    if (!this._hsDone) { this.readyState = 3; if (this.onerror) { try { this.onerror(e); } catch (x) {} } }
  }
  _emitText(text) { if (this.onmessage) { try { this.onmessage({ data: text }); } catch (e) {} } }
  _frame(opcode, fin, payload) {
    if (opcode === 0x9) { try { this._sock.write(buildFrame(0x0a, payload)); } catch (e) {} return; }
    if (opcode === 0x8) { try { this._sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch (e) {} return; }
    if (opcode === 0x0a) return;
    if (opcode === 0x1 || opcode === 0x2) {
      if (fin) {
        if (this._fragOp === null) this._emitText(payload.toString("utf8"));
        else { this._fragParts.push(payload); const full = Buffer.concat(this._fragParts); this._fragParts = []; this._fragOp = null; this._emitText(full.toString("utf8")); }
      } else { this._fragOp = opcode; this._fragParts = [payload]; }
      return;
    }
    if (opcode === 0x0) {
      this._fragParts.push(payload);
      if (fin) { const full = Buffer.concat(this._fragParts); this._fragParts = []; this._fragOp = null; this._emitText(full.toString("utf8")); }
    }
  }
  _pump(expected) {
    if (!this._hsDone) {
      const idx = this._recv.indexOf("\r\n\r\n");
      if (idx === -1) return;
      const head = this._recv.slice(0, idx).toString("latin1");
      this._recv = this._recv.slice(idx + 4);
      const m = head.split("\r\n")[0].match(/^HTTP\/\d\.\d\s+(\d+)/);
      if (!m || Number(m[1]) !== 101) throw new Error("handshake failed: " + head.split("\r\n")[0]);
      const am = head.match(/sec-websocket-accept:\s*(\S+)/i);
      if (!am || am[1].trim() !== expected) throw new Error("bad Sec-WebSocket-Accept");
      this._hsDone = true; this.readyState = 1;
      if (this.onopen) this.onopen();
    }
    for (;;) {
      if (this._recv.length < 2) return;
      const b0 = this._recv[0], b1 = this._recv[1];
      const fin = (b0 >> 7) & 1, opcode = b0 & 0x0f, masked = (b1 >> 7) & 1;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this._recv.length < 4) return; len = this._recv.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this._recv.length < 10) return;
        const big = this._recv.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too large");
        len = Number(big); off = 10;
      }
      let mask = null;
      if (masked) { if (this._recv.length < off + 4) return; mask = this._recv.slice(off, off + 4); off += 4; }
      if (this._recv.length < off + len) return;
      let payload = this._recv.slice(off, off + len);
      if (mask) { const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mask[i % 4]; payload = u; }
      this._recv = this._recv.slice(off + len);
      this._frame(opcode, fin, payload);
    }
  }
  send(s) {
    if (this.readyState !== 1) throw new Error("not connected");
    this._sock.write(buildFrame(0x1, Buffer.from(String(s), "utf8")));
  }
  close() { try { this._sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch (e) {} try { this._sock.destroy(); } catch (e) {} this.readyState = 3; }
}
globalThis.WebSocket = MiniWebSocket;
globalThis.document = { getElementById: () => null };

/* ---- Load the real vanilla sources (order mirrors index.html) ---- */
["vendor/noble-classic.js", "data/brainkey-dict.js", "chain.js", "store.js",
 "format.js", "crypto.js", "account.js", "tx.js", "asset.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const publisherId = fix.account_id; // 1.2.26833, lite-test-1 (non-secret)
  const wif = fix.active_priv_wif; // SECRET: in-memory only, never logged
  if (!publisherId || !wif) throw new Error("fixture missing account_id/active_priv_wif");

  const t0 = Date.now();
  const conn = await Chain.connect(NODE_URL, { timeoutMs: 25000 });
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: NODE_URL, chain_id_prefix: chainId.slice(0, 16), latencyMs: conn.latencyMs });

  // Describe the asset via the real Asset path.
  const info = await Asset.describe(SYMBOL);
  if (info.id !== "1.3.1850") throw new Error("unexpected asset id: " + info.id);
  if (!info.is_smartcoin || !info.bitasset || !info.bitasset.short_backing_asset)
    throw new Error("not-market-issued");
  const backing = info.bitasset.short_backing_asset;
  const dbId = await Chain.db();
  const bMeta = await Chain.call(dbId, "get_assets", [[backing]]);
  const backingPrec = (bMeta && bMeta[0]) ? bMeta[0].precision : 5;
  log({ step: "described", symbol: SYMBOL, id: info.id, precision: info.precision,
    backing, backingPrec, issuer: info.issuer_id });

  // Current feed legs (pre-publish read).
  const raw = await Chain.call(dbId, "lookup_asset_symbols", [[SYMBOL]]);
  const bitId = raw && raw[0] && raw[0].bitasset_data_id;
  const objs = bitId ? await Chain.call(dbId, "get_objects", [[bitId]]) : null;
  const cur = objs && objs[0] && objs[0].current_feed;
  if (cur) log({ step: "current_feed", settlement_base: cur.settlement_price.base.asset_id,
    settlement_quote: cur.settlement_price.quote.asset_id,
    cer_base: cur.core_exchange_rate.base.asset_id, cer_quote: cur.core_exchange_rate.quote.asset_id,
    mcr: cur.maintenance_collateral_ratio, mssr: cur.maximum_short_squeeze_ratio });
  else log({ step: "current_feed", value: null });

  // History check before retry: recent ops by the publisher on this asset.
  const histId = await Chain.history();
  const hist = await Chain.call(histId, "get_account_history", [publisherId, "1.11.0", 20, "1.11.0"]);
  let recentFeed = 0;
  (hist || []).forEach((h) => {
    const e = h[1] || h;
    if (e && Array.isArray(e.op) && e.op[0] === 19 && e.op[1] && e.op[1].asset_id === info.id) recentFeed++;
  });
  log({ step: "history_check", publisher: publisherId, recent_op19_on_asset: recentFeed });

  // Build via the REAL corrected path. CER base = MPA, quote = backing.
  const mcr = 1750, mssr = 1500;
  const pair = await Asset.buildFeed({
    publisherId, assetId: info.id,
    settleBaseRaw: Format.parseAmount("1", info.precision),
    settleQuoteRaw: Format.parseAmount("1", backingPrec),
    mcr, mssr,
    cerBaseRaw: Format.parseAmount("1", info.precision),
    cerQuoteRaw: Format.parseAmount("1", backingPrec),
    basePrec: info.precision, quotePrec: backingPrec
  });
  const legs = pair[1].feed;
  if (legs.settlement_price.base.asset_id !== info.id) throw new Error("builder settlement base wrong");
  if (legs.core_exchange_rate.base.asset_id !== info.id) throw new Error("builder CER base wrong (F1 regressed)");
  if (legs.settlement_price.quote.asset_id !== backing) throw new Error("builder settlement quote wrong");
  if (legs.core_exchange_rate.quote.asset_id !== backing) throw new Error("builder CER quote wrong");
  log({ step: "built_op19", settlement_base: legs.settlement_price.base.asset_id,
    settlement_quote: legs.settlement_price.quote.asset_id,
    cer_base: legs.core_exchange_rate.base.asset_id, cer_quote: legs.core_exchange_rate.quote.asset_id,
    settleBaseRaw: legs.settlement_price.base.amount, settleQuoteRaw: legs.settlement_price.quote.amount,
    cerBaseRaw: legs.core_exchange_rate.base.amount, cerQuoteRaw: legs.core_exchange_rate.quote.amount });

  // Fee from get_required_fees (never estimated).
  const f = await Asset.fee(pair, "1.3.0");
  pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
  log({ step: "fee", amount: f.amount, asset_id: f.asset_id });

  // Sign + broadcast + prove by re-read (real sendAndProve path).
  const unsigned = await Tx.buildTx([pair]);
  const signed = await Tx.sign(unsigned, wif);
  const want = { sb: legs.settlement_price.base.amount, sq: legs.settlement_price.quote.amount,
    cb: legs.core_exchange_rate.base.amount, cq: legs.core_exchange_rate.quote.amount };
  const r = await Asset.sendAndProve(signed, wif, async () => {
    try {
      const rr = await Chain.call(await Chain.db(), "lookup_asset_symbols", [[SYMBOL]]);
      const bid = rr && rr[0] && rr[0].bitasset_data_id;
      if (!bid) return null;
      const oo = await Chain.call(await Chain.db(), "get_objects", [[bid]]);
      const cf = oo && oo[0] && oo[0].current_feed;
      if (!cf) return null;
      const sameLegs = cf.settlement_price.base.asset_id === info.id &&
        cf.core_exchange_rate.base.asset_id === info.id &&
        cf.settlement_price.quote.asset_id === backing &&
        cf.core_exchange_rate.quote.asset_id === backing;
      const sameAmounts = String(cf.settlement_price.base.amount) === want.sb &&
        String(cf.settlement_price.quote.amount) === want.sq &&
        String(cf.core_exchange_rate.base.amount) === want.cb &&
        String(cf.core_exchange_rate.quote.amount) === want.cq;
      return (sameLegs && sameAmounts && cf.maintenance_collateral_ratio === mcr &&
        cf.maximum_short_squeeze_ratio === mssr) ? cf : null;
    } catch (e) { return null; }
  });
  const props = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
  log({ step: "published", via: r.via, head_block: props.head_block_number,
    reread_settlement_base: r.proof.settlement_price.base.asset_id,
    reread_settlement_quote: r.proof.settlement_price.quote.asset_id,
    reread_cer_base: r.proof.core_exchange_rate.base.asset_id,
    reread_cer_quote: r.proof.core_exchange_rate.quote.asset_id,
    elapsedMs: Date.now() - t0 });
  try { Chain.disconnect(); } catch (e) {}
}

main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
