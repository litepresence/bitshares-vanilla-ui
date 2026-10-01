#!/usr/bin/env node
/* probe-samet-combined.cjs — slice-13 Task-4 fix-2 proof: COMBINED [67,68] order.
 *
 * Finding D: the chain REJECTS a lone op-67 borrow verbatim
 *   `Unpaid SameT Fund debt detected` (db_block.cpp:778); only ONE tx
 *   [67 borrow, 68 repay] is ACCEPTED (proven block 100930730). The as-shipped
 *   separate Borrow/Repay buttons would always reject, so samet-ui.js now
 *   offers Borrow+Repay (single multi-op tx, fee filled on EVERY op per
 *   finding K) + a Repay-only path for existing unpaid debt.
 *
 * This run proves the COMBINED order through the REAL builders
 * (CreditSamet.buildSametCreate/Borrow/Repay/Delete + Tx.feeMulti +
 * Tx.buildTx + Credit.sendAndProve) on a FRESH throwaway fund that is
 * created and deleted in the same run:
 *   op 64 create (SMALL) -> [67 borrow + 68 repay] SMALL -> op 65 delete.
 * History is checked BEFORE any write; object state is re-read before every
 * step; an accepted-but-unproven send is never rebroadcast.
 *
 * Backbone wss://testnet.xbts.io/ws; chain id asserted against the fixture.
 * Fixture secrets are read from file and NEVER printed (only public ids,
 * amounts, blocks, fees reach the log).
 *
 * Usage: node tooling/probe-samet-combined.cjs [fixture-path] [node-url]
 */
"use strict";
const fs = require("node:fs");
const tls = require("node:tls");
const net = require("node:net");
const crypto = require("node:crypto");
const vm = require("node:vm");
const path = require("node:path");

const fixturePath = process.argv[2] || "/workspace/tooling/testnet-lite-test-1.json";
const urlStr = process.argv[3] || "wss://testnet.xbts.io/ws";
const CALL_TIMEOUT_MS = 15000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const ACCOUNT_ID = "1.2.26833";
const TEST_ID = "1.3.0";
const FUND_BAL_HUMAN = "2";    // SMALL throwaway fund: 2 TEST
const BORROW_HUMAN = "1";      // SMALL combined legs: borrow 1 / repay 1 TEST
const RATE_HUMAN = "0.1";      // -> 1000 units at denom 1M

function log(o) { console.error(JSON.stringify(o)); } // progress -> stderr; stdout stays final-JSON
function fail(step, err, extra) {
  console.log(JSON.stringify({ ok: false, step, error: String((err && err.message) || err), extra: extra || null }, null, 1));
  process.exit(1);
}

// ---- fixture (secrets stay in memory; only public fields logged) ----
let fixture;
try { fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")); }
catch (e) { fail("read-fixture", e); }
const ACTIVE_WIF = fixture.active_priv_wif;
if (typeof ACTIVE_WIF !== "string" || !ACTIVE_WIF) { fail("read-fixture", new Error("fixture has no active_priv_wif")); }
log({ step: "fixture", account: fixture.account_name + " (" + fixture.account_id + ")",
  chain_expect: String(fixture.chain_id).slice(0, 8) + "..." + String(fixture.chain_id).slice(-4),
  wif: "present(len " + ACTIVE_WIF.length + ", redacted)" });

// ---- stdlib WS (framing copied from tooling/ws-probe.mjs, same repo) ----
const parsed = new URL(urlStr);
const isTls = parsed.protocol === "wss:";
const host = parsed.hostname;
const port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
const wspath = (parsed.pathname || "/") + (parsed.search || "");
function openSocket() {
  return new Promise((resolve, reject) => {
    let sock;
    const onError = (e) => { try { sock.destroy(); } catch (_) {} reject(e); };
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
    let m; try { m = JSON.parse(t); } catch (_) { return; }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(new Error("rpc: " + JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  }
  function frame(op, fin, pl) {
    if (op === 0x9) { try { sock.write(buildFrame(0x0a, pl)); } catch (_) {} return; }
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
      recv = recv.slice(i + 4);
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
  sock.write(`GET ${wspath} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${wsKey}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`);
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
  const netId = await rpc(1, "network_broadcast", []);
  const chainId = await rpc(dbId, "get_chain_id", []);
  if (chainId !== fixture.chain_id) throw new Error("chain-id mismatch: got " + chainId);
  const props0 = await rpc(dbId, "get_dynamic_global_properties", []);
  log({ step: "connected", chain: chainId.slice(0, 8) + "..." + chainId.slice(-4), head: props0.head_block_number });

  // ---- load vanilla modules (real code paths, not re-implementations) ----
  const root = "/workspace/vanilla/js";
  const nobleSrc = fs.readFileSync(path.join(root, "sdk/vendor/noble-classic.js"), "utf8") +
    "\n;globalThis.__noble = { getPublicKey, signAsync, getSharedSecret };";
  vm.runInThisContext(nobleSrc, { filename: "noble-classic.js" });
  globalThis.nobleGetPublicKey = globalThis.__noble.getPublicKey;
  globalThis.nobleSignAsync = globalThis.__noble.signAsync;
  globalThis.nobleGetSharedSecret = globalThis.__noble.getSharedSecret;
  delete globalThis.__noble;
  globalThis.Format = require(path.join(root, "api/format.js"));
  globalThis.Crypto = require(path.join(root, "sdk/crypto.js"));
  globalThis.Chain = {
    db: async () => dbId, history: async () => histId, net: async () => netId,
    call: (api, m, p) => rpc(api, m, p),
    status: () => ({ state: "open", node: urlStr, latencyMs: 0, chainId }),
  };
  const Tx = require(path.join(root, "api/tx.js"));
  globalThis.Tx = Tx;
  const Credit = require(path.join(root, "api/credit.js"));
  globalThis.Credit = Credit;
  const CreditSamet = require(path.join(root, "builders/credit-samet.js"));
  globalThis.CreditSamet = CreditSamet;

  async function head() { return (await rpc(dbId, "get_dynamic_global_properties", [])).head_block_number || 0; }
  async function balances() { return rpc(dbId, "get_account_balances", [ACCOUNT_ID, []]); }
  function balOf(rows, assetId) { const r = (rows || []).find((b) => b.asset_id === assetId); return r ? String(r.amount) : "0"; }
  async function feeFillSingle(pair) {
    const ans = await Tx.fee(pair[0], pair[1], TEST_ID);
    pair[1].fee = { amount: String(ans.amount), asset_id: ans.asset_id };
    return pair[1].fee;
  }

  // ---- TEST precision (read, not assumed) + pre-flight reads (history FIRST) ----
  const assets = await rpc(dbId, "get_assets", [[TEST_ID]]);
  const TEST_PREC = assets[0].precision, TEST_SYM = assets[0].symbol;
  const h0 = await head();
  const bals0 = await balances();
  const test0 = balOf(bals0, TEST_ID);
  const histTail = await rpc(histId, "get_relative_account_history", [ACCOUNT_ID, 0, 10, 0])
    .then((rows) => (rows || []).map((r) => (r.op && r.op.op) ? r.op.op[0] : "?"))
    .catch((e) => "unreadable:" + String(e.message || e).slice(0, 80));
  const ownedBefore = await CreditSamet.fundsByOwner(ACCOUNT_ID, {});
  log({ step: "preflight", head: h0, TEST_sym: TEST_SYM, TEST_prec: TEST_PREC, TEST_raw: test0,
    history_tail_op_ids: histTail, owned_funds: ownedBefore.map((f) => f.id) });
  const needRaw = 1000000n; // 10 TEST headroom for fund + legs + fees
  if (BigInt(test0) < needRaw) throw new Error("TEST headroom too low (" + test0 + "), aborting");

  const BAL_RAW = globalThis.Format.parseAmount(FUND_BAL_HUMAN, TEST_PREC);
  const BORROW_RAW = globalThis.Format.parseAmount(BORROW_HUMAN, TEST_PREC);
  const RATE_UNITS = Credit.rateHumanToUnits(RATE_HUMAN); // 0.1% -> 1000 at denom 1M
  const FUND_FEE_RAW = Credit.creditFee(BORROW_RAW, RATE_UNITS); // ceil(amount*rate/1M)
  log({ step: "amounts", fund_raw: BAL_RAW, borrow_raw: BORROW_RAW, repay_raw: BORROW_RAW,
    rate_units: RATE_UNITS, fund_fee_raw: FUND_FEE_RAW });

  // ---- 1. op 64 create (fresh throwaway fund) ----
  const pair64 = CreditSamet.buildSametCreate({ accountId: ACCOUNT_ID, assetId: TEST_ID,
    balanceRaw: BAL_RAW, rateHuman: RATE_HUMAN });
  const fee64 = await feeFillSingle(pair64);
  const unsigned64 = await Tx.buildTx([pair64]);
  const hBefore64 = await head();
  const res64 = await Credit.sendAndProve(unsigned64, ACTIVE_WIF, async () => {
    try {
      const rows = await CreditSamet.fundsByOwner(ACCOUNT_ID, {});
      return rows.find((r) => r.asset_id === TEST_ID && r.balance_raw === BAL_RAW) || null;
    } catch (e) { return null; }
  });
  const fundId = res64.proof.id;
  const hAfter64 = await head();
  const balsAfter64 = await balances();
  log({ step: "op64-created", fund: fundId, rate_units: res64.proof.rate_units,
    unpaid_raw: res64.proof.unpaid_raw, fee_raw: fee64.amount, via: res64.via,
    head_before: hBefore64, head_after: hAfter64, TEST_raw: balOf(balsAfter64, TEST_ID) });

  // ---- 2. COMBINED [67 borrow + 68 repay] in ONE tx (fee on EVERY op) ----
  const b = CreditSamet.buildSametBorrow({ borrowerId: ACCOUNT_ID, fundId,
    borrowRaw: BORROW_RAW, borrowAssetId: TEST_ID });
  const r = CreditSamet.buildSametRepay({ accountId: ACCOUNT_ID, fundId,
    repayRaw: BORROW_RAW, feeRaw: FUND_FEE_RAW, assetId: TEST_ID });
  const ops = [[b[0], b[1]], [r[0], r[1]]];
  const multi = await Tx.feeMulti(ops, TEST_ID); // fills BOTH op fees in place
  const unsigned6768 = await Tx.buildTx(ops);
  const hBefore6768 = await head();
  const res6768 = await Credit.sendAndProve(unsigned6768, ACTIVE_WIF, async () => {
    try {
      const cur = await CreditSamet.fund(fundId);
      return cur.unpaid_raw === "0" ? cur : null;
    } catch (e) { return null; }
  });
  const hAfter6768 = await head();
  const balsAfter6768 = await balances();
  log({ step: "op6768-combined", fund: fundId, unpaid_raw: res6768.proof.unpaid_raw,
    balance_raw: res6768.proof.balance_raw,
    fee67_raw: String(ops[0][1].fee.amount), fee68_raw: String(ops[1][1].fee.amount),
    total_fee_raw: multi.totalRaw, via: res6768.via,
    head_before: hBefore6768, head_after: hAfter6768, TEST_raw: balOf(balsAfter6768, TEST_ID) });

  // ---- 3. op 65 delete (fee 0) ----
  const pair65 = CreditSamet.buildSametDelete({ accountId: ACCOUNT_ID, fundId });
  const fee65 = await feeFillSingle(pair65);
  const unsigned65 = await Tx.buildTx([pair65]);
  const hBefore65 = await head();
  let deleteNote = null, hAfter65 = null, via65 = null;
  try {
    const res65 = await Credit.sendAndProve(unsigned65, ACTIVE_WIF, async () => {
      try { await CreditSamet.fund(fundId); return null; }
      catch (e) { return /unknown-fund/.test(String((e && e.message) || e)) ? { gone: true } : null; }
    });
    hAfter65 = await head(); via65 = res65.via;
  } catch (e) {
    deleteNote = "delete rejected verbatim: " + String((e && e.message) || e).slice(0, 200);
  }
  const balsFinal = await balances();
  const hFinal = await head();
  log({ step: "op65-delete", fund: fundId, fee_raw: fee65.amount, via: via65,
    head_before: hBefore65, head_after: hAfter65, note: deleteNote,
    TEST_raw: balOf(balsFinal, TEST_ID) });

  const summary = {
    ok: deleteNote ? "partial" : true,
    fund: fundId,
    blocks: { preflight: h0, op64: [hBefore64, hAfter64], op6768: [hBefore6768, hAfter6768],
      op65: [hBefore65, hAfter65], final: hFinal },
    fees_raw_TEST: { op64_create: fee64.amount, op67_borrow_leg: String(ops[0][1].fee.amount),
      op68_repay_leg: String(ops[1][1].fee.amount), op6768_total: multi.totalRaw, op65_delete: fee65.amount },
    combined: { borrow_raw: BORROW_RAW, repay_raw: BORROW_RAW, fund_fee_raw: FUND_FEE_RAW,
      rate_units: RATE_UNITS, unpaid_after_raw: res6768.proof.unpaid_raw,
      balance_after_raw: res6768.proof.balance_raw },
    balances_raw_TEST: { before: test0, after_create: balOf(balsAfter64, TEST_ID),
      after_combined: balOf(balsAfter6768, TEST_ID), final: balOf(balsFinal, TEST_ID) },
    history_tail_op_ids: histTail,
    leftovers: deleteNote ? [fundId + " NOT deleted (" + deleteNote + ")"] : [],
    finding_D: "combined [67,68] ACCEPTED in one tx; lone op-67 rejected per prior proof (block 100930730)",
  };
  console.log(JSON.stringify(summary, null, 1));
  try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch (_) {}
  sock.destroy();
  process.exit(0);
}

main().catch((e) => fail("lifecycle", e));
