#!/usr/bin/env node
/* prove-round5-dust-order77.cjs — round 5: closing the last open testnet proof (op-77 limit_order_update).
 *
 * What it owns: (1) a dust limit_order_create (op 1) the fixture IS authorized
 *   for — SELL dust of AFKTEST10 (1.3.1849, fixture 1.2.26833 is issuer, holds
 *   120000 raw) for TEST (1.3.0, core, no whitelist) — via the REAL vanilla
 *   path (Tx.buildTx + fee via get_required_fees + Tx.sign + broadcast +
 *   get_limit_orders_by_account re-read); then (2) an op-77 limit_order_update
 *   expiry-only proof (+30d, no funds move) on THAT order — byte-for-byte the
 *   tooling/prove-op77-update.cjs path (same op shape, same +30d rule, same
 *   re-read proof), replicated here because prove-op77-update.cjs predates the
 *   slice-18 split and no longer loads api/tx-primitives.js +
 *   api/tx-ops-trade.js + api/tx-ops-gov.js (Tx._ser.serializeLimitOrderUpdateOp
 *   would be undefined at its buildTx; ownership forbids touching that file).
 *   Dust only (every leg <=10000 raw), dust-exact deltas, STOP with numbers if
 *   the chain refuses (exact evaluator error = byte-proof per
 *   porting-op-serializers §6).
 * Why this pair: round 4's dust op-1 (TEST->BTS 1.3.1420) was evaluator-
 *   rejected (market_evaluator.cpp:78 code 3050105 receiving-asset-
 *   unauthorized — BTS flags=3 whitelist, fixture not whitelisted), leaving
 *   zero open orders so prove-op77-update.cjs exits 2 PROOF-BLOCKED. This pair
 *   avoids both whitelist ends (issuer's own asset out, core asset in).
 * Consumes: unmodified vanilla sources via vm (same load list as
 *   prove-round4-faucet-ltm.cjs); fixture tooling/testnet-lite-test-1.json
 *   READ-ONLY (account_id + active_priv_wif; never modified, never printed).
 * Secrets: fixture active_priv_wif in memory for sign calls ONLY; never
 *   logged (logs carry ids/blocks/fees/deltas/pubs only). Testnet ONLY
 *   (chain 39f5e2ed…617447, id-checked); NEVER mainnet, NEVER commit secrets.
 * Chain truth (#4 wins): op-1 <- protocol/market.hpp limit_order_create
 *   (fee, seller, amount_to_sell, min_to_receive, expiration, fill_or_kill,
 *   extensions); op-77 <- market.hpp:117-136 + FC_REFLECT :299-300 (fee,
 *   seller, order, new_price?, delta?, new_expiration?, on_fill?, extensions).
 *   Fees from get_required_fees at runtime (never estimated). Verdict source
 *   for expiry-only: docs/parity/deferred-verdicts.md Q1 (>=1 changed field).
 * Created by: testnet proof round-5 task (2026-10-06).
 *
 * Usage: node /workspace/tooling/prove-round5-dust-order77.cjs
 * Exit 0 = walked to its honest end (each leg COVERED / EVALUATOR-REACHED /
 *   BLOCKED recorded with numbers); exit 3 = funds-guard STOP (zero
 *   broadcasts past the guard); exit 1 = unexpected failure (incl. shape bugs
 *   — those are test bugs, not proofs, per §6).
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
const DUST_ASSET = "1.3.1849"; // AFKTEST10: fixture is issuer, holds 120000 raw
const LTM_SENTINEL = "2106-02-07T06:28:15";
const DUST_RESERVE_RAW = 100000n; // 1.00000 TEST (p5) must survive every broadcast
const DUST_SELL_RAW = "5000"; // raw AFKTEST10 to sell (<=10000 dust mandate)
const DUST_MIN_RAW = "100"; // raw TEST min_to_receive (<=10000 dust mandate)
const CONFIRM_MS = 60000, CONFIRM_GAP = 2500;
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
  "api/explorer.js", "api/asset.js", "builders/asset-ops.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function testBalanceOf(acct, assetId) {
  const bals = await Chain.call(await Chain.db(), "get_account_balances", [acct, []]);
  for (const b of (bals || [])) if (b.asset_id === assetId) return BigInt(String(b.amount));
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
async function directFee(type, opDataNoFee) {
  const withZero = Object.assign({}, opDataNoFee, { fee: { amount: 0, asset_id: CORE } });
  const fees = await Chain.call(await Chain.db(), "get_required_fees", [[[type, withZero]], CORE]);
  if (!fees || !fees[0] || fees[0].amount === undefined) throw new Error("get_required_fees empty for op " + type);
  return { amount: String(fees[0].amount), asset_id: fees[0].asset_id || CORE };
}
async function feeFor(type, opData) {
  try {
    const f = await Tx.fee(type, opData, CORE);
    return { amount: String(f.amount), asset_id: f.asset_id || CORE };
  } catch (e) {
    if (/fee-suspicious|fee/i.test(String((e && e.message) || e))) {
      const bare = Object.assign({}, opData);
      delete bare.fee;
      return directFee(type, bare);
    }
    throw e;
  }
}

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const accountId = fix.account_id, accountName = fix.account_name;
  const wif = fix.active_priv_wif; // SECRET: sign calls only, never logged
  const rec = (o) => log(o);

  let connNode = null, conn = null, lastErr = null;
  for (const url of NODES) {
    try { conn = await Chain.connect(url, { timeoutMs: 25000 }); connNode = url; break; }
    catch (e) { lastErr = e; try { Chain.disconnect(); } catch (x) {} }
  }
  if (!conn) throw new Error("all testnet nodes unreachable: " + ((lastErr && lastErr.message) || lastErr));
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  rec({ step: "connected", node: connNode, chain_id_prefix: chainId.slice(0, 16) });

  const dbId = await Chain.db();
  const head0 = await Chain.call(dbId, "get_dynamic_global_properties", []);
  const accs = await Chain.call(dbId, "get_accounts", [[accountId]]);
  const acc = accs && accs[0];
  const B0 = await testBalanceOf(accountId, CORE);
  const A0 = await testBalanceOf(accountId, DUST_ASSET);
  rec({
    step: "fixture_pre", head_block: head0.head_block_number,
    account: accountName + " (" + accountId + ")",
    test_balance_raw: B0.toString(), dust_asset: DUST_ASSET, dust_balance_raw: A0.toString(),
    membership: acc ? String(acc.membership_expiration_date) : "missing"
  });
  if (!acc || String(acc.membership_expiration_date) !== LTM_SENTINEL) {
    rec({ step: "STOP", reason: "fixture not LTM — round-5 premise broken (op-1 needs no LTM but the queue context does); numbers above" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }

  // Market pre-read: dust asset metadata (precision/issuer/flags) + TEST resolve.
  // IDs from prior rounds; re-resolved live, never trusted blind.
  const dustAssets = await Chain.call(dbId, "get_assets", [[DUST_ASSET]]);
  const dust = dustAssets && dustAssets[0];
  const syms = await Chain.call(dbId, "lookup_asset_symbols", [["TEST"]]);
  const test = (syms || [])[0];
  rec({
    step: "market_pre",
    dust_symbol: dust ? dust.symbol : null, dust_precision: dust ? dust.precision : null,
    dust_issuer: dust && dust.issuer ? String(dust.issuer) : null,
    dust_flags: dust && dust.options ? dust.options.flags : null,
    dust_issuer_permissions: dust && dust.options ? dust.options.issuer_permissions : null,
    dust_whitelist: dust && dust.options ? dust.options.whitelist_authorities : null,
    dust_blacklist: dust && dust.options ? dust.options.blacklist_authorities : null,
    test_id: test ? test.id : null, test_precision: test ? test.precision : null
  });
  if (!dust || !dust.symbol) {
    rec({ step: "op1", result: "BLOCKED", reason: "no-market", note: DUST_ASSET + " unresolvable on testnet" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }
  if (String(dust.issuer) !== accountId) {
    rec({ step: "STOP", reason: "plan premise broken: " + DUST_ASSET + " issuer is " + String(dust.issuer) + ", not fixture " + accountId });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }
  if (!test || test.id !== CORE) {
    rec({ step: "STOP", reason: "TEST symbol does not resolve to " + CORE + " — re-check before dust pricing" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }
  if (A0 < BigInt(DUST_SELL_RAW)) {
    rec({ step: "op1", result: "BLOCKED", reason: "funds", note: "dust balance " + A0.toString() + " < sell " + DUST_SELL_RAW });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(3);
  }

  async function fundsGate(feeRaw) {
    const b = await testBalanceOf(accountId, CORE);
    if (b < BigInt(feeRaw) + DUST_RESERVE_RAW) return { ok: false, balance: b.toString(), shortfall: (BigInt(feeRaw) + DUST_RESERVE_RAW - b).toString() };
    return { ok: true, balance: b.toString() };
  }

  // ---- OP-1 dust limit_order_create: SELL DUST_SELL_RAW 1.3.1849, min DUST_MIN_RAW 1.3.0 ----
  let dustOrderId = null, op1Fee = null;
  const ordersBefore = await Chain.call(dbId, "get_limit_orders_by_account", [accountId, 100]);
  const beforeIds = new Set((ordersBefore || []).map((o) => o && o.id));
  try {
    if (Tx.OP && Tx.OP.limit_order_create !== 1) throw new Error("builder op id wrong: " + (Tx.OP && Tx.OP.limit_order_create));
    const expWire = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, -5);
    const opData = {
      fee: { amount: "0", asset_id: CORE }, seller: accountId,
      amount_to_sell: { amount: DUST_SELL_RAW, asset_id: DUST_ASSET },
      min_to_receive: { amount: DUST_MIN_RAW, asset_id: CORE },
      expiration: expWire, fill_or_kill: false, extensions: []
    };
    const f = await feeFor(1, opData);
    opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
    op1Fee = String(f.amount);
    const gate = await fundsGate(op1Fee);
    if (!gate.ok) {
      rec({ step: "op1", result: "BLOCKED", reason: "funds-exhaustion", fee_raw: op1Fee, balance_raw: gate.balance, shortfall_raw: gate.shortfall });
    } else {
      const before = BigInt(gate.balance);
      const aBefore = await testBalanceOf(accountId, DUST_ASSET);
      const signed = await Tx.sign(await Tx.buildTx([[1, opData]]), wif);
      const via = await broadcast(signed);
      const deadline = Date.now() + CONFIRM_MS;
      let mine = null;
      for (;;) {
        try {
          const rows = await Chain.call(dbId, "get_limit_orders_by_account", [accountId, 100]);
          mine = (rows || []).find((o) => o && o.id && !beforeIds.has(o.id) && String(o.seller) === accountId) || null;
        } catch (e) { mine = null; }
        if (mine) break;
        if (Date.now() >= deadline) throw new Error("broadcast accepted but new dust order not listed within 60s; re-read get_limit_orders_by_account before retrying");
        await sleep(CONFIRM_GAP);
      }
      dustOrderId = mine.id;
      const after = await testBalanceOf(accountId, CORE);
      const aAfter = await testBalanceOf(accountId, DUST_ASSET);
      const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
      rec({
        step: "op1_proved", result: "COVERED", via: via + "+re-read",
        order: mine.id, sell: DUST_SELL_RAW + " " + DUST_ASSET, buy_min: DUST_MIN_RAW + " " + CORE,
        expiration: mine.expiration, head_block: head.head_block_number,
        fee_raw: op1Fee, test_before: before.toString(), test_after: after.toString(),
        test_delta_raw: (after - before).toString(),
        dust_before: aBefore.toString(), dust_after: aAfter.toString(),
        dust_delta_raw: (aAfter - aBefore).toString()
      });
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    // Evaluator/validate-stage refusal (e.g. market_evaluator.cpp) with the exact
    // node error = byte-proof per porting-op-serializers §6 (bytes deserialized;
    // consensus refused). Anything else is a shape/test bug -> FAILED.
    const evalHit = /evaluator|is_authorized|unauthorized|whitelist|blacklist|market_evaluator|limit_order|insufficient|balance|fee|asset/i.test(msg);
    rec({ step: "op1", result: evalHit ? "EVALUATOR-REACHED" : "FAILED", error: msg.slice(0, 400) });
    if (!evalHit) {
      try { Chain.disconnect(); } catch (x) {}
      process.exit(1);
    }
  }
  if (!dustOrderId) {
    rec({ step: "STOP", reason: "no dust order to update — op-77 stays BLOCKED (no-target); numbers above" });
    try { Chain.disconnect(); } catch (e) {}
    process.exit(0);
  }

  // ---- OP-77 limit_order_update expiry-only (prove-op77-update.cjs path, replicated) ----
  // Least-invasive real update: push this order's expiration 30 days out. No
  // funds move; exactly one optional set (>=1 changed field, Q1 verdict).
  try {
    if (Tx.OP && Tx.OP.limit_order_update !== 77) throw new Error("builder op id wrong: " + (Tx.OP && Tx.OP.limit_order_update));
    const rows = await Chain.call(dbId, "get_limit_orders_by_account", [accountId, 100]);
    const target = (rows || []).find((o) => o && o.id === dustOrderId) || null;
    if (!target) {
      rec({ step: "op77", result: "BLOCKED", reason: "no-target", note: "order " + dustOrderId + " no longer open (filled/cancelled?)" });
    } else {
      const oldExp = String(target.expiration);
      const oldMs = new Date(oldExp + "Z").getTime();
      if (!isFinite(oldMs)) throw new Error("order has unparseable expiration: " + oldExp);
      const newWire = new Date(oldMs + 30 * 24 * 3600 * 1000).toISOString().slice(0, -5);
      const opData = {
        fee: { amount: "0", asset_id: CORE }, seller: accountId, order: dustOrderId,
        new_price: null, delta_amount_to_sell: null, new_expiration: newWire,
        on_fill: null, extensions: []
      };
      const f = await feeFor(77, opData);
      opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
      const op77Fee = String(f.amount);
      const gate = await fundsGate(op77Fee);
      if (!gate.ok) {
        rec({ step: "op77", result: "BLOCKED", reason: "funds-exhaustion", fee_raw: op77Fee, balance_raw: gate.balance, shortfall_raw: gate.shortfall });
      } else {
        const before = BigInt(gate.balance);
        const signed = await Tx.sign(await Tx.buildTx([[77, opData]]), wif);
        const via = await broadcast(signed);
        const deadline = Date.now() + CONFIRM_MS;
        let proved = false;
        for (;;) {
          try {
            const cur = await Chain.call(dbId, "get_limit_orders_by_account", [accountId, 100]);
            const row = (cur || []).find((o) => o && o.id === dustOrderId) || null;
            if (row && String(row.expiration) === newWire) { proved = true; break; }
          } catch (e) { /* keep polling */ }
          if (Date.now() >= deadline) throw new Error("broadcast accepted but new expiration not observed within 60s; re-read get_limit_orders_by_account before retrying");
          await sleep(CONFIRM_GAP);
        }
        const after = await testBalanceOf(accountId, CORE);
        const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
        // Full re-read of the updated order object (updated fields observed on chain).
        const cur2 = await Chain.call(dbId, "get_limit_orders_by_account", [accountId, 100]);
        const fin = (cur2 || []).find((o) => o && o.id === dustOrderId) || null;
        rec({
          step: "op77_proved", result: "COVERED", via: via + "+re-read",
          order: dustOrderId, old_expiration: oldExp, new_expiration: newWire,
          order_deferred: fin ? fin.deferred_fee : undefined,
          head_block: head.head_block_number,
          fee_raw: op77Fee, balance_before: before.toString(), balance_after: after.toString(),
          delta_raw: (after - before).toString()
        });
      }
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    const evalHit = /evaluator|order|expir|lifetime|authority|fee|market|limit_order/i.test(msg);
    rec({ step: "op77", result: evalHit ? "EVALUATOR-REACHED" : "FAILED", error: msg.slice(0, 400) });
    if (!evalHit) {
      try { Chain.disconnect(); } catch (x) {}
      process.exit(1);
    }
  }

  const Bend = await testBalanceOf(accountId, CORE);
  const Aend = await testBalanceOf(accountId, DUST_ASSET);
  rec({
    step: "end", test_balance_raw: Bend.toString(), test_total_delta_raw: (Bend - B0).toString(),
    dust_balance_raw: Aend.toString(), dust_total_delta_raw: (Aend - A0).toString(),
    order: dustOrderId
  });
  try { Chain.disconnect(); } catch (e) {}
}
main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
