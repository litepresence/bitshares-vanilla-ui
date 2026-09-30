#!/usr/bin/env node
/* Keepalive regression test (stdlib only): heartbeat + auto-reconnect.
 * Stubs WebSocket/Store/document, loads vanilla/js/chain.js, asserts:
 *  1. a get_dynamic_global_properties heartbeat fires after open
 *     (headBlock advances),  2. unexpected close triggers a reconnect.
 * Exit 0 green, 1 red. */
"use strict";
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
    else if (method === "set_block_applied_callback") respond(null);
    else if (method === "get_chain_id") respond("роп12345");
    else if (method === "get_dynamic_global_properties") {
      /* Audit-fix contract (H4/M1): real nodes always return the full
       * dynamic_global_property_object — the fake node must too, or the
       * shape gate under test correctly rejects it. */
      respond({ head_block_number: blockNum, head_block_id: "00" + "ab".repeat(31), time: "2026-01-01T00:00:00" });
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
vm.runInContext(fs.readFileSync("/workspace/vanilla/js/chain.js", "utf8"), sandbox, { filename: "chain.js" });
const Chain = sandbox.Chain;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  let fails = [];
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
  if (st1.headBlock !== 101) fails.push("heartbeat did not advance headBlock (got " + st1.headBlock + ")");
  else console.log("PASS heartbeat advanced headBlock to 101");

  // TEST 2: unexpected close triggers reconnect (new socket).
  const nBefore = sockets.length;
  sockets[sockets.length - 1].readyState = 3;
  const last = sockets[sockets.length - 1];
  if (last.onclose) last.onclose();
  await sleep(150);
  if (sockets.length <= nBefore) fails.push("no reconnect socket after unexpected close");
  else {
    console.log("PASS reconnect attempted (sockets " + nBefore + " -> " + sockets.length + ")");
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
  if (afterNotice !== 0x06d73c6c) fails.push("block notice did not advance tip (got " + afterNotice + " from " + beforeNotice + ")");
  else console.log("PASS block notice advanced tip to " + afterNotice);

  // Cleanup: manual disconnect must NOT reconnect.
  const nCalm = sockets.length;
  Chain.disconnect();
  await sleep(150);
  if (sockets.length !== nCalm) fails.push("manual disconnect triggered reconnect");
  else console.log("PASS manual disconnect stays quiet");

  if (fails.length) {
    fails.forEach((f) => console.log("FAIL " + f));
    process.exit(1);
  }
  console.log("KEEPALIVE GREEN");
})().catch((e) => { console.log("FAIL harness: " + (e && e.message)); process.exit(1); });
