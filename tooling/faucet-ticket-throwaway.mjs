#!/usr/bin/env node
/* tooling/faucet-ticket-throwaway.mjs — AFK testnet funding worker for slice-14 tickets.
 *
 * GOAL: unblock ticket broadcasts (op-57 create 50 TEST fee + op-58 update 50 TEST
 *   fee = ~100 TEST on ONE account; fixture lite-test-1 holds ~38.8 TEST).
 * FLOW (stop at first success):
 *   (1) Generate FRESH secp256k1 keypairs via the vendored noble-classic.js
 *       (same Crypto.keypairFromPrivateHex path wallet.js _deriveFreshKeys uses;
 *       NEVER fixture keys) for a throwaway name afk-tkt-<random>.
 *   (2) POST https://testnet-faucet.xbts.io/api/v1/accounts {account:{name,
 *       owner_key,active_key,memo_key}} — record the EXACT status/body.
 *   (3) If created: verify on-chain (get_account_by_name key MATCH), read
 *       balances; if >= 110 TEST, run ticket create (lock_180_days, 1 TEST) ->
 *       update up one step on the THROWAWAY, reporting blocks + re-reads + fees.
 *   (4) Faucet rate-limit or underfunding -> print PENDING with exact error/body.
 * RULES: testnet ONLY (chain id asserted 39f5e2ed...617447, aborts otherwise);
 *   fixture file NEVER opened, fixture funds NEVER moved, NO broadcasts on the
 *   fixture; history read before ANY retry; fees from get_required_fees (never
 *   estimated); WIFs/privkeys stay in memory and are NEVER printed or written.
 * REPO POLICY: this is the ONE throwaway script this task may add. No app-code
 *   edits, no commits. Prints contain public keys / names / balances / fees /
 *   blocks only — no secrets.
 * Provenance: WS framing copied from tooling/ws-probe.mjs (stdlib only);
 *   serializers/signing/fee/read paths are the SHIPPED vanilla files loaded via
 *   vm (vendor/noble-classic.js, crypto.js, format.js, tx.js, tx-send.js,
 *   proposal.js, proposal-ticket.js) — no reimplementation, no bitsharesjs.
 */
import tls from "node:tls";
import net from "node:net";
import nodeCrypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const EXPECTED_CHAIN = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
const NODE_URL = "wss://testnet.xbts.io/ws";
const FAUCET_URL = "https://testnet-faucet.xbts.io/api/v1/accounts";
const CORE_ASSET = "1.3.0";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CALL_TIMEOUT_MS = 15000;
const TICKET_CREATE_RAW_1_TEST = "100000"; // 1.00000 TEST at p5 (precision re-verified live)
const THRESHOLD_TEST = 110n;

function log(...a) { console.log(...a); }
function bytesToHex(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}

/* ---- Load shipped vanilla files into this context (no copies, no edits). ---- */
function loadVanilla(rel) {
  const src = fs.readFileSync(new URL("../vanilla/" + rel, import.meta.url), "utf8");
  vm.runInThisContext(src, { filename: rel });
}
loadVanilla("js/vendor/noble-classic.js"); // globals: nobleGetPublicKey/SignAsync/SharedSecret
loadVanilla("js/crypto.js");               // global Crypto
loadVanilla("js/format.js");               // global Format
loadVanilla("js/tx.js");                   // global Tx (serializers)
loadVanilla("js/tx-send.js");              // Tx.fee/feeMulti/buildTx/sign
loadVanilla("js/proposal.js");             // global Proposal (fee/sendAndProve)
loadVanilla("js/proposal-ticket.js");      // global ProposalTicket (builders/reads)
const Crypto = globalThis.Crypto, Format = globalThis.Format;
const Tx = globalThis.Tx, Proposal = globalThis.Proposal, ProposalTicket = globalThis.ProposalTicket;

/* ---- stdlib WS client (framing per tooling/ws-probe.mjs) ---- */
function buildFrame(opcode, payload, { fin = true, masked = true } = {}) {
  const len = payload.length;
  let headerLen = 2, ext = null;
  if (len >= 126 && len < 65536) { headerLen += 2; ext = Buffer.alloc(2); ext.writeUInt16BE(len, 0); }
  else if (len >= 65536) { headerLen += 8; ext = Buffer.alloc(8); ext.writeBigUInt64BE(BigInt(len), 0); }
  if (masked) headerLen += 4;
  const out = Buffer.alloc(headerLen + len);
  out[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  out[1] = (masked ? 0x80 : 0x00) | (len < 126 ? len : len < 65536 ? 126 : 127);
  let off = 2;
  if (ext) { ext.copy(out, off); off += ext.length; }
  if (masked) {
    const mask = nodeCrypto.randomBytes(4);
    mask.copy(out, off); off += 4;
    for (let i = 0; i < len; i++) out[off + i] = payload[i] ^ mask[i % 4];
  } else payload.copy(out, off);
  return out;
}

function openRpc(url) {
  const parsed = new URL(url);
  const isTls = parsed.protocol === "wss:";
  const host = parsed.hostname, port = parsed.port ? Number(parsed.port) : isTls ? 443 : 80;
  const path = (parsed.pathname || "/") + (parsed.search || "");
  return new Promise((resolve, reject) => {
    const sock = isTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let recv = Buffer.alloc(0), hsDone = false, fragOpcode = null, fragParts = [];
    const pending = new Map();
    let nextId = 1;
    const fail = (e) => { try { sock.destroy(); } catch {} reject(e); };
    function emitText(t) {
      let m; try { m = JSON.parse(t); } catch { return; }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error("rpc error: " + JSON.stringify(m.error)));
        else p.resolve(m.result);
      }
    }
    function onFrame(op, fin, pay) {
      if (op === 0x9) { try { sock.write(buildFrame(0x0a, pay)); } catch {} return; }
      if (op === 0x8) { try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {} return; }
      if (op === 0x0a) return;
      if (op === 0x1 || op === 0x2) {
        if (fin) {
          if (fragOpcode === null) emitText(pay.toString("utf8"));
          else { fragParts.push(pay); const f = Buffer.concat(fragParts); fragParts = []; fragOpcode = null; emitText(f.toString("utf8")); }
        } else { fragOpcode = op; fragParts = [pay]; }
        return;
      }
      if (op === 0x0) {
        fragParts.push(pay);
        if (fin) { const f = Buffer.concat(fragParts); fragParts = []; fragOpcode = null; emitText(f.toString("utf8")); }
      }
    }
    function pump() {
      if (!hsDone) {
        const i = recv.indexOf("\r\n\r\n");
        if (i === -1) return;
        const head = recv.slice(0, i).toString("latin1");
        recv = recv.slice(i + 4);
        const line = head.split("\r\n")[0];
        if (!/^HTTP\/\d\.\d\s+101/.test(line)) { fail(new Error("handshake failed: " + line)); return; }
        hsDone = true;
        const wsKey = sock._wsKey;
        const exp = nodeCrypto.createHash("sha1").update(wsKey + WS_GUID).digest("base64");
        const got = (head.match(/sec-websocket-accept:\s*(\S+)/i) || [])[1];
        if (!got || got.trim() !== exp) { fail(new Error("bad Sec-WebSocket-Accept")); return; }
        resolve(api);
      }
      for (;;) {
        if (recv.length < 2) return;
        const b0 = recv[0], b1 = recv[1], fin = (b0 >> 7) & 1, op = b0 & 0x0f, masked = (b1 >> 7) & 1;
        let len = b1 & 0x7f, off = 2;
        if (len === 126) { if (recv.length < 4) return; len = recv.readUInt16BE(2); off = 4; }
        else if (len === 127) {
          if (recv.length < 10) return;
          const big = recv.readBigUInt64BE(2);
          if (big > BigInt(Number.MAX_SAFE_INTEGER)) { fail(new Error("frame too large")); return; }
          len = Number(big); off = 10;
        }
        let mask = null;
        if (masked) { if (recv.length < off + 4) return; mask = recv.slice(off, off + 4); off += 4; }
        if (recv.length < off + len) return;
        let pay = recv.slice(off, off + len);
        if (mask) { const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = pay[i] ^ mask[i % 4]; pay = u; }
        recv = recv.slice(off + len);
        onFrame(op, fin, pay);
      }
    }
    sock.on("data", (c) => { recv = Buffer.concat([recv, c]); try { pump(); } catch (e) { if (!hsDone) fail(e); } });
    sock.on("error", () => {});
    sock.on("close", () => { if (!hsDone) fail(new Error("socket closed during handshake")); });
    const wsKey = nodeCrypto.randomBytes(16).toString("base64");
    sock._wsKey = wsKey;
    const onOpen = () => {
      // Single handshake write on the READY socket only: secureConnect for TLS,
      // connect for plain (writing on TCP-connect before the TLS handshake
      // corrupts the session and the node never answers — login timeout).
      sock.write(
        `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${wsKey}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://${host}\r\n\r\n`
      );
    };
    if (isTls) sock.once("secureConnect", onOpen);
    else sock.once("connect", onOpen);
    function call(apiId, method, params, tMs) {
      const id = nextId++;
      const body = JSON.stringify({ id, method: "call", params: [apiId, method, params || []] });
      return new Promise((res, rej) => {
        const timer = setTimeout(() => { pending.delete(id); rej(new Error("call timeout: " + method)); }, tMs || CALL_TIMEOUT_MS);
        pending.set(id, { resolve: res, reject: rej, timer });
        try { sock.write(buildFrame(0x1, Buffer.from(body, "utf8"))); }
        catch (e) { clearTimeout(timer); pending.delete(id); rej(e); }
      });
    }
    const api = { call, close: () => { try { sock.write(buildFrame(0x8, Buffer.alloc(0))); } catch {} try { sock.destroy(); } catch {} } };
  });
}

/* ---- main ---- */
async function checkMode(name) {
  // Read-only: verify any account's on-chain state + live ticket fee. No POST,
  // no signing, no secrets. Usage: node tooling/faucet-ticket-throwaway.mjs --check <name>
  const rpc = await openRpc(NODE_URL);
  try {
    await rpc.call(1, "login", ["", ""]);
    const dbId = await rpc.call(1, "database", []);
    const chainId = await rpc.call(dbId, "get_chain_id", []);
    log("[check] chain_id: " + chainId);
    if (chainId !== EXPECTED_CHAIN) throw new Error("CHAIN MISMATCH — ABORT");
    const acct = await rpc.call(dbId, "get_account_by_name", [name]);
    if (!acct || !acct.id) { log("[check] " + name + " -> null (not on-chain)"); return; }
    log("[check] " + name + " id: " + acct.id + " registrar: " + (acct.registrar || "?"));
    const assets = await rpc.call(dbId, "get_assets", [[CORE_ASSET]]);
    const prec = assets[0].precision;
    const bals = await rpc.call(dbId, "get_account_balances", [acct.id, []]);
    let raw = "0";
    (bals || []).forEach((b) => { if (b.asset_id === CORE_ASSET) raw = String(b.amount); });
    log("[check] balance raw: " + raw + " (" + Format.formatAmount(raw, prec) + " TEST)");
    const Chain = {
      db: () => Promise.resolve(dbId),
      history: () => rpc.call(1, "history", []),
      net: () => rpc.call(1, "network_broadcast", []),
      call: (a, m, p, t) => rpc.call(a, m, p, t),
      status: () => ({ state: "open", chainId }),
    };
    globalThis.Chain = Chain;
    // Live fee for op-57 create (lock_180_days, 1 TEST) — stateless, no keys.
    const probe = ProposalTicket.buildTicketCreate({ accountId: acct.id, targetType: 1, amountRaw: TICKET_CREATE_RAW_1_TEST, assetId: CORE_ASSET });
    const fee57 = await Proposal.fee(probe, CORE_ASSET);
    log("[check] op-57 live fee raw: " + fee57.amount + " (" + Format.formatAmount(String(fee57.amount), prec) + " TEST)");
    const tks = await ProposalTicket.ticketsByAccount(acct.name || acct.id, {});
    log("[check] tickets held: " + tks.length);
    for (const r of tks) log("[check] ticket " + r.id + " amount_raw=" + r.amount_raw + " lock=" + r.lock_word + " target_type=" + r.target_type);
    try {
      const hId = await Chain.history();
      const h = await rpc.call(hId, "get_account_history", [acct.id, "1.11.0", 100, "1.11.0"]);
      log("[check] history entries: " + (Array.isArray(h) ? h.length : "?"));
      for (const e of h || []) {
        const en = e[1] || e, op = en && en.op;
        log("[check] hist op=" + (Array.isArray(op) ? op[0] : "?") + " block=" + en.block_num + "/" + en.trx_in_block);
      }
    } catch (e) { log("[check] history unavailable: " + String((e && e.message) || e).slice(0, 200)); }
  } finally {
    rpc.close();
  }
}

async function main() {
  if (process.argv[2] === "--check" && process.argv[3]) { await checkMode(process.argv[3]); return; }
  // [1] Fresh keypairs via the vendored noble path (wallet.js _deriveFreshKeys shape).
  const suffix = Array.from(nodeCrypto.randomBytes(4)).map((b) => "0123456789abcdef"[b % 16]).join("");
  const name = "afk-tkt-" + suffix; // lowercase, letter-start, [a-z0-9-]
  const roles = ["owner", "active", "memo"];
  const pubs = {}, wifs = {}; // wifs: memory only, NEVER printed/written
  for (const r of roles) {
    let kp = null;
    for (let t = 0; t < 10 && !kp; t++) {
      const privHex = bytesToHex(nodeCrypto.randomBytes(32));
      try { kp = await Crypto.keypairFromPrivateHex(privHex, "TEST"); }
      catch { kp = null; }
      if (kp) wifs[r] = kp.wif;
    }
    if (!kp) throw new Error("keygen failed for role " + r);
    pubs[r] = kp.pub;
  }
  log("[1] throwaway name: " + name);
  log("[1] owner pub: " + pubs.owner);
  log("[1] active pub: " + pubs.active);
  log("[1] memo pub: " + pubs.memo);
  log("[1] keygen: vendored noble-classic.js + Crypto.keypairFromPrivateHex (TEST prefix explicit)");

  // [2] Faucet POST (exact response recorded).
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, 20000);
  let res, text;
  try {
    res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: { name, owner_key: pubs.owner, active_key: pubs.active, memo_key: pubs.memo } }),
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    clearTimeout(timer);
    log("[2] faucet POST error: " + (e && e.name === "AbortError" ? "Faucet timed out after 20s." : String((e && e.message) || e)));
    log("VERDICT: PENDING — faucet unreachable (" + String((e && e.message) || e).slice(0, 200) + ")");
    return;
  }
  clearTimeout(timer);
  log("[2] faucet POST " + FAUCET_URL);
  log("[2] HTTP status: " + res.status);
  log("[2] response body (exact, first 1000 chars): " + text.slice(0, 1000));
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || (data && data.error)) {
    log("VERDICT: PENDING — faucet refused (HTTP " + res.status + "): " + text.slice(0, 300));
    return;
  }

  // [3] Chain verify (testnet assert + on-chain account + key MATCH).
  const rpc = await openRpc(NODE_URL);
  try {
    await rpc.call(1, "login", ["", ""]);
    const dbId = await rpc.call(1, "database", []);
    const chainId = await rpc.call(dbId, "get_chain_id", []);
    log("[3] chain_id: " + chainId);
    if (chainId !== EXPECTED_CHAIN) throw new Error("CHAIN MISMATCH: expected testnet " + EXPECTED_CHAIN + " got " + chainId + " — ABORT (mainnet safety)");
    log("[3] chain assert OK (testnet)");
    // Chain stub for the shipped modules (reads only; signing via in-memory WIFs).
    const Chain = {
      db: (() => { let v = null; return () => v !== null ? Promise.resolve(v) : rpc.call(1, "database", []).then((id) => (v = id)); })(),
      history: (() => { let v = null; return () => v !== null ? Promise.resolve(v) : rpc.call(1, "history", []).then((id) => (v = id)); })(),
      net: (() => { let v = null; return () => v !== null ? Promise.resolve(v) : rpc.call(1, "network_broadcast", []).then((id) => (v = id)); })(),
      call: (a, m, p, t) => rpc.call(a, m, p, t),
      status: () => ({ state: "open", chainId }),
    };
    globalThis.Chain = Chain;
    // Availability re-check + on-chain verify (faucet said created).
    await new Promise((r) => setTimeout(r, 3000)); // witness inclusion grace
    const acct = await rpc.call(dbId, "get_account_by_name", [name]);
    if (!acct || !acct.id) {
      log("[3] get_account_by_name -> null (not on-chain yet)");
      log("VERDICT: PENDING — faucet said created but account not on-chain; retry name check before any other step (no broadcasts attempted)");
      return;
    }
    log("[3] on-chain id: " + acct.id);
    const om = ((acct.owner || {}).key_auths || [])[0], am = ((acct.active || {}).key_auths || [])[0];
    log("[3] owner MATCH: " + ((om && om[0] === pubs.owner) ? "MATCH" : "MISMATCH"));
    log("[3] active MATCH: " + ((am && am[0] === pubs.active) ? "MATCH" : "MISMATCH"));
    log("[3] memo MATCH: " + ((((acct.options || {}).memo_key) === pubs.memo) ? "MATCH" : "MISMATCH"));
    log("[3] registrar: " + (acct.registrar || "?"));

    // [4] Balances + threshold (>= 110 TEST on THIS account). Faucet FUNDS with
    // a delay (~4-5 min observed: registration returns 0, funding lands later),
    // so POLL IN-PROCESS (keys stay alive) instead of exiting and key-loss.
    const assets = await rpc.call(dbId, "get_assets", [[CORE_ASSET]]);
    const prec = assets && assets[0] && assets[0].precision;
    log("[4] core asset: " + ((assets && assets[0] && assets[0].symbol) || "?") + " precision " + prec);
    if (prec !== 5) throw new Error("unexpected core precision " + prec + " — abort (money safety)");
    const need = (THRESHOLD_TEST * 10n ** BigInt(prec)).toString();
    log("[4] threshold raw: " + need + " (" + Format.formatAmount(need, prec) + " TEST)");
    let raw = "0", funded = false;
    for (let p = 0; p < 40; p++) {
      const bals = await rpc.call(dbId, "get_account_balances", [acct.id, []]);
      raw = "0";
      (bals || []).forEach((b) => { if (b.asset_id === CORE_ASSET) raw = String(b.amount); });
      log("[4] poll " + p + " balance raw: " + raw + " (" + Format.formatAmount(raw, prec) + " TEST)");
      if (BigInt(raw) >= BigInt(need)) { funded = true; break; }
      await new Promise((r) => setTimeout(r, 30000));
    }
    if (!funded) {
      log("VERDICT: PENDING — faucet account underfunded after 20 min (" + Format.formatAmount(raw, prec) + " < " + Format.formatAmount(need, prec) + " TEST); no ticket broadcasts (fixture untouched)");
      return;
    }

    // [5] Funded path: history pre-check + fee from get_required_fees + ticket create.
    const histId = await Chain.history();
    const hist0 = await rpc.call(histId, "get_account_history", [acct.id, "1.11.0", 20, "1.11.0"]);
    log("[5] pre-broadcast history entries: " + (Array.isArray(hist0) ? hist0.length : "?") + " (checked before any retry)");
    const before = await ProposalTicket.ticketsByAccount(acct.name || acct.id, {});
    log("[5] tickets before: " + before.length);
    const createPair = ProposalTicket.buildTicketCreate({ accountId: acct.id, targetType: 1, amountRaw: TICKET_CREATE_RAW_1_TEST, assetId: CORE_ASSET });
    const fee57 = await Proposal.fee(createPair, CORE_ASSET);
    log("[5] op-57 fee raw: " + fee57.amount + " (" + Format.formatAmount(String(fee57.amount), prec) + " TEST)");
    const tx1 = await Tx.buildTx([createPair]);
    const signed1 = await Tx.sign(tx1, wifs.active);
    const proof1 = await Proposal.sendAndProve(signed1, wifs.active, async () => {
      const now = await ProposalTicket.ticketsByAccount(acct.name || acct.id, {});
      return now.length > before.length ? now[now.length - 1] : null;
    });
    log("[5] op-57 sent via " + proof1.via);
    log("[5] op-57 ticket re-read: id=" + proof1.proof.id + " amount_raw=" + proof1.proof.amount_raw + " (" + (proof1.proof.prec !== null ? Format.formatAmount(proof1.proof.amount_raw, proof1.proof.prec) + " " + proof1.proof.sym : proof1.proof.asset_id) + ") lock=" + proof1.proof.lock_word);
    // Block number from history (content match, never trust the send ack).
    let block57 = "?";
    try {
      const h1 = await rpc.call(histId, "get_account_history", [acct.id, "1.11.0", 20, "1.11.0"]);
      for (const e of h1 || []) {
        const en = e[1] || e, op = en && en.op;
        if (Array.isArray(op) && op[0] === 57 && op[1] && op[1].account === acct.id) { block57 = String(en.block_num) + "/" + String(en.trx_in_block); break; }
      }
    } catch {}
    log("[5] op-57 inclusion block (history content-match): " + block57);

    // [6] Update up one step (1 -> 2), fee live, history checked, no blind retry.
    const hist1 = await rpc.call(histId, "get_account_history", [acct.id, "1.11.0", 20, "1.11.0"]);
    log("[6] pre-update history entries: " + (Array.isArray(hist1) ? hist1.length : "?"));
    const updPair = ProposalTicket.buildTicketUpdate({ ticketId: proof1.proof.id, accountId: acct.id, targetType: 2, amountRawOrNull: null, assetIdOrNull: null });
    const fee58 = await Proposal.fee(updPair, CORE_ASSET);
    log("[6] op-58 fee raw: " + fee58.amount + " (" + Format.formatAmount(String(fee58.amount), prec) + " TEST)");
    const tx2 = await Tx.buildTx([updPair]);
    const signed2 = await Tx.sign(tx2, wifs.active);
    const proof2 = await Proposal.sendAndProve(signed2, wifs.active, async () => {
      const rows = await ProposalTicket.ticketsByAccount(acct.name || acct.id, {});
      for (const r of rows) if (r.id === proof1.proof.id && r.target_type === 2) return r;
      return null;
    });
    log("[6] op-58 sent via " + proof2.via);
    log("[6] op-58 ticket re-read: id=" + proof2.proof.id + " lock=" + proof2.proof.lock_word + " target_type=" + proof2.proof.target_type);
    let block58 = "?";
    try {
      const h2 = await rpc.call(histId, "get_account_history", [acct.id, "1.11.0", 20, "1.11.0"]);
      for (const e of h2 || []) {
        const en = e[1] || e, op = en && en.op;
        if (Array.isArray(op) && op[0] === 58 && op[1] && op[1].ticket === proof1.proof.id) { block58 = String(en.block_num) + "/" + String(en.trx_in_block); break; }
      }
    } catch {}
    log("[6] op-58 inclusion block (history content-match): " + block58);
    const balsAfter = await rpc.call(dbId, "get_account_balances", [acct.id, []]);
    let rawAfter = "0";
    (balsAfter || []).forEach((b) => { if (b.asset_id === CORE_ASSET) rawAfter = String(b.amount); });
    log("[6] balance after raw: " + rawAfter + " (" + Format.formatAmount(rawAfter, prec) + " TEST)");
    log("VERDICT: FUNDED+TICKETS-PROVEN on throwaway " + name + " (" + acct.id + ") — create " + proof1.proof.id + " @" + block57 + " fee " + fee57.amount + ", update 1->2 @" + block58 + " fee " + fee58.amount);
  } finally {
    rpc.close();
  }
}

main().catch((e) => {
  console.log("VERDICT: PENDING — worker error (no broadcasts retried blindly): " + String((e && e.message) || e).slice(0, 500));
  process.exit(0);
});
