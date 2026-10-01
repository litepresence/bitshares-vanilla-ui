/* prove_committee_create_29.cjs — full-inclusion proof for op-29
 * committee_member_create (URL only) via the REAL vanilla serializers +
 * fee/build/sign path.
 *
 * What it owns: one committee_member_create broadcast (fee payer = fixture
 *   account; url https://example.com/vanilla-committee-29) using the
 *   unmodified vanilla sources (chain/store/tx/tx-send/format/crypto/
 *   account + vendored noble) in Node with a minimal stdlib WebSocket
 *   polyfill (tls/net + RFC6455 framing, same proven shape as
 *   tooling/prove_witness_update_f1.cjs).
 * Consumes: Chain.connect/db/call/net/status, Tx.fee/buildTx/sign; fixture
 *   tooling/testnet-lite-test-1.json (gitignored, 600-perms) read at runtime.
 * Secrets: active_priv_wif lives in memory for the sign call ONLY — never
 *   printed or logged (logs carry ids/blocks/fees only).
 * Globals/side effects: polyfills globalThis.WebSocket + document stub for
 *   the browser-shaped vanilla sources; on success creates one committee
 *   object for the fixture account (NO delete op exists — leftover testnet
 *   clutter is recorded honestly in the note, never hidden).
 * Created by: LTM-upgrade + witness/committee inclusion task (2026-09-30).
 *
 * Pre-broadcast gates (STOP with reason, exit non-zero, nothing broadcast):
 * - fixture account must already be a lifetime member (chain rule:
 *   committee_member_evaluator.cpp:37 requires is_lifetime_member(); LTM
 *   sentinel is membership_expiration_date == 2106-02-07T06:28:15 per
 *   account_object.hpp).
 * - fixture TEST balance must cover the op-29 fee AND leave DUST_RESERVE raw
 *   units for further proofs (task rule: never drain the fixture).
 * - an existing committee object for the account short-circuits: same URL =>
 *   re-read proof without broadcasting; different URL => STOP (one member
 *   record per account, no update path attempted here).
 *
 * CHAIN TRUTH (#4 wins): op-29 fields <- committee_member.hpp:103-104 (fee,
 *   committee_member_account, url — NO extensions field); op id <-
 *   operations.hpp:85-86; fee via get_required_fees (never estimated);
 *   block_id_type = ripemd160 = 40 hex chars (types.hpp:304).
 *
 * Usage: node /workspace/tooling/prove_committee_create_29.cjs
 * Exit 0 on inclusion-proof (committee id + head block + get_objects
 *   re-read) or honest already-proved re-read; non-zero on STOP/failure.
 */
"use strict";

const fs = require("fs");
const vm = require("vm");
const tls = require("tls");
const net = require("net");
const nodeCrypto = require("crypto");

const V = "/workspace/vanilla/js/";
const NODE_URL = "wss://testnet.dex.trading/";
const EXPECT_CHAIN = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
const FIXTURE = "/workspace/tooling/testnet-lite-test-1.json";
const CORE = "1.3.0";
const WANT_URL = "https://example.com/vanilla-committee-29";
const LTM_SENTINEL = "2106-02-07T06:28:15";
const DUST_RESERVE_RAW = "100000"; // 1.00000 TEST (p5) must survive every broadcast
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
["sdk/vendor/noble-classic.js", "sdk/chain.js", "store.js", "api/tx.js", "api/tx-send.js",
  "api/format.js", "sdk/crypto.js", "api/account.js"
].forEach((f) => {
  vm.runInThisContext(fs.readFileSync(V + f, "utf8"), { filename: V + f });
});

function log(o) { console.log(JSON.stringify(o)); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
function stopErr(step, reason, extra) {
  log(Object.assign({ step, result: "STOP", reason }, extra || {}));
  try { Chain.disconnect(); } catch (e) {}
  process.exit(3);
}

async function main() {
  const fix = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const accountId = fix.account_id; // 1.2.x (non-secret)
  const accountName = fix.account_name; // testnet name (non-secret, fine to log)
  const wif = fix.active_priv_wif; // SECRET: in-memory only, never logged
  if (!accountId || !wif) throw new Error("fixture missing account_id/active_priv_wif");

  const t0 = Date.now();
  let conn;
  try {
    conn = await Chain.connect(NODE_URL, { timeoutMs: 25000 });
  } catch (e) {
    stopErr("connect", "Chain.connect rejected: " + ((e && e.message) || String(e)), { node: NODE_URL });
    return;
  }
  const chainId = (Chain.status() && Chain.status().chainId) || conn.chainId;
  if (chainId !== EXPECT_CHAIN) stopErr("chain_id", "chain-id mismatch: " + chainId);
  log({ step: "connected", node: NODE_URL, chain_id_prefix: chainId.slice(0, 16), latencyMs: conn.latencyMs });

  const dbId = await Chain.db();
  const accs = await Chain.call(dbId, "get_accounts", [[accountId]]);
  const membership = accs && accs[0] ? String(accs[0].membership_expiration_date) : "missing";
  const bals = await Chain.call(dbId, "get_account_balances", [accountId, [CORE]]);
  const balRaw = (Array.isArray(bals) && bals[0] && bals[0].amount !== undefined) ? String(bals[0].amount) : "EMPTY";
  const existing = await Chain.call(dbId, "get_committee_member_by_account", [accountId]);
  log({
    step: "pre_read", account: accountName, account_id: accountId,
    test_balance_raw: balRaw, membership_expiration_date: membership,
    committee: existing ? { id: existing.id, url: existing.url } : null
  });

  // Gate 1: already a committee member — re-read proof (same URL) or STOP.
  if (existing && existing.id) {
    const objs = await Chain.call(dbId, "get_objects", [[existing.id]]);
    const reread = objs && objs[0] ? objs[0] : null;
    const head = await Chain.call(dbId, "get_dynamic_global_properties", []);
    if (existing.url === WANT_URL) {
      log({
        step: "proved", committee_id: existing.id, head_block: head.head_block_number,
        via: "re-read (already existed with our URL, no broadcast needed)",
        reread_url: reread ? reread.url : null,
        elapsedMs: Date.now() - t0
      });
      log({ step: "done", result: "already-proved " + existing.id });
      try { Chain.disconnect(); } catch (e) {}
      return;
    }
    stopErr("exists", "account already owns committee record " + existing.id + " with a different url; one record per account, no overwrite attempted",
      { committee_id: existing.id, url: existing.url });
    return;
  }

  // Gate 2: LTM required by the chain (committee_member_evaluator.cpp:37).
  if (membership !== LTM_SENTINEL) {
    stopErr("ltm_gate", "fixture is not a lifetime member; committee_member_create is consensus-unprovable until op-8 upgrades it",
      { membership_expiration_date: membership, ltm_sentinel: LTM_SENTINEL });
    return;
  }

  // Gate 3: fee + dust reserve (never drain the fixture).
  const opData = {
    fee: { amount: "0", asset_id: CORE },
    committee_member_account: accountId,
    url: WANT_URL
  };
  const f = await Tx.fee(29, opData, CORE);
  opData.fee = { amount: String(f.amount), asset_id: f.asset_id || CORE };
  log({ step: "fee_29", amount: String(f.amount), asset_id: f.asset_id || CORE, url: WANT_URL });
  if (balRaw === "EMPTY") stopErr("funds_gate", "no TEST balance row; cannot prove fee coverage");
  if (BigInt(balRaw) < BigInt(String(f.amount)) + BigInt(DUST_RESERVE_RAW)) {
    stopErr("funds_gate", "fee + dust reserve unaffordable; fixture untouched",
      { test_balance_raw: balRaw, fee_raw: String(f.amount), dust_reserve_raw: DUST_RESERVE_RAW });
    return;
  }

  const unsigned = await Tx.buildTx([[29, opData]]);
  const signed = await Tx.sign(unsigned, wif);
  const netId = await Chain.net();
  let via = "broadcast_transaction_with_callback";
  try {
    await Chain.call(netId, "broadcast_transaction_with_callback", [(Math.random() * 4294967296) >>> 0, signed]);
  } catch (e) {
    const msg = String((e && e.message) || e || "");
    if (/unknown method|method not found|no method|bad method|not supported/i.test(msg)) {
      via = "broadcast_transaction";
      await Chain.call(netId, "broadcast_transaction", [signed]);
    } else {
      throw e;
    }
  }

  const deadline = Date.now() + PROVE_TIMEOUT_MS;
  let cur = null;
  for (;;) {
    try { cur = await Chain.call(await Chain.db(), "get_committee_member_by_account", [accountId]); }
    catch (e) { cur = null; }
    if (cur && cur.id) break;
    if (Date.now() >= deadline) {
      throw new Error("broadcast accepted but committee object not observed within " +
        (PROVE_TIMEOUT_MS / 1000) + "s; re-read with get_committee_member_by_account before retrying (do NOT blindly rebroadcast).");
    }
    await sleep(PROVE_INTERVAL_MS);
  }
  const objs = await Chain.call(await Chain.db(), "get_objects", [[cur.id]]);
  const reread = objs && objs[0] ? objs[0] : null;
  const head = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []);
  log({
    step: "proved", committee_id: cur.id, head_block: head.head_block_number,
    via: via + "+re-read", fee: opData.fee,
    reread_url: reread ? reread.url : null,
    elapsedMs: Date.now() - t0
  });
  log({ step: "done", result: "proved " + cur.id + " at head block " + head.head_block_number });
  try { Chain.disconnect(); } catch (e) {}
}

main().then(() => process.exit(0)).catch((e) => {
  console.log(JSON.stringify({ step: "FAILED", error: (e && e.message) || String(e) }));
  try { Chain.disconnect(); } catch (x) {}
  process.exit(1);
});
