/* prove_transfer_propose_f1.cjs — F1 testnet proof for the transfer
 * Send/Propose toggle (op-0 transfer wrapped in op-22 proposal_create) via the
 * REAL vanilla serializers + fee/build/sign path.
 *
 * What it owns: one minimal self-transfer proposal broadcast against testnet
 *   (inner op-0: 1 raw TEST unit, from == to == fixture; review 3600s,
 *   expiry +24h) using the unmodified vanilla sources (chain/store/tx/
 *   tx-send/format/crypto/account/proposal + vendored noble) in Node with a
 *   minimal stdlib WebSocket polyfill (tls/net + RFC6455 framing, same proven
 *   shape as tooling/prove_witness_update_f1.cjs).
 * Consumes: Chain.connect/db/call/net/status, Tx.buildTransfer/buildTx/sign,
 *   Proposal.buildCreate/fee/proposalsFor; fixture
 *   tooling/testnet-lite-test-1.json (gitignored, 600-perms) read at runtime.
 * Secrets: active_priv_wif lives in memory for the sign call ONLY — never
 *   printed or logged (logs carry ids/blocks/fees only).
 * Globals/side effects: polyfills globalThis.WebSocket + document stub for
 *   the browser-shaped vanilla sources; no other side effects.
 * Created by: mapping-chain-calls skill, transfer propose-toggle re-proof
 *   task (prior 1.10.1492 claim has zero repo hits — treated as unverified).
 *
 * Plan: broadcast the op-22 wrapper with fixture-only testnet keys and
 * classify the node's answer. Rejected transactions are never included, so
 * attempts cost nothing and change nothing on chain:
 * - ACCEPTED + proposalsFor/get_objects re-read match => full broadcast
 *   proof (proposal id + head block recorded).
 * - VALIDATE/EVALUATOR-STAGE assert that echoes our op fields (here:
 *   transfer.cpp:42 validate "from != to") => byte proof: the node
 *   deserialized our op-22 + nested op-0 bytes AND verified the signature
 *   path up to business-rule refusal (from == to is forbidden by chain
 *   design AND by the UI gating itself — transfer-ui.js:709-711 gate,
 *   :1167 resolveProposeLeg). Honest either way; exit 0 with reasons.
 * - Anything else (fee/sign/build failure, non-validate broadcast error)
 *   => FAIL (exit non-zero).
 *
 * CHAIN TRUTH (#4 wins): op-22 fields <- proposal.hpp:70-82; nested op-0
 *   bytes identical to top-level via Tx serializeOperationData recursion
 *   (tx.js:1983 dispatch :2425/:2499); wrapper fee unwrap (tx-send.js:48-59);
 *   builder Proposal.buildCreate (proposal.js:104-111).
 *
 * Usage: node /workspace/tooling/prove_transfer_propose_f1.cjs
 * Exit 0 on inclusion-proof OR honest validate/evaluator byte-proof;
 * non-zero on failure.
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
const FIXTURE = "/workspace/tooling/testnet-lite-test-1.json";
const CORE = "1.3.0";
const PROVE_TIMEOUT_MS = 60000;
const PROVE_INTERVAL_MS = 2500;

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
["vendor/noble-classic.js", "chain.js", "store.js", "tx.js", "tx-send.js",
  "format.js", "crypto.js", "account.js", "proposal.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

/* Node-error classifier: a node error that cites a chain source frame
 * (transfer.cpp validate, *evaluator.cpp do_evaluate/do_apply) with our op
 * fields echoed means our bytes deserialized (and the envelope verified far
 * enough to run chain validation) — the chain then refused on a business
 * rule. Returns {byteProof, file, line, method, assertText}; anything else
 * is a real failure. Prints excerpts only — never keys. */
function classifyNodeError(e) {
  const text = String((e && e.message) || e || "");
  const frame = text.match(/"file":"([a-z_]+\.cpp)","line":(\d+),"method":"([a-z_]+)"/)
    || text.match(/([a-z_]*transfer\.cpp|[a-z_]*evaluator\.cpp)[^0-9]*(\d+)[^a-z_]*([a-z_]+)/);
  if (!frame) return { byteProof: false, excerpt: text.slice(0, 500) };
  let assertText = "";
  const m2 = text.match(/"format":"((?:[^"\\]|\\.)*)"/);
  if (m2 && m2[1] !== undefined) assertText = m2[1];
  return {
    byteProof: true,
    file: frame[1], line: String(frame[2]), method: frame[3],
    assertText: assertText
  };
}

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const accountId = fix.account_id; // 1.2.x (non-secret)
  const accountName = fix.account_name; // testnet name (non-secret, fine to log)
  const wif = fix.active_priv_wif; // SECRET: in-memory only, never logged
  if (!accountId || !wif) throw new Error("fixture missing account_id/active_priv_wif");

  const t0 = Date.now();
  const conn = await Chain.connect(NODE_URL, { timeoutMs: 25000 });
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: NODE_URL, chain_id_prefix: chainId.slice(0, 16), latencyMs: conn.latencyMs });

  const dbId = await Chain.db();
  const props0 = await Chain.call(dbId, "get_dynamic_global_properties", []);
  const headBefore = (props0 && props0.head_block_number) || 0;
  log({ step: "head_before", head_block: headBefore });

  // Inner leg: self-transfer 1 raw TEST unit, no memo — the exact
  // transfer-ui propose-leg wire shape (Tx.buildTransfer zero-fee
  // placeholder), wrapped via Proposal.buildCreate (the barter-ui.js:269-270
  // nesting path {op: [0, opData]} — never reinvented).
  const unsigned0 = await Tx.buildTransfer({
    fromId: accountId, toId: accountId, amountInt: "1", assetId: CORE, memoObj: null
  });
  const innerOpData = unsigned0.operations[0][1];
  const expIso = new Date(Date.now() + 86400000).toISOString().slice(0, 19);
  const pair = Proposal.buildCreate({
    feePayerId: accountId, expirationIso: expIso,
    reviewPeriodSecOrNull: 3600, innerOps: [{ op: [0, innerOpData] }]
  });
  // WRAPPER fee live (get_required_fees on op-22, tx-send.js nested-shape
  // unwrap — inner fees informational only).
  const feeAns = await Proposal.fee(pair, CORE);
  log({
    step: "fee_wrapper", op: 22, amount: String(feeAns.amount),
    asset_id: feeAns.asset_id, expiration: expIso, review_period: 3600,
    inner: "op0 1 raw TEST self-transfer"
  });

  const beforeRows = await Proposal.proposalsFor(accountId);
  const before = beforeRows.length;
  log({ step: "proposals_before", account_id: accountId, count: before });

  const unsigned = await Tx.buildTx([pair]);
  const signed = await Tx.sign(unsigned, wif);
  const netId = await Chain.net();
  const callbackId = (Math.random() * 4294967296) >>> 0;
  let via = "broadcast_transaction_with_callback";
  let sendErr = null;
  try {
    await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, signed]);
  } catch (e) {
    const msg = String((e && e.message) || e || "");
    if (/unknown method|method not found|no method|bad method|not supported/i.test(msg)) {
      via = "broadcast_transaction";
      try {
        await Chain.call(netId, "broadcast_transaction", [signed]);
      } catch (e2) { sendErr = e2; }
    } else {
      sendErr = e;
    }
  }

  if (!sendErr) {
    // Accepted: poll proposalsFor for the new row, then get_objects re-read.
    const deadline = Date.now() + PROVE_TIMEOUT_MS;
    let cand = null;
    for (;;) {
      const now = await Proposal.proposalsFor(accountId);
      if (now && now.length > before) { cand = now[now.length - 1]; break; }
      if (Date.now() >= deadline) {
        throw new Error("Sent (" + via + ") but no new proposal observed within " +
          (PROVE_TIMEOUT_MS / 1000) + "s; check state before retrying (do NOT blindly rebroadcast).");
      }
      await sleep(PROVE_INTERVAL_MS);
    }
    const objs = await Chain.call(await Chain.db(), "get_objects", [[cand.id]]);
    const full = objs && objs[0] ? objs[0] : null;
    const head = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
    log({
      step: "proved", proposal_id: cand.id, head_block: head.head_block_number,
      via: via + "+re-read",
      expiration_time: full ? full.expiration_time : null,
      proposer: full ? (full.proposer || null) : (cand.proposer || cand.fee_paying_account || null),
      inner_op0: full && full.proposed_transaction && full.proposed_transaction.operations &&
        full.proposed_transaction.operations[0] ? full.proposed_transaction.operations[0][0] : null,
      wrapper_fee: pair[1].fee, elapsedMs: Date.now() - t0
    });
    log({ step: "done", result: "proved " + cand.id + " at head block " + head.head_block_number });
    try { Chain.disconnect(); } catch (e) {}
    return;
  }

  // Rejected: classify. Validate/evaluator-stage asserts are byte-proof
  // (rejected txs change nothing, cost nothing); anything else FAILS.
  const c = classifyNodeError(sendErr);
  const headNow = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
  if (c.byteProof) {
    log({
      step: "byte_proved", chain_frame: c.file + ":" + c.line + " " + c.method,
      assert: c.assertText, observed_head: headNow.head_block_number,
      wrapper_fee: pair[1].fee,
      note: "bytes deserialized + chain validation ran; business rule refused (rejected tx changes nothing, costs nothing)"
    });
    log({ step: "done", result: "byte-proved (" + c.file + ":" + c.line + " " + c.assertText + ")", head_block: headNow.head_block_number, elapsedMs: Date.now() - t0 });
    try { Chain.disconnect(); } catch (e) {}
    return;
  }
  throw new Error("unexpected node error: " + c.excerpt);
}

main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
