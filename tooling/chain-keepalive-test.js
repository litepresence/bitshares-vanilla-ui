#!/usr/bin/env node
/* Keepalive regression test (stdlib only): heartbeat + auto-reconnect +
 * per-call RTT piggyback (footer latency refreshes on every successful RPC,
 * failed calls leave it untouched, zero extra RPC emitted).
 * Stubs WebSocket/Store/document, loads vanilla/js/sdk/chain.js, asserts:
 *  1. a get_dynamic_global_properties heartbeat fires after open
 *     (headBlock advances),  2. unexpected close triggers a reconnect,
 *  3. an applied-block notice advances the tip with zero RPC,
 *  4. a successful call emits a latencyMs status with no extra RPC,
 *  5. a failed call neither moves latencyMs nor emits,
 *  6. probe() resolves pingMs (single RTT) bounded by handshake latencyMs.
 * Exit 0 green, 1 red. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

let sentLog = [];
let sockets = [];
let blockNum = 100;

class StubWS {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    sockets.push(this);
  }
  send(text) {
    this.sent.push(text);
    sentLog.push(text);
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    const p = msg.params || [];
    const method = p[1];
    const respond = (result) => {
      setImmediate(() => {
        if (this.onmessage) this.onmessage({ data: JSON.stringify({ id: msg.id, result: result }) });
      });
    };
    if (method === "login") respond(null);
    else if (method === "database") respond(2);
    else if (method === "history") respond(4);
    else if (method === "set_block_applied_callback") respond(null);
    else if (method === "boom") {
      setImmediate(() => {
        if (this.onmessage) this.onmessage({ data: JSON.stringify({ id: msg.id, error: { code: -32601, message: "nope" } }) });
      });
    }
    else if (method === "get_chain_id") respond("роп12345");
    else if (method === "get_dynamic_global_properties") {
      /* Audit-fix contract (H4/M1): real nodes always return the full
       * dynamic_global_property_object — the fake node must too, or the
       * shape gate under test correctly rejects it. block_id_type is
       * fc::ripemd160 (types.hpp:304) = 40 hex chars, NOT 64. */
      respond({ head_block_number: blockNum, head_block_id: "060560c4c0d58ccb50f17443302bdc8096e7f34a", time: "2026-01-01T00:00:00" });
    }
  }
  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
  open() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
  }
}

const sandbox = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  WebSocket: StubWS,
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { getElementById: () => null },
  Store: { emitConnection: () => {}, loadSettings: () => ({}) },
  module: { exports: {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("/workspace/vanilla/js/sdk/chain.js", "utf8"), sandbox, { filename: "sdk/chain.js" });
const Chain = sandbox.Chain;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  let pass = 0;
  function check(cond, failMsg, passMsg) {
    assert.ok(cond, "FAIL " + failMsg + " (actual=" + JSON.stringify(!cond) + " expected=true)");
    pass++;
    if (passMsg) console.log(passMsg);
  }
  // Handshake: open socket 0, let login/database/chain-id/props resolve.
  const p = Chain.connect("wss://fake/ws", { heartbeatMs: 60, reconnectDelays: [40, 40] }).catch(() => null);
  await sleep(10);
  sockets[0].open();
  await p;
  await sleep(10);

  // TEST 1: heartbeat advances headBlock (bump server block first).
  blockNum = 101;
  await sleep(200);
  const st1 = Chain.status();
  check(st1.headBlock === 101, "heartbeat did not advance headBlock (got " + st1.headBlock + ", want 101)",
    "PASS heartbeat advanced headBlock to 101");

  // TEST 2: unexpected close triggers reconnect (new socket).
  const nBefore = sockets.length;
  sockets[sockets.length - 1].readyState = 3;
  const last = sockets[sockets.length - 1];
  if (last.onclose) last.onclose();
  await sleep(150);
  check(sockets.length > nBefore, "no reconnect socket after unexpected close (sockets=" + sockets.length + " want>" + nBefore + ")",
    "PASS reconnect attempted (sockets " + nBefore + " -> " + sockets.length + ")");
  {
    sockets[sockets.length - 1].open();
    await sleep(50);
  }

  // TEST 3: applied-block notice advances the tip with zero RPC.
  sockets[sockets.length - 1].open();
  await sleep(50);
  const beforeNotice = Chain.status().headBlock;
  const lastSock = sockets[sockets.length - 1];
  lastSock.onmessage({ data: JSON.stringify({ method: "notice", params: [1, ["06d73c6c" + "00".repeat(16)]] }) });
  await sleep(20);
  const afterNotice = Chain.status().headBlock;
  check(afterNotice === 0x06d73c6c, "block notice did not advance tip (got " + afterNotice + " from " + beforeNotice + ", want " + 0x06d73c6c + ")",
    "PASS block notice advanced tip to " + afterNotice);

  // TEST 4+5 on a fresh quiet connection (60s heartbeat, no redial — the
  // piggyback is the only possible latency emitter; the 1.1s sleep clears
  // the 1s emit throttle so the measured call must repaint the footer).
  Chain.disconnect();
  await sleep(50);
  let piggyEmits = [];
  sandbox.Store.emitConnection = (s) => { piggyEmits.push(Object.assign({}, s)); };
  const p4 = Chain.connect("wss://fake/quiet", { heartbeatMs: 60000, reconnectDelays: [] }).catch(() => null);
  await sleep(10);
  sockets[sockets.length - 1].open();
  await p4;
  await sleep(20);
  const dbId4 = await Chain.db();
  await sleep(1100);
  piggyEmits.length = 0;
  const rpcMark = sentLog.length;
  await Chain.call(dbId4, "get_chain_id", []);
  await sleep(30);

  // TEST 4: a successful call emits footer latency with zero extra RPC.
  const latEmits = piggyEmits.filter((e) => typeof e.latencyMs === "number");
  check(latEmits.length > 0, "successful call did not refresh footer latency (latEmits=" + latEmits.length + " want>0)",
    "PASS per-call RTT refreshed footer latency (" + (latEmits.length ? latEmits[latEmits.length - 1].latencyMs : "?") + "ms)");
  check(sentLog.length - rpcMark === 1, "piggyback emitted extra RPC (sent " + (sentLog.length - rpcMark) + ", want 1)",
    "PASS piggyback rode the app call (zero extra RPC)");

  // TEST 5: a failed call neither moves latencyMs nor emits.
  const latBefore = Chain.status().latencyMs;
  const emitMark = piggyEmits.length;
  {
    let boomRejected = false;
    try { await Chain.call(dbId4, "boom", []); } catch (e) { boomRejected = true; }
    assert.ok(boomRejected, "FAIL boom call should reject (actual=resolved expected=rejected)");
    pass++;
    console.log("PASS boom call rejected as expected");
  }
  await sleep(30);
  check(Chain.status().latencyMs === latBefore, "failed call moved latencyMs (got " + Chain.status().latencyMs + " want " + latBefore + ")",
    "PASS failed call left latency untouched");
  check(piggyEmits.length === emitMark, "failed call emitted status (emits=" + piggyEmits.length + " want " + emitMark + ")",
    "PASS failed call emitted nothing");

  // TEST 6: probe measures a single-RTT ping inside the handshake window.
  const prP = Chain.probe("wss://fake/probe", 8000);
  await sleep(10);
  sockets[sockets.length - 1].open();
  const pr = await prP;
  check(!!(pr && typeof pr.pingMs === "number" && pr.pingMs >= 0), "probe pingMs missing (got " + JSON.stringify(pr && pr.pingMs) + " want number>=0)",
    "PASS probe measured single-RTT ping (" + pr.pingMs + "ms)");
  check(!!(pr && typeof pr.latencyMs === "number" && pr.latencyMs >= pr.pingMs), "handshake latency should bound the ping (latencyMs=" + JSON.stringify(pr && pr.latencyMs) + " pingMs=" + JSON.stringify(pr && pr.pingMs) + ")",
    "PASS handshake latency bounds the ping");
  check(!!(pr && pr.hasHistory === true), "stub history id should mark hasHistory (got " + JSON.stringify(pr && pr.hasHistory) + " want true)",
    "PASS probe history flag intact");

  // TEST 7: a FAILED redial must reschedule instead of going silent
  // (the stuck-DISCONNECTED bug: one failed redial parked the app forever).
  Chain.disconnect();
  await sleep(30);
  const p7 = Chain.connect("wss://fake/flaky", { heartbeatMs: 60000, reconnectDelays: [40, 40], timeoutMs: 5000 }).catch(() => null);
  await sleep(10);
  sockets[sockets.length - 1].open();
  await p7;
  await sleep(20);
  const nFlaky = sockets.length;
  sockets[sockets.length - 1].readyState = 3;
  sockets[sockets.length - 1].onclose();
  await sleep(120);
  check(sockets.length > nFlaky, "no redial after drop (sockets=" + sockets.length + " want>" + nFlaky + ")",
    "PASS redial attempted after drop");
  sockets[sockets.length - 1].onclose();
  await sleep(150);
  check(sockets.length > nFlaky + 1, "failed redial went silent, no reschedule (sockets=" + sockets.length + " want>" + (nFlaky + 1) + ")",
    "PASS failed redial rescheduled");
  sockets[sockets.length - 1].open();
  await sleep(60);

  // TEST 8: a connect that never opens (dead node at boot) must reschedule.
  Chain.disconnect();
  await sleep(30);
  const nDead = sockets.length;
  await Chain.connect("wss://fake/dead", { heartbeatMs: 60000, reconnectDelays: [40], timeoutMs: 60 }).catch(() => null);
  await sleep(250);
  check(sockets.length > nDead + 1, "dead node connect went silent, no reschedule (sockets=" + sockets.length + " want>" + (nDead + 1) + ")",
    "PASS dead node connect rescheduled");
  sockets[sockets.length - 1].open();
  await sleep(60);

  // Cleanup: manual disconnect must NOT reconnect.
  const nCalm = sockets.length;
  Chain.disconnect();
  await sleep(150);
  check(sockets.length === nCalm, "manual disconnect triggered reconnect (sockets=" + sockets.length + " want " + nCalm + ")",
    "PASS manual disconnect stays quiet");

  assert.ok(pass > 0, "FAIL expected non-empty pass count (actual=" + pass + " expected>0)");
  console.log("KEEPALIVE GREEN (" + pass + " checks)");
})().catch((e) => { console.log("FAIL harness: " + (e && e.stack || e && e.message)); process.exit(1); });
