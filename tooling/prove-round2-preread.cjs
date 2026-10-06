#!/usr/bin/env node
/* prove-round2-preread.cjs — read-only pre-state dump for testnet proof round 2 (2026-10-06).
 *
 * What it owns: ONE connection, ZERO broadcasts, ZERO key usage (no WIF read —
 *   only account_id + pubkeys from the fixture, which are public). Dumps:
 *   head block/time, account object (membership/registrar), ALL balances,
 *   op-8 fee, witness/committee objects, call/settle orders, fee quotes for
 *   ops 3/17/34/35/45/21/30/37 (dummy well-formed shapes, fee rail only),
 *   bitasset_data for AFKTESTM11 (feed + settlement state for ops 17/45),
 *   list_assets sample scan for globally-settled candidates (op-45),
 *   get_balance_objects for fixture-key derived addresses, both PTS (v56)
 *   and BTS (v0) variants (op-37 claimable check).
 * Consumes: vanilla Chain/Tx/Format/AssetOps/Trollbox via vm (same loader
 *   shape as tooling/prove-settle-17.cjs); fixture public fields only.
 * Secrets: NONE touched (no private keys, no WIFs — read-only by design).
 * Created by: testnet proof round-2 task (2026-10-06).
 *
 * Address derivation provenance: bitsharesjs lib/ecc/src/address.js
 *   (Address.fromPublic + toString, fetched raw 2026-10-06):
 *   rep=ripemd160(sha256(pubCompressed)); addr=[ver]+rep;
 *   check=sha256(sha256(addr))[:4]; addy=ripemd160(addr+check);
 *   string=prefix+base58(addy+ripemd160(addy)[:4]). Base58 below is the
 *   standard Bitcoin alphabet (local ~20 lines, no dep).
 *
 * Usage: node /workspace/tooling/prove-round2-preread.cjs
 * Exit 0 with JSON-lines dump on stdout; exit 1 on connect failure.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const tls = require("tls");
const net = require("net");
const nodeCrypto = require("crypto");

const V = "/workspace/vanilla/js/";
const NODES = ["wss://testnet.dex.trading/", "wss://testnet.xbts.io/ws"];
const EXPECT_CHAIN = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
const FIXTURE = "/workspace/tooling/testnet-lite-test-1.json";
const CORE = "1.3.0";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s) {
  let num = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("bad base58 char");
    num = num * 58n + BigInt(i);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  let buf = Buffer.from(hex, "hex");
  let lead = 0;
  for (const ch of s) { if (ch === "1") lead++; else break; }
  return Buffer.concat([Buffer.alloc(lead), buf]);
}
function b58encode(buf) {
  let num = BigInt("0x" + (buf.length ? buf.toString("hex") : "00"));
  let s = "";
  while (num > 0n) { const m = num % 58n; num = num / 58n; s = B58[Number(m)] + s; }
  for (let i = 0; i < buf.length && buf[i] === 0; i++) s = "1" + s;
  return s || "1";
}
function pubToBytes(pubBts, prefix) {
  const raw = b58decode(pubBts.slice(prefix.length));
  return raw.slice(0, -4); // strip checksum; compressed pubkey bytes
}
function addressFromPub(pubBts, prefix, version) {
  const pub = pubToBytes(pubBts, prefix);
  const rep = nodeCrypto.createHash("ripemd160").update(nodeCrypto.createHash("sha256").update(pub).digest()).digest();
  const addr = Buffer.concat([Buffer.from([version]), rep]);
  const c1 = nodeCrypto.createHash("sha256").update(addr).digest();
  const c2 = nodeCrypto.createHash("sha256").update(c1).digest().slice(0, 4);
  const addy = nodeCrypto.createHash("ripemd160").update(Buffer.concat([addr, c2])).digest();
  const chk = nodeCrypto.createHash("ripemd160").update(addy).digest().slice(0, 4);
  return prefix + b58encode(Buffer.concat([addy, chk]));
}

/* ---- Minimal WebSocket client (proven shape, cf. prove_witness_create_20.cjs) ---- */
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
    const req = `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`;
    const expected = nodeCrypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    const sock = isTls ? tls.connect({ host, port, servername: host }, () => { try { sock.write(req); } catch (e) { this._fail(e); } }) : net.connect({ host, port }, () => { try { sock.write(req); } catch (e) { this._fail(e); } });
    this._sock = sock;
    sock.once("error", (e) => this._fail(e));
    sock.on("data", (c) => { this._recv = Buffer.concat([this._recv, c]); try { this._pump(expected); } catch (e) { this._fail(e); } });
    sock.on("close", () => { this.readyState = 3; if (this.onclose) try { this.onclose({}); } catch (e) {} });
  }
  _fail(e) { if (this.readyState === 3) return; if (!this._hsDone) { this.readyState = 3; if (this.onerror) try { this.onerror(e); } catch (x) {} } }
  _emitText(t) { if (this.onmessage) try { this.onmessage({ data: t }); } catch (e) {} }
  _frame(opcode, fin, payload) {
    if (opcode === 0x9) { try { this._sock.write(buildFrame(0x0a, payload)); } catch (e) {} return; }
    if (opcode === 0x8) { return; }
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

["sdk/vendor/noble-classic.js", "sdk/data/brainkey-dict.js", "store.js", "sdk/chain.js",
  "api/format.js", "sdk/crypto.js", "api/account.js", "api/tx.js", "api/tx-send.js",
  "api/explorer.js", "api/asset.js", "builders/asset-ops.js", "builders/trollbox.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }
function zeroFee() { return { amount: "0", asset_id: CORE }; }
async function feeOf(type, data) {
  try {
    const f = await Tx.fee(type, data, CORE);
    return { ok: true, amount: String(f.amount), asset_id: f.asset_id || CORE };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200) }; }
}

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const accountId = fix.account_id, accountName = fix.account_name, prefix = fix.prefix || "TEST";
  let connNode = null, conn = null, lastErr = null;
  for (const url of NODES) {
    try { conn = await Chain.connect(url, { timeoutMs: 25000 }); connNode = url; break; }
    catch (e) { lastErr = e; try { Chain.disconnect(); } catch (x) {} }
  }
  if (!conn) throw new Error("all testnet nodes unreachable: " + ((lastErr && lastErr.message) || lastErr));
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: connNode, chain_id_prefix: chainId.slice(0, 16) });
  const dbId = await Chain.db();
  const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
  log({ step: "head", head_block: head.head_block_number, head_time: head.time });
  const accs = await Chain.call(dbId, "get_accounts", [[accountId]]);
  const acc = accs && accs[0];
  log({
    step: "account", id: accountId, name: accountName,
    membership: acc ? acc.membership_expiration_date : "missing",
    registrar: acc ? acc.registrar : "missing"
  });
  const bals = await Chain.call(dbId, "get_account_balances", [accountId, []]);
  log({ step: "balances_all", rows: bals });
  let testRaw = "0";
  for (const b of (bals || [])) if (b.asset_id === CORE) testRaw = String(b.amount);
  log({ step: "test_balance_raw", amount: testRaw });
  const wit = await Chain.call(dbId, "get_witness_by_account", [accountId]);
  const com = await Chain.call(dbId, "get_committee_member_by_account", [accountId]);
  log({ step: "witness", obj: wit ? { id: wit.id, url: wit.url } : null });
  log({ step: "committee", obj: com ? { id: com.id, url: com.url } : null });
  const calls = await Chain.call(dbId, "get_margin_positions", [accountId]);
  log({ step: "call_orders", count: (calls || []).length, rows: (calls || []).slice(0, 3) });
  let settles = null;
  try { settles = await Chain.call(dbId, "get_settle_orders_by_account", [accountId, "1.4.0", 100]); }
  catch (e) { settles = { error: String((e && e.message) || e).slice(0, 160) }; }
  log({ step: "settle_orders", value: Array.isArray(settles) ? { count: settles.length, rows: settles.slice(0, 3) } : settles });

  // Fee quotes (dummy well-formed shapes — fee rail only, no broadcast).
  log({ step: "fee_8", value: await feeOf(8, { fee: zeroFee(), account_to_upgrade: accountId, upgrade_to_lifetime_member: true }) });
  log({
    step: "fee_3", value: await feeOf(3, {
      fee: zeroFee(), funding_account: accountId,
      delta_collateral: { amount: "10000", asset_id: CORE },
      delta_debt: { amount: "100", asset_id: "1.3.1850" }, extensions: []
    })
  });
  let settlePair = null;
  try {
    settlePair = AssetOps.buildSettle({ accountId, assetId: "1.3.1850", amountHuman: "0.0025", precision: 4 });
    log({ step: "fee_17", value: await feeOf(settlePair[0], Object.assign({}, settlePair[1], { fee: zeroFee() })) });
  } catch (e) { log({ step: "fee_17", value: { ok: false, error: String((e && e.message) || e).slice(0, 200) } }); }
  log({
    step: "fee_34", value: await feeOf(34, {
      fee: zeroFee(), owner: accountId,
      work_begin_date: "2026-10-07T00:00:00", work_end_date: "2026-11-07T00:00:00",
      daily_pay: "100000", name: "round2-fee-probe", url: "https://example.com/r2",
      initializer: [0, {}]
    })
  });
  try {
    const built = Trollbox.buildPost({ payerId: accountId, username: accountName, channel: "general", lang: "en", text: "fee probe r2" });
    log({ step: "fee_35", value: await feeOf(35, Object.assign({}, built.opData, { fee: zeroFee() })) });
  } catch (e) { log({ step: "fee_35", value: { ok: false, error: String((e && e.message) || e).slice(0, 200) } }); }
  log({
    step: "fee_45", value: await feeOf(45, {
      fee: zeroFee(), bidder: accountId,
      additional_collateral: { amount: "10000", asset_id: CORE },
      debt_covered: { amount: "1000", asset_id: "1.3.1850" }
    })
  });
  const witId = wit && wit.id ? wit.id : "1.6.0";
  log({
    step: "fee_21", value: await feeOf(21, {
      fee: zeroFee(), witness: witId, witness_account: accountId, new_url: "https://example.com/r2"
    })
  });
  const comId = com && com.id ? com.id : "1.5.0";
  log({
    step: "fee_30", value: await feeOf(30, {
      fee: zeroFee(), committee_member: comId, committee_member_account: accountId, new_url: "https://example.com/r2"
    })
  });
  log({
    step: "fee_37", value: await feeOf(37, {
      fee: { amount: "0", asset_id: CORE }, deposit_to_account: accountId,
      balance_to_claim: "1.15.0", balance_owner_key: fix.owner_pub || fix.active_pub,
      total_claimed: { amount: "1", asset_id: CORE }
    })
  });

  // Bitasset state for ops 17/45: AFKTESTM11 + issuer assets.
  try {
    const rows = await Chain.call(dbId, "lookup_asset_symbols", [["AFKTESTM11"]]);
    const a = rows && rows[0];
    log({ step: "mpa_AFKTESTM11", id: a && a.id, issuer: a && a.issuer, bitasset_data_id: a && a.bitasset_data_id });
    if (a && a.bitasset_data_id) {
      const objs = await Chain.call(dbId, "get_objects", [[a.bitasset_data_id]]);
      const bd = objs && objs[0];
      log({
        step: "bitasset_data", id: a.bitasset_data_id,
        feed: bd && bd.current_feed ? {
          settlement_price_base: bd.current_feed.settlement_price.base,
          settlement_price_quote: bd.current_feed.settlement_price.quote,
          maintenance_collateral_ratio: bd.current_feed.maintenance_collateral_ratio
        } : null,
        settlement_fund: bd ? bd.settlement_fund : null,
        has_settlement: bd ? bd.has_settlement : null,
        is_prediction_market: bd ? bd.is_prediction_market : null,
        feeds: bd && bd.feeds ? bd.feeds.length : null
      });
    }
  } catch (e) { log({ step: "mpa_AFKTESTM11", error: String((e && e.message) || e).slice(0, 200) }); }

  // Op-45 scan: list assets, pick bitassets, report settlement flags (cap 8 bitasset_data reads).
  try {
    const listed = await Chain.call(dbId, "list_assets", ["", 100]);
    const bitIds = (listed || []).filter((x) => x && x.bitasset_data_id).slice(0, 8).map((x) => x.bitasset_data_id);
    log({ step: "list_assets", count: (listed || []).length, bitasset_sample: (listed || []).filter((x) => x && x.bitasset_data_id).slice(0, 8).map((x) => x.symbol + "/" + x.id) });
    if (bitIds.length) {
      const objs = await Chain.call(dbId, "get_objects", [bitIds]);
      log({
        step: "global_settle_scan",
        rows: (objs || []).map((o) => o ? {
          asset: o.asset_id, settlement_fund: o.settlement_fund,
          has_settlement: o.has_settlement, feed_base: o.current_feed ? o.current_feed.settlement_price.base : null
        } : null)
      });
    }
  } catch (e) { log({ step: "global_settle_scan", error: String((e && e.message) || e).slice(0, 200) }); }

  // Op-37: derive PTS(v56)+BTS(v0) addresses for all three fixture pubs, query claimables.
  try {
    const pubs = [fix.owner_pub, fix.active_pub, fix.memo_pub].filter(Boolean);
    const addrs = [];
    for (const p of pubs) for (const ver of [56, 0]) {
      try { addrs.push(addressFromPub(p, prefix, ver)); } catch (e) { /* skip */ }
    }
    log({ step: "claim_addresses", count: addrs.length });
    const found = await Chain.call(dbId, "get_balance_objects", [addrs]);
    log({ step: "balance_objects", count: (found || []).length, rows: (found || []).slice(0, 5) });
  } catch (e) { log({ step: "balance_objects", error: String((e && e.message) || e).slice(0, 300) }); }

  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
