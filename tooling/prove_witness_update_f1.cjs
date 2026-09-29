/* prove_witness_update_f1.cjs — F1 testnet proof for ops 20/21 (+29/30):
 * witness_create / witness_update (+ committee_member_create) via the REAL
 * vanilla Tx serializers (tx.js) + fee/build/sign path (tx-send.js).
 *
 * Runs the unmodified vanilla sources (chain/store/tx/tx-send/format/
 * crypto/account + vendored noble) in Node with a minimal stdlib WebSocket
 * polyfill (tls/net + RFC6455 framing, adapted from tooling/ws-probe.mjs —
 * same proven shape as tooling/prove_asset_feed_f1.cjs).
 * Secrets: reads /workspace/tooling/testnet-lite-test-1.json via file and
 * uses active_priv_wif ONLY in the sign call — never printed or logged.
 *
 * Plan: broadcast each op with fixture-only testnet keys and classify the
 * node's answer. Rejected transactions are never included, so attempts cost
 * nothing and change nothing on chain:
 * - ACCEPTED + re-read match => full broadcast proof (block recorded).
 * - EVALUATOR-STAGE assert (error cites witness_evaluator.cpp /
 *   committee_member_evaluator.cpp do_evaluate with our op fields echoed) =>
 *   byte proof: the node deserialized our bytes AND verified the signature,
 *   then refused on a business rule (here: witness_evaluator.cpp:35
 *   requires is_lifetime_member(), and the fixture account is a basic
 *   faucet account — account_object.hpp:304-307 defines LTM as
 *   membership_expiration_date == time_point_sec::maximum()). Creates
 *   (ops 20/29) are therefore SKIPPED-with-reason per the task; updates
 *   (ops 21/30) are negative-proved against 1.6.0/1.5.0 (owner-mismatch or
 *   LTM assert — either is evaluator-reached). A follow-up with an LTM
 *   fixture account needs zero code changes for the full create->update
 *   proof.
 * - Anything else (fee/sign/build failure, non-evaluator broadcast error)
 *   => FAIL.
 *
 * Usage: node /workspace/tooling/prove_witness_update_f1.cjs
 * Exit 0 on proof-or-honest-skip with reasons; non-zero on failure.
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
const PROVE_TIMEOUT_MS = 45000;
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
  "format.js", "crypto.js", "account.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function broadcastTx(signed) {
  const netId = await Chain.net();
  const callbackId = (Math.random() * 4294967296) >>> 0;
  let via = "broadcast_transaction_with_callback";
  try {
    await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, signed]);
  } catch (e) {
    via = "broadcast_transaction";
    await Chain.call(netId, "broadcast_transaction", [signed]);
  }
  return via;
}

async function headBlock() {
  const props = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
  return (props && props.head_block_number) || 0;
}

async function proveWitnessUrl(accountId, wantUrl) {
  const deadline = Date.now() + PROVE_TIMEOUT_MS;
  for (;;) {
    let cur = null;
    try {
      const dbId = await Chain.db();
      cur = await Chain.call(dbId, "get_witness_by_account", [accountId]);
    } catch (e) { cur = null; }
    if (cur && cur.id && cur.url === wantUrl) return cur;
    if (Date.now() >= deadline) throw new Error("witness url not observed within " + PROVE_TIMEOUT_MS + "ms");
    await sleep(PROVE_INTERVAL_MS);
  }
}

/* Node-error classifier: an error that cites an evaluator source file
 * (do_evaluate/do_apply with the op echoed) means our bytes deserialized
 * and our signature verified — the chain refused on a business rule.
 * Returns {evaluatorReached, rule, file} for the log; anything else is a
 * real failure. */
function classifyNodeError(e) {
  const text = String((e && e.message) || e || "");
  if (!/evaluator\.cpp/.test(text)) return { evaluatorReached: false, excerpt: text.slice(0, 300) };
  // Evaluator source frame: {"file":"witness_evaluator.cpp","line":35,"method":"do_evaluate",...}
  const frame = text.match(/"file":"([a-z_]*evaluator\.cpp)","line":(\d+),"method":"([a-z_]+)"/)
    || text.match(/([a-z_]*evaluator\.cpp)[^0-9]*(\d+)[^a-z_]*([a-z_]+)/);
  // The assert itself: first non-empty "format":"..." in the error stack.
  let assertText = "";
  const re = /"format":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) { assertText = m[1]; break; }
  }
  return {
    evaluatorReached: true,
    file: frame ? frame[1] : "evaluator.cpp",
    line: frame ? frame[2] : "?",
    method: frame ? frame[3] : "?",
    assertText: assertText || "(empty format)"
  };
}

/* Broadcast one op and classify. On accept, run proveFn (re-read) for the
 * full proof; on evaluator-stage reject, record byte-proof evidence.
 * Returns a result string for the done table. */
async function attemptOp(label, opId, opData, wif, proveFn) {
  const f = await Tx.fee(opId, opData, CORE);
  opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
  log({ step: "fee_" + opId, label, amount: String(f.amount), asset_id: f.asset_id || CORE });
  const unsigned = await Tx.buildTx([[opId, opData]]);
  const signed = await Tx.sign(unsigned, wif);
  let via = null, sendErr = null;
  try {
    via = await broadcastTx(signed);
  } catch (e) { sendErr = e; }
  if (!sendErr) {
    const proof = await proveFn();
    const head = await headBlock();
    log({ step: "proved_" + opId, label, via, head_block: head, proof });
    return "proved at head block " + head + " (" + via + "+reread)";
  }
  const c = classifyNodeError(sendErr);
  const head = await headBlock();
  if (c.evaluatorReached) {
    log({
      step: "evaluator_reached_" + opId, label,
      evaluator: c.file + ":" + c.line + " " + c.method,
      assert: c.assertText, observed_head: head,
      note: "bytes deserialized + signature verified; business rule refused (rejected tx changes nothing, costs nothing)"
    });
    return "byte-proved (" + c.file + ":" + c.line + " " + c.assertText + "); skipped: " + label;
  }
  throw new Error(label + " unexpected node error: " + c.excerpt);
}

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const accountId = fix.account_id; // 1.2.x (non-secret)
  const accountName = fix.account_name; // testnet name (non-secret, fine to log)
  const wif = fix.active_priv_wif; // SECRET: in-memory only, never logged
  const memoPub = fix.memo_pub; // public key (non-secret)
  if (!accountId || !wif) throw new Error("fixture missing account_id/active_priv_wif");

  const t0 = Date.now();
  const conn = await Chain.connect(NODE_URL, { timeoutMs: 25000 });
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) throw new Error("chain-id mismatch: " + chainId);
  log({ step: "connected", node: NODE_URL, chain_id_prefix: chainId.slice(0, 16), latencyMs: conn.latencyMs });

  const dbId = await Chain.db();
  // TEST balance of the fixture account (affordability context for creates).
  let testBal = "0";
  try {
    const bals = await Chain.call(dbId, "get_account_balances", [accountId, [CORE]]);
    if (Array.isArray(bals) && bals[0] && bals[0].amount !== undefined) testBal = String(bals[0].amount);
  } catch (e) { testBal = "unknown"; }
  // Membership status (the LTM gate for ops 20/29 lives here, not in funds).
  let membership = "unknown";
  try {
    const rows = await Chain.call(dbId, "get_accounts", [[accountId]]);
    if (rows && rows[0]) membership = String(rows[0].membership_expiration_date || "missing");
  } catch (e) { /* stays unknown */ }
  const wit = await Chain.call(dbId, "get_witness_by_account", [accountId]);
  const com = await Chain.call(dbId, "get_committee_member_by_account", [accountId]);
  log({
    step: "pre_read", account: accountName, account_id: accountId,
    test_balance_raw: testBal, membership_expiration_date: membership,
    witness: wit ? { id: wit.id, url: wit.url } : null,
    committee: com ? { id: com.id, url: com.url } : null
  });

  const results = {};

  // --- Op 20 witness_create (fixture is not a witness => LTM assert expected).
  if (wit && wit.id) {
    results.witness_create = "skipped: account is already witness " + wit.id;
  } else {
    results.witness_create = await attemptOp("witness_create", 20, {
      fee: { amount: "0", asset_id: CORE },
      witness_account: accountId,
      url: "https://example.com/vanilla-prove-create",
      block_signing_key: memoPub
    }, wif, async () => {
      const cur = await proveWitnessUrl(accountId, "https://example.com/vanilla-prove-create");
      const objs = await Chain.call(await Chain.db(), "get_objects", [[cur.id]]);
      return { witness_id: cur.id, reread_url: objs && objs[0] ? objs[0].url : null };
    });
  }

  // --- Op 21 witness_update, URL only (full proof when the fixture owns a
  // witness; negative proof against 1.6.0 otherwise — either evaluator
  // answer proves the bytes).
  if (wit && wit.id) {
    const wantUrl = "https://example.com/vanilla-prove-u1";
    results.witness_update = await attemptOp("witness_update", 21, {
      fee: { amount: "0", asset_id: CORE },
      witness: wit.id, witness_account: accountId, new_url: wantUrl
    }, wif, async () => {
      const cur = await proveWitnessUrl(accountId, wantUrl);
      const objs = await Chain.call(await Chain.db(), "get_objects", [[cur.id]]);
      return { witness_id: cur.id, reread_url: objs && objs[0] ? objs[0].url : null };
    });
  } else {
    results.witness_update = await attemptOp("witness_update(negative vs 1.6.0)", 21, {
      fee: { amount: "0", asset_id: CORE },
      witness: "1.6.0", witness_account: accountId,
      new_url: "https://example.com/vanilla-prove-neg"
    }, wif, async () => ({ unexpected: "accepted" }));
  }

  // --- Op 29 committee_member_create (LTM assert expected, same as op 20).
  const comNow = await Chain.call(await Chain.db(), "get_committee_member_by_account", [accountId]);
  if (comNow && comNow.id) {
    results.committee_create = "skipped: account is already committee member " + comNow.id;
  } else {
    results.committee_create = await attemptOp("committee_member_create", 29, {
      fee: { amount: "0", asset_id: CORE },
      committee_member_account: accountId, url: "https://example.com/vanilla-prove-committee"
    }, wif, async () => {
      const deadline = Date.now() + PROVE_TIMEOUT_MS;
      for (;;) {
        let cur = null;
        try { cur = await Chain.call(await Chain.db(), "get_committee_member_by_account", [accountId]); }
        catch (e) { cur = null; }
        if (cur && cur.id) {
          const objs = await Chain.call(await Chain.db(), "get_objects", [[cur.id]]);
          return { committee_id: cur.id, reread_url: objs && objs[0] ? objs[0].url : null };
        }
        if (Date.now() >= deadline) throw new Error("committee object not observed");
        await sleep(PROVE_INTERVAL_MS);
      }
    });
  }

  // --- Op 30 committee_member_update (negative proof against 1.5.0).
  results.committee_update = await attemptOp("committee_member_update(negative vs 1.5.0)", 30, {
    fee: { amount: "0", asset_id: CORE },
    committee_member: "1.5.0", committee_member_account: accountId,
    new_url: "https://example.com/vanilla-prove-neg"
  }, wif, async () => ({ unexpected: "accepted" }));

  // Post-run balance (rejected txs cost nothing — confirm no drain).
  let testBalAfter = "?";
  try {
    const bals = await Chain.call(await Chain.db(), "get_account_balances", [accountId, [CORE]]);
    if (Array.isArray(bals) && bals[0] && bals[0].amount !== undefined) testBalAfter = String(bals[0].amount);
  } catch (e) { /* ignore */ }

  // Op 35 custom_operation: recorded, not broadcast (generic app payload op,
  // no voting-page path builds it — deferred with reason per the task).
  log({
    step: "deferred_notes",
    committee_member_update_op30: "serializer ships (byte-proved offline + evaluator-reached here); no full broadcast — no reference UI flow builds it",
    custom_op35: "deferred: custom_operation (operations.hpp:91) is a generic app payload op, not a governance op; no voting-page path builds it"
  });

  log({ step: "done", results, test_balance_before: testBal, test_balance_after: testBalAfter, elapsedMs: Date.now() - t0 });
  try { Chain.disconnect(); } catch (e) {}
}

main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
