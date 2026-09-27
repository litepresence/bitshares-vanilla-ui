#!/usr/bin/env node
/* probe-pool-virgin-lifecycle.cjs — slice-12 Task-4 (b) second throwaway pool lifecycle.
 *
 * Goal: derive the VIRGIN-deposit mint rule empirically. Pool 1.19.66 showed
 * inA=100000/inB=10000 -> minted 100000 (geometric mean predicted 31622, wrong).
 * This run deposits ASYMMETRIC inA=40000/inB=90000 with a fresh share UIA and
 * reads the actual minted shares from the op-61 history result:
 *   minted == 90000  -> rule = max(raw)   (chain: liquidity_pool_evaluator.cpp
 *                        deposit branch: share_amount = max(amount_a, amount_b))
 *   minted == 40000  -> rule = inA        | minted == 60000 -> geometric mean.
 *
 * Backbone wss://testnet.xbts.io/ws; chain id asserted against the fixture file.
 * Fixture secrets are read from file and NEVER printed (only public ids, amounts,
 * blocks, fees reach the log). History/object state is re-read before ANY retry;
 * an accepted-but-unproven send is never rebroadcast. Pool left clean: full
 * withdraw + delete; the zero-supply share UIA object remains (chain has no UIA
 * delete — listed leftover).
 *
 * Usage: node tooling/probe-pool-virgin-lifecycle.cjs [fixture-path] [node-url]
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
const LEG_A = "1.3.0";       // TEST p5
const LEG_B = "1.3.1849";    // AFKTEST10 p4
const IN_A_RAW = "40000";    // 0.4 TEST
const IN_B_RAW = "90000";    // 9 AFKTEST10

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
  const nobleSrc = fs.readFileSync(path.join(root, "vendor/noble-classic.js"), "utf8") +
    "\n;globalThis.__noble = { getPublicKey, signAsync, getSharedSecret };";
  vm.runInThisContext(nobleSrc, { filename: "noble-classic.js" });
  globalThis.nobleGetPublicKey = globalThis.__noble.getPublicKey;
  globalThis.nobleSignAsync = globalThis.__noble.signAsync;
  globalThis.nobleGetSharedSecret = globalThis.__noble.getSharedSecret;
  delete globalThis.__noble;
  globalThis.BRAINKEY_DICT = [];
  globalThis.Format = require(path.join(root, "format.js"));
  globalThis.Crypto = require(path.join(root, "crypto.js"));
  globalThis.Chain = {
    db: async () => dbId, history: async () => histId, net: async () => netId,
    call: (api, m, p) => rpc(api, m, p),
    status: () => ({ state: "open", node: urlStr, latencyMs: 0, chainId }),
  };
  const Tx = require(path.join(root, "tx.js"));
  globalThis.Tx = Tx;
  const Pool = require(path.join(root, "pool.js"));
  globalThis.Pool = Pool;
  const AssetOps = require(path.join(root, "asset-ops.js"));
  globalThis.AssetOps = AssetOps;

  async function head() { return (await rpc(dbId, "get_dynamic_global_properties", [])).head_block_number || 0; }
  async function balances() { return rpc(dbId, "get_account_balances", [ACCOUNT_ID, []]); }
  function balOf(rows, assetId) { const r = (rows || []).find((b) => b.asset_id === assetId); return r ? String(r.amount) : "0"; }
  async function poolHist(poolId, lim) {
    return rpc(histId, "get_liquidity_pool_history", [poolId, null, null, lim || 10]);
  }

  // ---- pre-flight reads (history checked BEFORE any write) ----
  const h0 = await head();
  const bals0 = await balances();
  const testBal0 = balOf(bals0, LEG_A), legBBal0 = balOf(bals0, LEG_B);
  log({ step: "preflight", head: h0, TEST_raw: testBal0, AFKTEST10_raw: legBBal0 });
  if (BigInt(testBal0) < 28000000n) throw new Error("TEST headroom too low (" + testBal0 + "), aborting");
  if (BigInt(legBBal0) < BigInt(IN_B_RAW)) throw new Error("leg-B balance too low (" + legBBal0 + "), aborting");
  // 1.19.66 post-mortem: deleted pool must stay deleted (history tail = op 60).
  const old66 = await poolHist("1.19.66", 3).catch((e) => ({ err: String(e.message || e).slice(0, 120) }));
  log({ step: "history-1.19.66", tail_op_types: Array.isArray(old66) ? old66.map((r) => r.op_type) : old66 });
  // Ambiguity-B probe: unfiltered list form (2-arg vs 3-arg) — Pool.list records it.
  const sample = await Pool.list({ limit: 5 });
  log({ step: "ambiguity-B", listForm: Pool.listForm(), sample_count: sample.length });

  // ---- 1. fresh share UIA (lookup-before-create; never double-create) ----
  let suffix = String(h0 % 100000).padStart(5, "0");
  let symbol = "AFKPOOLV" + suffix, shareId = null, tries = 0;
  for (;;) {
    const found = await rpc(dbId, "lookup_asset_symbols", [[symbol]]);
    if (!found || !found[0]) break;
    if (++tries > 5) throw new Error("symbol space exhausted around " + symbol);
    suffix = String((Number(suffix) + 1) % 100000).padStart(5, "0");
    symbol = "AFKPOOLV" + suffix;
  }
  log({ step: "share-symbol", symbol });
  const createPair = AssetOps.buildCreate({ issuerId: ACCOUNT_ID, symbol, precision: 4,
    maxSupplyHuman: "1000000", marketFeePctHuman: "0", maxMarketFeeHuman: "1000000",
    permissions: 79, flags: 0, cerBaseRaw: Format.parseAmount("1", 5), cerQuoteRaw: Format.parseAmount("1", 4),
    cerBaseId: LEG_A, description: "", nft: null, bitasset: null, is_prediction_market: false });
  const fee10 = await AssetOps.fee(createPair, LEG_A);
  const unsigned10 = await Tx.buildTx([createPair]);
  const hBefore10 = await head();
  const res10 = await AssetOps.sendAndProve(unsigned10, ACTIVE_WIF, async () => {
    const f = await rpc(dbId, "lookup_asset_symbols", [[symbol]]);
    return f && f[0] ? f[0] : null;
  });
  shareId = res10.proof.id;
  const hAfter10 = await head();
  log({ step: "op10-created", share: shareId, symbol, fee_raw: fee10.amount, via: res10.via, head_before: hBefore10, head_after: hAfter10 });

  // ---- 2. create pool (op 59) ----
  const pair59 = Pool.buildCreate({ accountId: ACCOUNT_ID, assetAId: LEG_A, assetBId: LEG_B,
    shareId, takerHuman: "0.5", withdrawalHuman: "0" });
  const fee59 = await Pool.fee(pair59, LEG_A);
  const unsigned59 = await Tx.buildTx([pair59]);
  const hBefore59 = await head();
  const res59 = await Pool.sendAndProve(unsigned59, ACTIVE_WIF, async () => {
    const rows = await Pool.list({ share: shareId });
    return rows.length ? rows[0] : null;
  });
  const poolId = res59.proof.id;
  const hAfter59 = await head();
  log({ step: "op59-created", pool: poolId, fee_raw: fee59.amount, via: res59.via, head_before: hBefore59, head_after: hAfter59 });

  // ---- 3. virgin deposit (op 61), asymmetric inA=40000/inB=90000 ----
  const predicted = Pool.shareOut({ balanceA_raw: "0", balanceB_raw: "0", supply_raw: "0", inA_raw: IN_A_RAW, inB_raw: IN_B_RAW });
  const pair61 = Pool.buildDeposit({ accountId: ACCOUNT_ID, poolId, assetAId: LEG_A, assetBId: LEG_B,
    aHuman: "0.4", precA: 5, bHuman: "9", precB: 4 });
  if (pair61[1].amount_a.amount !== IN_A_RAW || pair61[1].amount_b.amount !== IN_B_RAW)
    throw new Error("builder raw mismatch: " + pair61[1].amount_a.amount + "/" + pair61[1].amount_b.amount);
  const fee61 = await Pool.fee(pair61, LEG_A);
  const unsigned61 = await Tx.buildTx([pair61]);
  const hBefore61 = await head();
  const res61 = await Pool.sendAndProve(unsigned61, ACTIVE_WIF, async () => {
    try { const cur = await Pool.get(poolId); return cur.balance_a_raw === IN_A_RAW ? cur : null; }
    catch (e) { return null; }
  });
  const hAfter61 = await head();
  const hist61 = await poolHist(poolId, 5);
  const depRow = (hist61 || []).find((r) => r.op_type === 61);
  const minted = depRow && depRow.op && depRow.op.op && depRow.op.op[1] ? null : null;
  let mintedRaw = null, depBlock = null, depFeePaid = null;
  if (depRow && depRow.op && depRow.op.op && Array.isArray(depRow.op.op)) {
    const d = depRow.op.op[1] || {};
    depBlock = depRow.op.block_num;
    depFeePaid = d.fee ? String(d.fee.amount) : null;
  }
  // minted shares = account's share balance now (sole minter) + history result cross-check
  const balsAfterDep = await balances();
  mintedRaw = balOf(balsAfterDep, shareId);
  let histReceived = null;
  try {
    const full = await rpc(histId, "get_liquidity_pool_history", [poolId, null, null, 5]);
    const dr = (full || []).find((r) => r.op_type === 61);
    const res = dr && dr.op && dr.op.result;
    // result shapes vary: [type, {...}] with received array
    const body = Array.isArray(res) ? res[1] : res;
    if (body && Array.isArray(body.received) && body.received[0]) histReceived = String(body.received[0].amount);
  } catch (e) { histReceived = "unreadable:" + String(e.message || e).slice(0, 80); }
  log({ step: "op61-deposit", pool: poolId, inA_raw: IN_A_RAW, inB_raw: IN_B_RAW,
    predicted_geomean_raw: predicted.share_raw, minted_balance_raw: mintedRaw, history_received_raw: histReceived,
    fee_raw: fee61.amount, via: res61.via, head_before: hBefore61, head_after: hAfter61,
    dep_block: depBlock, dep_fee_paid_raw: depFeePaid });
  void minted;

  const rule = (mintedRaw === "90000") ? "max(raw)" : (mintedRaw === "40000") ? "inA" : (mintedRaw === "60000") ? "geometric-mean" : "UNKNOWN(" + mintedRaw + ")";
  log({ step: "virgin-rule", observed_minted_raw: mintedRaw, rule });

  // ---- 4. full withdraw (op 62) ----
  const sharePrec = 4;
  const shareHuman = Format.formatAmount(mintedRaw, sharePrec);
  const pair62 = Pool.buildWithdraw({ accountId: ACCOUNT_ID, poolId, shareId, shareHuman, precShare: sharePrec });
  const fee62 = await Pool.fee(pair62, LEG_A);
  const unsigned62 = await Tx.buildTx([pair62]);
  const hBefore62 = await head();
  const res62 = await Pool.sendAndProve(unsigned62, ACTIVE_WIF, async () => {
    try { const cur = await Pool.get(poolId); return (cur.balance_a_raw === "0" && cur.balance_b_raw === "0") ? cur : null; }
    catch (e) { return null; }
  });
  const hAfter62 = await head();
  const balsAfterWd = await balances();
  log({ step: "op62-withdraw-full", share_burned_raw: mintedRaw, fee_raw: fee62.amount, via: res62.via,
    head_before: hBefore62, head_after: hAfter62, TEST_raw: balOf(balsAfterWd, LEG_A),
    AFKTEST10_raw: balOf(balsAfterWd, LEG_B), share_left_raw: balOf(balsAfterWd, shareId) });

  // ---- 5. delete (op 60, fee 0) ----
  const pair60 = Pool.buildDelete({ accountId: ACCOUNT_ID, poolId });
  const fee60 = await Pool.fee(pair60, LEG_A);
  const unsigned60 = await Tx.buildTx([pair60]);
  const hBefore60 = await head();
  const res60 = await Pool.sendAndProve(unsigned60, ACTIVE_WIF, async () => {
    try { await Pool.get(poolId); return null; } catch (e) { return { gone: true }; }
  });
  const hAfter60 = await head();
  const tailAfter = await poolHist(poolId, 3).catch((e) => ({ err: String(e.message || e).slice(0, 120) }));
  log({ step: "op60-delete", pool: poolId, fee_raw: fee60.amount, via: res60.via,
    head_before: hBefore60, head_after: hAfter60,
    tail_op_types: Array.isArray(tailAfter) ? tailAfter.map((r) => r.op_type) : tailAfter });

  // ---- money reconcile ----
  const balsFinal = await balances();
  const hFinal = await head();
  const summary = {
    ok: true, rule, pool: poolId, share: shareId, symbol,
    blocks: { preflight: h0, op10: [hBefore10, hAfter10], op59: [hBefore59, hAfter59], op61: [hBefore61, hAfter61], op62: [hBefore62, hAfter62], op60: [hBefore60, hAfter60], final: hFinal },
    fees_raw_TEST: { op10_create_asset: fee10.amount, op59_create_pool: fee59.amount, op61_deposit: fee61.amount, op62_withdraw: fee62.amount, op60_delete: fee60.amount },
    virgin: { inA_raw: IN_A_RAW, inB_raw: IN_B_RAW, predicted_geomean_raw: predicted.share_raw, minted_raw: mintedRaw, history_received_raw: histReceived, dep_block: depBlock },
    balances_raw: { TEST_before: testBal0, TEST_after: balOf(balsFinal, LEG_A), AFKTEST10_before: legBBal0, AFKTEST10_after: balOf(balsFinal, LEG_B), share_after: balOf(balsFinal, shareId) },
    leftovers: [shareId + " (" + symbol + ") zero-supply UIA — chain has no UIA delete"],
    ambiguity_B_listForm: Pool.listForm(),
  };
  console.log(JSON.stringify(summary, null, 1));
  try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch (_) {}
  sock.destroy();
  process.exit(rule === "max(raw)" ? 0 : 2);
}

main().catch((e) => fail("lifecycle", e));
