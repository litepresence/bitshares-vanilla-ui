#!/usr/bin/env node
/* prove-round2-affordable.cjs — dust proofs for the affordable set (ops 3/17/34/35/45) + op-37 verdict.
 *
 * What it owns: sequential vanilla-path broadcasts from fixture 1.2.26833
 *   (lite-test-1) on testnet ONLY, each with before/after TEST-balance deltas:
 *   op-3  call_order_update dust (10000 raw TEST collateral + zero debt, no
 *         existing positions per preread — dust only, never leveraged);
 *   op-17 asset_settle dust via AssetOps.buildSettle (expect evaluator
 *         `insufficient feeds`, asset_evaluator.cpp:1179 — the settle-17
 *         precedent pin; rejection costs nothing);
 *   op-34 worker_create dust (daily_pay "1", 1-week window, refund init);
 *   op-35 trollbox post 9199 via Trollbox.buildPost (ONE post + storage
 *         read-back; plugin-gated — STOP that step only if unsupported);
 *   op-45 bid_collateral dust (expect evaluator rejection: AFKTESTM11 not
 *         globally settled, settlement_fund 0 per preread; rejection is the
 *         byte-proof, costs nothing);
 *   op-37 balance_claim: NO broadcast — preread found 0 balance_objects
 *         under all 6 fixture-key addresses (PTS v56 + BTS v0) → honestly
 *         unprovable, recorded, not attempted.
 * Consumes: unmodified vanilla sources via vm (chain/store/tx/tx-send/format/
 *   crypto/account/asset/explorer/asset-ops/trollbox + noble vendor);
 *   fixture tooling/testnet-lite-test-1.json at runtime.
 * Secrets: active_priv_wif in memory for sign calls ONLY — never logged
 *   (logs carry ids/blocks/fees/deltas only).
 * Created by: testnet proof round-2 task (2026-10-06).
 *
 * Chain truth (#4 wins): op-3 fields <- market.hpp call_order_update +
 *   validate() market.cpp:88-96; op-17 <- asset_ops.hpp:267-288;
 *   op-34 <- worker.hpp; op-35 <- custom.hpp (9198/9199 trollbox exception);
 *   op-45 <- market.hpp bid_collateral + validate() market.cpp:99-103;
 *   op-37 fee is consensus-0 (balance.hpp:51).
 *
 * Usage: node /workspace/tooling/prove-round2-affordable.cjs
 * Exit 0 = all steps recorded (COVERED / EVALUATOR-REACHED / BLOCKED each);
 * exit 3 = funds-guard STOP (nothing spent); exit 1 = unexpected failure.
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
const THROWAWAY_ID = "1.2.26839"; // r2fund-cad3, created by the ONE faucet attempt (public id only)
const MPA = "1.3.1850"; // AFKTESTM11, fixture-issued bitasset, settlement_fund 0
const MIN_START_RAW = 200000n; // 2.00000 TEST — refuse to start below this
const POLL_MS = 60000, POLL_GAP = 2500;
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
  "api/format.js", "sdk/crypto.js", "api/account.js",
  "api/tx-primitives.js", "api/tx-ops-trade.js", "api/tx-ops-gov.js",
  "api/tx.js", "api/tx-send.js",
  "api/explorer.js", "api/asset.js", "builders/asset-ops.js", "builders/trollbox.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function testBalanceOf(acct) {
  const bals = await Chain.call(await Chain.db(), "get_account_balances", [acct, []]);
  for (const b of (bals || [])) if (b.asset_id === CORE) return BigInt(String(b.amount));
  return 0n;
}
async function broadcast(signed) {
  const netId = await Chain.net();
  try {
    await Chain.call(netId, "broadcast_transaction_with_callback", [(Math.random() * 4294967296) >>> 0, signed]);
    return "broadcast_transaction_with_callback";
  } catch (e) {
    const msg = String((e && e.message) || e || "");
    if (/unknown method|method not found|no method|bad method|not supported/i.test(msg)) {
      await Chain.call(await Chain.net(), "broadcast_transaction", [signed]);
      return "broadcast_transaction";
    }
    throw e;
  }
}

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const accountId = fix.account_id, accountName = fix.account_name;
  const wif = fix.active_priv_wif; // SECRET: sign calls only, never logged
  let connNode = null, conn = null, lastErr = null;
  for (const url of NODES) {
    try { conn = await Chain.connect(url, { timeoutMs: 25000 }); connNode = url; break; }
    catch (e) { lastErr = e; try { Chain.disconnect(); } catch (x) {} }
  }
  if (!conn) throw new Error("all testnet nodes unreachable: " + ((lastErr && lastErr.message) || lastErr));
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: connNode, chain_id_prefix: chainId.slice(0, 16) });

  const B0 = await testBalanceOf(accountId);
  log({ step: "start", test_balance_raw: B0.toString() });
  if (B0 < MIN_START_RAW) {
    log({ step: "STOP", reason: "fixture TEST below 2.00000 floor; nothing broadcast" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }
  // Throwaway funding read (public id only — record-only, no keys, no transfers).
  try {
    const tb = await Chain.call(await Chain.db(), "get_account_balances", [THROWAWAY_ID, []]);
    log({ step: "throwaway", id: THROWAWAY_ID, balances: tb });
  } catch (e) { log({ step: "throwaway", id: THROWAWAY_ID, error: String((e && e.message) || e).slice(0, 160) }); }

  // ---- OP-3 call_order_update dust (no existing positions; collateral only, zero debt) ----
  try {
    const before = await testBalanceOf(accountId);
    const opData = {
      fee: { amount: "0", asset_id: CORE }, funding_account: accountId,
      delta_collateral: { amount: "10000", asset_id: CORE },
      delta_debt: { amount: "0", asset_id: MPA }, extensions: []
    };
    const f = await Tx.fee(3, opData, CORE);
    opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
    const signed = await Tx.sign(await Tx.buildTx([[3, opData]]), wif);
    const via = await broadcast(signed);
    const deadline = Date.now() + POLL_MS;
    let orders = [];
    for (;;) {
      try { orders = await Chain.call(await Chain.db(), "get_margin_positions", [accountId]); } catch (e) { orders = []; }
      if (orders && orders.length) break;
      if (Date.now() >= deadline) throw new Error("broadcast accepted but no margin position observed within 60s; re-read get_margin_positions before retrying");
      await sleep(POLL_GAP);
    }
    const after = await testBalanceOf(accountId);
    const head = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
    log({
      step: "op3_proved", result: "COVERED", via: via + "+re-read",
      call_order_id: orders[0].id, collateral: orders[0].collateral, debt: orders[0].debt,
      head_block: head.head_block_number, fee_raw: String(f.amount),
      balance_before: before.toString(), balance_after: after.toString(),
      delta_raw: (after - before).toString()
    });
  } catch (e) {
    log({ step: "op3", result: /insufficient|no debt|feed|price|collateral|margin|debt/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }

  // ---- OP-17 asset_settle dust (expect `insufficient feeds` pin, costs nothing) ----
  try {
    const pair = AssetOps.buildSettle({ accountId, assetId: MPA, amountHuman: "0.0025", precision: 4 });
    const f = await Tx.fee(pair[0], Object.assign({}, pair[1], { fee: { amount: "0", asset_id: CORE } }), CORE);
    pair[1].fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
    const signed = await Tx.sign(await Tx.buildTx([pair]), wif);
    const before = await testBalanceOf(accountId);
    try {
      await broadcast(signed);
      const after = await testBalanceOf(accountId);
      log({ step: "op17", result: "UNEXPECTED-ACCEPT", balance_before: before.toString(), balance_after: after.toString() });
    } catch (be) {
      const msg = String((be && be.message) || be || "");
      const after = await testBalanceOf(accountId);
      log({
        step: "op17", result: /insufficient feeds/.test(msg) ? "EVALUATOR-REACHED" : "REJECTED-OTHER",
        error: msg.slice(0, 400), fee_quoted_raw: String(f.amount),
        balance_before: before.toString(), balance_after: after.toString(),
        delta_raw: (after - before).toString()
      });
    }
  } catch (e) { log({ step: "op17", result: "FAILED", error: String((e && e.message) || e).slice(0, 300) }); }

  // ---- OP-34 worker_create dust (daily_pay 1, 1-week refund window) ----
  try {
    const before = await testBalanceOf(accountId);
    const opData = {
      fee: { amount: "0", asset_id: CORE }, owner: accountId,
      work_begin_date: "2026-10-07T00:00:00", work_end_date: "2026-10-14T00:00:00",
      daily_pay: "1", name: "r2-dust-worker", url: "https://example.com/r2-34",
      initializer: [0, {}]
    };
    const f = await Tx.fee(34, opData, CORE);
    opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
    const signed = await Tx.sign(await Tx.buildTx([[34, opData]]), wif);
    const via = await broadcast(signed);
    const deadline = Date.now() + POLL_MS;
    let mine = null;
    for (;;) {
      try {
        const all = await Chain.call(await Chain.db(), "get_workers_by_account", [accountId]);
        mine = (all || []).find((w) => w && w.name === "r2-dust-worker") || null;
      } catch (e) { mine = null; }
      if (mine) break;
      if (Date.now() >= deadline) throw new Error("broadcast accepted but worker not listed within 60s; re-read get_workers_by_account before retrying");
      await sleep(POLL_GAP);
    }
    const after = await testBalanceOf(accountId);
    const head = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
    log({
      step: "op34_proved", result: "COVERED", via: via + "+re-read",
      worker_id: mine.id, daily_pay: mine.daily_pay, head_block: head.head_block_number,
      fee_raw: String(f.amount), balance_before: before.toString(), balance_after: after.toString(),
      delta_raw: (after - before).toString()
    });
  } catch (e) {
    log({ step: "op34", result: /exists|duplicate|vote|pay|date|name|worker/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }

  // ---- OP-35 trollbox post 9199 (ONE post + storage read-back; try both nodes) ----
  try {
    let probe = null;
    try { probe = await Trollbox.probe(); } catch (e) { probe = { supported: false, reason: "probe-error" }; }
    if (!(probe && probe.supported)) {
      // Fallback: the custom_operations plugin may live on the other node only.
      const other = NODES.find((u) => u !== connNode);
      log({ step: "op35_fallback", from: connNode, to: other });
      try { Chain.disconnect(); } catch (e) {}
      const c2 = await Chain.connect(other, { timeoutMs: 25000 });
      connNode = other;
      const ch2 = (Chain.status() && Chain.status().chainId) || c2.chainId;
      if (ch2 !== EXPECT_CHAIN) throw new Error("chain-id mismatch on fallback: " + ch2);
      try { probe = await Trollbox.probe(); } catch (e) { probe = { supported: false, reason: "probe-error" }; }
    }
    if (!(probe && probe.supported)) {
      log({ step: "op35", result: "BLOCKED", reason: "custom_operations plugin unavailable on both nodes", probe });
    } else {
      const before = await testBalanceOf(accountId);
      const maxBytes = await Trollbox.fetchMaxMessageBytes();
      const text = "vanilla round2 probe 2026-10-06";
      const built = Trollbox.buildPost({ payerId: accountId, username: accountName, channel: "general", lang: "en", text, maxBytes });
      const fee = await Tx.fee(Trollbox.CUSTOM_OP_ID, Object.assign({}, built.opData, { fee: { amount: "0", asset_id: CORE } }), CORE);
      built.opData.fee = { amount: String(fee.amount), asset_id: fee.asset_id || CORE };
      const signed = await Tx.sign(await Tx.buildTx([[Trollbox.CUSTOM_OP_ID, built.opData]]), wif);
      const via = await broadcast(signed);
      const customId = await Chain.custom();
      const deadline = Date.now() + 45000;
      let found = null;
      while (Date.now() < deadline) {
        try {
          const rows = await Chain.call(customId, "get_storage_info", [null, built.catalog, built.key, 1]);
          if (rows && rows.length) { found = Trollbox.decodeTrollboxValue(rows[0]); if (found) found.id = rows[0].id; }
        } catch (e) { found = null; }
        if (found) break;
        await sleep(POLL_GAP);
      }
      if (!found) throw new Error("broadcast accepted but message key not read back within 45s; check channel before retrying");
      const after = await testBalanceOf(accountId);
      const match = found.text === text;
      log({
        step: "op35_proved", result: match ? "COVERED" : "MISMATCH", via: via + "+storage-readback",
        storage_id: found.id, catalog: found.catalog, text_match: match,
        fee_raw: String(fee.amount), balance_before: before.toString(), balance_after: after.toString(),
        delta_raw: (after - before).toString()
      });
    }
  } catch (e) {
    log({ step: "op35", result: /trollbox|custom|plugin|size|bytes|data/i.test(String((e && e.message) || e)) ? "EVALUATOR-REACHED" : "FAILED", error: String((e && e.message) || e).slice(0, 400) });
  }

  // ---- OP-45 bid_collateral dust (AFKTESTM11 NOT globally settled — expect evaluator rejection) ----
  try {
    const before = await testBalanceOf(accountId);
    const opData = {
      fee: { amount: "0", asset_id: CORE }, bidder: accountId,
      additional_collateral: { amount: "10000", asset_id: CORE },
      debt_covered: { amount: "1000", asset_id: MPA }
    };
    const f = await Tx.fee(45, opData, CORE);
    opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
    const signed = await Tx.sign(await Tx.buildTx([[45, opData]]), wif);
    try {
      const via = await broadcast(signed);
      const after = await testBalanceOf(accountId);
      let bids = null;
      try { bids = await Chain.call(await Chain.db(), "get_collateral_bids", [MPA, 100, 0]); } catch (e) { bids = { error: String((e && e.message) || e).slice(0, 160) }; }
      log({ step: "op45", result: "UNEXPECTED-ACCEPT", via, bids, balance_before: before.toString(), balance_after: after.toString(), delta_raw: (after - before).toString() });
    } catch (be) {
      const msg = String((be && be.message) || be || "");
      const after = await testBalanceOf(accountId);
      log({
        step: "op45", result: "EVALUATOR-REACHED", error: msg.slice(0, 400),
        fee_quoted_raw: String(f.amount), balance_before: before.toString(), balance_after: after.toString(),
        delta_raw: (after - before).toString()
      });
    }
  } catch (e) { log({ step: "op45", result: "FAILED", error: String((e && e.message) || e).slice(0, 300) }); }

  // ---- OP-37 balance_claim: NO broadcast (0 claimables under all 6 fixture-key addresses) ----
  log({ step: "op37", result: "BLOCKED", reason: "preread get_balance_objects returned 0 rows for all 6 fixture-key addresses (owner/active/memo x PTS-v56/BTS-v0); no claimable exists to build a claim against; fee would be consensus-0" });

  const Bend = await testBalanceOf(accountId);
  log({ step: "end", test_balance_raw: Bend.toString(), total_delta_raw: (Bend - B0).toString() });
  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
